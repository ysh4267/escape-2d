#!/usr/bin/env python3
# =========================================================
# ESCAPE 2D - Factory map geometry extractor
#
# source: tarkov.dev's vector Factory map
#   https://github.com/the-hideout/tarkov-dev-svg-maps  (CC BY-NC-SA 4.0)
#
# The SVG stacks four floor groups on one origin. Each group carries
#   Floor      - filled polygons = the walkable surface
#   Wall       - stroke-only polylines = wall centrelines
#   Obstacles  - filled polygons = machinery, crates, racks
#   Building   - filled polygons = the big round reactor/tank units
#   Ledge      - raised concrete plinths
#   Stairs     - <use> references into <defs>
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

    LEVELS = {
        'ground': {'floor': 'Floor', 'wall': 'Wall', 'obstacles': 'Obstacles',
                   'building': 'Building', 'ledge': 'Ledge', 'stairs': 'Stairs'},
        'basement': {'floor': 'Floor-b', 'wall': 'Wall-b', 'obstacles': None,
                     'building': None, 'ledge': None, 'stairs': 'Stairs-b'},
    }

    out = {'name': 'Factory', 'viewBox': vb, 'levels': {},
           'attribution': 'geometry derived from the-hideout/tarkov-dev-svg-maps (CC BY-NC-SA 4.0)'}

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

        # the biggest floor ring is the outer boundary; report it for the camera
        if L['floor']:
            biggest = max(L['floor'], key=lambda p: abs(area(p)))
            L['bounds'] = bbox([biggest])
        else:
            L['bounds'] = vb[:]
        out['levels'][lvl] = L

        segs = sum(max(0, len(p) - 1) for p in lines)
        print(f'  {lvl:9s} floor {len(L["floor"]):3d} polys | walls {len(lines):3d} paths '
              f'({segs} segs) | obstacles {len(L["obstacles"]):3d} | building {len(L["building"]):2d} '
              f'| ledge {len(L["ledge"]):2d} | stairs {len(L["stairs"]):2d}')
        print(f'            bounds {[round(v,2) for v in L["bounds"]]}')

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(out, f, separators=(',', ':'))
    print(f'wrote {OUT}  ({os.path.getsize(OUT)/1024:.0f} KiB)')
    return 0


if __name__ == '__main__':
    sys.exit(main())
