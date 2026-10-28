# HANDOFF

Hand-over between Claude sessions. Read this first, keep it current (see CLAUDE.md, "Session handoff").

_Last update: 2026-10-28, version 0.15.1 (main, CI green)._

## Current state

- Paper plugin, Fabric mod and browser page build and work (Paper 26.3 / Fabric 26.3).
- Built-in textures: **Faithful 32x** (blocks, items, chests, armor, most mobs, GUI buttons), PPCE for cow, mooshroom,
  pig, rabbit, magma cube (newer layout in Faithful). License: `LICENSE-Faithful.txt`, credit in README.
- Done in the last session (0.10.2 → 0.15.1): block name at the top of the screen, day/night sky, particles,
  skins (Minecraft account name in the login), textures for all blocks, block light, weather, ~50 textured mob
  models, Faithful as built-in pack, texture pack upload fixed (big messages), held items with Minecraft's
  proportions, item edges fixed for 32 px, game menu in Minecraft's look, Esc in chests only closes them.

## Untested / to check

- 0.15.1: Esc in a chest should only close it (mouse is caught again after the key-up). Pointer lock can't be
  tested headless; the owner should try it in a real browser.
- Silverfish model looks shaggy (Faithful picture or model?).
- Empty hand (no item) in first person was only moved, not compared with Minecraft.

## Open wishes / next steps

- Last mobs still block figures: bat, frog, axolotl, goat, camel, armadillo, sniffer, warden, ravager, breeze,
  tropical fish, ender dragon. Cow, pig, rabbit, magma cube could use new models for the Faithful pictures.
- Minecraft pixel font for the game menu (Faithful has `font/`).
- Sky light (caves are as bright as the sky during the day).
- Ideas offered to the owner: real sounds, touch controls for phones, own skin upload.
- The owner cares about cost: keep sessions lean (few screenshots, batch changes, one build per batch).

## Local paths (session container, may be gone)

- Test servers: `/home/user/srv` (Paper, scripts `*.cjs`), `/home/user/fsrv` (Fabric). JDK 25: `/home/user/tools/jdk-25.0.5+8`.
- Texture sources: Faithful unpacked in `/home/user/faithful/x`, PPCE in `/tmp/ppce`. If gone, download again
  (works from the session container):
  `curl -sSfL -o faithful.zip "https://database.faithfulpack.net/packs/32x-Java/September%202026/Faithful%2032x%20-%2026.3.zip"`
  (Faithful 32x for 26.3, ~13 MB, 5300 files); PPCE: github.com/Athemis/PixelPerfectionCE.
