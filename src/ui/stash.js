// =========================================================
// stash screen: gear doll + the big stash grid
// =========================================================

import { $, el, fmtWeight, debounce } from '../core/util.js';
import { game, saveSoon, markExamined, isExamined } from '../core/state.js';
import { renderGrid } from '../inventory/view.js';
import { renderEquipment } from '../inventory/equipment.js';
import { dndContext, quickTransfer } from '../inventory/dnd.js';
import { setContextProvider, splitDialog, inspectDialog, confirmDialog } from '../inventory/dialogs.js';
import { autoPlace, detach, moveToSlot, splitStack } from '../inventory/model.js';
import { emit, EV } from '../core/events.js';
import { toast } from './shell.js';

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
}

function matches(item) {
  if (!filterText) return true;
  const t = item.tpl;
  return (`${t.name} ${t.short} ${t.cat}`).toLowerCase().includes(filterText);
}

export function renderStash() {
  const eqHost = $('#equipment-host');
  const stHost = $('#stash-host');
  if (!eqHost || !stHost) return;

  renderEquipment(game.equipment, eqHost);
  $('#equip-weight').textContent = fmtWeight(game.equipment.weight());

  stHost.replaceChildren();
  stHost.append(renderGrid(game.stash, { filterFn: filterText ? matches : null }));
}

// ---------------------------------------------------------
export function activateStashContext() {
  dndContext.quickTargets = (item) => {
    // moving out of the character goes to the stash, and vice versa
    const inChar = isOnCharacter(item);
    if (inChar) return [game.stash];
    return [...game.equipment.carryGrids(), ...game.equipment.nestedGrids(), game.stash];
  };
  dndContext.equipSlotFor = (item) => game.equipment.slotFor(item);
  dndContext.requestSplit = (item, cb) => splitDialog(item, cb);
  dndContext.onChange = () => {
    renderStash();
    emit(EV.INVENTORY_CHANGED);
    saveSoon();
  };
  dndContext.canMove = () => true;

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
export function buildMenu(item, where, extra = []) {
  const actions = [];
  const examined = item.examined || isExamined(item.tpl.key);

  if (!examined) {
    actions.push({
      label: 'EXAMINE', icon: 'eye',
      run: () => {
        item.examined = true;
        markExamined(item.tpl.key);
        dndContext.onChange();
        toast(`Item examined: ${item.tpl.name}`, 'ok');
      },
    });
    actions.push('-');
  }

  if (examined) {
    if (item.tpl.stack > 1 && item.stack > 1) {
      actions.push({
        label: 'SPLIT', icon: 'split', key: 'CTRL+DRAG',
        run: () => splitDialog(item, (n) => {
          const copy = splitStack(item, n);
          if (!copy) return;
          const host = item.holder?.kind === 'grid' ? item.holder.grid : null;
          const targets = host ? [host, ...(dndContext.quickTargets(item) || [])] : (dndContext.quickTargets(item) || []);
          if (!autoPlace(copy, targets)) {
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

    actions.push({
      label: where === 'raid' ? 'MOVE TO GEAR' : (isOnCharacter(item) ? 'MOVE TO STASH' : 'MOVE TO GEAR'),
      icon: 'sell', key: 'CTRL+CLICK',
      run: () => quickTransfer(item),
    });

    actions.push({ label: 'INSPECT', icon: 'info', run: () => inspectDialog(item) });
  }

  for (const a of extra) actions.push(a);

  actions.push('-');
  actions.push({
    label: 'DISCARD', icon: 'discard', danger: true, key: 'DEL',
    run: async () => {
      const ok = await confirmDialog({
        title: 'DISCARD ITEM',
        body: `${item.tpl.name} will be destroyed permanently.`,
        confirmLabel: 'DISCARD', danger: true,
      });
      if (!ok) return;
      detach(item);
      dndContext.onChange();
    },
  });

  return actions;
}

function isEquipped(item) {
  return item.holder?.kind === 'slot';
}

// ---------------------------------------------------------
/** used by the results screen: pull everything off the character into the stash */
export function stowIntoStash(items) {
  const overflow = [];
  for (const it of items) {
    detach(it);
    if (!autoPlace(it, [game.stash])) overflow.push(it);
  }
  return overflow;
}
