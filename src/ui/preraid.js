// =========================================================
// before the raid
//
// The game does not drop you in from a button. ESCAPE FROM TARKOV walks
// through its screens in order - who goes (PMC or Scav), where (the map of
// Tarkov and its locations) and when (the two times of day on offer), what
// is insured, then READY, the wait, the count down to deployment - with BACK
// and NEXT along the bottom of each. This is that walk.
// =========================================================

import { $, el, icon, fmtNum } from '../core/util.js';
import { on, EV } from '../core/events.js';
import { game } from '../core/state.js';
import { sfx } from '../core/audio.js';
import { MAPS } from '../data/maps.js';
import { DB } from '../game/db.js';
import { showScreen } from './shell.js';

let ctx = { geo: null, deploy: () => {} };
let step = 'side';
let side = 'pmc';
let locKey = 'factory';
let timeIx = 0;
let ticking = 0;

/** the locations in the order the game lists them */
const ORDER = ['groundzero', 'streets', 'interchange', 'customs', 'factory', 'woods', 'reserve', 'lighthouse', 'shoreline', 'labs', 'labyrinth', 'terminal', 'icebreaker'];

/**
 * Tarkov's clock runs seven times as fast as the real one; a raid can be
 * entered at that time or twelve hours off it.
 */
function tarkovTimes() {
  const ms = (Date.now() * 7 + 3 * 3600 * 1000) % (24 * 3600 * 1000);
  const a = ms / 1000;
  const b = (a + 12 * 3600) % (24 * 3600);
  return [a, b];
}
function fmtClock(sec) {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.floor(sec % 60);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(h)}:${p(m)}:${p(s)}`;
}

/** every location id on one piece of ground, and the one this character would be sent to */
function variantsOf(key) {
  return (DB.progress?.locations || []).filter((l) => l.key === key);
}
function pickLocation(key, hourSec) {
  const vs = variantsOf(key);
  const lvl = game.profile.level;
  const night = hourSec != null && (hourSec < 6 * 3600 || hourSec >= 21 * 3600);
  const base = vs.filter((l) => !/tutorial|infected|dark|event/i.test(l.slug || ''));
  let pool = base.filter((l) => (!l.maxLevel || lvl <= l.maxLevel) && !/21/.test(l.slug || ''));
  if (key === 'groundzero' && lvl > 20) pool = base.filter((l) => /21/.test(l.slug || ''));
  if (key === 'factory') pool = base.filter((l) => (night ? /night/.test(l.slug) : !/night/.test(l.slug)));
  return pool[0] || base[0] || vs[0] || null;
}

function locations() {
  const seen = new Map();
  for (const l of DB.progress?.locations || []) if (!seen.has(l.key)) seen.set(l.key, pickLocation(l.key, null) || l);
  return ORDER.filter((k) => seen.has(k)).map((k) => ({ key: k, loc: seen.get(k), playable: !!MAPS[k] }));
}

export function openPreraid() {
  step = 'side';
  side = 'pmc';
  showScreen('preraid');
  render();
}

function go(next) { step = next; sfx.ui('click'); render(); }

function frame(title, body, { back, next, nextLabel = 'NEXT', nextDisabled = false } = {}) {
  const host = $('#preraid-host');
  host.replaceChildren();
  const foot = el('div', { class: 'pr__foot' });
  const b = el('button', { class: 'ebtn ebtn--back', dataset: { sfx: 'own' } }, 'BACK');
  b.addEventListener('click', () => { sfx.ui('click'); back(); });
  foot.append(b);
  if (next) {
    const n = el('button', { class: 'ebtn ebtn--go', disabled: nextDisabled, dataset: { sfx: 'own' } }, nextLabel);
    n.addEventListener('click', () => next());
    foot.append(n);
  }
  host.append(el('div', { class: 'pr__title' }, title), el('div', { class: 'pr__body' }, body), foot);
}

function render() {
  clearInterval(ticking);
  if (step === 'side') return renderSide();
  if (step === 'location') return renderLocation();
  if (step === 'ready') return renderReady();
  if (step === 'loading') return renderLoading();
  return null;
}

// ---------------------------------------------------------
function renderSide() {
  const card = (key, name, sub, disabled, note) => {
    const c = el('button', { class: `pr-side${side === key ? ' is-active' : ''}`, disabled, dataset: { side: key, sfx: 'own', hover: 'own' } },
      el('div', { class: `pr-side__art pr-side__art--${key}` }, icon('pmc', 'ico pr-side__fig')),
      el('div', { class: 'pr-side__name' }, name),
      el('div', { class: 'pr-side__sub' }, sub),
      note ? el('div', { class: 'pr-side__note' }, note) : null);
    c.addEventListener('pointerenter', () => { if (!disabled) sfx.cue('pmc_hover'); });
    c.addEventListener('click', () => { side = key; sfx.cue('mode_click'); render(); });
    return c;
  };
  const p = game.profile;
  frame('SELECT YOUR CHARACTER', el('div', { class: 'pr-sides' },
    card('scav', 'SCAV', 'A local with whatever he was carrying', true, 'Not available'),
    card('pmc', 'PMC', `${p.name || 'PMC'} · ${p.faction || 'USEC'} · Level ${p.level}`, false, null)),
  { back: () => showScreen('menu'), next: () => go('location') });
}

// ---------------------------------------------------------
function renderLocation() {
  const locs = locations();
  if (!locs.some((l) => l.key === locKey && l.playable)) locKey = (locs.find((l) => l.playable) || locs[0])?.key;
  const [t0, t1] = tarkovTimes();
  const sel = locs.find((l) => l.key === locKey);

  const list = el('div', { class: 'pr-locs' });
  for (const l of locs) {
    const b = el('button', {
      class: `pr-loc${l.key === locKey ? ' is-active' : ''}${l.playable ? '' : ' is-locked'}`,
      disabled: !l.playable, dataset: { loc: l.key, sfx: 'own', hover: 'own' },
    },
    el('span', { class: 'pr-loc__name' }, (l.loc.name || l.key).replace(/ 21\+$/, '').toUpperCase()),
    l.playable ? null : icon('lock', 'ico'));
    b.addEventListener('pointerenter', () => { if (l.playable) sfx.cue('profile_hover'); });
    b.addEventListener('click', () => { locKey = l.key; sfx.cue('profile_click'); render(); });
    list.append(b);
  }

  const info = el('div', { class: 'pr-locinfo' });
  if (sel) {
    const loc = pickLocation(sel.key, timeIx ? t1 : t0) || sel.loc;
    const times = el('div', { class: 'pr-times' });
    [t0, t1].forEach((t, i) => {
      const b = el('button', { class: `pr-time${timeIx === i ? ' is-active' : ''}`, dataset: { sfx: 'own', ix: String(i) } }, fmtClock(t));
      b.addEventListener('click', () => { timeIx = i; sfx.ui('checkbox'); render(); });
      times.append(b);
    });
    info.append(
      el('div', { class: 'pr-locinfo__name' }, loc.name.toUpperCase()),
      el('div', { class: 'pr-locinfo__desc' }, loc.desc || ''),
      el('dl', { class: 'pr-locinfo__rows' },
        el('dt', {}, 'Raid time'), el('dd', {}, `${loc.duration || '—'} min`),
        el('dt', {}, 'Players'), el('dd', {}, loc.players || '—'),
        el('dt', {}, 'Time of day'), el('dd', {}, times)));
    ticking = setInterval(() => {
      const [a, b] = tarkovTimes();
      const nodes = info.querySelectorAll('.pr-time');
      if (nodes[0]) nodes[0].textContent = fmtClock(a);
      if (nodes[1]) nodes[1].textContent = fmtClock(b);
    }, 1000);
  }

  frame('SELECT A LOCATION', el('div', { class: 'pr-locwrap' }, list, info),
    { back: () => go('side'), next: () => go('ready'), nextDisabled: !sel || !sel.playable });
}

// ---------------------------------------------------------
function renderReady() {
  const eq = game.equipment;
  const rows = [
    ['On sling', eq.item('primary')], ['On back', eq.item('secondary')], ['Holster', eq.item('holster')],
    ['Body armor', eq.item('armor')], ['Headwear', eq.item('head')], ['Tactical rig', eq.item('rig')],
    ['Backpack', eq.item('backpack')], ['Pouch', eq.item('secure')],
  ];
  const dl = el('dl', { class: 'pr-locinfo__rows' });
  for (const [k, it] of rows) dl.append(el('dt', {}, k), el('dd', {}, it ? it.tpl.name : '—'));
  const [t0, t1] = tarkovTimes();
  const loc = pickLocation(locKey, timeIx ? t1 : t0);
  const h = game.health;
  frame('READY', el('div', { class: 'pr-ready' },
    el('div', { class: 'pr-ready__loc' }, (loc?.name || locKey).toUpperCase()),
    el('div', { class: 'pr-ready__time' }, `Time of day: ${fmtClock(timeIx ? t1 : t0)}`),
    dl,
    el('div', { class: 'pr-ready__vitals' },
      `Health ${h ? Math.ceil(h.total) : 0}/${h ? h.max : 0} · Weight ${fmtNum(Math.round(eq.weight() * 10) / 10)} kg`)),
  { back: () => go('location'), next: () => go('loading'), nextLabel: 'READY' });
}

// ---------------------------------------------------------
const LOAD_STEPS = ['Loading map', 'Loading loot', 'Loading objects', 'Awaiting session start'];

function renderLoading() {
  const host = $('#preraid-host');
  const [t0, t1] = tarkovTimes();
  const hourSec = timeIx ? t1 : t0;
  const loc = pickLocation(locKey, hourSec);
  host.replaceChildren();
  const stepEl = el('div', { class: 'pr-load__step' }, LOAD_STEPS[0]);
  const bar = el('i', {});
  const count = el('div', { class: 'pr-load__count' }, '');
  const cancel = el('button', { class: 'ebtn ebtn--back', dataset: { sfx: 'own' } }, 'BACK');
  host.append(el('div', { class: 'pr-load' },
    el('div', { class: 'pr-load__loc' }, (loc?.name || locKey).toUpperCase()),
    stepEl, el('div', { class: 'pr-load__bar' }, bar), count), el('div', { class: 'pr__foot' }, cancel));

  let alive = true;
  cancel.addEventListener('click', () => { alive = false; clearInterval(ticking); sfx.ui('click'); go('ready'); });

  const deploySec = Math.min(10, DB.progress?.deploySeconds || 10);
  const t0ms = performance.now();
  const loadMs = 2600;
  ticking = setInterval(() => {
    if (!alive) return;
    const dt = performance.now() - t0ms;
    if (dt < loadMs) {
      const f = dt / loadMs;
      bar.style.width = `${f * 100}%`;
      stepEl.textContent = LOAD_STEPS[Math.min(LOAD_STEPS.length - 1, Math.floor(f * LOAD_STEPS.length))];
      return;
    }
    bar.style.width = '100%';
    const left = deploySec - (dt - loadMs) / 1000;
    stepEl.textContent = 'Deploying in:';
    count.textContent = `00:${String(Math.max(0, Math.ceil(left))).padStart(2, '0')}`;
    cancel.hidden = true;
    if (left <= 0) {
      alive = false;
      clearInterval(ticking);
      ctx.deploy(locKey, { location: loc?.id, hour: hourSec / 3600, side });
    }
  }, 100);
}

export function initPreraid(c) {
  ctx = c;
  on(EV.SCREEN_CHANGED, (id) => { if (id !== 'preraid') clearInterval(ticking); });
}
