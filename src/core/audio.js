// =========================================================
// procedural sound
//
// Every effect is synthesised at runtime with WebAudio — no audio files, so
// the repo stays asset-free and there is no third-party licence to carry.
// Weapon reports are driven by the item data the game already has (caliber
// and rate of fire), so a shotgun and a pistol genuinely sound different.
// =========================================================

let ctx = null;
let master = null;
let sfxBus = null;
let ambientBus = null;
let noiseBuf = null;
let unlocked = false;
let enabled = true;
let volume = 0.7;
let ambientNodes = null;
let lastFootstep = 0;

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

export function initAudio() {
  const unlock = () => {
    if (unlocked) return;
    ensure();
    if (ctx && ctx.state === 'suspended') ctx.resume();
    unlocked = true;
  };
  for (const ev of ['pointerdown', 'keydown']) {
    window.addEventListener(ev, unlock, { once: false, passive: true });
  }
  try {
    const saved = localStorage.getItem('escape2d.audio');
    if (saved) {
      const o = JSON.parse(saved);
      enabled = o.enabled !== false;
      volume = typeof o.volume === 'number' ? clamp01(o.volume) : 0.7;
    }
  } catch { /* defaults are fine */ }
}

function ensure() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();

  master = ctx.createGain();
  master.gain.value = enabled ? volume : 0;
  master.connect(ctx.destination);

  // a touch of glue so the loud transients do not clip
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -18;
  comp.knee.value = 22;
  comp.ratio.value = 8;
  comp.attack.value = 0.002;
  comp.release.value = 0.18;
  comp.connect(master);

  sfxBus = ctx.createGain();
  sfxBus.gain.value = 1;
  sfxBus.connect(comp);

  ambientBus = ctx.createGain();
  ambientBus.gain.value = 0;
  ambientBus.connect(master);

  // one second of white noise, reused by everything percussive
  const len = ctx.sampleRate;
  noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = noiseBuf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

  return ctx;
}

export function setEnabled(on) {
  enabled = !!on;
  if (master) master.gain.setTargetAtTime(enabled ? volume : 0, ctx.currentTime, 0.02);
  persist();
}
export function setVolume(v) {
  volume = clamp01(v);
  if (master && enabled) master.gain.setTargetAtTime(volume, ctx.currentTime, 0.02);
  persist();
}
export function audioState() { return { enabled, volume }; }
function persist() {
  try { localStorage.setItem('escape2d.audio', JSON.stringify({ enabled, volume })); } catch { /* ignore */ }
}

// ---------------------------------------------------------
// primitives
// ---------------------------------------------------------
function noise({ dur = 0.12, gain = 0.4, type = 'bandpass', freq = 900, q = 1, sweepTo = null, delay = 0 }) {
  if (!ensure() || !enabled) return;
  const t = ctx.currentTime + delay;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  src.loop = true;
  const filt = ctx.createBiquadFilter();
  filt.type = type;
  filt.frequency.setValueAtTime(freq, t);
  filt.Q.value = q;
  if (sweepTo) filt.frequency.exponentialRampToValueAtTime(Math.max(40, sweepTo), t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(filt); filt.connect(g); g.connect(sfxBus);
  src.start(t);
  src.stop(t + dur + 0.02);
}

function tone({ freq = 440, to = null, dur = 0.12, gain = 0.16, type = 'sine', delay = 0, attack = 0.005 }) {
  if (!ensure() || !enabled) return;
  const t = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (to) osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g); g.connect(sfxBus);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

const rnd = (a, b) => a + Math.random() * (b - a);

// ---------------------------------------------------------
// UI and inventory
// ---------------------------------------------------------
export const sfx = {
  click() {
    tone({ freq: 1500, to: 900, dur: 0.05, gain: 0.06, type: 'square' });
  },
  tab() {
    tone({ freq: 620, to: 880, dur: 0.09, gain: 0.07, type: 'triangle' });
  },
  pick() {
    noise({ dur: 0.07, gain: 0.16, freq: 2400, q: 0.8, sweepTo: 1200 });
    tone({ freq: 780, to: 1020, dur: 0.06, gain: 0.05, type: 'triangle' });
  },
  drop() {
    noise({ dur: 0.09, gain: 0.2, freq: 1500, q: 0.7, sweepTo: 420 });
    tone({ freq: 300, to: 190, dur: 0.09, gain: 0.07, type: 'sine' });
  },
  deny() {
    tone({ freq: 220, to: 150, dur: 0.14, gain: 0.1, type: 'sawtooth' });
  },
  money() {
    for (let i = 0; i < 3; i++) {
      tone({ freq: 1200 + i * 260, dur: 0.07, gain: 0.05, type: 'triangle', delay: i * 0.045 });
    }
  },
  levelUp() {
    [523, 659, 784, 1047].forEach((f, i) =>
      tone({ freq: f, dur: 0.22, gain: 0.07, type: 'triangle', delay: i * 0.08 }));
  },

  // ---------------- raid ----------------
  footstep(sprinting = false) {
    const now = performance.now();
    const gap = sprinting ? 260 : 420;
    if (now - lastFootstep < gap) return;
    lastFootstep = now;
    noise({
      dur: rnd(0.05, 0.08),
      gain: sprinting ? 0.12 : 0.075,
      freq: rnd(280, 460), q: 1.2, sweepTo: rnd(120, 200),
    });
  },

  /** weapon report; louder and lower for big calibers */
  shot(cal = '9x18') {
    const profile = {
      '12/70':   { body: 78,  bright: 3600, dur: 0.34, gain: 0.55 },
      '7.62x39': { body: 108, bright: 4200, dur: 0.26, gain: 0.46 },
      '5.45x39': { body: 122, bright: 5000, dur: 0.22, gain: 0.42 },
      '7.62x25': { body: 150, bright: 5200, dur: 0.16, gain: 0.34 },
      '9x19':    { body: 145, bright: 4600, dur: 0.17, gain: 0.34 },
      '9x18':    { body: 160, bright: 4200, dur: 0.15, gain: 0.30 },
    }[cal] || { body: 150, bright: 4600, dur: 0.18, gain: 0.34 };

    // crack
    noise({ dur: profile.dur * 0.45, gain: profile.gain, type: 'highpass', freq: profile.bright, sweepTo: profile.bright * 0.25 });
    // body
    noise({ dur: profile.dur, gain: profile.gain * 0.8, type: 'bandpass', freq: profile.body * 6, q: 0.7, sweepTo: profile.body });
    // thump
    tone({ freq: profile.body, to: profile.body * 0.45, dur: profile.dur * 0.8, gain: 0.22, type: 'sine' });
    // room tail
    noise({ dur: profile.dur * 2.2, gain: profile.gain * 0.14, type: 'lowpass', freq: 1400, sweepTo: 300, delay: 0.03 });
  },

  enemyShot(distance = 12) {
    const far = clamp01(distance / 26);
    noise({ dur: 0.2, gain: 0.26 * (1 - far * 0.7), type: 'bandpass', freq: 1400 - far * 900, q: 0.8, sweepTo: 180 });
    tone({ freq: 130, to: 60, dur: 0.18, gain: 0.12 * (1 - far * 0.6), type: 'sine' });
  },

  hitmark() {
    tone({ freq: 1800, to: 1400, dur: 0.05, gain: 0.09, type: 'square' });
  },

  hurt() {
    noise({ dur: 0.22, gain: 0.3, type: 'lowpass', freq: 700, sweepTo: 160 });
    tone({ freq: 95, to: 55, dur: 0.3, gain: 0.2, type: 'sine' });
  },

  kill() {
    noise({ dur: 0.3, gain: 0.22, type: 'lowpass', freq: 900, sweepTo: 140 });
    tone({ freq: 240, to: 120, dur: 0.32, gain: 0.1, type: 'triangle', delay: 0.02 });
  },

  alert() {
    tone({ freq: 760, to: 520, dur: 0.16, gain: 0.12, type: 'sawtooth' });
    tone({ freq: 520, to: 340, dur: 0.2, gain: 0.1, type: 'sawtooth', delay: 0.13 });
  },

  search() {
    noise({ dur: rnd(0.1, 0.17), gain: 0.09, freq: rnd(900, 1800), q: 0.6, sweepTo: rnd(300, 600) });
  },

  searchDone() {
    tone({ freq: 900, to: 1250, dur: 0.11, gain: 0.09, type: 'triangle' });
    noise({ dur: 0.1, gain: 0.1, freq: 2200, q: 0.8, sweepTo: 900 });
  },

  extractTick(progress) {
    tone({ freq: 380 + progress * 520, dur: 0.07, gain: 0.06, type: 'sine' });
  },

  extracted() {
    [392, 523, 659, 880].forEach((f, i) =>
      tone({ freq: f, dur: 0.36, gain: 0.09, type: 'triangle', delay: i * 0.11 }));
  },

  died() {
    tone({ freq: 180, to: 48, dur: 1.4, gain: 0.18, type: 'sine' });
    noise({ dur: 1.1, gain: 0.12, type: 'lowpass', freq: 500, sweepTo: 80 });
  },

  timeLow() {
    tone({ freq: 660, to: 480, dur: 0.13, gain: 0.08, type: 'square' });
  },
};

// ---------------------------------------------------------
// ambience: a low industrial bed that fades in during a raid
// ---------------------------------------------------------
export function startAmbient() {
  if (!ensure() || ambientNodes) return;
  const t = ctx.currentTime;

  const drone = ctx.createOscillator();
  drone.type = 'sawtooth';
  drone.frequency.value = 47;
  const drone2 = ctx.createOscillator();
  drone2.type = 'sine';
  drone2.frequency.value = 70.5;

  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 190;
  lp.Q.value = 0.6;

  const hiss = ctx.createBufferSource();
  hiss.buffer = noiseBuf;
  hiss.loop = true;
  const hissFilt = ctx.createBiquadFilter();
  hissFilt.type = 'bandpass';
  hissFilt.frequency.value = 620;
  hissFilt.Q.value = 0.4;
  const hissGain = ctx.createGain();
  hissGain.gain.value = 0.02;

  // very slow filter drift so the bed never sits still
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 0.045;
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = 70;
  lfo.connect(lfoGain);
  lfoGain.connect(lp.frequency);

  drone.connect(lp); drone2.connect(lp);
  lp.connect(ambientBus);
  hiss.connect(hissFilt); hissFilt.connect(hissGain); hissGain.connect(ambientBus);

  drone.start(t); drone2.start(t); hiss.start(t); lfo.start(t);
  ambientBus.gain.cancelScheduledValues(t);
  ambientBus.gain.setValueAtTime(0.0001, t);
  ambientBus.gain.exponentialRampToValueAtTime(0.5, t + 2.5);

  ambientNodes = { drone, drone2, hiss, lfo };
}

export function stopAmbient() {
  if (!ctx || !ambientNodes) return;
  const t = ctx.currentTime;
  ambientBus.gain.cancelScheduledValues(t);
  ambientBus.gain.setValueAtTime(ambientBus.gain.value, t);
  ambientBus.gain.exponentialRampToValueAtTime(0.0001, t + 0.8);
  const nodes = ambientNodes;
  ambientNodes = null;
  setTimeout(() => {
    for (const n of Object.values(nodes)) { try { n.stop(); } catch { /* already stopped */ } }
  }, 1000);
}
