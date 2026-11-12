// VR headsets (Meta Quest, Pico, PC VR in the browser) through WebXR: the world is drawn for both eyes by the
// headset, the head looks around, and the two controllers play like Vivecraft:
//   left stick walks (press it to sprint), right stick left/right turns in 30° steps, right stick down sneaks,
//   A jumps (twice: fly), right trigger attacks/digs, left trigger uses/places, grips pick the hotbar slot,
//   B inventory, X game menu, Y drops the item. The right controller points (laser), the hotbar and hearts sit on the
//   left wrist. Screens (inventory, menu, chat) are web pages, which a VR session can't show: the session ends while
//   one is open and comes back with the next click ("Zurück in VR").
import * as THREE from 'three';

const DEAD = 0.25;      // stick dead zone
const TURN = 30;        // degrees per snap turn

export class XrControls {
  /**
   * opts: renderer, scene, player, interaction, inventory, hudTexture (the 3D glasses' HUD canvas texture),
   * sendInput(), openInventory(), openMenu(), drop(), respawn(), notice(text), hint(text, seconds), onSupported(),
   * onStart(), onEnd()
   */
  constructor(opts) {
    Object.assign(this, opts);
    this.supported = false;
    this.session = null;
    this.wanted = false;       // the player plays in VR: screens end the session, the next click brings it back
    this.turn = 0;             // degrees the player turned with the stick (head yaw comes on top)
    this.base = null;          // head position in the room when VR started (the eyes are put there)
    this.prev = { left: [], right: [] };
    this.turnArmed = true;
    this.lastJump = 0;
    this.held = false;

    const r = this.renderer;
    r.xr.enabled = true;
    r.xr.setReferenceSpaceType('local');
    this.rig = new THREE.Group();
    this.camera = new THREE.PerspectiveCamera(70, 1, 0.05, 400);
    this.rig.add(this.camera);
    this.scene.add(this.rig);

    // Controllers: target ray spaces (pointing) and grip spaces (holding), sorted by hand when they connect
    this.hands = { left: null, right: null };
    for (let i = 0; i < 2; i++) {
      const ray = r.xr.getController(i), grip = r.xr.getControllerGrip(i);
      this.rig.add(ray, grip);
      ray.addEventListener('connected', (e) => {
        const hand = e.data.handedness === 'left' ? 'left' : 'right';
        this.hands[hand] = { ray, grip, source: e.data };
        if (hand === 'right') ray.add(this.laser);
        else grip.add(this.wrist);
      });
      ray.addEventListener('disconnected', () => {
        for (const h of ['left', 'right']) if (this.hands[h]?.ray === ray) this.hands[h] = null;
        if (this.laser.parent === ray) ray.remove(this.laser);
        if (this.wrist.parent === grip) grip.remove(this.wrist);
      });
    }
    // Laser of the pointing hand: as long as the aim reaches (shortened to the block or mob it hits)
    const lg = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]);
    this.laser = new THREE.Line(lg, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6 }));
    this.laser.material.userData.noTint = true;
    // Hotbar, hearts and food on the left wrist (the same picture as the 3D glasses' HUD)
    const hm = new THREE.MeshBasicMaterial({ map: this.hudTexture, transparent: true, depthTest: false });
    hm.userData.noTint = true;
    this.wrist = new THREE.Mesh(new THREE.PlaneGeometry(0.24, 0.06), hm);
    this.wrist.position.set(0, 0.05, 0.02);
    this.wrist.rotation.x = -Math.PI / 3;
    this.wrist.renderOrder = 10;

    this._v = new THREE.Vector3(); this._d = new THREE.Vector3(); this._q = new THREE.Quaternion();
    navigator.xr?.isSessionSupported?.('immersive-vr').then((ok) => {
      this.supported = !!ok;
      if (ok) this.onSupported?.();
    }).catch(() => {});
  }

  get presenting() { return !!this.session; }

  /** Starts VR (must come from a click or key press). */
  async start() {
    if (this.session || !this.supported) return;
    try {
      const session = await navigator.xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor'] });
      this.session = session;
      this.wanted = true;
      this.base = null;
      session.addEventListener('end', () => {
        this.session = null;
        if (!this.leavingForScreen) this.wanted = false;   // left with the headset's own button
        this.leavingForScreen = false;
        this.release();
        this.interaction.aim = null;
        this.onEnd?.();
      });
      await this.renderer.xr.setSession(session);
      this.onStart?.();
    } catch (e) {
      this.session = null;
      this.notice?.('VR konnte nicht starten: ' + (e.message || e));
    }
  }

  /** Ends the session for a screen (inventory, menu, chat); `wanted` stays, so the next click goes back into VR. */
  leaveForScreen() {
    if (!this.session) return;
    this.leavingForScreen = true;
    this.session.end().catch(() => {});
  }

  stop() {
    this.wanted = false;
    this.session?.end().catch(() => {});
  }

  /**
   * Per frame before the movement. playing: in the world without a screen. Puts the eyes at the player, takes the
   * look direction from the head and the aim from the right controller, reads both controllers.
   */
  update(dt, { playing, dead }) {
    if (!this.session) return;
    const { player } = this;
    if (!playing && !dead) { this.leaveForScreen(); return; }

    // Head: where it looks becomes the player's yaw/pitch (walking, the server, the others see that)
    const cam = this.camera;
    if (!this.base && cam.position.lengthSq() > 0) this.base = cam.position.clone();
    const base = this.base || this._v.set(0, 0, 0);
    this.rig.rotation.y = -this.turn * Math.PI / 180;
    const off = this._d.copy(base).applyAxisAngle(THREE.Object3D.DEFAULT_UP, this.rig.rotation.y);
    this.rig.position.set(player.x - off.x, player.eyeY - off.y, player.z - off.z);
    this.rig.updateMatrixWorld(true);
    cam.getWorldDirection(this._v);
    if (this._v.lengthSq() > 0.5) {
      player.yaw = Math.atan2(-this._v.x, this._v.z) * 180 / Math.PI;
      player.pitch = Math.max(-89.9, Math.min(89.9, -Math.asin(Math.max(-1, Math.min(1, this._v.y))) * 180 / Math.PI));
    }

    // Aim with the right controller (else the head)
    const right = this.hands.right;
    if (right) {
      right.ray.getWorldPosition(this._v);
      right.ray.getWorldQuaternion(this._q);
      const d = this._d.set(0, 0, -1).applyQuaternion(this._q);
      this.interaction.aim = { o: [this._v.x, this._v.y, this._v.z], d: [d.x, d.y, d.z] };
      const i = this.interaction;
      const hit = i.target?.hit ? Math.hypot(i.target.hit[0] - this._v.x, i.target.hit[1] - this._v.y, i.target.hit[2] - this._v.z) : 0;
      this.laser.scale.z = hit || (i.targetEntity?.t ?? 4.5);
    } else {
      this.interaction.aim = null;
    }

    const pad = (h) => this.hands[h]?.source?.gamepad || null;
    const lp = pad('left'), rp = pad('right');
    const btn = (p) => (p ? p.buttons.map((x) => x.pressed || x.value > 0.5) : []);
    const lb = btn(lp), rb = btn(rp);
    const lpress = (i) => lb[i] && !this.prev.left[i], rpress = (i) => rb[i] && !this.prev.right[i];
    const ax = (p, i) => { const v = p?.axes[i] || 0; return Math.abs(v) < DEAD ? 0 : (v - Math.sign(v) * DEAD) / (1 - DEAD); };

    if (dead) {
      if (!this.deadHint) { this.deadHint = true; this.hint?.('💀 Gestorben: A = Wiederbeleben', 30); }
      this.release();
      if (rpress(4) || rpress(0)) this.respawn();
    } else {
      if (this.deadHint) { this.deadHint = false; this.hint?.('', 0); }
      const k = player.keys, was = [...k].join();
      // Left stick: walk in eight directions like the keys, press it to sprint
      const x = ax(lp, 2), y = ax(lp, 3);
      for (const c of ['KeyW', 'KeyS', 'KeyA', 'KeyD']) k.delete(c);
      if (Math.hypot(x, y) > 0) {
        const s = Math.round(Math.atan2(x, -y) / (Math.PI / 4));
        if ([-1, 0, 1].includes(s)) k.add('KeyW');
        if ([3, 4, -4, -3].includes(s)) k.add('KeyS');
        if ([1, 2, 3].includes(s)) k.add('KeyD');
        if ([-1, -2, -3].includes(s)) k.add('KeyA');
      }
      if (lpress(3)) this.sprintHeld = true;
      if (!k.has('KeyW')) this.sprintHeld = false;
      player.sprinting = !!this.sprintHeld && player.canSprint;
      // Right stick: snap turn left/right, down = sneak
      const rx = rp?.axes[2] || 0, ry = rp?.axes[3] || 0;
      if (Math.abs(rx) < 0.3) this.turnArmed = true;
      else if (this.turnArmed && Math.abs(rx) > 0.7) { this.turnArmed = false; this.turn += Math.sign(rx) * TURN; }
      if (ry > 0.7 && Math.abs(rx) < 0.5) k.add('ShiftLeft'); else k.delete('ShiftLeft');
      // A: jump, twice quickly: fly
      if (rb[4]) {
        if (rpress(4)) {
          const now = performance.now();
          if (now - this.lastJump < 300 && player.canFly) { player.toggleFly(); this.lastJump = 0; } else this.lastJump = now;
        }
        k.add('Space');
      } else k.delete('Space');
      if ([...k].join() !== was) this.sendInput();

      const it = this.interaction;
      if (rb[0] && !this.prev.right[0]) { it.leftDown = true; it.leftClick(); }
      if (!rb[0] && this.prev.right[0]) it.leftDown = false;
      if (lb[0] && !this.prev.left[0]) { it.rightDown = true; it.useTimer = 0; }
      if (!lb[0] && this.prev.left[0]) it.rightDown = false;
      const inv = this.inventory;
      if (lpress(1)) inv.select((inv.selected + 8) % 9);
      if (rpress(1)) inv.select((inv.selected + 1) % 9);
      if (lpress(5)) this.drop();
      this.held = true;
      if (rpress(5)) this.openInventory();
      else if (lpress(4)) this.openMenu();
    }
    this.prev = { left: lb, right: rb };
  }

  /** Lets go of everything the controllers hold. */
  release() {
    if (!this.held) return;
    this.held = false;
    const k = this.player.keys;
    for (const c of ['KeyW', 'KeyS', 'KeyA', 'KeyD', 'Space', 'ShiftLeft']) k.delete(c);
    this.player.sprinting = false;
    this.sprintHeld = false;
    this.interaction.leftDown = this.interaction.rightDown = false;
    this.sendInput();
  }
}
