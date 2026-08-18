// =========================================================
// trader screen, laid out like the real game:
//
//  - a strip of trader portrait tabs across the top (LL numeral + currency)
//  - loyalty bar with roman numeral tiers and the player's balance
//  - BUY: the assortment packed into an item grid, price captions on the
//    tiles, lock plates over higher-loyalty offers, stock counters. Picking
//    an offer STAGES it on a trading table - it does not buy it. The table
//    totals up, the payment has to be allocated ("Fill items"), and DEAL!
//    commits every staged offer in one transaction.
//  - SELL: the mirror of that. Drag items onto the table, each carries what
//    the trader will pay for it, then DEAL!.
//  - REPAIR (Prapor, Skier, Mechanic): a gun goes on the bench, a slider picks
//    how many points of durability to put back, the price is the weapon's
//    RepairCost x points x the trader's rate for your loyalty level, and the
//    trader's quality decides how much comes off the gun's ceiling.
//  - the stash stays docked on the right the whole time
//
// The wording is the game's own, read out of tools/cache/en.json: "DEAL!"
// keeps its exclamation mark, "Fill items" is the Autofill key, and the
// blocked states say "No selected items" / "Not enough money" /
// "Not enough space in stash" / "Bad user loyalty level" verbatim. Neither
// side pops a confirmation modal - staging is the confirmation.
// =========================================================

import { $, $$, el, icon, fmtNum, clamp, keepScroll, debounce } from '../core/util.js';
import { TRADERS, TRADER_BY_ID, loyaltyFor, canBuyFrom, sellValue, buyPrice, buyCurrency, LOYALTY_LEVELS } from '../data/traders.js';
import { TPL, FX } from '../data/items.js';
import { game, countMoney, addMoney, canAddMoney, takeMoney, traderState, saveSoon, addExp, registerSaveSection } from '../core/state.js';
import { Item, Grid, autoPlace, detach } from '../inventory/model.js';
import { renderGrid } from '../inventory/view.js';
import { isKnown, needsExamine } from '../inventory/examine.js';
import { dndContext, quickTransfer, isDragging } from '../inventory/dnd.js';
import { setContextProvider, inspectDialog, closeContext } from '../inventory/dialogs.js';
import { openContainerWindow, refreshContainerWindows, closeContainerWindow } from '../inventory/window.js';
import { moddingContext } from '../inventory/modding.js';
import {
  isRepairable, repairNeeded, traderRepairRate, traderRepairPrice, traderRepair, wearRange,
} from '../inventory/repair.js';
import { buildMenu, markOpenable, examineNow } from './stash.js';
import { sfx } from '../core/audio.js';
import { on, emit, EV } from '../core/events.js';
import { toast, refreshTopbar } from './shell.js';

let activeId = 'prapor';
let mode = 'buy';

const CUR_SYM = { RUB: '₽', USD: '$', EUR: '€' };
const ROMAN = ['I', 'II', 'III', 'IV'];
const FENCE_REFRESH_COST = 5000;
/** ceiling on one order, matching the three digits the quantity box takes */
const MAX_BUY_QTY = 999;

/**
 * The sell zone: items dragged here are what the DEAL button will sell. Its
 * footprint is not fixed — fitTable() sizes it to the box the middle column
 * has for it, so the whole table is on screen at once and never scrolls. This
 * is only the floor it starts from and can never drop under.
 */
const TABLE_MIN = { w: 4, h: 4 };
export const tradeTable = new Grid(TABLE_MIN.w, TABLE_MIN.h, { tag: 'tradeTable', label: 'TRADING TABLE' });
tradeTable.mayAccept = (item) => (mode === 'repair'
  ? repairableHere(TRADER_BY_ID[activeId], item)
  : sellableTo(TRADER_BY_ID[activeId], item));

/**
 * The repair bench takes one gun at a time: this trader mends weapons, the
 * item is a gun with a durability track and it is short of its ceiling.
 */
function repairableHere(trader, item) {
  if (!trader?.repair || !isRepairable(item)) return false;
  if (!isKnown(item)) return false;
  if (repairNeeded(item) <= 0) return false;
  const on = tradeTable.items();
  return on.length === 0 || (on.length === 1 && on[0] === item);
}
/** points staged for the repair of the gun on the bench (null = all of it) */
let repairPts = null;

/**
 * The buy-side trading table. Picking an offer stages it here; nothing is
 * bought until DEAL!.
 *
 * One offer at a time, with a quantity - not a cart. The client's own locale
 * is singular throughout: the header key is "Item to purchase", and the
 * restock limits read "This item is purchased in quantities of {0} pcs." and
 * "You have already bought the maximum amount of this item". The multi-select
 * wording that does exist ("Amount of items to purchase:", "Are you sure you
 * want to buy selected items for {0}?") is all prefixed ragfair/ - it belongs
 * to the flea market, which is a different screen.
 *
 * Either null or { off, tpl, qty }.
 */
let staged = null;
/**
 * Whether the payment has been allocated. The game makes you put the money
 * on the table too - by hand, or with the "Fill items" button - and DEAL!
 * stays inert until the requirement slot is covered.
 */
let filled = false;

function clearStaged() {
  staged = null;
  filled = false;
}

const stagedTotal = (t) =>
  (staged ? buyPrice(t, staged.tpl, FX, staged.off) * staged.qty : 0);

const stagedCurrency = (t) =>
  (staged ? buyCurrency(t, staged.tpl, staged.off) : t.currency);

function sellableTo(trader, item) {
  if (!trader || !canBuyFrom(trader, item)) return false;
  if (item.tpl.cat === 'money') return false;
  // like the game: unexamined items cannot be traded, and containers have to
  // be emptied before they go on the table
  if (!isKnown(item)) return false;
  if (!item.isEmptyContainer) return false;
  // hard-currency traders round down; if that lands on zero they pass
  if (sellValue(trader, item, FX) < 1) return false;
  return true;
}

// remember the starting stock so restocks can restore it — at module scope,
// because the save's stock section restores before initTrade ever runs
for (const t of TRADERS) for (const off of t.assort) off.base = off.stock;

export function initTrade() {
  for (const seg of $$('#pane-traders .seg')) {
    seg.addEventListener('click', () => {
      if (mode === seg.dataset.mode) return;
      mode = seg.dataset.mode;
      sfx.trade('click');
      returnTableItems();
      clearStaged();
      renderTrade();
    });
  }

  // leaving the trader pane clears the table back into the stash
  on(EV.SCREEN_CHANGED, (id) => {
    if (id !== 'hideout:traders' && tradeTable.count) {
      returnTableItems();
      emit(EV.INVENTORY_CHANGED);
      saveSoon();
    }
  });

  // closing the tab with items still on the table must not lose them: this
  // listener registers before main.js registers save(), so it runs first
  window.addEventListener('beforeunload', () => {
    if (tradeTable.count) returnTableItems();
  });

  // the table is cut to the column's size, so a resized window (or a cell-size
  // breakpoint) has to cut it again
  window.addEventListener('resize', debounce(() => {
    if ((mode === 'sell' || mode === 'repair') && tradeScreenActive()) renderTrade();
  }, 160));

  // the deal bar advertises SPACE, so SPACE has to actually close the deal
  document.addEventListener('keydown', (e) => {
    if (e.key !== ' ' && e.code !== 'Space') return;
    if (!tradeScreenActive()) return;
    const tag = e.target?.tagName;
    // typing, or a focused control that already answers to SPACE itself
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'BUTTON' || e.target?.isContentEditable) return;
    if (!$('#modal-root').hidden || isDragging()) return;
    // Clicking DEAL! closes the context menu on the way in, because the
    // pointerdown lands outside it. A key press does not, and the menu's
    // actions still hold the Item that the deal is about to detach — REMOVE
    // FROM TABLE on a sold item put it back in the stash, payout and all.
    if (!$('#context-menu').hidden) return;
    e.preventDefault();
    const t = TRADER_BY_ID[activeId];
    if (mode === 'buy') doBuyStaged(t);
    else if (mode === 'repair') doRepair(t);
    else doSell(t);
  });
}

function tradeScreenActive() {
  return !!$('#screen-hideout')?.classList.contains('is-active')
    && !!$('#pane-traders')?.classList.contains('is-active');
}

// if the page dies between the debounced saves (crash, hard reload), whatever
// sat on the trading table is serialised too, and lands back in the stash on
// the next boot; anything the stash cannot take simply stays on the table
registerSaveSection('tradeTable', {
  roots: () => [tradeTable],
  dump: () => (tradeTable.count ? tradeTable.toJSON() : null),
  restore: (v) => {
    // the table was as big as that window's column when it was saved; loadJSON
    // drops whatever falls outside the current footprint, so match it first
    if (v && v.w && v.h) tradeTable.resize(v.w, v.h);
    tradeTable.loadJSON(v);
    for (const it of tradeTable.items()) autoPlace(it, [game.stash]);
  },
});

// trader stock and Fence's rotating assortment survive a reload too —
// otherwise F5 was a free global restock
registerSaveSection('traderStock', {
  dump: () => {
    const stock = {};
    for (const t of TRADERS) {
      const s = {};
      for (const off of t.assort) if (off.base != null && off.stock !== off.base) s[off.key] = off.stock;
      if (Object.keys(s).length) stock[t.id] = s;
    }
    const fence = fenceStock
      ? fenceStock.map((o) => ({ key: o.key, ll: o.ll, stock: o.stock, base: o.base }))
      : null;
    return (Object.keys(stock).length || fence) ? { stock, fence } : null;
  },
  restore: (v) => {
    if (!v) return;
    for (const t of TRADERS) {
      const s = v.stock?.[t.id];
      if (!s) continue;
      for (const off of t.assort) {
        if (s[off.key] != null) off.stock = Math.max(0, Math.min(off.base ?? s[off.key], s[off.key]));
      }
    }
    if (Array.isArray(v.fence)) {
      const valid = v.fence.filter((o) => TPL[o.key]);
      if (valid.length) fenceStock = valid;
    }
  },
});

export function activateTradeContext() {
  dndContext.quickTargets = (item) => {
    // on the buy side there is nowhere for a stash item to go; returning the
    // stash itself made ctrl+click shuffle items to a random free cell
    if (mode !== 'sell' && mode !== 'repair') return [];
    return onTable(item) ? [game.stash] : [tradeTable];
  };
  // the modding screen and the ammo dialogs are reachable from here too:
  // parts and rounds come from the stash and what is worn, as in the hideout
  moddingContext.sources = () => [game.stash, ...game.equipment.allGrids(), ...game.equipment.nestedGrids()];
  dndContext.equipSlotFor = () => null;
  dndContext.requestSplit = null;
  dndContext.canMove = (item) => !item.virtual;
  dndContext.onActivate = (item) => {
    // a single click on a shelf tile already stages the offer; letting the
    // double-click stage it again put three on the table for two clicks
    if (item.virtual) return;
    // the menu on this screen promises EXAMINE on DBL-CLICK just as the stash
    // does, and this branch was the one thing missing to make that true
    if (needsExamine(item)) { examineNow(item); return; }
    if (item.isContainer && !onTable(item)) { openContainerWindow(item); return; }
    quickTransfer(item);
  };
  dndContext.onChange = () => { renderTrade(); emit(EV.INVENTORY_CHANGED); saveSoon(); };

  setContextProvider((item) => {
    const t = TRADER_BY_ID[activeId];
    if (item.virtual) {
      const off = item.offer;
      const locked = off.ll > loyaltyLevel(t);
      const actions = [];
      // in SELL mode the showcase is a display case: buying from it here would
      // stage an offer the player cannot see and cannot complete
      if (mode === 'buy') {
        actions.push({
          label: `BUY — ${fmtNum(buyPrice(t, item.tpl, FX, off))}${CUR_SYM[buyCurrency(t, item.tpl, off)]}`,
          icon: 'cart', disabled: locked || off.stock <= 0,
          run: () => stageOffer(t, off),
        });
      }
      actions.push({ label: 'INSPECT', icon: 'info', run: () => inspectDialog(item) });
      return actions;
    }
    const extra = [];
    if (mode === 'sell') {
      if (onTable(item)) {
        extra.push({
          label: 'REMOVE FROM TABLE', icon: 'back',
          run: () => {
            // a sold item still has a holder-less object behind this closure;
            // autoPlace would happily put it back and pay the player twice
            if (!item.holder) return;
            if (!autoPlace(item, [game.stash])) toast('No room in the stash', 'warn');
            dndContext.onChange();
          },
        });
      } else if (sellableTo(t, item)) {
        extra.push({
          label: `PLACE ON TABLE — ${fmtNum(sellValue(t, item, FX))}${CUR_SYM[t.currency]}`,
          icon: 'sell',
          run: () => {
            if (!item.holder) return;
            if (!autoPlace(item, [tradeTable])) toast('No room on the table', 'warn');
            dndContext.onChange();
          },
        });
      } else if (item.tpl.cat !== 'money') {
        const why = !isKnown(item) ? 'EXAMINE IT TO SELL'
          : !item.isEmptyContainer ? 'EMPTY IT TO SELL'
            : `${t.name} DOES NOT BUY THIS`;
        extra.push({ label: why, icon: 'warn', disabled: true, run: () => {} });
      }
    } else if (mode === 'repair') {
      if (onTable(item)) {
        extra.push({
          label: 'TAKE OFF THE BENCH', icon: 'back',
          run: () => {
            if (!item.holder) return;
            if (!autoPlace(item, [game.stash])) toast('No room in the stash', 'warn');
            repairPts = null;
            dndContext.onChange();
          },
        });
      } else if (repairableHere(t, item)) {
        extra.push({
          label: `PUT ON THE BENCH — ${fmtNum(traderRepairPrice(t, item, repairNeeded(item), loyaltyLevel(t)))}₽ FULL`,
          icon: 'check',
          run: () => {
            if (!item.holder) return;
            if (!autoPlace(item, [tradeTable])) toast('The bench is taken', 'warn');
            repairPts = null;
            dndContext.onChange();
          },
        });
      } else if (item.isWeapon && t.repair && isRepairable(item) && repairNeeded(item) <= 0) {
        extra.push({ label: 'NOTHING TO REPAIR', icon: 'warn', disabled: true, run: () => {} });
      }
    }
    // a case sitting on the trading table must not be openable: filling it
    // there hid items inside something the trader was about to take away
    return buildMenu(item, 'trade', extra, { noOpen: onTable(item) });
  });
}

function loyaltyLevel(t) {
  const st = traderState(t.id);
  return loyaltyFor(game.profile.level, st.rep, st.spent);
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
    // autoPlace only detaches once it has found a home, so a failure simply
    // leaves the item sitting on the table
    if (!autoPlace(it, [game.stash])) stuck++;
  }
  if (stuck) toast('Stash is full — items left on the table', 'warn');
}

// ---------------------------------------------------------
export function renderTrade() {
  const tabs = $('#trader-tabs');
  if (!tabs) return;
  const t = TRADER_BY_ID[activeId];

  renderTabs(tabs);
  renderBar($('#trader-bar'), t);
  renderAssortTools(t);

  // only the three who mend guns get the REPAIR tab; landing on it at a
  // trader who does not falls back to BUY
  const repairSeg = $('#pane-traders .seg[data-mode="repair"]');
  if (repairSeg) repairSeg.hidden = !t.repair;
  if (mode === 'repair' && !t.repair) { returnTableItems(); mode = 'buy'; }
  for (const seg of $$('#pane-traders .seg')) {
    seg.classList.toggle('is-active', seg.dataset.mode === mode);
  }

  // left column is the shelf, middle column is the table; in sell mode the
  // shelf is idle and the table is what the stash drops onto
  const content = $('#trader-content');
  const table = $('#trade-table-host');
  // both of these scrollers are rebuilt as brand-new elements, so their offset
  // has to be carried across by hand or every action scrolls them home
  const shelfTop = $('.assort-scroll', content)?.scrollTop || 0;
  const zone = $('.table-zone', table);
  const zoneTop = zone?.scrollTop || 0;
  const zoneLeft = zone?.scrollLeft || 0;
  content.replaceChildren();
  table.replaceChildren();
  if (mode === 'buy') { renderBuy(t, content); renderBuyTable(t, table); }
  else if (mode === 'repair') { renderShowcaseIdle(t, content); renderRepair(t, table); }
  else { renderShowcaseIdle(t, content); renderSell(t, table); }
  const shelf = $('.assort-scroll', content);
  if (shelf) shelf.scrollTop = shelfTop;
  const zone2 = $('.table-zone', table);
  if (zone2) { zone2.scrollTop = zoneTop; zone2.scrollLeft = zoneLeft; }

  const clear = $('#btn-trade-clear');
  if (clear) {
    // the button is labelled "Clear the table", so it has to be live whenever
    // the table holds something — items stranded there are invisible in BUY
    // mode, and this was the only control that could reach them
    clear.disabled = !staged && !tradeTable.count;
    clear.onclick = () => {
      if (mode === 'buy') clearStaged();
      repairPts = null;
      if (tradeTable.count) returnTableItems();
      sfx.trade('click');
      renderTrade();
      emit(EV.INVENTORY_CHANGED);
      saveSoon();
    };
  }

  renderDockedStash(t);
  // a case on the trading table is on its way out of the stash; its popped-out
  // window would let the player keep loading it right up to the sale
  for (const it of tradeTable.items()) {
    if (it.isContainer) closeContainerWindow(it.uid);
    for (const d of it.descendants()) if (d.isContainer) closeContainerWindow(d.uid);
  }
  refreshContainerWindows();
}

/** in sell mode the showcase still shows what the trader stocks, unclickable */
function renderShowcaseIdle(t, host) {
  renderBuy(t, host, true);
}

/**
 * The showcase toolbar. Only Fence has anything to put in it — but it lives in
 * static DOM, so it has to be cleared for everyone else or his REFRESH STORE
 * button stayed behind on Prapor's shelf and still charged 5000₽ to reroll a
 * store the player was no longer looking at.
 */
function renderAssortTools(t) {
  const tools = $('#assort-tools');
  if (!tools) return;
  tools.replaceChildren();
  if (t.id !== 'fence') return;

  const btn = el('button', {
    class: 'btn btn--sm', dataset: { sfx: 'own' },
    disabled: countMoney('RUB') < FENCE_REFRESH_COST,
    onclick: () => {
      if (!takeMoney(FENCE_REFRESH_COST, 'RUB')) { toast('Not enough money', 'warn'); return; }
      fenceStock = null;
      // the staged offer belonged to the old assortment and no longer exists
      clearStaged();
      sfx.trade('click');
      toast('Fence found new stock', 'ok');
      renderTrade(); refreshTopbar(); emit(EV.INVENTORY_CHANGED); saveSoon();
    },
  }, icon('rotate'), 'REFRESH STORE');
  btn.title = `Fence finds new stock — ${fmtNum(FENCE_REFRESH_COST)}₽`;
  tools.append(btn);
}

function renderTabs(host) {
  host.replaceChildren();
  for (const t of TRADERS) {
    const ll = loyaltyLevel(t);
    const tab = el('button', {
      class: `ttab${t.id === activeId ? ' is-active' : ''}`,
      onclick: () => {
        if (activeId !== t.id) {
          activeId = t.id;
          sfx.trade('tab');
          returnTableItems();
          // an unfinished deal does not follow you to the next trader
          clearStaged();
          renderTrade();
        }
      },
    });
    const pic = el('div', { class: 'ttab__pic' });
    pic.append(el('img', { src: `assets/traders/${t.id}.png`, alt: '', loading: 'lazy' }));
    pic.append(el('span', { class: 'ttab__ll' }, ROMAN[ll - 1] || 'I'));
    pic.append(el('span', { class: 'ttab__cur' }, CUR_SYM[t.currency]));
    tab.append(pic, el('div', { class: 'ttab__name' }, t.name));
    host.append(tab);
  }
}

function renderBar(host, t) {
  host.replaceChildren();
  const st = traderState(t.id);
  const ll = loyaltyLevel(t);
  const next = LOYALTY_LEVELS.find((l) => l.level === ll + 1);

  const id = el('div', { class: 'tbar__id' },
    el('div', { class: 'tbar__name' }, t.name),
    el('div', { class: 'tbar__tag' }, t.tag));

  // roman numeral tier blocks, exactly like the loyalty widget in the game
  const tiers = el('div', { class: 'tbar__tiers' });
  for (const l of LOYALTY_LEVELS) {
    tiers.append(el('div', {
      class: `tier${l.level <= ll ? ' is-on' : ''}${l.level === ll ? ' is-cur' : ''}`,
      title: l.level === 1 ? 'Loyalty level 1'
        : `Requires PMC ${l.pmc} · rep ${l.rep.toFixed(2)} · ${fmtNum(l.spent)}₽ spent`,
    }, ROMAN[l.level - 1]));
  }
  const rep = el('div', { class: 'tbar__rep' },
    el('span', {}, `REP ${st.rep.toFixed(2)}`),
    el('span', {}, `SPENT ${fmtNum(st.spent)}₽`),
    next
      ? el('span', { class: 'tbar__next' },
        `NEXT: PMC ${next.pmc} · REP ${next.rep.toFixed(2)} · ${fmtNum(next.spent)}₽`)
      : el('span', { class: 'tbar__next' }, 'MAXIMUM LOYALTY'));

  const wallet = el('div', { class: 'tbar__wallet' });
  for (const cur of ['RUB', 'USD', 'EUR']) {
    wallet.append(el('div', { class: `wallet-chip${cur === t.currency ? ' is-active' : ''}` },
      el('span', { class: 'wallet-chip__sym' }, CUR_SYM[cur]),
      el('span', {}, fmtNum(countMoney(cur)))));
  }

  host.append(id, el('div', { class: 'tbar__loyal' }, tiers, rep), wallet);
}

// ---------------------------------------------------------
// BUY
// ---------------------------------------------------------
function renderBuy(t, host, idle = false) {
  const ll = loyaltyLevel(t);
  const offers = t.assort.length ? t.assort : randomFenceStock();

  const wrap = el('div', { class: 'assort-wrap' });

  if (!offers.length) {
    wrap.append(el('div', { class: 'empty-note' }, 'NOTHING IN STOCK'));
    host.append(wrap);
    return;
  }

  // pack the assortment into a real inventory grid, biggest footprints first,
  // so the shelf reads exactly like the in-game one
  const entries = offers
    .map((off) => ({ off, tpl: TPL[off.key] }))
    .filter((e) => e.tpl)
    .sort((a, b) => (b.tpl.w * b.tpl.h) - (a.tpl.w * a.tpl.h));

  const COLS = 8;
  // a gun on the shelf is the assembled preset, so it is measured assembled
  for (const e of entries) {
    e.disp = new Item(e.off.key, { examined: true });
    e.disp.virtual = true;
    e.disp.offer = e.off;
  }
  entries.sort((a, b) => (b.disp.fw * b.disp.fh) - (a.disp.fw * a.disp.fh));
  const cells = entries.reduce((n, e) => n + e.disp.fw * e.disp.fh, 0);
  const shelf = new Grid(COLS, cells + 8, { tag: 'assort' });
  // display only: the player must never be able to drop real items in here
  shelf.mayAccept = (it) => !!it.virtual;

  const placed = [];
  for (const e of entries) {
    const disp = e.disp;
    const spot = shelf.findSpot(disp);
    if (!spot) continue;
    shelf.place(disp, spot.x, spot.y, spot.rot);
    placed.push({ disp, ...e });
  }

  // trim the shelf to the packed height so no empty rows trail below
  let maxY = 4;
  for (const { disp } of placed) {
    const p = shelf.posOf(disp);
    if (p) maxY = Math.max(maxY, p.y + disp.h);
  }
  shelf.h = maxY;
  shelf.cells = shelf.cells.slice(0, shelf.w * shelf.h);

  const gridEl = renderGrid(shelf);
  gridEl.classList.add('assort-grid');

  // dress each tile up with price caption, stock counter and loyalty plate
  for (const { disp, off, tpl } of placed) {
    const tile = gridEl.querySelector(`.item[data-uid="${disp.uid}"]`);
    if (!tile) continue;
    const locked = off.ll > ll;
    const out = off.stock <= 0;

    // price top-left with an oversized currency glyph, stock bottom-right —
    // the way the real showcase cell reads
    tile.append(el('div', { class: 'toffer__price' },
      el('em', {}, CUR_SYM[buyCurrency(t, tpl, off)]),
      fmtNum(buyPrice(t, tpl, FX, off))));

    tile.append(el('div', { class: `toffer__stock${out ? ' is-out' : ''}` },
      off.base == null || off.base >= 1000 ? 'A LOT' : String(off.stock)));
    if (locked) {
      tile.classList.add('toffer--locked');
      tile.append(el('div', { class: 'toffer__lock' },
        icon('lock', 'ico'), el('span', {}, ROMAN[off.ll - 1] || String(off.ll))));
    } else if (out) {
      tile.classList.add('toffer--out');
      tile.append(el('div', { class: 'toffer__out' }, 'OUT OF STOCK'));
    } else {
      // clicking an offer puts it on the trading table; it does not buy it
      if (!idle) {
        tile.classList.add('toffer--buyable');
        tile.title = 'Click to put on the trading table';
        tile.addEventListener('click', (ev) => {
          // a drag that ends on the tile must not also count as a pick
          if (ev.detail === 0) return;
          stageOffer(t, off);
        });
      }
      if (staged && staged.off === off) tile.classList.add('toffer--staged');
    }
  }

  const scroll = el('div', { class: 'assort-scroll' });
  scroll.append(gridEl);
  wrap.append(scroll);
  host.append(wrap);
}

/**
 * Put an offer on the trading table. This is the step the screen was missing:
 * picking something from the shelf stages it, it does not buy it.
 */
function stageOffer(t, off) {
  const tpl = TPL[off.key];
  if (!tpl) return;
  // the sell screen has no transaction panel to show a staged purchase in
  if (mode !== 'buy') return;
  if (off.ll > loyaltyLevel(t)) { toast('Bad user loyalty level', 'warn'); return; }
  if (off.stock <= 0) { toast('Item is out of stock', 'warn'); return; }

  // one offer at a time: picking a different one replaces what is on the
  // table, picking the same one again adds another of it
  if (staged && staged.off === off) {
    // the same ceiling the quantity box enforces, so clicking cannot walk the
    // order past what the field will let you type back
    if (staged.qty >= Math.min(off.stock, MAX_BUY_QTY)) {
      toast(staged.qty >= MAX_BUY_QTY ? 'Maximum amount reached' : 'Item is out of stock', 'warn');
      return;
    }
    staged.qty++;
  } else {
    staged = { off, tpl, qty: 1 };
  }
  // the money has to be allocated again once the price moves
  filled = false;
  sfx.trade('click');
  renderTrade();
}

/** why DEAL! cannot be pressed yet, in the game's own words */
function dealBlocker(t) {
  if (!staged) return 'No selected items';
  const cur = stagedCurrency(t);
  const total = stagedTotal(t);
  if (countMoney(cur) < total) return 'Not enough money';
  if (!filled) return 'You don\'t have some items required to finish the deal';
  return null;
}

/**
 * The transaction panel: what is on the table, what it costs, the payment
 * slot, and the two buttons that drive the real screen - "Fill items" to
 * allocate the money and "DEAL!" to commit the lot in one go.
 */
function renderBuyTable(t, host) {
  const cur = stagedCurrency(t);

  // the deal bar sits at the top of the column and carries the total itself
  const sumEl = el('span', { class: 'deal-bar__sum' }, '');
  const dealBtn = el('button', { class: 'deal-bar', dataset: { sfx: 'own' } },
    el('span', { class: 'deal-bar__key' }, 'SPACE'),
    el('span', { class: 'deal-bar__label' }, 'DEAL!'),
    sumEl);
  dealBtn.addEventListener('click', () => doBuyStaged(t));
  host.append(dealBtn);

  const wrap = el('div', { class: 'deal-wrap' });
  wrap.append(el('div', { class: 'deal-head' },
    staged ? 'Item to purchase: ' + staged.tpl.name : 'Item to purchase'));

  const rows = el('div', { class: 'deal-rows' });
  if (!staged) {
    rows.append(el('div', { class: 'deal-empty' }, 'No selected items',
      el('small', {}, 'click an offer on the shelf to put it on the table')));
  } else {
    const unit = buyPrice(t, staged.tpl, FX, staged.off);
    const cap = Math.min(staged.off.stock, MAX_BUY_QTY);

    // one stash cell per grid square, so what you are buying is drawn at the
    // size it will be once it is sitting in the stash
    const art = el('div', {
      class: 'deal-row__art',
      style: {
        width: `calc(var(--cell) * ${staged.tpl.w})`,
        height: `calc(var(--cell) * ${staged.tpl.h})`,
      },
    });
    if (staged.tpl.imgUrl) art.append(el('img', { src: staged.tpl.imgUrl, alt: '' }));
    else art.append(el('div', { class: 'item__fallback' }, staged.tpl.short));

    // A typed box, not a number spinner \u2014 which is what the real transaction
    // area has, and which also keeps the field from rebuilding the panel under
    // the player's cursor: `change` fires on blur, so re-rendering there ate
    // the very click on DEAL!/Fill items that caused the blur.
    const qtyEl = el('input', {
      class: 'deal-row__qty', type: 'text', inputmode: 'numeric',
      autocomplete: 'off', spellcheck: 'false', maxlength: '3',
      value: String(staged.qty),
      title: fmtNum(unit) + ' ' + CUR_SYM[cur] + ' each, '
        + (staged.off.stock >= 1000 ? 'plenty' : staged.off.stock) + ' in stock',
    });
    qtyEl.addEventListener('input', () => {
      const digits = qtyEl.value.replace(/\D/g, '');
      if (digits !== qtyEl.value) qtyEl.value = digits;
      if (!digits) return;                       // mid-edit; wait for a number
      const n = clamp(parseInt(digits, 10) || 1, 1, cap);
      if (String(n) !== digits) qtyEl.value = String(n);
      if (n === staged.qty) return;
      staged.qty = n;
      filled = false;                            // the price moved
      sync();
    });
    qtyEl.addEventListener('blur', () => { qtyEl.value = String(staged ? staged.qty : 1); });

    // the showcase is to the left, so the chevron points back at it
    rows.append(el('div', { class: 'deal-row' },
      el('span', { class: 'deal-row__chev' }, '\u203A'),
      art,
      el('span', { class: 'deal-row__x' }, 'X'),
      qtyEl,
      el('button', {
        class: 'deal-row__drop', title: 'Take it back off the table',
        onclick: () => { clearStaged(); sfx.trade('click'); renderTrade(); },
      }, '\u00D7')));
  }
  wrap.append(rows);

  // what has to be handed over, with the same n/n progress the real slot shows
  let slotEl = null, cellEl = null, ratioEl = null;
  if (staged) {
    wrap.append(el('div', { class: 'deal-need' }, 'This item(s) is required from your stash:'));
    cellEl = el('div', { class: 'deal-slot__cell' },
      el('span', { class: 'deal-slot__sym' }, CUR_SYM[cur]));
    ratioEl = el('div', { class: 'deal-slot__ratio' }, '');
    slotEl = el('div', { class: 'deal-slot' },
      cellEl, el('span', { class: 'deal-slot__chev' }, '\u2039'), ratioEl);
    wrap.append(slotEl);
  }

  const fillBtn = el('button', {
    class: 'btn', dataset: { sfx: 'own' },
    title: 'Select to auto-fill requirements',
    onclick: () => { filled = true; sfx.trade('buy'); sync(); },
  }, 'Fill items');
  wrap.append(el('div', { class: 'deal-foot' }, fillBtn));
  const warnEl = el('div', { class: 'deal-warn' }, '');
  wrap.append(warnEl);

  /** repaint everything the quantity drives, without rebuilding the panel */
  function sync() {
    const total = stagedTotal(t);
    const funds = countMoney(cur);
    const short = total > funds;
    const blocker = dealBlocker(t);

    sumEl.textContent = CUR_SYM[cur] + ' ' + fmtNum(total);
    dealBtn.disabled = !!blocker;
    fillBtn.disabled = !staged || short || filled;
    warnEl.textContent = blocker || '';
    warnEl.hidden = !blocker;

    if (slotEl) {
      slotEl.classList.toggle('is-filled', filled);
      slotEl.classList.toggle('is-short', short);
      ratioEl.textContent = `${fmtNum(filled ? total : Math.min(funds, total))}/${fmtNum(total)}`;
      const tick = cellEl.querySelector('.deal-slot__tick');
      if (filled && !tick) cellEl.append(el('span', { class: 'deal-slot__tick' }, '\u2713'));
      else if (!filled && tick) tick.remove();
    }
  }
  sync();

  host.append(wrap);
}

/** commit every offer on the table as one transaction, the way DEAL! does */
function doBuyStaged(t) {
  closeContext();
  if (dealBlocker(t)) return;        // the button already says why it will not go through
  const cur = stagedCurrency(t);
  // charge for what is actually handed over: if the shelf ran short between
  // staging and DEAL!, the staged total would have billed for the difference
  const bought = Math.min(staged.qty, staged.off.stock);
  if (bought < 1) { toast('Item is out of stock', 'warn'); return; }
  const total = buyPrice(t, staged.tpl, FX, staged.off) * bought;
  if (countMoney(cur) < total) { toast('Not enough money', 'bad'); return; }

  // reserve space for the whole quantity first: a partial commit would take
  // the money for items that then have nowhere to go
  const made = [];
  for (let i = 0; i < bought;) {
    const stackSize = staged.tpl.stack > 1 ? Math.min(staged.tpl.stack, bought - i) : 1;
    const it = new Item(staged.tpl.key, { stack: stackSize, examined: true });
    // merging is off: it tops up stacks already in the stash, and that
    // cannot be rolled back by detaching the purchased item
    if (!autoPlace(it, [game.stash], { merge: false })) {
      for (const m of made) detach(m);
      toast('Not enough space in stash', 'warn');
      return;
    }
    made.push(it);
    i += stackSize;
  }

  takeMoney(total, cur);
  const st = traderState(t.id);
  const name = staged.tpl.name;
  staged.off.stock -= bought;
  st.spent += total * (FX[cur] || 1);
  st.rep = Math.min(10, st.rep + (total * (FX[cur] || 1)) / 900000);
  addExp(Math.round(bought * 2));

  clearStaged();
  sfx.trade('deal');
  toast(`Bought ${bought > 1 ? `${bought}x ` : ''}${name}`, 'ok');
  renderTrade();
  refreshTopbar();
  emit(EV.INVENTORY_CHANGED);
  saveSoon();
}

// ---------------------------------------------------------
// SELL
// ---------------------------------------------------------
function renderSell(t, host) {
  // Switching traders with a full stash can strand items on the table, and a
  // case can be filled after it was put down — so what the table holds is not
  // necessarily what THIS trader will take. Price only what he will.
  const onIt = tradeTable.items();
  const sellable = onIt.filter((it) => sellableTo(t, it));
  const refused = onIt.filter((it) => !sellableTo(t, it));
  let total = 0;
  for (const it of sellable) total += sellValue(t, it, FX);

  // the sell side mirrors the buy side: the same gold bar at the top of the
  // middle column, carrying the sum the trader will pay
  const dealBtn = el('button', {
    class: 'deal-bar', disabled: !sellable.length, dataset: { sfx: 'own' },
  },
  el('span', { class: 'deal-bar__key' }, 'SPACE'),
  el('span', { class: 'deal-bar__label' }, 'DEAL!'),
  el('span', { class: 'deal-bar__sum' }, CUR_SYM[t.currency] + ' ' + fmtNum(total)));
  dealBtn.addEventListener('click', () => doSell(t));
  host.append(dealBtn);

  const wrap = el('div', { class: 'deal-wrap' });
  wrap.append(el('div', { class: 'deal-head' },
    t.buysAll ? t.name + ' buys everything' : t.name + ' buys: ' + t.buys.join(', ')));

  const zone = el('div', { class: 'table-zone' });
  wrap.append(zone);

  // The warning line is always in the column, empty or not: the zone above it
  // is cut into rows off its own height, and a line coming and going would
  // have added and taken away a row of the table under the player's cursor.
  const warn = !onIt.length ? 'No selected items'
    : refused.length ? `${t.name} will not take ${refused.length} item${refused.length > 1 ? 's' : ''} on the table`
      : '';
  wrap.append(el('div', { class: 'deal-warn deal-warn--line' }, warn));
  host.append(wrap);

  // the zone has its box now — the table is cut to it before it is drawn
  fitTable(zone);
  const gridEl = renderGrid(tradeTable);
  gridEl.classList.add('table-grid');
  zone.append(gridEl);
  if (!tradeTable.count) {
    zone.append(el('div', { class: 'table-empty' },
      'DRAG ITEMS HERE', el('small', {}, 'or right-click an item in the stash')));
  }

  // what the trader pays for each staged item, on the item itself, so a bad
  // line is obvious before the deal rather than buried in the lump total
  for (const it of sellable) {
    const tile = gridEl.querySelector('.item[data-uid="' + it.uid + '"]');
    if (tile) {
      tile.append(el('div', { class: 'toffer__price' },
        fmtNum(sellValue(t, it, FX)) + ' ' + CUR_SYM[t.currency]));
    }
  }
  for (const it of refused) {
    const tile = gridEl.querySelector('.item[data-uid="' + it.uid + '"]');
    if (tile) {
      tile.classList.add('is-nosell');
      tile.append(el('div', { class: 'toffer__out' }, 'NOT BOUGHT'));
    }
  }
}

/**
 * Cut the trading table to the box the zone actually has: as many cells
 * across and down as fit at the current cell size, so the whole table is on
 * screen at once and nothing scrolls. The zone is measured empty — the column
 * sizes it, not what it holds — and only while the pane is laid out. It can
 * never come out under TABLE_MIN, nor under what is already lying on it
 * (Grid.resize sees to the latter).
 */
function fitTable(zone) {
  const cs = getComputedStyle(zone);
  const innerW = zone.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  const innerH = zone.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
  // nothing has a size while the pane is hidden: keep the last fit
  if (innerW <= 0 || innerH <= 0) return;
  const cell = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--cell')) || 62;
  // renderGrid draws a grid at cell * n plus a 1px border either side
  const cols = Math.max(TABLE_MIN.w, Math.floor((innerW - 2) / cell));
  const rows = Math.max(TABLE_MIN.h, Math.floor((innerH - 2) / cell));
  tradeTable.resize(cols, rows);
}

function doSell(t) {
  // no menu may outlive the transaction it is describing
  closeContext();
  // never sell what this trader does not deal in, and never destroy a case
  // that has been filled since it was put down
  const items = tradeTable.items().filter((it) => sellableTo(t, it));
  const refused = tradeTable.count - items.length;
  if (!items.length) {
    if (refused) toast(`${t.name} does not buy what is on the table`, 'warn');
    return;
  }
  let total = 0;
  for (const it of items) total += sellValue(t, it, FX);
  // the sold items sit on the table, not in the stash, so destroying them
  // frees no stash space — check the payout fits BEFORE anything is destroyed
  if (!canAddMoney(total, t.currency)) {
    toast('No room in the stash for the payout', 'warn');
    return;
  }
  // the cue only rings once the deal is actually going through
  sfx.trade('deal');
  addMoney(total, t.currency);
  for (const it of items) detach(it);
  const st = traderState(t.id);
  const rub = total * (FX[t.currency] || 1);
  st.rep = Math.min(10, st.rep + rub / 1400000);
  addExp(Math.round(items.length * 3));
  toast(`Sold ${items.length} item${items.length > 1 ? 's' : ''} — ${fmtNum(total)}${CUR_SYM[t.currency]}`, 'ok');
  if (refused) toast(`${refused} item${refused > 1 ? 's' : ''} left on the table`, 'warn');
  renderTrade();
  refreshTopbar();
  emit(EV.INVENTORY_CHANGED);
  saveSoon();
}

// ---------------------------------------------------------
// REPAIR
// ---------------------------------------------------------
/** the gun on the bench, if any */
function benchGun() {
  const on = tradeTable.items();
  return on.length === 1 && isRepairable(on[0]) ? on[0] : null;
}

function renderRepair(t, host) {
  const ll = loyaltyLevel(t);
  const rr = traderRepairRate(t, ll);
  const gun = benchGun();
  const need = gun ? repairNeeded(gun) : 0;
  const pts = gun ? Math.min(need, repairPts == null ? need : repairPts) : 0;
  const price = gun ? traderRepairPrice(t, gun, pts, ll) : 0;

  const sumEl = el('span', { class: 'deal-bar__sum' }, '₽ ' + fmtNum(price));
  const dealBtn = el('button', { class: 'deal-bar', dataset: { sfx: 'own' } },
    el('span', { class: 'deal-bar__key' }, 'SPACE'),
    el('span', { class: 'deal-bar__label' }, 'REPAIR'),
    sumEl);
  dealBtn.addEventListener('click', () => doRepair(t));
  host.append(dealBtn);

  const wrap = el('div', { class: 'deal-wrap deal-wrap--repair' });
  wrap.append(el('div', { class: 'deal-head' },
    `${t.name} repairs weapons · ${fmtNum(Math.round((rr?.rate || 1) * 100))}% of the base cost at LL${ll} · wear x${rr?.quality ?? 1}`));

  const zone = el('div', { class: 'table-zone table-zone--bench' });
  wrap.append(zone);

  const panel = el('div', { class: 'repair' });
  if (!gun) {
    panel.append(el('div', { class: 'deal-empty' }, 'No selected items',
      el('small', {}, 'drag a worn gun onto the bench, or right-click one in the stash')));
  } else {
    const max = gun.maxDura, cur = gun.dura;
    const after = Math.min(max, cur + pts);
    const [lo, hi] = wearRange(gun, { quality: rr?.quality ?? 1 });
    const per = traderRepairPrice(t, gun, 1, ll);
    const bar = el('div', { class: 'repair__bar' },
      el('i', { class: 'repair__bar-cur', style: { width: `${(cur / (gun.tpl.wpn.maxDura || max || 1)) * 100}%` } }),
      el('i', { class: 'repair__bar-add', style: { left: `${(cur / (gun.tpl.wpn.maxDura || max || 1)) * 100}%`, width: `${((after - cur) / (gun.tpl.wpn.maxDura || max || 1)) * 100}%` } }),
      el('i', { class: 'repair__bar-max', style: { left: `${(max / (gun.tpl.wpn.maxDura || max || 1)) * 100}%` } }));
    const field = el('input', { class: 'split__val', type: 'number', min: '0', max: String(need), value: String(pts) });
    const range = el('input', { type: 'range', min: '0', max: String(need), value: String(pts) });
    const readout = el('div', { class: 'repair__readout' });
    const sync = (v) => {
      repairPts = clamp(Math.round(Number(v) || 0), 0, need);
      field.value = String(repairPts); range.value = String(repairPts);
      const p = traderRepairPrice(t, gun, repairPts, ll);
      const a = Math.min(max, cur + repairPts);
      sumEl.textContent = '₽ ' + fmtNum(p);
      readout.textContent = `${fmt2(cur)} → ${fmt2(a)} of ${fmt2(max)} · ${fmtNum(per)}₽ a point · ${fmtNum(p)}₽`;
      bar.querySelector('.repair__bar-add').style.width = `${((a - cur) / (gun.tpl.wpn.maxDura || max || 1)) * 100}%`;
      dealBtn.disabled = repairPts <= 0 || countMoney('RUB') < p;
      warnEl.textContent = repairPts <= 0 ? 'No selected items' : countMoney('RUB') < p ? 'Not enough money' : '';
    };
    field.addEventListener('input', () => sync(field.value));
    range.addEventListener('input', () => sync(range.value));
    const warnEl = el('div', { class: 'deal-warn' }, '');
    panel.append(
      el('div', { class: 'repair__name' }, gun.tpl.name),
      el('div', { class: 'repair__dura' }, `DURABILITY ${fmt2(cur)} / ${fmt2(max)}`,
        max < (gun.tpl.wpn.maxDura || max) ? el('small', {}, ` (was ${gun.tpl.wpn.maxDura})`) : null),
      bar,
      el('div', { class: 'deal-need' }, 'Points to repair:'),
      el('div', { class: 'split__row' }, field, range),
      readout,
      el('div', { class: 'repair__wear' },
        `Each repair takes ${fmt2(lo)}–${fmt2(hi)} off the maximum durability (${t.name}: x${rr?.quality ?? 1}).`),
      warnEl);
    setTimeout(() => sync(pts), 0);
  }
  wrap.append(panel);
  host.append(wrap);

  fitBench(zone);
  const gridEl = renderGrid(tradeTable);
  gridEl.classList.add('table-grid');
  zone.append(gridEl);
  if (!tradeTable.count) {
    zone.append(el('div', { class: 'table-empty' }, 'DRAG A GUN HERE', el('small', {}, 'one at a time')));
  }
  if (!gun) dealBtn.disabled = true;
}

/** the bench is a small table: wide enough for the longest gun, two rows */
function fitBench(zone) {
  const cs = getComputedStyle(zone);
  const innerW = zone.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  if (innerW <= 0) { tradeTable.resize(Math.max(TABLE_MIN.w, 7), 3); return; }
  const cell = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--cell')) || 62;
  const cols = Math.max(TABLE_MIN.w, Math.min(8, Math.floor((innerW - 2) / cell)));
  tradeTable.resize(cols, Math.max(3, TABLE_MIN.h - 1));
}

function fmt2(v) { const r = Math.round(v * 100) / 100; return String(r); }

function doRepair(t) {
  closeContext();
  const gun = benchGun();
  if (!gun || !t.repair) return;
  const ll = loyaltyLevel(t);
  const need = repairNeeded(gun);
  const pts = Math.min(need, repairPts == null ? need : repairPts);
  if (pts <= 0) return;
  const price = traderRepairPrice(t, gun, pts, ll);
  if (countMoney('RUB') < price) { toast('Not enough money', 'bad'); return; }
  takeMoney(price, 'RUB');
  const r = traderRepair(t, gun, pts, ll);
  const st = traderState(t.id);
  st.spent += price;
  st.rep = Math.min(10, st.rep + price / 900000);
  addExp(Math.round(pts / 5));
  sfx.trade('deal');
  toast(`Repaired ${gun.tpl.short}: ${fmt2(r.dura)} / ${fmt2(r.maxDura)}${r.loss ? ` (max -${fmt2(r.loss)})` : ''}`, 'ok');
  // the mended gun goes home; the bench is for the next one
  repairPts = null;
  if (!autoPlace(gun, [game.stash])) toast('Stash is full — the gun stays on the bench', 'warn');
  renderTrade();
  refreshTopbar();
  emit(EV.INVENTORY_CHANGED);
  saveSoon();
}

// ---------------------------------------------------------
// docked stash
// ---------------------------------------------------------
function renderDockedStash(t) {
  const host = $('#trade-stash-host');
  if (!host) return;
  let gridEl;
  keepScroll([host], () => {
    host.replaceChildren();
    gridEl = renderGrid(game.stash);
    host.append(gridEl);
  });
  markOpenable(host);

  const note = $('#trade-stash-note');
  if (mode === 'sell') {
    // grey out what this trader will not take, the way the game does
    for (const node of gridEl.querySelectorAll('.item')) {
      if (node._item && !sellableTo(t, node._item)) node.classList.add('is-nosell');
    }
    if (note) note.textContent = 'greyed items: not bought here';
  } else if (mode === 'repair') {
    for (const node of gridEl.querySelectorAll('.item')) {
      const it = node._item;
      if (it && !(isRepairable(it) && repairNeeded(it) > 0)) node.classList.add('is-nosell');
    }
    if (note) note.textContent = 'greyed items: nothing to repair';
  } else if (note) {
    note.textContent = '';
  }
}

// ---------------------------------------------------------
let fenceStock = null;
function randomFenceStock() {
  const t = TRADER_BY_ID.fence;
  if (fenceStock) return fenceStock;
  const pool = Object.values(TPL).filter((x) =>
    !['money', 'secure'].includes(x.cat) && x.price > 3000 && x.price < 260000);
  fenceStock = [];
  const used = new Set();
  for (let i = 0; i < (t.randomAssort || 12) && pool.length; i++) {
    const pick = pool[Math.floor(Math.random() * pool.length)];
    if (used.has(pick.key)) continue;
    used.add(pick.key);
    fenceStock.push({ key: pick.key, ll: 1, stock: 1 + Math.floor(Math.random() * 3), base: 3 });
  }
  return fenceStock;
}

/** traders restock between raids: stock counts reset and Fence rotates */
export function restockTraders() {
  fenceStock = null;
  // Fence's assortment is rebuilt from scratch, so an offer staged before the
  // raid now points at a listing that no longer exists on any shelf
  clearStaged();
  for (const t of TRADERS) {
    for (const off of t.assort) if (off.base != null) off.stock = off.base;
  }
}
export function rerollFence() { restockTraders(); }
export function activeTraderId() { return activeId; }

/** headless capture hooks: ?dev=trade-sell / ?dev=trade-dialog */
export function devTrade(kind) {
  const t = TRADER_BY_ID[activeId];
  if (kind === 'sell') {
    mode = 'sell';
    // draw once so the table has been cut to the column before anything is
    // put on it — the same order a real SELL click goes through
    renderTrade();
    for (const it of game.stash.items()) {
      if (tradeTable.count >= 3) break;
      if (sellableTo(t, it)) autoPlace(it, [tradeTable]);
    }
    renderTrade();
  } else if (kind === 'dialog') {
    // stage one offer, twice, so the capture shows a populated deal panel
    mode = 'buy';
    clearStaged();
    const o = t.assort.find((x) => x.ll <= loyaltyLevel(t) && x.stock > 1);
    if (o) { stageOffer(t, o); stageOffer(t, o); }
    renderTrade();
  } else if (kind === 'repair') {
    // a worn AK on Prapor's bench, half repaired
    activeId = 'prapor';
    mode = 'repair';
    renderTrade();
    const gun = game.stash.items().find((it) => isRepairable(it));
    if (gun) { gun.dura = Math.min(gun.dura, 41); autoPlace(gun, [tradeTable]); repairPts = 30; }
    renderTrade();
  }
}
