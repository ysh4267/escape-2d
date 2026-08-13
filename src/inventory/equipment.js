// =========================================================
// PMC equipment: the character's slots plus the four pockets
//
// Slot filters mirror the real ones (Headwear / Earpiece / FaceCover /
// Eyewear / ArmorVest / TacticalVest / Backpack / SecuredContainer /
// FirstPrimaryWeapon / SecondPrimaryWeapon / Holster / Scabbard).
// Base PMC pockets are FOUR SEPARATE 1x1 grids, so nothing larger than a
// single cell fits and items can never span two pockets.
// =========================================================

import { Slot, Grid, Item } from './model.js';
import { el, icon } from '../core/util.js';
import { renderSlot, renderGrid, renderContainerBlock } from './view.js';
import { SLOT_ACCEPTS } from '../data/items.js';

export const SLOT_DEFS = [
  { key: 'head',      label: 'HEAD',    icon: 'body',      w: 2, h: 2 },
  { key: 'ears',      label: 'EARS',    icon: 'info',      w: 2, h: 2 },
  { key: 'face',      label: 'FACE',    icon: 'body',      w: 2, h: 1 },
  { key: 'eyes',      label: 'EYES',    icon: 'eye',       w: 2, h: 1 },
  { key: 'armor',     label: 'ARMOR',   icon: 'box',       w: 3, h: 3 },
  { key: 'rig',       label: 'RIG',     icon: 'box',       w: 3, h: 3 },
  { key: 'backpack',  label: 'BACKPACK',icon: 'box',       w: 3, h: 3 },
  { key: 'secure',    label: 'POUCH',   icon: 'stash',     w: 3, h: 3 },
  { key: 'primary',   label: 'SLING',   icon: 'crosshair', w: 4, h: 1, wide: true },
  { key: 'secondary', label: 'BACK',    icon: 'crosshair', w: 4, h: 1, wide: true },
  { key: 'holster',   label: 'HOLSTER', icon: 'crosshair', w: 2, h: 1 },
  { key: 'scabbard',  label: 'SHEATH',  icon: 'discard',   w: 2, h: 1 },
];

export class Equipment {
  constructor() {
    /** @type {Record<string, Slot>} */
    this.slots = {};
    for (const d of SLOT_DEFS) {
      this.slots[d.key] = new Slot(d.key, {
        label: d.label, icon: d.icon, accepts: SLOT_ACCEPTS[d.key] || [], wide: d.wide,
      });
    }
    /** four independent single-cell pockets */
    this.pockets = [0, 1, 2, 3].map((i) => {
      const g = new Grid(1, 1, { label: `POCKET ${i + 1}`, tag: 'pocket' });
      return g;
    });
  }

  get(key) { return this.slots[key]; }
  item(key) { return this.slots[key]?.item || null; }

  /** every grid that can hold loose items, in Tarkov's quick-transfer priority */
  carryGrids() {
    const out = [];
    const rig = this.item('rig');
    if (rig?.grids) out.push(...rig.grids);
    out.push(...this.pockets);
    const bp = this.item('backpack');
    if (bp?.grids) out.push(...bp.grids);
    return out;
  }

  /** carry grids plus the secure container (used for "everything I can stow") */
  allGrids() {
    const out = this.carryGrids();
    const sec = this.item('secure');
    if (sec?.grids) out.push(...sec.grids);
    return out;
  }

  /** nested cases inside the rig / backpack / pouch also accept items */
  nestedGrids() {
    const out = [];
    const walk = (grids) => {
      for (const g of grids) {
        for (const it of g.items()) {
          if (it.grids) { out.push(...it.grids); walk(it.grids); }
        }
      }
    };
    walk(this.allGrids());
    return out;
  }

  slotList() { return SLOT_DEFS.map((d) => this.slots[d.key]); }

  /** which slot an item would equip into */
  slotFor(item) {
    for (const d of SLOT_DEFS) {
      const s = this.slots[d.key];
      if (s.accepts.includes(item.cat)) {
        if (!s.item) return s;
      }
    }
    // all matching slots are full -> return the first matching one for a swap
    for (const d of SLOT_DEFS) {
      const s = this.slots[d.key];
      if (s.accepts.includes(item.cat)) return s;
    }
    return null;
  }

  weight() {
    let w = 0;
    for (const d of SLOT_DEFS) {
      const it = this.slots[d.key].item;
      if (it) w += it.weight;
    }
    for (const g of this.pockets) for (const it of g.items()) w += it.weight;
    return w;
  }

  /** everything on the character, flattened */
  *everything() {
    for (const d of SLOT_DEFS) {
      const it = this.slots[d.key].item;
      if (it) { yield it; yield* it.descendants(); }
    }
    for (const g of this.pockets) for (const it of g.items()) { yield it; yield* it.descendants(); }
  }

  /** items that are lost on death (everything except the secure container) */
  *insecureItems() {
    for (const d of SLOT_DEFS) {
      if (d.key === 'secure') continue;
      const it = this.slots[d.key].item;
      if (it) yield it;
    }
    for (const g of this.pockets) for (const it of g.items()) yield it;
  }

  clearInsecure() {
    for (const d of SLOT_DEFS) {
      if (d.key === 'secure') continue;
      this.slots[d.key].clear();
    }
    for (const g of this.pockets) for (const it of g.items()) g.remove(it);
  }

  toJSON() {
    const o = { slots: {}, pockets: this.pockets.map((g) => g.toJSON()) };
    for (const d of SLOT_DEFS) o.slots[d.key] = this.slots[d.key].toJSON();
    return o;
  }

  loadJSON(o) {
    if (!o) return;
    for (const d of SLOT_DEFS) this.slots[d.key].loadJSON(o.slots?.[d.key] || null);
    (o.pockets || []).forEach((gj, i) => { if (this.pockets[i]) this.pockets[i].loadJSON(gj); });
  }
}

// ---------------------------------------------------------
// rendering
//
// Worn gear and carried storage are deliberately two separate panels: the
// doll is where you dress the character, the storage panel is where you
// actually shuffle loot.
// ---------------------------------------------------------
export function renderGearSlots(equipment, host) {
  host.replaceChildren();
  const doll = el('div', { class: 'equip' });
  for (const d of SLOT_DEFS) {
    doll.append(renderSlot(equipment.slots[d.key], { w: d.w, h: d.h }));
  }
  host.append(doll);
}

export function renderCarry(equipment, host, opts = {}) {
  host.replaceChildren();

  // pockets: four independent single-cell grids
  const pocketWrap = el('div', { class: 'cnt' },
    el('div', { class: 'cnt__head' }, icon('box'), el('span', { class: 'cnt__name' }, 'POCKETS')));
  const row = el('div', { style: { display: 'flex', gap: '4px' } });
  for (const g of equipment.pockets) row.append(renderGrid(g, opts));
  pocketWrap.append(row);
  host.append(pocketWrap);

  let any = false;
  for (const key of ['rig', 'backpack', 'secure']) {
    const it = equipment.item(key);
    if (it?.grids) {
      any = true;
      host.append(renderContainerBlock(it, {
        ...opts,
        title: `${equipment.slots[key].label} — ${it.tpl.name}`,
        icon: key === 'secure' ? 'stash' : 'box',
      }));
    }
  }
  if (!any) {
    host.append(el('div', { class: 'empty-note' }, 'NO RIG, BACKPACK OR POUCH EQUIPPED'));
  }
}

/** legacy single-panel render, kept for anything still calling it */
export function renderEquipment(equipment, host, opts = {}) {
  renderGearSlots(equipment, host);
  const carry = el('div');
  renderCarry(equipment, carry, opts);
  host.append(carry);
}
