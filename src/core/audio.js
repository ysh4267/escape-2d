// =========================================================
// sound
//
// Deliberately minimal: footsteps and the factory ambience, nothing else.
// Interface clicks, container foley, alerts and extraction cues were all
// removed on purpose, and weapon audio belongs with the combat pass.
//
// Footstep samples are CC0 (Thimras, "Metal footsteps on concrete") — see
// assets/sfx/CREDITS.md. The ambience is synthesised so it drones without a
// loop point and ships no file.
// =========================================================

const SFX_DIR = 'assets/sfx/';
const STEPS = ['step_1', 'step_2', 'step_3', 'step_4', 'step_5', 'step_6'];

const STEP_MIX = {
  walk:   { gain: 0.32, rate: [0.92, 1.09], gap: 430 },
  sprint: { gain: 0.42, rate: [1.0, 1.16], gap: 265 },
};

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
let lastStep = -1;

/** name -> AudioBuffer | 'pending' | 'failed' */
const buffers = new Map();

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const rnd = (a, b) => a + Math.random() * (b - a);

// ---------------------------------------------------------
export function initAudio() {
  try {
    const saved = localStorage.getItem('escape2d.audio');
    if (saved) {
      const o = JSON.parse(saved);
      enabled = o.enabled !== false;
      volume = typeof o.volume === 'number' ? clamp01(o.volume) : 0.7;
    }
  } catch { /* defaults are fine */ }

  const unlock = () => {
    if (unlocked) return;
    unlocked = true;
    ensure();
    if (ctx && ctx.state === 'suspended') ctx.resume();
    for (const name of STEPS) load(name);
  };
  window.addEventListener('pointerdown', unlock, { passive: true });
  window.addEventListener('keydown', unlock, { passive: true });
}

function ensure() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();

  master = ctx.createGain();
  master.gain.value = enabled ? volume : 0;
  master.connect(ctx.destination);

  sfxBus = ctx.createGain();
  sfxBus.gain.value = 1;
  sfxBus.connect(master);

  ambientBus = ctx.createGain();
  ambientBus.gain.value = 0;
  ambientBus.connect(master);

  const len = ctx.sampleRate;
  noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = noiseBuf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

  return ctx;
}

function load(name) {
  if (buffers.has(name)) return;
  if (!ensure()) return;
  buffers.set(name, 'pending');
  fetch(new URL(`../../${SFX_DIR}${name}.ogg`, import.meta.url))
    .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
    .then((ab) => ctx.decodeAudioData(ab))
    .then((buf) => buffers.set(name, buf))
    .catch(() => buffers.set(name, 'failed'));
}

// ---------------------------------------------------------
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
export const sfx = {
  /**
   * One step, rate-limited by gait. Six variants are cycled so the same
   * sample never plays twice in a row and each is pitch-shifted slightly.
   */
  footstep(sprinting = false) {
    if (!enabled || !ensure()) return;
    const mix = sprinting ? STEP_MIX.sprint : STEP_MIX.walk;
    const now = performance.now();
    if (now - lastFootstep < mix.gap) return;
    lastFootstep = now;

    let i = Math.floor(Math.random() * STEPS.length);
    if (i === lastStep) i = (i + 1) % STEPS.length;
    lastStep = i;

    const buf = buffers.get(STEPS[i]);
    if (buf === undefined) { load(STEPS[i]); return; }
    if (buf === 'pending' || buf === 'failed') return;

    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rnd(mix.rate[0], mix.rate[1]);
    const g = ctx.createGain();
    g.gain.value = mix.gain;
    src.connect(g);
    g.connect(sfxBus);
    src.start();
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

  // very slow drift so the bed never sits perfectly still
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
