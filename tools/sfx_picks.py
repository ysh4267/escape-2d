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
    "saiga": (["saiga_indoor_close1"], ["saiga_outdoor_distant1"]),
}

for _w, (_close, _far) in WEAPON_FIRE.items():
    PICKS[f"fire_{_w}"] = {"clips": _close, "trim": [0, 1.6], "gain": -3}
    PICKS[f"fire_{_w}_far"] = {"clips": _far, "trim": [0, 1.8], "gain": -7}

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
              "bolt": ["kedr_slider_up", "kedr_slider_down"]},
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
