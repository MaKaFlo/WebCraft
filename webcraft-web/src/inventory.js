// Hotbar and the inventory / container screen. The server owns all items; we only send clicks.
import { iconFor, prettyName } from './items.js';

const escapeHtml = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

/**
 * Screen layout per menu type. Slot numbers are the server's menu slots.
 * top: rows of the container part, player: main inventory + hotbar.
 */
function layoutFor(type, count) {
  const playerFrom = (start) => ({ main: range(start, start + 26), hotbar: range(start + 27, start + 35) });
  if (type === 'player') {
    return {
      kind: 'craft', grid: [1, 2, 3, 4], cols: 2, result: 0,
      armor: [5, 6, 7, 8], offhand: 45, ...playerFrom(9),
    };
  }
  if (type === 'crafting') return { kind: 'craft', grid: range(1, 9), cols: 3, result: 0, ...playerFrom(10) };
  if (/furnace|smoker/.test(type)) return { kind: 'furnace', input: 0, fuel: 1, result: 2, ...playerFrom(3) };
  if (type === 'brewing_stand') return { kind: 'brewing', bottles: [0, 1, 2], ingredient: 3, fuel: 4, ...playerFrom(5) };
  if (type === 'enchantment') return { kind: 'enchant', inputs: [0, 1], ...playerFrom(2) };
  if (type === 'merchant') return { kind: 'merchant', inputs: [0, 1], result: 2, ...playerFrom(3) };
  if (type === 'anvil') return { kind: 'io', inputs: [0, 1], result: 2, rename: true, ...playerFrom(3) };
  if (type === 'grindstone' || type === 'cartography_table') return { kind: 'io', inputs: [0, 1], result: 2, ...playerFrom(3) };
  if (type === 'smithing') return { kind: 'io', inputs: [0, 1, 2], result: 3, ...playerFrom(4) };
  if (type === 'stonecutter') return { kind: 'stonecutter', input: 0, result: 1, ...playerFrom(2) };
  if (type === 'loom') return { kind: 'loom', inputs: [0, 1, 2], result: 3, ...playerFrom(4) };
  if (type === 'beacon') return { kind: 'beacon', payment: 0, ...playerFrom(1) };
  const top = Math.max(0, count - 36);
  let cols = 9;
  if (type === 'generic_3x3' || type === 'crafter_3x3') cols = 3;
  else if (type === 'hopper') cols = 5;
  return { kind: 'grid', top: range(0, top - 1), cols, ...playerFrom(top) };
}

// Beacon effects (keys from the server) and banner patterns, in German
const EFFECTS = {
  speed: '⚡ Schnelligkeit', haste: '⛏️ Eile', resistance: '🛡️ Resistenz', jump_boost: '🐇 Sprungkraft',
  strength: '💪 Stärke', regeneration: '❤️ Regeneration',
};
const PATTERNS = {
  base: 'Hintergrund', square_bottom_left: 'Ecke unten links', square_bottom_right: 'Ecke unten rechts',
  square_top_left: 'Ecke oben links', square_top_right: 'Ecke oben rechts', stripe_bottom: 'Balken unten',
  stripe_top: 'Balken oben', stripe_left: 'Pfahl links', stripe_right: 'Pfahl rechts', stripe_center: 'Pfahl',
  stripe_middle: 'Balken', stripe_downright: 'Schrägbalken', stripe_downleft: 'Schräglinksbalken',
  small_stripes: 'Gestreift', cross: 'Andreaskreuz', straight_cross: 'Kreuz', triangle_bottom: 'Spitze unten',
  triangle_top: 'Spitze oben', triangles_bottom: 'Zacken unten', triangles_top: 'Zacken oben',
  diagonal_left: 'Schräg links', diagonal_right: 'Schräg rechts', diagonal_up_left: 'Schräg links unten',
  diagonal_up_right: 'Schräg rechts unten', circle: 'Kugel', rhombus: 'Raute', half_vertical: 'Hälfte links',
  half_horizontal: 'Hälfte oben', half_vertical_right: 'Hälfte rechts', half_horizontal_bottom: 'Hälfte unten',
  border: 'Bord', curly_border: 'Gezackter Bord', gradient: 'Verlauf', gradient_up: 'Verlauf von unten',
  bricks: 'Mauer', globe: 'Globus', creeper: 'Creeper', skull: 'Schädel', flower: 'Blume', mojang: 'Mojang',
  piglin: 'Rüssel', flow: 'Fluss', guster: 'Böe',
};
const patternName = (k) => PATTERNS[k] || prettyName(k);
const TITLES = {
  Stonecutter: 'Steinsäge', Loom: 'Webstuhl', Beacon: 'Leuchtfeuer', 'Crafting Table': 'Werkbank', Crafting: 'Werkbank',
  Furnace: 'Ofen', 'Blast Furnace': 'Schmelzofen', Smoker: 'Räucherofen', 'Brewing Stand': 'Braustand',
  Anvil: 'Amboss', Grindstone: 'Schleifstein', 'Smithing Table': 'Schmiedetisch', 'Cartography Table': 'Kartentisch',
  Chest: 'Truhe', 'Large Chest': 'Große Truhe', Barrel: 'Fass', 'Ender Chest': 'Endertruhe', Hopper: 'Trichter',
  Dispenser: 'Werfer', Dropper: 'Spender', 'Shulker Box': 'Shulker-Kiste', 'Enchant': 'Zaubertisch',
};

function slotElement(index) {
  const el = document.createElement('div');
  el.className = 'slot';
  el.dataset.slot = index;
  el.innerHTML = '<img alt=""><span class="count"></span><span class="dura"><i></i></span>';
  return el;
}

function fillSlot(el, item, palette) {
  const img = el.querySelector('img');
  const count = el.querySelector('.count');
  const dura = el.querySelector('.dura');
  if (!item) {
    img.removeAttribute('src');
    img.style.visibility = 'hidden';
    count.textContent = '';
    dura.style.display = 'none';
    delete el.dataset.tip;
    el.classList.remove('ench');
    return;
  }
  img.src = iconFor(palette, item.k);
  img.style.visibility = 'visible';
  count.textContent = item.c > 1 ? item.c : '';
  // Shown by our own tooltip (the browser's title tooltip is slow and vanishes when slots refresh)
  el.dataset.tip = prettyName(item.k) + (item.e ? '\n✨ Verzaubert' : '')
    + (item.d ? `\nHaltbarkeit: ${Math.round((1 - item.d) * 100)} %` : '');
  el.classList.toggle('ench', !!item.e);
  if (item.d) {
    dura.style.display = 'block';
    const left = 1 - item.d;
    dura.firstChild.style.width = Math.round(left * 100) + '%';
    dura.firstChild.style.background = left > 0.5 ? '#5ad15a' : left > 0.2 ? '#f2c94c' : '#e2483d';
  } else {
    dura.style.display = 'none';
  }
}

export class Inventory {
  constructor({ hotbarEl, offhandEl, screenEl, nameEl, send, getPalette, onOpenChange }) {
    this.send = send;
    this.getPalette = getPalette;
    this.onOpenChange = onOpenChange;
    this.hot = new Array(9).fill(null);
    this.off = null;
    this.selected = 0;
    this.open = false;
    this.menu = null;            // last menu message from the server
    this.layoutKey = '';
    this.slotEls = new Map();    // menu slot -> element
    this.hoverSlot = -1;
    this.nameEl = nameEl;
    this.nameTimer = 0;
    this.creative = false;       // creative mode: show the item picker
    this.itemList = null;        // all item keys (asked from the server once)
    this.search = '';

    this.hotbar = [];
    for (let i = 0; i < 9; i++) {
      const el = slotElement(i);
      hotbarEl.appendChild(el);
      this.hotbar.push(el);
    }
    this.offhandEl = slotElement(-1);
    offhandEl.appendChild(this.offhandEl);

    this.screen = screenEl;
    this.body = screenEl.querySelector('.inv-body');
    this.titleEl = screenEl.querySelector('.inv-title');
    // Clicking next to the window drops what you carry
    screenEl.addEventListener('mousedown', (e) => {
      if (e.target === screenEl) this.clickSlot(-999, e.button === 2 ? 1 : 0, 'pickup');
    });
    screenEl.addEventListener('contextmenu', (e) => e.preventDefault());

    this.cursorEl = document.createElement('img');
    this.cursorEl.className = 'cursor-item';
    this.cursorCount = document.createElement('span');
    this.cursorCount.className = 'cursor-count';
    document.body.append(this.cursorEl, this.cursorCount);

    // Item names when the mouse is over a slot (also armor, fuel, trades ...), like Minecraft's tooltip
    this.tipEl = document.createElement('div');
    this.tipEl.className = 'item-tip';
    this.tipEl.hidden = true;
    document.body.appendChild(this.tipEl);
    this.tipTarget = null;
    screenEl.addEventListener('mouseover', (e) => {
      const el = e.target.closest('[data-tip], [title]');
      if (el && el.hasAttribute('title')) {
        el.dataset.tip = el.title;
        el.removeAttribute('title');
      }
      this.tipTarget = el && screenEl.contains(el) ? el : null;
      this.refreshTip();
    });
    screenEl.addEventListener('mouseleave', () => { this.tipTarget = null; this.refreshTip(); });
    document.addEventListener('mousemove', (e) => {
      this.tipEl.style.left = e.clientX + 14 + 'px';
      this.tipEl.style.top = e.clientY - 30 + 'px';
      this.cursorEl.style.left = e.clientX - 20 + 'px';
      this.cursorEl.style.top = e.clientY - 20 + 'px';
      this.cursorCount.style.left = e.clientX + 6 + 'px';
      this.cursorCount.style.top = e.clientY + 6 + 'px';
    });
  }

  /** Show the name of the hovered item (hidden while you carry something, like in Minecraft). */
  refreshTip() {
    const el = this.tipTarget;
    const text = this.open && el && el.isConnected ? el.dataset.tip : '';
    const carrying = this.cursorEl.style.display === 'block';
    this.tipEl.hidden = !text || carrying;
    if (text) this.tipEl.textContent = text;
  }

  clickSlot(slot, btn, mode) {
    this.send({ t: 'click', slot, btn, mode });
  }

  /** Keys while the screen is open: 1-9 swaps the hovered slot with the hotbar, Q throws it. */
  handleKey(e) {
    if (this.hoverSlot < 0) return false;
    if (e.code.startsWith('Digit') && e.code !== 'Digit0') {
      this.clickSlot(this.hoverSlot, Number(e.code.slice(5)) - 1, 'swap');
      return true;
    }
    if (e.code === 'KeyF') { this.clickSlot(this.hoverSlot, 40, 'swap'); return true; }
    if (e.code === 'KeyQ') { this.clickSlot(this.hoverSlot, e.ctrlKey || e.shiftKey ? 1 : 0, 'throw'); return true; }
    // Creative: Delete clears the hovered slot
    if (this.creative && (e.code === 'Delete' || e.code === 'Backspace') && this.menu?.type === 'player') {
      this.send({ t: 'creative', slot: this.hoverSlot, k: '' });
      return true;
    }
    return false;
  }

  // ------------------------------------------------------------------ messages from the server

  updateHotbar(msg) {
    const oldItem = this.hot[this.selected];
    const oldSel = this.selected;
    this.hot = msg.hot;
    this.off = msg.off;
    this.selected = msg.sel;
    this.renderHotbar();
    if (oldSel !== this.selected || this.hot[this.selected]?.k !== oldItem?.k) this.showName();
  }

  updateMenu(msg) {
    if (!msg.open) {
      if (this.open) this.setOpen(false, false);
      return;
    }
    this.menu = msg;
    if (!this.open) this.setOpen(true, false);
    this.renderMenu();
  }

  // ------------------------------------------------------------------ rendering

  renderHotbar() {
    const palette = this.getPalette();
    for (let i = 0; i < 9; i++) {
      fillSlot(this.hotbar[i], this.hot[i], palette);
      this.hotbar[i].classList.toggle('selected', i === this.selected);
    }
    fillSlot(this.offhandEl, this.off, palette);
    this.offhandEl.parentElement.style.visibility = this.off ? 'visible' : 'hidden';
  }

  buildScreen(layout) {
    this.body.innerHTML = '';
    this.slotEls.clear();
    const make = (index, extraClass) => {
      const el = slotElement(index);
      if (extraClass) el.classList.add(extraClass);
      el.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.clickSlot(index, e.button === 2 ? 1 : 0, e.shiftKey ? 'quick' : 'pickup');
      });
      el.addEventListener('mouseenter', () => { this.hoverSlot = index; });
      el.addEventListener('mouseleave', () => { if (this.hoverSlot === index) this.hoverSlot = -1; });
      this.slotEls.set(index, el);
      return el;
    };
    const grid = (slots, cols, cls = '') => {
      const g = document.createElement('div');
      g.className = 'grid ' + cls;
      g.style.gridTemplateColumns = `repeat(${cols}, var(--slot))`;
      for (const s of slots) g.appendChild(make(s));
      return g;
    };
    const arrow = () => {
      const a = document.createElement('div');
      a.className = 'craft-arrow';
      a.textContent = '➡️';
      return a;
    };

    const progressArrow = () => {
      const a = document.createElement('div');
      a.className = 'craft-arrow progress';
      a.innerHTML = '➡️<i></i>';
      return a;
    };
    this.extra = null;
    const top = document.createElement('div');
    top.className = 'inv-top';
    if (layout.kind === 'craft') {
      if (layout.armor) {
        const armor = grid(layout.armor, 1, 'armor');
        armor.title = 'Rüstung';
        top.appendChild(armor);
        const off = grid([layout.offhand], 1, 'offhand');
        off.title = 'Zweite Hand (F)';
        top.appendChild(off);
      }
      top.appendChild(grid(layout.grid, layout.cols));
      top.appendChild(arrow());
      top.appendChild(grid([layout.result], 1, 'result'));
    } else if (layout.kind === 'furnace') {
      const col = document.createElement('div');
      col.className = 'furnace-col';
      col.appendChild(grid([layout.input], 1));
      const fire = document.createElement('div');
      fire.className = 'fire';
      fire.innerHTML = '🔥<i></i>';
      col.appendChild(fire);
      col.appendChild(grid([layout.fuel], 1));
      top.appendChild(col);
      const a = progressArrow();
      top.appendChild(a);
      top.appendChild(grid([layout.result], 1, 'result'));
      this.extra = { fire, arrow: a };
    } else if (layout.kind === 'brewing') {
      // Brewing stand: ingredient on top, three bottles below, blaze powder on the left
      const fuelCol = document.createElement('div');
      fuelCol.className = 'furnace-col';
      fuelCol.appendChild(grid([layout.fuel], 1));
      const fuelBar = document.createElement('div');
      fuelBar.className = 'bar-h';
      fuelBar.innerHTML = '<i></i>';
      fuelBar.title = 'Lohenstaub';
      fuelCol.appendChild(fuelBar);
      const mid = document.createElement('div');
      mid.className = 'furnace-col';
      mid.appendChild(grid([layout.ingredient], 1));
      const bubbles = document.createElement('div');
      bubbles.className = 'brew-progress';
      bubbles.innerHTML = '🫧<i></i>';
      mid.appendChild(bubbles);
      mid.appendChild(grid(layout.bottles, 3));
      top.append(fuelCol, mid);
      this.extra = { fuelBar, bubbles };
    } else if (layout.kind === 'enchant') {
      top.appendChild(grid(layout.inputs, 2));
      const opts = document.createElement('div');
      opts.className = 'menu-options';
      const buttons = [0, 1, 2].map((i) => {
        const b = document.createElement('button');
        b.className = 'opt';
        b.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); this.send({ t: 'button', id: i }); });
        opts.appendChild(b);
        return b;
      });
      top.appendChild(opts);
      this.extra = { enchant: buttons };
    } else if (layout.kind === 'merchant') {
      const list = document.createElement('div');
      list.className = 'trade-list';
      top.appendChild(list);
      const box = document.createElement('div');
      box.className = 'trade-box';
      box.appendChild(grid(layout.inputs, 2));
      box.appendChild(arrow());
      box.appendChild(grid([layout.result], 1, 'result'));
      top.appendChild(box);
      this.extra = { trades: list, tradesKey: '' };
    } else if (layout.kind === 'stonecutter') {
      // Stone in, choose what to cut, take the result
      top.appendChild(grid([layout.input], 1));
      const choices = document.createElement('div');
      choices.className = 'choice-grid';
      top.appendChild(choices);
      top.appendChild(arrow());
      top.appendChild(grid([layout.result], 1, 'result'));
      this.extra = { cut: choices, cutKey: '' };
    } else if (layout.kind === 'loom') {
      // Banner, dye and (optional) pattern item; choose a pattern, take the result
      const col = document.createElement('div');
      col.className = 'furnace-col';
      col.appendChild(grid([layout.inputs[0], layout.inputs[1]], 2));
      col.appendChild(grid([layout.inputs[2]], 1));
      top.appendChild(col);
      const list = document.createElement('div');
      list.className = 'menu-options pattern-list';
      top.appendChild(list);
      top.appendChild(arrow());
      top.appendChild(grid([layout.result], 1, 'result'));
      this.extra = { patterns: list, patternsKey: '' };
    } else if (layout.kind === 'beacon') {
      // Effects by pyramid level, payment (iron, gold, emerald, diamond, netherite ingot) and "Fertig"
      const opts = document.createElement('div');
      opts.className = 'beacon';
      const pay = document.createElement('div');
      pay.className = 'furnace-col';
      const hint = document.createElement('small');
      hint.textContent = 'Bezahlen: Eisen, Gold, Smaragd, Diamant oder Netherit';
      pay.appendChild(grid([layout.payment], 1));
      pay.appendChild(hint);
      const done = document.createElement('button');
      done.className = 'opt done';
      done.textContent = '✔️ Fertig';
      done.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const b = this.extra?.beacon;
        if (!b || !b.primary) return;
        this.send({ t: 'beacon', p: b.primary, s: b.secondary || '' });
        this.setOpen(false);
      });
      pay.appendChild(done);
      top.append(opts, pay);
      this.extra = { beacon: { el: opts, done, key: '', primary: null, secondary: null } };
    } else if (layout.kind === 'io') {
      top.appendChild(grid(layout.inputs, layout.inputs.length));
      if (layout.result !== undefined) {
        top.appendChild(arrow());
        top.appendChild(grid([layout.result], 1, 'result'));
      }
      if (layout.rename) {
        // Anvil: type a new name
        const input = document.createElement('input');
        input.className = 'rename';
        input.placeholder = 'Neuer Name ...';
        input.maxLength = 50;
        input.addEventListener('keydown', (e) => { if (e.code !== 'Escape') e.stopPropagation(); });
        input.addEventListener('input', () => this.send({ t: 'rename', name: input.value }));
        const cost = document.createElement('div');
        cost.className = 'anvil-cost';
        const col = document.createElement('div');
        col.className = 'furnace-col';
        col.append(input, cost);
        top.appendChild(col);
        this.extra = { rename: input, cost };
      }
    } else if (layout.top.length) {
      top.appendChild(grid(layout.top, layout.cols));
    }
    this.body.appendChild(top);
    const label = document.createElement('h3');
    label.textContent = 'Inventar';
    this.body.appendChild(label);
    this.body.appendChild(grid(layout.main, 9));
    this.body.appendChild(grid(layout.hotbar, 9, 'bar'));
    if (layout.creative) {
      // Inventory on the left, item picker on the right
      const left = document.createElement('div');
      left.className = 'inv-left';
      left.append(...this.body.childNodes);
      this.body.appendChild(left);
      this.buildCreative();
    }
    this.body.classList.toggle('with-creative', !!layout.creative);
  }

  // ------------------------------------------------------------------ creative item picker

  setItemList(list) {
    this.itemList = list;
    if (this.pickerGrid) this.renderPicker();
  }

  buildCreative() {
    const box = document.createElement('div');
    box.className = 'creative';
    box.innerHTML = '<h3>Kreativ-Items</h3><input class="creative-search" placeholder="Suchen (z. B. diamant, sword) ..." autocomplete="off">'
      + '<div class="creative-help">Klick: 1 Stück in den gewählten Hotbar-Platz · Shift+Klick: ganzer Stapel · Entf: Platz unter der Maus leeren</div>'
      + '<div class="creative-grid"></div>';
    const input = box.querySelector('input');
    input.value = this.search;
    input.addEventListener('input', () => { this.search = input.value; this.renderPicker(); });
    // Keys typed into the search box must not move the player or close the screen
    input.addEventListener('keydown', (e) => { if (e.code !== 'Escape') e.stopPropagation(); });
    this.pickerGrid = box.querySelector('.creative-grid');
    this.body.appendChild(box);
    if (!this.itemList) this.send({ t: 'items' });
    this.renderPicker();
  }

  renderPicker() {
    const g = this.pickerGrid;
    if (!g) return;
    g.innerHTML = '';
    if (!this.itemList) { g.textContent = 'Lade Items ...'; return; }
    const q = this.search.trim().toLowerCase().replace(/\s+/g, '_');
    const words = q ? q.split('_') : [];
    const palette = this.getPalette();
    const matches = this.itemList.filter((k) => {
      if (!words.length) return true;
      const name = (k + ' ' + prettyName(k)).toLowerCase();
      return words.every((w) => name.includes(w));
    });
    const shown = matches.slice(0, 270);
    for (const k of shown) {
      const el = slotElement(-1);
      fillSlot(el, { k, c: 1 }, palette);
      el.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.send({ t: 'creative', slot: 36 + this.selected, k, c: e.shiftKey || e.button === 1 ? 64 : 1 });
      });
      g.appendChild(el);
    }
    if (matches.length > shown.length) {
      const more = document.createElement('div');
      more.className = 'creative-more';
      more.textContent = `+ ${matches.length - shown.length} weitere, bitte suchen`;
      g.appendChild(more);
    }
  }

  /** Icons changed (new textures). */
  refreshIcons() {
    this.renderHotbar();
    this.layoutKey = '';
    this.renderMenu();
  }

  setCreative(on) {
    if (on === this.creative) return;
    this.creative = on;
    this.layoutKey = '';
    this.renderMenu();
  }

  renderMenu() {
    if (!this.open || !this.menu) return;
    const m = this.menu;
    const creative = this.creative && m.type === 'player';
    const key = m.type + ':' + m.slots.length + ':' + creative;
    if (key !== this.layoutKey) {
      this.layoutKey = key;
      this.pickerGrid = null;
      this.buildScreen({ ...layoutFor(m.type, m.slots.length), creative });
    }
    // The server's English default names in German (custom names of plugins/mods stay as they are)
    const title = TITLES[m.title] || m.title;
    this.titleEl.textContent = m.type === 'player' ? 'Inventar & Crafting' : (title || 'Behälter');
    this.updateExtras(m);
    const palette = this.getPalette();
    for (const [index, el] of this.slotEls) fillSlot(el, m.slots[index] ?? null, palette);
    if (m.carried) {
      this.cursorEl.src = iconFor(palette, m.carried.k);
      this.cursorEl.style.display = 'block';
      this.cursorCount.textContent = m.carried.c > 1 ? m.carried.c : '';
      this.cursorCount.style.display = 'block';
    } else {
      this.cursorEl.style.display = 'none';
      this.cursorCount.style.display = 'none';
    }
    this.refreshTip();
  }

  /** Progress bars, enchanting options, trades ... from the menu data of the server. */
  updateExtras(m) {
    const x = this.extra;
    if (!x) return;
    const d = m.data || [];
    const pct = (v) => Math.max(0, Math.min(100, Math.round(v * 100))) + '%';
    if (x.fire) {
      // furnace data: 0 burn time left, 1 burn time total, 2 cook progress, 3 cook time total
      x.fire.querySelector('i').style.height = pct(d[1] ? d[0] / d[1] : 0);
      x.fire.classList.toggle('off', !(d[0] > 0));
      x.arrow.querySelector('i').style.width = pct(d[3] ? d[2] / d[3] : 0);
    }
    if (x.bubbles) {
      // brewing data: 0 brew time left (400 = start), 1 fuel (0..20)
      x.bubbles.querySelector('i').style.height = pct(d[0] ? 1 - d[0] / 400 : 0);
      x.fuelBar.querySelector('i').style.width = pct((d[1] || 0) / 20);
    }
    if (x.enchant) {
      const offers = m.trades?.enchant || [];
      x.enchant.forEach((b, i) => {
        const o = offers[i] || { cost: 0, name: '' };
        b.disabled = !o.cost;
        b.innerHTML = o.cost ? `<span>${escapeHtml(o.name || 'Verzauberung')}</span><b>${o.cost}</b><small>${i + 1} Lapis</small>` : '&nbsp;';
      });
    }
    if (x.trades && m.trades?.list) {
      const key = JSON.stringify(m.trades.list);
      if (key !== x.tradesKey) {
        x.tradesKey = key;
        const palette = this.getPalette();
        x.trades.innerHTML = '';
        m.trades.list.forEach((t, i) => {
          const b = document.createElement('button');
          b.className = 'trade' + (t.out ? ' out' : '');
          const icon = (it) => (it ? `<span class="ti"><img src="${iconFor(palette, it.k)}">${it.c > 1 ? `<em>${it.c}</em>` : ''}</span>` : '<span class="ti"></span>');
          b.innerHTML = icon(t.a) + icon(t.b) + '<span class="ta">➜</span>' + icon(t.r);
          b.title = (t.r ? prettyName(t.r.k) : '') + (t.out ? ' (ausverkauft)' : '');
          b.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); this.send({ t: 'trade', i }); });
          x.trades.appendChild(b);
        });
      }
    }
    if (x.cut) {
      const list = m.trades?.cut || [];
      const key = JSON.stringify(list);
      if (key !== x.cutKey) {
        x.cutKey = key;
        const palette = this.getPalette();
        x.cut.innerHTML = '';
        if (!list.length) x.cut.innerHTML = '<small>Lege Stein oder ähnliches links hinein</small>';
        list.forEach((it, i) => {
          const b = document.createElement('button');
          b.className = 'choice';
          b.innerHTML = `<img src="${iconFor(palette, it.k)}">${it.c > 1 ? `<em>${it.c}</em>` : ''}`;
          b.dataset.tip = prettyName(it.k) + (it.c > 1 ? ` (${it.c})` : '');
          b.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); this.send({ t: 'button', id: i }); });
          x.cut.appendChild(b);
        });
      }
      [...x.cut.children].forEach((b, i) => b.classList.toggle('sel', i === m.trades?.sel));
    }
    if (x.patterns) {
      const list = m.trades?.patterns || [];
      const key = JSON.stringify(list);
      if (key !== x.patternsKey) {
        x.patternsKey = key;
        x.patterns.innerHTML = '';
        if (!list.length) x.patterns.innerHTML = '<small>Lege ein Banner und einen Farbstoff hinein</small>';
        list.forEach((p, i) => {
          const b = document.createElement('button');
          b.className = 'opt';
          b.textContent = patternName(p);
          b.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); this.send({ t: 'button', id: i }); });
          x.patterns.appendChild(b);
        });
      }
      [...x.patterns.children].forEach((b, i) => b.classList.toggle('sel', i === m.trades?.sel));
    }
    if (x.beacon && m.trades?.beacon) this.updateBeacon(x.beacon, m.trades.beacon);
    if (x.cost) x.cost.textContent = d[0] > 0 ? `Kosten: ${d[0]} Level` : '';
  }

  /** Beacon: primary effect from the levels you have, secondary (regeneration or the primary stronger) at 4 levels. */
  updateBeacon(b, info) {
    const key = JSON.stringify([info.levels, info.primary, info.secondary, info.tiers]);
    if (key !== b.key) {
      // The server's choice (after "Fertig" or when someone else changed it)
      b.key = key;
      b.primary = info.primary || null;
      b.secondary = info.secondary || null;
    }
    const tiers = info.tiers || [];
    const levels = info.levels || 0;
    b.el.innerHTML = '';
    const row = (title, effects, enabled, isSel, pick) => {
      const r = document.createElement('div');
      r.className = 'beacon-row';
      const h = document.createElement('b');
      h.textContent = title;
      r.appendChild(h);
      for (const e of effects) {
        const btn = document.createElement('button');
        btn.className = 'opt' + (isSel(e) ? ' sel' : '');
        btn.textContent = EFFECTS[e] || prettyName(e);
        btn.disabled = !enabled;
        btn.addEventListener('mousedown', (ev) => { ev.preventDefault(); ev.stopPropagation(); pick(e); this.updateBeacon(b, info); });
        r.appendChild(btn);
      }
      b.el.appendChild(r);
    };
    const first = (tiers[0] || []).concat(tiers[1] || [], tiers[2] || []);
    tiers.slice(0, 3).forEach((t, i) => row(`Stufe ${i + 1}`, t, levels > i, (e) => b.primary === e, (e) => {
      b.primary = e;
      if (b.secondary && b.secondary !== 'regeneration') b.secondary = null;
    }));
    // Level 4: regeneration, or the primary effect a second time (stronger)
    const second = (tiers[3] || []).concat(b.primary && first.includes(b.primary) ? [b.primary] : []);
    row('Stufe 4 (zweiter Effekt)', [...new Set(second)], levels >= 4 && !!b.primary, (e) => b.secondary === e,
      (e) => { b.secondary = b.secondary === e ? null : e; });
    const status = document.createElement('small');
    status.textContent = levels ? `Pyramide: ${levels} Stufe${levels > 1 ? 'n' : ''}` : 'Keine Pyramide unter dem Leuchtfeuer';
    b.el.appendChild(status);
    b.done.disabled = !b.primary || !info.pay;
    b.done.title = !info.pay ? 'Erst ein Bezahl-Item in das Feld legen' : '';
  }

  // ------------------------------------------------------------------ hotbar

  select(i) {
    i = ((i % 9) + 9) % 9;
    if (i === this.selected) return;
    this.selected = i;
    this.send({ t: 'slot', i });
    this.renderHotbar();
    this.showName();
  }

  selectedItem() {
    return this.hot[this.selected];
  }

  showName() {
    const item = this.hot[this.selected];
    if (!item) { this.nameEl.classList.remove('show'); return; }
    this.nameEl.textContent = prettyName(item.k);
    this.nameEl.classList.add('show');
    clearTimeout(this.nameTimer);
    this.nameTimer = setTimeout(() => this.nameEl.classList.remove('show'), 1800);
  }

  // ------------------------------------------------------------------ open / close

  /** notify = tell the server (not when the server itself opened or closed the screen). */
  setOpen(open, notify = true) {
    if (open === this.open) return;
    this.open = open;
    this.screen.hidden = !open;
    this.hoverSlot = -1;
    this.tipTarget = null;
    this.refreshTip();
    if (notify) this.send({ t: open ? 'inv_open' : 'close' });
    if (!open) {
      this.menu = null;
      this.cursorEl.style.display = 'none';
      this.cursorCount.style.display = 'none';
    }
    this.onOpenChange(open);
  }

  reset() {
    this.hot = new Array(9).fill(null);
    this.off = null;
    if (this.open) {
      this.open = false;
      this.screen.hidden = true;
    }
    this.menu = null;
    this.layoutKey = '';
    this.renderHotbar();
  }
}
