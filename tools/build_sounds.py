#!/usr/bin/env python3
# =========================================================
# ESCAPE 2D - sound effect pipeline
#
# Escape From Tarkov's own audio is Battlestate Games' copyrighted work and is
# not redistributable, so this pulls equivalent foley from openly licensed
# libraries instead.
#
# The game currently ships footsteps only — every other cue was removed by
# request, and the factory ambience is synthesised at runtime. PARKED keeps
# the vetted picks for the rest so they can be restored in one edit.
#
# output: ../assets/sfx/*.ogg  +  ../assets/sfx/CREDITS.md
# =========================================================

import json
import os
import shutil
import subprocess
import sys
import urllib.request
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
CACHE = os.path.join(HERE, 'cache', 'sfx')
OUT = os.path.join(ROOT, 'assets', 'sfx')
UA = {'User-Agent': 'Mozilla/5.0 (escape2d asset builder)'}

# ---------------------------------------------------------
SOURCES = {
    'kenney_interface': {
        'url': 'https://kenney.nl/media/pages/assets/interface-sounds/fa43c1dd4d-1677589452/kenney_interface-sounds.zip',
        'file': 'kenney_interface.zip',
        'kind': 'zip',
        'title': 'Interface Sounds',
        'author': 'Kenney',
        'page': 'https://kenney.nl/assets/interface-sounds',
        'license': 'CC0 1.0',
    },
    'rubberduck_sfx100': {
        'url': 'https://opengameart.org/sites/default/files/sfx_100_v2.zip',
        'file': 'sfx_100_v2.zip',
        'kind': 'zip',
        'title': '100 CC0 SFX #2',
        'author': 'rubberduck',
        'page': 'https://opengameart.org/content/100-cc0-sfx-2',
        'license': 'CC0 1.0',
    },
    'thimras_steps': {
        'url': 'https://opengameart.org/sites/default/files/metal_steps_48k24b.7z',
        'file': 'metal_steps.7z',
        'kind': '7z',
        'title': 'Metal footsteps on concrete',
        'author': 'Thimras',
        'page': 'https://opengameart.org/content/metal-footsteps-on-concrete',
        'license': 'CC0 1.0',
    },
    'yd_alarm': {
        'url': 'https://opengameart.org/sites/default/files/alarm_0.ogg',
        'file': 'alarm_0.ogg',
        'kind': 'file',
        'title': 'Short alarm',
        'author': 'yd',
        'page': 'https://opengameart.org/content/short-alarm',
        'license': 'CC0 1.0',
    },
}

# out_name -> (source key, path inside the pack, trim seconds or None)
PICKS = [
    # --- footsteps: metal on concrete, six variants so walking never loops audibly
    ('step_1', 'thimras_steps', 'metal_steps_02.wav', None),
    ('step_2', 'thimras_steps', 'metal_steps_06.wav', None),
    ('step_3', 'thimras_steps', 'metal_steps_10.wav', None),
    ('step_4', 'thimras_steps', 'metal_steps_14.wav', None),
    ('step_5', 'thimras_steps', 'metal_steps_18.wav', None),
    ('step_6', 'thimras_steps', 'metal_steps_22.wav', None),
]

# Vetted but not shipped. Move a row into PICKS to bring the cue back.
PARKED = [
    ('open_wood',  'rubberduck_sfx100', 'sfx100v2_wood_03.ogg', None),
    ('open_metal', 'rubberduck_sfx100', 'sfx100v2_metal_01.ogg', None),
    ('open_door',  'rubberduck_sfx100', 'sfx100v2_door_03.ogg', None),
    ('search_1',   'rubberduck_sfx100', 'sfx100v2_items_01.ogg', None),
    ('search_2',   'rubberduck_sfx100', 'sfx100v2_items_02.ogg', None),
    ('search_3',   'rubberduck_sfx100', 'sfx100v2_wood_01.ogg', None),
    ('search_4',   'rubberduck_sfx100', 'sfx100v2_metal_05.ogg', None),
    ('thud',       'rubberduck_sfx100', 'sfx100v2_stones_02.ogg', None),
    ('hurt',       'rubberduck_sfx100', 'sfx100v2_hit_02.ogg', None),
    ('ui_click',     'kenney_interface', 'Audio/click_003.ogg', None),
    ('ui_tab',       'kenney_interface', 'Audio/switch_003.ogg', None),
    ('item_pick',    'kenney_interface', 'Audio/scratch_002.ogg', None),
    ('item_drop',    'kenney_interface', 'Audio/drop_002.ogg', None),
    ('deny',         'kenney_interface', 'Audio/error_004.ogg', None),
    ('confirm',      'kenney_interface', 'Audio/confirmation_002.ogg', None),
    ('alert',        'kenney_interface', 'Audio/question_002.ogg', None),
    ('money',        'kenney_interface', 'Audio/bong_001.ogg', None),
    ('window_open',  'kenney_interface', 'Audio/open_002.ogg', None),
    ('window_close', 'kenney_interface', 'Audio/close_002.ogg', None),
    ('extract_alarm', 'yd_alarm', 'alarm_0.ogg', 1.7),
]


def ffmpeg_bin():
    for cand in ('ffmpeg', r'E:\ffmpeg\bin\ffmpeg.exe', '/e/ffmpeg/bin/ffmpeg'):
        if shutil.which(cand) or os.path.exists(cand):
            return shutil.which(cand) or cand
    raise SystemExit('ffmpeg not found; install it or put it on PATH')


def fetch(url, dest):
    if os.path.exists(dest) and os.path.getsize(dest) > 1000:
        return dest
    print(f'  downloading {os.path.basename(dest)} ...')
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=180) as r, open(dest, 'wb') as f:
        shutil.copyfileobj(r, f)
    return dest


def main():
    os.makedirs(CACHE, exist_ok=True)
    os.makedirs(OUT, exist_ok=True)
    ff = ffmpeg_bin()

    print('[1/3] fetching source packs')
    needed = {k for _, k, _, _ in PICKS}
    extracted = {}
    for key, src in SOURCES.items():
        if key not in needed:
            continue
        path = fetch(src['url'], os.path.join(CACHE, src['file']))
        target = os.path.join(CACHE, key)
        if src['kind'] == 'zip':
            if not os.path.isdir(target):
                zipfile.ZipFile(path).extractall(target)
            extracted[key] = target
        elif src['kind'] == '7z':
            if not os.path.isdir(target):
                import py7zr
                with py7zr.SevenZipFile(path) as z:
                    z.extractall(target)
            extracted[key] = target
        else:
            extracted[key] = os.path.dirname(path)

    print('[2/3] transcoding')
    made = []
    for out_name, src_key, rel, trim in PICKS:
        src_path = os.path.join(extracted[src_key], rel)
        if not os.path.exists(src_path):
            # some packs nest one level deeper
            hit = None
            for base, _dirs, files in os.walk(extracted[src_key]):
                if os.path.basename(rel) in files:
                    hit = os.path.join(base, os.path.basename(rel))
                    break
            if not hit:
                print(f'      !! missing {src_key}:{rel}')
                continue
            src_path = hit

        dest = os.path.join(OUT, out_name + '.ogg')
        cmd = [ff, '-y', '-loglevel', 'error', '-i', src_path]
        if trim:
            cmd += ['-t', str(trim)]
        cmd += [
            '-ac', '1', '-ar', '32000',
            '-af', 'silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.01',
            '-c:a', 'libvorbis', '-q:a', '1',
            dest,
        ]
        res = subprocess.run(cmd, capture_output=True, text=True)
        if res.returncode != 0:
            print(f'      !! ffmpeg failed for {out_name}: {res.stderr.strip()[:160]}')
            continue
        made.append((out_name, src_key, os.path.getsize(dest)))

    print('[3/3] writing manifest and credits')
    manifest = sorted(n for n, _, _ in made)
    keep = {n + '.ogg' for n in manifest} | {'manifest.json', 'CREDITS.md'}
    for fn in os.listdir(OUT):
        if fn not in keep:
            os.remove(os.path.join(OUT, fn))
            print(f'      removed stale {fn}')
    with open(os.path.join(OUT, 'manifest.json'), 'w', encoding='utf-8') as f:
        json.dump(manifest, f, indent=0)

    used = sorted({k for _, k, _ in made})
    lines = [
        '# Sound credits',
        '',
        'Escape From Tarkov\'s own audio is copyrighted by Battlestate Games and is',
        'not redistributed here. These effects come from openly licensed libraries:',
        '',
    ]
    for key in used:
        s = SOURCES[key]
        names = ', '.join(f'`{n}`' for n, k, _ in made if k == key)
        lines += [
            f'## {s["title"]} — {s["author"]}',
            f'- license: **{s["license"]}**',
            f'- source: {s["page"]}',
            f'- used as: {names}',
            '',
        ]
    lines += [
        'The factory ambience is synthesised at runtime in `src/core/audio.js`',
        'and ships no file. Every other cue was removed by request; the vetted',
        'picks for them are parked in `tools/build_sounds.py` under `PARKED`.',
        '',
    ]
    with open(os.path.join(OUT, 'CREDITS.md'), 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines))

    total = sum(sz for _, _, sz in made)
    print(f'\ndone: {len(made)} effects, {total/1024:.0f} KiB total')
    for n, k, sz in made:
        print(f'  {n:15s} {sz/1024:6.1f} KiB   {SOURCES[k]["author"]}')
    return 0 if len(made) == len(PICKS) else 1


if __name__ == '__main__':
    sys.exit(main())
