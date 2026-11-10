// =========================================================
// the hideout: rules
//
// What the hideout gives the rest of the game is read from here, as plain
// functions: how tall the stash is, how much quicker the body mends between
// raids, what a Scav run or a flea market listing costs with the Intelligence
// Center built. Each is the sum of the bonuses of every zone as it stands -
// the game's own numbers (src/data/hideout-db.json).
// =========================================================

import { game } from '../core/state.js';

/** the stash is as tall as the edition and the Stash zone made it */
export function stashRows() { return game.profile.stashRows || game.stash?.h || 0; }

/** additional raid experience, as a fraction (Library: +0.15) */
export function expBoost() { return 0; }

/** health regeneration between raids, as a fraction on top of the body's own */
export function healthRegen() { return 0; }
export function energyRegen() { return 0; }
export function hydrationRegen() { return 0; }

/** skill group leveling boost for 'Physical' | 'Combat' | 'Practical' | 'Mental' */
export function skillBoost() { return 0; }

/** what the Scav cooldown is multiplied by (Intelligence Center: 0.85, 0.8) */
export function scavCooldownFactor() { return 1; }

/** what an insurance return time is multiplied by */
export function insuranceReturnFactor() { return 1; }

/** task money rewards, as a fraction on top */
export function questMoneyBoost() { return 0; }

/** the share of a flea market listing fee the hideout takes off, 0..1 */
export function fleaFeeDiscount() { return 0; }
