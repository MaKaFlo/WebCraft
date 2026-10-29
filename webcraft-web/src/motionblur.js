// Motion blur (mod): every frame is mixed with the frames before, so fast turns leave a trail.
// The scene is drawn into a render target, mixed with the last result, and the mix goes to the screen.
import * as THREE from 'three';

const VERTEX = 'varying vec2 vUv;\nvoid main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';

export class MotionBlur {
  constructor() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.mix = new THREE.ShaderMaterial({
      uniforms: { tNew: { value: null }, tOld: { value: null }, k: { value: 0.6 } },
      vertexShader: VERTEX,
      fragmentShader: 'uniform sampler2D tNew;\nuniform sampler2D tOld;\nuniform float k;\nvarying vec2 vUv;\n'
        + 'void main() { gl_FragColor = mix(texture2D(tNew, vUv), texture2D(tOld, vUv), k); }',
      depthTest: false, depthWrite: false,
    });
    this.copy = new THREE.ShaderMaterial({
      uniforms: { t: { value: null } },
      vertexShader: VERTEX,
      fragmentShader: 'uniform sampler2D t;\nvarying vec2 vUv;\nvoid main() { gl_FragColor = texture2D(t, vUv); }',
      depthTest: false, depthWrite: false,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mix);
    this.scene.add(this.quad);
    this.targets = null;
    this.size = new THREE.Vector2();
  }

  /** Draws scene/camera to the screen with the trail; strength 0..1 (how much of the old picture stays). */
  render(renderer, scene, camera, strength) {
    renderer.getDrawingBufferSize(this.size);
    const w = this.size.x, h = this.size.y;
    if (!this.targets || this.targets[0].width !== w || this.targets[0].height !== h) {
      this.targets?.forEach((t) => t.dispose());
      this.targets = [0, 1, 2].map(() => new THREE.WebGLRenderTarget(w, h));
      this.fresh = true;
    }
    const [frame, a, b] = this.targets;
    renderer.setRenderTarget(frame);
    renderer.render(scene, camera);
    // The first frame (or after a resize) starts without a trail
    this.mix.uniforms.tNew.value = frame.texture;
    this.mix.uniforms.tOld.value = this.fresh ? frame.texture : a.texture;
    this.mix.uniforms.k.value = strength;
    this.fresh = false;
    this.quad.material = this.mix;
    renderer.setRenderTarget(b);
    renderer.render(this.scene, this.camera);
    this.quad.material = this.copy;
    this.copy.uniforms.t.value = b.texture;
    renderer.setRenderTarget(null);
    renderer.render(this.scene, this.camera);
    this.targets[1] = b;
    this.targets[2] = a;
  }

  /** Next frame starts without a trail (after the mod was off). */
  reset() {
    this.fresh = true;
  }
}
