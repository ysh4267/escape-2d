#!/usr/bin/env python3
"""
Walk every screen of the running page and report what broke.

    python tools/sweep.py                    # visit everything, print errors per step
    python tools/sweep.py --shots out/       # also keep a picture of each step
    python tools/sweep.py --lang ko          # in a given interface language
    python tools/sweep.py --only trader      # steps whose name contains the word

Each step drives the page the way a player would get there - the bottom bar,
a tab, a card - then waits for it to settle. A step fails when the page threw,
logged an error, or put something in its on-screen error box while the step
ran. The exit code is the number of failed steps.

Like tools/shot.py this needs the page served on --port (the repo root,
uncached) and Playwright's Chromium; every run is a fresh profile.
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

# (name, script). A script runs in the page; `E` is window.ESCAPE2D, `click`
# presses the first element matching a selector (and throws if there is none),
# `seen` throws unless something matching a selector is actually on screen -
# a screen can fail by showing nothing without ever throwing - and `sleep`
# waits. Steps run in order on one page, so each starts where the last one
# left the game.
STEPS: list[tuple[str, str]] = [
    ("menu", "E.showScreen('menu')"),
    ("character", "E.showScreen('character')"),
    ("gear", "E.openCharacter('gear'); await sleep(400); seen('#stash-host .item'); seen('#equipment-host .gslot'); seen('#carry-host .gcont')"),
    ("health", "E.openCharacter('health'); await sleep(400); seen('#health-panel-host .hb'); seen('#stash-host .item')"),
    ("overall", """
        E.openCharacter('overall'); await sleep(400); seen('.ov__sheet .ov__level'); seen('.ov__cell'); seen('.ov__row');
        for (const b of document.querySelectorAll('.ov__tab')) { b.click(); await sleep(150); seen('.ov__row'); }
    """),
    ("skills", """
        E.openCharacter('skills'); await sleep(900); seen('.skl__bar'); seen('.sk .skpic__img img'); seen('.sk .skbf img');
        click('.skl__view:not(.is-on)'); await sleep(200); seen('.skpic--cell');
        click('.skl__view:not(.is-on)'); await sleep(200); seen('.sk');
        click('.skl__filter'); await sleep(100); click('.skl__filter .ddb__opt:nth-child(4)'); await sleep(200); seen('.sk');
        click('.skl__tab:not(.is-hover)'); await sleep(200); seen('.skl__search');
        click('.skl__tab:not(.is-hover)'); await sleep(200); seen('.sk');
    """),
    ("character tabs", """
        for (const b of document.querySelectorAll('#screen-character .ptab:not(:disabled)')) { b.click(); await sleep(350); }
    """),
    ("traders", "E.showScreen('traders')"),
    ("trader", "click('#screen-traders .tcard:not(.is-locked)'); await sleep(500); seen('#trader-content .item'); seen('#trade-stash-host .grid')"),
    ("trader sell", "click('#screen-trader .dtab--sell'); await sleep(300)"),
    ("trader tabs", """
        for (const b of document.querySelectorAll('#screen-trader .trbar .ptab:not(:disabled)')) { b.click(); await sleep(400); }
    """),
    ("trader task", "const r = document.querySelector('#screen-trader .qrow'); if (r) { r.click(); await sleep(300); }"),
    ("flea", "E.showScreen('flea')"),
    ("handbook", "E.showScreen('handbook')"),
    ("hideout", "E.showScreen('hideout')"),
    ("messenger", "E.openMessenger(); await sleep(400); E.openMessenger && document.querySelector('#bottombar .bbtn[data-key=messenger]').click()"),
    ("settings", "E.showScreen('settings'); await sleep(200); seen('#screen-settings .set__pane')"),
    ("settings tabs", """
        for (const b of [...document.querySelectorAll('#screen-settings .set__tabs .set__tab:not(:disabled)')]) {
          const again = [...document.querySelectorAll('#screen-settings .set__tabs .set__tab')].find((x) => x.textContent === b.textContent);
          again.click(); await sleep(300);
        }
    """),
    ("preraid", "E.showScreen('menu'); await sleep(200); click('#screen-menu .menu__item'); await sleep(500)"),
    ("back to menu", "E.showScreen('menu')"),
]

HELPERS = """
const E = window.ESCAPE2D;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const click = (sel) => { const n = document.querySelector(sel); if (!n) throw new Error('nothing matches ' + sel); n.click(); };
const seen = (sel) => {
  const n = [...document.querySelectorAll(sel)].find((x) => { const r = x.getBoundingClientRect(); return r.width > 1 && r.height > 1; });
  if (!n) throw new Error('nothing on screen matches ' + sel);
};
"""


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--port", type=int, default=8777)
    ap.add_argument("--shots", default=None, help="folder to write a picture of each step into")
    ap.add_argument("--lang", default=None, help="interface language to boot in (en, ko)")
    ap.add_argument("--only", default=None, help="run only the steps whose name contains this")
    args = ap.parse_args()

    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("playwright is not installed: python -m pip install playwright && python -m playwright install chromium")
        return 2

    shots = Path(args.shots) if args.shots else None
    if shots:
        shots.mkdir(parents=True, exist_ok=True)
    failed = 0
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, ignore_default_args=["--hide-scrollbars"],
                                    args=["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"])
        page = browser.new_page(viewport={"width": 1920, "height": 1080})
        if args.lang:
            page.add_init_script(f"try {{ localStorage.setItem('escape2d.lang', '{args.lang}'); }} catch (e) {{}}")
        errors: list[str] = []
        page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
        page.on("console", lambda m: errors.append(f"console.error: {m.text}") if m.type == "error" else None)
        page.on("response", lambda r: errors.append(f"{r.status} {r.url.split('?')[0]}") if r.status >= 400 else None)
        page.goto(f"http://localhost:{args.port}/?t={int(time.time())}")
        page.wait_for_function("window.ESCAPE2D && document.body.dataset.screen && document.body.dataset.screen !== 'boot'", timeout=30000)
        page.wait_for_timeout(400)

        def box() -> str:
            return page.evaluate("document.getElementById('errbox')?.innerText || ''").strip()

        seen_box = box()
        if errors or seen_box:
            failed += 1
            print("FAIL boot")
            for e in errors:
                print("   ", e)
            if seen_box:
                print("   ", seen_box.replace("\n", "\n    "))
            errors.clear()
        for i, (name, script) in enumerate(STEPS):
            if args.only and args.only not in name:
                continue
            try:
                page.evaluate(f"(async () => {{ {HELPERS} {script} }})()")
            except Exception as exc:
                errors.append(f"step threw: {str(exc).splitlines()[0]}")
            page.wait_for_timeout(450)
            now = box()
            fresh = now[len(seen_box):].strip() if now.startswith(seen_box) else now
            seen_box = now
            if shots:
                page.screenshot(path=str(shots / f"{i:02d}_{name.replace(' ', '_')}.png"))
            if errors or fresh:
                failed += 1
                print(f"FAIL {name}")
                for e in dict.fromkeys(errors):
                    print("   ", e)
                if fresh:
                    print("   ", fresh.replace("\n", "\n    "))
            else:
                print(f"ok   {name}")
            errors.clear()
        browser.close()
    print(f"{failed} step(s) failed" if failed else "all steps clean")
    return failed


if __name__ == "__main__":
    sys.exit(main())
