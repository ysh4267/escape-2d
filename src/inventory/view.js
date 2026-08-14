// =========================================================
// DOM rendering for grids, item tiles and equipment slots
//
// every rendered node keeps a back-reference to its model
// (_grid / _item / _slot) so drag & drop can hit-test by element.
// =========================================================

import { el, icon, clear } from '../core/util.js';
import { CAT_LABEL } from '../data/items.js';
import { isKnown, examineProgress } from './examine.js';

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

  // this tile may be the replacement for one that was rendered away mid-drag
  if (document.body.dataset.dragUid === item.uid) node.classList.add('is-dragging');

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

  if (!isKnown(item)) {
    const veil = el('div', { class: 'item__unexamined' }, el('span', {}, '?'));
    const bar = el('div', { class: 'item__exambar' }, el('i', {}));
    veil.append(bar);
    node.append(veil);
    paintExamine(item, node);
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
 * One slot as the character screen draws it: a named header bar with a
 * chevron, and the outline underneath. Returns the wrapper — the drop target
 * is the `.slot` inside it, which is what drag & drop hit-tests for.
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
