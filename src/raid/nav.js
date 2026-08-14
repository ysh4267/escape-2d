// =========================================================
// navigation: rasterise the map geometry into a walkability grid,
// then A* over it with a line-of-sight smoothing pass.
//
// The SVG's Floor group is a single even-odd path, so a scanline fill over
// all of its rings reproduces exactly the surface you can stand on. Obstacles,
// the round reactor units and raised plinths are then punched back out, and
// wall centrelines are stamped with a thickness.
// =========================================================

export const CELL = 0.35;         // svg units per nav cell
const WALL_HALF = 0.22;           // half thickness stamped for wall centrelines
const AGENT_PAD = 0.34;           // how far the player's centre stays off geometry

export class NavGrid {
  constructor(geo, levelKey = 'ground', doors = []) {
    const L = geo.levels[levelKey];
    this.level = L;
    this.levelKey = levelKey;
    const [, , vw, vh] = geo.viewBox;
    this.ox = 0;
    this.oy = 0;
    this.w = Math.ceil(vw / CELL);
    this.h = Math.ceil(vh / CELL);
    this.open = new Uint8Array(this.w * this.h);   // 1 = standable surface
    this.walk = new Uint8Array(this.w * this.h);   // 1 = the player centre may occupy

    fillPolys(this, L.floor, 1, true);
    for (const p of L.obstacles || []) fillPolys(this, [p], 0, false);
    for (const p of L.building || []) fillPolys(this, [p], 0, false);
    for (const p of L.ledge || []) fillPolys(this, [p], 0, false);
    for (const line of L.walls || []) stampPolyline(this, line, WALL_HALF);

    this.erode(AGENT_PAD);
    this.bridges = this.bridgeComponents();
    this.buildCost();
    this.installDoors(doors);
  }

  /**
   * Doors sit on top of the static grid rather than inside it.
   *
   * A door owns the handful of cells that fill its own opening. While it is
   * shut those cells are not walkable, which blocks movement and, because the
   * visibility sweep marches the same mask, blocks sight through it as well.
   * Opening one is a flag flip, no rebuild — the eroded grid, the bridges and
   * the movement costs underneath never change.
   */
  installDoors(doors) {
    this.doors = doors || [];
    this.doorAt = new Int16Array(this.w * this.h).fill(-1);
    this.doorOpen = new Uint8Array(this.doors.length);
    this.doorPassable = new Uint8Array(this.doors.length);
    this.doorCells = this.doors.map(() => []);

    this.doors.forEach((d, i) => {
      // the leaf spans the opening; pad it out to the wall faces on both sides
      // so a shut door actually seals rather than leaving a sliver to slip past
      const half = d.w / 2 + WALL_HALF + AGENT_PAD;
      const nx = Math.cos(d.a), ny = Math.sin(d.a);
      const [cx0, cy0] = this.toCell(d.x - nx * half, d.y - ny * half);
      const [cx1, cy1] = this.toCell(d.x + nx * half, d.y + ny * half);
      const r = Math.ceil((WALL_HALF + AGENT_PAD) / CELL) + 1;
      const lo = [Math.min(cx0, cx1) - r, Math.min(cy0, cy1) - r];
      const hi = [Math.max(cx0, cx1) + r, Math.max(cy0, cy1) + r];
      for (let cy = lo[1]; cy <= hi[1]; cy++) {
        for (let cx = lo[0]; cx <= hi[0]; cx++) {
          if (!this.inBounds(cx, cy)) continue;
          const idx = this.idx(cx, cy);
          if (!this.walk[idx] || this.doorAt[idx] !== -1) continue;
          const [wx, wy] = this.toWorld(cx, cy);
          if (distToSegment(wx, wy, d.x - nx * half, d.y - ny * half,
                            d.x + nx * half, d.y + ny * half) > CELL * 0.9) continue;
          this.doorAt[idx] = i;
          this.doorCells[i].push(idx);
        }
      }
      this.doorOpen[i] = d.open ? 1 : 0;
      this.doorPassable[i] = d.state === 'locked' ? 0 : 1;
    });
  }

  setDoorOpen(i, open) { if (this.doorOpen) this.doorOpen[i] = open ? 1 : 0; }

  /** can the player get through this door at all right now (key in hand, say) */
  setDoorPassable(i, ok) { if (this.doorPassable) this.doorPassable[i] = ok ? 1 : 0; }

  /** the door owning a world point, or -1 */
  doorIndexAt(x, y) {
    const [cx, cy] = this.toCell(x, y);
    if (!this.inBounds(cx, cy)) return -1;
    return this.doorAt ? this.doorAt[this.idx(cx, cy)] : -1;
  }

  /**
   * Label 4-connected components of the walkable mask.
   * Returns { comp: Int32Array, sizes: number[] }.
   */
  components() {
    const { w, h, walk } = this;
    const comp = new Int32Array(w * h).fill(-1);
    const sizes = [];
    const stack = [];
    for (let i = 0; i < walk.length; i++) {
      if (!walk[i] || comp[i] !== -1) continue;
      const id = sizes.length;
      let n = 0;
      stack.length = 0;
      stack.push(i);
      comp[i] = id;
      while (stack.length) {
        const cur = stack.pop();
        n++;
        const cx = cur % w, cy = (cur / w) | 0;
        if (cx > 0 && walk[cur - 1] && comp[cur - 1] === -1) { comp[cur - 1] = id; stack.push(cur - 1); }
        if (cx < w - 1 && walk[cur + 1] && comp[cur + 1] === -1) { comp[cur + 1] = id; stack.push(cur + 1); }
        if (cy > 0 && walk[cur - w] && comp[cur - w] === -1) { comp[cur - w] = id; stack.push(cur - w); }
        if (cy < h - 1 && walk[cur + w] && comp[cur + w] === -1) { comp[cur + w] = id; stack.push(cur + w); }
      }
      sizes.push(n);
    }
    return { comp, sizes };
  }

  /**
   * The vector map draws doors and jump-through windows as breaks in the wall
   * lines, but a few areas (the west courtyard in particular) end up as their
   * own floor islands once the player radius is accounted for. Carve the
   * shortest connection from each sizeable island back to the main body so
   * every extract stays reachable.
   */
  bridgeComponents(minIslandCells = 60, maxGapCells = 22, radius = 0.6) {
    const { w, h, walk } = this;
    const carved = [];
    for (let pass = 0; pass < 6; pass++) {
      const { comp, sizes } = this.components();
      if (sizes.length <= 1) break;
      let mainId = 0;
      for (let i = 1; i < sizes.length; i++) if (sizes[i] > sizes[mainId]) mainId = i;

      const islands = sizes
        .map((n, id) => ({ n, id }))
        .filter((c) => c.id !== mainId && c.n >= minIslandCells);
      if (!islands.length) break;

      // multi-source BFS outward from the main component across all cells
      const dist = new Int32Array(w * h).fill(-1);
      const parent = new Int32Array(w * h).fill(-1);
      const queue = new Int32Array(w * h);
      let qh = 0, qt = 0;
      for (let i = 0; i < comp.length; i++) {
        if (comp[i] === mainId) { dist[i] = 0; queue[qt++] = i; }
      }
      while (qh < qt) {
        const cur = queue[qh++];
        if (dist[cur] >= maxGapCells) continue;
        const cx = cur % w, cy = (cur / w) | 0;
        const push = (ni) => {
          if (dist[ni] !== -1) return;
          dist[ni] = dist[cur] + 1;
          parent[ni] = cur;
          queue[qt++] = ni;
        };
        if (cx > 0) push(cur - 1);
        if (cx < w - 1) push(cur + 1);
        if (cy > 0) push(cur - w);
        if (cy < h - 1) push(cur + w);
      }

      let progressed = false;
      for (const island of islands) {
        let best = -1, bestD = Infinity;
        for (let i = 0; i < comp.length; i++) {
          if (comp[i] !== island.id) continue;
          const d = dist[i];
          if (d >= 0 && d < bestD) { bestD = d; best = i; }
        }
        if (best < 0 || bestD > maxGapCells) continue;
        // walk the BFS chain back to the main body, opening it as we go
        let cur = best;
        const pts = [];
        while (cur !== -1 && dist[cur] > 0) { pts.push(cur); cur = parent[cur]; }
        if (cur !== -1) pts.push(cur);
        const r = Math.max(1, Math.round(radius / CELL));
        for (const ci of pts) {
          const cx = ci % w, cy = (ci / w) | 0;
          for (let dy = -r; dy <= r; dy++) {
            for (let dx = -r; dx <= r; dx++) {
              const nx = cx + dx, ny = cy + dy;
              if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
              if (dx * dx + dy * dy > r * r) continue;
              const ni = ny * w + nx;
              walk[ni] = 1;
              this.open[ni] = 1;
              if (this.dist) this.dist[ni] = Math.max(this.dist[ni], r);
            }
          }
        }
        const [wx, wy] = this.toWorld(best % w, (best / w) | 0);
        carved.push({ x: +wx.toFixed(2), y: +wy.toFixed(2), cells: pts.length, island: island.n });
        progressed = true;
      }
      if (!progressed) break;
    }
    return carved;
  }

  idx(cx, cy) { return cy * this.w + cx; }
  inBounds(cx, cy) { return cx >= 0 && cy >= 0 && cx < this.w && cy < this.h; }

  toCell(x, y) { return [Math.floor(x / CELL), Math.floor(y / CELL)]; }
  toWorld(cx, cy) { return [(cx + 0.5) * CELL, (cy + 0.5) * CELL]; }

  /** shrink the open set so the player's radius never clips geometry */
  erode(pad) {
    const r = Math.max(1, Math.round(pad / CELL));
    const { w, h, open, walk } = this;
    // distance-to-blocked via two-pass chamfer on the open mask
    const dist = new Int32Array(w * h).fill(1 << 20);
    for (let i = 0; i < open.length; i++) if (!open[i]) dist[i] = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        let d = dist[i];
        if (x > 0) d = Math.min(d, dist[i - 1] + 1);
        if (y > 0) d = Math.min(d, dist[i - w] + 1);
        if (x > 0 && y > 0) d = Math.min(d, dist[i - w - 1] + 1);
        if (x < w - 1 && y > 0) d = Math.min(d, dist[i - w + 1] + 1);
        dist[i] = d;
      }
    }
    for (let y = h - 1; y >= 0; y--) {
      for (let x = w - 1; x >= 0; x--) {
        const i = y * w + x;
        let d = dist[i];
        if (x < w - 1) d = Math.min(d, dist[i + 1] + 1);
        if (y < h - 1) d = Math.min(d, dist[i + w] + 1);
        if (x < w - 1 && y < h - 1) d = Math.min(d, dist[i + w + 1] + 1);
        if (x > 0 && y < h - 1) d = Math.min(d, dist[i + w - 1] + 1);
        dist[i] = d;
      }
    }
    this.dist = dist;
    for (let i = 0; i < walk.length; i++) walk[i] = dist[i] >= r ? 1 : 0;
    // if erosion sealed a doorway completely, fall back to the raw surface there
    let any = 0;
    for (let i = 0; i < walk.length; i++) any += walk[i];
    if (any < 200) this.walk = open.slice();
  }

  /** prefer routes away from walls so the player hugs open floor */
  buildCost() {
    const n = this.walk.length;
    this.cost = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const d = this.dist ? this.dist[i] : 8;
      this.cost[i] = d >= 6 ? 1 : 1 + (6 - d) * 0.16;
    }
  }

  walkable(x, y) {
    const [cx, cy] = this.toCell(x, y);
    return this.cellWalkable(cx, cy);
  }

  cellWalkable(cx, cy) {
    if (!this.inBounds(cx, cy)) return false;
    const i = this.idx(cx, cy);
    if (this.walk[i] !== 1) return false;
    const d = this.doorAt ? this.doorAt[i] : -1;
    return d === -1 || this.doorOpen[d] === 1;
  }

  /**
   * Route planning is allowed to count on a door the player could open on the
   * way — otherwise every shut door would read as a wall and half the plant
   * would look unreachable. A door with no key in the player's hands, or one
   * that never opens at all, stays a wall here too.
   */
  cellPathable(i) {
    if (this.walk[i] !== 1) return false;
    const d = this.doorAt ? this.doorAt[i] : -1;
    return d === -1 || this.doorOpen[d] === 1 || this.doorPassable[d] === 1;
  }

  /** nearest walkable cell centre to an arbitrary point, searched in rings */
  snap(x, y, maxRings = 60) { return this.snapWith(x, y, maxRings, false); }

  /**
   * The same search, but a shut-yet-openable door still counts as floor.
   * Snapping a destination with the strict test would drag a click made in the
   * room behind a door back through the doorway to this side of it, and the
   * player would walk up to the door and stop.
   */
  snapPathable(x, y, maxRings = 60) { return this.snapWith(x, y, maxRings, true); }

  snapWith(x, y, maxRings, loose) {
    const ok = (cx, cy) => (loose
      ? this.inBounds(cx, cy) && this.cellPathable(this.idx(cx, cy))
      : this.cellWalkable(cx, cy));
    let [cx, cy] = this.toCell(x, y);
    cx = Math.max(0, Math.min(this.w - 1, cx));
    cy = Math.max(0, Math.min(this.h - 1, cy));
    if (ok(cx, cy)) return this.toWorld(cx, cy);
    for (let r = 1; r <= maxRings; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const nx = cx + dx, ny = cy + dy;
          if (ok(nx, ny)) return this.toWorld(nx, ny);
        }
      }
    }
    return null;
  }

  /** unobstructed straight line between two world points */
  lineClear(x0, y0, x1, y1) {
    const steps = Math.ceil(Math.hypot(x1 - x0, y1 - y0) / (CELL * 0.5));
    for (let i = 0; i <= steps; i++) {
      const t = steps ? i / steps : 0;
      if (!this.walkable(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t)) return false;
    }
    return true;
  }

  /** A* -> array of world-space waypoints (excluding the start), or null */
  findPath(sx, sy, tx, ty) {
    const s = this.snapPathable(sx, sy);
    const t = this.snapPathable(tx, ty);
    if (!s || !t) return null;
    const [scx, scy] = this.toCell(s[0], s[1]);
    const [tcx, tcy] = this.toCell(t[0], t[1]);
    if (scx === tcx && scy === tcy) return [[t[0], t[1]]];
    if (this.lineClear(sx, sy, t[0], t[1])) return [[t[0], t[1]]];

    const { w, h, cost } = this;
    const pass = (i) => this.cellPathable(i);
    const n = w * h;
    const startI = scy * w + scx;
    const goalI = tcy * w + tcx;

    const g = new Float32Array(n).fill(Infinity);
    const f = new Float32Array(n).fill(Infinity);
    const from = new Int32Array(n).fill(-1);
    const closed = new Uint8Array(n);
    const heap = new BinaryHeap();

    const hcost = (i) => {
      const cx = i % w, cy = (i / w) | 0;
      const dx = Math.abs(cx - tcx), dy = Math.abs(cy - tcy);
      return (dx + dy) + (Math.SQRT2 - 2) * Math.min(dx, dy);
    };

    g[startI] = 0;
    f[startI] = hcost(startI);
    heap.push(startI, f[startI]);

    const NB = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
                [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];

    let guard = 0;
    while (heap.size && guard++ < 400000) {
      const cur = heap.pop();
      if (cur === goalI) return this.reconstruct(from, cur, tx, ty);
      if (closed[cur]) continue;
      closed[cur] = 1;
      const cx = cur % w, cy = (cur / w) | 0;

      for (const [dx, dy, base] of NB) {
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const ni = ny * w + nx;
        if (closed[ni] || !pass(ni)) continue;
        // no cutting diagonal corners through geometry
        if (dx && dy && (!pass(cy * w + nx) || !pass(ny * w + cx))) continue;
        const step = base * cost[ni];
        const ng = g[cur] + step;
        if (ng < g[ni]) {
          g[ni] = ng;
          from[ni] = cur;
          f[ni] = ng + hcost(ni);
          heap.push(ni, f[ni]);
        }
      }
    }
    return null;
  }

  reconstruct(from, goalI, tx, ty) {
    const cells = [];
    let cur = goalI;
    while (cur !== -1) { cells.push(cur); cur = from[cur]; }
    cells.reverse();
    const pts = cells.map((i) => this.toWorld(i % this.w, (i / this.w) | 0));
    const snapped = this.snapPathable(tx, ty);
    if (snapped) pts.push(snapped);
    return smooth(this, pts);
  }
}

// ---------------------------------------------------------
function distToSegment(px, py, x0, y0, x1, y1) {
  const dx = x1 - x0, dy = y1 - y0;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((px - x0) * dx + (py - y0) * dy) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(px - (x0 + dx * t), py - (y0 + dy * t));
}

// ---------------------------------------------------------
function smooth(nav, pts) {
  if (pts.length <= 2) return pts.slice(1);
  const out = [];
  let anchor = 0;
  for (let i = 2; i < pts.length; i++) {
    if (!nav.lineClear(pts[anchor][0], pts[anchor][1], pts[i][0], pts[i][1])) {
      out.push(pts[i - 1]);
      anchor = i - 1;
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

// ---------------------------------------------------------
// rasterisation
// ---------------------------------------------------------
function fillPolys(grid, polys, value, evenOdd) {
  if (!polys || !polys.length) return;
  const edges = [];
  for (const poly of polys) {
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      if (a[1] === b[1]) continue;
      edges.push([a[0], a[1], b[0], b[1]]);
    }
  }
  if (!edges.length) return;

  const xs = [];
  for (let cy = 0; cy < grid.h; cy++) {
    const y = (cy + 0.5) * CELL;
    xs.length = 0;
    for (const [x0, y0, x1, y1] of edges) {
      if ((y >= y0 && y < y1) || (y >= y1 && y < y0)) {
        xs.push(x0 + ((y - y0) / (y1 - y0)) * (x1 - x0));
      }
    }
    if (xs.length < 2) continue;
    xs.sort((a, b) => a - b);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const sx = Math.max(0, Math.ceil(xs[i] / CELL - 0.5));
      const ex = Math.min(grid.w - 1, Math.floor(xs[i + 1] / CELL - 0.5));
      const row = cy * grid.w;
      for (let cx = sx; cx <= ex; cx++) grid.open[row + cx] = value;
    }
  }
  void evenOdd;
}

function stampPolyline(grid, pts, half) {
  for (let i = 0; i + 1 < pts.length; i++) {
    stampSegment(grid, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], half);
  }
}

/**
 * Block every cell whose centre is within `half` of the segment.
 *
 * Stamping square blobs around sampled points used to overshoot past the
 * segment ends, which quietly sealed every doorway on the map; the exact
 * point-to-segment distance keeps openings open.
 */
function stampSegment(grid, x0, y0, x1, y1, half) {
  const minX = Math.max(0, Math.floor((Math.min(x0, x1) - half) / CELL));
  const maxX = Math.min(grid.w - 1, Math.ceil((Math.max(x0, x1) + half) / CELL));
  const minY = Math.max(0, Math.floor((Math.min(y0, y1) - half) / CELL));
  const maxY = Math.min(grid.h - 1, Math.ceil((Math.max(y0, y1) + half) / CELL));
  const dx = x1 - x0, dy = y1 - y0;
  const len2 = dx * dx + dy * dy;
  const h2 = half * half;

  for (let cy = minY; cy <= maxY; cy++) {
    const py = (cy + 0.5) * CELL;
    for (let cx = minX; cx <= maxX; cx++) {
      const px = (cx + 0.5) * CELL;
      let t = len2 > 0 ? ((px - x0) * dx + (py - y0) * dy) / len2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const qx = x0 + dx * t, qy = y0 + dy * t;
      const d2 = (px - qx) ** 2 + (py - qy) ** 2;
      if (d2 <= h2) grid.open[cy * grid.w + cx] = 0;
    }
  }
}

// ---------------------------------------------------------
class BinaryHeap {
  constructor() { this.items = []; this.prio = []; }
  get size() { return this.items.length; }
  push(item, p) {
    this.items.push(item); this.prio.push(p);
    let i = this.items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.prio[parent] <= this.prio[i]) break;
      this.swap(i, parent); i = parent;
    }
  }
  pop() {
    const top = this.items[0];
    const lastItem = this.items.pop();
    const lastPrio = this.prio.pop();
    if (this.items.length) {
      this.items[0] = lastItem; this.prio[0] = lastPrio;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < this.items.length && this.prio[l] < this.prio[m]) m = l;
        if (r < this.items.length && this.prio[r] < this.prio[m]) m = r;
        if (m === i) break;
        this.swap(i, m); i = m;
      }
    }
    return top;
  }
  swap(a, b) {
    [this.items[a], this.items[b]] = [this.items[b], this.items[a]];
    [this.prio[a], this.prio[b]] = [this.prio[b], this.prio[a]];
  }
}

// ---------------------------------------------------------
export async function loadGeometry(file = 'map-factory.json') {
  const res = await fetch(new URL(`../data/${file}`, import.meta.url));
  if (!res.ok) throw new Error(`${file}: ${res.status}`);
  return res.json();
}
