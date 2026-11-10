#!/usr/bin/env python3
# =========================================================
# ESCAPE 2D - what things are called in another language
#
# The data files under src/data/ carry the game's English: item names, task
# texts, what a trader says. The game itself ships all of that in every
# language it supports, and the two sources this project reads keep those
# translations beside the English: tarkov.dev's static dataset has a table a
# language for each of its files (items_ko, tasks_ko, traders_ko, maps_ko,
# hideout_ko - keyed by the same string keys the English tables use), and the
# client's own locale (the SPT dump) has the texts tarkov.dev does not carry
# (what a trader says when he hands a task out and takes it back, his full
# name, where he sits, skill names).
#
# This writes one table a language, keyed by the same ids the data files use,
# holding only what differs from the English:
#
#   src/data/names-<lang>.json
#     items      { id: [name, short name, description] }     every template of items-db.json
#     tasks      { id: { n, d, ok, fail, o: { objective id: text } } }
#     traders    { id: { n, f (full name), l (location), d } }
#     locations  { id: { n, d } }
#     skills     { id: name }
#     achievements { id: [name, description] }
#     stations   { id: { n, d: [description per level] } }
#
# src/game/localize.js lays it over the loaded data when that language is the
# one in use. English needs no table. Where a translation is missing the entry
# is left out and the English stays.
#
# usage:  python build_names.py            (every language in LANGS)
# =========================================================

import json
import os
import sys

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from build_meta import tdev, spt, OUT, CACHE          # noqa: E402  (the same cached sources)

# page language -> (tarkov.dev's suffix, the client locale's name)
LANGS = {'ko': ('ko', 'kr')}

DESC_MAX = 340          # the item table trims descriptions to this, so does this


def trim(s):
    s = (s or '').strip()
    return s if len(s) <= DESC_MAX else s[:DESC_MAX - 1].rstrip() + '…'


def client_locale(name):
    """the newest dump of the client's locale in that language, older ones filling the gaps"""
    table = {}
    for folder in ('spt412', 'spt13'):
        path = os.path.join(CACHE, folder, f'locales_global_{name}.json')
        if os.path.exists(path):
            with open(path, encoding='utf-8-sig') as f:
                table.update(json.load(f))
    if not table:
        got = spt(f'database/locales/global/{name}.json', required=False)
        table = got or {}
    return table


def build(lang, suffix, client):
    def load_db(name):
        with open(os.path.join(OUT, name), encoding='utf-8') as f:
            return json.load(f)

    def table(name):
        """a translation table and its English twin; only entries that differ are worth carrying"""
        return tdev(f'{name}_{suffix}')['data'], tdev(f'{name}_en')['data']

    loc = client_locale(client)
    loc_en = client_locale('en')
    out = {'v': 1, 'lang': lang}

    def moved(tr, en, key):
        v = tr.get(key)
        return v if v and v != en.get(key) else None

    # ---- items ----
    tr, en = table('items')
    raw = tdev('items')['data']['items']
    have = load_db('items-db.json')
    ids = set()
    for row in (have.values() if isinstance(have, dict) and 'items' not in have else have.get('items', have)):
        if isinstance(row, dict) and row.get('id'):
            ids.add(row['id'])
    items = {}
    for iid in ids:
        r = raw.get(iid)
        if not r:
            continue
        n, s, d = moved(tr, en, r.get('name')), moved(tr, en, r.get('shortName')), moved(tr, en, r.get('description'))
        if n or s or d:
            items[iid] = [n or '', s or '', trim(d) if d else '']
    out['items'] = items

    # ---- tasks, task items, achievements ----
    tr, en = table('tasks')
    data = tdev('tasks')['data']
    tasks = {}
    for tid, t in data['tasks'].items():
        row = {}
        # tarkov.dev's table lags on new tasks; the client's own locale has every name
        n = moved(tr, en, t.get('name')) or (loc.get(f'{tid} name') if loc.get(f'{tid} name') != loc_en.get(f'{tid} name') else None)
        if n:
            row['n'] = n
        for field, key in (('d', f'{tid} description'), ('ok', f'{tid} successMessageText'), ('fail', f'{tid} failMessageText')):
            v = loc.get(key)
            if v and v != loc_en.get(key):
                row[field] = v
        objs = {}
        for o in (t.get('objectives') or []) + (t.get('failConditions') or []):
            v = moved(tr, en, o.get('description'))
            if v:
                objs[o['id']] = v
        if objs:
            row['o'] = objs
        if row:
            tasks[tid] = row
    out['tasks'] = tasks
    for qid, q in data.get('questItems', {}).items():
        n, s, d = moved(tr, en, q.get('name')), moved(tr, en, q.get('shortName')), moved(tr, en, q.get('description'))
        if (n or s or d) and qid not in items:
            items[qid] = [n or '', s or '', trim(d) if d else '']
    ach = {}
    for a in data.get('achievements', {}).values():
        n, d = moved(tr, en, a.get('name')), moved(tr, en, a.get('description'))
        if n or d:
            ach[a['id']] = [n or '', d or '']
    out['achievements'] = ach

    # ---- traders ----
    tr, en = table('traders')
    traders = {}
    for tid, t in tdev('traders')['data'].items():
        row = {}
        for field, v, base in (
            ('n', tr.get(t.get('name')), en.get(t.get('name'))),
            ('d', tr.get(t.get('description')), en.get(t.get('description'))),
            ('f', loc.get(f'{tid} FullName'), loc_en.get(f'{tid} FullName')),
            ('l', loc.get(f'{tid} Location'), loc_en.get(f'{tid} Location')),
        ):
            if v and v != base:
                row[field] = v
        if row:
            traders[tid] = row
    out['traders'] = traders

    # ---- locations ----
    tr, en = table('maps')
    locations = {}
    for m in tdev('maps')['data']['maps'].values() if isinstance(tdev('maps')['data']['maps'], dict) else tdev('maps')['data']['maps']:
        row = {}
        n, d = moved(tr, en, m.get('name')), moved(tr, en, m.get('description'))
        if n:
            row['n'] = n
        if d:
            row['d'] = d
        if row and m.get('id'):
            locations[m['id']] = row
    out['locations'] = locations

    # ---- skills ----
    skills = {}
    for s in load_db('progress-db.json').get('skills', []):
        v = loc.get(s['id'])
        if v and v != loc_en.get(s['id']) and v != s.get('name'):
            skills[s['id']] = v
    out['skills'] = skills

    # ---- hideout stations ----
    tr, en = table('hideout')
    stations = {}
    for sid, st in tdev('hideout')['data'].items():
        row = {}
        n = moved(tr, en, st.get('name'))
        if n:
            row['n'] = n
        descs = [moved(tr, en, lv.get('description')) or '' for lv in st.get('levels') or []]
        if any(descs):
            row['d'] = descs
        if row:
            stations[sid] = row
    out['stations'] = stations

    path = os.path.join(OUT, f'names-{lang}.json')
    with open(path, 'w', encoding='utf-8', newline='\n') as f:
        json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
    print(f'{lang}: items {len(items)}, tasks {len(tasks)}, traders {len(traders)}, locations {len(locations)}, '
          f'skills {len(skills)}, achievements {len(ach)}, stations {len(stations)} -> '
          f'{os.path.getsize(path) // 1024} KiB')


def main():
    for lang, (suffix, client) in LANGS.items():
        build(lang, suffix, client)


if __name__ == '__main__':
    main()
