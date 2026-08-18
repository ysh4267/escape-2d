// =========================================================
// the stat rows a tooltip / inspect window shows for guns, parts, mags, ammo
//
// One place for both, so what hovers matches what the inspect window says.
// `row(key, value)` is supplied by the caller.
// =========================================================

import { FIRE_MODE_LABEL, modTypeLabel, getTpl } from '../data/items.js';
import { weaponStats, describeRounds } from './weapon.js';
import { classStrip, efficacy, chanceWord } from './ballistics.js';

const pct = (v) => `${v > 0 ? '+' : ''}${v}%`;
const sgn = (v) => `${v > 0 ? '+' : ''}${v}`;
/** a multiplier like 1.14 printed the way the game prints it: +14% */
const mul = (v) => pct(Math.round((v - 1) * 100));

export function statRows(item, row) {
  const tpl = item.tpl;
  if (item.isWeapon) return weaponRows(item, row);
  if (item.isMag) return magRows(item, row);
  if (tpl.cat === 'mod') return modRows(item, row);
  if (tpl.cat === 'ammo') return ammoRows(item, row);
  if (tpl.cat === 'ammobox') return boxRows(item, row);
  if (tpl.repairKit) return kitRows(item, row);
  return false;
}

/** "C1 100 · C2 96 · C3 60 · C4 12 · C5 0 · C6 0" - the chance against fresh armour of each class */
export function armorStripText(pen) {
  return classStrip(pen).map((c) => `C${c.cls} ${Math.round(c.chance)}`).join(' · ');
}

function weaponRows(item, row) {
  const st = weaponStats(item);
  const wpn = item.tpl.wpn || {};
  if (st.cal) row('CALIBER', st.cal);
  row('ERGONOMICS', String(st.ergo));
  row('RECOIL', `${st.vRecoil} / ${st.hRecoil}`);
  if (st.moa != null) row('ACCURACY', `${st.moa} MOA`);
  if (st.velocity) row('MUZZLE VELOCITY', `${st.velocity} m/s`);
  row('SIGHTING RANGE', `${st.sightRange} m`);
  if (st.effDist) row('EFFECTIVE DISTANCE', `${st.effDist} m`);
  row('FIRE RATE', `${st.rpm} rpm`);
  row('FIRE MODES', st.fire.map((f) => FIRE_MODE_LABEL[f] || f).join(' / ') || '—');
  const mag = item.magazine;
  if (mag) row('MAGAZINE', `${mag.tpl.short} · ${mag.ammoCount}/${mag.tpl.magSize}`);
  else if (item.slots?.some((s) => s.name === 'mod_magazine')) row('MAGAZINE', 'none');
  if (item.chamber) row('CHAMBER', item.chamber.length ? 'loaded' : 'empty');
  if (st.dburn && st.dburn !== 1) row('DURABILITY BURN', mul(st.dburn));
  if (st.maxDura) row('DURABILITY', `${fmt2(st.dura ?? st.maxDura)} / ${fmt2(st.maxDura)}`);
  if (wpn.fold) row('STOCK', item.folded ? 'folded' : 'unfolded');
  row('SIZE', `${item.fw}x${item.fh}`);
  const n = [...item.allMods()].length;
  row('PARTS', n ? `${n} installed` : 'stripped');
  if (st.missing.length) row('MISSING', st.missing.map((s) => s.label).join(', '));
  return true;
}

/** durability values go fractional after a repair; two decimals at most */
function fmt2(v) {
  const r = Math.round(v * 100) / 100;
  return Number.isInteger(r) ? String(r) : r.toFixed(r * 10 === Math.round(r * 10) ? 1 : 2);
}

function magRows(item, row) {
  const tpl = item.tpl;
  if (tpl.cal) row('CALIBER', tpl.cal);
  row('CAPACITY', `${item.ammoCount} / ${tpl.magSize}`);
  if (item.rounds.length) row('LOADED', describeRounds(item));
  if (tpl.ergo) row('ERGONOMICS', sgn(tpl.ergo));
  const md = tpl.mod || {};
  if (md.recoil) row('RECOIL', pct(md.recoil));
  const mg = tpl.mag || {};
  if (mg.malf) row('FEED FAILURE', `${chanceWord(mg.malf)} (${(mg.malf * 100).toFixed(1)}%)`);
  if (mg.load) row('LOAD/UNLOAD SPEED', pct(mg.load));
  if (mg.check) row('CHECK SPEED', pct(mg.check));
  if (mg.checkOverride) row('CHECK ACCURACY', 'improved (windowed)');
  if (mg.type === 'InternalMagazine') row('TYPE', 'internal tube');
  return true;
}

function modRows(item, row) {
  const tpl = item.tpl;
  const md = tpl.mod || {};
  row('TYPE', modTypeLabel(tpl));
  if (tpl.ergo ?? md.ergo) row('ERGONOMICS', sgn(tpl.ergo ?? md.ergo));
  if (md.recoil) row('RECOIL', pct(md.recoil));
  if (md.acc) row('ACCURACY', pct(md.acc));
  if (md.vel) row('MUZZLE VELOCITY', pct(md.vel));
  if (md.range) row('SIGHTING RANGE', `${md.range} m`);
  if (md.zooms) row('MAGNIFICATION', md.zooms.map((zz) => zoomLabel(zz)).join(' / '));
  else if (md.zoom) row('MAGNIFICATION', `${md.zoom}x`);
  if (md.zero) row('ZEROING', md.zero.map((zz) => zz.length > 4 ? `${zz[0]}–${zz[zz.length - 1]} m` : zz.map((d) => `${d}`).join('/') + ' m').join(' · '));
  if (md.modes) row('MODES', md.modes.join(' / '));
  if (md.moa && tpl.modType === 'barrel') row('ACCURACY (BARREL)', `${Math.round(md.moa * 100 / 2.908 * 2 * 100) / 100} MOA`);
  if (md.loud) row('LOUDNESS', sgn(md.loud));
  if (md.heat && md.heat !== 1) row('HEAT', mul(md.heat));
  if (md.cool && md.cool !== 1) row('COOLING', mul(md.cool));
  if (md.dburn && md.dburn !== 1) row('DURABILITY BURN', mul(md.dburn));
  if (md.blocksFold) row('NOTE', 'blocks stock folding');
  if (md.noRaidMod) row('NOTE', 'not moddable in raid');
  else if (md.toolMod) row('NOTE', 'needs a tool to move in raid');
  if (tpl.slots?.length) row('SLOTS', tpl.slots.map((s) => s.label).join(', '));
  const n = [...item.allMods()].length;
  if (n) row('ATTACHED', `${n} part${n === 1 ? '' : 's'}`);
  return true;
}

function ammoRows(item, row) {
  const tpl = item.tpl;
  const a = tpl.ammo || {};
  if (tpl.cal) row('CALIBER', tpl.cal);
  if (a.type && a.type !== 'bullet') row('TYPE', a.type);
  if (a.proj > 1) row('PROJECTILES', String(a.proj));
  row('DAMAGE', a.proj > 1 ? `${a.proj} x ${a.dmg}` : String(a.dmg ?? tpl.dmg ?? 0));
  row('PENETRATION', String(a.pen ?? tpl.pen ?? 0));
  if (a.armorDmg) row('ARMOR DAMAGE', `${a.armorDmg}%`);
  if (a.frag) row('FRAGMENTATION', `${Math.round(a.frag * 100)}%${a.frags ? ` (${a.frags[0]}–${a.frags[1]})` : ''}`);
  if (a.speed) row('VELOCITY', `${a.speed} m/s${a.subsonic ? ' · subsonic' : ''}`);
  if (a.rec) row('RECOIL', pct(a.rec));
  if (a.acc) row('ACCURACY', pct(a.acc));
  if (a.lbleed) row('LIGHT BLEED', pct(Math.round(a.lbleed * 100)));
  if (a.hbleed) row('HEAVY BLEED', pct(Math.round(a.hbleed * 100)));
  if (a.ric) row('RICOCHET', `${Math.round(a.ric * 100)}%`);
  if (a.dburn && a.dburn !== 1) row('DURABILITY BURN', mul(a.dburn));
  if (a.heat && a.heat !== 1) row('HEAT', mul(a.heat));
  if (a.misfire) row('MISFIRE', `${chanceWord(a.misfire)} (${(a.misfire * 100).toFixed(1)}%)`);
  if (a.feed) row('FEED FAILURE', `${chanceWord(a.feed)} (${(a.feed * 100).toFixed(1)}%)`);
  if (a.tracer) row('TRACER', String(a.tracerColor || 'yes').replace(/^tracer/i, '').toLowerCase() || 'yes');
  if (a.mass) row('BULLET', `${a.mass} g${a.diam ? ` · ${a.diam} mm` : ''}`);
  row('VS ARMOR (FRESH)', armorStripText(a.pen ?? tpl.pen ?? 0));
  return true;
}

function boxRows(item, row) {
  const b = item.tpl.box || {};
  const inner = getTpl(b.t);
  if (item.tpl.cal) row('CALIBER', item.tpl.cal);
  row('CONTENTS', inner ? `${b.n} x ${inner.short || inner.name}` : `${b.n} rounds`);
  if (inner?.ammo) {
    row('DAMAGE', inner.ammo.proj > 1 ? `${inner.ammo.proj} x ${inner.ammo.dmg}` : String(inner.ammo.dmg));
    row('PENETRATION', String(inner.ammo.pen ?? 0));
  }
  row('NOTE', 'unpack to use');
  return true;
}

function kitRows(item, row) {
  const k = item.tpl.repairKit || {};
  const max = item.tpl.res?.max || k.max || 0;
  row('RESOURCE', `${Math.round(item.res ?? max)} / ${max}`);
  row('REPAIRS', `${Math.floor((item.res ?? max) / 0.5)} durability points`);
  row('FOR', k.type === 'weapon' ? 'firearms' : k.type);
  return true;
}

/** [3,3,10,10] -> "3-10x", [4,4] -> "4x", [1] -> "1x" */
function zoomLabel(zz) {
  const lo = Math.min(...zz), hi = Math.max(...zz);
  return lo === hi ? `${lo}x` : `${lo}–${hi}x`;
}
