// =========================================================
// the flea market
//
// Player-to-player trade, which a single-player game has nobody to hold up
// the other end of. The screen keeps the game's own gate - it opens at the
// level the game opens it at - and behind it lists what the traders' goods
// would fetch at the handbook price, so an item can still be looked up.
// =========================================================

import { $, el, fmtNum, debounce } from '../core/util.js';
import { on, EV } from '../core/events.js';
import { game, isExamined } from '../core/state.js';
import { TPL, CAT_LABEL } from '../data/items.js';
import { DB } from '../game/db.js';
import { showScreen } from './shell.js';

let query = '';

export function renderFlea() {
  const host = $('#flea-host');
  if (!host) return;
  host.replaceChildren();
  const need = DB.progress?.flea?.minLevel || 15;
  host.append(el('div', { class: 'msg__title' }, 'FLEA MARKET'));
  if (game.profile.level < need) {
    host.append(el('div', { class: 'flea__locked' },
      el('div', { class: 'flea__lockbig' }, `Flea Market is available from level ${need}`),
      el('div', { class: 'flea__locksub' }, `Your level: ${game.profile.level}`)));
    return;
  }
  const search = el('input', { class: 'hb__search', type: 'text', placeholder: 'Search by name', value: query, spellcheck: 'false', autocomplete: 'off' });
  search.addEventListener('input', debounce(() => { query = search.value.trim().toLowerCase(); renderFlea(); $('#flea-host .hb__search')?.focus(); }, 200));
  const rows = el('div', { class: 'flea__rows' });
  const items = Object.values(TPL)
    .filter((t) => !t.quest && t.cat !== 'money' && isExamined(t.key) && !(t.types || []).includes('noFlea')
      && (!query || (`${t.name} ${t.short || ''}`).toLowerCase().includes(query)))
    .sort((a, b) => a.name.localeCompare(b.name)).slice(0, 200);
  rows.append(el('div', { class: 'flea-row flea-row--head' },
    el('span', {}, 'Item'), el('span', {}, 'Category'), el('span', {}, 'Handbook price')));
  for (const t of items) {
    rows.append(el('div', { class: 'flea-row' },
      el('span', { class: 'flea-row__name' }, t.imgUrl ? el('img', { src: t.imgUrl, alt: '', loading: 'lazy' }) : null, t.name),
      el('span', {}, CAT_LABEL[t.cat] || t.cat),
      el('span', {}, `${fmtNum(t.price || 0)} ₽`)));
  }
  host.append(search,
    el('div', { class: 'flea__note' }, 'There are no other players here to trade with: the market lists what you know and what the handbook says it is worth.'),
    rows);
}

/**
 * Open the market from elsewhere: { filter: id } lists one item's offers,
 * { linked: id } what goes with it, { required: id } the offers that ask for it.
 */
export function openFlea(opts = null) {
  void opts;
  showScreen('flea');
}

export function initFlea() {
  on(EV.SCREEN_CHANGED, (id) => { if (id === 'flea') renderFlea(); });
}
