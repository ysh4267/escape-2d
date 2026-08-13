# ESCAPE 2D — Factory

A top-down, browser-based extraction shooter sandbox built around a faithful
reimplementation of Escape From Tarkov's grid inventory. Right-click to move,
right-click a container to search it, drag the loot into your rig, then walk to
an exfil and hold **F** to take it home.

No build step, no dependencies — plain ES modules, canvas and DOM.

![stash](docs/stash.png)

| | |
|---|---|
| ![raid](docs/raid.png) | ![loot](docs/loot.png) |
| in raid — fog of war over the real Factory geometry | searching a dead scav; unexamined loot shows as `?` |
| ![traders](docs/traders.png) | ![deploy](docs/deploy.png) |
| eight traders, loyalty-gated stock, three currencies | pre-raid brief |

---

## Playing

| | |
|---|---|
| **RMB** on the ground | move there (A\* pathfinding around the real Factory walls) |
| **RMB** on a container | walk to it and search it |
| **TAB** | open / close the inventory overlay |
| **SHIFT** | sprint (burns stamina) |
| **F** (hold, 6 s) | extract, when standing in an exfil zone |
| **1 / 2 / 3** in the hideout | stash · traders · raid |

### Inventory

| | |
|---|---|
| **drag** | move an item; the ghost anchors by its **top-left** cell, as in Tarkov |
| **R** while dragging | rotate 90° (square items are a no-op) |
| **CTRL + click** | quick transfer — rig, then pockets, then backpack |
| **CTRL + drag** onto a free cell | split the stack |
| **ALT + click** | equip into the matching slot |
| **RMB** on an item | context menu: examine, use, split, equip, inspect, discard |

---

## What is modelled

**Grid inventory.** Items occupy `w × h` cells, never overlap, and rotate 90°.
Grid-to-grid drops onto occupied cells are rejected outright — Tarkov has no
grid swap; only equipment slots swap. Stacks merge up to the template's real
`StackMaxSize` and a found-in-raid stack never launders a non-FiR one.

**Containers.** Every container carries its real internal grid layout, so a
BlackRock rig really is seven separate pouches and a Documents case really is
1×2 outside and 4×4 inside, filtered to keys, intel and money. Nesting is
blocked for cycles (an item inside itself), for backpack-in-backpack, and past
a depth cap.

**Equipment.** Headwear, earpiece, face cover, eyewear, body armor, tactical
rig, backpack, secure container, on-sling, on-back, holster and sheath, plus
**four independent 1×1 pockets** — the real base-PMC layout, so nothing larger
than a single cell fits in a pocket and items never span two of them.

**Raids.** Loot containers scatter across fourteen named Factory regions with
per-container-type loot tables and real search times. Containers start
unsearched and their contents are hidden until you search them. Unexamined
items render as `?` until you examine them.

**Extraction.** Anything carried into a raid loses its found-in-raid mark on
insertion; anything carried out gains it. Die or run the clock out and only the
secure container comes home.

**Traders.** Eight traders with the documented buy-back multipliers — Therapist
0.51, Ragman 0.50, Jaeger 0.48, Mechanic 0.45, Prapor 0.40, Skier 0.39,
Peacekeeper 0.36, Fence 0.24 — category gating so most items have only two or
three legal buyers, loyalty levels gated on PMC level and reputation, and
separate rouble / dollar / euro balances.

---

## Running it

Any static server works:

```sh
python -m http.server 8777
# then open http://127.0.0.1:8777/
```

`file://` will not work — the game loads its data with `fetch`.

---

## Tools

| file | what it does |
|---|---|
| `tools/build_items.py` | builds `src/data/items-db.json` and downloads item artwork |
| `tools/selection.py` | the curated item list the builder resolves |
| `tools/build_map.py` | extracts Factory wall / floor / obstacle geometry into `src/data/map-factory.json` |
| `tools/smoke.html` | 76 headless assertions over inventory, map, raid, trader and save logic |
| `tools/preview_map.html` | renders the raw extracted geometry |
| `tools/preview_nav.html` | renders navmesh connected components, spawn/extract reachability and per-region walkability |

Regenerate everything:

```sh
cd tools
python build_items.py --report
python build_map.py
```

The item builder joins three public data sets: grid footprints, weights, stack
sizes and container layouts come from the SPT template dump, English names and
descriptions from the SPT locale dump, base prices and categories from the SPT
handbook, and artwork from `assets.tarkov.dev` — whose grid images are exactly
`63 × cells + 1` pixels, which the builder uses to cross-check every footprint.

---

## Data sources and attribution

This is a non-commercial fan project. Escape From Tarkov is a trademark of
Battlestate Games; this project is not affiliated with or endorsed by them.

- **Map geometry** — [the-hideout/tarkov-dev-svg-maps](https://github.com/the-hideout/tarkov-dev-svg-maps),
  licensed **CC BY-NC-SA 4.0**. The Factory walls, floors, obstacles and the
  reactor units in this game are derived from that vector map.
- **Item artwork** — `assets.tarkov.dev`, from the community
  [tarkov.dev](https://tarkov.dev) project.
- **Item templates, names and handbook prices** — the public
  [SPT](https://github.com/sp-tarkov/server) database dumps.
- **Extract names, spawn locations and container behaviour** — the Escape From
  Tarkov wiki.

Because the map geometry is CC BY-NC-SA, this project inherits the same terms:
share alike, non-commercial, with attribution.
