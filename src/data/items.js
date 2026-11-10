// =========================================================
// item template registry
//
// items-db.json is produced by tools/build_items.py: every item of the live
// game, from tarkov.dev's dataset (what exists and its numbers today) laid
// over the public SPT template dumps (everything deeper), with artwork from
// assets.tarkov.dev grid images.
//
// A template is keyed by its 24-hex tarkov id. The items the game shipped
// with before the database was complete also keep a slug (`salewa`, `w_akm`)
// and are marked `core`; getTpl() takes either.
// =========================================================

/** @type {Record<string, any>} keyed by slug, or by tarkov id where there is no slug */
export const TPL = {};
/** @type {Record<string, any>} keyed by the 24-hex tarkov item id */
export const BY_ID = {};

export const ITEM_ASSET_DIR = 'assets/items/';
/**
 * Which set of pictures this is. The files keep their names when the set
 * changes (grid images gave way to bare renders), and a browser that has
 * the old ones goes on showing them under the new tiles; asking for them
 * under a new query makes them new files to it.
 */
const ART_REV = '?r2';
/** where a picture of the item art folder is fetched from */
export function artUrl(file) { return ITEM_ASSET_DIR + file + ART_REV; }

/**
 * Every gameplay category the game understands. A template's `cat` is
 * derived from its tarkov category chain (`cats`) by the builder.
 *
 * The last row is what the full item list brought with it: an armour plate
 * and a helmet's shield or mandible are items of their own, night vision
 * goes on a helmet mount, special-slot equipment (markers, cameras, jammers,
 * a compass), the two repair kits, sealed cases that open into loot, the
 * hand-fired signal cartridge, quest items, and `preset` - a named build of
 * a gun or a plated vest that a trader lists, which is not an item to hold
 * but the recipe for one (see presetOf).
 */
export const CATEGORIES = [
  'money', 'meds', 'food', 'drink', 'barter', 'electronics', 'valuables', 'info',
  'key', 'container', 'secure', 'backpack', 'rig', 'armor', 'helmet', 'headset',
  'glasses', 'facecover', 'armband', 'weapon', 'pistol', 'melee', 'grenade', 'mag', 'ammo', 'ammobox', 'mod',
  'plate', 'gearmod', 'nvg', 'special', 'repairkit', 'lootbox', 'flare', 'quest', 'preset',
];

export const CAT_LABEL = {
  money: 'Money', meds: 'Medical', food: 'Food', drink: 'Drink', barter: 'Barter',
  electronics: 'Electronics', valuables: 'Valuables', info: 'Intel', key: 'Key',
  container: 'Container', secure: 'Secure container', backpack: 'Backpack',
  rig: 'Tactical rig', armor: 'Body armor', helmet: 'Headwear', headset: 'Headset',
  glasses: 'Eyewear', facecover: 'Face cover', armband: 'Armband', weapon: 'Weapon',
  pistol: 'Pistol', melee: 'Melee', grenade: 'Throwable', mag: 'Magazine', ammo: 'Ammo',
  ammobox: 'Ammo pack', mod: 'Weapon part',
  plate: 'Armor plate', gearmod: 'Gear component', nvg: 'Night vision', special: 'Special equipment',
  repairkit: 'Repair kit', lootbox: 'Sealed case', flare: 'Signal flare', quest: 'Quest item',
  preset: 'Preset',
};

/** modType -> label, for parts (the handbook's own families) */
export const MOD_TYPE_LABEL = {
  barrel: 'Barrel', handguard: 'Handguard', gasblock: 'Gas block',
  muzzle: 'Muzzle device', suppressor: 'Suppressor', grip: 'Pistol grip',
  foregrip: 'Foregrip', stock: 'Stock', receiver: 'Receiver',
  mount: 'Mount', ironsight: 'Iron sight', reflex: 'Reflex sight',
  scope: 'Scope', tactical: 'Tactical device', charge: 'Charging handle',
  aux: 'Auxiliary part', bipod: 'Bipod', magazine: 'Magazine',
  launcher: 'Underbarrel launcher',
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
  // the layouts are only how a rig's pouches are set out; without them the
  // pouches are drawn in a row and everything still works
  const [res, lay] = await Promise.all([
    fetch(new URL('./items-db.json', import.meta.url)),
    fetch(new URL('./grid-layouts.json', import.meta.url)).then((r) => (r.ok ? r.json() : null)).catch(() => null),
  ]);
  if (!res.ok) throw new Error(`items-db.json: ${res.status}`);
  const raw = await res.json();
  const layouts = lay?.layouts || {};
  const placed = lay?.items || {};
  for (const [key, tpl] of Object.entries(raw)) {
    tpl.key = key;
    tpl.tier = valueTier(tpl);
    tpl.imgUrl = tpl.img ? artUrl(tpl.img) : null;
    tpl.presetImgUrl = tpl.presetImg ? artUrl(tpl.presetImg) : null;
    // the large render of the default preset, for the modding screen's stage;
    // only the guns it was fetched for have one (tools/fetch_preset_art.py)
    tpl.presetLgUrl = tpl.presetLg ? `${ITEM_ASSET_DIR}${tpl.id}-preset-lg.webp` : null;
    // where each of a rig's grids sits (tools/build_layouts.py): the layout
    // the template names, or the one found for it by shape, with the corner
    // of every grid in the order of the item's own
    const c = tpl.container;
    if (c?.grids?.length > 1) {
      const over = placed[tpl.id];
      const layout = layouts[over ? over[0] : c.layout];
      if (layout) {
        const order = over ? over[1] : c.grids.map((_g, i) => i);
        if (order.length === c.grids.length && order.every((bi) => layout.g[bi])) {
          c.place = { w: layout.w, h: layout.h, pos: order.map((bi) => layout.g[bi]) };
        }
      }
    }
    TPL[key] = tpl;
    BY_ID[tpl.id] = tpl;
  }
  // A preset names the gun it is a build of; the tree itself is kept once, on
  // the gun (its default as `preset`, the others in `wpn.alts`), and hung on
  // the preset here. A vest's or a helmet's preset carries its own.
  for (const tpl of Object.values(TPL)) {
    if (tpl.cat !== 'preset') continue;
    const base = TPL[tpl.base];
    if (!base?.wpn) continue;
    if (tpl.def) { tpl.tree = base.preset || {}; continue; }
    const alt = (base.wpn.alts || []).find((a) => a.id === tpl.id);
    if (alt) { tpl.tree = alt.tree; if (alt.load) tpl.load = alt.load; }
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

/**
 * What a preset template stands for: the template to make and what to hang
 * on it - {base, tree, plates, load} - or null when `keyOrId` is not a
 * preset. `tree` is the shape applyPreset() takes; `plates` names the plate
 * each plate slot of a vest ships with; `load` is the rounds in the magazine.
 */
export function presetOf(keyOrId) {
  const tpl = getTpl(keyOrId);
  if (!tpl || tpl.cat !== 'preset') return null;
  const base = getTpl(tpl.base);
  if (!base) return null;
  return { base, tree: tpl.tree || {}, plates: tpl.plates || {}, load: tpl.load || [] };
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
  armband: ['armband'],
  special1: ['special'],
  special2: ['special'],
  special3: ['special'],
};
