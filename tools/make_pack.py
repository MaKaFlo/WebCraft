"""Builds texturen.zip for WebCraft from the Pixel Perfection CE resource pack (CC BY-SA 4.0).

Usage: python3 make_pack.py <pack folder> <items.json with {"list": [...], "blocks": [...]}> <out.zip>

- Block textures are renamed to the block names WebCraft uses (slabs, stairs, walls ... get the texture of
  their material).
- Blocks and items that are newer than the pack (deepslate, copper, cherry wood ...) are made by
  recoloring a similar texture of the pack.
- Grayscale grass and leaves get a green tint.
- Animated textures (fire, water, lava, portals ...) keep all frames; timing goes to animations.json.
"""
import colorsys
import io
import json
import re
import sys
import zipfile
from pathlib import Path

from PIL import Image

src = Path(sys.argv[1]) / 'assets/minecraft/textures'
names = json.load(open(sys.argv[2]))
out_path = sys.argv[3]

block_files = {p.stem: p for p in (src / 'block').glob('*.png')}
item_files = {p.stem: p for p in (src / 'item').glob('*.png')}

GRASS = (0x91, 0xbd, 0x59)
FOLIAGE = (0x77, 0xab, 0x2f)
TINTS = [
    (lambda n: n in ('grass_block_top', 'grass', 'tall_grass_top', 'tall_grass_bottom', 'fern', 'large_fern_top',
                     'large_fern_bottom', 'sugar_cane'), GRASS),
    (lambda n: n.endswith('_leaves') or n in ('vine', 'lily_pad', 'attached_melon_stem', 'attached_pumpkin_stem',
                                               'melon_stem', 'pumpkin_stem'), FOLIAGE),
    (lambda n: n.startswith('redstone_dust'), (0xd0, 0x10, 0x10)),
]

# Block name -> texture name in the pack (renamed blocks, crops, special cases)
ALIAS = {
    'short_grass': 'grass', 'dirt_path': 'grass_path', 'water': 'water_still', 'lava': 'lava_still', 'iron_chain': 'chain',
    'fire': 'fire_0', 'soul_fire': 'soul_fire_0', 'magma_block': 'magma', 'carrots': 'carrots_stage3',
    'potatoes': 'potatoes_stage3', 'beetroots': 'beetroots_stage3', 'wheat': 'wheat_stage7', 'nether_wart': 'nether_wart_stage2',
    'cocoa': 'cocoa_stage2', 'redstone_wire': 'redstone_dust_dot', 'smooth_quartz': 'quartz_block_bottom',
    'smooth_sandstone': 'sandstone_top', 'smooth_red_sandstone': 'red_sandstone_top', 'frosted_ice': 'frosted_ice_0',
    'bamboo': 'bamboo_stalk', 'bamboo_block': 'bamboo_stalk', 'campfire': 'campfire_log_lit', 'soul_campfire': 'soul_campfire_log_lit',
    'chest': 'oak_planks', 'trapped_chest': 'oak_planks', 'ender_chest': 'obsidian', 'smooth_basalt': 'basalt_top',
    'redstone_wall_torch': 'redstone_torch', 'soul_wall_torch': 'soul_torch', 'moving_piston': 'piston_side',
    'petrified_oak_slab': 'oak_planks', 'lava_cauldron': 'cauldron_side', 'powder_snow_cauldron': 'cauldron_side',
}
FACES = {'sticky_piston': {'_top': 'piston_top_sticky', '': 'piston_side', '_bottom': 'piston_bottom'}}
ITEM_ALIAS = {'turtle_scute': 'scute', 'compass': 'compass_00', 'recovery_compass': 'compass_16', 'crossbow': 'crossbow_standby',
              'enchanted_golden_apple': 'golden_apple'}

# Newer blocks: (pattern, source texture, color, mode). mode "all" tints the whole picture,
# "stone" only the grayish pixels (keeps ore specks), "head" everything except wood (tools).
COPPER = (0xc8, 0x76, 0x4a)
COPPER_AGES = {'': COPPER, 'exposed_': (0xa8, 0x88, 0x6c), 'weathered_': (0x6c, 0xa0, 0x80), 'oxidized_': (0x4e, 0xb4, 0x96)}
DEEP = (0x60, 0x60, 0x6a)
RECOLOR = [
    (r'deepslate', 'stone', DEEP, 'all'), (r'cobbled_deepslate', 'cobblestone', DEEP, 'all'),
    (r'polished_deepslate', 'polished_andesite', DEEP, 'all'), (r'deepslate_bricks', 'stone_bricks', DEEP, 'all'),
    (r'deepslate_tiles', 'stone_bricks', (0x50, 0x50, 0x58), 'all'), (r'chiseled_deepslate', 'chiseled_stone_bricks', DEEP, 'all'),
    (r'cracked_deepslate_bricks', 'cracked_stone_bricks', DEEP, 'all'), (r'cracked_deepslate_tiles', 'cracked_stone_bricks', DEEP, 'all'),
    (r'reinforced_deepslate', 'stone_bricks', (0x40, 0x48, 0x48), 'all'),
    (r'deepslate_(\w+)_ore', r'\1_ore', DEEP, 'stone'), (r'copper_ore', 'iron_ore', COPPER, 'ore'),
    (r'raw_copper_block', 'iron_block', COPPER, 'all'), (r'raw_iron_block', 'iron_block', (0xd8, 0xb0, 0x90), 'all'),
    (r'raw_gold_block', 'gold_block', (0xe8, 0xc0, 0x50), 'all'),
    (r'cherry_(planks|log|log_top|leaves|sapling|door_bottom|trapdoor)', r'oak_\1', (0xe8, 0xa8, 0xb8), 'all'),
    (r'stripped_cherry_log', 'stripped_oak_log', (0xe8, 0xa8, 0xb8), 'all'),
    (r'mangrove_(planks|log|leaves|door_bottom|trapdoor)', r'jungle_\1', (0xb0, 0x50, 0x48), 'all'),
    (r'stripped_mangrove_log', 'stripped_jungle_log', (0xb0, 0x50, 0x48), 'all'),
    (r'pale_oak_(planks|log|leaves|sapling|door_bottom|trapdoor)', r'birch_\1', (0xe0, 0xd8, 0xd0), 'all'),
    (r'stripped_pale_oak_log', 'stripped_birch_log', (0xe0, 0xd8, 0xd0), 'all'),
    (r'poplar_(planks|log|sapling|door_bottom|trapdoor)', r'spruce_\1', (0xc8, 0xb0, 0x80), 'all'),
    (r'bamboo_(planks|mosaic|door_bottom|trapdoor)', r'birch_planks', (0xe0, 0xc8, 0x58), 'all'),
    (r'stripped_bamboo_block', 'stripped_birch_log', (0xe0, 0xc8, 0x58), 'all'),
    (r'azalea_leaves', 'oak_leaves', FOLIAGE, 'all'), (r'flowering_azalea_leaves', 'oak_leaves', (0x90, 0xa8, 0x50), 'all'),
    (r'moss_block|moss_carpet', 'green_concrete_powder', (0x60, 0x90, 0x30), 'all'),
    (r'pale_moss_block|pale_moss_carpet', 'green_concrete_powder', (0xa8, 0xb0, 0xa0), 'all'),
    (r'tuff', 'andesite', (0x6c, 0x70, 0x68), 'all'), (r'polished_tuff', 'polished_andesite', (0x6c, 0x70, 0x68), 'all'),
    (r'tuff_bricks|chiseled_tuff|chiseled_tuff_bricks', 'stone_bricks', (0x6c, 0x70, 0x68), 'all'),
    (r'calcite', 'diorite', (0xe8, 0xe8, 0xe4), 'all'), (r'dripstone_block', 'granite', (0x98, 0x78, 0x60), 'all'),
    (r'amethyst_block|budding_amethyst', 'purpur_block', (0x9a, 0x6a, 0xd0), 'all'),
    (r'mud', 'coarse_dirt', (0x50, 0x44, 0x40), 'all'), (r'packed_mud', 'dirt', (0x8c, 0x6c, 0x54), 'all'),
    (r'mud_bricks', 'bricks', (0x8c, 0x6c, 0x54), 'all'), (r'rooted_dirt', 'coarse_dirt', (0x90, 0x68, 0x48), 'all'),
    (r'sculk|sculk_catalyst|sculk_sensor|sculk_shrieker|calibrated_sculk_sensor', 'black_concrete_powder', (0x10, 0x40, 0x48), 'all'),
    (r'resin_block', 'orange_concrete_powder', (0xe0, 0x70, 0x20), 'all'),
    (r'resin_bricks|chiseled_resin_bricks', 'bricks', (0xe0, 0x80, 0x30), 'all'),
    (r'cinnabar|polished_cinnabar|chiseled_cinnabar', 'stone', (0xb0, 0x40, 0x38), 'all'),
    (r'cinnabar_bricks', 'stone_bricks', (0xb0, 0x40, 0x38), 'all'),
    (r'sulfur|polished_sulfur|chiseled_sulfur|potent_sulfur', 'stone', (0xd8, 0xc8, 0x50), 'all'),
    (r'(\w+)_shelf', r'\1_planks', None, 'all'),
]
for age, color in COPPER_AGES.items():
    RECOLOR += [
        (age + r'copper_block' if age else r'copper_block', 'iron_block', color, 'all'),
        (age + r'copper' if age else r'copper_block_never', 'iron_block', color, 'all'),
        (age + r'cut_copper', 'smooth_stone', color, 'all'), (age + r'chiseled_copper', 'chiseled_stone_bricks', color, 'all'),
        (age + r'copper_grate', 'iron_bars', color, 'all'), (age + r'copper_bulb', 'redstone_lamp', color, 'all'),
        (age + r'copper_door_bottom', 'iron_door_bottom', color, 'all'), (age + r'copper_door_top', 'iron_door_top', color, 'all'),
        (age + r'copper_trapdoor', 'iron_trapdoor', color, 'all'), (age + r'copper_bars', 'iron_bars', color, 'all'),
        (age + r'copper_chain', 'chain', color, 'all'), (age + r'copper_lantern', 'lantern', color, 'stone'),
        (age + r'lightning_rod', 'end_rod', color, 'all'),
    ]
RECOLOR.append((r'copper_torch', 'torch', COPPER, 'flame'))

ITEM_RECOLOR = [
    (r'copper_(sword|pickaxe|axe|shovel|hoe|helmet|chestplate|leggings|boots|ingot|nugget|horse_armor)', r'iron_\1', COPPER, 'head'),
    (r'raw_copper', 'raw_iron', COPPER, 'all'),
    (r'(\w+)_chest_boat', r'\1_boat', None, 'all'), (r'(\w+)_chest_raft', r'oak_boat', (0xe0, 0xc8, 0x58), 'all'),
    (r'bamboo_raft', 'oak_boat', (0xe0, 0xc8, 0x58), 'all'), (r'cherry_boat', 'oak_boat', (0xe8, 0xa8, 0xb8), 'all'),
    (r'mangrove_boat', 'oak_boat', (0xb0, 0x50, 0x48), 'all'), (r'pale_oak_boat', 'birch_boat', (0xe0, 0xd8, 0xd0), 'all'),
    (r'(cherry|mangrove|pale_oak)_chest_boat', 'oak_boat', (0xc0, 0x90, 0x80), 'all'),
    (r'glow_item_frame', 'item_frame', (0x60, 0xe0, 0xc0), 'all'), (r'glow_ink_sac', 'ink_sac', (0x40, 0xd0, 0xb0), 'all'),
    (r'glow_berries', 'sweet_berries', (0xf0, 0xb0, 0x30), 'stone'), (r'echo_shard', 'prismarine_shard', (0x10, 0x50, 0x58), 'all'),
    (r'amethyst_shard', 'prismarine_shard', (0xa0, 0x70, 0xe0), 'all'), (r'breeze_rod', 'blaze_rod', (0x90, 0xb0, 0xf0), 'all'),
    (r'music_disc_\w+', 'music_disc_13', None, 'all'), (r'disc_fragment_5', 'flint', (0x50, 0x60, 0x60), 'all'),
    (r'armadillo_scute', 'scute', (0x98, 0x70, 0x68), 'all'), (r'netherite_horse_armor', 'iron_horse_armor', (0x50, 0x48, 0x50), 'all'),
    (r'(\w+)_bundle|bundle', 'rabbit_hide', (0xa0, 0x70, 0x48), 'all'),
    (r'\w+_map', 'filled_map', None, 'all'), (r'\w+_pottery_sherd', 'brick', (0xa0, 0x60, 0x40), 'all'),
    (r'\w+_smithing_template', 'paper', (0x50, 0x60, 0x68), 'all'), (r'\w+_banner_pattern', 'paper', (0xd8, 0xc8, 0xa8), 'all'),
    (r'(wooden|stone|iron|golden|diamond|netherite)_spear', r'\1_sword', None, 'all'), (r'copper_spear', 'iron_sword', COPPER, 'head'),
    (r'mace', 'iron_shovel', (0x90, 0x90, 0x98), 'head'), (r'raw_(iron|gold)', r'\1_ingot', (0xc8, 0xa0, 0x80), 'all'),
    (r'tipped_arrow', 'arrow', None, 'all'), (r'powder_snow_bucket', 'bucket', None, 'all'),
    (r'(axolotl|tadpole|sulfur_cube)_bucket', 'water_bucket', None, 'all'), (r'resin_brick', 'brick', (0xe0, 0x80, 0x30), 'all'),
    (r'(\w+)_harness', 'saddle', None, 'all'), (r'wind_charge', 'snowball', (0xa0, 0xc0, 0xf0), 'all'),
    (r'(blue|brown)_egg', 'egg', None, 'all'), (r'\w*trial_key', 'tripwire_hook', None, 'all'),
    (r'(\w+)_nautilus_armor', r'\1_horse_armor', None, 'all'), (r'wolf_armor', 'leather_horse_armor', None, 'all'),
    (r'ominous_bottle', 'experience_bottle', (0x60, 0x40, 0x70), 'all'), (r'torchflower_seeds', 'wheat_seeds', (0xe0, 0x90, 0x40), 'all'),
    (r'pitcher_pod', 'cocoa_beans', (0x50, 0x80, 0x90), 'all'),
]

# Spawn eggs: the pack has one gray egg and one gray overlay, colored per mob (two colors each)
EGG_COLORS = {
    'allay': (0x5ac8f0, 0x3ab0e0), 'armadillo': (0xa87a6a, 0x7a5a4a), 'axolotl': (0xf0a0c0, 0xa04a6a), 'bat': (0x4a3a2a, 0x0a0a0a),
    'bee': (0xf2c94c, 0x3a2a10), 'blaze': (0xf2a02a, 0xfff07a), 'bogged': (0x8a9a6a, 0x3a4a2a), 'breeze': (0xb8c8f0, 0x8a9ad8),
    'camel': (0xd8a85a, 0x9a6a3a), 'cat': (0xe8c86a, 0x9a7a4a), 'cave_spider': (0x0a3a3a, 0xa01010), 'chicken': (0xe0e0e0, 0xd02020),
    'cod': (0xc0a880, 0xe0c8a0), 'cow': (0x4a3a2a, 0xa0a0a0), 'creeper': (0x0aa020, 0x0a0a0a), 'dolphin': (0x2a3a5a, 0xf0f0f0),
    'donkey': (0x5a4a3a, 0x8a7a6a), 'drowned': (0x8ad8d0, 0x7a9a6a), 'elder_guardian': (0xd0c8b0, 0x7a7a8a), 'enderman': (0x161616, 0x000000),
    'endermite': (0x161616, 0x6a6a6a), 'evoker': (0x9a9a9a, 0x1a1a1a), 'fox': (0xd88a3a, 0xc8b8a8), 'frog': (0xd07a3a, 0xf0d8a8),
    'ghast': (0xf0f0f0, 0xb8b8b8), 'glow_squid': (0x0a5a6a, 0x80f0d0), 'goat': (0xa89a8a, 0x5a4a3a), 'guardian': (0x5a8a7a, 0xf07a30),
    'hoglin': (0xc07a5a, 0x5a4a4a), 'horse': (0xc0a070, 0xe0c890), 'husk': (0x7a6a4a, 0xe0c890), 'llama': (0xc0a070, 0x9a6a3a),
    'magma_cube': (0x340000, 0xfafa00), 'mooshroom': (0xa00a0a, 0xb8b8b8), 'mule': (0x1a0a00, 0x512a14), 'ocelot': (0xefde7d, 0x564434),
    'panda': (0xe7e7e7, 0x1b1b22), 'parrot': (0x0da70b, 0xff0000), 'phantom': (0x43518a, 0x88ff00), 'pig': (0xf0a5a2, 0xdb635f),
    'piglin': (0x995f40, 0xf9f3a4), 'pillager': (0x532f36, 0x959b9b), 'polar_bear': (0xf2f2f2, 0x959590), 'pufferfish': (0xf6b201, 0x37c3f2),
    'rabbit': (0x995f40, 0x734831), 'ravager': (0x757470, 0x5b5049), 'salmon': (0xa00f10, 0x0e8474), 'sheep': (0xe7e7e7, 0xffb5b5),
    'shulker': (0x946794, 0x4d3852), 'silverfish': (0x6e6e6e, 0x303030), 'skeleton': (0xc1c1c1, 0x494949), 'slime': (0x51a03e, 0x7ebf6e),
    'sniffer': (0x871e09, 0x25ab70), 'spider': (0x342d27, 0xa80e0e), 'squid': (0x223b4d, 0x708899), 'stray': (0x617677, 0xdde4e4),
    'strider': (0x9c3436, 0x4d494d), 'turtle': (0xe7e7e7, 0x00afaf), 'vex': (0x7a90a4, 0xe8edf1), 'villager': (0x563c33, 0xbd8b72),
    'vindicator': (0x959b9b, 0x275e61), 'wandering_trader': (0x456296, 0xeaa430), 'warden': (0x0f4649, 0x39d6e0), 'witch': (0x340000, 0x51a03e),
    'wither_skeleton': (0x141414, 0x474d4d), 'wolf': (0xd7d3d3, 0xceaf96), 'zoglin': (0xc66e55, 0xe6e6e6), 'zombie': (0x00afaf, 0x799c65),
    'zombie_villager': (0x563c33, 0x799c65), 'zombified_piglin': (0xea9393, 0x4c7129), 'iron_golem': (0xdbcdc1, 0x74a332),
    'snow_golem': (0xd9f2f2, 0x81a4a4), 'copper_golem': (0xc87a4a, 0x8a4a2a), 'creaking': (0x5a4030, 0xf08a24), 'happy_ghast': (0xf0f0f0, 0x6a9ad8),
}


def spawn_egg(mob):
    base = item_files.get('spawn_egg')
    over = item_files.get('spawn_egg_overlay')
    if not base or not over:
        return None
    c1, c2 = EGG_COLORS.get(mob, (0x8a7a9a, 0x5a4a6a))
    rgb = lambda c: ((c >> 16) & 255, (c >> 8) & 255, c & 255)
    a = recolor(Image.open(base).convert('RGBA'), rgb(c1), 'all')
    b = recolor(Image.open(over).convert('RGBA'), rgb(c2), 'all')
    a.alpha_composite(b)
    return a


def lum(p):
    return 0.3 * p[0] + 0.59 * p[1] + 0.11 * p[2]


def sat(p):
    return colorsys.rgb_to_hsv(p[0] / 255, p[1] / 255, p[2] / 255)[1]


def recolor(im, color, mode):
    if color is None:
        return im
    im = im.copy()
    px = im.load()
    w, h = im.size
    # average brightness, so the result keeps the light/dark pattern around the target color
    vals = [lum(px[x, y]) for x in range(w) for y in range(h) if px[x, y][3] > 0]
    avg = sum(vals) / max(1, len(vals))
    for y in range(h):
        for x in range(w):
            p = px[x, y]
            if p[3] == 0:
                continue
            if mode in ('stone', 'ore') and sat(p) > 0.2:
                continue                               # keep the colored ore specks / flame
            if mode == 'ore' and sat(p) <= 0.2 and abs(lum(p) - avg) < 40:
                continue                               # copper ore: recolor the specks only
            if mode == 'head':
                r, g, b = p[0], p[1], p[2]
                if r > g + 12 and r > b + 20 and lum(p) < 150:
                    continue                           # wooden handle (brown) stays
            if mode == 'flame' and sat(p) > 0.4:
                continue
            f = lum(p) / max(avg, 1)
            px[x, y] = (min(255, int(color[0] * f)), min(255, int(color[1] * f)), min(255, int(color[2] * f)), p[3])
    if mode == 'ore':
        # specks: tint the bright/dark detail pixels
        for y in range(h):
            for x in range(w):
                p = px[x, y]
                if p[3] and sat(p) <= 0.2 and abs(lum(p) - avg) >= 40:
                    f = lum(p) / 160
                    px[x, y] = (min(255, int(color[0] * f)), min(255, int(color[1] * f)), min(255, int(color[2] * f)), p[3])
    return im


def tint_gray(im, stem):
    for test, color in TINTS:
        if test(stem):
            pixels = [p for p in im.getdata() if p[3] > 0]
            s = sum(sat(p) for p in pixels) / max(1, len(pixels))
            if s < 0.26:                               # still gray in this pack -> default biome color
                r, g, b, a = im.split()
                im = Image.merge('RGBA', (r.point(lambda v: v * color[0] // 255), g.point(lambda v: v * color[1] // 255),
                                          b.point(lambda v: v * color[2] // 255), a))
            break
    return im


def mcmeta(path):
    meta = Path(str(path) + '.mcmeta')
    if not meta.exists():
        return None
    try:
        anim = json.loads(meta.read_text())['animation']
    except (ValueError, KeyError):
        return None
    t = int(anim.get('frametime', 1))
    frames = [f if isinstance(f, int) else f.get('index', 0) for f in anim.get('frames', [])]
    return {'t': t, 'f': frames} if frames else {'t': t}


def load(path, stem, keep_frames=True):
    """Returns (PIL image, animation info or None)."""
    im = Image.open(path).convert('RGBA')
    w, h = im.size
    anim = mcmeta(path) if keep_frames else None
    if h > w and h % w == 0 and anim is not None and h // w > 1:
        frames = min(h // w, 64)
        im = im.crop((0, 0, w, w * frames))
        if w > 32:
            im = im.resize((32, 32 * frames), Image.LANCZOS)
    else:
        anim = None
        side = min(w, h)
        im = im.crop((0, 0, side, side))
        if side > 32:
            im = im.resize((32, 32), Image.LANCZOS)
    return tint_gray(im, stem), anim


def png(im):
    buf = io.BytesIO()
    im.save(buf, 'PNG', optimize=True)
    return buf.getvalue()


def pack_files(base):
    """Pack textures of a block: {suffix: stem}; suffix '' (all/side), '_side', '_top', '_bottom'."""
    if base in FACES:
        return dict(FACES[base])
    base = ALIAS.get(base, base)
    found = {}
    for suffix in ('', '_side', '_top', '_bottom'):
        if base + suffix in block_files:
            found[suffix] = base + suffix
    if '' not in found and '_side' not in found and base + '_front' in block_files:
        found['_side'] = base + '_front'
    return found


def recolored(name):
    """Textures for a block the pack does not have, by recoloring a similar one: {suffix: (image, anim)}."""
    for pattern, source, color, mode in RECOLOR:
        m = re.fullmatch(pattern, name)
        if not m:
            continue
        src_name = m.expand(source)
        files = pack_files(src_name)
        if not files:
            continue
        return {suffix: (recolor(load(block_files[stem], stem, False)[0], color, mode), None) for suffix, stem in files.items()}
    return None


SUFFIXES = ['_wall_hanging_sign', '_hanging_sign', '_wall_sign', '_sign', '_fence_gate', '_pressure_plate', '_button',
            '_stairs', '_slab', '_wall', '_fence', '_carpet', '_pane']


def candidates(name):
    yield name
    n = name
    for prefix in ('waxed_', 'infested_', 'potted_'):
        if n.startswith(prefix):
            n = n[len(prefix):]
            yield n
    if n.endswith('_wood') or n.endswith('_hyphae'):
        yield n.replace('_wood', '_log').replace('_hyphae', '_stem')
    for suf in SUFFIXES:
        if n.endswith(suf):
            b = n[: -len(suf)]
            if suf == '_carpet':
                yield b + '_wool'
                yield b + '_block'
            yield from (b, b + 's', b + '_planks', b + '_block', b.replace('brick', 'bricks'), b.replace('tile', 'tiles'))
            if b.startswith('smooth_'):
                yield b
            break
    if n == 'snow_block':
        yield 'snow'


def resolve(name):
    """{suffix: (image, anim)} for a block, or None."""
    if name.endswith('_door'):
        for cand in (name + '_bottom', name.replace('waxed_', '') + '_door_bottom'):
            if cand in block_files:
                return {'': load(block_files[cand], cand)}
        r = recolored(name.replace('waxed_', '') + '_bottom')
        return {'': r['']} if r and '' in r else None
    for cand in candidates(name):
        files = pack_files(cand)
        if files:
            out = {}
            for suffix, stem in files.items():
                if suffix == '' and cand != name and stem == cand + '_top':
                    continue
                out[suffix] = load(block_files[stem], stem)
            return out
        r = recolored(cand)
        if r:
            return r
    return None


out, anims = {}, {}
blocks = set(names['blocks'])
missing_blocks = []
for name in sorted(blocks):
    if name in ('air', 'cave_air', 'void_air', 'barrier', 'light', 'structure_void'):
        continue
    found = resolve(name)
    if not found:
        missing_blocks.append(name)
        continue
    for suffix, (im, anim) in found.items():
        path = 'block/' + name + suffix
        out[path] = png(im)
        if anim:
            anims[path] = anim

# Cracks while digging
for i in range(10):
    stem = f'destroy_stage_{i}'
    if stem in block_files:
        out['block/' + stem] = png(load(block_files[stem], stem, False)[0])

missing_items = []
for name in names['list']:
    stem = ITEM_ALIAS.get(name, name)
    if stem in item_files:
        im, anim = load(item_files[stem], stem)
        out['item/' + name] = png(im)
        if anim:
            anims['item/' + name] = anim
        continue
    done = False
    if name.endswith('_spawn_egg'):
        egg = spawn_egg(name[: -len('_spawn_egg')])
        if egg:
            out['item/' + name] = png(egg)
            continue
    for pattern, source, color, mode in ITEM_RECOLOR:
        m = re.fullmatch(pattern, name)
        s = m.expand(source) if m else None
        if s and s not in item_files and s + '_00' in item_files:
            s = s + '_00'
        if m and s in item_files:
            out['item/' + name] = png(recolor(load(item_files[s], s, False)[0], color, mode))
            done = True
            break
    if not done and name not in blocks:
        missing_items.append(name)

credits = """Texturen: Pixel Perfection Community Edition
von XSSheep und der Community (https://github.com/Athemis/PixelPerfectionCE)
Lizenz: CC BY-SA 4.0 (https://creativecommons.org/licenses/by-sa/4.0/)
Angepasst für WebCraft: umbenannt, eingefärbt (Gras, Blätter, neuere Blöcke wie Tiefenschiefer, Kupfer, Kirschholz),
animierte Texturen als Bildstreifen.
"""
with zipfile.ZipFile(out_path, 'w', zipfile.ZIP_DEFLATED) as z:
    for path, data in sorted(out.items()):
        z.writestr(path + '.png', data)
    z.writestr('animations.json', json.dumps(anims, separators=(',', ':')))
    z.writestr('LIZENZ.txt', credits)

nb = sum(1 for p in out if p.startswith('block/'))
ni = sum(1 for p in out if p.startswith('item/'))
print(f'{nb} block textures, {ni} item textures, {len(anims)} animated')
print(f'blocks without texture: {len(missing_blocks)}; items without texture: {len(missing_items)}')
open(out_path + '.missing.txt', 'w').write('BLOCKS\n' + '\n'.join(missing_blocks) + '\n\nITEMS\n' + '\n'.join(missing_items))
