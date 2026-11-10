// =========================================================
// the game outside a raid, as data: traders and what they sell, tasks and
// what they ask for, the level table, the kit a new character starts with.
//
// All of it is built by tools/build_meta.py out of tarkov.dev's live dataset
// and the SPT dump; nothing here is typed in. Everything refers to items by
// their 24-hex template id, which the item registry resolves to whatever key
// the template is filed under.
// =========================================================

import { TPL, BY_ID, artUrl } from '../data/items.js';
import { localizeStations } from './localize.js';

export const ROUBLES = '5449016a4bdc2d6f028b456f';
export const DOLLARS = '5696686a4bdc2da3298b456a';
export const EUROS = '569668774bdc2da2298b4568';
export const GP_COIN = '5d235b4d86f7742e017bc88a';
export const CUR_OF_ITEM = { [ROUBLES]: 'RUB', [DOLLARS]: 'USD', [EUROS]: 'EUR' };
export const ITEM_OF_CUR = { RUB: ROUBLES, USD: DOLLARS, EUR: EUROS };
export const CUR_SYM = { RUB: '₽', USD: '$', EUR: '€' };

export const DB = {
  ready: false,
  /** @type {any[]} */ traders: [],
  traderById: {},
  traderByKey: {},
  /** @type {any[]} */ offers: [],
  /** traderId -> offers */
  offersByTrader: {},
  offerById: {},
  /** build id -> { name, base, tree | parts }: every assembled weapon a trader sells or a task hands out */
  presets: {},
  /** @type {any[]} */ tasks: [],
  taskById: {},
  /** traderId -> tasks, in the order the data lists them */
  tasksByTrader: {},
  /** the wave counters: variable id -> { t: trader, ll, sources, twins } */
  gvars: {},
  questItems: {},
  /** `${zoneId}@${locationId}` -> { map, pos:[x,y,z], outline:[[x,z]..], top, bottom } in world metres */
  zones: {},
  achievements: [],
  progress: null,
  profiles: null,
  hideout: null,
  /** location id -> { id, key, name, duration, players, ... } */
  locationById: {},
};

async function getJSON(name) {
  const res = await fetch(new URL(`../data/${name}`, import.meta.url));
  if (!res.ok) throw new Error(`${name}: ${res.status}`);
  return res.json();
}

/**
 * Load everything. Needs the item templates first: task items are filed into
 * the same registry as every other item so the inventory treats them alike.
 */
export async function loadMeta() {
  const [tr, qs, pg, pf] = await Promise.all([
    getJSON('traders-db.json'), getJSON('quests-db.json'),
    getJSON('progress-db.json'), getJSON('profiles-db.json'),
  ]);

  DB.traders = tr.traders;
  for (const t of DB.traders) {
    DB.traderById[t.id] = t;
    DB.traderByKey[t.key] = t;
    DB.offersByTrader[t.id] = [];
    DB.tasksByTrader[t.id] = [];
    t.img = `assets/traders/${t.key}.webp`;
  }
  DB.presets = tr.presets || {};
  DB.offers = tr.offers;
  for (const o of DB.offers) {
    o.trader = DB.traders[o.t];
    DB.offersByTrader[o.trader.id].push(o);
    DB.offerById[o.id] = o;
  }

  // templates the game has stopped handing out are still in the dataset;
  // they are left out here so nothing lists, counts or unlocks on them
  DB.tasks = qs.tasks.filter((t) => !t.retired);
  DB.gvars = qs.gvars || {};
  for (const t of DB.tasks) {
    DB.taskById[t.id] = t;
    (DB.tasksByTrader[t.trader] || (DB.tasksByTrader[t.trader] = [])).push(t);
    t.objById = {};
    for (const o of t.obj) { o.task = t.id; t.objById[o.id] = o; }
    for (const o of t.fail || []) { o.task = t.id; o.isFail = true; }
  }
  // who is waiting on whom: taskId -> tasks that list it as a requirement
  for (const t of DB.tasks) {
    for (const [req] of t.req?.tasks || []) {
      const r = DB.taskById[req];
      if (r) (r.unlocks || (r.unlocks = [])).push(t.id);
    }
  }
  DB.zones = qs.zones || {};
  DB.achievements = qs.achievements || [];
  DB.questItems = qs.questItems || {};
  registerQuestItems();

  DB.progress = pg;
  DB.profiles = pf;
  DB.locationById = {};
  for (const l of pg.locations || []) DB.locationById[l.id] = l;
  DB.ready = true;
  return DB;
}

/**
 * The piece of ground a location id stands on. Several ids share one - the
 * night and event versions of Factory, Ground Zero under and over level 21 -
 * and a task zone drawn for one of them is in the same place on the others.
 */
export function locationKey(id) {
  return DB.locationById?.[id]?.key || null;
}

export function locationName(id) {
  return DB.locationById?.[id]?.name || 'Unknown';
}

/** every location id that shares the ground of this map key */
export function locationsOf(key) {
  return (DB.progress?.locations || []).filter((l) => l.key === key);
}

/** hideout data is only wanted on the hideout screen */
export async function loadHideout() {
  if (!DB.hideout) {
    DB.hideout = await getJSON('hideout-db.json');
    localizeStations(DB.hideout.stations);
  }
  return DB.hideout;
}

/**
 * Task items exist only for a task: the folder from the director's office,
 * the hard drive, the watch. They are items like any other once picked up -
 * they take cells, they can be dragged - but they belong to no category a
 * trader buys and they never leave the task-items stash.
 */
function registerQuestItems() {
  for (const q of Object.values(DB.questItems)) {
    if (TPL[q.id]) continue;
    const tpl = {
      key: q.id, id: q.id, name: q.name, short: q.short || q.name, desc: q.desc || '',
      w: q.w || 1, h: q.h || 1, weight: 0, stack: 1, price: 0,
      cat: 'quest', quest: true, known: true, tier: 0, bg: 'yellow',
      img: `${q.id}.webp`, imgUrl: artUrl(`${q.id}.webp`),
    };
    TPL[q.id] = tpl;
    BY_ID[q.id] = tpl;
  }
}

// ---------------------------------------------------------
// ids and keys
// ---------------------------------------------------------
/** the registry key of a template given its tarkov id (or a key), or null */
export function keyOf(id) {
  if (!id) return null;
  const t = BY_ID[id] || TPL[id];
  return t ? t.key : null;
}

export function tplOf(id) {
  return BY_ID[id] || TPL[id] || null;
}

/** display name of an item id, falling back to something readable */
export function itemName(id, short = false) {
  if (id === 'dogtag') return 'Dogtag';
  const t = tplOf(id);
  if (!t) return 'Unknown item';
  return short ? (t.short || t.name) : t.name;
}

export function traderName(id) {
  return DB.traderById[id]?.name || 'Unknown';
}

// ---------------------------------------------------------
// levels
// ---------------------------------------------------------
/** the character level a running total of experience comes to */
export function levelForExp(exp) {
  const table = DB.progress?.levels;
  if (!table) return 1;
  let lvl = 1;
  for (let i = 0; i < table.length; i++) {
    if (exp >= table[i]) lvl = i + 1; else break;
  }
  return lvl;
}

/** [experience into the current level, experience the level takes] */
export function levelProgress(exp) {
  const table = DB.progress?.levels || [0];
  const lvl = levelForExp(exp);
  const lo = table[lvl - 1] ?? 0;
  const hi = table[lvl];
  if (hi == null) return [exp - lo, 0];
  return [exp - lo, hi - lo];
}

export const MAX_LEVEL = () => (DB.progress?.levels?.length || 79);

/** the badge group a level wears (the game changes the emblem every 5 levels) */
export function levelGroup(level) {
  return Math.min(16, Math.floor(level / 5) + 1);
}
