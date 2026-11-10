// =========================================================
// traders at run time
//
// What a trader will sell you, at what loyalty level, for what, and how many
// before the next restock; what he will take off your hands and what he pays
// for it. The numbers are the live game's (tarkov.dev): the loyalty ladder is
// player level + standing + sales sum, a cash offer is a price in one of the
// three currencies, a barter is a list of things to hand over, some offers
// only appear once a task is done, and almost every one has a personal limit
// that comes back when the trader restocks.
//
// What he pays is the item's handbook price times his own rate (Therapist
// 0.63 down to Fence 0.24), scaled by the state the thing is in - the square
// root of the durability left on something repairable, the share of a medkit
// still in the box - and rounded down; hard-currency traders round to the
// nearest whole unit at the handbook rate of the currency.
// =========================================================

import { game, countMoney, addMoney, takeMoney, canAddMoney, saveSoon } from '../core/state.js';
import { TPL } from '../data/items.js';
import { Item, autoPlace, detach } from '../inventory/model.js';
import { emit, EV } from '../core/events.js';
import { DB, keyOf, tplOf, CUR_OF_ITEM, ITEM_OF_CUR, ROUBLES } from './db.js';

/** what one unit of each currency is worth in roubles, off the handbook */
export function fxRate(cur) {
  if (cur === 'RUB') return 1;
  const t = tplOf(ITEM_OF_CUR[cur]);
  return (t && t.price) || (cur === 'USD' ? 120 : 130);
}

// ---------------------------------------------------------
// standing
// ---------------------------------------------------------
/** the profile's record with one trader, created on first sight */
export function traderRecord(trader) {
  const store = game.profile.traders;
  // older profiles filed the eight under the same lower-case names
  let st = store[trader.key];
  if (!st) st = store[trader.key] = { rep: 0, sales: 0 };
  if (st.sales == null) st.sales = st.spent || 0;      // profiles from before the sales sum
  if (st.rep == null) st.rep = 0;
  if (!st.bought) st.bought = {};
  return st;
}

export function isUnlocked(trader) {
  if (!trader.locked) return true;
  return !!traderRecord(trader).unlocked;
}

export function unlockTrader(trader) {
  const st = traderRecord(trader);
  if (st.unlocked) return false;
  st.unlocked = true;
  return true;
}

/** the loyalty level the profile has earned: every rung under it must hold too */
export function loyaltyLevel(trader) {
  const st = traderRecord(trader);
  const lvl = game.profile.level;
  let ll = 1;
  for (let i = 1; i < trader.levels.length; i++) {
    const need = trader.levels[i];
    if (lvl >= need.pmc && st.rep + 1e-9 >= need.rep && st.sales >= (need.sales || 0)) ll = i + 1;
    else break;
  }
  return ll;
}

export function levelRow(trader, ll = loyaltyLevel(trader)) {
  return trader.levels[Math.min(trader.levels.length, Math.max(1, ll)) - 1];
}

/** what the next rung asks for, or null at the top */
export function nextLevel(trader) {
  const ll = loyaltyLevel(trader);
  return trader.levels[ll] || null;
}

export function addStanding(trader, delta) {
  const st = traderRecord(trader);
  const before = loyaltyLevel(trader);
  st.rep = Math.round((st.rep + delta) * 100) / 100;
  if (delta) emit(EV.TRADER_STANDING, { trader, delta, rep: st.rep });
  const after = loyaltyLevel(trader);
  if (after !== before) emit(EV.TRADER_LEVEL, { trader, level: after, was: before });
  return st.rep;
}

function addSales(trader, roubles) {
  const st = traderRecord(trader);
  const before = loyaltyLevel(trader);
  st.sales = Math.round(st.sales + roubles);
  const after = loyaltyLevel(trader);
  if (after !== before) emit(EV.TRADER_LEVEL, { trader, level: after, was: before });
}

// ---------------------------------------------------------
// restock
// ---------------------------------------------------------
/** seconds until this trader restocks; restocks him first if that is overdue */
export function restockIn(trader, now = Date.now()) {
  const st = traderRecord(trader);
  if (!st.restockAt || now >= st.restockAt) {
    const [lo, hi] = trader.restock || [3600, 7200];
    // a profile that has been away for days gets one restock, not a queue
    st.restockAt = now + Math.round((lo + Math.random() * (hi - lo)) * 1000);
    if (Object.keys(st.bought).length) st.bought = {};
    if (trader.fence) st.fence = null;
    emit(EV.TRADER_RESTOCK, trader);
  }
  return Math.max(0, Math.round((st.restockAt - now) / 1000));
}

export function restockAll() {
  for (const t of DB.traders) restockIn(t);
}

// ---------------------------------------------------------
// what he sells
// ---------------------------------------------------------
/** the task that unlocks an offer is done */
let taskDone = () => true;
/** quests.js hands its own status lookup over, so this module need not import it */
export function setTaskDoneLookup(fn) { taskDone = fn; }

/** an offer can only be shown if the thing it sells exists in this build */
export function offerTpl(offer) {
  if (offer._tpl !== undefined) return offer._tpl;
  let tpl = null;
  if (offer.preset) tpl = tplOf(DB.presets[offer.preset]?.base);
  else tpl = tplOf(offer.item);
  // every rouble, dollar and part named in the price has to exist as well
  if (tpl) {
    for (const [id] of offer.cost) {
      if (id !== 'dogtag' && !tplOf(id)) { tpl = null; break; }
    }
  }
  offer._tpl = tpl;
  return tpl;
}

/** 'RUB' | 'USD' | 'EUR' for a cash offer, null for a barter */
export function offerCurrency(offer) {
  if (offer.barter || offer.cost.length !== 1) return null;
  return CUR_OF_ITEM[offer.cost[0][0]] || null;
}

/** price of one unit of a cash offer in its own currency */
export function offerPrice(offer) {
  return offerCurrency(offer) ? offer.cost[0][1] : 0;
}

/**
 * Where an offer stands for this profile:
 *   ok | level (needs a higher loyalty level) | task (locked behind a task)
 *   | limit (bought out until the restock)
 */
export function offerState(offer) {
  const trader = offer.trader;
  if (offer.ll > loyaltyLevel(trader)) return 'level';
  if (offer.task && !taskDone(offer.task)) return 'task';
  if (offerLeft(offer) <= 0) return 'limit';
  return 'ok';
}

/** how many more of an offer the profile may buy before the restock */
export function offerLeft(offer) {
  if (offer._fence) return offer._fence.left;
  if (offer.lim == null) return Infinity;
  const st = traderRecord(offer.trader);
  return Math.max(0, offer.lim - (st.bought[offer.id] || 0));
}

/** every offer of a trader that this build can show, cheapest loyalty first */
export function offersOf(trader) {
  restockIn(trader);
  if (trader.fence) return fenceOffers(trader);
  const out = [];
  for (const o of DB.offersByTrader[trader.id] || []) {
    if (!offerTpl(o)) continue;
    out.push(o);
  }
  return out;
}

// ---------------------------------------------------------
// paying
// ---------------------------------------------------------
const stashGrids = () => [game.stash];

/** every item in the stash, including what sits inside containers there */
function* stashItems() {
  const walk = function* (grids) {
    for (const g of grids) for (const it of g.items()) {
      yield it;
      if (it.grids) yield* walk(it.grids);
    }
  };
  yield* walk(stashGrids());
}

/** the stash items that could pay one row of a barter, cheapest to lose first */
export function candidatesFor(costRow) {
  const [id, , attrs] = costRow;
  const out = [];
  for (const it of stashItems()) {
    if (id === 'dogtag') {
      if (it.tpl.cat !== 'dogtag') continue;
      if (attrs?.minLevel && (it.dogtag?.level || 0) < attrs.minLevel) continue;
    } else if (it.tpl.id !== id && it.tplId !== id) continue;
    // a loaded magazine, a case with things in it or a gun with parts on it
    // is not the bare item the trader asked for
    if (it.grids && !it.isEmptyContainer) continue;
    out.push(it);
  }
  // found-in-raid items are the ones worth keeping for tasks: spend them last
  out.sort((a, b) => (a.fir ? 1 : 0) - (b.fir ? 1 : 0) || (a.stack - b.stack));
  return out;
}

/** how many units of a cost row the stash holds */
export function haveOf(costRow) {
  const cur = CUR_OF_ITEM[costRow[0]];
  if (cur) return countMoney(cur);
  let n = 0;
  for (const it of candidatesFor(costRow)) n += it.stack;
  return n;
}

/** [{ id, need, have, attrs }] for buying `qty` of an offer */
export function requirements(offer, qty = 1) {
  return offer.cost.map((row) => ({
    id: row[0], need: Math.ceil(row[1] * qty), have: haveOf(row), attrs: row[2] || null, row,
  }));
}

function takeItems(costRow, n) {
  let left = n;
  for (const it of candidatesFor(costRow)) {
    if (left <= 0) break;
    const take = Math.min(it.stack, left);
    it.stack -= take;
    left -= take;
    if (it.stack <= 0) detach(it);
  }
  return left <= 0;
}

// ---------------------------------------------------------
// building what was bought
// ---------------------------------------------------------
/**
 * A preset offer carries its own build: rows of [template, parent row, slot].
 * The gun comes out assembled exactly as the trader lists it.
 */
export function buildPreset(preset) {
  if (typeof preset === 'string') preset = DB.presets[preset];
  const baseKey = keyOf(preset?.base);
  if (!baseKey) return null;
  if (!preset.tree) {
    // only the parts list is known: the default assembly is the best match,
    // and it is what the live preset usually is
    return new Item(baseKey, { examined: true });
  }
  const nodes = [];
  preset.tree.forEach(([tid, parent, slot]) => {
    const key = keyOf(tid);
    if (!key) { nodes.push(null); return; }
    if (parent < 0) { nodes.push(new Item(key, { bare: true, examined: true })); return; }
    const host = nodes[parent];
    if (!host) { nodes.push(null); return; }
    // a round listed under a magazine or in the chamber
    if (slot === 'cartridges' && host.rounds) { nodes.push(null); return; }
    if (slot.startsWith('patron_in_weapon')) { nodes.push(null); return; }
    const sl = host.modSlot(slot);
    if (!sl || !sl.def.f.includes(key)) { nodes.push(null); return; }
    const part = new Item(key, { bare: true, examined: true });
    sl.set(part);
    nodes.push(part);
  });
  return nodes[0] || null;
}

/** the items one purchase of `qty` units produces, unplaced */
function makeGoods(offer, qty) {
  const out = [];
  const units = (offer.n || 1) * qty;
  if (offer.preset) {
    for (let i = 0; i < units; i++) {
      const gun = buildPreset(offer.preset);
      if (gun) out.push(gun);
    }
    return out;
  }
  const key = keyOf(offer.item);
  const tpl = TPL[key];
  if (!tpl) return out;
  const max = tpl.stack || 1;
  for (let left = units; left > 0;) {
    const n = Math.min(max, left);
    out.push(new Item(key, { stack: n, examined: true }));
    left -= n;
  }
  return out;
}

/** why `qty` of this offer cannot be bought right now, in the game's words, or null */
export function buyBlocker(offer, qty = 1) {
  const state = offerState(offer);
  if (state === 'level') return 'Bad user loyalty level';
  if (state === 'task') return 'This item is locked by a task';
  if (state === 'limit') return 'You have already bought the maximum amount of this item';
  if (qty > offerLeft(offer)) return `This item is purchased in quantities of ${offerLeft(offer)} pcs.`;
  for (const r of requirements(offer, qty)) {
    if (r.have < r.need) {
      return CUR_OF_ITEM[r.id] ? 'Not enough money' : 'You don\'t have some items required to finish the deal';
    }
  }
  return null;
}

/**
 * Commit a purchase. Everything is checked before anything moves: the goods
 * are placed first (and taken back out if they do not all fit), then the
 * price leaves the stash.
 */
export function buyOffer(offer, qty = 1) {
  const blocked = buyBlocker(offer, qty);
  if (blocked) return { ok: false, reason: blocked };

  const goods = makeGoods(offer, qty);
  if (!goods.length) return { ok: false, reason: 'Item is out of stock' };
  const placed = [];
  for (const it of goods) {
    if (!autoPlace(it, stashGrids(), { merge: false })) {
      for (const p of placed) detach(p);
      return { ok: false, reason: 'Not enough space in stash' };
    }
    placed.push(it);
  }

  let roubles = 0;
  for (const r of requirements(offer, qty)) {
    const cur = CUR_OF_ITEM[r.id];
    if (cur) {
      takeMoney(r.need, cur);
      roubles += r.need * fxRate(cur);
    } else {
      takeItems(r.row, r.need);
      roubles += r.need * (tplOf(r.id)?.price || 0);
    }
  }
  const trader = offer.trader;
  const st = traderRecord(trader);
  if (offer._fence) offer._fence.left = Math.max(0, offer._fence.left - qty);
  else if (offer.lim != null) st.bought[offer.id] = (st.bought[offer.id] || 0) + qty;
  addSales(trader, roubles);
  emit(EV.TRADE_DEAL, { kind: 'buy', trader, offer, qty, items: placed, roubles });
  emit(EV.INVENTORY_CHANGED);
  saveSoon();
  return { ok: true, items: placed, roubles };
}

// ---------------------------------------------------------
// what he buys
// ---------------------------------------------------------
/** how much of its handbook price an item is still worth, by its condition */
export function qualityOf(item) {
  const tpl = item.tpl;
  const maxDura = tpl.wpn?.maxDura ?? tpl.dura ?? null;
  if (maxDura && item.dura != null) {
    const d = Math.min(item.dura, item.maxDura ?? maxDura) / maxDura;
    return d > 0 ? Math.sqrt(d) : 0.01;
  }
  if (tpl.res && item.res != null && tpl.res.max) return Math.max(0.01, item.res / tpl.res.max);
  return 1;
}

/** handbook worth in roubles of an item with everything on and in it */
export function worthOf(item, onlyIf = null) {
  let v = 0;
  if (!onlyIf || onlyIf(item)) v += (item.tpl.price || 0) * qualityOf(item) * (item.stack || 1);
  for (const m of item.mods()) v += worthOf(m, onlyIf);
  if (item.rounds) for (const r of item.rounds) v += (TPL[r.t]?.price || 0) * r.n;
  if (item.chamber) for (const t of item.chamber) v += TPL[t]?.price || 0;
  return v;
}

/** does this trader deal in this template at all */
export function buysTemplate(trader, tpl) {
  if (!tpl || tpl.quest || tpl.cat === 'money') return false;
  const b = trader.buy || {};
  if ((b.deny || []).includes(tpl.id)) return false;
  const cats = tpl.cats;
  if (!cats) return legacyBuys(trader, tpl);
  if ((b.denyCats || []).some((c) => cats.includes(c))) return false;
  if ((b.items || []).includes(tpl.id)) return true;
  return (b.cats || []).some((c) => cats.includes(c));
}

/**
 * Templates built before the database carried the game's own category chain
 * only know the project's short category names. This table is the same
 * who-buys-what the old trader screen used, kept so those items still sell.
 */
const LEGACY_BUYS = {
  prapor: ['weapon', 'pistol', 'mag', 'ammo', 'ammobox', 'mod', 'grenade', 'armor', 'meds', 'barter', 'key'],
  therapist: ['meds', 'food', 'drink', 'info', 'barter', 'container'],
  skier: ['rig', 'weapon', 'pistol', 'mag', 'ammo', 'ammobox', 'mod', 'grenade', 'electronics', 'valuables', 'barter', 'container'],
  peacekeeper: ['weapon', 'pistol', 'mag', 'ammo', 'ammobox', 'mod', 'armor', 'info', 'electronics', 'valuables', 'key'],
  mechanic: ['weapon', 'pistol', 'mag', 'ammo', 'ammobox', 'mod', 'electronics', 'barter', 'key'],
  ragman: ['armor', 'helmet', 'glasses', 'facecover', 'headset', 'rig', 'backpack', 'container', 'barter'],
  jaeger: ['weapon', 'melee', 'mod', 'rig', 'backpack', 'meds', 'food', 'drink', 'barter'],
};
function legacyBuys(trader, tpl) {
  if (trader.fence) return true;
  return (LEGACY_BUYS[trader.key] || []).includes(tpl.cat);
}

/** why this trader will not take this item, or null if he will */
export function sellBlocker(trader, item) {
  const tpl = item.tpl;
  if (tpl.cat === 'money') return 'money';
  if (tpl.quest) return 'task item';
  if (!item.isEmptyContainer) return 'not empty';
  if (!buysTemplate(trader, tpl)) return 'not bought';
  const rules = DB.progress?.buyout || {};
  const maxDura = tpl.wpn?.maxDura ?? tpl.dura ?? null;
  if (maxDura && item.dura != null && rules.MinDurability != null
      && item.dura / maxDura < rules.MinDurability) return 'too worn';
  if (sellPrice(trader, item) < 1) return 'worthless';
  return null;
}

/** what the trader pays for one item (the whole stack), in his own currency */
export function sellPrice(trader, item) {
  const pay = levelRow(trader).pay || 0;
  // on an assembled gun he pays for the parts he deals in and nothing for the rest
  const rub = worthOf(item, (it) => it === item || buysTemplate(trader, it.tpl)) * pay;
  if (trader.cur === 'RUB') return Math.floor(rub);
  return Math.round(rub / fxRate(trader.cur));
}

/** sell a list of items in one deal; returns { ok, total, sold, reason } */
export function sellItems(trader, items) {
  const ok = items.filter((it) => !sellBlocker(trader, it));
  if (!ok.length) return { ok: false, reason: 'No selected items', total: 0, sold: [] };
  let total = 0;
  let roubles = 0;
  for (const it of ok) {
    const p = sellPrice(trader, it);
    total += p;
    roubles += p * fxRate(trader.cur);
  }
  if (!canAddMoney(total, trader.cur)) return { ok: false, reason: 'Not enough space in stash', total, sold: [] };
  const sold = ok.map((it) => ({ tpl: it.tpl, stack: it.stack, fir: it.fir }));
  for (const it of ok) detach(it);
  addMoney(total, trader.cur);
  addSales(trader, roubles);
  emit(EV.TRADE_DEAL, { kind: 'sell', trader, sold, total, roubles });
  emit(EV.INVENTORY_CHANGED);
  saveSoon();
  return { ok: true, total, sold };
}

// ---------------------------------------------------------
// Fence
// ---------------------------------------------------------
/**
 * Fence has no list. What he sells is whatever passed through his hands since
 * the last restock: a random spread of the whole item table, dearer than the
 * handbook, each lot of one or a few. Everything he has is at level one.
 */
function fenceOffers(trader) {
  const st = traderRecord(trader);
  if (!st.fence) st.fence = rollFence(trader);
  const out = [];
  for (const row of st.fence) {
    const tpl = TPL[row.k];
    if (!tpl) continue;
    const price = Math.max(1, Math.round((tpl.presetPrice || tpl.price || 1) * (trader.fence.priceMult || 1.3)));
    // the limit on a Fence lot is the lot itself: `row.left` is what is on the shelf
    out.push({
      id: `f:${row.k}`, t: -1, trader, item: tpl.id, n: 1, ll: 1,
      cost: [[ROUBLES, price]], _tpl: tpl, _fence: row,
    });
  }
  return out;
}

function rollFence(trader) {
  const deny = new Set(trader.fence.deny || []);
  const pool = Object.values(TPL).filter((t) => t.id && !deny.has(t.id) && !t.quest
    && !['money', 'secure'].includes(t.cat) && (t.price || 0) > 1200 && (t.price || 0) < 400000
    && !t.types?.includes('noFlea') && t.imgUrl);
  const want = Math.min(Math.round((trader.fence.size || 120) / 2), pool.length);
  const picked = new Set();
  const rows = [];
  let guard = 0;
  while (rows.length < want && guard++ < want * 20) {
    const t = pool[Math.floor(Math.random() * pool.length)];
    if (picked.has(t.key)) continue;
    picked.add(t.key);
    rows.push({ k: t.key, left: t.stack > 1 ? Math.min(t.stack, 5 + Math.floor(Math.random() * 40)) : 1 });
  }
  return rows;
}
