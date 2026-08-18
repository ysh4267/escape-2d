// =========================================================
// raid session: loot placement, movement, searching, extraction
// =========================================================

import { Grid, Item, autoPlace, detach } from '../inventory/model.js';
import { isFunctional, spawnWeapon, spawnMag, weaponStats } from '../inventory/weapon.js';
import { Gunplay, landRound, spreadFor, hitChance, hearRange as shotHearRange, isSuppressed, pelletSpread, MOVING_TARGET_SWAY } from './gunplay.js';
import { CONTAINERS, poolsFor, EMPTY_CHANCE, POOLS } from '../data/loot.js';
import { TPL, BY_ID } from '../data/items.js';
import { areaAt, levelInfo } from '../data/maps.js';
import { NavGrid } from './nav.js';
import { Scav } from './ai.js';
import { makeRng } from '../core/rng.js';
import { clamp, dist, uid } from '../core/util.js';
import { game, addExp } from '../core/state.js';
import { sfx } from '../core/audio.js';
import { emit, EV } from '../core/events.js';
import { Health, PART, FX, FX_INFO } from './health.js';

export const RAID_STATUS = {
  RUNNING: 'running',
  SURVIVED: 'survived',
  MIA: 'mia',
  KIA: 'kia',
  LEFT: 'left',
};

const EXTRACT_HOLD = 6.0;      // seconds to hold F
const INTERACT_RANGE = 2.2;    // svg units
const STAIR_RANGE = 2.6;       // how close counts as "on the stairs"
const DOOR_REACH = 1.5;        // how far ahead a shut door is opened from
const BASE_SPEED = 6.4;        // units/sec walking
const SPRINT_MULT = 1.72;
const OVERWEIGHT_AT = 35;      // kg, speed starts dropping
const CRITICAL_AT = 65;        // kg, heavily slowed
const LOOSE_SPAWN_CHANCE = 0.45;   // how often a loose-loot spot is occupied
const SCAV_COUNT = 6;              // hostiles on the plant at the start

/**
 * What the scavs bring, by tier: [gun, round, weight] picks, spare magazine
 * count, and the chance / choice of a vest and a helmet. The bottom tier is
 * the pistol-and-shotgun crowd with the cheapest rounds; the top carries an
 * AK with a proper round and something on its chest. `skill` scales their
 * spread (1 = a steady shooter).
 */
const SCAV_LOADOUTS = [
  {
    guns: [['w_pm', 'am_9x18pst', 5], ['w_tt', 'am_762tt', 4], ['w_mp133', 'am_12buck', 4], ['w_kedr', 'am_9x18pst', 3], ['w_vpo136', 'am_762ps', 2]],
    mags: [0, 1], armor: [0.25, ['ar_paca']], helmet: null, skill: 2.4,
  },
  {
    guns: [['w_akm', 'am_762ps', 4], ['w_aks74u', 'am_545ps', 4], ['w_kedrb', 'am_9x18pst', 2], ['w_mp153', 'am_12buck', 3], ['w_vpo136', 'am_762ps', 2], ['w_pb', 'am_9x18pst', 1]],
    mags: [1, 2], armor: [0.5, ['ar_paca', 'ar_module', 'ar_6b23']], helmet: [0.3, ['hl_6b47']], skill: 1.8,
  },
  {
    guns: [['w_ak74n', 'am_545bp', 4], ['w_akm', 'am_762bp', 3], ['w_aks74u', 'am_545bp', 2], ['w_saiga', 'am_flechette', 2]],
    mags: [1, 3], armor: [0.75, ['ar_6b23', 'ar_zhuk', 'ar_6b13']], helmet: [0.5, ['hl_6b47', 'hl_fast']], skill: 1.4,
  },
];

export class Raid {
  constructor({ mapDef, geo, seed }) {
    this.map = mapDef;
    this.geo = geo;
    this.rng = makeRng(seed ?? (Math.random() * 0xffffffff) >>> 0);
    this.status = RAID_STATUS.RUNNING;
    this.time = 0;
    this.timeLeft = mapDef.duration;
    this.containers = [];
    this.seen = new Set();
    this.path = [];
    this.hover = null;
    this.nearExtract = null;
    this.nearStairs = null;
    this.extractHold = 0;
    this.searching = null;
    this.searchProgress = 0;
    this.pendingInteract = null;
    this.openContainerRef = null;
    this.scavs = [];
    this.shots = [];
    this.playerCooldown = 0;
    this.gun = new Gunplay(this);
    this.stats = { searched: 0, found: 0, distance: 0, kills: 0, shots: 0, floors: 1 };

    this.level = mapDef.startLevel;
    this.navs = new Map();
    this.visited = new Set([this.level]);
    this.buildDoors();
    this.buildStairs();
    this.buildExtracts();

    const spawn = this.pickSpawn();
    const p = this.navFor(spawn.level).snap(spawn.x, spawn.y) || [spawn.x, spawn.y];
    this.level = spawn.level;
    this.visited.add(this.level);
    // the body comes into the raid as it left the last one; the raid only
    // reads it through the model, and p.hp is a mirror for the HUD
    this.health = game.health || (game.health = new Health());
    this.health.events = [];
    this.health.dead = false;
    this.using = null;         // {item, part, t, dur} while a med is being applied
    this.player = {
      x: p[0], y: p[1],
      facing: -Math.PI / 2,
      hp: this.health.total, maxHp: this.health.max,
      stamina: 100,
      moving: false,
      sprint: false,
      viewRange: 32,
      spawnName: this.placeName(spawn.level, p[0], p[1]),
    };

    this.placeLoot();
    this.refreshDoorAccess();
    this.spawnScavs();
    this.markRaidStart();
  }

  // ---------------------------------------------------------
  // floors
  // ---------------------------------------------------------
  /** the nav grid for a floor, built the first time it is needed */
  navFor(level) {
    let n = this.navs.get(level);
    if (!n) {
      const doors = this.doorsOn(level);
      n = new NavGrid(this.geo, level, doors);
      this.navs.set(level, n);
      // the grid hands each door its index, which is how a flag flip finds it
      doors.forEach((d, i) => { d.nav = n; d.navIndex = i; n.setDoorOpen(i, d.open); });
      this.applyAccess(n, level);
      this.settleLoot(level, n);
    }
    return n;
  }

  get nav() { return this.navFor(this.level); }

  levelInfo(level = this.level) { return levelInfo(this.map, level); }

  /** name a spot the way the loot panel and the HUD want to read it */
  placeName(level, x, y) {
    const a = areaAt(this.map, level, x, y);
    const lvl = this.levelInfo(level);
    return a ? `${a.name} · ${lvl.short}` : lvl.name;
  }

  pickSpawn() {
    const all = this.geo.markers.spawns.filter((s) => this.geo.levels[s.level]);
    const ground = all.filter((s) => s.level === this.map.startLevel);
    return this.rng.pick(ground.length ? ground : all);
  }

  // ---------------------------------------------------------
  // doors
  // ---------------------------------------------------------
  /**
   * Every opening the geometry search found becomes either a door or an empty
   * gap. Narrow ones get a leaf that starts shut, which is how Factory's doors
   * are found at the start of a raid; anything wider is a gateway or a hall
   * mouth with nothing in it to open. The four that the dataset records a lock
   * for keep that lock and the key that answers it.
   */
  buildDoors() {
    this.doors = [];
    for (const lvl of this.map.levels) {
      const L = this.geo.levels[lvl.key];
      if (!L) continue;
      for (const p of L.passages || []) {
        const over = this.map.doorOverrides[p.id] || null;
        const keyed = p.key ? BY_ID[p.key] : null;
        if (!p.key && !over && p.w > this.map.doorMaxWidth) continue;
        this.doors.push({
          id: p.id,
          level: lvl.key,
          x: p.x, y: p.y, a: p.a, w: p.w,
          state: over?.state || (p.key ? 'key' : 'free'),
          keyId: p.key || null,
          keyName: keyed ? keyed.name : (p.key ? 'a key that is not in this build' : null),
          note: over?.note || '',
          name: over?.name || this.map.doorNames[p.id]
            || `${this.placeName(lvl.key, p.x, p.y).split(' · ')[0]} door`,
          open: false,
          nav: null,
          navIndex: -1,
        });
      }
    }
  }

  doorsOn(level) { return this.doors.filter((d) => d.level === level); }

  /**
   * Can the player get through this door at all? A breach door has no key
   * anywhere in the game, but it can be forced, so for routing it counts as
   * passable — it just costs time and noise when you get there.
   */
  canOpen(door) {
    if (door.state === 'free' || door.state === 'breach') return true;
    if (!door.keyId) return false;
    for (const it of game.equipment.everything()) {
      if (it.tpl.id === door.keyId) return true;
    }
    return false;
  }

  applyAccess(nav, level) {
    for (const d of this.doorsOn(level)) {
      if (d.navIndex >= 0) nav.setDoorPassable(d.navIndex, this.canOpen(d));
    }
  }

  /** picking a key up mid-raid has to make the doors it opens routable */
  refreshDoorAccess() {
    for (const [level, nav] of this.navs) this.applyAccess(nav, level);
  }

  openDoor(door, silent = false) {
    if (door.open) return true;
    if (door.state === 'breach') { this.beginBreach(door); return false; }
    if (!this.canOpen(door)) {
      if (!silent) {
        emit(EV.RAID_TOAST, {
          kind: 'warn',
          text: `${door.name} is locked — ${door.keyName || 'no key'}`,
        });
        sfx.ui('back');
      }
      return false;
    }
    door.open = true;
    if (door.nav && door.navIndex >= 0) door.nav.setDoorOpen(door.navIndex, true);
    if (!silent) {
      sfx.openContainer('crate');
      if (door.state === 'key') {
        emit(EV.RAID_TOAST, { kind: 'ok', text: `Unlocked ${door.name}` });
        this.useKey(door.keyId);
      }
    }
    return true;
  }

  /**
   * Forcing a door. It takes a moment, it is loud, and once it is through the
   * door stays open for the rest of the raid — there is no re-locking it. The
   * walk that ran into it picks up again on the far side.
   */
  beginBreach(door) {
    if (this.breaching?.door === door) return;
    if (dist(this.player.x, this.player.y, door.x, door.y) > INTERACT_RANGE + 1.4) return;
    this.breaching = { door, t: 0, resume: this.path.length ? this.path[this.path.length - 1] : null };
    this.path = [];
    this.pendingInteract = null;
    sfx.impact('metal');
    emit(EV.RAID_TOAST, { kind: 'warn', text: `Forcing the ${door.name.toLowerCase()}` });
  }

  cancelBreach() { this.breaching = null; }

  updateBreach(dt) {
    const b = this.breaching;
    if (!b) return;
    if (dist(this.player.x, this.player.y, b.door.x, b.door.y) > INTERACT_RANGE + 1.6) {
      this.breaching = null;
      return;
    }
    b.t += dt;
    if (b.t < this.map.breachTime) {
      // one shoulder into it per beat, which is what makes it carry
      if (Math.floor(b.t / 0.6) !== Math.floor((b.t - dt) / 0.6)) sfx.impact('metal');
      return;
    }
    b.door.open = true;
    if (b.door.nav && b.door.navIndex >= 0) b.door.nav.setDoorOpen(b.door.navIndex, true);
    sfx.openContainer('crate');
    emit(EV.RAID_TOAST, { kind: 'ok', text: `${b.door.name} forced` });
    addExp(20);
    const resume = b.resume;
    this.breaching = null;
    if (resume) this.moveTo(resume[0], resume[1]);
  }

  /** a keyed door costs the key one use, and the key breaks when it runs dry */
  useKey(keyId) {
    for (const it of game.equipment.everything()) {
      if (it.tpl.id !== keyId) continue;
      if (!it.tpl.uses) return;
      it.res = (it.res ?? it.tpl.uses) - 1;
      if (it.res <= 0) {
        detach(it);
        emit(EV.RAID_TOAST, { kind: 'warn', text: `${it.tpl.name} broke` });
        this.refreshDoorAccess();
      }
      return;
    }
  }

  doorAt(x, y, radius = 1.6) {
    let best = null, bestD = radius;
    for (const d of this.doorsOn(this.level)) {
      const k = dist(d.x, d.y, x, y);
      if (k < bestD) { bestD = k; best = d; }
    }
    return best;
  }

  /** the shut door the player is about to walk into, if any */
  doorAhead() {
    const p = this.player;
    if (!this.path.length) return null;
    const t = this.path[0];
    const d = Math.hypot(t[0] - p.x, t[1] - p.y);
    const steps = Math.max(1, Math.ceil(Math.min(d, DOOR_REACH) / 0.3));
    for (let i = 0; i <= steps; i++) {
      const f = (i / steps) * Math.min(1, DOOR_REACH / Math.max(d, 1e-6));
      const idx = this.nav.doorIndexAt(p.x + (t[0] - p.x) * f, p.y + (t[1] - p.y) * f);
      if (idx < 0) continue;
      const door = this.doorsOn(this.level)[idx];
      if (door && !door.open) return door;
    }
    return null;
  }

  // ---------------------------------------------------------
  // stairs
  // ---------------------------------------------------------
  buildStairs() {
    const keys = new Set(this.map.levels.map((l) => l.key));
    this.stairs = (this.geo.stairwells || [])
      .map((s) => ({ ...s, name: 'Stairwell', levels: s.levels.filter((l) => keys.has(l)) }))
      .filter((s) => s.levels.length > 1);
  }

  stairsOn(level) { return this.stairs.filter((s) => s.levels.includes(level)); }

  stairAt(x, y, radius = 2.4) {
    let best = null, bestD = radius;
    for (const s of this.stairsOn(this.level)) {
      const cx = clamp(x, s.rect[0], s.rect[2]);
      const cy = clamp(y, s.rect[1], s.rect[3]);
      const d = Math.hypot(x - cx, y - cy);
      if (d < bestD) { bestD = d; best = s; }
    }
    return best;
  }

  /** the floors this staircase reaches from where the player is standing */
  stairExits(stair) {
    const here = stair.levels.indexOf(this.level);
    if (here < 0) return [];
    const out = [];
    if (here > 0) out.push({ level: stair.levels[here - 1], dir: 'down' });
    if (here < stair.levels.length - 1) out.push({ level: stair.levels[here + 1], dir: 'up' });
    return out;
  }

  useStairs(stair, level) {
    if (!stair.levels.includes(level) || level === this.level) return false;
    const nav = this.navFor(level);
    const spot = nav.snap(stair.x, stair.y, 40);
    if (!spot) {
      emit(EV.RAID_TOAST, { kind: 'warn', text: 'That way is blocked' });
      return false;
    }
    this.cancelSearch();
    this.closeLoot();
    this.path = [];
    this.pendingInteract = null;
    this.level = level;
    this.player.x = spot[0];
    this.player.y = spot[1];
    if (!this.visited.has(level)) {
      this.visited.add(level);
      this.stats.floors = this.visited.size;
    }
    // a floor reached for the first time gets its own few hostiles
    if (!this.scavLevels?.has(level)) this.spawnScavs(this.rng.int(2, 4), level);
    sfx.footstep(false, true, 'metal');
    emit(EV.RAID_LEVEL, { level, name: this.levelInfo(level).name });
    return true;
  }

  // ---------------------------------------------------------
  buildExtracts() {
    const out = [];
    for (const e of this.geo.markers.extracts) {
      // A shared exit is two overlapping trigger volumes, one per faction.
      // Gate 3 is the one that matters here: drawing it twice would stack two
      // rings and two labels on the same gate, so fold them into one that
      // says it is open to both.
      const twin = out.find((o) => o.name === e.name && o.level === e.level
        && dist(o.x, o.y, e.x, e.y) < 8);
      if (twin) {
        if (twin.faction !== e.faction) twin.faction = 'both';
        if (e.faction === 'pmc') { twin.x = e.x; twin.y = e.y; twin.r = e.r; }
        continue;
      }
      out.push({
        ...e,
        note: this.map.extractNotes[e.name] || '',
        // the exits themselves carry no key requirement on Factory; what
        // stands in the way is a locked door in front of them, and that is
        // modelled as a door. Only the smugglers' route wants an item.
        req: e.item || null,
        reqName: e.item ? 'Note with code word Ark' : null,
      });
    }
    this.allExtracts = out;
    this.transits = this.geo.markers.transits.map((t) => ({ ...t }));
  }

  // ---------------------------------------------------------
  /**
   * Hostiles on a floor. The raid starts with SCAV_COUNT on the insertion
   * floor; the first time the player reaches another floor a few more are
   * put there (see useStairs), so the plant is not empty upstairs and the
   * nav grids of floors never visited are never built for nobody.
   */
  spawnScavs(count = SCAV_COUNT, level = this.level) {
    const rng = this.rng;
    const nav = this.navFor(level);
    const spots = this.geo.markers.spawns.filter((s) => s.level === level);
    this.scavLevels = this.scavLevels || new Set();
    this.scavLevels.add(level);
    for (let i = 0; i < count; i++) {
      let pos = null;
      for (let tries = 0; tries < 80 && !pos; tries++) {
        const s = rng.pick(spots);
        if (!s) break;
        const p = nav.snap(s.x, s.y, 12);
        if (!p) continue;
        if (level === this.level && dist(p[0], p[1], this.player.x, this.player.y) < 34) continue;
        pos = p;
      }
      if (!pos) continue;
      const tier = rng.int(0, 2);
      this.scavs.push(new Scav({ x: pos[0], y: pos[1], rng, tier, level, loadout: this.scavLoadout(tier) }));
    }
  }

  /** the hostiles on the floor the player is on */
  scavsHere() {
    return this.scavs.filter((s) => !s.level || s.level === this.level);
  }

  /**
   * What a scav of this tier carries into the fight, as real items: the gun
   * it fires (loaded, its magazine the one it will empty at you), a spare
   * magazine or two, and the vest and helmet the round has to get through.
   * Everything here is what its body gives up afterwards - the gun with the
   * rounds it did not fire, the vest with the holes you put in it.
   */
  scavLoadout(tier) {
    const rng = this.rng;
    const t = SCAV_LOADOUTS[clamp(tier, 0, SCAV_LOADOUTS.length - 1)];
    const [gunKey, ammoKey] = rng.weighted(t.guns, (e) => e[2] || 1);
    const weapon = spawnWeapon(gunKey, { rng, loaded: true, ammo: ammoKey });
    // a scav's gun is a scav's gun: the ceiling itself is worn (the server
    // rolls 85-100 for the max and 30-45 under it, never below 15%)
    const max = rng.int(85, 100);
    weapon.maxDura = max;
    weapon.dura = Math.max(Math.round(max * 0.15), max - rng.int(30, 45));
    weapon.raidLoot = true;
    for (const d of weapon.descendants()) d.raidLoot = true;
    const spares = [];
    const magTpl = weapon.magazine?.tplId;
    if (magTpl && weapon.tpl.wpn?.reload !== 'InternalMagazine') {
      for (let i = 0; i < rng.int(t.mags[0], t.mags[1]); i++) {
        const m = spawnMag(magTpl, ammoKey, rng.int(Math.ceil((TPL[magTpl].magSize || 1) * 0.4), TPL[magTpl].magSize || 1));
        m.raidLoot = true;
        spares.push(m);
      }
    }
    // a tube gun's scav has a pocket of shells instead
    let loose = null;
    if (weapon.tpl.wpn?.reload === 'InternalMagazine') {
      loose = new Item(ammoKey, { stack: rng.int(6, 14) });
      loose.raidLoot = true;
    }
    let armor = null, helmet = null;
    if (t.armor && rng.chance(t.armor[0])) {
      armor = new Item(rng.pick(t.armor[1]));
      armor.dura = Math.round(armor.tpl.dura * rng.float(0.35, 0.95));
      armor.raidLoot = true;
    }
    if (t.helmet && rng.chance(t.helmet[0])) {
      helmet = new Item(rng.pick(t.helmet[1]));
      helmet.dura = Math.round(helmet.tpl.dura * rng.float(0.35, 0.95));
      helmet.raidLoot = true;
    }
    return { weapon, ammoKey, spares, loose, armor, helmet, skill: t.skill };
  }

  randomWalkable(nearX, nearY, radius) {
    for (let i = 0; i < 40; i++) {
      const a = this.rng.float(0, Math.PI * 2);
      const r = this.rng.float(radius * 0.35, radius);
      const x = nearX + Math.cos(a) * r;
      const y = nearY + Math.sin(a) * r;
      if (this.nav.walkable(x, y)) return [x, y];
    }
    return null;
  }

  // ---------------------------------------------------------
  /**
   * Loot goes where the game puts it.
   *
   * Every static container Factory has — 167 of them across the four floors —
   * is listed in the dataset with its type and its exact spot, so there is no
   * scattering to do: place each one where it belongs and roll its contents.
   * Loose loot is the same list of 144 spots with the item that spawns there;
   * those are occupied only some of the time, the way they are in a raid.
   */
  placeLoot() {
    const mk = this.geo.markers;
    for (const c of mk.containers) {
      const def = CONTAINERS[c.t];
      if (!def || !this.geo.levels[c.level]) continue;
      this.containers.push(this.makeContainer(c.t, def, c.x, c.y, c.level));
    }
    const loose = CONTAINERS.looseloot;
    for (const l of mk.loose) {
      if (!loose || !this.geo.levels[l.level]) continue;
      if (!this.rng.chance(LOOSE_SPAWN_CHANCE)) continue;
      this.containers.push(this.makeContainer('looseloot', loose, l.x, l.y, l.level, l.items));
    }
    this.settleLoot(this.level, this.nav);
  }

  /**
   * Nudge this floor's recorded spots onto ground the player can actually
   * reach. The vector map does not draw every catwalk and shelf the real one
   * has, so a handful of spots land just off it; a short snap keeps them in
   * the room they belong to instead of dropping them, and anything that is
   * still nowhere near floor is dropped.
   *
   * This runs the first time a floor's nav grid is built, which is the first
   * time the player sets foot on it — so a raid only ever pays for the storey
   * it starts on.
   */
  settleLoot(level, nav) {
    const keep = [];
    for (const c of this.containers) {
      if (c.level !== level || c.settled) { keep.push(c); continue; }
      c.settled = true;
      if (nav.walkable(c.x, c.y)) { keep.push(c); continue; }
      const p = nav.snapPathable(c.x, c.y, 8);
      if (p && dist(p[0], p[1], c.x, c.y) <= 2.8) {
        c.x = p[0];
        c.y = p[1];
        keep.push(c);
      }
    }
    this.containers = keep;
  }

  makeContainer(type, def, x, y, level, items = null) {
    const grid = new Grid(def.w, def.h, { tag: 'loot', label: def.name });
    const c = {
      id: uid('c'), type, def, x, y, level,
      rot: this.rng.float(-0.35, 0.35),
      region: this.placeName(level, x, y),
      searched: false,
      /** uids uncovered so far; contents stay hidden until found */
      found: new Set(),
      /** the order the search will uncover things in */
      order: [],
      grid,
    };
    if (items && items.length) this.placeKnownItems(c, items);
    else this.rollLoot(c);
    this.finalizeContainer(c);
    return c;
  }

  /** a loose-loot spot spawns the item the game says spawns there */
  placeKnownItems(c, ids) {
    let placed = 0;
    for (const id of ids) {
      const tpl = BY_ID[id];
      if (!tpl) continue;
      const item = new Item(tpl.key, { stack: tpl.stack > 1 ? this.rng.int(1, Math.min(tpl.stack, 3)) : 1 });
      item.raidLoot = true;
      for (const d of item.descendants()) d.raidLoot = true;
      if (tpl.dura != null) item.dura = Math.round(tpl.dura * this.rng.float(0.3, 1));
      if (tpl.wpn?.maxDura) { const r = tpl.wpn.spawnDura || [30, 90]; item.dura = Math.round(this.rng.float(r[0], r[1])); }
      if (tpl.res) item.res = Math.round(tpl.res.max * this.rng.float(0.35, 1));
      const spot = c.grid.findSpot(item);
      if (spot) { c.grid.place(item, spot.x, spot.y, spot.rot); placed++; }
    }
    // the recorded item is not in this build's 195 templates: fall back to a
    // roll so the spot is not simply empty
    if (!placed) this.rollLoot(c);
  }

  /**
   * Freeze the search bookkeeping once a container's spawned loot is final.
   * Every container MUST pass through here — a container without found/order
   * crashes the search loop, and orderSet is what tells spawned loot apart
   * from items the player stows in later (those are always visible).
   */
  finalizeContainer(c) {
    if (!c.found) c.found = new Set();
    c.order = this.rng.shuffle(c.grid.items().map((it) => it.uid));
    c.orderSet = new Set(c.order);
  }

  /** seconds to uncover one item from this container */
  searchStep(container) {
    // a broken arm rummages slower
    return clamp(container.def.search / 3, 0.35, 1.1) * this.health.useMult();
  }

  /** how far through the search we are, 0..1 */
  searchFraction(container) {
    const total = container.order.length;
    if (!total) return container.searched ? 1 : 0;
    return container.found.size / total;
  }

  rollLoot(c) {
    const rng = this.rng;
    const pools = poolsFor(c.type);
    const [lo, hi] = c.def.rolls;
    const rolls = rng.int(lo, hi);
    const emptyChance = EMPTY_CHANCE[c.type] ?? 0.08;

    for (let i = 0; i < rolls; i++) {
      if (rng.chance(emptyChance)) continue;
      const pool = rng.weighted(pools, (e) => e[1])?.[0];
      if (!pool) continue;
      // re-roll picks that physically cannot fit this container (a figurine
      // pool in a jacket, say) instead of silently wasting the roll
      let entry = null;
      for (let tries = 0; tries < 6; tries++) {
        const pick = rng.weighted(pool, (e) => e[1]);
        if (!pick) break;
        const t = TPL[pick[0]];
        // a gun arrives assembled, so it is its assembled size that has to fit
        const tw = t?.presetSize?.[0] || t?.w, th = t?.presetSize?.[1] || t?.h;
        if (t && (tw <= c.grid.w && th <= c.grid.h || th <= c.grid.w && tw <= c.grid.h)) {
          entry = pick;
          break;
        }
      }
      if (!entry) continue;
      const [key, , range] = entry;
      const tpl = TPL[key];
      if (!tpl) continue;
      let stack = 1;
      if (range) stack = rng.int(range[0], range[1]);
      else if (tpl.stack > 1) stack = rng.int(1, Math.min(tpl.stack, 3));
      const item = new Item(key, { stack: clamp(stack, 1, tpl.stack) });
      item.raidLoot = true;
      // the parts on a found gun are found in raid too
      for (const d of item.descendants()) d.raidLoot = true;
      if (tpl.dura != null) item.dura = Math.round(tpl.dura * rng.float(0.3, 1));
      // a found gun is worn inside its template's spawn range, and more often
      // than not has something in the magazine; a loose magazine sometimes does
      if (tpl.wpn?.maxDura) {
        const r = tpl.wpn.spawnDura || [30, 90];
        item.dura = Math.round(rng.float(r[0], r[1]));
        const mag = item.magazine;
        if (mag && rng.chance(0.6)) {
          const a = tpl.wpn.defAmmo || mag.tpl.ammoFilter?.[0];
          if (a) mag.rounds.push({ t: a, n: rng.int(1, mag.tpl.magSize) });
        }
      } else if (tpl.magSize && rng.chance(0.4)) {
        const a = tpl.ammoFilter?.[0];
        if (a) item.rounds.push({ t: a, n: rng.int(1, tpl.magSize) });
      }
      if (tpl.res) item.res = Math.round(tpl.res.max * rng.float(0.35, 1));
      const spot = c.grid.findSpot(item);
      if (spot) c.grid.place(item, spot.x, spot.y, spot.rot);
    }
  }

  /** items carried in lose their found-in-raid mark, exactly like the real game */
  markRaidStart() {
    for (const it of game.equipment.everything()) {
      it.fir = false;
      it.raidLoot = false;
    }
  }

  // ---------------------------------------------------------
  /** everything on this floor the player may leave through */
  get extracts() {
    return this.allExtracts.filter((e) => e.level === this.level && e.faction !== 'scav');
  }

  /** every marker on this floor, scav lanes included, for drawing */
  get extractsHere() {
    return this.allExtracts.filter((e) => e.level === this.level);
  }

  get transitsHere() {
    return this.transits.filter((t) => t.level === this.level);
  }

  hasKey(reqId) {
    if (!reqId) return true;
    for (const it of game.equipment.everything()) {
      if (it.tpl.id === reqId || it.tpl.key === reqId) return true;
    }
    return false;
  }

  containersHere() {
    return this.containers.filter((c) => c.level === this.level);
  }

  // ---------------------------------------------------------
  moveTo(x, y) {
    this.cancelBreach();
    this.refreshDoorAccess();
    const path = this.nav.findPath(this.player.x, this.player.y, x, y);
    if (!path || !path.length) {
      emit(EV.RAID_TOAST, { kind: 'warn', text: 'No route there' });
      return false;
    }
    this.path = path;
    this.pendingInteract = null;
    return true;
  }

  interactWith(target) {
    if (dist(this.player.x, this.player.y, target.x, target.y) <= INTERACT_RANGE) {
      this.reach(target);
      return true;
    }
    this.refreshDoorAccess();
    const path = this.nav.findPath(this.player.x, this.player.y, target.x, target.y);
    if (!path || !path.length) {
      emit(EV.RAID_TOAST, { kind: 'warn', text: 'Cannot reach that' });
      return false;
    }
    this.path = path;
    this.pendingInteract = target;
    return true;
  }

  /** what arriving at a clicked thing means */
  reach(target) {
    if (target.grid) this.beginSearch(target);
    else if (target.levels) this.nearStairs = target;
    else if (target.state) this.openDoor(target);
  }

  beginSearch(container) {
    this.path = [];
    this.pendingInteract = null;
    // the panel opens straight away; the contents appear as they are uncovered
    this.openLoot(container);
    sfx.openContainer(container.type);
    if (container.searched) return;
    this.searching = container;
    this.searchProgress = 0;
    sfx.searchStart(container.type);
  }

  openLoot(container) {
    this.openContainerRef = container;
    emit(EV.LOOT_OPENED, container);
  }

  closeLoot() {
    this.openContainerRef = null;
    emit(EV.LOOT_CLOSED, null);
  }

  cancelSearch() {
    if (this.searching) sfx.searchStop();
    this.searching = null;
    this.searchProgress = 0;
  }

  /** the visible hostile under a world point, if any */
  scavAt(x, y, radius = 1.8) {
    let best = null, bestD = radius;
    for (const s of this.scavs) {
      if (!s.alive || (s.level && s.level !== this.level)) continue;
      const d = dist(s.x, s.y, x, y);
      if (d >= bestD) continue;
      const seen = dist(s.x, s.y, this.player.x, this.player.y) <= this.player.viewRange
        && this.nav.lineClear(this.player.x, this.player.y, s.x, s.y);
      if (!seen) continue;
      bestD = d; best = s;
    }
    return best;
  }

  /** has this item been uncovered by a search yet? */
  isRevealed(item) {
    const h = item.holder;
    if (!h || h.kind !== 'grid' || h.grid.tag !== 'loot') return true;
    const c = this.containers.find((k) => k.grid === h.grid);
    if (!c) return true;
    // items the player stowed in here were never part of the spawned loot,
    // so they are always visible — only unsearched spawns stay hidden
    if (c.orderSet && !c.orderSet.has(item.uid)) return true;
    return c.searched || c.found.has(item.uid);
  }

  containerAt(x, y, radius = 1.6) {
    let best = null, bestD = radius;
    for (const c of this.containers) {
      if (c.level !== this.level) continue;
      const d = dist(c.x, c.y, x, y);
      if (d < bestD) { bestD = d; best = c; }
    }
    return best;
  }

  // ---------------------------------------------------------
  carriedWeight() { return game.equipment.weight(); }

  speed() {
    const w = this.carriedWeight();
    let mult = 1;
    if (w > OVERWEIGHT_AT) {
      mult = 1 - clamp((w - OVERWEIGHT_AT) / (CRITICAL_AT - OVERWEIGHT_AT), 0, 1) * 0.45;
    }
    if (w > CRITICAL_AT) mult = 0.42;
    // legs: a fracture or a destroyed leg is a limp unless the painkillers hide it
    mult *= this.health.speedMult();
    const sprint = this.player.sprint && this.player.stamina > 1 ? SPRINT_MULT : 1;
    return BASE_SPEED * mult * sprint;
  }

  update(dt) {
    if (this.status !== RAID_STATUS.RUNNING) return;
    this.time += dt;
    this.timeLeft -= dt;
    if (this.timeLeft <= 0) {
      this.finish(RAID_STATUS.MIA);
      return;
    }

    const p = this.player;

    // the body: bleeds tick, thirst and hunger build, stims run out. A leg
    // that will not carry a sprint ends the sprint here rather than in input.
    if (!this.health.canSprint()) p.sprint = false;
    this.health.tick(dt, { inRaid: true, sprinting: p.moving && p.sprint, rng: this.rng });
    this.updateUse(dt);
    this.drainHealthEvents();
    p.hp = this.health.total;
    p.maxHp = this.health.max;
    if (this.health.dead) { this.finish(RAID_STATUS.KIA); return; }

    this.updateBreach(dt);

    // uncover the container one item at a time
    if (this.searching) {
      const c = this.searching;
      if (dist(p.x, p.y, c.x, c.y) > INTERACT_RANGE + 0.6 || this.openContainerRef !== c) {
        this.cancelSearch();
      } else {
        const step = this.searchStep(c);
        this.searchProgress += dt;
        while (this.searchProgress >= step && c.found.size < c.order.length) {
          this.searchProgress -= step;
          const uid = c.order[c.found.size];
          c.found.add(uid);
          this.stats.found++;
          addExp(4);
          // no chime per item: the game has no search-success cue, the
          // rummage simply keeps going and the item appears in the panel
          emit(EV.LOOT_FOUND, c);
        }
        if (c.found.size >= c.order.length && this.searchProgress >= step * 0.5) {
          c.searched = true;
          this.stats.searched++;
          addExp(6);
          this.searching = null;
          this.searchProgress = 0;
          sfx.searchStop();
          emit(EV.LOOT_FOUND, c);
        }
      }
    }

    // movement. A shut door on the way is opened as the player reaches it
    // rather than stopping them: that is what walking through Factory feels
    // like, and it keeps a click on the far side of a door from dead-ending.
    if (this.path.length && !this.openContainerRef) {
      const blocking = this.doorAhead();
      if (blocking && !this.openDoor(blocking)) {
        this.path = [];
        this.pendingInteract = null;
        p.moving = false;
        return;
      }
      const target = this.path[0];
      const dx = target[0] - p.x;
      const dy = target[1] - p.y;
      const d = Math.hypot(dx, dy);
      const step = this.speed() * dt;
      p.facing = Math.atan2(dy, dx);
      if (d <= step) {
        this.stats.distance += d;
        p.x = target[0]; p.y = target[1];
        this.path.shift();
        if (!this.path.length && this.pendingInteract) {
          const c = this.pendingInteract;
          this.pendingInteract = null;
          if (dist(p.x, p.y, c.x, c.y) <= INTERACT_RANGE + 1.2) this.reach(c);
        }
      } else {
        this.stats.distance += step;
        p.x += (dx / d) * step;
        p.y += (dy / d) * step;
      }
      p.moving = true;
    } else {
      p.moving = false;
    }

    // stamina; adrenaline restores it faster, an empty stomach slower
    const stam = this.health.staminaMult() * (this.health.energy < 20 ? 0.6 : 1);
    if (p.moving && p.sprint) p.stamina = clamp(p.stamina - 22 * dt / stam, 0, 100);
    else p.stamina = clamp(p.stamina + 15 * dt * stam, 0, 100);
    if (p.stamina <= 0) p.sprint = false;

    // visibility bookkeeping. Doors and stairwells are remembered the same way
    // containers are: architecture you have not laid eyes on yet has no
    // business showing through the dark.
    for (const c of this.containers) {
      if (c.level !== this.level || this.seen.has(c.id)) continue;
      if (dist(p.x, p.y, c.x, c.y) <= p.viewRange && this.nav.lineClear(p.x, p.y, c.x, c.y)) {
        this.seen.add(c.id);
      }
    }
    for (const d of this.doorsOn(this.level)) {
      if (this.seen.has(d.id)) continue;
      // a shut door is its own sight blocker, so aim at its edge rather than
      // its middle or it can never be spotted
      if (dist(p.x, p.y, d.x, d.y) > p.viewRange) continue;
      const nx = Math.cos(d.a) * (d.w / 2 + 0.4);
      const ny = Math.sin(d.a) * (d.w / 2 + 0.4);
      if (this.nav.lineClear(p.x, p.y, d.x + nx, d.y + ny)
          || this.nav.lineClear(p.x, p.y, d.x - nx, d.y - ny)) {
        this.seen.add(d.id);
      }
    }
    for (const s of this.stairsOn(this.level)) {
      if (this.seen.has(s.id)) continue;
      if (dist(p.x, p.y, s.x, s.y) <= p.viewRange && this.nav.lineClear(p.x, p.y, s.x, s.y)) {
        this.seen.add(s.id);
      }
    }

    // the gun in hand: aim settles, heat bleeds off, a reload runs
    this.playerCooldown = Math.max(0, this.playerCooldown - dt);
    this.gun.tick(dt, this.activeWeapon());

    // hostiles on this floor; a scav that bled out on the floor is a body
    // like any other. Scavs on other floors wait where they are.
    for (const s of this.scavsHere()) s.update(dt, this);
    for (const s of [...this.scavs]) if (s.alive && s.health?.dead) this.killScav(s, { bled: true });
    for (let i = this.shots.length - 1; i >= 0; i--) {
      this.shots[i].t -= dt;
      if (this.shots[i].t <= 0) this.shots.splice(i, 1);
    }

    // extract proximity
    this.nearExtract = null;
    for (const ex of this.extracts) {
      if (dist(p.x, p.y, ex.x, ex.y) <= ex.r) { this.nearExtract = ex; break; }
    }
    if (!this.nearExtract) this.extractHold = 0;

    // stairs under the player, which is what offers the floor change
    this.nearStairs = this.stairAt(p.x, p.y, STAIR_RANGE);

    // a key picked up out of a crate has to start opening doors right away
    this.accessTick = (this.accessTick || 0) + dt;
    if (this.accessTick > 0.5) { this.accessTick = 0; this.refreshDoorAccess(); }
  }

  // ---------------------------------------------------------
  // combat
  // ---------------------------------------------------------
  registerShot(shot) {
    this.shots.push({ ...shot, t: 0.12 });
    if (this.shots.length > 40) this.shots.shift();
  }

  onScavAlert() {
    emit(EV.RAID_TOAST, { kind: 'warn', text: 'Contact' });
  }

  onNearMiss() {
    if (this.rng.chance(0.35)) emit(EV.RAID_TOAST, { kind: 'warn', text: 'Rounds nearby' });
  }

  /**
   * What the floor is made of at a point, which decides the footstep set.
   * Outside every named area (corridors, the gaps between blocks) the plant is
   * concrete, except up in the rafters where everything underfoot is grating.
   */
  surfaceAt(x, y) {
    const a = areaAt(this.map, this.level, x, y);
    if (a && a.surface) return a.surface;
    return this.level === 'third' ? 'metal' : 'concrete';
  }

  /**
   * The weapon the player will fire: the sling first, then the one on the
   * back, then the sidearm. The back slot used to be equippable but was never
   * read, so a rifle parked there was dead weight.
   */
  activeWeapon() {
    // a gun missing a vital part is not a gun: skip it for the next one
    const cands = [game.equipment.item('primary'), game.equipment.item('secondary'), game.equipment.item('holster')];
    return cands.find((w) => w && isFunctional(w)) || null;
  }

  /** a carried ammo stack matching the weapon's caliber */
  findAmmo(cal) {
    for (const g of game.equipment.allGrids()) {
      for (const it of g.items()) {
        if (it.cat === 'ammo' && it.tpl.cal === cal && it.stack > 0) return it;
      }
    }
    return null;
  }

  ammoCount(cal) {
    let n = 0;
    for (const g of game.equipment.allGrids()) {
      for (const it of g.items()) if (it.cat === 'ammo' && it.tpl.cal === cal) n += it.stack;
    }
    return n;
  }

  /** the grids a reload / a stow may use */
  carryGridsFor() { return game.equipment.carryGrids(); }
  nestedGridsFor() { return game.equipment.nestedGrids(); }
  toast(text, kind = 'warn') { emit(EV.RAID_TOAST, { kind, text }); }
  onInventoryChanged() { emit(EV.INVENTORY_CHANGED); }

  /**
   * Fire toward a world point; returns a short status for the HUD. `held`
   * marks a frame of a held trigger, which only an automatic (or a burst in
   * progress) keeps firing on - semi fires once per pull.
   *
   * The shot is the whole gunplay model in one place: the selector, the
   * chamber, a stoppage, then a spread from the weapon's stats and the
   * shooter's state, a hit roll against the closest hostile in the cone, and
   * the round landing on that body through whatever it is wearing.
   */
  playerFire(tx, ty, { held = false } = {}) {
    if (this.status !== RAID_STATUS.RUNNING) return 'over';
    const weapon = this.activeWeapon();
    if (!weapon) { if (!held) emit(EV.RAID_TOAST, { kind: 'warn', text: 'No weapon equipped' }); return 'noweapon'; }
    const p = this.player;
    p.facing = Math.atan2(ty - p.y, tx - p.x);

    const pull = this.gun.pull(weapon, { held });
    if (pull.status === 'dry') {
      if (!held) {
        const cal = weapon.tpl.cal;
        const s = this.gun.state(weapon);
        s.knowMag(true);   // an empty click tells you exactly what is in it
        emit(EV.RAID_TOAST, { kind: 'bad', text: weapon.magazine ? `${weapon.tpl.short || 'Weapon'} is empty — R to reload` : `No magazine${cal ? ` (${cal})` : ''}` });
      }
      return 'noammo';
    }
    if (pull.status === 'malf') {
      if (!held || this.time - (this.malfToastAt || -9) > 2.5) {
        this.malfToastAt = this.time;
        emit(EV.RAID_TOAST, { kind: 'bad', text: `${pull.malf.label} — R to clear` });
      }
      return 'malf';
    }
    if (pull.status !== 'fired') return pull.status;

    const ammoTpl = pull.ammo;
    this.stats.shots++;
    // you cannot dress a wound and shoot at the same time
    if (this.using) this.cancelUse('Interrupted');
    // every scav in earshot turns toward the shot
    this.noise(p.x, p.y, pull.hearRange);

    // the closest hostile inside the cone toward the cursor wins the shot;
    // the cone is the spread itself, no narrower
    const cone = Math.max(0.22, pull.spread * 1.5);
    let target = null, bestScore = Infinity;
    for (const s of this.scavsHere()) {
      if (!s.alive) continue;
      const d = dist(p.x, p.y, s.x, s.y);
      if (d > 40) continue;
      const ang = Math.atan2(s.y - p.y, s.x - p.x);
      const off = Math.abs(((ang - p.facing + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
      if (off > cone) continue;
      if (!this.nav.lineClear(p.x, p.y, s.x, s.y)) continue;
      const score = d + off * 20;
      if (score < bestScore) { bestScore = score; target = s; }
    }

    if (!target) {
      this.registerShot({ from: [p.x, p.y], to: [tx, ty], hostile: false, hit: false });
      // a round that hits nobody still lands on the plant somewhere
      sfx.impact(this.rng.pick(['concrete', 'metal', 'wood', 'ricochet']));
      return 'miss';
    }

    const d = dist(p.x, p.y, target.x, target.y);
    const a = ammoTpl.ammo || {};
    const proj = a.proj || 1;
    // one roll per projectile: a shell's pellets each find their own way,
    // with the gun's shotgun dispersion on top of the spread
    let hits = 0, kills = 0, lastLand = null;
    const chance = hitChance(pull.spread + pelletSpread(weapon, proj) + (target.moving ? MOVING_TARGET_SWAY : 0), d);
    for (let i = 0; i < proj; i++) {
      if (!this.rng.chance(chance)) continue;
      hits++;
      const land = this.hitScav(target, ammoTpl);
      lastLand = land;
      if (land.killed) { kills++; break; }
    }
    this.registerShot({ from: [p.x, p.y], to: [target.x, target.y], hostile: false, hit: hits > 0 });
    if (!hits) {
      sfx.impact(this.rng.pick(['concrete', 'metal', 'ricochet']));
      return 'miss';
    }
    sfx.hit(lastLand.struck);
    if (kills) { this.killScav(target); return 'kill'; }
    return 'hit';
  }

  /**
   * A round landing on a scav: through its vest or helmet, into its body.
   * The scav wakes up to being shot even when it never saw the shooter.
   */
  hitScav(scav, ammoTpl, dmgMul = 1) {
    const land = landRound({
      ammo: ammoTpl, health: scav.health, armor: scav.armor, helmet: scav.helmet, rng: this.rng, dmgMul,
    });
    scav.onHit(this, land);
    return { ...land, killed: scav.health.dead };
  }

  /**
   * A shot heard: every scav on this floor within `range` turns toward it.
   * A suppressor is what keeps this short.
   */
  noise(x, y, range) {
    for (const s of this.scavsHere()) {
      if (!s.alive) continue;
      if (dist(x, y, s.x, s.y) > range) continue;
      s.hear(this, x, y);
    }
  }

  /**
   * A scav's shot at the player: from its own gun, its own round, through
   * the same spread model with its tier's skill on it. Returns what the HUD
   * needs to know (hit / miss / dry).
   */
  scavFire(scav) {
    const weapon = scav.weapon;
    if (!weapon) return 'noweapon';
    const p = this.player;
    const st = scav.gunState;
    const w = weapon.tpl.wpn || {};
    const ammoTpl = scav.takeRound();
    if (!ammoTpl) return 'dry';
    const stats = weaponStats(weapon);
    scav.muzzle = 1;
    weapon.dura = Math.max(0, (weapon.dura ?? 100) - 0.02);
    const suppressed = isSuppressed(weapon);
    sfx.hostileFire(weapon.tpl, { suppressed });
    this.noise(scav.x, scav.y, shotHearRange(stats, suppressed) * 0.6);
    const d = dist(scav.x, scav.y, p.x, p.y);
    const spread = spreadFor(stats, scav.aim, {
      moving: scav.moving, targetMoving: p.moving, skill: scav.skill, string: st.string,
    });
    scav.aim.recoil += (stats.vRecoil || 0) * 0.000085;
    st.string += 1;
    st.lastShot = this.time;
    const a = ammoTpl.ammo || {};
    const proj = a.proj || 1;
    const chance = hitChance(spread + pelletSpread(weapon, proj), d);
    let hits = 0;
    for (let i = 0; i < proj; i++) {
      if (!this.rng.chance(chance)) continue;
      hits++;
      this.damagePlayer(0, scav, { ammo: ammoTpl });
      if (this.status !== RAID_STATUS.RUNNING) break;
    }
    this.registerShot({ from: [scav.x, scav.y], to: [p.x, p.y], hostile: true, hit: hits > 0 });
    if (!hits) this.onNearMiss();
    return hits ? 'hit' : 'miss';
  }

  killScav(scav, { bled = false } = {}) {
    if (scav.state === 'dead') return;
    scav.state = 'dead';
    scav.hp = 0;
    this.stats.kills++;
    addExp(120);
    emit(EV.RAID_TOAST, { kind: 'ok', text: bled ? 'Scav bled out' : 'Scav down' });
    const def = CONTAINERS.deadscav;
    const body = {
      id: uid('c'), type: 'deadscav', def,
      x: scav.x, y: scav.y, level: scav.level || this.level, rot: this.rng.float(-0.4, 0.4),
      region: 'Body', searched: false,
      found: new Set(), order: [],
      grid: new Grid(def.w, def.h, { tag: 'loot', label: def.name }),
    };
    // what it carried goes in first: the gun with what it did not fire, the
    // magazines, the vest and helmet with the holes in them, then the odds
    // and ends every body has
    const kit = [scav.weapon, ...(scav.spares || []), scav.loose, scav.armor, scav.helmet].filter(Boolean);
    for (const it of kit) {
      if (it.holder) detach(it);
      const spot = body.grid.findSpot(it);
      if (spot) body.grid.place(it, spot.x, spot.y, spot.rot);
    }
    scav.weapon = null; scav.spares = []; scav.loose = null; scav.armor = null; scav.helmet = null;
    this.rollLoot(body);
    if (this.rng.chance(0.5)) {
      const entry = this.rng.weighted(POOLS.gear_misc, (e) => e[1]);
      const tpl = entry && TPL[entry[0]];
      if (tpl) {
        const it = new Item(entry[0]);
        it.raidLoot = true;
        if (tpl.dura != null) it.dura = Math.round(tpl.dura * this.rng.float(0.2, 0.8));
        const spot = body.grid.findSpot(it);
        if (spot) body.grid.place(it, spot.x, spot.y, spot.rot);
      }
    }
    // like every other container, a body has to be searched item by item
    this.finalizeContainer(body);
    this.containers.push(body);
    this.seen.add(body.id);
    this.scavs = this.scavs.filter((s) => s !== scav);
  }

  /**
   * A round landing on the player. `opts.ammo` is the round (a scav's shot);
   * without one `amount` stands in as a plain hit of that much (the tests,
   * and anything that is not a bullet). Where it lands is rolled the way
   * hits spread on a standing target unless `opts.part` says; the vest
   * covers the thorax and stomach, the helmet the head, and the round has
   * to beat the armour's class - what is stopped bruises, what gets through
   * hurts, and either way the plate wears (gunplay.js). What lands goes to
   * that body part, which decides bleeding, fractures, and whether this was
   * the one.
   */
  damagePlayer(amount, source, opts = {}) {
    const p = this.player;
    const h = this.health;
    const ammo = opts.ammo || { ammo: { dmg: amount, pen: opts.pen ?? 30, armorDmg: 40, frag: 0 } };
    const armor = game.equipment.item('armor') || game.equipment.item('rig');
    const helmet = game.equipment.item('head');
    const land = landRound({
      ammo, health: h, rng: this.rng, part: opts.part || null,
      armor: armor?.tpl.armorClass ? armor : null, helmet: helmet?.tpl.armorClass ? helmet : null,
    });
    // a round ringing off the helmet rattles the head inside it
    if (land.struck === 'helmet' && !h.has(FX.CTIMM) && this.rng.chance(0.4)) h.addEffect(FX.CT, null, this.rng.float(6, 14));
    sfx.hit(land.struck);
    const res = land.res;
    p.lastHitAt = this.time;
    p.lastHitFrom = source ? Math.atan2(source.y - p.y, source.x - p.x) : 0;
    p.lastHitPart = land.part;
    p.hp = h.total;
    p.maxHp = h.max;
    this.drainHealthEvents();
    if (res.killed || h.dead) this.finish(RAID_STATUS.KIA);
    return res;
  }

  /** narrate what the body just did: a new bleed, a limb gone, a stim wearing off */
  drainHealthEvents() {
    const h = this.health;
    if (!h.events.length) return;
    for (const ev of h.events) {
      if (ev.kind === 'fx') {
        const info = FX_INFO[ev.type];
        if (!info || !info.bad) continue;
        const where = ev.part ? ` — ${PART[ev.part].name.toLowerCase()}` : '';
        emit(EV.RAID_TOAST, { kind: 'bad', text: `${info.name}${where}` });
      } else if (ev.kind === 'destroyed') {
        emit(EV.RAID_TOAST, { kind: 'bad', text: `${PART[ev.part].name} destroyed` });
      } else if (ev.kind === 'fxEnd') {
        const info = FX_INFO[ev.type];
        if (ev.type === FX.PK || ev.type === FX.HEMO || ev.type === FX.REGEN || ev.type === FX.ADR) {
          emit(EV.RAID_TOAST, { kind: 'warn', text: `${info.name} wore off` });
        }
      }
    }
    h.events = [];
  }

  // ---------------------------------------------------------
  // medicine
  // ---------------------------------------------------------
  /**
   * Start applying a med. The use runs on the raid clock; walking is fine,
   * a sprint or a shot interrupts it, and dropping the item cancels it. When
   * it completes the health model applies the plan and the item is spent.
   */
  beginUse(item, part = null) {
    if (this.status !== RAID_STATUS.RUNNING) return { ok: false, reason: 'Raid over' };
    if (this.using) return { ok: false, reason: 'Already treating' };
    const tpl = item.tpl;
    if (!tpl.med) return { ok: false, reason: 'Not usable' };
    if (Health.needsPart(tpl) && !part) part = this.health.bestPart(item);
    const plan = this.health.plan(item, part);
    if (!plan.ok) return plan;
    // it has to be on you: a med in a crate is not in your hands
    if (!this.carried(item)) return { ok: false, reason: 'Not in your gear' };
    const dur = plan.time * this.health.useMult();
    this.using = { item, part, t: 0, dur, plan };
    this.player.sprint = false;
    sfx.use(tpl);
    return { ok: true, plan, dur };
  }

  cancelUse(why = null) {
    if (!this.using) return;
    this.using = null;
    if (why) emit(EV.RAID_TOAST, { kind: 'warn', text: why });
  }

  updateUse(dt) {
    const u = this.using;
    if (!u) return;
    if (!this.carried(u.item)) { this.cancelUse('Item lost'); return; }
    if (this.player.sprint && this.player.moving) { this.cancelUse('Interrupted'); return; }
    u.t += dt;
    if (u.t < u.dur) return;
    this.using = null;
    const pl = this.health.apply(u.item, u.part, this.rng);
    if (!pl.ok) { emit(EV.RAID_TOAST, { kind: 'warn', text: pl.reason }); return; }
    const where = u.part ? ` — ${PART[u.part].name.toLowerCase()}` : '';
    emit(EV.RAID_TOAST, { kind: 'ok', text: `${u.item.tpl.short || u.item.tpl.name}${where}: ${pl.note}` });
    if ((u.item.res ?? 0) <= 0) detach(u.item);
    if (pl.removes.includes(FX.HB) || pl.removes.includes(FX.LB)) addExp(pl.removes.includes(FX.HB) ? 40 : 25);
    if (pl.removes.includes(FX.FR)) addExp(30);
    emit(EV.INVENTORY_CHANGED);
  }

  /** is the item somewhere on the player, at any depth? */
  carried(item) {
    let cur = item, guard = 0;
    while (cur && guard++ < 16) {
      const hd = cur.holder;
      if (!hd) return false;
      if (hd.kind === 'slot') return true;
      if (hd.grid.tag === 'pocket') return true;
      if (hd.grid.tag === 'loot' || hd.grid.tag === 'stash') return false;
      cur = hd.grid.owner;
    }
    return false;
  }

  holdExtract(dt) {
    const ex = this.nearExtract;
    if (!ex) return;
    if (ex.req && !this.hasKey(ex.req)) {
      emit(EV.RAID_TOAST, { kind: 'warn', text: `${ex.name} — needs ${ex.reqName}` });
      this.extractHold = 0;
      return;
    }
    this.extractHold += dt;
    if (this.extractHold >= EXTRACT_HOLD) this.finish(RAID_STATUS.SURVIVED, ex);
  }

  releaseExtract() { this.extractHold = 0; }

  // ---------------------------------------------------------
  finish(status, viaExtract = null) {
    if (this.status !== RAID_STATUS.RUNNING) return;
    this.status = status;
    this.cancelSearch();
    this.closeLoot();

    const survived = status === RAID_STATUS.SURVIVED;
    if (survived) sfx.extract();
    else if (status === RAID_STATUS.KIA) sfx.death();
    this.using = null;
    // the body you bring home: bleeds and fractures come with you out of a
    // successful raid; a death or a walk-out puts you back at 30% everywhere
    if (survived) this.health.afterRaid();
    else this.health.afterDeath();
    const result = {
      status,
      extract: viaExtract,
      map: this.map.name,
      duration: this.map.duration - this.timeLeft,
      searched: this.stats.searched,
      kills: this.stats.kills,
      shots: this.stats.shots,
      floors: this.visited.size,
      kept: [],
      lost: [],
      value: 0,
      spawn: this.player.spawnName,
    };

    const eq = game.equipment;
    if (survived) {
      for (const it of eq.everything()) {
        if (it.raidLoot) { it.fir = true; delete it.raidLoot; }
      }
      // an exit that wants an item handed over takes it on the way through
      if (viaExtract?.req) {
        for (const it of eq.everything()) {
          if (it.tpl.id !== viaExtract.req && it.tpl.key !== viaExtract.req) continue;
          detach(it);
          break;
        }
      }
      for (const d of eq.slotList()) if (d.item) result.kept.push(d.item);
      for (const g of eq.pockets) result.kept.push(...g.items());
      result.value = result.kept.reduce((n, it) => n + it.value, 0);
      addExp(180 + this.stats.searched * 12);
      game.profile.survived++;
      game.profile.extracted++;
      if (result.value > game.profile.bestHaul) game.profile.bestHaul = result.value;
    } else {
      for (const it of eq.insecureItems()) result.lost.push(it);
      const sec = eq.item('secure');
      if (sec) {
        result.kept.push(sec);
        // recurse: raid loot tucked into a case inside the pouch counts too
        for (const it of sec.descendants()) {
          if (it.raidLoot) { it.fir = true; delete it.raidLoot; }
        }
      }
      eq.clearInsecure();
      addExp(35);
      if (status === RAID_STATUS.KIA) game.profile.died++;
    }
    game.profile.raids++;

    emit(EV.RAID_END, result);
    return result;
  }

  /**
   * Empty the loose contents of the rig, pockets, backpack and pouch into the
   * stash. Nothing calls this on extraction any more — what you carried out
   * stays packed where you put it — but the stash keeps it as an explicit
   * "unload everything" action.
   */
  static depositToStash() {
    const eq = game.equipment;
    const moved = [];
    const overflow = [];
    for (const g of eq.allGrids()) {
      for (const it of g.items()) {
        g.remove(it);
        if (autoPlace(it, [game.stash])) moved.push(it);
        else {
          // no room in the stash: put it back where it was
          const spot = g.findSpot(it);
          if (spot) g.place(it, spot.x, spot.y, spot.rot);
          overflow.push(it);
        }
      }
    }
    return { moved, overflow };
  }
}
