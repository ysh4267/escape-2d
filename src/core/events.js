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
  LOOT_OPENED: 'loot:opened',
  LOOT_FOUND: 'loot:found',
  LOOT_CLOSED: 'loot:closed',
  TOAST: 'ui:toast',
  RAID_TOAST: 'raid:toast',
};
