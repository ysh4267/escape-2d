#!/usr/bin/env python3
# =========================================================
# ESCAPE 2D - weapons, parts, magazines and cartridges
#
# What a template says about a gun and everything that goes on it or in it,
# read out of the template's own _props (the SPT dumps' vocabulary, with the
# live numbers already laid over them by items_live.live_props):
#
#   - the per-template modding numbers (Ergonomics, Recoil, Accuracy, Velocity,
#     SightingRange, Loudness, ExtraSize*, HeatFactor ...)
#   - the weapon's own numbers (RecoilForceUp/Back, weapFireType, bFirerate,
#     CenterOfImpact, Chambers, defAmmo, Foldable/FoldedSlot ...)
#   - magazine capacity and cartridge filters
#   - the ballistics of every round (Damage, PenetrationPower, ArmorDamage,
#     FragmentationChance, InitialSpeed, ammoRec, ProjectileCount ...)
#   - the repair numbers (RepairCost, Min/MaxRepairDegradation, the kit ones)
#   - a preset out of globals.json ItemPresets as the tree the game hangs on a
#     new gun, and the rounds it ships loaded with
#
# Which templates exist at all is not decided here any more: every weapon,
# every part, every magazine and every cartridge of the live game is in the
# database (build_items.py), so every slot filter resolves on its own.
# =========================================================

from __future__ import annotations

import re

MOD_TYPE_LABEL = {
    'barrel': 'Barrel', 'handguard': 'Handguard', 'gasblock': 'Gas block',
    'muzzle': 'Muzzle device', 'suppressor': 'Suppressor', 'grip': 'Pistol grip',
    'foregrip': 'Foregrip', 'stock': 'Stock', 'receiver': 'Receiver',
    'mount': 'Mount', 'ironsight': 'Iron sight', 'reflex': 'Reflex sight',
    'scope': 'Scope', 'tactical': 'Tactical device', 'charge': 'Charging handle',
    'aux': 'Auxiliary part', 'bipod': 'Bipod', 'magazine': 'Magazine',
    'launcher': 'Underbarrel launcher',
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


def _filters(entry):
    """all ids allowed by a Slots / Cartridges / Chambers entry"""
    out = []
    for f in entry.get('_props', {}).get('filters', []):
        out.extend(f.get('Filter', []))
    return out


# the template's Caliber enum -> how the game prints it
CAL_NAMES = {
    '545x39': '5.45x39', '762x39': '7.62x39', '762x25TT': '7.62x25', '9x18PM': '9x18',
    '9x18PMM': '9x18', '12g': '12/70', '20g': '20/70', '9x19PARA': '9x19', '9x21': '9x21',
    '556x45NATO': '5.56x45', '762x51': '7.62x51', '762x54R': '7.62x54R', '9x39': '9x39',
    '366TKM': '.366 TKM', '46x30': '4.6x30', '57x28': '5.7x28', '1143x23ACP': '.45 ACP',
    '127x55': '12.7x55', '86x70': '.338 LM', '23x75': '23x75', '40x46': '40x46',
    '762x35': '.300 BLK', '68x51': '6.8x51',
    '127x33': '.50 AE', '127x99': '.50 BMG', '9x33R': '.357', '58x42': '5.8x42',
    '784x49': '.308 ME', '93x64': '9.3x64', '26x75': '26x75', '40mmRU': '40mm VOG',
    '725': '72.5mm', '20x1mm': '20x1mm',
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
    # a gun with no magazine at all - a double barrel, a break-action launcher,
    # a signal pistol - is loaded through its chambers, so it is the gun
    # itself that says what it takes
    if props.get('ReloadMode') == 'OnlyBarrel' and props.get('Chambers'):
        _put(w, 'ammo', [k for k in (key_of(f) for f in _filters(props['Chambers'][0])) if k])
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


def cylinder_chambers(props):
    """
    A revolver's cylinder keeps its rounds in chambers of its own (`camora_000`
    ... slots that take a cartridge), not in a feed. Those are capacity, not
    part slots: they come off the slot list, and a cylinder whose feed says 0
    holds as many rounds as it has chambers, of the kinds they take.
    """
    slots = props.get('Slots') or []
    chambers = [s for s in slots if s.get('_name', '').startswith('camora')]
    if not chambers:
        return
    props['Slots'] = [s for s in slots if s not in chambers]
    carts = props.get('Cartridges') or []
    if carts and not int(carts[0].get('_max_count') or 0):
        ammo = []
        for s in chambers:
            ammo.extend(f for f in _filters(s) if f not in ammo)
        props['Cartridges'] = [dict(carts[0], _max_count=len(chambers), _props={'filters': [{'Filter': ammo}]})]


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


def preset_tree(preset, key_of, is_part=None):
    """
    globals.json ItemPresets entry -> {slotName: {t: key, s: {...}}} for the
    root item. A cartridge - in the magazine or in the chamber - is a load,
    not a part, and so is a built-in armour insert: `is_part(template id)`
    says which is which. Parts whose template we do not carry are dropped
    along with whatever hangs off them.
    """
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
            if is_part is not None and not is_part(ch['_tpl']):
                continue
            rec = {'t': k}
            sub = build(ch)
            if sub:
                rec['s'] = sub
            out[ch['slotId']] = rec
        return out

    return build(root)


def preset_root(preset):
    """the template id a preset is a build of"""
    root = next((it for it in preset['_items'] if not it.get('parentId')), None)
    return root['_tpl'] if root else None


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
