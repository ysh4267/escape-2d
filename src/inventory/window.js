// =========================================================
// floating windows
//
// The client opens a container, and an item's details, in a small window that
// floats over whatever screen is up: black, a thin frame, a caption bar with
// a glyph and the name on it and a box at its end to shut it. They are
// dragged by the bar, several can be open at once, the one last touched is on
// top, and each redraws with the rest of the inventory.
//
// A container's window (the client's Grid Window) holds its grids, set out as
// the item's own layout sets them, with a button on the bar that sorts them.
// =========================================================

import { toStage, stageW, stageH } from '../core/stage.js';
import { $, el } from '../core/util.js';
import { renderContainerGrids } from './view.js';
import { sfx } from '../core/audio.js';
import { uiImg } from '../core/uiart.js';
import { isKnown } from './examine.js';

/** key -> { item, node, body, paint } */
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

/**
 * Put up a window, or bring the one already up for `key` to the front.
 * @param {{ key: string, item?: any, title: string, icon?: string, cls?: string, tools?: Node[],
 *           paint: (body: HTMLElement, node: HTMLElement) => void, onClose?: () => void, quiet?: boolean }} o
 */
export function openWindow(o) {
  const existing = open.get(o.key);
  if (existing) {
    bringToFront(existing.node);
    flash(existing.node);
    return existing.node;
  }
  const layer = ensureHost();
  const node = el('div', { class: `cwin ${o.cls || ''}`, dataset: { key: o.key } });
  const close = el('button', { class: 'wclose', type: 'button', dataset: { sfx: 'own' } }, uiImg('close_window_x', '', { w: 9, h: 11 }));
  close.addEventListener('click', (e) => { e.stopPropagation(); closeWindow(o.key); });
  const title = el('span', { class: 'cwin__title' }, o.title);
  const head = el('div', { class: 'cwin__head' },
    uiImg(o.icon || 'icon_search', 'cwin__ico', { w: 17, h: 17 }), title, ...(o.tools || []), close);
  const body = el('div', { class: 'cwin__body' });
  node.append(head, body);

  // cascade so a stack of windows stays reachable
  const step = 26;
  const i = cascade++ % 8;
  node.style.left = `${o.x ?? 90 + i * step}px`;
  node.style.top = `${o.y ?? 110 + i * step}px`;

  makeDraggable(node, head);
  node.addEventListener('pointerdown', () => bringToFront(node), true);

  layer.append(node);
  open.set(o.key, { item: o.item || null, node, body, title, paint: o.paint, onClose: o.onClose, name: o.name });
  bringToFront(node);
  o.paint(body, node);
  keepOnStage(node);
  return node;
}

export function closeWindow(key, quiet = false) {
  const rec = open.get(key);
  if (!rec) return;
  rec.node.remove();
  open.delete(key);
  rec.onClose?.();
  if (!quiet) sfx.ui('close');
}

export function openContainerWindow(item) {
  if (!item || !item.isContainer) return null;
  const was = open.has(item.uid);
  const sort = el('button', { class: 'cwin__tool', type: 'button', dataset: { sfx: 'own' } }, uiImg('icon_sort_small', '', { w: 19, h: 14 }));
  sort.addEventListener('click', (e) => {
    e.stopPropagation();
    sfx.ui('click');
    for (const g of item.grids) g.sort();
    refreshContainerWindows();
    changed?.();
  });
  const node = openWindow({
    key: item.uid, item, cls: 'cwin--grid', tools: [sort],
    title: isKnown(item) ? item.tpl.name : '',
    paint: (body) => body.replaceChildren(renderContainerGrids(item)),
  });
  // the lid the container's own material would make
  if (!was) sfx.openContainer(item.cat === 'secure' ? 'safe' : item.cat === 'backpack' ? 'sportbag' : 'suitcase');
  return node;
}

/** told by the screen that owns the inventory, so a sort in a window is saved like any other move */
let changed = null;
export function onWindowChange(fn) { changed = fn; }

export function closeContainerWindow(uid) { closeWindow(uid); }

export function closeAllContainerWindows() {
  for (const key of Array.from(open.keys())) closeWindow(key, true);
}

/**
 * A window is only valid while its item can still be traced to a live root
 * (a slot, or a top-level grid like the stash). Checking `holder` alone
 * missed nested cases: a pouch inside a sold backpack keeps its holder, but
 * the whole chain is orphaned.
 */
function isLive(item) {
  let cur = item;
  let guard = 0;
  while (cur && guard++ < 12) {
    const h = cur.holder;
    if (!h) return false;
    if (h.kind === 'slot') return true;
    if (h.kind === 'mod') { cur = h.slot.owner; continue; }   // a part rides with its gun
    if (!h.grid.owner) return true;   // stash / pocket / loot / trading table
    cur = h.grid.owner;
  }
  return false;
}

/** other floating panels (the modding screen) hook in here to re-render with the rest */
const refreshers = new Set();
export function registerWindowRefresher(fn) { refreshers.add(fn); return () => refreshers.delete(fn); }

/** re-render every open window; windows whose item has vanished close themselves */
export function refreshContainerWindows() {
  for (const [key, rec] of Array.from(open.entries())) {
    if (rec.item && !rec.loose && !isLive(rec.item)) { closeWindow(key, true); continue; }
    rec.paint(rec.body, rec.node);
  }
  for (const fn of refreshers) fn();
}

/** a window on something that is in no inventory - a trader's goods, a reward - is not shut for being nowhere */
export function keepLoose(key) { const rec = open.get(key); if (rec) rec.loose = true; }

export { isLive, makeDraggable, bringToFront, ensureHost, flash };

function flash(node) {
  node.classList.remove('is-flash');
  void node.offsetWidth;
  node.classList.add('is-flash');
}

let zTop = 700;
function bringToFront(node) {
  node.style.zIndex = String(++zTop);
}

/** a window opened near an edge is pulled back onto the screen */
function keepOnStage(node) {
  const w = node.offsetWidth, h = node.offsetHeight;
  node.style.left = `${Math.max(4, Math.min(node.offsetLeft, stageW() - w - 4))}px`;
  node.style.top = `${Math.max(4, Math.min(node.offsetTop, stageH() - Math.min(h, 200) - 4))}px`;
}

function makeDraggable(node, handle) {
  let sx = 0, sy = 0, ox = 0, oy = 0, dragging = false;
  handle.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    if (e.button !== 0) return;
    dragging = true;
    sx = e.clientX; sy = e.clientY;
    ox = node.offsetLeft; oy = node.offsetTop;
    handle.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  handle.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    // the pointer moves in window pixels; the window moves on the stage
    const nx = Math.max(4 - node.offsetWidth + 120, Math.min(stageW() - 120, ox + toStage(e.clientX - sx)));
    const ny = Math.max(4, Math.min(stageH() - 60, oy + toStage(e.clientY - sy)));
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
