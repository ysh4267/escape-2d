// =========================================================
// the character screen's ACHIEVEMENTS tab
//
// The client's AchievementsScreen, off its hierarchy and 1080p captures of
// 1.1:
//
//   left   the character's sheet, the one OVERALL stands there
//   right  how many are earned out of all there are - in words, as a bar
//          and in large figures, the earned of each rarity beside them -
//          over the table: a row an achievement, with its badge, its name
//          and what earns it, the share of all players who have it and the
//          day it was earned. The last two headings sort the table.
//
// A hidden achievement is not listed until it is earned; the row that closes
// the table counts the ones still out there.
//
// What is earned is kept with the profile: achievements { id: when, in ms }.
// =========================================================

import { $, el, fmtDate } from '../core/util.js';
import { game } from '../core/state.js';
import { t } from '../core/i18n.js';
import { uiImg } from '../core/uiart.js';
import { sfx } from '../core/audio.js';
import { DB } from '../game/db.js';
import { characterSheet } from './overall.js';

/** a row and the gap under it: what a notch of the wheel moves the table by */
const PITCH = 147;
/** how far the wheel turns for one notch */
const NOTCH = 100;

const RARITIES = [
  { id: 'common', label: 'Achievements/Tab/CommonRarity' },
  { id: 'rare', label: 'Achievements/Tab/RareRarity' },
  { id: 'legendary', label: 'Achievements/Tab/LegendaryRarity' },
  { id: 'seasonal', label: 'Achievements/Tab/SeasonalRarity' },
];

let sort = { col: 'date', down: true };
/** an achievement's badge, made once: a table drawn again takes the pictures it already has */
const badgeOf = new Map();
let badgeWatch = null;

/** when an achievement was earned, or 0 */
function when(a) {
  return Number(game.profile.achievements?.[a.id]) || 0;
}

// what a heading sorts by. One not earned has no day and sorts as the oldest.
const SORT = {
  pct: (a) => a.pct || 0,
  date: (a) => when(a),
};

/** the share of all players as the client writes it: 14.1%, 0.7%, 0%, and 0.1%< for less than a tenth */
function share(pct) {
  if (!pct) return '0%';
  if (pct < 0.1) return '0.1%<';
  return `${Math.round(pct * 10) / 10}%`;
}

function badge(a) {
  let img = badgeOf.get(a.id);
  if (!img) {
    img = el('img', { class: 'ach__badge', alt: '', draggable: 'false', dataset: { src: `assets/achievements/${a.img}` } });
    badgeOf.set(a.id, img);
  }
  return img;
}

function row(a) {
  const at = when(a);
  return el('div', { class: `ach__row ach__row--${a.rarity || 'common'}${at ? ' is-earned' : ''}` },
    badge(a),
    el('div', { class: 'ach__text' },
      el('div', { class: 'ach__name' }, a.name),
      el('div', { class: 'ach__desc' }, a.desc || '')),
    el('div', { class: 'ach__pct' }, share(a.pct)),
    el('div', { class: 'ach__date' }, at ? fmtDate(at) : t('Achievements/Tab/NotReceivedYet')));
}

/** the row that closes the table: how many hidden ones are still to be found */
function hiddenRow(n) {
  // the Korean line has no place for the count and stops at its colon: the count goes after it
  const line = t('Achievements/Tab/HiddenAchievementsLeft');
  return el('div', { class: 'ach__row ach__row--hidden' },
    el('div', { class: 'ach__more' }, uiImg('eft_ui_achivement_frames_0'), el('span', {}, `+${n}`)),
    el('div', { class: 'ach__text' },
      el('div', { class: 'ach__name' }, t('Achievements/Tab/HiddenAchievements')),
      el('div', { class: 'ach__desc' }, line.includes('{0}') ? line.replace('{0}', String(n)) : `${line}${n}`)));
}

/** a badge is fetched a few rows ahead of coming into view, not the whole table's at once */
function fetchBadges(rows) {
  badgeWatch?.disconnect();
  badgeWatch = new IntersectionObserver((seen) => {
    for (const e of seen) {
      if (!e.isIntersecting) continue;
      e.target.src = e.target.dataset.src;
      badgeWatch.unobserve(e.target);
    }
  }, { root: rows, rootMargin: `${PITCH * 6}px 0px` });
  for (const img of rows.querySelectorAll('.ach__badge')) if (!img.src) badgeWatch.observe(img);
}

function heading(col, label) {
  const on = sort.col === col;
  const b = el('button', { class: `ach__h ach__h--${col}`, type: 'button', dataset: { sfx: 'own' } },
    el('span', {}, label), on ? uiImg(sort.down ? 'minimize_down' : 'minimize_up') : null);
  b.addEventListener('click', () => {
    sort = { col, down: on ? !sort.down : true };
    sfx.ui('click');
    renderAchievements();
  });
  return b;
}

export function renderAchievements() {
  const host = $('#achievements-host');
  if (!host) return;
  const all = DB.achievements;
  const got = all.filter(when);
  const hiddenLeft = all.filter((a) => a.hidden && !when(a)).length;

  // ---- what has been earned ----
  const summary = el('div', { class: 'ach__sum' },
    el('div', { class: 'ach__prog' },
      el('div', { class: 'ach__upper' },
        el('div', { class: 'ach__words' },
          el('div', { class: 'ach__title' }, t('Achievements/Tab/YourAchievements')),
          el('div', { class: 'ach__line' }, t('Achievements/Tab/Progress', got.length, all.length, all.length ? Math.round((got.length / all.length) * 100) : 0))),
        el('div', { class: 'ach__count' }, el('b', {}, String(got.length)), `/${all.length}`)),
      el('div', { class: 'ach__bar' }, el('i', { style: `--v:${all.length ? got.length / all.length : 0}` }))),
    el('div', { class: 'ach__rars' }, RARITIES.map((r) => el('div', { class: 'ach__rar' },
      el('span', {}, t(r.label)), el('span', {}, '-'), el('span', {}, String(got.filter((a) => a.rarity === r.id).length))))));

  // ---- the table ----
  // the ones that sort alike keep the order they come in
  const key = SORT[sort.col];
  const listed = all.filter((a) => !a.hidden || when(a))
    .sort((x, y) => (sort.down ? key(y) - key(x) : key(x) - key(y)));
  const rows = el('div', { class: 'ach__rows' }, listed.map(row), hiddenLeft ? hiddenRow(hiddenLeft) : null);
  // the client's list moves a row at a time under the wheel
  let turned = 0;
  rows.addEventListener('wheel', (e) => {
    e.preventDefault();
    // a browser that counts the wheel in lines gives three to the notch
    turned += e.deltaMode === 1 ? e.deltaY * (NOTCH / 3) : e.deltaY;
    const steps = Math.trunc(turned / NOTCH);
    if (!steps) return;
    turned -= steps * NOTCH;
    rows.scrollTop += steps * PITCH;
  }, { passive: false });

  host.replaceChildren(characterSheet(),
    el('div', { class: 'ach__right' },
      summary,
      el('div', { class: 'ach__table' },
        el('div', { class: 'ach__heads' },
          el('div', { class: 'ach__h ach__h--what' }, el('span', {}, t('Achievements/Tab/AchievementDescription'))),
          heading('pct', t('Achievements/Tab/AllPlayersPercent')),
          heading('date', t('Achievements/Tab/UnlockDate'))),
        rows)));
  fetchBadges(rows);
}
