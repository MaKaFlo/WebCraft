// Minecraft's locator bar: other players as colored dots over the experience bar, placed by the direction they are
// in (`wp` messages from the server's waypoints: a position nearby, a chunk further away or only a direction).

const VIEW = 60;            // degrees to each side the bar covers, like Minecraft
const NEAR = 128, FAR = 332; // Minecraft's default waypoint style: full size up to NEAR, smallest from FAR

function colorOf(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return `hsl(${((h % 360) + 360) % 360}, 75%, 62%)`;
}

const wrap = (d) => ((d + 180) % 360 + 360) % 360 - 180;

export class LocatorBar {
  constructor() {
    this.points = new Map();
    this.el = document.createElement('div');
    this.el.id = 'locator';
    document.body.appendChild(this.el);
  }

  /** `wp` {op: track/update/untrack, id, c, p | ch | a}. */
  message(m) {
    if (m.op === 'untrack') {
      this.points.get(m.id)?.dot.remove();
      this.points.delete(m.id);
      return;
    }
    let w = this.points.get(m.id);
    if (!w) {
      const dot = document.createElement('div');
      dot.className = 'loc-dot';
      this.el.appendChild(dot);
      w = { dot };
      this.points.set(m.id, w);
    }
    w.p = m.p; w.ch = m.ch; w.a = m.a;
    w.dot.style.background = m.c !== undefined ? '#' + m.c.toString(16).padStart(6, '0') : colorOf(m.id);
  }

  clear() {
    for (const w of this.points.values()) w.dot.remove();
    this.points.clear();
  }

  /** Every frame: where the dots are for our view (yaw/pitch in Minecraft degrees). */
  update(player, show) {
    this.el.hidden = !show || this.points.size === 0;
    if (this.el.hidden) return;
    const width = this.el.clientWidth;
    for (const w of this.points.values()) {
      let bearing, dist = FAR, dy = 0;
      if (w.p || w.ch) {
        const x = w.p ? w.p[0] + 0.5 : w.ch[0] * 16 + 8, z = w.p ? w.p[2] + 0.5 : w.ch[1] * 16 + 8;
        const dx = x - player.x, dz = z - player.z;
        bearing = Math.atan2(dz, dx) * 180 / Math.PI;
        dist = Math.hypot(dx, dz);
        if (w.p) dy = w.p[1] + 1 - player.eyeY;
      } else if (w.a !== undefined) {
        bearing = w.a * 180 / Math.PI;
      } else {
        w.dot.hidden = true;
        continue;
      }
      const rel = wrap(bearing - 90 - player.yaw);
      w.dot.hidden = Math.abs(rel) > VIEW;
      if (w.dot.hidden) continue;
      const k = Math.min(1, Math.max(0, (dist - NEAR) / (FAR - NEAR)));
      const size = Math.round(9 - 4 * k);
      w.dot.style.width = w.dot.style.height = size + 'px';
      w.dot.style.left = (width / 2 + rel / VIEW * (width / 2) - size / 2) + 'px';
      // Arrows when the other one is clearly above or below where we look
      const up = Math.atan2(dy, Math.max(1, dist)) * 180 / Math.PI;
      const off = up + player.pitch;   // pitch: positive looks down
      w.dot.dataset.dir = w.p && dist > 2 ? (off > 30 ? 'up' : off < -30 ? 'down' : '') : '';
    }
  }
}
