// =========================================================
// the data in the language in use
//
// The data files carry the game's English. When the interface is in another
// language the game's own translations are laid over them: a table a
// language (tools/build_names.py -> src/data/names-<lang>.json), keyed by the
// same ids, holding only what differs. It is applied once, in place, right
// after the data is loaded and before anything is drawn, so every module that
// reads a name off a template, a task or a trader gets the translated one
// without knowing there are languages at all. English has no table and
// nothing is touched; where a translation is missing the English stays.
//
// Changing language reloads the page, which loads the data fresh.
// =========================================================

import { BY_ID } from '../data/items.js';
import { DB } from './db.js';
import { language } from '../core/i18n.js';

async function fetchNames(lang) {
  try {
    const res = await fetch(`src/data/names-${lang}.json`);
    return res.ok ? await res.json() : null;
  } catch { return null; }
}

/** lay the names of the language in use over the item templates and the meta data */
export async function localizeData() {
  const lang = language();
  if (lang === 'en') return false;
  const names = await fetchNames(lang);
  if (!names) return false;

  for (const [id, [name, short, desc]] of Object.entries(names.items || {})) {
    const tpl = BY_ID[id];
    if (!tpl) continue;
    if (name) tpl.name = name;
    if (short) tpl.short = short;
    if (desc) tpl.desc = desc;
  }

  for (const task of DB.tasks) {
    const row = names.tasks?.[task.id];
    if (!row) continue;
    if (row.n) task.name = row.n;
    if (row.d) task.desc = row.d;
    if (row.ok) task.okMsg = row.ok;
    if (row.fail) task.failMsg = row.fail;
    if (row.o) {
      for (const o of [...task.obj, ...(task.fail || [])]) if (row.o[o.id]) o.text = row.o[o.id];
    }
  }

  for (const trader of DB.traders) {
    const row = names.traders?.[trader.id];
    if (!row) continue;
    if (row.n) trader.name = row.n;
    if (row.f) trader.fullName = row.f;
    if (row.l) trader.location = row.l;
    if (row.d) trader.desc = row.d;
  }

  for (const loc of DB.progress?.locations || []) {
    const row = names.locations?.[loc.id];
    if (!row) continue;
    if (row.n) loc.name = row.n;
    if (row.d) loc.desc = row.d;
  }

  for (const s of DB.progress?.skills || []) {
    if (names.skills?.[s.id]) s.name = names.skills[s.id];
  }

  for (const a of DB.achievements || []) {
    const row = names.achievements?.[a.id];
    if (!row) continue;
    if (row[0]) a.name = row[0];
    if (row[1]) a.desc = row[1];
  }

  // the hideout's stations load later and on their own; they ask for theirs then
  pending.stations = names.stations || {};
  return true;
}

const pending = { stations: null };

/** the hideout data arrives after boot: translate it when it does */
export function localizeStations(stations) {
  if (!pending.stations) return;
  for (const st of stations || []) {
    const row = pending.stations[st.id];
    if (!row) continue;
    if (row.n) st.name = row.n;
    (row.d || []).forEach((d, i) => { if (d && st.levels?.[i]) st.levels[i].desc = d; });
  }
}
