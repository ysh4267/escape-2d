// =========================================================
// the stage
//
// The game's interface is drawn for a 1920 x 1080 screen and scaled whole to
// whatever it is shown on; nothing in it reflows. This does the same: the
// page is one stage, laid out in those pixels, and scaled by a single factor
// so the 1920 x 1080 frame always fits the window. A window that is wider or
// taller than 16:9 gives the stage the extra room (the raid view uses it;
// the menu screens centre their frame in it).
//
// Anything that places an element from a pointer event has to come through
// here: the event is in window pixels, the element lives in stage pixels.
// =========================================================

import { emit } from './events.js';

export const DESIGN_W = 1920;
export const DESIGN_H = 1080;

let k = 1;

/** stage pixels per window pixel, inverted: window = stage * scale */
export function stageScale() { return k; }

/** a window coordinate (clientX / clientY, a rect edge) in stage pixels */
export const toStage = (v) => v / k;

/** the size of the stage, in its own pixels */
export const stageW = () => window.innerWidth / k;
export const stageH = () => window.innerHeight / k;

function fit() {
  const next = Math.min(window.innerWidth / DESIGN_W, window.innerHeight / DESIGN_H) || 1;
  if (Math.abs(next - k) < 1e-4) return false;
  k = next;
  document.documentElement.style.setProperty('--k', String(k));
  return true;
}

export function initStage() {
  fit();
  let t = 0;
  window.addEventListener('resize', () => {
    if (!fit()) return;
    // the scale changed under every canvas and every measured layout
    clearTimeout(t);
    t = setTimeout(() => emit('stage:resize', k), 60);
  });
}
