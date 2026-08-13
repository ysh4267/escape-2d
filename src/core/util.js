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

export function fmtNum(n) {
  return Math.round(n).toLocaleString('en-US');
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
