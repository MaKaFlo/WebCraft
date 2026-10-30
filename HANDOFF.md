# HANDOFF

Hand-over between Claude sessions. Read this first, keep it current (see CLAUDE.md, "Session handoff").

_Last update: 2026-10-30, version 0.36.0 (main). Tag pushes are refused by this session's git proxy: the owner makes tags/releases (v0.23.0 not yet tagged)._

## Current state

- Paper plugin, Fabric mod and browser page build and work (Paper 26.3 / Fabric 26.3).
- Built-in textures: **Faithful 32x** (blocks, items, chests, armor, mobs, GUI buttons, pixel font), PPCE for cow,
  mooshroom, pig, rabbit, magma cube (newer layout in Faithful). License: `LICENSE-Faithful.txt`, credit in README.
- Every mob has a textured model now (the block figures in `mobs.js` are only a fallback for packs without pictures).
- License check (2026-10-30): Faithful license point 4 forbids using it as a substitute for Minecraft's graphics where
  the originals aren't allowed (browser players may not own Minecraft). Owner keeps Faithful and asks Faithful for
  permission (English request text written). If they say no: built-in Pixel Perfection CE, Faithful as server pack.
  Also open: PPCE credit/license file missing inside texturen.zip, repo LICENSE should say assets have own licenses.
- 0.36.0 (friend's wish): creative item list puts the item on the mouse (server-side carried, `creative` slot -1 →
  `WcFakePlayer.creativeCarry`, only with infinite materials), then any slot / drag / right click like normal items;
  shift = full stack, clicking the list with another item throws it away. Tested on Paper; Fabric compiled only.
- 0.35.2 (friend's report): drag the carried stack over slots with a button held (right = one each, left = split
  evenly), like Minecraft (`inventory.js dragOver/endDrag` → `click` mode `drag` = `QUICK_CRAFT`). Tested on Paper with
  real mouse events (2x2 grid, chest-less); Fabric compiled only.
- 0.35.1: kick "Invalid move player packet received" when hitting/digging/placing while moving (0.35.0's flushMove sent
  a second position in one tick; now at most one). Checked: old jar kicked in the spam test, new one not. Open: "lag when
  jumping up blocks while standing at them" not reproduced, asked the owner what exactly happens.
- 0.35.0 (friend's reports): off hand works (blocks, torches, food, rockets), off hand slot no longer over hotbar slot 1,
  water gaps between chunks (edge chunks meshed again when the neighbour arrives), building up no longer loses blocks
  (position before actions), less lag (no re-mesh on confirmations), smooth sneaking. Tested headless/with a raw
  WebSocket bot (off hand, 4 blocks built up). Water gap fix not seen on a real GPU yet.
- 0.34.0 (owner's wish: only the jar, everything in game; the server keeps html 0.33.1): `/webcraft account
  create|password|reset|link|unlink|list`. Tested on Paper via console (all subcommands, login with a random password).
  Fabric compiled only.
- 0.33.2: admin code instead of the long token (owner could not copy it in game): 8 characters, "🔑 Admin" button on the
  login page, `/webcraft admin` in WebCraft opens the page directly. Tested headless.
- 0.33.1: elytra felt slow: movement now runs on real time (slow frames were slow motion; measured 31-35 b/s with
  rockets at 5-8 fps, like Minecraft's formula), spectators fly through blocks, water/section seams closed (faces reach
  0.002 over the section edge; checked with a red background).
- 0.33.0 (friend's report): inventory icons in 3D with the real shape (`icons3d.js`), cauldron model (hollow, water/lava/
  powder snow; was a full box with see-through sides), bed model from Faithful's per-side pictures, fence and fence gate
  models. Tested headless (world + inventory screenshots).
- 0.32.0: trident and spear have their own right click animations (first person and for others), enchanting table shows
  the German enchantment name, level and lapis cost (also as tooltip), item tooltips list the enchantments. Tested headless.
- 0.31.1: Q drop made complete: instant prediction in the hotbar, holding Q repeats, Shift+Q stack, inventory resent
  after drop and swap. Tested against the server inventory (Q, held, sword, Shift+Q, last item, F swap, Q in the
  inventory screen, throwing out of the screen): browser and server always the same.
- 0.31.0: elytra (flight physics like Minecraft, rockets, gliding pose and wings for others and in F5) and the Q-drop
  ghost item fix (inventory sent again after `drop`). Tested headless on Paper (glide 14-20 b/s, rocket ~32 b/s, server
  confirms, model screenshot). Not done: elytra wind sound, crash into walls damage, roll when turning. Fabric compiled only.
- 0.30.0 (owner's wish): admin page `/webcraft admin` (OPs only) → link with token, page makes accounts (name +
  password), changes passwords, kicks, links accounts with Minecraft players that were on the server; config
  `self-register`, `web-url`. Tested on Paper headless (create, link, login as the new account, password change, bad token).
  Fabric compiled only. Account names in the list are lower case (passwords.json keys).
- 0.29.0 (owner's wish): passwords for WebCraft accounts (`WcAccounts`): first login sets one (typed twice), then name +
  password; admin reset `/webcraft password <name>`. Tested on Paper headless (register, mismatch, wrong, right, reset).
  Fabric compiled only. `tools/test/bot.mjs` sends `pw` (env `WC_PW`, default `bot-test`).
- 0.28.1: login page without the "Spielart" choice (owner: buggy, single player out for now; the class `.choice` clashed
  with the stonecutter grid CSS). Server side of single player is still there (`hello` mode single), just no button.
  Texture pack button styled like the form.
- 0.28.0 (owner's wish): account linking `/webcraft link` (Java: code, WebCraft: `/webcraft link <code>`, both `link delete`),
  linked WebCraft login plays as the Java account (`WcLinks`). Tested on Paper headless with a hand-written `links.json`
  (login as the linked account, unlink + automatic relogin, wrong code message). Not tested: the Java side (no 26.3 client
  here: code message, click to copy, kick of the online Java player, tab completion), Fabric (compiled only).
- Answered: WebCraft needs only a TCP port (WebSocket), no UDP.
- 0.27.0 (friend's report "redstone ist ganz verbugt", signs, end rods, lanterns): state models in `blockmodels.js` (server
  sends state properties `p`): pistons in all 6 directions + extended base/head, repeater (delay, locked), comparator,
  lever (floor/wall/ceiling), redstone wire (connections, up the wall, color by power), torches as sticks, wall torches
  leaning, observer/dispenser/dropper facing up/down, hopper, lamp on, daylight detector inverted, rails (curves,
  slopes), end rod, lightning rod, lantern (hanging). Signs: board + post shape, text shown (`signs.js`, `WcSigns`) and
  writable (`sign_edit` → editor → `sign`). Tested headless on Paper (screenshots of every row, sign placed and written).
  Fabric compiled, not run. Not checked: comparator front torch look, piston side picture direction on every facing,
  moving pistons are invisible for the 2 ticks of the move (no block entity animation), hanging sign text placement.
- 0.26.0: motion blur, waypoints, item physics, own nametag (F5), boss bars (server sends `boss`). Tested headless.
- 0.25.0: client mods like PvP clients (`mods.js`, 29 switches). Server sends armor (`inv.arm`) and effects (`stats.eff`).
  Tested headless (HUD, menu).
- 0.24.1 (owner's wish): single player survival = normal world, others hidden for him; creative = own world with
  the server's seed. Tested headless. German names don't come any more since `mojang-assets` is off by default:
  asked the owner how to solve it (switch on, or free German names).
- 0.24.0: single player ("Einzelspieler" in the login form, own world on the Paper server, `WcSingle`). Tested headless:
  own world, creative, nether portal into the own nether, saved position, private chat, unload. Not tested: end portal,
  respawn, many single worlds at once (memory). Fabric: refused with a message.
- 0.23.2: drawn bow/crossbow shows the arrow (`bow_pulling_0-2`, `crossbow_pulling_0-2` added to texturen.zip and to
  `make_pack.py EXTRA_ITEMS`, `hand.js drawnPicture`); snowballs, eggs, pearls, splash potions ... are thrown with an arm
  swing (`THROWN`, also sent as `swing` for the others). Other players' drawn bows are not shown yet.
- 0.23.1: eating/drinking stops after one item, the next bite needs a new right click (`interaction.stopUse`, `useLocked`).
- 0.23.0 (tested headless): texture pack page also on the login screen ("🎨 Texturpakete"), upload of a zip
  or a folder (`pack.importFiles`), mod files (.jar with .class / fabric.mod.json) get a clear message. Owner's next
  wish: WebCraft's own client mods with switches before the game (freecam, zoom, fullbright, minimap ...); asked which
  ones and whether the server may forbid cheat-like ones (config). No upload of foreign code (security).
- 0.22.3: 3D glasses on phones: a tap anywhere opens the game menu (touch buttons are hidden there, you were stuck).
- 0.22.2: Modrinth button shows progress and "Geladen ✓" (remembered in localStorage `wc.modrinthLoaded`). Faithful 64x
  tested: 2131 textures in 26 s, shrunk to 32 px like everything (atlas tiles are 32 px).
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
