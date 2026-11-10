#!/usr/bin/env python3
"""
Catalogue and export the UI art (sprites, textures, fonts, layout) of a local
Escape From Tarkov install.

    python extract_tarkov_ui.py --game "D:\\Program Files\\Battlestate Games\\EFT" all
    python extract_tarkov_ui.py --game ... index      # index.json: every Sprite / Texture2D / Font
    python extract_tarkov_ui.py --game ... layout     # layout/: UI hierarchy of every screen + sprite usage
    python extract_tarkov_ui.py --game ... icons      # icon_tables.json: enum name -> sprite (quest types, skills, ...)
    python extract_tarkov_ui.py --game ... export     # export/<category>/<group>/*.png (+ contact sheets)
    python extract_tarkov_ui.py --game ... video      # poster frames of the StreamingAssets/Video menu backgrounds
    python extract_tarkov_ui.py --game ... fonts      # fonts/*.otf|ttf
    python extract_tarkov_ui.py --game ... text       # textassets/*.json (embedded locale / trader test data)

    --out DIR     write everything under DIR instead of tools/cache/client
    --jobs N      worker processes for the index pass

`all` = index, layout, icons, export, video, fonts, text in that order (export uses
the sprite usage map the layout pass writes to sort art by the screen that shows it).
Nothing is ever deleted: a re-run overwrites files of the same name, so after
changing the sorting rules export into a fresh --out folder.

The game install is only ever opened for reading.

The client is a Unity 2022.3.43 IL2CPP player build:
  * the UI art is compiled into the base build (resources.assets and the
    sharedassetsN.assets of the UI scenes level44..50), not into bundles;
  * serialized files carry no type trees. UnityPy's built-in ones cover the native
    classes (Sprite, Texture2D, Font, GameObject, RectTransform, Canvas); the stock
    UGUI / TextMeshPro MonoBehaviours are decoded with the hand-written readers in
    the "layout" section, identified through the MonoScript table in
    globalgamemanagers.assets (class names are not obfuscated).

Needs: UnityPy 1.25, Pillow (fontTools optional, for the font report).
Everything written is Battlestate Games' copyrighted material - keep it local
(tools/cache/ is git-ignored).
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import re
import struct
import sys
import time
import traceback
from collections import Counter, defaultdict
from pathlib import Path

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

HERE = Path(__file__).resolve().parent
OUT = HERE / "cache" / "client"
DEFAULT_GAME = Path(r"D:\Program Files\Battlestate Games\EFT")
DATA = "EscapeFromTarkov_Data"
SA = Path(DATA) / "StreamingAssets" / "Windows"

# StreamingAssets bundles that can hold 2D art. Windows.json was searched for
# /ui/, interface, menu, trader, quest, avatar, icon, banner, loading: every hit
# is a 3D item / character / audio bundle except the ones matched here.
BUNDLE_PATTERNS = [
    r"^tempsplash\.bundle$",
    r"^doge$",
    r"^dissonancesetup$",
    r"^assets/content/pocketmap/",
]

WANTED = ("Sprite", "Texture2D", "Font", "SpriteAtlas")

# build index of the UI scenes (BuildSettings in globalgamemanagers): levelN + sharedassetsN.assets
UI_SCENES = [
    ("level44", "CommonUIScene"), ("level45", "EnvironmentUIScene"), ("level46", "GameUIScene"),
    ("level47", "LoginUIScene"), ("level48", "MenuUIScene"), ("level49", "PreloaderUIScene"),
    ("level50", "SessionEndUIScene"),
]
# files whose root RectTransform trees are UI prefabs (templates the scenes instantiate at runtime)
UI_PREFAB_FILES = [
    ("resources.assets", "prefab.resources"), ("sharedassets44.assets", "prefab.sa44"),
    ("sharedassets46.assets", "prefab.sa46"), ("sharedassets47.assets", "prefab.sa47"),
    ("sharedassets48.assets", "prefab.sa48"), ("sharedassets49.assets", "prefab.sa49"),
    ("sharedassets50.assets", "prefab.sa50"),
]
# files whose Texture2D objects are UI art; everything else in the base build is world / character art
UI_TEXTURE_FILES = {
    "resources.assets", "sharedassets24.assets", "sharedassets44.assets", "sharedassets45.assets",
    "sharedassets46.assets", "sharedassets47.assets", "sharedassets48.assets", "sharedassets49.assets",
    "sharedassets50.assets", "tempsplash.bundle", "doge",
}
CANVAS = (1920, 1080)  # CanvasScaler is ConstantPixelSize x1: the UI is authored in 1080p pixels


def index_path() -> Path:
    return OUT / "index.json"


def num_key(p: str):
    b = os.path.basename(p)
    m = re.search(r"(\d+)", b)
    return (re.sub(r"\d+", "", b), int(m.group(1)) if m else -1)


def base_files(game: Path, with_levels: bool = True) -> list[Path]:
    data = game / DATA
    out = [data / "globalgamemanagers.assets", data / "resources.assets"]
    out += sorted(data.glob("sharedassets*.assets"), key=lambda p: num_key(p.name))
    if with_levels:
        out += sorted((p for p in data.glob("level*") if p.suffix == ""), key=lambda p: num_key(p.name))
    return [p for p in out if p.exists()]


def bundle_files(game: Path) -> list[tuple[str, Path]]:
    sa = game / SA
    mf = sa / "Windows.json"
    if not mf.exists():
        return []
    manifest = json.loads(mf.read_text(encoding="utf-8"))
    rx = [re.compile(p, re.I) for p in BUNDLE_PATTERNS]
    out = []
    for key in sorted(manifest):
        if any(r.search(key) for r in rx):
            p = sa / key
            if p.exists():
                out.append((key, p))
    return out


def safe_name(s: str, limit: int = 110) -> str:
    s = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", s).strip(" .")
    return s[:limit] or "_"


def write_json(path: Path, obj, pretty: bool = False) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if pretty:
        path.write_text(json.dumps(obj, ensure_ascii=False, indent=1), encoding="utf-8")
    else:
        path.write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


# ===========================================================================
# index
# ===========================================================================
def _ext_name(assets_file, file_id: int) -> str | None:
    """file name a PPtr's m_FileID points at (None = same file)"""
    if file_id == 0:
        return None
    try:
        return assets_file.externals[file_id - 1].path.rsplit("/", 1)[-1]
    except Exception:
        return "?"


def _rect(r) -> list[float]:
    return [round(r.x, 3), round(r.y, 3), round(r.width, 3), round(r.height, 3)]


def _fmt_name(fmt) -> str:
    try:
        from UnityPy.enums import TextureFormat
        return TextureFormat(int(fmt)).name
    except Exception:
        return str(fmt)


def _settings(raw: int) -> dict:
    return {
        "packed": bool(raw & 1),
        "pack_mode": "rect" if (raw >> 1) & 1 else "tight",
        "rotation": ["none", "flipH", "flipV", "rot180", "rot90"][min((raw >> 2) & 0xF, 4)],
        "mesh": "tight" if (raw >> 6) & 1 else "full",
    }


def index_file(task: tuple[str, str]) -> dict:
    """worker: (label, path) -> {'label', 'counts', 'entries', 'atlases', 'error'}"""
    label, path = task
    res = {"label": label, "counts": {}, "entries": [], "atlases": [], "error": None}
    try:
        import UnityPy
        env = UnityPy.load(path)
        counts = Counter(o.type.name for o in env.objects)
        res["counts"] = {k: counts[k] for k in ("Sprite", "Texture2D", "Font", "SpriteAtlas", "Canvas",
                                                "RectTransform", "TextAsset", "VideoClip", "MonoBehaviour",
                                                "GameObject") if counts.get(k)}
        if not any(counts.get(k) for k in WANTED):
            return res
        for o in env.objects:
            tn = o.type.name
            if tn not in WANTED:
                continue
            af = o.assets_file
            src = label
            try:
                if tn == "Texture2D":
                    d = o.read()
                    sd = getattr(d, "m_StreamData", None)
                    res["entries"].append({
                        "name": d.m_Name, "type": tn, "width": d.m_Width, "height": d.m_Height,
                        "file": src, "path_id": o.path_id,
                        "format": _fmt_name(d.m_TextureFormat), "mips": getattr(d, "m_MipCount", None),
                        "stream": (sd.path.rsplit("/", 1)[-1] if sd is not None and sd.path else None),
                        "bytes": (sd.size if sd is not None and sd.path else len(d.image_data or b"")),
                    })
                elif tn == "Sprite":
                    d = o.read()
                    rd = d.m_RD
                    b = d.m_Border
                    e = {
                        "name": d.m_Name, "type": tn,
                        "width": int(round(d.m_Rect.width)), "height": int(round(d.m_Rect.height)),
                        "file": src, "path_id": o.path_id,
                        "rect": _rect(d.m_Rect),
                        "pivot": [round(d.m_Pivot.x, 4), round(d.m_Pivot.y, 4)],
                        "border": [round(b.x, 2), round(b.y, 2), round(b.z, 2), round(b.w, 2)],  # L B R T
                        "ppu": round(d.m_PixelsToUnits, 3),
                        "tex_file": _ext_name(af, rd.texture.m_FileID), "tex_id": rd.texture.m_PathID,
                        "tex_rect": _rect(rd.textureRect),
                        "tex_offset": [round(rd.textureRectOffset.x, 3), round(rd.textureRectOffset.y, 3)],
                        "settings": _settings(rd.settingsRaw),
                    }
                    sa = getattr(d, "m_SpriteAtlas", None)
                    if sa is not None and sa.m_PathID:
                        e["atlas_file"] = _ext_name(af, sa.m_FileID)
                        e["atlas_id"] = sa.m_PathID
                        try:
                            guid, second = d.m_RenderDataKey
                            e["rd_key"] = [[getattr(guid, f"data_{i}_", None) for i in range(4)], second]
                        except Exception:
                            pass
                    tags = getattr(d, "m_AtlasTags", None)
                    if tags:
                        e["atlas_tags"] = list(tags)
                    res["entries"].append(e)
                elif tn == "Font":
                    d = o.read()
                    data = bytes(d.m_FontData) if getattr(d, "m_FontData", None) else b""
                    res["entries"].append({
                        "name": d.m_Name, "type": tn, "width": 0, "height": 0,
                        "file": src, "path_id": o.path_id,
                        "font_bytes": len(data),
                        "font_magic": data[:4].hex() if data else None,
                        "font_size": getattr(d, "m_FontSize", None),
                        "font_names": list(getattr(d, "m_FontNames", []) or []),
                    })
                elif tn == "SpriteAtlas":
                    d = o.read()
                    rdm = []
                    for key, v in d.m_RenderDataMap:
                        guid, second = key
                        rdm.append({
                            "key": [[getattr(guid, f"data_{i}_", None) for i in range(4)], second],
                            "tex_file": _ext_name(af, v.texture.m_FileID), "tex_id": v.texture.m_PathID,
                            "tex_rect": _rect(v.textureRect),
                            "tex_offset": [round(v.textureRectOffset.x, 3), round(v.textureRectOffset.y, 3)],
                            "settings": _settings(v.settingsRaw),
                        })
                    res["atlases"].append({
                        "name": d.m_Name, "file": src, "path_id": o.path_id,
                        "tag": getattr(d, "m_Tag", None),
                        "sprite_count": len(d.m_PackedSprites),
                        "render_data": rdm,
                    })
            except Exception as exc:  # one bad object must not lose the file
                res["entries"].append({"name": None, "type": tn, "file": src, "path_id": o.path_id,
                                       "error": f"{type(exc).__name__}: {exc}"})
    except Exception:
        res["error"] = traceback.format_exc(limit=3)
    return res


def resource_paths(game: Path) -> dict[tuple[str, int], str]:
    """(file, path_id) -> Resources/ path, from the ResourceManager in globalgamemanagers"""
    import UnityPy
    out: dict[tuple[str, int], str] = {}
    env = UnityPy.load(str(game / DATA / "globalgamemanagers"))
    for o in env.objects:
        if o.type.name != "ResourceManager":
            continue
        af = o.assets_file
        d = o.read_typetree()
        for key, ptr in d["m_Container"]:
            fn = _ext_name(af, ptr["m_FileID"]) or "globalgamemanagers"
            out.setdefault((fn, ptr["m_PathID"]), key)
    return out


def scene_names(game: Path) -> list[str]:
    import UnityPy
    env = UnityPy.load(str(game / DATA / "globalgamemanagers"))
    for o in env.objects:
        if o.type.name == "BuildSettings":
            return list(o.read_typetree().get("scenes") or [])
    return []


def cmd_index(game: Path, jobs: int, with_levels: bool = True) -> dict:
    from multiprocessing import Pool

    t0 = time.time()
    tasks = [(p.name, str(p)) for p in base_files(game, with_levels)]
    tasks += [(key, str(p)) for key, p in bundle_files(game)]
    print(f"[index] {len(tasks)} files, {jobs} workers ...", flush=True)

    entries: list[dict] = []
    atlases: list[dict] = []
    files: dict[str, dict] = {}
    errors: dict[str, str] = {}
    with Pool(jobs) as pool:
        for i, r in enumerate(pool.imap_unordered(index_file, tasks, chunksize=4), 1):
            if r["error"]:
                errors[r["label"]] = r["error"]
                print(f"  !! {r['label']}: {r['error'].strip().splitlines()[-1]}", flush=True)
            if any(r["counts"].get(k) for k in ("Sprite", "Texture2D", "Font", "SpriteAtlas", "Canvas", "RectTransform")):
                files[r["label"]] = r["counts"]   # files with 2D art or UI hierarchies; the rest is world geometry
            entries += r["entries"]
            atlases += r["atlases"]
            if i % 300 == 0 or i == len(tasks):
                print(f"  {i}/{len(tasks)}  {len(entries)} objects  {time.time() - t0:5.0f}s", flush=True)

    by_key = {(e["file"], e["path_id"]): e for e in entries}
    atlas_by_key = {(a["file"], a["path_id"]): a for a in atlases}
    res_paths = resource_paths(game)

    for a in atlases:
        texs = set()
        for rd in a["render_data"]:
            t = by_key.get((rd["tex_file"] or a["file"], rd["tex_id"]))
            if t:
                texs.add(t["name"])
                t["atlas_page_of"] = a["name"]
        a["textures"] = sorted(texs)

    for e in entries:
        rp = res_paths.get((e["file"], e["path_id"]))
        if rp:
            e["res_path"] = rp
        if e["type"] != "Sprite" or e.get("error"):
            continue
        tex = None
        if e.get("atlas_id"):
            a = atlas_by_key.get((e.pop("atlas_file", None) or e["file"], e.pop("atlas_id")))
            if a:
                e["atlas"] = a["name"]
                key = e.get("rd_key")
                for rd in a["render_data"]:
                    if rd["key"] == key:
                        tf = rd["tex_file"] or a["file"]
                        tex = by_key.get((tf, rd["tex_id"]))
                        e["tex_file"], e["tex_id"] = tf, rd["tex_id"]
                        e["tex_rect"], e["tex_offset"], e["settings"] = rd["tex_rect"], rd["tex_offset"], rd["settings"]
                        break
        if tex is None and e.get("tex_id"):
            tf = e.get("tex_file") or e["file"]
            tex = by_key.get((tf, e["tex_id"]))
            e["tex_file"] = tf
        if tex is not None:
            e["texture"] = tex["name"]
            e["texture_size"] = [tex["width"], tex["height"]]
            tex["sprites"] = tex.get("sprites", 0) + 1
        e.pop("rd_key", None)

    for a in atlases:
        a.pop("render_data", None)

    entries.sort(key=lambda e: (num_key(e["file"]), e["type"], (e.get("name") or "").lower(), e["path_id"]))
    scenes = scene_names(game)
    index = {
        "game": str(game),
        "generated": time.strftime("%Y-%m-%d %H:%M:%S"),
        "unity": "2022.3.43f2",
        "notes": {
            "entry": "name, type (Sprite | Texture2D | Font), width, height, file (serialized file or bundle key), "
                     "path_id; res_path = Resources/ path when the object is addressable by name.",
            "sprite": "rect = [x, y, w, h] in its source texture, y up from the bottom edge (Unity convention); "
                      "tex_rect / tex_offset = the trimmed rect actually stored in `texture` and where it sits inside "
                      "rect; atlas = SpriteAtlas name when packed; border = 9-slice [left, bottom, right, top] px; "
                      "ppu = pixels per unit (100 = 1 px per canvas unit).",
            "export": "PNG path relative to export/ (set by the export command); export_src tells where the pixels "
                      "came from; dup_of = this texture is the same image as that exported file.",
            "used_by": "first hierarchy paths (scene/screen/.../node [component]) that reference the asset "
                       "(set by the layout command); use_count = all references found.",
            "icon_of": "rows of the icon tables (icon_tables.json) that point at the sprite, e.g. "
                       "'Static Icons.quest_type[Elimination]' (set by the icons command).",
        },
        "ui_scenes": {f"level{i}": s for i, s in enumerate(scenes) if "/UI/" in s or i == 0},
        "counts": dict(Counter(e["type"] for e in entries)),
        "files": {k: files[k] for k in sorted(files, key=num_key)},
        "errors": errors,
        "atlases": sorted(atlases, key=lambda a: (num_key(a["file"]), a["name"])),
        "entries": entries,
    }
    write_json(index_path(), index)
    print(f"[index] {len(entries)} objects {index['counts']}, {len(atlases)} sprite atlases "
          f"-> {index_path()}  [{time.time() - t0:.0f}s]")
    return index


def load_index() -> dict:
    if not index_path().exists():
        raise SystemExit(f"no index yet - run the 'index' command first ({index_path()})")
    return json.loads(index_path().read_text(encoding="utf-8"))


# ===========================================================================
# layout: GameObject / RectTransform hierarchy with decoded UGUI components
# ===========================================================================
class R:
    """little-endian reader over a MonoBehaviour's raw bytes (managed serialization: 4-byte aligned)"""
    __slots__ = ("b", "p", "n")

    def __init__(self, b, p=0):
        self.b = b
        self.p = p
        self.n = len(b)

    def align(self):
        self.p = (self.p + 3) & ~3

    def i32(self):
        v = struct.unpack_from("<i", self.b, self.p)[0]
        self.p += 4
        return v

    def i64(self):
        v = struct.unpack_from("<q", self.b, self.p)[0]
        self.p += 8
        return v

    def f32(self):
        v = struct.unpack_from("<f", self.b, self.p)[0]
        self.p += 4
        return v

    def floats(self, k):
        v = struct.unpack_from("<%df" % k, self.b, self.p)
        self.p += 4 * k
        return v

    def boolean(self):
        v = self.b[self.p] != 0
        self.p += 1
        self.align()
        return v

    def string(self):
        n = self.i32()
        if n < 0 or self.p + n > self.n:
            raise ValueError("bad string length %d" % n)
        s = self.b[self.p:self.p + n].decode("utf-8", "replace")
        self.p += n
        self.align()
        return s

    def pptr(self):
        fid = self.i32()
        pid = self.i64()
        return (fid, pid)

    def color32(self):
        v = tuple(self.b[self.p:self.p + 4])
        self.p += 4
        return v


def rnd(v, n=3):
    if isinstance(v, (tuple, list)):
        return [rnd(x, n) for x in v]
    v = round(float(v), n)
    if v == int(v):
        return int(v)
    return v


def hex_color(c) -> str:
    """Color (4 floats 0..1) -> #rrggbbaa"""
    return "#" + "".join("%02x" % max(0, min(255, int(round(x * 255)))) for x in c)


def hex_color32(c) -> str:
    return "#" + "".join("%02x" % x for x in c)


def pick(names, i):
    return names[i] if 0 <= i < len(names) else i


IMAGE_TYPES = ["Simple", "Sliced", "Tiled", "Filled"]
FILL_METHODS = ["Horizontal", "Vertical", "Radial90", "Radial180", "Radial360"]
TMP_H = {1: "Left", 2: "Center", 4: "Right", 8: "Justified", 16: "Flush", 32: "Geometry"}
TMP_V = {256: "Top", 512: "Middle", 1024: "Bottom", 2048: "Baseline", 4096: "Geometry", 8192: "Capline"}
TMP_STYLE = [(1, "Bold"), (2, "Italic"), (4, "Underline"), (8, "LowerCase"), (16, "UpperCase"), (32, "SmallCaps"),
             (64, "Strikethrough"), (128, "Superscript"), (256, "Subscript"), (512, "Highlight")]
TMP_OVERFLOW = ["Overflow", "Ellipsis", "Masking", "Truncate", "ScrollRect", "Page", "Linked"]
TEXT_ANCHOR = ["UpperLeft", "UpperCenter", "UpperRight", "MiddleLeft", "MiddleCenter", "MiddleRight",
               "LowerLeft", "LowerCenter", "LowerRight"]
FIT_MODE = ["Unconstrained", "MinSize", "PreferredSize"]
SCALE_MODE = ["ConstantPixelSize", "ScaleWithScreenSize", "ConstantPhysicalSize"]
RENDER_MODE = ["ScreenSpaceOverlay", "ScreenSpaceCamera", "WorldSpace"]


def mb_header(r: R):
    """MonoBehaviour: m_GameObject, m_Enabled, m_Script, m_Name"""
    go = r.pptr()
    enabled = r.b[r.p] != 0
    r.p += 1
    r.align()
    script = r.pptr()
    name = r.string()
    return go, enabled, script, name


def persistent_calls(r: R):
    """UnityEvent.m_PersistentCalls.m_Calls"""
    n = r.i32()
    if not 0 <= n < 64:
        raise ValueError("persistent call count %d" % n)
    for _ in range(n):
        r.pptr()
        r.string()
        r.string()
        r.i32()
        r.pptr()
        r.string()
        r.i32()
        r.f32()
        r.string()
        r.boolean()
        r.i32()


def p_graphic(r: R, d: dict):
    """UnityEngine.UI.Graphic + MaskableGraphic"""
    d["_material"] = r.pptr()
    d["color"] = hex_color(r.floats(4))
    d["raycast"] = r.boolean()
    r.floats(4)          # m_RaycastPadding
    r.boolean()          # m_Maskable
    persistent_calls(r)  # m_OnCullStateChanged


def p_image(r: R, d: dict):
    p_graphic(r, d)
    d["_sprite"] = r.pptr()
    d["imageType"] = pick(IMAGE_TYPES, r.i32())
    d["preserveAspect"] = r.boolean()
    d["fillCenter"] = r.boolean()
    fm = r.i32()
    fa = r.f32()
    r.boolean()
    r.i32()
    r.boolean()
    ppu = r.f32()
    if d["imageType"] == "Filled":
        d["fillMethod"] = pick(FILL_METHODS, fm)
        d["fillAmount"] = rnd(fa)
    if abs(ppu - 1.0) > 1e-6:
        d["pixelsPerUnitMultiplier"] = rnd(ppu)


def p_rawimage(r: R, d: dict):
    p_graphic(r, d)
    d["_texture"] = r.pptr()
    uv = r.floats(4)
    if rnd(uv) != [0, 0, 1, 1]:
        d["uvRect"] = rnd(uv)


def p_text(r: R, d: dict):
    """legacy UnityEngine.UI.Text"""
    p_graphic(r, d)
    d["_font"] = r.pptr()
    d["fontSize"] = r.i32()
    d["fontStyle"] = pick(["Normal", "Bold", "Italic", "BoldAndItalic"], r.i32())
    d["bestFit"] = r.boolean()
    r.i32()
    r.i32()
    d["align"] = pick(TEXT_ANCHOR, r.i32())
    r.boolean()
    r.boolean()
    r.i32()
    r.i32()
    d["lineSpacing"] = rnd(r.f32())
    d["text"] = r.string()


def p_tmp(r: R, d: dict):
    """TMPro.TextMeshProUGUI (TMP 3.0.x field order)"""
    p_graphic(r, d)
    d["text"] = r.string()
    r.boolean()                       # m_isRightToLeft
    d["_font"] = r.pptr()
    d["_fontMaterial"] = r.pptr()
    n = r.i32()                       # m_fontSharedMaterials
    r.p += 12 * n
    r.pptr()
    n = r.i32()                       # m_fontMaterials
    r.p += 12 * n
    d["color"] = hex_color32(r.color32())
    r.floats(4)                       # m_fontColor (same value as float)
    grad = r.boolean()
    r.i32()
    g = r.floats(16)
    if grad:
        d["vertexGradient"] = [hex_color(g[i:i + 4]) for i in (0, 4, 8, 12)]  # TL TR BL BR
    r.pptr()
    r.pptr()                          # m_spriteAsset
    r.boolean()
    r.pptr()
    r.i32()
    r.boolean()
    r.color32()                       # m_faceColor
    d["fontSize"] = rnd(r.f32())
    r.f32()
    w = r.i32()
    if w != 400:
        d["fontWeight"] = w
    auto = r.boolean()
    fmin = r.f32()
    fmax = r.f32()
    if auto:
        d["autoSize"] = [rnd(fmin), rnd(fmax)]
    st = r.i32()
    if st:
        d["fontStyle"] = "+".join(nm for bit, nm in TMP_STYLE if st & bit) or st
    h = r.i32()
    v = r.i32()
    r.i32()
    d["align"] = f"{TMP_H.get(h, h)}/{TMP_V.get(v, v)}"
    cs = r.f32()
    ws = r.f32()
    ls = r.f32()
    r.f32()
    ps = r.f32()
    r.f32()
    for k, x in (("characterSpacing", cs), ("wordSpacing", ws), ("lineSpacing", ls), ("paragraphSpacing", ps)):
        if abs(x) > 1e-6:
            d[k] = rnd(x)
    d["wordWrap"] = r.boolean()
    r.f32()
    d["overflow"] = pick(TMP_OVERFLOW, r.i32())
    r.pptr()
    r.pptr()
    r.boolean()
    r.boolean()
    r.boolean()
    if not r.boolean():
        d["richText"] = False
    r.boolean()
    r.boolean()
    r.boolean()
    r.i32()
    r.i32()
    r.f32()
    r.i32()
    r.boolean()
    r.boolean()
    r.boolean()
    r.i32()
    m = r.floats(4)
    if any(abs(x) > 1e-6 for x in m):
        d["margin"] = rnd(m)          # left, top, right, bottom
    r.boolean()
    r.boolean()
    r.boolean()                       # TextMeshProUGUI.m_hasFontAssetChanged
    r.pptr()
    r.floats(4)


def p_layout_element(r: R, d: dict):
    if r.boolean():
        d["ignoreLayout"] = True
    v = r.floats(6)
    pr = r.i32()
    for k, x in zip(("minWidth", "minHeight", "preferredWidth", "preferredHeight", "flexibleWidth", "flexibleHeight"), v):
        if x >= 0:
            d[k] = rnd(x)
    if pr != 1:
        d["layoutPriority"] = pr


def _padding(r: R) -> dict:
    left, right, top, bottom = r.i32(), r.i32(), r.i32(), r.i32()
    return {"left": left, "right": right, "top": top, "bottom": bottom}


def p_hv_group(r: R, d: dict):
    d["padding"] = _padding(r)
    d["childAlignment"] = pick(TEXT_ANCHOR, r.i32())
    d["spacing"] = rnd(r.f32())
    d["childForceExpand"] = [r.boolean(), r.boolean()]  # width, height
    d["childControl"] = [r.boolean(), r.boolean()]
    d["childScale"] = [r.boolean(), r.boolean()]
    if r.boolean():
        d["reverse"] = True


def p_grid_group(r: R, d: dict):
    d["padding"] = _padding(r)
    d["childAlignment"] = pick(TEXT_ANCHOR, r.i32())
    d["startCorner"] = pick(["UpperLeft", "UpperRight", "LowerLeft", "LowerRight"], r.i32())
    d["startAxis"] = "Vertical" if r.i32() else "Horizontal"
    d["cellSize"] = rnd(r.floats(2))
    d["spacing"] = rnd(r.floats(2))
    d["constraint"] = pick(["Flexible", "FixedColumnCount", "FixedRowCount"], r.i32())
    d["constraintCount"] = r.i32()


def p_fitter(r: R, d: dict):
    d["horizontalFit"] = pick(FIT_MODE, r.i32())
    d["verticalFit"] = pick(FIT_MODE, r.i32())


def p_aspect(r: R, d: dict):
    d["aspectMode"] = pick(["None", "WidthControlsHeight", "HeightControlsWidth", "FitInParent", "EnvelopeParent"], r.i32())
    d["aspectRatio"] = rnd(r.f32(), 4)


def p_scaler(r: R, d: dict):
    d["uiScaleMode"] = pick(SCALE_MODE, r.i32())
    d["referencePixelsPerUnit"] = rnd(r.f32())
    d["scaleFactor"] = rnd(r.f32())
    d["referenceResolution"] = rnd(r.floats(2))
    d["screenMatchMode"] = pick(["MatchWidthOrHeight", "Expand", "Shrink"], r.i32())
    d["matchWidthOrHeight"] = rnd(r.f32())


def p_mask(r: R, d: dict):
    d["showMaskGraphic"] = r.boolean()


def p_selectable(r: R, d: dict):
    """UnityEngine.UI.Selectable head (Button / Toggle / Slider / Scrollbar share it)"""
    r.i32()
    r.boolean()
    for _ in range(4):
        r.pptr()
    tr = r.i32()
    d["transition"] = pick(["None", "ColorTint", "SpriteSwap", "Animation"], tr)
    cols = [hex_color(r.floats(4)) for _ in range(5)]
    r.f32()
    r.f32()
    if tr == 1:
        d["colors"] = dict(zip(("normal", "highlighted", "pressed", "selected", "disabled"), cols))
    sp = [r.pptr() for _ in range(4)]
    if tr == 2:
        d["_spriteState"] = sp  # highlighted, pressed, selected, disabled
    for _ in range(5):
        r.string()
    if not r.boolean():
        d["interactable"] = False
    r.pptr()


def p_scrollrect(r: R, d: dict):
    r.pptr()
    d["horizontal"] = r.boolean()
    d["vertical"] = r.boolean()
    d["movementType"] = pick(["Unrestricted", "Elastic", "Clamped"], r.i32())


# script class -> (label in the dump, reader). Everything else is listed by class name with the
# strings and sprite pointers found in its body (heuristic).
PARSERS = {
    "UnityEngine.UI.Image": ("Image", p_image),
    "UnityEngine.UI.RawImage": ("RawImage", p_rawimage),
    "UnityEngine.UI.Text": ("Text", p_text),
    "TMPro.TextMeshProUGUI": ("TextMeshProUGUI", p_tmp),
    "CustomTextMeshProUGUI": ("TextMeshProUGUI", p_tmp),   # BSG subclass, no extra serialized fields
    "UnityEngine.UI.LayoutElement": ("LayoutElement", p_layout_element),
    "UnityEngine.UI.HorizontalLayoutGroup": ("HorizontalLayoutGroup", p_hv_group),
    "UnityEngine.UI.VerticalLayoutGroup": ("VerticalLayoutGroup", p_hv_group),
    "UnityEngine.UI.GridLayoutGroup": ("GridLayoutGroup", p_grid_group),
    "UnityEngine.UI.ContentSizeFitter": ("ContentSizeFitter", p_fitter),
    "UnityEngine.UI.AspectRatioFitter": ("AspectRatioFitter", p_aspect),
    "UnityEngine.UI.CanvasScaler": ("CanvasScaler", p_scaler),
    "UnityEngine.UI.Mask": ("Mask", p_mask),
    "UnityEngine.UI.Button": ("Button", p_selectable),
    "UnityEngine.UI.Toggle": ("Toggle", p_selectable),
    "UnityEngine.UI.Slider": ("Slider", p_selectable),
    "UnityEngine.UI.Scrollbar": ("Scrollbar", p_selectable),
    "UnityEngine.UI.ScrollRect": ("ScrollRect", p_scrollrect),
}
QUIET = {"UnityEngine.UI.GraphicRaycaster", "UnityEngine.UI.RectMask2D", "UnityEngine.UI.ToggleGroup",
         "UnityEngine.EventSystems.EventTrigger", "UnityEngine.UI.Outline", "UnityEngine.UI.Shadow"}
LAYOUT_DRIVERS = {"HorizontalLayoutGroup", "VerticalLayoutGroup", "GridLayoutGroup"}

_STR_OK = re.compile(r"^[^\x00-\x08\x0b\x0c\x0e-\x1f\ufffd]+$")


def scan_strings(raw: bytes, start: int, limit: int = 12) -> list[str]:
    """length-prefixed, 4-aligned utf-8 strings inside an unknown MonoBehaviour body (heuristic)"""
    out = []
    p = start
    n = len(raw)
    while p + 4 <= n and len(out) < limit:
        ln = struct.unpack_from("<i", raw, p)[0]
        if 2 <= ln <= 400 and p + 4 + ln <= n:
            end = p + 4 + ln
            pad = (-ln) % 4
            if end + pad <= n and not any(raw[end:end + pad]):
                try:
                    s = raw[p + 4:end].decode("utf-8")
                except UnicodeDecodeError:
                    s = None
                if s and _STR_OK.match(s) and sum(ch.isalnum() for ch in s) >= max(2, len(s) // 2):
                    out.append(s)
                    p = end + pad
                    continue
        p += 4
    return out


class Scanner:
    def __init__(self, game: Path, index: dict):
        import UnityPy
        self.UnityPy = UnityPy
        self.data = Path(game) / DATA
        self.files: dict[str, object] = {}
        self.names: dict[tuple[str, int], tuple[str, str] | None] = {}
        for e in index["entries"]:
            if e.get("name") is not None:
                self.names[(e["file"], e["path_id"])] = (e["type"], e["name"])
        self.sprite_keys = {k for k, v in self.names.items() if v[0] == "Sprite"}
        self.scripts: dict[int, str] = {}
        env = UnityPy.load(str(self.data / "globalgamemanagers.assets"))
        for o in env.objects:
            if o.type.name == "MonoScript":
                d = o.read()
                self.scripts[o.path_id] = ".".join(x for x in (d.m_Namespace, d.m_ClassName) if x)
        self.usage: dict[tuple[str, int], list] = defaultdict(list)
        self.usage_count: Counter = Counter()
        self.usage_screens: dict[tuple[str, int], Counter] = defaultdict(Counter)
        self.class_count: Counter = Counter()
        self.parse_fail: Counter = Counter()

    def file(self, name: str):
        key = name.lower()
        if key not in self.files:
            p = self.data / name
            self.files[key] = list(self.UnityPy.load(str(p)).files.values())[0] if p.exists() else None
        return self.files[key]

    def obj_name(self, fname: str, pid: int):
        """(type, name) of any object, resolved lazily"""
        k = (fname, pid)
        if k in self.names:
            return self.names[k]
        sf = self.file(fname)
        res = None
        if sf is not None and pid in sf.objects:
            o = sf.objects[pid]
            tn = o.type.name
            try:
                nm = mb_header(R(o.get_raw_data()))[3] if tn == "MonoBehaviour" else o.peek_name()
            except Exception:
                nm = None
            res = (tn, nm or "")
        self.names[k] = res
        return res

    def add_usage(self, key, path, kind):
        self.usage_count[key] += 1
        self.usage_screens[key][screen_of(path)] += 1
        lst = self.usage[key]
        if len(lst) < 40:
            lst.append(f"{path} [{kind}]")

    def scan(self, fname: str, label: str, prefabs: bool) -> list[dict]:
        """root nodes of every UI hierarchy in one serialized file"""
        sf = self.file(fname)
        if sf is None:
            return []
        ext = [e.path.rsplit("/", 1)[-1] for e in sf.externals]
        objs = sf.objects

        def target(pp):
            fid, pid = pp
            if pid == 0:
                return None
            if fid == 0:
                return (fname, pid)
            if 0 < fid <= len(ext):
                return (ext[fid - 1], pid)
            return None

        def ref(pp):
            t = target(pp)
            if t is None:
                return None
            nm = self.obj_name(*t)
            return {"name": nm[1] if nm else None, "type": nm[0] if nm else None, "file": t[0], "path_id": t[1]}

        trs = {}
        for pid, o in objs.items():
            if o.type.name in ("Transform", "RectTransform"):
                try:
                    trs[pid] = (o.type.name, o.read())
                except Exception:
                    pass
        roots = [pid for pid, (tn, d) in trs.items() if d.m_Father.m_PathID not in trs]

        def rect_share(pid):
            n = rt = 0
            stack = [pid]
            while stack:
                tn, d = trs[stack.pop()]
                n += 1
                rt += tn == "RectTransform"
                stack.extend(c.m_PathID for c in d.m_Children if c.m_PathID in trs)
            return rt, n

        def comp_dict(o, node_path):
            tn = o.type.name
            if tn == "MonoBehaviour":
                raw = o.get_raw_data()
                r = R(raw)
                try:
                    _, enabled, script, _ = mb_header(r)
                except Exception:
                    return {"type": "MonoBehaviour?"}
                st = target(script)
                cls = self.scripts.get(st[1], "?") if st and st[0] == "globalgamemanagers.assets" else "?"
                self.class_count[cls] += 1
                d = {"type": cls}
                if not enabled:
                    d["enabled"] = False
                body = r.p
                parser = PARSERS.get(cls)
                parsed = False
                if parser:
                    d["type"] = parser[0]
                    try:
                        parser[1](r, d)
                        parsed = True
                    except Exception as exc:
                        self.parse_fail[cls] += 1
                        d["parse_error"] = type(exc).__name__
                elif cls not in QUIET:
                    # a subclass of Image keeps Image's leading layout: accept when its sprite pointer checks out
                    if len(raw) - body >= 104:
                        try:
                            trial = {}
                            r2 = R(raw, body)
                            p_image(r2, trial)
                            ts = target(trial["_sprite"])
                            tm = target(trial["_material"])
                            if ts in self.sprite_keys and isinstance(trial["imageType"], str) and \
                                    (tm is None or (self.obj_name(*tm) or ("",))[0] == "Material"):
                                d.update(trial)
                                d["base"] = "Image"
                                parsed = True
                                r = r2
                        except Exception:
                            pass
                    start = r.p if parsed else body
                    strings = scan_strings(raw, start)
                    if strings:
                        d["strings"] = strings
                    refs = []
                    p = start
                    n = len(raw)
                    while p + 12 <= n:
                        fid, pid = struct.unpack_from("<iq", raw, p)
                        if pid and 0 <= fid <= len(ext):
                            t = (fname, pid) if fid == 0 else (ext[fid - 1], pid)
                            if t in self.sprite_keys:
                                if t not in refs:
                                    refs.append(t)
                                p += 12
                                continue
                        p += 4
                    if refs:
                        d["sprite_refs"] = [self.names[t][1] for t in refs[:60]]
                        for t in refs:
                            self.add_usage(t, node_path, cls + " field")
                for k in [k for k in d if k.startswith("_")]:
                    v = d.pop(k)
                    if k == "_spriteState":
                        ss = {}
                        for nm, pp in zip(("highlighted", "pressed", "selected", "disabled"), v):
                            t = target(pp)
                            if t:
                                ss[nm] = (ref(pp) or {}).get("name")
                                if t in self.sprite_keys:
                                    self.add_usage(t, node_path, "Selectable." + nm)
                        if ss:
                            d["spriteState"] = ss
                        continue
                    rr = ref(v)
                    if k in ("_sprite", "_texture"):
                        key = k[1:]
                        if rr is None:
                            d[key] = None
                        else:
                            d[key] = rr["name"] or f"<{rr['file']}:{rr['path_id']}>"
                            d[key + "_src"] = f"{rr['file']}:{rr['path_id']}"
                            t = target(v)
                            if rr["type"] in ("Sprite", "Texture2D") and t in self.names:
                                self.add_usage(t, node_path, d["type"] if d["type"] in ("Image", "RawImage") else d["type"] + " (Image)")
                    elif rr is not None and rr["name"]:
                        if k == "_material":
                            if rr["name"] != "Default UI Material":
                                d["material"] = rr["name"]
                        else:
                            d[k[1:]] = rr["name"]
                return d
            if tn == "Canvas":
                try:
                    c = o.read()
                    d = {"type": "Canvas", "renderMode": pick(RENDER_MODE, c.m_RenderMode), "sortingOrder": c.m_SortingOrder}
                    if getattr(c, "m_OverrideSorting", False):
                        d["overrideSorting"] = True
                    if not c.m_Enabled:
                        d["enabled"] = False
                    return d
                except Exception:
                    return {"type": "Canvas"}
            if tn == "CanvasGroup":
                try:
                    c = o.read()
                    d = {"type": "CanvasGroup", "alpha": rnd(c.m_Alpha)}
                    if not c.m_Interactable:
                        d["interactable"] = False
                    if not c.m_BlocksRaycasts:
                        d["blocksRaycasts"] = False
                    return d
                except Exception:
                    return {"type": "CanvasGroup"}
            if tn in ("CanvasRenderer", "Transform", "RectTransform"):
                return None
            return {"type": tn}

        def build(pid, path):
            tn, d = trs[pid]
            try:
                go = d.m_GameObject.read()
                name, active, comps = go.m_Name, bool(go.m_IsActive), go.m_Component
            except Exception:
                name, active, comps = "?", True, []
            node_path = f"{path}/{name}" if path else name
            node = {"name": name}
            if not active:
                node["active"] = False
            node["id"] = d.m_GameObject.m_PathID
            if tn == "RectTransform":
                node["rect"] = {
                    "anchorMin": rnd((d.m_AnchorMin.x, d.m_AnchorMin.y)),
                    "anchorMax": rnd((d.m_AnchorMax.x, d.m_AnchorMax.y)),
                    "anchoredPosition": rnd((d.m_AnchoredPosition.x, d.m_AnchoredPosition.y), 2),
                    "sizeDelta": rnd((d.m_SizeDelta.x, d.m_SizeDelta.y), 2),
                    "pivot": rnd((d.m_Pivot.x, d.m_Pivot.y)),
                }
            else:
                lp = d.m_LocalPosition
                if abs(lp.x) + abs(lp.y) + abs(lp.z) > 1e-6:
                    node["localPosition"] = rnd((lp.x, lp.y, lp.z), 2)
            sc = d.m_LocalScale
            if abs(sc.x - 1) + abs(sc.y - 1) + abs(sc.z - 1) > 1e-4:
                node["scale"] = rnd((sc.x, sc.y, sc.z))
            q = d.m_LocalRotation
            if abs(q.x) + abs(q.y) + abs(q.z) > 1e-4:
                if abs(q.x) + abs(q.y) < 1e-4:
                    node["rotationZ"] = rnd(math.degrees(2 * math.atan2(q.z, q.w)), 2)
                else:
                    node["rotation"] = rnd((q.x, q.y, q.z, q.w), 4)
            cl = []
            for cp in comps:
                cpid = cp.component.m_PathID if hasattr(cp, "component") else cp.m_PathID
                o = objs.get(cpid)
                if o is None:
                    continue
                try:
                    cd = comp_dict(o, node_path)
                except Exception as exc:
                    cd = {"type": o.type.name, "error": type(exc).__name__}
                if cd:
                    cl.append(cd)
            if cl:
                node["components"] = cl
            ch = [build(c.m_PathID, node_path) for c in d.m_Children if c.m_PathID in trs]
            if ch:
                node["children"] = ch
            return node

        out = []
        for pid in roots:
            rt, n = rect_share(pid)
            if rt == 0:
                continue
            if prefabs and trs[pid][0] != "RectTransform" and rt * 2 < n:
                continue  # a 3D prefab that merely carries a world-space label
            out.append(build(pid, label))
        return out


def comp_types(node: dict) -> list[str]:
    return [c.get("type", "?") for c in node.get("components", [])]


def resolve(node: dict, parent_abs, parent_size, driven: bool) -> None:
    """node['abs'] = [left, top, width, height] in canvas px (top-left origin) from anchors alone.
    Layout groups / fitters are not simulated: nodes they control get 'approx': true and their numbers are
    whatever the editor last serialized (often 0) - read the group's padding / spacing and the
    LayoutElement sizes instead."""
    comps = comp_types(node)
    rt = node.get("rect")
    size, absr = parent_size, parent_abs
    if "Canvas" in comps and parent_size is None:
        size, absr = CANVAS, (0.0, 0.0)
        node["abs"] = [0, 0, CANVAS[0], CANVAS[1]]
    elif rt is not None:
        pw, ph = parent_size if parent_size is not None else (0.0, 0.0)
        ax0, ay0 = rt["anchorMin"]
        ax1, ay1 = rt["anchorMax"]
        px, py = rt["anchoredPosition"]
        sx, sy = rt["sizeDelta"]
        pvx, pvy = rt["pivot"]
        w = (ax1 - ax0) * pw + sx
        h = (ay1 - ay0) * ph + sy
        if parent_size is None:      # prefab root: its own box at the origin
            left = top = 0.0
        else:
            left = ax0 * pw + (ax1 - ax0) * pw * pvx + px - w * pvx
            bottom = ay0 * ph + (ay1 - ay0) * ph * pvy + py - h * pvy
            top = ph - (bottom + h)
        base = parent_abs if parent_abs is not None else (0.0, 0.0)
        absr = (base[0] + left, base[1] + top)
        size = (w, h)
        node["abs"] = [rnd(absr[0], 1), rnd(absr[1], 1), rnd(w, 1), rnd(h, 1)]
        if driven or "ContentSizeFitter" in comps or "AspectRatioFitter" in comps:
            node["approx"] = True
    child_driven = driven or bool(LAYOUT_DRIVERS & set(comps)) or "ContentSizeFitter" in comps
    for c in node.get("children", []):
        resolve(c, absr, size, child_driven)


def outline(node: dict, depth: int, lines: list) -> None:
    bits = []
    for c in node.get("components", []):
        t = c.get("type", "?")
        if t in ("Image", "RawImage") or c.get("base") == "Image":
            s = c.get("sprite") if "sprite" in c else c.get("texture")
            s = "<none>" if s is None else s
            col = "" if c.get("color", "#ffffffff") == "#ffffffff" else " " + c["color"]
            it = c.get("imageType")
            bits.append(f"{t if t in ('Image', 'RawImage') else t + '(Image)'}={s}{col}{' ' + it if it and it != 'Simple' else ''}")
        elif t in ("TextMeshProUGUI", "Text"):
            txt = (c.get("text") or "").replace("\n", "\\n")
            if len(txt) > 60:
                txt = txt[:57] + "..."
            style = f" {c['fontStyle']}" if c.get("fontStyle") not in (None, "Normal") else ""
            bits.append(f"{'TMP' if t == 'TextMeshProUGUI' else 'Text'}=\"{txt}\" {c.get('fontSize')}px{style} "
                        f"{c.get('color', '')} {c.get('align', '')}".rstrip())
        elif t in ("HorizontalLayoutGroup", "VerticalLayoutGroup"):
            p = c.get("padding", {})
            bits.append(f"{'HLG' if t[0] == 'H' else 'VLG'}(spacing={c.get('spacing')} "
                        f"pad L{p.get('left')} T{p.get('top')} R{p.get('right')} B{p.get('bottom')} {c.get('childAlignment')})")
        elif t == "GridLayoutGroup":
            bits.append(f"Grid(cell={c.get('cellSize')} spacing={c.get('spacing')} {c.get('constraint')}={c.get('constraintCount')})")
        elif t == "LayoutElement":
            parts = [f"{ab}={c[k]}" for k, ab in (("minWidth", "minW"), ("minHeight", "minH"), ("preferredWidth", "prefW"),
                                                 ("preferredHeight", "prefH"), ("flexibleWidth", "flexW"),
                                                 ("flexibleHeight", "flexH")) if k in c]
            if c.get("ignoreLayout"):
                parts.append("ignore")
            if parts:
                bits.append("LE(" + " ".join(parts) + ")")
        elif t == "ContentSizeFitter":
            bits.append(f"Fit({c.get('horizontalFit')},{c.get('verticalFit')})")
        elif t == "CanvasScaler":
            bits.append(f"CanvasScaler({c.get('uiScaleMode')} x{c.get('scaleFactor')})")
        elif t == "Canvas":
            bits.append(f"Canvas({c.get('renderMode')} order={c.get('sortingOrder')})")
        elif t == "CanvasGroup":
            bits.append(f"CanvasGroup(alpha={c.get('alpha')})")
        else:
            s = t
            if c.get("strings"):
                s += "{" + "|".join(x if len(x) <= 44 else x[:41] + "..." for x in c["strings"][:4]) + "}"
            if c.get("sprite_refs"):
                s += "<" + ",".join(c["sprite_refs"][:6]) + (",..." if len(c["sprite_refs"]) > 6 else "") + ">"
            bits.append(s)
    a = node.get("abs")
    geo = f" [{a[0]},{a[1]} {a[2]}x{a[3]}{'~' if node.get('approx') else ''}]" if a else ""
    lines.append(f"{'  ' * depth}{'' if node.get('active', True) else '(off) '}{node['name']}{geo}"
                 + (("  " + "; ".join(bits)) if bits else ""))
    for c in node.get("children", []):
        outline(c, depth + 1, lines)


def count_nodes(node) -> int:
    return 1 + sum(count_nodes(c) for c in node.get("children", []))


NODE_KEY_ORDER = ("name", "active", "id", "rect", "abs", "approx", "localPosition", "scale", "rotationZ", "rotation",
                  "components", "children_files", "children")


def tidy(node: dict) -> dict:
    """same node with its keys in reading order (geometry before components before children)"""
    out = {k: node[k] for k in NODE_KEY_ORDER if k in node and k != "children"}
    out.update({k: v for k, v in node.items() if k not in out and k != "children"})
    if "children" in node:
        out["children"] = [tidy(c) for c in node["children"]]
    return out


def screen_of(path: str) -> str:
    """'<label>/<root>/.../node [kind]' -> short id of the screen / prefab that holds the node"""
    p = path.rsplit(" [", 1)[0].split("/")
    label = p[0]
    if label.startswith("prefab."):
        return f"P.{label[7:]}:{p[1] if len(p) > 1 else ''}"
    short = label.replace("UIScene", "")
    if label in ("CommonUIScene", "MenuUIScene"):
        return f"{short}:{p[3] if len(p) > 3 else p[-1]}"
    if label == "PreloaderUIScene":
        if len(p) > 4 and p[3] == "UIContext":
            return f"{short}:{p[4]}"
        return f"{short}:{p[3] if len(p) > 3 else p[-1]}"
    return f"{short}:{p[2] if len(p) > 2 else p[-1]}"


def cmd_layout(game: Path) -> None:
    t0 = time.time()
    index = load_index()
    sc = Scanner(game, index)
    ldir = OUT / "layout"
    ldir.mkdir(parents=True, exist_ok=True)
    listing = []

    def emit(scene: str, rel_name: str, node: dict, path: str, note: str = "") -> None:
        lines: list[str] = []
        outline(node, 0, lines)
        stem = safe_name(rel_name)   # may contain dots: never use with_suffix() on it
        write_json(ldir / scene / (stem + ".json"), {
            "scene": scene, "path": path, "canvas": list(CANVAS),
            "note": "abs = [left, top, width, height] px on a 1920x1080 canvas, top-left origin, resolved from "
                    "anchors only; approx=true where a layout group / fitter decides the box at runtime. " + note,
            "root": tidy(node),
        })
        (ldir / scene / (stem + ".txt")).write_text("\n".join(lines), encoding="utf-8")
        listing.append({"scene": scene, "name": rel_name, "file": f"{scene}/{stem}.json",
                        "nodes": count_nodes(node), "active": node.get("active", True),
                        "classes": [t for t in comp_types(node) if "." in t or t[:1].isupper() and t not in (
                            "Canvas", "CanvasGroup", "Image", "LayoutElement", "ContentSizeFitter",
                            "HorizontalLayoutGroup", "VerticalLayoutGroup")][:4]})

    def is_screen(node: dict) -> bool:
        return any(t.endswith("Screen") for t in comp_types(node))

    def split(scene: str, node: dict, path: str, prefix: str, depth: int) -> None:
        """one file per screen; containers that are not screens themselves and hold > 2500 nodes are split again"""
        kids = node.get("children", [])
        n = count_nodes(node)
        if depth > 0 and (n <= 2500 or is_screen(node) or not kids):
            emit(scene, prefix or node["name"], node, path)
            return
        shell = {k: v for k, v in node.items() if k != "children"}
        shell["children_files"] = [safe_name(f"{prefix + '.' if prefix else ''}{c['name']}") for c in kids]
        if depth > 0:
            emit(scene, (prefix or node["name"]) + "._self", shell, path, "Children are in their own files.")
        seen = Counter()
        for c in kids:
            seen[c["name"]] += 1
            nm = c["name"] if seen[c["name"]] == 1 else f"{c['name']}~{seen[c['name']]}"
            split(scene, c, f"{path}/{c['name']}", f"{prefix + '.' if prefix else ''}{nm}" if depth > 0 else nm, depth + 1)

    for fname, scene in UI_SCENES:
        roots = sc.scan(fname, scene, prefabs=False)
        for root in roots:
            resolve(root, None, None, False)
            # walk down to the node that holds the screens (root -> canvas -> screens)
            node, path = root, root["name"]
            while len(node.get("children", [])) == 1 and count_nodes(node) > 60:
                node = node["children"][0]
                path += "/" + node["name"]
            head = {k: v for k, v in root.items() if k != "children"}
            if node is not root:
                head["canvas_node"] = {k: v for k, v in node.items() if k != "children"}
            head["screens"] = [c["name"] for c in node.get("children", [])]
            write_json(ldir / scene / "_scene.json", {"scene": scene, "file": fname, "root": head}, pretty=True)
            split(scene, node, path, "", 0)
        print(f"  {fname:22s} {scene:20s} {sum(count_nodes(r) for r in roots):6d} nodes", flush=True)

    for fname, label in UI_PREFAB_FILES:
        roots = sc.scan(fname, label, prefabs=True)
        seen = Counter()
        for root in roots:
            resolve(root, None, None, False)
            seen[root["name"]] += 1
            nm = root["name"] if seen[root["name"]] == 1 else f"{root['name']}~{root['id']}"
            emit(label, nm, root, root["name"], "Prefab (template instantiated at runtime): abs is relative to its own box.")
        print(f"  {fname:22s} {label:20s} {sum(count_nodes(r) for r in roots):6d} nodes in {len(roots)} prefabs", flush=True)

    # sprite / texture usage
    usage = {}
    for k, uses in sc.usage.items():
        nm = sc.names.get(k)
        screens = sc.usage_screens[k]
        usage[f"{k[0]}:{k[1]}"] = {"name": nm[1] if nm else None, "type": nm[0] if nm else None,
                                   "count": sc.usage_count[k], "screens": [s for s, _ in screens.most_common()],
                                   "uses": uses}
    write_json(ldir / "sprite_usage.json", usage)
    write_json(ldir / "_screens.json", sorted(listing, key=lambda x: (x["scene"], x["name"])), pretty=True)
    write_json(ldir / "_script_classes.json", sc.class_count.most_common(), pretty=True)

    for e in index["entries"]:
        u = usage.get(f"{e['file']}:{e['path_id']}")
        e.pop("used_by", None)
        e.pop("use_count", None)
        if u:
            e["use_count"] = u["count"]
            e["used_by"] = u["uses"][:6]
    write_json(index_path(), index)
    if sc.parse_fail:
        print(f"  !! reader failures: {dict(sc.parse_fail)}")
    print(f"[layout] {len(listing)} screen / prefab dumps, {len(usage)} referenced sprites+textures, "
          f"{len(sc.class_count)} script classes -> {ldir}  [{time.time() - t0:.0f}s]")


# ===========================================================================
# export
# ===========================================================================
# Traders whose avatar ships in the client (ui/icons/trader/avatar). The id is the avatar image id the
# backend refers to (/files/trader/avatar/<id>), not the trader id; the table is rebuilt from the embedded
# TestTradersSettings TextAsset when it is readable and this copy is the fallback.
AVATAR_NAMES = {
    "59b91ca086f77469a81232e4": "prapor", "59b91cab86f77469aa5343ca": "therapist",
    "579dc571d53a0658a154fbec": "fence", "59b91cb486f77469a81232e5": "skier",
    "59b91cbd86f77469aa5343cb": "peacekeeper", "5a7c2ebb86f7746e324a06ab": "mechanic",
    "5ac3b86a86f77461491d1ad8": "ragman", "5c06531a86f7746319710e1b": "jaeger",
    "638f541a29ffd1183d187f57": "lightkeeper", "656f0f98d80a697f855d34b1": "btr_driver",
    "6617beeaa9cfa777ca915b7c": "ref", "68d40acd29ce74ed950a471d": "mr_kerman",
    "5824657996560e1be8000848": "unknown_default",
}

# --- 1. names that decide the folder on their own (the art the menu rebuild asks for by role) -------------
NAME_FIRST = [
    # a. traders
    (r"^(loyalty_(one|two|three|king|king_new)|trader_rank_elite|LL|lvl|Insurance_LL-form|bind_label)$", "a_traders/loyalty_standing"),
    (r"^(standing_icon( 1_0)?|icon_standing_small|icon_reputation(_up|_down)?|icon_positive_karma|icon_karma_warning)$", "a_traders/loyalty_standing"),
    (r"^(trader_requirements_met|trader_red_warning|trader_(not_)?available(_glow)?|checkmark_trader_big_\d|icon_update_time|"
     r"icon_discount|image_diagonal_trader|TraderBar_Texture_Square_Big|back_id_(trader|myoffer)|SCAV_trader_screen|"
     r"avatar_background|default_avatar|avatar\(Mock\)|PlayerCard_Shadow-1|icon_question_mark)$", "a_traders/trader_list_card"),
    (r"^(Dialog_Icons_|icons_dialogue_|DialogBubble|Dialog_Hideout_Calling|Social_Trader|HistoryArrow)", "a_traders/dialog"),
    (r"^(service_|BTR_Services_|BTR_Message_Icon|Arena_Traders_Services_|Eft_Traders_Services_|EFT_Services_Outfit_|Services_Outfit_|"
     r"icon_repair_required|repair_points_|health_treatment_icon|Insurance_Return-Rate_Icon|items_icon$)", "a_traders/services"),
    (r"^(Trade_|tab_icon_(buy|sell)|deal_button_icon|needed_(yes|no)|EFT_TraderQuest_|icon_trade$|GP_for_trading_view|commission_icon)", "a_traders/trader_screen"),
    # b. menu and navigation
    (r"^(cursor_|pointer$)", "b_menu/cursors"),
    (r"^(escape_from_tarkov_logo|EfT_Logo_Credits|battlestate_splash_logo|S1_CORDBreach_Logotype|Prestige_Logotype_(Arena|EFT)|"
     r"SeasonWidget_Logo_Big|geneburn_logo|quixel_megascans_logo|LogoBattlEye|pegi|copyright|dissonance_logo|"
     r"Dissonance_Large_Icon|PainterLogo|tempSplash|TrialExpiredTexture)$", "b_menu/logo"),
    (r"^(mainmenu_(taskbar|character)_icon|hideout_taskbar_icon|icon_traders|icon_flea_market|icon_presets_big|handbook_icon|"
     r"icon_messenger(_selected)?|ICON_EFT-GamePull-Mini|options_icon|watchlist_icon|task_bar|bottom_bar_tile|lines_tile_(bottom|left)|"
     r"EFT_ExpansionsHub_Footer_Icon|UnreadQuestTaskBarIcon|Footer_Button_Matchmaker_|EFT_Footer_Notification_)", "b_menu/nav_taskbar"),
    (r"^(icon_mainmenu_character|hideout_icon_black|exit_status_runner|icon_button_logout_(idle|over)|mainbutton_|Button|"
     r"EFT_UI_Buttons_Mask|icon_quit|settings_icon)$|^mainbutton_", "b_menu/main_menu"),
    (r"^(tab_icon_|Prestige_TabIcon_|MainQuestTabIcon)", "b_menu/character_tabs"),
    # c. tasks
    (r"^(QuestReward_|EFT_Locations_Reward_Icons|PocketsQuestRewardIcon|StashSpaceQuestRewardIcon|unknown_reward|EFT_Unlock(Craft|Trade)|"
     r"quest_rewards_atlas|IconHideoutLvl|IconSkillLvl|icon_experience|icon_exp_small|exp$|levelling$)", "c_tasks/rewards"),
    (r"^(Chapter|EFT_Storyline_|Ending\d|EscapedFromTarkov|YouDidntEscape|30px_|SelectedChapterMarker|EFT_Notification_Storylain)", "c_tasks/story_chapters"),
    (r"^(CompletableIcons_\d|Quests-Search_Icons_\d|Quests_Chain_Icon|regular_quest_icon(_BIG)?|muli_task_quest|icon_daily_quests|"
     r"completed_mark|blue_check|black_cross|icon_star|replace_Icon|icon_notification_quest_alt|notification_icon_quest|"
     r"BarterQuestLinkIcon|CraftQuestLinkIcon|quest_transfer_(up|down)|Achivement_icon(_pressed)?|"
     r"Favorite_(item_achivement|weapon)|icon_quest)$", "c_tasks/icons"),
    (r"^(DailyQuest|QuestsTab|QuestType|QuestTab|quest_item_border|SCAV_quest_list|blocked_background|ObjectiveProgress|"
     r"TitleSeparator|Skip$|CheckboxBackground$)", "c_tasks/panels"),
    # d. player / progression
    (r"^(Logo_(BEAR|USEC)|icon_(bear|usec)|UI_FS_(BEAR|USEC)|BEAR|USEC)$", "d_player/factions"),
    (r"^(icon_info_money_|money_atlas|(rub|eur|usd|gp)$|icon_currency_barter|icon_info_GP|EFT_ExpansionsHub_Tarcoin|icon_info_moneysum)", "d_player/currency"),
    (r"^(icon_foundinraid|icon_insured_small|insurance_(item_)?shield_icon|insurance_border|icon_lock(_small)?$|Lock$|LockedIcon|"
     r"PinLock_|(Lock|Pin)_Mode_Icon|icon_special_item|icon_secured_container|icon_container$|icon_protect$)", "d_player/item_markers"),
    (r"^(experience_bar_|icon_experience_big)", "d_player/experience"),
    (r"^(Prestige_Icon_Lvl_)", "d_player/prestige"),
    (r"^Prestige_", "d_player/prestige_screen"),
    (r"^(Seasons?_Perks?|Sesons_|Seasons_PerkTemplate|Seasonal(Character|Rank|Personal|Hub|_Awards)|Seasons(Hub|InfoPanel|IntroScreen|"
     r"LeaderbordPanel|_AllScreens)|SeasonReward_|BattlePass|\d_Block_)", "h_seasons/hub"),
    (r"^(character_pmc|skeleton$|body_part_|header_body_part|health_bar_|low_health_glow|icon_(health|energy|hydration)$|"
     r"(upper|lower)_body_icon|Face_Icon)", "d_player/health"),
    (r"(FinalStat$)|^(icon_statscategory_|icon_(killings|looting|survival|time|search)$)", "d_player/stats_icons"),
    (r"^(EfT_UI_Achivement_|Achievement(Common|Legendary|Rare|Seasonal)|Achivement_(Border|Notification)|Frame_Seasons|Substrate_Seasons|"
     r"UI_FS_Achievements|achievementTooltipIcon|(Common|Epic|Legendary|Seasons|Noise) [Gg]low$|Background (main|texture)$)", "d_player/achievements"),
    # e. raid flow
    (r"^(region_map_external|location_(button_background|name_shadow)|map-\d|Bosses-on-Map_Icons|icon_nomap|icon_random_big|path_dot|"
     r"icon_(area|players|difficulty|heat|intro|new|new_glow|available)$)", "e_raid/location_select"),
    (r"^(EFT_watch_|icon_weather_|time_icon$|icon_time_big$|icon_timer)", "e_raid/weather_time"),
    (r"^(extraction_point_icon|entry_point_|icon_exit_pmc|EFT_Secret_Exit|icon_find_point|BTR_Place_icon|notification_entry_point)", "e_raid/extraction"),
    (r"^(exit_status_|icon_leave|status_(green|grey|orange)_|kill_list_separator)", "e_raid/end_screen"),
    (r"^(marker_|map_(legend|marker|market))", "e_raid/map_markers"),
    (r"^TUE_decals_", "z_other/world_decals"),
    (r"^TUE_", "e_raid/loading_tue_edition"),
    (r"^(Glitch_BG_Loop|LoadingScreen_TraderName|Loader_Big|hideout_loading_)", "e_raid/loading_screens"),
    (r"^(mask_(anvis|binocular|gasmask|old_monocular)|VisorMask|malfunction_glow)", "e_raid/hud"),
    # f. kit pieces whose only user is some odd screen
    (r"^(MemberCategoriesAtlas_\d|AllScreens_RanksLetter_Icon)", "f_uikit/chat_social"),
    (r"^(allow_(no|yes|unknown)|hdd_\w+|What|Utils)$", "f_uikit/icons_misc"),
    (r"^((damage_reduction|malfunction_protection|weapon_spread)_buff_)", "f_uikit/cells_items"),
    (r"^(hideout_shooting_range_interface_|RadioMonitor_Big)", "g_hideout/ui"),
]

# --- 2. Resources/ folder (resources.assets) --------------------------------------------------------------
RES_DIR = {
    "ui/icons/trader/avatar": "a_traders/avatars",
    "level icons": "d_player/level_badges",
    "ui/banners": "e_raid/location_banners",
    "ui/icons/banners": "e_raid/location_banners_by_id",
    "ui/splash": "e_raid/loading_splash",
    "ui/splashother": "b_menu/logo",
    "ui/weathericons": "e_raid/weather_time",
    "ui/icons/questrewards/locationunlock": "c_tasks/rewards",
    "ui/icons/achievement": "d_player/achievements_icons",
    "ui/icons/prestige": "d_player/prestige",
    "ui/icons/prestige/reward/big": "d_player/prestige_rewards_big",
    "ui/icons/prestige/reward/small": "d_player/prestige_rewards_small",
    "ui/icons/handbook": "f_uikit/icons_handbook",
    "ui/icons/hideout": "g_hideout/bonus_icons",
    "ui/icons/wishlist": "f_uikit/icons_wishlist",
    "ui/icons/battle-pass": "h_seasons/battle_pass",
    "ui/icons/seasonal": "h_seasons/seasonal",
    "ui/icons/seasonal-perks": "h_seasons/perks",
    "ui/icons/documents": "h_seasons/documents",
    "ui/icons": "f_uikit/icons_misc",
    "ui/notetemplates/notesprites": "f_uikit/notes",
    "characteristics/icons/builds": "i_modding_builds/builds_icons",
    "characteristics/icons": "f_uikit/icons_characteristics",
    "characteristics": "f_uikit/icons_characteristics_small",
    "mod tactical types": "i_modding_builds/mod_type_icons",
    "mod types": "i_modding_builds/mod_type_icons",
    "modding screen icons": "i_modding_builds/modding_screen",
    "slots": "f_uikit/slot_ghosts_weapon",
    "slots/equipment": "f_uikit/slot_ghosts_equipment",
    "slots/armor_plates": "f_uikit/slot_ghosts_armor",
    "special icons": "f_uikit/icons_misc",
    "sprite assets": "f_uikit/icons_misc",
    "stylized": "f_uikit/frames_borders",
    "buttons": "b_menu/buttons_legacy",
    "imageart_782x440": "e_raid/location_select",
    "imagemap_1440x810": "e_raid/location_select",
    "icons": "f_uikit/icons_misc",
    "prefabs/ugui/layouts/itemviewresources": "d_player/item_markers",
    "ui/fonts": "_fonts_tmp_atlases", "ui/fonts/fontstyles": "_fonts_tmp_atlases",
}
# Resources/ folders that are not menu art (colour LUTs, editor skins, debug fonts, prototype textures)
RES_DIR_SKIP = {"instagram", "skin", "textures", "textures/editor", "textures/noise", "ui/bots", "ui/fonts/fallbacks",
                "ui/fonts/source", "materials", "compute", "shaders"}

# --- 3. SpriteAtlas name -----------------------------------------------------------------------------------
ATLAS = {
    "Skill Icons": "d_player/skills", "Effect Icons": "e_raid/status_effects", "Health Icons": "d_player/health",
    "Quests": "c_tasks/icons", "Tab Icons": "b_menu/character_tabs", "stats": "e_raid/end_screen",
    "Item Type Icons": "f_uikit/icons_item_types", "handbook": "f_uikit/icons_handbook", "KeyBinding": "f_uikit/keybinding",
    "ChatBar": "f_uikit/chat_social", "gestures_menu": "e_raid/hud_gestures", "areas": "g_hideout/area_icons",
    "Modules": "g_hideout/area_icons_small", "bonuses": "g_hideout/bonus_icons", "hideout": "g_hideout/ui",
    "light": "g_hideout/ui", "production": "g_hideout/ui", "Cells": "g_hideout/customization",
    "Menu": "g_hideout/customization", "Ceiling": "g_hideout/customization", "Floor": "g_hideout/customization",
    "Wall": "g_hideout/customization", "Service Icons": "a_traders/services", "battlescreen": "e_raid/hud",
    "SurveyScreen": "b_menu/survey_news", "Builds": "i_modding_builds/builds_icons",
    "Mod Tactical Types": "i_modding_builds/mod_type_icons", "Mod Types": "i_modding_builds/mod_type_icons",
    "Modding Screen Icons": "i_modding_builds/modding_screen", "Slots": "f_uikit/slot_ghosts_weapon",
    "Characteristics": "f_uikit/icons_characteristics_small",
}
ATLAS_BY_FILE = {("resources.assets", "Icons", 21): "g_hideout/customization",      # shooting range targets
                 ("sharedassets24.assets", "Icons", 19): "a_traders/flea_market"}

# --- 4. the screen / prefab that shows the sprite (layout pass) -------------------------------------------
SCREEN_RULES = [
    (r"^Common:MenuScreen$", "b_menu/main_menu"),
    (r"^(P\.sa49:TaskBar|Preloader:BottomPanel)$", "b_menu/nav_taskbar"),
    (r"^(P\.sa48:Trader (Card|Panel Template)|Menu:Merchants List)$", "a_traders/trader_list_card"),
    (r"^(Menu:(Trader Screens Group|Trading Screen)|P\.sa48:QuestItemRow)$", "a_traders/trader_screen"),
    (r"^(Common:Trader Dialog Screen|P\.sa44:(TraderDialogWindowOptionRow|LeftDialogBubble|RighrDialogBubble))$", "a_traders/dialog"),
    (r"^Menu:EventDialogScreen$", "h_seasons/event_dialog"),
    (r"^(Menu:Ragfair Screen|P\.sa48:(RagfairOffer|OfferViewList|OffersUpdatePanel|OffersListCombinedCategoryView|Cancellable\w+|"
     r"RagfairAvailabilityWarning)|P\.sa44:RequirementsCombinedCategoryView)$", "a_traders/flea_market"),
    (r"^P\.sa48:ClothingItem$", "a_traders/services"),
    (r"^Menu:Matchmaker Location Selection$", "e_raid/location_select"),
    (r"^(Menu:Matchmaker Points Screen|P\.sa48:Map(Entry|Extraction)Point)$", "e_raid/extraction"),
    (r"^(Menu:Match[Mm]aker|P\.sa48:MatchmakerPlayerModelViewTemplate|P\.sa44:(MatchmakerBanner|BannerPageToggleTemplate))", "e_raid/matchmaker"),
    (r"^SessionEnd:(?!InventoryOtherPlayerProfile)|^P\.sa50:", "e_raid/end_screen"),
    (r"^(Game:(?!BotDebug)|Common:(EFTBattleUIScreen Variant|SpectatorScreen|ReconnectionScreen)|P\.sa46:|"
     r"P\.sa44:(SpectatorPlayerView|ShrinkingCircleQTE|Effect Icon Template|DamageIconTemplate))", "e_raid/hud"),
    (r"^(Preloader:(DialogueLoadingScreen|PveLoadingScreen|HideoutLoadingScreen|RaidStartIntroPanel|Loader)|Menu:MatchmakerIntroVideoScreen)$", "e_raid/loading_screens"),
    (r"^(Login:|Menu:CharacterSelectionScreen|P\.sa47:|P\.sa44:FaceCardView)", "b_menu/login_character_select"),
    (r"^(Common:SettingsScreen|P\.sa44:(Settings|AnimatedToggle))", "b_menu/settings"),
    (r"^Menu:NewsHubScreen$", "b_menu/survey_news"),
    (r"^(Common:CreditsScreen|P\.sa44:Credits)", "b_menu/logo"),
    (r"^Environment:", "b_menu/backgrounds"),
    (r"^(Menu:(SeasonsHubScreen|SeasonsIntroScreen)|P\.sa48:(BattlePass\w+|ProgressRewardTemplate|FinalRewardTemplate|PageMarkTemplate)|"
     r"P\.sa44:(PersonalPerkTemplate|CommonPerkTemplate))$", "h_seasons/hub"),
    (r"^(Menu:ObtainPrestigeScreen|P\.sa44:(Prestige\w+|RewardGameModeTemplate))$", "d_player/prestige_screen"),
    (r"^(Menu:FinalStatisticsScreen|P\.sa48:(AchievementTemplate|StatItemRow))$", "d_player/final_statistics"),
    (r"^(Menu:Hideout|Common:HideoutScreenRear|P\.sa44:(HideoutCustomizationScreen|ProductionPanel|Area\w+|InteractionsPanel|"
     r"ImprovementPanel|BoostPanel|FuelSupplyPanel|\w*Requirement\w*|BonusesPanel|BonusTemplate|UnitReadyPanel|ConstructionTimePanel|"
     r"CustomPrefabPanel|DescriptionPanel)|P\.resources:(EquipmentPresetsPanel|RestSpacePanel|CircleOfCultists\w*|PlaceOfFame\w+|"
     r"WeaponStand_Stash|HideoutItemViewFactory|AreaTab))", "g_hideout/ui"),
    (r"^(Common:(Weapon Modding Screen|EditBuildScreen)|Menu:EquipmentBuildsScreen|P\.resources:(modding_\w+|Mod Slot View|"
     r"AssembleBuildItemView)|P\.sa49:MagPresetView)$", "i_modding_builds/screens"),
    (r"^Common:HandbookScreen$", "f_uikit/handbook_screen"),
    (r"^(Common:ChatScreen|P\.sa44:(MessageFork|ChatDialogue))$", "f_uikit/chat_social"),
    (r"^P\.sa44:(MainQuestTaskView|ChapterIcon|QuestNoteView|LinkedItemView|QuestDescriptionShort|RewardsList|AchievementDescription)$", "c_tasks/panels"),
    (r"^(Preloader:(WindowsPlaceholder|TooltipContainer|Context Menu Area|ItemSelectionContext|ErrorScreen|UnknownErrorScreen|Captcha|"
     r"UserInformation|ShowStorageIndicator)|P\.sa49:|P\.sa44:ItemContextSubMenu|P\.resources:(SimpleTooltip|TradingOfferTooltip))", "f_uikit/windows_popups"),
    (r"^(Common:(InventoryScreen|Scavenger Inventory Screen|Transfer Items Screen|TransferItemsInRaidScreen)|"
     r"(Menu|SessionEnd):InventoryOtherPlayerProfile|P\.sa44:(GridView|Default Grids Template|InventoryCustomizationSelectorButton))$", "f_uikit/inventory"),
    (r"^P\.resources:(\w*(layout|LayoutGroup|Component)|item_selection_view|keycard_menu_item|empty_menu_item)$", "f_uikit/cells_items"),
    (r"^(P\.resources:(Bot|Debug|Artillery|PointVisualize|Spawns)|Game:BotDebug)", "z_other/debug"),
]

# --- 5. generic kit pieces by name -------------------------------------------------------------------------
NAME_LAST = [
    (r"notification", "f_uikit/notifications"),
    (r"tooltip", "f_uikit/tooltips"),
    (r"(^|_)(scroll|scroller|slider)|Knob$", "f_uikit/scroll_sliders"),
    (r"checkbox|check(mark)?|toggle|dropdown|radio|^Cross$|opener", "f_uikit/checkbox_toggle_dropdown"),
    (r"^tab_|Tab(Idle|Selected)|_tab", "f_uikit/tabs"),
    (r"context|submenu|subbutton", "f_uikit/context_menu"),
    (r"window|popup|^info_|_infowindow|input|search", "f_uikit/windows_popups"),
    (r"button|btn", "f_uikit/buttons"),
    (r"(^|_)(cell|slot|grid|item)(_|$)|^Background weapon|unsearched|unexamined|weapon_durability", "f_uikit/cells_items"),
    (r"arrow", "f_uikit/arrows"),
    (r"border|frame|corner|line|separator|header|label|plate|panel", "f_uikit/frames_borders"),
    (r"shadow|gradient|glow|noise|dither|pattern|mask|background|^back|fill|shade|shading|vignette|spinner|light", "f_uikit/patterns_glows"),
    (r"icon", "f_uikit/icons_misc"),
]

WORLD_TEX = re.compile(r"(_(d|n|g|sg|nrm|dif|diff|gloss|glos|spec|normal|albedo|psd|gud)|_d_bloody|_g_bloody)$", re.I)
# sprite-less textures in resources.assets without a Resources/ path that are still screen art
RES_TEX_ALLOW = re.compile(r"^(mask_(anvis|binocular|gasmask|old_monocular)|VisorMask\w*|TrialExpiredTexture|line_mod|"
                           r"BasePoint|SelectedBasePoint|texture_rainbow_gradient)$")
RES_ROOT_TEX_ALLOW = re.compile(r"^(cursor_\w+|pointer|text|loot_point_icon|dissonance_logo|PainterLogo|BlackBack|"
                                r"Chernyiy-fon-10399|Doge)$")


def categorise(e: dict, screens: list[str]) -> str:
    name = e.get("name") or ""
    rd = (e.get("res_path") or "").rsplit("/", 1)[0] if "/" in (e.get("res_path") or "") else ("<root>" if e.get("res_path") else None)
    if rd == "ui/icons/trader/avatar":
        return RES_DIR[rd]
    for rx, cat in NAME_FIRST:
        if re.search(rx, name, re.I):
            return cat
    if rd in RES_DIR:
        return RES_DIR[rd]
    atlas = e.get("atlas") or e.get("atlas_page_of")
    if atlas:
        for (f, a, _n), cat in ATLAS_BY_FILE.items():
            if f == e["file"] and a == atlas and e.get("_atlas_n") == _n:
                return cat
        if atlas in ATLAS:
            return ATLAS[atlas]
    # a piece shown by many unrelated screens is a kit part: let its name decide
    generic = len(screens) >= 5
    if screens and not generic:
        for s in screens[:2]:
            for rx, cat in SCREEN_RULES:
                if re.search(rx, s):
                    return cat
    for rx, cat in NAME_LAST:
        if re.search(rx, name, re.I):
            return cat
    if screens:
        for s in screens:
            for rx, cat in SCREEN_RULES:
                if re.search(rx, s):
                    return cat
    src = {"resources.assets": "resources", "sharedassets44.assets": "common_ui", "sharedassets45.assets": "environment_ui",
           "sharedassets46.assets": "game_ui", "sharedassets47.assets": "login_ui", "sharedassets48.assets": "menu_ui",
           "sharedassets49.assets": "preloader_ui", "sharedassets50.assets": "session_end_ui"}.get(e["file"], safe_name(e["file"].split("/")[-1]))
    return f"z_other/{src}"


def tex_rgba(tex):
    """decoded Texture2D as an RGBA image, the way UGUI samples it"""
    from PIL import Image
    img = tex.image.convert("RGBA")
    if _fmt_name(tex.m_TextureFormat) == "Alpha8":
        # alpha-only texture: the UI shader adds (1,1,1,0) to the sample, i.e. it draws white shaped by alpha
        white = Image.new("L", img.size, 255)
        img = Image.merge("RGBA", (white, white, white, img.getchannel("A")))
    return img


class Assets:
    """lazy access to serialized files + decoded texture images"""

    def __init__(self, game: Path):
        import UnityPy
        self.UnityPy = UnityPy
        self.game = game
        self.envs: dict[str, object] = {}
        self.img_key = None
        self.img = None

    def file(self, name: str):
        if name not in self.envs:
            p = (self.game / SA / name) if ("/" in name or name in ("doge", "tempsplash.bundle", "dissonancesetup")) else (self.game / DATA / name)
            self.envs[name] = self.UnityPy.load(str(p))
        return self.envs[name]

    def obj(self, fname: str, pid: int):
        env = self.file(fname)
        for sf in env.files.values():
            objs = getattr(sf, "objects", None)
            if objs and pid in objs:
                return objs[pid]
            # bundles: serialized files sit one level down
            for sub in getattr(sf, "files", {}).values():
                objs = getattr(sub, "objects", None)
                if objs and pid in objs:
                    return objs[pid]
        raise KeyError((fname, pid))

    def texture(self, fname: str, pid: int):
        """RGBA PIL image of a Texture2D (the last one is kept: sprites are processed grouped by texture)"""
        key = (fname, pid)
        if self.img_key != key:
            tex = self.obj(fname, pid).read()
            self.img = tex_rgba(tex)
            self.img_key = key
        return self.img


def sprite_image(assets: Assets, e: dict):
    """the sprite's full rect as authored (no mesh mask - UGUI draws the whole quad)"""
    from PIL import Image
    tex = assets.texture(e["tex_file"], e["tex_id"])
    H = tex.height
    W, Hs = e["width"], e["height"]
    if e["settings"]["packed"]:
        x, y, w, h = e["tex_rect"]
        ox, oy = e["tex_offset"]
        x0, x1 = math.floor(x + 1e-3), math.ceil(x + w - 1e-3)
        yb, yt = math.floor(y + 1e-3), math.ceil(y + h - 1e-3)
        crop = tex.crop((x0, H - yt, x1, H - yb))
        if crop.size == (W, Hs):
            return crop
        out = Image.new("RGBA", (W, Hs), (0, 0, 0, 0))
        out.paste(crop, (math.floor(ox + 1e-3), Hs - math.floor(oy + 1e-3) - crop.height))
        return out
    x, y, w, h = e["rect"]
    x0, yb = int(round(x)), int(round(y))
    return tex.crop((x0, H - yb - Hs, x0 + W, H - yb))


def sheet(paths: list[Path], dest: Path, title: str, cell: int = 104) -> None:
    """contact sheet of a folder: every PNG as a thumbnail with its file name"""
    from PIL import Image, ImageDraw
    if not paths:
        return
    cols = 14
    label_h = 24
    pages = [paths[i:i + cols * 18] for i in range(0, len(paths), cols * 18)]
    for pi, page in enumerate(pages):
        rows = (len(page) + cols - 1) // cols
        im = Image.new("RGB", (cols * cell, rows * (cell + label_h) + 22), (62, 66, 70))
        dr = ImageDraw.Draw(im)
        dr.text((6, 5), f"{title}  ({len(paths)} files{', page %d/%d' % (pi + 1, len(pages)) if len(pages) > 1 else ''})", fill=(255, 255, 255))
        for i, p in enumerate(page):
            cx, cy = (i % cols) * cell, 22 + (i // cols) * (cell + label_h)
            # two-tone tile so both light and dark art reads
            dr.rectangle((cx + 2, cy + 2, cx + cell - 3, cy + cell - 3), fill=(112, 116, 120))
            dr.rectangle((cx + 2, cy + 2, cx + cell // 2, cy + cell - 3), fill=(40, 43, 46))
            try:
                with Image.open(p) as src:
                    src = src.convert("RGBA")
                    w, h = src.size
                    k = min((cell - 8) / w, (cell - 8) / h)
                    if k > 1:
                        k = min(k, 3.0)
                        th = src.resize((max(1, int(w * k)), max(1, int(h * k))), Image.NEAREST)
                    else:
                        th = src.resize((max(1, int(w * k)), max(1, int(h * k))), Image.LANCZOS)
                    im.paste(th, (cx + (cell - th.width) // 2, cy + (cell - th.height) // 2), th)
                    nm = p.stem
                    line1 = nm[:17]
                    line2 = (nm[17:31] + ("~" if len(nm) > 31 else "")) if len(nm) > 17 else f"{w}x{h}"
                    dr.text((cx + 3, cy + cell - 1), line1.encode("ascii", "replace").decode(), fill=(235, 235, 225))
                    dr.text((cx + 3, cy + cell + 10), line2.encode("ascii", "replace").decode(), fill=(170, 175, 170))
            except Exception:
                dr.text((cx + 6, cy + 40), "unreadable", fill=(255, 90, 90))
        out = dest if len(pages) == 1 else dest.with_name(f"{dest.stem}_{pi + 1}{dest.suffix}")
        out.parent.mkdir(parents=True, exist_ok=True)
        im.save(out)


def stitch_pocket_maps(assets: Assets, index: dict, edir: Path, max_side: int = 4200) -> list[dict]:
    """the in-raid paper maps are tile pyramids (map_tile_<x>x<y>_<scale>): stitch the largest scale that fits"""
    from PIL import Image
    plans: dict[str, dict[int, list[dict]]] = defaultdict(lambda: defaultdict(list))
    for e in index["entries"]:
        if e["type"] == "Texture2D" and e["file"].startswith("assets/content/pocketmap/"):
            m = re.match(r"map_tile_(\d+)x(\d+)_(\d+)$", e["name"] or "")
            plan = re.match(r"assets/content/pocketmap/([a-z]+plan)", e["file"])
            if m and plan:
                plans[plan.group(1)][int(m.group(3))].append({**e, "tx": int(m.group(1)), "ty": int(m.group(2))})
    made = []
    for plan, scales in sorted(plans.items()):
        best = None
        for scale in sorted(scales):  # 1 = full resolution
            tiles = scales[scale]
            colw, rowh = defaultdict(int), defaultdict(int)
            for t in tiles:
                colw[t["tx"]] = max(colw[t["tx"]], t["width"])
                rowh[t["ty"]] = max(rowh[t["ty"]], t["height"])
            W, Hh = sum(colw.values()), sum(rowh.values())
            if max(W, Hh) <= max_side:
                best = (scale, tiles, colw, rowh, W, Hh)
                break
        if best is None:
            continue
        scale, tiles, colw, rowh, W, Hh = best
        xs, x = {}, 0
        for c in sorted(colw):
            xs[c] = x
            x += colw[c]
        ys, y = {}, 0
        for r in sorted(rowh):                 # tile row 0 is the top row; the last row / column is narrower
            ys[r] = y
            y += rowh[r]
        im = Image.new("RGB", (W, Hh), (0, 0, 0))
        for t in sorted(tiles, key=lambda t: (t["file"], t["path_id"])):
            try:
                tile = assets.obj(t["file"], t["path_id"]).read().image.convert("RGB")
            except Exception:
                continue
            im.paste(tile, (xs[t["tx"]], ys[t["ty"]]))
        rel = f"e_raid/pocket_maps/{plan}_scale{scale}.png"
        (edir / rel).parent.mkdir(parents=True, exist_ok=True)
        im.save(edir / rel)
        made.append({"plan": plan, "scale": scale, "size": [W, Hh], "tiles": len(tiles), "export": rel,
                     "scales_available": sorted(scales)})
        print(f"  pocket map {plan}: scale {scale}, {len(tiles)} tiles -> {W}x{Hh}", flush=True)
    return made


def cmd_export(game: Path, sheets: bool = True) -> None:
    from PIL import Image
    t0 = time.time()
    index = load_index()
    entries = index["entries"]
    edir = OUT / "export"
    edir.mkdir(parents=True, exist_ok=True)
    usage_path = OUT / "layout" / "sprite_usage.json"
    usage = json.loads(usage_path.read_text(encoding="utf-8")) if usage_path.exists() else {}
    if not usage:
        print("  (no layout/sprite_usage.json - run 'layout' first for screen-based sorting)")
    assets = Assets(game)

    # avatar id -> trader, from the embedded test backend data when possible
    avatar_names = dict(AVATAR_NAMES)
    try:
        en = {}
        traders = None
        for o in assets.file("resources.assets").objects:
            if o.type.name == "TextAsset":
                nm = o.peek_name()
                if nm in ("TestTradersSettings", "TestBackendLocaleEn"):
                    s = o.read().m_Script
                    raw = s.encode("utf-8", "surrogateescape") if isinstance(s, str) else bytes(s)
                    js = json.loads(raw.decode("utf-8-sig"))
                    if nm == "TestTradersSettings":
                        traders = js["data"]
                    else:
                        en = js["data"]
        for t in traders or []:
            av = (t.get("avatar") or "").rsplit("/", 1)[-1].split(".")[0]
            nick = en.get(f"{t['_id']} Nickname")
            if av and nick and av not in avatar_names:
                avatar_names[av] = re.sub(r"[^a-z0-9]+", "_", nick.lower()).strip("_")
    except Exception as exc:
        print(f"  (trader table not read: {type(exc).__name__})")

    for e in entries:
        for k in ("export", "export_src", "dup_of", "same_pixels_as"):
            e.pop(k, None)
    by_key = {(e["file"], e["path_id"]): e for e in entries}
    # atlas sprite count disambiguates the two atlases called "Icons" in resources.assets
    counts_by_atlas_tex = {}
    for e in entries:
        if e["type"] == "Sprite" and e.get("atlas"):
            counts_by_atlas_tex[(e["tex_file"], e["tex_id"])] = counts_by_atlas_tex.get((e["tex_file"], e["tex_id"]), 0) + 1
    for e in entries:
        if e["type"] == "Sprite" and e.get("atlas"):
            e["_atlas_n"] = counts_by_atlas_tex.get((e["tex_file"], e["tex_id"]))

    # full-size, uncompressed source textures that ship next to their atlas copy (same Resources/ path)
    src_tex: dict[tuple[str, str], dict] = {}
    for e in entries:
        if e["type"] == "Texture2D" and e.get("res_path") and not e.get("sprites") and e["width"]:
            src_tex[(e["file"], e["res_path"])] = e

    used_names: dict[str, set] = defaultdict(set)
    by_hash: dict[str, str] = {}
    written = Counter()
    failed: list[str] = []

    def out_path(cat: str, e: dict, prefix: str = "") -> str:
        base = safe_name(prefix + (e["name"] or f"unnamed_{e['path_id']}"))
        taken = used_names[cat]
        nm = base
        if nm.lower() in taken:
            nm = f"{base}~{e['path_id']}"
        taken.add(nm.lower())
        return f"{cat}/{nm}.png"

    def save(img, rel: str, e: dict, src: str) -> None:
        p = edir / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        img.save(p)
        e["export"] = rel
        e["export_src"] = src
        h = hashlib.md5(img.tobytes()).hexdigest() + f"{img.size}"
        if h in by_hash:
            e["same_pixels_as"] = by_hash[h]
        else:
            by_hash[h] = rel
        written[rel.rsplit("/", 1)[0]] += 1

    def screens_of(e: dict) -> list[str]:
        u = usage.get(f"{e['file']}:{e['path_id']}")
        return u["screens"] if u else []

    # ---- sprites, grouped by texture so each atlas page is decoded once
    sprites = [e for e in entries if e["type"] == "Sprite" and not e.get("error") and e.get("tex_id")]
    sprites.sort(key=lambda e: (e["tex_file"], e["tex_id"], e["name"] or ""))
    consumed: set[tuple[str, int]] = set()
    for i, e in enumerate(sprites, 1):
        try:
            cat = categorise(e, screens_of(e))
            prefix = ""
            if cat == "a_traders/avatars":
                prefix = avatar_names.get(e["name"], "unidentified") + "__"
            st = src_tex.get((e["file"], e.get("res_path"))) if e.get("res_path") and e.get("atlas") else None
            if st is not None and st["name"] == e["name"] and (st["width"], st["height"]) == (e["width"], e["height"]):
                img = tex_rgba(assets.obj(st["file"], st["path_id"]).read())
                src = f"source texture ({st['format']})"
                consumed.add((st["file"], st["path_id"]))
            else:
                img = sprite_image(assets, e)
                tex = by_key.get((e["tex_file"], e["tex_id"]))
                src = f"sprite rect of {e.get('texture')} ({tex['format'] if tex else '?'})"
            rel = out_path(cat, e, prefix)
            save(img, rel, e, src)
            if st is not None and (st["file"], st["path_id"]) in consumed:
                st["dup_of"] = rel
        except Exception as exc:
            failed.append(f"Sprite {e['file']}:{e['path_id']} {e.get('name')}: {type(exc).__name__}: {exc}")
        if i % 500 == 0:
            print(f"  sprites {i}/{len(sprites)}  {time.time() - t0:5.0f}s", flush=True)

    # one sprite covering its whole texture: the texture is the same picture
    single: dict[tuple[str, int], dict] = {}
    for e in sprites:
        if e.get("export") and e.get("texture_size") == [e["width"], e["height"]]:
            single.setdefault((e["tex_file"], e["tex_id"]), e)

    # ---- textures
    textures = [e for e in entries if e["type"] == "Texture2D" and e.get("width") and e["file"] in UI_TEXTURE_FILES]
    n_tex = 0
    for e in textures:
        key = (e["file"], e["path_id"])
        if key in consumed:
            continue
        name = e["name"] or ""
        rd = (e.get("res_path") or "").rsplit("/", 1)[0] if "/" in (e.get("res_path") or "") else ("<root>" if e.get("res_path") else None)
        try:
            if e.get("sprites"):
                if key in single and e["sprites"] == 1:
                    e["dup_of"] = single[key]["export"]
                    continue
                cat = "_atlases/sprite_atlas_pages" if name.startswith("sactx-") else "_atlases/sprite_sheets"
            else:
                if rd in RES_DIR_SKIP:
                    continue
                refd = bool(screens_of(e))
                if e["file"] == "resources.assets":
                    if rd is None and not (refd or RES_TEX_ALLOW.match(name)):
                        continue
                    if rd == "<root>" and not (refd or RES_ROOT_TEX_ALLOW.match(name)):
                        continue
                    if rd not in (None, "<root>") and rd not in RES_DIR and not refd:
                        continue
                if WORLD_TEX.search(name) and not refd:
                    continue
                cat = categorise(e, screens_of(e))
                if cat.startswith("z_other/resources") and not refd:
                    cat = "z_other/resources_textures"
            img = tex_rgba(assets.obj(e["file"], e["path_id"]).read())
            prefix = (avatar_names.get(name, "unidentified") + "__") if cat == "a_traders/avatars" else ""
            save(img, out_path(cat, e, prefix), e, f"texture ({e['format']})")
            n_tex += 1
        except Exception as exc:
            failed.append(f"Texture2D {e['file']}:{e['path_id']} {name}: {type(exc).__name__}: {exc}")

    for e in entries:
        e.pop("_atlas_n", None)

    pocket = []
    try:
        pocket = stitch_pocket_maps(assets, index, edir)
        for m in pocket:
            written["e_raid/pocket_maps"] += 1
    except Exception as exc:
        failed.append(f"pocket maps: {type(exc).__name__}: {exc}")
    index["pocket_maps"] = pocket

    folders = dict(sorted(written.items()))
    index["export_folders"] = folders
    write_json(index_path(), index)
    # 9-slice sprites, borders in CSS order (top right bottom left) for border-image-slice
    nine = {}
    for e in entries:
        if e["type"] == "Sprite" and e.get("export") and any(e["border"]):
            left, bottom, right, top = e["border"]
            nine[e["export"]] = {"size": [e["width"], e["height"]], "slice_top_right_bottom_left": [rnd(top), rnd(right), rnd(bottom), rnd(left)],
                                 "ppu": e["ppu"]}
    write_json(edir / "_nine_slice.json", dict(sorted(nine.items())), pretty=True)
    write_json(edir / "_folders.json", {"generated": time.strftime("%Y-%m-%d %H:%M:%S"), "folders": folders,
                                        "failed": failed}, pretty=True)
    print(f"[export] {sum(1 for e in sprites if e.get('export'))} sprites + {n_tex} textures + {len(pocket)} stitched maps "
          f"in {len(folders)} folders -> {edir}  [{time.time() - t0:.0f}s]")
    for f in failed[:20]:
        print("  !!", f)

    if sheets:
        sdir = edir / "_sheets"
        for folder in folders:
            files = sorted((edir / folder).glob("*.png"), key=lambda p: p.name.lower())
            # only what this run produced (older runs may have left files behind)
            keep = {e["export"].rsplit("/", 1)[-1] for e in entries if e.get("export", "").rsplit("/", 1)[0] == folder}
            keep |= {Path(m["export"]).name for m in pocket if m["export"].rsplit("/", 1)[0] == folder}
            files = [p for p in files if p.name in keep]
            try:
                sheet(files, sdir / (folder.replace("/", "__") + ".png"), folder)
            except Exception as exc:
                print(f"  !! sheet {folder}: {type(exc).__name__}: {exc}")
        print(f"[export] contact sheets -> {sdir}  [{time.time() - t0:.0f}s]")


# ===========================================================================
# fonts / text assets
# ===========================================================================
def cmd_fonts(game: Path) -> None:
    import UnityPy
    fdir = OUT / "fonts"
    fdir.mkdir(parents=True, exist_ok=True)
    report = []
    env = UnityPy.load(str(game / DATA / "resources.assets"))
    for o in env.objects:
        if o.type.name != "Font":
            continue
        d = o.read()
        data = bytes(d.m_FontData) if getattr(d, "m_FontData", None) else b""
        rec = {"name": d.m_Name, "path_id": o.path_id, "bytes": len(data), "font_names": list(d.m_FontNames or [])}
        if not data:
            rec["note"] = "no embedded font data (dynamic OS font)"
            report.append(rec)
            continue
        ext = {b"OTTO": ".otf", b"ttcf": ".ttc"}.get(data[:4], ".ttf")
        out = fdir / (safe_name(d.m_Name) + ext)
        out.write_bytes(data)
        rec["file"] = out.name
        try:
            from fontTools.ttLib import TTFont
            tt = TTFont(str(out), fontNumber=0, lazy=True)
            nm = tt["name"]
            rec.update({
                "family": nm.getDebugName(1), "style": nm.getDebugName(2), "full_name": nm.getDebugName(4),
                "version": nm.getDebugName(5), "glyphs": tt["maxp"].numGlyphs, "units_per_em": tt["head"].unitsPerEm,
                "ascent": tt["hhea"].ascent, "descent": tt["hhea"].descent, "line_gap": tt["hhea"].lineGap,
                "weight_class": tt["OS/2"].usWeightClass if "OS/2" in tt else None,
            })
            cmap = tt.getBestCmap() or {}
            rec["codepoints"] = len(cmap)
            rec["covers"] = {k: all(ord(c) in cmap for c in s) for k, s in (
                ("latin", "AaZz09"), ("cyrillic", "АяЖ"), ("hangul", "한글"), ("kana", "あア"), ("cjk", "中文"), ("thai", "ไทย"))}
        except Exception as exc:
            rec["fonttools_error"] = f"{type(exc).__name__}: {exc}"
        report.append(rec)
        print(f"  {out.name:44s} {len(data) / 1024:9.1f} KiB  {rec.get('full_name', '')}")
    # TextMeshPro font assets (MonoBehaviours): name -> atlas texture
    tmp = []
    index = load_index() if index_path().exists() else {"entries": []}
    for e in index["entries"]:
        if e["type"] == "Texture2D" and (e.get("res_path") or "").startswith("ui/fonts") and e["name"].endswith("Atlas"):
            tmp.append({"atlas": e["name"], "size": [e["width"], e["height"]], "format": e["format"],
                        "res_path": e["res_path"], "export": e.get("export")})
    write_json(fdir / "fonts.json", {"fonts": report, "tmp_font_atlases": tmp}, pretty=True)
    print(f"[fonts] {sum(1 for r in report if r.get('file'))} font files -> {fdir}")


TEXT_KEEP = re.compile(r"^(TestBackendLocale\w+|locale\w+_legacy|TestTraders(Settings|List)|TestTrader|TestDailyQuests|Quests|"
                       r"TestCategories|TestCurrencies|TestHealth(Parameters|Effects)|TestServerLocations|TestClientSettings|"
                       r"TestGlobals|hideout\d|DefaultSharedSettings|TestRegisterMatchData|TestCustomizationTemplates|"
                       r"TestAllTradingItems|TestTradingItem|TestBlackMarketItems|TestProfile|TestAccountProfiles|config)$")


def cmd_text(game: Path) -> None:
    import UnityPy
    tdir = OUT / "textassets"
    tdir.mkdir(parents=True, exist_ok=True)
    res = resource_paths(game)
    env = UnityPy.load(str(game / DATA / "resources.assets"))
    listing = []
    for o in env.objects:
        if o.type.name != "TextAsset":
            continue
        name = o.peek_name()
        rp = res.get(("resources.assets", o.path_id), "")
        rec = {"name": name, "res_path": rp, "bytes": o.byte_size}
        if TEXT_KEEP.match(name) and ("/" not in rp or rp.startswith("ui/")):
            s = o.read().m_Script
            raw = s.encode("utf-8", "surrogateescape") if isinstance(s, str) else bytes(s)
            head = raw.lstrip(b"\xef\xbb\xbf \r\n\t")[:1]
            ext = ".json" if head in (b"{", b"[") else ".txt"
            fn = safe_name(rp.replace("/", "__") if rp.startswith("ui/") else name) + ext
            (tdir / fn).write_bytes(raw)
            rec["file"] = fn
        listing.append(rec)
    listing.sort(key=lambda r: (r.get("file") is None, r["res_path"], r["name"]))
    write_json(tdir / "_textassets.json", listing, pretty=True)
    print(f"[text] {sum(1 for r in listing if r.get('file'))} of {len(listing)} TextAssets written -> {tdir}")


# ===========================================================================
# icon tables: ScriptableObjects that map enum names to sprites
# ===========================================================================
# EFT.UI.StaticIcons ("Static Icons") is a row of serialized dictionaries, each stored as
# [n][n key strings][n][n sprite pointers]. The field names are not in the build; the tables are told apart
# by their first key.
TABLE_HINTS = {
    "Ammo": "item_type", "PickUp": "quest_type", "EnduranceBuffEnduranceInc": "skill_buff", "Endurance": "skill",
    "CommonStats": "stats_category", "Regular": "damage_type", "Default": "notification_type",
    "ThereGesture": "gesture", "QuestionMark": "dialog_option_icon", "Quests": "wishlist_group",
    "YouDidntEscapeFromYourself": "ending", "Undefined": "item_attribute", "None": "health_factor",
    "HeavyBleeding": "removes_effect", "HealthRate": "stimulator_buff", "RUB": "currency",
}
_ASCII = re.compile(r"^[\x20-\x7e]+$")


def tokenise(raw: bytes, start: int, resolve_sprite) -> list:
    """body of a MonoBehaviour as a list of ('S', sprite name) / ('T', string) / ('I', int32) tokens"""
    toks = []
    p, n = start, len(raw)
    while p + 4 <= n:
        if p + 12 <= n:
            fid, pid = struct.unpack_from("<iq", raw, p)
            e = resolve_sprite(fid, pid) if pid else None
            if e is not None:
                toks.append(("S", e["name"], (e["file"], e["path_id"])))
                p += 12
                continue
        ln = struct.unpack_from("<i", raw, p)[0]
        if 1 <= ln <= 96 and p + 4 + ln <= n:
            pad = (-ln) % 4
            try:
                st = raw[p + 4:p + 4 + ln].decode("utf-8")
            except UnicodeDecodeError:
                st = None
            if st and _ASCII.match(st) and not any(raw[p + 4 + ln:p + 4 + ln + pad]) and (ln >= 3 or st.isalpha()):
                toks.append(("T", st))
                p += 4 + ln + pad
                continue
        toks.append(("I", ln))
        p += 4
    return toks


def decode_tables(toks: list) -> tuple[list, list]:
    """-> (tables, leftover tokens). A table is [n][n strings][n][n sprites or null pointers]."""
    tables, rest = [], []
    i = 0
    null3 = [("I", 0)] * 3
    while i < len(toks):
        k, v = toks[i][0], toks[i][1]
        if k == "I" and 0 < v <= 512 and i + v < len(toks) and all(t[0] == "T" for t in toks[i + 1:i + 1 + v]):
            keys = [t[1] for t in toks[i + 1:i + 1 + v]]
            j = i + 1 + v
            if j < len(toks) and toks[j] == ("I", v):
                j += 1
                vals = []
                for _ in range(v):
                    if j < len(toks) and toks[j][0] == "S":
                        vals.append(toks[j])
                        j += 1
                    elif toks[j:j + 3] == null3:
                        vals.append(None)
                        j += 3
                    else:
                        vals = None
                        break
                if vals is not None:
                    tables.append(list(zip(keys, vals)))
                    i = j
                    continue
        rest.append(toks[i])
        i += 1
    return tables, rest


def cmd_icons(game: Path) -> None:
    import UnityPy
    index = load_index()
    names = {(e["file"], e["path_id"]): e for e in index["entries"] if e.get("name") and e["type"] == "Sprite"}
    scripts = {}
    env = UnityPy.load(str(game / DATA / "globalgamemanagers.assets"))
    for o in env.objects:
        if o.type.name == "MonoScript":
            d = o.read()
            scripts[o.path_id] = ".".join(x for x in (d.m_Namespace, d.m_ClassName) if x)
    out = {}
    singles = {}
    notes: dict[tuple[str, int], list] = defaultdict(list)
    for fname in ("resources.assets", "sharedassets44.assets", "sharedassets46.assets", "sharedassets47.assets",
                  "sharedassets48.assets", "sharedassets49.assets", "sharedassets50.assets"):
        p = game / DATA / fname
        if not p.exists():
            continue
        sf = list(UnityPy.load(str(p)).files.values())[0]
        ext = [e.path.rsplit("/", 1)[-1] for e in sf.externals]

        def resolve_sprite(fid, pid, _f=fname, _ext=ext):
            if not 0 <= fid <= len(_ext):
                return None
            return names.get((_f if fid == 0 else _ext[fid - 1], pid))

        for o in sf.objects.values():
            if o.type.name != "MonoBehaviour":
                continue
            raw = o.get_raw_data()
            r = R(raw)
            try:
                go, _, sc, name = mb_header(r)
            except Exception:
                continue
            if go[1] != 0:
                continue   # a component: the layout pass covers those
            cls = scripts.get(sc[1], "?") if 0 < sc[0] <= len(ext) and ext[sc[0] - 1] == "globalgamemanagers.assets" else "?"
            toks = tokenise(raw, r.p, resolve_sprite)
            n_s = sum(1 for t in toks if t[0] == "S")
            if n_s == 0:
                continue
            label = f"{cls} '{name}' ({fname}:{o.path_id})"
            if n_s == 1:
                singles[label] = next(t[1] for t in toks if t[0] == "S")
                continue
            tables, rest = decode_tables(toks)
            rec = {"class": cls, "name": name, "file": fname, "path_id": o.path_id, "sprite_refs": n_s}
            if tables:
                seen = Counter()
                rec["tables"] = {}
                for t in tables:
                    hint = TABLE_HINTS.get(t[0][0], "table") if cls == "EFT.UI.StaticIcons" else "table"
                    seen[hint] += 1
                    tname = hint if seen[hint] == 1 else f"{hint}_{seen[hint]}"
                    rows = [(k, v[1] if v else None) for k, v in t]
                    rec["tables"][tname] = dict(rows) if len({k for k, _ in rows}) == len(rows) else rows
                    for k, v in t:
                        if v:   # remember which table rows point at each sprite
                            notes[v[2]].append(f"{name}.{tname}[{k}]")
            # what is left, in field order: sprites and strings verbatim, runs of numbers collapsed
            flat, run = [], 0
            for tok in rest:
                k, v = tok[0], tok[1]
                if k == "I":
                    run += 1
                    continue
                if run:
                    flat.append(f"<{run} int>")
                    run = 0
                flat.append(v if k == "S" else f'"{v}"')
            if run:
                flat.append(f"<{run} int>")
            if any(not x.startswith("<") for x in flat):
                rec["other_fields"] = flat
            out[label] = rec
    for e in index["entries"]:
        e.pop("icon_of", None)
        v = notes.get((e["file"], e["path_id"]))
        if v:
            e["icon_of"] = sorted(set(v))[:12]
    write_json(index_path(), index)
    write_json(OUT / "icon_tables.json", {
        "note": "ScriptableObjects that bind names to sprites. 'tables' are decoded dictionaries (key -> sprite "
                "name; table names are guesses from the first key, the real field names are not in the build). "
                "'other_fields' lists the remaining sprite / string fields in serialized order.",
        "objects": out, "single_sprite_objects": singles}, pretty=True)
    print(f"[icons] {len(out)} icon tables (+{len(singles)} single-sprite objects) -> {OUT / 'icon_tables.json'}")


def cmd_video(game: Path) -> None:
    """StreamingAssets/Video holds the animated menu backgrounds (the default main menu background is a 3D
    scene, level45): list the clips and save one poster frame of each"""
    from PIL import Image
    root = game / DATA / "StreamingAssets"
    out = OUT / "export" / "b_menu" / "backgrounds_video_frames"
    out.mkdir(parents=True, exist_ok=True)
    try:
        import cv2
    except Exception:
        cv2 = None
    listing = []
    files = [p for sub in ("Video", "Intro") for p in sorted((root / sub).rglob("*")) if p.is_file()]
    for p in files:
        rel = p.relative_to(root).as_posix()
        rec = {"file": "StreamingAssets/" + rel, "bytes": p.stat().st_size}
        if cv2 is not None and p.suffix.lower() in (".mp4", ".webm") and p.stat().st_size < 200 * 1048576:
            try:
                cap = cv2.VideoCapture(str(p))
                if cap.isOpened():
                    n = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
                    fps = float(cap.get(cv2.CAP_PROP_FPS) or 0)
                    rec.update({"width": int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)), "height": int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)),
                                "fps": round(fps, 2), "frames": n, "seconds": round(n / fps, 2) if fps and n > 0 else None})
                    frame = None
                    for _ in range(max(1, min(90, int(n * 0.4) if n > 0 else 45))):   # a frame a little way in
                        ok, f = cap.read()
                        if not ok:
                            break
                        frame = f
                    if frame is not None:
                        name = safe_name(rel.replace("/", "__")) + ".png"
                        Image.fromarray(frame[:, :, ::-1].copy()).save(out / name)
                        rec["frame"] = f"b_menu/backgrounds_video_frames/{name}"
                cap.release()
            except Exception as exc:
                rec["error"] = f"{type(exc).__name__}: {exc}"
        listing.append(rec)
    write_json(OUT / "export" / "_videos.json", listing, pretty=True)
    print(f"[video] {len(listing)} clips listed, {sum(1 for r in listing if r.get('frame'))} poster frames -> {out}")


def cmd_scene(game: Path) -> None:
    """The main menu's backdrop is not UI: it is a scene - a looping clip of a place, with the game's logo
    hung in it as a textured plane. Save what a still of it is made of: the logo textures (eft_logo*, one a
    scene) and, for every background clip, a frame from a third of the way in, into export/b_menu/scene/."""
    import UnityPy
    from PIL import Image
    out = OUT / "export" / "b_menu" / "scene"
    out.mkdir(parents=True, exist_ok=True)
    index = json.loads((OUT / "index.json").read_text(encoding="utf-8"))
    wanted = [e for e in index["entries"] if e.get("type") == "Texture2D" and re.match(r"^eft_logo", e["name"], re.I)]
    by_file = defaultdict(list)
    for e in wanted:
        by_file[e["file"]].append(e)
    n = 0
    for fname, rows in by_file.items():
        path = game / DATA / fname
        if not path.exists():
            continue
        ids = {r["path_id"]: r["name"] for r in rows}
        env = UnityPy.load(str(path))
        for obj in env.objects:
            if obj.type.name == "Texture2D" and obj.path_id in ids:
                try:
                    obj.read().image.save(out / (safe_name(ids[obj.path_id]) + ".png"))
                    n += 1
                except Exception as exc:
                    print(f"[scene] {ids[obj.path_id]}: {type(exc).__name__}: {exc}")
    stills = 0
    try:
        import cv2
    except Exception:
        cv2 = None
    root = game / DATA / "StreamingAssets" / "Video" / "EnvironmentUIBg"
    if cv2 is not None and root.exists():
        for p in sorted(q for q in root.rglob("*") if q.suffix.lower() in (".mp4", ".webm")):
            cap = cv2.VideoCapture(str(p))
            if not cap.isOpened():
                continue
            total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
            if total > 3:
                cap.set(cv2.CAP_PROP_POS_FRAMES, total // 3)
            ok, frame = cap.read()
            cap.release()
            if ok:
                name = safe_name("still__" + p.relative_to(root).as_posix().replace("/", "__")) + ".png"
                Image.fromarray(frame[:, :, ::-1].copy()).save(out / name)
                stills += 1
    print(f"[scene] {n} logo textures, {stills} clip stills -> {out}")


# ===========================================================================
def main() -> None:
    global OUT
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("command", choices=["index", "layout", "icons", "export", "fonts", "text", "video", "scene", "all"])
    ap.add_argument("--game", default=str(DEFAULT_GAME), help="EFT install folder (the one holding EscapeFromTarkov.exe)")
    ap.add_argument("--out", default=None, help="output root (default: tools/cache/client)")
    ap.add_argument("--jobs", type=int, default=max(1, min(8, (os.cpu_count() or 2) - 2)))
    ap.add_argument("--no-levels", action="store_true", help="index: skip the level* scene files")
    ap.add_argument("--no-sheets", action="store_true", help="export: skip the contact sheets")
    args = ap.parse_args()

    game = Path(args.game)
    if not (game / DATA).exists():
        raise SystemExit(f"game not found: {game}")
    if args.out:
        OUT = Path(args.out).resolve()
        OUT.mkdir(parents=True, exist_ok=True)

    todo = ["index", "layout", "icons", "export", "video", "scene", "fonts", "text"] if args.command == "all" else [args.command]
    for cmd in todo:
        if cmd == "index":
            cmd_index(game, args.jobs, not args.no_levels)
        elif cmd == "layout":
            cmd_layout(game)
        elif cmd == "icons":
            cmd_icons(game)
        elif cmd == "export":
            cmd_export(game, not args.no_sheets)
        elif cmd == "video":
            cmd_video(game)
        elif cmd == "scene":
            cmd_scene(game)
        elif cmd == "fonts":
            cmd_fonts(game)
        elif cmd == "text":
            cmd_text(game)


if __name__ == "__main__":
    main()
