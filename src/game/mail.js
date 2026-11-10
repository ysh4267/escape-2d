// =========================================================
// the messenger
//
// Traders do not put things in your stash. A task reward, the kit a task
// starts you off with, insured gear coming home - each arrives as a message
// from the trader with the items attached, and they stay attached until you
// take them (or the message runs out of time). That is what this is: a list
// of messages per sender, each with text and a small pile of items.
// =========================================================

import { game, saveSoon } from '../core/state.js';
import { Item, autoPlace } from '../inventory/model.js';
import { emit, EV } from '../core/events.js';
import { uid } from '../core/util.js';

/** how long attachments wait, by kind, in hours - the game's own storage times */
const STORE_HOURS = { quest: 72, insurance: 96, system: 168, purchase: 72 };

function box() {
  if (!Array.isArray(game.profile.mail)) game.profile.mail = [];
  return game.profile.mail;
}

/**
 * Deliver a message.
 * @param {{from:string, kind?:string, text?:string, title?:string, items?:Item[], hours?:number, task?:string}} m
 *   `from` is a trader id or 'system'
 */
export function sendMail(m) {
  const now = Date.now();
  const kind = m.kind || 'system';
  const items = (m.items || []).map((it) => it.toJSON());
  const msg = {
    id: uid('m'),
    from: m.from || 'system',
    kind,
    text: m.text || '',
    ts: now,
  };
  if (m.title) msg.title = m.title;
  if (m.task) msg.task = m.task;
  if (items.length) {
    msg.items = items;
    msg.exp = now + (m.hours ?? STORE_HOURS[kind] ?? 72) * 3600 * 1000;
  }
  box().push(msg);
  // a mailbox is not an archive: the oldest read, empty messages make room
  const all = box();
  if (all.length > 400) {
    const drop = all.findIndex((x) => x.read && !(x.items && x.items.length));
    all.splice(drop >= 0 ? drop : 0, 1);
  }
  emit(EV.MAIL, msg);
  saveSoon();
  return msg;
}

/** attachments that ran out of time are gone, the way the game deletes them */
export function expireMail(now = Date.now()) {
  let lost = 0;
  for (const m of box()) {
    if (m.items && m.items.length && m.exp && now > m.exp) {
      lost += m.items.length;
      m.items = [];
      m.expired = true;
    }
  }
  if (lost) saveSoon();
  return lost;
}

export function allMail() { return box(); }

/** messages grouped by sender, newest conversation first */
export function threads() {
  const by = new Map();
  for (const m of box()) {
    if (!by.has(m.from)) by.set(m.from, []);
    by.get(m.from).push(m);
  }
  const out = [];
  for (const [from, list] of by) {
    list.sort((a, b) => a.ts - b.ts);
    out.push({
      from, messages: list, last: list[list.length - 1],
      unread: list.filter((m) => !m.read).length,
      attachments: list.reduce((n, m) => n + (m.items ? m.items.length : 0), 0),
    });
  }
  out.sort((a, b) => b.last.ts - a.last.ts);
  return out;
}

/** messages not yet opened plus messages still holding something */
export function unreadCount() {
  let n = 0;
  for (const m of box()) if (!m.read || (m.items && m.items.length)) n++;
  return n;
}

export function attachmentCount() {
  let n = 0;
  for (const m of box()) n += m.items ? m.items.length : 0;
  return n;
}

export function markRead(from) {
  let changed = false;
  for (const m of box()) if (m.from === from && !m.read) { m.read = true; changed = true; }
  if (changed) { emit(EV.MAIL, null); saveSoon(); }
}

/** the live Item objects of a message's attachments, for drawing */
export function attachments(msg) {
  const out = [];
  for (const j of msg.items || []) {
    try { out.push(Item.fromJSON(j)); } catch { /* a template that no longer exists */ }
  }
  return out;
}

/**
 * Move attachments into the stash. `index` picks one; without it, all of
 * them. Whatever does not fit stays on the message.
 * @returns {{taken:number, left:number}}
 */
export function receive(msg, index = null) {
  if (!msg.items || !msg.items.length) return { taken: 0, left: 0 };
  const keep = [];
  let taken = 0;
  msg.items.forEach((j, i) => {
    if (index != null && i !== index) { keep.push(j); return; }
    let it;
    try { it = Item.fromJSON(j); } catch { return; }   // nothing to hand over
    if (autoPlace(it, [game.stash])) taken++;
    else keep.push(j);
  });
  msg.items = keep;
  msg.read = true;
  if (taken) {
    emit(EV.INVENTORY_CHANGED);
    emit(EV.MAIL, null);
    saveSoon();
  }
  return { taken, left: keep.length };
}

/** take everything from every message of one sender */
export function receiveAll(from) {
  let taken = 0, left = 0;
  for (const m of box()) {
    if (m.from !== from || !m.items || !m.items.length) continue;
    const r = receive(m);
    taken += r.taken; left += r.left;
  }
  return { taken, left };
}
