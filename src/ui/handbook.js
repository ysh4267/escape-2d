// =========================================================
// the handbook
//
// Every item you have examined, filed by kind: the list on the left, what
// the selected one is on the right - its picture, its description, the
// handbook price traders work their offers out from. What you have not
// examined yet is listed as unknown, as the game lists it.
// =========================================================

import { $, el, fmtNum, debounce } from '../core/util.js';
import { on, EV } from '../core/events.js';
import { TPL, CAT_LABEL } from '../data/items.js';
import { isExamined } from '../core/state.js';
import { sfx } from '../core/audio.js';
import { Item } from '../inventory/model.js';
import { inspectDialog } from '../inventory/dialogs.js';

let cat = null;
let query = '';
let selected = null;

const ORDER = ['weapon', 'pistol', 'melee', 'grenade', 'mod', 'mag', 'ammo', 'ammobox', 'armor', 'plate', 'helmet',
  'headset', 'glasses', 'facecover', 'armband', 'rig', 'backpack', 'container', 'secure', 'meds', 'food', 'drink',
  'barter', 'electronics', 'valuables', 'fuel', 'special', 'key', 'info', 'money'];

function groups() {
  const by = new Map();
  for (const t of Object.values(TPL)) {
    if (t.quest) continue;
    if (!by.has(t.cat)) by.set(t.cat, []);
    by.get(t.cat).push(t);
  }
  const keys = [...by.keys()].sort((a, b) => {
    const ia = ORDER.indexOf(a), ib = ORDER.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
  });
  return keys.map((k) => ({ key: k, label: CAT_LABEL[k] || k, items: by.get(k).sort((a, b) => a.name.localeCompare(b.name)) }));
}

export function renderHandbook() {
  const host = $('#handbook-host');
  if (!host) return;
  host.replaceChildren();
  const gs = groups();
  if (!cat || !gs.some((g) => g.key === cat)) cat = gs[0]?.key || null;

  const left = el('div', { class: 'hb__cats' }, el('div', { class: 'msg__title' }, 'HANDBOOK'));
  for (const g of gs) {
    const known = g.items.filter((t) => isExamined(t.key)).length;
    const b = el('button', { class: `hb-cat${g.key === cat && !query ? ' is-active' : ''}`, dataset: { sfx: 'own' } },
      el('span', {}, g.label), el('em', {}, `${known}/${g.items.length}`));
    b.addEventListener('click', () => { cat = g.key; query = ''; selected = null; sfx.ui('click'); renderHandbook(); });
    left.append(b);
  }

  const search = el('input', { class: 'hb__search', type: 'text', placeholder: 'Search', value: query, spellcheck: 'false', autocomplete: 'off' });
  search.addEventListener('input', debounce(() => { query = search.value.trim().toLowerCase(); selected = null; renderHandbook(); $('.hb__search')?.focus(); }, 180));

  let items;
  if (query) {
    items = Object.values(TPL).filter((t) => !t.quest && isExamined(t.key) && (`${t.name} ${t.short || ''}`).toLowerCase().includes(query))
      .sort((a, b) => a.name.localeCompare(b.name)).slice(0, 300);
  } else items = gs.find((g) => g.key === cat)?.items || [];

  const mid = el('div', { class: 'hb__list' }, search);
  const rows = el('div', { class: 'hb__rows' });
  for (const t of items) {
    const known = isExamined(t.key);
    const r = el('button', { class: `hb-row${selected === t.key ? ' is-active' : ''}${known ? '' : ' is-unknown'}`, dataset: { sfx: 'own' } },
      el('span', { class: 'hb-row__name' }, known ? t.name : 'Unknown item'),
      el('span', { class: 'hb-row__price' }, known ? `${fmtNum(t.price || 0)} ₽` : ''));
    r.addEventListener('click', () => { selected = t.key; sfx.ui('click'); renderHandbook(); });
    rows.append(r);
  }
  if (!items.length) rows.append(el('div', { class: 'tl-empty' }, 'Nothing found'));
  mid.append(rows);

  const right = el('div', { class: 'hb__detail' });
  const t = selected ? TPL[selected] : null;
  if (t && isExamined(t.key)) {
    right.append(
      el('div', { class: 'hb__name' }, t.name),
      el('div', { class: 'hb__art' }, t.imgUrl ? el('img', { src: t.presetImgUrl || t.imgUrl, alt: '' }) : null),
      el('div', { class: 'hb__meta' }, `${CAT_LABEL[t.cat] || t.cat} · ${t.w}x${t.h} · ${fmtNum(t.price || 0)} ₽`),
      el('div', { class: 'hb__desc' }, t.desc || ''),
      el('button', {
        class: 'ebtn ebtn--sm', dataset: { sfx: 'own' },
        onclick: () => { try { const it = new Item(t.key, { examined: true }); it.virtual = true; inspectDialog(it); } catch { /* template gone */ } },
      }, 'INSPECT'));
  } else {
    right.append(el('div', { class: 'tl-empty' }, t ? 'Examine this item to learn about it' : 'Select an item'));
  }
  host.append(left, mid, right);
}

export function initHandbook() {
  on(EV.SCREEN_CHANGED, (id) => { if (id === 'handbook') renderHandbook(); });
}
