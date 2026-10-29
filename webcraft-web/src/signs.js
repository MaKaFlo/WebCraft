// Sign texts (server message `signs`) drawn on the board, and the editor (`sign_edit`) like Minecraft's.
import * as THREE from 'three';

// Minecraft's sign text colors (DyeColor text colors); without glow ink they are drawn darker
const COLORS = {
  white: 0xffffff, orange: 0xff681f, magenta: 0xff00ff, light_blue: 0x9ac0cd, yellow: 0xffff00, lime: 0xbfff00,
  pink: 0xff69b4, gray: 0x808080, light_gray: 0xd3d3d3, cyan: 0x00ffff, purple: 0xa020f0, blue: 0x0000ff,
  brown: 0x8b4513, green: 0x00ff00, red: 0xff0000, black: 0x000000,
};

const css = (rgb, k) => `rgb(${((rgb >> 16) & 255) * k | 0},${((rgb >> 8) & 255) * k | 0},${(rgb & 255) * k | 0})`;

function textCanvas(side, hanging) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = hanging ? 182 : 128;
  const g = c.getContext('2d');
  const rgb = COLORS[side.c] ?? 0;
  const glow = !!side.g;
  const lineH = c.height / 4.4;
  g.font = `${Math.round(lineH * 0.9)}px "WebCraft Pixel", monospace`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  side.l.forEach((line, i) => {
    if (!line) return;
    const y = c.height / 2 + (i - 1.5) * lineH;
    let text = line;
    while (text.length > 1 && g.measureText(text).width > c.width - 8) text = text.slice(0, -1);
    if (glow) {
      g.strokeStyle = rgb === 0 ? '#f0ebcc' : css(rgb, 0.4);
      g.lineWidth = 5;
      g.strokeText(text, c.width / 2, y);
    }
    g.fillStyle = css(rgb, glow ? 1 : 0.4 + (rgb === 0 ? 0 : 0.25));
    g.fillText(text, c.width / 2, y);
  });
  return c;
}

/** Where the text of a sign goes: { center, normal } of the front in block units, plus the board size. */
function placement(name, p) {
  const dir = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] };
  let n, cy, back, w, h;   // n = front direction (x, z), back = distance of the front from the middle
  const hanging = /hanging_sign$/.test(name);
  if (/_wall_hanging_sign$/.test(name)) { n = dir[p.facing] || dir.north; cy = 5 / 16; back = 1 / 16; w = 14 / 16; h = 10 / 16; }
  else if (hanging) {
    const a = (Number(p.rotation) || 0) * Math.PI / 8;
    n = [-Math.sin(a), Math.cos(a)]; cy = 5 / 16; back = 1 / 16; w = 14 / 16; h = 10 / 16;
  } else if (/_wall_sign$/.test(name)) {
    n = dir[p.facing] || dir.north;
    return { n, c: [0.5 - n[0] * (0.5 - 1.33 / 16), 8.67 / 16, 0.5 - n[1] * (0.5 - 1.33 / 16)], w: 1, h: 0.5, thick: 1.33 / 16, hanging };
  } else {
    const a = (Number(p.rotation) || 0) * Math.PI / 8;
    n = [-Math.sin(a), Math.cos(a)]; cy = 13.33 / 16; back = 0.67 / 16; w = 1; h = 0.5;
  }
  return { n, c: [0.5 + n[0] * back, cy, 0.5 + n[1] * back], w, h, thick: back * 2, hanging };
}

export class Signs {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.map = new Map();   // "x,y,z" -> { data, group }
    this.editor = null;
  }

  key(x, y, z) { return x + ',' + y + ',' + z; }

  message(msg) {
    for (const s of msg.l) {
      const k = this.key(s.x, s.y, s.z);
      this.removeKey(k);
      if (s.f) this.map.set(k, { data: s, group: null });
    }
    this.dirty = true;
  }

  removeKey(k) {
    const e = this.map.get(k);
    if (!e) return;
    if (e.group) this.disposeGroup(e.group);
    this.map.delete(k);
  }

  disposeGroup(g) {
    this.scene.remove(g);
    g.traverse((o) => { if (o.material) { o.material.map?.dispose(); o.material.dispose(); o.geometry.dispose(); } });
  }

  /** After block changes: signs that are gone lose their text, turned signs are built again. */
  blockChanged(x, y, z) {
    const k = this.key(x, y, z);
    const e = this.map.get(k);
    if (!e) return;
    const P = this.world.palette;
    const id = this.world.getId(x, y, z);
    if (!P || !/sign$/.test(P.names[id] || '')) { this.removeKey(k); return; }
    if (e.group) { this.disposeGroup(e.group); e.group = null; }
    this.dirty = true;
  }

  unloadChunk(cx, cz) {
    for (const [k, e] of this.map) {
      if (e.data.x >> 4 === cx && e.data.z >> 4 === cz) this.removeKey(k);
    }
  }

  clear() {
    for (const k of [...this.map.keys()]) this.removeKey(k);
  }

  /** Builds the text planes of signs whose block is there now (chunks may come after the text). */
  update() {
    if (!this.dirty) return;
    const P = this.world.palette;
    if (!P) return;
    let waiting = false;
    for (const e of this.map.values()) {
      if (e.group) continue;
      const { x, y, z } = e.data;
      const id = this.world.getId(x, y, z);
      const name = P.names[id] || '';
      if (!/sign$/.test(name)) { waiting = true; continue; }
      e.group = this.build(e.data, name, P.props[id] || {});
      this.scene.add(e.group);
    }
    this.dirty = waiting;
    if (waiting) setTimeout(() => { this.dirty = true; }, 1000);
  }

  build(d, name, p) {
    const pl = placement(name, p);
    const g = new THREE.Group();
    const bright = this.world.brightnessAt ? Math.max(0.25, this.world.brightnessAt(d.x + 0.5, d.y + 0.5, d.z + 0.5, 1)) : 1;
    for (const [side, sgn] of [[d.f, 1], [d.b, -1]]) {
      if (!side || !side.l.some((l) => l)) continue;
      const tex = new THREE.CanvasTexture(textCanvas(side, pl.hanging));
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.magFilter = THREE.NearestFilter;
      const k = side.g ? 1 : bright;
      const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, color: new THREE.Color(k, k, k),
        polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
      const m = new THREE.Mesh(new THREE.PlaneGeometry(pl.w * 0.9, pl.h * 0.8), mat);
      // Front plane: just outside the board's face; the back text on the other face
      const off = sgn > 0 ? 0.004 : -(pl.thick + 0.004);
      m.position.set(d.x + pl.c[0] + pl.n[0] * off, d.y + pl.c[1], d.z + pl.c[2] + pl.n[1] * off);
      m.rotation.y = Math.atan2(pl.n[0] * sgn, pl.n[1] * sgn);
      m.renderOrder = 3;
      g.add(m);
    }
    return g;
  }

  /** Lines of a sign side we know (for the editor). */
  lines(x, y, z, front) {
    const e = this.map.get(this.key(x, y, z));
    const side = e && (front ? e.data.f : e.data.b);
    return side ? side.l.slice(0, 4) : ['', '', '', ''];
  }

  /** Opens the editor; done(lines) is called once when it closes. */
  edit(msg, done) {
    this.closeEditor();
    const box = document.createElement('div');
    box.id = 'sign-editor';
    box.innerHTML = '<div class="sign-board"></div><div class="sign-hint">Enter: nächste Zeile · Fertig mit Enter in der letzten Zeile oder Esc</div><button type="button">Fertig</button>';
    const board = box.querySelector('.sign-board');
    const old = this.lines(msg.x, msg.y, msg.z, msg.front !== false);
    const inputs = old.map((text, i) => {
      const inp = document.createElement('input');
      inp.maxLength = 90;
      inp.value = text;
      inp.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter' || e.key === 'ArrowDown') {
          e.preventDefault();
          if (i < 3) inputs[i + 1].focus();
          else if (e.key === 'Enter') finish();
        } else if (e.key === 'ArrowUp' && i > 0) { e.preventDefault(); inputs[i - 1].focus(); }
        else if (e.key === 'Escape') { e.preventDefault(); finish(); }
      });
      board.appendChild(inp);
      return inp;
    });
    const finish = () => {
      if (this.editor !== box) return;
      this.editor = null;
      box.remove();
      done(inputs.map((inp) => inp.value));
    };
    box.querySelector('button').addEventListener('click', finish);
    box.addEventListener('keyup', (e) => e.stopPropagation());
    document.body.appendChild(box);
    this.editor = box;
    setTimeout(() => inputs[0].focus(), 0);
  }

  closeEditor() {
    if (this.editor) { this.editor.remove(); this.editor = null; }
  }
}
