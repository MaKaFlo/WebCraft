// Scoreboard sidebar on the right side of the screen (like in Minecraft).

const escape = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export class Sidebar {
  constructor(el) {
    this.el = el;
  }

  update(msg) {
    if (!msg.show) { this.el.hidden = true; return; }
    const lines = (msg.lines || []).map((l) =>
      `<div class="sb-line"><span>${escape(l.text) || '&nbsp;'}</span>${l.score !== undefined ? `<b>${l.score}</b>` : ''}</div>`).join('');
    this.el.innerHTML = `<div class="sb-title">${escape(msg.title)}</div>${lines}`;
    this.el.hidden = false;
  }
}
