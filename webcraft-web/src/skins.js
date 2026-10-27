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
  head: { pivot: [0, 0, 0], boxes: [[...L(0, 0), -4, -10, -4, 8, 10, 8], [...L(24, 0), -1, -3, -6, 2, 4, 2]] },
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

const MODELS = {
  biped: { tw: 64, th: 64, parts: BIPED_PARTS(true), kind: 'biped' },
  biped32: { tw: 64, th: 32, parts: BIPED_PARTS(false), kind: 'biped' },
  biped_slim: { tw: 64, th: 64, parts: BIPED_PARTS(true, true), kind: 'biped' },
  skeleton: { tw: 64, th: 32, parts: SKELETON_PARTS, kind: 'biped' },
  villager: { tw: 64, th: 64, parts: VILLAGER_PARTS(false), kind: 'biped' },
  zombie_villager: { tw: 64, th: 64, parts: VILLAGER_PARTS(true), kind: 'biped' },
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
  villager: (d) => ['villager', VILLAGER_JOBS[d.var] ? 'entity/villager_' + VILLAGER_JOBS[d.var] : 'entity/villager'],
  wolf: () => ['wolf', 'entity/wolf'],
};
const GLOW = { spider: 'entity/spider_eyes', cave_spider: 'entity/spider_eyes', enderman: 'entity/enderman_eyes' };

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
