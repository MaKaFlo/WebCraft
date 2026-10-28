// Minecraft's own sounds. The server loads them from Mojang (they are not in the page) and sends them on demand:
// `sound` {e} -> the files of an event (hash, weight, volume, pitch, stream, attenuation), `sfile` {h} -> the .ogg
// as binary message (2, hash, data). Files are kept in IndexedDB 'wc-sounds' by hash, so the next visit is quiet
// on the wire. Sounds are placed in 3D like Minecraft's (linear fade over 16 blocks x volume).

const MAX_PLAYING = 40;
const LATE_MS = 1500;   // a sound whose file arrives later than this is dropped (except music)

let ctx = null;
let master = null;
let musicGain = null;
let volume = 0.6;
let musicVolume = 0.5;

function audio() {
  if (!ctx) {
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain();
      master.gain.value = volume;
      master.connect(ctx.destination);
      musicGain = ctx.createGain();
      musicGain.gain.value = musicVolume;
      musicGain.connect(master);
    } catch (e) {
      return null;
    }
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

export function setVolume(v) {
  volume = Math.max(0, Math.min(1, v));
  if (master) master.gain.value = volume;
}

export function setMusicVolume(v) {
  musicVolume = Math.max(0, Math.min(1, v));
  if (musicGain) musicGain.gain.value = musicVolume;
}

/** Call from a click/key handler so the browser allows sound later. */
export function unlockAudio() {
  audio();
}

// ---------------------------------------------------------------- file cache (IndexedDB)

let dbPromise = null;
function db() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve) => {
      try {
        const req = indexedDB.open('wc-sounds', 1);
        req.onupgradeneeded = () => req.result.createObjectStore('f');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      } catch (e) {
        resolve(null);
      }
    });
  }
  return dbPromise;
}

async function cacheGet(hash) {
  const d = await db();
  if (!d) return null;
  return new Promise((resolve) => {
    try {
      const r = d.transaction('f').objectStore('f').get(hash);
      r.onsuccess = () => resolve(r.result || null);
      r.onerror = () => resolve(null);
    } catch (e) {
      resolve(null);
    }
  });
}

async function cachePut(hash, data) {
  const d = await db();
  if (!d) return;
  try { d.transaction('f', 'readwrite').objectStore('f').put(data, hash); } catch (e) { /* full */ }
}

// ---------------------------------------------------------------- sounds

class Sounds {
  constructor() {
    this.send = null;
    this.defs = new Map();      // event -> variant list, or [] while asked
    this.waiting = new Map();   // event -> plays waiting for the list
    this.buffers = new Map();   // hash -> AudioBuffer | Promise
    this.fileWait = new Map();  // hash -> resolve function for the server's answer
    this.playing = 0;
    this.listener = { x: 0, y: 0, z: 0 };
    this.entityPos = null;      // id -> {x, y, z} (set by main.js)
  }

  /** New connection: the server's answer goes to `send`. Lists and files stay known. */
  connect(send) {
    this.send = send;
    this.waiting.clear();
    for (const [e, v] of this.defs) if (v === null) this.defs.delete(e);
    for (const [h, b] of this.buffers) if (!(b instanceof AudioBuffer)) this.buffers.delete(h);
    this.fileWait.clear();
  }

  /** Camera position and direction (every frame). */
  setListener(camera) {
    const a = ctx;
    const p = camera.position;
    this.listener = { x: p.x, y: p.y, z: p.z };
    if (!a) return;
    const l = a.listener;
    const f = camera.getWorldDirection(this._dir || (this._dir = p.clone()));
    const up = camera.up;
    if (l.positionX) {
      const t = a.currentTime;
      l.positionX.setValueAtTime(p.x, t); l.positionY.setValueAtTime(p.y, t); l.positionZ.setValueAtTime(p.z, t);
      l.forwardX.setValueAtTime(f.x, t); l.forwardY.setValueAtTime(f.y, t); l.forwardZ.setValueAtTime(f.z, t);
      l.upX.setValueAtTime(up.x, t); l.upY.setValueAtTime(up.y, t); l.upZ.setValueAtTime(up.z, t);
    } else {
      l.setPosition(p.x, p.y, p.z);
      l.setOrientation(f.x, f.y, f.z, up.x, up.y, up.z);
    }
  }

  /**
   * Plays a sound event. x == null: not placed (menus, music). volume > 1 means "heard further away" like Minecraft.
   * Returns nothing; the first time an event is played its files are fetched first (a short delay).
   */
  play(event, x, y, z, vol = 1, pitch = 1, opts = {}) {
    if (!event || !this.send || volume <= 0) return;
    if (!audio()) return;
    if (x != null && Math.hypot(x - this.listener.x, y - this.listener.y, z - this.listener.z) > 16 * Math.max(1, vol) + 8) return;
    const play = { x, y, z, vol, pitch, at: performance.now(), ...opts };
    const list = this.defs.get(event);
    if (list === undefined || list === null) {
      if (list === undefined) {
        this.defs.set(event, null);
        this.send({ t: 'sound', e: event });
      }
      const w = this.waiting.get(event) || [];
      if (w.length < 4) w.push(play);
      this.waiting.set(event, w);
      return;
    }
    this.start(list, play);
  }

  /** Server's answer to `sound` {e}. */
  onDef(msg) {
    const list = msg.v.map(([h, w, v, p, s, a]) => ({ h, w, v, p, s: !!s, a: a || 16 }));
    this.defs.set(msg.e, list);
    // Fetch the small files of the event at once (variants follow each other quickly: steps, digging)
    for (const v of list) if (!v.s) this.buffer(v.h);
    const w = this.waiting.get(msg.e);
    this.waiting.delete(msg.e);
    if (w) for (const play of w) this.start(list, play);
  }

  /** Binary file message (type 2). */
  onFile(buf) {
    const hash = new TextDecoder().decode(new Uint8Array(buf, 1, 40));
    const data = buf.slice(41);
    cachePut(hash, data);
    const done = this.fileWait.get(hash);
    this.fileWait.delete(hash);
    if (done) done(data);
  }

  /** AudioBuffer of a file: memory, IndexedDB, else from the server. */
  buffer(hash) {
    let b = this.buffers.get(hash);
    if (b) return b;
    b = (async () => {
      let data = await cacheGet(hash);
      if (!data) {
        data = await new Promise((resolve) => {
          this.fileWait.set(hash, resolve);
          this.send?.({ t: 'sfile', h: hash });
        });
      }
      const decoded = await audio().decodeAudioData(data.slice(0));
      this.buffers.set(hash, decoded);
      return decoded;
    })();
    b.catch(() => this.buffers.delete(hash));
    this.buffers.set(hash, b);
    return b;
  }

  async start(list, play) {
    if (!list.length) return;
    let r = Math.random() * list.reduce((s, v) => s + v.w, 0);
    let v = list[0];
    for (const c of list) { r -= c.w; if (r < 0) { v = c; break; } }
    let buf = this.buffers.get(v.h);
    if (!(buf instanceof AudioBuffer)) {
      try { buf = await this.buffer(v.h); } catch (e) { return; }
      if (!play.music && performance.now() - play.at > LATE_MS) return;
    }
    this.output(buf, v, play);
  }

  output(buf, v, play) {
    const a = ctx;
    if (!a || this.playing >= MAX_PLAYING) return;
    const src = a.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = Math.max(0.5, Math.min(2, play.pitch * v.p));
    const g = a.createGain();
    g.gain.value = Math.min(1, play.vol) * v.v;
    let node = src.connect(g);
    const pos = play.entity != null ? this.entityPos?.(play.entity) : null;
    const x = pos ? pos.x : play.x, y = pos ? pos.y : play.y, z = pos ? pos.z : play.z;
    if (x != null) {
      const pan = a.createPanner();
      pan.panningModel = 'equalpower';
      pan.distanceModel = 'linear';
      pan.refDistance = 0.0001;
      pan.maxDistance = v.a * Math.max(1, play.vol);
      pan.rolloffFactor = 1;
      if (pan.positionX) { pan.positionX.value = x; pan.positionY.value = y; pan.positionZ.value = z; } else pan.setPosition(x, y, z);
      node = node.connect(pan);
    }
    node.connect(play.music ? musicGain : master);
    this.playing++;
    src.onended = () => { this.playing--; play.onEnd?.(); };
    src.start();
    play.source = src;
  }

  /** `snd` message: what the server played near us this tick. */
  serverList(list) {
    for (const s of list) {
      if (s[0] === 'take') {
        const p = this.entityPos?.(s[1]);
        const type = this.entityType?.(s[1]);
        const at = p || this.listener;
        if (type === 'experience_orb') this.play('entity.experience_orb.pickup', at.x, at.y, at.z, 0.1, 0.5 * ((Math.random() - Math.random()) * 0.7 + 1.8));
        else this.play('entity.item.pickup', at.x, at.y, at.z, 0.2, ((Math.random() - Math.random()) * 0.7 + 1) * 2);
      } else if (s[1] === 'e') {
        const p = this.entityPos?.(s[2]) || this.listener;
        this.play(s[0], p.x, p.y, p.z, s[3], s[4], { entity: s[2] });
      } else {
        this.play(s[0], s[1], s[2], s[3], s[4], s[5]);
      }
    }
  }

  // ---------------------------------------------------------------- block sounds (palette `so`)

  /** The sound of a block for one action (0 break, 1 step, 2 place, 3 hit, 4 fall). */
  blockSound(P, id, action) {
    const so = P?.sound?.[id];
    if (!so) return null;
    return typeof so === 'string' ? 'block.' + so + '.' + ['break', 'step', 'place', 'hit', 'fall'][action] : so[action];
  }

  /** Like the vanilla client: break, place, dig hits, steps and landing of the own player. */
  block(P, id, action, x, y, z) {
    const e = this.blockSound(P, id, action);
    if (!e) return;
    const v = P.soundVol?.[id] ?? 1, p = P.soundPitch?.[id] ?? 1;
    switch (action) {
      case 0: case 2: this.play(e, x + 0.5, y + 0.5, z + 0.5, (v + 1) / 2, p * 0.8); break;
      case 3: this.play(e, x + 0.5, y + 0.5, z + 0.5, (v + 1) / 8, p * 0.5); break;
      case 1: this.play(e, x, y, z, v * 0.15, p); break;
      case 4: this.play(e, x, y, z, v * 0.5, p * 0.75); break;
    }
  }
}

export const sounds = new Sounds();

// ---------------------------------------------------------------- music

/** Minecraft's background music: a track now and then (first one after a short wait, then 10-20 minutes). */
export class Music {
  constructor() {
    this.wait = 20 + Math.random() * 60;
    this.current = null;
    this.kind = null;
  }

  update(dt, kind) {
    if (musicVolume <= 0 || volume <= 0 || !sounds.send) return;
    if (this.current) {
      // Another place (nether, end): fade out what plays now
      if (kind !== this.kind && this.current.source) { try { this.current.source.stop(); } catch (e) { /* not started */ } }
      return;
    }
    this.wait -= dt;
    if (this.wait > 0) return;
    this.kind = kind;
    const play = { music: true, onEnd: () => { this.current = null; this.wait = 600 + Math.random() * 600; } };
    this.current = play;
    sounds.play(kind, null, null, null, 1, 1, play);
    // Never started (no files): try again later
    setTimeout(() => { if (this.current === play && !play.source) { this.current = null; this.wait = 120; } }, 60000);
  }

  stop() {
    if (this.current?.source) { try { this.current.source.stop(); } catch (e) { /* not started */ } }
    this.current = null;
    this.wait = 20 + Math.random() * 60;
  }
}
