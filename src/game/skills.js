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
import { DB } from './db.js';

export const MAX_SKILL_LEVEL = 51;

/** points one level costs: 10, 20 ... 90, then 100 a level */
const costOf = (level) => Math.min(100, (level + 1) * 10);

function book() {
  const p = game.profile;
  if (!p.skills || typeof p.skills !== 'object') p.skills = {};
  return p.skills;
}

/** [level, points into it, points it takes] */
export function skillState(id) {
  let pts = book()[id] || 0;
  let level = 0;
  while (level < MAX_SKILL_LEVEL) {
    const c = costOf(level);
    if (pts < c) return [level, pts, c];
    pts -= c;
    level++;
  }
  return [MAX_SKILL_LEVEL, 0, 0];
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

export function skillName(id) {
  const s = (DB.progress?.skills || []).find((x) => x.id === id);
  return s ? s.name : id;
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

/**
 * The skills the character screen lists, in the game's five groups. Only the
 * ones this game can actually train are listed with their group; the rest of
 * the table is still readable by id for tasks that ask for them.
 */
export const SKILL_GROUPS = [
  { key: 'physical', name: 'Physical', skills: ['Endurance', 'Strength', 'Vitality', 'Health', 'StressResistance', 'Metabolism', 'Immunity'] },
  { key: 'mental', name: 'Mental', skills: ['Perception', 'Intellect', 'Attention', 'Charisma', 'Memory'] },
  { key: 'combat', name: 'Combat', skills: ['Pistol', 'Revolver', 'SMG', 'Assault', 'Shotgun', 'Sniper', 'LMG', 'HMG', 'Launcher', 'AttachedLauncher', 'Throwing', 'Melee', 'DMR', 'RecoilControl', 'AimDrills', 'TroubleShooting'] },
  { key: 'practical', name: 'Practical', skills: ['Surgery', 'CovertMovement', 'Search', 'MagDrills', 'FieldMedicine', 'FirstAid', 'LightVests', 'HeavyVests', 'WeaponTreatment', 'HideoutManagement', 'Crafting', 'Lockpicking'] },
];

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
