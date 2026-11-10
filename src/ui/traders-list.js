// =========================================================
// the list of traders
//
// What TRADERS opens: two screen tabs across the top (TRADERS, FLEA MARKET),
// BACK in the corner, and in the middle of an otherwise empty screen a card
// a trader - his portrait in a white frame, the loyalty level you stand at
// on a folded label in its corner, his name on a plate under it, your
// standing and the time to his next restock along the bottom. A trader you
// have not met is on the list all the same: grey, no level, a padlock where
// the numbers would be.
//
// The parts of a card that the strip on a trader's own screen shares - the
// level label, the marks for tasks waiting, the tooltip behind the question
// mark - are exported from here.
// =========================================================

import { $, el, fmtShort } from '../core/util.js';
import { on, EV } from '../core/events.js';
import { game } from '../core/state.js';
import { sfx } from '../core/audio.js';
import { t } from '../core/i18n.js';
import { uiImg, uiIcon } from '../core/uiart.js';
import { DB } from '../game/db.js';
import { loyaltyLevel, traderRecord, isUnlocked, restockIn, nextLevel } from '../game/traders.js';
import { statusOf, QS } from '../game/quests.js';
import { showScreen, currentScreen } from './shell.js';

export const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI'];

/** the order the game lists them in, on the list and on the strip alike */
const ORDER = ['prapor', 'therapist', 'fence', 'skier', 'peacekeeper', 'mechanic', 'ragman', 'jaeger', 'ref'];

/**
 * The traders that have a card: the nine of the list, and after them anyone
 * else the profile has met who can be dealt with outside a raid.
 */
export function listedTraders() {
  const out = ORDER.map((k) => DB.traderByKey[k]).filter(Boolean);
  for (const tr of DB.traders) {
    if (out.includes(tr) || tr.raidOnly) continue;
    if (isUnlocked(tr)) out.push(tr);
  }
  return out;
}

let openTrader = () => {};
/** trade.js owns the single-trader screen; it hands its opener over at boot */
export function setTraderOpener(fn) { openTrader = fn; }

export function fmtTimer(sec) {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  const p = (n) => String(n).padStart(2, '0');
  return `${p(h)}:${p(m)}:${p(s)}`;
}

/** the folded label with a loyalty level on it: a numeral, or the crown at the top */
export function rankNode(level, max) {
  const node = el('i', { class: 'rank' });
  if (level >= max) node.append(uiImg('trader_rank_elite', '', { w: 18, h: 18 }));
  else node.textContent = ROMAN[level - 1] || String(level);
  return node;
}

/** what a trader has waiting: a task to take, a task to hand in */
export function traderMarks(trader) {
  let start = false, finish = false;
  for (const task of DB.tasksByTrader[trader.id] || []) {
    const s = statusOf(task);
    if (s === QS.AVAILABLE) start = true;
    else if (s === QS.READY) finish = true;
    if (start && finish) break;
  }
  const out = [];
  if (start) out.push(uiImg('regular_quest_icon'));
  if (finish) out.push(uiImg('icon_daily_quests'));
  return out;
}

function standingWord(rep) {
  if (rep >= 1) return t('Good standing');
  if (rep < 0) return t('Bad standing');
  return t('Neutral standing');
}

/**
 * The box behind a card's question mark: who he is, where he sits, what you
 * are to him now and what the next loyalty level asks.
 */
export function traderTooltip(trader) {
  const st = traderRecord(trader);
  const open = isUnlocked(trader);
  const ll = loyaltyLevel(trader);
  const next = nextLevel(trader);
  const lvl = game.profile.level;
  const tick = () => uiImg('trader_requirements_met', '', { w: 14, h: 12 });
  const box = el('div', { class: 'ttip' },
    el('div', { class: 'ttip__cap' },
      el('b', {}, trader.fullName || trader.name),
      open ? null : el('span', {}, uiImg('icon_lock'), t('traders/trader_is_locked'))),
    trader.location ? el('div', {}, el('b', {}, `${t('Location')}: `), trader.location) : null,
    trader.desc ? el('div', {}, trader.desc) : null);
  if (!open) return box;
  const left = el('div', {},
    el('span', {}, `${t('Loyalty level (LL)')}: `, el('em', {}, String(ll))),
    el('span', {}, `${t('Standing')}: `, el('em', {}, `${st.rep.toFixed(2)} (${standingWord(st.rep)})`)),
    el('span', {}, `${t('Spent')}: `, el('em', {}, `${fmtShort(st.sales)} RUB`)));
  const right = el('div', {});
  if (next) {
    const repOk = st.rep + 1e-9 >= next.rep, lvlOk = lvl >= next.pmc;
    right.append(
      el('span', {}, t('Next LL requirements:')),
      el('span', {}, `${t('Standing')}: `, el('em', { class: repOk ? 'is-met' : 'is-unmet' }, `${next.rep} (${standingWord(next.rep)})`), repOk ? tick() : null),
      next.sales ? el('span', {}, `${t('To spend')}: `, el('em', { class: st.sales >= next.sales ? 'is-met' : 'is-unmet' }, `${fmtShort(next.sales)} RUB`), st.sales >= next.sales ? tick() : null) : null,
      el('span', {}, `${t('Player level')}: `, el('em', { class: lvlOk ? 'is-met' : 'is-unmet' }, String(next.pmc)), lvlOk ? tick() : null));
  }
  box.append(el('div', { class: 'ttip__sep' }), el('div', { class: 'ttip__cols' }, left, right));
  return box;
}

/** show a trader's tooltip beside `anchor` for as long as the pointer stays on it */
export function attachTooltip(anchor, trader, host, place) {
  let tip = null;
  anchor.addEventListener('pointerenter', () => {
    tip = traderTooltip(trader);
    host.append(tip);
    const [x, y] = place(tip);
    tip.style.left = `${x}px`;
    tip.style.top = `${y}px`;
  });
  const drop = () => { if (tip) { tip.remove(); tip = null; } };
  anchor.addEventListener('pointerleave', drop);
  anchor.addEventListener('pointerdown', drop);
}

let timer = 0;

export function renderTraders() {
  const host = $('#traders-host');
  if (!host) return;
  host.replaceChildren();

  const flea = el('button', { class: 'dbtn', dataset: { sfx: 'own' } }, t('RAG FAIR'));
  flea.addEventListener('click', () => { sfx.ui('click'); showScreen('flea'); });
  const back = el('button', { class: 'dbtn dbtn--25 scrback', dataset: { sfx: 'own' } }, t('BACK'));
  back.addEventListener('click', () => { sfx.ui('click'); showScreen('menu'); });

  const grid = el('div', { class: 'tlist__grid' });
  for (const tr of listedTraders()) {
    const open = isUnlocked(tr);
    const ll = loyaltyLevel(tr);
    const st = traderRecord(tr);
    const card = el('button', {
      class: `tcard${open ? '' : ' is-locked'}`, dataset: { trader: tr.key, sfx: 'own', hover: 'own' }, disabled: !open,
    },
    el('span', { class: 'tcard__lines' }),
    el('span', { class: 'tcard__pic' },
      uiImg(`avatar_${tr.key}`),
      open ? el('span', { class: 'tcard__marks' }, traderMarks(tr)) : null),
    open ? rankNode(ll, tr.levels.length) : null,
    uiImg('icon_question_mark', 'tcard__q'),
    el('span', { class: 'tcard__name' }, tr.name));
    if (open) {
      card.append(
        el('span', { class: 'tcard__standing' }, uiIcon('icon_standing_small'), st.rep.toFixed(2)),
        el('span', { class: 'tcard__time' }, uiIcon('icon_update_time'),
          el('span', { dataset: { restock: tr.key } }, fmtTimer(restockIn(tr)))));
    } else {
      card.append(uiImg('icon_lock', 'tcard__lock'));
    }
    card.addEventListener('pointerenter', () => { if (open) sfx.trade('card_hover'); });
    card.addEventListener('click', () => { sfx.trade('card_click'); openTrader(tr); });
    attachTooltip(card.querySelector('.tcard__q'), tr, host, () => {
      const r = card.getBoundingClientRect(), h = host.getBoundingClientRect();
      const k = h.width / host.offsetWidth || 1;
      return [(r.right - h.left) / k + 4, (r.top - h.top) / k];
    });
    grid.append(card);
  }
  host.append(
    el('div', { class: 'scrtabs' },
      el('button', { class: 'dbtn is-hover', dataset: { sfx: 'own' } }, t('MERCHANTS')), flea),
    back, grid);

  clearInterval(timer);
  timer = setInterval(() => {
    if (currentScreen() !== 'traders') { clearInterval(timer); return; }
    for (const node of host.querySelectorAll('[data-restock]')) {
      const tr = DB.traderByKey[node.dataset.restock];
      if (tr && isUnlocked(tr)) node.textContent = fmtTimer(restockIn(tr));
    }
  }, 1000);
}

export function initTradersList() {
  on(EV.SCREEN_CHANGED, (id) => { if (id === 'traders') renderTraders(); });
  on(EV.QUEST, () => { if (currentScreen() === 'traders') renderTraders(); });
  on(EV.TRADER_LEVEL, () => { if (currentScreen() === 'traders') renderTraders(); });
}
