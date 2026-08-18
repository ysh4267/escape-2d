// =========================================================
// weapon builds (the game's "weapon presets")
//
// A build is a weapon template plus a tree of parts, {slot: {t, s: {...}}}
// - the same shape the factory presets come in (tpl.preset and the alternates
// in tpl.wpn.alts). The player saves one off a gun in the modding screen,
// names it, and can later ASSEMBLE it: the gun is taken to exactly that
// tree, using the parts the player owns - what is on the gun already stays,
// what is loose in the stash goes on, what does not belong comes off into
// the stash. Parts that are missing are listed with what the traders ask for
// them, and can be bought in one go before assembling. Nothing is invented:
// a build with a missing part does not assemble.
//
// The store lives in the save under 'builds'.
// =========================================================

import { registerSaveSection, saveSoon, game, traderState, countMoney, takeMoney, addExp } from '../core/state.js';
import { getTpl, TPL, FX } from '../data/items.js';
import { TRADERS, loyaltyFor, buyPrice, buyCurrency } from '../data/traders.js';
import { Item, autoPlace, detach } from './model.js';
import { installMod, uninstallMod, treeOf, treeParts, weaponStats } from './weapon.js';
import { sfx } from '../core/audio.js';
import { uid } from '../core/util.js';

/** @type {{id:string,name:string,weapon:string,tree:object,ts:number}[]} */
export const builds = [];

registerSaveSection('builds', {
  dump: () => (builds.length ? builds.map((b) => ({ ...b })) : null),
  restore: (v) => {
    builds.length = 0;
    for (const b of v || []) {
      if (!b || !getTpl(b.weapon) || !b.tree) continue;
      builds.push({ id: b.id || uid('b'), name: String(b.name || 'Build'), weapon: b.weapon, tree: b.tree, ts: b.ts || 0 });
    }
  },
});

/** the builds saved for a weapon template, newest first */
export function buildsFor(weaponKey) {
  return builds.filter((b) => b.weapon === weaponKey).sort((a, b) => b.ts - a.ts);
}

/** the factory's own builds of a weapon: the default and the alternates */
export function factoryBuilds(tpl) {
  const out = [];
  if (tpl?.preset) out.push({ id: `factory:${tpl.key}`, name: tpl.presetName || `${tpl.short} Default`, label: 'Default', weapon: tpl.key, tree: tpl.preset, factory: true });
  for (const a of tpl?.wpn?.alts || []) {
    out.push({ id: `factory:${a.id}`, name: a.label ? `${tpl.short} ${a.label}` : a.name, label: a.label || a.name, weapon: tpl.key, tree: a.tree, load: a.load || null, factory: true });
  }
  return out;
}

/** save the parts on `item` under `name`; a build of that name for that gun is overwritten */
export function saveBuild(item, name) {
  if (!item?.isWeapon) return { ok: false, reason: 'not a weapon' };
  const clean = String(name || '').trim().slice(0, 40);
  if (!clean) return { ok: false, reason: 'a build needs a name' };
  const tree = treeOf(item);
  const prev = builds.find((b) => b.weapon === item.tplId && b.name.toLowerCase() === clean.toLowerCase());
  let rec;
  if (prev) { prev.tree = tree; prev.ts = Date.now(); rec = prev; }
  else { rec = { id: uid('b'), name: clean, weapon: item.tplId, tree, ts: Date.now() }; builds.push(rec); }
  saveSoon();
  return { ok: true, build: rec, overwrote: !!prev };
}

export function deleteBuild(id) {
  const i = builds.findIndex((b) => b.id === id);
  if (i < 0) return false;
  builds.splice(i, 1);
  saveSoon();
  return true;
}

export function renameBuild(id, name) {
  const b = builds.find((x) => x.id === id);
  const clean = String(name || '').trim().slice(0, 40);
  if (!b || !clean) return false;
  b.name = clean;
  saveSoon();
  return true;
}

// ---------------------------------------------------------
// planning: what an assembly needs and what is there
// ---------------------------------------------------------
/** loose parts in `grids` (top level or inside cases) by template key */
function loosePartsIn(grids) {
  const by = new Map();
  const seen = new Set();
  const consider = (it) => {
    if (seen.has(it.uid)) return;
    seen.add(it.uid);
    if (it.holder?.kind !== 'grid') return;
    if (!(it.cat === 'mod' || it.cat === 'mag')) return;
    if (!by.has(it.tplId)) by.set(it.tplId, []);
    by.get(it.tplId).push(it);
  };
  for (const g of grids) {
    for (const it of g.items()) {
      consider(it);
      for (const d of it.descendants()) if (d.holder?.kind === 'grid') consider(d);
    }
  }
  // bare parts first: a part with things hanging off it costs a strip
  for (const arr of by.values()) arr.sort((a, b) => [...a.allMods()].length - [...b.allMods()].length);
  return by;
}

/** parts of the tree that the gun already carries in the right place */
function inPlace(node, tree, out = new Map()) {
  if (!node?.slots) return out;
  for (const sl of node.slots) {
    const want = tree?.[sl.name];
    if (!want || !sl.item || sl.item.tplId !== want.t) continue;
    out.set(want.t, (out.get(want.t) || 0) + 1);
    inPlace(sl.item, want.s || {}, out);
  }
  return out;
}

/**
 * What assembling `tree` onto `weapon` would need from `sources`, and what is
 * missing: {need:[{t,n}], have:[{t,n}], missing:[{t,n}], off:[...], complete}
 * `off` is what would come off the gun.
 */
export function planBuild(weapon, tree, sources) {
  const need = treeParts(tree);
  const already = inPlace(weapon, tree);
  const loose = loosePartsIn(sources);
  const have = [], missing = [];
  for (const [t, n] of need) {
    const on = already.get(t) || 0;
    const owned = (loose.get(t) || []).length;
    const short = Math.max(0, n - on - owned);
    have.push({ t, n, on, owned: Math.min(owned, n - on) });
    if (short > 0) missing.push({ t, n: short });
  }
  const off = [];
  const walk = (node, sub) => {
    if (!node?.slots) return;
    for (const sl of node.slots) {
      if (!sl.item) continue;
      const want = sub?.[sl.name];
      if (!want || want.t !== sl.item.tplId) off.push(sl.item);
      else walk(sl.item, want.s || {});
    }
  };
  walk(weapon, tree);
  return { need: [...need].map(([t, n]) => ({ t, n })), have, missing, off, complete: missing.length === 0 };
}

/** what the traders ask for a missing part, cheapest first: [{trader, off, price, cur, ll, locked}] */
export function offersFor(key) {
  const out = [];
  const tpl = TPL[key];
  if (!tpl) return out;
  for (const t of TRADERS) {
    for (const off of t.assort || []) {
      if (off.key !== key) continue;
      const st = traderState(t.id);
      const ll = loyaltyFor(game.profile.level, st.rep, st.spent);
      out.push({
        trader: t, off, price: buyPrice(t, tpl, FX, off), cur: buyCurrency(t, tpl, off),
        ll: off.ll, locked: off.ll > ll, stock: off.stock,
      });
    }
  }
  out.sort((a, b) => (a.locked - b.locked) || (a.price * (FX[a.cur] || 1) - b.price * (FX[b.cur] || 1)));
  return out;
}

/** the cheapest buyable offer per missing part, and the rouble total; null when one cannot be had */
export function shoppingList(missing) {
  const lines = [];
  let totalRub = 0;
  let allThere = true;
  for (const m of missing) {
    const best = offersFor(m.t).find((o) => !o.locked && o.stock >= m.n);
    if (!best) { allThere = false; lines.push({ t: m.t, n: m.n, offer: null }); continue; }
    lines.push({ t: m.t, n: m.n, offer: best });
    totalRub += best.price * (FX[best.cur] || 1) * m.n;
  }
  return { lines, totalRub: Math.round(totalRub), complete: allThere };
}

/** buy `n` of one offer straight into `into` grids: {ok, items|reason} */
export function buyOffer(offer, n, into) {
  if (!offer || offer.locked) return { ok: false, reason: 'Bad user loyalty level' };
  if (offer.stock < n) return { ok: false, reason: 'Item is out of stock' };
  const total = offer.price * n;
  if (countMoney(offer.cur) < total) return { ok: false, reason: 'Not enough money' };
  const made = [];
  for (let i = 0; i < n; i++) {
    const it = new Item(offer.off.key, { examined: true });
    if (!autoPlace(it, into, { merge: false })) {
      for (const m of made) detach(m);
      return { ok: false, reason: 'Not enough space in stash' };
    }
    made.push(it);
  }
  takeMoney(total, offer.cur);
  offer.off.stock -= n;
  const st = traderState(offer.trader.id);
  const rub = total * (FX[offer.cur] || 1);
  st.spent += rub;
  st.rep = Math.min(10, st.rep + rub / 900000);
  addExp(Math.round(n * 2));
  sfx.trade?.('deal');
  return { ok: true, items: made, total, cur: offer.cur };
}

/**
 * Buy every line of a shopping list into `into` grids. All or nothing on the
 * money; the items are placed with merge off so a failure can be undone.
 */
export function buyMissing(list, into) {
  if (!list.complete) return { ok: false, reason: 'a part is not sold by anyone you can buy from' };
  // money by currency
  const need = {};
  for (const l of list.lines) need[l.offer.cur] = (need[l.offer.cur] || 0) + l.offer.price * l.n;
  for (const [cur, amt] of Object.entries(need)) {
    if (countMoney(cur) < amt) return { ok: false, reason: 'Not enough money' };
  }
  const made = [];
  for (const l of list.lines) {
    for (let i = 0; i < l.n; i++) {
      const it = new Item(l.t, { examined: true });
      if (!autoPlace(it, into, { merge: false })) {
        for (const m of made) detach(m);
        return { ok: false, reason: 'Not enough space in stash' };
      }
      made.push(it);
    }
  }
  for (const [cur, amt] of Object.entries(need)) takeMoney(amt, cur);
  for (const l of list.lines) {
    l.offer.off.stock -= l.n;
    const st = traderState(l.offer.trader.id);
    const rub = l.offer.price * l.n * (FX[l.offer.cur] || 1);
    st.spent += rub;
    st.rep = Math.min(10, st.rep + rub / 900000);
  }
  addExp(Math.round(made.length * 2));
  sfx.trade?.('deal');
  return { ok: true, bought: made };
}

// ---------------------------------------------------------
// assembling
// ---------------------------------------------------------
/**
 * Take `weapon` to exactly `tree`, out of `sources`. Parts not in the tree
 * come off into `sources`; parts in the tree that the gun lacks come out of
 * `sources`. Refuses up front when a part is missing (unless opts.partial),
 * and reports anything a slot refused (fit, conflict, room).
 */
export function assembleBuild(weapon, tree, sources, opts = {}) {
  const plan = planBuild(weapon, tree, sources);
  if (!plan.complete && !opts.partial) {
    return { ok: false, reason: 'missing parts', missing: plan.missing, plan };
  }
  const loose = loosePartsIn(sources);
  const take = (t) => {
    const arr = loose.get(t);
    while (arr && arr.length) {
      const it = arr.shift();
      if (it.holder?.kind === 'grid') return it;
    }
    return null;
  };
  const problems = [];
  let installed = 0, removed = 0;

  // everything under a part comes off before the part is swapped, so the
  // slot's occupant is bare (canInstall refuses to bury a part's children)
  const stripBelow = (node) => {
    if (!node?.slots) return;
    for (const sl of node.slots) {
      if (!sl.item) continue;
      stripBelow(sl.item);
      const r = uninstallMod(sl, sources);
      if (r.ok) { removed++; register(r.part); } else problems.push(`${sl.label}: ${r.reason}`);
    }
  };
  // a part that came off may be exactly what another slot wants
  const register = (part) => {
    if (!loose.has(part.tplId)) loose.set(part.tplId, []);
    loose.get(part.tplId).push(part);
  };

  const walk = (node, sub) => {
    if (!node?.slots) return;
    for (const sl of node.slots) {
      const want = sub?.[sl.name];
      if (!want) {
        if (sl.item) {
          stripBelow(sl.item);
          const r = uninstallMod(sl, sources);
          if (r.ok) { removed++; register(r.part); } else problems.push(`${sl.label}: ${r.reason}`);
        }
        continue;
      }
      if (sl.item && sl.item.tplId === want.t) { walk(sl.item, want.s || {}); continue; }
      const cand = take(want.t);
      if (!cand) { problems.push(`${sl.label}: ${getTpl(want.t)?.short || want.t} missing`); continue; }
      if (sl.item) stripBelow(sl.item);
      const r = installMod(sl, cand, sources);
      if (!r.ok) { problems.push(`${sl.label}: ${r.reason}`); register(cand); continue; }
      installed++;
      if (r.replaced) register(r.replaced);
      walk(cand, want.s || {});
    }
  };
  walk(weapon, tree);
  if (installed || removed) sfx.buildAssemble?.();
  return { ok: problems.length === 0, installed, removed, problems, plan };
}

/** the stats a build would have, without touching anything: a throwaway gun */
export function previewStats(weaponKey, tree) {
  let it;
  try { it = new Item(weaponKey, { bare: true }); } catch { return null; }
  applyTree(it, tree);
  return weaponStats(it);
}

function applyTree(item, tree) {
  if (!item.slots || !tree) return;
  for (const sl of item.slots) {
    const rec = tree[sl.name];
    if (!rec || !getTpl(rec.t) || !sl.def.f.includes(rec.t)) continue;
    let part;
    try { part = new Item(rec.t, { bare: true }); } catch { continue; }
    sl.set(part);
    if (rec.s) applyTree(part, rec.s);
  }
}

/** does the tree contain a part the player has not examined yet */
export function unknownParts(tree, isKnownKey) {
  const out = [];
  for (const [t] of treeParts(tree)) if (!isKnownKey(t)) out.push(t);
  return out;
}
