#!/usr/bin/env python3
# =========================================================
# ESCAPE 2D - item database generator
#
# Every item of the live game gets a template, and nothing in a template is
# typed in by hand. Three public data sets are joined, in this order of
# authority:
#
#   1. tarkov.dev's static dataset (json.tarkov.dev/regular/items) - what
#      exists today and its numbers today: footprint, weight, price, stack,
#      category chain, slots and their filters, magazine capacity, ballistics,
#      armour plates and inserts, container grids, medical effects, the
#      trader-sold presets.
#   2. the SPT server dumps - everything a template has that tarkov.dev does
#      not carry: ItemSound, ExaminedByDefault, examine time and experience,
#      RaidModdable, heat and malfunction numbers, repair degradation, what a
#      med's effect costs, folding, chambers. Tag 4.1.2 of
#      sp-tarkov/server-csharp first, tag 3.10.1 of sp-tarkov/server for
#      anything it lacks.
#   3. an item newer than both dumps borrows those deep fields from the most
#      similar item of its own category (items_live.Donors).
#
# The items the game shipped with before keep their slugs (selection.py,
# part_keys.json) and are marked `core`; everything else is keyed by its
# tarkov id. A slug whose item the live list has dropped stays, from the dump,
# and stays in every slot and conflict list the dump has it in - the dataset
# cannot name what it does not list. Artwork is tarkov.dev's base image - the
# item's render with nothing behind it - whose size is exactly 63 * cells + 1
# px a side, which cross-checks every footprint. Where the CDN has no base
# image the grid image it has instead is kept and the template says so
# (`imgFlat`), so the page does not draw a second name over the baked one.
#
# Two orders the game reads something off: a magazine lists the rounds of its
# own calibre first (the first is what a magazine found loaded holds), and a
# gun's builds come in the order globals.json has them.
#
# output
#   ../src/data/items-db.json          : the template table the game loads
#   ../assets/items/<id>.webp          : local copies of every icon used
#   cache/items_all/build_report.json  : what came from where, and what failed
#
# usage:  python build_items.py [--no-art] [--retry-art] [--report]
#   --no-art     build from the artwork already on disk, download nothing
#   --retry-art  ask the CDN again for what it did not have last time
#   --report     list every template
# =========================================================

import gzip
import hashlib
import json
import os
import re
import sys
import time
import urllib.request
import urllib.error
from collections import Counter
from concurrent.futures import ThreadPoolExecutor

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from selection import ALIASES  # noqa: E402
import weapons_expand as wx  # noqa: E402
import items_live as lv  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
CACHE = os.path.join(HERE, 'cache')
ASSETS = os.path.join(ROOT, 'assets', 'items')
OUT = os.path.join(ROOT, 'src', 'data', 'items-db.json')
REPORT = os.path.join(CACHE, 'items_all', 'build_report.json')
ART_404 = os.path.join(CACHE, 'items_all', 'art_404.json')
PART_KEYS = os.path.join(HERE, 'part_keys.json')

TDEV = 'https://json.tarkov.dev/regular/'
# sp-tarkov/server-csharp, tag 4.1.2: the newest dump there is. Its items.json
# is a Git-LFS object; the pointer names the sha256 the download is checked
# against, wherever it ends up coming from.
SPT412 = ('https://raw.githubusercontent.com/sp-tarkov/server-csharp/4.1.2/'
          'Libraries/SPTarkov.Server.Assets/SPT_Data/database/')
SPT412_MEDIA = ('https://media.githubusercontent.com/media/sp-tarkov/server-csharp/4.1.2/'
                'Libraries/SPTarkov.Server.Assets/SPT_Data/database/')
SPT412_LFSCONFIG = ['https://raw.githubusercontent.com/sp-tarkov/server-csharp/main/.lfsconfig',
                    'https://raw.githubusercontent.com/sp-tarkov/server-csharp/4.1.2/.lfsconfig']
# sp-tarkov/server, tag 3.10.1: the last tag where items.json is a plain blob
SPT3101 = 'https://raw.githubusercontent.com/sp-tarkov/server/3.10.1/project/assets/database/'
# The picture of an item is its render alone, on nothing: the tile's colour, its
# frame and the name in its corner are drawn by the page, as the client draws
# them, so the name can follow the interface language and the same picture
# can sit in a slot at another size. (The CDN's grid image has all three
# baked in.)
ART_URL = 'https://assets.tarkov.dev/{id}-base-image.webp'

UA = {'User-Agent': ('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
                     '(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36')}
# the CDN is somebody else's: a handful of connections, and back off on error
ART_WORKERS = 6


# ---------------------------------------------------------
# fetching and caching
# ---------------------------------------------------------
def fetch(url, dest=None, binary=False, retries=4, headers=None, data=None, missing=None):
    """
    The body of `url`, or None. A 404 is an answer, not a failure: it is not
    retried, and `missing` (a list) is told about it so the caller can tell
    "is not there" from "could not be reached".
    """
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={**UA, **(headers or {})}, data=data)
            with urllib.request.urlopen(req, timeout=120) as r:
                body = r.read()
            if dest:
                os.makedirs(os.path.dirname(dest), exist_ok=True)
                with open(dest, 'wb') as f:
                    f.write(body)
            return body if binary else body.decode('utf-8')
        except urllib.error.HTTPError as e:
            if e.code == 404:
                if missing is not None:
                    missing.append(url)
                return None
            time.sleep(1.5 * (attempt + 1))
        except Exception:
            time.sleep(1.5 * (attempt + 1))
    return None


def cached_json(url, name):
    path = os.path.join(CACHE, name)
    if os.path.exists(path) and os.path.getsize(path) > 1000:
        with open(path, encoding='utf-8') as f:
            return json.load(f)
    print(f'  downloading {name} ...')
    txt = fetch(url)
    if txt is None:
        raise SystemExit(f'failed to download {url}')
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8', newline='\n') as f:
        f.write(txt)
    return json.loads(txt)


def cached_lfs_json(rel, name):
    """
    A Git-LFS file of the 4.1.2 dump. The pointer on raw.githubusercontent.com
    gives the object's sha256 and size; the object itself is looked for on
    GitHub's media host and then on the LFS server the repository's own
    .lfsconfig names, and is only kept if the hash matches.
    """
    path = os.path.join(CACHE, name)
    if os.path.exists(path) and os.path.getsize(path) > 1000:
        with open(path, encoding='utf-8') as f:
            return json.load(f)
    print(f'  downloading {name} (Git-LFS) ...')
    pointer = fetch(SPT412 + rel) or ''
    m = re.search(r'oid sha256:([0-9a-f]{64})\s+size (\d+)', pointer)
    if not m:
        raise SystemExit(f'no LFS pointer at {SPT412 + rel}')
    oid, size = m.group(1), int(m.group(2))
    sources = [lambda: fetch(SPT412_MEDIA + rel, binary=True)]
    for cfg_url in SPT412_LFSCONFIG:
        cfg = fetch(cfg_url) or ''
        mm = re.search(r'url\s*=\s*(\S+)', cfg)
        if mm:
            sources.append(lambda base=mm.group(1): _lfs_object(base, oid, size))
    for get in sources:
        body = get()
        if body and hashlib.sha256(body).hexdigest() == oid:
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, 'wb') as f:
                f.write(body)
            return json.loads(body.decode('utf-8'))
    raise SystemExit(f'could not fetch LFS object {oid} for {rel}')


def _lfs_object(base, oid, size):
    lfs = {'Accept': 'application/vnd.git-lfs+json', 'Content-Type': 'application/vnd.git-lfs+json'}
    ask = json.dumps({'operation': 'download', 'transfers': ['basic'],
                      'objects': [{'oid': oid, 'size': size}]}).encode()
    txt = fetch(base.rstrip('/') + '/objects/batch', headers=lfs, data=ask)
    try:
        act = json.loads(txt)['objects'][0]['actions']['download']
    except Exception:
        return None
    return fetch(act['href'], binary=True, headers=act.get('header') or {})


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


def webp_has_alpha(data):
    """whether a webp buffer carries transparency: a base image does, a grid image does not"""
    if not data or len(data) < 32 or data[:4] != b'RIFF' or data[8:12] != b'WEBP':
        return False
    fmt = data[12:16]
    if fmt == b'VP8X':
        return bool(data[20] & 0x10)
    if fmt == b'VP8L':
        return bool((int.from_bytes(data[21:25], 'little') >> 28) & 1)
    return False


# ---------------------------------------------------------
# medical / provisions: what a med does, straight from the template
#
# EFT keeps the whole medical model on the item: how long a use takes,
# how many HP one use of a medkit can put back, which conditions it removes
# and what that costs out of its resource pool, and what a ration does to
# energy and hydration. Stims name a buff set in globals (BuffsPropital ...)
# which the client interprets by name; the dataset lists the same effects
# resolved, and those ride along as `fx`.
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


def stim_effects(it):
    """the dataset's resolved effect list, compact: [{type, v, delay, dur, ...}]"""
    out = []
    for e in ((it or {}).get('properties') or {}).get('stimEffects') or []:
        rec = {'type': e.get('type')}
        if e.get('skill'):
            rec['skill'] = e['skill']
        if e.get('value'):
            rec['v'] = wx._num(e['value'], 4)
        if e.get('percent'):
            rec['pct'] = True
        if e.get('delay'):
            rec['delay'] = wx._num(e['delay'])
        if e.get('duration'):
            rec['dur'] = wx._num(e['duration'])
        if e.get('chance') not in (None, 1):
            rec['chance'] = wx._num(e['chance'], 3)
        out.append(rec)
    return out


# ---------------------------------------------------------
# the footprint a built gun has, the way the game's model computes it
# ---------------------------------------------------------
def tree_footprint(tpl, tree, out):
    """(w, h) of template `tpl` with preset `tree` on it; `out` is the database so far"""
    mx, add = [0, 0, 0, 0], [0, 0, 0, 0]

    def walk(t):
        for rec in (t or {}).values():
            part = out.get(rec['t'])
            xs = (part or {}).get('mod', {}).get('xs')
            if xs:
                if part['mod'].get('xsAdd'):
                    for i in range(4):
                        add[i] += xs[i]
                else:
                    for i in range(4):
                        mx[i] = max(mx[i], xs[i])
            walk(rec.get('s'))
    walk(tree)
    return (max(1, tpl['w'] + mx[0] + mx[1] + add[0] + add[1]),
            max(1, tpl['h'] + mx[2] + mx[3] + add[2] + add[3]))


def tree_ids(tree, out=None):
    out = [] if out is None else out
    for rec in (tree or {}).values():
        out.append(rec['t'])
        tree_ids(rec.get('s'), out)
    return out


def map_tree(tree, key_of):
    """an id tree as a key tree"""
    out = {}
    for slot, rec in (tree or {}).items():
        r = {'t': key_of(rec['t'])}
        if rec.get('s'):
            r['s'] = map_tree(rec['s'], key_of)
        out[slot] = r
    return out


# ---------------------------------------------------------
def plan_sizes():
    """each pocket map's size in pixels at full scale, by plan name"""
    path = os.path.join(HERE, 'cache', 'client', 'index.json')
    if not os.path.exists(path):
        return {}
    with open(path, encoding='utf-8') as f:
        plans = json.load(f).get('pocket_maps') or []
    return {p['plan']: [p['size'][0] * p['scale'], p['size'][1] * p['scale']] for p in plans}


PLAN_SIZES = plan_sizes()


def main():
    report_mode = '--report' in sys.argv
    no_art = '--no-art' in sys.argv
    t_start = time.time()

    # =====================================================
    print('[1/7] loading source data')
    live = lv.Live(cached_json(TDEV + 'items', 'tdev/items.json'),
                   cached_json(TDEV + 'items_en', 'tdev/items_en.json'))
    tasks = cached_json(TDEV + 'tasks', 'tdev/tasks.json')['data']
    tasks_en = cached_json(TDEV + 'tasks_en', 'tdev/tasks_en.json')
    tasks_en = tasks_en.get('data', tasks_en)
    spt412 = cached_lfs_json('templates/items.json', 'spt412/items.json')
    g412 = cached_json(SPT412 + 'globals.json', 'spt412/globals.json')
    hb412 = cached_json(SPT412 + 'templates/handbook.json', 'spt412/handbook.json')
    en412 = cached_json(SPT412 + 'locales/global/en.json', 'spt412/en.json')
    spt3101 = cached_json(SPT3101 + 'templates/items.json', 'items_3101.json')
    g3101 = cached_json(SPT3101 + 'globals.json', 'globals_3101.json')

    hb_price = {i['Id']: int(i.get('Price') or 0) for i in hb412['Items']}
    presets_g = dict(g3101.get('ItemPresets') or g3101.get('config', {}).get('ItemPresets') or {})
    presets_g.update(g412.get('ItemPresets') or {})
    print(f'      tarkov.dev items: {len(live.items)}   SPT 4.1.2 templates: {len(spt412)}   '
          f'3.10.1: {len(spt3101)}   globals presets: {len(presets_g)}')

    def spt_node(iid):
        """(node, which dump) for an item template"""
        n = spt412.get(iid)
        if n and n.get('_type') == 'Item':
            return n, '4.1.2'
        n = spt3101.get(iid)
        if n and n.get('_type') == 'Item':
            return n, '3.10.1'
        return None, None

    def spt_chain(iid):
        """the category chain of a template, most specific first, from its parents"""
        chain, cur = [], (spt412.get(iid) or spt3101.get(iid) or {}).get('_parent')
        while cur and len(chain) < 12:
            chain.append(cur)
            cur = (spt412.get(cur) or spt3101.get(cur) or {}).get('_parent')
        return chain

    # =====================================================
    print('[2/7] the item list')
    aliases = {iid: key for iid, key in ALIASES}
    with open(PART_KEYS, encoding='utf-8') as f:
        aliases.update(json.load(f))
    if len(set(aliases.values())) != len(aliases):
        raise SystemExit('duplicate slug in selection.py / part_keys.json')

    live_ids = [i for i, it in live.items.items() if not live.is_preset(it)]
    preset_ids = [i for i, it in live.items.items() if live.is_preset(it)]
    # a slug whose item the live game no longer lists: kept, from the dumps,
    # and kept in the slots that took it (items_live.spt_slots)
    legacy_ids = [i for i in aliases if i not in live.items]
    quest = {i: q for i, q in (tasks.get('questItems') or {}).items()
             if i not in live.items and i not in aliases}
    quest_ids = list(quest)
    keys = {i: aliases.get(i, i) for i in live_ids + legacy_ids + quest_ids + preset_ids}
    key_of = keys.get
    print(f'      live items: {len(live_ids)}   presets: {len(preset_ids)}   quest items: {len(quest_ids)}   '
          f'slugs: {len(aliases)} ({len(legacy_ids)} no longer listed live)')

    # =====================================================
    print('[3/7] templates: live numbers over the dumps')
    donors = lv.Donors(live, spt412)
    equip = lv.equip_filters(spt412)
    # what an item nobody resembles falls back on: the commonest value there is
    all_props = [n['_props'] for n in spt412.values() if n.get('_type') == 'Item']
    generic = {k: Counter(p.get(k) for p in all_props if p.get(k) is not None).most_common(1)[0][0]
               for k in ('ItemSound', 'ExaminedByDefault', 'ExamineTime', 'ExamineExperience',
                         'LootExperience', 'StackMaxSize', 'BackgroundColor')}

    recs = {}
    src_count = Counter()
    legacy = set(legacy_ids)
    for iid in live_ids:
        it = live.items[iid]
        node, src = spt_node(iid)
        rec = {'id': iid, 'key': keys[iid], 'it': it, 'kind': 'live',
               'chain': list(it.get('categories') or []), 'hb': list(it.get('handbookCategories') or []),
               'types': list(it.get('types') or [])}
        if node:
            rec['props'] = lv.live_props(it, node['_props'], keep=legacy)
            rec['src'] = src
        else:
            did, score = donors.pick(it)
            base = spt412[did]['_props'] if did else generic
            rec['props'] = lv.live_props(it, base, fresh=True)
            rec['src'] = 'tarkov.dev'
            rec['donor'] = did
            rec['donor_score'] = score
        src_count[rec['src']] += 1
        recs[iid] = rec
    for iid in legacy_ids:
        node, src = spt_node(iid)
        if not node:
            raise SystemExit(f'{aliases[iid]} ({iid}) is in neither tarkov.dev nor the dumps')
        props = dict(node['_props'])
        props['Slots'] = [s for s in (props.get('Slots') or []) if not lv.is_armor_slot(s)]
        recs[iid] = {'id': iid, 'key': keys[iid], 'it': None, 'kind': 'legacy', 'props': props,
                     'src': src, 'chain': spt_chain(iid), 'hb': [], 'types': []}
        src_count[src + ' (not listed live)'] += 1
    for iid in quest_ids:
        node, src = spt_node(iid)
        q = quest[iid]
        props = dict(node['_props']) if node else dict(generic)
        props['Width'], props['Height'] = q['width'], q['height']
        props['Slots'], props['Grids'] = [], []
        recs[iid] = {'id': iid, 'key': keys[iid], 'it': None, 'kind': 'quest', 'quest': q, 'props': props,
                     'src': src or 'tarkov.dev', 'chain': spt_chain(iid) if node else [], 'hb': [], 'types': []}
        src_count['quest: ' + (src or 'tarkov.dev')] += 1

    # --- gameplay category and part family, from the category chain ---
    def base_cat(rec):
        if rec['kind'] == 'quest':
            return 'quest'
        cat = live.cat_of(rec['chain'])
        if cat in ('weapon', 'pistol'):
            donor_cat = None
            if rec.get('donor'):
                d = recs.get(rec['donor'])
                donor_cat = d['cat'] if d and 'cat' in d else None
            cat = lv.weapon_cat(rec['id'], rec['chain'], rec['props'], equip, donor_cat)
        return cat

    # donors are templates of the dumps, so they get their category first
    for rec in sorted(recs.values(), key=lambda r: bool(r.get('donor'))):
        rec['cat'] = base_cat(rec)
        if rec['cat'] is None:
            raise SystemExit(f"no category for {rec['id']} {rec['chain']}")
        rec['modType'] = live.mod_type_of(rec['chain']) if rec['cat'] in ('mod', 'mag') else None
        if rec['cat'] == 'mag':
            wx.cylinder_chambers(rec['props'])
    cat_count = Counter(r['cat'] for r in recs.values())
    print('      ' + ', '.join(f'{v} {k}' for k, v in sorted(cat_count.items())))
    print('      sources: ' + ', '.join(f'{v} {k}' for k, v in sorted(src_count.items())))

    def is_part(tid):
        r = recs.get(tid)
        return bool(r) and r['cat'] != 'ammo'

    # =====================================================
    print('[4/7] presets')
    default_g = {}
    for pid, pr in presets_g.items():
        enc = pr.get('_encyclopedia')
        if enc and enc in recs and wx.preset_root(pr) == enc and enc not in default_g:
            default_g[enc] = pid

    def mod_slots(iid):
        """[(slot name, allowed ids)] of an item's part slots, plate slots included"""
        r = recs.get(iid)
        if not r:
            return []
        out = [(s['_name'], set(wx._filters(s))) for s in (r['props'].get('Slots') or [])]
        for a in ((r['it'] or {}).get('properties') or {}).get('armorSlots') or []:
            if 'allowedPlates' in a:
                out.append((a['nameId'], set(a['allowedPlates'])))
        return out

    preset_stats = Counter()
    preset_fail = []

    def split_contents(base_id, contained):
        """a preset's flat list -> (part ids, load runs)"""
        parts, load = [], []
        for c in contained:
            cid, n = c['item'], int(c.get('count') or 1)
            if cid == base_id or cid not in recs:
                continue
            if recs[cid]['cat'] == 'ammo':
                load.append({'t': keys[cid], 'n': n})
            else:
                parts.extend([cid] * n)
        return parts, load

    def build_tree(base_id, pid):
        """(id tree, load, source) of preset `pid` on `base_id`; tree None when it cannot be built"""
        P = live.items.get(pid)
        gp = presets_g.get(pid)
        live_parts, load = (None, [])
        if P:
            live_parts, load = split_contents(base_id, P.get('containsItems') or [])
        if gp and wx.preset_root(gp) == base_id:
            gt = wx.preset_tree(gp, lambda i: i if i in recs else None, is_part)
            # a build the live game does not list is only offered when every
            # part of it is carried, or it would lie about itself
            whole = P is not None or recs[base_id]['cat'] not in ('weapon', 'pistol') or all(
                x['_tpl'] in recs for x in gp['_items'] if x.get('parentId'))
            if gt is not None and whole and (live_parts is None or sorted(tree_ids(gt)) == sorted(live_parts)):
                gload = wx.preset_load(gp, key_of) or []
                return gt, (load or gload), 'globals'
        if live_parts is not None:
            if not live_parts:
                return {}, load, 'live'
            t = lv.rebuild_tree(mod_slots(base_id), mod_slots, live_parts)
            if t is not None:
                return t, load, 'live'
        return None, load, 'failed'

    # every preset the live game lists, plus the dump's own builds of a gun
    by_base = {}
    for pid in preset_ids:
        P = live.items[pid]
        b = (P.get('properties') or {}).get('baseItem')
        if b in recs:
            by_base.setdefault(b, []).append(pid)
    for pid, pr in presets_g.items():
        b = wx.preset_root(pr)
        if b in recs and pid not in live.items and recs[b]['cat'] in ('weapon', 'pistol'):
            by_base.setdefault(b, []).append(pid)

    preset_data = {}       # pid -> {base, tree (ids), load, default, src}
    g_order = {pid: i for i, pid in enumerate(presets_g)}
    for b, pids in by_base.items():
        it = recs[b]['it'] or {}
        live_default = (it.get('properties') or {}).get('defaultPreset')
        default_pid = live_default or default_g.get(b)
        if not default_pid:
            # a wearable: its default is the live preset flagged so
            default_pid = next((p for p in pids if p in live.items
                                and (live.items[p].get('properties') or {}).get('default')), None)
        if default_pid and default_pid not in pids:
            pids.append(default_pid)
        # the dump's order first (the build screen has always listed them so),
        # then the builds only the live game knows
        pids.sort(key=lambda p: (p != default_pid, g_order.get(p, len(g_order))))
        for pid in pids:
            tree, load, how = build_tree(b, pid)
            preset_stats[how] += 1
            if tree is None:
                preset_fail.append((pid, b))
                continue
            preset_data[pid] = {'base': b, 'tree': tree, 'load': load, 'default': pid == default_pid, 'src': how}
    # a wearable the dump has a default build for but the live list does not
    for b, pid in default_g.items():
        if b in by_base or recs[b]['cat'] in ('weapon', 'pistol'):
            continue
        tree, load, how = build_tree(b, pid)
        if tree:
            preset_data[pid] = {'base': b, 'tree': tree, 'load': load, 'default': True, 'src': how}
            by_base.setdefault(b, []).append(pid)
    print('      ' + ', '.join(f'{v} {k}' for k, v in sorted(preset_stats.items()))
          + f'   ({len(preset_fail)} could not be built)')

    def default_tree(b):
        for pid in by_base.get(b, []):
            d = preset_data.get(pid)
            if d and d['default']:
                return pid, d
        return None, None

    def split_plates(base_id, tree):
        """a wearable's preset tree -> (plates {slot lower: plate id}, the rest of the tree)"""
        plates, rest = {}, {}
        plate_slots = {a['nameId'] for a in ((recs[base_id]['it'] or {}).get('properties') or {}).get('armorSlots') or []
                       if 'allowedPlates' in a}
        for slot, rec in (tree or {}).items():
            if slot in plate_slots:
                plates[slot.lower()] = rec['t']
            else:
                rest[slot] = rec
        return plates, rest

    # =====================================================
    print(f'[5/7] artwork for {len(recs) + len(preset_data)} templates')
    os.makedirs(ASSETS, exist_ok=True)
    art = {}        # template id -> {'img', 'w', 'h'} | {'why'}

    # what the CDN answered 404 for last time is not asked for again, unless told to
    known_404 = {}
    if os.path.exists(ART_404) and '--retry-art' not in sys.argv:
        with open(ART_404, encoding='utf-8') as f:
            known_404 = json.load(f)
    new_404 = {}

    def grab(job):
        """the picture of one template: (id, {'img', 'w', 'h'[, 'flat']} | {'why'})"""
        tid, url, fn, guess = job
        dest = os.path.join(ASSETS, fn)
        data, fresh, old = None, False, None
        if os.path.exists(dest) and os.path.getsize(dest) > 500:
            with open(dest, 'rb') as f:
                data = f.read()
            # A file with no transparency is a grid image from before the
            # page drew its own tiles: the base image is asked for in its
            # place, and the old one stands in only if there is none.
            if not webp_has_alpha(data):
                old, data = data, None
        if data is None:
            if url in known_404:
                new_404[url] = known_404[url]
            elif not no_art:
                missing = []
                data, fresh = fetch(url, binary=True, missing=missing), True
                if missing:
                    new_404[url] = time.strftime('%Y-%m-%d')
                    data = None
            if data is None:
                if old is None:
                    return tid, {'why': 'not downloaded (--no-art)' if no_art and url not in known_404
                                 else 'no artwork upstream'}
                data, fresh = old, False
        size = webp_size(data) if data else None
        if not size:
            if not fresh and os.path.exists(dest):
                os.remove(dest)
            return tid, {'why': 'download failed' if not data else 'not an image'}
        cells = (max(1, round((size[0] - 1) / 63)), max(1, round((size[1] - 1) / 63)))
        # A picture is only the item's if it is the item's size: 63 px a cell
        # plus one. What is not is somebody else's sprite filed under this id,
        # or a render of the item as it once was, and is not kept; the grid
        # image that was here before stands in if there was one.
        if fresh and guess and cells != guess:
            new_404[url] = 'a %dx%d sprite for a %dx%d item' % (cells + guess)
            if old is None:
                return tid, {'why': 'no artwork upstream'}
            data, fresh = old, False
            size = webp_size(data)
            cells = (max(1, round((size[0] - 1) / 63)), max(1, round((size[1] - 1) / 63)))
        if fresh:
            with open(dest, 'wb') as f:
                f.write(data)
        res = {'img': fn, 'w': cells[0], 'h': cells[1]}
        if not webp_has_alpha(data):
            res['flat'] = True      # a grid image: colour, frame and name are in the picture
        return tid, res

    def art_job(tid, link, fn, size):
        """
        The dataset's own link where it is a base image (a preset may point at
        another id's); the conventional name otherwise - the dataset marks
        some items as having no picture, or only a JPEG, that the CDN does
        have one for - and then the picture has to measure `size`.
        """
        if link and link.endswith('-base-image.webp') and 'unknown-item' not in link:
            return (tid, link, fn, size)
        return (tid, ART_URL.format(id=tid), fn, None if link is None else size)

    jobs = []
    for iid, rec in recs.items():
        link = (rec['it'] or rec.get('quest') or {}).get('baseImageLink')
        jobs.append(art_job(iid, link, iid + '.webp', (int(rec['props'].get('Width') or 1), int(rec['props'].get('Height') or 1))))
    for pid in preset_ids:
        d = preset_data.get(pid)
        if not d:
            continue        # a preset that could not be built is not carried
        P = live.items[pid]
        # the twelve guns' assembled sprites are already on disk under the
        # weapon's id; everything else is filed under the preset's own
        fn = pid + '.webp'
        if d['default'] and os.path.exists(os.path.join(ASSETS, d['base'] + '-preset.webp')):
            fn = d['base'] + '-preset.webp'
        jobs.append(art_job(pid, P.get('baseImageLink'), fn, (P['width'], P['height'])))
    with ThreadPoolExecutor(max_workers=ART_WORKERS) as ex:
        for tid, res in ex.map(grab, jobs):
            art[tid] = res
    if not no_art:
        os.makedirs(os.path.dirname(ART_404), exist_ok=True)
        with open(ART_404, 'w', encoding='utf-8', newline='\n') as f:
            json.dump(dict(sorted(new_404.items())), f, indent=1)
    art_missing = {tid: a['why'] for tid, a in art.items() if 'img' not in a}
    why = Counter(art_missing.values())
    print(f'      {len(art) - len(art_missing)} images, {len(art_missing)} without'
          + (' (' + ', '.join(f'{v} {k}' for k, v in sorted(why.items())) + ')' if why else ''))

    # =====================================================
    print('[6/7] assembling the database')
    out = {}
    warns = []
    cat_ids = set(live.cats)
    # slot id -> (owner item id, slot name), for the conflicts that name a slot
    slot_owner = {sl['id']: (iid, sl['nameId'])
                  for iid in live_ids
                  for sl in ((live.items[iid].get('properties') or {}).get('slots') or []) if sl.get('id')}

    def text(rec):
        iid, it = rec['id'], rec['it']
        if it:
            name = live.T(it['name'], '')
            short = live.T(it['shortName'], '')
            desc = live.T(it.get('description') or '', '')
        elif rec['kind'] == 'quest':
            q = rec['quest']
            name = tasks_en.get(q['name']) or ''
            short = tasks_en.get(q['shortName']) or ''
            desc = tasks_en.get(q.get('description') or '') or ''
        else:
            name = short = desc = ''
        name = name or en412.get(iid + ' Name') or iid
        short = short or en412.get(iid + ' ShortName') or name[:6]
        desc = desc or en412.get(iid + ' Description') or ''
        return name.strip(), short.strip(), re.sub(r'\s+', ' ', desc).strip()[:340]

    def common(tid, key, name, short, desc, cat, w, h, weight, price, stack):
        tpl = {'id': tid, 'name': name, 'short': short, 'desc': desc, 'cat': cat,
               'w': int(w), 'h': int(h), 'weight': round(float(weight or 0), 3),
               'price': int(price or 0), 'stack': int(stack or 1)}
        if tid in aliases:
            tpl['core'] = True
        a = art.get(tid) or {}
        if a.get('img'):
            tpl['img'] = a['img']
            if a.get('flat'):
                tpl['imgFlat'] = True
            if (a['w'], a['h']) != (tpl['w'], tpl['h']):
                warns.append((key, 'sprite %dx%d' % (a['w'], a['h']), 'template %dx%d' % (tpl['w'], tpl['h'])))
        return tpl

    for iid, rec in recs.items():
        key, it, props, cat = rec['key'], rec['it'], rec['props'], rec['cat']
        pr = (it or {}).get('properties') or {}
        name, short, desc = text(rec)
        if it:
            price = it.get('basePrice') or 0
        else:
            price = hb_price.get(iid, 0)
        tpl = common(iid, key, name, short, desc, cat, props.get('Width') or 1, props.get('Height') or 1,
                     props.get('Weight'), price, props.get('StackMaxSize') or 1)
        if rec['chain']:
            tpl['cats'] = rec['chain']
        if rec['hb']:
            tpl['hb'] = rec['hb']
        if rec['types']:
            tpl['types'] = rec['types']
        bg = props.get('BackgroundColor')
        if bg:
            tpl['bg'] = bg

        # Which foley the item makes when it is picked up, dropped or used.
        # This is the game's own per-template field, so a helmet lands like a
        # helmet and a pill bottle rattles, instead of everything in a
        # category sharing one guessed sound.
        if props.get('ItemSound'):
            tpl['snd'] = props['ItemSound']
        # examination: most templates are known on sight, the rest have to be
        # inspected before their name and stats are revealed
        if props.get('ExaminedByDefault'):
            tpl['known'] = True
        if props.get('ExamineTime'):
            tpl['examineTime'] = float(props['ExamineTime'])
        if props.get('ExamineExperience'):
            tpl['examineXp'] = int(props['ExamineExperience'])
        if props.get('LootExperience'):
            tpl['lootXp'] = int(props['LootExperience'])
        if props.get('DiscardLimit') not in (None, -1):
            tpl['discard'] = int(props['DiscardLimit'])
        if cat == 'money':
            tpl['alwaysExamined'] = True
        if cat == 'quest':
            tpl['quest'] = True

        # --- container grids, each with the filter the template gives it ---
        if cat != 'lootbox':
            grids, filters = lv.grids_of(props, key_of, cat_ids, live.root)
            if grids:
                tpl['container'] = {'grids': grids}
                # a rig's pouches are not a row of boxes: the client places each
                # by a layout it names here (tools/build_layouts.py reads them)
                layout = props.get('RigLayoutName') or props.get('GridLayoutName')
                if layout and len(grids) > 1:
                    tpl['container']['layout'] = layout
                if any(filters):
                    if all(f == filters[0] for f in filters):
                        tpl['container']['filter'] = filters[0]
                    else:
                        tpl['container']['filters'] = filters

        # --- a plan map: the plan it unfolds to, how far it zooms, how many
        # markers it takes; the plan's size at full scale is the client's own
        # (tools/cache/client/index.json), where that has been extracted ---
        if 'PocketMap' in str(props.get('ConfigPathStr') or ''):
            plan = props['ConfigPathStr'].split('/')[-2].lower()
            tpl['map'] = {'plan': plan, 'min': props.get('scaleMin'), 'max': props.get('scaleMax'),
                          'markers': props.get('MaxMarkersCount')}
            if plan in PLAN_SIZES:
                tpl['map']['size'] = PLAN_SIZES[plan]

        # --- meds, food and drink ---
        if props.get('MaxHpResource'):
            tpl['res'] = {'max': int(props['MaxHpResource'])}
            if props.get('hpResourceRate'):
                tpl['heal'] = int(props['hpResourceRate'])
        elif props.get('MaxResource') and (cat in ('food', 'drink', 'meds')
                                         or pr.get('propertiesType') == 'ItemPropertiesResource'):
            # a ration's bites, a fuel tank's litres, a filter's hours
            tpl['res'] = {'max': int(props['MaxResource'])}
        if cat in ('meds', 'food', 'drink'):
            tpl['med'] = med_fields(props, cat)
            fx = stim_effects(it)
            if fx:
                tpl['med']['fx'] = fx
            # a med with no resource pool - an injector, a tourniquet - is one use
            if cat == 'meds':
                tpl.setdefault('res', {'max': 1})
        if props.get('MaximumNumberOfUsage'):
            tpl['uses'] = int(props['MaximumNumberOfUsage'])

        # --- what a card shows at a glance ---
        if cat == 'ammo' and props.get('Damage'):
            tpl['dmg'] = int(props['Damage'])
        if cat == 'ammo' and props.get('PenetrationPower'):
            tpl['pen'] = int(props['PenetrationPower'])
        if props.get('Ergonomics') and cat in ('weapon', 'pistol', 'mod', 'mag', 'nvg', 'gearmod'):
            tpl['ergo'] = wx._num(props['Ergonomics'])
        if props.get('bFirerate') and cat in ('weapon', 'pistol'):
            tpl['rpm'] = int(props['bFirerate'])
        if cat in ('weapon', 'pistol', 'ammo', 'flare'):
            cal = wx.caliber(props)
            if cal:
                tpl['cal'] = cal

        # --- worn gear ---
        wearable = cat in ('armor', 'rig', 'helmet', 'facecover', 'glasses', 'headset', 'backpack',
                           'plate', 'gearmod', 'armband', 'nvg')
        if wearable:
            if props.get('speedPenaltyPercent'):
                tpl['speedPen'] = float(props['speedPenaltyPercent'])
            if props.get('mousePenalty'):
                tpl['turnPen'] = wx._num(props['mousePenalty'])
            if props.get('weaponErgonomicPenalty'):
                tpl['ergoPen'] = wx._num(props['weaponErgonomicPenalty'])
            blocks = [slot for flag, slot in (('BlocksEarpiece', 'ears'), ('BlocksEyewear', 'eyes'),
                                              ('BlocksFaceCover', 'face'), ('BlocksHeadwear', 'head'),
                                              ('BlocksArmorVest', 'armor')) if props.get(flag)]
            if blocks:
                tpl['blocks'] = blocks
            if props.get('DeafStrength') and props['DeafStrength'] != 'None':
                tpl['deaf'] = props['DeafStrength']
            if props.get('BlindnessProtection'):
                tpl['blind'] = wx._num(props['BlindnessProtection'])
            if it:
                _pid, d = default_tree(iid)
                plates, _rest = split_plates(iid, d['tree']) if d else ({}, {})
                st, summary = lv.armor_of(live, it, key_of, plates, props.get('armorColliders') or ())
                if st and (st.get('ins') or st.get('slots') or summary):
                    tpl['armor'] = st
                tpl.update(summary)
        if cat == 'headset' and pr.get('propertiesType') == 'ItemPropertiesHeadphone':
            hs = {}
            for k_out, k_in in (('amb', 'ambientVolume'), ('dry', 'dryVolume'), ('dist', 'distanceModifier'),
                                ('distort', 'distortion'), ('att', 'compressorAttack'), ('rel', 'compressorRelease'),
                                ('gain', 'compressorGain'), ('thr', 'compressorThreshold')):
                wx._put(hs, k_out, wx._num(pr.get(k_in), 4))
            if hs:
                tpl['hs'] = hs
        if cat == 'nvg' and pr.get('propertiesType') == 'ItemPropertiesNightVision':
            nv = {}
            for k_out, k_in in (('intensity', 'intensity'), ('noise', 'noiseIntensity'),
                                ('noiseScale', 'noiseScale'), ('diffuse', 'diffuseIntensity')):
                wx._put(nv, k_out, wx._num(pr.get(k_in), 4))
            if nv:
                tpl['nvg'] = nv

        # --- weapon system: slots, parts, ballistics ---
        slots = wx.slots_of(props, key_of)
        if slots:
            for sl in slots:
                sl['label'] = wx.slot_label(sl['n'])
            tpl['slots'] = slots
        conf = sorted({c for c in (key_of(c) for c in (props.get('ConflictingItems') or [])) if c})
        if conf:
            tpl['conflicts'] = conf
        # the few that rule out a whole category (a mandible and thermal
        # goggles) or one slot of one item (a headset and a helmet's shield)
        if it and it.get('conflictingCategories'):
            tpl['conflictCats'] = list(it['conflictingCategories'])
        cs = [slot_owner[s] for s in ((it or {}).get('conflictingSlotIds') or []) if s in slot_owner]
        if cs:
            tpl['conflictSlots'] = [[keys[o], n] for o, n in cs]
        if cat in ('weapon', 'pistol'):
            tpl['wpn'] = wx.weapon_fields(props, key_of)
            if props.get('weapFireType'):
                tpl['fire'] = list(props['weapFireType'])
        elif cat == 'mag':
            mg = wx.mag_fields(props, key_of)
            tpl['magSize'] = mg.pop('size', 0)
            tpl['ammoFilter'] = mg.pop('ammo', [])
            tpl['mag'] = mg
            mf = wx.mod_fields(props)
            if mf:
                tpl['mod'] = mf
            tpl['modType'] = 'magazine'
            # the calibre is the one most of the rounds it takes are in: an
            # AKM mag also lists .366 TKM for the VPO-209, and that must not
            # relabel it
            votes = Counter()
            cal_of = {}
            for a in wx._filters((props.get('Cartridges') or [{}])[0]):
                if a in recs and recs[a]['cat'] == 'ammo':
                    cal_of[keys[a]] = wx.caliber(recs[a]['props'])
                    votes[cal_of[keys[a]]] += 1
            if votes:
                top = max(votes.values())
                tpl['cal'] = next(c for c in votes if votes[c] == top)
                # the game takes the first round of the list for the magazine's
                # own - what a magazine found loaded has in it - so the rounds
                # of its calibre lead, each group in the dataset's order
                tpl['ammoFilter'].sort(key=lambda k: cal_of.get(k) != tpl['cal'])
        elif cat in ('mod', 'nvg', 'gearmod'):
            mf = wx.mod_fields(props)
            if cat == 'mod':
                tpl['mod'] = mf
                tpl['modType'] = rec['modType'] or 'aux'
            elif mf:
                tpl['mod'] = mf
        if cat == 'ammo':
            tpl['ammo'] = wx.ammo_fields(props)
        elif cat == 'ammobox':
            # a box of one round type, unpacked into stacks. The handbook
            # prices every box at a flat 1000, so a box is priced as its rounds
            # and the handbook's number rides along as basePrice.
            inside = None
            if it and it.get('containsItems'):
                c = it['containsItems'][0]
                inside = (c['item'], int(c.get('count') or 0))
            else:
                ss = (props.get('StackSlots') or [{}])[0]
                ids = wx._filters(ss)
                if ids:
                    inside = (ids[0], int(ss.get('_max_count') or 0))
            if inside and inside[0] in recs and inside[1] > 0:
                rid, n = inside
                tpl['box'] = {'t': keys[rid], 'n': n}
                tpl['cal'] = wx.caliber(recs[rid]['props'])
                round_price = int((recs[rid]['it'] or {}).get('basePrice') or hb_price.get(rid, 0))
                if round_price:
                    tpl['basePrice'] = tpl['price']
                    tpl['price'] = round_price * n
        elif cat == 'grenade':
            g = {}
            wx._put(g, 'type', (props.get('ThrowType') or '').replace('_grenade', ''))
            wx._put(g, 'fuse', wx._num(props.get('explDelay')))
            wx._put(g, 'min', wx._num(props.get('MinExplosionDistance')))
            wx._put(g, 'max', wx._num(props.get('MaxExplosionDistance')))
            wx._put(g, 'frags', wx._num(props.get('FragmentsCount')))
            wx._put(g, 'contusion', wx._num(props.get('ContusionDistance')))
            wx._put(g, 'strength', wx._num(props.get('Strength')))
            wx._put(g, 'emit', wx._num(props.get('EmitTime')))
            tpl['grenade'] = g
            tpl['frag'] = g.get('type') == 'frag' or (not g.get('type') and bool(g.get('frags')))
        elif cat == 'melee':
            m = {}
            wx._put(m, 'slash', wx._num(props.get('knifeHitSlashDam')))
            wx._put(m, 'stab', wx._num(props.get('knifeHitStabDam')))
            wx._put(m, 'radius', wx._num(props.get('knifeHitRadius')))
            wx._put(m, 'slashPen', wx._num(props.get('SlashPenetration')))
            wx._put(m, 'stabPen', wx._num(props.get('StabPenetration')))
            wx._put(m, 'dura', wx._num(props.get('MaxDurability')))
            tpl['melee'] = m
            if m.get('slash') or m.get('stab'):
                tpl['dmg'] = max(m.get('slash') or 0, m.get('stab') or 0)
        elif cat == 'repairkit':
            kind = {'Firearms': 'weapon', 'Armor': 'armor'}.get(props.get('RepairType'), 'weapon')
            mx = int(props.get('MaxRepairResource') or 0)
            tpl['repairKit'] = {'max': mx, 'type': kind}
            if mx:
                tpl['res'] = {'max': mx}
        out[key] = tpl

    # --- presets: the tree on the gun, the builds the factory and the traders know ---
    foot_bad = []
    for b, pids in by_base.items():
        base = out[recs[b]['key']]
        for pid in pids:
            d = preset_data.get(pid)
            if not d:
                continue
            P = live.items.get(pid)
            gp = presets_g.get(pid)
            is_weapon = recs[b]['cat'] in ('weapon', 'pistol')
            plates, rest = ({}, d['tree']) if is_weapon else split_plates(b, d['tree'])
            tree = map_tree(rest, key_of)
            # the default build goes by the game's own name for it ("AKM
            # Default"); the others keep the dump's internal name where they
            # have one - the build screen shows their label, not this
            lname = live.T(P['shortName'], '') if P else ''
            gname = (gp or {}).get('_name')
            pname = (lname or gname or pid) if d['default'] else (gname or lname or pid)
            full = live.T(P['name'], '') if P else ''
            label = en412.get(pid) or en412.get(pid + ' Name')
            if not label and full.startswith(base['name']):
                label = full[len(base['name']):].strip()
            if d['default']:
                if tree:
                    base['preset'] = tree
                    base['presetName'] = pname
                if is_weapon and tree:
                    # The assembled size is worked out the way the game's model
                    # does it (ExtraSize per part) and has to be what the
                    # dataset says the preset measures. tarkov.dev also draws
                    # the assembled preset; that sprite is what a built gun
                    # shows in the grid, and its size is the second witness.
                    fw, fh = tree_footprint(base, tree, out)
                    base['presetSize'] = [fw, fh]
                    if P and (fw, fh) != (P['width'], P['height']):
                        foot_bad.append((recs[b]['key'], base['name'], [fw, fh], [P['width'], P['height']]))
                    a = art.get(pid) or {}
                    if a.get('img'):
                        base['presetImg'] = a['img']
                        if a.get('flat'):
                            base['presetFlat'] = True
                        if (a['w'], a['h']) != (fw, fh):
                            warns.append((recs[b]['key'], 'preset sprite %dx%d' % (a['w'], a['h']),
                                          'assembled %dx%d (%s)' % (fw, fh, base['name'])))
                        if os.path.exists(os.path.join(ASSETS, b + '-preset-lg.webp')):
                            base['presetLg'] = True
            elif is_weapon:
                alt = {'id': pid, 'name': pname, 'tree': tree}
                if label:
                    alt['label'] = label
                if d['load']:
                    alt['load'] = d['load']
                base['wpn'].setdefault('alts', []).append(alt)
            # the preset as something a trader can list: a template of its
            # own that names what it is a build of
            if P:
                name = full or pname
                short = live.T(P['shortName'], '') or name[:12]
                ptpl = common(pid, pid, name, short, base['desc'], 'preset', P['width'], P['height'],
                              P['weight'], P.get('basePrice'), 1)
                ptpl['base'] = recs[b]['key']
                if d['default']:
                    ptpl['def'] = True
                if base.get('bg'):
                    ptpl['bg'] = base['bg']
                if base.get('snd'):
                    ptpl['snd'] = base['snd']
                ptpl['known'] = True
                if P.get('types'):
                    ptpl['types'] = list(P['types'])
                if base.get('cats'):
                    ptpl['cats'] = base['cats']
                if P.get('handbookCategories'):
                    ptpl['hb'] = list(P['handbookCategories'])
                if not is_weapon:
                    if plates:
                        ptpl['plates'] = {s: key_of(t) for s, t in plates.items()}
                    if tree:
                        ptpl['tree'] = tree
                out[pid] = ptpl
    for pid in preset_ids:
        if pid not in out:
            P = live.items[pid]
            b = (P.get('properties') or {}).get('baseItem')
            warns.append((pid, 'preset not carried', live.T(P['name'], '') + (' (no base)' if b not in recs else ' (tree could not be built)')))

    # default magazine of a gun newer than the dumps: the one its default build carries
    for iid, rec in recs.items():
        if rec['cat'] in ('weapon', 'pistol'):
            tpl = out[rec['key']]
            mag = (tpl.get('preset') or {}).get('mod_magazine')
            if mag and not tpl['wpn'].get('defMag'):
                tpl['wpn']['defMag'] = mag['t']
            fs = tpl['wpn'].get('foldSlot')
            if fs and not any(s['n'] == fs for s in tpl.get('slots') or []):
                del tpl['wpn']['foldSlot']

    # =====================================================
    # checks
    problems = []
    for key, tpl in out.items():
        for sl in tpl.get('slots') or []:
            for k in sl['f']:
                if k not in out:
                    problems.append(f'{key}: slot {sl["n"]} names {k}')
        for k in tpl.get('ammoFilter') or []:
            if out.get(k, {}).get('cat') != 'ammo':
                problems.append(f'{key}: ammo filter names {k}')
        for k in tpl.get('conflicts') or []:
            if k not in out:
                problems.append(f'{key}: conflict names {k}')
        for k in tree_ids(tpl.get('preset')):
            if k not in out:
                problems.append(f'{key}: preset names {k}')
        if tpl.get('box') and tpl['box']['t'] not in out:
            problems.append(f'{key}: box names {tpl["box"]["t"]}')
        if tpl.get('cat') == 'preset' and tpl['base'] not in out:
            problems.append(f'{key}: preset of {tpl["base"]}')
    ids_seen = Counter(t['id'] for t in out.values())
    dup = [i for i, n in ids_seen.items() if n > 1]
    if dup:
        problems.append('duplicate ids: ' + ', '.join(dup))
    if problems:
        print(f'      !! {len(problems)} integrity problems:')
        for p in problems[:40]:
            print('         - ' + p)
    if foot_bad:
        print(f'      !! {len(foot_bad)} default builds whose footprint is not the preset\'s:')
        for row in foot_bad:
            print('         - %s  %s: built %s, preset %s' % tuple(row))
    if warns:
        print('      note: %d field disagreements:' % len(warns))
        for key, a, b in warns[:60]:
            print('         - %s: %s  vs  %s' % (key, a, b))
    suspicious = [t for t in out.values()
                  if t['w'] * t['h'] == 1 and t.get('core')
                  and t['cat'] in ('weapon', 'pistol', 'armor', 'backpack', 'rig', 'helmet', 'secure')]
    if suspicious:
        print(f'      !! {len(suspicious)} gear items resolved to a 1x1 icon (likely a CDN placeholder):')
        for t in suspicious:
            print(f'         - {t["name"]}')

    if report_mode:
        print('\n--- resolution report ---')
        for key, t in sorted(out.items(), key=lambda kv: (kv[1]['cat'], kv[0])):
            g = t.get('container', {}).get('grids')
            gs = ' [' + '+'.join('%dx%d' % (a, b) for a, b in g) + ']' if g else ''
            print('  %-11s %-24s %dx%-2d %6.2fkg %8d %8s  %s%s' % (
                t['cat'], key, t['w'], t['h'], t['weight'],
                t['price'], t.get('bg', '-'), t['name'], gs))

    # =====================================================
    print('\n[7/7] writing', OUT)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    blob = json.dumps(out, ensure_ascii=False, separators=(',', ':'), sort_keys=True)
    with open(OUT, 'w', encoding='utf-8', newline='\n') as f:
        f.write(blob)
    raw = len(blob.encode('utf-8'))
    gz = len(gzip.compress(blob.encode('utf-8'), 9))

    used = {t['img'] for t in out.values() if 'img' in t}
    used |= {t['presetImg'] for t in out.values() if 'presetImg' in t}
    used |= {t['id'] + '-preset-lg.webp' for t in out.values() if t.get('presetLg')}
    on_disk = [f for f in os.listdir(ASSETS) if f.endswith('.webp')]
    stray = sorted(f for f in on_disk if f not in used)
    total = sum(os.path.getsize(os.path.join(ASSETS, f)) for f in on_disk)

    tdev_only = [r for r in recs.values() if r['src'] == 'tarkov.dev' and r['kind'] == 'live']
    os.makedirs(os.path.dirname(REPORT), exist_ok=True)
    with open(REPORT, 'w', encoding='utf-8', newline='\n') as f:
        json.dump({
            'templates': len(out),
            'by_cat': dict(sorted(Counter(t['cat'] for t in out.values()).items())),
            'core': sum(1 for t in out.values() if t.get('core')),
            'sources': dict(sorted(src_count.items())),
            'presets': {'built': dict(preset_stats), 'failed': preset_fail,
                        'carried': sum(1 for t in out.values() if t['cat'] == 'preset')},
            'tdev_only': [{'id': r['id'], 'name': out[r['key']]['name'], 'cat': r['cat'],
                           'donor': r.get('donor'), 'donor_name': out[keys[r['donor']]]['name'] if r.get('donor') else None,
                           'score': r.get('donor_score')} for r in tdev_only],
            'no_art': {tid: why_ for tid, why_ in sorted(art_missing.items())},
            'sprite_vs_template': warns,
            'footprint_mismatch': foot_bad,
            'problems': problems,
            'stray_artwork': stray,
            'size': {'raw': raw, 'gzip': gz},
            'artwork': {'files': len(on_disk), 'bytes': total},
        }, f, ensure_ascii=False, indent=1)
    print(f'done: {len(out)} templates ({raw / 1e6:.2f} MB, {gz / 1e6:.2f} MB gzipped), '
          f'artwork {total / 1048576:.1f} MiB in {len(on_disk)} files, {time.time() - t_start:.0f}s')
    if stray:
        print(f'      note: {len(stray)} artwork files no template uses (left alone): ' + ', '.join(stray[:6])
              + (' ...' if len(stray) > 6 else ''))
    return 1 if problems else 0


if __name__ == '__main__':
    sys.exit(main())
