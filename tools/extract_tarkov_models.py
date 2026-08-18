#!/usr/bin/env python3
"""
Build the sealed 3D model packs (assets/models/<templateId>.pak) for every
weapon, pistol, mod and magazine in src/data/items-db.json out of a local
Escape From Tarkov install, plus src/data/models-index.json.

    python extract_tarkov_models.py                       # everything (~666 packs)
    python extract_tarkov_models.py --only w_ak74n --only mag_ak74
    python extract_tarkov_models.py --inspect 5644bd2b4bdc2d3b4c8b4572
    python extract_tarkov_models.py --key "..." --jobs 8 --tex-parts 192

Pipeline, per template
  1. items-db key -> SPT template (tools/cache/items_3101.json) -> _props.Prefab.path,
     which is a key in EscapeFromTarkov_Data/StreamingAssets/Windows/Windows.json.
     That manifest gives the bundle file and its dependency bundles; the prefab
     bundle plus its (non audio/effect) dependencies are loaded into one UnityPy
     environment so mesh / material / texture PPtrs resolve.
  2. The visual prefab root is found (weapon containers point at the model prefab
     through the WeaponPrefab MonoBehaviour), the transform tree is walked and
     every renderer with a MeshFilter / SkinnedMeshRenderer is collected.
  3. LOD choice: per piece (name without _LODn, or LODGroup membership) the LOD1
     node is preferred when both LOD0 and LOD1 exist, else LOD0; LOD2+ is dropped,
     inactive GameObjects, hand-bone / animator empties, Unity built-in primitives
     (laser dot spheres) and transparent materials (scope glass, reticle planes,
     render queue >= 3000) are skipped. Every remaining piece (bolt, hammer,
     trigger, selector, kolodka, planka, ...) keeps its own transform.
  4. Frames. Raw vertex data of BSG's weapons and mods share one Max-style frame:
     forward = -Y, up = +Z, right = +X (Unity left-handed). Everything in the
     header is expressed in the *attach frame* A: for weapons the `weapon` node
     (under Weapon_root, which carries the -90 deg X import rotation), for mods
     the prefab root position with that same import rotation
     R = (-0.7071, 0, 0, 0.7071). Composition rule that reproduces the game:
         child_A = parent_A * slot_rel        (slot_rel = A^-1 * T_slot)
         mesh vertices of a prefab sit at   A * mesh(p, r, s)
     i.e. a part's raw mesh is dropped straight onto the parent's slot. This
     was verified on the AK-74N default preset (assembled length 0.939 m vs. the
     real 943 mm, gas block's own mod_handguard on the weapon's within 1 mm) and
     holds for the handful of mods whose body node is not itself at R (rail
     sections, UBR stock, ...): their slots land on their top faces.
     No X negation, no winding reversal is applied - the viewer does that.
  5. Geometry is compacted per submesh (only referenced vertices), positions and
     UVs quantised to u16 inside per-mesh boxes, indices u16 (u32 above 65535
     vertices), the material's _MainTex is re-encoded as JPEG q82 with the
     longest side 512 px for weapons / 256 px for parts (dedupe by Unity path
     id); materials without a diffuse map carry their _Color instead. Normal /
     gloss maps are not shipped (the viewer computes normals).
  6. Container = u32 LE header length | header JSON (utf-8, space padded to a
     4-byte boundary) | blobs (each 4-byte aligned, offsets relative to the start
     of the blob region). That is deflate-raw'd and AES-256-GCM sealed exactly
     like tools/pack_sfx.py seals the sound pack:
         "E2MDL1" | salt(16) | iv(12) | ciphertext || tag
     with the key = PBKDF2-HMAC-SHA256(passphrase, salt, 200k, 32). Passphrase
     via --key or SFX_PACK_KEY; it must be SEALED_KEY in src/core/audio.js.

Header JSON (v1):
  { v, id, key, frame:"attach", bbox:[[min],[max]],
    slots:{ mod_*: {p:[x,y,z], r:[x,y,z,w]} },      # every mod_* empty
    markers:{ fireport|aim_camera|shellport: {p, r} },  # when present
    meshes:[ { name, p, r, s, n, i, q:[[min],[max]], uvq:[[u,v],[u,v]]|null,
               pos:[off,len], uv:[off,len]|null, idx:[off,len], idx32,
               tex:name|null, color:[r,g,b]|null } ],
    textures:{ name: {off, len, w, h, mime:"image/jpeg"} } }
  pos = qmin + u16/65535 * (qmax - qmin) per axis; UV v=0 is the bottom row of
  the image (Unity convention). Index triples are in the mesh's own winding.

Everything inside the .pak files is Battlestate Games' copyrighted material,
sealed the same way as the sound pack; LICENSE covers what that means for
anyone who takes it back out.
"""

from __future__ import annotations

import argparse
import io
import json
import math
import os
import re
import secrets
import struct
import sys
import time
import traceback
import zlib
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
CACHE = HERE / "cache"
DEFAULT_GAME = Path(r"E:\Program Files\EFT")
SA = Path("EscapeFromTarkov_Data") / "StreamingAssets" / "Windows"
ITEMS_DB = ROOT / "src" / "data" / "items-db.json"
OUT_DIR = ROOT / "assets" / "models"
INDEX_PATH = ROOT / "src" / "data" / "models-index.json"

MAGIC = b"E2MDL1"
SALT_LEN = 16
IV_LEN = 12
CATS = ("weapon", "pistol", "mod", "mag")
WEAPON_CATS = ("weapon", "pistol")
MARKERS = ("fireport", "aim_camera", "shellport")

# -90 deg about X: the importer rotation every BSG mesh node carries
R_STD = (-0.7071067811865476, 0.0, 0.0, 0.7071067811865476)
IDENT = ((0.0, 0.0, 0.0), (0.0, 0.0, 0.0, 1.0), (1.0, 1.0, 1.0))

# dependency bundles that never hold mesh/texture data we need
SKIP_DEP_SUBSTR = (
    "/audio/", "/animations/", "/effects/", "physicsmaterials", "cubemaps", "shaders",
    "weapon_root_anim_fix", "kibas tuning", "additional_hands", "muzzlejets", "smoke.bundle",
)
# texture slots that mark a glass / reticle material when there is no _MainTex
GLASS_TEX_SLOTS = ("_Cube", "_EnvTex", "_MarkTex", "_MaskTex", "_MaskTex2", "_FadeTex", "_NoiseTex", "_SpecTex")
LOD_RE = re.compile(r"_lod(\d+)", re.I)


# ---------------------------------------------------------------------------
# quaternion / transform helpers (x, y, z, w)
# ---------------------------------------------------------------------------
def q_mul(a, b):
    ax, ay, az, aw = a
    bx, by, bz, bw = b
    return (
        aw * bx + ax * bw + ay * bz - az * by,
        aw * by - ax * bz + ay * bw + az * bx,
        aw * bz + ax * by - ay * bx + az * bw,
        aw * bw - ax * bx - ay * by - az * bz,
    )


def q_inv(q):
    x, y, z, w = q
    return (-x, -y, -z, w)


def q_rot(q, v):
    qv = (v[0], v[1], v[2], 0.0)
    r = q_mul(q_mul(q, qv), q_inv(q))
    return (r[0], r[1], r[2])


def t_compose(a, b):
    """a then b applied to child: result = a * b (pos, rot, scale)"""
    pa, ra, sa = a
    pb, rb, sb = b
    p = tuple(pa[i] + q_rot(ra, (pb[0] * sa[0], pb[1] * sa[1], pb[2] * sa[2]))[i] for i in range(3))
    return (p, q_mul(ra, rb), tuple(sa[i] * sb[i] for i in range(3)))


def t_inv(a):
    p, r, s = a
    ri = q_inv(r)
    si = tuple(1.0 / c if c else 0.0 for c in s)
    pi = q_rot(ri, (-p[0] * si[0], -p[1] * si[1], -p[2] * si[2]))
    return (pi, ri, si)


def t_of(tr):
    p = tr.m_LocalPosition
    r = tr.m_LocalRotation
    s = tr.m_LocalScale
    return ((p.x, p.y, p.z), (r.x, r.y, r.z, r.w), (s.x, s.y, s.z))


def q_matrix(q):
    import numpy as np
    x, y, z, w = q
    return np.array([
        [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
        [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
        [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
    ])


def rnd(v, n=6):
    out = []
    for c in v:
        c = round(float(c), n)
        out.append(0.0 if c == 0 else c)  # no -0.0
    return out


# ---------------------------------------------------------------------------
class Game:
    def __init__(self, game: Path):
        self.game = game
        self.sa = game / SA
        self.manifest = json.loads((self.sa / "Windows.json").read_text(encoding="utf-8"))

    def bundle_file(self, prefab_path: str) -> Path | None:
        p = self.sa / prefab_path
        return p if p.exists() else None

    def deps(self, prefab_path: str) -> list[str]:
        e = self.manifest.get(prefab_path) or {}
        out = []
        for d in e.get("Dependencies", []):
            dl = d.lower()
            if any(s in dl for s in SKIP_DEP_SUBSTR):
                continue
            out.append(d)
        return out

    def load_env(self, prefab_path: str):
        import UnityPy
        f = self.bundle_file(prefab_path)
        if f is None:
            raise FileNotFoundError(prefab_path)
        env = UnityPy.load(str(f))
        loaded = [prefab_path]
        for d in self.deps(prefab_path):
            df = self.bundle_file(d)
            if df is None:
                continue
            try:
                env.load_file(str(df))
                loaded.append(d)
            except Exception:
                pass
        return env, loaded


class Prefab:
    """One loaded environment + helpers to walk its GameObject tree."""

    def __init__(self, env):
        self.env = env
        self.objs = {}
        for o in env.objects:
            self.objs.setdefault(o.path_id, o)  # main bundle is loaded first, wins clashes

    def go_of_transform(self, tr):
        return tr.m_GameObject.read()

    def transform_of_go(self, go):
        for cp in go.m_Component:
            try:
                c = cp.component.read()
            except Exception:
                continue
            if type(c).__name__ in ("Transform", "RectTransform"):
                return c
        return None

    def components(self, go):
        out = []
        for cp in go.m_Component:
            try:
                out.append(cp.component.read())
            except Exception:
                pass
        return out

    def container(self):
        for o in self.env.objects:
            if o.type.name == "AssetBundle":
                ab = o.read()
                return [(k, v.asset) for k, v in ab.m_Container]
        return []

    def find_root(self):
        """Return the root Transform of the prefab that carries the visual model."""
        prefabs = [(k, v) for k, v in self.container() if k.lower().endswith(".prefab")]
        for k, ptr in prefabs:
            if k.lower().endswith("_container.prefab"):
                go = ptr.read()
                for c in self.components(go):
                    if type(c).__name__ == "MonoBehaviour":
                        try:
                            name = c.m_Script.read().m_Name
                        except Exception:
                            name = ""
                        if name == "WeaponPrefab":
                            d = c.object_reader.read_typetree()
                            wo = d.get("_weaponObject")
                            if wo and wo["m_PathID"]:
                                target = self.objs.get(wo["m_PathID"])
                                if target is not None:
                                    return self.transform_of_go(target.read())
        if len(prefabs) == 1:
            return self.transform_of_go(prefabs[0][1].read())
        for k, ptr in prefabs:
            if "_model.generated" in k.lower():
                return self.transform_of_go(ptr.read())
        best = None
        for k, ptr in prefabs:
            tr = self.transform_of_go(ptr.read())
            n = self.count(tr)
            if best is None or n > best[0]:
                best = (n, tr)
        return best[1] if best else None

    def count(self, tr):
        n = 1
        for ch in tr.m_Children:
            n += self.count(ch.read())
        return n

    def walk(self, tr, parent_world, active, depth, visit):
        """visit(tr, go, world_transform, active, depth). world = relative to the root."""
        local = t_of(tr)
        world = t_compose(parent_world, local)
        go = self.go_of_transform(tr)
        act = active and bool(go.m_IsActive)
        visit(tr, go, world, act, depth)
        for ch in tr.m_Children:
            self.walk(ch.read(), world, act, depth + 1, visit)


# ---------------------------------------------------------------------------
def lod_of_name(name: str):
    """('base', level | None) - level parsed from a _LODn token, base = name without it."""
    m = LOD_RE.search(name)
    if not m:
        base = name
        lvl = None
    else:
        base = name[: m.start()] + name[m.end():]
        lvl = int(m.group(1))
    base = re.sub(r"[^a-z0-9]+", "_", base.lower()).strip("_")
    return base, lvl


def is_glass_material(mat, has_main: bool) -> bool:
    """Transparent scope glass / reticle planes / lens covers: not opaque geometry."""
    if mat.m_CustomRenderQueue is not None and mat.m_CustomRenderQueue >= 3000:
        return True
    tags = dict(mat.stringTagMap) if getattr(mat, "stringTagMap", None) else {}
    if tags.get("RenderType", "").lower() == "transparent":
        return True
    if has_main:
        return False
    slots = {s for s, te in mat.m_SavedProperties.m_TexEnvs if te.m_Texture.m_PathID}
    if slots & set(GLASS_TEX_SLOTS):
        return True
    return "glass" in mat.m_Name.lower()


# ---------------------------------------------------------------------------
class ItemBuilder:
    """Turns one prefab into (header, blobs). Everything heavy lives here."""

    def __init__(self, game: Game, tpl_id: str, key: str, cat: str, prefab_path: str,
                 tex_max: int, jpeg_q: int):
        self.game = game
        self.tpl_id = tpl_id
        self.key = key
        self.cat = cat
        self.prefab_path = prefab_path
        self.tex_max = tex_max
        self.jpeg_q = jpeg_q
        self.warnings: list[str] = []
        self.blobs: list[bytes] = []
        self.blob_off = 0
        self.textures: dict = {}
        self._tex_by_key: dict = {}
        self._tex_names: set = set()

    # -- blob region ------------------------------------------------------
    def add_blob(self, data: bytes) -> tuple[int, int]:
        off = self.blob_off
        self.blobs.append(data)
        n = len(data)
        pad = (-n) % 4
        if pad:
            self.blobs.append(b"\0" * pad)
        self.blob_off += n + pad
        return off, n

    # -- textures ---------------------------------------------------------
    def texture(self, tex_ptr) -> str | None:
        from PIL import Image
        try:
            tex = tex_ptr.read()
        except Exception as exc:
            self.warnings.append(f"texture unresolved: {type(exc).__name__}")
            return None
        k = (tex.assets_file.name if tex.assets_file else "", tex_ptr.m_PathID)
        if k in self._tex_by_key:
            return self._tex_by_key[k]
        try:
            img = tex.image
        except Exception as exc:
            self.warnings.append(f"texture {tex.m_Name} undecodable: {type(exc).__name__}: {exc}")
            self._tex_by_key[k] = None
            return None
        if self.tex_max and max(img.size) > self.tex_max:
            sc = self.tex_max / max(img.size)
            img = img.resize((max(1, round(img.width * sc)), max(1, round(img.height * sc))), Image.LANCZOS)
        buf = io.BytesIO()
        img.convert("RGB").save(buf, "JPEG", quality=self.jpeg_q, optimize=True)
        data = buf.getvalue()
        name = tex.m_Name or f"tex{len(self.textures)}"
        base = name
        n = 2
        while name in self._tex_names:
            name = f"{base}~{n}"
            n += 1
        self._tex_names.add(name)
        off, ln = self.add_blob(data)
        self.textures[name] = {"off": off, "len": ln, "w": img.width, "h": img.height, "mime": "image/jpeg"}
        self._tex_by_key[k] = name
        return name

    # -- main -------------------------------------------------------------
    def build(self) -> dict:
        import numpy as np
        from UnityPy.helpers.MeshHelper import MeshHandler

        env, loaded = self.game.load_env(self.prefab_path)
        pf = Prefab(env)
        root = pf.find_root()
        if root is None:
            raise RuntimeError("no root prefab found")

        nodes = []  # (tr, go, world, active, depth)
        pf.walk(root, IDENT, True, 0, lambda tr, go, w, a, d: nodes.append((tr, go, w, a, d)))

        # attach frame
        weapon_node = next((n for n in nodes if n[1].m_Name == "weapon"), None)
        if weapon_node is not None:
            frame = weapon_node[2]
        else:
            frame = ((0.0, 0.0, 0.0), R_STD, (1.0, 1.0, 1.0))
        frame_inv = t_inv(frame)

        # LODGroup membership: renderer path_id -> level
        lod_level: dict[int, int] = {}
        for tr, go, world, active, depth in nodes:
            for c in pf.components(go):
                if type(c).__name__ == "LODGroup":
                    for i, lod in enumerate(c.m_LODs):
                        for r in lod.renderers:
                            if r.renderer.m_PathID:
                                lod_level[r.renderer.m_PathID] = i

        # candidate mesh nodes
        cands = []
        for tr, go, world, active, depth in nodes:
            if go.m_Name.startswith("Base Human"):
                continue
            comps = pf.components(go)
            renderer = None
            mesh_ptr = None
            for c in comps:
                tn = type(c).__name__
                if tn == "SkinnedMeshRenderer":
                    renderer = c
                    mesh_ptr = c.m_Mesh
                elif tn == "MeshRenderer":
                    renderer = c
                elif tn == "MeshFilter" and mesh_ptr is None:
                    mesh_ptr = c.m_Mesh
            if renderer is None or mesh_ptr is None or not mesh_ptr.m_PathID:
                continue
            if not active or not renderer.m_Enabled:
                continue
            if renderer.m_CastShadows == 3:  # ShadowsOnly
                continue
            base, name_lvl = lod_of_name(go.m_Name)
            lvl = lod_level.get(renderer.object_reader.path_id, name_lvl)
            cands.append({"go": go, "world": world, "renderer": renderer, "mesh_ptr": mesh_ptr,
                          "base": base, "lvl": lvl, "name": go.m_Name})

        # LOD choice: prefer LOD1 per piece, else LOD0, drop LOD2+
        lvl0 = [c for c in cands if c["lvl"] == 0]
        lvl1 = [c for c in cands if c["lvl"] == 1]
        free = [c for c in cands if c["lvl"] is None]
        bases0 = {c["base"] for c in lvl0}
        bases1 = {c["base"] for c in lvl1}
        chosen = free + lvl1 + [c for c in lvl0 if c["base"] not in bases1]
        unpaired1 = [c for c in lvl1 if c["base"] not in bases0]
        unpaired0 = [c for c in lvl0 if c["base"] not in bases1]
        if unpaired1 and unpaired0:
            # LOD1 node named differently from its LOD0 piece: drop LOD0 pieces its box covers
            def box(c):
                try:
                    m = c["mesh_ptr"].read()
                    h = MeshHandler(m)
                    h.process()
                    V = np.asarray(h.m_Vertices, dtype=np.float64)[:, :3]
                except Exception:
                    return None
                p, r, s = t_compose(frame_inv, c["world"])
                V = (V * np.array(s)) @ q_matrix(r).T + np.array(p)
                return V.min(0), V.max(0)
            boxes1 = [b for b in (box(c) for c in unpaired1) if b is not None]
            for c in unpaired0:
                b0 = box(c)
                if b0 is None:
                    continue
                for lo1, hi1 in boxes1:
                    tol = 0.1 * (hi1 - lo1) + 0.005
                    if np.all(b0[0] >= lo1 - tol) and np.all(b0[1] <= hi1 + tol):
                        chosen.remove(c)
                        self.warnings.append(f"dropped {c['name']} (covered by an unnamed LOD1 piece)")
                        break

        # order: keep tree order
        order = {id(c): i for i, c in enumerate(cands)}
        chosen.sort(key=lambda c: order[id(c)])

        meshes = []
        bb_lo = np.full(3, np.inf)
        bb_hi = np.full(3, -np.inf)
        for c in chosen:
            try:
                mesh = c["mesh_ptr"].read()
            except Exception as exc:
                self.warnings.append(f"mesh unresolved on {c['name']}: {type(exc).__name__}")
                continue
            h = MeshHandler(mesh)
            h.process()
            if not h.m_VertexCount or not h.m_Vertices:
                self.warnings.append(f"empty mesh on {c['name']}")
                continue
            V = np.asarray(h.m_Vertices, dtype=np.float32)[:, :3]
            UV = None
            if h.m_UV0:
                UV = np.asarray(h.m_UV0, dtype=np.float32)[:, :2]
                if len(UV) != len(V):
                    UV = None
            IB = np.asarray(h.m_IndexBuffer, dtype=np.uint32)
            rel = t_compose(frame_inv, c["world"])
            p, r, s = rel
            Rm = q_matrix(r)
            mats = list(c["renderer"].m_Materials)
            for si, sm in enumerate(mesh.m_SubMeshes):
                if sm.indexCount == 0:
                    continue
                if sm.topology == 0:
                    first = sm.firstByte // 2 if h.m_Use16BitIndices else sm.firstByte // 4
                    tri = IB[first: first + sm.indexCount]
                    tri = tri[: (len(tri) // 3) * 3].reshape(-1, 3)
                else:
                    tris = h.get_triangles()[si]
                    if not tris:
                        continue
                    tri = np.asarray(tris, dtype=np.uint32).reshape(-1, 3)
                if sm.baseVertex:
                    tri = tri + np.uint32(sm.baseVertex)
                if len(tri) == 0:
                    continue
                # material for this submesh (Unity repeats the last one)
                mat_ptr = mats[min(si, len(mats) - 1)] if mats else None
                tex_name = None
                color = None
                if mat_ptr is not None and mat_ptr.m_PathID:
                    try:
                        mat = mat_ptr.read()
                    except Exception as exc:
                        mat = None
                        self.warnings.append(f"material unresolved on {c['name']}: {type(exc).__name__}")
                    if mat is not None:
                        main = None
                        for slot, te in mat.m_SavedProperties.m_TexEnvs:
                            if slot == "_MainTex" and te.m_Texture.m_PathID:
                                main = te.m_Texture
                        if is_glass_material(mat, main is not None):
                            continue
                        if main is not None:
                            tex_name = self.texture(main)
                        if tex_name is None:
                            cols = dict(mat.m_SavedProperties.m_Colors)
                            cc = cols.get("_Color")
                            color = rnd((cc.r, cc.g, cc.b), 4) if cc is not None else [0.7, 0.7, 0.7]
                else:
                    color = [0.7, 0.7, 0.7]
                # compact to referenced vertices
                if tri.max() >= len(V):
                    self.warnings.append(f"index out of range on {c['name']} submesh {si}")
                    tri = tri[(tri < len(V)).all(axis=1)]
                    if len(tri) == 0:
                        continue
                uniq, inv = np.unique(tri.ravel(), return_inverse=True)
                v = V[uniq]
                n = len(v)
                idx = inv.astype(np.uint32).reshape(-1, 3)
                # quantise positions
                qmin = rnd(v.min(0), 6)
                qmax = rnd(v.max(0), 6)
                lo = np.array(qmin, dtype=np.float64)
                rng = np.array(qmax, dtype=np.float64) - lo
                rng[rng == 0] = 1.0
                q = np.rint((v.astype(np.float64) - lo) / rng * 65535.0).clip(0, 65535).astype("<u2")
                pos_off = self.add_blob(q.tobytes())
                uv_off = None
                uvq = None
                if UV is not None:
                    uv = UV[uniq]
                    umin = rnd(uv.min(0), 5)
                    umax = rnd(uv.max(0), 5)
                    ulo = np.array(umin, dtype=np.float64)
                    urng = np.array(umax, dtype=np.float64) - ulo
                    urng[urng == 0] = 1.0
                    uq = np.rint((uv.astype(np.float64) - ulo) / urng * 65535.0).clip(0, 65535).astype("<u2")
                    uv_off = self.add_blob(uq.tobytes())
                    uvq = [umin, umax]
                idx32 = n > 65535
                idx_bytes = idx.astype("<u4" if idx32 else "<u2").tobytes()
                idx_off = self.add_blob(idx_bytes)
                # bbox in the attach frame
                W = (v.astype(np.float64) * np.array(s)) @ Rm.T + np.array(p)
                bb_lo = np.minimum(bb_lo, W.min(0))
                bb_hi = np.maximum(bb_hi, W.max(0))
                meshes.append({
                    "name": c["name"] if si == 0 else f"{c['name']}#{si}",
                    "p": rnd(p, 6), "r": rnd(r, 6), "s": rnd(s, 6),
                    "n": n, "i": int(idx.size),
                    "q": [qmin, qmax], "uvq": uvq,
                    "pos": list(pos_off), "uv": list(uv_off) if uv_off else None,
                    "idx": list(idx_off), "idx32": idx32,
                    "tex": tex_name, "color": color,
                })
        if not meshes:
            raise RuntimeError("no opaque mesh pieces")

        slots = {}
        markers = {}
        for tr, go, world, active, depth in nodes:
            nm = go.m_Name
            if nm.startswith("mod_"):
                rel = t_compose(frame_inv, world)
                slots[nm] = {"p": rnd(rel[0], 6), "r": rnd(rel[1], 6)}
            elif nm in MARKERS:
                rel = t_compose(frame_inv, world)
                markers[nm] = {"p": rnd(rel[0], 6), "r": rnd(rel[1], 6)}

        header = {
            "v": 1, "id": self.tpl_id, "key": self.key, "frame": "attach",
            "bbox": [rnd(bb_lo, 5), rnd(bb_hi, 5)],
            "slots": slots,
        }
        if markers:
            header["markers"] = markers
        header["meshes"] = meshes
        header["textures"] = self.textures
        return header

    def payload(self, header: dict) -> bytes:
        hj = json.dumps(header, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
        hj += b" " * ((-(4 + len(hj))) % 4)  # blob region starts 4-byte aligned
        return struct.pack("<I", len(hj)) + hj + b"".join(self.blobs)


# ---------------------------------------------------------------------------
def seal(payload: bytes, passphrase: str) -> bytes:
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    from pack_sfx import derive
    deflator = zlib.compressobj(9, zlib.DEFLATED, -zlib.MAX_WBITS)
    squeezed = deflator.compress(payload) + deflator.flush()
    salt = secrets.token_bytes(SALT_LEN)
    iv = secrets.token_bytes(IV_LEN)
    return MAGIC + salt + iv + AESGCM(derive(passphrase, salt)).encrypt(iv, squeezed, None)


def unseal(blob: bytes, passphrase: str) -> tuple[dict, bytes]:
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    from pack_sfx import derive
    if blob[: len(MAGIC)] != MAGIC:
        raise ValueError("not an E2MDL1 pack")
    at = len(MAGIC)
    salt = blob[at: at + SALT_LEN]
    iv = blob[at + SALT_LEN: at + SALT_LEN + IV_LEN]
    squeezed = AESGCM(derive(passphrase, salt)).decrypt(iv, blob[at + SALT_LEN + IV_LEN:], None)
    raw = zlib.decompressobj(-zlib.MAX_WBITS).decompress(squeezed)
    (hl,) = struct.unpack("<I", raw[:4])
    header = json.loads(raw[4: 4 + hl])
    return header, raw[4 + hl:]


def dequant(body: bytes, m: dict):
    """positions (n,3) float and triangles (i/3,3) int of one mesh entry"""
    import numpy as np
    off, ln = m["pos"]
    q = np.frombuffer(body[off: off + ln], dtype="<u2").reshape(-1, 3).astype(np.float64)
    lo = np.array(m["q"][0])
    hi = np.array(m["q"][1])
    pos = lo + q / 65535.0 * (hi - lo)
    off, ln = m["idx"]
    idx = np.frombuffer(body[off: off + ln], dtype="<u4" if m["idx32"] else "<u2").reshape(-1, 3)
    return pos, idx


# ---------------------------------------------------------------------------
_G: Game | None = None


def _init(game_dir: str):
    global _G
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    _G = Game(Path(game_dir))


def _work(task: dict) -> dict:
    t0 = time.time()
    res = {"id": task["id"], "key": task["key"], "cat": task["cat"], "ok": False}
    try:
        b = ItemBuilder(_G, task["id"], task["key"], task["cat"], task["path"], task["tex_max"], task["jpeg_q"])
        header = b.build()
        payload = b.payload(header)
        if task.get("dump"):
            Path(task["dump"]).mkdir(parents=True, exist_ok=True)
            (Path(task["dump"]) / f"{task['id']}.json").write_text(
                json.dumps(header, indent=1), encoding="utf-8")
        data = seal(payload, task["passphrase"])
        out = Path(task["out"]) / f"{task['id']}.pak"
        out.write_bytes(data)
        res.update({
            "ok": True, "bytes": len(data), "raw": len(payload),
            "meshes": len(header["meshes"]), "verts": sum(m["n"] for m in header["meshes"]),
            "tris": sum(m["i"] for m in header["meshes"]) // 3,
            "textures": len(header["textures"]),
            "bbox": header["bbox"], "slots": sorted(header["slots"]),
            "warnings": b.warnings,
        })
    except Exception:
        res["error"] = traceback.format_exc()
    res["secs"] = round(time.time() - t0, 2)
    return res


# ---------------------------------------------------------------------------
def load_items() -> dict:
    return json.loads((CACHE / "items_3101.json").read_text(encoding="utf-8"))


def select_tasks(args) -> list[dict]:
    db = json.loads(ITEMS_DB.read_text(encoding="utf-8"))
    items = load_items()
    tasks = []
    only = set(args.only or [])
    for key, it in db.items():
        cat = it.get("cat")
        if cat not in CATS:
            continue
        if only and key not in only and it["id"] not in only:
            continue
        tpl = items.get(it["id"])
        if tpl is None:
            print(f"  !! {key}: template {it['id']} not in SPT items cache")
            continue
        path = tpl["_props"].get("Prefab", {}).get("path")
        if not path:
            print(f"  !! {key}: no prefab path")
            continue
        tasks.append({
            "id": it["id"], "key": key, "cat": cat, "path": path,
            "tex_max": args.tex_weapons if cat in WEAPON_CATS else args.tex_parts,
            "jpeg_q": args.jpeg_q, "out": str(args.out), "passphrase": args.passphrase,
            "dump": args.dump,
        })
    if args.limit:
        tasks = tasks[: args.limit]
    return tasks


def inspect_pack(path: Path, passphrase: str) -> None:
    import numpy as np
    blob = path.read_bytes()
    header, body = unseal(blob, passphrase)
    print(f"{path.name}: {len(blob)} bytes sealed, {len(body)} blob bytes, id={header['id']} key={header['key']}")
    lo, hi = header["bbox"]
    print(f"  bbox {lo} .. {hi}  size {[round(hi[i]-lo[i],4) for i in range(3)]}")
    print(f"  slots: {', '.join(f'{k}@{v['p']}' for k, v in header['slots'].items())}")
    if header.get("markers"):
        print(f"  markers: {', '.join(f'{k}@{v['p']}' for k, v in header['markers'].items())}")
    print(f"  textures: {', '.join(f'{k} {v['w']}x{v['h']} {v['len']}B' for k, v in header['textures'].items())}")
    tot = 0
    for i, m in enumerate(header["meshes"]):
        pos, idx = dequant(body, m)
        tot += len(idx)
        print(f"  mesh[{i}] {m['name']}: n={m['n']} tris={len(idx)} tex={m['tex']} color={m['color']} p={m['p']} r={m['r']}")
        if i == 0:
            print(f"    first triangle: {idx[0].tolist()} -> {[np.round(pos[j], 4).tolist() for j in idx[0]]}")
    print(f"  total triangles {tot}")


def main() -> None:
    ap = argparse.ArgumentParser(description="build sealed model packs")
    ap.add_argument("--game", default=str(DEFAULT_GAME))
    ap.add_argument("--key", help="passphrase; defaults to $SFX_PACK_KEY")
    ap.add_argument("--out", default=str(OUT_DIR))
    ap.add_argument("--index", default=str(INDEX_PATH))
    ap.add_argument("--only", action="append", help="items-db key or template id (repeatable)")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--jobs", type=int, default=max(1, (os.cpu_count() or 2) - 2))
    ap.add_argument("--tex-parts", type=int, default=256, help="longest texture side for mods / mags")
    ap.add_argument("--tex-weapons", type=int, default=512, help="longest texture side for weapons / pistols")
    ap.add_argument("--jpeg-q", type=int, default=82)
    ap.add_argument("--dump", help="also write the plain header JSON of every pack into this dir (debug)")
    ap.add_argument("--inspect", help="unseal assets/models/<id>.pak (or a path) and print its header")
    args = ap.parse_args()

    passphrase = args.key or os.environ.get("SFX_PACK_KEY")
    if not passphrase:
        sys.exit("no passphrase: pass --key or set SFX_PACK_KEY (must be SEALED_KEY of src/core/audio.js)")
    args.passphrase = passphrase

    if args.inspect:
        p = Path(args.inspect)
        if not p.exists():
            p = Path(args.out) / f"{args.inspect}.pak"
        inspect_pack(p, passphrase)
        return

    tasks = select_tasks(args)
    Path(args.out).mkdir(parents=True, exist_ok=True)
    print(f"  {len(tasks)} templates -> {args.out}  (jobs={args.jobs}, tex parts={args.tex_parts} weapons={args.tex_weapons})")

    from multiprocessing import Pool
    t0 = time.time()
    results = []
    with Pool(args.jobs, initializer=_init, initargs=(args.game,)) as pool:
        for i, r in enumerate(pool.imap_unordered(_work, tasks, chunksize=2), 1):
            results.append(r)
            if not r["ok"]:
                print(f"  !! {r['key']} ({r['id']}) FAILED\n{r['error']}")
            elif r["warnings"]:
                print(f"  {r['key']}: " + "; ".join(r["warnings"]))
            if i % 50 == 0 or i == len(tasks):
                print(f"  {i}/{len(tasks)}  {time.time() - t0:5.0f}s")

    ok = [r for r in results if r["ok"]]
    bad = [r for r in results if not r["ok"]]
    # index (only for packs written in this run + existing ones? -> this run only when full)
    index = {"v": 1, "ids": {}}
    if Path(args.index).exists() and (args.only or args.limit):
        try:
            index = json.loads(Path(args.index).read_text(encoding="utf-8"))
        except Exception:
            index = {"v": 1, "ids": {}}
    for r in ok:
        index["ids"][r["id"]] = {
            "k": r["key"],
            "b": [[round(c, 4) for c in r["bbox"][0]], [round(c, 4) for c in r["bbox"][1]]],
            "s": r["slots"], "sz": r["bytes"],
        }
    index["ids"] = dict(sorted(index["ids"].items()))
    Path(args.index).parent.mkdir(parents=True, exist_ok=True)
    Path(args.index).write_text(json.dumps(index, separators=(",", ":")), encoding="utf-8")

    total = sum(r["bytes"] for r in ok)
    print()
    print(f"  written {len(ok)} / {len(tasks)}  failures {len(bad)}  in {time.time() - t0:.0f}s")
    print(f"  total {total / 1048576:.2f} MiB ({total} bytes), index {Path(args.index).stat().st_size / 1024:.1f} KiB")
    for cat in CATS:
        rs = [r for r in ok if r["cat"] == cat]
        if rs:
            print(f"    {cat:7s} n={len(rs):3d} avg {sum(r['bytes'] for r in rs) / len(rs) / 1024:7.1f} KiB "
                  f"avg tris {sum(r['tris'] for r in rs) / len(rs):7.0f}  avg tex {sum(r['textures'] for r in rs) / len(rs):.1f}")
    print("  largest:")
    for r in sorted(ok, key=lambda r: -r["bytes"])[:10]:
        print(f"    {r['bytes'] / 1024:8.1f} KiB  {r['key']:20s} {r['id']}  meshes={r['meshes']} tris={r['tris']} tex={r['textures']}")
    if bad:
        print("  FAILED: " + ", ".join(f"{r['key']} ({r['id']})" for r in bad))
        sys.exit(1)


if __name__ == "__main__":
    main()
