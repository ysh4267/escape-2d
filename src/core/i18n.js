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

/** `{0}` and, padded with noughts the way the client's formatter pads, `{1:00}` */
function fill(s, args) {
  return s.replace(/\{(\d+)(?::(0+))?\}/g, (m, i, pad) => {
    if (args[i] == null) return m;
    return pad ? String(args[i]).padStart(pad.length, '0') : String(args[i]);
  });
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
  if (args.length) s = fill(s, args);
  return s;
}

/**
 * The same, for a string the client has marked up: some carry their own
 * colours - `R: <color=#C3C5BBFF>{0}</color>` - and come back as nodes with
 * the colour applied instead of as text with the tags in it. Tags other than
 * colour and bold are dropped and their text kept.
 * @returns {DocumentFragment}
 */
export function tRich(key, ...args) {
  const out = document.createDocumentFragment();
  const text = t(key, ...args).replace(/<\/?(?!(?:color|b)\b)[a-z][^>]*>/gi, '');
  const re = /<(\/?)(color|b)(?:=([^>]+))?>/gi;
  const stack = [out];
  let at = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > at) stack[stack.length - 1].append(text.slice(at, m.index));
    at = re.lastIndex;
    if (m[1]) { if (stack.length > 1) stack.pop(); continue; }
    const node = document.createElement(m[2].toLowerCase() === 'b' ? 'b' : 'span');
    if (m[3]) node.style.color = m[3].trim();
    stack[stack.length - 1].append(node);
    stack.push(node);
  }
  if (at < text.length) stack[stack.length - 1].append(text.slice(at));
  return out;
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
