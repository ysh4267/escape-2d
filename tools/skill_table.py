"""
The skills the game shows on its SKILLS tab, and what each one does.

A skill's class, the order of its effects and how much each is worth a level
are in the client's code, not in any file it ships or any dump of its
database, so they are written out here: read off the game's own wiki
(the Effects list of each skill's page, late 2026) and checked against 1080p
captures of the tab where a capture shows them - the icon strips of twelve
skills and the tooltips of Strength and Metabolism.

Each effect is named by the client's own id for it, which is also the key of
its sentence in the locale ("Increases jump height by [{0:0.#%}]") and of its
icon (tools/cache/client/icon_tables.json, table skill_buff).

    (id, per level)             a share that grows with the level: 0.004 a
                                level is 0.4 % at level 1 and 20 % at 50
    (id, per level, 'pct')      the same where the sentence wants the number
                                already in per cent ("[{0:0.#}%]")
    (id, None)                  an effect with no number in its sentence
    ELITE entries               only there once the skill is elite; a number
                                is the fixed value the sentence takes
    elite_add                   what the elite level puts on top of an effect
                                that is already there (Endurance's stamina)
"""

PHYSICAL, MENTAL, COMBAT, PRACTICAL = "Physical", "Mental", "Combat", "Practical"

# every firearm skill does the same four things, and the same two at elite
WEAPON = dict(
    buffs=[("WeaponReloadBuff", 0.004), ("WeaponSwapBuff", 0.008), ("WeaponRecoilBuff", 0.003), ("WeaponErgonomicsBuff", 0.002)],
    elite=[("DrawElite", None), ("WeaponDoubleMastering", None)],
)

# in the order the tab lists them with nothing sorted or filtered
SKILLS = [
    ("Endurance", PHYSICAL, dict(
        # the capture's strip runs jump, breath, then the two that share a picture
        buffs=[("EnduranceBuffJumpCostRed", 0.006), ("EnduranceBuffBreathTimeInc", 0.02),
               ("EnduranceBuffEnduranceInc", 0.01), ("EnduranceBuffRestorationTimeRed", 0.01)],
        elite=[("EnduranceHands", None), ("EnduranceBreathElite", None)],
        elite_add={"EnduranceBuffEnduranceInc": 0.2})),
    ("Strength", PHYSICAL, dict(
        buffs=[("StrengthBuffJumpHeightInc", 0.004), ("StrengthBuffLiftWeightInc", 0.006), ("StrengthBuffMeleePowerInc", 0.006),
               ("StrengthBuffSprintSpeedInc", 0.004), ("StrengthBuffThrowDistanceInc", 0.004), ("StrengthBuffAim", 0.004)],
        elite=[("StrengthBuffElite", None), ("StrengthBuffMeleeCrits", 0.5)])),
    ("Vitality", PHYSICAL, dict(
        buffs=[("VitalityBuffBleedChanceRed", 0.012), ("VitalityBuffSurviobilityInc", 0.004)],
        elite=[("VitalityBuffRegeneration", None), ("VitalityBuffBleedStop", None)])),
    ("Health", PHYSICAL, dict(
        buffs=[("HealthBreakChanceRed", 0.012), ("HealthEnergy", 0.006), ("HealthHydration", 0.006)],
        elite=[("HealthEliteAbsorbDamage", None)])),
    ("StressResistance", PHYSICAL, dict(
        buffs=[("StressPainChance", 0.01), ("StressTremor", 0.012)],
        elite=[("StressBerserk", None)])),
    ("Metabolism", PHYSICAL, dict(
        buffs=[("MetabolismRatioPlus", 0.01), ("MetabolismMiscDebuffTime", 0.01)],
        elite=[("MetabolismEliteBuffNoDyhydration", None)])),
    ("Immunity", PHYSICAL, dict(
        buffs=[("ImmunityMiscEffects", 0.01), ("ImmunityPoisonBuff", 0.01), ("ImmunityPainKiller", 0.006)],
        elite=[("ImmunityMiscEffectsChance", 0.9), ("ImmunityPoisonChance", 0.9)])),

    ("Perception", MENTAL, dict(
        buffs=[("PerceptionLootDot", 0.02)],
        elite=[("PerceptionmEliteNoIdea", None)])),
    ("Intellect", MENTAL, dict(
        buffs=[("IntellectLearningSpeed", 0.02), ("IntellectWeaponMaintance", 0.02), ("IntellectRepairPointsCostReduction", 0.005)],
        elite=[("IntellectEliteAmmoCounter", None), ("IntellectEliteContainerScope", None), ("IntellectEliteNaturalLearner", None)])),
    ("Attention", MENTAL, dict(
        buffs=[("AttentionLootSpeed", 0.02), ("AttentionRareLoot", 0.02)],
        elite=[("AttentionEliteExtraLootExp", None), ("AttentionEliteLuckySearch", 0.5)])),
    ("Charisma", MENTAL, dict(
        buffs=[("CharismaDailyQuestsRerollDiscount", 0.001), ("CharismaHealingDiscount", 0.001),
               ("CharismaInsuranceDiscount", 0.001), ("CharismaExfiltrationDiscount", 0.001)],
        elite=[("CharismaScavCaseDiscount", None), ("CharismaAdditionalDailyQuests", None)])),

    ("Pistol", COMBAT, WEAPON),
    ("Revolver", COMBAT, WEAPON),
    ("SMG", COMBAT, WEAPON),
    ("Assault", COMBAT, WEAPON),
    ("Shotgun", COMBAT, WEAPON),
    ("Sniper", COMBAT, WEAPON),
    ("LMG", COMBAT, WEAPON),
    ("HMG", COMBAT, WEAPON),
    ("Launcher", COMBAT, WEAPON),
    ("AttachedLauncher", COMBAT, WEAPON),
    ("Throwing", COMBAT, dict(
        buffs=[("ThrowingStrengthBuff", 0.005), ("ThrowingEnergyExpenses", 0.01)],
        elite=[("ThrowingWeaponsBuffElite", None)])),
    ("Melee", COMBAT, WEAPON),
    ("DMR", COMBAT, WEAPON),
    ("AimDrills", COMBAT, dict(
        buffs=[("DrawSpeed", 0.01), ("DrawSound", 0.01)],
        elite=[("DrawElite", None), ("DrawTremor", None)])),
    ("TroubleShooting", COMBAT, dict(
        buffs=[("TroubleFixing", 0.005)],
        elite=[("TroubleFixingExamineMalfElite", None), ("TroubleFixingMagElite", None),
               ("TroubleFixingDurElite", None), ("TroubleFixingAmmoElite", None)])),

    ("Surgery", PRACTICAL, dict(
        buffs=[("SurgerySpeed", 0.004), ("SurgeryReducePenalty", 0.01)],
        elite=[],
        elite_add={"SurgerySpeed": 0.2, "SurgeryReducePenalty": 0.5})),
    ("CovertMovement", PRACTICAL, dict(
        buffs=[("CovertMovementSoundVolume", 0.012), ("CovertMovementLoud", 0.006),
               ("CovertMovementSpeed", 0.01), ("CovertMovementEquipment", 0.012)],
        elite=[("CovertMovementElite", None)])),
    ("Search", PRACTICAL, dict(
        buffs=[("SearchSpeed", 0.01)],
        elite=[("SearchDouble", None)])),
    ("MagDrills", PRACTICAL, dict(
        # the fourth, magazine check accuracy, steps up at levels 10 and 20 and
        # the page gives no figure for its sentence: left out rather than guessed
        buffs=[("MagDrillsLoadSpeed", 0.6, "pct"), ("MagDrillsUnloadSpeed", 0.6, "pct"), ("MagDrillsInventoryCheckSpeed", 0.8, "pct")],
        elite=[("MagDrillsInstantCheck", None), ("MagDrillsLoadProgression", None)])),
    ("LightVests", PRACTICAL, dict(
        buffs=[("LightVestMoveSpeedPenaltyReduction", 0.006), ("LightVestMeleeWeaponDamageReduction", 0.006),
               ("LightVestRepairDegradationReduction", 0.008)],
        elite=[("LightVestBleedingProtection", None), ("LightVestDeteriorationChanceOnRepairReduce", None)])),
    ("HeavyVests", PRACTICAL, dict(
        buffs=[("HeavyVestMoveSpeedPenaltyReduction", 0.005), ("HeavyVestBluntThroughputDamageReduction", 0.004),
               ("HeavyVestRepairDegradationReduction", 0.01)],
        elite=[("HeavyVestNoBodyDamageDeflectChance", None), ("HeavyVestDeteriorationChanceOnRepairReduce", None)])),
    ("WeaponTreatment", PRACTICAL, dict(
        buffs=[("WeaponDurabilityLossOnShotReduce", 0.005), ("WearAmountRepairGunsReducePerLevel", None)],
        elite=[("WearChanceRepairGunsReduceEliteLevel", None)])),
    ("HideoutManagement", PRACTICAL, dict(
        buffs=[("HideoutZoneBonusBoost", 1.0, "pct"), ("HideoutResourceConsumption", 0.005)],
        elite=[("HideoutExtraSlots", None)])),
    ("Crafting", PRACTICAL, dict(
        buffs=[("CraftingSingleTimeReduce", 0.0075), ("CraftingContinueTimeReduce", 0.0075)],
        elite=[("CraftingElite", None)])),
]


def rows(sprite_of):
    """
    The table as the page reads it: {skill id: {cls, buffs}}, a buff being
    {id, ico, v?, pct?, e?, ea?} - `sprite_of(buff id)` gives the icon's name.
    """
    out = {}
    for sid, cls, spec in SKILLS:
        buffs = []
        add = spec.get("elite_add") or {}
        for entry in spec["buffs"]:
            bid, per = entry[0], entry[1]
            b = {"id": bid, "ico": sprite_of(bid)}
            if per is not None:
                b["v"] = per
            if len(entry) > 2 and entry[2] == "pct":
                b["pct"] = 1
            if bid in add:
                b["ea"] = add[bid]
            buffs.append(b)
        for bid, val in spec["elite"]:
            b = {"id": bid, "ico": sprite_of(bid), "e": 1}
            if val is not None:
                b["v"] = val
            buffs.append(b)
        out[sid] = {"cls": cls, "buffs": buffs}
    return out
