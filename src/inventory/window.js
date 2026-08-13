// =========================================================
// floating container windows
//
// Double-clicking a backpack, rig or case opens its grids in a small draggable
// panel so items can be dragged straight into it. Several can be open at once
// and they re-render with the rest of the inventory.
// =========================================================

import { $, el, icon, fmtWeight } from '../core/util.js';
import { renderGrid } from './view.js';
import { sfx } from '../core/audio.js';

/** uid -> { item, node, body } */
const open = new Map();
let host = null;
let cascade = 0;

function ensureHost() {
  if (host) return host;
  host = $('#container-windows');
  if (!host) {
    host = el('div', { id: 'container-windows', class: 'cwin-layer' });
    document.body.append(host);
  }
  return host;
}

export function openContainerWindow(item) {
  if (!item || !item.isContainer) return null;
  const existing = open.get(item.uid);
  if (existing) {
    bringToFront(existing.node);
    flash(existing.node);
    return existing.node;
  }

  const layer = ensureHost();
  const node = el('div', { class: 'cwin', dataset: { uid: item.uid } });

  const head = el('div', { class: 'cwin__head' },
    icon(item.cat === 'secure' ? 'stash' : 'box'),
    el('span', { class: 'cwin__title' }, item.tpl.name),
    el('span', { class: 'cwin__meta' }, ''),
    el('button', {
      class: 'cwin__close', title: 'Close',
      onclick: (e) => { e.stopPropagation(); closeContainerWindow(item.uid); },
    }, icon('close', 'ico ico--sm')));

  const body = el('div', { class: 'cwin__body' });
  node.append(head, body);

  // cascade so a stack of windows stays reachable
  const step = 26;
  const i = cascade++ % 8;
  node.style.left = `${90 + i * step}px`;
  node.style.top = `${110 + i * step}px`;

  makeDraggable(node, head);
  node.addEventListener('pointerdown', () => bringToFront(node), true);

  layer.append(node);
  open.set(item.uid, { item, node, body });
  bringToFront(node);
  renderOne(item, node, body);
  sfx.tab();
  return node;
}

export function closeContainerWindow(uid) {
  const rec = open.get(uid);
  if (!rec) return;
  rec.node.remove();
  open.delete(uid);
  sfx.click();
}

export function closeAllContainerWindows() {
  for (const uid of Array.from(open.keys())) {
    const rec = open.get(uid);
    rec.node.remove();
    open.delete(uid);
  }
}

export function anyContainerWindowOpen() { return open.size > 0; }

/** re-render every open window; windows whose item has vanished close themselves */
export function refreshContainerWindows() {
  for (const [uid, rec] of Array.from(open.entries())) {
    if (!rec.item.holder) { rec.node.remove(); open.delete(uid); continue; }
    renderOne(rec.item, rec.node, rec.body);
  }
}

function renderOne(item, node, body) {
  body.replaceChildren();
  for (const g of item.grids) {
    const wrap = el('div', { class: 'cwin__grid' });
    if (item.grids.length > 1) {
      wrap.append(el('div', { class: 'cwin__gridlabel' }, `${g.w}x${g.h}`));
    }
    wrap.append(renderGrid(g));
    body.append(wrap);
  }
  let used = 0, cap = 0;
  for (const g of item.grids) { used += g.usedCells(); cap += g.capacity; }
  node.querySelector('.cwin__meta').textContent = `${used}/${cap} · ${fmtWeight(item.weight)} kg`;

  // nested containers get a hint that they can be opened too
  for (const g of item.grids) {
    for (const child of g.items()) {
      if (child.isContainer) {
        const tile = node.querySelector(`.item[data-uid="${child.uid}"]`);
        if (tile) tile.classList.add('item--openable');
      }
    }
  }
}

function flash(node) {
  node.classList.remove('is-flash');
  void node.offsetWidth;
  node.classList.add('is-flash');
}

let zTop = 700;
function bringToFront(node) {
  node.style.zIndex = String(++zTop);
}

function makeDraggable(node, handle) {
  let sx = 0, sy = 0, ox = 0, oy = 0, dragging = false;
  handle.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    if (e.button !== 0) return;
    dragging = true;
    sx = e.clientX; sy = e.clientY;
    const r = node.getBoundingClientRect();
    ox = r.left; oy = r.top;
    handle.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  handle.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const nx = Math.max(4, Math.min(window.innerWidth - 120, ox + e.clientX - sx));
    const ny = Math.max(4, Math.min(window.innerHeight - 60, oy + e.clientY - sy));
    node.style.left = `${nx}px`;
    node.style.top = `${ny}px`;
  });
  const end = (e) => {
    if (!dragging) return;
    dragging = false;
    try { handle.releasePointerCapture(e.pointerId); } catch { /* fine */ }
  };
  handle.addEventListener('pointerup', end);
  handle.addEventListener('pointercancel', end);
}
