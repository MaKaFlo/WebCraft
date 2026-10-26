// Health, hunger, armor, air and experience above the hotbar.

const $ = (id) => document.getElementById(id);

function icons(container, count, value, full, half, empty, cls) {
  // value is in half-icons (like Minecraft: 20 health = 10 hearts)
  let html = '';
  for (let i = 0; i < count; i++) {
    const v = value - i * 2;
    const icon = v >= 2 ? full : v === 1 ? half : empty;
    html += `<span class="${cls} ${v >= 2 ? 'full' : v === 1 ? 'half' : 'empty'}">${icon}</span>`;
  }
  container.innerHTML = html;
}

export class Hud {
  constructor() {
    this.el = $('stats');
    this.hearts = $('hearts');
    this.food = $('food');
    this.armor = $('armor');
    this.air = $('air');
    this.xpBar = $('xp-bar');
    this.xpLevel = $('xp-level');
    this.flash = $('damage-flash');
    this.lastHp = null;
    this.flashTime = 0;
    this.stats = null;
  }

  update(s) {
    const prev = this.stats;
    this.stats = s;
    const creative = s.gm === 'CREATIVE' || s.gm === 'SPECTATOR';
    this.el.classList.toggle('creative', creative);

    // Lifesteal can give more than 10 hearts, so hearts wrap into rows of 10
    const maxHearts = Math.max(1, Math.ceil(s.max / 2));
    icons(this.hearts, maxHearts, Math.ceil(s.hp), '❤', '❤', '❤', 'heart');
    this.hearts.title = `${(s.hp / 2).toFixed(1)} von ${maxHearts} Herzen`;
    icons(this.food, 10, s.food, '🍗', '🍗', '🍗', 'food');
    if (s.armor > 0) icons(this.armor, 10, s.armor, '🛡', '🛡', '🛡', 'shield');
    else this.armor.innerHTML = '';
    if (s.air < s.maxAir) {
      const bubbles = Math.ceil((Math.max(0, s.air) / s.maxAir) * 10);
      this.air.innerHTML = '🫧'.repeat(bubbles);
    } else {
      this.air.innerHTML = '';
    }
    this.xpBar.style.width = Math.round(s.xp * 100) + '%';
    this.xpLevel.textContent = s.lvl > 0 ? s.lvl : '';

    if (prev && s.hp < prev.hp && !s.dead) {
      this.flashTime = 0.35;
      this.hearts.classList.remove('shake');
      void this.hearts.offsetWidth; // restart the animation
      this.hearts.classList.add('shake');
    }
    // Lose a heart for good (Lifesteal)? Make it obvious
    if (prev && s.max < prev.max) this.toast('💔 Du hast ein Herz verloren');
    if (prev && s.max > prev.max) this.toast('💖 Du hast ein Herz bekommen');
  }

  toast(text) {
    const n = $('notice');
    n.textContent = text;
    n.classList.add('show');
    setTimeout(() => n.classList.remove('show'), 2500);
  }

  tick(dt) {
    this.flashTime = Math.max(0, this.flashTime - dt);
    this.flash.style.opacity = (this.flashTime / 0.35 * 0.45).toFixed(2);
  }

  reset() {
    this.stats = null;
    this.hearts.innerHTML = this.food.innerHTML = this.armor.innerHTML = this.air.innerHTML = '';
    this.xpBar.style.width = '0%';
    this.xpLevel.textContent = '';
  }
}
