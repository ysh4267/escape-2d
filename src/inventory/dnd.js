// =========================================================
// pointer-driven drag & drop for the grid inventory
//
//  - grab anchors on the cell you actually clicked, like Tarkov
//  - R rotates the carried item mid-drag
//  - drop preview is green (fits), amber (single-item swap) or red (blocked)
//  - Esc or a drop on nothing returns the item to where it came from
// =========================================================

import { $, el } from '../core/util.js';
import { renderItem, gridCellAt } from './view.js';
import { moveToGrid, moveToSlot, autoPlace, detach, splitStack } from './model.js';
import { emit, EV } from '../core/events.js';

const DRAG_THRESHOLD = 4;

export const dndContext = {
  /** grids an item should fly to on ctrl+click, in priority order */
  quickTargets: () => [],
  /** called after any successful mutation */
  onChange: () => {},
  /** optional guard: return false to forbid moving this item right now */
  canMove: () => true,
  /** alt+click: return the Slot this item should be equipped into, or null */
  equipSlotFor: () => null,
  /** ctrl+drag onto a free cell: ask the UI for a split amount */
  requestSplit: null,
  /** double-click: open a container, or quick-transfer anything else */
  onActivate: null,
};

let pending = null;   // { item, node, startX, startY }
let drag = null;      // active drag state
let ghostSlot = null;

export function initDnd() {
  document.addEventListener('pointerdown', onPointerDown, true);
  document.addEventListener('pointermove', onPointerMove, true);
  document.addEventListener('pointerup', onPointerUp, true);
  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('dblclick', onDoubleClick, true);

  suppressNativeMenu();
}

/**
 * Kill the browser context menu everywhere except text fields.
 *
 * This has to sit on `window` in the CAPTURE phase: a bubble-phase listener on
 * `document` runs last, so anything that calls stopPropagation on the way up
 * leaves the native menu to open on top of the game's own menu.
 */
export function suppressNativeMenu() {
  const handler = (e) => {
    const t = e.target;
    const editable = t instanceof HTMLInputElement
      || t instanceof HTMLTextAreaElement
      || (t instanceof HTMLElement && t.isContentEditable);
    if (editable) return;
    e.preventDefault();
  };
  window.addEventListener('contextmenu', handler, true);
  document.addEventListener('contextmenu', handler, true);
}

function onDoubleClick(e) {
  const node = e.target.closest('.item');
  if (!node || !node._item) return;
  e.preventDefault();
  e.stopPropagation();
  dndContext.onActivate?.(node._item);
}

function onPointerDown(e) {
  // right button while carrying something rotates it, so rotation needs no key
  if (e.button === 2 && drag) {
    e.preventDefault();
    e.stopPropagation();
    rotateDrag();
    return;
  }
  if (e.button !== 0) return;
  const node = e.target.closest('.item');
  if (!node || !node._item) return;
  if (node.closest('.drag-layer')) return;
  const item = node._item;
  if (!dndContext.canMove(item)) return;

  // alt+click = quick equip into the matching character slot
  if (e.altKey) {
    e.preventDefault();
    e.stopPropagation();
    const slot = dndContext.equipSlotFor(item);
    if (slot) {
      const res = moveToSlot(item, slot);
      if (res.ok) dndContext.onChange();
      else emit(EV.TOAST, { kind: 'warn', text: 'Slot is not empty' });
    }
    return;
  }

  pending = {
    item, node, startX: e.clientX, startY: e.clientY,
    pointerId: e.pointerId, ctrl: e.ctrlKey || e.metaKey,
  };
}

function onPointerMove(e) {
  if (pending && !drag) {
    if (Math.abs(e.clientX - pending.startX) + Math.abs(e.clientY - pending.startY) < DRAG_THRESHOLD) return;
    beginDrag(e);
  }
  if (!drag) return;
  e.preventDefault();
  updateDrag(e.clientX, e.clientY);
}

function onPointerUp(e) {
  if (drag) {
    e.preventDefault();
    e.stopPropagation();
    commitDrag(e);
  } else if (pending && pending.ctrl) {
    // ctrl+click without a drag: quick transfer
    e.preventDefault();
    e.stopPropagation();
    quickTransfer(pending.item);
  }
  pending = null;
}

function rotateDrag() {
  if (!drag || !drag.item.canRotate) return;
  drag.rot = drag.rot ? 0 : 1;
  rebuildGhost();
  updateDrag(drag.lastX, drag.lastY);
}

function onKeyDown(e) {
  if (!drag) return;
  if (e.key === 'r' || e.key === 'R' || e.key === 'ㄱ') {
    e.preventDefault();
    rotateDrag();
  } else if (e.key === 'Escape') {
    e.preventDefault();
    cancelDrag();
  }
}

// ---------------------------------------------------------
function beginDrag(e) {
  const { item, node } = pending;
  const rect = node.getBoundingClientRect();
  const cw = rect.width / item.w;
  const ch = rect.height / item.h;

  // Tarkov anchors the carried item by its TOP-LEFT cell to the cell under the
  // cursor; the sub-cell grab offset is deliberately discarded.
  drag = {
    item,
    node,
    rot: item.rot,
    ctrl: pending.ctrl,
    cw, ch,
    target: null,
    lastX: e.clientX,
    lastY: e.clientY,
    ghost: null,
  };
  pending = null;

  node.classList.add('is-dragging');
  document.body.classList.add('is-dragging');
  rebuildGhost();
}

function rebuildGhost() {
  const layer = $('#drag-layer');
  if (drag.ghost) drag.ghost.remove();
  const item = drag.item;
  const prevRot = item.rot;
  item.rot = drag.rot;
  const tile = renderItem(item, { static: true });
  item.rot = prevRot;

  const wrap = el('div', { class: 'drag-item' });
  wrap.style.width = `${drag.cw * (drag.rot ? item.tpl.h : item.tpl.w)}px`;
  wrap.style.height = `${drag.ch * (drag.rot ? item.tpl.w : item.tpl.h)}px`;
  tile.style.width = '100%';
  tile.style.height = '100%';
  wrap.append(tile);
  layer.append(wrap);
  drag.ghost = wrap;
}

function updateDrag(x, y) {
  drag.lastX = x; drag.lastY = y;
  // top-left of the carried item sits on the cursor cell
  drag.ghost.style.left = `${x - drag.cw / 2}px`;
  drag.ghost.style.top = `${y - drag.ch / 2}px`;

  clearHighlights();
  drag.target = null;

  const under = document.elementFromPoint(x, y);
  if (!under) return;

  const gridEl = under.closest('.grid');
  if (gridEl && gridEl._grid) {
    const model = gridEl._grid;
    const { x: tx, y: ty } = gridCellAt(gridEl, x, y);
    const item = drag.item;

    const fits = model.canPlace(item, tx, ty, drag.rot, { ignore: item });
    const blocking = model.overlapping(item, tx, ty, drag.rot, item);
    const mergeable = blocking && blocking !== 'many' && blocking.canStackWith(item);
    const splitting = drag.ctrl && item.stack > 1 && fits && !!dndContext.requestSplit;
    let kind = 'is-bad';
    if (splitting) kind = 'is-swap';
    else if (fits || mergeable) kind = 'is-ok';

    showGhostSlot(gridEl, tx, ty, drag.rot, kind);
    drag.target = { kind: 'grid', grid: model, x: tx, y: ty, ok: kind !== 'is-bad', split: splitting };
    return;
  }

  const slotEl = under.closest('.slot');
  if (slotEl && slotEl._slot) {
    const ok = slotEl._slot.canAccept(drag.item);
    slotEl.classList.add(ok ? 'is-ok' : 'is-bad');
    drag.target = { kind: 'slot', slot: slotEl._slot, el: slotEl, ok };
  }
}

function showGhostSlot(gridEl, x, y, rot, kind) {
  if (!ghostSlot) ghostSlot = el('div', { class: 'ghost-slot' });
  const item = drag.item;
  const w = rot ? item.tpl.h : item.tpl.w;
  const h = rot ? item.tpl.w : item.tpl.h;
  ghostSlot.className = `ghost-slot ${kind}`;
  ghostSlot.style.left = `calc(var(--cell) * ${x})`;
  ghostSlot.style.top = `calc(var(--cell) * ${y})`;
  ghostSlot.style.width = `calc(var(--cell) * ${w})`;
  ghostSlot.style.height = `calc(var(--cell) * ${h})`;
  gridEl.append(ghostSlot);
  gridEl.classList.add('is-dragover');
}

function clearHighlights() {
  if (ghostSlot && ghostSlot.parentNode) {
    ghostSlot.parentNode.classList.remove('is-dragover');
    ghostSlot.remove();
  }
  for (const n of document.querySelectorAll('.slot.is-ok, .slot.is-bad')) {
    n.classList.remove('is-ok', 'is-bad');
  }
}

function commitDrag(e) {
  const { item, target } = drag;
  const rot = drag.rot;
  const ctrl = drag.ctrl || (e && (e.ctrlKey || e.metaKey));
  let changed = false;

  if (target && target.ok) {
    if (target.kind === 'grid' && target.split && ctrl) {
      const { grid, x, y } = target;
      endDrag();
      dndContext.requestSplit(item, (count) => {
        const copy = splitStack(item, count);
        if (!copy) return;
        if (grid.canPlace(copy, x, y, rot)) grid.place(copy, x, y, rot);
        else {
          const spot = grid.findSpot(copy);
          if (spot) grid.place(copy, spot.x, spot.y, spot.rot);
          else { item.stack += copy.stack; return; }
        }
        dndContext.onChange();
      });
      return;
    }
    if (target.kind === 'grid') {
      const res = moveToGrid(item, target.grid, target.x, target.y, rot);
      changed = res.ok;
      if (!res.ok) emit(EV.TOAST, { kind: 'warn', text: 'No room there' });
    } else if (target.kind === 'slot') {
      const res = moveToSlot(item, target.slot);
      changed = res.ok;
      if (!res.ok) emit(EV.TOAST, { kind: 'warn', text: 'Slot is not empty' });
    }
  } else if (target && !target.ok) {
    emit(EV.TOAST, { kind: 'warn', text: target.kind === 'slot' ? 'Wrong slot' : 'Blocked' });
  }

  endDrag();
  if (changed) dndContext.onChange();
}

function cancelDrag() { endDrag(); }

function endDrag() {
  clearHighlights();
  if (drag) {
    drag.ghost?.remove();
    drag.node?.classList.remove('is-dragging');
  }
  document.body.classList.remove('is-dragging');
  drag = null;
  pending = null;
}

// ---------------------------------------------------------
export function quickTransfer(item) {
  const targets = dndContext.quickTargets(item) || [];
  if (!targets.length) return false;
  const from = item.holder;
  const before = item.stack;
  if (autoPlace(item, targets)) {
    dndContext.onChange();
    return true;
  }
  if (item.stack !== before) { dndContext.onChange(); return true; }
  if (from) emit(EV.TOAST, { kind: 'warn', text: 'No space' });
  return false;
}

export function isDragging() { return !!drag; }

export function abortDrag() { if (drag) cancelDrag(); }

export { detach };
