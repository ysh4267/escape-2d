// =========================================================
// gunplay: what the parts and the cartridge do once the trigger is pulled
//
// Everything the modding screen shows now has a consequence in the field:
//  - the fire selector (B) walks the weapon's modes; semi fires per pull, a
//    burst fires its count per pull, auto runs at the cyclic rate
//  - the shot's spread comes from the aggregate stats: the receiver's MOA,
//    the ergonomics deciding how fast the aim settles after moving, vertical
//    recoil climbing the aim across a string and horizontal recoil scattering
//    it, the round's shotgun dispersion for pellets, the body's aim modifier
//  - the round decides what happens on the target: penetration against the
//    armour class worn down by its durability, blunt damage when it is
//    stopped, fragmentation, and the armour losing durability to it either
//    way (ballistics.js is the curve, this is the rest)
//  - the gun wears with every shot (durability burn of gun x parts x round),
//    heats up, and below its safe durability it starts to misfire, fail to
//    feed and jam, at the weapon's base malfunction chance scaled by the
//    round and the magazine; a stoppage has to be cleared (R)
//  - reloads run on the raid clock: an external magazine is swapped for the
//    fullest compatible one carried (the old one stowed, or dropped when there
//    is no room, as in the game), a tube gun is fed shell by shell, and an
//    empty chamber gets a round racked in
//  - a magazine check (T) tells you what is in the gun the way the game does:
//    exact only through the magazine's own windows, otherwise a guess
//
// Sources: the wiki's Ballistics, Armor and Weapon Malfunctions pages
// (tools/cache/wiki_*.txt), the SPT 3.10.1 item and globals dumps for every
// number on an item, and the client's penetration curve in ballistics.js.
// Numbers that the game keeps in the client rather than the item dumps
// (aim settle, spread scale, malfunction thresholds) are named constants
// below and say where they come from.
// =========================================================

import { clamp } from '../core/util.js';
import { sfx } from '../core/audio.js';
import { penChance } from '../inventory/ballistics.js';
import { weaponStats, takeRound, roundsInWeapon, installMod, loadAmmo, canLoad } from '../inventory/weapon.js';
import { detach } from '../inventory/model.js';
import { HIT_WEIGHTS } from './health.js';

// ---------------------------------------------------------
// tuning
// ---------------------------------------------------------
/** the fire selector's labels, in the HUD */
export const MODE_LABEL = { single: 'SEMI', burst: 'BURST', fullauto: 'AUTO', doubleaction: 'DA', doublet: 'DOUBLE' };

/** a standing person is about this wide (radius, m) for the sake of a hit */
const TARGET_RADIUS = 0.42;
/** the aim never sits perfectly still: base sway (rad) — about 20 cm at 20 m */
const BASE_SWAY = 0.010;
/** the sway right after a move / a turn, before the aim settles (rad) */
const UNSETTLED_SWAY = 0.045;
/** how much of the MOA (which is a radius at 100 m) reads as spread */
const MOA_WEIGHT = 2.5;
/** on the move / at a sprint the sight is not on the target */
const MOVE_SWAY = 0.022;
const SPRINT_SWAY = 0.075;
/** a target on the move is harder to keep the sight on */
const MOVING_TARGET_SWAY = 0.007;
/** vertical recoil climbs the aim by this many rad per point, per shot */
const RECOIL_UP = 0.000085;
/** horizontal recoil scatters the string by this many rad per point */
const RECOIL_SIDE = 0.000030;
/** recoil recovers: linear plus proportional (the game's convergence) */
const RECOIL_RECOVER = 0.05;
const RECOIL_RECOVER_K = 3.2;
/** the pellets of a shell: ShotgunDispersion -> rad of extra spread per pellet */
const PELLET_SPREAD = 0.0018;

/**
 * Durability burn per shot. The item dumps only give the ratios (the gun's
 * DurabilityBurnRatio, each part's, the round's DurabilityBurnModificator);
 * the base is the client's. ~1 point over a magazine of ordinary rounds
 * through a stock rifle, which is what the game does.
 */
const WEAR_PER_SHOT = 0.017;

/**
 * Malfunctions (wiki: Weapon Malfunctions; globals Malfunction). "Mechanical
 * malfunctions do not occur in weapons with a durability of greater than
 * 93%" (DurRangeToIgnoreMalfs 93-100); under the line the weapon's
 * BaseMalfunctionChance scales in, the magazine's MalfunctionChance and the
 * round's misfire / feed factors on top. Which kind it is follows the
 * globals' weights (jams lead for a worn gun, misfires for a bad round, a
 * failure to feed for a big magazine); a hard slide only on a pistol that is
 * nearly gone ("5% and below"). Clearing takes the seconds it takes to rack
 * the bolt, work the round out, or hammer a stuck slide.
 */
const MALF_SAFE_DURA = 93;                    // % of max durability
const MALF = {
  misfire:   { label: 'MISFIRE',        clear: 1.1 },
  feed:      { label: 'FAILURE TO FEED', clear: 1.6 },
  jam:       { label: 'JAMMED BOLT',    clear: 2.6 },
  hardslide: { label: 'HARD SLIDE',     clear: 3.4 },
};
/**
 * Heat (globals Overheat): the scale runs 0-200, "OverheatProblemsStart 100";
 * from there the malfunction chance climbs MinMalfChance 0.5% -> MaxMalfChance
 * 9%, the spread up to MaxCOIIncreaseMult 1.5, the wear per shot up to
 * DurReduceMaxMult 3. Per-shot heat is HeatFactorByShot x round x parts,
 * cooling CoolFactorGun x parts per second.
 */
const HEAT_MAX = 200;
const HEAT_PROBLEMS = 100;
const HEAT_MALF_MIN = 0.005, HEAT_MALF_MAX = 0.09;
const HEAT_COI_MAX = 1.5;
const HEAT_WEAR_MAX = 3;

/**
 * Reload timings by weapon class, in seconds. The game animates these per
 * weapon; these are the animation lengths a stopwatch gives for the classes
 * this game has (a magazine pistol reload is quick, an AK slower, a tube gun
 * is fed a shell at a time).
 */
const RELOAD_TIME = { pistol: 1.7, smg: 2.1, assaultRifle: 2.5, assaultCarbine: 2.5, shotgun: 2.9, default: 2.4 };
/**
 * Rounds by hand (globals): BaseLoadTime 0.85 s a round, scaled by the
 * magazine's LoadUnloadModifier (a drum +60%, a PMAG -10%); a tube gun with
 * the slow-reload flag takes a little longer per shell. BaseCheckTime 3 s
 * for the magazine check.
 */
const LOAD_TIME_PER_ROUND = 0.85;
const SLOW_RELOAD_MULT = 1.25;                // wpn.slowReload
const RACK_TIME = 0.55;                       // a round into an empty chamber
const MAG_CHECK_TIME = 3.0;
const CHAMBER_CHECK_TIME = 0.8;

/**
 * A pump gun cycles by hand between shots; the dumps carry no flag for it
 * (the client animates it), so the one pump this game has is named here
 * with its cycle time. Everything else fires at its SingleFireRate in semi.
 */
const PUMP_CYCLE = { w_mp133: 0.8 };

/** how far a shot carries to a scav's ears (map units), before loudness */
const HEAR_RANGE = 46;
const HEAR_RANGE_SUPPRESSED = 14;

// ---------------------------------------------------------
// the weapon's field state
// ---------------------------------------------------------
/**
 * Field state for one weapon item, kept off the item (nothing here is
 * saved): fire mode, heat, the current stoppage, and what the shooter knows
 * about the magazine.
 */
export class GunState {
  constructor(weapon) {
    this.weapon = weapon;
    const modes = weaponModes(weapon);
    this.mode = modes[0] || 'single';
    this.heat = 0;
    this.malf = null;            // {kind, label} while jammed
    this.string = 0;             // shots in the current string
    this.lastShot = -10;
    this.burstLeft = 0;
    this.pulled = false;         // the trigger is held from the last pull
    // magazine knowledge: {n, exact} — what the shooter thinks is in the mag
    this.magKnown = null;
    this.magSeen = weapon.magazine || null;
    this.knowMag(true);
  }

  /** the shooter looked into the magazine (or just loaded it): remember it */
  knowMag(exact = true) {
    const mag = this.weapon.magazine;
    this.magSeen = mag;
    if (!mag) { this.magKnown = null; return; }
    this.magKnown = { n: mag.ammoCount, exact };
  }

  /** every shot fired makes the count uncertain again until the next check */
  forgetMag() {
    if (this.magKnown) this.magKnown = { n: this.magKnown.n, exact: false, stale: true };
  }
}

/** the fire modes a weapon has, in the game's order */
export function weaponModes(weapon) {
  const tpl = weapon.tpl;
  const modes = (tpl.wpn?.fire || tpl.fire || ['single']).filter((m) => MODE_LABEL[m]);
  return modes.length ? modes : ['single'];
}

/** a suppressor anywhere on the gun */
export function isSuppressed(weapon) {
  const tpl = weapon.tpl;
  for (const m of weapon.allMods()) if (m.tpl.mod?.muzzleType === 'silencer') return true;
  return !!tpl.wpn?.suppressed;
}

// ---------------------------------------------------------
// aim and spread
// ---------------------------------------------------------
/**
 * The aim of a shooter: how long the sight has been steady, and how much
 * recoil is still in the string. `tick` runs it every frame.
 */
export class Aim {
  constructor() {
    this.settled = 0;      // s since the last move / turn
    this.recoil = 0;       // rad, the climb left in the string
    this.lastFacing = null;
  }

  tick(dt, { moving, facing }) {
    if (moving || (this.lastFacing != null && angleDiff(facing, this.lastFacing) > 0.35)) this.settled = 0;
    else this.settled += dt;
    this.lastFacing = facing;
    if (this.recoil > 0) this.recoil = Math.max(0, this.recoil - dt * (RECOIL_RECOVER + this.recoil * RECOIL_RECOVER_K));
  }
}

function angleDiff(a, b) {
  return Math.abs(((a - b + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
}

/** how many seconds after a move the aim needs to settle: ergonomics */
export function settleTime(ergo) {
  return clamp(1.15 - (ergo || 0) / 100, 0.3, 1.1);
}

/**
 * The half-angle (rad) a shot can land inside, for a shooter with these
 * stats in this state. Deterministic, so the HUD and the tests can read it.
 */
export function spreadFor(stats, aim, { moving = false, sprinting = false, targetMoving = false, aimMult = 1, skill = 1, heat = 0, string = 0 } = {}) {
  const moaRad = ((stats.moa || 4) / 60) * (Math.PI / 180);
  const unsettled = Math.exp(-(aim?.settled || 0) / settleTime(stats.ergo));
  let s = BASE_SWAY + moaRad * MOA_WEIGHT + UNSETTLED_SWAY * unsettled;
  if (moving) s += sprinting ? SPRINT_SWAY : MOVE_SWAY;
  if (targetMoving) s += MOVING_TARGET_SWAY;
  s += aim?.recoil || 0;
  // the string's sideways scatter, from the second shot on
  if (string > 0) s += (stats.hRecoil || 0) * RECOIL_SIDE * Math.min(1, string / 3);
  s *= heatSpreadMult(heat);
  s *= skill / Math.max(0.2, aimMult);
  return s;
}

/** the chance (0..1) that a shot with half-angle spread `s` lands on a person at distance `d` */
export function hitChance(spread, d, radius = TARGET_RADIUS) {
  const half = Math.atan2(radius, Math.max(0.5, d));
  return clamp(half / Math.max(half, spread), 0, 1);
}

/** overheating widens the spread, up to MaxCOIIncreaseMult at the top of the scale */
export function heatSpreadMult(heat) {
  if (heat <= HEAT_PROBLEMS) return 1;
  return 1 + (HEAT_COI_MAX - 1) * clamp((heat - HEAT_PROBLEMS) / (HEAT_MAX - HEAT_PROBLEMS), 0, 1);
}

/** the aim after a shot: the climb of the vertical recoil */
export function kick(aim, stats) {
  aim.recoil += (stats.vRecoil || 0) * RECOIL_UP;
}

// ---------------------------------------------------------
// the round on the body
// ---------------------------------------------------------
/** what a piece of armour covers */
function covers(piece, part) {
  if (!piece || !piece.tpl.armorClass) return false;
  const isHelmet = piece.tpl.cat === 'helmet' || piece.tpl.key.startsWith('hl_');
  if (isHelmet) return part === 'head';
  return part === 'thorax' || part === 'stomach';
}

/**
 * The armour value the round has to beat: class x 10, brought down as the
 * plate wears (wiki: "the armor's protection class, the armor's remaining
 * durability % and the ammo's penetration power"). The wiki gives no curve
 * for the durability share; the one here keeps most of the class until the
 * plate is well worn and gives it all up at the end, which is how a plate
 * plays.
 */
export function armorValue(piece) {
  const cls = piece.tpl.armorClass || 0;
  const max = piece.tpl.dura || 1;
  const pct = clamp((piece.dura ?? max) / max, 0, 1);
  return cls * 10 * armorDurabilityFactor(pct);
}

/** durability -> share of the class still standing (see armorValue) */
export function armorDurabilityFactor(pct) {
  // full class down to ~60% wear, then falling away; nothing left at 0
  if (pct <= 0) return 0;
  return clamp(0.4 + 0.6 * Math.pow(pct, 0.55), 0, 1) * (pct < 0.15 ? pct / 0.15 : 1);
}

/** what the plate is made of, for how fast it wears (wiki: Ballistics, "Destructibility") */
const DESTRUCTIBILITY = {
  Aramid: 0.1875, UHMWPE: 0.3375, Combined: 0.375, Titan: 0.4125, Aluminium: 0.45, ArmoredSteel: 0.525, Ceramic: 0.6, Glass: 0.6,
};
/**
 * How much of a stopped round's damage still comes through as a bruise: the
 * armour's BluntThroughput. The item dumps this game carries do not keep it,
 * so a soft aramid vest's 0.32 stands for the vests and a helmet shell's
 * ~0.2 for the helmets (wiki: "Blunt damage is very low").
 */
const BLUNT = { helmet: 0.2, armor: 0.32 };

/**
 * A round meeting a piece of armour. Rolls penetration, wears the plate,
 * and returns what got through: {penetrated, dmg, wear}.
 */
export function strikeArmor(piece, ammo, dmg, rng) {
  const a = ammo.ammo || {};
  const pen = a.pen ?? ammo.pen ?? 0;
  const value = armorValue(piece);
  const chance = penChance(pen, value);
  const penetrated = rng.float(0, 100) < chance;
  const destr = DESTRUCTIBILITY[piece.tpl.armorMat] ?? 0.375;
  // wiki: durability damage is "based on the penetration value of the ammo
  // ... multiplied by the ammo's armor damage % and the armor material's
  // destructibility %. The minimum durability damage ... is 1"; a round that
  // went through "does a little bit less ... usually around 10-15% less"
  const wear = Math.max(1, pen * ((a.armorDmg || 30) / 100) * destr * (penetrated ? 0.87 : 1));
  piece.dura = Math.max(0, (piece.dura ?? piece.tpl.dura) - wear);
  let out = dmg;
  if (penetrated) {
    // wiki: a penetrating round "deals between 0% and 40% less damage",
    // "around 20% ... when a bullet starts to penetrate", nothing lost when
    // the round is far above the plate: read off how sure the penetration was
    out = dmg * (1 - 0.4 * (1 - chance / 100));
  } else {
    const isHelmet = piece.tpl.cat === 'helmet' || piece.tpl.key.startsWith('hl_');
    out = dmg * (isHelmet ? BLUNT.helmet : BLUNT.armor);
  }
  return { penetrated, dmg: out, wear, chance };
}

/**
 * A projectile landing on a body. Picks the part (unless given), meets the
 * armour over it, fragments, and puts the damage into the health model.
 * Returns {part, dmg, penetrated, frag, struck, res}.
 */
export function landRound({ ammo, health, armor = null, helmet = null, rng, part = null, dmgMul = 1 }) {
  const a = ammo?.ammo || {};
  part = part || rng.weighted(HIT_WEIGHTS, (e) => e[1])[0];
  let dmg = (a.dmg ?? ammo?.dmg ?? 40) * dmgMul;
  let penetrated = true, struck = 'body', frag = false, piece = null;
  if (covers(helmet, part) && helmet.dura > 0) piece = helmet;
  else if (covers(armor, part) && armor.dura > 0) piece = armor;
  if (piece) {
    const r = strikeArmor(piece, ammo, dmg, rng);
    penetrated = r.penetrated;
    dmg = r.dmg;
    struck = penetrated ? 'body' : (piece === helmet ? 'helmet' : 'armor');
  }
  // fragmentation: only a round with 20+ penetration can, and only one that
  // went through; the fragments add half again to what lands
  if (penetrated && (a.pen ?? 0) >= 20 && (a.frag || 0) > 0 && rng.chance(a.frag)) {
    dmg *= 1.5;
    frag = true;
  }
  const res = health.hit(part, dmg, { rng, bullet: true, blunt: !penetrated });
  return { part, dmg, penetrated, frag, struck, res };
}

// ---------------------------------------------------------
// wear, heat, stoppages
// ---------------------------------------------------------
/** durability the gun loses to one shot of this round */
export function wearPerShot(stats, ammo, heat = 0) {
  return WEAR_PER_SHOT * (stats.dburn || 1) * (ammo?.ammo?.dburn || 1) * heatWearMult(heat);
}

/** heat one shot adds */
export function heatPerShot(weapon, stats, ammo) {
  const w = weapon.tpl.wpn || {};
  return (w.heatShot || 1) * (ammo?.ammo?.heat || 1) * (stats.heat || 1);
}

/** heat lost per second */
export function coolPerSecond(weapon, stats) {
  const w = weapon.tpl.wpn || {};
  return (w.coolGun || 3) * (stats.cool || 1);
}

/** durability as a share of the weapon's own maximum, in percent */
export function duraPct(weapon) {
  const w = weapon.tpl.wpn || {};
  const max = weapon.maxDura ?? w.maxDura ?? 100;
  return max > 0 ? clamp((weapon.dura ?? max) / max * 100, 0, 100) : 100;
}

/**
 * The chance (0..1) that this pull ends in a stoppage rather than a shot.
 * Below the safe durability the weapon's base chance scales in (squared,
 * so a gun just under the line only rarely fails and a wreck fails often)
 * with the round's dud chance beside it, the magazine's and the round's
 * factors multiply it, and an overheated gun adds the globals' 0.5-9% on
 * top.
 */
export function malfunctionChance(weapon, ammo, heat = 0) {
  const w = weapon.tpl.wpn || {};
  const pct = duraPct(weapon);
  let p = 0;
  if (pct < MALF_SAFE_DURA) {
    const depth = (MALF_SAFE_DURA - pct) / MALF_SAFE_DURA;   // 0 at the line, 1 at zero
    // the round's own dud chance (MisfireChance, 1-3%) rides the same line:
    // the wiki has no stoppage of any kind above it
    p = (w.malf || 0.15) * depth * depth + (ammo?.ammo?.misfireBase || 0) * depth;
    const mag = weapon.magazine;
    p *= 1 + (mag?.tpl.mag?.malf || 0);
    p *= 1 + ((ammo?.ammo?.misfire || 0) + (ammo?.ammo?.feed || 0));
  }
  if (heat > HEAT_PROBLEMS) {
    p += HEAT_MALF_MIN + (HEAT_MALF_MAX - HEAT_MALF_MIN) * clamp((heat - HEAT_PROBLEMS) / (HEAT_MAX - HEAT_PROBLEMS), 0, 1);
  }
  return clamp(p, 0, 0.6);
}

/**
 * Which stoppage it is, when one happens: the globals' weights by cause,
 * folded together — a worn gun mostly jams, a bad round mostly misfires, a
 * big magazine fails to feed, and a pistol at the very end of its life can
 * lock its slide.
 */
export function rollMalfunction(weapon, ammo, rng, heat = 0) {
  const isPistol = weapon.tpl.wpn?.cls === 'pistol';
  const mag = weapon.magazine;
  const a = ammo?.ammo || {};
  const weights = {
    misfire: 0.1 + 0.7 * (a.misfire || 0) * 3,
    feed: 0.1 + 0.2 * (a.feed || 0) * 3 + (mag?.tpl.mag?.malf || 0) * 2,
    jam: 0.6 + (heat > HEAT_PROBLEMS ? 0.25 : 0),
    hardslide: isPistol && duraPct(weapon) <= 5 ? 0.5 : 0,
  };
  const [kind] = rng.weighted(Object.entries(weights), (e) => e[1]);
  return { kind, ...MALF[kind] };
}

/** the wear multiplier of a hot gun: 1 up to the problem line, 3 at the top */
export function heatWearMult(heat) {
  if (heat <= HEAT_PROBLEMS) return 1;
  return 1 + (HEAT_WEAR_MAX - 1) * clamp((heat - HEAT_PROBLEMS) / (HEAT_MAX - HEAT_PROBLEMS), 0, 1);
}

// ---------------------------------------------------------
// the reload
// ---------------------------------------------------------
/** magazines carried that fit the weapon, fullest first */
export function spareMags(weapon, grids) {
  const slot = weapon.slots?.find((s) => s.name === 'mod_magazine');
  if (!slot) return [];
  const out = [];
  const seen = new Set();
  const consider = (it) => {
    if (seen.has(it.uid) || !it.isMag) return;
    seen.add(it.uid);
    if (!slot.fits(it)) return;
    out.push(it);
  };
  for (const g of grids) {
    for (const it of g.items()) {
      consider(it);
      for (const d of it.descendants()) if (d.holder?.kind === 'grid') consider(d);
    }
  }
  out.sort((a, b) => b.ammoCount - a.ammoCount);
  return out;
}

/** loose rounds carried that a tube gun / a magazine takes */
export function looseRounds(weapon, grids) {
  const out = [];
  for (const g of grids) {
    for (const it of g.items()) {
      if (it.cat === 'ammo' && canLoad(weapon, it).ok) out.push(it);
    }
  }
  return out;
}

/** seconds to put one round into this magazine by hand */
export function loadTimePerRound(mag) {
  return LOAD_TIME_PER_ROUND * (1 + (mag?.tpl.mag?.load || 0) / 100);
}

/** how long a magazine swap takes on this gun */
export function reloadTime(weapon) {
  const w = weapon.tpl.wpn || {};
  return RELOAD_TIME[w.cls] || RELOAD_TIME.default;
}

// ---------------------------------------------------------
// the shooter: everything above tied to a raid
// ---------------------------------------------------------
/**
 * The player's gunplay for one raid. Owns the per-weapon field states, the
 * aim, and the timed action in progress (a reload, a check, a clearing).
 */
export class Gunplay {
  constructor(raid) {
    this.raid = raid;
    this.states = new Map();     // weapon uid -> GunState
    this.aim = new Aim();
    this.action = null;          // {kind, label, t, dur, ...} on the raid clock
    this.dryAt = -10;
  }

  state(weapon) {
    if (!weapon) return null;
    let s = this.states.get(weapon.uid);
    if (!s) { s = new GunState(weapon); this.states.set(weapon.uid, s); }
    // a magazine swapped through the inventory is one the shooter has seen
    if (s.magSeen !== weapon.magazine) s.knowMag(true);
    return s;
  }

  get busy() { return !!this.action; }

  /** per frame: aim settles, heat bleeds off, the action in progress runs */
  tick(dt, weapon) {
    const p = this.raid.player;
    this.aim.tick(dt, { moving: p.moving, facing: p.facing });
    for (const s of this.states.values()) {
      if (s.heat > 0) s.heat = Math.max(0, s.heat - dt * coolPerSecond(s.weapon, weaponStats(s.weapon)));
      if (this.raid.time - s.lastShot > 0.4) s.string = 0;
    }
    if (this.action) this.tickAction(dt, weapon);
  }

  /** the trigger let go: the next pull may fire again in semi / burst */
  release(weapon) {
    const s = weapon ? this.state(weapon) : null;
    if (s) { s.pulled = false; s.burstLeft = 0; }
  }

  // ---- the selector ----
  cycleMode(weapon) {
    const s = this.state(weapon);
    const modes = weaponModes(weapon);
    if (modes.length < 2) return { ok: false, reason: 'no selector' };
    s.mode = modes[(modes.indexOf(s.mode) + 1) % modes.length];
    sfx.fireSelector(weapon.tpl);
    return { ok: true, mode: s.mode };
  }

  // ---- the shot ----
  /**
   * A trigger pull (`held` for a frame of a held trigger). Returns a status
   * word for the HUD: fired | dry | malf | busy | semi | wait | cool.
   */
  pull(weapon, { held = false } = {}) {
    const raid = this.raid, s = this.state(weapon);
    if (this.action) return { status: 'busy' };
    if (s.malf) return { status: 'malf', malf: s.malf };
    const w = weapon.tpl.wpn || {};
    const now = raid.time;
    // the selector decides whether a held trigger keeps firing
    if (s.mode === 'single' || s.mode === 'doubleaction') {
      if (held && s.pulled) return { status: 'semi' };
    } else if (s.mode === 'burst') {
      if (held && s.pulled && s.burstLeft <= 0) return { status: 'semi' };
    }
    if (raid.playerCooldown > 0) return { status: 'wait' };
    if (s.mode === 'burst' && !s.pulled) s.burstLeft = w.burst || 3;
    const auto = s.mode === 'fullauto' || s.burstLeft > 0;
    let interval = 60 / (auto ? (w.rpm || 400) : (w.srpm || 450));
    if (PUMP_CYCLE[weapon.tpl.key]) interval = Math.max(interval, PUMP_CYCLE[weapon.tpl.key]);
    s.pulled = true;
    if (s.burstLeft > 0) s.burstLeft -= 1;

    // what is in the chamber
    const nothing = roundsInWeapon(weapon) === 0;
    if (nothing) {
      if (now - this.dryAt > 0.25) { sfx.weaponDry(weapon.tpl); this.dryAt = now; }
      return { status: 'dry' };
    }
    const stats = weaponStats(weapon);
    const ammoTpl = takeRound(weapon);
    if (!ammoTpl) return { status: 'dry' };
    raid.playerCooldown = Math.max(0.06, interval) * raid.health.handlingMult();
    s.lastShot = now;
    s.forgetMag();

    // a stoppage: the round is spent either way
    if (raid.rng.chance(malfunctionChance(weapon, ammoTpl, s.heat))) {
      s.malf = rollMalfunction(weapon, ammoTpl, raid.rng, s.heat);
      s.string = 0;
      sfx.weaponJam(weapon.tpl);
      return { status: 'malf', malf: s.malf, ammo: ammoTpl };
    }

    // the shot itself: wear, heat, recoil, noise
    weapon.dura = Math.max(0, (weapon.dura ?? 100) - wearPerShot(stats, ammoTpl, s.heat));
    s.heat = Math.min(HEAT_MAX, s.heat + heatPerShot(weapon, stats, ammoTpl));
    const suppressed = isSuppressed(weapon);
    sfx.fire(weapon.tpl, { suppressed });
    const spread = spreadFor(stats, this.aim, {
      moving: raid.player.moving, sprinting: raid.player.moving && raid.player.sprint,
      aimMult: raid.health.aimMult(), heat: s.heat, string: s.string,
    });
    kick(this.aim, stats);
    s.string += 1;
    // a pump gun cycles by hand after the shot
    if (PUMP_CYCLE[weapon.tpl.key] && roundsInWeapon(weapon) > 0) sfx.weaponBolt(weapon.tpl);
    return { status: 'fired', ammo: ammoTpl, stats, spread, suppressed, hearRange: hearRange(stats, suppressed) };
  }

  // ---- timed actions ----
  /** start a timed action; the previous one is dropped */
  begin(action) {
    this.action = { t: 0, ...action };
    return { ok: true, dur: action.dur, label: action.label };
  }

  cancel() { this.action = null; }

  tickAction(dt, weapon) {
    const a = this.action;
    if (!a) return;
    // an action on the gun in hand dies with a weapon change; one on a
    // magazine in the rig dies when the magazine leaves the rig
    if (a.weapon && a.weapon !== weapon) { this.action = null; return; }
    if (a.alive && !a.alive()) { this.action = null; return; }
    a.t += dt;
    if (a.step) {
      // a shell at a time: each step lands as it comes
      while (a.t >= a.next && a.left > 0) {
        if (!a.step()) { a.left = 0; break; }
        a.left -= 1;
        a.next += a.stepDur;
      }
      if (a.left <= 0 && a.t >= a.next - a.stepDur + 0.05) { this.action = null; if (a.done) a.done(); }
      return;
    }
    if (a.t >= a.dur) { this.action = null; if (a.done) a.done(); }
  }

  /**
   * R: clear a stoppage if there is one, else reload. Returns {ok, reason,
   * dur, label}.
   */
  reload(weapon) {
    const raid = this.raid, s = this.state(weapon);
    if (this.action) return { ok: false, reason: 'Busy' };
    const w = weapon.tpl.wpn || {};
    const grids = [...raid.carryGridsFor(), ...raid.nestedGridsFor()];
    if (s.malf) {
      const m = s.malf;
      return this.begin({
        kind: 'clear', weapon, label: `CLEARING ${m.label}`, dur: m.clear * raid.health.useMult(),
        done: () => {
          s.malf = null;
          sfx.weaponBolt(weapon.tpl);
          // the stoppage round is gone; the next comes up from the mag
          if (weapon.chamber && weapon.chamber.length === 0 && weapon.magazine?.ammoCount) {
            const mag = weapon.magazine, top = mag.rounds[mag.rounds.length - 1];
            weapon.chamber.push(top.t); top.n -= 1; if (top.n <= 0) mag.rounds.pop();
          }
        },
      });
    }
    if (w.reload === 'InternalMagazine') return this.reloadTube(weapon, grids);
    return this.reloadMag(weapon, grids);
  }

  /** an external magazine: the fullest spare in, the old one stowed or dropped */
  reloadMag(weapon, grids) {
    const raid = this.raid, s = this.state(weapon);
    const cur = weapon.magazine;
    const spares = spareMags(weapon, grids).filter((m) => m !== cur);
    const best = spares[0] || null;
    const curN = cur ? cur.ammoCount : 0;
    if (!best || best.ammoCount <= curN) {
      // nothing better to put in; an empty chamber can still be racked
      if (weapon.chamber && weapon.chamber.length === 0 && curN > 0) return this.rack(weapon);
      return { ok: false, reason: best ? 'No fuller magazine' : (cur ? 'No spare magazine' : 'No magazine') };
    }
    const dur = reloadTime(weapon) * raid.health.useMult();
    return this.begin({
      kind: 'reload', weapon, label: `RELOADING — ${best.tpl.short || 'MAG'}`, dur,
      done: () => {
        const slot = weapon.slots.find((sl) => sl.name === 'mod_magazine');
        if (!slot) return;
        const from = best.holder;
        const r = installMod(slot, best, grids);
        if (!r.ok) {
          // the game drops the old magazine at your feet when there is no room
          if (cur) { detach(cur); void from; }
          const r2 = installMod(slot, best, grids);
          if (!r2.ok) { raid.toast(r2.reason || 'Cannot fit the magazine', 'warn'); return; }
          raid.toast('Magazine dropped', 'warn');
        }
        s.knowMag(true);
        // an empty chamber gets a round racked in
        if (weapon.chamber && weapon.chamber.length === 0 && best.ammoCount > 0) {
          const top = best.rounds[best.rounds.length - 1];
          weapon.chamber.push(top.t); top.n -= 1; if (top.n <= 0) best.rounds.pop();
          sfx.weaponBolt(weapon.tpl);
        }
        raid.onInventoryChanged();
      },
    });
  }

  /** a tube: shells go in one at a time from the loose rounds carried */
  reloadTube(weapon, grids) {
    const raid = this.raid, s = this.state(weapon);
    const mag = weapon.magazine;
    if (!mag) return { ok: false, reason: 'No magazine' };
    if (mag.ammoFree <= 0) {
      if (weapon.chamber && weapon.chamber.length === 0) return this.rack(weapon);
      return { ok: false, reason: 'Tube is full' };
    }
    const rounds = looseRounds(weapon, grids);
    if (!rounds.length) return { ok: false, reason: `No ${weapon.tpl.cal || ''} shells`.trim() };
    const stepDur = loadTimePerRound(mag) * (weapon.tpl.wpn?.slowReload ? SLOW_RELOAD_MULT : 1) * raid.health.useMult();
    const left = mag.ammoFree;
    return this.begin({
      kind: 'reload', weapon, label: 'LOADING SHELLS', dur: stepDur * left, stepDur, next: stepDur, left,
      step: () => {
        const src = looseRounds(weapon, grids)[0];
        if (!src) return false;
        const r = loadAmmo(weapon, src, 1);
        s.knowMag(true);
        raid.onInventoryChanged();
        return r.ok && mag.ammoFree > 0;
      },
      done: () => {
        s.knowMag(true);
        if (weapon.chamber && weapon.chamber.length === 0 && mag.ammoCount > 0) {
          const top = mag.rounds[mag.rounds.length - 1];
          weapon.chamber.push(top.t); top.n -= 1; if (top.n <= 0) mag.rounds.pop();
          sfx.weaponBolt(weapon.tpl);
        }
      },
    });
  }

  /** a round into an empty chamber */
  rack(weapon) {
    const raid = this.raid;
    return this.begin({
      kind: 'rack', weapon, label: 'CHAMBERING', dur: RACK_TIME * raid.health.useMult(),
      done: () => {
        const mag = weapon.magazine;
        if (weapon.chamber && weapon.chamber.length === 0 && mag?.ammoCount) {
          const top = mag.rounds[mag.rounds.length - 1];
          weapon.chamber.push(top.t); top.n -= 1; if (top.n <= 0) mag.rounds.pop();
          sfx.weaponBolt(weapon.tpl);
        }
      },
    });
  }

  /**
   * Rounds into a magazine in the field, one at a time on the clock (globals
   * BaseLoadTime x the magazine's modifier). `stacks` are the carried stacks
   * to draw from, `n` how many. A magazine in the gun in hand loads too - the
   * game lets you, it just takes as long.
   */
  loadRounds(mag, stacks, n) {
    const raid = this.raid;
    if (this.action) return { ok: false, reason: 'Busy' };
    if (!mag?.isMag) return { ok: false, reason: 'Not a magazine' };
    const take = Math.min(n, mag.ammoFree);
    if (take <= 0) return { ok: false, reason: 'Magazine is full' };
    const stepDur = loadTimePerRound(mag) * raid.health.useMult();
    const carried = () => raid.carried(mag) || (mag.holder?.kind === 'mod' && raid.carried(mag.holder.slot.owner.root));
    return this.begin({
      kind: 'load', label: `LOADING ${(mag.tpl.short || 'MAG').toUpperCase()}`, dur: stepDur * take,
      stepDur, next: stepDur, left: take,
      alive: () => carried(),
      step: () => {
        const src = stacks.find((st) => st.stack > 0 && st.holder && canLoad(mag, st).ok);
        if (!src) return false;
        const r = loadAmmo(mag, src, 1);
        raid.onInventoryChanged();
        return r.ok && mag.ammoFree > 0;
      },
      done: () => {
        // the gun in hand: what went in is known
        for (const st of this.states.values()) if (st.weapon.magazine === mag) st.knowMag(true);
        raid.onInventoryChanged();
      },
    });
  }

  /** spare magazines with rounds carried for this gun */
  spareCount(weapon) {
    const raid = this.raid;
    const cur = weapon.magazine;
    return spareMags(weapon, [...raid.carryGridsFor(), ...raid.nestedGridsFor()]).filter((m) => m !== cur && m.ammoCount > 0).length;
  }

  /** T: look at the magazine — exact through its windows, a guess otherwise */
  checkMag(weapon) {
    const raid = this.raid, s = this.state(weapon);
    if (this.action) return { ok: false, reason: 'Busy' };
    const mag = weapon.magazine;
    if (!mag) {
      // no magazine: the chamber is all there is to look at
      return this.begin({
        kind: 'check', weapon, label: 'CHECKING CHAMBER', dur: CHAMBER_CHECK_TIME * raid.health.useMult(),
        done: () => { sfx.chamberCheck(weapon.tpl); s.knowMag(true); },
      });
    }
    sfx.magCheck(weapon.tpl);
    return this.begin({
      kind: 'check', weapon, label: 'CHECKING MAGAZINE', dur: MAG_CHECK_TIME * raid.health.useMult(),
      // a count still known exactly (nothing fired since it went in) stays
      // exact; anything else is read by heft
      done: () => { if (!(s.magKnown?.exact && !s.magKnown.stale)) s.knowMag(false); },
    });
  }

  /** what the HUD may say about the magazine: {text, exact} */
  magReadout(weapon) {
    const s = this.state(weapon);
    const mag = weapon.magazine;
    if (!mag) return { text: '—', exact: true, cap: 0 };
    const cap = mag.tpl.magSize || 0;
    const k = s.magKnown;
    if (!k) return { text: '?', exact: false, cap };
    if (k.exact && !k.stale) return { text: String(mag.ammoCount), exact: true, cap };
    if (k.stale) return { text: '?', exact: false, cap };
    // a see-through magazine reads "about 15"; any other only by heft
    if (mag.tpl.mag?.checkOverride) return { text: `~${Math.max(1, Math.round(k.n / 5) * 5)}`, exact: false, cap };
    return { text: magGuess(k.n, cap), exact: false, cap };
  }
}

/** how far a shot is heard */
export function hearRange(stats, suppressed) {
  const loud = clamp(1 + (stats.loud || 0) / 100, 0.3, 1.5);
  return (suppressed ? HEAR_RANGE_SUPPRESSED : HEAR_RANGE) * loud;
}

/**
 * Is the count visible through the magazine's own windows? The template's
 * VisibleAmmoRangesString ("1-3", "0-30", "1-5;28-30") lists the counts the
 * shooter can see exactly.
 */
export function magCountVisible(mag) {
  const n = mag.ammoCount;
  const spec = mag.tpl.mag?.visible;
  if (!spec) return n <= 3;    // no windows: only the last few show at the lips
  for (const part of String(spec).split(';')) {
    const [a, b] = part.split('-').map((v) => parseInt(v, 10));
    if (Number.isFinite(a) && Number.isFinite(b) && n >= a && n <= b) return true;
    if (Number.isFinite(a) && !Number.isFinite(b) && n === a) return true;
  }
  return false;
}

/**
 * The game's words for a magazine that was only hefted (wiki, Mag Drills at
 * level 0): Full / Nearly full / About half / Fewer than half / Almost empty
 * / Empty.
 */
export function magGuess(n, cap) {
  if (n <= 0) return 'EMPTY';
  if (cap && n >= cap) return 'FULL';
  const f = cap ? n / cap : 0.5;
  if (f < 0.15) return 'ALMOST EMPTY';
  if (f < 0.4) return 'FEWER THAN HALF';
  if (f < 0.6) return 'ABOUT HALF';
  return 'NEARLY FULL';
}

/** the extra spread each pellet of a shell gets from the gun's shotgun dispersion */
export function pelletSpread(weapon, proj = 1) {
  return proj > 1 ? (weapon.tpl.wpn?.shotDisp || 10) * PELLET_SPREAD : 0;
}

export { TARGET_RADIUS, MOVING_TARGET_SWAY };
