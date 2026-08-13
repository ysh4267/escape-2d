// =========================================================
// sound
//
// Two packs can back the game:
//
//   assets/sfx-eft/   the real thing, pulled out of a local Escape From
//                     Tarkov install by tools/extract_tarkov_sfx.py. Not
//                     redistributable, so it is gitignored and simply absent
//                     from the published build.
//   assets/sfx/       the CC0 fallback that ships with the repo.
//
// Whichever is present at boot wins; every call site talks to the same cue
// names either way, and a cue with no file behind it is a silent no-op.
//
// Three buses hang off the master gain — world foley, interface, ambience —
// so the interface can sit under the raid without a separate mixer.
// =========================================================

const PACKS = [
  { dir: 'assets/sfx-eft/', manifest: 'assets/sfx-eft/manifest.json' },
  { dir: 'assets/sfx/', manifest: 'assets/sfx/manifest.json' },
];

/** cadence and level per gait; `gap` is the floor between two steps */
const STEP_MIX = {
  walk: { cue: 'step_walk', gain: 0.5, rate: [0.94, 1.07], gap: 430 },
  run: { cue: 'step_run', gain: 0.55, rate: [0.97, 1.09], gap: 330 },
  sprint: { cue: 'step_sprint', gain: 0.62, rate: [1.0, 1.12], gap: 265 },
};

/**
 * Per-cue mix. `bus` picks the output, `gain` scales it, `limit` is the
 * shortest gap in ms between two plays of the same cue — without it a fast
 * drag across a grid would machine-gun the pickup foley.
 */
const CUE_MIX = {
  found: { bus: 'sfx', gain: 0.55 },
  death: { bus: 'sfx', gain: 0.7 },
  extract_done: { bus: 'ui', gain: 0.65 },
  ui_hover: { bus: 'ui', gain: 0.22, limit: 60 },
  ui_click: { bus: 'ui', gain: 0.45 },
  ui_context: { bus: 'ui', gain: 0.4 },
  ui_error: { bus: 'ui', gain: 0.5, limit: 400 },
  ui_close: { bus: 'ui', gain: 0.35 },
  ui_window_open: { bus: 'ui', gain: 0.45 },
  ui_inspect_open: { bus: 'ui', gain: 0.4 },
  ui_inspect_close: { bus: 'ui', gain: 0.4 },
  ui_equip: { bus: 'sfx', gain: 0.55 },
  ui_exp: { bus: 'ui', gain: 0.4, limit: 900 },
  trade_tab: { bus: 'ui', gain: 0.45 },
  trade_click: { bus: 'ui', gain: 0.45 },
  trade_buy: { bus: 'ui', gain: 0.5 },
  trade_deal: { bus: 'ui', gain: 0.6 },
  fire_pistol: { bus: 'sfx', gain: 0.5 },
  fire_rifle: { bus: 'sfx', gain: 0.5 },
  fire_shotgun: { bus: 'sfx', gain: 0.5 },
  fire_smg: { bus: 'sfx', gain: 0.5 },
};
const DEFAULT_MIX = { bus: 'sfx', gain: 0.6, limit: 55 };

/**
 * Gameplay category -> the item-foley family it sounds like. The families are
 * the game's own (itemsounds.bundle), so a helmet really does land with the
 * helmet sound.
 */
const ITEM_CLASS = {
  ammo: 'ammo', mag: 'mag',
  meds: 'med', food: 'food', drink: 'drink',
  armor: 'armor', helmet: 'helmet', backpack: 'backpack',
  rig: 'gear', headset: 'gear', facecover: 'gear', armband: 'gear',
  glasses: 'glasses',
  weapon: 'weapon', pistol: 'pistol', melee: 'melee', grenade: 'metal',
  container: 'case', secure: 'case',
  electronics: 'metal', barter: 'generic', valuables: 'metal',
  info: 'generic', key: 'metal', money: 'generic',
};

/** container type -> the rummage loop that fits its material */
const SEARCH_CUE = {
  crate: 'search_wood', ammobox: 'search_wood', weaponbox: 'search_wood',
  weaponbox6: 'search_wood', grenadebox: 'search_wood', rationcrate: 'search_wood',
  suitcase: 'search_bag', medbag: 'search_bag', sportbag: 'search_bag',
  duffle: 'search_bag', medcase: 'search_bag',
  toolbox: 'search_techno', techcrate: 'search_techno', pcblock: 'search_techno',
  medcrate: 'search_techno',
  safe: 'search_safe', banksafe: 'search_safe',
  cashreg: 'search_cash',
  drawer: 'search_drawer', filecab: 'search_metal',
  jacket: 'search_bag',
  deadscav: 'search_body', pmcbody: 'search_body',
};

let ctx = null;
let master = null;
const buses = { sfx: null, ui: null, ambient: null };
let noiseBuf = null;
let unlocked = false;
let enabled = true;
let volume = 0.7;
let ambientNodes = null;
let lastFootstep = 0;

/** cue -> [file base names] */
let manifest = {};
let packDir = PACKS[1].dir;
let packReady = false;

/** file base name -> AudioBuffer | 'pending' | 'failed' */
const buffers = new Map();
/** cue -> last variant index, so the same file never plays twice running */
const lastVariant = new Map();
/** cue -> last play time, for the per-cue rate limit */
const lastPlayed = new Map();

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

  loadManifest();

  const unlock = () => {
    if (unlocked) return;
    unlocked = true;
    ensure();
    if (ctx && ctx.state === 'suspended') ctx.resume();
    prefetch();
  };
  window.addEventListener('pointerdown', unlock, { passive: true });
  window.addEventListener('keydown', unlock, { passive: true });
}

/** pick whichever pack is actually deployed */
async function loadManifest() {
  for (const pack of PACKS) {
    try {
      const res = await fetch(new URL(`../../${pack.manifest}`, import.meta.url));
      if (!res.ok) continue;
      const data = await res.json();
      // the CC0 pack ships a bare array of footstep names; the extracted pack
      // ships the full cue map
      manifest = Array.isArray(data) ? { step_walk: data, step_run: data, step_sprint: data } : data;
      packDir = pack.dir;
      packReady = true;
      if (unlocked) prefetch();
      return;
    } catch { /* try the next pack */ }
  }
  packReady = true;   // nothing to play; every cue becomes a no-op
}

/** warm the cues that must not be late the first time they fire */
function prefetch() {
  if (!packReady) return;
  for (const cue of ['step_walk', 'step_run', 'step_sprint', 'ui_click', 'ui_hover', 'found']) {
    for (const name of manifest[cue] || []) load(name);
  }
}

function ensure() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();

  master = ctx.createGain();
  master.gain.value = enabled ? volume : 0;
  master.connect(ctx.destination);

  for (const [name, level] of [['sfx', 1], ['ui', 0.85], ['ambient', 0]]) {
    const g = ctx.createGain();
    g.gain.value = level;
    g.connect(master);
    buses[name] = g;
  }

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
  fetch(new URL(`../../${packDir}${name}.ogg`, import.meta.url))
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
export function audioPack() { return { dir: packDir, cues: Object.keys(manifest).length }; }
function persist() {
  try { localStorage.setItem('escape2d.audio', JSON.stringify({ enabled, volume })); } catch { /* ignore */ }
}

// ---------------------------------------------------------
/**
 * Fire one cue. Unknown cues, cues with no file and a muted context are all
 * silent no-ops, so call sites never have to guard.
 */
export function play(cue, opts = {}) {
  if (!enabled || !cue || !ensure()) return false;
  const names = manifest[cue];
  if (!names || !names.length) return false;

  const mix = { ...DEFAULT_MIX, ...(CUE_MIX[cue] || {}), ...opts };
  const now = performance.now();
  if (mix.limit && now - (lastPlayed.get(cue) || -1e9) < mix.limit) return false;

  let i = Math.floor(Math.random() * names.length);
  if (names.length > 1 && i === lastVariant.get(cue)) i = (i + 1) % names.length;
  lastVariant.set(cue, i);

  const buf = buffers.get(names[i]);
  if (buf === undefined) { load(names[i]); return false; }
  if (buf === 'pending' || buf === 'failed') return false;

  lastPlayed.set(cue, now);

  const src = ctx.createBufferSource();
  src.buffer = buf;
  if (mix.rate) src.playbackRate.value = rnd(mix.rate[0], mix.rate[1]);
  const g = ctx.createGain();
  g.gain.value = mix.gain;
  src.connect(g);
  g.connect(buses[mix.bus] || buses.sfx);
  src.start();
  return true;
}

/** true when a cue has audio behind it — used by the tests */
export function hasCue(cue) { return !!(manifest[cue] && manifest[cue].length); }

// ---------------------------------------------------------
export const sfx = {
  /**
   * One step, rate-limited by gait. Variants are cycled so the same sample
   * never plays twice running and each is pitch-shifted slightly.
   */
  footstep(sprinting = false, running = false) {
    if (!enabled || !ensure()) return;
    const mix = sprinting ? STEP_MIX.sprint : running ? STEP_MIX.run : STEP_MIX.walk;
    const now = performance.now();
    if (now - lastFootstep < mix.gap) return;
    lastFootstep = now;
    // the walk set doubles for every gait in the CC0 fallback
    const cue = hasCue(mix.cue) ? mix.cue : 'step_walk';
    play(cue, { gain: mix.gain, rate: mix.rate, limit: 0 });
  },

  /** the player stops moving */
  halt() { play('step_stop', { gain: 0.4 }); },

  /** interface cues, all on the quieter ui bus */
  ui(name) { play(`ui_${name}`); },

  /** trader cues */
  trade(name) { play(`trade_${name}`); },

  /**
   * Item foley for a gameplay category: sfx.item('meds', 'pickup').
   * Falls back to the generic family for anything unmapped.
   */
  item(cat, action = 'pickup') {
    const cls = ITEM_CLASS[cat] || 'generic';
    if (!play(`item_${cls}_${action}`)) play(`item_generic_${action}`);
  },

  /** the rummage loop that matches a container type */
  search(type) { play(SEARCH_CUE[type] || 'search_wood', { gain: 0.5 }); },

  /** a container lid, picked from the container's material */
  openContainer(type) {
    const cue = type === 'safe' || type === 'banksafe' || type === 'filecab' ? 'open_metal'
      : type === 'suitcase' || type === 'medcase' ? 'open_case'
        : type === 'jacket' || type === 'sportbag' || type === 'duffle' ? 'open_pouch'
          : 'open_plastic';
    play(cue, { gain: 0.5 });
  },

  /** consuming a med or a ration */
  use(cat) {
    play(cat === 'food' ? 'use_food' : cat === 'drink' ? 'use_drink' : 'use_med');
  },

  /** weapon report, chosen from the weapon's own class */
  fire(tpl) {
    const cal = tpl?.cal || '';
    const cue = tpl?.cat === 'pistol' ? 'fire_pistol'
      : cal.startsWith('12') ? 'fire_shotgun'
        : cal.startsWith('9x') ? 'fire_smg'
          : 'fire_rifle';
    play(cue, { rate: [0.96, 1.05], limit: 0 });
  },

  found() { play('found'); },
  death() { play('death'); },
  extract() { play('extract_done'); },
};

// ---------------------------------------------------------
// ambience
//
// The extracted pack carries the plant's own bed, which just loops. Without
// it a synthesised drone stands in so the raid is never silent.
// ---------------------------------------------------------
export function startAmbient() {
  if (!ensure() || ambientNodes) return;
  if (hasCue('amb_factory')) {
    const name = manifest.amb_factory[0];
    const buf = buffers.get(name);
    if (buf === undefined) {
      load(name);
      // come back once it has decoded
      setTimeout(() => { if (!ambientNodes) startAmbient(); }, 400);
      return;
    }
    if (buf !== 'pending' && buf !== 'failed') {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      src.connect(buses.ambient);
      src.start();
      fadeAmbient(0.75, 2.5);
      ambientNodes = { src };
      return;
    }
    if (buf === 'pending') { setTimeout(() => { if (!ambientNodes) startAmbient(); }, 400); return; }
  }
  ambientNodes = synthAmbient();
  fadeAmbient(0.5, 2.5);
}

function fadeAmbient(to, secs) {
  const t = ctx.currentTime;
  buses.ambient.gain.cancelScheduledValues(t);
  buses.ambient.gain.setValueAtTime(Math.max(0.0001, buses.ambient.gain.value), t);
  buses.ambient.gain.exponentialRampToValueAtTime(to, t + secs);
}

function synthAmbient() {
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
  lp.connect(buses.ambient);
  hiss.connect(hissFilt); hissFilt.connect(hissGain); hissGain.connect(buses.ambient);

  drone.start(t); drone2.start(t); hiss.start(t); lfo.start(t);
  return { drone, drone2, hiss, lfo };
}

export function stopAmbient() {
  if (!ctx || !ambientNodes) return;
  fadeAmbient(0.0001, 0.8);
  const nodes = ambientNodes;
  ambientNodes = null;
  setTimeout(() => {
    for (const n of Object.values(nodes)) { try { n.stop(); } catch { /* already stopped */ } }
  }, 1000);
}
