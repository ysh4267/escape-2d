#!/usr/bin/env python3
"""
Take a picture of the running page at an exact size, after driving it.

    python tools/shot.py out.png
    python tools/shot.py out.png --js "ESCAPE2D.showScreen('traders')"
    python tools/shot.py out.png --js "..." --js "..." --wait 1.5 --clip 0,224,1920,856
    python tools/shot.py out.png --dev trade-sell          # the page's own ?dev= hooks
    python tools/shot.py out.png --hover 960,776           # put the pointer somewhere first
    python tools/shot.py out.png --lang en                 # boot in a given language
    python tools/shot.py --eval "JSON.stringify(ESCAPE2D.game.profile.level)"   # no picture, print a value

The interface is drawn for a 1920 x 1080 screen, and the reference captures it
is checked against are 1920 x 1080 too, so that is the default window: a
picture taken here lines up with a capture of the game pixel for pixel.

Every run is a fresh browser profile, so it starts from a new character; use
--js to put the page in the state the picture needs. The page is served by
whatever is already listening on --port (the repo root, without caching). The
sealed packs need WebCrypto on the real clock, which is why this is
Playwright's Chromium and not `chrome --headless --virtual-time-budget`.

Prints every page error and whatever the page's own error box collected; the
exit code is 1 if there was any.
"""

from __future__ import annotations

import argparse
import sys
import time

sys.stdout.reconfigure(encoding="utf-8", errors="replace")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("out", nargs="?", help="where to write the PNG")
    ap.add_argument("--port", type=int, default=8777)
    ap.add_argument("--size", default="1920x1080")
    ap.add_argument("--dev", default=None, help="value for the page's ?dev= hook")
    ap.add_argument("--js", action="append", default=[], help="script to run in the page once it has booted (repeatable, awaited)")
    ap.add_argument("--eval", default=None, help="expression whose value is printed after the scripts ran")
    ap.add_argument("--hover", default=None, help="x,y to leave the pointer at")
    ap.add_argument("--click", action="append", default=[], help="x,y to click after the scripts (repeatable)")
    ap.add_argument("--wait", type=float, default=0.8, help="seconds to let the page settle before the picture")
    ap.add_argument("--clip", default=None, help="x,y,w,h of the part to keep")
    ap.add_argument("--lang", default=None, help="interface language to boot in (en, ko); the default is the browser's")
    args = ap.parse_args()

    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("playwright is not installed: python -m pip install playwright && python -m playwright install chromium")
        return 2

    w, h = (int(v) for v in args.size.lower().split("x"))
    url = f"http://localhost:{args.port}/?t={int(time.time())}" + (f"&dev={args.dev}" if args.dev else "")
    errors: list[str] = []
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, ignore_default_args=["--hide-scrollbars"],
                                    args=["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"])
        page = browser.new_page(viewport={"width": w, "height": h})
        if args.lang:
            page.add_init_script(f"try {{ localStorage.setItem('escape2d.lang', '{args.lang}'); }} catch (e) {{}}")
        page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
        page.on("console", lambda m: errors.append(f"console.error: {m.text}") if m.type == "error" else None)
        page.goto(url)
        try:
            page.wait_for_function("window.ESCAPE2D && document.body.dataset.screen && document.body.dataset.screen !== 'boot'", timeout=30000)
        except Exception as exc:
            errors.append(f"boot did not finish: {exc}")
        for script in args.js:
            try:
                page.evaluate(f"(async () => {{ {script} }})()")
            except Exception as exc:
                errors.append(f"--js failed: {script[:80]} -> {exc}")
            page.wait_for_timeout(150)
        for spot in args.click:
            x, y = (float(v) for v in spot.split(","))
            page.mouse.click(x, y)
            page.wait_for_timeout(250)
        if args.hover:
            x, y = (float(v) for v in args.hover.split(","))
            page.mouse.move(x, y)
        page.wait_for_timeout(int(args.wait * 1000))
        if args.eval:
            try:
                print(page.evaluate(args.eval))
            except Exception as exc:
                errors.append(f"--eval failed: {exc}")
        box = page.evaluate("document.getElementById('errbox')?.innerText || ''")
        if box.strip():
            errors.append("page error box:\n" + box.strip())
        if args.out:
            kw = {}
            if args.clip:
                x, y, cw, ch = (float(v) for v in args.clip.split(","))
                kw["clip"] = {"x": x, "y": y, "width": cw, "height": ch}
            page.screenshot(path=args.out, **kw)
            print(f"wrote {args.out}")
        browser.close()
    for e in errors:
        print(e)
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
