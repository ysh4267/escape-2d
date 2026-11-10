// =========================================================
// tiny synchronous event bus
// =========================================================

const handlers = new Map();

export function on(type, fn) {
  if (!handlers.has(type)) handlers.set(type, new Set());
  handlers.get(type).add(fn);
  return () => off(type, fn);
}

export function off(type, fn) {
  handlers.get(type)?.delete(fn);
}

export function once(type, fn) {
  const un = on(type, (...a) => { un(); fn(...a); });
  return un;
}

export function emit(type, payload) {
  const set = handlers.get(type);
  if (!set) return;
  for (const fn of Array.from(set)) {
    try { fn(payload); }
    catch (err) { console.error(`[events] handler for "${type}" threw`, err); }
  }
}

// only events that are actually emitted AND handled live here — a constant
// nobody fires is a trap for the next contributor
export const EV = {
  INVENTORY_CHANGED: 'inventory:changed',
  SCREEN_CHANGED: 'screen:changed',
  RAID_END: 'raid:end',
  /** the player killed someone: { location, role, side, part, dist, weapon, mods, hour, world, gear } */
  RAID_KILL: 'raid:kill',
  LOOT_OPENED: 'loot:opened',
  LOOT_FOUND: 'loot:found',
  LOOT_CLOSED: 'loot:closed',
  TOAST: 'ui:toast',
  RAID_TOAST: 'raid:toast',
  RAID_LEVEL: 'raid:level',
  LEVEL_UP: 'profile:levelup',
  HEALTH_CHANGED: 'health:changed',
  /** experience was earned: { amount, why } */
  EXP: 'profile:exp',
  /** { kind: started|progress|objective|ready|done|failed|available|trader, task, obj?, cur?, need? } */
  QUEST: 'quest:update',
  /** a message arrived or the mailbox changed */
  MAIL: 'mail:changed',
  /** { kind: buy|sell, trader, ... } */
  TRADE_DEAL: 'trade:deal',
  /** { trader, level, was } */
  TRADER_LEVEL: 'trader:level',
  /** { trader, delta, rep }: a trader's regard for the profile moved */
  TRADER_STANDING: 'trader:standing',
  TRADER_RESTOCK: 'trader:restock',
  /** { id, level } */
  SKILL_UP: 'skill:up',
  /** the flea market moved: { kind: buy|listed|sold|expired|removed|rating, offer? } */
  FLEA: 'flea:changed',
  /** the hideout moved: { kind: build|installed|craft|collected|generator|fuel, area?, craft? } */
  HIDEOUT: 'hideout:changed',
  /** { id, group }: an item went onto the wishlist, changed heading or (group null) came off it */
  WISHLIST: 'wishlist:changed',
};
