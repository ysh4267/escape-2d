// =========================================================
// the hideout
//
// The game's own stations with what each level asks for - items, other
// stations, a trader's loyalty, a skill - and a button that builds the next
// level out of the stash when all of it is there. A level is recorded on the
// profile; the stash station is the one whose levels change something you
// can see at once (the stash grows to the next edition's size).
// =========================================================

import { $, el, fmtNum } from '../core/util.js';
import { on, emit, EV } from '../core/events.js';
import { game, saveSoon, countMoney, takeMoney } from '../core/state.js';
import { sfx } from '../core/audio.js';
import { detach } from '../inventory/model.js';
import { DB, loadHideout, tplOf, itemName, CUR_OF_ITEM, CUR_SYM } from '../game/db.js';
import { loyaltyLevel } from '../game/traders.js';
import { skillLevel, skillName } from '../game/skills.js';
import { currentScreen, toast } from './shell.js';

let selected = null;

function levels() {
  const p = game.profile;
  if (!p.hideout || typeof p.hideout !== 'object') p.hideout = {};
  return p.hideout;
}

export function stationLevel(id) { return levels()[id] || 0; }

function* stashItems() {
  const walk = function* (grids) {
    for (const g of grids) for (const it of g.items()) { yield it; if (it.grids) yield* walk(it.grids); }
  };
  yield* walk([game.stash]);
}

function haveItem(id) {
  const cur = CUR_OF_ITEM[id];
  if (cur) return countMoney(cur);
  let n = 0;
  for (const it of stashItems()) if (it.tpl.id === id) n += it.stack || 1;
  return n;
}

function takeItem(id, n) {
  const cur = CUR_OF_ITEM[id];
  if (cur) return takeMoney(n, cur);
  let left = n;
  for (const it of [...stashItems()]) {
    if (left <= 0) break;
    if (it.tpl.id !== id) continue;
    const k = Math.min(it.stack || 1, left);
    it.stack -= k; left -= k;
    if (it.stack <= 0) detach(it);
  }
  return left <= 0;
}

function requirementsOf(lv) {
  const rows = [];
  for (const [id, n] of lv.items || []) {
    const have = haveItem(id);
    const cur = CUR_OF_ITEM[id];
    rows.push({ ok: have >= n, text: cur ? `${fmtNum(n)} ${CUR_SYM[cur]}` : `${itemName(id)} x${fmtNum(n)}`, have, need: n, known: !!tplOf(id) });
  }
  for (const [sid, need] of lv.stations || []) {
    const s = DB.hideout.stations.find((x) => x.id === sid);
    rows.push({ ok: stationLevel(sid) >= need, text: `${s ? s.name : 'Station'} level ${need}` });
  }
  for (const [skill, need] of lv.skills || []) rows.push({ ok: skillLevel(skill) >= need, text: `${skillName(skill)} level ${need}` });
  for (const [tid, need] of lv.traders || []) {
    const t = DB.traderById[tid];
    rows.push({ ok: t ? loyaltyLevel(t) >= need : false, text: `${t ? t.name : 'Trader'} loyalty level ${need}` });
  }
  return rows;
}

const STASH_ROWS = [30, 40, 50, 68];

function build(station, lv) {
  const reqs = requirementsOf(lv);
  if (!reqs.every((r) => r.ok)) { toast('Requirements are not fulfilled', 'warn'); return; }
  for (const [id, n] of lv.items || []) takeItem(id, n);
  levels()[station.id] = lv.level;
  sfx.cue('ui_popup_open');
  // the stash station: each level is the next edition's stash
  if (station.key === 'stash' && STASH_ROWS[lv.level - 1] && STASH_ROWS[lv.level - 1] > game.stash.h) {
    game.stash.resize(game.stash.w, STASH_ROWS[lv.level - 1]);
    game.profile.stashRows = game.stash.h;
  }
  toast(`${station.name} level ${lv.level} built`, 'ok');
  emit(EV.INVENTORY_CHANGED);
  saveSoon();
  renderHideout();
}

export async function renderHideout() {
  const host = $('#hideout-host');
  if (!host) return;
  if (!DB.hideout) {
    host.replaceChildren(el('div', { class: 'tl-empty' }, 'Loading'));
    try { await loadHideout(); } catch { host.replaceChildren(el('div', { class: 'tl-empty' }, 'The hideout could not be loaded')); return; }
    if (currentScreen() !== 'hideout') return;
  }
  host.replaceChildren();
  const stations = DB.hideout.stations.filter((s) => s.levels && s.levels.length);
  if (!selected || !stations.some((s) => s.id === selected)) selected = stations[0]?.id || null;

  const list = el('div', { class: 'ho__list' }, el('div', { class: 'msg__title' }, 'HIDEOUT'));
  for (const s of stations) {
    const lvl = stationLevel(s.id);
    const max = s.levels.length;
    const next = s.levels.find((l) => l.level === lvl + 1);
    const ready = next && requirementsOf(next).every((r) => r.ok);
    const b = el('button', { class: `ho-row${s.id === selected ? ' is-active' : ''}${ready ? ' is-ready' : ''}`, dataset: { sfx: 'own' } },
      el('span', { class: 'ho-row__name' }, s.name),
      el('span', { class: 'ho-row__lvl' }, lvl >= max ? `Level ${lvl} (max)` : `Level ${lvl}/${max}`));
    b.addEventListener('click', () => { selected = s.id; sfx.ui('click'); renderHideout(); });
    list.append(b);
  }

  const detail = el('div', { class: 'ho__detail' });
  const s = stations.find((x) => x.id === selected);
  if (s) {
    const lvl = stationLevel(s.id);
    const next = s.levels.find((l) => l.level === lvl + 1);
    detail.append(el('div', { class: 'hb__name' }, s.name), el('div', { class: 'hb__meta' }, `Current level: ${lvl}`));
    if (!next) detail.append(el('div', { class: 'tl-empty' }, 'Fully upgraded'));
    else {
      if (next.desc) detail.append(el('div', { class: 'hb__desc' }, next.desc));
      detail.append(el('div', { class: 'td__sec' }, `Level ${next.level} requirements`));
      const ul = el('ul', { class: 'td__reqs' });
      const reqs = requirementsOf(next);
      for (const r of reqs) {
        ul.append(el('li', { class: r.ok ? 'is-ok' : 'is-miss' }, r.text,
          r.need != null ? el('em', {}, ` (${fmtNum(Math.min(r.have, r.need))}/${fmtNum(r.need)})`) : null));
      }
      detail.append(ul);
      const go = el('button', { class: 'ebtn ebtn--go', disabled: !reqs.every((r) => r.ok), dataset: { sfx: 'own' } },
        lvl === 0 ? 'CONSTRUCT' : 'UPGRADE');
      go.addEventListener('click', () => build(s, next));
      detail.append(go);
    }
  }
  host.append(list, detail);
}

export function initHideout() {
  on(EV.SCREEN_CHANGED, (id) => { if (id === 'hideout') renderHideout(); });
}
