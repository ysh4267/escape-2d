# =========================================================
# curated item selection for ESCAPE 2D
#
# each row: (query, key, cat, weight_kg, stack, extra)
#   query  - exact item name from the EFT locale dump, or a raw 24-hex item id
#   key    - stable slug the game code and loot tables refer to
#   cat    - gameplay category
#   weight - kg for one unit
#   stack  - max stack size
#   extra  - gameplay props; gridsHint declares a container's internal grids
# =========================================================

SELECTION = [
    # ---------------- money ----------------
    ('Roubles', 'rub', 'money', 0.0, 500000, {'alwaysExamined': True}),
    ('Dollars', 'usd', 'money', 0.0, 50000, {'alwaysExamined': True}),
    ('Euros',   'eur', 'money', 0.0, 50000, {'alwaysExamined': True}),

    # ---------------- medical ----------------
    ('Salewa first aid kit',                     'salewa',    'meds', 0.60, 1, {'res': 400,  'heal': 55}),
    ('IFAK individual first aid kit',            'ifak',      'meds', 0.50, 1, {'res': 300,  'heal': 50}),
    ('Car first aid kit',                        'car',       'meds', 0.30, 1, {'res': 220,  'heal': 40}),
    ('Grizzly medical kit',                      'grizzly',   'meds', 3.00, 1, {'res': 1800, 'heal': 75}),
    ('AI-2 medkit',                              'ai2',       'meds', 0.20, 1, {'res': 100,  'heal': 25}),
    ('AFAK tactical individual first aid kit',   'afak',      'meds', 0.55, 1, {'res': 400,  'heal': 55}),
    ('Aseptic bandage',                          'bandage',   'meds', 0.10, 1, {'res': 1,  'heal': 12}),
    ('Army bandage',                             'armyband',  'meds', 0.15, 1, {'res': 2,  'heal': 16}),
    ('Analgin painkillers',                      'analgin',   'meds', 0.10, 1, {'res': 4}),
    ('Ibuprofen painkillers',                    'ibuprofen', 'meds', 0.10, 1, {'res': 12}),
    ('Morphine injector',                        'morphine',  'meds', 0.05, 1, {'res': 1}),
    ('Immobilizing splint',                      'splint',    'meds', 0.20, 1, {'res': 5}),
    ('Aluminum splint',                          'alusplint', 'meds', 0.18, 1, {'res': 5}),
    ('CMS surgical kit',                         'cms',       'meds', 0.55, 1, {'res': 5}),
    ('Surv12 field surgical kit',                'surv12',    'meds', 1.20, 1, {'res': 15}),
    ('Esmarch tourniquet',                       'esmarch',   'meds', 0.15, 1, {'res': 1}),
    ('CALOK-B hemostatic applicator',            'calok',     'meds', 0.15, 1, {'res': 1}),
    ('Propital regenerative stimulant injector', 'propital',  'meds', 0.10, 1, {'res': 1}),
    ('Zagustin hemostatic drug injector',        'zagustin',  'meds', 0.10, 1, {'res': 1}),
    ('Adrenaline injector',                      'adrenal',   'meds', 0.10, 1, {'res': 1}),
    ('Vaseline balm',                            'vaseline',  'meds', 0.15, 1, {'res': 3}),
    ('Golden Star balm',                         'goldstar',  'meds', 0.10, 1, {'res': 10}),

    # ---------------- provisions ----------------
    ('Iskra ration pack',                  'iskra',    'food',  0.60, 1, {'res': 100}),
    ('MRE ration pack',                    'mre',      'food',  0.55, 1, {'res': 100}),
    ('Can of beef stew (Large)',           'stewL',    'food',  0.60, 1, {'res': 80}),
    ('Can of beef stew (Small)',           'stewS',    'food',  0.35, 1, {'res': 60}),
    ('Can of condensed milk',              'milk',     'food',  0.40, 1, {'res': 62}),
    ('Emelya rye croutons',                'emelya',   'food',  0.18, 1, {'res': 30}),
    ('Alyonka chocolate bar',              'alyonka',  'food',  0.10, 1, {'res': 35}),
    ('Pack of oat flakes',                 'oatflakes','food',  0.35, 1, {'res': 50}),
    ('Bottle of water (0.6L)',             'water',    'drink', 0.65, 1, {'res': 60}),
    ('5d40407c86f774318526545a', 'vodka',    'drink', 0.55, 1, {'res': 100}),
    ('Bottle of Pevko Light beer',  'beer',     'drink', 0.55, 1, {'res': 90}),
    ('Can of Hot Rod energy drink',        'hotrod',   'drink', 0.35, 1, {'res': 60}),
    ('Apollo Soyuz cigarettes',    'apollo',   'barter', 0.05, 1, {}),
    ('Strike Cigarettes',          'strike',   'barter', 0.05, 1, {}),
    ('Malboro Cigarettes',         'malboro',  'barter', 0.05, 1, {}),
    ('Wilston cigarettes',         'wilston',  'barter', 0.05, 1, {}),
    ('Pack of Vita juice',         'vita',     'drink', 0.40, 1, {'res': 60}),
    ('Pack of Russian Army pineapple juice', 'pineapple', 'drink', 0.35, 1, {'res': 60}),

    # ---------------- household / tools ----------------
    ('Duct tape',              'ducttape',  'barter', 0.20, 1, {}),
    ('Insulating tape',        'insultape', 'barter', 0.14, 1, {}),
    ('Bolts',                  'bolts',     'barter', 0.16, 1, {}),
    ('Screw nuts',             'nuts',      'barter', 0.16, 1, {}),
    ('Corrugated hose',        'hose',      'barter', 0.30, 1, {}),
    ('Toolset',                'toolset',   'barter', 3.00, 1, {}),
    ('Wrench',                 'wrench',    'barter', 0.30, 1, {}),
    ('Pliers Elite',           'pliers',    'barter', 0.30, 1, {}),
    ('Hand drill',             'drill',     'barter', 1.30, 1, {}),
    ('WD-40 (100ml)',          'wd40',      'barter', 0.20, 1, {}),
    ('Ox bleach',              'bleach',    'barter', 0.60, 1, {}),
    ('Ripstop fabric',         'ripstop',   'barter', 0.30, 1, {}),
    ('Paracord',               'paracord',  'barter', 0.30, 1, {}),
    ('Fleece fabric',          'fleece',    'barter', 0.35, 1, {}),
    ('Pack of nails',          'nails',     'barter', 0.40, 1, {}),
    ('Pack of screws',         'screws',    'barter', 0.30, 1, {}),
    ('Electric drill',         'edrill',    'barter', 1.50, 1, {}),

    # ---------------- electronics ----------------
    ('Printed circuit board',                       'pcb',        'electronics', 0.10, 1, {}),
    ('Broken GPhone X smartphone',                  'gphone',     'electronics', 0.15, 1, {}),
    ('Working LCD',                                 'lcd',        'electronics', 0.50, 1, {}),
    ('Damaged hard drive',                          'hddbroken',  'electronics', 0.30, 1, {}),
    ('Gas analyzer',                                'gasan',      'electronics', 0.35, 1, {}),
    ('Capacitors',                                  'caps',       'electronics', 0.10, 1, {}),
    ('Power cord',                                  'powercord',  'electronics', 0.20, 1, {}),
    ('Bundle of wires',                             'wirebundle', 'electronics', 0.30, 1, {}),
    ('Graphics card',                               'gpu',        'electronics', 0.70, 1, {}),
    ('Tetriz portable game console',                'tetriz',     'electronics', 0.15, 1, {}),
    ('Virtex programmable processor',               'virtex',     'electronics', 0.20, 1, {}),
    ('Military COFDM Wireless Signal Transmitter',  'cofdm',      'electronics', 1.50, 1, {}),
    ('Military circuit board',                      'milboard',   'electronics', 0.40, 1, {}),
    ('Military power filter',                       'milfilter',  'electronics', 0.60, 1, {}),
    ('Phased array element',                        'phased',     'electronics', 0.60, 1, {}),
    ('UHF RFID Reader',                             'rfid',       'electronics', 0.40, 1, {}),
    ('Far-forward GPS Signal Amplifier Unit',       'ffgps',      'electronics', 0.55, 1, {}),
    ('Advanced current converter',                  'advconv',    'electronics', 0.55, 1, {}),
    ('Cyclon rechargeable battery',                 'cyclon',     'electronics', 1.00, 1, {}),
    ('6-STEN-140-M military battery',               'sten140',    'electronics', 8.00, 1, {}),
    ('Car battery',                                 'carbat',     'electronics', 8.00, 1, {}),
    ('Electric motor',                              'emotor',     'electronics', 1.60, 1, {}),
    ('Rechargeable battery',                        'rechbat',    'electronics', 0.35, 1, {}),
    ('AA Battery',                                  'aabat',      'electronics', 0.03, 1, {}),
    ('D Size battery',                              'dbat',       'electronics', 0.09, 1, {}),
    ('GreenBat lithium battery',                    'greenbat',   'electronics', 0.55, 1, {}),

    # ---------------- valuables ----------------
    ('LEDX Skin Transilluminator',       'ledx',      'valuables', 0.20, 1, {}),
    ('Physical Bitcoin',                 'bitcoin',   'valuables', 0.20, 1, {}),
    ('Gold skull ring',                  'skullring', 'valuables', 0.03, 1, {}),
    ('Golden neck chain',                'goldchain', 'valuables', 0.05, 1, {}),
    ('Golden rooster figurine',          'rooster',   'valuables', 0.65, 1, {}),
    ('Golden egg',                       'goldegg',   'valuables', 0.65, 1, {}),
    ('Golden 1GPhone smartphone',        'goldphone', 'valuables', 0.15, 1, {}),
    ('Roler Submariner gold wrist watch','rolex',     'valuables', 0.15, 1, {}),
    ('Bronze lion figurine',             'lion',      'valuables', 1.20, 1, {}),
    ('Horse figurine',                   'horse',     'valuables', 0.65, 1, {}),
    ('Cat figurine',                     'cat',       'valuables', 0.65, 1, {}),
    ('Raven figurine',                   'raven',     'valuables', 0.65, 1, {}),
    ('Chain with Prokill medallion',     'prokill',   'valuables', 0.10, 1, {}),
    ('Antique teapot',                   'teapot',    'valuables', 0.90, 1, {}),
    ('Antique vase',                     'vase',      'valuables', 1.20, 1, {}),

    # ---------------- intel ----------------
    ('Secure Flash drive',   'flashdrive', 'info', 0.02, 1, {}),
    ('Intelligence folder',  'intel',      'info', 0.15, 1, {}),
    ('Slim diary',           'diary',      'info', 0.10, 1, {}),
    ('Factory plan map',     'factorymap', 'info', 0.20, 1, {}),

    # ---------------- keys ----------------
    ('Factory emergency exit key',    'k_factexit', 'key', 0.02, 1, {'uses': 10}),
    ('Abandoned factory marked key',  'k_marked',   'key', 0.02, 1, {'uses': 10}),
    ('Pumping station back door key', 'k_pump',     'key', 0.02, 1, {'uses': 10}),
    ('Portable bunkhouse key',        'k_bunk',     'key', 0.02, 1, {'uses': 10}),
    ('5937ee6486f77408994ba448',      'k_machine',  'key', 0.02, 1, {'uses': 10}),
    ('Gas station storage room key',  'k_gasstore', 'key', 0.02, 1, {'uses': 10}),
    ('Gas station office key',        'k_gasoffice','key', 0.02, 1, {'uses': 10}),
    ('Gas station safe key',          'k_gassafe',  'key', 0.02, 1, {'uses': 10}),

    # ---------------- cases ----------------
    ('Documents case',      'docscase',   'container', 0.20, 1, {'gridsHint': [[4, 4]],   'filter': {'allow': ['key', 'info', 'money']}}),
    ('Money case',          'moneycase',  'container', 0.60, 1, {'gridsHint': [[7, 7]],   'filter': {'allow': ['money', 'valuables']}}),
    ('Lucky Scav Junk box', 'junkbox',    'container', 1.20, 1, {'gridsHint': [[16, 16]], 'filter': {'allow': ['barter', 'electronics', 'valuables', 'info']}}),
    ('Item case',           'itemcase',   'container', 1.10, 1, {'gridsHint': [[8, 8]]}),
    ('Medicine case',       'medcase',    'container', 0.90, 1, {'gridsHint': [[7, 7]],   'filter': {'allow': ['meds']}}),
    ('Magazine case',       'magcase',    'container', 1.00, 1, {'gridsHint': [[7, 7]],   'filter': {'allow': ['mag']}}),
    ('Ammunition case',     'ammocase',   'container', 0.90, 1, {'gridsHint': [[7, 7]],   'filter': {'allow': ['ammo']}}),
    ('Grenade case',        'grenadecase','container', 0.70, 1, {'gridsHint': [[6, 6]],   'filter': {'allow': ['grenade']}}),
    ('Injector case',       'injcase',    'container', 0.60, 1, {'gridsHint': [[6, 6]],   'filter': {'allow': ['meds']}}),
    ('Simple wallet',       'wallet',     'container', 0.10, 1, {'gridsHint': [[2, 2]],   'filter': {'allow': ['money']}}),

    # ---------------- secure containers ----------------
    ('Secure container Alpha',   'sc_alpha',   'secure', 1.00, 1, {'gridsHint': [[2, 2]]}),
    ('Secure container Beta',    'sc_beta',    'secure', 1.00, 1, {'gridsHint': [[3, 2]]}),
    ('Secure container Epsilon', 'sc_epsilon', 'secure', 1.00, 1, {'gridsHint': [[4, 2]]}),
    ('Secure container Gamma',   'sc_gamma',   'secure', 1.00, 1, {'gridsHint': [[3, 3]]}),
    ('Secure container Kappa',   'sc_kappa',   'secure', 1.00, 1, {'gridsHint': [[4, 4]]}),

    # ---------------- backpacks ----------------
    ('Tactical sling bag (Khaki)',                 'bp_sling',   'backpack', 1.00, 1, {'gridsHint': [[4, 4]]}),
    ('VKBO army bag',                              'bp_vkbo',    'backpack', 1.20, 1, {'gridsHint': [[4, 4]]}),
    ('Transformer Bag',                            'bp_transf',  'backpack', 1.10, 1, {'gridsHint': [[4, 4]]}),
    ('Duffle bag',                                 'bp_duffle',  'backpack', 1.50, 1, {'gridsHint': [[5, 4]]}),
    ('Flyye MBSS backpack (UCP)',                  'bp_mbss',    'backpack', 1.60, 1, {'gridsHint': [[4, 5]]}),
    ('WARTECH Berkut BB-102 backpack (A-TACS FG)', 'bp_berkut',  'backpack', 1.60, 1, {'gridsHint': [[5, 5]]}),
    ("Sanitar's bag",                              'bp_sanitar', 'backpack', 2.20, 1, {'gridsHint': [[5, 5]]}),
    ('LBT-2670 Slim Field Med Pack (Black)',       'bp_lbt',     'backpack', 2.30, 1, {'gridsHint': [[5, 5]]}),
    ('Pilgrim tourist backpack',                   'bp_pilgrim', 'backpack', 3.20, 1, {'gridsHint': [[6, 6]]}),

    # ---------------- tactical rigs ----------------
    ('Scav Vest',                                 'rig_scav',      'rig', 0.60, 1, {'gridsHint': [[1, 2], [1, 2], [1, 1], [1, 1], [2, 1]]}),
    ('DIY IDEA chest rig',                        'rig_idea',      'rig', 0.70, 1, {'gridsHint': [[1, 2], [1, 2], [1, 1], [1, 1]]}),
    ('CSA chest rig (Black)',                     'rig_csa',       'rig', 0.90, 1, {'gridsHint': [[1, 2], [1, 2], [1, 2], [1, 1], [1, 1]]}),
    ('WARTECH MK3 TV-104 chest rig (MultiCam)',   'rig_wartech',   'rig', 1.00, 1, {'gridsHint': [[1, 2], [1, 2], [1, 2], [1, 1], [1, 1], [2, 1]]}),
    ('BlackRock chest rig (Gray)',                'rig_blackrock', 'rig', 1.60, 1, {'gridsHint': [[1, 3], [1, 3], [1, 2], [1, 2], [2, 2], [1, 1], [1, 1]]}),
    ('LBT-1961A Load Bearing Chest Rig (MAS Grey)','rig_lbt',      'rig', 1.10, 1, {'gridsHint': [[1, 2], [1, 2], [1, 2], [2, 1], [1, 1]]}),
    ('ANA Tactical M2 plate carrier (EMR)',       'rig_ana',       'rig', 6.00, 1, {'gridsHint': [[1, 3], [1, 3], [2, 2], [2, 2], [1, 1], [1, 1]], 'dura': 50, 'armorClass': 4}),

    # ---------------- body armor ----------------
    ('PACA Soft Armor',                                  'ar_paca',   'armor', 5.00,  1, {'dura': 50, 'armorClass': 2}),
    ('BNTI Module-3M body armor',                        'ar_module', 'armor', 6.00,  1, {'dura': 40, 'armorClass': 3}),
    ('BNTI Zhuk body armor (Press)',                     'ar_zhuk',   'armor', 9.00,  1, {'dura': 60, 'armorClass': 4}),
    ('6B13 assault armor (Flora)',                       'ar_6b13',   'armor', 8.00,  1, {'dura': 50, 'armorClass': 4}),
    ('6B23-1 body armor (EMR)',                          'ar_6b23',   'armor', 8.30,  1, {'dura': 55, 'armorClass': 4}),
    ('IOTV Gen4 body armor (Full Protection Kit, MultiCam)', 'ar_iotv', 'armor', 13.00, 1, {'dura': 80, 'armorClass': 5}),

    # ---------------- headgear ----------------
    ('SSh-68 steel helmet (Olive Drab)',              'hl_ssh68',   'helmet', 1.30, 1, {'dura': 30, 'armorClass': 2}),
    ('Kolpak-1S riot helmet',                         'hl_kolpak',  'helmet', 1.80, 1, {'dura': 30, 'armorClass': 2}),
    ('LShZ lightweight helmet (Olive Drab)',          'hl_lshz',    'helmet', 1.30, 1, {'dura': 35, 'armorClass': 3}),
    ('6B47 Ratnik-BSh helmet (EMR cover)',            'hl_6b47',    'helmet', 1.20, 1, {'dura': 40, 'armorClass': 3}),
    ('Ops-Core FAST MT Super High Cut helmet (Black)','hl_fast',    'helmet', 1.30, 1, {'dura': 45, 'armorClass': 4}),
    ('Ushanka ear flap hat',                          'hl_ushanka', 'helmet', 0.30, 1, {}),

    # ---------------- headset / eyes / face ----------------
    ('GSSh-01 active headset',            'hs_gssh',     'headset', 0.60, 1, {}),
    ('Peltor ComTac II headset (OD Green)','hs_comtac',  'headset', 0.40, 1, {}),
    ('Ops-Core FAST RAC Headset',         'hs_rac',      'headset', 0.30, 1, {}),
    ('Tactical glasses',                  'ey_tactical', 'glasses', 0.05, 1, {}),
    ('Round frame sunglasses',            'ey_round',    'glasses', 0.03, 1, {}),
    ('Balaclava',                         'fc_balaclava','facecover', 0.10, 1, {}),
    ('Shroud half-mask',                  'fc_shroud',   'facecover', 0.10, 1, {}),

    # ---------------- weapons ----------------
    ('Kalashnikov AKS-74U 5.45x39 assault rifle',      'w_aks74u', 'weapon', 2.20, 1, {'ergo': 44, 'dmg': 47, 'rpm': 650, 'cal': '5.45x39'}),
    ('Kalashnikov AK-74N 5.45x39 assault rifle',       'w_ak74n',  'weapon', 3.30, 1, {'ergo': 44, 'dmg': 47, 'rpm': 650, 'cal': '5.45x39'}),
    ('Kalashnikov AKM 7.62x39 assault rifle',          'w_akm',    'weapon', 3.40, 1, {'ergo': 42, 'dmg': 58, 'rpm': 600, 'cal': '7.62x39'}),
    ('Molot Arms VPO-136 Vepr-KM 7.62x39 carbine',     'w_vpo136', 'weapon', 3.20, 1, {'ergo': 40, 'dmg': 58, 'rpm': 600, 'cal': '7.62x39'}),
    ('PP-91 Kedr 9x18PM submachine gun',               'w_kedr',   'weapon', 1.40, 1, {'ergo': 60, 'dmg': 40, 'rpm': 900, 'cal': '9x18'}),
    ('PP-91-01 Kedr-B 9x18PM submachine gun',          'w_kedrb',  'weapon', 1.55, 1, {'ergo': 58, 'dmg': 40, 'rpm': 900, 'cal': '9x18'}),
    ('MP-153 12ga semi-automatic shotgun',             'w_mp153',  'weapon', 3.60, 1, {'ergo': 33, 'dmg': 190, 'rpm': 200, 'cal': '12/70'}),
    ('MP-133 12ga pump-action shotgun',                'w_mp133',  'weapon', 3.20, 1, {'ergo': 35, 'dmg': 190, 'rpm': 60, 'cal': '12/70'}),
    ('Saiga-12K ver.10 12ga semi-automatic shotgun',   'w_saiga',  'weapon', 3.80, 1, {'ergo': 32, 'dmg': 190, 'rpm': 200, 'cal': '12/70'}),
    ('Makarov PM 9x18PM pistol',                       'w_pm',     'pistol', 0.73, 1, {'ergo': 70, 'dmg': 40, 'rpm': 300, 'cal': '9x18'}),
    ('TT-33 7.62x25 TT pistol',                        'w_tt',     'pistol', 0.85, 1, {'ergo': 65, 'dmg': 55, 'rpm': 300, 'cal': '7.62x25'}),
    ('PB 9x18PM silenced pistol',                      'w_pb',     'pistol', 0.97, 1, {'ergo': 62, 'dmg': 40, 'rpm': 300, 'cal': '9x18'}),

    # ---------------- melee ----------------
    ('6Kh5 Bayonet', 'm_bayonet', 'melee', 0.35, 1, {'dmg': 35}),
    ('Antique axe',  'm_axe',     'melee', 1.20, 1, {'dmg': 45}),
    ('Crash Axe',    'm_crash',   'melee', 0.90, 1, {'dmg': 42}),

    # ---------------- grenades ----------------
    ('RGD-5 hand grenade',  'g_rgd5',  'grenade', 0.31, 1, {'frag': True}),
    ('F-1 hand grenade',    'g_f1',    'grenade', 0.60, 1, {'frag': True}),
    ('M67 hand grenade',    'g_m67',   'grenade', 0.40, 1, {'frag': True}),
    ('Zarya stun grenade',  'g_zarya', 'grenade', 0.28, 1, {'frag': False}),

    # ---------------- magazines ----------------
    ('AK-74 5.45x39 6L20 30-round magazine',       'mag_ak74', 'mag', 0.21, 1, {'magSize': 30, 'cal': '5.45x39'}),
    ('AK 7.62x39 6L10 bakelite 30-round magazine', 'mag_akm',  'mag', 0.33, 1, {'magSize': 30, 'cal': '7.62x39'}),
    ('PM 9x18PM 90-93 8-round magazine',           'mag_pm',   'mag', 0.08, 1, {'magSize': 8,  'cal': '9x18'}),
    ('PP-91 Kedr 9x18PM 20-round magazine',        'mag_kedr', 'mag', 0.11, 1, {'magSize': 20, 'cal': '9x18'}),

    # ---------------- ammo ----------------
    ('5.45x39mm PS gs',    'am_545ps',   'ammo', 0.011, 60, {'cal': '5.45x39', 'dmg': 40, 'pen': 26}),
    ('5.45x39mm BP gs',    'am_545bp',   'ammo', 0.012, 60, {'cal': '5.45x39', 'dmg': 45, 'pen': 37}),
    ('7.62x39mm PS gzh',   'am_762ps',   'ammo', 0.016, 60, {'cal': '7.62x39', 'dmg': 57, 'pen': 26}),
    ('7.62x39mm BP gzh',   'am_762bp',   'ammo', 0.017, 60, {'cal': '7.62x39', 'dmg': 58, 'pen': 47}),
    ('9x19mm Pst gzh',     'am_9x19pst', 'ammo', 0.010, 50, {'cal': '9x19',    'dmg': 54, 'pen': 20}),
    ('9x18mm PM PSt gzh',  'am_9x18pst', 'ammo', 0.009, 50, {'cal': '9x18',    'dmg': 50, 'pen': 12}),
    ('12/70 7mm buckshot', 'am_12buck',  'ammo', 0.055, 20, {'cal': '12/70',   'dmg': 39, 'pen': 3}),
    ('7.62x25mm TT LRN',   'am_762tt',   'ammo', 0.009, 50, {'cal': '7.62x25', 'dmg': 55, 'pen': 12}),
]
