// =========================================================
// weapon repair: at a trader's bench, or with a repair kit in the stash
//
// The arithmetic is the server's (SPT RepairService / RepairHelper, which
// mirror the live game):
//
//   trader price   = round( RepairCost x points x (1 + repair_price_coef/100) )   roubles
//   restore        = dur = min(dur + points, curMax)             (the max never grows)
//   wear on the max= round2( U(MinRepairDegradation, MaxRepairDegradation) x curMax x quality )
//                    then dur = min(dur, curMax)
//   repair kit     = 0.5 resource per point (durabilityPointCostGuns), its own
//                    U(MinRepairKitDegradation, MaxRepairKitDegradation), quality 1
//
// `repair_price_coef` is per trader per loyalty level (Prapor 80/90/95/100,
// Skier 110/120/130/140, Mechanic 175/180/185/195) and `quality` is the
// trader's multiplier on the wear (Prapor 1.2 - cheap and rough, Skier 1,
// Mechanic 0.7 - dear and careful). Only those three touch weapons.
// The wear is rolled once per repair, whatever the amount - the game does the
// same, so it pays to repair in one go.
// =========================================================

import { rand } from '../core/rng.js';
import { sfx } from '../core/audio.js';
import { getTpl } from '../data/items.js';

/** SPT globals.config.RepairSettings.durabilityPointCostGuns */
export const KIT_RESOURCE_PER_POINT = 0.5;
/** the dump's values on all twelve guns; the template overrides */
const DEFAULT_DEG = [0, 0.04];
const DEFAULT_KIT_DEG = [0, 0.035];

/** can this item be repaired at all (a gun with a durability track) */
export function isRepairable(item) {
  if (!item || !item.isWeapon) return false;
  const max = item.maxDura ?? item.tpl.wpn?.maxDura;
  return max != null && item.dura != null;
}

/** points of durability the item is short of its (worn) ceiling */
export function repairNeeded(item) {
  if (!isRepairable(item)) return 0;
  return Math.max(0, round2((item.maxDura ?? item.tpl.wpn.maxDura) - item.dura));
}

/** whether a trader mends weapons, and at what rate for the given loyalty level */
export function traderRepairRate(trader, ll = 1) {
  const r = trader?.repair;
  if (!r) return null;
  const coefs = r.coef || [0];
  const coef = coefs[Math.max(0, Math.min(coefs.length - 1, (ll | 0) - 1))] || 0;
  return { coef, rate: coef <= 0 ? 1 : 1 + coef / 100, quality: r.quality ?? 1 };
}

/** what a trader charges for `points` of durability on `item`, in roubles */
export function traderRepairPrice(trader, item, points, ll = 1) {
  const rr = traderRepairRate(trader, ll);
  if (!rr || !isRepairable(item)) return 0;
  const cost = item.tpl.wpn?.repairCost || 0;
  return Math.round(cost * points * rr.rate);
}

/** the price of one point, so the panel can quote it */
export function traderPointPrice(trader, item, ll = 1) {
  return traderRepairPrice(trader, item, 1, ll);
}

/** the wear range a repair rolls in, in points of maximum durability */
export function wearRange(item, { kit = false, quality = 1 } = {}) {
  const w = item.tpl.wpn || {};
  const [lo, hi] = kit ? (w.kitDeg || DEFAULT_KIT_DEG) : (w.repairDeg || DEFAULT_DEG);
  const max = item.maxDura ?? w.maxDura ?? 0;
  return [round2(lo * max * quality), round2(hi * max * quality)];
}

/**
 * Restore `points` of durability and roll the wear on the ceiling. Returns
 * what happened; the caller has already taken the money / the kit resource.
 */
export function applyRepair(item, points, { kit = false, quality = 1, rng = rand } = {}) {
  const w = item.tpl.wpn || {};
  const maxBefore = item.maxDura ?? w.maxDura ?? 0;
  const before = item.dura;
  const restored = Math.min(points, Math.max(0, maxBefore - item.dura));
  item.dura = round2(Math.min(maxBefore, item.dura + restored));
  let loss = 0;
  if (quality > 0) {
    const [lo, hi] = kit ? (w.kitDeg || DEFAULT_KIT_DEG) : (w.repairDeg || DEFAULT_DEG);
    loss = round2(rng.float(lo, hi) * maxBefore * quality);
    item.maxDura = round2(Math.max(0, maxBefore - loss));
    if (item.dura > item.maxDura) item.dura = item.maxDura;
  }
  return { restored: round2(item.dura - before), loss, dura: item.dura, maxDura: item.maxDura };
}

/** repair at a trader: price already checked and taken by the caller */
export function traderRepair(trader, item, points, ll = 1, rng = rand) {
  const rr = traderRepairRate(trader, ll);
  if (!rr) return { ok: false, reason: 'does not repair weapons' };
  const need = repairNeeded(item);
  const pts = Math.min(points, need);
  if (pts <= 0) return { ok: false, reason: 'nothing to repair' };
  const price = traderRepairPrice(trader, item, pts, ll);
  const res = applyRepair(item, pts, { quality: rr.quality, rng });
  sfx.repairDone?.();
  return { ok: true, price, ...res };
}

// ---------------------------------------------------------
// repair kits
// ---------------------------------------------------------
export function isRepairKit(item) {
  return !!item?.tpl.repairKit && (item.res ?? 0) > 0;
}

/** durability points the kit's remaining resource buys */
export function kitPointsLeft(kit) {
  if (!kit?.tpl.repairKit) return 0;
  return Math.floor((kit.res ?? 0) / KIT_RESOURCE_PER_POINT);
}

/** every kit in `grids` (top level or inside cases) with something left in it */
export function repairKitsIn(grids) {
  const out = [];
  const seen = new Set();
  const consider = (it) => {
    if (seen.has(it.uid)) return;
    seen.add(it.uid);
    if (isRepairKit(it)) out.push(it);
  };
  for (const g of grids) {
    for (const it of g.items()) {
      consider(it);
      for (const d of it.descendants()) if (d.holder?.kind === 'grid') consider(d);
    }
  }
  return out;
}

/** mend `item` with `kit`: resource off the kit, points on the gun, kit wear on the max */
export function kitRepair(kit, item, points, rng = rand) {
  if (!kit?.tpl.repairKit) return { ok: false, reason: 'not a repair kit' };
  if (!isRepairable(item)) return { ok: false, reason: 'cannot be repaired' };
  const need = repairNeeded(item);
  const pts = Math.min(points, need, kitPointsLeft(kit));
  if (pts <= 0) return { ok: false, reason: (kit.res ?? 0) <= 0 ? 'the kit is used up' : 'nothing to repair' };
  const spent = round2(pts * KIT_RESOURCE_PER_POINT);
  kit.res = round2(Math.max(0, (kit.res ?? 0) - spent));
  const res = applyRepair(item, pts, { kit: true, quality: 1, rng });
  sfx.repairKit?.();
  return { ok: true, spent, ...res };
}

/** the label of the repair kit template, if the database carries one */
export function repairKitTpl() { return getTpl('weaprepkit') || null; }

function round2(v) { return Math.round(v * 100) / 100; }
