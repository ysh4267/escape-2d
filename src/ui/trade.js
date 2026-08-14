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
//  - the stash stays docked on the right the whole time
//
// The wording is the game's own, read out of tools/cache/en.json: "DEAL!"
// keeps its exclamation mark, "Fill items" is the Autofill key, and the
// blocked states say "No selected items" / "Not enough money" /
// "Not enough space in stash" / "Bad user loyalty level" verbatim. Neither
// side pops a confirmation modal - staging is the confirmation.
// =========================================================

import { $, $$, el, icon, fmtNum, clamp } from '../core/util.js';
import { TRADERS, TRADER_BY_ID, loyaltyFor, canBuyFrom, sellValue, buyPrice, buyCurrency, LOYALTY_LEVELS } from '../data/traders.js';
import { TPL, FX } from '../data/items.js';
import { game, countMoney, addMoney, canAddMoney, takeMoney, traderState, saveSoon, addExp, registerSaveSection } from '../core/state.js';
import { Item, Grid, autoPlace, detach } from '../inventory/model.js';
import { renderGrid } from '../inventory/view.js';
import { isKnown } from '../inventory/examine.js';
import { dndContext, quickTransfer } from '../inventory/dnd.js';
import { setContextProvider, inspectDialog } from '../inventory/dialogs.js';
import { openContainerWindow, refreshContainerWindows } from '../inventory/window.js';
import { buildMenu, markOpenable } from './stash.js';
import { sfx } from '../core/audio.js';
import { on, emit, EV } from '../core/events.js';
import { toast, refreshTopbar } from './shell.js';

let activeId = 'prapor';
let mode = 'buy';

const CUR_SYM = { RUB: '₽', USD: '$', EUR: '€' };
const ROMAN = ['I', 'II', 'III', 'IV'];
const FENCE_REFRESH_COST = 5000;

/** the sell zone: items dragged here are what the DEAL button will sell */
export const tradeTable = new Grid(9, 6, { tag: 'tradeTable', label: 'TRADING TABLE' });
tradeTable.mayAccept = (item) => sellableTo(TRADER_BY_ID[activeId], item);

/**
 * The buy-side trading table. Picking an offer stages it here; nothing is
 * bought until DEAL!. Several offers can sit on the table and commit in one
 * transaction, which is how the real screen works - the previous flow went
 * straight from a double-click to a completed purchase and skipped all of it.
 *
 * Entries are { off, tpl, qty }.
 */
let basket = [];
/**
 * Whether the payment has been allocated. The game makes you put the money
 * on the table too - by hand, or with the "Fill items" button - and DEAL!
 * stays inert until the requirement slot is covered.
 */
let filled = false;

function clearBasket() {
  basket = [];
  filled = false;
}

const basketTotal = (t) =>
  basket.reduce((sum, e) => sum + buyPrice(t, e.tpl, FX, e.off) * e.qty, 0);

/** every offer on the table has to be paid in the same currency to total up */
const basketCurrency = (t) =>
  (basket.length ? buyCurrency(t, basket[0].tpl, basket[0].off) : t.currency);

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
      clearBasket();
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
}

// if the page dies between the debounced saves (crash, hard reload), whatever
// sat on the trading table is serialised too, and lands back in the stash on
// the next boot; anything the stash cannot take simply stays on the table
registerSaveSection('tradeTable', {
  dump: () => (tradeTable.count ? tradeTable.toJSON() : null),
  restore: (v) => {
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
    if (mode === 'sell') {
      return onTable(item) ? [game.stash] : [tradeTable];
    }
    return [game.stash];
  };
  dndContext.equipSlotFor = () => null;
  dndContext.requestSplit = null;
  dndContext.canMove = (item) => !item.virtual;
  dndContext.onActivate = (item) => {
    if (item.virtual) { stageOffer(TRADER_BY_ID[activeId], item.offer); return; }
    if (item.isContainer && !onTable(item)) { openContainerWindow(item); return; }
    quickTransfer(item);
  };
  dndContext.onChange = () => { renderTrade(); emit(EV.INVENTORY_CHANGED); saveSoon(); };

  setContextProvider((item) => {
    const t = TRADER_BY_ID[activeId];
    if (item.virtual) {
      const off = item.offer;
      const locked = off.ll > loyaltyLevel(t);
      return [
        {
          label: `BUY — ${fmtNum(buyPrice(t, item.tpl, FX, off))}${CUR_SYM[buyCurrency(t, item.tpl, off)]}`,
          icon: 'cart', disabled: locked || off.stock <= 0,
          run: () => stageOffer(t, off),
        },
        { label: 'INSPECT', icon: 'info', run: () => inspectDialog(item) },
      ];
    }
    const extra = [];
    if (mode === 'sell') {
      if (onTable(item)) {
        extra.push({
          label: 'REMOVE FROM TABLE', icon: 'back',
          run: () => {
            if (!autoPlace(item, [game.stash])) toast('No room in the stash', 'warn');
            dndContext.onChange();
          },
        });
      } else if (sellableTo(t, item)) {
        extra.push({
          label: `PLACE ON TABLE — ${fmtNum(sellValue(t, item, FX))}${CUR_SYM[t.currency]}`,
          icon: 'sell',
          run: () => {
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
    }
    return buildMenu(item, 'trade', extra);
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

  for (const seg of $$('#pane-traders .seg')) {
    seg.classList.toggle('is-active', seg.dataset.mode === mode);
  }

  const content = $('#trader-content');
  content.replaceChildren();
  if (mode === 'buy') renderBuy(t, content);
  else renderSell(t, content);

  renderDockedStash(t);
  refreshContainerWindows();
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
          clearBasket();
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
function renderBuy(t, host) {
  const ll = loyaltyLevel(t);
  const offers = t.assort.length ? t.assort : randomFenceStock();

  const wrap = el('div', { class: 'assort-wrap' });

  if (t.id === 'fence') {
    const btn = el('button', {
      class: 'btn btn--sm', disabled: countMoney('RUB') < FENCE_REFRESH_COST,
      onclick: () => {
        if (!takeMoney(FENCE_REFRESH_COST, 'RUB')) return;
        fenceStock = null;
        toast('Fence found new stock', 'ok');
        renderTrade(); refreshTopbar(); saveSoon();
      },
    }, icon('rotate'), `UPDATE ASSORTMENT — ${fmtNum(FENCE_REFRESH_COST)}₽`);
    wrap.append(el('div', { class: 'assort-tools' }, btn));
  }

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
  const cells = entries.reduce((n, e) => n + e.tpl.w * e.tpl.h, 0);
  const shelf = new Grid(COLS, cells + 8, { tag: 'assort' });
  // display only: the player must never be able to drop real items in here
  shelf.mayAccept = (it) => !!it.virtual;

  const placed = [];
  for (const e of entries) {
    const disp = new Item(e.off.key, { examined: true });
    disp.virtual = true;
    disp.offer = e.off;
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

    tile.append(el('div', { class: 'toffer__price' },
      `${fmtNum(buyPrice(t, tpl, FX, off))} ${CUR_SYM[buyCurrency(t, tpl, off)]}`));

    if (off.base != null && off.base < 1000) {
      tile.append(el('div', { class: `toffer__stock${out ? ' is-out' : ''}` },
        `${off.stock}/${off.base}`));
    }
    if (locked) {
      tile.classList.add('toffer--locked');
      tile.append(el('div', { class: 'toffer__lock' },
        icon('lock', 'ico'), el('span', {}, ROMAN[off.ll - 1] || String(off.ll))));
    } else if (out) {
      tile.classList.add('toffer--out');
      tile.append(el('div', { class: 'toffer__out' }, 'OUT OF STOCK'));
    } else {
      // clicking an offer puts it on the trading table; it does not buy it
      tile.classList.add('toffer--buyable');
      tile.title = 'Click to put on the trading table';
      tile.addEventListener('click', (ev) => {
        // a drag that ends on the tile must not also count as a pick
        if (ev.detail === 0) return;
        stageOffer(t, off);
      });
      if (basket.some((e) => e.off === off)) tile.classList.add('toffer--staged');
    }
  }

  const scroll = el('div', { class: 'assort-scroll' });
  scroll.append(gridEl);
  wrap.append(scroll);
  host.append(wrap);
  renderBuyTable(t, host);
}

/**
 * Put an offer on the trading table. This is the step the screen was missing:
 * picking something from the shelf stages it, it does not buy it.
 */
function stageOffer(t, off) {
  const tpl = TPL[off.key];
  if (!tpl) return;
  if (off.ll > loyaltyLevel(t)) { toast('Bad user loyalty level', 'warn'); sfx.ui('error'); return; }
  if (off.stock <= 0) { toast('Item is out of stock', 'warn'); sfx.ui('error'); return; }

  // one currency per table, or the total is meaningless
  const cur = buyCurrency(t, tpl, off);
  if (basket.length && cur !== basketCurrency(t)) {
    toast('Finish this deal before mixing currencies', 'warn');
    sfx.ui('error');
    return;
  }

  const entry = basket.find((e) => e.off === off);
  if (entry) {
    if (entry.qty >= off.stock) { toast('Item is out of stock', 'warn'); sfx.ui('error'); return; }
    entry.qty++;
  } else {
    basket.push({ off, tpl, qty: 1 });
  }
  // the money has to be allocated again once the price moves
  filled = false;
  sfx.trade('click');
  renderTrade();
}

/** why DEAL! cannot be pressed yet, in the game's own words */
function dealBlocker(t) {
  if (!basket.length) return 'No selected items';
  const cur = basketCurrency(t);
  const total = basketTotal(t);
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
  const cur = basketCurrency(t);
  const total = basketTotal(t);
  const wrap = el('div', { class: 'deal-wrap' });

  const head = el('div', { class: 'deal-head' }, el('span', {}, 'Item to purchase'));
  if (basket.length) {
    head.append(el('button', {
      class: 'btn btn--sm', onclick: () => { clearBasket(); sfx.trade('click'); renderTrade(); },
    }, 'CLEAR'));
  }
  wrap.append(head);

  const rows = el('div', { class: 'deal-rows' });
  if (!basket.length) {
    rows.append(el('div', { class: 'deal-empty' }, 'No selected items',
      el('small', {}, 'click an offer on the shelf to put it on the table')));
  }
  for (const e of basket) {
    const unit = buyPrice(t, e.tpl, FX, e.off);
    const cap = Math.min(e.off.stock, 999);

    const art = el('div', { class: 'deal-row__art' });
    if (e.tpl.imgUrl) art.append(el('img', { src: e.tpl.imgUrl, alt: '' }));
    else art.append(el('div', { class: 'item__fallback' }, e.tpl.short));

    const qtyEl = el('input', {
      class: 'deal-row__qty', type: 'number', min: '1', max: String(cap), value: String(e.qty),
    });
    qtyEl.addEventListener('change', () => {
      e.qty = clamp(Math.round(Number(qtyEl.value) || 1), 1, cap);
      filled = false;
      renderTrade();
    });

    const step = (d) => () => {
      const next = clamp(e.qty + d, 0, cap);
      if (next <= 0) basket = basket.filter((x) => x !== e);
      else e.qty = next;
      filled = false;
      sfx.trade('click');
      renderTrade();
    };

    rows.append(el('div', { class: 'deal-row' }, art,
      el('div', { class: 'deal-row__info' },
        el('div', { class: 'deal-row__name' }, e.tpl.name),
        el('div', { class: 'deal-row__meta' },
          `${fmtNum(unit)} ${CUR_SYM[cur]} each · ${e.off.stock >= 1000 ? 'plenty' : e.off.stock} in stock`)),
      el('div', { class: 'deal-row__qtybox' },
        el('button', { class: 'btn btn--sm', onclick: step(-1) }, '−'),
        qtyEl,
        el('button', { class: 'btn btn--sm', onclick: step(1) }, '+'),
        el('button', {
          class: 'btn btn--sm',
          onclick: () => { e.qty = cap; filled = false; sfx.trade('click'); renderTrade(); },
        }, 'ALL')),
      el('b', { class: 'deal-row__sum' }, `${fmtNum(unit * e.qty)} ${CUR_SYM[cur]}`)));
  }
  wrap.append(rows);

  // the requirement slot: empty until the money is allocated
  const funds = countMoney(cur);
  const short = total > funds;
  const slot = el('div', { class: `deal-slot${filled ? ' is-filled' : ''}${short ? ' is-short' : ''}` },
    el('span', { class: 'muted' }, 'REQUIRED'),
    el('b', {}, basket.length ? `${fmtNum(total)} ${CUR_SYM[cur]}` : '—'),
    el('span', { class: 'deal-slot__state' },
      !basket.length ? '' : short ? 'Not enough money' : filled ? 'PAID IN' : 'NOT ALLOCATED'));

  const fillBtn = el('button', {
    class: 'btn', disabled: !basket.length || short || filled,
    title: 'Select to auto-fill requirements',
    onclick: () => { filled = true; sfx.trade('buy'); renderTrade(); },
  }, 'Fill items');

  const blocker = dealBlocker(t);
  const dealBtn = el('button', {
    class: 'btn btn--primary btn--deal', disabled: !!blocker, dataset: { sfx: 'own' },
  }, 'DEAL!');
  dealBtn.addEventListener('click', () => doBuyBasket(t));

  wrap.append(
    el('div', { class: 'deal-total' },
      el('span', { class: 'muted' }, 'TOTAL SUM TO PAY:'),
      el('b', { class: short ? 'is-broke' : '' }, `${fmtNum(total)} ${CUR_SYM[cur]}`)),
    slot,
    el('div', { class: 'deal-foot' }, fillBtn, dealBtn));
  if (blocker) wrap.append(el('div', { class: 'deal-warn' }, blocker));

  host.append(wrap);
}

/** commit every offer on the table as one transaction, the way DEAL! does */
function doBuyBasket(t) {
  if (dealBlocker(t)) { sfx.ui('error'); return; }
  const cur = basketCurrency(t);
  const total = basketTotal(t);
  if (countMoney(cur) < total) { toast('Not enough money', 'bad'); sfx.ui('error'); return; }

  // reserve space for everything first: a partial commit would take the money
  // for items that then have nowhere to go
  const made = [];
  let bought = 0;
  for (const e of basket) {
    const count = Math.min(e.qty, e.off.stock);
    for (let i = 0; i < count;) {
      const stackSize = e.tpl.stack > 1 ? Math.min(e.tpl.stack, count - i) : 1;
      const it = new Item(e.tpl.key, { stack: stackSize, examined: true });
      // merging is off: it tops up stacks already in the stash, and that
      // cannot be rolled back by detaching the purchased item
      if (!autoPlace(it, [game.stash], { merge: false })) {
        for (const m of made) detach(m);
        toast('Not enough space in stash', 'warn');
        sfx.ui('error');
        return;
      }
      made.push(it);
      i += stackSize;
    }
    bought += count;
  }
  if (!bought) { toast('Item is out of stock', 'warn'); return; }

  takeMoney(total, cur);
  const st = traderState(t.id);
  for (const e of basket) e.off.stock -= Math.min(e.qty, e.off.stock);
  st.spent += total * (FX[cur] || 1);
  st.rep = Math.min(10, st.rep + (total * (FX[cur] || 1)) / 900000);
  addExp(Math.round(bought * 2));

  const lines = basket.length;
  clearBasket();
  sfx.trade('deal');
  toast(`Bought ${bought} item${bought > 1 ? 's' : ''} across ${lines} offer${lines > 1 ? 's' : ''}`, 'ok');
  renderTrade();
  refreshTopbar();
  emit(EV.INVENTORY_CHANGED);
  saveSoon();
}

// ---------------------------------------------------------
// SELL
// ---------------------------------------------------------
function renderSell(t, host) {
  const wrap = el('div', { class: 'table-wrap' });

  const head = el('div', { class: 'table-head' },
    el('span', {}, 'TO SELL'),
    el('span', { class: 'table-head__hint' },
      t.buysAll ? `${t.name} buys everything` : `${t.name} buys: ${t.buys.join(', ')}`));
  if (tradeTable.count) {
    head.append(el('button', {
      class: 'btn btn--sm',
      onclick: () => { returnTableItems(); sfx.trade('click'); dndContext.onChange(); },
    }, 'CLEAR'));
  }
  wrap.append(head);

  const zone = el('div', { class: 'table-zone' });
  const gridEl = renderGrid(tradeTable);
  gridEl.classList.add('table-grid');
  zone.append(gridEl);
  if (!tradeTable.count) {
    zone.append(el('div', { class: 'table-empty' },
      'DRAG ITEMS HERE', el('small', {}, 'or right-click an item in the stash')));
  }
  wrap.append(zone);

  // what the trader pays for each staged item, on the item itself, so a bad
  // line is obvious before the deal rather than buried in the lump total
  let total = 0;
  for (const it of tradeTable.items()) {
    const value = sellValue(t, it, FX);
    total += value;
    const tile = gridEl.querySelector(`.item[data-uid="${it.uid}"]`);
    if (tile) tile.append(el('div', { class: 'toffer__price' }, `${fmtNum(value)} ${CUR_SYM[t.currency]}`));
  }

  const dealBtn = el('button', {
    class: 'btn btn--primary btn--deal', disabled: !tradeTable.count, dataset: { sfx: 'own' },
  }, 'DEAL!');
  dealBtn.addEventListener('click', () => doSell(t));
  wrap.append(el('div', { class: 'table-foot' },
    el('div', { class: 'table-foot__total' },
      el('span', { class: 'muted' }, `${tradeTable.count} ITEM${tradeTable.count === 1 ? '' : 'S'} · TOTAL`),
      el('b', {}, `${fmtNum(total)} ${CUR_SYM[t.currency]}`)),
    dealBtn));
  if (!tradeTable.count) wrap.append(el('div', { class: 'deal-warn' }, 'No selected items'));

  host.append(wrap);
}

function doSell(t) {
  const items = tradeTable.items();
  if (!items.length) return;
  sfx.trade('deal');
  let total = 0;
  for (const it of items) total += sellValue(t, it, FX);
  // the sold items sit on the table, not in the stash, so destroying them
  // frees no stash space — check the payout fits BEFORE anything is destroyed
  if (!canAddMoney(total, t.currency)) {
    toast('No room in the stash for the payout', 'warn');
    return;
  }
  addMoney(total, t.currency);
  for (const it of items) detach(it);
  const st = traderState(t.id);
  const rub = total * (FX[t.currency] || 1);
  st.rep = Math.min(10, st.rep + rub / 1400000);
  addExp(Math.round(items.length * 3));
  toast(`Sold ${items.length} item${items.length > 1 ? 's' : ''} — ${fmtNum(total)}${CUR_SYM[t.currency]}`, 'ok');
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
  host.replaceChildren();
  const gridEl = renderGrid(game.stash);
  host.append(gridEl);
  markOpenable(host);

  const note = $('#trade-stash-note');
  if (mode === 'sell') {
    // grey out what this trader will not take, the way the game does
    for (const node of gridEl.querySelectorAll('.item')) {
      if (node._item && !sellableTo(t, node._item)) node.classList.add('is-nosell');
    }
    if (note) note.textContent = 'greyed items: not bought here';
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
    for (const it of game.stash.items()) {
      if (tradeTable.count >= 3) break;
      if (sellableTo(t, it)) autoPlace(it, [tradeTable]);
    }
    renderTrade();
  } else if (kind === 'dialog') {
    // stage a couple of offers so the capture shows a populated deal panel
    mode = 'buy';
    clearBasket();
    for (const o of t.assort) {
      if (basket.length >= 2) break;
      if (o.ll <= loyaltyLevel(t) && o.stock > 0) stageOffer(t, o);
    }
    renderTrade();
  }
}
