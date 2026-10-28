// Texture packs from Modrinth, right in the game menu: search, pick, the browser downloads the pack straight from
// Modrinth (the API and CDN allow it) and loads it as own textures (pack.importZip, kept in IndexedDB).
// Only resource packs: Java mods are program code for Minecraft itself and can't run in the browser.
import { pack } from './pack.js';

const API = 'https://api.modrinth.com/v2';
const GAME_VERSION = '26.3';

const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function short(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace('.', ',') + ' Mio.';
  if (n >= 1e3) return Math.round(n / 1e3) + ' Tsd.';
  return String(n);
}

async function getJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

/** The newest version for our Minecraft version (else the newest at all) and its main file. */
async function bestFile(projectId) {
  const versions = await getJson(`${API}/project/${projectId}/version`);
  const fits = versions.filter((v) => v.game_versions.includes(GAME_VERSION));
  const v = (fits.length ? fits : versions)[0];
  if (!v) return null;
  const file = v.files.find((f) => f.primary) || v.files[0];
  return file ? { url: file.url, size: file.size, name: v.name, fits: fits.length > 0 } : null;
}

/** Download with progress (0..1). */
async function download(url, size, onProgress) {
  const r = await fetch(url);
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const total = size || +r.headers.get('content-length') || 0;
  const reader = r.body.getReader();
  const parts = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    got += value.length;
    if (total) onProgress(got / total);
  }
  const bytes = new Uint8Array(got);
  let off = 0;
  for (const p of parts) { bytes.set(p, off); off += p.length; }
  return bytes;
}

export class ModrinthPacks {
  /** el: the menu page; toast(text) shows a short message. */
  constructor(el) {
    this.el = el;
    this.input = el.querySelector('.mr-search');
    this.list = el.querySelector('.mr-list');
    this.status = el.querySelector('.mr-status');
    this.busy = false;
    let timer = 0;
    this.input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => this.search(), 400); });
    // Letters typed here must not move the player
    this.input.addEventListener('keydown', (e) => { if (e.code !== 'Escape') e.stopPropagation(); });
    this.input.addEventListener('keyup', (e) => e.stopPropagation());
    el.querySelector('.mr-reset').addEventListener('click', async (e) => {
      const b = e.currentTarget;
      if (!b.dataset.sure) { b.dataset.sure = '1'; b.textContent = 'Wirklich? Nochmal klicken'; return; }
      delete b.dataset.sure;
      b.textContent = 'Standard-Texturen';
      await pack.clearLocal();
      this.say('Zurück zu den Standard-Texturen');
    });
  }

  open() {
    if (!this.loaded) { this.loaded = true; this.search(); }
  }

  say(text) {
    this.status.textContent = text;
  }

  async search() {
    const q = this.input.value.trim();
    const params = new URLSearchParams({
      query: q,
      facets: JSON.stringify([['project_type:resourcepack']]),
      limit: '20',
      index: q ? 'relevance' : 'downloads',
    });
    const asked = (this.asked = (this.asked || 0) + 1);
    this.say('Suche ...');
    let res;
    try {
      res = await getJson(`${API}/search?${params}`);
    } catch (e) {
      this.say('Modrinth ist gerade nicht erreichbar');
      return;
    }
    if (asked !== this.asked) return;   // an older search came back late
    this.say(res.total_hits ? `${res.total_hits} Texturpakete auf Modrinth` : 'Nichts gefunden');
    this.list.innerHTML = '';
    for (const h of res.hits) {
      const row = document.createElement('div');
      row.className = 'mr-item';
      const newest = h.versions?.[h.versions.length - 1] ?? '';
      row.innerHTML = `
        ${h.icon_url ? `<img src="${esc(h.icon_url)}" alt="" loading="lazy">` : '<span class="mr-noicon">🎨</span>'}
        <div class="mr-text">
          <b>${esc(h.title)}</b>
          <small>von ${esc(h.author)} · ${short(h.downloads)} Downloads · bis ${esc(newest)}</small>
          <span>${esc(h.description)}</span>
        </div>
        <button type="button" class="mbtn">Laden</button>`;
      row.querySelector('button').addEventListener('click', (e) => this.load(h, e.currentTarget));
      this.list.appendChild(row);
    }
  }

  async load(hit, button) {
    if (this.busy) return;
    this.busy = true;
    button.disabled = true;
    try {
      this.say(`${hit.title}: suche die passende Version ...`);
      const file = await bestFile(hit.project_id);
      if (!file) { this.say(`${hit.title}: keine Datei gefunden`); return; }
      const mb = (file.size / 1048576).toFixed(1).replace('.', ',');
      const bytes = await download(file.url, file.size, (p) => this.say(`${hit.title}: lade ${Math.round(p * 100)} % von ${mb} MB ...`));
      this.say(`${hit.title}: Texturen werden eingebaut ...`);
      const n = await pack.importZip(bytes);
      const note = file.fits ? '' : ` (gemacht für eine andere Minecraft-Version als ${GAME_VERSION})`;
      this.say(n ? `${hit.title}: ${n} Texturen geladen${note}` : `${hit.title}: keine Block- oder Item-Texturen darin`);
    } catch (e) {
      this.say(`${hit.title}: Laden fehlgeschlagen (${e.message})`);
    } finally {
      this.busy = false;
      button.disabled = false;
    }
  }
}
