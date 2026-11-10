// =========================================================
// insurance
//
// What is worn or carried into a raid can be insured with a trader for a
// share of its worth. Lost with its owner, an insured thing has that
// trader's chance of being found where it fell; what is found comes back by
// message once his people have had their hours with it, and waits there as
// long as he stores it. Found or not, the cover is spent with the raid.
//
// The terms are the game's own (traders-db: the share by loyalty level, the
// hours, the chance, the storage time).
// =========================================================

import { game, saveSoon, countMoney, takeMoney } from '../core/state.js';
import { emit, EV } from '../core/events.js';
import { t } from '../core/i18n.js';
import { fmtDate } from '../core/util.js';
import { Item } from '../inventory/model.js';
import { DB } from './db.js';
import { isUnlocked, levelRow } from './traders.js';
import { sendMail } from './mail.js';
import { insuranceReturnFactor } from './hideout.js';

const HOUR = 3600 * 1000;

// what each insurer writes: when the search starts, when it brings something
// back, when it brings nothing
const TALK = {
  prapor: {
    start: [{ key: '5914452d86f7744e917870c7 1' }],
    found: [{ key: '58fe0e2d86f774720e7a498d 0' }, { key: '58fe0e2d86f774720e7a498d 1' }, { key: '58fe0e2d86f774720e7a498d 2' }, { key: '58fe0e2d86f774720e7a498d 3' }, { key: '58fe0e2d86f774720e7a498d 4' }],
    failed: [{ key: '595f995d86f77476b51172ee 1' }],
  },
  therapist: {
    start: [{ key: '5914451a86f7744c2d7102f9 1' }, { key: '5914451a86f7744c2d7102f9 2' }],
    found: [{ key: '58fe0e3486f77471f772c3f2 0' }, { key: '58fe0e3486f77471f772c3f2 1' }, { key: '58fe0e3486f77471f772c3f2 2' }, { key: '58fe0e3486f77471f772c3f2 3' }, { key: '58fe0e3486f77471f772c3f2 4' }],
    failed: [{ key: '595f996586f774767d03cbea 0' }, { key: '595f996586f774767d03cbea 1' }],
  },
};

const pick = (list) => list[Math.floor(Math.random() * list.length)];

/** a trader's line with the raid's day, hour and place written in */
function line(trader, kind, about) {
  const lines = TALK[trader.key]?.[kind];
  if (!lines) return '';
  const d = new Date(about.ts);
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return t(pick(lines).key).replace('{date}', fmtDate(about.ts)).replace('{time}', hm).replace('{location}', about.loc || '');
}

/** the traders who insure, as far as this character has got with them */
export function insurers() {
  return DB.traders.filter((tr) => tr.insurance && isUnlocked(tr) && levelRow(tr)?.ins > 0);
}

/** why a thing cannot be covered, as the client says it, or null */
export function coverBlocker(item) {
  if (item.insured) return t('Item is already insured');
  const tpl = item.tpl;
  if (tpl.noIns || tpl.cat === 'money' || tpl.cat === 'secure' || (tpl.stack || 1) > 1) return t('Item is not available for insurance');
  return null;
}

/** what covering one thing costs with a trader: his share of what it is worth */
export function coverCost(item, trader) {
  return Math.max(1, Math.round((item.tpl.price || 0) * levelRow(trader).ins));
}

/**
 * The kit that would be lost with its owner, as the insurance screen lists
 * it: every item with what is built into it and packed in it under it.
 * @returns {{ item: Item, depth: number }[]}
 */
export function kitRows(equipment = game.equipment) {
  const rows = [];
  const walk = (item, depth) => {
    rows.push({ item, depth });
    for (const m of item.mods()) walk(m, depth + 1);
    for (const g of item.grids || []) for (const it of g.items()) walk(it, depth + 1);
  };
  for (const it of equipment.insecureItems()) walk(it, 0);
  return rows;
}

/**
 * Cover the items with a trader and pay him for it out of the stash.
 * @returns {{ ok: boolean, why?: string, cost?: number }}
 */
export function insure(items, trader) {
  const list = items.filter((it) => !coverBlocker(it));
  if (!list.length) return { ok: false, why: t('Item is not available for insurance') };
  const cost = list.reduce((n, it) => n + coverCost(it, trader), 0);
  if (countMoney('RUB') < cost) return { ok: false, why: t('NotEnoughMoney') };
  takeMoney(cost, 'RUB');
  for (const it of list) it.insured = trader.key;
  saveSoon();
  emit(EV.INVENTORY_CHANGED);
  return { ok: true, cost };
}

/**
 * What comes back of one lost item. A thing found stays whole only in what
 * was covered by the same trader and found with it; the rest of what it held
 * is gone, and covered things found without what held them come back loose.
 * @returns {{ back: boolean, loose: Item[] }}
 */
function salvage(item, found) {
  const loose = [];
  const part = (child, drop) => {
    const got = salvage(child, found);
    const stays = got.back && child.insured === item.insured;
    if (!stays) { drop(); if (got.back) loose.push(child); }
    loose.push(...got.loose);
  };
  for (const sl of item.slots || []) if (sl.item) { const m = sl.item; part(m, () => sl.clear()); }
  for (const g of item.grids || []) for (const it of g.items()) part(it, () => g.remove(it));
  return { back: !!item.insured && found(item), loose };
}

/**
 * The kit is lost with its owner: what was insured is looked for. Called
 * before the equipment is cleared.
 * @param {{ location?: string, loc?: string }} about where it happened: the location's id, or failing that a name for it
 */
export function claimLost(equipment, about = {}) {
  const now = Date.now();
  // the place by its plain name, whichever hour's version of it this was
  const places = DB.progress?.locations || [];
  const here = places.find((l) => l.id === about.location);
  const where = (here && places.find((l) => l.key === here.key)?.name) || about.loc || '';
  const byKey = Object.fromEntries(DB.traders.map((tr) => [tr.key, tr]));
  const found = (item) => Math.random() * 100 < (byKey[item.insured]?.insurance?.returnPct ?? 0);
  /** insurer key -> the items his people found */
  const cases = new Map();
  const open = (key) => { if (!cases.has(key)) cases.set(key, []); return cases.get(key); };
  for (const top of equipment.insecureItems()) {
    for (const d of [top, ...top.descendants()]) if (d.insured) open(d.insured);
    const got = salvage(top, found);
    for (const it of got.back ? [top, ...got.loose] : got.loose) open(it.insured).push(it);
  }
  if (!cases.size) return;
  if (!Array.isArray(game.profile.insurance)) game.profile.insurance = [];
  for (const [key, items] of cases) {
    const trader = byKey[key];
    if (!trader?.insurance) continue;
    const terms = trader.insurance;
    const hours = (terms.minH + Math.random() * (terms.maxH - terms.minH)) * insuranceReturnFactor();
    for (const it of items) for (const d of [it, ...it.descendants()]) delete d.insured;
    game.profile.insurance.push({ from: trader.id, ts: now, at: now + hours * HOUR, loc: where, items: items.map((it) => it.toJSON()) });
    const text = line(trader, 'start', { ts: now, loc: where });
    if (text) sendMail({ from: trader.id, kind: 'insurance', text });
  }
  saveSoon();
}

/** hand over what the insurers have finished with */
export function deliverDue(now = Date.now()) {
  const waiting = game.profile.insurance;
  if (!Array.isArray(waiting) || !waiting.length) return 0;
  let sent = 0;
  for (let i = waiting.length - 1; i >= 0; i--) {
    const c = waiting[i];
    if (c.at > now) continue;
    waiting.splice(i, 1);
    const trader = DB.traderById[c.from];
    if (!trader) continue;
    const items = (c.items || []).map((o) => Item.fromJSON(o));
    sendMail({
      from: trader.id, kind: 'insurance', items, hours: trader.insurance?.storeH,
      text: line(trader, items.length ? 'found' : 'failed', c),
    });
    sent++;
  }
  if (sent) saveSoon();
  return sent;
}
