// =========================================================
// the controls the client builds its forms from: the drop-down box and the
// number slider
//
// Both are measured off the client's own prefabs (Settings Drop Down,
// Settings Float Slider): a 250 x 35 box with the value in the middle and a
// small square button at its right end, opening a list directly under it;
// a thin line with a notch at each end and a handle hanging under it, and
// the number in a box of its own to the right.
// =========================================================

import { el } from '../core/util.js';
import { sfx } from '../core/audio.js';
import { uiImg } from '../core/uiart.js';

/** only one list is ever open; a press anywhere else shuts it */
let openBox = null;

document.addEventListener('pointerdown', (e) => {
  if (openBox && !openBox.node.contains(e.target)) openBox.close();
}, true);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && openBox) { openBox.close(); e.stopPropagation(); }
}, true);

/**
 * @param {{ value: string, options: { id: string, label: string }[], onChange?: (id: string) => void, width?: number }} o
 * @returns {{ node: HTMLElement, value: string, set: (id: string) => void, close: () => void }}
 */
export function dropdown(o) {
  let value = o.value;
  const label = el('span', { class: 'ddb__value' });
  const list = el('div', { class: 'ddb__list', hidden: true });
  const node = el('div', { class: 'ddb', tabindex: '0', dataset: { sfx: 'own' } },
    label,
    el('span', { class: 'ddb__btn' },
      uiImg('dropdown_arrow_down_new', 'ddb__arrow ddb__arrow--down', { w: 10, h: 8 }),
      uiImg('dropdown_arrow_up_new', 'ddb__arrow ddb__arrow--up', { w: 10, h: 8 })),
    list);
  if (o.width) node.style.width = `${o.width}px`;

  const api = {
    node,
    get value() { return value; },
    set(v) { value = v; paint(); },
    close() {
      list.hidden = true;
      node.classList.remove('is-open');
      if (openBox === api) openBox = null;
    },
  };

  function paint() {
    label.textContent = o.options.find((x) => x.id === value)?.label ?? '';
    list.replaceChildren(...o.options.map((opt) => {
      const row = el('button', { class: `ddb__opt${opt.id === value ? ' is-current' : ''}`, type: 'button', dataset: { sfx: 'own' } }, opt.label);
      row.addEventListener('click', (e) => {
        e.stopPropagation();
        api.close();
        if (opt.id === value) return;
        value = opt.id;
        paint();
        sfx.ui('dropdown_select');
        o.onChange?.(value);
      });
      return row;
    }));
  }

  node.addEventListener('click', () => {
    sfx.ui('dropdown');
    if (!list.hidden) { api.close(); return; }
    if (openBox) openBox.close();
    list.hidden = false;
    node.classList.add('is-open');
    openBox = api;
  });
  paint();
  return api;
}

/**
 * @param {{ value: number, min?: number, max?: number, step?: number, onInput?: (v: number) => void }} o
 * @returns {{ node: HTMLElement, value: number, set: (v: number) => void }}
 */
export function slider(o) {
  const min = o.min ?? 0;
  const max = o.max ?? 100;
  const step = o.step ?? 1;
  let value = o.value;

  const handle = el('span', { class: 'nsl__handle' }, uiImg('dropdown_arrow_up_new', 'nsl__arrow', { w: 10, h: 7 }));
  const track = el('div', { class: 'nsl__track' },
    el('i', { class: 'nsl__line' }), el('i', { class: 'nsl__notch' }), el('i', { class: 'nsl__notch nsl__notch--end' }), handle);
  const box = el('input', { class: 'nsl__value', type: 'text', inputmode: 'numeric', maxlength: '4', spellcheck: 'false' });
  const node = el('div', { class: 'nsl' }, track, box);

  const snap = (v) => Math.min(max, Math.max(min, Math.round(v / step) * step));
  const paint = () => {
    handle.style.left = `${((value - min) / (max - min)) * 100}%`;
    if (document.activeElement !== box) box.value = String(value);
  };
  const put = (v, tell = true) => {
    v = snap(v);
    if (v === value) return;
    value = v;
    paint();
    if (tell) o.onInput?.(value);
  };

  // the line is drawn inside a scaled stage: read where the pointer is as a
  // share of the line's own box, which comes out the same at any scale
  const at = (e) => {
    const r = track.getBoundingClientRect();
    put(min + ((e.clientX - r.left) / r.width) * (max - min));
  };
  track.addEventListener('pointerdown', (e) => {
    track.setPointerCapture(e.pointerId);
    at(e);
    const move = (ev) => at(ev);
    const up = () => {
      track.removeEventListener('pointermove', move);
      track.removeEventListener('pointerup', up);
      track.removeEventListener('pointercancel', up);
    };
    track.addEventListener('pointermove', move);
    track.addEventListener('pointerup', up);
    track.addEventListener('pointercancel', up);
  });
  track.addEventListener('wheel', (e) => { e.preventDefault(); put(value - Math.sign(e.deltaY) * step); }, { passive: false });
  box.addEventListener('change', () => {
    const n = Number(box.value.replace(',', '.'));
    if (Number.isFinite(n)) put(n);
    box.value = String(value);
  });
  box.addEventListener('keydown', (e) => { if (e.key === 'Enter') box.blur(); e.stopPropagation(); });

  paint();
  return {
    node,
    get value() { return value; },
    set(v) { value = snap(v); paint(); },
  };
}
