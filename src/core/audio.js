// =========================================================
// sound
//
// Two sources can back the game, tried in this order at boot:
//
//   assets/sfx-eft/*.ogg    loose clips, there only if someone has run
//                           tools/extract_tarkov_sfx.py against their own
//                           Escape From Tarkov install. Gitignored.
//   assets/sfx-eft/pack.bin the same clips deflated into one container and
//                           sealed with AES-256-GCM (tools/pack_sfx.py).
//                           This is what the repository ships, and the
//                           passphrase is the constant right below.
//
// Whichever answers first wins; every call site talks to the same cue names
// either way, and a cue with no file behind it is a silent no-op.
//
// The key sits in this file on purpose. A static page has to hold it to play
// anything, so hiding it would buy nothing real - the seal is nominal. What
// it does buy is that the pack is not a folder of ready-to-play files: taking
// the audio back out is a deliberate step someone has to choose to take, and
// LICENSE puts the consequences of that on them.
//
// Three buses hang off the master gain — world foley, interface, ambience —
// so the interface can sit under the raid without a separate mixer.
// =========================================================

const LOOSE = { dir: 'assets/sfx-eft/', manifest: 'assets/sfx-eft/manifest.json' };
const SEALED_BLOB = 'assets/sfx-eft/pack.bin';
/** passphrase for the sealed pack; see the note at the top of this file */
export const SEALED_KEY = 'aAzve0EY1zPMn9Z28Z-1rzq3hX_bh36z';
/** header of tools/pack_sfx.py: magic(6) | salt(16) | iv(12) | ciphertext+tag */
const SEALED_MAGIC = 'E2SFX1';
const SEALED_SALT = 16;
const SEALED_IV = 12;
const PBKDF2_ROUNDS = 200000;

/**
 * Cadence and level per gait; `gap` is the floor between two steps.
 *
 * Gait and surface are independent: the gait decides how hard and how often
 * you land, the surface decides what it lands on. Cue names are
 * `step_<surface>_<gait>`. They used to be `step_<gait>` alone with the
 * material baked in, so breaking into a sprint on a concrete floor switched
 * the material to steel grating mid-stride.
 */
const STEP_MIX = {
  walk: { gain: 0.5, rate: [0.94, 1.07], gap: 430 },
  run: { gain: 0.55, rate: [0.97, 1.09], gap: 330 },
  sprint: { gain: 0.62, rate: [1.0, 1.12], gap: 265 },
};
/** the surfaces the pack carries; anything else falls back to the plant floor */
const SURFACES = new Set(['concrete', 'metal', 'tile', 'asphalt']);
const DEFAULT_SURFACE = 'concrete';

const surfaceOr = (s) => (SURFACES.has(s) ? s : DEFAULT_SURFACE);

/**
 * Per-cue mix. `bus` picks the output, `gain` scales it, `limit` is the
 * shortest gap in ms between two plays of the same cue — without it a fast
 * drag across a grid would machine-gun the pickup foley.
 */
const CUE_MIX = {
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
  hit_body: { bus: 'sfx', gain: 0.65 },
  hit_armor: { bus: 'sfx', gain: 0.6 },
  hit_helmet: { bus: 'sfx', gain: 0.6 },
  impact_metal: { bus: 'sfx', gain: 0.4 },
  impact_wood: { bus: 'sfx', gain: 0.4 },
  impact_concrete: { bus: 'sfx', gain: 0.4 },
  ricochet: { bus: 'sfx', gain: 0.4 },
};
const DEFAULT_MIX = { bus: 'sfx', gain: 0.6, limit: 55 };

/**
 * Weapon template -> which bank backs it. Every gun in the game has its own
 * recording rather than sharing one of four class sounds, so an AKS-74U barks
 * shorter than an AK-74N and the Kedr-B is the suppressed bank rather than the
 * bare one. The VPO-136 is an AKM-pattern carbine in the same 7.62x39, so it
 * borrows that bank - it is the one deliberate reuse here.
 */
const WEAPON_CUE = {
  '5644bd2b4bdc2d3b4c8b4572': 'ak74',   // AK-74N
  '57dc2fa62459775949412633': 'aksu',   // AKS-74U
  '59d6088586f774275f37482f': 'akm',    // AKM
  '59e6152586f77473dc057aa1': 'akm',    // VPO-136 Vepr-KM
  '57d14d2524597714373db789': 'kedr',   // PP-91 Kedr
  '57f3c6bd24597738e730fa2f': 'kedrb',  // PP-91-01 Kedr-B, suppressed
  '5448bd6b4bdc2dfc2f8b4569': 'pm',     // Makarov PM
  '56e0598dd2720bb5668b45a6': 'pb',     // PB, suppressed
  '571a12c42459771f627b58a0': 'tt',     // TT-33
  '54491c4f4bdc2db1078b4568': 'mp133',  // MP-133
  '56dee2bdd2720bc8328b4567': 'mp153',  // MP-153
  '576165642459773c7a400233': 'saiga',  // Saiga-12K
};

/**
 * Every shot bank the pack carries, so a bad name cannot select a missing cue.
 * Each bank has `fire_<bank>` and `fire_<bank>_far`; most also have
 * `fire_<bank>_sil` / `_sil_far` for a suppressor fitted (kedrb *is* the
 * Kedr's suppressed bank, the pm cannot mount one, the tt borrows the PB's),
 * and the pb - recorded suppressed - has `fire_pb_unsil` / `_unsil_far` for
 * when its can comes off. `fire()` / `hostileFire()` pick between them.
 */
const BANKS = new Set(['ak74', 'aksu', 'akm', 'kedr', 'kedrb', 'pm', 'pb', 'tt',
  'mp133', 'mp153', 'saiga']);

/**
 * Resolve whatever the caller has into a bank name. Takes a weapon template,
 * or a bare bank name for the scavs, which carry no weapon item.
 *
 * Falls back by calibre when a template is not in the table - a new gun still
 * makes a plausible noise instead of going silent.
 */
function weaponBank(tpl) {
  if (typeof tpl === 'string') return BANKS.has(tpl) ? tpl : 'akm';
  const known = WEAPON_CUE[tpl?.id];
  if (known) return known;
  const cal = tpl?.cal || '';
  if (cal.startsWith('12')) return 'mp133';
  if (tpl?.cat === 'pistol') return cal.startsWith('7.62') ? 'tt' : 'pm';
  if (cal.startsWith('9x')) return 'kedr';
  return cal.startsWith('7.62') ? 'akm' : 'ak74';
}

/**
 * Container type -> the lid it opens with. The rummage loops below are split
 * ten ways by material; this used to be a four-way guess that gave wooden
 * crates a plastic lid and corpses a lid at all. sharedassets8 carries the
 * furniture's own opens, so the two now agree: what rustles like a coat also
 * opens like one.
 *
 * A type absent from this table opens silently, which is deliberate - that is
 * how bodies are handled.
 */
const OPEN_CUE = {
  crate: 'open_wood', ammobox: 'open_wood', weaponbox: 'open_wood',
  weaponbox6: 'open_wood', grenadebox: 'open_wood', rationcrate: 'open_wood',
  toolbox: 'open_case', suitcase: 'open_case', medcase: 'open_case',
  medcrate: 'open_case', pcblock: 'open_case', techcrate: 'open_case',
  safe: 'open_metal', banksafe: 'open_metal',
  drawer: 'open_drawer', filecab: 'open_locker',
  jacket: 'open_jacket',
  sportbag: 'open_bag', duffle: 'open_bag', medbag: 'open_bag',
  cashreg: 'open_cash',
  // deadscav and pmcbody are intentionally absent - a corpse has no lid
};

/**
 * Fallback foley family, by gameplay category.
 *
 * Item sounds come from the template's own `snd` field, which is the game's
 * ItemSound value copied through by tools/build_items.py - so a pill bottle
 * rattles, a bandage rustles and a medkit clicks, instead of every med
 * sharing one guessed sound. This table only catches a template that somehow
 * has no `snd`.
 */
const ITEM_CLASS = {
  ammo: 'ammo_singleround', mag: 'magazine_metal',
  meds: 'med_medkit', food: 'food_tin_can', drink: 'food_bottle',
  armor: 'gear_armor', helmet: 'gear_helmet', backpack: 'gear_backpack',
  rig: 'gear_generic', headset: 'gear_goggles', facecover: 'gear_generic',
  armband: 'item_cloth_generic', glasses: 'gear_goggles',
  weapon: 'weap_ar', pistol: 'weap_pistol', melee: 'knife_generic',
  grenade: 'grenade',
  container: 'container_plastic', secure: 'container_case',
  electronics: 'item_plastic_generic', barter: 'generic',
  valuables: 'jewelry', info: 'item_paper', key: 'keys', money: 'item_money',
};

/**
 * Container type -> rummage loop, by what the thing is actually made of.
 * The install ships ten of these and every one is used here: rummaging a
 * jacket is a coat-pocket rustle, not the cloth-bag loop it used to borrow,
 * and hard cases get the industrial clatter rather than the electronics one.
 */
const SEARCH_CUE = {
  // bare wood: crates and the boxes built like them
  crate: 'search_wood', ammobox: 'search_wood', weaponbox: 'search_wood',
  weaponbox6: 'search_wood', grenadebox: 'search_wood', rationcrate: 'search_wood',
  // hard shells - metal and moulded plastic clattering as you dig
  toolbox: 'search_industrial', suitcase: 'search_industrial',
  medcase: 'search_industrial', medcrate: 'search_industrial',
  // circuit boards and cable
  pcblock: 'search_techno', techcrate: 'search_techno',
  // fabric
  sportbag: 'search_bag', duffle: 'search_bag', medbag: 'search_bag',
  jacket: 'search_jacket',
  // furniture
  safe: 'search_safe', banksafe: 'search_safe',
  drawer: 'search_drawer', filecab: 'search_metal',
  cashreg: 'search_cash',
  // pockets and webbing on a corpse
  deadscav: 'search_body', pmcbody: 'search_body',
};

let ctx = null;
let master = null;
/** a low-pass after the master: open normally, closed down by a concussion */
let muffleNode = null;
let muffled = false;
const buses = { sfx: null, ui: null, ambient: null };
let noiseBuf = null;
let unlocked = false;
let enabled = true;
let volume = 0.7;
let ambientNodes = null;
/** the looping rummage while a container is being searched */
let searchNodes = null;
/** bumped whenever the search changes, so a late decode cannot revive it */
let searchToken = 0;
let lastFootstep = 0;

/** cue -> [file base names] */
let manifest = {};
let packDir = LOOSE.dir;
let packReady = false;

/** file base name -> AudioBuffer | 'pending' | 'failed' */
const buffers = new Map();
/** file base name -> ogg bytes, when the sealed pack is what booted */
const packBlobs = new Map();
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

const asset = (path) => new URL(`../../${path}`, import.meta.url);

function packLoaded() {
  packReady = true;
  if (unlocked) prefetch();
}

/** pick whichever source is actually deployed */
async function loadManifest() {
  if (await tryLoose()) return;   // a local extraction, if there is one
  if (await trySealed()) return;  // what the repository ships
  packReady = true;   // nothing to play; every cue becomes a no-op
}

/** the loose clips, next to their manifest */
async function tryLoose() {
  try {
    const res = await fetch(asset(LOOSE.manifest));
    if (!res.ok) return false;
    manifest = await res.json();
    packDir = LOOSE.dir;
    packLoaded();
    return true;
  } catch {
    return false;
  }
}

/**
 * One request for the sealed container, then unseal it as the page loads:
 * PBKDF2 the passphrase into an AES-256-GCM key, decrypt, inflate, and cut the
 * result into one ogg per clip. Any missing piece - no pack.bin, an engine
 * without DecompressionStream - just falls through to the next source.
 */
async function trySealed() {
  if (!window.crypto?.subtle || typeof DecompressionStream !== 'function') return false;
  try {
    const packRes = await fetch(asset(SEALED_BLOB));
    if (!packRes.ok) return false;

    const bytes = new Uint8Array(await packRes.arrayBuffer());
    if (new TextDecoder().decode(bytes.subarray(0, SEALED_MAGIC.length)) !== SEALED_MAGIC) return false;

    let at = SEALED_MAGIC.length;
    const salt = bytes.subarray(at, (at += SEALED_SALT));
    const iv = bytes.subarray(at, (at += SEALED_IV));

    const material = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode(SEALED_KEY), 'PBKDF2', false, ['deriveKey'],
    );
    const key = await crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: PBKDF2_ROUNDS, hash: 'SHA-256' },
      material, { name: 'AES-GCM', length: 256 }, false, ['decrypt'],
    );
    const squeezed = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, bytes.subarray(at));

    const inflated = new Response(
      new Blob([squeezed]).stream().pipeThrough(new DecompressionStream('deflate-raw')),
    );
    const raw = new Uint8Array(await inflated.arrayBuffer());

    const headLen = new DataView(raw.buffer, raw.byteOffset, 4).getUint32(0, true);
    const header = JSON.parse(new TextDecoder().decode(raw.subarray(4, 4 + headLen)));
    const body = raw.subarray(4 + headLen);
    for (const f of header.files) packBlobs.set(f.name, body.slice(f.off, f.off + f.len));

    manifest = header.manifest;
    packDir = LOOSE.dir;
    packLoaded();
    return true;
  } catch {
    return false;   // wrong key, damaged pack, no pack at all
  }
}

/**
 * Warm the cues that must not be late the first time they fire.
 *
 * The rummage loops are in here for a reason: a cue that is not decoded yet
 * cannot start, and searchStart has to poll until it is. A jacket takes two
 * seconds to search, so a quarter-second of decode was most of the sound
 * missing - the container popped open in silence, which read as the rummage
 * being broken rather than late.
 */
function prefetch() {
  if (!packReady) return;
  const warm = [
    'ui_click', 'ui_hover',
    // every surface's walk/run, so crossing from concrete onto grating does
    // not land silently while the new set decodes
    ...Object.keys(manifest).filter((c) => /^step_\w+_(walk|run)$/.test(c)),
    ...Object.keys(manifest).filter((c) => c.startsWith('search_') || c.startsWith('open_')),
  ];
  for (const cue of warm) {
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
  muffleNode = ctx.createBiquadFilter();
  muffleNode.type = 'lowpass';
  muffleNode.frequency.value = muffled ? 700 : 20000;
  muffleNode.Q.value = 0.4;
  master.connect(muffleNode);
  muffleNode.connect(ctx.destination);

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
  const sealed = packBlobs.get(name);
  // decodeAudioData detaches what it is given, so hand it a copy and keep ours
  const bytes = sealed
    ? Promise.resolve(sealed.slice().buffer)
    : fetch(asset(`${packDir}${name}.ogg`))
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))));
  bytes
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
export function audioPack() {
  return { dir: packDir, cues: Object.keys(manifest).length, sealed: packBlobs.size > 0 };
}
function persist() {
  try { localStorage.setItem('escape2d.audio', JSON.stringify({ enabled, volume })); } catch { /* ignore */ }
}

/**
 * Poll a decoding clip and fire it once, as long as it lands soon enough to
 * still belong to the moment that asked for it. `late` marks the retry so it
 * cannot schedule another one behind itself.
 */
function waitAndPlay(cue, name, mix, asked, tries = 0) {
  setTimeout(() => {
    const buf = buffers.get(name);
    if (buf === 'pending' || buf === undefined) {
      if (tries < 8) waitAndPlay(cue, name, mix, asked, tries + 1);
      return;
    }
    if (buf === 'failed') return;
    // half a second late is still the same event; anything slower is not
    if (performance.now() - asked > 500) return;
    play(cue, { ...mix, late: true, limit: 0 });
  }, 60);
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

  const name = names[i];
  const buf = buffers.get(name);
  if (buf === undefined || buf === 'pending') {
    // First use of this cue. Dropping it here is why the very first pickup of
    // each item family, and the first rummage of a raid, came out silent:
    // there are far too many cues to prefetch them all, so decode this one
    // and fire it as soon as it lands instead of losing it.
    if (buf === undefined) load(name);
    if (!mix.late) waitAndPlay(cue, name, mix, now);
    return false;
  }
  if (buf === 'failed') return false;

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
   * One step, rate-limited by gait, on whatever the player is standing on.
   * Variants are cycled so the same sample never plays twice running and each
   * is pitch-shifted slightly.
   */
  footstep(sprinting = false, running = false, surface = DEFAULT_SURFACE) {
    if (!enabled || !ensure()) return;
    const gait = sprinting ? 'sprint' : running ? 'run' : 'walk';
    const mix = STEP_MIX[gait];
    const now = performance.now();
    if (now - lastFootstep < mix.gap) return;
    lastFootstep = now;
    const surf = surfaceOr(surface);
    // fall back along the surface axis, never the gait axis: a missing set
    // should change the material, not turn a sprint into a walk
    const cue = hasCue(`step_${surf}_${gait}`)
      ? `step_${surf}_${gait}`
      : `step_${DEFAULT_SURFACE}_${gait}`;
    play(cue, { gain: mix.gain, rate: mix.rate, limit: 0 });
  },

  /** the player stops moving — one settling scuff on the same surface */
  halt(surface = DEFAULT_SURFACE) {
    const surf = surfaceOr(surface);
    const cue = hasCue(`step_${surf}_stop`) ? `step_${surf}_stop` : `step_${DEFAULT_SURFACE}_stop`;
    play(cue, { gain: 0.4 });
  },

  /** interface cues, all on the quieter ui bus */
  ui(name) { play(`ui_${name}`); },

  /** trader cues */
  trade(name) { play(`trade_${name}`); },

  /**
   * Item foley. Pass the template - `sfx.item(item.tpl, 'pickup')` - and it
   * uses the item's own ItemSound family, which is what the real game keys
   * off. A bare category string still works for older call sites.
   */
  item(tplOrCat, action = 'pickup') {
    const cls = typeof tplOrCat === 'string'
      ? (ITEM_CLASS[tplOrCat] || 'generic')
      : (tplOrCat?.snd || ITEM_CLASS[tplOrCat?.cat] || 'generic');
    // fall back on whether the cue exists, never on whether play() succeeded:
    // a cue that is merely still decoding returns false and fires a moment
    // later, and treating that as failure played the generic one over it
    const cue = `item_${cls}_${action}`;
    play(hasCue(cue) ? cue : `item_generic_${action}`);
  },

  /**
   * Rummaging runs for as long as the search does, so it is one looping
   * source held open rather than a cue re-fired on every item that turns up -
   * these loops are 4-6s and the finds land about a second apart, so
   * retriggering stacked four copies of the same clip on top of itself.
   */
  searchStart(type) {
    const cue = SEARCH_CUE[type] || 'search_wood';
    if (searchNodes && searchNodes.cue === cue) return;
    sfx.searchStop();
    if (!enabled || !ensure()) return;
    const names = manifest[cue];
    if (!names || !names.length) return;
    const name = names[0];
    const buf = buffers.get(name);
    if (buf === undefined) {
      load(name);
      const want = ++searchToken;
      // come back once it has decoded, unless the search ended meanwhile
      setTimeout(() => { if (want === searchToken && !searchNodes) sfx.searchStart(type); }, 250);
      return;
    }
    if (buf === 'pending') {
      const want = ++searchToken;
      setTimeout(() => { if (want === searchToken && !searchNodes) sfx.searchStart(type); }, 250);
      return;
    }
    if (buf === 'failed') return;

    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const g = ctx.createGain();
    g.gain.value = 0.0001;
    g.gain.exponentialRampToValueAtTime(0.5, ctx.currentTime + 0.08);
    src.connect(g);
    g.connect(buses.sfx);
    src.start();
    searchNodes = { src, gain: g, cue };
  },

  /** let the rummage fall away rather than cutting it dead */
  searchStop() {
    searchToken++;
    if (!searchNodes) return;
    const { src, gain } = searchNodes;
    searchNodes = null;
    try {
      const t = ctx.currentTime;
      gain.gain.cancelScheduledValues(t);
      gain.gain.setValueAtTime(Math.max(0.0001, gain.gain.value), t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
      src.stop(t + 0.14);
    } catch { /* already stopped */ }
  },

  /** a container lid, picked from what the thing is actually made of */
  openContainer(type) {
    const cue = OPEN_CUE[type];
    if (!cue) return;   // corpses, and anything else with nothing to open
    play(cue, { gain: 0.5, rate: [0.97, 1.04] });
  },

  /**
   * Consuming a med or a ration, using the item's own family so a painkiller
   * rattles and a bandage tears rather than both clicking like a medkit.
   */
  use(tplOrCat) {
    const cls = typeof tplOrCat === 'string'
      ? (ITEM_CLASS[tplOrCat] || 'med_medkit')
      : (tplOrCat?.snd || ITEM_CLASS[tplOrCat?.cat] || 'med_medkit');
    // a few families have no _use clip in the bundle; those handle instead
    const cue = `item_${cls}_use`;
    play(hasCue(cue) ? cue : `item_${cls}_pickup`);
  },

  /**
   * The player's own weapon, from that weapon's own bank.
   *
   * `limit` is a real cap here rather than 0. The Kedr runs at 900rpm, so an
   * uncapped cue stacked fifteen voices a second and the reports smeared into
   * one another; 45ms lets every shot through up to ~1300rpm and drops only
   * what would have overlapped inaudibly anyway.
   */
  fire(tpl, opts = {}) {
    play(fireCue(tpl, opts, ''), { rate: [0.97, 1.04], limit: 45 });
  },

  /**
   * Someone else shooting. Same bank, `_distant` variants, quieter - which is
   * what makes a scav firing across the hall read as coming from over there.
   * Until this existed hostile fire made no sound at all.
   */
  hostileFire(tpl, opts = {}) {
    play(fireCue(tpl, opts, '_far'), { rate: [0.96, 1.05], limit: 45 });
  },

  /**
   * A round landing on someone. `armor` and `helmet` are the deflections,
   * which ring rather than thump, so the player can tell a stopped round from
   * one that went through.
   */
  hit(kind = 'body') {
    play(kind === 'helmet' ? 'hit_helmet' : kind === 'armor' ? 'hit_armor' : 'hit_body',
      { rate: [0.94, 1.07], limit: 40 });
  },

  /** a round landing on the map instead of a person */
  impact(surface = 'concrete') {
    const cue = surface === 'metal' ? 'impact_metal'
      : surface === 'wood' ? 'impact_wood'
        : surface === 'ricochet' ? 'ricochet'
          : 'impact_concrete';
    play(cue, { rate: [0.93, 1.08], limit: 40 });
  },

  death() { play('death'); },
  extract() { play('extract_done'); },

  /**
   * A concussion: the world goes dull and far away. A low-pass on the whole
   * mix, eased so it fades in and out rather than snapping.
   */
  muffle(on) {
    on = !!on;
    if (on === muffled) return;
    muffled = on;
    if (!ctx || !muffleNode) return;
    muffleNode.frequency.cancelScheduledValues(ctx.currentTime);
    muffleNode.frequency.setTargetAtTime(on ? 700 : 20000, ctx.currentTime, on ? 0.15 : 0.6);
  },

  // ---- weapon handling: assembly, magazines, cartridges ----
  //
  // Per-weapon banks again, from the same install: the AK's own magazine
  // seating and bolt, the Makarov's slide, the MP-133's shells going into the
  // tube. A weapon without its own handling clips borrows the nearest one
  // (the TT and PB use the PM's, the MP-153 the MP-133's) - see sfx_picks.py.

  /** the modding screen opening and closing */
  modding(open = true) { play(open ? 'modding_open' : 'modding_close'); },

  /**
   * A part going onto a gun. A magazine seats with the weapon's own mag-in;
   * anything else clicks with the game's install cue, split the way the game
   * splits it: a vital part (barrel, receiver, grip ...) is the heavier
   * `vital` clip, a functional part (sight, tactical) the light `func` one and
   * the rest are `gear`.
   */
  modInstall(slot, part) {
    if (part?.isMag) { play(`magin_${handlingBank(slot.owner?.root?.tpl)}`, { rate: [0.97, 1.03] }); return; }
    const t = part?.tpl?.modType;
    const kind = slot?.required ? 'vital'
      : (t === 'reflex' || t === 'scope' || t === 'ironsight' || t === 'tactical') ? 'func' : 'gear';
    play(`mod_install_${kind}`);
  },

  /** a part coming off: a magazine drops with the mag-out, the rest with the part's own foley */
  modRemove(slot, part) {
    if (part?.isMag) { play(`magout_${handlingBank(slot.owner?.root?.tpl)}`, { rate: [0.97, 1.03] }); return; }
    sfx.item(part?.tpl, 'pickup');
  },

  /**
   * Cartridges going into a magazine: one press per round would be a
   * machine-gun of clicks, so a burst of up to four presses is spread over a
   * short beat, which is what the loading animation sounds like.
   */
  ammoLoad(magTpl, n = 1) {
    const cue = magTpl?.cal?.startsWith('12') ? 'shell_load' : 'ammo_load';
    const presses = Math.min(4, Math.max(1, n));
    for (let i = 0; i < presses; i++) setTimeout(() => play(cue, { rate: [0.95, 1.06], limit: 0 }), i * 110);
  },

  ammoUnload(magTpl, n = 1) {
    const cue = magTpl?.cal?.startsWith('12') ? 'shell_unload' : 'ammo_unload';
    const presses = Math.min(4, Math.max(1, n));
    for (let i = 0; i < presses; i++) setTimeout(() => play(cue, { rate: [0.95, 1.06], limit: 0 }), i * 90);
  },

  /** the bolt / slide / pump cycled by hand */
  weaponBolt(tpl) { play(`bolt_${handlingBank(tpl)}`, { rate: [0.97, 1.03] }); },

  /**
   * A folding stock going in or out. The pack names these
   * `fold_<open|close>_<bank>` - kind first, like every other handling cue -
   * and this used to ask for `fold_<bank>_<open|close>`, so folding was silent.
   */
  weaponFold(tpl, folded) {
    play(`fold_${folded ? 'close' : 'open'}_${handlingBank(tpl)}`);
  },

  // ---- weapon actions: the trigger, the selector, checks, stoppages ----
  //
  // Same per-handling-bank banks as above, `<kind>_<bank>`. Coverage in the
  // install is thin here so most banks borrow (the AKS-74U and AKM click with
  // the AK-74's trigger, every AK checks its chamber with the Saiga's slide,
  // the shotguns jam like the Saiga) - sfx_picks.py `_ACTIONS` spells out
  // which. A bank with no cue for a kind is a silent no-op, never a fallback
  // to a wrong gun.

  /** trigger pulled on an empty chamber */
  weaponDry(tpl) { play(`dry_${handlingBank(tpl)}`, { rate: [0.98, 1.02], limit: 80 }); },

  /**
   * The fire selector thrown. Only the AKs and the Kedr have one - the
   * pistols, shotguns and VPO-136 are single-fire and have no cue, so this
   * quietly does nothing for them.
   */
  fireSelector(tpl) { play(`selector_${handlingBank(tpl)}`, { rate: [0.97, 1.03] }); },

  /** the magazine pulled part way out to look at it */
  magCheck(tpl) { play(`magcheck_${handlingBank(tpl)}`, { rate: [0.97, 1.03] }); },

  /** the bolt eased back to see whether a round is chambered */
  chamberCheck(tpl) { play(`chambercheck_${handlingBank(tpl)}`, { rate: [0.97, 1.03] }); },

  /** a round put into the chamber by hand (`loaded`), or taken back out */
  chamberRound(tpl, loaded = true) {
    play(`${loaded ? 'chamber' : 'unchamber'}_${handlingBank(tpl)}`, { rate: [0.97, 1.03] });
  },

  /** the bolt catching on a stoppage */
  weaponJam(tpl) { play(`jam_${handlingBank(tpl)}`, { rate: [0.97, 1.03] }); },

  // ---- out of raid: repair, builds, ammo boxes ----

  /** a repair finished - the game's own sting */
  repairDone() { play('repair_done', { bus: 'ui', gain: 0.5 }); },

  /** the weapon repair kit being applied */
  repairKit() { play('repair_kit_use'); },

  /** a build assembled from parts */
  buildAssemble() { play('build_assemble', { bus: 'ui', gain: 0.5 }); },

  /** a weapon stripped back to parts */
  buildStrip() { play('build_strip', { bus: 'ui', gain: 0.5 }); },

  /**
   * An ammo box torn open. The 12ga box has its own clip in the install
   * (`ammo_shotgun_use`); every other calibre shares `ammo_pack_generic_use`.
   */
  ammoUnpack(tpl) {
    play(tpl?.cal?.startsWith('12') ? 'ammo_unpack_12ga' : 'ammo_unpack');
  },
};

/**
 * Which shot cue a weapon fires. `opts.suppressed === true` asks for the
 * bank's `_sil` cue and gets it only when the pack has one - a bank without
 * (pm, kedr, kedrb) keeps its plain report rather than going quiet.
 * `opts.suppressed === false` on the PB, whose plain bank is the suppressed
 * recording, swaps in `fire_pb_unsil`. A caller that passes nothing gets
 * exactly what it always did. `tail` is '' for the player, '_far' for a scav.
 */
function fireCue(tpl, opts, tail) {
  const bank = weaponBank(tpl);
  if (opts?.suppressed === true) {
    const sil = `fire_${bank}_sil${tail}`;
    if (hasCue(sil)) return sil;
  } else if (opts?.suppressed === false && bank === 'pb') {
    const bare = `fire_pb_unsil${tail}`;
    if (hasCue(bare)) return bare;
  }
  return `fire_${bank}${tail}`;
}

/**
 * Handling clips are recorded per weapon family too, but the set is smaller
 * than the shot banks: the AKM shares the AK-74's slide, the TT and PB have
 * no handling of their own and borrow the Makarov's, the MP-153 has a slide
 * but its shells go in like the MP-133's. `HANDLING` names the bank that
 * actually has clips for each shot bank.
 *
 * Every handling bank carries `magin_` / `magout_` / `bolt_`, `dry_`,
 * `magcheck_`, `chambercheck_`, `chamber_` / `unchamber_` and `jam_`;
 * `fold_open_` / `fold_close_` exist for the folders (aksu, akm, kedr, saiga)
 * and `selector_` for the AKs and the Kedr. sfx_picks.py `_HANDLING` and
 * `_ACTIONS` are the matching tables and say which clips are borrowed.
 */
const HANDLING = {
  ak74: 'ak74', aksu: 'aksu', akm: 'akm', kedr: 'kedr', kedrb: 'kedr',
  pm: 'pm', pb: 'pm', tt: 'pm', mp133: 'mp133', mp153: 'mp153', saiga: 'saiga',
};
function handlingBank(tpl) {
  return HANDLING[weaponBank(tpl)] || 'ak74';
}

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
