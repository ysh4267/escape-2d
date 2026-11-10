// =========================================================
// a new character
//
// What a PMC owns on day one is not made up here. Each edition of the game
// starts a character with its own stash size, its own secure container and
// its own pile of gear, and the two factions are kitted differently; those
// starting profiles are the game's own (the SPT dump's templates/profiles),
// carried through tools/build_meta.py as rows of
//   [template id, parent row, slot or grid name, { at, n, dur, hp ... }]
// This module turns one of them into real items in the stash and on the body.
// =========================================================

import { game, STASH_W, save } from '../core/state.js';
import { TPL } from '../data/items.js';
import { Grid, Item } from '../inventory/model.js';
import { Equipment } from '../inventory/equipment.js';
import { Health } from '../raid/health.js';
import { DB, keyOf } from './db.js';

/** stash rows per edition (ten cells wide, as ever) */
export const EDITIONS = [
  { key: 'standard', name: 'Standard Edition', rows: 30, note: '10 x 30 stash, Alpha container' },
  { key: 'left_behind', name: 'Left Behind Edition', rows: 40, note: '10 x 40 stash, Alpha container, more starting gear' },
  { key: 'prepare_for_escape', name: 'Prepare for Escape Edition', rows: 50, note: '10 x 50 stash, Beta container, better standing with traders' },
  { key: 'edge_of_darkness', name: 'Edge of Darkness Edition', rows: 68, note: '10 x 68 stash, Gamma container, the most starting gear' },
  { key: 'unheard', name: 'The Unheard Edition', rows: 72, note: '10 x 72 stash, Gamma container, larger pockets' },
];

export function editionInfo(key) {
  return EDITIONS.find((e) => e.key === key) || EDITIONS[0];
}

const EQUIP_SLOT = {
  FirstPrimaryWeapon: 'primary', SecondPrimaryWeapon: 'secondary', Holster: 'holster',
  Scabbard: 'scabbard', Headwear: 'head', Earpiece: 'ears', FaceCover: 'face', Eyewear: 'eyes',
  ArmorVest: 'armor', TacticalVest: 'rig', Backpack: 'backpack', SecuredContainer: 'secure',
};

/** which of a container's grids a profile row names: "main", "1".."n", "pocket1".. */
function gridOf(host, slot) {
  if (!host.grids) return null;
  if (slot === 'main') return host.grids[0];
  const m = /(\d+)$/.exec(slot);
  if (m) return host.grids[Number(m[1]) - 1] || null;
  return host.grids[0];
}

function makeItem(key, extra) {
  const tpl = TPL[key];
  const it = new Item(key, { bare: true, examined: true, stack: extra?.n || 1 });
  if (extra?.dur) {
    if (extra.dur[0] != null && it.dura != null) it.dura = extra.dur[0];
    if (extra.dur[1] != null && it.maxDura != null) it.maxDura = extra.dur[1];
  }
  if (extra?.hp != null && it.res != null) it.res = Math.min(tpl.res?.max ?? extra.hp, extra.hp);
  if (extra?.res != null && it.res != null) it.res = extra.res;
  if (extra?.folded) it.folded = true;
  return it;
}

/**
 * Build one starting inventory into `stash` and `equipment`.
 * Rows whose template this build does not have are skipped, and so is
 * everything hanging under them. Returns counts for the report.
 */
export function buildInventory(inv, stash, equipment) {
  const nodes = new Array(inv.items.length).fill(null);
  const stat = { made: 0, missing: 0, unplaced: 0 };
  // cartridges are listed bottom-up by their index; apply them in that order
  const order = inv.items.map((_, i) => i).sort((a, b) => {
    const ra = inv.items[a], rb = inv.items[b];
    if (ra[1] !== rb[1] || ra[2] !== 'cartridges' || rb[2] !== 'cartridges') return a - b;
    return (ra[3]?.i || 0) - (rb[3]?.i || 0);
  });

  for (const i of order) {
    const [tid, parent, slot, extra] = inv.items[i];
    if (i === inv.equipment || i === inv.stash || parent < 0) continue;   // the roots themselves
    const key = keyOf(tid);

    // ---- straight onto the body ----
    if (parent === inv.equipment) {
      if (slot === 'Pockets') { nodes[i] = { pockets: true }; continue; }
      const name = EQUIP_SLOT[slot];
      if (!name || !key) { if (!key) stat.missing++; continue; }
      const it = makeItem(key, extra);
      const s = equipment.get(name);
      if (s && s.canAccept(it) && !s.item) { s.set(it); nodes[i] = it; stat.made++; } else stat.unplaced++;
      continue;
    }

    // ---- into the stash, at the cell the profile gives ----
    if (parent === inv.stash) {
      if (!key) { stat.missing++; continue; }
      const it = makeItem(key, extra);
      nodes[i] = it;     // children hang on it before it is weighed for a place
      stat.made++;
      continue;
    }

    const host = nodes[parent];
    if (!host) continue;                       // its parent does not exist here
    if (!key) { stat.missing++; continue; }

    // ---- pockets ----
    if (host.pockets) {
      const m = /(\d+)$/.exec(slot);
      const g = equipment.pockets?.[m ? Number(m[1]) - 1 : 0];
      const it = makeItem(key, extra);
      if (g && g.canPlace(it, 0, 0, 0)) { g.place(it, 0, 0, 0); nodes[i] = it; stat.made++; } else stat.unplaced++;
      continue;
    }

    // ---- rounds in a magazine, a round in the chamber ----
    if (slot === 'cartridges') {
      if (host.rounds && (host.tpl.ammoFilter || []).includes(key)) {
        const n = Math.min(extra?.n || 1, (host.tpl.magSize || 0) - host.ammoCount);
        if (n > 0) host.rounds.push({ t: key, n });
      }
      continue;
    }
    if (slot.startsWith('patron_in_weapon')) {
      if (host.chamber && host.chamber.length < (host.tpl.wpn?.chambers || 1)) host.chamber.push(key);
      continue;
    }

    // ---- a part on a gun, a plate in a vest ----
    const sl = host.modSlot ? host.modSlot(slot) : null;
    if (sl) {
      if (sl.def.f.includes(key) && !sl.item) {
        const part = makeItem(key, extra);
        sl.set(part);
        nodes[i] = part;
        stat.made++;
      }
      continue;
    }

    // ---- inside a container ----
    const grid = gridOf(host, slot);
    if (grid) {
      const it = makeItem(key, extra);
      const at = extra?.at;
      if (at && grid.canPlace(it, at[0], at[1], at[2])) grid.place(it, at[0], at[1], at[2]);
      else {
        const spot = grid.findSpot(it);
        if (spot) grid.place(it, spot.x, spot.y, spot.rot); else { stat.unplaced++; continue; }
      }
      nodes[i] = it;
      stat.made++;
    }
  }

  // the stash last, biggest first, so an assembled gun is placed at the size
  // it ended up rather than the size of its bare receiver
  const forStash = [];
  inv.items.forEach((row, i) => { if (row[1] === inv.stash && nodes[i]) forStash.push([nodes[i], row[3]?.at]); });
  for (const [it, at] of forStash) {
    if (at && stash.canPlace(it, at[0], at[1], at[2])) { stash.place(it, at[0], at[1], at[2]); continue; }
    const spot = stash.findSpot(it);
    if (spot) stash.place(it, spot.x, spot.y, spot.rot);
    else { stat.unplaced++; stat.made--; }
  }
  return stat;
}

/**
 * Start a character over: an empty stash of the edition's size, the edition's
 * kit for the chosen faction, a healthy body, nothing learned.
 */
export function createProfile({ name = 'PMC', faction = 'USEC', edition = 'standard' } = {}) {
  const ed = editionInfo(edition);
  const p = game.profile;
  Object.assign(p, {
    name, faction: faction.toUpperCase(), edition: ed.key, registered: Date.now(),
    level: 1, exp: 0, raids: 0, survived: 0, died: 0, extracted: 0, bestHaul: 0,
    stats: {}, traders: {}, quests: {}, qitems: {}, mail: [], skills: {},
    stashRows: ed.rows,
  });
  p.examined = new Set();

  game.stash = new Grid(STASH_W, ed.rows, { tag: 'stash', label: 'STASH' });
  game.equipment = new Equipment();
  game.health = new Health();

  const src = DB.profiles?.editions?.[ed.key]?.[p.faction.toLowerCase()];
  let stat = { made: 0, missing: 0, unplaced: 0 };
  if (src) stat = buildInventory(src.inventory, game.stash, game.equipment);

  // what you start with you know: nothing in the opening kit needs examining
  for (const g of [game.stash, ...game.equipment.allGrids()]) {
    for (const it of g.items()) { p.examined.add(it.tplId); for (const d of it.descendants()) p.examined.add(d.tplId); }
  }
  for (const it of game.equipment.everything()) p.examined.add(it.tplId);
  for (const t of Object.values(TPL)) {
    if (t.known || t.alwaysExamined || t.examined) p.examined.add(t.key);
  }
  save();
  return stat;
}
