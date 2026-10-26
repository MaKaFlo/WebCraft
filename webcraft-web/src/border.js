// World border: a striped see-through wall, only shown when you are close to it (like in Minecraft).
import * as THREE from 'three';

const SHOW_DISTANCE = 24;

function stripes() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  ctx.strokeStyle = 'rgba(80, 170, 255, 1)';
  ctx.lineWidth = 10;
  for (let i = -64; i < 128; i += 24) {
    ctx.beginPath(); ctx.moveTo(i, 64); ctx.lineTo(i + 64, 0); ctx.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

export class Border {
  constructor(scene) {
    this.tex = stripes();
    this.mat = new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false, fog: false });
    this.walls = [];
    for (let i = 0; i < 4; i++) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.mat);
      m.visible = false;
      m.renderOrder = 5;
      scene.add(m);
      this.walls.push(m);
    }
    this.data = null;
  }

  set(b) {
    this.data = b && b.size < 5.9e7 ? b : null;
  }

  update(px, py, pz, t) {
    const b = this.data;
    for (const w of this.walls) w.visible = false;
    if (!b) return;
    const half = b.size / 2;
    const len = Math.min(b.size, SHOW_DISTANCE * 4);
    const h = 64;
    this.tex.offset.set(t * 0.05, t * 0.05);
    const sides = [
      [b.x - half, null, 0], [b.x + half, null, 0], [null, b.z - half, 1], [null, b.z + half, 1],
    ];
    sides.forEach(([x, z, turned], i) => {
      const d = x !== null ? Math.abs(px - x) : Math.abs(pz - z);
      if (d > SHOW_DISTANCE) return;
      const w = this.walls[i];
      w.visible = true;
      w.material.opacity = 0.55 * (1 - d / SHOW_DISTANCE) + 0.1;
      // Follow the player along the wall, but stay inside the border
      const along = turned ? Math.max(b.x - half + len / 2, Math.min(b.x + half - len / 2, px)) : Math.max(b.z - half + len / 2, Math.min(b.z + half - len / 2, pz));
      w.scale.set(len, h, 1);
      w.rotation.set(0, turned ? 0 : Math.PI / 2, 0);
      w.position.set(x !== null ? x : along, py, z !== null ? z : along);
      this.tex.repeat.set(len / 4, h / 4);
    });
  }
}
