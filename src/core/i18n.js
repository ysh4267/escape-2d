// =========================================================
// interface strings
//
// The interface says what the game says. Its strings are not written out in
// the modules that show them; they are asked for by the client's own locale
// key - t('QuestsShowCompleted') - and answered out of a table cut from the
// game's locale for the language in use (tools/build_locale.py writes
// src/data/locale-<lang>.json with exactly the keys the page asks for).
//
// A key the table does not have comes back as the fallback given, or as the
// key itself: most of the client's keys are the English text already
// ('DEAL!', 'Current attitude:'), so a miss still reads correctly.
// =========================================================

let table = {};
let lang = 'en';

export const LANGUAGES = { en: 'English', ko: '한국어' };

export function language() { return lang; }

/** load the table for a language; a language with no table keeps the last one */
export async function loadLocale(next = 'en') {
  try {
    const res = await fetch(`src/data/locale-${next}.json`);
    if (!res.ok) throw new Error(String(res.status));
    table = await res.json();
    lang = next;
    document.documentElement.lang = next;
    return true;
  } catch (err) {
    console.warn(`[i18n] no table for "${next}"`, err);
    return false;
  }
}

/**
 * The string behind a locale key. `{0}`, `{1}` are filled from the arguments,
 * as the client's own formatter does.
 * @param {string} key
 * @param {...(string|number)} args
 */
export function t(key, ...args) {
  let s = table[key];
  if (s == null) s = key;
  if (args.length) s = s.replace(/\{(\d+)\}/g, (m, i) => (args[i] != null ? String(args[i]) : m));
  return s;
}

/** the string, or `fallback` when the table has nothing for the key */
export function tOr(key, fallback) {
  const s = table[key];
  return s == null ? fallback : s;
}

export function hasKey(key) { return table[key] != null; }

/**
 * A string the client has no key for - a control or a note that only this
 * build has - written out at the call site in each language it speaks.
 */
export function own(en, ko) { return lang === 'ko' && ko ? ko : en; }
