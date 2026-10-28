// WebCraft - browser client. Joins a Minecraft server as a real player through the WebCraft bridge plugin.
import * as THREE from 'three';
import { Palette, KIND_CROSS, KIND_LIQUID } from './palette.js';
import { World } from './world.js';
import { Player } from './player.js';
import { Entities } from './entities.js';
import { Inventory } from './inventory.js';
import { Interaction } from './interact.js';
import { Hud } from './hud.js';
import { TabList } from './tablist.js';
import { Sidebar } from './sidebar.js';
import { Hand, useKind } from './hand.js';
import { sounds, Music, setVolume, setMusicVolume, unlockAudio } from './sounds.js';
import { pack } from './pack.js';
import { clearIconCache, setNames } from './items.js';
import { Studio } from './studio.js';
import { Border } from './border.js';
import { atlas } from './textures.js';
import { Sky } from './sky.js';
import { Particles } from './particles.js';
import { Weather } from './weather.js';
import { addPlayerSkin, setSkinRequester, skinLoaded } from './skins.js';
import { ChunkGrid } from './chunkgrid.js';
import pixelFont from './mcfont.ttf';
import { TouchControls, isTouch } from './touch.js';
import { GamepadControls } from './gamepad.js';
import { StereoView } from './vr.js';
import { ModrinthPacks } from './modrinth.js';

const SKIES = {
  NORMAL: 0x9fc9ff,
  NETHER: 0x5a1a14,
  THE_END: 0x150f22,
};
// Settings (kept in the browser)
const settings = { sens: 15, fov: 75, autoJump: true, vol: 60, music: 50, gyro: false, vr: false, eye: 64, lens: 60, hitboxes: false, chunks: false, lang: 'de' };
// Settings saved under the old name (gg.*) move over once
try {
  for (const k of ['settings', 'server', 'name']) {
    const old = localStorage.getItem('gg.' + k);
    if (old !== null && localStorage.getItem('wc.' + k) === null) localStorage.setItem('wc.' + k, old);
  }
} catch (e) { /* storage blocked */ }
try { Object.assign(settings, JSON.parse(localStorage.getItem('wc.settings') || '{}')); } catch (e) { /* ignore */ }
const saveSettings = () => { try { localStorage.setItem('wc.settings', JSON.stringify(settings)); } catch (e) { /* ignore */ } };
const MOVE_SEND_INTERVAL = 0.05; // seconds (one per server tick)

const $ = (id) => document.getElementById(id);
const ui = {
  login: $('login'), form: $('login-form'), server: $('server'), name: $('name'), error: $('login-error'),
  play: $('play'), skin: $('skin'), pause: $('pause'), hud: $('hud'), coords: $('coords'), info: $('info'),
  players: $('players'), chatLog: $('chat-log'), chatInput: $('chat-input'), loading: $('loading'),
  notice: $('notice'), death: $('death'), deathMsg: $('death-msg'), respawn: $('respawn'), resume: $('resume'),
};

// ------------------------------------------------------------------ three.js setup

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
// Block colors are already final sRGB values, so pass them through unchanged
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(SKIES.NORMAL);
scene.fog = new THREE.Fog(SKIES.NORMAL, 40, 100);

const camera = new THREE.PerspectiveCamera(settings.fov, window.innerWidth / window.innerHeight, 0.05, 400);
camera.rotation.order = 'YXZ';

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

const world = new World(scene);
const sky = new Sky(scene);
const particles = new Particles(scene, world);
const weather = new Weather(scene, world, particles);
const player = new Player(world);
player.autoJump = settings.autoJump;
const entities = new Entities(scene);
entities.world = world;
const hud = new Hud();
const tablist = new TabList($('tablist'));
const hand = new Hand();
const border = new Border(scene);
setVolume(settings.vol / 100);
setMusicVolume(settings.music / 100);
const music = new Music();
let worldEnv = 'NORMAL', gameMode = 'SURVIVAL';
let myEntityId = -1;
let eatTimer = 0;
let hurtTilt = 0;
const sidebar = new Sidebar($('sidebar'));

let ws = null;
let connected = false;
let myName = '';
let dead = false;
let chatOpen = false;
let leaving = false;

function send(obj) {
  if (connected && ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}

const inventory = new Inventory({
  hotbarEl: $('hotbar'),
  offhandEl: $('offhand'),
  screenEl: $('inventory'),
  nameEl: $('item-name'),
  send,
  getPalette: () => world.palette,
  onOpenChange: (open) => {
    player.keys.clear();
    interaction.reset();
    sendInput();
    if (open) unlockPointer();
    else lockPointer();
  },
});
const interaction = new Interaction(scene, world, player, entities, inventory, send);
interaction.onSwing = () => { hand.swing(); if (entities.self) entities.self.swingT = SELF_SWING; };
setSkinRequester((h) => send({ t: 'skin', h }));
entities.onLightning = (d) => {
  weather.strike();
  // Like Minecraft: the thunder is heard everywhere, the impact only near the bolt
  sounds.play('entity.lightning_bolt.thunder', d.x, d.y, d.z, 10000, 0.8 + Math.random() * 0.2);
  sounds.play('entity.lightning_bolt.impact', d.x, d.y, d.z, 2, 0.5 + Math.random() * 0.2);
};
interaction.onBreak = (x, y, z, id) => { particles.breakBlock(x, y, z, id); sounds.block(world.palette, id, 0, x, y, z); };
interaction.onDigHit = (x, y, z, n, id) => { particles.digHit(x, y, z, n, id); sounds.block(world.palette, id, 3, x, y, z); };
interaction.onPlace = (x, y, z, id) => sounds.block(world.palette, id, 2, x, y, z);
sounds.entityPos = (id) => (id === myEntityId ? { x: player.x, y: player.y, z: player.z } : entities.map.get(id) ?? null);
sounds.entityType = (id) => entities.map.get(id)?.type;
particles.sound = (e, x, y, z, v, p) => sounds.play(e, x, y, z, v, p);
// Buttons in the game menus click like Minecraft's
document.addEventListener('click', (e) => {
  if (connected && e.target.closest?.('button, .mbtn')) sounds.play('ui.button.click', null, null, null, 0.25, 1);
});

const studio = new Studio({
  el: $('studio'),
  send,
  getPalette: () => world.palette,
  onOpenChange: (open) => {
    player.keys.clear();
    interaction.reset();
    sendInput();
    if (open) { ui.pause.hidden = true; unlockPointer(); } else lockPointer();
  },
});

// Minecraft's pixel font (built from the Faithful pack by tools/make_font.py) for the game menu
const fontStyle = document.createElement('style');
fontStyle.textContent = `@font-face { font-family: 'WebCraft Pixel'; src: url(data:font/ttf;base64,${pixelFont}) format('truetype'); }`;
document.head.appendChild(fontStyle);

/** Game menu in Minecraft's look: buttons and sliders from the texture pack (when it has them). */
function applyGuiPictures() {
  const pics = { '--mc-button': 'gui/button', '--mc-button-hl': 'gui/button_highlighted', '--mc-slider': 'gui/slider',
    '--mc-handle': 'gui/slider_handle', '--mc-handle-hl': 'gui/slider_handle_highlighted' };
  let all = true;
  for (const [cssVar, path] of Object.entries(pics)) {
    const url = pack.get(path);
    if (url) document.documentElement.style.setProperty(cssVar, `url("${url}")`);
    else all = false;
  }
  ui.pause.classList.toggle('mc-gui', all);
}

// New textures: rebuild everything that shows them
pack.onChange(() => {
  applyGuiPictures();
  world.palette?.refreshTiles();
  world.remeshAll();
  clearIconCache();
  inventory.refreshIcons();
  entities.rebuild();
  hand.dropSkinArm();
  hand.rebuildItem();
});

// ------------------------------------------------------------------ connection

let messageChain = Promise.resolve();
let lastSent = null;
let sendTimer = 0;

function connect(url, name) {
  ui.error.textContent = '';
  ui.play.disabled = true;
  ui.play.textContent = 'Verbinde...';
  try {
    ws = new WebSocket(url);
  } catch (e) {
    showLoginError('Adresse ungültig. Beispiel: ws://123.45.67.89:25007');
    return;
  }
  ws.binaryType = 'arraybuffer';
  sounds.connect(send);
  let welcomed = false;

  ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', name, skin: ui.skin.value.trim() || undefined }));
  ws.onmessage = (ev) => {
    // Chunks are decompressed in parallel, but applied strictly in arrival order
    // Sound files (type 2) don't need the order of the other messages
    if (typeof ev.data !== 'string' && new Uint8Array(ev.data, 0, 1)[0] === 2) { sounds.onFile(ev.data); return; }
    const ready = typeof ev.data === 'string' ? ev.data : decodeChunk(ev.data);
    messageChain = messageChain.then(() => ready).then(handleMessage).catch((e) => console.error(e));
  };
  ws.onclose = (ev) => {
    const wasConnected = connected;
    connected = false;
    resetGame();
    if (leaving) {
      leaving = false;
      showLoginError('');
      return;
    }
    if (!welcomed && !ui.error.textContent) {
      showLoginError(ev.reason || 'Keine Verbindung zum Server. Stimmen Adresse und Port?');
    } else if (wasConnected && !ui.error.textContent) {
      showLoginError('Verbindung zum Server getrennt.');
    }
  };

  function handleMessage(data) {
    if (data === null) return;
    if (typeof data !== 'string') {
      if (connected) world.addChunk(data.cx, data.cz, data.sections);
      return;
    }
    const msg = JSON.parse(data);
    switch (msg.t) {
      case 'welcome':
        welcomed = true;
        connected = true;
        myName = msg.name;
        myEntityId = msg.entityId;
        mySkin = msg.skin || null;
        mySlim = !!msg.slim;
        hand.setSkin(mySkin, mySlim);
        skinArmReady = !mySkin;
        applyLanguage();
        world.viewDistance = msg.viewDistance;
        setWorld(msg);
        enterGame();
        break;
      case 'world':
        world.clear();
        entities.clear();
        setWorld(msg);
        addChat(`Du bist jetzt in "${msg.world}"`, 'sys');
        break;
      case 'pal':
        if (!world.palette) world.palette = new Palette();
        world.palette.add(msg.start || 0, msg.entries);
        entities.palette = world.palette;
        break;
      case 'unload':
        for (const [cx, cz] of msg.list) world.removeChunk(cx, cz);
        break;
      case 'blocks':
        for (const [x, y, z, id] of msg.list) {
          blockSound(x, y, z, world.getId(x, y, z), id);
          world.setBlock(x, y, z, id);
        }
        break;
      case 'snd':
        sounds.serverList(msg.l);
        break;
      case 'sound':
        sounds.onDef(msg);
        break;
      case 'ents':
        entities.sync(msg.list);
        break;
      case 'tp':
        player.setPosition(msg.x, msg.y, msg.z);
        player.yaw = msg.yaw; player.pitch = msg.pitch;
        lastSent = null;
        // Not send(): the login teleport arrives before 'welcome'. Without this answer the server
        // ignores every move and the player stays at the spawn (no new chunks, stuck at the edge).
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ t: 'tp_ok', id: msg.id, x: msg.x, y: msg.y, z: msg.z, yaw: msg.yaw, pitch: msg.pitch }));
        }
        break;
      case 'lang':
        if (msg.l !== LANG_CODES[settings.lang]) break;
        try { localStorage.setItem('wc.lang.' + msg.l, JSON.stringify(msg.names)); } catch (e) { /* full */ }
        setNames(msg.names);
        inventory.refreshIcons();
        break;
      case 'skin':
        addPlayerSkin(msg.h, msg.png);
        break;
      case 'fx':
        particles.serverList(msg.l);
        // Blocks other players break: the sound comes with the pieces (Minecraft's level event 2001)
        for (const f of msg.l) if (f[0] === 'break') sounds.block(world.palette, f[9], 0, f[1], f[2], f[3]);
        break;
      case 'time':
        sky.setTime(msg.v, performance.now());
        weather.set(msg);
        break;
      case 'vel':
        player.push(msg.x, msg.y, msg.z);
        break;
      case 'stats':
        hud.update(msg);
        inventory.setCreative(msg.gm === 'CREATIVE');
        gameMode = msg.gm;
        interaction.attackSpeed = msg.as ?? 4;
        if (msg.border) setBorder(msg.border);
        hand.visibleMode = msg.gm !== 'SPECTATOR';
        player.canFly = msg.fly;
        // Like Minecraft: with 3 drumsticks or less you can't sprint (unless you may fly, e.g. creative)
        player.canSprint = msg.food > 6 || msg.fly;
        if (!player.canSprint && player.sprinting) {
          player.sprinting = false;
          sendInput();
        }
        if (!msg.dead && dead) hideDeath();
        if (msg.dead && !dead) showDeath('');
        break;
      case 'dead':
        showDeath(msg.msg);
        break;
      case 'tab':
        tablist.update(msg);
        break;
      case 'anim':
        onAnim(msg.l);
        break;
      case 'pack':
        pack.setServer(msg.files, msg.anims);
        break;
      case 'board':
        sidebar.update(msg);
        break;
      case 'items':
        inventory.setItemList(msg.list);
        studio.setItems(msg.list, msg.blocks);
        break;
      case 'inv':
        inventory.updateHotbar(msg);
        break;
      case 'menu':
        inventory.updateMenu(msg);
        break;
      case 'dig_info':
        interaction.onDigInfo(msg);
        break;
      case 'chat':
        addChat(msg.msg);
        break;
      case 'notice':
        showNotice(msg.msg);
        break;
      case 'error':
        showLoginError(msg.msg);
        break;
    }
  }
}

/** Swing / hurt animations from the server, with sounds for your own hits and hurts. */
function onAnim(list) {
  entities.anim(list);
  const now = performance.now();
  const atk = interaction.lastAttack;
  for (const [id, kind] of list) {
    if (id === myEntityId) {
      if (kind === 1) {
        hurtTilt = 0.35;
        // The server leaves our own hurt sound to the client (like for every player)
        if (!dead) sounds.play('entity.player.hurt', player.x, player.eyeY, player.z, 1, (Math.random() - Math.random()) * 0.2 + 1);
      }
      continue;
    }
    if (atk && id === atk.id && now - atk.at < 700 && kind === 1) interaction.lastAttack = null;
  }
}

function setBorder(b) {
  border.set(b);
  player.border = b && b.size < 5.9e7 ? b : null;
}

function setWorld(msg) {
  world.minY = msg.minY; world.maxY = msg.maxY;
  setBorder(msg.border);
  const color = SKIES[msg.env] ?? SKIES.NORMAL;
  scene.background.setHex(color);
  scene.fog.color.setHex(color);
  sky.setEnv(msg.env);
  world.setEnv(msg.env);
  worldEnv = msg.env;
  const far = (world.viewDistance + 1) * 16;
  scene.fog.near = msg.env === 'NETHER' ? 8 : far * 0.55;
  scene.fog.far = msg.env === 'NETHER' ? far * 0.6 : far;
  camera.far = far + 32;
  camera.updateProjectionMatrix();
  player.setPosition(msg.x, msg.y, msg.z);
  player.yaw = msg.yaw; player.pitch = msg.pitch;
  world.setCenter(Math.floor(msg.x) >> 4, Math.floor(msg.z) >> 4);
  ui.loading.hidden = false;
}

async function decodeChunk(buf) {
  const type = new Uint8Array(buf, 0, 1)[0];
  if (type !== 1) return null;
  const stream = new Blob([buf.slice(1)]).stream().pipeThrough(new DecompressionStream('deflate'));
  const raw = await new Response(stream).arrayBuffer();
  const view = new DataView(raw);
  const cx = view.getInt32(0), cz = view.getInt32(4);
  const count = view.getUint8(8);
  const sections = new Map();
  let off = 9;
  for (let i = 0; i < count; i++) {
    const sy = view.getInt8(off);
    off += 1;
    sections.set(sy, new Uint16Array(raw.slice(off, off + 8192)));
    off += 8192;
  }
  return { cx, cz, sections };
}

function sendMove() {
  if (!connected || dead) return;
  const r = (v) => Math.round(v * 1000) / 1000;
  // Position unrounded: standing at a wall (x = 15.6999), rounding gives 15.7 and the server (player box a
  // tiny bit wider) sees us inside the wall and teleports us back again and again ("stuck at the wall").
  const m = { t: 'move', x: player.x, y: player.y, z: player.z, yaw: r(player.yaw), pitch: r(player.pitch), g: player.onGround };
  if (lastSent && lastSent.x === m.x && lastSent.y === m.y && lastSent.z === m.z
      && lastSent.yaw === m.yaw && lastSent.pitch === m.pitch && lastSent.g === m.g) return;
  lastSent = m;
  send(m);
}

let lastInput = '';
function sendInput() {
  const k = player.keys;
  const input = {
    t: 'input', f: k.has('KeyW'), b: k.has('KeyS'), l: k.has('KeyA'), r: k.has('KeyD'),
    j: k.has('Space'), s: k.has('ShiftLeft'), sp: player.sprinting && k.has('KeyW'),
  };
  const key = JSON.stringify(input);
  if (key === lastInput) return;
  lastInput = key;
  send(input);
}

// ------------------------------------------------------------------ UI: login, pause, chat, death

const params = new URLSearchParams(location.search);
/**
 * Default server address. The nginx container sets it from its environment (config.js -> window.WC_CONFIG);
 * served from a web server without one, the page uses its own host (the nginx proxy at /ws).
 */
function defaultServer() {
  const cfg = (window.WC_CONFIG && window.WC_CONFIG.server) || '';
  const web = location.protocol === 'http:' || location.protocol === 'https:';
  const own = (path) => (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + path;
  if (cfg) return cfg.startsWith('/') && web ? own(cfg) : cfg;
  return web ? own('/ws') : '';
}
ui.server.value = params.get('server') || localStorage.getItem('wc.server') || defaultServer();
ui.name.value = localStorage.getItem('wc.name') || '';
ui.skin.value = localStorage.getItem('wc.skin') || '';
// The server's name prefix (only known to the page through the web server's settings)
const namePrefix = (window.WC_CONFIG && window.WC_CONFIG.namePrefix) || 'wc_';
document.getElementById('name-prefix').textContent = namePrefix;
document.getElementById('name-prefix-hint').textContent = namePrefix;

ui.form.addEventListener('submit', (e) => {
  e.preventDefault();
  let url = ui.server.value.trim();
  const name = ui.name.value.trim();
  if (!url) { showLoginError('Bitte Server-Adresse eingeben.'); return; }
  if (!/^wss?:\/\//.test(url)) url = 'ws://' + url;
  if (!/^[A-Za-z0-9_]{3,13}$/.test(name)) {
    showLoginError('Name: 3 bis 13 Zeichen, nur Buchstaben, Zahlen und _');
    return;
  }
  localStorage.setItem('wc.server', ui.server.value.trim());
  if (!/^[A-Za-z0-9_]{0,16}$/.test(ui.skin.value.trim())) {
    showLoginError('Skin: Name eines Minecraft-Spielers (Buchstaben, Zahlen und _)');
    return;
  }
  localStorage.setItem('wc.name', name);
  localStorage.setItem('wc.skin', ui.skin.value.trim());
  if (touch) {
    // Phones: whole screen, turned sideways (Android; iPhones ignore it), gyro asks for permission on this tap
    document.documentElement.requestFullscreen?.().then(() => screen.orientation?.lock?.('landscape')).catch(() => {});
    if (settings.gyro) touch.setGyro(true).then((ok) => { if (!ok) { settings.gyro = false; saveSettings(); } });
  }
  connect(url, name);
});

function showLoginError(text) {
  ui.error.textContent = text;
  ui.resume.hidden = true;
  ui.play.disabled = false;
  ui.play.textContent = 'Spielen';
  ui.login.hidden = false;
  ui.pause.hidden = true;
  ui.hud.hidden = true;
  hideDeath();
  if (document.pointerLockElement) document.exitPointerLock();
}

function enterGame() {
  ui.login.hidden = true;
  ui.hud.hidden = false;
  ui.loading.hidden = false;
  ui.play.disabled = false;
  ui.play.textContent = 'Spielen';
  lockPointer();
}

function resetGame() {
  tablist.show(false);
  world.clear();
  world.palette = null;
  entities.clear();
  lastSent = null;
  lastInput = '';
  player.keys.clear();
  inventory.reset();
  sidebar.update({ show: false });
  studio.close();
  myEntityId = -1;
  music.stop();
  interaction.reset();
  hud.reset();
  dead = false;
  player.frozen = false;
  ui.death.hidden = true;
}

function showDeath(message) {
  if (!dead && connected) sounds.play('entity.player.death', player.x, player.eyeY, player.z, 1, (Math.random() - Math.random()) * 0.2 + 1);
  dead = true;
  player.frozen = true;
  player.keys.clear();
  interaction.reset();
  if (inventory.open) inventory.setOpen(false, false);
  if (message) ui.deathMsg.textContent = message;
  ui.death.hidden = false;
  unlockPointer();
}

function hideDeath() {
  if (!dead) return;
  dead = false;
  player.frozen = false;
  ui.death.hidden = true;
  ui.deathMsg.textContent = '';
  if (connected) lockPointer();
}

ui.respawn.addEventListener('click', () => send({ t: 'respawn' }));

let noticeTimer = 0;
function showNotice(text) {
  ui.notice.textContent = text;
  ui.notice.classList.add('show');
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => ui.notice.classList.remove('show'), 2500);
}

// We release the mouse ourselves for chat, inventory and the death screen; only Esc in the
// game itself opens the game menu.
let expectUnlock = false;
function unlockPointer() {
  if (document.pointerLockElement) { expectUnlock = true; document.exitPointerLock(); }
}

// Esc that closes a chest, the inventory or the chat must not open the game menu: the browser handles Esc
// itself after our keydown and would drop the mouse again right after we took it. So wait for the key-up.
let escDown = false, lockAfterEsc = false;
document.addEventListener('keydown', (e) => { if (e.code === 'Escape') escDown = true; }, true);
document.addEventListener('keyup', (e) => {
  if (e.code !== 'Escape') return;
  escDown = false;
  if (lockAfterEsc) { lockAfterEsc = false; setTimeout(lockPointer, 30); }
}, true);

function lockPointer() {
  if (dead || inventory.open || chatOpen || !ui.pause.hidden || studio.isOpen) return;
  if (touch || pad.recent) { ui.resume.hidden = true; return; }   // phones and controllers play without a mouse
  if (escDown) { lockAfterEsc = true; return; }
  // After Esc the browser only allows this on the next click; then we ask for that click
  const p = renderer.domElement.requestPointerLock?.();
  if (p && p.catch) p.catch(() => showResume());
}

function showResume() {
  if (connected && !dead && !inventory.open && !chatOpen && ui.pause.hidden) ui.resume.hidden = false;
}
document.addEventListener('pointerlockerror', showResume);

// ------------------------------------------------------------------ game menu (Esc)

function showMenu(page = 'menu-main') {
  ui.resume.hidden = true;
  ui.pause.hidden = false;
  for (const el of ui.pause.querySelectorAll('.menu-page')) el.hidden = el.id !== page;
}
function hideMenu() {
  ui.pause.hidden = true;
  lockPointer();
}
$('m-resume').addEventListener('click', hideMenu);
$('m-settings').addEventListener('click', () => { syncSettingsUi(); showMenu('menu-settings'); });
$('m-keys').addEventListener('click', () => showMenu('menu-keys'));
const modrinth = new ModrinthPacks($('menu-packs'));
$('m-packs').addEventListener('click', () => { showMenu('menu-packs'); modrinth.open(); });
for (const b of ui.pause.querySelectorAll('[data-back]')) b.addEventListener('click', () => showMenu());
$('m-leave').addEventListener('click', () => {
  leaving = true;
  ui.pause.hidden = true;
  ws?.close(1000, 'Left');
});
ui.resume.addEventListener('click', () => { ui.resume.hidden = true; lockPointer(); });

function syncSettingsUi() {
  $('s-sens').value = settings.sens; $('s-sens-v').textContent = settings.sens;
  $('s-fov').value = settings.fov; $('s-fov-v').textContent = settings.fov + '°';
  $('s-autojump').checked = player.autoJump;
  $('s-gyro').checked = !!touch?.gyroOn;
  $('s-vr').checked = settings.vr;
  $('s-hitboxes').checked = settings.hitboxes;
  $('s-lang').textContent = 'Namen: ' + (settings.lang === 'de' ? 'Deutsch' : 'English');
  $('s-chunks').checked = settings.chunks;
  $('s-eye').value = settings.eye; $('s-eye-v').textContent = settings.eye + ' mm';
  $('s-lens').value = settings.lens; $('s-lens-v').textContent = settings.lens ? settings.lens + '%' : 'aus';
  $('s-vol').value = settings.vol; $('s-vol-v').textContent = settings.vol + '%';
  $('s-music').value = settings.music; $('s-music-v').textContent = settings.music ? settings.music + '%' : 'aus';
}
$('s-vol').addEventListener('input', (e) => {
  settings.vol = +e.target.value;
  setVolume(settings.vol / 100);
  syncSettingsUi();
  saveSettings();
  sounds.play('ui.button.click', null, null, null, 0.25, 1);
});
$('s-music').addEventListener('input', (e) => {
  settings.music = +e.target.value;
  setMusicVolume(settings.music / 100);
  syncSettingsUi();
  saveSettings();
});
$('m-textures').addEventListener('click', () => studio.open(inventory.selectedItem()?.k));
$('s-sens').addEventListener('input', (e) => { settings.sens = +e.target.value; syncSettingsUi(); saveSettings(); });
$('s-fov').addEventListener('input', (e) => {
  settings.fov = +e.target.value;
  camera.fov = settings.fov;
  camera.updateProjectionMatrix();
  syncSettingsUi();
  saveSettings();
});
$('s-autojump').addEventListener('change', (e) => { player.autoJump = settings.autoJump = e.target.checked; saveSettings(); });
$('s-vr').addEventListener('change', (e) => setVr(e.target.checked));
$('s-lang').addEventListener('click', () => {
  settings.lang = settings.lang === 'de' ? 'en' : 'de';
  saveSettings();
  applyLanguage();
  syncSettingsUi();
});
$('s-hitboxes').addEventListener('change', (e) => { settings.hitboxes = e.target.checked; saveSettings(); });
$('s-chunks').addEventListener('change', (e) => { settings.chunks = e.target.checked; saveSettings(); });
$('s-eye').addEventListener('input', (e) => {
  settings.eye = +e.target.value;
  stereo.setEyeDistance(settings.eye);
  syncSettingsUi();
  saveSettings();
});
$('s-lens').addEventListener('input', (e) => {
  settings.lens = +e.target.value;
  stereo.setLensStrength(settings.lens / 100);
  syncSettingsUi();
  saveSettings();
});
$('s-gyro').addEventListener('change', async (e) => {
  const ok = await touch?.setGyro(e.target.checked);
  settings.gyro = !!(e.target.checked && ok);
  e.target.checked = settings.gyro;
  saveSettings();
});

function openChat(prefix = '') {
  chatOpen = true;
  player.keys.clear();
  sendInput();
  ui.chatInput.hidden = false;
  ui.chatInput.value = prefix;
  ui.chatInput.focus();
  unlockPointer();
}
function closeChat() {
  chatOpen = false;
  ui.chatInput.hidden = true;
  ui.chatInput.blur();
  lockPointer();
}

ui.chatInput.addEventListener('keydown', (e) => {
  e.stopPropagation();
  if (e.key === 'Enter') {
    const text = ui.chatInput.value.trim();
    if (text) send({ t: 'chat', msg: text });
    closeChat();
  } else if (e.key === 'Escape') {
    closeChat();
  }
});

function addChat(text, cls) {
  const line = document.createElement('div');
  line.className = 'chat-line' + (cls ? ' ' + cls : '');
  line.textContent = text;
  ui.chatLog.appendChild(line);
  while (ui.chatLog.children.length > 60) ui.chatLog.firstChild.remove();
  setTimeout(() => line.classList.add('old'), 10000);
}

renderer.domElement.addEventListener('click', () => { if (connected) { ui.resume.hidden = true; lockPointer(); } });

// Phones and tablets: joystick, buttons, look by dragging (and the gyro when switched on)
const touch = isTouch ? new TouchControls({
  player, interaction, inventory, settings, sendInput, lookEl: document,
  notice: (text) => showNotice(text),
  openInventory: () => inventory.setOpen(true),
  closeOverlay: () => { if (chatOpen) closeChat(); else if (inventory.open) inventory.setOpen(false); },
  openChat: () => openChat(),
  openMenu: () => showMenu(),
  toggleView: () => cycleView(),
  drop: () => send({ t: 'drop', all: false }),
}) : null;

// Game controllers (also on phones over Bluetooth)
const pad = new GamepadControls({
  player, interaction, inventory, settings, sendInput, menuEl: ui.pause,
  notice: (text) => showNotice(text),
  openInventory: () => inventory.setOpen(true),
  closeOverlay: () => { if (chatOpen) closeChat(); else if (inventory.open) inventory.setOpen(false); },
  toggleMenu: () => { if (ui.pause.hidden) showMenu(); else hideMenu(); },
  drop: () => send({ t: 'drop', all: false }),
  toggleVr: () => setVr(!settings.vr),
  toggleView: () => cycleView(),
  clickDefault: () => { if (!ui.death.hidden) ui.respawn.click(); },
});

// 3D glasses: two pictures side by side; on phones the gyro turns the head (also tilting)
const stereo = new StereoView(hand.scene);
stereo.setEyeDistance(settings.eye);
stereo.setLensStrength(settings.lens / 100);
function setVr(on) {
  settings.vr = on;
  saveSettings();
  if (touch) {
    if (on) touch.setGyro(true);
    else if (!settings.gyro) touch.setGyro(false);
    if (on) document.documentElement.requestFullscreen?.().then(() => screen.orientation?.lock?.('landscape')).catch(() => {});
  }
  showNotice(on ? '🥽 3D-Brille an' : '3D-Brille aus');
  syncSettingsUi();
}

const isLocked = () => document.pointerLockElement === renderer.domElement;

document.addEventListener('pointerlockchange', () => {
  const locked = isLocked();
  if (locked) {
    ui.pause.hidden = true;
    ui.resume.hidden = true;
  } else if (expectUnlock) {
    expectUnlock = false;
  } else if (connected && !chatOpen && !inventory.open && !dead && !studio.isOpen) {
    showMenu();            // Esc pressed while playing
  }
  document.body.classList.toggle('chat-visible', !locked);
  if (!locked) { player.keys.clear(); interaction.reset(); sendInput(); }
});

document.addEventListener('mousemove', (e) => {
  if (!isLocked()) return;
  player.look(e.movementX, e.movementY, settings.sens / 100);
});

let lastWPress = 0, lastSpacePress = 0;
const normKey = (code) => (code === 'ShiftRight' ? 'ShiftLeft' : code);

document.addEventListener('keydown', (e) => {
  // Tab: show all players while held
  // F5: first person, from behind, from the front (like Minecraft; the browser must not reload the page)
  if (e.code === 'F5' && connected) {
    e.preventDefault();
    if (!e.repeat && !chatOpen) cycleView();
    return;
  }
  // F3 + B: hitboxes, F3 + G: chunk borders (like Minecraft)
  if (e.code === 'F3') { e.preventDefault(); f3Down = true; return; }
  if (f3Down && (e.code === 'KeyB' || e.code === 'KeyG') && connected && !chatOpen) {
    e.preventDefault();
    if (!e.repeat) toggleDebug(e.code === 'KeyB' ? 'hitboxes' : 'chunks');
    return;
  }
  if (e.code === 'Tab' && connected && !chatOpen) {
    e.preventDefault();
    tablist.show(true);
    return;
  }
  if (studio.isOpen) {
    if (e.code === 'Escape') { e.preventDefault(); studio.close(); }
    return;
  }
  if (!connected || chatOpen || dead) return;
  if (inventory.open) {
    if (e.code === 'KeyE' || e.code === 'Escape') { e.preventDefault(); inventory.setOpen(false); return; }
    if (inventory.handleKey(e)) e.preventDefault();
    return;
  }
  if (e.code === 'KeyT' || e.code === 'Enter') { e.preventDefault(); openChat(); return; }
  if (e.code === 'Slash') { e.preventDefault(); openChat('/'); return; }
  if (!isLocked()) return;
  if (e.code === 'Space') e.preventDefault();
  if (e.code.startsWith('Digit') && e.code !== 'Digit0') { inventory.select(Number(e.code.slice(5)) - 1); return; }
  if (e.code === 'KeyE') { inventory.setOpen(true); return; }
  if (e.code === 'KeyQ' && !e.repeat) { send({ t: 'drop', all: e.shiftKey }); return; }
  if (e.code === 'KeyF' && !e.repeat) { send({ t: 'swap_hands' }); return; }
  if (e.code === 'KeyJ' && !e.repeat) {
    player.autoJump = settings.autoJump = !player.autoJump;
    saveSettings();
    showNotice('Auto-Jump ' + (player.autoJump ? 'an' : 'aus'));
    return;
  }
  if (!e.repeat) {
    const now = performance.now();
    // Double-tap W to sprint (Ctrl would close the browser tab with Ctrl+W)
    if (e.code === 'KeyW') {
      if (now - lastWPress < 300 && player.canSprint) player.sprinting = true;
      lastWPress = now;
    }
    // Double-tap space to fly (only where the server allows flying)
    if (e.code === 'Space') {
      if (now - lastSpacePress < 300 && player.canFly) { player.toggleFly(); lastSpacePress = 0; }
      else lastSpacePress = now;
    }
  }
  player.keys.add(normKey(e.code));
  sendInput();
});
document.addEventListener('keyup', (e) => {
  if (e.code === 'F3') f3Down = false;
  if (e.code === 'Tab') tablist.show(false);
  if (e.code === 'KeyW') player.sprinting = false;
  player.keys.delete(normKey(e.code));
  sendInput();
});

document.addEventListener('mousedown', (e) => {
  unlockAudio();
  if (!isLocked()) return;
  if (e.button === 0) { interaction.leftDown = true; interaction.leftClick(); }
  if (e.button === 2) { interaction.rightDown = true; interaction.useTimer = 0; }
});
document.addEventListener('mouseup', (e) => {
  if (e.button === 0) interaction.leftDown = false;
  if (e.button === 2) interaction.rightDown = false;
});
document.addEventListener('contextmenu', (e) => { if (connected) e.preventDefault(); });
document.addEventListener('wheel', (e) => {
  if (!isLocked()) return;
  inventory.select(inventory.selected + Math.sign(e.deltaY));
}, { passive: true });

// ------------------------------------------------------------------ main loop

let last = performance.now();
let fps = 0, fpsFrames = 0, fpsTime = 0;
let hudTime = 0;
let shownLight = 1, handLight = 1, handLightT = 0;
let stereoOn = false;
let view = 0;                 // 0 first person, 1 from behind, 2 from the front (F5)
let f3Down = false;
let mySkin = null, mySlim = false, skinArmReady = true;
const SELF_SWING = 0.3;
const chunkGrid = new ChunkGrid(scene);

// Names of blocks, items and mobs: German from Minecraft's language file (the server loads it from Mojang once,
// the browser keeps it), or English from the keys
const LANG_CODES = { de: 'de_de' };
function applyLanguage() {
  const code = LANG_CODES[settings.lang];
  let names = null;
  if (code) {
    try { names = JSON.parse(localStorage.getItem('wc.lang.' + code) || 'null'); } catch (e) { /* ignore */ }
    if (!names && connected) send({ t: 'lang', l: code });
  }
  setNames(names);
  inventory.refreshIcons();
}

function cycleView() {
  view = (view + 1) % 3;
}

function toggleDebug(what) {
  settings[what] = !settings[what];
  saveSettings();
  syncSettingsUi();
  showNotice((what === 'hitboxes' ? 'Hitboxen ' : 'Chunk-Grenzen ') + (settings[what] ? 'an' : 'aus'));
}

/** Third person: the camera moves back (or in front) along the view, but not into walls. */
function placeThirdPersonCamera() {
  const [dx, dy, dz] = interaction.direction();
  const s = view === 1 ? -1 : 1;
  const P = world.palette;
  let dist = 4;
  for (let k = 0.2; k <= 4; k += 0.1) {
    const id = world.getId(Math.floor(player.x + dx * s * k), Math.floor(player.eyeY + dy * s * k), Math.floor(player.z + dz * s * k));
    if (P.occluding[id] || P.solid[id]) { dist = Math.max(0.2, k - 0.3); break; }
  }
  camera.position.set(player.x + dx * s * dist, player.eyeY + dy * s * dist, player.z + dz * s * dist);
  if (view === 2) { camera.rotation.y += Math.PI; camera.rotation.x = -camera.rotation.x; }
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  atlas.animate(now);

  if (connected && world.palette) {
    player.update(dt);
    world.setCenter(Math.floor(player.x) >> 4, Math.floor(player.z) >> 4);
    world.processDirty(8, player.x, player.y, player.z);
    entities.update(dt);
    const playing = connected && !dead && !inventory.open && !chatOpen && ui.pause.hidden && !studio.isOpen;
    touch?.update(playing, connected && (inventory.open || chatOpen));
    pad.poll(dt, { playing, overlay: inventory.open || chatOpen, menu: !ui.pause.hidden, dead });
    interaction.update(dt, (isLocked() || ((touch || pad.recent) && playing)) && !dead);
    stereoOn = settings.vr && playing;
    document.body.classList.toggle('vr-on', stereoOn);
    if (stereoOn) stereo.updateHud(dt, inventory, world.palette, hud.stats);
    hud.tick(dt);

    sendTimer += dt;
    if (sendTimer >= MOVE_SEND_INTERVAL) { sendTimer = 0; sendMove(); }

    camera.position.set(player.x, player.eyeY, player.z);
    camera.rotation.y = Math.PI - player.yaw * Math.PI / 180;
    camera.rotation.x = -player.pitch * Math.PI / 180;
    hurtTilt = Math.max(0, hurtTilt - dt);
    camera.rotation.z = (dead ? 0.4 : Math.sin(hurtTilt / 0.35 * Math.PI) * 0.06) + (stereoOn && touch?.gyroOn ? touch.roll : 0);
    if (view && !dead) placeThirdPersonCamera();
    entities.showSelf(view && !dead ? {
      i: -2, type: 'player', x: player.x, y: player.y, z: player.z, yaw: player.yaw, pitch: player.pitch, body: player.yaw,
      w: 0.6, h: 1.8, skin: mySkin || undefined, slim: mySlim || undefined, hand: inventory.selectedItem()?.k,
      sn: (player.keys.has('ShiftLeft') && !player.flying) || undefined, use: interaction.using || undefined,
    } : null);
    entities.showHitboxes = settings.hitboxes;
    chunkGrid.update(settings.chunks, player.x, player.z, world.minY, world.maxY);
    // The own skin arrives a moment after the login: then the first-person arm gets it
    if (!skinArmReady && skinLoaded(mySkin)) { skinArmReady = true; hand.setSkin(mySkin, mySlim); }

    hand.setItem(world.palette, inventory.selectedItem()?.k ?? null);
    const moving = player.onGround && (player.keys.has('KeyW') || player.keys.has('KeyA') || player.keys.has('KeyS') || player.keys.has('KeyD'));
    const kind = interaction.using ? useKind(inventory.selectedItem()?.k) : null;
    hand.setUsing(kind);
    if (kind === 'eat' || kind === 'drink') {
      eatTimer -= dt;
      if (eatTimer <= 0 && hand.useT > 0.25) {
        eatTimer = 0.22;
        if (kind === 'eat') {
          hand.spawnCrumbs();
          sounds.play('entity.generic.eat', player.x, player.eyeY, player.z, 0.5 + 0.5 * (Math.random() < 0.5 ? 0 : 1), (Math.random() - Math.random()) * 0.2 + 1);
        } else {
          sounds.play('entity.generic.drink', player.x, player.eyeY, player.z, 0.5, Math.random() * 0.1 + 0.9);
        }
      }
    }
    hand.update(dt, moving);
    updateAttackIndicator();
    border.update(player.x, player.eyeY, player.z, now / 1000);
    const dark = weather.update(dt, player.x, player.eyeY, player.z);
    const light = sky.update(dt, scene, camera, dark, weather.flash);
    weather.rainMat.color.setRGB(0.54 * light, 0.66 * light, 0.85 * light);
    weather.snowMat.color.setScalar(light);
    if (Math.abs(light - shownLight) > 0.004) { shownLight = light; world.setBrightness(light); entities.setBrightness(light); }
    particles.brightness = light;
    handLightT -= dt;
    if (handLightT <= 0 && world.palette) { handLightT = 0.25; handLight = world.brightnessAt(player.x, player.eyeY, player.z, light); }
    particles.update(dt, player.x, player.eyeY, player.z);
    sounds.setListener(camera);
    ownSteps(dt);
    otherSteps();
    rainSound(dt);
    music.update(dt, musicKind());

    if (!ui.loading.hidden && player.groundLoaded() && world.dirty.size < 20) ui.loading.hidden = true;
    checkMissingChunks(dt);
  }

  if (stereoOn) {
    stereo.render(renderer, scene, camera, hand, handLight, hand.visibleMode !== false && !view);
  } else {
    renderer.render(scene, camera);
  }
  if (!stereoOn && connected && world.palette && !dead && hand.visibleMode !== false && !view) {
    renderer.autoClear = false;
    hand.render(renderer, handLight);
    renderer.autoClear = true;
  }

  fpsFrames++; fpsTime += dt;
  if (fpsTime >= 0.5) { fps = Math.round(fpsFrames / fpsTime); fpsFrames = 0; fpsTime = 0; }
  hudTime += dt;
  if (connected && hudTime > 0.2) { hudTime = 0; updateHud(); }
}
requestAnimationFrame(frame);

// Watchdog: if chunks around you stay missing, ask the server to send them again
// ---------------------------------------------------------------- sounds the vanilla client makes itself

/** Steps: like Minecraft's Entity.move, one every 1/0.6 blocks walked on the ground (not when sneaking). */
function stepAt(e, x, y, z, dist, onGround, sneaking) {
  e.moveDist = (e.moveDist ?? 0) + dist * 0.6;
  if (e.nextStep === undefined) e.nextStep = e.moveDist + 1;
  if (e.moveDist <= e.nextStep) return;
  e.nextStep = Math.floor(e.moveDist) + 1;
  const P = world.palette;
  const bx = Math.floor(x), bz = Math.floor(z);
  if (world.isLiquid(bx, Math.floor(y + 0.5), bz)) {
    sounds.play('entity.player.swim', x, y, z, 0.15, 1 + (Math.random() - Math.random()) * 0.4);
    return;
  }
  if (!onGround || sneaking) return;
  // Snow layers, carpets ... on top of the block sound instead of it
  let id = world.getId(bx, Math.floor(y + 0.01), bz);
  if (!id || !/snow|carpet/.test(P.names[id])) id = world.getId(bx, Math.floor(y - 0.2), bz);
  if (id) sounds.block(P, id, 1, x, y, z);
}

const ownStep = {};
let fallTop = null;
function ownSteps() {
  const last = ownStep.pos;
  ownStep.pos = { x: player.x, y: player.y, z: player.z };
  if (!last || player.flying || dead) { fallTop = null; return; }
  const dist = Math.hypot(player.x - last.x, player.z - last.z);
  if (dist > 2) return;   // teleport
  stepAt(ownStep, player.x, player.y, player.z, dist, player.onGround, player.keys.has('ShiftLeft'));
  // Landing after a fall of more than 3 blocks: the block's fall sound and the damage sound (both left to the client)
  if (!player.onGround && !player.inLiquid) fallTop = Math.max(fallTop ?? player.y, player.y);
  else {
    const damage = fallTop !== null ? fallTop - player.y - 3 : 0;
    if (player.onGround && damage > 0) {
      const id = world.getId(Math.floor(player.x), Math.floor(player.y - 0.2), Math.floor(player.z));
      if (id) sounds.block(world.palette, id, 4, player.x, player.y, player.z);
      if (gameMode === 'SURVIVAL' || gameMode === 'ADVENTURE') {
        sounds.play(damage > 4 ? 'entity.player.big_fall' : 'entity.player.small_fall', player.x, player.y, player.z, 1, 1);
      }
    }
    fallTop = null;
  }
}

/** Other players' steps (mobs' steps come from the server). */
function otherSteps() {
  for (const e of entities.map.values()) {
    if (e.type !== 'player') continue;
    const last = e.stepPos;
    e.stepPos = { x: e.x, y: e.y, z: e.z };
    if (!last) continue;
    const dist = Math.hypot(e.x - last.x, e.z - last.z);
    if (dist > 2) continue;
    const below = world.getId(Math.floor(e.x), Math.floor(e.y - 0.2), Math.floor(e.z));
    const onGround = Math.abs(e.y - last.y) < 0.02 && below && world.palette.solid[below];
    stepAt(e, e.x, e.y, e.z, dist, onGround, e.target.sn);
  }
}

/** Rain on the ground around us now and then (Minecraft's weather.rain, muffled above a roof). */
let rainT = 0;
function rainSound(dt) {
  rainT -= dt;
  if (rainT > 0 || weather.rain < 0.05 || weather.target.snow || weather.target.dry || !world.hasSky) return;
  rainT = 0.1 + Math.random() * 0.15;
  const x = Math.floor(player.x + (Math.random() - 0.5) * 20), z = Math.floor(player.z + (Math.random() - 0.5) * 20);
  const top = weather.top(x, z, player.y);
  if (top === undefined || top === null || !Number.isFinite(top)) return;
  const roof = weather.top(Math.floor(player.x), Math.floor(player.z), player.y);
  if (top > player.y + 1 && top > roof) sounds.play('weather.rain.above', x + 0.5, top, z + 0.5, 0.1 * weather.rain, 0.5);
  else sounds.play('weather.rain', x + 0.5, top, z + 0.5, 0.2 * weather.rain, 1);
}

function musicKind() {
  if (worldEnv === 'NETHER') return 'music.nether.nether_wastes';
  if (worldEnv === 'THE_END') return 'music.end';
  return gameMode === 'CREATIVE' ? 'music.creative' : 'music.game';
}

/** Block changes the server sends: placing (blocks that were not predicted) and doors, levers ... we clicked. */
function blockSound(x, y, z, old, id) {
  const u = interaction.lastUseOn;
  if (!u || old === id || performance.now() - u.at > 1500) return;
  const P = world.palette;
  if (x === u.x && y === u.y && z === u.z && P.useSound[id] && P.names[old] === P.names[id]) {
    const [e, v, p] = P.useSound[id];
    sounds.play(e, x + 0.5, y + 0.5, z + 0.5, v, p * (0.9 + Math.random() * 0.1));
    return;
  }
  // Placed next to the clicked face, or in place of grass, snow ... that was clicked
  const replaced = x === u.x && y === u.y && z === u.z && (P.kind[old] === KIND_CROSS || P.names[old] === 'snow');
  const placed = replaced || (x === u.x + u.face[0] && y === u.y + u.face[1] && z === u.z + u.face[2]);
  if (placed && id && P.names[old] !== P.names[id] && P.kind[id] !== KIND_LIQUID) {
    sounds.block(P, id, 2, x, y, z);
  }
}

let missingTime = 0;
function checkMissingChunks(dt) {
  const cx = Math.floor(player.x) >> 4, cz = Math.floor(player.z) >> 4;
  let missing = false;
  for (let dx = -1; dx <= 1 && !missing; dx++) {
    for (let dz = -1; dz <= 1; dz++) if (!world.hasChunk(cx + dx, cz + dz)) { missing = true; break; }
  }
  missingTime = missing ? missingTime + dt : 0;
  if (missingTime > 5) {
    missingTime = -10;          // then wait 15 s before asking again
    send({ t: 'resync' });
  }
}

const atkEl = $('atk');
let atkState = '';
function updateAttackIndicator() {
  const c = interaction.charge();
  const target = !!interaction.targetEntity;
  const state = c < 1 ? 'bar' + Math.round(c * 20) : target ? 'full' : 'off';
  if (state === atkState) return;
  atkState = state;
  atkEl.hidden = state === 'off';
  atkEl.classList.toggle('full', state === 'full');
  atkEl.firstChild.style.width = Math.round(c * 100) + '%';
}

const DIRS = ['Süden', 'Westen', 'Norden', 'Osten'];
function updateHud() {
  const yaw = ((player.yaw % 360) + 360) % 360;
  const dir = DIRS[Math.round(yaw / 90) % 4];
  ui.coords.textContent = `${myName}   X ${player.x.toFixed(1)}  Y ${player.y.toFixed(1)}  Z ${player.z.toFixed(1)}   Blick: ${dir}`
    + (player.flying ? '   ✈️ Fliegen' : '') + (sky.enabled ? (sky.night ? '   🌙 Nacht' : '   ☀️ Tag') : '');
  const s = world.stats();
  ui.info.textContent = `${fps} fps · ${s.chunks} Chunks${s.pending ? ' · baue ' + s.pending : ''}`;
  const names = entities.playerNames();
  ui.players.innerHTML = '';
  if (names.length) {
    const head = document.createElement('div');
    head.className = 'players-head';
    head.textContent = 'In der Nähe';
    ui.players.appendChild(head);
  }
  for (const p of names) {
    const d = document.createElement('div');
    d.textContent = (p.wc ? '🌐 ' : '⛏️ ') + p.n;
    ui.players.appendChild(d);
  }
}

// Handy for debugging in the browser console: wc.player, wc.world
window.wc = { player, world, entities, renderer, scene, camera, inventory, interaction, send, hud, sidebar, studio, pack, hand, sky, particles, weather, sounds };
