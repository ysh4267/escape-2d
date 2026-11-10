// =========================================================
// the scene behind the menus
//
// The client plays an environment behind its menus and lets the player pick
// which (Settings > GAME > Main menu background): the server room, the
// Unheard and CyberTark rooms, the four skylines of the story's endings, or a
// different one each launch. Here each is a still of that scene and the logo
// that hangs in it, in a pack of its own (tools/build_ui.py), so only the one
// on show is fetched.
//
// The choice is an interface preference, not part of a character: it is kept
// beside the profile, known before the profile loads and untouched by a wipe.
// =========================================================

import { loadUiGroup } from '../core/uiart.js';

/** the scenes, in the order the client lists them, each under the client's own name for it */
export const SCENES = [
  { id: 'serverroom', key: 'SeasonalBDEnvironmentUiType' },
  { id: 'unheard', key: 'TheUnheardEditionEnvironmentUiType' },
  { id: 'cybertark', key: 'CyberEnvironmentUiType' },
  { id: 'bleakhorizon', key: 'EndingAndSurvivedEnvironmentUiType' },
  { id: 'stormfront', key: 'EndingDidntEscapeFromYourselfEnvironmentUiType' },
  { id: 'dusk', key: 'EndingInTheDarknessEnvironmentUiType' },
  { id: 'peacefulsky', key: 'EndingForHumanityEnvironmentUiType' },
];
export const RANDOM_SCENE = { id: 'random', key: 'RandomEnvironmentUiType' };

const STORE = 'escape2d.scene';
const DEFAULT = 'serverroom';

/** what the player picked: a scene id or 'random' */
export function sceneChoice() {
  let v = null;
  try { v = localStorage.getItem(STORE); } catch { /* storage is off: the default scene */ }
  return v === RANDOM_SCENE.id || SCENES.some((s) => s.id === v) ? v : DEFAULT;
}

export function storeSceneChoice(id) {
  try { localStorage.setItem(STORE, id); } catch { /* it lasts for this visit only */ }
}

/** 'random' settles on one scene per visit, so going in and out of a screen does not reshuffle it */
let rolled = null;
let showing = null;

/** put a scene behind the menus; resolves once its picture is up */
export async function showScene(choice = sceneChoice()) {
  let id = choice;
  if (id === RANDOM_SCENE.id) {
    if (!rolled) rolled = SCENES[Math.floor(Math.random() * SCENES.length)].id;
    id = rolled;
  }
  if (!SCENES.some((s) => s.id === id)) id = DEFAULT;
  showing = id;
  await loadUiGroup(`scene_${id}`);
  // a later choice may have overtaken this one while its pack was on the way
  if (showing !== id) return;
  const root = document.documentElement;
  const art = (name) => `var(--ui-${name})`;
  root.style.setProperty('--menu-bg', art(`backdrop_${id}`));
  root.style.setProperty('--menu-logo', art(`scene_logo_${id}`));
  root.dataset.scene = id;
}
