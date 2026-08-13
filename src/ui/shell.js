// =========================================================
// screen switching, top bar, toasts
// =========================================================

import { $, $$, el, icon, fmtNum } from '../core/util.js';
import { on, emit, EV } from '../core/events.js';
import { game, countMoney } from '../core/state.js';

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

  for (const t of $$('#hideout-tabs .tab')) {
    t.addEventListener('click', () => showPane(t.dataset.tab));
  }
}

export function bootProgress(pct, label) {
  const fill = $('#boot-bar-fill');
  const status = $('#boot-status');
  if (fill) fill.style.width = `${Math.round(pct * 100)}%`;
  if (status && label) status.textContent = label;
}
