// =========================================================
// persistent game state: profile, stash, worn gear, trader standing
// =========================================================

import { Grid, Item, autoPlace, detach } from '../inventory/model.js';
import { Equipment } from '../inventory/equipment.js';
import { TPL, getTpl, CURRENCY_KEY, FX } from '../data/items.js';
import { seedUidCounter } from './util.js';
import { Health } from '../raid/health.js';
import { emit, EV } from './events.js';
import { levelForExp } from '../game/db.js';

export let SAVE_KEY = 'escape2d.save.v1';
/** tests point this at a scratch key so they never clobber a real profile */
export function setSaveKey(k) { SAVE_KEY = k; }
export const STASH_W = 10;
export const STASH_H = 32;

export const game = {
  version: 1,
  profile: {
    name: 'PMC',
    /** 'USEC' | 'BEAR' - some tasks are for one side only */
    faction: 'USEC',
    /** the edition the character was started on: it decides the starting kit and the stash */
    edition: 'standard',
    /** when the character was made (ms) */
    registered: 0,
    level: 1,
    exp: 0,
    raids: 0,
    survived: 0,
    died: 0,
    extracted: 0,
    bestHaul: 0,
    /** kills by kind, raid outcomes by kind, and the other numbers the OVERALL tab reads */
    stats: {},
    /** template keys the player has examined */
    examined: new Set(),
    /** trader key -> { rep, sales, bought, restockAt, unlocked } */
    traders: {},
    /** task id -> { s: a|d|f, t, fin, c: { objective id: count } } */
    quests: {},
    /** task item id -> 'raid' | 'stash' */
    qitems: {},
    /** the messenger: [{ id, from, kind, text, ts, items?, exp?, read? }] */
    mail: [],
    /** skill id -> points */
    skills: {},
    /** template id -> wishlist heading (src/game/wishlist.js) */
    wishlist: {},
    /** template ids whose handbook entry has been opened; the rest wear the "new" mark */
    handbookSeen: [],
    /** the flea market: { rating, growing, offers, sellSum, bought } (src/game/flea.js) */
    flea: null,
    /** the hideout: zones, constructions, productions, the generator (src/game/hideout.js) */
    hideout: {},
  },
  stash: null,
  equipment: null,
  /** the PMC's body: seven parts, conditions, energy and hydration */
  health: null,
  /** live raid session, null outside of a raid */
  raid: null,
  settings: { autoSave: true },
};

export function initState() {
  game.stash = new Grid(STASH_W, STASH_H, { tag: 'stash', label: 'STASH' });
  game.equipment = new Equipment();
  game.health = new Health();
}

// ---------------------------------------------------------
// money
// ---------------------------------------------------------
export function countMoney(cur = 'RUB', grids = null) {
  const key = CURRENCY_KEY[cur];
  if (!TPL[key]) return 0;
  let n = 0;
  for (const g of grids || [game.stash]) {
    for (const it of g.items()) {
      if (it.tpl.key === key) n += it.stack;
      if (it.grids) n += countMoney(cur, it.grids);
    }
  }
  return n;
}

export function addMoney(amount, cur = 'RUB', grids = null) {
  if (amount <= 0) return true;
  const key = CURRENCY_KEY[cur];
  const tpl = TPL[key];
  if (!tpl) return false;
  const targets = grids || [game.stash];

  let left = amount;
  // top up existing stacks first
  for (const g of targets) {
    for (const it of g.items()) {
      if (it.tpl.key !== key) continue;
      const room = it.spaceLeft();
      if (room <= 0) continue;
      const add = Math.min(room, left);
      it.stack += add;
      left -= add;
      if (left <= 0) return true;
    }
  }
  // then new stacks
  let guard = 0;
  while (left > 0 && guard++ < 200) {
    const chunk = Math.min(left, tpl.stack);
    const stack = new Item(key, { stack: chunk, examined: true });
    if (!autoPlace(stack, targets)) return false;
    left -= chunk;
  }
  return left <= 0;
}

export function takeMoney(amount, cur = 'RUB', grids = null) {
  if (amount <= 0) return true;
  const key = CURRENCY_KEY[cur];
  const tpl = TPL[key];
  if (!tpl) return false;
  const targets = grids || [game.stash];
  if (countMoney(cur, targets) < amount) return false;

  let left = amount;
  const drain = (gs) => {
    for (const g of gs) {
      for (const it of g.items()) {
        if (it.grids) drain(it.grids);
        if (left <= 0) return;
        if (it.tpl.key !== key) continue;
        const take = Math.min(it.stack, left);
        it.stack -= take;
        left -= take;
        if (it.stack <= 0) detach(it);
      }
    }
  };
  drain(targets);
  return left <= 0;
}

/**
 * Whether addMoney(amount) is guaranteed to fully succeed right now.
 * Currency tiles are 1x1, so any free cell can take an overflow stack.
 */
export function canAddMoney(amount, cur = 'RUB', grids = null) {
  if (amount <= 0) return true;
  const key = CURRENCY_KEY[cur];
  const tpl = TPL[key];
  if (!tpl) return false;
  const targets = grids || [game.stash];
  let left = amount;
  let freeCells = 0;
  for (const g of targets) {
    freeCells += g.capacity - g.usedCells();
    for (const it of g.items()) {
      if (it.tpl.key === key) left -= it.spaceLeft();
    }
  }
  if (left <= 0) return true;
  return Math.ceil(left / (tpl.stack || 1)) <= freeCells;
}

/** total wealth in roubles, converting foreign currency at FX */
export function netWorthRub() {
  let v = 0;
  for (const cur of ['RUB', 'USD', 'EUR']) v += countMoney(cur) * FX[cur];
  return v;
}

// ---------------------------------------------------------
// progression
// ---------------------------------------------------------
/**
 * Experience goes onto the running total and the level is read off the game's
 * own table (level 2 begins at 1,000, level 3 at 4,017 ... 79 at 172 million).
 */
// where experience of a kind goes while a raid is keeping count (game/raidexp.js)
const RAID_LINE = { kill: 'combat/elim', loot: 'looting/items', heal: 'treatment/healed', survive: 'exploring/escape' };

export function addExp(n, why = '') {
  n = Math.round(n);
  if (!(n > 0)) return;
  // in a raid nothing earned there is the character's yet
  const line = game.raidExp && RAID_LINE[why];
  if (line) {
    const row = game.raidExp[line] || (game.raidExp[line] = { xp: 0, n: 0 });
    row.xp += n;
    row.n += 1;
    emit(EV.RAID_EXP, { line, amount: n });
    return;
  }
  game.profile.exp += n;
  emit(EV.EXP, { amount: n, why });
  const lvl = levelForExp(game.profile.exp);
  if (lvl !== game.profile.level) {
    game.profile.level = lvl;
    emit(EV.LEVEL_UP, lvl);
  }
}

/** bump one of the profile's running counters (kills, raids by outcome ...) */
export function addStat(key, n = 1) {
  const st = game.profile.stats || (game.profile.stats = {});
  st[key] = (st[key] || 0) + n;
}

export function markExamined(tplKey) {
  game.profile.examined.add(tplKey);
}

export function isExamined(tplKey) {
  const t = getTpl(tplKey);
  if (t?.known || t?.alwaysExamined) return true;
  return game.profile.examined.has(tplKey);
}

export function traderState(id) {
  if (!game.profile.traders[id]) game.profile.traders[id] = { rep: 0, spent: 0 };
  const st = game.profile.traders[id];
  if (st.spent == null) st.spent = 0;   // profiles saved before spent-gating
  if (st.rep == null) st.rep = 0;
  return st;
}

// ---------------------------------------------------------
// save / load
// ---------------------------------------------------------

/**
 * Modules outside core can persist a section of their own (the trading table,
 * for instance) without state.js having to import them: they register a dump
 * and a restore, and save()/load() call these by key.
 */
const SAVE_SECTIONS = {};
/**
 * `roots` is an optional list of Grids the section owns. reseedUids() walks
 * them too — items stranded on the trading table across a reload used to be
 * invisible to it, which is exactly how a uid collision gets minted.
 */
export function registerSaveSection(key, { dump, restore, roots = null }) {
  SAVE_SECTIONS[key] = { dump, restore, roots };
}

export function save() {
  try {
    const data = {
      v: game.version,
      p: {
        ...game.profile,
        examined: Array.from(game.profile.examined),
      },
      stash: game.stash.toJSON(),
      eq: game.equipment.toJSON(),
      h: game.health ? game.health.toJSON() : null,
    };
    for (const [key, sec] of Object.entries(SAVE_SECTIONS)) {
      const v = sec.dump();
      if (v != null) (data.x || (data.x = {}))[key] = v;
    }
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    return true;
  } catch (err) {
    console.error('[save] failed', err);
    return false;
  }
}

export function load() {
  let raw;
  try { raw = localStorage.getItem(SAVE_KEY); } catch { return false; }
  if (!raw) return false;
  try {
    const data = JSON.parse(raw);
    if (!data || data.v !== game.version) return false;
    Object.assign(game.profile, data.p || {});
    game.profile.examined = new Set(data.p?.examined || []);
    game.profile.traders = data.p?.traders || {};
    // sections that profiles saved before tasks, mail and skills do not have
    for (const [k, empty] of [['quests', {}], ['qitems', {}], ['skills', {}], ['stats', {}]]) {
      if (!game.profile[k] || typeof game.profile[k] !== 'object') game.profile[k] = empty;
    }
    if (!Array.isArray(game.profile.mail)) game.profile.mail = [];
    if (!game.profile.registered) game.profile.registered = Date.now();
    // the level table changed under old profiles: the experience is what was earned
    game.profile.level = levelForExp(game.profile.exp || 0);
    // the stash is as tall as the edition (and the hideout) made it
    const rows = game.profile.stashRows || data.stash?.h || STASH_H;
    if (rows !== game.stash.h) game.stash = new Grid(STASH_W, rows, { tag: 'stash', label: 'STASH' });
    game.stash.loadJSON(data.stash);
    game.equipment.loadJSON(data.eq);
    if (data.h) {
      game.health = Health.fromJSON(data.h);
      // the body kept mending while the tab was shut, up to a day of it
      const away = (Date.now() - (data.h.ts || Date.now())) / 1000;
      if (away > 5) game.health.regen(Math.min(away, 24 * 3600));
    }
    if (data.x) {
      for (const [key, v] of Object.entries(data.x)) {
        try { SAVE_SECTIONS[key]?.restore(v); } catch (err) { console.error(`[load] section ${key}`, err); }
      }
    }
    reseedUids();
    return true;
  } catch (err) {
    console.error('[load] failed', err);
    return false;
  }
}

/**
 * Push the uid counter past every uid we just loaded. Without this a fresh
 * session restarts the counter at zero and can mint a uid that collides with
 * a saved item — two items sharing a uid silently shadow each other in the
 * grid's item map and one of them is dropped by the next save.
 */
function reseedUids() {
  let maxN = 0;
  const track = (it) => {
    // uid layout: 1-letter prefix + base36 counter + 3 random base36 chars
    const m = /^[a-z]([0-9a-z]+)[0-9a-z]{3}$/.exec(it.uid || '');
    if (m) {
      const n = parseInt(m[1], 36);
      if (Number.isFinite(n)) maxN = Math.max(maxN, n);
    }
  };
  for (const it of game.stash.items()) { track(it); for (const d of it.descendants()) track(d); }
  for (const it of game.equipment.everything()) track(it);
  for (const sec of Object.values(SAVE_SECTIONS)) {
    for (const g of sec.roots?.() || []) {
      for (const it of g.items()) { track(it); for (const d of it.descendants()) track(d); }
    }
  }
  seedUidCounter(maxN);
}

export function wipe() {
  try { localStorage.removeItem(SAVE_KEY); } catch { /* ignore */ }
}

let saveTimer = 0;
export function saveSoon() {
  if (!game.settings.autoSave) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 400);
}
