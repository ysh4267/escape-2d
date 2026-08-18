#!/usr/bin/env python3
# =========================================================
# ESCAPE 2D - weapon tree expansion
#
# The curated SELECTION names the guns. Everything a gun can be built out of -
# every handguard, dust cover, mount, sight, stock, magazine, muzzle device -
# and every cartridge those magazines take, is not curated by hand: it is the
# transitive closure of the templates' own Slots / Cartridges / Chambers
# filters, read straight out of the SPT 3.10.1 items.json dump. Add a weapon
# to selection.py and its whole build tree comes with it on the next run.
#
# Also read here:
#   - the per-template modding numbers (Ergonomics, Recoil, Accuracy, Velocity,
#     SightingRange, Loudness, ExtraSize*, HeatFactor ...)
#   - the weapon's own numbers (RecoilForceUp/Back, weapFireType, bFirerate,
#     CenterOfImpact, Chambers, defAmmo, Foldable/FoldedSlot ...)
#   - magazine capacity and cartridge filters
#   - the ballistics of every round (Damage, PenetrationPower, ArmorDamage,
#     FragmentationChance, InitialSpeed, ammoRec, ProjectileCount ...)
#   - the default preset of every weapon from globals.json ItemPresets, so a
#     gun bought from a trader or found in a crate arrives assembled the way
#     the real one does, plus the factory alternates (AKMB, "Tactical" MP-133,
#     the NERFGUN Saiga ...) the build screen offers
#   - the repair numbers (RepairCost, Min/MaxRepairDegradation, the kit ones)
#   - ammo packs: every AmmoBox whose StackSlots filter is a round we carry,
#     the weapon repair kit, and the two weapon cases - records that are not
#     parts but exist only because the weapons do
# =========================================================

from __future__ import annotations

import re
from collections import Counter

# template parent id -> (gameplay category, mod type)
PARENT_KIND = {
    '5447b5f14bdc2d61278b4567': ('weapon', None),        # AssaultRifle
    '5447b5cf4bdc2d65278b4567': ('pistol', None),        # Pistol
    '5447b6094bdc2dc3278b4567': ('weapon', None),        # Shotgun
    '5447b5e04bdc2d62278b4567': ('weapon', None),        # Smg
    '5447b6194bdc2d67278b4567': ('weapon', None),        # MarksmanRifle
    '5447b5fc4bdc2d87278b4567': ('weapon', None),        # AssaultCarbine
    '5447b6254bdc2dc3278b4568': ('weapon', None),        # SniperRifle
    '5447bed64bdc2d97278b4568': ('weapon', None),        # MachineGun
    '5448bc234bdc2d3c308b4569': ('mag', 'magazine'),     # Magazine
    '610720f290b75a49ff2e5e25': ('mag', 'magazine'),     # CylinderMagazine
    '555ef6e44bdc2de9068b457e': ('mod', 'barrel'),
    '55818a104bdc2db9688b4569': ('mod', 'handguard'),
    '56ea9461d2720b67698b456f': ('mod', 'gasblock'),
    '550aa4bf4bdc2dd6348b456b': ('mod', 'muzzle'),       # FlashHider
    '550aa4dd4bdc2dc9348b4569': ('mod', 'muzzle'),       # MuzzleCombo
    '550aa4cd4bdc2dd8348b456c': ('mod', 'suppressor'),   # Silencer
    '55818a684bdc2ddd698b456d': ('mod', 'grip'),         # PistolGrip
    '55818af64bdc2d5b648b4570': ('mod', 'foregrip'),
    '55818a594bdc2db9688b456a': ('mod', 'stock'),
    '55818a304bdc2db5418b457d': ('mod', 'receiver'),
    '55818b224bdc2dde698b456f': ('mod', 'mount'),
    '55818ac54bdc2d5b648b456e': ('mod', 'ironsight'),
    '55818ad54bdc2ddc698b4569': ('mod', 'reflex'),       # Collimator
    '55818acf4bdc2dde698b456b': ('mod', 'reflex'),       # CompactCollimator
    '55818add4bdc2d5b648b456f': ('mod', 'scope'),        # AssaultScope
    '55818ae44bdc2dde698b456c': ('mod', 'scope'),        # OpticScope
    '55818aeb4bdc2ddc698b456a': ('mod', 'scope'),        # SpecialScope
    '55818b164bdc2ddc698b456c': ('mod', 'tactical'),     # TacticalCombo
    '55818b084bdc2d5b648b4571': ('mod', 'tactical'),     # Flashlight
    '55818b0e4bdc2dde698b456e': ('mod', 'tactical'),     # LaserDesignator
    '55818a6f4bdc2db9688b456b': ('mod', 'charge'),
    '5a74651486f7744e73386dd1': ('mod', 'aux'),
    '55818afb4bdc2dde698b456d': ('mod', 'bipod'),
}
# a grenade launcher is a second weapon hanging under the first, with its own
# ammunition and firing logic; it is out of scope for the modding system
SKIP_PARENTS = {'55818b014bdc2ddc698b456b'}   # Launcher

AMMO_BOX_PARENT = '543be5cb4bdc2deb348b4568'
# things that ride along with the weapons: the kit that mends them and the
# cases that store them - id -> (key, cat, extra template fields)
COMPANIONS = {
    '5910968f86f77425cf569c32': ('weaprepkit', 'barter',
                                 {'repairKit': {'max': 1000, 'type': 'weapon'}, 'res': 1000}),
    '59fb023c86f7746d0d4b423c': ('weaponcase', 'container',
                                 {'filter': {'allow': ['weapon', 'pistol', 'mod', 'mag', 'ammo', 'ammobox']}}),
    '5b6d9ce188a4501afc1b2b25': ('thiccweaponcase', 'container',
                                 {'filter': {'allow': ['weapon', 'pistol', 'mod', 'mag', 'ammo', 'ammobox']}}),
}

MOD_TYPE_LABEL = {
    'barrel': 'Barrel', 'handguard': 'Handguard', 'gasblock': 'Gas block',
    'muzzle': 'Muzzle device', 'suppressor': 'Suppressor', 'grip': 'Pistol grip',
    'foregrip': 'Foregrip', 'stock': 'Stock', 'receiver': 'Receiver',
    'mount': 'Mount', 'ironsight': 'Iron sight', 'reflex': 'Reflex sight',
    'scope': 'Scope', 'tactical': 'Tactical device', 'charge': 'Charging handle',
    'aux': 'Auxiliary part', 'bipod': 'Bipod', 'magazine': 'Magazine',
}

# the slot names as the game labels them on the modding screen
SLOT_LABEL = {
    'mod_barrel': 'Barrel', 'mod_handguard': 'Handguard', 'mod_gas_block': 'Gas block',
    'mod_muzzle': 'Muzzle', 'mod_pistol_grip': 'Pistol grip', 'mod_pistolgrip': 'Pistol grip',
    'mod_stock': 'Stock', 'mod_reciever': 'Receiver', 'mod_sight_rear': 'Rear sight',
    'mod_sight_front': 'Front sight', 'mod_magazine': 'Magazine', 'mod_mount': 'Mount',
    'mod_scope': 'Scope', 'mod_tactical': 'Tactical', 'mod_foregrip': 'Foregrip',
    'mod_charge': 'Charging handle', 'mod_launcher': 'Launcher', 'mod_flashlight': 'Flashlight',
    'mod_bipod': 'Bipod', 'mod_equipment': 'Equipment', 'mod_nvg': 'NVG',
}


def slot_label(name: str) -> str:
    base = re.sub(r'_\d+$', '', name)
    lab = SLOT_LABEL.get(base)
    if not lab:
        lab = base.replace('mod_', '').replace('_', ' ').capitalize()
    m = re.search(r'_(\d+)$', name)
    if m:
        lab = f'{lab} {int(m.group(1)) + 1}'
    return lab


def kind_of(items, iid):
    node = items.get(iid)
    if not node:
        return None
    return PARENT_KIND.get(node['_parent'])


def slug(text: str) -> str:
    s = re.sub(r'[^a-z0-9]+', '_', text.lower()).strip('_')
    return s or 'x'


def _filters(entry):
    """all ids allowed by a Slots / Cartridges / Chambers entry"""
    out = []
    for f in entry.get('_props', {}).get('filters', []):
        out.extend(f.get('Filter', []))
    return out


def closure(items, roots):
    """
    Every template reachable from `roots` through Slots filters, minus the
    launcher subtree. Returns {id: depth}.
    """
    depth = {}
    queue = [(r, 0) for r in roots]
    while queue:
        iid, d = queue.pop()
        if iid in depth or iid not in items:
            continue
        node = items[iid]
        if node['_parent'] in SKIP_PARENTS:
            continue
        depth[iid] = d
        for s in node['_props'].get('Slots', []) or []:
            for f in _filters(s):
                if f in items and f not in depth and items[f]['_parent'] not in SKIP_PARENTS:
                    queue.append((f, d + 1))
    return depth


def ammo_for(items, ids, calibers):
    """every cartridge the closure's magazines / chambers accept, in the given calibers"""
    out = set()
    for iid in ids:
        p = items[iid]['_props']
        for c in (p.get('Cartridges') or []) + (p.get('Chambers') or []):
            for f in _filters(c):
                a = items.get(f)
                if a and a['_props'].get('Caliber') in calibers:
                    out.add(f)
    return out


# the template's Caliber enum -> how the game prints it
CAL_NAMES = {
    '545x39': '5.45x39', '762x39': '7.62x39', '762x25TT': '7.62x25', '9x18PM': '9x18',
    '9x18PMM': '9x18', '12g': '12/70', '20g': '20/70', '9x19PARA': '9x19', '9x21': '9x21',
    '556x45NATO': '5.56x45', '762x51': '7.62x51', '762x54R': '7.62x54R', '9x39': '9x39',
    '366TKM': '.366 TKM', '46x30': '4.6x30', '57x28': '5.7x28', '1143x23ACP': '.45 ACP',
    '127x55': '12.7x55', '86x70': '.338 LM', '23x75': '23x75', '40x46': '40x46',
    '762x35': '.300 BLK', '68x51': '6.8x51',
}


def caliber(props):
    cal = props.get('Caliber') or props.get('ammoCaliber')
    if not cal:
        return None
    raw = str(cal).replace('Caliber', '')
    return CAL_NAMES.get(raw, raw)


def _num(v, nd=3):
    if v is None:
        return None
    if isinstance(v, bool):
        return v
    if isinstance(v, int):
        return v
    r = round(float(v), nd)
    return int(r) if r == int(r) else r


def _put(d, k, v, skip_zero=True):
    if v is None:
        return
    if skip_zero and (v == 0 or v is False or v == '' or v == []):
        return
    d[k] = v


def extra_size(props):
    xs = [int(props.get('ExtraSizeLeft') or 0), int(props.get('ExtraSizeRight') or 0),
          int(props.get('ExtraSizeUp') or 0), int(props.get('ExtraSizeDown') or 0)]
    return xs if any(xs) else None


def mod_fields(props):
    """the numbers every attachable part carries"""
    m = {}
    _put(m, 'ergo', _num(props.get('Ergonomics')))
    _put(m, 'recoil', _num(props.get('Recoil')))
    _put(m, 'acc', _num(props.get('Accuracy')))
    _put(m, 'vel', _num(props.get('Velocity')))
    _put(m, 'range', _num(props.get('SightingRange')))
    _put(m, 'loud', _num(props.get('Loudness')))
    _put(m, 'heat', _num(props.get('HeatFactor')))
    _put(m, 'cool', _num(props.get('CoolFactor')))
    _put(m, 'dburn', _num(props.get('DurabilityBurnModificator')))
    _put(m, 'shoulder', bool(props.get('HasShoulderContact')))
    _put(m, 'blocksFold', bool(props.get('BlocksFolding')))
    _put(m, 'blocksCollapse', bool(props.get('BlocksCollapsible')))
    _put(m, 'foldable', bool(props.get('Foldable')))
    _put(m, 'retract', bool(props.get('Retractable')))
    if props.get('Foldable') and props.get('FoldedSlot'):
        m['foldSlot'] = props['FoldedSlot']
    _put(m, 'sizeReduceR', _num(props.get('SizeReduceRight')))
    xs = extra_size(props)
    if xs:
        m['xs'] = xs
        if props.get('ExtraSizeForceAdd'):
            m['xsAdd'] = True
    # sight magnification, where the template says
    zooms = props.get('Zooms')
    if zooms and isinstance(zooms, list) and zooms and isinstance(zooms[0], list):
        flat = [z for zz in zooms for z in zz]
        if flat and max(flat) > 1:
            m['zoom'] = _num(max(flat), 1)
    if props.get('RaidModdable') is False:
        m['noRaidMod'] = True
    if props.get('ToolModdable'):
        m['toolMod'] = True
    # a barrel carries the accuracy of a gun whose receiver has none (the TT),
    # and the shotgun barrels the pattern spread
    _put(m, 'moa', _num(props.get('CenterOfImpact'), 4))
    _put(m, 'shotDisp', _num(props.get('ShotgunDispersion'), 3))
    if props.get('DeviationMax'):
        m['dev'] = [_num(props.get('DeviationCurve'), 3), _num(props.get('DeviationMax'), 3)]
    # sights: every zoom step per sight mode, the zeroing distances, the
    # sight family; tacticals: how many modes the switch cycles through
    if zooms and isinstance(zooms, list) and zooms and isinstance(zooms[0], list):
        flat_modes = [[_num(z, 1) for z in zz] for zz in zooms]
        if any(z != 1 for zz in flat_modes for z in zz) or len(flat_modes) > 1:
            m['zooms'] = flat_modes
    cal = props.get('CalibrationDistances')
    if cal and isinstance(cal, list) and cal and isinstance(cal[0], list):
        m['zero'] = [[int(d) for d in dd] for dd in cal]
    _put(m, 'sightType', props.get('sightModType'))
    _put(m, 'muzzleType', props.get('muzzleModType'))
    modes = props.get('ModesCount')
    if isinstance(modes, list) and modes and max(modes) > 1:
        m['modes'] = [int(x) for x in modes]
    elif isinstance(modes, (int, float)) and modes > 1:
        m['modes'] = [int(modes)]
    return m


def weapon_fields(props, key_of):
    w = {}
    modes = props.get('weapFireType') or []
    if modes:
        w['fire'] = list(modes)
    _put(w, 'rup', _num(props.get('RecoilForceUp')))
    _put(w, 'rback', _num(props.get('RecoilForceBack')))
    _put(w, 'rangle', _num(props.get('RecoilAngle')))
    _put(w, 'rdisp', _num(props.get('RecolDispersion')))
    _put(w, 'camRecoil', _num(props.get('CameraRecoil'), 4))
    _put(w, 'moa', _num(props.get('CenterOfImpact'), 4))
    _put(w, 'vel', _num(props.get('Velocity')))
    _put(w, 'range', _num(props.get('SightingRange')))
    _put(w, 'ironRange', _num(props.get('IronSightRange')))
    _put(w, 'eff', _num(props.get('bEffDist')))
    _put(w, 'hear', _num(props.get('bHearDist')))
    _put(w, 'dura', _num(props.get('Durability')))
    _put(w, 'maxDura', _num(props.get('MaxDurability')))
    _put(w, 'spawnDura', [_num(props.get('durabSpawnMin')), _num(props.get('durabSpawnMax'))]
         if props.get('durabSpawnMax') else None)
    _put(w, 'rpm', _num(props.get('bFirerate')))
    _put(w, 'srpm', _num(props.get('SingleFireRate')))
    _put(w, 'burst', _num(props.get('BurstShotsCount')))
    _put(w, 'chambers', len(props.get('Chambers') or []))
    _put(w, 'chamberLoad', bool(props.get('isChamberLoad')))
    _put(w, 'bolt', bool(props.get('BoltAction')))
    _put(w, 'reload', props.get('ReloadMode'))
    _put(w, 'cls', props.get('weapClass'))
    _put(w, 'use', props.get('weapUseType'))
    _put(w, 'fold', bool(props.get('Foldable')))
    if props.get('Foldable') and props.get('FoldedSlot'):
        w['foldSlot'] = props['FoldedSlot']
    _put(w, 'sizeReduceR', _num(props.get('SizeReduceRight')))
    _put(w, 'malf', _num(props.get('BaseMalfunctionChance'), 4))
    _put(w, 'heatShot', _num(props.get('HeatFactorByShot'), 4))
    _put(w, 'heatGun', _num(props.get('HeatFactorGun'), 4))
    _put(w, 'coolGun', _num(props.get('CoolFactorGun'), 4))
    _put(w, 'dburn', _num(props.get('DurabilityBurnRatio'), 4))
    _put(w, 'shotDisp', _num(props.get('shotgunDispersion')))
    _put(w, 'repairCost', _num(props.get('RepairCost')))
    # how much of the maximum a repair grinds off: a uniform roll in this range
    # times the current maximum (times the repairer's quality) - RepairHelper
    if props.get('MaxRepairDegradation'):
        w['repairDeg'] = [_num(props.get('MinRepairDegradation') or 0, 4), _num(props['MaxRepairDegradation'], 4)]
    if props.get('MaxRepairKitDegradation'):
        w['kitDeg'] = [_num(props.get('MinRepairKitDegradation') or 0, 4), _num(props['MaxRepairKitDegradation'], 4)]
    _put(w, 'repairSpeed', _num(props.get('RepairSpeed')))
    _put(w, 'opRes', _num(props.get('OperatingResource')))
    _put(w, 'lootXp', _num(props.get('LootExperience')))
    _put(w, 'boltCatch', bool(props.get('isBoltCatch')))
    if props.get('isFastReload') is False:
        w['slowReload'] = True
    if props.get('CanQueueSecondShot') is False:
        w['noQueue'] = True
    if props.get('DeviationMax'):
        w['dev'] = [_num(props.get('DeviationCurve'), 3), _num(props.get('DeviationMax'), 3)]
    _put(w, 'rarity', props.get('RarityPvE'))
    _put(w, 'vital', bool(props.get('ForbidMissingVitalParts')))
    da = key_of(props.get('defAmmo'))
    if da:
        w['defAmmo'] = da
    dm = key_of(props.get('defMagType'))
    if dm:
        w['defMag'] = dm
    xs = extra_size(props)
    if xs:
        w['xs'] = xs
    return w


def mag_fields(props, key_of):
    m = {}
    carts = props.get('Cartridges') or []
    if carts:
        m['size'] = int(carts[0].get('_max_count') or 0)
        allowed = [key_of(f) for f in _filters(carts[0])]
        m['ammo'] = [k for k in allowed if k]
    _put(m, 'load', _num(props.get('LoadUnloadModifier')))
    _put(m, 'check', _num(props.get('CheckTimeModifier')))
    _put(m, 'malf', _num(props.get('MalfunctionChance'), 4))
    _put(m, 'type', props.get('ReloadMagType'))
    _put(m, 'visible', props.get('VisibleAmmoRangesString'))
    # a window or a translucent body: the count is read exactly on a check
    _put(m, 'checkOverride', _num(props.get('CheckOverride')))
    _put(m, 'anim', _num(props.get('magAnimationIndex')))
    return m


def ammo_fields(props):
    a = {}
    _put(a, 'dmg', _num(props.get('Damage')))
    _put(a, 'pen', _num(props.get('PenetrationPower')))
    _put(a, 'armorDmg', _num(props.get('ArmorDamage')))
    _put(a, 'frag', _num(props.get('FragmentationChance'), 3))
    _put(a, 'speed', _num(props.get('InitialSpeed')))
    _put(a, 'rec', _num(props.get('ammoRec')))
    _put(a, 'acc', _num(props.get('ammoAccr')))
    _put(a, 'proj', _num(props.get('ProjectileCount')))
    _put(a, 'buck', _num(props.get('buckshotBullets')))
    _put(a, 'tracer', bool(props.get('Tracer')))
    _put(a, 'tracerColor', props.get('TracerColor') if props.get('Tracer') else None)
    _put(a, 'misfire', _num(props.get('MalfMisfireChance'), 4))
    _put(a, 'feed', _num(props.get('MalfFeedChance'), 4))
    _put(a, 'lbleed', _num(props.get('LightBleedingDelta'), 3))
    _put(a, 'hbleed', _num(props.get('HeavyBleedingDelta'), 3))
    _put(a, 'ric', _num(props.get('RicochetChance'), 3))
    _put(a, 'dburn', _num(props.get('DurabilityBurnModificator'), 3))
    _put(a, 'heat', _num(props.get('HeatFactor'), 4))
    _put(a, 'mass', _num(props.get('BulletMassGram'), 2))
    _put(a, 'diam', _num(props.get('BulletDiameterMilimeters'), 2))
    _put(a, 'bc', _num(props.get('BallisticCoeficient'), 4))
    _put(a, 'type', props.get('ammoType'))
    _put(a, 'staminaBurn', _num(props.get('StaminaBurnPerDamage'), 4))
    _put(a, 'penObst', _num(props.get('PenetrationChanceObstacle'), 3))
    if props.get('MaxFragmentsCount'):
        a['frags'] = [int(props.get('MinFragmentsCount') or 0), int(props['MaxFragmentsCount'])]
    _put(a, 'penDmgMod', _num(props.get('PenetrationDamageMod'), 3))
    _put(a, 'penDev', _num(props.get('PenetrationPowerDiviation'), 3))
    _put(a, 'misfireBase', _num(props.get('MisfireChance'), 3))
    if props.get('StackMaxRandom'):
        a['stackRnd'] = [int(props.get('StackMinRandom') or 1), int(props['StackMaxRandom'])]
    # the game has no subsonic flag; the wiki marks anything under the speed
    # of sound, and so does the card
    if props.get('InitialSpeed') and float(props['InitialSpeed']) < 343:
        a['subsonic'] = True
    _put(a, 'rarity', props.get('RarityPvE'))
    return a


def slots_of(props, key_of, all_slots=False):
    """[{n, req, f:[keys], merge}] for the template's Slots, dropping empty ones"""
    out = []
    for s in props.get('Slots') or []:
        keys = [key_of(f) for f in _filters(s)]
        keys = [k for k in keys if k]
        if not keys and not all_slots:
            continue
        rec = {'n': s['_name'], 'f': keys}
        if s.get('_required'):
            rec['req'] = True
        if s.get('_mergeSlotWithChildren'):
            rec['merge'] = True
        out.append(rec)
    return out


def preset_tree(preset, key_of):
    """
    globals.json ItemPresets entry -> {slotName: {t: key, s: {...}}} for the
    root weapon. Parts whose template we do not carry are dropped along with
    whatever hangs off them.
    """
    by_id = {it['_id']: it for it in preset['_items']}
    kids = {}
    for it in preset['_items']:
        pid = it.get('parentId')
        if pid:
            kids.setdefault(pid, []).append(it)
    root = next((it for it in preset['_items'] if not it.get('parentId')), None)
    if not root:
        return None

    def build(node):
        out = {}
        for ch in kids.get(node['_id'], []):
            k = key_of(ch['_tpl'])
            if not k or not ch.get('slotId'):
                continue
            # rounds sitting in a magazine are a load, not a part
            if ch['slotId'] == 'cartridges':
                continue
            rec = {'t': k}
            sub = build(ch)
            if sub:
                rec['s'] = sub
            out[ch['slotId']] = rec
        return out

    return build(root)


def preset_load(preset, key_of):
    """the rounds a preset ships loaded, as [{t, n}] top last - or None"""
    runs = []
    for it in preset['_items']:
        if it.get('slotId') != 'cartridges':
            continue
        k = key_of(it['_tpl'])
        if not k:
            continue
        n = int((it.get('upd') or {}).get('StackObjectsCount') or 1)
        if runs and runs[-1]['t'] == k:
            runs[-1]['n'] += n
        else:
            runs.append({'t': k, 'n': n})
    return runs or None


def alt_presets(globals_db, weapon_id, key_of, en):
    """
    The factory presets of a weapon other than the default one - the AKMB,
    the "Tactical" MP-133, the NERFGUN Saiga - as the build screen offers them:
    [{id, name, label, tree, load}]. Only builds every part of which we carry.
    """
    out = []
    for pid, pr in (globals_db.get('ItemPresets') or {}).items():
        if pr.get('_encyclopedia'):
            continue
        root = next((it for it in pr['_items'] if not it.get('parentId')), None)
        if not root or root['_tpl'] != weapon_id:
            continue
        # every part must be one we carry, or the build lies about itself
        if any(key_of(it['_tpl']) is None for it in pr['_items'] if it is not root):
            continue
        tree = preset_tree(pr, key_of)
        if not tree:
            continue
        rec = {'id': pid, 'name': pr.get('_name') or pid, 'tree': tree}
        label = en.get(pid) or en.get(pid + ' Name')
        if label:
            rec['label'] = label
        load = preset_load(pr, key_of)
        if load:
            rec['load'] = load
        out.append(rec)
    return out


def expand(items, hb_items, en, selection_ids, our_keys):
    """
    selection_ids : {id: key} for everything the curated list already names
    our_keys      : set of keys already taken

    Returns a list of new records the builder should add:
      {'key','id','cat','modType'} — the builder pulls the rest from the
      template exactly as it does for curated rows.
    """
    weapons = [iid for iid, k in selection_ids.items()
               if (kind_of(items, iid) or (None,))[0] in ('weapon', 'pistol')]
    depth = closure(items, weapons)
    calibers = {items[w]['_props'].get('ammoCaliber') for w in weapons}
    calibers.discard(None)
    ammo = ammo_for(items, depth.keys(), calibers)

    taken = set(our_keys)
    new = []
    counts = Counter()

    def make_key(prefix, iid):
        short = en.get(iid + ' ShortName') or en.get(iid + ' Name') or items[iid]['_name']
        base = f'{prefix}_{slug(short)}'[:40]
        k, n = base, 2
        while k in taken:
            k = f'{base}_{n}'
            n += 1
        taken.add(k)
        return k

    for iid in sorted(depth, key=lambda i: (depth[i], i)):
        if iid in selection_ids:
            continue
        kind = kind_of(items, iid)
        if not kind:
            continue
        cat, mtype = kind
        if cat in ('weapon', 'pistol'):
            continue    # a weapon reachable through a slot (launchers) is skipped
        # a template the handbook does not price is noise: the only unpriced
        # magazines reachable are the 999-round zombie-event ones, which the
        # dump names *_infectedMagazin and marks Not_exist
        if iid not in hb_items:
            continue
        prefix = 'mag' if cat == 'mag' else 'mod'
        new.append({'key': make_key(prefix, iid), 'id': iid, 'cat': cat, 'modType': mtype})
        counts[cat] += 1

    ammo_keys = {}
    for iid in sorted(ammo):
        if iid in selection_ids:
            ammo_keys[iid] = selection_ids[iid]
            continue
        if iid not in hb_items:
            continue
        k = make_key('am', iid)
        ammo_keys[iid] = k
        new.append({'key': k, 'id': iid, 'cat': 'ammo', 'modType': None})
        counts['ammo'] += 1
    # rounds the curated list names on its own (the AK calibres' PS/BP)
    for iid, k in selection_ids.items():
        if items.get(iid, {}).get('_parent') == '5485a8684bdc2da71d8b4567':
            ammo_keys.setdefault(iid, k)

    # --- ammo packs: a box of one round type, unpacked into stacks ---
    # The handbook prices every box at a flat 1000, so a box is priced as its
    # rounds. The dump carries dev duplicates of the 120-round 5.45 packs
    # (ExaminedByDefault false, RarityPvE Not_exist); those are skipped.
    for iid, node in items.items():
        if node.get('_parent') != AMMO_BOX_PARENT:
            continue
        p = node['_props']
        if p.get('ExaminedByDefault') is False or iid not in hb_items:
            continue
        slots = p.get('StackSlots') or []
        if not slots:
            continue
        inside = None
        for f in slots[0].get('_props', {}).get('filters', []):
            for a in f.get('Filter', []):
                if a in ammo_keys:
                    inside = a
        if not inside:
            continue
        n = int(slots[0].get('_max_count') or 0)
        if n <= 0:
            continue
        rk = ammo_keys[inside]
        price = int(hb_items.get(inside, {}).get('Price', 0) or 0) * n
        short = en.get(inside + ' ShortName') or rk
        base = f"box_{slug(short)}_{n}"
        k2, i2 = base, 2
        while k2 in taken:
            k2 = f'{base}_{i2}'
            i2 += 1
        taken.add(k2)
        # the box's own ammoCaliber is stale in the dump (5.45 packs say 9x18);
        # the round inside is the truth
        new.append({'key': k2, 'id': iid, 'cat': 'ammobox', 'modType': None,
                    'extra': {'box': {'t': rk, 'n': n}, 'price': price, 'known': True,
                              'cal': caliber(items[inside]['_props'])}})
        counts['ammobox'] += 1

    # --- the repair kit and the weapon cases ---
    for iid, (key, cat, extra) in COMPANIONS.items():
        if iid in selection_ids or iid not in items or key in taken:
            continue
        taken.add(key)
        new.append({'key': key, 'id': iid, 'cat': cat, 'modType': None, 'extra': dict(extra)})
        counts[cat] += 1

    return new, counts, depth
