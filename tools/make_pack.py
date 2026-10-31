"""Builds texturen.zip for WebCraft from the Pixel Perfection CE resource pack (CC BY-SA 4.0).

Usage: python3 make_pack.py <pack folder> <items.json with {"list": [...], "blocks": [...]}> <out.zip>
       python3 make_pack.py --entities <pack folder> [<more pack folders>] <existing zip>   (only add/replace mob,
                 armor, chest and front textures; the first pack that has a picture wins)
       python3 make_pack.py --blocks <pack folder> <items.json> <existing zip>   (only add blocks the zip has no picture for)

- Block textures are renamed to the block names WebCraft uses (slabs, stairs, walls ... get the texture of
  their material).
- Blocks and items that are newer than the pack (deepslate, copper, cherry wood ...) are made by
  recoloring a similar texture of the pack.
- Grayscale grass and leaves get a green tint.
- Animated textures (fire, water, lava, portals ...) keep all frames; timing goes to animations.json.
- Mob and armor textures (entity/NAME.png, armor/NAME.png) for the textured mob models of the browser.
"""
import colorsys
import io
import json
import re
import sys
import zipfile
from pathlib import Path

from PIL import Image

# Mob textures for the browser's mob models (classic Minecraft box layouts): our name -> picture(s) in the pack,
# the first one found wins (new names of Minecraft 26.x packs first, then the older names).
CATS = ('tabby', 'black', 'red', 'siamese', 'british_shorthair', 'calico', 'persian', 'ragdoll', 'white', 'jellie', 'all_black')
PROFESSIONS = ('armorer', 'butcher', 'cartographer', 'cleric', 'farmer', 'fisherman', 'fletcher', 'leatherworker', 'librarian',
               'mason', 'nitwit', 'shepherd', 'toolsmith', 'weaponsmith')
ENTITY_FILES = {
    'steve': ['player/wide/steve', 'steve'], 'elytra': ['equipment/wings/elytra', 'elytra'],
    'shield': ['shield/shield_base_nopattern', 'shield_base_nopattern'], 'zombie': 'zombie/zombie', 'husk': 'zombie/husk', 'drowned': 'zombie/drowned',
    'zombie_villager': ['zombie/zombie_villager'], 'skeleton': 'skeleton/skeleton', 'stray': 'skeleton/stray',
    'wither_skeleton': 'skeleton/wither_skeleton', 'creeper': 'creeper/creeper', 'cow': 'cow/cow',
    'mooshroom': 'cow/red_mooshroom', 'brown_mooshroom': 'cow/brown_mooshroom', 'pig': 'pig/pig',
    'sheep': 'sheep/sheep', 'sheep_fur': ['sheep/sheep_wool', 'sheep/sheep_fur'], 'chicken': ['chicken/chicken_temperate', 'chicken'],
    'spider': 'spider/spider', 'cave_spider': 'spider/cave_spider', 'spider_eyes': ['spider/spider_eyes', 'spider_eyes'],
    'enderman': 'enderman/enderman', 'enderman_eyes': 'enderman/enderman_eyes', 'villager': 'villager/villager',
    'villager_farmer': 'villager/farmer', 'villager_librarian': 'villager/librarian', 'villager_priest': 'villager/priest',
    'villager_smith': 'villager/smith', 'villager_butcher': 'villager/butcher', 'wolf': 'wolf/wolf',
    'iron_golem': 'iron_golem/iron_golem', 'snow_golem': ['snow_golem/snow_golem', 'snow_golem'], 'ocelot': 'cat/ocelot',
    **{'cat_' + c: ['cat/cat_' + c, 'cat/' + c] for c in CATS},
    'fox': 'fox/fox', 'snow_fox': ['fox/fox_snow', 'fox/snow_fox'], 'bee': 'bee/bee', 'bee_angry': 'bee/bee_angry',
    **{'horse_' + c: 'horse/horse_' + c for c in ('white', 'creamy', 'chestnut', 'brown', 'black', 'gray', 'darkbrown')},
    'donkey': 'horse/donkey', 'mule': 'horse/mule', 'skeleton_horse': 'horse/horse_skeleton', 'zombie_horse': 'horse/horse_zombie',
    'slime': 'slime/slime', 'magma_cube': 'slime/magmacube', 'wandering_trader': ['wandering_trader/wandering_trader', 'wandering_trader'],
    'witch': ['witch/witch', 'witch'], 'pillager': 'illager/pillager', 'vindicator': 'illager/vindicator', 'evoker': 'illager/evoker',
    'illusioner': 'illager/illusioner', 'piglin': 'piglin/piglin', 'piglin_brute': 'piglin/piglin_brute',
    'zombified_piglin': 'piglin/zombified_piglin', 'polar_bear': 'bear/polarbear', 'panda': 'panda/panda',
    **{'rabbit_' + c: 'rabbit/' + c for c in ('brown', 'white', 'black', 'white_splotched', 'gold', 'salt', 'caerbannog')},
    **{'llama_' + c: ['llama/llama_' + c, 'llama/' + c] for c in ('creamy', 'white', 'brown', 'gray')},
    # Rarer mobs (pictures of Minecraft 1.17+ models)
    **{'parrot_' + c: 'parrot/parrot_' + c for c in ('red_blue', 'blue', 'green', 'yellow_blue', 'grey')},
    'cod': 'fish/cod', 'salmon': 'fish/salmon', 'pufferfish': 'fish/pufferfish', 'ghast': 'ghast/ghast',
    'blaze': ['blaze/blaze', 'blaze'], 'squid': ['squid/squid', 'squid'], 'glow_squid': 'squid/glow_squid',
    'silverfish': ['silverfish/silverfish', 'silverfish'], 'endermite': ['endermite/endermite', 'endermite'],
    'guardian': ['guardian/guardian', 'guardian'], 'elder_guardian': ['guardian/guardian_elder', 'guardian_elder'],
    'turtle': 'turtle/turtle', 'dolphin': ['dolphin/dolphin', 'dolphin'], 'phantom': ['phantom/phantom', 'phantom'],
    'phantom_eyes': ['phantom/phantom_eyes', 'phantom_eyes'], 'hoglin': 'hoglin/hoglin', 'zoglin': 'hoglin/zoglin',
    'strider': 'strider/strider', 'vex': 'illager/vex', 'allay': 'allay/allay', 'shulker': 'shulker/shulker',
    'wither': 'wither/wither',
    # Newest mobs (only in packs for Minecraft 1.19+)
    'bat': 'bat/bat', **{'frog_' + c: 'frog/frog_' + c for c in ('temperate', 'warm', 'cold')},
    **{'axolotl_' + c: 'axolotl/axolotl_' + c for c in ('lucy', 'wild', 'gold', 'cyan', 'blue')},
    'goat': 'goat/goat', 'camel': 'camel/camel', 'camel_husk': 'camel/camel_husk', 'armadillo': 'armadillo/armadillo',
    'sniffer': 'sniffer/sniffer', 'warden': 'warden/warden', 'ravager': 'illager/ravager', 'breeze': 'breeze/breeze',
    'breeze_wind': 'breeze/breeze_wind', 'breeze_eyes': 'breeze/breeze_eyes',
    **{'tropical_' + k: 'fish/tropical_' + k for k in ('a', 'b')},
    **{f'tropical_{k}_pattern_{i}': f'fish/tropical_{k}_pattern_{i}' for k in ('a', 'b') for i in range(1, 7)},
    'dragon': 'enderdragon/dragon', 'dragon_eyes': 'enderdragon/dragon_eyes',
}
# Newer packs draw villagers in layers (skin + biome clothes + job): put them together. Our old job names too.
COMPOSED = {
    'villager': ['villager/villager', 'villager/type/plains'],
    'zombie_villager': ['zombie_villager/zombie_villager', 'zombie_villager/type/plains'],
    **{'villager_' + p: ['villager/villager', 'villager/type/plains', 'villager/profession/' + p] for p in PROFESSIONS},
    **{'villager_' + old: ['villager/villager', 'villager/type/plains', 'villager/profession/' + p]
       for old, p in (('priest', 'cleric'), ('smith', 'weaponsmith'))},
}
# Pictures whose layout changed in newer Minecraft versions: only taken when the width:height ratio is the old one
OLD_RATIO = {'cow': 2, 'mooshroom': 2, 'brown_mooshroom': 2, 'pig': 2, 'magma_cube': 2,
             **{'rabbit_' + c: 2 for c in ('brown', 'white', 'black', 'white_splotched', 'gold', 'salt', 'caerbannog')}}
# Glowing eyes only fit the picture of the same pack
SAME_PACK = {'spider_eyes': 'spider', 'enderman_eyes': 'enderman', 'phantom_eyes': 'phantom', 'breeze_eyes': 'breeze',
             'breeze_wind': 'breeze', 'dragon_eyes': 'dragon'}
GUI_FILES = ['button', 'button_highlighted', 'button_disabled', 'slider', 'slider_highlighted', 'slider_handle',
             'slider_handle_highlighted']
# Front faces (shown on the side the block faces): block name -> picture in the pack
FRONT_FILES = {
    'furnace': 'furnace_front', 'blast_furnace': 'blast_furnace_front', 'smoker': 'smoker_front',
    'dispenser': 'dispenser_front', 'dropper': 'dropper_front', 'observer': 'observer_front', 'loom': 'loom_front',
    'beehive': 'beehive_front', 'bee_nest': 'bee_nest_front', 'carved_pumpkin': 'carved_pumpkin',
    'jack_o_lantern': 'jack_o_lantern',
}
# Chests are drawn by Minecraft as a model with entity/chest/*.png; we cut block faces out of it
CHEST_FILES = {'chest': 'normal', 'trapped_chest': 'trapped', 'ender_chest': 'ender', 'copper_chest': 'copper',
               'exposed_copper_chest': 'copper_exposed', 'weathered_copper_chest': 'copper_weathered',
               'oxidized_copper_chest': 'copper_oxidized'}
ARMOR_MATERIALS = {'leather': 'leather', 'chainmail': 'chainmail', 'iron': 'iron', 'gold': 'gold', 'diamond': 'diamond',
                   'netherite': 'netherite', 'turtle': 'turtle_scute'}
# armor/NAME -> pictures (newer packs: entity/equipment/humanoid(_leggings)/MATERIAL, older: models/armor/NAME)
ARMOR_FILES = {f'{m}_layer_{n}': [f'entity/equipment/{"humanoid" if n == 1 else "humanoid_leggings"}/{new}', f'models/armor/{m}_layer_{n}']
               for m, new in ARMOR_MATERIALS.items() for n in (1, 2)}


def chest_faces(picture):
    """Block faces of a chest (16 px per block pixel unit; the chest is 14 wide and 14 high) from the chest model
    picture (64x64 units, old layout: lid box 14x5x14 at 0,0, base box 14x10x14 at 0,19, latch 2x4x1 at 0,0).
    HD pictures keep their resolution (k pixels per unit)."""
    im = Image.open(picture).convert('RGBA')
    k = max(1, im.width // 64)
    crop = lambda x, y, w, h: im.crop((x * k, y * k, (x + w) * k, (y + h) * k))
    faces = {}
    for name, strip in (('front', 42), ('side', 0)):
        tile = Image.new('RGBA', (16 * k, 16 * k))
        # Minecraft draws the chest model upside down, so the strips in the picture are flipped
        base = crop(strip, 33, 14, 10).transpose(Image.FLIP_TOP_BOTTOM).crop((0, k, 14 * k, 10 * k))   # without its top row
        lid = crop(strip, 14, 14, 5).transpose(Image.FLIP_TOP_BOTTOM)
        # The tile's lower 14 units cover the block's height 0..14/16; 1 unit margin left and right
        tile.paste(base, (k, 7 * k))
        tile.paste(lid, (k, 2 * k))
        for x in (0, 15):                      # fill the margin so no see-through pixels end up on the edge
            src = 1 if x == 0 else 14
            tile.paste(tile.crop((src * k, 0, (src + 1) * k, 16 * k)), (x * k, 0))
        if name == 'front':
            tile.alpha_composite(crop(1, 1, 2, 4), (7 * k, 5 * k))
        faces[name] = tile
    faces['top'] = crop(14, 0, 14, 14).resize((16 * k, 16 * k), Image.NEAREST)
    faces['bottom'] = crop(28, 19, 14, 14).resize((16 * k, 16 * k), Image.NEAREST)
    out = {}
    for name, img in faces.items():
        buf = io.BytesIO()
        img.save(buf, 'PNG')
        out[name] = buf.getvalue()
    return out


def enderman_eyes(im):
    """Glow layer from the enderman picture: the eye pixels of the head (purple or white ones), the rest see-through."""
    im = im.convert('RGBA')
    k = max(1, im.width // 64)
    out = Image.new('RGBA', im.size)
    src, dst = im.load(), out.load()
    for y in range(16 * k):
        for x in range(32 * k):
            p = src[x, y]
            if not p[3]:
                continue
            if colorsys.rgb_to_hsv(p[0] / 255, p[1] / 255, p[2] / 255)[1] > 0.35 and max(p[:3]) > 90:
                dst[x, y] = p                          # already purple
            elif min(p[:3]) > 200:
                dst[x, y] = (0xe0, 0x79, 0xfa, 255)    # white eye pixels glow purple like Minecraft's
    buf = io.BytesIO()
    out.save(buf, 'PNG')
    return buf.getvalue()


def entity_files(*roots):
    """entity/NAME, armor/NAME, chest faces and front faces -> PNG bytes. roots: texture folders, first wins."""
    found, origin = {}, {}
    for textures in roots:
        for block, picture in CHEST_FILES.items():
            f = textures / 'entity' / 'chest' / (picture + '.png')
            if f.exists() and f'block/{block}_front' not in found:
                for face, data in chest_faces(f).items():
                    found[f'block/{block}_{face}'] = data
        for block, picture in FRONT_FILES.items():
            f = textures / 'block' / (picture + '.png')
            if f.exists() and f'block/{block}_front' not in found:
                found[f'block/{block}_front'] = f.read_bytes()
        for name, layers in COMPOSED.items():
            files = [textures / 'entity' / (layer + '.png') for layer in layers]
            if 'entity/' + name in found or not all(f.exists() for f in files):
                continue
            pics = [Image.open(f).convert('RGBA') for f in files]
            pic = pics[0]
            for layer in pics[1:]:
                pic.alpha_composite(layer.resize(pic.size, Image.NEAREST))
            buf = io.BytesIO()
            pic.save(buf, 'PNG')
            found['entity/' + name] = buf.getvalue()
            origin[name] = textures
        for name, rels in ENTITY_FILES.items():
            if 'entity/' + name in found:
                continue
            if name in SAME_PACK and origin.get(SAME_PACK[name], textures) != textures:
                continue
            for rel in [rels] if isinstance(rels, str) else rels:
                f = textures / 'entity' / (rel + '.png')
                if not f.exists():
                    continue
                if name in OLD_RATIO:
                    w, h = Image.open(f).size
                    if w != h * OLD_RATIO[name]:
                        continue                   # newer layout, our model would not fit
                found['entity/' + name] = f.read_bytes()
                origin[name] = textures
                break
        # Glowing enderman eyes: packs without their own picture get the purple eye pixels of the head
        if origin.get('enderman') == textures and 'entity/enderman_eyes' not in found:
            found['entity/enderman_eyes'] = enderman_eyes(Image.open(io.BytesIO(found['entity/enderman'])))
        # Menu buttons and sliders (Minecraft 1.20.2+ sprites) for the browser's game menu
        for name in GUI_FILES:
            f = textures / 'gui' / 'sprites' / 'widget' / (name + '.png')
            if f.exists() and 'gui/' + name not in found:
                found['gui/' + name] = f.read_bytes()
        for name, rels in ARMOR_FILES.items():
            if 'armor/' + name in found:
                continue
            for rel in rels:
                f = textures / (rel + '.png')
                if f.exists():
                    found['armor/' + name] = f.read_bytes()
                    break
    return found


if len(sys.argv) >= 4 and sys.argv[1] == '--entities':
    roots = [Path(p) / 'assets/minecraft/textures' for p in sys.argv[2:-1]]
    zip_path = sys.argv[-1]
    with zipfile.ZipFile(zip_path) as z:
        new = entity_files(*roots)
        old = {n: z.read(n) for n in z.namelist() if not n.startswith(('entity/', 'armor/')) and n[:-4] not in new}
    with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as z:
        for n, data in old.items():
            z.writestr(n, data)
        for path, data in sorted(new.items()):
            z.writestr(path + '.png', data)
    print(f'{len(new)} mob, armor, chest and front textures added to {zip_path}')
    sys.exit(0)

only_missing = len(sys.argv) == 5 and sys.argv[1] == '--blocks'
args = sys.argv[2:] if only_missing else sys.argv[1:]
src = Path(args[0]) / 'assets/minecraft/textures'
names = json.load(open(args[1]))
out_path = args[2]

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
    'water_cauldron': 'cauldron', 'wall_torch': 'torch', 'bubble_column': 'water_still', 'chiseled_bookshelf': 'bookshelf',
    'dried_kelp_block': 'dried_kelp', 'powder_snow': 'snow', 'suspicious_gravel': 'gravel', 'suspicious_sand': 'sand',
    'sweet_berry_bush': 'sweet_berry_bush_stage3', 'light_weighted_pressure_plate': 'gold_block',
    'heavy_weighted_pressure_plate': 'iron_block', 'test_block': 'structure_block', 'test_instance_block': 'structure_block',
    'straw_bed': 'hay_block', 'shelf_mushroom': 'brown_mushroom', 'decorated_pot': 'terracotta', 'bamboo_sapling': 'bamboo_small_leaves',
    'pink_petals': 'pink_tulip', 'wildflowers': 'dandelion',
}
FACES = {'sticky_piston': {'_top': 'piston_top_sticky', '': 'piston_side', '_bottom': 'piston_bottom'},
         'piston_head': {'_top': 'piston_top', '': 'piston_side', '_bottom': 'piston_top'}}
ITEM_ALIAS = {'turtle_scute': 'scute', 'compass': 'compass_00', 'clock': 'clock_00', 'debug_stick': 'stick', 'recovery_compass': 'compass_16', 'crossbow': 'crossbow_standby',
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
    # Blocks of the last versions, from a similar picture of the pack
    (r'(\w+)_banner', r'\1_wool', None, 'all'), (r'(\w+)_bed', r'\1_wool', None, 'all'),
    (r'shulker_box', 'purpur_block', None, 'all'), (r'(\w+)_shulker_box', r'\1_concrete', None, 'all'),
    (r'(\w+_)?candle_cake', 'cake', None, 'all'), (r'copper_wall_torch', 'torch', COPPER, 'flame'),
    (r'deepslate_copper_ore', 'iron_ore', (0xb0, 0x70, 0x58), 'ore'),
    (r'big_dripleaf', 'lily_pad', (0x60, 0x9a, 0x30), 'all'), (r'big_dripleaf_stem', 'kelp_plant', (0x50, 0x88, 0x30), 'all'),
    (r'small_dripleaf', 'fern', (0x60, 0x9a, 0x30), 'all'),
    (r'amethyst_cluster|(large|medium|small)_amethyst_bud', 'brain_coral', (0xa0, 0x70, 0xe0), 'all'),
    (r'azalea', 'oak_leaves', FOLIAGE, 'all'), (r'flowering_azalea', 'oak_leaves', (0x90, 0xa8, 0x50), 'all'),
    (r'azalea_bush', 'oak_leaves', FOLIAGE, 'all'), (r'flowering_azalea_bush', 'oak_leaves', (0x90, 0xa8, 0x50), 'all'),
    (r'cave_vines|cave_vines_plant', 'weeping_vines', (0x50, 0x80, 0x30), 'all'),
    (r'glow_lichen', 'vine', (0x70, 0x98, 0x88), 'all'), (r'sculk_vein', 'vine', (0x10, 0x40, 0x48), 'all'),
    (r'resin_clump', 'vine', (0xe0, 0x70, 0x20), 'all'), (r'pale_hanging_moss', 'vine', (0xa8, 0xb0, 0xa0), 'all'),
    (r'hanging_roots', 'weeping_vines', (0x98, 0x70, 0x58), 'all'), (r'mangrove_roots', 'jungle_log', (0x60, 0x48, 0x38), 'all'),
    (r'muddy_mangrove_roots', 'coarse_dirt', (0x50, 0x44, 0x40), 'all'), (r'mangrove_propagule', 'oak_sapling', (0x60, 0xa0, 0x40), 'all'),
    (r'crafter', 'crafting_table', (0x80, 0x80, 0x88), 'all'), (r'creaking_heart', 'birch_log', (0x80, 0x70, 0x60), 'all'),
    (r'dried_ghast', 'soul_sand', (0xc8, 0xc0, 0xc0), 'all'),
    (r'firefly_bush', 'fern', (0x50, 0x80, 0x30), 'all'), (r'bush', 'fern', (0x60, 0x90, 0x40), 'all'),
    (r'short_dry_grass', 'grass', (0xc0, 0xa8, 0x70), 'all'), (r'tall_dry_grass', 'tall_grass_top', (0xc0, 0xa8, 0x70), 'all'),
    (r'leaf_litter', 'oak_leaves', (0xa0, 0x70, 0x40), 'all'),
    (r'closed_eyeblossom', 'allium', (0x80, 0x80, 0x88), 'all'), (r'open_eyeblossom', 'allium', (0xf0, 0x90, 0x30), 'all'),
    (r'golden_dandelion', 'dandelion', (0xf0, 0xc0, 0x30), 'all'), (r'torchflower', 'dandelion', (0xf0, 0x80, 0x30), 'all'),
    (r'torchflower_crop', 'wheat_stage3', (0x80, 0xa0, 0x40), 'all'), (r'pitcher_plant|pitcher_crop', 'large_fern_top', (0x50, 0x90, 0xa0), 'all'),
    (r'cactus_flower', 'poppy', (0xf0, 0x80, 0xa0), 'all'), (r'frogspawn', 'lily_pad', (0x60, 0x50, 0x60), 'all'),
    (r'heavy_core', 'iron_block', (0x50, 0x50, 0x58), 'all'),
    (r'ochre_froglight', 'glowstone', (0xf0, 0xd8, 0x90), 'all'), (r'pearlescent_froglight', 'glowstone', (0xf0, 0xd0, 0xe8), 'all'),
    (r'verdant_froglight', 'glowstone', (0xd0, 0xf0, 0xc0), 'all'),
    (r'orange_poplar_leaves', 'oak_leaves', (0xe0, 0x80, 0x30), 'all'), (r'red_poplar_leaves', 'oak_leaves', (0xc0, 0x40, 0x30), 'all'),
    (r'yellow_poplar_leaves', 'oak_leaves', (0xe0, 0xc0, 0x40), 'all'),
    (r'stripped_poplar_(log|wood)', 'stripped_spruce_log', (0xc8, 0xb0, 0x80), 'all'),
    (r'pointed_dripstone', 'dead_bush', (0x98, 0x78, 0x60), 'all'), (r'red_shrub', 'dead_bush', (0xb0, 0x40, 0x30), 'all'),
    (r'sulfur_spike', 'dead_bush', (0xd8, 0xc8, 0x50), 'all'), (r'sniffer_egg', 'dragon_egg', (0xa0, 0x50, 0x38), 'all'),
    (r'spore_blossom', 'allium', (0xe0, 0x80, 0xb0), 'all'), (r'sulfur_bricks', 'stone_bricks', (0xd8, 0xc8, 0x50), 'all'),
    (r'tinted_glass', 'glass', (0x40, 0x30, 0x48), 'all'), (r'trial_spawner', 'spawner', (0x70, 0x60, 0x50), 'all'),
    (r'vault', 'iron_block', (0x50, 0x58, 0x60), 'all'), (r'dragon_(wall_)?head', 'obsidian', (0x28, 0x24, 0x30), 'all'),
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
        (age + r'lightning_rod', 'end_rod', color, 'all'), (age + r'copper_golem_statue', 'iron_block', color, 'all'),
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
    if base in FACES and all(stem in block_files for stem in FACES[base].values()):
        return dict(FACES[base])
    # The block's own name first (newer packs), then the older name of the same picture
    for name in dict.fromkeys((base, ALIAS.get(base, base))):
        found = {}
        for suffix in ('', '_side', '_top', '_bottom'):
            if name + suffix in block_files:
                found[suffix] = name + suffix
        if '' not in found and '_side' not in found and name + '_front' in block_files:
            found['_side'] = name + '_front'
        if found:
            return found
    return {}


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
    if n.endswith('_wall_fan') or n.endswith('_wall_banner'):
        yield n.replace('_wall_', '_')
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


CANDLE_COLORS = {
    '': (0xe8, 0xd8, 0xb0), 'white': (0xf0, 0xf0, 0xf0), 'orange': (0xf0, 0x80, 0x20), 'magenta': (0xc0, 0x50, 0xc0),
    'light_blue': (0x60, 0xb0, 0xe0), 'yellow': (0xf0, 0xd0, 0x30), 'lime': (0x80, 0xd0, 0x30), 'pink': (0xf0, 0x90, 0xb0),
    'gray': (0x50, 0x58, 0x5c), 'light_gray': (0x9a, 0x9a, 0x94), 'cyan': (0x20, 0x98, 0x98), 'purple': (0x80, 0x38, 0xb0),
    'blue': (0x38, 0x48, 0xa8), 'brown': (0x78, 0x50, 0x30), 'green': (0x50, 0x70, 0x20), 'red': (0xa8, 0x30, 0x28),
    'black': (0x20, 0x20, 0x28),
}
# Heads: picture of the mob (old 64x32 / 64x64 layout, head at 0,0)
HEAD_ENTITY = {
    'skeleton_skull': 'skeleton/skeleton', 'wither_skeleton_skull': 'skeleton/wither_skeleton', 'zombie_head': 'zombie/zombie',
    'creeper_head': 'creeper/creeper', 'player_head': 'player/wide/steve', 'piglin_head': 'piglin/piglin',
}


def candle(color):
    """A candle as Minecraft draws it: 2 px wide, 6 high, centered, with a wick (fits the 16 px block box)."""
    im = Image.new('RGBA', (16, 16))
    px = im.load()
    for y in range(10, 16):
        for x in (7, 8):
            f = 1.08 if x == 7 else 0.85
            px[x, y] = tuple(min(255, int(c * f * (1.05 - (y - 10) * 0.03))) for c in color) + (255,)
    px[7, 9] = (0x30, 0x28, 0x20, 255)
    return im


def head(name):
    """Faces of a mob head block: '' the side (the face on the floor), '_front' the face, '_top' the top of the head. The face sits where the
    block's small box is (lower middle on the floor, middle on a wall)."""
    wall = '_wall_' in name
    base = name.replace('_wall_', '_')
    f = src / 'entity' / (HEAD_ENTITY[base] + '.png')
    if not f.exists() and base == 'player_head':
        f = src / 'entity' / 'steve.png'   # older packs
    if not f.exists():
        return None
    im = Image.open(f).convert('RGBA')
    k = im.width // 64
    crop = lambda x, y: im.crop((x * k, y * k, (x + 8) * k, (y + 8) * k)).resize((8, 8), Image.NEAREST)
    face, top, side = crop(8, 8), crop(8, 0), crop(0, 8)
    def tile(pic, y):
        t = Image.new('RGBA', (16, 16))
        t.paste(pic, (4, y))
        return t
    # A wall head looks one way (front picture); a head on the floor shows its face all around
    y = 4 if wall else 8
    return {'': (tile(side if wall else face, y), None), '_front': (tile(face, y), None), '_top': (tile(top, 4), None)}


def end_portal():
    f = src / 'entity' / 'end_portal.png'
    if not f.exists():
        f = src / 'environment' / 'end_sky.png'   # newer packs have no star picture for the portal
    if not f.exists():
        return None
    stars = Image.open(f).convert('L').crop((0, 0, 64, 64)).resize((32, 32), Image.NEAREST)
    im = Image.new('RGBA', (32, 32))
    px, sp = im.load(), stars.load()
    for y in range(32):
        for x in range(32):
            v = sp[x, y]
            px[x, y] = (int(0x08 + v * 0.35), int(0x10 + v * 0.75), int(0x18 + v * 0.7), 255)
    return {'': (im, None)}


def special(name):
    """Blocks drawn here instead of taken from the pack."""
    m = re.fullmatch(r'(?:(\w+)_)?candle', name)
    if m and (m.group(1) or '') in CANDLE_COLORS:
        return {'': (candle(CANDLE_COLORS[m.group(1) or '']), None)}
    if name.replace('_wall_', '_') in HEAD_ENTITY:
        return head(name)
    if name in ('end_portal', 'end_gateway'):
        return end_portal()
    m = re.fullmatch(r'(?:waxed_)?(exposed_|weathered_|oxidized_)?copper_chest', name)
    if m:
        f = src / 'entity' / 'chest' / 'normal.png'
        if not f.exists():
            return None
        color = COPPER_AGES[m.group(1) or '']
        faces = chest_faces(f)
        return {('' if face == 'side' else '_' + face): (recolor(Image.open(io.BytesIO(data)).convert('RGBA'), color, 'all'), None)
                for face, data in faces.items()}
    m = re.fullmatch(r'(\w+)_shelf', name)
    if m:
        return resolve(m.group(1) + '_planks')
    return None


def resolve(name):
    """{suffix: (image, anim)} for a block, or None."""
    sp = special(name)
    if sp:
        return sp
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


# Pictures of block states the browser draws itself (blockmodels.js), not named after a block
EXTRA_BLOCKS = ['piston_top', 'piston_top_sticky', 'piston_side', 'piston_bottom', 'piston_inner', 'repeater_on', 'comparator_on',
                'redstone_torch_off', 'redstone_dust_dot', 'redstone_dust_line0', 'redstone_dust_line1', 'observer_back',
                'observer_back_on', 'dispenser_front_vertical', 'dropper_front_vertical', 'hopper_outside', 'hopper_inside',
                'daylight_detector_inverted_top', 'redstone_lamp_on', 'powered_rail_on', 'detector_rail_on', 'activator_rail_on',
                'rail_corner', 'furnace_side', 'furnace_top', 'smooth_stone', 'cauldron_inner', 'cauldron_top', 'cauldron_bottom',
                'cauldron_side', 'water_still', 'lava_still', 'powder_snow'] + [
                f'{c}_bed_{part}_{side}' for c in ('white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray',
                                                   'light_gray', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black')
                for part in ('head', 'foot') for side in ('up', 'east', 'west', 'south')]


def extra_blocks(have):
    """{path: png} of the EXTRA_BLOCKS the zip does not have yet, plus their animations."""
    files, extra_anims = {}, {}
    for stem in EXTRA_BLOCKS:
        if 'block/' + stem in have or stem not in block_files:
            continue
        im, anim = load(block_files[stem], stem)
        files['block/' + stem] = png(im)
        if anim:
            extra_anims['block/' + stem] = anim
    return files, extra_anims


out, anims = {}, {}
blocks = set(names['blocks'])
if only_missing:
    # Keep the zip as it is; only blocks with no picture of their own name get one
    with zipfile.ZipFile(out_path) as z:
        old = {n: z.read(n) for n in z.namelist()}
    have = {n[len('block/'):-len('.png')] for n in old if n.startswith('block/')}
    todo = sorted(b for b in blocks if not any(b + suf in have for suf in ('', '_side', '_top', '_front')))
    old_anims = json.loads(old.get('animations.json', b'{}'))
    added, still = [], []
    for name in todo:
        if name in ('air', 'cave_air', 'void_air', 'barrier', 'light', 'structure_void'):
            continue
        found = resolve(name)
        if not found:
            still.append(name)
            continue
        added.append(name)
        for suffix, (im, anim) in found.items():
            old['block/' + name + suffix + '.png'] = png(im)
            if anim:
                old_anims['block/' + name + suffix] = anim
    ex, ex_anims = extra_blocks({n[:-len('.png')] for n in old})
    for path, data in ex.items():
        old[path + '.png'] = data
        added.append(path)
    old_anims.update(ex_anims)
    old['animations.json'] = json.dumps(old_anims, separators=(',', ':')).encode()
    with zipfile.ZipFile(out_path, 'w', zipfile.ZIP_DEFLATED) as z:
        for n, data in sorted(old.items()):
            z.writestr(n, data)
    print(f'{len(added)} blocks added, still without texture: {len(still)}: {" ".join(still)}')
    sys.exit(0)
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

ex, ex_anims = extra_blocks(set(out))
out.update(ex)
anims.update(ex_anims)

# Cracks while digging
for i in range(10):
    stem = f'destroy_stage_{i}'
    if stem in block_files:
        out['block/' + stem] = png(load(block_files[stem], stem, False)[0])

# Item pictures that are no item of their own: the bow and crossbow while being drawn (first-person hand)
EXTRA_ITEMS = ['bow_pulling_0', 'bow_pulling_1', 'bow_pulling_2', 'crossbow_pulling_0', 'crossbow_pulling_1',
               'crossbow_pulling_2', 'crossbow_arrow', 'crossbow_firework', 'crossbow_standby']

missing_items = []
for name in names['list'] + [n for n in EXTRA_ITEMS if n not in names['list']]:
    stem = name if name in item_files else ITEM_ALIAS.get(name, name)
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

credits = """Texturen: Faithful 32x (https://faithfulpack.net)
Copyright (C) Faithful Resource Pack, Lizenz: https://faithfulpack.net/license (siehe LICENSE-Faithful.txt)
Angepasst für WebCraft: umbenannt, Villager aus Haut, Kleidung und Beruf zusammengesetzt, Kistenseiten aus dem
Kistenmodell geschnitten, Blöcke ohne eigenes Bild aus ähnlichen Bildern eingefärbt.

Mobs, deren Bild in Faithful ein neueres Layout hat (Kuh, Pilzkuh, Schwein, Hase, Magmawürfel), und Blöcke, die
Faithful nicht hat: Pixel Perfection Community Edition von XSSheep und der Community
(https://github.com/Athemis/PixelPerfectionCE), Lizenz: CC BY-SA 4.0 (https://creativecommons.org/licenses/by-sa/4.0/)
"""
out.update(entity_files(src))
with zipfile.ZipFile(out_path, 'w', zipfile.ZIP_DEFLATED) as z:
    for path, data in sorted(out.items()):
        z.writestr(path + '.png', data)
    z.writestr('animations.json', json.dumps(anims, separators=(',', ':')))
    z.writestr('LIZENZ.txt', credits)
    # The pack's own license file goes along unchanged (Faithful asks for that)
    for lic in ('LICENSE.txt', 'LICENSE', 'LICENSE.md'):
        if (Path(args[0]) / lic).exists():
            z.writestr('LICENSE-Faithful.txt', (Path(args[0]) / lic).read_bytes())
            break

nb = sum(1 for p in out if p.startswith('block/'))
ni = sum(1 for p in out if p.startswith('item/'))
print(f'{nb} block textures, {ni} item textures, {len(anims)} animated')
print(f'blocks without texture: {len(missing_blocks)}; items without texture: {len(missing_items)}')
open(out_path + '.missing.txt', 'w').write('BLOCKS\n' + '\n'.join(missing_blocks) + '\n\nITEMS\n' + '\n'.join(missing_items))
