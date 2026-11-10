// =========================================================
// a trader's own screen
//
// The client's arrangement, part for part. Along the top three tabs
// (TRADING, TASKS, SERVICES), VISIT in the middle and BACK in the corner.
// Under them, between two khaki rules, a strip with a card for every trader -
// the one being dealt with turns cream - and to its right the player's own
// block: name, the three currencies, "Current attitude:" and "Next Loyalty
// Level:" with what is still unmet in red, level label, face.
//
//  TRADING   his goods on the left as one item grid (the price on every
//            tile, a currency sign or the two arrows of a barter; "A LOT" or
//            the number in stock in the corner), your stash on the right,
//            and between them the deal: the auto-fill toggle, BUY and SELL,
//            the clear-table button, and under the DEAL! bar either what the
//            chosen offer costs - each thing it wants with a glowing tick or
//            a glowing empty box and have/need - or, when selling, the table
//            the things to sell are dragged onto.
//  TASKS     what he will hand out and take back (src/ui/tasks-ui.js)
//  SERVICES  the trader's own service; repairs and insurance are not here,
//            they open from an item's menu and before a raid
//
// Every number comes from src/game/traders.js, which reads the live game's
// own offers. Nothing here pops a confirmation: an offer on the table with
// its price met is the confirmation, DEAL! (or SPACE) closes it.
// =========================================================

import { $, $$, el, icon, fmtNum, fmtShort, clamp, keepScroll } from '../core/util.js';
import { game, countMoney, saveSoon, registerSaveSection } from '../core/state.js';
import { Item, Grid, autoPlace } from '../inventory/model.js';
import { renderGrid, renderItem } from '../inventory/view.js';
import { isKnown, needsExamine } from '../inventory/examine.js';
import { dndContext, quickTransfer, isDragging } from '../inventory/dnd.js';
import { setContextProvider, inspectDialog, closeContext } from '../inventory/dialogs.js';
import { openContainerWindow, refreshContainerWindows, closeContainerWindow } from '../inventory/window.js';
import { moddingContext } from '../inventory/modding.js';
import { buildMenu, markOpenable, examineNow } from './stash.js';
import { sfx } from '../core/audio.js';
import { on, emit, EV } from '../core/events.js';
import { t, tOr } from '../core/i18n.js';
import { uiImg, uiIcon, loadUiGroup } from '../core/uiart.js';
import { toast, showScreen, currentScreen, onLeaveScreen } from './shell.js';
import { DB, CUR_OF_ITEM, CUR_SYM, tplOf, itemName, levelGroup } from '../game/db.js';
import {
  loyaltyLevel, traderRecord, nextLevel, restockIn, offersOf, offerTpl, offerState, offerLeft,
  offerCurrency, offerPrice, requirements, buyBlocker, buyOffer, buildPreset,
  sellBlocker, sellPrice, sellItems, isUnlocked,
} from '../game/traders.js';
import { talkTo } from '../game/quests.js';
import { renderTasksPane } from './tasks-ui.js';
import { setTraderOpener, listedTraders, rankNode, traderMarks, attachTooltip, fmtTimer } from './traders-list.js';

/** @type {any} the trader whose screen is up */
let trader = null;
let tab = 'trade';        // trade | tasks | services
let mode = 'buy';         // buy | sell
let category = 'all';
let stashCategory = 'all';
let llFilter = 0;         // 0 = every loyalty level
let autoFill = true;
let search = '';

/** ceiling on one order, matching the three digits the quantity box takes */
const MAX_BUY_QTY = 999;

/**
 * The sell table: what is dragged here is what DEAL! sells. Eight cells
 * across, as the client's, and as many rows as its panel shows.
 */
const TABLE = { w: 8, h: 11 };
export const tradeTable = new Grid(TABLE.w, TABLE.h, { tag: 'tradeTable', label: 'TRADING TABLE' });
tradeTable.mayAccept = (item) => !!trader && tab === 'trade' && mode === 'sell' && !sellBlocker(trader, item) && isKnown(item);

/**
 * The buy side of the table. One offer at a time, with a quantity - not a
 * cart: the client's own wording is singular ("Item to purchase").
 * Either null or { off, tpl, qty }.
 */
let staged = null;
/** with auto-fill off: the requirement rows the player has filled by hand */
let filledRows = new Set();

function clearStaged() { staged = null; filledRows = new Set(); }

// ---------------------------------------------------------
// what goes in which tab beside the grids
// ---------------------------------------------------------
/**
 * The tabs beside a grid are the handbook's top categories, in the order the
 * client's filter strip lists them, with magazines lifted out of weapon
 * parts into a tab of their own as the client does. `hb` is the handbook
 * category's id (a template carries its chain of them, most specific first);
 * `cats` are the short categories of this build's item table, for a template
 * the handbook does not file.
 */
const CATEGORIES = [
  { key: 'all', ico: 'icon_itemtype_all' },
  { key: 'barter', ico: 'icon_itemtype_barter', hb: '5b47574386f77428ca22b33e', cats: ['barter', 'electronics', 'valuables', 'lootbox'] },
  { key: 'gear', ico: 'icon_itemtype_gear_armor', hb: '5b47574386f77428ca22b33f', cats: ['armor', 'helmet', 'rig', 'backpack', 'headset', 'glasses', 'facecover', 'container', 'secure', 'armband', 'plate', 'gearmod'] },
  { key: 'mod', ico: 'icon_itemtype_mod', hb: '5b5f71a686f77447ed5636ab', cats: ['mod'] },
  { key: 'weapon', ico: 'icon_itemtype_weapon', hb: '5b5f78dc86f77409407a7f8e', cats: ['weapon', 'pistol', 'melee', 'grenade', 'preset'] },
  { key: 'mag', ico: 'icon_itemtype_mags', hb: '5b5f754a86f774094242f19b', cats: ['mag'] },
  { key: 'ammo', ico: 'icon_itemtype_ammo', hb: '5b47574386f77428ca22b346', cats: ['ammo', 'ammobox'] },
  { key: 'food', ico: 'icon_itemtype_food', hb: '5b47574386f77428ca22b340', cats: ['food', 'drink'] },
  { key: 'meds', ico: 'icon_itemtype_meds', hb: '5b47574386f77428ca22b344', cats: ['meds'] },
  { key: 'key', ico: 'icon_itemtype_keys', hb: '5b47574386f77428ca22b342', cats: ['key'] },
  { key: 'info', ico: 'icon_itemtype_info', hb: '5b47574386f77428ca22b341', cats: ['info'] },
  { key: 'spec', ico: 'icon_itemtype_spec', hb: '5b47574386f77428ca22b345', cats: ['special', 'nvg', 'repairkit', 'flare'] },
  { key: 'maps', ico: 'icon_maps', hb: '5b47574386f77428ca22b343', cats: [] },
  { key: 'money', ico: 'icon_money', hb: '5b5f78b786f77447ed5636af', cats: ['money'] },
];
const GROUP_OF = {};
const GROUP_OF_HB = {};
CATEGORIES.forEach((c, i) => {
  for (const k of c.cats || []) GROUP_OF[k] = { key: c.key, order: i };
  if (c.hb) GROUP_OF_HB[c.hb] = { key: c.key, order: i };
});
/** which tab a template is filed under */
function groupEntry(tpl) {
  // the chain is walked from the specific end, so Magazines wins over Weapon parts & mods
  for (const id of tpl.hb || []) if (GROUP_OF_HB[id]) return GROUP_OF_HB[id];
  return GROUP_OF[tpl.cat] || GROUP_OF.barter;
}
const groupOf = (tpl) => groupEntry(tpl).key;

/** display items for the goods grid, one an offer, kept while the offer list stands */
const shelfItems = new Map();
function displayItem(off) {
  let it = shelfItems.get(off.id);
  if (it) return it;
  const tpl = offerTpl(off);
  try {
    it = off.preset ? buildPreset(off.preset) : new Item(tpl.key, { examined: true, stack: Math.min(off.n || 1, tpl.stack || 1) });
  } catch { it = null; }
  if (!it) return null;
  it.examined = true;
  for (const m of it.allMods()) m.examined = true;
  it.virtual = true;
  it.offer = off;
  shelfItems.set(off.id, it);
  return it;
}

const offerName = (off) => (off.preset ? (DB.presets[off.preset]?.name || offerTpl(off).short) : offerTpl(off).short || offerTpl(off).name);

// ---------------------------------------------------------
// opening
// ---------------------------------------------------------
export function openTraderScreen(next, nextTab = 'trade') {
  if (!next || !isUnlocked(next)) return;
  if (trader !== next) {
    returnTableItems();
    clearStaged();
    category = 'all';
    llFilter = 0;
    shelfItems.clear();
  }
  trader = next;
  tab = nextTab;
  mode = 'buy';
  // walking in is the conversation the game asks for before some tasks
  talkTo(next);
  showScreen('trader');
  activateTradeContext();
  renderTrade();
}

/** the parts of the screen that never change, built once */
function build() {
  const scr = $('#screen-trader');
  const visit = el('button', { class: 'trvisit', id: 'btn-trader-visit', disabled: true, dataset: { sfx: 'own' } },
    uiImg('social_trader_chat_full_call_icon_2_0'), el('span', {}, tOr('Chat/DialogueInvitation/StartMethod/InLobby', 'VISIT')));
  const back = el('button', { class: 'dbtn dbtn--25 trback', dataset: { sfx: 'own' } }, t('BACK'));
  back.addEventListener('click', () => { sfx.ui('click'); showScreen('traders'); });

  const refresh = el('button', { class: 'trrefresh', id: 'btn-refresh-store', dataset: { sfx: 'own' } },
    uiIcon('icon_info_reload'), el('span', {}, t('UPDATE STORE')));
  refresh.addEventListener('click', () => {
    sfx.ui('click');
    refresh.classList.add('is-busy');
    shelfItems.clear();
    $('#trader-content').replaceChildren(el('div', { class: 'trgoods__spin' }));
    setTimeout(() => { refresh.classList.remove('is-busy'); if (tradeScreenActive()) renderTrade(); }, 420);
  });

  const fill = el('button', { class: 'fillbtn', id: 'deal-auto', title: t('Select to auto fill requirements'), dataset: { sfx: 'own' } },
    uiImg('trade_fill_toggle_idle', 'fillbtn__box'), uiImg('trade_fill_icon_idle', 'fillbtn__ico'),
    uiImg('checkmark_trader_big_0', 'fillbtn__tick'));
  fill.addEventListener('click', () => {
    autoFill = !autoFill;
    filledRows = new Set();
    sfx.ui('checkbox');
    renderTrade();
  });

  const tabBtn = (key, label, ico, icoOn) => {
    const b = el('button', { class: `dtab dtab--${key}`, dataset: { mode: key, sfx: 'own', ico, icoOn } },
      el('span', {}, label), uiImg(ico));
    b.addEventListener('click', () => {
      if (mode === key) return;
      mode = key;
      sfx.trade('click');
      returnTableItems();
      clearStaged();
      renderTrade();
      emit(EV.INVENTORY_CHANGED);
    });
    return b;
  };

  const clear = el('button', { class: 'clearbtn', id: 'btn-trade-clear', title: t('Clear table'), dataset: { sfx: 'own' } },
    uiImg('trade_clear_icon_idle'));
  clear.addEventListener('click', () => {
    clearStaged();
    if (tradeTable.count) returnTableItems();
    sfx.trade('click');
    renderTrade();
    emit(EV.INVENTORY_CHANGED);
    saveSoon();
  });

  const find = el('input', { type: 'text', id: 'trade-search', placeholder: t('UI/Inventory/SearchButtonCaption'), autocomplete: 'off', spellcheck: 'false' });
  find.addEventListener('input', () => { search = find.value.trim().toLowerCase(); renderDockedStash(); });

  scr.replaceChildren(
    el('div', { class: 'trbar' },
      el('div', { class: 'trbar__tabs', id: 'trader-tabs' }), visit, back),
    el('div', { class: 'trtop' },
      el('div', { class: 'trtop__pattern' }),
      el('div', { class: 'trtop__cards', id: 'trader-strip' }),
      el('div', { class: 'trplayer', id: 'trader-player' })),
    el('div', { class: 'trdeal', id: 'trade-body' },
      el('div', { class: 'hplate trshow' }, t('SHOWCASE')),
      refresh,
      el('div', { class: 'ftabs ftabs--ll', id: 'assort-ll' }),
      el('div', { class: 'trgoods', id: 'trader-content' }),
      el('div', { class: 'ftabs ftabs--goods', id: 'assort-tools' }),
      fill,
      tabBtn('buy', t('BUY'), 'trade_buytab_icon_idle', 'trade_buytab_icon_hover'),
      tabBtn('sell', t('SELL'), 'trade_sell_icon_idle', 'trade_sell_icon_hover'),
      clear,
      el('div', { class: 'dealcol', id: 'trade-table-host' }),
      el('div', { class: 'ftabs ftabs--stash', id: 'stash-cats' }),
      el('label', { class: 'trsearch' }, uiIcon('icon_search'), find),
      el('div', { class: 'trstash', id: 'trade-stash-host' })),
    el('div', { class: 'trquests', id: 'trader-tasks-host', hidden: true }),
    el('div', { class: 'trservices', id: 'trader-services-host', hidden: true }));
}

export function initTrade() {
  build();
  setTraderOpener(openTraderScreen);

  // leaving the trader clears the table back into the stash
  onLeaveScreen((from, to) => {
    if (from === 'trader' && to !== 'trader' && tradeTable.count) {
      returnTableItems();
      emit(EV.INVENTORY_CHANGED);
      saveSoon();
    }
  });

  // closing the tab with items still on the table must not lose them
  window.addEventListener('beforeunload', () => {
    if (tradeTable.count) returnTableItems();
  });

  // the deal bar shows SPACE on a key cap, so SPACE has to close the deal
  document.addEventListener('keydown', (e) => {
    if (e.key !== ' ' && e.code !== 'Space') return;
    if (!tradeScreenActive() || tab !== 'trade') return;
    const tag = e.target?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target?.isContentEditable) return;
    if (!$('#modal-root').hidden || isDragging()) return;
    // a key press does not close the context menu the way a click on DEAL!
    // does, and the menu's actions still hold the Item the deal detaches
    if (!$('#context-menu').hidden) return;
    e.preventDefault();
    if (mode === 'buy') doBuyStaged();
    else doSell();
  });

  on(EV.TRADER_RESTOCK, (who) => {
    if (who === trader) { shelfItems.clear(); clearStaged(); if (tradeScreenActive()) renderTrade(); }
  });
  on(EV.TRADER_LEVEL, () => { if (tradeScreenActive()) renderTrade(); });
  on(EV.QUEST, () => { if (tradeScreenActive()) { renderChrome(); if (tab === 'tasks') renderTasksTab(); } });
  on(EV.LEVEL_UP, () => { if (tradeScreenActive()) renderChrome(); });

  setInterval(() => {
    if (!tradeScreenActive()) return;
    for (const node of $$('#trader-strip [data-restock]')) {
      const who = DB.traderByKey[node.dataset.restock];
      if (who) node.textContent = fmtTimer(restockIn(who));
    }
  }, 1000);
}

function tradeScreenActive() { return currentScreen() === 'trader'; }

// if the page dies between the debounced saves, whatever sat on the trading
// table is serialised too and lands back in the stash on the next boot
registerSaveSection('tradeTable', {
  roots: () => [tradeTable],
  dump: () => (tradeTable.count ? tradeTable.toJSON() : null),
  restore: (v) => {
    if (v && v.w && v.h) tradeTable.resize(v.w, v.h);
    tradeTable.loadJSON(v);
    for (const it of tradeTable.items()) autoPlace(it, [game.stash]);
    tradeTable.resize(TABLE.w, TABLE.h);
  },
});

export function activateTradeContext() {
  dndContext.quickTargets = (item) => {
    // on the buy side there is nowhere for a stash item to go
    if (tab !== 'trade' || mode !== 'sell') return [];
    return onTable(item) ? [game.stash] : [tradeTable];
  };
  moddingContext.sources = () => [game.stash, ...game.equipment.allGrids(), ...game.equipment.nestedGrids()];
  dndContext.equipSlotFor = () => null;
  dndContext.requestSplit = null;
  dndContext.canMove = (item) => !item.virtual;
  dndContext.onActivate = (item) => {
    // a single click on a goods tile already stages the offer
    if (item.virtual) return;
    if (needsExamine(item)) { examineNow(item); return; }
    if (item.isContainer && !onTable(item)) { openContainerWindow(item); return; }
    quickTransfer(item);
  };
  dndContext.onChange = () => { renderTrade(); emit(EV.INVENTORY_CHANGED); saveSoon(); };

  setContextProvider((item) => {
    if (item.virtual) {
      const off = item.offer;
      const actions = [];
      if (off && tab === 'trade' && mode === 'buy') {
        actions.push({ label: t('BUY'), icon: 'cart', disabled: offerState(off) !== 'ok', run: () => stageOffer(off) });
      }
      actions.push({ label: 'INSPECT', icon: 'info', run: () => inspectDialog(item) });
      return actions;
    }
    const extra = [];
    if (tab === 'trade' && mode === 'sell') {
      if (onTable(item)) {
        extra.push({
          label: 'REMOVE FROM TABLE', icon: 'back',
          run: () => {
            // a sold item still has a holder-less object behind this closure
            if (!item.holder) return;
            if (!autoPlace(item, [game.stash])) toast('Not enough space in stash', 'warn');
            dndContext.onChange();
          },
        });
      } else {
        const why = !isKnown(item) ? null : sellBlocker(trader, item);
        if (isKnown(item) && !why) {
          extra.push({
            label: t('SELL'), icon: 'sell',
            run: () => {
              if (!item.holder) return;
              if (!autoPlace(item, [tradeTable])) toast('No room on the table', 'warn');
              dndContext.onChange();
            },
          });
        }
      }
    }
    // a case sitting on the trading table must not be openable
    return buildMenu(item, 'trade', extra, { noOpen: onTable(item) });
  });
}

function onTable(item) {
  let cur = item;
  let guard = 0;
  while (cur && guard++ < 16) {
    const h = cur.holder;
    if (!h || h.kind !== 'grid') return false;
    if (h.grid === tradeTable) return true;
    cur = h.grid.owner;
  }
  return false;
}

/** empty the trading table back into the stash */
function returnTableItems() {
  let stuck = 0;
  for (const it of tradeTable.items()) {
    if (!autoPlace(it, [game.stash])) stuck++;
  }
  if (stuck) toast('Not enough space in stash', 'warn');
}

// ---------------------------------------------------------
// the bar of tabs, the strip of cards, the player's block
// ---------------------------------------------------------
const TABS = [
  { key: 'trade', label: () => t('Trading'), ico: 'tab_icon_buy', icoOn: 'tab_icon_buy_selected' },
  { key: 'tasks', label: () => t('TASKS'), ico: 'tab_icon_tasks', icoOn: 'tab_icon_tasks_selected' },
  { key: 'services', label: () => t('SERVICES'), ico: 'trade_buy_icon_idle', icoOn: 'trade_buy_icon_hover', wide: true },
];

/** the services a trader offers on his own screen; the rest of what traders do lives elsewhere */
function servicesOf(who) {
  return who.key === 'ragman' ? ['clothing'] : [];
}

function renderChrome() {
  if (!trader) return;
  // ---- tabs ----
  const tabs = $('#trader-tabs');
  tabs.replaceChildren();
  for (const d of TABS) {
    const active = tab === d.key;
    const off = d.key === 'services' && !servicesOf(trader).length;
    const b = el('button', { class: `ptab${active ? ' is-active' : ''}`, disabled: off, dataset: { tab: d.key, sfx: 'own' } },
      el('span', { class: `ptab__ico${d.wide ? ' ptab__ico--wide' : ''}` }, uiImg(active ? d.icoOn : d.ico)),
      el('span', {}, d.label()));
    b.addEventListener('click', () => {
      if (tab === d.key) return;
      sfx.trade('tab');
      returnTableItems();
      clearStaged();
      tab = d.key;
      renderTrade();
      emit(EV.INVENTORY_CHANGED);
    });
    tabs.append(b);
  }

  // ---- every trader's card ----
  const strip = $('#trader-strip');
  const frame = $('#screen-trader');
  strip.replaceChildren();
  for (const who of listedTraders()) {
    const open = isUnlocked(who);
    const st = traderRecord(who);
    const card = el('button', {
      class: `scard${who === trader ? ' is-active' : ''}${open ? '' : ' is-locked'}`, disabled: !open,
      dataset: { trader: who.key, sfx: 'own', hover: 'own' },
    },
    el('span', { class: 'scard__pic' }, uiImg(`avatar_${who.key}`)),
    el('span', { class: 'scard__name' }, who.name),
    open ? el('span', { class: 'scard__marks' }, traderMarks(who)) : null,
    open ? rankNode(loyaltyLevel(who), who.levels.length) : null,
    uiImg('icon_question_mark', 'scard__q'));
    if (open) {
      card.append(
        el('span', { class: 'scard__row scard__row--rep' }, uiIcon('icon_standing_small'), st.rep.toFixed(2)),
        el('span', { class: 'scard__row scard__row--time' }, uiIcon('icon_update_time'),
          el('span', { dataset: { restock: who.key } }, fmtTimer(restockIn(who)))));
    } else card.append(uiImg('icon_lock', 'scard__lock'));
    card.addEventListener('pointerenter', () => { if (open && who !== trader) sfx.trade('card_hover'); });
    card.addEventListener('click', () => {
      if (who === trader) return;
      sfx.trade('card_click');
      openTraderScreen(who, tab === 'services' && !servicesOf(who).length ? 'trade' : tab);
    });
    attachTooltip(card.querySelector('.scard__q'), who, frame, () => {
      const r = card.getBoundingClientRect(), h = frame.getBoundingClientRect();
      const k = h.width / frame.offsetWidth || 1;
      return [(r.right - h.left) / k - 2, (r.top - h.top) / k + 66];
    });
    strip.append(card);
  }

  renderPlayer();
}

function renderPlayer() {
  const host = $('#trader-player');
  const p = game.profile;
  const st = traderRecord(trader);
  const ll = loyaltyLevel(trader);
  const max = trader.levels.length;
  const next = nextLevel(trader);
  const sym = CUR_SYM[trader.cur] || '₽';
  // sales are kept in roubles; a trader who deals in another currency shows them in his own
  const spent = (rub) => `${sym} ${fmtShort(trader.cur === 'RUB' ? rub : rub / (trader.cur === 'USD' ? 120 : 130))}`;

  const row = (cls, label, rankLevel, lvl, rep, sales, marks) => el('div', { class: `trplayer__row ${cls}` },
    el('span', { class: 'trplayer__lbl' }, label),
    rankNode(rankLevel, max),
    uiImg('lvl', 'trplayer__lvlico'),
    el('span', { class: `trplayer__lvl ${marks ? (p.level >= lvl ? 'is-met' : 'is-unmet') : ''}` }, String(lvl)),
    uiImg('standing_icon', 'trplayer__repico'),
    el('span', { class: `trplayer__rep ${marks ? (st.rep + 1e-9 >= rep ? 'is-met' : 'is-unmet') : ''}` }, Number(rep).toFixed(2)),
    sales != null ? el('span', { class: `trplayer__spent ${marks ? (st.sales >= sales ? 'is-met' : 'is-unmet') : ''}` },
      `${spent(sales)} (${t('Spent short')})`) : null);

  const rank = el('div', { class: 'trplayer__rank' });
  const badge = `rank${levelGroup(p.level) * 5}`;
  loadUiGroup('ranks').then(() => {
    rank.style.webkitMaskImage = `var(--ui-${badge})`;
    rank.style.maskImage = `var(--ui-${badge})`;
  });

  host.replaceChildren(
    rank,
    el('div', { class: 'trplayer__name' }, `${p.name || 'PMC'} ${t('(you)')}`),
    el('div', { class: 'trplayer__money' },
      el('span', {}, `₽ ${fmtNum(countMoney('RUB'))}`),
      el('span', {}, `€ ${fmtNum(countMoney('EUR'))}`),
      el('span', {}, `$ ${fmtNum(countMoney('USD'))}`)),
    el('div', { class: 'trplayer__rule' }),
    row('trplayer__row--now', t('Current attitude:'), ll, p.level, st.rep, st.sales, false),
    next ? row('trplayer__row--next', t('Next Loyalty Level:'), ll + 1, next.pmc, next.rep, next.sales || null, true) : null,
    el('div', { class: 'trplayer__face' }, icon('pmc', 'ico')),
    el('div', { class: 'trplayer__level' }, String(p.level)));
}

// ---------------------------------------------------------
// drawing
// ---------------------------------------------------------
export function renderTrade() {
  if (!trader) return;
  renderChrome();

  const body = $('#trade-body');
  const tasksHost = $('#trader-tasks-host');
  const svcHost = $('#trader-services-host');
  body.hidden = tab !== 'trade';
  tasksHost.hidden = tab !== 'tasks';
  svcHost.hidden = tab !== 'services';
  if (tab === 'tasks') { renderTasksTab(); return; }
  if (tab === 'services') { renderServices(); return; }

  for (const b of $$('#trade-body .dtab')) {
    const active = b.dataset.mode === mode;
    b.classList.toggle('is-active', active);
    const img = b.querySelector('img');
    const fresh = uiImg(active ? b.dataset.icoOn : b.dataset.ico);
    img.replaceWith(fresh);
  }
  $('#deal-auto').classList.toggle('is-on', autoFill);
  $('#btn-trade-clear').disabled = !staged && !tradeTable.count;

  renderLevelTabs();
  renderCategoryTabs();
  const content = $('#trader-content');
  // the scroller is rebuilt as a new element; carry its offset across
  const shelfTop = $('.assort-scroll', content)?.scrollTop || 0;
  content.replaceChildren();
  renderShelf(content);
  const shelf = $('.assort-scroll', content);
  if (shelf) shelf.scrollTop = shelfTop;

  const table = $('#trade-table-host');
  table.replaceChildren();
  if (mode === 'buy') renderBuy(table);
  else renderSell(table);

  renderDockedStash();
  // a case on the table is on its way out of the stash: shut its window
  for (const it of tradeTable.items()) {
    if (it.isContainer) closeContainerWindow(it.uid);
    for (const d of it.descendants()) if (d.isContainer) closeContainerWindow(d.uid);
  }
  refreshContainerWindows();
}

/** the loyalty levels over the goods: all of them, or one at a time */
function renderLevelTabs() {
  const host = $('#assort-ll');
  host.replaceChildren();
  if (trader.fence) return;
  const have = loyaltyLevel(trader);
  const max = trader.levels.length;
  const ICONS = ['loyalty_one', 'loyalty_two', 'loyalty_three'];
  const add = (level, img) => {
    const b = el('button', { class: `ftab ftab--ll${llFilter === level ? ' is-active' : ''}`, disabled: level > have, dataset: { sfx: 'own' } }, img);
    b.addEventListener('click', () => { if (llFilter !== level) { llFilter = level; sfx.ui('click'); renderTrade(); } });
    host.append(b);
  };
  add(0, uiImg('icon_itemtype_all'));
  for (let l = 1; l <= max; l++) {
    add(l, l === max ? uiImg('loyalty_king_new', '', { w: 22, h: 22 }) : uiImg(ICONS[l - 1] || 'loyalty_three'));
  }
}

function categoryStrip(host, present, current, pick) {
  host.replaceChildren();
  for (const c of CATEGORIES) {
    const b = el('button', {
      class: `ftab${current === c.key ? ' is-active' : ''}`, disabled: !present.has(c.key), dataset: { cat: c.key, sfx: 'own' },
    }, uiImg(c.ico));
    b.addEventListener('click', () => { sfx.ui('click'); pick(c.key); });
    host.append(b);
  }
}

function renderCategoryTabs() {
  const present = new Set(['all']);
  for (const o of offersOf(trader)) present.add(groupOf(offerTpl(o)));
  if (!present.has(category)) category = 'all';
  categoryStrip($('#assort-tools'), present, category, (key) => { category = key; renderTrade(); });
}

// ---------------------------------------------------------
// the goods
// ---------------------------------------------------------
const GOODS_COLS = 10;

function renderShelf(host) {
  let offers = offersOf(trader);
  if (category !== 'all') offers = offers.filter((o) => groupOf(offerTpl(o)) === category);
  if (llFilter) offers = offers.filter((o) => (o.ll || 1) === llFilter);

  if (!offers.length) {
    host.append(el('div', { class: 'trgoods__empty' }, ''));
    return;
  }

  const entries = [];
  for (const off of offers) {
    const disp = displayItem(off);
    if (disp) entries.push({ off, disp });
  }
  // by kind, then by loyalty level, then big before small
  const rank = (e) => groupEntry(e.disp.tpl).order;
  entries.sort((a, b) => rank(a) - rank(b) || (a.off.ll || 1) - (b.off.ll || 1)
    || (b.disp.fw * b.disp.fh) - (a.disp.fw * a.disp.fh) || a.disp.tpl.name.localeCompare(b.disp.tpl.name));

  const cells = entries.reduce((n, e) => n + e.disp.fw * e.disp.fh, 0);
  const shelf = new Grid(GOODS_COLS, Math.ceil(cells / GOODS_COLS) + 14, { tag: 'assort' });
  // display only: nothing real may ever be dropped in here
  shelf.mayAccept = (it) => !!it.virtual;

  const placed = [];
  for (const e of entries) {
    // a display item lives on one shelf at a time; lift it off the last one
    e.disp.holder = null;
    e.disp.rot = 0;
    if (e.disp.fw > GOODS_COLS) continue;
    const spot = shelf.findSpot(e.disp);
    if (!spot) continue;
    shelf.place(e.disp, spot.x, spot.y, spot.rot);
    placed.push(e);
  }
  let maxY = 12;
  for (const { disp } of placed) {
    const pos = shelf.posOf(disp);
    if (pos) maxY = Math.max(maxY, pos.y + disp.h);
  }
  shelf.h = maxY;
  shelf.cells = shelf.cells.slice(0, shelf.w * shelf.h);

  const gridEl = renderGrid(shelf);
  gridEl.classList.add('assort-grid');
  const have = loyaltyLevel(trader);

  for (const { disp, off } of placed) {
    const tile = gridEl.querySelector(`.item[data-uid="${disp.uid}"]`);
    if (!tile) continue;
    const state = offerState(off);
    const cur = offerCurrency(off);
    const left = offerLeft(off);
    tile.classList.add('has-price');
    // one cell across has room for the price and nothing beside it
    if (disp.w === 1) tile.classList.add('is-narrow');

    // the caption: a currency sign and the price, or the barter mark
    if (cur) {
      tile.append(el('div', { class: 'toffer__price' }, el('em', {}, CUR_SYM[cur]), fmtNum(offerPrice(off))));
    } else {
      tile.append(el('div', { class: 'toffer__price toffer__price--barter', title: barterTitle(off) },
        uiIcon('icon_itemtype_barter'), el('span', {}, String(off.cost.length))));
    }
    // what he has of it: a number, or just "a lot"
    const stock = off._fence ? left : (off.stock == null || off.stock > 9999 ? null : off.stock);
    tile.append(el('div', { class: `toffer__stock${left <= 0 ? ' is-out' : ''}` }, stock == null ? t('A LOT') : fmtNum(Math.max(0, stock))));

    if (state === 'level' || state === 'task') {
      tile.classList.add('toffer--locked');
      tile.append(el('div', { class: 'toffer__lock' }, uiImg('icon_lock_small'),
        state === 'level' && off.ll > have ? rankNode(off.ll, trader.levels.length) : null));
      if (state === 'task') {
        const need = DB.taskById[off.task];
        if (need) tile.title = need.name;
      }
    } else {
      tile.addEventListener('click', (ev) => {
        // a drag that ends on the tile must not also count as a pick
        if (ev.detail === 0 || mode !== 'buy') return;
        stageOffer(off);
      });
      if (staged && staged.off.id === off.id) tile.classList.add('toffer--staged');
    }
  }

  const scroll = el('div', { class: 'assort-scroll' });
  scroll.append(gridEl);
  host.append(scroll);
}

function barterTitle(off) {
  return off.cost.map(([id, n]) => `${fmtNum(n)} x ${id === 'dogtag' ? 'Dogtag' : itemName(id)}`).join('\n');
}

/** put an offer on the table; picking the same one again asks for one more */
function stageOffer(off) {
  if (tab !== 'trade' || mode !== 'buy') return;
  const state = offerState(off);
  if (state === 'level' || state === 'task') return;

  if (staged && staged.off.id === off.id) {
    const cap = Math.min(offerLeft(off), MAX_BUY_QTY);
    if (staged.qty < cap) staged.qty++;
  } else {
    staged = { off, tpl: offerTpl(off), qty: 1 };
  }
  filledRows = new Set();
  sfx.trade('click');
  renderTrade();
}

/** has every row of the price been met (and, with auto-fill off, been filled) */
function rowMet(r, i) {
  if (r.have < r.need) return false;
  return autoFill || filledRows.has(i);
}

/** why DEAL! cannot be pressed yet, or null */
function dealBlocker() {
  if (!staged) return t('No items selected');
  const b = buyBlocker(staged.off, staged.qty);
  if (b) return b;
  if (!requirements(staged.off, staged.qty).every(rowMet)) return t("You don't have some items to finish the deal");
  return null;
}

function dealBar(onClick) {
  const sum = el('span', { class: 'deal-bar__sum' }, '');
  const bar = el('button', { class: 'deal-bar', dataset: { sfx: 'own' } },
    uiImg('trade_buy_icon_idle', 'deal-bar__ico'), uiImg('trade_buy_icon_hover', 'deal-bar__ico deal-bar__ico--hover'),
    el('span', { class: 'deal-bar__label' }, t('DEAL!')), sum,
    el('span', { class: 'kcap' }, 'SPACE'));
  bar.addEventListener('click', onClick);
  return { bar, sum };
}

/**
 * The purchase panel under the DEAL! bar: what is being bought and how many,
 * what stands in the way, and every thing the price is made of with its tick.
 */
function renderBuy(host) {
  const { bar, sum } = dealBar(() => doBuyStaged());
  const panel = el('div', { class: 'barter' });
  const inner = el('div', { class: 'barter__in' });
  panel.append(inner);
  host.append(bar, panel);

  const buyBlock = el('div', { class: 'barter__buy' },
    el('div', { class: 'barter__cap' }, staged ? `${t('Item to purchase')}: ${offerName(staged.off)}` : t('Item to purchase')),
    el('div', { class: 'barter__tile' }), uiImg('arrow_right', 'barter__arrow'));
  inner.append(buyBlock);

  let qtyEl = null;
  if (staged) {
    const disp = displayItem(staged.off);
    const show = el('div', { class: 'barter__show' });
    if (disp) {
      // the offer's own tile, at its own footprint but never taller than the box
      const scale = Math.min(1, 126 / (disp.fh * 63), 250 / (disp.fw * 63));
      const cell = Math.floor(63 * scale);
      const box = el('div', { class: 'barter__item', style: { width: `${disp.fw * cell}px`, height: `${disp.fh * cell}px` } });
      const tile = renderItem(disp, { static: true });
      tile.style.setProperty('--cell', `${cell}px`);
      box.style.setProperty('--cell', `${cell}px`);
      box.style.backgroundSize = `${cell}px ${cell}px`;
      box.append(tile);
      show.append(box);
    }
    const cap = Math.max(1, Math.min(offerLeft(staged.off), MAX_BUY_QTY));
    qtyEl = el('input', { type: 'text', inputmode: 'numeric', autocomplete: 'off', spellcheck: 'false', maxlength: '3', value: String(staged.qty) });
    qtyEl.addEventListener('focus', () => qtyEl.select());
    qtyEl.addEventListener('input', () => {
      const digits = qtyEl.value.replace(/\D/g, '');
      if (digits !== qtyEl.value) qtyEl.value = digits;
      if (!digits) return;                       // mid-edit; wait for a number
      const n = clamp(parseInt(digits, 10) || 1, 1, cap);
      if (String(n) !== digits) qtyEl.value = String(n);
      if (n === staged.qty) return;
      staged.qty = n;
      filledRows = new Set();
      sync();
    });
    qtyEl.addEventListener('blur', () => { qtyEl.value = String(staged ? staged.qty : 1); });
    qtyEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') qtyEl.blur(); });
    show.append(el('span', { class: 'barter__x' }, 'X'), el('div', { class: 'barter__qtywrap' }, qtyEl));
    buyBlock.append(show);
  }
  inner.append(el('div', { class: 'barter__gap' }));

  const live = el('div', {});
  inner.append(live);

  /** repaint everything the quantity drives, without rebuilding the panel */
  function sync() {
    live.replaceChildren();
    if (!staged) {
      sum.textContent = '';
      bar.disabled = true;
      live.append(el('div', { class: 'barter__none' }, t('No items selected')));
      return;
    }
    const off = staged.off;
    const reqs = requirements(off, staged.qty);
    const short = reqs.some((r) => r.have < r.need);
    if (short) live.append(el('div', { class: 'barter__warn' }, t("You don't have some items to finish the deal")));
    if (off.lim != null || off._fence) {
      const total = off._fence ? off._fence.left : off.lim;
      const bought = off._fence ? 0 : total - offerLeft(off);
      live.append(el('div', { class: 'barter__warn' },
        t('This item is purchased in quantities of {0} pcs. (Max: {1}) limited for you in one restock', bought, total)));
    }
    live.append(el('div', { class: 'barter__need' }, t('The items needed from your stash:')));

    const list = el('div', { class: 'barter__reqs' }, uiImg('arrow_left', 'barter__arrow'));
    list.style.setProperty('--cols', String(Math.min(3, reqs.length)));
    let cash = '';
    reqs.forEach((r, i) => {
      const cur = CUR_OF_ITEM[r.id];
      const met = rowMet(r, i);
      const tpl = tplOf(r.id);
      const cell = el('div', { class: 'req__cell' });
      if (tpl?.imgUrl) cell.append(el('img', { src: tpl.imgUrl, alt: '' }));
      else if (cur) cell.append(el('span', { class: 'req__sym' }, CUR_SYM[cur]));
      else cell.append(el('span', { class: 'req__sym' }, r.id === 'dogtag' ? '▮' : '?'));
      const node = el('div', { class: `req${met ? ' is-met' : ''}`, title: cur ? '' : (r.id === 'dogtag' ? 'Dogtag' : itemName(r.id)) },
        r.attrs?.minLevel ? el('span', { class: 'req__level' }, `${t('LVL')} ${r.attrs.minLevel}`) : null,
        cell,
        uiImg(met ? 'needed_yes' : 'needed_no', 'req__mark'),
        el('span', { class: 'req__count' }, `${fmtNum(Math.min(r.have, r.need))}/${fmtNum(r.need)}`),
        r.attrs?.side && r.attrs.side !== 'Any' ? el('span', { class: 'req__side' }, String(r.attrs.side).toUpperCase()) : null);
      // with auto-fill off a row is filled by hand: one click on its box
      if (!autoFill && r.have >= r.need) {
        node.style.cursor = 'pointer';
        node.addEventListener('click', () => {
          if (filledRows.has(i)) filledRows.delete(i); else filledRows.add(i);
          sfx.ui('checkbox');
          sync();
        });
      }
      list.append(node);
      if (cur && reqs.length === 1) cash = `${CUR_SYM[cur]} ${fmtNum(r.need)}`;
    });
    live.append(list);
    sum.textContent = cash;
    bar.disabled = !!dealBlocker();
  }
  sync();
}

/** commit the staged offer as one transaction, the way DEAL! does */
function doBuyStaged() {
  closeContext();
  if (dealBlocker()) return;
  const { off, qty } = staged;
  const res = buyOffer(off, qty);
  if (!res.ok) { toast(res.reason, 'warn'); return; }
  sfx.trade('deal');
  // the offer stays on the table for the next one, unless that was the last
  if (offerState(off) === 'ok') { staged.qty = 1; filledRows = new Set(); } else clearStaged();
  renderTrade();
}

// ---------------------------------------------------------
// SELL
// ---------------------------------------------------------
function renderSell(host) {
  const who = trader;
  const onIt = tradeTable.items();
  const sellable = onIt.filter((it) => !sellBlocker(who, it));
  let total = 0;
  for (const it of sellable) total += sellPrice(who, it);

  const { bar, sum } = dealBar(() => doSell());
  bar.disabled = !sellable.length;
  sum.textContent = onIt.length ? `${CUR_SYM[who.cur]} ${fmtNum(total)}` : '';
  const zone = el('div', { class: 'selltable' });
  host.append(bar, zone);

  if (tradeTable.w !== TABLE.w || tradeTable.h < TABLE.h) tradeTable.resize(TABLE.w, Math.max(TABLE.h, tradeTable.h));
  const gridEl = renderGrid(tradeTable);
  gridEl.classList.add('table-grid');
  zone.append(gridEl);

  for (const it of onIt) {
    const tile = gridEl.querySelector(`.item[data-uid="${it.uid}"]`);
    if (!tile) continue;
    if (sellBlocker(who, it)) { tile.classList.add('is-nosell'); continue; }
    tile.classList.add('has-price');
    tile.append(el('div', { class: 'tsell' }, el('em', {}, CUR_SYM[who.cur]), fmtNum(sellPrice(who, it))));
  }
}

function doSell() {
  closeContext();      // no menu may outlive the transaction it is describing
  const who = trader;
  const onIt = tradeTable.items();
  if (!onIt.length) return;
  const res = sellItems(who, onIt);
  if (!res.ok) {
    toast(res.reason === 'No selected items' ? t('Trader does not deal in this type of items') : res.reason, 'warn');
    return;
  }
  sfx.trade('deal');
  renderTrade();
}

// ---------------------------------------------------------
// the stash, on the right
// ---------------------------------------------------------
function renderDockedStash() {
  const host = $('#trade-stash-host');
  if (!host) return;
  let gridEl;
  keepScroll([host], () => {
    host.replaceChildren();
    gridEl = renderGrid(game.stash);
    host.append(gridEl);
  });
  markOpenable(host);

  const selling = tab === 'trade' && mode === 'sell';
  const present = new Set(['all']);
  for (const node of gridEl.querySelectorAll('.item')) {
    const it = node._item;
    if (!it) continue;
    present.add(groupOf(it.tpl));
    let dim = false;
    if (stashCategory !== 'all' && groupOf(it.tpl) !== stashCategory) dim = true;
    if (search && !(`${it.tpl.name} ${it.tpl.short || ''}`.toLowerCase().includes(search))) dim = true;
    if (selling) {
      // every thing he would take wears what he would pay for it
      if (sellBlocker(trader, it) || !isKnown(it)) dim = true;
      else {
        node.classList.add('has-price');
        node.append(el('div', { class: 'tsell' }, el('em', {}, CUR_SYM[trader.cur]), fmtNum(sellPrice(trader, it))));
      }
    }
    if (dim) node.classList.add('is-nosell');
  }
  if (!present.has(stashCategory)) stashCategory = 'all';
  categoryStrip($('#stash-cats'), present, stashCategory, (key) => { stashCategory = key; renderDockedStash(); });
}

// ---------------------------------------------------------
// TASKS / SERVICES
// ---------------------------------------------------------
function renderTasksTab() {
  const host = $('#trader-tasks-host');
  if (!host || !trader) return;
  renderTasksPane(host, trader, { onChange: () => { renderChrome(); } });
}

function renderServices() {
  const host = $('#trader-services-host');
  host.replaceChildren(
    el('div', { class: 'svc__list' },
      el('button', { class: 'svc__row', dataset: { sfx: 'own' } },
        el('span', { class: 'svc__thumb' }, uiImg('tactical_icon')),
        el('span', {}, t('ECustomizationItemCategory/Clothing')))),
    el('div', { class: 'svc__pane' },
      el('div', { class: 'svc__head' }, uiImg('tactical_icon_small'), el('span', {}, t('ECustomizationItemCategory/Clothing')),
        el('em', {}, (game.profile.faction || 'USEC').toUpperCase())),
      el('div', { class: 'svc__note' }, '')));
}

/** traders restock on their own clocks now; kept for the callers that asked for it by name */
export function restockTraders() { shelfItems.clear(); clearStaged(); }
export function rerollFence() { restockTraders(); }
export function activeTraderId() { return trader ? trader.key : null; }

/** headless capture hooks: ?dev=trade-sell / ?dev=trade-dialog / ?dev=trade-tasks */
export function devTrade(kind) {
  const who = DB.traderByKey.prapor;
  if (kind === 'sell') {
    openTraderScreen(who);
    mode = 'sell';
    renderTrade();
    for (const it of game.stash.items()) {
      if (tradeTable.count >= 3) break;
      if (!sellBlocker(who, it)) autoPlace(it, [tradeTable]);
    }
    renderTrade();
  } else if (kind === 'dialog') {
    openTraderScreen(who);
    const o = offersOf(who).find((x) => offerState(x) === 'ok' && offerLeft(x) > 1);
    if (o) { stageOffer(o); stageOffer(o); }
  } else if (kind === 'tasks') {
    openTraderScreen(who, 'tasks');
  }
}
