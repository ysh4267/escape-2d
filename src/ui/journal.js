// =========================================================
// the character screen's TASKS tab: the journal
//
// The client's TasksScreen, off its hierarchy and 1080p captures of 1.1:
//
//   left   STORY / SIDE / OPERATIONAL and a search box, then the table of
//          tasks in hand - trader, type, class, name, location, status and
//          progress, a row 100 px tall. The headings sort the table; the
//          strip at a row's left end pins it to the top. A press on a row
//          opens it in place: the picture and what the trader said, the
//          objectives a bar each, what was handed over to do it with and
//          what comes back. Nothing is handed in here - that is the trader's
//          own TASKS tab.
//   right  the task items: what is on the character, and what is in the
//          stash kept for them.
//
// STORY is the main questline; until the story is told here its page is the
// client's empty one. OPERATIONAL is the daily and weekly work, which this
// game does not hand out.
// =========================================================

import { $, el } from '../core/util.js';
import { game, saveSoon } from '../core/state.js';
import { t } from '../core/i18n.js';
import { uiImg } from '../core/uiart.js';
import { sfx } from '../core/audio.js';
import { artUrl, getTpl } from '../data/items.js';
import { Item } from '../inventory/model.js';
import { renderItem } from '../inventory/view.js';
import { DB } from '../game/db.js';
import { activeTasks, QS } from '../game/quests.js';
import { taskBody, taskLocation, taskPercent, typeIcon } from './tasks-ui.js';

let sub = 'side';
let query = '';
let pinnedOnly = false;
let sort = { col: 'status', down: true };
let open = null;

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI'];

/** the tasks pinned to the top of the table, kept with the profile */
function pins() {
  const p = game.profile;
  if (!p.taskPins || typeof p.taskPins !== 'object') p.taskPins = {};
  return p.taskPins;
}

// what a heading sorts by
const SORT = {
  type: (r) => r.task.type || '',
  task: (r) => r.task.name,
  location: (r) => taskLocation(r.task),
  // in hand before done, and the further along the nearer the top
  status: (r) => (r.status === QS.READY ? 1 : 0) * 1000 + taskPercent(r.task),
};

function rowsShown() {
  let rows = activeTasks();
  const q = query.trim().toLowerCase();
  if (q) rows = rows.filter((r) => r.task.name.toLowerCase().includes(q));
  if (pinnedOnly) rows = rows.filter((r) => pins()[r.task.id]);
  const key = SORT[sort.col];
  const cmp = (a, b) => {
    const x = key(a), y = key(b);
    const d = typeof x === 'number' ? x - y : String(x).localeCompare(String(y));
    return sort.down ? d : -d;
  };
  rows = rows.map((r, i) => [r, i]).sort((a, b) => cmp(a[0], b[0]) || a[1] - b[1]).map((x) => x[0]);
  return { pinned: rows.filter((r) => pins()[r.task.id]), rest: rows.filter((r) => !pins()[r.task.id]) };
}

// ---------------------------------------------------------
// the table
// ---------------------------------------------------------
function classBadge(task) {
  // a task of one of a trader's loyalty levels wears the level; the rest are links of a chain
  if (task.tier) return el('span', { class: 'tjr__rank' }, ROMAN[task.tier] || String(task.tier));
  return uiImg('quests_chain_icon', 'tjr__chain');
}

function taskRow(r) {
  const task = r.task;
  const trader = DB.traderById[task.trader];
  const pinned = !!pins()[task.id];
  const pct = r.status === QS.READY ? 100 : taskPercent(task);
  const isOpen = open === task.id;
  const pin = el('button', { class: `tjr__pin${pinned ? ' is-on' : ''}`, type: 'button', dataset: { sfx: 'own' } },
    uiImg(pinned ? 'icon_unpin_msg' : 'icon_pin_msg', '', { w: 16, h: 16 }));
  pin.addEventListener('click', (e) => {
    e.stopPropagation();
    if (pinned) delete pins()[task.id]; else pins()[task.id] = 1;
    sfx.ui('checkbox');
    saveSoon();
    renderJournal();
  });
  const row = el('div', { class: `tjr tjr--${r.status}${isOpen ? ' is-open' : ''}`, dataset: { task: task.id, sfx: 'own' } },
    pin,
    el('div', { class: 'tjr__cell tjr__who' }, trader ? uiImg(`avatar_${trader.key}`) : uiImg('default_avatar')),
    el('div', { class: 'tjr__cell tjr__type' }, typeIcon(task)),
    el('div', { class: 'tjr__cell tjr__class' }, classBadge(task)),
    el('div', { class: 'tjr__cell tjr__name' }, el('span', {}, task.name)),
    el('div', { class: 'tjr__cell tjr__loc' }, el('span', {}, taskLocation(task))),
    // objectives all done reads as the client's journal reads it: completed
    el('div', { class: 'tjr__cell tjr__status' }, r.status === QS.READY ? t('QuestStatusSuccess') : t('QuestStatusStarted')),
    el('div', { class: 'tjr__cell tjr__prog' },
      el('div', { class: 'tjr__pct' }, `${pct}%`),
      el('div', { class: 'tjr__bar' }, el('i', { style: { width: `${pct}%` } }))));
  row.addEventListener('click', () => {
    open = isOpen ? null : task.id;
    sfx.ui('click');
    renderJournal();
  });
  if (!isOpen) return [row];
  return [row, el('div', { class: 'tjx' }, taskBody(task, { atTrader: false, onChange: renderJournal }))];
}

function heading(col, label, cls) {
  const sortable = !!SORT[col];
  const b = el('button', { class: `tjh ${cls}`, type: 'button', disabled: !sortable, dataset: { sfx: 'own' } },
    el('span', {}, label), sort.col === col ? uiImg(sort.down ? 'minimize_down' : 'minimize_up') : null);
  if (sortable) {
    b.addEventListener('click', () => {
      sort = { col, down: sort.col === col ? !sort.down : true };
      sfx.ui('click');
      renderJournal();
    });
  }
  return b;
}

function sidePanel() {
  const { pinned, rest } = rowsShown();
  const none = !pinned.length && !rest.length;
  const list = el('div', { class: 'tj__rows' },
    pinned.flatMap(taskRow),
    pinned.length && rest.length ? el('div', { class: 'tj__sep' }) : null,
    rest.flatMap(taskRow));
  return el('div', { class: 'tj__side' },
    el('div', { class: 'tj__heads' },
      heading('trader', t('Merchant'), 'tjh--who'), heading('type', t('Type'), 'tjh--type'),
      heading('class', t('UI/Quests/TierAccessoryShortLabel'), 'tjh--class'), heading('task', t('Task'), 'tjh--name'),
      heading('location', t('Location'), 'tjh--loc'), heading('status', t('Status'), 'tjh--status'),
      heading('progress', t('Progress'), 'tjh--prog')),
    list,
    none ? el('div', { class: 'tj__none' }, query.trim() || pinnedOnly ? t('tasksPanel/EmptyFilter') : t('NO ACTIVE TASKS')) : null);
}

// ---------------------------------------------------------
// the task items
// ---------------------------------------------------------
/** a grid eight cells wide and `rows` deep with the task items laid into it in turn */
function itemGrid(ids, rows) {
  const grid = el('div', { class: 'tj__grid', style: { height: `${rows * 63}px` } });
  let x = 0, y = 0, tall = 1;
  for (const id of ids) {
    const q = DB.questItems[id];
    if (!q) continue;
    const w = q.w || 1, h = q.h || 1;
    if (x + w > 8) { x = 0; y += tall; tall = 1; }
    let tile;
    if (getTpl(id)) {
      // a task item is an item like any other on its tile: its colour, its picture, its name
      tile = renderItem(new Item(id, { examined: true }), { x, y });
      tile.classList.add('tj__qitem');
    } else {
      tile = el('div', { class: 'tj__qitem', style: { left: `${x * 63}px`, top: `${y * 63}px`, width: `${w * 63 + 1}px`, height: `${h * 63 + 1}px` } },
        el('img', { src: artUrl(`${id}.webp`), alt: '', draggable: 'false' }));
    }
    tile.title = q.name;
    grid.append(tile);
    x += w;
    tall = Math.max(tall, h);
  }
  return el('div', { class: 'tj__gridbox' }, grid);
}

function itemsPanel() {
  const held = Object.entries(game.profile.qitems || {}).filter(([, n]) => n > 0).map(([id]) => id);
  return el('div', { class: 'tj__items' },
    el('div', { class: 'tj__ihead' }, el('span', {}, t('Quest items in inventory (in-raid)')), uiImg('trader_red_warning', '', { w: 26, h: 23 })),
    // nothing is carried between raids: what was found is in the stash kept for it.
    // The client's two grids are 12 and 35 rows deep.
    itemGrid([], 12),
    el('div', { class: 'tj__ihead tj__ihead--stash' }, el('span', {}, t('Quest items special stash (off-raid)'))),
    itemGrid(held, 35));
}

// ---------------------------------------------------------
// the screen
// ---------------------------------------------------------
function subTab(id, label, ico) {
  const on = sub === id;
  const b = el('button', { class: `dbtn tj__tab${on ? ' is-hover' : ''}`, type: 'button', dataset: { sfx: 'own' } }, uiImg(ico), el('span', {}, label));
  b.addEventListener('click', () => { if (sub !== id) { sub = id; open = null; sfx.ui('click'); renderJournal(); } });
  return b;
}

export function renderJournal() {
  const host = $('#tasks-host');
  if (!host) return;
  const keep = host.querySelector('.tj__rows')?.scrollTop || 0;
  const hadFocus = document.activeElement?.classList?.contains('tj__input');

  const input = el('input', { class: 'tj__input', type: 'text', spellcheck: 'false', placeholder: t('Search') });
  input.value = query;
  input.addEventListener('input', () => { query = input.value; open = null; renderJournal(); });
  input.addEventListener('keydown', (e) => e.stopPropagation());
  const pin = el('button', { class: `tj__pinned${pinnedOnly ? ' is-on' : ''}`, type: 'button', dataset: { sfx: 'own' } },
    uiImg(pinnedOnly ? 'icon_unpin_msg' : 'icon_pin_msg', '', { w: 20, h: 20 }));
  pin.addEventListener('click', () => { pinnedOnly = !pinnedOnly; sfx.ui('checkbox'); renderJournal(); });
  const clear = el('button', { class: 'tj__clear', type: 'button', dataset: { sfx: 'own' } },
    uiImg(query ? 'quests_search_icons_1' : 'quests_search_icons_0', '', { w: 16, h: 16 }));
  clear.addEventListener('click', () => { if (query) { query = ''; renderJournal(); } });

  let body;
  if (sub === 'side') body = sidePanel();
  else if (sub === 'story') body = el('div', { class: 'tj__story' }, el('div', { class: 'tj__none' }, t('UI/MainQuests/NoQuestsAvailable')));
  else body = el('div', { class: 'tj__side' }, el('div', { class: 'tj__none' }, t('NO ACTIVE TASKS')));

  host.replaceChildren(
    el('div', { class: 'tj__left' },
      el('div', { class: 'tj__tabs' },
        subTab('story', t('UI/MainQuests/TabName'), 'mainquesttabicon'), el('i', { class: 'tj__tabsep' }),
        subTab('side', t('ACTIVE TASKS'), 'tab_icon_tasks'), el('i', { class: 'tj__tabsep' }),
        subTab('operational', t('DAILY QUESTS'), 'icon_time')),
      el('div', { class: 'tj__search' }, input, pin, clear),
      body),
    itemsPanel());
  const rows = host.querySelector('.tj__rows');
  if (rows) {
    rows.scrollTop = keep;
    // a row opened near the foot of the table brings its sheet into view
    host.querySelector('.tjx')?.scrollIntoView({ block: 'nearest' });
  }
  if (hadFocus) { const now = host.querySelector('.tj__input'); now.focus(); now.setSelectionRange(now.value.length, now.value.length); }
}
