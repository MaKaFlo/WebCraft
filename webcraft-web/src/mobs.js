// Block-figure models for mobs that are neither humanoids nor four-legged animals.
// Own simple shapes (no Minecraft models). Sizes are in "pixels" (1/16 block) and get scaled to the
// mob's real hitbox. A part is [w, h, d, x, y, z, color, kind?, extra?]; x/y/z is the center
// (for legs, tentacles and other hanging parts: the top), y counts from the ground, +z is the front.
// kinds: leg (walks), sleg (spider leg), wing (flaps), tent (waves), tail (wags), spin (turns around y).

const DARK = 0x1a1a1a;
const EYE = 0x111111;

function ring(n, radius, y, w, h, color, kind = 'spin') {
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    out.push([w, h, w, Math.cos(a) * radius, y, Math.sin(a) * radius, color, kind]);
  }
  return out;
}

const ghast = (body, face) => ({
  mh: 22,
  parts: [
    [16, 16, 16, 0, 14, 0, body],
    [3, 2, 0.5, -3.5, 15, 8.1, face], [3, 2, 0.5, 3.5, 15, 8.1, face], [6, 2, 0.5, 0, 10, 8.1, face],
    ...[[-5, -5], [0, -5], [5, -5], [-5, 0], [0, 0], [5, 0], [-5, 5], [0, 5], [5, 5]].map(([x, z], i) =>
      [2, 6 + (i % 3) * 2, 2, x, 6, z, body, 'tent']),
  ],
});

const fish = (len, high, body, fin, extra = []) => ({
  basis: 'w', mw: high * 0.9,
  parts: [
    [high * 0.5, high, len, 0, high / 2, 0, body],
    [0.5, high, 3, 0, high / 2, -len / 2 - 1.5, fin, 'tail'],
    [0.5, high * 0.45, len * 0.4, 0, high + high * 0.2, 0, fin],
    [0.6, 0.6, 0.3, high * 0.26, high * 0.65, len / 2 - 1, EYE], [0.6, 0.6, 0.3, -high * 0.26, high * 0.65, len / 2 - 1, EYE],
    ...extra,
  ],
});

const smallFlyer = (body, wing, head) => ({
  mh: 14,
  parts: [
    [3, 5, 2, 0, 6.5, 0, body],
    [2, 5, 1, -2.5, 9, 0, body, 'arm'], [2, 5, 1, 2.5, 9, 0, body, 'arm'],
    [6, 5, 0.5, -3.5, 8, -1.5, wing, 'wing'], [6, 5, 0.5, 3.5, 8, -1.5, wing, 'wing'],
  ],
  head: { pivot: [0, 9, 0], parts: [[5, 5, 5, 0, 2.5, 0, head], [1, 1, 0.3, -1.2, 2.6, 2.6, EYE], [1, 1, 0.3, 1.2, 2.6, 2.6, EYE]] },
});

export const MOBS = {
  creeper: {
    mh: 26,
    parts: [
      [4, 6, 4, -2, 6, 3, 0x4fbf3f, 'leg'], [4, 6, 4, 2, 6, 3, 0x45a838, 'leg'],
      [4, 6, 4, -2, 6, -3, 0x45a838, 'leg'], [4, 6, 4, 2, 6, -3, 0x4fbf3f, 'leg'],
      [8, 12, 4, 0, 12, 0, 0x55c444],
    ],
    head: {
      pivot: [0, 18, 0],
      parts: [[8, 8, 8, 0, 4, 0, 0x4fbf3f],
        [2, 2, 0.4, -2, 5, 4.1, EYE], [2, 2, 0.4, 2, 5, 4.1, EYE], [2, 3, 0.4, 0, 2.5, 4.1, EYE], [4, 2, 0.4, 0, 1.5, 4.1, EYE]],
    },
  },
  spider: {
    basis: 'w', mw: 22,
    parts: [
      [6, 6, 6, 0, 6, 1, 0x3a3029],
      [10, 8, 12, 0, 7, -8, 0x2a2420],
      ...[4.5, 2, -0.5, -3].flatMap((z, i) => [
        [15, 1.5, 1.5, -9, 6, z, 0x3a3029, 'sleg', { rz: 0.45, i }],
        [15, 1.5, 1.5, 9, 6, z, 0x3a3029, 'sleg', { rz: -0.45, i: i + 1 }],
      ]),
    ],
    head: { pivot: [0, 6, 4], parts: [[8, 7, 6, 0, 0, 3, 0x2a2420], [1.5, 1.5, 0.3, -2, 1, 6.2, 0xc02020], [1.5, 1.5, 0.3, 2, 1, 6.2, 0xc02020],
      [1, 1, 0.3, -1, 2, 6.2, 0xc02020], [1, 1, 0.3, 1, 2, 6.2, 0xc02020]] },
  },
  chicken: {
    mh: 14,
    parts: [
      [1, 5, 1, -1.5, 5, 0, 0xe8b020, 'leg'], [1, 5, 1, 1.5, 5, 0, 0xe8b020, 'leg'],
      [6, 6, 8, 0, 8, -0.5, 0xf4f4f4],
      [1, 4, 6, -3.5, 10, -0.5, 0xe8e8e8, 'wing'], [1, 4, 6, 3.5, 10, -0.5, 0xe8e8e8, 'wing'],
    ],
    head: { pivot: [0, 10, 3], parts: [[4, 6, 3, 0, 2.5, 1, 0xf4f4f4], [4, 2, 2, 0, 3, 3.5, 0xe8a020], [2, 2, 1, 0, 1, 3, 0xd02020],
      [1, 1, 0.3, -1.6, 4, 2.6, EYE], [1, 1, 0.3, 1.6, 4, 2.6, EYE]] },
  },
  bee: {
    basis: 'w', mw: 7,
    parts: [
      [7, 7, 10, 0, 5, 0, 0xf2c94c],
      [7.2, 7.2, 1.5, 0, 5, 1, 0x2a2018], [7.2, 7.2, 1.5, 0, 5, -2.5, 0x2a2018],
      [1, 1, 2, 0, 4, -5.5, 0x2a2018],
      [6, 0.4, 4, -3, 9, 0, 0xd8f0ff, 'wing'], [6, 0.4, 4, 3, 9, 0, 0xd8f0ff, 'wing'],
      [1.5, 1.5, 0.3, -2, 6, 5.1, EYE], [1.5, 1.5, 0.3, 2, 6, 5.1, EYE],
    ],
  },
  bat: {
    mh: 12,
    parts: [
      [4, 6, 3, 0, 5, 0, 0x4a3a2a],
      [8, 6, 0.5, -6, 7, 0, 0x2a2018, 'wing'], [8, 6, 0.5, 6, 7, 0, 0x2a2018, 'wing'],
    ],
    head: { pivot: [0, 8, 0], parts: [[5, 5, 5, 0, 2.5, 0, 0x4a3a2a], [1.5, 2, 1, -1.5, 5.5, 0, 0x4a3a2a], [1.5, 2, 1, 1.5, 5.5, 0, 0x4a3a2a],
      [1, 1, 0.3, -1.2, 2.6, 2.6, EYE], [1, 1, 0.3, 1.2, 2.6, 2.6, EYE]] },
  },
  parrot: {
    mh: 10,
    parts: [
      [1, 2, 1, -0.8, 2, 0, 0x5a5a5a, 'leg'], [1, 2, 1, 0.8, 2, 0, 0x5a5a5a, 'leg'],
      [3, 5, 3, 0, 4.5, 0, 0xe02a2a],
      [1, 4.5, 3, -2, 5, 0, 0x2a5ae0, 'wing'], [1, 4.5, 3, 2, 5, 0, 0x2a5ae0, 'wing'],
      [3, 3, 1, 0, 1.5, -1.8, 0xe0c02a, 'tail'],
    ],
    head: { pivot: [0, 7, 0.5], parts: [[2, 3, 2.5, 0, 1.5, 0.3, 0xe02a2a], [1, 1.5, 1.2, 0, 1.6, 2.1, 0xe8c040],
      [0.6, 0.6, 0.3, -1.05, 2, 1, EYE], [0.6, 0.6, 0.3, 1.05, 2, 1, EYE]] },
  },
  squid: {
    mh: 30,
    parts: [
      [12, 16, 12, 0, 22, 0, 0x2a4a6a],
      [2, 2, 0.4, -3, 18, 6.1, 0xd0d8e0], [2, 2, 0.4, 3, 18, 6.1, 0xd0d8e0],
      ...ring(8, 4.5, 14, 2, 14, 0x24405e, 'tent'),
    ],
  },
  cod: fish(8, 4, 0xb8a07a, 0x9a8460),
  salmon: fish(12, 5, 0xa0402a, 0x6a2a1a),
  tropical_fish: fish(5, 5, 0xf08a24, 0xf4f4f4, [[1.2, 5.1, 1, 0, 2.5, 0, 0xf4f4f4]]),
  pufferfish: {
    basis: 'w', mw: 7,
    parts: [
      [7, 7, 7, 0, 3.5, 0, 0xf2c94c],
      ...[[-3.5, 6, 0], [3.5, 6, 0], [0, 7, -3.5], [0, 7, 3.5], [-3.5, 1, 3.5], [3.5, 1, -3.5], [-3.5, 3.5, -3.5], [3.5, 3.5, 3.5]]
        .map(([x, y, z]) => [1, 1, 1, x, y, z, 0xe8e8d0]),
      [1.4, 1.4, 0.3, -2, 5, 3.6, EYE], [1.4, 1.4, 0.3, 2, 5, 3.6, EYE],
    ],
  },
  dolphin: {
    basis: 'w', mw: 9,
    parts: [
      [8, 7, 13, 0, 4, 0, 0x7a8aa0],
      [6, 4, 0.2, 0, 2.5, 6.6, 0xd8dde4],
      [2, 2, 4, 0, 3, 8.5, 0x7a8aa0],
      [1, 4, 5, 0, 9, -1, 0x6a7a90],
      [1, 1, 5, -4.5, 2.5, 1, 0x6a7a90], [1, 1, 5, 4.5, 2.5, 1, 0x6a7a90],
      [4, 4, 6, 0, 4.5, -9, 0x7a8aa0, 'tail'],
      [10, 1, 4, 0, 4.5, -13, 0x6a7a90, 'tail'],
      [1, 1, 0.3, -4.1, 5, 4, EYE], [1, 1, 0.3, 4.1, 5, 4, EYE],
    ],
  },
  ghast: ghast(0xf4f4f4, 0x4a4a4a),
  happy_ghast: ghast(0xf4f4f0, 0x3a5a8a),
  blaze: {
    mh: 26,
    parts: [
      ...ring(4, 6, 18, 2, 8, 0xe8a020),
      ...ring(4, 4.5, 12, 2, 8, 0xe8a020).map((p) => [...p.slice(0, 7), 'spin2']),
      ...ring(4, 3, 6, 2, 8, 0xe8a020),
    ],
    head: { pivot: [0, 18, 0], parts: [[8, 8, 8, 0, 4, 0, 0xf2c94c], [2, 1, 0.4, -2, 4.5, 4.1, 0x3a2a0a], [2, 1, 0.4, 2, 4.5, 4.1, 0x3a2a0a]] },
  },
  breeze: {
    mh: 28,
    parts: [
      ...ring(3, 5, 14, 2, 8, 0xb8c8f0),
      [7, 5, 7, 0, 8, 0, 0x9ab0f0, 'spin2'], [5, 4, 5, 0, 3.5, 0, 0x9ab0f0, 'spin2'],
    ],
    head: { pivot: [0, 18, 0], parts: [[8, 8, 8, 0, 4, 0, 0xc0d0ff], [2, 1.5, 0.4, -2, 4, 4.1, 0x2a3a8a], [2, 1.5, 0.4, 2, 4, 4.1, 0x2a3a8a]] },
  },
  phantom: {
    basis: 'w', mw: 30,
    parts: [
      [5, 3, 9, 0, 2, 0, 0x3a4a7a],
      [3, 2, 6, 0, 2, -7.5, 0x34426e, 'tail'],
      [12, 1, 8, -8.5, 2.5, 0, 0x4a5a8a, 'wing'], [12, 1, 8, 8.5, 2.5, 0, 0x4a5a8a, 'wing'],
    ],
    head: { pivot: [0, 2, 4.5], parts: [[7, 3, 5, 0, 0, 2.5, 0x3a4a7a], [2, 1, 0.3, -2, 0.3, 5.1, 0x7af07a], [2, 1, 0.3, 2, 0.3, 5.1, 0x7af07a]] },
  },
  guardian: {
    mh: 14,
    parts: [
      [12, 12, 16, 0, 7, 0, 0x6a9a8a],
      [4, 4, 0.5, 0, 7, 8.2, 0xf4f4f0], [2, 2, 0.4, 0, 7, 8.5, 0xc03030],
      ...[[-6, 13, 6], [6, 13, 6], [-6, 13, -6], [6, 13, -6], [-6, 1, 6], [6, 1, -6]].map(([x, y, z]) => [1.5, 4, 1.5, x, y, z, 0xd89a5a]),
      [6, 6, 8, 0, 7, -12, 0x5a8a7a, 'tail'], [4, 4, 6, 0, 7, -18, 0x5a8a7a, 'tail'], [2, 6, 5, 0, 7, -22.5, 0xd89a5a, 'tail'],
    ],
  },
  elder_guardian: null, // set below (same shape, other colors)
  silverfish: {
    basis: 'w', mw: 6,
    parts: [[4, 3, 3, 0, 1.5, 4, 0x8a8a8a], [6, 4, 3, 0, 2, 1, 0x9a9a9a, 'tail'], [5, 3.5, 3, 0, 1.75, -2, 0x8a8a8a, 'tail'],
      [3, 2.5, 3, 0, 1.25, -5, 0x7a7a7a, 'tail'], [2, 1.5, 2, 0, 0.75, -7.5, 0x7a7a7a, 'tail']],
  },
  endermite: {
    basis: 'w', mw: 6,
    parts: [[4, 3, 2, 0, 1.5, 3, 0x3a2a4a], [6, 4, 5, 0, 2, 0, 0x4a3a5a, 'tail'], [3, 3, 3, 0, 1.5, -4, 0x3a2a4a, 'tail'],
      [1, 1, 0.3, -1, 2, 4.1, 0xd070ff], [1, 1, 0.3, 1, 2, 4.1, 0xd070ff]],
  },
  shulker: {
    mh: 16,
    parts: [[16, 8, 16, 0, 4, 0, 0x8a5a8a], [16, 6, 16, 0, 13, 0, 0x9a6a9a], [6, 6, 6, 0, 8.5, 2, 0xe8d890],
      [1, 1, 0.3, -1.3, 9, 5.1, EYE], [1, 1, 0.3, 1.3, 9, 5.1, EYE]],
  },
  vex: smallFlyer(0x9ab0c8, 0xd8e4f0, 0xb8c8d8),
  allay: smallFlyer(0x5ac8f0, 0xd8f4ff, 0x7ad8f8),
  slime: {
    mh: 8,
    parts: [[8, 8, 8, 0, 4, 0, 0x6ac85a, null, { alpha: 0.55 }], [6, 6, 6, 0, 4, 0, 0x4aa83a],
      [1.4, 1.4, 0.3, -1.6, 5, 3.1, 0x1a3a1a], [1.4, 1.4, 0.3, 1.6, 5, 3.1, 0x1a3a1a], [1, 1, 0.3, 0.8, 2.5, 3.1, 0x1a3a1a]],
  },
  magma_cube: {
    mh: 8,
    parts: [[8, 8, 8, 0, 4, 0, 0x5a1a0a], [8.1, 1, 8.1, 0, 6, 0, 0xe86a1a], [8.1, 1, 8.1, 0, 3, 0, 0xe86a1a],
      [1.4, 1.4, 0.3, -1.6, 5, 4.1, 0xf2c94c], [1.4, 1.4, 0.3, 1.6, 5, 4.1, 0xf2c94c]],
  },
  wither: {
    mh: 28,
    parts: [
      [3, 10, 3, 0, 14, 0, 0x2a2a2a],
      [11, 2, 2, 0, 16, 0, 0x2a2a2a], [9, 2, 2, 0, 13, 0, 0x2a2a2a], [7, 2, 2, 0, 10, 0, 0x2a2a2a],
      [3, 6, 3, 0, 6, 0, 0x2a2a2a, 'tent'],
      [20, 3, 3, 0, 20, 0, 0x1a1a1a],
      [6, 6, 6, -9, 24, 0, 0x2a2a2a], [6, 6, 6, 9, 24, 0, 0x2a2a2a],
      [1.4, 1.4, 0.3, -10.3, 24.5, 3.1, 0x6ad0f0], [1.4, 1.4, 0.3, 10.3, 24.5, 3.1, 0x6ad0f0],
    ],
    head: { pivot: [0, 21, 0], parts: [[8, 8, 8, 0, 4, 0, 0x2a2a2a], [2, 2, 0.4, -2, 4.5, 4.1, 0x6ad0f0], [2, 2, 0.4, 2, 4.5, 4.1, 0x6ad0f0]] },
  },
  ender_dragon: {
    basis: 'w', mw: 120,
    parts: [
      [24, 24, 64, 0, 30, 0, 0x1a1a1a],
      [4, 6, 12, 0, 45, -10, 0x2a2a2a], [4, 6, 12, 0, 45, 10, 0x2a2a2a],
      ...[0, 1, 2, 3].map((i) => [10, 10, 10, 0, 34 + i * 2, 36 + i * 10, 0x1a1a1a]),
      ...[0, 1, 2, 3, 4, 5].map((i) => [10 - i, 10 - i, 10, 0, 30, -36 - i * 10, 0x1a1a1a, 'tail']),
      [56, 2, 40, -40, 40, 0, 0x2a1a3a, 'wing'], [56, 2, 40, 40, 40, 0, 0x2a1a3a, 'wing'],
      [8, 20, 8, -10, 20, 18, 0x1a1a1a, 'leg'], [8, 20, 8, 10, 20, 18, 0x1a1a1a, 'leg'],
      [10, 24, 10, -12, 22, -16, 0x1a1a1a, 'leg'], [10, 24, 10, 12, 22, -16, 0x1a1a1a, 'leg'],
    ],
    head: { pivot: [0, 40, 76], parts: [[16, 16, 16, 0, 0, 8, 0x1a1a1a], [12, 8, 16, 0, -2, 22, 0x1a1a1a],
      [4, 2, 0.5, -5, 4, 16.3, 0xd070ff], [4, 2, 0.5, 5, 4, 16.3, 0xd070ff]] },
  },
  end_crystal: {
    mh: 24,
    parts: [[12, 4, 12, 0, 2, 0, 0x2a2a2a], [10, 10, 10, 0, 14, 0, 0xc0a0ff, 'spin', { alpha: 0.35 }], [6, 6, 6, 0, 14, 0, 0xd070ff, 'spin2']],
  },
};
MOBS.glow_squid = { ...MOBS.squid, parts: MOBS.squid.parts.map((p) => (p[6] === 0x2a4a6a || p[6] === 0x24405e ? [...p.slice(0, 6), p[6] === 0x2a4a6a ? 0x2a8a8a : 0x24706e, ...p.slice(7)] : p)) };
MOBS.elder_guardian = { ...MOBS.guardian, parts: MOBS.guardian.parts.map((p) => (p[6] === 0x6a9a8a || p[6] === 0x5a8a7a ? [...p.slice(0, 6), 0xb8b0a0, ...p.slice(7)] : p)) };
MOBS.cave_spider = { ...MOBS.spider, parts: MOBS.spider.parts.map((p) => (p[6] === 0x2a2420 ? [...p.slice(0, 6), 0x1a3a3a, ...p.slice(7)] : p)) };
