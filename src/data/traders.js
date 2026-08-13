// =========================================================
// traders
//
// buyMult values are the real trader buy-back multipliers documented on the
// wiki (payout = basePrice * multiplier * stack). Category gating means most
// items only have two or three legal buyers, so picking the right trader
// matters exactly as it does in the game.
// =========================================================

/**
 * Loyalty gates work like the real game: PMC level, reputation AND total money
 * spent with the trader all have to pass before the next tier unlocks.
 */
export const LOYALTY_LEVELS = [
  { level: 1, pmc: 1,  rep: 0,   spent: 0 },
  { level: 2, pmc: 6,  rep: 0.6, spent: 500000 },
  { level: 3, pmc: 18, rep: 2.1, spent: 2200000 },
  { level: 4, pmc: 35, rep: 5.8, spent: 8000000 },
];

export const TRADERS = [
  {
    id: 'prapor',
    name: 'PRAPOR',
    tag: 'Ex-warrant officer · surplus arms',
    currency: 'RUB',
    buyMult: 0.40,
    buys: ['weapon', 'pistol', 'mag', 'ammo', 'grenade', 'armor', 'meds', 'barter', 'key'],
    assort: [
      { key: 'w_vpo136', ll: 1, stock: 3 }, { key: 'w_aks74u', ll: 1, stock: 2 },
      { key: 'w_akm', ll: 2, stock: 2 }, { key: 'w_ak74n', ll: 2, stock: 2 },
      { key: 'mag_ak74', ll: 1, stock: 12 }, { key: 'mag_akm', ll: 1, stock: 12 },
      { key: 'am_545ps', ll: 1, stock: 600 }, { key: 'am_762ps', ll: 1, stock: 600 },
      { key: 'am_545bp', ll: 3, stock: 240 }, { key: 'am_762bp', ll: 3, stock: 240 },
      { key: 'g_rgd5', ll: 1, stock: 8 }, { key: 'g_f1', ll: 2, stock: 6 },
      { key: 'g_zarya', ll: 1, stock: 8 },
      { key: 'ar_paca', ll: 1, stock: 3 }, { key: 'ar_module', ll: 1, stock: 3 },
      { key: 'ar_6b13', ll: 3, stock: 2 },
      { key: 'hl_ssh68', ll: 1, stock: 4 }, { key: 'hl_kolpak', ll: 1, stock: 4 },
      { key: 'm_bayonet', ll: 1, stock: 5 },
    ],
  },
  {
    id: 'therapist',
    name: 'THERAPIST',
    tag: 'Head of the health resort clinic',
    currency: 'RUB',
    buyMult: 0.51,
    buys: ['meds', 'food', 'drink', 'info', 'barter', 'container'],
    assort: [
      { key: 'bandage', ll: 1, stock: 20 }, { key: 'armyband', ll: 1, stock: 16 },
      { key: 'analgin', ll: 1, stock: 12 }, { key: 'ibuprofen', ll: 2, stock: 10 },
      { key: 'splint', ll: 1, stock: 12 }, { key: 'esmarch', ll: 1, stock: 14 },
      { key: 'calok', ll: 2, stock: 10 }, { key: 'ai2', ll: 1, stock: 14 },
      { key: 'car', ll: 1, stock: 10 }, { key: 'ifak', ll: 2, stock: 8 },
      { key: 'salewa', ll: 2, stock: 8 }, { key: 'afak', ll: 3, stock: 5 },
      { key: 'grizzly', ll: 3, stock: 3 }, { key: 'surv12', ll: 4, stock: 2 },
      { key: 'morphine', ll: 2, stock: 6 }, { key: 'propital', ll: 3, stock: 5 },
      { key: 'water', ll: 1, stock: 16 }, { key: 'emelya', ll: 1, stock: 16 },
      { key: 'stewS', ll: 1, stock: 12 }, { key: 'iskra', ll: 2, stock: 8 },
      { key: 'mre', ll: 2, stock: 8 }, { key: 'hotrod', ll: 3, stock: 6 },
      { key: 'docscase', ll: 2, stock: 2 }, { key: 'medcase', ll: 3, stock: 1 },
      { key: 'moneycase', ll: 3, stock: 1 }, { key: 'itemcase', ll: 4, stock: 1 },
      { key: 'junkbox', ll: 4, stock: 1 }, { key: 'wallet', ll: 1, stock: 3 },
      { key: 'factorymap', ll: 1, stock: 5 },
    ],
  },
  {
    id: 'skier',
    name: 'SKIER',
    tag: 'Smuggler · the source of euros',
    currency: 'RUB',
    buyMult: 0.39,
    buys: ['rig', 'weapon', 'pistol', 'mag', 'ammo', 'grenade', 'electronics', 'valuables', 'barter'],
    assort: [
      { key: 'w_tt', ll: 1, stock: 5 },
      // his smuggled European stock is priced in the euros he sells
      { key: 'w_pb', ll: 3, stock: 2, cur: 'EUR' },
      { key: 'w_saiga', ll: 3, stock: 2, cur: 'EUR' }, { key: 'w_mp153', ll: 2, stock: 3 },
      { key: 'am_762tt', ll: 1, stock: 400 },
      { key: 'am_12buck', ll: 1, stock: 200 },
      { key: 'mag_pm', ll: 1, stock: 10 },
      { key: 'ammocase', ll: 3, stock: 1, cur: 'EUR' }, { key: 'magcase', ll: 3, stock: 1, cur: 'EUR' },
      { key: 'rig_csa', ll: 1, stock: 4 }, { key: 'rig_wartech', ll: 2, stock: 3 },
      { key: 'eur', ll: 1, stock: 40000 },
    ],
  },
  {
    id: 'peacekeeper',
    name: 'PEACEKEEPER',
    tag: 'UN contingent quartermaster',
    currency: 'USD',
    buyMult: 0.36,
    buys: ['weapon', 'pistol', 'mag', 'ammo', 'armor', 'info', 'electronics', 'valuables', 'key'],
    assort: [
      { key: 'sc_alpha', ll: 1, stock: 1 }, { key: 'sc_beta', ll: 3, stock: 1 },
      { key: 'sc_epsilon', ll: 4, stock: 1 },
      { key: 'ey_tactical', ll: 1, stock: 6 }, { key: 'ey_round', ll: 1, stock: 6 },
      { key: 'hs_comtac', ll: 3, stock: 2 }, { key: 'hs_rac', ll: 4, stock: 1 },
      { key: 'hl_fast', ll: 4, stock: 1 },
      { key: 'g_m67', ll: 2, stock: 6 },
      { key: 'usd', ll: 1, stock: 40000 },
    ],
  },
  {
    id: 'mechanic',
    name: 'MECHANIC',
    tag: 'Gunsmith · parts and keys',
    currency: 'RUB',
    buyMult: 0.45,
    buys: ['weapon', 'pistol', 'mag', 'ammo', 'electronics', 'barter', 'key'],
    assort: [
      { key: 'w_kedr', ll: 1, stock: 3 }, { key: 'w_kedrb', ll: 2, stock: 2 },
      { key: 'w_pm', ll: 1, stock: 6 },
      { key: 'mag_kedr', ll: 1, stock: 10 }, { key: 'am_9x18pst', ll: 1, stock: 400 },
      { key: 'magcase', ll: 3, stock: 1 },
      { key: 'k_factexit', ll: 3, stock: 1 }, { key: 'k_bunk', ll: 2, stock: 2 },
      { key: 'k_machine', ll: 2, stock: 2 }, { key: 'k_pump', ll: 3, stock: 1 },
      { key: 'toolset', ll: 2, stock: 3 }, { key: 'drill', ll: 2, stock: 3 },
    ],
  },
  {
    id: 'ragman',
    name: 'RAGMAN',
    tag: 'Clothing and body armor',
    currency: 'RUB',
    buyMult: 0.50,
    buys: ['armor', 'helmet', 'glasses', 'facecover', 'headset', 'rig', 'backpack', 'container', 'barter'],
    assort: [
      { key: 'bp_sling', ll: 1, stock: 5 }, { key: 'bp_vkbo', ll: 1, stock: 5 },
      { key: 'bp_transf', ll: 1, stock: 4 }, { key: 'bp_duffle', ll: 2, stock: 3 },
      { key: 'bp_mbss', ll: 2, stock: 3 }, { key: 'bp_berkut', ll: 3, stock: 2 },
      { key: 'bp_sanitar', ll: 3, stock: 2 }, { key: 'bp_lbt', ll: 3, stock: 2 },
      { key: 'bp_pilgrim', ll: 4, stock: 1 },
      { key: 'rig_scav', ll: 1, stock: 6 }, { key: 'rig_idea', ll: 1, stock: 6 },
      { key: 'rig_lbt', ll: 3, stock: 2 }, { key: 'rig_blackrock', ll: 3, stock: 2 },
      { key: 'rig_ana', ll: 4, stock: 1 },
      { key: 'ar_zhuk', ll: 2, stock: 3 }, { key: 'ar_6b23', ll: 3, stock: 2 },
      { key: 'ar_iotv', ll: 4, stock: 1 },
      { key: 'hl_ushanka', ll: 1, stock: 8 }, { key: 'hl_lshz', ll: 2, stock: 4 },
      { key: 'hl_6b47', ll: 2, stock: 4 },
      { key: 'fc_balaclava', ll: 1, stock: 8 }, { key: 'fc_shroud', ll: 4, stock: 1 },
      { key: 'hs_gssh', ll: 2, stock: 4 },
    ],
  },
  {
    id: 'jaeger',
    name: 'JAEGER',
    tag: 'Huntsman · survival gear',
    currency: 'RUB',
    buyMult: 0.48,
    buys: ['weapon', 'melee', 'rig', 'backpack', 'meds', 'food', 'drink', 'barter'],
    assort: [
      { key: 'w_mp133', ll: 1, stock: 4 }, { key: 'w_vpo136', ll: 2, stock: 3 },
      { key: 'm_axe', ll: 2, stock: 2 }, { key: 'm_crash', ll: 4, stock: 1 },
      { key: 'am_12buck', ll: 1, stock: 240 },
      { key: 'stewL', ll: 1, stock: 10 }, { key: 'oatflakes', ll: 1, stock: 10 },
      { key: 'vodka', ll: 2, stock: 6 }, { key: 'beer', ll: 1, stock: 8 },
      { key: 'bp_sling', ll: 1, stock: 4 }, { key: 'rig_scav', ll: 1, stock: 5 },
      { key: 'goldstar', ll: 1, stock: 8 }, { key: 'vaseline', ll: 2, stock: 6 },
    ],
  },
  {
    id: 'fence',
    name: 'FENCE',
    tag: 'Buys anything · pays the worst',
    currency: 'RUB',
    buyMult: 0.24,
    buysAll: true,
    buys: [],
    assort: [],
    randomAssort: 14,
  },
];

export const TRADER_BY_ID = Object.fromEntries(TRADERS.map((t) => [t.id, t]));

/** loyalty level unlocked for a trader given profile level, rep and roubles spent */
export function loyaltyFor(profileLevel, rep, spentRub = 0) {
  let ll = 1;
  for (const l of LOYALTY_LEVELS) {
    if (profileLevel >= l.pmc && rep >= l.rep && spentRub >= (l.spent || 0)) ll = l.level;
  }
  return ll;
}

export function canBuyFrom(trader, item) {
  if (trader.buysAll) return true;
  return trader.buys.includes(item.cat);
}

/** what a trader pays for one item, in that trader's currency */
export function sellValue(trader, item, fx) {
  const base = item.tpl.price * item.stack;
  let condition = 1;
  const tpl = item.tpl;
  if (tpl.dura != null && item.dura != null) condition *= 0.45 + 0.55 * (item.dura / tpl.dura);
  if (tpl.res && item.res != null) condition *= 0.4 + 0.6 * (item.res / tpl.res.max);
  const rub = base * trader.buyMult * condition;
  const v = Math.floor(rub / (fx[trader.currency] || 1));
  // only roubles keep a 1-unit floor: rounding 30-rouble junk UP to a whole
  // dollar would be a money printer at Peacekeeper
  return trader.currency === 'RUB' ? Math.max(1, v) : v;
}

/**
 * The currency an offer is paid in. Currency itself is always bought with
 * roubles — Peacekeeper quoting dollars in dollars would be a free money and
 * reputation pump. Individual offers may override with `cur` (Skier's
 * euro-priced smuggled stock).
 */
export function buyCurrency(trader, tpl, off = null) {
  if (tpl.cat === 'money') return 'RUB';
  return off?.cur || trader.currency;
}

/** what the player pays for one unit, in buyCurrency(trader, tpl, off) */
export function buyPrice(trader, tpl, fx, off = null) {
  const markup = 1.08;
  const rub = tpl.price * markup;
  return Math.max(1, Math.round(rub / (fx[buyCurrency(trader, tpl, off)] || 1)));
}
