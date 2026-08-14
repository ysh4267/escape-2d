// =========================================================
// Factory: the playable definition layered over the extracted geometry
//
// All coordinates are in the SVG's own units (the viewBox is 130.8 x 141.2,
// which the map header sizes at roughly 160 x 155 m, so 1 unit ~ 1.15 m).
// x grows east, y grows south.
//
// Almost nothing here is placed by hand any more. tools/build_map.py reads the
// plant's four storeys out of the vector map, finds every opening in them, and
// folds in tarkov.dev's dataset for the raid itself: the insertion points, the
// exits and their factions, the static container spots, the loose-loot spots,
// and the four doors that are actually locked and which key opens each. This
// file supplies what a dataset cannot: what the places are called, what their
// floors are made of, and a line of description for the exits.
// =========================================================

export const MAPS = {
  factory: {
    id: 'factory',
    name: 'FACTORY',
    subtitle: 'Chemical Plant No. 16',
    tags: ['CQB', '160 x 155 m', '20 min'],
    duration: 20 * 60,
    geometry: 'map-factory.json',
    unitsToMetres: 1.15,
    startLevel: 'ground',

    /**
     * The storeys, bottom to top. `key` matches a group in the geometry file;
     * `band` is the height range tarkov.dev files raid positions under, which
     * is what decides the floor a container or an exit belongs to.
     */
    levels: [
      { key: 'basement', name: 'Tunnels', short: 'TUN', floor: -1 },
      { key: 'ground', name: 'Ground floor', short: '1F', floor: 0 },
      { key: 'second', name: 'Second floor', short: '2F', floor: 1 },
      { key: 'third', name: 'Third floor', short: '3F', floor: 2 },
    ],

    /**
     * Named areas, one rectangle each.
     *
     * These do three jobs: they name the place a container was found in, they
     * decide the footstep set through `surface`, and they label the floor plan.
     * The names and their positions come from the area labels tarkov.dev draws
     * on its own Factory map, put through the same world-to-SVG transform as
     * everything else, so "Silos" really does sit on the silos.
     *
     * Rectangles overlap on purpose — the silo pit sits inside the processing
     * hall — and the smallest one covering a point wins, which is always the
     * more specific description of that spot.
     */
    areas: [
      // ---------------- tunnels ----------------
      { level: 'basement', name: 'Tunnels', rect: [0, 0, 113, 123], surface: 'concrete' },
      { level: 'basement', name: 'Cellars', rect: [86, 2, 106, 20], surface: 'concrete' },
      { level: 'basement', name: 'North tunnel', rect: [46, 4, 86, 32], surface: 'concrete' },
      { level: 'basement', name: 'East tunnel', rect: [84, 20, 108, 68], surface: 'concrete' },
      { level: 'basement', name: 'West tunnel', rect: [14, 34, 44, 92], surface: 'concrete' },
      { level: 'basement', name: 'Pit', rect: [42, 62, 64, 90], surface: 'metal' },
      { level: 'basement', name: 'Underground stash', rect: [80, 68, 102, 90], surface: 'concrete' },
      { level: 'basement', name: 'Camera bunker', rect: [16, 84, 38, 102], surface: 'concrete' },
      { level: 'basement', name: 'Sewer', rect: [56, 92, 112, 108], surface: 'metal' },

      // ---------------- ground ----------------
      { level: 'ground', name: 'Processing area', rect: [26, 26, 100, 98], surface: 'concrete' },
      { level: 'ground', name: 'Unloading and storage', rect: [20, 3, 100, 27], surface: 'concrete' },
      { level: 'ground', name: 'Glass Hall', rect: [76, 3, 100, 17], surface: 'concrete' },
      { level: 'ground', name: 'Forklifts', rect: [98, 3, 131, 22], surface: 'asphalt' },
      { level: 'ground', name: 'Boilers', rect: [54, 13, 72, 29], surface: 'metal' },
      { level: 'ground', name: 'Gate 3 room', rect: [0, 11, 26, 25], surface: 'concrete' },
      { level: 'ground', name: 'East halls', rect: [94, 22, 118, 44], surface: 'concrete' },
      { level: 'ground', name: 'Pumping station', rect: [69, 27, 89, 45], surface: 'metal' },
      { level: 'ground', name: 'East yard', rect: [104, 30, 131, 92], surface: 'asphalt' },
      { level: 'ground', name: 'Connector', rect: [43, 39, 59, 55], surface: 'concrete' },
      { level: 'ground', name: 'Heli crash', rect: [67, 39, 86, 55], surface: 'asphalt' },
      { level: 'ground', name: 'Courtyard', rect: [0, 38, 15, 72], surface: 'asphalt' },
      { level: 'ground', name: 'Office building', rect: [21, 38, 37, 72], surface: 'tile' },
      { level: 'ground', name: 'Silos', rect: [43, 53, 69, 89], surface: 'metal' },
      { level: 'ground', name: 'Platform', rect: [25, 71, 39, 87], surface: 'concrete' },
      { level: 'ground', name: 'Finished-products area', rect: [0, 70, 34, 100], surface: 'concrete' },
      { level: 'ground', name: 'Blue containers', rect: [9, 85, 29, 101], surface: 'asphalt' },
      { level: 'ground', name: 'Med tent', rect: [86, 85, 112, 101], surface: 'concrete' },
      { level: 'ground', name: 'Scav bunker', rect: [37, 89, 55, 103], surface: 'concrete' },
      { level: 'ground', name: 'South annex', rect: [52, 96, 68, 126], surface: 'concrete' },
      { level: 'ground', name: 'South workshops', rect: [0, 100, 30, 128], surface: 'concrete' },
      { level: 'ground', name: 'Wood room', rect: [0, 111, 20, 129], surface: 'concrete' },
      { level: 'ground', name: 'Gate 0 corridor', rect: [2, 110, 18, 142], surface: 'concrete' },

      // ---------------- second ----------------
      { level: 'second', name: 'Office building', rect: [17, 26, 35, 92], surface: 'tile' },
      { level: 'second', name: 'Boiler mezzanine', rect: [48, 13, 73, 29], surface: 'metal' },
      { level: 'second', name: 'Office landing', rect: [17, 26, 35, 39], surface: 'tile' },
      { level: 'second', name: 'Pumping station gantry', rect: [70, 31, 88, 41], surface: 'metal' },
      { level: 'second', name: 'Locker rooms', rect: [17, 39, 35, 53], surface: 'tile' },
      { level: 'second', name: 'East gantry', rect: [82, 37, 105, 53], surface: 'metal' },
      { level: 'second', name: 'Hole', rect: [21, 53, 33, 58], surface: 'metal' },
      { level: 'second', name: 'Sinks', rect: [17, 57, 35, 67], surface: 'tile' },
      { level: 'second', name: 'South catwalk', rect: [24, 66, 35, 92], surface: 'metal' },
      { level: 'second', name: 'Servers', rect: [31, 90, 51, 101], surface: 'tile' },

      // ---------------- third ----------------
      { level: 'third', name: 'Rafters', rect: [3, 8, 105, 118], surface: 'metal' },
      { level: 'third', name: 'North catwalk', rect: [20, 8, 100, 28], surface: 'metal' },
      { level: 'third', name: 'Sky bridge', rect: [34, 37, 50, 47], surface: 'metal' },
      { level: 'third', name: 'North stairs landing', rect: [23, 37, 36, 43], surface: 'tile' },
      { level: 'third', name: 'Locked office', rect: [24, 43, 36, 50], surface: 'tile' },
      { level: 'third', name: 'Breach room', rect: [24, 49, 36, 56], surface: 'tile' },
      { level: 'third', name: 'Main office', rect: [24, 55, 36, 66], surface: 'tile' },
      { level: 'third', name: 'South stairs landing', rect: [23, 65, 36, 71], surface: 'tile' },
    ],

    /**
     * A line about each exit, keyed by the name the game gives it. Everything
     * factual about them — where they are, who may use them, what has to be
     * handed over — comes out of the dataset; this is only the flavour.
     */
    extractNotes: {
      'Gate 3': 'No requirement, and the shortest walk from most spawns. The most contested exit on the map.',
      'Gate 0': 'Far south end of the dead-end corridor. No requirement.',
      'Courtyard Gate': 'West edge of the courtyard, a few metres from where the transit to Woods leaves.',
      'Med Tent Gate': 'Out through the emergency exit door on the east wall. That door is locked.',
      Cellars: 'Down in the tunnels, behind the locked cellars door at the north end.',
      'Camera Bunker Door': 'Scav lane. Underground, beside the TerraGroup storage room.',
      'Office Window': 'Scav lane. Out of the third-floor office, through the window.',
      "Smugglers' Passage": 'Only opens for someone carrying the note with the code word Ark.',
    },

    /**
     * Doors worth naming. Every other opening gets named after the area it sits
     * in. The four with a `key` are the only locked doors on Factory: the
     * dataset records exactly these, and each one landed within a metre of an
     * opening the geometry search had already found on its own.
     */
    doorNames: {
      g116_95: 'Emergency exit door',
      b96_10: 'Cellars door',
      t31_47: 'Locked office door',
      b24_96: 'TerraGroup storage room',
      g13_16: 'Gate 3 side door',
      g25_16: 'Gate 3 room door',
      g10_130: 'Gate 0 corridor door',
      g15_120: 'Wood room door',
      g104_95: 'Med tent corridor door',
      t31_57: 'Main office door',
      t31_52: 'Breach room door',
    },

    /**
     * The one door on Factory that is locked with no key anywhere in the game.
     * It is the middle room of the third-floor office row, and the only way in
     * is to force it — which is where the room's name comes from. The dataset
     * has no lock entry for it because there is no key to record, so it is
     * named here instead.
     */
    doorOverrides: {
      t31_52: {
        state: 'breach',
        name: 'Breach room door',
        note: 'Locked, and no key for it exists anywhere. Force it open.',
      },
    },

    /**
     * Openings at least this wide are gateways, hall mouths and roller doors:
     * the plan draws a gap there but there is no leaf to open. Anything
     * narrower gets a door that starts shut, the way Factory's do.
     */
    doorMaxWidth: 1.6,

    /** how long forcing a door takes, and how far the noise carries */
    breachTime: 2.4,
  },
};

export const DEFAULT_MAP = 'factory';

export function levelInfo(mapDef, key) {
  return mapDef.levels.find((l) => l.key === key) || mapDef.levels[0];
}

/**
 * The smallest named area covering a point on a given floor. Outside every
 * area the plant is concrete and simply unnamed.
 */
export function areaAt(mapDef, level, x, y) {
  let best = null, bestArea = Infinity;
  for (const a of mapDef.areas) {
    if (a.level !== level) continue;
    const [x0, y0, x1, y1] = a.rect;
    if (x < x0 || x > x1 || y < y0 || y > y1) continue;
    const size = (x1 - x0) * (y1 - y0);
    if (size < bestArea) { bestArea = size; best = a; }
  }
  return best;
}
