// =========================================================
// DOM rendering for grids, item tiles and equipment slots
//
// every rendered node keeps a back-reference to its model
// (_grid / _item / _slot) so drag & drop can hit-test by element.
//
// A tile is drawn the way the client draws its own (the grid_layout and
// slot_layout prefabs): the item's render over a panel of the colour its
// template names, a 1 px frame, the short name in the top-right corner and,
// along the bottom, what there is to count - rounds in a magazine, a stack,
// what is left of a medkit, an armour's points - with the found-in-raid tick
// over it. Worn in a slot the same item is its render scaled to the slot,
// with the name in bold, what it is chambered for under the name, the count
// in large figures and its condition as a bar down the right edge.
// =========================================================

import { el, icon, clear } from '../core/util.js';
import { uiImg } from '../core/uiart.js';
import { CAT_LABEL } from '../data/items.js';
import { isKnown, examineProgress } from './examine.js';

/** px size of one inventory cell, read back from CSS */
export function cellSize(gridEl) {
  const model = gridEl._grid;
  const r = gridEl.getBoundingClientRect();
  return model && model.w ? r.width / model.w : 62;
}

// ---------------------------------------------------------
// what a tile counts
// ---------------------------------------------------------
const tidy = (n) => (Math.round(n * 10) / 10).toString();

/**
 * The figure in a tile's bottom-right corner and how worried it should look.
 * @returns {{ text: string, cur?: string, max?: string, cls: string, frac?: number } | null}
 */
export function itemValue(item) {
  const tpl = item.tpl;
  const state = (f) => (f <= 0.15 ? 'is-crit' : f <= 0.4 ? 'is-low' : '');
  if (item.isMag || (item.isWeapon && item.magazine)) {
    // the magazine's count, as in the game; the chambered round is on the
    // card, not on the tile (a "31/30" reads as an error)
    const mag = item.isMag ? item : item.magazine;
    const cap = mag.tpl.magSize || 0;
    return { text: `${mag.ammoCount}/${cap}`, cur: String(mag.ammoCount), max: String(cap), cls: mag.ammoCount ? '' : 'is-dry' };
  }
  if (item.stack > 1) return { text: formatStack(item.stack), cls: '' };
  if (tpl.res && item.res != null && tpl.res.max) {
    const f = item.res / tpl.res.max;
    return { text: `${tidy(item.res)}/${tpl.res.max}`, cur: tidy(item.res), max: String(tpl.res.max), cls: `is-res ${state(f)}`, frac: f };
  }
  if (!item.isWeapon && item.dura != null && item.maxDura) {
    const f = item.dura / item.maxDura;
    return { text: `${tidy(item.dura)}/${tidy(item.maxDura)}`, cur: tidy(item.dura), max: tidy(item.maxDura), cls: state(f), frac: f };
  }
  return null;
}

/** a gun's or an armour's condition, 0..1 against what it left the factory with; null for things that do not wear */
export function conditionOf(item) {
  const tpl = item.tpl;
  const full = tpl.wpn?.maxDura ?? tpl.dura;
  if (item.dura == null || !full) return null;
  return { now: Math.max(0, Math.min(1, item.dura / full)), ceiling: Math.max(0, Math.min(1, (item.maxDura ?? full) / full)) };
}

function formatStack(n) {
  if (n >= 1000000) return `${Math.round(n / 100000) / 10}M`;
  return String(n);
}

// ---------------------------------------------------------
// the picture
// ---------------------------------------------------------
/** a gun with parts on it is drawn assembled; the bare sprite is the receiver */
function pictureOf(item) {
  const tpl = item.tpl;
  const built = item.isWeapon && tpl.presetImgUrl && item.slots?.some((s) => s.item);
  return built ? { src: tpl.presetImgUrl, flat: !!tpl.presetFlat } : { src: tpl.imgUrl, flat: !!tpl.imgFlat };
}

// ---------------------------------------------------------
// item tile
// ---------------------------------------------------------
export function renderItem(item, opts = {}) {
  const tpl = item.tpl;
  const known = isKnown(item);
  const node = el('div', {
    class: 'item',
    // bg is Tarkov's own BackgroundColor for the template, so tiles read the
    // same way they do in the real inventory
    dataset: { uid: item.uid, cat: tpl.cat, bg: tpl.bg || 'default', val: String(tpl.tier ?? 0) },
  });
  node._item = item;

  // this tile may be the replacement for one that was rendered away mid-drag
  if (document.body.dataset.dragUid === item.uid) node.classList.add('is-dragging');

  if (!opts.static) {
    node.style.left = `calc(var(--cell) * ${opts.x || 0})`;
    node.style.top = `calc(var(--cell) * ${opts.y || 0})`;
  }
  node.style.width = `calc(var(--cell) * ${item.w})`;
  node.style.height = `calc(var(--cell) * ${item.h})`;

  const { src, flat } = pictureOf(item);
  // an older picture brings its own colour, frame and name with it
  if (flat) node.classList.add('item--flat');
  if (src) {
    const img = el('img', {
      class: 'item__img', src, alt: '', draggable: 'false', loading: 'lazy',
    });
    if (item.rot) {
      // The sprite is drawn for the unrotated footprint, so give the element the
      // unrotated box and spin it about its centre — a W x H box rotated 90 deg
      // lands exactly on the H x W tile.
      // `inset` must be cleared BEFORE left/top, or the shorthand wipes them.
      img.classList.add('is-rot');
      img.style.inset = 'auto';
      img.style.width = `calc(var(--cell) * ${item.fw})`;
      img.style.height = `calc(var(--cell) * ${item.fh})`;
      img.style.left = '50%';
      img.style.top = '50%';
      img.style.transform = 'translate(-50%, -50%) rotate(90deg)';
    }
    img.addEventListener('error', () => {
      img.remove();
      node.prepend(el('div', { class: 'item__fallback' }, tpl.short || tpl.name));
    }, { once: true });
    node.append(img);
  } else {
    node.append(el('div', { class: 'item__fallback' }, tpl.short || tpl.name));
  }

  if (known) {
    if (!flat && src && !opts.noName) node.append(el('div', { class: 'item__cap' }, tpl.short || tpl.name));
    // what a gun is chambered for, in the corner the client writes it in
    if (item.isWeapon && tpl.cal && item.w * item.h > 1) node.append(el('div', { class: 'item__ins' }, tpl.cal));
    const corner = el('div', { class: 'item__br' });
    if (item.fir) corner.append(uiImg('icon_foundinraid_small', 'item__fir', { w: 13, h: 12 }));
    const v = itemValue(item);
    if (v) corner.append(el('span', { class: `item__val ${v.cls}` }, v.text));
    if (corner.childNodes.length) node.append(corner);
  }

  // a gun missing a vital part is not a gun yet
  if (item.isWeapon && item.slots?.some((sl) => sl.required && !sl.item)) {
    node.classList.add('item--incomplete');
  }
  if (item.folded) node.classList.add('item--folded');

  if (!known) {
    const veil = el('div', { class: 'item__unexamined' }, el('span', {}, '?'));
    const bar = el('div', { class: 'item__exambar' }, el('i', {}));
    veil.append(bar);
    node.append(veil);
    paintExamine(item, node);
  }

  return node;
}

/**
 * The same item as it is drawn worn in a slot: scaled to the slot, with the
 * slot view's own labels. Still an `.item`, so it is picked up, right-clicked
 * and hovered like any other.
 */
export function renderSlotItem(item) {
  const tpl = item.tpl;
  const known = isKnown(item);
  const node = el('div', {
    class: 'item item--worn',
    dataset: { uid: item.uid, cat: tpl.cat, bg: tpl.bg || 'default', worn: '1' },
  });
  node._item = item;
  if (document.body.dataset.dragUid === item.uid) node.classList.add('is-dragging');

  const { src, flat } = pictureOf(item);
  if (src) {
    const img = el('img', { class: `item__wornimg${flat ? ' is-flat' : ''}`, src, alt: '', draggable: 'false' });
    img.addEventListener('error', () => img.remove(), { once: true });
    node.append(img);
  }
  if (known) {
    node.append(el('div', { class: 'item__wornname' }, tpl.short || tpl.name));
    if (item.isWeapon && tpl.cal) node.append(el('div', { class: 'item__worninfo' }, tpl.cal));
    const v = itemValue(item);
    const corner = el('div', { class: 'item__br' });
    if (item.fir) corner.append(uiImg('icon_foundinraid_small', 'item__fir', { w: 13, h: 12 }));
    if (v) {
      // a weapon's rounds are written large with the capacity small beside them
      if (item.isWeapon && v.cur != null) {
        corner.append(el('span', { class: `item__val item__val--big ${v.cls}` }, el('b', {}, v.cur), `/${v.max}`));
      } else corner.append(el('span', { class: `item__val ${v.cls}` }, v.text));
    }
    if (corner.childNodes.length) node.append(corner);
    // a gun's condition is a bar down the right edge: what is left, and in
    // red the part of the scale repairs have taken away for good
    const cond = item.isWeapon || tpl.cat === 'melee' ? conditionOf(item) : null;
    if (cond) {
      node.classList.add('has-cond');
      node.append(el('div', { class: `item__cond${cond.now <= 0.4 ? ' is-low' : ''}` },
        el('i', { class: 'item__condlost', style: { height: `${(1 - cond.ceiling) * 100}%` } }),
        el('i', { class: 'item__condnow', style: { height: `${cond.now * 100}%` } })));
    }
  } else {
    const veil = el('div', { class: 'item__unexamined' }, el('span', {}, '?'));
    veil.append(el('div', { class: 'item__exambar' }, el('i', {})));
    node.append(veil);
    paintExamine(item, node);
  }
  if (item.isWeapon && item.slots?.some((sl) => sl.required && !sl.item)) node.classList.add('item--incomplete');
  return node;
}

// ---------------------------------------------------------
// grid
// ---------------------------------------------------------
export function renderGrid(gridModel, opts = {}) {
  const node = el('div', { class: 'grid', dataset: { gid: gridModel.id } });
  node._grid = gridModel;
  node.style.width = `calc(var(--cell) * ${gridModel.w} + 2px)`;
  node.style.height = `calc(var(--cell) * ${gridModel.h} + 2px)`;

  for (const item of gridModel.items()) {
    const p = gridModel.posOf(item);
    if (!p) continue;
    const tile = renderItem(item, { x: p.x, y: p.y });
    // A filter must not delete tiles: the model still holds those cells, so a
    // hidden item silently blocks drops onto space that looks free, and a
    // stack dropped nearby merges into something invisible. Dim instead.
    if (opts.filterFn && !opts.filterFn(item)) tile.classList.add('is-filtered');
    node.append(tile);
  }
  return node;
}

/**
 * The grids of a rig, a backpack or a case, set out the way the client sets
 * them out: each grid where the item's layout puts it (tools/build_layouts.py
 * reads the layouts out of the client), or side by side when it has none.
 */
export function renderContainerGrids(item, opts = {}) {
  const place = item.tpl.container?.place;
  const wrap = el('div', { class: 'cgrids', dataset: { uid: item.uid } });
  if (place && place.pos.length === item.grids.length) {
    wrap.classList.add('cgrids--placed');
    wrap.style.width = `${place.w + 1}px`;
    wrap.style.height = `${place.h + 1}px`;
    item.grids.forEach((g, i) => {
      const node = renderGrid(g, opts);
      node.style.position = 'absolute';
      node.style.left = `${place.pos[i][0]}px`;
      node.style.top = `${place.pos[i][1]}px`;
      wrap.append(node);
    });
  } else {
    for (const g of item.grids) wrap.append(renderGrid(g, opts));
  }
  return wrap;
}

/**
 * A container item rendered as a titled block with all of its internal grids.
 * `depth` guards the recursion for nested containers.
 */
export function renderContainerBlock(item, opts = {}) {
  const wrap = el('div', { class: 'cnt', dataset: { uid: item.uid } });
  const head = el('div', { class: 'cnt__head' },
    icon(opts.icon || 'box'),
    el('span', { class: 'cnt__name' }, opts.title || item.tpl.name));

  let used = 0, cap = 0;
  for (const g of item.grids) { used += g.usedCells(); cap += g.capacity; }
  head.append(el('span', { class: 'cnt__fill' }, `${used}/${cap}`));
  wrap.append(head);

  const grids = el('div', { class: 'cnt__grids', style: { display: 'flex', flexWrap: 'wrap', gap: '4px' } });
  for (const g of item.grids) grids.append(renderGrid(g, opts));
  wrap.append(grids);

  // nested containers get their own block underneath
  if ((opts.depth ?? 0) < 2) {
    for (const g of item.grids) {
      for (const child of g.items()) {
        if (child.isContainer && !child.tpl.container?.hideNested) {
          wrap.append(renderContainerBlock(child, { ...opts, depth: (opts.depth ?? 0) + 1 }));
        }
      }
    }
  }
  return wrap;
}

/** a standalone titled grid (stash, loot container, ground) */
export function renderGridBlock(gridModel, title, opts = {}) {
  const wrap = el('div', { class: 'cnt' });
  if (title) {
    const head = el('div', { class: 'cnt__head' }, icon(opts.icon || 'stash'),
      el('span', { class: 'cnt__name' }, title));
    head.append(el('span', { class: 'cnt__fill' }, `${gridModel.usedCells()}/${gridModel.capacity}`));
    wrap.append(head);
  }
  wrap.append(renderGrid(gridModel, opts));
  return wrap;
}

// ---------------------------------------------------------
// equipment slot
// ---------------------------------------------------------
/**
 * One slot as the client's character screen draws it: the named header with
 * its arrow sitting over the top edge, and under it a box of a fixed size -
 * hatched with the outline of what belongs there while it is empty, and the
 * worn item scaled into it when it is not. The box is the drop target
 * (`.gslot`, with `_slot` on it); the returned node is the box with its
 * header.
 * @param {import('./model.js').Slot} slot
 * @param {{ label: string, ghost?: string, w?: number, h?: number, x?: number, y?: number, ghostW?: number, ghostH?: number, onArrow?: (item) => void, noArrow?: boolean }} def
 */
export function renderSlotView(slot, def) {
  const w = def.w || 125, h = def.h || 125;
  const cell = el('div', { class: 'gslotcell', dataset: { slot: slot.key } });
  if (def.x != null) { cell.style.left = `${def.x}px`; cell.style.top = `${def.y}px`; cell.style.position = 'absolute'; }
  cell.style.width = `${w}px`;

  const item = slot.item;
  // a special slot is a bare box: the three of them share one header
  if (!def.bare) {
    // in a raid the header is the name alone: the arrow and what it opens belong to the menus
    const head = el('button', { class: 'gslot__head', type: 'button', tabindex: '-1', disabled: !item || !!def.noArrow, dataset: { sfx: 'own' } },
      el('span', { class: 'gslot__name' }, def.label),
      def.noArrow ? null : el('span', { class: 'gslot__arrow' },
        uiImg('slot_selectedbutton_arrow_icon_idle', 'gslot__arrowidle', { w: 18, h: 18 }),
        uiImg('slot_selectedbutton_arrow_icon_selected', 'gslot__arrowhot', { w: 18, h: 18 })));
    head.addEventListener('click', (e) => {
      e.stopPropagation();
      if (slot.item) def.onArrow?.(slot.item, head);
    });
    cell.append(head);
  } else cell.classList.add('gslotcell--bare');

  const box = el('div', { class: `gslot${item ? ' is-full' : ' is-empty'}`, dataset: { slot: slot.key } });
  box._slot = slot;
  box.style.width = `${w}px`;
  box.style.height = `${h}px`;
  if (item) box.append(renderSlotItem(item));
  else if (def.ghost) box.append(uiImg(def.ghost, 'gslot__ghost', def.ghostW ? { w: def.ghostW, h: def.ghostH } : null));
  cell.append(box);
  return cell;
}

/**
 * The older slot: a named header bar with a chevron, and the outline
 * underneath, growing to whatever it holds. The raid's inventory overlay
 * still draws with it.
 */
export function renderSlot(slot, opts = {}) {
  const cell = el('div', { class: 'slot-cell' });
  if (opts.wide) cell.classList.add('slot-cell--wide');

  const node = el('div', { class: 'slot', dataset: { slot: slot.key } });
  node._slot = slot;
  if (slot.wide || opts.wide) node.classList.add('slot--wide');

  // A slot is at least its own outline and grows to whatever it holds, so worn
  // gear is drawn at exactly one stash cell per grid square. It used to be
  // stretched to fill the outline instead, which squashed a 5x2 rifle into a
  // 4x1 box and blew a 1x1 up to twice its size.
  const wCells = Math.max(opts.w || 2, slot.item ? slot.item.w : 0);
  const hCells = Math.max(opts.h || 2, slot.item ? slot.item.h : 0);
  // the long-gun bar spans two columns of the doll, so its width comes from
  // the grid; the cell count is only the floor that keeps a rifle at 1:1
  if (opts.wide) node.style.minWidth = `calc(var(--cell) * ${wCells} + 2px)`;
  else node.style.width = `calc(var(--cell) * ${wCells} + 2px)`;
  node.style.height = `calc(var(--cell) * ${hCells} + 2px)`;

  const head = el('div', { class: 'slot__head' },
    el('span', { class: 'slot__name' }, opts.label || slot.label));
  const chevron = el('button', {
    class: 'slot__more', type: 'button', tabindex: '-1',
    title: slot.item ? (slot.item.isContainer ? 'Open' : 'Inspect') : '',
    disabled: !slot.item,
    onclick: (e) => {
      e.stopPropagation();
      const it = slot.item;
      if (!it) return;
      // loaded lazily: view.js sits underneath both of these modules, and
      // importing them at the top would close the cycle
      if (it.isContainer) import('./window.js').then((m) => m.openContainerWindow(it));
      else import('./dialogs.js').then((m) => m.inspectDialog(it));
    },
  }, icon('chev-right'));
  head.append(chevron);
  cell.append(head);

  if (slot.item) {
    const tile = renderItem(slot.item, { static: true });
    tile.style.left = '50%';
    tile.style.top = '50%';
    tile.style.transform = 'translate(-50%, -50%)';
    node.append(tile);
  } else {
    node.classList.add('is-empty');
    node.append(el('div', { class: 'slot__hint' }, icon(slot.icon)));
  }
  cell.append(node);
  return cell;
}

// ---------------------------------------------------------
// hit testing helpers used by drag & drop
// ---------------------------------------------------------
export function gridCellAt(gridEl, clientX, clientY) {
  const r = gridEl.getBoundingClientRect();
  const model = gridEl._grid;
  const cw = (r.width - 2) / model.w;
  const ch = (r.height - 2) / model.h;
  return {
    x: Math.floor((clientX - r.left - 1) / cw),
    y: Math.floor((clientY - r.top - 1) / ch),
    cw, ch, rect: r,
  };
}

export function catLabel(cat) { return CAT_LABEL[cat] || cat; }

/** update the examination bar in place, so ticking does not rebuild the DOM */
export function paintExamine(item, root = document) {
  const p = examineProgress(item);
  // the tile itself may be the root: an Element has querySelectorAll, so the
  // descendant branch used to swallow that case and paint nothing
  const nodes = root instanceof Element && root.matches('.item')
    ? [root]
    : root.querySelectorAll(`.item[data-uid="${item.uid}"]`);
  for (const node of nodes) {
    const bar = node.querySelector('.item__exambar');
    if (!bar) continue;
    bar.classList.toggle('is-on', p > 0);
    bar.firstChild.style.width = `${Math.round(p * 100)}%`;
  }
}

export function clearHost(host) { clear(host); }
