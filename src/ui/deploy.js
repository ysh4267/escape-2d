// =========================================================
// deploy pane: pick a map, read the brief, go
// =========================================================

import { $, el, icon, fmtWeight } from '../core/util.js';
import { MAPS, DEFAULT_MAP } from '../data/maps.js';
import { game } from '../core/state.js';

let selected = DEFAULT_MAP;
let onDeploy = () => {};
let geoCache = null;

export function initDeploy(geo, deployFn) {
  geoCache = geo;
  onDeploy = deployFn;
  renderDeploy();
}

export function renderDeploy() {
  const maps = $('#deploy-maps');
  const brief = $('#deploy-brief');
  if (!maps) return;

  maps.replaceChildren();
  for (const [id, m] of Object.entries(MAPS)) {
    const card = el('button', {
      class: `map-card${id === selected ? ' is-active' : ''}`,
      onclick: () => { selected = id; renderDeploy(); },
    });
    const art = el('div', { class: 'map-card__art' });
    const cv = el('canvas', { width: 520, height: 264 });
    art.append(cv);
    card.append(art);
    card.append(el('div', { class: 'map-card__meta' },
      el('div', { class: 'map-card__name' }, m.name),
      el('div', { class: 'map-card__sub' }, m.subtitle),
      el('div', { class: 'map-card__tags' }, ...m.tags.map((t) => el('span', { class: 'tagpill' }, t)))));
    maps.append(card);
    drawThumb(cv, m);
  }

  const m = MAPS[selected];
  brief.replaceChildren();

  const weight = game.equipment.weight();
  const hasGear = !!(game.equipment.item('rig') || game.equipment.item('backpack') || game.equipment.pockets.some((g) => g.count));

  brief.append(block('EXFILTRATION', m.extracts.filter((e) => e.side !== 'scav').map((e) =>
    el('div', { class: 'brief-row' },
      icon('extract'),
      el('b', {}, e.name),
      el('span', { class: 'muted' }, e.req ? 'LOCKED' : 'OPEN')))));

  brief.append(block('LOADOUT', [
    row('weight', 'Carried weight', `${fmtWeight(weight)} kg`),
    row('box', 'Rig', game.equipment.item('rig')?.tpl.name || '—'),
    row('box', 'Backpack', game.equipment.item('backpack')?.tpl.name || '—'),
    row('stash', 'Pouch', game.equipment.item('secure')?.tpl.name || '—'),
    row('crosshair', 'Primary', game.equipment.item('primary')?.tpl.name || '—'),
  ]));

  brief.append(block('RULES OF ENGAGEMENT', [
    note('Right-click the ground to move, right-click a container to search it.'),
    note('Anything you carry out is marked found in raid.'),
    note('Die or run out of time and only your secure container comes back.'),
  ]));

  const go = el('button', { class: 'btn btn--primary btn--lg', style: { width: '100%', justifyContent: 'center' } },
    icon('map'), 'DEPLOY');
  go.addEventListener('click', () => onDeploy(selected));
  brief.append(go);

  if (!hasGear) {
    brief.append(el('div', { class: 'brief-block', style: { borderColor: 'var(--warn-soft)' } },
      el('div', { class: 'brief-row' }, icon('warn'),
        el('span', { style: { color: 'var(--warn)' } }, 'You are deploying with nowhere to put loot. Equip a rig or backpack from the stash first.'))));
  }
}

function block(title, rows) {
  return el('div', { class: 'brief-block' }, el('h3', {}, title), el('div', { class: 'brief-list' }, ...rows));
}
function row(ic, k, v) {
  return el('div', { class: 'brief-row' }, icon(ic), el('b', {}, k), el('span', { class: 'muted' }, v));
}
function note(text) {
  return el('div', { class: 'brief-row' }, icon('info'), el('span', {}, text));
}

// ---------------------------------------------------------
function drawThumb(cv, m) {
  if (!geoCache) return;
  const g = cv.getContext('2d');
  const L = geoCache.levels[m.level];
  const [, , vw, vh] = geoCache.viewBox;
  const s = Math.min(cv.width / vw, cv.height / vh) * 0.94;
  const ox = (cv.width - vw * s) / 2;
  const oy = (cv.height - vh * s) / 2;

  g.fillStyle = '#05090b';
  g.fillRect(0, 0, cv.width, cv.height);

  g.beginPath();
  for (const poly of L.floor) {
    poly.forEach((p, i) => {
      const x = ox + p[0] * s, y = oy + p[1] * s;
      i ? g.lineTo(x, y) : g.moveTo(x, y);
    });
    g.closePath();
  }
  g.fillStyle = '#2f4550';
  g.fill('evenodd');

  g.fillStyle = '#16232b';
  for (const poly of [...(L.obstacles || []), ...(L.building || [])]) {
    g.beginPath();
    poly.forEach((p, i) => {
      const x = ox + p[0] * s, y = oy + p[1] * s;
      i ? g.lineTo(x, y) : g.moveTo(x, y);
    });
    g.closePath();
    g.fill();
  }

  g.strokeStyle = '#586f7c';
  g.lineWidth = 1;
  for (const line of L.walls || []) {
    g.beginPath();
    line.forEach((p, i) => {
      const x = ox + p[0] * s, y = oy + p[1] * s;
      i ? g.lineTo(x, y) : g.moveTo(x, y);
    });
    g.stroke();
  }

  for (const e of m.extracts) {
    g.fillStyle = e.side === 'scav' ? 'rgba(217,164,65,.9)' : 'rgba(127,179,154,.95)';
    g.beginPath();
    g.arc(ox + e.x * s, oy + e.y * s, 3.4, 0, Math.PI * 2);
    g.fill();
  }
}

export function selectedMap() { return selected; }
