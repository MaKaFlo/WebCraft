// Players, mobs and dropped items. Common mobs get textured models (skins.js, pictures from the texture
// pack); the others are simple block figures.
import * as THREE from 'three';
import { dimUnlit } from './sky.js';
import { blockMesh, itemModel } from './models.js';
import { MOBS } from './mobs.js';
import { buildSkin, hasSkin, skinLoaded, shieldModel } from './skins.js';

const SKIN = 0xd8a27a;
const HUMANOID = {
  player: { shirt: 0x3a8fb7, pants: 0x37406e, skin: SKIN },
  wc: { shirt: 0xf08a24, pants: 0x5a3d8a, skin: SKIN },
  zombie: { shirt: 0x2f8c8c, pants: 0x3b3f8f, skin: 0x5f9e45 },
  husk: { shirt: 0x8a7a4a, pants: 0x5a4a2a, skin: 0xa89a6a },
  drowned: { shirt: 0x3f8a8a, pants: 0x2a5a6a, skin: 0x5aa0a0 },
  zombie_villager: { shirt: 0x6a4a2a, pants: 0x4a3a2a, skin: 0x5f9e45 },
  skeleton: { shirt: 0xd8d8d8, pants: 0xc8c8c8, skin: 0xe8e8e8, thin: true },
  stray: { shirt: 0xb0c8c8, pants: 0x9ab0b0, skin: 0xd0e0e0, thin: true },
  wither_skeleton: { shirt: 0x2a2a2a, pants: 0x222222, skin: 0x333333, thin: true },
  bogged: { shirt: 0x7a8a5a, pants: 0x6a7a4a, skin: 0xb8c8a0, thin: true },
  villager: { shirt: 0x7a5230, pants: 0x7a5230, skin: 0xc89a7a },
  wandering_trader: { shirt: 0x2f4f9a, pants: 0x2f4f9a, skin: 0xc89a7a },
  witch: { shirt: 0x4a2a6a, pants: 0x3a2a4a, skin: 0x9ab07a },
  pillager: { shirt: 0x5a5a5a, pants: 0x3a3a4a, skin: 0x9a9a9a },
  vindicator: { shirt: 0x3a3a4a, pants: 0x2a2a3a, skin: 0x9a9a9a },
  evoker: { shirt: 0x2a2a3a, pants: 0x2a2a3a, skin: 0x9a9a9a },
  piglin: { shirt: 0x7a5a3a, pants: 0x5a3a2a, skin: 0xe8a8a0 },
  piglin_brute: { shirt: 0x3a2a1a, pants: 0x2a1a0a, skin: 0xe8a8a0 },
  zombified_piglin: { shirt: 0x7a5a3a, pants: 0x5a3a2a, skin: 0xd88a8a },
  enderman: { shirt: 0x161616, pants: 0x161616, skin: 0x161616, thin: true, eyes: 0xd070ff },
  iron_golem: { shirt: 0xd8d0c8, pants: 0xb8b0a8, skin: 0xd8d0c8 },
  snow_golem: { shirt: 0xf4f8fa, pants: 0xf4f8fa, skin: 0xe8902a },
  armor_stand: { shirt: 0xa07a4a, pants: 0xa07a4a, skin: 0xa07a4a, thin: true },
  warden: { shirt: 0x0a3a3a, pants: 0x0a2a2a, skin: 0x124a4a, eyes: 0x5af0f0 },
  creaking: { shirt: 0x4a3426, pants: 0x3a2a1e, skin: 0x5a4030, thin: true, eyes: 0xf08a24 },
  copper_golem: { shirt: 0xc87a4a, pants: 0xb06a3a, skin: 0xd88a5a, eyes: 0x2a6a8a },
  illusioner: { shirt: 0x2a3a6a, pants: 0x2a2a3a, skin: 0x9a9a9a },
  giant: { shirt: 0x2f8c8c, pants: 0x3b3f8f, skin: 0x5f9e45 },
  _generic: { shirt: 0x8a7a9a, pants: 0x6a5a7a, skin: 0xb8a8c8 },
};
const QUADRUPED = {
  cow: 0x7a5236, mooshroom: 0xa02020, pig: 0xf0a0a0, sheep: 0xeeeeee, horse: 0x8a5a2a, donkey: 0x7a6a5a,
  mule: 0x5a3a2a, wolf: 0xd8d0c8, cat: 0xc89a5a, ocelot: 0xe8c86a, fox: 0xe0782a, goat: 0xe8e0d8, llama: 0xd8c8a0,
  trader_llama: 0xd8c8a0, polar_bear: 0xf4f4f4, panda: 0xf4f4f4, camel: 0xd8a85a, sniffer: 0x9a3a2a,
  hoglin: 0xb87a5a, zoglin: 0xd89a8a, ravager: 0x5a5a5a, armadillo: 0xa87a6a, rabbit: 0xb89a7a,
  turtle: 0x5a9a4a, frog: 0x9a8a3a, axolotl: 0xf0a0c0, strider: 0xa03a3a,
  skeleton_horse: 0xd8d8d0, zombie_horse: 0x4a7a3a, cow_variant: 0x7a5236, _generic: 0x9a8aaa,
};
// Colors of mob variants ("var" from the server)
const VARIANTS = {
  mooshroom: { red: 0xa02020, brown: 0x8a5a3a },
  fox: { red: 0xe0782a, snow: 0xf0f0f0 },
  axolotl: { lucy: 0xf0a0c0, wild: 0x8a6a4a, gold: 0xe8c040, cyan: 0x80d0e0, blue: 0x4a5ae0 },
  parrot: { red: 0xe02a2a, blue: 0x2a5ae0, green: 0x4ac02a, cyan: 0x30c0d0, gray: 0xa0a0a0 },
  horse: { white: 0xf0f0f0, creamy: 0xe0c8a0, chestnut: 0xa0602a, brown: 0x6a4a2a, black: 0x2a2a2a, gray: 0x8a8a8a, dark_brown: 0x4a3020 },
  llama: { creamy: 0xe0c8a0, white: 0xf0f0f0, brown: 0x8a5a3a, gray: 0x9a9a9a },
  trader_llama: { creamy: 0xe0c8a0, white: 0xf0f0f0, brown: 0x8a5a3a, gray: 0x9a9a9a },
  rabbit: { brown: 0x9a7a5a, white: 0xf0f0f0, black: 0x2a2a2a, black_and_white: 0xe0e0e0, gold: 0xe8c060, salt_and_pepper: 0x9a8a7a, the_killer_bunny: 0xf0f0f0 },
  cat: { tabby: 0xb08050, black: 0x2a2a2a, red: 0xe08a3a, siamese: 0xe8dcc8, british_shorthair: 0x8a8a90, calico: 0xf0e0d0,
    persian: 0xe8c8a0, ragdoll: 0xf0f0f0, white: 0xf4f4f4, jellie: 0x9a9aa8, all_black: 0x1a1a1a },
  frog: { temperate: 0xd07a3a, warm: 0xe8e0c8, cold: 0x4a8a5a },
  wolf: { pale: 0xd8d0c8, ashen: 0xb0b0b0, black: 0x2a2a2a, chestnut: 0x8a5a3a, rusty: 0xb06a3a, snowy: 0xf4f4f4, spotted: 0xd8b890, striped: 0xb89a70, woods: 0x7a5a3a },
  cow: { temperate: 0x7a5236, warm: 0xb06a3a, cold: 0xa08a70 },
  pig: { temperate: 0xf0a0a0, warm: 0xc0704a, cold: 0xd8b0a0 },
  chicken: { temperate: 0xf4f4f4, warm: 0xd8a060, cold: 0xc8c0b0 },
};
// Villagers: shirt color by job
const JOBS = {
  armorer: 0x4a4a4a, butcher: 0xf0f0f0, cartographer: 0xe8e0c0, cleric: 0x8a3a8a, farmer: 0xc8a050, fisherman: 0x8a6a3a,
  fletcher: 0x6a8a3a, leatherworker: 0x8a5a2a, librarian: 0xf0f0f0, mason: 0x3a3a3a, shepherd: 0x9a6a3a, toolsmith: 0x3a3a3a,
  weaponsmith: 0x2a2a2a, nitwit: 0x4a7a3a,
};

/** What makes a mob look different (rebuild the model when it changes). */
const lookKey = (d) => [d.n, d.var, d.col, d.col2, d.sheared ? 1 : 0, d.hand, d.off, (d.arm || []).join(','), d.skin ? d.skin + (skinLoaded(d.skin) ? '+' : '') : ''].join('|');

// Extra parts for animals, so a cow, a pig and a horse don't all look the same
const ANIMAL_EXTRAS = {
  pig: { snout: 0xe08a8a },
  cow: { horns: 0xe8e0c8, spots: 0xf4f4f4 }, mooshroom: { horns: 0xe8e0c8, spots: 0xf4f4f4 }, goat: { horns: 0xb8b0a0, beard: 0xd8d0c8 },
  sheep: { wool: 0xf4f4f4 },
  wolf: { tail: 1, ears: 1, snout: 0xb8b0a8 }, fox: { tail: 0xf4f4f4, ears: 1, snout: 0xf4f4f4 },
  cat: { tail: 1, ears: 1 }, ocelot: { tail: 1, ears: 1 },
  horse: { neck: 1, tail: 0x3a2a1a, mane: 0x3a2a1a }, donkey: { neck: 1, tail: 1, ears: 1 }, mule: { neck: 1, tail: 1, ears: 1 },
  skeleton_horse: { neck: 1, tail: 1 }, zombie_horse: { neck: 1, tail: 1 },
  llama: { neck: 1, ears: 1 }, trader_llama: { neck: 1, ears: 1 }, camel: { neck: 1, hump: 1 },
  rabbit: { ears: 1, longEars: 1 }, polar_bear: { ears: 1 }, panda: { patches: 0x1a1a1a, ears: 1 },
  hoglin: { tusks: 0xf0e8d0 }, zoglin: { tusks: 0xf0e8d0 }, sniffer: { snout: 0x6a8a3a }, axolotl: { tail: 1 },
  turtle: { shell: 0x3a6a2a }, armadillo: { shell: 0x9a6a5a },
};
const BOX = {
  creeper: 0x4fbf3f, spider: 0x2a2420, cave_spider: 0x1a3a3a, slime: 0x6ac85a, magma_cube: 0x5a1a0a,
  chicken: 0xf4f4f4, bee: 0xf2c94c, bat: 0x3a2a2a, parrot: 0xe02a2a, squid: 0x2a3a5a, glow_squid: 0x2a8a8a,
  cod: 0xb8a07a, salmon: 0xa0402a, tropical_fish: 0xf08a24, pufferfish: 0xf2c94c, dolphin: 0x7a8aa0,
  ghast: 0xf4f4f4, blaze: 0xf2a02a, phantom: 0x3a4a7a, guardian: 0x6a9a8a, elder_guardian: 0xb8b0a0,
  silverfish: 0x8a8a8a, endermite: 0x3a2a4a, shulker: 0x8a5a8a, vex: 0x9ab0c8, allay: 0x6ad0f0,
  warden: 0x0a3a3a, breeze: 0x9ab0f0, wither: 0x1a1a1a, ender_dragon: 0x1a1a1a, end_crystal: 0xd070ff,
};

const SWING_TIME = 0.3;

function mat(color) {
  return new THREE.MeshLambertMaterial({ color });
}

/** Box with its pivot at the top center (so it can swing like a limb). */
function limb(w, h, d, color, y) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(0, -h / 2, 0);
  const m = new THREE.Mesh(g, mat(color));
  m.position.y = y;
  return m;
}

function nameTag(text, isGg) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const font = 'bold 36px ui-monospace, monospace';
  ctx.font = font;
  const w = Math.ceil(ctx.measureText(text).width) + 24;
  canvas.width = w; canvas.height = 52;
  ctx.font = font;
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(0, 0, w, 52);
  ctx.fillStyle = isGg ? '#ffb347' : '#ffffff';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 12, 27);
  const tex = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
  sprite.scale.set(w / 52 * 0.32, 0.32, 1);
  sprite.renderOrder = 10;
  return sprite;
}

function eyes(parent, y, z, color = 0x2b2b44, spread = 0.11) {
  const geo = new THREE.BoxGeometry(0.08, 0.06, 0.02);
  const m = new THREE.MeshBasicMaterial({ color });
  for (const ex of [-spread, spread]) {
    const e = new THREE.Mesh(geo, m);
    e.position.set(ex, y, z);
    parent.add(e);
  }
}

// Armor tints by material prefix
const ARMOR = [
  [/^leather/, 0x8a5a32], [/^chainmail/, 0x9a9a9a], [/^iron/, 0xd8d8d8], [/^golden/, 0xf2cf3c],
  [/^diamond/, 0x4fe0d6], [/^netherite/, 0x4a4248], [/^copper/, 0xd0784a], [/^turtle/, 0x4a9a3a],
];

function armorColor(key) {
  for (const [re, c] of ARMOR) if (re.test(key)) return c;
  return null;
}

/** Box around a limb (same top pivot), from `top` down `h` blocks. */
function shell(parentW, parentD, top, h, color, pad = 0.035) {
  const g = new THREE.BoxGeometry(parentW + pad * 2, h, parentD + pad * 2);
  g.translate(0, -top - h / 2, 0);
  return new THREE.Mesh(g, mat(color));
}

class Entity {
  constructor(d, palette) {
    this.palette = palette;
    this.swingT = 0;
    this.hurtT = 0;
    this.type = d.type;
    this.group = new THREE.Group();
    this.limbs = null;
    this.head = null;
    this.x = d.x; this.y = d.y; this.z = d.z;
    this.yaw = d.body ?? d.yaw ?? 0;
    this.headYaw = d.yaw ?? 0;
    this.pitch = d.pitch ?? 0;
    this.walk = 0;
    this.speed = 0;
    this.target = d;
    this.w = d.w || 0.6;
    this.h = d.h || 1.8;
    this.build(d);
    this.materials = [];
    this.group.traverse((o) => {
      if (o.material && o.material.color && !o.isSprite && !o.userData.noTint) this.materials.push([o.material, o.material.color.getHex()]);
    });
    this.spin = 0;
  }

  /** Lightning: a jagged white-blue bolt from high up to the ground. */
  buildLightning() {
    this.static = true;
    const pts = [];
    let x = 0, z = 0;
    for (let y = 0; y < 80; y += 4) {
      const nx = x + (Math.random() - 0.5) * 2.4, nz = z + (Math.random() - 0.5) * 2.4;
      pts.push(new THREE.Vector3(x, y, z), new THREE.Vector3(nx, y + 4, nz));
      x = nx; z = nz;
    }
    const bolt = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({ color: 0xe8f0ff, fog: false }));
    bolt.userData.noTint = true;
    this.group.add(bolt);
  }

  build(d) {
    this.lookKey = lookKey(d);
    if (d.type === 'label' || d.type === 'text_display') return this.buildLabel(d);
    if (d.type === 'falling_block' || d.type === 'block_display') return this.buildBlock(d);
    if (d.type === 'item_display') return this.buildItem(d);
    if (d.type === 'item') return this.buildItem(d);
    if (d.type === 'lightning_bolt') return this.buildLightning();
    if (d.proj) return this.buildProjectile(d);
    if (hasSkin(d) && this.buildSkinned(d)) return;
    if (d.type === 'player' || HUMANOID[d.type]) return this.buildHumanoid(d);
    if (QUADRUPED[d.type] !== undefined) return this.buildQuadruped(d);
    if (MOBS[d.type]) return this.buildParts(MOBS[d.type]);
    if (BOX[d.type] !== undefined) return this.buildBox(d);
    // Unknown (new) mob: a figure that fits its shape instead of a plain block
    if (d.type !== 'unknown' && this.h >= this.w * 1.3) return this.buildHumanoid({ ...d, type: '_generic' });
    return this.buildQuadruped({ ...d, type: '_generic' });
  }

  buildHumanoid(d) {
    let look = d.type === 'player' ? (d.wc ? HUMANOID.wc : HUMANOID.player) : HUMANOID[d.type];
    if ((d.type === 'villager' || d.type === 'zombie_villager') && JOBS[d.var] !== undefined) look = { ...look, shirt: JOBS[d.var] };
    // Scale to the real hitbox height (baby zombies, endermen ...). Players always 1.8: their hitbox
    // shrinks while sneaking or swimming, the model must not.
    const s = (d.type === 'player' ? 1.8 : this.h) / 1.8;
    const tw = look.thin ? 0.14 : 0.25;
    const root = new THREE.Group();
    root.scale.setScalar(s);
    const legL = limb(tw, 0.75, tw, look.pants, 0.75); legL.position.x = -0.125;
    const legR = limb(tw, 0.75, tw, look.pants, 0.75); legR.position.x = 0.125;
    const body = limb(0.5, 0.75, look.thin ? 0.2 : 0.25, look.shirt, 1.5);
    const armL = limb(tw, 0.75, tw, look.shirt, 1.5); armL.position.x = -0.375;
    const armR = limb(tw, 0.75, tw, look.shirt, 1.5); armR.position.x = 0.375;
    const head = new THREE.Group();
    head.position.y = 1.5;
    const hm = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), mat(look.skin));
    hm.position.y = 0.25;
    eyes(hm, 0.03, 0.255, look.eyes ?? 0x2b2b44);
    head.add(hm);
    root.add(legL, legR, body, armL, armR, head);
    // Zombies hold their arms forward
    if (/zombie|husk|drowned/.test(d.type)) { armL.rotation.x = -1.4; armR.rotation.x = -1.4; this.armsForward = true; }
    // Armor pieces sit on top of the limbs, so they move with them
    const arm = d.arm || [];
    const bd = look.thin ? 0.2 : 0.25;
    const helmet = arm[0] && armorColor(arm[0]);
    const chest = arm[1] && armorColor(arm[1]);
    const legs = arm[2] && armorColor(arm[2]);
    const boots = arm[3] && armorColor(arm[3]);
    if (helmet) {
      const hg = new THREE.BoxGeometry(0.58, 0.3, 0.58);
      const hmesh = new THREE.Mesh(hg, mat(helmet));
      hmesh.position.y = 0.38;
      head.add(hmesh);
    }
    if (chest) {
      body.add(shell(0.5, bd, 0, 0.75, chest, 0.04));
      armL.add(shell(tw, tw, 0, 0.32, chest, 0.04));
      armR.add(shell(tw, tw, 0, 0.32, chest, 0.04));
    }
    if (legs) {
      body.add(shell(0.5, bd, 0.55, 0.2, legs, 0.025));
      legL.add(shell(tw, tw, 0, 0.5, legs, 0.025));
      legR.add(shell(tw, tw, 0, 0.5, legs, 0.025));
    }
    if (boots) {
      legL.add(shell(tw, tw, 0.5, 0.25, boots, 0.045));
      legR.add(shell(tw, tw, 0.5, 0.25, boots, 0.045));
    }
    // The item in the hand, so you see what others are holding
    if (d.hand && this.palette) {
      const it = itemModel(this.palette, d.hand, 0.28, 0.5);
      if (it.userData.flat) {
        // Handle in the fist, the head of the tool pointing forward and up
        it.rotation.set(0, Math.PI / 2, Math.PI / 2);
        it.position.set(0, -0.55, 0.2);
      } else {
        it.position.set(0, -0.72, 0.1);
      }
      armR.add(it);
    }
    this.group.add(root);
    this.limbs = { legL, legR, armL, armR, body };
    this.root = root;
    this.head = head;
    this.headScale = s;
    if (d.n) {
      this.tag = nameTag(d.n, !!d.wc);
      this.tag.position.y = this.h + 0.35;
      this.group.add(this.tag);
    }
  }

  /** side 'L'/'R': that arm holds its shield in front of the body; null: shields back at the side. */
  blockPose(side) {
    if (!this.shields || !this.limbs) return;
    for (const k of ['L', 'R']) {
      const sh = this.shields[k];
      if (!sh) continue;
      if (k !== side) {
        if (sh.raised) (k === 'L' ? this.limbs.armL : this.limbs.armR).rotation.y = 0;
        sh.raised = false;
        sh.shield.rotation.set(0, sh.rest, 0);
        sh.shield.position.copy(sh.restPos);
        continue;
      }
      const arm = k === 'L' ? this.limbs.armL : this.limbs.armR;
      sh.raised = true;
      arm.rotation.set(-0.94, k === 'L' ? -0.52 : 0.52, 0);
      // Undo the arm's turn inside the hold group, so the picture faces the front
      const q = new THREE.Quaternion().setFromEuler(arm.rotation).invert();
      const flip = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI);
      sh.shield.quaternion.copy(flip).multiply(q).multiply(flip);
      sh.shield.position.set(k === 'L' ? -0.06 : 0.06, 0.1, 0.12);
    }
  }

  /** Textured mob with Minecraft proportions (skins.js). */
  buildSkinned(d) {
    const root = new THREE.Group();
    const r = buildSkin(d, root, { height: this.h });
    if (!r) return false;
    this.group.add(root);
    this.limbs = r.limbs;
    this.head = r.head;
    this.mcFrame = true;    // the model is turned half around x: head yaw goes the other way
    this.headScale = 1;
    if (this.limbs?.legL) this.root = root;
    if (/zombie|husk|drowned|giant/.test(d.type) && this.limbs?.armL) {
      this.limbs.armL.rotation.x = -1.4;
      this.limbs.armR.rotation.x = -1.4;
      this.armsForward = true;
    }
    // The items in both hands (the arm is in model pixels and upside down: turn back and scale to blocks)
    this.shields = {};
    const held = (key, arm, left) => {
      if (!key || !this.palette || !arm) return;
      const hold = new THREE.Group();
      hold.position.set(left ? 1 : -1, 10, -1);
      hold.rotation.x = Math.PI;
      hold.scale.setScalar(16);
      const shield = key === 'shield' && shieldModel();
      if (shield) {
        // At the outer side of the arm, picture to the front (+z in the hold group) and a little outward
        shield.position.set(left ? 0.1 : -0.1, 0.1, 0.05);
        shield.rotation.y = left ? 0.3 : -0.3;
        hold.add(shield);
        this.shields[left ? 'L' : 'R'] = { shield, hold, arm, rest: shield.rotation.y, restPos: shield.position.clone() };
      } else {
        const it = itemModel(this.palette, key, 0.28, 0.5);
        if (it.userData.flat) {
          it.rotation.set(0, Math.PI / 2, Math.PI / 2);
          it.position.set(0, 0.17, 0.2);
          if (left) it.scale.z = -1;   // mirrored in the left hand
        } else {
          it.position.set(0, 0, 0.1);
        }
        hold.add(it);
      }
      arm.add(hold);
    };
    held(d.hand, r.rightArm, false);
    held(d.off, r.leftArm, true);
    if (d.n) {
      this.tag = nameTag(d.n, !!d.wc);
      this.tag.position.y = (d.type === 'player' ? 1.8 : this.h) + 0.35;
      this.group.add(this.tag);
    }
    return true;
  }

  buildQuadruped(d) {
    const color = VARIANTS[d.type]?.[d.var] ?? (d.type === 'sheep' ? 0xd8c8b0 : QUADRUPED[d.type]);
    const h = this.h, w = this.w;
    const legH = h * 0.4;
    const bodyH = h * 0.4;
    const bodyL = Math.max(w * 1.5, 0.5);
    const body = new THREE.Mesh(new THREE.BoxGeometry(w * 0.9, bodyH, bodyL), mat(color));
    body.position.y = legH + bodyH / 2;
    const legs = [];
    for (const [lx, lz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const l = limb(w * 0.25, legH, w * 0.25, color, legH);
      l.position.x = lx * w * 0.3;
      l.position.z = lz * bodyL * 0.35;
      legs.push(l);
    }
    const head = new THREE.Group();
    head.position.set(0, legH + bodyH * 0.9, bodyL / 2);
    const hs = Math.min(w * 0.7, h * 0.45);
    const hm = new THREE.Mesh(new THREE.BoxGeometry(hs, hs, hs), mat(new THREE.Color(color).multiplyScalar(0.85).getHex()));
    hm.position.z = hs * 0.35;
    eyes(hm, hs * 0.1, hs / 2 + 0.01, 0x111111, hs * 0.25);
    head.add(hm);
    this.group.add(body, ...legs, head);
    this.limbs = { legs };
    this.head = head;
    this.headScale = 1;
    this.addAnimalExtras(d.type, { w, h, legH, bodyH, bodyL, hs, color, head, hm, d });
  }

  addAnimalExtras(type, m) {
    const x = ANIMAL_EXTRAS[type];
    if (!x) return;
    const { w, legH, bodyH, bodyL, hs, color, head, hm } = m;
    const darker = new THREE.Color(color).multiplyScalar(0.7).getHex();
    const box = (sw, sh, sd, px, py, pz, c, parent = this.group) => {
      const b = new THREE.Mesh(new THREE.BoxGeometry(sw, sh, sd), mat(c));
      b.position.set(px, py, pz);
      parent.add(b);
      return b;
    };
    const top = legH + bodyH;
    if (x.snout) box(hs * 0.5, hs * 0.35, hs * 0.2, 0, -hs * 0.15, hs * 0.85, x.snout, hm);
    if (x.horns) { box(hs * 0.12, hs * 0.3, hs * 0.12, -hs * 0.4, hs * 0.6, 0, x.horns, hm); box(hs * 0.12, hs * 0.3, hs * 0.12, hs * 0.4, hs * 0.6, 0, x.horns, hm); }
    if (x.beard) box(hs * 0.2, hs * 0.35, hs * 0.15, 0, -hs * 0.6, hs * 0.4, x.beard, hm);
    if (x.tusks) { box(hs * 0.1, hs * 0.35, hs * 0.1, -hs * 0.3, -hs * 0.2, hs * 0.55, x.tusks, hm); box(hs * 0.1, hs * 0.35, hs * 0.1, hs * 0.3, -hs * 0.2, hs * 0.55, x.tusks, hm); }
    if (x.ears) {
      const eh = x.longEars ? hs * 0.7 : hs * 0.3;
      box(hs * 0.2, eh, hs * 0.1, -hs * 0.3, hs * 0.5 + eh / 2, -hs * 0.1, color, hm);
      box(hs * 0.2, eh, hs * 0.1, hs * 0.3, hs * 0.5 + eh / 2, -hs * 0.1, color, hm);
    }
    if (x.spots) { box(w * 0.5, bodyH * 0.5, bodyL * 0.3, w * 0.21, legH + bodyH * 0.55, bodyL * 0.1, x.spots); box(w * 0.4, bodyH * 0.4, bodyL * 0.25, -w * 0.26, legH + bodyH * 0.45, -bodyL * 0.25, x.spots); }
    if (x.wool && !m.d.sheared) {
      // Wool in the sheep's color (pink sheep are pink); a bit of wool on the head too
      // Dye colors are dark next to the real wool textures, so lighten them a bit
      const wool = m.d.col !== undefined ? new THREE.Color(m.d.col).lerp(new THREE.Color(0xffffff), 0.25).getHex() : x.wool;
      box(w * 1.05, bodyH * 1.2, bodyL * 1.05, 0, legH + bodyH / 2, 0, wool);
      box(hs * 1.05, hs * 0.5, hs * 0.8, 0, hs * 0.35, -hs * 0.05, wool, hm);
    }
    if (x.patches) { box(w * 0.95, bodyH * 0.45, bodyL * 0.35, 0, legH + bodyH * 0.3, bodyL * 0.15, x.patches); }
    if (x.shell) box(w * 1.1, bodyH * 0.8, bodyL * 1.0, 0, legH + bodyH * 0.8, 0, x.shell);
    if (x.hump) box(w * 0.6, bodyH * 0.5, bodyL * 0.35, 0, top + bodyH * 0.2, 0, color);
    if (x.tail) {
      const tail = new THREE.Group();
      tail.position.set(0, top - bodyH * 0.15, -bodyL / 2);
      const t = new THREE.Mesh(new THREE.BoxGeometry(w * 0.18, w * 0.18, bodyL * 0.45), mat(x.tail === 1 ? darker : x.tail));
      t.position.z = -bodyL * 0.22;
      tail.rotation.x = 0.5;
      tail.add(t);
      this.group.add(tail);
      this.tail = tail;
    }
    if (x.neck) {
      // Long neck: move the head up and forward
      head.position.y += hs * 0.9;
      head.position.z += hs * 0.2;
      box(hs * 0.55, hs * 1.3, hs * 0.55, 0, legH + bodyH + hs * 0.35, bodyL / 2 - hs * 0.1, color);
      if (x.mane) box(hs * 0.2, hs * 1.4, hs * 0.5, 0, legH + bodyH + hs * 0.45, bodyL / 2 - hs * 0.4, x.mane);
    }
  }

  /** Mob made of parts from mobs.js (creeper, spider, chicken, fish ...). */
  buildParts(spec) {
    const px = spec.basis === 'w' ? this.w / (spec.mw / 16) : this.h / (spec.mh / 16);
    const root = new THREE.Group();
    root.scale.setScalar(px / 16);
    const spin = new THREE.Group(), spin2 = new THREE.Group();
    root.add(spin, spin2);
    this.moving = { legs: [], wings: [], tents: [], tails: [], slegs: [], arms: [], spin, spin2 };
    const addPart = (parent, [w, h, dd, x, y, z, color, kind, extra]) => {
      const g = new THREE.BoxGeometry(w, h, dd);
      const m = mat(color);
      if (extra?.alpha) { m.transparent = true; m.opacity = extra.alpha; m.depthWrite = false; }
      const mesh = new THREE.Mesh(g, m);
      if (kind === 'leg' || kind === 'tent' || kind === 'arm') {
        g.translate(0, -h / 2, 0);
        mesh.position.set(x, y, z);
        (kind === 'leg' ? this.moving.legs : kind === 'tent' ? this.moving.tents : this.moving.arms).push(mesh);
      } else if (kind === 'wing') {
        const side = Math.sign(x) || 1;
        g.translate(side * w / 2, 0, 0);
        mesh.position.set(x - side * w / 2, y, z);
        mesh.userData.side = side;
        this.moving.wings.push(mesh);
      } else if (kind === 'tail') {
        g.translate(0, 0, -dd / 2);
        mesh.position.set(x, y, z + dd / 2);
        this.moving.tails.push(mesh);
      } else {
        mesh.position.set(x, y, z);
        if (kind === 'sleg') { mesh.rotation.z = extra?.rz || 0; mesh.userData.i = extra?.i || 0; this.moving.slegs.push(mesh); }
      }
      (kind === 'spin' ? spin : kind === 'spin2' ? spin2 : parent).add(mesh);
      return mesh;
    };
    for (const part of spec.parts) addPart(root, part);
    if (spec.head) {
      const head = new THREE.Group();
      head.position.set(...spec.head.pivot);
      for (const part of spec.head.parts) addPart(head, part);
      root.add(head);
      this.head = head;
      this.headScale = 1;
    }
    this.group.add(root);
    this.time = Math.random() * 10;
  }

  /** Wings flap, tentacles wave, tails wag ... (for models from mobs.js). */
  animateParts(dt) {
    const m = this.moving;
    this.time += dt;
    const t = this.time;
    const walk = Math.sin(this.walk) * Math.min(1, this.speed / 3);
    m.legs.forEach((l, i) => { l.rotation.x = (i % 4 === 0 || i % 4 === 3 ? 1 : -1) * walk * 0.7; });
    m.slegs.forEach((l) => { l.rotation.y = Math.sin(this.walk * 1.5 + l.userData.i * 1.3) * 0.25 * Math.min(1, this.speed / 2 + 0.2); });
    m.wings.forEach((w) => { w.rotation.z = w.userData.side * Math.sin(t * (this.type === 'bee' ? 40 : 12)) * 0.6; });
    m.tents.forEach((p, i) => { p.rotation.x = Math.sin(t * 2.5 + i) * 0.25; p.rotation.z = Math.cos(t * 2 + i * 1.7) * 0.15; });
    m.tails.forEach((p, i) => { p.rotation.y = Math.sin(t * 4 - i * 0.8) * 0.3; });
    m.arms.forEach((p, i) => { p.rotation.x = -0.5 + Math.sin(t * 3 + i) * 0.2; });
    m.spin.rotation.y = t * 1.2;
    m.spin2.rotation.y = -t * 1.6;
  }

  buildBox(d) {
    const color = BOX[d.type] ?? 0x9a7aaa;
    const body = new THREE.Mesh(new THREE.BoxGeometry(this.w, this.h, this.w), mat(color));
    body.position.y = this.h / 2;
    eyes(body, this.h * 0.25, this.w / 2 + 0.01, d.type === 'creeper' ? 0x111111 : 0x2b2b44, this.w * 0.2);
    this.group.add(body);
    this.bob = d.type === 'slime' || d.type === 'magma_cube';
  }

  /** Floating text (holograms, text displays, name tags of invisible armor stands). */
  buildLabel(d) {
    const lines = String(d.txt || '').split('\n').slice(0, 8);
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const font = 'bold 34px ui-monospace, monospace';
    ctx.font = font;
    const w = Math.ceil(Math.max(...lines.map((l) => ctx.measureText(l).width), 10)) + 24;
    const lh = 42;
    canvas.width = w; canvas.height = lh * lines.length + 8;
    ctx.font = font;
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(0, 0, w, canvas.height);
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    lines.forEach((l, i) => ctx.fillText(l, w / 2, 4 + lh * i + lh / 2));
    const tex = new THREE.CanvasTexture(canvas);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false }));
    const scale = 0.25 * (d.sy || 1);
    sprite.scale.set(w / lh * scale, canvas.height / lh * scale, 1);
    sprite.position.y = (d.ty || 0) + canvas.height / lh * scale / 2;
    sprite.renderOrder = 10;
    this.group.add(sprite);
    this.static = true;
  }

  /** A block as an entity (falling sand, block displays). */
  buildBlock(d) {
    const sx = d.sx || 1, sy = d.sy || 1, sz = d.sz || 1;
    const m = this.palette && d.b !== undefined ? blockMesh(this.palette, d.b, sx, sy, sz)
      : new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat(0xcccccc));
    // Falling blocks are centered, displays start at their corner
    if (d.type === 'falling_block') m.position.y = 0.5;
    else m.position.set((d.tx || 0) + sx / 2, (d.ty || 0) + sy / 2, (d.tz || 0) + sz / 2);
    this.group.add(m);
    this.blockMesh = m;
    this.static = d.type === 'block_display';
  }

  /** Arrows, thrown items (wind charge, snowball, pearl, potion ...), fireballs. */
  buildProjectile(d) {
    if (d.k && this.palette) {
      const m = itemModel(this.palette, d.k, 0.25, 0.4);
      m.position.y = 0.15;
      this.group.add(m);
      this.itemMesh = m;
      this.baseY = 0.15;
      this.projSpin = true;
      if (d.type === 'wind_charge') {
        // a little white swirl around it
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.03, 4, 12), new THREE.MeshBasicMaterial({ color: 0xe0f0ff, transparent: true, opacity: 0.7 }));
        ring.position.y = 0.15;
        ring.userData.noTint = true;
        this.group.add(ring);
        this.swirl = ring;
      }
      return;
    }
    // Arrow: shaft, tip and feathers, turned into its flying direction
    const arrow = new THREE.Group();
    const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.5), mat(0x8a6a3a));
    const tip = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.08), mat(0x9a9a9a));
    tip.position.z = 0.27;
    const fl = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.01, 0.12), mat(0xf4f4f4));
    fl.position.z = -0.2;
    const fl2 = fl.clone();
    fl2.rotation.z = Math.PI / 2;
    arrow.add(shaft, tip, fl, fl2);
    arrow.position.y = 0.1;
    this.group.add(arrow);
    this.arrowMesh = arrow;
  }

  buildItem(d) {
    const scale = d.type === 'item_display' ? (d.sx || 1) * 2 : 1;
    // Like Minecraft's "ground" display: flat items half a block, blocks a quarter
    const m = d.k ? itemModel(this.palette, d.k, 0.25 * scale, 0.5 * scale)
      : new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.25, 0.25), mat(0xcccccc));
    m.position.y = m.userData.flat ? 0.3 : 0.2;
    this.baseY = m.position.y;
    this.group.add(m);
    this.itemMesh = m;
  }

  update(dt) {
    const t = this.exact ? 1 : 1 - Math.exp(-dt * 12);   // our own figure (F5) sits exactly where we are
    const px = this.x, py = this.y, pz = this.z;
    const d = this.target;
    this.x += (d.x - this.x) * t;
    this.y += (d.y - this.y) * t;
    this.z += (d.z - this.z) * t;
    const turn = (from, to) => from + ((((to - from + 540) % 360) - 180) * t);
    this.yaw = turn(this.yaw, d.body ?? d.yaw ?? this.yaw);
    this.headYaw = turn(this.headYaw, d.yaw ?? this.headYaw);
    this.pitch += ((d.pitch ?? 0) - this.pitch) * t;

    const v = Math.hypot(this.x - px, this.z - pz) / Math.max(dt, 1e-3);
    this.speed += (Math.min(v, 6) - this.speed) * Math.min(1, dt * 8);
    this.walk += dt * this.speed * 2.4;
    let swing = Math.sin(this.walk) * Math.min(1, this.speed / 4) * 0.8;
    // Velocity in blocks per tick (elytra wings open wider the flatter you fly)
    const k = Math.min(1, dt * 6);
    this.vel ??= [0, 0, 0];
    [this.x - px, this.y - py, this.z - pz].forEach((m, i) => { this.vel[i] += (m / Math.max(dt, 1e-3) / 20 - this.vel[i]) * k; });
    if (d.gl) swing = 0;

    if (this.limbs?.legL) {
      this.limbs.legL.rotation.x = swing;
      this.limbs.legR.rotation.x = -swing;
      if (!this.armsForward) {
        this.limbs.armL.rotation.x = -swing;
        this.limbs.armR.rotation.x = swing;
      }
      // Shield raised: the arm forward and inward, the shield turned to face the front (Minecraft's BLOCK pose)
      const blocking = d.use && (d.uo ? d.off : d.hand) === 'shield';
      this.blockPose(blocking ? (d.uo ? 'L' : 'R') : null);
      if (!blocking && d.use && this.swingT <= 0) {
        if (d.hand === 'trident') {
          // Trident ready to throw: arm up over the head (Minecraft's THROW_TRIDENT pose)
          this.limbs.armR.rotation.x = -2.9;
          this.limbs.armR.rotation.z = 0;
        } else if (/_spear$/.test(d.hand || '')) {
          // Spear: arm forward and low, like a lance
          this.limbs.armR.rotation.x = -1.1;
          this.limbs.armR.rotation.z = 0.1;
        } else {
          this.limbs.armR.rotation.x = -1.3 + Math.sin(performance.now() / 70) * 0.08;
          this.limbs.armR.rotation.z = -0.3;
        }
      }
      // Arm swing when hitting or using something
      if (this.swingT > 0) {
        this.swingT = Math.max(0, this.swingT - dt);
        const p = 1 - this.swingT / SWING_TIME;
        const base = this.armsForward ? -1.4 : 0;
        this.limbs.armR.rotation.x = base - Math.sin(p * Math.PI) * 1.5;
        this.limbs.armR.rotation.z = Math.sin(p * Math.PI) * 0.35;
      } else if (!d.use) {
        this.limbs.armR.rotation.z = 0;
      }
      this.limbs.body.rotation.x = d.sn && !d.gl ? 0.45 : 0;
      // Swimming: lying flat, head forward, centered on the hitbox. Gliding: lying along where you look
      if (this.root) {
        const lie = d.gl ? Math.PI / 2 + Math.max(-1.2, Math.min(1.4, this.pitch * Math.PI / 180)) : d.sw ? Math.PI / 2 : 0;
        this.root.rotation.x = lie;
        this.root.position.set(0, d.sw || d.gl ? 0.3 : 0, d.sw || d.gl ? -0.9 * this.headScale : 0);
      }
      if (d.gl) {
        // Arms along the body, a bit apart, legs straight (Minecraft's elytra pose)
        this.limbs.armL.rotation.set(0, 0, -0.2);
        this.limbs.armR.rotation.set(0, 0, 0.2);
        this.limbs.legL.rotation.set(0, 0, -0.05);
        this.limbs.legR.rotation.set(0, 0, 0.05);
      } else if (this.wasGliding) {
        for (const l of [this.limbs.armL, this.limbs.armR, this.limbs.legL, this.limbs.legR]) { l.rotation.y = 0; l.rotation.z = 0; }
      }
      this.wasGliding = !!d.gl;
      if (this.limbs.wingL) {
        // Minecraft's ElytraModel: folded on the back, spread out while gliding (less when diving), tucked in when sneaking
        let rx = 0.2618, rz = -0.2618, ry = 0, wy = 0;
        if (d.gl) {
          const vy = d.vy ?? this.vel[1];
          const len = Math.hypot(this.vel[0], vy, this.vel[2]);
          const f = vy < 0 && len > 0 ? 1 - Math.pow(Math.min(1, -vy / len), 1.5) : 1;
          rx = f * 0.349 + (1 - f) * rx;
          rz = f * -Math.PI / 2 + (1 - f) * rz;
        } else if (d.sn) {
          rx = 0.698; rz = -0.785; ry = 0.087; wy = 3;
        }
        const w = Math.min(1, dt * 10), L = this.limbs.wingL, R = this.limbs.wingR;
        L.rotation.x += (rx - L.rotation.x) * w; L.rotation.y += (ry - L.rotation.y) * w; L.rotation.z += (rz - L.rotation.z) * w;
        R.rotation.x = L.rotation.x; R.rotation.y = -L.rotation.y; R.rotation.z = -L.rotation.z;
        L.position.y = R.position.y = wy;
      }
    } else if (this.limbs?.legs) {
      this.limbs.legs.forEach((l, i) => { l.rotation.x = (i === 0 || i === 3 ? 1 : -1) * swing; });
    }

    this.group.position.set(this.x, this.y - (d.sn ? 0.15 : 0), this.z);
    if (this.static) {
      this.group.rotation.y = d.type === 'block_display' ? -(d.yaw || 0) * Math.PI / 180 : 0;
      return;
    }
    if (d.type === 'falling_block') return;
    if (d.proj) {
      // Projectiles fly fast: follow the server position closely and point along the velocity
      this.x += (d.x - this.x) * Math.min(1, dt * 25);
      this.y += (d.y - this.y) * Math.min(1, dt * 25);
      this.z += (d.z - this.z) * Math.min(1, dt * 25);
      this.group.position.set(this.x, this.y, this.z);
      if (this.arrowMesh && (d.vx || d.vy || d.vz)) {
        const h = Math.hypot(d.vx, d.vz);
        this.arrowMesh.rotation.set(-Math.atan2(d.vy, h), Math.atan2(d.vx, d.vz), 0, 'YXZ');
      }
      if (this.projSpin) { this.spin += dt * 8; this.itemMesh.rotation.y = this.spin; }
      if (this.swirl) { this.swirl.rotation.x += dt * 9; this.swirl.rotation.y += dt * 5; }
      return;
    }
    if (d.type === 'item' && Entities.itemPhysics) {
      // Item physics mod: the item lies flat on the ground, turned a bit differently for each item
      this.group.rotation.y = ((d.i * 2654435761) % 360) * Math.PI / 180;
      if (this.itemMesh.userData.flat) { this.itemMesh.rotation.set(-Math.PI / 2, 0, 0); this.itemMesh.position.y = 0.02; }
      else { this.itemMesh.rotation.set(0, 0, 0); this.itemMesh.position.y = 0.125; }
    } else if (d.type === 'item' || d.type === 'item_display') {
      if (this.itemMesh.rotation.x) this.itemMesh.rotation.set(0, 0, 0);
      this.spin += dt * 2;
      this.group.rotation.y = this.spin;
      this.itemMesh.position.y = this.baseY + Math.sin(this.spin * 1.5) * 0.05;
    } else {
      this.group.rotation.y = -this.yaw * Math.PI / 180;
      if (this.head) {
        this.head.rotation.y = (this.mcFrame ? 1 : -1) * (this.headYaw - this.yaw) * Math.PI / 180;
        // Swimming: look ahead; gliding: the head looks along the body, which already points where you look
        this.head.rotation.x = d.gl && this.root ? -Math.PI / 2 : this.pitch * Math.PI / 180 - (d.sw && this.root ? Math.PI / 2 : 0);
      }
      if (this.bob) this.group.scale.y = 1 + Math.abs(Math.sin(this.walk)) * 0.15;
      if (this.moving) this.animateParts(dt);
      if (this.tail) this.tail.rotation.y = Math.sin(this.walk * 2) * 0.4 * Math.min(1, this.speed / 2 + 0.3);
    }
    // Red flash when hurt, fall over when dead
    this.hurtT = Math.max(0, this.hurtT - dt);
    const red = this.hurtT > 0 || d.dead;
    for (const [m, base] of this.materials) {
      if (red) m.color.setHex(base).lerp(new THREE.Color(Entities.hitColor), 0.6);
      else m.color.setHex(base);
    }
    this.group.rotation.z = d.dead ? Math.PI / 2 : 0;
  }

  /** Ray vs. hitbox (axis-aligned box around the entity). Returns distance or -1. */
  hit(ox, oy, oz, dx, dy, dz) {
    // Test against where the entity is drawn, so you hit what you see
    const hw = this.w / 2;
    const min = [this.x - hw, this.y, this.z - hw];
    const max = [this.x + hw, this.y + this.h, this.z + hw];
    const o = [ox, oy, oz], dir = [dx, dy, dz];
    let t0 = 0, t1 = Infinity;
    for (let a = 0; a < 3; a++) {
      if (Math.abs(dir[a]) < 1e-9) {
        if (o[a] < min[a] || o[a] > max[a]) return -1;
        continue;
      }
      let ta = (min[a] - o[a]) / dir[a], tb = (max[a] - o[a]) / dir[a];
      if (ta > tb) [ta, tb] = [tb, ta];
      t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
      if (t0 > t1) return -1;
    }
    return t0;
  }

  dispose(scene) {
    scene.remove(this.group);
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material && !o.material.userData.shared) { if (o.material.map && !o.material.userData.keepMap) o.material.map.dispose(); o.material.dispose(); }
    });
  }
}

/** Color mobs flash in when hit (treffer-farbe mod). */
export class Entities {
  static hitColor = 0xff3030;
  static itemPhysics = false;   // item physics mod

  constructor(scene) {
    this.scene = scene;
    this.map = new Map();
    this.palette = null;
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x8a8a8a, 2.6);
    scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffffff, 0.8);
    this.sun.position.set(0.4, 1, 0.25);
    scene.add(this.sun);
  }

  /** Day/night: mobs get as dark as the blocks around them. */
  setBrightness(b) {
    this.brightness = b;
    this.hemi.intensity = 2.6 * b;
    this.sun.intensity = 0.8 * b;
    for (const e of this.map.values()) this.light(e);
  }

  /** Darkens one mob like the blocks where it stands (caves, under roofs; torches light it up). */
  light(e) {
    const b = this.brightness ?? 1;
    const p = e.group.position;
    const l = this.world ? this.world.brightnessAt(p.x, p.y + 0.5, p.z, b) : b;
    const q = Math.round(l * 40) / 40;
    if (e.shownLight !== q || e.shownDay !== b) {
      e.shownLight = q; e.shownDay = b;
      dimUnlit(e.group, q, Math.min(1, q / Math.max(b, 0.05)));
    }
  }

  /** Server sends the full list of nearby entities a few times per second. */
  sync(list) {
    const seen = new Set();
    for (const d of list) {
      seen.add(d.i);
      let e = this.map.get(d.i);
      // Rebuild when the type or the hologram text changed
      if (e && (e.type !== d.type || (d.txt !== undefined && e.target.txt !== d.txt) ||
        (e.lookKey !== undefined && e.lookKey !== lookKey(d)))) { this.disposeOne(e); e = null; }
      if (!e) {
        if (d.type === 'lightning_bolt') this.onLightning?.(d);
        e = new Entity(d, this.palette);
        this.map.set(d.i, e);
        this.scene.add(e.group);
        e.lightT = 0;
      }
      e.target = d;
    }
    for (const [id, e] of this.map) {
      if (!seen.has(id)) { this.disposeOne(e); this.map.delete(id); }
    }
  }

  update(dt) {
    const all = this.self ? [...this.map.values(), this.self] : this.map.values();
    for (const e of all) {
      e.update(dt);
      e.lightT = (e.lightT ?? 0) - dt;
      if (e.lightT <= 0) { e.lightT = 0.3 + Math.random() * 0.1; this.light(e); }
      if (this.showHitboxes) this.hitbox(e);
      else if (e.hitbox) e.hitbox.visible = false;
    }
  }

  /** Like Minecraft's F3+B: a white box around every entity and a blue line where it looks. */
  hitbox(e) {
    const d = e.target;
    if (!e.hitbox) {
      const w = d.w || e.w || 0.6, h = d.h || e.h || 1.8;
      const box = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(w, h, w).translate(0, h / 2, 0)),
        new THREE.LineBasicMaterial({ color: 0xffffff }));
      const eye = h * 0.85;
      const look = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, 2)]),
        new THREE.LineBasicMaterial({ color: 0x3050ff }));
      look.position.y = eye;
      look.rotation.order = 'YXZ';
      box.add(look);
      box.userData.look = look;
      e.hitbox = box;
      this.scene.add(box);
    }
    e.hitbox.visible = !e.hidden;
    e.hitbox.position.set(e.x, e.y, e.z);
    const look = e.hitbox.userData.look;
    look.visible = !e.static && !d.proj && d.type !== 'item';
    look.rotation.set((e.pitch || 0) * Math.PI / 180, -(e.headYaw || 0) * Math.PI / 180, 0);
  }

  /** Third person (F5): our own figure from our data (null: hide it). */
  showSelf(d) {
    if (!d) {
      if (this.self) { this.disposeOne(this.self); this.self = null; }
      return;
    }
    if (this.self && this.self.lookKey !== lookKey(d)) { this.disposeOne(this.self); this.self = null; }
    if (!this.self) {
      this.self = new Entity(d, this.palette);
      this.self.exact = true;
      this.self.lookKey = lookKey(d);
      this.self.lightT = 0;
      this.scene.add(this.self.group);
    }
    this.self.target = d;
  }

  disposeOne(e) {
    if (e.hitbox) { this.scene.remove(e.hitbox); e.hitbox.geometry.dispose(); e.hitbox = null; }
    e.dispose(this.scene);
  }

  /** Animations from the server: [entity id, kind] (0 swing, 1 hurt, 3 offhand swing, 4/5 crit). */
  anim(list) {
    for (const [id, kind] of list) {
      const e = this.map.get(id);
      if (!e) continue;
      if (kind === 0 || kind === 3) e.swingT = SWING_TIME;
      else if (kind === 1) e.hurtT = 0.35;
    }
  }

  /** Throw away all models (they are rebuilt with the next update), e.g. after new textures. */
  rebuild() {
    this.clear();
  }

  /** Closest living entity along the ray within maxDist. */
  raycast(ox, oy, oz, dx, dy, dz, maxDist) {
    let best = null, bestT = maxDist;
    for (const [id, e] of this.map) {
      if (e.type === 'item' || e.static || e.type === 'falling_block' || e.type === 'item_display' || e.target.dead || e.target.proj) continue;
      const t = e.hit(ox, oy, oz, dx, dy, dz);
      if (t >= 0 && t < bestT) { bestT = t; best = { id, t, entity: e }; }
    }
    return best;
  }

  playerNames() {
    return [...this.map.values()].filter((e) => e.type === 'player').map((e) => ({ n: e.target.n, wc: !!e.target.wc }));
  }

  clear() {
    for (const e of this.map.values()) this.disposeOne(e);
    this.showSelf(null);
    this.map.clear();
  }
}
