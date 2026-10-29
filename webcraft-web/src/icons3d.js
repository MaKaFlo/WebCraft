// Inventory icons of blocks with their real shape (fence gates, walls, stairs, beds, cauldrons ...), drawn with
// three.js from Minecraft's inventory angle (turned 225 deg around y, tilted 30 deg) into a small canvas.
import * as THREE from 'three';
import { atlas, tileUV, animUV } from './textures.js';
import { blockModel, bakeModel } from './blockmodels.js';
import { FULL } from './palette.js';

const PX = 96;
let renderer = null, failed = false, scene, camera, material, animMaterial;

function setup() {
  if (renderer || failed) return !!renderer;
  try {
    renderer = new THREE.WebGLRenderer({ alpha: true, antialias: false, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1);
    renderer.setSize(PX, PX, false);
    renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    renderer.setClearColor(0x000000, 0);
  } catch (e) {
    failed = true;
    return false;
  }
  scene = new THREE.Scene();
  const s = 0.82;
  camera = new THREE.OrthographicCamera(-s, s, s, -s, -10, 10);
  camera.position.set(0, 0, 5);
  material = new THREE.MeshBasicMaterial({ map: atlas.texture, vertexColors: true, alphaTest: 0.5, side: THREE.DoubleSide });
  animMaterial = new THREE.MeshBasicMaterial({ map: atlas.animTexture, vertexColors: true, alphaTest: 0.5, side: THREE.DoubleSide });
  return true;
}

// Default block states for the item look (Minecraft's item models use these)
const ITEM_STATE = {
  bed: [{ part: 'foot', facing: 'north' }, { part: 'head', facing: 'north', dz: -1 }],
};

// Light of the faces like Minecraft's inventory: top bright, the two visible sides darker
const shadeOf = (n) => (n[1] > 0.5 ? 1 : n[1] < -0.5 ? 0.5 : Math.abs(n[0]) > 0.5 ? 0.62 : 0.82);

/** Quads of a palette id drawn as boxes: [{ p: 4 corners 0..1, uv: 4 [s, t], tile, n, color }]. */
function boxQuads(palette, id) {
  const out = [];
  const own = INVENTORY_BOXES.find(([re]) => re.test(palette.names[id]))?.[1];
  const boxes = own ? own.map((b) => b.map((v) => v / 16)) : palette.boxes[id] || [palette.box[id] || FULL];
  const rgb = [palette.rgb[id * 3], palette.rgb[id * 3 + 1], palette.rgb[id * 3 + 2]];
  const ft = palette.faceTile[id];
  // world.js FACES order: +x, -x, +y, -y, +z, -z
  const sides = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  for (const b of boxes) {
    sides.forEach((n, f) => {
      const a = n.findIndex((v) => v !== 0), hi = n[a] > 0;
      const c = hi ? b[a + 3] : b[a];
      // the other two axes
      const [u, v] = a === 0 ? [2, 1] : a === 1 ? [2, 0] : [0, 1];
      const corners = [[b[u], b[v]], [b[u + 3], b[v]], [b[u + 3], b[v + 3]], [b[u], b[v + 3]]];
      const p = corners.map(([cu, cv]) => { const q = [0, 0, 0]; q[a] = c; q[u] = cu; q[v] = cv; return q; });
      const tile = ft ? ft[f] : f === 2 ? palette.tileTop[id] : f === 3 ? palette.tileBottom[id]
        : f === palette.facing[id] && palette.tileFront[id] >= 0 ? palette.tileFront[id] : palette.tileSide[id];
      // texture coordinates like the world mesher: they follow the real size of the box
      const uv = p.map((q) => (a === 1 ? (n[1] > 0 ? [q[2], q[0]] : [q[0], q[2]]) : a === 0 ? [q[2], q[1]] : [q[0], q[1]]));
      const bit = f === 2 ? 1 : f === 3 ? 4 : 2;
      let col = palette.packed[id] & bit || ft ? [1, 1, 1] : rgb;
      if (id === palette.grassId && f !== 2 && !(palette.packed[id] & bit)) col = palette.dirtRgb;
      out.push({ p, uv, tile, n, color: col });
    });
  }
  return out;
}

function modelQuads(palette, id, name, props) {
  const m = blockModel(name, props);
  if (!m || !m.elements) return null;
  const fallback = id !== undefined ? palette.tileSide[id] : -1;
  return bakeModel(m).map((q) => {
    let tile = q.tex === '#side' ? fallback : atlas.packTile(q.tex);
    if (tile < 0) tile = fallback;
    return { p: q.p, uv: q.uv, tile, n: q.n, color: q.tint || m.tint || [1, 1, 1] };
  });
}

function addMesh(group, quads, dx = 0, dz = 0) {
  const parts = [[], []];   // static atlas, animation atlas
  for (const q of quads) if (q.tile >= 0) parts[atlas.animOf(q.tile) === undefined ? 0 : 1].push(q);
  parts.forEach((list, k) => {
    if (!list.length) return;
    const pos = [], uv = [], col = [], idx = [];
    for (const q of list) {
      const base = pos.length / 3;
      const s = shadeOf(q.n);
      q.p.forEach((pt, i) => {
        pos.push(pt[0] - 0.5 + dx, pt[1] - 0.5, pt[2] - 0.5 + dz);
        const [u, v] = k ? animUV(atlas.animOf(q.tile), q.uv[i][0], q.uv[i][1]) : tileUV(q.tile, q.uv[i][0], q.uv[i][1]);
        uv.push(u, v);
        col.push(q.color[0] * s, q.color[1] * s, q.color[2] * s);
      });
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    group.add(new THREE.Mesh(g, k ? animMaterial : material));
  });
}

// Blocks Minecraft shows as a flat picture in the inventory (their 3D shape would be a thin line)
export const FLAT_ICON = /ladder$|_bars$|pane$|chain$|rail$|^lever$|torch$|vine$|lily_pad$|tripwire_hook$|^redstone_wire$|^cobweb$|^scaffolding$/;

/** Is a palette id worth a 3D icon (anything that is not a plain cube with one picture per side)? */
export function wants3d(palette, id) {
  if (FLAT_ICON.test(palette.names[id])) return false;
  return !!(palette.quads[id] || palette.boxes[id] || palette.box[id] || palette.faceTile[id]);
}

// Minecraft's inventory models of fences and walls (two posts with bars, a post with a wall piece), in pixels
const INVENTORY_BOXES = [
  [/_fence$/, [[6, 0, 0, 10, 16, 4], [6, 0, 12, 10, 16, 16], [7, 13, -2, 9, 15, 18], [7, 5, -2, 9, 7, 18]]],
  [/_wall$/, [[4, 0, 4, 12, 16, 12], [5, 0, 0, 11, 13, 16]]],
];

/** Draws the block of item `key` into ctx (size x size). Returns false when WebGL is not available. */
export function drawBlockIcon(ctx, palette, key, size) {
  if (!setup()) return false;
  const id = palette.index.get(key);
  const group = new THREE.Group();
  const bed = /_bed$/.test(key) && key !== 'straw_bed';
  if (bed) {
    for (const st of ITEM_STATE.bed) addMesh(group, modelQuads(palette, id, key, st) || [], 0, st.dz || 0);
    group.position.z = 0.5;   // the middle of the two parts
  } else {
    // Items look like the block in its first state (fence gates closed)
    const props = { ...(palette.props[id] || {}), ...(/_fence_gate$/.test(key) ? { open: 'false', in_wall: 'false' } : {}) };
    const quads = palette.quads[id] && !/_fence$/.test(key) ? modelQuads(palette, id, key, props) || [] : boxQuads(palette, id);
    addMesh(group, quads);
  }
  const holder = new THREE.Group();
  holder.add(group);
  holder.rotation.set(30 * Math.PI / 180, 225 * Math.PI / 180, 0, 'XYZ');
  if (bed) holder.scale.setScalar(0.62);
  scene.add(holder);
  renderer.render(scene, camera);
  scene.remove(holder);
  group.traverse((o) => o.geometry?.dispose());
  ctx.drawImage(renderer.domElement, 0, 0, size, size);
  return true;
}
