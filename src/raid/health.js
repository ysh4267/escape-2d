// =========================================================
// health: seven body parts, the conditions they pick up, and what the
// medicine does about them
//
// The numbers are the game's own. Part sizes, bleeding and fracture odds,
// tick damage, existence drain, dehydration and exhaustion, off-raid
// regeneration and the Therapist's prices come out of globals.json
// (SPT 3.10.1 dump, tools/cache/globals_3101.json, config.Health); the part
// specific penalties (a fractured leg is 45% slower, a destroyed arm passes
// 0.49x of what hits it on to the rest of the body) are the wiki's Health
// system page. What each med removes, what that costs it, and how long a use
// takes is on the item template (tpl.med, built by tools/build_items.py).
// =========================================================

import { clamp } from '../core/util.js';

// ---------------------------------------------------------
// body
// ---------------------------------------------------------
/**
 * `over` is how much of a hit on an already destroyed part is passed on to
 * the rest of the body: OverDamageReceivedMultiplier (0.7) times the
 * per-limb HandsOverdamage 0.7 / LegsOverdamage 1 / StomachOverdamage 1.5.
 * A destroyed head or thorax is death, so it has no over-damage.
 */
export const PARTS = [
  { key: 'head',    name: 'Head',      short: 'HEAD',  max: 35, vital: true },
  { key: 'thorax',  name: 'Thorax',    short: 'THRX',  max: 85, vital: true },
  { key: 'stomach', name: 'Stomach',   short: 'STOM',  max: 70, over: 1.05 },
  { key: 'larm',    name: 'Left arm',  short: 'L.ARM', max: 60, over: 0.49, limb: 'arm' },
  { key: 'rarm',    name: 'Right arm', short: 'R.ARM', max: 60, over: 0.49, limb: 'arm' },
  { key: 'lleg',    name: 'Left leg',  short: 'L.LEG', max: 65, over: 0.7,  limb: 'leg' },
  { key: 'rleg',    name: 'Right leg', short: 'R.LEG', max: 65, over: 0.7,  limb: 'leg' },
];
export const PART = Object.fromEntries(PARTS.map((p) => [p.key, p]));
export const MAX_TOTAL = PARTS.reduce((n, p) => n + p.max, 0);   // 440

/** where a round lands on a standing target, weighted */
export const HIT_WEIGHTS = [
  ['head', 8], ['thorax', 29], ['stomach', 15],
  ['larm', 12], ['rarm', 12], ['lleg', 12], ['rleg', 12],
];

// ---------------------------------------------------------
// conditions
// ---------------------------------------------------------
export const FX = {
  LB: 'lb',         // light bleeding, on a part
  HB: 'hb',         // heavy bleeding, on a part
  FW: 'fw',         // fresh wound: a treated heavy bleed, on a part
  FR: 'fr',         // fracture, on an arm or a leg
  PK: 'pk',         // on painkillers
  CT: 'ct',         // contusion (concussion)
  HEMO: 'hemo',     // zagustin: no blood loss for a while
  REGEN: 'regen',   // stim regeneration, {rate} hp/s over the body
  TREMOR: 'tremor', // stim side effect (the pain-caused tremor is derived)
  TUNNEL: 'tunnel', // stim side effect: tunnel vision
  ADR: 'adr',       // adrenaline: stamina
  CTIMM: 'ctimm',   // contusion immunity from a stim
};

/** how each condition is named and drawn; `bad` decides the icon colour */
export const FX_INFO = {
  lb:     { name: 'Light bleeding', icon: 'fx-lb', bad: true },
  hb:     { name: 'Heavy bleeding', icon: 'fx-hb', bad: true },
  fw:     { name: 'Fresh wound',    icon: 'fx-fw', bad: true },
  fr:     { name: 'Fracture',       icon: 'fx-fr', bad: true },
  pain:   { name: 'Pain',           icon: 'fx-pain', bad: true },
  tremor: { name: 'Hands tremor',   icon: 'fx-tremor', bad: true },
  ct:     { name: 'Concussion',     icon: 'fx-ct', bad: true },
  pk:     { name: 'On painkillers', icon: 'fx-pk' },
  dehy:   { name: 'Dehydration',    icon: 'fx-dehy', bad: true },
  exh:    { name: 'Exhaustion',     icon: 'fx-exh', bad: true },
  hemo:   { name: 'Hemostatic',     icon: 'fx-buff' },
  regen:  { name: 'Regeneration',   icon: 'fx-buff' },
  tunnel: { name: 'Tunnel vision',  icon: 'fx-tunnel', bad: true },
  adr:    { name: 'Adrenaline',     icon: 'fx-buff' },
  ctimm:  { name: 'Concussion immunity', icon: 'fx-buff' },
  dp:     { name: 'Destroyed',      icon: 'fx-dp', bad: true },
  lowhp:  { name: 'Critical health', icon: 'fx-lowhp', bad: true },
  thirst: { name: 'Thirsty',        icon: 'fx-dehy', bad: true },
  hunger: { name: 'Hungry',         icon: 'fx-exh', bad: true },
};

// ---------------------------------------------------------
// globals.json config.Health
// ---------------------------------------------------------
export const G = {
  lb: { dmg: 0.8, dmgDehydrated: 0.4, loop: 6, energy: 0.5, energyLoop: 6, offline: 600, price: 400,
        prob: { k: 0.5, b: -0.125, threshold: 0.35 } },
  hb: { dmg: 0.9, dmgDehydrated: 0.4, loop: 4, energy: 0.5, energyLoop: 5, offline: 900, price: 1200,
        prob: { k: 0.45, b: -0.17, threshold: 0.5 } },
  fr: { prob: { k: 0.3, b: 0.05, threshold: 0.3 }, price: 1000 },
  freshWound: 480,
  painTremorDelay: 30,
  existence: { energy: 3.2, hydration: 2.6, loop: 60, stomachFactor: 5 },
  dehydration: { delay: 50, dmg: 1, loop: 15 },
  exhaustion: { delay: 30, dmg: 1, loop: 5 },
  lowEdge: 130,
  regen: { head: 0.6125, thorax: 1.4, stomach: 1.225, larm: 1.05, rarm: 1.05, lleg: 1.1375, rleg: 1.1375,
           energy: 1, hydration: 1 },      // per minute, off raid
  heal: { hpPrice: 30, trialLevels: 5, trialRaids: 30 },
  deathHealth: 0.3,
};

/** the game's Linear / SquareRoot probability curves */
function chance(curve, x) {
  if (x < curve.threshold) return 0;
  const v = curve.k * (curve.sqrt ? Math.sqrt(x) : x) + curve.b;
  return clamp(v, 0, 1);
}
G.fr.prob.sqrt = true;

const LEG_SPEED = 0.55;         // each bad leg
const ARM_AIM = 0.85;           // each bad arm
const PAIN_AIM = 0.92;
const TREMOR_AIM = 0.85;
const RARM_SLOW = 1.5;          // right arm: item use, searching
const LARM_SLOW = 1.67;         // left arm
const HIT_PAIN = 20;            // seconds of pain from a wound
const FW_SPRINT_BLEED = 0.03;   // per second of sprinting on a fresh wound
const FW_REOPEN = 12;           // a hit this hard on a fresh wound bleeds again
const SPRINT_LEG_DMG = 0.6;     // per second, sprinting on a broken leg (painkillers)

// ---------------------------------------------------------
export class Health {
  constructor() {
    this.reset();
  }

  reset() {
    this.parts = {};
    for (const p of PARTS) this.parts[p.key] = { hp: p.max, max: p.max };
    this.energy = 100;
    this.hydration = 100;
    /** [{type, part, t (seconds left, Infinity = until treated), delay, meta}] */
    this.effects = [];
    this.clock = {};          // per-loop accumulators
    this.painTimer = 0;       // fresh pain from being hit
    this.painFor = 0;         // how long pain has gone untreated (tremor)
    this.dehyTimer = 0;
    this.exhTimer = 0;
    this.dead = false;
    this.events = [];
    this.ts = Date.now();
  }

  // ---------------------------------------------------------
  // reading
  // ---------------------------------------------------------
  get total() { return PARTS.reduce((n, p) => n + this.parts[p.key].hp, 0); }
  get max() { return PARTS.reduce((n, p) => n + this.parts[p.key].max, 0); }
  hp(part) { return this.parts[part].hp; }
  isDestroyed(part) { return this.parts[part].hp <= 0; }
  alive() { return PARTS.filter((p) => this.parts[p.key].hp > 0); }

  has(type, part = undefined) {
    return this.effects.some((e) => e.type === type && (part === undefined || e.part === part) && !(e.delay > 0));
  }
  find(type, part = undefined) {
    return this.effects.find((e) => e.type === type && (part === undefined || e.part === part));
  }
  count(type) { return this.effects.filter((e) => e.type === type && !(e.delay > 0)).length; }

  get onPainkiller() { return this.has(FX.PK); }
  get dehydrated() { return this.hydration <= 0 && this.dehyTimer >= G.dehydration.delay; }
  get exhausted() { return this.energy <= 0 && this.exhTimer >= G.exhaustion.delay; }
  get lowHp() { return this.total < G.lowEdge; }

  /** a broken limb: fractured (unless the painkillers hide it) or destroyed */
  bad(part) {
    if (this.isDestroyed(part)) return true;
    return this.has(FX.FR, part) && !this.onPainkiller;
  }
  badLegs() { return ['lleg', 'rleg'].filter((k) => this.bad(k)).length; }
  badArms() { return ['larm', 'rarm'].filter((k) => this.bad(k)).length; }

  /** pain is a state, not a stored condition: it is there while its cause is */
  get inPain() {
    if (this.onPainkiller) return false;
    if (this.painTimer > 0 || this.dehydrated) return true;
    if (this.effects.some((e) => e.type === FX.FR && !(e.delay > 0))) return true;
    return PARTS.some((p) => !p.vital && this.isDestroyed(p.key));
  }
  get tremor() {
    return this.has(FX.TREMOR) || this.dehydrated || (this.inPain && this.painFor >= G.painTremorDelay);
  }
  get tunnel() { return this.has(FX.TUNNEL) || this.exhausted; }
  get contused() { return this.has(FX.CT); }

  // gameplay multipliers ------------------------------------
  /** the painkillers let a broken leg carry you at speed; a destroyed leg on
   *  painkillers still limps a little */
  speedMult() {
    let m = 1;
    for (const k of ['lleg', 'rleg']) {
      if (this.bad(k)) m *= LEG_SPEED;
      else if (this.isDestroyed(k)) m *= 0.85;
    }
    if (this.exhausted) m *= 0.85;
    return m;
  }
  canSprint() {
    if (this.badLegs() > 0) return false;
    return !this.exhausted;
  }
  aimMult() {
    let m = Math.pow(ARM_AIM, this.badArms());
    if (this.inPain) m *= PAIN_AIM;
    if (this.tremor) m *= TREMOR_AIM;
    return m;
  }
  /** cooldown between shots: a broken right arm handles the gun slower */
  handlingMult() {
    return this.bad('rarm') ? 1.35 : 1;
  }
  /** searching and item use: right arm 50% slower, left arm 67% slower */
  useMult() {
    let m = 1;
    if (this.bad('rarm')) m *= RARM_SLOW;
    if (this.bad('larm')) m *= LARM_SLOW;
    return m;
  }
  staminaMult() { return this.has(FX.ADR) ? 1.6 : 1; }

  /** the HUD's summary of what is wrong */
  flags() {
    const out = [];
    const push = (type, n = 1, t = null) => out.push({ type, n, t });
    for (const t of [FX.HB, FX.LB, FX.FR, FX.FW]) {
      const n = this.count(t);
      if (n) push(t, n);
    }
    const dp = PARTS.filter((p) => !p.vital && this.isDestroyed(p.key)).length;
    if (dp) push('dp', dp);
    if (this.inPain) push('pain');
    if (this.tremor) push('tremor');
    if (this.contused) push(FX.CT, 1, this.find(FX.CT)?.t);
    if (this.tunnel) push('tunnel');
    if (this.onPainkiller) push(FX.PK, 1, this.find(FX.PK)?.t);
    for (const t of [FX.HEMO, FX.REGEN, FX.ADR]) if (this.has(t)) push(t, 1, this.find(t)?.t);
    if (this.dehydrated) push('dehy');
    else if (this.hydration < 20) push('thirst');
    if (this.exhausted) push('exh');
    else if (this.energy < 20) push('hunger');
    if (this.lowHp) push('lowhp');
    return out;
  }

  /** the conditions sitting on one part, for the doll */
  partFx(part) {
    const out = [];
    if (this.isDestroyed(part)) out.push('dp');
    for (const e of this.effects) {
      if (e.part === part && !(e.delay > 0) && !out.includes(e.type)) out.push(e.type);
    }
    return out;
  }

  // ---------------------------------------------------------
  // conditions
  // ---------------------------------------------------------
  addEffect(type, part = null, t = Infinity, meta = {}, delay = 0) {
    const cur = this.effects.find((e) => e.type === type && e.part === part);
    if (cur) {
      // a repeat refreshes rather than stacks
      cur.t = Math.max(cur.t, t);
      cur.delay = Math.min(cur.delay || 0, delay);
      Object.assign(cur.meta, meta);
      return cur;
    }
    const e = { type, part, t, delay, meta };
    this.effects.push(e);
    this.events.push({ kind: 'fx', type, part });
    return e;
  }
  removeEffect(type, part = undefined) {
    const before = this.effects.length;
    this.effects = this.effects.filter((e) => !(e.type === type && (part === undefined || e.part === part)));
    return before - this.effects.length;
  }

  // ---------------------------------------------------------
  // damage
  // ---------------------------------------------------------
  /**
   * A hit on a part. `bullet` hits roll for bleeding and fractures; the
   * amount is what got through the armour. Returns what happened so the raid
   * can narrate it.
   */
  hit(part, amount, { rng = null, bullet = true, blunt = false } = {}) {
    const def = PART[part];
    const res = { part, applied: 0, killed: false, destroyed: false, fx: [] };
    if (this.dead || amount <= 0) return res;

    if (this.isDestroyed(part)) {
      if (def.vital) { this.die(); res.killed = true; return res; }
      // a destroyed limb passes a share of the hit on to everything else
      res.applied = this.distribute(amount * (def.over || 0.7), res);
      return res;
    }

    const p = this.parts[part];
    const dealt = Math.min(p.hp, amount);
    p.hp = Math.max(0, p.hp - amount);
    res.applied = dealt;
    if (p.hp <= 0) {
      res.destroyed = true;
      this.events.push({ kind: 'destroyed', part });
      if (def.vital) { this.die(); res.killed = true; return res; }
    }

    if (amount >= 4) this.painTimer = Math.max(this.painTimer, HIT_PAIN);

    if (bullet && !blunt) {
      const x = amount / def.max;
      const roll = () => (rng ? rng.float(0, 1) : Math.random());
      const hemo = this.has(FX.HEMO);
      // a fresh wound tears open again under a real hit
      if (!hemo && this.has(FX.FW, part) && amount >= FW_REOPEN) {
        this.removeEffect(FX.FW, part);
        this.addEffect(FX.HB, part);
        res.fx.push(FX.HB);
      } else if (!hemo && !this.has(FX.HB, part) && roll() < chance(G.hb.prob, x)) {
        this.addEffect(FX.HB, part);
        res.fx.push(FX.HB);
      } else if (!hemo && !this.has(FX.LB, part) && roll() < chance(G.lb.prob, x)) {
        this.addEffect(FX.LB, part);
        res.fx.push(FX.LB);
      }
      if (def.limb && !this.has(FX.FR, part) && p.hp > 0 && roll() < chance(G.fr.prob, x)) {
        this.addEffect(FX.FR, part);
        res.fx.push(FX.FR);
      }
    }
    return res;
  }

  /** spread damage evenly over every part that still has health */
  distribute(amount, res = null) {
    const alive = this.alive();
    if (!alive.length) { this.die(); if (res) res.killed = true; return 0; }
    const each = amount / alive.length;
    let applied = 0;
    for (const def of alive) {
      const p = this.parts[def.key];
      applied += Math.min(p.hp, each);
      p.hp = Math.max(0, p.hp - each);
      if (p.hp <= 0) {
        this.events.push({ kind: 'destroyed', part: def.key });
        if (def.vital) { this.die(); if (res) res.killed = true; }
      }
    }
    if (amount >= 4) this.painTimer = Math.max(this.painTimer, HIT_PAIN);
    return applied;
  }

  /** a tick of a condition: bleeding, thirst, hunger. Skips destroyed parts. */
  tickDamage(each, { killsOnVital = false } = {}) {
    for (const def of PARTS) {
      const p = this.parts[def.key];
      if (p.hp <= 0) {
        if (killsOnVital && def.vital) this.die();
        continue;
      }
      p.hp = Math.max(0, p.hp - each);
      if (p.hp <= 0) this.events.push({ kind: 'destroyed', part: def.key });
    }
    if (this.total <= 0) this.die();
  }

  die() {
    if (this.dead) return;
    this.dead = true;
    this.events.push({ kind: 'dead' });
  }

  // ---------------------------------------------------------
  // time
  // ---------------------------------------------------------
  /**
   * One raid tick. `ctx.sprinting` is what the fresh wounds and the broken
   * legs care about; `ctx.rng` keeps the rolls deterministic.
   */
  tick(dt, ctx = {}) {
    if (this.dead || dt <= 0) return;
    const rng = ctx.rng;
    const roll = () => (rng ? rng.float(0, 1) : Math.random());
    const clk = this.clock;
    const every = (key, loop) => {
      clk[key] = (clk[key] || 0) + dt;
      let n = 0;
      while (clk[key] >= loop) { clk[key] -= loop; n++; }
      return n;
    };

    // timers on the conditions
    for (const e of this.effects) {
      if (e.delay > 0) { e.delay -= dt; continue; }
      if (e.t !== Infinity) e.t -= dt;
    }
    for (const e of this.effects) {
      if (e.t <= 0) this.events.push({ kind: 'fxEnd', type: e.type, part: e.part });
    }
    this.effects = this.effects.filter((e) => e.t > 0);

    // hemostatic: nothing bleeds while it works
    if (this.has(FX.HEMO)) {
      this.removeEffect(FX.LB);
      this.removeEffect(FX.HB);
    }

    // bleeding: every bleed drains every live part
    const dehy = this.dehydrated;
    for (const [type, cfg] of [[FX.LB, G.lb], [FX.HB, G.hb]]) {
      const n = this.count(type);
      if (!n) { clk[type] = 0; clk[`${type}e`] = 0; continue; }
      const ticks = every(type, cfg.loop);
      if (ticks) this.tickDamage((dehy ? cfg.dmgDehydrated : cfg.dmg) * n * ticks);
      const et = every(`${type}e`, cfg.energyLoop);
      if (et) this.energy = clamp(this.energy - cfg.energy * n * et, 0, 100);
    }

    // existence: the body burns food and water, five times as fast with the
    // stomach gone
    if (ctx.inRaid !== false) {
      const f = this.isDestroyed('stomach') ? G.existence.stomachFactor : 1;
      this.energy = clamp(this.energy - (G.existence.energy / G.existence.loop) * f * dt, 0, 100);
      this.hydration = clamp(this.hydration - (G.existence.hydration / G.existence.loop) * f * dt, 0, 100);
    }

    // dehydration and exhaustion
    if (this.hydration <= 0) {
      const was = this.dehydrated;
      this.dehyTimer += dt;
      if (!was && this.dehydrated) this.events.push({ kind: 'fx', type: 'dehy' });
      if (this.dehydrated) {
        const n = every('dehy', G.dehydration.loop);
        if (n) this.tickDamage(G.dehydration.dmg * n, { killsOnVital: true });
      }
    } else { this.dehyTimer = 0; clk.dehy = 0; }
    if (this.energy <= 0) {
      const was = this.exhausted;
      this.exhTimer += dt;
      if (!was && this.exhausted) this.events.push({ kind: 'fx', type: 'exh' });
      if (this.exhausted) {
        const n = every('exh', G.exhaustion.loop);
        if (n) this.tickDamage(G.exhaustion.dmg * n, { killsOnVital: true });
      }
    } else { this.exhTimer = 0; clk.exh = 0; }

    // stim regeneration, spread over what is hurt
    let regen = 0;
    for (const e of this.effects) if (e.type === FX.REGEN && !(e.delay > 0)) regen += e.meta.rate || 0;
    if (regen > 0) this.healSpread(regen * dt);

    // sprinting on a fresh wound tears it; on a broken leg it costs the leg
    if (ctx.sprinting) {
      for (const e of this.effects) {
        if (e.type !== FX.FW || e.delay > 0) continue;
        if (!this.has(FX.HEMO) && roll() < FW_SPRINT_BLEED * dt) {
          this.removeEffect(FX.FW, e.part);
          this.addEffect(FX.LB, e.part);
          break;
        }
      }
      for (const k of ['lleg', 'rleg']) {
        if (this.has(FX.FR, k) || this.isDestroyed(k)) {
          if (this.isDestroyed(k)) this.distribute(SPRINT_LEG_DMG * dt * (PART[k].over || 0.7));
          else this.parts[k].hp = Math.max(0, this.parts[k].hp - SPRINT_LEG_DMG * dt);
          if (this.parts[k].hp <= 0 && !this.events.some((ev) => ev.kind === 'destroyed' && ev.part === k)) {
            this.events.push({ kind: 'destroyed', part: k });
          }
        }
      }
    }

    // pain bookkeeping: tremor sets in after it has gone on for a while
    this.painTimer = Math.max(0, this.painTimer - dt);
    if (this.inPain) this.painFor += dt;
    else this.painFor = Math.max(0, this.painFor - dt * 2);

    if (this.total <= 0) this.die();
  }

  /** put `amount` HP back, spread over the hurt parts that still live */
  healSpread(amount) {
    const hurt = PARTS.filter((p) => this.parts[p.key].hp > 0 && this.parts[p.key].hp < this.parts[p.key].max);
    if (!hurt.length) return 0;
    const each = amount / hurt.length;
    let done = 0;
    for (const def of hurt) {
      const p = this.parts[def.key];
      const add = Math.min(each, p.max - p.hp);
      p.hp += add;
      done += add;
    }
    return done;
  }

  // ---------------------------------------------------------
  // medicine
  // ---------------------------------------------------------
  /** does this med want a body part picked? */
  static needsPart(tpl) {
    const k = tpl.med?.kind;
    return k === 'medkit' || k === 'bandage' || k === 'tourniquet' || k === 'splint' || k === 'surgery';
  }

  /**
   * What one use of `item` on `part` would do. `ok:false` carries the reason
   * the way the game greys a part out. A medkit spends its resource on
   * removing a bleed first (heavy before light) and heals on the next use;
   * a bandage, splint or surgical kit spends one charge per condition.
   */
  plan(item, part = null) {
    const tpl = item.tpl;
    const m = tpl.med;
    if (!m) return { ok: false, reason: 'Not usable' };
    const res = item.res ?? (tpl.res ? tpl.res.max : 1);
    const out = { ok: true, kind: m.kind, part, cost: 1, heal: 0, removes: [], adds: [], time: m.t || 2, note: '' };
    const rm = m.rm || {};
    const p = part ? this.parts[part] : null;
    const def = part ? PART[part] : null;

    switch (m.kind) {
      case 'medkit': {
        if (!part) return { ok: false, reason: 'Pick a body part' };
        if (this.isDestroyed(part)) return { ok: false, reason: 'Destroyed — needs surgery' };
        if (rm.hb && this.has(FX.HB, part)) {
          const c = rm.hb.cost || 1;
          if (res < c) return { ok: false, reason: `Not enough left (${c} needed)` };
          out.cost = c; out.removes.push(FX.HB); out.adds.push(FX.FW);
          out.note = 'stops the heavy bleeding';
          return out;
        }
        if (rm.lb && this.has(FX.LB, part)) {
          const c = rm.lb.cost || 1;
          if (res < c) return { ok: false, reason: `Not enough left (${c} needed)` };
          out.cost = c; out.removes.push(FX.LB);
          out.note = 'stops the bleeding';
          return out;
        }
        if (rm.fr && this.has(FX.FR, part)) {
          const c = rm.fr.cost || 1;
          if (res < c) return { ok: false, reason: `Not enough left (${c} needed)` };
          out.cost = c; out.removes.push(FX.FR);
          out.note = 'sets the fracture';
          return out;
        }
        // a kit that cannot stop the bleed still puts hp back under it
        const missing = p.max - p.hp;
        if (missing <= 0.5) return { ok: false, reason: 'Nothing to treat' };
        const heal = Math.min(m.rate || 1, missing, res);
        if (heal <= 0) return { ok: false, reason: 'Empty' };
        out.cost = Math.ceil(heal); out.heal = heal;
        out.note = `+${Math.round(heal)} hp`;
        if (rm.ct && this.contused) out.removes.push(FX.CT);
        return out;
      }
      case 'bandage': {
        if (!part) return { ok: false, reason: 'Pick a body part' };
        if (!this.has(FX.LB, part)) {
          return { ok: false, reason: this.has(FX.HB, part) ? 'Heavy bleeding — needs a tourniquet' : 'Not bleeding' };
        }
        out.removes.push(FX.LB); out.note = 'stops the bleeding';
        return out;
      }
      case 'tourniquet': {
        if (!part) return { ok: false, reason: 'Pick a body part' };
        if (!this.has(FX.HB, part)) return { ok: false, reason: 'No heavy bleeding' };
        out.removes.push(FX.HB); out.adds.push(FX.FW); out.note = 'stops the heavy bleeding';
        return out;
      }
      case 'splint': {
        if (!part) return { ok: false, reason: 'Pick a body part' };
        if (!def.limb) return { ok: false, reason: 'Cannot be fractured' };
        if (!this.has(FX.FR, part)) return { ok: false, reason: 'Not fractured' };
        out.removes.push(FX.FR); out.note = 'sets the fracture';
        return out;
      }
      case 'surgery': {
        if (!part) return { ok: false, reason: 'Pick a body part' };
        if (def.vital) return { ok: false, reason: 'Cannot be operated on' };
        if (this.isDestroyed(part)) {
          out.removes.push('dp');
          if (rm.fr && this.has(FX.FR, part)) out.removes.push(FX.FR);
          out.note = `restores the part at ${rm.dp.min}–${rm.dp.max}% max`;
          return out;
        }
        if (rm.fr && this.has(FX.FR, part)) { out.removes.push(FX.FR); out.note = 'sets the fracture'; return out; }
        return { ok: false, reason: 'Not destroyed' };
      }
      case 'painkiller':
      case 'stim':
      case 'med': {
        if (m.pk) out.adds.push(FX.PK);
        if (rm.ct && this.contused) out.removes.push(FX.CT);
        if (m.hemo) { out.adds.push(FX.HEMO); }
        if (m.buff) out.adds.push('buff');
        out.note = m.pk ? `painkillers ${fmtDur(m.pk)}` : m.hemo ? 'stops all bleeding' : 'stimulant';
        return out;
      }
      case 'food':
      case 'drink': {
        const eh = m.eh || {};
        const bits = [];
        if (eh.en) bits.push(`energy ${eh.en > 0 ? '+' : ''}${eh.en}`);
        if (eh.hy) bits.push(`hydration ${eh.hy > 0 ? '+' : ''}${eh.hy}`);
        if (m.pk) out.adds.push(FX.PK);   // vodka
        out.note = bits.join(', ') + (m.pk ? `, painkillers ${fmtDur(m.pk)}` : '');
        out.cost = res;   // eaten in one go
        return out;
      }
      default:
        return { ok: false, reason: 'Not usable' };
    }
  }

  /** the part a med goes on if the player does not say: the worst it can help */
  bestPart(item) {
    let best = null, bestScore = -1;
    for (const def of PARTS) {
      const pl = this.plan(item, def.key);
      if (!pl.ok) continue;
      let s = 0;
      if (pl.removes.includes(FX.HB)) s = 400;
      else if (pl.removes.includes('dp')) s = 300;
      else if (pl.removes.includes(FX.LB)) s = 200;
      else if (pl.removes.includes(FX.FR)) s = 150;
      else s = 100 - (this.parts[def.key].hp / this.parts[def.key].max) * 90 + (def.vital ? 5 : 0);
      if (s > bestScore) { bestScore = s; best = def.key; }
    }
    return best;
  }

  /**
   * Apply one use. The item's resource is spent here; the caller detaches an
   * empty one. Returns the plan that ran, or the refusal.
   */
  apply(item, part = null, rng = null) {
    const pl = this.plan(item, part);
    if (!pl.ok) return pl;
    const m = item.tpl.med;
    const roll = (lo, hi) => (rng ? rng.float(lo, hi) : lo + Math.random() * (hi - lo));

    for (const r of pl.removes) {
      if (r === 'dp') {
        const def = PART[part];
        const pct = roll(m.rm.dp.min, m.rm.dp.max) / 100;
        const p = this.parts[part];
        // the part comes back at 1 hp with a lowered ceiling for the raid;
        // operating again lowers it further
        p.max = Math.max(1, Math.round(Math.min(p.max, def.max) * pct));
        p.hp = 1;
      } else if (r === FX.CT) {
        this.removeEffect(FX.CT);
      } else {
        this.removeEffect(r, part);
      }
    }
    for (const a of pl.adds) {
      if (a === FX.FW) this.addEffect(FX.FW, part, G.freshWound);
      else if (a === FX.PK) this.addEffect(FX.PK, null, m.pk);
      else if (a === FX.HEMO) { this.addEffect(FX.HEMO, null, m.hemo); this.removeEffect(FX.LB); this.removeEffect(FX.HB); }
      else if (a === 'buff') this.applyBuff(m.buff);
    }
    if (pl.heal > 0) {
      const p = this.parts[part];
      p.hp = Math.min(p.max, p.hp + pl.heal);
    }
    if (m.eh) {
      this.energy = clamp(this.energy + (m.eh.en || 0), 0, 100);
      this.hydration = clamp(this.hydration + (m.eh.hy || 0), 0, 100);
    }
    if (m.ctImmune) this.addEffect(FX.CTIMM, null, m.ctImmune);
    if (pl.removes.includes(FX.FR) || pl.removes.includes('dp')) this.painTimer = 0;
    // pain from a hit fades once the wound is dressed
    if (pl.removes.length) this.painTimer = Math.min(this.painTimer, 3);

    if (item.res != null) item.res = Math.max(0, item.res - pl.cost);
    else item.res = 0;
    return pl;
  }

  /** the handful of globals.json buff sets the meds we carry name */
  applyBuff(name) {
    switch (name) {
      case 'BuffsAdrenaline':
        this.addEffect(FX.ADR, null, 60);
        this.addEffect(FX.REGEN, null, 15, { rate: 4 }, 1);
        break;
      case 'BuffsPropital':
        this.addEffect(FX.REGEN, null, 300, { rate: 1 }, 1);
        this.addEffect(FX.TREMOR, null, 30, {}, 270);
        this.addEffect(FX.TUNNEL, null, 30, {}, 270);
        break;
      case 'BuffsZagustin':
        this.addEffect(FX.TREMOR, null, 40, {}, 170);
        break;
      case 'BuffsGoldenStarBalm':
        this.energy = clamp(this.energy + 5, 0, 100);
        this.hydration = clamp(this.hydration + 5, 0, 100);
        break;
      default:
        break;
    }
  }

  // ---------------------------------------------------------
  // between raids
  // ---------------------------------------------------------
  /** the raid is over: stim effects and surgery ceilings do not follow you home */
  afterRaid() {
    for (const def of PARTS) {
      const p = this.parts[def.key];
      p.max = def.max;
      p.hp = Math.min(p.hp, p.max);
    }
    this.effects = this.effects.filter((e) => e.type === FX.LB || e.type === FX.HB || e.type === FX.FR);
    for (const e of this.effects) e.offline = 0;
    this.painTimer = 0;
    this.painFor = 0;
    this.clock = {};
    this.dead = false;
    this.events = [];
    this.ts = Date.now();
  }

  /** dying puts you back at 30% everywhere, cleaned up */
  afterDeath() {
    for (const def of PARTS) {
      const p = this.parts[def.key];
      p.max = def.max;
      p.hp = Math.round(def.max * G.deathHealth);
    }
    this.effects = [];
    this.painTimer = 0;
    this.painFor = 0;
    this.dehyTimer = 0;
    this.exhTimer = 0;
    this.clock = {};
    this.dead = false;
    this.events = [];
    this.energy = Math.max(this.energy, 30);
    this.hydration = Math.max(this.hydration, 30);
    this.ts = Date.now();
  }

  /**
   * Off-raid regeneration for `seconds`. Health comes back per part per
   * minute (globals Regeneration.BodyHealth), not while anything is bleeding;
   * a bleed left untreated stops on its own after its offline duration.
   */
  regen(seconds) {
    if (seconds <= 0) return;
    let left = seconds;
    while (left > 0) {
      const step = Math.min(left, 60);
      left -= step;
      let bleeding = false;
      for (const e of this.effects) {
        if (e.type !== FX.LB && e.type !== FX.HB) continue;
        e.offline = (e.offline || 0) + step;
        const lim = e.type === FX.LB ? G.lb.offline : G.hb.offline;
        if (e.offline < lim) bleeding = true;
      }
      this.effects = this.effects.filter((e) => {
        if (e.type !== FX.LB && e.type !== FX.HB) return true;
        return (e.offline || 0) < (e.type === FX.LB ? G.lb.offline : G.hb.offline);
      });
      if (!bleeding) {
        for (const def of PARTS) {
          const p = this.parts[def.key];
          p.max = def.max;
          p.hp = Math.min(p.max, p.hp + (G.regen[def.key] / 60) * step);
        }
      }
      this.energy = clamp(this.energy + (G.regen.energy / 60) * step, 0, 100);
      this.hydration = clamp(this.hydration + (G.regen.hydration / 60) * step, 0, 100);
    }
    this.ts = Date.now();
  }

  /** the Therapist's bill: 30 ₽ an HP plus a flat fee per condition */
  treatmentCost() {
    let hp = 0;
    for (const def of PARTS) hp += def.max - this.parts[def.key].hp;
    let cost = Math.round(hp) * G.heal.hpPrice;
    cost += this.count(FX.LB) * G.lb.price + this.count(FX.HB) * G.hb.price + this.count(FX.FR) * G.fr.price;
    return cost;
  }
  needsTreatment() { return this.treatmentCost() > 0; }
  treatAll() {
    for (const def of PARTS) { this.parts[def.key].max = def.max; this.parts[def.key].hp = def.max; }
    this.effects = this.effects.filter((e) => e.type === FX.PK);
    this.painTimer = 0;
    this.painFor = 0;
  }

  // ---------------------------------------------------------
  toJSON() {
    const p = {};
    for (const def of PARTS) p[def.key] = [round2(this.parts[def.key].hp), this.parts[def.key].max];
    return {
      p, en: round2(this.energy), hy: round2(this.hydration),
      fx: this.effects.map((e) => ({
        y: e.type, p: e.part, t: e.t === Infinity ? -1 : round2(e.t),
        d: e.delay || 0, m: e.meta, o: e.offline || 0,
      })),
      pt: round2(this.painTimer), pf: round2(this.painFor),
      ts: this.ts,
    };
  }
  static fromJSON(o) {
    const h = new Health();
    if (!o) return h;
    for (const def of PARTS) {
      const v = o.p?.[def.key];
      if (v) { h.parts[def.key].hp = clamp(v[0], 0, def.max); h.parts[def.key].max = clamp(v[1] || def.max, 1, def.max); }
    }
    if (o.en != null) h.energy = clamp(o.en, 0, 100);
    if (o.hy != null) h.hydration = clamp(o.hy, 0, 100);
    for (const e of o.fx || []) {
      if (!FX_INFO[e.y]) continue;
      h.effects.push({ type: e.y, part: e.p ?? null, t: e.t < 0 ? Infinity : e.t, delay: e.d || 0, meta: e.m || {}, offline: e.o || 0 });
    }
    h.painTimer = o.pt || 0;
    h.painFor = o.pf || 0;
    h.ts = o.ts || Date.now();
    return h;
  }
}

function round2(v) { return Math.round(v * 100) / 100; }

export function fmtDur(s) {
  if (s === Infinity || s == null) return '';
  s = Math.max(0, Math.round(s));
  const m = Math.floor(s / 60);
  return m ? `${m}:${String(s % 60).padStart(2, '0')}` : `${s}s`;
}
