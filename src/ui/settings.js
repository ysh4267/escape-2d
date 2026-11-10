// =========================================================
// the settings screen
//
// The client's own screen, laid out off its hierarchy (SettingsScreen): the
// caption with the gear, the row of tabs under it, BACK and REVERT down the
// right edge at the top and SAVE at the bottom, CREDITS in the bottom-left
// corner. GAME carries the nickname block and the list of game options,
// SOUND the volume sliders, CONTROLS the table of what each key does.
// GRAPHICS and POSTFX have nothing behind them in a build drawn by the
// browser, and are shown switched off.
//
// It works the way the client's does: a change is tried out at once (the
// volume moves, the scene behind the menus swaps) but only SAVE keeps it;
// REVERT, or leaving without saving, puts back what was there.
// =========================================================

import { $, el } from '../core/util.js';
import { on, EV } from '../core/events.js';
import { sfx, audioState, setVolume, setUiVolume } from '../core/audio.js';
import { t, own, language, LANGUAGES } from '../core/i18n.js';
import { uiImg } from '../core/uiart.js';
import { game, save, saveSoon } from '../core/state.js';
import { showScreen, previousScreen, currentScreen } from './shell.js';
import { dropdown, slider } from './kit.js';
import { SCENES, RANDOM_SCENE, sceneChoice, storeSceneChoice, showScene } from './scene.js';
import { confirmDialog } from '../inventory/dialogs.js';
import { wishCount, clearWishlist } from '../game/wishlist.js';

const TABS = [
  { id: 'game', key: 'GAME' },
  { id: 'graphics', key: 'GRAPHICS', off: true },
  { id: 'postfx', key: 'PostFX', off: true },
  { id: 'sound', key: 'SOUND' },
  { id: 'controls', key: 'CONTROLS' },
];

/**
 * What each key does, for the CONTROLS tab: the client's name for the action
 * where it has one, the key, and how the key is used (the client's press
 * types). The raid reads the keyboard itself (src/ui/raid-ui.js); this is the
 * same list written out.
 */
const BINDINGS = [
  { group: () => own('Movement', '이동') },
  { name: () => own('Move / interact', '이동 / 상호 작용'), keys: ['LMB'], press: 'Press' },
  { name: () => t('Sprint'), keys: ['Shift'], press: 'Continuous' },
  { name: () => own('Extract', '탈출'), keys: ['F'], press: 'Continuous' },
  { group: () => own('Weapon handling', '무기 조작') },
  { name: () => t('Shoot'), keys: ['LMB'], press: 'Press' },
  { name: () => t('ReloadWeapon'), keys: ['R'], press: 'Press' },
  { name: () => t('Repair malfunction'), keys: ['R'], press: 'Press' },
  { name: () => t('ShootingMode'), keys: ['B'], press: 'Press' },
  { name: () => t('CheckAmmo'), keys: ['T'], press: 'Press' },
  { group: () => own('Interface', '인터페이스') },
  { name: () => t('Inventory'), keys: ['Tab'], press: 'Press' },
  { name: () => t('MAP'), keys: ['M'], press: 'Press' },
  { name: () => t('Health'), keys: ['H'], press: 'Press' },
  { name: () => t('DEAL!'), keys: ['Space'], press: 'Press' },
  { name: () => own('Close window / leave', '창 닫기 / 나가기'), keys: ['Esc'], press: 'Press' },
];

const NICK_MAX = 15;

let tab = 'game';
/** what is saved, and what the controls currently say */
let base = null;
let draft = null;
let onWipe = null;
const controls = {};

function saved() {
  const a = audioState();
  return { lang: language(), scene: sceneChoice(), volume: Math.round(a.volume * 100), ui: Math.round(a.ui * 100) };
}
function dirty() { return Object.keys(base).some((k) => base[k] !== draft[k]); }

/** try a value out without keeping it */
function preview(key) {
  if (key === 'volume') setVolume(draft.volume / 100);
  if (key === 'ui') setUiVolume(draft.ui / 100);
  if (key === 'scene') showScene(draft.scene);
}

function change(key, value) {
  draft[key] = value;
  preview(key);
  paintButtons();
}

function revert() {
  if (!dirty()) return;
  const was = { ...draft };
  draft = { ...base };
  for (const k of Object.keys(base)) if (was[k] !== base[k]) preview(k);
  for (const [k, c] of Object.entries(controls)) c.set(draft[k]);
  paintButtons();
}

function commit() {
  if (!dirty()) return;
  const langChanged = draft.lang !== base.lang;
  storeSceneChoice(draft.scene);
  setVolume(draft.volume / 100);
  setUiVolume(draft.ui / 100);
  if (langChanged) {
    try { localStorage.setItem('escape2d.lang', draft.lang); } catch { /* it lasts for this visit only */ }
  }
  base = { ...draft };
  paintButtons();
  if (langChanged) {
    // every screen was built in the old language; the page starts over in the new one
    save();
    location.reload();
  }
}

function leave() {
  revert();
  const back = previousScreen();
  showScreen(back && back !== 'settings' && back !== 'boot' ? back : 'menu');
}

// ---------------------------------------------------------
// the nickname
// ---------------------------------------------------------
/** the client's rules for a name: 3 to 15 of latin letters, digits, _ and -, no more than four digits */
function nickError(v) {
  if (v.length < 3) return 'ENicknameError/TooShort';
  if (v.length > NICK_MAX) return 'ENicknameError/CharacterLimit';
  if (!/^[A-Za-z0-9_-]+$/.test(v)) return 'ENicknameError/WrongSymbol';
  if ((v.match(/\d/g) || []).length > 4) return 'ENicknameError/DigitsLimit';
  return null;
}

function nicknameBlock() {
  const note = el('span', { class: 'set__nickmsg' });
  const used = el('div', { class: 'set__used' });
  const input = el('input', { class: 'set__nick', type: 'text', maxlength: String(NICK_MAX), spellcheck: 'false', autocomplete: 'off', value: game.profile.name || '' });
  const btn = el('button', { class: 'dbtn dbtn--22 set__nickbtn', type: 'button' },
    uiImg('save_build_icon_big', 'set__nickico set__nickico--idle', { w: 27, h: 27 }),
    uiImg('save_build_icon_big_black', 'set__nickico set__nickico--hot', { w: 27, h: 27 }),
    el('span', {}, t('ChangeButton')));

  const paint = (touched) => {
    const v = input.value.trim();
    const err = nickError(v);
    const same = v === (game.profile.name || '');
    note.textContent = touched && !same ? t(err || 'ENicknameError/ValidNickname') : '';
    note.classList.toggle('is-bad', !!err);
    btn.disabled = !!err || same;
    used.replaceChildren(...String(t('Used symbols: {0}', '\u0001')).split('\u0001').flatMap((part, i) => (i
      ? [el('b', {}, `${v.length}/${NICK_MAX}`), part] : [part])));
  };
  input.addEventListener('input', () => paint(true));
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter' && !btn.disabled) btn.click();
  });
  btn.addEventListener('click', () => {
    const v = input.value.trim();
    if (nickError(v)) return;
    game.profile.name = v;
    saveSoon();
    paint(false);
  });
  paint(false);

  return el('div', { class: 'set__nickpanel' },
    el('div', { class: 'set__nickhead' }, note),
    el('div', { class: 'set__nickfield' }, input),
    btn, used);
}

// ---------------------------------------------------------
// rows
// ---------------------------------------------------------
function ddRow(caption, key, options) {
  const dd = dropdown({ value: draft[key], options, onChange: (v) => change(key, v) });
  controls[key] = dd;
  return el('div', { class: 'set__row' }, el('span', { class: 'set__label' }, caption), dd.node);
}

function sliderRow(caption, key) {
  const sl = slider({ value: draft[key], min: 0, max: 100, step: 1, onInput: (v) => change(key, v) });
  controls[key] = sl;
  return el('div', { class: 'set__row set__row--slider' }, el('span', { class: 'set__label' }, caption), sl.node);
}

/** a wide row that is a button: grey until the pointer is on it, then the light plate */
function buttonRow(label, ico, onClick, opts = {}) {
  const b = el('button', { class: `set__rowbtn${opts.danger ? ' set__rowbtn--danger' : ''}`, type: 'button', disabled: !!opts.disabled },
    ico ? uiImg(ico, 'set__rowico', { w: 24, h: 20 }) : null, el('span', {}, label));
  b.addEventListener('click', onClick);
  return b;
}

// ---------------------------------------------------------
// the tabs' panes
// ---------------------------------------------------------
function gamePane() {
  const langs = Object.entries(LANGUAGES).map(([id, label]) => ({ id, label }));
  const scenes = [...SCENES, RANDOM_SCENE].map((s) => ({ id: s.id, label: t(s.key) }));
  const clear = buttonRow(t('Ui/Settings/ClearAllWishlist'), 'eft_sprite_favorite_system_icons_remove_all', async () => {
    const ok = await confirmDialog({
      title: t('Ui/Settings/ClearAllWishlistMessage1'),
      body: t('Ui/Settings/ClearAllWishlistMessage2'),
      confirmLabel: t('Yes'),
    });
    if (!ok) return;
    clearWishlist();
    clear.disabled = true;
  }, { disabled: !wishCount() });

  return el('div', { class: 'set__pane set__pane--game' },
    nicknameBlock(),
    el('div', { class: 'set__scroll' },
      el('div', { class: 'set__list' },
        ddRow(t('Interface language:'), 'lang', langs),
        ddRow(t('ECustomizationItemCategory/Environment'), 'scene', scenes),
        clear,
        // the client starts a character over from its launcher; with no launcher, the way to do it is here
        buttonRow(own('Reset game profile', '게임 프로필 초기화'), null, () => onWipe?.(), { danger: true }))));
}

function soundPane() {
  return el('div', { class: 'set__pane set__pane--sound' },
    el('div', { class: 'set__list set__list--sound' },
      sliderRow(t('Settings/Sound/OverallVolume'), 'volume'),
      sliderRow(t('Settings/Sound/InterfaceVolume'), 'ui')));
}

function controlsPane() {
  const row = (b) => (b.group ? el('div', { class: 'ctl__group' }, b.group()) : el('div', { class: 'ctl__row' },
    el('span', { class: 'ctl__name' }, b.name()),
    el('span', { class: 'ctl__key' }, b.keys[0] || t('Settings/NotSet')),
    el('span', { class: `ctl__key${b.keys[1] ? '' : ' is-unset'}` }, b.keys[1] || t('Settings/NotSet')),
    el('span', { class: 'ctl__press' }, t(`EPressType/${b.press}`))));
  return el('div', { class: 'set__pane set__pane--controls' },
    el('div', { class: 'ctl__head' },
      el('span', {}, t('ACTION')), el('span', {}, t('KEY')), el('span', {}, t('KEY')), el('span', {}, t('Settings/PressType'))),
    el('div', { class: 'ctl__rows' }, BINDINGS.map(row)));
}

// ---------------------------------------------------------
function paintButtons() {
  const d = dirty();
  const s = $('#set-save'), r = $('#set-revert');
  if (s) s.disabled = !d;
  if (r) r.disabled = !d;
}

function credits() {
  confirmDialog({
    title: t('CREDITS'),
    body: own(
      'Non-commercial fan project. Escape From Tarkov is a trademark of Battlestate Games. '
      + 'Map geometry from the-hideout/tarkov-dev-svg-maps (CC BY-NC-SA 4.0); item artwork from '
      + 'assets.tarkov.dev; item templates and prices from the SPT database dumps.',
      '비상업적 팬 프로젝트입니다. Escape From Tarkov는 Battlestate Games의 상표입니다. '
      + '지도 형상: the-hideout/tarkov-dev-svg-maps (CC BY-NC-SA 4.0), 아이템 그림: assets.tarkov.dev, '
      + '아이템 템플릿과 가격: SPT 데이터베이스 덤프.'),
    confirmLabel: 'OK',
  });
}

function render() {
  const host = $('#screen-settings');
  if (!host) return;
  for (const k of Object.keys(controls)) delete controls[k];

  const tabs = el('div', { class: 'set__tabs' }, TABS.map((x) => {
    const b = el('button', {
      class: `dbtn set__tab${x.id === tab ? ' is-hover' : ''}`, type: 'button', disabled: !!x.off, dataset: { sfx: 'own' },
    }, t(x.key));
    b.addEventListener('click', () => { if (x.id === tab) return; sfx.ui('click'); tab = x.id; render(); });
    return b;
  }));

  const pane = tab === 'sound' ? soundPane() : tab === 'controls' ? controlsPane() : gamePane();
  // CONTROLS has two lists of its own; only the keys exist here, the voice lines do not
  const sub = tab !== 'controls' ? null : el('div', { class: 'set__subtabs' },
    el('button', { class: 'dbtn set__tab is-hover', type: 'button' }, t('UI/Settings/Control/MouseAndKeys')),
    el('button', { class: 'dbtn set__tab', type: 'button', disabled: true }, t('UI/Settings/Control/Phrases')));

  const back = el('button', { class: 'dbtn set__side set__back', type: 'button' }, t('BACK'));
  back.addEventListener('click', leave);
  const rev = el('button', { class: 'dbtn set__side set__revert', id: 'set-revert', type: 'button' }, t('Revert'));
  rev.addEventListener('click', revert);
  const sv = el('button', { class: 'dbtn set__side set__save', id: 'set-save', type: 'button' }, t('Save'));
  sv.addEventListener('click', commit);
  const cr = el('button', { class: 'dbtn set__side set__credits', type: 'button' }, t('CREDITS'));
  cr.addEventListener('click', credits);

  host.replaceChildren(...[
    el('div', { class: 'set__cap' }, el('span', {}, uiImg('settings_icon', 'set__capico', { w: 62, h: 62 }), t('SETTINGS'))),
    tabs, sub, pane, back, rev, sv, cr].filter(Boolean));
  paintButtons();
}

/** @param {{ onWipe?: () => void }} [opts] */
export function initSettings(opts = {}) {
  onWipe = opts.onWipe || null;
  $('#btn-settings')?.addEventListener('click', () => {
    sfx.ui('bottombar');
    if (currentScreen() === 'settings') leave();
    else showScreen('settings');
  });
  on(EV.SCREEN_CHANGED, (id) => {
    $('#btn-settings')?.classList.toggle('is-active', id === 'settings');
    if (id !== 'settings') return;
    base = saved();
    draft = { ...base };
    tab = 'game';
    render();
  });
  // leaving by the bottom bar instead of BACK drops what was not saved, as BACK does
  on(EV.SCREEN_CHANGED, (id) => { if (id !== 'settings' && base && draft && dirty()) revert(); });
}
