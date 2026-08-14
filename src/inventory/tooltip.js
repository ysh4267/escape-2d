// =========================================================
// hover tooltip for item tiles
// =========================================================

import { $, el, icon, fmtNum, fmtWeight } from '../core/util.js';
import { catLabel } from './view.js';
import { isKnown } from './examine.js';
import { on, EV } from '../core/events.js';

let node = null;
let hoverItem = null;
let hoverNode = null;
let raf = 0;
let lastX = 0, lastY = 0;

export function initTooltip() {
  node = $('#tooltip');
  document.addEventListener('pointerover', onOver, true);
  document.addEventListener('pointerout', onOut, true);
  document.addEventListener('pointermove', onMove, true);
  window.addEventListener('blur', hide);
  // a screen change tears the hovered tile out from under the pointer
  on(EV.SCREEN_CHANGED, hide);
}

function onOver(e) {
  const tile = e.target.closest?.('.item');
  if (!tile || !tile._item || tile.closest('.drag-layer')) return;
  if (document.body.classList.contains('is-dragging')) return;
  hoverItem = tile._item;
  hoverNode = tile;
  show(hoverItem);
}

function onOut(e) {
  const tile = e.target.closest?.('.item');
  if (!tile) return;
  if (e.relatedTarget && e.relatedTarget.closest?.('.item') === tile) return;
  hide();
}

function onMove(e) {
  lastX = e.clientX; lastY = e.clientY;
  if (document.body.classList.contains('is-dragging')) { hide(); return; }
  if (!hoverItem || node.hidden) return;
  // a re-render replaces the tile without ever sending a pointerout, which
  // left the tooltip trailing the cursor describing an item that is gone
  if (hoverNode && !hoverNode.isConnected) { hide(); return; }
  if (!raf) raf = requestAnimationFrame(place);
}

function place() {
  raf = 0;
  const r = node.getBoundingClientRect();
  let x = lastX + 16;
  let y = lastY + 16;
  if (x + r.width > window.innerWidth - 8) x = lastX - r.width - 14;
  if (y + r.height > window.innerHeight - 8) y = Math.max(8, window.innerHeight - r.height - 8);
  node.style.left = `${Math.max(8, x)}px`;
  node.style.top = `${y}px`;
}

export function hide() {
  hoverItem = null;
  hoverNode = null;
  if (node) node.hidden = true;
}

function row(dl, k, v) {
  dl.append(el('dt', {}, k), el('dd', {}, v));
}

function show(item) {
  const tpl = item.tpl;
  node.replaceChildren();

  if (!isKnown(item)) {
    node.append(
      el('div', { class: 'tooltip__head' },
        el('div', { class: 'tooltip__name' }, 'Unknown item'),
        el('div', { class: 'tooltip__short' }, 'NOT EXAMINED')),
      el('div', { class: 'tooltip__body' },
        el('div', { class: 'tooltip__desc' }, 'Examine this item to reveal its name, stats and value — right-click it, or double-click.')));
    node.hidden = false;
    place();
    return;
  }

  const head = el('div', { class: 'tooltip__head' },
    el('div', { class: 'tooltip__name' }, tpl.name),
    el('div', { class: 'tooltip__short' }, `${catLabel(tpl.cat)} · ${tpl.w}x${tpl.h}`));
  node.append(head);

  const body = el('div', { class: 'tooltip__body' });
  if (tpl.desc) body.append(el('div', { class: 'tooltip__desc' }, tpl.desc));

  const dl = el('dl', { class: 'tooltip__rows' });
  row(dl, 'WEIGHT', `${fmtWeight(item.weight)} kg`);
  if (item.stack > 1) row(dl, 'COUNT', fmtNum(item.stack));
  if (tpl.res && item.res != null) row(dl, 'RESOURCE', `${Math.round(item.res)} / ${tpl.res.max}`);
  if (tpl.dura != null && item.dura != null) row(dl, 'DURABILITY', `${Math.round(item.dura)} / ${tpl.dura}`);
  if (tpl.armorClass) row(dl, 'ARMOR CLASS', String(tpl.armorClass));
  if (tpl.armorMat) row(dl, 'MATERIAL', tpl.armorMat);
  if (tpl.heal) row(dl, 'HEAL RATE', `${tpl.heal} hp`);
  if (tpl.dmg) row(dl, 'DAMAGE', String(tpl.dmg));
  if (tpl.pen) row(dl, 'PENETRATION', String(tpl.pen));
  if (tpl.ergo) row(dl, 'ERGONOMICS', String(tpl.ergo));
  if (tpl.rpm) row(dl, 'FIRE RATE', `${tpl.rpm} rpm`);
  if (tpl.cal) row(dl, 'CALIBER', tpl.cal);
  if (tpl.uses) row(dl, 'USES LEFT', `${item.res ?? tpl.uses} / ${tpl.uses}`);
  if (tpl.speedPen) row(dl, 'SPEED', `${tpl.speedPen}%`);
  if (item.isContainer) {
    const cells = item.grids.reduce((n, g) => n + g.capacity, 0);
    const used = item.grids.reduce((n, g) => n + g.usedCells(), 0);
    row(dl, 'CAPACITY', `${used} / ${cells} cells`);
  }
  body.append(dl);
  node.append(body);

  const foot = el('div', { class: 'tooltip__foot' });
  foot.append(item.fir
    ? el('span', { class: 'tooltip__fir' }, icon('check', 'ico ico--sm'), 'FOUND IN RAID')
    : el('span', {}, ''));
  foot.append(el('span', { class: 'tooltip__value' }, `${fmtNum(item.value)} ₽`));
  node.append(foot);

  node.hidden = false;
  place();
}
