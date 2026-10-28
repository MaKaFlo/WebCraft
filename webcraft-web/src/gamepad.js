// Game controllers (Xbox, PlayStation, Bluetooth pads; "standard" button layout of the Gamepad API), like
// Minecraft on consoles: left stick walks (press it to sprint), right stick looks, RT attacks/digs, LT uses/places,
// A jumps (twice: fly), B sneaks or closes a screen, X drops, Y inventory, LB/RB and the d-pad pick the hotbar slot,
// Start opens the game menu (d-pad + A work in it), Back switches the 3D glasses on and off.

const DEAD = 0.25;          // stick dead zone
const LOOK_SPEED = 220;     // degrees per second at full right stick and mouse setting 15

const BTN = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, BACK: 8, START: 9, LS: 10, RS: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };

export class GamepadControls {
  /**
   * opts: player, interaction, inventory, settings, sendInput(), openInventory(), closeOverlay(), toggleMenu(),
   * menuEl (the game menu, for d-pad navigation), drop(), toggleVr(), clickDefault() (respawn on the death screen)
   */
  constructor(opts) {
    Object.assign(this, opts);
    this.prev = [];
    this.lastUse = -1e9;     // when the pad was used last (ms)
    this.lastJump = 0;
    this.sprintHeld = false;
    window.addEventListener('gamepadconnected', (e) => opts.notice?.(`🎮 Controller verbunden: ${e.gamepad.id.split('(')[0].trim()}`));
  }

  /** The pad was used within the last minute (then the game runs without the mouse being caught). */
  get recent() { return performance.now() - this.lastUse < 60000; }

  pad() {
    const pads = navigator.getGamepads?.() || [];
    for (const p of pads) if (p && p.connected && p.mapping === 'standard') return p;
    for (const p of pads) if (p && p.connected) return p;
    return null;
  }

  /** Per frame. playing: in the world without a screen; overlay: inventory/chest/chat open; menu: game menu open. */
  poll(dt, { playing, overlay, menu, dead }) {
    const p = this.pad();
    if (!p) return;
    const b = p.buttons.map((x) => x.pressed || x.value > 0.5);
    const pressed = (i) => b[i] && !this.prev[i];
    const ax = (i) => { const v = p.axes[i] || 0; return Math.abs(v) < DEAD ? 0 : (v - Math.sign(v) * DEAD) / (1 - DEAD); };
    if (b.some(Boolean) || p.axes.some((v) => Math.abs(v) > DEAD)) this.lastUse = performance.now();

    if (pressed(BTN.BACK)) this.toggleVr();
    if (pressed(BTN.START)) this.toggleMenu();
    if (menu) this.navigateMenu(pressed);
    else if (overlay) { if (pressed(BTN.B) || pressed(BTN.Y)) this.closeOverlay(); }
    else if (dead) { if (pressed(BTN.A)) this.clickDefault(); }
    else if (playing) this.play(dt, b, pressed, ax);
    if (!playing) this.release();
    this.prev = b;
  }

  play(dt, b, pressed, ax) {
    const { player, interaction, inventory } = this;
    // Walking: eight directions like the keys (the server gets the same input as from a keyboard)
    const k = player.keys;
    const was = [...k].join();
    const x = ax(0), y = ax(1);
    for (const c of ['KeyW', 'KeyS', 'KeyA', 'KeyD']) k.delete(c);
    if (Math.hypot(x, y) > 0) {
      const s = Math.round(Math.atan2(x, -y) / (Math.PI / 4));
      if ([-1, 0, 1].includes(s)) k.add('KeyW');
      if ([3, 4, -4, -3].includes(s)) k.add('KeyS');
      if ([1, 2, 3].includes(s)) k.add('KeyD');
      if ([-1, -2, -3].includes(s)) k.add('KeyA');
    }
    if (pressed(BTN.LS)) this.sprintHeld = true;
    if (!k.has('KeyW')) this.sprintHeld = false;
    player.sprinting = this.sprintHeld && player.canSprint;
    if (b[BTN.A]) {
      if (pressed(BTN.A)) {
        const now = performance.now();
        if (now - this.lastJump < 300 && player.canFly) { player.toggleFly(); this.lastJump = 0; } else this.lastJump = now;
      }
      k.add('Space');
    } else k.delete('Space');
    if (b[BTN.B]) k.add('ShiftLeft'); else if (this.prev[BTN.B]) k.delete('ShiftLeft');
    if ([...k].join() !== was) this.sendInput();

    // Looking: speed grows with the square of the stick, scaled like the mouse setting
    const rx = ax(2), ry = ax(3);
    if (rx || ry) {
      const speed = LOOK_SPEED * (this.settings.sens / 15) * dt;
      player.look(Math.sign(rx) * rx * rx * speed, Math.sign(ry) * ry * ry * speed * 0.7, 1);
    }

    // Triggers: attack/dig and use/place
    if (b[BTN.RT] && !this.prev[BTN.RT]) { interaction.leftDown = true; interaction.leftClick(); }
    if (!b[BTN.RT] && this.prev[BTN.RT]) interaction.leftDown = false;
    if (b[BTN.LT] && !this.prev[BTN.LT]) { interaction.rightDown = true; interaction.useTimer = 0; }
    if (!b[BTN.LT] && this.prev[BTN.LT]) interaction.rightDown = false;

    if (pressed(BTN.LB) || pressed(BTN.LEFT)) inventory.select((inventory.selected + 8) % 9);
    if (pressed(BTN.RB) || pressed(BTN.RIGHT)) inventory.select((inventory.selected + 1) % 9);
    if (pressed(BTN.X)) this.drop();
    if (pressed(BTN.Y)) this.openInventory();
    if (pressed(BTN.RS)) this.toggleView();
    this.held = true;
  }

  /** Leaving the world (menu, inventory ...): let go of everything the pad holds. */
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

  /** Game menu: d-pad up/down picks a button or slider, left/right moves sliders, A presses, B goes back. */
  navigateMenu(pressed) {
    const items = [...this.menuEl.querySelectorAll('.menu-page:not([hidden]) :is(button, input)')]
      .filter((el) => el.offsetParent !== null);
    if (!items.length) return;
    let i = items.indexOf(document.activeElement);
    const step = (pressed(BTN.DOWN) ? 1 : 0) - (pressed(BTN.UP) ? 1 : 0);
    if (step || i < 0) {
      i = i < 0 ? 0 : (i + step + items.length) % items.length;
      items[i].focus();
      // Marked by a class: programmatic focus does not always show :focus-visible
      for (const el of this.menuEl.querySelectorAll('.pad-focus')) el.classList.remove('pad-focus');
      items[i].classList.add('pad-focus');
    }
    const el = items[i];
    const side = (pressed(BTN.RIGHT) ? 1 : 0) - (pressed(BTN.LEFT) ? 1 : 0);
    if (side && el.type === 'range') {
      el.value = +el.value + side * (+el.step || 1);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
    if (pressed(BTN.A)) {
      if (el.type === 'checkbox') { el.checked = !el.checked; el.dispatchEvent(new Event('change', { bubbles: true })); } else el.click();
    }
    if (pressed(BTN.B)) {
      const back = this.menuEl.querySelector('.menu-page:not([hidden]) [data-back]');
      if (back) back.click(); else this.toggleMenu();
    }
  }
}
