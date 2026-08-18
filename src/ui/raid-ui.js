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
import { openModdingWindow, closeAllModdingWindows, moddingContext, moddingScreenOpen } from '../inventory/modding.js';
import { loadAmmoDialog, loadIntoDialog } from '../inventory/ammo-dialogs.js';
import { unloadAmmo, toggleFold, canFold, magazineOf, setInRaid, canDetachPart, unpackAmmoBox } from '../inventory/weapon.js';
import { MODE_LABEL, weaponModes } from '../raid/gunplay.js';
import { sfx, startAmbient, stopAmbient } from '../core/audio.js';
import { dndContext, quickTransfer, isDragging } from '../inventory/dnd.js';
import { setContextProvider, splitDialog, inspectDialog, confirmDialog } from '../inventory/dialogs.js';
import { autoPlace, detach, splitStack, moveToSlot } from '../inventory/model.js';
import { startExamine, examining, needsExamine, isKnown, cancelExamine } from '../inventory/examine.js';
import { paintExamine } from '../inventory/view.js';
import { showScreen, raidToast, toast, refreshTopbar } from './shell.js';
import { emit, on, EV } from '../core/events.js';
import { mountHudHealth, drawHudHealth, useInRaid, renderHealthPanel } from './health-ui.js';

let raid = null;
let renderer = null;
let overlayHealth = null;
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
  closeAllModdingWindows();
  startAmbient();
  mountHudHealth(raid.health);
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
      raid.playerFire(enemy ? enemy.x : aim[0], enemy ? enemy.y : aim[1], { held: true });
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
    scavs: raid.scavsHere(),
    shots: raid.shots,
    hoverEnemy: raid.hoverEnemy,
    time: now / 1000,
    dt,
    rawTime: raid.time,
    nearExtract: raid.nearExtract,
    fx: {
      pain: raid.health.inPain,
      tremor: raid.health.tremor,
      pk: raid.health.onPainkiller,
      tunnel: raid.health.tunnel,
      ct: raid.health.contused,
      lowHp: raid.health.lowHp,
    },
  });
  sfx.muffle(raid.health.contused);
  drawHud();
  if (floorplanOpen()) drawFloorplan();
  // the overlay's health block follows the body while it is open (a few
  // times a second is plenty for numbers that move by the tick)
  if (overlayOpen && overlayHealth && (now - overlayHealthAt) > 250) {
    overlayHealthAt = now;
    overlayHealth.refresh();
  }
}
let overlayHealthAt = 0;

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
  drawHudHealth(raid);

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

  drawGunHud();

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
 * The gun on the HUD: the weapon, its selector, and what the shooter knows
 * about the magazine - exact right after it went in, "?" once shots have
 * gone through it, the game's words after a check (T). The chamber is the
 * dot after the count. A stoppage or a running action (a reload, a check,
 * a clearing) shows on the prompt above the vitals.
 */
function drawGunHud() {
  const weapon = raid.activeWeapon();
  const ammoRow = $('#ammo-count').parentElement;
  const modeEl = $('#ammo-mode');
  const gp = $('#gun-prompt');
  if (!weapon) {
    $('#ammo-weapon').textContent = 'unarmed';
    $('#ammo-count').textContent = '—';
    if (modeEl) modeEl.hidden = true;
    ammoRow.classList.remove('is-dry', 'is-malf', 'is-hot');
    if (gp) gp.hidden = true;
    return;
  }
  const st = raid.gun.state(weapon);
  $('#ammo-weapon').textContent = weapon.tpl.short || weapon.tpl.name;
  const modes = weaponModes(weapon);
  if (modeEl) {
    modeEl.hidden = false;
    modeEl.textContent = MODE_LABEL[st.mode] || st.mode.toUpperCase();
    modeEl.classList.toggle('is-fixed', modes.length < 2);
  }
  const read = raid.gun.magReadout(weapon);
  const chambered = weapon.chamber?.length ? '•' : '';
  const reserve = weapon.tpl.cal ? raid.ammoCount(weapon.tpl.cal) : 0;
  const spare = raid.gun.spareCount(weapon);
  let text;
  if (!weapon.magazine) text = `NO MAG${chambered ? ' •' : ''}`;
  else if (read.exact) text = `${read.text}/${read.cap}${chambered}`;
  else if (/[A-Z]/.test(read.text)) text = `${read.text}${chambered ? ' •' : ''}`;
  else text = `${read.text}${read.cap ? `/${read.cap}` : ''}${chambered}`;
  const tail = weapon.tpl.wpn?.reload === 'InternalMagazine' ? ` · ${reserve}` : (spare ? ` · ${spare} MAG${spare > 1 ? 'S' : ''}` : '');
  $('#ammo-count').textContent = text + tail;
  const known = read.exact ? weapon.chamber?.length + (weapon.magazine?.ammoCount || 0) : null;
  ammoRow.classList.toggle('is-dry', known === 0 && !spare && !reserve);
  ammoRow.classList.toggle('is-malf', !!st.malf);
  ammoRow.classList.toggle('is-hot', st.heat > 100);
  ammoRow.title = `${weapon.tpl.name}\ndurability ${Math.round(weapon.dura ?? 0)}/${weapon.maxDura ?? weapon.tpl.wpn?.maxDura ?? 100}` + (st.heat > 40 ? `\nhot: ${Math.round(st.heat)}` : '');
  if (!gp) return;
  const a = raid.gun.action;
  if (a) {
    gp.hidden = false;
    gp.classList.remove('is-malf');
    $('#gun-label').textContent = a.label;
    $('#gun-fill').style.width = `${Math.round(clamp(a.t / Math.max(0.01, a.dur), 0, 1) * 100)}%`;
  } else if (st.malf) {
    gp.hidden = false;
    gp.classList.add('is-malf');
    $('#gun-label').textContent = `${st.malf.label} — R TO CLEAR`;
    $('#gun-fill').style.width = '0%';
  } else {
    gp.hidden = true;
  }
}

/** rounds into a magazine in the field: one at a time, on the raid clock */
function timedLoad(mag, stacks, n) {
  const r = raid.gun.loadRounds(mag, stacks, n);
  if (!r.ok) { raidToast(r.reason || 'Cannot load now', 'warn'); return false; }
  raidToast(`Loading ${mag.tpl.short || 'magazine'} — ${Math.round(r.dur)}s`, 'info', 1600);
  return true;
}

/** the trigger let go: semi and burst may fire again on the next press */
function releaseTrigger() {
  firing = false;
  if (raid) raid.gun.release(raid.activeWeapon());
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
      raid.playerFire(enemy.x, enemy.y, { held: false });
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

  window.addEventListener('pointerup', (e) => { if (e.button === 0) releaseTrigger(); });
  window.addEventListener('blur', () => { releaseTrigger(); holdingF = false; });

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
    if (!raid.player.sprint && !raid.health.canSprint()) { noSprint(); return; }
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

/** why the legs will not carry a sprint right now */
let noSprintAt = 0;
function noSprint() {
  const now = performance.now();
  if (now - noSprintAt < 1200) return;
  noSprintAt = now;
  const h = raid.health;
  const why = h.exhausted ? 'Too exhausted to sprint'
    : h.badLegs() ? 'Cannot sprint on a broken leg' : 'Cannot sprint';
  raidToast(why, 'warn');
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
  // the modding screen owns the keyboard while it is up (Escape closes it, not the raid)
  if (moddingScreenOpen()) return;

  if (e.key === 'Tab') {
    e.preventDefault();
    closeFloorplan();
    overlayOpen ? closeOverlay() : openOverlay();
  } else if (e.key === 'm' || e.key === 'M' || e.key === 'ㅡ') {
    if (overlayOpen) closeOverlay();
    toggleFloorplan();
  } else if (e.key === 'Shift') {
    if (!e.repeat && !raid.health.canSprint()) noSprint();
    else raid.player.sprint = raid.health.canSprint();
  } else if (e.key === 'f' || e.key === 'F' || e.key === 'ㄹ') {
    holdingF = true;
  } else if (!e.repeat && (e.key === 'r' || e.key === 'R' || e.key === 'ㄱ')) {
    const w = raid.activeWeapon();
    if (!w) return;
    const r = raid.gun.reload(w);
    if (!r.ok && r.reason) raidToast(r.reason, 'warn');
  } else if (!e.repeat && (e.key === 'b' || e.key === 'B' || e.key === 'ㅠ')) {
    const w = raid.activeWeapon();
    if (!w) return;
    const r = raid.gun.cycleMode(w);
    if (r.ok) raidToast(`${w.tpl.short || 'Weapon'}: ${MODE_LABEL[r.mode] || r.mode}`, 'info', 1200);
  } else if (!e.repeat && (e.key === 't' || e.key === 'T' || e.key === 'ㅅ')) {
    const w = raid.activeWeapon();
    if (!w) return;
    const r = raid.gun.checkMag(w);
    if (!r.ok && r.reason) raidToast(r.reason, 'warn');
  } else if (e.key === 'h' || e.key === 'H' || e.key === 'ㅗ') {
    // the health block lives in the inventory overlay; H opens straight to it
    closeFloorplan();
    if (!overlayOpen) openOverlay();
    $('#raid-health-host')?.scrollIntoView({ block: 'nearest' });
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
  // the floating panels belong to the overlay; they must not hang over the canvas
  closeAllContainerWindows();
  closeAllModdingWindows();
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
  // the body, above the gear, the way the character screen stacks them
  const hh = $('#raid-health-host');
  if (hh) {
    if (!overlayHealth || !hh.firstChild) overlayHealth = renderHealthPanel(hh, raid.health, { compact: false });
    else overlayHealth.refresh();
  }
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
    // loot still under the searching hand is not yours to open or strip yet
    if (raid && !raid.isRevealed(item)) return;
    if (needsExamine(item)) examineNow(item);
    else if (item.isContainer) openContainerWindow(item);
    else if (item.isWeapon) openModdingWindow(item);
    else quickTransfer(item);
  };
  // in raid, parts come out of and go back into what is carried (the pouch too)
  moddingContext.sources = () => [...game.equipment.allGrids(), ...game.equipment.nestedGrids()];
  setInRaid(true);
  // loot that has not been uncovered yet cannot be touched, and a vital part
  // stays on its gun in the field however it is grabbed
  dndContext.canMove = (item) => (raid ? raid.isRevealed(item) : true) && canDetachPart(item).ok;
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
    if (tpl.med && (item.res == null || item.res > 0)) {
      // medkits and dressings ask for a body part; pills, stims and rations
      // just go down. The use itself runs on the raid clock (raid.beginUse).
      actions.push({
        label: 'USE', icon: 'health',
        disabled: !!raid.using,
        run: () => useInRaid(raid, item),
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
    const lock = canDetachPart(item);
    actions.push({ label: 'TAKE / STOW', icon: 'sell', key: 'CTRL+CLICK', disabled: !lock.ok, run: () => quickTransfer(item) });
    actions.push({ label: 'INSPECT', icon: 'info', run: () => inspectDialog(item) });
    // guns, magazines and cartridges get the same handling as in the stash;
    // vital parts stay put in the field (weapon.js enforces it)
    if (item.hasMods && (item.isWeapon || item.slots.length)) {
      actions.push({ label: 'MODDING', icon: 'crosshair', key: 'DBL-CLICK', run: () => openModdingWindow(item) });
    }
    if (tpl.wpn?.fold) {
      const cf = canFold(item);
      actions.push({
        label: item.folded ? 'UNFOLD STOCK' : 'FOLD STOCK', icon: 'rotate', disabled: !cf.ok,
        run: () => { const r = toggleFold(item); if (!r.ok) raidToast(r.reason, 'warn'); dndContext.onChange(); },
      });
    }
    const mag = magazineOf(item);
    if (mag) {
      actions.push({
        label: item.isMag ? 'LOAD AMMO' : 'LOAD MAGAZINE', icon: 'cart', disabled: mag.ammoFree === 0,
        run: () => loadAmmoDialog(mag, [...game.equipment.carryGrids(), ...game.equipment.nestedGrids()], () => dndContext.onChange(), {
          // in the field a round goes in at a time, on the raid clock
          timed: (stacks, n) => timedLoad(mag, stacks, n),
        }),
      });
      actions.push({
        label: 'UNLOAD AMMO', icon: 'sell', disabled: mag.ammoCount === 0,
        run: () => {
          const host = item.holder?.kind === 'grid' ? [item.holder.grid] : [];
          const r = unloadAmmo(mag, [...host, ...game.equipment.carryGrids(), ...game.equipment.nestedGrids()]);
          if (!r.ok) raidToast(r.reason || 'No room for the rounds', 'warn');
          dndContext.onChange();
        },
      });
    }
    if (tpl.cat === 'ammo') {
      actions.push({
        label: 'LOAD INTO MAGAZINE', icon: 'cart',
        run: () => loadIntoDialog(item, [...game.equipment.carryGrids(), ...game.equipment.nestedGrids()], () => dndContext.onChange(), {
          timed: (mag, stacks, n) => timedLoad(mag, stacks, n),
        }),
      });
    }
    if (tpl.cat === 'ammobox') {
      actions.push({
        label: `UNPACK — ${tpl.box?.n || ''} ROUNDS`, icon: 'split',
        run: () => {
          const host = item.holder?.kind === 'grid' ? [item.holder.grid] : [];
          const r = unpackAmmoBox(item, [...host, ...game.equipment.carryGrids(), ...game.equipment.nestedGrids()]);
          if (!r.ok) raidToast(r.reason || 'No room for the rounds', 'warn');
          dndContext.onChange();
        },
      });
    }
    actions.push('-');
    actions.push({
      label: 'DROP', icon: 'discard', danger: true, disabled: !lock.ok,
      run: () => { if (!canDetachPart(item).ok) return; detach(item); dndContext.onChange(); },
    });
    return actions;
  });
}

// ---------------------------------------------------------
on(EV.RAID_END, (result) => {
  stopLoop();
  overlayHealth = null;
  holdingF = false;
  releaseTrigger();
  cancelExamine();               // whatever was being inspected is moot now
  closeFloorplan();
  closeOverlay();
  closeAllContainerWindows();
  closeAllModdingWindows();
  setInRaid(false);
  stopAmbient();
  sfx.muffle(false);
  // a shake or a wash left on the canvas by the last frame must not greet the next raid
  if (renderer) { renderer.canvas.style.filter = ''; renderer.filterApplied = ''; }
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
    stat('HAUL VALUE', `${fmtNum(result.value)} ₽`),
    stat('HEALTH', game.health ? `${Math.ceil(game.health.total)} / ${game.health.max}` : '—'));

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
