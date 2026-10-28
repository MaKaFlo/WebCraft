// Chunk borders like Minecraft's F3+G: the chunk you stand in gets yellow lines every 2 blocks on its four sides
// and blue lines at the section borders (every 16 blocks up), the corners of the chunks around it are red.
import * as THREE from 'three';

export class ChunkGrid {
  constructor(scene) {
    this.scene = scene;
    this.group = null;
    this.key = '';
  }

  build(minY, maxY) {
    const yellow = [], blue = [], red = [];
    const line = (arr, x0, y0, z0, x1, y1, z1) => arr.push(x0, y0, z0, x1, y1, z1);
    // Upright lines in pieces of one section: very long lines got lost when clipped (software renderers)
    const upright = (arr, x, z) => { for (let y = minY; y < maxY; y += 16) line(arr, x, y, z, x, Math.min(y + 16, maxY), z); };
    // The four sides of this chunk
    for (let i = 0; i <= 16; i += 2) {
      for (const [x, z] of [[i, 0], [i, 16], [0, i], [16, i]]) upright(yellow, x, z);
    }
    for (let y = minY; y <= maxY; y += 2) {
      const arr = y % 16 === 0 ? blue : yellow;
      line(arr, 0, y, 0, 16, y, 0); line(arr, 0, y, 16, 16, y, 16);
      line(arr, 0, y, 0, 0, y, 16); line(arr, 16, y, 0, 16, y, 16);
    }
    // Corners of the chunks around
    for (const x of [-16, 0, 16, 32]) for (const z of [-16, 0, 16, 32]) upright(red, x, z);
    const g = new THREE.Group();
    for (const [pts, color] of [[yellow, 0xffff00], [blue, 0x3060ff], [red, 0xff2020]]) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      g.add(new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color, fog: false })));
    }
    return g;
  }

  /** Per frame: show (or hide) the lines around the chunk of x, z. */
  update(on, x, z, minY, maxY) {
    if (!on) { if (this.group) this.group.visible = false; return; }
    const key = minY + ',' + maxY;
    if (!this.group || this.key !== key) {
      if (this.group) { this.scene.remove(this.group); this.group.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); }); }
      this.group = this.build(minY, maxY);
      this.key = key;
      this.scene.add(this.group);
    }
    this.group.visible = true;
    this.group.position.set(Math.floor(x / 16) * 16, 0, Math.floor(z / 16) * 16);
  }
}
