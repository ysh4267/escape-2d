// =========================================================
// in-raid controller: loop, input, HUD, loot overlay, results
// =========================================================

import { $, el, icon, clamp, fmtClock, fmtNum, fmtWeight } from '../core/util.js';
import { Raid, RAID_STATUS } from '../raid/raid.js';
import { Renderer } from '../raid/renderer.js';
import { NavGrid } from '../raid/nav.js';
import { game, saveSoon, markExamined, isExamined } from '../core/state.js';
import { renderGrid, renderItem } from '../inventory/view.js';
import { renderEquipment } from '../inventory/equipment.js';
import { dndContext, quickTransfer } from '../inventory/dnd.js';
import { setContextProvider, splitDialog, inspectDialog, confirmDialog } from '../inventory/dialogs.js';
import { autoPlace, detach, splitStack, moveToSlot } from '../inventory/model.js';
import { showScreen, raidToast, toast, refreshTopbar } from './shell.js';
import { emit, on, EV } from '../core/events.js';

let raid = null;
let renderer = null;
let nav = null;
let rafId = 0;
let lastT = 0;
let overlayOpen = false;
let holdingF = false;
let onFinishCb = () => {};

// ---------------------------------------------------------
export function startRaid({ mapDef, geo, onFinish }) {
  onFinishCb = onFinish || (() => {});
  nav = new NavGrid(geo, mapDef.level);
  raid = new Raid({ mapDef, geo, nav });
  const canvas = $('#raid-canvas');
  renderer = new Renderer(canvas, geo, mapDef.level);
  renderer.cam.x = raid.player.x;
  renderer.cam.y = raid.player.y;

  showScreen('raid');
  renderer.resize();
  bindRaidInput(canvas);
  activateRaidContext();
  closeOverlay();
  raidToast(`Inserted — ${raid.player.spawnName}`, 'ok', 3400);
  raidToast(`${raid.containers.length} containers on this map`, 'info', 3400);

  lastT = performance.now();
  cancelAnimationFrame(rafId);
  rafId = requestAnimationFrame(loop);
  return raid;
}

export function currentRaid() { return raid; }

// ---------------------------------------------------------
function loop(now) {
  rafId = requestAnimationFrame(loop);
  const dt = Math.min(0.05, (now - lastT) / 1000);
  lastT = now;
  if (!raid) return;

  if (raid.status === RAID_STATUS.RUNNING) {
    raid.update(dt);
    if (holdingF && raid.nearExtract) raid.holdExtract(dt);
  }
  renderer.followCamera(raid.player.x, raid.player.y, dt);
  renderer.draw({
    player: raid.player,
    nav,
    containers: raid.containers,
    extracts: raid.extracts,
    hover: raid.hover,
    path: raid.path,
    seen: raid.seen,
    time: now / 1000,
    nearExtract: raid.nearExtract,
  });
  drawHud();
}

function stopLoop() {
  cancelAnimationFrame(rafId);
  rafId = 0;
}

// ---------------------------------------------------------
function drawHud() {
  const p = raid.player;
  $('#hp-fill').style.width = `${(p.hp / p.maxHp) * 100}%`;
  $('#hp-text').textContent = String(Math.round(p.hp));

  const w = game.equipment.weight();
  const wtBar = $('#wt-fill').parentElement;
  $('#wt-fill').style.width = `${clamp((w / 70) * 100, 0, 100)}%`;
  wtBar.classList.toggle('is-heavy', w > 35 && w <= 65);
  wtBar.classList.toggle('is-over', w > 65);
  $('#wt-text').textContent = `${fmtWeight(w)} kg`;
  $('#stam-fill').style.width = `${p.stamina}%`;

  const clock = $('#raid-timer');
  clock.textContent = fmtClock(raid.timeLeft);
  clock.parentElement.classList.toggle('is-low', raid.timeLeft < 300);
  clock.parentElement.classList.toggle('is-crit', raid.timeLeft < 60);

  // search progress
  const ip = $('#interact-prompt');
  if (raid.searching) {
    ip.hidden = false;
    $('#interact-label').textContent = `SEARCHING ${raid.searching.def.name.toUpperCase()}`;
    $('#interact-fill').style.width = `${(raid.searchProgress / raid.searching.def.search) * 100}%`;
  } else {
    ip.hidden = true;
  }

  // extract prompt
  const ep = $('#extract-prompt');
  if (raid.nearExtract && raid.status === RAID_STATUS.RUNNING) {
    ep.hidden = false;
    const locked = raid.nearExtract.req && !raid.hasKey(raid.nearExtract.req);
    $('#extract-name').textContent = locked
      ? `${raid.nearExtract.name} — LOCKED`
      : raid.nearExtract.name.toUpperCase();
    $('#extract-fill').style.width = `${(raid.extractHold / 6) * 100}%`;
  } else {
    ep.hidden = true;
  }
}

// ---------------------------------------------------------
function bindRaidInput(canvas) {
  if (canvas._bound) return;
  canvas._bound = true;

  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  canvas.addEventListener('pointerdown', (e) => {
    if (!raid || raid.status !== RAID_STATUS.RUNNING) return;
    const [wx, wy] = pointerWorld(e);
    if (e.button === 2) {
      const c = raid.containerAt(wx, wy, 1.8);
      if (c) raid.interactWith(c);
      else { raid.cancelSearch(); raid.moveTo(wx, wy); }
    }
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!raid) return;
    const [wx, wy] = pointerWorld(e);
    const c = raid.containerAt(wx, wy, 1.6);
    raid.hover = c && raid.seen.has(c.id) ? c : null;
    canvas.style.cursor = raid.hover ? 'pointer' : 'crosshair';
  });

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    renderer.setZoom(renderer.ppu * (e.deltaY > 0 ? 0.9 : 1.1));
  }, { passive: false });

  window.addEventListener('resize', () => { if (renderer) renderer.resize(); });

  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('keyup', onKeyUp);

  $('#btn-close-overlay').addEventListener('click', closeOverlay);
  $('#btn-close-loot').addEventListener('click', () => {
    if (raid) raid.closeLoot();
    renderOverlay();
  });

  on(EV.LOOT_OPENED, () => openOverlay());
}

function pointerWorld(e) {
  const r = $('#raid-canvas').getBoundingClientRect();
  return renderer.screenToWorld(e.clientX - r.left, e.clientY - r.top);
}

function onKeyDown(e) {
  if (!raid || document.getElementById('screen-raid')?.classList.contains('is-active') === false) return;
  if (e.target.tagName === 'INPUT') return;

  if (e.key === 'Tab') {
    e.preventDefault();
    overlayOpen ? closeOverlay() : openOverlay();
  } else if (e.key === 'Shift') {
    raid.player.sprint = true;
  } else if (e.key === 'f' || e.key === 'F' || e.key === 'ㄹ') {
    holdingF = true;
  } else if (e.key === 'Escape') {
    if (overlayOpen) closeOverlay();
  }
}

function onKeyUp(e) {
  if (!raid) return;
  if (e.key === 'Shift') raid.player.sprint = false;
  if (e.key === 'f' || e.key === 'F' || e.key === 'ㄹ') {
    holdingF = false;
    raid.releaseExtract();
  }
}

// ---------------------------------------------------------
export function openOverlay() {
  overlayOpen = true;
  $('#raid-inventory').hidden = false;
  renderOverlay();
}

export function closeOverlay() {
  overlayOpen = false;
  $('#raid-inventory').hidden = true;
  if (raid) raid.closeLoot();
}

function renderOverlay() {
  if (!raid) return;
  const lootPanel = $('#panel-loot');
  const grid = $('#raid-inventory .overlay__grid');
  const c = raid.openContainerRef;

  lootPanel.hidden = !c;
  grid.classList.toggle('is-solo', !c);

  if (c) {
    $('#loot-title').textContent = c.def.name.toUpperCase();
    const host = $('#loot-host');
    host.replaceChildren();

    const bar = el('div', { style: { display: 'flex', gap: '8px', marginBottom: '10px', alignItems: 'center' } });
    bar.append(el('span', { class: 'hint' }, c.region || ''));
    const takeAll = el('button', { class: 'btn btn--sm' }, icon('cart'), 'TAKE ALL');
    takeAll.addEventListener('click', () => {
      const items = c.grid.items();
      let moved = 0;
      for (const it of items) {
        if (quickTransfer(it)) moved++;
      }
      raidToast(moved ? `Took ${moved} item${moved > 1 ? 's' : ''}` : 'No space', moved ? 'ok' : 'warn');
      renderOverlay();
    });
    bar.append(takeAll);
    host.append(bar);
    host.append(renderGrid(c.grid));
  }

  renderEquipment(game.equipment, $('#raid-equipment-host'));
  $('#raid-weight').textContent = fmtWeight(game.equipment.weight());
}

// ---------------------------------------------------------
function activateRaidContext() {
  dndContext.quickTargets = (item) => {
    const inLoot = item.holder?.kind === 'grid' && item.holder.grid.tag === 'loot';
    if (inLoot) return [...game.equipment.carryGrids(), ...game.equipment.nestedGrids()];
    const c = raid?.openContainerRef;
    const fromChar = !inLoot;
    if (fromChar && c) return [c.grid];
    return [...game.equipment.carryGrids(), ...game.equipment.nestedGrids()];
  };
  dndContext.equipSlotFor = (item) => game.equipment.slotFor(item);
  dndContext.requestSplit = (item, cb) => splitDialog(item, cb);
  dndContext.canMove = (item) => {
    const h = item.holder;
    if (h?.kind === 'grid' && h.grid.tag === 'loot') {
      const c = raid?.openContainerRef;
      if (!c || !c.searched) return false;
    }
    return true;
  };
  dndContext.onChange = () => {
    renderOverlay();
    emit(EV.INVENTORY_CHANGED);
  };

  setContextProvider((item) => {
    const actions = [];
    const examined = item.examined || isExamined(item.tpl.key);
    if (!examined) {
      actions.push({
        label: 'EXAMINE', icon: 'eye',
        run: () => { item.examined = true; markExamined(item.tpl.key); dndContext.onChange(); },
      });
      actions.push('-');
      return actions;
    }
    const tpl = item.tpl;
    if (tpl.res && (tpl.cat === 'meds' || tpl.cat === 'food' || tpl.cat === 'drink') && item.res > 0) {
      actions.push({
        label: 'USE', icon: 'health',
        run: () => {
          const heal = tpl.heal || 15;
          const before = raid.player.hp;
          raid.player.hp = Math.min(raid.player.maxHp, raid.player.hp + heal);
          const used = Math.max(1, Math.round(raid.player.hp - before));
          item.res = Math.max(0, item.res - (tpl.heal ? used : 20));
          if (item.res <= 0) detach(item);
          raidToast(`Used ${tpl.name}`, 'ok');
          dndContext.onChange();
        },
      });
    }
    if (tpl.stack > 1 && item.stack > 1) {
      actions.push({
        label: 'SPLIT', icon: 'split', key: 'CTRL+DRAG',
        run: () => splitDialog(item, (n) => {
          const copy = splitStack(item, n);
          if (!copy) return;
          const host = item.holder?.kind === 'grid' ? [item.holder.grid] : [];
          if (!autoPlace(copy, [...host, ...game.equipment.carryGrids()])) item.stack += copy.stack;
          dndContext.onChange();
        }),
      });
    }
    const slot = game.equipment.slotFor(item);
    if (slot && item.holder?.kind !== 'slot') {
      actions.push({
        label: `EQUIP — ${slot.label}`, icon: 'check', key: 'ALT+CLICK',
        run: () => { if (moveToSlot(item, slot).ok) dndContext.onChange(); },
      });
    }
    actions.push({ label: 'TAKE / STOW', icon: 'sell', key: 'CTRL+CLICK', run: () => quickTransfer(item) });
    actions.push({ label: 'INSPECT', icon: 'info', run: () => inspectDialog(item) });
    actions.push('-');
    actions.push({
      label: 'DROP', icon: 'discard', danger: true,
      run: () => { detach(item); dndContext.onChange(); },
    });
    return actions;
  });
}

// ---------------------------------------------------------
on(EV.RAID_END, (result) => {
  stopLoop();
  holdingF = false;
  closeOverlay();
  showResult(result);
});

function showResult(result) {
  const verdict = $('#result-verdict');
  const map = {
    [RAID_STATUS.SURVIVED]: ['SURVIVED', ''],
    [RAID_STATUS.MIA]: ['MISSING IN ACTION', 'is-warn'],
    [RAID_STATUS.KIA]: ['KILLED IN ACTION', 'is-bad'],
    [RAID_STATUS.LEFT]: ['LEFT THE ACTION', 'is-warn'],
  }[result.status] || ['RAID OVER', ''];
  verdict.textContent = map[0];
  verdict.className = `result-verdict ${map[1]}`;
  $('#result-sub').textContent = `${result.map} · ${result.extract ? result.extract.name : 'no extraction'}`;

  const stats = $('#result-stats');
  stats.replaceChildren();
  const stat = (k, v) => el('div', { class: 'result-stat' },
    el('div', { class: 'result-stat__k' }, k), el('div', { class: 'result-stat__v' }, v));
  stats.append(
    stat('TIME', fmtClock(result.duration)),
    stat('CONTAINERS', String(result.searched)),
    stat('ITEMS OUT', String(result.kept.length)),
    stat('HAUL VALUE', `${fmtNum(result.value)} ₽`));

  const lootHost = $('#result-loot');
  lootHost.replaceChildren();
  const shown = result.status === RAID_STATUS.SURVIVED ? result.kept : result.kept;
  if (!shown.length) lootHost.append(el('div', { class: 'empty-note' }, 'NOTHING CAME BACK'));
  for (const it of shown.slice(0, 60)) {
    const tile = renderItem(it, { static: true, noName: false });
    tile.style.position = 'relative';
    lootHost.append(tile);
  }

  showScreen('result');

  const btn = $('#btn-result-continue');
  btn.onclick = () => {
    const overflow = Raid.depositToStash();
    void overflow;
    raid = null;
    saveSoon();
    refreshTopbar();
    onFinishCb(result);
  };
}

// ---------------------------------------------------------
export function abandonRaid() {
  if (!raid || raid.status !== RAID_STATUS.RUNNING) return;
  confirmDialog({
    title: 'LEAVE THE ACTION',
    body: 'You will lose everything except your secure container.',
    confirmLabel: 'LEAVE', danger: true,
  }).then((ok) => { if (ok && raid) raid.finish(RAID_STATUS.LEFT); });
}

export function killPlayer() {
  if (raid && raid.status === RAID_STATUS.RUNNING) raid.finish(RAID_STATUS.KIA);
}

export { toast };
