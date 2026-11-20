// Nico's front yard and street corner, hand placed (track: keys, r2-keys). Target: docs/v2/plan/nico_house/0_front_deck_mockup.webp,
// seen from the west deck (MOCKUP_CAM below). HOUSE-LOCAL meters (same frame as plan.js): +X east of the plan, +Z toward the street,
// y = 0 at the yard grade. The house is turned 0.72 rad in its lot (nicoHouse.v2.js HOUSE_YAW), so the lot is a corner lot:
// Pelican Point Ln (east leg, edge 3210) runs along the front at z ~ 30 (asphalt edge z ~ 27.3 at x = -10, 28.4 at x = 0..8) into the
// STOP corner J at (-20.9, 23.8); the west leg (3215) leaves J along (-0.51, -0.86) down the lot's west side (asphalt edge x ~ -22.2
// at z = 15, -28 at z = 5); the north leg leaves J toward (-26.5, 32.5). Positions of the cars, bins, planter, poles, STOP, puddle
// and roll-off were unprojected from the mock-up through the fitted camera, then nudged off the asphalt. Every item is an explicit
// choice; nothing is scattered at random. Headings: 0 faces +Z, PI faces the house. Sizes in meters.

// the mock-up camera (fitted to the deck rail corner and the STOP corner; tools/v2/keys/spots_refs.json r0b_deck)
export const MOCKUP_CAM = { eye: [-8.39, 4.65, 1.34], look: [-16.29, -2.64, 18.21], fov: 56 }; // refit with the cars and the STOP corner as landmarks
export const JUNCTION = [-20.9, 23.8];

// ---- parked cars: the cars helper places them (src/vehicles/vehicles.js NICO_CARS); these spots document the mock-up and every
// prop below stays clear of them ----
export const CAR_SPOTS = [
  // front-door view (front_door_south_view_TARGET): the gray pickup in the dirt right below the front walkway, nose toward the deck and turned to camera-left
  {
    id: 'nico_pickup',
    kind: 'pickup',
    look: 'gray_lifted',
    x: -13.96,
    z: 2.02,
    heading: 1.734,
    locked: false,
    owner: 'nico',
  },
  // the orange coupe-utility in the small dirt spot beside it (right of the view)
  {
    id: 'nico_ute',
    kind: 'ute',
    look: 'yellow_orange',
    x: -19.07,
    z: -4.82,
    heading: 1.734,
    locked: false,
    owner: 'nico',
  },
  // a neighbor's dark pickup parked behind the lattice fence, left of the drive
  {
    id: 'dark_pickup',
    kind: 'pickup',
    look: 'black',
    x: -8.88,
    z: 11.32,
    heading: -2.002,
    locked: true,
    owner: 'neighbor',
  },
];

// ---- the driveway: from the drive mouth at the STOP corner past the pickup, with a branch to the carport bay under the house ----
// r7 (playtest Nov 18 eve, item 6; mock-up r4/01 roof view): the house is square to the street again, so the drive runs STRAIGHT out of
// the front of the house to the STOP corner (lot frame S: x ~ -5.8 .. -4.1 from the end of Pelican Point Ln at z ~ 28 to the pickup at z ~ 7.5),
// then bends under the front deck to the carport. Same yard frame G as everything here (converted from S with r4/plan4.js toG).
export const DRIVE = {
  // front-door view (front_door_south_view_TARGET): a short, matted, compacted dirt drive straight from under the
  // front walkway to the paved road (FRONT_ROAD), a spur to the under-house pad and a small pad for the ute beside the pickup
  main: [
    [-9.02, -1.61],
    [-12.9, 2.8],
    [-15.32, 8.31],
    [-16.87, 12.57],
    [-17.89, 14.97],
  ],
  branch: [
    [-9.02, -1.61],
    [-4.74, -0.73],
  ],
  halfWidth: 3.0,
  loop: [
    [-11.56, 0.68],
    [-15.09, -2.51],
    [-19.07, -4.82],
  ],
};

// ---- white lattice planter box between the deck and the drive (bougainvillea grows out of it, part 50) ----
// [ax, az, bx, bz] runs; height of the lattice, depth of the box
export const PLANTER = {
  library: true,
  // front-door view (front_door_south_view_TARGET): the short white lattice fence-planter with flowers runs along the
  // left edge of the drive and on along the lot edge to the road, so the neighbors on that side stay hidden
  runs: [
    [-11.77, 4.97, 3.83, 13.11],
    [3.83, 13.11, 2.3, 21.67],
  ],
  h: 0.78,
  depth: 0.85,
  plants: [],
};

// ---- bins: model piece of keys/bins.glb, heading (front: 0 = +Z), tint ----
export const BINS = [
  // front-door view (front_door_south_view_TARGET): the galvanized can and the blue carts at the drive end of the fence
  { x: -12.28, z: 4.53, can: 'galv', h: 0 },
  { x: -12.49, z: 5.38, piece: 'trashcan_blue', h: -1.854, tint: [1.0, 1.0, 1.05] },
  { x: -12.57, z: 6.18, piece: 'trashcan_blue', h: -1.671, tint: [0.88, 0.92, 1.0] },
];

// ---- STOP signs (user review shot_25): one per approach of J, each at its stop bar on the RIGHT of the approaching lane, 0.9 m off the
// pavement edge, plate facing the oncoming traffic. Computed from the road graph legs at J (house frame): east leg out of J along
// (0.763, 0.645), west leg (-0.508, -0.862), north leg (-0.541, 0.841); pos = J + leg * setback + right-of-travel * (3.25 + 0.9),
// face = leg direction. The street kit's regulatory STOPs (regulatory.v2.js) have none at this corner (no 'stop' control on 3210 / 3215).
// r7: Pelican Point Ln ends at the front of the lot (lot frame S x -6, z 28.9; there is no corner here any more): one STOP at the right
// of the drive mouth, its face toward the house, as in the roof-view mock-up (01)
export const STOPS = [];

// ---- wooden utility poles: [x, z, height, lean, crossarm yaw (square to the wires)]; wires: [poleA, poleB | WIRE_ENDS key], sag in m.
// Pole 0 is the corner pole of the mock-up (transformer, street lamp) and carries the house's service drop (part 40) ----
// every span ends at a pole (user review: no wire may end in mid-air); the outer poles (3-5) are dead-end poles on the street edges
export const POLES = [
  // front-door view (front_door_south_view_TARGET): poles on both sides of the road, the service pole by the walkway (3)
  [-12.25, 14.98, 9.6, 0.012, -2.05],
  [-7.87, 17.38, 9.4, -0.015, -2.05],
  [-27.51, 7.25, 9.6, 0.01, -2.05],
  [-3.33, 21.44, 9.6, -0.012, -2.05],
  [-18.81, 21.93, 9.4, 0.015, -2.05],
  [-33.8, 13.9, 9.6, -0.01, -2.05],
  [-45.75, 6.54, 9.2, 0.012, -2.05],
  [0.84, 28.58, 9.4, 0.01, -2.05],
];
export const WIRE_ENDS = {};
export const WIRES = [
  { a: 7, b: 3, n: 3, sag: 0.9 },
  { a: 1, b: 0, n: 3, sag: 1.0 },
  { a: 0, b: 2, n: 3, sag: 1.0 },
  { a: 4, b: 5, n: 3, sag: 1.1 },
  { a: 5, b: 6, n: 3, sag: 1.0 },
  { a: 0, b: 5, n: 2, sag: 0.8 },
  { a: 3, b: 1, n: 3, sag: 0.9 },
];
export const SERVICE_POLE = 0; // index into POLES: the service drop from the house mast lands here

// ---- the mailbox at the drive mouth (part 45), facing the west leg ----
export const MAILBOX = { x: -20.15, z: 11.09, h: 2.661 }; // at the drive mouth by the road

// ---- red roll-off at the street edge of the yard, along the west leg, behind the right-hand bins (mock-up: mid-frame right): a long,
// LOW 20-yard box (sy), rust-darkened ----
// r4-keys (user, Nov 18: "move it more to the side so there's room to drive out"; r4 ref 01_roof_view_yard_dumpster: off to the RIGHT of
// the drive against the bushes by the street, drive clear): slid 13 m down the west leg's verge toward the bay, past the classic. The pickup
// backs out along (-0.71, +0.70) into the drive mouth; the old spot (-22.0, 12.55) stood 1.3 m off the drive edge in that swing.
export const DUMPSTER = {
  // front-door view (front_door_south_view_TARGET): the red roll-off at the road corner right of the drive, half behind the big green trees
  x: -23.28,
  z: 8.44,
  heading: -2.051,
  scale: 0.62,
  sy: 1,
  tint: [0.96, 0.93, 0.9],
};

// ---- pale limestone / coral boulders: [x, z, piece (1..6 of keys/rocks.glb), scale, heading, sink] ----
export const ROCKS = [
  // front-door view (front_door_south_view_TARGET): the stones lining the right edge of the dirt
  [-17.4, 7.11, 1, 0.25, 0.0, 0.06],
  [-17.88, 6.3, 2, 0.285, 1.37, 0.06],
  [-18.4, 5.57, 3, 0.32, 2.74, 0.06],
  [-18.93, 4.85, 4, 0.268, 4.11, 0.06],
  [-19.5, 4.21, 5, 0.302, 5.48, 0.06],
  [-20.11, 3.66, 6, 0.25, 0.57, 0.06],
  [-20.78, 3.2, 1, 0.285, 1.94, 0.06],
  [-21.58, 3.01, 2, 0.32, 3.31, 0.06],
  [-22.38, 2.82, 3, 0.268, 4.68, 0.06],
  [-18.8, 2.43, 4, 0.302, 6.05, 0.06],
  [-19.65, 2.78, 5, 0.25, 1.14, 0.06],
  [-18.03, 2.27, 6, 0.285, 2.51, 0.06],
  [-23.81, -0.07, 1, 0.32, 3.88, 0.06],
  [-24.75, 0.45, 2, 0.268, 5.25, 0.06],
  [-18.04, 7.9, 3, 0.302, 0.34, 0.06],
  [-18.86, 8.6, 4, 0.25, 1.71, 0.06],
  [-23.64, 5.66, 5, 0.285, 3.08, 0.06],
];

// ---- clutter and debris (own models, part 55): kind, x, z, heading, extra ----
export const DEBRIS = [
  // front-door view (front_door_south_view_TARGET): only the old post lying in the grass right of the pickup
  { k: 'lumber', x: -18.56, z: -0.83, h: -2.343 },
  { k: 'husks', x: -4.69, z: 12.16, h: 0 },
  { k: 'tarp', x: -21.5, z: -6.0, h: 0.4 },
];

// ---- yard surface: puddles (fill with the weather's puddle level), tire tracks, leaf-litter / shell / matted-grass patches ----
// the drive-end puddle (user review): in the low spot where the drive meets the STOP corner; it fills after rain and dries out
export const CORNER_PUDDLE = { x: -15.66, z: 9.82, a: 1.1, b: 0.5, rot: -2.051 }; // the low spot at the drive mouth
// small sticks, twigs, palm-frond bits and bark scraps: [x, z, radius, count]
export const STICKS = [
  [-11.79, 8.46, 2.5, 14],
  [-15.22, -0.1, 2.5, 12],
  [-7.39, 13.0, 2.5, 14],
  [-19.73, 2.06, 3, 16],
  [-18.07, 9.69, 2.5, 10],
];
// [x, z, half length, half width, yaw]: small rut puddles (decals). The drive-end puddle is r2-ground's patchPuddles on the yard sheet
// itself over the sheet's low spot (DRIVE_PUDDLE; nicoHouse.v2.js): fills while it rains, shrinks back as the weather dries
export const DRIVE_PUDDLE = { x: -9.7, z: 1.42, r: 1.2 };
export const PUDDLES = [
  [-9.7, 1.42, 0.9, 0.45, -1.854],
  [-15.66, 9.82, 1.3, 0.55, -1.952],
  [-14.78, 5.54, 0.7, 0.3, -0.678],
];
export const TRACKS = [
  // polylines of the left / right tire, width 0.3 (soft, darker, slightly sunk)
  {
    pts: [
      [-9.02, -1.61],
      [-12.9, 2.8],
      [-15.32, 8.31],
      [-16.87, 12.57],
      [-17.52, 14.26],
    ],
    gauge: 1.7,
  },
];
export const LITTER = [
  // [x, z, radius, density 0..1, kind]: the front-door view
  [-15.64, -1.45, 3.0, 0.95, 'matted'],
  [-19.92, 0.27, 3.0, 0.95, 'matted'],
  [-20.06, -4.88, 3.0, 0.95, 'matted'],
  [-24.43, 2.43, 2.6, 0.95, 'matted'],
  [-17.87, 3.25, 2.0, 0.9, 'matted'],
  [-7.74, 1.99, 1.8, 0.9, 'matted'],
  [-13.2, -2.88, 2.2, 0.9, 'matted'],
  [-22.3, 5.91, 2.4, 0.9, 'matted'],
  [-8.76, 9.13, 2.4, 0.9, 'matted'],
  [-6.5, 13.47, 2.6, 0.9, 'matted'],
  [-1.82, 14.22, 2.6, 0.9, 'matted'],
  [-12.14, 13.46, 2.0, 0.85, 'matted'],
  [-24.78, -3.39, 3.0, 0.95, 'matted'],
  [-0.99, 18.03, 2.4, 0.9, 'matted'],
  [-15.72, 3.02, 2.4, 0.5, 'leaves'],
  [-7.85, 13.89, 2.5, 0.5, 'leaves'],
  [-24.7, 5.11, 2.5, 0.6, 'leaves'],
  [-13.17, 11.12, 2.2, 0.4, 'leaves'],
];

// ---- planting through the vegetation helper (game.vegetation.place when it exists, else game.vegetation.field) ----
// [kind, x, z, opts]: poincianas (red flowering), hibiscus / bougainvillea bushes, sea grape, palms, gumbo limbo. Seven kinds
// only: every kind is its own instanced vegetation field (LOD meshes + shadows), so new kinds cost draw calls
// r7b: the low north view from the drive (MAIN mock-up 14) sees the west deck over an open grassy island: the palm, bed and hibiscus
// that stood in that line are gone or moved
export const PLANTING = [
  ['seagrape', 0.5, 23.5, { s: 1.0 }],
  ['seagrape', 9.0, 4.0, { s: 1.0 }],
  ['coconut', 9.5, -4.0, { s: 0.95, lean: [-0.4, 0.6] }],
  ['tropical_leaf', 18.74, 15.2, { s: 1.4 }],
  ['coconut', 20.62, 24.45, { s: 1.05, lean: [0.2, 0.4], model: 'coconut_palm' }],
  ['green_shrub', 13.36, 28.14, { s: 1.3 }],
  ['seagrape', 30.79, 5.84, { s: 1.3 }],
  // front-door view (front_door_south_view_TARGET): the fence planting, palms along the lot edge,
  // the green mass round the roll-off, palms and red poincianas round the bungalow across the road
  ['bougainvillea_hd', -11.17, 5.34, { s: 1.3, ry: 0.0, yOff: 0.62 }],
  ['bougainvillea_hd', -9.84, 6.03, { s: 1.15, ry: 1.7, yOff: 0.62 }],
  ['bougainvillea_hd', -8.51, 6.72, { s: 1.0, ry: 3.4, yOff: 0.62 }],
  ['bougainvillea_hd', -7.09, 7.46, { s: 1.1, ry: 5.1, yOff: 0.62 }],
  ['bougainvillea_hd', -5.68, 8.2, { s: 0.95, ry: 6.8, yOff: 0.62 }],
  ['bougainvillea_hd', -4.26, 8.94, { s: 1.05, ry: 8.5, yOff: 0.62 }],
  ['bougainvillea_hd', -2.84, 9.68, { s: 0.95, ry: 10.2, yOff: 0.62 }],
  ['bougainvillea_hd', -1.42, 10.42, { s: 1.1, ry: 11.9, yOff: 0.62 }],
  ['bougainvillea_hd', -0.0, 11.16, { s: 1.0, ry: 13.6, yOff: 0.62 }],
  ['bougainvillea_hd', 1.42, 11.9, { s: 0.95, ry: 15.3, yOff: 0.62 }],
  ['bougainvillea_hd', 2.84, 12.64, { s: 1.05, ry: 17.0, yOff: 0.62 }],
  ['bougainvillea_hd', 3.65, 14.13, { s: 0.95, ry: 0.0, yOff: 0.62 }],
  ['bougainvillea_hd', 3.37, 15.67, { s: 1.05, ry: 2.1, yOff: 0.62 }],
  ['bougainvillea_hd', 3.1, 17.22, { s: 0.9, ry: 4.2, yOff: 0.62 }],
  ['bougainvillea_hd', 2.82, 18.76, { s: 1.0, ry: 6.3, yOff: 0.62 }],
  ['bougainvillea_hd', 2.55, 20.3, { s: 1.1, ry: 8.4, yOff: 0.62 }],
  ['hibiscus', -11.04, 6.81, { s: 1.45, model: 'hibiscus_hd' }],
  ['hibiscus', -9.85, 7.77, { s: 1.15, model: 'hibiscus_hd' }],
  ['coconut', 5.64, 14.84, { s: 1.15, lean: [0.2, 0.3], model: 'coconut_palm' }],
  ['coconut', 5.39, 18.77, { s: 1.05, lean: [0.2, 0.3], model: 'coconut_palm' }],
  ['coconut', 3.28, 21.95, { s: 1.1, lean: [0.2, 0.3], model: 'coconut_palm' }],
  ['coconut', -1.21, 12.39, { s: 1.2, lean: [0.2, 0.3], model: 'coconut_palm' }],
  ['coconut', 0.89, 15.29, { s: 1.1, lean: [0.2, 0.3], model: 'coconut_palm' }],
  ['coconut', -3.86, 10.56, { s: 1.25, lean: [0.2, 0.3], model: 'coconut_palm' }],
  ['coconut', -0.78, 24.12, { s: 1.0, lean: [0.2, 0.3], model: 'coconut_palm' }],
  ['coconut', 9.57, 15.08, { s: 1.0, lean: [0.2, 0.3], model: 'coconut_palm' }],
  ['coconut', -3.92, 14.14, { s: 1.3, lean: [0.2, 0.3], model: 'coconut_palm' }],
  ['coconut', -2.73, 17.47, { s: 1.2, lean: [0.2, 0.3], model: 'coconut_palm' }],
  ['coconut', -0.54, 20.63, { s: 1.1, lean: [0.2, 0.3], model: 'coconut_palm' }],
  ['tropical_leaf', 4.1, 16.06, { s: 1.8 }],
  ['tropical_leaf', 3.32, 19.72, { s: 1.8 }],
  ['tropical_leaf', -2.88, 10.84, { s: 1.8 }],
  ['tropical_leaf', 0.57, 12.87, { s: 1.8 }],
  ['green_shrub', 6.76, 17.45, { s: 2.0 }],
  ['green_shrub', 4.99, 21.27, { s: 2.0 }],
  ['green_shrub', -25.59, 5.09, { s: 2.2 }],
  ['green_shrub', -26.27, 2.48, { s: 2.2 }],
  ['green_shrub', -27.33, 7.12, { s: 2.0 }],
  ['green_shrub', -29.34, 4.49, { s: 2.2 }],
  ['green_shrub', -23.34, 3.79, { s: 1.6 }],
  ['green_shrub', -9.93, 30.85, { s: 2.0 }],
  ['green_shrub', -6.63, 34.26, { s: 2.0 }],
  ['green_shrub', -2.18, 35.46, { s: 2.0 }],
  ['seagrape', -27.11, -0.66, { s: 1.4 }],
  ['seagrape', -30.56, 2.5, { s: 1.3 }],
  ['gumbo', -28.74, 0.74, { s: 1.2, seed: 5 }],
  ['rubber_fig', -28.74, 5.93, { s: 1.0 }],
  ['coconut', -11.47, 29.48, { s: 1.1, lean: [0.2, 0.4], model: 'coconut_palm' }],
  ['coconut', -22.52, 24.29, { s: 1.05, lean: [0.2, 0.4], model: 'coconut_palm' }],
  ['coconut', -29.4, 31.41, { s: 1.1, lean: [0.2, 0.4], model: 'coconut_palm' }],
  ['coconut', -11.61, 37.31, { s: 1.0, lean: [0.2, 0.4], model: 'coconut_palm' }],
  ['coconut', -31.04, 22.66, { s: 1.0, lean: [0.2, 0.4], model: 'coconut_palm' }],
  ['coconut', -3.72, 34.09, { s: 1.1, lean: [0.2, 0.4], model: 'coconut_palm' }],
  ['coconut', -38.96, 15.15, { s: 1.0, lean: [0.2, 0.4], model: 'coconut_palm' }],
  ['coconut', -9.97, 33.09, { s: 1.15, lean: [0.2, 0.4], model: 'coconut_palm' }],
  ['coconut', -7.81, 37.6, { s: 1.1, lean: [0.2, 0.4], model: 'coconut_palm' }],
  ['coconut', -15.58, 34.11, { s: 1.05, lean: [0.2, 0.4], model: 'coconut_palm' }],
  ['coconut', -1.56, 38.6, { s: 1.1, lean: [0.2, 0.4], model: 'coconut_palm' }],
  ['poinciana', -28.53, 33.0, { s: 1.15, seed: 7, model: 'poinciana_hd1' }],
  ['poinciana', -35.76, 24.15, { s: 1.1, seed: 3, model: 'poinciana_hd1' }],
  ['poinciana', -11.47, 42.45, { s: 1.0, seed: 6, model: 'poinciana_hd1' }],
  ['poinciana', -35.02, 33.56, { s: 1.0, seed: 6, model: 'poinciana_hd1' }],
];

// ---- weed clumps (part 05 weeds): [x, z, radius, count, size] where weeds really grow: around rocks, posts, bins, the planter
// foot, the drive's middle strip between the ruts, and the lot edges (the rest of the yard is trodden bare)
export const WEEDS = [
  // front-door view (front_door_south_view_TARGET):
  [-8.35, 6.19, 1.2, 40, 1.1],
  [-3.91, 8.5, 1.2, 40, 1.1],
  [0.52, 10.81, 1.2, 36, 1.1],
  [3.18, 17.39, 1.2, 36, 1.1],
  [-17.22, 7.2, 1.0, 30, 1.1],
  [-19.51, 4.88, 1.2, 36, 1.2],
  [-21.98, 3.14, 1.2, 36, 1.2],
  [-12.07, 14.62, 0.5, 20, 1.1],
  [-7.68, 17.02, 0.5, 18, 1.0],
  [-27.32, 6.89, 0.5, 18, 1.0],
  [-17.21, 1.12, 1.5, 40, 1.2],
  [-19.67, -1.29, 1.8, 50, 1.2],
  [-9.2, 14.31, 1.4, 40, 1.2],
  [-3.42, 16.2, 1.8, 40, 1.1],
  [-14.04, -3.44, 1.5, 30, 1.1],
];

// ---- front-door view (docs/v2/plan/nico_house/front_door_south_view_TARGET.webp, tools/v2/keys/frontdoor) ----
// The paved road straight across the front of the lot: from the turning circle at the canal end (world road graph dead end) round
// the canal's end, straight across the front, on to the street to the west; a short spur joins the dead end of Pelican Point Ln.
// Built by part r14_57_frontroad (asphalt, yellow center lines, a puddle); the yard sheet sinks under it like under any asphalt.
export const FRONT_ROAD = {
  // [x, z] polylines; lines: false = no center lines (the spur into Pelican Point Ln)
  paths: [
    {
      pts: [
        [10.07, 37.59],
        [3.59, 35.2],
        [-0.29, 31.82],
        [-3.24, 26.67],
        [-6.93, 22.94],
        [-13.93, 19.06],
        [-22.96, 14.3],
        [-29.85, 10.65],
        [-43.67, 2.55],
        [-56.64, -5.01],
        [-65.02, -9.72],
      ],
      lines: true,
      gap: [-22.96, 14.3],
      gapR: 7.5,
    },
    {
      pts: [
        [-22.98, 14.35],
        [-26.61, 21.21],
      ],
      lines: false,
    },
  ],
  halfWidth: 3.25,
  puddle: { x: -15.94, z: 18.58, a: 2.2, b: 0.9, rot: -2.002 },
};
// boats on trailers: one at the right edge of the view on the grass, one in the yard across the road behind the roll-off
export const BOATS = [
  { x: -23.47, z: 1.46, heading: -0.332, len: 5.6 },
  { x: -32.86, z: 16.86, heading: 1.04, len: 6.2 },
];
// the reference camera (camera frame of tools/v2/keys/frontdoor/shot.mjs view 'door'): house frame B eye, compass heading
export const FRONT_DOOR_CAM = { eye: [-7.5, 2.6, -9.2], hdg: 141.5, pitch: -26, fov: 58 };
