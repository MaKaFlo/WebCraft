// Aiming, attacking, digging (with progress) and using items / blocks.
import * as THREE from 'three';
import { atlas, tileUV } from './textures.js';
import { KIND_CROSS, KIND_CUBE, KIND_LIQUID } from './palette.js';
import { isPlaceable, prettyName } from './items.js';
import { THROWN } from './hand.js';

const BLOCK_REACH = 4.5;
const ENTITY_REACH = 3.0;
const USE_REPEAT = 0.25; // seconds between placements while holding the right button

// Minecraft's Direction order: down, up, north (-z), south (+z), west (-x), east (+x)
function faceIndex([x, y, z]) {
  if (y < 0) return 0;
  if (y > 0) return 1;
  if (z < 0) return 2;
  if (z > 0) return 3;
  if (x < 0) return 4;
  return 5;
}

export class Interaction {
  constructor(scene, world, player, entities, inventory, send) {
    this.world = world;
    this.player = player;
    this.entities = entities;
    this.inventory = inventory;
    this.send = send;

    this.outline = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1.004, 1.004, 1.004)),
      new THREE.LineBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.7 }),
    );
    this.outline.visible = false;
    scene.add(this.outline);

    this.crack = new THREE.Mesh(
      new THREE.BoxGeometry(1.01, 1.01, 1.01),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0, depthWrite: false }),
    );
    // Cracks from the texture pack (destroy_stage_0..9), like in Minecraft
    this.crackBaseUv = this.crack.geometry.attributes.uv.array.slice();
    this.crackMat = new THREE.MeshBasicMaterial({ map: atlas.texture, transparent: true, depthWrite: false, alphaTest: 0.05,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    this.plainCrackMat = this.crack.material;
    this.crackStage = -1;
    this.crack.visible = false;
    this.crack.renderOrder = 2;
    scene.add(this.crack);

    this.target = null;         // block under the crosshair
    this.targetEntity = null;   // entity under the crosshair (wins if closer)
    this.leftDown = false;
    this.rightDown = false;
    this.using = false;         // holding right click on an item (eating, bow)
    this.dig = null;
    this.recent = null;
    this.cooldown = 0;
    this.useTimer = 0;
    this.attackSpeed = 4;        // attacks per second at full strength (from the server, depends on the item)
    this.lastSwing = 0;          // performance.now() of the last swing (resets the attack strength)
    this.lastAttack = null;      // { id, at, charge } to play the hit sound when the server confirms
    this.onSwing = () => {};
    this.digSwing = 0;
    this.progressEl = document.getElementById('dig-progress');
  }

  /** Name of the block or mob under the crosshair, at the top in the middle of the screen. */
  showLookName(P) {
    if (!this.lookEl) this.lookEl = document.getElementById('look');
    let text = '';
    if (this.targetEntity) {
      const e = this.targetEntity.entity;
      text = e?.target?.n || (e ? prettyName(e.type) : '');
    } else if (this.target && P) {
      text = prettyName(P.names[this.target.id] || '');
    }
    if (text === this.lookText) return;
    this.lookText = text;
    this.lookEl.textContent = text;
    this.lookEl.hidden = !text;
  }

  direction() {
    const yr = this.player.yaw * Math.PI / 180, pr = this.player.pitch * Math.PI / 180;
    return [-Math.sin(yr) * Math.cos(pr), -Math.sin(pr), Math.cos(yr) * Math.cos(pr)];
  }

  update(dt, active) {
    const P = this.world.palette;
    const [dx, dy, dz] = this.direction();
    const ox = this.player.x, oy = this.player.eyeY, oz = this.player.z;
    this.target = active ? this.world.raycast(ox, oy, oz, dx, dy, dz, BLOCK_REACH) : null;
    const ent = active ? this.entities.raycast(ox, oy, oz, dx, dy, dz, ENTITY_REACH) : null;
    const blockDist = this.target ? (this.target.t ?? this.blockDistance(this.target, ox, oy, oz, dx, dy, dz)) : Infinity;
    this.targetEntity = ent && ent.t < blockDist ? ent : null;
    if (this.targetEntity) this.target = null;
    if (this.target) this.target.hit = [ox + dx * blockDist, oy + dy * blockDist, oz + dz * blockDist];

    document.body.classList.toggle('aim-entity', !!this.targetEntity);
    this.showLookName(P);
    if (this.target) {
      const b = P.kind[this.target.id] === KIND_CROSS ? [0.15, 0, 0.15, 0.85, 0.9, 0.85] : (P.box[this.target.id] || [0, 0, 0, 1, 1, 1]);
      this.outline.visible = true;
      this.outline.scale.set(b[3] - b[0], Math.min(b[4], 1.5) - b[1], b[5] - b[2]);
      this.outline.position.set(this.target.x + (b[0] + b[3]) / 2, this.target.y + (b[1] + Math.min(b[4], 1.5)) / 2, this.target.z + (b[2] + b[5]) / 2);
    } else {
      this.outline.visible = false;
    }

    this.cooldown = Math.max(0, this.cooldown - dt);
    this.updateDigging(dt, active);

    this.useTimer = Math.max(0, this.useTimer - dt);
    if (!this.rightDown) this.useLocked = false;
    if (active && this.rightDown && this.useTimer === 0 && !this.useLocked) {
      this.useTimer = USE_REPEAT;
      this.rightClick();
    }
    if ((!this.rightDown || !active) && this.using) {
      this.using = false;
      this.send({ t: 'release' });
    }
  }

  /** Eating/drinking is done: stop, and don't start the next bite until right click is let go and pressed again. */
  stopUse() {
    if (!this.using) return;
    this.using = false;
    this.useLocked = true;
    this.send({ t: 'release' });
  }

  /** Distance along the ray to the block's surface (for comparing with entities). */
  blockDistance(t, ox, oy, oz, dx, dy, dz) {
    let best = Infinity;
    const min = [t.x, t.y, t.z], max = [t.x + 1, t.y + 1, t.z + 1];
    const o = [ox, oy, oz], d = [dx, dy, dz];
    let t0 = 0, t1 = Infinity;
    for (let a = 0; a < 3; a++) {
      if (Math.abs(d[a]) < 1e-9) continue;
      let ta = (min[a] - o[a]) / d[a], tb = (max[a] - o[a]) / d[a];
      if (ta > tb) [ta, tb] = [tb, ta];
      t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
    }
    if (t0 <= t1) best = t0;
    return best;
  }

  /** Attack strength 0..1 like the Minecraft attack indicator (full after 1 / attackSpeed seconds). */
  charge() {
    const period = 1000 / Math.max(0.1, this.attackSpeed);
    return Math.min(1, (performance.now() - this.lastSwing + 25) / period);
  }

  swing() {
    this.lastSwing = performance.now();
    this.onSwing();
  }

  /** Left button pressed: hit an entity right away, or swing at the air. */
  leftClick() {
    if (this.targetEntity) {
      this.lastAttack = { id: this.targetEntity.id, at: performance.now(), charge: this.charge(), dist: this.targetEntity.t };
      this.onAttack?.(this.targetEntity.t);
      this.send({ t: 'attack', id: this.targetEntity.id });
      this.swing();
      return;
    }
    if (!this.target) {
      this.send({ t: 'punch' });
      this.swing();
    }
  }

  updateDigging(dt, active) {
    const t = this.target;
    if (!active || !this.leftDown || !t) {
      this.abortDig();
      return;
    }
    const key = t.x + ',' + t.y + ',' + t.z;
    if (!this.dig || this.dig.key !== key) {
      this.abortDig();
      if (this.cooldown > 0) return;
      if (this.recent && this.recent.key === key && performance.now() - this.recent.at < 500) return;
      this.dig = { key, x: t.x, y: t.y, z: t.z, face: faceIndex(t.face), normal: t.face, ticks: -2, time: 0, slow: this.digSlow() };
      this.send({ t: 'dig_start', x: t.x, y: t.y, z: t.z, face: this.dig.face });
      this.swing();
      this.digSwing = 0;
      return;
    }
    // Keep swinging while digging
    this.digSwing += dt;
    if (this.digSwing > 0.25) {
      this.digSwing = 0;
      this.onSwing();
      this.onDigHit?.(this.dig.x, this.dig.y, this.dig.z, this.dig.normal, this.world.getId(this.dig.x, this.dig.y, this.dig.z));
      this.send({ t: 'swing' });   // so everybody else sees the arm moving while you dig
    }
    const d = this.dig;
    if (d.ticks < 0) return; // waiting for the server, or unbreakable
    // Like Minecraft: 5x slower in the air or with the head in water. The server's time was measured
    // at the start, so only changes since then count.
    d.time += dt * d.slow / this.digSlow();
    const need = d.ticks / 20;
    const progress = need > 0 ? Math.min(1, d.time / need) : 1;
    this.showProgress(progress, d);
    if (progress >= 1) {
      if (need > 0) this.send({ t: 'dig_stop', x: d.x, y: d.y, z: d.z, face: d.face });
      // Show it gone right away (the server sends the real state back if it says no)
      this.onBreak?.(d.x, d.y, d.z, this.world.getId(d.x, d.y, d.z));
      this.world.setBlock(d.x, d.y, d.z, 0);
      this.recent = { key: d.key, at: performance.now() };
      this.dig = null;
      this.cooldown = 0.25;
      this.showProgress(0);
    }
  }

  /** Break speed penalty right now (1 = normal). */
  digSlow() {
    const p = this.player;
    let f = 1;
    if (!p.onGround && !p.flying) f *= 5;
    if (p.world.isLiquid(Math.floor(p.x), Math.floor(p.eyeY), Math.floor(p.z))) f *= 5;
    return f;
  }

  onDigInfo(msg) {
    const d = this.dig;
    if (!d || d.x !== msg.x || d.y !== msg.y || d.z !== msg.z) return;
    d.ticks = msg.ticks;
    if (msg.ticks === 0) {   // instant break (plants, creative)
      this.onBreak?.(d.x, d.y, d.z, this.world.getId(d.x, d.y, d.z));
      this.world.setBlock(d.x, d.y, d.z, 0);
    }
  }

  abortDig() {
    if (!this.dig) return;
    if (this.dig.ticks > 0) this.send({ t: 'dig_abort', x: this.dig.x, y: this.dig.y, z: this.dig.z, face: this.dig.face });
    this.dig = null;
    this.showProgress(0);
  }

  showProgress(p, d) {
    if (p <= 0 || !d) {
      this.crack.visible = false;
      this.progressEl.style.display = 'none';
      this.crackStage = -1;
      return;
    }
    const b = this.world.palette.box[this.world.getId(d.x, d.y, d.z)] || [0, 0, 0, 1, 1, 1];
    this.crack.visible = true;
    this.crack.scale.set(b[3] - b[0], Math.min(b[4], 1) - b[1], b[5] - b[2]);
    this.crack.position.set(d.x + (b[0] + b[3]) / 2, d.y + (b[1] + Math.min(b[4], 1)) / 2, d.z + (b[2] + b[5]) / 2);
    const stage = Math.min(9, Math.floor(p * 10));
    const tile = atlas.packTile('block/destroy_stage_' + stage);
    if (tile >= 0) {
      this.crack.material = this.crackMat;
      if (stage !== this.crackStage) {
        this.crackStage = stage;
        const uv = this.crack.geometry.attributes.uv;
        for (let i = 0; i < uv.count; i++) {
          const [u, v] = tileUV(tile, this.crackBaseUv[i * 2], this.crackBaseUv[i * 2 + 1]);
          uv.setXY(i, u, v);
        }
        uv.needsUpdate = true;
      }
    } else {
      this.crack.material = this.plainCrackMat;
      this.crack.material.opacity = 0.1 + p * 0.5;
    }
    this.progressEl.style.display = 'block';
    this.progressEl.firstChild.style.width = Math.round(p * 100) + '%';
  }

  /** Right click: use the block we look at (doors, chests, placing) or the item in hand. */
  rightClick() {
    if (this.using) return;            // still eating / drawing the bow
    const t = this.target;
    const item = this.inventory.selectedItem();
    // Firework rocket while gliding with the elytra: a push forward (the server fires the rocket too)
    if (item?.k === 'firework_rocket' && this.player.gliding) {
      this.send({ t: 'use' });
      this.onSwing();
      this.player.boost();
      return;
    }
    // Right click on a mob: trade, feed, ride, shear, put a name tag on ...
    const te = this.targetEntity;
    if (te) {
      const e = te.entity;
      const [dx, dy, dz] = this.direction();
      const hx = this.player.x + dx * te.t - e.x, hy = this.player.eyeY + dy * te.t - e.y, hz = this.player.z + dz * te.t - e.z;
      this.send({ t: 'interact', id: te.id, hx, hy, hz });
      this.onSwing();
      if (item && THROWN.test(item.k)) this.send({ t: 'use' });
      else if (item && !isPlaceable(this.world.palette, item.k)) { this.using = true; this.send({ t: 'use' }); }
      return;
    }
    if (t) {
      const P = this.world.palette;
      // Don't place a block inside ourselves (the server would refuse anyway)
      if (item && isPlaceable(P, item.k) && P.solid[P.index.get(item.k)]) {
        const replace = P.kind[t.id] === KIND_CROSS || P.names[t.id] === 'snow';
        const px = replace ? t.x : t.x + t.face[0];
        const py = replace ? t.y : t.y + t.face[1];
        const pz = replace ? t.z : t.z + t.face[2];
        if (this.intersectsPlayer(px, py, pz) && !this.isInteractive(P.names[t.id])) return;
      }
      this.send({ t: 'use_on', x: t.x, y: t.y, z: t.z, face: faceIndex(t.face), hx: t.hit[0], hy: t.hit[1], hz: t.hit[2] });
      this.lastUseOn = { x: t.x, y: t.y, z: t.z, face: t.face, at: performance.now() };   // sounds of what the server changes
      // Snowballs, eggs, pearls ... fly off with an arm swing, also when you look at a block
      if (item && THROWN.test(item.k) && !this.isInteractive(P.names[t.id])) {
        this.send({ t: 'use' });
        this.send({ t: 'swing' });   // so the others see the throw
        this.onSwing();
        return;
      }
      // Like Minecraft: food, potions, bows ... still get used when you look at a block
      if (item && !this.using && !isPlaceable(P, item.k) && !this.isInteractive(P.names[t.id])) {
        this.using = true;
        this.send({ t: 'use' });
        return;
      }
      this.onSwing();
      this.predictPlace(t, item);
      return;
    }
    if (item && THROWN.test(item.k)) {
      this.send({ t: 'use' });
      this.send({ t: 'swing' });
      this.onSwing();
      return;
    }
    if (item && !this.using) {
      this.using = true;
      this.send({ t: 'use' });
    }
  }

  /** Show a placed full block at once; the server confirms (or corrects) a moment later. */
  predictPlace(t, item) {
    const P = this.world.palette;
    if (!item || !isPlaceable(P, item.k)) return;
    const id = P.index.get(item.k);
    if (P.kind[id] !== KIND_CUBE || P.box[id] || !P.solid[id]) return;   // only simple full cubes
    if (this.isInteractive(P.names[t.id]) && !this.player.keys.has('ShiftLeft')) return;
    const replace = P.kind[t.id] === KIND_CROSS || P.names[t.id] === 'snow';
    const px = replace ? t.x : t.x + t.face[0], py = replace ? t.y : t.y + t.face[1], pz = replace ? t.z : t.z + t.face[2];
    const cur = this.world.getId(px, py, pz);
    if (cur !== 0 && P.kind[cur] !== KIND_LIQUID && P.kind[cur] !== KIND_CROSS) return;
    if (this.intersectsPlayer(px, py, pz)) return;
    this.world.setBlock(px, py, pz, id);
    this.onPlace?.(px, py, pz, id);
  }

  isInteractive(name) {
    return /door|gate|chest|barrel|table|furnace|smoker|button|lever|anvil|bed|shulker|hopper|dispenser|dropper|crafter/.test(name);
  }

  intersectsPlayer(bx, by, bz) {
    const p = this.player;
    return p.x + 0.3 > bx && p.x - 0.3 < bx + 1 && p.y + 1.8 > by && p.y < by + 1 && p.z + 0.3 > bz && p.z - 0.3 < bz + 1;
  }

  reset() {
    if (this.using) this.send({ t: 'release' });
    this.dig = null;
    this.using = false;
    this.leftDown = this.rightDown = false;
    this.showProgress(0);
    this.outline.visible = false;
  }
}
