// =========================================================
// weapon modding screen
//
// A floating panel like the container windows, laid out the way the game's
// own is: the assembled gun and its numbers on the left, the tree of slots on
// the right. Every slot is a real drop target (`.slot` with `_slot`, the same
// hit-test drag & drop uses for the character's gear), so a part is dragged
// out of the stash straight onto the slot it goes in; clicking a slot lists
// what you own that fits it, and a part is taken off with the cross beside it
// or by dragging it out into a grid.
//
// The stats re-aggregate on every change, with the delta each part
// contributes shown against the bare receiver, so swapping a stock reads
// immediately as "-2 ergo, -8% recoil".
// =========================================================

import { el, icon, fmtWeight } from '../core/util.js';
import { renderItem } from './view.js';
import { ensureHost, makeDraggable, bringToFront, isLive, registerWindowRefresher, flash } from './window.js';
import { sfx } from '../core/audio.js';
import { emit, EV } from '../core/events.js';
import { dndContext } from './dnd.js';
import { isKnown } from './examine.js';
import { FIRE_MODE_LABEL, modTypeLabel } from '../data/items.js';
import {
  weaponStats, installMod, uninstallMod, compatibleParts, toggleFold, canFold,
  unloadAmmo, chamberRound, clearChamber, describeRounds, stripWeapon,
} from './weapon.js';

/** uid -> { item, node, body } */
const open = new Map();
let registered = false;

/**
 * Where the modding screen looks for parts and where removed parts go. The
 * screen sets this: in the hideout it is the stash plus everything worn, in
 * a raid only what is carried.
 */
export const moddingContext = {
  sources: () => [],
};

export function openModdingWindow(item) {
  if (!item || !item.hasMods) return null;
  const root = item.root;
  const existing = open.get(root.uid);
  if (existing) { bringToFront(existing.node); flash(existing.node); return existing.node; }
  if (!registered) { registerWindowRefresher(refreshModdingWindows); registered = true; }

  const layer = ensureHost();
  const node = el('div', { class: 'cwin cwin--mod', dataset: { uid: root.uid } });
  const head = el('div', { class: 'cwin__head' },
    icon('crosshair'),
    el('span', { class: 'cwin__title' }, 'MODDING'),
    el('span', { class: 'cwin__meta' }, ''),
    el('button', {
      class: 'cwin__close', title: 'Close',
      onclick: (e) => { e.stopPropagation(); closeModdingWindow(root.uid); },
    }, icon('close', 'ico ico--sm')));
  const body = el('div', { class: 'cwin__body mod' });
  node.append(head, body);
  const i = open.size % 5;
  node.style.left = `${140 + i * 30}px`;
  node.style.top = `${80 + i * 30}px`;
  makeDraggable(node, head);
  node.addEventListener('pointerdown', () => bringToFront(node), true);
  layer.append(node);
  open.set(root.uid, { item: root, node, body, pick: null });
  bringToFront(node);
  render(open.get(root.uid));
  sfx.modding(true);
  return node;
}

export function closeModdingWindow(uid) {
  const rec = open.get(uid);
  if (!rec) return;
  rec.node.remove();
  open.delete(uid);
  sfx.modding(false);
}

export function closeAllModdingWindows() {
  for (const uid of Array.from(open.keys())) { open.get(uid).node.remove(); open.delete(uid); }
}

export function refreshModdingWindows() {
  for (const [uid, rec] of Array.from(open.entries())) {
    if (!isLive(rec.item) || !isKnown(rec.item)) { rec.node.remove(); open.delete(uid); continue; }
    render(rec);
  }
}

// ---------------------------------------------------------
function changed() {
  dndContext.onChange();
}

function render(rec) {
  const { item, node, body } = rec;
  const st = weaponStats(item);
  body.replaceChildren();
  node.querySelector('.cwin__title').textContent = `MODDING — ${item.tpl.name}`;
  node.querySelector('.cwin__meta').textContent = `${fmtWeight(item.weight)} kg`;

  // ---- left: the gun and its numbers ----
  const left = el('div', { class: 'mod__left' });
  const art = el('div', { class: 'mod__art' });
  const tile = renderItem(item, { static: true });
  tile.style.width = `calc(var(--cell) * ${item.fw} * 0.9)`;
  tile.style.height = `calc(var(--cell) * ${item.fh} * 0.9)`;
  art.append(tile);
  left.append(art);

  if (st.missing.length) {
    left.append(el('div', { class: 'mod__warn' },
      icon('warn', 'ico ico--sm'),
      el('span', {}, `Missing vital parts: ${st.missing.map((s) => s.label).join(', ')}`)));
  }

  const dl = el('dl', { class: 'mod__stats' });
  const row = (k, v, delta = null, good = null) => {
    const dd = el('dd', {}, String(v));
    if (delta != null && delta !== 0) {
      const d = el('span', { class: `mod__delta ${good ? 'is-good' : 'is-bad'}` },
        `${delta > 0 ? '+' : ''}${delta}`);
      dd.append(d);
    }
    dl.append(el('dt', {}, k), dd);
  };
  const base = item.tpl;
  const wpn = base.wpn || {};
  row('ERGONOMICS', st.ergo, st.ergo - (base.ergo || 0), st.ergo >= (base.ergo || 0));
  row('VERTICAL RECOIL', st.vRecoil, st.recoilPct ? `${st.recoilPct}%` : null, st.recoilPct < 0);
  row('HORIZONTAL RECOIL', st.hRecoil, st.recoilPct ? `${st.recoilPct}%` : null, st.recoilPct < 0);
  if (st.moa != null) row('ACCURACY', `${st.moa} MOA`, st.accPct ? `${st.accPct}%` : null, st.accPct < 0);
  if (st.velocity) row('MUZZLE VELOCITY', `${st.velocity} m/s`, st.velPct ? `${st.velPct}%` : null, st.velPct > 0);
  row('SIGHTING RANGE', `${st.sightRange} m`);
  if (st.effDist) row('EFFECTIVE DISTANCE', `${st.effDist} m`);
  row('FIRE RATE', `${st.rpm} rpm`);
  row('FIRE MODES', st.fire.map((f) => FIRE_MODE_LABEL[f] || f).join(' / ') || '—');
  if (st.cal) row('CALIBER', st.cal);
  const mag = item.magazine;
  row('MAGAZINE', mag ? `${st.magRounds}/${st.magCap}` : 'none');
  if (item.chamber) row('CHAMBER', st.chambered ? (st.ammo?.short || 'loaded') : 'empty');
  if (st.maxDura) row('DURABILITY', `${Math.round(st.dura ?? st.maxDura)} / ${st.maxDura}`);
  row('WEIGHT', `${fmtWeight(st.weight)} kg`);
  if (wpn.malf) row('MALFUNCTION', `${(wpn.malf * 100).toFixed(1)}%`);
  left.append(dl);

  // actions on the gun itself
  const acts = el('div', { class: 'mod__actions' });
  const btn = (label, fn, disabled = false, title = '') => el('button', {
    class: 'btn btn--sm', disabled, title,
    onclick: () => { const r = fn(); if (r && r.ok === false) toast(r.reason); changed(); },
  }, label);
  if (wpn.fold) {
    const cf = canFold(item);
    acts.append(btn(item.folded ? 'UNFOLD STOCK' : 'FOLD STOCK', () => toggleFold(item), !cf.ok, cf.reason || ''));
  }
  if (mag) {
    acts.append(btn('UNLOAD AMMO', () => unloadAmmo(item, moddingContext.sources()), mag.ammoCount === 0));
    if (!item.modSlot('mod_magazine')?.required) {
      acts.append(btn('REMOVE MAG', () => uninstallMod(item.modSlot('mod_magazine'), moddingContext.sources())));
    }
  }
  if (item.chamber) {
    if (item.chamber.length) acts.append(btn('CLEAR CHAMBER', () => clearChamber(item, moddingContext.sources())));
    else acts.append(btn('CHAMBER A ROUND', () => chamberRound(item), !mag || mag.ammoCount === 0));
  }
  acts.append(btn('STRIP ALL PARTS', () => {
    const n = stripWeapon(item, moddingContext.sources()).length;
    return n ? { ok: true } : { ok: false, reason: 'no room to strip into' };
  }, ![...item.allMods()].length));
  left.append(acts);
  body.append(left);

  // ---- right: the slot tree ----
  const right = el('div', { class: 'mod__tree' });
  renderTree(rec, item, right, 0);
  body.append(right);

  // the compatibility picker for a clicked slot, if one is open
  if (rec.pick && rec.pick.slot) {
    const still = [...walkSlots(item)].includes(rec.pick.slot);
    if (!still) rec.pick = null;
    else body.append(renderPicker(rec, rec.pick.slot));
  }
}

function* walkSlots(item) {
  if (!item.slots) return;
  for (const sl of item.slots) { yield sl; if (sl.item) yield* walkSlots(sl.item); }
}

function renderTree(rec, item, host, depth) {
  if (!item.slots) return;
  for (const sl of item.slots) {
    const row = el('div', { class: 'mslot-row', dataset: { depth: String(depth) } });
    if (depth) row.classList.add('mslot-row--child');
    const name = el('div', { class: 'mslot-row__name', style: { paddingLeft: `${depth * 14}px` } },
      el('span', {}, (depth ? '└ ' : '') + sl.label.toUpperCase()),
      sl.required ? el('i', { class: 'mslot-row__req', title: 'Vital part' }, '*') : null);
    if (sl.item) name.append(el('small', {}, isKnown(sl.item) ? sl.item.tpl.short : '?'));
    row.append(name);
    let statNode = null;

    // the drop target — a real .slot with a ModSlot on it
    const box = el('div', { class: 'slot mslot', dataset: { slot: sl.name } });
    box._slot = sl;
    if (sl.item) {
      const t = renderItem(sl.item, { static: true, noName: true });
      t.classList.add('mslot__tile');
      box.append(t);
      // whether this part carries stats worth showing
      const md = sl.item.tpl.mod || {};
      const bits = [];
      const e = sl.item.tpl.ergo ?? md.ergo;
      if (e) bits.push(`ergo ${e > 0 ? '+' : ''}${e}`);
      if (md.recoil) bits.push(`recoil ${md.recoil > 0 ? '+' : ''}${md.recoil}%`);
      if (md.acc) bits.push(`acc ${md.acc > 0 ? '+' : ''}${md.acc}%`);
      if (md.vel) bits.push(`vel ${md.vel > 0 ? '+' : ''}${md.vel}%`);
      if (md.range) bits.push(`${md.range} m`);
      if (sl.item.isMag) bits.push(`${sl.item.ammoCount}/${sl.item.tpl.magSize} · ${describeRounds(sl.item)}`);
      statNode = el('div', { class: 'mslot-row__stat' }, bits.join(' · '));
    } else {
      box.classList.add('is-empty');
      box.append(el('div', { class: 'slot__hint' }, icon('box')));
      box.title = 'Click for compatible parts, or drop one here';
    }
    box.addEventListener('click', (e) => {
      if (e.target.closest('.item') && sl.item) return;   // clicks on the tile belong to dnd / menu
      rec.pick = rec.pick?.slot === sl ? null : { slot: sl };
      render(rec);
    });
    row.append(box, statNode || el('div', { class: 'mslot-row__stat' }, sl.required && !sl.item ? 'vital part missing' : ''));

    if (sl.item) {
      row.append(el('button', {
        class: 'mslot-row__x', title: 'Remove',
        onclick: (e) => {
          e.stopPropagation();
          const r = uninstallMod(sl, moddingContext.sources());
          if (!r.ok) toast(r.reason);
          changed();
        },
      }, icon('close', 'ico ico--sm')));
    }
    host.append(row);
    if (sl.item) renderTree(rec, sl.item, host, depth + 1);
  }
}

function renderPicker(rec, slot) {
  const box = el('div', { class: 'mod__pick' });
  box.append(el('div', { class: 'mod__pick-head' },
    el('span', {}, `${slot.label.toUpperCase()} — COMPATIBLE PARTS YOU OWN`),
    el('button', { class: 'cwin__close', onclick: () => { rec.pick = null; render(rec); } }, icon('close', 'ico ico--sm'))));
  const list = el('div', { class: 'mod__pick-list' });
  const found = compatibleParts(slot, moddingContext.sources());
  if (!found.length) {
    list.append(el('div', { class: 'empty-note' },
      `NOTHING THAT FITS · ${slot.def.f.length} PART${slot.def.f.length === 1 ? '' : 'S'} EXIST FOR THIS SLOT`));
  }
  for (const { item, check } of found) {
    const rowEl = el('div', { class: `mod__cand${check.ok ? '' : ' is-bad'}` });
    const t = renderItem(item, { static: true, noName: true });
    t.classList.add('mod__cand-tile');
    rowEl.append(t);
    const md = item.tpl.mod || {};
    const bits = [];
    const e = item.tpl.ergo ?? md.ergo;
    if (e) bits.push(`ergo ${e > 0 ? '+' : ''}${e}`);
    if (md.recoil) bits.push(`recoil ${md.recoil > 0 ? '+' : ''}${md.recoil}%`);
    if (md.acc) bits.push(`acc ${md.acc > 0 ? '+' : ''}${md.acc}%`);
    if (item.isMag) bits.push(`${item.tpl.magSize} rd · ${item.ammoCount} loaded`);
    rowEl.append(el('div', { class: 'mod__cand-info' },
      el('div', { class: 'mod__cand-name' }, isKnown(item) ? item.tpl.name : 'Unknown item'),
      el('div', { class: 'mod__cand-stat' }, check.ok ? (bits.join(' · ') || modTypeLabel(item.tpl)) : check.reason)));
    rowEl.append(el('button', {
      class: 'btn btn--sm btn--primary', disabled: !check.ok,
      onclick: () => {
        const r = installMod(slot, item, moddingContext.sources());
        if (!r.ok) toast(r.reason);
        rec.pick = null;
        changed();
      },
    }, 'INSTALL'));
    list.append(rowEl);
  }
  box.append(list);
  return box;
}

function toast(text) {
  if (!text) return;
  emit(EV.TOAST, { kind: 'warn', text: text.charAt(0).toUpperCase() + text.slice(1) });
}

/** convenience for tests and menus */
export function moddingWindowOpen(uid) { return open.has(uid); }
