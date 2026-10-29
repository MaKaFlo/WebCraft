// Block models for blocks whose look depends on their state (redstone parts, pistons, rails, signs ...).
// The server sends the state's properties as `p` in the palette entry. Two kinds of result:
//  - { cube: {up, down, north, south, east, west}, texUp }: a box with its own picture per world side;
//    texUp[side] = world direction the top of that picture points to (piston sides point to the head).
//  - { elements, up, north, tint }: boxes and quads in pixels (0..16) like Minecraft's block models, built for a
//    block that looks to model north (-z) with its top at +y, then turned so model +y is `up` and model -z is `north`.
// Texture names are 'block/...' pictures of the pack; '#side' is the block's own side picture.

export const DIR = {
  north: [0, 0, -1], south: [0, 0, 1], east: [1, 0, 0], west: [-1, 0, 0], up: [0, 1, 0], down: [0, -1, 0],
};
const UP = DIR.up, NORTH = DIR.north;
const neg = (v) => v.map((x) => -x);
const SIDES = ['north', 'south', 'east', 'west'];
const OPPOSITE = { north: 'south', south: 'north', east: 'west', west: 'east', up: 'down', down: 'up' };

/** Some direction at a right angle to v (for blocks where the turn around their facing does not matter). */
const across = (v) => (v[1] !== 0 ? NORTH : UP);

// Torch stick as in Minecraft (2 x 10 px, picture's middle part)
const stick = (x, y, z, h, tex) => ({
  f: [x, y, z], t: [x + 2, y + h, z + 2],
  faces: {
    up: { t: tex, uv: [7, 6, 9, 8] }, down: { t: tex, uv: [7, 13, 9, 15] },
    north: { t: tex, uv: [7, 6, 9, 6 + h] }, south: { t: tex, uv: [7, 6, 9, 6 + h] },
    east: { t: tex, uv: [7, 6, 9, 6 + h] }, west: { t: tex, uv: [7, 6, 9, 6 + h] },
  },
});
const allFaces = (tex, extra = {}) => {
  const o = {};
  for (const s of ['up', 'down', ...SIDES]) o[s] = { t: tex };
  return Object.assign(o, extra);
};
// Flat picture lying at height y (pixels), u along x, v along z
const flat = (x0, z0, x1, z1, y, t, uv = [x0, z0, x1, z1]) => ({ q: [[x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0]], t, uv });

function attached(p) {
  // Lever/button: model stands on the floor; on a wall its top looks away from the wall
  const f = DIR[p.facing] || NORTH;
  if (p.face === 'wall') return { up: f, north: UP };
  if (p.face === 'ceiling') return { up: DIR.down, north: f };
  return { up: UP, north: f };
}

function diode(name, p) {
  const on = p.powered === 'true';
  const torch = on ? 'block/redstone_torch' : 'block/redstone_torch_off';
  const els = [{
    f: [0, 0, 0], t: [16, 2, 16],
    faces: allFaces('block/smooth_stone', { up: { t: on ? `block/${name}_on` : `block/${name}` } }),
  }];
  if (name === 'repeater') {
    const d = (Number(p.delay) || 1) - 1;
    els.push(stick(7, 2, 2, 5, torch));
    if (p.locked === 'true') els.push({ f: [2, 2, 6 + 2 * d], t: [14, 4, 8 + 2 * d], faces: allFaces('block/bedrock') });
    else els.push(stick(7, 2, 6 + 2 * d, 5, torch));
  } else {
    els.push(stick(4, 2, 11, 5, torch), stick(10, 2, 11, 5, torch));
    const sub = p.mode === 'subtract';
    els.push(stick(7, 2, 2, sub ? 5 : 3, sub ? 'block/redstone_torch' : 'block/redstone_torch_off'));
  }
  // facing = side the signal comes in; the model's output is at north
  return { elements: els, up: UP, north: neg(DIR[p.facing] || NORTH) };
}

function wire(p) {
  const c = {};
  for (const s of SIDES) c[s] = p[s] && p[s] !== 'none' ? p[s] : null;
  const y = 0.25, els = [];
  const ns = c.north && c.south && !c.east && !c.west, ew = c.east && c.west && !c.north && !c.south;
  if (!ns && !ew) els.push(flat(0, 0, 16, 16, y, 'block/redstone_dust_dot'));
  if (c.north) els.push(flat(0, 0, 16, 8, y, 'block/redstone_dust_line0'));
  if (c.south) els.push(flat(0, 8, 16, 16, y, 'block/redstone_dust_line0'));
  // East/west: the same (upright) line picture turned a quarter
  if (c.east) els.push({ ...flat(8, 0, 16, 16, y + 0.01, 'block/redstone_dust_line0', [0, 0, 16, 8]), r: 90 });
  if (c.west) els.push({ ...flat(0, 0, 8, 16, y + 0.01, 'block/redstone_dust_line0', [0, 8, 16, 16]), r: 90 });
  // Up the side of the block next to it
  const L0 = 'block/redstone_dust_line0', uv = [0, 0, 16, 16], e = 0.25, E = 16 - e;
  if (c.north === 'up') els.push({ q: [[0, 0, e], [16, 0, e], [16, 16, e], [0, 16, e]], t: L0, uv });
  if (c.south === 'up') els.push({ q: [[16, 0, E], [0, 0, E], [0, 16, E], [16, 16, E]], t: L0, uv });
  if (c.east === 'up') els.push({ q: [[E, 0, 0], [E, 0, 16], [E, 16, 16], [E, 16, 0]], t: L0, uv });
  if (c.west === 'up') els.push({ q: [[e, 0, 16], [e, 0, 0], [e, 16, 0], [e, 16, 16]], t: L0, uv });
  // Minecraft's color by power (0 dark red .. 15 bright red)
  const f = (Number(p.power) || 0) / 15;
  const tint = [f * 0.6 + (f > 0 ? 0.4 : 0.3), Math.max(0, f * f * 0.7 - 0.5), Math.max(0, f * f * 0.6 - 0.7)];
  return { elements: els, up: UP, north: NORTH, tint, tintGray: true };
}

function rail(name, p) {
  const powered = name !== 'rail' && p.powered === 'true';
  let tex = `block/${name}${powered ? '_on' : ''}`;
  const shape = p.shape || 'north_south';
  const y = 1;
  if (shape.startsWith('ascending_')) {
    // Rises toward that side
    return { elements: [{ q: [[0, y, 16], [16, y, 16], [16, 16 + y, 0], [0, 16 + y, 0]], t: tex, uv: [0, 0, 16, 16] }],
      up: UP, north: DIR[shape.slice(10)] };
  }
  const CURVE = { south_east: 'north', south_west: 'east', north_west: 'south', north_east: 'west' };
  if (CURVE[shape]) {
    tex = 'block/rail_corner';
    return { elements: [flat(0, 0, 16, 16, y, tex)], up: UP, north: DIR[CURVE[shape]] };
  }
  return { elements: [flat(0, 0, 16, 16, y, tex)], up: UP, north: shape === 'east_west' ? DIR.east : NORTH };
}

function hopper(p) {
  const o = 'block/hopper_outside', i = 'block/hopper_inside';
  const wall = (f, t) => ({ f, t, faces: allFaces(o, { up: { t: 'block/hopper_top' } }) });
  const els = [
    { f: [2, 10, 2], t: [14, 11, 14], faces: allFaces(o, { up: { t: i } }) },
    wall([0, 10, 0], [2, 16, 16]), wall([14, 10, 0], [16, 16, 16]), wall([2, 10, 0], [14, 16, 2]), wall([2, 10, 14], [14, 16, 16]),
    { f: [4, 4, 4], t: [12, 10, 12], faces: allFaces(o) },
  ];
  if (p.facing === 'down' || !p.facing) {
    els.push({ f: [6, 0, 6], t: [10, 4, 10], faces: allFaces(o) });
    return { elements: els, up: UP, north: NORTH };
  }
  els.push({ f: [6, 4, 0], t: [10, 8, 4], faces: allFaces(o) });
  return { elements: els, up: UP, north: DIR[p.facing] };
}

function piston(name, p) {
  const f = DIR[p.facing] || UP;
  const sticky = name === 'sticky_piston';
  if (p.extended !== 'true') {
    const cube = {}, texUp = {};
    for (const s of Object.keys(DIR)) { cube[s] = 'block/piston_side'; texUp[s] = f; }
    cube[p.facing || 'up'] = sticky ? 'block/piston_top_sticky' : 'block/piston_top';
    cube[OPPOSITE[p.facing || 'up']] = 'block/piston_bottom';
    return { cube, texUp };
  }
  // Pushed out: the base is 12 px high, its front shows the inside
  return {
    elements: [{
      f: [0, 0, 0], t: [16, 12, 16],
      faces: {
        up: { t: 'block/piston_inner' }, down: { t: 'block/piston_bottom' },
        north: { t: 'block/piston_side', uv: [0, 4, 16, 16] }, south: { t: 'block/piston_side', uv: [0, 4, 16, 16] },
        east: { t: 'block/piston_side', uv: [0, 4, 16, 16] }, west: { t: 'block/piston_side', uv: [0, 4, 16, 16] },
      },
    }],
    up: f, north: across(f),
  };
}

function pistonHead(p) {
  const f = DIR[p.facing] || UP;
  const top = p.type === 'sticky' ? 'block/piston_top_sticky' : 'block/piston_top';
  const side = { t: 'block/piston_side', uv: [0, 0, 16, 4] };
  const arm = { t: 'block/piston_side', uv: [0, 0, 16, 4], r: 90 };
  return {
    elements: [
      { f: [0, 12, 0], t: [16, 16, 16], faces: { up: { t: top }, down: { t: 'block/piston_top' }, north: side, south: side, east: side, west: side } },
      { f: [6, p.short === 'true' ? 0 : -4, 6], t: [10, 12, 10], faces: { north: arm, south: arm, east: arm, west: arm } },
    ],
    up: f, north: across(f),
  };
}

function frontCube(name, p) {
  // Dispenser, dropper, observer: one side looks somewhere (also up/down)
  const facing = p.facing || 'north';
  const f = DIR[facing];
  const vertical = f[1] !== 0;
  const cube = {}, texUp = {};
  if (name === 'observer') {
    for (const s of Object.keys(DIR)) { cube[s] = 'block/observer_side'; texUp[s] = f; }
    for (const s of vertical ? ['north', 'south'] : ['up', 'down']) cube[s] = 'block/observer_top';
    cube[facing] = 'block/observer_front';
    cube[OPPOSITE[facing]] = p.powered === 'true' ? 'block/observer_back_on' : 'block/observer_back';
    for (const s of [facing, OPPOSITE[facing]]) texUp[s] = vertical ? NORTH : UP;
    return { cube, texUp };
  }
  for (const s of Object.keys(DIR)) cube[s] = vertical || s === 'up' || s === 'down' ? 'block/furnace_top' : 'block/furnace_side';
  cube[facing] = vertical ? `block/${name}_front_vertical` : `block/${name}_front`;
  return { cube, texUp };
}

function sign(name, p) {
  const board = (z0) => ({ f: [0, 0, z0], t: [16, 8, z0 + 1.33], faces: allFaces('#side') });
  if (name.endsWith('_wall_sign')) {
    const b = board(14.67);
    b.f[1] = 4.67; b.t[1] = 12.67;
    return { elements: [b], up: UP, north: DIR[p.facing] || NORTH };
  }
  const b = board(7.33);
  b.f[1] = 9.33; b.t[1] = 17.33;
  const a = (Number(p.rotation) || 0) * Math.PI / 8;
  return {
    elements: [b, { f: [7.33, 0, 7.33], t: [8.67, 9.33, 8.67], faces: allFaces('#side') }],
    // rotation 0 looks south, 4 west, 8 north, 12 east
    up: UP, north: [-Math.sin(a), 0, Math.cos(a)],
  };
}

function lantern(p) {
  // Body, cap and the chain above as in Minecraft; hanging ones are one pixel higher with a longer chain
  const t = '#side', h = p.hanging === 'true' ? 1 : 0;
  const side = { t, uv: [0, 2, 6, 9] }, cap = { t, uv: [1, 0, 5, 2] };
  const els = [
    { f: [5, h, 5], t: [11, 7 + h, 11], faces: { up: { t, uv: [0, 9, 6, 15] }, down: { t, uv: [0, 9, 6, 15] }, north: side, south: side, east: side, west: side } },
    { f: [6, 7 + h, 6], t: [10, 9 + h, 10], faces: { up: { t, uv: [1, 10, 5, 14] }, north: cap, south: cap, east: cap, west: cap } },
  ];
  const top = h ? 16 : 11, chainUv = h ? [11, 1, 14, 7] : [11, 10, 14, 12];
  const a = 6.5, b = 9.5, y0 = 9 + h;
  els.push({ q: [[a, y0, a], [b, y0, b], [b, top, b], [a, top, a]], t, uv: chainUv });
  els.push({ q: [[a, y0, b], [b, y0, a], [b, top, a], [a, top, b]], t, uv: chainUv });
  return { elements: els, up: UP, north: NORTH };
}

function rod(name, p) {
  const t = '#side', f = DIR[p.facing] || UP;
  let els;
  if (name === 'end_rod') {
    const s = { t, uv: [0, 0, 2, 15] }, b = { t, uv: [2, 6, 6, 7] };
    els = [
      { f: [7, 1, 7], t: [9, 16, 9], faces: { up: { t, uv: [2, 0, 4, 2] }, north: s, south: s, east: s, west: s } },
      { f: [6, 0, 6], t: [10, 1, 10], faces: { up: { t, uv: [2, 2, 6, 6] }, down: { t, uv: [2, 2, 6, 6] }, north: b, south: b, east: b, west: b } },
    ];
  } else {
    const s = { t, uv: [0, 4, 2, 16] }, b = { t, uv: [0, 0, 4, 4] };
    els = [
      { f: [7, 0, 7], t: [9, 12, 9], faces: { down: { t, uv: [0, 4, 2, 6] }, north: s, south: s, east: s, west: s } },
      { f: [6, 12, 6], t: [10, 16, 10], faces: { up: b, down: b, north: b, south: b, east: b, west: b } },
    ];
  }
  return { elements: els, up: f, north: across(f) };
}

/** Model of a block state, or null to draw it the usual way. */
export function blockModel(name, p) {
  if (!p) p = {};
  if (name === 'piston' || name === 'sticky_piston') return piston(name, p);
  if (name === 'piston_head') return pistonHead(p);
  if (name === 'moving_piston') return { elements: [], up: UP, north: NORTH };   // the server shows it a moment later
  if (name === 'repeater' || name === 'comparator') return diode(name, p);
  if (name === 'redstone_wire') return wire(p);
  if (name === 'observer' || name === 'dispenser' || name === 'dropper') return frontCube(name, p);
  if (name === 'hopper') return hopper(p);
  if (/^(rail|powered_rail|detector_rail|activator_rail)$/.test(name)) return rail(name, p);
  if (name === 'redstone_lamp' && p.lit === 'true') return { cube: Object.fromEntries(Object.keys(DIR).map((s) => [s, 'block/redstone_lamp_on'])), texUp: {} };
  if (name === 'daylight_detector') {
    const cube = Object.fromEntries(Object.keys(DIR).map((s) => [s, 'block/daylight_detector_side']));
    cube.up = p.inverted === 'true' ? 'block/daylight_detector_inverted_top' : 'block/daylight_detector_top';
    return { cube, texUp: {} };
  }
  if (name === 'lever') {
    const on = p.powered === 'true';
    const h = { t: 'block/lever', uv: [7, 6, 9, 16] };
    return {
      elements: [
        { f: [5, 0, 4], t: [11, 3, 12], faces: allFaces('block/cobblestone') },
        { f: [7, 1, 7], t: [9, 11, 9], rot: { a: 'x', d: on ? 45 : -45, o: [8, 1, 8] },
          faces: { up: { t: 'block/lever', uv: [7, 6, 9, 8] }, north: h, south: h, east: h, west: h } },
      ],
      ...attached(p),
    };
  }
  if (/(^|_)torch$/.test(name) && !/torchflower/.test(name)) {
    const tex = name === 'redstone_torch' && p.lit === 'false' ? 'block/redstone_torch_off' : '#side';
    return { elements: [stick(7, 0, 7, 10, tex)], up: UP, north: NORTH };
  }
  if (/_wall_torch$/.test(name)) {
    const tex = name === 'redstone_wall_torch' && p.lit === 'false' ? 'block/redstone_torch_off' : '#side';
    const s = stick(7, 3.5, 15, 10, tex);
    s.rot = { a: 'x', d: -22.5, o: [8, 3.5, 16] };
    // facing = away from the wall
    return { elements: [s], up: UP, north: DIR[p.facing] || NORTH };
  }
  if (/_sign$/.test(name) && !/hanging/.test(name)) return sign(name, p);
  if (/^(\w+_)?lantern$/.test(name) && !/^(sea|jack_o)_lantern$/.test(name)) return lantern(p);
  if (name === 'end_rod' || /lightning_rod$/.test(name)) return rod(name, p);
  return null;
}

// ------------------------------------------------------------------ turning models into quads

const FACE_DIRS = { up: UP, down: DIR.down, north: NORTH, south: DIR.south, east: DIR.east, west: DIR.west };

/** Corners (pixels) and the picture's (fu, fv) per corner of a box face, Minecraft's default UV layout. */
function boxFace(f, t, side) {
  const [x0, y0, z0] = f, [x1, y1, z1] = t;
  switch (side) {
    case 'up': return [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]].map((p) => [p, [x0, z0, x1, z1]]);
    case 'down': return [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]].map((p) => [p, [x0, 16 - z1, x1, 16 - z0]]);
    case 'north': return [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]].map((p) => [p, [16 - x1, 16 - y1, 16 - x0, 16 - y0]]);
    case 'south': return [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]].map((p) => [p, [x0, 16 - y1, x1, 16 - y0]]);
    case 'west': return [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]].map((p) => [p, [z0, 16 - y1, z1, 16 - y0]]);
    default: return [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]].map((p) => [p, [16 - z1, 16 - y1, 16 - z0, 16 - y0]]);
  }
}

// Corner order of every face: bottom-left, bottom-right, top-right, top-left of the picture
const CORNER_UV = [[0, 1], [1, 1], [1, 0], [0, 0]];

function rotateAbout(p, rot) {
  const a = rot.d * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  const [ox, oy, oz] = rot.o;
  let x = p[0] - ox, y = p[1] - oy, z = p[2] - oz;
  if (rot.a === 'x') [y, z] = [y * c - z * s, y * s + z * c];
  else if (rot.a === 'y') [x, z] = [x * c + z * s, -x * s + z * c];
  else [x, y] = [x * c - y * s, x * s + y * c];
  return [x + ox, y + oy, z + oz];
}

/**
 * Bakes a model into quads in block units (0..1): { p: 4 corners, uv: 4 [s, t] (t = 0 at the picture's bottom),
 * tex, n: normal, cull: world side it touches or null }. Done once per palette id.
 */
export function bakeModel(m) {
  const U = m.up, N = m.north;
  const Z = neg(N), X = [U[1] * Z[2] - U[2] * Z[1], U[2] * Z[0] - U[0] * Z[2], U[0] * Z[1] - U[1] * Z[0]];
  const tf = (p) => {
    const x = p[0] / 16 - 0.5, y = p[1] / 16 - 0.5, z = p[2] / 16 - 0.5;
    return [0.5 + X[0] * x + U[0] * y + Z[0] * z, 0.5 + X[1] * x + U[1] * y + Z[1] * z, 0.5 + X[2] * x + U[2] * y + Z[2] * z];
  };
  const out = [];
  const push = (pts, uvRect, r, tex, rot, onEdge) => {
    let corners = CORNER_UV.map(([a, b]) => [a, b]);
    for (let k = 0; k < ((r || 0) / 90) % 4; k++) corners = [corners[3], corners[0], corners[1], corners[2]];
    const uv = corners.map(([a, b]) => {
      const u = uvRect[0] + a * (uvRect[2] - uvRect[0]), v = uvRect[1] + b * (uvRect[3] - uvRect[1]);
      return [u / 16, 1 - v / 16];
    });
    const p = pts.map((q) => tf(rot ? rotateAbout(q, rot) : q));
    const e1 = p[1].map((v, i) => v - p[0][i]), e2 = p[3].map((v, i) => v - p[0][i]);
    let n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const len = Math.hypot(...n) || 1;
    n = n.map((v) => v / len);
    let cull = null;
    if (onEdge) {
      for (const [s, d] of Object.entries(FACE_DIRS)) if (d[0] * n[0] + d[1] * n[1] + d[2] * n[2] > 0.99) cull = s;
    }
    out.push({ p, uv, tex, n, cull });
  };
  for (const el of m.elements) {
    if (el.q) { push(el.q, el.uv, el.r, el.t, el.rot, false); continue; }
    for (const [side, face] of Object.entries(el.faces)) {
      const fc = boxFace(el.f, el.t, side);
      const rect = face.uv || fc[0][1];
      const edge = !el.rot && (side === 'up' ? el.t[1] >= 16 : side === 'down' ? el.f[1] <= 0 : side === 'north' ? el.f[2] <= 0
        : side === 'south' ? el.t[2] >= 16 : side === 'west' ? el.f[0] <= 0 : el.t[0] >= 16);
      push(fc.map((c) => c[0]), rect, face.r, face.t, el.rot, edge);
    }
  }
  return out;
}

/** Texture turn (quarter steps, see world.js) so the picture's top on world side `side` points to `dir`. */
export function texTurn(side, dir) {
  if (!dir) return 0;
  // Directions of the mesher's s and t on each side (world.js meshSection)
  const ST = {
    up: [[0, 0, 1], [1, 0, 0]], down: [[1, 0, 0], [0, 0, 1]], east: [[0, 0, 1], [0, 1, 0]], west: [[0, 0, 1], [0, 1, 0]],
    south: [[1, 0, 0], [0, 1, 0]], north: [[1, 0, 0], [0, 1, 0]],
  };
  const [s, t] = ST[side];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  if (dot(t, dir) > 0.5) return 0;
  if (dot(s, dir) < -0.5) return 1;
  if (dot(t, dir) < -0.5) return 2;
  if (dot(s, dir) > 0.5) return 3;
  return 0;
}
