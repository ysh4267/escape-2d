"""
Which AudioClips out of the EFT install back which cue in this game.

Every name here was read out of the install's own bundles (see
`extract_tarkov_sfx.py --index` / `--search`), so the taxonomy is the game's,
not one I invented. The install uses three different naming conventions for
shots depending on when the weapon was recorded, and none of them are
guessable from the weapon name alone:

  movement   sounds.bundle          <gait>_<surface><n>      walk|run|sprint|stop
  gear       sounds.bundle          gear_stereo<n>           webbing under every step
  items      itemsounds.bundle      <ItemSound>_<action>     pickup|drop|use
  looting    itemsounds.bundle      <furniture>_looting      the per-container rummage
  furniture  sharedassets8          <furniture>_open         the actual lids
  impacts    sharedassets397        body|bodyarmor|metal|wood|ricochet
  interface  resources.assets       button_*, menu_*, trade_*
  ambience   sharedassets537        amb_factory_rework_*     the real Factory bed
  weapons    <bank>.bundle          three schemes, see WEAPON_FIRE below

Cue name -> {clips: [...], plus ffmpeg knobs}. A list entry that is itself a
list gets mixed down into one file (used to bake the gear rustle into the
footsteps, which is how the game layers them).

`trim` is [start, duration] on the source; several of these clips are long
tails of room reflection that would smear if left whole.

The item cues at the bottom are DERIVED FROM src/data/items-db.json rather
than hardcoded, so the pack carries exactly the foley the current item set can
ask for and nothing else. Add an item, re-run --extract, and its sound is
there; the pack never drifts from the database.
"""

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

_GEAR = [f"gear_stereo{i}" for i in range(1, 7)]


def _seq(stem: str, n: int = 8, width: int = 2) -> list[str]:
    """`ak74_indoor_close_01` .. `_08` — the numbered variant banks."""
    return [f"{stem}{i:0{width}d}" for i in range(1, n + 1)]


# ---------------- footsteps ----------------
# Surface and gait are independent axes. They were not: sprinting used to pull
# from `sprint_metal` whatever you were standing on, so breaking into a run on
# a concrete floor swapped the material to steel grating mid-stride.
#
# Two naming conventions live side by side here and neither is guessable:
#
#   walk_concrete1      concrete and thick metal use a bare single digit
#   walk_asphalt_01     everything else is zero-padded behind an underscore
#
# `SURFACES` maps our surface name -> (clip stem, how it numbers, how many).
# Factory only needs four: the plant floor, the gratings, the office lino and
# the yards outside.
_BARE, _PAD = 'bare', 'pad'

_SURFACE_CLIPS = {
    #                walk                run                 sprint              stop
    'concrete': (('concrete', _BARE), ('concrete', _BARE), ('asphalt', _PAD), ('asphalt', _PAD)),
    'metal':    (('metal', _BARE),    ('metal', _BARE),    ('metal', _BARE),  ('metal', _BARE)),
    'tile':     (('tile', _PAD),      ('tile', _PAD),      ('tile', _PAD),    ('tile', _PAD)),
    'asphalt':  (('asphalt', _PAD),   ('asphalt', _PAD),   ('asphalt', _PAD), ('asphalt', _PAD)),
}
# Concrete is the one gap in the install: it has walk, run, turn and jump but
# no sprint and no stop set at all. Asphalt stands in for those two - both are
# hard mineral surfaces and it is a far smaller lie than the steel grating the
# old mapping used. Every other surface is its own throughout.

_GAITS = ('walk', 'run', 'sprint', 'stop')


def _clips(gait: str, stem: str, style: str, n: int) -> list[str]:
    if style == _BARE:
        return [f"{gait}_{stem}{i}" for i in range(1, n + 1)]
    return [f"{gait}_{stem}_{i:02d}" for i in range(1, n + 1)]


def _step_cues() -> dict:
    out: dict[str, dict] = {}
    for surf, per_gait in _SURFACE_CLIPS.items():
        for gait, (stem, style) in zip(_GAITS, per_gait):
            # stop is a single settling scuff, so it needs fewer variants
            n = 3 if gait == 'stop' else 6
            clips = _clips(gait, stem, style, n)
            if gait == 'stop':
                out[f"step_{surf}_stop"] = {"clips": clips, "trim": [0, 1.4]}
            else:
                # every step is the footfall mixed with a different gear rustle,
                # the way the game stacks them on a moving player
                out[f"step_{surf}_{gait}"] = {
                    "clips": [[c, g] for c, g in zip(clips, _GEAR)],
                    "gain": -1, "trim": [0, 1.2],
                }
    return out


PICKS = {
    # ---------------- container search ----------------
    # itemsounds.bundle carries exactly ten rummage loops and this uses all of
    # them; audio.js maps container type -> cue. They run 5-14s in the install
    # and a container here is searched for 1.5-5s, so each is trimmed to a bit
    # over the longest search that uses it rather than to a flat 3s - cutting
    # them all at 3s was lopping the body off the longer rummages.
    "search_wood": {"clips": ["woodbox_looting"], "trim": [0, 5.5]},
    "search_industrial": {"clips": ["industrialbox_looting"], "trim": [0, 6.0]},
    "search_metal": {"clips": ["drawer_metal_looting"], "trim": [0, 5.0]},
    "search_drawer": {"clips": ["drawer_wood_looting"], "trim": [0, 4.0]},
    "search_safe": {"clips": ["safe_looting"], "trim": [0, 5.0]},
    "search_bag": {"clips": ["sportbag_looting"], "trim": [0, 5.0]},
    "search_techno": {"clips": ["techno_box_looting_01"], "trim": [0, 6.0]},
    "search_cash": {"clips": ["cashregister_looting"], "trim": [0, 3.0]},
    # clothing has its own rummage in the install - the coat-pocket rustle
    "search_jacket": {"clips": ["jacket_looting"], "trim": [0, 4.0]},
    "search_body": {"clips": ["looting_body_extended"], "trim": [0, 5.5]},
    # There is deliberately no "found an item" cue. The game has none - the
    # rummage keeps running and the item just appears - and looting_luck2_other
    # is a one-off, not the systematic set a per-reveal chime would need.

    # ---------------- container lids ----------------
    # These used to come from itemsounds' four `container_*_open` clips, which
    # are the sounds an *item* case makes in your hands. The furniture in a
    # raid has its own bank in sharedassets8, and it matches the rummage loops
    # one for one: a jacket that rustles when searched now also opens like a
    # coat, and a wooden crate opens like wood instead of like plastic.
    "open_wood": {"clips": ["woodbox_open", "woodbox_small_open"], "trim": [0, 1.5]},
    "open_case": {"clips": ["plasticcase_heavy_open"], "trim": [0, 1.5]},
    "open_metal": {"clips": ["safe_open"], "trim": [0, 1.8]},
    "open_drawer": {"clips": ["drawer_metal_open", "drawer_metal_squeek_1"], "trim": [0, 1.5]},
    "open_jacket": {"clips": ["jacket_open"], "trim": [0, 1.5]},
    "open_bag": {"clips": ["sportbag_open"], "trim": [0, 1.8]},
    "open_cash": {"clips": ["cashregister_open"], "trim": [0, 1.8]},
    "open_locker": {"clips": ["door_metallocker_open"], "trim": [0, 1.5]},
    # Bodies deliberately have no lid cue - a corpse has nothing to open, and
    # the old build played a plastic case lid over one. audio.js skips it.

    # ---------------- interface ----------------
    "ui_click": {"clips": ["button_click"], "trim": [0, 0.5]},
    "ui_hover": {"clips": ["button_over"], "trim": [0, 0.4], "gain": -6},
    "ui_context": {"clips": ["menu_context_menu"], "trim": [0, 0.6]},
    "ui_error": {"clips": ["error_message"], "trim": [0, 1.2]},
    "ui_close": {"clips": ["menu_escape"], "trim": [0, 0.6]},
    "ui_window_open": {"clips": ["menu_open_container"], "trim": [0, 1.0]},
    "ui_inspect_open": {"clips": ["menu_inspector_window_open"], "trim": [0, 0.5]},
    "ui_inspect_close": {"clips": ["menu_inspector_window_close"], "trim": [0, 0.5]},
    "ui_equip": {"clips": ["clothes_equip"], "trim": [0, 1.5]},
    "ui_exp": {"clips": ["notification_exp"], "trim": [0, 2.0]},

    # ---------------- traders ----------------
    "trade_tab": {"clips": ["menu_trader_press"], "trim": [0, 1.0]},
    "trade_click": {"clips": ["trade_click_button"], "trim": [0, 0.8]},
    "trade_buy": {"clips": ["buy_button_click"], "trim": [0, 1.0]},
    "trade_deal": {"clips": ["trade_operation_complete"], "trim": [0, 2.5]},

    # ---------------- raid outcomes ----------------
    "extract_done": {"clips": ["quest_completed"], "trim": [0, 3.5]},
    "death": {"clips": ["fp_death_heartbeat"], "trim": [0, 4.0]},

    # ---------------- ambience ----------------
    # the real Factory bed, kept long so the loop point is hard to hear
    "amb_factory": {"clips": ["amb_factory_rework_day_loop"], "rate": 22050, "q": 1, "gain": -2},
}

# ---------------- weapons ----------------
# Every weapon in the game gets its own bank instead of four class sounds.
# The install names shots three different ways depending on the recording
# era, and none of them are inferable from the weapon name:
#
#   ak74_indoor_close_01      newer banks, 8 numbered variants
#   akm_close_indoor_01       same era, close/indoor swapped round
#   tt_fire_indoor_close      older banks, 1-2 variants, "fire" in the name
#
# Indoor variants throughout: Factory is a covered plant, so the reflections
# match. `_distant` of the same bank backs hostile fire, which is what makes a
# scav shooting at you sound like it comes from across the hall.
#
# cue -> (player clips, hostile clips)
WEAPON_FIRE = {
    # 5.45x39
    "ak74": (_seq("ak74_indoor_close_"), _seq("ak74_indoor_distant_")),
    "aksu": (_seq("aksu_indoor_close_"), _seq("aksu_indoor_distant_")),
    # 7.62x39 - also stands in for the VPO-136, an AKM-pattern carbine
    "akm": (_seq("akm_close_indoor_"), _seq("akm_distant_indoor_")),
    # 9x18 SMG, and the Kedr-B which is the suppressed variant
    "kedr": (_seq("kedr_indoor_close_"), _seq("kedr_indoor_distant_")),
    "kedrb": (_seq("kedr_indoor_close_silenced_"), _seq("kedr_indoor_distant_silenced_")),
    # pistols
    "pm": (["pm_indoor_close1", "pm_indoor_close2"], ["pm_indoor_distant1", "pm_indoor_distant2"]),
    "pb": (["pb_silenced_indoor_close1"], ["pb_silenced_indoor_distant1"]),
    "tt": (["tt_fire_indoor_close", "tt_fire_indoor_close2"],
           ["tt_fire_indoor_distant", "tt_fire_indoor_distant2"]),
    # 12ga
    "mp133": (["mr133_fire_indoor_close"], ["mr133_fire_indoor_distant"]),
    "mp153": (["mr153_fire_indoor_close"], ["mr153_fire_indoor_distant"]),
    # the Saiga has no indoor_distant; saiga_indoor_far1 is its only indoor
    # "away from you" recording, and it keeps the indoor policy the rest of
    # the far cues follow (the outdoor_distant clip used to stand in here)
    "saiga": (["saiga_indoor_close1"], ["saiga_indoor_far1"]),
}

for _w, (_close, _far) in WEAPON_FIRE.items():
    PICKS[f"fire_{_w}"] = {"clips": _close, "trim": [0, 1.6], "gain": -3}
    PICKS[f"fire_{_w}_far"] = {"clips": _far, "trim": [0, 1.8], "gain": -7}

# ---------------- suppressed shots ----------------
# `fire_<bank>_sil` / `_sil_far`: the same banks with a can on. audio.js picks
# these when the caller says the weapon is suppressed and the cue exists,
# so a bank without one (pm - it cannot mount a suppressor; kedr - the Kedr-B
# *is* the suppressed bank, `fire_kedrb`) simply keeps its bare report.
#
# The install spells "silenced" into the name three different ways, and the
# AK-74's close and distant clips do not even agree with each other:
#
#   ak74_indoor_silenced_close_01     ak74_indoor_distant_silenced_01
#   aksu_indoor_close_silenced_01     aksu_indoor_distant_silenced_01
#   akm_close_indoor_silenced_01      akm_distant_indoor_silenced_01
#   mr133_fire_silenced_indoor_close  mr133_fire_silenced_indoor_distant
#
# The TT is the one borrow: no tt_*silenced* clip exists although the game
# lets it mount a can, so it takes the PB's - the nearest Soviet pistol and
# already suppressed.
WEAPON_FIRE_SIL = {
    "ak74": (_seq("ak74_indoor_silenced_close_"), _seq("ak74_indoor_distant_silenced_")),
    "aksu": (_seq("aksu_indoor_close_silenced_"), _seq("aksu_indoor_distant_silenced_")),
    "akm": (_seq("akm_close_indoor_silenced_"), _seq("akm_distant_indoor_silenced_")),
    "mp133": (["mr133_fire_silenced_indoor_close"], ["mr133_fire_silenced_indoor_distant"]),
    "mp153": (["mr153_fire_silenced_indoor_close"], ["mr153_fire_silenced_indoor_distant"]),
    "saiga": (["saiga_fire_silenced_indoor_close"], ["saiga_fire_silenced_indoor_distant"]),
    "tt": (["pb_silenced_indoor_close1"], ["pb_silenced_indoor_distant1"]),
}
for _w, (_close, _far) in WEAPON_FIRE_SIL.items():
    PICKS[f"fire_{_w}_sil"] = {"clips": _close, "trim": [0, 1.6], "gain": -3}
    PICKS[f"fire_{_w}_sil_far"] = {"clips": _far, "trim": [0, 1.8], "gain": -7}
# and the reverse: the PB is recorded suppressed (that is `fire_pb`), but its
# can comes off in the game, so the bare barrel is a cue of its own
PICKS["fire_pb_unsil"] = {"clips": ["pb_indoor_close1"], "trim": [0, 1.6], "gain": -3}
PICKS["fire_pb_unsil_far"] = {"clips": ["pb_indoor_distant1"], "trim": [0, 1.8], "gain": -7}

# ---------------- weapon handling ----------------
# The assembly / magazine / cartridge cues. Handling clips are recorded per
# weapon too, but far fewer weapons have them than have shot banks, so the
# borrowing here is explicit (audio.js HANDLING mirrors it):
#
#   ak74     ak74_magin_plastic / ak74_magout_plastic / ak74_slider_*     ak74.bundle
#   aksu     the AK-74's mag and slide, plus its own aksu_stock_open/close aksu.bundle
#   akm      akm_magin_metal / akm_magout_metal (akm/instrumental.bundle),
#            akms_slider_* (in ak74.bundle) and akms_stock_fold/unfold
#   kedr     kedr_magin / kedr_magout / kedr_slider_*                      kedr.bundle
#            (its stock folds but kedr.bundle has no stock clip: the 9A-91's
#            9A91_stock_fold/unfold in ak74.bundle stand in - another top-folder)
#   pm       pm_mag_in / pm_mag_out / pm_slider_in|out                     pm.bundle
#            (the TT and the PB have no handling of their own; they use these)
#   mp133    mr133_shell_in_mag / mr133_shell_out_mag / mr133_pump_in|out  mr133.bundle
#   mp153    mr153_slider_* for the bolt, the MP-133's shells for loading
#   saiga    saiga_magin_plastic / saiga_magout_plastic / saiga_slider_*,
#            saiga_stock_open/close                                       saiga12.bundle
#
# The generic ones are the interface's: menu_install_mod_* is what the modding
# screen clicks when a part goes on (gear / vital / func are the game's own
# three flavours), menu_install_mag when a magazine does, ammo_load1..7 and
# ammo_unload1..7 the cartridge presses, menu_modding_open/close the screen.
_HANDLING = {
    "ak74":  {"magin": ["ak74_magin_plastic"], "magout": ["ak74_magout_plastic"],
              "bolt": ["ak74_slider_up", "ak74_slider_down"]},
    "aksu":  {"magin": ["ak74_magin_plastic"], "magout": ["ak74_magout_plastic"],
              "bolt": ["ak74_slider_up", "ak74_slider_down"],
              "fold_open": ["aksu_stock_open"], "fold_close": ["aksu_stock_close"]},
    "akm":   {"magin": ["akm_magin_metal"], "magout": ["akm_magout_metal"],
              "bolt": ["akms_slider_up", "akms_slider_down"],
              "fold_open": ["akms_stock_unfold"], "fold_close": ["akms_stock_fold"]},
    "kedr":  {"magin": ["kedr_magin"], "magout": ["kedr_magout"],
              "bolt": ["kedr_slider_up", "kedr_slider_down"],
              "fold_open": ["9A91_stock_unfold"], "fold_close": ["9A91_stock_fold"]},
    "pm":    {"magin": ["pm_mag_in"], "magout": ["pm_mag_out"],
              "bolt": ["pm_slider_out", "pm_slider_in"]},
    "mp133": {"magin": ["mr133_shell_in_mag"], "magout": ["mr133_shell_out_mag"],
              "bolt": ["mr133_pump_out", "mr133_pump_in"]},
    "mp153": {"magin": ["mr133_shell_in_mag"], "magout": ["mr133_shell_out_mag"],
              "bolt": ["mr153_slider_up", "mr153_slider_down"]},
    "saiga": {"magin": ["saiga_magin_plastic"], "magout": ["saiga_magout_plastic"],
              "bolt": ["saiga_slider_up", "saiga_slider_down"],
              "fold_open": ["saiga_stock_open"], "fold_close": ["saiga_stock_close"]},
}
for _w, _cues in _HANDLING.items():
    for _k, _names in _cues.items():
        PICKS[f"{_k}_{_w}"] = {"clips": _names, "trim": [0, 1.2], "gain": -4}

# ---------------- weapon actions ----------------
# The rest of what a hand does to a gun, per handling bank, same
# `<kind>_<bank>` naming and the same trim/gain as above:
#
#   dry           trigger on an empty chamber
#   selector      the fire selector thrown - only the banks that have one
#                 (the pistols, shotguns and VPO-136 are single-fire)
#   magcheck      pulling the magazine part way to look at it
#   chambercheck  easing the bolt back to see if there is a round in
#   chamber       a round put into the chamber by hand / unchamber taken out
#   jam           the bolt catching on a stoppage
#
# The install has far fewer of these than shot banks, so most of the table
# is borrows, and they are spelled out here rather than guessed at:
#
#   dry     ak74_trigger_empty is the only AK click (aksu/akm borrow it);
#           mr133_trigger is the one trigger clip in either shotgun bank
#   select  ak74_fireselector_* for every AK, kedr_fireselector_* for the Kedr
#   magch   only the PM has a slow pull (pm_mag_pullout - it is a 1.6s clip,
#           so it gets a longer trim; the matching pm_mag_pullin is dropped
#           because the extractor mixes layers, it does not concatenate them).
#           Every other bank re-uses its own magout; the shotguns rattle the
#           tube cap (mr133_magcover)
#   chamch  saiga_slider_check is the only `_check` slide in the twelve banks,
#           so the AKs borrow it; the Kedr has slow slides of its own, the PM
#           its slide catch, the shotguns half a pump
#   chamber ak74/kedr/saiga have real round_in_chamber / round_out clips; the
#           shotguns drop a shell straight into the port and pick it out; the
#           PM has none, so its slide going in/out stands for it
#   jam     ak74/kedr/saiga slider_jam, the PM's jammed slide + shell; the
#           shotguns have no jam clip and borrow the Saiga's
_ACTIONS = {
    "ak74":  {"dry": ["ak74_trigger_empty"],
              "selector": ["ak74_fireselector_up", "ak74_fireselector_down"],
              "magcheck": ["ak74_magout_plastic"], "chambercheck": ["saiga_slider_check"],
              "chamber": ["ak74_round_in_chamber"], "unchamber": ["ak74_round_out"],
              "jam": ["ak74_slider_jam"]},
    "aksu":  {"dry": ["ak74_trigger_empty"],
              "selector": ["ak74_fireselector_up", "ak74_fireselector_down"],
              "magcheck": ["ak74_magout_plastic"], "chambercheck": ["saiga_slider_check"],
              "chamber": ["ak74_round_in_chamber"], "unchamber": ["ak74_round_out"],
              "jam": ["ak74_slider_jam"]},
    "akm":   {"dry": ["ak74_trigger_empty"],
              "selector": ["ak74_fireselector_up", "ak74_fireselector_down"],
              "magcheck": ["akm_magout_metal"], "chambercheck": ["saiga_slider_check"],
              "chamber": ["ak74_round_in_chamber"], "unchamber": ["ak74_round_out"],
              "jam": ["ak74_slider_jam"]},
    "kedr":  {"dry": ["kedr_trigger_empty"],
              "selector": ["kedr_fireselector_up", "kedr_fireselector_down"],
              "magcheck": ["kedr_magout"],
              "chambercheck": ["kedr_slider_up_slow", "kedr_slider_down_slow"],
              "chamber": ["kedr_round_in_chamber"], "unchamber": ["kedr_round_out"],
              "jam": ["kedr_slider_jam"]},
    "pm":    {"dry": ["pm_trigger_empty"],
              "magcheck": ["pm_mag_pullout"], "chambercheck": ["pm_catch_slider"],
              "chamber": ["pm_slider_in"], "unchamber": ["pm_slider_out"],
              "jam": ["pm_slider_jammed", "pm_shell_jammed"]},
    "mp133": {"dry": ["mr133_trigger"],
              "magcheck": ["mr133_magcover"], "chambercheck": ["mr133_pump_out"],
              "chamber": ["mr133_shell_in_port"], "unchamber": ["mr133_shell_pickup"],
              "jam": ["saiga_slider_jam"]},
    "mp153": {"dry": ["mr133_trigger"],
              "magcheck": ["mr133_magcover"], "chambercheck": ["mr133_pump_out"],
              "chamber": ["mr133_shell_in_port"], "unchamber": ["mr133_shell_pickup"],
              "jam": ["saiga_slider_jam"]},
    "saiga": {"dry": ["saiga_trigger_empty"],
              "magcheck": ["saiga_magout_plastic"], "chambercheck": ["saiga_slider_check"],
              "chamber": ["saiga_round_in_chamber"], "unchamber": ["saiga_round_out"],
              "jam": ["saiga_slider_jam"]},
}
for _w, _cues in _ACTIONS.items():
    for _k, _names in _cues.items():
        PICKS[f"{_k}_{_w}"] = {"clips": _names, "trim": [0, 1.2], "gain": -4}
PICKS["magcheck_pm"]["trim"] = [0, 1.8]   # the slow pull runs 1.6s
# the malfunction being looked at - the game's own "examined" sting
PICKS["jam_examined"] = {"clips": ["battle_malfunction_examined"], "trim": [0, 1.5]}
PICKS.update({
    "modding_open": {"clips": ["menu_modding_open"], "trim": [0, 1.0]},
    "modding_close": {"clips": ["menu_modding_close"], "trim": [0, 1.0]},
    "mod_install_gear": {"clips": ["menu_install_mod_gear"], "trim": [0, 0.8]},
    "mod_install_vital": {"clips": ["menu_install_mod_vital"], "trim": [0, 0.8]},
    "mod_install_func": {"clips": ["menu_install_mod_func"], "trim": [0, 0.8]},
    "mod_install_mag": {"clips": ["menu_install_mag"], "trim": [0, 0.8]},
    "ammo_load": {"clips": [f"ammo_load{i}" for i in range(1, 8)], "trim": [0, 0.6]},
    "ammo_unload": {"clips": [f"ammo_unload{i}" for i in range(1, 8)], "trim": [0, 0.6]},
    # shotgun shells go into the tube with the MP-133's own press
    "shell_load": {"clips": ["mr133_shell_in_mag", "mr133_shell_in_mag2", "mr133_shell_in_mag3"],
                   "trim": [0, 1.0], "gain": -4},
    "shell_unload": {"clips": ["mr133_shell_out_mag"], "trim": [0, 1.0], "gain": -4},
})

# ---------------- repair, building, unpacking ----------------
# Out-of-raid weapon work, from the interface bank and itemsounds:
#   repair_complete           the game's repair-finished sting (resources.assets)
#   spec_weaprep_use          the weapon repair kit being applied (itemsounds)
#   menu_weapon_assemble /    a build being put together / stripped back to
#   menu_weapon_disassemble   parts (resources.assets)
#   ammo_pack_generic_use     an ammo box being torn open - the ItemSound of
#                             every SPT ammo box but one; ammo_shotgun_use is
#                             the 12ga box's own
# The repair kit's pickup/drop are named exactly as _item_cues() would name
# them from an ItemSound of `spec_weaprep`, so once the kit is in items-db
# the derived entry lands on the same key and nothing doubles up.
PICKS.update({
    "repair_done": {"clips": ["repair_complete"], "trim": [0, 1.5]},
    "repair_kit_use": {"clips": ["spec_weaprep_use"], "trim": [0, 3.5]},
    "build_assemble": {"clips": ["menu_weapon_assemble"], "trim": [0, 1.0]},
    "build_strip": {"clips": ["menu_weapon_disassemble"], "trim": [0, 1.0]},
    "ammo_unpack": {"clips": ["ammo_pack_generic_use"], "trim": [0, 0.6]},
    "ammo_unpack_12ga": {"clips": ["ammo_shotgun_use"], "trim": [0, 0.6]},
    "item_spec_weaprep_pickup": {"clips": ["spec_weaprep_pickup"], "trim": [0, 2.0]},
    "item_spec_weaprep_drop": {"clips": ["spec_weaprep_drop"], "trim": [0, 2.0]},
})

# ---------------- bullet impacts ----------------
# sharedassets397 is the install's impact bank. Splitting hit feedback by what
# the round actually landed on is the difference between "did I hit?" and a
# guess: flesh thumps, armour cracks, a helmet rings and rings differently
# when it deflects, and a miss is whatever surface it chewed instead.
PICKS.update({
    "hit_body": {"clips": [f"body{i}" for i in range(1, 7)], "trim": [0, 1.3]},
    "hit_armor": {"clips": [f"bodyarmor{i}_close" for i in range(1, 5)], "trim": [0, 1.2]},
    "hit_helmet": {"clips": [f"impact_helmet_ric_3p_{i}" for i in range(1, 5)], "trim": [0, 1.0]},
    "impact_metal": {"clips": [f"metal{i}" for i in range(1, 7)], "trim": [0, 1.4], "gain": -4},
    "impact_wood": {"clips": [f"wood{i}" for i in range(1, 6)], "trim": [0, 1.2], "gain": -4},
    "impact_concrete": {"clips": ["generic_hard1", "generic_hard2", "generic_hard3"],
                        "trim": [0, 1.0], "gain": -4},
    # ricochet9 exists, ricochet8 does not - the install skips it
    "ricochet": {"clips": [f"ricochet{i}" for i in [1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 12, 13]],
                 "trim": [0, 1.5], "gain": -5},
})

# ---------------- item handling ----------------
# Every item template carries an ItemSound field naming the foley it makes, and
# itemsounds.bundle holds a <class>_pickup / _drop / _use for each.
# tools/build_items.py copies that field into src/data/items-db.json as `snd`.
#
# Rather than hardcode the class list, read the database and take exactly the
# classes it uses. The previous list carried 48 classes when the item set only
# used 40, and a full _use set when only meds/food/drink can ever be consumed -
# 57 cues of audio that shipped in the pack and could never be played.
_NO_USE = {"grenade", "item_money", "jewelry", "smallmetal", "spec_multitool"}
# mirrors the USE action's gate in src/ui/raid-ui.js
_USABLE_CATS = {"meds", "food", "drink"}


def _load_items() -> list[dict]:
    db = json.loads((ROOT / "src" / "data" / "items-db.json").read_text(encoding="utf-8"))
    items = db["items"] if isinstance(db, dict) and "items" in db else db
    return list(items.values()) if isinstance(items, dict) else items


def _item_cues() -> dict:
    out: dict[str, dict] = {}
    items = _load_items()
    handled = {it["snd"] for it in items if it.get("snd")}
    usable = {
        it["snd"] for it in items
        if it.get("snd") and it.get("cat") in _USABLE_CATS and it.get("res")
    }
    for cls in sorted(handled):
        out[f"item_{cls}_pickup"] = {"clips": [f"{cls}_pickup"], "trim": [0, 2.0]}
        out[f"item_{cls}_drop"] = {"clips": [f"{cls}_drop"], "trim": [0, 2.0]}
        if cls in usable and cls not in _NO_USE:
            out[f"item_{cls}_use"] = {"clips": [f"{cls}_use"], "trim": [0, 3.5]}
    # generic is the safety net audio.js falls back to for an item whose
    # ItemSound has no clip; keep all three even if the set above covers it
    for act, dur in (("pickup", 2.0), ("drop", 2.0), ("use", 3.5)):
        out.setdefault(f"item_generic_{act}", {"clips": [f"generic_{act}"], "trim": [0, dur]})
    return out


PICKS.update(_step_cues())
PICKS.update(_item_cues())
