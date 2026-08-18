// =========================================================
// scavs: patrol, notice, engage
//
// Deliberately simple: a scav wanders the navmesh, and if the player is
// inside its view cone with clear line of sight it closes to a firing
// distance and shoots on a cooldown. Killing one leaves a searchable body.
//
// Since the gunplay pass a scav is a body with a gun rather than a number:
// it has the same seven-part health the player has (a round to the head is
// a round to the head), the vest and helmet it wears are items that stop
// rounds and wear down, and it shoots the gun it carries - its rounds, its
// recoil, its magazine, which it empties and changes - so what you loot off
// it is what it was using on you. Tiers now decide the kit and the steadiness
// of the aim, not the hit points.
// =========================================================

import { dist, uid } from '../core/util.js';
import { Health, PART } from './health.js';
import { Aim, GunState, weaponModes, reloadTime } from './gunplay.js';
import { takeRound, roundsInWeapon } from '../inventory/weapon.js';

export const SCAV_STATE = { PATROL: 'patrol', ALERT: 'alert', ENGAGE: 'engage', DEAD: 'dead' };

const PATROL_SPEED = 3.1;
const CHASE_SPEED = 5.2;
const FIRE_RANGE = 22;
const KEEP_DISTANCE = 8;
/** how long a scav takes to change magazines / feed shells (it is not in a hurry) */
const SCAV_RELOAD_MULT = 1.3;
/** a scav on an automatic fires short strings, then pauses to look */
const BURST_MIN = 2, BURST_MAX = 5;

export class Scav {
  constructor({ x, y, rng, tier = 1, level = null, loadout = null }) {
    this.id = uid('s');
    this.x = x;
    this.y = y;
    this.level = level;
    this.rng = rng;
    this.facing = rng.float(-Math.PI, Math.PI);
    this.state = SCAV_STATE.PATROL;
    this.tier = tier;
    // the body: the same model as the player's, and hp mirrors it for the
    // renderer's bar
    this.health = new Health();
    this.hp = this.health.total;
    this.maxHp = this.health.max;
    this.viewRange = 24 + tier * 3;
    this.viewCone = 1.15;              // radians, half-angle
    this.cooldown = rng.float(0, 1.2);
    this.path = [];
    this.alertTimer = 0;
    this.lastSeen = null;
    this.muzzle = 0;
    this.hitFlash = 0;
    this.moving = false;
    // the kit
    this.weapon = loadout?.weapon || null;
    this.ammoKey = loadout?.ammoKey || null;
    this.spares = loadout?.spares || [];
    this.loose = loadout?.loose || null;
    this.armor = loadout?.armor || null;
    this.helmet = loadout?.helmet || null;
    this.skill = loadout?.skill ?? (2.4 - tier * 0.5);
    this.aim = new Aim();
    this.gunState = this.weapon ? new GunState(this.weapon) : null;
    if (this.gunState && weaponModes(this.weapon).includes('fullauto')) this.gunState.mode = 'fullauto';
    this.burstLeft = 0;
    this.reloading = 0;                // seconds left on a magazine change
    this.bank = this.weapon ? this.weapon.tpl.key.replace(/^w_/, '') : 'akm';
  }

  get alive() { return this.state !== SCAV_STATE.DEAD; }

  /** how fast this body still moves: a shot leg slows it, two are a hobble */
  speedMult() { return this.health.speedMult(); }

  canSee(nav, px, py) {
    const d = dist(this.x, this.y, px, py);
    if (d > this.viewRange) return false;
    const ang = Math.atan2(py - this.y, px - this.x);
    let diff = Math.abs(((ang - this.facing + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
    if (d > 4 && diff > this.viewCone) return false;   // close range is omnidirectional
    return nav.lineClear(this.x, this.y, px, py);
  }

  update(dt, raid) {
    if (!this.alive) return;
    const nav = raid.nav;
    const p = raid.player;
    this.muzzle = Math.max(0, this.muzzle - dt * 6);
    this.hitFlash = Math.max(0, this.hitFlash - dt * 4);
    // the body: bleeds run, a stopped heart is a body
    this.health.tick(dt, { inRaid: true, rng: raid.rng });
    this.hp = this.health.total;
    if (this.health.dead) return;
    this.aim.tick(dt, { moving: this.moving, facing: this.facing });
    if (this.gunState && raid.time - this.gunState.lastShot > 0.5) this.gunState.string = 0;
    if (this.reloading > 0) {
      this.reloading -= dt;
      if (this.reloading <= 0) this.finishReload();
    }

    const before = [this.x, this.y];
    const sees = this.canSee(nav, p.x, p.y);
    if (sees) {
      this.lastSeen = [p.x, p.y];
      this.alertTimer = 5;
      if (this.state === SCAV_STATE.PATROL) {
        this.state = SCAV_STATE.ALERT;
        raid.onScavAlert(this);
      } else {
        this.state = SCAV_STATE.ENGAGE;
      }
    } else if (this.alertTimer > 0) {
      this.alertTimer -= dt;
      if (this.alertTimer <= 0 && this.state !== SCAV_STATE.PATROL) {
        this.state = SCAV_STATE.PATROL;
        this.path = [];
      }
    }

    if (this.state === SCAV_STATE.PATROL) this.patrol(dt, raid);
    else this.fight(dt, raid, sees);
    this.moving = dist(before[0], before[1], this.x, this.y) > 0.01;
  }

  patrol(dt, raid) {
    if (!this.path.length) {
      const target = raid.randomWalkable(this.x, this.y, 24);
      if (target) this.path = raid.nav.findPath(this.x, this.y, target[0], target[1]) || [];
      if (!this.path.length) { this.facing += raid.rng.float(-1, 1); return; }
    }
    this.follow(dt, PATROL_SPEED * this.speedMult());
  }

  fight(dt, raid, sees) {
    const p = raid.player;
    const d = dist(this.x, this.y, p.x, p.y);
    this.facing = Math.atan2(p.y - this.y, p.x - this.x);

    if (sees && d <= FIRE_RANGE) {
      this.path = [];
      if (d < KEEP_DISTANCE * 0.6) {
        // back off a little so it does not stand on top of the player
        const away = this.facing + Math.PI;
        const nx = this.x + Math.cos(away) * CHASE_SPEED * this.speedMult() * dt;
        const ny = this.y + Math.sin(away) * CHASE_SPEED * this.speedMult() * dt;
        if (raid.nav.walkable(nx, ny)) { this.x = nx; this.y = ny; }
      }
      if (this.reloading > 0) return;
      // an empty gun gets changed before anything else
      if (this.weapon && roundsInWeapon(this.weapon) === 0) { this.startReload(raid); return; }
      this.cooldown -= dt;
      if (this.cooldown <= 0) this.shoot(raid, d);
      return;
    }

    // move toward where the player was last seen
    const goal = this.lastSeen || [p.x, p.y];
    if (!this.path.length) {
      this.path = raid.nav.findPath(this.x, this.y, goal[0], goal[1]) || [];
      if (!this.path.length) { this.state = SCAV_STATE.PATROL; return; }
    }
    this.follow(dt, CHASE_SPEED * this.speedMult());
    // a lull on the move is when the magazine gets topped up
    if (this.weapon && this.reloading <= 0 && roundsInWeapon(this.weapon) <= 2 && this.canReload()) this.startReload(raid);
  }

  follow(dt, speed) {
    if (!this.path.length) return;
    const t = this.path[0];
    const dx = t[0] - this.x, dy = t[1] - this.y;
    const d = Math.hypot(dx, dy);
    const step = speed * dt;
    this.facing = Math.atan2(dy, dx);
    if (d <= step) { this.x = t[0]; this.y = t[1]; this.path.shift(); }
    else { this.x += (dx / d) * step; this.y += (dy / d) * step; }
  }

  // ---- the gun ----
  /**
   * A trigger pull: the raid resolves the shot from this scav's own gun. An
   * automatic fires a short string at its cyclic rate, then waits; a
   * semi-auto fires and waits by tier.
   */
  shoot(raid, d) {
    void d;
    if (!this.weapon) return;
    const w = this.weapon.tpl.wpn || {};
    const auto = this.gunState?.mode === 'fullauto';
    if (auto && this.burstLeft <= 0) this.burstLeft = this.rng.int(BURST_MIN, BURST_MAX);
    const r = raid.scavFire(this);
    if (r === 'dry') { this.startReload(raid); return; }
    if (auto) {
      this.burstLeft -= 1;
      this.cooldown = this.burstLeft > 0 ? 60 / (w.rpm || 600) : (1.6 - this.tier * 0.25) * this.rng.float(0.8, 1.4);
    } else {
      const pump = this.weapon.tpl.key === 'w_mp133' ? 0.8 : 0;
      this.cooldown = Math.max(pump, (1.3 - this.tier * 0.2)) * this.rng.float(0.8, 1.4);
    }
  }

  /** the next round out of the gun, chamber first */
  takeRound() {
    if (!this.weapon) return null;
    const t = takeRound(this.weapon);
    return t || null;
  }

  canReload() {
    if (!this.weapon) return false;
    const w = this.weapon.tpl.wpn || {};
    if (w.reload === 'InternalMagazine') return !!(this.loose && this.loose.stack > 0 && this.weapon.magazine && this.weapon.magazine.ammoFree > 0);
    return this.spares.some((m) => m.ammoCount > 0);
  }

  startReload(raid) {
    void raid;
    if (this.reloading > 0) return;
    if (!this.canReload()) return;      // dry: it will close in or run
    this.reloading = reloadTime(this.weapon) * SCAV_RELOAD_MULT;
  }

  /** the magazine change lands: the fullest spare in, the old one kept */
  finishReload() {
    const weapon = this.weapon;
    if (!weapon) return;
    const w = weapon.tpl.wpn || {};
    const mag = weapon.magazine;
    if (w.reload === 'InternalMagazine') {
      if (!mag || !this.loose) return;
      const take = Math.min(mag.ammoFree, this.loose.stack);
      if (take > 0) {
        const top = mag.rounds[mag.rounds.length - 1];
        if (top && top.t === this.loose.tplId) top.n += take;
        else mag.rounds.push({ t: this.loose.tplId, n: take });
        this.loose.stack -= take;
        if (this.loose.stack <= 0) this.loose = null;
      }
    } else {
      this.spares.sort((a, b) => b.ammoCount - a.ammoCount);
      const best = this.spares[0];
      if (!best || best.ammoCount <= (mag?.ammoCount || 0)) return;
      const slot = weapon.slots?.find((sl) => sl.name === 'mod_magazine');
      if (!slot) return;
      this.spares.shift();
      if (mag) { slot.clear(); this.spares.push(mag); }
      slot.set(best);
    }
    // a round into the chamber
    if (weapon.chamber && weapon.chamber.length === 0 && weapon.magazine?.ammoCount) {
      const m = weapon.magazine, top = m.rounds[m.rounds.length - 1];
      weapon.chamber.push(top.t); top.n -= 1; if (top.n <= 0) m.rounds.pop();
    }
  }

  // ---- being shot, hearing shots ----
  /** a round landed (gunplay.landRound already put it into the body) */
  onHit(raid, land) {
    if (!this.alive) return;
    this.hitFlash = 1;
    this.alertTimer = 6;
    this.hp = this.health.total;
    void land;
    if (this.state === SCAV_STATE.PATROL) {
      this.state = SCAV_STATE.ENGAGE;
      this.lastSeen = [raid.player.x, raid.player.y];
      raid.onScavAlert(this);
    }
  }

  /** a shot heard from (x, y): turn toward it and go look */
  hear(raid, x, y) {
    if (!this.alive) return;
    if (this.state === SCAV_STATE.ENGAGE) return;
    this.lastSeen = [x, y];
    this.alertTimer = Math.max(this.alertTimer, 8);
    this.facing = Math.atan2(y - this.y, x - this.x);
    if (this.state === SCAV_STATE.PATROL) {
      this.state = SCAV_STATE.ALERT;
      this.path = [];
      raid.onScavAlert(this);
    }
  }

  /** kept for anything that still deals plain damage to a scav */
  takeHit(amount, raid, part = 'thorax') {
    if (!this.alive) return false;
    this.health.hit(part, amount, { rng: raid.rng, bullet: true });
    this.onHit(raid, null);
    return this.health.dead;
  }
}

/** the parts a scav's body still has, for the debug view */
export function scavParts(scav) {
  return Object.entries(scav.health.parts).map(([k, v]) => `${PART[k].short} ${Math.round(v.hp)}`).join(' ');
}

