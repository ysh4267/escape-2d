// =========================================================
// weapon modding screen
//
// A floating panel like the container windows, laid out the way the game's
// own is: the assembled gun and its numbers on the left, the tree of slots on
// the right. Every slot is a real drop target (`.slot` with `_slot`, the same
// hit-test drag & drop uses for the character's gear), so a part is dragged
// out of the stash straight onto the slot it goes in; clicking a slot lists
// what you own that fits it - and what the traders sell for it, with a BUY &
// INSTALL for the hideout - and, while a slot is picked, the stash dims
// everything that does not fit it. A part is taken off with the cross beside
// it or by dragging it out into a grid.
//
// The stats re-aggregate on every change, with the delta each part
// contributes shown against the bare receiver, so swapping a stock reads
// immediately as "-2 ergo, -8% recoil".
//
// BUILDS opens the game's weapon-presets panel under the tree: the factory's
// builds of this gun and the ones the player saved, each with what is on
// hand / missing / for sale, a stat preview, ASSEMBLE and BUY MISSING.
// =========================================================

import { el, icon, fmtWeight, fmtNum } from '../core/util.js';
import { renderItem } from './view.js';
import { ensureHost, makeDraggable, bringToFront, isLive, registerWindowRefresher, flash } from './window.js';
import { sfx } from '../core/audio.js';
import { emit, EV } from '../core/events.js';
import { dndContext } from './dnd.js';
import { isKnown } from './examine.js';
import { FIRE_MODE_LABEL, modTypeLabel, getTpl, FX } from '../data/items.js';
import { game, isExamined } from '../core/state.js';
import { openModal } from './dialogs.js';
import {
  weaponStats, installMod, uninstallMod, compatibleParts, toggleFold, canFold,
  unloadAmmo, chamberRound, clearChamber, describeRounds, stripWeapon, inRaid,
} from './weapon.js';
import {
  buildsFor, factoryBuilds, saveBuild, deleteBuild, planBuild, shoppingList,
  buyMissing, assembleBuild, previewStats, offersFor, buyOffer,
} from './builds.js';

/** uid -> { item, node, body, pick, builds } */
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

const CUR_SYM = { RUB: '₽', USD: '$', EUR: '€' };
const fmt2 = (v) => { const r = Math.round(v * 100) / 100; return String(r); };

export function openModdingWindow(item, opts = {}) {
  if (!item || !item.hasMods || !isKnown(item)) return null;
  const root = item.root;
  const existing = open.get(root.uid);
  if (existing) {
    if (opts.builds != null) { existing.builds = !!opts.builds; render(existing); }
    bringToFront(existing.node); flash(existing.node); return existing.node;
  }
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
  open.set(root.uid, { item: root, node, body, pick: null, builds: !!opts.builds, buildName: '' });
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
  clearHighlight();
  sfx.modding(false);
}

export function closeAllModdingWindows() {
  for (const uid of Array.from(open.keys())) { open.get(uid).node.remove(); open.delete(uid); }
  clearHighlight();
}

export function refreshModdingWindows() {
  for (const [uid, rec] of Array.from(open.entries())) {
    if (!isLive(rec.item) || !isKnown(rec.item)) { rec.node.remove(); open.delete(uid); continue; }
    render(rec);
  }
  if (!open.size) clearHighlight();
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
        `${typeof delta === 'number' && delta > 0 ? '+' : ''}${delta}`);
      dd.append(d);
    }
    dl.append(el('dt', {}, k), dd);
  };
  const base = item.tpl;
  const wpn = base.wpn || {};
  const isGun = item.isWeapon;
  row('ERGONOMICS', st.ergo, st.ergo - (base.ergo || 0), st.ergo >= (base.ergo || 0));
  if (isGun) {
    row('VERTICAL RECOIL', st.vRecoil, st.recoilPct ? `${st.recoilPct}%` : null, st.recoilPct < 0);
    row('HORIZONTAL RECOIL', st.hRecoil, st.recoilPct ? `${st.recoilPct}%` : null, st.recoilPct < 0);
    if (st.moa != null) row('ACCURACY', `${st.moa} MOA`, st.accPct ? `${st.accPct}%` : null, st.accPct < 0);
    if (st.velocity) row('MUZZLE VELOCITY', `${st.velocity} m/s`, st.velPct ? `${st.velPct}%` : null, st.velPct > 0);
    row('SIGHTING RANGE', `${st.sightRange} m`);
    if (st.zoom) row('MAGNIFICATION', `${st.zoom}x`);
    if (st.effDist) row('EFFECTIVE DISTANCE', `${st.effDist} m`);
    row('FIRE RATE', `${st.rpm} rpm`);
    row('FIRE MODES', st.fire.map((f) => FIRE_MODE_LABEL[f] || f).join(' / ') || '—');
    if (st.cal) row('CALIBER', st.cal);
    const mag = item.magazine;
    row('MAGAZINE', mag ? `${st.magRounds}/${st.magCap}` : 'none');
    if (item.chamber) row('CHAMBER', st.chambered ? (st.ammo?.short || 'loaded') : 'empty');
    if (st.maxDura) row('DURABILITY', `${fmt2(st.dura ?? st.maxDura)} / ${fmt2(st.maxDura)}`);
    if (st.dburn && st.dburn !== 1) row('DURABILITY BURN', `${st.dburn > 1 ? '+' : ''}${Math.round((st.dburn - 1) * 100)}%`);
    if (wpn.malf) row('MALFUNCTION', `${(wpn.malf * 100).toFixed(1)}%`);
  } else {
    if (st.recoilPct) row('RECOIL', `${st.recoilPct}%`);
    if (st.accPct) row('ACCURACY', `${st.accPct}%`);
    if (st.sightRange) row('SIGHTING RANGE', `${st.sightRange} m`);
  }
  row('WEIGHT', `${fmtWeight(st.weight)} kg`);
  row('SIZE', st.size);
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
  const mag = item.magazine;
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
  const showBuilds = rec.builds && isGun && !inRaid;
  if (isGun && !inRaid) {
    acts.append(el('button', {
      class: `btn btn--sm${showBuilds ? ' btn--primary' : ''}`,
      title: showBuilds ? 'Back to the parts tree' : 'Saved and factory builds of this weapon',
      onclick: () => { rec.builds = !rec.builds; rec.pick = null; render(rec); },
    }, showBuilds ? 'PARTS' : 'BUILDS'));
  }
  left.append(acts);
  body.append(left);

  // ---- right: the slot tree, or the builds panel in its place ----
  if (showBuilds) {
    body.append(renderBuilds(rec));
    applyHighlight();
    return;
  }
  const right = el('div', { class: 'mod__tree' });
  renderTree(rec, item, right, 0);
  body.append(right);

  // the compatibility picker for a clicked slot, if one is open
  if (rec.pick && rec.pick.slot) {
    const still = [...walkSlots(item)].includes(rec.pick.slot);
    if (!still) rec.pick = null;
    else {
      const picker = renderPicker(rec, rec.pick.slot);
      body.append(picker);
      // a long tree pushes the picker below the fold: bring it up on a fresh pick
      if (rec.pickFresh) { rec.pickFresh = false; setTimeout(() => picker.scrollIntoView({ block: 'nearest' }), 0); }
    }
  }
  applyHighlight();
}

function* walkSlots(item) {
  if (!item.slots) return;
  for (const sl of item.slots) { yield sl; if (sl.item) yield* walkSlots(sl.item); }
}

/** the short stat line a part shows in the tree and the picker */
function partBits(it) {
  const md = it.tpl.mod || {};
  const bits = [];
  const e = it.tpl.ergo ?? md.ergo;
  if (e) bits.push(`ergo ${e > 0 ? '+' : ''}${e}`);
  if (md.recoil) bits.push(`recoil ${md.recoil > 0 ? '+' : ''}${md.recoil}%`);
  if (md.acc) bits.push(`acc ${md.acc > 0 ? '+' : ''}${md.acc}%`);
  if (md.vel) bits.push(`vel ${md.vel > 0 ? '+' : ''}${md.vel}%`);
  if (md.range) bits.push(`${md.range} m`);
  if (md.zoom) bits.push(`${md.zoom}x`);
  if (md.loud) bits.push(`loud ${md.loud > 0 ? '+' : ''}${md.loud}`);
  if (md.dburn && md.dburn !== 1) bits.push(`burn ${md.dburn > 1 ? '+' : ''}${Math.round((md.dburn - 1) * 100)}%`);
  if (it.isMag) {
    bits.push(`${it.ammoCount}/${it.tpl.magSize} · ${describeRounds(it)}`);
    const mg = it.tpl.mag || {};
    if (mg.load) bits.push(`load ${mg.load > 0 ? '+' : ''}${mg.load}%`);
    if (mg.check) bits.push(`check ${mg.check > 0 ? '+' : ''}${mg.check}%`);
  }
  return bits;
}

function renderTree(rec, item, host, depth) {
  if (!item.slots) return;
  for (const sl of item.slots) {
    const row = el('div', { class: 'mslot-row', dataset: { depth: String(depth) } });
    if (depth) row.classList.add('mslot-row--child');
    if (rec.pick?.slot === sl) row.classList.add('is-picked');
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
      const bits = partBits(sl.item);
      if (inRaid && sl.item.tpl.mod?.noRaidMod) bits.push('locked in raid');
      statNode = el('div', { class: 'mslot-row__stat' }, bits.join(' · '));
    } else {
      box.classList.add('is-empty');
      box.append(el('div', { class: 'slot__hint' }, icon('box')));
      box.title = 'Click for compatible parts, or drop one here';
    }
    box.addEventListener('click', (e) => {
      if (e.target.closest('.item') && sl.item) return;   // clicks on the tile belong to dnd / menu
      rec.pick = rec.pick?.slot === sl ? null : { slot: sl };
      rec.pickFresh = !!rec.pick;
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

// ---------------------------------------------------------
// the picker: what fits the slot - owned, and for sale
// ---------------------------------------------------------
function renderPicker(rec, slot) {
  const box = el('div', { class: 'mod__pick' });
  box.append(el('div', { class: 'mod__pick-head' },
    el('span', {}, `${slot.label.toUpperCase()} — COMPATIBLE PARTS`),
    el('button', { class: 'cwin__close', onclick: () => { rec.pick = null; render(rec); } }, icon('close', 'ico ico--sm'))));
  const list = el('div', { class: 'mod__pick-list' });
  const found = compatibleParts(slot, moddingContext.sources());
  list.append(el('div', { class: 'mod__pick-sub' }, `YOU OWN · ${found.length}`));
  if (!found.length) {
    list.append(el('div', { class: 'empty-note' },
      `NOTHING THAT FITS · ${slot.def.f.length} PART${slot.def.f.length === 1 ? '' : 'S'} EXIST FOR THIS SLOT`));
  }
  for (const { item, check } of found) {
    const rowEl = el('div', { class: `mod__cand${check.ok ? '' : ' is-bad'}` });
    const t = renderItem(item, { static: true, noName: true });
    t.classList.add('mod__cand-tile');
    rowEl.append(t);
    const bits = partBits(item);
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

  // what the traders sell for this slot - the game highlights those on the
  // build screen; here they are listed, and can be bought straight onto the gun
  if (!inRaid) {
    const owned = new Set(found.map((f) => f.item.tplId));
    const forSale = [];
    for (const key of slot.def.f) {
      const offers = offersFor(key);
      if (!offers.length) continue;
      forSale.push({ key, offer: offers[0], known: isExamined(key) || !!getTpl(key)?.known });
    }
    forSale.sort((a, b) => (a.offer.locked - b.offer.locked) || (a.offer.price * (FX[a.offer.cur] || 1)) - (b.offer.price * (FX[b.offer.cur] || 1)));
    if (forSale.length) {
      list.append(el('div', { class: 'mod__pick-sub' }, `SOLD BY TRADERS · ${forSale.length}`));
      for (const { key, offer } of forSale) {
        const tpl = getTpl(key);
        const rowEl = el('div', { class: `mod__cand mod__cand--shop${offer.locked ? ' is-bad' : ''}` });
        const art = el('div', { class: 'mod__cand-tile mod__cand-art' });
        if (tpl.imgUrl) art.append(el('img', { src: tpl.imgUrl, alt: '' }));
        rowEl.append(art);
        const bits = [];
        const md = tpl.mod || {};
        const e = tpl.ergo ?? md.ergo;
        if (e) bits.push(`ergo ${e > 0 ? '+' : ''}${e}`);
        if (md.recoil) bits.push(`recoil ${md.recoil > 0 ? '+' : ''}${md.recoil}%`);
        if (md.acc) bits.push(`acc ${md.acc > 0 ? '+' : ''}${md.acc}%`);
        if (md.range) bits.push(`${md.range} m`);
        if (tpl.magSize) bits.push(`${tpl.magSize} rd`);
        rowEl.append(el('div', { class: 'mod__cand-info' },
          el('div', { class: 'mod__cand-name' }, `${tpl.name}${owned.has(key) ? ' · owned' : ''}`),
          el('div', { class: 'mod__cand-stat' },
            `${offer.trader.name} LL${offer.ll} · ${fmtNum(offer.price)} ${CUR_SYM[offer.cur] || offer.cur}`
            + (offer.locked ? ' · loyalty too low' : offer.stock < 1 ? ' · out of stock' : '')
            + (bits.length ? ` · ${bits.join(' · ')}` : ''))));
        rowEl.append(el('button', {
          class: 'btn btn--sm', disabled: offer.locked || offer.stock < 1,
          title: 'Buy it into the stash and put it on',
          onclick: () => {
            const r = buyOffer(offer, 1, moddingContext.sources());
            if (!r.ok) { toast(r.reason); return; }
            const part = r.items[0];
            const ins = installMod(slot, part, moddingContext.sources());
            if (!ins.ok) toast(`Bought, but not fitted: ${ins.reason}`);
            else toast(`Bought and fitted ${tpl.short}`, 'ok');
            rec.pick = null;
            changed();
          },
        }, 'BUY & INSTALL'));
        list.append(rowEl);
      }
    }
  }
  box.append(list);
  return box;
}

// ---------------------------------------------------------
// stash highlighting while a slot is picked
// ---------------------------------------------------------
let highlighted = false;
function applyHighlight() {
  const picks = [...open.values()].map((r) => r.pick?.slot).filter(Boolean);
  if (!picks.length) { if (highlighted) clearHighlight(); return; }
  highlighted = true;
  const nodes = document.querySelectorAll('.item');
  for (const n of nodes) {
    if (n.closest('.cwin--mod')) continue;
    const it = n._item;
    if (!it || (it.cat !== 'mod' && it.cat !== 'mag')) { n.classList.remove('is-fit', 'is-nofit'); continue; }
    const fits = picks.some((sl) => sl.fits(it) && it !== sl.owner.root);
    n.classList.toggle('is-fit', fits);
    n.classList.toggle('is-nofit', !fits);
  }
  document.body.classList.add('is-modpick');
}
function clearHighlight() {
  if (!highlighted && !document.body.classList.contains('is-modpick')) return;
  highlighted = false;
  document.body.classList.remove('is-modpick');
  for (const n of document.querySelectorAll('.item.is-fit, .item.is-nofit')) n.classList.remove('is-fit', 'is-nofit');
}

// ---------------------------------------------------------
// builds panel
// ---------------------------------------------------------
function renderBuilds(rec) {
  const { item } = rec;
  const box = el('div', { class: 'mod__builds' });
  const cur = weaponStats(item);

  // save the current build under a name
  const nameField = el('input', {
    class: 'mod__build-name', type: 'text', maxlength: '40', placeholder: 'name this build',
    value: rec.buildName || '', spellcheck: 'false', autocomplete: 'off',
  });
  nameField.addEventListener('input', () => { rec.buildName = nameField.value; });
  const doSave = () => {
    const r = saveBuild(item, nameField.value);
    if (!r.ok) { toast(r.reason); return; }
    toast(r.overwrote ? `Build "${r.build.name}" overwritten` : `Build "${r.build.name}" saved`, 'ok');
    rec.buildName = '';
    sfx.ui('click');
    render(rec);
  };
  nameField.addEventListener('keydown', (e) => { if (e.key === 'Enter') doSave(); e.stopPropagation(); });
  box.append(el('div', { class: 'mod__pick-head' },
    el('span', {}, 'WEAPON BUILDS'),
    el('span', { class: 'mod__build-save' }, nameField,
      el('button', { class: 'btn btn--sm btn--primary', onclick: doSave }, 'SAVE CURRENT'))));

  const list = el('div', { class: 'mod__build-list' });
  const rows = [
    ...factoryBuilds(item.tpl).map((b) => ({ ...b, section: 'FACTORY' })),
    ...buildsFor(item.tplId).map((b) => ({ ...b, section: 'SAVED' })),
  ];
  let lastSection = null;
  for (const b of rows) {
    if (b.section !== lastSection) {
      lastSection = b.section;
      list.append(el('div', { class: 'mod__pick-sub' }, b.section === 'FACTORY' ? 'FACTORY BUILDS' : 'YOUR BUILDS'));
    }
    list.append(renderBuildRow(rec, b, cur));
  }
  if (!buildsFor(item.tplId).length) {
    list.append(el('div', { class: 'mod__pick-sub' }, 'YOUR BUILDS'),
      el('div', { class: 'empty-note' }, 'NO SAVED BUILDS FOR THIS WEAPON · NAME THE CURRENT ONE AND SAVE IT'));
  }
  box.append(list);
  return box;
}

function renderBuildRow(rec, b, cur) {
  const { item } = rec;
  const sources = moddingContext.sources();
  const plan = planBuild(item, b.tree, sources);
  const list = plan.complete ? null : shoppingList(plan.missing);
  const pv = previewStats(item.tplId, b.tree);
  const nParts = plan.need.reduce((n, x) => n + x.n, 0);
  const rowEl = el('div', { class: `mod__build${plan.complete ? ' is-ready' : ''}` });

  const info = el('div', { class: 'mod__cand-info' });
  info.append(el('div', { class: 'mod__cand-name' }, b.name, b.factory ? el('small', {}, ' factory') : null));
  const status = plan.complete
    ? `${nParts} parts · all on hand`
    : `${nParts} parts · ${plan.missing.reduce((n, m) => n + m.n, 0)} missing`
      + (list && list.complete ? ` · ${fmtNum(list.totalRub)} ₽ to buy` : list ? ' · not all for sale' : '');
  const statBits = [];
  if (pv) {
    const d = (a, b2) => (a - b2 === 0 ? '' : ` (${a - b2 > 0 ? '+' : ''}${a - b2})`);
    statBits.push(`ergo ${pv.ergo}${d(pv.ergo, cur.ergo)}`);
    statBits.push(`recoil ${pv.vRecoil}/${pv.hRecoil}${d(pv.vRecoil, cur.vRecoil)}`);
    if (pv.moa != null) statBits.push(`${pv.moa} MOA`);
    statBits.push(`${fmtWeight(pv.weight)} kg`);
    statBits.push(pv.size);
  }
  info.append(el('div', { class: 'mod__cand-stat' }, status));
  if (statBits.length) info.append(el('div', { class: 'mod__cand-stat' }, statBits.join(' · ')));
  if (plan.missing.length) {
    info.append(el('div', { class: 'mod__cand-stat mod__build-missing' },
      'missing: ' + plan.missing.map((m) => `${getTpl(m.t)?.short || m.t}${m.n > 1 ? ` x${m.n}` : ''}`).join(', ')));
  }
  rowEl.append(info);

  const acts = el('div', { class: 'mod__build-acts' });
  acts.append(el('button', {
    class: `btn btn--sm${plan.complete ? ' btn--primary' : ''}`, disabled: !plan.complete,
    title: plan.complete ? 'Take the gun to exactly this build' : 'Some parts are missing',
    onclick: () => {
      const r = assembleBuild(item, b.tree, moddingContext.sources());
      if (!r.ok) toast(r.reason === 'missing parts' ? 'Parts are missing' : (r.problems?.[0] || r.reason));
      else toast(`Assembled ${b.name} — ${r.installed} on, ${r.removed} off`, 'ok');
      changed();
    },
  }, 'ASSEMBLE'));
  if (list && list.complete) {
    acts.append(el('button', {
      class: 'btn btn--sm', title: 'Buy every missing part from the traders into the stash',
      onclick: () => {
        const r = buyMissing(list, moddingContext.sources());
        if (!r.ok) toast(r.reason);
        else toast(`Bought ${r.bought.length} part${r.bought.length === 1 ? '' : 's'}`, 'ok');
        changed();
      },
    }, `BUY MISSING · ${fmtNum(list.totalRub)} ₽`));
  }
  if (!b.factory) {
    acts.append(el('button', {
      class: 'btn btn--sm', title: 'Forget this build',
      onclick: () => { deleteBuild(b.id); sfx.ui('click'); render(rec); },
    }, icon('discard', 'ico ico--sm')));
  }
  rowEl.append(acts);
  return rowEl;
}

function toast(text, kind = 'warn') {
  if (!text) return;
  emit(EV.TOAST, { kind, text: text.charAt(0).toUpperCase() + text.slice(1) });
}

/** convenience for tests and menus */
export function moddingWindowOpen(uid) { return open.has(uid); }

/** a name prompt used by menus that save a build without the panel open */
export function saveBuildDialog(item, onDone) {
  openModal((box, done) => {
    const field = el('input', { class: 'mod__build-name', type: 'text', maxlength: '40', placeholder: 'build name', spellcheck: 'false' });
    const accept = () => {
      const r = saveBuild(item, field.value);
      if (!r.ok) { toast(r.reason); return; }
      done();
      toast(r.overwrote ? `Build "${r.build.name}" overwritten` : `Build "${r.build.name}" saved`, 'ok');
      onDone?.();
    };
    field.addEventListener('keydown', (e) => { if (e.key === 'Enter') accept(); e.stopPropagation(); });
    box.classList.add('split');
    box.append(
      el('div', { class: 'modal__head' }, `SAVE BUILD — ${item.tpl.short.toUpperCase()}`),
      el('div', { class: 'modal__body' }, el('div', { class: 'split__row' }, field),
        el('div', { class: 'split__hint' }, `${[...item.allMods()].length} parts on the gun will be remembered`)),
      el('div', { class: 'modal__foot' },
        el('button', { class: 'btn', onclick: () => done() }, 'CANCEL'),
        el('button', { class: 'btn btn--primary', onclick: accept }, 'SAVE')));
    setTimeout(() => field.focus(), 30);
  });
}

/** ?dev hooks: open the screen the captures need */
export function devModding(kind, arg) {
  // the gun the hook spawned last, so the capture shows the one it set up
  const guns = game.stash.items().filter((i) => i.isWeapon);
  const gun = guns[guns.length - 1] || game.equipment.item('primary');
  if (!gun) return;
  if (kind === 'builds') openModdingWindow(gun, { builds: true });
  if (kind === 'pick') {
    openModdingWindow(gun);
    const rec = open.get(gun.root.uid);
    const slot = gun.modSlot(arg || 'mod_muzzle');
    if (rec && slot) { rec.pick = { slot }; rec.pickFresh = true; render(rec); }
  }
}
