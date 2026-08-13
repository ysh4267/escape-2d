// =========================================================
// raid session: loot placement, movement, searching, extraction
// =========================================================

import { Grid, Item, autoPlace } from '../inventory/model.js';
import { CONTAINERS, poolsFor, EMPTY_CHANCE } from '../data/loot.js';
import { TPL } from '../data/items.js';
import { makeRng } from '../core/rng.js';
import { clamp, dist, uid } from '../core/util.js';
import { game, addExp } from '../core/state.js';
import { emit, EV } from '../core/events.js';

export const RAID_STATUS = {
  RUNNING: 'running',
  SURVIVED: 'survived',
  MIA: 'mia',
  KIA: 'kia',
  LEFT: 'left',
};

const EXTRACT_HOLD = 6.0;      // seconds to hold F
const INTERACT_RANGE = 2.2;    // svg units
const BASE_SPEED = 6.4;        // units/sec walking
const SPRINT_MULT = 1.72;
const OVERWEIGHT_AT = 35;      // kg, speed starts dropping
const CRITICAL_AT = 65;        // kg, heavily slowed

export class Raid {
  constructor({ mapDef, geo, nav, seed }) {
    this.map = mapDef;
    this.geo = geo;
    this.nav = nav;
    this.rng = makeRng(seed ?? (Math.random() * 0xffffffff) >>> 0);
    this.status = RAID_STATUS.RUNNING;
    this.time = 0;
    this.timeLeft = mapDef.duration;
    this.containers = [];
    this.seen = new Set();
    this.path = [];
    this.hover = null;
    this.nearExtract = null;
    this.extractHold = 0;
    this.searching = null;
    this.searchProgress = 0;
    this.pendingInteract = null;
    this.openContainerRef = null;
    this.stats = { searched: 0, picked: 0, distance: 0 };

    const spawn = this.rng.pick(mapDef.spawns);
    const p = nav.snap(spawn.x, spawn.y) || [spawn.x, spawn.y];
    this.player = {
      x: p[0], y: p[1],
      facing: -Math.PI / 2,
      hp: 100, maxHp: 100,
      stamina: 100,
      moving: false,
      sprint: false,
      viewRange: 32,
      spawnName: spawn.name,
    };

    this.placeLoot();
    this.markRaidStart();
  }

  // ---------------------------------------------------------
  placeLoot() {
    const rng = this.rng;
    for (const region of this.map.regions) {
      const [x0, y0, x1, y1] = region.rect;
      for (const [type, count] of region.spawn) {
        const def = CONTAINERS[type];
        if (!def) continue;
        const n = Math.max(0, Math.round(count * rng.float(0.65, 1.2)));
        for (let i = 0; i < n; i++) {
          const pos = this.findSpot(x0, y0, x1, y1);
          if (!pos) continue;
          this.containers.push(this.makeContainer(type, def, pos[0], pos[1], region));
        }
      }
    }
  }

  findSpot(x0, y0, x1, y1) {
    for (let tries = 0; tries < 60; tries++) {
      const x = this.rng.float(x0, x1);
      const y = this.rng.float(y0, y1);
      if (!this.nav.walkable(x, y)) continue;
      let tooClose = false;
      for (const c of this.containers) {
        if (dist(c.x, c.y, x, y) < 2.0) { tooClose = true; break; }
      }
      if (tooClose) continue;
      return [x, y];
    }
    return null;
  }

  makeContainer(type, def, x, y, region) {
    const grid = new Grid(def.w, def.h, { tag: 'loot', label: def.name });
    const c = {
      id: uid('c'), type, def, x, y,
      rot: this.rng.float(-0.35, 0.35),
      region: region.name,
      searched: false,
      grid,
    };
    this.rollLoot(c);
    return c;
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
      const entry = rng.weighted(pool, (e) => e[1]);
      if (!entry) continue;
      const [key, , range] = entry;
      const tpl = TPL[key];
      if (!tpl) continue;
      let stack = 1;
      if (range) stack = rng.int(range[0], range[1]);
      else if (tpl.stack > 1) stack = rng.int(1, Math.min(tpl.stack, 3));
      const item = new Item(key, { stack: clamp(stack, 1, tpl.stack) });
      item.raidLoot = true;
      item.examined = game.profile.examined.has(key) || !!tpl.alwaysExamined;
      if (tpl.dura != null) item.dura = Math.round(tpl.dura * rng.float(0.3, 1));
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
  get extracts() {
    return this.map.extracts.filter((e) => e.side !== 'scav');
  }

  hasKey(reqKey) {
    if (!reqKey) return true;
    for (const it of game.equipment.everything()) {
      if (it.tpl.key === reqKey) return true;
    }
    return false;
  }

  // ---------------------------------------------------------
  moveTo(x, y) {
    const path = this.nav.findPath(this.player.x, this.player.y, x, y);
    if (!path || !path.length) {
      emit(EV.RAID_TOAST, { kind: 'warn', text: 'No route there' });
      return false;
    }
    this.path = path;
    this.pendingInteract = null;
    return true;
  }

  interactWith(container) {
    if (dist(this.player.x, this.player.y, container.x, container.y) <= INTERACT_RANGE) {
      this.beginSearch(container);
      return true;
    }
    const path = this.nav.findPath(this.player.x, this.player.y, container.x, container.y);
    if (!path || !path.length) {
      emit(EV.RAID_TOAST, { kind: 'warn', text: 'Cannot reach that' });
      return false;
    }
    this.path = path;
    this.pendingInteract = container;
    return true;
  }

  beginSearch(container) {
    this.path = [];
    this.pendingInteract = null;
    if (container.searched) {
      this.openLoot(container);
      return;
    }
    this.searching = container;
    this.searchProgress = 0;
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
    this.searching = null;
    this.searchProgress = 0;
  }

  containerAt(x, y, radius = 1.6) {
    let best = null, bestD = radius;
    for (const c of this.containers) {
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

    // search progress
    if (this.searching) {
      const c = this.searching;
      if (dist(p.x, p.y, c.x, c.y) > INTERACT_RANGE + 0.6) {
        this.cancelSearch();
      } else {
        this.searchProgress += dt;
        if (this.searchProgress >= c.def.search) {
          c.searched = true;
          this.stats.searched++;
          addExp(6);
          this.searching = null;
          this.searchProgress = 0;
          this.openLoot(c);
        }
      }
    }

    // movement
    if (this.path.length && !this.openContainerRef) {
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
          if (dist(p.x, p.y, c.x, c.y) <= INTERACT_RANGE + 1.2) this.beginSearch(c);
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

    // stamina
    if (p.moving && p.sprint) p.stamina = clamp(p.stamina - 22 * dt, 0, 100);
    else p.stamina = clamp(p.stamina + 15 * dt, 0, 100);
    if (p.stamina <= 0) p.sprint = false;

    // visibility bookkeeping
    for (const c of this.containers) {
      if (this.seen.has(c.id)) continue;
      if (dist(p.x, p.y, c.x, c.y) <= p.viewRange && this.nav.lineClear(p.x, p.y, c.x, c.y)) {
        this.seen.add(c.id);
      }
    }

    // extract proximity
    this.nearExtract = null;
    for (const ex of this.extracts) {
      if (dist(p.x, p.y, ex.x, ex.y) <= ex.r) { this.nearExtract = ex; break; }
    }
    if (!this.nearExtract) this.extractHold = 0;
  }

  holdExtract(dt) {
    const ex = this.nearExtract;
    if (!ex) return;
    if (ex.req && !this.hasKey(ex.req)) {
      emit(EV.RAID_TOAST, { kind: 'warn', text: `${ex.name} is locked` });
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
    this.closeLoot();

    const survived = status === RAID_STATUS.SURVIVED;
    const result = {
      status,
      extract: viaExtract,
      map: this.map.name,
      duration: this.map.duration - this.timeLeft,
      searched: this.stats.searched,
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
        for (const g of sec.grids || []) {
          for (const it of g.items()) { if (it.raidLoot) { it.fir = true; delete it.raidLoot; } }
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

  /** move loot from the character into the stash after the raid */
  static depositToStash() {
    const eq = game.equipment;
    const moved = [];
    // pockets and worn container contents first, then the gear itself
    const grids = eq.allGrids();
    for (const g of grids) {
      for (const it of g.items()) {
        g.remove(it);
        if (autoPlace(it, [game.stash])) moved.push(it);
        else { const spot = g.findSpot(it); if (spot) g.place(it, spot.x, spot.y, spot.rot); }
      }
    }
    for (const slot of eq.slotList()) {
      const it = slot.item;
      if (!it) continue;
      if (slot.key === 'secure') continue;   // the pouch stays on the character
      slot.clear();
      if (autoPlace(it, [game.stash])) moved.push(it);
      else slot.set(it);
    }
    return moved;
  }
}
