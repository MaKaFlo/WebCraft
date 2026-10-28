// Block palette: the server sends one entry per block look/shape (it grows while you play).
import { tileFor, crossTile, atlas } from './textures.js';
import { textureCandidates, TINTED } from './texnames.js';

export const KIND_AIR = 0;
export const KIND_CUBE = 1;        // block drawn as a (possibly smaller) box
export const KIND_GLASS = 2;       // see-through box (glass, ice, portals)
export const KIND_CROSS = 3;       // plants, torches etc. drawn as an X
export const KIND_LIQUID = 4;      // water, lava

const FLAG_SOLID = 1;
const FLAG_OCCLUDING = 2;
const FLAG_LIQUID = 4;
// Facing from the server -> face index in world.js FACES (+x, -x, +y, -y, +z, -z)
const FACING = { east: 0, west: 1, south: 4, north: 5 };

// Non-solid blocks that should still be drawn as a flat box instead of an X
const BOXY = /carpet|^snow$|pressure_plate|rail$|portal|door|gate|ladder|pane$|bars$|sign$|banner$|button$|lever|lily_pad|repeater|comparator|redstone_wire|daylight|candle|cake|head$|skull$|flower_pot|frame$|tripwire_hook|tripwire$|scaffolding|chain|lantern|bed$|campfire|vine$|moss_carpet|pale_moss_carpet|leaf_litter/;

const COLOR_OVERRIDES = {
  water: 0x3f76e4, bubble_column: 0x3f76e4, lava: 0xe2671d,
  grass_block: 0x6aa84f, short_grass: 0x5f9e45, tall_grass: 0x5f9e45, fern: 0x588f3f,
  oak_leaves: 0x4a8a2a, birch_leaves: 0x6a9b45, spruce_leaves: 0x3d6b3d,
  dirt: 0x866043, sand: 0xdbd3a0, snow: 0xf4f8fa, snow_block: 0xf4f8fa,
  torch: 0xffd34d, wall_torch: 0xffd34d,
  coal_ore: 0x6e6e6e, deepslate_coal_ore: 0x4a4a4f,
  iron_ore: 0xa89482, deepslate_iron_ore: 0x6f6660,
  copper_ore: 0x9c7d62, deepslate_copper_ore: 0x6d5f55,
  gold_ore: 0xb5a066, deepslate_gold_ore: 0x7a7055,
  redstone_ore: 0xa06060, deepslate_redstone_ore: 0x704a4a,
  lapis_ore: 0x6a7aa6, deepslate_lapis_ore: 0x4a5577,
  diamond_ore: 0x7fb7b5, deepslate_diamond_ore: 0x557a7a,
  emerald_ore: 0x6fa57a, deepslate_emerald_ore: 0x4b7055,
  crafting_table: 0xa0784a,
  nether_portal: 0x8a2be2, end_portal: 0x0b1a24, end_gateway: 0x0b1a24,
};

export class Palette {
  constructor() {
    this.names = [];
    this.kind = [];
    this.solid = [];       // 1 = collides
    this.occluding = [];   // 1 = full opaque cube that hides faces behind it
    this.rgb = [];         // flat r,g,b per id
    this.alpha = [];
    this.box = [];         // drawn shape [x0,y0,z0,x1,y1,z1] or null for a full cube
    this.cbox = [];        // collision shape, or null (full cube if solid)
    this.boxes = [];       // drawn shape as several boxes, or null
    this.cboxes = [];      // collision shape as several boxes, or null
    this.height = [];      // top of the drawn shape (for outlines)
    this.glow = [];        // drawn without shading (portals, lava)
    this.fire = [];        // fire: drawn as burning walls
    this.facing = [];      // face index (world.js FACES) the block looks to, or -1
    this.lit = [];         // lit furnace, campfire, candle, redstone torch ... (particles)
    this.emit = [];        // block light 0..15 (torch 14, lava 15 ...)
    this.skyStop = [];     // sky light can't pass (full cubes, slabs, stairs: a floor over the whole cell)
    this.skyDim = [];      // sky light goes through but no longer counts as open sky (water, leaves, ice ...)
    this.tileFront = [];   // picture for that face ("_front"), or -1
    this.fluid = [];       // 1 water, 2 lava, 0 no liquid (several ids per fluid: one per water level)
    this.liquidH = [];     // surface height of a liquid block (source 0.89, flowing lower)
    this.liquidFall = [];  // falling water (a waterfall column)
    this.tileTop = [];
    this.tileSide = [];
    this.tileBottom = [];
    this.packed = [];      // bits: 1 top, 2 side, 4 bottom come from the texture pack (full color, no tint)
    this.index = new Map(); // block name -> first id
    this.grassId = -1;
    this.dirtRgb = [0x86 / 255, 0x60 / 255, 0x43 / 255];
  }

  get size() { return this.names.length; }

  add(start, entries) {
    for (let k = 0; k < entries.length; k++) this.set(start + k, entries[k]);
  }

  set(i, e) {
    const name = e.n;
    const f = e.f | 0;
    this.names[i] = name;
    if (!this.index.has(name)) this.index.set(name, i);
    if (name === 'grass_block' && this.grassId < 0) this.grassId = i;

    const solid = (f & FLAG_SOLID) !== 0;
    let kind;
    if (i === 0 || name === 'air') kind = KIND_AIR;
    else if (f & FLAG_LIQUID) kind = KIND_LIQUID;
    else if (/glass|^ice$|frosted_ice|nether_portal|end_gateway/.test(name)) kind = KIND_GLASS;
    else if (solid || BOXY.test(name)) kind = KIND_CUBE;
    else kind = KIND_CROSS;

    this.kind[i] = kind;
    this.solid[i] = solid ? 1 : 0;
    this.occluding[i] = (f & FLAG_OCCLUDING) && kind === KIND_CUBE ? 1 : 0;
    this.box[i] = e.r ? e.r : null;
    this.cbox[i] = e.b ? e.b : null;
    this.boxes[i] = e.rs || null;     // several boxes (stairs, fences ...) or null
    this.cboxes[i] = e.bs || null;
    this.height[i] = e.r ? e.r[4] : 1;
    this.glow[i] = /portal|end_gateway|lava|magma|glowstone|sea_lantern|shroomlight|^fire$|soul_fire|froglight/.test(name) ? 1 : 0;
    this.fire[i] = name === 'fire' || name === 'soul_fire' ? 1 : 0;
    this.facing[i] = FACING[e.fa] ?? -1;
    this.lit[i] = e.li ? 1 : 0;
    this.emit[i] = e.le | 0;
    const floor = kind === KIND_CUBE && solid && (e.rs || [e.r || FULL]).some((b) => b[0] <= 0 && b[2] <= 0 && b[3] >= 1 && b[5] >= 1);
    this.skyStop[i] = this.occluding[i] || (floor && !/leaves/.test(name)) ? 1 : 0;
    this.skyDim[i] = kind === KIND_LIQUID || /leaves|ice$|cobweb|slime_block|honey_block|bubble_column/.test(name) ? 1 : 0;
    this.fluid[i] = kind === KIND_LIQUID ? (name === 'lava' ? 2 : 1) : 0;
    this.liquidH[i] = e.lh ?? 0.875;
    this.liquidFall[i] = e.lf ? 1 : 0;
    this.applyTiles(i);

    let color = COLOR_OVERRIDES[name] ?? e.c;
    if (!color) color = /glass|ice/.test(name) ? 0xcfe8f0 : 0x9a9a9a;
    if (/_leaves$/.test(name) && COLOR_OVERRIDES[name] === undefined) color = 0x4a8a2a;
    this.rgb[i * 3] = ((color >> 16) & 255) / 255;
    this.rgb[i * 3 + 1] = ((color >> 8) & 255) / 255;
    this.rgb[i * 3 + 2] = (color & 255) / 255;

    let alpha = 1;
    if (kind === KIND_LIQUID) alpha = name === 'lava' ? 0.95 : 0.65;
    if (kind === KIND_GLASS) alpha = /portal|gateway/.test(name) ? 0.7 : /ice/.test(name) ? 0.75 : 0.35;
    this.alpha[i] = alpha;
  }

  /** Picks the texture tiles of one id: texture pack first, else the built-in patterns. */
  applyTiles(i) {
    const name = this.names[i];
    const kind = this.kind[i];
    const builtTop = kind === KIND_CROSS ? crossTile(name) : tileFor(name, true);
    const builtSide = kind === KIND_CROSS ? crossTile(name) : tileFor(name, false);
    const find = (...names) => {
      for (const n of names) {
        const t = atlas.packTile('block/' + n);
        if (t >= 0) return t;
      }
      return -1;
    };
    const names = textureCandidates(name);
    let top = find(...names.flatMap((n) => [n + '_top', n]));
    let side = find(...names.flatMap((n) => [n + '_side', n]));
    let bottom = find(...names.flatMap((n) => [n + '_bottom', n]));
    this.tileTop[i] = top >= 0 ? top : builtTop;
    this.tileSide[i] = side >= 0 ? side : builtSide;
    this.tileFront[i] = find(...names.map((n) => n + '_front'));
    this.tileBottom[i] = bottom >= 0 ? bottom : (top >= 0 && name !== 'grass_block' ? top : builtTop);
    let packed = (top >= 0 ? 1 : 0) | (side >= 0 ? 2 : 0) | (bottom >= 0 || (top >= 0 && name !== 'grass_block') ? 4 : 0);
    // Gray pictures of grass, leaves, water ... get the block color like in Minecraft
    if (TINTED.test(name)) {
      if (top >= 0 && atlas.isGray(top)) packed &= ~1;
      if (side >= 0 && atlas.isGray(side) && name !== 'grass_block') packed &= ~2;
      if (this.tileBottom[i] >= 0 && atlas.isGray(this.tileBottom[i]) && name !== 'grass_block') packed &= ~4;
    }
    this.packed[i] = packed;
  }

  /** After the texture pack changed. */
  refreshTiles() {
    for (let i = 0; i < this.names.length; i++) if (this.names[i] !== undefined) this.applyTiles(i);
  }

  /** All collision boxes of a block id (stairs have two), or null. */
  collisionBoxes(id) {
    if (!id || !this.solid[id]) return null;
    return this.cboxes[id] || [this.cbox[id] || FULL];
  }

  /** Collision box of a block id, or null if you can walk through it. */
  collision(id) {
    if (!id || !this.solid[id]) return null;
    return this.cbox[id] || FULL;
  }
}

export const FULL = [0, 0, 0, 1, 1, 1];
