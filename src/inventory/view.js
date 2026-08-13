// =========================================================
// DOM rendering for grids, item tiles and equipment slots
//
// every rendered node keeps a back-reference to its model
// (_grid / _item / _slot) so drag & drop can hit-test by element.
// =========================================================

import { el, icon, clear } from '../core/util.js';
import { CAT_LABEL } from '../data/items.js';

/** px size of one inventory cell, read back from CSS */
export function cellSize(gridEl) {
  const model = gridEl._grid;
  const r = gridEl.getBoundingClientRect();
  return model && model.w ? r.width / model.w : 62;
}

// ---------------------------------------------------------
// item tile
// ---------------------------------------------------------
export function renderItem(item, opts = {}) {
  const tpl = item.tpl;
  const node = el('div', {
    class: 'item',
    // bg is Tarkov's own BackgroundColor for the template, so tiles read the
    // same way they do in the real inventory
    dataset: { uid: item.uid, cat: tpl.cat, bg: tpl.bg || 'default', val: String(tpl.tier ?? 0) },
  });
  node._item = item;

  if (!opts.static) {
    node.style.left = `calc(var(--cell) * ${opts.x || 0})`;
    node.style.top = `calc(var(--cell) * ${opts.y || 0})`;
  }
  node.style.width = `calc(var(--cell) * ${item.w})`;
  node.style.height = `calc(var(--cell) * ${item.h})`;

  if (tpl.imgUrl) {
    const img = el('img', {
      class: 'item__img', src: tpl.imgUrl, alt: '', draggable: 'false', loading: 'lazy',
    });
    if (item.rot) {
      // The sprite is drawn for the unrotated footprint, so give the element the
      // unrotated box and spin it about its centre — a W x H box rotated 90 deg
      // lands exactly on the H x W tile.
      // `inset` must be cleared BEFORE left/top, or the shorthand wipes them.
      img.classList.add('is-rot');
      img.style.inset = 'auto';
      img.style.width = `calc(var(--cell) * ${tpl.w})`;
      img.style.height = `calc(var(--cell) * ${tpl.h})`;
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

  // tarkov.dev grid sprites already carry the short name in the corner, so the
  // name strip is only needed when we are falling back to a text tile
  if (!tpl.imgUrl && item.w * item.h > 1 && !opts.noName) {
    node.append(el('div', { class: 'item__name' }, tpl.short || tpl.name));
  }

  // stack counter
  if (item.stack > 1) {
    node.append(el('div', { class: 'item__stack' }, formatStack(item.stack)));
  }

  // found-in-raid marker
  if (item.fir) {
    const tag = el('div', { class: 'item__tag' });
    const f = icon('check', 'item__fir');
    f.setAttribute('title', 'Found in raid');
    tag.append(f);
    node.append(tag);
  }

  // resource / durability bar
  const bar = resourceBar(item);
  if (bar) node.append(bar);

  // container fill badge
  if (item.isContainer) {
    let used = 0, cap = 0;
    for (const g of item.grids) { used += g.usedCells(); cap += g.capacity; }
    node.append(el('div', { class: 'item__cnt-badge' }, `${used}/${cap}`));
  }

  if (!item.examined) {
    node.append(el('div', { class: 'item__unexamined' }, '?'));
  }

  return node;
}

function formatStack(n) {
  if (n >= 1000000) return `${Math.round(n / 100000) / 10}M`;
  if (n >= 10000) return `${Math.round(n / 1000)}k`;
  return String(n);
}

function resourceBar(item) {
  const tpl = item.tpl;
  if (tpl.res && item.res != null && tpl.res.max) {
    const f = item.res / tpl.res.max;
    return barNode('res', f);
  }
  if (tpl.dura != null && item.dura != null) {
    const f = item.dura / tpl.dura;
    return barNode('dura', f);
  }
  return null;
}

function barNode(kind, frac) {
  const cls = `item__bar item__bar--${kind}` +
    (frac <= 0.15 ? ' is-crit' : frac <= 0.4 ? ' is-low' : '');
  const b = el('div', { class: cls });
  b.append(el('i', { style: { width: `${Math.max(0, Math.min(1, frac)) * 100}%` } }));
  return b;
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
    if (opts.filterFn && !opts.filterFn(item)) continue;
    node.append(renderItem(item, { x: p.x, y: p.y }));
  }
  return node;
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
export function renderSlot(slot, opts = {}) {
  const node = el('div', { class: 'slot', dataset: { slot: slot.key } });
  node._slot = slot;
  if (slot.wide) node.classList.add('slot--wide');

  const wCells = opts.w || 2;
  const hCells = opts.h || 1;
  node.style.width = `calc(var(--cell) * ${wCells} + 2px)`;
  node.style.height = `calc(var(--cell) * ${hCells} + 2px)`;

  node.append(el('div', { class: 'slot__label' }, slot.label));
  if (slot.item) {
    const tile = renderItem(slot.item, { x: 0, y: 0 });
    // fit oversized gear into the slot box
    tile.style.width = '100%';
    tile.style.height = '100%';
    tile.style.left = '0';
    tile.style.top = '0';
    node.append(tile);
  } else {
    node.append(el('div', { class: 'slot__hint' }, icon(slot.icon)));
  }
  return node;
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

export function clearHost(host) { clear(host); }
