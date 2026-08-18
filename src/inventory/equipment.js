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

/**
 * The slots, named and positioned the way the game's own character screen
 * does it (see the loadout screen on the wiki). The body block is a four-row
 * grid whose areas are declared in inventory.css:
 *
 *     EARPIECE   HEADWEAR    FACE COVER
 *                BODY ARMOR  EYEWEAR
 *     ON SLING ............  HOLSTER
 *     ON BACK  ............  SHEATH
 *
 * with the carry block — TACTICAL RIG, POCKETS, BACKPACK, POUCH — beside it.
 * The gap at row two, column one is where the real screen puts ARMBAND and
 * DOGTAG; this game has neither, so the silhouette shows through instead.
 *
 * `w`/`h` are the empty outline in stash cells. Every square slot is 2x2 there
 * and the two long-gun slots are a wide bar, exactly as in the reference — a
 * slot still grows past that when it holds something bigger, so worn gear
 * stays 1:1 with the stash.
 *
 * Order is also quick-equip priority: a rifle looks for the sling before the
 * back, so keep `primary` ahead of `secondary`.
 */
export const SLOT_DEFS = [
  { key: 'ears',      label: 'EARPIECE',     icon: 'g-headset', w: 2, h: 2, area: 'ears' },
  { key: 'head',      label: 'HEADWEAR',     icon: 'g-cap',     w: 2, h: 2, area: 'head' },
  { key: 'face',      label: 'FACE COVER',   icon: 'g-mask',    w: 2, h: 2, area: 'face' },
  { key: 'armor',     label: 'BODY ARMOR',   icon: 'g-armor',   w: 2, h: 2, area: 'armor' },
  { key: 'eyes',      label: 'EYEWEAR',      icon: 'g-goggles', w: 2, h: 2, area: 'eyes' },
  { key: 'primary',   label: 'ON SLING',     icon: 'g-rifle',   w: 4, h: 2, area: 'sling', wide: true },
  { key: 'holster',   label: 'HOLSTER',      icon: 'g-pistol',  w: 2, h: 2, area: 'holster' },
  { key: 'secondary', label: 'ON BACK',      icon: 'g-rifle',   w: 4, h: 2, area: 'back', wide: true },
  { key: 'scabbard',  label: 'SHEATH',       icon: 'g-knife',   w: 2, h: 2, area: 'sheath' },
  { key: 'rig',       label: 'TACTICAL RIG', icon: 'g-rig',     w: 2, h: 2, carry: true },
  { key: 'backpack',  label: 'BACKPACK',     icon: 'g-pack',    w: 2, h: 2, carry: true },
  { key: 'secure',    label: 'POUCH',        icon: 'g-pouch',   w: 2, h: 2, carry: true },
];

/**
 * The slots the character screen draws that this game has nothing to put in:
 * the armband and the dogtag under the earpiece, the three special slots by
 * the pockets. Drawn so the screen reads like the real one; they take no
 * drops.
 */
function decorSlot(label, glyph, { wide = false, short = false, cls = '' } = {}) {
  const cell = el('div', { class: `slot-cell slot-cell--decor ${cls}` });
  const head = el('div', { class: 'slot__head' }, el('span', { class: 'slot__name' }, label));
  head.append(el('span', { class: 'slot__more is-decor' }, icon('chev-right')));
  cell.append(head);
  const node = el('div', { class: `slot is-empty is-decor${short ? ' slot--short' : ''}` });
  node.style.width = `calc(var(--cell) * ${wide ? 4 : 2} + 2px)`;
  node.style.height = short ? `calc(var(--cell) * 0.7 + 2px)` : `calc(var(--cell) * 2 + 2px)`;
  if (glyph) node.append(el('div', { class: 'slot__hint' }, glyph === 'spec' ? el('span', { class: 'slot__spec' }, 'SPEC') : icon(glyph)));
  cell.append(node);
  return cell;
}

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
// Two panels, as in the game: the character screen is where you dress the
// PMC — every slot plus the pockets — and the inventory panel beside it is
// where the rig and the bags open up so you can actually shuffle loot.
// ---------------------------------------------------------
export function renderGearSlots(equipment, host, opts = {}) {
  host.replaceChildren();
  const doll = el('div', { class: 'equip' });

  // what is worn on the body, on the character screen's own four-row grid
  const body = el('div', { class: 'equip__body' });
  body.append(icon('pmc', 'equip__pmc'));
  for (const d of SLOT_DEFS) {
    if (d.carry) continue;
    const cell = renderSlot(equipment.slots[d.key], d);
    cell.style.gridArea = d.area;
    body.append(cell);
  }
  // row two, column one: ARMBAND over DOGTAG, as on the real screen
  const aux = el('div', { class: 'equip__aux' },
    decorSlot('ARMBAND', 'g-armband', { short: true }),
    decorSlot('DOGTAG', 'g-dogtag', { short: true, cls: 'slot-cell--dogtag' }));
  aux.style.gridArea = 'aux';
  body.append(aux);

  // what is carried: the rig, then the pockets, then the bags — the pockets
  // belong here rather than in the inventory panel, because they are part of
  // the character and not something you can take off
  const carry = el('div', { class: 'equip__carry' });
  const slotCell = (key) => {
    const d = SLOT_DEFS.find((s) => s.key === key);
    return renderSlot(equipment.slots[key], d);
  };
  carry.append(slotCell('rig'));

  const pockets = el('div', { class: 'slot-cell slot-cell--pockets' },
    el('div', { class: 'slot__head' }, el('span', { class: 'slot__name' }, 'POCKETS')));
  const row = el('div', { class: 'pockets' });
  for (const g of equipment.pockets) row.append(renderGrid(g, opts));
  pockets.append(row);
  carry.append(pockets);
  // SPECIAL SLOTS: three cells with the game's SPEC watermark; nothing here fills them
  const special = el('div', { class: 'slot-cell slot-cell--special' },
    el('div', { class: 'slot__head' }, el('span', { class: 'slot__name' }, 'SPECIAL SLOTS')));
  const srow = el('div', { class: 'pockets pockets--special' });
  for (let i = 0; i < 3; i++) {
    const c = el('div', { class: 'slot is-empty is-decor slot--spec' }, el('div', { class: 'slot__hint' }, el('span', { class: 'slot__spec' }, 'SPEC')));
    c.style.width = 'calc(var(--cell) + 2px)';
    c.style.height = 'calc(var(--cell) + 2px)';
    srow.append(c);
  }
  special.append(srow);
  carry.append(special);

  carry.append(slotCell('backpack'), slotCell('secure'));

  doll.append(body, carry);
  host.append(doll);
}

export function renderCarry(equipment, host, opts = {}) {
  host.replaceChildren();

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
