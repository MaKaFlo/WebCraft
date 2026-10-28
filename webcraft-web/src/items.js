// Item icons and names for the hotbar and inventory (drawn by code, no Minecraft textures).
import { KIND_AIR, KIND_LIQUID, KIND_CROSS } from './palette.js';
import { atlas, TILE_PX } from './textures.js';

const TINTS = [
  [/^wooden_/, '#a07a4a'], [/^stone_/, '#8f8f8f'], [/^iron_/, '#dcdcdc'], [/^golden_/, '#f2c94c'],
  [/^diamond_/, '#5ee6e6'], [/^netherite_/, '#5a4a52'], [/^leather_/, '#8b5a2b'], [/^chainmail_/, '#a8b0b8'],
  [/^copper_/, '#d9895b'],
];

// Colored items (dye, bundle, harness ...) get the color as background
const COLORS = {
  white: '#f0f0f0', orange: '#f08a24', magenta: '#c74ebd', light_blue: '#5ab4e8', yellow: '#f2d23a', lime: '#7ccc2a',
  pink: '#f39bb8', gray: '#5a5f64', light_gray: '#a0a0a0', cyan: '#169c9c', purple: '#8932b8', blue: '#3a50b0',
  brown: '#835432', green: '#5e7c16', red: '#b02e26', black: '#25252a',
};
const COLOR_RE = /^(light_blue|light_gray|white|orange|magenta|yellow|lime|pink|gray|cyan|purple|blue|brown|green|red|black)_(dye|bundle|harness|cushion|egg|wool|carpet|bed|banner|candle)$/;

const EMOJI = [
  // Newer and special items first (more specific rules win)
  [/^mace$/, '🔨'], [/_spear$/, '🔱'], [/pottery_sherd$/, '🏺'], [/smithing_template$/, '📜'], [/banner_pattern$/, '🚩'],
  [/_map$/, '🗺️'], [/horse_armor$|nautilus_armor$|^wolf_armor$/, '🛡️'], [/_harness$/, '🎠'], [/_bundle$|^bundle$/, '👝'],
  [/_cushion$/, '🛋️'], [/_dye$/, '🎨'], [/_egg$/, '🥚'], [/^elytra$/, '🪽'], [/^end_crystal$/, '🔮'], [/^armor_stand$/, '🧍'],
  [/^beetroot$/, '🍠'], [/^bowl$/, '🥣'], [/^brick$|^nether_brick$|^resin_brick$/, '🧱'], [/blaze_powder|glowstone_dust/, '✨'],
  [/^bone_meal$/, '🦴'], [/breeze_rod/, '🌬️'], [/^brush$/, '🖌️'], [/chorus_fruit/, '🍇'], [/cocoa_beans/, '🫘'],
  [/^debug_stick$/, '🪄'], [/disc_fragment/, '💿'], [/dragon_breath|honey_bottle|ominous_bottle/, '🍯'], [/dried_kelp/, '🌿'],
  [/echo_shard|prismarine_shard|prismarine_crystals/, '💠'], [/fermented_spider_eye|^spider_eye$/, '👁️'], [/fire_charge/, '☄️'],
  [/firework_rocket/, '🎆'], [/firework_star|nether_star/, '⭐'], [/ghast_tear/, '💧'], [/ink_sac/, '🦑'],
  [/item_frame/, '🖼️'], [/^painting$/, '🖼️'], [/goat_horn/, '📯'], [/heart_of_the_sea/, '💙'], [/honeycomb/, '🍯'],
  [/knowledge_book/, '📕'], [/magma_cream/, '🟠'], [/nautilus_shell|shulker_shell/, '🐚'], [/netherite_scrap/, '🪨'],
  [/phantom_membrane|rabbit_hide/, '🩹'], [/pitcher_pod/, '🌱'], [/rabbit_foot/, '🐾'], [/rotten_flesh/, '🧟'],
  [/scute$/, '🐢'], [/^spyglass$/, '🔭'], [/trial_key$/, '🗝️'], [/fungus_on_a_stick|carrot_on_a_stick/, '🎣'],
  [/wind_charge/, '🌀'],
  [/pickaxe$/, '⛏️'], [/_axe$/, '🪓'], [/sword$/, '🗡️'], [/shovel$/, '🥄'], [/hoe$/, '🔱'],
  [/helmet$/, '⛑️'], [/chestplate$/, '🦺'], [/leggings$/, '👖'], [/boots$/, '👢'],
  [/^bow$|crossbow/, '🏹'], [/arrow$/, '➶'], [/^stick$/, '🥢'], [/fishing_rod/, '🎣'], [/shears/, '✂️'],
  [/flint_and_steel/, '🔥'], [/^shield$/, '🛡️'], [/totem/, '🗿'], [/^trident$/, '🔱'],
  [/apple/, '🍎'], [/bread/, '🍞'], [/^cooked_/, '🍗'], [/beef|porkchop|mutton|^chicken$|rabbit$/, '🍖'],
  [/cod|salmon|fish/, '🐟'], [/carrot/, '🥕'], [/potato/, '🥔'], [/^wheat$/, '🌾'], [/seeds$/, '🌱'],
  [/cookie/, '🍪'], [/melon_slice/, '🍉'], [/pie$/, '🥧'], [/^cake$/, '🎂'], [/berries$/, '🫐'], [/stew|soup/, '🥣'],
  [/^coal$|charcoal/, '⚫'], [/^diamond$/, '💎'], [/^emerald$/, '💚'], [/ingot$/, '🧈'], [/^raw_/, '🪨'],
  [/nugget$/, '🔸'], [/^redstone$/, '🔴'], [/lapis_lazuli/, '🔷'], [/quartz$/, '🤍'], [/amethyst_shard/, '💜'],
  [/string/, '🧵'], [/feather/, '🪶'], [/bone$/, '🦴'], [/^egg$/, '🥚'], [/leather$/, '🟫'],
  [/water_bucket/, '💧'], [/lava_bucket/, '🔥'], [/milk_bucket/, '🥛'], [/bucket$/, '🪣'],
  [/^book$|writable_book|written_book|enchanted_book/, '📖'], [/^paper$/, '📄'], [/^flint$/, '🔺'],
  [/gunpowder/, '💥'], [/ender_pearl|ender_eye/, '🟢'], [/^sugar$/, '🍚'], [/snowball/, '⚪'], [/clay_ball/, '🟤'],
  [/glass_bottle|potion/, '🧪'], [/^map$|filled_map/, '🗺️'], [/compass/, '🧭'], [/^clock$/, '🕐'],
  [/boat$|raft$/, '🛶'], [/minecart$/, '🛒'], [/saddle/, '🐴'], [/spawn_egg$/, '🥚'], [/music_disc/, '💿'],
  [/slime_ball/, '🟩'], [/blaze_rod/, '🪄'], [/name_tag/, '🏷️'], [/lead$/, '🪢'], [/experience_bottle/, '✨'],
];

const cache = new Map();

// Names in the chosen language (key -> name, from the server's "lang" message), or null: English from the key
let localNames = null;
export function setNames(names) { localNames = names; }

/** Readable name: Minecraft's name in the chosen language, else "stone_pickaxe" -> "Stone Pickaxe" */
export function prettyName(key) {
  const local = localNames?.[key];
  if (local) return local;
  return key.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

/** Can this item be placed as a block (as far as the client can tell)? */
export function isPlaceable(palette, key) {
  const id = palette?.index.get(key);
  return id !== undefined && palette.kind[id] !== KIND_AIR && palette.kind[id] !== KIND_LIQUID;
}

function shade(rgb, f) {
  return `rgb(${Math.round(rgb[0] * f * 255)},${Math.round(rgb[1] * f * 255)},${Math.round(rgb[2] * f * 255)})`;
}

/** Built-in tile tinted with the block color (pack tiles come in their own colors). */
function faceCanvas(tile, rgb, packed) {
  const c = document.createElement('canvas');
  c.width = c.height = TILE_PX;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  atlas.drawTileTo(ctx, tile, 0, 0, TILE_PX, TILE_PX);
  if (!packed) {
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = shade(rgb, 1);
    ctx.fillRect(0, 0, TILE_PX, TILE_PX);
    ctx.globalCompositeOperation = 'destination-in';
    atlas.drawTileTo(ctx, tile, 0, 0, TILE_PX, TILE_PX);
  }
  return c;
}

/** How an item gets its icon: 'pack', 'block', 'emoji' or 'letters' (no picture yet). */
export function iconKind(palette, key) {
  if (atlas.packTile('item/' + key) >= 0) return 'pack';
  const id = palette?.index.get(key);
  if (id !== undefined && palette.kind[id] !== KIND_AIR) return 'block';
  return EMOJI.some(([re]) => re.test(key)) ? 'emoji' : 'letters';
}

export function clearIconCache() {
  cache.clear();
  canvasCache.clear();
}

const canvasCache = new Map();

/** Returns a data URL for the item icon (cached). */
export function iconFor(palette, key) {
  const cacheKey = key + (palette ? '' : '?');
  if (cache.has(cacheKey)) return cache.get(cacheKey);
  const url = iconCanvas(palette, key).toDataURL();
  if (palette) cache.set(cacheKey, url);
  return url;
}

/** The item icon as a canvas (for sprites and the hand). */
export function iconCanvas(palette, key) {
  const cacheKey = key + (palette ? '' : '?');
  if (canvasCache.has(cacheKey)) return canvasCache.get(cacheKey);
  const size = 48;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  const id = palette?.index.get(key);
  const itemTile = atlas.packTile('item/' + key);

  if (itemTile >= 0) {
    // Own item picture from the texture pack
    atlas.drawTileTo(ctx, itemTile, 0, 0, size, size);
  } else if (id !== undefined && palette.kind[id] === KIND_CROSS) {
    // Plants, torches ...: the flat picture
    const rgb = [palette.rgb[id * 3], palette.rgb[id * 3 + 1], palette.rgb[id * 3 + 2]];
    ctx.drawImage(faceCanvas(palette.tileSide[id], rgb, palette.packed[id] & 2), 0, 0, size, size);
  } else if (id !== undefined && palette.kind[id] !== KIND_AIR) {
    // Little isometric cube with the block textures
    const rgb = [palette.rgb[id * 3], palette.rgb[id * 3 + 1], palette.rgb[id * 3 + 2]];
    const sideRgb = key === 'grass_block' && !(palette.packed[id] & 2) ? palette.dirtRgb : rgb;
    const top = faceCanvas(palette.tileTop[id], rgb, palette.packed[id] & 1);
    const side = faceCanvas(palette.tileSide[id], sideRgb, palette.packed[id] & 2);
    // Furnaces, chests ... show their front on the left side, like in Minecraft's inventory
    const front = palette.tileFront[id] >= 0 ? faceCanvas(palette.tileFront[id], rgb, true) : side;
    // Real isometric cube: the sides are as tall as the edges of the top (they were too short before,
    // so every block looked like a slab). Slabs, snow layers ... keep their own height.
    const m = size / 2, w = size * 0.4, h = w * Math.tan(Math.PI / 6);
    const edge = w / Math.cos(Math.PI / 6);
    const box = palette.box[id];
    const frac = box ? Math.max(0.15, Math.min(1, box[4] - box[1])) : 1;
    const hs = edge * frac;
    const y0 = (size - 2 * h - edge) / 2 + edge * (1 - frac);
    const k = 1 / TILE_PX;
    const face = (img, a, b, cc, d, e, f, dark) => {
      ctx.setTransform(a * k, b * k, cc * k, d * k, e, f);
      ctx.drawImage(img, 0, 0);
      if (dark > 0) {
        ctx.fillStyle = `rgba(0,0,0,${dark})`;
        ctx.fillRect(0, 0, TILE_PX, TILE_PX);
      }
    };
    face(top, w, -h, w, h, m - w, y0 + h, 0);
    face(front, w, h, 0, hs, m - w, y0 + h, 0.22);
    face(side, w, -h, 0, hs, m, y0 + 2 * h, 0.4);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  } else {
    const colorName = key.match(COLOR_RE)?.[1];
    const tint = colorName ? COLORS[colorName] : TINTS.find(([re]) => re.test(key))?.[1];
    const emoji = EMOJI.find(([re]) => re.test(key))?.[1];
    if (tint) {
      ctx.fillStyle = tint;
      ctx.beginPath();
      ctx.arc(size / 2, size / 2, size * 0.42, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (emoji) {
      ctx.font = `${Math.round(size * 0.58)}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
      ctx.fillText(emoji, size / 2, size / 2 + 2);
    } else {
      ctx.fillStyle = tint ? '#1d1a2e' : '#ffffff';
      ctx.font = `bold ${Math.round(size * 0.36)}px ui-monospace, monospace`;
      const letters = key.split('_').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
      if (!tint) {
        ctx.fillStyle = '#5a3d8a';
        ctx.fillRect(4, 4, size - 8, size - 8);
        ctx.fillStyle = '#ffffff';
      }
      ctx.fillText(letters, size / 2, size / 2 + 1);
    }
  }
  if (palette) canvasCache.set(cacheKey, c);
  return c;
}
