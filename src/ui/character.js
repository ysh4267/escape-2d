// =========================================================
// the character screen
//
// One screen, its tabs along the top in the game's order and words: OVERALL,
// GEAR, HEALTH, CUSTOMIZATION, SKILLS, MAP, TASKS, ACHIEVEMENTS, PRESTIGE.
// Each is drawn by its own module but the achievements, which are here.
// =========================================================

import { $, $$, el } from '../core/util.js';
import { on, emit, EV } from '../core/events.js';
import { game } from '../core/state.js';
import { sfx } from '../core/audio.js';
import { DB } from '../game/db.js';
import { t } from '../core/i18n.js';
import { uiImg } from '../core/uiart.js';
import { showScreen, currentScreen } from './shell.js';
import { renderOverall } from './overall.js';
import { renderSkills, initSkills } from './skills-ui.js';
import { renderMap } from './map-ui.js';
import { renderJournal } from './journal.js';

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
  else if (tab === 'map') renderMap();
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
  initSkills();
  on('shell:character', (t) => openCharacter(t));
  on(EV.SCREEN_CHANGED, (id) => { if (id === 'character') { paint(); emit(EV.SCREEN_CHANGED, `character:${tab}`); } });
  on(EV.QUEST, () => { if (currentScreen() === 'character' && tab === 'tasks') renderJournal(); });
  on(EV.LEVEL_UP, () => { if (currentScreen() === 'character' && tab === 'overall') renderOverall(); });
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
