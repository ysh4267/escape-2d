// =========================================================
// the flea market: rules
// =========================================================

import { game } from '../core/state.js';
import { DB } from './db.js';

/** the level the market opens at */
export function fleaMinLevel() { return DB.progress?.flea?.minLevel || 15; }

export function fleaUnlocked() { return game.profile.level >= fleaMinLevel(); }
