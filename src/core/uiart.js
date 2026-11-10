// =========================================================
// interface art
//
// The plates, icons, portraits and the typeface the interface is drawn with
// are the game client's own, cut out of a local install and shipped sealed
// (tools/build_ui.py, the same container as the sound pack). One pack is
// opened at boot; a few bigger sets - skill pictures, level badges, location
// banners - sit in packs of their own and are fetched by the screen that
// shows them.
//
// Every image in a pack becomes an object URL, published two ways:
//
//   css   a custom property on :root, `--ui-<name>`, to be read as
//         background-image: var(--ui-tab_selected_fill)
//   js    uiUrl(name) / uiImg(name) / uiIcon(name)
//
// A name with nothing behind it (a pack that would not open, a sprite that
// was never packed) is an unset property and an empty src: the rule that
// reads it draws nothing, and the flat colour under it still does.
// =========================================================

import { openSealed } from './seal.js';

const MAGIC = 'E2UI01';
const DIR = 'assets/ui-eft/';

/** name -> object URL */
const urls = new Map();
/** name -> { w, h, border:[t,r,b,l]|null } */
const meta = new Map();
/** pack name -> promise of its being loaded */
const packs = new Map();

let sheet = null;

function publish(pack) {
  if (!sheet) {
    sheet = document.createElement('style');
    sheet.id = 'ui-art';
    document.head.append(sheet);
  }
  const lines = [];
  for (const [name, row] of Object.entries(pack.header.files || {})) {
    const [off, len, mime, w, h, border] = row;
    if (urls.has(name)) continue;
    const url = URL.createObjectURL(new Blob([pack.body.subarray(off, off + len)], { type: mime }));
    urls.set(name, url);
    meta.set(name, { w, h, border: border || null });
    lines.push(`--ui-${name}:url("${url}");`);
  }
  if (lines.length) sheet.append(document.createTextNode(`:root{${lines.join('')}}`));

  const faces = [];
  for (const f of pack.header.fonts || []) {
    const [off, len] = f.at;
    try {
      const face = new FontFace(f.family, pack.body.slice(off, off + len).buffer, { weight: String(f.weight), style: f.style });
      faces.push(face.load().then((ready) => document.fonts.add(ready)).catch(() => {}));
    } catch { /* an engine without the FontFace API falls back to the stack in the stylesheet */ }
  }
  return Promise.all(faces);
}

function load(name) {
  if (packs.has(name)) return packs.get(name);
  const p = openSealed(`${DIR}${name}.bin`, MAGIC).then((pack) => {
    if (!pack) { console.warn(`[uiart] ${name}.bin did not open`); return false; }
    return publish(pack).then(() => true);
  });
  packs.set(name, p);
  return p;
}

/** the pack every screen draws from; awaited before the interface is built */
export function loadUiArt() { return load('pack'); }

/** one of the side packs: 'skills', 'ranks', 'factions', 'locations', 'splash', ... */
export function loadUiGroup(name) { return load(name); }

export function hasUi(name) { return urls.has(name); }
export function uiUrl(name) { return urls.get(name) || ''; }
export function uiMeta(name) { return meta.get(name) || null; }

/**
 * The sprite as an <img>, at the size the client draws it unless told otherwise.
 * @param {string} name
 * @param {string} [cls]
 * @param {{w?:number,h?:number}} [size]
 */
export function uiImg(name, cls = '', size = null) {
  const img = document.createElement('img');
  img.alt = '';
  img.draggable = false;
  if (cls) img.className = cls;
  const m = meta.get(name);
  const url = urls.get(name);
  if (url) img.src = url; else img.dataset.missing = name;
  const w = size?.w ?? m?.w, h = size?.h ?? m?.h;
  if (w) img.width = w;
  if (h) img.height = h;
  return img;
}

/**
 * The sprite as a tintable glyph: most of the client's icons are white and
 * take their colour from the element that shows them, so this draws the
 * sprite's alpha in currentColor.
 */
export function uiIcon(name, cls = '', size = null) {
  const span = document.createElement('span');
  span.className = `uii${cls ? ` ${cls}` : ''}`;
  const m = meta.get(name);
  const w = size?.w ?? m?.w, h = size?.h ?? m?.h;
  if (w) span.style.width = `${w}px`;
  if (h) span.style.height = `${h}px`;
  if (urls.has(name)) {
    span.style.webkitMaskImage = `var(--ui-${name})`;
    span.style.maskImage = `var(--ui-${name})`;
  } else span.dataset.missing = name;
  return span;
}

/** point an existing <img> at a sprite that may still be on its way */
export function setUiSrc(img, name, group = null) {
  const url = urls.get(name);
  if (url) { img.src = url; return; }
  if (!group) return;
  loadUiGroup(group).then(() => { const u = urls.get(name); if (u) img.src = u; });
}
