// =========================================================
// cartridge dialogs: load a magazine, pick a magazine for a stack
//
// The game loads a magazine from whatever stacks of the right calibre you are
// carrying, one round at a time in the order you choose. Here: pick the round,
// pick how many, and it goes in as one run on top of what is already there.
// =========================================================

import { el, clamp, fmtNum } from '../core/util.js';
import { openModal } from './dialogs.js';
import { renderItem } from './view.js';
import { isKnown } from './examine.js';
import { loadAmmo, canLoad, magazineOf, describeRounds } from './weapon.js';

/** every ammo stack in `grids` (nested containers included) the magazine takes */
export function ammoStacksFor(mag, grids) {
  const out = [];
  const seen = new Set();
  const consider = (it) => {
    if (seen.has(it.uid) || it.cat !== 'ammo') return;
    seen.add(it.uid);
    if (canLoad(mag, it).ok || (mag.tpl.ammoFilter || []).includes(it.tplId)) out.push(it);
  };
  for (const g of grids) {
    for (const it of g.items()) {
      consider(it);
      for (const d of it.descendants()) if (d.holder?.kind === 'grid') consider(d);
    }
  }
  return out;
}

/** every magazine (loose, or in a gun) in `grids` that takes this round */
export function magazinesFor(ammo, grids) {
  const out = [];
  const seen = new Set();
  const consider = (it) => {
    if (seen.has(it.uid)) return;
    seen.add(it.uid);
    const mag = magazineOf(it);
    if (mag && (mag.tpl.ammoFilter || []).includes(ammo.tplId)) out.push({ host: it, mag });
  };
  for (const g of grids) {
    for (const it of g.items()) {
      consider(it);
      for (const d of it.descendants()) if (d.holder?.kind === 'grid') consider(d);
    }
  }
  return out;
}

/** load `mag` from the ammo stacks in `sources`; `onDone` after any change */
/**
 * `opts.timed(stacks, n)` — when given (in raid) the dialog hands the chosen
 * stacks and count to it instead of loading on the spot, so the rounds can go
 * in one at a time on the raid clock; it returns true when it took the job.
 */
export function loadAmmoDialog(mag, sources, onDone, opts = {}) {
  const stacks = ammoStacksFor(mag, sources);
  // group by template so the picker shows one row per round type
  const byTpl = new Map();
  for (const s of stacks) {
    const rec = byTpl.get(s.tplId) || { tpl: s.tpl, stacks: [], total: 0 };
    rec.stacks.push(s);
    rec.total += s.stack;
    byTpl.set(s.tplId, rec);
  }
  openModal((box, done) => {
    box.classList.add('split', 'ammoload');
    let chosen = byTpl.size ? Array.from(byTpl.keys())[0] : null;
    let value = 0;
    const free = mag.ammoFree;

    const list = el('div', { class: 'ammoload__list' });
    const field = el('input', { class: 'split__val', type: 'number', min: '0', value: '0' });
    const range = el('input', { type: 'range', min: '0', value: '0' });
    const hint = el('div', { class: 'split__hint' });
    const accept = el('button', { class: 'btn btn--primary' }, 'LOAD');

    const sync = (v) => {
      const rec = chosen ? byTpl.get(chosen) : null;
      const max = rec ? Math.min(free, rec.total) : 0;
      field.max = String(max); range.max = String(max);
      value = clamp(Math.round(Number(v) || 0), 0, max);
      field.value = String(value); range.value = String(value);
      hint.textContent = rec
        ? `${rec.tpl.name} — ${fmtNum(rec.total)} carried · ${free} free in ${mag.tpl.short}`
        : 'No cartridges of the right calibre';
      accept.disabled = !rec || value <= 0;
      for (const n of list.children) n.classList.toggle('is-on', n.dataset.t === chosen);
    };
    field.addEventListener('input', () => sync(field.value));
    range.addEventListener('input', () => sync(range.value));

    for (const [t, rec] of byTpl) {
      const a = rec.tpl.ammo || {};
      const rowEl = el('div', { class: 'ammoload__row', dataset: { t } });
      const tile = renderItem(rec.stacks[0], { static: true, noName: true });
      tile.classList.add('ammoload__tile');
      rowEl.append(tile,
        el('div', { class: 'ammoload__info' },
          el('div', { class: 'ammoload__name' }, isKnown(rec.stacks[0]) ? rec.tpl.name : 'Unknown round'),
          el('div', { class: 'ammoload__stat' },
            `DMG ${a.dmg ?? '?'} · PEN ${a.pen ?? '?'} · ${fmtNum(rec.total)} carried`)));
      rowEl.addEventListener('click', () => { chosen = t; sync(Math.min(free, rec.total)); });
      list.append(rowEl);
    }
    if (!byTpl.size) list.append(el('div', { class: 'empty-note' }, 'NO CARTRIDGES OF THIS CALIBRE CARRIED'));

    accept.addEventListener('click', () => {
      const rec = byTpl.get(chosen);
      if (!rec || value <= 0) return;
      if (opts.timed) {
        done();
        if (opts.timed(rec.stacks, value)) onDone?.();
        return;
      }
      let left = value;
      for (const s of rec.stacks) {
        if (left <= 0) break;
        const r = loadAmmo(mag, s, left);
        if (r.ok) left -= r.loaded;
      }
      done();
      onDone?.();
    });

    box.append(
      el('div', { class: 'modal__head' }, `LOAD ${mag.tpl.short.toUpperCase()} — ${mag.ammoCount}/${mag.tpl.magSize} (${describeRounds(mag)})`),
      el('div', { class: 'modal__body' },
        list,
        el('div', { class: 'split__row' }, field, range),
        hint),
      el('div', { class: 'modal__foot' },
        el('button', { class: 'btn', onclick: () => done() }, 'CANCEL'),
        accept));
    sync(chosen ? Math.min(free, byTpl.get(chosen).total) : 0);
    setTimeout(() => field.select(), 30);
  });
}

/** put this stack into one of the magazines you own */
export function loadIntoDialog(ammo, sources, onDone, opts = {}) {
  const mags = magazinesFor(ammo, sources).filter(({ mag }) => mag.ammoFree > 0);
  openModal((box, done) => {
    box.classList.add('split', 'ammoload');
    const list = el('div', { class: 'ammoload__list' });
    for (const { host, mag } of mags) {
      const rowEl = el('div', { class: 'ammoload__row' });
      const tile = renderItem(host, { static: true, noName: true });
      tile.classList.add('ammoload__tile');
      rowEl.append(tile,
        el('div', { class: 'ammoload__info' },
          el('div', { class: 'ammoload__name' }, host === mag ? mag.tpl.name : `${host.tpl.short} — ${mag.tpl.short}`),
          el('div', { class: 'ammoload__stat' }, `${mag.ammoCount}/${mag.tpl.magSize} · ${describeRounds(mag)}`)),
        el('button', {
          class: 'btn btn--sm btn--primary',
          onclick: () => {
            if (opts.timed) { done(); if (opts.timed(mag, [ammo], ammo.stack)) onDone?.(); return; }
            const r = loadAmmo(mag, ammo, ammo.stack);
            done();
            if (r.ok) onDone?.();
          },
        }, `LOAD ${Math.min(ammo.stack, mag.ammoFree)}`));
      list.append(rowEl);
    }
    if (!mags.length) list.append(el('div', { class: 'empty-note' }, 'NO MAGAZINE WITH ROOM TAKES THIS ROUND'));
    box.append(
      el('div', { class: 'modal__head' }, `LOAD ${ammo.tpl.short.toUpperCase()} x${ammo.stack} INTO`),
      el('div', { class: 'modal__body' }, list),
      el('div', { class: 'modal__foot' }, el('button', { class: 'btn', onclick: () => done() }, 'CLOSE')));
  });
}
