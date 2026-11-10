#!/usr/bin/env python3
# =========================================================
# ESCAPE 2D - traders, tasks, progression, starting profiles
#
# Everything outside a raid that the game needs to behave like the real one
# is data, and none of it is typed in here. Two public sources are joined:
#
#   tarkov.dev's static dataset (json.tarkov.dev/regular/*) - the live game:
#     the tasks with their objectives and rewards, the traders' loyalty
#     ladders, every cash offer and barter, the level table, the skill list
#   the SPT server dump (sp-tarkov/server-csharp, tag 4.1.2, game 0.16.9) -
#     what the first does not carry: the text a trader says when he hands a
#     task out and takes it back, the task's type, the experience rules, the
#     repair and insurance terms, restock intervals and the kit each edition
#     of the game starts a character with
#
# Where the two disagree about what exists, tarkov.dev wins: it is the
# current game. The dump only ever adds detail to something tarkov.dev lists.
#
# One thing neither of them says is when a trader hands a task out. Since
# patch 1.1.0.0 most side tasks belong to one of a trader's loyalty levels and
# come in waves: the next wave opens once a number of that level's tasks are
# done. tarkov.dev passes the bare condition through (a "global variable"
# compared to a number) without saying what feeds the variable. That table -
# which tasks count toward which variable, which tasks are a level's entry
# tasks, which listed tasks the game has retired - was worked out from the raw
# 1.3 templates and live captures and is kept in tools/data/
# task-unlock-rules.json; apply_unlock_rules() folds it in.
#
# output (src/data/):
#   traders-db.json   traders, every offer, every sold or awarded weapon build
#   quests-db.json    tasks, task items, zones (world coordinates)
#   progress-db.json  level table, experience rules, skills, mastering
#   profiles-db.json  starting stash and gear per edition and faction
#   hideout-db.json   stations and crafts
#
# usage:  python build_meta.py [--art] [--report]
#   --art     also download task-item icons, trader portraits and task banners
# =========================================================

import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
CACHE = os.path.join(HERE, 'cache')
TDEV = os.path.join(CACHE, 'tdev')
SPT = os.path.join(CACHE, 'spt412')
OUT = os.path.join(ROOT, 'src', 'data')

TDEV_URL = 'https://json.tarkov.dev/regular/{name}'
SPT_URL = ('https://raw.githubusercontent.com/sp-tarkov/server-csharp/4.1.2/'
           'Libraries/SPTarkov.Server.Assets/SPT_Data/{path}')
UA = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) escape2d-builder/2.0'}

ROUBLES = '5449016a4bdc2d6f028b456f'
DOLLARS = '5696686a4bdc2da3298b456a'
EUROS = '569668774bdc2da2298b4568'
CURRENCY_OF = {ROUBLES: 'RUB', DOLLARS: 'USD', EUROS: 'EUR'}
ITEM_OF_CUR = {v: k for k, v in CURRENCY_OF.items()}
ANY_DOGTAG = 'customdogtags12345678910'

FACTORY_DAY = '55f2d3fd4bdc2d5f408b4567'


# ---------------------------------------------------------
# fetching
# ---------------------------------------------------------
def fetch(url, binary=False, retries=3):
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=90) as r:
                data = r.read()
            return data if binary else data.decode('utf-8-sig')
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            time.sleep(1.5 * (attempt + 1))
        except Exception:
            time.sleep(1.5 * (attempt + 1))
    return None


def tdev(name):
    path = os.path.join(TDEV, name + '.json')
    if not (os.path.exists(path) and os.path.getsize(path) > 100):
        print(f'  downloading tarkov.dev {name} ...')
        txt = fetch(TDEV_URL.format(name=name))
        if txt is None:
            raise SystemExit(f'cannot download {name}')
        os.makedirs(TDEV, exist_ok=True)
        with open(path, 'w', encoding='utf-8') as f:
            f.write(txt)
    with open(path, encoding='utf-8') as f:
        return json.load(f)


def spt(rel, required=True):
    """rel is the path under SPT_Data, e.g. database/templates/quests.json"""
    name = rel.replace('database/', '').replace('/', '_')
    path = os.path.join(SPT, name)
    if not (os.path.exists(path) and os.path.getsize(path) > 10):
        print(f'  downloading SPT {rel} ...')
        txt = fetch(SPT_URL.format(path=rel))
        if txt is None:
            if required:
                raise SystemExit(f'cannot download {rel}')
            return None
        os.makedirs(SPT, exist_ok=True)
        with open(path, 'w', encoding='utf-8') as f:
            f.write(txt)
    with open(path, encoding='utf-8-sig') as f:
        try:
            return json.load(f)
        except json.JSONDecodeError:
            if required:
                raise
            return None


def r2(v):
    return round(float(v), 2)


def prune(d):
    """drop None, empty containers and False from a dict (0 is kept)"""
    return {k: v for k, v in d.items()
            if v is not None and v != [] and v != {} and v is not False and v != ''}


# ---------------------------------------------------------
# traders
# ---------------------------------------------------------
TRADER_ORDER = [
    '54cb50c76803fa8b248b4571',   # Prapor
    '54cb57776803fa99248b456e',   # Therapist
    '579dc571d53a0658a154fbec',   # Fence
    '58330581ace78e27b8b10cee',   # Skier
    '5935c25fb3acc3127c3d8cd9',   # Peacekeeper
    '5a7c2eca46aef81a7ca2145d',   # Mechanic
    '5ac3b934156ae10c4430e83c',   # Ragman
    '5c0647fdd443bc2504c2d371',   # Jaeger
    '638f541a29ffd1183d187f57',   # Lightkeeper
    '6617beeaa9cfa777ca915b7c',   # Ref
    '656f0f98d80a697f855d34b1',   # BTR Driver
]


def build_traders(tasks):
    raw = tdev('traders')['data']
    en = tdev('traders_en')['data']
    cfg = spt('configs/trader.json', required=False) or {}
    ins_cfg = spt('configs/insurance.json', required=False) or {}
    restock = {u['traderId']: [u['seconds']['min'], u['seconds']['max']]
               for u in cfg.get('updateTime', [])}
    # his full name and where he sits are only in the client's own locale
    loc = spt('database/locales/global/en.json', required=False) or {}

    # the task that hands a trader over, straight from the reward lists
    unlock_by = {}
    for t in tasks.values():
        for grp in ('startRewards', 'finishRewards'):
            for tid in (t.get(grp) or {}).get('traderUnlock') or []:
                unlock_by[tid] = t['id']

    out = []
    for tid in TRADER_ORDER:
        t = raw.get(tid)
        if not t:
            continue
        base = spt(f'database/traders/{tid}/base.json', required=False) or {}
        levels = []
        spt_levels = base.get('loyaltyLevels') or []
        for i, lv in enumerate(t['levels']):
            sl = spt_levels[i] if i < len(spt_levels) else {}
            levels.append(prune({
                'pmc': lv['requiredPlayerLevel'],
                'rep': r2(lv['requiredReputation']),
                'sales': lv['requiredCommerce'],
                'pay': lv['payRate'],
                'ins': lv.get('insuranceRate'),
                'repair': lv.get('repairCostMultiplier'),
                # the percentage on top of an item's own RepairCost
                'repairCoef': float(sl['repair_price_coef']) if sl.get('repair_price_coef') not in (None, '') else None,
                'heal': float(sl['heal_price_coef']) if sl.get('heal_price_coef') else None,
            }))
            # zeros are meaningful on the ladder
            levels[-1].setdefault('pmc', 0)
            levels[-1].setdefault('rep', 0)
            levels[-1].setdefault('sales', 0)

        rep = base.get('repair') or {}
        ins = base.get('insurance') or {}
        row = prune({
            'id': tid,
            'key': t['normalizedName'].replace('-', ''),
            'name': en.get(t['name'], t['name']),
            'fullName': loc.get(f'{tid} FullName'),
            'location': loc.get(f'{tid} Location'),
            'desc': en.get(t['description'], ''),
            'cur': t['currency'],
            'levels': levels,
            'buy': prune({
                'cats': t['buyAllowed']['category'],
                'items': t['buyAllowed']['items'],
                'denyCats': t['buyProhibited']['category'],
                'deny': t['buyProhibited']['items'],
            }),
            'repair': prune({
                'quality': float(rep['quality']),
                'cur': CURRENCY_OF.get(rep.get('currency'), 'RUB'),
                'denyCats': rep.get('excluded_category'),
                'deny': rep.get('excluded_id_list'),
            }) if rep.get('availability') else None,
            'insurance': prune({
                'minH': ins.get('min_return_hour'),
                'maxH': ins.get('max_return_hour'),
                'storeH': ins.get('max_storage_time'),
                'returnPct': (ins_cfg.get('returnChancePercent') or {}).get(tid),
                'denyCats': ins.get('excluded_category'),
            }) if ins.get('availability') else None,
            'medic': bool(base.get('medic')),
            'locked': (base.get('unlockedByDefault') is False) or tid in unlock_by,
            'unlockTask': unlock_by.get(tid),
            'restock': restock.get(tid),
        })
        # two of them are only ever met inside a raid: the man in the lighthouse
        # and the driver of the BTR. They are not on the traders screen.
        if tid in ('638f541a29ffd1183d187f57', '656f0f98d80a697f855d34b1'):
            row['raidOnly'] = True
            row['locked'] = True
        if tid == '579dc571d53a0658a154fbec':
            # Fence is on the list from the start; what he holds back is tied
            # to scav karma, not to a task
            row.pop('locked', None)
            fence = cfg.get('fence') or {}
            row['fence'] = prune({
                'size': fence.get('assortSize'),
                'priceMult': fence.get('itemPriceMult'),
                'presetMult': fence.get('presetPriceMult'),
                'refresh': fence.get('partialRefreshTimeSeconds'),
                'deny': fence.get('blacklist'),
                'typeLimits': fence.get('itemTypeLimits'),
            })
        out.append(row)
    return out


def build_presets():
    """
    Every assembled build the game sells or hands out, by its own id: the base
    weapon and the parts on it as rows of [template, parent row, slot]. The
    tree comes from the dump's ItemPresets where the build exists there; a
    build that is newer than the dump is only known as a flat parts list.
    """
    items = tdev('items')['data']['items']
    en = tdev('items_en')['data']
    g_presets = (spt('database/globals.json').get('ItemPresets') or {})
    out = {}
    for iid, it in items.items():
        if 'preset' not in it['types']:
            continue
        props = it.get('properties') or {}
        base = props.get('baseItem')
        row = {'name': en.get(it['name'], ''), 'w': it.get('width'), 'h': it.get('height'),
               'price': it.get('basePrice')}
        if props.get('default'):
            row['default'] = True
        g = g_presets.get(iid)
        if g and g.get('_items'):
            rows = g['_items']
            idx = {r['_id']: n for n, r in enumerate(rows)}
            row['base'] = base or rows[0]['_tpl']
            row['tree'] = [[r['_tpl'], idx.get(r.get('parentId'), -1), r.get('slotId') or ''] for r in rows]
        else:
            row['base'] = base
            row['parts'] = [c['item'] for c in it.get('containsItems') or [] if c['item'] != base]
        if row['base']:
            out[iid] = row
    return out


def build_offers(traders, presets):
    items = tdev('items')['data']['items']
    barters = tdev('barters')['data']
    tindex = {t['id']: i for i, t in enumerate(traders)}

    offers = []
    seen = set()
    for iid, it in items.items():
        for o in it.get('buyFromTrader') or []:
            ti = tindex.get(o['trader'])
            if ti is None:
                continue
            key = (ti, iid, o['minTraderLevel'], o['currencyItem'], o['price'])
            if key in seen:
                continue
            seen.add(key)
            offers.append(prune({
                'id': f"c{len(offers):04x}", 't': ti, 'item': iid, 'n': 1,
                'll': o['minTraderLevel'], 'lim': o.get('buyLimit'),
                'task': o.get('taskUnlock'),
                'cost': [[o['currencyItem'], o['price']]],
                'stock': o.get('restockAmount'),
                'preset': iid if iid in presets else None,
            }))

    for b in barters:
        ti = tindex.get(b['trader'])
        if ti is None:
            continue
        cost = []
        for r in b['requiredItems']:
            attrs = prune(dict(r.get('attributes') or {}))
            item = r['item']
            if item == ANY_DOGTAG:
                item = 'dogtag'
            row = [item, r['count']]
            if attrs:
                row.append(attrs)
            cost.append(row)
        off = b['offeredItem']
        offers.append(prune({
            'id': 'b' + b['id'][-8:], 't': ti, 'item': off['item'], 'n': off['count'],
            'll': b['minTraderLevel'], 'lim': b.get('buyLimit'),
            'task': b.get('taskUnlock'), 'cost': cost, 'barter': True,
            'stock': b.get('restockAmount'),
            'preset': off['item'] if off['item'] in presets else None,
        }))
    return offers


# ---------------------------------------------------------
# tasks
# ---------------------------------------------------------
BODY_PREFIX = 'QuestCondition/Elimination/Kill/BodyPart/'


def cmp_of(d, zero_is_none=True):
    """{value, compareMethod} -> [cmp, value] or None when it constrains nothing"""
    if not d:
        return None
    v = d.get('value')
    if v is None or (zero_is_none and v == 0 and d.get('compareMethod') in ('>=', None)):
        return None
    return [d.get('compareMethod') or '>=', v]


def index_spt_conditions(spt_q):
    """condition id -> the dump's own record of it, for the fields tarkov.dev drops"""
    idx = {}
    for q in spt_q.values():
        for grp in ('AvailableForStart', 'AvailableForFinish', 'Fail'):
            for c in (q.get('conditions') or {}).get(grp) or []:
                idx[c['id']] = c
    return idx


SPT_COND = {}


def compact_objective(o, T, zones, qitem_spots):
    ty = o['type']
    out = {'id': o['id'], 'type': ty, 'text': T(o.get('description')) or ''}
    if o.get('optional'):
        out['optional'] = True
    sc = SPT_COND.get(o['id'])
    if sc:
        # "in a single raid": the counter starts over when the raid ends short
        if sc.get('oneSessionOnly'):
            out['once'] = True
        # how long the hands are busy planting an item or setting a marker
        if sc.get('plantTime'):
            out['plant'] = sc['plantTime']
        if sc.get('traderId'):
            out['sellTo'] = sc['traderId']
        # A counter's inner conditions keep their grouping in the dump: each
        # Equipment condition is "any one of these sets, worn in full", and
        # several of them all have to hold. tarkov.dev flattens that into one
        # list, which turns "a balaclava AND a scav vest" into "either".
        inner = (sc.get('counter') or {}).get('conditions') or []
        equip = []
        for ic in inner:
            if ic.get('conditionType') == 'Equipment':
                row = prune({'inc': [g for g in ic.get('equipmentInclusive') or [] if g],
                             'exc': [g for g in ic.get('equipmentExclusive') or [] if g]})
                if row:
                    equip.append(row)
            elif ic.get('conditionType') in ('Kills', 'Shots'):
                if ic.get('weaponModsInclusive'):
                    out['modsInc'] = [g for g in ic['weaponModsInclusive'] if g]
                if ic.get('weaponModsExclusive'):
                    out['modsExc'] = [g for g in ic['weaponModsExclusive'] if g]
                if ic.get('weaponCaliber'):
                    out['calibers'] = ic['weaponCaliber']
        if equip:
            out['equip'] = equip
    if o.get('count') not in (None,):
        out['count'] = o['count']
    if o.get('maps'):
        out['maps'] = o['maps']

    zs = []
    for z in o.get('zones') or []:
        zid = f"{z['id']}@{z['map']}"
        if zid not in zones:
            pos = z.get('position') or {}
            zones[zid] = prune({
                'map': z['map'],
                'pos': [r2(pos.get('x', 0)), r2(pos.get('y', 0)), r2(pos.get('z', 0))],
                'outline': [[r2(p['x']), r2(p['z'])] for p in z.get('outline') or []],
                'top': r2(z['top']) if z.get('top') is not None else None,
                'bottom': r2(z['bottom']) if z.get('bottom') is not None else None,
            })
        zs.append(zid)
    if zs:
        out['zones'] = zs
    if o.get('requiredKeys'):
        out['keys'] = o['requiredKeys']

    if ty == 'shoot':
        out['shot'] = o.get('shotType') or 'kill'
        out['targets'] = o.get('targetNames') or []
        parts = [p.replace(BODY_PREFIX, '') for p in o.get('bodyParts') or []]
        if parts:
            out['parts'] = parts
        if o.get('usingWeapon'):
            out['weapons'] = o['usingWeapon']
        if o.get('usingWeaponMods') and 'modsInc' not in out:
            out['modsInc'] = o['usingWeaponMods']
        d = cmp_of(o.get('distance'))
        if d:
            out['dist'] = d
        if o.get('timeFromHour') or o.get('timeUntilHour'):
            out['hours'] = [o.get('timeFromHour') or 0, o.get('timeUntilHour') or 0]
        if 'equip' not in out and (o.get('wearing') or o.get('notWearing')):
            ids = lambda groups: [[x['id'] if isinstance(x, dict) else x for x in g] for g in groups or [] if g]
            out['equip'] = [prune({'inc': ids(o.get('wearing')), 'exc': ids(o.get('notWearing'))})]
        for src, dst in (('enemyHealthEffect', 'enemyFx'), ('playerHealthEffect', 'playerFx')):
            e = o.get(src)
            if e:
                out[dst] = prune({
                    'parts': [p.replace(BODY_PREFIX, '') for p in e.get('bodyParts') or []],
                    'fx': e.get('effects'),
                    'time': cmp_of(e.get('time')),
                })
    elif ty in ('giveItem', 'findItem', 'plantItem', 'sellItem'):
        out['items'] = o.get('items') or []
        if o.get('foundInRaid'):
            out['fir'] = True
        if o.get('dogTagLevel'):
            out['dogtag'] = o['dogTagLevel']
        if o.get('minDurability') not in (None, 0) or o.get('maxDurability') not in (None, 100):
            out['dur'] = [o.get('minDurability') or 0, o.get('maxDurability') if o.get('maxDurability') is not None else 100]
    elif ty in ('findQuestItem', 'giveQuestItem', 'plantQuestItem'):
        out['qitem'] = o.get('questItem')
        if ty == 'findQuestItem':
            for loc in o.get('possibleLocations') or []:
                pts = [[r2(p['x']), r2(p['y']), r2(p['z'])] for p in loc.get('positions') or []]
                if pts:
                    qitem_spots.setdefault(o['questItem'], {}).setdefault(loc['map'], [])
                    have = qitem_spots[o['questItem']][loc['map']]
                    for p in pts:
                        if p not in have:
                            have.append(p)
    elif ty == 'mark':
        out['marker'] = o.get('markerItem')
    elif ty == 'useItem':
        out['use'] = o.get('useAny') or []
    elif ty == 'extract':
        if o.get('exitName'):
            out['exit'] = o['exitName']
        if o.get('exitStatus'):
            out['status'] = o['exitStatus']
    elif ty == 'buildWeapon':
        out['weapon'] = o.get('item')
        if o.get('containsAll'):
            out['all'] = o['containsAll']
        if o.get('containsCategory'):
            out['cats'] = o['containsCategory']
        attrs = {}
        for k, v in (o.get('buildAttributes') or {}).items():
            c = cmp_of(v)
            if c:
                attrs[k] = c
        if attrs:
            out['attrs'] = attrs
    elif ty == 'traderLevel':
        out['trader'] = o.get('trader')
        out['level'] = o.get('level')
    elif ty == 'traderStanding':
        out['trader'] = o.get('trader')
        out['value'] = [o.get('compareMethod') or '>=', o.get('value')]
    elif ty == 'skill':
        out['skill'] = o.get('skill')
        out['level'] = o.get('level')
    elif ty == 'taskStatus':
        out['task'] = o.get('task')
        out['status'] = o.get('status') or []
    elif ty == 'experience':
        e = o.get('healthEffect') or {}
        out['fx'] = prune({
            'parts': [p.replace(BODY_PREFIX, '') for p in e.get('bodyParts') or []],
            'fx': e.get('effects'),
            'time': cmp_of(e.get('time')),
        })
    elif ty == 'globalVariable':
        out['gvar'] = o.get('globalVariable')
    elif ty == 'dialogue':
        out['traders'] = o.get('traders') or []
    return out


def compact_rewards(r):
    if not r:
        return None
    out = {}
    if r.get('traderStanding'):
        out['rep'] = [[x['trader'], x['standing']] for x in r['traderStanding']]
    if r.get('items'):
        rows = []
        for x in r['items']:
            row = [x['item'], x['count']]
            attrs = prune(dict(x.get('attributes') or {}))
            if attrs:
                row.append(attrs)
            rows.append(row)
        out['items'] = rows
    if r.get('offerUnlock'):
        out['unlock'] = [[x['trader'], x['level'], x['item']] for x in r['offerUnlock']]
    if r.get('skillLevelReward'):
        out['skills'] = [[x['skill'], x['level']] for x in r['skillLevelReward']]
    if r.get('traderUnlock'):
        out['traders'] = list(r['traderUnlock'])
    if r.get('craftUnlock'):
        out['crafts'] = [[x.get('station'), x.get('level'), x.get('item')] for x in r['craftUnlock']]
    if r.get('achievement'):
        out['ach'] = list(r['achievement'])
    return out or None


def task_requirement(r, sq):
    """[task id, statuses, seconds to wait after it] - the wait is only in the dump"""
    row = [r['task'], r['status']]
    for c in (sq.get('conditions') or {}).get('AvailableForStart') or []:
        if c.get('conditionType') == 'Quest' and c.get('target') == r['task'] and c.get('availableAfter'):
            row.append(c['availableAfter'])
            break
    return row


def apply_unlock_rules(out):
    """
    Fold the wave rules into the built tasks and return the variable table.

    Every task of a trader's loyalty-level pool gets `tier` (the level, which
    is also the header the trader's task list files it under). The variables
    come back as { id: { t: trader, ll, sources: [task ids], twins: [[ids]] } }:
    a variable's value is the number of its sources that are completed, the
    two faction twins of one task counting once.

    Three corrections ride along, each from the same research:
      - a pool task whose client start block is empty but which the game does
        not hand out at once ("hidden") is treated as an ordinary entry task
        of its level, i.e. it asks for that loyalty level;
      - tarkov.dev's minimum player level on a pool task is not a condition
        of the game (pool tasks have no level condition at all; the number is
        only the level their loyalty level happens to need), so it is dropped;
      - templates the game has retired are flagged and not offered.
    """
    path = os.path.join(HERE, 'data', 'task-unlock-rules.json')
    with open(path, encoding='utf-8') as f:
        rules = json.load(f)
    by_id = {t['id']: t for t in out}
    gvars = {}
    for g in rules['groups']:
        gvars[g['variableId']] = prune({
            't': g['traderId'], 'll': g['loyaltyLevel'],
            'sources': [s['id'] for s in g['sources'] if s['id'] in by_id],
            'twins': [tw for tw in g.get('twins') or [] if all(i in by_id for i in tw)],
        })
        for s in g['sources']:
            t = by_id.get(s['id'])
            if not t:
                continue
            t['tier'] = g['loyaltyLevel']
            t['lvl'] = 0
            u = s['unlock']
            rec = u.get('recommended') or {}
            if u['type'] == 'hidden' and rec.get('type') == 'loyalty':
                req = t.setdefault('req', {})
                rows = req.setdefault('traders', [])
                if not any(r['t'] == g['traderId'] and r.get('kind') == 'level' for r in rows):
                    rows.append({'t': g['traderId'], 'kind': 'level', 'cmp': '>=', 'v': rec['min']})
    def require(t, rec, trader_id):
        """one recommended start condition, in the shapes the table uses"""
        ty = rec.get('type')
        req = t.setdefault('req', {})
        if ty == 'all':
            for r in rec.get('of') or []:
                require(t, r, trader_id)
        elif ty == 'taskComplete' and rec.get('id') in by_id:
            rows = req.setdefault('tasks', [])
            if not any(r[0] == rec['id'] for r in rows):
                rows.append([rec['id'], ['complete']])
        elif ty == 'anyTaskComplete':
            ids = [i for i in rec.get('ids') or [] if i in by_id]
            if ids:
                req['anyTask'] = ids
        elif ty == 'playerLevel':
            t['lvl'] = max(t.get('lvl') or 0, rec.get('min') or 0)
        elif ty in ('loyalty', 'reputation'):
            who = rec.get('traderId') or trader_id
            kind = 'level' if ty == 'loyalty' else 'reputation'
            rows = req.setdefault('traders', [])
            if not any(r['t'] == who and r.get('kind') == kind for r in rows):
                rows.append({'t': who, 'kind': kind, 'cmp': '>=', 'v': rec['min']})
        # 'unknown' and 'useTasksJsonTaskRequirements' leave the task as tarkov.dev has it

    for e in rules.get('emptyStartOutsidePools') or []:
        t = by_id.get(e['id'])
        if t:
            require(t, e.get('recommended') or {}, e.get('traderId'))
    retired = set((rules.get('retired') or {}).get('names') or [])
    for t in out:
        if t['name'] in retired:
            t['retired'] = True
    return gvars


TYPE_BY_OBJECTIVE = {
    'shoot': 'Elimination', 'giveItem': 'PickUp', 'findItem': 'PickUp', 'sellItem': 'Merchant',
    'visit': 'Exploration', 'extract': 'Completion', 'mark': 'Completion', 'plantItem': 'Completion',
    'plantQuestItem': 'Completion', 'findQuestItem': 'Discover', 'giveQuestItem': 'PickUp',
    'buildWeapon': 'WeaponAssembly', 'skill': 'Skill', 'traderLevel': 'Loyalty',
    'traderStanding': 'Standing', 'experience': 'Experience', 'useItem': 'Completion',
}


def build_tasks():
    data = tdev('tasks')['data']
    en = tdev('tasks_en')['data']
    spt_q = spt('database/templates/quests.json')
    loc = spt('database/locales/global/en.json')

    def T(k):
        if k is None:
            return None
        return en.get(k, k) if isinstance(k, str) else k

    tasks = data['tasks']
    zones = {}
    qitem_spots = {}
    out = []
    missing_desc = []
    SPT_COND.update(index_spt_conditions(spt_q))

    for tid, t in tasks.items():
        sq = spt_q.get(tid) or {}
        objs = [compact_objective(o, T, zones, qitem_spots) for o in t['objectives']]
        fails = [compact_objective(o, T, zones, qitem_spots) for o in t.get('failConditions') or []]

        ty = sq.get('type')
        if not ty:
            kinds = Counter(TYPE_BY_OBJECTIVE.get(o['type'], 'Completion') for o in objs)
            ty = 'Multi' if len(kinds) > 2 else (kinds.most_common(1)[0][0] if kinds else 'Completion')

        # the location a task is filed under: tarkov.dev's own, else the one
        # map every located objective agrees on
        where = t.get('map')
        if not where:
            ms = set()
            for o in objs:
                if o.get('maps'):
                    ms.add(tuple(sorted(o['maps'])))
            if len(ms) == 1 and len(next(iter(ms))) == 1:
                where = next(iter(ms))[0]

        desc = loc.get(f'{tid} description') or ''
        if not desc:
            missing_desc.append(T(t['name']))
        row = prune({
            'id': tid,
            'name': T(t['name']),
            'trader': t['trader'],
            'type': ty,
            'map': where,
            'lvl': t.get('minPlayerLevel') or 0,
            'faction': t['factionName'] if t.get('factionName') not in (None, 'Any') else None,
            'kappa': bool(t.get('kappaRequired')),
            'lk': bool(t.get('lightkeeperRequired')),
            'restartable': bool(t.get('restartable')),
            'prestige': t.get('requiredPrestige'),
            'modes': t.get('gameMode'),
            'req': prune({
                'tasks': [task_requirement(r, sq) for r in t.get('taskRequirements') or []],
                'traders': [prune({'t': r['trader'], 'kind': r.get('requirementType'),
                                   'cmp': r.get('compareMethod') or '>=', 'v': r.get('value')})
                            for r in t.get('traderRequirements') or []],
                'other': t.get('otherRequirements') or [],
                'delay': [t.get('availableDelaySecondsMin') or 0, t.get('availableDelaySecondsMax') or 0]
                if t.get('availableDelaySecondsMax') else None,
            }),
            'obj': objs,
            'fail': fails,
            'start': compact_rewards(t.get('startRewards')),
            'finish': compact_rewards(t.get('finishRewards')),
            'failure': compact_rewards(t.get('failureOutcome')),
            'xp': t.get('experience') or 0,
            'keys': t.get('neededKeys'),
            'desc': desc,
            'okMsg': loc.get(f'{tid} successMessageText') or '',
            'failMsg': loc.get(f'{tid} failMessageText') or '',
            'img': os.path.basename(t['taskImageLink']) if t.get('taskImageLink') else None,
        })
        row['obj'] = objs          # an empty objective list is still a list
        row.setdefault('xp', 0)
        row.setdefault('lvl', 0)
        out.append(row)

    # ---- task items: things that only exist for a task ----
    qitems = {}
    for qid, q in data['questItems'].items():
        qitems[qid] = prune({
            'id': qid,
            'name': T(q['name']),
            'short': T(q['shortName']),
            'desc': T(q.get('description')) or '',
            'w': q.get('width') or 1,
            'h': q.get('height') or 1,
            'spots': qitem_spots.get(qid),
        })

    ach = []
    for a in data.get('achievements', {}).values():
        ach.append(prune({
            'id': a['id'], 'name': T(a['name']), 'desc': T(a.get('description')) or '',
            'hidden': bool(a.get('hidden')), 'side': a.get('normalizedSide'),
            'rarity': a.get('normalizedRarity'),
            'pct': a.get('adjustedPlayersCompletedPercent'),
            'img': os.path.basename(a['imageLink']) if a.get('imageLink') else None,
        }))

    gvars = apply_unlock_rules(out)
    return out, qitems, zones, ach, missing_desc, tasks, gvars


# ---------------------------------------------------------
# progression
# ---------------------------------------------------------
def build_progress():
    items = tdev('items')['data']
    en = tdev('items_en')['data']
    g = spt('database/globals.json')['config']
    exp = g['exp']
    # the table gives what each level costs (1,000 for the second, 3,017 more
    # for the third); the page reads off where a level begins (1,000, 4,017)
    levels, total = [], 0
    for lv in items['playerLevels']:
        total += lv['exp']
        levels.append(total)
    skills = []
    for s in items['skills']:
        skills.append({'id': s['id'], 'name': en.get(s['name'], s['name'])})
    mastering = [{'id': m['id'], 'weapons': m['weapons'], 'l2': m['level2'], 'l3': m['level3']}
                 for m in items['mastering']]
    return {
        'v': 1,
        'locations': build_locations(),
        'levels': levels,
        'exp': {
            'kill': exp['kill'],
            'heal': exp['heal'],
            'matchEnd': {k: v for k, v in exp['match_end'].items() if k != 'README'},
            'lootAttempts': [a['k_exp'] for a in exp['loot_attempts']],
            'doorOpen': exp['expForLockedDoorOpen'],
            'doorBreach': exp['expForLockedDoorBreach'],
            'triggerMult': exp.get('triggerMult'),
        },
        'skills': skills,
        'skill': {
            'expPerLevel': g.get('SkillExpPerLevel'),
            'rate': g['SkillsSettings'].get('SkillProgressRate'),
            'weaponRate': g['SkillsSettings'].get('WeaponSkillProgressRate'),
            'freshPoints': g.get('SkillFreshPoints'),
            'freshEff': g.get('SkillFreshEffectiveness'),
            'fatiguePerPoint': g.get('SkillFatiguePerPoint'),
            'minEff': g.get('SkillMinEffectiveness'),
            'fatigueReset': g.get('SkillFatigueReset'),
            'pointsBeforeFatigue': g.get('SkillPointsBeforeFatigue'),
        },
        'mastering': mastering,
        'flea': {'minLevel': items['fleaMarket'].get('minPlayerLevel'),
                 'fee': items['fleaMarket'].get('sellOfferFeeRate')},
        'scavCooldown': items['settings'].get('scavCooldownSeconds'),
        'raidLimits': [{'item': r['TemplateId'], 'raid': r['MaxInRaid'], 'lobby': r['MaxInLobby']}
                       for r in g.get('RestrictionsInRaid') or []],
        'deploySeconds': g.get('TimeBeforeDeployLocal') or g.get('TimeBeforeDeploy'),
        'insurance': {'storeH': g['Insurance'].get('MaxStorageTimeInHour')},
        'buyout': g.get('TradingSettings', {}).get('BuyoutRestrictions'),
        # what can be carried, kg: each band is [where it starts to cost, where it stops being possible]
        # - base (stamina drains; its top is the figure the character screen shows as the limit),
        # sprint, walk and the band the walking speed falls over
        'weight': {name: [g['Stamina'][key]['x'], g['Stamina'][key]['y']]
                   for name, key in (('base', 'BaseOverweightLimits'), ('sprint', 'SprintOverweightLimits'),
                                     ('walk', 'WalkOverweightLimits'), ('speed', 'WalkSpeedOverweightLimits'))
                   if key in g.get('Stamina', {})},
    }


# ---------------------------------------------------------
# locations
# ---------------------------------------------------------
# Several location ids share one piece of ground: the night and event
# versions of Factory, Ground Zero under and over level 21, the Lab's
# variants. The game keeps them apart (a task can ask for one and not the
# other); the map geometry is filed once under the key on the right.
LOCATION_KEY = {
    'factory': 'factory', 'night-factory': 'factory', 'infected-factory': 'factory',
    'customs': 'customs', 'woods': 'woods', 'lighthouse': 'lighthouse', 'shoreline': 'shoreline',
    'reserve': 'reserve', 'interchange': 'interchange', 'streets-of-tarkov': 'streets',
    'the-lab': 'labs', 'the-lab-dark': 'labs', 'infected-lab': 'labs',
    'ground-zero': 'groundzero', 'ground-zero-21': 'groundzero', 'ground-zero-tutorial': 'groundzero',
    'terminal': 'terminal', 'the-labyrinth': 'labyrinth', 'icebreaker': 'icebreaker',
}


def build_locations():
    data = tdev('maps')['data']
    en = tdev('maps_en')['data']
    out = []
    for m in data['maps'].values():
        norm = m['normalizedName']
        bosses = []
        for b in m.get('bosses') or []:
            bosses.append(prune({
                'name': en.get(b.get('name'), b.get('name')) if isinstance(b.get('name'), str) else None,
                'id': b.get('boss') or b.get('id') or b.get('normalizedName'),
                'chance': b.get('spawnChance'),
            }))
        out.append(prune({
            'id': m['id'],
            'key': LOCATION_KEY.get(norm, norm.replace('-', '')),
            'nameId': m['nameId'],
            'slug': norm,
            'name': en.get(m['name'], m['name']),
            'desc': en.get(m.get('description'), ''),
            'duration': m.get('raidDuration'),
            'players': m.get('players'),
            'minLevel': m.get('minPlayerLevel') or None,
            'maxLevel': m.get('maxPlayerLevel') if (m.get('maxPlayerLevel') or 100) < 79 else None,
            'accessKeys': m.get('accessKeys'),
            'accessKeysMinLevel': m.get('accessKeysMinPlayerLevel') or None,
            'enemies': [en.get(e, e) for e in m.get('enemies') or []],
            'bosses': bosses,
        }))
    return out


# ---------------------------------------------------------
# starting profiles
# ---------------------------------------------------------
EDITIONS = [('Standard', 'standard'), ('Left Behind', 'left_behind'),
            ('Prepare To Escape', 'prepare_for_escape'),
            ('Edge Of Darkness', 'edge_of_darkness'), ('Unheard', 'unheard')]


def compact_inventory(inv):
    """the profile's item list as rows: [tpl, parentIndex, slotId, loc?, upd?]"""
    rows = inv['items']
    idx = {r['_id']: n for n, r in enumerate(rows)}
    out = []
    for r in rows:
        row = [r['_tpl'], idx.get(r.get('parentId'), -1), r.get('slotId') or '']
        loc = r.get('location')
        upd = r.get('upd') or {}
        extra = {}
        if isinstance(loc, dict):
            extra['at'] = [loc.get('x', 0), loc.get('y', 0), 1 if loc.get('r') in (1, 'Vertical') else 0]
        elif isinstance(loc, int):
            extra['i'] = loc                       # position in a cartridge stack
        if upd.get('StackObjectsCount', 1) != 1:
            extra['n'] = upd['StackObjectsCount']
        rep = upd.get('Repairable')
        if rep:
            extra['dur'] = [rep.get('Durability'), rep.get('MaxDurability')]
        if upd.get('MedKit'):
            extra['hp'] = upd['MedKit'].get('HpResource')
        if upd.get('FoodDrink'):
            extra['hp'] = upd['FoodDrink'].get('HpPercent')
        if upd.get('Foldable', {}).get('Folded'):
            extra['folded'] = True
        if upd.get('Key'):
            extra['uses'] = upd['Key'].get('NumberOfUsages')
        if upd.get('Resource'):
            extra['res'] = upd['Resource'].get('Value')
        if extra:
            row.append(extra)
        out.append(row)
    return {'items': out, 'equipment': idx.get(inv.get('equipment'), -1), 'stash': idx.get(inv.get('stash'), -1),
            'questRaid': idx.get(inv.get('questRaidItems'), -1), 'questStash': idx.get(inv.get('questStashItems'), -1)}


def build_profiles():
    p = spt('database/templates/profiles.json')
    out = {}
    for name, key in EDITIONS:
        ed = p.get(name)
        if not ed:
            continue
        sides = {}
        for side in ('usec', 'bear'):
            s = ed.get(side)
            if not s:
                continue
            ch = s['character']
            tr = s.get('trader') or {}
            sides[side] = {
                'inventory': compact_inventory(ch['Inventory']),
                'traders': prune({
                    'standing': tr.get('initialStanding'),
                    'sales': tr.get('initialSalesSum'),
                    'jaeger': bool(tr.get('jaegerUnlocked')),
                    'fleaBlockedSeconds': tr.get('fleaMarketFreezeTime'),
                }),
                'bonuses': ch.get('Bonuses') or [],
            }
        out[key] = {'name': name, **sides}
    return {'v': 1, 'editions': out}


# ---------------------------------------------------------
# hideout
# ---------------------------------------------------------
def build_hideout():
    h = tdev('hideout')['data']
    en = tdev('hideout_en')['data']
    crafts = tdev('crafts')['data']
    stations = []
    src = h.values() if isinstance(h, dict) else h
    for s in src:
        if not isinstance(s, dict) or 'levels' not in s:
            continue
        lv = []
        for l in s['levels']:
            lv.append(prune({
                'level': l['level'],
                'time': l.get('constructionTime'),
                'desc': en.get(l.get('description'), '') if l.get('description') else None,
                'items': [[r['item'], r.get('count') or r.get('quantity') or 1] for r in l.get('itemRequirements') or []],
                'stations': [[r['station'], r['level']] for r in l.get('stationLevelRequirements') or []],
                'skills': [[r.get('skill') or r.get('name'), r['level']] for r in l.get('skillRequirements') or []],
                'traders': [[r['trader'], r.get('value') or r.get('level')] for r in l.get('traderRequirements') or []],
                'bonuses': l.get('bonuses'),
            }))
        stations.append(prune({
            'id': s['id'], 'key': s.get('normalizedName'),
            'name': en.get(s.get('name'), s.get('name')), 'levels': lv,
        }))
    cr = []
    for c in crafts:
        cr.append(prune({
            'id': c['id'], 'station': c['station'], 'level': c['level'],
            'task': c.get('taskUnlock'), 'time': c.get('duration'),
            'need': [[r['item'], r['count'], prune(dict(r.get('attributes') or {})) or None] for r in c.get('requiredItems') or []],
            'give': [[r['item'], r['count']] for r in c.get('rewardItems') or []],
        }))
    for c in cr:
        c['need'] = [[a, b] if x is None else [a, b, x] for a, b, x in c.get('need', [])]
    return {'v': 1, 'stations': stations, 'crafts': cr}


# ---------------------------------------------------------
# art
# ---------------------------------------------------------
def download_art(qitems, traders, tasks_raw, ach):
    jobs = []
    items_dir = os.path.join(ROOT, 'assets', 'items')
    for qid in qitems:
        jobs.append((f'https://assets.tarkov.dev/{qid}-grid-image.webp', os.path.join(items_dir, qid + '.webp')))
    tr_raw = tdev('traders')['data']
    tdir = os.path.join(ROOT, 'assets', 'traders')
    for t in traders:
        link = tr_raw[t['id']].get('imageLink')
        if link:
            jobs.append((link, os.path.join(tdir, t['key'] + '.webp')))
    qdir = os.path.join(ROOT, 'assets', 'quests')
    for t in tasks_raw.values():
        if t.get('taskImageLink'):
            jobs.append((t['taskImageLink'], os.path.join(qdir, os.path.basename(t['taskImageLink']))))
    adir = os.path.join(ROOT, 'assets', 'achievements')
    ach_raw = tdev('tasks')['data'].get('achievements', {})
    for a in ach_raw.values():
        if a.get('imageLink'):
            jobs.append((a['imageLink'], os.path.join(adir, os.path.basename(a['imageLink']))))

    def one(job):
        url, dest = job
        if os.path.exists(dest) and os.path.getsize(dest) > 200:
            return 'have'
        data = fetch(url, binary=True)
        if not data or len(data) < 200:
            return 'fail'
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        with open(dest, 'wb') as f:
            f.write(data)
        return 'new'

    with ThreadPoolExecutor(max_workers=6) as ex:
        res = Counter(ex.map(one, jobs))
    print(f'  art: {dict(res)} of {len(jobs)}')


# ---------------------------------------------------------
def write(name, obj):
    path = os.path.join(OUT, name)
    os.makedirs(OUT, exist_ok=True)
    txt = json.dumps(obj, ensure_ascii=False, separators=(',', ':'))
    with open(path, 'w', encoding='utf-8', newline='\n') as f:
        f.write(txt)
    print(f'  wrote {name}: {len(txt.encode("utf-8")) / 1024:.0f} KiB')


def main():
    art = '--art' in sys.argv
    report = '--report' in sys.argv

    print('tasks ...')
    tasks, qitems, zones, ach, missing_desc, tasks_raw, gvars = build_tasks()
    print('traders ...')
    traders = build_traders(tasks_raw)
    presets = build_presets()
    offers = build_offers(traders, presets)
    print('progression, profiles, hideout ...')
    progress = build_progress()
    profiles = build_profiles()
    hideout = build_hideout()

    stamp = time.strftime('%Y-%m-%d')
    write('traders-db.json', {'v': 1, 'built': stamp, 'traders': traders, 'offers': offers, 'presets': presets})
    write('quests-db.json', {'v': 1, 'built': stamp, 'tasks': tasks, 'questItems': qitems,
                             'zones': zones, 'achievements': ach, 'gvars': gvars})
    write('progress-db.json', progress)
    write('profiles-db.json', profiles)
    write('hideout-db.json', hideout)

    if art:
        print('art ...')
        download_art(qitems, traders, tasks_raw, ach)

    if report:
        by_trader = Counter(t['trader'] for t in tasks)
        names = {t['id']: t['name'] for t in traders}
        print('\n--- report ---')
        print('traders:', ', '.join(f"{t['name']}{' (locked)' if t.get('locked') else ''}" for t in traders))
        print('tasks:', len(tasks), {names.get(k, k): v for k, v in by_trader.most_common()})
        print('loyalty-level pools:', dict(sorted(Counter(t['tier'] for t in tasks if t.get('tier')).items())),
              'variables:', len(gvars), 'retired:', sum(1 for t in tasks if t.get('retired')))
        print('task types:', dict(Counter(t['type'] for t in tasks)))
        print('objective types:', dict(Counter(o['type'] for t in tasks for o in t['obj'])))
        print('zones:', len(zones), 'task items:', len(qitems), 'achievements:', len(ach))
        print('tasks without a description:', len(missing_desc))
        cash = [o for o in offers if not o.get('barter')]
        print('offers:', len(offers), 'cash', len(cash), 'barter', len(offers) - len(cash),
              'task-locked', sum(1 for o in offers if o.get('task')),
              'preset offers', sum(1 for o in offers if o.get('preset')), 'builds', len(presets),
              'with a tree', sum(1 for p in presets.values() if p.get('tree')))
        per = Counter(traders[o['t']]['name'] for o in offers)
        print('offers per trader:', dict(per))
        print('levels:', len(progress['levels']), 'skills:', len(progress['skills']))
        for k, e in profiles['editions'].items():
            print(f"profile {k}: usec {len(e['usec']['inventory']['items'])} items, bear {len(e['bear']['inventory']['items'])}")
        print('hideout stations:', len(hideout['stations']), 'crafts:', len(hideout['crafts']))


if __name__ == '__main__':
    main()
