// =========================================================
// raid session: loot placement, movement, searching, extraction
// =========================================================

import { Grid, Item, autoPlace, detach } from '../inventory/model.js';
import { CONTAINERS, poolsFor, EMPTY_CHANCE, POOLS } from '../data/loot.js';
import { TPL } from '../data/items.js';
import { Scav } from './ai.js';
import { makeRng } from '../core/rng.js';
import { clamp, dist, uid } from '../core/util.js';
import { game, addExp } from '../core/state.js';
import { sfx } from '../core/audio.js';
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
    this.scavs = [];
    this.shots = [];
    this.playerCooldown = 0;
    this.stats = { searched: 0, found: 0, distance: 0, kills: 0, shots: 0 };

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
    this.placeBodies();
    this.spawnScavs();
    this.markRaidStart();
  }

  /** a raid or two went badly before you arrived: dead PMCs with real gear */
  placeBodies() {
    const def = CONTAINERS.pmcbody;
    if (!def) return;
    const n = this.rng.int(1, 2);
    for (let i = 0; i < n; i++) {
      const region = this.rng.pick(this.map.regions);
      const [x0, y0, x1, y1] = region.rect;
      const pos = this.findSpot(x0, y0, x1, y1);
      if (!pos) continue;
      this.containers.push(this.makeContainer('pmcbody', def, pos[0], pos[1], { name: 'Fallen PMC' }));
    }
  }

  // ---------------------------------------------------------
  /**
   * Hostiles are switched off while the farming loop is being built out - a
   * raid is currently a looting exercise and being shot mid-search only gets
   * in the way of tuning it. Everything downstream (the AI, the combat, the
   * bodies they leave) is intact and comes back by raising this to 7.
   */
  spawnScavs(count = 0) {
    const rng = this.rng;
    for (let i = 0; i < count; i++) {
      let pos = null;
      for (let tries = 0; tries < 80 && !pos; tries++) {
        const region = rng.pick(this.map.regions);
        const [x0, y0, x1, y1] = region.rect;
        const x = rng.float(x0, x1), y = rng.float(y0, y1);
        if (!this.nav.walkable(x, y)) continue;
        if (dist(x, y, this.player.x, this.player.y) < 34) continue;
        pos = [x, y];
      }
      if (!pos) continue;
      this.scavs.push(new Scav({ x: pos[0], y: pos[1], rng, tier: rng.int(0, 2) }));
    }
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
      /** uids uncovered so far; contents stay hidden until found */
      found: new Set(),
      /** the order the search will uncover things in */
      order: [],
      grid,
    };
    this.rollLoot(c);
    this.finalizeContainer(c);
    return c;
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
    return clamp(container.def.search / 3, 0.35, 1.1);
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
        if (t && (t.w <= c.grid.w && t.h <= c.grid.h || t.h <= c.grid.w && t.w <= c.grid.h)) {
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
      if (!s.alive) continue;
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

    // hostiles
    this.playerCooldown = Math.max(0, this.playerCooldown - dt);
    for (const s of this.scavs) s.update(dt, this);
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
   * The weapon the player will fire: the sling first, then the one on the
   * back, then the sidearm. The back slot used to be equippable but was never
   * read, so a rifle parked there was dead weight.
   */
  activeWeapon() {
    return game.equipment.item('primary')
      || game.equipment.item('secondary')
      || game.equipment.item('holster')
      || null;
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

  /** fire toward a world point; returns a short status for the HUD */
  playerFire(tx, ty) {
    if (this.status !== RAID_STATUS.RUNNING) return 'over';
    const weapon = this.activeWeapon();
    if (!weapon) { emit(EV.RAID_TOAST, { kind: 'warn', text: 'No weapon equipped' }); return 'noweapon'; }
    if (this.playerCooldown > 0) return 'cooldown';

    const cal = weapon.tpl.cal;
    const ammo = cal ? this.findAmmo(cal) : null;
    if (cal && !ammo) { emit(EV.RAID_TOAST, { kind: 'bad', text: `Out of ${cal}` }); return 'noammo'; }
    if (ammo) {
      ammo.stack -= 1;
      if (ammo.stack <= 0) detach(ammo);
    }

    const rpm = weapon.tpl.rpm || 400;
    this.playerCooldown = Math.max(0.09, 60 / rpm);
    this.stats.shots++;
    sfx.fire(weapon.tpl);

    const p = this.player;
    p.facing = Math.atan2(ty - p.y, tx - p.x);

    // the closest hostile inside a narrow cone toward the cursor wins the shot
    let target = null, bestScore = Infinity;
    for (const s of this.scavs) {
      if (!s.alive) continue;
      const d = dist(p.x, p.y, s.x, s.y);
      if (d > 34) continue;
      const ang = Math.atan2(s.y - p.y, s.x - p.x);
      const off = Math.abs(((ang - p.facing + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
      if (off > 0.22) continue;
      if (!this.nav.lineClear(p.x, p.y, s.x, s.y)) continue;
      const score = d + off * 20;
      if (score < bestScore) { bestScore = score; target = s; }
    }

    if (!target) {
      this.registerShot({ from: [p.x, p.y], to: [tx, ty], hostile: false, hit: false });
      return 'miss';
    }

    const d = dist(p.x, p.y, target.x, target.y);
    const ergo = weapon.tpl.ergo || 40;
    const chance = clamp(0.94 - d * 0.018 + (ergo - 40) * 0.004, 0.22, 0.96);
    const hit = this.rng.chance(chance);
    this.registerShot({ from: [p.x, p.y], to: [target.x, target.y], hostile: false, hit });
    if (!hit) return 'miss';

    const base = (weapon.tpl.dmg || 40) * (ammo ? (0.7 + (ammo.tpl.dmg || 40) / 120) : 1);
    const died = target.takeHit(base * this.rng.float(0.85, 1.15), this);
    if (died) { this.killScav(target); return 'kill'; }
    return 'hit';
  }

  killScav(scav) {
    this.stats.kills++;
    addExp(120);
    emit(EV.RAID_TOAST, { kind: 'ok', text: 'Scav down' });
    const def = CONTAINERS.deadscav;
    const body = {
      id: uid('c'), type: 'deadscav', def,
      x: scav.x, y: scav.y, rot: this.rng.float(-0.4, 0.4),
      region: 'Body', searched: false,
      found: new Set(), order: [],
      grid: new Grid(def.w, def.h, { tag: 'loot', label: def.name }),
    };
    this.rollLoot(body);
    // scavs carry a little gear of their own
    for (const pool of [POOLS.gear_misc, POOLS.mags, POOLS.weapons_low]) {
      if (!this.rng.chance(0.5)) continue;
      const entry = this.rng.weighted(pool, (e) => e[1]);
      if (!entry) continue;
      const tpl = TPL[entry[0]];
      if (!tpl) continue;
      const it = new Item(entry[0]);
      it.raidLoot = true;
      if (tpl.dura != null) it.dura = Math.round(tpl.dura * this.rng.float(0.2, 0.8));
      const spot = body.grid.findSpot(it);
      if (spot) body.grid.place(it, spot.x, spot.y, spot.rot);
    }
    // like every other container, a body has to be searched item by item
    this.finalizeContainer(body);
    this.containers.push(body);
    this.seen.add(body.id);
    this.scavs = this.scavs.filter((s) => s !== scav);
  }

  damagePlayer(amount, source) {
    const p = this.player;
    let dmg = amount;

    // body armor soaks a share of it and wears down
    const armor = game.equipment.item('armor') || game.equipment.item('rig');
    if (armor && armor.tpl.armorClass && armor.dura > 0) {
      const soak = clamp(armor.tpl.armorClass * 0.11, 0, 0.62);
      dmg *= 1 - soak;
      armor.dura = Math.max(0, armor.dura - amount * 0.09);
    }
    const helmet = game.equipment.item('head');
    if (helmet && helmet.tpl.armorClass && helmet.dura > 0 && this.rng.chance(0.18)) {
      dmg *= 0.45;
      helmet.dura = Math.max(0, helmet.dura - amount * 0.12);
    }

    p.hp = Math.max(0, p.hp - dmg);
    p.lastHitAt = this.time;
    p.lastHitFrom = source ? Math.atan2(source.y - p.y, source.x - p.x) : 0;
    if (p.hp <= 0) this.finish(RAID_STATUS.KIA);
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
    this.cancelSearch();
    this.closeLoot();

    const survived = status === RAID_STATUS.SURVIVED;
    if (survived) sfx.extract();
    else if (status === RAID_STATUS.KIA) sfx.death();
    const result = {
      status,
      extract: viaExtract,
      map: this.map.name,
      duration: this.map.duration - this.timeLeft,
      searched: this.stats.searched,
      kills: this.stats.kills,
      shots: this.stats.shots,
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
      // a keyed exfil consumes one use of the key, and the key breaks dry
      if (viaExtract?.req) {
        for (const it of eq.everything()) {
          if (it.tpl.key !== viaExtract.req) continue;
          if (it.tpl.uses) {
            it.res = (it.res ?? it.tpl.uses) - 1;
            if (it.res <= 0) {
              detach(it);
              emit(EV.RAID_TOAST, { kind: 'warn', text: `${it.tpl.name} broke` });
            }
          }
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
