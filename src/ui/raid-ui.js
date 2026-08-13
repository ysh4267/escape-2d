// =========================================================
// in-raid controller: loop, input, HUD, loot overlay, results
// =========================================================

import { $, el, icon, clamp, fmtClock, fmtNum, fmtWeight } from '../core/util.js';
import { Raid, RAID_STATUS } from '../raid/raid.js';
import { Renderer } from '../raid/renderer.js';
import { NavGrid } from '../raid/nav.js';
import { game, saveSoon } from '../core/state.js';
import { renderGrid, renderItem } from '../inventory/view.js';
import { renderGearSlots, renderCarry } from '../inventory/equipment.js';
import { openContainerWindow, refreshContainerWindows, closeAllContainerWindows } from '../inventory/window.js';
import { sfx, startAmbient, stopAmbient } from '../core/audio.js';
import { dndContext, quickTransfer } from '../inventory/dnd.js';
import { setContextProvider, splitDialog, inspectDialog, confirmDialog } from '../inventory/dialogs.js';
import { autoPlace, detach, splitStack, moveToSlot } from '../inventory/model.js';
import { startExamine, examining, needsExamine, isKnown } from '../inventory/examine.js';
import { paintExamine } from '../inventory/view.js';
import { showScreen, raidToast, toast, refreshTopbar } from './shell.js';
import { emit, on, EV } from '../core/events.js';

let raid = null;
let renderer = null;
let nav = null;
let rafId = 0;
let lastT = 0;
let overlayOpen = false;
let holdingF = false;
let firing = false;
let aim = null;
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
  closeAllContainerWindows();
  startAmbient();
  $('#btn-hud-sprint').classList.remove('is-on');
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
    if (firing && aim && !overlayOpen) {
      const enemy = raid.scavAt(aim[0], aim[1], 2.4);
      raid.playerFire(enemy ? enemy.x : aim[0], enemy ? enemy.y : aim[1]);
    }
    if (raid.player.moving && !overlayOpen) sfx.footstep(raid.player.sprint);
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
    scavs: raid.scavs,
    shots: raid.shots,
    hoverEnemy: raid.hoverEnemy,
    time: now / 1000,
    rawTime: raid.time,
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

  const weapon = raid.activeWeapon();
  const ammoRow = $('#ammo-count').parentElement;
  if (weapon) {
    $('#ammo-weapon').textContent = weapon.tpl.short || weapon.tpl.name;
    const n = weapon.tpl.cal ? raid.ammoCount(weapon.tpl.cal) : 0;
    $('#ammo-count').textContent = weapon.tpl.cal ? String(n) : '—';
    ammoRow.classList.toggle('is-dry', !!weapon.tpl.cal && n === 0);
  } else {
    $('#ammo-weapon').textContent = 'unarmed';
    $('#ammo-count').textContent = '—';
    ammoRow.classList.remove('is-dry');
  }

  const clock = $('#raid-timer');
  clock.textContent = fmtClock(raid.timeLeft);
  clock.parentElement.classList.toggle('is-low', raid.timeLeft < 300);
  clock.parentElement.classList.toggle('is-crit', raid.timeLeft < 60);

  // search progress, mirrored on the HUD while the panel is open
  const ip = $('#interact-prompt');
  const sc = raid.searching;
  if (sc) {
    ip.hidden = false;
    $('#interact-label').textContent =
      `SEARCHING ${sc.def.name.toUpperCase()} — ${sc.found.size}/${sc.order.length}`;
    $('#interact-fill').style.width = `${Math.round(raid.searchFraction(sc) * 100)}%`;
  } else {
    ip.hidden = true;
  }

  // extract prompt
  const ep = $('#extract-prompt');
  if (raid.nearExtract && raid.status === RAID_STATUS.RUNNING) {
    ep.hidden = false;
    const locked = raid.nearExtract.req && !raid.hasKey(raid.nearExtract.req);
    ep.classList.toggle('is-locked', !!locked);
    $('#extract-name').textContent = locked
      ? `${raid.nearExtract.name} — LOCKED`
      : raid.nearExtract.name.toUpperCase();
    $('#extract-fill').style.width = `${(raid.extractHold / 6) * 100}%`;
  } else {
    ep.hidden = true;
    holdingF = false;
  }
}

// ---------------------------------------------------------
function bindRaidInput(canvas) {
  if (canvas._bound) return;
  canvas._bound = true;

  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  // left button moves, or opens fire when the cursor is on a visible hostile;
  // right button searches containers. No keyboard needed for either.
  canvas.addEventListener('pointerdown', (e) => {
    if (!raid || raid.status !== RAID_STATUS.RUNNING) return;
    const [wx, wy] = pointerWorld(e);
    aim = [wx, wy];
    if (e.button === 2) {
      const c = raid.containerAt(wx, wy, 1.8);
      if (c) raid.interactWith(c);
      else raid.cancelSearch();
    } else if (e.button === 0) {
      const enemy = raid.scavAt(wx, wy, 1.9);
      if (enemy) {
        firing = true;
        raid.playerFire(enemy.x, enemy.y);
      } else {
        raid.cancelSearch();
        raid.moveTo(wx, wy);
      }
    }
  });

  window.addEventListener('pointerup', (e) => { if (e.button === 0) firing = false; });
  window.addEventListener('blur', () => { firing = false; holdingF = false; });

  canvas.addEventListener('pointermove', (e) => {
    if (!raid) return;
    const [wx, wy] = pointerWorld(e);
    aim = [wx, wy];
    const enemy = raid.scavAt(wx, wy, 1.9);
    const c = enemy ? null : raid.containerAt(wx, wy, 1.6);
    raid.hover = c && raid.seen.has(c.id) ? c : null;
    raid.hoverEnemy = enemy || null;
    canvas.style.cursor = enemy ? 'crosshair' : raid.hover ? 'pointer' : 'default';
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

  // on-screen equivalents for everything that used to need a key
  $('#btn-hud-inventory').addEventListener('click', () => {
    overlayOpen ? closeOverlay() : openOverlay();
  });
  const sprintBtn = $('#btn-hud-sprint');
  sprintBtn.addEventListener('click', () => {
    if (!raid) return;
    raid.player.sprint = !raid.player.sprint;
    sprintBtn.classList.toggle('is-on', raid.player.sprint);
  });
  $('#btn-hud-leave').addEventListener('click', () => abandonRaid());

  // hold the extract panel with the mouse to channel the exfil
  const ep = $('#extract-prompt');
  const startHold = (e) => { e.preventDefault(); holdingF = true; };
  const endHold = () => { holdingF = false; if (raid) raid.releaseExtract(); };
  ep.addEventListener('pointerdown', startHold);
  ep.addEventListener('pointerup', endHold);
  ep.addEventListener('pointerleave', endHold);
  ep.addEventListener('pointercancel', endHold);

  on(EV.LOOT_OPENED, () => openOverlay());
  on(EV.LOOT_FOUND, () => { if (overlayOpen) renderOverlay(); });
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
    else abandonRaid();
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

    const total = c.order.length;
    const done = c.searched;
    const bar = el('div', { class: 'loot-bar' });
    bar.append(el('span', { class: 'hint' }, c.region || ''));

    if (!done) {
      // the container gives up its contents one item at a time
      bar.append(el('div', { class: 'loot-search' },
        el('span', { class: 'loot-search__label' },
          raid.searching === c ? 'SEARCHING' : 'SEARCH PAUSED'),
        el('div', { class: 'loot-search__bar' },
          el('i', { style: { width: `${Math.round(raid.searchFraction(c) * 100)}%` } })),
        el('span', { class: 'loot-search__count' }, `${c.found.size}/${total}`)));
    } else {
      const takeAll = el('button', { class: 'btn btn--sm' }, icon('cart'), 'TAKE ALL');
      takeAll.addEventListener('click', () => {
        let moved = 0;
        for (const it of c.grid.items()) if (quickTransfer(it)) moved++;
        raidToast(moved ? `Took ${moved} item${moved > 1 ? 's' : ''}` : 'No space', moved ? 'ok' : 'warn');
        renderOverlay();
      });
      bar.append(takeAll);
    }
    host.append(bar);
    host.append(renderGrid(c.grid, { filterFn: (it) => c.found.has(it.uid) }));

    if (!done && !c.found.size) {
      host.append(el('div', { class: 'empty-note' }, 'NOTHING UNCOVERED YET'));
    }
  }

  renderCarry(game.equipment, $('#raid-carry-host'));
  renderGearSlots(game.equipment, $('#raid-equipment-host'));
  $('#raid-weight').textContent = fmtWeight(game.equipment.weight());

  for (const host of ['#loot-host', '#raid-carry-host', '#raid-equipment-host']) {
    const root = $(host);
    if (!root) continue;
    for (const node of root.querySelectorAll('.item')) {
      if (node._item?.isContainer) node.classList.add('item--openable');
    }
  }
  refreshContainerWindows();
}

// ---------------------------------------------------------
/** run an examination, repainting only the progress bar as it ticks */
function examineNow(item) {
  startExamine(item, () => {
    if (examining() === item) paintExamine(item);
    else { renderOverlay(); emit(EV.INVENTORY_CHANGED); }
  });
}

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
  dndContext.onActivate = (item) => {
    if (needsExamine(item)) examineNow(item);
    else if (item.isContainer) openContainerWindow(item);
    else quickTransfer(item);
  };
  // loot that has not been uncovered yet cannot be touched
  dndContext.canMove = (item) => (raid ? raid.isRevealed(item) : true);
  dndContext.onChange = () => {
    renderOverlay();
    emit(EV.INVENTORY_CHANGED);
  };

  setContextProvider((item) => {
    const actions = [];
    if (!isKnown(item)) {
      actions.push({
        label: 'EXAMINE', icon: 'eye', key: 'DBL-CLICK',
        disabled: !!examining(),
        run: () => examineNow(item),
      });
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
  firing = false;
  closeOverlay();
  closeAllContainerWindows();
  stopAmbient();
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
    stat('KILLS', String(result.kills ?? 0)),
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
    const { moved, overflow } = Raid.depositToStash();
    if (overflow.length) toast(`${overflow.length} items stayed in your gear — stash is full`, 'warn');
    else if (moved.length) toast(`${moved.length} items unloaded into the stash`, 'ok');
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
