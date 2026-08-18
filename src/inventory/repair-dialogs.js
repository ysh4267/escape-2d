// =========================================================
// repair with a kit: pick the gun, pick the points, pay in resource
//
// The trader's bench lives on the trader screen (trade.js, REPAIR); this is
// the kit's side of it - the game lets you use a Weapon repair kit on any gun
// in the stash, at 0.5 resource a point, with the kit's own wear roll on the
// gun's ceiling. Two entry points: from the gun (REPAIR WITH KIT, which asks
// which kit if there are several) and from the kit (USE ON WEAPON, which asks
// which gun).
// =========================================================

import { el, clamp, fmtNum } from '../core/util.js';
import { openModal } from './dialogs.js';
import { renderItem } from './view.js';
import { isKnown } from './examine.js';
import { game } from '../core/state.js';
import { emit, EV } from '../core/events.js';
import {
  isRepairable, repairNeeded, kitPointsLeft, kitRepair, wearRange, KIT_RESOURCE_PER_POINT,
} from './repair.js';

const fmt2 = (v) => {
  const r = Math.round(v * 100) / 100;
  return Number.isInteger(r) ? String(r) : String(r);
};

/** mend `weapon` with one of `kits`: a slider for the points, the resource it costs */
export function repairKitDialog(weapon, kits, onDone) {
  const usable = (kits || []).filter((k) => kitPointsLeft(k) > 0);
  if (!isRepairable(weapon) || !usable.length) return;
  openModal((box, done) => {
    box.classList.add('split', 'repairkit');
    let kit = usable.slice().sort((a, b) => (b.res || 0) - (a.res || 0))[0];
    let value = 0;
    const need = repairNeeded(weapon);

    const kitList = el('div', { class: 'ammoload__list' });
    const field = el('input', { class: 'split__val', type: 'number', min: '0', value: '0' });
    const range = el('input', { type: 'range', min: '0', value: '0' });
    const hint = el('div', { class: 'split__hint' });
    const wear = el('div', { class: 'split__hint' });
    const accept = el('button', { class: 'btn btn--primary' }, 'REPAIR');

    const sync = (v) => {
      const max = Math.min(need, kitPointsLeft(kit));
      field.max = String(max); range.max = String(max);
      value = clamp(Math.round(Number(v) || 0), 0, max);
      field.value = String(value); range.value = String(value);
      const [lo, hi] = wearRange(weapon, { kit: true });
      hint.textContent = `${fmt2(weapon.dura)} → ${fmt2(Math.min(weapon.maxDura, weapon.dura + value))} of ${fmt2(weapon.maxDura)}`
        + ` · costs ${fmt2(value * KIT_RESOURCE_PER_POINT)} of ${fmt2(kit.res)} kit resource`;
      wear.textContent = `The kit will take between ${fmt2(lo)} and ${fmt2(hi)} off the maximum durability.`;
      accept.disabled = value <= 0;
      for (const n of kitList.children) n.classList.toggle('is-on', n.dataset.uid === kit.uid);
    };
    field.addEventListener('input', () => sync(field.value));
    range.addEventListener('input', () => sync(range.value));

    for (const k of usable) {
      const rowEl = el('div', { class: 'ammoload__row', dataset: { uid: k.uid } });
      const tile = renderItem(k, { static: true, noName: true });
      tile.classList.add('ammoload__tile');
      rowEl.append(tile,
        el('div', { class: 'ammoload__info' },
          el('div', { class: 'ammoload__name' }, isKnown(k) ? k.tpl.name : 'Unknown item'),
          el('div', { class: 'ammoload__stat' }, `${fmt2(k.res)} / ${k.tpl.res?.max || k.tpl.repairKit?.max} resource · repairs ${kitPointsLeft(k)} points`)));
      rowEl.addEventListener('click', () => { kit = k; sync(Math.min(need, kitPointsLeft(k))); });
      kitList.append(rowEl);
    }

    accept.addEventListener('click', () => {
      const r = kitRepair(kit, weapon, value);
      done();
      if (!r.ok) emit(EV.TOAST, { kind: 'warn', text: r.reason });
      else emit(EV.TOAST, { kind: 'ok', text: `Repaired ${fmt2(r.restored)} — maximum now ${fmt2(r.maxDura)}` });
      onDone?.();
    });

    const art = renderItem(weapon, { static: true, noName: true });
    art.classList.add('ammoload__tile');
    box.append(
      el('div', { class: 'modal__head' }, `REPAIR ${weapon.tpl.short.toUpperCase()} — ${fmt2(weapon.dura)} / ${fmt2(weapon.maxDura)}`),
      el('div', { class: 'modal__body' },
        el('div', { class: 'ammoload__row is-static' }, art,
          el('div', { class: 'ammoload__info' },
            el('div', { class: 'ammoload__name' }, weapon.tpl.name),
            el('div', { class: 'ammoload__stat' }, `${fmt2(need)} points short of its ceiling`))),
        usable.length > 1 ? el('div', { class: 'deal-need' }, 'With which kit:') : null,
        usable.length > 1 ? kitList : null,
        el('div', { class: 'split__row' }, field, range),
        hint, wear),
      el('div', { class: 'modal__foot' },
        el('button', { class: 'btn', onclick: () => done() }, 'CANCEL'),
        accept));
    sync(Math.min(need, kitPointsLeft(kit)));
    setTimeout(() => field.select(), 30);
  });
}

/** every gun that could use `kit`, in the stash, worn or in a case */
export function repairableWeapons(sources) {
  const out = [];
  const seen = new Set();
  const consider = (it) => {
    if (seen.has(it.uid) || !isRepairable(it) || repairNeeded(it) <= 0) return;
    seen.add(it.uid);
    out.push(it);
  };
  for (const g of sources) {
    for (const it of g.items()) {
      consider(it);
      for (const d of it.descendants()) if (d.holder?.kind === 'grid') consider(d);
    }
  }
  for (const it of game.equipment.everything()) consider(it);
  return out;
}

/** which gun does the kit go on */
export function kitTargetDialog(kit, sources, onDone) {
  const guns = repairableWeapons(sources);
  openModal((box, done) => {
    box.classList.add('split', 'ammoload');
    const list = el('div', { class: 'ammoload__list' });
    for (const g of guns) {
      const rowEl = el('div', { class: 'ammoload__row' });
      const tile = renderItem(g, { static: true, noName: true });
      tile.classList.add('ammoload__tile');
      rowEl.append(tile,
        el('div', { class: 'ammoload__info' },
          el('div', { class: 'ammoload__name' }, isKnown(g) ? g.tpl.name : 'Unknown weapon'),
          el('div', { class: 'ammoload__stat' }, `${fmt2(g.dura)} / ${fmt2(g.maxDura)} · ${fmt2(repairNeeded(g))} to repair`)),
        el('button', {
          class: 'btn btn--sm btn--primary',
          onclick: () => { done(); repairKitDialog(g, [kit], onDone); },
        }, 'REPAIR'));
      list.append(rowEl);
    }
    if (!guns.length) list.append(el('div', { class: 'empty-note' }, 'NO WEAPON NEEDS REPAIR'));
    box.append(
      el('div', { class: 'modal__head' }, `${kit.tpl.name.toUpperCase()} — ${fmt2(kit.res)} RESOURCE · ${fmtNum(kitPointsLeft(kit))} POINTS`),
      el('div', { class: 'modal__body' }, list),
      el('div', { class: 'modal__foot' }, el('button', { class: 'btn', onclick: () => done() }, 'CLOSE')));
  });
}
