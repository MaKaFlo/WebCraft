// Particles: block pieces (breaking and digging), flames and smoke of torches, furnaces and fires,
// and the particles the server sends (`fx`: hearts, explosions, potions, crits ...).
// All particles are camera-facing quads of one instanced mesh per texture (block atlas, particle sheet).
import * as THREE from 'three';
import { atlas, tileUV } from './textures.js';

const MAX = 3000;

const VERTEX = `
attribute vec4 posSize;   // world position, size
attribute vec4 uvRect;    // u0, v0, du, dv
attribute vec3 tint;
varying vec2 vUv;
varying vec3 vTint;
void main() {
  vec4 mv = modelViewMatrix * vec4(posSize.xyz, 1.0);
  mv.xy += position.xy * posSize.w;
  vUv = uvRect.xy + uv * uvRect.zw;
  vTint = tint;
  gl_Position = projectionMatrix * mv;
}`;
const FRAGMENT = `
uniform sampler2D map;
varying vec2 vUv;
varying vec3 vTint;
void main() {
  vec4 c = texture2D(map, vUv);
  if (c.a < 0.5) discard;
  gl_FragColor = vec4(c.rgb * vTint, 1.0);
}`;

// ---------------------------------------------------------------- particle sheet (8 x 8 cells of 8 px)

const CELL = 8, SHEET_COLS = 8;
const S = { DOT: 0, SMOKE: 1, SMOKE_BIG: 4, FLAME: 5, HEART: 6, NOTE: 7, BUBBLE: 8, DROP: 9, SPARK: 10, ANGRY: 11, SOUL: 12, STAR: 13, SQUARE: 14, GLYPH: 15 };

function drawSheet() {
  const c = document.createElement('canvas');
  c.width = c.height = CELL * SHEET_COLS;
  const g = c.getContext('2d');
  const px = (cell, pixels, color) => {
    const ox = (cell % SHEET_COLS) * CELL, oy = Math.floor(cell / SHEET_COLS) * CELL;
    g.fillStyle = color;
    pixels.forEach((row, y) => [...row].forEach((ch, x) => { if (ch !== '.') g.fillRect(ox + x, oy + y, 1, 1); }));
  };
  const grid = (s) => s.trim().split('\n').map((r) => r.trim());
  px(S.DOT, grid(`........\n........\n........\n...##...\n...##...\n........\n........\n........`), '#fff');
  // Smoke in growing sizes (white, tinted)
  px(S.SMOKE, grid(`........\n........\n...##...\n..####..\n..####..\n...##...\n........\n........`), '#fff');
  px(S.SMOKE + 1, grid(`........\n..###...\n.#####..\n.######.\n.######.\n..####..\n...##...\n........`), '#fff');
  px(S.SMOKE + 2, grid(`..####..\n.######.\n########\n########\n########\n########\n.######.\n..####..`), '#fff');
  px(S.SMOKE_BIG, grid(`.######.\n########\n########\n########\n########\n########\n########\n.######.`), '#fff');
  const flame = grid(`...#....\n...##...\n..###...\n..####..\n.#####..\n.######.\n.######.\n..####..`);
  px(S.FLAME, flame, '#ff9a1f');
  px(S.FLAME, grid(`........\n........\n........\n...#....\n...##...\n..###...\n..####..\n...##...`), '#ffe066');
  px(S.SOUL, flame, '#3fd6e0');
  px(S.SOUL, grid(`........\n........\n........\n...#....\n...##...\n..###...\n..####..\n...##...`), '#c8ffff');
  px(S.HEART, grid(`........\n.##.##..\n#######.\n#######.\n.#####..\n..###...\n...#....\n........`), '#ff2a3a');
  px(S.NOTE, grid(`...####.\n...#..#.\n...#..#.\n...#..#.\n.###.##.\n####.##.\n.##.....\n........`), '#fff');
  px(S.BUBBLE, grid(`........\n..###...\n.#...#..\n.#...#..\n.#...#..\n..###...\n........\n........`), '#fff');
  px(S.DROP, grid(`........\n...#....\n...#....\n..###...\n..###...\n...#....\n........\n........`), '#fff');
  px(S.SPARK, grid(`........\n...#....\n...#....\n.#####..\n...#....\n...#....\n........\n........`), '#fff');
  px(S.ANGRY, grid(`........\n.##..##.\n.###.##.\n..####..\n..####..\n.##.###.\n.##..##.\n........`), '#fff');
  px(S.STAR, grid(`...#....\n...#....\n..###...\n#######.\n..###...\n...#....\n...#....\n........`), '#fff');
  px(S.SQUARE, grid(`........\n.######.\n.######.\n.######.\n.######.\n.######.\n.######.\n........`), '#fff');
  px(S.GLYPH, grid(`........\n.#...#..\n.#.#.#..\n.#####..\n...#....\n..###...\n........\n........`), '#fff');
  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}

function sheetRect(cell) {
  const col = cell % SHEET_COLS, row = Math.floor(cell / SHEET_COLS);
  const n = 1 / SHEET_COLS;
  return [col * n, 1 - (row + 1) * n, n, n];
}

// ---------------------------------------------------------------- kinds of server particles
// cell, color (0xRRGGBB or [colors]), size, life (s), gravity (blocks/s²), drag per second, glow, rise (start vy)

const K = (cell, color, size, life, grav = 0, extra = {}) => ({ cell, color, size, life, grav, ...extra });
const KINDS = {
  flame: K(S.FLAME, 0xffffff, 0.1, 0.8, 0, { glow: true }),
  small_flame: K(S.FLAME, 0xffffff, 0.06, 0.6, 0, { glow: true }),
  soul_fire_flame: K(S.SOUL, 0xffffff, 0.1, 0.8, 0, { glow: true }),
  copper_fire_flame: K(S.SOUL, 0x8affb0, 0.1, 0.8, 0, { glow: true }),
  lava: K(S.SQUARE, [0xff7a10, 0xffb020], 0.08, 1.5, 12, { glow: true, rise: 2.5, spread: 1.5 }),
  smoke: K(S.SMOKE, 0x4a4a4a, 0.12, 1.2, -0.4, { grow: true }),
  large_smoke: K(S.SMOKE, 0x3a3a3a, 0.25, 1.6, -0.6, { grow: true }),
  white_smoke: K(S.SMOKE, 0xdddddd, 0.15, 1.2, -0.4, { grow: true }),
  campfire_cosy_smoke: K(S.SMOKE + 2, 0x9a9a9a, 0.4, 6, -0.25, { drag: 0.2 }),
  campfire_signal_smoke: K(S.SMOKE + 2, 0xb0b0b0, 0.45, 9, -0.3, { drag: 0.2 }),
  poof: K(S.SMOKE, 0xeeeeee, 0.2, 0.6, 0, { grow: true }),
  cloud: K(S.SMOKE, 0xffffff, 0.3, 1.0, -0.2, { grow: true }),
  explosion: K(S.SMOKE_BIG, [0xffffff, 0xd8d8d8, 0xaaaaaa], 1.2, 0.5, 0, { grow: true }),
  explosion_emitter: K(S.SMOKE_BIG, [0xffffff, 0xd8d8d8, 0xaaaaaa], 1.4, 0.6, 0, { grow: true, burst: 12, spread: 2 }),
  heart: K(S.HEART, 0xffffff, 0.2, 1.0, -0.6),
  angry_villager: K(S.ANGRY, 0x404040, 0.2, 1.0, -0.4),
  happy_villager: K(S.STAR, 0x40ff40, 0.12, 1.0, -0.2),
  composter: K(S.STAR, 0x80e040, 0.1, 1.0, -0.2),
  crit: K(S.SPARK, [0xffffff, 0xe0d0a0], 0.1, 0.6, 2),
  enchanted_hit: K(S.SPARK, [0x40e0ff, 0x8060ff], 0.1, 0.6, 2),
  enchant: K(S.GLYPH, [0xffffff, 0xd8c8ff], 0.08, 1.2, 0),
  portal: K(S.DOT, [0xb040ff, 0x8020e0, 0xe080ff], 0.1, 1.0, 0, { glow: true }),
  reverse_portal: K(S.DOT, [0xb040ff, 0xe080ff], 0.1, 1.0, 0, { glow: true }),
  witch: K(S.SPARK, 0xa040c0, 0.12, 1.0, -0.4),
  effect: K(S.SPARK, 0xffffff, 0.12, 1.0, -0.4),
  instant_effect: K(S.SPARK, 0xffffff, 0.12, 0.8, -0.4),
  entity_effect: K(S.SPARK, 0xffffff, 0.12, 1.0, -0.4),
  dust: K(S.SQUARE, 0xff0000, 0.08, 0.8, -0.2),
  dust_color_transition: K(S.SQUARE, 0xff0000, 0.08, 0.8, -0.2),
  bubble: K(S.BUBBLE, 0xd0e8ff, 0.08, 1.0, -2),
  bubble_pop: K(S.BUBBLE, 0xffffff, 0.1, 0.25, 0),
  bubble_column_up: K(S.BUBBLE, 0xd0e8ff, 0.08, 1.0, -4),
  current_down: K(S.BUBBLE, 0xd0e8ff, 0.08, 1.0, 3),
  splash: K(S.DROP, 0x4070ff, 0.08, 0.7, 12, { rise: 2.5, spread: 1.2 }),
  rain: K(S.DROP, 0x4070ff, 0.08, 0.3, 12),
  fishing: K(S.DROP, 0x8090ff, 0.08, 0.7, 6, { rise: 1.5 }),
  dripping_water: K(S.DROP, 0x4070ff, 0.07, 1.0, 12),
  falling_water: K(S.DROP, 0x4070ff, 0.07, 1.5, 12),
  dripping_lava: K(S.DROP, 0xff7010, 0.07, 1.0, 12, { glow: true }),
  falling_lava: K(S.DROP, 0xff7010, 0.07, 1.5, 12, { glow: true }),
  dripping_obsidian_tear: K(S.DROP, 0x8020ff, 0.07, 1.0, 12, { glow: true }),
  falling_obsidian_tear: K(S.DROP, 0x8020ff, 0.07, 1.5, 12, { glow: true }),
  note: K(S.NOTE, 'rainbow', 0.18, 1.2, -0.3),
  damage_indicator: K(S.HEART, 0x401010, 0.14, 0.8, 1.5, { rise: 1.2 }),
  sweep_attack: K(S.SMOKE_BIG, 0xf0f0f0, 0.9, 0.25, 0, { glow: true }),
  totem_of_undying: K(S.SPARK, [0x60e040, 0xe0e040, 0xc0a020], 0.12, 2.0, 2, { glow: true, rise: 3, spread: 3 }),
  snowflake: K(S.SPARK, 0xffffff, 0.08, 2.0, 1),
  end_rod: K(S.STAR, 0xffffff, 0.1, 2.0, -0.2, { glow: true }),
  firework: K(S.STAR, [0xffffff, 0xffe0a0], 0.12, 1.2, 1, { glow: true }),
  electric_spark: K(S.SPARK, 0xc0f0ff, 0.08, 0.4, 0, { glow: true }),
  wax_on: K(S.SPARK, 0xffb030, 0.1, 0.8, 0),
  wax_off: K(S.SPARK, 0xffffff, 0.1, 0.8, 0),
  scrape: K(S.SPARK, 0x40e0c0, 0.1, 0.8, 0),
  glow: K(S.SPARK, 0x80ffd0, 0.1, 1.2, 0, { glow: true }),
  soul: K(S.SOUL, 0xffffff, 0.15, 1.5, -0.5, { glow: true }),
  sculk_soul: K(S.SOUL, 0xffffff, 0.15, 1.5, -0.5, { glow: true }),
  squid_ink: K(S.SMOKE, 0x101010, 0.2, 1.0, 0),
  glow_squid_ink: K(S.SMOKE, 0x40ffd0, 0.2, 1.0, 0, { glow: true }),
  ash: K(S.DOT, 0x505050, 0.06, 4, 0.5),
  white_ash: K(S.DOT, 0xe0e0e0, 0.06, 4, 0.5),
  crimson_spore: K(S.DOT, 0xc03030, 0.06, 4, 0.2),
  warped_spore: K(S.DOT, 0x30c0c0, 0.06, 4, 0.2),
  spore_blossom_air: K(S.DOT, 0x60c040, 0.06, 6, 0.1),
  falling_spore_blossom: K(S.DOT, 0x60c040, 0.06, 3, 1),
  mycelium: K(S.DOT, 0x9080a0, 0.05, 1.5, 0.2),
  cherry_leaves: K(S.SQUARE, [0xffb0d0, 0xf090c0], 0.07, 5, 0.6),
  pale_oak_leaves: K(S.SQUARE, [0xc8c8c0, 0xa8a8a0], 0.07, 5, 0.6),
  tinted_leaves: K(S.SQUARE, 0x60a040, 0.07, 5, 0.6),
  falling_dust: K(S.SQUARE, 0xc0b080, 0.07, 2, 2),
  dragon_breath: K(S.SPARK, [0xc040ff, 0xff60ff], 0.12, 1.5, 0, { glow: true }),
  sonic_boom: K(S.SMOKE_BIG, 0x2080a0, 0.8, 0.4, 0, { glow: true }),
  gust: K(S.SMOKE_BIG, 0xe8f0ff, 0.6, 0.4, 0, { grow: true }),
  egg_crack: K(S.SQUARE, 0xf0f0e0, 0.06, 1, 8, { rise: 1 }),
  trial_spawner_detection: K(S.FLAME, 0xffffff, 0.1, 0.8, 0, { glow: true }),
  trial_spawner_detection_ominous: K(S.SOUL, 0xffffff, 0.1, 0.8, 0, { glow: true }),
  infested: K(S.SMOKE, 0x909090, 0.12, 1, 0),
  item_slime: K(S.SQUARE, 0x70c050, 0.07, 1, 8, { rise: 1.5 }),
  item_snowball: K(S.SQUARE, 0xf0f8ff, 0.07, 1, 8, { rise: 1.5 }),
  item_cobweb: K(S.SQUARE, 0xe0e0e0, 0.07, 1, 8, { rise: 1.5 }),
  item: K(S.SQUARE, 0x8a6a4a, 0.07, 1, 8, { rise: 1.5 }),
};
const DEFAULT_KIND = K(S.DOT, 0xffffff, 0.08, 0.8, 0);

const rnd = (a, b) => a + Math.random() * (b - a);
const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) * 0.8;
const hsl = new THREE.Color();

class System {
  constructor(scene, map) {
    const base = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index;
    geo.setAttribute('position', base.getAttribute('position'));
    geo.setAttribute('uv', base.getAttribute('uv'));
    this.posSize = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 4), 4);
    this.uvRect = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 4), 4);
    this.tint = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3);
    for (const a of [this.posSize, this.uvRect, this.tint]) a.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('posSize', this.posSize);
    geo.setAttribute('uvRect', this.uvRect);
    geo.setAttribute('tint', this.tint);
    geo.instanceCount = 0;
    this.mesh = new THREE.Mesh(geo, new THREE.ShaderMaterial({
      uniforms: { map: { value: map } }, vertexShader: VERTEX, fragmentShader: FRAGMENT,
    }));
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this.list = [];
  }

  add(p) {
    if (this.list.length >= MAX) this.list.shift();
    this.list.push(p);
  }

  update(dt, world) {
    const keep = [];
    for (const p of this.list) {
      p.age += dt;
      if (p.age >= p.life) continue;
      p.vy -= p.grav * dt;
      const drag = Math.pow(p.drag, dt);
      p.vx *= drag; p.vy *= drag; p.vz *= drag;
      const nx = p.x + p.vx * dt, ny = p.y + p.vy * dt, nz = p.z + p.vz * dt;
      // Pieces and drops land on blocks instead of falling through
      if (p.collide && p.vy < 0 && world.palette?.solid[world.getId(Math.floor(nx), Math.floor(ny - p.size / 2), Math.floor(nz))]) {
        p.vy = 0; p.vx *= 0.5; p.vz *= 0.5;
      } else p.y = ny;
      p.x = nx; p.z = nz;
      keep.push(p);
    }
    this.list = keep;
    const n = keep.length;
    const ps = this.posSize.array, uv = this.uvRect.array, ti = this.tint.array;
    for (let i = 0; i < n; i++) {
      const p = keep[i];
      const f = p.age / p.life;
      let size = p.size;
      if (p.grow) size *= 0.6 + f * 0.8;
      else if (p.shrink) size *= 1 - f * 0.7;
      ps[i * 4] = p.x; ps[i * 4 + 1] = p.y; ps[i * 4 + 2] = p.z; ps[i * 4 + 3] = size;
      let rect = p.rect;
      if (p.frames) rect = sheetRect(p.cell + Math.min(p.frames - 1, Math.floor(f * p.frames)));
      uv[i * 4] = rect[0]; uv[i * 4 + 1] = rect[1]; uv[i * 4 + 2] = rect[2]; uv[i * 4 + 3] = rect[3];
      ti[i * 3] = p.r; ti[i * 3 + 1] = p.g; ti[i * 3 + 2] = p.b;
    }
    this.mesh.geometry.instanceCount = n;
    if (n) { this.posSize.needsUpdate = true; this.uvRect.needsUpdate = true; this.tint.needsUpdate = true; }
  }
}

export class Particles {
  constructor(scene, world) {
    this.world = world;
    this.blocks = new System(scene, atlas.texture);
    this.sprites = new System(scene, drawSheet());
    this.brightness = 1;
  }

  get palette() { return this.world.palette; }

  update(dt, px, py, pz) {
    this.ambient(dt, px, py, pz);
    this.blocks.update(dt, this.world);
    this.sprites.update(dt, this.world);
  }

  /** A sheet particle. */
  sprite(kind, x, y, z, vx, vy, vz, color) {
    const k = KINDS[kind] ?? DEFAULT_KIND;
    let c = color ?? k.color;
    if (Array.isArray(c)) c = c[Math.floor(Math.random() * c.length)];
    if (c === 'rainbow') c = hsl.setHSL(Math.random(), 0.9, 0.55).getHex();
    const light = k.glow ? 1 : this.brightness;
    const frames = k.cell === S.SMOKE && k.grow ? 3 : 0;
    this.sprites.add({
      x, y, z, vx, vy, vz, age: 0, life: k.life * rnd(0.7, 1.3), size: k.size * rnd(0.8, 1.2),
      grav: k.grav, drag: k.drag ?? 0.4, grow: k.grow && !frames, shrink: !k.grow, cell: k.cell, frames,
      rect: sheetRect(k.cell), collide: k.grav > 0,
      r: ((c >> 16) & 255) / 255 * light, g: ((c >> 8) & 255) / 255 * light, b: (c & 255) / 255 * light,
    });
  }

  /** A small piece of a block's texture. */
  piece(id, x, y, z, vx, vy, vz, size = 0.09) {
    const P = this.palette;
    if (!P || !id) return;
    const tile = P.tileSide[id] >= 0 ? P.tileSide[id] : P.tileTop[id];
    if (tile === undefined || tile < 0) return;
    const s = Math.random() * 0.75, t = Math.random() * 0.75;
    const [u0, v0] = tileUV(tile, s, t);
    const [u1, v1] = tileUV(tile, s + 0.25, t + 0.25);
    const tinted = !(P.packed[id] & 2);
    const l = this.brightness;
    this.blocks.add({
      x, y, z, vx, vy, vz, age: 0, life: rnd(0.5, 1.2), size, grav: 16, drag: 0.6, shrink: false, collide: true,
      rect: [u0, v0, u1 - u0, v1 - v0],
      r: (tinted ? P.rgb[id * 3] : 1) * l, g: (tinted ? P.rgb[id * 3 + 1] : 1) * l, b: (tinted ? P.rgb[id * 3 + 2] : 1) * l,
    });
  }

  /** A block was broken: like Minecraft, a 4x4x4 cloud of its pieces. */
  breakBlock(x, y, z, id) {
    if (!id) return;
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) for (let k = 0; k < 4; k++) {
      if (Math.random() < 0.4) continue;
      const ox = (i + 0.5) / 4, oy = (j + 0.5) / 4, oz = (k + 0.5) / 4;
      this.piece(id, x + ox, y + oy, z + oz, (ox - 0.5) * rnd(2, 4), (oy - 0.5) * rnd(2, 4) + 1.5, (oz - 0.5) * rnd(2, 4), rnd(0.07, 0.12));
    }
  }

  /** While digging: a few pieces jump off the face that is being hit (n = face normal). */
  digHit(x, y, z, n, id) {
    n ??= [0, 1, 0];
    for (let i = 0; i < 2; i++) {
      const px = x + (n[0] ? (n[0] > 0 ? 1.05 : -0.05) : Math.random());
      const py = y + (n[1] ? (n[1] > 0 ? 1.05 : -0.05) : Math.random());
      const pz = z + (n[2] ? (n[2] > 0 ? 1.05 : -0.05) : Math.random());
      this.piece(id, px, py, pz, n[0] * 1 + rnd(-0.5, 0.5), n[1] + rnd(0.5, 1.5), n[2] * 1 + rnd(-0.5, 0.5), 0.06);
    }
  }

  /** `fx` message from the server: [kind, x, y, z, dx, dy, dz, speed, count, extra (block id or color)]. */
  serverList(list) {
    for (const e of list) this.server(...e);
  }

  server(kind, x, y, z, dx, dy, dz, speed, count, extra) {
    if (kind === 'break') { this.breakBlock(Math.floor(x), Math.floor(y), Math.floor(z), extra); return; }
    const k = KINDS[kind];
    const blockish = kind === 'block' || kind === 'block_marker' || kind === 'dust_pillar' || kind === 'block_crumble' || (kind === 'falling_dust' && extra > 0);
    const one = (px, py, pz, vx, vy, vz) => {
      if (blockish) this.piece(extra, px, py, pz, vx, vy + (kind === 'falling_dust' ? -0.5 : 1), vz, 0.08);
      else this.sprite(kind, px, py, pz, vx, vy + (k?.rise ?? 0) * Math.random(), vz, extra ?? undefined);   // extra = color
    };
    if (count === 0) {
      // One particle, the spread is its direction (like Minecraft)
      one(x, y, z, dx * speed * 20, dy * speed * 20, dz * speed * 20);
      return;
    }
    const n = Math.min(count * (k?.burst ?? 1), 80);
    const spread = k?.spread ?? 1;
    for (let i = 0; i < n; i++) {
      const v = speed * 20;
      one(x + gauss() * dx * 2, y + gauss() * dy * 2, z + gauss() * dz * 2,
        gauss() * v * spread, gauss() * v * spread, gauss() * v * spread);
    }
  }

  // ---------------------------------------------------------------- ambient (Minecraft's animateTick)

  ambient(dt, px, py, pz) {
    const P = this.palette;
    if (!P) return;
    const R = 12;
    const samples = Math.min(400, Math.round(15000 * dt));
    for (let i = 0; i < samples; i++) {
      const x = Math.floor(px + rnd(-R, R)), y = Math.floor(py + rnd(-R, R)), z = Math.floor(pz + rnd(-R, R));
      const id = this.world.getId(x, y, z);
      if (!id) continue;
      const fx = AMBIENT.get(P.names[id]);
      if (fx) fx(this, x, y, z, id, P);
    }
  }
}

const FACE_DIR = { 0: [1, 0], 1: [-1, 0], 4: [0, 1], 5: [0, -1] };
const torch = (flame) => (p, x, y, z) => {
  p.sprite('smoke', x + 0.5, y + 0.75, z + 0.5, 0, 0.3, 0);
  p.sprite(flame, x + 0.5, y + 0.72, z + 0.5, 0, 0, 0);
};
const wallTorch = (flame) => (p, x, y, z, id, P) => {
  // The flame leans away from the wall (Minecraft: 0.27 against the facing, 0.22 higher)
  const [fx, fz] = FACE_DIR[P.facing[id]] ?? [0, 0];
  const ox = x + 0.5 - 0.27 * fx, oz = z + 0.5 - 0.27 * fz;
  p.sprite('smoke', ox, y + 0.95, oz, 0, 0.3, 0);
  p.sprite(flame, ox, y + 0.92, oz, 0, 0, 0);
};
const furnace = (p, x, y, z, id, P) => {
  if (!P.lit?.[id] || Math.random() > 0.5) return;
  const [fx, fz] = FACE_DIR[P.facing[id]] ?? [0, 1];
  const side = rnd(-0.3, 0.3);
  const ox = x + 0.5 + fx * 0.52 + (fz ? side : 0), oz = z + 0.5 + fz * 0.52 + (fx ? side : 0);
  p.sprite('smoke', ox, y + rnd(0.1, 0.45), oz, 0, 0.2, 0);
  p.sprite('flame', ox, y + rnd(0.1, 0.45), oz, 0, 0, 0);
};
const AMBIENT = new Map([
  ['torch', torch('flame')],
  ['wall_torch', wallTorch('flame')],
  ['soul_torch', torch('soul_fire_flame')],
  ['soul_wall_torch', wallTorch('soul_fire_flame')],
  ['copper_torch', torch('copper_fire_flame')],
  ['copper_wall_torch', wallTorch('copper_fire_flame')],
  ['redstone_torch', (p, x, y, z, id, P) => { if (P.lit?.[id] && Math.random() < 0.5) p.sprite('dust', x + 0.5 + rnd(-0.1, 0.1), y + 0.75, z + 0.5 + rnd(-0.1, 0.1), 0, 0, 0, 0xff2010); }],
  ['furnace', furnace], ['smoker', furnace], ['blast_furnace', furnace],
  ['campfire', (p, x, y, z, id, P) => {
    if (!P.lit?.[id]) return;
    p.sprite('campfire_cosy_smoke', x + 0.5 + rnd(-0.3, 0.3), y + 0.6, z + 0.5 + rnd(-0.3, 0.3), 0, 0.6, 0);
    if (Math.random() < 0.2) p.sprite('lava', x + 0.5, y + 0.5, z + 0.5, rnd(-0.6, 0.6), 2, rnd(-0.6, 0.6));
  }],
  ['soul_campfire', (p, x, y, z, id, P) => {
    if (P.lit?.[id]) p.sprite('campfire_cosy_smoke', x + 0.5 + rnd(-0.3, 0.3), y + 0.6, z + 0.5 + rnd(-0.3, 0.3), 0, 0.6, 0);
  }],
  ['fire', (p, x, y, z) => { for (let i = 0; i < 2; i++) p.sprite('large_smoke', x + Math.random(), y + rnd(0.5, 1), z + Math.random(), 0, 0.2, 0); }],
  ['soul_fire', (p, x, y, z) => p.sprite('large_smoke', x + Math.random(), y + rnd(0.5, 1), z + Math.random(), 0, 0.2, 0)],
  ['lava', (p, x, y, z) => {
    if (Math.random() < 0.02 && !p.world.getId(x, y + 1, z)) p.sprite('lava', x + Math.random(), y + 1, z + Math.random(), rnd(-0.6, 0.6), 2, rnd(-0.6, 0.6));
  }],
  ['nether_portal', (p, x, y, z) => {
    for (let i = 0; i < 2; i++) p.sprite('portal', x + Math.random(), y + Math.random(), z + Math.random(), rnd(-0.5, 0.5), rnd(-0.5, 0.5), rnd(-0.5, 0.5));
  }],
  ['end_rod', (p, x, y, z) => { if (Math.random() < 0.2) p.sprite('end_rod', x + 0.5 + rnd(-0.2, 0.2), y + rnd(0.2, 0.8), z + 0.5 + rnd(-0.2, 0.2), rnd(-0.05, 0.05), rnd(-0.05, 0.05), rnd(-0.05, 0.05)); }],
  ['crying_obsidian', (p, x, y, z) => { if (Math.random() < 0.2 && !p.world.getId(x, y - 1, z)) p.sprite('dripping_obsidian_tear', x + Math.random(), y - 0.05, z + Math.random(), 0, 0, 0); }],
  ['spore_blossom', (p, x, y, z) => { p.sprite('falling_spore_blossom', x + Math.random(), y - 0.1, z + Math.random(), 0, 0, 0); }],
  ['cherry_leaves', (p, x, y, z) => { if (Math.random() < 0.1 && !p.world.getId(x, y - 1, z)) p.sprite('cherry_leaves', x + Math.random(), y - 0.1, z + Math.random(), rnd(-0.3, 0.3), 0, rnd(-0.3, 0.3)); }],
  ['pale_oak_leaves', (p, x, y, z) => { if (Math.random() < 0.05 && !p.world.getId(x, y - 1, z)) p.sprite('pale_oak_leaves', x + Math.random(), y - 0.1, z + Math.random(), rnd(-0.3, 0.3), 0, rnd(-0.3, 0.3)); }],
  ['mycelium', (p, x, y, z) => { if (Math.random() < 0.1) p.sprite('mycelium', x + Math.random(), y + 1.1, z + Math.random(), 0, 0, 0); }],
  ['redstone_ore', (p, x, y, z, id, P) => { if (P.lit?.[id]) p.sprite('dust', x + Math.random(), y + Math.random(), z + Math.random(), 0, 0, 0, 0xff2010); }],
  ['deepslate_redstone_ore', (p, x, y, z, id, P) => { if (P.lit?.[id]) p.sprite('dust', x + Math.random(), y + Math.random(), z + Math.random(), 0, 0, 0, 0xff2010); }],
  ['enchanting_table', (p, x, y, z) => { if (Math.random() < 0.3) p.sprite('enchant', x + 0.5 + rnd(-1.5, 1.5), y + 2, z + 0.5 + rnd(-1.5, 1.5), 0, -0.6, 0); }],
]);
for (const n of ['candle', 'white_candle', 'orange_candle', 'magenta_candle', 'light_blue_candle', 'yellow_candle', 'lime_candle', 'pink_candle',
  'gray_candle', 'light_gray_candle', 'cyan_candle', 'purple_candle', 'blue_candle', 'brown_candle', 'green_candle', 'red_candle', 'black_candle']) {
  AMBIENT.set(n, (p, x, y, z, id, P) => { if (P.lit?.[id]) p.sprite('small_flame', x + 0.5, y + 0.55, z + 0.5, 0, 0, 0); });
}
