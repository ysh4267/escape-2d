#!/usr/bin/env python3
"""
Cut the interface strings the page uses out of the game's own locale.

    python build_locale.py            # scan src/, write src/data/locale-<lang>.json
    python build_locale.py --report   # also list the keys that were not found

The page never spells an interface string itself; it asks for it by the
client's own key - t('QuestsShowCompleted'), t('DEAL!') - so the wording is
the game's, in whichever language is loaded. This reads every such key out of
src/ and writes, for each language, a table of just those keys.

A key is anything passed as a literal to t(...), tOr(...) or tRich(...); any `label:`,
`key:` or `title:` of a table in src/ whose text is a key of the locale (the
bars and tab strips keep their entries in tables and translate them as they
draw); every key matching one of FAMILIES (the ones the page builds at
run time, like the status words of a task); and the keys the data files name
(data_keys: a skill's name, its two descriptions and the sentence of each of
its effects, all filed in the locale under the ids in progress-db.json).

The source tables are dumps of the client locale: the 1.3 one when it is in
the cache (tools/cache/spt13/, fetched by tools/build_story.py), else SPT's
0.16.9 (tools/cache/spt412/, fetched by tools/build_meta.py) - the older one
filling in whatever the newer lacks.

Keys are matched as written first and without regard to case second, the way
the client's own lookup forgives them.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
CACHES = [HERE / "cache" / "spt13", HERE / "cache" / "spt412"]     # newest first
OUT = ROOT / "src" / "data"

# page language -> the dump's name for it
LANGS = {"en": "en", "ko": "kr"}

# whole families of keys the page asks for by a built name
FAMILIES = [
    r"^QuestStatus\w+$",
    r"^QuestType\w+$",
    r"^UI/Quests/",
    r"^(RUB|USD|EUR)$",
    r"^EPressType/",
    r"^ENicknameError/",
]

QUOTED = r"""(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")"""
T_CALL = re.compile(r"\bt(?:Or|Rich)?\(\s*" + QUOTED)
TABLE_KEY = re.compile(r"\b(?:label|key|title)\s*:\s*" + QUOTED)

# strings the client's table spells with a letter from the wrong alphabet
FIXES = {"Show сompleted": "Show completed"}


def unescape(s: str) -> str:
    return s.replace("\\'", "'").replace('\\"', '"').replace("\\\\", "\\")


def wanted_keys() -> tuple[set[str], set[str]]:
    """the keys asked for outright, and the table entries that may be keys"""
    keys: set[str] = set()
    maybe: set[str] = set()
    for f in (ROOT / "src").rglob("*.js"):
        text = f.read_text(encoding="utf-8")
        for a, b in T_CALL.findall(text):
            keys.add(unescape(a or b))
        for a, b in TABLE_KEY.findall(text):
            maybe.add(unescape(a or b))
    return keys, maybe - keys


def data_keys() -> set[str]:
    """keys that are ids in the data files rather than words in the code"""
    keys: set[str] = set()
    src = OUT / "progress-db.json"
    if src.exists():
        for s in json.loads(src.read_text(encoding="utf-8")).get("skills", []):
            if not s.get("cls"):
                continue
            keys.update((s["id"], s["id"] + "Description", s["id"] + "LevelingUpDescription"))
            keys.update(b["id"] for b in s.get("buffs", []))
    return keys


def load_table(dump: str) -> dict:
    """the newest dump of a language, with the older ones behind it"""
    table: dict = {}
    for cache in reversed(CACHES):
        src = cache / f"locales_global_{dump}.json"
        if src.exists():
            table.update(json.loads(src.read_text(encoding="utf-8")))
    return table


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--report", action="store_true")
    args = ap.parse_args()

    keys, maybe = wanted_keys()
    maybe |= data_keys() - keys
    fams = [re.compile(p) for p in FAMILIES]
    missing_all: set[str] = set()
    for lang, dump in LANGS.items():
        table = load_table(dump)
        if not table:
            print(f"skip {lang}: no locales_global_{dump}.json in the cache")
            continue
        low: dict[str, str] = {}
        for k in table:
            low.setdefault(k.lower(), k)
        out: dict[str, str] = {}
        missing: set[str] = set()
        for k in sorted(keys | maybe):
            real = k if k in table else low.get(k.lower())
            if real is None or not isinstance(table[real], str):
                if k in keys:
                    missing.add(k)
                continue
            out[k] = FIXES.get(table[real], table[real])
        for k, v in table.items():
            if isinstance(v, str) and any(p.search(k) for p in fams):
                out.setdefault(k, FIXES.get(v, v))
        OUT.mkdir(parents=True, exist_ok=True)
        (OUT / f"locale-{lang}.json").write_text(
            json.dumps(dict(sorted(out.items())), ensure_ascii=False, indent=0, separators=(",", ":")) + "\n",
            encoding="utf-8", newline="\n")
        print(f"{lang}: {len(out)} strings ({len(missing)} asked for and not in the dump)")
        missing_all |= missing
    if missing_all and args.report:
        for k in sorted(missing_all):
            print("  missing:", repr(k))


if __name__ == "__main__":
    main()
