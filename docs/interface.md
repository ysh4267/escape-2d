# The interface: how it is built

Everything outside a raid is meant to be the game's own interface, part for
part. This is how the page gets there and what to follow when adding to it.

## The frame

The client draws its interface for a 1920 x 1080 screen and scales the whole
thing; so does the page. `#stage` is that screen (`src/core/stage.js` sets
`--k`, the scale that makes a 1920 x 1080 frame fit the window), and every
`.screen` is the 1920 x 1080 frame centred on it. Inside a screen, positions
are the client's own pixels: `left: 707px; top: 263px` means exactly that in
a 1080p capture of the game. Nothing reflows; there are no breakpoints.

A pointer event is in window pixels and an element lives in stage pixels:
anything that places an element from an event goes through `toStage()`.

## Where the numbers come from

Three sources, in this order of trust:

1. **The client's own layout.** `tools/extract_tarkov_ui.py` reads a local
   install and dumps every screen's hierarchy to
   `tools/cache/client/layout/<scene>/<screen>.txt` (git-ignored): each node's
   box in the 1080 frame, its sprite, tint, text size and colour, layout-group
   padding and spacing, and the locale key a label is filled from. A `~` after
   a box means it is laid out at run time and the number is approximate - use
   the padding, spacing and `LE(...)` sizes around it instead.
2. **Captures of the running game**, measured: `tools/cache/ref/*/SPEC-*.md`
   with the images they were read from beside them. These say what the layout
   dump cannot: which state is shown when, what a hover looks like, where
   run-time lists end up.
3. Only then, judgement - and a note in the code saying it was a judgement.

## Art

The plates, icons, portraits and the typeface (Bender) are the client's.
`tools/build_ui.py` copies what the page uses out of the extraction into
sealed packs under `assets/ui-eft/`; `src/core/uiart.js` opens them.

- In a stylesheet a sprite is `var(--ui-<name>)`:
  `background: #262626 var(--ui-tab_selected_fill) 0 0 repeat;` - always with
  a flat colour under it.
- In a module: `uiImg(name)` (an `<img>` at the sprite's own size),
  `uiIcon(name)` (a glyph tinted by `currentColor`, for the client's white
  icons), `uiUrl(name)`.
- `<name>` is the sprite's name lower-cased, every run of other characters
  one underscore: `Trade_Buy_Icon_Idle` -> `trade_buy_icon_idle`. Look sprites
  up in `tools/cache/client/index.json` or browse
  `tools/cache/client/export/_sheets/*.png`.
- The builder finds names by reading the tree (every `--ui-*`, every quoted
  sprite name with an underscore in `src/`), so using a sprite is all it takes
  to ship it. Run `python tools/build_ui.py` after adding one. Big pictures a
  single screen shows live in side packs (`GROUPS` in the builder) and are
  fetched with `loadUiGroup('<pack>')`.
- Nine-slice sprites go through `border-image`
  (`border-image: var(--ui-header_panel) 0 22 0 8 fill stretch` with matching
  border widths); the slices are in `uiMeta(name).border` and in
  `export/_nine_slice.json`.
  Some of the client's frames are cut down the very middle - an 8 px sprite
  with 4 px borders, nothing left between them. The client stretches the seam;
  a browser draws only the corners. Take the slice one pixel short of the
  middle (`3 fill / 3px` for that one) and the frame comes out whole.

## Words

No interface string is written out. A module asks for it by the client's
locale key - `t('QuestsShowCompleted')`, `t('DEAL!')` - and
`tools/build_locale.py` cuts a table of exactly the keys the tree asks for
(`src/data/locale-<lang>.json`, English and Korean). The layout dump shows the
key of every label (`EFT.UI.LocalizedText{KEY}`). Run the builder after adding
a key; `--report` lists the ones the dump does not have (use
`tOr(key, 'fallback')` for those). Where the key is an id in a data file and
not a word in the code - a skill's name and descriptions, the sentence of
each thing it does - the builder reads the data file for it (`data_keys`). A control or a note that only this build
has, and the client therefore has no key for, is written out at the call site
in each language: `own('Reset game profile', '게임 프로필 초기화')`.

Some of the client's strings carry their own colours
(`R: <color=#C3C5BBFF>{0}</color>`); `tRich(key, ...args)` gives those back as
nodes with the colour applied. Placeholders are filled as the client fills
them, padding included: `t('{0}h{1:00}m', 4, 7)` is `4h07m`.

Numbers are written the way the game writes them: `fmtNum()` sets thousands
apart with a space, `fmtShort()` gives `2.4M`.

## Type

The layout dump gives every label's size and colour, and the size is right:
cap heights in a capture agree with it. The width is not. The client sets its
type a little wider than the font's own advance - about 0.02 em a letter for
mixed case, nearer 0.04 em for a line of capitals - so a label at the dump's
size comes out 4 to 7 % short. Measure the line in a capture against the same
line in `tools/shot.py`'s picture and close the difference with
`letter-spacing` on that label (the OVERALL tab in `styles/eft-character.css`
is done this way throughout). Do not make the type larger to fit: the height
is already right.

## Stylesheets

`styles/eft.css` is the shared part: the frame, the client's text button
(`.dbtn`, a bare label that gets the torn cream plate on hover), the
cut-corner tab (`.ptab`), the folded label (`.rank`), key caps, tick boxes,
the drop-down box and the number slider (`.ddb`, `.nsl`; built by
`src/ui/kit.js`), scrollbars, the bottom bar, the grid and item tiles,
windows. Each screen has its own sheet (`eft-menu`, `eft-character`,
`eft-traders`, `eft-settings`, `eft-misc`); a new screen gets a new sheet,
linked in `index.html` after these.

## Checking

`python tools/shot.py out.png --js "<drive the page>"` takes a 1920 x 1080
picture of the running page (a fresh profile every run) and prints page
errors; it lines up pixel for pixel with a 1080p capture of the game, so put
the two side by side. The page exposes what a script needs as
`window.ESCAPE2D` (`game`, `DB`, `showScreen`, `openCharacter`, `Quests`,
`Traders`, `Mail`, ...). Serve the repo root without caching on port 8777
first. `--lang en|ko` boots it in a given language. Scroll bars are in the
picture, as they are in a browser window.

`python tools/sweep.py` walks every screen the way a player gets there - the
bar, a tab, a card - and reports each step that threw, logged an error or
asked for a file that is not there. Run it in both languages before a commit
and add a step for a new screen (`STEPS` in the script); `--shots <dir>`
keeps a picture of every step.
