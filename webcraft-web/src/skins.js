// Textured mob models: boxes with the classic Minecraft texture layout, so mob pictures of a resource
// pack (the built-in Pixel Perfection CE ones: entity/*.png) fit. Models are written in Minecraft's model
// space: pixels, y points DOWN, the ground is at y = 24, the front is -z. One rotation at the end turns
// that into our space (y up, front +z).
import * as THREE from 'three';
import { pack } from './pack.js';

// ------------------------------------------------------------------ textures

const textures = new Map();   // image -> THREE.Texture

function textureOf(path) {
  const img = pack.image(path);
  if (!img) return null;
  let t = textures.get(img);
  if (!t) {
    t = new THREE.Texture(img);
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
    t.colorSpace = THREE.NoColorSpace;   // like the block atlas
    t.needsUpdate = true;
    textures.set(img, t);
  }
  return t;
}

// Skins of players: texture hash -> THREE.Texture, 'loading', or null (not available)
const playerSkins = new Map();
let askForSkin = null;

/** main.js: how to ask the server for a skin picture ({t: 'skin', h}). */
export function setSkinRequester(fn) { askForSkin = fn; }

/** `skin` message: the PNG (base64) of a texture hash, or nothing when the server could not get it. */
export function addPlayerSkin(hash, base64) {
  if (!base64) { playerSkins.set(hash, null); return; }
  const img = new Image();
  img.onload = () => {
    const t = new THREE.Texture(cleanSkin(img));
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
    t.colorSpace = THREE.NoColorSpace;
    t.needsUpdate = true;
    playerSkins.set(hash, t);
  };
  img.onerror = () => playerSkins.set(hash, null);
  img.src = 'data:image/png;base64,' + base64;
}

/**
 * Like Minecraft: the base layer is always opaque, and an old 64x32 skin whose hat layer has no see-through
 * pixel at all (often painted black) gets no hat ("Notch transparency hack").
 */
function cleanSkin(img) {
  const c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0);
  const k = img.width / 64;   // HD skins
  const data = g.getImageData(0, 0, c.width, c.height);
  const px = data.data;
  const region = (x0, y0, x1, y1, fn) => {
    for (let y = y0 * k; y < y1 * k; y++) for (let x = x0 * k; x < x1 * k; x++) fn((y * c.width + x) * 4);
  };
  const noAlpha = (x0, y0, x1, y1) => region(x0, y0, x1, y1, (i) => { px[i + 3] = 255; });
  noAlpha(0, 0, 32, 16);
  if (img.height * 2 === img.width) {
    let seeThrough = false;
    region(32, 0, 64, 32, (i) => { if (px[i + 3] < 128) seeThrough = true; });
    if (!seeThrough) region(32, 0, 64, 32, (i) => { px[i + 3] = 0; });
    noAlpha(0, 16, 64, 32);
  } else {
    noAlpha(0, 16, 64, 32);
    noAlpha(16, 48, 48, 64);
  }
  g.putImageData(data, 0, 0);
  return c;
}

/** True once the picture is there (entities rebuild the model then). */
export function skinLoaded(hash) { return playerSkins.get(hash) instanceof THREE.Texture; }

function playerTexture(hash) {
  const t = playerSkins.get(hash);
  if (t === undefined && askForSkin) { playerSkins.set(hash, 'loading'); askForSkin(hash); }
  return t instanceof THREE.Texture ? t : null;
}

// ------------------------------------------------------------------ boxes

/**
 * Box [u, v, x, y, z, w, h, d, inflate, mirror] in model pixels relative to its part's pivot.
 * The texture layout is Minecraft's: top and bottom in the first row, then right, front, left, back.
 */
function boxGeometry(b, tw, th) {
  const [u, v, x, y, z, w, h, d, inf = 0, mirror = false] = b;
  const x0 = x - inf, x1 = x + w + inf, y0 = y - inf, y1 = y + h + inf, z0 = z - inf, z1 = z + d + inf;
  // Faces as seen from outside: corners top-left, top-right, bottom-left, bottom-right, and the picture rect
  // ("top" of a picture is -y, the model's up). Front is -z.
  let right = [u, v + d, d, h], left = [u + d + w, v + d, d, h];
  if (mirror) [right, left] = [left, right];
  const faces = [
    { n: [0, 0, -1], c: [[x0, y0, z0], [x1, y0, z0], [x0, y1, z0], [x1, y1, z0]], r: [u + d, v + d, w, h] },          // front
    { n: [0, 0, 1], c: [[x1, y0, z1], [x0, y0, z1], [x1, y1, z1], [x0, y1, z1]], r: [u + 2 * d + w, v + d, w, h] },   // back
    { n: [-1, 0, 0], c: [[x0, y0, z1], [x0, y0, z0], [x0, y1, z1], [x0, y1, z0]], r: right },                       // right side
    { n: [1, 0, 0], c: [[x1, y0, z0], [x1, y0, z1], [x1, y1, z0], [x1, y1, z1]], r: left },                         // left side
    { n: [0, -1, 0], c: [[x0, y0, z1], [x1, y0, z1], [x0, y0, z0], [x1, y0, z0]], r: [u + d, v, w, d] },            // top
    { n: [0, 1, 0], c: [[x0, y1, z0], [x1, y1, z0], [x0, y1, z1], [x1, y1, z1]], r: [u + d + w, v, w, d] },         // bottom
  ];
  const pos = [], nor = [], uv = [], idx = [];
  for (const f of faces) {
    const base = pos.length / 3;
    let [ru, rv, rw, rh] = f.r;
    let ua = ru / tw, ub = (ru + rw) / tw;
    if (mirror) [ua, ub] = [ub, ua];
    const va = 1 - rv / th, vb = 1 - (rv + rh) / th;
    const uvs = [[ua, va], [ub, va], [ua, vb], [ub, vb]];
    for (let i = 0; i < 4; i++) {
      pos.push(...f.c[i]);
      nor.push(...f.n);
      uv.push(...uvs[i]);
    }
    idx.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

// ------------------------------------------------------------------ models (Minecraft model space)

// part: { pivot: [x, y, z], rot: [x, y, z] (radians), boxes: [...], parent?: name }
const L = (u, v) => [u, v];   // readability for texture origins

const BIPED_PARTS = (wide, slim = false) => ({
  head: { pivot: [0, 0, 0], boxes: [[...L(0, 0), -4, -8, -4, 8, 8, 8], [...L(32, 0), -4, -8, -4, 8, 8, 8, 0.5]] },
  body: { pivot: [0, 0, 0], boxes: [[...L(16, 16), -4, 0, -2, 8, 12, 4], ...(wide ? [[...L(16, 32), -4, 0, -2, 8, 12, 4, 0.25]] : [])] },
  // Slim ("Alex") skins have arms 3 pixels wide
  rightArm: slim ? { pivot: [-5, 2, 0], boxes: [[...L(40, 16), -2, -2, -2, 3, 12, 4], [...L(40, 32), -2, -2, -2, 3, 12, 4, 0.25]] }
    : { pivot: [-5, 2, 0], boxes: [[...L(40, 16), -3, -2, -2, 4, 12, 4], ...(wide ? [[...L(40, 32), -3, -2, -2, 4, 12, 4, 0.25]] : [])] },
  leftArm: { pivot: [5, 2, 0], boxes: slim ? [[...L(32, 48), -1, -2, -2, 3, 12, 4], [...L(48, 48), -1, -2, -2, 3, 12, 4, 0.25]]
    : wide ? [[...L(32, 48), -1, -2, -2, 4, 12, 4], [...L(48, 48), -1, -2, -2, 4, 12, 4, 0.25]]
    : [[...L(40, 16), -1, -2, -2, 4, 12, 4, 0, true]] },
  rightLeg: { pivot: [-1.9, 12, 0], boxes: [[...L(0, 16), -2, 0, -2, 4, 12, 4], ...(wide ? [[...L(0, 32), -2, 0, -2, 4, 12, 4, 0.25]] : [])] },
  leftLeg: { pivot: [1.9, 12, 0], boxes: wide ? [[...L(16, 48), -2, 0, -2, 4, 12, 4], [...L(0, 48), -2, 0, -2, 4, 12, 4, 0.25]]
    : [[...L(0, 16), -2, 0, -2, 4, 12, 4, 0, true]] },
});

const SKELETON_PARTS = {
  head: { pivot: [0, 0, 0], boxes: [[...L(0, 0), -4, -8, -4, 8, 8, 8], [...L(32, 0), -4, -8, -4, 8, 8, 8, 0.5]] },
  body: { pivot: [0, 0, 0], boxes: [[...L(16, 16), -4, 0, -2, 8, 12, 4]] },
  rightArm: { pivot: [-5, 2, 0], boxes: [[...L(40, 16), -1, -2, -1, 2, 12, 2]] },
  leftArm: { pivot: [5, 2, 0], boxes: [[...L(40, 16), -1, -2, -1, 2, 12, 2, 0, true]] },
  rightLeg: { pivot: [-2, 12, 0], boxes: [[...L(0, 16), -1, 0, -1, 2, 12, 2]] },
  leftLeg: { pivot: [2, 12, 0], boxes: [[...L(0, 16), -1, 0, -1, 2, 12, 2, 0, true]] },
};

const VILLAGER_PARTS = (zombie) => ({
  // Head, nose and the hat layer (job hats, hoods; see-through in most pictures)
  head: { pivot: [0, 0, 0], boxes: [[...L(0, 0), -4, -10, -4, 8, 10, 8], [...L(24, 0), -1, -3, -6, 2, 4, 2],
    [...L(32, 0), -4, -10, -4, 8, 10, 8, 0.51]] },
  body: { pivot: [0, 0, 0], boxes: [[...L(16, 20), -4, 0, -3, 8, 12, 6], [...L(0, 38), -4, 0, -3, 8, 18, 6, 0.5]] },
  ...(zombie ? {
    rightArm: { pivot: [-5, 2, 0], boxes: [[...L(44, 22), -3, -2, -2, 4, 12, 4]] },
    leftArm: { pivot: [5, 2, 0], boxes: [[...L(44, 22), -1, -2, -2, 4, 12, 4, 0, true]] },
  } : {
    // Arms crossed in front of the belly
    arms: { pivot: [0, 3, -1], rot: [-0.75, 0, 0], boxes: [[...L(44, 22), -8, -2, -2, 4, 8, 4], [...L(44, 22), 4, -2, -2, 4, 8, 4, 0, true],
      [...L(40, 38), -4, 2, -2, 8, 4, 4]] },
  }),
  rightLeg: { pivot: [-2, 12, 0], boxes: [[...L(0, 22), -2, 0, -2, 4, 12, 4]] },
  leftLeg: { pivot: [2, 12, 0], boxes: [[...L(0, 22), -2, 0, -2, 4, 12, 4, 0, true]] },
});

const QUAD_LEGS = (legH, xs, zs, u = 0, v = 16) => {
  const out = {};
  const names = ['legBackRight', 'legBackLeft', 'legFrontRight', 'legFrontLeft'];
  [[xs[0], zs[0]], [xs[1], zs[0]], [xs[0], zs[1]], [xs[1], zs[1]]].forEach(([x, z], i) => {
    out[names[i]] = { pivot: [x, 24 - legH, z], boxes: [[u, v, -2, 0, -2, 4, legH, 4, 0, i % 2 === 1]] };
  });
  return out;
};

const HALF_PI = Math.PI / 2;

// Piglins: the player body with a wide snout head and ears
const PIGLIN_PARTS = {
  ...BIPED_PARTS(true),
  head: { pivot: [0, 0, 0], boxes: [[0, 0, -5, -8, -4, 10, 8, 8], [31, 1, -2, -4, -5, 4, 4, 1], [2, 4, 2, -2, -5, 1, 2, 1],
    [2, 0, -3, -2, -5, 1, 2, 1], [51, 6, 4.5, -6, -2, 1, 5, 4], [39, 6, -5.5, -6, -2, 1, 5, 4]] },
};

// Horses, donkeys, mules (64x64 layout since Minecraft 1.14)
const HORSE_PARTS = {
  body: { pivot: [0, 11, 5], boxes: [[0, 32, -5, -8, -17, 10, 10, 22, 0.05]] },
  tail: { pivot: [0, 6, 7], rot: [Math.PI / 6, 0, 0], boxes: [[42, 36, -1.5, 0, 0, 3, 14, 4]] },
  head: { pivot: [0, 4, -12], rot: [Math.PI / 6, 0, 0], boxes: [[0, 35, -2.05, -6, -2, 4, 12, 7], [0, 13, -3, -11, -2, 6, 5, 7],
    [56, 36, -1, -11, 5.01, 2, 16, 2], [0, 25, -2, -11, -7, 4, 5, 5], [19, 16, 0.55, -13, 4, 2, 3, 1], [19, 16, -2.55, -13, 4, 2, 3, 1]] },
  legBackRight: { pivot: [-4, 14, 7], boxes: [[48, 21, -1, -1.01, -1, 4, 11, 4]] },
  legBackLeft: { pivot: [4, 14, 7], boxes: [[48, 21, -3, -1.01, -1, 4, 11, 4, 0, true]] },
  legFrontRight: { pivot: [-4, 14, -12], boxes: [[48, 21, -1, -1.01, -1.9, 4, 11, 4]] },
  legFrontLeft: { pivot: [4, 14, -12], boxes: [[48, 21, -3, -1.01, -1.9, 4, 11, 4, 0, true]] },
};

/**
 * Silverfish and endermite: segments in a row along z, each standing on the ground (Minecraft's placement),
 * plus extra boxes that need the segment positions.
 */
function segments(sizes, tex, extra = () => []) {
  const z = [];
  let f = -3.5;
  sizes.forEach((sz, i) => { z.push(f); if (i < sizes.length - 1) f += (sz[2] + sizes[i + 1][2]) * 0.5; });
  return [...sizes.map(([w, h, d], i) => [tex[i][0], tex[i][1], -w / 2, 24 - h, z[i] - d / 2, w, h, d]), ...extra(z)];
}

const MODELS = {
  biped: { tw: 64, th: 64, parts: BIPED_PARTS(true), kind: 'biped' },
  biped32: { tw: 64, th: 32, parts: BIPED_PARTS(false), kind: 'biped' },
  biped_slim: { tw: 64, th: 64, parts: BIPED_PARTS(true, true), kind: 'biped' },
  piglin: { tw: 64, th: 64, parts: PIGLIN_PARTS, kind: 'biped' },
  // Witch: villager with the pointed hat (64x128 picture)
  witch: {
    tw: 64, th: 128, kind: 'biped',
    parts: {
      ...VILLAGER_PARTS(false),
      head: { pivot: [0, 0, 0], boxes: [[0, 0, -4, -10, -4, 8, 10, 8], [24, 0, -1, -3, -6, 2, 4, 2], [0, 64, -5, -10.03, -5, 10, 2, 10],
        [0, 76, -3.25, -14, -3, 7, 4, 7], [0, 87, -1.5, -17.5, -1, 4, 4, 4], [0, 95, 0.25, -19.5, 1, 1, 2, 1, 0.25]] },
    },
  },
  iron_golem: {
    tw: 128, th: 128, kind: 'biped',
    parts: {
      head: { pivot: [0, -7, -2], boxes: [[0, 0, -4, -12, -5.5, 8, 10, 8], [24, 0, -1, -5, -7.5, 2, 4, 2]] },
      body: { pivot: [0, -7, 0], boxes: [[0, 40, -9, -2, -6, 18, 12, 11], [0, 70, -4.5, 10, -3, 9, 5, 6, 0.5]] },
      rightArm: { pivot: [0, -7, 0], boxes: [[60, 21, -13, -2.5, -3, 4, 30, 6]] },
      leftArm: { pivot: [0, -7, 0], boxes: [[60, 58, 9, -2.5, -3, 4, 30, 6]] },
      rightLeg: { pivot: [-4, 11, 0], boxes: [[37, 0, -3.5, -3, -3, 6, 16, 5]] },
      leftLeg: { pivot: [5, 11, 0], boxes: [[60, 0, -3.5, -3, -3, 6, 16, 5, 0, true]] },
    },
  },
  snow_golem: {
    tw: 64, th: 64, kind: 'none',
    parts: {
      head: { pivot: [0, 4, 0], boxes: [[0, 0, -4, -8, -4, 8, 8, 8, -0.5]] },
      upperBody: { pivot: [0, 13, 0], boxes: [[0, 16, -5, -10, -5, 10, 10, 10, -0.5]] },
      lowerBody: { pivot: [0, 24, 0], boxes: [[0, 36, -6, -12, -6, 12, 12, 12, -0.5]] },
      armLeft: { pivot: [4, 6, 0], rot: [0, 0, -0.6], boxes: [[32, 0, -1, 0, -1, 12, 2, 2, -0.5]] },
      armRight: { pivot: [-4, 6, 0], rot: [0, Math.PI, 0.6], boxes: [[32, 0, -1, 0, -1, 12, 2, 2, -0.5]] },
    },
  },
  cat: {
    tw: 64, th: 32, kind: 'quad',
    parts: {
      head: { pivot: [0, 15, -9], boxes: [[0, 0, -2.5, -2, -3, 5, 4, 5], [0, 24, -1.5, 0, -4, 3, 2, 2], [0, 10, -2, -3, 0, 1, 1, 2],
        [6, 10, 1, -3, 0, 1, 1, 2]] },
      body: { pivot: [0, 12, -10], rot: [HALF_PI, 0, 0], boxes: [[20, 0, -2, 3, -8, 4, 16, 6]] },
      tail1: { pivot: [0, 15, 8], rot: [0.9, 0, 0], boxes: [[0, 15, -0.5, 0, 0, 1, 8, 1]] },
      tail2: { pivot: [0, 20, 14], rot: [1.7, 0, 0], boxes: [[4, 15, -0.5, 0, 0, 1, 8, 1]] },
      legBackRight: { pivot: [-1.1, 18, 5], boxes: [[8, 13, -1, 0, 1, 2, 6, 2]] },
      legBackLeft: { pivot: [1.1, 18, 5], boxes: [[8, 13, -1, 0, 1, 2, 6, 2]] },
      legFrontRight: { pivot: [-1.2, 14.1, -5], boxes: [[40, 0, -1, 0, 0, 2, 10, 2]] },
      legFrontLeft: { pivot: [1.2, 14.1, -5], boxes: [[40, 0, -1, 0, 0, 2, 10, 2]] },
    },
  },
  fox: {
    tw: 48, th: 32, kind: 'quad',
    parts: {
      head: { pivot: [-1, 16.5, -3], boxes: [[1, 5, -3, -2, -5, 8, 6, 6], [8, 1, -3, -4, -4, 2, 2, 1], [15, 1, 3, -4, -4, 2, 2, 1],
        [6, 18, -1, 2.01, -8, 4, 2, 3]] },
      body: { pivot: [0, 16, -6], rot: [HALF_PI, 0, 0], boxes: [[24, 15, -3, 3.999, -3.5, 6, 11, 6]] },
      tail: { pivot: [-4, 17, 9], rot: [HALF_PI - 0.05, 0, 0], boxes: [[30, 0, 2, 0, -1, 4, 9, 5]] },
      legBackRight: { pivot: [-5, 17.5, 7], boxes: [[13, 24, 2, 0.5, -1, 2, 6, 2]] },
      legBackLeft: { pivot: [-1, 17.5, 7], boxes: [[4, 24, 2, 0.5, -1, 2, 6, 2]] },
      legFrontRight: { pivot: [-5, 17.5, 0], boxes: [[13, 24, 2, 0.5, -1, 2, 6, 2]] },
      legFrontLeft: { pivot: [-1, 17.5, 0], boxes: [[4, 24, 2, 0.5, -1, 2, 6, 2]] },
    },
  },
  bee: {
    tw: 64, th: 64, kind: 'none',
    parts: {
      body: { pivot: [0, 19, 0], boxes: [[0, 0, -3.5, -4, -5, 7, 7, 10], [26, 7, 0, -1, 5, 0, 1, 2]] },
      head: { pivot: [0, 17, -5], boxes: [[2, 0, 1.5, -2, -3, 1, 2, 3], [2, 3, -2.5, -2, -3, 1, 2, 3]] },
      wingRight: { pivot: [-1.5, 15, -3], rot: [0, -0.2618, 0], boxes: [[0, 18, -9, 0, 0, 9, 0, 6, 0.001]] },
      wingLeft: { pivot: [1.5, 15, -3], rot: [0, 0.2618, 0], boxes: [[0, 18, 0, 0, 0, 9, 0, 6, 0.001, true]] },
      legs: { pivot: [1.5, 22, 0], boxes: [[26, 1, -5, 0, -2, 7, 2, 0], [26, 3, -5, 0, 0, 7, 2, 0], [26, 5, -5, 0, 2, 7, 2, 0]] },
    },
  },
  horse: { tw: 64, th: 64, kind: 'quad', parts: HORSE_PARTS },
  slime: {
    tw: 64, th: 32, kind: 'none',
    parts: {
      body: { pivot: [0, 0, 0], boxes: [[0, 16, -3, 17, -3, 6, 6, 6], [32, 0, -3.25, 18, -3.5, 2, 2, 2], [32, 4, 1.25, 18, -3.5, 2, 2, 2],
        [32, 8, 0, 21, -3.5, 1, 1, 1]] },
    },
  },
  // The see-through outer cube of the slime
  slime_outer: { tw: 64, th: 32, parts: { body: { pivot: [0, 0, 0], boxes: [[0, 0, -4, 16, -4, 8, 8, 8]] } } },
  magma_cube: {
    tw: 64, th: 32, kind: 'none',
    parts: {
      body: { pivot: [0, 0, 0], boxes: [[0, 16, -2, 18, -2, 4, 4, 4], ...[0, 1, 2, 3, 4, 5, 6, 7].map((i) =>
        [i === 2 || i === 3 ? 24 : 0, i === 2 ? 10 : i === 3 ? 19 : i, -4, 16 + i, -4, 8, 1, 8])] },
    },
  },
  polar_bear: {
    tw: 128, th: 64, kind: 'quad',
    parts: {
      head: { pivot: [0, 10, -16], boxes: [[0, 0, -3.5, -3, -3, 7, 7, 7], [0, 44, -2.5, 1, -6, 5, 3, 3], [26, 0, -4.5, -4, -1, 2, 2, 1],
        [26, 0, 2.5, -4, -1, 2, 2, 1, 0, true]] },
      body: { pivot: [-2, 9, 12], rot: [HALF_PI, 0, 0], boxes: [[0, 19, -5, -13, -7, 14, 14, 11], [39, 0, -4, -25, -7, 12, 12, 10]] },
      legBackRight: { pivot: [-4.5, 14, 6], boxes: [[50, 22, -2, 0, -2, 4, 10, 8]] },
      legBackLeft: { pivot: [4.5, 14, 6], boxes: [[50, 22, -2, 0, -2, 4, 10, 8]] },
      legFrontRight: { pivot: [-3.5, 14, -8], boxes: [[50, 40, -2, 0, -2, 4, 10, 6]] },
      legFrontLeft: { pivot: [3.5, 14, -8], boxes: [[50, 40, -2, 0, -2, 4, 10, 6]] },
    },
  },
  panda: {
    tw: 64, th: 64, kind: 'quad',
    parts: {
      head: { pivot: [0, 11.5, -17], boxes: [[0, 6, -6.5, -5, -4, 13, 10, 9], [45, 16, -3.5, 0, -6, 7, 5, 2], [52, 25, -8.5, -8, -1, 5, 4, 1],
        [52, 25, 3.5, -8, -1, 5, 4, 1, 0, true]] },
      body: { pivot: [0, 10, 0], rot: [HALF_PI, 0, 0], boxes: [[0, 25, -9.5, -13, -6.5, 19, 26, 13]] },
      legBackRight: { pivot: [-5.5, 15, 9], boxes: [[40, 0, -3, 0, -3, 6, 9, 6]] },
      legBackLeft: { pivot: [5.5, 15, 9], boxes: [[40, 0, -3, 0, -3, 6, 9, 6]] },
      legFrontRight: { pivot: [-5.5, 15, -9], boxes: [[40, 0, -3, 0, -3, 6, 9, 6]] },
      legFrontLeft: { pivot: [5.5, 15, -9], boxes: [[40, 0, -3, 0, -3, 6, 9, 6]] },
    },
  },
  rabbit: {
    tw: 64, th: 32, kind: 'quad',
    parts: {
      head: { pivot: [0, 16, -1], boxes: [[32, 0, -2.5, -4, -5, 5, 4, 5], [52, 0, -2.5, -9, -1, 2, 5, 1], [58, 0, 0.5, -9, -1, 2, 5, 1],
        [32, 9, -0.5, -2.5, -5.5, 1, 1, 1]] },
      body: { pivot: [0, 19, 8], rot: [-0.349, 0, 0], boxes: [[0, 0, -3, -2, -10, 6, 5, 10]] },
      haunches: { pivot: [0, 17.5, 3.7], rot: [-0.349, 0, 0], boxes: [[16, 15, -4, 0, 0, 2, 4, 5], [30, 15, 2, 0, 0, 2, 4, 5]] },
      tail: { pivot: [0, 20, 7], rot: [-0.349, 0, 0], boxes: [[52, 6, -1.5, -1.5, 0, 3, 3, 2]] },
      legBackRight: { pivot: [-3, 17.5, 3.7], boxes: [[8, 24, -1, 5.5, -3.7, 2, 1, 7]] },
      legBackLeft: { pivot: [3, 17.5, 3.7], boxes: [[26, 24, -1, 5.5, -3.7, 2, 1, 7]] },
      legFrontRight: { pivot: [-3, 17, -1], rot: [-0.1745, 0, 0], boxes: [[0, 15, -1, 0, -1, 2, 7, 2]] },
      legFrontLeft: { pivot: [3, 17, -1], rot: [-0.1745, 0, 0], boxes: [[8, 15, -1, 0, -1, 2, 7, 2]] },
    },
  },
  llama: {
    tw: 128, th: 64, kind: 'quad',
    parts: {
      head: { pivot: [0, 7, -6], boxes: [[0, 0, -2, -14, -10, 4, 4, 9], [0, 14, -4, -16, -6, 8, 18, 6], [17, 0, -4, -19, -4, 3, 3, 2],
        [17, 0, 1, -19, -4, 3, 3, 2]] },
      body: { pivot: [0, 5, 2], rot: [HALF_PI, 0, 0], boxes: [[29, 0, -6, -10, -7, 12, 18, 10]] },
      legBackRight: { pivot: [-3.5, 10, 6], boxes: [[29, 29, -2, 0, -2, 4, 14, 4]] },
      legBackLeft: { pivot: [3.5, 10, 6], boxes: [[29, 29, -2, 0, -2, 4, 14, 4]] },
      legFrontRight: { pivot: [-3.5, 10, -5], boxes: [[29, 29, -2, 0, -2, 4, 14, 4]] },
      legFrontLeft: { pivot: [3.5, 10, -5], boxes: [[29, 29, -2, 0, -2, 4, 14, 4]] },
    },
  },
  skeleton: { tw: 64, th: 32, parts: SKELETON_PARTS, kind: 'biped' },
  villager: { tw: 64, th: 64, parts: VILLAGER_PARTS(false), kind: 'biped' },
  zombie_villager: { tw: 64, th: 64, parts: VILLAGER_PARTS(true), kind: 'biped' },
  // ---- rarer mobs (Minecraft 1.17+ models; children of a part are written in its coordinates)
  parrot: {
    tw: 32, th: 32, kind: 'none',
    parts: {
      body: { pivot: [0, 16.5, -3], rot: [0.4937, 0, 0], boxes: [[2, 8, -1.5, 0, -1.5, 3, 6, 3]] },
      tail: { pivot: [0, 21.07, 1.16], rot: [1.015, 0, 0], boxes: [[22, 1, -1.5, -1, -1, 3, 4, 1]] },
      wingLeft: { pivot: [1.5, 16.94, -2.76], rot: [-0.6981, -Math.PI, 0], order: 'ZYX', boxes: [[19, 8, -0.5, 0, -1.5, 1, 5, 3]] },
      wingRight: { pivot: [-1.5, 16.94, -2.76], rot: [-0.6981, -Math.PI, 0], order: 'ZYX', boxes: [[19, 8, -0.5, 0, -1.5, 1, 5, 3]] },
      head: { pivot: [0, 15.69, -2.76], boxes: [[2, 2, -1, -1.5, -1, 2, 3, 2], [10, 0, -1, -2.5, -3, 2, 1, 4], [11, 7, -0.5, -1.5, -2, 1, 2, 1],
        [16, 7, -0.5, -1.75, -2.95, 1, 2, 1], [2, 18, 0, -6.15, -1.85, 0, 5, 4]] },
      legs: { pivot: [0, 22, -1.05], boxes: [[14, 18, 0.5, 0, -0.5, 1, 2, 1], [14, 18, -1.5, 0, -0.5, 1, 2, 1]] },
    },
  },
  cod: {
    tw: 32, th: 32, kind: 'none',
    parts: {
      body: { pivot: [0, 22, 0], boxes: [[0, 0, -1, -2, 0, 2, 4, 7], [11, 0, -1, -2, -3, 2, 4, 3], [0, 0, -1, -2, -4, 2, 3, 1],
        [20, -6, 0, -3, -1, 0, 1, 6], [22, 3, 0, -2, 7, 0, 4, 4]] },
      finRight: { pivot: [-1, 23, 0], rot: [0, 0, -Math.PI / 4], boxes: [[22, 1, -2, 0, -1, 2, 0, 2]] },
      finLeft: { pivot: [1, 23, 0], rot: [0, 0, Math.PI / 4], boxes: [[22, 4, 0, 0, -1, 2, 0, 2]] },
    },
  },
  salmon: {
    tw: 32, th: 32, kind: 'none',
    parts: {
      body: { pivot: [0, 20, 0], boxes: [[0, 0, -1.5, -2.5, 0, 3, 5, 8], [0, 13, -1.5, -2.5, 8, 3, 5, 8], [22, 0, -1, -2, -3, 2, 4, 3],
        [20, 10, 0, -2.5, 16, 0, 5, 6], [2, 1, 0, -4.5, 5, 0, 2, 3], [0, 2, 0, -4.5, 7, 0, 2, 4]] },
      finRight: { pivot: [-1.5, 21.5, 0], rot: [0, 0, -Math.PI / 4], boxes: [[-4, 0, -2, 0, 0, 2, 0, 2]] },
      finLeft: { pivot: [1.5, 21.5, 0], rot: [0, 0, Math.PI / 4], boxes: [[0, 0, 0, 0, 0, 2, 0, 2]] },
    },
  },
  pufferfish: {
    tw: 32, th: 32, kind: 'none',
    parts: {
      body: { pivot: [0, 23, 0], boxes: [[0, 27, -1.5, -2, -1.5, 3, 2, 3], [24, 6, -1.5, -3, -1.5, 1, 1, 1], [28, 6, 0.5, -3, -1.5, 1, 1, 1],
        [-3, 0, -1.5, -1, 1.5, 3, 0, 3], [25, 0, -2.5, -1, -1.5, 1, 0, 2], [25, 0, 1.5, -1, -1.5, 1, 0, 2]] },
    },
  },
  ghast: {
    tw: 64, th: 32, kind: 'none',
    parts: {
      head: { pivot: [0, 17.6, 0], boxes: [[0, 0, -8, -8, -8, 16, 16, 16]] },
      tentacles: { pivot: [0, 24.6, 0], boxes: [9, 12, 8, 11, 10, 13, 8, 12, 10].map((len, i) => [0, 0,
        ((i % 3 - Math.floor(i / 3) % 2 * 0.5 + 0.25) / 2 * 2 - 1) * 5 - 1, 0, (Math.floor(i / 3) / 2 * 2 - 1) * 5 - 1, 2, len, 2]) },
    },
  },
  blaze: {
    tw: 64, th: 32, kind: 'none',
    parts: {
      head: { pivot: [0, 0, 0], boxes: [[0, 0, -4, -4, -4, 8, 8, 8]] },
      // Twelve rods in three rings (still: Minecraft turns them around the body)
      rods: { pivot: [0, 0, 0], boxes: [[9, -2, Math.PI / 4], [7, 2, 0], [5, 11, Math.PI / 4]].flatMap(([r, y, a0]) =>
        [0, 1, 2, 3].map((k) => [0, 16, Math.cos(a0 + k * Math.PI / 2) * r - 1, y, Math.sin(a0 + k * Math.PI / 2) * r - 1, 2, 8, 2])) },
    },
  },
  squid: {
    tw: 64, th: 32, kind: 'none',
    parts: {
      body: { pivot: [0, 8, 0], boxes: [[0, 0, -6, -8, -6, 12, 16, 12]] },
      tentacles: { pivot: [0, 15, 0], boxes: [0, 1, 2, 3, 4, 5, 6, 7].map((i) =>
        [48, 0, Math.cos(i * Math.PI / 4) * 5 - 1, 0, Math.sin(i * Math.PI / 4) * 5 - 1, 2, 18, 2]) },
    },
  },
  silverfish: {
    tw: 64, th: 32, kind: 'none',
    parts: { body: { pivot: [0, 0, 0], boxes: segments(
      [[3, 2, 2], [4, 3, 2], [6, 4, 3], [3, 3, 3], [2, 2, 3], [2, 1, 2], [1, 1, 2]],
      [[0, 0], [0, 4], [0, 9], [0, 16], [0, 22], [11, 0], [13, 4]],
      (z) => [[20, 0, -5, 16, z[2] - 1.5, 10, 8, 3], [20, 11, -3, 20, z[4] - 1.5, 6, 4, 3], [20, 18, -3, 19, z[1] - 1, 6, 5, 2]]) } },
  },
  endermite: {
    tw: 64, th: 32, kind: 'none',
    parts: { body: { pivot: [0, 0, 0], boxes: segments([[4, 3, 2], [6, 4, 5], [3, 3, 1], [1, 2, 1]], [[0, 0], [0, 5], [0, 14], [0, 18]]) } },
  },
  guardian: {
    tw: 64, th: 64, kind: 'none',
    parts: {
      head: { pivot: [0, 0, 0], boxes: [[0, 0, -6, 10, -8, 12, 12, 16], [0, 28, -8, 10, -6, 2, 12, 12], [0, 28, 6, 10, -6, 2, 12, 12, 0, true],
        [16, 40, -6, 8, -6, 12, 2, 12], [16, 40, -6, 22, -6, 12, 2, 12], [8, 0, -1, 15, -8.25, 2, 2, 1]] },
      tail: { pivot: [0, 0, 0], boxes: [[40, 0, -2, 14, 7, 4, 4, 8]] },
      tail1: { pivot: [-1.5, 0.5, 14], boxes: [[0, 54, 0, 14, 0, 3, 3, 7]] },
      tail2: { pivot: [-1, 1, 20], boxes: [[41, 32, 0, 14, 0, 2, 2, 6], [25, 19, 1, 10.5, 3, 1, 9, 9]] },
    },
  },
  turtle: {
    tw: 128, th: 64, kind: 'quad',
    parts: {
      head: { pivot: [0, 19, -10], boxes: [[3, 0, -3, -1, -3, 6, 5, 6]] },
      body: { pivot: [0, 11, -10], rot: [HALF_PI, 0, 0], boxes: [[7, 37, -9.5, 3, -10, 19, 20, 6], [31, 1, -5.5, 3, -13, 11, 18, 3]] },
      legBackRight: { pivot: [-3.5, 22, 11], boxes: [[1, 23, -2, 0, 0, 4, 1, 10]] },
      legBackLeft: { pivot: [3.5, 22, 11], boxes: [[1, 12, -2, 0, 0, 4, 1, 10]] },
      legFrontRight: { pivot: [-5, 21, -4], boxes: [[27, 30, -13, 0, -2, 13, 1, 5]] },
      legFrontLeft: { pivot: [5, 21, -4], boxes: [[27, 24, 0, 0, -2, 13, 1, 5]] },
    },
  },
  dolphin: {
    tw: 64, th: 64, kind: 'none',
    parts: {
      body: { pivot: [0, 22, -5], boxes: [[22, 0, -4, -7, 0, 8, 7, 13]] },
      backFin: { pivot: [0, 22, -5], rot: [Math.PI / 3, 0, 0], boxes: [[51, 0, -0.5, 0, 8, 1, 4, 5]] },
      finLeft: { pivot: [2, 20, -1], rot: [Math.PI / 3, 0, 2 * Math.PI / 3], order: 'ZYX', boxes: [[48, 20, -0.5, -4, 0, 1, 4, 7, 0, true]] },
      finRight: { pivot: [-2, 20, -1], rot: [Math.PI / 3, 0, -2 * Math.PI / 3], order: 'ZYX', boxes: [[48, 20, -0.5, -4, 0, 1, 4, 7]] },
      tail: { pivot: [0, 19.5, 6], rot: [-0.10472, 0, 0], boxes: [[0, 19, -2, -2.5, 0, 4, 5, 11]] },
      tailFin: { pivot: [0, 19.5, 15], boxes: [[19, 20, -5, -0.5, 0, 10, 1, 6]] },
      head: { pivot: [0, 18, -8], boxes: [[0, 0, -4, -3, -3, 8, 7, 6], [0, 13, -1, 2, -7, 2, 2, 4]] },
    },
  },
  phantom: {
    tw: 64, th: 64, kind: 'none',
    parts: {
      body: { pivot: [0, 0, 0], rot: [-0.1, 0, 0], boxes: [[0, 8, -3, -2, -8, 5, 3, 9]] },
      tailBase: { pivot: [0, -2, 1], boxes: [[3, 20, -2, 0, 0, 3, 2, 6]] },
      tailTip: { pivot: [0, -1.5, 7], boxes: [[4, 29, -1, 0, 0, 1, 1, 6]] },
      wingLeft: { pivot: [2, -2, -8], rot: [0, 0, 0.1], boxes: [[23, 12, 0, 0, 0, 6, 2, 9]] },
      wingLeftTip: { pivot: [8, -2, -8], rot: [0, 0, 0.1], boxes: [[16, 24, 0, 0, 0, 13, 1, 9]] },
      wingRight: { pivot: [-3, -2, -8], rot: [0, 0, -0.1], boxes: [[23, 12, -6, 0, 0, 6, 2, 9, 0, true]] },
      wingRightTip: { pivot: [-9, -2, -8], rot: [0, 0, -0.1], boxes: [[16, 24, -13, 0, 0, 13, 1, 9, 0, true]] },
      head: { pivot: [0, 1, -7], rot: [0.2, 0, 0], boxes: [[0, 0, -4, -2, -5, 7, 3, 5]] },
    },
  },
  hoglin: {
    tw: 128, th: 64, kind: 'quad',
    parts: {
      head: { pivot: [0, 2, -12], rot: [0.87, 0, 0], boxes: [[61, 1, -7, -3, -19, 14, 6, 19], [1, 1, -12, -3, -5, 6, 1, 4],
        [1, 6, 6, -3, -5, 6, 1, 4], [10, 13, -8, -9, -13, 2, 11, 2], [1, 13, 6, -9, -13, 2, 11, 2]] },
      body: { pivot: [0, 7, 0], boxes: [[1, 1, -8, -7, -13, 16, 14, 26], [90, 33, 0, -14, -14, 0, 10, 19, 0.001]] },
      legFrontRight: { pivot: [-4, 10, -8.5], boxes: [[66, 42, -3, 0, -3, 6, 14, 6]] },
      legFrontLeft: { pivot: [4, 10, -8.5], boxes: [[41, 42, -3, 0, -3, 6, 14, 6]] },
      legBackRight: { pivot: [-5, 13, 10], boxes: [[21, 45, -2.5, 0, -2.5, 5, 11, 5]] },
      legBackLeft: { pivot: [5, 13, 10], boxes: [[0, 45, -2.5, 0, -2.5, 5, 11, 5]] },
    },
  },
  strider: {
    tw: 64, th: 128, kind: 'biped',
    parts: {
      body: { pivot: [0, 1, 0], boxes: [[0, 0, -8, -6, -8, 16, 14, 16]] },
      head: { pivot: [0, 1, 0], boxes: [] },
      rightLeg: { pivot: [-4, 8, 0], boxes: [[0, 32, -2, 0, -2, 4, 16, 4]] },
      leftLeg: { pivot: [4, 8, 0], boxes: [[0, 55, -2, 0, -2, 4, 16, 4]] },
    },
  },
  vex: {
    tw: 32, th: 32, kind: 'none',
    parts: {
      head: { pivot: [0, 20, 0], boxes: [[0, 0, -2.5, -5, -2.5, 5, 5, 5]] },
      body: { pivot: [0, 20, 0], boxes: [[0, 10, -1.5, 0, -1, 3, 4, 2], [0, 16, -1.5, 1, -1, 3, 5, 2, -0.2]] },
      rightArm: { pivot: [-1.75, 20.25, 0], boxes: [[23, 0, -1.25, -0.5, -1, 2, 4, 2, -0.1]] },
      leftArm: { pivot: [1.75, 20.25, 0], boxes: [[23, 6, -0.75, -0.5, -1, 2, 4, 2, -0.1]] },
      wingLeft: { pivot: [0.5, 21, 1], rot: [0, 0.4, 0], boxes: [[16, 14, 0, 0, 0, 0, 5, 8, 0, true]] },
      wingRight: { pivot: [-0.5, 21, 1], rot: [0, -0.4, 0], boxes: [[16, 14, 0, 0, 0, 0, 5, 8]] },
    },
  },
  allay: {
    tw: 32, th: 32, kind: 'none',
    parts: {
      head: { pivot: [0, 19.5, 0], boxes: [[0, 0, -2.5, -5, -2.5, 5, 5, 5]] },
      body: { pivot: [0, 19.5, 0], boxes: [[0, 10, -1.5, 0, -1, 3, 4, 2], [0, 16, -1.5, 0, -1, 3, 5, 2, -0.2]] },
      rightArm: { pivot: [-1.75, 20, 0], boxes: [[23, 0, -0.75, -0.5, -1, 1, 4, 2, -0.01]] },
      leftArm: { pivot: [1.75, 20, 0], boxes: [[23, 6, -0.25, -0.5, -1, 1, 4, 2, -0.01]] },
      wingLeft: { pivot: [0.5, 19.5, 0.6], rot: [0, 0.4, 0], boxes: [[16, 14, 0, 1, 0, 0, 5, 8, 0, true]] },
      wingRight: { pivot: [-0.5, 19.5, 0.6], rot: [0, -0.4, 0], boxes: [[16, 14, 0, 1, 0, 0, 5, 8]] },
    },
  },
  shulker: {
    tw: 64, th: 64, kind: 'none',
    parts: {
      body: { pivot: [0, 24, 0], boxes: [[0, 28, -8, -8, -8, 16, 8, 16], [0, 0, -8, -16, -8, 16, 12, 16]] },
      head: { pivot: [0, 12, 0], boxes: [[0, 52, -3, 0, -3, 6, 6, 6]] },
    },
  },
  wither: {
    tw: 64, th: 64, kind: 'none',
    parts: {
      body: { pivot: [0, 0, 0], boxes: [[0, 16, -10, 3.9, -0.5, 20, 3, 3]] },
      ribcage: { pivot: [-2, 6.9, -0.5], rot: [0.2, 0, 0], boxes: [[0, 22, 0, 0, 0, 3, 10, 3], [24, 22, -4, 1.5, 0.5, 11, 2, 2],
        [24, 22, -4, 4, 0.5, 11, 2, 2], [24, 22, -4, 6.5, 0.5, 11, 2, 2]] },
      tail: { pivot: [-2, 6.9 + Math.cos(0.2) * 10, -0.5 + Math.sin(0.2) * 10], rot: [0.83, 0, 0], boxes: [[12, 22, 0, 0, 0, 3, 6, 3]] },
      head: { pivot: [0, 0, 0], boxes: [[0, 0, -4, -4, -4, 8, 8, 8]] },
      headRight: { pivot: [-8, 4, 0], boxes: [[32, 0, -4, -4, -4, 6, 6, 6]] },
      headLeft: { pivot: [10, 4, 0], boxes: [[32, 0, -4, -4, -4, 6, 6, 6]] },
    },
  },
  creeper: {
    tw: 64, th: 32, kind: 'quad',
    parts: {
      head: { pivot: [0, 6, 0], boxes: [[0, 0, -4, -8, -4, 8, 8, 8]] },
      body: { pivot: [0, 6, 0], boxes: [[16, 16, -4, 0, -2, 8, 12, 4]] },
      ...QUAD_LEGS(6, [-2, 2], [4, -4]),
    },
  },
  cow: {
    tw: 64, th: 32, kind: 'quad',
    parts: {
      head: { pivot: [0, 4, -8], boxes: [[0, 0, -4, -4, -6, 8, 8, 6], [22, 0, -5, -5, -4, 1, 3, 1], [22, 0, 4, -5, -4, 1, 3, 1]] },
      body: { pivot: [0, 5, 2], rot: [Math.PI / 2, 0, 0], boxes: [[18, 4, -6, -10, -7, 12, 18, 10], [52, 0, -2, 2, -8, 4, 6, 1]] },
      ...QUAD_LEGS(12, [-4, 4], [7, -6]),
    },
  },
  pig: {
    tw: 64, th: 32, kind: 'quad',
    parts: {
      head: { pivot: [0, 12, -6], boxes: [[0, 0, -4, -4, -8, 8, 8, 8], [16, 16, -2, 0, -9, 4, 3, 1]] },
      body: { pivot: [0, 11, 2], rot: [Math.PI / 2, 0, 0], boxes: [[28, 8, -5, -10, -7, 10, 16, 8]] },
      ...QUAD_LEGS(6, [-3, 3], [7, -5]),
    },
  },
  sheep: {
    tw: 64, th: 32, kind: 'quad',
    parts: {
      head: { pivot: [0, 6, -8], boxes: [[0, 0, -3, -4, -6, 6, 6, 8]] },
      body: { pivot: [0, 5, 2], rot: [Math.PI / 2, 0, 0], boxes: [[28, 8, -4, -10, -7, 8, 16, 6]] },
      ...QUAD_LEGS(12, [-3, 3], [7, -5]),
    },
  },
  // Wool on top of the sheep (sheep_fur.png, colored like the sheep)
  sheep_fur: {
    tw: 64, th: 32,
    parts: {
      head: { pivot: [0, 6, -8], boxes: [[0, 0, -3, -4, -4, 6, 6, 6, 0.6]] },
      body: { pivot: [0, 5, 2], rot: [Math.PI / 2, 0, 0], boxes: [[28, 8, -4, -10, -7, 8, 16, 6, 1.75]] },
      legBackRight: { pivot: [-3, 12, 7], boxes: [[0, 16, -2, 0, -2, 4, 6, 4, 0.5]] },
      legBackLeft: { pivot: [3, 12, 7], boxes: [[0, 16, -2, 0, -2, 4, 6, 4, 0.5, true]] },
      legFrontRight: { pivot: [-3, 12, -5], boxes: [[0, 16, -2, 0, -2, 4, 6, 4, 0.5]] },
      legFrontLeft: { pivot: [3, 12, -5], boxes: [[0, 16, -2, 0, -2, 4, 6, 4, 0.5, true]] },
    },
  },
  chicken: {
    tw: 64, th: 32, kind: 'quad',
    parts: {
      head: { pivot: [0, 15, -4], boxes: [[0, 0, -2, -6, -2, 4, 6, 3], [14, 0, -2, -4, -4, 4, 2, 2], [14, 4, -1, -2, -3, 2, 2, 2]] },
      body: { pivot: [0, 16, 0], rot: [Math.PI / 2, 0, 0], boxes: [[0, 9, -3, -4, -3, 6, 8, 6]] },
      legBackRight: { pivot: [-2, 19, 1], boxes: [[26, 0, -1, 0, -3, 3, 5, 3]] },
      legBackLeft: { pivot: [1, 19, 1], boxes: [[26, 0, -1, 0, -3, 3, 5, 3]] },
      wingRight: { pivot: [-4, 13, 0], boxes: [[24, 13, 0, 0, -3, 1, 4, 6]] },
      wingLeft: { pivot: [4, 13, 0], boxes: [[24, 13, -1, 0, -3, 1, 4, 6]] },
    },
  },
  spider: {
    tw: 64, th: 32, kind: 'spider',
    parts: {
      head: { pivot: [0, 15, -3], boxes: [[32, 4, -4, -4, -8, 8, 8, 8]] },
      neck: { pivot: [0, 15, 0], boxes: [[0, 0, -3, -3, -3, 6, 6, 6]] },
      body: { pivot: [0, 15, 9], boxes: [[0, 12, -5, -4, -6, 10, 8, 12]] },
      ...Object.fromEntries([
        [-4, 2, -0.785, 0.785], [4, 2, 0.785, -0.785], [-4, 1, -0.58, 0.3927], [4, 1, 0.58, -0.3927],
        [-4, 0, -0.58, -0.3927], [4, 0, 0.58, 0.3927], [-4, -1, -0.785, -0.785], [4, -1, 0.785, 0.785],
      ].map(([x, z, rz, ry], i) => ['leg' + i, {
        pivot: [x, 15, z], rot: [0, ry, rz],
        boxes: [[18, 0, x < 0 ? -15 : -1, -1, -1, 16, 2, 2]],
      }])),
    },
  },
  enderman: {
    tw: 64, th: 32, kind: 'biped',
    parts: {
      head: { pivot: [0, -14, 0], boxes: [[0, 0, -4, -8, -4, 8, 8, 8], [0, 16, -4, -8, -4, 8, 8, 8, -0.5]] },
      body: { pivot: [0, -14, 0], boxes: [[32, 16, -4, 0, -2, 8, 12, 4]] },
      rightArm: { pivot: [-5, -12, 0], boxes: [[56, 0, -1, -2, -1, 2, 30, 2]] },
      leftArm: { pivot: [5, -12, 0], boxes: [[56, 0, -1, -2, -1, 2, 30, 2, 0, true]] },
      rightLeg: { pivot: [-2, -2, 0], boxes: [[56, 0, -1, 0, -1, 2, 30, 2]] },
      leftLeg: { pivot: [2, -2, 0], boxes: [[56, 0, -1, 0, -1, 2, 30, 2, 0, true]] },
    },
  },
  wolf: {
    tw: 64, th: 32, kind: 'quad',
    parts: {
      head: { pivot: [-1, 13.5, -7], boxes: [[0, 0, -2, -3, -2, 6, 6, 4], [16, 14, -2, -5, 0, 2, 2, 1], [16, 14, 2, -5, 0, 2, 2, 1],
        [0, 10, -0.5, 0, -5, 3, 3, 4]] },
      body: { pivot: [0, 14, 2], rot: [Math.PI / 2, 0, 0], boxes: [[18, 14, -3, -2, -3, 6, 9, 6]] },
      mane: { pivot: [-1, 14, -3], rot: [Math.PI / 2, 0, 0], boxes: [[21, 0, -3, -3, -3, 8, 6, 7]] },
      legBackRight: { pivot: [-2.5, 16, 7], boxes: [[0, 18, 0, 0, -1, 2, 8, 2]] },
      legBackLeft: { pivot: [0.5, 16, 7], boxes: [[0, 18, 0, 0, -1, 2, 8, 2]] },
      legFrontRight: { pivot: [-2.5, 16, -4], boxes: [[0, 18, 0, 0, -1, 2, 8, 2]] },
      legFrontLeft: { pivot: [0.5, 16, -4], boxes: [[0, 18, 0, 0, -1, 2, 8, 2]] },
      tail: { pivot: [-1, 12, 8], rot: [0.9, 0, 0], boxes: [[9, 18, 0, 0, -1, 2, 8, 2]] },
    },
  },
};

// Which model and picture each mob uses
const VILLAGER_JOBS = {
  farmer: 'farmer', fisherman: 'farmer', shepherd: 'farmer', fletcher: 'farmer', librarian: 'librarian',
  cartographer: 'librarian', cleric: 'priest', armorer: 'smith', weaponsmith: 'smith', toolsmith: 'smith',
  butcher: 'butcher', leatherworker: 'butcher', mason: 'smith',
};
const SKINS = {
  // Players with a Minecraft skin (the server sends the picture), else the pack's Steve
  player: (d) => {
    const t = d.skin && playerTexture(d.skin);
    return t ? [d.slim ? 'biped_slim' : 'biped', t] : ['biped', 'entity/steve'];
  },
  zombie: () => ['biped', 'entity/zombie'],
  husk: () => ['biped', 'entity/husk'],
  drowned: () => ['biped', 'entity/drowned'],
  giant: () => ['biped', 'entity/zombie'],
  zombie_villager: () => ['zombie_villager', 'entity/zombie_villager'],
  skeleton: () => ['skeleton', 'entity/skeleton'],
  stray: () => ['skeleton', 'entity/stray'],
  wither_skeleton: () => ['skeleton', 'entity/wither_skeleton'],
  creeper: () => ['creeper', 'entity/creeper'],
  cow: () => ['cow', 'entity/cow'],
  mooshroom: (d) => ['cow', d.var === 'brown' ? 'entity/brown_mooshroom' : 'entity/mooshroom'],
  pig: () => ['pig', 'entity/pig'],
  sheep: () => ['sheep', 'entity/sheep'],
  chicken: () => ['chicken', 'entity/chicken'],
  spider: () => ['spider', 'entity/spider'],
  cave_spider: () => ['spider', 'entity/cave_spider'],
  enderman: () => ['enderman', 'entity/enderman'],
  // Every job has its own picture in newer packs; older packs only have five (VILLAGER_JOBS)
  villager: (d) => ['villager', d.var && pack.image('entity/villager_' + d.var) ? 'entity/villager_' + d.var
    : VILLAGER_JOBS[d.var] ? 'entity/villager_' + VILLAGER_JOBS[d.var] : 'entity/villager'],
  wolf: () => ['wolf', 'entity/wolf'],
  iron_golem: () => ['iron_golem', 'entity/iron_golem'],
  snow_golem: () => ['snow_golem', 'entity/snow_golem'],
  cat: (d) => ['cat', 'entity/cat_' + (d.var || 'tabby')],
  ocelot: () => ['cat', 'entity/ocelot'],
  fox: (d) => ['fox', d.var === 'snow' ? 'entity/snow_fox' : 'entity/fox'],
  bee: () => ['bee', 'entity/bee'],
  horse: (d) => ['horse', 'entity/horse_' + (d.var || 'brown').replace('dark_brown', 'darkbrown')],
  donkey: () => ['horse', 'entity/donkey'],
  mule: () => ['horse', 'entity/mule'],
  skeleton_horse: () => ['horse', 'entity/skeleton_horse'],
  zombie_horse: () => ['horse', 'entity/zombie_horse'],
  slime: () => ['slime', 'entity/slime'],
  magma_cube: () => ['magma_cube', 'entity/magma_cube'],
  wandering_trader: () => ['villager', 'entity/wandering_trader'],
  witch: () => ['witch', 'entity/witch'],
  pillager: () => ['villager', 'entity/pillager'],
  vindicator: () => ['villager', 'entity/vindicator'],
  evoker: () => ['villager', 'entity/evoker'],
  illusioner: () => ['villager', 'entity/illusioner'],
  piglin: () => ['piglin', 'entity/piglin'],
  piglin_brute: () => ['piglin', 'entity/piglin_brute'],
  zombified_piglin: () => ['piglin', 'entity/zombified_piglin'],
  polar_bear: () => ['polar_bear', 'entity/polar_bear'],
  panda: () => ['panda', 'entity/panda'],
  rabbit: (d) => ['rabbit', 'entity/rabbit_' + (RABBITS[d.var] || 'brown')],
  llama: (d) => ['llama', 'entity/llama_' + (d.var || 'creamy')],
  trader_llama: (d) => ['llama', 'entity/llama_' + (d.var || 'creamy')],
  parrot: (d) => ['parrot', 'entity/parrot_' + (PARROTS[d.var] || 'red_blue')],
  cod: () => ['cod', 'entity/cod'],
  salmon: () => ['salmon', 'entity/salmon'],
  pufferfish: () => ['pufferfish', 'entity/pufferfish'],
  ghast: () => ['ghast', 'entity/ghast'],
  blaze: () => ['blaze', 'entity/blaze'],
  squid: () => ['squid', 'entity/squid'],
  glow_squid: () => ['squid', 'entity/glow_squid'],
  silverfish: () => ['silverfish', 'entity/silverfish'],
  endermite: () => ['endermite', 'entity/endermite'],
  guardian: () => ['guardian', 'entity/guardian'],
  elder_guardian: () => ['guardian', 'entity/elder_guardian'],
  turtle: () => ['turtle', 'entity/turtle'],
  dolphin: () => ['dolphin', 'entity/dolphin'],
  phantom: () => ['phantom', 'entity/phantom'],
  hoglin: () => ['hoglin', 'entity/hoglin'],
  zoglin: () => ['hoglin', 'entity/zoglin'],
  strider: () => ['strider', 'entity/strider'],
  vex: () => ['vex', 'entity/vex'],
  allay: () => ['allay', 'entity/allay'],
  shulker: () => ['shulker', 'entity/shulker'],
  wither: () => ['wither', 'entity/wither'],
};
const PARROTS = { red: 'red_blue', blue: 'blue', green: 'green', cyan: 'yellow_blue', gray: 'grey' };
const RABBITS = { brown: 'brown', white: 'white', black: 'black', black_and_white: 'white_splotched', gold: 'gold',
  salt_and_pepper: 'salt', the_killer_bunny: 'caerbannog' };
const GLOW = { spider: 'entity/spider_eyes', cave_spider: 'entity/spider_eyes', enderman: 'entity/enderman_eyes',
  phantom: 'entity/phantom_eyes' };

// Armor on bipeds: Minecraft's armor pictures have the biped layout (layer 2 = leggings)
const ARMOR_MATERIAL = [[/^leather/, 'leather'], [/^chainmail/, 'chainmail'], [/^iron/, 'iron'], [/^golden/, 'gold'],
  [/^diamond/, 'diamond'], [/^netherite/, 'netherite'], [/^turtle/, 'turtle']];

function armorMaterial(key) {
  for (const [re, m] of ARMOR_MATERIAL) if (re.test(key)) return m;
  return null;
}

/** Does this mob have a textured model (and is its picture loaded)? */
export function hasSkin(d) {
  const s = SKINS[d.type];
  if (!s) return false;
  const tex = s(d)[1];
  return tex instanceof THREE.Texture || !!textureOf(tex);
}

function material(tex, opts = {}) {
  const m = opts.glow
    ? new THREE.MeshBasicMaterial({ map: tex, transparent: true, alphaTest: 0.1, depthWrite: false })
    : opts.translucent
      ? new THREE.MeshLambertMaterial({ map: tex, transparent: true, alphaTest: 0.05, depthWrite: false })
      : new THREE.MeshLambertMaterial({ map: tex, alphaTest: 0.5, color: opts.color ?? 0xffffff });
  m.userData.keepMap = true;   // the texture is shared by all mobs
  if (opts.glow) m.userData.noTint = true;
  return m;
}

/** Builds the parts of a model into `groups` (name -> Group, created when missing). */
function addModel(model, tex, groups, frame, opts = {}) {
  const mat = material(tex, opts);
  const tw = model.tw, th = model.th;
  for (const [name, p] of Object.entries(model.parts)) {
    let g = groups[name];
    if (!g) {
      g = new THREE.Group();
      g.position.set(...p.pivot);
      if (p.order) g.rotation.order = p.order;   // Minecraft turns z, then y, then x
      if (p.rot) g.rotation.set(...p.rot);
      groups[name] = g;
      frame.add(g);
    }
    for (const b of p.boxes) {
      if (opts.only && !opts.only(name, b)) continue;
      const box = opts.inflate ? [...b.slice(0, 8), (b[8] || 0) + opts.inflate, b[9]] : b;
      const mesh = new THREE.Mesh(boxGeometry(box, tw, th), mat);
      if (opts.glow) mesh.userData.noTint = true;   // glowing eyes don't flash red
      g.add(mesh);
    }
  }
}

/**
 * Builds a textured mob into `root` (our space, y up, front +z) and returns
 * { limbs, head, height } for the entity animation, or null when there is no picture.
 */
export function buildSkin(d, root, opts) {
  const s = SKINS[d.type];
  if (!s) return null;
  const [modelName, texPath] = s(d);
  const tex = texPath instanceof THREE.Texture ? texPath : textureOf(texPath);
  if (!tex) return null;
  // Old pictures (64x32) have no second layer and no own left arm and leg
  const model = MODELS[modelName.startsWith('biped') && tex.image.height < tex.image.width ? 'biped32' : modelName];
  // Minecraft model space -> ours: half a turn around x (y down -> up, front -z -> +z), ground at y = 24
  const frame = new THREE.Group();
  frame.rotation.x = Math.PI;
  frame.position.y = 24;
  const groups = {};
  addModel(model, tex, groups, frame);
  const glow = GLOW[d.type] && textureOf(GLOW[d.type]);
  if (glow) addModel(model, glow, groups, frame, { glow: true, inflate: 0.01 });   // eyes (head, or the enderman's chest)
  if (d.type === 'sheep' && !d.sheared) {
    const fur = textureOf('entity/sheep_fur');
    if (fur) addModel(MODELS.sheep_fur, fur, groups, frame, { color: d.col ?? 0xffffff });
  }
  if (model.kind === 'biped' && d.arm) addArmor(d.arm, groups, frame);
  if (d.type === 'slime') addModel(MODELS.slime_outer, tex, groups, frame, { translucent: true });

  // Scale to the hitbox height (players always full size: their box shrinks while sneaking/swimming)
  frame.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(frame);
  const modelH = Math.max(1, bounds.max.y - bounds.min.y);
  const height = d.type === 'player' ? 1.8 : opts.height;
  const k = height / modelH;
  const wrap = new THREE.Group();
  wrap.scale.setScalar(k);
  wrap.position.y = -bounds.min.y * k;
  wrap.add(frame);
  root.add(wrap);

  const g = groups;
  let limbs = null;
  if (model.kind === 'biped') {
    // Villagers keep their arms crossed: the animation moves stand-ins
    limbs = { legL: g.leftLeg, legR: g.rightLeg, armL: g.leftArm ?? new THREE.Group(), armR: g.rightArm ?? new THREE.Group(), body: g.body };
  } else if (model.kind === 'quad') {
    limbs = { legs: [g.legBackRight, g.legBackLeft, g.legFrontRight, g.legFrontLeft].filter(Boolean) };
  }
  return { limbs, head: g.head, scale: k, rightArm: g.rightArm, frame };
}

function addArmor(keys, groups, frame) {
  // [slot index in "arm" (helmet, chest, legs, boots), layer, parts, inflate]
  const pieces = [
    [0, 1, ['head'], 1.0],
    [1, 1, ['body', 'rightArm', 'leftArm'], 1.0],
    [2, 2, ['body', 'rightLeg', 'leftLeg'], 0.5],
    [3, 1, ['rightLeg', 'leftLeg'], 1.0],
  ];
  for (const [slot, layer, parts, inflate] of pieces) {
    const key = keys[slot];
    const m = key && armorMaterial(key);
    const tex = m && textureOf(`armor/${m}_layer_${layer}`);
    if (!tex) continue;
    const model = MODELS.biped32;
    const color = m === 'leather' ? 0xa06540 : 0xffffff;
    const sub = { tw: 64, th: 32, parts: {} };
    for (const name of parts) {
      const p = model.parts[name];
      // Only the base box of the part (not the hat or sleeves)
      const base = p.boxes[0];
      const box = [...base.slice(0, 8), inflate, base[9]];
      sub.parts[name] = { pivot: p.pivot, boxes: [box] };
    }
    addModel(sub, tex, groups, frame, { color });
  }
}
