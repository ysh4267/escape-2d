// =========================================================
// seeded PRNG (mulberry32) so a raid layout can be reproduced
// =========================================================

export function makeRng(seed = Date.now() >>> 0) {
  let a = seed >>> 0;
  const rng = () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  rng.seed = seed;
  rng.int = (lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));
  rng.float = (lo, hi) => lo + rng() * (hi - lo);
  rng.chance = (p) => rng() < p;
  rng.pick = (arr) => arr[Math.floor(rng() * arr.length)];
  rng.shuffle = (arr) => {
    const a2 = arr.slice();
    for (let i = a2.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [a2[i], a2[j]] = [a2[j], a2[i]];
    }
    return a2;
  };
  // weighted pick: entries [{ w: number, ...}] or [value, weight] pairs
  rng.weighted = (entries, weightOf = (e) => e.w ?? 1) => {
    let total = 0;
    for (const e of entries) total += weightOf(e);
    if (total <= 0) return null;
    let r = rng() * total;
    for (const e of entries) {
      r -= weightOf(e);
      if (r <= 0) return e;
    }
    return entries[entries.length - 1];
  };
  return rng;
}

export const rand = makeRng(Math.floor(Math.random() * 0xffffffff));

export function hashSeed(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
