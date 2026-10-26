// Tiny synthesized sound effects (no sound files needed).

let ctx = null;
let master = null;
let volume = 0.6;

function audio() {
  if (!ctx) {
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain();
      master.gain.value = volume;
      master.connect(ctx.destination);
    } catch (e) {
      return null;
    }
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

export function setVolume(v) {
  volume = Math.max(0, Math.min(1, v));
  if (master) master.gain.value = volume;
}

/** Call from a click/key handler so the browser allows sound later. */
export function unlockAudio() {
  audio();
}

function noise(duration, from, to, gain, type = 'lowpass') {
  const a = audio();
  if (!a || volume <= 0) return;
  const len = Math.floor(a.sampleRate * duration);
  const buf = a.createBuffer(1, len, a.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2;
  const src = a.createBufferSource();
  src.buffer = buf;
  const filter = a.createBiquadFilter();
  filter.type = type;
  filter.frequency.setValueAtTime(from, a.currentTime);
  filter.frequency.exponentialRampToValueAtTime(to, a.currentTime + duration);
  const g = a.createGain();
  g.gain.value = gain;
  src.connect(filter).connect(g).connect(master);
  src.start();
}

function tone(freq, endFreq, duration, gain, type = 'square') {
  const a = audio();
  if (!a || volume <= 0) return;
  const o = a.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, a.currentTime);
  o.frequency.exponentialRampToValueAtTime(endFreq, a.currentTime + duration);
  const g = a.createGain();
  g.gain.setValueAtTime(gain, a.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, a.currentTime + duration);
  o.connect(g).connect(master);
  o.start();
  o.stop(a.currentTime + duration);
}

export const sfx = {
  /** You hit something. strength 0..1 (attack charge). */
  hit(strength = 1) {
    noise(0.12, 1800, 300, 0.25 + 0.55 * strength);
    tone(160, 70, 0.1, 0.12 + 0.2 * strength, 'triangle');
  },
  /** Weak swing into the air / not charged. */
  swing() {
    noise(0.08, 3000, 1200, 0.06, 'bandpass');
  },
  crit() {
    noise(0.18, 4000, 800, 0.5, 'highpass');
    tone(900, 500, 0.12, 0.08);
  },
  munch() {
    noise(0.07, 2500 + Math.random() * 1500, 600, 0.25, 'bandpass');
  },
  gulp() {
    tone(220 + Math.random() * 60, 120, 0.12, 0.15, 'sine');
  },
  /** You got hurt. */
  hurt() {
    tone(330, 180, 0.18, 0.18, 'sawtooth');
    noise(0.1, 1200, 200, 0.3);
  },
};
