// =========================================================
// ballistics on paper: what a round does to armour, on the card
//
// The game rolls a penetration chance from the armour's class (its value is
// class x 10, worn down with durability) against the round's penetration
// power. The curve is the one every community calculator quotes off the
// client, in three pieces:
//
//   b >= a          : 100 + b / (0.9a - b)          (%)   90% at b = a, ~99% far above
//   a - 15 < b < a  : 0.4 * (a - b - 15)^2         (%)   0% at a - 15, 90% at a
//   b <= a - 15     : 0
//
// Nothing here fires; this is what the ammo card and the calibre chart show
// beside a round: its chance against a FRESH plate of each class, and the
// wiki's colour scale for reading it. Durability wear on the armour is a
// combat matter and stays out of it - which is also why the strip is labelled
// as being against fresh armour.
// =========================================================

/** armour classes the game has, 1..6 */
export const ARMOR_CLASSES = [1, 2, 3, 4, 5, 6];

/** chance (0..100) that `pen` beats an armour value `a` (class x 10 x durability) */
export function penChance(pen, a) {
  const b = pen;
  if (!(a > 0)) return 100;
  if (b >= a) return Math.max(0, Math.min(100, 100 + b / (0.9 * a - b)));
  if (b > a - 15) return Math.max(0, Math.min(100, 0.4 * (a - b - 15) ** 2));
  return 0;
}

/** the chance against a fresh plate of each class: [{cls, chance}] */
export function classStrip(pen) {
  return ARMOR_CLASSES.map((cls) => ({ cls, chance: penChance(pen, cls * 10) }));
}

/**
 * The wiki's six-step reading of a strip cell. The wiki defines the steps by
 * how many shots the plate takes on average before one goes through; the
 * thresholds below are the fresh-plate chances that line up with those
 * bands (a fresh chance under 1% is a plate that has to be chewed through,
 * ~50% is two or three shots, over 80% is "usually ignores").
 */
export const EFFICACY = [
  { level: 0, label: 'Pointless', color: '#b32425' },
  { level: 1, label: 'Possible, but', color: '#dd3333' },
  { level: 2, label: 'Magdump only', color: '#eb6c0d' },
  { level: 3, label: 'Slightly effective', color: '#ac6600' },
  { level: 4, label: 'Effective', color: '#fb9c0e' },
  { level: 5, label: 'Very effective', color: '#006400' },
  { level: 6, label: 'Usually ignores', color: '#009900' },
];

export function efficacy(chance, pen, cls) {
  // how far under the plate the round sits decides how fast the plate wears
  // down to it: the same 0% reads "magdump" against class 2 and "pointless"
  // against class 6 for a pistol round
  const gap = cls * 10 - pen;
  if (chance >= 80) return EFFICACY[6];
  if (chance >= 50) return EFFICACY[5];
  if (chance >= 20) return EFFICACY[4];
  if (chance >= 5) return EFFICACY[3];
  if (gap <= 18) return EFFICACY[2];
  if (gap <= 28) return EFFICACY[1];
  return EFFICACY[0];
}

/** every projectile's share, for the card: "8 x 39" */
export function damageLabel(a) {
  if (!a) return '—';
  const n = a.proj > 1 ? a.proj : 1;
  return n > 1 ? `${n} x ${a.dmg}` : String(a.dmg ?? 0);
}

/** the wiki's four-step reading of a magazine's / round's malfunction number */
export function chanceWord(v) {
  if (v == null) return null;
  if (v < 0.03) return 'Very low';
  if (v < 0.1) return 'Low';
  if (v < 0.2) return 'Medium';
  return 'High';
}
