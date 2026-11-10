// =========================================================
// the wishlist
//
// A list of templates the player wants to keep an eye out for. An item goes
// on it under one of five headings - Tasks, Equipment, Hideout, Other, Barter,
// the order the client's ADD TO WISHLIST submenu lists them in - and from then
// on it wears a heart in the handbook and has a tab of its own on the flea
// market (W-LIST), which shows what is on offer of the things on the list.
//
// It is kept on the profile as { template id: heading }. Ids, not registry
// keys: a template this build does not have yet stays on the list and shows
// up when the item table catches up with it.
// =========================================================

import { game, saveSoon } from '../core/state.js';
import { emit, EV } from '../core/events.js';
import { tplOf } from './db.js';

/** the headings, in the client's order, with the locale key and the glyph of each */
export const WISH_GROUPS = [
  { id: 'quests', key: 'EWishlistGroup/Quests', ico: 'wishlist_quests' },
  { id: 'equipment', key: 'EWishlistGroup/Equipment', ico: 'wishlist_equipment' },
  { id: 'hideout', key: 'EWishlistGroup/Hideout', ico: 'wishlist_hideout' },
  { id: 'other', key: 'EWishlistGroup/Other', ico: 'wishlist_other' },
  { id: 'trading', key: 'EWishlistGroup/Trading', ico: 'wishlist_trading' },
];

function book() {
  const p = game.profile;
  if (!p.wishlist || typeof p.wishlist !== 'object' || Array.isArray(p.wishlist)) p.wishlist = {};
  return p.wishlist;
}

/** the 24-hex id of whatever was handed in: an id, a registry key or a template */
function idOf(ref) {
  if (!ref) return null;
  if (typeof ref === 'object') return ref.id || null;
  return tplOf(ref)?.id || ref;
}

/** { template id: heading } */
export function wishlist() { return book(); }

export function wishCount() { return Object.keys(book()).length; }

/** the heading an item is filed under, or null when it is not on the list */
export function wishGroup(ref) {
  const id = idOf(ref);
  return (id && book()[id]) || null;
}

export function inWishlist(ref) { return !!wishGroup(ref); }

/** put an item on the list, or move it to another heading */
export function addToWishlist(ref, group = 'other') {
  const id = idOf(ref);
  if (!id) return false;
  if (!WISH_GROUPS.some((g) => g.id === group)) group = 'other';
  if (book()[id] === group) return false;
  book()[id] = group;
  emit(EV.WISHLIST, { id, group });
  saveSoon();
  return true;
}

export function removeFromWishlist(ref) {
  const id = idOf(ref);
  if (!id || !book()[id]) return false;
  delete book()[id];
  emit(EV.WISHLIST, { id, group: null });
  saveSoon();
  return true;
}

/** take everything off the list (Settings > GAME > Clear Wishlist) */
export function clearWishlist() {
  const b = book();
  const ids = Object.keys(b);
  if (!ids.length) return 0;
  for (const id of ids) delete b[id];
  emit(EV.WISHLIST, { id: null, group: null });
  saveSoon();
  return ids.length;
}

/** the ids on the list, optionally under one heading only */
export function wishIds(group = null) {
  const out = [];
  for (const [id, g] of Object.entries(book())) if (!group || g === group) out.push(id);
  return out;
}
