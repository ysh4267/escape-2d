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
//  - weapons and weapon parts carry mod slots (Slots in the template): a part
//    goes into a slot whose filter names its template, conflicts are checked
//    against every part already on the gun, and the gun's footprint grows with
//    what is hung off it (ExtraSize* on the parts, folded stocks excepted)
//  - magazines hold cartridges as an ordered list of runs, last loaded on top;
//    weapons with a chamber hold one round in it
// =========================================================

import { uid, clamp } from '../core/util.js';
import { getTpl } from '../data/items.js';

export const MAX_NEST_DEPTH = 3;

/** categories that may never be nested inside the given owner category */
const NEST_DENY = {
  backpack: ['backpack', 'rig', 'secure'],
  rig: ['rig', 'backpack', 'armor', 'secure'],
  secure: ['backpack', 'rig', 'armor', 'weapon', 'secure'],
  // a secure container hidden inside a case would be destroyed with the case
  // on death, defeating its whole point — the real game forbids this too
  container: ['backpack', 'secure'],
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
    this.examined = opts.examined ?? !!(tpl.known || tpl.alwaysExamined);
    this.res = opts.res ?? (tpl.res ? tpl.res.max : null);
    this.dura = opts.dura ?? (tpl.dura != null ? tpl.dura : (tpl.wpn?.maxDura ?? null));
    /**
     * cartridges in a magazine (or the internal tube of a shotgun): runs of
     * {t: ammo template key, n: count}, the LAST run is the top of the stack
     * @type {{t:string,n:number}[]|null}
     */
    this.rounds = tpl.magSize != null ? [] : null;
    /** the round(s) in the chamber(s) of a weapon: ammo template keys */
    this.chamber = tpl.wpn?.chambers ? [] : null;
    /** a foldable stock folded */
    this.folded = !!opts.folded;
    /**
     * mod slots, in template order — every weapon and every part with Slots
     * @type {ModSlot[]|null}
     */
    this.slots = tpl.slots ? tpl.slots.map((d) => new ModSlot(this, d)) : null;
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
    this.holder = null; // { kind:'grid', grid, x, y } | { kind:'slot', slot } | { kind:'mod', slot }

    // a weapon is born assembled the way the game's default preset assembles
    // it, unless the caller is restoring one from a save (bare:true) or wants
    // the stripped receiver on purpose
    if (tpl.preset && !opts.bare) applyPreset(this, tpl.preset);
  }

  get tpl() { return getTpl(this.tplId); }
  get name() { return this.tpl.name; }
  get short() { return this.tpl.short || this.tpl.name; }
  get cat() { return this.tpl.cat; }
  /**
   * Unrotated footprint. A bare template is tpl.w x tpl.h; a weapon grows by
   * the ExtraSize of what is attached — the largest overhang on each side, or
   * the sum where a part says ExtraSizeForceAdd — and a folded stock counts
   * for nothing (SizeReduceRight comes off as well).
   */
  get fw() { return footprint(this).w; }
  get fh() { return footprint(this).h; }
  get w() { return this.rot ? this.fh : this.fw; }
  get h() { return this.rot ? this.fw : this.fh; }
  get canRotate() { return this.fw !== this.fh; }
  get isContainer() { return !!this.grids; }
  get isWeapon() { return !!this.tpl.wpn; }
  get isMag() { return this.rounds != null; }
  get hasMods() { return !!this.slots; }

  /** installed parts, in slot order */
  *mods() {
    if (!this.slots) return;
    for (const s of this.slots) if (s.item) yield s.item;
  }

  /** installed parts and everything hanging off them */
  *allMods() {
    for (const m of this.mods()) { yield m; yield* m.allMods(); }
  }

  modSlot(name) { return this.slots ? this.slots.find((s) => s.name === name) || null : null; }
  mod(name) { return this.modSlot(name)?.item || null; }

  /** the weapon (or part) this part is attached to, if any */
  get parentMod() { return this.holder?.kind === 'mod' ? this.holder.slot.owner : null; }

  /** the top of the mod tree this item belongs to */
  get root() {
    let cur = this;
    let guard = 0;
    while (cur.parentMod && guard++ < 24) cur = cur.parentMod;
    return cur;
  }

  /** the magazine feeding this weapon, whether a detachable box or a fixed tube */
  get magazine() { return this.mod('mod_magazine'); }

  /** rounds in a magazine */
  get ammoCount() {
    if (!this.rounds) return 0;
    let n = 0;
    for (const r of this.rounds) n += r.n;
    return n;
  }
  get ammoFree() { return Math.max(0, (this.tpl.magSize || 0) - this.ammoCount); }
  /** template key of the round on top of the magazine, or null */
  get topRound() { return this.rounds && this.rounds.length ? this.rounds[this.rounds.length - 1].t : null; }

  /** weight of this item alone (stack included), plus the cartridges in a magazine */
  get selfWeight() {
    let w = (this.tpl.weight || 0) * this.stack;
    if (this.rounds) for (const r of this.rounds) w += (getTpl(r.t)?.weight || 0) * r.n;
    if (this.chamber) for (const t of this.chamber) w += getTpl(t)?.weight || 0;
    return w;
  }

  /** weight including everything stored inside and everything attached */
  get weight() {
    let w = this.selfWeight;
    if (this.grids) for (const g of this.grids) for (const it of g.items()) w += it.weight;
    for (const m of this.mods()) w += m.weight;
    return w;
  }

  /** base value of this item alone, cartridges included */
  get selfValue() {
    let v = (this.tpl.price || 0) * this.stack;
    if (this.rounds) for (const r of this.rounds) v += (getTpl(r.t)?.price || 0) * r.n;
    if (this.chamber) for (const t of this.chamber) v += getTpl(t)?.price || 0;
    return v;
  }

  get value() {
    let v = this.selfValue;
    if (this.grids) for (const g of this.grids) for (const it of g.items()) v += it.value;
    for (const m of this.mods()) v += m.value;
    return v;
  }

  /** every item stored inside or attached to this one, recursively */
  *descendants() {
    if (this.grids) {
      for (const g of this.grids) {
        for (const it of g.items()) {
          yield it;
          yield* it.descendants();
        }
      }
    }
    for (const m of this.mods()) {
      yield m;
      yield* m.descendants();
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
      else if (cur.kind === 'mod') cur = cur.slot.owner.holder;   // parts ride with the gun
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
    // found-in-raid never mixes with not-found-in-raid: merging would either
    // launder the incoming units or demote the whole stack
    if (!!this.fir !== !!other.fir) return false;
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
    if (this.folded) o.fd = 1;
    if (this.rounds && this.rounds.length) o.rd = this.rounds.map((r) => [r.t, r.n]);
    if (this.chamber && this.chamber.length) o.ch = this.chamber.slice();
    if (this.grids) o.g = this.grids.map((g) => g.toJSON());
    if (this.slots) {
      const m = {};
      let any = false;
      for (const sl of this.slots) if (sl.item) { m[sl.name] = sl.item.toJSON(); any = true; }
      if (any) o.m = m;
    }
    return o;
  }

  static fromJSON(o) {
    const it = new Item(o.t, {
      uid: o.uid, rot: o.r, stack: o.s, fir: o.f, examined: o.e,
      res: o.res, dura: o.d, folded: o.fd, bare: true,
    });
    if (o.g && it.grids) {
      o.g.forEach((gj, i) => { if (it.grids[i]) it.grids[i].loadJSON(gj); });
    }
    if (o.rd && it.rounds) {
      for (const [t, n] of o.rd) if (getTpl(t) && n > 0) it.rounds.push({ t, n });
      // a save from before the round cap changed must not overfill the magazine
      let over = it.ammoCount - (it.tpl.magSize || 0);
      while (over > 0 && it.rounds.length) {
        const top = it.rounds[it.rounds.length - 1];
        const take = Math.min(top.n, over);
        top.n -= take; over -= take;
        if (top.n <= 0) it.rounds.pop();
      }
    }
    if (o.ch && it.chamber) {
      for (const t of o.ch) if (getTpl(t) && it.chamber.length < (it.tpl.wpn?.chambers || 1)) it.chamber.push(t);
    }
    if (o.m && it.slots) {
      for (const sl of it.slots) {
        const mj = o.m[sl.name];
        if (!mj) continue;
        let part;
        try { part = Item.fromJSON(mj); } catch { continue; }
        // one stale part must not void the whole gun; the filter is re-checked
        // so a template that stopped fitting is dropped rather than kept
        if (sl.def.f.includes(part.tplId)) sl.set(part);
      }
    }
    // an old save carried the loaded count as a bare number
    if (o.a && it.rounds && !it.rounds.length && o.a > 0) {
      const def = it.tpl.ammoFilter?.[0];
      if (def) it.rounds.push({ t: def, n: Math.min(o.a, it.tpl.magSize || o.a) });
    }
    return it;
  }
}

// ---------------------------------------------------------
// ModSlot — one attachment point on a weapon or a part
// ---------------------------------------------------------
export class ModSlot {
  constructor(owner, def) {
    this.id = uid('m');
    this.owner = owner;          // the Item this slot belongs to
    this.def = def;              // { n, label, req, f:[keys], merge }
    this.name = def.n;
    this.key = def.n;
    this.label = def.label || def.n;
    this.required = !!def.req;
    this.item = null;
  }

  /** template-level fit: is this part on the slot's filter list */
  fits(item) { return !!item && this.def.f.includes(item.tplId); }

  /**
   * Full legality: filter, conflicts with everything on the gun, and the
   * assembled gun still fitting wherever it is lying. `why` collects the
   * reason for the UI.
   */
  canAccept(item, why = null) {
    const res = canInstall(this, item);
    if (!res.ok && why) why.reason = res.reason;
    return res.ok;
  }

  set(item) {
    this.item = item;
    if (item) {
      item.rot = 0;
      item.holder = { kind: 'mod', slot: this };
    }
    return true;
  }

  clear() {
    if (this.item && this.item.holder && this.item.holder.slot === this) this.item.holder = null;
    const old = this.item;
    this.item = null;
    return old;
  }

  toJSON() { return this.item ? this.item.toJSON() : null; }
}

/** why a part will not go on: {ok, reason} */
export function canInstall(slot, item) {
  if (!item) return { ok: false, reason: 'nothing to install' };
  if (!slot.fits(item)) return { ok: false, reason: 'does not fit this slot' };
  const root = slot.owner.root;
  if (item === root || item.contains?.(root) || [...item.allMods()].includes(root)) {
    return { ok: false, reason: 'cannot attach a gun to its own part' };
  }
  if (item.rounds && item.ammoCount && item.tpl.ammoFilter && slot.owner.tpl.cal
      && item.tpl.cal && item.tpl.cal !== slot.owner.tpl.cal) {
    return { ok: false, reason: 'wrong calibre' };
  }
  // conflicts run both ways: the new part lists what it excludes, and every
  // part already on the gun lists what it excludes
  const conflicts = item.tpl.conflicts || [];
  const installed = [root, ...root.allMods()].filter((m) => m !== slot.item);
  for (const m of installed) {
    if (conflicts.includes(m.tplId)) return { ok: false, reason: `conflicts with ${m.tpl.short || m.tpl.name}` };
    if ((m.tpl.conflicts || []).includes(item.tplId)) return { ok: false, reason: `${m.tpl.short || m.tpl.name} conflicts with it` };
  }
  // the parts hanging under the slot's current occupant would be lost by a
  // swap: refuse rather than silently destroy them
  if (slot.item && slot.item !== item && [...slot.item.allMods()].length) {
    return { ok: false, reason: 'remove the parts on the current one first' };
  }
  // the assembled gun must still fit where it lies
  if (!fitsAfter(root, () => {
    const prev = slot.item;
    slot.item = item;
    return () => { slot.item = prev; };
  })) return { ok: false, reason: 'the gun would no longer fit where it lies' };
  return { ok: true, reason: null };
}

/**
 * Apply a temporary change (returned undo fn), measure the root's footprint
 * against its holder, undo, report. A gun in a slot always fits; one lying in
 * a grid has to re-place at its own top-left with the new size.
 */
export function fitsAfter(root, apply) {
  const h = root.holder;
  if (!h || h.kind !== 'grid') return true;
  const undo = apply();
  let ok;
  try {
    ok = h.grid.canPlace(root, h.x, h.y, root.rot, { ignore: root });
  } finally { undo(); }
  return ok;
}

// ---------------------------------------------------------
// footprint
// ---------------------------------------------------------
function footprint(item) {
  const tpl = item.tpl;
  const base = { w: tpl.w, h: tpl.h };
  if (!item.slots) return base;
  const max = [0, 0, 0, 0];   // left, right, up, down
  const add = [0, 0, 0, 0];
  const foldSlot = item.folded ? (tpl.wpn?.foldSlot || tpl.mod?.foldSlot) : null;
  const walk = (node, skip) => {
    if (!node.slots) return;
    for (const sl of node.slots) {
      const m = sl.item;
      if (!m) continue;
      if (skip && sl.name === skip) continue;
      const xs = m.tpl.mod?.xs;
      if (xs) {
        if (m.tpl.mod.xsAdd) for (let i = 0; i < 4; i++) add[i] += xs[i];
        else for (let i = 0; i < 4; i++) max[i] = Math.max(max[i], xs[i]);
      }
      // a folded part under this one hides its own tail
      walk(m, m.folded ? m.tpl.mod?.foldSlot : null);
    }
  };
  walk(item, foldSlot);
  let w = tpl.w + max[0] + max[1] + add[0] + add[1];
  const h = tpl.h + max[2] + max[3] + add[2] + add[3];
  if (item.folded) w -= (tpl.wpn?.sizeReduceR || tpl.mod?.sizeReduceR || 0);
  return { w: Math.max(1, w), h: Math.max(1, h) };
}

// ---------------------------------------------------------
// presets
// ---------------------------------------------------------
/** hang the default parts on a freshly made weapon: {slot: {t, s:{...}}} */
export function applyPreset(item, tree) {
  if (!item.slots || !tree) return;
  for (const sl of item.slots) {
    const rec = tree[sl.name];
    if (!rec || !getTpl(rec.t) || !sl.def.f.includes(rec.t)) continue;
    let part;
    try { part = new Item(rec.t, { bare: true }); } catch { continue; }
    sl.set(part);
    if (rec.s) applyPreset(part, rec.s);
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
    // hosts can install an arbitrary gate (the trading table only takes what
    // the active trader actually buys)
    if (this.mayAccept && !this.mayAccept(item)) return false;
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
    const w = rot ? item.fh : item.fw;
    const h = rot ? item.fw : item.fh;
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
      const w = rot ? item.fh : item.fw;
      const h = rot ? item.fw : item.fh;
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
    const w = rot ? item.fh : item.fw;
    const h = rot ? item.fw : item.fh;
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
    // greedy repacking can fail on arrangements the player packed by hand, so
    // remember where everything was: a failed sort must never destroy items
    const before = list.map((it) => ({ it, pos: this.posOf(it), rot: it.rot }));
    for (const it of list) this.remove(it);
    const leftovers = [];
    for (const it of list) {
      const spot = this.findSpot(it);
      if (spot) this.place(it, spot.x, spot.y, spot.rot);
      else leftovers.push(it);
    }
    if (leftovers.length) {
      // roll the whole thing back to the pre-sort layout, which is known-legal
      for (const { it } of before) this.remove(it);
      for (const { it, pos, rot } of before) this.place(it, pos.x, pos.y, rot);
    }
    return leftovers;
  }

  /**
   * Change the footprint, keeping every item exactly where it lies. The
   * request is grown as far as it has to be to cover what is already placed,
   * so nothing can ever be pushed off the edge.
   */
  resize(w, h) {
    for (const it of this._items.values()) {
      const p = this.posOf(it);
      if (p) { w = Math.max(w, p.x + it.w); h = Math.max(h, p.y + it.h); }
    }
    if (w === this.w && h === this.h) return;
    const cells = new Array(w * h).fill(null);
    for (const it of this._items.values()) {
      const p = this.posOf(it);
      if (!p) continue;
      for (let dy = 0; dy < it.h; dy++) {
        for (let dx = 0; dx < it.w; dx++) cells[(p.y + dy) * w + (p.x + dx)] = it.uid;
      }
    }
    this.w = w;
    this.h = h;
    this.cells = cells;
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
    if (item) {
      // equipment slots have no orientation: a rifle carried sideways in a
      // backpack goes back upright the moment it is worn
      item.rot = 0;
      item.holder = { kind: 'slot', slot: this };
    }
    return true;
  }

  clear() {
    if (this.item && this.item.holder && this.item.holder.slot === this) this.item.holder = null;
    const old = this.item;
    this.item = null;
    return old;
  }

  toJSON() { return this.item ? this.item.toJSON() : null; }
  loadJSON(o) {
    // one stale template in a slot must not void the whole save
    try { this.item = o ? Item.fromJSON(o) : null; } catch { this.item = null; }
    if (this.item) { this.item.rot = 0; this.item.holder = { kind: 'slot', slot: this }; }
  }
}

// ---------------------------------------------------------
// nesting legality
// ---------------------------------------------------------
/** deepest container chain inside `item` (0 when it holds no containers) */
function innerDepth(item) {
  if (!item.grids) return 0;
  let deepest = 0;
  for (const g of item.grids) {
    for (const child of g.items()) {
      if (child.isContainer) deepest = Math.max(deepest, 1 + innerDepth(child));
    }
  }
  return deepest;
}

export function canNest(item, targetGrid) {
  const owner = targetGrid.owner;
  if (!owner) return true;                       // top-level grid (stash, loot, ground)
  if (owner === item) return false;              // into itself
  if (item.isContainer && item.contains(owner)) return false; // into its own descendant

  const ownerCat = owner.cat;
  const deny = NEST_DENY[ownerCat];
  if (deny && deny.includes(item.cat)) return false;

  if (item.isContainer) {
    // depth of the target grid's owner chain, plus whatever the moved
    // container is already carrying inside itself
    let d = 1, cur = owner.holder;
    while (cur && cur.kind === 'grid' && cur.grid.owner) { d++; cur = cur.grid.owner.holder; }
    if (d + 1 + innerDepth(item) > MAX_NEST_DEPTH) return false;
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
  else if (h.kind === 'slot' || h.kind === 'mod') h.slot.clear();
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
  // A grid that refuses the item refuses it as a merge too. This check used to
  // be missing, and a merge runs before canPlace() ever sees the drop: dragging
  // ammo or a money stack onto the matching offer in the trader's showcase
  // merged it into the display-only copy, which the next repaint threw away.
  if (grid.accepts(item) && canNest(item, grid)
      && target && target !== 'many' && target !== item && target.canStackWith(item)) {
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
    if (from && (from.kind === 'slot' || from.kind === 'mod') && from.slot.canAccept(prev)) {
      // slot-to-slot: the displaced item takes the vacated slot
      from.slot.set(prev);
    } else if (from && from.kind === 'grid' && from.grid.canPlace(prev, from.x, from.y, prev.rot)) {
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
  } else if (from.kind === 'slot' || from.kind === 'mod') {
    from.slot.set(item);
  }
}

/**
 * Try to place `item` into the first of `grids` that has room,
 * merging into partial stacks first. Returns true when fully placed.
 * Pass { merge: false } when the caller may have to roll the move back:
 * merges mutate other stacks and cannot be undone by detaching the item.
 */
export function autoPlace(item, grids, opts = {}) {
  // merge pass
  if (opts.merge !== false && (item.tpl.stack || 1) > 1) {
    for (const g of grids) {
      // same rule as the placement pass below: a gated grid is gated for
      // merges too, or a round the trader refuses rides in on a stack he takes
      if (!g.accepts(item) || !canNest(item, g)) continue;
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
  // the raid-session marker must survive the split or the copy would neither
  // turn found-in-raid on extraction nor register as fresh loot
  if (item.raidLoot) copy.raidLoot = true;
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
