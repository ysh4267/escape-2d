// =========================================================
// weapon modding screen
//
// The game's own WEAPON MODDING screen, as it is (0.14): a full-screen view
// with the gun large in the middle, its slots hung around it as small boxes
// joined to their pins on the gun by thin lines - a box per slot with the
// part's icon and short name in it, NONE when empty, sub-slots branching off
// the part they sit on - the numbers in a table bottom-left (durability,
// weight, ergonomics, accuracy, sighting range, recoil, velocity, fire modes,
// calibre, fire rate, effective distance), three filters under the title
// (Vital parts / Functional mods / Gear mods) that hide whole families of
// slots, PRESETS on the bar and BACK bottom-right.
//
// Clicking a slot box drops down what you own that fits it (and what the
// traders sell for it, with BUY & INSTALL in the hideout); hovering a
// candidate previews the numbers it would give. Every box is a real drop
// target too (`.slot` with `_slot`, the same hit-test the drag layer uses),
// and a part comes off with the cross on its box or through its own menu.
//
// The 3D viewer (viewer3d.js) is parked: nothing here loads it. The stage
// shows the large render of the gun's factory preset; the boxes are the
// truth about what is on it.
// =========================================================

import { el, icon, fmtWeight, fmtNum, clamp } from '../core/util.js';
import { renderItem } from './view.js';
import { isLive, registerWindowRefresher } from './window.js';
import { sfx } from '../core/audio.js';
import { emit, EV } from '../core/events.js';
import { dndContext } from './dnd.js';
import { isKnown } from './examine.js';
import { FIRE_MODE_LABEL, modTypeLabel, getTpl, FX } from '../data/items.js';
import { game, isExamined } from '../core/state.js';
import { openModal } from './dialogs.js';
import { Item } from './model.js';
import {
  weaponStats, installMod, uninstallMod, compatibleParts, toggleFold, canFold,
  unloadAmmo, chamberRound, clearChamber, describeRounds, stripWeapon, inRaid,
} from './weapon.js';
import {
  buildsFor, factoryBuilds, saveBuild, deleteBuild, planBuild, shoppingList,
  buyMissing, assembleBuild, previewStats, offersFor, buyOffer,
} from './builds.js';

/** the 3D viewer is parked for now: no button, nothing loaded */
const VIEW3D = false;

/** uid -> rec; one screen at a time, kept as a map for the callers that ask by uid */
const open = new Map();
let registered = false;
let resizeBound = false;

/**
 * Where the modding screen looks for parts and where removed parts go. The
 * screen sets this: in the hideout it is the stash plus everything worn, in
 * a raid only what is carried.
 */
export const moddingContext = {
  sources: () => [],
};

/** the three filters under the title, remembered across screens */
const FILTERS = { vital: true, functional: true, gear: true };

const CUR_SYM = { RUB: '₽', USD: '$', EUR: '€' };
const fmt2 = (v) => String(Math.round(v * 100) / 100);

// ---------------------------------------------------------
// the slot families and where their pins sit on the gun
// ---------------------------------------------------------
/** slot -> the family the filters know it by (a required slot is vital regardless) */
function familyOf(slot) {
  if (slot.required) return 'vital';
  const n = slot.name;
  if (/^mod_(magazine|stock|mount|launcher|charge|equipment)/.test(n)) return 'gear';
  return 'functional';
}

/** the boxes of these families hang under the gun; everything else above */
const BELOW = /^mod_(magazine|pistol_grip|launcher|foregrip|bipod|tactical|mag_shaft)/;

/** the slot-type placeholder icons the game draws over an empty box */
const SLOT_ICON = {
  mod_barrel: 'barrel', mod_bipod: 'bipod', mod_charge: 'charge', mod_equipment: 'equipment', mod_foregrip: 'foregrip',
  mod_gas_block: 'gas_block', mod_handguard: 'handguard', mod_launcher: 'launcher', mod_magazine: 'magazine',
  mod_mount: 'mount', mod_muzzle: 'muzzle', mod_nvg: 'nvg', mod_pistol_grip: 'pistol_grip', mod_reciever: 'reciever',
  mod_scope: 'scope', mod_sight_front: 'sight_front', mod_sight_rear: 'sight_rear', mod_stock: 'stock', mod_tactical: 'tactical',
};
function slotIcon(slot) {
  const base = slot.name.replace(/_\d+$/, '');
  const k = SLOT_ICON[base] || SLOT_ICON[Object.keys(SLOT_ICON).find((s) => base.startsWith(s))] || null;
  return k ? `assets/ui/slots/mod_${k}.png` : null;
}

/**
 * Where a top-level slot's pin sits on the preset render, as fractions of the
 * image box, by the shape of the gun. The renders all point the muzzle
 * left; a rifle's receiver sits a little right of centre, a pistol's slide
 * runs along the top, a tube shotgun's magazine is under the barrel.
 */
const ANCHORS = {
  rifle: {
    mod_muzzle: [0.035, 0.44], mod_barrel: [0.17, 0.46], mod_sight_front: [0.13, 0.33], mod_gas_block: [0.31, 0.42],
    mod_handguard: [0.41, 0.55], mod_reciever: [0.68, 0.33], mod_sight_rear: [0.50, 0.30], mod_scope: [0.63, 0.25],
    mod_charge: [0.75, 0.42], mod_magazine: [0.55, 0.76], mod_pistol_grip: [0.665, 0.70], mod_stock: [0.90, 0.46],
    mod_launcher: [0.42, 0.68], mod_foregrip: [0.42, 0.66], mod_mount: [0.60, 0.47], mod_tactical: [0.36, 0.60],
    mod_equipment: [0.5, 0.5], mod_bipod: [0.3, 0.63], mod_nvg: [0.6, 0.25],
  },
  pistol: {
    mod_muzzle: [0.33, 0.24], mod_barrel: [0.40, 0.24], mod_reciever: [0.50, 0.22], mod_sight_front: [0.36, 0.17],
    mod_sight_rear: [0.62, 0.17], mod_magazine: [0.60, 0.88], mod_pistol_grip: [0.63, 0.58], mod_tactical: [0.40, 0.42],
    mod_mount: [0.42, 0.38], mod_stock: [0.72, 0.45], mod_charge: [0.66, 0.24], mod_scope: [0.5, 0.15],
  },
  smg: {
    mod_muzzle: [0.06, 0.44], mod_barrel: [0.2, 0.45], mod_sight_front: [0.15, 0.34], mod_reciever: [0.55, 0.40],
    mod_sight_rear: [0.5, 0.33], mod_scope: [0.55, 0.28], mod_charge: [0.66, 0.42], mod_magazine: [0.5, 0.78],
    mod_pistol_grip: [0.62, 0.66], mod_stock: [0.86, 0.38], mod_mount: [0.45, 0.36], mod_tactical: [0.3, 0.6],
    mod_handguard: [0.32, 0.5], mod_gas_block: [0.28, 0.44],
  },
  shotgun: {
    mod_muzzle: [0.025, 0.46], mod_barrel: [0.18, 0.46], mod_handguard: [0.38, 0.56], mod_magazine: [0.28, 0.63],
    mod_reciever: [0.60, 0.46], mod_sight_rear: [0.62, 0.35], mod_scope: [0.62, 0.30], mod_mount: [0.6, 0.35],
    mod_stock: [0.87, 0.5], mod_pistol_grip: [0.72, 0.63], mod_charge: [0.63, 0.56], mod_tactical: [0.35, 0.63],
    mod_launcher: [0.4, 0.66], mod_sight_front: [0.08, 0.36], mod_gas_block: [0.3, 0.44],
  },
};
/** guns whose render does not read like their class */
const ANCHOR_SHAPE = { w_saiga: 'rifle', w_kedr: 'smg', w_kedrb: 'smg', w_pb: 'pistol', w_pm: 'pistol', w_tt: 'pistol' };
function anchorsFor(item) {
  const cls = item.tpl.wpn?.cls || '';
  const shape = ANCHOR_SHAPE[item.tpl.key] || (cls === 'pistol' ? 'pistol' : cls === 'smg' ? 'smg' : cls === 'shotgun' ? 'shotgun' : 'rifle');
  return ANCHORS[shape];
}
function anchorOf(item, slot) {
  const table = anchorsFor(item);
  const base = slot.name.replace(/_\d+$/, '');
  const a = table[base] || table[Object.keys(table).find((k) => base.startsWith(k))] || [0.5, 0.5];
  // mod_mount_000 / _001 / ... share a pin: step them along the gun
  const n = /_(\d+)$/.exec(slot.name);
  return n ? [a[0] + parseInt(n[1], 10) * 0.05, a[1]] : a;
}
/** how much of the stage's width the render takes, by shape (a pistol's render is mostly margin) */
const SHAPE_SCALE = { pistol: 0.75, smg: 0.9 };

// ---------------------------------------------------------
// open / close
// ---------------------------------------------------------
export function openModdingWindow(item, opts = {}) {
  if (!item || !item.hasMods || !isKnown(item)) return null;
  const root = item.root;
  const existing = open.get(root.uid);
  if (existing) {
    if (opts.builds != null) { existing.builds = !!opts.builds; render(existing); }
    return existing.node;
  }
  // one screen at a time: another gun's screen gives way
  for (const uid of Array.from(open.keys())) closeModdingWindow(uid, { quiet: true });
  if (!registered) { registerWindowRefresher(refreshModdingWindows); registered = true; }
  if (!resizeBound) {
    resizeBound = true;
    let t = 0;
    window.addEventListener('resize', () => { clearTimeout(t); t = setTimeout(() => { for (const r of open.values()) render(r); }, 80); });
    document.addEventListener('keydown', onKey, true);
  }

  const node = el('div', { class: 'modscreen', dataset: { uid: root.uid } });
  document.body.append(node);
  const rec = {
    item: root, node, pick: null, builds: !!opts.builds, buildName: '', hover: null, imgSize: null,
  };
  open.set(root.uid, rec);
  render(rec);
  sfx.modding(true);
  return node;
}

export function closeModdingWindow(uid, { quiet = false } = {}) {
  const rec = open.get(uid);
  if (!rec) return;
  rec.node.remove();
  open.delete(uid);
  if (!quiet) sfx.modding(false);
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

/** is a modding screen up (the raid's key handler stands aside while it is) */
export function moddingScreenOpen() { return open.size > 0; }

function onKey(e) {
  if (!open.size) return;
  if (e.target.tagName === 'INPUT') { if (e.key === 'Escape') e.target.blur(); return; }
  if (e.key === 'Escape') {
    // a modal above the screen owns Escape
    const modal = document.getElementById('modal-root');
    if (modal && !modal.hidden) return;
    e.stopPropagation();
    e.preventDefault();
    const rec = [...open.values()][0];
    if (rec.pick) { rec.pick = null; render(rec); return; }
    if (rec.builds) { rec.builds = false; render(rec); return; }
    closeModdingWindow(rec.item.uid);
  }
}

// ---------------------------------------------------------
function changed() {
  dndContext.onChange();
}

/**
 * The whole screen, rebuilt: title, filters, the stage with the gun and its
 * slot boxes, the stats table, the bar. Rebuilding on every change is cheap
 * at this size and keeps every box a fresh, correct drop target.
 */
function render(rec) {
  const { item, node } = rec;
  const st = weaponStats(item);
  const isGun = item.isWeapon;
  node.replaceChildren();
  node.append(el('div', { class: 'modscreen__bg' }));

  // ---- title and filters ----
  node.append(el('header', { class: 'modscreen__head' },
    el('div', { class: 'modscreen__title' },
      icon('crosshair', 'ico ico--lg'),
      el('div', {}, el('h1', {}, isGun ? 'WEAPON MODDING' : 'MODDING'), el('div', { class: 'modscreen__sub' }, item.tpl.name))),
    el('div', { class: 'modscreen__filters' },
      filterBox(rec, 'vital', 'Vital parts'),
      filterBox(rec, 'functional', 'Functional mods'),
      filterBox(rec, 'gear', 'Gear mods'))));

  // ---- the stage ----
  const stage = el('div', { class: 'modscreen__stage' });
  node.append(stage);
  rec.stage = stage;

  // ---- the numbers ----
  node.append(renderStats(rec, st));

  // ---- the bar: actions on the gun, presets, back ----
  node.append(renderBar(rec, st));

  if (rec.builds && isGun && !inRaid) node.append(renderBuilds(rec));

  // the stage needs its size; lay it out once it is in the document
  layoutStage(rec);
}

function filterBox(rec, key, label) {
  const cb = el('input', { type: 'checkbox' });
  cb.checked = FILTERS[key];
  cb.addEventListener('change', () => { FILTERS[key] = cb.checked; sfx.ui('click'); render(rec); });
  return el('label', { class: 'modscreen__filter' }, cb, el('span', {}, label));
}

// ---------------------------------------------------------
// the stage: the gun, its pins, the boxes and the lines between them
// ---------------------------------------------------------
const BOX = 74;          // a slot box, px
const GAP = 14;          // between boxes in a lane
const LANE = 108;        // between lanes
const PIN_CLEAR = 34;    // from the gun's edge to the first lane

function layoutStage(rec) {
  const { item, stage } = rec;
  stage.replaceChildren();
  const rect = stage.getBoundingClientRect();
  if (rect.width < 50 || rect.height < 50) { requestAnimationFrame(() => layoutStage(rec)); return; }
  const W = rect.width, H = rect.height;

  // ---- the render of the gun ----
  const tpl = item.tpl;
  const src = item.isWeapon ? (tpl.presetLgUrl || tpl.presetImgUrl || tpl.imgUrl) : tpl.imgUrl;
  const aspect = rec.imgSize ? rec.imgSize[0] / rec.imgSize[1] : (tpl.presetSize ? tpl.presetSize[0] / tpl.presetSize[1] : 2.5);
  // how deep the tree goes above and below decides how much room the gun gets
  const tree = collectBoxes(rec);
  const lanesUp = tree.reduce((n, b) => (b.side === 'top' ? Math.max(n, b.depth + 1) : n), 0);
  const lanesDown = tree.reduce((n, b) => (b.side === 'bottom' ? Math.max(n, b.depth + 1) : n), 0);
  const roomUp = lanesUp ? PIN_CLEAR + lanesUp * LANE : 20;
  const roomDown = lanesDown ? PIN_CLEAR + lanesDown * LANE : 20;
  const shape = ANCHOR_SHAPE[item.tpl.key] || (item.tpl.wpn?.cls === 'pistol' ? 'pistol' : item.tpl.wpn?.cls === 'smg' ? 'smg' : 'rifle');
  let gw = Math.min(W * 0.6, 1180) * (SHAPE_SCALE[shape] || 1);
  let gh = gw / aspect;
  const maxH = Math.max(160, H - roomUp - roomDown);
  if (gh > maxH) { gh = maxH; gw = gh * aspect; }
  const gx = (W - gw) / 2;
  // sit the gun where the lanes leave it room, centred when there is spare
  const spare = H - roomUp - roomDown - gh;
  const gy = roomUp + Math.max(0, spare) / 2;
  const gun = { x: gx, y: gy, w: gw, h: gh };

  const img = el('img', { class: 'modscreen__gun', src, alt: '', draggable: 'false' });
  img.style.left = `${gx}px`; img.style.top = `${gy}px`; img.style.width = `${gw}px`; img.style.height = `${gh}px`;
  if (!rec.imgSize) {
    img.addEventListener('load', () => {
      if (img.naturalWidth && img.naturalHeight) { rec.imgSize = [img.naturalWidth, img.naturalHeight]; layoutStage(rec); }
    }, { once: true });
  }
  stage.append(img);

  // ---- boxes: pins on the gun, lanes above and below ----
  for (const b of tree) {
    if (b.depth === 0) {
      const [ax, ay] = anchorOf(item, b.slot);
      b.pin = [gun.x + ax * gun.w, gun.y + ay * gun.h];
      b.tx = b.pin[0];
    }
  }
  const laneY = (side, depth) => (side === 'top'
    ? gun.y - PIN_CLEAR - (depth + 1) * LANE + (LANE - BOX) / 2
    : gun.y + gun.h + PIN_CLEAR + depth * LANE + (LANE - BOX) / 2 - 10);
  // children want to sit under their parent, fanned out
  const byDepth = [...tree].sort((a, b) => a.depth - b.depth);
  for (const b of byDepth) {
    if (b.depth === 0) continue;
    const sibs = b.parent.children;
    const i = sibs.indexOf(b);
    b.tx = b.parent.tx + (i - (sibs.length - 1) / 2) * (BOX + GAP);
  }
  // resolve overlaps lane by lane
  const lanes = new Map();
  for (const b of tree) {
    const k = `${b.side}:${b.depth}`;
    if (!lanes.has(k)) lanes.set(k, []);
    lanes.get(k).push(b);
  }
  for (const [k, list] of lanes) {
    const [side, depthS] = k.split(':');
    const y = clamp(laneY(side, +depthS), 6, H - BOX - 6);
    list.sort((a, b) => a.tx - b.tx);
    // left to right, then pull the whole lane back toward where it wanted to be
    let x = -Infinity;
    for (const b of list) { b.x = Math.max(b.tx - BOX / 2, x + GAP); x = b.x + BOX; }
    const drift = list.reduce((n, b) => n + (b.x - (b.tx - BOX / 2)), 0) / list.length;
    for (const b of list) { b.x -= drift; b.y = y; }
    // and inside the stage
    const minX = 8, maxX = W - BOX - 8;
    const first = list[0].x, last = list[list.length - 1].x;
    if (first < minX) for (const b of list) b.x += minX - first;
    else if (last > maxX) for (const b of list) b.x -= last - maxX;
    for (const b of list) b.x = clamp(b.x, minX, maxX);
    // the pull may have re-overlapped a crowded lane: one more sweep
    x = -Infinity;
    for (const b of list) { b.x = Math.max(b.x, x + GAP); x = b.x + BOX; }
  }

  // ---- lines and pins ----
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'modscreen__lines');
  svg.setAttribute('width', W); svg.setAttribute('height', H);
  const line = (x1, y1, x2, y2, cls) => {
    const l = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    l.setAttribute('x1', x1); l.setAttribute('y1', y1); l.setAttribute('x2', x2); l.setAttribute('y2', y2);
    l.setAttribute('class', cls);
    svg.append(l);
    return l;
  };
  for (const b of tree) {
    const filled = !!b.slot.item;
    const cls = `modline${filled ? ' is-filled' : ''}${b.slot.required && !filled ? ' is-vital' : ''}${rec.pick?.slot === b.slot ? ' is-picked' : ''}`;
    const bx = b.x + BOX / 2;
    const near = b.side === 'top' ? b.y + BOX : b.y;   // the box edge facing the gun
    if (b.depth === 0) {
      b.line = line(b.pin[0], b.pin[1], bx, near, cls);
    } else {
      const px = b.parent.x + BOX / 2;
      const py = b.side === 'top' ? b.parent.y : b.parent.y + BOX;
      b.line = line(px, py, bx, near, cls);
    }
  }
  stage.append(svg);
  const pinned = tree.filter((b) => b.depth === 0).sort((a, b) => a.pin[0] - b.pin[0]);
  pinned.forEach((b, i) => {
    const filled = !!b.slot.item;
    // labels alternate above and below along the gun so neighbours do not collide
    const pin = el('div', {
      class: `modpin${filled ? ' is-filled' : ''}${b.slot.required && !filled ? ' is-vital' : ''} ${i % 2 ? 'is-down' : 'is-up'}`,
      title: b.slot.label,
    }, el('i'), el('span', {}, b.slot.label.toUpperCase()));
    pin.style.left = `${b.pin[0]}px`; pin.style.top = `${b.pin[1]}px`;
    pin.addEventListener('click', () => togglePick(rec, b.slot));
    stage.append(pin);
  });

  // ---- the boxes ----
  for (const b of tree) stage.append(renderBox(rec, b));

  // ---- the dropdown for a picked slot ----
  if (rec.pick && rec.pick.slot) {
    const b = tree.find((x) => x.slot === rec.pick.slot);
    if (!b) rec.pick = null;
    else stage.append(renderPicker(rec, b, { W, H }));
  }
}

/**
 * The slots to show, as a flat list of box records with parent links: every
 * slot of the gun, then of each part, in tree order, minus the families the
 * filters hide (a hidden family takes its subtree with it).
 */
function collectBoxes(rec) {
  const out = [];
  const walk = (holder, parent, depth, side) => {
    if (!holder.slots) return;
    for (const sl of holder.slots) {
      if (!FILTERS[familyOf(sl)]) continue;
      const s = parent ? parent.side : (BELOW.test(sl.name) ? 'bottom' : 'top');
      const b = { slot: sl, depth, side: s, parent, children: [], tx: 0, x: 0, y: 0 };
      out.push(b);
      if (parent) parent.children.push(b);
      if (sl.item) walk(sl.item, b, depth + 1, s);
    }
    void side;
  };
  walk(rec.item, null, 0, 'top');
  return out;
}

function togglePick(rec, slot) {
  rec.pick = rec.pick?.slot === slot ? null : { slot };
  rec.hover = null;
  sfx.ui('click');
  render(rec);
}

/** one slot box: the part in it (or NONE), its short name, the type icon over it */
function renderBox(rec, b) {
  const sl = b.slot;
  const box = el('div', {
    class: `modbox slot${sl.item ? '' : ' is-empty'}${sl.required && !sl.item ? ' is-vital' : ''}${rec.pick?.slot === sl ? ' is-picked' : ''}`,
    dataset: { slot: sl.name },
    title: sl.item ? (isKnown(sl.item) ? sl.item.tpl.name : 'Unknown item') : `${sl.label} — click for compatible parts, or drop one here`,
  });
  box._slot = sl;
  box.style.left = `${b.x}px`; box.style.top = `${b.y}px`;
  const ic = slotIcon(sl);
  if (ic) box.append(el('img', { class: 'modbox__type', src: ic, alt: '', draggable: 'false' }));
  if (sl.item) {
    const t = renderItem(sl.item, { static: true, noName: true });
    t.classList.add('modbox__tile');
    box.append(t);
    // the sprite carries its own short name in the corner, as the game's do;
    // only an unexamined part needs a word over it
    if (!isKnown(sl.item)) box.append(el('span', { class: 'modbox__name' }, '?'));
    if (sl.item.isMag) box.append(el('span', { class: 'modbox__count' }, `${sl.item.ammoCount}/${sl.item.tpl.magSize}`));
    box.append(el('button', {
      class: 'modbox__x', title: inRaid && sl.item.tpl.mod?.noRaidMod ? 'Cannot be removed in raid' : 'Remove',
      onclick: (e) => {
        e.stopPropagation();
        const r = uninstallMod(sl, moddingContext.sources());
        if (!r.ok) toast(r.reason);
        else sfx.ui('click');
        changed();
      },
    }, icon('close', 'ico ico--sm')));
  } else {
    box.append(el('span', { class: 'modbox__name' }, 'NONE'));
  }
  box.append(el('span', { class: 'modbox__label' }, sl.label.toUpperCase()));
  box.addEventListener('click', (e) => {
    if (e.target.closest('.modbox__x')) return;
    if (e.target.closest('.item') && sl.item && e.detail > 1) return;   // a double-click on the tile is its own thing
    togglePick(rec, sl);
  });
  box.addEventListener('mouseenter', () => { b.line?.classList.add('is-hover'); });
  box.addEventListener('mouseleave', () => { b.line?.classList.remove('is-hover'); });
  return box;
}

/** the short stat line a part shows in the dropdown */
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
  }
  return bits;
}

// ---------------------------------------------------------
// the dropdown: what fits the slot - owned, and for sale
// ---------------------------------------------------------
function renderPicker(rec, b, { W, H }) {
  const slot = b.slot;
  const box = el('div', { class: 'modpick' });
  box.append(el('div', { class: 'modpick__head' },
    el('span', {}, `${slot.label.toUpperCase()} — COMPATIBLE`),
    el('button', { class: 'cwin__close', onclick: () => { rec.pick = null; render(rec); } }, icon('close', 'ico ico--sm'))));
  const list = el('div', { class: 'modpick__list' });
  const found = compatibleParts(slot, moddingContext.sources());
  list.append(el('div', { class: 'mod__pick-sub' }, `YOU OWN · ${found.length}`));
  if (!found.length) {
    list.append(el('div', { class: 'empty-note' },
      `NOTHING THAT FITS · ${slot.def.f.length} PART${slot.def.f.length === 1 ? '' : 'S'} EXIST FOR THIS SLOT`));
  }
  const preview = (part) => { rec.hover = { slot, part }; updateStats(rec); };
  const unpreview = () => { rec.hover = null; updateStats(rec); };
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
      onclick: (e) => {
        e.stopPropagation();
        const r = installMod(slot, item, moddingContext.sources());
        if (!r.ok) toast(r.reason);
        else sfx.ui('click');
        rec.pick = null; rec.hover = null;
        changed();
      },
    }, 'INSTALL'));
    if (check.ok) {
      rowEl.addEventListener('mouseenter', () => preview(item));
      rowEl.addEventListener('mouseleave', unpreview);
    }
    list.append(rowEl);
  }

  // what the traders sell for this slot, bought straight onto the gun
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
          onclick: (e) => {
            e.stopPropagation();
            const r = buyOffer(offer, 1, moddingContext.sources());
            if (!r.ok) { toast(r.reason); return; }
            const part = r.items[0];
            const ins = installMod(slot, part, moddingContext.sources());
            if (!ins.ok) toast(`Bought, but not fitted: ${ins.reason}`);
            else toast(`Bought and fitted ${tpl.short}`, 'ok');
            rec.pick = null; rec.hover = null;
            changed();
          },
        }, 'BUY & INSTALL'));
        // the preview reads the template through a throwaway item
        rowEl.addEventListener('mouseenter', () => preview(new Item(key)));
        rowEl.addEventListener('mouseleave', unpreview);
        list.append(rowEl);
      }
    }
  }
  box.append(list);

  // under the box, or over it when the bottom of the stage is near; over
  // the stats table (bottom-left) the list stops short of it
  const PW = 360, STATS_W = 410, STATS_H = 340;
  const x = clamp(b.x + BOX / 2 - PW / 2, 8, W - PW - 8);
  const floor = x < STATS_W ? H - STATS_H : H;
  box.style.left = `${x}px`;
  const below = b.y + BOX + 8;
  if (floor - below >= 220) { box.style.top = `${below}px`; box.style.maxHeight = `${floor - below - 8}px`; }
  else { box.style.bottom = `${H - b.y + 8}px`; box.style.maxHeight = `${Math.max(160, b.y - 16)}px`; box.classList.add('is-above'); }
  box.addEventListener('click', (e) => e.stopPropagation());
  return box;
}

// ---------------------------------------------------------
// the numbers, bottom-left
// ---------------------------------------------------------
/** rows the game's table has, in its order; `bar` rows draw a fill behind the value */
function statRows(item, st) {
  const isGun = item.isWeapon;
  const rows = [];
  if (isGun && st.tplMaxDura) rows.push({ k: 'dura', icon: 'wrench', label: 'DURABILITY', v: st.dura ?? st.maxDura, text: `${fmt2(st.dura ?? st.maxDura)}/${fmt2(st.maxDura)} (${fmt2(st.tplMaxDura)})` });
  rows.push({ k: 'weight', icon: 'weight', label: 'WEIGHT', v: st.weight, text: fmtWeight(st.weight), better: 'down' });
  rows.push({ k: 'ergo', icon: 'ergo', label: 'ERGONOMICS', v: st.ergo, text: String(st.ergo), bar: st.ergo / 100, better: 'up' });
  if (isGun) {
    if (st.moa != null) rows.push({ k: 'moa', icon: 'acc', label: 'ACCURACY', v: st.moa, text: `${st.moa} MOA`, better: 'down' });
    rows.push({ k: 'range', icon: 'range', label: 'SIGHTING RANGE', v: st.sightRange, text: String(st.sightRange), better: 'up' });
    rows.push({ k: 'vr', icon: 'recoil-v', label: 'VERTICAL RECOIL', v: st.vRecoil, text: String(st.vRecoil), better: 'down' });
    rows.push({ k: 'hr', icon: 'recoil-h', label: 'HORIZONTAL RECOIL', v: st.hRecoil, text: String(st.hRecoil), better: 'down' });
    if (st.velocity) rows.push({ k: 'vel', icon: 'velocity', label: 'MUZZLE VELOCITY', v: st.velocity, text: `${st.velocity} m/s`, bar: st.velocity / 1000, better: 'up' });
    rows.push({ k: 'fire', icon: 'fire', label: 'TYPES OF FIRE', text: st.fire.map((f) => FIRE_MODE_LABEL[f] || f).join(', ') || '—' });
    if (st.cal) rows.push({ k: 'cal', icon: 'caliber', label: 'CALIBER', text: st.cal });
    rows.push({ k: 'rpm', icon: 'rpm', label: 'FIRE RATE', text: `${st.rpm} rpm` });
    if (st.effDist) rows.push({ k: 'eff', icon: 'eff', label: 'EFFECTIVE DISTANCE', text: `${st.effDist} meters` });
  } else {
    if (st.recoilPct) rows.push({ k: 'rec', icon: 'recoil-v', label: 'RECOIL', text: `${st.recoilPct}%` });
    if (st.accPct) rows.push({ k: 'acc', icon: 'acc', label: 'ACCURACY', text: `${st.accPct}%` });
    if (st.sightRange) rows.push({ k: 'range', icon: 'range', label: 'SIGHTING RANGE', text: String(st.sightRange) });
  }
  return rows;
}

function renderStats(rec, st) {
  const box = el('aside', { class: 'modstats' });
  rec.statsNode = box;
  fillStats(rec, box, st);
  return box;
}

/** re-draw the table alone (a hover preview should not rebuild the stage) */
function updateStats(rec) {
  if (!rec.statsNode) return;
  fillStats(rec, rec.statsNode, weaponStats(rec.item));
}

function fillStats(rec, box, st) {
  box.replaceChildren();
  const { item } = rec;
  const rows = statRows(item, st);
  const pv = rec.hover ? statRows(item, weaponStats(item, { swap: rec.hover })) : null;
  if (st.missing.length) {
    box.append(el('div', { class: 'modstats__warn' }, icon('warn', 'ico ico--sm'),
      el('span', {}, `Missing vital parts: ${st.missing.map((s) => s.label).join(', ')}`)));
  }
  for (const r of rows) {
    const row = el('div', { class: 'modstats__row' });
    if (r.bar != null) row.append(el('i', { class: 'modstats__bar', style: { width: `${clamp(r.bar, 0, 1) * 100}%` } }));
    row.append(el('span', { class: 'modstats__k' }, icon(r.icon, 'ico ico--sm'), el('b', {}, r.label)));
    const val = el('span', { class: 'modstats__v' }, r.text);
    const p = pv ? pv.find((x) => x.k === r.k) : null;
    if (p && typeof r.v === 'number' && typeof p.v === 'number' && Math.abs(p.v - r.v) > 1e-9) {
      const d = Math.round((p.v - r.v) * 100) / 100;
      const good = r.better === 'up' ? d > 0 : r.better === 'down' ? d < 0 : null;
      val.append(el('span', { class: `modstats__d${good == null ? '' : good ? ' is-good' : ' is-bad'}` }, `${d > 0 ? '+' : ''}${d}`));
    }
    row.append(val);
    box.append(row);
  }
}

// ---------------------------------------------------------
// the bar: actions on the gun, presets, back
// ---------------------------------------------------------
function renderBar(rec, st) {
  const { item } = rec;
  const wpn = item.tpl.wpn || {};
  const isGun = item.isWeapon;
  const bar = el('footer', { class: 'modscreen__bar' });
  const acts = el('div', { class: 'modscreen__acts' });
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
  bar.append(acts);

  const right = el('div', { class: 'modscreen__bar-right' });
  right.append(el('span', { class: 'modscreen__meta' }, `${fmtWeight(st.weight)} kg · ${st.size}`));
  if (isGun && !inRaid) {
    right.append(el('button', {
      class: `barbtn${rec.builds ? ' is-on' : ''}`, title: 'Factory and saved builds of this weapon',
      onclick: () => { rec.builds = !rec.builds; rec.pick = null; sfx.ui('click'); render(rec); },
    }, icon('stash', 'ico ico--sm'), el('span', {}, 'PRESETS')));
  }
  if (VIEW3D) {
    right.append(el('button', { class: 'barbtn', onclick: () => devModding('view3d') }, el('span', {}, '3D')));
  }
  right.append(el('button', {
    class: 'modscreen__back', title: 'Back (Esc)',
    onclick: () => closeModdingWindow(item.uid),
  }, 'BACK'));
  bar.append(right);
  return bar;
}

// ---------------------------------------------------------
// presets drawer (the game's weapon builds)
// ---------------------------------------------------------
function renderBuilds(rec) {
  const { item } = rec;
  const box = el('aside', { class: 'modpresets' });
  const cur = weaponStats(item);

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
  box.append(el('div', { class: 'modpick__head' },
    el('span', {}, 'WEAPON PRESETS'),
    el('button', { class: 'cwin__close', onclick: () => { rec.builds = false; render(rec); } }, icon('close', 'ico ico--sm'))));
  box.append(el('div', { class: 'modpresets__save' }, nameField,
    el('button', { class: 'btn btn--sm btn--primary', onclick: doSave }, 'SAVE CURRENT')));

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
  if (kind === 'view3d') {
    // parked, but reachable for the capture and the verify script
    openModdingWindow(gun);
    import('./viewer3d.js').then((v) => v.openViewer3D(gun, {
      onPick: (slot) => { const rec = open.get(gun.root.uid); if (rec && slot) { rec.pick = { slot }; render(rec); } },
    }));
  }
  if (kind === 'pick') {
    openModdingWindow(gun);
    const rec = open.get(gun.root.uid);
    const slot = gun.modSlot(arg || 'mod_muzzle');
    if (rec && slot) { rec.pick = { slot }; render(rec); }
  }
}
