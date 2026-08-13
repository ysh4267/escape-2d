// =========================================================
// ESCAPE 2D — bootstrap
// =========================================================

import { $, el } from './core/util.js';
import { on, emit, EV } from './core/events.js';
import { loadItems, TPL } from './data/items.js';
import { MAPS } from './data/maps.js';
import { loadGeometry } from './raid/nav.js';
import { game, initState, load, save, saveSoon, addMoney } from './core/state.js';
import { Item, autoPlace, moveToSlot } from './inventory/model.js';
import { initDnd } from './inventory/dnd.js';
import { initTooltip } from './inventory/tooltip.js';
import { initContextMenu, confirmDialog } from './inventory/dialogs.js';
import { initShell, showScreen, showPane, refreshTopbar, bootProgress, toast } from './ui/shell.js';
import { initStash, renderStash, activateStashContext } from './ui/stash.js';
import { initDeploy, renderDeploy } from './ui/deploy.js';
import { initTrade, renderTrade, activateTradeContext, rerollFence } from './ui/trade.js';
import { startRaid } from './ui/raid-ui.js';

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

  bootProgress(0.82, 'building interface');
  initShell();
  initDnd();
  initTooltip();
  initContextMenu();
  initStash();
  initTrade();
  initDeploy(geo, deploy);

  on(EV.SCREEN_CHANGED, (id) => {
    if (id === 'hideout:stash') { activateStashContext(); renderStash(); }
    if (id === 'hideout:traders') { activateTradeContext(); renderTrade(); }
    if (id === 'hideout:raid') { renderDeploy(); }
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

  window.addEventListener('beforeunload', save);
  window.ESCAPE2D = { game, TPL, save, wipe: hardReset };
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

async function hardReset() {
  const ok = await confirmDialog({
    title: 'WIPE PROFILE',
    body: 'Your stash, gear and progress will be erased and a fresh profile created.',
    confirmLabel: 'WIPE', danger: true,
  });
  if (!ok) return;
  localStorage.removeItem('escape2d.save.v1');
  location.reload();
}

// ---------------------------------------------------------
// dev entry points, used by the headless verification pass:
//   ?dev=traders | ?dev=deploy | ?dev=raid | ?dev=loot
// ---------------------------------------------------------
function runDevHooks() {
  const mode = new URLSearchParams(location.search).get('dev');
  if (!mode) return;
  if (mode === 'traders') { showPane('traders'); return; }
  if (mode === 'deploy') { showPane('raid'); return; }
  if (mode !== 'raid' && mode !== 'loot') return;

  deploy('factory');
  import('./ui/raid-ui.js').then(({ currentRaid, openOverlay }) => {
    const raid = currentRaid();
    if (!raid) return;
    if (mode === 'raid') {
      // walk toward the middle of the plant so the capture shows real ground
      raid.moveTo(64, 68);
    }
    if (mode === 'loot') {
      const p = raid.player;
      const near = raid.containers
        .slice()
        .sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y))[0];
      if (near) {
        const snap = raid.nav ? null : null;
        void snap;
        p.x = near.x; p.y = near.y - 1;
        near.searched = true;
        raid.seen.add(near.id);
        raid.openLoot(near);
        openOverlay();
      }
    }
  });
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

  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;
    const hideout = $('#screen-hideout').classList.contains('is-active');
    if (!hideout) return;
    if (e.key === '1') showPane('stash');
    if (e.key === '2') showPane('traders');
    if (e.key === '3') showPane('raid');
  });
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
            el('dt', {}, 'DIED'), el('dd', {}, String(stats.died)),
            el('dt', {}, 'BEST HAUL'), el('dd', {}, `${Math.round(stats.bestHaul).toLocaleString('en-US')} ₽`)),
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
