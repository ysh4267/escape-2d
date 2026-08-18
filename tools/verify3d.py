#!/usr/bin/env python3
"""
Verify the 3D viewer end to end in a real-time headless Chromium.

    python -m http.server 8777          # from the repo root, in another shell
    python tools/verify3d.py [--shot logs/view3d.png] [--port 8777]

Why not tools/smoke.html like everything else: the model packs are sealed
(src/core/seal.js), and unsealing them is a PBKDF2 derivation on WebCrypto.
Chrome's --virtual-time-budget headless runs never let that derivation finish
(the page dumps with the promise still pending), so the sealed sound pack and
the sealed models are only reachable in a headless run on the real clock.
Playwright's Chromium is that.

The modding screen no longer shows the 3D button (the viewer is parked); the
?dev=view3d hook still opens the viewer beside the screen for this script.

What it asserts:
  - ?dev=view3d opens the modding screen on an AKM and its 3D window
  - the gun assembles: meshes > 0 and no "no model for" note
  - a click on the magazine in the 3D view picks MAGAZINE in the modding screen
  - a rear sight dragged from the stash onto the 3D receiver is fitted
  - no page errors along the way
"""

from __future__ import annotations

import argparse
import sys
import time

sys.stdout.reconfigure(encoding="utf-8", errors="replace")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8777)
    ap.add_argument("--shot", default=None, help="write a screenshot here")
    args = ap.parse_args()
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("playwright is not installed: python -m pip install playwright && python -m playwright install chromium")
        return 2

    fails = 0

    def check(name, cond, extra=""):
        nonlocal fails
        if cond:
            print(f"  PASS  {name}")
        else:
            fails += 1
            print(f"  FAIL  {name}" + (f"  -> {extra}" if extra else ""))

    with sync_playwright() as p:
        b = p.chromium.launch(headless=True, args=["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"])
        pg = b.new_page(viewport={"width": 1920, "height": 1080})
        errors = []
        pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.goto(f"http://localhost:{args.port}/index.html?dev=view3d", wait_until="load")
        # the packs unseal on the real clock; give the AKM and its parts a moment
        for _ in range(40):
            time.sleep(0.5)
            note = pg.evaluate("() => document.querySelector('.viewer3d__note')?.textContent || ''")
            if "meshes" in note or "no model" in note:
                break
        note = pg.evaluate("() => document.querySelector('.viewer3d__note')?.textContent || ''")
        check("the 3D window opened", pg.evaluate("() => !!document.querySelector('.cwin--3d canvas')"))
        check("the gun assembled from its packs", "meshes" in note and "no model" not in note, note)
        meshes = int(note.split()[0]) if note and note.split()[0].isdigit() else 0
        check("more than ten meshes on an AKM", meshes > 10, str(meshes))

        # the viewer is at a known place: find the canvas box, click where the magazine hangs
        box = pg.evaluate("() => { const r = document.querySelector('.cwin--3d canvas').getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; }")
        # with the default framing the magazine hangs at about half the width, below the middle
        mx, my = box[0] + box[2] * 0.50, box[1] + box[3] * 0.62
        pg.mouse.move(mx, my)
        time.sleep(0.4)
        hint = pg.evaluate("() => document.querySelector('.viewer3d__hint')?.textContent || ''")
        check("hovering a part names it", "MAGAZINE" in hint or "—" in hint, hint)
        pg.mouse.down(); time.sleep(0.05); pg.mouse.up()
        time.sleep(0.8)
        pick = pg.evaluate("() => document.querySelector('.modpick__head span')?.textContent || ''")
        check("clicking the magazine picks its slot in the modding screen", "COMPATIBLE" in pick, pick)

        # a rear sight from the stash onto the receiver
        src = pg.evaluate("() => { const n = Array.from(document.querySelectorAll('#stash-host .item')).find(n => n._item?.tplId === 'mod_akmb_rs'); if (!n) return null; const r = n.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }")
        check("the AKMB rear sight is in the stash", bool(src))
        if src:
            tx, ty = box[0] + box[2] * 0.53, box[1] + box[3] * 0.40
            pg.mouse.move(src[0], src[1]); pg.mouse.down(); time.sleep(0.1)
            for i in range(1, 16):
                pg.mouse.move(src[0] + (tx - src[0]) * i / 15, src[1] + (ty - src[1]) * i / 15); time.sleep(0.03)
            time.sleep(0.3); pg.mouse.up(); time.sleep(1.5)
            fitted = pg.evaluate("() => Array.from(document.querySelectorAll('.modbox:not(.is-empty)')).map(n => n.dataset.slot)")
            check("the sight dropped on the 3D view went onto the gun", "mod_sight_rear" in fitted, ",".join(fitted))
        check("no page errors", not errors, "; ".join(errors)[:300])
        if args.shot:
            pg.screenshot(path=args.shot)
            print(f"  shot  {args.shot}")
        b.close()

    print(f"{'PASS' if not fails else 'FAIL'} — {fails} failed")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
