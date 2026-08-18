// =========================================================
// scavs: patrol, notice, engage
//
// Deliberately simple: a scav wanders the navmesh, and if the player is
// inside its view cone with clear line of sight it closes to a firing
// distance and shoots on a cooldown. Killing one leaves a searchable body.
// =========================================================

import { dist, clamp, uid } from '../core/util.js';
import { sfx } from '../core/audio.js';

export const SCAV_STATE = { PATROL: 'patrol', ALERT: 'alert', ENGAGE: 'engage', DEAD: 'dead' };

const PATROL_SPEED = 3.1;
const CHASE_SPEED = 5.2;
const FIRE_RANGE = 20;
const KEEP_DISTANCE = 8;

/**
 * What a scav is carrying, for the sake of the noise it makes. They have no
 * weapon item - damage comes off the tier - but a shot still has to sound like
 * something, and picking once at spawn means a given scav keeps its voice
 * instead of changing gun between rounds. Scrappier guns at the low tiers.
 */
const SCAV_BANKS = [
  ['mp133', 'akm', 'kedr'],
  ['akm', 'aksu', 'kedr', 'mp153'],
  ['ak74', 'aksu', 'akm', 'saiga'],
];

export class Scav {
  constructor({ x, y, rng, tier = 1 }) {
    this.id = uid('s');
    this.x = x;
    this.y = y;
    this.facing = rng.float(-Math.PI, Math.PI);
    this.state = SCAV_STATE.PATROL;
    this.hp = 70 + tier * 20;
    this.maxHp = this.hp;
    this.tier = tier;
    this.viewRange = 24 + tier * 3;
    this.viewCone = 1.15;              // radians, half-angle
    // per hit, before armour; the body is seven parts now, so a round has to
    // mean something to the one it lands on (a thorax is 85, a head 35)
    this.damage = 16 + tier * 6;
    this.fireDelay = 1.5 - tier * 0.25;
    this.accuracy = 0.34 + tier * 0.09;
    this.cooldown = rng.float(0, 1.2);
    this.bank = rng.pick(SCAV_BANKS[clamp(tier - 1, 0, SCAV_BANKS.length - 1)]);
    this.path = [];
    this.alertTimer = 0;
    this.lastSeen = null;
    this.muzzle = 0;
    this.hitFlash = 0;
  }

  get alive() { return this.state !== SCAV_STATE.DEAD; }

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
  }

  patrol(dt, raid) {
    if (!this.path.length) {
      const target = raid.randomWalkable(this.x, this.y, 24);
      if (target) this.path = raid.nav.findPath(this.x, this.y, target[0], target[1]) || [];
      if (!this.path.length) { this.facing += raid.rng.float(-1, 1); return; }
    }
    this.follow(dt, PATROL_SPEED);
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
        const nx = this.x + Math.cos(away) * CHASE_SPEED * dt;
        const ny = this.y + Math.sin(away) * CHASE_SPEED * dt;
        if (raid.nav.walkable(nx, ny)) { this.x = nx; this.y = ny; }
      }
      this.cooldown -= dt;
      if (this.cooldown <= 0) {
        this.cooldown = this.fireDelay * raid.rng.float(0.8, 1.3);
        this.shoot(raid, d);
      }
      return;
    }

    // move toward where the player was last seen
    const goal = this.lastSeen || [p.x, p.y];
    if (!this.path.length) {
      this.path = raid.nav.findPath(this.x, this.y, goal[0], goal[1]) || [];
      if (!this.path.length) { this.state = SCAV_STATE.PATROL; return; }
    }
    this.follow(dt, CHASE_SPEED);
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

  shoot(raid, d) {
    this.muzzle = 1;
    const falloff = clamp(1 - (d / FIRE_RANGE) * 0.65, 0.2, 1);
    const hit = raid.rng.chance(this.accuracy * falloff);
    sfx.hostileFire(this.bank);
    raid.registerShot({ from: [this.x, this.y], to: [raid.player.x, raid.player.y], hostile: true, hit });
    if (hit) raid.damagePlayer(this.damage * raid.rng.float(0.75, 1.25), this);
    else raid.onNearMiss();
  }

  takeHit(amount, raid) {
    if (!this.alive) return false;
    this.hp -= amount;
    this.hitFlash = 1;
    this.alertTimer = 6;
    if (this.state === SCAV_STATE.PATROL) {
      this.state = SCAV_STATE.ENGAGE;
      this.lastSeen = [raid.player.x, raid.player.y];
      raid.onScavAlert(this);
    }
    if (this.hp <= 0) { this.state = SCAV_STATE.DEAD; return true; }
    return false;
  }
}
