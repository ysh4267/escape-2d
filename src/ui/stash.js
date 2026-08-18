// =========================================================
// stash screen: gear doll + the big stash grid
// =========================================================

import { $, el, fmtWeight, debounce, keepScroll } from '../core/util.js';
import { game, saveSoon } from '../core/state.js';
import { renderGrid } from '../inventory/view.js';
import { renderGearSlots, renderCarry } from '../inventory/equipment.js';
import { openContainerWindow, refreshContainerWindows } from '../inventory/window.js';
import { dndContext, quickTransfer } from '../inventory/dnd.js';
import { setContextProvider, splitDialog, inspectDialog, confirmDialog } from '../inventory/dialogs.js';
import { startExamine, examining, needsExamine, isKnown } from '../inventory/examine.js';
import { paintExamine } from '../inventory/view.js';
import { autoPlace, detach, moveToSlot, splitStack } from '../inventory/model.js';
import { openModdingWindow, moddingContext } from '../inventory/modding.js';
import { loadAmmoDialog, loadIntoDialog } from '../inventory/ammo-dialogs.js';
import { unloadAmmo, toggleFold, canFold, magazineOf } from '../inventory/weapon.js';
import { emit, EV } from '../core/events.js';
import { toast } from './shell.js';
import { useInHideout } from './health-ui.js';

let filterText = '';

export function initStash() {
  const search = $('#stash-search');
  search.addEventListener('input', debounce(() => {
    filterText = search.value.trim().toLowerCase();
    renderStash();
  }, 140));

  $('#btn-sort-stash').addEventListener('click', () => {
    const left = game.stash.sort();
    if (left.length) toast(`${left.length} items did not fit`, 'warn');
    renderStash();
    saveSoon();
  });

  // extracting no longer empties your gear for you, so unloading it is an
  // explicit action here instead
  $('#btn-unload-gear').addEventListener('click', async () => {
    const { Raid } = await import('../raid/raid.js');
    const { moved, overflow } = Raid.depositToStash();
    if (overflow.length) toast(`${overflow.length} items stayed in your gear — stash is full`, 'warn');
    else if (moved.length) toast(`${moved.length} items unloaded into the stash`, 'ok');
    else toast('Nothing to unload', 'info');
    renderStash();
    emit(EV.INVENTORY_CHANGED);
    saveSoon();
  });
}

function matches(item) {
  if (!filterText) return true;
  // an unexamined item must not answer to its hidden name
  if (!isKnown(item)) return false;
  const t = item.tpl;
  return (`${t.name} ${t.short} ${t.cat}`).toLowerCase().includes(filterText);
}

export function renderStash() {
  const eqHost = $('#equipment-host');
  const carryHost = $('#carry-host');
  const stHost = $('#stash-host');
  if (!eqHost || !stHost) return;

  // every one of these is a scroll box; replacing its children collapses the
  // content and would otherwise scroll the player back to the top on each move
  keepScroll([eqHost, carryHost, stHost], () => {
    renderGearSlots(game.equipment, eqHost);
    if (carryHost) renderCarry(game.equipment, carryHost);
    stHost.replaceChildren();
    stHost.append(renderGrid(game.stash, { filterFn: filterText ? matches : null }));
  });
  $('#equip-weight').textContent = fmtWeight(game.equipment.weight());

  markOpenable(eqHost);
  markOpenable(carryHost);
  markOpenable(stHost);
  refreshContainerWindows();
}

/** containers get a corner tick so it is obvious they can be popped out */
export function markOpenable(root) {
  if (!root) return;
  for (const node of root.querySelectorAll('.item')) {
    if (node._item?.isContainer) node.classList.add('item--openable');
  }
}

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
  // parts come out of, and go back into, the stash and everything worn
  moddingContext.sources = () => [game.stash, ...game.equipment.carryGrids(), ...game.equipment.nestedGrids()];

  setContextProvider((item) => buildMenu(item, 'stash'));
}

export function isOnCharacter(item) {
  let cur = item;
  let guard = 0;
  while (cur && guard++ < 16) {
    const h = cur.holder;
    if (!h) return false;
    if (h.kind === 'slot') return true;
    if (h.grid.tag === 'stash') return false;
    if (h.grid.tag === 'pocket') return true;
    cur = h.grid.owner;
  }
  return false;
}

// ---------------------------------------------------------
export function buildMenu(item, where, extra = [], opts = {}) {
  const actions = [];
  const examined = isKnown(item);

  if (!examined) {
    actions.push({
      label: 'EXAMINE', icon: 'eye', key: 'DBL-CLICK',
      disabled: !!examining(),
      run: () => examineNow(item),
    });
  }

  if (examined) {
    if (item.isContainer && !opts.noOpen) {
      actions.push({
        label: 'OPEN', icon: 'box', key: 'DBL-CLICK',
        run: () => openContainerWindow(item),
      });
    }
    // meds and rations work on the body from the stash too, as in the game;
    // the trader screen keeps to trading
    if (item.tpl.med && where !== 'trade' && (item.res == null || item.res > 0)) {
      actions.push({ label: 'USE', icon: 'health', run: () => useInHideout(item) });
    }
    if (item.tpl.stack > 1 && item.stack > 1) {
      actions.push({
        // the trader screen turns ctrl+drag off, so it must not advertise it
        label: 'SPLIT', icon: 'split', key: dndContext.requestSplit ? 'CTRL+DRAG' : null,
        run: () => splitDialog(item, (n) => {
          const copy = splitStack(item, n);
          if (!copy) return;
          const host = item.holder?.kind === 'grid' ? item.holder.grid : null;
          const targets = host ? [host, ...(dndContext.quickTargets(item) || [])] : (dndContext.quickTargets(item) || []);
          // merge:false or the split is a no-op: the source stack is the first
          // candidate and has exactly `n` room, so the half just split off gets
          // merged straight back into it
          if (!autoPlace(copy, targets, { merge: false })) {
            item.stack += copy.stack;   // nowhere to put the split-off half
            toast('No space to split into', 'warn');
            return;
          }
          dndContext.onChange();
        }),
      });
    }

    const slot = game.equipment.slotFor(item);
    if (slot && where !== 'trade' && !isEquipped(item)) {
      actions.push({
        label: `EQUIP — ${slot.label}`, icon: 'check', key: 'ALT+CLICK',
        run: () => {
          const res = moveToSlot(item, slot);
          if (res.ok) dndContext.onChange();
          else toast('Slot is not empty', 'warn');
        },
      });
    }

    // in the trader screen the ctrl+click target is the trading table, and
    // that already has its own labelled action
    if (where !== 'trade') {
      actions.push({
        label: where === 'raid' ? 'MOVE TO GEAR' : (isOnCharacter(item) ? 'MOVE TO STASH' : 'MOVE TO GEAR'),
        icon: 'sell', key: 'CTRL+CLICK',
        run: () => quickTransfer(item),
      });
    }

    actions.push({ label: 'INSPECT', icon: 'info', run: () => inspectDialog(item) });

    // ---- weapons, magazines, cartridges ----
    // the same set the game offers on the right-click of each: a gun opens
    // the modding screen and folds; anything with rounds in it loads and
    // unloads; a stack of cartridges asks which magazine to go into
    if (item.hasMods && (item.isWeapon || item.slots.length)) {
      actions.push({ label: 'MODDING', icon: 'crosshair', key: 'DBL-CLICK', run: () => openModdingWindow(item) });
    }
    if (item.tpl.wpn?.fold) {
      const cf = canFold(item);
      actions.push({
        label: item.folded ? 'UNFOLD STOCK' : 'FOLD STOCK', icon: 'rotate', disabled: !cf.ok,
        run: () => {
          const r = toggleFold(item);
          if (!r.ok) toast(r.reason, 'warn');
          dndContext.onChange();
        },
      });
    }
    const mag = magazineOf(item);
    if (mag) {
      actions.push({
        label: item.isMag ? 'LOAD AMMO' : 'LOAD MAGAZINE', icon: 'cart', disabled: mag.ammoFree === 0,
        run: () => loadAmmoDialog(mag, dndContext.quickTargets(item) || [], () => dndContext.onChange()),
      });
      actions.push({
        label: 'UNLOAD AMMO', icon: 'sell', disabled: mag.ammoCount === 0,
        run: () => {
          const host = item.holder?.kind === 'grid' ? [item.holder.grid] : [];
          const r = unloadAmmo(mag, [...host, ...(dndContext.quickTargets(item) || [])]);
          if (!r.ok) toast(r.reason || 'No room for the rounds', 'warn');
          dndContext.onChange();
        },
      });
    }
    if (item.cat === 'ammo') {
      actions.push({
        label: 'LOAD INTO MAGAZINE', icon: 'cart',
        run: () => loadIntoDialog(item, moddingContext.sources(), () => dndContext.onChange()),
      });
    }
  }

  for (const a of extra) actions.push(a);

  actions.push('-');
  actions.push({
    // no DEL hint: there is no selection outside this menu for a key to act on
    label: 'DISCARD', icon: 'discard', danger: true,
    run: async () => {
      const ok = await confirmDialog({
        title: 'DISCARD ITEM',
        body: `${isKnown(item) ? item.tpl.name : 'Unknown item'} will be destroyed permanently.`,
        confirmLabel: 'DISCARD', danger: true,
      });
      if (!ok) return;
      detach(item);
      dndContext.onChange();
    },
  });

  return actions;
}

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
