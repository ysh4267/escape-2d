#!/usr/bin/env python3
"""
Collect the interface art the page uses and seal it into packs.

    python build_ui.py              # scan the page, pick the art, write the packs
    python build_ui.py --list       # what would go in, what was asked for and not found
    python build_ui.py --key "..."  # passphrase (default: SEALED_KEY in src/core/audio.js)

The art comes from a local extraction of the game client
(tools/extract_tarkov_ui.py -> tools/cache/client/, git-ignored): sprites cut
out of the client's own atlases, its fonts, and an index that knows every
sprite's size and nine-slice border. Nothing of that is tracked. What the page
needs is copied out of it and shipped the way the sounds and the models are:
deflated and AES-GCM sealed (see tools/pack_sfx.py for the reasoning, which is
the same here), under assets/ui-eft/.

Which art goes in is decided by the page itself:

  * every `--ui-<name>` custom property a stylesheet reads,
  * every quoted name in src/ that is a sprite's name (and has an underscore
    in it, so that 'check' or 'button' do not drag sprites in by accident),
  * the names in ALWAYS below, for the ones the page builds at run time,

where <name> is the sprite's name lower-cased with every run of other
characters turned into one underscore (`Trade_Buy_Icon_Idle` ->
trade_buy_icon_idle, `AllScreens_Squad_Player_Background 1_5` ->
allscreens_squad_player_background_1_5).

That is the core pack, pack.bin, opened once at boot. Art that only one screen
shows - skill pictures, level badges, location banners, loading splashes -
goes into packs of its own (GROUPS) that are fetched when that screen first
opens.

Container, before compression (same as the sound pack):

    [4 bytes LE header length][header JSON][blob][blob]...

    header = { "v": 1,
               "files": { name: [offset, length, mime, width, height, [t, r, b, l]?] },
               "fonts": [ { "family", "weight", "style", "at": [offset, length] } ] }

sealed as  magic "E2UI01" | salt (16) | iv (12) | ciphertext || tag (16).

The salt and the iv are cut from a hash of what is being sealed, so a pack
whose contents did not change comes out byte for byte the same and is not a
change to commit; two different packs still never share an iv.

    python -m pip install cryptography pillow
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
import re
import struct
import sys
import zlib
from pathlib import Path

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from PIL import Image

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
SOURCE = HERE / "cache" / "client"
EXPORT = SOURCE / "export"
ENCODED = HERE / "cache" / "ui-encoded"
OUT = ROOT / "assets" / "ui-eft"

MAGIC = b"E2UI01"
ROUNDS = 200_000

# ---------------------------------------------------------------------------
# what the page asks for by a name it builds at run time
# ---------------------------------------------------------------------------
ALWAYS = """
lvl ll check checkbox checkmark condition exp levelling shade button background
keys camera setlock mass cross chtoto
""".split()

# sprites that share a name with another one: say which export is meant
PREFER = {
    "icon_presets_big": "b_menu/nav_taskbar/icon_presets_big.png",
    # the career's headings draw these at 30 px; the smaller cut is the raid report's
    "icon_statscategory_overall": "d_player/stats_icons/icon_statscategory_overall~5935.png",
    "icon_statscategory_looting": "d_player/stats_icons/icon_statscategory_looting~5332.png",
    "icon_statscategory_combat": "d_player/stats_icons/icon_statscategory_combat~6058.png",
}

# whole folders of the extraction that go into the core pack as they are
CORE_FOLDERS = [
    ("a_traders/avatars", "avatar"),            # avatar_<trader id>
    ("d_player/currency", None),
    ("d_player/item_markers", None),
    ("e_raid/status_effects", None),
    ("f_uikit/icons_item_types", None),
    # the glyph of every action in an item's menu, and of every row of its details
    ("f_uikit/icons_characteristics", None),
    ("f_uikit/icons_handbook", None),
    ("f_uikit/scroll_sliders", None),
    ("d_player/stats_icons", None),
    ("e_raid/end_screen", None),
]

# packs of their own: (pack name, folder, how to name, longest side, lossy quality)
GROUPS = [
    ("skills", "d_player/skills", None, 128, 90),
    ("ranks", "d_player/level_badges", None, 200, 92),
    ("factions", "d_player/factions", None, 256, 92),
    ("locations", "e_raid/location_banners", None, 764, 84),
    ("locselect", "e_raid/location_select", None, 1024, 86),
    ("splash", "e_raid/loading_splash", None, 1920, 80),
    ("hideout", "g_hideout/area_icons", None, 128, 92),
    ("slots", "f_uikit/slot_ghosts_equipment", None, 128, 92),
    ("achievements", "d_player/achievements", None, 128, 90),
    ("weather", "e_raid/weather_time", None, 128, 92),
    ("extraction", "e_raid/extraction", None, 256, 92),
    ("hud", "e_raid/hud", None, 256, 92),
    ("matchmaker", "e_raid/matchmaker", None, 512, 90),
    ("logo", "b_menu/logo", None, 712, 92),
]

# of the splashes only these go in: one is shown per raid, a handful is plenty
SPLASH_KEEP = {"splash_1", "splash_3", "splash_5", "splash_8", "splash_11", "splash_14"}
LOGO_KEEP = {"escape_from_tarkov_logo", "battlestate_splash_logo"}
# The scenes the client can play behind its menus (Settings > GAME > Main menu
# background). Each is a pack of its own - scene_<id>.bin, holding the still
# of its looping clip as backdrop_<id> and the logo that hangs in it as
# scene_logo_<id> - so the page fetches only the one that is showing.
# A file is matched on the start of its name. A clip can be wider than the
# screen (21:9) or square, and the client frames its middle; `crop` is that
# framing as (zoom, x centre, y centre) and also brings every still to 16:9.
SCENES = {
    # the room has two clips; the .webm is the lit one the menu shows (monitors on, the lamp over the floor)
    "serverroom": ("still_season_bd_main_menu_server_s_room_animate_exp_webm", "eft_logo_season", (1.14, 0.5, 0.5)),
    "unheard": ("still_tue_tue_bg_2", "eft_logo_ulti_edition", (1.0, 0.5, 0.5)),
    "cybertark": ("still_cyberpunk_cyberpunk_bg_1", "eft_logo_cyberpunk_pve", (1.0, 0.5, 0.5)),
    # the four endings are square clips of a skyline; the menu shows the band around the horizon
    "bleakhorizon": ("still_endings_andsurvived", "eft_logo_01_and_survived", (1.0, 0.5, 0.46)),
    "stormfront": ("still_endings_didntescape", "eft_logo_03_didnt_escape_from_yourself", (1.0, 0.5, 0.46)),
    "dusk": ("still_endings_fallinthedarkness", "eft_logo_02_in_the_darkness", (1.0, 0.5, 0.46)),
    "peacefulsky": ("still_endings_forhumanity", "eft_logo_04_for_humanity", (1.0, 0.5, 0.46)),
}

FONTS = [
    ("Bender", 400, "normal", "Jovanny Lemonad - Bender.otf"),
    ("Bender", 700, "normal", "Jovanny Lemonad - Bender Bold.otf"),
    ("Bender", 400, "italic", "Jovanny Lemonad - Bender Italic.otf"),
    ("Bender", 700, "italic", "Jovanny Lemonad - Bender BoldItalic.otf"),
]


def norm(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")


# ---------------------------------------------------------------------------
# the extraction's index
# ---------------------------------------------------------------------------
def load_index() -> dict[str, dict]:
    """normalised sprite name -> {path, w, h, border}"""
    raw = json.loads((SOURCE / "index.json").read_text(encoding="utf-8"))
    by_name: dict[str, dict] = {}
    for e in raw["entries"]:
        exp = e.get("export")
        if not exp:
            continue
        key = norm(e["name"])
        stem = Path(exp).stem
        prefer = PREFER.get(key)
        rec = {
            "path": exp,
            "w": int(round(e.get("width") or 0)),
            "h": int(round(e.get("height") or 0)),
            # the index keeps Unity's order (left, bottom, right, top); css wants top, right, bottom, left
            "border": None,
        }
        b = e.get("border")
        if b and any(v > 0 for v in b):
            left, bottom, right, top = b
            rec["border"] = [round(top), round(right), round(bottom), round(left)]
        have = by_name.get(key)
        if have is None:
            by_name[key] = rec
        elif prefer:
            if exp == prefer:
                by_name[key] = rec
        elif "~" in Path(have["path"]).stem and "~" not in stem:
            by_name[key] = rec          # the plain name over the `~path id` duplicate
    return by_name


# ---------------------------------------------------------------------------
# what the page names
# ---------------------------------------------------------------------------
def scan(index: dict[str, dict]) -> tuple[set[str], set[str]]:
    wanted: set[str] = set()
    missing: set[str] = set()
    css_var = re.compile(r"--ui-([a-z0-9_]+)")
    quoted = re.compile(r"""['"`]([a-z0-9_]+)['"`]""")
    files = list((ROOT / "styles").glob("*.css")) + [ROOT / "index.html"]
    for f in files:
        for name in css_var.findall(f.read_text(encoding="utf-8")):
            (wanted if name in index else missing).add(name)
    for f in (ROOT / "src").rglob("*.js"):
        text = f.read_text(encoding="utf-8")
        for name in css_var.findall(text):
            (wanted if name in index else missing).add(name)
        for name in quoted.findall(text):
            if "_" in name and name in index:
                wanted.add(name)
    for name in ALWAYS:
        (wanted if name in index else missing).add(name)
    # a tab's glyph has a lit twin the page asks for by adding to the name
    for name in list(wanted):
        if name + "_selected" in index:
            wanted.add(name + "_selected")
    return wanted, missing


# ---------------------------------------------------------------------------
# images
# ---------------------------------------------------------------------------
def encode(path: Path, longest: int | None, quality: int | None, crop=None) -> tuple[bytes, str, int, int]:
    """
    The file as the pack carries it. Small sprites stay PNG, byte for byte what
    the client draws. Pictures (a longest side and a quality given) become
    WebP, scaled down if they are larger than they are ever shown. `crop`
    first cuts a 16:9 window out of the picture: (zoom, x centre, y centre).
    """
    # Encoding is nearly all of a build's time, so what a file came out as is
    # kept beside the extraction and used again for as long as the file and
    # what is asked of it stay the same.
    st = path.stat()
    key = hashlib.sha1(f"{path}|{st.st_size}|{st.st_mtime_ns}|{longest}|{quality}|{crop}".encode("utf-8")).hexdigest()
    kept = ENCODED / key
    if kept.exists():
        raw = kept.read_bytes()
        cut = raw.index(b"\n")
        mime, w, h = raw[:cut].decode("ascii").split(" ")
        return raw[cut + 1:], mime, int(w), int(h)
    data, mime, w, h = encode_fresh(path, longest, quality, crop)
    ENCODED.mkdir(parents=True, exist_ok=True)
    kept.write_bytes(f"{mime} {w} {h}\n".encode("ascii") + data)
    return data, mime, w, h


def encode_fresh(path: Path, longest: int | None, quality: int | None, crop=None) -> tuple[bytes, str, int, int]:
    im = Image.open(path)
    im.load()
    w, h = im.size
    if crop:
        zoom, cx, cy = crop
        ch = h / zoom
        cw = ch * 16 / 9
        if cw > w:                      # a picture squarer than the screen: its width is what bounds the window
            cw = w / zoom
            ch = cw * 9 / 16
        left = min(max(0, w * cx - cw / 2), w - cw)
        top = min(max(0, h * cy - ch / 2), h - ch)
        im = im.crop((round(left), round(top), round(left + cw), round(top + ch)))
        w, h = im.size
    if longest is None or quality is None:
        buf = io.BytesIO()
        im.save(buf, "PNG", optimize=True)
        return buf.getvalue(), "image/png", w, h
    if max(w, h) > longest:
        k = longest / max(w, h)
        im = im.resize((max(1, round(w * k)), max(1, round(h * k))), Image.LANCZOS)
    if im.mode not in ("RGB", "RGBA"):
        im = im.convert("RGBA")
    buf = io.BytesIO()
    im.save(buf, "WEBP", quality=quality, method=6)
    return buf.getvalue(), "image/webp", im.size[0], im.size[1]


class Pack:
    def __init__(self) -> None:
        self.files: dict[str, list] = {}
        self.fonts: list[dict] = []
        self.blobs: list[bytes] = []
        self.at = 0

    def _put(self, data: bytes) -> list[int]:
        span = [self.at, len(data)]
        self.blobs.append(data)
        self.at += len(data)
        return span

    def add_image(self, name: str, path: Path, border=None, longest=None, quality=None, crop=None) -> None:
        if name in self.files:
            return
        data, mime, w, h = encode(path, longest, quality, crop)
        off, ln = self._put(data)
        row = [off, ln, mime, w, h]
        if border:
            row.append(border)
        self.files[name] = row

    def add_font(self, family: str, weight: int, style: str, path: Path) -> None:
        self.fonts.append({"family": family, "weight": weight, "style": style, "at": self._put(path.read_bytes())})

    def seal(self, passphrase: str) -> bytes:
        header = json.dumps({"v": 1, "files": self.files, "fonts": self.fonts}, separators=(",", ":")).encode("utf-8")
        payload = struct.pack("<I", len(header)) + header + b"".join(self.blobs)
        comp = zlib.compressobj(9, zlib.DEFLATED, -15)
        squeezed = comp.compress(payload) + comp.flush()
        digest = hashlib.sha256(passphrase.encode("utf-8") + b"\0" + squeezed).digest()
        salt, iv = digest[:16], digest[16:28]
        key = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=ROUNDS).derive(passphrase.encode("utf-8"))
        return MAGIC + salt + iv + AESGCM(key).encrypt(iv, squeezed, None)


def page_key() -> str:
    text = (ROOT / "src" / "core" / "audio.js").read_text(encoding="utf-8")
    m = re.search(r"SEALED_KEY\s*=\s*'([^']+)'", text)
    if not m:
        raise SystemExit("SEALED_KEY not found in src/core/audio.js; pass --key")
    return m.group(1)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--list", action="store_true", help="report only, write nothing")
    ap.add_argument("--key", default=os.environ.get("UI_PACK_KEY"))
    args = ap.parse_args()

    if not (SOURCE / "index.json").exists():
        raise SystemExit(f"no extraction at {SOURCE}; run tools/extract_tarkov_ui.py first")
    index = load_index()
    wanted, missing = scan(index)

    core = Pack()
    for name in sorted(wanted):
        rec = index[name]
        core.add_image(name, EXPORT / rec["path"], rec["border"])
    for folder, prefix in CORE_FOLDERS:
        for f in sorted((EXPORT / folder).glob("*.png")):
            if "~" in f.stem:
                continue
            if prefix == "avatar":
                # prapor__59b91ca086f77469a81232e4.png -> avatar_prapor, btr_driver__... -> avatar_btrdriver:
                # the page knows a trader by the short key its data files use
                name = "avatar_" + f.stem.split("__", 1)[0].replace("_", "")
                core.add_image(name, f)
            else:
                name = norm(f.stem)
                core.add_image(name, f, (index.get(name) or {}).get("border"))
    for family, weight, style, file in FONTS:
        core.add_font(family, weight, style, SOURCE / "fonts" / file)

    groups: list[tuple[str, Pack]] = []
    for gname, folder, _naming, longest, quality in GROUPS:
        p = Pack()
        for f in sorted((EXPORT / folder).glob("*.png")):
            if "~" in f.stem:
                continue
            name = norm(f.stem)
            if gname == "splash" and name not in SPLASH_KEEP:
                continue
            if gname == "logo" and name not in LOGO_KEEP:
                continue
            small = max(Image.open(f).size) <= 96
            p.add_image(name, f, None, None if small else longest, None if small else quality)
        groups.append((gname, p))

    scene_files = {norm(f.stem): f for f in sorted((EXPORT / "b_menu" / "scene").glob("*.png"))}

    def scene_file(piece: str) -> Path:
        hit = next((f for n, f in scene_files.items() if n == piece or n.startswith(piece + "_")), None)
        if hit is None:
            raise SystemExit(f"no scene file starting with {piece}; run tools/extract_tarkov_ui.py scene")
        return hit

    for scene, (still, logo, crop) in SCENES.items():
        p = Pack()
        p.add_image(f"backdrop_{scene}", scene_file(still), None, 1920, 80, crop)
        p.add_image(f"scene_logo_{scene}", scene_file(logo), None, 1024, 90)
        groups.append((f"scene_{scene}", p))

    def size_of(p: Pack) -> int:
        return sum(len(b) for b in p.blobs)

    print(f"core: {len(core.files)} images, {len(core.fonts)} fonts, {size_of(core) / 1024:.0f} KiB before sealing")
    for gname, p in groups:
        print(f"  {gname}: {len(p.files)} images, {size_of(p) / 1024:.0f} KiB")
    # a name the page reads that sits in a side pack is not missing, just elsewhere
    missing -= {name for _g, p in groups for name in p.files}
    if missing:
        print(f"asked for and not in the extraction ({len(missing)}): {' '.join(sorted(missing))}")
    if args.list:
        print("names:", " ".join(sorted(core.files)))
        return

    key = args.key or page_key()
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "pack.bin").write_bytes(core.seal(key))
    total = (OUT / "pack.bin").stat().st_size
    for gname, p in groups:
        path = OUT / f"{gname}.bin"
        path.write_bytes(p.seal(key))
        total += path.stat().st_size
    print(f"sealed into {OUT.relative_to(ROOT)} ({total / 1024 / 1024:.1f} MiB in {1 + len(groups)} packs)")
    if missing:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
