// =========================================================
// Factory: playable definition layered over the extracted SVG geometry
//
// All coordinates are in the SVG's own units (the viewBox is 130.8 x 141.2,
// which the map header sizes at roughly 160 x 155 m, so 1 unit ~ 1.15 m).
// x grows east, y grows south.
//
// Extract names, sides and requirements follow the EFT wiki; positions were
// placed against the tarkov.dev vector geometry.
// =========================================================

export const MAPS = {
  factory: {
    id: 'factory',
    name: 'FACTORY',
    subtitle: 'Chemical Plant No. 16',
    tags: ['CQB', '160 x 155 m', '20 min'],
    duration: 20 * 60,
    geometry: 'map-factory.json',
    level: 'ground',
    unitsToMetres: 1.15,

    /** PMC insertion points (ground floor set from the wiki marker dump) */
    spawns: [
      { x: 14, y: 62, name: 'West service rooms' },
      { x: 62, y: 121, name: 'Gate 5 annex' },
      { x: 108, y: 66, name: 'East wall room' },
      { x: 47, y: 45, name: 'Rail track, north plinth' },
      { x: 117, y: 82, name: 'Eastern yard' },
      { x: 10, y: 126, name: 'Gate 0 corridor' },
      { x: 12, y: 19, name: 'Gate 3 room' },
      { x: 95, y: 42, name: 'East main hall' },
    ],

    /** exfiltration points */
    extracts: [
      {
        id: 'gate3', name: 'Gate 3', side: 'both', x: 6.5, y: 19, r: 3.2,
        req: null, note: 'No requirement. The most contested exit on the map.',
      },
      {
        id: 'gate0', name: 'Gate 0', side: 'pmc', x: 10, y: 138.5, r: 3.2,
        req: null, note: 'Far south end of the dead-end corridor.',
      },
      {
        id: 'courtyard', name: 'Courtyard Gate', side: 'pmc', x: 2.5, y: 55, r: 3.4,
        req: null, note: 'West edge of the courtyard, beside the parked truck.',
      },
      {
        id: 'medtent', name: 'Med Tent Gate', side: 'pmc', x: 128, y: 95.5, r: 3.2,
        req: 'k_factexit', note: 'Locked. Needs the Factory emergency exit key.',
      },
      {
        id: 'gate1', name: 'Gate 1', side: 'scav', x: 121, y: 8, r: 3.2,
        req: null, note: 'North-east loading bay roller door.',
      },
    ],

    /**
     * loot regions. Containers are scattered inside these rectangles onto
     * walkable cells, so every raid lays out slightly differently.
     * `spawn` lists [containerType, count] pairs.
     *
     * `surface` is what the floor is made of, which picks the footstep set:
     * concrete for the plant floor, metal for gratings and dock plates, tile
     * for the offices and service rooms, asphalt for the yards outside.
     * Rectangles overlap on purpose (the silo pit sits inside the processing
     * hall), so `surfaceAt` takes the smallest one covering a point.
     * Anywhere outside every region falls back to concrete.
     */
    regions: [
      {
        id: 'north_strip', name: 'Unloading and storage area',
        rect: [30, 5, 98, 26],
        surface: 'concrete',
        spawn: [['crate', 3], ['toolbox', 1], ['techcrate', 1], ['jacket', 2], ['duffle', 1], ['ammobox', 1]],
      },
      {
        id: 'gate1_bay', name: 'Gate 1 loading bay',
        rect: [100, 4, 128, 24],
        surface: 'metal',
        spawn: [['crate', 2], ['weaponbox', 1], ['duffle', 1], ['jacket', 1]],
      },
      {
        id: 'main_hall', name: 'Processing area',
        rect: [40, 30, 100, 96],
        surface: 'concrete',
        spawn: [['crate', 4], ['jacket', 4], ['duffle', 2], ['weaponbox', 2], ['toolbox', 1],
                ['grenadebox', 2], ['safe', 1], ['deadscav', 2], ['suitcase', 1], ['ammobox', 1]],
      },
      {
        id: 'east_rooms', name: 'Office block',
        rect: [88, 33, 112, 60],
        surface: 'tile',
        spawn: [['filecab', 2], ['drawer', 2], ['pcblock', 1], ['safe', 1], ['jacket', 2], ['cashreg', 1]],
      },
      {
        id: 'east_yard', name: 'Eastern yard',
        rect: [106, 28, 130, 90],
        surface: 'asphalt',
        spawn: [['jacket', 3], ['duffle', 1], ['crate', 2], ['medbag', 2], ['rationcrate', 1]],
      },
      {
        id: 'gate4_corridor', name: 'Gate 4 corridor / Med tents',
        rect: [94, 90, 130, 100],
        surface: 'concrete',
        spawn: [['medbag', 3], ['medcase', 1], ['medcrate', 1], ['duffle', 1], ['deadscav', 1]],
      },
      {
        id: 'gate5_annex', name: 'Gate 5 south annex',
        rect: [57, 100, 68, 126],
        surface: 'concrete',
        spawn: [['weaponbox', 1], ['crate', 1], ['grenadebox', 1], ['jacket', 1]],
      },
      {
        id: 'gate3_room', name: 'Gate 3 room',
        rect: [3, 14, 26, 24],
        surface: 'concrete',
        spawn: [['crate', 1], ['jacket', 1], ['toolbox', 1]],
      },
      {
        id: 'west_courtyard', name: 'West courtyard',
        rect: [0, 40, 15, 70],
        surface: 'asphalt',
        spawn: [['crate', 1], ['jacket', 1], ['duffle', 1], ['deadscav', 1]],
      },
      {
        id: 'west_service', name: 'West service rooms',
        rect: [15, 40, 34, 70],
        surface: 'tile',
        spawn: [['drawer', 2], ['filecab', 1], ['jacket', 2], ['safe', 1], ['pcblock', 1], ['medbag', 1]],
      },
      {
        id: 'west_storage', name: 'Finished-products area',
        rect: [3, 70, 34, 100],
        surface: 'concrete',
        spawn: [['crate', 3], ['techcrate', 1], ['toolbox', 2], ['weaponbox6', 1], ['sportbag', 2], ['jacket', 2]],
      },
      {
        id: 'gate0_corridor', name: 'Gate 0 corridor',
        rect: [5, 112, 15, 140],
        surface: 'concrete',
        spawn: [['crate', 1], ['jacket', 1], ['deadscav', 1]],
      },
      {
        id: 'south_rooms', name: 'South workshops',
        rect: [0, 100, 30, 128],
        surface: 'concrete',
        spawn: [['crate', 2], ['toolbox', 1], ['jacket', 2], ['ammobox', 1], ['banksafe', 1]],
      },
      {
        id: 'silo_pit', name: 'Silo pit',
        rect: [44, 52, 76, 94],
        surface: 'metal',
        spawn: [['crate', 2], ['toolbox', 2], ['grenadebox', 1], ['techcrate', 1], ['deadscav', 2], ['weaponbox', 1]],
      },
    ],
  },
};

export const DEFAULT_MAP = 'factory';
