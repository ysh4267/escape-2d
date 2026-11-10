// =========================================================
// the character screen's OVERALL tab
//
// The client's OverallScreen, off its hierarchy and 1080p captures of 1.1.5
// and 1.2:
//
//   left   the character's sheet: the badge of its level bracket and the
//          level in large figures, six career figures in short beside them,
//          the side's emblem, the figure itself, and under it the nickname
//          and the experience earned
//   right  OVERALL / PMC / SCAV, then the dashboard - raids, survived, KIA,
//          MIA, AWOL, kills, time in raid over a second line of rates - and
//          under STATISTICS the long lists, two side by side
//
// The figures are the profile's own counters (core/state.js addStat; the
// raid and main.js keep them). A row of the client's that this build has no
// counter behind is left out rather than shown as a nought.
// =========================================================

import { $, el, fmtDate, fmtNum } from '../core/util.js';
import { game } from '../core/state.js';
import { t, tRich } from '../core/i18n.js';
import { uiImg, setUiSrc } from '../core/uiart.js';
import { sfx } from '../core/audio.js';
import { levelGroup } from '../game/db.js';
import { PARTS } from '../raid/health.js';

let sub = 'overall';

const two = (n) => String(n).padStart(2, '0');
/** a figure to two places at most: 16.5, 45.56, 0 */
const round2 = (v) => String(Math.round((v || 0) * 100) / 100);
const whole = (v) => String(Math.round(v || 0));
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);

const date = (ms) => (ms ? fmtDate(ms) : '-');

/** hours and minutes, through the client's own format string */
function span(seconds) {
  const m = Math.floor((seconds || 0) / 60);
  return t('{0}h{1:00}m', Math.floor(m / 60), m % 60);
}

/** minutes and seconds: how long a raid lasts on average */
function clock(seconds) {
  const s = Math.round(seconds || 0);
  return `${Math.floor(s / 60)}:${two(s % 60)}`;
}

// figures that are a record or a date and not a count: the two sides of a
// career are not added together for these
const NOT_SUMMED = new Set(['bestStreak', 'killStreak', 'longestShot', 'lastSession']);

/**
 * The career's counters for one of its sides. A Scav's raids are kept apart
 * under stats.scav; OVERALL is the two together.
 * @returns {(key: string) => number}
 */
function career(side) {
  const p = game.profile;
  const st = p.stats || {};
  const pmc = { ...st, raids: p.raids || 0, survived: p.survived || 0, kia: st.kia ?? p.died ?? 0 };
  const scav = st.scav || {};
  return (key) => {
    const a = side === 'scav' ? 0 : Number(pmc[key]) || 0;
    const b = side === 'pmc' ? 0 : Number(scav[key]) || 0;
    return NOT_SUMMED.has(key) ? Math.max(a, b) : a + b;
  };
}

/** what kind of survivor the experience earned says the character is */
function survivorClass(n) {
  const kinds = [
    [n('expKill'), () => t('Neutralizer')], [n('expLoot'), () => t('Marodeur')],
    [n('expHeal'), () => t('Paramedic')], [n('expSurvive'), () => t('Survivor')],
  ].sort((a, b) => b[0] - a[0]);
  return kinds[0][0] > 0 ? kinds[0][1]() : t('Unknown');
}

/** the part that has taken the least: the first of them when nothing has been hit */
function leastDamaged(n) {
  const name = {
    head: () => t('Head'), thorax: () => t('Chest'), stomach: () => t('Stomach'),
    larm: () => t('LeftArm'), rarm: () => t('RightArm'), lleg: () => t('LeftLeg'), rleg: () => t('RightLeg'),
  };
  let best = PARTS[0].key;
  for (const part of PARTS) if (n(`hurt_${part.key}`) < n(`hurt_${best}`)) best = part.key;
  return name[best]();
}

function stashWorth() {
  let v = 0;
  for (const it of game.stash.items()) v += it.value;
  return v;
}

/**
 * The character's sheet, the left third of OVERALL and of ACHIEVEMENTS alike:
 * the level and its badge, the career in six short figures, the side's
 * emblem, the figure, the nickname and the experience. Its figures are
 * always the whole career's.
 */
export function characterSheet() {
  const p = game.profile;
  const all = career('overall');
  const badge = el('img', { class: 'ov__rank', alt: '' });
  setUiSrc(badge, `rank${levelGroup(p.level) * 5}`, 'ranks');
  const side = el('img', { class: 'ov__side', alt: '' });
  setUiSrc(side, p.faction === 'BEAR' ? 'icon_bear' : 'icon_usec', 'factions');
  return el('div', { class: 'ov__sheet' },
    el('div', { class: 'ov__levelbar' }, badge, el('span', { class: 'ov__level' }, two(p.level)),
      el('div', { class: 'ov__shorts' },
        el('div', {}, tRich('Raids Short', all('raids'))),
        el('div', {}, tRich('Kills Short', all('kills'))),
        el('div', {}, tRich('Leave Rate Short', pct(all('left'), all('raids')))),
        el('div', {}, tRich('Survival Rate Short', pct(all('survived'), all('raids')))),
        el('div', {}, tRich('Kills Death Rate Short', round2(all('kills') / Math.max(1, all('kia'))))),
        el('div', {}, tRich('Online Time Short', round2(all('raidSec') / 3600))))),
    side,
    uiImg('cross', 'ov__prestige'),
    // the figure is the client's own flat one until there is a model to turn
    el('div', { class: 'ov__figure' }, uiImg('character_pmc')),
    el('div', { class: 'ov__who' },
      el('div', { class: 'ov__nick' }, uiImg('icon_profile_big', '', { w: 27, h: 27 }), el('span', {}, p.name || 'PMC')),
      el('div', { class: 'ov__exp' }, uiImg('icon_experience_big'), el('b', {}, fmtNum(p.exp || 0)))));
}

export function renderOverall() {
  const host = $('#overall-host');
  if (!host) return;
  const p = game.profile;
  const n = career(sub);
  const lifetime = p.registered ? (Date.now() - p.registered) / 1000 : 0;

  // ---- OVERALL / PMC / SCAV ----
  const tabs = el('div', { class: 'ov__tabs' },
    [{ id: 'overall', label: 'OVERALL' }, { id: 'pmc', label: 'PMC' }, { id: 'scav', label: 'SCAV' }].map((def) => {
      const b = el('button', { class: `dbtn ov__tab${sub === def.id ? ' is-hover' : ''}`, type: 'button', dataset: { sfx: 'own' } }, t(def.label));
      b.addEventListener('click', () => { if (sub !== def.id) { sub = def.id; sfx.ui('click'); renderOverall(); } });
      return b;
    }));

  // ---- the dashboard ----
  const raids = n('raids');
  const rate = (v) => (raids ? `${v} %` : '-');
  const first = [
    { ico: 'icon_survival_big', v: raids, label: '(R) Raids' },
    { ico: 'icon_survived_big', v: n('survived'), label: '(S) Survived' },
    { ico: 'icon_notsurvive_big', v: n('kia'), label: 'KIA' },
    { ico: 'icon_mia_big', v: n('mia'), label: 'MIA' },
    { ico: 'icon_leave_big', v: n('left'), label: '(L) AWOL' },
    { ico: 'icon_kills_big', v: n('kills'), label: '(K) Kills' },
    { ico: 'icon_time', v: span(n('raidSec')), label: 'Online', cls: ' ov__cell--time' },
  ];
  const second = [
    { v: n('runner'), label: '(RT) Runs' },
    { v: rate(pct(n('survived'), raids)), label: '(S/R) Survival rate' },
    { v: raids ? clock(n('raidSec') / raids) : '-', label: 'Average lifetime' },
    { v: n('bestStreak'), label: 'Max S in a row' },
    { v: rate(pct(n('left'), raids)), label: '(LR) Leave rate' },
    { v: raids ? round2(n('kills') / Math.max(1, n('kia'))) : '-', label: '(K/D)' },
    { v: span(lifetime), label: 'Overall lifetime' },
  ];
  const cell = (c) => el('div', { class: `ov__cell${c.cls || ''}` },
    [c.ico ? uiImg(c.ico, 'ov__cellico') : null,
      el('div', { class: 'ov__count' }, String(c.v)), el('div', { class: 'ov__desc' }, t(c.label))].filter(Boolean));
  const board = el('div', { class: 'ov__board' },
    el('div', { class: 'ov__line ov__line--first' }, first.map(cell)),
    el('div', { class: 'ov__line ov__line--second' }, second.map(cell)));

  // ---- STATISTICS ----
  const sections = [
    { ico: 'icon_statscategory_overall', title: 'Common stats', rows: [
      { key: 'registrationDate', v: date(p.registered) },
      { key: 'lastSession', v: date(n('lastSession')) },
      { key: 'survClass', v: survivorClass(n) },
      { key: 'expKill', v: whole(n('expKill')) },
      { key: 'expLoot', v: whole(n('expLoot')) },
      { key: 'expHeal', v: whole(n('expHeal')) },
      { key: 'expSurvive', v: whole(n('expSurvive')) },
      { key: 'maxWinStreak', v: n('bestStreak') },
      { key: 'currWinStreak', v: n('streak') },
      { key: 'CommonValue', v: whole(stashWorth()) },
    ] },
    { ico: 'icon_health', title: 'Health and physical condition', rows: [
      // a point of health is a millilitre: the client writes the litres
      { key: 'bloodLost', v: `${round2(n('bloodLost') / 1000)}l` },
      { key: 'bodypartsLost', v: n('bodypartsLost') },
      { key: 'lessDamagedPart', v: leastDamaged(n) },
      { key: 'hpHealed', v: round2(n('hpHealed')) },
      { key: 'fractures', v: n('fractures') },
      { key: 'contusions', v: n('contusions') },
      { key: 'dehydrations', v: n('dehydrations') },
      { key: 'exhaustions', v: n('exhaustions') },
      { key: 'drinksUsed', v: n('drinksUsed') },
      { key: 'foodUsed', v: n('foodUsed') },
      { key: 'medicineUsed', v: n('medicineUsed') },
    ] },
    { ico: 'icon_statscategory_looting', title: 'Looting', rows: [
      { key: 'kmTraveled', v: round2(n('metresTraveled') / 1000) },
      { key: 'StatFoundMoneyUSD', v: n('foundUSD') },
      { key: 'StatFoundMoneyEUR', v: n('foundEUR') },
      { key: 'StatFoundMoneyRUB', v: n('foundRUB') },
      { key: 'bodiesLooted', v: n('bodiesLooted') },
      { key: 'unlockedSafes', v: n('unlockedSafes') },
      { key: 'weapFound', v: n('weapFound') },
      { key: 'ammoFound', v: n('ammoFound') },
      { key: 'modsFound', v: n('modsFound') },
      { key: 'throwFound', v: n('throwFound') },
      { key: 'foodDrinksFound', v: n('foodDrinksFound') },
      { key: 'keysFound', v: n('keysFound') },
      { key: 'bartitemsFound', v: n('bartitemsFound') },
      { key: 'eqipFound', v: n('eqipFound') },
    ] },
    { ico: 'icon_statscategory_combat', title: 'Combat', rows: [
      { key: 'damAppliedBody', v: whole(n('damAppliedBody')) },
      { key: 'damAppliedArmor', v: whole(n('damAppliedArmor')) },
      { key: 'ammoUsed', v: n('shots') },
      { key: 'hitCount', v: n('hitCount') },
      { key: 'fatalHits', v: n('fatalHits') },
      { key: 'headshots', v: n('headshots') },
      { key: 'longshotDist', v: round2(n('longestShot')) },
      { key: 'savageKills', v: n('killsScav') },
      { key: 'pmcKills', v: n('killsPmc') },
      { key: 'bossKills', v: n('killsBoss') },
      { key: 'killStreak', v: n('killStreak') },
    ] },
  ];
  const section = (s) => el('div', { class: 'ov__sec' },
    el('div', { class: 'ov__sechead' }, el('span', { class: 'ov__secico' }, uiImg(s.ico)), el('span', {}, t(s.title))),
    s.rows.map((r) => el('div', { class: 'ov__row' }, el('span', { class: 'ov__k' }, t(r.key)), el('span', { class: 'ov__v' }, String(r.v)))));
  // the lists stand two abreast, and the next two start under the longer one
  const pairs = [];
  for (let i = 0; i < sections.length; i += 2) {
    pairs.push(el('div', { class: 'ov__pair' }, sections.slice(i, i + 2).map(section)));
  }

  const keep = host.querySelector('.ov__scroll')?.scrollTop || 0;
  host.replaceChildren(characterSheet(),
    el('div', { class: 'ov__right' }, tabs, board, el('div', { class: 'ov__stat' }, t('STATISTICS')),
      el('div', { class: 'ov__scroll' }, pairs)));
  host.querySelector('.ov__scroll').scrollTop = keep;
}
