// =========================================================
// after the raid
//
// The game walks you out the way it walked you in, a screen at a time:
// how it ended (SURVIVED, KILLED IN ACTION, MISSING IN ACTION, RUN THROUGH)
// with where and how long, then the kill list, the raid's statistics, the
// experience it was worth line by line, and NEXT on each until the last one
// puts you back in the main menu.
// =========================================================

import { $, el, fmtNum, fmtClock } from '../core/util.js';
import { game } from '../core/state.js';
import { sfx } from '../core/audio.js';
import { renderItem } from '../inventory/view.js';
import { locationName, levelProgress } from '../game/db.js';
import { showScreen } from './shell.js';

let result = null;
let done = () => {};
let step = 0;

const STEPS = ['status', 'kills', 'stats', 'exp'];

const VERDICT = {
  survived: { title: 'SURVIVED', cls: 'is-ok' },
  runner: { title: 'RUN THROUGH', cls: 'is-warn' },
  kia: { title: 'KILLED IN ACTION', cls: 'is-bad' },
  mia: { title: 'MISSING IN ACTION', cls: 'is-bad' },
  left: { title: 'LEFT THE ACTION', cls: 'is-bad' },
};

const PART_LABEL = {
  head: 'Head', thorax: 'Thorax', stomach: 'Stomach', larm: 'Left arm',
  rarm: 'Right arm', lleg: 'Left leg', rleg: 'Right leg',
};

export function openRaidEnd(res, onDone) {
  result = res;
  done = onDone || (() => {});
  step = 0;
  showScreen('raidend');
  render();
}

function next() {
  sfx.ui('click');
  if (step >= STEPS.length - 1) { const d = done; result = null; d(); return; }
  step++;
  render();
}

function frame(title, body, { cls = '' } = {}) {
  const host = $('#raidend-host');
  host.replaceChildren();
  const foot = el('div', { class: 'pr__foot' });
  if (step > 0) {
    const b = el('button', { class: 'ebtn ebtn--back', dataset: { sfx: 'own' } }, 'BACK');
    b.addEventListener('click', () => { sfx.ui('click'); step--; render(); });
    foot.append(b);
  } else foot.append(el('span', {}));
  const n = el('button', { class: 'ebtn ebtn--go', dataset: { sfx: 'own' } }, step >= STEPS.length - 1 ? 'MAIN MENU' : 'NEXT');
  n.addEventListener('click', next);
  foot.append(n);
  host.append(el('div', { class: `re__title ${cls}` }, title), el('div', { class: 're__body' }, body), foot);
}

function render() {
  if (!result) return;
  const s = STEPS[step];
  if (s === 'status') return renderStatus();
  if (s === 'kills') return renderKills();
  if (s === 'stats') return renderStats();
  return renderExp();
}

function renderStatus() {
  const v = VERDICT[result.statusKey] || VERDICT[result.status] || { title: 'RAID ENDED', cls: '' };
  const where = result.location ? locationName(result.location) : result.map;
  const body = el('div', { class: 're-status' },
    el('div', { class: `re-status__verdict ${v.cls}` }, v.title),
    el('div', { class: 're-status__sub' }, where.toUpperCase()),
    el('dl', { class: 're-rows' },
      el('dt', {}, 'Raid time'), el('dd', {}, fmtClock(result.duration || 0)),
      el('dt', {}, 'Exit'), el('dd', {}, result.extract ? result.extract.name : '—'),
      el('dt', {}, 'Killed'), el('dd', {}, String((result.killLog || []).length || result.kills || 0)),
      result.killer ? el('dt', {}, 'Killed by') : null,
      result.killer ? el('dd', {}, `${result.killer.name}${result.killer.weapon ? ` · ${result.killer.weapon}` : ''}${result.killer.part ? ` · ${PART_LABEL[result.killer.part] || result.killer.part}` : ''}`) : null));
  frame('RAID ENDED', body, { cls: v.cls });
}

function renderKills() {
  const log = result.killLog || [];
  const table = el('div', { class: 're-kills' },
    el('div', { class: 're-kill re-kill--head' },
      el('span', {}, '#'), el('span', {}, 'Time'), el('span', {}, 'Player'), el('span', {}, 'LVL'),
      el('span', {}, 'Faction'), el('span', {}, 'Status')));
  log.forEach((k, i) => {
    table.append(el('div', { class: 're-kill' },
      el('span', {}, String(i + 1)),
      el('span', {}, fmtClock(k.time || 0)),
      el('span', {}, k.name || 'Scav'),
      el('span', {}, String(k.level || 1)),
      el('span', {}, k.side === 'pmc' ? (k.faction || 'PMC') : 'Scav'),
      el('span', {}, `Killed${k.weaponName ? ` · ${k.weaponName}` : ''}${k.part ? ` · ${PART_LABEL[k.part] || k.part}` : ''} · ${fmtNum(k.dist || 0)} m`)));
  });
  if (!log.length) table.append(el('div', { class: 'tl-empty' }, 'No kills'));
  frame('KILL LIST', table);
}

function renderStats() {
  const st = result;
  const kept = st.kept || [];
  const lost = st.lost || [];
  const rows = el('dl', { class: 're-rows re-rows--wide' },
    el('dt', {}, 'Raid time'), el('dd', {}, fmtClock(st.duration || 0)),
    el('dt', {}, 'Containers searched'), el('dd', {}, String(st.searched || 0)),
    el('dt', {}, 'Rounds fired'), el('dd', {}, String(st.shots || 0)),
    el('dt', {}, 'Kills'), el('dd', {}, String((st.killLog || []).length || st.kills || 0)),
    el('dt', {}, 'Floors visited'), el('dd', {}, String(st.floors || 1)),
    el('dt', {}, 'Value brought out'), el('dd', {}, `${fmtNum(st.value || 0)} ₽`),
    el('dt', {}, 'Health'), el('dd', {}, game.health ? `${Math.ceil(game.health.total)} / ${game.health.max}` : '—'));

  const strip = (title, items) => {
    const wrap = el('div', { class: 're-loot' }, el('div', { class: 'td__sec' }, title));
    const list = el('div', { class: 're-loot__list' });
    for (const it of items.slice(0, 40)) list.append(renderItem(it, { static: true }));
    if (!items.length) list.append(el('div', { class: 'tl-empty' }, 'Nothing'));
    wrap.append(list);
    return wrap;
  };
  const body = el('div', { class: 're-stats' }, rows,
    strip(st.status === 'survived' ? 'Brought out' : 'Kept in the secure container', kept));
  if (lost.length) body.append(strip(`Lost — ${lost.length} item${lost.length > 1 ? 's' : ''}`, lost));
  frame('STATISTICS', body);
}

function renderExp() {
  const lines = result.expLines || [];
  const total = result.exp ?? lines.reduce((n, l) => n + l[1], 0);
  const p = game.profile;
  const [into, span] = levelProgress(p.exp);
  const table = el('div', { class: 're-exp' });
  for (const [label, v] of lines) {
    table.append(el('div', { class: 're-exp__row' }, el('span', {}, label), el('b', {}, `+${fmtNum(v)}`)));
  }
  if (!lines.length) table.append(el('div', { class: 're-exp__row' }, el('span', {}, 'Raid'), el('b', {}, `+${fmtNum(total)}`)));
  table.append(el('div', { class: 're-exp__row re-exp__row--total' }, el('span', {}, 'Total'), el('b', {}, `+${fmtNum(total)}`)));
  frame('EXPERIENCE', el('div', { class: 're-expwrap' },
    table,
    el('div', { class: 're-exp__level' },
      el('div', { class: 're-exp__lvl' }, `LEVEL ${p.level}`),
      el('div', { class: 'xpbar xpbar--big' }, el('i', { style: { width: span ? `${(into / span) * 100}%` : '100%' } })),
      el('div', { class: 're-exp__num' }, span ? `${fmtNum(into)} / ${fmtNum(span)}` : fmtNum(p.exp)))));
}

export function initRaidEnd() { /* nothing to wire: openRaidEnd is called by whoever ended the raid */ }
