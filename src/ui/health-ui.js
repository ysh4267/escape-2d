// =========================================================
// health interface, drawn the way the game draws it
//
// Three views of the same body:
//  - the BOARD: the character screen's HEALTH tab. The x-ray figure with a
//    label tab and a bar for each part hung around him where the game hangs
//    them, the total under his feet, the vitals below. Hideout HEALTH tab.
//  - the LIST: the vertical strip the game shows next to the quick bar when
//    a med is picked - a tab and a bar per part, stacked. The in-raid
//    inventory block and the body-part dialog.
//  - the HUD FIGURE: the outline man in the corner of the screen, each part
//    stroked in its own colour, the conditions stacked beside him.
//
// Colour is the game's: a bar's hue slides from green at full through
// yellow and orange to red as the part empties; a destroyed part is a red
// frame with red digits and a cross. The figure itself is grey at full and
// tinted by the pool as a whole.
// =========================================================

import { $, el, icon, fmtNum, keepScroll } from '../core/util.js';
import { game, saveSoon, countMoney, takeMoney } from '../core/state.js';
import { PARTS, PART, FX, FX_INFO, Health, fmtDur, G } from '../raid/health.js';
import { PMC_PATH, PMC_VIEWBOX, PMC_XRAY, PMC_REGIONS, PMC_TABS, HUD_PARTS, HUD_VIEWBOX } from './silhouette.js';
import { openModal } from '../inventory/dialogs.js';
import { renderGrid } from '../inventory/view.js';
import { detach } from '../inventory/model.js';
import { dndContext } from '../inventory/dnd.js';
import { sfx } from '../core/audio.js';
import { emit, on, EV } from '../core/events.js';
import { toast, raidToast } from './shell.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const XLINK_NS = 'http://www.w3.org/1999/xlink';
let seq = 0;

/** the game's own part order and labels: RIGHT before LEFT, legs abbreviated on the strip */
const ORDER = ['head', 'thorax', 'stomach', 'rarm', 'larm', 'rleg', 'lleg'];
const LABEL = { head: 'HEAD', thorax: 'THORAX', stomach: 'STOMACH', rarm: 'RIGHT ARM', larm: 'LEFT ARM', rleg: 'RIGHT LEG', lleg: 'LEFT LEG' };
const LABEL_SHORT = { ...LABEL, rleg: 'R.LEG', lleg: 'L.LEG' };

function svgEl(tag, attrs = {}) {
  const n = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) n.setAttribute(k, String(v));
  return n;
}
function titled(node, text) {
  let t = node.querySelector(':scope > title');
  if (!t) { t = svgEl('title'); node.prepend(t); }
  t.textContent = text;
}

// ---------------------------------------------------------
// colour
// ---------------------------------------------------------
/** 0..1 of the part's ceiling */
function frac(health, key) {
  const p = health.parts[key];
  return p.max > 0 ? Math.max(0, Math.min(1, p.hp / p.max)) : 0;
}
/**
 * The bar's colour band. The game steps through four fills rather than
 * sliding a hue: green down to about 55%, yellow to 40%, orange to 20%,
 * red above nothing; nothing at all is a black track in a red frame.
 */
export function hpBand(f) {
  if (f <= 0) return 'dead';
  if (f >= 0.55) return 'g';
  if (f >= 0.40) return 'y';
  if (f >= 0.20) return 'o';
  return 'r';
}
/** the HUD's outline colour on the game's polychrome scheme, same bands */
export function hpHue(f) { return Math.round(f * 120); }

// ---------------------------------------------------------
// condition icons: the small squares under a bar / beside the figure
// ---------------------------------------------------------
function fxSquare(type, n = 1, t = null, cls = 'fxi') {
  const info = FX_INFO[type];
  if (!info) return null;
  const node = el('span', { class: `${cls}${info.bad ? ` ${cls}--bad` : ` ${cls}--good`}`, dataset: { fx: type }, title: `${info.name}: ${fxHelp(type)}` },
    icon(info.icon));
  if (n > 1) node.append(el('b', {}, String(n)));
  if (t != null && t !== Infinity) node.append(el('i', {}, fmtDur(t)));
  return node;
}

/** one line on what a condition does to you, for the tooltip */
export function fxHelp(type) {
  switch (type) {
    case FX.LB: return `Light bleeding: −${G.lb.dmg} hp on every part every ${G.lb.loop}s, drains energy. Bandage or medkit.`;
    case FX.HB: return `Heavy bleeding: −${G.hb.dmg} hp on every part every ${G.hb.loop}s. Tourniquet, hemostatic or a Salewa / IFAK / AFAK / Grizzly.`;
    case FX.FW: return 'Fresh wound: a dressed heavy bleed. Sprinting can reopen it, a hard hit turns it back into a heavy bleed.';
    case FX.FR: return 'Fracture: a leg limps at 55% and cannot sprint; an arm shoots and searches slower. Splint, or painkillers to ignore it.';
    case 'pain': return 'Pain: aim suffers, vision pulses. Untreated it becomes a tremor. Painkillers.';
    case 'tremor': return 'Hands tremor: aim suffers badly. Treat the cause of the pain.';
    case FX.CT: return 'Concussion: hearing muffled. Ibuprofen, morphine, Golden Star or a Grizzly.';
    case FX.PK: return 'On painkillers: no pain, fractures ignored, sprint on a broken leg (which hurts it).';
    case 'dehy': return 'Dehydration: −1 hp on every part every 15s and pain. Drink.';
    case 'exh': return 'Exhaustion: −1 hp on every part every 5s, tunnel vision. Eat.';
    case 'thirst': return 'Hydration is low. Drink before it hits zero.';
    case 'hunger': return 'Energy is low. Eat before it hits zero.';
    case 'dp': return 'Destroyed part: hits on it spread over the whole body. A surgical kit brings it back at reduced max.';
    case 'lowhp': return 'Below 130 hp: one more good hit ends it.';
    case FX.HEMO: return 'Hemostatic: nothing bleeds while this lasts.';
    case FX.REGEN: return 'Regeneration: hp comes back over the whole body.';
    case FX.ADR: return 'Adrenaline: stamina drains slower and returns faster.';
    case 'tunnel': return 'Tunnel vision: the edges of the world go dark.';
    default: return '';
  }
}

// ---------------------------------------------------------
// a part block: the label tab, the bar, the conditions under it
// ---------------------------------------------------------
function partBlock(key, { short = false } = {}) {
  const block = el('div', { class: 'hb-part', dataset: { part: key } });
  block.append(
    el('div', { class: 'hb-tab' }, short ? LABEL_SHORT[key] : LABEL[key]),
    el('div', { class: 'hb-bar' }, el('i'), el('span', { class: 'hb-bar__t' }, ''), el('b', { class: 'hb-bar__x' }, '✖')),
    el('div', { class: 'hb-fx' }));
  return block;
}

function paintPart(block, health, key, opts = {}) {
  const p = health.parts[key];
  const f = frac(health, key);
  const dead = p.hp <= 0;
  block.dataset.state = dead ? 'dead' : 'ok';
  block.classList.toggle('is-off', !!(opts.can && !opts.can(key)));
  block.classList.toggle('is-selected', opts.selected === key);
  const bar = block.querySelector('.hb-bar');
  bar.style.setProperty('--fk', f.toFixed(3));
  bar.dataset.band = hpBand(f);
  bar.querySelector('.hb-bar__t').textContent = `${Math.ceil(p.hp)}/${p.max}`;
  bar.classList.toggle('is-capped', p.max < PART[key].max);
  const fx = block.querySelector('.hb-fx');
  fx.replaceChildren();
  for (const t of health.partFx(key)) {
    if (t === 'dp') continue;   // the red frame already says it
    const n = fxSquare(t);
    if (n) fx.append(n);
  }
  const conds = health.partFx(key).map((t) => FX_INFO[t]?.name).filter(Boolean);
  block.title = `${LABEL[key]} ${Math.ceil(p.hp)}/${p.max}${conds.length ? ' — ' + conds.join(', ') : ''}`;
}

// ---------------------------------------------------------
// the figure (x-ray) with clickable regions
// ---------------------------------------------------------
function buildFigure(opts = {}) {
  const id = `sil${++seq}`;
  const svg = svgEl('svg', { viewBox: PMC_VIEWBOX.join(' '), class: 'hb-figure', preserveAspectRatio: 'xMidYMid meet' });
  const defs = svgEl('defs');
  const clip = svgEl('clipPath', { id });
  clip.append(svgEl('path', { d: PMC_PATH }));
  defs.append(clip);
  svg.append(defs);
  // the man: a dark body, the x-ray inside him, a faint edge
  svg.append(svgEl('path', { d: PMC_PATH, class: 'hb-figure__body' }));
  const img = svgEl('image', { href: PMC_XRAY, x: 0, y: 0, width: PMC_VIEWBOX[2], height: PMC_VIEWBOX[3], 'clip-path': `url(#${id})`, class: 'hb-figure__xray', preserveAspectRatio: 'none' });
  img.setAttributeNS(XLINK_NS, 'xlink:href', PMC_XRAY);
  svg.append(img);
  // an injured part glows red inside him: the region, blurred, clipped to
  // the body, on top of the x-ray
  const filt = svgEl('filter', { id: `${id}-blur`, x: '-30%', y: '-30%', width: '160%', height: '160%' });
  filt.append(svgEl('feGaussianBlur', { stdDeviation: 22 }));
  defs.append(filt);
  const glow = svgEl('g', { class: 'hb-figure__glow', 'clip-path': `url(#${id})`, filter: `url(#${id}-blur)` });
  for (const key of ORDER) {
    const pts = PMC_REGIONS[key].map((p) => p.join(',')).join(' ');
    glow.append(svgEl('polygon', { points: pts, class: 'hb-glow', 'data-part': key }));
  }
  svg.append(glow);
  svg.append(svgEl('path', { d: PMC_PATH, class: 'hb-figure__edge' }));
  // the parts, clipped to him
  const regions = svgEl('g', { class: 'hb-figure__regions', 'clip-path': `url(#${id})` });
  for (const key of ORDER) {
    const pts = PMC_REGIONS[key].map((p) => p.join(',')).join(' ');
    const poly = svgEl('polygon', { points: pts, class: 'hb-region', 'data-part': key });
    if (opts.onPick) {
      poly.classList.add('is-pickable');
      poly.addEventListener('click', () => { if (!poly.classList.contains('is-off')) opts.onPick(key); });
    }
    regions.append(poly);
  }
  svg.append(regions);
  return svg;
}

function paintFigure(svg, health, opts = {}) {
  for (const key of ORDER) {
    const g = svg.querySelector(`.hb-glow[data-part="${key}"]`);
    if (g) {
      // any damage lights the zone; the worse it is, the harder it glows
      const f = frac(health, key);
      const hurt = f < 0.999 || health.partFx(key).length > 0;
      g.style.opacity = hurt ? (0.16 + 0.34 * (1 - f)).toFixed(2) : '0';
    }
  }
  for (const key of ORDER) {
    const poly = svg.querySelector(`.hb-region[data-part="${key}"]`);
    if (!poly) continue;
    poly.classList.toggle('is-off', !!(opts.can && !opts.can(key)));
    poly.classList.toggle('is-selected', opts.selected === key);
    poly.classList.toggle('is-dead', health.isDestroyed(key));
    const p = health.parts[key];
    const conds = health.partFx(key).map((k) => FX_INFO[k]?.name).filter(Boolean);
    titled(poly, `${LABEL[key]} ${Math.ceil(p.hp)}/${p.max}${conds.length ? ' — ' + conds.join(', ') : ''}`);
  }
}

// ---------------------------------------------------------
// the total and the vitals
// ---------------------------------------------------------
function totalRow() {
  return el('div', { class: 'hb-total' },
    icon('asterisk', 'ico hb-total__ico'),
    el('b', { class: 'hb-total__v' }, ''),
    el('span', { class: 'hb-total__rate' }, ''),
    el('span', { class: 'hb-total__max' }, ''));
}
function paintTotal(node, health, opts = {}) {
  node.querySelector('.hb-total__v').textContent = String(Math.ceil(health.total));
  node.querySelector('.hb-total__max').textContent = `/${health.max}`;
  const rate = node.querySelector('.hb-total__rate');
  const r = opts.hpRate ?? null;
  if (r && Math.abs(r) >= 0.005) {
    rate.textContent = `${r > 0 ? '▲' : '▼'}${Math.abs(r).toFixed(2)}`;
    rate.className = `hb-total__rate ${r > 0 ? 'is-up' : 'is-down'}`;
  } else rate.textContent = '';
  node.classList.toggle('is-low', health.lowHp);
}

/** digits with the leading zeros dimmed, the way the game's readouts do */
function digits(v, width = 3) {
  const s = String(Math.max(0, Math.round(v))).padStart(width, '0');
  const lead = s.length - String(Math.max(0, Math.round(v))).length;
  const wrap = el('span', { class: 'hb-num' });
  if (lead > 0) wrap.append(el('i', {}, s.slice(0, lead)));
  wrap.append(el('b', {}, s.slice(lead)));
  return wrap;
}

function vitalsBlock() {
  const cell = (key, ico) => el('div', { class: `hb-vital hb-vital--${key}`, dataset: { key } }, icon(ico), el('span', { class: 'hb-vital__v' }));
  return el('div', { class: 'hb-vitals' },
    cell('temp', 'thermo'), cell('poison', 'biohazard'), cell('rad', 'radiation'),
    cell('bp', 'gauge'), cell('hydration', 'water'), cell('energy', 'bolt'));
}
function rateNode(r) {
  if (!r || Math.abs(r) < 0.005) return el('small', {}, '');
  return el('small', { class: r > 0 ? 'is-up' : 'is-down' }, `${r > 0 ? '▲' : '▼'}${Math.abs(r).toFixed(2)}`);
}
function paintVitals(node, health, opts = {}) {
  const set = (key, ...children) => {
    const v = node.querySelector(`.hb-vital[data-key="${key}"] .hb-vital__v`);
    if (v) v.replaceChildren(...children);
  };
  set('temp', el('b', {}, '36.6'));
  set('bp', el('b', {}, '120/80'), el('small', {}, '0/0'));
  set('poison', digits(0), el('span', { class: 'hb-vital__max' }, '/100'), el('small', {}, '0.00'));
  set('rad', digits(0), el('span', { class: 'hb-vital__max' }, '/100'), el('small', {}, '0.00'));
  set('hydration', digits(health.hydration), el('span', { class: 'hb-vital__max' }, '/100'), rateNode(opts.hyRate));
  set('energy', digits(health.energy), el('span', { class: 'hb-vital__max' }, '/100'), rateNode(opts.enRate));
  node.querySelector('.hb-vital[data-key="hydration"]')?.classList.toggle('is-low', health.hydration < 20);
  node.querySelector('.hb-vital[data-key="energy"]')?.classList.toggle('is-low', health.energy < 20);
}

/** what the numbers are doing per minute, for the little arrows */
function rates(health, inRaid) {
  if (inRaid) {
    const f = health.isDestroyed('stomach') ? G.existence.stomachFactor : 1;
    let hp = 0;
    for (const e of health.effects) if (e.type === FX.REGEN && !(e.delay > 0)) hp += (e.meta.rate || 0) * 60;
    hp -= health.count(FX.LB) * (G.lb.dmg * health.alive().length * 60 / G.lb.loop);
    hp -= health.count(FX.HB) * (G.hb.dmg * health.alive().length * 60 / G.hb.loop);
    return { hpRate: hp, hyRate: -G.existence.hydration * f, enRate: -G.existence.energy * f };
  }
  const bleeding = health.count(FX.LB) + health.count(FX.HB) > 0;
  const hp = bleeding ? 0 : PARTS.reduce((n, p) => n + (G.regen[p.key] || 0), 0);
  return {
    hpRate: health.total < health.max ? hp : 0,
    hyRate: health.hydration < 100 ? G.regen.hydration : 0,
    enRate: health.energy < 100 ? G.regen.energy : 0,
  };
}

// ---------------------------------------------------------
// the BOARD: the character screen's HEALTH tab
// ---------------------------------------------------------
/**
 * The full health tab. `opts.onPick(part)` makes the parts clickable,
 * `opts.can(part)` greys the ones a med cannot help, `opts.selected` (a
 * value or a getter) marks one, `opts.footer` goes under the vitals.
 * Returns { refresh, root }.
 */
export function renderHealthBoard(host, health, opts = {}) {
  host.replaceChildren();
  const root = el('div', { class: 'hb' });
  const stage = el('div', { class: 'hb__stage' });
  const figure = buildFigure({ onPick: opts.onPick });
  stage.append(figure);
  const blocks = {};
  for (const key of ORDER) {
    const b = partBlock(key);
    const t = PMC_TABS[key];
    b.style.left = `${(t.x * 100).toFixed(2)}%`;
    b.style.top = `${(t.y * 100).toFixed(2)}%`;
    b.style.width = `${(t.w * 100).toFixed(2)}%`;
    if (opts.onPick) {
      b.classList.add('is-pickable');
      b.addEventListener('click', () => { if (!b.classList.contains('is-off')) opts.onPick(key); });
    }
    stage.append(b);
    blocks[key] = b;
  }
  const total = totalRow();
  stage.append(total);
  root.append(stage);
  const vitals = opts.vitals === false ? null : vitalsBlock();
  if (vitals) root.append(vitals);
  if (opts.footer) root.append(opts.footer);
  host.append(root);

  const sel = () => (typeof opts.selected === 'function' ? opts.selected() : opts.selected);
  const refresh = () => {
    const o = { can: opts.can, selected: sel() };
    paintFigure(figure, health, o);
    for (const key of ORDER) paintPart(blocks[key], health, key, o);
    const r = rates(health, !!opts.inRaid);
    paintTotal(total, health, r);
    if (vitals) paintVitals(vitals, health, r);
  };
  refresh();
  return { refresh, root, figure };
}

// ---------------------------------------------------------
// the LIST: the strip beside the quick bar, one row a part
// ---------------------------------------------------------
export function renderHealthList(host, health, opts = {}) {
  host.replaceChildren();
  const root = el('div', { class: `hl${opts.class ? ' ' + opts.class : ''}` });
  const blocks = {};
  for (const key of ORDER) {
    const row = el('div', { class: 'hl__row', dataset: { part: key } });
    const b = partBlock(key, { short: true });
    row.append(b);
    if (opts.onPick) {
      row.classList.add('is-pickable');
      row.addEventListener('click', () => { if (!b.classList.contains('is-off')) opts.onPick(key); });
    }
    root.append(row);
    blocks[key] = b;
  }
  let total = null, vitals = null, fxList = null;
  if (opts.total !== false) {
    total = totalRow();
    root.append(el('div', { class: 'hl__foot' }, total));
  }
  if (opts.vitals) {
    vitals = el('div', { class: 'hl__vitals' },
      el('div', { class: 'hb-vital', dataset: { key: 'hydration' } }, icon('water'), el('span', { class: 'hb-vital__v' })),
      el('div', { class: 'hb-vital', dataset: { key: 'energy' } }, icon('bolt'), el('span', { class: 'hb-vital__v' })));
    root.append(vitals);
  }
  if (opts.conditions) {
    fxList = el('div', { class: 'hl__conds' });
    root.append(fxList);
  }
  host.append(root);

  const sel = () => (typeof opts.selected === 'function' ? opts.selected() : opts.selected);
  const refresh = () => {
    const o = { can: opts.can, selected: sel() };
    for (const key of ORDER) {
      paintPart(blocks[key], health, key, o);
      blocks[key].parentElement.classList.toggle('is-off', !!(o.can && !o.can(key)));
      blocks[key].parentElement.classList.toggle('is-selected', o.selected === key);
    }
    const r = rates(health, !!opts.inRaid);
    if (total) paintTotal(total, health, r);
    if (vitals) {
      const set = (key, v, rt) => {
        const n = vitals.querySelector(`.hb-vital[data-key="${key}"]`);
        n.querySelector('.hb-vital__v').replaceChildren(digits(v), el('span', { class: 'hb-vital__max' }, '/100'), rateNode(rt));
        n.classList.toggle('is-low', v < 20);
      };
      set('hydration', health.hydration, r.hyRate);
      set('energy', health.energy, r.enRate);
    }
    if (fxList) {
      fxList.replaceChildren();
      const flags = health.flags();
      for (const f of flags) {
        const info = FX_INFO[f.type];
        if (!info) continue;
        const parts = health.effects.filter((e) => e.type === f.type && e.part && !(e.delay > 0)).map((e) => LABEL[e.part]);
        fxList.append(el('div', { class: `hl__cond${info.bad ? ' is-bad' : ' is-good'}`, title: fxHelp(f.type) },
          fxSquare(f.type, f.n),
          el('span', { class: 'hl__cond-name' }, info.name),
          el('span', { class: 'hl__cond-where' }, parts.join(', ')),
          el('span', { class: 'hl__cond-t' }, f.t != null && f.t !== Infinity ? fmtDur(f.t) : '')));
      }
      if (!flags.length) fxList.append(el('div', { class: 'hl__cond hl__cond--none' }, 'NO CONDITIONS'));
    }
  };
  refresh();
  return { refresh, root };
}

/** the raid overlay's block: the strip with the pool, the vitals and the conditions */
export function renderHealthPanel(host, health, opts = {}) {
  return renderHealthList(host, health, { total: true, vitals: true, conditions: true, inRaid: true, ...opts });
}

// ---------------------------------------------------------
// choosing a body part for a med
// ---------------------------------------------------------
/**
 * The strip the game drops down when a med is picked: every part a row, the
 * ones the med can help lit, the rest dim with the reason. Resolves the
 * part, or null on cancel.
 */
export function bodyPartDialog(item, health, opts = {}) {
  return new Promise((resolve) => {
    let settled = false;
    let picked = opts.selected || health.bestPart(item);
    const tpl = item.tpl;
    openModal((box, done) => {
      box.classList.add('bodypick');
      const can = (k) => health.plan(item, k).ok;
      const info = el('div', { class: 'bodypick__info' });
      const accept = el('button', { class: 'btn btn--primary', disabled: !picked }, 'APPLY');
      const paintInfo = () => {
        info.replaceChildren();
        if (!picked) { info.append(el('span', { class: 'muted' }, 'Pick a body part')); accept.disabled = true; return; }
        const pl = health.plan(item, picked);
        info.append(el('span', { class: 'bodypick__part' }, LABEL[picked]));
        info.append(el('span', { class: pl.ok ? 'bodypick__note' : 'bodypick__note is-bad' }, pl.ok ? pl.note : pl.reason));
        if (pl.ok && pl.kind === 'medkit') info.append(el('span', { class: 'hint' }, `costs ${pl.cost} of ${Math.round(item.res ?? 0)}`));
        if (pl.ok) info.append(el('span', { class: 'hint' }, `${(pl.time * health.useMult()).toFixed(1)}s`));
        accept.disabled = !pl.ok;
      };
      const listHost = el('div', { class: 'bodypick__list' });
      let list = null;
      const pick = (k) => { picked = k; list.refresh(); paintInfo(); };
      list = renderHealthList(listHost, health, { can, onPick: pick, selected: () => picked, total: false });
      paintInfo();
      accept.addEventListener('click', () => { settled = true; done(); resolve(picked); });
      const art = el('div', { class: 'bodypick__item' });
      if (tpl.imgUrl) art.append(el('img', { src: tpl.imgUrl, alt: '' }));
      art.append(el('span', {}, tpl.name));
      box.append(
        el('div', { class: 'modal__head bodypick__head' }, 'SELECT BODY PART'),
        el('div', { class: 'modal__body bodypick__body' }, art, listHost, info),
        el('div', { class: 'modal__foot' },
          el('button', { class: 'btn', onclick: () => { settled = true; done(); resolve(null); } }, 'CANCEL'),
          accept));
    }, { onClose: () => { if (!settled) resolve(null); } });
  });
}

/** the USE action for a med, in a raid: pick a part if the med wants one, then start the channel */
export async function useInRaid(raid, item) {
  const tpl = item.tpl;
  if (!tpl.med) return;
  if (raid.using) { raidToast('Already treating', 'warn'); return; }
  let part = null;
  if (Health.needsPart(tpl)) {
    if (!raid.health.bestPart(item)) {
      const why = PARTS.map((p) => raid.health.plan(item, p.key).reason).find((r) => r && !/Pick|Not bleeding|Not fractured|Not destroyed|Nothing/.test(r));
      raidToast(why || 'Nothing to treat', 'warn');
      return;
    }
    part = await bodyPartDialog(item, raid.health);
    if (!part) return;
  }
  const r = raid.beginUse(item, part);
  if (!r.ok) raidToast(r.reason || 'Cannot use that', 'warn');
}

/** the USE action for a med out of a raid: same rules, no channel */
export async function useInHideout(item) {
  const tpl = item.tpl;
  const h = game.health;
  if (!tpl.med || !h) return;
  let part = null;
  if (Health.needsPart(tpl)) {
    if (!h.bestPart(item)) { toast('Nothing to treat', 'warn'); return; }
    part = await bodyPartDialog(item, h);
    if (!part) return;
  }
  const pl = h.apply(item, part, null);
  if (!pl.ok) { toast(pl.reason, 'warn'); return; }
  sfx.use(tpl);
  const where = part ? ` — ${LABEL[part].toLowerCase()}` : '';
  toast(`${tpl.short || tpl.name}${where}: ${pl.note}`, 'ok');
  if ((item.res ?? 0) <= 0) detach(item);
  dndContext.onChange?.();
  emit(EV.HEALTH_CHANGED);
  saveSoon();
}

// ---------------------------------------------------------
// the HUD figure and its stack of conditions
// ---------------------------------------------------------
let hudFig = null;
let hudFxSig = '';

/** the outline man for the corner of the screen; paintHudFigure() colours him */
export function buildHudFigure() {
  const svg = svgEl('svg', { viewBox: HUD_VIEWBOX.join(' '), class: 'hudfig' });
  for (const key of ORDER) {
    // the arms sit a touch clear of the torso, as on the game's figure
    const shift = key === 'rarm' ? 'translate(-3 0)' : key === 'larm' ? 'translate(3 0)' : null;
    svg.append(svgEl('path', { d: HUD_PARTS[key], class: 'hudfig__part', 'data-part': key, transform: shift }));
  }
  return svg;
}

/**
 * The game's monochrome scheme: grey outlines, a part goes red as it is
 * hurt (the more the redder), a destroyed part is solid black, and the part
 * a med is going onto fills solid green for the length of the use.
 */
export function paintHudFigure(svg, health, healing = null) {
  for (const key of ORDER) {
    const p = svg.querySelector(`[data-part="${key}"]`);
    if (!p) continue;
    const f = frac(health, key);
    const dead = health.isDestroyed(key);
    let stroke, fill;
    if (healing === key) { stroke = '#4fbf7d'; fill = '#35805a'; }
    else if (dead) { stroke = '#2a2a2a'; fill = '#060603'; }
    else if (f >= 0.999) { stroke = 'rgba(165,160,160,.85)'; fill = 'rgba(165,160,160,.3)'; }
    else {
      const k = 1 - f;   // 0 barely hurt .. 1 nearly gone
      stroke = `rgba(${Math.round(165 + (200 - 165) * k)},${Math.round(160 - 128 * k)},${Math.round(160 - 118 * k)},.9)`;
      fill = `rgba(${Math.round(77 + 58 * k)},${Math.round(9 + 36 * k)},${Math.round(11 + 36 * k)},${(0.3 + 0.25 * k).toFixed(2)})`;
    }
    // only touch the DOM when something changed: a restyle re-rasters the
    // glow filter, and doing that every frame for seven paths is a slow loop
    const sig = `${stroke}|${fill}`;
    if (p.dataset.sig !== sig) {
      p.dataset.sig = sig;
      p.style.stroke = stroke;
      p.style.fill = fill;
      p.classList.toggle('is-dead', dead);
    }
  }
}

export function mountHudHealth(health) {
  const host = $('#hud-body');
  if (!host) return;
  host.replaceChildren();
  hudFig = buildHudFigure();
  host.append(hudFig);
  paintHudFigure(hudFig, health);
  hudFxSig = '';
  const fx = $('#hud-fx');
  if (fx) fx.replaceChildren();
}

export function drawHudHealth(raid) {
  const h = raid.health;
  if (!hudFig || !hudFig.isConnected) mountHudHealth(h);
  else paintHudFigure(hudFig, h, raid.using?.part || null);
  const wrap = $('#hud-health');
  if (wrap) {
    wrap.classList.toggle('is-low', h.lowHp);
    wrap.classList.toggle('is-pain', h.inPain);
  }
  // the stack of conditions beside him rebuilds only when the set changes
  const flags = h.flags();
  const sig = flags.map((f) => `${f.type}${f.n}`).join('|');
  const fxHost = $('#hud-fx');
  if (fxHost && sig !== hudFxSig) {
    hudFxSig = sig;
    fxHost.replaceChildren();
    for (const f of flags) {
      const n = fxSquare(f.type, f.n, null, 'hudfx');
      if (n) fxHost.append(n);
    }
  }
  // the med being applied
  const mp = $('#med-prompt');
  if (mp) {
    const u = raid.using;
    if (u) {
      mp.hidden = false;
      const where = u.part ? ` — ${LABEL[u.part]}` : '';
      $('#med-label').textContent = `${(u.item.tpl.short || u.item.tpl.name).toUpperCase()}${where}`;
      $('#med-fill').style.width = `${Math.round((u.t / u.dur) * 100)}%`;
    } else {
      mp.hidden = true;
    }
  }
}

// ---------------------------------------------------------
// hideout HEALTH pane
// ---------------------------------------------------------
let paneBoard = null;
let stashHostRender = null;

/** the trial period and the Therapist's bill */
export function treatmentQuote() {
  const h = game.health;
  const cost = h.treatmentCost();
  const free = game.profile.level <= G.heal.trialLevels && game.profile.raids <= G.heal.trialRaids;
  return { cost: free ? 0 : cost, listed: cost, free, needed: cost > 0 };
}

export function initHealthPane(renderStashGrid) {
  stashHostRender = renderStashGrid;
  on(EV.HEALTH_CHANGED, () => refreshHealthPane());
  on(EV.INVENTORY_CHANGED, () => { if ($('#pane-health')?.classList.contains('is-active')) renderHealthStash(); });

  // the body keeps mending in real time while you are home; a save now and
  // then so a closed tab does not lose the minutes
  let sinceSave = 0;
  setInterval(() => {
    if (!game.health) return;
    const inRaid = $('#screen-raid')?.classList.contains('is-active');
    if (inRaid) return;
    game.health.regen(1);
    sinceSave += 1;
    if ($('#pane-health')?.classList.contains('is-active')) refreshHealthPane();
    if (sinceSave >= 30) { sinceSave = 0; saveSoon(); }
  }, 1000);
}

export function renderHealthPane() {
  const host = $('#health-panel-host');
  if (!host) return;
  const foot = el('div', { class: 'hb__foot' });
  const btn = el('button', { class: 'btn btn--primary', id: 'btn-treat' }, 'TREATMENT');
  const note = el('div', { class: 'hb__foot-note' });
  foot.append(el('div', { class: 'hb__foot-row' }, btn, note));
  foot.append(el('div', { class: 'hint' }, 'right-click a med in the stash to use it · the body mends on its own over time'));
  btn.addEventListener('click', async () => {
    const q = treatmentQuote();
    if (!q.needed) { toast('Nothing to treat', 'info'); return; }
    if (q.cost > 0) {
      if (countMoney('RUB') < q.cost) { toast(`Therapist wants ${fmtNum(q.cost)} ₽`, 'warn'); return; }
      takeMoney(q.cost, 'RUB');
    }
    game.health.treatAll();
    sfx.trade('deal');
    toast(q.free ? 'Treated — on the house while you are new' : `Treated for ${fmtNum(q.cost)} ₽`, 'ok');
    refreshHealthPane();
    emit(EV.INVENTORY_CHANGED);
    saveSoon();
  });
  paneBoard = renderHealthBoard(host, game.health, { footer: foot });
  paneBoard.note = note;
  paneBoard.btn = btn;
  refreshHealthPane();
  renderHealthStash();
}

export function refreshHealthPane() {
  if (!paneBoard || !$('#health-panel-host')?.isConnected) return;
  paneBoard.refresh();
  const q = treatmentQuote();
  paneBoard.btn.disabled = !q.needed;
  paneBoard.note.textContent = !q.needed ? 'Fit for duty'
    : q.free ? `Therapist · free (trial: level ≤ ${G.heal.trialLevels}, ≤ ${G.heal.trialRaids} raids) · would be ${fmtNum(q.listed)} ₽`
      : `Therapist · ${fmtNum(q.cost)} ₽`;
}

function renderHealthStash() {
  const host = $('#health-stash-host');
  if (!host) return;
  keepScroll([host], () => {
    host.replaceChildren();
    host.append(renderGrid(game.stash));
  });
  stashHostRender?.(host);
}
