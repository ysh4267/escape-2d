// =========================================================
// tasks on screen
//
// The trader's TASKS tab, as the client lays it out:
//
//   left   one wide button - ACCEPT while the chosen task can be taken,
//          COMPLETE once it can be handed in, dead otherwise - then a bar
//          with "Show completed" and "Show locked" and the two view toggles,
//          then the list. By category the list is filed under collapsing
//          headers, LOYALTY LEVEL 1..4 for the waves a trader hands out at
//          each level and ESSENTIAL TASKS for the chains; each row is tinted
//          by its state and says it in the game's own lower case: ready,
//          active!, finished!, completed, Locked.
//   right  the task: a bar with its name, where it happens and its state;
//          under it the picture beside what the trader said, what he hands
//          you to do it with, a bar an objective with its count and a blue
//          tick when done, and a tile for everything that comes back. A
//          locked task shows TASK UNLOCK REQUIREMENTS and the conditions
//          with their tick boxes instead of the description.
//
// Handing things over is done from the objective's own bar: TURN IN opens
// the window with what you hold that qualifies.
//
// The journal on the character screen draws the same task view from here.
// =========================================================

import { el, fmtNum } from '../core/util.js';
import { game } from '../core/state.js';
import { renderItem } from '../inventory/view.js';
import { openModal } from '../inventory/dialogs.js';
import { sfx } from '../core/audio.js';
import { t, tOr } from '../core/i18n.js';
import { uiImg } from '../core/uiart.js';
import { DB, tplOf, keyOf, CUR_OF_ITEM, locationName, traderName } from '../game/db.js';
import {
  QS, statusOf, progressOf, requirementList, acceptTask, completeTask, restartTask, tasksOf,
  handoverCandidates, handOver, handOverTaskItem, handOverWeapon, weaponFits, hasTaskItem,
} from '../game/quests.js';
import { skillName } from '../game/skills.js';
import { rankNode } from './traders-list.js';
import { toast } from './shell.js';

/** the client's glyph for each kind of task */
const TYPE_ICON = {
  PickUp: 'icon_looting', Elimination: 'icon_killings', Discover: 'tab_icon_map', Completion: 'icon_survival',
  Exploration: 'icon_search', Levelling: 'levelling', Experience: 'icon_experience', Standing: 'standing_icon',
  Loyalty: 'll', Merchant: 'tab_icon_sell', Skill: 'tab_icon_skills', Multi: 'muli_task_quest',
  WeaponAssembly: 'icon_itemtype_weapon', Daily: 'icon_time',
};
/** and for each kind of objective */
const OBJ_ICON = {
  shoot: 'icon_killings', giveItem: 'icon_looting', findItem: 'icon_looting', giveQuestItem: 'icon_looting',
  findQuestItem: 'icon_search', visit: 'icon_search', extract: 'icon_survival', mark: 'tab_icon_map',
  plantItem: 'icon_looting', plantQuestItem: 'icon_looting', useItem: 'icon_looting', buildWeapon: 'icon_itemtype_weapon',
  skill: 'tab_icon_skills', traderLevel: 'll', traderStanding: 'standing_icon', experience: 'icon_experience',
  sellItem: 'tab_icon_sell', taskStatus: 'tab_icon_tasks', dialogue: 'icon_survival', globalVariable: 'icon_survival',
};
const STATUS_KEY = {
  locked: 'QuestStatusLocked', available: 'QuestStatusAvailableForStart', active: 'QuestStatusStarted',
  ready: 'QuestStatusAvailableForFinish', done: 'QuestStatusSuccess', failed: 'QuestStatusFail',
};
export const statusWord = (status) => t(STATUS_KEY[status] || status);

export function taskLocation(task) {
  return task.map ? locationName(task.map) : t('any');
}

/** percentage of the required objectives done, for the journal's progress column */
export function taskPercent(task) {
  let need = 0, have = 0;
  for (const o of task.obj) {
    if (o.optional) continue;
    const p = progressOf(task, o);
    need += 1;
    have += p.done ? 1 : (p.need ? Math.min(1, p.cur / p.need) : 0);
  }
  return need ? Math.round((have / need) * 100) : 100;
}

export function typeIcon(task, cls = '') {
  return uiImg(TYPE_ICON[task.type] || 'icon_survival', cls);
}

// ---------------------------------------------------------
// the trader's tab
// ---------------------------------------------------------
/** what the pane remembers between visits, a trader */
const memory = new Map();
function stateOf(trader) {
  let st = memory.get(trader.id);
  if (!st) {
    st = { selected: null, completed: false, locked: false, view: 'tiered', shut: new Set() };
    memory.set(trader.id, st);
  }
  return st;
}

/**
 * @param {HTMLElement} host
 * @param {any} trader
 * @param {{ onChange?: () => void }} opts
 */
export function renderTasksPane(host, trader, opts = {}) {
  const st = stateOf(trader);
  const rows = tasksOf(trader, { completed: st.completed, locked: st.locked });
  if (st.selected && !rows.some((r) => r.task.id === st.selected)) st.selected = null;
  if (!st.selected && rows.length) st.selected = rows[0].task.id;
  const task = st.selected ? DB.taskById[st.selected] : null;
  const status = task ? statusOf(task) : null;
  const again = () => { renderTasksPane(host, trader, opts); opts.onChange?.(); };
  const paint = () => renderTasksPane(host, trader, opts);

  // ---- the one button ----
  let label = t('Complete'), go = null;
  if (status === QS.AVAILABLE) { label = t('ACCEPT'); go = () => acceptTask(task); }
  else if (status === QS.READY) go = () => completeTask(task);
  else if (status === QS.FAILED && task.restartable) { label = t('RESTART'); go = () => restartTask(task); }
  const act = el('button', { class: 'dbtn dbtn--20', disabled: !go, dataset: { sfx: 'own' } }, label);
  act.addEventListener('click', () => { if (go && go()) again(); });

  // ---- the filter bar ----
  const check = (key, text) => {
    const c = el('button', { class: `chk${st[key] ? ' is-on' : ''}`, dataset: { sfx: 'own' } },
      el('i', {}, uiImg('checkmark', '', { w: 14, h: 12 })), el('span', {}, text));
    c.addEventListener('click', () => { st[key] = !st[key]; sfx.ui('checkbox'); paint(); });
    return c;
  };
  const view = (key, ico) => {
    const b = el('button', { class: `vtog${st.view === key ? ' is-active' : ''}`, dataset: { sfx: 'own' } }, uiImg(ico));
    b.addEventListener('click', () => { if (st.view !== key) { st.view = key; sfx.ui('click'); paint(); } });
    return b;
  };

  // ---- the list ----
  const list = el('div', { class: 'ql__list' });
  const prevList = host.querySelector('.ql__list');
  const row = (r, child = false) => taskRow(r, {
    selected: r.task.id === st.selected, child,
    onSelect: () => { st.selected = r.task.id; paint(); },
  });

  if (!rows.length) list.append(el('div', { class: 'ql__empty' }, ''));
  else if (st.view === 'flat') for (const r of rows) list.append(row(r));
  else {
    for (const g of groupsOf(trader, rows)) {
      const shut = st.shut.has(g.key);
      const head = el('button', { class: `qtier${shut ? ' is-shut' : ''}`, dataset: { sfx: 'own' } },
        el('span', { class: 'qtier__in' },
          el('span', { class: 'qtier__ico' }, g.icon()),
          el('span', { class: 'qtier__title' }, el('span', {}, g.title),
            g.rows.some((r) => r.status === QS.AVAILABLE) ? uiImg('regular_quest_icon_big') : null,
            g.rows.some((r) => r.status === QS.READY) ? uiImg('icon_daily_quests') : null),
          uiImg('dropdown_arrow_down_new_white', 'qtier__caret')));
      head.addEventListener('click', () => {
        if (shut) st.shut.delete(g.key); else st.shut.add(g.key);
        sfx.ui('click');
        paint();
      });
      list.append(head);
      if (shut) continue;
      const box = el('div', { class: 'qtier__rows' });
      for (const r of g.rows) box.append(row(r, g.tree && g.children.has(r.task.id)));
      list.append(box);
    }
  }

  const ql = el('div', { class: 'ql' },
    el('div', { class: 'ql__head' }, act),
    el('div', { class: 'ql__filters' },
      check('completed', t('QuestsShowCompleted')), check('locked', t('QuestsShowLocked')),
      el('div', { class: 'ql__views' }, view('tiered', 'skills_list_icon'), view('flat', 'skills_grid_icon'))),
    list);

  const qv = el('div', { class: 'qv' });
  const prevScroll = host.querySelector('.qv__scroll');
  const keepDetail = prevScroll && prevScroll.dataset.task === (task ? task.id : '') ? prevScroll.scrollTop : 0;
  renderTaskView(qv, task, { atTrader: true, onChange: again });
  const keepList = prevList ? prevList.scrollTop : 0;
  host.replaceChildren(ql, qv);
  list.scrollTop = keepList;
  const sc = qv.querySelector('.qv__scroll');
  if (sc) sc.scrollTop = keepDetail;
}

/**
 * One line of a task list: the glyph of its kind, its name, and its state in
 * the game's own lower case at the right end.
 * @param {{ task: any, status: string }} r
 * @param {{ selected?: boolean, child?: boolean, onSelect?: () => void }} [o]
 */
export function taskRow(r, o = {}) {
  const b = el('button', {
    class: `qrow qrow--${r.status}${o.selected ? ' is-selected' : ''}${o.child ? ' is-child' : ''}`,
    dataset: { task: r.task.id, sfx: 'own' },
  },
  typeIcon(r.task, 'qrow__type'),
  el('span', { class: 'qrow__name' }, el('span', {}, r.task.name)),
  el('span', { class: 'qrow__right' },
    el('span', { class: 'qrow__status' }, statusWord(r.status), r.status === QS.LOCKED ? uiImg('icon_lock_small') : null)),
  uiImg('scroller_right_arrow', 'qrow__arrow'));
  b.addEventListener('click', () => { if (!o.selected) { sfx.ui('click'); o.onSelect?.(); } });
  return b;
}

/** the headers a trader's tasks are filed under, with their rows */
function groupsOf(trader, rows) {
  const max = trader.levels.length;
  const out = [];
  for (let tier = 1; tier <= 4; tier++) {
    const mine = rows.filter((r) => r.task.tier === tier);
    if (!mine.length) continue;
    out.push({
      key: `ll${tier}`, rows: mine, children: new Set(),
      title: tOr(`UI/Quests/TraderAccessoryGroup/Tier${tier}`, `Loyalty level ${tier}`),
      icon: () => rankNode(tier, Math.max(max, 5)),
    });
  }
  const chain = rows.filter((r) => !r.task.tier);
  if (chain.length) {
    // a chain reads top to bottom: a task that waits on another one in the
    // list is set in under it
    const ids = new Set(chain.map((r) => r.task.id));
    const children = new Set();
    for (const r of chain) {
      if ((r.task.req?.tasks || []).some(([id]) => ids.has(id))) children.add(r.task.id);
    }
    const ordered = [];
    const put = (r) => {
      if (ordered.includes(r)) return;
      ordered.push(r);
      for (const next of chain) {
        if ((next.task.req?.tasks || []).some(([id]) => id === r.task.id)) put(next);
      }
    };
    for (const r of chain) if (!children.has(r.task.id)) put(r);
    for (const r of chain) put(r);
    out.push({
      key: 'chain', rows: ordered, tree: true, children,
      title: tOr('UI/Quests/TraderAccessoryGroup/Chain', 'Essential tasks'),
      icon: () => uiImg('quests_chain_icon', '', { w: 32, h: 28 }),
    });
  }
  return out;
}

// ---------------------------------------------------------
// the task itself
// ---------------------------------------------------------
/**
 * @param {HTMLElement} host   an element laid out as .qv
 * @param {any|null} task
 * @param {{ atTrader?: boolean, onChange: () => void }} opts
 *   `atTrader` - the trader is in front of you: things can be handed over
 */
export function renderTaskView(host, task, opts) {
  host.replaceChildren();
  if (!task) {
    host.append(el('div', { class: 'qv__head' }));
    return;
  }
  const status = statusOf(task);
  const trader = DB.traderById[task.trader];
  const live = status === QS.ACTIVE || status === QS.READY;

  host.append(el('div', { class: 'qv__head' },
    typeIcon(task, 'qv__type'),
    el('div', { class: 'qv__title' }, task.name),
    el('div', { class: 'qv__right' },
      el('span', { class: 'qv__loc' }, taskLocation(task)),
      status === QS.LOCKED ? uiImg('icon_lock_small') : null,
      el('span', { class: `qv__status qv__status--${status}` }, statusWord(status)),
      task.tier && trader ? rankNode(task.tier, Math.max(trader.levels.length, 5)) : uiImg('quests_chain_icon', '', { w: 28, h: 25 }))));

  const inner = el('div', { class: 'qv__in' });
  const scroll = el('div', { class: 'qv__scroll', dataset: { task: task.id } }, inner);
  host.append(scroll);

  if (status === QS.LOCKED) inner.append(el('div', { class: 'qv__blocked' }, t('QuestRequirementsTitle')));

  // ---- the picture and what was said (or, locked, what it takes) ----
  const desc = el('div', { class: 'qv__desc' });
  const pic = el('img', { class: 'qv__pic', alt: '', loading: 'lazy' });
  if (task.img) {
    pic.src = `assets/quests/${task.img}`;
    pic.addEventListener('error', () => { pic.removeAttribute('src'); pic.style.visibility = 'hidden'; }, { once: true });
  }
  desc.append(pic);
  if (status === QS.LOCKED) {
    const reqs = el('div', { class: 'qv__reqs' });
    for (const r of requirementList(task)) {
      if (r.hidden) continue;
      reqs.append(el('div', { class: `qreq${r.ok ? ' is-ok' : ''}` },
        el('span', { class: 'qreq__box' }, uiImg('check', '', { w: 14, h: 14 })),
        r.icon ? uiImg(r.icon) : null,
        el('span', {}, r.text)));
    }
    desc.append(reqs);
  } else {
    const text = el('div', { class: 'qv__text' });
    const said = status === QS.DONE && task.okMsg ? task.okMsg : task.desc;
    for (const para of String(said || '').split(/\n+/)) if (para.trim()) text.append(el('p', {}, para.trim()));
    desc.append(text);
  }
  inner.append(desc);

  // ---- what he hands you to do it with ----
  const kit = rewardTiles(task.start, task, false);
  if (kit.length) inner.append(section(t('QuestInitialsEquipment'), null, el('div', { class: 'qsec__tiles' }, kit)));

  // ---- objectives ----
  const objs = el('div', { class: 'qobjs' });
  for (const o of task.obj) {
    const p = progressOf(task, o);
    const done = status === QS.DONE || (live && p.done);
    const bar = el('div', { class: `qobj${done ? ' is-done' : ''}${o.optional ? ' qobj--child' : ''}` },
      uiImg(OBJ_ICON[o.type] || 'icon_survival', 'qobj__ico'),
      el('span', { class: 'qobj__text' }, `${o.optional ? `${t('(optional)')} ` : ''}${o.text || o.type}`));
    if (live && !p.plain && p.need > 1) {
      bar.append(
        el('span', { class: 'qobj__bar' }, el('i', { style: { width: `${Math.min(1, p.cur / p.need) * 182}px` } })),
        el('span', { class: 'qobj__count' }, `${fmtNum(Math.min(p.cur, p.need))}/${fmtNum(p.need)}`));
    }
    if (done) bar.append(uiImg('blue_check', 'qobj__done'));
    else if (live && opts.atTrader) {
      const btn = handoverButton(task, o, opts);
      if (btn) bar.append(btn);
    }
    objs.append(bar);
  }
  inner.append(section(t('Objectives'), null, objs));

  // ---- what comes back ----
  const tiles = rewardTiles(task.finish, task, true);
  if (tiles.length) {
    inner.append(section(t('QuestRewardsTitle'), status === QS.DONE ? t('QuestRewardsRecieved') : null,
      el('div', { class: 'qsec__tiles' }, tiles)));
  }
}

function section(title, note, body) {
  return el('div', { class: 'qsec' },
    el('div', { class: 'qsec__title' }, title, note ? el('small', {}, note) : null), body);
}

function handoverButton(task, o, opts) {
  let run = null, can = true;
  if (o.type === 'giveItem') {
    can = handoverCandidates(task, o).length > 0;
    run = () => handoverWindow(task, o, opts);
  } else if (o.type === 'giveQuestItem') {
    can = hasTaskItem(o.qitem, 'stash');
    run = () => { if (handOverTaskItem(task, o)) { sfx.ui('click'); opts.onChange(); } };
  } else if (o.type === 'buildWeapon') {
    run = () => weaponWindow(task, o, opts);
  } else return null;
  const b = el('button', { class: 'dbtn dbtn--22', disabled: !can, dataset: { sfx: 'own' } }, t('HANDOVER'));
  b.addEventListener('click', run);
  return b;
}

// ---------------------------------------------------------
// handing over
// ---------------------------------------------------------
function windowShell(box, done, title) {
  box.classList.add('hwin');
  const close = el('button', { class: 'wclose', dataset: { sfx: 'own' } }, uiImg('close_window_x'));
  close.addEventListener('click', () => done());
  const body = el('div', { class: 'hwin__body' });
  box.append(el('div', { class: 'hwin__cap' }, el('span', {}, title), close), body);
  return body;
}

function handoverWindow(task, o, opts) {
  const p = progressOf(task, o);
  const need = p.need - p.cur;
  const cands = handoverCandidates(task, o);
  const picked = new Set();
  const auto = () => {
    picked.clear();
    let sum = 0;
    for (const it of cands) {
      if (sum >= need) break;
      picked.add(it);
      sum += it.stack || 1;
    }
  };

  openModal((box, done) => {
    const body = windowShell(box, done, t('Handover items to trader'));
    const count = el('span', {});
    const grid = el('div', { class: 'hwin__grid' });
    const go = el('button', { class: 'dbtn dbtn--24', dataset: { sfx: 'own' } }, t('HANDOVER'));
    const autoBtn = el('button', { class: 'hwin__auto', dataset: { sfx: 'own' } }, t('AUTO'));
    const paint = () => {
      let n = 0;
      for (const it of picked) n += it.stack || 1;
      count.textContent = `${Math.min(n, need)} / ${need}`;
      go.disabled = n <= 0;
      for (const node of grid.children) node.classList.toggle('is-picked', picked.has(node._item));
    };
    for (const it of cands) {
      const tile = renderItem(it, { static: true });
      tile.addEventListener('click', () => {
        if (picked.has(it)) picked.delete(it); else picked.add(it);
        sfx.ui('checkbox');
        paint();
      });
      grid.append(tile);
    }
    autoBtn.addEventListener('click', () => { auto(); sfx.ui('click'); paint(); });
    go.addEventListener('click', () => {
      const n = handOver(task, o, [...picked]);
      done();
      if (n) { sfx.trade('deal'); opts.onChange(); }
    });
    body.append(
      el('div', { class: 'hwin__line' }, el('span', {}, t('Items in stash selected:')), count, autoBtn),
      grid, go);
    auto();
    paint();
  }, { class: 'modal--bare' });
}

function weaponWindow(task, o, opts) {
  const want = tplOf(o.weapon);
  // every gun of the right model in the stash, whether or not it meets the spec yet
  const guns = [];
  const walk = (grids) => {
    for (const g of grids) for (const it of g.items()) {
      if (it.isWeapon && it.tpl.id === o.weapon) guns.push(it);
      if (it.grids) walk(it.grids);
    }
  };
  walk([game.stash]);

  openModal((box, done) => {
    const body = windowShell(box, done, t('Handover items to trader'));
    body.append(el('div', { class: 'hwin__line' }, el('span', {}, o.text)));
    if (!guns.length) body.append(el('div', { class: 'hwin__note' }, want ? want.name : ''));
    for (const gun of guns) {
      const fit = weaponFits(o, gun);
      const rows = el('ul', { class: 'spec' });
      for (const r of fit.rows) {
        rows.append(el('li', { class: r.ok ? 'is-ok' : 'is-miss' },
          el('span', {}, r.label),
          r.need != null ? el('b', {}, `${r.have != null ? Math.round(r.have * 100) / 100 : '—'} ${r.op} ${r.need}`) : el('b', {}, r.ok ? '✓' : '×')));
      }
      const go = el('button', { class: 'dbtn dbtn--20', disabled: !fit.ok, dataset: { sfx: 'own' } }, t('HANDOVER'));
      go.addEventListener('click', () => {
        if (handOverWeapon(task, o, gun)) { done(); sfx.trade('deal'); opts.onChange(); } else toast(t('HANDOVER'), 'warn');
      });
      body.append(el('div', { class: 'hgun' }, renderItem(gun, { static: true }), rows, go));
    }
  }, { class: 'modal--bare' });
}

// ---------------------------------------------------------
// rewards
// ---------------------------------------------------------
/** the tiles of a reward list: experience and standing first, then things, then what it unlocks */
function rewardTiles(rw, task, withExp) {
  const out = [];
  if (!rw && !(withExp && task.xp)) return out;
  const stat = (ico, cap, val) => el('div', { class: 'qtile' },
    el('span', { class: 'qtile__art' }, uiImg(ico, 'is-sym')),
    el('span', { class: 'qtile__cap' }, cap), el('span', { class: 'qtile__val' }, val));
  const signed = (v) => `${v > 0 ? '+' : ''}${String(v).replace('.', ',')}`;

  if (withExp && task.xp) out.push(stat('questreward_exp', t('QuestTypeExperience'), `+${fmtNum(task.xp)}`));
  for (const [tid, v] of rw?.rep || []) out.push(stat('questreward_traderstanding', traderName(tid), signed(v)));
  for (const [skill, lv] of rw?.skills || []) out.push(stat('questreward_skill', skillName(skill), `+${lv}`));

  for (const [id, n] of rw?.items || []) {
    const preset = DB.presets[id];
    const key = keyOf(preset ? preset.base : id);
    const name = preset?.name || tplOf(id)?.name || t('Unknown reward');
    const img = key ? tplOf(preset ? preset.base : id)?.imgUrl : null;
    const art = el('span', { class: 'qtile__art' }, img ? el('img', { src: img, alt: '' }) : uiImg('unknown_reward'));
    const many = n > 1 || CUR_OF_ITEM[id];
    out.push(el('div', { class: 'qtile', title: name }, art,
      el('span', { class: 'qtile__name' }, many ? `${name} (${fmtNum(n)})` : name)));
  }
  for (const [tid, ll, item] of rw?.unlock || []) {
    const preset = DB.presets[item];
    const tpl = tplOf(preset ? preset.base : item);
    const name = preset?.name || tpl?.name || t('Unknown reward');
    const art = el('span', { class: 'qtile__art' }, tpl?.imgUrl ? el('img', { src: tpl.imgUrl, alt: '' }) : uiImg('unknown_reward'));
    out.push(el('div', { class: 'qtile', title: t('UI/Quest/Reward/AssortmentUnlockCaption', traderName(tid), ll) }, art,
      uiImg('eft_unlocktrade_questicon', 'qtile__unlock'),
      el('span', { class: 'qtile__name' }, name)));
  }
  for (const tid of rw?.traders || []) {
    const who = DB.traderById[tid];
    if (!who) continue;
    out.push(el('div', { class: 'qtile' },
      el('span', { class: 'qtile__art' }, uiImg(`avatar_${who.key}`, '', { w: 64, h: 64 })),
      el('span', { class: 'qtile__name' }, who.name)));
  }
  return out;
}
