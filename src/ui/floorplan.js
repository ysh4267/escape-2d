// =========================================================
// floor plan
//
// The raid view is a torchlit slice of one room. This is the other thing a
// player needs: the plan of the storey they are standing on, drawn the way a
// plant's own drawings are - walls, rooms, doors, stairs, and the way out.
//
// One plan is baked per storey and kept, so flipping between floors is
// instant. Walking up a staircase repaints the panel with the floor you
// arrived on; the strip along the top lets you read any of the others without
// leaving the one you are on.
// =========================================================

import { $, el } from '../core/util.js';
import { areaAt } from '../data/maps.js';
import { WALL_W } from '../raid/nav.js';

const PAD = 3;                    // svg units of margin around the drawing

const PLAN = {
  paper: '#0c1519',
  floor: '#1b2a31',
  floorEdge: '#5c7d86',
  solid: '#101c22',
  solidEdge: '#3d545d',
  wall: '#c3dde2',
  wallCase: '#050b0e',
  stairs: '#d9a441',
  grid: 'rgba(159,192,198,.07)',
  text: '#8fa9ae',
  title: '#d6efee',
  doorFree: '#c98f4a',
  doorKey: '#7fb39a',
  doorLocked: '#c2604f',
  exitPmc: '#7fb39a',
  exitScav: '#d9a441',
  transit: '#9a86c8',
  player: '#b8dbd9',
  seen: 'rgba(217,164,65,.85)',
  searched: 'rgba(120,146,158,.6)',
};

let host = null;
let canvas = null;
let ctx = null;
let strip = null;
let titleEl = null;
let raidRef = null;
let shown = 'ground';
let baked = new Map();
let open = false;

// ---------------------------------------------------------
export function initFloorplan() {
  host = $('#floorplan');
  canvas = $('#floorplan-canvas');
  ctx = canvas.getContext('2d');
  strip = $('#floorplan-levels');
  titleEl = $('#floorplan-title');
  $('#btn-close-map').addEventListener('click', closeFloorplan);
  host.addEventListener('pointerdown', (e) => { if (e.target === host) closeFloorplan(); });
}

export function attachRaid(raid) {
  raidRef = raid;
  baked = new Map();
  shown = raid.level;
  buildStrip();
}

export function floorplanOpen() { return open; }

export function openFloorplan() {
  if (!raidRef) return;
  open = true;
  shown = raidRef.level;
  host.hidden = false;
  buildStrip();
  drawFloorplan();
}

export function closeFloorplan() {
  open = false;
  if (host) host.hidden = true;
}

export function toggleFloorplan() {
  open ? closeFloorplan() : openFloorplan();
}

/** the player changed storey: follow them */
export function floorplanFollow(level) {
  shown = level;
  buildStrip();
  if (open) drawFloorplan();
}

// ---------------------------------------------------------
function buildStrip() {
  if (!strip || !raidRef) return;
  strip.replaceChildren();
  // top floor first, so the strip reads like a section through the building
  for (const lvl of [...raidRef.map.levels].reverse()) {
    const here = raidRef.level === lvl.key;
    const btn = el('button', {
      class: `plan-tab${shown === lvl.key ? ' is-on' : ''}${here ? ' is-here' : ''}`,
      title: lvl.name,
    }, lvl.short);
    btn.addEventListener('click', () => {
      shown = lvl.key;
      buildStrip();
      drawFloorplan();
    });
    strip.append(btn);
  }
}

// ---------------------------------------------------------
/** the static drawing of one storey, at `scale` px per svg unit */
function bake(level, scale) {
  const key = `${level}@${scale.toFixed(2)}`;
  const hit = baked.get(key);
  if (hit) return hit;

  const geo = raidRef.geo;
  const L = geo.levels[level];
  const b = padded(L.bounds);
  const cv = document.createElement('canvas');
  cv.width = Math.ceil((b[2] - b[0]) * scale);
  cv.height = Math.ceil((b[3] - b[1]) * scale);
  const g = cv.getContext('2d');
  const X = (v) => (v - b[0]) * scale;
  const Y = (v) => (v - b[1]) * scale;

  g.fillStyle = PLAN.paper;
  g.fillRect(0, 0, cv.width, cv.height);

  // a 10-unit survey grid, the way a plan sheet is ruled
  g.strokeStyle = PLAN.grid;
  g.lineWidth = 1;
  for (let x = Math.ceil(b[0] / 10) * 10; x <= b[2]; x += 10) {
    g.beginPath(); g.moveTo(X(x), 0); g.lineTo(X(x), cv.height); g.stroke();
  }
  for (let y = Math.ceil(b[1] / 10) * 10; y <= b[3]; y += 10) {
    g.beginPath(); g.moveTo(0, Y(y)); g.lineTo(cv.width, Y(y)); g.stroke();
  }

  const path = (poly) => {
    poly.forEach((p, i) => (i ? g.lineTo(X(p[0]), Y(p[1])) : g.moveTo(X(p[0]), Y(p[1]))));
    g.closePath();
  };

  g.beginPath();
  for (const poly of L.floor) path(poly);
  g.fillStyle = PLAN.floor;
  g.fill('evenodd');
  g.strokeStyle = PLAN.floorEdge;
  g.lineWidth = 1.6;
  g.stroke();

  for (const grp of ['obstacles', 'building', 'ledge']) {
    for (const poly of L[grp] || []) {
      g.beginPath(); path(poly);
      g.fillStyle = PLAN.solid; g.fill();
      g.strokeStyle = PLAN.solidEdge; g.lineWidth = 1; g.stroke();
    }
  }
  for (const poly of L.stairs || []) {
    g.beginPath(); path(poly);
    g.fillStyle = 'rgba(217,164,65,.35)'; g.fill();
    g.strokeStyle = PLAN.stairs; g.lineWidth = 1; g.stroke();
  }

  // the real wall thickness, with butt caps so the doorways between them stay
  // the width they are instead of being capped shut
  g.lineCap = 'butt';
  g.lineJoin = 'round';
  for (const [width, colour] of [[WALL_W + 0.18, PLAN.wallCase], [WALL_W, PLAN.wall]]) {
    g.strokeStyle = colour;
    g.lineWidth = Math.max(width === WALL_W ? 1.2 : 1.8, width * scale);
    for (const line of L.walls || []) {
      g.beginPath();
      line.forEach((p, i) => (i ? g.lineTo(X(p[0]), Y(p[1])) : g.moveTo(X(p[0]), Y(p[1]))));
      g.stroke();
    }
  }

  // area names, so the plan reads as places rather than shapes
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (const a of raidRef.map.areas) {
    if (a.level !== level) continue;
    const w = a.rect[2] - a.rect[0];
    const h = a.rect[3] - a.rect[1];
    if (w * h > 2600) continue;              // the catch-all rectangles
    g.fillStyle = PLAN.text;
    g.font = `${Math.max(8, Math.min(12, scale * 1.6))}px Bahnschrift, system-ui, sans-serif`;
    g.fillText(a.name.toUpperCase(), X((a.rect[0] + a.rect[2]) / 2), Y((a.rect[1] + a.rect[3]) / 2));
  }

  const out = { cv, b, scale };
  baked.set(key, out);
  return out;
}

function padded(bounds) {
  return [bounds[0] - PAD, bounds[1] - PAD, bounds[2] + PAD, bounds[3] + PAD];
}

// ---------------------------------------------------------
export function drawFloorplan() {
  if (!raidRef || !canvas) return;
  const geo = raidRef.geo;
  const L = geo.levels[shown];
  if (!L) return;

  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const rect = canvas.getBoundingClientRect();
  const cw = Math.max(240, Math.round(rect.width));
  const ch = Math.max(200, Math.round(rect.height));
  canvas.width = Math.round(cw * dpr);
  canvas.height = Math.round(ch * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const b = padded(L.bounds);
  const scale = Math.min(cw / (b[2] - b[0]), ch / (b[3] - b[1]));
  const art = bake(shown, scale);
  const ox = (cw - art.cv.width) / 2;
  const oy = (ch - art.cv.height) / 2;

  ctx.fillStyle = PLAN.paper;
  ctx.fillRect(0, 0, cw, ch);
  ctx.drawImage(art.cv, ox, oy);

  const X = (v) => ox + (v - b[0]) * scale;
  const Y = (v) => oy + (v - b[1]) * scale;

  const lvl = raidRef.levelInfo(shown);
  titleEl.textContent = `${lvl.name.toUpperCase()} — ${raidRef.map.subtitle}`;

  // doors, coloured by whether they will open for you
  for (const d of raidRef.doors) {
    if (d.level !== shown) continue;
    const half = (d.w / 2 + 0.22) * scale;
    const locked = d.state === 'breach' || (d.state === 'key' && !raidRef.canOpen(d));
    ctx.save();
    ctx.translate(X(d.x), Y(d.y));
    ctx.rotate(d.a + (d.open ? Math.PI / 2 : 0));
    ctx.strokeStyle = d.state === 'free'
      ? PLAN.doorFree
      : (locked ? PLAN.doorLocked : PLAN.doorKey);
    ctx.globalAlpha = d.open ? 0.45 : 1;
    ctx.lineWidth = Math.max(2, scale * 0.34);
    ctx.beginPath();
    ctx.moveTo(d.open ? 0 : -half, 0);
    ctx.lineTo(half, 0);
    ctx.stroke();
    ctx.restore();
  }

  // Stairwells, marked the way a plan marks them: the run itself, plus a
  // chevron for each floor it reaches from here. Sixteen of them share the
  // ground floor, so written destinations would bury the drawing.
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const s of raidRef.stairsOn(shown)) {
    const w = (s.rect[2] - s.rect[0]) * scale;
    const h = (s.rect[3] - s.rect[1]) * scale;
    const cx = X((s.rect[0] + s.rect[2]) / 2);
    const cy = Y((s.rect[1] + s.rect[3]) / 2);
    const idx = s.levels.indexOf(shown);
    const up = idx < s.levels.length - 1;
    const down = idx > 0;
    ctx.save();
    ctx.strokeStyle = PLAN.stairs;
    ctx.lineWidth = 1.4;
    ctx.strokeRect(X(s.rect[0]), Y(s.rect[1]), w, h);
    ctx.fillStyle = PLAN.stairs;
    ctx.font = `${Math.max(8, Math.min(11, Math.min(w, h) * 0.8))}px system-ui, sans-serif`;
    const glyph = (up ? '▲' : '') + (down ? '▼' : '');
    ctx.fillText(glyph, cx, cy);
    ctx.restore();
  }

  // containers the player has actually laid eyes on
  for (const c of raidRef.containers) {
    if (c.level !== shown || !raidRef.seen.has(c.id)) continue;
    ctx.fillStyle = c.searched ? PLAN.searched : PLAN.seen;
    ctx.fillRect(X(c.x) - 2, Y(c.y) - 2, 4, 4);
  }

  // the ways out
  for (const ex of raidRef.allExtracts) {
    if (ex.level !== shown) continue;
    const r = Math.max(5, ex.r * scale);
    const col = ex.faction === 'scav' ? PLAN.exitScav : PLAN.exitPmc;
    ctx.save();
    ctx.strokeStyle = col;
    ctx.fillStyle = ex.faction === 'scav' ? 'rgba(217,164,65,.10)' : 'rgba(127,179,154,.12)';
    ctx.lineWidth = 1.8;
    ctx.beginPath(); ctx.arc(X(ex.x), Y(ex.y), r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = col;
    ctx.font = '600 10px Bahnschrift, system-ui, sans-serif';
    ctx.fillText(ex.name.toUpperCase(), X(ex.x), Y(ex.y) - r - 4);
    ctx.restore();
  }
  for (const t of raidRef.transits) {
    if (t.level !== shown) continue;
    ctx.save();
    ctx.strokeStyle = PLAN.transit;
    ctx.setLineDash([3, 3]);
    ctx.lineWidth = 1.6;
    const r = Math.max(5, t.r * scale);
    ctx.beginPath(); ctx.arc(X(t.x), Y(t.y), r, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = PLAN.transit;
    ctx.font = '9px Bahnschrift, system-ui, sans-serif';
    ctx.fillText(t.name.toUpperCase(), X(t.x), Y(t.y) + r + 10);
    ctx.restore();
  }

  // you are here — only on the storey you are actually standing on
  if (shown === raidRef.level) {
    const p = raidRef.player;
    ctx.save();
    ctx.translate(X(p.x), Y(p.y));
    ctx.rotate(p.facing);
    ctx.fillStyle = PLAN.player;
    ctx.beginPath();
    ctx.moveTo(9, 0); ctx.lineTo(-6, 6); ctx.lineTo(-3, 0); ctx.lineTo(-6, -6);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.strokeStyle = 'rgba(184,219,217,.5)';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(X(p.x), Y(p.y), 13, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  } else {
    ctx.save();
    ctx.fillStyle = 'rgba(184,219,217,.5)';
    ctx.font = '11px Bahnschrift, system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`YOU ARE ON ${raidRef.levelInfo(raidRef.level).short}`, 12, ch - 12);
    ctx.restore();
  }

  paintWhereAmI();
}

/** the line under the plan that says where the player is standing */
function paintWhereAmI() {
  const note = $('#floorplan-note');
  if (!note || !raidRef) return;
  const p = raidRef.player;
  const a = areaAt(raidRef.map, raidRef.level, p.x, p.y);
  note.replaceChildren(
    el('span', { class: 'plan-note__here' }, a ? a.name.toUpperCase() : 'IN THE OPEN'),
    el('span', { class: 'hint' },
       `${raidRef.levelInfo().name} · ${raidRef.containers.filter((c) => c.level === raidRef.level).length} containers on this floor`));
}
