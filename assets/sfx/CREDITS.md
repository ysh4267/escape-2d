# Sound credits

Escape From Tarkov's own audio is copyrighted by Battlestate Games and is
not redistributed here. These effects come from openly licensed libraries:

## Metal footsteps on concrete — Thimras
- license: **CC0 1.0**
- source: https://opengameart.org/content/metal-footsteps-on-concrete
- used as: `step_1`, `step_2`, `step_3`, `step_4`, `step_5`, `step_6`

The factory ambience is synthesised at runtime in `src/core/audio.js`
and ships no file. Every other cue was removed by request; the vetted
picks for them are parked in `tools/build_sounds.py` under `PARKED`.
