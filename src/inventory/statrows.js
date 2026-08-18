// =========================================================
// the stat rows a tooltip / inspect window shows for guns, parts, mags, ammo
//
// One place for both, so what hovers matches what the inspect window says.
// `row(key, value)` is supplied by the caller.
// =========================================================

import { FIRE_MODE_LABEL, modTypeLabel } from '../data/items.js';
import { weaponStats, describeRounds } from './weapon.js';

const pct = (v) => `${v > 0 ? '+' : ''}${v}%`;
const sgn = (v) => `${v > 0 ? '+' : ''}${v}`;

export function statRows(item, row) {
  const tpl = item.tpl;
  if (item.isWeapon) return weaponRows(item, row);
  if (item.isMag) return magRows(item, row);
  if (tpl.cat === 'mod') return modRows(item, row);
  if (tpl.cat === 'ammo') return ammoRows(item, row);
  return false;
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
  if (st.maxDura) row('DURABILITY', `${Math.round(st.dura ?? st.maxDura)} / ${st.maxDura}`);
  if (wpn.fold) row('STOCK', item.folded ? 'folded' : 'unfolded');
  const n = [...item.allMods()].length;
  row('PARTS', n ? `${n} installed` : 'stripped');
  if (st.missing.length) row('MISSING', st.missing.map((s) => s.label).join(', '));
  return true;
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
  if (mg.load) row('LOAD SPEED', pct(mg.load));
  if (mg.check) row('CHECK SPEED', pct(mg.check));
  if (mg.malf) row('MALFUNCTION', `${(mg.malf * 100).toFixed(1)}%`);
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
  if (md.zoom) row('MAGNIFICATION', `${md.zoom}x`);
  if (md.loud) row('LOUDNESS', sgn(md.loud));
  if (md.heat && md.heat !== 1) row('HEAT', pct(Math.round((md.heat - 1) * 100)));
  if (md.cool && md.cool !== 1) row('COOLING', pct(Math.round((md.cool - 1) * 100)));
  if (md.dburn && md.dburn !== 1) row('DURABILITY BURN', pct(Math.round((md.dburn - 1) * 100)));
  if (md.blocksFold) row('NOTE', 'blocks stock folding');
  if (md.noRaidMod) row('NOTE', 'not moddable in raid');
  if (tpl.slots?.length) row('SLOTS', tpl.slots.map((s) => s.label).join(', '));
  const n = [...item.allMods()].length;
  if (n) row('ATTACHED', `${n} part${n === 1 ? '' : 's'}`);
  return true;
}

function ammoRows(item, row) {
  const tpl = item.tpl;
  const a = tpl.ammo || {};
  if (tpl.cal) row('CALIBER', tpl.cal);
  if (a.proj > 1) row('PROJECTILES', String(a.proj));
  row('DAMAGE', a.proj > 1 ? `${a.dmg} x ${a.proj}` : String(a.dmg ?? tpl.dmg ?? 0));
  row('PENETRATION', String(a.pen ?? tpl.pen ?? 0));
  if (a.armorDmg) row('ARMOR DAMAGE', `${a.armorDmg}%`);
  if (a.frag) row('FRAGMENTATION', `${Math.round(a.frag * 100)}%`);
  if (a.speed) row('VELOCITY', `${a.speed} m/s`);
  if (a.rec) row('RECOIL', pct(a.rec));
  if (a.acc) row('ACCURACY', pct(a.acc));
  if (a.lbleed) row('LIGHT BLEED', pct(Math.round(a.lbleed * 100)));
  if (a.hbleed) row('HEAVY BLEED', pct(Math.round(a.hbleed * 100)));
  if (a.ric) row('RICOCHET', `${Math.round(a.ric * 100)}%`);
  if (a.misfire) row('MISFIRE', `${(a.misfire * 100).toFixed(1)}%`);
  if (a.dburn && a.dburn !== 1) row('DURABILITY BURN', pct(Math.round((a.dburn - 1) * 100)));
  if (a.tracer) row('TRACER', a.tracerColor || 'yes');
  if (a.mass) row('BULLET', `${a.mass} g`);
  return true;
}
