# =========================================================
# item keys for ESCAPE 2D
#
# Every item of the live game is in the database, keyed by its 24-hex tarkov
# id (tools/build_items.py). The items the game shipped with before that carry
# a slug as well - `salewa`, `w_akm`, `rub` - and saves, loot tables, trader
# assortments and tests refer to them by it, so those slugs are frozen here:
#
#   ALIASES    the curated items, one row each: (tarkov id, slug)
#   part_keys.json (beside this file)
#              the 789 parts, magazines, cartridges and ammo packs the first
#              weapon expansion generated for the twelve guns below, id -> slug
#
# Nothing else is typed in by hand any more: category, footprint, weight,
# stack size, price, armour, medical effects and container layouts all come
# out of the templates. A slug is only an alias - getTpl() resolves the id
# too - and a template that has one is marked `core` in the database, which
# is what the curated loot pools and trader rules are restricted to.
# =========================================================

ALIASES = [
    # ---------------- money ----------------
    ('5449016a4bdc2d6f028b456f', 'rub'),             # Roubles
    ('5696686a4bdc2da3298b456a', 'usd'),             # Dollars
    ('569668774bdc2da2298b4568', 'eur'),             # Euros
    # ---------------- medical ----------------
    ('544fb45d4bdc2dee738b4568', 'salewa'),          # Salewa first aid kit
    ('590c678286f77426c9660122', 'ifak'),            # IFAK individual first aid kit
    ('590c661e86f7741e566b646a', 'car'),             # Car first aid kit
    ('590c657e86f77412b013051d', 'grizzly'),         # Grizzly medical kit
    ('5755356824597772cb798962', 'ai2'),             # AI-2 medkit
    ('60098ad7c2240c0fe85c570a', 'afak'),            # AFAK tactical individual first aid kit
    ('544fb25a4bdc2dfb738b4567', 'bandage'),         # Aseptic bandage
    ('5751a25924597722c463c472', 'armyband'),        # Army bandage
    ('544fb37f4bdc2dee738b4567', 'analgin'),         # Analgin painkillers
    ('5af0548586f7743a532b7e99', 'ibuprofen'),       # Ibuprofen painkillers
    ('544fb3f34bdc2d03748b456a', 'morphine'),        # Morphine injector
    ('544fb3364bdc2d34748b456a', 'splint'),          # Immobilizing splint
    ('5af0454c86f7746bf20992e8', 'alusplint'),       # Aluminum splint
    ('5d02778e86f774203e7dedbe', 'cms'),             # CMS surgical kit
    ('5d02797c86f774203f38e30a', 'surv12'),          # Surv12 field surgical kit
    ('5e831507ea0a7c419c2f9bd9', 'esmarch'),         # Esmarch tourniquet
    ('5e8488fa988a8701445df1e4', 'calok'),           # CALOK-B hemostatic applicator
    ('5c0e530286f7747fa1419862', 'propital'),        # Propital regenerative stimulant injector
    ('5c0e533786f7747fa23f4d47', 'zagustin'),        # Zagustin hemostatic drug injector
    ('5c10c8fd86f7743d7d706df3', 'adrenal'),         # Adrenaline injector
    ('5755383e24597772cb798966', 'vaseline'),        # Vaseline balm
    ('5751a89d24597722aa0e8db0', 'goldstar'),        # Golden Star balm
    # ---------------- provisions ----------------
    ('590c5d4b86f774784e1b9c45', 'iskra'),           # Iskra ration pack
    ('590c5f0d86f77413997acfab', 'mre'),             # MRE ration pack
    ('57347da92459774491567cf5', 'stewL'),           # Can of beef stew (Large)
    ('57347d7224597744596b4e72', 'stewS'),           # Can of beef stew (Small)
    ('5734773724597737fd047c14', 'milk'),            # Can of condensed milk
    ('5751487e245977207e26a315', 'emelya'),          # Emelya rye croutons
    ('57505f6224597709a92585a9', 'alyonka'),         # Alyonka chocolate bar
    ('57347d90245977448f7b7f65', 'oatflakes'),       # Pack of oat flakes
    ('5448fee04bdc2dbc018b4567', 'water'),           # Bottle of water (0.6L)
    ('5d40407c86f774318526545a', 'vodka'),           # Bottle of Tarkovskaya vodka
    ('62a09f32621468534a797acb', 'beer'),            # Bottle of Pevko Light beer
    ('5751496424597720a27126da', 'hotrod'),          # Can of Hot Rod energy drink
    ('573475fb24597737fb1379e1', 'apollo'),          # Apollo Soyuz cigarettes
    ('5734770f24597738025ee254', 'strike'),          # Strike Cigarettes
    ('573476d324597737da2adc13', 'malboro'),         # Malboro Cigarettes
    ('573476f124597737e04bf328', 'wilston'),         # Wilston cigarettes
    ('57513fcc24597720a31c09a6', 'vita'),            # Pack of Vita juice
    ('544fb62a4bdc2dfb738b4568', 'pineapple'),       # Pack of Russian Army pineapple juice
    # ---------------- household / tools ----------------
    ('57347c1124597737fb1379e3', 'ducttape'),        # Duct tape
    ('5734795124597738002c6176', 'insultape'),       # Insulating tape
    ('57347c5b245977448d35f6e1', 'bolts'),           # Bolts
    ('57347c77245977448d35f6e2', 'nuts'),            # Screw nuts
    ('59e35cbb86f7741778269d83', 'hose'),            # Corrugated hose
    ('590c2e1186f77425357b6124', 'toolset'),         # Toolset
    ('590c311186f77424d1667482', 'wrench'),          # Wrench
    ('5af04b6486f774195a3ebb49', 'pliers'),          # Pliers Elite
    ('5d1b317c86f7742523398392', 'drill'),           # Hand drill
    ('590c5bbd86f774785762df04', 'wd40'),            # WD-40 (100ml)
    ('59e3556c86f7741776641ac2', 'bleach'),          # Ox bleach
    ('5e2af4a786f7746d3f3c3400', 'ripstop'),         # Ripstop fabric
    ('5c12688486f77426843c7d32', 'paracord'),        # Paracord
    ('5e2af47786f7746d404f3aaa', 'fleece'),          # Fleece fabric
    ('590c31c586f774245e3141b2', 'nails'),           # Pack of nails
    ('59e35ef086f7741777737012', 'screws'),          # Pack of screws
    ('59e35de086f7741778269d84', 'edrill'),          # Electric drill
    # ---------------- electronics ----------------
    ('590a3b0486f7743954552bdb', 'pcb'),             # Printed circuit board
    ('5c1265fc86f7743f896a21c2', 'gphone'),          # Broken GPhone X smartphone
    ('5d1b304286f774253763a528', 'lcd'),             # Working LCD
    ('590a386e86f77429692b27ab', 'hddbroken'),       # Damaged hard drive
    ('590a3efd86f77437d351a25b', 'gasan'),           # Gas analyzer
    ('5c06782b86f77426df5407d2', 'caps'),            # Capacitors
    ('59e36c6f86f774176c10a2a7', 'powercord'),       # Power cord
    ('5c06779c86f77426e00dd782', 'wirebundle'),      # Bundle of wires
    ('57347ca924597744596b4e71', 'gpu'),             # Graphics card
    ('5c12620d86f7743f8b198b72', 'tetriz'),          # Tetriz portable game console
    ('5c05308086f7746b2101e90b', 'virtex'),          # Virtex programmable processor
    ('5c052f6886f7746b1e3db148', 'cofdm'),           # Military COFDM Wireless Signal Transmitter
    ('5d0376a486f7747d8050965c', 'milboard'),        # Military circuit board
    ('5d0378d486f77420421a5ff4', 'milfilter'),       # Military power filter
    ('5d03775b86f774203e7e0c4b', 'phased'),          # Phased array element
    ('5c052fb986f7746b2101e909', 'rfid'),            # UHF RFID Reader
    ('6389c7f115805221fb410466', 'ffgps'),           # Far-forward GPS Signal Amplifier Unit
    ('6389c85357baa773a825b356', 'advconv'),         # Advanced current converter
    ('5e2aee0a86f774755a234b62', 'cyclon'),          # Cyclon rechargeable battery
    ('5d03794386f77420415576f5', 'sten140'),         # 6-STEN-140-M military battery
    ('5733279d245977289b77ec24', 'carbat'),          # Car battery
    ('5d1b2fa286f77425227d1674', 'emotor'),          # Electric motor
    ('590a358486f77429692b2790', 'rechbat'),         # Rechargeable battery
    ('5672cb124bdc2d1a0f8b4568', 'aabat'),           # AA Battery
    ('5672cb304bdc2dc2088b456a', 'dbat'),            # D Size battery
    ('5e2aedd986f7746d404f3aa4', 'greenbat'),        # GreenBat lithium battery
    # ---------------- valuables ----------------
    ('5c0530ee86f774697952d952', 'ledx'),            # LEDX Skin Transilluminator
    ('59faff1d86f7746c51718c9c', 'bitcoin'),         # Physical Bitcoin
    ('5d235a5986f77443f6329bc6', 'skullring'),       # Gold skull ring
    ('5734758f24597738025ee253', 'goldchain'),       # Golden neck chain
    ('5bc9bc53d4351e00367fbcee', 'rooster'),         # Golden rooster figurine
    ('62a09cfe4f842e1bd12da3e4', 'goldegg'),         # Golden egg
    ('5bc9b720d4351e450201234b', 'goldphone'),       # Golden 1GPhone smartphone
    ('59faf7ca86f7740dbe19f6c2', 'rolex'),           # Roler Submariner gold wrist watch
    ('59e3639286f7741777737013', 'lion'),            # Bronze lion figurine
    ('573478bc24597738002c6175', 'horse'),           # Horse figurine
    ('59e3658a86f7741776641ac4', 'cat'),             # Cat figurine
    ('5e54f62086f774219b0f1937', 'raven'),           # Raven figurine
    ('5c1267ee86f77416ec610f72', 'prokill'),         # Chain with Prokill medallion
    ('590de71386f774347051a052', 'teapot'),          # Antique teapot
    ('590de7e986f7741b096e5f32', 'vase'),            # Antique vase
    # ---------------- intel ----------------
    ('590c621186f774138d11ea29', 'flashdrive'),      # Secure Flash drive
    ('5c12613b86f7743bbe2c3f76', 'intel'),           # Intelligence folder
    ('590c651286f7741e566b6461', 'diary'),           # Slim diary
    ('574eb85c245977648157eec3', 'factorymap'),      # Factory plan map
    # ---------------- keys ----------------
    ('5448ba0b4bdc2d02308b456c', 'k_factexit'),      # Factory emergency exit key
    ('66acd6702b17692df20144c0', 'k_terragroup'),    # TerraGroup storage room keycard
    ('63a3a93f8a56922e82001f5d', 'k_marked'),        # Abandoned factory marked key
    ('593858c486f774253a24cb52', 'k_pump'),          # Pumping station back door key
    ('5938144586f77473c2087145', 'k_bunk'),          # Portable bunkhouse key
    ('5937ee6486f77408994ba448', 'k_machine'),       # Machinery key
    ('5913877a86f774432f15d444', 'k_gasstore'),      # Gas station storage room key
    ('5780d0652459777df90dcb74', 'k_gasoffice'),     # Gas station office key
    ('5a0f045e86f7745b0f0d0e42', 'k_gassafe'),       # Gas station safe key
    # ---------------- cases ----------------
    ('590c60fc86f77412b13fddcf', 'docscase'),        # Documents case
    ('59fb016586f7746d0d4b423a', 'moneycase'),       # Money case
    ('5b7c710788a4506dec015957', 'junkbox'),         # Lucky Scav Junk box
    ('59fb042886f7746c5005a7b2', 'itemcase'),        # Item case
    ('5aafbcd986f7745e590fff23', 'medcase'),         # Medicine case
    ('5c127c4486f7745625356c13', 'magcase'),         # Magazine case
    ('5aafbde786f774389d0cbc0f', 'ammocase'),        # Ammunition case
    ('5e2af55f86f7746d4159f07c', 'grenadecase'),     # Grenade case
    ('619cbf7d23893217ec30b689', 'injcase'),         # Injector case
    ('5783c43d2459774bbe137486', 'wallet'),          # Simple wallet
    # ---------------- secure containers ----------------
    ('544a11ac4bdc2d470e8b456a', 'sc_alpha'),        # Secure container Alpha
    ('5857a8b324597729ab0a0e7d', 'sc_beta'),         # Secure container Beta
    ('59db794186f77448bc595262', 'sc_epsilon'),      # Secure container Epsilon
    ('5857a8bc2459772bad15db29', 'sc_gamma'),        # Secure container Gamma
    ('5c093ca986f7740a1867ab12', 'sc_kappa'),        # Secure container Kappa
    # ---------------- backpacks ----------------
    ('5ab8f04f86f774585f4237d8', 'bp_sling'),        # Tactical sling bag (Khaki)
    ('5ab8ee7786f7742d8f33f0b9', 'bp_vkbo'),         # VKBO army bag
    ('56e33680d2720be2748b4576', 'bp_transf'),       # Transformer Bag
    ('56e33634d2720bd8058b456b', 'bp_duffle'),       # Duffle bag
    ('544a5cde4bdc2d39388b456b', 'bp_mbss'),         # Flyye MBSS backpack (UCP)
    ('5ca20d5986f774331e7c9602', 'bp_berkut'),       # WARTECH Berkut BB-102 backpack (A-TACS FG)
    ('5e997f0b86f7741ac73993e2', 'bp_sanitar'),      # Sanitar's bag
    ('5e4abc6786f77406812bd572', 'bp_lbt'),          # LBT-2670 Slim Field Med Pack (Black)
    ('59e763f286f7742ee57895da', 'bp_pilgrim'),      # Pilgrim tourist backpack
    # ---------------- tactical rigs ----------------
    ('572b7adb24597762ae139821', 'rig_scav'),        # Scav Vest
    ('5fd4c4fa16cac650092f6771', 'rig_idea'),        # DIY IDEA chest rig
    ('6034d0230ca681766b6a0fb5', 'rig_csa'),         # CSA chest rig (Black)
    ('5ab8dab586f77441cd04f2a2', 'rig_wartech'),     # WARTECH MK3 TV-104 chest rig (MultiCam)
    ('5648a69d4bdc2ded0b8b457b', 'rig_blackrock'),   # BlackRock chest rig (Gray)
    ('5e9db13186f7742f845ee9d3', 'rig_lbt'),         # LBT-1961A Load Bearing Chest Rig (MAS Grey)
    ('5ab8dced86f774646209ec87', 'rig_ana'),         # ANA Tactical M2 plate carrier (EMR)
    # ---------------- body armor ----------------
    ('5648a7494bdc2d9d488b4583', 'ar_paca'),         # PACA Soft Armor
    ('59e7635f86f7742cbf2c1095', 'ar_module'),       # BNTI Module-3M body armor
    ('5c0e5edb86f77461f55ed1f7', 'ar_zhuk'),         # BNTI Zhuk body armor (Press)
    ('5c0e51be86f774598e797894', 'ar_6b13'),         # 6B13 assault armor (Flora)
    ('5c0e5bab86f77461f55ed1f3', 'ar_6b23'),         # 6B23-1 body armor (EMR)
    ('5b44cd8b86f774503d30cba2', 'ar_iotv'),         # IOTV Gen4 body armor (Full Protection Kit, MultiCam)
    # ---------------- headgear ----------------
    ('5c06c6a80db834001b735491', 'hl_ssh68'),        # SSh-68 steel helmet (Olive Drab)
    ('59e7711e86f7746cae05fbe1', 'hl_kolpak'),       # Kolpak-1S riot helmet
    ('5b432d215acfc4771e1c6624', 'hl_lshz'),         # LShZ lightweight helmet (Olive Drab)
    ('5aa7cfc0e5b5b00015693143', 'hl_6b47'),         # 6B47 Ratnik-BSh helmet (EMR cover)
    ('5a154d5cfcdbcb001a3b00da', 'hl_fast'),         # Ops-Core FAST MT Super High Cut helmet (Black)
    ('59e7708286f7742cbd762753', 'hl_ushanka'),      # Ushanka ear flap hat
    # ---------------- headset / eyes / face ----------------
    ('5b432b965acfc47a8774094e', 'hs_gssh'),         # GSSh-01 active headset
    ('5645bcc04bdc2d363b8b4572', 'hs_comtac'),       # Peltor ComTac II headset (OD Green)
    ('5a16b9fffcdbcb0176308b34', 'hs_rac'),          # Ops-Core FAST RAC Headset
    ('557ff21e4bdc2d89578b4586', 'ey_tactical'),     # Tactical glasses
    ('5aa2b923e5b5b000137b7589', 'ey_round'),        # Round frame sunglasses
    ('572b7f1624597762ae139822', 'fc_balaclava'),    # Balaclava
    ('5e54f76986f7740366043752', 'fc_shroud'),       # Shroud half-mask
    # ---------------- weapons ----------------
    ('57dc2fa62459775949412633', 'w_aks74u'),        # Kalashnikov AKS-74U 5.45x39 assault rifle
    ('5644bd2b4bdc2d3b4c8b4572', 'w_ak74n'),         # Kalashnikov AK-74N 5.45x39 assault rifle
    ('59d6088586f774275f37482f', 'w_akm'),           # Kalashnikov AKM 7.62x39 assault rifle
    ('59e6152586f77473dc057aa1', 'w_vpo136'),        # Molot Arms VPO-136 Vepr-KM 7.62x39 carbine
    ('57d14d2524597714373db789', 'w_kedr'),          # PP-91 Kedr 9x18PM submachine gun
    ('57f3c6bd24597738e730fa2f', 'w_kedrb'),         # PP-91-01 Kedr-B 9x18PM submachine gun
    ('56dee2bdd2720bc8328b4567', 'w_mp153'),         # MP-153 12ga semi-automatic shotgun
    ('54491c4f4bdc2db1078b4568', 'w_mp133'),         # MP-133 12ga pump-action shotgun
    ('576165642459773c7a400233', 'w_saiga'),         # Saiga-12K ver.10 12ga semi-automatic shotgun
    ('5448bd6b4bdc2dfc2f8b4569', 'w_pm'),            # Makarov PM 9x18PM pistol
    ('571a12c42459771f627b58a0', 'w_tt'),            # TT-33 7.62x25 TT pistol
    ('56e0598dd2720bb5668b45a6', 'w_pb'),            # PB 9x18PM silenced pistol
    # ---------------- melee ----------------
    ('5bffdc370db834001d23eca8', 'm_bayonet'),       # 6Kh5 Bayonet
    ('5bc9c1e2d4351e00367fbcf0', 'm_axe'),           # Antique axe
    ('5bffe7930db834001b734a39', 'm_crash'),         # Crash Axe
    # ---------------- grenades ----------------
    ('5448be9a4bdc2dfd2f8b456a', 'g_rgd5'),          # RGD-5 hand grenade
    ('5710c24ad2720bc3458b45a3', 'g_f1'),            # F-1 hand grenade
    ('58d3db5386f77426186285a0', 'g_m67'),           # M67 hand grenade
    ('5a0c27731526d80618476ac4', 'g_zarya'),         # Zarya stun grenade
    # ---------------- magazines ----------------
    ('564ca99c4bdc2d16268b4589', 'mag_ak74'),        # AK-74 5.45x39 6L20 30-round magazine
    ('5a01c29586f77474660c694c', 'mag_akm'),         # AK 7.62x39 6L10 bakelite 30-round magazine
    ('5448c12b4bdc2d02308b456f', 'mag_pm'),          # PM 9x18PM 90-93 8-round magazine
    ('57d14e1724597714010c3f4b', 'mag_kedr'),        # PP-91 Kedr 9x18PM 20-round magazine
    # ---------------- ammo ----------------
    ('56dff3afd2720bba668b4567', 'am_545ps'),        # 5.45x39mm PS gs
    ('56dfef82d2720bbd668b4567', 'am_545bp'),        # 5.45x39mm BP gs
    ('5656d7c34bdc2d9d198b4587', 'am_762ps'),        # 7.62x39mm PS gzh
    ('59e0d99486f7744a32234762', 'am_762bp'),        # 7.62x39mm BP gzh
    ('56d59d3ad2720bdb418b4577', 'am_9x19pst'),      # 9x19mm Pst gzh
    ('5737201124597760fc4431f1', 'am_9x18pst'),      # 9x18mm PM Pst gzh
    ('560d5e524bdc2d25448b4571', 'am_12buck'),       # 12/70 7mm buckshot
    ('573601b42459776410737435', 'am_762tt'),        # 7.62x25mm TT LRN
    # ---------------- what rides along with the weapons ----------------
    ('5910968f86f77425cf569c32', 'weaprepkit'),      # Weapon repair kit
    ('59fb023c86f7746d0d4b423c', 'weaponcase'),      # Weapon case
    ('5b6d9ce188a4501afc1b2b25', 'thiccweaponcase'),  # T H I C C Weapon case
]
