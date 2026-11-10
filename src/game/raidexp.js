// =========================================================
// what a raid is worth
//
// Experience earned in a raid is not the character's until the raid is over.
// It is kept line by line under the four headings of the client's
// EXPERIENCE GAINED screen, and how the raid ended multiplies the sum: half
// as much again for coming out alive, three quarters for being killed or
// lost, half for a run through, nothing for walking away from it.
//
// The lines, what each is worth and the multipliers are the game's (the
// wiki's Experience page, 2026-09).
// =========================================================

import { game, addExp } from '../core/state.js';

/**
 * The headings and their lines, as the screen lists them. `why` is the
 * career counter a heading's experience goes to; a `counted` line is written
 * with how many times it was earned.
 */
export const SECTIONS = [
  { id: 'combat', title: 'StatsCombatExperience', why: 'kill', ico: 'icon_statscategory_combat', lines: [
    { id: 'elim', label: 'StatsElimination', counted: true },
    { id: 'head', label: 'StatsHeadshot', counted: true },
    { id: 'streak', label: 'StatsStreak' },
    { id: 'heavy', label: 'StatsCausedHeavyDamage' },
  ] },
  { id: 'exploring', title: 'StatsExploring', why: 'survive', ico: 'icon_statscategory_overall', lines: [
    { id: 'escape', label: 'StatsEscape' },
  ] },
  { id: 'treatment', title: 'StatsTreatment', why: 'heal', ico: 'icon_health', lines: [
    { id: 'healed', label: 'StatsHealed' },
    { id: 'energy', label: 'StatsEnergy' },
    { id: 'hydration', label: 'StatsHydration' },
  ] },
  { id: 'looting', title: 'StatsLooting', why: 'loot', ico: 'icon_statscategory_looting', lines: [
    { id: 'items', label: 'StatsItems', counted: true },
    { id: 'search', label: 'StatsSearching', counted: true },
    { id: 'breach', label: 'StatsDoorsBreached', counted: true },
    { id: 'unlock', label: 'StatsDoorsUnlocked', counted: true },
  ] },
];

/** what the way a raid ended makes of its experience */
export const MULT = { survived: 1.5, mia: 0.75, kia: 0.75, runner: 0.5, left: 0 };

/** what a kill is worth by who it was */
export const KILL_XP = { pmc: 120, scav: 55, raider: 135, rogue: 110, tagilla: 1225 };

/** a raid begins: from here experience is kept, not given */
export function openTally() {
  game.raidExp = {};
}

/**
 * Put experience on one of the raid's lines (`combat/elim`, `looting/items`
 * ...). False when no raid is keeping count.
 */
export function tally(line, amount, count = 1) {
  const kept = game.raidExp;
  if (!kept || !(amount > 0)) return false;
  const row = kept[line] || (kept[line] = { xp: 0, n: 0 });
  row.xp += amount;
  row.n += count;
  return true;
}

/** what the raid has earned so far under some headings, before any multiplier */
export function tallied(...sections) {
  let sum = 0;
  for (const key in game.raidExp || {}) if (sections.includes(key.split('/')[0])) sum += game.raidExp[key].xp;
  return sum;
}

/**
 * The raid is over. What it was worth as the screen lists it, and the
 * character has it.
 * @param {string} status survived | runner | kia | mia | left
 */
export function closeTally(status) {
  const kept = game.raidExp || {};
  game.raidExp = null;
  const sections = SECTIONS.map((s) => {
    const lines = s.lines.map((l) => ({ ...l, xp: Math.round(kept[`${s.id}/${l.id}`]?.xp || 0), n: kept[`${s.id}/${l.id}`]?.n || 0 })).filter((l) => l.xp > 0);
    return { ...s, lines, sum: lines.reduce((n, l) => n + l.xp, 0) };
  }).filter((s) => s.lines.length);
  const base = sections.reduce((n, s) => n + s.sum, 0);
  const mult = MULT[status] ?? 1;
  const total = Math.round(base * mult);
  const before = game.profile.exp;
  // each heading's share goes to the career counter that is its own
  let left = total;
  sections.forEach((s, i) => {
    const part = i === sections.length - 1 ? left : Math.round(s.sum * mult);
    left -= part;
    addExp(part, s.why);
  });
  return { sections, base, mult, total, before };
}
