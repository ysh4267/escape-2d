// =========================================================
// sound
//
// Foley comes from openly licensed sample packs in assets/sfx (see
// assets/sfx/CREDITS.md) — metal footsteps on concrete, crate and locker
// rummaging, an alarm for the exfil channel, and a clean interface set.
// The industrial ambience is still synthesised so it can drone forever
// without a loop point.
//
// Weapon fire is deliberately silent for now: gunplay is being reworked
// separately, so nothing here makes a gunshot.
// =========================================================

const SFX_DIR = 'assets/sfx/';

/** name -> gain / pitch spread, so raw sample levels never have to be edited */
const MIX = {
  step:          { gain: 0.32, rate: [0.92, 1.09] },
  step_sprint:   { gain: 0.42, rate: [1.0, 1.16] },
  open_wood:     { gain: 0.55, rate: [0.94, 1.06] },
  open_metal:    { gain: 0.5,  rate: [0.94, 1.06] },
  open_door:     { gain: 0.5,  rate: [0.95, 1.05] },
  search:        { gain: 0.42, rate: [0.9, 1.12] },
  thud:          { gain: 0.4,  rate: [0.95, 1.05] },
  hurt:          { gain: 0.6,  rate: [0.9, 1.05] },
  ui_click:      { gain: 0.32, rate: [1, 1] },
  ui_tab:        { gain: 0.3,  rate: [1, 1] },
  item_pick:     { gain: 0.4,  rate: [0.96, 1.06] },
  item_drop:     { gain: 0.45, rate: [0.94, 1.04] },
  deny:          { gain: 0.4,  rate: [1, 1] },
  confirm:       { gain: 0.4,  rate: [1, 1] },
  alert:         { gain: 0.5,  rate: [1, 1] },
  money:         { gain: 0.45, rate: [0.98, 1.04] },
  window_open:   { gain: 0.32, rate: [1, 1] },
  window_close:  { gain: 0.3,  rate: [1, 1] },
  extract_alarm: { gain: 0.42, rate: [1, 1] },
};

const STEPS = ['step_1', 'step_2', 'step_3', 'step_4', 'step_5', 'step_6'];
const SEARCHES = ['search_1', 'search_2', 'search_3', 'search_4'];

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
let lastStepIndex = -1;

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
    preload();
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

  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -16;
  comp.knee.value = 22;
  comp.ratio.value = 6;
  comp.attack.value = 0.003;
  comp.release.value = 0.2;
  comp.connect(master);

  sfxBus = ctx.createGain();
  sfxBus.gain.value = 1;
  sfxBus.connect(comp);

  ambientBus = ctx.createGain();
  ambientBus.gain.value = 0;
  ambientBus.connect(master);

  const len = ctx.sampleRate;
  noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = noiseBuf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

  return ctx;
}

function preload() {
  for (const name of [...STEPS, ...SEARCHES, 'ui_click', 'ui_tab', 'item_pick',
    'item_drop', 'deny', 'confirm', 'alert', 'money', 'open_wood', 'open_metal',
    'open_door', 'thud', 'hurt', 'window_open', 'window_close', 'extract_alarm']) {
    load(name);
  }
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

/** mix key for a sample: strip the trailing _N so step_3 uses the `step` mix */
function mixFor(name, override) {
  return MIX[override] || MIX[name] || MIX[name.replace(/_\d+$/, '')] || { gain: 0.4, rate: [1, 1] };
}

function play(name, opts = {}) {
  if (!enabled || !ensure()) return;
  const buf = buffers.get(name);
  if (buf === undefined) { load(name); return; }
  if (buf === 'pending' || buf === 'failed') return;

  const m = mixFor(name, opts.mix);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = opts.rate ?? rnd(m.rate[0], m.rate[1]);

  const g = ctx.createGain();
  g.gain.value = (opts.gain ?? m.gain) * (opts.scale ?? 1);

  src.connect(g);
  g.connect(sfxBus);
  src.start(ctx.currentTime + (opts.delay || 0));
}

function pickDifferent(list, lastRef) {
  let i = Math.floor(Math.random() * list.length);
  if (list.length > 1 && i === lastRef.v) i = (i + 1) % list.length;
  lastRef.v = i;
  return list[i];
}
const stepRef = { get v() { return lastStepIndex; }, set v(x) { lastStepIndex = x; } };

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
// synth helpers, used only where a sample would be wrong
// ---------------------------------------------------------
function tone({ freq = 440, to = null, dur = 0.12, gain = 0.12, type = 'sine', delay = 0 }) {
  if (!enabled || !ensure()) return;
  const t = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (to) osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g); g.connect(sfxBus);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

// ---------------------------------------------------------
export const sfx = {
  // ---- interface ----
  click() { play('ui_click'); },
  tab() { play('ui_tab'); },
  windowOpen() { play('window_open'); },
  windowClose() { play('window_close'); },
  pick() { play('item_pick'); },
  drop() { play('item_drop'); },
  deny() { play('deny'); },
  money() { play('money'); },
  levelUp() {
    play('confirm');
    [523, 659, 784, 1047].forEach((f, i) => tone({ freq: f, dur: 0.24, gain: 0.06, type: 'triangle', delay: 0.06 + i * 0.08 }));
  },

  // ---- movement ----
  footstep(sprinting = false) {
    const now = performance.now();
    const gap = sprinting ? 265 : 430;
    if (now - lastFootstep < gap) return;
    lastFootstep = now;
    play(pickDifferent(STEPS, stepRef), { mix: sprinting ? 'step_sprint' : 'step' });
  },

  // ---- containers ----
  /** the lid noise depends on what is being opened */
  openContainer(type = '') {
    const t = String(type);
    if (/crate|weapon|ammo|ration|grenade|tech|med/.test(t)) play('open_wood');
    else if (/safe|cash|drawer|filecab|pc|toolbox/.test(t)) play('open_metal');
    else if (/scav|pmc|body|jacket|duffle|sportbag|suitcase/.test(t)) play('open_door');
    else play('open_wood');
  },
  search() { play(SEARCHES[Math.floor(Math.random() * SEARCHES.length)]); },
  searchDone() { play('confirm'); },

  // ---- raid state ----
  alert() { play('alert'); },
  hurt() { play('hurt'); },
  thud() { play('thud'); },

  extractStart() { play('extract_alarm'); },
  extractTick(progress) { tone({ freq: 420 + progress * 480, dur: 0.06, gain: 0.05, type: 'sine' }); },
  extracted() {
    play('confirm', { scale: 1.2 });
    [392, 523, 659, 880].forEach((f, i) => tone({ freq: f, dur: 0.34, gain: 0.07, type: 'triangle', delay: 0.1 + i * 0.11 }));
  },
  died() {
    play('thud', { scale: 1.3, rate: 0.7 });
    tone({ freq: 170, to: 46, dur: 1.4, gain: 0.16, type: 'sine', delay: 0.05 });
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
