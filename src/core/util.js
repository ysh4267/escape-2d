// =========================================================
// small shared helpers
// =========================================================

let _uid = 0;
export function uid(prefix = 'u') {
  _uid += 1;
  return `${prefix}${_uid.toString(36)}${Math.floor(Math.random() * 46656).toString(36).padStart(3, '0')}`;
}
export function seedUidCounter(n) { _uid = Math.max(_uid, n | 0); }

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const dist2 = (ax, ay, bx, by) => (ax - bx) ** 2 + (ay - by) ** 2;
export const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);

/** a whole number the way the game writes one: thousands set apart by a space */
export function fmtNum(n) {
  return Math.round(n).toLocaleString('en-US').replace(/,/g, ' ');
}
/** 2 400 000 -> 2.4M, 42 300 -> 42.3k: the short form the trader screens use */
export function fmtShort(n) {
  const v = Math.abs(n);
  const cut = (x) => String(Math.round(x * 10) / 10);
  if (v >= 1e6) return `${cut(n / 1e6)}M`;
  if (v >= 1e3) return `${cut(n / 1e3)}k`;
  return String(Math.round(n));
}
export function fmtMoney(n, cur = 'RUB') {
  const sym = { RUB: '₽', USD: '$', EUR: '€' }[cur] || '';
  return cur === 'RUB' ? `${fmtNum(n)}${sym}` : `${sym}${fmtNum(n)}`;
}
export function fmtWeight(kg) {
  return `${(Math.round(kg * 100) / 100).toFixed(2)}`;
}
export function fmtClock(sec) {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
/** a day the way the game writes one: 07.03.2026 */
export function fmtDate(ms) {
  const d = new Date(ms);
  const two = (n) => String(n).padStart(2, '0');
  return `${two(d.getDate())}.${two(d.getMonth() + 1)}.${d.getFullYear()}`;
}

// ---------- dom ----------
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') node.innerHTML = v;
    else if (v === true) node.setAttribute(k, '');
    else node.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

export function icon(name, cls = 'ico') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', cls);
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#i-${name}`);
  svg.append(use);
  return svg;
}

export function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

/**
 * Re-render without throwing the player back to the top of a list.
 * Replacing the children of a scroll box collapses its content height, which
 * clamps scrollTop to 0 — so every repaint used to scroll the stash home.
 */
export function keepScroll(hosts, fn) {
  const saved = [];
  for (const h of hosts) if (h) saved.push([h, h.scrollTop, h.scrollLeft]);
  try { fn(); }
  finally { for (const [h, top, left] of saved) { h.scrollTop = top; h.scrollLeft = left; } }
}

// ---------- misc ----------
export function deepClone(o) {
  return typeof structuredClone === 'function' ? structuredClone(o) : JSON.parse(JSON.stringify(o));
}

export function groupBy(arr, keyFn) {
  const m = new Map();
  for (const it of arr) {
    const k = keyFn(it);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(it);
  }
  return m;
}

export function debounce(fn, ms = 120) {
  let t = 0;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

export function titleCase(s) {
  return String(s).replace(/(^|[\s-])(\w)/g, (_, a, b) => a + b.toUpperCase());
}
