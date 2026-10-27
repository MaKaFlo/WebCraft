// Day/night sky of the overworld: sky and fog color, sun, moon with phases, stars, and how bright the world is.
// The server sends the world clock once per second (`time`), the sky runs it on in between.
import * as THREE from 'three';

// Sky colors: top of the sky and horizon (= fog), day and night, glow around the sun when it rises and sets
const DAY_TOP = new THREE.Color(0x7aa9ff);
const DAY_HORIZON = new THREE.Color(0xb2d2ff);
const NIGHT_TOP = new THREE.Color(0x03050b);
const NIGHT_HORIZON = new THREE.Color(0x0b1020);
const SUNSET = new THREE.Color(0xff8a3c);
const STORM = new THREE.Color(0x5a6070);
const WHITE = new THREE.Color(0xffffff);

const DOME_VERTEX = `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const DOME_FRAGMENT = `
uniform vec3 top;
uniform vec3 horizon;
uniform vec3 glow;
uniform vec3 sunDir;
uniform float glowStrength;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  vec3 col = mix(horizon, top, smoothstep(0.0, 0.45, d.y));
  float toSun = max(dot(d, sunDir), 0.0);
  float g = glowStrength * pow(toSun, 3.0) * (1.0 - smoothstep(0.0, 0.6, abs(d.y - 0.05)));
  gl_FragColor = vec4(mix(col, glow, clamp(g, 0.0, 1.0)), 1.0);
}`;

/** Minecraft's sun angle (0 = noon, 0.5 = midnight), with its slower noon and midnight. */
export function celestialAngle(dayTime) {
  const f = ((dayTime / 24000 - 0.25) % 1 + 1) % 1;
  const g = 0.5 - Math.cos(f * Math.PI) / 2;
  return (f * 2 + g) / 3;
}

/** 1 at day, 0 at night, smooth at sunrise and sunset (Minecraft's sky darkening). */
export function daylight(angle) {
  return Math.min(1, Math.max(0, Math.cos(angle * Math.PI * 2) * 2 + 0.5));
}

function canvasTexture(size, draw) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function sunTexture() {
  return canvasTexture(32, (g, s) => {
    const glow = g.createRadialGradient(s / 2, s / 2, 2, s / 2, s / 2, s / 2);
    glow.addColorStop(0, 'rgba(255,240,170,0.9)');
    glow.addColorStop(1, 'rgba(255,200,80,0)');
    g.fillStyle = glow; g.fillRect(0, 0, s, s);
    g.fillStyle = '#fff6c8'; g.fillRect(9, 9, 14, 14);
    g.fillStyle = '#ffffff'; g.fillRect(11, 11, 10, 10);
  });
}

/** Moon with the shadow of its phase (0 = full, 4 = new moon, like Minecraft). */
function moonTexture(phase) {
  return canvasTexture(16, (g) => {
    g.fillStyle = '#d8dce6'; g.fillRect(3, 3, 10, 10);
    g.fillStyle = '#b4bac8'; g.fillRect(5, 6, 2, 2); g.fillRect(9, 9, 3, 2); g.fillRect(8, 4, 2, 1);
    // phases 1..3 waning from the right, 5..7 waxing from the left
    const cut = [0, 3, 5, 8, 10, 8, 5, 3][phase];
    g.fillStyle = '#1a1f2e';
    if (phase === 4) g.fillRect(3, 3, 10, 10);
    else if (phase > 0 && phase < 4) g.fillRect(13 - cut, 3, cut, 10);
    else if (phase > 4) g.fillRect(3, 3, cut, 10);
  });
}

/** Darkens the unlit (MeshBasic) materials below `root` for the night (not glowing eyes); the own color is kept in userData. */
export function dimUnlit(root, b) {
  root.traverse((o) => {
    const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
    for (const m of mats) {
      if (!m.isMeshBasicMaterial || m.userData.noTint || m.userData.dimmed === b) continue;
      m.userData.baseColor ??= m.color.clone();
      m.color.copy(m.userData.baseColor).multiplyScalar(b);
      m.userData.dimmed = b;
    }
  });
}

export class Sky {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.renderOrder = -10;
    scene.add(this.group);
    this.time = 6000;          // noon until the server tells otherwise
    this.rate = 1;             // ticks per tick (0 when the clock is stopped)
    this.lastMsg = null;
    this.enabled = true;
    this.brightness = 1;

    // Gradient dome, drawn first behind everything
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 12), new THREE.ShaderMaterial({
      uniforms: {
        top: { value: new THREE.Color() }, horizon: { value: new THREE.Color() }, glow: { value: SUNSET.clone() },
        sunDir: { value: new THREE.Vector3() }, glowStrength: { value: 0 },
      },
      vertexShader: DOME_VERTEX, fragmentShader: DOME_FRAGMENT,
      side: THREE.BackSide, depthWrite: false, fog: false,
    }));
    this.dome.renderOrder = -20;
    this.dome.frustumCulled = false;
    this.group.add(this.dome);

    const mat = (map) => new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false, fog: false });
    this.sun = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat(sunTexture()));
    this.moonTex = [];
    this.moon = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat(null));
    // Stars: fixed points on a sphere, turning with the sun
    const pos = [];
    let seed = 10842;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    while (pos.length < 1500 * 3) {
      const x = rnd() * 2 - 1, y = rnd() * 2 - 1, z = rnd() * 2 - 1;
      const l = Math.hypot(x, y, z);
      if (l < 0.1 || l > 1) continue;
      pos.push(x / l, y / l, z / l);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    this.starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, transparent: true, depthWrite: false, fog: false });
    this.stars = new THREE.Points(geo, this.starMat);
    // The sun turns around the north-south axis (rises in the east = +x)
    this.orbit = new THREE.Group();
    this.orbit.add(this.sun, this.moon, this.stars);
    this.group.add(this.orbit);
    for (const o of [this.sun, this.moon, this.stars]) { o.renderOrder = -10; o.frustumCulled = false; }
  }

  /** `time` message: full world ticks. Jumps (/time set) are taken over directly. */
  setTime(v, now) {
    if (this.lastMsg) {
      // Running clock: about one world tick per tick between two messages; standing still: 0
      const dt = (now - this.lastMsg.at) / 50, dv = v - this.lastMsg.v;
      if (dv === 0) this.rate = 0;
      else if (dt > 0 && dv / dt > 0.5 && dv / dt < 2) this.rate = 1;
    }
    if (!this.lastMsg || Math.abs(this.time - v) > 100) this.time = v;
    this.lastMsg = { v, at: now };
    this.drift = v - this.time;   // pulled in slowly by update()
  }

  setEnv(env) {
    this.enabled = env === 'NORMAL';
    this.group.visible = this.enabled;
  }

  /** Per frame. dark: rain/thunder (0..1), flash: lightning (0..1). Returns the world brightness (1 = day). */
  update(dt, scene, camera, dark = 0, flash = 0) {
    if (!this.enabled) { this.brightness = 1; return 1; }
    this.time += dt * 20 * this.rate;
    if (this.drift) { const d = this.drift * Math.min(1, dt * 2); this.time += d; this.drift -= d; }
    const dayTime = ((this.time % 24000) + 24000) % 24000;
    const angle = celestialAngle(dayTime);
    const light = daylight(angle);

    const r = camera.far * 0.85;
    this.group.position.copy(camera.position);
    this.orbit.rotation.z = angle * Math.PI * 2;
    this.sun.position.set(0, r, 0); this.sun.scale.setScalar(r * 0.17); this.sun.lookAt(this.group.position);
    this.moon.position.set(0, -r, 0); this.moon.scale.setScalar(r * 0.11); this.moon.lookAt(this.group.position);
    this.stars.scale.setScalar(r * 0.95);
    const phase = Math.floor(this.time / 24000) % 8;
    if (this.moonPhase !== phase) {
      this.moonPhase = phase;
      this.moon.material.map = this.moonTex[phase] ??= moonTexture((phase + 8) % 8);
      this.moon.material.needsUpdate = true;
    }
    this.starMat.opacity = Math.max(0, 1 - light * 1.6) * 0.9 * (1 - dark);
    this.sun.material.opacity = this.moon.material.opacity = 1 - dark * 0.9;
    this.stars.visible = this.starMat.opacity > 0.01;

    // Day blue to night, orange glow towards the sun while it rises or sets
    const u = this.dome.material.uniforms;
    u.top.value.copy(NIGHT_TOP).lerp(DAY_TOP, light);
    u.horizon.value.copy(NIGHT_HORIZON).lerp(DAY_HORIZON, light);
    const a = angle * Math.PI * 2;
    u.sunDir.value.set(-Math.sin(a), Math.cos(a), 0);
    u.glowStrength.value = Math.max(0, 1 - Math.abs(Math.cos(a)) * 3) * 0.9 * (1 - dark);
    // Rain: gray sky (as dark as the time of day); lightning lights it up
    const storm = STORM.clone().multiplyScalar(0.15 + 0.85 * light);
    u.top.value.lerp(storm, dark * 0.85);
    u.horizon.value.lerp(storm, dark * 0.85);
    if (flash > 0) { u.top.value.lerp(WHITE, flash * 0.6); u.horizon.value.lerp(WHITE, flash * 0.6); }
    this.dome.scale.setScalar(r);
    scene.background.copy(u.horizon.value);
    scene.fog.color.copy(u.horizon.value);
    // Blocks never get fully dark (there is no block light): night keeps about a third
    this.brightness = Math.max((0.32 + 0.68 * light) * (1 - dark * 0.3), flash * 0.9);
    return this.brightness;
  }
}
