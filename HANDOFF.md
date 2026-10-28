# HANDOFF

Hand-over between Claude sessions. Read this first, keep it current (see CLAUDE.md, "Session handoff").

_Last update: 2026-10-28, version 0.22.1 (main)._

## Current state

- Paper plugin, Fabric mod and browser page build and work (Paper 26.3 / Fabric 26.3).
- Built-in textures: **Faithful 32x** (blocks, items, chests, armor, mobs, GUI buttons, pixel font), PPCE for cow,
  mooshroom, pig, rabbit, magma cube (newer layout in Faithful). License: `LICENSE-Faithful.txt`, credit in README.
- Every mob has a textured model now (the block figures in `mobs.js` are only a fallback for packs without pictures).
- 0.22.1: game menu scrolls on phones (options were cut off in landscape). Tested with an emulated phone only.
- 0.22.0: texture packs from Modrinth in the game menu ("Texturpakete ...", `modrinth.js`). The owner asked for
  mods from CurseForge and Modrinth: Java mods can't run in the browser; CurseForge needs an API key (could go via
  the server with a key in the config, if wanted).
- 0.21.0: the owner wants everything legal: built-in **free sounds** (Mineclonia + Minetest Game, `tools/make_sounds.py`,
  `LICENSE-sounds.md`) instead of Mojang's; Mojang sounds and the German names only with `mojang-assets: true`
  (default off). Tested on the Paper test server headless (events, fallbacks, files decode). Not heard by a human yet:
  volumes of the free files may need tuning (`make_sounds.py`). Sources were cloned to `/home/user/free/`.
- 0.20.0: real Minecraft sounds and music (`WcAssets` loads Mojang's assets once, `WcSounds`, browser `sounds.js`,
  setting "Musik"). Tested on the Paper test server headless (mobs, attack, level up, pickup, door, chest, steps,
  fall, hurt arrive and decode). Fabric side compiled, not run. Not yet heard by a human: check volumes and feel.
- 0.19.0: German names of blocks, items and mobs (`WcLang`: server loads de_de.json from Mojang once; option
  "Namen: Deutsch / English", default German). The menu texts were German already. Fabric side compiled, not run.
- Done in session 2026-10-28, part 3 (0.17.1 → 0.18.0): options for hitboxes and chunk borders (also F3+B/G),
  F5 third person (behind/front, own skin; server sends the own skin in `welcome`, also used for the first-person arm),
  Tag/Nacht top left, zombie/husk had only one leg and one arm (fixed: mirrored left limbs).
- Done in session 2026-10-28, part 2 (0.16.0 → 0.17.0): phones and controllers
  - Touch controls (`touch.js`): joystick, buttons, drag to look, hotbar taps, close button, fullscreen + landscape.
  - Optional gyro look (setting "Gyro-Steuerung", off by default; needs https, the owner's server has it).
  - Game controllers (`gamepad.js`, console layout, also menu navigation), 3D glasses mode (`vr.js`, side by side,
    gyro head tracking with tilt, own HUD, eye distance setting; Back on the pad toggles it).
  - 0.17.1: lens correction for the 3D glasses (setting "Linsenkorrektur", default 60 %).
  - Tested headless only (emulated touch, fake gamepad, synthetic orientation events). Needs a real phone test.
- Done in session 2026-10-28 (0.15.1 → 0.16.0):
  - Sky light (`world.js heights()/floodSky()`, mobs and hand via `brightnessAt()`), caves/rooms are dark.
  - Fixed bright gaps at block edges (atlas UV inset was too small, alphaTest cut holes).
  - Textured models: bat, frog, axolotl, goat, camel (+ camel husk), armadillo, sniffer, warden, ravager, breeze
    (with wind), tropical fish (pattern + colors: plugin/mod send `var`, `col`, `col2`), ender dragon.
    `skins.js` parts can have a `parent` now.
  - Game menu in Minecraft's pixel font (`tools/make_font.py` → `mcfont.ttf`, umlauts/ß drawn by hand).
  - Empty hand: textured arm (pack's Steve) at Minecraft's exact first-person place.
  - Silverfish checked: the model is right, the shaggy look is Faithful's picture (sparse hair pixels in the fur layer).

## Untested / to check

- 0.17.0 on a real phone: touch layout size, gyro direction/feel, controller over Bluetooth, 3D glasses (check comfort,
  eye distance, lens correction strength, frame rate). Inventory with a controller: only B/Y close
  it, slots can't be picked with the pad yet (touch works).

- 0.15.1: Esc in a chest should only close it (mouse is caught again after the key-up). Needs a real browser (owner).
- 0.16.0 not yet tried on the real server. Sky light: check performance on weaker PCs (meshing ~10-20 % slower).
- Fabric: tropical fish colors compiled but not run on the Fabric test server.
- New mob models were checked in one screenshot grid only; animations (legs) of the new quadrupeds not looked at.

## Open wishes / next steps

- Sounds: maybe cave ambience (`ambient.cave` mood), under-water music, biome music (`music.overworld.*`), jukebox
  discs, item use sounds the server leaves to the client (bucket fill, flint and steel, hoe till ...).
- Ideas offered to the owner: own skin upload. Possible: inventory navigation with the controller.
- Warden glow layers, baby pictures of the new mobs (`goat_baby`, `axolotl_*_baby`, `camel_baby`, `snifflet` ...).
- Cow, pig, rabbit, magma cube could use new models for the Faithful pictures.
- The owner cares about cost: keep sessions lean (few screenshots, batch changes, one build per batch).

## Repository

- GitHub: `https://github.com/MaKaFlo/WebCraft` (old URL `https://github.com/MaKaFlo/webcraft` still redirects;
  the local `origin` still has the old URL, changing it was blocked by a permission rule).

## Local paths (session container, may be gone)

- Test servers: `/home/user/srv` (Paper, scripts `*.cjs`, e.g. `mobgrid.cjs`, `skylight.cjs`, `emptyhand.cjs`),
  `/home/user/fsrv` (Fabric). JDK 25: `/home/user/tools/jdk-25.0.5+8` (Maven needs `JAVA_HOME` set to it).
- Texture sources: Faithful unpacked in `/home/user/faithful/x`, PPCE in `/tmp/ppce`. If gone, download again
  (works from the session container):
  `curl -sSfL -o faithful.zip "https://database.faithfulpack.net/packs/32x-Java/September%202026/Faithful%2032x%20-%2026.3.zip"`
  (Faithful 32x for 26.3, ~13 MB, 5300 files); PPCE: github.com/Athemis/PixelPerfectionCE.
- `tools/make_font.py` needs `pip install fonttools`.
