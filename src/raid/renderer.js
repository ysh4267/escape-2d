// =========================================================
// raid renderer
//
// The static map is drawn once into an offscreen canvas and then blitted
// twice per frame: dimmed everywhere, and at full brightness clipped to the
// player's visibility polygon. Entities are drawn on top, with unseen
// containers hidden until they have been in line of sight once.
// =========================================================

import { clamp } from '../core/util.js';
import { WALL_W } from './nav.js';

const PAL = {
  void: '#05080a',
  floor: '#22323a',
  floorLit: '#33474f',
  ledge: '#3c525c',
  stairs: '#46626b',
  stairsEdge: 'rgba(217,164,65,.55)',
  under: '#0d151a',              // the storey below, drawn as a faint ghost
  obstacle: '#16232b',
  obstacleEdge: '#41565f',
  building: '#101b22',
  buildingEdge: '#6e8f92',
  wall: '#a7c6cd',
  outline: '#0b1114',
  grid: 'rgba(184,219,217,.045)',
  doorShut: '#c98f4a',
  doorOpen: 'rgba(201,143,74,.35)',
  doorLocked: '#c2604f',
  doorKeyed: '#7fb39a',
};

export class Renderer {
  constructor(canvas, geo, level = 'ground') {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.geo = geo;
    this.ppu = 13;                 // pixels per svg unit
    this.cam = { x: 65, y: 70 };
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.mapScale = 12;
    /** one baked map image and one fog layer per storey, kept between visits */
    this.cache = new Map();
    this.setLevel(level);
    this.resize();
  }

  /**
   * Switch storeys. The baked image and the explored fog are per floor and are
   * kept, so coming back down to a floor finds it exactly as it was left.
   */
  setLevel(level) {
    if (this.level === level) return;
    this.level = level;
    this.L = this.geo.levels[level];
    let c = this.cache.get(level);
    if (!c) {
      c = this.buildStatic(level);
      this.cache.set(level, c);
    }
    this.mapCanvas = c.map;
    this.fog = c.fog;
    this.fogScale = c.fogScale;
    this.resetVisibility();
  }

  /** wipe every floor's fog, for a fresh raid */
  resetFog() {
    for (const c of this.cache.values()) {
      const fg = c.fog.getContext('2d');
      fg.globalCompositeOperation = 'source-over';
      fg.fillStyle = '#000';
      fg.fillRect(0, 0, c.fog.width, c.fog.height);
    }
    this.resetVisibility();
  }

  resize() {
    const c = this.canvas;
    const r = c.getBoundingClientRect();
    c.width = Math.max(320, Math.round(r.width * this.dpr));
    c.height = Math.max(240, Math.round(r.height * this.dpr));
    this.vw = c.width / this.dpr;
    this.vh = c.height / this.dpr;
  }

  // ---------------------------------------------------------
  buildStatic(level) {
    const [, , vw, vh] = this.geo.viewBox;
    const s = this.mapScale;
    const cv = document.createElement('canvas');
    cv.width = Math.ceil(vw * s);
    cv.height = Math.ceil(vh * s);
    const g = cv.getContext('2d');
    const L = this.geo.levels[level];

    // an upper storey is catwalks and offices over open air, so the ground
    // floor is drawn underneath at a whisper: it says what you are above
    const order = this.geo.order || ['basement', 'ground', 'second', 'third'];
    if (order.indexOf(level) > order.indexOf('ground')) {
      const B = this.geo.levels.ground;
      g.beginPath();
      for (const poly of B.floor) {
        poly.forEach((p, i) => (i ? g.lineTo(p[0] * s, p[1] * s) : g.moveTo(p[0] * s, p[1] * s)));
        g.closePath();
      }
      g.fillStyle = PAL.under;
      g.fill('evenodd');
    }

    const trace = (poly) => {
      g.beginPath();
      poly.forEach((p, i) => (i ? g.lineTo(p[0] * s, p[1] * s) : g.moveTo(p[0] * s, p[1] * s)));
      g.closePath();
    };

    // floor as one even-odd path so interior voids punch through
    g.beginPath();
    for (const poly of L.floor) {
      poly.forEach((p, i) => (i ? g.lineTo(p[0] * s, p[1] * s) : g.moveTo(p[0] * s, p[1] * s)));
      g.closePath();
    }
    g.fillStyle = PAL.floor;
    g.fill('evenodd');
    g.strokeStyle = PAL.outline;
    g.lineWidth = 3;
    g.stroke();

    // faint floor grid inside the building
    g.save();
    g.clip('evenodd');
    g.strokeStyle = PAL.grid;
    g.lineWidth = 1;
    for (let x = 0; x <= vw; x += 5) {
      g.beginPath(); g.moveTo(x * s, 0); g.lineTo(x * s, vh * s); g.stroke();
    }
    for (let y = 0; y <= vh; y += 5) {
      g.beginPath(); g.moveTo(0, y * s); g.lineTo(vw * s, y * s); g.stroke();
    }
    g.restore();

    for (const poly of L.ledge || []) { trace(poly); g.fillStyle = PAL.ledge; g.fill(); }
    for (const poly of L.stairs || []) {
      trace(poly);
      g.fillStyle = PAL.stairs; g.fill();
      g.strokeStyle = PAL.stairsEdge; g.lineWidth = 1.6; g.stroke();
    }
    for (const poly of L.obstacles || []) {
      trace(poly);
      g.fillStyle = PAL.obstacle; g.fill();
      g.strokeStyle = PAL.obstacleEdge; g.lineWidth = 1.4; g.stroke();
    }
    for (const poly of L.building || []) {
      trace(poly);
      g.fillStyle = PAL.building; g.fill();
      g.strokeStyle = PAL.buildingEdge; g.lineWidth = 2.2; g.stroke();
    }

    // Walls, drawn as thick as they actually are and no thicker.
    //
    // Two things used to make the plant unreadable. The stroke was 0.9 units
    // where the nav grid only blocks 0.44, so every wall was drawn at double
    // its real thickness; and a round cap adds half a line width past each end
    // of a polyline, which is 0.45 units of overshoot into the very gaps that
    // are the doorways. A metre-wide door came out looking like a hairline.
    //
    // So: butt caps, the real thickness, and the contrast made up with a dark
    // casing under a bright core rather than with bulk.
    g.lineCap = 'butt';
    g.lineJoin = 'round';
    for (const [width, colour] of [[WALL_W + 0.2, PAL.outline], [WALL_W, PAL.wall]]) {
      g.strokeStyle = colour;
      g.lineWidth = width * s;
      for (const line of L.walls || []) {
        g.beginPath();
        line.forEach((p, i) => (i ? g.lineTo(p[0] * s, p[1] * s) : g.moveTo(p[0] * s, p[1] * s)));
        g.stroke();
      }
    }

    // persistent fog: black everywhere, punched out as the player sees places
    const fs = 3;
    const fog = document.createElement('canvas');
    fog.width = Math.ceil(vw * fs);
    fog.height = Math.ceil(vh * fs);
    const fg = fog.getContext('2d');
    fg.fillStyle = '#000';
    fg.fillRect(0, 0, fog.width, fog.height);
    return { map: cv, fog, fogScale: fs };
  }

  /** carve the current view out of the fog so explored ground stays legible */
  rememberSeen(vis) {
    const fg = this.fog.getContext('2d');
    const s = this.fogScale;
    fg.save();
    fg.globalCompositeOperation = 'destination-out';
    fg.beginPath();
    vis.forEach((p, i) => (i ? fg.lineTo(p[0] * s, p[1] * s) : fg.moveTo(p[0] * s, p[1] * s)));
    fg.closePath();
    fg.fill();
    fg.restore();
  }

  // ---------------------------------------------------------
  worldToScreen(x, y) {
    return [
      (x - this.cam.x) * this.ppu + this.vw / 2,
      (y - this.cam.y) * this.ppu + this.vh / 2,
    ];
  }

  screenToWorld(sx, sy) {
    return [
      (sx - this.vw / 2) / this.ppu + this.cam.x,
      (sy - this.vh / 2) / this.ppu + this.cam.y,
    ];
  }

  setZoom(z) { this.ppu = clamp(z, 4.5, 22); }

  followCamera(px, py, dt) {
    const k = 1 - Math.pow(0.0016, dt);
    this.cam.x += (px - this.cam.x) * k;
    this.cam.y += (py - this.cam.y) * k;
  }

  // ---------------------------------------------------------
  /**
   * Visibility polygon by ray marching the nav grid.
   *
   * Two things keep the edge from crawling. The march itself is coarse, so
   * every hit used to land on a multiple of the step and the whole silhouette
   * snapped outward a third of a metre at a time as the player walked; a short
   * bisection after the break puts the vertex on the actual wall instead.
   * Even then a ray can flip between two sides of a corner on consecutive
   * frames, so each ray's length is eased toward its new value rather than
   * assigned. The angles are world-aligned and fixed, so ray i is always the
   * same direction and smoothing per index is meaningful.
   */
  visibility(nav, px, py, radius = 30, dt = 0, rays = 260) {
    if (!this.visR || this.visR.length !== rays) {
      this.visR = new Float32Array(rays);
      this.visWarm = false;
    }
    // Easing is one-sided. A ray that shortens has hit something, and letting
    // that lag would float the lit edge past the wall and bleed light through
    // it, so closing is instant. Only opening is eased, which is what turns a
    // corner flicking in and out into a soft sweep.
    const k = this.visWarm ? 1 - Math.exp(-Math.max(dt, 0.0001) / 0.05) : 1;

    const coarse = 0.4;
    const pts = [];
    for (let i = 0; i < rays; i++) {
      const a = (i / rays) * Math.PI * 2;
      const dx = Math.cos(a), dy = Math.sin(a);

      let d = 0;
      while (d + coarse < radius && nav.walkable(px + dx * (d + coarse), py + dy * (d + coarse))) {
        d += coarse;
      }
      // d is the last clear sample, d + coarse the first blocked one; close on
      // the boundary between them
      let lo = d, hi = Math.min(d + coarse, radius);
      for (let b = 0; b < 6; b++) {
        const mid = (lo + hi) * 0.5;
        if (nav.walkable(px + dx * mid, py + dy * mid)) lo = mid; else hi = mid;
      }

      const target = Math.min(lo, radius);
      const cur = this.visR[i];
      const r = target < cur ? target : cur + (target - cur) * k;
      this.visR[i] = r;
      pts.push([px + dx * r, py + dy * r]);
    }
    this.visWarm = true;
    return pts;
  }

  /** drop the smoothed silhouette so a new raid does not sweep out of the old one */
  resetVisibility() { this.visWarm = false; }

  // ---------------------------------------------------------
  draw(state) {
    const g = this.ctx;
    const { player, nav, containers, extracts, hover, path, seen, time } = state;

    // a tremor shakes the whole view a little. It is a nudge on the camera in
    // world units for the length of this frame — the same thing walking does
    // to it, which is cheap. (Not a translation on the base transform and not
    // a CSS transform on the canvas: both pushed the frame onto a software
    // re-raster path in testing and the loop fell to a crawl.)
    const fx = state.fx || {};
    const camX = this.cam.x, camY = this.cam.y;
    if (fx.tremor) {
      this.cam.x += (Math.sin(time * 37.3) + Math.sin(time * 23.1) * 0.6) * 0.09;
      this.cam.y += (Math.cos(time * 41.7) + Math.sin(time * 19.3) * 0.6) * 0.09;
    }
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.fillStyle = PAL.void;
    g.fillRect(0, 0, this.vw, this.vh);

    const s = this.ppu / this.mapScale;
    const [ox, oy] = this.worldToScreen(0, 0);

    // three-layer lighting:
    //   full map -> shroud everything -> extra fog where never seen ->
    //   restore full brightness inside the current line of sight
    g.drawImage(this.mapCanvas, ox, oy, this.mapCanvas.width * s, this.mapCanvas.height * s);

    const vis = this.visibility(nav, player.x, player.y, player.viewRange, state.dt || 0);
    this.rememberSeen(vis);

    g.fillStyle = 'rgba(2,5,7,.56)';
    g.fillRect(0, 0, this.vw, this.vh);

    g.save();
    g.globalAlpha = 0.55;
    const fs = this.ppu / this.fogScale;
    g.drawImage(this.fog, ox, oy, this.fog.width * fs, this.fog.height * fs);
    g.restore();

    // lit pass clipped to what the player can see right now
    g.save();
    g.beginPath();
    vis.forEach((p, i) => {
      const [sx, sy] = this.worldToScreen(p[0], p[1]);
      i ? g.lineTo(sx, sy) : g.moveTo(sx, sy);
    });
    g.closePath();
    g.clip();
    g.drawImage(this.mapCanvas, ox, oy, this.mapCanvas.width * s, this.mapCanvas.height * s);
    // warm the lit area very slightly
    g.globalCompositeOperation = 'lighter';
    const [px, py] = this.worldToScreen(player.x, player.y);
    const grad = g.createRadialGradient(px, py, 0, px, py, player.viewRange * this.ppu);
    grad.addColorStop(0, 'rgba(184,219,217,.10)');
    grad.addColorStop(1, 'rgba(184,219,217,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, this.vw, this.vh);
    g.restore();

    this.drawStairs(state.stairs || [], state.nearStairs, state.hoverStair);
    this.drawExtracts(extracts, state);
    this.drawTransits(state.transits || []);
    this.drawDoors(state.doors || [], state.hoverDoor);
    this.drawContainers(containers, vis, seen, hover);
    if (path && path.length) this.drawPath(player, path);
    this.drawScavs(state.scavs || [], nav, player, state.hoverEnemy);
    this.drawShots(state.shots || []);
    this.drawPlayer(player, time);
    this.drawEdgeVignette();
    this.drawConditions(fx, time);
    this.drawDamage(state);
    this.cam.x = camX;
    this.cam.y = camY;
  }

  /**
   * What the body does to the view. Pain pulses a dark rim in and out; a
   * critical pool beats it red in time with a heart; painkillers wash the
   * colour out of the edges (the game's black-and-white periphery); tunnel
   * vision closes the world down to the middle.
   */
  drawConditions(fx, time) {
    if (!fx) return;
    const g = this.ctx;
    const cx = this.vw / 2, cy = this.vh / 2;
    const rMin = Math.min(this.vw, this.vh), rMax = Math.max(this.vw, this.vh);
    const rim = (inner, outer, color, alpha) => {
      if (alpha <= 0.002) return;
      const grad = g.createRadialGradient(cx, cy, rMin * inner, cx, cy, rMax * outer);
      grad.addColorStop(0, `rgba(${color},0)`);
      grad.addColorStop(1, `rgba(${color},${alpha})`);
      g.fillStyle = grad;
      g.fillRect(0, 0, this.vw, this.vh);
    };
    // painkillers wash the colour out. A CSS filter on the canvas element,
    // not a 'saturation' blend in the drawing: the blend over a full frame is
    // a software pass that dropped the loop to a crawl.
    const filt = fx.pk ? 'saturate(.35) contrast(1.06)' : '';
    if (filt !== this.filterApplied) {
      this.canvas.style.filter = filt;
      this.filterApplied = filt;
    }
    if (fx.pain) {
      const a = 0.16 + 0.14 * Math.sin(time * 2.4);
      rim(0.42, 0.78, '46,18,14', a);
    }
    if (fx.tunnel) {
      const k = 0.5 + 0.5 * Math.sin(time * 1.6);
      rim(0.22 + 0.1 * k, 0.62 + 0.08 * k, '0,0,0', 0.75);
    }
    if (fx.ct) rim(0.5, 0.9, '30,30,36', 0.22);
    if (fx.lowHp) {
      // a double beat, the way a heart goes
      const t = (time * 1.35) % 1;
      const beat = Math.pow(Math.max(0, Math.sin(t * Math.PI * 2)), 10) + 0.55 * Math.pow(Math.max(0, Math.sin((t - 0.18) * Math.PI * 2)), 10);
      rim(0.4, 0.8, '160,30,22', 0.1 + 0.32 * Math.min(1, beat));
    }
  }

  drawScavs(scavs, nav, player, hoverEnemy = null) {
    const g = this.ctx;
    for (const s of scavs) {
      if (!s.alive) continue;
      const d = Math.hypot(s.x - player.x, s.y - player.y);
      const visible = d <= player.viewRange && nav.lineClear(player.x, player.y, s.x, s.y);
      if (!visible) continue;
      const [sx, sy] = this.worldToScreen(s.x, s.y);
      const r = 0.58 * this.ppu;

      // brackets show that a left click here opens fire rather than moving
      if (s === hoverEnemy) {
        g.save();
        g.strokeStyle = '#f0c1b8';
        g.lineWidth = 2;
        const b = r * 2.1, k = r * 0.8;
        for (const [mx, my] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
          g.beginPath();
          g.moveTo(sx + mx * b, sy + my * b - my * k);
          g.lineTo(sx + mx * b, sy + my * b);
          g.lineTo(sx + mx * b - mx * k, sy + my * b);
          g.stroke();
        }
        g.restore();
      }

      g.save();
      // engagement halo
      if (s.state !== 'patrol') {
        g.strokeStyle = 'rgba(194,96,79,.5)';
        g.lineWidth = 1;
        g.beginPath(); g.arc(sx, sy, r * 2.1, 0, Math.PI * 2); g.stroke();
      }
      g.fillStyle = s.hitFlash > 0 ? '#f0c1b8' : '#c2604f';
      g.strokeStyle = '#120806';
      g.lineWidth = 2;
      g.beginPath(); g.arc(sx, sy, r, 0, Math.PI * 2); g.fill(); g.stroke();
      g.fillStyle = '#2c1815';
      g.beginPath();
      g.arc(sx + Math.cos(s.facing) * r * 0.9, sy + Math.sin(s.facing) * r * 0.9, r * 0.32, 0, Math.PI * 2);
      g.fill();
      // health pip
      if (s.hp < s.maxHp) {
        const w = r * 2.2;
        g.fillStyle = 'rgba(0,0,0,.6)';
        g.fillRect(sx - w / 2, sy - r - 8, w, 3);
        g.fillStyle = '#d9a441';
        g.fillRect(sx - w / 2, sy - r - 8, w * (s.hp / s.maxHp), 3);
      }
      if (s.muzzle > 0) {
        g.fillStyle = `rgba(255,214,140,${s.muzzle * 0.85})`;
        const mx = sx + Math.cos(s.facing) * r * 1.5;
        const my = sy + Math.sin(s.facing) * r * 1.5;
        g.beginPath(); g.arc(mx, my, r * 0.6 * s.muzzle, 0, Math.PI * 2); g.fill();
      }
      g.restore();
    }
  }

  drawShots(shots) {
    const g = this.ctx;
    for (const s of shots) {
      const [ax, ay] = this.worldToScreen(s.from[0], s.from[1]);
      const [bx, by] = this.worldToScreen(s.to[0], s.to[1]);
      const a = Math.max(0, s.t / 0.12);
      g.save();
      g.strokeStyle = s.hostile
        ? `rgba(217,140,80,${a * 0.85})`
        : `rgba(184,219,217,${a * 0.9})`;
      g.lineWidth = s.hostile ? 1.4 : 1.8;
      g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx, by); g.stroke();
      if (s.hit) {
        g.strokeStyle = `rgba(244,244,249,${a})`;
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(bx - 5, by - 5); g.lineTo(bx + 5, by + 5);
        g.moveTo(bx + 5, by - 5); g.lineTo(bx - 5, by + 5);
        g.stroke();
      }
      g.restore();
    }
  }

  drawDamage(state) {
    const p = state.player;
    if (p.lastHitAt == null) return;
    const since = state.rawTime - p.lastHitAt;
    if (since > 0.9 || since < 0) return;
    const a = (1 - since / 0.9) * 0.5;
    const g = this.ctx;
    const grad = g.createRadialGradient(
      this.vw / 2, this.vh / 2, Math.min(this.vw, this.vh) * 0.3,
      this.vw / 2, this.vh / 2, Math.max(this.vw, this.vh) * 0.7);
    grad.addColorStop(0, 'rgba(194,96,79,0)');
    grad.addColorStop(1, `rgba(194,96,79,${a})`);
    g.fillStyle = grad;
    g.fillRect(0, 0, this.vw, this.vh);
  }

  drawPath(player, path) {
    const g = this.ctx;
    g.save();
    g.strokeStyle = 'rgba(184,219,217,.45)';
    g.setLineDash([5, 6]);
    g.lineWidth = 1.5;
    g.beginPath();
    let [sx, sy] = this.worldToScreen(player.x, player.y);
    g.moveTo(sx, sy);
    for (const p of path) {
      [sx, sy] = this.worldToScreen(p[0], p[1]);
      g.lineTo(sx, sy);
    }
    g.stroke();
    g.setLineDash([]);
    const last = path[path.length - 1];
    const [lx, ly] = this.worldToScreen(last[0], last[1]);
    g.strokeStyle = 'rgba(184,219,217,.75)';
    g.beginPath(); g.arc(lx, ly, 5, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.moveTo(lx - 8, ly); g.lineTo(lx + 8, ly);
    g.moveTo(lx, ly - 8); g.lineTo(lx, ly + 8); g.stroke();
    g.restore();
  }

  drawExtracts(extracts, state) {
    const g = this.ctx;
    for (const ex of extracts) {
      const [sx, sy] = this.worldToScreen(ex.x, ex.y);
      const r = ex.r * this.ppu;
      if (sx < -r - 60 || sy < -r - 60 || sx > this.vw + r + 60 || sy > this.vh + r + 60) continue;
      const usable = ex.faction !== 'scav';
      const active = state.nearExtract === ex;
      g.save();
      g.strokeStyle = active ? '#7fb39a' : usable ? 'rgba(127,179,154,.55)' : 'rgba(217,164,65,.45)';
      g.fillStyle = active ? 'rgba(127,179,154,.16)'
        : usable ? 'rgba(127,179,154,.07)' : 'rgba(217,164,65,.05)';
      g.lineWidth = active ? 2.5 : 1.6;
      g.setLineDash(active ? [] : [6, 5]);
      g.beginPath(); g.arc(sx, sy, r, 0, Math.PI * 2); g.fill(); g.stroke();
      g.setLineDash([]);
      g.fillStyle = active ? '#d6efee' : usable ? 'rgba(184,219,217,.72)' : 'rgba(217,164,65,.6)';
      g.font = '600 11px Bahnschrift, system-ui, sans-serif';
      g.textAlign = 'center';
      g.fillText(ex.name.toUpperCase(), sx, sy - r - 7);
      g.font = '10px Bahnschrift, system-ui, sans-serif';
      if (!usable) {
        g.fillStyle = 'rgba(217,164,65,.7)';
        g.fillText('SCAVS ONLY', sx, sy + r + 14);
      } else if (ex.req) {
        // the label answers the question the player actually has: can I use it
        const carried = state.keyed && state.keyed.has(ex);
        g.fillStyle = carried ? 'rgba(127,179,154,.9)' : 'rgba(217,164,65,.85)';
        g.fillText(carried ? 'READY' : `NEEDS ${(ex.reqName || 'AN ITEM').toUpperCase()}`,
                   sx, sy + r + 14);
      }
      g.restore();
    }
  }

  /**
   * A door is drawn as the leaf itself: a bar across the opening when it is
   * shut, swung back against the jamb when it is open. Colour carries the one
   * thing the player needs at a glance — amber for a door that just opens,
   * red for one that wants a key you are not carrying, green once you are.
   */
  drawDoors(doors, hoverDoor) {
    const g = this.ctx;
    for (const d of doors) {
      const [sx, sy] = this.worldToScreen(d.x, d.y);
      const half = (d.w / 2 + 0.22) * this.ppu;
      if (sx < -60 || sy < -60 || sx > this.vw + 60 || sy > this.vh + 60) continue;
      const breach = d.state === 'breach';
      const locked = breach || (d.state === 'key' && !d.canOpen);
      const keyed = d.state === 'key' || breach;
      const col = d.open ? PAL.doorOpen : locked ? PAL.doorLocked : keyed ? PAL.doorKeyed : PAL.doorShut;
      g.save();
      g.translate(sx, sy);
      // an open leaf is folded back a quarter turn against its own hinge
      g.rotate(d.a + (d.open ? Math.PI / 2 : 0));
      g.strokeStyle = col;
      g.lineWidth = d === hoverDoor ? 5 : 3.4;
      g.lineCap = 'butt';
      g.beginPath();
      g.moveTo(d.open ? 0 : -half, 0);
      g.lineTo(d.open ? half : half, 0);
      g.stroke();
      // the jambs, so a doorway still reads once the leaf has swung away
      g.strokeStyle = 'rgba(11,17,20,.9)';
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(-half, -2); g.lineTo(-half, 2);
      g.moveTo(half, -2); g.lineTo(half, 2);
      g.stroke();
      g.restore();

      if (keyed && !d.open) {
        g.save();
        g.fillStyle = locked ? 'rgba(194,96,79,.9)' : 'rgba(127,179,154,.9)';
        g.font = '600 10px Bahnschrift, system-ui, sans-serif';
        g.textAlign = 'center';
        g.fillText(breach ? 'FORCE' : locked ? 'LOCKED' : 'KEY', sx, sy - half - 6);
        g.restore();
      }
      if (d === hoverDoor) {
        g.save();
        g.fillStyle = '#e8f4f3';
        g.font = '600 11px Bahnschrift, system-ui, sans-serif';
        g.textAlign = 'center';
        g.fillText(d.name.toUpperCase(), sx, sy + half + 14);
        g.restore();
      }
    }
  }

  /** the stairwells that reach this floor, and which way they go */
  drawStairs(stairs, nearStairs, hoverStair) {
    const g = this.ctx;
    for (const s of stairs) {
      const [ax, ay] = this.worldToScreen(s.rect[0], s.rect[1]);
      const [bx, by] = this.worldToScreen(s.rect[2], s.rect[3]);
      if (bx < -40 || by < -40 || ax > this.vw + 40 || ay > this.vh + 40) continue;
      const active = s === nearStairs;
      g.save();
      g.strokeStyle = active ? '#e8c46a' : s === hoverStair ? '#d9a441' : 'rgba(217,164,65,.5)';
      g.lineWidth = active ? 2.6 : 1.6;
      g.setLineDash(active ? [] : [4, 4]);
      g.strokeRect(ax, ay, bx - ax, by - ay);
      g.setLineDash([]);
      g.fillStyle = active ? '#e8c46a' : 'rgba(217,164,65,.75)';
      g.font = '600 10px Bahnschrift, system-ui, sans-serif';
      g.textAlign = 'center';
      g.fillText(s.label || 'STAIRS', (ax + bx) / 2, ay - 4);
      g.restore();
    }
  }

  drawTransits(transits) {
    const g = this.ctx;
    for (const t of transits) {
      const [sx, sy] = this.worldToScreen(t.x, t.y);
      const r = t.r * this.ppu;
      if (sx < -r - 60 || sy < -r - 60 || sx > this.vw + r + 60 || sy > this.vh + r + 60) continue;
      g.save();
      g.strokeStyle = 'rgba(150,130,200,.55)';
      g.fillStyle = 'rgba(150,130,200,.06)';
      g.lineWidth = 1.5;
      g.setLineDash([3, 4]);
      g.beginPath(); g.arc(sx, sy, r, 0, Math.PI * 2); g.fill(); g.stroke();
      g.setLineDash([]);
      g.fillStyle = 'rgba(178,160,220,.75)';
      g.font = '10px Bahnschrift, system-ui, sans-serif';
      g.textAlign = 'center';
      g.fillText(t.name.toUpperCase(), sx, sy - r - 6);
      g.restore();
    }
  }

  drawContainers(containers, vis, seen, hover) {
    const g = this.ctx;
    for (const c of containers) {
      if (!seen.has(c.id)) continue;
      const [sx, sy] = this.worldToScreen(c.x, c.y);
      if (sx < -40 || sy < -40 || sx > this.vw + 40 || sy > this.vh + 40) continue;
      const r = 0.85 * this.ppu;
      const isHover = hover === c;
      g.save();
      g.translate(sx, sy);
      g.rotate(c.rot || 0);
      g.fillStyle = c.searched ? 'rgba(47,69,80,.85)' : 'rgba(88,111,124,.95)';
      g.strokeStyle = isHover ? '#b8dbd9' : c.searched ? 'rgba(184,219,217,.35)' : 'rgba(217,164,65,.8)';
      g.lineWidth = isHover ? 2.2 : 1.4;
      g.beginPath();
      g.rect(-r, -r * 0.7, r * 2, r * 1.4);
      g.fill(); g.stroke();
      if (!c.searched) {
        g.strokeStyle = 'rgba(217,164,65,.55)';
        g.lineWidth = 1;
        g.beginPath(); g.moveTo(-r * 0.5, 0); g.lineTo(r * 0.5, 0); g.stroke();
      }
      g.restore();
      if (isHover) {
        g.save();
        g.fillStyle = '#e8f4f3';
        g.font = '600 11px Bahnschrift, system-ui, sans-serif';
        g.textAlign = 'center';
        g.fillText(c.def.name.toUpperCase(), sx, sy - r - 8);
        g.restore();
      }
    }
  }

  drawPlayer(player, time) {
    const g = this.ctx;
    const [sx, sy] = this.worldToScreen(player.x, player.y);
    const r = 0.62 * this.ppu;
    g.save();
    // facing cone
    g.translate(sx, sy);
    g.rotate(player.facing);
    const cone = g.createRadialGradient(0, 0, r, 0, 0, player.viewRange * this.ppu * 0.75);
    cone.addColorStop(0, 'rgba(184,219,217,.18)');
    cone.addColorStop(1, 'rgba(184,219,217,0)');
    g.fillStyle = cone;
    g.beginPath();
    g.moveTo(0, 0);
    g.arc(0, 0, player.viewRange * this.ppu * 0.75, -0.62, 0.62);
    g.closePath();
    g.fill();
    g.restore();

    // body
    g.save();
    if (player.moving) {
      const pulse = 0.5 + 0.5 * Math.sin(time * 9);
      g.strokeStyle = `rgba(184,219,217,${0.16 + pulse * 0.12})`;
      g.lineWidth = 1;
      g.beginPath(); g.arc(sx, sy, r * 1.9, 0, Math.PI * 2); g.stroke();
    }
    g.fillStyle = '#b8dbd9';
    g.strokeStyle = '#05080a';
    g.lineWidth = 2;
    g.beginPath(); g.arc(sx, sy, r, 0, Math.PI * 2); g.fill(); g.stroke();
    // facing nub
    g.fillStyle = '#f4f4f9';
    g.beginPath();
    g.arc(sx + Math.cos(player.facing) * r * 0.95, sy + Math.sin(player.facing) * r * 0.95, r * 0.34, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }

  drawEdgeVignette() {
    const g = this.ctx;
    const grad = g.createRadialGradient(
      this.vw / 2, this.vh / 2, Math.min(this.vw, this.vh) * 0.5,
      this.vw / 2, this.vh / 2, Math.max(this.vw, this.vh) * 0.85);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(0,0,0,.38)');
    g.fillStyle = grad;
    g.fillRect(0, 0, this.vw, this.vh);
  }
}
