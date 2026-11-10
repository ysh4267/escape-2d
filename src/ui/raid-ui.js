// =========================================================
// in-raid controller: loop, input, HUD, loot overlay, results
// =========================================================

import { $, el, icon, clamp, fmtClock, fmtNum, fmtWeight, keepScroll } from '../core/util.js';
import { Raid, RAID_STATUS } from '../raid/raid.js';
import { Renderer } from '../raid/renderer.js';
import {
  attachRaid, openFloorplan, closeFloorplan, toggleFloorplan,
  floorplanOpen, floorplanFollow, drawFloorplan,
} from './floorplan.js';
import { game, saveSoon, registerSaveSection } from '../core/state.js';
import { renderGrid, renderItem } from '../inventory/view.js';
import { renderDoll, renderContainers } from '../inventory/equipment.js';
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
import { t } from '../core/i18n.js';
import { locationName } from '../game/db.js';
import { BY_ID, getTpl } from '../data/items.js';
import { uiImg } from '../core/uiart.js';
import { mountHudHealth, drawHudHealth, useInRaid, renderHealthBoard } from './health-ui.js';
import { paintParams, paintQuick, KINDS, kindOf } from './stash.js';
import { lendPane, returnPanes } from './character.js';
import { toStage } from '../core/stage.js';

import { openRaidEnd } from './raidend.js';

let raid = null;
let renderer = null;
let overlayHealth = null;
let rafId = 0;
let lastT = 0;
let overlayOpen = false;
let firing = false;
let aim = null;
let wasMoving = false;
let wasSprinting = false;
let hoverDoor = null;
let hoverStair = null;
/** where the pointer is over the ground, in the screen's own pixels; null while it is off it */
let pointerAt = null;
let onFinishCb = () => {};

// ---------------------------------------------------------
export function startRaid({ mapDef, geo, onFinish, location = null, hour = 12 }) {
  onFinishCb = onFinish || (() => {});
  // gait carried over from the last raid would scuff on the first frame of this one
  wasMoving = false;
  wasSprinting = false;
  raid = new Raid({ mapDef, geo, location, hour });
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
  // the exits show themselves as a raid begins
  askExits('full', 7);
  showIntro(raid);

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
  // the inventory's numbers follow the body and the search while it is open
  // (a few times a second is plenty for numbers that move by the tick)
  if (overlayOpen && (now - overlayHealthAt) > 250) {
    overlayHealthAt = now;
    if (overlayTab === 'health' && overlayHealth) overlayHealth.refresh();
    else paintParams($('#raid-params'), { inRaid: true });
    const c = raid.openContainerRef;
    const clock = $('#loot-clock');
    if (c && clock && raid.searching === c) clock.textContent = searchClock(c);
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
  $('#stam-arms').style.width = `${p.stamina}%`;

  // the sprint toggle can flip from the keyboard or from running dry, so the
  // button mirrors the actual state every frame instead of tracking clicks
  $('#btn-hud-sprint').classList.toggle('is-on', raid.player.sprint);

  drawGunHud();

  drawExits();

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

  drawStairsPrompt();
  drawActions();
}

// ---------------------------------------------------------
// what can be done with the thing under the pointer, as the client says it:
// a small black box of action words just over the hand, the one a click
// carries out on a grey plate, one it cannot in grey letters
// ---------------------------------------------------------
function actionsUnder() {
  if (raid.hover) return [{ text: t('Search'), on: true }];
  const d = hoverDoor;
  if (!d || d.open) return [];
  if (d.state === 'breach') return [{ text: t('Breach'), on: true }];
  if (d.state === 'key') return [{ text: t('Unlock'), on: raid.canOpen(d) }];
  return [{ text: t('OPENDOOR'), on: true }];
}

function drawActions() {
  const box = $('#actbox');
  const rows = !pointerAt || overlayOpen || floorplanOpen() ? [] : actionsUnder();
  if (!rows.length) { box.hidden = true; return; }
  const sig = rows.map((r) => `${r.text}${r.on ? '*' : ''}`).join('|');
  if (box.dataset.sig !== sig) {
    box.dataset.sig = sig;
    box.replaceChildren(...rows.map((r) => el('div', { class: `actbox__row${r.on ? ' is-on' : ''}` }, r.text)));
  }
  box.style.left = `${pointerAt[0]}px`;
  box.style.top = `${pointerAt[1] - 30.5}px`;
  box.hidden = false;
}

// ---------------------------------------------------------
// who is going in, where and when: four lines bottom left, a couple of
// seconds after the ground comes up and gone a couple of seconds later
// ---------------------------------------------------------
function showIntro(mine) {
  const p = game.profile;
  const host = $('#raidintro');
  const two = (n) => String(n).padStart(2, '0');
  const day = Math.floor((Date.now() - (p.registered || Date.now())) / 86400000) + 1;
  const began = performance.now();
  const clock = el('span', {});
  // the hour keeps running, seven times as fast as a real one
  const paint = () => {
    const s = (mine.hour * 3600 + ((performance.now() - began) / 1000) * 7) % 86400;
    const h = Math.floor(s / 3600);
    clock.textContent = `${t('Day')} ${day} ${two(h % 12 || 12)}:${two(Math.floor((s % 3600) / 60))}:${two(Math.floor(s % 60))} ${h < 12 ? 'AM' : 'PM'}`;
  };
  paint();
  host.replaceChildren(
    el('div', {}, t('Raid №{0}', (p.raids || 0) + 1)),
    el('div', {}, clock),
    el('div', {}, `${t('Lvl')} ${p.level} ${p.faction || 'USEC'} ${t('Operator')} ${p.name || 'PMC'}`),
    el('div', {}, `${t('Tarkov')}, ${mine.location ? locationName(mine.location) : mine.map.name}`));
  host.hidden = true;
  const still = () => raid === mine;
  const tick = setInterval(() => { if (still()) paint(); else clearInterval(tick); }, 250);
  setTimeout(() => { if (still()) host.hidden = false; }, 1500);
  setTimeout(() => { clearInterval(tick); host.hidden = true; }, 5200);
}

// ---------------------------------------------------------
// the raid's clock and its exits, top right, as the client keeps them: out of
// sight but for the first seconds of a raid, a press of O (the clock) or two
// (the exits as well), and the while an exit is stood in
// ---------------------------------------------------------
/** what is asked for: 'full' the header, clock and rows, 'clock' the clock alone; `until` is when it lapses */
let exitsAsked = { mode: 'none', until: 0 };
let lastO = 0;
/** the exit whose count was running, for the word to get back to it */
let leftExit = { until: 0 };

function askExits(mode, seconds) {
  exitsAsked = { mode, until: performance.now() + seconds * 1000 };
}

/** h:mm:ss, the hours bare */
function raidClock(sec) {
  const s = Math.max(0, Math.ceil(sec));
  const two = (n) => String(n).padStart(2, '0');
  return `${Math.floor(s / 3600)}:${two(Math.floor((s % 3600) / 60))}:${two(s % 60)}`;
}

function drawExits() {
  const panel = $('#xpanel');
  const plate = $('#xplate');
  const now = performance.now();
  const near = raid.status === RAID_STATUS.RUNNING ? raid.nearExtract : null;
  const open = near && !(near.req && !raid.hasKey(near.req));
  if (open) leftExit = { until: now + 4000 };

  const mode = near ? 'full' : now < leftExit.until ? 'full' : now < exitsAsked.until ? exitsAsked.mode : 'none';
  panel.dataset.mode = mode;
  if (mode !== 'none') {
    $('#xpanel-title').textContent = open ? t('StayInEpInside') : now < leftExit.until && !near ? t('StayInEpOutside') : t('FindEp');
    const clock = $('#xpanel-clock');
    clock.textContent = raidClock(raid.timeLeft);
    clock.classList.toggle('is-short', raid.timeLeft < 600);
    // in an exit only that exit is listed, its own count where a row's clock goes
    const exits = raid.allExtracts.filter((e) => e.faction !== 'scav');
    const listed = near ? [near] : exits;
    const key = listed.map((e) => `${e.id}${e === near ? (open ? '+' : '-') : ''}${e.req && !raid.hasKey(e.req) ? '!' : ''}`).join('|');
    const rows = $('#xpanel-rows');
    if (rows.dataset.key !== key) {
      rows.dataset.key = key;
      rows.replaceChildren(...listed.map((e) => {
        const shut = e.req && !raid.hasKey(e.req);
        return el('div', { class: `xrow${e === near && open ? ' is-here' : ''}${shut ? ' is-shut' : ''}` },
          el('div', { class: 'xrow__what' },
            el('b', {}, `${t('EXFIL')}${String(exits.indexOf(e) + 1).padStart(2, '0')}`), el('span', {}, e.name),
            shut ? el('i', {}, e.reqName || '') : null),
          el('div', { class: 'xrow__clock' }));
      }));
    }
    const own = rows.querySelector('.xrow.is-here .xrow__clock');
    if (own) own.textContent = raidClock(raid.extractLeft());
  }

  plate.hidden = !open;
  if (open) $('#xplate-text').textContent = t('Extraction in {0:F1}').replace('{0:F1}', raid.extractLeft().toFixed(1));
}

/**
 * The gun on the HUD: the weapon, its selector, and what the shooter knows
 * about the magazine - exact right after it went in, "?" once shots have
 * gone through it, the game's words after a check (T). The chamber is the
 * dot after the count. A stoppage or a running action (a reload, a check,
 * a clearing) shows on the prompt above the vitals.
 */
// the client's words for where a selector stands and for what a magazine weighs
const MODE_WORD = { single: { key: 'single' }, burst: { key: 'burst' }, fullauto: { key: 'fullauto' }, semiauto: { key: 'semiauto' } };
const MAG_WORD = {
  FULL: { key: 'Full' }, 'NEARLY FULL': { key: 'Almost full' }, 'ABOUT HALF': { key: 'About half' },
  'FEWER THAN HALF': { key: 'Less than half' }, 'ALMOST EMPTY': { key: 'Almost empty' }, EMPTY: { key: 'Empty' },
};
let gunSaid = 0;

/** bottom right, for a couple of seconds: a word or a number large, and under it what is loaded */
function gunSay(big, more = null) {
  const host = $('#gunsay');
  $('#gunsay-big').textContent = big;
  const line = $('#gunsay-more');
  line.hidden = !more;
  if (more) line.lastChild.textContent = more;
  host.hidden = false;
  host.classList.remove('is-out');
  const mine = ++gunSaid;
  setTimeout(() => { if (gunSaid === mine) host.classList.add('is-out'); }, 2000);
  setTimeout(() => { if (gunSaid === mine) host.hidden = true; }, 2400);
}

/** what a look at the magazine told: the count if it could be counted, else the client's word for its weight */
function sayMagazine(weapon) {
  const read = raid.gun.magReadout(weapon);
  const word = MAG_WORD[read.text];
  const top = weapon.magazine?.rounds?.[weapon.magazine.rounds.length - 1];
  const ammo = top ? (BY_ID[top.t]?.name || '') : '';
  gunSay(word ? t(word.key) : read.text.replace('~', ''), ammo || null);
}

let lastCheck = null;

function drawGunHud() {
  const weapon = raid.activeWeapon();
  // a look at the magazine that has just ended is told
  const act = raid.gun.action;
  if (lastCheck && act !== lastCheck && weapon && lastCheck.weapon === weapon && weapon.magazine) sayMagazine(weapon);
  lastCheck = act && act.kind === 'check' ? act : null;
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
  window.addEventListener('blur', () => { releaseTrigger(); });

  canvas.addEventListener('pointermove', (e) => {
    if (!raid) return;
    const [wx, wy] = pointerWorld(e);
    aim = [wx, wy];
    const frame = $('#screen-raid').getBoundingClientRect();
    pointerAt = [toStage(e.clientX - frame.left), toStage(e.clientY - frame.top)];
    const enemy = raid.scavAt(wx, wy, 1.9);
    const c = enemy ? null : raid.containerAt(wx, wy, 1.6);
    raid.hover = c && raid.seen.has(c.id) ? c : null;
    raid.hoverEnemy = enemy || null;
    hoverDoor = enemy || raid.hover ? null : seenOnly(raid.doorAt(wx, wy, 1.4));
    hoverStair = enemy || raid.hover || hoverDoor ? null : seenOnly(raid.stairAt(wx, wy, 1.6));
    canvas.style.cursor = enemy ? 'crosshair'
      : (raid.hover || hoverDoor || hoverStair) ? 'pointer' : 'default';
  });

  canvas.addEventListener('pointerleave', () => { pointerAt = null; });

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    renderer.setZoom(renderer.ppu * (e.deltaY > 0 ? 0.9 : 1.1));
  }, { passive: false });

  window.addEventListener('resize', () => { if (renderer) renderer.resize(); });

  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('keyup', onKeyUp);

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

  on(EV.LOOT_OPENED, () => { closeFloorplan(); openOverlay('gear'); });
  on(EV.LOOT_FOUND, () => { if (overlayOpen) renderOverlay(); });
  // a task that moves while TASKS is up is written again
  on(EV.QUEST, () => { if (overlayOpen && lentTab === 'tasks') { lentTab = null; renderOverlay(); } });
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
  } else if (!e.repeat && (e.key === 'o' || e.key === 'O' || e.key === 'ㅐ')) {
    // once for the clock, twice for the exits as well
    const now = performance.now();
    askExits(now - lastO < 400 ? 'full' : 'clock', now - lastO < 400 ? 6 : 4);
    lastO = now;
  } else if (!e.repeat && (e.key === 'r' || e.key === 'R' || e.key === 'ㄱ')) {
    const w = raid.activeWeapon();
    if (!w) return;
    const r = raid.gun.reload(w);
    if (!r.ok && r.reason) raidToast(r.reason, 'warn');
  } else if (!e.repeat && (e.key === 'b' || e.key === 'B' || e.key === 'ㅠ')) {
    const w = raid.activeWeapon();
    if (!w) return;
    const r = raid.gun.cycleMode(w);
    if (r.ok) gunSay(MODE_WORD[r.mode] ? t(MODE_WORD[r.mode].key) : (MODE_LABEL[r.mode] || r.mode));
  } else if (!e.repeat && (e.key === 't' || e.key === 'T' || e.key === 'ㅅ')) {
    const w = raid.activeWeapon();
    if (!w) return;
    const r = raid.gun.checkMag(w);
    if (!r.ok && r.reason) raidToast(r.reason, 'warn');
  } else if (e.key === 'h' || e.key === 'H' || e.key === 'ㅗ') {
    // the body is a tab of the inventory; H opens straight to it
    closeFloorplan();
    openOverlay('health');
  } else if (e.key === 'Escape') {
    if (floorplanOpen()) closeFloorplan();
    else if (overlayOpen) closeOverlay();
    else abandonRaid();
  }
}

function onKeyUp(e) {
  if (!raid) return;
  if (e.key === 'Shift') raid.player.sprint = false;
}

// ---------------------------------------------------------
/** @param {string|null} [tab] the tab to open on; the one last up when none is named */
export function openOverlay(tab = null) {
  if (!overlayOpen) sfx.ui('window_open');
  if (tab) overlayTab = tab;
  overlayOpen = true;
  $('#raid-inventory').hidden = false;
  // what the ground wears - the body, the bars, this build's own buttons - is put away under it
  $('#screen-raid').classList.add('has-inv');
  renderOverlay();
}

export function closeOverlay() {
  if (overlayOpen) sfx.ui('close');
  overlayOpen = false;
  $('#raid-inventory').hidden = true;
  $('#screen-raid').classList.remove('has-inv');
  if (lentTab) { returnPanes(); lentTab = null; }
  // the floating panels belong to the overlay; they must not hang over the canvas
  closeAllContainerWindows();
  closeAllModdingWindows();
  if (raid) raid.closeLoot();
}

// ---------------------------------------------------------
// the inventory a raid opens: the character screen as a raid has it. The
// tabs along the top, the kit round the figure or the body on the left, what
// is carried beside it, and where the stash stands outside a raid, whatever
// is being searched.
// ---------------------------------------------------------
/** which of the inventory's tabs is up */
let overlayTab = 'gear';
/** the container the loot panel was last drawn for, and the kind of thing its grid is narrowed to */
let lootOf = null;
let lootKind = 'all';
/** the tab whose pane the character screen has lent, while one is up */
let lentTab = null;
// the character screen's tabs as a raid has them: all but the two that dress the character at home.
// GEAR and HEALTH are drawn here; the rest are the character screen's own panes, lent while they are up.
const RAID_TABS = [
  { key: 'overall', label: 'OVERALL', ico: 'tab_icon_overall' },
  { key: 'gear', label: 'GEAR', ico: 'tab_icon_gear' },
  { key: 'health', label: 'HEALTH_TAB', ico: 'tab_icon_health' },
  { key: 'skills', label: 'SKILLS', ico: 'tab_icon_skills' },
  { key: 'map', label: 'MAP', ico: 'tab_icon_map' },
  { key: 'tasks', label: 'TASKS', ico: 'tab_icon_tasks' },
  { key: 'achievements', label: 'ACHIEVEMENTS', ico: 'tab_icon_achivement_icon', icoOn: 'tab_icon_achivement_icon_pressed' },
];

function paintOverlayTabs() {
  const strip = $('#rinv-tabs');
  if (strip.dataset.up === overlayTab) return;
  strip.dataset.up = overlayTab;
  strip.replaceChildren(...RAID_TABS.map((def) => {
    const lit = overlayTab === def.key;
    const b = el('button', { class: `ptab${lit ? ' is-active' : ''}`, type: 'button', disabled: !!def.off, dataset: { sfx: 'own' } },
      el('span', { class: 'ptab__ico' }, uiImg(lit ? (def.icoOn || `${def.ico}_selected`) : def.ico)), el('span', {}, t(def.label)));
    b.addEventListener('click', () => { if (overlayTab !== def.key) { sfx.ui('click'); overlayTab = def.key; renderOverlay(); } });
    return b;
  }));
  const back = el('button', { class: 'dbtn charback', type: 'button', dataset: { sfx: 'own' } }, t('BACK'));
  back.addEventListener('click', closeOverlay);
  strip.append(back);
}

/** m:ss of how long a search has run */
function searchClock(c) {
  const s = Math.floor(c.searchSecs || 0);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Where the stash stands outside a raid: the thing being searched. LOOT on
 * its plate and its name top right; while there is more to find, the search
 * beside the plate - the ring turning, the red box that breaks it off and
 * how long it has run. Nothing of the grid is shown until the first thing
 * turns up; after that, what has not been come upon yet is a hatched place
 * in it.
 */
function paintLoot() {
  const panel = $('#panel-loot');
  const c = raid.openContainerRef;
  panel.hidden = !c;
  if (!c) { lootOf = null; return; }
  if (lootOf !== c) { lootOf = c; lootKind = 'all'; }
  const going = raid.searching === c;
  $('#loot-title').textContent = c.def.name;

  const again = () => { raid.resumeSearch(); renderOverlay(); };
  const head = $('#loot-head');
  head.replaceChildren(el('div', { class: 'tbtn rloot__label' },
    uiImg('stashheadericons_off', 'tbtn__ico', { w: 20, h: 20 }), el('span', {}, t('LOOT'))));
  if (!c.searched) {
    const search = el('button', { class: 'rloot__search', type: 'button', disabled: going, dataset: { sfx: 'own' } },
      going ? uiImg('spinner_big', 'rloot__spin', { w: 17, h: 17 }) : uiImg('search_icon', 'rloot__glass', { w: 10, h: 12 }),
      el('span', {}, going ? t('SEARCHING...') : t('Search')));
    search.addEventListener('click', again);
    head.append(search);
    if (going) {
      const stop = el('button', { class: 'rloot__stop', type: 'button', dataset: { sfx: 'own' } }, uiImg('close_window_x', '', { w: 9, h: 11 }));
      stop.addEventListener('click', () => { raid.cancelSearch(); renderOverlay(); });
      head.append(stop);
    }
    head.append(el('span', { class: 'rloot__clock', id: 'loot-clock' }, going || c.searchSecs ? searchClock(c) : ''));
  } else if (c.grid.items().length) {
    // this build's own: everything across in one press
    const all = el('button', { class: 'rloot__search rloot__all', type: 'button', dataset: { sfx: 'own' } }, el('span', {}, t('RECEIVE ALL')));
    all.addEventListener('click', () => {
      let moved = 0;
      for (const it of c.grid.items()) if (quickTransfer(it)) moved++;
      if (!moved) raidToast(t('No free room for that item'), 'warn');
      renderOverlay();
    });
    head.append(all);
  }

  // the kinds of thing down the grid's left edge, lit for what has been found
  const present = new Set(['all']);
  for (const it of c.grid.items()) {
    if (!raid.isRevealed(it)) continue;
    present.add(kindOf(it));
    if (it.fir) present.add('raid');
  }
  if (!present.has(lootKind)) lootKind = 'all';
  const kind = KINDS.find((k) => k.key === lootKind);
  $('#loot-kinds').replaceChildren(...KINDS.map((k) => {
    const b = el('button', { class: `ftab${lootKind === k.key ? ' is-active' : ''}`, type: 'button', disabled: !present.has(k.key), dataset: { sfx: 'own' } }, uiImg(k.ico));
    b.addEventListener('click', () => { sfx.ui('click'); lootKind = lootKind === k.key ? 'all' : k.key; renderOverlay(); });
    return b;
  }));

  const host = $('#loot-host');
  host.replaceChildren();
  if (!c.searched && !c.found.size) {
    const veil = el('button', { class: 'rloot__unsearched', type: 'button', disabled: going, dataset: { sfx: 'own' } },
      el('span', {}, t('UNSEARCHED')), going ? uiImg('spinner_big', 'rloot__spin', { w: 16, h: 16 }) : null);
    veil.addEventListener('click', again);
    host.append(veil);
    return;
  }
  const grid = renderGrid(c.grid, { filterFn: lootKind === 'all' ? null : (it) => (kind.test ? kind.test(it) : kindOf(it) === lootKind) });
  for (const tile of grid.querySelectorAll('.item')) {
    if (raid.isRevealed(tile._item)) continue;
    tile.replaceChildren();
    tile.className = 'item item--unfound';
    delete tile.dataset.bg;
  }
  host.append(grid);
}

function renderOverlay() {
  if (!raid) return;
  paintOverlayTabs();
  const own = overlayTab === 'gear' || overlayTab === 'health';
  $('#rinv-pane').classList.toggle('is-active', own);
  if (!own) {
    if (lentTab !== overlayTab) lentTab = lendPane(overlayTab, $('#rinv-body')) ? overlayTab : null;
    return;
  }
  if (lentTab) { returnPanes(); lentTab = null; }
  $('#rinv-gear').dataset.mode = overlayTab === 'health' ? 'health' : 'gear';
  // every one of these is a scroll box; replacing its children would otherwise scroll it back to the top
  keepScroll([$('#raid-carry-host'), $('#loot-host')], () => {
    renderDoll(game.equipment, $('#raid-equipment-host'), { faction: game.profile.faction, getTpl, noArrow: true });
    renderContainers(game.equipment, $('#raid-carry-host'), { noArrow: true });
    paintLoot();
  });
  if (overlayTab === 'health') {
    if (!overlayHealth || !overlayHealth.root.isConnected) overlayHealth = renderHealthBoard($('#raid-health-host'), raid.health, { inRaid: true });
    else overlayHealth.refresh();
  }
  paintParams($('#raid-params'), { inRaid: true });
  paintQuick($('#raid-quick'));
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
  overlayTab = 'gear';
  lootOf = null;
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
  // the screens after a raid are a summary, not an inventory: the raid context
  // menu staying live here meant one right-click DROP could delete extracted loot
  setContextProvider(() => []);
  dndContext.canMove = () => false;
  dndContext.onActivate = null;

  result.statusKey = result.runner ? 'runner' : ({
    [RAID_STATUS.SURVIVED]: 'survived', [RAID_STATUS.MIA]: 'mia',
    [RAID_STATUS.KIA]: 'kia', [RAID_STATUS.LEFT]: 'left',
  }[result.status] || result.status);

  openRaidEnd(result, () => {
    // what you carried out stays exactly where you packed it — the rig, the
    // backpack and the pouch come home loaded, and unloading is the player's
    // call in the stash rather than something these screens do for them
    raid = null;
    saveSoon();
    refreshTopbar();
    onFinishCb(result);
  });
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
