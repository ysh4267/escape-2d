// =========================================================
// item template registry
//
// items-db.json is produced by tools/build_items.py:
//   names / descriptions / handbook prices come from the public SPT data dump,
//   grid footprints and artwork come from assets.tarkov.dev grid images.
// =========================================================

/** @type {Record<string, any>} keyed by slug */
export const TPL = {};
/** @type {Record<string, any>} keyed by the 24-hex tarkov item id */
export const BY_ID = {};

export const ITEM_ASSET_DIR = 'assets/items/';

/** every gameplay category the game understands */
export const CATEGORIES = [
  'money', 'meds', 'food', 'drink', 'barter', 'electronics', 'valuables', 'info',
  'key', 'container', 'secure', 'backpack', 'rig', 'armor', 'helmet', 'headset',
  'glasses', 'facecover', 'armband', 'weapon', 'pistol', 'melee', 'grenade', 'mag', 'ammo', 'mod',
];

export const CAT_LABEL = {
  money: 'Money', meds: 'Medical', food: 'Food', drink: 'Drink', barter: 'Barter',
  electronics: 'Electronics', valuables: 'Valuables', info: 'Intel', key: 'Key',
  container: 'Container', secure: 'Secure container', backpack: 'Backpack',
  rig: 'Tactical rig', armor: 'Body armor', helmet: 'Headwear', headset: 'Headset',
  glasses: 'Eyewear', facecover: 'Face cover', armband: 'Armband', weapon: 'Weapon',
  pistol: 'Pistol', melee: 'Melee', grenade: 'Throwable', mag: 'Magazine', ammo: 'Ammo',
  mod: 'Weapon part',
};

/** modType -> label, for parts (the handbook's own families) */
export const MOD_TYPE_LABEL = {
  barrel: 'Barrel', handguard: 'Handguard', gasblock: 'Gas block',
  muzzle: 'Muzzle device', suppressor: 'Suppressor', grip: 'Pistol grip',
  foregrip: 'Foregrip', stock: 'Stock', receiver: 'Receiver',
  mount: 'Mount', ironsight: 'Iron sight', reflex: 'Reflex sight',
  scope: 'Scope', tactical: 'Tactical device', charge: 'Charging handle',
  aux: 'Auxiliary part', bipod: 'Bipod', magazine: 'Magazine',
};

/** the fire modes as the game prints them on the weapon card */
export const FIRE_MODE_LABEL = {
  single: 'Single', fullauto: 'Full auto', burst: 'Burst', doublet: 'Doublet',
  doubleaction: 'Double action', semiauto: 'Semi',
};

export function modTypeLabel(tpl) {
  return MOD_TYPE_LABEL[tpl?.modType] || CAT_LABEL[tpl?.cat] || 'Part';
}

/** how "interesting" a category is -> tile tint 0..5 */
const VALUE_TIERS = [0, 12000, 45000, 120000, 400000, 900000];

export function valueTier(tpl) {
  const p = (tpl.price || 0) * (tpl.stack > 1 ? 1 : 1);
  let t = 0;
  for (let i = 0; i < VALUE_TIERS.length; i++) if (p >= VALUE_TIERS[i]) t = i;
  return t;
}

export async function loadItems() {
  const res = await fetch(new URL('./items-db.json', import.meta.url));
  if (!res.ok) throw new Error(`items-db.json: ${res.status}`);
  const raw = await res.json();
  for (const [key, tpl] of Object.entries(raw)) {
    tpl.key = key;
    tpl.tier = valueTier(tpl);
    tpl.imgUrl = tpl.img ? ITEM_ASSET_DIR + tpl.img : null;
    tpl.presetImgUrl = tpl.presetImg ? ITEM_ASSET_DIR + tpl.presetImg : null;
    // the large render of the default preset, for the modding screen's stage
    tpl.presetLgUrl = tpl.presetImg ? ITEM_ASSET_DIR + tpl.presetImg.replace('-preset.webp', '-preset-lg.webp') : null;
    TPL[key] = tpl;
    BY_ID[tpl.id] = tpl;
  }
  // one exchange rate everywhere: the handbook quotes currency below the FX
  // table, and two disagreeing rates open buy-low/sell-high loops
  for (const [key, cur] of Object.entries(CURRENCY)) {
    if (TPL[key] && FX[cur]) TPL[key].price = FX[cur];
  }
  return TPL;
}

export function getTpl(keyOrId) {
  return TPL[keyOrId] || BY_ID[keyOrId] || null;
}

export function allTpls() { return Object.values(TPL); }

export function tplsByCat(cat) { return allTpls().filter((t) => t.cat === cat); }

export function tplsWhere(fn) { return allTpls().filter(fn); }

/** categories that behave as currency */
export const CURRENCY = { rub: 'RUB', usd: 'USD', eur: 'EUR' };
export const CURRENCY_KEY = { RUB: 'rub', USD: 'usd', EUR: 'eur' };
/** exchange rates used when a trader pays in a foreign currency */
export const FX = { RUB: 1, USD: 145, EUR: 158 };

export function isCurrency(tpl) { return tpl.cat === 'money'; }

/** the categories a given equipment slot will take */
export const SLOT_ACCEPTS = {
  head: ['helmet'],
  ears: ['headset'],
  face: ['facecover'],
  eyes: ['glasses'],
  armor: ['armor'],
  rig: ['rig'],
  backpack: ['backpack'],
  secure: ['secure'],
  primary: ['weapon'],
  secondary: ['weapon'],
  holster: ['pistol'],
  scabbard: ['melee'],
};
