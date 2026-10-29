// WebCraft's own client mods, switched on and off in the game menu ("Mods ..."), like the toggles of PvP clients:
// HUD displays (fps, cps, keystrokes, armor, effects, clock, reach, combo, minimap ...), fullbright, zoom, freelook,
// snaplook, time changer, no weather, particle amount, crosshair/outline/hit colors, toggle sprint/sneak, screenshot.
// Nothing here is code from other clients: these are WebCraft's own versions of the same ideas.
import * as THREE from 'three';
import { iconCanvas, prettyName } from './items.js';

const KEY = 'wc.mods';

/** id, name, group, default, options ([value, label]) for mods with a choice. */
export const MODS = [
  { id: 'coords', name: 'Koordinaten', group: 'Anzeigen', def: true },
  { id: 'debuginfo', name: 'Leistungs-Info (FPS, Chunks)', group: 'Anzeigen', def: true },
  { id: 'fps', name: 'FPS', group: 'Anzeigen' },
  { id: 'cps', name: 'CPS (Klicks pro Sekunde)', group: 'Anzeigen' },
  { id: 'keystrokes', name: 'Tastenanzeige (WASD, Maus)', group: 'Anzeigen' },
  { id: 'armorhud', name: 'Rüstungs-Anzeige', group: 'Anzeigen' },
  { id: 'potionhud', name: 'Trank-Effekte', group: 'Anzeigen' },
  { id: 'clock', name: 'Uhrzeit', group: 'Anzeigen' },
  { id: 'daycounter', name: 'Tag-Zähler', group: 'Anzeigen' },
  { id: 'reach', name: 'Reichweite beim Schlagen', group: 'Anzeigen' },
  { id: 'combo', name: 'Combo-Zähler', group: 'Anzeigen' },
  { id: 'memory', name: 'Speicher-Anzeige', group: 'Anzeigen' },
  { id: 'minimap', name: 'Minimap', group: 'Anzeigen' },
  { id: 'chattime', name: 'Uhrzeit im Chat', group: 'Anzeigen' },
  { id: 'noscoreboard', name: 'Scoreboard ausblenden', group: 'Anzeigen' },
  { id: 'bossbar', name: 'Bossbar', group: 'Anzeigen', def: true },
  { id: 'waypoints', name: 'Wegpunkte (B setzt einen)', group: 'Anzeigen' },
  { id: 'fullbright', name: 'Fullbright (alles hell)', group: 'Sicht' },
  { id: 'zoom', name: 'Zoom (C halten)', group: 'Sicht', def: true },
  { id: 'freelook', name: 'Freelook (Alt halten)', group: 'Sicht' },
  { id: 'snaplook', name: 'Snaplook: nach hinten schauen (V halten)', group: 'Sicht' },
  { id: 'nohurtcam', name: 'Kein Wackeln bei Schaden', group: 'Sicht' },
  { id: 'noweather', name: 'Kein Regen und Schnee', group: 'Sicht' },
  { id: 'timechanger', name: 'Tageszeit', group: 'Sicht', def: null,
    options: [[null, 'wie Server'], [1000, 'Morgen'], [6000, 'Mittag'], [12500, 'Abend'], [18000, 'Nacht']] },
  { id: 'particles', name: 'Partikel', group: 'Sicht', def: 1,
    options: [[1, 'alle'], [0.5, 'halb'], [0.25, 'wenig'], [0, 'keine']] },
  { id: 'crosshair', name: 'Fadenkreuz-Farbe', group: 'Sicht', def: 'rgba(255,255,255,0.85)',
    options: [['rgba(255,255,255,0.85)', 'weiß'], ['#ff3030', 'rot'], ['#40ff40', 'grün'], ['#ffe040', 'gelb'], ['#40e0ff', 'türkis']] },
  { id: 'outline', name: 'Block-Umrandung', group: 'Sicht', def: 0x000000,
    options: [[0x000000, 'schwarz'], [0xffffff, 'weiß'], [0xff3030, 'rot'], [0x40ff40, 'grün'], [0x40a0ff, 'blau']] },
  { id: 'hitcolor', name: 'Treffer-Farbe', group: 'Sicht', def: 0xff3030,
    options: [[0xff3030, 'rot'], [0x3080ff, 'blau'], [0x40ff40, 'grün'], [0xffe040, 'gelb'], [0xc040ff, 'lila']] },
  { id: 'screenshot', name: 'Screenshot (F2)', group: 'Sicht', def: true },
  { id: 'motionblur', name: 'Bewegungsunschärfe', group: 'Sicht', def: 0,
    options: [[0, 'aus'], [0.5, 'leicht'], [0.7, 'mittel'], [0.85, 'stark']] },
  { id: 'itemphysics', name: 'Item-Physik (Items liegen flach)', group: 'Sicht' },
  { id: 'ownname', name: 'Eigenes Namensschild (F5)', group: 'Sicht' },
  { id: 'togglesprint', name: 'Toggle Sprint (immer sprinten mit W)', group: 'Bewegung' },
  { id: 'togglesneak', name: 'Toggle Sneak (Shift schaltet um)', group: 'Bewegung' },
];

const BY_ID = new Map(MODS.map((m) => [m.id, m]));

const EFFECT_NAMES = {
  speed: 'Schnelligkeit', slowness: 'Langsamkeit', haste: 'Eile', mining_fatigue: 'Abbaulähmung', strength: 'Stärke',
  instant_health: 'Direktheilung', instant_damage: 'Direktschaden', jump_boost: 'Sprungkraft', nausea: 'Übelkeit',
  regeneration: 'Regeneration', resistance: 'Resistenz', fire_resistance: 'Feuerresistenz', water_breathing: 'Unterwasseratmung',
  invisibility: 'Unsichtbarkeit', blindness: 'Blindheit', night_vision: 'Nachtsicht', hunger: 'Hunger', weakness: 'Schwäche',
  poison: 'Vergiftung', wither: 'Ausdörrung', health_boost: 'Extraenergie', absorption: 'Absorption', saturation: 'Sättigung',
  glowing: 'Leuchten', levitation: 'Schwebekraft', luck: 'Glück', unluck: 'Pech', slow_falling: 'Sanfter Fall',
  conduit_power: 'Meereskraft', dolphins_grace: 'Gunst des Delfins', bad_omen: 'Böses Omen', hero_of_the_village: 'Held des Dorfes',
  darkness: 'Dunkelheit', trial_omen: 'Prüfungs-Omen', raid_omen: 'Überfall-Omen', wind_charged: 'Windgeladen',
  weaving: 'Weben', oozing: 'Schleimen', infested: 'Befall',
};
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];

const WAYPOINT_KEY = 'wc.waypoints';
const WAYPOINT_COLORS = [0xff4040, 0x40a0ff, 0x40ff60, 0xffe040, 0xd060ff, 0xffffff];

const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

class Mods {
  constructor() {
    this.state = {};
    try { this.state = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { /* none */ }
    this.held = new Set();      // keys held for zoom / freelook / snaplook
    this.clicks = [[], []];     // times of left / right clicks (CPS)
    this.reach = null;          // { d, at }
    this.combo = { n: 0, at: 0 };
    this.freeYaw = 0;
    this.freePitch = 0;
    this.zoomFov = null;
    this.hudT = 0;
    this.mapT = 0;
    this.armor = [];
    this.effects = [];
    this.waypoints = {};
    try { this.waypoints = JSON.parse(localStorage.getItem(WAYPOINT_KEY) || '{}'); } catch (e) { /* none */ }
    this.place = '';            // server address + world: waypoints belong to one world
    this.wpGroup = null;
    this.wpBuilt = '';
  }

  // ---------------------------------------------------------------- waypoints

  /** The world we are in now (server address and world name). */
  setPlace(server, world) {
    this.place = server + '|' + world;
  }

  points() {
    return this.waypoints[this.place] ?? [];
  }

  savePoints(list) {
    this.waypoints[this.place] = list;
    try { localStorage.setItem(WAYPOINT_KEY, JSON.stringify(this.waypoints)); } catch (e) { /* storage blocked */ }
    this.wpBuilt = '';
    this.onWaypoints?.();
  }

  addWaypoint(player) {
    const list = this.points();
    const n = list.length + 1;
    list.push({ name: 'Punkt ' + n, x: Math.floor(player.x) + 0.5, y: Math.floor(player.y), z: Math.floor(player.z) + 0.5,
      color: WAYPOINT_COLORS[(n - 1) % WAYPOINT_COLORS.length] });
    this.savePoints(list);
    return list[list.length - 1];
  }

  removeWaypoint(i) {
    const list = this.points();
    list.splice(i, 1);
    this.savePoints(list);
  }

  /** Beams and labels in the world (per frame: the labels keep their size and show the distance). */
  updateWaypoints(scene, camera, dt) {
    if (!this.wpGroup) {
      this.wpGroup = new THREE.Group();
      scene.add(this.wpGroup);
    }
    const show = this.on('waypoints');
    this.wpGroup.visible = show;
    if (!show) return;
    const list = this.points();
    const sig = this.place + JSON.stringify(list);
    if (sig !== this.wpBuilt) {
      this.wpBuilt = sig;
      for (const c of [...this.wpGroup.children]) {
        this.wpGroup.remove(c);
        c.traverse((o) => { o.geometry?.dispose(); o.material?.map?.dispose(); o.material?.dispose(); });
      }
      for (const w of list) {
        const g = new THREE.Group();
        g.position.set(w.x, w.y, w.z);
        const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 256, 6, 1, true),
          new THREE.MeshBasicMaterial({ color: w.color, transparent: true, opacity: 0.4, depthWrite: false, fog: false }));
        beam.position.y = 128;
        g.add(beam);
        const canvas = document.createElement('canvas');
        canvas.width = 256; canvas.height = 48;
        const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), depthTest: false, fog: false }));
        label.renderOrder = 10;
        label.userData = { canvas, w, last: '' };
        g.add(label);
        this.wpGroup.add(g);
      }
    }
    for (const g of this.wpGroup.children) {
      const label = g.children[1];
      const { canvas, w } = label.userData;
      const dx = w.x - camera.position.x, dy = w.y + 2 - camera.position.y, dz = w.z - camera.position.z;
      const dist = Math.hypot(dx, dy, dz);
      // Far away waypoints are drawn closer (inside the view distance), always the same size on the screen
      const shown = Math.min(dist, 48) / Math.max(dist, 0.001);
      label.position.set(dx * shown + camera.position.x - w.x, dy * shown + camera.position.y - w.y, dz * shown + camera.position.z - w.z);
      const s = Math.min(dist, 48) * 0.09;
      label.scale.set(s * 5.33, s, 1);
      const text = `${w.name} (${Math.round(dist)} m)`;
      if (text !== label.userData.last) {
        label.userData.last = text;
        const g2 = canvas.getContext('2d');
        g2.clearRect(0, 0, 256, 48);
        g2.fillStyle = 'rgba(0,0,0,0.5)';
        g2.fillRect(0, 4, 256, 40);
        g2.font = 'bold 26px sans-serif';
        g2.textAlign = 'center';
        g2.fillStyle = '#' + w.color.toString(16).padStart(6, '0');
        g2.fillText(text, 128, 33);
        label.material.map.needsUpdate = true;
      }
    }
  }

  value(id) {
    const m = BY_ID.get(id);
    return id in this.state ? this.state[id] : (m.def ?? false);
  }

  /** Switched on (for mods with options: not at their first, neutral choice). */
  on(id) {
    const m = BY_ID.get(id);
    const v = this.value(id);
    return m.options ? v !== m.options[0][0] : !!v;
  }

  set(id, v) {
    this.state[id] = v;
    try { localStorage.setItem(KEY, JSON.stringify(this.state)); } catch (e) { /* storage blocked */ }
    this.onChange?.(id);
  }

  // ---------------------------------------------------------------- menu page

  /** Fills the menu page: one button per mod, grouped, and the waypoints of this world. */
  renderMenu(el, player) {
    el.innerHTML = '';
    this.onWaypoints = () => this.renderMenu(el, player);
    let group = null;
    for (const m of MODS) {
      if (m.group !== group) {
        group = m.group;
        const h = document.createElement('div');
        h.className = 'mods-group';
        h.textContent = group;
        el.appendChild(h);
      }
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'mbtn mod-toggle';
      const label = () => {
        if (m.options) {
          const v = this.value(m.id);
          const o = m.options.find((x) => x[0] === v) ?? m.options[0];
          return `${m.name}: ${o[1]}`;
        }
        return `${m.name}: ${this.on(m.id) ? 'AN' : 'aus'}`;
      };
      b.textContent = label();
      b.classList.toggle('on', this.on(m.id));
      b.addEventListener('click', () => {
        if (m.options) {
          const i = m.options.findIndex((x) => x[0] === this.value(m.id));
          this.set(m.id, m.options[(i + 1) % m.options.length][0]);
        } else {
          this.set(m.id, !this.on(m.id));
        }
        b.textContent = label();
        b.classList.toggle('on', this.on(m.id));
      });
      el.appendChild(b);
    }
    // Waypoints of this world
    const h = document.createElement('div');
    h.className = 'mods-group';
    h.textContent = 'Wegpunkte in dieser Welt';
    el.appendChild(h);
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'mbtn mod-toggle';
    add.textContent = 'Wegpunkt hier setzen';
    add.addEventListener('click', () => { if (!this.on('waypoints')) this.set('waypoints', true); this.addWaypoint(player); });
    el.appendChild(add);
    this.points().forEach((w, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'mbtn mod-toggle';
      b.textContent = `✖ ${w.name}: ${Math.floor(w.x)} ${w.y} ${Math.floor(w.z)}`;
      b.title = 'Löschen';
      b.addEventListener('click', () => this.removeWaypoint(i));
      el.appendChild(b);
    });
  }

  // ---------------------------------------------------------------- input

  /** Clicks for CPS and the keystrokes display. */
  click(button) {
    if (button === 0 || button === 2) this.clicks[button === 0 ? 0 : 1].push(performance.now());
  }

  cps(i) {
    const now = performance.now();
    const list = this.clicks[i];
    while (list.length && now - list[0] > 1000) list.shift();
    return list.length;
  }

  /** An attack: reach for the display, the combo goes on. */
  attacked(distance) {
    this.reach = { d: distance, at: performance.now() };
  }

  /** The server confirmed a hit on the attacked mob/player. */
  hitConfirmed() {
    const now = performance.now();
    this.combo.n = now - this.combo.at < 3000 ? this.combo.n + 1 : 1;
    this.combo.at = now;
  }

  /** We got hurt: the combo is over. */
  hurt() {
    this.combo.n = 0;
  }

  zooming() { return this.on('zoom') && this.held.has('KeyC'); }
  freelooking() { return this.on('freelook') && (this.held.has('AltLeft') || this.held.has('AltRight')); }
  snapping() { return this.on('snaplook') && this.held.has('KeyV'); }

  /** Mouse movement while freelook is held turns only the camera. Returns true when it was used. */
  look(dx, dy, sens) {
    if (!this.freelooking()) return false;
    this.freeYaw -= dx * sens * 0.15;
    this.freePitch = Math.max(-90, Math.min(90, this.freePitch - dy * sens * 0.15));
    return true;
  }

  // ---------------------------------------------------------------- HUD

  /** Server data: armor (inv message) and potion effects (stats message). */
  setArmor(list) { this.armor = list || []; }
  setEffects(list) { this.effects = list || []; }

  /**
   * Per frame. ctx: { el, keys, fps, player, sky, palette, world, entities, dt }.
   * Text displays are redrawn a few times per second, the minimap twice per second.
   */
  updateHud(ctx) {
    this.freeLookReturn(ctx.dt);
    this.hudT -= ctx.dt;
    if (this.hudT > 0) return;
    this.hudT = 0.2;
    const el = ctx.el;
    const lines = [];
    if (this.on('fps')) lines.push(`${ctx.fps} FPS`);
    if (this.on('cps')) lines.push(`CPS ${this.cps(0)} | ${this.cps(1)}`);
    if (this.on('clock')) lines.push(new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) + ' Uhr');
    if (this.on('daycounter') && ctx.sky?.time !== undefined) lines.push(`Tag ${Math.floor(ctx.sky.time / 24000) + 1}`);
    if (this.on('reach') && this.reach && performance.now() - this.reach.at < 3000) lines.push(`Reichweite ${this.reach.d.toFixed(2)} m`);
    if (this.on('combo') && this.combo.n > 1 && performance.now() - this.combo.at < 3000) lines.push(`${this.combo.n} Combo`);
    if (this.on('memory') && performance.memory) lines.push(`Speicher ${Math.round(performance.memory.usedJSHeapSize / 1048576)} MB`);
    if (this.on('togglesprint') && ctx.player.sprinting) lines.push('Sprinten (umgeschaltet)');
    if (this.on('togglesneak') && ctx.keys.has('ShiftLeft')) lines.push('Schleichen (umgeschaltet)');
    if (this.on('potionhud')) {
      for (const [k, lvl, sec] of this.effects) {
        const time = sec < 0 ? '∞' : `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
        lines.push(`${EFFECT_NAMES[k] ?? prettyName(k)} ${ROMAN[lvl] ?? lvl + 1} ${time}`);
      }
    }
    const list = this.part(el, 'mod-list');
    const text = lines.map((l) => `<div>${esc(l)}</div>`).join('');
    if (list.dataset.html !== text) { list.innerHTML = text; list.dataset.html = text; }
    list.hidden = !lines.length;

    // Keystrokes
    const ks = this.part(el, 'mod-keys');
    ks.hidden = !this.on('keystrokes');
    ks.style.top = this.on('minimap') ? '150px' : '10px';   // under the minimap
    if (!ks.hidden) {
      if (!ks.firstChild) {
        ks.innerHTML = '<div class="k-row"><b data-k="KeyW">W</b></div><div class="k-row"><b data-k="KeyA">A</b><b data-k="KeyS">S</b><b data-k="KeyD">D</b></div>'
          + '<div class="k-row"><b data-k="m0" class="wide">LMB <small></small></b><b data-k="m1" class="wide">RMB <small></small></b></div>'
          + '<div class="k-row"><b data-k="Space" class="space">▬▬▬</b></div>';
      }
      for (const b of ks.querySelectorAll('b')) {
        const k = b.dataset.k;
        const down = k === 'm0' ? ctx.mouse[0] : k === 'm1' ? ctx.mouse[1] : ctx.keys.has(k);
        b.classList.toggle('down', !!down);
        if (k === 'm0' || k === 'm1') b.querySelector('small').textContent = this.cps(k === 'm0' ? 0 : 1);
      }
    }

    // Armor with durability
    const ar = this.part(el, 'mod-armor');
    ar.hidden = !this.on('armorhud') || !this.armor.some(Boolean);
    if (!ar.hidden) {
      const sig = JSON.stringify(this.armor);
      if (ar.dataset.sig !== sig) {
        ar.dataset.sig = sig;
        ar.innerHTML = '';
        for (const it of this.armor) {
          if (!it) continue;
          const row = document.createElement('div');
          const icon = iconCanvas(ctx.palette, it.k);
          icon.className = 'mod-icon';
          row.appendChild(icon);
          const t = document.createElement('span');
          t.textContent = it.d !== undefined ? Math.round((1 - it.d) * 100) + ' %' : '';
          if (it.d > 0.75) t.className = 'low';
          row.appendChild(t);
          ar.appendChild(row);
        }
      }
    }

    // Minimap
    const mm = this.part(el, 'mod-map', 'canvas');
    mm.hidden = !this.on('minimap');
    this.mapT -= 0.2;
    if (!mm.hidden && this.mapT <= 0) {
      this.mapT = 0.5;
      this.drawMap(mm, ctx);
    }
  }

  part(el, cls, tag = 'div') {
    let p = el.querySelector('.' + cls);
    if (!p) {
      p = document.createElement(tag);
      p.className = cls;
      el.appendChild(p);
    }
    return p;
  }

  /** Top view of 64 x 64 columns around the player in the map colors of the blocks, north up. */
  drawMap(canvas, { player, world, palette, entities }) {
    const N = 64, S = 2;
    canvas.width = canvas.height = N * S;
    const g = canvas.getContext('2d');
    const img = g.createImageData(N * S, N * S);
    const px = Math.floor(player.x), pz = Math.floor(player.z), top = Math.floor(player.y) + 24;
    for (let dz = 0; dz < N; dz++) {
      for (let dx = 0; dx < N; dx++) {
        const x = px - N / 2 + dx, z = pz - N / 2 + dz;
        let r = 20, gr = 20, b = 30;
        for (let y = top; y > top - 64; y--) {
          const id = world.getId(x, y, z);
          if (!id) continue;
          const shade = 0.75 + 0.25 * Math.max(0, Math.min(1, (y - player.y + 16) / 32));
          r = palette.rgb[id * 3] * 255 * shade; gr = palette.rgb[id * 3 + 1] * 255 * shade; b = palette.rgb[id * 3 + 2] * 255 * shade;
          break;
        }
        for (let sy = 0; sy < S; sy++) {
          for (let sx = 0; sx < S; sx++) {
            const o = ((dz * S + sy) * N * S + dx * S + sx) * 4;
            img.data[o] = r; img.data[o + 1] = gr; img.data[o + 2] = b; img.data[o + 3] = 255;
          }
        }
      }
    }
    g.putImageData(img, 0, 0);
    // Other players as white dots, the own position as a red arrow
    g.fillStyle = '#fff';
    for (const e of entities.map.values()) {
      if (e.type !== 'player') continue;
      const x = (e.x - player.x + N / 2) * S, y = (e.z - player.z + N / 2) * S;
      if (x >= 0 && y >= 0 && x < N * S && y < N * S) g.fillRect(x - 2, y - 2, 4, 4);
    }
    const c = N * S / 2;
    g.save();
    g.translate(c, c);
    g.rotate(-player.yaw * Math.PI / 180 + Math.PI);
    g.fillStyle = '#ff3030';
    g.beginPath(); g.moveTo(0, -6); g.lineTo(4, 5); g.lineTo(-4, 5); g.closePath(); g.fill();
    g.restore();
  }

  /** After freelook the camera turns back to where the player looks. */
  freeLookReturn(dt) {
    if (this.freelooking()) return;
    const k = Math.min(1, dt * 12);
    this.freeYaw -= this.freeYaw * k;
    this.freePitch -= this.freePitch * k;
    if (Math.abs(this.freeYaw) < 0.01) this.freeYaw = 0;
    if (Math.abs(this.freePitch) < 0.01) this.freePitch = 0;
  }
}

export const mods = new Mods();
