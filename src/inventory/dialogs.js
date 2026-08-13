// =========================================================
// item context menu, split dialog, inspect window, confirm box
// =========================================================

import { $, el, icon, clamp, fmtNum, fmtWeight } from '../core/util.js';
import { hide as hideTooltip } from './tooltip.js';
import { catLabel } from './view.js';
import { isKnown } from './examine.js';
import { isDragging } from './dnd.js';
import { sfx } from '../core/audio.js';

// ---------------------------------------------------------
// context menu
// ---------------------------------------------------------
let ctxNode = null;
/** the screen sets this: (item, ev) => [{label, icon, key, danger, disabled, run}] */
export let contextProvider = () => [];
export function setContextProvider(fn) { contextProvider = fn; }

export function initContextMenu() {
  ctxNode = $('#context-menu');
  document.addEventListener('contextmenu', onContext, false);
  document.addEventListener('pointerdown', (e) => {
    if (!ctxNode.hidden && !e.target.closest('#context-menu')) closeContext();
  }, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeContext(); });
  window.addEventListener('resize', closeContext);
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

export function openContext(item, x, y) {
  const actions = contextProvider(item) || [];
  if (!actions.length) { closeContext(); return; }

  ctxNode.replaceChildren();
  ctxNode.append(el('div', { class: 'ctx__title' }, isKnown(item) ? item.tpl.name : 'Unknown item'));
  for (const a of actions) {
    if (a === '-') { ctxNode.append(el('div', { class: 'ctx__sep' })); continue; }
    const btn = el('button', {
      class: `ctx__item${a.danger ? ' ctx__item--danger' : ''}`,
      disabled: a.disabled || false,
      onclick: () => { sfx.ui('click'); closeContext(); a.run?.(); },
    }, icon(a.icon || 'info'), el('span', {}, a.label));
    if (a.key) btn.append(el('span', { class: 'ctx__key' }, a.key));
    ctxNode.append(btn);
  }
  ctxNode.hidden = false;
  sfx.ui('context');
  const r = ctxNode.getBoundingClientRect();
  ctxNode.style.left = `${Math.min(x, window.innerWidth - r.width - 8)}px`;
  ctxNode.style.top = `${Math.min(y, window.innerHeight - r.height - 8)}px`;
}

export function closeContext() {
  if (ctxNode) ctxNode.hidden = true;
}

// ---------------------------------------------------------
// modal shell
// ---------------------------------------------------------
export function openModal(build, opts = {}) {
  const root = $('#modal-root');
  root.replaceChildren();
  const box = el('div', { class: `modal ${opts.class || ''}` });
  build(box, close);
  root.append(box);
  root.hidden = false;
  sfx.ui('inspect_open');
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const onClick = (e) => { if (e.target === root && opts.dismissable !== false) close(); };
  document.addEventListener('keydown', onKey);
  root.addEventListener('pointerdown', onClick);

  function close() {
    document.removeEventListener('keydown', onKey);
    root.removeEventListener('pointerdown', onClick);
    root.hidden = true;
    root.replaceChildren();
    sfx.ui('inspect_close');
    opts.onClose?.();
  }
  return close;
}

export function confirmDialog({ title, body, confirmLabel = 'CONFIRM', danger = false }) {
  return new Promise((resolve) => {
    let settled = false;
    const close = openModal((box, done) => {
      box.append(
        el('div', { class: 'modal__head' }, title),
        el('div', { class: 'modal__body' }, body),
        el('div', { class: 'modal__foot' },
          el('button', { class: 'btn', onclick: () => { settled = true; done(); resolve(false); } }, 'CANCEL'),
          el('button', {
            class: `btn ${danger ? 'btn--danger' : 'btn--primary'}`,
            onclick: () => { settled = true; done(); resolve(true); },
          }, confirmLabel)));
    }, { onClose: () => { if (!settled) resolve(false); } });
    void close;
  });
}

// ---------------------------------------------------------
// split dialog
// ---------------------------------------------------------
export function splitDialog(item, onAccept) {
  const max = item.stack - 1;
  let value = Math.max(1, Math.floor(item.stack / 2));

  openModal((box, done) => {
    const field = el('input', {
      class: 'split__val', type: 'number', min: '1', max: String(max), value: String(value),
    });
    const range = el('input', { type: 'range', min: '1', max: String(max), value: String(value) });
    const sync = (v) => {
      value = clamp(Math.round(Number(v) || 1), 1, max);
      field.value = String(value);
      range.value = String(value);
    };
    field.addEventListener('input', () => sync(field.value));
    range.addEventListener('input', () => sync(range.value));

    box.classList.add('split');
    box.append(
      el('div', { class: 'modal__head' }, 'SPLIT'),
      el('div', { class: 'modal__body' },
        el('div', { class: 'split__row' }, field, range),
        el('div', { class: 'split__hint' },
          `${item.tpl.name} — ${fmtNum(item.stack)} in stack`)),
      el('div', { class: 'modal__foot' },
        el('button', { class: 'btn', onclick: () => done() }, 'CANCEL'),
        el('button', {
          class: 'btn btn--primary',
          onclick: () => { done(); onAccept(value); },
        }, 'ACCEPT')));
    setTimeout(() => field.select(), 30);
  });
}

// ---------------------------------------------------------
// inspect window
// ---------------------------------------------------------
export function inspectDialog(item) {
  const tpl = item.tpl;
  openModal((box, done) => {
    box.classList.add('inspect');
    const art = el('div', { class: 'inspect__art' });
    if (tpl.imgUrl) art.append(el('img', { src: tpl.imgUrl, alt: '' }));
    else art.append(el('div', { class: 'item__fallback' }, tpl.short));

    const dl = el('dl', { class: 'tooltip__rows' });
    const row = (k, v) => dl.append(el('dt', {}, k), el('dd', {}, v));
    row('CATEGORY', catLabel(tpl.cat));
    row('SIZE', `${tpl.w} x ${tpl.h}`);
    row('WEIGHT', `${fmtWeight(item.weight)} kg`);
    row('BASE VALUE', `${fmtNum(tpl.price)} ₽`);
    if (item.stack > 1) row('STACK', `${fmtNum(item.stack)} / ${fmtNum(tpl.stack)}`);
    if (tpl.res && item.res != null) row('RESOURCE', `${Math.round(item.res)} / ${tpl.res.max}`);
    if (tpl.dura != null && item.dura != null) row('DURABILITY', `${Math.round(item.dura)} / ${tpl.dura}`);
    if (tpl.armorClass) row('ARMOR CLASS', String(tpl.armorClass));
    if (tpl.dmg) row('DAMAGE', String(tpl.dmg));
    if (tpl.pen) row('PENETRATION', String(tpl.pen));
    if (tpl.cal) row('CALIBER', tpl.cal);
    row('FOUND IN RAID', item.fir ? 'yes' : 'no');

    box.append(
      el('div', { class: 'modal__head' }, tpl.name),
      el('div', { class: 'modal__body inspect__body' },
        art,
        el('div', { class: 'inspect__info' },
          tpl.desc ? el('div', { class: 'tooltip__desc' }, tpl.desc) : null,
          dl)),
      el('div', { class: 'modal__foot' },
        el('button', { class: 'btn btn--primary', onclick: () => done() }, 'CLOSE')));
  });
}
