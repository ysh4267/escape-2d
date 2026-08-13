"""
Which AudioClips out of the EFT install back which cue in this game.

Every name here was read out of the install's own bundles (see
`extract_tarkov_sfx.py --index` / `--search`), so the taxonomy is the game's,
not one I invented:

  movement   sounds.bundle          <gait>_<surface>_<n>   walk|run|sprint|stop|turn ...
  gear       sounds.bundle          gear_stereo_<n>        the webbing rustle under every step
  items      itemsounds.bundle      <class>_<action>       pickup|drop|use|open
  looting    itemsounds.bundle      <furniture>_looting    the per-container rummage
  interface  resources.assets       button_*, menu_*, trade_*
  ambience   sharedassets537        amb_factory_rework_*   the real Factory bed
  weapons    <bank>.bundle          <weapon>_fire_indoor_close

Cue name -> {clips: [...], plus ffmpeg knobs}. A list entry that is itself a
list gets mixed down into one file (used to bake the gear rustle into the
footsteps, which is how the game layers them).

`trim` is [start, duration] on the source; several of these clips are long
tails of room reflection that would smear if left whole.
"""

# the Factory floor is concrete underfoot with metal walkways; the game is
# top-down and has no surface map, so the two are blended per step instead
_WALK = [f"walk_concrete{i}" for i in range(1, 7)]
_RUN = [f"run_concrete{i}" for i in range(1, 7)]
_SPRINT = [f"sprint_metal{i}" for i in range(1, 7)]
_GEAR = [f"gear_stereo{i}" for i in range(1, 7)]

PICKS = {
    # ---------------- movement ----------------
    # each step is the footfall mixed with a different gear rustle, the way
    # the game stacks them on a moving player
    "step_walk": {
        "clips": [[w, g] for w, g in zip(_WALK, _GEAR)],
        "gain": -1, "trim": [0, 1.2],
    },
    "step_run": {
        "clips": [[w, g] for w, g in zip(_RUN, _GEAR)],
        "gain": -1, "trim": [0, 1.2],
    },
    "step_sprint": {
        "clips": [[w, g] for w, g in zip(_SPRINT, _GEAR)],
        "gain": -1, "trim": [0, 1.2],
    },
    "step_stop": {"clips": ["stop_metal1", "stop_metal2", "stop_metal3"], "trim": [0, 1.4]},

    # ---------------- container search ----------------
    # one file per container family; raid.js picks by container type
    "search_wood": {"clips": ["woodbox_looting"], "trim": [0, 3.0]},
    "search_metal": {"clips": ["drawer_metal_looting"], "trim": [0, 3.0]},
    "search_drawer": {"clips": ["drawer_wood_looting"], "trim": [0, 3.0]},
    "search_safe": {"clips": ["safe_looting"], "trim": [0, 3.0]},
    "search_bag": {"clips": ["sportbag_looting"], "trim": [0, 3.0]},
    "search_techno": {"clips": ["techno_box_looting_01"], "trim": [0, 3.0]},
    "search_cash": {"clips": ["cashregister_looting"], "trim": [0, 3.0]},
    "search_body": {"clips": ["looting_body_extended"], "trim": [0, 3.5]},
    # the little "something turned up" flourish
    "found": {"clips": ["looting_luck2_other"], "trim": [0, 2.0], "gain": 1},

    # ---------------- container lids ----------------
    "open_case": {"clips": ["container_case_open"], "trim": [0, 2.0]},
    "open_metal": {"clips": ["container_metal_open"], "trim": [0, 2.0]},
    "open_plastic": {"clips": ["container_plastic_open"], "trim": [0, 2.0]},
    "open_pouch": {"clips": ["container_pouch_open"], "trim": [0, 2.0]},

    # ---------------- item handling ----------------
    # <cue> = item_<class>_<pickup|drop>; the class comes from the item's
    # gameplay category in src/data/items.js
    "item_generic_pickup": {"clips": ["generic_pickup"], "trim": [0, 1.6]},
    "item_generic_drop": {"clips": ["generic_drop"], "trim": [0, 1.6]},
    "item_metal_pickup": {"clips": ["smallmetal_pickup"], "trim": [0, 1.6]},
    "item_metal_drop": {"clips": ["smallmetal_drop"], "trim": [0, 1.6]},
    "item_ammo_pickup": {"clips": ["ammo_generic_pickup"], "trim": [0, 1.6]},
    "item_ammo_drop": {"clips": ["ammo_generic_drop"], "trim": [0, 1.6]},
    "item_mag_pickup": {"clips": ["magazine_metal_pickup"], "trim": [0, 1.6]},
    "item_mag_drop": {"clips": ["magazine_metal_drop"], "trim": [0, 1.6]},
    "item_med_pickup": {"clips": ["med_medkit_pickup"], "trim": [0, 1.6]},
    "item_med_drop": {"clips": ["med_medkit_drop"], "trim": [0, 1.6]},
    "item_food_pickup": {"clips": ["food_tin_can_pickup"], "trim": [0, 1.6]},
    "item_food_drop": {"clips": ["food_tin_can_drop"], "trim": [0, 1.6]},
    "item_drink_pickup": {"clips": ["food_bottle_pickup"], "trim": [0, 1.6]},
    "item_drink_drop": {"clips": ["food_bottle_drop"], "trim": [0, 1.6]},
    "item_armor_pickup": {"clips": ["gear_armor_pickup"], "trim": [0, 1.8]},
    "item_armor_drop": {"clips": ["gear_armor_drop"], "trim": [0, 1.8]},
    "item_helmet_pickup": {"clips": ["gear_helmet_pickup"], "trim": [0, 1.8]},
    "item_helmet_drop": {"clips": ["gear_helmet_drop"], "trim": [0, 1.8]},
    "item_backpack_pickup": {"clips": ["gear_backpack_pickup"], "trim": [0, 1.8]},
    "item_backpack_drop": {"clips": ["gear_backpack_drop"], "trim": [0, 1.8]},
    "item_gear_pickup": {"clips": ["gear_generic_pickup"], "trim": [0, 1.8]},
    "item_gear_drop": {"clips": ["gear_generic_drop"], "trim": [0, 1.8]},
    "item_glasses_pickup": {"clips": ["gear_goggles_pickup"], "trim": [0, 1.6]},
    "item_glasses_drop": {"clips": ["gear_goggles_drop"], "trim": [0, 1.6]},
    "item_weapon_pickup": {"clips": ["weap_rifle_pickup"], "trim": [0, 2.0]},
    "item_weapon_drop": {"clips": ["weap_rifle_drop"], "trim": [0, 2.0]},
    "item_pistol_pickup": {"clips": ["weap_pistol_pickup"], "trim": [0, 1.8]},
    "item_pistol_drop": {"clips": ["weap_pistol_drop"], "trim": [0, 1.8]},
    "item_melee_pickup": {"clips": ["knife_generic_pickup"], "trim": [0, 1.6]},
    "item_melee_drop": {"clips": ["knife_generic_drop"], "trim": [0, 1.6]},
    "item_case_pickup": {"clips": ["container_case_pickup"], "trim": [0, 1.8]},
    "item_case_drop": {"clips": ["container_case_drop"], "trim": [0, 1.8]},
    "item_glass_pickup": {"clips": ["waterglass_pickup"], "trim": [0, 1.6]},
    "item_glass_drop": {"clips": ["waterglass_drop"], "trim": [0, 1.6]},

    # consuming a med / ration in raid
    "use_med": {"clips": ["med_medkit_use"], "trim": [0, 3.0]},
    "use_pills": {"clips": ["med_pills_use"], "trim": [0, 2.5]},
    "use_food": {"clips": ["food_tin_can_use"], "trim": [0, 3.0]},
    "use_drink": {"clips": ["food_bottle_use"], "trim": [0, 3.0]},

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

    # ---------------- weapons ----------------
    # indoor variants: Factory is a covered plant, so the reflections match
    "fire_pistol": {"clips": ["grach_fire_indoor_close"], "trim": [0, 1.2], "gain": -3},
    "fire_rifle": {"clips": ["sks_fire_indoor_close"], "trim": [0, 1.4], "gain": -3},
    "fire_shotgun": {"clips": ["mr133_fire_indoor_close"], "trim": [0, 1.6], "gain": -3},
    "fire_smg": {"clips": ["stm9_fire_indoor_close"], "trim": [0, 1.2], "gain": -3},

    # ---------------- ambience ----------------
    # the real Factory bed, kept long so the loop point is hard to hear
    "amb_factory": {"clips": ["amb_factory_rework_day_loop"], "rate": 22050, "q": 1, "gain": -2},
}
