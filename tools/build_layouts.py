#!/usr/bin/env python3
"""
Where each pouch of a rig sits.

A rig's or a compartmented backpack's storage is several small grids, and the
client does not lay them out in a row: each such item has a layout, a prefab
in the client that places every grid by hand - two rows of magazine pouches,
a big pocket with small ones beside it.

    python tools/build_layouts.py            # write src/data/grid-layouts.json
    python tools/build_layouts.py --report   # also list every item and what it got

This reads those prefabs out of the client's interface dump
(tools/extract_tarkov_ui.py writes them under tools/cache/client/layout) and
writes

    "layouts": { "Commando": { "w": 274, "h": 260, "g": [[0, 0], [70, 0], ...] } }
    "items":   { "<template id>": ["6b45_01", [0, 1, 2, 3, 5, 4, 6, 8, 7]] }

`g` is the top-left corner of each of a layout's boxes in pixels of the
client's own 1920 x 1080 interface (a cell is 63). Which layout an item uses:

  1. the one its template names (RigLayoutName / GridLayoutName, carried into
     the item table as container.layout by tools/build_items.py), when its
     boxes are the item's grids in order. Nothing more is written for these.
  2. the item table is newer than the dump its layout names come from, and a
     plate carrier that has since been given a choice of pouch sets no longer
     fits the layout it names. For those - and for an item that names none -
     the layout is found by shape: the prefab whose boxes are exactly the
     item's grids, the one with the closest name if several are. `items`
     records it, with which box each of the item's grids goes in.
  3. an item nothing fits gets no entry, and the page sets its grids out in
     a row.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter
from difflib import SequenceMatcher
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parent.parent
DUMP = ROOT / "tools" / "cache" / "client" / "layout"
ITEMS = ROOT / "src" / "data" / "items-db.json"
OUT = ROOT / "src" / "data" / "grid-layouts.json"

CELL = 63
NUMBERED = re.compile(r"\((\d+)\)\s*$")


def grid_views(node: dict) -> list[dict]:
    """every GridView under a node, in the order the prefab lists them"""
    out = []
    for child in node.get("children", []):
        if any(c.get("type", "").endswith("GridView") for c in child.get("components", [])):
            out.append(child)
        else:
            out.extend(grid_views(child))
    return out


def number(name: str) -> int | None:
    m = NUMBERED.search(name)
    return int(m.group(1)) if m else None


def load_prefabs() -> dict[str, dict]:
    """layout name -> { boxes: [[x, y, w, h]], cells: [(w, h)] }, boxes in the order of the item's grids"""
    found: dict[str, dict] = {}
    for sub in sorted(DUMP.iterdir()):
        if not (sub.is_dir() and sub.name.startswith("prefab")):
            continue
        for f in sorted(sub.glob("*.json")):
            root = json.loads(f.read_text(encoding="utf-8"))["root"]
            if not any("TemplatedGridsView" in c.get("type", "") for c in root.get("components", [])):
                continue
            views = grid_views(root)
            if not views or f.stem in found:
                continue
            boxes = [v["abs"] for v in views]
            # the prefab numbers its grids, GridView (1) .. (n), and that is
            # the order of the template's grids; one that does not number
            # them is taken in the order it lists them
            nums = [number(v["name"]) for v in views]
            if all(n is not None for n in nums) and len(set(nums)) == len(nums):
                boxes = [b for _n, b in sorted(zip(nums, boxes))]
            # a box is its cells at 63 px and a frame of a pixel or two
            found[f.stem] = {"boxes": boxes, "cells": [(round(b[2] / CELL), round(b[3] / CELL)) for b in boxes]}
    return found


def norm(text: str | None) -> str:
    return re.sub(r"[^a-z0-9]+", "", (text or "").lower())


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--report", action="store_true")
    args = ap.parse_args()

    if not DUMP.exists():
        raise SystemExit(f"no interface dump at {DUMP}; run tools/extract_tarkov_ui.py first")
    items = json.loads(ITEMS.read_text(encoding="utf-8"))
    prefabs = load_prefabs()
    by_lower = {name.lower(): name for name in prefabs}
    by_shape: dict[tuple, list[str]] = {}
    for name, p in prefabs.items():
        by_shape.setdefault(tuple(sorted(p["cells"])), []).append(name)

    used: set[str] = set()
    overrides: dict[str, list] = {}
    tally: Counter = Counter()
    lines: list[str] = []
    for tid, tpl in sorted(items.items(), key=lambda kv: (kv[1].get("cat", ""), kv[1].get("short") or "")):
        cont = tpl.get("container") if isinstance(tpl, dict) else None
        grids = [tuple(g) for g in (cont or {}).get("grids", [])]
        if len(grids) < 2:
            continue
        label = f"{tpl.get('cat', ''):9s} {(tpl.get('short') or tpl.get('name') or tid)[:22]:22s}"
        shape = "+".join(f"{w}x{h}" for w, h in grids)
        named = by_lower.get((cont.get("layout") or "").lower())
        if named and prefabs[named]["cells"] == grids:
            used.add(named)
            tally["as named"] += 1
            # the table spells a layout as the template does; the dump may differ in case
            if named != cont.get("layout"):
                overrides[tid] = [named, list(range(len(grids)))]
            lines.append(f"  {label} {named}")
            continue
        cands = by_shape.get(tuple(sorted(grids)), [])
        if not cands:
            tally["none fits"] += 1
            lines.append(f"  {label} -- nothing fits {shape}" + (f" (names {cont['layout']})" if cont.get("layout") else ""))
            continue
        if named in cands:
            pick = named
        else:
            # several layouts can have the same boxes: the one named most like the item
            keys = [k for k in (norm(tpl.get("short")), norm(tpl.get("name")), norm(cont.get("layout"))) if k]

            def likeness(cand: str) -> float:
                return max((SequenceMatcher(None, norm(cand), k).ratio() for k in keys), default=0.0)

            pick = max(sorted(cands), key=likeness)
        # each of the item's grids takes the first free box of its own size
        free = list(enumerate(prefabs[pick]["cells"]))
        order = []
        for g in grids:
            at = next(i for i, (_bi, c) in enumerate(free) if c == g)
            order.append(free.pop(at)[0])
        used.add(pick)
        overrides[tid] = [pick, order]
        tally["by shape" if len(cands) == 1 else "by shape, closest name"] += 1
        note = "" if len(cands) == 1 else f" (of {len(cands)}: {', '.join(sorted(cands))})"
        lines.append(f"  {label} {pick}   <- by shape{note}")

    layouts = {}
    for name in sorted(used):
        boxes = prefabs[name]["boxes"]
        x0 = min(b[0] for b in boxes)
        y0 = min(b[1] for b in boxes)
        layouts[name] = {
            "w": round(max(b[0] + b[2] for b in boxes) - x0),
            "h": round(max(b[1] + b[3] for b in boxes) - y0),
            "g": [[round(b[0] - x0), round(b[1] - y0)] for b in boxes],
        }

    if args.report:
        print("\n".join(lines))
    OUT.write_text(json.dumps({"layouts": layouts, "items": overrides}, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")
    print(", ".join(f"{n} {k}" for k, n in tally.most_common()))
    print(f"{len(layouts)} layouts, {len(overrides)} items placed by shape -> {OUT.relative_to(ROOT)} ({OUT.stat().st_size / 1024:.1f} KiB)")


if __name__ == "__main__":
    main()
