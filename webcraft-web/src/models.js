// Small textured models: blocks as entities (dropped items, falling sand, the block in your hand)
// and flat item pictures.
import * as THREE from 'three';
import { atlas, tileUV, TILE_PX } from './textures.js';
import { KIND_CROSS } from './palette.js';
import { iconCanvas } from './items.js';

const blockMaterial = new THREE.MeshBasicMaterial({ map: atlas.texture, vertexColors: true, alphaTest: 0.5 });
blockMaterial.userData.shared = true;

// BoxGeometry face order: +x, -x, +y, -y, +z, -z
const FACE_SHADE = [0.8, 0.8, 1.0, 0.55, 0.68, 0.68];

/** A textured block of size sx * sy * sz, centered on the origin. */
export function blockMesh(palette, id, sx = 1, sy = 1, sz = 1) {
  const g = new THREE.BoxGeometry(sx, sy, sz);
  const uv = g.attributes.uv;
  const colors = new Float32Array(uv.count * 3);
  const rgb = [palette.rgb[id * 3], palette.rgb[id * 3 + 1], palette.rgb[id * 3 + 2]];
  for (let f = 0; f < 6; f++) {
    const tile = f === 2 ? palette.tileTop[id] : f === 3 ? palette.tileBottom[id] : palette.tileSide[id];
    const bit = f === 2 ? 1 : f === 3 ? 4 : 2;
    let c = palette.packed[id] & bit ? [1, 1, 1] : rgb;
    if (id === palette.grassId && f !== 2 && !(palette.packed[id] & bit)) c = palette.dirtRgb;
    for (let v = f * 4; v < f * 4 + 4; v++) {
      const [u, w] = tileUV(tile, uv.getX(v), uv.getY(v));
      uv.setXY(v, u, w);
      colors[v * 3] = c[0] * FACE_SHADE[f];
      colors[v * 3 + 1] = c[1] * FACE_SHADE[f];
      colors[v * 3 + 2] = c[2] * FACE_SHADE[f];
    }
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const m = new THREE.Mesh(g, blockMaterial);
  m.userData.noTint = true;
  return m;
}

const sideMaterial = new THREE.MeshBasicMaterial({ vertexColors: true });
sideMaterial.userData.shared = true;

/**
 * An item picture with thickness, like Minecraft draws items in the hand and on the ground:
 * front and back show the picture, the edges get the color of the pixel next to them.
 */
export function itemExtruded(palette, key, size) {
  // Picture and edges from the same pixels: the item picture at the atlas resolution (32 px; 16 px pictures
  // are doubled exactly). Scaling the 48 px icon instead put the edges next to the picture's pixels.
  const N = TILE_PX;
  const small = document.createElement('canvas');
  small.width = small.height = N;
  const sctx = small.getContext('2d', { willReadFrequently: true });
  sctx.imageSmoothingEnabled = false;
  const itemTile = atlas.packTile('item/' + key);
  if (itemTile >= 0) atlas.drawTileTo(sctx, itemTile, 0, 0, N, N);
  else sctx.drawImage(iconCanvas(palette, key), 0, 0, N, N);
  const px = sctx.getImageData(0, 0, N, N).data;
  const solid = (x, y) => x >= 0 && y >= 0 && x < N && y < N && px[(y * N + x) * 4 + 3] > 100;

  const tex = new THREE.CanvasTexture(small);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.NoColorSpace;
  // Front and back are separate one-sided faces, so the back shows the picture mirrored (like a real thin item)
  const faceMat = new THREE.MeshBasicMaterial({ map: tex, alphaTest: 0.4, side: THREE.FrontSide });
  const backMat = new THREE.MeshBasicMaterial({ map: tex, alphaTest: 0.4, side: THREE.BackSide });
  const group = new THREE.Group();
  const p = size / N, t = size / 16;         // as thick as one pixel of a 16 px item
  const front = new THREE.PlaneGeometry(size, size);
  const f1 = new THREE.Mesh(front, faceMat);
  f1.position.z = t / 2;
  const f2 = new THREE.Mesh(front.clone(), backMat);
  f2.position.z = -t / 2;
  group.add(f1, f2);

  const pos = [], col = [];
  const quad = (a, b, c, d, r, g, bl) => {
    for (const v of [a, b, c, a, c, d]) { pos.push(...v); col.push(r, g, bl); }
  };
  const h = size / 2, z0 = -t / 2, z1 = t / 2;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      if (!solid(x, y)) continue;
      const i = (y * N + x) * 4;
      const r = px[i] / 255 * 0.75, g = px[i + 1] / 255 * 0.75, b = px[i + 2] / 255 * 0.75;
      const X0 = -h + x * p, X1 = X0 + p, Y1 = h - y * p, Y0 = Y1 - p;
      if (!solid(x - 1, y)) quad([X0, Y0, z0], [X0, Y0, z1], [X0, Y1, z1], [X0, Y1, z0], r, g, b);
      if (!solid(x + 1, y)) quad([X1, Y0, z1], [X1, Y0, z0], [X1, Y1, z0], [X1, Y1, z1], r, g, b);
      if (!solid(x, y - 1)) quad([X0, Y1, z1], [X1, Y1, z1], [X1, Y1, z0], [X0, Y1, z0], r * 1.15, g * 1.15, b * 1.15);
      if (!solid(x, y + 1)) quad([X0, Y0, z0], [X1, Y0, z0], [X1, Y0, z1], [X0, Y0, z1], r * 0.8, g * 0.8, b * 0.8);
    }
  }
  if (pos.length) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    const sides = new THREE.Mesh(g, sideMaterial);
    sides.material.side = THREE.DoubleSide;
    group.add(sides);
  }
  group.traverse((o) => { o.userData.noTint = true; });
  return group;
}

/** Flat picture of an item (both sides visible). */
export function itemPlane(palette, key, size) {
  const tex = new THREE.CanvasTexture(iconCanvas(palette, key));
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.NoColorSpace;
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, alphaTest: 0.3, side: THREE.DoubleSide });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat);
  m.userData.noTint = true;
  return m;
}

/** Model for an item: a small block for full blocks, else its flat picture. */
export function itemModel(palette, key, blockSize, flatSize) {
  const id = palette?.index.get(key);
  if (id !== undefined && palette.kind[id] !== KIND_CROSS && palette.kind[id] !== 0 && !/door|sign|banner|bed$|pane$|bars$|ladder|rail|torch|lantern|candle/.test(key)) {
    const box = palette.box[id];
    if (palette.boxes[id]) {
      // Stairs & co: the real shape, made of its boxes
      const g = new THREE.Group();
      for (const b of palette.boxes[id]) {
        const part = blockMesh(palette, id, (b[3] - b[0]) * blockSize, (Math.min(b[4], 1) - b[1]) * blockSize, (b[5] - b[2]) * blockSize);
        part.position.set(((b[0] + b[3]) / 2 - 0.5) * blockSize, ((b[1] + Math.min(b[4], 1)) / 2 - 0.5) * blockSize, ((b[2] + b[5]) / 2 - 0.5) * blockSize);
        g.add(part);
      }
      g.userData.flat = false;
      return g;
    }
    const h = box ? Math.max(0.2, Math.min(1, box[4] - box[1])) : 1;
    const m = blockMesh(palette, id, blockSize, blockSize * h, blockSize);
    m.userData.flat = false;
    return m;
  }
  const m = itemExtruded(palette, key, flatSize);
  m.userData.flat = true;
  return m;
}
