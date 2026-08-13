// =========================================================
// item examination
//
// Most templates are known on sight (`known` in the item data, from the
// template's ExaminedByDefault flag). The rest — keys, rare electronics,
// high-value gear — come out of a container as "Unknown item" and have to be
// inspected before their name, stats and value are revealed.
//
// Only one examination runs at a time, as in the real game, and the result is
// stored per profile rather than per item: examine one LEDX and every LEDX you
// ever find is recognised.
// =========================================================

import { markExamined, isExamined, addExp } from '../core/state.js';
import { emit, EV } from '../core/events.js';

const DEFAULT_TIME = 1.0;
const DEFAULT_XP = 5;

let active = null;   // { item, startedAt, duration, onChange, timer }
let rafId = 0;

/** an item is readable if its template is known or the profile has seen one */
export function isKnown(item) {
  if (!item) return false;
  if (item.examined) return true;
  const tpl = item.tpl;
  if (tpl.known || tpl.alwaysExamined) return true;
  return isExamined(tpl.key);
}

export function needsExamine(item) {
  return !!item && !isKnown(item);
}

export function examining() { return active ? active.item : null; }

export function examineProgress(item) {
  if (!active || active.item !== item) return 0;
  return Math.min(1, (performance.now() - active.startedAt) / (active.duration * 1000));
}

/**
 * Begin examining an item. Returns false if it is already known or another
 * examination is running.
 */
export function startExamine(item, onChange) {
  if (!needsExamine(item)) return false;
  if (active) {
    emit(EV.TOAST, { kind: 'warn', text: 'Already examining something' });
    return false;
  }
  const tpl = item.tpl;
  const duration = Math.max(0.2, tpl.examineTime || DEFAULT_TIME);
  active = {
    item,
    startedAt: performance.now(),
    duration,
    onChange: onChange || (() => {}),
    // completion is driven by a timer rather than the animation frame, so an
    // examination still finishes if the tab is backgrounded and rAF stops
    timer: setTimeout(finish, duration * 1000),
  };
  if (!rafId) rafId = requestAnimationFrame(repaint);
  active.onChange();
  return true;
}

export function cancelExamine() {
  if (!active) return;
  clearTimeout(active.timer);
  const cb = active.onChange;
  active = null;
  cb();
}

function finish() {
  if (!active) return;
  const { item, onChange } = active;
  active = null;
  // the item may have been discarded or sold mid-examination
  if (!item.holder) { onChange(); return; }
  item.examined = true;
  markExamined(item.tpl.key);
  addExp(item.tpl.examineXp || DEFAULT_XP);
  emit(EV.TOAST, { kind: 'ok', text: `Item examined: ${item.tpl.name}` });
  onChange();
}

/** purely cosmetic: keeps the progress bar moving while one is running */
function repaint() {
  rafId = 0;
  if (!active) return;
  active.onChange();
  rafId = requestAnimationFrame(repaint);
}
