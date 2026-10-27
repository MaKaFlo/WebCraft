// Weather: rain and snow falling around the player (not under roofs), darker sky, thunder flashes.
// Strength comes from the server's `time` message (rain, thunder, snow / dry for the biome).
import * as THREE from 'three';

const DROPS = 1400;
const RADIUS = 14;

export class Weather {
  constructor(scene, world, particles) {
    this.world = world;
    this.particles = particles;
    this.rain = 0;            // shown strength, eases towards the server's
    this.thunder = 0;
    this.target = { rain: 0, thunder: 0, snow: false, dry: false };
    this.flash = 0;           // lightning flash, 1 right after a bolt
    this.heights = new Map(); // column -> top block y (rain stops there)
    this.heightAge = 0;

    // Rain: short streaks (line segments); snow: points
    this.pos = new Float32Array(DROPS * 6);
    this.drops = Array.from({ length: DROPS }, () => ({ x: 0, y: -1e9, z: 0, v: 0, dx: 0 }));
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.rainMat = new THREE.LineBasicMaterial({ color: 0x8aa8d8, transparent: true, opacity: 0.55, depthWrite: false, fog: false });
    this.lines = new THREE.LineSegments(geo, this.rainMat);
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 3;
    scene.add(this.lines);

    this.snowPos = new Float32Array(DROPS * 3);
    const sgeo = new THREE.BufferGeometry();
    sgeo.setAttribute('position', new THREE.BufferAttribute(this.snowPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.snowMat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.13, transparent: true, opacity: 0.9, depthWrite: false });
    this.snow = new THREE.Points(sgeo, this.snowMat);
    this.snow.frustumCulled = false;
    this.snow.renderOrder = 3;
    scene.add(this.snow);
  }

  /** From the `time` message. */
  set(msg) {
    this.target = { rain: msg.rain ?? 0, thunder: msg.thunder ?? 0, snow: !!msg.snow, dry: !!msg.dry };
  }

  /** A lightning bolt appeared. */
  strike() {
    this.flash = 1;
  }

  /** Highest block that stops rain in a column (cached for a short while). */
  top(x, z, py) {
    const key = x * 100003 + z;
    let h = this.heights.get(key);
    if (h === undefined) {
      h = -1e9;
      const P = this.world.palette;
      if (P) {
        for (let y = Math.floor(py) + 40; y > py - 40; y--) {
          const id = this.world.getId(x, y, z);
          if (id && (P.solid[id] || P.fluid[id] || /leaves/.test(P.names[id]))) { h = y + 1; break; }
        }
      }
      this.heights.set(key, h);
    }
    return h;
  }

  /** Per frame. Returns how much the weather darkens the sky (0 = clear). */
  update(dt, px, py, pz) {
    const k = Math.min(1, dt * 0.5);
    this.rain += (this.target.rain - this.rain) * k;
    this.thunder += (this.target.thunder - this.thunder) * k;
    this.flash = Math.max(0, this.flash - dt * 3);
    this.heightAge += dt;
    if (this.heightAge > 0.5) { this.heightAge = 0; this.heights.clear(); }

    const falling = this.target.dry ? 0 : this.rain;
    const snow = this.target.snow;
    const active = Math.floor(DROPS * falling);
    const pos = this.pos, sp = this.snowPos;
    let splash = 0;
    for (let i = 0; i < DROPS; i++) {
      const d = this.drops[i];
      if (i >= active) {
        d.y = -1e9;
      } else {
        d.y -= d.v * dt;
        d.x += d.dx * dt;
        const ground = this.top(Math.floor(d.x), Math.floor(d.z), py);
        if (d.y < ground || d.y < py - 20 || Math.abs(d.x - px) > RADIUS || Math.abs(d.z - pz) > RADIUS) {
          if (d.y < ground && d.y > -1e8 && !snow && splash < 4 && Math.random() < 0.15) {
            this.particles?.sprite('rain', d.x, ground + 0.05, d.z, 0, 1.2, 0);
            splash++;
          }
          // New drop above the player, somewhere in the square around it
          d.x = px + (Math.random() * 2 - 1) * RADIUS;
          d.z = pz + (Math.random() * 2 - 1) * RADIUS;
          d.y = py + 8 + Math.random() * 16;
          d.v = snow ? 1.5 + Math.random() : 18 + Math.random() * 6;
          d.dx = snow ? (Math.random() - 0.5) * 0.8 : 0;
          if (d.y < this.top(Math.floor(d.x), Math.floor(d.z), py)) d.y = -1e9;   // under a roof
        }
      }
      const len = snow ? 0 : 0.7;
      pos[i * 6] = d.x; pos[i * 6 + 1] = d.y; pos[i * 6 + 2] = d.z;
      pos[i * 6 + 3] = d.x; pos[i * 6 + 4] = d.y + len; pos[i * 6 + 5] = d.z;
      sp[i * 3] = d.x; sp[i * 3 + 1] = d.y; sp[i * 3 + 2] = d.z;
    }
    this.lines.visible = active > 0 && !snow;
    this.snow.visible = active > 0 && snow;
    this.lines.geometry.attributes.position.needsUpdate = true;
    this.snow.geometry.attributes.position.needsUpdate = true;
    return Math.min(1, this.rain * 0.55 + this.thunder * 0.35);
  }
}
