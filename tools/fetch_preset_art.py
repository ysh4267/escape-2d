#!/usr/bin/env python3
"""
Fetch the large (8x) grid images of each weapon's default preset from
tarkov.dev and store a downscaled copy for the modding screen's stage.

    python tools/fetch_preset_art.py [--width 1280]

Why Playwright rather than curl: assets.tarkov.dev sits behind a bot check
that answers a plain fetch with 403; a headless Chromium's request goes
through. The 8x images are ~2500 px wide and 400-800 KB each; the modding
stage never shows a gun wider than ~1100 px, so they are resized to
--width and re-encoded, which lands them at 100-250 KB.

Output: assets/items/<weaponId>-preset-lg.webp (the same weapon id the
grid-sized preset image uses with `-preset.webp`).
"""

from __future__ import annotations

import argparse
import io
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
GLOBALS = ROOT / 'tools' / 'cache' / 'globals_3101.json'
DB = ROOT / 'src' / 'data' / 'items-db.json'
OUT = ROOT / 'assets' / 'items'


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--width', type=int, default=1280)
    ap.add_argument('--quality', type=int, default=82)
    args = ap.parse_args()
    from PIL import Image
    from playwright.sync_api import sync_playwright

    g = json.loads(GLOBALS.read_text(encoding='utf-8'))
    presets = g.get('ItemPresets') or g['config']['ItemPresets']
    db = json.loads(DB.read_text(encoding='utf-8'))
    items = db.get('items', db)
    weapons = {k: v for k, v in items.items() if v.get('wpn') and v.get('presetImg')}
    todo = []
    for key, tpl in weapons.items():
        wid = tpl['id']
        pid = next((p for p, v in presets.items() if v.get('_encyclopedia') == wid), None)
        if not pid:
            print(f'  no default preset for {key}')
            continue
        todo.append((key, wid, pid))

    with sync_playwright() as p:
        b = p.chromium.launch(headless=True)
        pg = b.new_page()
        for key, wid, pid in todo:
            url = f'https://assets.tarkov.dev/{pid}-8x.webp'
            r = pg.request.get(url)
            if not r.ok:
                print(f'  {key}: {r.status} {url}')
                continue
            im = Image.open(io.BytesIO(r.body())).convert('RGBA')
            w, h = im.size
            if w > args.width:
                im = im.resize((args.width, round(h * args.width / w)), Image.LANCZOS)
            out = OUT / f'{wid}-preset-lg.webp'
            im.save(out, 'WEBP', quality=args.quality, method=6)
            print(f'  {key}: {w}x{h} -> {im.size[0]}x{im.size[1]} {out.stat().st_size // 1024} KB')
        b.close()
    return 0


if __name__ == '__main__':
    sys.exit(main())
