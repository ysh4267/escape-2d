#!/usr/bin/env python3
# =========================================================
# ESCAPE 2D - item database generator
#
# sources
#   names / short names / descriptions : SPT locale dump (plain JSON on GitHub)
#   handbook price + category tree     : SPT handbook.json
#   exact grid footprint + artwork     : assets.tarkov.dev grid images
#                                        (image is 63*cells + 1 px on each axis)
#
# output
#   ../src/data/items-db.json          : the template table the game loads
#   ../assets/items/<id>.webp          : local copies of every icon used
#
# usage:  python build_items.py [--report]
# =========================================================

import json
import os
import re
import sys
import time
import urllib.request
import urllib.error
from concurrent.futures import ThreadPoolExecutor

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from selection import SELECTION  # noqa: E402
import weapons_expand as wx  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
CACHE = os.path.join(HERE, 'cache')
ASSETS = os.path.join(ROOT, 'assets', 'items')
OUT = os.path.join(ROOT, 'src', 'data', 'items-db.json')

# tag 3.10.1 is the newest tag where items.json is a plain blob rather than a
# Git-LFS pointer, so it is the only place the real Width/Height/Weight/Grids
# values can still be downloaded from.
ITEMS_URL = 'https://raw.githubusercontent.com/sp-tarkov/server/3.10.1/project/assets/database/templates/items.json'
LOCALE_URL = 'https://raw.githubusercontent.com/sp-tarkov/server/master/project/assets/database/locales/global/en.json'
HANDBOOK_URL = 'https://raw.githubusercontent.com/sp-tarkov/server/master/project/assets/database/templates/handbook.json'
# default weapon presets (ItemPresets) live in globals.json; the 3.10.1 tag is
# a plain blob like items.json
GLOBALS_URL = 'https://raw.githubusercontent.com/sp-tarkov/server/3.10.1/project/assets/database/globals.json'
GRID_URL = 'https://assets.tarkov.dev/{id}-grid-image.webp'

UA = {'User-Agent': 'escape2d-item-builder/1.0'}
ID_RE = re.compile(r'^[0-9a-f]{24}$')

# handbook category id -> gameplay category (sanity cross-check only)
CAT_HINT = {
    '5b5f78b786f77447ed5636af': 'money',
    '5b47574386f77428ca22b338': 'meds',
    '5b47574386f77428ca22b337': 'meds',
    '5b47574386f77428ca22b339': 'meds',
    '5b47574386f77428ca22b33a': 'meds',
    '5b47574386f77428ca22b336': 'food',
    '5b47574386f77428ca22b335': 'drink',
    '5b5f6fa186f77409407a7eb7': 'container',
    '5b5f6fd286f774093f2ecf0d': 'secure',
    '5b5f6f6c86f774093f2ecf0b': 'backpack',
    '5b5f6f8786f77447ed563642': 'rig',
    '5b5f701386f774093f2ecf0f': 'armor',
    '5b47574386f77428ca22b330': 'helmet',
    '5b5f6f3c86f774094242ef87': 'headset',
    '5b47574386f77428ca22b331': 'glasses',
    '5b47574386f77428ca22b32f': 'facecover',
    '5b5f754a86f774094242f19b': 'mag',
    '5b47574386f77428ca22b33b': 'ammo',
    '5b47574386f77428ca22b33c': 'ammo',
    '5b5f7a2386f774093f2ed3c4': 'grenade',
    '5b5f7a0886f77409407a7f96': 'melee',
    '5b5f792486f77447ed5636b3': 'pistol',
    '5b5f78fc86f77409407a7f90': 'weapon',
    '5b5f796a86f774093f2ed3c0': 'weapon',
    '5b5f794b86f77409407a7f92': 'weapon',
    '5b5f78e986f77447ed5636b1': 'weapon',
    '5c518ec986f7743b68682ce2': 'key',
    '5c518ed586f774119a772aee': 'key',
    '5b47574386f77428ca22b341': 'info',
    '5b47574386f77428ca22b343': 'info',
}


def fetch(url, dest=None, binary=False, retries=3):
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=60) as r:
                data = r.read()
            if dest:
                os.makedirs(os.path.dirname(dest), exist_ok=True)
                with open(dest, 'wb') as f:
                    f.write(data)
            return data if binary else data.decode('utf-8')
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            time.sleep(1 + attempt)
        except Exception:
            time.sleep(1 + attempt)
    return None


def fetch_preset_image(preset_id, weapon_id):
    """(filename, w, h) of the assembled-preset sprite, or None"""
    fn = weapon_id + '-preset.webp'
    dest = os.path.join(ASSETS, fn)
    if os.path.exists(dest) and os.path.getsize(dest) > 500:
        with open(dest, 'rb') as f:
            data = f.read()
    else:
        data = fetch(GRID_URL.format(id=preset_id), dest=dest, binary=True)
    size = webp_size(data) if data else None
    if not size:
        if os.path.exists(dest):
            os.remove(dest)
        return None
    return fn, max(1, round((size[0] - 1) / 63)), max(1, round((size[1] - 1) / 63))


def cached_json(url, name):
    path = os.path.join(CACHE, name)
    if os.path.exists(path) and os.path.getsize(path) > 1000:
        with open(path, encoding='utf-8') as f:
            return json.load(f)
    print(f'  downloading {name} ...')
    txt = fetch(url)
    if txt is None:
        raise SystemExit(f'failed to download {url}')
    os.makedirs(CACHE, exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        f.write(txt)
    return json.loads(txt)


def webp_size(data):
    """(w, h) of a webp buffer, or None"""
    if not data or len(data) < 32 or data[:4] != b'RIFF' or data[8:12] != b'WEBP':
        return None
    fmt = data[12:16]
    if fmt == b'VP8X':
        return (int.from_bytes(data[24:27], 'little') + 1,
                int.from_bytes(data[27:30], 'little') + 1)
    if fmt == b'VP8L':
        bits = int.from_bytes(data[21:25], 'little')
        return ((bits & 0x3FFF) + 1, ((bits >> 14) & 0x3FFF) + 1)
    if fmt == b'VP8 ':
        return (int.from_bytes(data[26:28], 'little') & 0x3FFF,
                int.from_bytes(data[28:30], 'little') & 0x3FFF)
    return None


# ---------------------------------------------------------
# medical / provisions: what a med does, straight from the template
#
# EFT keeps the whole medical model on the item: how long a use takes,
# how many HP one use of a medkit can put back, which conditions it removes
# and what that costs out of its resource pool, and what a ration does to
# energy and hydration. Stims name a buff set in globals (BuffsPropital ...)
# which the client interprets by name.
# ---------------------------------------------------------
_MED_RM = {'LightBleeding': 'lb', 'HeavyBleeding': 'hb', 'Fracture': 'fr',
           'Contusion': 'ct', 'DestroyedPart': 'dp'}


def med_fields(props, cat):
    m = {}
    t = props.get('medUseTime') or props.get('foodUseTime')
    if t:
        m['t'] = float(t)
    if props.get('hpResourceRate'):
        m['rate'] = int(props['hpResourceRate'])
    ed = props.get('effects_damage') or {}
    rm = {}
    if isinstance(ed, dict):
        for k, v in ed.items():
            v = v or {}
            if k == 'Pain':
                # a pain entry with a duration is the painkiller effect
                if v.get('duration'):
                    m['pk'] = int(v['duration'])
                continue
            if k in ('LightBleeding', 'HeavyBleeding') and v.get('duration'):
                # zagustin: bleeding stopped and prevented for the duration
                m['hemo'] = int(v['duration'])
                continue
            if k == 'Contusion' and v.get('duration'):
                m['ctImmune'] = int(v['duration'])
                continue
            short = _MED_RM.get(k)
            if not short:
                continue
            e = {}
            if v.get('cost'):
                e['cost'] = int(v['cost'])
            if k == 'DestroyedPart':
                e['min'] = int(v.get('healthPenaltyMin') or 0)
                e['max'] = int(v.get('healthPenaltyMax') or 0)
            rm[short] = e
    if rm:
        m['rm'] = rm
    eh = props.get('effects_health') or {}
    if isinstance(eh, dict):
        en = (eh.get('Energy') or {}).get('value') or 0
        hy = (eh.get('Hydration') or {}).get('value') or 0
        if en or hy:
            m['eh'] = {'en': int(en), 'hy': int(hy)}
    if props.get('StimulatorBuffs'):
        m['buff'] = props['StimulatorBuffs']

    if cat in ('food', 'drink'):
        kind = cat
    elif m.get('rate'):
        kind = 'medkit'
    elif 'dp' in rm:
        kind = 'surgery'
    elif 'fr' in rm:
        kind = 'splint'
    elif 'hb' in rm:
        kind = 'tourniquet'
    elif 'lb' in rm:
        kind = 'bandage'
    elif m.get('buff') or m.get('hemo'):
        kind = 'stim'
    elif m.get('pk'):
        kind = 'painkiller'
    else:
        kind = 'med'
    m['kind'] = kind
    return m


def main():
    report = '--report' in sys.argv
    print('[1/5] loading source data')
    en = cached_json(LOCALE_URL, 'en.json')
    hb = cached_json(HANDBOOK_URL, 'handbook.json')
    raw_items = cached_json(ITEMS_URL, 'items_3101.json')
    globals_db = cached_json(GLOBALS_URL, 'globals_3101.json')

    hb_items = {i['Id']: i for i in hb['Items']}

    by_name = {}
    for k, v in en.items():
        if not k.endswith(' Name') or not isinstance(v, str):
            continue
        iid = k[:-5]
        if not ID_RE.match(iid):
            continue
        by_name.setdefault(v.strip(), []).append(iid)
    lower_index = {}
    for name, ids in by_name.items():
        lower_index.setdefault(name.lower(), []).extend(ids)

    print(f'      locale item names: {len(by_name)}   handbook items: {len(hb_items)}')

    print('[2/5] resolving selection')
    resolved, misses, fuzzy = [], [], []
    seen_keys, seen_ids = set(), {}

    for query, key, cat, weight, stack, extra in SELECTION:
        if key in seen_keys:
            print(f'      !! duplicate key {key}')
        seen_keys.add(key)

        how = 'exact'
        if ID_RE.match(query):
            ids, how = [query], 'id'
        else:
            ids = by_name.get(query) or lower_index.get(query.lower())
        if not ids:
            q = query.lower()
            cands = sorted(
                (len(name), name, iid)
                for name, idlist in by_name.items() if q in name.lower()
                for iid in idlist if iid in hb_items
            )
            if cands:
                ids, how = [cands[0][2]], 'fuzzy'
                fuzzy.append((key, query, cands[0][1]))
        if not ids:
            misses.append((key, query))
            continue

        iid = next((i for i in ids if i in hb_items), ids[0])
        if iid in seen_ids:
            print(f'      !! {key} and {seen_ids[iid]} both resolve to {iid}')
        seen_ids[iid] = key
        resolved.append({'key': key, 'id': iid, 'cat': cat, 'weight': weight,
                         'stack': stack, 'extra': extra, 'query': query, 'how': how})

    if fuzzy:
        print(f'      {len(fuzzy)} resolved by fuzzy match:')
        for key, q, matched in fuzzy:
            print(f'         {key}: "{q}" -> "{matched}"')
    if misses:
        print(f'      !! {len(misses)} unresolved:')
        for key, q in misses:
            print(f'         - {key}: "{q}"')

    # --- weapon trees: every part, magazine and cartridge the guns can take ---
    sel_ids = {r['id']: r['key'] for r in resolved}
    expanded, ex_counts, tree_depth = wx.expand(raw_items, hb_items, en, sel_ids, seen_keys)
    for rec in expanded:
        resolved.append({'key': rec['key'], 'id': rec['id'], 'cat': rec['cat'], 'weight': 0.1,
                         'stack': 1, 'extra': {}, 'query': rec['id'], 'how': 'tree',
                         'modType': rec['modType']})
        seen_ids[rec['id']] = rec['key']
    print('      weapon trees: +%s' % ', '.join(f'{v} {k}' for k, v in sorted(ex_counts.items())))
    key_of = lambda iid: seen_ids.get(iid)  # noqa: E731
    presets = {}
    for pr in globals_db.get('ItemPresets', {}).values():
        enc = pr.get('_encyclopedia')
        if enc and enc in seen_ids and enc not in presets:
            presets[enc] = pr

    print(f'[3/5] fetching grid images for {len(resolved)} items')
    os.makedirs(ASSETS, exist_ok=True)

    def grab(rec):
        dest = os.path.join(ASSETS, rec['id'] + '.webp')
        data = None
        if os.path.exists(dest) and os.path.getsize(dest) > 500:
            with open(dest, 'rb') as f:
                data = f.read()
        else:
            data = fetch(GRID_URL.format(id=rec['id']), dest=dest, binary=True)
        size = webp_size(data) if data else None
        if not size:
            if os.path.exists(dest):
                os.remove(dest)
            rec['img'] = None
            return rec
        pw, ph = size
        rec['w'] = max(1, round((pw - 1) / 63))
        rec['h'] = max(1, round((ph - 1) / 63))
        rec['img'] = rec['id'] + '.webp'
        return rec

    with ThreadPoolExecutor(max_workers=12) as ex:
        resolved = list(ex.map(grab, resolved))

    no_img = [r for r in resolved if not r.get('img')]
    if no_img:
        print(f'      !! {len(no_img)} without artwork (text tiles will be used):')
        for r in no_img:
            print(f'         - {r["key"]}  {r["id"]}')

    print('[4/5] assembling database')
    out = {}
    warns = []
    no_props = []
    for r in resolved:
        iid = r['id']
        name = en.get(iid + ' Name', r['query'])
        short = en.get(iid + ' ShortName') or name[:6]
        desc = en.get(iid + ' Description', '')
        hbrec = hb_items.get(iid, {})
        price = int(hbrec.get('Price', 0) or 0)
        hint = CAT_HINT.get(hbrec.get('ParentId'))
        extra = dict(r['extra'])

        node = raw_items.get(iid)
        props = node.get('_props', {}) if node else {}
        if not node:
            no_props.append(r['key'])

        # --- footprint: prefer the real template, fall back to the sprite ---
        w = props.get('Width') or r.get('w')
        h = props.get('Height') or r.get('h')
        if not w or not h:
            gh = extra.get('gridsHint')
            w, h = (2, 2) if not gh else (gh[0][0], gh[0][1])
        if r.get('w') and props.get('Width') and (r['w'] != w or r['h'] != h):
            warns.append((r['key'], 'sprite %dx%d' % (r['w'], r['h']),
                          'template %dx%d' % (w, h)))

        weight = props.get('Weight')
        if weight is None:
            weight = r['weight']
        stack = props.get('StackMaxSize') or r['stack']

        tpl = {
            'id': iid, 'key': r['key'], 'name': name, 'short': short,
            'desc': re.sub(r'\s+', ' ', desc).strip()[:340],
            'cat': r['cat'], 'w': int(w), 'h': int(h),
            'weight': round(float(weight), 3), 'price': price, 'stack': int(stack),
        }
        if r.get('img'):
            tpl['img'] = r['img']
        bg = props.get('BackgroundColor')
        if bg:
            tpl['bg'] = bg

        # --- container grids: the template layout wins over the hint ---
        grids = []
        for g in (props.get('Grids') or []):
            gp = g.get('_props', {})
            cw, ch = gp.get('cellsH'), gp.get('cellsV')
            if cw and ch:
                grids.append([int(cw), int(ch)])
        hint_grids = extra.pop('gridsHint', None)
        if not grids and hint_grids:
            grids = hint_grids
        if grids:
            tpl['container'] = {'grids': grids}
            f = extra.pop('filter', None)
            if f:
                tpl['container']['filter'] = f
        extra.pop('filter', None)

        # Which foley the item makes when it is picked up, dropped or used.
        # This is the game's own per-template field, so a helmet lands like a
        # helmet and a pill bottle rattles, instead of everything in a
        # category sharing one guessed sound.
        if props.get('ItemSound'):
            tpl['snd'] = props['ItemSound']

        # --- gameplay props straight from the template where they exist ---
        if props.get('MaxHpResource'):
            tpl['res'] = {'max': int(props['MaxHpResource'])}
            if props.get('hpResourceRate'):
                tpl['heal'] = int(props['hpResourceRate'])
        elif props.get('MaxResource') and r['cat'] in ('food', 'drink', 'meds'):
            tpl['res'] = {'max': int(props['MaxResource'])}
        if props and r['cat'] in ('meds', 'food', 'drink'):
            tpl['med'] = med_fields(props, r['cat'])
        if props.get('MaximumNumberOfUsage'):
            tpl['uses'] = int(props['MaximumNumberOfUsage'])
        # examination: most templates are known on sight, the rest have to be
        # inspected before their name and stats are revealed
        if props.get('ExaminedByDefault'):
            tpl['known'] = True
        if props.get('ExamineTime'):
            tpl['examineTime'] = float(props['ExamineTime'])
        if props.get('ExamineExperience'):
            tpl['examineXp'] = int(props['ExamineExperience'])
        if props.get('Damage'):
            tpl['dmg'] = int(props['Damage'])
        if props.get('PenetrationPower'):
            tpl['pen'] = int(props['PenetrationPower'])
        if props.get('Ergonomics'):
            tpl['ergo'] = int(props['Ergonomics'])
        if props.get('bFirerate'):
            tpl['rpm'] = int(props['bFirerate'])
        cal = wx.caliber(props)
        if cal:
            tpl['cal'] = cal
        if props.get('speedPenaltyPercent'):
            tpl['speedPen'] = float(props['speedPenaltyPercent'])
        if props.get('ArmorMaterial'):
            tpl['armorMat'] = props['ArmorMaterial']

        # --- weapon system: parts tree, ballistics, presets ---
        kind = wx.kind_of(raw_items, iid)
        if kind and props:
            kcat, ktype = kind
            slots = wx.slots_of(props, key_of)
            if slots:
                for sl in slots:
                    sl['label'] = wx.slot_label(sl['n'])
                tpl['slots'] = slots
            conf = [key_of(c) for c in (props.get('ConflictingItems') or [])]
            conf = sorted({c for c in conf if c})
            if conf:
                tpl['conflicts'] = conf
            if kcat in ('weapon', 'pistol'):
                tpl['wpn'] = wx.weapon_fields(props, key_of)
                pr = presets.get(iid)
                tree = wx.preset_tree(pr, key_of) if pr else None
                if tree:
                    tpl['preset'] = tree
                    tpl['presetName'] = pr.get('_name')
                    # tarkov.dev also draws the assembled default preset, under
                    # the preset's own id; the bare receiver's sprite is only
                    # the receiver. The assembled sprite is what a built gun
                    # shows in the grid, and its size is the cross-check that
                    # the footprint arithmetic (ExtraSize per part) is right.
                    pimg = fetch_preset_image(pr['_id'], iid)
                    if pimg:
                        tpl['presetImg'] = pimg[0]
                        tpl['presetSize'] = [pimg[1], pimg[2]]
                if props.get('weapFireType'):
                    tpl['fire'] = list(props['weapFireType'])
            elif kcat == 'mag':
                mg = wx.mag_fields(props, key_of)
                tpl['magSize'] = mg.pop('size', 0)
                tpl['ammoFilter'] = mg.pop('ammo', [])
                tpl['mag'] = mg
                mf = wx.mod_fields(props)
                if mf:
                    tpl['mod'] = mf
                tpl['modType'] = 'magazine'
                # the calibre is the one most of the rounds we carry are in: an
                # AKM mag also lists .366 TKM for the VPO-209, and that must not
                # relabel it
                cal_votes = {}
                for a in wx._filters((props.get('Cartridges') or [{}])[0]):
                    if a in raw_items and key_of(a):
                        c = wx.caliber(raw_items[a]['_props'])
                        cal_votes[c] = cal_votes.get(c, 0) + 1
                if cal_votes:
                    tpl['cal'] = max(cal_votes, key=cal_votes.get)
                if not tpl.get('price'):
                    tpl['price'] = 1500
            elif kcat == 'mod':
                tpl['mod'] = wx.mod_fields(props)
                tpl['modType'] = r.get('modType') or ktype
        if r['cat'] == 'ammo' and props:
            tpl['ammo'] = wx.ammo_fields(props)

        # authored overrides last: armor class and durability are no longer in
        # the template because armor moved to a plate-based system
        for k, v in extra.items():
            if k == 'res':
                tpl.setdefault('res', {'max': v})
            elif k == 'heal':
                # the template's own hpResourceRate wins; the authored number
                # is only a fallback for an item missing from the dump
                tpl.setdefault('heal', v)
            else:
                tpl[k] = v

        if hint and hint != r['cat']:
            warns.append((r['key'], 'declared ' + r['cat'], 'handbook ' + hint))
        out[r['key']] = tpl

    if no_props:
        print('      note: %d items missing from the 3.10.1 template dump '
              '(authored values used): %s' % (len(no_props), ', '.join(no_props)))

    suspicious = [t for t in out.values()
                  if t['w'] * t['h'] == 1
                  and t['cat'] in ('weapon', 'pistol', 'armor', 'backpack', 'rig', 'helmet', 'secure')]
    if suspicious:
        print(f'      !! {len(suspicious)} gear items resolved to a 1x1 icon (likely a CDN placeholder):')
        for t in suspicious:
            print(f'         - {t["key"]}  {t["name"]}')

    if warns:
        print('      note: %d field disagreements:' % len(warns))
        for key, a, b in warns:
            print('         - %s: %s  vs  %s' % (key, a, b))

    if report:
        print('\n--- resolution report ---')
        for t in sorted(out.values(), key=lambda x: (x['cat'], x['key'])):
            g = t.get('container', {}).get('grids')
            gs = ' [' + '+'.join('%dx%d' % (a, b) for a, b in g) + ']' if g else ''
            print('  %-11s %-13s %dx%-2d %6.2fkg %8d %8s  %s%s' % (
                t['cat'], t['key'], t['w'], t['h'], t['weight'],
                t['price'], t.get('bg', '-'), t['name'], gs))

    print('\n[5/5] writing', OUT)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, separators=(',', ':'), sort_keys=True)

    used = {t['img'] for t in out.values() if 'img' in t}
    used |= {t['presetImg'] for t in out.values() if 'presetImg' in t}
    for fn in os.listdir(ASSETS):
        if fn.endswith('.webp') and fn not in used:
            os.remove(os.path.join(ASSETS, fn))
    total = sum(os.path.getsize(os.path.join(ASSETS, f)) for f in os.listdir(ASSETS))
    print(f'done: {len(out)} templates, artwork {total/1024:.0f} KiB in {len(used)} files')
    return 1 if misses else 0


if __name__ == '__main__':
    sys.exit(main())
