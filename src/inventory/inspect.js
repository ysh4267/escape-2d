// =========================================================
// an item's own window
//
// The client's ItemInfoWindow, off its prefab: a window some 750 px wide that
// floats over the screen and is dragged by its caption bar. Top to bottom:
//
//   caption   the magnifier and the item's full name
//   preview   the item itself on a dark hatched ground, what kind of thing
//             it is in the top-left corner and its weight in the top-right
//   actions   everything the right-click menu offers, as a grid four across
//   details   condition, then what the item does in two columns of rows,
//             then its description
//
// Any number can be open at once, one an item; each redraws with the rest of
// the inventory and shuts when its item is gone.
// =========================================================

import { el } from '../core/util.js';
import { t, tOr } from '../core/i18n.js';
import { uiImg, hasUi } from '../core/uiart.js';
import { sfx } from '../core/audio.js';
import { openWindow, keepLoose } from './window.js';
import { isKnown } from './examine.js';
import { statRows } from './statrows.js';
import { medRows } from './tooltip.js';
import { catLabel, conditionOf } from './view.js';
import { contextProvider, closeContext } from './dialogs.js';

/** kilograms the way the client writes them on this window: to the gram, no trailing noughts */
const kg = (w) => `${Math.round(w * 1000) / 1000}${tOr('kg', 'kg')}`;

/** 3D previews, when the build has them: (host, item) => dispose | null */
let previewer = null;
export function setItemPreviewer(fn) { previewer = fn; }

export function inspectDialog(item) {
  if (!item) return null;
  const key = `i:${item.uid}`;
  const known = isKnown(item);
  let dispose = null;
  const node = openWindow({
    key, item, cls: 'cwin--info', icon: 'icon_search',
    title: known ? item.tpl.name : tOr('Item is not examined', 'Unknown item'),
    onClose: () => { dispose?.(); dispose = null; },
    paint: (body) => {
      dispose?.();
      dispose = paint(body, item);
    },
  });
  // something in no inventory - a trader's goods, a reward - has nowhere to vanish from
  if (!item.holder) keepLoose(key);
  return node;
}

function paint(body, item) {
  const tpl = item.tpl;
  const known = isKnown(item);
  let dispose = null;

  // ---- the preview ----
  const stage = el('div', { class: 'iw__stage' });
  const built = item.isWeapon && tpl.presetImgUrl && item.slots?.some((s) => s.item);
  const src = built ? tpl.presetImgUrl : tpl.imgUrl;
  const flat = built ? tpl.presetFlat : tpl.imgFlat;
  const picture = () => { if (src) stage.replaceChildren(el('img', { class: `iw__img${flat ? ' is-flat' : ''}`, src, alt: '' })); };
  if (known && previewer) {
    try { dispose = previewer(stage, item) || null; } catch { dispose = null; }
    if (!dispose) picture();
  } else picture();

  const preview = el('div', { class: 'iw__preview' },
    stage,
    uiImg('bottom_left_corner', 'iw__corner iw__corner--bl'), uiImg('top_right_corner', 'iw__corner iw__corner--tr'),
    el('div', { class: 'iw__type' }, known ? catLabel(tpl.cat) : ''),
    el('div', { class: 'iw__mass' }, uiImg('mass', '', { w: 19, h: 22 }), kg(item.weight)),
    item.fir ? el('div', { class: 'iw__marks' }, uiImg('icon_foundinraid_small', '', { w: 13, h: 12 })) : null);

  // ---- the actions: the menu's own, less the one that opened this ----
  const actions = (contextProvider(item) || []).filter((a) => a && a !== '-' && a.id !== 'inspect');
  const grid = el('div', { class: 'iw__actions' });
  for (const a of actions) {
    const row = el('button', {
      class: `ctx__row${a.kind ? ` ctx__row--${a.kind}` : ''}`, type: 'button', disabled: !!a.disabled || !!a.sub, dataset: { sfx: 'own' },
    },
    el('span', { class: 'ctx__ico' }, a.icon && hasUi(a.icon) ? uiImg(a.icon, '', { w: 16, h: 16 }) : null),
    el('span', { class: 'ctx__label' }, a.label));
    row.addEventListener('click', () => {
      sfx.ui('click');
      closeContext();
      // what destroys the item or takes it elsewhere shuts the window with it
      a.run?.();
    });
    grid.append(row);
  }

  // ---- the details ----
  const details = el('div', { class: 'iw__details' });
  if (known) {
    const cond = conditionOf(item);
    if (cond && item.dura != null) {
      const full = tpl.wpn?.maxDura ?? tpl.dura;
      details.append(el('div', { class: 'iw__bar' },
        el('i', { class: 'iw__barfill', style: { width: `${cond.now * 100}%` } }),
        el('i', { class: 'iw__barlost', style: { width: `${(1 - cond.ceiling) * 100}%` } }),
        hasUi('durability') ? uiImg('durability', 'iw__rowico', { w: 16, h: 16 }) : null,
        el('span', { class: 'iw__k' }, tOr('DURABILITY', 'DURABILITY')),
        el('span', { class: 'iw__v' }, `${Math.round(item.dura * 10) / 10}/${Math.round((item.maxDura ?? full) * 10) / 10} (${full})`)));
    }
    const rows = el('div', { class: 'iw__rows' });
    const row = (k, v) => rows.append(el('div', { class: 'iw__row' }, el('span', { class: 'iw__k' }, k), el('span', { class: 'iw__v' }, v)));
    if (item.stack > 1) row(tOr('AMOUNT', 'AMOUNT'), `${item.stack}/${tpl.stack}`);
    if (tpl.res && item.res != null) row(tOr('RESOURCE', 'RESOURCE'), `${Math.round(item.res)}/${tpl.res.max}`);
    if (tpl.armorClass) row(tOr('ARMOR CLASS', 'ARMOR CLASS'), String(tpl.armorClass));
    if (tpl.armorMat) row(tOr('MATERIAL', 'MATERIAL'), tpl.armorMat);
    medRows(tpl, row);
    statRows(item, row);
    if (item.isContainer) {
      const cells = item.grids.reduce((n, g) => n + g.capacity, 0);
      row(tOr('CAPACITY', 'CAPACITY'), String(cells));
    }
    if (rows.childNodes.length) details.append(rows);
    if (tpl.desc) details.append(el('div', { class: 'iw__desc' }, tpl.desc));
  } else {
    details.append(el('div', { class: 'iw__desc' }, t('ITEM IS NOT EXAMINED!')));
  }

  body.replaceChildren(...[preview, actions.length ? el('div', { class: 'iw__actionsband' }, grid) : null, details].filter(Boolean));
  return dispose;
}
