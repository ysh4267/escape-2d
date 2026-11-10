// =========================================================
// the main menu
//
// A scene with the game's logo hung in it, and down the middle of it five
// lines of plain text: ESCAPE FROM TARKOV, CHARACTER, TRADING, HIDEOUT, EXIT.
// Nothing else - no name, no level, no news. A line under the pointer gets
// the torn cream plate behind it and the glyph of where it leads at its left.
// In the corner the zone the profile plays in.
// =========================================================

import { $, el } from '../core/util.js';
import { on, EV } from '../core/events.js';
import { sfx } from '../core/audio.js';
import { t } from '../core/i18n.js';
import { uiIcon, uiImg } from '../core/uiart.js';
import { confirmDialog } from '../inventory/dialogs.js';
import { showScreen } from './shell.js';
import { openCharacter } from './character.js';

/** what the first line starts; set by whoever owns the raid flow */
let onPlay = () => {};
export function setPlayHandler(fn) { onPlay = fn; }

/**
 * The lines, with the middle of each in the 1080 frame as the client places
 * it. The client sizes a line's plate from its label written bold between
 * three underscores a side, which is where the room around the text comes
 * from; `sizer` is that string.
 */
const ITEMS = [
  { key: 'play', label: 'ESCAPE FROM TARKOV', y: 609.5, big: true, run: () => onPlay() },
  { key: 'character', label: 'CHARACTER', y: 694, ico: 'icon_mainmenu_character', run: () => openCharacter() },
  { key: 'traders', label: 'Trading', y: 776, ico: 'icon_trade', run: () => showScreen('traders') },
  { key: 'hideout', label: 'HIDEOUT', y: 858, ico: 'hideout_icon_black', run: () => showScreen('hideout') },
  {
    key: 'exit', label: 'EXIT', y: 940, ico: 'exit_status_runner',
    run: async () => {
      const ok = await confirmDialog({
        title: t('Confirmation'), body: t('UI/leave_game_confirmation_text'), confirmLabel: t('YES (Y)'),
      });
      if (ok) showScreen('boot');
    },
  },
];

export function renderMenu() {
  const host = $('#menu-host');
  if (!host) return;
  host.replaceChildren();

  host.append(el('div', { class: 'menu__logo' }), el('div', { class: 'menu__glow' }));
  for (const it of ITEMS) {
    const label = t(it.label);
    const b = el('button', {
      class: `dbtn menu__item${it.big ? ' menu__item--big' : ''}`, style: { top: `${it.y}px` },
      dataset: { key: it.key, sfx: 'own', hover: 'own' },
    },
    el('span', { class: 'menu__sizer' }, it.big ? label : `___${label}___`),
    it.ico ? uiIcon(it.ico, 'menu__ico') : null,
    el('span', { class: 'menu__label' }, label));
    b.addEventListener('pointerenter', () => sfx.ui('hover'));
    b.addEventListener('click', () => { sfx.ui('mainmenu'); it.run(); });
    host.append(b);
  }
  host.append(
    el('div', { class: 'menu__mode' }, el('span', {}, 'PVE ZONE'), uiImg('pve_texture', '', { w: 65, h: 65 })));
}

export function initMenu() {
  on(EV.SCREEN_CHANGED, (id) => { if (id === 'menu') renderMenu(); });
}
