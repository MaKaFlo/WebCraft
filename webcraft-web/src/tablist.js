// Player list shown while Tab is held (like in Minecraft).

function pingBars(ping) {
  if (ping === undefined) return '';
  const bars = ping < 150 ? 4 : ping < 300 ? 3 : ping < 600 ? 2 : 1;
  const color = bars >= 3 ? '#5ad15a' : bars === 2 ? '#f2c94c' : '#e2483d';
  return `<span class="ping" style="color:${color}" title="${ping} ms">${'▮'.repeat(bars)}<span class="off">${'▮'.repeat(4 - bars)}</span></span>`;
}

const escape = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export class TabList {
  constructor(el) {
    this.el = el;
    this.data = null;
  }

  update(msg) {
    this.data = msg;
    if (!this.el.hidden) this.render();
  }

  show(on) {
    this.el.hidden = !on;
    if (on) this.render();
  }

  render() {
    const d = this.data;
    if (!d) { this.el.innerHTML = '<div class="tab-head">Lade Spielerliste ...</div>'; return; }
    const rows = d.players.map((p) => {
      const name = escape(p.d || p.n);
      const icon = p.wc ? '🌐' : '⛏️';
      return `<div class="tab-row${p.spec ? ' spec' : ''}"><span class="tab-icon">${icon}</span><span class="tab-name">${name}</span>${p.wc ? '<span class="tag">WC</span>' : pingBars(p.ping)}</div>`;
    }).join('');
    const cols = Math.max(1, Math.ceil(d.players.length / 15));
    this.el.innerHTML =
      (d.header ? `<div class="tab-head">${escape(d.header).replace(/\n/g, '<br>')}</div>` : '')
      + `<div class="tab-count">${d.players.length} von ${d.max} Spielern online</div>`
      + `<div class="tab-grid" style="grid-template-columns: repeat(${cols}, minmax(180px, 1fr))">${rows}</div>`
      + (d.footer ? `<div class="tab-foot">${escape(d.footer).replace(/\n/g, '<br>')}</div>` : '');
  }
}
