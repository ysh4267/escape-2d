// =========================================================
// after the raid
//
// The game walks you out the way it walked you in, a screen at a time, each
// under RAID ENDED and its own name: how it ended (EARLY EXTRACTION), YOUR
// KILL LIST, RAID STATISTICS, EXPERIENCE GAINED and AFTER RAID TREATMENT,
// with NEXT and BACK where the walk in keeps them; the last NEXT is the main
// menu, and so is MAIN MENU on the first.
//
// The places are the client's own (SessionEndUIScene), set against 1080p
// captures of 1.0.
// =========================================================

import { $, el, fmtNum } from '../core/util.js';
import { game, countMoney, takeMoney, saveSoon } from '../core/state.js';
import { sfx } from '../core/audio.js';
import { t, tRich } from '../core/i18n.js';
import { uiImg, setUiSrc } from '../core/uiart.js';
import { levelGroup, levelProgress, locationName } from '../game/db.js';
import { FX, G, PARTS } from '../raid/health.js';
import { showScreen, setBar } from './shell.js';
import { screenButton } from './kit.js';
import { conditionSections, statSection } from './overall.js';
import { renderHealthBoard, treatmentQuote } from './health-ui.js';

let result = null;
let done = () => {};
let step = 0;
/** which treatments are ticked on the last screen */
let chosen = new Set();

const STEPS = ['status', 'kills', 'stats', 'exp', 'heal'];
const two = (n) => String(n).padStart(2, '0');
const hms = (sec) => `${two(Math.floor(sec / 3600))}:${two(Math.floor((sec % 3600) / 60))}:${two(Math.floor(sec % 60))}`;

// how a raid can end: the word on the plate, the caption of the experience
// bar, the plate's colour and its glyph
const ENDS = {
  survived: { label: 'Survived', title: 'ExpBonusSurvived', tone: 'green', ico: 'exit_status_survived' },
  runner: { label: 'Ran Through', title: 'ExpBonusRunner', tone: 'grey', ico: 'exit_status_runner' },
  kia: { label: 'Killed in Action', title: 'ExpBonusKilled', tone: 'red', ico: 'exit_status_killed' },
  mia: { label: 'Missed in Action', title: 'ExpBonusMissingInAction', tone: 'red', ico: 'exit_status_missing' },
  left: { label: 'Left the Action', title: 'ExpBonusLeft', tone: 'orange', ico: 'exit_status_left' },
};
// what the red panel says to one who did not simply survive
const WARN = {
  kia: { title: 'Attention! All items, brought by you into the raid or found in it, have been lost.', label: 'Insured items can be recovered, if they were not picked up or used by anyone else.' },
  mia: { title: 'Attention! All items, brought by you into the raid or found in it, have been lost.', label: 'Insured items can be recovered, if they were not picked up or used by anyone else.' },
  runner: { title: 'Attention! You’ve completed the raid way too early.', label: 'Not enough experience gained. Therefore, you have received the Ran Through exit status.' },
  left: { title: 'Attention! You’ve left the raid and lost everything you brought or found in it.', label: 'When you leave the raid you don’t get anything and also receive Left the Action exit status.' },
};
const PART_WORD = { head: 'Head', thorax: 'Chest', stomach: 'Stomach', larm: 'LeftArm', rarm: 'RightArm', lleg: 'LeftLeg', rleg: 'RightLeg' };

export function openRaidEnd(res, onDone) {
  result = res;
  done = onDone || (() => {});
  step = 0;
  chosen = new Set();
  showScreen('raidend');
  render();
}

function leave() {
  const d = done;
  result = null;
  d();
}
function go(to) {
  if (to >= STEPS.length) { leave(); return; }
  step = Math.max(0, to);
  render();
}

function btn(label, at, run, ico = null, disabled = false) {
  return screenButton({ label, ico, cls: `pr__btn pr__btn--${at}`, disabled, onClick: run });
}
const nextBtn = () => btn(t('NEXT'), 'main', () => go(step + 1), 'icon_next');
const backBtn = () => btn(t('BACK'), 'under', () => go(step - 1));

function frame(sub, body, buttons) {
  const host = $('#raidend-host');
  host.dataset.step = STEPS[step];
  setBar('hide');
  host.replaceChildren(...[el('div', { class: 'pr__title' }, t('RAID ENDED')), el('div', { class: 'pr__sub re__sub' }, sub), ...body, ...buttons].filter(Boolean));
}

function rankImg(level, cls) {
  const img = el('img', { class: cls, alt: '' });
  setUiSrc(img, `rank${levelGroup(level) * 5}`, 'ranks');
  return img;
}
const expBadge = (cls = '') => uiImg('icon_experience_big', `re__expico ${cls}`);
const ending = () => ENDS[result.statusKey] || ENDS.survived;

function render() {
  if (!result) return;
  const s = STEPS[step];
  if (s === 'status') statusScreen();
  else if (s === 'kills') killsScreen();
  else if (s === 'stats') statsScreen();
  else if (s === 'exp') expScreen();
  else healScreen();
}

// ---------------------------------------------------------
// EARLY EXTRACTION: how it ended
// ---------------------------------------------------------
function statusScreen() {
  const p = game.profile;
  const end = ending();
  const warn = WARN[result.statusKey];
  frame(t('EARLY TERMINATION'), [
    el('div', { class: 're__level' }, rankImg(p.level, 're__rank'), el('span', {}, two(p.level))),
    el('div', { class: 'pr__figure re__fig' }, uiImg('character_pmc')),
    el('div', { class: 're__name' }, uiImg('icon_profile_big', '', { w: 24, h: 24 }), el('span', {}, p.name || 'PMC')),
    el('div', { class: 're__status' },
      el('div', { class: `re__plate re__plate--${end.tone}` }, uiImg(end.ico), el('span', {}, t(end.label))),
      el('div', { class: 're__time' }, el('span', {}, t('RAID TIME:')), uiImg('icon_time_big', '', { w: 28, h: 28 }), el('b', {}, hms(result.duration || 0)))),
    el('div', { class: 're__got' }, expBadge(), el('span', {}, fmtNum(result.exp?.total || 0))),
    warn ? el('div', { class: 're__warn' }, uiImg('icon_attention'), el('b', {}, t(warn.title)), el('span', {}, t(warn.label))) : null,
  ], [nextBtn(), btn(t('MainMenu'), 'under', leave)]);
}

// ---------------------------------------------------------
// YOUR KILL LIST
// ---------------------------------------------------------
function killsScreen() {
  const log = result.killLog || [];
  const heads = [
    { cls: 'n', label: '#' }, { cls: 'loc', label: t('LOCATIONKILLLIST') }, { cls: 'time', label: t('TIMESTAMP') }, { cls: 'who', label: t('PLAYERKILLLIST') },
    { cls: 'lvl', label: t('LVLKILLLIST') }, { cls: 'side', label: t('FACTION') }, { cls: 'how', label: t('STATUSKILLLIST') },
  ];
  const rows = log.map((k, i) => {
    const head = k.part === 'head';
    const bits = [k.weaponName, head ? null : (PART_WORD[k.part] ? t(PART_WORD[k.part]).toLowerCase() : null), `${k.dist || 0}m`].filter(Boolean).join(', ');
    return el('div', { class: 're__kill' },
      el('span', { class: 're__k re__k--n' }, String(i + 1)),
      el('span', { class: 're__k re__k--loc' }, k.location ? locationName(k.location) : (result.map || '')),
      el('span', { class: 're__k re__k--time' }, hms(Math.max(0, k.time || 0))),
      el('span', { class: 're__k re__k--who' }, k.name || t('SAVAGE')),
      // one of the machine's own carries no level
      el('span', { class: 're__k re__k--lvl' }, k.side === 'pmc' ? String(k.level || 1) : '--'),
      el('span', { class: 're__k re__k--side' }, k.side === 'pmc' ? (k.faction || 'PMC') : t('SAVAGE')),
      el('span', { class: 're__k re__k--how' }, el('b', {}, head ? t('Headshot') : t('Killed')), ` (${bits})`));
  });
  frame(t('YOUR KILL LIST'), [
    el('div', { class: 're__kills' },
      el('div', { class: 're__khead' }, heads.map((h) => el('span', { class: `re__k re__k--${h.cls}` }, h.label))),
      el('div', { class: 're__krows' }, rows),
      rows.length ? null : el('div', { class: 're__none' }, t('NO KILLS'))),
  ], [nextBtn(), backBtn()]);
}

// ---------------------------------------------------------
// RAID STATISTICS
// ---------------------------------------------------------
// records, not counts: a raid's share of them is not a figure of its own
const NOT_OF_A_RAID = new Set(['longestShot', 'killStreak', 'bestStreak', 'streak', 'lastSession']);

function statsScreen() {
  const mine = result.career || {};
  const n = (key) => (NOT_OF_A_RAID.has(key) ? 0 : Number(mine[key]) || 0);
  // only what happened is listed
  const lists = conditionSections(n).map((s) => ({ ...s, rows: s.rows.filter((r) => r.v !== 0 && r.v !== '0' && r.v !== '0l') })).filter((s) => s.rows.length);
  const banner = el('img', { class: 're__banner', alt: '' });
  setUiSrc(banner, 'banner_default', 'locations');
  frame(t('RAID STATISTICS'), [
    el('div', { class: 're__where' }, banner, el('span', {}, result.location ? locationName(result.location) : (result.map || ''))),
    el('div', { class: 're__stats' }, lists.map(statSection)),
  ], [nextBtn(), backBtn()]);
}

// ---------------------------------------------------------
// EXPERIENCE GAINED
// ---------------------------------------------------------
function expScreen() {
  const p = game.profile;
  const x = result.exp || { sections: [], base: 0, mult: 1, total: 0, before: p.exp };
  const end = ending();
  const [into, span] = levelProgress(p.exp);
  const was = Math.max(0, into - x.total);          // where the bar stood before the raid, within this level
  const lists = x.sections.map((s) => el('div', { class: 're__xsec' },
    el('div', { class: 're__xhead' }, uiImg(s.ico, 're__xico', { w: 22, h: 22 }), el('span', {}, t(s.title)), el('b', {}, fmtNum(s.sum)), expBadge('re__expico--small')),
    s.lines.map((l) => el('div', { class: 're__xrow' }, el('span', {}, l.counted ? `${t(l.label)} (${l.n})` : t(l.label)), el('b', {}, fmtNum(l.xp))))));
  frame(t('GAINED EXPERIENCE'), [
    el('div', { class: 're__band' },
      rankImg(p.level, 're__lvlico re__lvlico--now'), el('span', { class: 're__lvl re__lvl--now' }, two(p.level)),
      el('div', { class: 're__bar' },
        el('i', { class: 're__barwas', style: `--v:${span ? was / span : 1}` }),
        el('i', { class: 're__barnew', style: `--a:${span ? was / span : 1};--v:${span ? (into - was) / span : 0}` }),
        x.total ? el('div', { class: 're__gain', style: `--v:${span ? into / span : 1}` }, expBadge('re__expico--small'), el('span', {}, `+${fmtNum(x.total)}`)) : null),
      el('div', { class: 're__cur' }, el('span', {}, t('current:')), fmtNum(into)),
      span ? el('div', { class: 're__rem' }, el('span', {}, t('remaining:')), fmtNum(span - into)) : null,
      span ? rankImg(p.level + 1, 're__lvlico re__lvlico--next') : null,
      span ? el('span', { class: 're__lvl re__lvl--next' }, two(p.level + 1)) : null),
    el('div', { class: 're__xlist' }, lists),
    // the sum as the client writes it out: what was earned, times how it ended, times one
    el('div', { class: `re__plate re__bonus re__plate--${end.tone}` }, uiImg(end.ico), el('span', {}, t(end.title)),
      el('b', {}, `${x.base} * ${x.mult} * 1 = ${x.total}`), expBadge('re__expico--small')),
    el('div', { class: 're__got re__got--exp' }, expBadge(), el('span', {}, fmtNum(x.total))),
  ], [nextBtn(), backBtn()]);
}

// ---------------------------------------------------------
// AFTER RAID TREATMENT
// ---------------------------------------------------------
/** what the Therapist can put right, each with how much of it there is and what she asks */
function treatments() {
  const h = game.health;
  // her first raids with a new character are on the house
  const free = treatmentQuote().free;
  const cost = h.treatmentPrices();
  const hp = Math.round(h.max - h.total);
  const list = [
    { id: 'hp', label: 'UI/HealthTreatmentName_Health', n: hp, ico: 'health_icon' },
    { id: FX.FR, label: 'UI/HealthTreatmentName_Fracture', n: h.count(FX.FR) },
    { id: FX.LB, label: 'UI/HealthTreatmentName_LightBleeding', n: h.count(FX.LB) },
    { id: FX.HB, label: 'UI/HealthTreatmentName_HeavyBleeding', n: h.count(FX.HB) },
  ];
  return list.filter((x) => x.n > 0).map((x) => ({ ...x, cost: free ? 0 : cost[x.id] }));
}

function healScreen() {
  const h = game.health;
  const list = treatments();
  const cash = countMoney('RUB');
  const picked = list.filter((x) => chosen.has(x.id));
  const sum = picked.reduce((n, x) => n + x.cost, 0);
  const body = el('div', { class: 're__body' });
  renderHealthBoard(body, h, {});
  // how long the body would take to mend by itself, at the slowest part's pace
  const mend = Math.max(0, ...PARTS.map((part) => ((part.max - h.parts[part.key].hp) / (G.regen[part.key] || 1)) * 60));
  const all = list.length > 0 && picked.length === list.length;
  const toggle = el('button', { class: 're__treatall', type: 'button', dataset: { sfx: 'own' } }, all ? t('UI/HealthTreatmentScreen_TreatNone') : t('UI/HealthTreatmentScreen_TreatAll'));
  toggle.addEventListener('click', () => { chosen = new Set(all ? [] : list.map((x) => x.id)); sfx.ui('checkbox'); render(); });
  const rows = list.map((x) => {
    const on = chosen.has(x.id);
    const row = el('button', { class: `re__treat${on ? ' is-on' : ''}`, type: 'button', dataset: { sfx: 'own' } },
      el('i', {}), el('span', { class: 're__tname' }, t(x.label)), el('b', {}, String(x.n)),
      el('span', { class: 're__tdo' }, t('UI/HealthTreatmentAction_Health')), el('span', { class: 're__tcost' }, `${fmtNum(x.cost)} ₽`));
    row.addEventListener('click', () => { if (on) chosen.delete(x.id); else chosen.add(x.id); sfx.ui('checkbox'); render(); });
    return row;
  });
  const apply = btn(t('apply'), 'aside', () => {
    if (!picked.length || sum > cash) return;
    takeMoney(sum, 'RUB');
    h.treat(picked.map((x) => x.id));
    chosen = new Set();
    saveSoon();
    render();
  }, null, !picked.length || sum > cash);
  frame(t('UI/HealthTreatmentscreen_caption'), [
    el('div', { class: 're__hcap' }, t('UI/HealthTreatmentscreen_currentcondition')),
    body,
    el('div', { class: 're__note' }, uiImg('icon_health', '', { w: 40, h: 40 }),
      el('span', {}, t('UI/HealthTreatmentScreen_Description'), tRich('UI/HealthTreatmentScreen_TrialDescription', G.heal.trialLevels, G.heal.trialRaids))),
    el('div', { class: 're__tpanel' },
      el('div', { class: 're__tcap' }, t('UI/HealthTreatmentScreen_SelectTreatment')), list.length ? toggle : null,
      el('div', { class: 're__trows' }, rows),
      list.length ? null : el('div', { class: 're__full' }, t('UI/HealthTreatmentScreen_NothingToHeal')),
      el('div', { class: 're__ttotal' },
        el('span', {}, uiImg('icon_time_big', 're__tclock', { w: 24, h: 24 }), t('UI/HealthTreatmentScreen_RegenTime'), el('b', {}, ` ${hms(mend)}`)),
        el('span', {}, t('UI/HealthTreatmentScreen_CashInStash'), el('b', {}, ` ${fmtNum(cash)} ₽`)),
        el('span', { class: 're__tsum' }, t('UI/HealthTreatmentScreen_TotalCost'), el('b', {}, `${fmtNum(sum)} ₽`)))),
  ], [nextBtn(), backBtn(), apply]);
}

export function initRaidEnd() { /* nothing to wire: openRaidEnd is called by whoever ended the raid */ }
