// =========================================================
// the calibre chart
//
// The wiki's ammunition table, for one calibre, in a floating window: every
// round of that calibre the character knows, with the columns the wiki
// prints (damage, penetration, armour damage, accuracy, recoil, fragmentation,
// bleeds, velocity) and the six-cell strip against fresh armour of each
// class, coloured on the wiki's scale. Sorted by penetration, the round it
// was opened from highlighted. Read-only; nothing here changes the game.
// =========================================================

import { el, icon } from '../core/util.js';
import { TPL, getTpl } from '../data/items.js';
import { ensureHost, makeDraggable, bringToFront, flash } from './window.js';
import { sfx } from '../core/audio.js';
import { isExamined } from '../core/state.js';
import { classStrip, efficacy, ARMOR_CLASSES, EFFICACY } from './ballistics.js';

/** cal -> node */
const open = new Map();

/** every round of the calibre, penetration first */
export function roundsOfCaliber(cal) {
  return Object.values(TPL)
    .filter((t) => t.cat === 'ammo' && t.cal === cal)
    .sort((a, b) => (b.ammo?.pen ?? b.pen ?? 0) - (a.ammo?.pen ?? a.pen ?? 0) || (b.ammo?.dmg ?? 0) - (a.ammo?.dmg ?? 0));
}

const known = (tpl) => !!(tpl.known || tpl.alwaysExamined || isExamined(tpl.key));

export function openAmmoChart(cal, focusKey = null) {
  if (!cal) return null;
  const existing = open.get(cal);
  if (existing) { bringToFront(existing); flash(existing); return existing; }
  const layer = ensureHost();
  const node = el('div', { class: 'cwin cwin--chart' });
  const head = el('div', { class: 'cwin__head' },
    icon('info'),
    el('span', { class: 'cwin__title' }, `${cal} — AMMUNITION`),
    el('span', { class: 'cwin__meta' }, 'vs fresh armour'),
    el('button', {
      class: 'cwin__close', title: 'Close',
      onclick: (e) => { e.stopPropagation(); node.remove(); open.delete(cal); sfx.ui('close'); },
    }, icon('close', 'ico ico--sm')));
  const body = el('div', { class: 'cwin__body chart' });
  node.append(head, body);
  const i = open.size % 4;
  node.style.left = `${120 + i * 30}px`;
  node.style.top = `${70 + i * 30}px`;
  makeDraggable(node, head);
  node.addEventListener('pointerdown', () => bringToFront(node), true);
  layer.append(node);
  open.set(cal, node);
  bringToFront(node);
  render(body, cal, focusKey);
  sfx.ui('inspect_open');
  return node;
}

function render(body, cal, focusKey) {
  const rounds = roundsOfCaliber(cal);
  const table = el('table', { class: 'chart__table' });
  const thead = el('thead', {}, el('tr', {},
    ...['ROUND', 'DMG', 'PEN', 'ARMOR DMG', 'ACC', 'RECOIL', 'FRAG', 'L.BLEED', 'H.BLEED', 'SPEED']
      .map((h) => el('th', {}, h)),
    ...ARMOR_CLASSES.map((c) => el('th', { class: 'chart__cls' }, `C${c}`))));
  const tbody = el('tbody');
  for (const t of rounds) {
    const a = t.ammo || {};
    const isKnown = known(t);
    const tr = el('tr', { class: t.key === focusKey ? 'is-focus' : '' });
    const name = el('td', { class: 'chart__name' });
    if (t.imgUrl) name.append(el('img', { src: t.imgUrl, alt: '' }));
    name.append(el('span', {}, isKnown ? (t.short || t.name) : '?'));
    if (a.tracer && isKnown) name.append(el('sup', { title: 'tracer' }, 'T'));
    if (a.subsonic && isKnown) name.append(el('sup', { title: 'subsonic' }, 'S'));
    name.title = isKnown ? t.name : 'Unknown round';
    tr.append(name);
    if (!isKnown) {
      tr.append(el('td', { colspan: String(9 + ARMOR_CLASSES.length), class: 'chart__unknown' }, 'not examined yet'));
      tbody.append(tr);
      continue;
    }
    const num = (v, sfx2 = '', signed = false) => el('td', {}, v == null || v === 0 && signed ? (signed ? '0' : '—')
      : `${signed && v > 0 ? '+' : ''}${v}${sfx2}`);
    tr.append(
      el('td', {}, a.proj > 1 ? `${a.proj}x${a.dmg}` : String(a.dmg ?? t.dmg ?? 0)),
      el('td', { class: 'chart__pen' }, String(a.pen ?? t.pen ?? 0)),
      num(a.armorDmg, '%'),
      num(a.acc, '%', true),
      num(a.rec, '', true),
      num(a.frag != null ? Math.round(a.frag * 100) : null, '%'),
      num(a.lbleed ? Math.round(a.lbleed * 100) : null, '%', true),
      num(a.hbleed ? Math.round(a.hbleed * 100) : null, '%', true),
      el('td', {}, a.speed ? `${a.speed}` : '—'));
    for (const c of classStrip(a.pen ?? t.pen ?? 0)) {
      const eff = efficacy(c.chance, a.pen ?? t.pen ?? 0, c.cls);
      const cell = el('td', { class: 'chart__cell', style: { background: eff.color + '66' } }, `${Math.round(c.chance)}`);
      cell.title = `${eff.label} — ${Math.round(c.chance)}% through a fresh class ${c.cls} plate`;
      tr.append(cell);
    }
    tbody.append(tr);
  }
  table.append(thead, tbody);
  body.replaceChildren(table);
  const legend = el('div', { class: 'chart__legend' });
  for (const e of EFFICACY) {
    legend.append(el('span', { class: 'chart__key' },
      el('i', { style: { background: e.color + '99' } }), `${e.level} ${e.label}`));
  }
  body.append(el('div', { class: 'chart__note' },
    'Cells: chance for one round to go through a fresh plate of that class. T tracer · S subsonic. Rounds you have not examined stay blank.'),
  legend);
}

export function closeAllAmmoCharts() {
  for (const n of open.values()) n.remove();
  open.clear();
}

/** for tests */
export function chartRows(cal) { return roundsOfCaliber(cal).map((t) => ({ key: t.key, strip: classStrip(t.ammo?.pen ?? 0), tpl: getTpl(t.key) })); }
