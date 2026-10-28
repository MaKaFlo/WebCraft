// 3D glasses (phone in a Cardboard-style holder): the world twice side by side, one picture per eye from a slightly
// shifted camera. The page's HUD can't be seen in there, so a small HUD (hotbar, hearts, food) and the crosshair are
// drawn into both pictures, in the hand's scene one meter in front of the eyes.
import * as THREE from 'three';
import { iconCanvas } from './items.js';

const size = new THREE.Vector2();
const buffer = new THREE.Vector2();

// Lens correction: the lenses of the holder bend the picture outwards (pincushion), so each eye's picture is bent
// inwards (barrel) by the same amount: a screen point at distance r from the eye's center shows the rendered point
// at r * (1 + K1 r^2 + K2 r^4) (r = 1 at the top/bottom edge). K1/K2 like a typical Cardboard viewer at strength 1.
const K1 = 0.34, K2 = 0.55;
const DISTORT_VERTEX = `varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const DISTORT_FRAGMENT = `uniform sampler2D map;
uniform float k1, k2, eyeAspect;
varying vec2 vUv;
void main() {
  float eye = step(0.5, vUv.x);
  vec2 local = vec2(vUv.x * 2.0 - eye, vUv.y);           // 0..1 inside this eye's half
  vec2 p = (local - 0.5) * 2.0 * vec2(eyeAspect, 1.0);    // centered, 1 = top/bottom edge
  float r2 = dot(p, p);
  vec2 q = p * (1.0 + k1 * r2 + k2 * r2 * r2);
  vec2 src = q / vec2(eyeAspect, 1.0) * 0.5 + 0.5;
  bool outside = src.x < 0.0 || src.x > 1.0 || src.y < 0.0 || src.y > 1.0;
  gl_FragColor = outside ? vec4(0.0, 0.0, 0.0, 1.0) : texture2D(map, vec2((src.x + eye) * 0.5, src.y));
  #include <colorspace_fragment>
}`;

export class StereoView {
  constructor(handScene) {
    this.eyes = new THREE.StereoCamera();
    this.handEyes = new THREE.StereoCamera();
    this.eyes.aspect = this.handEyes.aspect = 0.5;   // each eye gets half the screen
    this.group = new THREE.Group();
    this.group.visible = false;
    handScene.add(this.group);

    this.canvas = document.createElement('canvas');
    this.canvas.width = 512; this.canvas.height = 128;
    this.hud = this.plane(this.canvas, 0.64, 0.16, [0, -0.34, -1]);
    const cross = document.createElement('canvas');
    cross.width = cross.height = 32;
    const g = cross.getContext('2d');
    g.fillStyle = 'rgba(255,255,255,0.85)';
    g.fillRect(13, 2, 6, 28); g.fillRect(2, 13, 28, 6);
    this.cross = this.plane(cross, 0.04, 0.04, [0, 0, -1]);
    this.cross.material.map.minFilter = THREE.LinearFilter;   // thin lines must not vanish when shrunk
    this.hudTimer = 0;

    // Lens correction: both eyes are drawn into this picture first, then bent onto the screen
    this.strength = 0;
    this.target = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: true });
    this.distortMat = new THREE.ShaderMaterial({
      uniforms: { map: { value: this.target.texture }, k1: { value: 0 }, k2: { value: 0 }, eyeAspect: { value: 1 } },
      vertexShader: DISTORT_VERTEX, fragmentShader: DISTORT_FRAGMENT, depthTest: false, depthWrite: false,
    });
    this.distortScene = new THREE.Scene();
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.distortMat);
    quad.frustumCulled = false;
    this.distortScene.add(quad);
    this.distortCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  }

  /** Lens correction 0 (off) .. 1 (typical Cardboard lenses). */
  setLensStrength(s) {
    this.strength = s;
  }

  plane(canvas, w, h, pos) {
    const tex = new THREE.CanvasTexture(canvas);
    tex.magFilter = THREE.NearestFilter;
    tex.colorSpace = THREE.NoColorSpace;
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false });
    mat.userData.noTint = true;   // not darkened at night
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    m.position.set(...pos);
    m.renderOrder = 10;
    this.group.add(m);
    return m;
  }

  /** Eye distance in millimeters (blocks are one meter). */
  setEyeDistance(mm) {
    this.eyes.eyeSep = this.handEyes.eyeSep = mm / 1000;
  }

  /** Hotbar with the item pictures, hearts and food (a few times per second). */
  updateHud(dt, inventory, palette, stats) {
    this.hintT = (this.hintT ?? 0) - dt;
    this.hudTimer -= dt;
    if (this.hudTimer > 0) return;
    this.hudTimer = 0.25;
    const g = this.canvas.getContext('2d');
    g.clearRect(0, 0, 512, 128);
    g.imageSmoothingEnabled = false;
    const slot = 52, x0 = (512 - 9 * slot) / 2, y0 = 70;
    for (let i = 0; i < 9; i++) {
      const x = x0 + i * slot;
      g.fillStyle = 'rgba(0,0,0,0.5)';
      g.fillRect(x + 2, y0, slot - 4, slot - 4);
      if (i === inventory.selected) { g.strokeStyle = '#fff'; g.lineWidth = 3; g.strokeRect(x + 1.5, y0 - 0.5, slot - 3, slot - 3); }
      const item = inventory.hot[i];
      if (!item) continue;
      g.drawImage(iconCanvas(palette, item.k), x + 6, y0 + 4, 40, 40);
      if (item.c > 1) {
        g.font = 'bold 16px sans-serif'; g.textAlign = 'right'; g.fillStyle = '#fff';
        g.fillText(String(item.c), x + slot - 4, y0 + slot - 6);
      }
    }
    if (stats && stats.gm !== 'CREATIVE' && stats.gm !== 'SPECTATOR') {
      g.font = 'bold 24px sans-serif'; g.textAlign = 'left'; g.fillStyle = '#fff';
      g.fillText(`❤️ ${Math.ceil(stats.hp / 2)}`, x0 + 4, 56);
      g.textAlign = 'right';
      g.fillText(`🍗 ${Math.ceil(stats.food / 2)}`, x0 + 9 * slot - 4, 56);
    }
    if (this.hintT > 0) {
      g.font = 'bold 20px sans-serif'; g.textAlign = 'center'; g.fillStyle = '#ffffa0';
      g.fillText(this.hint, 256, 22);
    }
    this.hud.material.map.needsUpdate = true;
  }

  /** A short line above the hotbar for a few seconds. */
  showHint(text, seconds) {
    this.hint = text;
    this.hintT = seconds;
    this.hudTimer = 0;
  }

  /** Draws world, hand and HUD for both eyes. */
  render(renderer, scene, camera, hand, light, showHand) {
    renderer.getSize(size);
    const w = size.x / 2, h = size.y;
    camera.updateMatrixWorld();
    this.eyes.update(camera);
    hand.camera.updateMatrixWorld();
    this.handEyes.update(hand.camera);
    this.group.visible = true;
    const lens = this.strength > 0;
    const t = this.target;
    if (lens) {
      renderer.getDrawingBufferSize(buffer);
      if (t.width !== buffer.x || t.height !== buffer.y) t.setSize(buffer.x, buffer.y);
      renderer.setRenderTarget(t);
    } else {
      renderer.setScissorTest(true);
    }
    [[this.eyes.cameraL, this.handEyes.cameraL], [this.eyes.cameraR, this.handEyes.cameraR]].forEach(([eye, handEye], i) => {
      if (lens) {
        // A render target has its own viewport in buffer pixels
        t.viewport.set(i * t.width / 2, 0, t.width / 2, t.height);
        t.scissor.copy(t.viewport);
        t.scissorTest = true;
        renderer.setRenderTarget(t);
      } else {
        renderer.setViewport(i * w, 0, w, h);
        renderer.setScissor(i * w, 0, w, h);
      }
      renderer.render(scene, eye);
      renderer.autoClear = false;
      hand.renderWith(renderer, handEye, light, showHand);
      renderer.autoClear = true;
    });
    if (lens) {
      t.scissorTest = false;
      renderer.setRenderTarget(null);
      const u = this.distortMat.uniforms;
      u.k1.value = K1 * this.strength;
      u.k2.value = K2 * this.strength;
      u.eyeAspect.value = w / h;
      renderer.render(this.distortScene, this.distortCam);
    } else {
      renderer.setScissorTest(false);
      renderer.setViewport(0, 0, size.x, size.y);
    }
    this.group.visible = false;
  }
}
