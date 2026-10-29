// Boss bars at the top of the screen (wither, ender dragon, raids, plugin bars), from the server's `boss` messages.

const COLORS = { pink: '#ec00b8', blue: '#00b7ec', red: '#ec3500', green: '#1dec00', yellow: '#e9ec00', purple: '#7b00ec', white: '#ececec' };
const NOTCHES = { notched_6: 6, notched_10: 10, notched_12: 12, notched_20: 20 };

export class BossBars {
  constructor(el) {
    this.el = el;
    this.bars = new Map();   // id -> { name, p, color, overlay, row }
  }

  message(m) {
    let b = this.bars.get(m.id);
    if (m.op === 'remove') {
      if (b) { b.row.remove(); this.bars.delete(m.id); }
      return;
    }
    if (!b) {
      if (m.op !== 'add') return;
      b = { name: '', p: 1, color: 'pink', overlay: 'progress', row: document.createElement('div') };
      b.row.className = 'boss';
      b.row.innerHTML = '<div class="boss-name"></div><div class="boss-bar"><i></i></div>';
      this.el.appendChild(b.row);
      this.bars.set(m.id, b);
    }
    if (m.name !== undefined) b.name = m.name;
    if (m.p !== undefined) b.p = m.p;
    if (m.color) b.color = m.color;
    if (m.overlay) b.overlay = m.overlay;
    this.draw(b);
  }

  draw(b) {
    b.row.querySelector('.boss-name').textContent = b.name;
    const bar = b.row.querySelector('.boss-bar');
    const c = COLORS[b.color] ?? COLORS.pink;
    bar.style.setProperty('--boss', c);
    const n = NOTCHES[b.overlay];
    bar.style.setProperty('--notch', n ? `${100 / n}%` : '0');
    bar.classList.toggle('notched', !!n);
    bar.firstChild.style.width = Math.max(0, Math.min(1, b.p)) * 100 + '%';
  }

  clear() {
    this.bars.clear();
    this.el.innerHTML = '';
  }
}
