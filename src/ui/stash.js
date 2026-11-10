// =========================================================
// GEAR: the character's kit and the stash
//
// The client's Items Panel, laid out off its hierarchy and a 1080p capture:
//
//   left   one dark sheet (12,48 - 1225,950). On it the slots around the
//          figure, each a box under its named header; beside them what is
//          carried - rig, pockets and special slots, backpack, pouch - each
//          with its grids to the right, scrolling as one column; along the
//          bottom the weight carried and the body's health, water and energy
//   right  the stash: SEARCH over it and the money counted at the right, the
//          strip of item kinds down its left edge with sorting under them,
//          and the grid itself, ten cells wide
//   under  QUICK USE: what the number keys reach for
//
// src/inventory/equipment.js draws the slots and the carried containers;
// this module puts the screen together and owns the stash side of it.
// =========================================================

import { $, el, fmtNum, keepScroll } from '../core/util.js';
import { game, saveSoon, countMoney } from '../core/state.js';
import { renderGrid, renderSlotItem } from '../inventory/view.js';
import { renderDoll, renderContainers } from '../inventory/equipment.js';
import { openContainerWindow, refreshContainerWindows, onWindowChange } from '../inventory/window.js';
import { dndContext, quickTransfer } from '../inventory/dnd.js';
import { setContextProvider, splitDialog, inspectDialog, confirmDialog, openContext, destroyPrompt } from '../inventory/dialogs.js';
import { startExamine, examining, needsExamine, isKnown } from '../inventory/examine.js';
import { paintExamine } from '../inventory/view.js';
import { detach, moveToSlot } from '../inventory/model.js';
import { openModdingWindow, moddingContext } from '../inventory/modding.js';
import { loadAmmoDialog } from '../inventory/ammo-dialogs.js';
import {
  unloadAmmo, toggleFold, canFold, magazineOf, unpackAmmoBox, installMod, uninstallMod, stripWeapon, canDetachPart,
  compatibleParts,
} from '../inventory/weapon.js';
import { repairKitDialog, kitTargetDialog } from '../inventory/repair-dialogs.js';
import { isRepairable, repairNeeded, repairKitsIn, isRepairKit } from '../inventory/repair.js';
import { on, emit, EV } from '../core/events.js';
import { sfx } from '../core/audio.js';
import { t, tOr } from '../core/i18n.js';
import { uiImg, uiIcon, loadUiGroup, hasUi } from '../core/uiart.js';
import { getTpl } from '../data/items.js';
import { DB } from '../game/db.js';
import * as Wishlist from '../game/wishlist.js';
import { strengthCarry } from '../game/skills.js';
import { G as BODY, FX } from '../raid/health.js';
import { toast, currentScreen } from './shell.js';
import { useInHideout, rates as healthRates } from './health-ui.js';

/**
 * The strip down the stash's left edge, in the client's order with its
 * glyphs. A kind is the categories of this build's item table it covers;
 * RAID is not a kind of item but a mark on one.
 */
export const KINDS = [
  { key: 'all', ico: 'icon_itemtype_all' },
  { key: 'weapons', ico: 'icon_itemtype_weapon', cats: ['weapon', 'pistol'] },
  { key: 'mags', ico: 'icon_itemtype_mags', cats: ['mag'] },
  { key: 'ammo', ico: 'icon_itemtype_ammo', cats: ['ammo', 'ammobox'] },
  { key: 'meds', ico: 'icon_itemtype_meds', cats: ['meds'] },
  { key: 'food', ico: 'icon_itemtype_food', cats: ['food', 'drink'] },
  { key: 'knives', ico: 'icon_itemtype_knife', cats: ['melee'] },
  { key: 'mods', ico: 'icon_itemtype_mod', cats: ['mod', 'gearmod', 'plate'] },
  { key: 'grenades', ico: 'icon_itemtype_grenade', cats: ['grenade', 'flare'] },
  { key: 'barter', ico: 'icon_itemtype_barter', cats: ['barter', 'electronics', 'valuables', 'lootbox', 'money', 'repairkit'] },
  { key: 'gear', ico: 'icon_itemtype_gear_rig', cats: ['rig', 'backpack', 'helmet', 'headset', 'facecover', 'armband'] },
  { key: 'goggles', ico: 'icon_itemtype_gear_goggles', cats: ['glasses', 'nvg'] },
  { key: 'containers', ico: 'icon_itemtype_cont', cats: ['container', 'secure'] },
  { key: 'vests', ico: 'icon_itemtype_gear_armor', cats: ['armor'] },
  { key: 'info', ico: 'icon_itemtype_info', cats: ['info', 'quest'] },
  { key: 'keys', ico: 'keys', cats: ['key'] },
  { key: 'special', ico: 'icon_itemtype_spec', cats: ['special'] },
  { key: 'raid', ico: 'icon_itemtype_foundinraid', test: (item) => !!item.fir },
];
const KIND_OF_CAT = {};
for (const k of KINDS) for (const c of k.cats || []) KIND_OF_CAT[c] = k.key;

/** the keys of the bar under the screen: the blade, the three guns, then seven for whatever is bound to them */
const QUICK = [
  { key: 'G' }, { key: 'V', slot: 'scabbard' }, { key: '1', slot: 'primary' }, { key: '2', slot: 'secondary' }, { key: '3', slot: 'holster' },
  { key: '4', gap: true }, { key: '5' }, { key: '6' }, { key: '7' }, { key: '8' }, { key: '9' }, { key: '0' },
];

let filterText = '';
let kind = 'all';
let searching = false;
/** what the figure's sheet shows: the slots (GEAR) or the body (HEALTH) */
let mode = 'gear';

/** HEALTH is this same screen with the body in place of the slots */
export function setGearMode(next) {
  mode = next === 'health' ? 'health' : 'gear';
  const root = $('#pane-stash .gear');
  if (root) root.dataset.mode = mode;
}
export function gearMode() { return mode; }

function build() {
  const pane = $('#pane-stash');
  if (!pane) return;

  const find = el('input', { class: 'gstash__find', id: 'stash-search', type: 'text', autocomplete: 'off', spellcheck: 'false', hidden: true });
  find.addEventListener('input', () => { filterText = find.value.trim().toLowerCase(); renderStash(); });
  find.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') setSearching(false); });

  const toggle = (id, icoOff, icoOn, label, onClick, off = false) => {
    const b = el('button', { class: 'tbtn', id, type: 'button', disabled: off, dataset: { sfx: 'own' } },
      uiImg(icoOff, 'tbtn__ico tbtn__ico--off', { w: 20, h: 20 }), uiImg(icoOn, 'tbtn__ico tbtn__ico--on', { w: 20, h: 20 }),
      el('span', {}, label));
    if (onClick) b.addEventListener('click', () => { sfx.ui('click'); onClick(); });
    return b;
  };
  const tool = (id, ico, title, onClick) => {
    const b = el('button', { class: 'gtool', id, type: 'button', title, disabled: !onClick, dataset: { sfx: 'own' } }, uiImg(ico, '', { w: 26, h: 26 }));
    if (onClick) b.addEventListener('click', () => { sfx.ui('click'); onClick(); });
    return b;
  };

  pane.replaceChildren(el('div', { class: 'gear', dataset: { mode } },
    el('div', { class: 'gear__left' },
      el('div', { class: 'gear__figure' },
        el('div', { class: 'gdoll', id: 'equipment-host' }),
        el('div', { class: 'ghealth', id: 'health-panel-host' })),
      el('div', { class: 'gear__cont', id: 'carry-host' }),
      el('div', { class: 'gparams', id: 'gear-params' })),
    el('div', { class: 'gquick', id: 'gear-quick' }),
    el('div', { class: 'gstash' },
      el('div', { class: 'gstash__top' },
        toggle('btn-stash-search', 'searchbuttonicons_off', 'searchbuttonicons_on', t('UI/Inventory/SearchButtonCaption'), () => setSearching(!searching)),
        // the sorting table is a second grid to shuffle things through; there is none here yet
        toggle('btn-sort-table', 'sortingtablebuttonicons_off', 'sortingtablebuttonicons_on', t('UI/Inventory/SortTableButtonCaption'), null, true),
        find),
      el('div', { class: 'gstash__money', id: 'stash-money' }),
      el('div', { class: 'ftabs gstash__kinds', id: 'stash-kinds' }),
      el('div', { class: 'gstash__tools' },
        tool('btn-stash-pin', 'pin_mode_icon', tOr('Tooltips/PinLock/PinDescription', ''), null),
        tool('btn-stash-lock', 'lock_mode_icon', tOr('Tooltips/PinLock/LockDescription', ''), null),
        tool('btn-sort-stash', 'icon_sort_big', '', sortStash)),
      el('div', { class: 'gstash__grid', id: 'stash-host' }))));
}

function setSearching(on) {
  searching = on;
  const find = $('#stash-search');
  $('#btn-stash-search')?.classList.toggle('is-on', on);
  if (!find) return;
  find.hidden = !on;
  if (on) find.focus();
  else if (filterText) { find.value = ''; filterText = ''; renderStash(); }
}

function sortStash() {
  const left = game.stash.sort();
  if (left.length) toast(`${left.length} items did not fit`, 'warn');
  renderStash();
  saveSoon();
}

export function initStash() {
  build();
  // the outlines of the empty slots are a pack of their own
  if (!hasUi('earpiece')) loadUiGroup('slots').then((ok) => { if (ok) renderStash(); });
  // the body's numbers move every tick of a raid: they are only drawn while this screen is up
  const shown = () => currentScreen() === 'character';
  on(EV.INVENTORY_CHANGED, () => { if (shown()) paintMoney(); });
  on('shell:money', () => { if (shown()) paintMoney(); });
  on(EV.HEALTH_CHANGED, () => { if (shown()) paintParams(); });
}

export function kindOf(item) { return KIND_OF_CAT[item.tpl.cat] || 'barter'; }

/** the glyph of the kind of thing an item is, as the filter strip draws it */
export function kindIcon(item) {
  return KINDS.find((k) => k.key === kindOf(item)).ico;
}

function matches(item) {
  if (kind !== 'all') {
    const k = KINDS.find((x) => x.key === kind);
    if (k?.test ? !k.test(item) : kindOf(item) !== kind) return false;
  }
  if (!filterText) return true;
  // an unexamined item must not answer to its hidden name
  if (!isKnown(item)) return false;
  const tpl = item.tpl;
  return (`${tpl.name} ${tpl.short} ${tpl.cat}`).toLowerCase().includes(filterText);
}

export function renderStash() {
  const eqHost = $('#equipment-host');
  const carryHost = $('#carry-host');
  const stHost = $('#stash-host');
  if (!eqHost || !stHost) return;

  // the arrow on a slot's header opens what a right-click on the item opens
  const onArrow = (item, anchor) => {
    const r = anchor.getBoundingClientRect();
    openContext(item, r.right, r.top);
  };

  // every one of these is a scroll box; replacing its children collapses the
  // content and would otherwise scroll the player back to the top on each move
  keepScroll([carryHost, stHost], () => {
    renderDoll(game.equipment, eqHost, { onArrow, faction: game.profile.faction, getTpl });
    if (carryHost) renderContainers(game.equipment, carryHost, { onArrow });
    stHost.replaceChildren();
    stHost.append(renderGrid(game.stash, { filterFn: kind !== 'all' || filterText ? matches : null }));
  });

  paintKinds();
  paintMoney();
  paintParams();
  paintQuick();
  refreshContainerWindows();
}

function paintKinds() {
  const host = $('#stash-kinds');
  if (!host) return;
  const present = new Set(['all']);
  for (const it of game.stash.items()) {
    present.add(kindOf(it));
    if (it.fir) present.add('raid');
  }
  if (!present.has(kind)) kind = 'all';
  host.replaceChildren(...KINDS.map((k) => {
    const b = el('button', {
      class: `ftab${kind === k.key ? ' is-active' : ''}`, type: 'button', disabled: !present.has(k.key), dataset: { kind: k.key, sfx: 'own' },
    }, uiImg(k.ico));
    b.addEventListener('click', () => { sfx.ui('click'); kind = kind === k.key ? 'all' : k.key; renderStash(); });
    return b;
  }));
}

/** the three currencies over the stash, the way the client's money panel counts them */
export function paintMoney() {
  const host = $('#stash-money');
  if (!host) return;
  const one = (cur, ico) => el('span', { class: `gmoney gmoney--${cur.toLowerCase()}` }, uiImg(ico, '', { w: 20, h: 20 }), fmtNum(countMoney(cur)));
  host.replaceChildren(
    one('RUB', 'icon_info_money_roubles'), one('EUR', 'icon_info_money_euros'), one('USD', 'icon_info_money_dollars'));
}

/** what can be carried before it starts to cost stamina: the top of the game's base band, moved by Strength */
export function weightLimit() {
  const top = DB.progress?.weight?.base?.[1] || 77;
  return top * strengthCarry();
}

/**
 * Along the bottom of the sheet: the weight carried against the limit, then
 * health, water and energy, each with how fast it comes back out of a raid -
 * or, in one, how fast it goes.
 * @param {HTMLElement} [host]
 * @param {{ inRaid?: boolean }} [opts]
 */
export function paintParams(host = $('#gear-params'), { inRaid = false } = {}) {
  if (!host) return;
  const h = game.health;
  const kg = game.equipment.weight();
  const limit = weightLimit();
  const base = DB.progress?.weight?.base?.[0] || 26;
  const bleeding = h.has(FX.LB) || h.has(FX.HB);
  const hpRate = Object.entries(BODY.regen).reduce((n, [k, v]) => (k === 'energy' || k === 'hydration' ? n : n + v), 0);
  // what comes back by the minute out of a raid, where nothing does while a
  // wound is open; in a raid, what the body is spending
  const r = inRaid ? healthRates(h, true) : { hpRate: bleeding ? 0 : hpRate, hyRate: BODY.regen.hydration, enRate: BODY.regen.energy };
  const buff = (rate) => (Math.abs(rate) < 0.005 ? null : rate > 0
    ? el('span', { class: 'gparam__buff' }, uiImg('health_buff_arrow_up', '', { w: 15, h: 13 }), rate.toFixed(2))
    : el('span', { class: 'gparam__buff is-down' }, uiIcon('health_buff_arrow_down', '', { w: 15, h: 13 }), rate.toFixed(2)));
  // a figure stands three digits wide, the ones it does not need dim
  const lcd = (n) => {
    const s = String(Math.max(0, Math.round(n)));
    return [s.length < 3 ? el('i', { class: 'gparam__lead' }, '0'.repeat(3 - s.length)) : null, s];
  };
  const param = (cls, ico, cur, max, extra, state = '') => el('div', { class: `gparam gparam--${cls} ${state}` },
    uiImg(ico, 'gparam__ico', { w: 33, h: 32 }),
    el('span', { class: 'gparam__cur' }, cur),
    el('span', { class: 'gparam__side' }, extra, el('span', { class: 'gparam__max' }, `/${max}`)));
  host.replaceChildren(
    param('weight', 'health_icon_weight_white', (Math.round(kg * 10) / 10).toFixed(1), Math.round(limit),
      el('span', { class: 'gparam__unit' }, 'KG'), kg > limit ? 'is-crit' : kg > base * strengthCarry() ? 'is-low' : ''),
    param('health', 'health_icon', lcd(h.total), String(Math.round(h.max)),
      buff(r.hpRate), h.total < h.max * 0.3 ? 'is-crit' : ''),
    param('water', 'health_icon_hydration', lcd(h.hydration), '100',
      buff(r.hyRate), h.hydration < 20 ? 'is-crit' : ''),
    param('energy', 'health_icon_energy', lcd(h.energy), '100',
      buff(r.enRate), h.energy < 20 ? 'is-crit' : ''));
}

/**
 * QUICK USE: the blade and the guns on their own keys, and the seven keys things can be bound to
 * @param {HTMLElement} [host]
 */
export function paintQuick(host = $('#gear-quick')) {
  if (!host) return;
  const row = el('div', { class: 'gquick__row' });
  for (const q of QUICK) {
    const item = q.slot ? game.equipment.item(q.slot) : null;
    const cell = el('div', { class: `gquick__slot${q.gap ? ' gquick__slot--gap' : ''}` },
      el('span', { class: 'gquick__key' }, q.key));
    if (item) {
      const tile = renderSlotItem(item);
      tile.classList.add('item--quick');
      cell.append(tile, el('span', { class: 'gquick__name' }, isKnown(item) ? (item.tpl.short || item.tpl.name) : ''));
    }
    row.append(cell);
  }
  host.replaceChildren(el('div', { class: 'gquick__head' }, t('QUICK USE')), row);
}

/** kept for the screens that still call it; the client does not mark a container on its tile */
export function markOpenable() {}

// ---------------------------------------------------------
export function activateStashContext() {
  dndContext.quickTargets = (item) => {
    // moving out of the character goes to the stash, and vice versa
    const inChar = isOnCharacter(item);
    if (inChar) return [game.stash];
    // not the stash itself: with the gear full, autoPlace fell through to it
    // and re-homed the item to the first free cell, reporting success — a
    // hand-packed stash got shuffled one ctrl+click at a time
    return [...game.equipment.carryGrids(), ...game.equipment.nestedGrids()];
  };
  dndContext.equipSlotFor = (item) => game.equipment.slotFor(item);
  dndContext.requestSplit = (item, cb) => splitDialog(item, cb);
  dndContext.onActivate = (item) => {
    if (needsExamine(item)) examineNow(item);
    else if (item.isContainer) openContainerWindow(item);
    else if (item.isWeapon) openModdingWindow(item);
    else quickTransfer(item);
  };
  dndContext.onChange = () => {
    renderStash();
    emit(EV.INVENTORY_CHANGED);
    saveSoon();
  };
  dndContext.canMove = () => true;
  onWindowChange(() => dndContext.onChange());
  // parts come out of, and go back into, the stash and everything worn -
  // the pouch included, as the game allows
  moddingContext.sources = () => [game.stash, ...game.equipment.allGrids(), ...game.equipment.nestedGrids()];

  setContextProvider((item) => buildMenu(item, 'stash'));
}

export function isOnCharacter(item) {
  let cur = item;
  let guard = 0;
  while (cur && guard++ < 16) {
    const h = cur.holder;
    if (!h) return false;
    if (h.kind === 'slot') return true;
    if (h.kind === 'mod') { cur = h.slot.owner; continue; }   // a part is wherever its gun is
    if (h.grid.tag === 'stash') return false;
    if (h.grid.tag === 'pocket') return true;
    cur = h.grid.owner;
  }
  return false;
}

// ---------------------------------------------------------
/**
 * What a right-click on an item offers: the client's rows, in the client's
 * order for the kind of thing it is.
 *
 *   INSPECT, then what is done with it (USE, LOAD, UNLOAD, EQUIP, OPEN,
 *   MODDING, EDIT BUILD, FOLD, REPAIR, INSURE, DISASSEMBLE), then the flea
 *   market's four, ADD TO WISHLIST with its second menu, and DISCARD apart
 *   at the bottom.
 *
 * There is no SPLIT and no MOVE here because the client has none: a stack is
 * split by dragging it with CTRL held, and CTRL+click sends an item across.
 * A row the build has nothing behind yet is drawn switched off, where the
 * client would have it.
 *
 * @param {import('../inventory/model.js').Item} item
 * @param {'stash'|'trade'|'raid'} where
 * @param {object[]} [extra]   rows of the screen's own (SELL on a trader's)
 * @param {{ noOpen?: boolean }} [opts]
 * @returns {{ id: string, label: string, icon: string, disabled?: boolean, run?: () => void, kind?: string, sub?: object[] }[]}
 */
export function buildMenu(item, where, extra = [], opts = {}) {
  const rows = [];
  const add = (id, label, icon, run, more = {}) => rows.push({ id, label, icon, run, ...more });
  const up = (s) => String(s).toUpperCase();
  const stash = where === 'stash';
  const done = () => dndContext.onChange();
  const homes = () => {
    const host = item.holder?.kind === 'grid' ? [item.holder.grid] : [];
    return [...host, ...(dndContext.quickTargets(item) || []), ...moddingContext.sources()];
  };

  if (!isKnown(item)) {
    add('examine', t('EXAMINE'), 'examine', () => examineNow(item), { disabled: !!examining() });
  } else {
    const tpl = item.tpl;
    add('inspect', t('INSPECT'), 'inspect', () => inspectDialog(item));

    // meds and rations work on the body from the stash too, as in the game;
    // the trader screen keeps to trading
    if (tpl.med && where !== 'trade' && (item.res == null || item.res > 0)) {
      add('use', t('USE'), 'use', () => useInHideout(item));
    }

    // a gun's magazine goes in and comes out; one that is loaded by the round
    // is loaded and emptied like a magazine
    const magSlot = item.isWeapon ? item.slots?.find((s) => s.name === 'mod_magazine') : null;
    if (magSlot) {
      if (magSlot.item) {
        add('unload', t('UNLOAD'), 'unload', () => {
          const r = uninstallMod(magSlot, homes());
          if (!r.ok) toast(r.reason || 'No room for the magazine', 'warn');
          done();
        }, { disabled: !canDetachPart(magSlot.item).ok });
      } else {
        const fits = compatibleParts(magSlot, moddingContext.sources())
          .sort((a, b) => (b.ammoCount || 0) - (a.ammoCount || 0))[0];
        add('load', t('LOAD'), 'load', () => {
          const r = installMod(magSlot, fits, homes());
          if (!r.ok) toast(r.reason || 'Does not fit', 'warn');
          done();
        }, { disabled: !fits });
      }
    }
    const mag = magazineOf(item);
    if (mag && (!magSlot || item.isMag)) {
      add('loadammo', t('LoadAmmo'), 'loadammo',
        // rounds come from everywhere the modding screen looks - the stash and
        // what is worn - not only from the quick-transfer target
        () => loadAmmoDialog(mag, moddingContext.sources(), done), { disabled: mag.ammoFree === 0 });
      add('unloadammo', t('UnloadAmmo'), 'unloadammo', () => {
        const r = unloadAmmo(mag, homes());
        if (!r.ok) toast(r.reason || 'No room for the rounds', 'warn');
        done();
      }, { disabled: mag.ammoCount === 0 });
    }
    if (item.cat === 'ammobox') {
      add('unpack', up(t('Unpack')), 'unpack', () => {
        const r = unpackAmmoBox(item, homes());
        if (!r.ok) toast(r.reason || 'No room for the rounds', 'warn');
        done();
      });
    }

    const slot = game.equipment.slotFor(item);
    if (where !== 'trade') {
      if (isEquipped(item)) add('unequip', t('UNEQUIP'), 'unequip', () => quickTransfer(item));
      else if (slot) {
        add('equip', t('EQUIP'), 'equip', () => {
          const res = moveToSlot(item, slot);
          if (res.ok) { sfx.ui('equip'); done(); } else toast('Slot is not empty', 'warn');
        });
      }
    }

    if (item.hasMods && (item.isWeapon || item.slots.length)) {
      add('modding', t('MODDING'), 'modding', () => openModdingWindow(item));
      if (item.isWeapon && where !== 'raid') add('editbuild', t('Editbuild'), 'editbuild', () => openModdingWindow(item, { builds: true }));
    }
    if (tpl.wpn?.fold) {
      const cf = canFold(item);
      add(item.folded ? 'unfold' : 'fold', t(item.folded ? 'UNFOLD' : 'FOLD'), item.folded ? 'unfold' : 'fold', () => {
        const r = toggleFold(item);
        if (!r.ok) toast(r.reason, 'warn');
        done();
      }, { disabled: !cf.ok });
    }
    // a gun out of a raid can be mended with a kit, if there is one about;
    // the kit itself is used from the gun's own menu
    if (where !== 'raid' && isRepairable(item)) {
      const kits = repairKitsIn(moddingContext.sources());
      add('repair', t('REPAIR'), 'repair', () => repairKitDialog(item, kits, done),
        { disabled: !kits.length || repairNeeded(item) <= 0 });
    }
    if (where !== 'raid' && isRepairKit(item)) {
      add('repair', t('REPAIR'), 'repair', () => kitTargetDialog(item, moddingContext.sources(), done));
    }
    // what a trader would insure: anything worn or carried as kit
    if (stash && (slot || item.isWeapon || item.cat === 'mod' || item.isMag)) {
      add('insure', t('INSURE'), 'insure', menuHooks.insure ? () => menuHooks.insure(item) : null, { disabled: !menuHooks.insure });
    }
    if (item.isContainer && !opts.noOpen) add('open', t('OPEN'), 'open', () => openContainerWindow(item));
    if (item.isWeapon && where !== 'raid') {
      const loose = item.slots?.some((s) => s.item && canDetachPart(s.item).ok);
      add('disassemble', t('DISASSEMBLE'), 'disassemble', () => {
        const r = stripWeapon(item, homes());
        if (r && r.ok === false) toast(r.reason || 'No room for the parts', 'warn');
        done();
      }, { disabled: !loose });
    }
  }

  for (const a of extra) rows.push(a);

  if (stash && isKnown(item)) {
    // the flea market's four: listing the item, and the three searches
    const flea = menuHooks.flea;
    add('addoffer', up(t('AddOffer')), 'addoffer', flea ? () => flea.addOffer(item) : null, { disabled: !flea?.canList?.(item) });
    add('filter', t('FilterSearch'), 'filtersearch', flea ? () => flea.search(item, 'filter') : null, { disabled: !flea });
    add('linked', t('LinkedSearch'), 'linkedsearch', flea ? () => flea.search(item, 'linked') : null, { disabled: !flea });
    add('needed', t('NeededSearch'), 'neededsearch', flea ? () => flea.search(item, 'needed') : null, { disabled: !flea });
  }
  if (where !== 'raid' && isKnown(item)) {
    const now = Wishlist.wishGroup(item.tpl);
    const sub = Wishlist.WISH_GROUPS.map((g) => ({
      id: `wish:${g.id}`, label: up(t(g.key)), icon: 'addtowishlist', kind: 'wish', disabled: now === g.id,
      run: () => { Wishlist.addToWishlist(item.tpl, g.id); done(); },
    }));
    if (now) {
      sub.push({ id: 'unwish', label: up(t('RemoveFromWishlist')), icon: 'removefromwishlist', kind: 'unwish',
        run: () => { Wishlist.removeFromWishlist(item.tpl); done(); } });
    }
    rows.push({ id: 'wishlist', label: up(t('AddToWishlist')), icon: 'addtowishlist', kind: 'wish', sub });
  }

  rows.push({
    id: 'discard', label: t('DISCARD'), icon: 'discard', kind: 'discard',
    run: async () => {
      const ok = await confirmDialog({ body: destroyPrompt(item) });
      if (!ok) return;
      detach(item);
      done();
    },
  });
  return rows;
}

/**
 * Rows whose work is another module's: it says so here when it is ready.
 *   flea    { canList(item), addOffer(item), search(item, 'filter' | 'linked' | 'needed') }
 *   insure  (item) => void
 */
export const menuHooks = { flea: null, insure: null };

/** run an examination, repainting only the progress bar as it ticks */
export function examineNow(item) {
  startExamine(item, () => {
    if (examining() === item) paintExamine(item);
    else dndContext.onChange();
  });
}

function isEquipped(item) {
  return item.holder?.kind === 'slot';
}
