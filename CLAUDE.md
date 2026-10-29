# CLAUDE.md

Guide for continuing work on **WebCraft**: a browser block game whose players join a Paper 26.3 or
Fabric 26.3 Minecraft server as real server players. Read README.md for the user-facing side.

**Start of every session: read [HANDOFF.md](HANDOFF.md) first.** It holds the current state, what was done last,
open problems and the next steps.

## Session handoff (HANDOFF.md)

- `HANDOFF.md` in the repo root is the hand-over between sessions. Keep it current and **commit + push it**.
- Update it (and commit + push) after every larger finished task, and also during long sessions: a session can end
  without warning, so the file in the repo must never be far behind.
- Contents: current version and state, what was done in the last session(s), things that are known to be broken or
  untested, open wishes of the owner, next steps, useful local paths (test servers, texture pack sources).
  Keep it short; details belong in this file or the README.
- **Ending a session** (when the owner asks to end it) always means: update `HANDOFF.md`, commit and push
  everything, stop test servers.

## History

The project was called **gg** until 0.6.5 (plugin "GgBridge", name prefix `gg_`, classes `Gg*`).
WebCraft takes over `plugins/GgBridge/` once on first start (`WcPlugin.takeOverOldFolder()`), so an existing
server keeps the prefix `gg_` and the players keep their accounts. The browser moves `gg.*` localStorage keys
to `wc.*`; the IndexedDB for own textures is still called `gg`.

## Working agreements

- The project owner (Micha) writes in German. Answer briefly in German, ask before laying out many options.
- **Code and code comments in English.** UI texts in the game are German.
- No long dashes (em dash) in German texts. Emojis are fine.
- **No internal hostnames, domains or IPs in the repo.** Addresses only come from environment
  variables (docker compose `.env`) or from what the user types into the login form.
- Always deliver results as files (jar, html, zip), not only as code in the chat.
- Stop test servers after testing.
- Feedback mostly comes from a friend testing on the real server; reports are short and informal
  ("Schafe sind weiß", "man buggt fest"). Reproduce on a local test server before fixing.

## Modules

| Path | What |
|---|---|
| `pom.xml` | Parent (packaging pom), version for everything |
| `webcraft-common/` | Sources shared by plugin and mod (no Bukkit, no Fabric): `BlockPalette`, `ChunkEncoder`, `WcScoreboard`, `WcTextures`, `WcSession`, `WcServer`, `WcHost`, `WcMenus`, `WcParticles`, `WcSkins` |
| `webcraft-plugin/` | Paper plugin "WebCraft" (Java 25, Mojang mappings) |
| `webcraft-fabric/` | Fabric server mod "webcraft" (Gradle + Loom, Minecraft 26.3 is unobfuscated, so the same Mojang names) |
| `webcraft-web/` | Browser client (plain ES modules, three.js r186, bundled by esbuild into ONE html file) + nginx Docker image |
| `tools/` | `fetch-paper.sh`, texture pack builder `make_pack.py` (+ `items.json`), pixel font builder `make_font.py`, `test/` helpers |

### Build

```bash
tools/fetch-paper.sh            # once: downloads + unpacks Paper 26.3 into .paper/ (gitignored)
mvn package                     # webcraft-plugin/target/webcraft-<v>.jar, webcraft-web/target/webcraft.html
mvn package -Dpaper.dir=/x      # use another Paper 26.3 folder (must contain versions/ and libraries/)
cd webcraft-web && npm ci && npm run build   # web only -> webcraft-web/dist/index.html
```

- The plugin cannot be compiled by the normal maven-compiler step: it needs every jar of the Paper
  server (`versions/**`, `libraries/**`) on the classpath. `webcraft-plugin/pom.xml` skips the default
  compile (`maven.main.skip`) and runs `javac` through **maven-antrun** with filesets of `${paper.dir}`.
- Java-WebSocket 1.6.0 is shaded and relocated to `de.p300.webcraft.lib.websocket` (shade plugin with ASM 9.9
  for Java 25 class files). slf4j is excluded (Paper has it).
- Jar manifest has `paperweight-mappings-namespace: mojang` so Paper does not remap the plugin.
- `plugin.yml` version is filtered from `${project.version}`.
- webcraft-web: frontend-maven-plugin downloads Node into `webcraft-web/target/`, runs `npm ci` and `npm run build`
  (`build.mjs`: esbuild, `texturen.zip` is inlined as base64 via loader `.zip: base64`).
- Version bump: `mvn versions:set -DnewVersion=x.y.z` (changes all three poms), plus README header and
  `version=` in `webcraft-fabric/gradle.properties`.
- The plugin's antrun javac compiles `../webcraft-common/src/main/java` and `src/main/java` together; the
  Fabric build adds the same folder as a source dir. `WcSession.fake` is typed `WcFakePlayer`, which each side
  defines itself (same package, different class).
- Fabric: `cd webcraft-fabric && ./gradlew build` -> `build/libs/webcraft-fabric-<v>.jar` (Java-WebSocket
  inside via `include`, jar-in-jar). Needs Fabric API on the server.

### CI (`.github/workflows/build.yml`)

- Push to `main` / pull requests: JDK 25, `tools/fetch-paper.sh` (cached in `.paper`), `mvn package`,
  then the Fabric mod with `./gradlew build -Pversion=<pom version>`; plugin jar, Fabric jar and
  `webcraft.html` as workflow artifact `webcraft`.
- Tag `vX.Y.Z`: same build with `mvn versions:set -DnewVersion=X.Y.Z`, then a GitHub release with both files.
  Release = `git tag v0.7.1 && git push origin v0.7.1`.

### Docker (webcraft-web)

`webcraft-web/Dockerfile` is multi-stage (node:22-alpine builds, nginx:1.27-alpine serves).
`nginx/default.conf.template` is rendered by the nginx image's envsubst at start:

- `WC_BACKEND` (host:port of the plugin WebSocket): `location = /ws` proxies to it (upgrade headers,
  1 h timeouts). This also gives `wss://` when nginx sits behind HTTPS.
- `WC_NAME_PREFIX`: only shown in the login form (the plugin's `name-prefix`), also in `/config.js`.
- `WC_SERVER`: served as `/config.js` → `window.WC_CONFIG = { server: "..." }`.
- Client (`main.js`, `defaultServer()`): login field = `?server=` param > localStorage `wc.server` >
  `WC_CONFIG.server` (a value starting with `/` is made absolute) > same host `/ws` when served over
  http(s) > empty when opened as a file.
- `index.html` loads `config.js` before the bundle; when missing (file://) the tag removes itself.
- The plugin sees nginx as the remote address; Origin is passed through (`allowed-origins` in config.yml).

## Plugin architecture (`webcraft-plugin/src/main/java/de/p300/webcraft`)

| Class | Role |
|---|---|
| `WcPlugin` | Main class. Config, `/webcraft` command, message dispatch (`switch` on `t`), per-tick work: chunk queue, entity list, stats, inventory, menus, scoreboard/tab, animations, block changes |
| `WcServer` | Java-WebSocket server (own threads). Origin check, hands messages to the main thread. Text messages max 4 KB, except `pack_upload` (base64 of up to 16 MB) |
| `WcSession` | One browser connection: sent chunks, queues, loading map (key → start ms), anims, block changes, palette size, packet-only "virtual" entities (holograms) |
| `WcFakePlayer` | The real `ServerPlayer` behind a WebCraft player with a fake `Connection`. Captures outgoing packets (swing `ClientboundSwingAnimationPacket`, `ClientboundAnimatePacket`, damage/hurt, `ClientboundBlockUpdatePacket`, `ClientboundSectionBlocksUpdatePacket`, scoreboard, tab, menus). Dig timing, menu data (`menuData()`), villager trades (`tradesJson()`), enchant offers, interact packets |
| `WcListener` | Bukkit events (join/quit/death/chat ...) |
| `ChunkEncoder` | Binary chunk message, see protocol below |
| `BlockPalette` | BlockState ↔ small int ids sent to the browser (`pal` messages), incl. collision/shape boxes (`rs`/`bs`, up to 12 AABBs for stairs, fences ...) |
| `WcTextures` | `plugins/WebCraft/texturen.zip`: accepts WebCraft packs and normal Java resource packs (regex on `(block|item)s?/name.png(.mcmeta)`), shrinks to max 32 px, keeps animation strips, reads `.mcmeta` / `animations.json` |
| `WcItems` | ItemStack → `{k, c, d, e}` JSON |
| `WcScoreboard` | Sidebar scoreboard capture |
| `WcBlockLog` | `blocklog.csv` against griefing |
| `WcSingle` | Single player (Paper only, `singleplayer`/`singleplayer-prefix` in config.yml), `hello` {mode: "single", creative}. **Survival** = the normal `wc_` player on the normal world, the others are hidden for him only (`solo` set, `hidePlayer` one way, their chat removed from his viewers); the others still see him. **Creative** = own player `sp_<name>` (own data; bans/whitelist of `wc_<name>` count) in own worlds `wcsp_<player>` (+`_nether`, `_the_end`, seed of the server's world, Paper 26 puts them in `world/dimensions/minecraft/`), always creative, loaded before the join, unloaded 2 s after leaving, hidden both ways, no join/quit/death/advancement messages, chat private. Respawn and portals stay in the own worlds (end platform built by hand). Fabric refuses `mode: single` |
| `WcAssets` (common) | Minecraft's client assets of the server's version from Mojang (version manifest → asset index → resources.download.minecraft.net), cached by hash in `assets/` (`<version>-index.json`, `objects/xx/hash`). Used by `WcLang` and `WcSounds` |
| `WcSounds` (common) | Sound source: by default the free pack `webcraft-sounds.zip` (resource in `webcraft-common/src/main/resources`, added to the plugin jar by the pom and to the mod by build.gradle; the owner's `sounds.zip` in the data folder wins; also a resource pack with `assets/minecraft/sounds.json`), with `fallbacks.json` ([regex, event], first match, `$1`) for events it has no entry for. Mojang's sounds only with `mojang-assets: true`. Captured `ClientboundSoundPacket`/`SoundEntityPacket`/`TakeItemEntityPacket` and level events with a sound (`EVENTS`) → `snd` per tick. `sound` {e} → files of the event from `sounds.json` (`type: event` resolved), `sfile` {h} → binary message 2 (only hashes under `minecraft/sounds/`). Own thread pool |
| `WcLang` (common) | Only with `mojang-assets: true`. Client `lang` {l: "de_de"} → loads Minecraft's language file once from Mojang (via `WcAssets`), answers `lang` {l, names: key → name} with `entity.`/`block.`/`item.minecraft.*` names (items win). Not in the repo: Mojang's texts |

Important details learned the hard way:

- The fake player needs a **real `ClientInformation` with the server view distance** and a **plugin
  chunk ticket before `placeNewPlayer`**, otherwise Paper's (moonrise) chunk loader never loads/ticks
  chunks around it and mobs freeze.
- Chunk loading: `sendQueuedChunks` with a `loading` map; `CHUNK_TIMEOUT_MS = 15000` only stops counting
  a load as "fresh", late results are still delivered while the key is in `sentChunks`. Chunks within
  2 of the player are loaded urgently. Chunks outside the world border are sent empty.
- After `use_on`/`dig_stop` the plugin re-checks the blocks at +3/+20/+70 ticks (`confirmBlocks`) so a
  client-side prediction the server rejected gets corrected.
- Digging: the server accepts STOP only if (break speed *now*) x (ticks since start) >= 0.7. Falling into
  the hole you dig or water makes that 5x slower, so `WcFakePlayer.dig("stop")` holds the stop until
  `digDone()` is true (max 5 s). The client slows its crack timer the same way (`interact.js digSlow()`).
- Login fires `AsyncPlayerPreLoginEvent` (async task, then back to the main thread in `finishLogin`) and
  `PlayerLoginEvent` (in `WcFakePlayer.join`, before `placeNewPlayer`). Without them LuckPerms never loads
  the user ("A user for wc_X could not be found") and permissions don't work for WebCraft players.
  Compiling needs `org.jetbrains:annotations` (provided) because of the Paper API's annotations.
- Same WebCraft name logging in again takes over: the old session is kicked and removed first (player data is
  saved on removal), then the new one loads it. A saved position inside blocks is moved up on login
  (`freeFromBlocks`). The client pushes the player out of blocks (`player.js unstuck()`) and lets you walk
  out of blocks you are already inside (moveAxis skips boxes overlapping the start position).
- Paper 26.x renamed packets (e.g. swing is `ClientboundSwingAnimationPacket`). The plugin only works
  with exactly Paper 26.3; a Minecraft update means fixing compile errors against the new server.
- Entity JSON (in `WcPlugin`): `i` id, `type`, `x y z yaw pitch body`, `w h`, `n` name, `hand` main hand
  item key, `arm` armor keys, `use` hand raised, `var` variant (`variantOf()`: cat/wolf/frog/cow/pig/
  chicken keys, villager profession, fox/axolotl/parrot/horse/llama/rabbit/mooshroom types), `col` sheep
  wool RGB (tropical fish: `col` body, `col2` pattern color, `var` pattern name), `sheared`, `baby`, projectiles `proj, k, vx vy vz`, block displays/text displays.

## Fabric mod (`webcraft-fabric/src/main/java/de/p300/webcraft`)

Same features and protocol as the plugin, written against plain Minecraft instead of Bukkit.

| Class | Role |
|---|---|
| `WcMod` | Port of `WcPlugin`: settings from `config/webcraft/webcraft.properties` (default in resources), Fabric API events (server start/stop, end tick, commands `/webcraft` + `/wc`, block break for the block log), own `later()` scheduler, chunk futures via `ServerChunkCache.getChunkFuture`, encoder thread pool, entity JSON from Minecraft entities |
| `WcFakePlayer` | Port of the Paper class. Keeps the `ServerGamePacketListenerImpl` (its `player` is replaced on respawn). `Connection.channel/address` and `AbstractContainerMenu.dataSlots` are private in vanilla: reflection |
| `WcItems`, `WcBlockLog` | Minecraft `ItemStack` / plain values instead of Bukkit types |

Differences learned on vanilla:

- Vanilla sends the next chunk batch only after `ServerboundChunkBatchReceivedPacket`; the fake player answers
  every `ClientboundChunkBatchFinishedPacket`, otherwise block updates of most chunks never arrive.
- The login teleport is sent inside `placeNewPlayer`, before the packet listener field is set (`joining`).
- No `/whitelist add` for WebCraft names on online-mode servers (Mojang lookup): `/webcraft whitelist <name>`.
- Chat from the browser: `broadcastChatMessage` with an unsigned message ("Not Secure" in the log); `/...`
  runs `performPrefixedCommand`.
- Variants come from a reflective `getVariant()` (holder key, `StringRepresentable` or enum), mapped to the
  Bukkit names the browser knows (`VARIANT_NAMES`).
- Testing: Fabric server jar from `https://meta.fabricmc.net/v2/versions/loader/26.3/<loader>/<installer>/server/jar`,
  plus Fabric API in `mods/`. New 26.x servers have `white-list=true` in server.properties.

Liquids: the palette entry of water/lava has `lh` (surface height from `FluidState.getOwnHeight()`) and
`lf` (falling), so every level is its own id. `world.js liquidCorners()` averages the corner heights like
Minecraft (neighbours >= 0.8 weigh 10x, liquid above = full); the top texture is turned in quarter steps
downhill (other angles would sample neighbouring tiles of the animation atlas).

Light: blocks that give light get `le` (`getLightEmission()`). `world.js computeLight()` floods block light like
Minecraft over the 3x3x3 sections around the section being meshed (only when a light block is near), the mesher
averages it per corner (smooth light) into a `light` vertex attribute, and the world materials (`withBlockLight`)
use max(sky brightness uniform x sky light, warm block light, 0.05 cave ambient). Light changes re-mesh the sections
around (`markLightAround`).

Sky light (overworld only, `World.setEnv`): per chunk column `heights()` = one above the highest block that stops
(`skyStop`: occluding cubes, slabs/stairs with a floor over the whole cell) or dims (`skyDim`: water, leaves, ice ...)
sky light; cells from there up are 15. `floodSky()` spreads it sideways and down (one level per step, not through
`skyStop`) in the same 48^3 region as block light, into a `sky` vertex attribute. Fast paths: whole region open (15)
or no open sky in reach (0). A changed column top re-meshes the sections between old and new top. Mobs and the
first-person hand get `World.brightnessAt()` (estimate from column tops and light blocks nearby, no flood fill),
applied with `dimUnlit(root, basic, lambert)`. Costs about 10-20 % more meshing time.

Atlas UVs keep a quarter-to-half pixel away from tile edges (`tileUV`/`animUV` inset): with less, edge pixels
sampled the neighbour tile's see-through pixels and alphaTest cut gaps into walls (bright lines in dark caves).

Game menu font: `tools/make_font.py` turns the pack's `font/ascii.png` into `webcraft-web/src/mcfont.ttf`
(pixel squares, Minecraft widths, umlauts and ß added by hand), bundled as base64 (`.ttf` loader) and used as
`WebCraft Pixel` in `#pause` at 16px (GUI scale 2).

First-person empty hand: `skins.js firstPersonArm(skin, slim)` (right arm + sleeve of the own skin, else `entity/steve`)
placed with the matrix steps of Minecraft's `ItemInHandRenderer.renderPlayerArm` (`hand.js ARM_MATRIX`). The
`welcome` message carries the own `skin`/`slim` (`WcSkins.addTo`).

F5 (`main.js view`): 0 first person, 1 behind, 2 in front. The camera moves 4 blocks along the view (stopped by
blocks), our own figure is `Entities.showSelf()` (an `Entity` with `exact` position, rebuilt on `lookKey`). Also the
pad's right stick click and the touch 👁️ button. Hitboxes (F3+B / setting): `Entities.hitbox()` white box + blue
look line per entity. Top left shows Tag/Nacht (`Sky.night`: day time 13000-23000).

Zombies/husks/giants use `biped_mirror`: their 64x64 pictures have no own left arm/leg (Minecraft mirrors the right
ones); players, drowned and piglins have them.

Touch, controllers, 3D glasses: no pointer lock there, so "playing" = connected, alive, no screen open (`main.js
frame`), and `interaction.update` runs when locked OR (touch/pad and playing). Gyro and Gamepad API need a secure
context (https or localhost/file). Chrome's `DeviceOrientationEvent.requestPermission` only works after a tap: a
controller button can't grant it, so `setGyro` asks again on the next tap. The game menu (`#pause`) is a scroll container (flex + `margin: auto` on the card, so a tall page keeps its top
reachable); on phones a finger drag scrolls it (native, plus a pointer fallback in `main.js` that swallows the click
after a drag). Headless Chromium does not scroll for CDP touch drags while `touch-action: pan-y` is set, real phones do.
Headless tests: Playwright context with
`hasTouch/isMobile`, touches via CDP `Input.dispatchTouchEvent`, a fake `navigator.getGamepads`, synthetic
`DeviceOrientationEvent`s and `grantPermissions(['accelerometer','gyroscope','magnetometer'])` (scripts in
`/home/user/srv`: `touch.cjs`, `padvr.cjs`).

Weather: the `time` message also carries `rain`, `thunder` (0..1) and `snow`/`dry` for the player's biome
(`WcWeather`). Lightning bolts are sent as entities.

Lit: blocks with `LIT` = true (furnace, campfire, candles, redstone torch/ore) get `li` (flames and smoke in the browser).

Facing: blocks with `HORIZONTAL_FACING` get `fa` (north/east/south/west) in their palette entry; the browser draws
the `block/<name>_front` picture on that side (`palette.js tileFront/facing`), also as the left face of inventory
icons. Chest faces (`chest/trapped_chest/ender_chest_front/side/top/bottom`) are cut from `entity/chest/*.png` by
`make_pack.py chest_faces()` (the strips in that picture are upside down); other fronts come from `FRONT_FILES`.

Screens with a choice (`webcraft-common/WcMenus`): the menu message's `trades` carries `cut` (stonecutter
results, button id = index) and `sel`, `patterns` (loom pattern keys, button id = index) and `sel`, or
`beacon` {levels, pay, primary, secondary, tiers}. The beacon's "Fertig" sends `beacon` (like
`ServerboundSetBeaconPacket`). `ClientboundContainerSetDataPacket` marks the inventory dirty (progress bars).

## Protocol

WebSocket, JSON text messages `{t: "...", ...}` plus binary chunk messages.

- Binary type 2 (server → client): sound file, 40 bytes ASCII hash, then the .ogg.
- Binary: byte 0 = type (1 = chunk), rest zlib: int32 cx, int32 cz, uint8 sections, per section
  int8 sectionY + 4096 × uint16 LE palette ids, index = (y*16+z)*16+x.
- Server → client `t`: `welcome world pal tp vel stats inv items menu ents anim blocks unload chat notice
  dead dig_info board tab pack error time fx skin lang snd sound boss signs sign_edit`. Names: `items.js setNames()` (setting `lang`, default
  `de`, cached in localStorage `wc.lang.de_de`), used by `prettyName()` everywhere.
- `time` (every second): `rain`, `thunder`, `snow`, `dry` (weather) and `v` = full world clock ticks (`World.getFullTime()` / `Level.getDefaultClockTime()`);
  the browser runs it on and stops when two values are equal (`doDaylightCycle` off).
- `fx` (per tick, `WcParticles`): list of `[kind, x, y, z, dx, dy, dz, speed, count, extra]` from
  `ClientboundLevelParticlesPacket` (kind = particle key, extra = palette id for block particles or RGB for
  dust/effects) and level events (`break` = 2001 block break of another player, spawner, bone meal, potions).
- `snd` (per tick): `[event, x, y, z, vol, pitch]`, `[event, "e", entityId, vol, pitch]` or `["take", itemId]`.
  The server leaves out what the acting player's own client plays itself (vanilla `playSound(player, ...)`), so
  `main.js` plays those: steps (`stepAt`, every 1/0.6 blocks, also for other players), dig hits/break/place
  (palette `so` = sound group or 5 keys, `sv`/`sp`), landing + fall damage, own hurt/death, eating, doors/trapdoors/
  gates/buttons/levers (palette `us` = sound of the state, played when the clicked block changes), rain, thunder,
  music (`Music`, 10-20 min pauses), `animateTick` sounds in `particles.js` (40 % of Minecraft's chances, we sample
  denser). `sounds.js`: Web Audio, PannerNode linear over 16 x volume, IndexedDB `wc-sounds` (hash → ogg).
- `signs` {l: [{x, y, z, f: {l: [4 lines], c: dye color, g: glow}, b: {...}}]} (`WcSigns`): all signs with every chunk (sent after
  the chunk) and changed ones per tick (captured `ClientboundBlockEntityDataPacket` of sign types); an entry without `f` = gone.
  `sign_edit` {x, y, z, front} from a captured `ClientboundOpenSignEditorPacket`; the browser answers `sign` {x, y, z, front, l}
  → `ServerboundSignUpdatePacket` (max 90 chars per line).
- `skin` (answer to client `skin` {h}): `h` texture hash, `png` base64 (missing when not available).
- Client → server `t`: `hello move input tp_ok slot click close inv_open drop swap_hands use use_on
  dig_start dig_stop dig_abort attack punch swing interact release button trade rename creative
  respawn resync items chat pack_upload status kick reload beacon skin lang sound sfile sign` (`beacon`: `p`/`s` effect keys; `hello` has
  `name` and optional `skin` = Minecraft account name).
- Skins (`WcSkins`): the login looks the account up at Mojang (api.mojang.com + sessionserver `?unsigned=false`,
  async, cached in `skins/profiles/`), the fake player's `GameProfile` gets the signed `textures` property, so
  Minecraft clients show it too. Player entity JSON has `skin` (texture hash) and `slim`; the browser asks for the
  picture with `skin` {h}, the server downloads it from textures.minecraft.net (no CORS there) into `skins/`.
- Teleports must be acknowledged with `tp_ok` (same id), like the vanilla client.

## Client architecture (`webcraft-web/src`)

| File | Role |
|---|---|
| `main.js` | Entry: renderer, loop, WebSocket, message switch, login/pause/chat/death UI, `window.wc` debug handle |
| `sky.js` | Day/night: gradient dome (shader), sun, moon phases, stars, fog color, world brightness (`World.setBrightness`, entity lights, `dimUnlit` for MeshBasic materials of hand and entities). Only in `NORMAL` worlds |
| `weather.js` | Rain streaks / snow points around the player (stop at the highest blocking block of the column), storm darkening for `sky.js`, lightning flash (entity `lightning_bolt` → `Entities.onLightning`) |
| `particles.js` | Instanced camera-facing quads: block pieces (atlas tiles), particle sheet drawn on a canvas (flame, smoke, heart ...), `KINDS` per server particle key, ambient emitters like Minecraft's `animateTick` (random blocks around the player: torches, furnaces with palette `li`, campfires, fire, portals ...) |
| `world.js` | Chunk storage, greedy-ish meshing with atlas UVs, multi-box shapes, fire walls, raycast, `remeshAll`, collision boxes |
| `player.js` | Movement/physics, multi-box collision, world border wall, auto-jump |
| `interact.js` | Mouse: attack charge, dig with crack stages, place prediction, use/eat/bow, entity interact, name of the block/mob under the crosshair (`#look`) |
| `skins.js` | Textured mob models with the classic Minecraft box layout (`MODELS`, built in Minecraft model space: y down, ground y = 24, front -z, then turned half around x). `SKINS` maps mob type (+ variant) to model and picture, `GLOW` eye layers, armor from `armor/<material>_layer_1/2`. Scaled to the hitbox height; players always 1.8 |
| `entities.js` | Mob/player models (humanoid, quadruped, part specs from `mobs.js`), variants/colors (`VARIANTS`, `JOBS`), held item in right arm, armor, swing/hurt anims, projectiles, items, holograms. Rebuild when `lookKey(d)` changes |
| `models.js` | `blockMesh`, `itemExtruded` (pixel-extruded 3D item, front/back one-sided), `itemModel` |
| `hand.js` | First-person arm/item (arm with the own skin from `welcome.skin/slim`), swing, eat/drink/bow animations, crumbs. `drawnPicture()`: bow/crossbow pulling pictures by draw time; `THROWN`: items thrown with a swing instead of being held |
| `chunkgrid.js` | Chunk borders (F3+G / setting): yellow every 2 blocks on the own chunk, blue section heights, red corners around. Upright lines are cut into 16-block pieces (long lines vanished in swiftshader) |
| `touch.js` | Phones/tablets (`isTouch`): joystick (8 directions as WASD keys, sprint at the edge), buttons, drag anywhere to look (pointer events on `document`, not on controls), gyro look (`setGyro`, deltas of heading/elevation from `deviceorientation`, `roll` for the 3D glasses), close button for inventory/chat |
| `gamepad.js` | Gamepad API, console layout, polled per frame; `recent` = used within a minute (then `lockPointer` is skipped like on touch); d-pad/A/B navigate the game menu (`.pad-focus`) |
| `vr.js` | 3D glasses: `StereoCamera` for world and hand scene, half-screen viewports, own HUD canvas (hotbar, hearts, food) and crosshair in the hand scene. Lens correction (setting 0-150 %, Cardboard K1 0.34 / K2 0.55 at 100 %): both eyes go into a render target (its own `viewport`/`scissor`), then a full-screen shader bends each half like a barrel. Only while playing (`stereoOn`); screens (inventory, menu, chat) show normally. Touch buttons are hidden then: a tap anywhere opens the game menu (`main.js`, capture-phase pointerdown; the click of that tap is swallowed; a gyro permission tap is skipped via `touch.permissionTap`), hint line in the VR HUD (`showHint`) |
| `blockmodels.js` | Blocks drawn by their state (palette `p` = all state properties, sent by `BlockPalette.STATE_DRAWN` for pistons, repeaters, comparators, wire, observers, dispensers, hoppers, rails, lamps, levers, torches, signs, end rods, lightning rods, lanterns). `blockModel()` gives either `cube` (own picture per world side + `texUp` turn, used by the normal box path via `faceTile/faceRot`, keeps AO) or `elements` (boxes/quads in pixels like Minecraft models, built facing north, turned by `up`/`north`), baked once per id (`bakeModel`) into `Palette.quads`, drawn into the cross mesh with the light of the cell each face looks into. Extra pictures (`piston_inner`, `repeater_on`, `redstone_dust_line0` ...) come from `make_pack.py EXTRA_BLOCKS` |
| `signs.js` | Sign texts (`signs`) as canvas planes on the board (front/back, color, glow ink), rebuilt on block changes; editor for `sign_edit` (4 inputs, answers `sign`) |
| `textures.js` | Atlas: 64×64 tiles of 32 px + 8×8 animation atlas; pack tiles; gray detection for tinting |
| `palette.js` | Palette from server: tiles per block (`texnames.js` candidates), tints, boxes |
| `pack.js` | Texture sources: builtin (`texturen.zip` in the html) < server pack < local (IndexedDB). Import of MC packs incl. `.mcmeta`. `entity/` and `armor/` pictures stay out of the block atlas (`pack.image(path)`) |
| `zip.js` | Minimal zip read/write (DecompressionStream). **Inflates in parallel**: sequential awaits took minutes on a busy page |
| `items.js` | Inventory icons (pack picture, isometric block, emoji fallback), names |
| `inventory.js` | Inventory/creative/menus (brewing, furnace, enchanting, merchant, anvil ...) |
| `studio.js` | Texture studio (ChatGPT prompts, paste image, 32 px) |
| `sounds.js` | Minecraft sounds (see Protocol `snd`), music |
| `mods.js` | Client mods with switches (menu "Mods ...", localStorage `wc.mods`): `MODS` list (id, group, default, options), `mods.on/value`, HUD (`#modhud`: list, keystrokes, armor from `inv.arm`, effects from `stats.eff`, minimap from palette `rgb`), input (`held` keys: C zoom, Alt freelook with `freeYaw/freePitch`, V snaplook), CPS/reach/combo counters. `main.js applyMods()` sets fullbright (`world.setAmbient`), `sky.fixedTime`, `particles.amount`, `Entities.hitColor`, outline color, `--crosshair`, hides panels; F2 screenshot after the render; toggle sneak/sprint in the key handlers. Waypoints per server+world (localStorage `wc.waypoints`, beam + label sprite kept within 48 blocks, key B), item physics (`Entities.itemPhysics`), own nametag in F5 (`n` in `showSelf`, `lookKey` has `n`) |
| `motionblur.js` | Motion blur mod: scene into a render target, mixed with the last result (ping-pong targets), copied to the screen; hand drawn on top as before |
| `bossbar.js` | Boss bars from `boss` messages (`WcBossBars` in common: `ClientboundBossEventPacket.dispatch` → {op add/remove/progress/name/style, id, name, p, color, overlay}) |
| `modrinth.js` | Menu page "Texturpakete": Modrinth API search (`project_type:resourcepack`, CORS allowed), newest version for 26.3 (else newest), download from cdn.modrinth.com with progress, `pack.importZip` (block/item pictures only, stacked over earlier ones; "Standard-Texturen" = `pack.clearLocal`). Loaded project ids in localStorage `wc.modrinthLoaded` (button "Geladen ✓"). Also reachable from the login form (`#login-packs`; "Fertig" then hides `#pause`). "ZIP/Ordner hochladen": `pack.importFiles`; files with `.class` / `fabric.mod.json` / `mods.toml` are mods and are refused with a message. CurseForge's API needs a secret key (403 without), so not in the browser |
| `hud.js sidebar.js tablist.js border.js` | HUD, scoreboard, tab list, border |
| `index.html` | All markup and CSS; `<!-- WC_SCRIPT -->` is replaced by the bundle |

**Legal line (owner's wish): nothing of Mojang goes to the browsers by default.** Mojang's files (sounds,
language files) may only reach people who own Minecraft; browser players don't need to. So `mojang-assets`
(config.yml / webcraft.properties) is off by default and the built-in sounds are free ones:
`tools/make_sounds.py <mineclonia> <minetest_game> webcraft-common/src/main/resources/webcraft-sounds.zip`
(clones of codeberg.org/mineclonia/mineclonia and github.com/luanti-org/minetest_game, needs ffmpeg). The script only
takes files listed in `CREDITS` (license stated in those projects' README/LICENSE files: CC0, CC BY, CC BY-SA, MIT,
WTFPL; LGPL/GPL and files without a clear license are left out), maps them to Minecraft events with volume/pitch
that undo the client's Minecraft multipliers (steps x0.15, dig hits x0.25 at half pitch, break/place 0.8 pitch),
cuts short pieces from long loops (rain, lava pop) and writes `LICENSE-sounds.md` (also into the repo root).
Music = free jukebox tracks of Mineclonia (`stream`, fetched only when played).

The built-in textures are **Faithful 32x** (faithfulpack.net, license in `LICENSE-Faithful.txt`: credit + link
required, the license file goes into the zip) with Pixel Perfection CE (PPCE) for the mobs whose Faithful picture
has a newer layout. Rebuild: `tools/make_pack.py <Faithful folder> tools/items.json webcraft-web/src/texturen.zip`, then
`tools/make_pack.py --entities <Faithful folder> <PPCE folder> webcraft-web/src/texturen.zip` (first pack with a
fitting picture wins: `OLD_RATIO` keeps out newer layouts, `COMPOSED` builds villagers from skin + biome + job,
`SAME_PACK` keeps glow layers with their mob, `enderman_eyes()` makes the eye glow when a pack has none).
`tools/make_pack.py <PixelPerfectionCE folder> tools/items.json webcraft-web/src/texturen.zip` rebuilds the
built-in textures (aliases, recolors for newer blocks, spawn eggs, animations.json, destroy stages, mob and armor
textures). `tools/make_pack.py --entities <PixelPerfectionCE folder> webcraft-web/src/texturen.zip` only adds/replaces the
mob and armor textures (`ENTITY_FILES`, `ARMOR_FILES`). `tools/make_pack.py --blocks <PPCE folder> tools/items.json
webcraft-web/src/texturen.zip` only adds blocks the zip has no picture for (`RECOLOR` rules, `special()`: candles,
heads cut from the mob pictures, end portal stars, copper chests); keeps everything else (also the item pictures). The pack's mob pictures use the old (1.12) layouts, which
`skins.js` follows; the pack draws some mobs its own way (enderman: stone body with one eye on the chest).

## Testing locally

1. A Paper 26.3 server folder (e.g. copy `.paper/` or run `java -jar paper.jar nogui` once, accept EULA),
   put the jar into `plugins/`. Feed console commands through a file:
   `tail -n0 -f cmd.txt | java -Xmx2G -jar paper.jar nogui > log.txt 2>&1 &` and `echo "op wc_Micha" >> cmd.txt`.
2. Page: `webcraft-web/dist/index.html?server=ws://127.0.0.1:25007`, or the Docker container on :8080.
3. Headless checks: `tools/test/screenshot.py` (Playwright, swiftshader WebGL, ~10 fps: wait generously).
   `window.wc` gives access to `player, world, entities, renderer, scene, camera, inventory, pack, hand`.
   For model checks render `wc.scene` into a data URL, or clone entity groups into an empty scene.
4. Second player: `node tools/test/bot.mjs Lena 25000` (Node 22, `WC_URL` env for another address).
   Summon test mobs via the console, e.g. `execute at wc_Micha run summon minecraft:sheep ~3 ~ ~ {NoAI:1b,Color:6b}`.
5. Stop everything afterwards. Do **not** use `pkill -f java` from a shell whose command line contains
   "java" (it kills itself); use `for p in $(pgrep -x java) $(pgrep -x tail); do kill $p; done`.

## Backlog / ideas

- Model parts in `skins.js` may have a `parent` (placed in its coordinates, turned with it) and `order: 'ZYX'` for
  parts turned around two axes (Minecraft's order). `leftTwin()` mirrors right-side parts (ender dragon).
  Baby mobs use the adult picture and model (26.x babies have own pictures: `goat_baby`, `axolotl_*_baby` ...).
- Warden glow layers (`warden_bioluminescent_layer`, heart, pulsating spots) are not drawn yet.
