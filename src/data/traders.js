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
    buys: ['weapon', 'pistol', 'mag', 'ammo', 'mod', 'grenade', 'armor', 'meds', 'barter', 'key'],
    // the Kalashnikov quartermaster: every part an AK ships with, the Soviet
    // magazines and the two rifle calibres, tiered by penetration
    rules: [
      { kind: 'preset', of: ['w_ak74n', 'w_aks74u', 'w_akm', 'w_vpo136'], ll: 1, stock: 6 },
      { kind: 'fits', of: ['w_ak74n', 'w_aks74u', 'w_akm', 'w_vpo136'], types: ['magazine'], maxPrice: 6000, ll: 1, stock: 8 },
      { kind: 'fits', of: ['w_ak74n', 'w_aks74u', 'w_akm', 'w_vpo136'], types: ['magazine'], ll: 3, stock: 3 },
      { kind: 'fits', of: ['w_ak74n', 'w_aks74u', 'w_akm', 'w_vpo136'], types: ['muzzle', 'suppressor', 'stock', 'handguard', 'gasblock', 'receiver', 'grip', 'ironsight', 'charge'], maxPrice: 12000, ll: 2, stock: 4 },
      { kind: 'ammo', cal: ['5.45x39', '7.62x39'], stock: 600 },
    ],
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
    buys: ['rig', 'weapon', 'pistol', 'mag', 'ammo', 'mod', 'grenade', 'electronics', 'valuables', 'barter'],
    // pistol and shotgun parts, and the odd smuggled European fitting
    rules: [
      { kind: 'preset', of: ['w_tt', 'w_pb', 'w_saiga', 'w_mp153'], ll: 1, stock: 5 },
      { kind: 'fits', of: ['w_tt', 'w_pm', 'w_pb', 'w_saiga', 'w_mp153'], types: ['magazine'], ll: 1, stock: 8 },
      { kind: 'fits', of: ['w_tt', 'w_pm', 'w_pb', 'w_saiga', 'w_mp153', 'w_mp133'], types: ['muzzle', 'suppressor', 'stock', 'handguard', 'grip', 'receiver', 'mount', 'ironsight', 'charge', 'foregrip'], ll: 2, stock: 3 },
      { kind: 'ammo', cal: ['7.62x25', '12/70', '9x18'], stock: 400 },
    ],
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
    buys: ['weapon', 'pistol', 'mag', 'ammo', 'mod', 'armor', 'info', 'electronics', 'valuables', 'key'],
    // Western optics, lights, foregrips and the adapters that put them on
    rules: [
      { kind: 'type', types: ['reflex', 'scope', 'tactical', 'foregrip', 'bipod'], minPrice: 12000, ll: 2, stock: 3 },
      { kind: 'type', types: ['mount'], minPrice: 12000, ll: 3, stock: 3 },
    ],
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
    buys: ['weapon', 'pistol', 'mag', 'ammo', 'mod', 'electronics', 'barter', 'key'],
    // the gunsmith: everything that is not a factory part, tiered by price
    rules: [
      { kind: 'preset', of: ['w_kedr', 'w_kedrb', 'w_pm', 'w_mp133'], ll: 1, stock: 5 },
      { kind: 'fits', of: ['w_kedr', 'w_kedrb', 'w_pm'], types: ['magazine'], ll: 1, stock: 8 },
      { kind: 'type', types: ['mount', 'reflex', 'ironsight', 'foregrip', 'grip', 'stock', 'handguard', 'receiver', 'gasblock', 'charge', 'aux', 'muzzle', 'suppressor', 'tactical', 'scope', 'bipod', 'barrel'], maxPrice: 8000, ll: 1, stock: 4 },
      { kind: 'type', types: ['mount', 'reflex', 'ironsight', 'foregrip', 'grip', 'stock', 'handguard', 'receiver', 'gasblock', 'charge', 'aux', 'muzzle', 'suppressor', 'tactical', 'scope', 'bipod', 'barrel'], minPrice: 8000, maxPrice: 25000, ll: 2, stock: 3 },
      { kind: 'type', types: ['mount', 'reflex', 'ironsight', 'foregrip', 'grip', 'stock', 'handguard', 'receiver', 'gasblock', 'charge', 'aux', 'muzzle', 'suppressor', 'tactical', 'scope', 'bipod', 'barrel'], minPrice: 25000, maxPrice: 60000, ll: 3, stock: 2 },
      { kind: 'type', types: ['mount', 'reflex', 'ironsight', 'foregrip', 'grip', 'stock', 'handguard', 'receiver', 'gasblock', 'charge', 'aux', 'muzzle', 'suppressor', 'tactical', 'scope', 'bipod', 'barrel'], minPrice: 60000, ll: 4, stock: 1 },
      { kind: 'type', types: ['magazine'], minPrice: 6000, ll: 2, stock: 3 },
      { kind: 'ammo', cal: ['9x18'], stock: 400 },
    ],
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
    buys: ['weapon', 'melee', 'mod', 'rig', 'backpack', 'meds', 'food', 'drink', 'barter'],
    // hunting fittings: shotgun barrels, forestocks and stocks, carbine parts
    rules: [
      { kind: 'fits', of: ['w_mp133', 'w_mp153', 'w_vpo136'], types: ['barrel', 'handguard', 'stock', 'magazine', 'muzzle', 'mount', 'ironsight'], ll: 1, stock: 4 },
      { kind: 'ammo', cal: ['12/70'], stock: 240 },
    ],
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

// ---------------------------------------------------------
// rule-based assortments
//
// The 700-odd parts, magazines and cartridges are generated from the weapon
// templates, so no hand-written list could keep up with them. Each trader
// instead carries `rules` that pick out of the item database once it has
// loaded: the parts a gun ships with (`preset`), whatever fits a gun directly
// (`fits`), a family of part (`type`), or every round of a calibre (`ammo`).
// Rounds are tiered by penetration the way the real traders tier them: the
// good stuff sits behind loyalty.
// ---------------------------------------------------------
function ammoTier(tpl) {
  const pen = tpl.ammo?.pen ?? tpl.pen ?? 0;
  if (pen < 20) return 1;
  if (pen < 30) return 2;
  if (pen < 40) return 3;
  return 4;
}

function presetKeys(tpl, out = new Set()) {
  const walk = (tree) => {
    for (const rec of Object.values(tree || {})) { out.add(rec.t); if (rec.s) walk(rec.s); }
  };
  walk(tpl.preset);
  return out;
}

/**
 * Turn every trader's `rules` into concrete offers, appended to its `assort`.
 * Idempotent: a second call replaces the generated part. Needs the item
 * templates, so it runs after loadItems().
 */
export function buildAssortments(TPL) {
  const all = Object.values(TPL);
  const weapons = all.filter((t) => t.wpn);
  // part key -> weapons it goes straight onto
  const fitsOn = new Map();
  for (const w of weapons) {
    for (const s of w.slots || []) for (const k of s.f) {
      if (!fitsOn.has(k)) fitsOn.set(k, new Set());
      fitsOn.get(k).add(w.key);
    }
  }
  for (const t of TRADERS) {
    t.assort = (t.assort || []).filter((o) => !o.generated);
    const have = new Set(t.assort.map((o) => o.key));
    const add = (key, ll, stock, cur) => {
      if (have.has(key) || !TPL[key]) return;
      have.add(key);
      const off = { key, ll, stock, base: stock, generated: true };
      if (cur) off.cur = cur;
      t.assort.push(off);
    };
    for (const r of t.rules || []) {
      if (r.kind === 'preset') {
        for (const wk of r.of) for (const k of presetKeys(TPL[wk] || {})) add(k, r.ll, r.stock, r.cur);
      } else if (r.kind === 'fits') {
        for (const [k, ws] of fitsOn) {
          const tpl = TPL[k];
          if (!r.of.some((w) => ws.has(w))) continue;
          if (r.types && !r.types.includes(tpl.modType)) continue;
          if (r.maxPrice && tpl.price > r.maxPrice) continue;
          if (r.minPrice && tpl.price < r.minPrice) continue;
          add(k, r.ll, r.stock, r.cur);
        }
      } else if (r.kind === 'type') {
        for (const tpl of all) {
          if (!(tpl.cat === 'mod' || tpl.cat === 'mag') || !r.types.includes(tpl.modType)) continue;
          if (r.maxPrice && tpl.price > r.maxPrice) continue;
          if (r.minPrice && tpl.price < r.minPrice) continue;
          add(tpl.key, r.ll, r.stock, r.cur);
        }
      } else if (r.kind === 'ammo') {
        for (const tpl of all) {
          if (tpl.cat !== 'ammo' || !r.cal.includes(tpl.cal)) continue;
          add(tpl.key, r.ll || ammoTier(tpl), r.stock, r.cur);
        }
      }
    }
  }
  // a gun is sold assembled, so it is priced assembled: the receiver alone
  // would be a quarter of what the parts on it are worth
  for (const w of weapons) w.presetPrice = presetKeys(w).size
    ? Array.from(presetKeys(w)).reduce((n, k) => n + (TPL[k]?.price || 0), w.price)
    : w.price;
}

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
  // parts and cartridges on a gun sell with it
  let base = item.selfValue;
  for (const m of item.mods()) base += m.value;
  let condition = 1;
  const tpl = item.tpl;
  const maxDura = tpl.dura ?? tpl.wpn?.maxDura;
  if (maxDura != null && item.dura != null) condition *= 0.45 + 0.55 * (item.dura / maxDura);
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
  const rub = (tpl.presetPrice || tpl.price) * markup;
  return Math.max(1, Math.round(rub / (fx[buyCurrency(trader, tpl, off)] || 1)));
}
