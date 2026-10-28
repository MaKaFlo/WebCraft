#!/usr/bin/env python3
"""Builds WebCraft's built-in sound pack from free sounds (no Mojang files).

    tools/make_sounds.py <mineclonia folder> <minetest_game folder> webcraft-common/src/main/resources/webcraft-sounds.zip

Sources (clone them with `git clone --depth 1`):
  https://codeberg.org/mineclonia/mineclonia
  https://github.com/luanti-org/minetest_game

Only files whose license is stated in those projects (CC0, CC BY, CC BY-SA, MIT, WTFPL) are used, see CREDITS.
The zip has Minecraft's layout: sounds.json (event -> files with volume/pitch), sounds/<name>.ogg, plus
fallbacks.json ([regex, event] for events the pack has no own entry for) and LICENSE-sounds.md.
Volumes and pitches make up for what the browser does with block sounds like Minecraft (steps at 0.15 volume,
dig hits at half pitch ...), so the free files sound as loud and as high as in Mineclonia.
Needs ffmpeg for the pieces cut out of long recordings (rain).
"""
import fnmatch
import glob
import io
import json
import os
import subprocess
import sys
import tempfile
import zipfile

MCL, MTG = sys.argv[1], sys.argv[2]
OUT = sys.argv[3]

# ------------------------------------------------------------------ credits (file globs -> who, license, source)

CC0 = 'CC0 1.0'
BY3 = 'CC BY 3.0'
BY4 = 'CC BY 4.0'
SA3 = 'CC BY-SA 3.0'
SA4 = 'CC BY-SA 4.0'
MIT = 'MIT'
WTFPL = 'WTFPL'

MTG_D = 'mtg:mods/default/sounds/'
MCL_S = 'mcl:mods/CORE/mcl_sounds/sounds/'
MOBS = 'mcl:mods/ENTITIES/mobs_mc/sounds/'

CREDITS = [
    # Minetest Game, mods/default/README.md
    (MTG_D + 'default_break_glass.*', 'cmusounddesign, Tomlija, lsprice (freesound.org)', BY3, 'freesound.org/people/cmusounddesign/sounds/71947, Tomlija/sounds/97669, lsprice/sounds/88808'),
    (MTG_D + 'default_dig_crumbly*', 'Mito551', SA3, 'Minetest Game'),
    (MTG_D + 'default_dig_dig_immediate*', 'Mito551', SA3, 'Minetest Game'),
    (MTG_D + 'default_dig_oddly_breakable_by_hand*', 'Mito551', SA3, 'Minetest Game'),
    (MTG_D + 'default_dug_node.*', 'Mito551', SA3, 'Minetest Game'),
    (MTG_D + 'default_grass_footstep.*', 'Mito551', SA3, 'Minetest Game'),
    (MTG_D + 'default_gravel_footstep.*', 'Mito551', SA3, 'Minetest Game'),
    (MTG_D + 'default_place_node.*', 'Mito551', SA3, 'Minetest Game'),
    (MTG_D + 'default_place_node_hard.*', 'Mito551', SA3, 'Minetest Game'),
    (MTG_D + 'default_glass_footstep*', 'Mito551', SA3, 'Minetest Game'),
    (MTG_D + 'default_wood_footstep.*', 'Mito551', SA3, 'Minetest Game'),
    (MTG_D + 'default_dirt_footstep.*', 'Mito551', SA3, 'Minetest Game'),
    (MTG_D + 'default_dig_metal*', 'yadronoff', BY3, 'freesound.org/people/yadronoff/sounds/320397'),
    (MTG_D + 'default_dug_metal.*', 'Iwan Gabovitch (qubodup)', CC0, 'opengameart.org/users/qubodup'),
    (MTG_D + 'default_metal_footstep.*', 'mypantsfelldown', CC0, 'freesound.org/people/mypantsfelldown/sounds/398937'),
    (MTG_D + 'default_place_node_metal.*', 'Ogrebane', CC0, 'opengameart.org/content/wood-and-metal-sound-effects-volume-2'),
    (MTG_D + 'default_water_footstep.*', 'AGFX', BY3, 'freesound.org/people/AGFX/packs/1253'),
    (MTG_D + 'default_dig_snappy*', 'blukotek', CC0, 'freesound.org/people/blukotek/sounds/251660'),
    (MTG_D + 'default_chest_*', 'sofar, mixed from Sevin7 (CC0), Percy Duke, kingsamas, bulbastre (CC BY 3.0), Yoyodaman234 (CC0)', BY3,
     'freesound.org/people/Sevin7/sounds/269722, Percy%20Duke/sounds/23448, kingsamas/sounds/135576, bulbastre/sounds/126887, Yoyodaman234/sounds/183541'),
    (MTG_D + 'default_snow_footstep.*', 'Ryding', CC0, 'freesound.org/people/Ryding/sounds/94337'),
    (MTG_D + 'player_damage*', 'sonictechtonic', BY3, 'freesound.org/people/sonictechtonic/sounds/241872'),
    ('mtg:mods/env_sounds/sounds/env_sounds_water.*', 'Yuval', CC0, 'freesound.org/people/Yuval/sounds/197023'),
    ('mtg:mods/env_sounds/sounds/env_sounds_lava.*', 'Halion', CC0, 'freesound.org/people/Halion/sounds/17785'),
    # Mineclonia, mods/CORE/mcl_sounds/README.txt
    (MCL_S + 'default_dig_choppy.*', 'Sheyvan', CC0, 'freesound.org/people/Sheyvan/sounds/476113'),
    (MCL_S + 'default_gravel_dig.*', 'lolamadeus', CC0, 'freesound.org/people/lolamadeus/sounds/179341'),
    (MCL_S + 'default_gravel_dug.*', 'lolamadeus', CC0, 'freesound.org/people/lolamadeus/sounds/179341'),
    (MCL_S + 'default_dig_cracky.*', 'Benboncan', BY3, 'freesound.org/people/Benboncan/sounds/71823'),
    (MCL_S + 'default_hard_footstep.*', 'Erdie', BY3, 'freesound.org/people/Erdie/sounds/41579'),
    (MCL_S + 'default_sand_footstep.*', 'worthahep88', CC0, 'freesound.org/people/worthahep88/sounds/319224'),
    (MCL_S + 'default_ice_dig.*', 'dheming', BY3, 'freesound.org/people/dheming/sounds/268023'),
    (MCL_S + 'default_ice_footstep.*', 'InspectorJ', BY3, 'freesound.org/people/InspectorJ/sounds/416967'),
    (MCL_S + 'default_ice_dug*', 'Angel_Perez_Grandi', BY3, 'freesound.org/people/Angel_Perez_Grandi/sounds/49190'),
    (MCL_S + 'mcl_sounds_place_node_water*', 'Voxelands project (sdzen, darkrose, sapier, Tom Peter, Telaron, juskiddink)', SA3, 'voxelands.com'),
    (MCL_S + 'mcl_sounds_dug_water*', 'Voxelands project (sdzen, darkrose, sapier, Tom Peter, Telaron, juskiddink)', SA3, 'voxelands.com'),
    (MCL_S + 'default_place_node_lava*', 'Michel Baradari', BY3, 'opengameart.org/content/lava-splash'),
    (MCL_S + 'player_falling_damage*', 'Adam_N', CC0, 'freesound.org/people/Adam_N/sounds/346692'),
    (MCL_S + 'mcl_sounds_cloth.*', 'Alecia Shepherd (SnowSong sound and music pack)', SA4, 'opengameart.org/content/snowsong-sound-and-music-pack'),
    # Mineclonia, other mods (their README / LICENSE files)
    ('mcl:mods/ITEMS/mcl_core/sounds/slimenodes_*', 'Mineclonia (mcl_core)', MIT, 'mods/ITEMS/mcl_core/README'),
    ('mcl:mods/ITEMS/mcl_mud/sounds/*', 'TheRandomLegoBrick', CC0, 'mods/ITEMS/mcl_mud/README.txt'),
    ('mcl:mods/ITEMS/mcl_doors/sounds/doors_door_open*', 'CGEffex, modified by BlockMen', BY3, 'mods/ITEMS/mcl_doors/README.md'),
    ('mcl:mods/ITEMS/mcl_doors/sounds/doors_door_close*', 'bennstir', BY3, 'mods/ITEMS/mcl_doors/README.md'),
    ('mcl:mods/ITEMS/mcl_doors/sounds/doors_steel_door_*', 'HazMattt', BY3, 'freesound.org/people/HazMattt/sounds/187283'),
    ('mcl:mods/ITEMS/mcl_fences/sounds/doors_fencegate_open*', 'mhtaylor67', CC0, 'freesound.org/people/mhtaylor67/sounds/126041'),
    ('mcl:mods/ITEMS/mcl_fences/sounds/doors_fencegate_close*', 'BarkersPinhead, rivernile7', BY3, 'freesound.org/people/BarkersPinhead/sounds/274807, rivernile7/sounds/249573'),
    ('mcl:mods/ITEMS/mcl_barrels/sounds/*', 'quantumriver', CC0, 'freesound.org/people/quantumriver/sounds/552153'),
    ('mcl:mods/ITEMS/mcl_fire/sounds/fire_fire.*', 'Dynamicell', BY3, 'freesound.org/people/Dynamicell/sounds/17548'),
    ('mcl:mods/ITEMS/mcl_fire/sounds/fire_flint_and_steel*', 'Benboncan', BY3, 'freesound.org/people/Benboncan/sounds/66457'),
    ('mcl:mods/ITEMS/mcl_fire/sounds/fire_extinguish_flame.*', 'Perttu Ahola (celeron55)', SA3, 'mods/ITEMS/mcl_fire/README.md'),
    ('mcl:mods/ITEMS/mcl_tnt/sounds/tnt_explode*', "Jose Ortiz 'MindChamber'", CC0, 'mods/ITEMS/mcl_tnt/README.md'),
    ('mcl:mods/ITEMS/mcl_tnt/sounds/tnt_ignite*', 'Ned Bouhalassa, edited', CC0, 'freesound.org/people/Ned%20Bouhalassa/sounds/8320'),
    ('mcl:mods/ITEMS/mcl_bows/sounds/mcl_bows_bow_shoot*', 'JoeDinesSound', CC0, 'freesound.org/people/JoeDinesSound/sounds/534942'),
    ('mcl:mods/ITEMS/mcl_bows/sounds/mcl_bows_hit_other*', 'JoeDinesSound', CC0, 'freesound.org/people/JoeDinesSound/sounds/534952'),
    ('mcl:mods/ITEMS/mcl_bows/sounds/mcl_bows_hit_player*', 'tim.kahn', BY3, 'freesound.org/people/tim.kahn/sounds/38495'),
    ('mcl:mods/ITEMS/mcl_throwing/sounds/mcl_throwing_throw*', 'kretopi', CC0, 'freesound.org/people/kretopi/sounds/406405'),
    ('mcl:mods/ITEMS/mcl_throwing/sounds/mcl_throwing_egg_impact*', 'dav0r', CC0, 'freesound.org/people/dav0r/sounds/176760'),
    ('mcl:mods/ITEMS/mcl_throwing/sounds/mcl_throwing_snowball_impact_hard*', 'Julien Matthey', CC0, 'freesound.org/people/Julien%20Matthey/sounds/167080'),
    ('mcl:mods/ITEMS/mcl_potions/sounds/*', 'Mineclonia (mcl_potions)', CC0, 'mods/ITEMS/mcl_potions/README.md'),
    ('mcl:mods/ITEMS/mcl_fishing/sounds/watersplash*', 'tran5ient', CC0, 'freesound.org/people/tran5ient/sounds/190080'),
    ('mcl:mods/ITEMS/mcl_bells/sounds/*', 'edsward, modified by sorcerykid', CC0, 'freesound.org/people/edsward/sounds/341866'),
    ('mcl:mods/ITEMS/mcl_portals/sounds/mcl_portals_teleport*', 'FreqMan and Wuzzy', BY3, 'freesound.org/people/FreqMan/sounds/32541'),
    ('mcl:mods/ITEMS/mcl_portals/sounds/mcl_portals_open_end_portal*', 'Johnnie_Holiday', CC0, 'freesound.org/people/Johnnie_Holiday/sounds/546571'),
    ('mcl:mods/ITEMS/mcl_armor/sounds/mcl_armor_*_diamond*', 'juryduty', CC0, 'freesound.org/people/juryduty/sounds/180231'),
    ('mcl:mods/ITEMS/mcl_armor/sounds/mcl_armor_*_iron*', 'mitchanary', CC0, 'freesound.org/people/mitchanary/sounds/506148'),
    ('mcl:mods/ITEMS/mcl_armor/sounds/mcl_armor_*_leather*', 'artisticdude', CC0, 'opengameart.org/content/rpg-sound-pack'),
    ('mcl:mods/ITEMS/mcl_armor/sounds/mcl_armor_*_chainmail*', 'artisticdude', CC0, 'opengameart.org/content/rpg-sound-pack'),
    ('mcl:mods/ITEMS/mcl_armor/sounds/mcl_armor_*_generic*', 'Mito551', SA3, 'mods/ITEMS/mcl_armor/README'),
    ('mcl:mods/ITEMS/mcl_tools/sounds/*', 'SmartWentCody', SA3, 'freesound.org/people/SmartWentCody/sounds/179015'),
    ('mcl:mods/ITEMS/mcl_enchanting/sounds/*', 'Alecia Shepherd (SnowSong sound and music pack)', SA4, 'opengameart.org/content/snowsong-sound-and-music-pack'),
    ('mcl:mods/ITEMS/REDSTONE/mcl_noteblock/sounds/mesecons_noteblock_bell*', 'Brandon75689', CC0, 'opengameart.org/content/point-bell'),
    ('mcl:mods/ITEMS/REDSTONE/mcl_noteblock/sounds/mesecons_noteblock_hit*', 'rubberduck', CC0, 'opengameart.org/content/100-cc0-sfx'),
    ('mcl:mods/ENVIRONMENT/mcl_weather/sounds/weather_rain*', 'inchadney, cut', SA3, 'freesound.org/people/inchadney/sounds/58835'),
    ('mcl:mods/ENVIRONMENT/mcl_lightning/sounds/lightning_thunder.1*', 'hantorio', SA3, 'freesound.org/people/hantorio/sounds/121945'),
    ('mcl:mods/ENVIRONMENT/mcl_lightning/sounds/lightning_thunder.2*', 'juskiddink', SA3, 'freesound.org/people/juskiddink/sounds/101948'),
    ('mcl:mods/ENVIRONMENT/mcl_lightning/sounds/lightning_thunder.3*', 'IllusiaProductions', SA3, 'freesound.org/people/IllusiaProductions/sounds/249950'),
    ('mcl:mods/ENTITIES/mcl_item_entity/sounds/item_drop_pickup*', 'benniknop', CC0, 'freesound.org/people/benniknop/sounds/317848'),
    ('mcl:mods/ENTITIES/mcl_mobs/sounds/mcl_mobs_mob_poof*', 'Planman', CC0, 'freesound.org/people/Planman/sounds/208111'),
    ('mcl:mods/ENTITIES/mcl_dripping/sounds/*', 'Mineclonia (mcl_dripping)', CC0, 'mods/ENTITIES/mcl_dripping/README.md'),
    ('mcl:mods/PLAYER/mcl_hunger/sounds/*', 'BlockMen and Wuzzy', WTFPL, 'mods/PLAYER/mcl_hunger/README.md'),
    ('mcl:mods/ITEMS/mcl_jukebox/sounds/mcl_jukebox_track_3*', 'Jordach ("Eastern Feeling")', CC0, 'mods/ITEMS/mcl_jukebox/README.md'),
    ('mcl:mods/ITEMS/mcl_jukebox/sounds/mcl_jukebox_track_4*', 'Jordach ("Minetest")', CC0, 'mods/ITEMS/mcl_jukebox/README.md'),
    ('mcl:mods/ITEMS/mcl_jukebox/sounds/mcl_jukebox_track_5*', 'mactonite ("Soaring over the sea")', BY3, 'ccmixter.org/files/mactonite/65379'),
    ('mcl:mods/ITEMS/mcl_jukebox/sounds/mcl_jukebox_track_6*', 'Tom Peter ("Winter Feeling")', SA3, 'mods/ITEMS/mcl_jukebox/README.md'),
    ('mcl:mods/ITEMS/mcl_jukebox/sounds/mcl_jukebox_track_7*', 'HeroOfTheWinds, mix by Jordach ("Synthgroove")', CC0, 'mods/ITEMS/mcl_jukebox/README.md'),
    ('mcl:mods/ITEMS/mcl_jukebox/sounds/mcl_jukebox_track_1*', 'SoundHelix, mix by Jordach ("The Evil Sister")', CC0, 'mods/ITEMS/mcl_jukebox/README.md'),
    # Mineclonia mobs_mc, LICENSE-media.md ("Sounds not mentioned here are licensed under CC0")
    (MOBS + 'mobs_mc_chicken_lay_egg*', 'PilzAdam and Wuzzy', CC0, 'mobs_mc'),
    (MOBS + 'mobs_mc_chicken_*', 'evsecrets', CC0, 'freesound.org/people/evsecrets/sounds/346961'),
    (MOBS + 'green_slime_damage*', 'RandomationPictures', CC0, 'freesound.org/people/RandomationPictures/sounds/138481'),
    (MOBS + 'green_slime_attack*', 'RandomationPictures', CC0, 'freesound.org/people/RandomationPictures/sounds/138481'),
    (MOBS + 'green_slime_*', 'Dr. Minky', BY3, 'freesound.org/people/DrMinky'),
    (MOBS + 'mobs_mc_cow_hurt*', 'Bird_man, modified', CC0, 'freesound.org/people/Bird_man/packs/16972'),
    (MOBS + 'mobs_mc_cow_milk*', 'Klaraschick, shortened', CC0, 'freesound.org/people/Klaraschick/sounds/415312'),
    (MOBS + 'mobs_mc_cow.ogg', 'Zozzy', CC0, 'freesound.org/people/Zozzy/sounds/59245'),
    (MOBS + 'mobs_mc_wither_spawn*', 'bevibeldesign', CC0, 'freesound.org/people/bevibeldesign/sounds/366095'),
    (MOBS + 'mobs_mc_endermite_*', 'rubberduck', CC0, 'opengameart.org/content/80-cc0-creature-sfx'),
    (MOBS + 'mobs_mc_zombiepig_*', 'rubberduck', CC0, 'opengameart.org/content/80-cc0-creature-sfx'),
    (MOBS + 'mobs_mc_enderman_teleport_*', 'rubberduck', CC0, 'opengameart.org/content/80-cc0-creature-sfx'),
    (MOBS + 'mobs_mc_enderman_random*', 'Soundscapes55', CC0, 'freesound.org/people/Soundscapes55/sounds/434973'),
    (MOBS + 'mobs_mc_enderman_death*', 'griffinjennings, modified', BY3, 'freesound.org/people/griffinjennings/sounds/463972'),
    (MOBS + 'mobs_mc_enderman_hurt*', 'griffinjennings, modified', BY3, 'freesound.org/people/griffinjennings/sounds/463972'),
    (MOBS + 'mobs_mc_guardian_random.1*', 'pointparkcinema', CC0, 'freesound.org/people/pointparkcinema/sounds/407252'),
    (MOBS + 'mobs_mc_guardian_random*', 'nornalbion, modified', BY3, 'freesound.org/people/nornalbion/sounds/195733'),
    (MOBS + 'mobs_mc_guardian_hurt*', 'nornalbion, modified', BY3, 'freesound.org/people/nornalbion/sounds/195733'),
    (MOBS + 'mobs_mc_guardian_death*', 'TheBuilder15', CC0, 'freesound.org/people/TheBuilder15'),
    (MOBS + 'mobs_sheep*', 'Blender Foundation', BY3, 'mobs_mc LICENSE-media.md'),
    (MOBS + 'mobs_mc_blaze_breath*', 'daufinsyd', MIT, 'mobs_mc LICENSE-media.md'),
    (MOBS + 'mobs_mc_blaze_died*', 'daufinsyd', MIT, 'mobs_mc LICENSE-media.md'),
    (MOBS + 'mobs_mc_blaze_hurt*', 'thefilmbakery', CC0, 'freesound.org/people/thefilmbakery/sounds/137836'),
    (MOBS + 'mobs_mc_squid_hurt*', 'qubodup, changed', BY3, 'opengameart.org/content/slime-monster'),
    (MOBS + 'mobs_mc_squid_death*', 'qubodup, changed', BY3, 'opengameart.org/content/slime-monster'),
    (MOBS + 'mobs_mc_squid_flop*', 'kyles', CC0, 'freesound.org/people/kyles/sounds/450830'),
    (MOBS + 'mobs_mc_snowman_hurt.1*', 'kyles', CC0, 'freesound.org/people/kyles/sounds/450848'),
    (MOBS + 'mobs_mc_snowman_hurt*', 'cabled_mess', CC0, 'freesound.org/people/cabled_mess/sounds/384424'),
    (MOBS + 'mobs_mc_snowman_death*', 'alexo400', CC0, 'freesound.org/people/alexo400/sounds/543385'),
    (MOBS + 'mobs_fireball*', 'TenPlus1 (mobs_monster)', MIT, 'mobs_mc LICENSE-media.md'),
    (MOBS + 'mobs_mc_cat_idle.1*', 'TenPlus1 (mobs_animal)', MIT, 'mobs_mc LICENSE-media.md'),
    (MOBS + 'mobs_mc_cat_idle.2*', 'SelsRoyalNavy', CC0, 'freesound.org/people/SelsRoyalNavy/sounds/427081'),
    (MOBS + 'mobs_mc_cat_hiss*', 'cmusounddesign', BY3, 'freesound.org/people/cmusounddesign/sounds/71899'),
    (MOBS + 'mobs_mc_llama*', 'TenPlus1 (mobs_animal)', MIT, 'mobs_mc LICENSE-media.md'),
    (MOBS + 'mobs_pig*', 'TenPlus1 (mobs_animal)', MIT, 'mobs_mc LICENSE-media.md'),
    (MOBS + 'mobs_mc_spider_hurt*', 'Darsycho', CC0, 'freesound.org/people/Darsycho/sounds/505185'),
    (MOBS + 'mobs_mc_spider_*', 'columbia23', BY3, 'freesound.org/people/columbia23/sounds/395395'),
    (MOBS + 'mobs_mc_zombie_growl*', 'Under7dude', CC0, 'freesound.org/people/Under7dude/sounds/163445'),
    (MOBS + 'mobs_mc_zombie_death*', 'haratman', CC0, 'freesound.org/people/haratman/sounds/393749'),
    (MOBS + 'mobs_mc_zombie_hurt*', 'haratman', CC0, 'freesound.org/people/haratman/sounds/393749'),
    (MOBS + 'mobs_mc_zombie_door_break*', 'F.M.Audio', BY4, 'freesound.org/people/F.M.Audio/sounds/547580'),
    (MOBS + 'mobs_mc_skeleton_random*', 'kantouth, remix by Baŝto', BY3, 'opengameart.org/content/walking-skeleton'),
    (MOBS + 'mobs_mc_skeleton_death*', 'spookymodem', CC0, 'freesound.org/people/spookymodem/sounds/202091'),
    (MOBS + 'mobs_mc_skeleton_hurt*', 'Cribbler', CC0, 'freesound.org/people/Cribbler/sounds/381859'),
    (MOBS + 'mobs_mc_horse_random.1*', 'GoodListener', BY3, 'freesound.org/people/GoodListener/sounds/322454'),
    (MOBS + 'mobs_mc_horse_death*', 'GoodListener', BY3, 'freesound.org/people/GoodListener/sounds/322445'),
    (MOBS + 'mobs_mc_horse_random.2*', 'ERH', BY3, 'freesound.org/people/ERH/sounds/32043'),
    (MOBS + 'mobs_mc_donkey_random.2*', 'JarredGibb', CC0, 'freesound.org/people/JarredGibb/sounds/233131'),
    (MOBS + 'mobs_mc_donkey_*', 'Garuda1982', BY3, 'freesound.org/people/Garuda1982/sounds/539505'),
    (MOBS + 'mobs_mc_creeper_death*', 'j1987', CC0, 'freesound.org/people/j1987/sounds/111325'),
    (MOBS + 'mobs_mc_creeper_hurt*', 'themightyglider', CC0, 'opengameart.org/content/simple-fuse-sound'),
    (MOBS + 'mobs_mc_vex_hurt*', 'pauliw', CC0, 'opengameart.org/content/some-kind-of-beings-soundsx'),
    (MOBS + 'mobs_mc_vex_death*', 'pauliw', CC0, 'opengameart.org/content/some-kind-of-beings-sounds7'),
    (MOBS + 'mobs_mc_bat_idle*', 'suonho', BY3, 'freesound.org/people/suonho/sounds/59344'),
    (MOBS + 'mobs_mc_bat_*', 'toefur', CC0, 'freesound.org/people/toefur/sounds/288941'),
    (MOBS + 'mobs_mc_ocelot_hurt*', 'ebcrosby', BY3, 'freesound.org/people/ebcrosby/sounds/332979'),
    (MOBS + 'mobs_mc_wolf_take_bone*', 'cliftonmcarlson', CC0, 'freesound.org/people/cliftonmcarlson/sounds/392883'),
    (MOBS + 'mobs_mc_wolf_*', 'Hybrid Dog (dogblocks), modified', CC0, 'github.com/HybridDog/dogblocks'),
    (MOBS + 'mobs_mc_silverfish_*', 'Inocodum', SA4, 'forum.minetest.net/viewtopic.php?f=17&t=10013'),
    (MOBS + 'mobs_mc_magma_cube_attack*', 'kbnevel', CC0, 'freesound.org/people/kbnevel/sounds/119863'),
    (MOBS + 'mobs_mc_magma_cube_*', 'LukeIRL', BY4, 'freesound.org/people/LukeIRL/sounds/176123'),
    (MOBS + 'mobs_mc_animal_eat_generic*', 'InspectorJ', BY3, 'freesound.org/people/InspectorJ/sounds/429591'),
    (MOBS + 'mobs_mc_bear_random*', 'tbsounddesigns', BY3, 'freesound.org/people/tbsounddesigns/sounds/416853'),
    (MOBS + 'mobs_mc_bear_growl*', 'tbsounddesigns', BY3, 'freesound.org/people/tbsounddesigns/sounds/416861'),
    (MOBS + 'mobs_mc_bear_*', 'YleArkisto, changed', BY3, 'freesound.org/people/YleArkisto/sounds/249441'),
    (MOBS + 'mobs_mc_rabbit_random*', 'Alshred, changed', CC0, 'freesound.org/people/Alshred/sounds/403773'),
    (MOBS + 'mobs_mc_rabbit_*', 'kessir', CC0, 'freesound.org/people/kessir/sounds/372075'),
    (MOBS + 'mobs_mc_dolphin_*', 'felix.blume', CC0, 'freesound.org/people/felix.blume/sounds/408555'),
    (MOBS + 'mobs_mc_ghast_*', 'Department64', CC0, 'freesound.org/people/Department64/sounds/64011'),
    (MOBS + 'mobs_mc_villager*', 'Mineclonia (mobs_mc)', CC0, 'mobs_mc LICENSE-media.md'),
    (MOBS + 'mobs_mc_pillager_*', 'Mineclonia (mobs_mc)', CC0, 'mobs_mc LICENSE-media.md'),
    (MOBS + 'mobs_mc_iron_golem_hurt*', 'Mineclonia (mobs_mc)', CC0, 'mobs_mc LICENSE-media.md'),
    (MOBS + 'mobs_mc_horse_hurt*', 'Mineclonia (mobs_mc)', CC0, 'mobs_mc LICENSE-media.md'),
    (MOBS + 'mobs_mc_axolotl*', 'Mineclonia (mobs_mc)', CC0, 'mobs_mc LICENSE-media.md'),
]

SOURCES = {'mcl': MCL, 'mtg': MTG}


def credit_of(src):
    for pattern, who, lic, url in CREDITS:
        prefix, path = pattern.split(':', 1)
        sp, spath = src.split(':', 1)
        if sp == prefix and fnmatch.fnmatch(spath, path):
            return who, lic, url
    return None


# ------------------------------------------------------------------ events

def F(pattern, vol=1.0, pitch=1.0, stream=False):
    """Files of a source glob ('mcl:...' / 'mtg:...'), each with volume and pitch."""
    prefix, path = pattern.split(':', 1)
    found = sorted(glob.glob(os.path.join(SOURCES[prefix], path)))
    if not found:
        raise SystemExit('no file for ' + pattern)
    return [(prefix + ':' + os.path.relpath(f, SOURCES[prefix]), vol, pitch, stream) for f in found]


EVENTS = {}


def ev(name, *lists):
    EVENTS[name] = [e for l in lists for e in l]


# The browser plays block sounds like Minecraft: break/place at (v+1)/2 volume and 0.8 pitch, steps at 0.15 x v,
# dig hits at (v+1)/8 and half pitch, landing at 0.5 x v and 0.75 pitch. Mineclonia's gains are absolute.
def block(group, step, brk, place, hit, fall=None):
    s_file, s_gain = step
    b_file, b_gain = brk
    p_file, p_gain = place
    h_file, h_gain = hit
    ev(f'block.{group}.step', F(s_file, s_gain / 0.15))
    ev(f'block.{group}.break', F(b_file, b_gain, 1.25))
    ev(f'block.{group}.place', F(p_file, p_gain, 1.25))
    ev(f'block.{group}.hit', F(h_file, h_gain / 0.25, 2.0))
    f_file, f_gain = fall or step
    ev(f'block.{group}.fall', F(f_file, f_gain * 2 / 0.5, 1 / 0.75))


HARD = MCL_S + 'default_hard_footstep.*'
block('stone', (HARD, 0.2), (HARD, 1.0), (MTG_D + 'default_place_node_hard.*', 1.0), (MCL_S + 'default_dig_cracky.*', 0.5))
block('wood', (MTG_D + 'default_wood_footstep.*', 0.15), (MTG_D + 'default_wood_footstep.*', 1.0),
      (MTG_D + 'default_place_node_hard.*', 1.0), (MCL_S + 'default_dig_choppy.*', 0.4))
block('gravel', (MTG_D + 'default_gravel_footstep.*', 0.1), (MCL_S + 'default_gravel_dug.*', 0.75),
      (MTG_D + 'default_place_node.*', 1.0), (MCL_S + 'default_gravel_dig.*', 0.35))
block('grass', (MTG_D + 'default_grass_footstep.*', 0.1325), (MTG_D + 'default_grass_footstep.*', 0.425),
      (MTG_D + 'default_place_node.*', 1.0), (MTG_D + 'default_dig_snappy.ogg', 0.4))
block('sand', (MCL_S + 'default_sand_footstep.*', 0.045), (MCL_S + 'default_sand_footstep.*', 0.15),
      (MTG_D + 'default_place_node.*', 1.0), (MTG_D + 'default_dig_crumbly.ogg', 0.4))
block('snow', (MTG_D + 'default_snow_footstep.*', 0.4), (MTG_D + 'default_snow_footstep.*', 1.0),
      (MTG_D + 'default_place_node.*', 1.0), (MTG_D + 'default_snow_footstep.*', 1.0))
block('wool', (MCL_S + 'mcl_sounds_cloth.*', 0.2), (MCL_S + 'mcl_sounds_cloth.*', 0.8),
      (MCL_S + 'mcl_sounds_cloth.*', 0.8), (MCL_S + 'mcl_sounds_cloth.*', 0.8))
block('glass', (MTG_D + 'default_glass_footstep.ogg', 0.25), (MTG_D + 'default_break_glass.*', 0.5),
      (MTG_D + 'default_place_node_hard.*', 1.0), (MCL_S + 'default_dig_cracky.*', 0.5))
block('metal', (MTG_D + 'default_metal_footstep.*', 0.2), (MTG_D + 'default_dug_metal.*', 0.5),
      (MTG_D + 'default_place_node_metal.*', 0.5), (MTG_D + 'default_dig_metal.ogg', 0.5))
block('slime_block', ('mcl:mods/ITEMS/mcl_core/sounds/slimenodes_step.*', 0.2), ('mcl:mods/ITEMS/mcl_core/sounds/slimenodes_dug.*', 0.6),
      ('mcl:mods/ITEMS/mcl_core/sounds/slimenodes_place.*', 0.6), ('mcl:mods/ITEMS/mcl_core/sounds/slimenodes_step.*', 0.3))
block('mud', ('mcl:mods/ITEMS/mcl_mud/sounds/mud_footsteps.ogg', 0.2), ('mcl:mods/ITEMS/mcl_mud/sounds/mud_place_dug.ogg', 0.6),
      ('mcl:mods/ITEMS/mcl_mud/sounds/mud_place_dug.ogg', 0.6), ('mcl:mods/ITEMS/mcl_mud/sounds/mud_footsteps.ogg', 0.3))
block('ice', (MCL_S + 'default_ice_footstep.*', 0.075), (MCL_S + 'default_ice_dug.ogg', 0.35),
      (MTG_D + 'default_place_node_hard.*', 1.0), (MCL_S + 'default_ice_dig.*', 0.35))

# Water, lava, fire
ev('block.water.ambient', F('mtg:mods/env_sounds/sounds/env_sounds_water.*', 0.4))
ev('block.lava.ambient', F('mtg:mods/env_sounds/sounds/env_sounds_lava.*', 0.6))
ev('block.lava.extinguish', F('mcl:mods/ITEMS/mcl_fire/sounds/fire_extinguish_flame.*', 0.6))
ev('block.fire.ambient', F('mcl:mods/ITEMS/mcl_fire/sounds/fire_fire.*', 0.4))
ev('block.fire.extinguish', F('mcl:mods/ITEMS/mcl_fire/sounds/fire_extinguish_flame.*', 0.6))
ev('block.furnace.fire_crackle', F('mcl:mods/ITEMS/mcl_fire/sounds/fire_fire.*', 0.3, 1.2))
ev('block.campfire.crackle', F('mcl:mods/ITEMS/mcl_fire/sounds/fire_fire.*', 0.3))
ev('block.candle.ambient', F('mcl:mods/ITEMS/mcl_fire/sounds/fire_fire.*', 0.05, 1.4))
ev('item.flintandsteel.use', F('mcl:mods/ITEMS/mcl_fire/sounds/fire_flint_and_steel.ogg'))
ev('item.bucket.fill', F(MCL_S + 'mcl_sounds_dug_water.ogg', 0.6))
ev('item.bucket.empty', F(MCL_S + 'mcl_sounds_place_node_water.ogg', 0.6))
ev('item.bucket.fill_lava', F(MCL_S + 'default_place_node_lava.ogg', 0.6))
ev('item.bucket.empty_lava', F(MCL_S + 'default_place_node_lava.ogg', 0.6))
ev('block.pointed_dripstone.drip_water', F('mcl:mods/ENTITIES/mcl_dripping/sounds/drippingwater_drip.*', 0.5))
ev('block.pointed_dripstone.drip_lava', F('mcl:mods/ENTITIES/mcl_dripping/sounds/drippingwater_lavadrip.*', 0.5))

# Doors, gates, containers, buttons
ev('block.wooden_door.open', F('mcl:mods/ITEMS/mcl_doors/sounds/doors_door_open.ogg'))
ev('block.wooden_door.close', F('mcl:mods/ITEMS/mcl_doors/sounds/doors_door_close.ogg'))
ev('block.iron_door.open', F('mcl:mods/ITEMS/mcl_doors/sounds/doors_steel_door_open.ogg'))
ev('block.iron_door.close', F('mcl:mods/ITEMS/mcl_doors/sounds/doors_steel_door_close.ogg'))
ev('block.wooden_trapdoor.open', F('mcl:mods/ITEMS/mcl_doors/sounds/doors_door_open.ogg', 0.8, 1.3))
ev('block.wooden_trapdoor.close', F('mcl:mods/ITEMS/mcl_doors/sounds/doors_door_close.ogg', 0.8, 1.3))
ev('block.iron_trapdoor.open', F('mcl:mods/ITEMS/mcl_doors/sounds/doors_steel_door_open.ogg', 0.8, 1.3))
ev('block.iron_trapdoor.close', F('mcl:mods/ITEMS/mcl_doors/sounds/doors_steel_door_close.ogg', 0.8, 1.3))
ev('block.fence_gate.open', F('mcl:mods/ITEMS/mcl_fences/sounds/doors_fencegate_open.ogg'))
ev('block.fence_gate.close', F('mcl:mods/ITEMS/mcl_fences/sounds/doors_fencegate_close.ogg'))
ev('block.chest.open', F(MTG_D + 'default_chest_open.ogg'))
ev('block.chest.close', F(MTG_D + 'default_chest_close.ogg'))
ev('block.ender_chest.open', F(MTG_D + 'default_chest_open.ogg', 1.0, 0.7))
ev('block.ender_chest.close', F(MTG_D + 'default_chest_close.ogg', 1.0, 0.7))
ev('block.shulker_box.open', F(MTG_D + 'default_chest_open.ogg', 1.0, 1.3))
ev('block.shulker_box.close', F(MTG_D + 'default_chest_close.ogg', 1.0, 1.3))
ev('block.barrel.open', F('mcl:mods/ITEMS/mcl_barrels/sounds/mcl_barrels_default_barrel_open.ogg'))
ev('block.barrel.close', F('mcl:mods/ITEMS/mcl_barrels/sounds/mcl_barrels_default_barrel_close.ogg'))
CLICK = MTG_D + 'default_dig_dig_immediate.ogg'
ev('block.wooden_button.click_on', F(CLICK, 0.6, 1.6))
ev('block.wooden_button.click_off', F(CLICK, 0.6, 1.3))
ev('block.stone_button.click_on', F(CLICK, 0.6, 1.8))
ev('block.stone_button.click_off', F(CLICK, 0.6, 1.5))
ev('block.lever.click', F(CLICK, 1.5, 1.5))
ev('block.wooden_pressure_plate.click_on', F(CLICK, 0.5, 1.2))
ev('block.wooden_pressure_plate.click_off', F(CLICK, 0.5, 1.0))
ev('block.stone_pressure_plate.click_on', F(CLICK, 0.5, 1.4))
ev('block.stone_pressure_plate.click_off', F(CLICK, 0.5, 1.2))
ev('ui.button.click', F(CLICK, 2.0, 2.0))
ev('block.bell.use', F('mcl:mods/ITEMS/mcl_bells/sounds/*.ogg'))
ev('block.anvil.land', F(MTG_D + 'default_dug_metal.*', 1.0, 0.6))
ev('block.anvil.use', F(MTG_D + 'default_dig_metal.ogg', 1.0, 0.8))
ev('block.anvil.destroy', F(MTG_D + 'default_dug_metal.*', 1.0, 0.5))
ev('block.enchantment_table.use', F('mcl:mods/ITEMS/mcl_enchanting/sounds/*.ogg'))
ev('block.end_portal.spawn', F('mcl:mods/ITEMS/mcl_portals/sounds/mcl_portals_open_end_portal.ogg'))
ev('block.portal.travel', F('mcl:mods/ITEMS/mcl_portals/sounds/mcl_portals_teleport.ogg', 0.5))
ev('block.portal.trigger', F('mcl:mods/ITEMS/mcl_portals/sounds/mcl_portals_teleport.ogg', 0.3, 0.8))

# Player, items
ev('entity.player.hurt', F(MTG_D + 'player_damage.ogg'))
ev('entity.player.death', F(MTG_D + 'player_damage.ogg', 1.0, 0.8))
ev('entity.player.small_fall', F(MCL_S + 'player_falling_damage.ogg', 0.6))
ev('entity.player.big_fall', F(MCL_S + 'player_falling_damage.ogg', 1.0, 0.8))
ev('entity.player.attack.strong', F(MTG_D + 'default_dug_node.*', 0.8, 0.9))
ev('entity.player.attack.knockback', F(MTG_D + 'default_dug_node.*', 1.0, 0.8))
ev('entity.player.attack.sweep', F(MTG_D + 'default_dug_node.*', 0.8, 1.1))
ev('entity.player.attack.crit', F(MTG_D + 'default_dug_node.*', 1.0, 1.4))
ev('entity.player.attack.weak', F(MTG_D + 'default_dug_node.*', 0.4, 1.2))
ev('entity.player.attack.nodamage', F(MTG_D + 'default_dug_node.*', 0.3, 1.3))
ev('entity.player.swim', F(MTG_D + 'default_water_footstep.*', 0.6))
ev('entity.player.splash', F('mcl:mods/ITEMS/mcl_fishing/sounds/watersplash.ogg', 0.8))
ev('entity.generic.splash', F('mcl:mods/ITEMS/mcl_fishing/sounds/watersplash.ogg', 0.8))
ev('entity.generic.swim', F(MTG_D + 'default_water_footstep.*', 0.5))
ev('entity.player.levelup', F('mcl:mods/ITEMS/REDSTONE/mcl_noteblock/sounds/mesecons_noteblock_bell.ogg', 1.0, 1.0),)
ev('entity.experience_orb.pickup', F('mcl:mods/ITEMS/REDSTONE/mcl_noteblock/sounds/mesecons_noteblock_bell.ogg', 0.8, 1.5))
ev('entity.item.pickup', F('mcl:mods/ENTITIES/mcl_item_entity/sounds/item_drop_pickup.ogg'))
ev('entity.generic.eat', F('mcl:mods/PLAYER/mcl_hunger/sounds/mcl_hunger_bite.ogg'), F('mcl:mods/PLAYER/mcl_hunger/sounds/mcl_hunger_eat.ogg'))
ev('entity.player.burp', F('mcl:mods/PLAYER/mcl_hunger/sounds/mcl_hunger_eat.ogg', 0.5, 0.7))
ev('entity.generic.drink', F('mcl:mods/PLAYER/mcl_hunger/sounds/survival_thirst_drink.ogg'))
ev('item.bottle.fill', F('mcl:mods/ITEMS/mcl_potions/sounds/mcl_potions_bottle_fill.ogg'))
ev('item.bottle.empty', F('mcl:mods/ITEMS/mcl_potions/sounds/mcl_potions_bottle_pour.ogg'))
ev('entity.splash_potion.break', F('mcl:mods/ITEMS/mcl_potions/sounds/mcl_potions_breaking_glass.ogg'))
ev('entity.splash_potion.throw', F('mcl:mods/ITEMS/mcl_throwing/sounds/mcl_throwing_throw.ogg'))
ev('entity.generic.explode', F('mcl:mods/ITEMS/mcl_tnt/sounds/tnt_explode.ogg'))
ev('entity.tnt.primed', F('mcl:mods/ITEMS/mcl_tnt/sounds/tnt_ignite.ogg'))
ev('entity.creeper.primed', F('mcl:mods/ITEMS/mcl_tnt/sounds/tnt_ignite.ogg'))
ev('entity.arrow.shoot', F('mcl:mods/ITEMS/mcl_bows/sounds/mcl_bows_bow_shoot.ogg'))
ev('entity.arrow.hit', F('mcl:mods/ITEMS/mcl_bows/sounds/mcl_bows_hit_other.ogg'))
ev('entity.arrow.hit_player', F('mcl:mods/ITEMS/mcl_bows/sounds/mcl_bows_hit_player.ogg'))
for t in ('snowball', 'egg', 'ender_pearl', 'experience_bottle', 'wind_charge', 'lingering_potion'):
    ev(f'entity.{t}.throw', F('mcl:mods/ITEMS/mcl_throwing/sounds/mcl_throwing_throw.ogg'))
ev('entity.turtle.egg_crack', F('mcl:mods/ITEMS/mcl_throwing/sounds/mcl_throwing_egg_impact.ogg'))
ev('entity.fishing_bobber.splash', F('mcl:mods/ITEMS/mcl_fishing/sounds/watersplash.ogg'))
ev('entity.fishing_bobber.throw', F('mcl:mods/ITEMS/mcl_throwing/sounds/mcl_throwing_throw.ogg'))
ev('entity.lightning_bolt.thunder', F('mcl:mods/ENVIRONMENT/mcl_lightning/sounds/lightning_thunder.*'))
ev('entity.lightning_bolt.impact', F('mcl:mods/ITEMS/mcl_tnt/sounds/tnt_explode.ogg', 0.5, 1.4))
ev('entity.firework_rocket.launch', F('mcl:mods/ITEMS/mcl_throwing/sounds/mcl_throwing_throw.ogg', 1.0, 0.7))
ev('entity.firework_rocket.blast', F('mcl:mods/ITEMS/mcl_tnt/sounds/tnt_explode.ogg', 0.4, 1.8))
ev('entity.firework_rocket.large_blast', F('mcl:mods/ITEMS/mcl_tnt/sounds/tnt_explode.ogg', 0.6, 1.5))
ev('item.shears.shear', F('mcl:mods/ITEMS/mcl_tools/sounds/mcl_tools_shears_cut.ogg'))
ev('entity.sheep.shear', F('mcl:mods/ITEMS/mcl_tools/sounds/mcl_tools_shears_cut.ogg'))
ev('item.hoe.till', F(MCL_S + 'default_gravel_dig.*', 1.0))
ev('item.shovel.flatten', F(MCL_S + 'default_gravel_dig.*', 1.0))
ev('item.axe.strip', F(MCL_S + 'default_dig_choppy.*', 1.0))
ev('item.armor.equip_generic', F('mcl:mods/ITEMS/mcl_armor/sounds/mcl_armor_equip_generic.ogg'))
ev('item.armor.equip_leather', F('mcl:mods/ITEMS/mcl_armor/sounds/mcl_armor_equip_leather.ogg'))
ev('item.armor.equip_chain', F('mcl:mods/ITEMS/mcl_armor/sounds/mcl_armor_equip_chainmail.ogg'))
ev('item.armor.equip_iron', F('mcl:mods/ITEMS/mcl_armor/sounds/mcl_armor_equip_iron.ogg'))
ev('item.armor.equip_diamond', F('mcl:mods/ITEMS/mcl_armor/sounds/mcl_armor_equip_diamond.ogg'))

# Mobs
M = lambda f, vol=1.0, pitch=1.0: F(MOBS + f, vol, pitch)
POOF = F('mcl:mods/ENTITIES/mcl_mobs/sounds/mcl_mobs_mob_poof.ogg', 0.6)
ev('entity.generic.death', POOF)
ev('entity.generic.hurt', F(MTG_D + 'default_dug_node.*', 0.6, 0.8))
ev('entity.cow.ambient', M('mobs_mc_cow.ogg'))
ev('entity.cow.hurt', M('mobs_mc_cow_hurt.ogg'))
ev('entity.cow.death', M('mobs_mc_cow_hurt.ogg', 1.0, 0.8))
ev('entity.cow.milk', M('mobs_mc_cow_milk.ogg'))
ev('entity.pig.ambient', M('mobs_pig.ogg'))
ev('entity.pig.hurt', M('mobs_pig_angry.ogg'))
ev('entity.pig.death', M('mobs_pig_angry.ogg', 1.0, 0.8))
ev('entity.sheep.ambient', M('mobs_sheep.ogg'))
ev('entity.sheep.hurt', M('mobs_sheep.ogg', 1.0, 1.3))
ev('entity.sheep.death', M('mobs_sheep.ogg', 1.0, 0.8))
ev('entity.chicken.ambient', M('mobs_mc_chicken_buck.*'))
ev('entity.chicken.hurt', M('mobs_mc_chicken_hurt.ogg'))
ev('entity.chicken.death', M('mobs_mc_chicken_hurt.ogg', 1.0, 0.8))
ev('entity.chicken.egg', M('mobs_mc_chicken_lay_egg.ogg'))
ev('entity.zombie.ambient', M('mobs_mc_zombie_growl.ogg'))
ev('entity.zombie.hurt', M('mobs_mc_zombie_hurt.ogg'))
ev('entity.zombie.death', M('mobs_mc_zombie_death.ogg'))
ev('entity.zombie.attack_wooden_door', M('mobs_mc_zombie_door_break.*', 0.6))
ev('entity.zombie.attack_iron_door', M('mobs_mc_zombie_door_break.*', 0.6, 0.8))
ev('entity.zombie.break_wooden_door', M('mobs_mc_zombie_door_break.*'))
ev('entity.skeleton.ambient', M('mobs_mc_skeleton_random.*'))
ev('entity.skeleton.hurt', M('mobs_mc_skeleton_hurt.ogg'))
ev('entity.skeleton.death', M('mobs_mc_skeleton_death.ogg'))
ev('entity.skeleton.shoot', F('mcl:mods/ITEMS/mcl_bows/sounds/mcl_bows_bow_shoot.ogg'))
ev('entity.creeper.hurt', M('mobs_mc_creeper_hurt.ogg'))
ev('entity.creeper.death', M('mobs_mc_creeper_death.ogg'))
ev('entity.spider.ambient', M('mobs_mc_spider_random.ogg'))
ev('entity.spider.hurt', M('mobs_mc_spider_hurt.*'))
ev('entity.spider.death', M('mobs_mc_spider_death.ogg'))
ev('entity.enderman.ambient', M('mobs_mc_enderman_random.*'))
ev('entity.enderman.stare', M('mobs_mc_enderman_random.*', 1.0, 0.8))
ev('entity.enderman.scream', M('mobs_mc_enderman_hurt.*', 1.0, 1.2))
ev('entity.enderman.hurt', M('mobs_mc_enderman_hurt.*'))
ev('entity.enderman.death', M('mobs_mc_enderman_death.ogg'))
ev('entity.enderman.teleport', M('mobs_mc_enderman_teleport_*.ogg'))
ev('entity.player.teleport', M('mobs_mc_enderman_teleport_*.ogg'))
ev('item.chorus_fruit.teleport', M('mobs_mc_enderman_teleport_*.ogg'))
ev('entity.endermite.ambient', M('mobs_mc_endermite_random.*'))
ev('entity.endermite.hurt', M('mobs_mc_endermite_hurt.*'))
ev('entity.endermite.death', M('mobs_mc_endermite_death.*'))
ev('entity.slime.jump', M('green_slime_jump.ogg'))
ev('entity.slime.squish', M('green_slime_land.ogg'))
ev('entity.slime.hurt', M('green_slime_damage.ogg'))
ev('entity.slime.death', M('green_slime_death.ogg'))
ev('entity.slime.attack', M('green_slime_attack.ogg'))
ev('entity.magma_cube.jump', M('mobs_mc_magma_cube_big.ogg'))
ev('entity.magma_cube.squish', M('mobs_mc_magma_cube_small.ogg'))
ev('entity.magma_cube.hurt', M('mobs_mc_magma_cube_small.ogg', 1.0, 1.2))
ev('entity.magma_cube.death', M('mobs_mc_magma_cube_big.ogg', 1.0, 0.8))
ev('entity.wolf.ambient', M('mobs_mc_wolf_bark.*'))
ev('entity.wolf.growl', M('mobs_mc_wolf_growl.ogg'))
ev('entity.wolf.hurt', M('mobs_mc_wolf_hurt.*'))
ev('entity.wolf.death', M('mobs_mc_wolf_death.ogg'))
ev('entity.wolf.whine', M('mobs_mc_wolf_hurt.*', 0.5, 1.3))
ev('entity.cat.ambient', M('mobs_mc_cat_idle.*'))
ev('entity.cat.hiss', M('mobs_mc_cat_hiss.ogg'))
ev('entity.cat.hurt', M('mobs_mc_ocelot_hurt.ogg'))
ev('entity.cat.death', M('mobs_mc_ocelot_hurt.ogg', 1.0, 0.8))
ev('entity.ocelot.ambient', M('mobs_mc_cat_idle.*'))
ev('entity.ocelot.hurt', M('mobs_mc_ocelot_hurt.ogg'))
ev('entity.ocelot.death', M('mobs_mc_ocelot_hurt.ogg', 1.0, 0.8))
ev('entity.horse.ambient', M('mobs_mc_horse_random.*'))
ev('entity.horse.hurt', M('mobs_mc_horse_hurt.ogg'))
ev('entity.horse.death', M('mobs_mc_horse_death.ogg'))
ev('entity.donkey.ambient', M('mobs_mc_donkey_random.*'))
ev('entity.donkey.hurt', M('mobs_mc_donkey_hurt.ogg'))
ev('entity.donkey.death', M('mobs_mc_donkey_death.ogg'))
ev('entity.llama.ambient', M('mobs_mc_llama.ogg'))
ev('entity.llama.hurt', M('mobs_mc_llama.ogg', 1.0, 1.3))
ev('entity.llama.death', M('mobs_mc_llama.ogg', 1.0, 0.8))
ev('entity.rabbit.ambient', M('mobs_mc_rabbit_random.*'))
ev('entity.rabbit.hurt', M('mobs_mc_rabbit_hurt.*'))
ev('entity.rabbit.death', M('mobs_mc_rabbit_death.*'))
ev('entity.rabbit.attack', M('mobs_mc_rabbit_attack.*'))
ev('entity.bat.ambient', M('mobs_mc_bat_idle.ogg', 0.6))
ev('entity.bat.hurt', M('mobs_mc_bat_hurt.*'))
ev('entity.bat.death', M('mobs_mc_bat_death.ogg'))
ev('entity.bat.takeoff', M('mobs_mc_bat_idle.ogg', 0.4, 1.2))
ev('entity.squid.hurt', M('mobs_mc_squid_hurt.*'))
ev('entity.squid.death', M('mobs_mc_squid_death.*'))
ev('entity.squid.squirt', M('mobs_mc_squid_flop.*'))
ev('entity.cod.flop', M('mobs_mc_squid_flop.*'))
ev('entity.villager.ambient', M('mobs_mc_villager.*'))
ev('entity.villager.hurt', M('mobs_mc_villager_hurt.*'))
ev('entity.villager.death', M('mobs_mc_villager_hurt.*', 1.0, 0.8))
ev('entity.villager.yes', M('mobs_mc_villager_accept.*'))
ev('entity.villager.no', M('mobs_mc_villager.*', 1.0, 0.8))
ev('entity.villager.trade', M('mobs_mc_villager_trade.*'))
ev('entity.villager.celebrate', M('mobs_mc_villager_accept.*', 1.0, 1.2))
ev('entity.pillager.ambient', M('mobs_mc_pillager_grunt*'))
ev('entity.pillager.hurt', M('mobs_mc_pillager_ow*'))
ev('entity.pillager.death', M('mobs_mc_pillager_ow*', 1.0, 0.8))
ev('entity.iron_golem.hurt', M('mobs_mc_iron_golem_hurt.ogg'))
ev('entity.iron_golem.death', M('mobs_mc_iron_golem_hurt.ogg', 1.0, 0.7))
ev('entity.iron_golem.attack', F(MTG_D + 'default_dug_metal.*', 1.0, 0.6))
ev('entity.iron_golem.step', F(MTG_D + 'default_metal_footstep.*', 1.0, 0.6))
ev('entity.snow_golem.hurt', M('mobs_mc_snowman_hurt.*'))
ev('entity.snow_golem.death', M('mobs_mc_snowman_death.*'))
ev('entity.polar_bear.ambient', M('mobs_mc_bear_random.*'))
ev('entity.polar_bear.warning', M('mobs_mc_bear_growl.*'))
ev('entity.polar_bear.hurt', M('mobs_mc_bear_hurt.*'))
ev('entity.polar_bear.death', M('mobs_mc_bear_death.*'))
ev('entity.ghast.ambient', M('mobs_mc_ghast_hurt.*', 0.6, 0.7))
ev('entity.ghast.warn', M('mobs_mc_ghast_hurt.*', 1.0, 0.9))
ev('entity.ghast.shoot', M('mobs_mc_ghast_shot.*'))
ev('entity.ghast.hurt', M('mobs_mc_ghast_hurt.*'))
ev('entity.ghast.death', M('mobs_mc_ghast_dying.ogg'))
ev('entity.blaze.ambient', M('mobs_mc_blaze_breath.ogg'))
ev('entity.blaze.burn', M('mobs_mc_blaze_breath.ogg', 0.6))
ev('entity.blaze.hurt', M('mobs_mc_blaze_hurt.ogg'))
ev('entity.blaze.death', M('mobs_mc_blaze_died.ogg'))
ev('entity.blaze.shoot', M('mobs_fireball.ogg'))
ev('entity.guardian.ambient', M('mobs_mc_guardian_random.*'))
ev('entity.guardian.hurt', M('mobs_mc_guardian_hurt.*'))
ev('entity.guardian.death', M('mobs_mc_guardian_death.ogg'))
ev('entity.dolphin.ambient', M('mobs_mc_dolphin_whistle.*'))
ev('entity.dolphin.hurt', M('mobs_mc_dolphin_hurt.ogg'))
ev('entity.dolphin.death', M('mobs_mc_dolphin_dying.ogg'))
ev('entity.dolphin.attack', M('mobs_mc_dolphin_attack.*'))
ev('entity.silverfish.ambient', M('mobs_mc_silverfish_idle.ogg'))
ev('entity.silverfish.hurt', M('mobs_mc_silverfish_hurt.ogg'))
ev('entity.silverfish.death', M('mobs_mc_silverfish_death.ogg'))
ev('entity.vex.hurt', M('mobs_mc_vex_hurt.ogg'))
ev('entity.vex.death', M('mobs_mc_vex_death.ogg'))
ev('entity.wither.spawn', M('mobs_mc_wither_spawn.ogg'))
ev('entity.zombified_piglin.ambient', M('mobs_mc_zombiepig_random.*'))
ev('entity.zombified_piglin.angry', M('mobs_mc_zombiepig_war_cry.*'))
ev('entity.zombified_piglin.hurt', M('mobs_mc_zombiepig_hurt.*'))
ev('entity.zombified_piglin.death', M('mobs_mc_zombiepig_death.*'))
ev('entity.axolotl.idle_air', M('mobs_mc_axolotl[12].ogg'))
ev('entity.axolotl.idle_water', M('mobs_mc_axolotl[12].ogg'))
ev('entity.axolotl.hurt', M('mobs_mc_axolotl_hurt.ogg'))
ev('entity.generic.eat_animal', M('mobs_mc_animal_eat_generic.ogg'))

# Music: free tracks from Mineclonia's jukebox
TRACK = 'mcl:mods/ITEMS/mcl_jukebox/sounds/mcl_jukebox_track_%d.ogg'
ev('music.game', *[F(TRACK % n, 0.6, 1.0, True) for n in (3, 4, 5, 6)])
ev('music.creative', *[F(TRACK % n, 0.6, 1.0, True) for n in (4, 5, 7)])
ev('music.nether.nether_wastes', F(TRACK % 1, 0.6, 1.0, True))
ev('music.end', F(TRACK % 7, 0.6, 1.0, True))

# Events the pack has no own entry for: first rule that matches wins ($1, $2 ... from the regex)
FALLBACKS = [
    [r'^block\.(?:deepslate|deepslate_bricks|deepslate_tiles|polished_deepslate|tuff|tuff_bricks|polished_tuff|calcite|dripstone_block|pointed_dripstone|netherrack|nether_bricks|nether_ore|nether_gold_ore|basalt|bone_block|lodestone|ancient_debris|gilded_blackstone|packed_mud|mud_bricks|decorated_pot|decorated_pot_cracked|sculk|sculk_sensor|sculk_catalyst|sculk_shrieker|sculk_vein|frogspawn|froglight|candle|chiseled_bookshelf|resin|resin_bricks|vault|trial_spawner|spawner|heavy_core|stone)\.(break|step|place|hit|fall)$', r'block.stone.$1'],
    [r'^block\.(?:[a-z_]*wood[a-z_]*|ladder|scaffolding|bamboo|cherry_wood|nether_wood|stem|hanging_sign|nether_wood_hanging_sign|bamboo_wood_hanging_sign|cherry_wood_hanging_sign|lectern|creaking_heart|bookshelf)\.(break|step|place|hit|fall)$', r'block.wood.$1'],
    [r'^block\.(?:[a-z_]*(?:grass|crop|vine|vines|roots|leaves|bush|azalea|dripleaf|blossom|moss|moss_carpet|petals|lily_pad|fungus|sprouts|wart_block|nether_wart|sapling|shroomlight|weeping_vines|twisting_vines|hanging_moss|leaf_litter|cactus_flower|firefly_bush|eyeblossom|kelp|seagrass|cave_vines|glow_lichen|sculk_vein)[a-z_]*)\.(break|step|place|hit|fall)$', r'block.grass.$1'],
    [r'^block\.(?:sand|soul_sand|suspicious_sand)\.(break|step|place|hit|fall)$', r'block.sand.$1'],
    [r'^block\.(?:gravel|rooted_dirt|soul_soil|suspicious_gravel|muddy_mangrove_roots|powder_snow|suspicious)\.(break|step|place|hit|fall)$', r'block.gravel.$1'],
    [r'^block\.(?:snow|powder_snow)\.(break|step|place|hit|fall)$', r'block.snow.$1'],
    [r'^block\.(?:wool|[a-z_]*carpet)\.(break|step|place|hit|fall)$', r'block.wool.$1'],
    [r'^block\.(?:glass|amethyst_block|amethyst_cluster|large_amethyst_bud|medium_amethyst_bud|small_amethyst_bud|beacon)\.(break|step|place|hit|fall)$', r'block.glass.$1'],
    [r'^block\.(?:[a-z_]*(?:metal|anvil|chain|copper|lantern|netherite|iron|grate|bulb|cobweb)[a-z_]*)\.(break|step|place|hit|fall)$', r'block.metal.$1'],
    [r'^block\.(?:honey_block|slime_block)\.(break|step|place|hit|fall)$', r'block.slime_block.$1'],
    [r'^block\.(?:mud|mud_bricks)\.(break|step|place|hit|fall)$', r'block.mud.$1'],
    [r'^block\.[a-z_]+\.(break|step|place|hit|fall)$', r'block.stone.$1'],
    [r'^block\.(?:copper|iron)[a-z_]*_door\.(open|close)$', r'block.iron_door.$1'],
    [r'^block\.[a-z_]+_door\.(open|close)$', r'block.wooden_door.$1'],
    [r'^block\.(?:copper|iron)[a-z_]*_trapdoor\.(open|close)$', r'block.iron_trapdoor.$1'],
    [r'^block\.[a-z_]+_trapdoor\.(open|close)$', r'block.wooden_trapdoor.$1'],
    [r'^block\.[a-z_]+_fence_gate\.(open|close)$', r'block.fence_gate.$1'],
    [r'^block\.(?:[a-z_]+_)?wood(?:en)?_button\.(click_on|click_off)$', r'block.wooden_button.$1'],
    [r'^block\.[a-z_]+_button\.(click_on|click_off)$', r'block.stone_button.$1'],
    [r'^block\.(?:[a-z_]+_)?wood(?:en)?_pressure_plate\.(click_on|click_off)$', r'block.wooden_pressure_plate.$1'],
    [r'^block\.[a-z_]+_pressure_plate\.(click_on|click_off)$', r'block.stone_pressure_plate.$1'],
    [r'^block\.(?:copper_chest|[a-z_]*copper_chest|trapped_chest)\.(open|close)$', r'block.chest.$1'],
    [r'^block\.(?:soul_)?campfire\.crackle$', r'block.campfire.crackle'],
    [r'^block\.(?:blast_furnace|smoker)\.(?:fire_crackle|smoke)$', r'block.furnace.fire_crackle'],
    [r'^block\.water\.ambient$', r'block.water.ambient'],
    [r'^entity\.(?:husk|drowned|zombie_villager|giant|zombie_horse|zombie_nautilus)\.(ambient|hurt|death)$', r'entity.zombie.$1'],
    [r'^entity\.(?:stray|wither_skeleton|bogged|skeleton_horse|parched)\.(ambient|hurt|death)$', r'entity.skeleton.$1'],
    [r'^entity\.(?:stray|bogged|parched)\.shoot$', r'entity.skeleton.shoot'],
    [r'^entity\.cave_spider\.(ambient|hurt|death)$', r'entity.spider.$1'],
    [r'^entity\.mooshroom\.(ambient|hurt|death|milk)$', r'entity.cow.$1'],
    [r'^entity\.(?:mule|camel)\.(ambient|hurt|death)$', r'entity.donkey.$1'],
    [r'^entity\.trader_llama\.(ambient|hurt|death)$', r'entity.llama.$1'],
    [r'^entity\.(?:wandering_trader)\.(ambient|hurt|death|yes|no|trade)$', r'entity.villager.$1'],
    [r'^entity\.(?:vindicator|evoker|illusioner|witch|ravager)\.(ambient|hurt|death)$', r'entity.pillager.$1'],
    [r'^entity\.(?:glow_squid)\.(hurt|death|squirt)$', r'entity.squid.$1'],
    [r'^entity\.(?:salmon|tropical_fish|pufferfish|tadpole)\.flop$', r'entity.cod.flop'],
    [r'^entity\.(?:elder_guardian)\.(ambient|hurt|death)$', r'entity.guardian.$1'],
    [r'^entity\.(?:panda|hoglin|zoglin|sniffer)\.(ambient|hurt|death)$', r'entity.polar_bear.$1'],
    [r'^entity\.(?:piglin|piglin_brute)\.(ambient|hurt|death|angry)$', r'entity.zombified_piglin.$1'],
    [r'^entity\.(?:snow_golem)\.shoot$', r'entity.snowball.throw'],
    [r'^entity\.(?:witch|player)\.throw$', r'entity.snowball.throw'],
    [r'^entity\.[a-z_]+\.step$', r'block.stone.step'],
    [r'^entity\.[a-z_]+\.(?:hurt|hurt_drown|hurt_on_fire|hurt_freeze|hurt_sweet_berry_bush)$', r'entity.generic.hurt'],
    [r'^entity\.[a-z_]+\.death$', r'entity.generic.death'],
    [r'^entity\.[a-z_]+\.eat$', r'entity.generic.eat_animal'],
    [r'^item\.armor\.equip_[a-z_]+$', r'item.armor.equip_generic'],
    [r'^music\.overworld\.[a-z_]+$', r'music.game'],
    [r'^music\.nether\.[a-z_]+$', r'music.nether.nether_wastes'],
    [r'^music\.(?:under_water|menu)$', r'music.game'],
]


# ------------------------------------------------------------------ pieces cut out of long recordings

def cut_pieces(tmp):
    """Rain: 1.2 s pieces of the 9 s recording; lava pop: short bits of the lava loop."""
    out = {}
    rain = os.path.join(MCL, 'mods/ENVIRONMENT/mcl_weather/sounds/weather_rain.ogg')
    for i in range(6):
        p = os.path.join(tmp, f'rain.{i + 1}.ogg')
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-ss', str(0.3 + i * 1.4), '-t', '1.2', '-i', rain,
                        '-af', 'afade=t=in:d=0.15,afade=t=out:st=1.0:d=0.2', '-c:a', 'libvorbis', '-q:a', '3', p], check=True)
        out[p] = ('mcl:mods/ENVIRONMENT/mcl_weather/sounds/weather_rain.ogg', f'rain.{i + 1}')
    lava = os.path.join(MTG, 'mods/env_sounds/sounds/env_sounds_lava.1.ogg')
    for i in range(3):
        p = os.path.join(tmp, f'lava_pop.{i + 1}.ogg')
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-ss', str(1.0 + i * 2.1), '-t', '0.5', '-i', lava,
                        '-af', 'afade=t=in:d=0.03,afade=t=out:st=0.35:d=0.15', '-c:a', 'libvorbis', '-q:a', '3', p], check=True)
        out[p] = ('mtg:mods/env_sounds/sounds/env_sounds_lava.1.ogg', f'lava_pop.{i + 1}')
    return out


def main():
    tmp = tempfile.mkdtemp()
    SOURCES['cut'] = tmp
    cuts = cut_pieces(tmp)
    # Events of the cut pieces (they exist only now)
    ev('block.lava.pop', F('cut:lava_pop.*', 0.8))
    ev('weather.rain', F('cut:rain.*', 1.0))
    ev('weather.rain.above', F('cut:rain.*', 1.0, 0.7))

    files = {}     # source -> name in the zip
    credits = {}   # name -> (who, license, url)
    sounds = {}
    for event, entries in sorted(EVENTS.items()):
        out = []
        for src, vol, pitch, stream in entries:
            if src.startswith('cut:'):
                path = os.path.join(tmp, src[4:])
                original, short = cuts[path]
                who, lic, url = credit_of(original)
                name = 'wc/' + short
                credits[name] = (who + ', cut by WebCraft', lic, url)
            else:
                c = credit_of(src)
                if c is None:
                    raise SystemExit('no license known for ' + src)
                prefix, rel = src.split(':', 1)
                path = os.path.join(SOURCES[prefix], rel)
                name = prefix + '/' + os.path.basename(rel)[:-4]
                credits[name] = c
            files[path] = name
            entry = {'name': name}
            if abs(vol - 1) > 1e-6:
                entry['volume'] = round(vol, 3)
            if abs(pitch - 1) > 1e-6:
                entry['pitch'] = round(pitch, 3)
            if stream:
                entry['stream'] = True
            out.append(entry)
        sounds[event] = {'sounds': out}

    lines = ['# Sounds in WebCraft', '',
             'WebCraft does not use any sound of Minecraft. Its built-in sounds are free sounds collected by the',
             '[Mineclonia](https://codeberg.org/mineclonia/mineclonia) and [Minetest Game](https://github.com/luanti-org/minetest_game)',
             'projects. Each file keeps its own license. Volumes and pitches are changed when they are played;',
             'files marked "cut" are pieces of a longer recording.', '',
             'Licenses: [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/),',
             '[CC BY 3.0](https://creativecommons.org/licenses/by/3.0/), [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/),',
             '[CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/), [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/),',
             '[MIT](https://opensource.org/licenses/MIT), [WTFPL](http://www.wtfpl.net/txt/copying/).', '',
             '| File | Author | License | Source |', '|---|---|---|---|']
    for name in sorted(credits):
        who, lic, url = credits[name]
        lines.append(f'| `{name}.ogg` | {who} | {lic} | {url} |')
    license_md = '\n'.join(lines) + '\n'

    with zipfile.ZipFile(OUT, 'w', zipfile.ZIP_STORED) as z:
        z.writestr('sounds.json', json.dumps(sounds, indent=1, sort_keys=True))
        z.writestr('fallbacks.json', json.dumps(FALLBACKS, indent=1))
        z.writestr('LICENSE-sounds.md', license_md)
        for path, name in sorted(files.items(), key=lambda x: x[1]):
            z.write(path, 'sounds/' + name + '.ogg')
    with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'LICENSE-sounds.md'), 'w') as f:
        f.write(license_md)
    print(f'{OUT}: {len(sounds)} events, {len(files)} files, {os.path.getsize(OUT) // 1024} KB')


if __name__ == '__main__':
    main()
