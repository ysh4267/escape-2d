// =========================================================
// hover tooltip for item tiles
//
// The client's ItemTooltip: the item's full name on a small black plate by
// the pointer and nothing else - what the item weighs and does is on its own
// window (INSPECT), not on a card that follows the cursor.
// =========================================================

import { toStage, stageW, stageH } from '../core/stage.js';
import { $ } from '../core/util.js';
import { isKnown } from './examine.js';
import { on, EV } from '../core/events.js';
import { tOr } from '../core/i18n.js';

let node = null;
let hoverItem = null;
let hoverNode = null;
let raf = 0;
let lastX = 0, lastY = 0;

export function initTooltip() {
  node = $('#tooltip');
  node.classList.add('itip');
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
  node.textContent = isKnown(hoverItem) ? hoverItem.tpl.name : tOr('Item is not examined', 'Unknown item');
  node.hidden = false;
  place();
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
  // the pointer is in window pixels, the plate is placed on the stage
  const w = node.offsetWidth, h = node.offsetHeight;
  const px = toStage(lastX), py = toStage(lastY);
  let x = px + 14;
  let y = py + 18;
  if (x + w > stageW() - 6) x = px - w - 10;
  if (y + h > stageH() - 6) y = py - h - 10;
  node.style.left = `${Math.max(6, x)}px`;
  node.style.top = `${Math.max(6, y)}px`;
}

export function hide() {
  hoverItem = null;
  hoverNode = null;
  if (node) node.hidden = true;
}

/** what a med or a ration does, as the item's window lists it */
export function medRows(tpl, row) {
  const m = tpl.med;
  if (!m) return false;
  const NAMES = { lb: 'light bleeding', hb: 'heavy bleeding', fr: 'fracture', ct: 'concussion', dp: 'destroyed part' };
  if (m.t) row('USE TIME', `${m.t}s`);
  if (m.rate) row('HEALS', `up to ${m.rate} hp per use`);
  const rm = m.rm || {};
  const removes = Object.keys(rm).map((k) => NAMES[k] + (rm[k].cost ? ` (${rm[k].cost})` : '')).filter(Boolean);
  if (m.hemo) removes.push(`all bleeding for ${m.hemo}s`);
  if (removes.length) row('REMOVES', removes.join(', '));
  if (rm.dp) row('RESTORES', `${rm.dp.min}–${rm.dp.max}% of the part`);
  if (m.pk) row('PAINKILLER', `${Math.round(m.pk / 60)}m ${m.pk % 60 ? (m.pk % 60) + 's' : ''}`.trim());
  if (m.eh) {
    const bits = [];
    if (m.eh.en) bits.push(`energy ${m.eh.en > 0 ? '+' : ''}${m.eh.en}`);
    if (m.eh.hy) bits.push(`hydration ${m.eh.hy > 0 ? '+' : ''}${m.eh.hy}`);
    if (bits.length) row('EFFECT', bits.join(', '));
  }
  if (m.buff === 'BuffsPropital') row('STIM', 'regeneration 5m, tremor late');
  if (m.buff === 'BuffsAdrenaline') row('STIM', 'stamina 1m, quick regen');
  if (m.buff === 'BuffsZagustin') row('STIM', 'tremor late');
  return true;
}
