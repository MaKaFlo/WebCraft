// Procedural block textures (own patterns, no Minecraft assets).
// Grayscale tiles in one atlas; the block color comes from vertex colors.
import * as THREE from 'three';

export const T = {
  NOISE: 0, PLANKS: 1, BARK: 2, RINGS: 3, LEAVES: 4, BRICKS: 5, ORE: 6, GLASS: 7,
  GRAIN: 8, COBBLE: 9, SMOOTH: 10, GRASS_TOP: 11, PLANT: 12, FLOWER: 13, WATER: 14, TABLE_TOP: 15,
};
const TILES = 16;
const PX = 16;

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function drawTile(ctx, tile) {
  const img = ctx.createImageData(PX, PX);
  const r = rng(tile * 977 + 13);
  const set = (x, y, v, a = 255) => {
    const i = (y * PX + x) * 4;
    v = Math.max(0, Math.min(255, v | 0));
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = a;
  };
  for (let y = 0; y < PX; y++) {
    for (let x = 0; x < PX; x++) {
      const n = r();
      let v = 255, a = 255;
      switch (tile) {
        case T.NOISE: v = 205 + n * 50; break;
        case T.GRAIN: v = 215 + n * 40 - (n > 0.92 ? 50 : 0); break;
        case T.SMOOTH: v = 240 + n * 15; break;
        case T.PLANKS: {
          const board = Math.floor(y / 4);
          v = 215 + n * 25 + ((board * 37) % 20);
          if (y % 4 === 3) v = 150;
          if ((x + board * 5) % 16 === 0 && y % 4 !== 3) v = 165;
          break;
        }
        case T.BARK: v = 200 + n * 35 - ((x * 7 + Math.floor(y / 3) * 3) % 5 === 0 ? 55 : 0); break;
        case T.RINGS: {
          const d = Math.hypot(x - 7.5, y - 7.5);
          v = (x === 0 || y === 0 || x === 15 || y === 15) ? 160 : 210 + n * 25 - (Math.floor(d) % 3 === 0 ? 35 : 0);
          break;
        }
        case T.LEAVES: v = n < 0.2 ? 120 : 200 + n * 55; break;
        case T.BRICKS: {
          const row = Math.floor(y / 4);
          const off = row % 2 ? 4 : 0;
          v = (y % 4 === 3 || (x + off) % 8 === 7) ? 235 : 185 + n * 30;
          break;
        }
        case T.ORE: {
          v = 205 + n * 40;
          const sx = (x * 5 + y * 3) % 7, sy = (x * 2 + y * 7) % 9;
          if (sx < 2 && sy < 3) v = 255;
          if (sx === 2 && sy < 3) v = 120;
          break;
        }
        case T.GLASS: {
          const edge = x === 0 || y === 0 || x === 15 || y === 15;
          v = edge ? 255 : 245;
          a = edge ? 255 : ((x - y === 3 || x - y === 4) && x > 3 && x < 12 ? 200 : 70);
          break;
        }
        case T.COBBLE: {
          const cx = Math.floor((x + (Math.floor(y / 5) % 2) * 3) / 5), cy = Math.floor(y / 5);
          const edge = (x + (Math.floor(y / 5) % 2) * 3) % 5 === 0 || y % 5 === 0;
          v = edge ? 140 : 190 + ((cx * 31 + cy * 17) % 40) + n * 20;
          break;
        }
        case T.GRASS_TOP: v = 200 + n * 50 - ((x * 3 + y * 5) % 7 === 0 ? 30 : 0); break;
        case T.PLANT: {
          // A few blades of grass, transparent around
          const blade = (x === 3 || x === 7 || x === 11 || x === 13) && y > (x * 3) % 8;
          const lean = (x === 5 || x === 9) && y > 4;
          a = blade || lean ? 255 : 0;
          v = 200 + n * 50;
          break;
        }
        case T.FLOWER: {
          const stem = x === 7 && y > 7;
          const head = Math.hypot(x - 7.5, y - 5) < 3.2;
          a = stem || head ? 255 : 0;
          v = head ? 255 - n * 30 : 150;
          break;
        }
        case T.WATER: v = 220 + Math.sin((x + y * 0.5) * 0.9) * 18 + n * 12; break;
        case T.TABLE_TOP: v = (x % 8 === 0 || y % 8 === 0) ? 140 : 215 + n * 30; break;
      }
      set(x, y, v, a);
    }
  }
  ctx.putImageData(img, tile * PX, 0);
}

// Atlas: a grid of 32x32 px tiles. Tiles 0..15 are the built-in patterns (grayscale, tinted by the
// block color), the rest are filled from the texture pack (full color, not tinted).
export const TILE_PX = 32;
const COLS = 64;            // 64 x 64 tiles: room for a full texture pack
const ATLAS_PX = TILE_PX * COLS;
export const FIRST_PACK_TILE = TILES;
const ANIM_COLS = 8;              // 8 x 8 animated textures

class Atlas {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvas.height = ATLAS_PX;
    this.ctx = this.canvas.getContext('2d');
    this.ctx.imageSmoothingEnabled = false;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.magFilter = THREE.NearestFilter;
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.generateMipmaps = false;
    this.texture.colorSpace = THREE.NoColorSpace;
    this.packTiles = new Map();   // "block/stone" -> tile index
    // Animated textures (fire, water, lava, portal ...) live in a small second atlas that is
    // redrawn when a frame changes; the big atlas keeps their first frame (for icons and models).
    this.animCanvas = document.createElement('canvas');
    this.animCanvas.width = this.animCanvas.height = ANIM_COLS * TILE_PX;
    this.animCtx = this.animCanvas.getContext('2d');
    this.animCtx.imageSmoothingEnabled = false;
    this.animTexture = new THREE.CanvasTexture(this.animCanvas);
    this.animTexture.magFilter = THREE.NearestFilter;
    this.animTexture.minFilter = THREE.NearestFilter;
    this.animTexture.generateMipmaps = false;
    this.animTexture.colorSpace = THREE.NoColorSpace;
    this.anims = [];              // { k, img, size, frames, t, cur }
    this.animOfTile = new Map();  // big-atlas tile -> anim slot
    const small = document.createElement('canvas');
    small.width = TILES * PX;
    small.height = PX;
    const sctx = small.getContext('2d');
    for (let t = 0; t < TILES; t++) drawTile(sctx, t);
    for (let t = 0; t < TILES; t++) this.ctx.drawImage(small, t * PX, 0, PX, PX, ...this.tileXY(t), TILE_PX, TILE_PX);
  }

  tileXY(tile) {
    return [(tile % COLS) * TILE_PX, Math.floor(tile / COLS) * TILE_PX];
  }

  /** images: Map path -> image/canvas (any size, drawn scaled to one tile; a tall strip = animation frames). */
  setPack(images, anims = {}) {
    this.anims = [];
    this.animOfTile.clear();
    this.animCtx.clearRect(0, 0, this.animCanvas.width, this.animCanvas.height);
    const [x0, y0] = this.tileXY(FIRST_PACK_TILE);
    // Clear everything after the built-in tiles
    this.ctx.clearRect(x0, y0, ATLAS_PX - x0, TILE_PX);
    this.ctx.clearRect(0, TILE_PX, ATLAS_PX, ATLAS_PX - TILE_PX);
    this.packTiles.clear();
    this.grayTiles = new Set();
    let tile = FIRST_PACK_TILE;
    for (const [path, img] of images) {
      if (tile >= COLS * COLS) break;
      const [x, y] = this.tileXY(tile);
      const w = img.width, h = img.height;
      const strip = h > w && h % w === 0;
      // First frame (or the whole square picture) into the big atlas
      this.ctx.drawImage(img, 0, 0, w, strip ? w : h, x, y, TILE_PX, TILE_PX);
      if (strip && this.anims.length < ANIM_COLS * ANIM_COLS) {
        const count = h / w;
        const info = anims[path] || {};
        const frames = (info.f && info.f.length ? info.f : [...Array(count).keys()]).filter((f) => f < count);
        const a = { k: this.anims.length, img, size: w, frames, t: Math.max(1, info.t || 1), cur: -1 };
        this.anims.push(a);
        this.animOfTile.set(tile, a.k);
      }
      if (isGrayImage(img, w, strip ? w : h)) this.grayTiles.add(tile);
      this.packTiles.set(path, tile++);
    }
    this.texture.needsUpdate = true;
  }

  /** Next frames of animated textures (call every frame; Minecraft counts 20 ticks per second). */
  animate(nowMs) {
    if (!this.anims.length) return;
    const tick = Math.floor(nowMs / 50);
    let changed = false;
    for (const a of this.anims) {
      const f = a.frames[Math.floor(tick / a.t) % a.frames.length];
      if (f === a.cur) continue;
      a.cur = f;
      const ax = (a.k % ANIM_COLS) * TILE_PX, ay = Math.floor(a.k / ANIM_COLS) * TILE_PX;
      this.animCtx.clearRect(ax, ay, TILE_PX, TILE_PX);
      this.animCtx.drawImage(a.img, 0, f * a.size, a.size, a.size, ax, ay, TILE_PX, TILE_PX);
      changed = true;
    }
    if (changed) this.animTexture.needsUpdate = true;
  }

  /** A pack picture without color (gets tinted for grass, leaves, water). */
  isGray(tile) {
    return this.grayTiles?.has(tile) ?? false;
  }

  /** Anim slot of a big-atlas tile, or undefined if it does not move. */
  animOf(tile) {
    return this.animOfTile.get(tile);
  }

  /** Tile of a pack texture, or -1. */
  packTile(path) {
    return this.packTiles.get(path) ?? -1;
  }

  /** Draws one tile into a 2D context. */
  drawTileTo(ctx, tile, x, y, w, h) {
    const [sx, sy] = this.tileXY(tile);
    ctx.drawImage(this.canvas, sx, sy, TILE_PX, TILE_PX, x, y, w, h);
  }
}

const probe = document.createElement('canvas');
probe.width = probe.height = 16;
const probeCtx = probe.getContext('2d', { willReadFrequently: true });

/** True if a picture has (almost) no color. */
function isGrayImage(img, w, h) {
  probeCtx.clearRect(0, 0, 16, 16);
  probeCtx.drawImage(img, 0, 0, w, h, 0, 0, 16, 16);
  const d = probeCtx.getImageData(0, 0, 16, 16).data;
  let sum = 0, n = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 20) continue;
    const mx = Math.max(d[i], d[i + 1], d[i + 2]), mn = Math.min(d[i], d[i + 1], d[i + 2]);
    sum += mx ? (mx - mn) / mx : 0;
    n++;
  }
  return n > 0 && sum / n < 0.26;   // only asked for grass, leaves, water ...
}

export const atlas = new Atlas();

/** Like tileUV, for a slot of the animation atlas. */
export function animUV(k, s, t) {
  const col = k % ANIM_COLS, row = Math.floor(k / ANIM_COLS);
  const inset = 0.02 / TILE_PX;
  return [(col + inset + s * (1 - 2 * inset)) / ANIM_COLS, 1 - (row + 1 - inset - t * (1 - 2 * inset)) / ANIM_COLS];
}

/** Texture coordinates of point (s, t) inside a tile (0..1 each, t = 0 is the bottom). */
export function tileUV(tile, s, t) {
  const col = tile % COLS, row = Math.floor(tile / COLS);
  const inset = 0.02 / TILE_PX;
  const u = (col + inset + s * (1 - 2 * inset)) / COLS;
  const v = 1 - (row + 1 - inset - t * (1 - 2 * inset)) / COLS;
  return [u, v];
}

/** Pick a texture tile for a block, per face (top/side). */
export function tileFor(name, top) {
  if (/glass/.test(name)) return T.GLASS;
  if (name === 'water' || name === 'lava' || name === 'bubble_column') return T.WATER;
  if (name === 'crafting_table') return top ? T.TABLE_TOP : T.PLANKS;
  if (/_log$|_wood$|_stem$|_hyphae$|basalt$/.test(name)) return top && /_log$|_stem$/.test(name) ? T.RINGS : T.BARK;
  if (/planks|_slab$|_stairs$|bookshelf|barrel|chest|_fence|_door|trapdoor|_sign$/.test(name) && /oak|spruce|birch|jungle|acacia|dark_oak|mangrove|cherry|bamboo|crimson|warped|pale|chest|barrel|bookshelf/.test(name)) return T.PLANKS;
  if (/leaves|azalea$/.test(name)) return T.LEAVES;
  if (/brick|tiles|chiseled/.test(name)) return T.BRICKS;
  if (/_ore$|ancient_debris/.test(name)) return T.ORE;
  if (/cobble|mossy_stone/.test(name)) return T.COBBLE;
  if (/sand|gravel|dirt|mud|clay|soul_soil|powder|farmland|path/.test(name)) return T.GRAIN;
  if (name === 'grass_block' && top) return T.GRASS_TOP;
  if (/wool|concrete|terracotta|quartz|smooth|snow|ice|iron_block|gold_block|diamond_block|emerald_block/.test(name)) return T.SMOOTH;
  return T.NOISE;
}

export function crossTile(name) {
  if (/tulip|dandelion|poppy|orchid|allium|azure|daisy|cornflower|lily_of|rose|flower|wither_rose|torch|mushroom/.test(name)) return T.FLOWER;
  return T.PLANT;
}
