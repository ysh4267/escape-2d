#!/usr/bin/env python3
"""
Bundle the extracted sound pack into one compressed, encrypted blob.

    python pack_sfx.py                 # assets/sfx-eft/*.ogg -> pack.bin
    python pack_sfx.py --key "..."     # use an existing passphrase
    python pack_sfx.py --unpack        # pack.bin -> assets/sfx-eft/*.ogg

Two things at once. The 93 loose ogg files become a single container that is
deflated and then encrypted, so the browser makes one request instead of
ninety-four, and the raw game audio never sits in the repository in a form
anything can just play.

Container, before compression:

    [4 bytes LE header length][header JSON][blob][blob]...

with the header holding the cue manifest and an (offset, length) for every
blob. That is deflate-raw'd, then AES-256-GCM'd into:

    magic "E2SFX1" | salt (16) | iv (12) | ciphertext || tag (16)

The key is PBKDF2-HMAC-SHA256 over a passphrase, 200k iterations. Both ends of
that are native: `cryptography` here, WebCrypto in src/core/audio.js. The
passphrase is never written to the repo - it lives in the SFX_PACK_KEY
environment variable locally and in a repository secret for the deploy.

Note what this is and is not. The deployed site has to hand the key to the
browser to play anything, so anyone determined enough can recover it. This
keeps Battlestate Games' audio from sitting in a public tree as ready-to-use
ogg files; it is not, and cannot be, real protection against someone who sets
out to break it.

    python -m pip install cryptography
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import secrets
import struct
import sys
import zlib
from pathlib import Path

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
SFX_DIR = ROOT / "assets" / "sfx-eft"
PACK_PATH = SFX_DIR / "pack.bin"
MANIFEST_PATH = SFX_DIR / "manifest.json"

MAGIC = b"E2SFX1"
SALT_LEN = 16
IV_LEN = 12
ITERATIONS = 200_000


def derive(passphrase: str, salt: bytes) -> bytes:
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(), length=32, salt=salt, iterations=ITERATIONS
    )
    return kdf.derive(passphrase.encode("utf-8"))


def pack(passphrase: str) -> None:
    if not MANIFEST_PATH.exists():
        sys.exit(f"no manifest at {MANIFEST_PATH} - run extract_tarkov_sfx.py first")

    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))

    # every base name any cue can reach, deduped but kept in manifest order
    names: list[str] = []
    for cue_names in manifest.values():
        for name in cue_names:
            if name not in names:
                names.append(name)

    blobs, files, offset = [], [], 0
    missing = []
    for name in names:
        path = SFX_DIR / f"{name}.ogg"
        if not path.exists():
            missing.append(name)
            continue
        data = path.read_bytes()
        blobs.append(data)
        files.append({"name": name, "off": offset, "len": len(data)})
        offset += len(data)

    if missing:
        print(f"  {len(missing)} manifest entries have no ogg: {', '.join(missing[:6])}")

    header = json.dumps(
        {"manifest": manifest, "files": files}, separators=(",", ":")
    ).encode("utf-8")
    raw = struct.pack("<I", len(header)) + header + b"".join(blobs)

    # deflate-raw, so the browser's DecompressionStream reads it directly
    deflator = zlib.compressobj(9, zlib.DEFLATED, -zlib.MAX_WBITS)
    squeezed = deflator.compress(raw) + deflator.flush()

    salt = secrets.token_bytes(SALT_LEN)
    iv = secrets.token_bytes(IV_LEN)
    sealed = AESGCM(derive(passphrase, salt)).encrypt(iv, squeezed, None)

    SFX_DIR.mkdir(parents=True, exist_ok=True)
    PACK_PATH.write_bytes(MAGIC + salt + iv + sealed)

    loose = sum(len(b) for b in blobs) + len(MANIFEST_PATH.read_bytes())
    final = PACK_PATH.stat().st_size
    print(f"  packed {len(files)} clips over {len(manifest)} cues")
    print(f"  loose      {loose / 1024:8.1f} KiB in {len(files) + 1} files")
    print(f"  container  {len(raw) / 1024:8.1f} KiB")
    print(f"  deflated   {len(squeezed) / 1024:8.1f} KiB")
    print(f"  pack.bin   {final / 1024:8.1f} KiB in 1 file "
          f"({100 * (loose - final) / loose:+.1f}% bytes, "
          f"{len(files) + 1} requests -> 1)")


def unpack(passphrase: str) -> None:
    if not PACK_PATH.exists():
        sys.exit(f"no pack at {PACK_PATH}")

    blob = PACK_PATH.read_bytes()
    if blob[: len(MAGIC)] != MAGIC:
        sys.exit("not an E2SFX1 pack")

    at = len(MAGIC)
    salt, iv = blob[at : at + SALT_LEN], blob[at + SALT_LEN : at + SALT_LEN + IV_LEN]
    sealed = blob[at + SALT_LEN + IV_LEN :]

    try:
        squeezed = AESGCM(derive(passphrase, salt)).decrypt(iv, sealed, None)
    except Exception:
        sys.exit("wrong passphrase, or the pack is damaged")

    raw = zlib.decompressobj(-zlib.MAX_WBITS).decompress(squeezed)
    (head_len,) = struct.unpack("<I", raw[:4])
    header = json.loads(raw[4 : 4 + head_len])
    body = raw[4 + head_len :]

    SFX_DIR.mkdir(parents=True, exist_ok=True)
    MANIFEST_PATH.write_text(
        json.dumps(header["manifest"], indent=2), encoding="utf-8"
    )
    for entry in header["files"]:
        (SFX_DIR / f"{entry['name']}.ogg").write_bytes(
            body[entry["off"] : entry["off"] + entry["len"]]
        )
    print(f"  wrote {len(header['files'])} clips into {SFX_DIR}")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--key", help="passphrase; defaults to $SFX_PACK_KEY")
    ap.add_argument("--unpack", action="store_true", help="restore the loose ogg files")
    args = ap.parse_args()

    passphrase = args.key or os.environ.get("SFX_PACK_KEY")
    if not passphrase:
        if args.unpack:
            sys.exit("no passphrase: pass --key or set SFX_PACK_KEY")
        passphrase = base64.urlsafe_b64encode(secrets.token_bytes(24)).decode().rstrip("=")
        print("  no SFX_PACK_KEY set, so here is a fresh passphrase.")
        print("  Save it now - without it the pack cannot be opened again:\n")
        print(f"      {passphrase}\n")

    unpack(passphrase) if args.unpack else pack(passphrase)


if __name__ == "__main__":
    main()
