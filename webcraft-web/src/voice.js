// Voice chat: the microphone as Opus frames (48 kHz mono, 20 ms, like Simple Voice Chat) to the server (binary
// message 3), and what the server sends back (binary 3: speaker entity id, kind, position, distance, Opus) played in
// 3D. On servers with Simple Voice Chat the plugin hands it to the mod, so Java players hear us and we hear them.
// V opens the menu (groups, mute, devices) like the mod; push to talk or voice activation. Needs WebCodecs (Opus)
// and a secure page (https) for the microphone.

const FRAME = 960;   // 20 ms at 48 kHz
const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
// Like the mod: Caps Lock to talk. On a Mac the browser sends Caps Lock as a switch (no key up), so G there.
const DEFAULT_KEY = IS_MAC ? 'KeyG' : 'CapsLock';

const DEFAULTS = { enabled: false, mute: false, deaf: false, mode: 'ptt', key: DEFAULT_KEY, vad: 0.03, input: '', output: '',
  volume: 1, mic: 1, tutorial: false };

function load() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem('wc.voice') || '{}') }; } catch (e) { return { ...DEFAULTS }; }
}

export const voiceSupported = () => typeof AudioEncoder !== 'undefined' && typeof AudioDecoder !== 'undefined'
  && !!navigator.mediaDevices?.getUserMedia && window.isSecureContext !== false;

// Collects the microphone in blocks of 128 samples and passes them on
const WORKLET = `class WcMic extends AudioWorkletProcessor {
  process(inputs) { const c = inputs[0] && inputs[0][0]; if (c) this.port.postMessage(c.slice(0)); return true; }
}
registerProcessor('wc-mic', WcMic);`;

export class VoiceChat {
  /** opts: send(json), sendBinary(Uint8Array), entityPos(id) -> {x,y,z}|null, listener() -> camera, onMenu(open), keyName(code) */
  constructor(opts) {
    this.opts = opts;
    this.s = load();
    this.state = { svc: false, dist: 48, group: null, groups: [] };
    this.connected = false;
    this.capture = null;          // { ctx, stream, node, encoder }
    this.playCtx = null;
    this.streams = new Map();     // speaker entity id -> { decoder, panner, gain, next, ts }
    this.talking = new Map();     // entity id -> last packet time (ms)
    this.level = 0;               // microphone level 0..1 (meter)
    this.pttDown = false;
    this.sending = false;
    this.lastLoud = 0;
    this.buf = new Float32Array(FRAME);
    this.bufN = 0;
    this.ts = 0;
    this.menuOpen = false;
    this.error = '';
    this.buildMenu();
    this.buildHud();
  }

  save() {
    try { localStorage.setItem('wc.voice', JSON.stringify(this.s)); } catch (e) { /* private mode */ }
  }

  // ------------------------------------------------------------------ connection

  /** Logged in: switch voice on again if it was on (the microphone permission is remembered by the browser). */
  connect() {
    this.connected = true;
    if (this.s.enabled && voiceSupported()) this.enable(false);
    this.updateHud();
  }

  disconnect() {
    this.connected = false;
    this.stopCapture();
    for (const st of this.streams.values()) { try { st.decoder.close(); } catch (e) { /* closed */ } }
    this.streams.clear();
    this.talking.clear();
    this.state = { svc: false, dist: 48, group: null, groups: [] };
    this.setMenu(false);
    this.updateHud();
  }

  sendState() {
    if (!this.connected) return;
    this.opts.send({ t: 'voice', on: this.s.enabled, deaf: this.s.deaf });
  }

  /** Switch voice chat on (asks for the microphone; must come from a click the first time). */
  async enable(fromClick = true) {
    if (!voiceSupported()) {
      this.error = window.isSecureContext === false ? 'Sprachchat braucht eine https-Seite' : 'Dein Browser kann keinen Sprachchat (WebCodecs fehlt)';
      this.renderMenu();
      return;
    }
    this.s.enabled = true;
    this.save();
    this.error = '';
    this.sendState();
    this.playback();
    try {
      await this.startCapture();
    } catch (e) {
      this.error = 'Mikrofon nicht erlaubt oder nicht gefunden. Du hörst die anderen trotzdem.';
      if (!fromClick) this.error = '';
    }
    this.renderMenu();
    this.updateHud();
  }

  disable() {
    this.s.enabled = false;
    this.save();
    this.stopCapture();
    this.sendState();
    this.renderMenu();
    this.updateHud();
  }

  // ------------------------------------------------------------------ microphone

  async startCapture() {
    this.stopCapture();
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { deviceId: this.s.input ? { exact: this.s.input } : undefined, channelCount: 1,
        echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    const ctx = new AudioContext({ sampleRate: 48000 });
    const url = URL.createObjectURL(new Blob([WORKLET], { type: 'text/javascript' }));
    await ctx.audioWorklet.addModule(url);
    URL.revokeObjectURL(url);
    const src = ctx.createMediaStreamSource(stream);
    const gain = ctx.createGain();
    gain.gain.value = this.s.mic;
    const node = new AudioWorkletNode(ctx, 'wc-mic');
    const sink = ctx.createGain();
    sink.gain.value = 0;   // the worklet must be connected to run, but we don't want to hear ourselves
    src.connect(gain).connect(node).connect(sink).connect(ctx.destination);
    const encoder = new AudioEncoder({
      output: (chunk) => {
        const b = new Uint8Array(1 + chunk.byteLength);
        b[0] = 3;
        chunk.copyTo(b.subarray(1));
        if (this.connected) this.opts.sendBinary(b);
      },
      error: (e) => console.warn('voice encoder', e),
    });
    const config = { codec: 'opus', sampleRate: 48000, numberOfChannels: 1, bitrate: 32000 };
    try {
      encoder.configure({ ...config, opus: { frameDuration: 20000, application: 'voip' } });
    } catch (e) {
      encoder.configure(config);
    }
    node.port.onmessage = (ev) => this.onSamples(ev.data);
    this.capture = { ctx, stream, node, encoder, gain };
    // Fills the device list with names once the permission is there
    this.devices();
  }

  stopCapture() {
    const c = this.capture;
    this.capture = null;
    if (!c) return;
    if (this.sending) this.stopSending();
    c.stream.getTracks().forEach((t) => t.stop());
    try { c.encoder.close(); } catch (e) { /* closed */ }
    c.ctx.close();
    this.level = 0;
  }

  onSamples(block) {
    let sum = 0;
    for (let i = 0; i < block.length; i++) sum += block[i] * block[i];
    const rms = Math.sqrt(sum / block.length);
    this.level = Math.max(rms, this.level * 0.95);
    const now = performance.now();
    if (rms > this.s.vad) this.lastLoud = now;
    const want = this.connected && this.s.enabled && !this.s.mute && !this.s.deaf
      && (this.s.mode === 'ptt' ? this.pttDown : now - this.lastLoud < 400);
    if (want !== this.sending) {
      if (want) this.sending = true;
      else this.stopSending();
    }
    // Always fill 20 ms frames; only encoded while sending
    let i = 0;
    while (i < block.length) {
      const n = Math.min(FRAME - this.bufN, block.length - i);
      this.buf.set(block.subarray(i, i + n), this.bufN);
      this.bufN += n;
      i += n;
      if (this.bufN === FRAME) {
        this.bufN = 0;
        if (this.sending && this.capture?.encoder.state === 'configured') {
          const data = new AudioData({ format: 'f32', sampleRate: 48000, numberOfFrames: FRAME, numberOfChannels: 1,
            timestamp: this.ts, data: this.buf.slice(0) });
          this.ts += 20000;
          this.capture.encoder.encode(data);
          data.close();
        }
      }
    }
    this.updateHud();
  }

  stopSending() {
    this.sending = false;
    if (this.connected) this.opts.sendBinary(new Uint8Array([3]));   // end of talking (the mod resets its stream)
  }

  // ------------------------------------------------------------------ playback

  playback() {
    if (this.playCtx) return this.playCtx;
    const ctx = new AudioContext({ sampleRate: 48000 });
    this.master = ctx.createGain();
    this.master.gain.value = this.s.volume;
    this.master.connect(ctx.destination);
    this.playCtx = ctx;
    if (this.s.output && ctx.setSinkId) ctx.setSinkId(this.s.output).catch(() => {});
    return ctx;
  }

  /** Binary message 3 from the server. */
  onPacket(buf) {
    if (!this.s.enabled || this.s.deaf) return;
    const dv = new DataView(buf);
    if (buf.byteLength < 23) return;
    const id = dv.getInt32(1, true), kind = dv.getUint8(5);
    const x = dv.getFloat32(6, true), y = dv.getFloat32(10, true), z = dv.getFloat32(14, true), dist = dv.getFloat32(18, true);
    const opus = new Uint8Array(buf, 22);
    const ctx = this.playback();
    if (ctx.state === 'suspended') ctx.resume();
    let st = this.streams.get(id);
    if (!st) {
      st = { next: 0, ts: 0, kind: -1, x, y, z, dist };
      st.gain = ctx.createGain();
      st.gain.connect(this.master);
      st.decoder = new AudioDecoder({
        output: (data) => this.play(st, data),
        error: (e) => { console.warn('voice decoder', e); this.streams.delete(id); },
      });
      st.decoder.configure({ codec: 'opus', sampleRate: 48000, numberOfChannels: 1 });
      this.streams.set(id, st);
    }
    if (kind !== st.kind) {
      // Placed (proximity) or not (groups): with or without a panner
      st.gain.disconnect();
      if (st.panner) st.panner.disconnect();
      st.panner = null;
      if (kind !== 2) {
        const p = ctx.createPanner();
        p.panningModel = 'HRTF';
        p.distanceModel = 'linear';
        p.refDistance = 0.0001;
        p.rolloffFactor = 1;
        st.panner = p;
        st.gain.connect(p).connect(this.master);
      } else {
        st.gain.connect(this.master);
      }
      st.kind = kind;
    }
    st.x = x; st.y = y; st.z = z; st.dist = dist || this.state.dist;
    st.entity = kind === 0 ? id : null;
    st.last = performance.now();
    if (id >= 0) this.talking.set(id, st.last);
    try {
      st.decoder.decode(new EncodedAudioChunk({ type: 'key', timestamp: st.ts, data: opus }));
      st.ts += 20000;
    } catch (e) { /* broken frame */ }
  }

  play(st, data) {
    const ctx = this.playCtx;
    const n = data.numberOfFrames;
    const b = ctx.createBuffer(1, n, data.sampleRate);
    data.copyTo(b.getChannelData(0), { planeIndex: 0, format: 'f32-planar' });
    data.close();
    const src = ctx.createBufferSource();
    src.buffer = b;
    src.connect(st.gain);
    // A little buffer against network jitter; start over when we fell behind
    const now = ctx.currentTime;
    if (st.next < now) st.next = now + 0.06;
    src.start(st.next);
    st.next += b.duration;
  }

  /** Every frame: listener and speaker positions, push to talk state on the HUD. */
  update(camera) {
    const ctx = this.playCtx;
    if (ctx && camera) {
      const l = ctx.listener, p = camera.position;
      const f = camera.getWorldDirection(this._dir || (this._dir = p.clone()));
      if (l.positionX) {
        l.positionX.value = p.x; l.positionY.value = p.y; l.positionZ.value = p.z;
        l.forwardX.value = f.x; l.forwardY.value = f.y; l.forwardZ.value = f.z;
        l.upX.value = 0; l.upY.value = 1; l.upZ.value = 0;
      } else {
        l.setPosition(p.x, p.y, p.z);
        l.setOrientation(f.x, f.y, f.z, 0, 1, 0);
      }
      for (const [id, st] of this.streams) {
        if (performance.now() - st.last > 30000) {
          try { st.decoder.close(); } catch (e) { /* closed */ }
          this.streams.delete(id);
          continue;
        }
        if (!st.panner) continue;
        const pos = st.entity != null ? this.opts.entityPos(st.entity) : null;
        const x = pos ? pos.x : st.x, y = pos ? pos.y + 1.6 : st.y, z = pos ? pos.z : st.z;
        const pn = st.panner;
        if (pn.positionX) { pn.positionX.value = x; pn.positionY.value = y; pn.positionZ.value = z; } else pn.setPosition(x, y, z);
        pn.maxDistance = st.dist || 48;
      }
    }
    if (this.menuOpen) this.renderMeter();
  }

  /** Talking right now (for the icon over the head). */
  isTalking(id) {
    const t = this.talking.get(id);
    return t !== undefined && performance.now() - t < 300;
  }

  // ------------------------------------------------------------------ keys

  /** Key down while playing; returns true when it was a voice key. */
  keyDown(e) {
    if (e.code === 'KeyV' && !e.repeat) { this.setMenu(!this.menuOpen); return true; }
    if (this.waitKey) {
      this.s.key = e.code;
      this.waitKey = false;
      this.save();
      this.renderMenu();
      return true;
    }
    if (e.code === this.s.key) { this.pttDown = true; this.updateHud(); return true; }
    return false;
  }

  keyUp(e) {
    if (e.code === this.s.key) { this.pttDown = false; this.updateHud(); }
  }

  /** Touch button: hold to talk. */
  setTalkButton(down) {
    this.pttDown = down;
    this.updateHud();
  }

  // ------------------------------------------------------------------ server state

  /** `voice` message: plugin, distance, our group, all groups, an error. */
  onState(msg) {
    this.state = { svc: !!msg.svc, dist: msg.dist || 48, group: msg.group || null, groups: msg.groups || [] };
    if (msg.err) this.error = msg.err;
    this.renderMenu();
    this.updateHud();
  }

  // ------------------------------------------------------------------ HUD (bottom left, like the mod's icons)

  buildHud() {
    const el = document.createElement('div');
    el.id = 'voice-hud';
    el.hidden = true;
    document.body.appendChild(el);
    this.hud = el;
  }

  updateHud() {
    const el = this.hud;
    if (!el) return;
    el.hidden = !this.connected || !this.s.enabled;
    if (el.hidden) return;
    let icon = '🎙️', cls = '';
    if (this.s.deaf) { icon = '🔇'; cls = 'off'; } else if (this.s.mute || !this.capture) { icon = '🎙️'; cls = 'off'; } else if (this.sending) cls = 'talk';
    const group = this.state.group ? `<span class="vg">👥 ${esc(this.state.group.name)}</span>` : '';
    const html = `<span class="vi ${cls}">${icon}</span>${group}`;
    if (html !== this._hud) { el.innerHTML = html; this._hud = html; }
  }

  // ------------------------------------------------------------------ menu (V)

  setMenu(open) {
    if (open === this.menuOpen) return;
    this.menuOpen = open;
    this.menu.hidden = !open;
    this.waitKey = false;
    if (open) {
      this.error = '';
      if (this.s.enabled) this.sendState();   // fresh group list
      this.devices();
      this.renderMenu();
    }
    this.opts.onMenu(open);
  }

  buildMenu() {
    const m = document.createElement('div');
    m.id = 'voice-menu';
    m.hidden = true;
    m.innerHTML = '<div class="vcard"><h2>🎙️ Sprachchat</h2><div class="vbody"></div></div>';
    m.addEventListener('mousedown', (e) => { if (e.target === m) this.setMenu(false); });
    m.addEventListener('keydown', (e) => e.stopPropagation());   // typing a group name must not walk
    document.body.appendChild(m);
    this.menu = m;
    this.body = m.querySelector('.vbody');
    this.inputs = [];
    this.outputs = [];
  }

  async devices() {
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      this.inputs = all.filter((d) => d.kind === 'audioinput');
      this.outputs = all.filter((d) => d.kind === 'audiooutput');
      if (this.menuOpen) this.renderMenu();
    } catch (e) { /* no devices */ }
  }

  renderMeter() {
    const bar = this.body.querySelector('.vmeter i');
    if (bar) bar.style.width = Math.min(100, this.level * 400) + '%';
    const mark = this.body.querySelector('.vmeter b');
    if (mark) mark.style.left = Math.min(100, this.s.vad * 400) + '%';
  }

  renderMenu() {
    if (!this.menuOpen) return;
    const s = this.s, st = this.state;
    if (!voiceSupported()) {
      this.body.innerHTML = `<p class="verr">${window.isSecureContext === false ? 'Sprachchat braucht eine https-Seite.' : 'Dein Browser kann keinen Sprachchat (WebCodecs fehlt). Probier Chrome, Edge oder Firefox.'}</p>`;
      return;
    }
    const opt = (list, cur, none) => [`<option value="">${none}</option>`, ...list.map((d, i) =>
      `<option value="${esc(d.deviceId)}"${d.deviceId === cur ? ' selected' : ''}>${esc(d.label || 'Gerät ' + (i + 1))}</option>`)].join('');
    const canOut = !!(window.AudioContext && AudioContext.prototype.setSinkId);
    const keyName = this.waitKey ? 'Taste drücken ...' : this.opts.keyName(s.key);
    const groups = st.groups.map((g) => `<div class="vgroup${st.group?.id === g.id ? ' mine' : ''}">
        <span>${g.pw ? '🔒 ' : ''}${esc(g.name)} <small>${g.type === 'open' ? 'offen' : g.type === 'isolated' ? 'abgeschottet' : ''} ${(g.members || []).map(esc).join(', ')}</small></span>
        ${st.group?.id === g.id ? '<button type="button" data-a="leave">Verlassen</button>' : `<button type="button" data-a="join" data-id="${esc(g.id)}" data-pw="${g.pw ? 1 : ''}">Beitreten</button>`}
      </div>`).join('') || '<p class="vhint">Noch keine Gruppen.</p>';
    this.body.innerHTML = !s.enabled ? `
      <p>Sprich mit den anderen Spielern in deiner Nähe${st.svc ? ', auch mit Minecraft-Spielern, die Simple Voice Chat haben' : ''}.</p>
      ${this.error ? `<p class="verr">${esc(this.error)}</p>` : ''}
      <button type="button" class="vbig" data-a="on">Sprachchat einschalten</button>
      <p class="vhint">Der Browser fragt einmal nach dem Mikrofon.</p>` : `
      ${this.error ? `<p class="verr">${esc(this.error)}</p>` : ''}
      <p class="vhint">${st.svc ? '✅ Verbunden mit Simple Voice Chat des Servers' : 'Sprachchat zwischen den Browser-Spielern'} · Reichweite ${Math.round(st.dist)} Blöcke</p>
      <div class="vrow">
        <button type="button" data-a="mute" class="${s.mute ? 'on' : ''}">${s.mute ? '🎙️ Mikrofon ist aus' : '🎙️ Mikrofon an'}</button>
        <button type="button" data-a="deaf" class="${s.deaf ? 'on' : ''}">${s.deaf ? '🔇 Alles stumm' : '🔊 Ton an'}</button>
        <button type="button" data-a="off">Ausschalten</button>
      </div>
      <h3>Sprechen</h3>
      <div class="vrow">
        <button type="button" data-a="mode" data-v="ptt" class="${s.mode === 'ptt' ? 'on' : ''}">Taste halten</button>
        <button type="button" data-a="mode" data-v="vad" class="${s.mode === 'vad' ? 'on' : ''}">Sprachaktivierung</button>
        ${s.mode === 'ptt' ? `<button type="button" data-a="key">Taste: ${esc(keyName)}</button>` : ''}
      </div>
      <div class="vmeter" title="Mikrofon-Pegel${s.mode === 'vad' ? ', der Strich ist die Schwelle' : ''}"><i></i>${s.mode === 'vad' ? '<b></b>' : ''}</div>
      ${s.mode === 'vad' ? `<label>Schwelle <input type="range" min="0.005" max="0.2" step="0.005" value="${s.vad}" data-a="vad"></label>` : ''}
      <label>Mikrofon <select data-a="input">${opt(this.inputs, s.input, 'Standard')}</select></label>
      <label>Mikrofon-Lautstärke <input type="range" min="0" max="2" step="0.05" value="${s.mic}" data-a="mic"></label>
      ${canOut ? `<label>Kopfhörer / Lautsprecher <select data-a="output">${opt(this.outputs, s.output, 'Standard')}</select></label>` : ''}
      <label>Lautstärke der anderen <input type="range" min="0" max="2" step="0.05" value="${s.volume}" data-a="volume"></label>
      <h3>Gruppen</h3>
      <div class="vgroups">${groups}</div>
      <div class="vrow vcreate">
        <input type="text" maxlength="24" placeholder="Neue Gruppe" data-f="name">
        <input type="password" maxlength="32" placeholder="Passwort (frei lassen: keins)" data-f="pw">
        <select data-f="type"><option value="normal">Normal</option><option value="open">Offen</option><option value="isolated">Abgeschottet</option></select>
        <button type="button" data-a="create">Erstellen</button>
      </div>`;
    this.body.insertAdjacentHTML('beforeend', '<button type="button" class="vclose" data-a="close">Fertig (V)</button>');
    this.body.querySelectorAll('[data-a]').forEach((el) => {
      const a = el.dataset.a;
      const ev = el.tagName === 'BUTTON' ? 'click' : el.type === 'range' ? 'input' : 'change';
      el.addEventListener(ev, () => this.action(a, el));
    });
    this.renderMeter();
  }

  action(a, el) {
    const s = this.s;
    this.error = '';
    switch (a) {
      case 'on': this.enable(true); return;
      case 'off': this.disable(); return;
      case 'close': this.setMenu(false); return;
      case 'mute': s.mute = !s.mute; break;
      case 'deaf': s.deaf = !s.deaf; this.sendState(); break;
      case 'mode': s.mode = el.dataset.v; break;
      case 'key': this.waitKey = true; this.renderMenu(); return;
      case 'vad': s.vad = Number(el.value); this.save(); return;
      case 'mic': s.mic = Number(el.value); if (this.capture) this.capture.gain.gain.value = s.mic; this.save(); return;
      case 'volume': s.volume = Number(el.value); if (this.master) this.master.gain.value = s.volume; this.save(); return;
      case 'input': s.input = el.value; this.save(); if (s.enabled) this.startCapture().catch(() => {}); return;
      case 'output': s.output = el.value; this.save(); this.playCtx?.setSinkId?.(s.output).catch(() => {}); return;
      case 'join': {
        const pw = el.dataset.pw ? prompt('Passwort der Gruppe:') : '';
        if (pw === null) return;
        this.opts.send({ t: 'vgroup', op: 'join', id: el.dataset.id, pw });
        return;
      }
      case 'leave': this.opts.send({ t: 'vgroup', op: 'leave' }); return;
      case 'create': {
        const f = (k) => this.body.querySelector(`[data-f="${k}"]`).value;
        this.opts.send({ t: 'vgroup', op: 'create', name: f('name').trim(), pw: f('pw'), type: f('type') });
        return;
      }
    }
    this.save();
    this.renderMenu();
    this.updateHud();
  }

  // ------------------------------------------------------------------ first join

  /** Shows the short voice chat tutorial once (after the first login). */
  tutorial(show) {
    if (this.s.tutorial || !voiceSupported()) return;
    this.s.tutorial = true;
    this.save();
    const key = this.opts.keyName(this.s.key);
    const steps = [
      ['🎙️ Sprachchat', 'Hier kannst du mit den anderen sprechen, wie mit Simple Voice Chat in Minecraft.'],
      ['V drücken', 'Mit <b>V</b> öffnest du das Sprachchat-Menü. Dort schaltest du ihn ein, gehst in Gruppen, stellst dich stumm und wählst Mikrofon und Kopfhörer.'],
      [`${esc(key)} halten`, `Zum Sprechen hältst du <b>${esc(key)}</b> gedrückt (im Menü änderbar, auch Sprachaktivierung). Wer spricht, hat ein 🔊 über dem Kopf.`],
    ];
    show(steps);
  }
}

function esc(t) {
  return String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
