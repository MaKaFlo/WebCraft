// Texture studio: make your own textures with ChatGPT (or any picture) and see them in the game.
// Flow: pick a block or item -> copy the prompt -> paste the picture from ChatGPT (Ctrl+V) -> done.
import { pack, canvasToDataUrl } from './pack.js';
import { atlas, TILE_PX } from './textures.js';
import { iconCanvas, prettyName } from './items.js';
import { KIND_CROSS } from './palette.js';

const STYLE_KEY = 'wc.texStyle';
const PRESETS = [
  ['Klassisch', 'klassische Pixel-Art wie in Klötzchen-Spielen, natürliche Farben, leichte Schattierung'],
  ['Bunt & süß', 'fröhliche, kräftige Bonbon-Farben, niedlich, weiche Schattierung, Pixel-Art'],
  ['Katzen-Welt 🐱', 'Pixel-Art mit kleinen Katzen-Details (Pfotenabdrücke, Katzenohren, Fischgräten), freundliche Farben'],
  ['Gruselig 🎃', 'dunkle, gruselige Halloween-Pixel-Art, Lila, Orange und Schwarz, leicht leuchtend'],
  ['Weltraum 🚀', 'Sci-Fi-Pixel-Art, Metall, Neon-Akzente in Cyan und Pink, futuristisch'],
];
const FACES = [
  ['', 'Alle Seiten'],
  ['_top', 'Oben'],
  ['_side', 'Seiten'],
  ['_bottom', 'Unten'],
];

const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Das Bild konnte nicht gelesen werden'));
    img.src = src;
  });
}

const dist = (d, i, c) => Math.abs(d[i] - c[0]) + Math.abs(d[i + 1] - c[1]) + Math.abs(d[i + 2] - c[2]);

/**
 * Turns a big picture (e.g. 1024x1024 from ChatGPT) into a small texture.
 * trim: cut away a plain border, removeBg: make the plain background see-through (for items).
 */
export function processImage(img, { size = 16, removeBg = false, trim = true } = {}) {
  const W = 256;
  const scale = Math.min(1, W / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale)), h = Math.max(1, Math.round(img.height * scale));
  let work = document.createElement('canvas');
  work.width = w; work.height = h;
  let ctx = work.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, w, h);
  let data = ctx.getImageData(0, 0, w, h);
  const d = data.data;

  // Background = corner color, if all four corners agree
  const corner = (x, y) => { const i = (y * w + x) * 4; return [d[i], d[i + 1], d[i + 2], d[i + 3]]; };
  const cs = [corner(0, 0), corner(w - 1, 0), corner(0, h - 1), corner(w - 1, h - 1)];
  const bg = [0, 1, 2].map((k) => Math.round(cs.reduce((s, c) => s + c[k], 0) / 4));
  const transparentCorners = cs.every((c) => c[3] < 20);
  const plain = transparentCorners || cs.every((c) => Math.abs(c[0] - bg[0]) + Math.abs(c[1] - bg[1]) + Math.abs(c[2] - bg[2]) < 36);
  const isBg = (i) => (transparentCorners ? d[i + 3] < 40 : dist(d, i, bg) < 60 || d[i + 3] < 40);

  if (removeBg && plain && !transparentCorners) {
    // Flood fill from the border, so the same color inside the item stays
    const seen = new Uint8Array(w * h);
    const stack = [];
    for (let x = 0; x < w; x++) stack.push(x, (h - 1) * w + x);
    for (let y = 0; y < h; y++) stack.push(y * w, y * w + w - 1);
    while (stack.length) {
      const p = stack.pop();
      if (seen[p]) continue;
      seen[p] = 1;
      const i = p * 4;
      if (!isBg(i)) continue;
      d[i + 3] = 0;
      const x = p % w, y = (p / w) | 0;
      if (x > 0) stack.push(p - 1);
      if (x < w - 1) stack.push(p + 1);
      if (y > 0) stack.push(p - w);
      if (y < h - 1) stack.push(p + w);
    }
    ctx.putImageData(data, 0, 0);
  }

  // Bounding box of the content (without plain border)
  let x0 = 0, y0 = 0, x1 = w - 1, y1 = h - 1;
  if (trim && plain) {
    const empty = (i) => (removeBg ? d[i + 3] < 40 : isBg(i));
    const rowEmpty = (y) => { for (let x = 0; x < w; x++) if (!empty((y * w + x) * 4)) return false; return true; };
    const colEmpty = (x) => { for (let y = 0; y < h; y++) if (!empty((y * w + x) * 4)) return false; return true; };
    while (y0 < y1 && rowEmpty(y0)) y0++;
    while (y1 > y0 && rowEmpty(y1)) y1--;
    while (x0 < x1 && colEmpty(x0)) x0++;
    while (x1 > x0 && colEmpty(x1)) x1--;
  }
  let cw = x1 - x0 + 1, ch = y1 - y0 + 1;
  // Square: items get padding (nothing cut off), blocks get cropped (fills the face)
  let side, sx, sy;
  if (removeBg) {
    side = Math.round(Math.max(cw, ch) * 1.08);
    sx = x0 - (side - cw) / 2; sy = y0 - (side - ch) / 2;
  } else {
    side = Math.min(cw, ch);
    sx = x0 + (cw - side) / 2; sy = y0 + (ch - side) / 2;
  }

  // Shrink in halves for a clean result
  let src = work, srcX = sx, srcY = sy, srcS = side;
  let cur = Math.max(size, 1);
  while (cur * 2 < srcS) cur *= 2;
  while (true) {
    const c = document.createElement('canvas');
    c.width = c.height = cur;
    const cctx = c.getContext('2d', { willReadFrequently: true });
    cctx.imageSmoothingEnabled = true;
    cctx.imageSmoothingQuality = 'high';
    cctx.drawImage(src, srcX, srcY, srcS, srcS, 0, 0, cur, cur);
    src = c; srcX = 0; srcY = 0; srcS = cur;
    if (cur <= size) break;
    cur = Math.max(size, cur / 2);
  }
  // Crisp edges: pixels are either solid or see-through
  const out = src.getContext('2d', { willReadFrequently: true });
  const px = out.getImageData(0, 0, size, size);
  for (let i = 3; i < px.data.length; i += 4) px.data[i] = removeBg ? (px.data[i] < 110 ? 0 : 255) : 255;
  out.putImageData(px, 0, 0);
  return src;
}

export class Studio {
  constructor({ el, send, getPalette, onOpenChange, isAdmin }) {
    this.el = el;
    this.send = send;
    this.getPalette = getPalette;
    this.onOpenChange = onOpenChange;
    this.isAdmin = isAdmin;
    this.isOpen = false;
    this.items = [];
    this.blocks = new Set();
    this.tab = 'block';
    this.search = '';
    this.selected = null;     // key
    this.face = '';
    this.size = 32;
    this.style = '';
    try { this.style = localStorage.getItem(STYLE_KEY) || PRESETS[0][1]; } catch (e) { this.style = PRESETS[0][1]; }
    this.build();
    // After the game has applied the new textures (its listener runs after ours)
    pack.onChange(() => setTimeout(() => { if (this.isOpen) { this.renderList(); this.renderDetail(); } }, 0));
    document.addEventListener('paste', (e) => this.onPaste(e));
  }

  setItems(list, blocks) {
    this.items = list || [];
    this.blocks = new Set(blocks || []);
    if (this.isOpen) this.renderList();
  }

  build() {
    this.el.innerHTML = `
      <div class="card studio-card">
        <div class="studio-head">
          <h2>🎨 Textur-Studio</h2>
          <span class="studio-hint">Bilder mit ChatGPT machen und hier einfügen. Nur WebCraft-Spieler sehen die Texturen.</span>
          <button class="mbtn studio-close" title="Schließen (Esc)">✕</button>
        </div>
        <div class="studio-style">
          <label>Stil für alle Texturen <span class="studio-presets"></span></label>
          <textarea class="st-style" rows="2"></textarea>
        </div>
        <div class="studio-main">
          <div class="studio-list">
            <div class="studio-tabs">
              <button data-tab="block">Blöcke</button><button data-tab="item">Items</button><button data-tab="own">Geändert</button>
            </div>
            <input class="st-search" placeholder="Suchen (z. B. stone, oak, sword) ..." autocomplete="off">
            <div class="st-grid"></div>
          </div>
          <div class="studio-detail"></div>
        </div>
        <div class="studio-foot">
          <span class="st-count"></span>
          <button class="mbtn st-export">⬇️ Paket herunterladen</button>
          <label class="mbtn st-import">⬆️ Paket laden<input type="file" accept=".zip" hidden></label>
          <button class="mbtn primary st-upload">🌍 Für alle auf den Server laden</button>
          <button class="mbtn danger st-clear">🗑️ Eigene löschen</button>
        </div>
      </div>`;
    const q = (s) => this.el.querySelector(s);
    q('.studio-close').addEventListener('click', () => this.close());
    this.styleEl = q('.st-style');
    this.styleEl.value = this.style;
    this.styleEl.addEventListener('input', () => {
      this.style = this.styleEl.value;
      try { localStorage.setItem(STYLE_KEY, this.style); } catch (e) { /* ignore */ }
      this.renderDetail();
    });
    const presets = q('.studio-presets');
    for (const [label, text] of PRESETS) {
      const b = document.createElement('button');
      b.className = 'chip';
      b.textContent = label;
      b.addEventListener('click', () => { this.styleEl.value = text; this.styleEl.dispatchEvent(new Event('input')); });
      presets.appendChild(b);
    }
    for (const b of this.el.querySelectorAll('[data-tab]')) {
      b.addEventListener('click', () => { this.tab = b.dataset.tab; this.renderList(); });
    }
    this.searchEl = q('.st-search');
    this.searchEl.addEventListener('input', () => { this.search = this.searchEl.value; this.renderList(); });
    this.gridEl = q('.st-grid');
    this.detailEl = q('.studio-detail');
    this.countEl = q('.st-count');
    q('.st-export').addEventListener('click', () => this.exportPack());
    q('.st-import input').addEventListener('change', (e) => this.importPack(e.target.files[0]));
    q('.st-upload').addEventListener('click', () => this.upload());
    q('.st-clear').addEventListener('click', async () => {
      if (!pack.local.size) return;
      if (!confirmInline(q('.st-clear'), 'Wirklich alle eigenen löschen?')) return;
      await pack.clearLocal();
      try { localStorage.removeItem('wc.modrinthLoaded'); } catch (e) { /* storage blocked */ }   // packs from the menu are gone too
      this.toast('Eigene Texturen gelöscht');
    });
    // Keys typed here must not reach the game
    this.el.addEventListener('keydown', (e) => {
      if (e.code === 'Escape') { e.preventDefault(); this.close(); }
      e.stopPropagation();
    });
    // Drag & drop a picture anywhere on the studio
    this.el.addEventListener('dragover', (e) => { e.preventDefault(); this.el.classList.add('drag'); });
    this.el.addEventListener('dragleave', () => this.el.classList.remove('drag'));
    this.el.addEventListener('drop', (e) => {
      e.preventDefault();
      this.el.classList.remove('drag');
      const file = [...(e.dataTransfer?.files || [])].find((f) => f.type.startsWith('image/'));
      if (file) this.useFile(file);
    });
  }

  open(key) {
    this.isOpen = true;
    this.el.hidden = false;
    if (key) {
      this.selected = key;
      this.tab = this.kindOf(key) === 'item' ? 'item' : 'block';
    }
    this.renderList();
    this.renderDetail();
    this.onOpenChange(true);
    this.searchEl.focus();
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.el.hidden = true;
    this.onOpenChange(false);
  }

  /** 'cube' (block with faces), 'cross' (plant, torch: one flat picture) or 'item'. */
  kindOf(key) {
    const P = this.getPalette();
    const id = P?.index.get(key);
    if (!this.blocks.has(key) || id === undefined || P.kind[id] === 0) return 'item';
    return P.kind[id] === KIND_CROSS ? 'cross' : 'cube';
  }

  isBlock(key) {
    return this.kindOf(key) === 'cube';
  }

  /** Path of the texture we edit for the selected entry and face. */
  path(key = this.selected, face = this.face) {
    const kind = this.kindOf(key);
    return kind === 'cube' ? 'block/' + key + face : kind === 'cross' ? 'block/' + key : 'item/' + key;
  }

  entries() {
    let keys;
    if (this.tab === 'own') {
      keys = [...new Set([...pack.local.keys()].map((p) => p.split('/')[1].replace(/_(top|side|bottom)$/, '')))];
      keys = keys.filter((k) => this.items.includes(k) || this.blocks.has(k));
    } else if (this.tab === 'block') {
      keys = this.items.filter((k) => this.kindOf(k) !== 'item');
    } else {
      keys = this.items.filter((k) => this.kindOf(k) === 'item');
    }
    const words = this.search.trim().toLowerCase().split(/[\s_]+/).filter(Boolean);
    if (words.length) keys = keys.filter((k) => words.every((w) => k.includes(w) || prettyName(k).toLowerCase().includes(w)));
    return keys;
  }

  hasOwn(key) {
    for (const p of pack.local.keys()) {
      const k = p.split('/')[1];
      if (k === key || k === key + '_top' || k === key + '_side' || k === key + '_bottom') return true;
    }
    return false;
  }

  renderList() {
    for (const b of this.el.querySelectorAll('[data-tab]')) b.classList.toggle('on', b.dataset.tab === this.tab);
    const P = this.getPalette();
    const keys = this.entries();
    this.gridEl.innerHTML = '';
    if (!this.items.length) { this.gridEl.textContent = 'Lade Liste vom Server ...'; return; }
    const shown = keys.slice(0, 240);
    for (const k of shown) {
      const b = document.createElement('button');
      b.className = 'st-entry' + (k === this.selected ? ' on' : '') + (this.hasOwn(k) ? ' own' : '');
      b.title = prettyName(k);
      const c = iconCanvas(P, k);
      const img = document.createElement('img');
      img.src = c.toDataURL();
      b.appendChild(img);
      b.addEventListener('click', () => {
        this.selected = k;
        if (!this.isBlock(k)) this.face = '';
        this.renderList();
        this.renderDetail();
      });
      this.gridEl.appendChild(b);
    }
    if (!keys.length) this.gridEl.innerHTML = '<div class="st-empty">Nichts gefunden</div>';
    else if (keys.length > shown.length) {
      const more = document.createElement('div');
      more.className = 'st-empty';
      more.textContent = `+ ${keys.length - shown.length} weitere, bitte suchen`;
      this.gridEl.appendChild(more);
    }
    this.countEl.textContent = `${pack.local.size} eigene · ${pack.server.size} vom Server`;
  }

  /** Current look of one texture path as a canvas (own, server or built-in). */
  faceLook(key, face) {
    const P = this.getPalette();
    const c = document.createElement('canvas');
    c.width = c.height = TILE_PX;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    const id = P?.index.get(key);
    if (id === undefined) return iconCanvas(P, key);
    const tile = face === '_top' ? P.tileTop[id] : face === '_bottom' ? P.tileBottom[id] : P.tileSide[id];
    const bit = face === '_top' ? 1 : face === '_bottom' ? 4 : 2;
    atlas.drawTileTo(ctx, tile, 0, 0, TILE_PX, TILE_PX);
    if (!(P.packed[id] & bit)) {
      const rgb = key === 'grass_block' && face !== '_top' ? P.dirtRgb : [P.rgb[id * 3], P.rgb[id * 3 + 1], P.rgb[id * 3 + 2]];
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = `rgb(${rgb.map((v) => Math.round(v * 255)).join(',')})`;
      ctx.fillRect(0, 0, TILE_PX, TILE_PX);
      ctx.globalCompositeOperation = 'destination-in';
      atlas.drawTileTo(ctx, tile, 0, 0, TILE_PX, TILE_PX);
    }
    return c;
  }

  prompt() {
    const key = this.selected;
    const name = prettyName(key);
    const style = this.style.trim() || PRESETS[0][1];
    if (this.kindOf(key) === 'cross') {
      return `Erstelle ein flaches Bild für mein eigenes Klötzchen-Spiel: "${name}" (wie "${key}" in Minecraft, aber als eigene Interpretation, nicht die Originalgrafik nachmachen). Im Spiel steht es wie eine Pflanze als flaches Bild in der Welt.
Wichtig: quadratisches Bild, Pixel-Art mit großen, deutlich sichtbaren Pixeln (wirkt wie 32×32 Pixel), von vorne gesehen, steht unten auf dem Bildrand, einfarbig weißer Hintergrund, keine Schrift, kein Rahmen.
Stil: ${style}`;
    }
    if (!this.isBlock(key)) {
      return `Erstelle ein Item-Symbol für mein eigenes Klötzchen-Spiel: "${name}" (wie "${key}" in Minecraft, aber als eigene Interpretation, nicht die Originalgrafik nachmachen).
Wichtig: quadratisches Bild, Pixel-Art mit großen, deutlich sichtbaren Pixeln (wirkt wie 32×32 Pixel), der Gegenstand einzeln, mittig und von vorne/schräg wie ein Inventar-Symbol, einfarbig weißer Hintergrund, kein Schatten auf dem Boden, keine Schrift, kein Rahmen.
Stil: ${style}`;
    }
    const where = { '': 'für alle Seiten des Blocks', _top: 'für die Oberseite des Blocks', _side: 'für die Seitenflächen des Blocks', _bottom: 'für die Unterseite des Blocks' }[this.face];
    return `Erstelle eine Block-Textur für mein eigenes Klötzchen-Spiel: "${name}" (wie "${key}" in Minecraft, aber als eigene Interpretation, nicht die Originalgrafik nachmachen), ${where}.
Wichtig: quadratisch, Pixel-Art mit großen, deutlich sichtbaren Pixeln (wirkt wie 32×32 Pixel), nahtlos kachelbar, füllt das ganze Bild bis zum Rand, flach und frontal von vorne (keine 3D-Ansicht, keine Perspektive, kein Würfel), kein Rahmen, keine Schrift.
Stil: ${style}`;
  }

  renderDetail() {
    const key = this.selected;
    const el = this.detailEl;
    if (!key) {
      el.innerHTML = `<div class="st-welcome">
        <h3>So geht's</h3>
        <ol>
          <li>Links einen Block oder ein Item aussuchen</li>
          <li><b>Prompt kopieren</b> und in ChatGPT einfügen</li>
          <li>In ChatGPT das Bild rechtsklicken → <b>Bild kopieren</b></li>
          <li>Hier <kbd>Strg</kbd>+<kbd>V</kbd> drücken (oder Bild hierher ziehen)</li>
        </ol>
        <p>Die Textur ist sofort im Spiel. Mit <b>Für alle auf den Server laden</b> sehen sie alle WebCraft-Spieler.</p>
      </div>`;
      return;
    }
    const block = this.isBlock(key);
    const path = this.path();
    const own = pack.isLocal(path);
    const fromServer = !own && pack.server.has(path);
    el.innerHTML = `
      <div class="st-title"><b>${esc(prettyName(key))}</b> <code>${esc(key)}</code></div>
      ${block ? `<div class="st-faces">${FACES.map(([f, l]) => `<button data-face="${f}" class="${f === this.face ? 'on' : ''}${pack.isLocal('block/' + key + f) ? ' own' : ''}">${l}</button>`).join('')}</div>` : ''}
      <div class="st-preview">
        <div class="st-now"><canvas class="st-cur"></canvas><span>${own ? 'Eigene Textur' : fromServer ? 'Vom Server' : 'Standard'}</span></div>
        ${block ? '<div class="cube-wrap"><div class="cube"><div class="f top"></div><div class="f bottom"></div><div class="f front"></div><div class="f back"></div><div class="f left"></div><div class="f right"></div></div></div>'
          : '<div class="st-item"><canvas class="st-icon"></canvas></div>'}
      </div>
      <div class="st-step"><b>1.</b> Prompt für ChatGPT <button class="mbtn st-copy">📋 Kopieren</button></div>
      <textarea class="st-prompt" rows="5"></textarea>
      <div class="st-step"><b>2.</b> Bild aus ChatGPT kopieren, dann hier <kbd>Strg</kbd>+<kbd>V</kbd></div>
      <label class="st-drop">🖼️ Strg+V, Bild hierher ziehen oder <u>Datei wählen</u><input type="file" accept="image/*" hidden></label>
      <div class="st-opts">
        <label>Größe <select class="st-size"><option value="16">16 × 16</option><option value="32">32 × 32</option></select></label>
        <label><input type="checkbox" class="st-bg" ${block ? '' : 'checked'}> Hintergrund entfernen</label>
        <label><input type="checkbox" class="st-trim" checked> Rand abschneiden</label>
      </div>
      ${own ? '<button class="mbtn st-reset">↩️ Zurück zum Standard</button>' : ''}`;
    const q = (s) => el.querySelector(s);
    for (const b of el.querySelectorAll('[data-face]')) b.addEventListener('click', () => { this.face = b.dataset.face; this.renderDetail(); });
    q('.st-prompt').value = this.prompt();
    q('.st-copy').addEventListener('click', async () => {
      const text = q('.st-prompt').value;
      try { await navigator.clipboard.writeText(text); this.toast('Prompt kopiert, jetzt in ChatGPT einfügen'); } catch (e) {
        q('.st-prompt').select();
        this.toast('Bitte Strg+C drücken');
      }
    });
    q('.st-size').value = String(this.size);
    q('.st-size').addEventListener('change', (e) => { this.size = +e.target.value; });
    q('.st-drop input').addEventListener('change', (e) => { if (e.target.files[0]) this.useFile(e.target.files[0]); });
    q('.st-reset')?.addEventListener('click', async () => { await pack.setLocal(path, null); this.toast('Standard wiederhergestellt'); });

    // Current texture, big and pixelated
    const cur = q('.st-cur');
    const look = block ? this.faceLook(key, this.face || '_side') : iconCanvas(this.getPalette(), key);
    cur.width = look.width; cur.height = look.height;
    cur.getContext('2d').drawImage(look, 0, 0);
    if (block) {
      const faces = { top: this.faceLook(key, '_top'), bottom: this.faceLook(key, '_bottom') };
      const side = this.faceLook(key, '_side');
      for (const f of el.querySelectorAll('.cube .f')) {
        const name = f.classList[1];
        const c = faces[name] || side;
        f.style.backgroundImage = `url(${c.toDataURL()})`;
      }
    } else {
      const icon = q('.st-icon');
      const c = iconCanvas(this.getPalette(), key);
      icon.width = c.width; icon.height = c.height;
      icon.getContext('2d').drawImage(c, 0, 0);
    }
  }

  onPaste(e) {
    if (!this.isOpen) return;
    const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'));
    if (!item) {
      if (e.target?.tagName !== 'TEXTAREA' && e.target?.tagName !== 'INPUT') this.toast('Kein Bild in der Zwischenablage. In ChatGPT: Rechtsklick aufs Bild → Bild kopieren');
      return;
    }
    e.preventDefault();
    this.useFile(item.getAsFile());
  }

  async useFile(file) {
    if (!this.selected) { this.toast('Bitte zuerst links einen Block oder ein Item auswählen'); return; }
    const url = URL.createObjectURL(file);
    try {
      const img = await loadImage(url);
      const removeBg = this.detailEl.querySelector('.st-bg')?.checked ?? false;
      const trim = this.detailEl.querySelector('.st-trim')?.checked ?? true;
      const c = processImage(img, { size: this.size, removeBg, trim });
      const path = this.path();
      await pack.setLocal(path, canvasToDataUrl(c));
      this.toast(`✅ ${prettyName(this.selected)} hat jetzt deine Textur`);
    } catch (err) {
      this.toast(err.message || 'Das Bild ging nicht');
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  exportPack() {
    const bytes = pack.exportZip();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([bytes], { type: 'application/zip' }));
    a.download = 'texturen.zip';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  async importPack(file) {
    if (!file) return;
    try {
      const n = await pack.importZip(new Uint8Array(await file.arrayBuffer()));
      this.toast(`${n} Texturen geladen`);
    } catch (e) {
      this.toast('Das ist kein gültiges Texturenpaket');
    }
  }

  upload() {
    // Built-in textures are in every browser anyway: only the server's and your own go up
    const bytes = pack.exportZip(false, true);
    if (bytes.length > 16 * 1024 * 1024) { this.toast('Das Paket ist zu groß (höchstens 16 MB)'); return; }
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    this.send({ t: 'pack_upload', zip: btoa(s) });
    this.toast('Wird hochgeladen ... (geht nur als OP)');
  }

  toast(text) {
    let t = this.el.querySelector('.st-toast');
    if (!t) {
      t = document.createElement('div');
      t.className = 'st-toast';
      this.el.querySelector('.studio-card').appendChild(t);
    }
    t.textContent = text;
    t.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
  }
}

/** Two-click confirm on a button (no browser dialogs). */
function confirmInline(button, question) {
  if (button.dataset.armed) {
    delete button.dataset.armed;
    button.textContent = button.dataset.label;
    return true;
  }
  button.dataset.label = button.textContent;
  button.dataset.armed = '1';
  button.textContent = question;
  setTimeout(() => {
    if (button.dataset.armed) { delete button.dataset.armed; button.textContent = button.dataset.label; }
  }, 3000);
  return false;
}
