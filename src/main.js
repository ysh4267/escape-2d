// =========================================================
// ESCAPE 2D — bootstrap
// =========================================================

import { $, el, fmtNum } from './core/util.js';
import { on, emit, EV } from './core/events.js';
import { loadItems, TPL } from './data/items.js';
import { MAPS } from './data/maps.js';
import { loadGeometry } from './raid/nav.js';
import { game, initState, load, save, saveSoon, addMoney, netWorthRub, wipe } from './core/state.js';
import { Item, autoPlace, moveToSlot } from './inventory/model.js';
import { initDnd, isDragging } from './inventory/dnd.js';
import { initTooltip } from './inventory/tooltip.js';
import { initContextMenu, confirmDialog } from './inventory/dialogs.js';
import { initAudio, audioState, setEnabled, setVolume } from './core/audio.js';
import { initShell, showScreen, showPane, refreshTopbar, bootProgress, toast } from './ui/shell.js';
import { initStash, renderStash, activateStashContext } from './ui/stash.js';
import { initDeploy, renderDeploy } from './ui/deploy.js';
import { initTrade, renderTrade, activateTradeContext, rerollFence } from './ui/trade.js';
import { startRaid, consumePendingMIA } from './ui/raid-ui.js';
import { initFloorplan } from './ui/floorplan.js';

let geo = null;

// ---------------------------------------------------------
// surface runtime errors on screen — headless checks read this, and a player
// who hits a bug sees what broke instead of a frozen page
// ---------------------------------------------------------
function installErrorReporter() {
  const box = el('div', {
    id: 'errbox',
    style: {
      position: 'fixed', left: '0', right: '0', bottom: '0', zIndex: '9999',
      maxHeight: '38vh', overflow: 'auto', padding: '8px 12px',
      background: 'rgba(60,18,14,.96)', borderTop: '2px solid #c2604f',
      color: '#f0c1b8', font: '11px/1.5 Cascadia Mono, Consolas, monospace',
      whiteSpace: 'pre-wrap', display: 'none',
    },
  });
  document.body.append(box);
  const push = (label, detail) => {
    box.style.display = 'block';
    box.append(el('div', {}, `${label}: ${detail}`));
  };
  window.addEventListener('error', (e) => {
    push('ERROR', `${e.message}  @ ${e.filename?.split('/').pop()}:${e.lineno}`);
  });
  window.addEventListener('unhandledrejection', (e) => {
    push('UNHANDLED', String(e.reason?.stack || e.reason));
  });
  const origErr = console.error.bind(console);
  console.error = (...a) => { origErr(...a); push('CONSOLE', a.map(String).join(' ')); };
}

async function boot() {
  installErrorReporter();
  bootProgress(0.08, 'loading item templates');
  await loadItems();

  bootProgress(0.42, 'loading map geometry');
  geo = await loadGeometry(MAPS.factory.geometry);

  bootProgress(0.66, 'restoring profile');
  initState();
  const restored = load();
  if (!restored) seedNewProfile();
  else if (consumePendingMIA()) {
    // the last session was closed mid-raid — that run ends as MIA, exactly
    // as if the timer had run out: unsecured gear does not come home
    game.equipment.clearInsecure();
    game.profile.raids++;
    game.profile.died++;
    save();
    setTimeout(() => toast('MISSING IN ACTION — the interrupted raid took your unsecured gear', 'bad', 5600), 900);
  }

  bootProgress(0.82, 'building interface');
  initAudio();
  initShell();
  initDnd();
  initTooltip();
  initContextMenu();
  initStash();
  initTrade();
  initDeploy(geo, deploy);
  initFloorplan();

  on(EV.SCREEN_CHANGED, (id) => {
    if (id === 'hideout:stash') { activateStashContext(); renderStash(); }
    if (id === 'hideout:traders') { activateTradeContext(); renderTrade(); }
    // the deploy pane has no grids of its own, but a floating container window
    // survives the pane switch — without its own context, an item ctrl+clicked
    // in that window on the RAID pane still flew to the trader's sell table
    if (id === 'hideout:raid') { activateStashContext(); renderDeploy(); }
  });

  // the brief is what the player reads to decide whether to go; a container
  // window emptied over the deploy pane must not leave its numbers lying
  on(EV.INVENTORY_CHANGED, () => {
    if ($('#pane-raid')?.classList.contains('is-active')) renderDeploy();
  });

  wireGlobalKeys();

  bootProgress(1, 'ready');
  refreshTopbar();
  activateStashContext();
  renderStash();

  setTimeout(() => {
    showScreen('hideout');
    showPane('stash');
    runDevHooks();
  }, 260);

  // a wipe reloads the page, and an unconditional save here wrote the profile
  // straight back over the key that had just been removed
  window.addEventListener('beforeunload', () => { if (!wiping) save(); });
  // Item and moveToSlot are here so the headless pass can dress the PMC in the
  // widest gear in the game; importing model.js from the harness page instead
  // builds a second copy of the module with an empty template registry.
  window.ESCAPE2D = { game, TPL, save, wipe: hardReset, Item, moveToSlot };
}

// ---------------------------------------------------------
function seedNewProfile() {
  const eq = game.equipment;

  const equip = (key, slot) => {
    const it = new Item(key, { examined: true });
    moveToSlot(it, eq.get(slot));
    return it;
  };
  equip('rig_scav', 'rig');
  equip('bp_sling', 'backpack');
  equip('sc_alpha', 'secure');
  equip('m_bayonet', 'scabbard');
  equip('hl_ushanka', 'head');

  const pistol = new Item('w_pm', { examined: true });
  moveToSlot(pistol, eq.get('holster'));

  // a small kit in the rig
  const kit = [
    ['mag_pm', 2], ['am_9x18pst', 1, 40], ['bandage', 2], ['ai2', 1],
  ];
  for (const [key, n, stack] of kit) {
    for (let i = 0; i < n; i++) {
      const it = new Item(key, { stack: stack || 1, examined: true });
      autoPlace(it, eq.carryGrids());
    }
  }

  // stash starter
  const starter = [
    ['salewa', 1], ['car', 2], ['bandage', 4], ['armyband', 2], ['splint', 2],
    ['water', 2], ['emelya', 2], ['stewS', 2],
    ['ar_paca', 1], ['rig_idea', 1], ['bp_vkbo', 1],
    ['w_mp133', 1], ['am_12buck', 1, 20], ['mag_ak74', 2], ['am_545ps', 1, 60],
    ['ducttape', 2], ['bolts', 2], ['wrench', 1],
  ];
  for (const [key, n, stack] of starter) {
    for (let i = 0; i < n; i++) {
      const it = new Item(key, { stack: stack || 1, examined: true });
      autoPlace(it, [game.stash]);
    }
  }
  addMoney(320000, 'RUB');
  addMoney(1200, 'USD');

  for (const t of Object.values(TPL)) {
    if (['money', 'meds', 'food', 'drink'].includes(t.cat)) game.profile.examined.add(t.key);
  }
  save();
}

let wiping = false;

async function hardReset() {
  const ok = await confirmDialog({
    title: 'WIPE PROFILE',
    body: 'Your stash, gear and progress will be erased and a fresh profile created.',
    confirmLabel: 'WIPE', danger: true,
  });
  if (!ok) return;
  // shut the autosave down before the key goes: a debounced save still in
  // flight, or the beforeunload save, would put the old profile right back
  wiping = true;
  game.settings.autoSave = false;
  // wipe() knows the live SAVE_KEY; the hardcoded one silently missed it
  wipe();
  location.reload();
}

// ---------------------------------------------------------
// dev entry points, used by the headless verification pass:
//   ?dev=traders | ?dev=deploy | ?dev=raid | ?dev=loot
//   ?dev=map[:level] opens the floor plan, optionally on a named storey
//   ?dev=floor:level drops the player onto that storey in the raid view
// ---------------------------------------------------------
function runDevHooks() {
  const raw = new URLSearchParams(location.search).get('dev');
  if (!raw) return;
  const [mode, arg] = raw.split(':');
  if (mode === 'traders') { showPane('traders'); return; }
  if (raw === 'trade-sell' || raw === 'trade-dialog') {
    showPane('traders');
    import('./ui/trade.js').then((m) => m.devTrade(raw.slice(6)));
    return;
  }
  if (mode === 'deploy') { showPane('raid'); return; }
  if (mode === 'rot') {
    // rotate every rotatable item in the stash so the sprite geometry can be
    // eyeballed in a single capture
    for (const it of game.stash.items()) {
      if (!it.canRotate) continue;
      const pos = game.stash.posOf(it);
      game.stash.remove(it);
      if (game.stash.canPlace(it, pos.x, pos.y, 1)) game.stash.place(it, pos.x, pos.y, 1);
      else {
        const spot = game.stash.findSpot(it, { preferRot: true });
        if (spot) game.stash.place(it, spot.x, spot.y, spot.rot);
        else game.stash.place(it, pos.x, pos.y, it.rot);
      }
    }
    renderStash();
    return;
  }
  if (mode === 'window') {
    const bag = game.stash.items().find((i) => i.isContainer)
      || game.equipment.item('rig');
    if (bag) import('./inventory/window.js').then((m) => m.openContainerWindow(bag));
    return;
  }
  if (mode === 'selftest') { runSelfTest(); return; }
  if (mode !== 'raid' && mode !== 'loot' && mode !== 'map' && mode !== 'floor') return;

  deploy('factory');
  import('./ui/raid-ui.js').then(({ currentRaid, openOverlay }) => {
    const raid = currentRaid();
    if (!raid) return;
    if (mode === 'raid') {
      // Tour the processing area instead of whichever corner the random
      // insertion picked, so the capture shows real ground with real fog
      // behind it. Each leg starts when the last one runs out.
      const legs = [[88, 44], [96, 62], [66, 82], [46, 66], [62, 40]];
      const p = raid.nav.snap(52, 46, 40);
      if (p) { raid.player.x = p[0]; raid.player.y = p[1]; }
      let leg = 0;
      const tour = setInterval(() => {
        if (raid.path.length) return;
        if (leg >= legs.length) return clearInterval(tour);
        raid.moveTo(legs[leg][0], legs[leg][1]);
        leg++;
      }, 120);
    }
    if (mode === 'floor' || (mode === 'map' && arg)) {
      // stand on a staircase that reaches the wanted storey and take it, so
      // the capture shows a floor the player could really have got to
      const want = arg || 'ground';
      const stair = raid.stairs.find((s) => s.levels.includes(want)
        && s.levels.includes(raid.level));
      if (stair) {
        raid.player.x = stair.x;
        raid.player.y = stair.y;
        raid.useStairs(stair, want);
      }
    }
    if (mode === 'map' || mode === 'floor') {
      // reveal the floor so the plan is not an empty sheet
      for (const c of raid.containers) if (c.level === raid.level) raid.seen.add(c.id);
      if (mode === 'map') import('./ui/floorplan.js').then((m) => m.openFloorplan());
    }
    if (mode === 'loot') {
      const p = raid.player;
      const near = raid.containersHere()
        .slice()
        .sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y))[0];
      if (near) {
        // stand on it and run the real search, so the capture shows the
        // container giving up its contents one item at a time
        p.x = near.x; p.y = near.y - 1;
        raid.seen.add(near.id);
        raid.beginSearch(near);
        openOverlay();
      }
    }
  });
}

/**
 * ?dev=selftest — walk the whole map and write the findings into the page as
 * JSON, so the headless pass can assert on them instead of on a screenshot.
 * It answers the questions that actually matter after the four-storey rework:
 * does every floor build, does every locked door hold, and can the player
 * still get from a spawn to every way out.
 */
function runSelfTest() {
  const t0 = performance.now();
  deploy('factory');
  const startMs = Math.round(performance.now() - t0);
  import('./ui/raid-ui.js').then(({ currentRaid }) => {
    const raid = currentRaid();
    const out = { ok: true, errors: [], startMs, levels: {}, doors: {}, reach: {}, stairs: {} };
    if (!raid) {
      out.ok = false;
      out.errors.push('no raid');
      return dump(out);
    }
    try {
      for (const lvl of raid.map.levels) {
        const nav = raid.navFor(lvl.key);
        let walk = 0;
        for (let i = 0; i < nav.walk.length; i++) walk += nav.walk[i];
        const cs = raid.containers.filter((c) => c.level === lvl.key);
        out.levels[lvl.key] = {
          walkCells: walk,
          containers: cs.length,
          offFloor: cs.filter((c) => !nav.walkable(c.x, c.y)).length,
          doors: raid.doorsOn(lvl.key).length,
          stairs: raid.stairsOn(lvl.key).length,
          extracts: raid.allExtracts.filter((e) => e.level === lvl.key).map((e) => e.name),
        };
      }
      for (const d of raid.doors) {
        if (d.state === 'free') continue;
        out.doors[d.id] = { level: d.level, state: d.state, key: d.keyId, name: d.name };
      }
      // every floor has to be reachable from the one the player starts on
      const seen = new Set([raid.map.startLevel]);
      for (let pass = 0; pass < 4; pass++) {
        for (const s of raid.stairs) {
          if (s.levels.some((l) => seen.has(l))) for (const l of s.levels) seen.add(l);
        }
      }
      out.stairs.reachableLevels = [...seen];

      // and, with the right key in hand, every exit has to be walkable to
      for (const lvl of raid.map.levels) {
        const nav = raid.navFor(lvl.key);
        for (const d of raid.doorsOn(lvl.key)) nav.setDoorPassable(d.navIndex, true);
        // start where a player would actually arrive on this floor: an
        // insertion point if the floor has any, otherwise off a staircase
        const from = raid.geo.markers.spawns.find((s) => s.level === lvl.key)
          || raid.stairsOn(lvl.key)[0];
        if (!from) continue;
        for (const e of raid.allExtracts.filter((x) => x.level === lvl.key)) {
          const p = nav.findPath(from.x, from.y, e.x, e.y);
          out.reach[`${lvl.key}/${e.name}`] = !!(p && p.length);
        }
      }
      raid.refreshDoorAccess();
      out.behaviour = doorBehaviour(raid);
    } catch (err) {
      out.ok = false;
      out.errors.push(String(err && err.stack || err));
    }
    dump(out);
  });

  /** drive the three door behaviours the way a player would */
  function doorBehaviour(raid) {
    const r = {};
    const step = (n, dt = 1 / 30) => { for (let i = 0; i < n; i++) raid.update(dt); };
    const stand = (level, x, y) => {
      raid.level = level;
      const p = raid.navFor(level).snap(x, y, 30) || [x, y];
      raid.player.x = p[0];
      raid.player.y = p[1];
      raid.path = [];
    };

    // 1. a plain door opens on its own as you walk into it
    const free = raid.doorsOn('ground').find((d) => d.state === 'free');
    if (free) {
      const nx = Math.sin(free.a), ny = -Math.cos(free.a);   // across the leaf
      stand('ground', free.x + nx * 2.6, free.y + ny * 2.6);
      raid.moveTo(free.x - nx * 2.6, free.y - ny * 2.6);
      step(240);
      r.freeDoorOpensOnApproach = { id: free.id, open: free.open };
    }

    // 2. a keyed door refuses, then gives once the key is in hand
    const keyed = raid.doorsOn('ground').find((d) => d.state === 'key');
    if (keyed) {
      stand('ground', keyed.x, keyed.y);
      const before = raid.openDoor(keyed, true);
      const key = new Item(Object.values(TPL).find((t) => t.id === keyed.keyId).key);
      autoPlace(key, game.equipment.carryGrids());
      raid.refreshDoorAccess();
      const after = raid.openDoor(keyed);
      r.keyedDoor = { id: keyed.id, withoutKey: before, withKey: after, usesLeft: key.res };
    }

    // 3. the breach door has no key anywhere; it has to be forced
    const breach = raid.doors.find((d) => d.state === 'breach');
    if (breach) {
      stand(breach.level, breach.x, breach.y);
      raid.openDoor(breach);
      const started = !!raid.breaching;
      step(Math.ceil((raid.map.breachTime + 0.4) * 30));
      r.breachDoor = { id: breach.id, started, open: breach.open };
    }
    return r;
  }

  function dump(out) {
    const pre = document.createElement('pre');
    pre.id = 'selftest';
    pre.textContent = JSON.stringify(out);
    pre.style.cssText = 'position:fixed;inset:0;z-index:99;background:#000;color:#0f0;'
      + 'font:11px monospace;white-space:pre-wrap;overflow:auto;padding:12px';
    document.body.append(pre);
  }
}

function deploy(mapId) {
  const mapDef = MAPS[mapId];
  if (!mapDef) return;
  startRaid({
    mapDef,
    geo,
    onFinish: () => {
      rerollFence();
      showScreen('hideout');
      showPane('stash');
      activateStashContext();
      renderStash();
      refreshTopbar();
      saveSoon();
    },
  });
}

// ---------------------------------------------------------
function wireGlobalKeys() {
  $('#btn-settings').addEventListener('click', openSettings);

  const soundBtn = $('#btn-sound');
  const paintSound = () => {
    const { enabled } = audioState();
    soundBtn.querySelector('use').setAttribute('href', enabled ? '#i-sound' : '#i-mute');
    soundBtn.style.color = enabled ? '' : 'var(--danger)';
    soundBtn.title = enabled ? 'Sound on — click to mute' : 'Muted — click to unmute';
  };
  soundBtn.addEventListener('click', () => {
    setEnabled(!audioState().enabled);
    paintSound();
  });
  paintSound();

  document.addEventListener('keydown', (e) => {
    const tag = e.target?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target?.isContentEditable) return;
    // a dialog owns the keyboard, and switching panes mid-drag drops the item
    if (!$('#modal-root').hidden || isDragging()) return;
    const hideout = $('#screen-hideout').classList.contains('is-active');
    if (!hideout) return;
    if (e.key === '1') showPane('stash');
    if (e.key === '2') showPane('traders');
    if (e.key === '3') showPane('raid');
  });
}

function volumeRow() {
  const { volume } = audioState();
  const slider = el('input', {
    type: 'range', min: '0', max: '100', value: String(Math.round(volume * 100)),
    style: { flex: '1', accentColor: 'var(--pale)' },
  });
  const readout = el('span', { class: 'muted', style: { width: '38px', textAlign: 'right' } },
    `${Math.round(volume * 100)}%`);
  slider.addEventListener('input', () => {
    setVolume(Number(slider.value) / 100);
    readout.textContent = `${slider.value}%`;
  });
  return el('div', {
    style: {
      display: 'flex', alignItems: 'center', gap: '12px',
      marginTop: '14px', paddingTop: '12px', borderTop: '1px solid var(--line-1)',
    },
  }, el('span', { class: 'hint', style: { width: '58px' } }, 'VOLUME'), slider, readout);
}

function openSettings() {
  const { openModal } = window.__dialogs || {};
  void openModal;
  const stats = game.profile;
  import('./inventory/dialogs.js').then(({ openModal: om }) => {
    om((box, done) => {
      box.append(
        el('div', { class: 'modal__head' }, 'PROFILE'),
        el('div', { class: 'modal__body' },
          el('dl', { class: 'tooltip__rows' },
            el('dt', {}, 'LEVEL'), el('dd', {}, String(stats.level)),
            el('dt', {}, 'EXPERIENCE'), el('dd', {}, String(stats.exp)),
            el('dt', {}, 'RAIDS'), el('dd', {}, String(stats.raids)),
            el('dt', {}, 'SURVIVED'), el('dd', {}, String(stats.survived)),
            el('dt', {}, 'EXTRACTED'), el('dd', {}, String(stats.extracted)),
            el('dt', {}, 'DIED'), el('dd', {}, String(stats.died)),
            el('dt', {}, 'BEST HAUL'), el('dd', {}, `${Math.round(stats.bestHaul).toLocaleString('en-US')} ₽`),
            el('dt', {}, 'NET WORTH'), el('dd', {}, `${fmtNum(netWorthRub())} ₽`)),
          volumeRow(),
          el('div', { class: 'tooltip__desc', style: { marginTop: '14px', borderTop: '1px solid var(--line-1)', paddingTop: '10px' } },
            'Non-commercial fan project. Escape From Tarkov is a trademark of Battlestate Games. '
            + 'Map geometry from the-hideout/tarkov-dev-svg-maps (CC BY-NC-SA 4.0); item artwork from '
            + 'assets.tarkov.dev; item templates and prices from the SPT database dumps.')),
        el('div', { class: 'modal__foot' },
          el('button', { class: 'btn btn--danger', onclick: () => { done(); hardReset(); } }, 'WIPE PROFILE'),
          el('button', { class: 'btn btn--primary', onclick: () => done() }, 'CLOSE')));
    });
  });
}

// ---------------------------------------------------------
boot().catch((err) => {
  console.error(err);
  const status = $('#boot-status');
  if (status) {
    status.textContent = `failed: ${err.message}`;
    status.style.color = 'var(--danger)';
  }
});
