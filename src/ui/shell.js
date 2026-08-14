// =========================================================
// screen switching, top bar, toasts
// =========================================================

import { $, $$, el, icon, fmtNum } from '../core/util.js';
import { on, emit, EV } from '../core/events.js';
import { game, countMoney } from '../core/state.js';
import { sfx } from '../core/audio.js';

let current = 'boot';

export function showScreen(id) {
  for (const s of $$('.screen')) s.classList.toggle('is-active', s.id === `screen-${id}`);
  current = id;
  emit(EV.SCREEN_CHANGED, id);
}

export function currentScreen() { return current; }

export function showPane(name) {
  for (const p of $$('.pane')) p.classList.toggle('is-active', p.id === `pane-${name}`);
  for (const t of $$('#hideout-tabs .tab')) t.classList.toggle('is-active', t.dataset.tab === name);
  emit(EV.SCREEN_CHANGED, `hideout:${name}`);
}

export function refreshTopbar() {
  $('#stat-rub').textContent = fmtNum(countMoney('RUB'));
  $('#stat-usd').textContent = fmtNum(countMoney('USD'));
  $('#stat-eur').textContent = fmtNum(countMoney('EUR'));
  $('#stat-level').textContent = String(game.profile.level);
}

// ---------------------------------------------------------
const ICON_FOR = { ok: 'check', warn: 'warn', bad: 'warn', info: 'info' };

export function toast(text, kind = 'info', ttl = 2600) {
  // only the refusals get a cue; a chime on every confirmation would nag
  if (kind === 'warn' || kind === 'bad') sfx.ui('error');
  const host = $('#toasts');
  const node = el('div', { class: `toast toast--${kind}` }, icon(ICON_FOR[kind] || 'info'), el('span', {}, text));
  host.append(node);
  setTimeout(() => {
    node.classList.add('is-out');
    setTimeout(() => node.remove(), 220);
  }, ttl);
  while (host.children.length > 5) host.firstElementChild.remove();
}

export function raidToast(text, kind = 'info', ttl = 2400) {
  const host = $('#raid-toast');
  const node = el('div', { class: `raid-toast__row${kind !== 'info' ? ` is-${kind}` : ''}` }, text);
  host.append(node);
  setTimeout(() => node.remove(), ttl);
  while (host.children.length > 4) host.firstElementChild.remove();
}

export function initShell() {
  on(EV.TOAST, (p) => toast(p.text, p.kind || 'info'));
  on(EV.RAID_TOAST, (p) => raidToast(p.text, p.kind || 'info'));
  on(EV.INVENTORY_CHANGED, refreshTopbar);
  on(EV.LEVEL_UP, () => sfx.ui('exp'));

  for (const t of $$('#hideout-tabs .tab')) {
    t.addEventListener('click', () => { sfx.ui('click'); showPane(t.dataset.tab); });
    t.addEventListener('pointerenter', () => sfx.ui('hover'));
  }

  // every button in the shell answers to the pointer the same way; anything
  // carrying data-sfx plays its own cue instead and is skipped here
  // pointerenter is dispatched at every element entered along the ancestor
  // chain, and a capture listener on the document hears all of them — so
  // sliding from a card's artwork onto its caption replayed the cue for a
  // control the pointer never left. Only speak up when the control changes.
  let lastHover = null;
  document.addEventListener('pointerenter', (e) => {
    const b = e.target instanceof Element ? e.target.closest('.btn, .seg, .ttab, .map-card') : null;
    if (b && !b.disabled && b !== lastHover) { lastHover = b; sfx.ui('hover'); }
  }, true);
  // cleared by identity, not by closest(): the inner leaves fire first and
  // would otherwise reset the tracker just before the next enter
  document.addEventListener('pointerleave', (e) => {
    if (e.target === lastHover) lastHover = null;
  }, true);
  document.addEventListener('click', (e) => {
    const b = e.target instanceof Element ? e.target.closest('.btn, .seg, .map-card') : null;
    if (b && !b.disabled && !b.dataset.sfx) sfx.ui('click');
  }, true);
}

export function bootProgress(pct, label) {
  const fill = $('#boot-bar-fill');
  const status = $('#boot-status');
  if (fill) fill.style.width = `${Math.round(pct * 100)}%`;
  if (status && label) status.textContent = label;
}
