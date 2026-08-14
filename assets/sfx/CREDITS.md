# Sound credits

The game reads whichever of two sound packs is present at boot.

## `assets/sfx/` — the pack that ships (CC0)

This is what the published build plays, and the only audio in this repository.

### Metal footsteps on concrete — Thimras
- license: **CC0 1.0**
- source: https://opengameart.org/content/metal-footsteps-on-concrete
- used as: `step_1` … `step_6`, cycled for every gait

The factory ambience is synthesised at runtime in `src/core/audio.js` and
ships no file. Cues with no CC0 sample behind them are silent no-ops.

## `assets/sfx-eft/` — the game's own audio (local only)

`tools/extract_tarkov_sfx.py` pulls the real effects out of a local Escape
From Tarkov installation and transcodes them into this directory, which
covers every cue the game has. That audio is **Battlestate Games'
copyrighted material**: using it locally from a copy you own is fine, but it
is not ours to redistribute, so the directory is gitignored and never
deployed. Nothing in the repository depends on it — the game detects the
pack at boot and falls back to the CC0 set when it is absent.

Escape From Tarkov is a trademark of Battlestate Games. This is a
non-commercial fan project and is not affiliated with or endorsed by them.
