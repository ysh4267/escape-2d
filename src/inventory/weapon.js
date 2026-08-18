// =========================================================
// weapons: assembly, magazines, cartridges, aggregate stats
//
// Everything a gun does outside of actually being fired lives here:
//  - installing / removing parts (the mod tree on Item, see model.js)
//  - the numbers the modding screen shows, aggregated from the tree the way
//    the game does it: ergonomics is a plain sum, recoil and velocity are
//    percentage sums applied to the base, accuracy is CenterOfImpact turned
//    into MOA (radius, so twice the textbook figure — the game's own quirk)
//  - loading cartridges into magazines and taking them back out, chambering,
//    the fold of a folding stock
//  - presets: the parts a gun comes with from a trader or a crate
// =========================================================

import { Item, detach, autoPlace, canInstall, fitsAfter } from './model.js';
import { getTpl } from '../data/items.js';
import { sfx } from '../core/audio.js';

/** 1 MOA at 100 m is 2.908 cm; the game reports the spread radius, hence x2 */
const MOA_PER_COI = 100 / 2.908 * 2;

// ---------------------------------------------------------
// aggregate stats
// ---------------------------------------------------------
/**
 * The modding-screen numbers for a weapon (or a bare part tree). Every
 * field is what the game shows in the same place, and `parts` lists what
 * each installed part contributed so the UI can colour deltas.
 */
export function weaponStats(item) {
  const tpl = item.tpl;
  const wpn = tpl.wpn || {};
  let ergo = tpl.ergo || 0;
  let recoilPct = 0, accPct = 0, velPct = wpn.vel || 0, loud = 0;
  let sightRange = 0;
  let heat = 1, cool = 1;
  const parts = [];
  for (const m of item.allMods()) {
    const md = m.tpl.mod || {};
    const e = m.tpl.ergo ?? md.ergo ?? 0;
    ergo += e;
    recoilPct += md.recoil || 0;
    accPct += md.acc || 0;
    velPct += md.vel || 0;
    loud += md.loud || 0;
    if (md.range) sightRange = Math.max(sightRange, md.range);
    if (md.heat) heat *= md.heat;
    if (md.cool) cool *= md.cool;
    parts.push({ item: m, ergo: e, recoil: md.recoil || 0, acc: md.acc || 0, vel: md.vel || 0 });
  }
  const recoilMul = 1 + recoilPct / 100;
  const coi = (wpn.moa || 0) * (1 + accPct / 100);
  const ammoKey = item.chamber?.[0] || item.magazine?.topRound || wpn.defAmmo || null;
  const ammo = ammoKey ? getTpl(ammoKey) : null;
  const speed = ammo?.ammo?.speed || 0;
  const mag = item.magazine;
  return {
    ergo: Math.round(ergo),
    vRecoil: Math.round((wpn.rup || 0) * recoilMul),
    hRecoil: Math.round((wpn.rback || 0) * recoilMul),
    recoilPct: Math.round(recoilPct),
    moa: coi ? Math.round(coi * MOA_PER_COI * 100) / 100 : null,
    accPct: Math.round(accPct),
    velocity: speed ? Math.round(speed * (1 + velPct / 100)) : null,
    velPct: Math.round(velPct * 10) / 10,
    sightRange: sightRange || wpn.range || wpn.ironRange || 0,
    effDist: wpn.eff || 0,
    weight: item.weight,
    fire: wpn.fire || tpl.fire || [],
    rpm: wpn.rpm || tpl.rpm || 0,
    cal: tpl.cal || null,
    magCap: mag ? mag.tpl.magSize || 0 : 0,
    magRounds: mag ? mag.ammoCount : 0,
    chambered: item.chamber ? item.chamber.length : 0,
    dura: item.dura, maxDura: wpn.maxDura || tpl.dura || null,
    loud: Math.round(loud),
    heat: Math.round(heat * 100) / 100,
    cool: Math.round(cool * 100) / 100,
    ammo,
    parts,
    missing: missingVital(item),
  };
}

/** required slots without a part, anywhere in the tree */
export function missingVital(item, out = []) {
  if (!item.slots) return out;
  for (const sl of item.slots) {
    if (sl.required && !sl.item) out.push(sl);
    if (sl.item) missingVital(sl.item, out);
  }
  return out;
}

/** a gun with every vital part in place */
export function isFunctional(item) {
  return item.isWeapon && missingVital(item).length === 0;
}

// ---------------------------------------------------------
// installing and removing parts
// ---------------------------------------------------------
/** in raid only the parts the game lets you swap in the field come off */
export let inRaid = false;
export function setInRaid(v) { inRaid = !!v; }

function raidLocked(item) {
  return inRaid && !!item.tpl.mod?.noRaidMod;
}

/**
 * Put `part` into `slot`. Whatever occupied the slot goes back to where the
 * part came from, or into `targets`, or the install is refused.
 */
export function installMod(slot, part, targets = []) {
  if (raidLocked(part)) return { ok: false, reason: 'cannot be fitted in raid' };
  if (slot.item && raidLocked(slot.item)) return { ok: false, reason: 'cannot be removed in raid' };
  const chk = canInstall(slot, part);
  if (!chk.ok) return chk;
  const from = part.holder;
  const prev = slot.item;
  detach(part);
  if (prev) {
    slot.clear();
    let homed = false;
    if (from?.kind === 'grid' && from.grid.canPlace(prev, from.x, from.y, prev.rot)) {
      from.grid.place(prev, from.x, from.y, prev.rot);
      homed = true;
    } else if (from?.kind === 'mod' && from.slot.canAccept(prev)) {
      from.slot.set(prev);
      homed = true;
    } else {
      const grids = from?.kind === 'grid' ? [from.grid, ...targets] : targets;
      homed = autoPlace(prev, grids, { merge: false });
    }
    if (!homed) {
      slot.set(prev);
      restoreTo(part, from);
      return { ok: false, reason: 'no room for the part it replaces' };
    }
  }
  slot.set(part);
  sfx.modInstall(slot, part);
  return { ok: true, replaced: prev || null };
}

/** take the part out of `slot` and put it into the first of `targets` with room */
export function uninstallMod(slot, targets = []) {
  const part = slot.item;
  if (!part) return { ok: false, reason: 'empty' };
  if (raidLocked(part)) return { ok: false, reason: 'cannot be removed in raid' };
  // a part with parts on it comes off as one piece; its footprint is its own
  slot.clear();
  const root = slot.owner.root;
  const h = root.holder;
  // the gun shrinks; if it lies in a grid it stays legal by construction
  if (!autoPlace(part, targets, { merge: false })) {
    slot.set(part);
    return { ok: false, reason: 'no room for the part' };
  }
  void h;
  sfx.modRemove(slot, part);
  return { ok: true, part };
}

function restoreTo(item, from) {
  if (!from) return;
  if (from.kind === 'grid') {
    if (from.grid.canPlace(item, from.x, from.y, item.rot)) from.grid.place(item, from.x, from.y, item.rot);
    else { const s = from.grid.findSpot(item); if (s) from.grid.place(item, s.x, s.y, s.rot); }
  } else if (from.kind === 'slot' || from.kind === 'mod') from.slot.set(item);
}

/** every part off the gun, into `targets`; returns the ones that came off */
export function stripWeapon(item, targets = []) {
  const removed = [];
  const walk = (node) => {
    if (!node.slots) return;
    for (const sl of node.slots) {
      if (!sl.item) continue;
      walk(sl.item);
      const res = uninstallMod(sl, targets);
      if (res.ok) removed.push(res.part);
    }
  };
  walk(item);
  return removed;
}

// ---------------------------------------------------------
// folding
// ---------------------------------------------------------
export function canFold(item) {
  const w = item.tpl.wpn;
  if (!w?.fold || !w.foldSlot) return { ok: false, reason: 'not foldable' };
  for (const m of item.allMods()) {
    if (m.tpl.mod?.blocksFold) return { ok: false, reason: `${m.tpl.short || m.tpl.name} blocks folding` };
  }
  return { ok: true };
}

export function toggleFold(item) {
  const chk = canFold(item);
  if (!chk.ok) return chk;
  const next = !item.folded;
  if (!fitsAfter(item, () => { item.folded = next; return () => { item.folded = !next; }; })) {
    return { ok: false, reason: 'no room to unfold here' };
  }
  item.folded = next;
  sfx.weaponFold(item.tpl, next);
  return { ok: true, folded: next };
}

// ---------------------------------------------------------
// cartridges
// ---------------------------------------------------------
/** the magazine a load into `target` would fill: the mag itself, or a weapon's mag */
export function magazineOf(target) {
  if (!target) return null;
  if (target.isMag) return target;
  if (target.isWeapon) return target.magazine;
  return null;
}

/** can this ammo go into that magazine / weapon at all */
export function canLoad(target, ammo) {
  const mag = magazineOf(target);
  if (!mag || !ammo || ammo.cat !== 'ammo') return { ok: false, reason: 'not a magazine' };
  if (!(mag.tpl.ammoFilter || []).includes(ammo.tplId)) return { ok: false, reason: 'wrong calibre' };
  if (mag.ammoFree <= 0) return { ok: false, reason: 'magazine is full' };
  return { ok: true, mag };
}

/**
 * Load up to `n` rounds off the `ammo` stack into the magazine. Rounds of the
 * same type as the ones on top merge into that run; a different type starts a
 * new run on top, which is what comes out first — exactly the game's order.
 */
export function loadAmmo(target, ammo, n = Infinity) {
  const chk = canLoad(target, ammo);
  if (!chk.ok) return { ...chk, loaded: 0 };
  const mag = chk.mag;
  const take = Math.min(n, mag.ammoFree, ammo.stack);
  if (take <= 0) return { ok: false, reason: 'nothing to load', loaded: 0 };
  const top = mag.rounds[mag.rounds.length - 1];
  if (top && top.t === ammo.tplId) top.n += take;
  else mag.rounds.push({ t: ammo.tplId, n: take });
  ammo.stack -= take;
  if (ammo.stack <= 0) detach(ammo);
  sfx.ammoLoad(mag.tpl, take);
  return { ok: true, loaded: take, mag };
}

/**
 * Take every round out of the magazine and stack it into `targets`. Runs come
 * out top first, and a run that does not fit anywhere stays in the mag.
 */
export function unloadAmmo(target, targets = []) {
  const mag = magazineOf(target);
  if (!mag || !mag.rounds?.length) return { ok: false, reason: 'empty', unloaded: 0 };
  let out = 0;
  while (mag.rounds.length) {
    const run = mag.rounds[mag.rounds.length - 1];
    const tpl = getTpl(run.t);
    if (!tpl) { mag.rounds.pop(); continue; }
    const chunk = Math.min(run.n, tpl.stack || 1);
    const stack = new Item(run.t, { stack: chunk });
    // autoPlace merges into partial stacks before it looks for a cell, so a
    // failure can still have moved some rounds: count what actually left
    const ok = autoPlace(stack, targets);
    const placed = ok ? chunk : chunk - stack.stack;
    if (placed <= 0) break;
    run.n -= placed;
    out += placed;
    if (run.n <= 0) mag.rounds.pop();
    if (!ok) break;
  }
  if (out) sfx.ammoUnload(mag.tpl, out);
  return { ok: out > 0, unloaded: out, reason: out ? null : 'no room for the rounds' };
}

/** put the top round of the magazine into the chamber (if the chamber is free) */
export function chamberRound(weapon) {
  if (!weapon.chamber) return { ok: false, reason: 'no chamber' };
  const cap = weapon.tpl.wpn?.chambers || 1;
  if (weapon.chamber.length >= cap) return { ok: false, reason: 'already chambered' };
  const mag = weapon.magazine;
  if (!mag || !mag.rounds.length) return { ok: false, reason: 'no round to chamber' };
  const top = mag.rounds[mag.rounds.length - 1];
  weapon.chamber.push(top.t);
  top.n -= 1;
  if (top.n <= 0) mag.rounds.pop();
  sfx.weaponBolt(weapon.tpl);
  return { ok: true, round: weapon.chamber[weapon.chamber.length - 1] };
}

/** eject what is in the chamber back into `targets` (or lose it) */
export function clearChamber(weapon, targets = []) {
  if (!weapon.chamber?.length) return { ok: false, reason: 'chamber is empty' };
  const t = weapon.chamber.pop();
  const round = new Item(t, { stack: 1 });
  autoPlace(round, targets);   // a round with nowhere to go falls on the floor
  sfx.weaponBolt(weapon.tpl);
  return { ok: true, round: t };
}

/**
 * The next round the weapon would fire — the chamber first, then the top of
 * the magazine — REMOVED from the gun. Returns the ammo template or null.
 * The chamber is refilled from the magazine afterwards, which is what a
 * self-loading action does; a bolt gun / pump does the same here because the
 * pump is folded into its rate of fire.
 */
export function takeRound(weapon) {
  let t = null;
  if (weapon.chamber && weapon.chamber.length) t = weapon.chamber.shift();
  const mag = weapon.magazine;
  if (!t && mag && mag.rounds.length) {
    const top = mag.rounds[mag.rounds.length - 1];
    t = top.t;
    top.n -= 1;
    if (top.n <= 0) mag.rounds.pop();
  }
  if (!t) return null;
  // cycle the next one in
  if (weapon.chamber && weapon.chamber.length < (weapon.tpl.wpn?.chambers || 1) && mag && mag.rounds.length) {
    const top = mag.rounds[mag.rounds.length - 1];
    weapon.chamber.push(top.t);
    top.n -= 1;
    if (top.n <= 0) mag.rounds.pop();
  }
  return getTpl(t);
}

/** rounds available to fire: chamber plus magazine */
export function roundsInWeapon(weapon) {
  return (weapon.chamber?.length || 0) + (weapon.magazine?.ammoCount || 0);
}

// ---------------------------------------------------------
// spawning
// ---------------------------------------------------------
/**
 * A weapon the way it turns up in the world: assembled to its preset, wear
 * rolled inside the template's spawn range, and — when asked — the magazine
 * filled with the default round and one chambered.
 */
export function spawnWeapon(key, opts = {}) {
  const item = new Item(key, { examined: opts.examined });
  const w = item.tpl.wpn;
  if (w?.maxDura) {
    if (opts.dura != null) item.dura = opts.dura;
    else if (opts.rng && w.spawnDura) item.dura = opts.rng.float(w.spawnDura[0], w.spawnDura[1]);
    else item.dura = w.maxDura;
  }
  if (opts.loaded) {
    const mag = item.magazine;
    const ammoKey = opts.ammo || w?.defAmmo || mag?.tpl.ammoFilter?.[0];
    if (mag && ammoKey && (mag.tpl.ammoFilter || []).includes(ammoKey)) {
      const n = typeof opts.loaded === 'number' ? Math.min(opts.loaded, mag.tpl.magSize) : mag.tpl.magSize;
      if (n > 0) mag.rounds.push({ t: ammoKey, n });
      if (item.chamber && opts.chambered !== false) {
        const top = mag.rounds[mag.rounds.length - 1];
        item.chamber.push(top.t);
        top.n -= 1;
        if (top.n <= 0) mag.rounds.pop();
      }
    }
  }
  return item;
}

/** a magazine with `n` (default: full) of `ammoKey` in it */
export function spawnMag(key, ammoKey = null, n = Infinity) {
  const mag = new Item(key);
  const t = ammoKey || mag.tpl.ammoFilter?.[0];
  if (t && (mag.tpl.ammoFilter || []).includes(t)) {
    const k = Math.min(n, mag.tpl.magSize || 0);
    if (k > 0) mag.rounds.push({ t, n: k });
  }
  return mag;
}

/** the parts on a gun, flattened, in tree order, with their depth */
export function partList(item, depth = 0, out = []) {
  if (!item.slots) return out;
  for (const sl of item.slots) {
    out.push({ slot: sl, item: sl.item, depth });
    if (sl.item) partList(sl.item, depth + 1, out);
  }
  return out;
}

/** every item in `grids` (top level, plus what is inside containers) that fits `slot` */
export function compatibleParts(slot, grids) {
  const out = [];
  const seen = new Set();
  const consider = (it) => {
    if (seen.has(it.uid)) return;
    seen.add(it.uid);
    if (!slot.fits(it)) return;
    if (it === slot.owner.root) return;
    out.push({ item: it, check: canInstall(slot, it) });
  };
  for (const g of grids) {
    for (const it of g.items()) {
      consider(it);
      for (const d of it.descendants()) if (d.holder?.kind === 'grid') consider(d);
    }
  }
  return out;
}

/** short human line for a magazine's contents: "PS x25 · BP x5" */
export function describeRounds(mag) {
  if (!mag?.rounds?.length) return 'empty';
  const parts = [];
  for (let i = mag.rounds.length - 1; i >= 0; i--) {
    const r = mag.rounds[i];
    const t = getTpl(r.t);
    parts.push(`${t?.short || r.t} x${r.n}`);
  }
  return parts.join(' · ');
}
