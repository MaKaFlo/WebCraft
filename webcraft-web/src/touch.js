// Touch controls for phones and tablets: joystick (walk, sprint at the edge), buttons (jump, sneak, attack/dig,
// use/place, inventory, chat, drop, menu), look around by dragging, and optionally by turning the phone (gyro).
import * as THREE from 'three';

/** A phone or tablet (touch is the main input). */
export const isTouch = matchMedia('(pointer: coarse)').matches || ('ontouchstart' in window && navigator.maxTouchPoints > 0);

const JOY_R = 56;           // joystick radius (px)
const DEAD = 0.3;           // joystick: no walking below this
const SPRINT = 0.92;        // joystick: forward this far = sprint
const DRAG_SENS = 1.6;      // dragging turns this much more than the mouse at the same setting

export class TouchControls {
  /**
   * opts: player, interaction, inventory, settings, sendInput(), openInventory(), closeOverlay(), openChat(),
   * openMenu(), drop(), notice(text)
   */
  constructor(opts) {
    Object.assign(this, opts);
    this.active = false;
    this.lookId = null;
    this.lookLast = null;
    this.gyroOn = false;
    this.gyroLast = null;   // { heading, elev } of the last reading
    this.roll = 0;          // sideways tilt of the phone (radians)
    this.lastJump = 0;
    document.body.classList.add('touch');

    const el = this.el = document.createElement('div');
    el.id = 'touch';
    el.innerHTML = `
      <div class="t-joy"><div class="t-knob"></div></div>
      <div class="t-right">
        <button class="t-btn t-use" aria-label="Benutzen">✋</button>
        <button class="t-btn t-attack" aria-label="Abbauen / Angreifen">⛏️</button>
        <button class="t-btn t-sneak" aria-label="Schleichen">⇩</button>
        <button class="t-btn t-jump" aria-label="Springen">⇧</button>
      </div>
      <div class="t-top">
        <button class="t-small t-inv" aria-label="Inventar">🎒</button>
        <button class="t-small t-drop" aria-label="Wegwerfen">🗑️</button>
        <button class="t-small t-view" aria-label="Ansicht wechseln">👁️</button>
        <button class="t-small t-chat" aria-label="Chat">💬</button>
        <button class="t-small t-menu" aria-label="Spielmenü">⏸️</button>
      </div>`;
    document.body.appendChild(el);
    // Closes the inventory, a chest or the chat (no Esc key on a phone)
    this.closeBtn = document.createElement('button');
    this.closeBtn.id = 'touch-close';
    this.closeBtn.textContent = '✕';
    this.closeBtn.hidden = true;
    document.body.appendChild(this.closeBtn);
    this.closeBtn.addEventListener('click', () => this.closeOverlay());

    this.setupJoystick(el.querySelector('.t-joy'), el.querySelector('.t-knob'));
    const q = (c) => el.querySelector(c);
    this.hold(q('.t-jump'), (down) => {
      const k = this.player.keys;
      if (down) {
        // Double tap: fly (where the server allows it)
        const now = performance.now();
        if (now - this.lastJump < 300 && this.player.canFly) { this.player.toggleFly(); this.lastJump = 0; } else this.lastJump = now;
        k.add('Space');
      } else k.delete('Space');
      this.sendInput();
    });
    this.sneakBtn = q('.t-sneak');
    this.tap(this.sneakBtn, () => {
      const k = this.player.keys;
      if (k.has('ShiftLeft')) k.delete('ShiftLeft'); else k.add('ShiftLeft');
      this.sneakBtn.classList.toggle('on', k.has('ShiftLeft'));
      this.sendInput();
    });
    this.hold(q('.t-attack'), (down) => {
      this.interaction.leftDown = down;
      if (down) this.interaction.leftClick();
    });
    this.hold(q('.t-use'), (down) => {
      this.interaction.rightDown = down;
      if (down) this.interaction.useTimer = 0;
    });
    this.tap(q('.t-inv'), () => this.openInventory());
    this.tap(q('.t-drop'), () => this.drop());
    this.tap(q('.t-chat'), () => this.openChat());
    this.tap(q('.t-view'), () => this.toggleView());
    this.tap(q('.t-menu'), () => this.openMenu());

    // Hotbar: tap a slot to pick it
    this.inventory.hotbar.forEach((slot, i) => {
      slot.addEventListener('pointerdown', (e) => { if (this.active) { e.preventDefault(); this.inventory.select(i); } });
    });

    this.setupLook(opts.lookEl);
    this.onOrientation = (e) => this.gyro(e);
  }

  /** A button that does something while held. */
  hold(btn, fn) {
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      btn.setPointerCapture(e.pointerId);
      btn.classList.add('down');
      fn(true);
    });
    const up = () => { if (btn.classList.contains('down')) { btn.classList.remove('down'); fn(false); } };
    btn.addEventListener('pointerup', up);
    btn.addEventListener('pointercancel', up);
  }

  tap(btn, fn) {
    btn.addEventListener('pointerdown', (e) => { e.preventDefault(); fn(); });
  }

  setupJoystick(base, knob) {
    let id = null, cx = 0, cy = 0;
    const set = (dx, dy) => {
      const len = Math.hypot(dx, dy), m = Math.min(1, len / JOY_R);
      const nx = len ? dx / len * m : 0, ny = len ? dy / len * m : 0;
      knob.style.transform = `translate(${nx * JOY_R}px, ${ny * JOY_R}px)`;
      const k = this.player.keys;
      const was = [...k].join();
      // Eight directions like the keys (the server gets the same input as from a keyboard)
      for (const c of ['KeyW', 'KeyS', 'KeyA', 'KeyD']) k.delete(c);
      if (m > DEAD) {
        const a = Math.atan2(nx, -ny);   // 0 = forward, clockwise
        const s = Math.round(a / (Math.PI / 4));
        if ([-1, 0, 1].includes(s)) k.add('KeyW');
        if ([3, 4, -4, -3].includes(s)) k.add('KeyS');
        if ([1, 2, 3].includes(s)) k.add('KeyD');
        if ([-1, -2, -3].includes(s)) k.add('KeyA');
      }
      this.player.sprinting = k.has('KeyW') && -ny > SPRINT && this.player.canSprint;
      if ([...k].join() !== was) this.sendInput();
    };
    base.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (id !== null) return;
      id = e.pointerId;
      base.setPointerCapture(id);
      const r = base.getBoundingClientRect();
      cx = r.left + r.width / 2; cy = r.top + r.height / 2;
      set(e.clientX - cx, e.clientY - cy);
    });
    base.addEventListener('pointermove', (e) => { if (e.pointerId === id) set(e.clientX - cx, e.clientY - cy); });
    const end = (e) => { if (e.pointerId === id) { id = null; set(0, 0); } };
    base.addEventListener('pointerup', end);
    base.addEventListener('pointercancel', end);
    this.resetJoystick = () => { id = null; set(0, 0); };
  }

  /** Dragging a finger over the game (anywhere but the controls, also over the chat) turns the view. */
  setupLook(target) {
    target.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' || !this.active || this.lookId !== null) return;
      if (e.target.closest?.('button, input, #hotbar, .t-joy, #pause')) return;
      this.lookId = e.pointerId;
      this.lookLast = [e.clientX, e.clientY];
      e.target.setPointerCapture?.(e.pointerId);
    });
    target.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.lookId || !this.active) return;
      const [x, y] = this.lookLast;
      this.lookLast = [e.clientX, e.clientY];
      this.player.look(e.clientX - x, e.clientY - y, this.settings.sens / 100 * DRAG_SENS);
    });
    const end = (e) => { if (e.pointerId === this.lookId) this.lookId = null; };
    target.addEventListener('pointerup', end);
    target.addEventListener('pointercancel', end);
  }

  // ---------------------------------------------------------------- gyro

  /**
   * Turn the gyro look on or off. Must be called from a tap (iPhones ask for permission then). Returns false
   * (with a notice) when it can't work: no sensor, or the page is not served over https.
   */
  async setGyro(on) {
    if (!on) {
      window.removeEventListener('deviceorientation', this.onOrientation);
      this.gyroOn = false;
      return true;
    }
    if (!window.isSecureContext) { this.notice('Gyro geht nur über https://'); return false; }
    if (typeof DeviceOrientationEvent === 'undefined') { this.notice('Kein Gyro-Sensor gefunden'); return false; }
    if (typeof DeviceOrientationEvent.requestPermission === 'function') {
      let answer;
      try {
        answer = await DeviceOrientationEvent.requestPermission();
      } catch (e) {
        // Only allowed right after a tap (not after a controller button): ask again on the next tap
        this.notice('Einmal auf den Bildschirm tippen, um den Gyro zu erlauben');
        this.permissionTap = true;   // this tap is for the permission, not for the game (main.js: VR menu tap)
        document.addEventListener('pointerdown', () => { this.permissionTap = false; this.setGyro(true); }, { once: true });
        return true;
      }
      if (answer !== 'granted') { this.notice('Gyro nicht erlaubt'); return false; }
    }
    window.removeEventListener('deviceorientation', this.onOrientation);
    this.gyroLast = null;
    window.addEventListener('deviceorientation', this.onOrientation);
    this.gyroOn = true;
    return true;
  }

  /**
   * Where the back of the phone points (the screen faces you): compass heading (clockwise, degrees) and
   * elevation (up positive). Only the changes are used, so turning the phone turns the view by the same angle.
   */
  gyro(e) {
    if (e.alpha === null) return;
    const deg = Math.PI / 180;
    const orient = (screen.orientation?.angle ?? window.orientation ?? 0) * deg;
    euler.set(e.beta * deg, e.alpha * deg, -e.gamma * deg, 'YXZ');
    quat.setFromEuler(euler).multiply(BACK).multiply(screenTurn.setFromAxisAngle(Z_AXIS, -orient));
    fwd.set(0, 0, -1).applyQuaternion(quat);
    // Head tilted to the side (3D glasses turn the camera with it)
    this.roll = Math.asin(Math.max(-1, Math.min(1, side.set(1, 0, 0).applyQuaternion(quat).y)));
    const reading = { heading: Math.atan2(fwd.x, -fwd.z) / deg, elev: Math.asin(Math.max(-1, Math.min(1, fwd.y))) / deg };
    const last = this.gyroLast;
    this.gyroLast = reading;
    if (!last || !this.active) return;
    // Straight up or down the heading jumps around: only the elevation counts there
    const dYaw = Math.abs(fwd.y) > 0.97 ? 0 : ((reading.heading - last.heading + 540) % 360) - 180;
    const dPitch = -(reading.elev - last.elev);
    if (Math.abs(dYaw) > 45 || Math.abs(dPitch) > 45) return;   // sensor glitch
    this.player.look(dYaw, dPitch, 1);
  }

  // ---------------------------------------------------------------- per frame

  /** playing: in the world without a screen open; overlay: inventory/chest/chat open (shows the close button). */
  update(playing, overlay) {
    if (playing !== this.active) {
      this.active = playing;
      this.el.hidden = !playing;
      if (!playing) {
        this.resetJoystick();
        for (const b of this.el.querySelectorAll('.down')) b.classList.remove('down');
        this.interaction.leftDown = this.interaction.rightDown = false;
        this.lookId = null;
        this.gyroLast = null;
      }
    }
    this.closeBtn.hidden = !overlay;
    this.sneakBtn.classList.toggle('on', this.player.keys.has('ShiftLeft'));
  }
}

const euler = new THREE.Euler();
const quat = new THREE.Quaternion();
const screenTurn = new THREE.Quaternion();
const fwd = new THREE.Vector3();
const side = new THREE.Vector3();
const Z_AXIS = new THREE.Vector3(0, 0, 1);
const BACK = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5));   // look out of the back, not the top
