// =========================================================
// Tarkov-style grid inventory: items, grids, equipment slots
//
// Model rules implemented here:
//  - items occupy w x h cells and may be rotated 90 deg (square items never rotate)
//  - a cell holds at most one item; placement is rejected on any overlap
//  - stacking merges same-template stacks up to tpl.stack, but never merges
//    a found-in-raid stack with a non-found-in-raid one
//  - containers own their own grids; a container may not be placed inside
//    itself or any of its own descendants, and nesting depth is capped
//  - equipment slots accept a category whitelist
// =========================================================

import { uid, clamp } from '../core/util.js';
import { getTpl } from '../data/items.js';

export const MAX_NEST_DEPTH = 3;

/** categories that may never be nested inside the given owner category */
const NEST_DENY = {
  backpack: ['backpack', 'rig', 'secure'],
  rig: ['rig', 'backpack', 'armor'],
  secure: ['backpack', 'rig', 'armor', 'weapon'],
  container: ['backpack'],
};

// ---------------------------------------------------------
// Item
// ---------------------------------------------------------
export class Item {
  constructor(tplId, opts = {}) {
    const tpl = getTpl(tplId);
    if (!tpl) throw new Error(`unknown item template: ${tplId}`);
    this.uid = opts.uid || uid('i');
    this.tplId = tplId;
    this.rot = opts.rot ? 1 : 0;
    this.stack = clamp(opts.stack ?? 1, 1, tpl.stack || 1);
    this.fir = opts.fir ?? false;
    this.examined = opts.examined ?? !!tpl.alwaysExamined;
    this.res = opts.res ?? (tpl.res ? tpl.res.max : null);
    this.dura = opts.dura ?? (tpl.dura != null ? tpl.dura : null);
    this.ammo = opts.ammo ?? (tpl.magSize != null ? 0 : null);
    /** @type {Grid[]|null} */
    this.grids = null;
    if (tpl.container) {
      this.grids = tpl.container.grids.map((g, i) => {
        const grid = new Grid(g[0], g[1], { filter: tpl.container.filter, label: tpl.container.labels?.[i] });
        grid.owner = this;
        return grid;
      });
    }
    /** where this item currently lives */
    this.holder = null; // { kind:'grid', grid, x, y } | { kind:'slot', slot }
  }

  get tpl() { return getTpl(this.tplId); }
  get name() { return this.tpl.name; }
  get short() { return this.tpl.short || this.tpl.name; }
  get cat() { return this.tpl.cat; }
  get w() { return this.rot ? this.tpl.h : this.tpl.w; }
  get h() { return this.rot ? this.tpl.w : this.tpl.h; }
  get canRotate() { return this.tpl.w !== this.tpl.h; }
  get isContainer() { return !!this.grids; }

  /** weight of this item alone (stack included) */
  get selfWeight() { return (this.tpl.weight || 0) * this.stack; }

  /** weight including everything stored inside */
  get weight() {
    let w = this.selfWeight;
    if (this.grids) for (const g of this.grids) for (const it of g.items()) w += it.weight;
    return w;
  }

  /** base value of this item alone */
  get selfValue() { return (this.tpl.price || 0) * this.stack; }

  get value() {
    let v = this.selfValue;
    if (this.grids) for (const g of this.grids) for (const it of g.items()) v += it.value;
    return v;
  }

  /** every item stored inside this one, recursively */
  *descendants() {
    if (!this.grids) return;
    for (const g of this.grids) {
      for (const it of g.items()) {
        yield it;
        yield* it.descendants();
      }
    }
  }

  contains(other) {
    for (const d of this.descendants()) if (d === other) return true;
    return false;
  }

  /** nesting depth of the container chain this item sits in (0 = top level) */
  depth() {
    let d = 0, cur = this.holder;
    while (cur) {
      if (cur.kind === 'grid' && cur.grid.owner) { d++; cur = cur.grid.owner.holder; }
      else break;
    }
    return d;
  }

  get isEmptyContainer() {
    if (!this.grids) return true;
    return this.grids.every((g) => g.count === 0);
  }

  canStackWith(other) {
    const tpl = this.tpl;
    if (!tpl.stack || tpl.stack <= 1) return false;
    if (other.tplId !== this.tplId) return false;
    if (this.stack >= tpl.stack) return false;
    return true;
  }

  spaceLeft() { return (this.tpl.stack || 1) - this.stack; }

  toJSON() {
    const o = { uid: this.uid, t: this.tplId };
    if (this.rot) o.r = 1;
    if (this.stack !== 1) o.s = this.stack;
    if (this.fir) o.f = 1;
    if (this.examined) o.e = 1;
    if (this.res != null) o.res = this.res;
    if (this.dura != null) o.d = this.dura;
    if (this.ammo != null) o.a = this.ammo;
    if (this.grids) o.g = this.grids.map((g) => g.toJSON());
    return o;
  }

  static fromJSON(o) {
    const it = new Item(o.t, {
      uid: o.uid, rot: o.r, stack: o.s, fir: o.f, examined: o.e,
      res: o.res, dura: o.d, ammo: o.a,
    });
    if (o.g && it.grids) {
      o.g.forEach((gj, i) => { if (it.grids[i]) it.grids[i].loadJSON(gj); });
    }
    return it;
  }
}

// ---------------------------------------------------------
// Grid
// ---------------------------------------------------------
export class Grid {
  constructor(w, h, opts = {}) {
    this.id = opts.id || uid('g');
    this.w = w;
    this.h = h;
    this.label = opts.label || null;
    this.filter = opts.filter || null;   // { allow?:string[], deny?:string[] }
    this.owner = null;                   // Item, when this grid belongs to a container item
    this.tag = opts.tag || null;         // 'stash' | 'loot' | 'ground' | ...
    this.cells = new Array(w * h).fill(null);
    this._items = new Map();             // uid -> Item
  }

  get count() { return this._items.size; }
  get capacity() { return this.w * this.h; }

  usedCells() {
    let n = 0;
    for (const it of this._items.values()) n += it.w * it.h;
    return n;
  }

  items() { return Array.from(this._items.values()); }

  at(x, y) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return null;
    return this.cells[y * this.w + x];
  }

  itemAt(x, y) {
    const id = this.at(x, y);
    return id ? this._items.get(id) : null;
  }

  posOf(item) {
    const h = item.holder;
    return h && h.kind === 'grid' && h.grid === this ? { x: h.x, y: h.y } : null;
  }

  /** category filter check only */
  accepts(item) {
    const f = this.filter;
    if (!f) return true;
    const cat = item.cat;
    if (f.allow && !f.allow.includes(cat)) return false;
    if (f.deny && f.deny.includes(cat)) return false;
    return true;
  }

  /**
   * Full legality check for placing `item` with its top-left at (x,y).
   * `rot` overrides item.rot when provided.
   */
  canPlace(item, x, y, rot = item.rot, opts = {}) {
    const w = rot ? item.tpl.h : item.tpl.w;
    const h = rot ? item.tpl.w : item.tpl.h;
    if (x < 0 || y < 0 || x + w > this.w || y + h > this.h) return false;
    if (!this.accepts(item)) return false;
    if (!canNest(item, this)) return false;

    const ignore = opts.ignore ? new Set([opts.ignore.uid]) : null;
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        const occ = this.cells[(y + dy) * this.w + (x + dx)];
        if (occ && (!ignore || !ignore.has(occ))) return false;
      }
    }
    return true;
  }

  /** raw write; assumes canPlace already passed */
  place(item, x, y, rot = item.rot) {
    item.rot = rot ? 1 : 0;
    const w = item.w, h = item.h;
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) this.cells[(y + dy) * this.w + (x + dx)] = item.uid;
    }
    this._items.set(item.uid, item);
    item.holder = { kind: 'grid', grid: this, x, y };
    return true;
  }

  remove(item) {
    if (!this._items.has(item.uid)) return false;
    const pos = this.posOf(item);
    if (pos) {
      for (let dy = 0; dy < item.h; dy++) {
        for (let dx = 0; dx < item.w; dx++) {
          const idx = (pos.y + dy) * this.w + (pos.x + dx);
          if (this.cells[idx] === item.uid) this.cells[idx] = null;
        }
      }
    } else {
      for (let i = 0; i < this.cells.length; i++) if (this.cells[i] === item.uid) this.cells[i] = null;
    }
    this._items.delete(item.uid);
    if (item.holder && item.holder.grid === this) item.holder = null;
    return true;
  }

  /** first legal free position, unrotated first then rotated */
  findSpot(item, opts = {}) {
    const rots = item.canRotate ? (opts.preferRot ? [1, 0] : [0, 1]) : [0];
    for (const rot of rots) {
      const w = rot ? item.tpl.h : item.tpl.w;
      const h = rot ? item.tpl.w : item.tpl.h;
      if (w > this.w || h > this.h) continue;
      for (let y = 0; y <= this.h - h; y++) {
        for (let x = 0; x <= this.w - w; x++) {
          if (this.canPlace(item, x, y, rot, opts)) return { x, y, rot };
        }
      }
    }
    return null;
  }

  /** the item that would be displaced by a drop, or null / 'many' */
  overlapping(item, x, y, rot = item.rot, ignore = null) {
    const w = rot ? item.tpl.h : item.tpl.w;
    const h = rot ? item.tpl.w : item.tpl.h;
    const hit = new Set();
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        const cx = x + dx, cy = y + dy;
        if (cx < 0 || cy < 0 || cx >= this.w || cy >= this.h) continue;
        const occ = this.cells[cy * this.w + cx];
        if (occ && (!ignore || occ !== ignore.uid)) hit.add(occ);
      }
    }
    if (hit.size === 0) return null;
    if (hit.size > 1) return 'many';
    return this._items.get(Array.from(hit)[0]) || null;
  }

  sort() {
    const list = this.items().sort((a, b) => {
      const av = a.h * a.w, bv = b.h * b.w;
      if (bv !== av) return bv - av;
      if (a.cat !== b.cat) return a.cat < b.cat ? -1 : 1;
      return a.name < b.name ? -1 : 1;
    });
    for (const it of list) this.remove(it);
    const leftovers = [];
    for (const it of list) {
      const spot = this.findSpot(it);
      if (spot) this.place(it, spot.x, spot.y, spot.rot);
      else leftovers.push(it);
    }
    return leftovers;
  }

  toJSON() {
    const arr = [];
    for (const it of this._items.values()) {
      const p = this.posOf(it);
      arr.push({ x: p ? p.x : 0, y: p ? p.y : 0, i: it.toJSON() });
    }
    return { w: this.w, h: this.h, it: arr };
  }

  loadJSON(o) {
    this.cells.fill(null);
    this._items.clear();
    if (!o || !o.it) return;
    for (const rec of o.it) {
      let item;
      try { item = Item.fromJSON(rec.i); } catch { continue; }
      if (rec.x + item.w <= this.w && rec.y + item.h <= this.h) this.place(item, rec.x, rec.y, item.rot);
      else {
        const spot = this.findSpot(item);
        if (spot) this.place(item, spot.x, spot.y, spot.rot);
      }
    }
  }
}

// ---------------------------------------------------------
// Equipment slot
// ---------------------------------------------------------
export class Slot {
  constructor(key, opts = {}) {
    this.id = uid('s');
    this.key = key;
    this.label = opts.label || key.toUpperCase();
    this.accepts = opts.accepts || [];
    this.icon = opts.icon || 'box';
    this.wide = !!opts.wide;
    this.item = null;
  }

  canAccept(item) {
    if (!item) return false;
    if (!this.accepts.includes(item.cat)) return false;
    // never let a container swallow the thing it is currently stored in
    if (item.isContainer && item.contains(this.item)) return false;
    return true;
  }

  set(item) {
    this.item = item;
    if (item) item.holder = { kind: 'slot', slot: this };
    return true;
  }

  clear() {
    if (this.item && this.item.holder && this.item.holder.slot === this) this.item.holder = null;
    const old = this.item;
    this.item = null;
    return old;
  }

  toJSON() { return this.item ? this.item.toJSON() : null; }
  loadJSON(o) { this.item = o ? Item.fromJSON(o) : null; if (this.item) this.item.holder = { kind: 'slot', slot: this }; }
}

// ---------------------------------------------------------
// nesting legality
// ---------------------------------------------------------
export function canNest(item, targetGrid) {
  const owner = targetGrid.owner;
  if (!owner) return true;                       // top-level grid (stash, loot, ground)
  if (owner === item) return false;              // into itself
  if (item.isContainer && item.contains(owner)) return false; // into its own descendant

  const ownerCat = owner.cat;
  const deny = NEST_DENY[ownerCat];
  if (deny && deny.includes(item.cat)) return false;

  if (item.isContainer) {
    // depth of the target grid's owner chain
    let d = 1, cur = owner.holder;
    while (cur && cur.kind === 'grid' && cur.grid.owner) { d++; cur = cur.grid.owner.holder; }
    if (d + 1 > MAX_NEST_DEPTH) return false;
  }
  return true;
}

// ---------------------------------------------------------
// mutation helpers (all go through here so UI stays in sync)
// ---------------------------------------------------------

/** detach an item from wherever it lives */
export function detach(item) {
  const h = item.holder;
  if (!h) return;
  if (h.kind === 'grid') h.grid.remove(item);
  else if (h.kind === 'slot') h.slot.clear();
  item.holder = null;
}

/**
 * Move `item` into `grid` at (x,y).
 *
 * Tarkov has no grid-to-grid swap: dropping onto occupied cells is simply
 * rejected. The one legal "overlap" is merging into a stack of the same
 * template. Slot-to-slot swapping is handled by moveToSlot.
 *
 * Returns { ok, action } with action 'move' | 'merge' | 'partial' | 'blocked'.
 */
export function moveToGrid(item, grid, x, y, rot = item.rot) {
  const target = grid.overlapping(item, x, y, rot, item);

  // -- merge into an existing stack --
  if (target && target !== 'many' && target !== item && target.canStackWith(item)) {
    const moved = Math.min(target.spaceLeft(), item.stack);
    target.stack += moved;
    target.fir = target.fir && item.fir;   // never launder a non-FiR stack into FiR
    item.stack -= moved;
    if (item.stack <= 0) { detach(item); return { ok: true, action: 'merge' }; }
    return { ok: true, action: 'partial' };
  }

  const from = item.holder;
  detach(item);
  if (grid.canPlace(item, x, y, rot)) {
    grid.place(item, x, y, rot);
    return { ok: true, action: 'move' };
  }
  restore(item, from);
  return { ok: false, action: 'blocked' };
}

export function moveToSlot(item, slot) {
  if (!slot.canAccept(item)) return { ok: false, action: 'rejected' };
  const from = item.holder;
  const prev = slot.item;
  if (prev === item) return { ok: true, action: 'move' };
  detach(item);
  if (prev) {
    slot.clear();
    if (from && from.kind === 'grid' && from.grid.canPlace(prev, from.x, from.y, prev.rot)) {
      from.grid.place(prev, from.x, from.y, prev.rot);
    } else {
      const host = from && from.kind === 'grid' ? from.grid : null;
      const spot = host ? host.findSpot(prev) : null;
      if (spot) host.place(prev, spot.x, spot.y, spot.rot);
      else { slot.set(prev); restore(item, from); return { ok: false, action: 'blocked' }; }
    }
  }
  slot.set(item);
  return { ok: true, action: prev ? 'swap' : 'move' };
}

function restore(item, from) {
  if (!from) return;
  if (from.kind === 'grid') {
    if (from.grid.canPlace(item, from.x, from.y, item.rot)) from.grid.place(item, from.x, from.y, item.rot);
    else {
      const spot = from.grid.findSpot(item);
      if (spot) from.grid.place(item, spot.x, spot.y, spot.rot);
    }
  } else if (from.kind === 'slot') {
    from.slot.set(item);
  }
}

/**
 * Try to place `item` into the first of `grids` that has room,
 * merging into partial stacks first. Returns true when fully placed.
 */
export function autoPlace(item, grids) {
  // merge pass
  if ((item.tpl.stack || 1) > 1) {
    for (const g of grids) {
      for (const other of g.items()) {
        if (other === item || !other.canStackWith(item)) continue;
        const moved = Math.min(other.spaceLeft(), item.stack);
        other.stack += moved;
        item.stack -= moved;
        if (item.stack <= 0) { detach(item); return true; }
      }
    }
  }
  // placement pass
  for (const g of grids) {
    if (!g.accepts(item) || !canNest(item, g)) continue;
    const spot = g.findSpot(item);
    if (spot) { detach(item); g.place(item, spot.x, spot.y, spot.rot); return true; }
  }
  return false;
}

/** split `n` off an existing stack; returns the new Item (unplaced) or null */
export function splitStack(item, n) {
  n = Math.floor(n);
  if (n <= 0 || n >= item.stack) return null;
  item.stack -= n;
  const copy = new Item(item.tplId, { stack: n, fir: item.fir, examined: item.examined, res: item.res, dura: item.dura });
  return copy;
}

/** total weight of a list of grids/slots */
export function weighAll(nodes) {
  let w = 0;
  for (const n of nodes) {
    if (n instanceof Grid) for (const it of n.items()) w += it.weight;
    else if (n instanceof Slot && n.item) w += n.item.weight;
  }
  return w;
}
