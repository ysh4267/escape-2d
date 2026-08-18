// =========================================================
// health interface: the body doll, the health panel, the med dialogs, the
// HUD strip and the hideout HEALTH pane
//
// One doll drawn from one geometry table serves every place the body is
// shown: the HUD corner, the in-raid inventory, the hideout pane and the
// "which part" dialog a medkit opens. Each part is coloured by how much of
// it is left, the way the character screen does it, and carries the icons
// of whatever is wrong with it.
// =========================================================

import { $, el, icon, clamp, fmtNum, keepScroll } from '../core/util.js';
import { game, saveSoon, countMoney, takeMoney } from '../core/state.js';
import { PARTS, PART, FX, FX_INFO, Health, fmtDur, G } from '../raid/health.js';
import { openModal } from '../inventory/dialogs.js';
import { renderGrid } from '../inventory/view.js';
import { detach } from '../inventory/model.js';
import { dndContext } from '../inventory/dnd.js';
import { sfx } from '../core/audio.js';
import { emit, on, EV } from '../core/events.js';
import { toast, raidToast } from './shell.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
let dollSeq = 0;

/** the doll, in a 120 x 240 box */
const DOLL = {
  head:    { d: 'M60 6a18 18 0 1 1 0 36a18 18 0 1 1 0-36z', lx: 60, ly: 27 },
  thorax:  { d: 'M40 46h40a4 4 0 0 1 4 4v42h-48v-42a4 4 0 0 1 4-4z', lx: 60, ly: 72 },
  stomach: { d: 'M36 96h48v26a4 4 0 0 1-4 4h-40a4 4 0 0 1-4-4z', lx: 60, ly: 114 },
  larm:    { d: 'M12 58a10 10 0 0 1 10-10h4a8 8 0 0 1 8 8v70a10 10 0 0 1-20 0z', lx: 23, ly: 92 },
  rarm:    { d: 'M86 56a8 8 0 0 1 8-8h4a10 10 0 0 1 10 10v66a10 10 0 0 1-20 0z', lx: 97, ly: 92 },
  lleg:    { d: 'M38 130h20v92a10 10 0 0 1-20 0z', lx: 48, ly: 180 },
  rleg:    { d: 'M62 130h20v92a10 10 0 0 1-20 0z', lx: 72, ly: 180 },
};

// ---------------------------------------------------------
// the doll
// ---------------------------------------------------------
function svgEl(tag, attrs = {}) {
  const n = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) n.setAttribute(k, String(v));
  return n;
}

/** which colour band a part sits in */
export function partState(health, key) {
  const p = health.parts[key];
  if (p.hp <= 0) return 'dead';
  const r = p.hp / p.max;
  if (r > 0.75) return 'fine';
  if (r > 0.4) return 'hurt';
  return 'bad';
}

/**
 * Build the doll. `opts.onPick(part)` makes the parts buttons; `opts.can(part)`
 * decides which of them are enabled. Call `paintDoll` to recolour it later.
 */
export function buildDoll(health, opts = {}) {
  const svg = svgEl('svg', { viewBox: '0 0 120 240', class: `doll ${opts.class || ''}` });
  if (opts.title) { const t = svgEl('title'); t.textContent = opts.title; svg.append(t); }
  // hatch for destroyed parts
  // one hatch per doll: a pattern shared by id resolves to the first in the
  // document, which may sit inside a hidden screen and then paints nothing
  const hatchId = `doll-hatch-${++dollSeq}`;
  const defs = svgEl('defs');
  const pat = svgEl('pattern', { id: hatchId, width: 6, height: 6, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' });
  pat.append(svgEl('rect', { width: 6, height: 6, fill: '#1a0908' }));
  pat.append(svgEl('rect', { width: 2, height: 6, fill: '#5a1d18' }));
  defs.append(pat);
  svg.append(defs);
  svg.style.setProperty('--hatch', `url(#${hatchId})`);
  for (const def of PARTS) {
    const g = svgEl('g', { class: 'doll__part', 'data-part': def.key });
    const path = svgEl('path', { d: DOLL[def.key].d, class: 'doll__shape' });
    g.append(path);
    if (opts.onPick) {
      g.classList.add('is-pickable');
      g.setAttribute('tabindex', '0');
      g.setAttribute('role', 'button');
      g.addEventListener('click', () => { if (!g.classList.contains('is-off')) opts.onPick(def.key); });
      g.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && !g.classList.contains('is-off')) opts.onPick(def.key); });
    }
    if (opts.hp !== false) {
      const t = svgEl('text', { x: DOLL[def.key].lx, y: DOLL[def.key].ly, class: 'doll__hp', 'text-anchor': 'middle', 'dominant-baseline': 'middle' });
      g.append(t);
    }
    svg.append(g);
  }
  paintDoll(svg, health, opts);
  return svg;
}

export function paintDoll(svg, health, opts = {}) {
  for (const def of PARTS) {
    const g = svg.querySelector(`[data-part="${def.key}"]`);
    if (!g) continue;
    const st = partState(health, def.key);
    g.dataset.state = st;
    const p = health.parts[def.key];
    g.classList.toggle('is-off', !!(opts.can && !opts.can(def.key)));
    g.classList.toggle('is-selected', opts.selected === def.key);
    g.classList.toggle('is-bleeding', health.has(FX.HB, def.key) || health.has(FX.LB, def.key));
    g.classList.toggle('is-fractured', health.has(FX.FR, def.key));
    const t = g.querySelector('.doll__hp');
    if (t) t.textContent = st === 'dead' ? '0' : String(Math.ceil(p.hp));
    // give the shape a title tooltip that reads like the game's
    let title = g.querySelector('title');
    if (!title) { title = svgEl('title'); g.prepend(title); }
    const fx = health.partFx(def.key).map((f) => FX_INFO[f]?.name).filter(Boolean);
    title.textContent = `${def.name} ${Math.ceil(p.hp)}/${p.max}${fx.length ? ' — ' + fx.join(', ') : ''}`;
  }
}

// ---------------------------------------------------------
// the health panel: doll + rows + vitals + conditions
// ---------------------------------------------------------
/**
 * The full character-screen health block. Returns a `refresh()` that repaints
 * the numbers in place. `opts.compact` drops the condition list (the in-raid
 * overlay), `opts.footer` is appended under the vitals (the hideout adds the
 * Therapist button there), `opts.onPick(part)` makes the parts clickable.
 */
export function renderHealthPanel(host, health, opts = {}) {
  host.replaceChildren();
  const root = el('div', { class: `health${opts.compact ? ' health--compact' : ''}` });

  const dollWrap = el('div', { class: 'health__doll' });
  const doll = buildDoll(health, { onPick: opts.onPick, can: opts.can, selected: opts.selected });
  dollWrap.append(doll);

  const rows = el('div', { class: 'health__rows' });
  const rowNodes = {};
  for (const def of PARTS) {
    const r = el('div', { class: 'hrow', dataset: { part: def.key } },
      el('span', { class: 'hrow__name' }, def.name.toUpperCase()),
      el('div', { class: 'hrow__bar' }, el('i')),
      el('span', { class: 'hrow__num' }, ''),
      el('span', { class: 'hrow__fx' }));
    if (opts.onPick) {
      r.classList.add('is-pickable');
      r.addEventListener('click', () => { if (!r.classList.contains('is-off')) opts.onPick(def.key); });
    }
    rows.append(r);
    rowNodes[def.key] = r;
  }

  const total = el('div', { class: 'health__total' },
    el('span', { class: 'health__total-k' }, 'HEALTH'),
    el('span', { class: 'health__total-v' }, ''),
    el('span', { class: 'health__total-max' }, ''));

  const vitals = el('div', { class: 'health__vitals' });
  const vital = (key, label, ico) => {
    const n = el('div', { class: 'vrow', dataset: { key } },
      icon(ico), el('span', { class: 'vrow__k' }, label),
      el('div', { class: 'vrow__bar' }, el('i')), el('span', { class: 'vrow__num' }, ''));
    vitals.append(n);
    return n;
  };
  const enRow = vital('en', 'ENERGY', 'energy');
  const hyRow = vital('hy', 'HYDRATION', 'water');

  const fxList = opts.compact ? null : el('div', { class: 'health__fx' });

  const left = el('div', { class: 'health__left' }, dollWrap, total);
  const right = el('div', { class: 'health__right' }, rows, vitals);
  if (fxList) right.append(fxList);
  if (opts.footer) right.append(opts.footer);
  root.append(left, right);
  host.append(root);

  const refresh = () => {
    paintDoll(doll, health, { can: opts.can, selected: opts.selected });
    for (const def of PARTS) {
      const r = rowNodes[def.key];
      const p = health.parts[def.key];
      const st = partState(health, def.key);
      r.dataset.state = st;
      r.classList.toggle('is-off', !!(opts.can && !opts.can(def.key)));
      r.classList.toggle('is-selected', opts.selected === def.key);
      r.querySelector('.hrow__bar > i').style.width = `${(p.hp / def.max) * 100}%`;
      // a surgery-lowered ceiling shows as a dim cap on the bar
      r.querySelector('.hrow__bar').style.setProperty('--cap', `${(p.max / def.max) * 100}%`);
      r.querySelector('.hrow__num').textContent = `${Math.ceil(p.hp)}/${p.max}`;
      const fxHost = r.querySelector('.hrow__fx');
      fxHost.replaceChildren();
      for (const f of health.partFx(def.key)) {
        const info = FX_INFO[f];
        if (!info) continue;
        const i = icon(info.icon, `ico fxi${info.bad ? ' fxi--bad' : ''}`);
        const t = svgEl('title'); t.textContent = info.name; i.append(t);
        fxHost.append(i);
      }
    }
    total.querySelector('.health__total-v').textContent = String(Math.ceil(health.total));
    total.querySelector('.health__total-max').textContent = `/ ${health.max}`;
    total.classList.toggle('is-low', health.lowHp);
    const paintV = (row, v) => {
      row.querySelector('.vrow__bar > i').style.width = `${v}%`;
      row.querySelector('.vrow__num').textContent = `${Math.round(v)}/100`;
      row.classList.toggle('is-low', v < 20);
    };
    paintV(enRow, health.energy);
    paintV(hyRow, health.hydration);

    if (fxList) {
      fxList.replaceChildren();
      const flags = health.flags();
      if (!flags.length) fxList.append(el('div', { class: 'health__fx-none' }, 'NO CONDITIONS'));
      for (const f of flags) {
        const info = FX_INFO[f.type];
        if (!info) continue;
        const parts = health.effects.filter((e) => e.type === f.type && e.part && !(e.delay > 0)).map((e) => PART[e.part].name);
        const line = el('div', { class: `fxline${info.bad ? ' fxline--bad' : ' fxline--good'}` },
          icon(info.icon, 'ico'),
          el('span', { class: 'fxline__name' }, info.name + (f.n > 1 ? ` ×${f.n}` : '')),
          el('span', { class: 'fxline__where' }, parts.join(', ')),
          el('span', { class: 'fxline__t' }, f.t != null && f.t !== Infinity ? fmtDur(f.t) : ''));
        line.title = fxHelp(f.type);
        fxList.append(line);
      }
    }
  };
  refresh();
  return { refresh, doll, root };
}

/** one line on what a condition does to you, for the tooltip */
function fxHelp(type) {
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
// choosing a body part for a med
// ---------------------------------------------------------
/**
 * The dialog a medkit, bandage, splint or surgical kit opens: the doll with
 * the parts it can do something for lit, the rest greyed with the reason.
 * Resolves the part, or null on cancel.
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
        const def = PART[picked];
        info.append(el('span', { class: 'bodypick__part' }, def.name.toUpperCase()));
        info.append(el('span', { class: pl.ok ? 'bodypick__note' : 'bodypick__note is-bad' }, pl.ok ? pl.note : pl.reason));
        if (pl.ok && pl.kind === 'medkit') info.append(el('span', { class: 'hint' }, `costs ${pl.cost} of ${Math.round(item.res ?? 0)}`));
        if (pl.ok) info.append(el('span', { class: 'hint' }, `${(pl.time * health.useMult()).toFixed(1)}s`));
        accept.disabled = !pl.ok;
      };
      const panelHost = el('div', { class: 'bodypick__panel' });
      let panel = null;
      const pick = (k) => {
        picked = k;
        panel.refresh();
        paintInfo();
      };
      panel = renderHealthPanel(panelHost, health, {
        compact: true, can, onPick: pick,
        get selected() { return picked; },
      });
      panel.refresh();
      paintInfo();

      accept.addEventListener('click', () => { settled = true; done(); resolve(picked); });
      box.append(
        el('div', { class: 'modal__head' }, `${tpl.name.toUpperCase()} — SELECT BODY PART`),
        el('div', { class: 'modal__body bodypick__body' }, panelHost, info),
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
    // nothing this med can help with anywhere: say so instead of a dead dialog
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
  const where = part ? ` — ${PART[part].name.toLowerCase()}` : '';
  toast(`${tpl.short || tpl.name}${where}: ${pl.note}`, 'ok');
  if ((item.res ?? 0) <= 0) detach(item);
  dndContext.onChange?.();
  emit(EV.HEALTH_CHANGED);
  saveSoon();
}

// ---------------------------------------------------------
// the HUD strip
// ---------------------------------------------------------
let hudDoll = null;
let hudFxSig = '';

/** build the HUD's doll once; drawHudHealth() repaints it every frame */
export function mountHudHealth(health) {
  const host = $('#hud-body');
  if (!host) return;
  host.replaceChildren();
  hudDoll = buildDoll(health, { class: 'doll--hud', hp: false });
  host.append(hudDoll);
  hudFxSig = '';
}

export function drawHudHealth(raid) {
  const h = raid.health;
  if (!hudDoll) mountHudHealth(h);
  else paintDoll(hudDoll, h);
  const num = $('#hp-text');
  if (num) num.textContent = String(Math.ceil(h.total));
  const wrap = $('#hud-health');
  if (wrap) {
    wrap.classList.toggle('is-low', h.lowHp);
    wrap.classList.toggle('is-pain', h.inPain);
  }
  // the condition icons only rebuild when the set of them changes
  const flags = h.flags();
  const sig = flags.map((f) => `${f.type}${f.n}`).join('|');
  const fxHost = $('#hud-fx');
  if (fxHost && sig !== hudFxSig) {
    hudFxSig = sig;
    fxHost.replaceChildren();
    for (const f of flags) {
      const info = FX_INFO[f.type];
      if (!info) continue;
      const n = el('span', { class: `hudfx${info.bad ? ' hudfx--bad' : ' hudfx--good'}`, title: `${info.name}: ${fxHelp(f.type)}` },
        icon(info.icon), f.n > 1 ? el('b', {}, String(f.n)) : null);
      fxHost.append(n);
    }
  }
  // timers on the icons that have one, in place
  if (fxHost) {
    const nodes = fxHost.querySelectorAll('.hudfx');
    flags.forEach((f, i) => {
      const n = nodes[i];
      if (!n) return;
      const t = f.t != null && f.t !== Infinity ? fmtDur(f.t) : '';
      let tn = n.querySelector('.hudfx__t');
      if (t && !tn) { tn = el('span', { class: 'hudfx__t' }); n.append(tn); }
      if (tn) tn.textContent = t;
    });
  }
  // energy / hydration only when they matter
  const eh = $('#hud-eh');
  if (eh) {
    const show = h.energy < 30 || h.hydration < 30;
    eh.hidden = !show;
    if (show) {
      $('#hud-en').style.width = `${h.energy}%`;
      $('#hud-hy').style.width = `${h.hydration}%`;
      eh.classList.toggle('is-crit', h.energy <= 0 || h.hydration <= 0);
    }
  }
  // the med being applied
  const mp = $('#med-prompt');
  if (mp) {
    const u = raid.using;
    if (u) {
      mp.hidden = false;
      const where = u.part ? ` — ${PART[u.part].name.toUpperCase()}` : '';
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
let panePanel = null;
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
  const foot = el('div', { class: 'health__foot' });
  const btn = el('button', { class: 'btn btn--primary', id: 'btn-treat' }, 'TREATMENT');
  const note = el('div', { class: 'health__foot-note' });
  foot.append(el('div', { class: 'health__foot-row' }, btn, note));
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
  panePanel = renderHealthPanel(host, game.health, { footer: foot });
  panePanel.note = note;
  panePanel.btn = btn;
  refreshHealthPane();
  renderHealthStash();
}

export function refreshHealthPane() {
  if (!panePanel || !$('#health-panel-host')?.isConnected) return;
  panePanel.refresh();
  const q = treatmentQuote();
  panePanel.btn.disabled = !q.needed;
  panePanel.note.textContent = !q.needed ? 'Fit for duty'
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
