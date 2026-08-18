// =========================================================
// the gun in three dimensions
//
// A floating window that shows the assembled weapon built from the game's
// own meshes: the receiver, and every part hung on it at the transform of the
// slot it sits in - the same tree the modding screen edits, so it re-assembles
// as parts go on and come off. Hover a part to name it, click it to pick its
// slot in the modding screen, drag a part from the stash onto the view and it
// goes into the nearest slot that takes it.
//
// Assets: assets/models/<templateId>.pak, one per weapon / part / magazine,
// sealed like the sound pack (src/core/seal.js), quantised positions and uvs,
// a diffuse JPEG per material; src/data/models-index.json says which items
// have one. Geometry comes out of the client's bundles left-handed with the
// weapon pointing down -Y and up +Z ("attach frame"); it is mirrored on X on
// load (positions negated, triangles rewound, slot rotations conjugated) and
// the scene root is turned so that up is +Y and the muzzle points +Z.
//
// three.js is vendored (assets/vendor/three.module.min.js, MIT) and loaded
// only when a viewer opens.
// =========================================================

import { el, icon } from '../core/util.js';
import { ensureHost, makeDraggable, bringToFront, isLive, registerWindowRefresher, flash } from './window.js';
import { openSealed } from '../core/seal.js';
import { sfx } from '../core/audio.js';
import { isDragging } from './dnd.js';
import { isKnown } from './examine.js';

const MAGIC = 'E2MDL1';
const INDEX_URL = new URL('../data/models-index.json', import.meta.url).href;
const PAK_URL = (id) => new URL(`../../assets/models/${id}.pak`, import.meta.url).href;
const THREE_URL = new URL('../../assets/vendor/three.module.min.js', import.meta.url).href;

let THREE = null;
let index = null;          // { ids: { id: {k, b, s, sz} } } or false when absent
let indexPromise = null;
const paks = new Map();    // id -> Promise<{header, body} | null>
const geoms = new Map();   // `${id}#${i}` -> BufferGeometry
const texs = new Map();    // `${id}#${name}` -> Texture

/** uid -> viewer record */
const open = new Map();
let registered = false;

// ---------------------------------------------------------
// index and packs
// ---------------------------------------------------------
export async function loadModelIndex() {
  if (index !== null) return index;
  if (!indexPromise) {
    indexPromise = fetch(INDEX_URL).then((r) => (r.ok ? r.json() : false)).catch(() => false)
      .then((j) => { index = j && j.ids ? j : false; return index; });
  }
  return indexPromise;
}

/** does the database of models carry this template (synchronous once the index is in) */
export function hasModel(tpl) {
  return !!(index && index.ids && tpl?.id && index.ids[tpl.id]);
}

export function modelsAvailable() { return !!(index && index.ids); }

function getPak(id) {
  if (!paks.has(id)) paks.set(id, openSealed(PAK_URL(id), MAGIC));
  return paks.get(id);
}

async function three() {
  if (!THREE) THREE = await import(THREE_URL);
  return THREE;
}

// ---------------------------------------------------------
// geometry out of a pak
// ---------------------------------------------------------
const mirrorPos = (p) => [-p[0], p[1], p[2]];
const mirrorQuat = (q) => [q[0], -q[1], -q[2], q[3]];

function geometryFor(id, pak, i) {
  const key = `${id}#${i}`;
  if (geoms.has(key)) return geoms.get(key);
  const m = pak.header.meshes[i];
  const body = pak.body;
  const n = m.n;
  const pos = new Float32Array(n * 3);
  const q = m.q;
  const src = new Uint16Array(body.buffer, body.byteOffset + m.pos[0], n * 3);
  const rx = q[1][0] - q[0][0], ry = q[1][1] - q[0][1], rz = q[1][2] - q[0][2];
  for (let v = 0; v < n; v++) {
    // mirrored on X: the client's data is left-handed
    pos[v * 3] = -(q[0][0] + src[v * 3] / 65535 * rx);
    pos[v * 3 + 1] = q[0][1] + src[v * 3 + 1] / 65535 * ry;
    pos[v * 3 + 2] = q[0][2] + src[v * 3 + 2] / 65535 * rz;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  if (m.uv && m.uvq) {
    const uvs = new Float32Array(n * 2);
    const su = new Uint16Array(body.buffer, body.byteOffset + m.uv[0], n * 2);
    const ru = m.uvq[1][0] - m.uvq[0][0], rv = m.uvq[1][1] - m.uvq[0][1];
    for (let v = 0; v < n; v++) {
      uvs[v * 2] = m.uvq[0][0] + su[v * 2] / 65535 * ru;
      uvs[v * 2 + 1] = m.uvq[0][1] + su[v * 2 + 1] / 65535 * rv;
    }
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  }
  const ic = m.i;
  const idx = m.idx32
    ? new Uint32Array(body.buffer.slice(body.byteOffset + m.idx[0], body.byteOffset + m.idx[0] + ic * 4))
    : new Uint16Array(body.buffer.slice(body.byteOffset + m.idx[0], body.byteOffset + m.idx[0] + ic * 2));
  // the mirror turned every triangle inside out: rewind them
  for (let t = 0; t + 2 < idx.length; t += 3) { const b = idx[t + 1]; idx[t + 1] = idx[t + 2]; idx[t + 2] = b; }
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeVertexNormals();
  geoms.set(key, geo);
  return geo;
}

function textureFor(id, pak, name) {
  const key = `${id}#${name}`;
  if (texs.has(key)) return texs.get(key);
  const t = pak.header.textures?.[name];
  if (!t) return null;
  const blob = new Blob([pak.body.subarray(t.off, t.off + t.len)], { type: t.mime || 'image/jpeg' });
  const url = URL.createObjectURL(blob);
  const tex = new THREE.TextureLoader().load(url, () => URL.revokeObjectURL(url));
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  texs.set(key, tex);
  return tex;
}

function materialFor(id, pak, m) {
  const map = m.tex ? textureFor(id, pak, m.tex) : null;
  const color = m.color ? new THREE.Color(m.color[0], m.color[1], m.color[2]) : new THREE.Color(0.55, 0.55, 0.55);
  return new THREE.MeshStandardMaterial({
    map: map || null, color: map ? 0xffffff : color, roughness: 0.68, metalness: 0.15,
  });
}

// ---------------------------------------------------------
// the assembled tree
// ---------------------------------------------------------
/** slot name in the model for a template slot name: exact, then without a numeric suffix */
function slotTransform(pak, name) {
  const s = pak?.header.slots;
  if (!s) return null;
  if (s[name]) return s[name];
  const base = name.replace(/_\d+$/, '');
  if (s[base]) return s[base];
  const cand = Object.keys(s).find((k) => k.replace(/_\d+$/, '') === base);
  return cand ? s[cand] : null;
}

async function buildNode(item, rec, depth = 0) {
  const T = THREE;
  const g = new T.Group();
  g.userData.item = item;
  // packs are filed by the game's template id, not our key
  const tid = item.tpl.id;
  const pak = tid ? await getPak(tid) : null;
  if (pak) {
    pak.header.meshes.forEach((m, i) => {
      const mesh = new T.Mesh(geometryFor(tid, pak, i), materialFor(tid, pak, m));
      mesh.position.set(...mirrorPos(m.p || [0, 0, 0]));
      mesh.quaternion.set(...mirrorQuat(m.r || [0, 0, 0, 1]));
      if (m.s) mesh.scale.set(m.s[0], m.s[1], m.s[2]);
      mesh.userData.item = item;
      mesh.userData.node = g;
      g.add(mesh);
    });
  } else {
    rec.missing.add(item.tpl.short || item.tplId);
  }
  const foldSlot = item.folded ? (item.tpl.wpn?.foldSlot || item.tpl.mod?.foldSlot) : null;
  for (const sl of item.slots || []) {
    if (!sl.item) {
      // an empty slot is still a place: remember where it is for drops
      const tf = slotTransform(pak, sl.name);
      if (tf) {
        const anchor = new T.Group();
        anchor.position.set(...mirrorPos(tf.p));
        anchor.quaternion.set(...mirrorQuat(tf.r));
        anchor.userData.slot = sl;
        anchor.userData.empty = true;
        g.add(anchor);
      }
      continue;
    }
    const child = await buildNode(sl.item, rec, depth + 1);
    child.userData.slot = sl;
    const tf = slotTransform(pak, sl.name);
    if (tf) {
      child.position.set(...mirrorPos(tf.p));
      child.quaternion.set(...mirrorQuat(tf.r));
    } else {
      child.userData.unplaced = true;
      child.visible = depth === 0;   // a part with no slot in the model sits at the origin; deeper ones hide
    }
    if (foldSlot && sl.name === foldSlot) {
      // a folded side-folder lies forward along the left of the receiver
      child.rotateZ(Math.PI);
      child.position.x += 0.035;
    }
    g.add(child);
  }
  return g;
}

/** a string that changes whenever the tree, the fold or the item's model set changes */
function signature(item) {
  const parts = [];
  const walk = (it, d) => {
    parts.push(`${d}:${it.tplId}${it.folded ? '~' : ''}`);
    for (const sl of it.slots || []) if (sl.item) { parts.push(sl.name); walk(sl.item, d + 1); }
  };
  walk(item, 0);
  return parts.join('|');
}

// ---------------------------------------------------------
// the window
// ---------------------------------------------------------
export async function openViewer3D(item, opts = {}) {
  if (!item || !item.hasMods || !isKnown(item)) return null;
  const root = item.root;
  const existing = open.get(root.uid);
  if (existing) { if (opts.onPick) existing.onPick = opts.onPick; bringToFront(existing.node); flash(existing.node); return existing.node; }
  await loadModelIndex();
  await three();
  if (!registered) { registerWindowRefresher(refreshViewers); registered = true; }

  const layer = ensureHost();
  const node = el('div', { class: 'cwin cwin--3d', dataset: { uid: root.uid } });
  const meta = el('span', { class: 'cwin__meta' }, '');
  const head = el('div', { class: 'cwin__head' },
    icon('crosshair'),
    el('span', { class: 'cwin__title' }, `3D — ${root.tpl.name}`),
    meta,
    el('button', {
      class: 'cwin__close', title: 'Close',
      onclick: (e) => { e.stopPropagation(); closeViewer3D(root.uid); },
    }, icon('close', 'ico ico--sm')));
  const wrap = el('div', { class: 'slot viewer3d', title: 'Drag: turn · wheel: zoom · right-drag: pan · click a part to pick its slot · drop a part here to fit it' });
  const canvas = el('canvas', { class: 'viewer3d__canvas' });
  const hint = el('div', { class: 'viewer3d__hint' }, '');
  const bar = el('div', { class: 'viewer3d__bar' },
    el('button', { class: 'btn btn--sm', onclick: () => { fit(rec); } }, 'RESET VIEW'),
    el('span', { class: 'viewer3d__note' }, ''));
  wrap.append(canvas, hint);
  node.append(head, wrap, bar);
  const i = open.size % 4;
  node.style.left = `${420 + i * 30}px`;
  node.style.top = `${120 + i * 30}px`;
  makeDraggable(node, head);
  node.addEventListener('pointerdown', () => bringToFront(node), true);
  layer.append(node);

  const T = THREE;
  const W = 640, H = 380;
  const renderer = new T.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.setSize(W, H, false);
  renderer.outputColorSpace = T.SRGBColorSpace;
  const scene = new T.Scene();
  scene.background = null;
  const camera = new T.PerspectiveCamera(32, W / H, 0.01, 50);
  const hemi = new T.HemisphereLight(0xdfe8ee, 0x22282d, 1.5);
  const sun = new T.DirectionalLight(0xffffff, 2.0); sun.position.set(2, 3, 2.5);
  const fill = new T.DirectionalLight(0x9fb4c4, 0.6); fill.position.set(-2.5, 1, -1.5);
  scene.add(hemi, sun, fill);
  // the pivot the tree hangs from: attach frame turned to Y-up, muzzle +Z
  const pivot = new T.Group();
  pivot.rotation.x = -Math.PI / 2;
  scene.add(pivot);
  const grid = new T.GridHelper(1.2, 12, 0x2f3d46, 0x1f2a31);
  grid.position.y = -0.14;
  scene.add(grid);

  const rec = {
    item: root, node, wrap, canvas, hint, note: bar.querySelector('.viewer3d__note'), meta,
    renderer, scene, camera, pivot, tree: null, sig: '', missing: new Set(),
    yaw: 1.05, pitch: 0.22, dist: 1.2, target: new T.Vector3(), hover: null, picked: null,
    onPick: opts.onPick || null, raf: 0, dirty: true, building: false,
  };
  open.set(root.uid, rec);
  bringToFront(node);
  bindControls(rec);
  await rebuild(rec, true);
  loop(rec);
  sfx.ui('inspect_open');
  return node;
}

export function closeViewer3D(uid) {
  const rec = open.get(uid);
  if (!rec) return;
  cancelAnimationFrame(rec.raf);
  rec.renderer.dispose();
  rec.node.remove();
  open.delete(uid);
  sfx.ui('close');
}

export function closeAllViewers3D() {
  for (const uid of Array.from(open.keys())) closeViewer3D(uid);
}

export function refreshViewers() {
  for (const [uid, rec] of Array.from(open.entries())) {
    if (!isLive(rec.item) || !isKnown(rec.item)) { closeViewer3D(uid); continue; }
    if (signature(rec.item) !== rec.sig) rebuild(rec, false);
  }
}

async function rebuild(rec, first) {
  if (rec.building) { rec.rebuildAgain = true; return; }
  rec.building = true;
  const sig = signature(rec.item);
  rec.missing = new Set();
  const tree = await buildNode(rec.item, rec);
  if (rec.tree) rec.pivot.remove(rec.tree);
  rec.tree = tree;
  rec.pivot.add(tree);
  rec.sig = sig;
  rec.building = false;
  rec.dirty = true;
  if (first) fit(rec);
  rec.note.textContent = rec.missing.size ? `no model for: ${[...rec.missing].join(', ')}` : `${countMeshes(tree)} meshes`;
  if (rec.rebuildAgain) { rec.rebuildAgain = false; rebuild(rec, false); }
}

function countMeshes(g) { let n = 0; g.traverse((o) => { if (o.isMesh) n++; }); return n; }

/** frame the whole gun */
function fit(rec) {
  const T = THREE;
  // the pivot has not been through a render yet on the first fit: its own
  // matrix has to be current or the box comes out in the attach frame
  rec.scene.updateMatrixWorld(true);
  const box = new T.Box3().setFromObject(rec.tree);
  if (box.isEmpty()) { rec.target.set(0, 0, 0); rec.dist = 1.2; rec.dirty = true; return; }
  const size = new T.Vector3(); box.getSize(size);
  box.getCenter(rec.target);
  const span = Math.max(size.x, size.y, size.z, 0.2);
  rec.dist = span / (2 * Math.tan((rec.camera.fov * Math.PI / 180) / 2)) * 0.95;
  // three-quarter from the left, a little above: the way the game shows a gun
  rec.yaw = 1.05; rec.pitch = 0.22;
  rec.dirty = true;
}

function placeCamera(rec) {
  const c = rec.camera;
  const x = rec.target.x + rec.dist * Math.cos(rec.pitch) * Math.sin(rec.yaw);
  const y = rec.target.y + rec.dist * Math.sin(rec.pitch);
  const z = rec.target.z + rec.dist * Math.cos(rec.pitch) * Math.cos(rec.yaw);
  c.position.set(x, y, z);
  c.lookAt(rec.target);
}

function loop(rec) {
  rec.raf = requestAnimationFrame(() => loop(rec));
  if (!rec.dirty) return;
  rec.dirty = false;
  placeCamera(rec);
  rec.renderer.render(rec.scene, rec.camera);
}

// ---------------------------------------------------------
// controls: orbit, pick, drop
// ---------------------------------------------------------
function bindControls(rec) {
  const T = THREE;
  const canvas = rec.canvas;
  let down = null;
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointerdown', (e) => {
    if (isDragging()) return;
    down = { x: e.clientX, y: e.clientY, b: e.button, moved: false };
    canvas.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (down) {
      const dx = e.clientX - down.x, dy = e.clientY - down.y;
      if (Math.abs(dx) + Math.abs(dy) > 2) down.moved = true;
      if (down.b === 2 || e.shiftKey) {
        // pan in the camera plane
        const right = new T.Vector3(), up = new T.Vector3();
        rec.camera.matrixWorld.extractBasis(right, up, new T.Vector3());
        const k = rec.dist * 0.0018;
        rec.target.addScaledVector(right, -dx * k).addScaledVector(up, dy * k);
      } else {
        rec.yaw -= dx * 0.008;
        rec.pitch = Math.max(-1.45, Math.min(1.45, rec.pitch + dy * 0.008));
      }
      down.x = e.clientX; down.y = e.clientY;
      rec.dirty = true;
      return;
    }
    hover(rec, e);
  });
  const end = (e) => {
    if (!down) return;
    const wasClick = !down.moved && down.b === 0;
    down = null;
    try { canvas.releasePointerCapture(e.pointerId); } catch { /* fine */ }
    if (wasClick) pick(rec, e);
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', () => { down = null; });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    rec.dist = Math.max(0.15, Math.min(6, rec.dist * (e.deltaY > 0 ? 1.12 : 0.89)));
    rec.dirty = true;
  }, { passive: false });
  canvas.addEventListener('pointerleave', () => { setHover(rec, null); rec.hint.textContent = ''; });
}

function castAt(rec, e) {
  const T = THREE;
  const r = rec.canvas.getBoundingClientRect();
  const nx = ((e.clientX - r.left) / r.width) * 2 - 1;
  const ny = -((e.clientY - r.top) / r.height) * 2 + 1;
  const ray = new T.Raycaster();
  ray.setFromCamera(new T.Vector2(nx, ny), rec.camera);
  const hits = ray.intersectObject(rec.tree, true);
  return hits.length ? hits[0].object : null;
}

function setHover(rec, mesh) {
  if (rec.hover === mesh) return;
  const paint = (node, on) => {
    if (!node) return;
    node.traverse((o) => { if (o.isMesh && o.material?.emissive) o.material.emissive.setHex(on ? 0x2a4a3a : 0x000000); });
  };
  paint(rec.hover?.userData.node, false);
  rec.hover = mesh;
  paint(mesh?.userData.node, true);
  rec.dirty = true;
}

function hover(rec, e) {
  const mesh = castAt(rec, e);
  setHover(rec, mesh);
  if (mesh) {
    const it = mesh.userData.item;
    const slot = mesh.userData.node?.userData.slot;
    rec.hint.textContent = slot ? `${slot.label.toUpperCase()} — ${it.tpl.name}` : it.tpl.name;
    rec.canvas.style.cursor = 'pointer';
  } else {
    rec.hint.textContent = '';
    rec.canvas.style.cursor = 'grab';
  }
}

function pick(rec, e) {
  const mesh = castAt(rec, e);
  const slot = mesh?.userData.node?.userData.slot || null;
  rec.picked = slot;
  sfx.ui('click');
  if (rec.onPick) rec.onPick(slot, mesh?.userData.item || null);
}

// ---------------------------------------------------------
// drops from the stash: the nearest slot that takes the part
// ---------------------------------------------------------
document.addEventListener('pointermove', (e) => {
  if (!open.size || !isDragging()) return;
  const dragged = document.querySelector('.item.is-dragging')?._item;
  for (const rec of open.values()) {
    const r = rec.canvas.getBoundingClientRect();
    const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    if (!inside || !dragged) { rec.wrap._slot = null; continue; }
    rec.wrap._slot = nearestSlotFor(rec, dragged, e.clientX - r.left, e.clientY - r.top, r.width, r.height);
  }
}, true);

function nearestSlotFor(rec, item, px, py, w, h) {
  const T = THREE;
  if (!rec.tree || !(item.cat === 'mod' || item.cat === 'mag')) return null;
  rec.scene.updateMatrixWorld(true);
  let best = null, bestD = Infinity;
  const v = new T.Vector3();
  rec.tree.traverse((o) => {
    const slot = o.userData.slot;
    if (!slot || !slot.fits(item) || slot.item === item) return;
    o.getWorldPosition(v);
    v.project(rec.camera);
    const sx = (v.x + 1) / 2 * w, sy = (1 - v.y) / 2 * h;
    const d = Math.hypot(sx - px, sy - py);
    // an empty slot at its anchor beats an occupied one at the same distance
    const dd = o.userData.empty ? d : d + 8;
    if (dd < bestD) { bestD = dd; best = slot; }
  });
  return best;
}

/** for the modding screen: is there anything to show for this item */
export async function canView3D(item) {
  await loadModelIndex();
  return !!(item?.tpl && hasModel(item.tpl));
}
