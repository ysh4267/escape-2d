// =========================================================
// the character screen's MAP tab
//
// The client's MapScreen, off its hierarchy and a 1080p capture of the tab
// with no map to show:
//
//   A plan map among the character's things (Customs plan map and its
//   fellows) unfolds here: the plan fills the tab, dragged about with the
//   pointer and zoomed with the wheel or the slider at the bottom left. A
//   right press on it leaves a marker - loot, locked, important, other - with
//   a note of up to 75 letters; a right press on a marker edits or removes
//   it. LEGEND, bottom right, counts the markers by kind and hides a kind;
//   the square top right shows which map is unfolded and, with more than
//   one, lets another be picked.
//
//   With no map there is one line in the middle of the tab saying so.
//
// A plan's markers are kept on the map item itself, placed as shares of the
// plan, so they travel with that copy of the map and with the save.
//
// The plans are the client's pocket maps, stitched from its tiles at one of
// its four scales (tools/build_ui.py PLANS); the client zooms on to its
// finest tiles, this as far as that one scale stays sharp.
// =========================================================

import { $, el } from '../core/util.js';
import { game, saveSoon } from '../core/state.js';
import { t } from '../core/i18n.js';
import { uiImg, uiUrl, uiMeta, loadUiGroup } from '../core/uiart.js';
import { sfx } from '../core/audio.js';
import { toStage } from '../core/stage.js';
import { renderItem } from '../inventory/view.js';
import { toast } from './shell.js';

const NOTE_MAX = 75;
// how far past its own pixels a stitched plan may be enlarged before it blurs
const SHARP = 2;

const TYPES = [
  { id: 'loot', ico: 'marker_loot', label: 'MapMarkerType_Loot' },
  { id: 'locked', ico: 'marker_locked', label: 'MapMarkerType_LockedStuff' },
  { id: 'important', ico: 'marker_important', label: 'MapMarkerType_Important' },
  { id: 'other', ico: 'marker_unknown', label: 'MapMarkerType_Other' },
];
const typeOf = (id) => TYPES.find((x) => x.id === id) || TYPES[3];

let current = null;         // uid of the map unfolded
let slide = 0;              // the zoomer: 0 the whole plan, 1 as close as it goes
let cx = 0.5, cy = 0.5;     // the point of the plan under the middle of the view
let legendOpen = false;
let picking = false;
const hidden = new Set();   // kinds of marker the legend has switched off
let dom = null;             // the nodes laid out again on every drag and zoom

let carriedOnly = false;
/** in a raid the stash is out of reach: only the plans brought along count */
export function mapScope(carried) { carriedOnly = !!carried; }

/** every plan map the character has: what is worn and carried first, then the stash */
function mapItems() {
  const out = [];
  const take = (it) => { if (it.tpl.map) out.push(it); };
  for (const it of game.equipment.everything()) take(it);
  if (!carriedOnly) for (const it of game.stash.items()) { take(it); for (const d of it.descendants()) take(d); }
  return out;
}

const markersOf = (item) => item.markers || (item.markers = []);

// ---------------------------------------------------------
// the plan in the view
// ---------------------------------------------------------
function zoomRange(item) {
  const m = item.tpl.map;
  const full = m.size?.[0] || dom?.natural?.w || 2000;
  const own = dom?.natural?.w || full;
  const lo = m.min || 0.2;
  // the client goes on to its finest tiles; one stitched scale only stays sharp so far
  const hi = Math.max(lo, Math.min(m.max || 1, (own / full) * SHARP));
  return { lo, hi, full };
}

function layout() {
  if (!dom) return;
  const item = dom.item;
  const { lo, hi, full } = zoomRange(item);
  const z = lo + (hi - lo) * slide;
  const ratio = (item.tpl.map.size?.[1] || dom.natural?.h || full) / full;
  const dw = full * z;
  const dh = dw * ratio;
  const vw = dom.view.clientWidth, vh = dom.view.clientHeight;
  // the plan cannot be dragged off the view: an edge stops at the view's edge,
  // and a plan smaller than the view sits in the middle of it
  const hold = (c, d, v) => (d <= v ? 0.5 : Math.min(1 - v / 2 / d, Math.max(v / 2 / d, c)));
  cx = hold(cx, dw, vw);
  cy = hold(cy, dh, vh);
  dom.geo = { dw, dh, left: vw / 2 - cx * dw, top: vh / 2 - cy * dh };
  Object.assign(dom.sheet.style, { width: `${dw}px`, height: `${dh}px`, left: `${dom.geo.left}px`, top: `${dom.geo.top}px` });
  // the handle rides 180.5 px of the track: at its foot for the whole plan
  dom.handle.style.top = `${3.4 + (1 - slide) * 180.5}px`;
}

/** a pointer event's place on the plan, as shares of it */
function planPoint(e) {
  const box = dom.view.getBoundingClientRect();
  const x = toStage(e.clientX - box.left), y = toStage(e.clientY - box.top);
  return { x: (x - dom.geo.left) / dom.geo.dw, y: (y - dom.geo.top) / dom.geo.dh, vx: x, vy: y };
}

function zoomBy(step, at = null) {
  const before = at ? planPoint(at) : null;
  const next = Math.min(1, Math.max(0, slide + step));
  if (next === slide) return;
  slide = next;
  layout();
  if (before) {
    // the point under the pointer stays under it
    cx += before.x - (before.vx - dom.geo.left) / dom.geo.dw;
    cy += before.y - (before.vy - dom.geo.top) / dom.geo.dh;
    layout();
  }
}

// ---------------------------------------------------------
// markers
// ---------------------------------------------------------
function closeMenus() {
  for (const n of document.querySelectorAll('.pmap__ctx, .pmw')) n.remove();
}

function contextMenu(x, y, rows) {
  closeMenus();
  const menu = el('div', { class: 'pmap__ctx', style: { left: `${x}px`, top: `${y}px` } },
    rows.map((r) => {
      const b = el('button', { type: 'button', dataset: { sfx: 'own' } }, r.label);
      b.addEventListener('click', () => { sfx.ui('click'); closeMenus(); r.run(); });
      return b;
    }));
  dom.root.append(menu);
}

/** the EDIT MARKER window, for a new marker or one already on the plan */
function markerWindow(item, marker, isNew) {
  closeMenus();
  let type = marker.type;
  const counter = el('span', { class: 'pmw__count' });
  const input = el('textarea', { class: 'pmw__text', maxlength: String(NOTE_MAX), spellcheck: 'false' });
  input.value = marker.note || '';
  const count = () => { counter.textContent = `${input.value.length}/${NOTE_MAX}`; };
  input.addEventListener('input', count);
  count();
  const types = el('div', { class: 'pmw__types' });
  const paintTypes = () => types.replaceChildren(...TYPES.map((ty) => {
    const b = el('button', { class: `pmw__type${ty.id === type ? ' is-on' : ''}`, type: 'button', title: t(ty.label), dataset: { sfx: 'own' } }, uiImg(ty.ico));
    // picking a kind does not take the caret out of the note
    b.addEventListener('click', () => { type = ty.id; sfx.ui('checkbox'); paintTypes(); input.focus(); });
    return b;
  }), counter);
  paintTypes();
  const shut = el('button', { class: 'pmw__x', type: 'button', dataset: { sfx: 'own' } }, uiImg('close_window_x'));
  shut.addEventListener('click', () => { sfx.ui('click'); closeMenus(); });
  const save = el('button', { class: 'dbtn pmw__save', type: 'button', dataset: { sfx: 'own' } }, t('Save'));
  save.addEventListener('click', () => {
    marker.type = type;
    marker.note = input.value.trim().slice(0, NOTE_MAX);
    if (isNew) markersOf(item).push(marker);
    sfx.ui('click');
    saveSoon();
    closeMenus();
    renderMap();
  });
  const win = el('div', { class: 'pmw' },
    el('div', { class: 'pmw__cap' }, uiImg('note_icon'), el('span', {}, t('EditMapMarker')), shut),
    el('div', { class: 'pmw__body' }, types, el('div', { class: 'pmw__input' }, input), save));
  // a key typed into the note is the note's: the screen's own shortcuts stay out of it
  win.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') closeMenus(); });
  dom.root.append(win);
  input.focus();
}

function markerNode(item, m) {
  const ty = typeOf(m.type);
  const node = el('div', { class: 'pmap__marker', style: { left: `${m.x * 100}%`, top: `${m.y * 100}%` }, dataset: { type: ty.id } },
    uiImg(ty.ico), m.note ? el('div', { class: 'pmap__note' }, m.note) : null);
  node.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const p = planPoint(e);
    contextMenu(p.vx, p.vy, [
      { label: t('MarkerEdit'), run: () => markerWindow(item, m, false) },
      { label: t('MarkerDelete'), run: () => { const all = markersOf(item); all.splice(all.indexOf(m), 1); saveSoon(); renderMap(); } },
    ]);
  });
  if (hidden.has(ty.id)) node.hidden = true;
  return node;
}

// ---------------------------------------------------------
// the screen
// ---------------------------------------------------------
function legendPanel(item) {
  const all = markersOf(item);
  return el('div', { class: 'pmap__legend' }, TYPES.map((ty) => {
    const n = all.filter((m) => typeOf(m.type) === ty).length;
    const row = el('button', { class: `pmap__lrow${hidden.has(ty.id) ? '' : ' is-on'}`, type: 'button', dataset: { sfx: 'own' } },
      el('i', { class: 'pmap__chk' }, uiImg('checkmark')), uiImg(ty.ico), el('span', {}, `${t(ty.label)} (${n})`));
    row.addEventListener('click', () => {
      if (hidden.has(ty.id)) hidden.delete(ty.id); else hidden.add(ty.id);
      sfx.ui('checkbox');
      renderMap();
    });
    return row;
  }));
}

function picker(items, item) {
  const tile = (it) => { const n = renderItem(it, { static: true }); n.classList.add('pmap__tile'); return n; };
  const box = el('div', { class: 'pmap__pick' }, tile(item));
  if (items.length < 2) return box;
  const toggle = el('button', { class: `pmap__picktoggle${picking ? ' is-open' : ''}`, type: 'button', dataset: { sfx: 'own' } });
  toggle.addEventListener('click', () => { picking = !picking; sfx.ui('click'); renderMap(); });
  box.append(toggle);
  if (picking) {
    box.append(el('div', { class: 'pmap__picklist' }, items.filter((it) => it !== item).map((it) => {
      const b = el('button', { type: 'button', dataset: { sfx: 'own' } }, tile(it));
      b.addEventListener('click', () => {
        current = it.uid; picking = false; slide = 0; cx = cy = 0.5;
        sfx.ui('click');
        renderMap();
      });
      return b;
    })));
  }
  return box;
}

export function renderMap() {
  const host = $('#charmap-host');
  if (!host) return;
  const items = mapItems();
  if (!items.length) {
    dom = null;
    host.replaceChildren(el('div', { class: 'pmap__empty' }, t('EmptyMapSlotMessage')));
    return;
  }
  const item = items.find((it) => it.uid === current) || items[0];
  if (item.uid !== current) { current = item.uid; slide = 0; cx = cy = 0.5; picking = false; }
  const plan = `plan_${item.tpl.map.plan}`;
  const all = markersOf(item);

  const img = el('img', { class: 'pmap__img', alt: '', draggable: 'false' });
  const sheet = el('div', { class: 'pmap__sheet' }, img, all.map((m) => markerNode(item, m)));
  const view = el('div', { class: 'pmap__view' }, sheet);
  const handle = el('i', { class: 'pmap__zhandle' });
  const track = el('div', { class: 'pmap__ztrack' }, handle);
  const plus = el('button', { class: 'pmap__zbtn pmap__zbtn--plus', type: 'button', dataset: { sfx: 'own' } }, uiImg('zoom_plus'));
  const minus = el('button', { class: 'pmap__zbtn pmap__zbtn--minus', type: 'button', dataset: { sfx: 'own' } }, uiImg('zoom_minus'));
  const legendBtn = el('button', { class: `pmap__legendbtn${legendOpen ? ' is-open' : ''}`, type: 'button', dataset: { sfx: 'own' } },
    el('span', {}, t('MapLegend')), el('i', {}, uiImg(legendOpen ? 'opener_icon_close' : 'opener_icon_up')));
  legendBtn.addEventListener('click', () => { legendOpen = !legendOpen; sfx.ui('click'); renderMap(); });
  const root = el('div', { class: 'pmap' }, view, plus, track, minus,
    el('div', { class: 'pmap__count' }, uiImg('tab_icon_map_selected', '', { w: 20, h: 25 }), el('span', {}, `${all.length}/${item.tpl.map.markers || 100}`)),
    legendBtn, legendOpen ? legendPanel(item) : null, picker(items, item));
  host.replaceChildren(root);
  dom = { root, view, sheet, handle, item, natural: uiMeta(plan), geo: null };

  // the plan is a pack of its own, fetched the first time it is unfolded
  const show = () => { const url = uiUrl(plan); if (url) { img.src = url; dom.natural = uiMeta(plan); layout(); } };
  if (uiUrl(plan)) show();
  else {
    view.append(el('div', { class: 'pmap__loading' }, uiImg('spinner_big')));
    loadUiGroup(plan).then(() => { if (dom && dom.root === root) { view.querySelector('.pmap__loading')?.remove(); show(); } });
  }
  layout();

  // drag to move, wheel and slider to zoom, right press for a marker
  view.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('.pmap__marker')) return;
    closeMenus();
    const start = { x: e.clientX, y: e.clientY, cx, cy };
    view.setPointerCapture(e.pointerId);
    view.classList.add('is-held');
    const move = (ev) => {
      cx = start.cx - toStage(ev.clientX - start.x) / dom.geo.dw;
      cy = start.cy - toStage(ev.clientY - start.y) / dom.geo.dh;
      layout();
    };
    const up = () => { view.classList.remove('is-held'); view.removeEventListener('pointermove', move); view.removeEventListener('pointerup', up); view.removeEventListener('pointercancel', up); };
    view.addEventListener('pointermove', move);
    view.addEventListener('pointerup', up);
    view.addEventListener('pointercancel', up);
  });
  view.addEventListener('wheel', (e) => { e.preventDefault(); closeMenus(); zoomBy(e.deltaY < 0 ? 0.08 : -0.08, e); }, { passive: false });
  view.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const p = planPoint(e);
    if (p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1) return;
    contextMenu(p.vx, p.vy, [{
      label: t('MarkerCreate'),
      run: () => {
        if (all.length >= (item.tpl.map.markers || 100)) { toast(t('PocketMapMarkersLimitReached'), 'warn'); return; }
        markerWindow(item, { x: p.x, y: p.y, type: 'loot', note: '' }, true);
      },
    }]);
  });
  plus.addEventListener('click', () => { sfx.ui('click'); zoomBy(0.1); });
  minus.addEventListener('click', () => { sfx.ui('click'); zoomBy(-0.1); });
  track.addEventListener('pointerdown', (e) => {
    track.setPointerCapture(e.pointerId);
    const put = (ev) => {
      const box = track.getBoundingClientRect();
      slide = Math.min(1, Math.max(0, 1 - (ev.clientY - box.top) / box.height));
      layout();
    };
    put(e);
    const up = () => { track.removeEventListener('pointermove', put); track.removeEventListener('pointerup', up); };
    track.addEventListener('pointermove', put);
    track.addEventListener('pointerup', up);
  });
}
