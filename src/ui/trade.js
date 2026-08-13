// =========================================================
// trader screen: buy from an assortment, sell from the stash
// =========================================================

import { $, $$, el, icon, fmtNum, clamp } from '../core/util.js';
import { TRADERS, TRADER_BY_ID, loyaltyFor, canBuyFrom, sellValue, buyPrice, LOYALTY_LEVELS } from '../data/traders.js';
import { TPL, FX, CURRENCY_KEY } from '../data/items.js';
import { game, countMoney, addMoney, takeMoney, traderState, saveSoon, addExp } from '../core/state.js';
import { Item, autoPlace, detach } from '../inventory/model.js';
import { renderGrid } from '../inventory/view.js';
import { dndContext } from '../inventory/dnd.js';
import { setContextProvider } from '../inventory/dialogs.js';
import { openContainerWindow, refreshContainerWindows } from '../inventory/window.js';
import { buildMenu } from './stash.js';
import { emit, EV } from '../core/events.js';
import { toast, refreshTopbar } from './shell.js';
import { sfx } from '../core/audio.js';

let activeId = 'prapor';
let mode = 'buy';
/** buy cart: [{ key, qty }] ; sell cart: [{ item }] */
let cart = [];

const CUR_SYM = { RUB: '₽', USD: '$', EUR: '€' };

export function initTrade() {
  // remember the starting stock so restocks can restore it
  for (const t of TRADERS) for (const off of t.assort) off.base = off.stock;

  for (const seg of $$('#pane-traders .seg')) {
    seg.addEventListener('click', () => {
      mode = seg.dataset.mode;
      cart = [];
      renderTrade();
    });
  }
  renderTrade();
}

export function activateTradeContext() {
  dndContext.quickTargets = () => [game.stash];
  dndContext.equipSlotFor = () => null;
  dndContext.requestSplit = null;
  dndContext.onActivate = (item) => { if (item.isContainer) openContainerWindow(item); };
  dndContext.onChange = () => { renderTrade(); emit(EV.INVENTORY_CHANGED); saveSoon(); };
  setContextProvider((item) => {
    const t = TRADER_BY_ID[activeId];
    const extra = [];
    if (mode === 'sell' && canBuyFrom(t, item)) {
      extra.push({
        label: `SELL — ${fmtNum(sellValue(t, item, FX))}${CUR_SYM[t.currency]}`,
        icon: 'sell',
        run: () => { addToSellCart(item); },
      });
    }
    return buildMenu(item, 'trade', extra);
  });
}

export function renderTrade() {
  const rail = $('#trader-rail');
  const head = $('#trader-head');
  const content = $('#trader-content');
  if (!rail) return;

  // rail
  rail.replaceChildren();
  for (const t of TRADERS) {
    const st = traderState(t.id);
    const ll = loyaltyFor(game.profile.level, st.rep);
    const chip = el('button', {
      class: `trader-chip${t.id === activeId ? ' is-active' : ''}`,
      onclick: () => { activeId = t.id; cart = []; renderTrade(); },
    });
    const pic = el('div', { class: 'trader-chip__pic' });
    pic.append(el('img', { src: `assets/traders/${t.id}.png`, alt: '', loading: 'lazy' }));
    chip.append(pic, el('div', { class: 'trader-chip__n' },
      el('div', { class: 'trader-chip__name' }, t.name),
      el('div', { class: 'trader-chip__lvl' }, `LL${ll} · pays ${Math.round(t.buyMult * 100)}%`)));
    rail.append(chip);
  }

  const t = TRADER_BY_ID[activeId];
  const st = traderState(t.id);
  const ll = loyaltyFor(game.profile.level, st.rep);
  const nextLl = LOYALTY_LEVELS.find((l) => l.level === ll + 1);

  // head
  head.replaceChildren();
  const hp = el('div', { class: 'trader-head__pic' });
  hp.append(el('img', { src: `assets/traders/${t.id}.png`, alt: '' }));
  head.append(hp,
    el('div', {},
      el('div', { class: 'trader-head__name' }, t.name),
      el('div', { class: 'trader-head__tag' }, t.tag)),
    el('div', { class: 'trader-head__rep' },
      el('div', { class: 'trader-chip__lvl' },
        nextLl
          ? `LL${ll} → LL${ll + 1} at PMC ${nextLl.pmc} / rep ${nextLl.rep.toFixed(2)}`
          : `LL${ll} — maximum`),
      el('div', { class: 'rep-bar' },
        el('i', { style: { width: `${clamp((st.rep / (nextLl?.rep || st.rep || 1)) * 100, 4, 100)}%` } })),
      el('div', { class: 'trader-chip__lvl' }, `reputation ${st.rep.toFixed(2)} · currency ${t.currency}`)));

  content.replaceChildren();
  if (mode === 'buy') renderBuy(t, ll, content);
  else renderSell(t, content);

  for (const node of content.querySelectorAll('.item')) {
    if (node._item?.isContainer) node.classList.add('item--openable');
  }
  refreshContainerWindows();
}

// ---------------------------------------------------------
function renderBuy(t, ll, host) {
  const assort = el('div', { class: 'assort' });
  const offers = t.assort.length ? t.assort : randomFenceStock();

  if (!offers.length) {
    assort.append(el('div', { class: 'empty-note' }, 'NOTHING IN STOCK'));
  }

  for (const off of offers) {
    const tpl = TPL[off.key];
    if (!tpl) continue;
    const locked = off.ll > ll;
    const price = buyPrice(t, tpl, FX);
    const node = el('div', { class: `offer${locked ? ' is-locked' : ''}` });

    const art = el('div', { class: 'offer__art' });
    if (tpl.imgUrl) art.append(el('img', { src: tpl.imgUrl, alt: '', loading: 'lazy' }));
    else art.append(el('div', { class: 'item__fallback' }, tpl.short));
    node.append(art);

    const info = el('div', { class: 'offer__n' },
      el('div', { class: 'offer__name' }, tpl.name),
      el('div', { class: 'offer__meta' }, `${tpl.w}x${tpl.h} · ${tpl.weight} kg`));
    info.append(el('div', { class: 'offer__price' }, `${fmtNum(price)}`,
      el('small', {}, CUR_SYM[t.currency])));

    if (locked) {
      info.append(el('div', { class: 'offer__lock' }, icon('warn', 'ico ico--sm'), `LOYALTY LEVEL ${off.ll}`));
    } else {
      // stepper buttons so buying never needs the keyboard
      const qty = el('input', { class: 'offer__qty', type: 'number', min: '1', value: '1' });
      const step = (d) => {
        const cap = off.stock >= 1000 ? 999 : off.stock;
        qty.value = String(clamp((Number(qty.value) || 1) + d, 1, Math.max(1, cap)));
        sfx.click();
      };
      const minus = el('button', { class: 'offer__step', onclick: () => step(-1) }, '−');
      const plus = el('button', { class: 'offer__step', onclick: () => step(1) }, '+');
      const buy = el('button', { class: 'btn btn--sm' }, 'BUY');
      buy.addEventListener('click', () => doBuy(t, off, tpl, Math.max(1, Number(qty.value) || 1)));
      info.append(el('div', { class: 'offer__buy' }, minus, qty, plus, buy,
        el('span', { class: 'offer__stock' }, off.stock >= 1000 ? '' : `x${off.stock}`)));
    }
    node.append(info);
    assort.append(node);
  }

  host.append(assort);
  host.append(walletPanel(t));
}

function walletPanel(t) {
  const deal = el('div', { class: 'deal' });
  deal.append(el('div', { class: 'deal__head' }, icon('cash'), 'BALANCE'));
  const list = el('div', { class: 'deal__list' });
  for (const cur of ['RUB', 'USD', 'EUR']) {
    list.append(el('div', { class: 'deal-row' },
      el('div', { class: 'deal-row__n' }, cur),
      el('div', { class: 'deal-row__p' }, `${fmtNum(countMoney(cur))}${CUR_SYM[cur]}`)));
  }
  deal.append(list);
  deal.append(el('div', { class: 'deal__foot' },
    el('div', { class: 'trader-chip__lvl' },
      `${t.name} trades in ${t.currency}. Roubles convert at ${FX.USD}/$ and ${FX.EUR}/€.`)));
  return deal;
}

function doBuy(t, off, tpl, qty) {
  const unit = buyPrice(t, tpl, FX);
  const count = Math.min(qty, off.stock);
  if (count <= 0) { sfx.deny(); toast('Out of stock', 'warn'); return; }
  const total = unit * count;

  if (countMoney(t.currency) < total) { sfx.deny(); toast(`Not enough ${t.currency}`, 'bad'); return; }

  // reserve space first so we never take money for items that will not fit
  const made = [];
  for (let i = 0; i < count;) {
    const stackSize = tpl.stack > 1 ? Math.min(tpl.stack, count - i) : 1;
    const it = new Item(tpl.key, { stack: stackSize, examined: true });
    if (!autoPlace(it, [game.stash])) {
      for (const m of made) detach(m);
      toast('No room in the stash', 'warn');
      return;
    }
    made.push(it);
    i += stackSize;
  }

  takeMoney(total, t.currency);
  off.stock -= count;
  const st = traderState(t.id);
  st.spent += total * (FX[t.currency] || 1);
  st.rep = Math.min(10, st.rep + (total * (FX[t.currency] || 1)) / 900000);
  addExp(Math.round(count * 2));

  sfx.money();
  toast(`Bought ${count}x ${tpl.name}`, 'ok');
  renderTrade();
  refreshTopbar();
  emit(EV.INVENTORY_CHANGED);
  saveSoon();
}

// ---------------------------------------------------------
function renderSell(t, host) {
  const shell = el('div', { class: 'sell-shell' });

  const stashPanel = el('div', { class: 'sell-stash' },
    el('div', { class: 'sell-stash__head' }, 'STASH — right-click an item to sell'),
    el('div', { class: 'sell-hint' },
      `${t.name} buys: ${t.buysAll ? 'everything' : t.buys.join(', ')}`));
  const body = el('div', { class: 'sell-stash__body' });
  body.append(renderGrid(game.stash));
  stashPanel.append(body);
  shell.append(stashPanel);

  const deal = el('div', { class: 'deal' });
  deal.append(el('div', { class: 'deal__head' }, icon('cart'), 'SELL ORDER'));
  const list = el('div', { class: 'deal__list' });
  let total = 0;
  if (!cart.length) list.append(el('div', { class: 'empty-note' }, 'NOTHING SELECTED'));
  for (const entry of cart) {
    const it = entry.item;
    const v = sellValue(t, it, FX);
    total += v;
    const artBox = el('div', { class: 'deal-row__art' });
    if (it.tpl.imgUrl) artBox.append(el('img', { src: it.tpl.imgUrl, alt: '' }));
    list.append(el('div', { class: 'deal-row' },
      artBox,
      el('div', { class: 'deal-row__n' }, it.tpl.name,
        el('small', {}, it.stack > 1 ? `x${fmtNum(it.stack)}` : (it.fir ? 'found in raid' : ''))),
      el('div', { class: 'deal-row__p' }, `${fmtNum(v)}${CUR_SYM[t.currency]}`),
      el('button', { class: 'deal-row__x', onclick: () => { cart = cart.filter((c) => c !== entry); renderTrade(); } },
        icon('close', 'ico ico--sm'))));
  }
  deal.append(list);

  const sellBtn = el('button', { class: 'btn btn--primary', disabled: !cart.length },
    icon('sell'), 'SELL ALL');
  sellBtn.addEventListener('click', () => doSell(t, total));
  deal.append(el('div', { class: 'deal__foot' },
    el('div', { class: 'deal__total' },
      el('span', { class: 'muted' }, 'TOTAL'),
      el('b', {}, `${fmtNum(total)}${CUR_SYM[t.currency]}`)),
    sellBtn));

  shell.append(deal);
  host.append(shell);
}

function addToSellCart(item) {
  const t = TRADER_BY_ID[activeId];
  if (!canBuyFrom(t, item)) { sfx.deny(); toast(`${t.name} does not buy that`, 'warn'); return; }
  if (item.tpl.cat === 'money') { sfx.deny(); toast('Cannot sell currency', 'warn'); return; }
  if (cart.some((c) => c.item === item)) return;
  cart.push({ item });
  sfx.click();
  renderTrade();
}

function doSell(t, total) {
  if (!cart.length) return;
  const items = cart.map((c) => c.item);
  for (const it of items) detach(it);
  cart = [];
  if (!addMoney(total, t.currency)) {
    toast('No room for the payout', 'bad');
  }
  const st = traderState(t.id);
  const rub = total * (FX[t.currency] || 1);
  st.rep = Math.min(10, st.rep + rub / 1400000);
  addExp(Math.round(items.length * 3));
  sfx.money();
  toast(`Sold ${items.length} item${items.length > 1 ? 's' : ''}`, 'ok');
  renderTrade();
  refreshTopbar();
  emit(EV.INVENTORY_CHANGED);
  saveSoon();
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
    fenceStock.push({ key: pick.key, ll: 1, stock: 1 + Math.floor(Math.random() * 3) });
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
