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
const LIQUID_TOP = [0, 0, 0, 1, 0.875, 1];

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
  constructor() { this.pos = []; this.col = []; this.uv = []; this.idx = []; }
  get empty() { return this.idx.length === 0; }
  quad(p, c, flip, uv) {
    const base = this.pos.length / 3;
    for (let i = 0; i < 4; i++) {
      this.pos.push(p[i][0], p[i][1], p[i][2]);
      this.col.push(c[i][0], c[i][1], c[i][2], c[i][3]);
      this.uv.push(uv[i][0], uv[i][1]);
    }
    if (flip) this.idx.push(base + 1, base + 2, base + 3, base + 1, base + 3, base);
    else this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 4));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

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
    this.matOpaque = new THREE.MeshBasicMaterial({ vertexColors: true, map, alphaTest: 0.5 });
    this.matCross = new THREE.MeshBasicMaterial({ vertexColors: true, map, side: THREE.DoubleSide, alphaTest: 0.5 });
    this.matTrans = new THREE.MeshBasicMaterial({
      vertexColors: true, map, transparent: true, side: THREE.DoubleSide, depthWrite: false,
    });
    // Same, with the atlas of animated textures (fire, water, lava ...)
    const amap = atlas.animTexture;
    this.matAnimOpaque = new THREE.MeshBasicMaterial({ vertexColors: true, map: amap, alphaTest: 0.5 });
    this.matAnimCross = new THREE.MeshBasicMaterial({ vertexColors: true, map: amap, side: THREE.DoubleSide, alphaTest: 0.5 });
    this.matAnimTrans = new THREE.MeshBasicMaterial({
      vertexColors: true, map: amap, transparent: true, side: THREE.DoubleSide, depthWrite: false,
    });
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
    sec[((y & 15) * S + (z & 15)) * S + (x & 15)] = id;
    if (!c.meshed) return;
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
    const opaque = new GeoBuilder(), cross = new GeoBuilder(), trans = new GeoBuilder();
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
            if (P.fire[id]) {
              // Fire burns on the sides of the block like in Minecraft: four leaning walls plus an X
              const fh = 1.4, k = 0.18;
              cb.quad([[lx, ly, lz + k], [lx + 1, ly, lz + k], [lx + 1, ly + fh, lz + k + 0.25], [lx, ly + fh, lz + k + 0.25]], cc, false, uv);
              cb.quad([[lx, ly, lz + 1 - k], [lx + 1, ly, lz + 1 - k], [lx + 1, ly + fh, lz + 0.75 - k], [lx, ly + fh, lz + 0.75 - k]], cc, false, uv);
              cb.quad([[lx + k, ly, lz], [lx + k, ly, lz + 1], [lx + k + 0.25, ly + fh, lz + 1], [lx + k + 0.25, ly + fh, lz]], cc, false, uv);
              cb.quad([[lx + 1 - k, ly, lz], [lx + 1 - k, ly, lz + 1], [lx + 0.75 - k, ly + fh, lz + 1], [lx + 0.75 - k, ly + fh, lz]], cc, false, uv);
            }
            cb.quad([[lx + s, ly, lz + s], [lx + e, ly, lz + e], [lx + e, ly + h, lz + e], [lx + s, ly + h, lz + s]], cc, false, uv);
            cb.quad([[lx + s, ly, lz + e], [lx + e, ly, lz + s], [lx + e, ly + h, lz + s], [lx + s, ly + h, lz + e]], cc, false, uv);
            continue;
          }

          // Stairs, fences ... are several boxes; everything else one
          const shapeBoxes = kind === KIND_CUBE && P.boxes[id] ? P.boxes[id] : null;
          for (let bi = 0; bi < (shapeBoxes ? shapeBoxes.length : 1); bi++) {
          let box = shapeBoxes ? shapeBoxes[bi] : (P.box[id] || FULL);
          if (kind === KIND_LIQUID) box = idAt(lx, ly + 1, lz) === id ? FULL : LIQUID_TOP;
          const full = box[0] <= 0 && box[1] <= 0 && box[2] <= 0 && box[3] >= 1 && box[4] >= 1 && box[5] >= 1;
          const target = kind === KIND_CUBE && P.alpha[id] >= 1 ? opaque : trans;
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
            if (flush) {
              if (P.occluding[nid]) continue;
              if (nid === id && (kind !== KIND_CUBE || (full && !P.occluding[id]))) continue;
            }
            if (F.n[1] === -1 && kind === KIND_LIQUID && nid !== 0 && P.solid[nid]) continue;

            const faceBit = F.n[1] > 0 ? 1 : F.n[1] < 0 ? 4 : 2;
            let fr = r, fg = g, fb = b;
            if (P.packed[id] & faceBit) {
              // Pack textures bring their own colors
              const n2 = 0.97 + (noise - 1) * 0.3;
              fr = fg = fb = n2;
            } else if (id === P.grassId && F.n[1] !== 1) {
              fr = P.dirtRgb[0] * noise; fg = P.dirtRgb[1] * noise; fb = P.dirtRgb[2] * noise;
            }

            const pts = new Array(4), cols = new Array(4), ao = new Array(4), uvs = new Array(4);
            const tile = F.n[1] > 0 ? P.tileTop[id] : F.n[1] < 0 ? P.tileBottom[id] : P.tileSide[id];
            const useAo = kind === KIND_CUBE && full && !glow;
            for (let i = 0; i < 4; i++) {
              const [du, dv] = CORNERS[i];
              // Corner of the unit cube (0 or 1 per axis), then mapped onto the block's shape
              const ux = 0.5 + 0.5 * (F.n[0] + du * F.u[0] + dv * F.v[0]);
              const uy = 0.5 + 0.5 * (F.n[1] + du * F.u[1] + dv * F.v[1]);
              const uz = 0.5 + 0.5 * (F.n[2] + du * F.u[2] + dv * F.v[2]);
              const vx = ux > 0.5 ? box[3] : box[0];
              const vy = uy > 0.5 ? Math.min(box[4], 1) : box[1];
              const vz = uz > 0.5 ? box[5] : box[2];
              pts[i] = [lx + vx, ly + vy, lz + vz];
              // Texture coordinates follow the real size so small blocks are not squashed
              let su, tv;
              if (F.n[1] !== 0) { su = F.n[1] > 0 ? vz : vx; tv = F.n[1] > 0 ? vx : vz; }
              else if (F.n[0] !== 0) { su = vz; tv = vy; }
              else { su = vx; tv = vy; }
              uvs[i] = uvOf(tile, su, tv);

              let a = 3;
              if (useAo) {
                const s1 = occ(nx + du * F.u[0], ny + du * F.u[1], nz + du * F.u[2]);
                const s2 = occ(nx + dv * F.v[0], ny + dv * F.v[1], nz + dv * F.v[2]);
                const cr = occ(nx + du * F.u[0] + dv * F.v[0], ny + du * F.u[1] + dv * F.v[1], nz + du * F.u[2] + dv * F.v[2]);
                a = s1 && s2 ? 0 : 3 - (s1 + s2 + cr);
              }
              ao[i] = a;
              const l = glow ? 1 : F.shade * AO_LEVELS[a];
              // Pack textures bring their own see-through pixels (glass), so no extra fading
              cols[i] = [fr * l, fg * l, fb * l, (P.packed[id] & faceBit) && kind === KIND_GLASS ? 1 : alpha];
            }
            // Flip the diagonal so AO gradients look even
            const flip = ao[0] + ao[2] < ao[1] + ao[3];
            (atlas.animOf(tile) === undefined ? target : animTarget(target)).quad(pts, cols, flip, uvs);
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
    add(trans, this.matTrans, 1);
    add(aOpaque, this.matAnimOpaque, 0);
    add(aCross, this.matAnimCross, 0);
    add(aTrans, this.matAnimTrans, 1);
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
