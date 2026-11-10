// =========================================================
// the character screen
//
// One screen, seven tabs along the top, in the game's order and words:
// OVERALL, GEAR, HEALTH, SKILLS, MAP, TASKS, ACHIEVEMENTS. GEAR is the stash
// screen and HEALTH the body; those two are drawn by their own modules. The
// rest are here: the numbers of a career, the skills and how far along each
// is, the places you may be sent, the task journal, the achievements.
// =========================================================

import { $, $$, el, fmtNum } from '../core/util.js';
import { on, emit, EV } from '../core/events.js';
import { game } from '../core/state.js';
import { sfx } from '../core/audio.js';
import { DB, levelProgress, levelGroup, MAX_LEVEL, CUR_SYM } from '../game/db.js';
import { activeTasks, completedTasks, QS, taskCounts } from '../game/quests.js';
import { SKILL_GROUPS, skillState, skillName, skillSprite, MAX_SKILL_LEVEL } from '../game/skills.js';
import { editionInfo } from '../game/profile.js';
import { renderTaskView, taskRow } from './tasks-ui.js';
import { t } from '../core/i18n.js';
import { uiImg, loadUiGroup, hasUi, setUiSrc } from '../core/uiart.js';
import { showScreen, currentScreen } from './shell.js';

/** the tabs, with the client's locale key and glyph for each (`<ico>_selected` when lit) */
const TABS = [
  { key: 'overall', label: 'OVERALL', ico: 'tab_icon_overall' },
  { key: 'gear', label: 'GEAR', ico: 'tab_icon_gear', pane: 'stash' },
  // HEALTH is the same frame as GEAR with the body where the slots are
  { key: 'health', label: 'HEALTH_TAB', ico: 'tab_icon_health', pane: 'stash' },
  // the client's own tabs for things this build has nothing behind yet are
  // drawn switched off, as the bar's are
  { key: 'customization', label: 'Customization', ico: 'tab_icon_customisation', off: true },
  { key: 'skills', label: 'SKILLS', ico: 'tab_icon_skills' },
  { key: 'map', label: 'MAP', ico: 'tab_icon_map' },
  { key: 'tasks', label: 'TASKS', ico: 'tab_icon_tasks' },
  { key: 'achievements', label: 'ACHIEVEMENTS', ico: 'tab_icon_achivement_icon', icoOn: 'tab_icon_achivement_icon_pressed' },
  { key: 'prestige', label: 'Prestige', ico: 'prestige_tabicon_0', icoOn: 'prestige_tabicon_1', off: true },
];
const litIcon = (def) => def.icoOn || (def.ico + '_selected');

let tab = 'gear';
let journalFilter = 'active';
let journalSelected = null;

export function currentTab() { return tab; }

export function openCharacter(next = tab) {
  tab = TABS.some((t) => t.key === next && !t.off) ? next : 'gear';
  if (currentScreen() !== 'character') showScreen('character');
  paint();
  emit(EV.SCREEN_CHANGED, `character:${tab}`);
}

function paneId(t) { return `pane-${t.pane || t.key}`; }

function paint() {
  // two tabs can share a pane (GEAR and HEALTH do): the pane of the tab that is up is the one shown
  const up = paneId(TABS.find((t) => t.key === tab));
  for (const t of TABS) {
    const p = $(`#${paneId(t)}`);
    if (p) p.classList.toggle('is-active', paneId(t) === up);
  }
  for (const b of $$('#char-tabs .ptab')) {
    const lit = b.dataset.tab === tab;
    b.classList.toggle('is-active', lit);
    const def = TABS.find((x) => x.key === b.dataset.tab);
    b.querySelector('.ptab__ico').replaceChildren(uiImg(lit ? litIcon(def) : def.ico));
  }
  if (tab === 'overall') renderOverall();
  else if (tab === 'skills') renderSkills();
  else if (tab === 'map') renderMapTab();
  else if (tab === 'tasks') renderJournal();
  else if (tab === 'achievements') renderAchievements();
}

export function initCharacter() {
  const strip = $('#char-tabs');
  strip.replaceChildren();
  for (const def of TABS) {
    const b = el('button', { class: 'ptab', disabled: !!def.off, dataset: { tab: def.key, sfx: 'own' } },
      el('span', { class: 'ptab__ico' }, uiImg(def.ico)), el('span', {}, t(def.label)));
    b.addEventListener('click', () => { if (tab !== def.key) { sfx.ui('click'); openCharacter(def.key); } });
    strip.append(b);
  }
  const back = el('button', { class: 'dbtn charback', dataset: { sfx: 'own' } }, t('BACK'));
  back.addEventListener('click', () => { sfx.ui('click'); showScreen('menu'); });
  strip.append(back);
  on('shell:character', (t) => openCharacter(t));
  on(EV.SCREEN_CHANGED, (id) => { if (id === 'character') { paint(); emit(EV.SCREEN_CHANGED, `character:${tab}`); } });
  on(EV.QUEST, () => { if (currentScreen() === 'character' && tab === 'tasks') renderJournal(); });
  on(EV.LEVEL_UP, () => { if (currentScreen() === 'character' && tab === 'overall') renderOverall(); });
}

// ---------------------------------------------------------
// OVERALL
// ---------------------------------------------------------
function pct(a, b) { return b ? `${((a / b) * 100).toFixed(1)}%` : '0%'; }

function fmtDate(ms) {
  const d = new Date(ms || Date.now());
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`;
}

/** the badge of the level bracket a character is in: one picture every five levels */
function rankBadge(level) {
  const img = el('img', { alt: '' });
  setUiSrc(img, `rank${levelGroup(level) * 5}`, 'ranks');
  return img;
}

export function renderOverall() {
  const host = $('#overall-host');
  if (!host) return;
  host.replaceChildren();
  const p = game.profile;
  const st = p.stats || {};
  const [into, span] = levelProgress(p.exp);
  const raids = p.raids || 0;
  const kills = st.kills || 0;
  const deaths = p.died || 0;

  const card = el('div', { class: 'ov-card' },
    el('div', { class: 'ov-card__badge' },
      rankBadge(p.level),
      el('b', {}, String(p.level))),
    el('div', { class: 'ov-card__id' },
      el('div', { class: 'ov-card__name' }, p.name || 'PMC'),
      el('div', { class: 'ov-card__side' }, `${p.faction || 'USEC'} · ${editionInfo(p.edition).name}`),
      el('div', { class: 'ov-card__xp' },
        el('div', { class: 'xpbar' }, el('i', { style: { width: span ? `${(into / span) * 100}%` : '100%' } })),
        el('span', {}, span ? `${fmtNum(into)} / ${fmtNum(span)}` : `${fmtNum(p.exp)} — level ${MAX_LEVEL()}`))));

  const block = (title, rows) => el('div', { class: 'ov-block' },
    el('div', { class: 'ov-block__head' }, title),
    el('dl', { class: 'ov-rows' }, ...rows.flatMap(([k, v]) => [el('dt', {}, k), el('dd', {}, String(v))])));

  const tc = taskCounts();
  host.append(
    el('div', { class: 'overall__left' }, card,
      block('PROFILE', [
        ['Registration date', fmtDate(p.registered)],
        ['Experience', fmtNum(p.exp)],
        ['Level', p.level],
        ['Tasks completed', `${tc.done} / ${tc.total}`],
        ['Tasks active', tc.active],
      ])),
    el('div', { class: 'overall__right' },
      block('PMC — RAIDS', [
        ['Raids', raids],
        ['Survived', p.survived || 0],
        ['Killed in Action', st.kia ?? deaths],
        ['Missing in Action', st.mia || 0],
        ['Run Through', st.runner || 0],
        ['Left the Action', st.left || 0],
        ['Survival rate', pct(p.survived || 0, raids)],
        ['Current winstreak', st.streak || 0],
        ['Longest winstreak', st.bestStreak || 0],
      ]),
      block('PMC — COMBAT', [
        ['Kills', kills],
        ['Scavs killed', st.killsScav || 0],
        ['PMCs killed', st.killsPmc || 0],
        ['Bosses killed', st.killsBoss || 0],
        ['K/D ratio', deaths ? (kills / deaths).toFixed(2) : kills.toFixed(2)],
        ['Headshots', st.headshots || 0],
        ['Longest shot', `${Math.round(st.longestShot || 0)} m`],
        ['Rounds fired', fmtNum(st.shots || 0)],
      ]),
      block('LOOTING', [
        ['Containers searched', fmtNum(st.searched || 0)],
        ['Items found', fmtNum(st.found || 0)],
        ['Best haul', `${fmtNum(p.bestHaul || 0)} ${CUR_SYM.RUB}`],
        ['Distance covered', `${fmtNum(Math.round((st.distance || 0)))} m`],
      ])));
}

// ---------------------------------------------------------
// SKILLS
// ---------------------------------------------------------
export function renderSkills() {
  const host = $('#skills-host');
  if (!host) return;
  // the pictures are a pack of their own, fetched the first time the tab is opened
  if (!hasUi('skill_physical_endurance')) loadUiGroup('skills').then((ok) => { if (ok && hasUi('skill_physical_endurance')) renderSkills(); });
  host.replaceChildren();
  for (const g of SKILL_GROUPS) {
    const grid = el('div', { class: 'sk-grid' });
    for (const id of g.skills) {
      const [level, into, cost] = skillState(id);
      const elite = level >= MAX_SKILL_LEVEL;
      const tile = el('div', { class: `sk${elite ? ' is-elite' : ''}${level === 0 && !into ? ' is-untrained' : ''}`, title: skillName(id) },
        el('div', { class: 'sk__art' },
          hasUi(skillSprite(id)) ? uiImg(skillSprite(id)) : null,
          el('b', { class: 'sk__lvl' }, elite ? 'ELITE' : String(level))),
        el('div', { class: 'sk__name' }, skillName(id)),
        el('div', { class: 'sk__bar' }, el('i', { style: { width: cost ? `${(into / cost) * 100}%` : '100%' } })));
      grid.append(tile);
    }
    host.append(el('div', { class: 'sk-group' }, el('div', { class: 'sk-group__head' }, g.name.toUpperCase()), grid));
  }
}

// ---------------------------------------------------------
// MAP
// ---------------------------------------------------------
function renderMapTab() {
  const host = $('#charmap-host');
  if (!host) return;
  host.replaceChildren();
  const seen = new Set();
  const list = el('div', { class: 'cm-list' });
  for (const l of DB.progress?.locations || []) {
    if (seen.has(l.key)) continue;
    seen.add(l.key);
    list.append(el('div', { class: 'cm-row' },
      el('div', { class: 'cm-row__name' }, l.name),
      el('div', { class: 'cm-row__meta' }, `${l.duration || '—'} min · ${l.players || '—'} players`),
      el('div', { class: 'cm-row__desc' }, l.desc || '')));
  }
  host.append(list);
}

// ---------------------------------------------------------
// TASKS (the journal)
// ---------------------------------------------------------
function renderJournal() {
  const host = $('#tasks-host');
  if (!host) return;
  host.replaceChildren();

  const filters = el('div', { class: 'tj-filters' });
  for (const [key, label] of [['active', 'Active'], ['completed', 'Completed']]) {
    const b = el('button', { class: `tj-filter${journalFilter === key ? ' is-active' : ''}`, dataset: { sfx: 'own' } }, label);
    b.addEventListener('click', () => { journalFilter = key; journalSelected = null; sfx.ui('checkbox'); renderJournal(); });
    filters.append(b);
  }

  let rows;
  if (journalFilter === 'completed') rows = completedTasks().map((task) => ({ task, status: QS.DONE }));
  else rows = activeTasks();
  if (journalSelected && !rows.some((r) => r.task.id === journalSelected)) journalSelected = null;
  if (!journalSelected && rows.length) journalSelected = rows[0].task.id;

  const listHost = el('div', { class: 'tasksview__list' });
  const detailHost = el('div', { class: 'tasksview__detail' });
  host.append(el('div', { class: 'tasksview tasksview--journal' },
    el('div', { class: 'tasksview__left' }, filters, listHost), detailHost));

  for (const r of rows) {
    listHost.append(taskRow(r, {
      selected: r.task.id === journalSelected,
      onSelect: () => { journalSelected = r.task.id; renderJournal(); },
    }));
  }
  const sel = journalSelected ? DB.taskById[journalSelected] : null;
  const view = el('div', { class: 'qv' });
  detailHost.append(view);
  renderTaskView(view, sel, { atTrader: false, onChange: renderJournal });
}

// ---------------------------------------------------------
// ACHIEVEMENTS
// ---------------------------------------------------------
function renderAchievements() {
  const host = $('#achv-host');
  if (!host) return;
  host.replaceChildren();
  const have = game.profile.achievements || {};
  const grid = el('div', { class: 'achv-grid' });
  const list = [...DB.achievements].sort((a, b) => (have[b.id] ? 1 : 0) - (have[a.id] ? 1 : 0) || (b.pct || 0) - (a.pct || 0));
  for (const a of list) {
    if (a.hidden && !have[a.id]) continue;
    grid.append(el('div', { class: `achv-card achv-card--${a.rarity || 'common'}${have[a.id] ? ' is-done' : ''}` },
      el('div', { class: 'achv-card__art' },
        a.img ? el('img', { src: `assets/achievements/${a.img}`, alt: '', loading: 'lazy', onerror: function () { this.remove(); } }) : null),
      el('div', { class: 'achv-card__body' },
        el('div', { class: 'achv-card__name' }, a.name),
        el('div', { class: 'achv-card__desc' }, a.desc || ''),
        el('div', { class: 'achv-card__meta' }, `${(a.rarity || 'common').toUpperCase()} · ${a.pct != null ? `${a.pct}% of players` : ''}`))));
  }
  host.append(grid);
}
