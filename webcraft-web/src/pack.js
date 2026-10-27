// Texture pack: textures from the server (texturen.zip of the plugin) plus your own ones from the
// texture studio (kept in this browser). Your own ones win.
import { atlas } from './textures.js';
import { zipFiles, unzipFiles } from './zip.js';
import builtinZip from './texturen.zip';

const DB_NAME = 'gg';   // old name kept, so textures saved in the browser stay
const STORE = 'textures';

function openDb() {
  return new Promise((resolve, reject) => {
    let req;
    try { req = indexedDB.open(DB_NAME, 1); } catch (e) { reject(e); return; }
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbAll() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const out = new Map();
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).openCursor();
    req.onsuccess = () => {
      const c = req.result;
      if (c) { out.set(c.key, c.value); c.continue(); } else resolve(out);
    };
    req.onerror = () => reject(req.error);
  });
}

async function dbPut(key, value) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    if (value === null) tx.objectStore(STORE).delete(key);
    else tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('bad image'));
    img.src = src;
  });
}

export function canvasToDataUrl(canvas) {
  return canvas.toDataURL('image/png');
}

const dataUrlToBytes = (url) => Uint8Array.from(atob(url.split(',')[1]), (c) => c.charCodeAt(0));
/**
 * PNG bytes -> data URL, at most 32 px wide like the server does it (animation strips keep their frames).
 * Packs with 128 or 512 px pictures would otherwise be far too big for the browser and the upload.
 */
async function shrinkPicture(bytes) {
  const img = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
  if (img.width <= 32) { img.close(); return bytesToDataUrl(bytes); }
  const w = 32, h = Math.max(1, Math.round(img.height * 32 / img.width));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.imageSmoothingQuality = 'high';
  g.drawImage(img, 0, 0, w, h);
  img.close();
  return c.toDataURL('image/png');
}

function bytesToDataUrl(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return 'data:image/png;base64,' + btoa(s);
}

class Pack {
  constructor() {
    this.builtin = new Map();  // path -> data URL (texture pack inside webcraft.html)
    this.server = new Map();   // path -> data URL
    this.local = new Map();    // path -> data URL
    this.builtinAnims = {};
    this.serverAnims = {};
    this.localAnims = {};
    this.images = new Map();   // data URL -> Image (decoded)
    this.listeners = [];
    this.ready = this.loadLocal();
  }

  onChange(fn) { this.listeners.push(fn); }

  async loadLocal() {
    try {
      const bytes = Uint8Array.from(atob(builtinZip), (c) => c.charCodeAt(0));
      for (const f of await unzipFiles(bytes)) {
        const m = f.name.match(/^((?:block|item|entity|armor)\/[a-z0-9_]+)\.png$/);
        if (m) this.builtin.set(m[1], bytesToDataUrl(f.data));
        else if (f.name === 'animations.json') this.builtinAnims = JSON.parse(new TextDecoder().decode(f.data));
      }
    } catch (e) {
      console.warn('built-in textures missing', e);
    }
    try {
      this.local = await dbAll();
    } catch (e) {
      this.local = new Map();
    }
    if (this.local.has('__anims')) {
      try { this.localAnims = JSON.parse(this.local.get('__anims')); } catch (e) { /* ignore */ }
      this.local.delete('__anims');
    }
    await this.apply();
  }

  /** Textures as they are used right now: path -> data URL. */
  effective() {
    const all = new Map(this.builtin);
    for (const [k, v] of this.server) all.set(k, v);
    for (const [k, v] of this.local) all.set(k, v);
    return all;
  }

  get(path) {
    return this.local.get(path) ?? this.server.get(path) ?? this.builtin.get(path) ?? null;
  }

  isLocal(path) { return this.local.has(path); }

  async setServer(files, anims) {
    this.server = new Map(Object.entries(files || {}).map(([k, v]) => [k, 'data:image/png;base64,' + v]));
    this.serverAnims = anims || {};
    await this.apply();
  }

  async setLocal(path, dataUrl) {
    if (dataUrl) this.local.set(path, dataUrl);
    else this.local.delete(path);
    try { await dbPut(path, dataUrl); } catch (e) { /* not saved, still used for this session */ }
    await this.apply();
  }

  async clearLocal() {
    for (const k of [...this.local.keys()]) {
      try { await dbPut(k, null); } catch (e) { /* ignore */ }
    }
    this.local.clear();
    this.localAnims = {};
    try { await dbPut('__anims', null); } catch (e) { /* ignore */ }
    await this.apply();
  }

  async apply() {
    const eff = this.effective();
    // Decode all pictures at the same time (one after the other takes a frame each = many seconds)
    await Promise.all([...eff.values()].filter((url) => !this.images.has(url)).map(async (url) => {
      try { this.images.set(url, await loadImage(url)); } catch (e) { /* skip broken picture */ }
    }));
    if (eff !== null && this.effective().size !== eff.size) return;   // changed meanwhile, a newer apply() follows
    const imgs = new Map();
    for (const [path, url] of eff) {
      const img = this.images.get(url);
      // Mob and armor pictures are textures of their own, not tiles of the block atlas
      if (img && (path.startsWith('block/') || path.startsWith('item/'))) imgs.set(path, img);
    }
    atlas.setPack(imgs, this.anims());
    for (const fn of this.listeners) fn();
  }

  /** Decoded picture of a texture (e.g. 'entity/cow'), or null while it is missing or still loading. */
  image(path) {
    const url = this.get(path);
    return url ? this.images.get(url) ?? null : null;
  }

  /** Timing of animated textures. */
  anims() {
    return { ...this.builtinAnims, ...this.serverAnims, ...this.localAnims };
  }

  /** Zip with all textures in use (server + own); without the built-in ones when `noBuiltin`. */
  exportZip(onlyLocal = false, noBuiltin = false) {
    const files = [];
    const src = onlyLocal ? this.local : noBuiltin ? new Map([...this.server, ...this.local]) : this.effective();
    for (const [path, url] of src) files.push({ name: path + '.png', data: dataUrlToBytes(url) });
    const anims = Object.fromEntries(Object.entries(this.anims()).filter(([p]) => src.has(p) && !this.local.has(p)));
    files.push({ name: 'animations.json', data: new TextEncoder().encode(JSON.stringify(anims)) });
    files.push({ name: 'LIESMICH.txt', data: new TextEncoder().encode(README) });
    return zipFiles(files);
  }

  /** Loads a zip as your own textures. Returns the number of textures. */
  async importZip(bytes) {
    const files = await unzipFiles(bytes);
    let n = 0;
    const anims = {};
    // Works for WebCraft packs (block/x.png) and normal Minecraft resource packs
    // (assets/minecraft/textures/block/x.png, older ones: textures/blocks/x.png)
    const pathOf = (name) => {
      const m = name.toLowerCase().match(/(?:^|\/)(block|item)s?\/([a-z0-9_]+)\.png(\.mcmeta)?$/);
      return m ? [m[1] + '/' + m[2], !!m[3]] : [null];
    };
    const pictures = [];
    for (const f of files) {
      const [path, meta] = pathOf(f.name);
      if (!path) continue;
      if (meta) {
        try {
          const a = JSON.parse(new TextDecoder().decode(f.data)).animation || {};
          anims[path] = { t: a.frametime || 1, f: (a.frames || []).map((x) => (typeof x === 'number' ? x : x.index)) };
        } catch (e) { /* broken mcmeta */ }
        continue;
      }
      pictures.push([path, f.data]);
    }
    // All at the same time (one after the other takes minutes for a big pack); HD pictures get 32 px
    await Promise.all(pictures.map(async ([path, data]) => {
      let url;
      try { url = await shrinkPicture(data); } catch (e) { return; }   // not a picture
      this.local.set(path, url);
      try { await dbPut(path, url); } catch (e) { /* ignore */ }
      n++;
    }));
    if (Object.keys(anims).length) {
      this.localAnims = { ...this.localAnims, ...anims };
      try { await dbPut('__anims', JSON.stringify(this.localAnims)); } catch (e) { /* ignore */ }
    }
    await this.apply();
    return n;
  }
}

const README = `WebCraft Texturenpaket

block/NAME.png         alle Seiten eines Blocks
block/NAME_top.png     nur oben
block/NAME_side.png    nur die Seiten
block/NAME_bottom.png  nur unten
item/NAME.png          Item-Symbol (im Inventar und auf dem Boden)

NAME ist der englische Minecraft-Name, z. B. stone, oak_log, diamond_sword.
Bilder werden auf 16x16 oder 32x32 Pixel verkleinert.

Für alle Spieler: diese ZIP-Datei als plugins/WebCraft/texturen.zip auf den Server legen
und /webcraft reload eingeben. Oder im Textur-Studio "Für alle auf den Server laden" (nur OPs).
`;

export const pack = new Pack();
