#!/usr/bin/env python3
"""
Pull the game's own sound effects out of a local Escape From Tarkov install
and transcode them into the small ogg set this project plays.

    python extract_tarkov_sfx.py --index          # catalogue every AudioClip
    python extract_tarkov_sfx.py --search foot    # find clips by name
    python extract_tarkov_sfx.py --extract        # write assets/sfx-eft/*.ogg

The audio in an EFT install is Battlestate Games' copyrighted material. It is
fine to use it locally from a copy you own; it is NOT ours to redistribute, so
everything this script writes lands in a gitignored directory. Only the sealed
container tools/pack_sfx.py builds from it is tracked.

Bundles are plain UnityFS (Unity 2022.3), so UnityPy reads them directly:
    python -m pip install UnityPy
ffmpeg does the transcode; point --ffmpeg at it if it is not on PATH.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
CACHE = HERE / "cache"
INDEX_PATH = CACHE / "tarkov_sfx_index.json"
OUT_DIR = ROOT / "assets" / "sfx-eft"

DEFAULT_GAME = Path(r"E:\Program Files\EFT")

# Subtrees worth walking. The whole install is ~33 GB; the audio lives here.
AUDIO_SUBTREES = [
    r"EscapeFromTarkov_Data\StreamingAssets\Windows\assets\content\audio",
    r"EscapeFromTarkov_Data\StreamingAssets\Windows\assets\commonassets\audio",
]
# The interface sounds are compiled into the base build rather than a bundle.
BASE_FILES = ["globalgamemanagers.assets", "resources.assets"]
BASE_GLOBS = ["level*", "sharedassets*.assets"]


def find_ffmpeg(explicit: str | None) -> str:
    for cand in [explicit, shutil.which("ffmpeg"), r"E:\ffmpeg\bin\ffmpeg.exe"]:
        if cand and Path(cand).exists():
            return str(cand)
        if cand and shutil.which(cand):
            return cand
    raise SystemExit("ffmpeg not found; pass --ffmpeg <path>")


# ---------------------------------------------------------------------------
# indexing
# ---------------------------------------------------------------------------
def iter_asset_files(game: Path):
    for sub in AUDIO_SUBTREES:
        base = game / sub
        if not base.exists():
            continue
        for p in sorted(base.rglob("*.bundle")):
            yield p
    data = game / "EscapeFromTarkov_Data"
    for name in BASE_FILES:
        if (data / name).exists():
            yield data / name
    for pattern in BASE_GLOBS:
        for p in sorted(data.glob(pattern)):
            # level0.resS and friends are payload, not containers
            if p.suffix in (".resS", ".resource", ".json"):
                continue
            yield p


def build_index(game: Path, limit: int | None = None) -> dict:
    import UnityPy

    CACHE.mkdir(parents=True, exist_ok=True)
    index: dict[str, dict] = {}
    files = list(iter_asset_files(game))
    if limit:
        files = files[:limit]
    total = len(files)
    for i, path in enumerate(files, 1):
        rel = str(path.relative_to(game))
        try:
            env = UnityPy.load(str(path))
            found = 0
            for obj in env.objects:
                if obj.type.name != "AudioClip":
                    continue
                try:
                    d = obj.read()
                except Exception:
                    continue
                name = getattr(d, "m_Name", "") or ""
                if not name:
                    continue
                found += 1
                # first bundle wins; duplicates across bundles are common
                index.setdefault(name, {
                    "file": rel,
                    "freq": int(getattr(d, "m_Frequency", 0) or 0),
                    "ch": int(getattr(d, "m_Channels", 0) or 0),
                    "len": round(float(getattr(d, "m_Length", 0.0) or 0.0), 3),
                })
            if found:
                print(f"[{i}/{total}] {found:5d} clips  {rel}", flush=True)
        except Exception as exc:
            print(f"[{i}/{total}] !! {rel}: {type(exc).__name__}", flush=True)
    INDEX_PATH.write_text(json.dumps(index, ensure_ascii=False, indent=0), encoding="utf-8")
    print(f"\nindexed {len(index)} clips -> {INDEX_PATH}")
    return index


def load_index() -> dict:
    if not INDEX_PATH.exists():
        raise SystemExit(f"no index yet; run --index first ({INDEX_PATH})")
    return json.loads(INDEX_PATH.read_text(encoding="utf-8"))


# ---------------------------------------------------------------------------
# extraction
# ---------------------------------------------------------------------------
def decode_all(game: Path, wanted: set[str], index: dict, tmp: Path) -> dict[str, Path]:
    """
    Decode every wanted clip to a wav in `tmp`.

    Grouped by source file: sounds.bundle alone is hundreds of megabytes and
    holds most of the movement audio, so opening it once per clip would make
    this take minutes instead of seconds.
    """
    import UnityPy

    by_file: dict[str, list[str]] = {}
    for name in wanted:
        entry = index.get(name)
        if entry:
            by_file.setdefault(entry["file"], []).append(name)

    out: dict[str, Path] = {}
    for rel, names in sorted(by_file.items()):
        todo = set(names)
        src = game / rel
        if not src.exists():
            print(f"  !! missing source {rel}")
            continue
        env = UnityPy.load(str(src))
        for obj in env.objects:
            if not todo:
                break
            if obj.type.name != "AudioClip":
                continue
            try:
                d = obj.read()
            except Exception:
                continue
            name = getattr(d, "m_Name", None)
            if name not in todo:
                continue
            todo.discard(name)
            try:
                samples = d.samples
            except Exception as exc:
                print(f"  !! decode failed {name}: {type(exc).__name__}")
                continue
            for _, blob in samples.items():
                p = tmp / f"{name}.wav"
                p.write_bytes(blob)
                out[name] = p
                break
        print(f"  decoded {len(names) - len(todo):3d}/{len(names):3d} from {Path(rel).name}")
    return out


def transcode(ffmpeg: str, wavs: list[Path], dest: Path, spec: dict) -> bool:
    """
    Mix one or more wavs down to a single mono ogg.

    `spec` may carry: gain (dB), trim [start, dur], fade (s), rate (Hz), q.
    Trimming matters because a lot of the source clips carry a long tail of
    silence that would otherwise delay the next cue.
    """
    dest.parent.mkdir(parents=True, exist_ok=True)
    args = [ffmpeg, "-hide_banner", "-loglevel", "error", "-y"]
    for w in wavs:
        if spec.get("trim"):
            start, dur = spec["trim"]
            args += ["-ss", str(start), "-t", str(dur)]
        args += ["-i", str(w)]

    filters = []
    if len(wavs) > 1:
        filters.append(f"amix=inputs={len(wavs)}:duration=longest:normalize=0")
    filters.append("aformat=channel_layouts=mono")
    # strip leading/trailing dead air, then normalise the peak so every cue
    # sits at a predictable level before the game applies its own gain
    filters.append("silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.01")
    filters.append("areverse,silenceremove=start_periods=1:start_threshold=-50dB,areverse")
    if spec.get("fade"):
        filters.append(f"afade=t=out:st={max(0.0, spec['fade'][0])}:d={spec['fade'][1]}")
    filters.append("dynaudnorm=p=0.9:m=10:s=5" if spec.get("norm") else "volume=0dB")
    if spec.get("gain"):
        filters.append(f"volume={spec['gain']}dB")

    args += [
        "-filter_complex", ",".join(filters),
        "-ar", str(spec.get("rate", 32000)),
        "-c:a", "libvorbis", "-q:a", str(spec.get("q", 2)),
        str(dest),
    ]
    res = subprocess.run(args, capture_output=True, text=True)
    if res.returncode != 0:
        print(f"    ffmpeg failed for {dest.name}: {res.stderr.strip()[:200]}")
        return False
    return True


def extract(game: Path, ffmpeg: str, picks: dict, only: str | None = None) -> dict:
    index = load_index()
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    manifest: dict[str, list[str]] = {}
    missing: list[str] = []

    cues = {c: s for c, s in picks.items() if not only or only in c}
    wanted: set[str] = set()
    for spec in cues.values():
        for entry in spec["clips"]:
            wanted.update(entry if isinstance(entry, list) else [entry])
    for name in sorted(wanted):
        if name not in index:
            missing.append(name)

    with tempfile.TemporaryDirectory() as td:
        tmp = Path(td)
        print(f"decoding {len(wanted)} clips...")
        wavs_by_name = decode_all(game, wanted, index, tmp)

        print(f"\ntranscoding {len(cues)} cues...")
        for cue, spec in cues.items():
            names = spec["clips"]
            variants: list[str] = []
            for i, entry in enumerate(names):
                layers = entry if isinstance(entry, list) else [entry]
                wavs = [wavs_by_name[c] for c in layers if c in wavs_by_name]
                if not wavs:
                    continue
                out_name = f"{cue}_{i}.ogg" if len(names) > 1 else f"{cue}.ogg"
                if transcode(ffmpeg, wavs, OUT_DIR / out_name, spec):
                    variants.append(out_name[:-4])
            if variants:
                manifest[cue] = variants
                print(f"  {cue:24s} {len(variants)} file(s)")

    (OUT_DIR / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"\nwrote {sum(len(v) for v in manifest.values())} files "
          f"for {len(manifest)} cues -> {OUT_DIR}")
    if missing:
        print(f"missing clips ({len(missing)}): " + ", ".join(missing[:20]))
    return manifest


# ---------------------------------------------------------------------------
def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--game", default=str(DEFAULT_GAME))
    ap.add_argument("--ffmpeg", default=None)
    ap.add_argument("--index", action="store_true")
    ap.add_argument("--limit", type=int, default=None)
    ap.add_argument("--search", default=None, help="regex over indexed clip names")
    ap.add_argument("--extract", action="store_true")
    ap.add_argument("--only", default=None, help="extract just the cues containing this")
    args = ap.parse_args()

    game = Path(args.game)
    if not game.exists():
        raise SystemExit(f"game not found: {game}")

    if args.index:
        build_index(game, args.limit)
        return

    if args.search:
        index = load_index()
        rx = re.compile(args.search, re.I)
        hits = sorted(n for n in index if rx.search(n))
        for n in hits[:400]:
            e = index[n]
            print(f"{n:52s} {e['len']:6.2f}s {e['ch']}ch  {Path(e['file']).name}")
        print(f"\n{len(hits)} hits" + ("" if len(hits) <= 400 else " (truncated)"))
        return

    if args.extract:
        from sfx_picks import PICKS
        extract(game, find_ffmpeg(args.ffmpeg), PICKS, args.only)
        return

    ap.print_help()


if __name__ == "__main__":
    main()
