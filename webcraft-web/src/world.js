// Chunk storage and meshing (blocks -> three.js geometry).
import * as THREE from 'three';
import { KIND_AIR, KIND_CUBE, KIND_GLASS, KIND_CROSS, KIND_LIQUID, FULL } from './palette.js';
import { atlas, tileUV, animUV } from './textures.js';

const S = 16;
const SECTION_VOLUME = S * S * S;

// Faces: normal n, tangents u/v with u x v = n (so (0,1,2),(0,2,3) is counter-clockwise)
const FACES = [
  { n: [1, 0, 0], u: [0, 1, 0], v: [0, 0, 1], shade: 0.80 },
  { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0], shade: 0.80 },
  { n: [0, 1, 0], u: [0, 0, 1], v: [1, 0, 0], shade: 1.00 },
  { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1], shade: 0.55 },
  { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0], shade: 0.68 },
  { n: [0, 0, -1], u: [0, 1, 0], v: [1, 0, 0], shade: 0.68 },
];
const CORNERS = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
const AO_LEVELS = [0.5, 0.68, 0.84, 1.0];

export const chunkKey = (cx, cz) => cx + ',' + cz;

function hash3(x, y, z) {
  let h = (x * 374761393 + y * 668265263 + z * 1274126177) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) & 1023) / 1023;
}

/** Ray against a box in block-local coordinates. Returns { t, face } or null. */
function rayBox(ox, oy, oz, dx, dy, dz, b) {
  let t0 = -Infinity, t1 = Infinity, face = null;
  const o = [ox, oy, oz], d = [dx, dy, dz];
  for (let a = 0; a < 3; a++) {
    const lo = b[a], hi = Math.min(b[a + 3], a === 1 ? 1.5 : 1);
    if (Math.abs(d[a]) < 1e-9) {
      if (o[a] < lo || o[a] > hi) return null;
      continue;
    }
    let ta = (lo - o[a]) / d[a], tb = (hi - o[a]) / d[a];
    let n = -Math.sign(d[a]);
    if (ta > tb) [ta, tb] = [tb, ta];
    if (ta > t0) { t0 = ta; face = [0, 0, 0]; face[a] = n; }
    t1 = Math.min(t1, tb);
    if (t0 > t1) return null;
  }
  if (t1 < 0 || !face) return null;
  return { t: Math.max(t0, 0), face };
}

class GeoBuilder {
  constructor() { this.pos = []; this.col = []; this.uv = []; this.idx = []; this.light = []; this.sky = []; }
  get empty() { return this.idx.length === 0; }
  /** light: block light per corner (0..1), or null for none; sky: sky light per corner (0..1), null = open sky. */
  quad(p, c, flip, uv, light = null, sky = null) {
    const base = this.pos.length / 3;
    for (let i = 0; i < 4; i++) {
      this.pos.push(p[i][0], p[i][1], p[i][2]);
      this.col.push(c[i][0], c[i][1], c[i][2], c[i][3]);
      this.uv.push(uv[i][0], uv[i][1]);
      this.light.push(light ? light[i] : 0);
      this.sky.push(sky ? sky[i] : 1);
    }
    if (flip) this.idx.push(base + 1, base + 2, base + 3, base + 1, base + 3, base);
    else this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 4));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('light', new THREE.Float32BufferAttribute(this.light, 1));
    g.setAttribute('sky', new THREE.Float32BufferAttribute(this.sky, 1));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

// Minecraft's brightness for light levels 0..15 (also between levels: corners average them), with the
// game's default brightness setting (halfway between "moody" and "bright")
const lightCurve = (level) => {
  const f = level / 15, x = f / (4 - 3 * f);
  return (x + 1 - (1 - x) ** 4) / 2;
};

/** World materials: vertex colors times max(sky brightness x sky light, warm block light, a little cave ambient). */
const skyUniform = { value: 1 };
function withBlockLight(mat) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uSky = skyUniform;
    shader.vertexShader = 'attribute float light;\nattribute float sky;\nvarying float vLight;\nvarying float vSkyL;\n' + shader.vertexShader
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLight = light;\nvSkyL = sky;');
    shader.fragmentShader = 'uniform float uSky;\nvarying float vLight;\nvarying float vSkyL;\n' + shader.fragmentShader
      .replace('#include <color_fragment>', '#include <color_fragment>\n'
        + 'diffuseColor.rgb *= max(vec3(max(uSky * vSkyL, 0.05)), vec3(vLight, vLight * 0.9, vLight * 0.75));');
  };
  return mat;
}

const R = 48;   // light region: the section and its 26 neighbours
export { lightCurve };

export class World {
  constructor(scene) {
    this.scene = scene;
    this.chunks = new Map();       // key -> { cx, cz, sections: Map<sy, Uint16Array>, meshes: Map<sy, Mesh[]>, meshed }
    this.dirty = new Set();        // "cx,cz,sy" sections waiting for (re)meshing
    this.palette = null;
    this.minY = -64;
    this.maxY = 320;
    this.viewDistance = 6;
    this.center = { cx: 0, cz: 0 };

    const map = atlas.texture;
    // alphaTest so see-through pixels of pack textures (leaves, doors ...) are really holes
    this.matOpaque = withBlockLight(new THREE.MeshBasicMaterial({ vertexColors: true, map, alphaTest: 0.5 }));
    this.matCross = withBlockLight(new THREE.MeshBasicMaterial({ vertexColors: true, map, side: THREE.DoubleSide, alphaTest: 0.5 }));
    this.matTrans = withBlockLight(new THREE.MeshBasicMaterial({
      vertexColors: true, map, transparent: true, side: THREE.DoubleSide, depthWrite: false,
    }));
    // Ice: see-through, but it writes depth and only shows its outside, so the faces of an ice sheet
    // don't shine through each other in random order (drawn before water and glass)
    this.matIce = withBlockLight(new THREE.MeshBasicMaterial({ vertexColors: true, map, transparent: true, depthWrite: true }));
    // Same, with the atlas of animated textures (fire, water, lava ...)
    const amap = atlas.animTexture;
    this.matAnimOpaque = withBlockLight(new THREE.MeshBasicMaterial({ vertexColors: true, map: amap, alphaTest: 0.5 }));
    this.matAnimCross = withBlockLight(new THREE.MeshBasicMaterial({ vertexColors: true, map: amap, side: THREE.DoubleSide, alphaTest: 0.5 }));
    this.matAnimTrans = withBlockLight(new THREE.MeshBasicMaterial({
      vertexColors: true, map: amap, transparent: true, side: THREE.DoubleSide, depthWrite: false,
    }));
    this.lightIds = new Uint16Array(R * R * R);
    this.lightLevels = new Uint8Array(R * R * R);
    this.lightQueue = new Int32Array(R * R * R);
    this.skyLevels = new Uint8Array(R * R * R);
    this.skyQueue = new Int32Array(R * R * R);
    this.skyTops = new Int16Array(R * R);
    this.hasSky = true;
  }

  /** Only the overworld has sky light (nether and end stay as they are). */
  setEnv(env) {
    this.hasSky = env === 'NORMAL';
  }

  /** Day/night: all block materials get darker (1 = full daylight). */
  setBrightness(b) {
    skyUniform.value = b;
  }

  /** Number of light-giving blocks in a section (cached until the section changes). */
  emitters(c, sy) {
    c.emit ??= new Map();
    let n = c.emit.get(sy);
    if (n === undefined) {
      n = 0;
      const sec = c.sections.get(sy);
      const E = this.palette?.emit;
      if (sec && E) for (let i = 0; i < SECTION_VOLUME; i++) if (E[sec[i]]) n++;
      c.emit.set(sy, n);
    }
    return n;
  }

  emittersAround(cx, cz, sy) {
    let n = 0;
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      const c = this.chunks.get(chunkKey(cx + dx, cz + dz));
      if (c) for (let dy = -1; dy <= 1; dy++) n += this.emitters(c, sy + dy);
    }
    return n;
  }

  /** World y of the first cell from which the column is open sky (one above the highest block that stops or dims sky light). */
  columnTop(c, x, z) {
    const P = this.palette;
    const ys = c.sortedY ??= [...c.sections.keys()].sort((a, b) => b - a);
    for (const sy of ys) {
      const sec = c.sections.get(sy);
      for (let y = 15; y >= 0; y--) {
        const id = sec[(y * S + z) * S + x];
        if (P.skyStop[id] || P.skyDim[id]) return sy * 16 + y + 1;
      }
    }
    return this.minY;
  }

  /** Sky heights of a chunk per column (z * 16 + x), cached. */
  heights(c) {
    if (!c.top) {
      c.top = new Int16Array(256);
      for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) c.top[z * 16 + x] = this.columnTop(c, x, z);
    }
    return c.top;
  }

  /** The section and its neighbours need new light (a light block or a wall near one changed). */
  markLightAround(cx, cz, sy) {
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) {
      const c = this.chunks.get(chunkKey(cx + dx, cz + dz));
      if (c && c.meshed && c.sections.has(sy + dy)) this.dirty.add((cx + dx) + ',' + (cz + dz) + ',' + (sy + dy));
    }
  }

  /**
   * Light like Minecraft for the 3x3x3 sections around one section (index ((y * R) + z) * R + x, the
   * section starts at 16,16,16). block: flood fill from every light block, one level less per step, not
   * through full opaque blocks; null when no light block is near. sky: 15 in open sky (above the column's
   * top), flooding sideways and down under roofs and into caves; a number when it is the same everywhere.
   */
  computeLight(cx, cz, sy) {
    const needBlock = this.emittersAround(cx, cz, sy) > 0;
    const y0 = (sy - 1) * 16;
    let sky = 15;
    const H = this.skyTops;
    if (this.hasSky) {
      const own = this.chunks.get(chunkKey(cx, cz));
      let lo = Infinity, hi = -Infinity;
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
        // A missing neighbour (edge of the view) is taken as like this chunk
        const t = this.heights(this.chunks.get(chunkKey(cx + dx, cz + dz)) || own);
        const bx = (dx + 1) * 16, bz = (dz + 1) * 16;
        for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
          const v = t[z * 16 + x];
          H[(bz + z) * R + bx + x] = v;
          if (v < lo) lo = v;
          if (v > hi) hi = v;
        }
      }
      if (hi <= y0) sky = 15;            // open sky everywhere
      else if (lo >= y0 + R) sky = 0;    // deep down: no open sky in reach
      else sky = this.skyLevels;
    }
    if (!needBlock && sky !== this.skyLevels) return { block: null, sky };

    const P = this.palette, ids = this.lightIds, lv = this.lightLevels, q = this.lightQueue;
    ids.fill(0); lv.fill(0);
    let head = 0, tail = 0;
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      const c = this.chunks.get(chunkKey(cx + dx, cz + dz));
      if (!c) continue;
      for (let dy = -1; dy <= 1; dy++) {
        const sec = c.sections.get(sy + dy);
        if (!sec) continue;
        const bx = (dx + 1) * 16, by = (dy + 1) * 16, bz = (dz + 1) * 16;
        for (let y = 0; y < 16; y++) for (let z = 0; z < 16; z++) {
          const src = (y * S + z) * S, dst = ((by + y) * R + bz + z) * R + bx;
          for (let x = 0; x < 16; x++) {
            const id = sec[src + x];
            ids[dst + x] = id;
            const e = P.emit[id];
            if (needBlock && e) { lv[dst + x] = e; q[tail++] = dst + x; }
          }
        }
      }
    }
    if (sky === this.skyLevels) this.floodSky(y0);
    if (!needBlock) return { block: null, sky };
    const occ = P.occluding;
    while (head < tail) {
      const i = q[head++];
      const l = lv[i] - 1;
      if (l <= 0) continue;
      const x = i % R, z = ((i / R) | 0) % R, y = (i / (R * R)) | 0;
      const spread = (j) => { if (lv[j] < l && !occ[ids[j]]) { lv[j] = l; q[tail++] = j; } };
      if (x > 0) spread(i - 1);
      if (x < R - 1) spread(i + 1);
      if (z > 0) spread(i - R);
      if (z < R - 1) spread(i + R);
      if (y > 0) spread(i - R * R);
      if (y < R - 1) spread(i + R * R);
    }
    return { block: lv, sky };
  }

  /** Sky light of the region whose ids are in lightIds and column tops in skyTops (y0: world y of the region's bottom). */
  floodSky(y0) {
    const P = this.palette, ids = this.lightIds, sl = this.skyLevels, q = this.skyQueue, H = this.skyTops;
    const stop = P.skyStop;
    sl.fill(0);
    let head = 0, tail = 0;
    for (let z = 0; z < R; z++) for (let x = 0; x < R; x++) {
      const col = z * R + x, top = H[col];
      // Neighbour columns that are covered lower than here get light from the side
      const side = Math.max(x > 0 ? H[col - 1] : 0, x < R - 1 ? H[col + 1] : 0, z > 0 ? H[col - R] : 0, z < R - 1 ? H[col + R] : 0);
      for (let y = Math.max(0, top - y0); y < R; y++) {
        const i = (y * R + z) * R + x;
        if (stop[ids[i]]) continue;
        sl[i] = 15;
        if (y0 + y === top || y0 + y < side) q[tail++] = i;
      }
    }
    while (head < tail) {
      const i = q[head++];
      const l = sl[i] - 1;
      if (l <= 0) continue;
      const x = i % R, z = ((i / R) | 0) % R, y = (i / (R * R)) | 0;
      if (x > 0 && sl[i - 1] < l && !stop[ids[i - 1]]) { sl[i - 1] = l; q[tail++] = i - 1; }
      if (x < R - 1 && sl[i + 1] < l && !stop[ids[i + 1]]) { sl[i + 1] = l; q[tail++] = i + 1; }
      if (z > 0 && sl[i - R] < l && !stop[ids[i - R]]) { sl[i - R] = l; q[tail++] = i - R; }
      if (z < R - 1 && sl[i + R] < l && !stop[ids[i + R]]) { sl[i + R] = l; q[tail++] = i + R; }
      if (y > 0 && sl[i - R * R] < l && !stop[ids[i - R * R]]) { sl[i - R * R] = l; q[tail++] = i - R * R; }
      if (y < R - 1 && sl[i + R * R] < l && !stop[ids[i + R * R]]) { sl[i + R * R] = l; q[tail++] = i + R * R; }
    }
  }

  /**
   * Light levels at a point for mobs and the hand: { sky, block } (0..15), estimated without the flood fill
   * (sky from the column tops nearby, block light from light blocks within a few blocks).
   */
  lightAt(x, y, z) {
    const bx = Math.floor(x), by = Math.floor(y), bz = Math.floor(z);
    let sky = 15;
    if (this.hasSky && this.palette) {
      sky = 0;
      for (let dz = -4; dz <= 4 && sky < 15; dz++) for (let dx = -4; dx <= 4; dx++) {
        const c = this.chunks.get(chunkKey((bx + dx) >> 4, (bz + dz) >> 4));
        if (!c) continue;
        const top = this.heights(c)[((bz + dz) & 15) * 16 + ((bx + dx) & 15)];
        const v = 15 - Math.abs(dx) - Math.abs(dz) - Math.max(0, top - by);
        if (v > sky) sky = v;
      }
    }
    let block = 0;
    const E = this.palette?.emit;
    const c0 = this.chunks.get(chunkKey(bx >> 4, bz >> 4));
    if (E && c0 && this.emittersAround(bx >> 4, bz >> 4, by >> 4)) {
      for (let dy = -5; dy <= 5; dy++) for (let dz = -5; dz <= 5; dz++) for (let dx = -5; dx <= 5; dx++) {
        const e = E[this.getId(bx + dx, by + dy, bz + dz)];
        if (e) block = Math.max(block, e - Math.abs(dx) - Math.abs(dy) - Math.abs(dz));
      }
    }
    return { sky, block };
  }

  /** Brightness 0..1 of a mob or the hand at a point, with the day brightness b (like the blocks' shader, no warm tint). */
  brightnessAt(x, y, z, b) {
    const { sky, block } = this.lightAt(x, y, z);
    return Math.max(b * lightCurve(sky), lightCurve(Math.max(0, block)), 0.05);
  }

  // ---------------------------------------------------------------- block access

  getId(x, y, z) {
    const c = this.chunks.get(chunkKey(x >> 4, z >> 4));
    if (!c) return 0;
    const sec = c.sections.get(y >> 4);
    if (!sec) return 0;
    return sec[((y & 15) * S + (z & 15)) * S + (x & 15)];
  }

  hasChunk(cx, cz) { return this.chunks.has(chunkKey(cx, cz)); }

  /** Collision box [x0,y0,z0,x1,y1,z1] of the block (0..1, y may reach 1.5 for fences), or null. */
  collisionBox(x, y, z) {
    return this.palette.collision(this.getId(x, y, z));
  }

  /** All collision boxes of the block (stairs: two), or null. */
  collisionBoxes(x, y, z) {
    return this.palette.collisionBoxes(this.getId(x, y, z));
  }

  isLiquid(x, y, z) {
    const id = this.getId(x, y, z);
    return id !== 0 && this.palette.kind[id] === KIND_LIQUID;
  }

  // ---------------------------------------------------------------- updates from the server

  addChunk(cx, cz, sections) {
    const key = chunkKey(cx, cz);
    const old = this.chunks.get(key);
    if (old) this.disposeChunk(old);
    const chunk = { cx, cz, sections, meshes: new Map(), meshed: false };
    this.chunks.set(key, chunk);
    // This chunk and its neighbours may now be ready to mesh
    this.markChunkIfReady(cx, cz);
    this.markChunkIfReady(cx + 1, cz);
    this.markChunkIfReady(cx - 1, cz);
    this.markChunkIfReady(cx, cz + 1);
    this.markChunkIfReady(cx, cz - 1);
    // Light of this chunk shines into the neighbours' sections
    for (const sy of sections.keys()) if (this.emitters(chunk, sy)) this.markLightAround(cx, cz, sy);
  }

  removeChunk(cx, cz) {
    const key = chunkKey(cx, cz);
    const c = this.chunks.get(key);
    if (!c) return;
    this.disposeChunk(c);
    this.chunks.delete(key);
  }

  setBlock(x, y, z, id) {
    const cx = x >> 4, cz = z >> 4, sy = y >> 4;
    const c = this.chunks.get(chunkKey(cx, cz));
    if (!c) return;
    let sec = c.sections.get(sy);
    if (!sec) {
      if (id === 0) return;
      sec = new Uint16Array(SECTION_VOLUME);
      c.sections.set(sy, sec);
    }
    const idx = ((y & 15) * S + (z & 15)) * S + (x & 15);
    const old = sec[idx];
    sec[idx] = id;
    c.emit?.delete(sy);
    c.sortedY = null;
    const P = this.palette;
    let skyChange = false;
    if (P && (P.skyStop[old] !== P.skyStop[id] || P.skyDim[old] !== P.skyDim[id])) {
      skyChange = this.hasSky;
      if (c.top) {
        // The column's open sky may now start higher or lower: everything in between gets new light
        const k = (z & 15) * 16 + (x & 15), was = c.top[k], now = this.columnTop(c, x & 15, z & 15);
        c.top[k] = now;
        if (now !== was && c.meshed) {
          for (let s = (Math.min(was, now) >> 4) - 1; s <= (Math.max(was, now) >> 4) + 1; s++) this.markLightAround(cx, cz, s);
        }
      }
    }
    if (!c.meshed) return;
    if (P && (P.emit[old] || P.emit[id] || skyChange || (P.occluding[old] !== P.occluding[id] && this.emittersAround(cx, cz, sy)))) {
      this.markLightAround(cx, cz, sy);
    }
    this.dirty.add(cx + ',' + cz + ',' + sy);
    const lx = x & 15, ly = y & 15, lz = z & 15;
    if (lx === 0) this.markSection(cx - 1, cz, sy);
    if (lx === 15) this.markSection(cx + 1, cz, sy);
    if (lz === 0) this.markSection(cx, cz - 1, sy);
    if (lz === 15) this.markSection(cx, cz + 1, sy);
    if (ly === 0) this.markSection(cx, cz, sy - 1);
    if (ly === 15) this.markSection(cx, cz, sy + 1);
  }

  markSection(cx, cz, sy) {
    const c = this.chunks.get(chunkKey(cx, cz));
    if (c && c.meshed) this.dirty.add(cx + ',' + cz + ',' + sy);
  }

  /** Mesh a chunk only once all 4 neighbours are here (or out of view), so borders look right. */
  markChunkIfReady(cx, cz) {
    const c = this.chunks.get(chunkKey(cx, cz));
    if (!c || c.meshed) return;
    const need = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (const [dx, dz] of need) {
      const nx = cx + dx, nz = cz + dz;
      if (!this.hasChunk(nx, nz) && this.inView(nx, nz)) return;
    }
    c.meshed = true;
    for (const sy of c.sections.keys()) this.dirty.add(cx + ',' + cz + ',' + sy);
  }

  inView(cx, cz) {
    const dx = cx - this.center.cx, dz = cz - this.center.cz;
    const r = this.viewDistance;
    return dx * dx + dz * dz <= r * r + r;
  }

  setCenter(cx, cz) {
    if (cx === this.center.cx && cz === this.center.cz) return;
    this.center = { cx, cz };
    // Chunks at the old edge may be meshable now; far away chunks get dropped
    const drop = this.viewDistance + 2;
    for (const c of [...this.chunks.values()]) {
      const dx = c.cx - cx, dz = c.cz - cz;
      if (dx * dx + dz * dz > drop * drop) this.removeChunk(c.cx, c.cz);
      else if (!c.meshed) this.markChunkIfReady(c.cx, c.cz);
    }
  }

  disposeChunk(c) {
    for (const meshes of c.meshes.values()) for (const m of meshes) this.disposeMesh(m);
    c.meshes.clear();
    for (const sy of c.sections.keys()) this.dirty.delete(c.cx + ',' + c.cz + ',' + sy);
  }

  disposeMesh(m) {
    this.scene.remove(m);
    m.geometry.dispose();
  }

  // ---------------------------------------------------------------- meshing

  /** Rebuild dirty sections, nearest first, within a time budget (ms). */
  processDirty(budgetMs, px, py, pz) {
    if (this.dirty.size === 0) return 0;
    const t0 = performance.now();
    const list = [...this.dirty].map((k) => {
      const [cx, cz, sy] = k.split(',').map(Number);
      const dx = cx * 16 + 8 - px, dy = sy * 16 + 8 - py, dz = cz * 16 + 8 - pz;
      return { k, cx, cz, sy, d: dx * dx + dy * dy * 0.5 + dz * dz };
    });
    list.sort((a, b) => a.d - b.d);
    let done = 0;
    for (const item of list) {
      this.dirty.delete(item.k);
      this.meshSection(item.cx, item.cz, item.sy);
      done++;
      if (performance.now() - t0 > budgetMs) break;
    }
    return done;
  }

  meshSection(cx, cz, sy) {
    const c = this.chunks.get(chunkKey(cx, cz));
    if (!c) return;
    const old = c.meshes.get(sy);
    if (old) { for (const m of old) this.disposeMesh(m); c.meshes.delete(sy); }
    const sec = c.sections.get(sy);
    if (!sec) return;

    const P = this.palette;
    const opaque = new GeoBuilder(), cross = new GeoBuilder(), trans = new GeoBuilder(), ice = new GeoBuilder();
    const aOpaque = new GeoBuilder(), aCross = new GeoBuilder(), aTrans = new GeoBuilder();
    const animTarget = (b) => (b === opaque ? aOpaque : b === cross ? aCross : aTrans);
    const uvOf = (tile, s, t) => { const k = atlas.animOf(tile); return k === undefined ? tileUV(tile, s, t) : animUV(k, s, t); };
    const ox = cx * 16, oy = sy * 16, oz = cz * 16;

    // Fast neighbour lookup: inside the section use the array, else ask the world
    const idAt = (lx, ly, lz) => {
      if (lx >= 0 && lx < 16 && ly >= 0 && ly < 16 && lz >= 0 && lz < 16) {
        return sec[(ly * S + lz) * S + lx];
      }
      return this.getId(ox + lx, oy + ly, oz + lz);
    };
    const occ = (lx, ly, lz) => P.occluding[idAt(lx, ly, lz)];
    // Block light of the cells around this section (null: no light block near), sky light (array or one level)
    const { block: L, sky: SK } = this.computeLight(cx, cz, sy);
    const lvl = (lx, ly, lz) => L[((ly + 16) * R + lz + 16) * R + lx + 16];
    const skyFlat = typeof SK === 'number' ? (SK >= 15 ? null : lightCurve(SK)) : undefined;
    const slv = (lx, ly, lz) => SK[((ly + 16) * R + lz + 16) * R + lx + 16];

    // Liquid surface like Minecraft: each top corner is the average height of the (up to) four liquid
    // blocks around it, so flowing water slopes down and the texture runs downhill.
    const liquidHeight = (lx, ly, lz, fluid) => {
      const nid = idAt(lx, ly, lz);
      if (P.fluid[nid] === fluid) return P.fluid[idAt(lx, ly + 1, lz)] === fluid ? 1 : P.liquidH[nid];
      return P.solid[nid] ? -1 : 0;   // solid blocks don't count, air pulls the edge down
    };
    const liquidCorners = (lx, ly, lz, id) => {
      const fluid = P.fluid[id];
      if (P.fluid[idAt(lx, ly + 1, lz)] === fluid) return [1, 1, 1, 1];
      const h = [];
      for (let dz = -1; dz <= 1; dz++) {
        h.push([-1, 0, 1].map((dx) => (dx === 0 && dz === 0 ? (P.liquidFall[id] ? 1 : P.liquidH[id]) : liquidHeight(lx + dx, ly, lz + dz, fluid))));
      }
      // corner (cx, cz) touches the blocks dx in {cx-1, cx}, dz in {cz-1, cz}
      const corner = (cx, cz) => {
        let sum = 0, n = 0;
        for (const dz of [cz - 1, cz]) {
          for (const dx of [cx - 1, cx]) {
            const v = h[dz + 1][dx + 1];
            if (v >= 1) return 1;
            if (v < 0) continue;
            // full-ish neighbours weigh more, like in Minecraft
            const w = v >= 0.8 ? 10 : 1;
            sum += v * w; n += w;
          }
        }
        return n ? sum / n : P.liquidH[id];
      };
      return [corner(0, 0), corner(0, 1), corner(1, 1), corner(1, 0)];   // (x,z) = 00, 01, 11, 10
    };

    for (let ly = 0; ly < 16; ly++) {
      for (let lz = 0; lz < 16; lz++) {
        for (let lx = 0; lx < 16; lx++) {
          const id = sec[(ly * S + lz) * S + lx];
          if (id === 0) continue;
          const kind = P.kind[id];
          const wx = ox + lx, wy = oy + ly, wz = oz + lz;
          const noise = 0.92 + hash3(wx, wy, wz) * 0.16;
          const r = P.rgb[id * 3] * noise, g = P.rgb[id * 3 + 1] * noise, b = P.rgb[id * 3 + 2] * noise;

          if (kind === KIND_CROSS) {
            const h = 0.9, s = 0.12, e = 0.88;
            const col = P.packed[id] & 2 ? [0.9, 0.9, 0.9, 1] : [r * 0.9, g * 0.9, b * 0.9, 1];
            const cc = [col, col, col, col];
            const tl = P.tileSide[id];
            const uv = [uvOf(tl, 0, 0), uvOf(tl, 1, 0), uvOf(tl, 1, 1), uvOf(tl, 0, 1)];
            const cb = atlas.animOf(tl) === undefined ? cross : aCross;
            const own = L ? lightCurve(lvl(lx, ly, lz)) : 0;
            const ql = L ? [own, own, own, own] : null;
            const os = skyFlat === undefined ? lightCurve(slv(lx, ly, lz)) : skyFlat;
            const qs = os === null ? null : [os, os, os, os];
            if (P.fire[id]) {
              // Fire burns on the sides of the block like in Minecraft: four leaning walls plus an X
              const fh = 1.4, k = 0.18;
              cb.quad([[lx, ly, lz + k], [lx + 1, ly, lz + k], [lx + 1, ly + fh, lz + k + 0.25], [lx, ly + fh, lz + k + 0.25]], cc, false, uv, ql, qs);
              cb.quad([[lx, ly, lz + 1 - k], [lx + 1, ly, lz + 1 - k], [lx + 1, ly + fh, lz + 0.75 - k], [lx, ly + fh, lz + 0.75 - k]], cc, false, uv, ql, qs);
              cb.quad([[lx + k, ly, lz], [lx + k, ly, lz + 1], [lx + k + 0.25, ly + fh, lz + 1], [lx + k + 0.25, ly + fh, lz]], cc, false, uv, ql, qs);
              cb.quad([[lx + 1 - k, ly, lz], [lx + 1 - k, ly, lz + 1], [lx + 0.75 - k, ly + fh, lz + 1], [lx + 0.75 - k, ly + fh, lz]], cc, false, uv, ql, qs);
            }
            cb.quad([[lx + s, ly, lz + s], [lx + e, ly, lz + e], [lx + e, ly + h, lz + e], [lx + s, ly + h, lz + s]], cc, false, uv, ql, qs);
            cb.quad([[lx + s, ly, lz + e], [lx + e, ly, lz + s], [lx + e, ly + h, lz + s], [lx + s, ly + h, lz + e]], cc, false, uv, ql, qs);
            continue;
          }

          // Stairs, fences ... are several boxes; everything else one
          const shapeBoxes = kind === KIND_CUBE && P.boxes[id] ? P.boxes[id] : null;
          for (let bi = 0; bi < (shapeBoxes ? shapeBoxes.length : 1); bi++) {
          let box = shapeBoxes ? shapeBoxes[bi] : (P.box[id] || FULL);
          // Liquids: a full box whose top corners are moved down to the surface height
          const lc = kind === KIND_LIQUID ? liquidCorners(lx, ly, lz, id) : null;
          if (lc) box = FULL;
          const full = box[0] <= 0 && box[1] <= 0 && box[2] <= 0 && box[3] >= 1 && box[4] >= 1 && box[5] >= 1;
          const target = kind === KIND_CUBE && P.alpha[id] >= 1 ? opaque
            : kind === KIND_GLASS && P.alpha[id] >= 0.7 && P.solid[id] ? ice : trans;
          const alpha = P.alpha[id];
          const glow = P.glow[id];

          for (let f = 0; f < 6; f++) {
            const F = FACES[f];
            const nx = lx + F.n[0], ny = ly + F.n[1], nz = lz + F.n[2];
            const nid = idAt(nx, ny, nz);
            // Only faces on the block boundary can be hidden by the neighbour
            const flush = F.n[0] > 0 ? box[3] >= 1 : F.n[0] < 0 ? box[0] <= 0
              : F.n[1] > 0 ? box[4] >= 1 : F.n[1] < 0 ? box[1] <= 0
              : F.n[2] > 0 ? box[5] >= 1 : box[2] <= 0;
            if (lc) {
              // Same liquid next to it: no wall in between; the top is only hidden by liquid above
              if (P.fluid[nid] === P.fluid[id]) continue;
              // Under or next to ice and glass there is no water surface (like Minecraft)
              if (P.kind[nid] === KIND_GLASS && P.solid[nid]) continue;
              if (F.n[1] > 0 ? P.occluding[nid] && lc.every((v) => v >= 1) : P.occluding[nid]) continue;
            } else if (flush) {
              if (P.occluding[nid]) continue;
              if (nid === id && (kind !== KIND_CUBE || (full && !P.occluding[id]))) continue;
            }
            if (F.n[1] === -1 && kind === KIND_LIQUID && nid !== 0 && P.solid[nid]) continue;

            const faceBit = F.n[1] > 0 ? 1 : F.n[1] < 0 ? 4 : 2;
            // The side the block looks to (furnace, chest ...) has its own picture
            const front = f === P.facing[id] && P.tileFront[id] >= 0;
            let fr = r, fg = g, fb = b;
            if (front || (P.packed[id] & faceBit)) {
              // Pack textures bring their own colors
              const n2 = 0.97 + (noise - 1) * 0.3;
              fr = fg = fb = n2;
            } else if (id === P.grassId && F.n[1] !== 1) {
              fr = P.dirtRgb[0] * noise; fg = P.dirtRgb[1] * noise; fb = P.dirtRgb[2] * noise;
            }

            const pts = new Array(4), cols = new Array(4), ao = new Array(4), uvs = new Array(4);
            const lights = L ? new Array(4) : null;
            const skies = skyFlat === null ? null : new Array(4);
            // Slope of the liquid surface (null when flat): from high corners to low ones
            let flowAngle = null;
            if (lc && F.n[1] > 0) {
              const gx = (lc[0] + lc[1]) - (lc[2] + lc[3]);   // higher at x=0 -> flows to +x
              const gz = (lc[0] + lc[3]) - (lc[1] + lc[2]);   // higher at z=0 -> flows to +z
              // Quarter turns only: other angles would reach outside the tile into its atlas neighbours
              if (Math.abs(gx) + Math.abs(gz) > 0.01) flowAngle = Math.round(Math.atan2(gx, gz) / (Math.PI / 2)) * (Math.PI / 2);
            }
            const tile = F.n[1] > 0 ? P.tileTop[id] : F.n[1] < 0 ? P.tileBottom[id] : front ? P.tileFront[id] : P.tileSide[id];
            const useAo = kind === KIND_CUBE && full && !glow;
            for (let i = 0; i < 4; i++) {
              const [du, dv] = CORNERS[i];
              // Corner of the unit cube (0 or 1 per axis), then mapped onto the block's shape
              const ux = 0.5 + 0.5 * (F.n[0] + du * F.u[0] + dv * F.v[0]);
              const uy = 0.5 + 0.5 * (F.n[1] + du * F.u[1] + dv * F.v[1]);
              const uz = 0.5 + 0.5 * (F.n[2] + du * F.u[2] + dv * F.v[2]);
              const vx = ux > 0.5 ? box[3] : box[0];
              const vy = uy > 0.5 ? (lc ? lc[(ux > 0.5 ? 2 : 0) + ((ux > 0.5) !== (uz > 0.5) ? 1 : 0)] : Math.min(box[4], 1)) : box[1];
              const vz = uz > 0.5 ? box[5] : box[2];
              pts[i] = [lx + vx, ly + vy, lz + vz];
              // Texture coordinates follow the real size so small blocks are not squashed
              let su, tv;
              if (F.n[1] !== 0) { su = F.n[1] > 0 ? vz : vx; tv = F.n[1] > 0 ? vx : vz; }
              else if (F.n[0] !== 0) { su = vz; tv = vy; }
              else { su = vx; tv = vy; }
              if (lc && F.n[1] > 0 && flowAngle !== null) {
                // Rotate the texture so the water runs downhill
                const cs = Math.cos(flowAngle), sn = Math.sin(flowAngle);
                const a0 = su - 0.5, b0 = tv - 0.5;
                su = 0.5 + a0 * cs - b0 * sn;
                tv = 0.5 + a0 * sn + b0 * cs;
              }
              uvs[i] = uvOf(tile, su, tv);

              let a = 3;
              if (useAo) {
                const s1 = occ(nx + du * F.u[0], ny + du * F.u[1], nz + du * F.u[2]);
                const s2 = occ(nx + dv * F.v[0], ny + dv * F.v[1], nz + dv * F.v[2]);
                const cr = occ(nx + du * F.u[0] + dv * F.v[0], ny + du * F.u[1] + dv * F.v[1], nz + du * F.u[2] + dv * F.v[2]);
                a = s1 && s2 ? 0 : 3 - (s1 + s2 + cr);
              }
              ao[i] = a;
              if (lights) {
                // Smooth light: average of the cells in front of this corner that light can be in
                const ax = du * F.u[0], ay = du * F.u[1], az = du * F.u[2];
                const bx = dv * F.v[0], by = dv * F.v[1], bz = dv * F.v[2];
                let sum = lvl(nx, ny, nz), n = 1;
                if (!occ(nx + ax, ny + ay, nz + az)) { sum += lvl(nx + ax, ny + ay, nz + az); n++; }
                if (!occ(nx + bx, ny + by, nz + bz)) { sum += lvl(nx + bx, ny + by, nz + bz); n++; }
                if (!occ(nx + ax + bx, ny + ay + by, nz + az + bz)) { sum += lvl(nx + ax + bx, ny + ay + by, nz + az + bz); n++; }
                let v = sum / n;
                if (!flush || lc) v = Math.max(v, lvl(lx, ly, lz));   // faces inside the block's own cell
                lights[i] = lightCurve(v);
              }
              if (skies) {
                if (skyFlat !== undefined) skies[i] = skyFlat;
                else {
                  const ax = du * F.u[0], ay = du * F.u[1], az = du * F.u[2];
                  const bx = dv * F.v[0], by = dv * F.v[1], bz = dv * F.v[2];
                  let sum = slv(nx, ny, nz), n = 1;
                  if (!occ(nx + ax, ny + ay, nz + az)) { sum += slv(nx + ax, ny + ay, nz + az); n++; }
                  if (!occ(nx + bx, ny + by, nz + bz)) { sum += slv(nx + bx, ny + by, nz + bz); n++; }
                  if (!occ(nx + ax + bx, ny + ay + by, nz + az + bz)) { sum += slv(nx + ax + bx, ny + ay + by, nz + az + bz); n++; }
                  let v = sum / n;
                  if (!flush || lc) v = Math.max(v, slv(lx, ly, lz));
                  skies[i] = lightCurve(v);
                }
              }
              const l = glow ? 1 : F.shade * AO_LEVELS[a];
              // Pack textures bring their own see-through pixels (glass), so no extra fading
              cols[i] = [fr * l, fg * l, fb * l, (P.packed[id] & faceBit) && kind === KIND_GLASS ? 1 : alpha];
            }
            // Flip the diagonal so AO gradients look even
            const flip = ao[0] + ao[2] < ao[1] + ao[3];
            (atlas.animOf(tile) === undefined ? target : animTarget(target)).quad(pts, cols, flip, uvs, lights, skies);
          }
          }
        }
      }
    }

    const meshes = [];
    const add = (builder, mat, order) => {
      if (builder.empty) return;
      const m = new THREE.Mesh(builder.build(), mat);
      m.position.set(ox, oy, oz);
      m.matrixAutoUpdate = false;
      m.updateMatrix();
      m.renderOrder = order;
      this.scene.add(m);
      meshes.push(m);
    };
    add(opaque, this.matOpaque, 0);
    add(cross, this.matCross, 0);
    add(ice, this.matIce, 1);
    add(trans, this.matTrans, 2);
    add(aOpaque, this.matAnimOpaque, 0);
    add(aCross, this.matAnimCross, 0);
    add(aTrans, this.matAnimTrans, 2);
    if (meshes.length) c.meshes.set(sy, meshes);
  }

  /**
   * Find the first block along a ray (voxel walk). Returns { x, y, z, face: [nx, ny, nz], id } or null.
   * Liquids and air are passed through.
   */
  raycast(ox, oy, oz, dx, dy, dz, maxDist) {
    let x = Math.floor(ox), y = Math.floor(oy), z = Math.floor(oz);
    const stepX = Math.sign(dx), stepY = Math.sign(dy), stepZ = Math.sign(dz);
    const tdx = stepX ? Math.abs(1 / dx) : Infinity;
    const tdy = stepY ? Math.abs(1 / dy) : Infinity;
    const tdz = stepZ ? Math.abs(1 / dz) : Infinity;
    let tmx = stepX > 0 ? (x + 1 - ox) * tdx : stepX < 0 ? (ox - x) * tdx : Infinity;
    let tmy = stepY > 0 ? (y + 1 - oy) * tdy : stepY < 0 ? (oy - y) * tdy : Infinity;
    let tmz = stepZ > 0 ? (z + 1 - oz) * tdz : stepZ < 0 ? (oz - z) * tdz : Infinity;
    let face = [0, 0, 0];
    let t = 0;
    while (t <= maxDist) {
      const id = this.getId(x, y, z);
      if (id !== 0 && this.palette.kind[id] !== KIND_LIQUID) {
        // Small shapes (slabs, doors ...): the ray must really hit the shape
        const box = this.palette.kind[id] === KIND_CROSS ? null : this.palette.box[id];
        if (!box) return { x, y, z, face, id };
        // Several boxes (stairs): the closest one that is hit
        let hit = null;
        for (const b of this.palette.boxes[id] || [box]) {
          const h = rayBox(ox - x, oy - y, oz - z, dx, dy, dz, b);
          if (h && (!hit || h.t < hit.t)) hit = h;
        }
        if (hit) return { x, y, z, face: hit.face, id, t: hit.t };
      }
      if (tmx < tmy && tmx < tmz) { x += stepX; t = tmx; tmx += tdx; face = [-stepX, 0, 0]; }
      else if (tmy < tmz) { y += stepY; t = tmy; tmy += tdy; face = [0, -stepY, 0]; }
      else { z += stepZ; t = tmz; tmz += tdz; face = [0, 0, -stepZ]; }
    }
    return null;
  }

  /** Rebuild every chunk mesh (after the texture pack changed). */
  remeshAll() {
    for (const c of this.chunks.values()) {
      if (!c.meshed) continue;
      for (const sy of c.sections.keys()) this.dirty.add(c.cx + ',' + c.cz + ',' + sy);
    }
  }

  clear() {
    for (const c of this.chunks.values()) this.disposeChunk(c);
    this.chunks.clear();
    this.dirty.clear();
  }

  stats() {
    let meshes = 0;
    for (const c of this.chunks.values()) meshes += c.meshes.size;
    return { chunks: this.chunks.size, sections: meshes, pending: this.dirty.size };
  }
}
