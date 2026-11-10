#!/usr/bin/env python3
"""
Fetch the large (8x) grid images of each weapon's default preset from
tarkov.dev and store a downscaled copy for the modding screen's stage.

    python tools/fetch_preset_art.py [--width 1280] [--all]

Why Playwright rather than curl: assets.tarkov.dev sits behind a bot check
that answers a plain fetch with 403; a headless Chromium's request goes
through. The 8x images are ~2500 px wide and 400-800 KB each; the modding
stage never shows a gun wider than ~1100 px, so they are resized to
--width and re-encoded, which lands them at 100-250 KB.

Which preset is a gun's default comes out of the item database: the preset
template that names the gun as its base and is flagged `def`. Without --all
only the guns the game shipped with (`core`) are fetched - every other gun's
stage falls back to its grid-sized preset sprite, which is already on disk.

Output: assets/items/<weaponId>-preset-lg.webp. Run tools/build_items.py
afterwards: it marks the guns that have one (`presetLg`), which is what the
game goes by.
"""

from __future__ import annotations

import argparse
import io
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DB = ROOT / 'src' / 'data' / 'items-db.json'
OUT = ROOT / 'assets' / 'items'


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--width', type=int, default=1280)
    ap.add_argument('--quality', type=int, default=82)
    ap.add_argument('--all', action='store_true', help='every gun, not only the ones the game shipped with')
    args = ap.parse_args()
    from PIL import Image
    from playwright.sync_api import sync_playwright

    db = json.loads(DB.read_text(encoding='utf-8'))
    default_of = {t['base']: t['id'] for t in db.values() if t.get('cat') == 'preset' and t.get('def')}
    todo = []
    for key, tpl in db.items():
        if not tpl.get('wpn') or not tpl.get('presetImg') or not (args.all or tpl.get('core')):
            continue
        pid = default_of.get(key)
        if not pid:
            print(f'  no default preset for {key}')
            continue
        todo.append((key, tpl['id'], pid))

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
