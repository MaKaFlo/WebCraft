// Which texture files a block can use. Lets WebCraft read normal Minecraft resource packs directly:
// renamed blocks, crops, and slabs/stairs/walls that use the texture of their material.

const ALIAS = {
  short_grass: 'grass', dirt_path: 'grass_path', water: 'water_still', lava: 'lava_still', iron_chain: 'chain',
  fire: 'fire_0', soul_fire: 'soul_fire_0', magma_block: 'magma', carrots: 'carrots_stage3', potatoes: 'potatoes_stage3',
  beetroots: 'beetroots_stage3', wheat: 'wheat_stage7', nether_wart: 'nether_wart_stage2', cocoa: 'cocoa_stage2',
  redstone_wire: 'redstone_dust_dot', smooth_quartz: 'quartz_block_bottom', smooth_sandstone: 'sandstone_top',
  smooth_red_sandstone: 'red_sandstone_top', frosted_ice: 'frosted_ice_0', bamboo: 'bamboo_stalk', campfire: 'campfire_log_lit',
  soul_campfire: 'soul_campfire_log_lit', chest: 'oak_planks', trapped_chest: 'oak_planks', ender_chest: 'obsidian',
  smooth_basalt: 'basalt_top', sweet_berry_bush: 'sweet_berry_bush_stage3', torchflower_crop: 'torchflower_crop_stage1',
  pitcher_crop: 'pitcher_crop_top_stage_4', bubble_column: 'water_still', water_cauldron: 'cauldron_side',
  lava_cauldron: 'cauldron_side', powder_snow_cauldron: 'cauldron_side',
};
const SUFFIXES = ['_wall_hanging_sign', '_hanging_sign', '_wall_sign', '_sign', '_fence_gate', '_pressure_plate', '_button',
  '_stairs', '_slab', '_wall', '_fence', '_carpet', '_pane', '_shelf'];

/** Base names to look for, best first (without _top/_side/_bottom). */
export function textureCandidates(name) {
  const out = [name];
  const add = (n) => { if (n && !out.includes(n)) out.push(n); };
  if (ALIAS[name]) add(ALIAS[name]);
  if (name.endsWith('_door')) add(name + '_bottom');
  // Wall variants: wall_torch -> torch, oak_wall_sign -> oak_sign
  add(name.replace(/^wall_/, '').replace(/_wall_(torch|sign|banner|fan|head|skull|hanging_sign)$/, '_$1'));
  let n = name;
  for (const prefix of ['waxed_', 'infested_', 'potted_']) {
    if (n.startsWith(prefix)) { n = n.slice(prefix.length); add(n); add(ALIAS[n]); }
  }
  if (/_wood$|_hyphae$/.test(n)) add(n.replace(/_wood$/, '_log').replace(/_hyphae$/, '_stem'));
  for (const suf of SUFFIXES) {
    if (!n.endsWith(suf)) continue;
    const b = n.slice(0, -suf.length);
    if (suf === '_carpet') { add(b + '_wool'); add(b + '_block'); }
    for (const c of [b, b + 's', b + '_planks', b + '_block', b.replace('brick', 'bricks'), b.replace('tile', 'tiles'), ALIAS[b]]) add(c);
    break;
  }
  if (n === 'snow_block') add('snow');
  return out;
}

// Grass, leaves, water ... are gray in Minecraft packs and get colored by the game
export const TINTED = /^(grass_block|short_grass|tall_grass|fern|large_fern|sugar_cane|vine|lily_pad|water|bubble_column|redstone_wire|\w+_leaves|attached_\w+_stem|\w+_stem)$/;
