#!/usr/bin/env python3
# =========================================================
# ESCAPE 2D - the live game's side of the item database
#
# tarkov.dev's static dataset (json.tarkov.dev/regular/items) is what says an
# item exists today and what its numbers are today. The SPT template dumps
# know more about each item - the sound it makes, whether it is examined by
# default, heat, malfunctions, folding, what a med's effect costs - but they
# stop at the game version they were dumped from. This module puts the two
# together in the SPT dumps' own vocabulary, so everything downstream reads
# one kind of record:
#
#   live_props(item, base)   the template's _props with every number the live
#                            dataset carries laid over it
#   Donors                   for an item newer than the dumps: the most
#                            similar item of the same category, whose deep
#                            fields stand in for the ones nobody has
#   CAT_BY_CATEGORY          the game's gameplay category for every tarkov
#                            item category, most specific first
#   armor_of / grids_of      the plate-and-insert structure of a wearable and
#                            the flat summary the combat code reads; a
#                            container's grids with their real filters
#
# Categories are named, never typed as ids: the dataset's own category table
# resolves `assault-rifle` or `port-container` to the id, so a mistyped hex
# string cannot silently file a family of items under nothing.
# =========================================================

from __future__ import annotations

import re
from collections import Counter

# ---------------------------------------------------------
# categories
# ---------------------------------------------------------
# tarkov.dev item category (normalizedName) -> the game's `cat`. An item's
# chain is walked most specific first and the first name found here wins, so
# `handgun` is read before `weapon` and `magazine` before `weapon-mod`.
CAT_BY_CATEGORY = {
    'money': 'money',
    'meds': 'meds',
    'food': 'food',
    'drink': 'drink',
    # barter goods: the two families the game already told apart, then the rest
    'electronics': 'electronics',
    'battery': 'electronics',
    'jewelry': 'valuables',
    'barter-item': 'barter',
    # paper, tapes and maps
    'info': 'info',
    'map': 'info',
    'flyer': 'info',
    'completable': 'info',
    'battle-pass-document': 'info',
    'key': 'key',
    # things that hold things
    'common-container': 'container',
    'locking-container': 'container',
    'port-container': 'secure',
    'backpack': 'backpack',
    'chest-rig': 'rig',
    # sealed cases that open into random loot: no grid of their own
    'random-loot-container': 'lootbox',
    # worn
    'armor': 'armor',
    'headwear': 'helmet',
    'face-cover': 'facecover',
    'vis-observ-device': 'glasses',
    'headphones': 'headset',
    'arm-band': 'armband',
    # armour that is an item of its own: plates for vests, shields and
    # mandibles for helmets
    'armor-plate': 'plate',
    'armored-equipment': 'gearmod',
    # weapons; which of them is a holster gun is decided from the PMC
    # inventory template (see weapon_cat)
    'handgun': 'pistol',
    'weapon': 'weapon',
    # weapon parts
    'magazine': 'mag',
    'night-vision': 'nvg',
    'thermal-vision': 'nvg',
    'weapon-mod': 'mod',
    'ammo': 'ammo',
    'ammo-container': 'ammobox',
    'throwable-weapon': 'grenade',
    'knife': 'melee',
    # special equipment
    'repair-kits': 'repairkit',
    'special-item': 'special',
}

# part family, for the parts and magazines (the handbook's own families)
MOD_TYPE_BY_CATEGORY = {
    'barrel': 'barrel', 'handguard': 'handguard', 'gas-block': 'gasblock',
    'flashhider': 'muzzle', 'comb-muzzle-device': 'muzzle', 'silencer': 'suppressor',
    'pistol-grip': 'grip', 'foregrip': 'foregrip', 'stock': 'stock',
    'receiver': 'receiver', 'mount': 'mount', 'ironsight': 'ironsight',
    'reflex-sight': 'reflex', 'compact-reflex-sight': 'reflex',
    'assault-scope': 'scope', 'scope': 'scope', 'special-scope': 'scope',
    'comb-tact-device': 'tactical', 'flashlight': 'tactical',
    'charging-handle': 'charge', 'auxiliary-mod': 'aux', 'bipod': 'bipod',
    'ubgl': 'launcher',
    'magazine': 'magazine', 'cylinder-magazine': 'magazine', 'spring-driven-cylinder': 'magazine',
}

# the PMC inventory template's equipment slots -> the game's slot keys
EQUIP_SLOT = {
    'FirstPrimaryWeapon': 'primary', 'Holster': 'holster', 'Scabbard': 'scabbard',
    'Headwear': 'head', 'Earpiece': 'ears', 'FaceCover': 'face', 'Eyewear': 'eyes',
    'ArmorVest': 'armor', 'TacticalVest': 'rig', 'Backpack': 'backpack',
    'SecuredContainer': 'secure', 'ArmBand': 'armband', 'Dogtag': 'dogtag',
}
PMC_INVENTORY = '55d7217a4bdc2d86028b456d'

# what a zone protects, by the first words of the dataset's own name for it
# ("Thorax, Upper back", "Stomach, Groin", "Head, Ears", "Left arm, Shoulder")
_PART_BY_ZONE_WORD = {
    'head': 'head', 'thorax': 'thorax', 'stomach': 'stomach',
    'left arm': 'larm', 'right arm': 'rarm', 'left leg': 'lleg', 'right leg': 'rleg',
}


def _r(v, nd=4):
    """a number the way the database prints it: no float noise, ints as ints"""
    if v is None or isinstance(v, bool):
        return v
    r = round(float(v), nd)
    return int(r) if r == int(r) else r


class Live:
    """the tarkov.dev items payload, with names resolved and categories by name"""

    def __init__(self, doc, en_doc):
        data = doc['data']
        self.items = data['items']
        self.cats = data['itemCategories']
        self.en = en_doc['data'] if 'data' in en_doc else en_doc
        self.cat_id = {c['normalizedName']: cid for cid, c in self.cats.items()}
        missing = [n for n in list(CAT_BY_CATEGORY) + list(MOD_TYPE_BY_CATEGORY) if n not in self.cat_id]
        if missing:
            raise SystemExit('category names not in the dataset: ' + ', '.join(sorted(set(missing))))
        self.cat_by_id = {self.cat_id[n]: c for n, c in CAT_BY_CATEGORY.items()}
        self.mod_type_by_id = {self.cat_id[n]: t for n, t in MOD_TYPE_BY_CATEGORY.items()}
        self.root = self.cat_id['item']

    def T(self, key, default=None):
        """a translation key ("<id> Name") resolved to English"""
        v = self.en.get(key)
        if v is None:
            return key if default is None else default
        return v

    def is_preset(self, it):
        return 'preset' in (it.get('types') or [])

    def cat_of(self, chain):
        for c in chain:
            if c in self.cat_by_id:
                return self.cat_by_id[c]
        return None

    def mod_type_of(self, chain):
        for c in chain:
            if c in self.mod_type_by_id:
                return self.mod_type_by_id[c]
        return None

    def zone_part(self, zone):
        """the body part a zone protects, or None"""
        name = self.T(zone, '').lower()
        word = name.split(',')[0].strip()
        if word in _PART_BY_ZONE_WORD:
            return _PART_BY_ZONE_WORD[word]
        # plate zones are named after the plate: front and back cover the
        # chest; a side plate sits over the ribs (`_high`) or the flank (`_low`)
        if word in ('front plate', 'back plate'):
            return 'thorax'
        if word in ('left plate', 'right plate'):
            return 'stomach' if zone.endswith('_low') else 'thorax'
        return None


def zone_code(zone):
    """'Collider Type RibcageUp' / 'Armor Zone Plate_Korund_chest' -> the collider name"""
    return re.sub(r'^(Collider Type|Armor Zone)\s+', '', zone)


# ---------------------------------------------------------
# equipment slots, from the PMC inventory template
# ---------------------------------------------------------
def equip_filters(spt_items):
    """{slot key: set of ids (items and categories) the slot takes}"""
    out = {}
    inv = spt_items.get(PMC_INVENTORY)
    if not inv:
        return out
    for sl in inv['_props'].get('Slots') or []:
        key = EQUIP_SLOT.get(sl['_name'])
        if not key:
            continue
        ids = set()
        for f in sl['_props'].get('filters') or []:
            ids.update(f.get('Filter') or [])
        out[key] = ids
    return out


def weapon_cat(iid, chain, props, equip, donor_cat=None):
    """
    `pistol` is what goes in the holster and `weapon` what goes on the sling
    or the back; the PMC inventory template says which is which (a sawed-off
    and three revolvers ride in the holster, the revolver shotgun does not).
    A weapon no slot takes is the hand-fired signal cartridge. A weapon newer
    than the template is filed like the one it was modelled on.
    """
    ids = set(chain) | {iid}
    if ids & equip.get('holster', set()):
        return 'pistol'
    if ids & equip.get('primary', set()):
        return 'weapon'
    if props.get('weapUseType') == 'secondary' and props.get('weapClass') == 'specialWeapon' \
            and not props.get('Slots') and not donor_cat:
        return 'flare'
    return donor_cat or 'weapon'


# ---------------------------------------------------------
# live numbers over the template
# ---------------------------------------------------------
def _set(p, key, v, mul=None):
    if v is None:
        return
    p[key] = _r(v * mul) if mul else v


def spt_slots(td_slots, base_slots):
    """tarkov.dev slots in the template's shape; the merge flag is the template's"""
    merge = {s['_name']: bool(s.get('_mergeSlotWithChildren')) for s in (base_slots or [])}
    out = []
    for sl in td_slots:
        f = sl.get('filters') or {}
        out.append({
            '_name': sl['nameId'], '_required': bool(sl.get('required')),
            '_mergeSlotWithChildren': merge.get(sl['nameId'], False),
            '_props': {'filters': [{'Filter': list(f.get('allowedItems') or [])}]},
        })
    return out


def is_armor_slot(slot):
    """a template slot that holds a plate or a built-in insert, not a part"""
    f = (slot.get('_props', {}).get('filters') or [{}])[0]
    return 'Plate' in f or 'locked' in f or 'armorColliders' in f or 'armorPlateColliders' in f


def _effects(p, key):
    """a writable copy of effects_damage / effects_health (the dumps use [] for none)"""
    cur = p.get(key)
    cur = {k: dict(v or {}) for k, v in cur.items()} if isinstance(cur, dict) else {}
    p[key] = cur
    return cur


_CURE = {'LightBleeding': 'LightBleeding', 'HeavyBleeding': 'HeavyBleeding', 'Fracture': 'Fracture',
         'Pain': 'Pain', 'Contusion': 'Contusion', 'LostLimb': 'DestroyedPart',
         'Intoxication': 'Intoxication', 'RadExposure': 'RadExposure'}
_THROW_TYPE = {'Grenade': 'frag_grenade', 'Flashbang': 'flash_grenade', 'Smoke': 'smoke_grenade'}


def live_props(it, base, fresh=False):
    """
    The template's _props with the live dataset's numbers laid over them.
    `base` is the SPT template's own _props, or a donor's when the item is
    newer than the dumps (`fresh`): then the structures that belong to the
    donor alone - its slots, grids, cartridges - are dropped first and only
    what the dataset says about this item goes in their place.
    """
    p = dict(base)
    pr = it.get('properties') or {}
    pt = pr.get('propertiesType')
    if fresh:
        for k in ('Slots', 'Grids', 'StackSlots', 'ConflictingItems', 'Prefab', 'UsePrefab',
                  'defAmmo', 'defMagType', 'TargetItemFilter', 'Name', 'ShortName', 'Description'):
            p.pop(k, None)

    # --- what every item has ---
    p['Width'] = it['width']
    p['Height'] = it['height']
    p['Weight'] = it['weight']
    _set(p, 'StackMaxSize', it.get('stackMaxSize'))
    _set(p, 'BackgroundColor', it.get('backgroundColor'))
    p['ConflictingItems'] = list(it.get('conflictingItems') or [])
    _set(p, 'DiscardLimit', it.get('discardLimit'))

    # --- part slots: the live filters name the parts added since the dump ---
    if 'slots' in pr:
        p['Slots'] = spt_slots(pr['slots'] or [], base.get('Slots'))
    else:
        p['Slots'] = [] if fresh else [s for s in (base.get('Slots') or []) if not is_armor_slot(s)]

    if pt == 'ItemPropertiesWeapon':
        _set(p, 'ammoCaliber', pr.get('caliber'))
        _set(p, 'Ergonomics', pr.get('ergonomics'))
        _set(p, 'RecoilForceUp', pr.get('recoilVertical'))
        _set(p, 'RecoilForceBack', pr.get('recoilHorizontal'))
        _set(p, 'RepairCost', pr.get('repairCost'))
        _set(p, 'bFirerate', pr.get('fireRate'))
        _set(p, 'bEffDist', pr.get('effectiveDistance'))
        _set(p, 'SightingRange', pr.get('sightingRange'))
        if pr.get('maxDurability') is not None:
            p['MaxDurability'] = pr['maxDurability']
            if fresh:
                p['Durability'] = pr['maxDurability']
        _set(p, 'CenterOfImpact', pr.get('centerOfImpact'))
        _set(p, 'DeviationCurve', pr.get('deviationCurve'))
        _set(p, 'DeviationMax', pr.get('deviationMax'))
        _set(p, 'RecolDispersion', pr.get('recoilDispersion'))
        _set(p, 'RecoilAngle', pr.get('recoilAngle'))
        _set(p, 'CameraSnap', pr.get('cameraSnap'))
        if pr.get('fireModes'):
            p['weapFireType'] = list(pr['fireModes'])
        _set(p, 'defAmmo', pr.get('defaultAmmo'))
        _set(p, 'Velocity', it.get('velocity'))
        # the chamber takes what the dataset says the gun fires; how many
        # chambers there are is the template's (or the donor's) to say
        ammo = list(pr.get('allowedAmmo') or [])
        chambers = base.get('Chambers') or []
        if chambers and (ammo or fresh):
            p['Chambers'] = [dict(c, _props={'filters': [{'Filter': ammo}]}) for c in chambers]

    elif pt in ('ItemPropertiesWeaponMod', 'ItemPropertiesBarrel', 'ItemPropertiesScope', 'ItemPropertiesMagazine'):
        _set(p, 'Ergonomics', pr.get('ergonomics'))
        _set(p, 'Recoil', pr.get('recoilModifier'), 100)
        _set(p, 'Accuracy', pr.get('accuracyModifier'), 100)
        _set(p, 'Velocity', it.get('velocity'))
        _set(p, 'Loudness', it.get('loudness'))
        # the dataset leaves a factor of 1 out; the template's 1 stands
        _set(p, 'HeatFactor', pr.get('heatFactor'))
        _set(p, 'CoolFactor', pr.get('coolingFactor'))
        _set(p, 'DurabilityBurnModificator', pr.get('durabilityBurnFactor'))
        if fresh:
            p.setdefault('HeatFactor', 1)
            p.setdefault('CoolFactor', 1)
        # how far the part sticks out of the gun: absent means it does not
        inc = pr.get('increaseSize') or {}
        p['ExtraSizeLeft'] = int(inc.get('left') or 0)
        p['ExtraSizeRight'] = int(inc.get('right') or 0)
        p['ExtraSizeUp'] = int(inc.get('up') or 0)
        p['ExtraSizeDown'] = int(inc.get('down') or 0)
        p['ExtraSizeForceAdd'] = bool(pr.get('increaseSizeForced'))
        if pt == 'ItemPropertiesBarrel':
            _set(p, 'CenterOfImpact', pr.get('centerOfImpact'))
            _set(p, 'DeviationCurve', pr.get('deviationCurve'))
            _set(p, 'DeviationMax', pr.get('deviationMax'))
        elif pt == 'ItemPropertiesScope':
            # The template keeps a sight's steps per mode ([[3, 3, 10, 10]], two
            # modes); the dataset flattens them ([[3, 10]], one). The template's
            # shape stands unless the magnifications themselves have changed.
            def values(zz):
                return sorted({z for row in (zz or []) for z in (row if isinstance(row, list) else [row])})
            if pr.get('zoomLevels') and (fresh or values(pr['zoomLevels']) != values(base.get('Zooms'))):
                p['Zooms'] = pr['zoomLevels']
                if pr.get('sightModes'):
                    p['ModesCount'] = pr['sightModes']
            _set(p, 'SightingRange', pr.get('sightingRange'))
            if pr.get('zeroingDistances') and (fresh or values(pr['zeroingDistances']) != values(base.get('CalibrationDistances'))):
                p['CalibrationDistances'] = pr['zeroingDistances']
        elif pt == 'ItemPropertiesMagazine':
            cart = dict((base.get('Cartridges') or [{}])[0]) if not fresh else {}
            cart['_name'] = cart.get('_name') or 'cartridges'
            cart['_max_count'] = int(pr.get('capacity') or 0)
            cart['_props'] = {'filters': [{'Filter': list(pr.get('allowedAmmo') or [])}]}
            p['Cartridges'] = [cart]
            _set(p, 'LoadUnloadModifier', pr.get('loadModifier'), 100)
            _set(p, 'CheckTimeModifier', pr.get('ammoCheckModifier'), 100)
            _set(p, 'MalfunctionChance', pr.get('malfunctionChance'))

    elif pt == 'ItemPropertiesAmmo':
        _set(p, 'Caliber', pr.get('caliber'))
        _set(p, 'Damage', pr.get('damage'))
        _set(p, 'ArmorDamage', pr.get('armorDamage'))
        _set(p, 'FragmentationChance', pr.get('fragmentationChance'))
        _set(p, 'RicochetChance', pr.get('ricochetChance'))
        _set(p, 'PenetrationChanceObstacle', pr.get('penetrationChance'))
        _set(p, 'PenetrationPower', pr.get('penetrationPower'))
        _set(p, 'PenetrationPowerDiviation', pr.get('penetrationPowerDeviation'))
        _set(p, 'ammoAccr', pr.get('accuracyModifier'), 100)
        _set(p, 'ammoRec', pr.get('recoilModifier'), 100)
        _set(p, 'InitialSpeed', pr.get('initialSpeed'))
        _set(p, 'HeavyBleedingDelta', pr.get('heavyBleedModifier'))
        _set(p, 'LightBleedingDelta', pr.get('lightBleedModifier'))
        _set(p, 'DurabilityBurnModificator', pr.get('durabilityBurnFactor'))
        _set(p, 'HeatFactor', pr.get('heatFactor'))
        _set(p, 'StaminaBurnPerDamage', pr.get('staminaBurnPerDamage'))
        _set(p, 'MalfMisfireChance', pr.get('misfireChance'))
        _set(p, 'MalfFeedChance', pr.get('failureToFeedChance'))
        if pr.get('tracer') is not None:
            p['Tracer'] = bool(pr['tracer'])
        _set(p, 'TracerColor', pr.get('tracerColor'))
        _set(p, 'ammoType', pr.get('ammoType'))
        _set(p, 'ProjectileCount', pr.get('projectileCount'))
        _set(p, 'BallisticCoeficient', pr.get('ballisticCoeficient'))
        _set(p, 'BulletDiameterMilimeters', pr.get('bulletDiameterMilimeters'))
        _set(p, 'BulletMassGram', pr.get('bulletMassGrams'))
        _set(p, 'StackMaxSize', pr.get('stackMaxSize'))
        if fresh:
            n = int(pr.get('projectileCount') or 1)
            p['buckshotBullets'] = n if n > 1 else 0

    elif pt == 'ItemPropertiesKey':
        _set(p, 'MaximumNumberOfUsage', pr.get('uses'))

    elif pt == 'ItemPropertiesGrenade':
        _set(p, 'explDelay', pr.get('fuse'))
        _set(p, 'MinExplosionDistance', pr.get('minExplosionDistance'))
        _set(p, 'MaxExplosionDistance', pr.get('maxExplosionDistance'))
        _set(p, 'FragmentsCount', pr.get('fragments'))
        _set(p, 'ContusionDistance', pr.get('contusionRadius'))
        if pr.get('type') in _THROW_TYPE:
            p['ThrowType'] = _THROW_TYPE[pr['type']]

    elif pt == 'ItemPropertiesMelee':
        _set(p, 'knifeHitSlashDam', pr.get('slashDamage'))
        _set(p, 'knifeHitStabDam', pr.get('stabDamage'))
        _set(p, 'knifeHitRadius', pr.get('hitRadius'))
        _set(p, 'MaxDurability', it.get('maxDurability'))

    elif pt == 'ItemPropertiesFoodDrink':
        _set(p, 'MaxResource', pr.get('units'))
        eh = _effects(p, 'effects_health')
        for key, name in (('energy', 'Energy'), ('hydration', 'Hydration')):
            v = pr.get(key)
            if v:
                eh.setdefault(name, {})['value'] = v
            elif name in eh:
                eh[name]['value'] = 0
        if fresh:
            p['StimulatorBuffs'] = ''

    elif pt in ('ItemPropertiesMedKit', 'ItemPropertiesMedicalItem', 'ItemPropertiesPainkiller',
                'ItemPropertiesSurgicalKit', 'ItemPropertiesStim'):
        _set(p, 'medUseTime', pr.get('useTime'))
        ed = _effects(p, 'effects_damage')
        if fresh:
            # the donor's cures are not this item's
            for k in list(ed):
                if k in _CURE.values() and k not in [_CURE.get(c) for c in (pr.get('cures') or [])]:
                    del ed[k]
            p['StimulatorBuffs'] = '' if pt != 'ItemPropertiesStim' else p.get('StimulatorBuffs', '')
        for c in pr.get('cures') or []:
            if c in _CURE:
                ed.setdefault(_CURE[c], {})
        if pt == 'ItemPropertiesMedKit':
            _set(p, 'MaxHpResource', pr.get('hitpoints'))
            _set(p, 'hpResourceRate', pr.get('maxHealPerUse'))
            if pr.get('hpCostLightBleeding') and 'LightBleeding' in ed:
                ed['LightBleeding']['cost'] = pr['hpCostLightBleeding']
            if pr.get('hpCostHeavyBleeding') and 'HeavyBleeding' in ed:
                ed['HeavyBleeding']['cost'] = pr['hpCostHeavyBleeding']
        elif pt != 'ItemPropertiesStim':
            _set(p, 'MaxHpResource', pr.get('uses'))
            if pt == 'ItemPropertiesPainkiller' and pr.get('painkillerDuration') and 'Pain' in ed:
                ed['Pain']['duration'] = pr['painkillerDuration']
            if pt == 'ItemPropertiesSurgicalKit' and 'DestroyedPart' in ed:
                if pr.get('minLimbHealth') is not None:
                    ed['DestroyedPart']['healthPenaltyMin'] = _r(pr['minLimbHealth'] * 100)
                if pr.get('maxLimbHealth') is not None:
                    ed['DestroyedPart']['healthPenaltyMax'] = _r(pr['maxLimbHealth'] * 100)

    elif pt == 'ItemPropertiesResource':
        _set(p, 'MaxResource', pr.get('units'))

    # --- worn gear: what it costs to wear, in the template's percent ---
    if pt in ('ItemPropertiesArmor', 'ItemPropertiesChestRig', 'ItemPropertiesHelmet', 'ItemPropertiesBackpack',
              'ItemPropertiesArmorAttachment', 'ItemPropertiesGlasses'):
        _set(p, 'speedPenaltyPercent', pr.get('speedPenalty'), 100)
        _set(p, 'mousePenalty', pr.get('turnPenalty'), 100)
        _set(p, 'weaponErgonomicPenalty', pr.get('ergoPenalty'), 100)
        _set(p, 'BluntThroughput', pr.get('bluntThroughput'))
        _set(p, 'ArmorMaterial', pr.get('material'))
        _set(p, 'ArmorType', pr.get('armorType'))
        _set(p, 'RepairCost', pr.get('repairCost'))
        _set(p, 'BlindnessProtection', pr.get('blindnessProtection'))
        _set(p, 'DeafStrength', pr.get('deafening'))
        if fresh:
            # the template's own flags are finer (earpiece / eyewear / face
            # cover / headwear); for a new item the dataset's three stand
            p['BlocksEarpiece'] = bool(pr.get('blocksHeadset') or it.get('blocksHeadphones'))
            p['BlocksEyewear'] = bool(pr.get('blocksEyewear'))
            p['BlocksHeadwear'] = bool(pr.get('blocksHeadwear'))
            p['BlocksFaceCover'] = False

    # --- containers: live grids, each with its own filter ---
    if 'grids' in pr:
        p['Grids'] = [{
            '_props': {
                'cellsH': g['width'], 'cellsV': g['height'],
                'filters': [{
                    'Filter': list(g['filters'].get('allowedCategories') or []) + list(g['filters'].get('allowedItems') or []),
                    'ExcludedFilter': list(g['filters'].get('excludedCategories') or []) + list(g['filters'].get('excludedItems') or []),
                }],
            },
        } for g in (pr.get('grids') or [])]
    return p


# ---------------------------------------------------------
# donors: the most similar item of the same category
# ---------------------------------------------------------
_TOKEN = re.compile(r'[a-z0-9]+')


def _tokens(name):
    return set(_TOKEN.findall((name or '').lower()))


class Donors:
    """
    An item added after the newest dump has no template: no ItemSound, no
    ExaminedByDefault, no heat or malfunction numbers. It borrows them from
    the item of its own category that it most resembles - the same name
    without the colour, the same calibre, the same footprint - which for a
    reskin is simply the original.
    """

    def __init__(self, live, spt_items):
        self.live = live
        self.spt = spt_items
        self.by_cat = {}
        self.by_game_cat = {}
        for iid, it in live.items.items():
            if live.is_preset(it) or iid not in spt_items or not it.get('categories'):
                continue
            self.by_cat.setdefault(it['categories'][0], []).append(iid)
            self.by_game_cat.setdefault(live.cat_of(it['categories']), []).append(iid)
        self._names = {}

    def _name(self, iid):
        if iid not in self._names:
            it = self.live.items[iid]
            self._names[iid] = _tokens(self.live.T(it['name'], ''))
        return self._names[iid]

    def pick(self, it):
        """(donor id, score) or (None, 0)"""
        chain = it.get('categories') or []
        cands = []
        for c in chain:
            cands = self.by_cat.get(c) or []
            if cands:
                break
        if not cands:
            # a whole category newer than the dumps (the notes, the tapes):
            # anything the game files the same way will do
            cands = self.by_game_cat.get(self.live.cat_of(chain)) or []
        if not cands:
            return None, 0
        pr = it.get('properties') or {}
        want = _tokens(self.live.T(it['name'], ''))
        cal = pr.get('caliber')
        best, best_score = None, -1
        for cid in sorted(cands):
            c = self.live.items[cid]
            cp = c.get('properties') or {}
            have = self._name(cid)
            union = len(want | have) or 1
            score = 3.0 * len(want & have) / union
            if cal and cp.get('caliber') == cal:
                score += 1.5
            if (c['width'], c['height']) == (it['width'], it['height']):
                score += 0.5
            if cp.get('propertiesType') == pr.get('propertiesType'):
                score += 0.5
            w0, w1 = float(c.get('weight') or 0), float(it.get('weight') or 0)
            if max(w0, w1) > 0:
                score += 0.3 * (1 - abs(w0 - w1) / max(w0, w1))
            if score > best_score:
                best, best_score = cid, score
        return best, round(best_score, 3)


# ---------------------------------------------------------
# armour: plates, inserts, and the flat summary
# ---------------------------------------------------------
def armor_of(live, it, key_of, default_plates, colliders=()):
    """
    (structure, summary) for a wearable, from the dataset's armorSlots.

    Since 0.14 a vest or a helmet is not one block of armour: it has built-in
    soft inserts, each with its own class, durability, material and zones, and
    slots that take a plate. `structure` is that, as the template carries it:
      {type, blunt, rep, ins: [{n, c, d, m, z, b}], slots: [{n, z, f, def}]}
    `summary` is what the combat code reads today - one class, one durability,
    one material, and the body parts covered - taken from the default
    configuration: the plate that ships in the front plate slot where there is
    one, else the built-in soft armour (whose inserts are one layer in a
    model that keeps a single pool for a vest, so their durability adds up).

    default_plates: {slot name (lower case): plate id} for what ships installed.
    colliders: the template's own armorColliders, for the one-piece armour the
    dataset lists no zones for (ballistic glasses).
    """
    pr = it.get('properties') or {}
    slots = pr.get('armorSlots') or []
    st = {}
    if pr.get('armorType') and pr['armorType'] != 'None':
        st['type'] = pr['armorType']
    if pr.get('bluntThroughput'):
        st['blunt'] = _r(pr['bluntThroughput'])
    if pr.get('repairCost'):
        st['rep'] = int(pr['repairCost'])
    ric = [_r(pr.get('ricochetX') or 0), _r(pr.get('ricochetY') or 0), _r(pr.get('ricochetZ') or 0)]
    if any(ric):
        st['ric'] = ric
    ins, plate_slots = [], []
    zones = []
    for a in slots:
        z = [zone_code(x) for x in (a.get('zones') or [])]
        if 'allowedPlates' in a:
            rec = {'n': a['nameId'], 'z': z, 'f': [k for k in (key_of(x) for x in a['allowedPlates']) if k]}
            dp = default_plates.get(a['nameId'].lower())
            if dp and key_of(dp):
                rec['def'] = key_of(dp)
                zones.extend(a.get('zones') or [])
            plate_slots.append(rec)
        else:
            rec = {'n': a['nameId'], 'c': int(a.get('class') or 0), 'd': _r(a.get('durability') or 0),
                   'm': a.get('armorMaterial') or pr.get('material'), 'z': z}
            if a.get('bluntThroughput') and _r(a['bluntThroughput']) != st.get('blunt'):
                rec['b'] = _r(a['bluntThroughput'])
            ins.append(rec)
            zones.extend(a.get('zones') or [])
    if ins:
        st['ins'] = ins
    if plate_slots:
        st['slots'] = plate_slots

    summary = {}
    front = next((s for s in plate_slots if s['n'].lower() == 'front_plate' and s.get('def')), None)
    front_id = default_plates.get('front_plate') if front else None
    fp = (live.items.get(front_id) or {}).get('properties') if front_id else None
    if fp and fp.get('class'):
        summary = {'armorClass': int(fp['class']), 'dura': _r(fp.get('durability') or 0),
                   'armorMat': fp.get('material')}
    elif ins and max(i['c'] for i in ins) > 0:
        top = max(i['c'] for i in ins)
        mats = Counter(i['m'] for i in ins if i['c'] == top)
        summary = {'armorClass': top, 'dura': _r(sum(i['d'] for i in ins)),
                   'armorMat': mats.most_common(1)[0][0]}
    elif not slots and pr.get('class'):
        # armour that is one piece: a plate, a face shield, ballistic glasses
        summary = {'armorClass': int(pr['class']), 'dura': _r(pr.get('durability') or 0),
                   'armorMat': pr.get('material')}
        zones = list(pr.get('zones') or []) or ['Collider Type ' + c for c in colliders]
        if zones:
            st['z'] = [zone_code(x) for x in zones]
    if summary:
        parts = []
        for z in zones:
            part = live.zone_part(z)
            if part and part not in parts:
                parts.append(part)
        order = ['head', 'thorax', 'stomach', 'larm', 'rarm', 'lleg', 'rleg']
        summary['covers'] = [x for x in order if x in parts]
    return st, summary


# ---------------------------------------------------------
# containers
# ---------------------------------------------------------
def grids_of(props, key_of, cat_ids, root):
    """
    (grids, filters) for a container's template grids. A filter is
      {c: [category ids], i: [item keys], xc: [category ids], xi: [item keys]}
    with the empty lists left out; a grid that takes anything is None. An id
    in a template filter is a category or an item - the category table tells
    them apart.
    """
    grids, filters = [], []
    for g in props.get('Grids') or []:
        gp = g.get('_props') or {}
        w, h = gp.get('cellsH'), gp.get('cellsV')
        if not w or not h:
            continue
        grids.append([int(w), int(h)])
        f = (gp.get('filters') or [{}])[0] if gp.get('filters') else {}
        allow, deny = f.get('Filter') or [], f.get('ExcludedFilter') or []
        rec = {}
        c = [x for x in allow if x in cat_ids]
        i = [k for k in (key_of(x) for x in allow if x not in cat_ids) if k]
        xc = [x for x in deny if x in cat_ids]
        xi = [k for k in (key_of(x) for x in deny if x not in cat_ids) if k]
        if root in c:
            c, i = [], []       # the root category is everything
        if c or i:
            rec['c'] = c
            if i:
                rec['i'] = i
        if xc:
            rec['xc'] = xc
        if xi:
            rec['xi'] = xi
        filters.append(rec or None)
    return grids, filters


# ---------------------------------------------------------
# presets from a flat list of parts
# ---------------------------------------------------------
def rebuild_tree(root_slots, slots_of, parts, limit=200000):
    """
    The dataset lists a preset as the gun and a bag of parts; the game needs
    the tree. Every part has to end up in a slot whose filter names it, on
    the gun or on a part already placed - a search that fills slots in the
    template's order, sub-assemblies first, and backs out of a dead end. The
    first complete placement wins (where two rails are interchangeable either
    is right).

    root_slots / slots_of(id): [(slot name, set of allowed ids)]
    parts: [id, ...]. Returns {slot: {t: id, s: {...}}} or None.
    """
    steps = [0]

    def place(open_slots, remaining):
        steps[0] += 1
        if steps[0] > limit:
            return None
        if not remaining:
            return {}
        if not open_slots:
            return None
        (path, name, allowed), rest = open_slots[0], open_slots[1:]
        tried = set()
        for i, pid in enumerate(remaining):
            if pid in tried or pid not in allowed:
                continue
            tried.add(pid)
            child = [(path + (name,), n, a) for n, a in slots_of(pid)]
            res = place(child + rest, remaining[:i] + remaining[i + 1:])
            if res is not None:
                res = dict(res)
                res[path + (name,)] = pid
                return res
        return place(rest, remaining)

    flat = place([((), n, a) for n, a in root_slots], list(parts))
    if flat is None:
        return None
    tree = {}
    for path in sorted(flat, key=len):
        node = tree
        for k in path[:-1]:
            node = node[k].setdefault('s', {})
        node[path[-1]] = {'t': flat[path]}
    return tree
