// =========================================================
// the frame every screen sits in: which screen is up, the strip along the
// bottom, and the notifications in the corner
//
// Outside a raid the game is a handful of full screens - the main menu, the
// character screen with its tabs, the list of traders and each trader's own
// screen, the hideout, the flea market, the handbook, the messenger - and a
// bar along the bottom edge that jumps between them. Going into a raid takes
// the bar away; coming out the far side puts it back.
// =========================================================

import { $, $$, el, icon } from '../core/util.js';
import { on, emit, EV } from '../core/events.js';
import { sfx } from '../core/audio.js';
import { t } from '../core/i18n.js';
import { uiIcon, uiImg } from '../core/uiart.js';

let current = 'boot';
let previous = 'menu';

/** screens that carry the bottom bar */
const BAR_SCREENS = new Set(['menu', 'character', 'traders', 'trader', 'hideout', 'flea', 'handbook', 'messenger', 'settings']);

/**
 * The bar, in the game's order and the game's words: MAIN MENU, HIDEOUT and
 * the squad slots at the left end, everything else at the right. `screen` is
 * where an entry goes; `match` is every screen it stays lit on; an entry with
 * no screen is one this build has nothing behind and is drawn switched off,
 * the way the client draws an entry that is not available.
 */
const BAR = [
  { key: 'menu', label: 'MAINMENU', screen: 'menu', match: ['menu'], icon: 'mainmenu_taskbar_icon', side: 'left' },
  { key: 'hideout', label: 'HIDEOUT', screen: 'hideout', match: ['hideout'], icon: 'hideout_taskbar_icon', side: 'left' },
  { key: 'character', label: 'CHARACTER', screen: 'character', match: ['character'], icon: 'mainmenu_character_icon' },
  { key: 'traders', label: 'MERCHANTS', screen: 'traders', match: ['traders', 'trader'], icon: 'icon_traders' },
  { key: 'flea', label: 'RAG FAIR', screen: 'flea', match: ['flea'], icon: 'icon_flea_market' },
  { key: 'builds', label: 'PRESETS', screen: null, match: [], icon: 'icon_presets_big' },
  { key: 'handbook', label: 'HANDBOOK', screen: 'handbook', match: ['handbook'], icon: 'handbook_icon' },
  { key: 'messenger', label: 'MAIL', screen: 'messenger', match: ['messenger'], icon: 'icon_messenger_selected' },
  { key: 'survey', label: 'SURVEY', screen: null, match: [], icon: 'icon_eft_gamepull_mini' },
];

/** the build of the game this follows, for the mark over the bar's left end */
const GAME_VERSION = '1.3.0';

/** badge counts shown on bar entries, supplied by whoever knows them */
const badges = {};
export function setBarBadge(key, fn) { badges[key] = fn; }

/**
 * An entry may open a window over whatever screen is up instead of going to
 * a screen of its own - the messenger does: key -> { toggle(), isOpen() }.
 * The entry stays lit for as long as its window is open.
 */
const barHandlers = {};
export function setBarHandler(key, handler) { barHandlers[key] = handler; paintBar(); }

/** guards a screen may put on leaving it (a drag in progress, a table with items on it) */
const leaveGuards = [];
export function onLeaveScreen(fn) { leaveGuards.push(fn); }

export function showScreen(id, arg = null) {
  if (id !== current) {
    for (const g of leaveGuards) {
      try { g(current, id); } catch (err) { console.error('[shell] leave guard', err); }
    }
    previous = current;
  }
  for (const s of $$('.screen')) s.classList.toggle('is-active', s.id === `screen-${id}`);
  current = id;
  document.body.dataset.screen = id;
  const bar = $('#bottombar');
  if (bar) { bar.hidden = !BAR_SCREENS.has(id); bar.classList.remove('is-dim'); }
  paintBar();
  emit(EV.SCREEN_CHANGED, id, arg);
}

/**
 * The walk into a raid is one screen here and several in the game, and they
 * do not agree about the bar: the first ones keep it, the wait for deployment
 * shows it dimmed and out of reach, the rest have none. The walk says which.
 * @param {'show'|'dim'|'hide'} mode
 */
export function setBar(mode) {
  const bar = $('#bottombar');
  if (!bar) return;
  bar.hidden = mode === 'hide';
  bar.classList.toggle('is-dim', mode === 'dim');
}

export function currentScreen() { return current; }
export function previousScreen() { return previous; }

/**
 * Older call sites named the panes of the one-screen shell this replaced.
 * They are kept so nothing has to learn the new names at once.
 */
export function showPane(name) {
  if (name === 'stash') emit('shell:character', 'gear');
  else if (name === 'health') emit('shell:character', 'health');
  else if (name === 'traders') showScreen('traders');
  else if (name === 'raid') showScreen('preraid');
  else emit('shell:character', name);
}

/** the top bar is gone; money is counted on the stash itself */
export function refreshTopbar() { emit('shell:money'); }

// ---------------------------------------------------------
// the bottom bar
// ---------------------------------------------------------
function buildBar() {
  const bar = $('#bottombar');
  if (!bar) return;
  bar.replaceChildren();
  const row = el('div', { class: 'bottombar__in' });
  const entry = (b) => {
    const btn = el('button', { class: 'bbtn', disabled: !b.screen, dataset: { key: b.key, sfx: 'own' } },
      uiIcon(b.icon), el('span', { class: 'bbtn__label' }, t(b.label)),
      el('span', { class: 'bbtn__badges' },
        el('span', { class: 'bbtn__badge', hidden: true, dataset: { badge: 'n' } }),
        el('span', { class: 'bbtn__badge bbtn__badge--att', hidden: true, dataset: { badge: 'att' } })));
    if (!b.screen) btn.style.opacity = '.3';
    btn.addEventListener('click', () => {
      if (!b.screen) return;
      sfx.ui('bottombar');
      if (barHandlers[b.key]) { barHandlers[b.key].toggle(); paintBar(); return; }
      if (!b.match.includes(current)) showScreen(b.screen);
      else if (b.key === 'traders' && current === 'trader') showScreen('traders');
    });
    btn.addEventListener('pointerenter', () => { if (b.screen) sfx.ui('hover'); });
    return btn;
  };
  for (const b of BAR) if (b.side === 'left') row.append(entry(b));
  // the squad: yourself and four empty places
  const squad = el('div', { class: 'squad' },
    el('span', { class: 'squad__slot' }, uiIcon('allscreens_defaultplayer_icon_0')));
  for (let i = 0; i < 4; i++) squad.append(el('span', { class: 'squad__slot squad__slot--add' }, uiIcon('allscreens_plus_small')));
  row.append(squad, el('span', { class: 'bottombar__gap' }));
  for (const b of BAR) if (b.side !== 'left') row.append(entry(b));
  row.append(el('button', { class: 'bbtn bbtn--icon', id: 'btn-settings', title: t('Settings'), dataset: { sfx: 'own' } }, uiIcon('options_icon')));
  bar.append(el('span', { class: 'bottombar__version', id: 'bar-version' }, `${GAME_VERSION} | 2D`), row);
}

export function paintBar() {
  const bar = $('#bottombar');
  if (!bar) return;
  for (const b of BAR) {
    const btn = bar.querySelector(`.bbtn[data-key="${b.key}"]`);
    if (!btn) continue;
    btn.classList.toggle('is-active', b.match.includes(current) || !!barHandlers[b.key]?.isOpen());
    const show = (which, n, extra = null) => {
      const node = btn.querySelector(`[data-badge="${which}"]`);
      node.hidden = !n;
      node.replaceChildren(n > 99 ? '>99' : String(n || ''));
      if (n && extra) node.append(extra());
    };
    let n = 0, att = 0;
    try { n = badges[b.key] ? badges[b.key]() : 0; } catch { n = 0; }
    try { att = badges[`${b.key}:att`] ? badges[`${b.key}:att`]() : 0; } catch { att = 0; }
    show('n', n);
    show('att', att, () => uiIcon('icon_attachment'));
  }
}

// ---------------------------------------------------------
// notifications: the stack in the bottom-right corner
// ---------------------------------------------------------
/**
 * The mark at the head of a strip. Task events carry the client's yellow
 * tick-in-a-circle; something that went up or down, a small triangle in
 * green or red; a refusal, the warning sign.
 */
const NOTE_SPRITE = { quest: 'notification_icon_quest', mail: 'notification_icon_mail', hideout: 'icon_notification_hideout', flea: 'notification_ragfair' };
const NOTE_GLYPH = { up: 'up', ok: 'up', exp: 'up', level: 'up', down: 'down', bad: 'down' };

/**
 * A strip at the right edge, the way the game reports things: a mark, the
 * text, gone after a few seconds.
 * @param {string} text
 * @param {'info'|'ok'|'warn'|'bad'|'quest'|'exp'|'mail'|'level'|'up'|'down'|'hideout'|'flea'} kind
 */
export function notify(text, kind = 'info', ttl = 4200) {
  const host = $('#notify');
  if (!host) return;
  let mark;
  if (NOTE_SPRITE[kind]) mark = uiImg(NOTE_SPRITE[kind], 'note__ico');
  else if (NOTE_GLYPH[kind]) mark = el('i', { class: `note__tri note__tri--${NOTE_GLYPH[kind]}` });
  else mark = icon(kind === 'warn' ? 'warn' : 'info', 'ico note__ico');
  const node = el('div', { class: `note note--${kind}` }, mark, el('span', { class: 'note__text' }, text));
  host.append(node);
  setTimeout(() => {
    node.classList.add('is-out');
    setTimeout(() => node.remove(), 260);
  }, ttl);
  while (host.children.length > 6) host.firstElementChild.remove();
  return node;
}

/** the older name; refusals and confirmations all come out of the same corner */
export function toast(text, kind = 'info', ttl = 2800) {
  return notify(text, kind, ttl);
}

export function raidToast(text, kind = 'info', ttl = 2400) {
  const host = $('#raid-toast');
  if (!host) return;
  const node = el('div', { class: `raid-toast__row${kind !== 'info' ? ` is-${kind}` : ''}` }, text);
  host.append(node);
  setTimeout(() => node.remove(), ttl);
  while (host.children.length > 4) host.firstElementChild.remove();
}

// ---------------------------------------------------------
export function initShell() {
  buildBar();
  on(EV.TOAST, (p) => toast(p.text, p.kind || 'info'));
  on(EV.RAID_TOAST, (p) => raidToast(p.text, p.kind || 'info'));
  on(EV.MAIL, paintBar);
  on(EV.QUEST, paintBar);

  // every button answers to the pointer the same way; anything carrying
  // data-sfx plays its own cue instead and is skipped here.
  // pointerenter is dispatched at every element entered along the ancestor
  // chain, and a capture listener on the document hears all of them - so
  // sliding from a card's artwork onto its caption replayed the cue for a
  // control the pointer never left. Only speak up when the control changes.
  const HOVERABLE = '.btn, .seg, .ttab, .map-card, .ebtn, .dbtn, .ptab, .ftab, .dtab, .vtog, .qrow, .qtier, .chk';
  let lastHover = null;
  document.addEventListener('pointerenter', (e) => {
    const b = e.target instanceof Element ? e.target.closest(HOVERABLE) : null;
    if (b && !b.disabled && b !== lastHover) { lastHover = b; if (!b.dataset.hover) sfx.ui('hover'); }
  }, true);
  // cleared by identity, not by closest(): the inner leaves fire first and
  // would otherwise reset the tracker just before the next enter
  document.addEventListener('pointerleave', (e) => {
    if (e.target === lastHover) lastHover = null;
  }, true);
  document.addEventListener('click', (e) => {
    const b = e.target instanceof Element ? e.target.closest('.btn, .seg, .map-card, .ebtn, .dbtn') : null;
    if (b && !b.disabled && !b.dataset.sfx) sfx.ui('click');
  }, true);
}

export function bootProgress(pct, label) {
  const fill = $('#boot-bar-fill');
  const status = $('#boot-status');
  if (fill) fill.style.width = `${Math.round(pct * 100)}%`;
  if (status && label) status.textContent = label;
}
