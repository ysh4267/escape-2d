// =========================================================
// the item context menu, and the small windows: confirm, split
//
// All three are the client's own (ItemContextMenu, ConfirmationWindow and
// Split Dialog in its interface dump):
//
//   the menu    rows 18 px tall two apart on a dark plate, each the action's
//               glyph and its name; the row under the pointer dark red;
//               ADD TO WISHLIST teal with an arrow and a second menu beside
//               it; DISCARD red and set apart under a rule
//   confirm     a black window under a caption bar, the question in the
//               middle, YES (Y) and NO (N) under it; Y and N answer it
//   split       a slider with the count in a box beside it and ACCEPT
// =========================================================

import { toStage, stageW, stageH } from '../core/stage.js';
import { $, el, clamp } from '../core/util.js';
import { hide as hideTooltip } from './tooltip.js';
import { isKnown } from './examine.js';
import { isDragging } from './dnd.js';
import { sfx } from '../core/audio.js';
import { on, EV } from '../core/events.js';
import { t, tOr } from '../core/i18n.js';
import { uiImg, hasUi } from '../core/uiart.js';

// ---------------------------------------------------------
// context menu
// ---------------------------------------------------------
let ctxNode = null;
let subNode = null;
/** the screen sets this: (item) => [{ label, icon, disabled, run, kind?, sub? } | '-'] */
export let contextProvider = () => [];
export function setContextProvider(fn) { contextProvider = fn; }

/** the glyphs the older call sites named, as the client's own */
const OLD_ICON = {
  info: 'inspect', eye: 'examine', box: 'open', health: 'use', check: 'equip', crosshair: 'modding', rotate: 'fold',
  cart: 'loadammo', sell: 'unload', split: 'unpack', discard: 'discard', back: 'unequip',
};

export function initContextMenu() {
  ctxNode = $('#context-menu');
  subNode = el('div', { class: 'ctx ctx--sub', id: 'context-submenu', hidden: true });
  ctxNode.after(subNode);
  ctxNode.classList.add('ctx');
  document.addEventListener('contextmenu', onContext, false);
  document.addEventListener('pointerdown', (e) => {
    if (!ctxNode.hidden && !e.target.closest('#context-menu, #context-submenu')) closeContext();
  }, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeContext(); });
  window.addEventListener('resize', closeContext);
  // The menu is position:fixed, so scrolling the panel underneath slides a
  // different item under it while its actions still point at the first one.
  // This listens for the wheel rather than for `scroll`: assigning scrollTop
  // (which every re-render does, to keep the panels where the player left
  // them) queues a scroll event too, and that was closing menus the player
  // had only just opened. Dragging a scrollbar is already covered, because it
  // starts with a pointerdown outside the menu.
  document.addEventListener('wheel', closeContext, true);
  // The menu is built from closures over one screen's item, trader and
  // dndContext. A pane switch by keyboard, or a raid ending on its own, left
  // it floating over the next screen with every entry still live — DROP on the
  // result screen could delete loot the summary had already banked.
  on(EV.SCREEN_CHANGED, closeContext);
}

function onContext(e) {
  // right button during a drag means "rotate the carried item" — the menu
  // popping up over the drag would swallow the drop
  if (isDragging()) { e.preventDefault(); e.stopPropagation(); return; }
  const tile = e.target.closest('.item');
  if (!tile || !tile._item) { closeContext(); return; }
  e.preventDefault();
  e.stopPropagation();
  hideTooltip();
  openContext(tile._item, e.clientX, e.clientY);
}

/** one row of a menu */
function rowOf(a, onPick) {
  const name = OLD_ICON[a.icon] || a.icon;
  const btn = el('button', {
    class: `ctx__row${a.kind ? ` ctx__row--${a.kind}` : ''}`, type: 'button', disabled: !!a.disabled, dataset: { sfx: 'own' },
  },
  el('span', { class: 'ctx__ico' }, name && hasUi(name) ? uiImg(name, '', { w: 16, h: 16 }) : null),
  el('span', { class: 'ctx__label' }, a.label),
  a.sub ? uiImg('submenu_arrow', 'ctx__arrow', { w: 9, h: 11 }) : null);
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (a.sub) return;
    sfx.ui('click');
    onPick(a);
  });
  return btn;
}

function fill(node, actions, onPick) {
  node.replaceChildren();
  let last = null;
  for (const a of actions) {
    // a rule only ever stands before DISCARD, which brings its own
    if (a === '-') continue;
    const row = rowOf(a, onPick);
    if (a.kind === 'discard' || a.kind === 'unwish') node.append(el('i', { class: 'ctx__rule' }));
    if (a.sub) {
      row.addEventListener('pointerenter', () => openSub(row, a.sub, onPick));
    } else row.addEventListener('pointerenter', () => { if (node === ctxNode) closeSub(); });
    node.append(row);
    last = row;
  }
  return last;
}

function place(node, x, y) {
  node.hidden = false;
  node.style.left = `${Math.max(4, Math.min(x, stageW() - node.offsetWidth - 4))}px`;
  node.style.top = `${Math.max(4, Math.min(y, stageH() - node.offsetHeight - 4))}px`;
}

export function openContext(item, x, y) {
  const actions = (contextProvider(item) || []).filter(Boolean);
  if (!actions.some((a) => a !== '-')) { closeContext(); return; }
  closeSub();
  const pick = (a) => { closeContext(); a.run?.(); };
  fill(ctxNode, actions, pick);
  sfx.ui('context');
  // opened at the pointer, which is in window pixels; the menu lives on the
  // stage, and comes up with the pointer inside its first row
  place(ctxNode, toStage(x) - 38, toStage(y) - 9);
}

function openSub(anchor, actions, onPick) {
  fill(subNode, actions, onPick);
  const a = anchor.getBoundingClientRect();
  const m = ctxNode.getBoundingClientRect();
  subNode.hidden = false;
  // beside the menu, its first row level with the row that opened it: to the
  // right where there is room, to the left where there is not
  const w = subNode.offsetWidth;
  let x = toStage(m.right) + 8;
  if (x + w > stageW() - 4) x = toStage(m.left) - w - 8;
  place(subNode, x, toStage(a.top) - 5);
}

function closeSub() { if (subNode) subNode.hidden = true; }

export function closeContext() {
  if (ctxNode) ctxNode.hidden = true;
  closeSub();
}

// ---------------------------------------------------------
// modal shell
// ---------------------------------------------------------
/**
 * Only one modal is ever on screen. Opening a second used to leave the first
 * one's keydown and pointerdown listeners bound to the document forever —
 * and the survivor's close() would then hide the newcomer.
 */
let closeOpen = null;

export function openModal(build, opts = {}) {
  if (closeOpen) closeOpen();

  const root = $('#modal-root');
  root.replaceChildren();
  const box = el('div', { class: `modal ${opts.class || ''}` });
  build(box, close);
  // a window is shut by the box at the end of its caption bar, as the client's are
  const head = box.querySelector(':scope > .modal__head');
  if (head && opts.dismissable !== false && !head.querySelector('.wclose')) {
    const x = el('button', { class: 'wclose', type: 'button', dataset: { sfx: 'own' } }, uiImg('close_window_x', '', { w: 9, h: 11 }));
    x.addEventListener('click', () => close());
    head.append(x);
  }
  root.append(box);
  root.hidden = false;
  sfx.ui('inspect_open');
  const onKey = (e) => {
    if (e.key === 'Escape' && opts.dismissable !== false) close();
    else opts.onKey?.(e, close);
  };
  const onClick = (e) => { if (e.target === root && opts.dismissable !== false && !opts.sticky) close(); };
  document.addEventListener('keydown', onKey);
  root.addEventListener('pointerdown', onClick);
  let done = false;
  closeOpen = close;

  function close() {
    if (done) return;                       // Escape + a button both firing
    done = true;
    if (closeOpen === close) closeOpen = null;
    document.removeEventListener('keydown', onKey);
    root.removeEventListener('pointerdown', onClick);
    root.hidden = true;
    root.replaceChildren();
    sfx.ui('inspect_close');
    opts.onClose?.();
  }
  return close;
}

/**
 * The client's question window: a caption, the question, YES (Y) and NO (N).
 * `confirmLabel` and `danger` are what older call sites passed; the answer is
 * always yes or no, as it is in the game.
 * @returns {Promise<boolean>}
 */
export function confirmDialog({ title, body, single = false }) {
  return new Promise((resolve) => {
    let settled = false;
    openModal((box, done) => {
      const answer = (yes) => { settled = true; done(); resolve(yes); };
      const yes = el('button', { class: 'dbtn dbtn--24 msgwin__btn', type: 'button' }, single ? 'OK' : t('YES (Y)'));
      yes.addEventListener('click', () => answer(true));
      const no = single ? null : el('button', { class: 'dbtn dbtn--24 msgwin__btn', type: 'button' }, t('NO (N)'));
      no?.addEventListener('click', () => answer(false));
      box.classList.add('msgwin');
      box.append(
        el('div', { class: 'modal__head' }, el('span', {}, title || tOr('ALERT', 'Alert'))),
        el('div', { class: 'msgwin__text' }, body),
        el('div', { class: 'msgwin__btns' }, yes, no));
      box._answer = answer;
    }, {
      sticky: true,
      onClose: () => { if (!settled) resolve(false); },
      onKey: (e) => {
        const box = $('#modal-root .msgwin');
        if (!box?._answer) return;
        if (e.key === 'y' || e.key === 'Y' || e.key === 'ㅛ' || e.key === 'Enter') box._answer(true);
        else if (!single && (e.key === 'n' || e.key === 'N' || e.key === 'ㅜ')) box._answer(false);
      },
    });
  });
}

// ---------------------------------------------------------
// split dialog
// ---------------------------------------------------------
export function splitDialog(item, onAccept) {
  const max = item.stack - 1;
  let value = Math.max(1, Math.floor(item.stack / 2));

  openModal((box, done) => {
    const field = el('input', { class: 'splitwin__val', type: 'text', inputmode: 'numeric', value: String(value), spellcheck: 'false' });
    const handle = el('span', { class: 'splitwin__handle' }, uiImg('arrow_up_tiny', '', { w: 6, h: 5 }));
    const track = el('div', { class: 'splitwin__track' }, el('i', {}), handle);
    const paint = () => { handle.style.left = `${max > 1 ? ((value - 1) / (max - 1)) * 100 : 0}%`; };
    const sync = (v, fromField = false) => {
      value = clamp(Math.round(Number(v) || 1), 1, max);
      if (!fromField || String(value) !== field.value) field.value = String(value);
      paint();
    };
    const at = (e) => {
      const r = track.getBoundingClientRect();
      sync(1 + ((e.clientX - r.left) / r.width) * (max - 1));
    };
    track.addEventListener('pointerdown', (e) => {
      track.setPointerCapture(e.pointerId);
      at(e);
      const move = (ev) => at(ev);
      const up = () => { track.removeEventListener('pointermove', move); track.removeEventListener('pointerup', up); };
      track.addEventListener('pointermove', move);
      track.addEventListener('pointerup', up);
    });
    field.addEventListener('input', () => sync(field.value, true));
    field.addEventListener('blur', () => { field.value = String(value); });
    const accept = el('button', { class: 'wbtn splitwin__ok', type: 'button' }, t('ACCEPT'));
    accept.addEventListener('click', () => { done(); onAccept(value); });
    field.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') accept.click(); if (e.key === 'Escape') done(); });

    box.classList.add('splitwin');
    box.append(
      el('div', { class: 'modal__head' }, el('span', {}, t('SPLIT'))),
      el('div', { class: 'splitwin__panel' }, track, field),
      accept);
    paint();
    setTimeout(() => field.select(), 30);
  });
}

/** what the confirm window says before something is destroyed for good */
export function destroyPrompt(item) {
  return t('Are you sure you want to destroy {0}?', isKnown(item) ? item.tpl.name : tOr('Unknown item', 'Unknown item'));
}

// the inspector moved out to a window of its own; this keeps the old import working
export { inspectDialog } from './inspect.js';
