// =========================================================
// before the raid
//
// ESCAPE FROM TARKOV does not drop you in. It walks through its screens in
// order, each under its title and the zone the profile plays in, each with
// its buttons in the same places: who goes (SELECT YOUR CHARACTER), where
// and at which of the two times of day (SELECT LOCATION), a last look
// (CONFIRMATION), the wait (DEPLOYING TO LOCATION) and the count down to it.
//
// The places are the client's own (MenuUIScene: MatchMaker Side Selection
// Screen, Matchmaker Location Selection, MatchMaker AcceptScreen, Matchmaker
// Time Has Come, Matchmaker Final Countdown), checked on 1080p captures of
// 1.0 and 1.0.6. Where the client stands a lit model of the character this
// stands the flat figure of the health screen.
// =========================================================

import { $, el } from '../core/util.js';
import { on, EV } from '../core/events.js';
import { game } from '../core/state.js';
import { sfx } from '../core/audio.js';
import { t } from '../core/i18n.js';
import { uiImg, setUiSrc } from '../core/uiart.js';
import { MAPS } from '../data/maps.js';
import { DB, levelGroup } from '../game/db.js';
import { PARTS } from '../raid/health.js';
import { showScreen, setBar } from './shell.js';
import { screenButton } from './kit.js';

let ctx = { deploy: () => {} };
const flow = { step: 'side', side: 'pmc', loc: null, phase: 0 };

/** whatever the screen that is up has running; stopped when another is drawn */
let running = [];
function stopRunning() {
  for (const stop of running) stop();
  running = [];
}
function every(ms, fn) {
  const id = setInterval(fn, ms);
  running.push(() => clearInterval(id));
}
function eachFrame(fn) {
  let live = true;
  const tick = (now) => { if (live) { fn(now); requestAnimationFrame(tick); } };
  requestAnimationFrame(tick);
  running.push(() => { live = false; });
}

const two = (n) => String(n).padStart(2, '0');

// ---------------------------------------------------------
// the hour and the sky
// ---------------------------------------------------------
/**
 * Tarkov's clock runs seven times as fast as the real one; a raid is entered
 * at that time or twelve hours off it. Seconds of the day, the two of them.
 */
function tarkovTimes() {
  const day = 24 * 3600;
  const a = ((Date.now() * 7) / 1000 + 3 * 3600) % day;
  return [a, (a + 12 * 3600) % day];
}
function clock(sec) {
  return `${two(Math.floor(sec / 3600))}:${two(Math.floor((sec % 3600) / 60))}:${two(Math.floor(sec % 60))}`;
}

// the sky over Tarkov, read off the real clock half an hour at a time
const SKIES = ['clearday', 'clearday', 'partlycloudday', 'partlycloudday', 'mostlycloud', 'fullcloud', 'cloudwind', 'clearwind', 'fog', 'lightrain', 'rain', 'cloudwindrain'];
function skyIcon(size) {
  let h = (Math.floor(Date.now() / 1800000) * 2654435761) >>> 0;
  h = (h ^ (h >>> 15)) >>> 0;
  const img = el('img', { class: 'pr__sky', alt: '', width: size, height: size });
  setUiSrc(img, SKIES[h % SKIES.length], 'weather');
  return img;
}

// ---------------------------------------------------------
// the locations
// ---------------------------------------------------------
/** the middle of each location's mark on the map of the region, in the 1080p frame */
const NODES = {
  icebreaker: [333, 203], labs: [823, 162], groundzero: [870, 215], woods: [633, 274], streets: [799, 305],
  factory: [641, 392], customs: [704, 432], lighthouse: [364, 440], reserve: [554, 471], interchange: [791, 511],
  labyrinth: [463, 539], shoreline: [443, 558], terminal: [489, 667],
};
/** the dotted ways between them */
const ROUTES = [
  ['woods', 'reserve'], ['woods', 'factory'], ['woods', 'lighthouse'], ['reserve', 'customs'], ['reserve', 'lighthouse'],
  ['lighthouse', 'shoreline'], ['shoreline', 'terminal'], ['factory', 'customs'], ['factory', 'labs'],
  ['customs', 'interchange'], ['interchange', 'streets'], ['streets', 'labs'], ['streets', 'groundzero'],
];
const BANNER = {
  factory: 'banner_factory4', customs: 'banner_bigmap', woods: 'banner_woods', lighthouse: 'banner_lighthouse',
  shoreline: 'banner_shoreline', reserve: 'banner_rezervbase', interchange: 'banner_interchange',
  streets: 'banner_tarkovstreets', labs: 'banner_laboratory', groundzero: 'banner_sandbox',
};

/** every location id on one piece of ground, and the one this character would be sent to at an hour */
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
/** the locations on the map: its name there is the plain one, whatever the hour makes of it */
function locations() {
  return Object.keys(NODES).filter((key) => variantsOf(key).length).map((key) => ({
    key, name: (pickLocation(key, 12 * 3600) || variantsOf(key)[0]).name.replace(/ 21\+$/, ''), open: !!MAPS[key],
  }));
}
/** what was chosen: the ground, the hour of the phase picked, and the location that makes */
function chosen() {
  const hour = tarkovTimes()[flow.phase];
  const l = locations().find((x) => x.key === flow.loc);
  return l ? { ...l, hour, loc: pickLocation(l.key, hour) } : null;
}

// ---------------------------------------------------------
// the frame of a screen
// ---------------------------------------------------------
// a button's place is the same on every screen: NEXT over BACK down the
// middle, one more to either side of them
const BUTTONS = {
  next: { at: 'main', label: 'NEXT', ico: 'icon_next' },
  ready: { at: 'main', label: 'READY' },
  back: { at: 'under', label: 'BACK' },
  readyAside: { at: 'right', label: 'READY' },
};

function button(kind, run, disabled = false) {
  const def = BUTTONS[kind];
  return screenButton({ label: t(def.label), ico: def.ico, cls: `pr__btn pr__btn--${def.at}`, disabled, onClick: run });
}

/**
 * @param {{ title: string, body: (Node|null)[], buttons: Node[], bar?: 'show'|'dim'|'hide', sub?: boolean }} o
 */
function frame(o) {
  const host = $('#preraid-host');
  host.dataset.step = flow.step;
  setBar(o.bar || 'show');
  host.replaceChildren(...[
    el('div', { class: 'pr__title' }, o.title),
    o.sub === false ? null : el('div', { class: 'pr__sub' }, t('ESessionMode/Pve')),
    ...o.body, ...o.buttons,
  ].filter(Boolean));
}

function go(step) {
  flow.step = step;
  render();
}

function render() {
  stopRunning();
  if (flow.step === 'side') sideScreen();
  else if (flow.step === 'location') locationScreen();
  else if (flow.step === 'confirm') confirmScreen();
  else if (flow.step === 'deploying') deployingScreen();
  else if (flow.step === 'countdown') countdownScreen();
}

export function openPreraid() {
  flow.step = 'side';
  flow.side = 'pmc';
  showScreen('preraid');
  render();
}

/** the flat figure where the client stands the character's model */
function figure(cls) {
  return el('div', { class: `pr__figure ${cls}` }, uiImg('character_pmc'));
}

function logo(cls) {
  const img = el('img', { class: `pr__logo ${cls}`, alt: '' });
  setUiSrc(img, 'escape_from_tarkov_logo', 'logo');
  return img;
}

// ---------------------------------------------------------
// SELECT YOUR CHARACTER
// ---------------------------------------------------------
const SIDE_TEXT = { USEC: { key: 'USEC Matchmaker' }, BEAR: { key: 'BEAR Matchmaker' } };
const WARNING = {
  bad: { title: 'matchmaker/health_is_low', label: 'matchmaker/return_and_heal_command' },
  low: { title: 'matchmaker/health_is_not_full', label: 'matchmaker/return_and_heal_advise' },
};

/** the plate over the PMC when the body is not whole: red when it is bad, yellow when it is only not full */
function healthWarning() {
  const h = game.health;
  if (!h) return null;
  const lost = PARTS.some((part) => h.parts[part.key].hp <= 0);
  if (!lost && h.total >= h.max) return null;
  const kind = lost || h.total < h.max / 2 ? 'bad' : 'low';
  return el('div', { class: `prs__warn prs__warn--${kind}` },
    uiImg('icon_attention'), el('b', {}, t(WARNING[kind].title)), el('span', {}, t(WARNING[kind].label)));
}

function sideScreen() {
  const p = game.profile;
  const pmc = el('button', { class: `prs__side prs__side--pmc${flow.side === 'pmc' ? ' is-on' : ''}`, type: 'button', dataset: { sfx: 'own', hover: 'own' } }, t('Pmc'));
  const pmcZone = el('button', { class: 'prs__zone prs__zone--pmc', type: 'button', dataset: { sfx: 'own', hover: 'own' } });
  for (const b of [pmc, pmcZone]) {
    b.addEventListener('pointerenter', () => sfx.cue('pmc_hover'));
    b.addEventListener('click', () => { if (flow.side !== 'pmc') { flow.side = 'pmc'; sfx.cue('mode_click'); render(); } });
  }
  frame({
    title: t('SELECT YOUR  CHARACTER'),
    body: [
      logo('prs__logo'),
      // no Scav goes out of this build yet: the side stands unlit and shut, as the client shuts it between Scav raids
      figure('prs__fig prs__fig--scav is-shut'),
      figure('prs__fig prs__fig--pmc'),
      pmcZone,
      el('div', { class: 'prs__side prs__side--scav is-shut' }, t('SAVAGE')),
      el('div', { class: 'prs__note prs__note--scav' }, uiImg('icon_lock_small'), el('span', {}, t('UNAVAILABLE'))),
      pmc,
      el('div', { class: 'prs__note prs__note--pmc' }, t('YOUR MAIN CHARACTER')),
      healthWarning(),
      el('div', { class: 'prs__about' }, el('div', {}, t((SIDE_TEXT[p.faction] || SIDE_TEXT.USEC).key))),
    ],
    buttons: [button('next', () => go('location')), button('back', () => showScreen('menu'))],
  });
}

// ---------------------------------------------------------
// SELECT LOCATION
// ---------------------------------------------------------
function node(l) {
  const [x, y] = NODES[l.key];
  const b = el('button', {
    class: `prl__node${l.open ? '' : ' is-locked'}${flow.loc === l.key ? ' is-on' : ''}${l.key === 'labs' ? ' is-secret' : ''}`, type: 'button', disabled: !l.open,
    style: { left: `${x}px`, top: `${y}px` }, dataset: { loc: l.key, sfx: 'own', hover: 'own' },
  },
  uiImg(l.open ? 'icon_available' : 'icon_lock_small', 'prl__mark'),
  el('span', { class: 'prl__name' }, l.name),
  // a location with no ground under it in this build cannot be gone to
  l.open ? null : el('span', { class: 'prl__note' }, t('NOT AVAILABLE')));
  b.addEventListener('pointerenter', () => { if (l.open) sfx.cue('profile_hover'); });
  b.addEventListener('click', () => { if (flow.loc !== l.key) { flow.loc = l.key; sfx.cue('profile_click'); render(); } });
  return b;
}

function route(a, b) {
  const [x0, y0] = NODES[a], [x1, y1] = NODES[b];
  return el('i', {
    class: 'prl__route',
    style: { left: `${x0}px`, top: `${y0}px`, width: `${Math.hypot(x1 - x0, y1 - y0)}px`, transform: `rotate(${Math.atan2(y1 - y0, x1 - x0)}rad)` },
  });
}

function infoPanel(c) {
  const banner = el('img', { class: 'prl__banner', alt: '' });
  setUiSrc(banner, BANNER[c.key] || 'banner_default', 'locations');
  return el('div', { class: 'prl__info' },
    // the zone's own block: a raid here is never played on their servers
    el('div', { class: 'prl__serverhead' }, t('PveServerModeHeader')),
    el('div', { class: 'prl__servercheck' }, el('i', {}), el('span', {}, t('PveServerModeCheckmark'))),
    el('i', { class: 'prl__rule' }),
    banner,
    el('div', { class: 'prl__locname' }, c.name),
    el('div', { class: 'prl__about' },
      el('div', { class: 'prl__desc' }, c.loc.desc || ''),
      el('div', { class: 'prl__stats' },
        el('span', {}, uiImg('icon_timer'), `${c.loc.duration} ${t('MinutesShort')}`),
        el('span', {}, uiImg('icon_players'), String(c.loc.players || '')))));
}

function locationScreen() {
  const locs = locations();
  if (flow.loc && !locs.some((l) => l.key === flow.loc && l.open)) flow.loc = null;
  const c = chosen();
  const mapArt = el('img', { class: 'prl__map', alt: '' });
  setUiSrc(mapArt, 'region_map_external', 'locselect');

  const body = [
    mapArt,
    ...ROUTES.filter(([a, b]) => variantsOf(a).length && variantsOf(b).length).map(([a, b]) => route(a, b)),
    ...locs.map(node),
  ];
  const buttons = [button('back', () => go('side'))];
  if (c) {
    const phase = (ix) => {
      const b = el('button', { class: `prl__phase${flow.phase === ix ? ' is-on' : ''}`, type: 'button', dataset: { sfx: 'own' } },
        el('i', {}), el('span', {}, clock(tarkovTimes()[ix])));
      b.addEventListener('click', () => { if (flow.phase !== ix) { flow.phase = ix; sfx.ui('checkbox'); render(); } });
      return b;
    };
    const phases = [phase(0), phase(1)];
    every(250, () => { tarkovTimes().forEach((sec, i) => { phases[i].lastChild.textContent = clock(sec); }); });
    body.push(infoPanel(c),
      el('div', { class: 'pr__cond prl__cond' },
        el('div', { class: 'prl__phasecap' }, t('SELECT TIME PHASE:')), ...phases,
        el('div', { class: 'prl__skycap' }, t('CURRENT WEATHER CONDITIONS:')), skyIcon(50)));
    buttons.push(button('next', () => go('confirm')), button('readyAside', () => go('deploying')));
  }
  frame({ title: t('SELECT LOCATION'), body, buttons });
}

// ---------------------------------------------------------
// CONFIRMATION
// ---------------------------------------------------------
function confirmScreen() {
  const p = game.profile;
  const c = chosen();
  if (!c) { go('location'); return; }
  const rank = el('img', { class: 'prc__rank', alt: '' });
  setUiSrc(rank, `rank${levelGroup(p.level) * 5}`, 'ranks');
  const time = el('div', { class: 'prc__value' }, clock(c.hour));
  every(250, () => { time.textContent = clock(tarkovTimes()[flow.phase]); });
  frame({
    title: t('CONFIRMATION'), bar: 'hide',
    body: [
      el('div', { class: 'prc__level' }, rank, el('span', {}, two(p.level))),
      figure('prc__fig'),
      el('div', { class: 'prc__name' }, uiImg('icon_profile_big', '', { w: 20, h: 20 }), el('span', {}, p.name || 'PMC')),
      // there is nobody to go with: the two group buttons stand where the client has them, out of use
      el('div', { class: 'prc__group' }, t('StartLookingForGroup')),
      el('div', { class: 'prc__group prc__group--make' }, t('CreateGroup')),
      el('div', { class: 'pr__cond prc__cond' },
        el('div', { class: 'prc__cell' }, el('div', { class: 'prc__cap' }, t('CURRENT LOCATION:')), el('div', { class: 'prc__value' }, c.name)),
        el('div', { class: 'prc__cell' }, el('div', { class: 'prc__cap' }, t('CURRENT INGAME TIME:')), time),
        el('div', { class: 'prc__cell prc__cell--sky' }, el('div', { class: 'prc__cap' }, t('CURRENT WEATHER CONDITIONS:')), skyIcon(40))),
    ],
    buttons: [button('ready', () => go('deploying')), button('back', () => go('location'))],
  });
}

// ---------------------------------------------------------
// DEPLOYING TO LOCATION
// ---------------------------------------------------------
// what the wait is spent on, a segment of the bar each; the mark on the bar
// stands after the fifth
const STAGES = [
  { key: 'Matchmaker/MatchingProgress/Stage/BundlesLoading' },
  { key: 'Matchmaker/MatchingProgress/Stage/MapLoading' },
  { key: 'Matchmaker/MatchingProgress/Stage/MapLoading' },
  { key: 'Matchmaker/MatchingProgress/Stage/GameWorldCreating' },
  { key: 'Matchmaker/MatchingProgress/Stage/PoolsCreating' },
  { key: 'Matchmaker/MatchingProgress/Stage/LootBundlesLoading' },
  { key: 'Matchmaker/MatchingProgress/Stage/LootPoolsCreating' },
  { key: 'Matchmaker/MatchingProgress/Stage/DataCaching' },
  { key: 'Matchmaker/MatchingProgress/Stage/LocalGameStarting' },
];
/** how long a segment takes to fill */
const STAGE_MS = 520;

function deployingScreen() {
  const p = game.profile;
  const c = chosen();
  if (!c) { go('location'); return; }
  const banner = el('img', { class: 'prd__banner', alt: '' });
  setUiSrc(banner, BANNER[c.key] || 'banner_default', 'locations');
  const rank = el('img', { class: 'prd__rank', alt: '' });
  setUiSrc(rank, `rank${levelGroup(p.level) * 5}`, 'ranks');

  const stage = el('div', { class: 'prd__stage' }, t(STAGES[0].key));
  const pct = el('div', { class: 'prd__pct' }, '0%');
  const segs = STAGES.map((_, i) => el('i', { class: i === 4 ? 'is-mark' : '' }));
  const spent = el('b', {}, '00:00');
  const back = button('back', () => go('confirm'));
  back.classList.add('prd__back');

  frame({
    title: t('DEPLOYING ON LOCATION'), bar: 'dim',
    body: [
      logo('prd__logo'),
      figure('prd__fig'),
      el('div', { class: 'prd__party' },
        rank, el('span', { class: 'prd__lvl' }, two(p.level)),
        el('span', { class: 'prd__avatar' }, uiImg('allscreens_defaultplayer_icon_0', '', { w: 29, h: 29 })),
        uiImg('icon_profile_big', 'prd__acct', { w: 18, h: 18 }), el('span', { class: 'prd__nick' }, p.name || 'PMC')),
      el('div', { class: 'prd__locname' }, c.name),
      banner,
      el('div', { class: 'prd__about' }, el('b', {}, c.name), el('span', {}, c.loc.desc || '')),
      el('div', { class: 'prd__dots' }, el('i', { class: 'is-on' }), el('i', {}), el('i', {}), el('i', {})),
      el('div', { class: 'prd__progress' },
        stage, pct,
        el('div', { class: 'prd__eta' }, uiImg('spinner_big', 'prd__spin', { w: 35, h: 35 })),
        el('div', { class: 'prd__bar' }, segs),
        el('div', { class: 'prd__spent' }, el('span', {}, t('Matchmaker/MatchingProgress/Time/Loading')), spent)),
    ],
    buttons: [back],
  });

  const began = performance.now();
  eachFrame((now) => {
    // a frame's own time can be a hair before the moment this began
    const ms = Math.max(0, now - began);
    const at = Math.min(STAGES.length, Math.floor(ms / STAGE_MS));
    segs.forEach((s, i) => { s.classList.toggle('is-done', i < at); s.classList.toggle('is-now', i === at); });
    if (at < STAGES.length) stage.textContent = t(STAGES[at].key);
    pct.textContent = `${Math.min(100, Math.floor((ms / (STAGES.length * STAGE_MS)) * 100))}%`;
    spent.textContent = `${two(Math.floor(ms / 60000))}:${two(Math.floor(ms / 1000) % 60)}`;
    // the last of it cannot be called off
    back.hidden = at >= STAGES.length - 1;
    if (at >= STAGES.length) go('countdown');
  });
}

// ---------------------------------------------------------
// the count down
// ---------------------------------------------------------
/** seconds from GET READY to the ground */
const COUNT = 10;

function countdownScreen() {
  const p = game.profile;
  const c = chosen();
  if (!c) { go('location'); return; }
  const time = el('div', { class: 'prn__time' }, '');
  const host = $('#preraid-host');
  host.dataset.step = flow.step;
  setBar('hide');
  host.replaceChildren(
    logo('prn__logo'),
    el('div', { class: 'prn__name' }, uiImg('icon_profile_big', '', { w: 27, h: 27 }), el('span', {}, p.name || 'PMC')),
    el('div', { class: 'prn__note' }, t('YOUR MAIN CHARACTER')),
    el('div', { class: 'prn__ready' }, el('span', {}, t('GET READY!'))),
    el('div', { class: 'prn__cap' }, t('Deploying in:')),
    uiImg('icon_time_big', 'prn__clock', { w: 43, h: 43 }),
    time);

  const began = performance.now();
  let gone = false;
  eachFrame((now) => {
    const left = Math.min(COUNT * 1000, Math.max(0, COUNT * 1000 - (now - began)));
    const s = Math.floor(left / 1000);
    time.textContent = `${two(Math.floor(s / 60))}:${two(s % 60)}.${String(Math.floor(left % 1000)).padStart(3, '0')}`;
    // it stands at nought a moment before the ground comes up
    if (!gone && now - began >= COUNT * 1000 + 600) {
      gone = true;
      stopRunning();
      ctx.deploy(c.key, { location: c.loc?.id, hour: c.hour / 3600, side: flow.side });
    }
  });
}

export function initPreraid(c) {
  ctx = c;
  on(EV.SCREEN_CHANGED, (id) => { if (id !== 'preraid') stopRunning(); });
}
