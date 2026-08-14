// =========================================================
// in-raid controller: loop, input, HUD, loot overlay, results
// =========================================================

import { $, el, icon, clamp, fmtClock, fmtNum, fmtWeight } from '../core/util.js';
import { Raid, RAID_STATUS } from '../raid/raid.js';
import { Renderer } from '../raid/renderer.js';
import {
  attachRaid, openFloorplan, closeFloorplan, toggleFloorplan,
  floorplanOpen, floorplanFollow, drawFloorplan,
} from './floorplan.js';
import { game, saveSoon, registerSaveSection } from '../core/state.js';
import { renderGrid, renderItem } from '../inventory/view.js';
import { renderGearSlots, renderCarry } from '../inventory/equipment.js';
import { openContainerWindow, refreshContainerWindows, closeAllContainerWindows } from '../inventory/window.js';
import { sfx, startAmbient, stopAmbient } from '../core/audio.js';
import { dndContext, quickTransfer, isDragging } from '../inventory/dnd.js';
import { setContextProvider, splitDialog, inspectDialog, confirmDialog } from '../inventory/dialogs.js';
import { autoPlace, detach, splitStack, moveToSlot } from '../inventory/model.js';
import { startExamine, examining, needsExamine, isKnown, cancelExamine } from '../inventory/examine.js';
import { paintExamine } from '../inventory/view.js';
import { showScreen, raidToast, toast, refreshTopbar } from './shell.js';
import { emit, on, EV } from '../core/events.js';

let raid = null;
let renderer = null;
let rafId = 0;
let lastT = 0;
let overlayOpen = false;
let holdingF = false;
let firing = false;
let aim = null;
let wasMoving = false;
let wasSprinting = false;
let hoverDoor = null;
let hoverStair = null;
let onFinishCb = () => {};

// ---------------------------------------------------------
export function startRaid({ mapDef, geo, onFinish }) {
  onFinishCb = onFinish || (() => {});
  // gait carried over from the last raid would scuff on the first frame of this one
  wasMoving = false;
  wasSprinting = false;
  raid = new Raid({ mapDef, geo });
  const canvas = $('#raid-canvas');
  if (!renderer || renderer.geo !== geo) {
    renderer = new Renderer(canvas, geo, raid.level);
  } else {
    renderer.setLevel(raid.level);
    renderer.resetFog();
  }
  renderer.cam.x = raid.player.x;
  renderer.cam.y = raid.player.y;

  showScreen('raid');
  renderer.resize();
  bindRaidInput(canvas);
  activateRaidContext();
  closeOverlay();
  closeFloorplan();
  attachRaid(raid);
  buildFloorStrip();
  closeAllContainerWindows();
  startAmbient();
  $('#btn-hud-sprint').classList.remove('is-on');
  raidToast(`Inserted — ${raid.player.spawnName}`, 'ok', 3400);
  raidToast(`${raid.containers.length} containers across ${raid.map.levels.length} floors`, 'info', 3400);

  lastT = performance.now();
  cancelAnimationFrame(rafId);
  rafId = requestAnimationFrame(loop);
  return raid;
}

/** the TUN / 1F / 2F / 3F strip in the HUD */
function buildFloorStrip() {
  const wrap = $('#hud-floors');
  if (!wrap || !raid) return;
  wrap.replaceChildren();
  for (const lvl of [...raid.map.levels].reverse()) {
    wrap.append(el('button', {
      class: `floor-pip${raid.level === lvl.key ? ' is-on' : ''}`
        + `${raid.visited.has(lvl.key) ? ' is-seen' : ''}`,
      title: `${lvl.name} — open the plan`,
      onclick: () => openFloorplan(),
    }, lvl.short));
  }
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
    // the base gait is a jog, so normal movement uses the run set; a heavy
    // load drops the player to the slower walk cadence. The surface under the
    // player picks the material, independently of the gait.
    const surface = raid.surfaceAt(raid.player.x, raid.player.y);
    if (raid.player.moving && !overlayOpen) {
      sfx.footstep(raid.player.sprint, game.equipment.weight() <= 35, surface);
    }
    // One settling scuff when the player pulls up out of a sprint. Coming to a
    // stop at walking pace does not scuff — you only skid when you were
    // carrying speed, and a scuff on every little reposition was constant.
    if (wasMoving && wasSprinting && !raid.player.moving && !overlayOpen) sfx.halt(surface);
    wasMoving = raid.player.moving;
    wasSprinting = raid.player.moving && raid.player.sprint;
  }
  renderer.setLevel(raid.level);
  renderer.followCamera(raid.player.x, raid.player.y, dt);
  renderer.draw({
    player: raid.player,
    nav: raid.nav,
    containers: raid.containersHere(),
    // all of them, scav lanes included — the renderer marks those SCAVS ONLY
    extracts: raid.extractsHere,
    transits: raid.transitsHere,
    doors: raid.doorsOn(raid.level)
      .filter((d) => raid.seen.has(d.id))
      .map((d) => ({ ...d, canOpen: raid.canOpen(d) })),
    stairs: raid.stairsOn(raid.level)
      .filter((s) => raid.seen.has(s.id))
      .map((s) => ({ ...s, label: stairLabel(s) })),
    keyed: new Set(raid.extracts.filter((e) => e.req && raid.hasKey(e.req))),
    hover: raid.hover,
    hoverDoor,
    hoverStair,
    nearStairs: raid.nearStairs,
    path: raid.path,
    seen: raid.seen,
    scavs: raid.scavs,
    shots: raid.shots,
    hoverEnemy: raid.hoverEnemy,
    time: now / 1000,
    dt,
    rawTime: raid.time,
    nearExtract: raid.nearExtract,
  });
  drawHud();
  if (floorplanOpen()) drawFloorplan();
}

function stairLabel(stair) {
  const exits = raid.stairExits(stair);
  return exits
    .map((e) => `${e.dir === 'up' ? '↑' : '↓'} ${raid.levelInfo(e.level).short}`)
    .join('  ') || 'STAIRS';
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

  // the sprint toggle can flip from the keyboard or from running dry, so the
  // button mirrors the actual state every frame instead of tracking clicks
  $('#btn-hud-sprint').classList.toggle('is-on', raid.player.sprint);

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

  // while searching, progress lives in the loot panel itself; the HUD prompt
  // instead narrates the walk toward a container that was clicked from afar
  const ip = $('#interact-prompt');
  const pi = raid.pendingInteract;
  if (raid.breaching) {
    ip.hidden = false;
    $('#interact-label').textContent = `FORCING ${raid.breaching.door.name.toUpperCase()}`;
    $('#interact-fill').style.width =
      `${Math.round((raid.breaching.t / raid.map.breachTime) * 100)}%`;
  } else if (pi && raid.path.length) {
    ip.hidden = false;
    $('#interact-label').textContent =
      `MOVING TO ${(pi.def?.name || pi.name || 'TARGET').toUpperCase()}`;
    $('#interact-fill').style.width = '0%';
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
      ? `${raid.nearExtract.name} — NEEDS ${(raid.nearExtract.reqName || 'AN ITEM').toUpperCase()}`
      : raid.nearExtract.name.toUpperCase();
    $('#extract-fill').style.width = `${(raid.extractHold / 6) * 100}%`;
  } else {
    ep.hidden = true;
    holdingF = false;
  }

  drawStairsPrompt();
}

/**
 * Standing on a staircase offers the floors it reaches. The prompt is rebuilt
 * only when the staircase under the player changes, so the buttons do not
 * flicker out from under a click.
 */
let stairPromptFor = null;
function drawStairsPrompt() {
  const sp = $('#stairs-prompt');
  const s = raid.nearStairs;
  if (!s || raid.status !== RAID_STATUS.RUNNING) {
    sp.hidden = true;
    stairPromptFor = null;
    return;
  }
  sp.hidden = false;
  if (stairPromptFor === s) return;
  stairPromptFor = s;
  $('#stairs-label').textContent = 'STAIRWELL';
  const host = $('#stairs-btns');
  host.replaceChildren();
  for (const exit of raid.stairExits(s)) {
    const info = raid.levelInfo(exit.level);
    host.append(el('button', {
      class: `stairbtn stairbtn--${exit.dir}`,
      onclick: () => {
        if (raid.useStairs(s, exit.level)) {
          stairPromptFor = null;
          buildFloorStrip();
        }
      },
    }, exit.dir === 'up' ? '▲' : '▼', el('span', {}, info.name)));
  }
}

// ---------------------------------------------------------
function bindRaidInput(canvas) {
  if (canvas._bound) return;
  canvas._bound = true;

  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  // One button does everything. Left click reads what is under the cursor and
  // picks the obvious action: shoot a visible hostile, search a container the
  // player has already seen, otherwise walk there. Right click is left as a
  // second way to search rather than the only way.
  canvas.addEventListener('pointerdown', (e) => {
    if (!raid || raid.status !== RAID_STATUS.RUNNING) return;
    if (e.button !== 0 && e.button !== 2) return;
    const [wx, wy] = pointerWorld(e);
    aim = [wx, wy];

    // only containers the player has actually seen can be interacted with —
    // clicking into the fog must not reveal what is out there
    const container = raid.containerAt(wx, wy, 1.8);
    const reachable = container && raid.seen.has(container.id) ? container : null;
    const door = reachable ? null : seenOnly(raid.doorAt(wx, wy, 1.5));
    const stair = reachable || door ? null : seenOnly(raid.stairAt(wx, wy, 1.8));

    if (e.button === 2) {
      if (reachable) raid.interactWith(reachable);
      else if (door) raid.interactWith(door);
      else raid.cancelSearch();
      return;
    }

    const enemy = raid.scavAt(wx, wy, 1.9);
    if (enemy) {
      firing = true;
      raid.playerFire(enemy.x, enemy.y);
    } else if (reachable) {
      raid.interactWith(reachable);
    } else if (door) {
      raid.cancelSearch();
      raid.interactWith(door);
    } else if (stair) {
      raid.cancelSearch();
      raid.interactWith(stair);
    } else {
      raid.cancelSearch();
      raid.moveTo(wx, wy);
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
    hoverDoor = enemy || raid.hover ? null : seenOnly(raid.doorAt(wx, wy, 1.4));
    hoverStair = enemy || raid.hover || hoverDoor ? null : seenOnly(raid.stairAt(wx, wy, 1.6));
    canvas.style.cursor = enemy ? 'crosshair'
      : (raid.hover || hoverDoor || hoverStair) ? 'pointer' : 'default';
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
    if (raid) raid.closeLoot();   // repaints via the LOOT_CLOSED listener
  });

  // on-screen equivalents for everything that used to need a key
  $('#btn-hud-inventory').addEventListener('click', () => {
    overlayOpen ? closeOverlay() : openOverlay();
  });
  $('#btn-hud-map').addEventListener('click', () => {
    if (overlayOpen) closeOverlay();
    toggleFloorplan();
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

  on(EV.LOOT_OPENED, () => { closeFloorplan(); openOverlay(); });
  on(EV.LOOT_FOUND, () => { if (overlayOpen) renderOverlay(); });
  on(EV.LOOT_CLOSED, () => { if (overlayOpen) renderOverlay(); });
  on(EV.RAID_LEVEL, ({ level, name }) => {
    renderer.setLevel(level);
    floorplanFollow(level);
    buildFloorStrip();
    raidToast(name, 'info', 2200);
  });
}

/** clicking into the dark must not operate a door you have never seen */
function seenOnly(thing) {
  return thing && raid.seen.has(thing.id) ? thing : null;
}

function pointerWorld(e) {
  const r = $('#raid-canvas').getBoundingClientRect();
  return renderer.screenToWorld(e.clientX - r.left, e.clientY - r.top);
}

function onKeyDown(e) {
  if (!raid || document.getElementById('screen-raid')?.classList.contains('is-active') === false) return;
  if (e.target.tagName === 'INPUT') return;
  // a modal or an in-flight drag owns Escape (and every other key) — the raid
  // handler acting too would close the dialog AND pop the leave prompt
  if (!$('#modal-root').hidden || isDragging()) return;

  if (e.key === 'Tab') {
    e.preventDefault();
    closeFloorplan();
    overlayOpen ? closeOverlay() : openOverlay();
  } else if (e.key === 'm' || e.key === 'M' || e.key === 'ㅡ') {
    if (overlayOpen) closeOverlay();
    toggleFloorplan();
  } else if (e.key === 'Shift') {
    raid.player.sprint = true;
  } else if (e.key === 'f' || e.key === 'F' || e.key === 'ㄹ') {
    holdingF = true;
  } else if (e.key === 'Escape') {
    if (floorplanOpen()) closeFloorplan();
    else if (overlayOpen) closeOverlay();
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
  if (!overlayOpen) sfx.ui('window_open');
  overlayOpen = true;
  $('#raid-inventory').hidden = false;
  renderOverlay();
}

export function closeOverlay() {
  if (overlayOpen) sfx.ui('close');
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
          sfx.use(tpl);
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
          // merge:false, or autoPlace's merge pass folds the half we just split
          // straight back into the stack it came from and the action does nothing
          if (!autoPlace(copy, [...host, ...game.equipment.carryGrids()], { merge: false })) {
            item.stack += copy.stack;
          }
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
  cancelExamine();               // whatever was being inspected is moot now
  closeFloorplan();
  closeOverlay();
  closeAllContainerWindows();
  stopAmbient();
  showResult(result);
});

// ---------------------------------------------------------
// closing the tab mid-raid must not be a free extraction: the save carries a
// live-raid marker, and a boot that finds it treats the run as MIA
let pendingMIA = false;
registerSaveSection('raidLive', {
  dump: () => (raid && raid.status === RAID_STATUS.RUNNING ? { live: 1 } : null),
  restore: (v) => { pendingMIA = !!(v && v.live); },
});
export function consumePendingMIA() {
  const v = pendingMIA;
  pendingMIA = false;
  return v;
}

function showResult(result) {
  // the result screen is a summary, not an inventory: the raid context menu
  // staying live here meant one right-click DROP could delete extracted loot
  setContextProvider(() => []);
  dndContext.canMove = () => false;
  dndContext.onActivate = null;

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
    stat('FLOORS', String(result.floors ?? 1)),
    stat('CONTAINERS', String(result.searched)),
    stat('KILLS', String(result.kills ?? 0)),
    stat('ITEMS OUT', String(result.kept.length)),
    stat('HAUL VALUE', `${fmtNum(result.value)} ₽`));

  const lootHost = $('#result-loot');
  lootHost.parentElement.querySelector('h3').textContent =
    result.status === RAID_STATUS.SURVIVED ? 'EXTRACTED' : 'SECURED';
  lootHost.replaceChildren();
  if (!result.kept.length) lootHost.append(el('div', { class: 'empty-note' }, 'NOTHING CAME BACK'));
  for (const it of result.kept.slice(0, 60)) {
    const tile = renderItem(it, { static: true, noName: false });
    tile.style.position = 'relative';
    lootHost.append(tile);
  }

  // a lost raid also shows what went down with you
  const lostWrap = $('#result-lost');
  if (lostWrap) lostWrap.remove();
  if (result.lost.length) {
    const wrap = el('div', { class: 'result-loot result-loot--lost', id: 'result-lost' },
      el('h3', {}, `LOST IN ACTION — ${result.lost.length} ITEM${result.lost.length > 1 ? 'S' : ''}`));
    const list = el('div', { class: 'result-loot__list' });
    for (const it of result.lost.slice(0, 60)) {
      const tile = renderItem(it, { static: true, noName: false });
      tile.style.position = 'relative';
      list.append(tile);
    }
    wrap.append(list);
    lootHost.parentElement.after(wrap);
  }

  showScreen('result');

  const btn = $('#btn-result-continue');
  btn.onclick = () => {
    // what you carried out stays exactly where you packed it — the rig, the
    // backpack and the pouch come home loaded, and unloading is the player's
    // call in the stash rather than something the result screen does for them
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
