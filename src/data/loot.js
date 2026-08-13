// =========================================================
// loot containers and their loot pools
//
// Container grid sizes and search times follow the real ones documented on
// the EFT wiki; the item pools are drawn from the 190 templates this build
// ships with.
// =========================================================

export const CONTAINERS = {
  crate:       { name: 'Wooden crate',        w: 5, h: 2, search: 3.0,  rolls: [1, 3], icon: 'box' },
  ammobox:     { name: 'Wooden ammo box',     w: 3, h: 3, search: 3.0,  rolls: [1, 3], icon: 'box' },
  suitcase:    { name: 'Plastic suitcase',    w: 3, h: 3, search: 3.0,  rolls: [1, 3], icon: 'box' },
  weaponbox:   { name: 'Weapon box',          w: 5, h: 2, search: 3.0,  rolls: [1, 2], icon: 'crosshair' },
  weaponbox6:  { name: 'Weapon box',          w: 6, h: 3, search: 4.5,  rolls: [1, 3], icon: 'crosshair' },
  medbag:      { name: 'Medbag SMU06',        w: 4, h: 3, search: 3.5,  rolls: [1, 3], icon: 'health' },
  medcase:     { name: 'Medcase',             w: 4, h: 4, search: 4.0,  rolls: [2, 4], icon: 'health' },
  medcrate:    { name: 'Medical supply crate',w: 5, h: 5, search: 5.0,  rolls: [2, 5], icon: 'health' },
  toolbox:     { name: 'Toolbox',             w: 4, h: 3, search: 3.5,  rolls: [1, 3], icon: 'box' },
  jacket:      { name: 'Jacket',              w: 2, h: 2, search: 2.0,  rolls: [1, 2], icon: 'box' },
  sportbag:    { name: 'Sports bag',          w: 4, h: 3, search: 3.5,  rolls: [1, 3], icon: 'box' },
  duffle:      { name: 'Duffle bag',          w: 4, h: 3, search: 3.5,  rolls: [1, 3], icon: 'box' },
  grenadebox:  { name: 'Grenade box',         w: 2, h: 3, search: 2.5,  rolls: [1, 2], icon: 'box' },
  rationcrate: { name: 'Ration supply crate', w: 5, h: 5, search: 5.0,  rolls: [2, 5], icon: 'box' },
  pcblock:     { name: 'PC block',            w: 4, h: 4, search: 4.0,  rolls: [1, 3], icon: 'box' },
  safe:        { name: 'Safe',                w: 3, h: 3, search: 3.0,  rolls: [1, 3], icon: 'stash' },
  banksafe:    { name: 'Bank safe',           w: 4, h: 4, search: 4.0,  rolls: [2, 4], icon: 'stash' },
  cashreg:     { name: 'Cash register',       w: 1, h: 2, search: 1.5,  rolls: [1, 1], icon: 'cash' },
  drawer:      { name: 'Drawer',              w: 2, h: 2, search: 2.0,  rolls: [1, 1], icon: 'stash' },
  filecab:     { name: 'Filing cabinet',      w: 2, h: 2, search: 2.0,  rolls: [1, 2], icon: 'stash' },
  techcrate:   { name: 'Technical supply crate', w: 5, h: 5, search: 5.0, rolls: [2, 4], icon: 'box' },
  deadscav:    { name: 'Dead Scav',           w: 4, h: 4, search: 4.5,  rolls: [2, 4], icon: 'body' },
  pmcbody:     { name: 'Dead PMC',            w: 4, h: 4, search: 4.5,  rolls: [2, 5], icon: 'body' },
};

// ---------------------------------------------------------
// item pools — [itemKey, weight, [minStack, maxStack]?]
// ---------------------------------------------------------
const P = {
  junk: [
    ['ducttape', 10], ['insultape', 10], ['bolts', 12], ['nuts', 12], ['nails', 8], ['screws', 8],
    ['hose', 7], ['wrench', 7], ['pliers', 5], ['wd40', 6], ['bleach', 6], ['ripstop', 6],
    ['paracord', 5], ['fleece', 6], ['aabat', 9], ['dbat', 7], ['caps', 8], ['powercord', 7],
    ['wirebundle', 8], ['pcb', 6], ['hddbroken', 5], ['gphone', 4], ['apollo', 7], ['strike', 7],
    ['malboro', 7], ['wilston', 4],
  ],
  tools: [
    ['toolset', 6], ['drill', 4], ['edrill', 4], ['wrench', 10], ['pliers', 9], ['wd40', 10],
    ['ducttape', 12], ['insultape', 12], ['bolts', 12], ['nuts', 12], ['nails', 9], ['screws', 9],
    ['hose', 7], ['ripstop', 5], ['paracord', 5],
  ],
  electronics: [
    ['pcb', 10], ['caps', 10], ['powercord', 9], ['wirebundle', 9], ['hddbroken', 8], ['gphone', 7],
    ['lcd', 6], ['gasan', 5], ['rechbat', 5], ['greenbat', 4], ['emotor', 3], ['carbat', 2],
    ['milboard', 3], ['milfilter', 3], ['rfid', 3], ['virtex', 2], ['gpu', 2], ['cofdm', 1],
    ['phased', 1], ['ffgps', 1], ['advconv', 1], ['cyclon', 1], ['sten140', 1], ['tetriz', 2],
  ],
  valuables: [
    ['skullring', 8], ['goldchain', 8], ['prokill', 6], ['rolex', 5], ['goldphone', 4],
    ['goldegg', 4], ['rooster', 3], ['horse', 5], ['cat', 5], ['raven', 4], ['teapot', 5],
    ['vase', 4], ['lion', 2], ['ledx', 1], ['bitcoin', 1],
  ],
  meds_low: [
    ['bandage', 12], ['armyband', 10], ['analgin', 9], ['ibuprofen', 7], ['splint', 8],
    ['alusplint', 6], ['esmarch', 8], ['calok', 7], ['ai2', 10], ['vaseline', 5], ['goldstar', 5],
  ],
  meds_mid: [
    ['car', 10], ['ifak', 7], ['salewa', 6], ['afak', 4], ['morphine', 5], ['propital', 4],
    ['zagustin', 4], ['adrenal', 4], ['cms', 4],
  ],
  meds_high: [['grizzly', 3], ['surv12', 2], ['afak', 4], ['salewa', 6]],
  food: [
    ['iskra', 5], ['mre', 5], ['stewL', 8], ['stewS', 9], ['milk', 7], ['emelya', 10],
    ['alyonka', 8], ['oatflakes', 7],
  ],
  drink: [['water', 10], ['vodka', 5], ['beer', 7], ['hotrod', 6], ['vita', 8], ['pineapple', 8]],
  ammo: [
    ['am_545ps', 10, [20, 60]], ['am_545bp', 4, [15, 40]], ['am_762ps', 9, [20, 60]],
    ['am_762bp', 4, [15, 40]], ['am_9x19pst', 9, [20, 50]], ['am_9x18pst', 10, [20, 50]],
    ['am_12buck', 8, [8, 20]], ['am_762tt', 8, [20, 50]],
  ],
  mags: [['mag_ak74', 8], ['mag_akm', 7], ['mag_pm', 8], ['mag_kedr', 6]],
  weapons_low: [['w_pm', 8], ['w_tt', 7], ['w_kedr', 5], ['w_mp133', 6], ['w_vpo136', 4]],
  weapons_mid: [
    ['w_aks74u', 5], ['w_akm', 3], ['w_ak74n', 3], ['w_saiga', 2], ['w_kedrb', 3],
    ['w_mp153', 3], ['w_pb', 2],
  ],
  grenades: [['g_rgd5', 10], ['g_f1', 8], ['g_m67', 6], ['g_zarya', 9]],
  keys: [
    ['k_bunk', 8], ['k_machine', 8], ['k_pump', 6], ['k_gasstore', 5], ['k_gasoffice', 5],
    ['k_gassafe', 5], ['k_factexit', 3], ['k_marked', 1],
  ],
  info: [['flashdrive', 5], ['intel', 4], ['diary', 4], ['factorymap', 6]],
  money: [['rub', 14, [2000, 30000]], ['usd', 4, [50, 400]], ['eur', 3, [40, 300]]],
  gear_armor: [['ar_paca', 8], ['ar_module', 7], ['ar_zhuk', 5], ['ar_6b13', 4], ['ar_6b23', 3], ['ar_iotv', 1]],
  gear_helmet: [['hl_ushanka', 8], ['hl_ssh68', 7], ['hl_kolpak', 6], ['hl_lshz', 5], ['hl_6b47', 4], ['hl_fast', 2]],
  gear_rig: [['rig_scav', 9], ['rig_idea', 7], ['rig_csa', 6], ['rig_wartech', 4], ['rig_lbt', 3], ['rig_blackrock', 3], ['rig_ana', 1]],
  gear_backpack: [['bp_sling', 8], ['bp_vkbo', 7], ['bp_transf', 6], ['bp_duffle', 5], ['bp_mbss', 4], ['bp_berkut', 3], ['bp_sanitar', 2], ['bp_lbt', 2], ['bp_pilgrim', 1]],
  gear_misc: [['hs_gssh', 6], ['hs_comtac', 3], ['hs_rac', 2], ['ey_tactical', 8], ['ey_round', 7], ['fc_balaclava', 8], ['fc_shroud', 2]],
  cases: [['wallet', 8], ['docscase', 4], ['injcase', 3], ['ammocase', 2], ['magcase', 2], ['medcase', 2], ['moneycase', 1], ['itemcase', 1], ['grenadecase', 1], ['junkbox', 1]],
  melee: [['m_bayonet', 6], ['m_axe', 2], ['m_crash', 1]],
};

/** container type -> weighted list of pools */
export const LOOT_TABLES = {
  crate:       [[P.junk, 26], [P.ammo, 16], [P.meds_low, 12], [P.grenades, 8], [P.mags, 10], [P.tools, 12], [P.electronics, 8], [P.weapons_low, 4], [P.money, 4]],
  ammobox:     [[P.ammo, 80], [P.mags, 20]],
  suitcase:    [[P.junk, 30], [P.food, 22], [P.drink, 14], [P.valuables, 10], [P.info, 8], [P.money, 10], [P.electronics, 6]],
  weaponbox:   [[P.weapons_low, 26], [P.weapons_mid, 12], [P.mags, 26], [P.ammo, 22], [P.grenades, 8], [P.meds_low, 6]],
  weaponbox6:  [[P.weapons_mid, 24], [P.weapons_low, 20], [P.mags, 24], [P.ammo, 20], [P.grenades, 12]],
  medbag:      [[P.meds_low, 58], [P.meds_mid, 34], [P.meds_high, 8]],
  medcase:     [[P.meds_low, 44], [P.meds_mid, 44], [P.meds_high, 12]],
  medcrate:    [[P.meds_mid, 46], [P.meds_high, 24], [P.meds_low, 30]],
  toolbox:     [[P.tools, 66], [P.junk, 24], [P.electronics, 10]],
  jacket:      [[P.junk, 30], [P.money, 24], [P.keys, 16], [P.valuables, 10], [P.food, 12], [P.meds_low, 8]],
  sportbag:    [[P.junk, 26], [P.food, 20], [P.drink, 12], [P.meds_low, 16], [P.valuables, 10], [P.money, 8], [P.gear_misc, 8]],
  duffle:      [[P.junk, 24], [P.food, 16], [P.meds_low, 16], [P.mags, 12], [P.ammo, 12], [P.gear_misc, 10], [P.money, 10]],
  grenadebox:  [[P.grenades, 100]],
  rationcrate: [[P.food, 58], [P.drink, 42]],
  pcblock:     [[P.electronics, 82], [P.info, 12], [P.valuables, 6]],
  safe:        [[P.money, 40], [P.valuables, 26], [P.info, 18], [P.keys, 16]],
  banksafe:    [[P.money, 56], [P.valuables, 26], [P.info, 18]],
  cashreg:     [[P.money, 100]],
  drawer:      [[P.keys, 26], [P.money, 24], [P.info, 16], [P.junk, 22], [P.meds_low, 12]],
  filecab:     [[P.info, 34], [P.keys, 26], [P.money, 22], [P.junk, 18]],
  techcrate:   [[P.electronics, 54], [P.tools, 32], [P.junk, 14]],
  deadscav:    [[P.junk, 22], [P.ammo, 16], [P.meds_low, 16], [P.food, 12], [P.mags, 12], [P.money, 10], [P.gear_misc, 6], [P.valuables, 6]],
  pmcbody:     [[P.mags, 20], [P.ammo, 18], [P.meds_mid, 16], [P.gear_misc, 12], [P.money, 12], [P.valuables, 10], [P.cases, 6], [P.grenades, 6]],
};

/** rarity of an item spawning at all, per container roll */
export const EMPTY_CHANCE = {
  jacket: 0.28, drawer: 0.35, cashreg: 0.2, crate: 0.15, safe: 0.1, filecab: 0.3,
};

export function poolsFor(type) { return LOOT_TABLES[type] || LOOT_TABLES.crate; }
export const POOLS = P;
