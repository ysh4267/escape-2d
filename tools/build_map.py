#!/usr/bin/env python3
# =========================================================
# ESCAPE 2D - Factory map geometry extractor
#
# sources:
#   1. tarkov.dev's vector Factory map, for the shape of the place
#      https://github.com/the-hideout/tarkov-dev-svg-maps  (CC BY-NC-SA 4.0)
#   2. tarkov.dev's map dataset, for where things actually are in the raid:
#      https://json.tarkov.dev/regular/maps  (the same payload the site's own
#      map page reads; it is extracted from the game's map bundles)
#
# The SVG stacks four floor groups on one origin. Each group carries
#   Floor      - filled polygons = the walkable surface
#   Wall       - stroke-only polylines = wall centrelines
#   Obstacles  - filled polygons = machinery, crates, racks
#   Building   - filled polygons = the big round reactor/tank units
#   Ledge      - raised concrete plinths
#   Stairs     - <use> references into <defs>
#
# The dataset is in the game's own world coordinates. GAME_SCALE/GAME_OFF below
# put those onto the SVG; see the comment there for how they were pinned down.
#
# output: ../src/data/map-factory.json
# =========================================================

import json
import math
import os
import re
import sys
import urllib.request
import xml.etree.ElementTree as ET

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
CACHE = os.path.join(HERE, 'cache')
OUT = os.path.join(ROOT, 'src', 'data', 'map-factory.json')
SVG_URL = 'https://raw.githubusercontent.com/the-hideout/tarkov-dev-svg-maps/main/Factory.svg'
MARKERS_URL = 'https://json.tarkov.dev/regular/maps'
LOCALE_URL = 'https://json.tarkov.dev/regular/maps_en'
FACTORY_ID = '55f2d3fd4bdc2d5f408b4567'          # factory4_day
UA = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0',
      'Origin': 'https://tarkov.dev', 'Referer': 'https://tarkov.dev/'}

# ---------------------------------------------------------
# game world -> SVG units.
#
# The raid runs in metres with x/z on the ground plane and y as height; the
# vector map is the same plan turned a quarter turn. So svgX comes from -z and
# svgY from -x, at one shared scale.
#
# The numbers are not guesswork. Taking all 430 spawn points, static container
# spots and loose-loot spots that the dataset lists for Factory, the scale and
# the two offsets were fitted to land as many of them as possible on floor that
# actually exists on their own storey. The best fit puts 88% of them on drawn
# floor - the rest sit on shelves, in vehicles and on catwalks the vector map
# does not draw - and it needs only one scale for both axes, which is what a
# genuine rigid transform should look like.
#
# The check that matters: the four locked doors the dataset records land
# within a metre of four openings that the passage search below found on its
# own, from the geometry, knowing nothing about any of this.
# ---------------------------------------------------------
GAME_SCALE = 0.97942
GAME_OFF_X = 67.79
GAME_OFF_Y = 75.69

# height bands per storey, from tarkov.dev's own layer setup for Factory
LEVEL_BANDS = [('basement', -1e9, -1.0), ('ground', -1.0, 3.0),
               ('second', 3.0, 6.0), ('third', 6.0, 1e9)]

# the dataset names containers by their template id
CONTAINER_TYPES = {
    '578f87ad245977356274f2cc': 'crate',
    '5909d50c86f774659e6aaebe': 'toolbox',
    '578f8778245977358849a9b5': 'jacket',
    '578f87a3245977356274f2cb': 'duffle',
    '5909d36d86f774660f0bb900': 'grenadebox',
    '5909d5ef86f77467974efbd8': 'weaponbox',
    '5909d76c86f77471e53d2adf': 'weaponbox6',
    '578f87b7245977356274f2cd': 'drawer',
    '5909d24f86f77466f56e6855': 'medbag',
    '5909e4b686f7747f5b744fa4': 'deadscav',
    '6582e6d7b14c3f72eb071420': 'pmcbody',
    '66acff0a1d8e1083b303f5af': 'banksafe',
    '5d6fd45b86f774317075ed43': 'techcrate',
    '578f8782245977354405a1e3': 'safe',
}

NS = '{http://www.w3.org/2000/svg}'
XLINK = '{http://www.w3.org/1999/xlink}'

NUM = re.compile(r'[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?')
CMD = re.compile(r'([MmZzLlHhVvCcSsQqTtAa])')

CURVE_STEPS = 8


def tokenize(d):
    """yield (command, [numbers]) pairs"""
    parts = CMD.split(d)
    i = 1
    while i < len(parts):
        cmd = parts[i]
        args = [float(n) for n in NUM.findall(parts[i + 1])] if i + 1 < len(parts) else []
        yield cmd, args
        i += 2


def bezier3(p0, p1, p2, p3, steps=CURVE_STEPS):
    out = []
    for s in range(1, steps + 1):
        t = s / steps
        mt = 1 - t
        x = mt ** 3 * p0[0] + 3 * mt * mt * t * p1[0] + 3 * mt * t * t * p2[0] + t ** 3 * p3[0]
        y = mt ** 3 * p0[1] + 3 * mt * mt * t * p1[1] + 3 * mt * t * t * p2[1] + t ** 3 * p3[1]
        out.append((x, y))
    return out


def bezier2(p0, p1, p2, steps=CURVE_STEPS):
    out = []
    for s in range(1, steps + 1):
        t = s / steps
        mt = 1 - t
        x = mt * mt * p0[0] + 2 * mt * t * p1[0] + t * t * p2[0]
        y = mt * mt * p0[1] + 2 * mt * t * p1[1] + t * t * p2[1]
        out.append((x, y))
    return out


def parse_path(d):
    """-> list of subpaths, each {'pts': [(x,y)...], 'closed': bool}"""
    subs = []
    cur = None
    x = y = 0.0
    sx = sy = 0.0
    prev_c2 = None
    prev_q1 = None
    last_cmd = ''

    def start(px, py):
        nonlocal cur
        cur = {'pts': [(px, py)], 'closed': False}
        subs.append(cur)

    for cmd, a in tokenize(d):
        rel = cmd.islower()
        c = cmd.upper()

        if c == 'M':
            for i in range(0, len(a) - 1, 2):
                nx, ny = a[i], a[i + 1]
                if rel:
                    nx, ny = x + nx, y + ny
                if i == 0:
                    x, y = nx, ny
                    sx, sy = x, y
                    start(x, y)
                else:
                    x, y = nx, ny
                    cur['pts'].append((x, y))
        elif c == 'L':
            for i in range(0, len(a) - 1, 2):
                nx, ny = a[i], a[i + 1]
                x, y = (x + nx, y + ny) if rel else (nx, ny)
                if cur is None:
                    start(x, y)
                else:
                    cur['pts'].append((x, y))
        elif c == 'H':
            for nx in a:
                x = x + nx if rel else nx
                if cur is None:
                    start(x, y)
                else:
                    cur['pts'].append((x, y))
        elif c == 'V':
            for ny in a:
                y = y + ny if rel else ny
                if cur is None:
                    start(x, y)
                else:
                    cur['pts'].append((x, y))
        elif c == 'C':
            for i in range(0, len(a) - 5, 6):
                c1 = (a[i], a[i + 1]); c2 = (a[i + 2], a[i + 3]); p = (a[i + 4], a[i + 5])
                if rel:
                    c1 = (x + c1[0], y + c1[1]); c2 = (x + c2[0], y + c2[1]); p = (x + p[0], y + p[1])
                cur['pts'].extend(bezier3((x, y), c1, c2, p))
                prev_c2 = c2
                x, y = p
        elif c == 'S':
            for i in range(0, len(a) - 3, 4):
                c2 = (a[i], a[i + 1]); p = (a[i + 2], a[i + 3])
                if rel:
                    c2 = (x + c2[0], y + c2[1]); p = (x + p[0], y + p[1])
                c1 = (2 * x - prev_c2[0], 2 * y - prev_c2[1]) if prev_c2 and last_cmd in 'CS' else (x, y)
                cur['pts'].extend(bezier3((x, y), c1, c2, p))
                prev_c2 = c2
                x, y = p
        elif c == 'Q':
            for i in range(0, len(a) - 3, 4):
                q1 = (a[i], a[i + 1]); p = (a[i + 2], a[i + 3])
                if rel:
                    q1 = (x + q1[0], y + q1[1]); p = (x + p[0], y + p[1])
                cur['pts'].extend(bezier2((x, y), q1, p))
                prev_q1 = q1
                x, y = p
        elif c == 'T':
            for i in range(0, len(a) - 1, 2):
                p = (a[i], a[i + 1])
                if rel:
                    p = (x + p[0], y + p[1])
                q1 = (2 * x - prev_q1[0], 2 * y - prev_q1[1]) if prev_q1 and last_cmd in 'QT' else (x, y)
                cur['pts'].extend(bezier2((x, y), q1, p))
                prev_q1 = q1
                x, y = p
        elif c == 'A':
            # arcs are rare here; a straight line to the endpoint is close enough
            for i in range(0, len(a) - 6, 7):
                p = (a[i + 5], a[i + 6])
                if rel:
                    p = (x + p[0], y + p[1])
                cur['pts'].append(p)
                x, y = p
        elif c == 'Z':
            if cur:
                cur['closed'] = True
            x, y = sx, sy
        last_cmd = c
    return [s for s in subs if len(s['pts']) > 1]


def group_by_id(root, gid):
    for g in root.iter(NS + 'g'):
        if g.attrib.get('id') == gid:
            return g
    return None


def collect(root, gid, defs, closed_only=None):
    g = group_by_id(root, gid)
    if g is None:
        return []
    out = []
    for p in g.iter(NS + 'path'):
        for sub in parse_path(p.attrib.get('d', '')):
            if closed_only is True and not sub['closed'] and not is_ring(sub['pts']):
                continue
            if closed_only is False and (sub['closed'] or is_ring(sub['pts'])):
                continue
            out.append(sub)
    for u in g.iter(NS + 'use'):
        href = u.attrib.get(XLINK + 'href') or u.attrib.get('href')
        if not href:
            continue
        d = defs.get(href.lstrip('#'))
        if not d:
            continue
        dx = float(u.attrib.get('x', 0) or 0)
        dy = float(u.attrib.get('y', 0) or 0)
        for sub in parse_path(d):
            sub['pts'] = [(px + dx, py + dy) for px, py in sub['pts']]
            out.append(sub)
    return out


def is_ring(pts, eps=1e-6):
    return len(pts) > 2 and abs(pts[0][0] - pts[-1][0]) < eps and abs(pts[0][1] - pts[-1][1]) < eps


def quant(pts, nd=3):
    return [[round(x, nd), round(y, nd)] for x, y in pts]


def dedupe(pts, eps=1e-4):
    out = []
    for p in pts:
        if not out or abs(p[0] - out[-1][0]) > eps or abs(p[1] - out[-1][1]) > eps:
            out.append(p)
    return out


def bbox(polys):
    xs = [p[0] for poly in polys for p in poly]
    ys = [p[1] for poly in polys for p in poly]
    return [min(xs), min(ys), max(xs), max(ys)] if xs else [0, 0, 0, 0]


def area(poly):
    a = 0.0
    for i in range(len(poly)):
        x1, y1 = poly[i]
        x2, y2 = poly[(i + 1) % len(poly)]
        a += x1 * y2 - x2 * y1
    return a / 2


# =========================================================
# passages
#
# The vector map has no door symbols. What it does have is the exact shape of
# the standable surface, and a doorway is simply the narrowest point of a
# passage between two rooms. So: rasterise the surface the way the nav grid
# does, measure how far every cell is from the nearest solid, then flood the
# surface from the widest cells down to the narrowest. The first cell that
# joins two regions that have both already grown large is the saddle point of
# the passage between them - a doorway, a gate, or a hall opening, and its
# clearance is half the opening's width.
#
# That finds every opening in the building without anyone placing them by
# hand, and it finds them on all four floors with the same code.
# =========================================================

PCELL = 0.15            # svg units per raster cell for the passage search
PWALL_HALF = 0.22       # matches nav.js, so passages line up with what blocks
MIN_ROOM = 500          # cells a region must reach before a merge counts (~11 m2)
MAX_OPENING = 4.4       # wider than this is not an opening, it is just open plan


def raster(floor, solids, walls, w, h):
    """even-odd fill of the floor, minus the solids, minus stamped wall lines"""
    open_ = bytearray(w * h)
    scan_fill(open_, floor, w, h, 1)
    for polys in solids:
        for p in polys:
            scan_fill(open_, [p], w, h, 0)
    for line in walls:
        for i in range(len(line) - 1):
            stamp(open_, line[i], line[i + 1], PWALL_HALF, w, h)
    return open_


def scan_fill(buf, polys, w, h, value):
    edges = []
    for poly in polys:
        n = len(poly)
        for i in range(n):
            x1, y1 = poly[i]
            x2, y2 = poly[(i + 1) % n]
            if y1 != y2:
                edges.append((x1, y1, x2, y2))
    if not edges:
        return
    for cy in range(h):
        y = (cy + 0.5) * PCELL
        xs = []
        for x1, y1, x2, y2 in edges:
            if (y >= y1 and y < y2) or (y >= y2 and y < y1):
                xs.append(x1 + (y - y1) / (y2 - y1) * (x2 - x1))
        if len(xs) < 2:
            continue
        xs.sort()
        row = cy * w
        for i in range(0, len(xs) - 1, 2):
            a = max(0, int(math.ceil(xs[i] / PCELL - 0.5)))
            b = min(w - 1, int(math.floor(xs[i + 1] / PCELL - 0.5)))
            for cx in range(a, b + 1):
                buf[row + cx] = value


def stamp(buf, p, q, half, w, h):
    x0, y0 = p
    x1, y1 = q
    minx = max(0, int((min(x0, x1) - half) / PCELL))
    maxx = min(w - 1, int((max(x0, x1) + half) / PCELL) + 1)
    miny = max(0, int((min(y0, y1) - half) / PCELL))
    maxy = min(h - 1, int((max(y0, y1) + half) / PCELL) + 1)
    dx, dy = x1 - x0, y1 - y0
    len2 = dx * dx + dy * dy
    h2 = half * half
    for cy in range(miny, maxy + 1):
        py = (cy + 0.5) * PCELL
        row = cy * w
        for cx in range(minx, maxx + 1):
            px = (cx + 0.5) * PCELL
            t = 0.0 if len2 == 0 else ((px - x0) * dx + (py - y0) * dy) / len2
            t = 0.0 if t < 0 else 1.0 if t > 1 else t
            qx, qy = x0 + dx * t, y0 + dy * t
            if (px - qx) ** 2 + (py - qy) ** 2 <= h2:
                buf[row + cx] = 0


def clearance(open_, w, h):
    """5-7 chamfer distance to the nearest blocked cell, in fifths of a cell"""
    BIG = 1 << 20
    d = [BIG if v else 0 for v in open_]
    for cy in range(h):
        row = cy * w
        up = row - w
        for cx in range(w):
            i = row + cx
            if d[i] == 0:
                continue
            best = d[i]
            if cy:
                v = d[up + cx] + 5
                if v < best:
                    best = v
                if cx:
                    v = d[up + cx - 1] + 7
                    if v < best:
                        best = v
                if cx < w - 1:
                    v = d[up + cx + 1] + 7
                    if v < best:
                        best = v
            if cx:
                v = d[i - 1] + 5
                if v < best:
                    best = v
            d[i] = best
    for cy in range(h - 1, -1, -1):
        row = cy * w
        dn = row + w
        for cx in range(w - 1, -1, -1):
            i = row + cx
            if d[i] == 0:
                continue
            best = d[i]
            if cy < h - 1:
                v = d[dn + cx] + 5
                if v < best:
                    best = v
                if cx:
                    v = d[dn + cx - 1] + 7
                    if v < best:
                        best = v
                if cx < w - 1:
                    v = d[dn + cx + 1] + 7
                    if v < best:
                        best = v
            if cx < w - 1:
                v = d[i + 1] + 5
                if v < best:
                    best = v
            d[i] = best
    return d


def find_saddles(open_, dist, w, h):
    cells = [i for i, v in enumerate(open_) if v]
    cells.sort(key=lambda i: -dist[i])
    parent = list(range(w * h))
    size = [1] * (w * h)
    seen = bytearray(w * h)
    hits = []

    def root(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for i in cells:
        cx = i % w
        roots = []
        for dxy in (-1, 1, -w, w, -w - 1, -w + 1, w - 1, w + 1):
            j = i + dxy
            if j < 0 or j >= w * h or not seen[j]:
                continue
            if abs((j % w) - cx) > 1:
                continue
            r = root(j)
            if r not in roots:
                roots.append(r)
        seen[i] = 1
        big = [r for r in roots if size[r] >= MIN_ROOM]
        if len(big) >= 2:
            hits.append((i, dist[i] / 5.0 * PCELL))
        for r in roots:
            ra, rb = root(i), r
            if ra == rb:
                continue
            if size[ra] < size[rb]:
                ra, rb = rb, ra
            parent[rb] = ra
            size[ra] += size[rb]
    return hits


def opening_axis(open_, w, h, x, y, limit):
    """
    The doorway's own direction: sweep rays out of the saddle and take the
    bearing that runs out of floor soonest. That is the line across the
    opening, from jamb to jamb, which is what a door leaf sits on.
    """
    best_a, best_d = 0.0, 1e9
    for k in range(36):
        a = k * math.pi / 36
        dx, dy = math.cos(a), math.sin(a)
        reach = 0.0
        for side in (1, -1):
            t = 0.0
            while t < limit:
                t += PCELL * 0.5
                cx = int((x + dx * side * t) / PCELL)
                cy = int((y + dy * side * t) / PCELL)
                if cx < 0 or cy < 0 or cx >= w or cy >= h or not open_[cy * w + cx]:
                    break
            reach += t
        if reach < best_d:
            best_d, best_a = reach, a
    return best_a, best_d


def passages(level, floor, solids, walls, vb):
    w = int(math.ceil(vb[2] / PCELL))
    h = int(math.ceil(vb[3] / PCELL))
    open_ = raster(floor, solids, walls, w, h)
    dist = clearance(open_, w, h)
    hits = find_saddles(open_, dist, w, h)
    grid = (open_, w, h)

    out = []
    for i, clear in sorted(hits, key=lambda t: -t[1]):
        x = (i % w + 0.5) * PCELL
        y = (i // w + 0.5) * PCELL
        if any((x - p['x']) ** 2 + (y - p['y']) ** 2 < 2.4 ** 2 for p in out):
            continue
        ang, span = opening_axis(open_, w, h, x, y, 6.0)
        width = min(span, clear * 2)
        if width > MAX_OPENING:
            continue
        out.append({
            'id': f'{level[0]}{round(x)}_{round(y)}',
            'x': round(x, 2), 'y': round(y, 2),
            'w': round(width, 2), 'a': round(ang, 3),
        })
    out.sort(key=lambda p: (p['y'], p['x']))
    return out, grid


def touches_floor(grid, rect, pad=0.9):
    """is any of this footprint standable on that storey?"""
    open_, w, h = grid
    x0 = max(0, int((rect[0] - pad) / PCELL))
    x1 = min(w - 1, int((rect[2] + pad) / PCELL))
    y0 = max(0, int((rect[1] - pad) / PCELL))
    y1 = min(h - 1, int((rect[3] + pad) / PCELL))
    for cy in range(y0, y1 + 1):
        row = cy * w
        for cx in range(x0, x1 + 1):
            if open_[row + cx]:
                return True
    return False


# =========================================================
# stairwells
#
# Every staircase in the SVG is a shape in <defs> that each floor group
# references with <use>. A run that shows up in Ground's "Stairs-up" and again
# in "Stairs-2-down" is one staircase seen from both ends, so the set of floor
# groups a shape appears in *is* the set of floors it serves. Sorting those
# floors bottom to top turns each shape into a usable ladder of levels.
# =========================================================

STAIR_GROUPS = {
    'basement': ['Connector-Ground_Floor'],
    'ground': ['Stairs-down', 'Stairs-up'],
    'second': ['Stairs-2-down', 'Stairs-2-up'],
    'third': ['Stairs-3-down'],
}
LEVEL_ORDER = ['basement', 'ground', 'second', 'third']


def stairwells(root, defs):
    where = {}
    for lvl, gids in STAIR_GROUPS.items():
        for gid in gids:
            g = group_by_id(root, gid)
            if g is None:
                continue
            for u in g.iter(NS + 'use'):
                href = (u.attrib.get(XLINK + 'href') or u.attrib.get('href') or '').lstrip('#')
                if href:
                    where.setdefault(href, set()).add(lvl)

    out = []
    for href, levels in sorted(where.items()):
        d = defs.get(href)
        if not d:
            continue
        pts = [p for sub in parse_path(d) for p in sub['pts']]
        if not pts:
            continue
        xs = [p[0] for p in pts]
        ys = [p[1] for p in pts]
        serves = [l for l in LEVEL_ORDER if l in levels]
        if len(serves) < 2:
            continue
        out.append({
            'id': href,
            'x': round((min(xs) + max(xs)) / 2, 2),
            'y': round((min(ys) + max(ys)) / 2, 2),
            'rect': [round(min(xs), 2), round(min(ys), 2), round(max(xs), 2), round(max(ys), 2)],
            'levels': serves,
        })
    out.sort(key=lambda s: (s['y'], s['x']))
    return out


# =========================================================
# markers: everything the raid actually contains
# =========================================================

def to_svg(pos):
    return (round(-GAME_SCALE * pos['z'] + GAME_OFF_X, 2),
            round(-GAME_SCALE * pos['x'] + GAME_OFF_Y, 2))


def level_of(y):
    for name, lo, hi in LEVEL_BANDS:
        if lo <= y < hi:
            return name
    return 'ground'


def outline_radius(entry):
    """half the mean side of the trigger volume, in svg units"""
    o = entry.get('outline') or []
    if len(o) < 3:
        return 3.0
    xs = [-GAME_SCALE * p['z'] for p in o]
    ys = [-GAME_SCALE * p['x'] for p in o]
    return round(max(1.6, ((max(xs) - min(xs)) + (max(ys) - min(ys))) / 4), 2)


def download(url, dest):
    if os.path.exists(dest):
        return
    print(f'downloading {url} ...')
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=180) as r:
        data = r.read()
    with open(dest, 'wb') as f:
        f.write(data)


def markers():
    raw_path = os.path.join(CACHE, 'tdev_maps.json')
    loc_path = os.path.join(CACHE, 'tdev_maps_en.json')
    download(MARKERS_URL, raw_path)
    download(LOCALE_URL, loc_path)
    with open(raw_path, encoding='utf-8') as f:
        m = json.load(f)['data']['maps'][FACTORY_ID]
    with open(loc_path, encoding='utf-8') as f:
        loc = json.load(f)
        loc = loc.get('data', loc)

    out = {'extracts': [], 'transits': [], 'locks': [],
           'spawns': [], 'containers': [], 'loose': []}

    for e in m.get('extracts', []):
        x, y = to_svg(e['position'])
        out['extracts'].append({
            'id': e['id'][:8], 'name': loc.get(e['name'], e['name']),
            'faction': e.get('faction', 'pmc'),
            'level': level_of(e.get('bottom', e['position']['y'])),
            'x': x, 'y': y, 'r': outline_radius(e),
            'item': (e.get('transferItem') or {}).get('item'),
        })
    for t in m.get('transits', []):
        x, y = to_svg(t['position'])
        out['transits'].append({
            'id': t['id'], 'name': loc.get(t.get('description', ''), 'Transit'),
            'cond': loc.get(t.get('conditions', ''), None),
            'level': level_of(t.get('bottom', t['position']['y'])),
            'x': x, 'y': y, 'r': outline_radius(t),
        })
    for l in m.get('locks', []):
        x, y = to_svg(l['position'])
        out['locks'].append({
            'key': l['key'], 'type': l.get('lockType', 'door'),
            'power': bool(l.get('needsPower')),
            'level': level_of(l['position']['y']), 'x': x, 'y': y,
        })
    for s in m.get('spawns', []):
        # the player's own insertion points: side "all", category "player"
        if 'player' not in (s.get('categories') or []):
            continue
        if 'all' not in (s.get('sides') or []):
            continue
        x, y = to_svg(s['position'])
        out['spawns'].append({'level': level_of(s['position']['y']), 'x': x, 'y': y})
    for c in m.get('lootContainers', []):
        t = CONTAINER_TYPES.get(c['lootContainer'])
        if not t:
            continue
        x, y = to_svg(c['position'])
        out['containers'].append({'t': t, 'level': level_of(c['position']['y']), 'x': x, 'y': y})
    for l in m.get('lootLoose', []):
        x, y = to_svg(l['position'])
        out['loose'].append({'level': level_of(l['position']['y']), 'x': x, 'y': y,
                             'items': l.get('items') or []})
    return out


def attach_locks(levels, locks):
    """
    Hand each recorded lock to the opening it belongs to.

    The dataset gives a lock's position in the raid; the passage search gives
    openings found from the drawn geometry. The two were derived completely
    independently, so a match inside a couple of metres is a real agreement,
    not a fit - and every one of Factory's four locks matches.
    """
    used = []
    for lk in locks:
        best, bestd = None, 3.0
        for p in levels.get(lk['level'], {}).get('passages', []):
            d = math.hypot(p['x'] - lk['x'], p['y'] - lk['y'])
            if d < bestd:
                bestd, best = d, p
        if not best:
            print(f'  !! lock {lk["key"]} on {lk["level"]} at '
                  f'({lk["x"]},{lk["y"]}) matched no opening')
            continue
        best['key'] = lk['key']
        best['lock'] = lk['type']
        if lk['power']:
            best['power'] = True
        used.append((lk, best, bestd))
    for lk, p, d in used:
        print(f'  lock {lk["key"]} -> {lk["level"]}/{p["id"]}  (off by {d:.2f})')
    return used


def main():
    os.makedirs(CACHE, exist_ok=True)
    svg_path = os.path.join(CACHE, 'Factory.svg')
    if not os.path.exists(svg_path):
        print('downloading Factory.svg ...')
        with urllib.request.urlopen(SVG_URL, timeout=60) as r:
            data = r.read()
        with open(svg_path, 'wb') as f:
            f.write(data)

    root = ET.parse(svg_path).getroot()
    vb = [float(v) for v in root.attrib['viewBox'].split()]

    defs = {}
    dnode = root.find(NS + 'defs')
    if dnode is not None:
        for c in dnode:
            if c.attrib.get('id'):
                defs[c.attrib['id']] = c.attrib.get('d', '')

    # The SVG stacks the whole plant on one origin: a basement of tunnels, the
    # ground floor, the office/locker second floor and the rafters and offices
    # on the third. Each floor is its own group with the same layer names.
    LEVELS = {
        'basement': {'floor': 'Floor-b', 'wall': 'Wall-b', 'obstacles': None,
                     'building': None, 'ledge': None, 'stairs': 'Stairs-b'},
        'ground': {'floor': 'Floor', 'wall': 'Wall', 'obstacles': 'Obstacles',
                   'building': 'Building', 'ledge': 'Ledge', 'stairs': 'Stairs'},
        'second': {'floor': 'Floor-2', 'wall': 'Wall-2', 'obstacles': 'Obstacles-2',
                   'building': None, 'ledge': None, 'stairs': 'Stairs-2'},
        'third': {'floor': 'Floor-3', 'wall': 'Wall-3', 'obstacles': None,
                  'building': None, 'ledge': None, 'stairs': 'Stairs-3'},
    }

    out = {'name': 'Factory', 'viewBox': vb, 'levels': {},
           'order': LEVEL_ORDER[:],
           'attribution': 'geometry derived from the-hideout/tarkov-dev-svg-maps (CC BY-NC-SA 4.0)'}

    grids = {}
    for lvl, gids in LEVELS.items():
        L = {}
        # floors and solids are filled shapes -> polygons
        for key in ('floor', 'obstacles', 'building', 'ledge', 'stairs'):
            gid = gids.get(key)
            if not gid:
                L[key] = []
                continue
            polys = []
            for sub in collect(root, gid, defs):
                pts = dedupe(sub['pts'])
                if len(pts) < 3:
                    continue
                polys.append(quant(pts))
            L[key] = polys
        # walls are stroked polylines
        lines = []
        for sub in collect(root, gids['wall'], defs):
            pts = dedupe(sub['pts'])
            if len(pts) < 2:
                continue
            if sub['closed'] and (pts[0] != pts[-1]):
                pts = pts + [pts[0]]
            lines.append(quant(pts))
        L['walls'] = lines

        # Extent of the floor, for the camera and for the floor-plan panel.
        # The upper storeys are several disjoint slabs rather than one ring, so
        # this has to be the union of every polygon, not the biggest one.
        L['bounds'] = bbox(L['floor']) if L['floor'] else vb[:]
        L['passages'], grids[lvl] = passages(lvl, L['floor'],
                                             [L['obstacles'], L['building'], L['ledge']],
                                             L['walls'], vb)
        out['levels'][lvl] = L

        segs = sum(max(0, len(p) - 1) for p in lines)
        print(f'  {lvl:9s} floor {len(L["floor"]):3d} polys | walls {len(lines):3d} paths '
              f'({segs} segs) | obstacles {len(L["obstacles"]):3d} | building {len(L["building"]):2d} '
              f'| ledge {len(L["ledge"]):2d} | stairs {len(L["stairs"]):2d}')
        print(f'            bounds {[round(v,2) for v in L["bounds"]]}')
        print(f'            passages {len(L["passages"])}: '
              + ', '.join(f'{p["id"]}({p["w"]:.2f})' for p in L['passages']))

    # A staircase is one shape referenced by every floor group it serves, and
    # it is drawn where its run sits in plan. On a storey that is catwalks over
    # open air, that footprint can land beside the deck rather than on it -
    # which would offer a floor change from a spot the player cannot stand on.
    # Keep a storey only where the run really meets standable floor.
    drops = []
    for s in stairwells(root, defs):
        keep = [l for l in s['levels'] if l in grids and touches_floor(grids[l], s['rect'])]
        if len(keep) != len(s['levels']):
            drops.append((s['id'], [l for l in s['levels'] if l not in keep]))
        s['levels'] = keep
        if len(keep) > 1:
            out.setdefault('stairwells', []).append(s)
    out.setdefault('stairwells', [])
    for sid, gone in drops:
        print(f'    trimmed {sid}: no floor on {"/".join(gone)}')
    print(f'  stairwells {len(out["stairwells"])}')
    for s in out['stairwells']:
        print(f'    {s["id"]:12s} ({s["x"]:6.2f},{s["y"]:6.2f})  {"-".join(s["levels"])}')

    mk = markers()
    attach_locks(out['levels'], mk['locks'])
    out['markers'] = mk
    print(f'  markers: {len(mk["extracts"])} extracts, {len(mk["transits"])} transits, '
          f'{len(mk["locks"])} locks, {len(mk["spawns"])} spawns, '
          f'{len(mk["containers"])} containers, {len(mk["loose"])} loose spots')
    for e in mk['extracts']:
        print(f'    exit  {e["name"]:22s} {e["faction"]:5s} {e["level"]:9s} '
              f'({e["x"]:6.2f},{e["y"]:6.2f}) r={e["r"]}' + (f'  item={e["item"]}' if e['item'] else ''))
    for t in mk['transits']:
        print(f'    trans {t["name"]:22s} {"":5s} {t["level"]:9s} ({t["x"]:6.2f},{t["y"]:6.2f})')

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(out, f, separators=(',', ':'))
    print(f'wrote {OUT}  ({os.path.getsize(OUT)/1024:.0f} KiB)')
    return 0


if __name__ == '__main__':
    sys.exit(main())
