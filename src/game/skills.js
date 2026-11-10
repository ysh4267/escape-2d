// =========================================================
// skills
//
// A skill is a number of points. Levels come out of the points the way the
// game counts them: the first levels are cheap - ten points for the first,
// twenty for the second - and from the tenth on every level costs a hundred.
// Level 51 is elite and the top.
//
// Points are earned by doing the thing (sprinting for Endurance, searching
// for Search and Attention, treating wounds for the medical skills ...), at
// the game's own rate; a task can also hand a level over outright.
// =========================================================

import { game, saveSoon } from '../core/state.js';
import { emit, EV } from '../core/events.js';
import { tOr } from '../core/i18n.js';
import { DB } from './db.js';

export const MAX_SKILL_LEVEL = 51;

/** points one level costs: 10, 20 ... 90, then 100 a level */
const costOf = (level) => Math.min(100, (level + 1) * 10);

function book() {
  const p = game.profile;
  if (!p.skills || typeof p.skills !== 'object') p.skills = {};
  return p.skills;
}

/** where a number of points stands: [level, points into it, points it takes] */
function stateOf(pts) {
  let level = 0;
  while (level < MAX_SKILL_LEVEL) {
    const c = costOf(level);
    if (pts < c) return [level, pts, c];
    pts -= c;
    level++;
  }
  return [MAX_SKILL_LEVEL, 0, 0];
}

/** [level, points into it, points it takes] */
export function skillState(id) { return stateOf(book()[id] || 0); }

/** remember where every skill stands: a raid is about to begin */
export function markSkills() {
  game.profile.skillsMark = { ...book() };
}

/**
 * What a skill has gained since the last raid began - the green end of its
 * bar. `from` is where the bar stood then as a share of the level it is in
 * now (0 when that was a level ago: the whole fill is new) and `shown` the
 * figure written over it, counted the way the client counts it: the rest of
 * a level and every whole one crossed are worth what the level after costs,
 * so a first level reads +20 and four of them +140.
 * @returns {{ from: number, shown: number } | null}
 */
export function skillGain(id) {
  const now = book()[id] || 0;
  const was = Math.min(now, game.profile.skillsMark?.[id] || 0);
  if (now - was < 0.005) return null;
  const [l0, i0, c0] = stateOf(was);
  const [l1, i1, c1] = stateOf(now);
  if (l0 === l1) return { from: c1 ? i0 / c1 : 0, shown: i1 - i0 };
  let shown = (1 - (c0 ? i0 / c0 : 0)) * costOf(l0 + 1);
  for (let l = l0 + 1; l < l1; l++) shown += costOf(l + 1);
  return { from: 0, shown: shown + i1 };
}

export function skillLevel(id) { return skillState(id)[0]; }

export function isElite(id) { return skillLevel(id) >= MAX_SKILL_LEVEL; }

function pointsForLevel(level) {
  let n = 0;
  for (let i = 0; i < Math.min(level, MAX_SKILL_LEVEL); i++) n += costOf(i);
  return n;
}

/**
 * Earn points in a skill. `raw` is in the game's own units for the action;
 * the global progress rate is applied here.
 */
export function addSkillPoints(id, raw) {
  if (!(raw > 0)) return;
  const rate = DB.progress?.skill?.rate ?? 0.4;
  const before = skillLevel(id);
  if (before >= MAX_SKILL_LEVEL) return;
  book()[id] = Math.min(pointsForLevel(MAX_SKILL_LEVEL), (book()[id] || 0) + raw * rate);
  const after = skillLevel(id);
  if (after !== before) {
    emit(EV.SKILL_UP, { id, level: after });
    saveSoon();
  }
}

/** a task reward: whole levels, on top of wherever the skill stands */
export function addSkillLevels(id, levels) {
  const [level, into] = skillState(id);
  const target = Math.min(MAX_SKILL_LEVEL, level + levels);
  if (target === level) return;
  book()[id] = pointsForLevel(target) + (target < MAX_SKILL_LEVEL ? into : 0);
  emit(EV.SKILL_UP, { id, level: target });
  saveSoon();
}

/** the skill's row of the table: { id, name, cls?, buffs? } */
export function skillMeta(id) {
  return (DB.progress?.skills || []).find((x) => x.id === id) || null;
}

/** the client files a skill's name under its id */
export function skillName(id) {
  return tOr(id, skillMeta(id)?.name || id);
}

/** the skills the SKILLS tab lists, in its order: the ones the table gives a class */
export function listedSkills() {
  return (DB.progress?.skills || []).filter((s) => s.cls);
}

/** a number the way the client's format string asks for it: `0.#%` or `0.#` */
function formatted(value, spec) {
  const pct = spec.endsWith('%');
  return String(Math.round(value * (pct ? 1000 : 10)) / 10) + (pct ? '%' : '');
}

/**
 * What a skill does at the level it stands at, an entry for each effect in
 * the tooltip's order: its picture, whether it is an elite one, and its
 * sentence in pieces - the client brackets the part it lights up
 * ("Increases jump height by [0.4%]"). An effect grows by the level up to
 * 50; the elite ones are only there at the top.
 * @returns {{ ico: string|null, elite: boolean, parts: { text: string, lit: boolean }[] }[]}
 */
export function skillBuffs(id) {
  const level = skillLevel(id);
  const out = [];
  for (const b of skillMeta(id)?.buffs || []) {
    if (b.e && level < MAX_SKILL_LEVEL) continue;
    const line = tOr(b.id, null);
    if (line == null) continue;
    let v = b.v ?? 0;
    if (!b.e) v = v * Math.min(50, level) + (level >= MAX_SKILL_LEVEL ? b.ea || 0 : 0);
    const text = line.replace(/\{0(?::([^}]*))?\}/g, (m, spec) => (spec ? formatted(v, spec) : String(v)));
    const parts = text.split(/\[([^\]]*)\]/).map((piece, i) => ({ text: piece, lit: i % 2 === 1 })).filter((x) => x.text);
    out.push({ ico: b.ico || null, elite: !!b.e, parts });
  }
  return out;
}

/** the client's picture for each skill: the sprite `skill_<this>` in the `skills` art pack */
const SKILL_ART = {
  Endurance: 'physical_endurance', Strength: 'physical_strength', Vitality: 'physical_vitality', Health: 'physical_health',
  Metabolism: 'physical_metabolism', Immunity: 'physical_immunity', StressResistance: 'mental_stressresistance',
  Perception: 'mental_perception', Intellect: 'mental_intellect', Attention: 'mental_attention', Charisma: 'mental_charisma',
  Pistol: 'combat_pistols', Revolver: 'combat_revolvers', SMG: 'combat_smgs', Assault: 'combat_assaultrifles',
  Shotgun: 'combat_shotguns', Sniper: 'combat_sniperrifles', LMG: 'combat_lmgs', HMG: 'combat_hmgs', Launcher: 'combat_launchers',
  AttachedLauncher: 'combat_ugls', Throwing: 'combat_grenades', Melee: 'combat_melee', DMR: 'combat_dmrs',
  AimDrills: 'combat_weapondrawing', RecoilControl: 'combat_weaponswitch', TroubleShooting: 'combat_troubleshooting',
  Surgery: 'practical_surgery', CovertMovement: 'practical_covertmovement', Search: 'practical_search', MagDrills: 'practical_magdrills',
  FieldMedicine: 'practical_fieldmedical', FirstAid: 'practical_basicmedical', LightVests: 'practical_lightarmor',
  HeavyVests: 'practical_heavyarmor', WeaponTreatment: 'practical_weapontreatment', HideoutManagement: 'practical_hideoutmanagement',
  Crafting: 'practical_crafting', Lockpicking: 'practical_lockpicking', Auctions: 'practical_auctions',
  Cleanoperations: 'practical_cleanoperations', NightOps: 'practical_nightoperations', SilentOps: 'practical_silentoperations',
  Shadowconnections: 'practical_shadowconnections', Taskperformance: 'practical_taskperformance',
};
export function skillSprite(id) { return SKILL_ART[id] ? `skill_${SKILL_ART[id]}` : null; }

export function allSkills() {
  return (DB.progress?.skills || []).map((s) => {
    const [level, into, cost] = skillState(s.id);
    return { id: s.id, name: s.name, level, into, cost };
  });
}

// ---------------------------------------------------------
// what the skills do
//
// Each of these is the game's own per-level effect (the wiki's tables),
// expressed as the multiplier the rest of the code applies.
// ---------------------------------------------------------
const lv = (id) => Math.min(50, skillLevel(id));

/** stamina capacity: +0.6% a level, 30% at 50 */
export const enduranceStamina = () => 1 + lv('Endurance') * 0.006;
/** carry weight before the overweight band: +0.6% a level */
export const strengthCarry = () => 1 + lv('Strength') * 0.006;
/** chance a wound bleeds: -0.6% a level (relative) */
export const vitalityBleed = () => 1 - lv('Vitality') * 0.006;
/** energy and hydration burn: -0.6% a level */
export const metabolismBurn = () => 1 - lv('Metabolism') * 0.006;
/** how fast a container gives up its contents: +0.4% a level (Search) */
export const searchSpeed = () => 1 + lv('Search') * 0.004;
/** chance an item is found instantly, per item uncovered: +0.4% a level (Attention) */
export const attentionInstant = () => lv('Attention') * 0.004;
/** how fast an unknown item is examined: +2% a level (Intellect) */
export const intellectExamine = () => 1 + lv('Intellect') * 0.02;
/** magazine loading and unloading speed: +0.6% a level (Mag Drills) */
export const magDrillsSpeed = () => 1 + lv('MagDrills') * 0.006;
/** how far footsteps carry: -0.6% a level (Covert Movement) */
export const covertNoise = () => 1 - lv('CovertMovement') * 0.006;
/** medkit use speed: +0.7% a level (First Aid) */
export const firstAidSpeed = () => 1 + lv('FirstAid') * 0.007;
/** surgery speed: +0.4% a level */
export const surgerySpeed = () => 1 + lv('Surgery') * 0.004;
