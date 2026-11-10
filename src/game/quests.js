// =========================================================
// tasks
//
// A task is the game's own record of it (tarkov.dev's current list, with the
// grouping and timings the SPT dump adds): who gives it, what has to be true
// before he will, a list of objectives and what comes back for doing them.
// This module holds no task content at all - it is the machine that reads
// those records: which tasks a profile can see, what state each is in, what
// counts towards an objective, and what happens when one is handed in.
//
// States, as the game names them:
//   locked     - a requirement is not met (level, an earlier task, loyalty)
//   available  - the trader will hand it out
//   active     - accepted, objectives still open
//   ready      - every required objective done, waiting to be handed in
//   done / failed
//
// How progress is earned follows the game:
//   - a kill counts the moment it happens, if every condition on it holds:
//     who died, where, with what, from how far, hit where, wearing what
//   - "in a single raid" counters start over when the raid ends short
//   - a place is visited by walking into it; planting an item or setting a
//     marker takes the seconds the task says and uses the item up
//   - "find in raid" is sticky: once the items have been in your hands it
//     stays ticked, but handing them over still needs the items themselves
//   - a task item is yours only if you carry it out; dying loses it
//   - rewards do not land in the stash: the trader sends them
// =========================================================

import { game, saveSoon, addExp } from '../core/state.js';
import { emit, on, EV } from '../core/events.js';
import { Item, detach } from '../inventory/model.js';
import { DB, keyOf, tplOf, CUR_OF_ITEM, locationKey } from './db.js';
import {
  loyaltyLevel, traderRecord, addStanding, unlockTrader, isUnlocked, setTaskDoneLookup, buildPreset,
} from './traders.js';
import { sendMail } from './mail.js';
import { skillLevel, addSkillLevels } from './skills.js';
import { t } from '../core/i18n.js';

export const QS = {
  LOCKED: 'locked', AVAILABLE: 'available', ACTIVE: 'active',
  READY: 'ready', DONE: 'done', FAILED: 'failed',
};

/** the game's own words for each state (QuestStatus* in its locale) */
export const QS_LABEL = {
  locked: 'Locked', available: 'ready', active: 'active!',
  ready: 'finished!', done: 'completed', failed: 'failed',
};

const COUNTED = new Set(['shoot', 'visit', 'extract', 'mark', 'plantItem', 'plantQuestItem',
  'useItem', 'findQuestItem', 'sellItem', 'experience', 'giveItem', 'giveQuestItem', 'buildWeapon', 'dialogue']);

// ---------------------------------------------------------
// profile record
// ---------------------------------------------------------
function book() {
  const p = game.profile;
  if (!p.quests || typeof p.quests !== 'object') p.quests = {};
  return p.quests;
}

function rec(task) { return book()[task.id] || null; }

/** task items the profile holds: id -> 'raid' (on the body, not yet out) | 'stash' */
function taskItems() {
  const p = game.profile;
  if (!p.qitems || typeof p.qitems !== 'object') p.qitems = {};
  return p.qitems;
}

export function hasTaskItem(qid, where = null) {
  const w = taskItems()[qid];
  return where ? w === where : !!w;
}

export function taskItemList(where = null) {
  return Object.entries(taskItems())
    .filter(([, w]) => !where || w === where)
    .map(([id, w]) => ({ id, where: w, tpl: tplOf(id) }))
    .filter((r) => r.tpl);
}

// ---------------------------------------------------------
// state
// ---------------------------------------------------------
export function statusOf(task) {
  const r = rec(task);
  if (r) {
    if (r.s === 'd') return QS.DONE;
    if (r.s === 'f') return task.restartable && requirementsMet(task) ? QS.AVAILABLE : QS.FAILED;
    if (r.s === 'a') return requiredDone(task) ? QS.READY : QS.ACTIVE;
  }
  return requirementsMet(task) ? QS.AVAILABLE : QS.LOCKED;
}

const isDone = (taskId) => book()[taskId]?.s === 'd';
setTaskDoneLookup(isDone);

function statusWord(taskId) {
  const t = DB.taskById[taskId];
  if (!t) return 'missing';
  const s = statusOf(t);
  if (s === QS.DONE) return 'complete';
  if (s === QS.ACTIVE || s === QS.READY) return 'active';
  if (s === QS.FAILED) return 'failed';
  return 'none';
}

const CMP = {
  '>=': (a, b) => a >= b, '>': (a, b) => a > b, '<=': (a, b) => a <= b,
  '<': (a, b) => a < b, '==': (a, b) => a === b, '=': (a, b) => a === b, '!=': (a, b) => a !== b,
};
const cmp = (op, a, b) => (CMP[op] || CMP['>='])(a, b);

/**
 * Every requirement a trader puts on handing a task out, with whether it is
 * met. `text` is the line the game prints for it under TASK UNLOCK
 * REQUIREMENTS and `icon` the glyph beside it; a requirement the game keeps
 * to itself (the wave counters have no line in the client at all) comes back
 * with `hidden` set, so it gates the task without being listed.
 */
export function requirementList(task) {
  const out = [];
  const p = game.profile;
  const trader = DB.traderById[task.trader];
  if (trader && !isUnlocked(trader)) {
    out.push({ kind: 'trader', ok: false, icon: 'icon_lock_small', text: t('traders/trader_is_locked') });
  }
  if (task.lvl > 1) {
    out.push({ kind: 'level', ok: p.level >= task.lvl, need: task.lvl, icon: 'lvl',
      text: t('UI/Quests/Conditions/ProfileLevel{0}', task.lvl) });
  }
  if (task.faction) {
    out.push({ kind: 'faction', ok: (p.faction || 'USEC').toUpperCase() === task.faction.toUpperCase(),
      icon: 'tab_icon_overall', text: task.faction.toUpperCase() });
  }
  if (task.prestige) {
    out.push({ kind: 'prestige', ok: (p.prestige || 0) >= task.prestige, icon: 'lvl',
      text: t('UI/Quests/Conditions/PrestigeLevel{0}', task.prestige) });
  }
  for (const [tid, statuses, wait] of task.req?.tasks || []) {
    const other = DB.taskById[tid];
    if (!other) continue;                 // a task the current game no longer has
    const word = statusWord(tid);
    let ok = statuses.includes(word);
    // "active" also accepts a task that has since been completed
    if (!ok && statuses.includes('active') && word === 'complete') ok = true;
    let text = other.name;
    if (ok && wait) {
      const since = book()[tid]?.fin || book()[tid]?.t || 0;
      const left = since + wait * 1000 - Date.now();
      if (left > 0) { ok = false; text += ` (${fmtWait(left)})`; }
    }
    out.push({ kind: 'task', ok, text, task: tid, icon: 'tab_icon_tasks', want: statuses });
  }
  if (task.req?.anyTask) {
    const names = task.req.anyTask.map((id) => DB.taskById[id]?.name).filter(Boolean);
    out.push({ kind: 'task', ok: task.req.anyTask.some((id) => isDone(id)), icon: 'tab_icon_tasks', text: names.join(' / ') });
  }
  for (const r of task.req?.traders || []) {
    const who = DB.traderById[r.t];
    if (!who) continue;
    if (r.kind === 'level') {
      out.push({ kind: 'loyalty', ok: cmp(r.cmp, loyaltyLevel(who), r.v), icon: 'll',
        text: t('UI/Quests/Conditions/TraderLoyalty{0}{1}', who.name, r.v) });
    } else {
      out.push({ kind: 'standing', ok: cmp(r.cmp, traderRecord(who).rep, r.v), icon: 'standing_icon',
        text: t('UI/Quests/Conditions/TraderStanding{0}{1}', who.name, r.v) });
    }
  }
  for (const r of task.req?.other || []) {
    if (r.type === 'globalVariable') {
      const have = variableValue(r.variableId);
      out.push({ kind: 'progress', ok: cmp(r.compareMethod, have, r.value), have, need: r.value, hidden: true, text: '' });
    } else if (r.type === 'dialogue') {
      const who = (r.traders || []).map((id) => DB.traderById[id]).filter(Boolean);
      out.push({ kind: 'dialogue', ok: who.every((x) => hasTalkedTo(x)), hidden: true, text: '' });
    }
  }
  return out;
}

// ---------------------------------------------------------
// trader progress variables and conversations
// ---------------------------------------------------------
/**
 * The current game gates batches of a trader's tasks behind a counter that
 * rises as his other tasks are finished. `VAR_RULES` (set by db loading, see
 * setVariableRules) says which finished tasks feed which counter.
 */
let VAR_RULES = {};
export function setVariableRules(rules) { VAR_RULES = rules || {}; }

export function variableValue(id) {
  const rule = VAR_RULES[id];
  const manual = game.profile.gvars?.[id] || 0;
  if (!rule) return manual;
  // one flag a completed task; the two faction twins of a task share theirs
  const flags = new Set();
  for (const tid of rule.sources || []) {
    if (!isDone(tid)) continue;
    const pair = (rule.twins || []).find((tw) => tw.includes(tid));
    flags.add(pair ? pair[0] : tid);
  }
  return flags.size + manual;
}

/** the player has opened a conversation with this trader at least once */
export function hasTalkedTo(trader) {
  return !!traderRecord(trader).talked;
}

export function talkTo(trader) {
  const st = traderRecord(trader);
  if (st.talked) return false;
  st.talked = Date.now();
  syncPassive();
  announceNewlyAvailable();
  saveSoon();
  return true;
}

function fmtWait(ms) {
  const m = Math.ceil(ms / 60000);
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`;
}

export function requirementsMet(task) {
  return requirementList(task).every((r) => r.ok);
}

// ---------------------------------------------------------
// objectives
// ---------------------------------------------------------
/** how far along one objective is: { cur, need, done } */
export function progressOf(task, obj) {
  const r = rec(task);
  const c = r?.c?.[obj.id] || 0;
  const need = obj.count != null ? obj.count : 1;
  switch (obj.type) {
    case 'findItem': {
      // sticky: the most that has ever been in hand, never less than what is in hand now
      const held = r ? countHeld(obj) : 0;
      const cur = Math.min(need, Math.max(c, held, handedFor(task, obj)));
      return { cur, need, done: cur >= need };
    }
    case 'traderLevel': {
      const t = DB.traderById[obj.trader];
      const cur = t ? loyaltyLevel(t) : 0;
      return { cur, need: obj.level, done: cur >= obj.level, plain: true };
    }
    case 'traderStanding': {
      const t = DB.traderById[obj.trader];
      const cur = t ? traderRecord(t).rep : 0;
      const [op, v] = obj.value || ['>=', 0];
      return { cur, need: v, done: cmp(op, cur, v), plain: true };
    }
    case 'skill': {
      const cur = skillLevel(obj.skill);
      return { cur, need: obj.level, done: cur >= obj.level, plain: true };
    }
    case 'taskStatus': {
      const word = statusWord(obj.task);
      return { cur: 0, need: 1, done: (obj.status || []).includes(word), plain: true };
    }
    case 'globalVariable':
      // a server-side switch this game has no equivalent of: it never blocks
      return { cur: 1, need: 1, done: !obj.optional, plain: true };
    default: {
      const cur = Math.min(need, c);
      return { cur, need, done: cur >= need };
    }
  }
}

/** a hand-over of the same items satisfies the matching "find" beside it */
function handedFor(task, findObj) {
  const r = rec(task);
  if (!r) return 0;
  let n = 0;
  for (const o of task.obj) {
    if (o.type !== 'giveItem' || !sameItems(o.items, findObj.items)) continue;
    n = Math.max(n, r.c?.[o.id] || 0);
  }
  return n;
}

function sameItems(a = [], b = []) {
  if (a.length !== b.length) return false;
  const s = new Set(a);
  return b.every((x) => s.has(x));
}

export function requiredDone(task) {
  for (const o of task.obj) {
    if (o.optional) continue;
    if (!progressOf(task, o).done) return false;
  }
  return true;
}

// ---------------------------------------------------------
// items in hand
// ---------------------------------------------------------
/** every item the profile owns outside a trader's table: stash and everything worn */
function* ownedItems() {
  const seen = new Set();
  const walk = function* (it) {
    if (seen.has(it)) return;
    seen.add(it);
    yield it;
    if (it.grids) for (const g of it.grids) for (const x of g.items()) yield* walk(x);
  };
  if (game.stash) for (const it of game.stash.items()) yield* walk(it);
  if (game.equipment) for (const it of game.equipment.everything()) yield* walk(it);
}

/** does this item satisfy an item objective (template, found-in-raid, condition) */
export function itemFits(obj, item) {
  const tpl = item.tpl;
  if (!(obj.items || []).includes(tpl.id)) return false;
  // loot picked up this raid carries the mark it will get on the way out
  if (obj.fir && !(item.fir || item.raidLoot)) return false;
  if (obj.dur) {
    const max = tpl.wpn?.maxDura ?? tpl.dura ?? null;
    if (max && item.dura != null) {
      const pct = (item.dura / max) * 100;
      if (pct < obj.dur[0] - 1e-6 || pct > obj.dur[1] + 1e-6) return false;
    }
  }
  if (obj.dogtag && (item.dogtag?.level || 0) < obj.dogtag) return false;
  return true;
}

function countHeld(obj) {
  let n = 0;
  for (const it of ownedItems()) if (itemFits(obj, it)) n += it.stack || 1;
  return n;
}

/** the items that could be handed over for an objective, best to lose first */
export function handoverCandidates(task, obj) {
  const out = [];
  if (obj.type === 'buildWeapon') {
    for (const it of ownedItems()) if (it.isWeapon && it.holder?.kind === 'grid' && weaponFits(obj, it).ok) out.push(it);
    return out;
  }
  for (const it of ownedItems()) {
    if (!itemFits(obj, it)) continue;
    // a magazine with rounds in it or a bag with things in it is not handed over as is
    if (it.grids && !it.isEmptyContainer) continue;
    out.push(it);
  }
  out.sort((a, b) => (a.stack || 1) - (b.stack || 1));
  return out;
}

/**
 * Hand items over for a giveItem objective. `items` are Items the player
 * picked (or the candidates, for "hand over all"). Returns how many counted.
 */
export function handOver(task, obj, items) {
  const r = rec(task);
  if (!r || r.s !== 'a') return 0;
  const p = progressOf(task, obj);
  let left = p.need - p.cur;
  let given = 0;
  for (const it of items) {
    if (left <= 0) break;
    if (!itemFits(obj, it)) continue;
    const n = Math.min(it.stack || 1, left);
    it.stack = (it.stack || 1) - n;
    if (it.stack <= 0) detach(it);
    left -= n;
    given += n;
  }
  if (given) {
    bump(task, obj, given);
    emit(EV.INVENTORY_CHANGED);
  }
  return given;
}

/** hand a task item over */
export function handOverTaskItem(task, obj) {
  const r = rec(task);
  if (!r || r.s !== 'a' || obj.type !== 'giveQuestItem') return false;
  if (taskItems()[obj.qitem] !== 'stash') return false;
  delete taskItems()[obj.qitem];
  bump(task, obj, 1);
  return true;
}

// ---------------------------------------------------------
// weapon assembly
// ---------------------------------------------------------
let weaponStatsFn = null;
/** weapon.js owns the numbers; it is wired in at boot to keep this module light */
export function setWeaponStats(fn) { weaponStatsFn = fn; }

/** does a built gun meet a Gunsmith specification: { ok, rows:[{label, ok, have, need}] } */
export function weaponFits(obj, weapon) {
  const rows = [];
  if (weapon.tpl.id !== obj.weapon) return { ok: false, rows: [{ label: 'Weapon', ok: false }] };
  const st = weaponStatsFn ? weaponStatsFn(weapon) : {};
  const a = obj.attrs || {};
  const maxDura = weapon.tpl.wpn?.maxDura || 100;
  const have = {
    durability: weapon.dura != null ? (weapon.dura / maxDura) * 100 : 100,
    ergonomics: st.ergo,
    recoil: st.recoilSum ?? ((st.recoilV || 0) + (st.recoilH || 0)),
    accuracy: st.moa,
    effectiveDistance: st.effDist ?? st.range,
    magazineCapacity: weapon.magazine ? weapon.magazine.tpl.magSize : 0,
    muzzleVelocity: st.velocity,
    weight: weapon.weight,
    width: weapon.fw,
    height: weapon.fh,
  };
  const LABEL = {
    durability: 'Durability', ergonomics: 'Ergonomics', recoil: 'Recoil sum', accuracy: 'Accuracy (MOA)',
    effectiveDistance: 'Effective distance', magazineCapacity: 'Magazine capacity',
    muzzleVelocity: 'Muzzle velocity', weight: 'Weight', width: 'Cells wide', height: 'Cells high',
  };
  for (const [k, [op, v]] of Object.entries(a)) {
    const h = have[k];
    rows.push({ label: LABEL[k] || k, op, need: v, have: h, ok: h != null && cmp(op, Math.round(h * 100) / 100, v) });
  }
  const parts = new Set([...weapon.allMods()].map((m) => m.tpl.id));
  for (const id of obj.all || []) {
    rows.push({ label: tplOf(id)?.short || tplOf(id)?.name || 'Part', part: id, ok: parts.has(id) });
  }
  for (const cat of obj.cats || []) {
    const ok = [...weapon.allMods()].some((m) => (m.tpl.cats || []).includes(cat));
    rows.push({ label: 'A part of the required kind', cat, ok });
  }
  return { ok: rows.every((r) => r.ok), rows };
}

export function handOverWeapon(task, obj, weapon) {
  const r = rec(task);
  if (!r || r.s !== 'a' || obj.type !== 'buildWeapon') return false;
  if (!weaponFits(obj, weapon).ok) return false;
  detach(weapon);
  bump(task, obj, 1);
  emit(EV.INVENTORY_CHANGED);
  return true;
}

// ---------------------------------------------------------
// accepting, finishing, failing
// ---------------------------------------------------------
export function acceptTask(task) {
  if (statusOf(task) !== QS.AVAILABLE) return false;
  book()[task.id] = { s: 'a', t: Date.now(), c: {} };
  const items = rewardItems(task.start);
  const trader = DB.traderById[task.trader];
  // what the trader says when he hands it out arrives as his message, with
  // whatever he gives you to do the job
  sendMail({ from: task.trader, kind: 'quest', task: task.id, text: task.desc || task.name, items });
  applyRewards(task.start, trader, { items: false });
  emit(EV.QUEST, { kind: 'started', task });
  syncPassive();
  saveSoon();
  return true;
}

export function completeTask(task) {
  if (statusOf(task) !== QS.READY) return false;
  const r = rec(task);
  r.s = 'd';
  r.fin = Date.now();
  const trader = DB.traderById[task.trader];
  const items = rewardItems(task.finish);
  sendMail({ from: task.trader, kind: 'quest', task: task.id, text: task.okMsg || `${task.name}: completed`, items });
  if (task.xp) addExp(task.xp);
  applyRewards(task.finish, trader, { items: false });
  emit(EV.QUEST, { kind: 'done', task });
  // finishing one task can be what fails another (a choice between two)
  checkFails();
  announceNewlyAvailable();
  saveSoon();
  return true;
}

export function failTask(task, why = '') {
  const r = rec(task);
  if (!r || r.s !== 'a') return false;
  r.s = 'f';
  r.fin = Date.now();
  const trader = DB.traderById[task.trader];
  applyRewards(task.failure, trader, { items: false });
  if (task.failMsg) sendMail({ from: task.trader, kind: 'quest', task: task.id, text: task.failMsg });
  emit(EV.QUEST, { kind: 'failed', task, why });
  saveSoon();
  return true;
}

/** a failed task that can be taken again starts from nothing */
export function restartTask(task) {
  const r = rec(task);
  if (!r || r.s !== 'f' || !task.restartable) return false;
  delete book()[task.id];
  return acceptTask(task);
}

/** the Items a reward list hands over, unplaced; everything a task gives is found-in-raid */
export function rewardItems(rw) {
  const out = [];
  for (const [id, count] of rw?.items || []) {
    if (DB.presets[id]) {
      for (let i = 0; i < count; i++) {
        const gun = buildPreset(id);
        if (gun) { gun.fir = true; for (const m of gun.allMods()) m.fir = true; out.push(gun); }
      }
      continue;
    }
    const key = keyOf(id);
    const tpl = tplOf(id);
    if (!key || !tpl) continue;
    const max = tpl.stack || 1;
    for (let left = count; left > 0;) {
      const n = Math.min(max, left);
      // money is money; it has no found-in-raid mark to carry
      out.push(new Item(key, { stack: n, examined: true, fir: !CUR_OF_ITEM[id] }));
      left -= n;
    }
  }
  return out;
}

function applyRewards(rw, trader, opts = {}) {
  if (!rw) return;
  for (const [tid, v] of rw.rep || []) {
    const t = DB.traderById[tid];
    if (t) addStanding(t, v);
  }
  for (const [skill, levels] of rw.skills || []) addSkillLevels(skill, levels);
  for (const tid of rw.traders || []) {
    const t = DB.traderById[tid];
    if (t && unlockTrader(t)) emit(EV.QUEST, { kind: 'trader', trader: t });
  }
  void opts; void trader;
}

function checkFails() {
  for (const task of DB.tasks) {
    const r = rec(task);
    if (!r || r.s !== 'a') continue;
    for (const f of task.fail || []) {
      if (f.type === 'taskStatus' && (f.status || []).includes(statusWord(f.task))) {
        failTask(task, 'another task was completed');
        break;
      }
      if (f.type === 'traderStanding') {
        const t = DB.traderById[f.trader];
        const [op, v] = f.value || ['<', 0];
        if (t && cmp(op, traderRecord(t).rep, v)) { failTask(task, 'standing'); break; }
      }
    }
  }
}

// ---------------------------------------------------------
// lists for the screens
// ---------------------------------------------------------
/**
 * A trader's tasks as his list shows them: what is on, what can be taken,
 * and - only when asked for, as the list's two tick boxes ask - what is
 * finished and what is still locked.
 */
export function tasksOf(trader, { completed = false, locked = false } = {}) {
  const order = { ready: 0, active: 1, available: 2, failed: 3, locked: 4, done: 5 };
  const out = [];
  for (const task of DB.tasksByTrader[trader.id] || []) {
    const s = statusOf(task);
    if (s === QS.LOCKED && !locked) continue;
    if (s === QS.DONE && !completed) continue;
    out.push({ task, status: s });
  }
  out.sort((a, b) => order[a.status] - order[b.status] || a.task.name.localeCompare(b.task.name));
  return out;
}

/** how many tasks at a trader want attention: something to hand in or to accept */
export function attentionCount(trader) {
  let n = 0;
  for (const t of DB.tasksByTrader[trader.id] || []) {
    const s = statusOf(t);
    if (s === QS.READY || s === QS.AVAILABLE) n++;
  }
  return n;
}

export function activeTasks() {
  const out = [];
  for (const [id, r] of Object.entries(book())) {
    if (r.s !== 'a') continue;
    const t = DB.taskById[id];
    if (t) out.push({ task: t, status: statusOf(t) });
  }
  out.sort((a, b) => (book()[b.task.id].t || 0) - (book()[a.task.id].t || 0));
  return out;
}

export function completedTasks() {
  return Object.entries(book()).filter(([, r]) => r.s === 'd')
    .map(([id]) => DB.taskById[id]).filter(Boolean);
}

export function taskCounts() {
  let done = 0, active = 0;
  for (const r of Object.values(book())) { if (r.s === 'd') done++; else if (r.s === 'a') active++; }
  return { done, active, total: DB.tasks.length };
}

// ---------------------------------------------------------
// progress
// ---------------------------------------------------------
function bump(task, obj, n = 1) {
  const r = rec(task);
  if (!r || r.s !== 'a') return;
  const before = progressOf(task, obj);
  if (before.done && obj.type !== 'findItem') return;
  r.c[obj.id] = (r.c[obj.id] || 0) + n;
  const after = progressOf(task, obj);
  const wasReady = false;
  void wasReady;
  emit(EV.QUEST, { kind: after.done ? 'objective' : 'progress', task, obj, cur: after.cur, need: after.need });
  if (after.done && requiredDone(task)) emit(EV.QUEST, { kind: 'ready', task });
  saveSoon();
}

/**
 * Objectives that are read off the profile rather than counted: found items,
 * loyalty, skills, other tasks. Called whenever any of those may have moved;
 * announces what newly ticked over.
 */
let lastSeen = new Map();
export function syncPassive(announce = true) {
  const now = new Map();
  for (const [id, r] of Object.entries(book())) {
    if (r.s !== 'a') continue;
    const task = DB.taskById[id];
    if (!task) continue;
    let all = true;
    for (const o of task.obj) {
      const p = progressOf(task, o);
      if (o.type === 'findItem' && p.cur > (r.c[o.id] || 0)) r.c[o.id] = p.cur;   // make it stick
      const key = `${id}:${o.id}`;
      now.set(key, p.done);
      if (announce && p.done && lastSeen.has(key) && !lastSeen.get(key) && !COUNTED.has(o.type)) {
        emit(EV.QUEST, { kind: 'objective', task, obj: o, cur: p.cur, need: p.need });
      }
      if (!o.optional && !p.done) all = false;
    }
    const tkey = `${id}:*`;
    now.set(tkey, all);
    if (announce && all && lastSeen.has(tkey) && !lastSeen.get(tkey)) emit(EV.QUEST, { kind: 'ready', task });
  }
  lastSeen = now;
  checkFails();
}

let knownAvailable = null;
/** tell the player when a trader has something new for him */
function announceNewlyAvailable() {
  const now = new Set();
  for (const t of DB.tasks) if (statusOf(t) === QS.AVAILABLE) now.add(t.id);
  if (knownAvailable) {
    for (const id of now) if (!knownAvailable.has(id)) emit(EV.QUEST, { kind: 'available', task: DB.taskById[id] });
  }
  knownAvailable = now;
}

// ---------------------------------------------------------
// the raid's side of it
// ---------------------------------------------------------
const PART_NAME = {
  head: 'Head', thorax: 'Chest', stomach: 'Stomach', larm: 'LeftArm',
  rarm: 'RightArm', lleg: 'LeftLeg', rleg: 'RightLeg',
};

/** does a kill's victim answer to one of the task's target names */
function targetFits(names, v) {
  if (!names || !names.length) return true;
  const role = String(v.role || '').toLowerCase();
  for (const n of names) {
    const k = String(n).toLowerCase();
    if (k === 'any') return true;
    if (k === 'anypmc') { if (v.side === 'pmc') return true; continue; }
    if (k === 'bear' || k === 'usec') { if (v.side === 'pmc' && String(v.faction || '').toLowerCase() === k) return true; continue; }
    // "Savage" is the plain scav; the dataset lists his kin beside him
    if (k === 'savage') { if (role === 'assault' || role === 'savage' || role === 'cursedassault') return true; continue; }
    if (role === k) return true;
  }
  return false;
}

/** point (world x, z) inside a zone's outline, at a height the zone spans */
export function inZone(zoneKey, world) {
  const z = DB.zones[zoneKey];
  if (!z || !world) return false;
  const [x, y, zz] = world;
  if (z.top != null && z.bottom != null && y != null) {
    // a little slack: the player's reference point is at his feet
    if (y > z.top + 1.5 || y < z.bottom - 1.5) return false;
  }
  const poly = z.outline;
  if (!poly || poly.length < 3) {
    return Math.hypot(x - z.pos[0], zz - z.pos[2]) < 6;
  }
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > zz) !== (zj > zz) && x < ((xj - xi) * (zz - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** a zone is drawn for one location id; it also holds on the ids that share its ground */
function sameGround(zoneKey, location) {
  const z = DB.zones[zoneKey];
  if (!z) return false;
  if (z.map === location) return true;
  // prefer the zone drawn for exactly this id when the task lists one
  const key = locationKey(z.map);
  return !!key && key === locationKey(location);
}

/** any-of groups, each worn or fitted in full */
function groupsHold(groups, have) {
  if (!groups || !groups.length) return true;
  return groups.some((g) => g.every((id) => have.has(id)));
}

function hourInWindow(hour, [from, to]) {
  if (from === to) return true;
  return from < to ? (hour >= from && hour < to) : (hour >= from || hour < to);
}

/**
 * A kill happened.
 * @param {{
 *   location:string, role:string, side?:string, faction?:string, part?:string, dist?:number,
 *   weapon?:string, mods?:string[], caliber?:string, hour?:number, world?:number[],
 *   gear?:string[], playerFx?:string[], victimFx?:string[], hit?:boolean
 * }} k  ids are tarkov template ids; `world` is where the victim stood
 */
export function onKill(k) {
  const gear = new Set(k.gear || []);
  const mods = new Set(k.mods || []);
  for (const { task } of activeTasks()) {
    for (const o of task.obj) {
      if (o.type !== 'shoot') continue;
      if ((o.shot || 'kill') !== (k.hit ? 'hit' : 'kill')) continue;
      if (o.maps && !o.maps.includes(k.location)) continue;
      if (!targetFits(o.targets, k)) continue;
      if (o.parts && !(k.part && o.parts.includes(PART_NAME[k.part] || k.part))) continue;
      if (o.weapons && !(k.weapon && o.weapons.includes(k.weapon))) continue;
      if (o.calibers && !(k.caliber && o.calibers.includes(k.caliber))) continue;
      if (o.modsInc && !groupsHold(o.modsInc, mods)) continue;
      if (o.modsExc && o.modsExc.some((g) => g.every((id) => mods.has(id)))) continue;
      if (o.dist && !(k.dist != null && cmp(o.dist[0], k.dist, o.dist[1]))) continue;
      if (o.hours && !(k.hour != null && hourInWindow(k.hour, o.hours))) continue;
      if (o.equip && !o.equip.every((e) => groupsHold(e.inc, gear)
        && !(e.exc || []).some((g) => g.every((id) => gear.has(id))))) continue;
      if (o.zones && !o.zones.some((z) => sameGround(z, k.location) && inZone(z, k.world))) continue;
      if (o.playerFx?.fx && !o.playerFx.fx.some((f) => (k.playerFx || []).includes(f))) continue;
      if (o.enemyFx?.fx && !o.enemyFx.fx.some((f) => (k.victimFx || []).includes(f))) continue;
      bump(task, o, 1);
    }
    // a task can also be lost by a kill (shooting the wrong people)
    for (const f of task.fail || []) {
      if (f.type !== 'shoot') continue;
      if (f.maps && !f.maps.includes(k.location)) continue;
      if (!targetFits(f.targets, k)) continue;
      const r = rec(task);
      r.c[`f:${f.id}`] = (r.c[`f:${f.id}`] || 0) + 1;
      if (r.c[`f:${f.id}`] >= (f.count || 1)) failTask(task, 'a forbidden target was killed');
    }
  }
}

/**
 * What the active tasks want done on this location, for the raid to watch:
 * places to walk into, places to plant or mark, task items to pick up.
 * Coordinates are world metres; the raid owns the transform onto its map.
 */
export function raidObjectives(location) {
  const out = [];
  for (const { task } of activeTasks()) {
    for (const o of task.obj) {
      if (progressOf(task, o).done) continue;
      if (o.maps && !o.maps.includes(location)) continue;
      const zones = (o.zones || []).filter((z) => DB.zones[z] && sameGround(z, location))
        .map((z) => ({ key: z, ...DB.zones[z] }));
      if (o.type === 'visit' && zones.length) {
        out.push({ kind: 'visit', task, obj: o, zones });
      } else if (o.type === 'plantItem' && zones.length) {
        out.push({ kind: 'plant', task, obj: o, zones, items: o.items, time: o.plant || 30 });
      } else if (o.type === 'plantQuestItem' && zones.length) {
        out.push({ kind: 'plantq', task, obj: o, zones, qitem: o.qitem, time: o.plant || 30 });
      } else if (o.type === 'mark' && zones.length) {
        out.push({ kind: 'mark', task, obj: o, zones, marker: o.marker, time: o.plant || 30 });
      } else if (o.type === 'useItem' && zones.length) {
        out.push({ kind: 'use', task, obj: o, zones, items: o.use });
      } else if (o.type === 'findQuestItem' && !hasTaskItem(o.qitem)) {
        const spots = DB.questItems[o.qitem]?.spots?.[location];
        if (spots && spots.length) out.push({ kind: 'pickq', task, obj: o, qitem: o.qitem, spots });
      }
    }
  }
  return out;
}

/** the player walked into a place a task asked him to find */
export function onVisit(task, obj) {
  if (rec(task)?.s !== 'a') return;
  bump(task, obj, 1);
}

/** an item was planted, a marker set, a flare fired where the task wanted it */
export function onPlaced(task, obj) {
  if (rec(task)?.s !== 'a') return;
  bump(task, obj, 1);
}

/** a task item was picked up in the raid: it is on the body until the raid ends */
export function onTaskItemPicked(task, obj) {
  if (rec(task)?.s !== 'a') return;
  taskItems()[obj.qitem] = 'raid';
  bump(task, obj, 1);
}

/** something was sold to a trader (the Merchant tasks count these) */
function onDeal(d) {
  if (d.kind !== 'sell') return;
  for (const { task } of activeTasks()) {
    for (const o of task.obj) {
      if (o.type !== 'sellItem') continue;
      if ((o.sellTo || task.trader) !== d.trader.id) continue;
      let n = 0;
      for (const s of d.sold) if ((o.items || []).includes(s.tpl.id)) n += s.stack || 1;
      if (n) bump(task, o, n);
    }
  }
}

const EXIT_STATUS = {
  survived: 'ExpBonusSurvived', runner: 'ExpBonusRunner', killed: 'ExpBonusKilled',
  mia: 'ExpBonusMissingInAction', left: 'ExpBonusLeft', transit: 'marathon Name',
};

/**
 * The raid is over.
 * @param {{ location:string, status:'survived'|'runner'|'killed'|'mia'|'left'|'transit', exit?:string }} res
 *   `exit` is the extract's internal name
 */
export function onRaidEnd(res) {
  const word = EXIT_STATUS[res.status] || res.status;
  const out = res.status === 'survived' || res.status === 'runner' || res.status === 'transit';

  // task items: carried out, or lost with everything else
  for (const [qid, where] of Object.entries(taskItems())) {
    if (where !== 'raid') continue;
    if (out) taskItems()[qid] = 'stash';
    else {
      delete taskItems()[qid];
      for (const { task } of activeTasks()) {
        for (const o of task.obj) if (o.type === 'findQuestItem' && o.qitem === qid) rec(task).c[o.id] = 0;
      }
    }
  }

  for (const { task } of activeTasks()) {
    const r = rec(task);
    for (const o of task.obj) {
      if (o.type === 'extract') {
        if (o.maps && !o.maps.includes(res.location)) continue;
        if (o.status && !o.status.includes(word)) continue;
        if (o.exit && String(o.exit).trim() !== String(res.exit || '').trim()) continue;
        bump(task, o, 1);
      }
    }
    // "in a single raid": whatever was not finished starts over
    for (const o of task.obj) {
      if (!o.once) continue;
      const p = progressOf(task, o);
      if (!p.done && r.c[o.id]) r.c[o.id] = 0;
    }
    for (const f of task.fail || []) {
      if (f.type !== 'extract') continue;
      if (f.maps && !f.maps.includes(res.location)) continue;
      if (f.status && !f.status.includes(word)) continue;
      failTask(task, 'the raid ended badly');
      break;
    }
  }
  syncPassive();
  saveSoon();
}

// ---------------------------------------------------------
export function initQuests() {
  setVariableRules(DB.gvars);
  on(EV.TRADE_DEAL, onDeal);
  on(EV.TRADER_LEVEL, () => { syncPassive(); announceNewlyAvailable(); });
  on(EV.LEVEL_UP, () => { syncPassive(); announceNewlyAvailable(); });
  let timer = 0;
  on(EV.INVENTORY_CHANGED, () => { clearTimeout(timer); timer = setTimeout(() => syncPassive(), 250); });
  syncPassive(false);
  announceNewlyAvailable();
}
