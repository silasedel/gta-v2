// Countryside vegetation (synthetic land outside real Miami: the Keys, pine rockland, hammocks, glades, rural verges).
// One camera-centred streamer replaces the per-tile flora draw (which appeared / vanished with the 350 m near-tile ring and
// cut small plants at a hard 140 m): plants live in 64 m world cells generated deterministically from the terrain, and every
// plant class has overlapping LOD bands with dithered cross-fades (full mesh -> simplified mesh -> baked impostor -> gone),
// so nothing pops while driving. Ground cover (grass tufts, wildflowers, rocks, shoulder pebbles) sits on the terrain normal
// within ~70 m and dissolves out by distance.
//   placeTrees(ctx, x0, z0, S, emit)   deterministic tree / palm placement (also used by flora.scatter for the tile colliders)
//   createCountryside({ renderer, scene, terrain, data, roadDist }) -> { update(camera), stats(), group, dispose() }
//   csReject(x, z)                      a tile found a building / set piece on a placed tree: hide it
import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GB, rng, UP } from './geom.js';
import { CELL } from './textures.js';
import { cluster, cellRect, groundCard } from './plantkit.js';
import { buildGeometry } from './index.js';
import { makeVegMaterial, VEG_R2 } from './materials.js';
import { bakeImpostor } from './field.js';
import { lots as houseLots } from '../setpieces/houses/lots.js';
import { grassCardMap, clumpCard, stripCard, bladeCards } from './grasscards.js';
import { gmVeg } from '../ground/surfaceMask.js';
import { meshGround, triAt, MESH_GND } from './ground.js';

// ground pass: close-up grass from the user's photographed grass cards (?gcards=0: the procedural blade tufts)
const GCARDS = typeof location === 'undefined' || !/[?&]gcards=0\b/.test(location.search);

const V3 = THREE.Vector3;
export const CS_ON = typeof location === 'undefined' || !/[?&]veg2=0\b/.test(location.search);

// ---------------- deterministic noise / hashing ----------------
const hh = (i, j, k = 0) => {
  let h = Math.imul(
    (i | 0) ^ Math.imul(j | 0, 0x27d4eb2d) ^ Math.imul(k + 1, 0x165667b1),
    0x9e3779b1,
  );
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca77);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae3d);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
};
function vn(x, z) {
  const ix = Math.floor(x),
    iz = Math.floor(z);
  let fx = x - ix,
    fz = z - iz;
  fx = fx * fx * (3 - 2 * fx);
  fz = fz * fz * (3 - 2 * fz);
  const a = hh(ix, iz, 91),
    b = hh(ix + 1, iz, 91),
    c = hh(ix, iz + 1, 91),
    d = hh(ix + 1, iz + 1, 91);
  return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
}
// (r2-veg) the Keys weed-patch mask (0..1), shared with r2-ground's grass layer so both cluster in the same places
export const weedPatch = (x, z) =>
  sstep(0.5, 0.74, vn(x / 5.5 + 3.3, z / 5.5 - 1.1) * 0.75 + vn(x / 1.8 + 7.1, z / 1.8) * 0.25);
const sstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const groveN = (x, z) =>
  sstep(0.3, 0.72, vn(x / 95 + 3.1, z / 95 - 7.7) * 0.62 + vn(x / 27, z / 27 + 5.3) * 0.38); // groves + clearings
const patchN = (x, z, k) =>
  vn(x / 14 + k * 17.1, z / 14 - k * 3.7) * 0.7 + vn(x / 4.5 + k, z / 4.5) * 0.3;

// ---------------- biomes ----------------
// tree: max acceptance on the 8 m candidate grid inside groves; shrub: on the 3 m grid; grass: on the 1.1 m grid
const BIOMES = {
  // Keys neighborhoods (user mock-up): red-flowering poincianas, bougainvillea / hibiscus along the yard frontages, palms; yards are sandy,
  // matted-down grass with leaf litter, not lush lawn (matted: flattened short tufts, sparse; yard: flowering shrub band 2.5-10 m off the street)
  keys: {
    road: 0.55,
    tree: 0.8,
    clump: 1,
    underN: 4,
    trees: [
      ['gumbo', 2.6],
      ['buttonwood', 2.2],
      ['sabal', 1.3],
      ['coconut', 2.4],
      ['coconutM', 1.8],
      ['seagrapeT', 2.6],
      ['poinciana', 0.45],
      ['queen', 0.5],
      ['fan', 0.5],
      ['rubber', 0.6],
    ],
    shrub: 0.22,
    shrubs: [
      ['seagrape', 3],
      ['sawpalmetto', 1.4],
      ['fern', 0.6],
      ['hibiscus', 0.25],
      ['bougainvillea', 0.25],
      ['agave', 0.4],
      ['redgrass', 0.3],
    ],
    yard: [
      ['bougainvillea', 3],
      ['geranium', 1],
      ['hibiscus', 3],
      ['seagrape', 1],
      ['hedge', 1.5],
      ['oleander', 1],
      ['agave', 0.6],
      ['fanSmall', 0.9],
    ],
    under: [
      ['fernM', 2],
      ['sawpalmetto', 1.6],
      ['seagrape', 1.5],
      ['fern', 1],
      ['hibiscus', 0.6],
      ['fanSmall', 0.5],
    ],
    base: [
      ['tuft', 2],
      ['fern', 1.5],
    ],
    matted: 1,
    litter: 0.05,
    grass: 0.62,
    dry: 0.45,
    flower: 0.07,
    rock: 0.012,
    hue: [0.98, 1.02, 0.8],
  },
  keysSand: {
    tree: 0.5,
    clump: 1,
    trees: [
      ['coconut', 2.5],
      ['coconutM', 2],
      ['sabal', 1],
      ['seagrapeT', 3.5],
      ['gumbo', 1],
      ['buttonwood', 1.5],
      ['poinciana', 0.2],
    ],
    shrub: 0.22,
    shrubs: [
      ['seagrape', 3],
      ['agave', 0.6],
      ['redgrass', 0.5],
    ],
    under: [['seagrape', 2]],
    base: [['tuft', 2]],
    yard: [
      ['bougainvillea', 2],
      ['hibiscus', 2],
      ['seagrape', 2],
    ],
    matted: 1,
    litter: 0.03,
    grass: 0.5,
    dry: 0.65,
    flower: 0.02,
    rock: 0,
    hue: [1.08, 1.0, 0.7],
  },
  pine: {
    road: 0.3,
    tree: 0.4,
    trees: [
      ['slashpine', 8],
      ['sabal', 1],
      ['liveoak', 0.5],
    ],
    shrub: 0.34,
    shrubs: [
      ['sawpalmetto', 5],
      ['fern', 0.6],
      ['fernM', 0.8],
    ],
    under: [
      ['sawpalmetto', 3],
      ['fern', 1],
    ],
    base: [
      ['tuft', 2],
      ['fern', 1],
    ],
    grass: 0.62,
    dry: 0.3,
    flower: 0.05,
    rock: 0.04,
    hue: [1.0, 1.0, 0.82],
  },
  hammock: {
    road: 0.35,
    tree: 0.72,
    trees: [
      ['liveoak', 4],
      ['gumbo', 3],
      ['sabal', 2],
      ['banyan', 0.25],
    ],
    shrub: 0.45,
    shrubs: [
      ['fern', 1.6],
      ['fernM', 2],
      ['seagrape', 1],
      ['sawpalmetto', 1],
    ],
    under: [
      ['fern', 3],
      ['fernM', 2],
      ['seagrape', 1],
    ],
    underN: 3.5,
    base: [
      ['fern', 2],
      ['tuft', 1],
      ['moss', 1.5],
    ],
    grass: 0.38,
    dry: 0.08,
    flower: 0.01,
    rock: 0.012,
    hue: [0.92, 1.0, 0.86],
  },
  rural: {
    road: 0.6,
    tree: 0.5,
    clump: 1,
    trees: [
      ['liveoak', 4],
      ['gumbo', 2],
      ['liveoak', 1.2],
      ['sabal', 1.6],
      ['slashpine', 0.8],
      ['banyan', 0.15],
    ],
    /* ref_57: continuous broadleaf lines along the roads */ shrub: 0.16,
    shrubs: [
      ['sawpalmetto', 2],
      ['seagrape', 1],
      ['fern', 0.4],
      ['hedge', 0.4],
    ],
    under: [
      ['seagrape', 1],
      ['fern', 1],
      ['sawpalmetto', 1],
    ],
    base: [
      ['tuft', 3],
      ['geranium', 0.5],
    ],
    grass: 0.95,
    dry: 0.16,
    flower: 0.1,
    rock: 0.016,
    hue: [1.04, 1.08, 0.8],
  },
  glade: {
    tree: 0.14,
    dome: 1,
    reed: 0.55,
    trees: [
      ['sabal', 2.4],
      ['liveoak', 1.8],
      ['cypress', 0.7],
    ],
    /* (everglades r7: the cypress domes are src/world/everglades/cypress.js; tree islands here are hammocks of oak and cabbage palm) */ shrub: 0.06,
    shrubs: [
      ['sawpalmetto', 1],
      ['reeds', 0.8],
    ],
    grass: 0.95,
    tall: 0.75,
    dry: 0.5,
    flower: 0.025,
    rock: 0,
    hue: [1.06, 1.0, 0.76],
  },
  marsh: {
    tree: 0.07,
    reed: 0.6,
    trees: [['mangrove', 1]],
    shrub: 0,
    shrubs: [],
    grass: 0.85,
    tall: 1,
    dry: 0.25,
    flower: 0,
    rock: 0,
    hue: [0.95, 1.0, 0.8],
  },
  // inland freshwater swamp (wetland away from the coast): cypress domes and strands, cabbage palms, ferns, tall sawgrass; no mangroves
  swamp: {
    tree: 0.42,
    dome: 1,
    reed: 0.45,
    trees: [
      ['sabal', 2.2],
      ['cypress', 1.6],
      ['liveoak', 1.4],
      ['gumbo', 0.5],
    ],
    shrub: 0.24,
    shrubs: [
      ['fernM', 2],
      ['fern', 1.4],
      ['sawpalmetto', 1],
    ],
    under: [
      ['fern', 2],
      ['fernM', 1],
    ],
    base: [
      ['fern', 1],
      ['tuft', 1],
      ['moss', 1.2],
    ],
    grass: 0.95,
    tall: 0.9,
    dry: 0.3,
    flower: 0.01,
    rock: 0,
    hue: [1.0, 1.0, 0.78],
  },
  mangrove: {
    tree: 0.75,
    reed: 0.35,
    trees: [['mangrove', 1]],
    shrub: 0,
    shrubs: [],
    grass: 0.15,
    tall: 0.5,
    dry: 0.1,
    flower: 0,
    rock: 0,
    hue: [0.95, 1.0, 0.85],
  },
  // (vegetation, overnight) city lawns / parks on the synthetic map (the lawn layer outside house lots): shade-tree and palm groves
  // with clearings, roadside rows along the streets; the lawn grass itself is the ground pass's (no grass tufts here)
  park: {
    road: 0.45,
    tree: 0.5,
    clump: 1,
    underN: 2.5,
    trees: [
      ['liveoak', 3],
      ['gumbo', 2],
      ['royal', 1.2],
      ['sabal', 1.2],
      ['poinciana', 1],
      ['banyan', 0.4],
      ['queen', 0.6],
      ['fan', 0.8],
    ],
    shrub: 0.06,
    shrubs: [
      ['hedge', 2],
      ['hibiscus', 1],
      ['bougainvillea', 1],
      ['fernM', 0.5],
      ['fanSmall', 0.8],
    ],
    under: [
      ['fernM', 1.4],
      ['hedge', 1],
      ['fern', 1],
      ['sawpalmetto', 0.6],
      ['fanSmall', 0.6],
    ],
    base: [
      ['tuft', 1],
      ['geranium', 0.4],
      ['fern', 0.6],
    ],
    grass: 0,
    dry: 0,
    flower: 0,
    rock: 0,
    hue: [1.0, 1.0, 0.86],
  },
  parkBeach: {
    road: 0.3,
    tree: 0.28,
    trees: [
      ['coconut', 3],
      ['coconutM', 2],
      ['sabal', 1],
      ['seagrapeT', 1.5],
      ['royal', 0.5],
    ],
    shrub: 0.05,
    shrubs: [
      ['seagrape', 2],
      ['agave', 0.5],
      ['redgrass', 0.5],
    ],
    base: [['tuft', 1]],
    grass: 0,
    dry: 0,
    flower: 0,
    rock: 0,
    hue: [1.02, 1.0, 0.82],
  },
};
const BKEYS = Object.keys(BIOMES),
  BIDX = Object.fromEntries(BKEYS.map((k, i) => [k, i + 1]));
// tree kind -> geometry recipe, collider species for the tile props, palm flag
const TREE_KINDS = {
  // vegetation track (overnight): every kind draws the user's library models (models.js / species.js); several models per kind,
  // picked per tree, plus per-instance mirror / twist / bend / crown spread / color jitter in the shader. fb: procedural fallback
  liveoak: {
    models: ['liveoak_b', 'liveoak_c', 'oak_gnarled'],
    fb: 'liveoak',
    sp: 'oak',
    s: [0.85, 1.15],
  },
  buttonwood: { models: ['oak_pale_a', 'oak_gnarled'], fb: 'liveoak', sp: 'oak', s: [0.7, 0.95] },
  oakflat: { models: ['oak_flat'], fb: 'liveoak', sp: 'oak', s: [0.85, 1.15] }, // Oak Tree 2 (flat-card oak): rural roadside rows
  gumbo: {
    models: ['shade_tree', 'oak_pale_b', 'oak_pale_a'],
    fb: 'gumbo',
    sp: 'gumbo',
    s: [0.8, 1.12],
  },
  slashpine: {
    models: ['pine_a', 'pine_b', 'pine_c'],
    fb: 'slashpine',
    sp: 'pine',
    s: [0.85, 1.15],
  },
  cypress: { models: ['cypress_a', 'cypress_b'], fb: 'cypress', sp: 'cypress', s: [0.7, 1.1] }, // library pines regraded to bald-cypress green
  mangrove: { models: ['mangrove'], w: [1], fb: 'mangrove', sp: 'mangrove', s: [0.7, 1.25] }, // + Mangrove Tree 2 with its stilt roots kept (bark budget 36k) // stilt-root red mangrove (shader variation per trunk)
  sabal: {
    models: ['sabal_palm', 'weathered_b', 'weathered_a'],
    w: [5, 0.6, 0.4],
    /* r2: dry-frond palms 10-20 % (r2-art) */ fb: 'sabal',
    palm: 1,
    s: [0.8, 1.12],
  }, // w: model weights (the dark weathered palm stays rare)
  coconut: {
    models: ['coconut_palm', 'coconut_b', 'coconut_c', 'coconut_d'],
    fb: 'coconut',
    palm: 1,
    s: [0.85, 1.15],
  },
  seagrapeT: {
    models: ['rubber_fig'],
    fb: 'seagrape',
    sp: 'seagrape',
    s: [0.55, 0.9],
    shrubLike: 1,
  }, // the mid layer: a 2.3-3.8 m broadleaf (sea grape stand-in; the low-poly bushes scaled up read blocky)
  poinciana: {
    models: ['poinciana_hd1', 'poinciana_hd2', 'poinciana_hd3'],
    fb: 'poinciana',
    sp: 'oak',
    s: [0.6, 0.82],
  },
  coconutM: {
    models: ['bent_a', 'bent_b', 'bent_c', 'bent_d', 'bent_e'],
    fb: 'coconut',
    palm: 1,
    s: [0.85, 1.2],
  },
  banyan: { models: ['banyan', 'banyan_b'], fb: 'liveoak', sp: 'oak', s: [0.85, 1.1], wide: 1 },
  royal: { models: ['royal_palm'], fb: 'royal', palm: 1, s: [0.88, 1.12] },
  rubber: { models: ['rubber_fig'], fb: 'gumbo', sp: 'oak', s: [0.9, 1.35] },
  queen: {
    models: ['tropical_palm', 'fanpalm_cal2'],
    w: [3, 1],
    fb: 'queen',
    palm: 1,
    s: [0.85, 1.15],
  },
  fan: {
    models: ['fanpalm_rob1', 'fanpalm_rob2', 'fanpalm_cal1', 'fanpalm_cal2'],
    fb: 'queen',
    palm: 1,
    s: [0.8, 1.2],
  }, // Palm Tree 10: Washingtonia (Mexican fan palm)
};
for (const K of Object.values(TREE_KINDS)) if (K.models) K.seeds = K.models.map(() => [1, 1]);
const SHRUB_KINDS = {
  seagrape: {
    models: ['green_shrub', 'tropical_leaf'],
    kind: 'seagrape',
    seeds: [
      [1, 0.6],
      [6, 0.75],
    ],
  },
  sawpalmetto: {
    models: ['tropical_bed', 'fern_clump'],
    kind: 'sawpalmetto',
    seeds: [
      [1, 0.8],
      [4, 1],
    ],
  } /* r2: library plants (volume look), was procedural cards */,
  fern: {
    models: ['fern_a', 'fern_b', 'fern_c'],
    custom: 'fern',
    seeds: [
      [1, 1],
      [2, 1],
    ],
  },
  fernM: { models: ['fern_clump', 'tropical_bed'], seeds: [[1, 1]] },
  hibiscus: {
    models: ['hibiscus_hd', 'hibiscus_shrub'],
    kind: 'hibiscus',
    seeds: [
      [2, 0.8],
      [7, 1],
    ],
  },
  bougainvillea: {
    models: ['bougainvillea_hd', 'hibiscus_shrub'],
    kind: 'bougainvillea',
    seeds: [
      [1, 0.8],
      [9, 1],
    ],
  },
  geranium: { models: ['geranium'], custom: 'fern', seeds: [[1, 1]] },
  hedge: { models: ['green_shrub', 'tropical_leaf'], kind: 'hedge', seeds: [[3, 0.8]] },
  oleander: { models: ['oleander'], kind: 'hibiscus', seeds: [[3, 1]] },
  agave: { models: ['agave'], kind: 'croton', seeds: [[1, 1]] },
  redgrass: { models: ['red_grass'], kind: 'croton', seeds: [[1, 1]] },
  tuft: { models: ['grass_tuft_a', 'grass_tuft_b'], custom: 'fern', seeds: [[1, 1]] },
  moss: { models: ['moss_clump'], custom: 'fern', seeds: [[1, 1]] },
  fanSmall: { models: ['fanpalm_med1', 'fanpalm_med2'], kind: 'sawpalmetto', seeds: [[1, 1]] },
  reeds: { models: ['cattail', 'reed_a', 'reed_b'], kind: 'sawgrass', seeds: [[1, 1]] },
};
for (const K of Object.values(SHRUB_KINDS)) if (K.models) K.seeds = K.models.map(() => [1, 1]);

const RUNWAYS = [
  [
    [-2057, 528],
    [-792, 572],
  ],
  [
    [-2002, 924],
    [-825, 1683],
  ],
]; // Miami International centerlines (tools/v2/map3/out/world/layout.json airport.runways)
function biomeOf(ctx, x, z) {
  const { terrain: T, data: D } = ctx;
  if (T.real(x, z) || D.isWater(x, z)) return 0;
  const cov = D.coverAt ? D.coverAt(x, z) : '';
  if (/apron|runway|taxiway|parking|paved|plaza/.test(cov || '')) return 0; // hard ground (airport, lots, plazas)
  if (D.zoneAt && D.zoneAt(x, z) === 'airport') {
    // airport: no trees in the runway strips or on the field; landscaping strips along the terminal roads only
    for (const [[ax, az], [bx, bz]] of RUNWAYS) {
      const dx = bx - ax,
        dz = bz - az,
        t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
      if (Math.hypot(ax + dx * t - x, az + dz * t - z) < 320) return 0;
    }
    const rd = ctx.roadDist ? ctx.roadDist(x, z) : 99;
    return rd > 3 && rd < 18 ? BIDX.park : 0;
  }
  const L = T.LI,
    lay = T.layerAt(x, z),
    keys = T.isKeys(x, z);
  if (
    !keys &&
    D.zoneAt &&
    D.zoneAt(x, z) === 'beach' &&
    (lay !== L.lawn ||
      D.isWater(x + 30, z) ||
      D.isWater(x - 30, z) ||
      D.isWater(x, z + 30) ||
      D.isWater(x, z - 30))
  )
    return 0; /* (r2-veg, QA 13) city beaches: open sand and the grass strip by the surf stay bare (lone ball bush, grass cards on South Beach); park lawns behind the dune keep their palms */
  if (
    lay === L.base ||
    lay === L.gravel ||
    lay === L.farm ||
    lay === L.grove ||
    lay === L.dirt ||
    lay === L.rock ||
    lay === L.damp
  )
    return 0;
  const shore =
    D.isWater(x + 7, z) || D.isWater(x - 7, z) || D.isWater(x, z + 7) || D.isWater(x, z - 7);
  if (
    shore &&
    (z > 0 || keys) &&
    (lay === L.marsh ||
      ((keys || (D.zoneAt && D.zoneAt(x, z) === 'wilderness')) &&
        vn(x / 33, z / 33) > 0.45 &&
        lay !== L.sand))
  )
    return BIDX.mangrove; // salt shores only
  if (lay === L.sawgrass) return BIDX.glade;
  if (lay === L.marsh)
    return keys ||
      D.isWater(x + 45, z) ||
      D.isWater(x - 45, z) ||
      D.isWater(x, z + 45) ||
      D.isWater(x, z - 45)
      ? BIDX.marsh
      : BIDX.swamp; // salt marsh by open water, freshwater swamp inland
  if (lay === L.forest) return BIDX.hammock;
  if (lay === L.pine) return BIDX.pine;
  if (keys)
    return lay === L.sand
      ? shore
        ? 0
        : BIDX.keysSand
      : lay === L.scrub || lay === L.meadow || lay === L.lawn || lay === L.shell
        ? BIDX.keys
        : 0;
  if (lay === L.scrub || lay === L.meadow)
    return D.zoneAt && D.zoneAt(x, z) === 'wilderness' ? BIDX.glade : BIDX.rural;
  if (lay === L.lawn) {
    const zn = (D.zoneAt && D.zoneAt(x, z)) || '';
    return /beach|nightlife/.test(zn)
      ? BIDX.parkBeach
      : /rural|wilderness/.test(zn)
        ? BIDX.rural
        : BIDX.park;
  } // city lawns and parks // wilderness open land: sawgrass prairie with cypress domes / tree islands
  return 0;
}
// (r2-veg, item 12) each palm where it fits: royal palms only in rows along avenues / park roads, coconut and bent coconut only
// near open or salt water (beach, bay, Keys), sabal inland, queen / fan in the city's residential lawns
const coastC = new Map();
function coastal(ctx, x, z) {
  const D = ctx.data,
    k = Math.floor(x / 50) + ',' + Math.floor(z / 50);
  let v = coastC.get(k);
  if (v !== undefined) return v;
  v = false;
  const cx = (Math.floor(x / 50) + 0.5) * 50,
    cz = (Math.floor(z / 50) + 0.5) * 50;
  for (const d of [60, 140, 240]) {
    let n = 0;
    for (let a = 0; a < 8; a++)
      if (D.isWater(cx + Math.cos(a * 0.785) * d, cz + Math.sin(a * 0.785) * d)) n++;
    if (n >= (d < 100 ? 1 : 2)) {
      v = true;
      break;
    }
  }
  if (coastC.size > 20000) coastC.clear();
  coastC.set(k, v);
  return v;
}
function palmFit(ctx, name, x, z, rd, r) {
  if (
    name === 'royal' &&
    (rd > 16 || /residential/.test((ctx.data.zoneAt && ctx.data.zoneAt(x, z)) || ''))
  )
    name = coastal(ctx, x, z) ? 'coconut' : 'sabal'; // residential streets are not avenues
  if (
    (name === 'coconut' || name === 'coconutM') &&
    !ctx.terrain.isKeys(x, z) &&
    !coastal(ctx, x, z)
  ) {
    const zn = (ctx.data.zoneAt && ctx.data.zoneAt(x, z)) || '';
    name = /residential|nightlife|midtown/.test(zn)
      ? r < 0.4
        ? 'queen'
        : r < 0.7
          ? 'fan'
          : 'sabal'
      : 'sabal';
  }
  return name;
}
// (r2-veg) Keys / suburb distribution: dense masses along the street edge and the lot lines (fences), overgrown corners, open
// ground only in clearings; a sharp ~20 m clump noise on top of the groves (no even spacing)
function clumpK(ctx, x, z, g) {
  const n = sstep(
      0.42,
      0.66,
      vn(x / 19 + 4.4, z / 19 - 2.2) * 0.7 + vn(x / 6.5, z / 6.5 + 1.7) * 0.3,
    ),
    rd = ctx.roadDist ? ctx.roadDist(x, z) : 99;
  let edge = rd > 3.5 && rd < 10 ? 0.55 : 0;
  if (!edge)
    for (const [dx, dz] of [
      [3, 0],
      [-3, 0],
      [0, 3],
      [0, -3],
    ])
      if (inLot(x + dx, z + dz)) {
        edge = 0.45;
        break;
      } // street edge / just outside a lot line
  return Math.min(1.15, 0.08 + 0.75 * n + 0.35 * g + edge);
}
const pickIdx = (w, r) => {
  let t = 0;
  for (const x of w) t += x;
  let a = r * t;
  for (let i = 0; i < w.length; i++) {
    a -= w[i];
    if (a <= 0) return i;
  }
  return w.length - 1;
};
const pick = (list, r) => {
  let t = 0;
  for (const [, w] of list) t += w;
  let a = r * t;
  for (const e of list) {
    a -= e[1];
    if (a <= 0) return e[0];
  }
  return list[list.length - 1][0];
};

// ---------------- tree placement (shared with flora.scatter so the tile colliders match the drawn trees) ----------------
const TSTEP = 8;
let BLOCKED = null,
  AREAS = null; // (x, z, r) -> true where nothing may grow (docks, piers, set-piece pads): game.vegetation.block()
export function placeTrees(ctx, x0, z0, S, emit) {
  if (!ctx.blocked && BLOCKED) ctx = { ...ctx, blocked: BLOCKED };
  for (let j = Math.ceil(z0 / TSTEP); j * TSTEP < z0 + S; j++)
    for (let i = Math.ceil(x0 / TSTEP); i * TSTEP < x0 + S; i++) {
      const p = hh(i, j, 3),
        x = (i + 0.22 + hh(i, j, 1) * 0.56) * TSTEP,
        z = (j + 0.22 + hh(i, j, 2) * 0.56) * TSTEP; // trunks >= 3.5 m apart
      const g = groveN(x, z),
        gd = vn(x / 60 - 11, z / 60 + 4); // gd: cypress domes / tree islands
      if (p > 0.86) continue; // (r2-veg) clump biomes take up to 86 % of the 8 m candidates inside a clump
      let b = biomeOf(ctx, x, z),
        wet = false;
      if (
        !(b && BIOMES[BKEYS[b - 1]].clump) &&
        p > Math.max(0.75 * Math.max(g, gd > 0.7 ? 1 : 0), 0.62)
      )
        continue; // 0.4: roadside-row candidates, up to 0.62 elsewhere
      if (!b) {
        // shallows along wild / Keys shores: red mangroves stand IN the water, roots in the mud (clumps along the shoreline, never offshore)
        const D = ctx.data;
        if (!D.isWater(x, z) || (ctx.terrain.real && ctx.terrain.real(x, z))) continue;
        const keys = ctx.terrain.isKeys(x, z);
        if (!keys && !(z > 0 && D.zoneAt && /wilderness|rural/.test(D.zoneAt(x, z) || '')))
          continue; /* mangroves: salt water only (Keys, the Everglades coast and Florida Bay), not the freshwater lakes north of the city */
        let land = 0;
        for (const [dx, dz] of [
          [4.5, 0],
          [-4.5, 0],
          [0, 4.5],
          [0, -4.5],
          [3.2, 3.2],
          [-3.2, -3.2],
          [3.2, -3.2],
          [-3.2, 3.2],
        ])
          if (!D.isWater(x + dx, z + dz)) land++; // only the shallow fringe right at the shore (deeper water: the roots would hang in the water)
        if (!land || vn(x / 41 + 2.7, z / 41 - 1.3) < 0.36 || p > 0.8) continue;
        if (MG_SHORE && !mangroveShore(D, x, z)) continue;
        b = BIDX.mangrove;
        wet = true;
      }
      const B = BIOMES[BKEYS[b - 1]],
        dens = B.dome
          ? gd > 0.68
            ? 0.7
            : B.tree * g * 0.35
          : B.clump
            ? B.tree * clumpK(ctx, x, z, g)
            : B.tree * (B.even ? 0.4 + 0.6 * g : 0.15 + 0.85 * g);
      let rdQ = null; // roadside row: rural stretches keep trees just outside the clear zone so their shade dapples the asphalt
      if (p >= dens) {
        if (!B.road || p >= B.road) continue;
        rdQ = ctx.roadDist ? ctx.roadDist(x, z) : 99;
        if (rdQ < 4.5 || rdQ > 15) continue;
      }
      const rd0 = rdQ ?? (ctx.roadDist ? ctx.roadDist(x, z) : 99),
        name = palmFit(ctx, pick(B.trees, hh(i, j, 5)), x, z, rd0, hh(i, j, 26)),
        K = TREE_KINDS[name];
      const rd = rd0;
      if (
        rd < (rdQ !== null ? (K.palm ? 4.5 : 9) : (K.palm ? 4 : K.wide ? 13 : 9) + hh(i, j, 6) * 5)
      )
        continue; // broadleaf crowns (~8 m) must not hang over the lanes
      if (inLot(x, z) || (ctx.blocked && ctx.blocked(x, z, K.palm ? 1.5 : 2.5))) continue; // docks, piers, set-piece pads
      if (junctionGap(ctx.data, x, z) < (K.palm ? 3 : K.wide ? 12 : 8)) continue; // junction mouths: curb returns reach past the leg edges
      if (
        ctx.deckAt &&
        (ctx.deckAt(x, z) ||
          ctx.deckAt(x + 4, z) ||
          ctx.deckAt(x - 4, z) ||
          ctx.deckAt(x, z + 4) ||
          ctx.deckAt(x, z - 4))
      )
        continue; // bridges, ramps, embankments
      const v = K.w ? pickIdx(K.w, hh(i, j, 7)) : (hh(i, j, 7) * K.seeds.length) | 0,
        s = K.s[0] + (K.s[1] - K.s[0]) * hh(i, j, 8);
      // grounding: lowest ground under the trunk footprint (slopes, shore banks): the base never hangs in the air
      const fr = name === 'mangrove' ? 1.6 : K.palm ? 0.3 : K.wide ? 0.6 : 0.35,
        H = ctx.data?.groundAt || meshGround(ctx.terrain);
      /* the ground as drawn (city ground on real Miami) */ let y = H(x, z);
      for (const [dx, dz] of [
        [fr, 0],
        [-fr, 0],
        [0, fr],
        [0, -fr],
        [fr * 0.7, fr * 0.7],
        [-fr * 0.7, fr * 0.7],
        [fr * 0.7, -fr * 0.7],
        [-fr * 0.7, -fr * 0.7],
      ])
        y = Math.min(y, H(x + dx, z + dz)); // (r2-veg) the rendered triangles, lowest point of the footprint decides
      emit({
        name,
        v,
        x,
        z,
        y,
        ry: hh(i, j, 9) * 6.2832,
        s,
        sp: K.sp,
        palm: !!K.palm,
        b,
        wet,
        key: i + ',' + j,
      });
      if (name === 'mangrove' && hh(i, j, 15) < 0.85) {
        // mangroves grow in clumps: 2-4 more trunks next to the first
        for (let k = 0; k < 2 + ((hh(i, j, 16) * 3) | 0); k++) {
          const a2 = hh(i, j, 17 + k) * 6.28,
            d2 = 2.2 + hh(i, j, 19 + k) * 1.6,
            x2 = x + Math.cos(a2) * d2,
            z2 = z + Math.sin(a2) * d2;
          if (ctx.blocked && ctx.blocked(x2, z2, 2)) continue;
          if (!ctx.data.isWater(x2, z2) && (ctx.roadDist ? ctx.roadDist(x2, z2) : 99) < 6) continue;
          if (MG_SHORE && ctx.data.isWater(x2, z2) && !mangroveShore(ctx.data, x2, z2)) continue;
          emit({
            name,
            v: pickIdx(K.w || [1], hh(i, j, 25 + k)),
            x: x2,
            z: z2,
            y: Math.min(
              H(x2, z2),
              H(x2 + 1.6, z2),
              H(x2 - 1.6, z2),
              H(x2, z2 + 1.6),
              H(x2, z2 - 1.6),
            ),
            ry: hh(i, j, 21 + k) * 6.28,
            s: s * (0.7 + hh(i, j, 23 + k) * 0.35),
            sp: K.sp,
            palm: false,
            b,
            wet,
            key: i + ',' + j + ',' + k,
          });
        }
      }
    }
  lotTrees(ctx, x0, z0, S, emit, ctx.lotSeen || null); // yard trees in house lots
}
// world_nov19b (user: mangroves "floating above" the water): clump trunks were set up to ~4 m further out than the first trunk,
// so some stood in open water. The ground pass (vegGround.v2.js) drops a mangrove in water with no land within 8 m, but only
// within 170 m of the camera: out there they stayed as impostors standing on the open bay (roots on the water surface, no
// shore behind them) and vanished as the player came close. The same shore test now decides at placement, near and far alike.
const MG_SHORE = !(typeof location !== 'undefined' && /[?&]nov19b=0\b/.test(location.search));
function mangroveShore(D, x, z) {
  for (let a = 0; a < 8; a++) {
    for (const d of [3, 6, 8]) {
      if (!D.isWater(x + Math.cos(a * 0.785) * d, z + Math.sin(a * 0.785) * d)) return true;
    }
  }
  return false;
}
function junctionGap(D, x, z) {
  // distance outside the nearest junction disc (node width / 2 + 2 m of curb return); the same test in both the tile collider pass and the streamer
  if (!D || !D.getTile) return 99;
  const t = D.getTile(Math.floor(x / 200), Math.floor(z / 200));
  let g = 99;
  for (const n of (t && t.nodes) || [])
    if (n.degree >= 3 && n.width) g = Math.min(g, Math.hypot(n.x - x, n.z - z) - n.width / 2 - 2);
  return g;
}
const inLot = (x, z) => {
  try {
    return !!(houseLots.enabled && (houseLots.at(x, z) || houseLots.reservedAt(x, z, 2)));
  } catch (e) {
    return false;
  }
}; // house lots (yards, decks, under stilt houses) belong to the houses track
// (vegetation, overnight) yard trees: the lots' back corners / side yards get 1-3 trees (Keys: poinciana, gumbo, palms, rubber fig;
// mainland: live oak, shade trees, palms), 1.3 m in from the lot line; the rest of the yard stays the houses track's
const lotInset = (l, x, z) => {
  const c = Math.cos(l.heading),
    s = Math.sin(l.heading),
    dx = x - l.x,
    dz = z - l.z,
    u = dx * c - dz * s,
    v = dx * s + dz * c;
  return Math.min(l.w / 2 - Math.abs(u), v < 0 ? l.d / 2 + v : l.d / 2 + (l.roadGap || 0) - v);
};
const inLotCore = (x, z) => {
  try {
    if (!houseLots.enabled) return false;
    if (houseLots.reservedAt(x, z, 2)) return true;
    const l = houseLots.at(x, z);
    return !!l && lotInset(l, x, z) > 2.2;
  } catch (e) {
    return false;
  }
};
const inLotInner = (x, z) => {
  try {
    if (!houseLots.enabled) return false;
    if (houseLots.reservedAt(x, z, 2)) return true;
    const l = houseLots.at(x, z);
    if (!l) return false;
    const c = Math.cos(l.heading),
      s = Math.sin(l.heading),
      dx = x - l.x,
      dz = z - l.z,
      v = dx * s + dz * c;
    return lotInset(l, x, z) > 1.25 || v > l.d * 0.2;
  } catch (e) {
    return false;
  }
}; // the side / back lot-line band keeps its hedges
const LOT_TREES = {
  keys: [
    ['seagrapeT', 3],
    ['gumbo', 2.4],
    ['buttonwood', 2],
    ['coconut', 2.5],
    ['coconutM', 1.2],
    ['rubber', 1.2],
    ['sabal', 1],
    ['poinciana', 0.8],
  ],
  main: [
    ['liveoak', 3],
    ['gumbo', 2],
    ['sabal', 1.5],
    ['coconut', 1],
    ['poinciana', 1],
    ['banyan', 0.3],
  ],
};
const LOT_HEDGE = {
  keys: [
    ['hedge', 3],
    ['seagrape', 3],
    ['hibiscus', 0.5],
    ['bougainvillea', 0.5],
    ['oleander', 0.3],
  ],
  main: [
    ['hedge', 5],
    ['hibiscus', 0.4],
    ['bougainvillea', 0.3],
  ],
};
function lotTrees(ctx, x0, z0, S, emit, seen = null) {
  // seen: Set of lot ids already planted in this cell (skipped)
  if (!houseLots.enabled || !houseLots.near) return;
  let list = [];
  try {
    list = houseLots.near(x0 + S / 2, z0 + S / 2, S * 0.75, []).slice();
  } catch (e) {
    return;
  }
  for (const l of list) {
    if (l.x < x0 || l.x >= x0 + S || l.z < z0 || l.z >= z0 + S || !(l.w > 7 && l.d > 7)) continue; // each lot planted once, by the cell holding its center
    if (seen) {
      if (seen.has(l.id)) continue;
      seen.add(l.id);
    }
    const id = Math.abs(Math.round(l.x * 7.31 + l.z * 3.17)),
      keys = ctx.terrain.isKeys(l.x, l.z),
      L = keys ? LOT_TREES.keys : LOT_TREES.main,
      c = Math.cos(l.heading),
      sn = Math.sin(l.heading);
    let n = 0;
    for (const [k, [u, v]] of [
      [-1, -1],
      [1, -1],
      [-1, 0.05],
      [1, 0.05],
      [0, -1],
      [-1, -0.25],
      [1, -0.25],
      [-0.5, -1],
      [0.5, -1],
    ].entries()) {
      // corners, side yards, back line
      if (hh(id, k, 201) > (keys ? 0.85 : 0.62) || n >= (keys ? 7 : 4)) continue; // (r2-veg) Keys yards: overgrown corners and side yards
      const lu = u * (l.w / 2 - 1.3),
        lv = v <= -1 ? -(l.d / 2 - 1.3) : v * l.d,
        x = l.x + c * lu + sn * lv,
        z = l.z - sn * lu + c * lv;
      if (
        (ctx.roadDist ? ctx.roadDist(x, z) : 99) < 4.5 ||
        (ctx.blocked && ctx.blocked(x, z, 1.6)) ||
        ctx.data.isWater(x, z) ||
        (houseLots.reservedAt && houseLots.reservedAt(x, z, 1.2))
      )
        continue;
      const name = palmFit(ctx, pick(L, hh(id, k, 202)), x, z, 99, hh(id, k, 206)),
        K = TREE_KINDS[name];
      if (!K) continue;
      const H = ctx.data?.groundAt || meshGround(ctx.terrain);
      let y = H(x, z);
      for (const [dx, dz] of [
        [0.7, 0],
        [-0.7, 0],
        [0, 0.7],
        [0, -0.7],
      ])
        y = Math.min(y, H(x + dx, z + dz));
      emit({
        name,
        v: K.w ? pickIdx(K.w, hh(id, k, 203)) : (hh(id, k, 203) * K.seeds.length) | 0,
        x,
        z,
        y,
        ry: hh(id, k, 204) * 6.2832,
        s: K.s[0] + (K.s[1] - K.s[0]) * hh(id, k, 205) * 0.8,
        sp: K.sp,
        palm: !!K.palm,
        b: BIDX[keys ? 'keys' : 'rural'],
        key: 'lot' + id + ',' + k,
      });
      n++;
    }
  }
}
const rejected = new Set();
let active = null;
export function csReject(x, z) {
  const k = Math.floor(x / TSTEP) + ',' + Math.floor(z / TSTEP);
  if (rejected.has(k)) return;
  rejected.add(k);
  active?.reject(x, z);
}

// ---------------- procedural ground-cover geometry ----------------
function grassTuft(seed, o) {
  // a clump of curved grass cards (atlas grass cell) rising from one root, 2 bends per card
  const R = rng(seed),
    gb = { leaf: new GB() },
    uvr = cellRect(CELL.grass, 0.03, 0.47, 0.02, 1),
    n = o.n;
  for (let k = 0; k < n; k++) {
    const az = (k / n) * 6.283 + R() * 0.8,
      h = o.h * (0.65 + R() * 0.55),
      w = o.w * (0.75 + R() * 0.5),
      lean = o.lean * (0.6 + R() * 0.8),
      ca = Math.cos(az),
      sa = Math.sin(az);
    const side = new V3(-sa, 0, ca),
      base = new V3(ca * R() * o.r, -0.03, sa * R() * o.r),
      b = gb.leaf.count,
      g = 0.8 + R() * 0.35;
    for (let r = 0; r <= 2; r++) {
      const t = r / 2,
        out = lean * t * t * h,
        y = h * t * (1 - 0.3 * lean * t * t),
        c = new V3(base.x + ca * out, base.y + y, base.z + sa * out),
        nn = new V3(ca * 0.35, 1, sa * 0.35).normalize();
      const col = [g * (0.3 + 0.36 * t), g * (0.48 + 0.34 * t), g * (0.26 + 0.3 * t) * o.tipB]; // dark green at the root, lighter tips
      for (const sg of [-1, 1])
        gb.leaf.vert(
          c.clone().addScaledVector(side, (sg * w) / 2),
          nn,
          sg < 0 ? uvr[0] : uvr[2],
          uvr[1] + (uvr[3] - uvr[1]) * t,
          col,
          [Math.max(0, y) * 2.2, t, az * 3],
        );
    }
    for (let r = 0; r < 2; r++)
      gb.leaf.quad(b + r * 2, b + r * 2 + 1, b + r * 2 + 3, b + r * 2 + 2);
  }
  return { leaf: gb.leaf.build(), tris: gb.leaf.tris };
}
function bladeTuft(seed, o) {
  // real grass blades (no texture): tapered 2-segment blades arching out from one root, dark base to light tip
  const R = rng(seed),
    gb = new GB(),
    base = [0.065, 0.105, 0.032],
    mid = [0.12, 0.19, 0.05],
    tip = [0.205, 0.275, 0.088]; // (greenery) softer root-to-tip ramp: less speckle at grazing light
  for (let k = 0; k < o.n; k++) {
    const az = R() * 6.283,
      ca = Math.cos(az),
      sa = Math.sin(az),
      d = Math.sqrt(R()) * o.r,
      bx = ca * d,
      bz = sa * d,
      h = o.h * (0.55 + R() * 0.6),
      lean = o.lean * (0.4 + R()),
      w = o.w * (0.7 + R() * 0.6);
    const fa = az + (R() - 0.5) * 1.2,
      side = new V3(-Math.sin(fa), 0, Math.cos(fa)),
      out = new V3(Math.cos(fa), 0, Math.sin(fa)),
      g = 0.85 + R() * 0.3,
      nn = new V3(ca * 0.3, 1, sa * 0.3).normalize();
    const p0 = new V3(bx, -0.03, bz),
      p1 = p0
        .clone()
        .addScaledVector(UP, h * 0.55)
        .addScaledVector(out, lean * h * 0.18),
      p2 = p0
        .clone()
        .addScaledVector(UP, h * (1 - 0.25 * lean))
        .addScaledVector(out, lean * h * 0.62);
    const c = (a) => [a[0] * g, a[1] * g, a[2] * g],
      b = gb.count;
    gb.vert(p0.clone().addScaledVector(side, -w), nn, 0, 0, c(base), [0, 0, az]);
    gb.vert(p0.clone().addScaledVector(side, w), nn, 0, 0, c(base), [0, 0, az]);
    gb.vert(p1.clone().addScaledVector(side, w * 0.7), nn, 0, 0, c(mid), [h * 0.55, 0.5, az]);
    gb.vert(p1.clone().addScaledVector(side, -w * 0.7), nn, 0, 0, c(mid), [h * 0.55, 0.5, az]);
    gb.vert(p2, nn, 0, 0, c(tip), [h, 1, az]);
    gb.quad(b, b + 1, b + 2, b + 3);
    gb.tri(b + 3, b + 2, b + 4);
  }
  return { plain: gb.build(), tris: gb.tris };
}
function fernClump(seed) {
  const R = rng(seed),
    gb = { bark: new GB(), leaf: new GB() },
    ctr = new V3(0, 0.25, 0);
  for (let k = 0; k < 7; k++) {
    const a = R() * 6.28,
      d = R() * 0.35;
    cluster(
      gb,
      R,
      new V3(Math.cos(a) * d, 0.22 + R() * 0.25, Math.sin(a) * d),
      0.75 + R() * 0.3,
      CELL.fern,
      ctr,
      [0.9 + R() * 0.2, 1, 0.85],
      3,
      0.15,
      0.7,
    );
  }
  return { bark: gb.bark.build(), leaf: gb.leaf.build(), height: 0.8, tris: gb.leaf.tris };
}
function flowerClump(seed, petal, center) {
  // daisies / tickseed: thin stems, a few leaves, flat petal discs facing up
  const R = rng(seed),
    gb = new GB(),
    stemC = [0.16, 0.3, 0.08];
  for (let k = 0; k < 9 + R() * 7; k++) {
    const a = R() * 6.28,
      d = Math.sqrt(R()) * 0.32,
      bx = Math.cos(a) * d,
      bz = Math.sin(a) * d,
      h = 0.16 + R() * 0.3,
      tx = bx + (R() - 0.5) * 0.06,
      tz = bz + (R() - 0.5) * 0.06;
    const top = new V3(tx, h, tz),
      b = gb.count,
      sd = new V3(Math.cos(a + 1.57), 0, Math.sin(a + 1.57)).multiplyScalar(0.006);
    gb.vert(new V3(bx, -0.02, bz).add(sd), UP, 0, 0, stemC, [0, 0, a]);
    gb.vert(new V3(bx, -0.02, bz).sub(sd), UP, 0, 0, stemC, [0, 0, a]);
    gb.vert(top.clone().sub(sd), UP, 0, 0, stemC, [h, 0.6, a]);
    gb.vert(top.clone().add(sd), UP, 0, 0, stemC, [h, 0.6, a]);
    gb.quad(b, b + 1, b + 2, b + 3);
    const rr = 0.028 + R() * 0.02,
      tilt = new V3((R() - 0.5) * 0.5, 1, (R() - 0.5) * 0.5).normalize(),
      np = 7,
      c0 = gb.count,
      pc = petal.map((v) => v * (0.9 + R() * 0.15));
    gb.vert(top.clone().addScaledVector(tilt, 0.008), tilt, 0, 0, center, [h, 0.8, a]);
    for (let q = 0; q <= np * 2; q++) {
      const an = (q / (np * 2)) * 6.2832,
        rad = q % 2 ? rr * 0.55 : rr,
        e = new V3(Math.cos(an), 0, Math.sin(an));
      e.addScaledVector(tilt, -e.dot(tilt)).normalize();
      gb.vert(top.clone().addScaledVector(e, rad), tilt, 0, 0, pc, [h, 0.8, a]);
    }
    for (let q = 0; q < np * 2; q++) gb.tri(c0, c0 + 1 + q, c0 + 2 + q);
  }
  return { plain: gb.build(), tris: gb.tris };
}
function litterPatch(seed) {
  // a few fallen leaves / twigs flat on the sand (atlas litter cell)
  const R = rng(seed),
    gb = { leaf: new GB() };
  for (let k = 0; k < 3; k++)
    groundCard(
      gb,
      R,
      new V3((R() - 0.5) * 0.8, -0.005, (R() - 0.5) * 0.8),
      0.3 + R() * 0.3,
      CELL.litter,
      [0.7 + R() * 0.08, 0.62, 0.5],
    );
  return { leaf: gb.leaf.build(), tris: gb.leaf.tris };
}
function rock(seed, col) {
  // limestone / coral rock: displaced, flattened icosphere, smooth normals, sunk into the ground
  const R = rng(seed);
  let g = new THREE.IcosahedronGeometry(1, 2);
  g.deleteAttribute('uv');
  g.deleteAttribute('normal');
  g = mergeVertices(g);
  const P = g.attributes.position,
    v = new V3(),
    sx = 0.8 + R() * 0.6,
    sz = 0.7 + R() * 0.5,
    sy = 0.45 + R() * 0.3,
    ph = R() * 10;
  for (let i = 0; i < P.count; i++) {
    v.fromBufferAttribute(P, i);
    const n =
      1 +
      0.18 * Math.sin(v.x * 3.1 + ph) * Math.cos(v.z * 2.7 - ph) +
      0.08 * Math.sin(v.y * 7 + v.x * 5) +
      (v.y > 0.55 ? -0.25 * (v.y - 0.55) : 0);
    P.setXYZ(i, v.x * sx * n, Math.max(-0.35, v.y) * sy * n, v.z * sz * n);
  }
  g.computeVertexNormals();
  const C = [],
    W = [];
  for (let i = 0; i < P.count; i++) {
    const t = 0.85 + 0.25 * vn(P.getX(i) * 4 + ph, P.getZ(i) * 4) - (P.getY(i) < 0 ? 0.15 : 0);
    C.push(col[0] * t, col[1] * t, col[2] * t);
    W.push(0, 0, 0);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
  g.setAttribute('aWind', new THREE.Float32BufferAttribute(W, 3));
  g.computeBoundingSphere();
  return { plain: g, tris: g.index.count / 3 };
}

// ---------------- LOD bands (m): [fadeInStart, fadeInEnd, fadeOutStart, fadeOutEnd] ----------------
const BAND = {
  // full mesh straight to the impostor baked from that same mesh (an in-between 'lod 1' mesh has a different branch layout = shape pop)
  tree: [[0, 0, 60, 76], null, [60, 76, 1150, 1320]],
  shrub: [[0, 0, 34, 48], null, [34, 48, 380, 440]],
  gc: [[0, 0, 36, 52]],
  peb: [[0, 0, 26, 40]],
  gcn: [[0, 0, 18, 26]],
  gch: [[0, 0, 24, 34]], // half of the main grass layer stops early: grass density falls off with distance
};
// library models (vegetation track): full mesh near, the converted LOD1 mesh in the middle, impostor far (dithered cross-fades)
const MBAND = {
  tree: [
    [0, 0, 48, 62],
    [48, 62, 150, 175],
    [150, 175, 1150, 1320],
  ],
  shrub: [
    [0, 0, 40, 55],
    [40, 55, 120, 145],
    [120, 145, 380, 440],
  ],
};
// world_nov19b: re-plant a cell in one step when its terrain changes (no blink). ?nov19b=0 = old.
const REGEN_IN_PLACE = !(typeof location !== 'undefined' && /[?&]nov19b=0\b/.test(location.search));
const CELLS = 64,
  HALF = CELLS * 0.7072,
  MARGIN = 11,
  R_TREE = 1320,
  R_SHRUB = 440,
  R_GC = 54,
  GRID = 4;

class Slot {
  // one InstancedMesh whose content is rebuilt from the cells on every re-bucket
  constructor(parent, geo, mat, depth, cast, colored) {
    Object.assign(this, { parent, geo, mat, depth, cast, colored, cap: 0, n: 0, im: null });
    this.grow(64);
  }
  grow(cap) {
    const im = new THREE.InstancedMesh(this.geo, this.mat, cap);
    im.frustumCulled = false;
    im.castShadow = this.cast;
    im.receiveShadow = true;
    if (this.depth) im.customDepthMaterial = this.depth;
    im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    im.count = 0;
    im.visible = false;
    if (this.colored) {
      im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3);
      im.instanceColor.setUsage(THREE.DynamicDrawUsage);
    }
    if (this.im) {
      im.instanceMatrix.array.set(this.im.instanceMatrix.array.subarray(0, this.n * 16));
      if (this.colored)
        im.instanceColor.array.set(this.im.instanceColor.array.subarray(0, this.n * 3));
      this.parent.remove(this.im);
      this.im.dispose();
    }
    this.parent.add(im);
    this.im = im;
    this.cap = cap;
  }
  room(k) {
    if (this.n + k > this.cap) {
      let c = this.cap;
      while (c < this.n + k) c *= 2;
      this.grow(c);
    }
  }
  bulk(m, c, n) {
    this.room(n);
    this.im.instanceMatrix.array.set(n * 16 === m.length ? m : m.subarray(0, n * 16), this.n * 16);
    if (this.colored)
      this.im.instanceColor.array.set(n * 3 === c.length ? c : c.subarray(0, n * 3), this.n * 3);
    this.n += n;
  }
  one(m, c, i) {
    this.room(1);
    const A = this.im.instanceMatrix.array,
      o = this.n * 16,
      s = i * 16;
    for (let k = 0; k < 16; k++) A[o + k] = m[s + k];
    if (this.colored) {
      const C = this.im.instanceColor.array;
      C[this.n * 3] = c[i * 3];
      C[this.n * 3 + 1] = c[i * 3 + 1];
      C[this.n * 3 + 2] = c[i * 3 + 2];
    }
    this.n++;
  }
  end() {
    const im = this.im;
    im.count = this.n;
    im.visible = this.n > 0;
    if (this.n) {
      im.instanceMatrix.clearUpdateRanges();
      im.instanceMatrix.addUpdateRange(0, this.n * 16);
      im.instanceMatrix.needsUpdate = true;
      if (this.colored) {
        im.instanceColor.clearUpdateRanges();
        im.instanceColor.addUpdateRange(0, this.n * 3);
        im.instanceColor.needsUpdate = true;
      }
    }
  }
}

export function createCountryside({
  renderer,
  scene,
  terrain,
  data,
  roadDist,
  deckAt = null,
  models = {},
  blocked = null,
  areas = null,
  solidRev = null,
}) {
  if (blocked) BLOCKED = blocked;
  if (areas) AREAS = areas;
  const ctx = { terrain, data, roadDist, deckAt, blocked },
    group = new THREE.Group();
  group.name = 'countryside';
  scene.add(group);
  const t0 = performance.now();
  // ---- materials: one bark + leaf pair per LOD band and class (shared programs), impostors per prototype ----
  const vegMat = (fam, band, o = {}) =>
    makeVegMaterial(fam, { fade: band, lean: 0.006, sway: 0.0035, ...o });
  const MAT = {};
  for (const cls of ['tree', 'shrub'])
    MAT[cls] = [{ bark: vegMat('bark', BAND[cls][0]), leaf: vegMat('leaf', BAND[cls][0]) }];
  MAT.gc = {
    leaf: vegMat('leaf', BAND.gc[0], { lean: 0.02, sway: 0.03, wear: 0.35, transl: 0.7 }),
    plain: vegMat('plain', BAND.gc[0], { lean: 0.02, sway: 0.03, wear: 0 }),
    rock: vegMat('plain', BAND.gc[0], { lean: 0, sway: 0, wear: 0, tint: 0.6 }),
    peb: vegMat('plain', BAND.peb[0], { lean: 0, sway: 0, wear: 0, tint: 0.6 }),
    fill: vegMat('plain', BAND.gcn[0], { lean: 0.02, sway: 0.03, wear: 0 }),
    half: vegMat('plain', BAND.gch[0], { lean: 0.02, sway: 0.03, wear: 0 }),
  };
  if (GCARDS) {
    const map = grassCardMap(renderer),
      co = { map, lean: 0.03, sway: 0.035, wear: 0.12, transl: 0.65, alphaTest: 0.38, tint: 0.8 };
    MAT.gc.card = vegMat('leaf', BAND.gc[0], co);
    MAT.gc.cardFill = vegMat('leaf', BAND.gcn[0], co);
    MAT.gc.cardHalf = vegMat('leaf', BAND.gch[0], co);
  }
  for (const k in MAT.gc)
    for (const x of [MAT.gc[k].mat, MAT.gc[k].depth])
      gmVeg(x, { edge: k !== 'rock', noPaved: k === 'rock' || k === 'peb' });
  for (const k of ['bark', 'leaf'])
    for (const x of [MAT.shrub[0][k].mat, MAT.shrub[0][k].depth]) gmVeg(x); // ground pass: nothing grows on hard surfaces or under cars (ground/surfaceMask.js)
  const bakeM = { bark: makeVegMaterial('bark'), leaf: makeVegMaterial('leaf') };
  // ---- prototypes ----
  const protos = [],
    protoOf = {};
  function addProto(cls, key, g0, g1, colored = true) {
    const P = { cls, key, lods: [], tris: [g0.tris, g1?.tris || 0, 4] },
      idx = protos.length;
    if (g0.model) {
      // library model: own materials per part, impostor baked at load (models.js)
      const bands = MBAND[cls] || BAND[cls],
        L = g0.model.materials(bands[0], bands[1], bands[2]); // library model: own LOD1 mesh in the mid band (same tree, thinned)
      if (cls === 'shrub')
        for (const q of [...(L.near || []), ...(L.mid || [])]) {
          gmVeg(q.mat);
          gmVeg(q.depth);
        } // ground pass: no library shrubs on hard surfaces
      P.lods.push({
        band: bands[0],
        slots: L.near.map(
          (q) => new Slot(group, q.geo, q.mat, q.depth, true, colored && q.fam === 'leaf'),
        ),
      });
      if (L.mid.length)
        P.lods.push({
          band: bands[1],
          slots: L.mid.map(
            (q) => new Slot(group, q.geo, q.mat, q.depth, true, colored && q.fam === 'leaf'),
          ),
        });
      if (L.imp)
        P.lods.push({
          band: bands[2],
          slots: [new Slot(group, L.imp.geo, L.imp.mat, L.imp.depth, false, colored)],
        });
      P.tris = [g0.model.tris[0], g0.model.tris[1], 4];
      P.model = g0.model;
    } else if (cls === 'tree' || cls === 'shrub') {
      const M0 = MAT[cls][0],
        bands = BAND[cls];
      const mk = (g, M, cast) => {
        const s = [];
        if (g.bark && g.bark.index && g.bark.index.count)
          s.push(new Slot(group, g.bark, M.bark.mat, M.bark.depth, cast, false));
        if (g.leaf && g.leaf.index.count)
          s.push(new Slot(group, g.leaf, M.leaf.mat, M.leaf.depth, cast, colored));
        return s;
      };
      P.lods.push({ band: bands[0], slots: mk(g0, M0, true) });
      try {
        const im = bakeImpostor(renderer, 'cs_' + key, 1, g0, bakeM.bark.mat, bakeM.leaf.mat, 256),
          m = makeVegMaterial('imp', {
            map: im.texture,
            fade: bands[2],
            lean: 0.006,
            sway: 0.0035,
            alphaTest: 0.5,
            transl: 0.5,
          });
        P.lods.push({
          band: bands[2],
          slots: [new Slot(group, im.geometry, m.mat, m.depth, false, colored)],
        });
      } catch (e) {
        console.warn('[countryside] impostor bake failed', key, e);
      }
    } else {
      const band =
          cls === 'peb'
            ? BAND.peb[0]
            : cls === 'gcn'
              ? BAND.gcn[0]
              : cls === 'gch'
                ? BAND.gch[0]
                : BAND.gc[0],
        M = g0.card
          ? cls === 'gcn'
            ? MAT.gc.cardFill
            : cls === 'gch'
              ? MAT.gc.cardHalf
              : MAT.gc.card
          : cls === 'peb'
            ? MAT.gc.peb
            : cls === 'gcn'
              ? MAT.gc.fill
              : cls === 'gch'
                ? MAT.gc.half
                : g0.plain
                  ? key.startsWith('rock')
                    ? MAT.gc.rock
                    : MAT.gc.plain
                  : MAT.gc.leaf;
      P.lods.push({
        band,
        slots: [new Slot(group, g0.plain || g0.leaf, M.mat, M.depth, key.startsWith('rock'), true)],
      });
    }
    protos.push(P);
    (protoOf[key.replace(/#\d+$/, '')] ||= []).push(idx);
    return idx;
  }
  const fbGeo = (kind, v) => {
    const F = Object.values(TREE_KINDS).find((q) => q.kind === kind);
    return buildGeometry(kind, {
      seed: F ? F.seeds[v % F.seeds.length][0] : 3 + v * 5,
      size: F ? F.seeds[v % F.seeds.length][1] : 1,
      lod: 0,
    });
  };
  for (const [name, K] of Object.entries(TREE_KINDS))
    K.seeds.forEach(([seed, size], v) => {
      const o = { seed, size },
        cls = K.shrubLike ? 'shrub' : 'tree';
      if (K.models) {
        const md = models && models[K.models[v]];
        addProto(cls, name + '#' + v, md ? { model: md } : fbGeo(K.fb, v), null);
        return;
      }
      addProto(cls, name + '#' + v, buildGeometry(K.kind, { ...o, lod: 0 }), null);
    });
  for (const [name, K] of Object.entries(SHRUB_KINDS))
    K.seeds.forEach(([seed, size], v) => {
      const md = K.models && models && models[K.models[v]];
      const g0 = md
        ? { model: md }
        : K.custom || !K.kind
          ? fernClump(seed + v)
          : buildGeometry(K.kind, { seed, size, lod: 0 });
      addProto('shrub', name + '#' + v, g0, null);
    });
  const GC = {
    grass: [1, 2, 3, 4].map((s) =>
      bladeTuft(s * 11, { n: 12, h: 0.42, w: 0.01, lean: 0.55, r: 0.28 }),
    ), // 12 blades: this layer reaches 52 m
    fillG: [1, 2, 3, 4].map((s) =>
      bladeTuft(s * 13, { n: 13, h: 0.4, w: 0.008, lean: 0.55, r: 0.3 }),
    ), // dense near layer (<26 m)
    short: [1, 2].map((s) => bladeTuft(s * 17, { n: 22, h: 0.2, w: 0.006, lean: 0.6, r: 0.3 })),
    flat: [1, 2, 3].map((s) => bladeTuft(s * 19, { n: 16, h: 0.15, w: 0.007, lean: 1.5, r: 0.34 })), // matted down (walked / driven on)
    litter: [1, 2].map((s) => litterPatch(s * 53)),
    tall: [1, 2].map((s) => bladeTuft(s * 23, { n: 22, h: 0.95, w: 0.009, lean: 0.4, r: 0.22 })),
    daisy: [1, 2].map((s) => flowerClump(s * 31, [0.92, 0.92, 0.88], [0.95, 0.7, 0.08])),
    tick: [1, 2].map((s) => flowerClump(s * 37, [0.98, 0.78, 0.06], [0.45, 0.25, 0.05])),
    rock: [1, 2, 3].map((s) => rock(s * 41, [0.4, 0.385, 0.35])), // ground pass: weathered pale limestone / coral rock (x material tint 0.6 = ~0.24 linear albedo; the old 0.13 rendered as black splats)
    peb: [1, 2].map((s) => rock(s * 47, [0.42, 0.4, 0.36])),
  };
  if (GCARDS) {
    // photographed grass: wild clumps + dense dry strips for the main layer, strips for the near fill, single blades for tall grass
    GC.grass = [
      clumpCard(11, { h: 0.55 }),
      clumpCard(23, { h: 0.5 }),
      stripCard(33, { h: 0.36, w: 0.8 }),
      stripCard(44, { h: 0.32, w: 0.75 }),
    ];
    GC.fillG = [1, 2, 3, 4].map((s) => stripCard(s * 13 + 1, { h: 0.3, w: 0.7, n: 3 }));
    GC.tall = [1, 2].map((s) =>
      bladeCards(s * 23, { n: 22, h: 0.85, w: 0.022, lean: 0.75, r: 0.26 }),
    );
  }
  for (const [k, list] of Object.entries(GC))
    if (k !== 'fillG')
      list.forEach((g, v) => addProto(k === 'peb' ? 'peb' : 'gc', k + '#' + v, g, null));
  GC.fillG.forEach((g, v) => addProto('gcn', 'fill#' + v, g, null));
  GC.grass.forEach((g, v) => addProto('gch', 'half#' + v, g, null)); // near fill: a second, denser grass layer that only lives within ~30 m

  // ---- cells ----
  const cells = new Map();
  let dirty = true;
  const cellKey = (ci, cj) => ci + ',' + cj;
  function getCell(ci, cj) {
    const k = cellKey(ci, cj);
    let c = cells.get(k);
    if (!c) {
      c = {
        k,
        ci,
        cj,
        x0: ci * CELLS,
        z0: cj * CELLS,
        cx: (ci + 0.5) * CELLS,
        cz: (cj + 0.5) * CELLS,
        cy: 0,
        lists: new Map(),
        lv: { t: 0, s: 0, g: 0 },
        grid: null,
      };
      cells.set(k, c);
    }
    return c;
  }
  const _m = new THREE.Matrix4(),
    _q = new THREE.Quaternion(),
    _q2 = new THREE.Quaternion(),
    _p = new V3(),
    _s = new V3(),
    _n = new V3();
  function pushItem(c, pi, x, y, z, ry, s, n, col, sy = s, noBlock = false) {
    if (!noBlock) {
      const cl = protos[pi].cls;
      if (
        cl === 'tree' || cl === 'shrub'
          ? BLOCKED && BLOCKED(x, z, cl === 'tree' ? 1.5 : 0.3)
          : AREAS && AREAS(x, z, 0.2)
      )
        return;
    } // docks / piers / set-piece pads (ground cover: the cheap area list only)
    let L = c.lists.get(pi);
    if (!L) {
      L = { m: [], c: [], cls: protos[pi].cls };
      c.lists.set(pi, L);
    }
    _q.setFromAxisAngle(UP, ry);
    if (n) {
      _q2.setFromUnitVectors(UP, n);
      _q.premultiply(_q2);
    }
    _m.compose(_p.set(x, y, z), _q, _s.set(s, sy, s));
    for (let k = 0; k < 16; k++) L.m.push(_m.elements[k]);
    L.c.push(col[0], col[1], col[2]);
  }
  function seal(c) {
    let ys = 0,
      yn = 0;
    for (const L of c.lists.values()) {
      if (Array.isArray(L.m)) {
        L.m = new Float32Array(L.m);
        L.c = new Float32Array(L.c);
      }
      L.n = L.m.length / 16;
      for (let i = 0; i < L.n; i += 7) {
        ys += L.m[i * 16 + 13];
        yn++;
      }
    }
    if (yn) c.cy = ys / yn;
    dirty = true;
  }
  const leafCol = (b, x, z, r) => {
    const B = BIOMES[BKEYS[b - 1]],
      w = vn(x / 40 + 9, z / 40) - 0.5,
      v = 0.86 + r * 0.24;
    return [
      B.hue[0] * v * (1 + w * 0.22),
      B.hue[1] * v * (1 + w * 0.05),
      B.hue[2] * v * (1 - w * 0.25),
    ];
  };
  // lots planned after a cell was generated: add their yard trees to the sealed lists (no regeneration, no blink)
  function addLotTrees(c) {
    const add = new Map();
    lotTrees(
      ctx,
      c.x0,
      c.z0,
      CELLS,
      (t) => {
        if (c.lotKeys?.has(t.key) || rejected.has(t.key)) return;
        (c.lotKeys ||= new Set()).add(t.key);
        const pi = protoOf[t.name]?.[t.v];
        if (pi === undefined) return;
        _q.setFromAxisAngle(UP, t.ry);
        _m.compose(
          _p.set(t.x, t.y - (t.palm ? 0.1 : 0.16) * t.s, t.z),
          _q,
          _s.set(t.s, t.s * (0.84 + hh(t.x | 0, t.z | 0, 13) * 0.32), t.s),
        );
        const col = leafCol(t.b, t.x, t.z, hh(t.x | 0, t.z | 0, 12));
        let A = add.get(pi);
        if (!A) add.set(pi, (A = { m: [], c: [] }));
        A.m.push(..._m.elements);
        A.c.push(...col);
      },
      (c.lotIds ||= new Set()),
    );
    for (const [pi, A] of add) {
      let L = c.lists.get(pi);
      const k = A.m.length / 16;
      if (!L) {
        L = { m: new Float32Array(A.m), c: new Float32Array(A.c), cls: protos[pi].cls, n: k };
        c.lists.set(pi, L);
        continue;
      }
      const m = new Float32Array((L.n + k) * 16),
        cc = new Float32Array((L.n + k) * 3);
      m.set(L.m.subarray(0, L.n * 16));
      cc.set(L.c.subarray(0, L.n * 3));
      m.set(A.m, L.n * 16);
      cc.set(A.c, L.n * 3);
      L.m = m;
      L.c = cc;
      L.n += k;
    }
    if (add.size) dirty = true;
  }
  // (vegetation, overnight) lot-line hedges: the side and back lines of each house lot (along the fences) get runs of hedge /
  // sea grape / flowering shrubs 0.7-1.1 m inside the line, broken into runs and gaps, with taller sea grape clumps (2.5-3 m) in
  // the runs as the mid layer; the side lines stop short of the front yard (driveway, walk). Keys lots: denser, more varied.
  function lotHedges(c, lots, trunks, put) {
    c.hedgeIds ||= new Set();
    for (const l of lots) {
      if (
        l.x < c.x0 ||
        l.x >= c.x0 + CELLS ||
        l.z < c.z0 ||
        l.z >= c.z0 + CELLS ||
        !(l.w > 7 && l.d > 7) ||
        c.hedgeIds.has(l.id)
      )
        continue;
      c.hedgeIds.add(l.id);
      const keys = terrain.isKeys(l.x, l.z),
        id = Math.abs(Math.round(l.x * 7.31 + l.z * 3.17)),
        co = Math.cos(l.heading),
        sn = Math.sin(l.heading),
        LH = keys ? LOT_HEDGE.keys : LOT_HEDGE.main,
        b = BIDX[keys ? 'keys' : 'rural'],
        hd = l.d / 2,
        hw = l.w / 2;
      for (const [li, [su, sv]] of [
        [-1, 0],
        [1, 0],
        [0, -1],
      ].entries()) {
        if (hh(id, li, 301) < (keys ? 0.05 : 0.3)) continue; // some lines stay bare
        const a0 = su ? -hd + 0.9 : -hw + 0.9,
          a1 = su ? hd * 0.3 : hw - 0.9;
        for (let t = a0, k = 0; t < a1; t += 1.4 + hh(id, li * 97 + k, 302) * 0.9, k++) {
          if (vn(t / 6.5 + (id % 89), li * 3.7 + (id % 13)) < (keys ? 0.26 : 0.4)) continue; // runs and gaps (Keys: long overgrown runs)
          const ins = 0.7 + hh(id, li * 97 + k, 303) * 0.4,
            lu = su ? su * (hw - ins) : t,
            lv = su ? t : -(hd - ins),
            x = l.x + co * lu + sn * lv,
            z = l.z - sn * lu + co * lv;
          if (
            (roadDist ? roadDist(x, z) : 99) < 2.5 ||
            data.isWater(x, z) ||
            (deckAt && deckAt(x, z)) ||
            trunks.some((q) => (q[0] - x) ** 2 + (q[1] - z) ** 2 < 2)
          )
            continue;
          const r = hh(id, li * 97 + k, 304),
            tall = keys && r < 0.22,
            name = tall ? 'seagrapeT' : pick(LH, hh(id, li * 97 + k, 305)),
            lst = protoOf[name];
          if (!lst) continue;
          const s = tall ? 0.55 + r * 1.4 : 0.95 + hh(id, li * 97 + k, 306) * 0.45;
          put(
            lst[(hh(id, li * 97 + k, 307) * lst.length) | 0],
            x,
            (data.groundAt || meshGround(terrain))(x, z) - 0.06,
            z,
            hh(id, li * 97 + k, 308) * 6.28,
            s,
            leafCol(b, x, z, hh(id, li * 97 + k, 309)),
            s * (0.9 + hh(id, li * 97 + k, 310) * 0.3),
          );
        }
      }
    }
  }
  // lots planned after a cell's shrubs were generated: their hedges join the sealed lists (no regeneration, no blink)
  function addLotHedges(c) {
    const add = new Map(),
      trunks = [];
    for (const [pi, L] of c.lists)
      if (TREE_KINDS[protos[pi].key.split('#')[0]])
        for (let k = 0; k < L.n; k++) trunks.push([L.m[k * 16 + 12], L.m[k * 16 + 14]]);
    lotHedges(
      c,
      houseLots.near ? houseLots.near(c.cx, c.cz, CELLS * 0.75 + 24, []).slice() : [],
      trunks,
      (pi, x, y, z, ry, sc, col, sy) => {
        if (BLOCKED && BLOCKED(x, z, 0.3)) return;
        _q.setFromAxisAngle(UP, ry);
        _m.compose(_p.set(x, y, z), _q, _s.set(sc, sy, sc));
        let A = add.get(pi);
        if (!A) add.set(pi, (A = { m: [], c: [] }));
        A.m.push(..._m.elements);
        A.c.push(...col);
      },
    );
    mergeAdd(c, add);
  }
  function mergeAdd(c, add) {
    for (const [pi, A] of add) {
      let L = c.lists.get(pi);
      const k = A.m.length / 16;
      if (!L) {
        L = { m: new Float32Array(A.m), c: new Float32Array(A.c), cls: protos[pi].cls, n: k };
        c.lists.set(pi, L);
        continue;
      }
      if (Array.isArray(L.m)) {
        for (const v of A.m) L.m.push(v);
        for (const v of A.c) L.c.push(v);
        L.n = L.m.length / 16;
        continue;
      }
      const m = new Float32Array((L.n + k) * 16),
        cc = new Float32Array((L.n + k) * 3);
      m.set(L.m.subarray(0, L.n * 16));
      cc.set(L.c.subarray(0, L.n * 3));
      m.set(A.m, L.n * 16);
      cc.set(A.c, L.n * 3);
      L.m = m;
      L.c = cc;
      L.n += k;
    }
    if (add.size) dirty = true;
  }
  function genTrees(c) {
    c.lotIds = new Set();
    placeTrees({ ...ctx, lotSeen: c.lotIds }, c.x0, c.z0, CELLS, (t) => {
      if (rejected.has(t.key.split(',').slice(0, 2).join(','))) return;
      if (t.key.startsWith('lot')) (c.lotKeys ||= new Set()).add(t.key);
      const pi = protoOf[t.name][t.v];
      pushItem(
        c,
        pi,
        t.x,
        t.name === 'mangrove'
          ? t.wet
            ? Math.min(t.y - 0.25 - 0.55 * t.s, -0.12 - 0.4 - 0.55 * t.s)
            : t.y -
              0.25 -
              0.55 *
                t.s /* (r3-world) the model's prop roots end 0.6-0.8 m above its origin: sink them into the mud / water */
          : t.y - Math.min(0.1, Math.max(0.04, (t.palm ? 0.07 : 0.06) * t.s)),
        t.z,
        t.ry,
        t.s,
        null,
        leafCol(t.b, t.x, t.z, hh(t.x | 0, t.z | 0, 12)),
        t.s * (0.84 + hh(t.x | 0, t.z | 0, 13) * 0.32),
      );
    }); // own height / width ratio per tree (no clones)
    c.lv.t = 1;
    c.hs = hSig(c);
  }
  // 4 m sample grid of height / road distance / biome / water for the shrub and ground-cover passes
  function gridOf(c) {
    if (c.grid) return c.grid;
    const n = CELLS / GRID + 1,
      H = new Float32Array(n * n),
      RD = new Float32Array(n * n),
      B = new Uint8Array(n * n);
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++) {
        const x = c.x0 + i * GRID,
          z = c.z0 + j * GRID,
          k = j * n + i;
        B[k] = (deckAt && deckAt(x, z)) || inLot(x, z) ? 0 : biomeOf(ctx, x, z);
        H[k] = terrain.heightAt(x, z);
        RD[k] = roadDist ? Math.min(60, roadDist(x, z)) : 60;
      }
    return (c.grid = { n, H, RD, B });
  }
  const triH = (G, x, z, c) => {
    if (!MESH_GND) return bil(G, G.H, x, z, c);
    const i0 = Math.round(c.x0 / GRID),
      j0 = Math.round(c.z0 / GRID),
      n = G.n;
    return triAt(
      (i, j) => {
        const li = i - i0,
          lj = j - j0;
        return li >= 0 && lj >= 0 && li < n && lj < n
          ? G.H[lj * n + li]
          : terrain.heightAt(i * GRID, j * GRID);
      },
      x,
      z,
      GRID,
    );
  };
  const bil = (G, A, x, z, c) => {
    const fx = (x - c.x0) / GRID,
      fz = (z - c.z0) / GRID,
      i = Math.min(G.n - 2, Math.max(0, Math.floor(fx))),
      j = Math.min(G.n - 2, Math.max(0, Math.floor(fz))),
      u = fx - i,
      v = fz - j,
      k = j * G.n + i;
    return (
      A[k] * (1 - u) * (1 - v) +
      A[k + 1] * u * (1 - v) +
      A[k + G.n] * (1 - u) * v +
      A[k + G.n + 1] * u * v
    );
  };
  const biomeAtG = (G, x, z, c) => {
    const i = Math.round((x - c.x0) / GRID),
      j = Math.round((z - c.z0) / GRID);
    return G.B[Math.min(G.n - 1, j) * G.n + Math.min(G.n - 1, i)];
  };
  const normalAt = (G, x, z, c, out) => {
    const e = 1.5,
      hx =
        bil(G, G.H, Math.min(c.x0 + CELLS, x + e), z, c) - bil(G, G.H, Math.max(c.x0, x - e), z, c),
      hz =
        bil(G, G.H, x, Math.min(c.z0 + CELLS, z + e), c) - bil(G, G.H, x, Math.max(c.z0, z - e), c);
    return out.set(-hx / (2 * e), 1, -hz / (2 * e)).normalize();
  };
  const WET8 = [
    [3, 0],
    [-3, 0],
    [0, 3],
    [0, -3],
    [6, 0],
    [-6, 0],
    [0, 6],
    [0, -6],
    [4.2, 4.2],
    [-4.2, 4.2],
    [4.2, -4.2],
    [-4.2, -4.2],
  ]; /* (r2-veg) reed band: open water within ~6 m */
  function genShrubs(c) {
    const G = gridOf(c),
      ST = 3;
    c.hedgeIds = new Set(); // a full shrub pass re-plants every lot hedge (the ids kept from a dropped pass left them bare)
    const lotsHere = houseLots.near
      ? houseLots.near(c.cx, c.cz, CELLS * 0.75 + 24, []).slice()
      : []; // (vegetation, overnight)
    const nearLot = (x, z) =>
      lotsHere.some((l) =>
        l._bb
          ? x > l._bb[0] - 18 && x < l._bb[1] + 18 && z > l._bb[2] - 18 && z < l._bb[3] + 18
          : Math.hypot(l.x - x, l.z - z) < 30,
      );
    const trunks = [];
    for (const [pi, L] of c.lists)
      if (TREE_KINDS[protos[pi].key.split('#')[0]])
        for (let k = 0; k < L.n; k++) trunks.push([L.m[k * 16 + 12], L.m[k * 16 + 14]]);
    for (let j = Math.ceil(c.z0 / ST); j * ST < c.z0 + CELLS; j++)
      for (let i = Math.ceil(c.x0 / ST); i * ST < c.x0 + CELLS; i++) {
        const p = hh(i, j, 21);
        if (p > 0.45) continue; // (r2-veg) up to 45 %: dense yard / Keys masses
        const x = (i + 0.1 + hh(i, j, 22) * 0.8) * ST,
          z = (j + 0.1 + hh(i, j, 23) * 0.8) * ST,
          b = biomeAtG(G, x, z, c);
        if (!b) continue;
        const B = BIOMES[BKEYS[b - 1]],
          rd = bil(G, G.RD, x, z, c),
          yk = B.yard && rd > 2.6 && rd < 10 && nearLot(x, z) ? 2.4 : 1; // yard frontage: flowering shrubs / hedges along the street, only by a house (not along empty highway verges)
        const edge =
          B.reed &&
          p < B.reed * (0.3 + 0.9 * sstep(0.3, 0.6, vn(x / 13 - 1.7, z / 13 + 3.1))) &&
          WET8.some(([dx, dz]) =>
            data.isWater(x + dx, z + dz),
          ); /* (r2-veg) reed / cattail bands on canal banks and mangrove shores, in clumps */
        if (
          !edge &&
          (!B.shrub ||
            p >
              B.shrub *
                yk *
                (B.clump ? 0.45 + 1.3 * sstep(0.42, 0.66, vn(x / 19 + 4.4, z / 19 - 2.2)) : 1) *
                (0.25 +
                  0.75 * sstep(0.35, 0.7, patchN(x / 3, z / 3, 2)) * (0.6 + 0.6 * groveN(x, z))))
        )
          continue;
        if (rd < 2.2 + hh(i, j, 24) * 2.5) continue;
        if (trunks.some((t) => (t[0] - x) ** 2 + (t[1] - z) ** 2 < 6.5)) continue; // never on a trunk
        const name = edge
            ? 'reeds'
            : pick(yk > 1 && hh(i, j, 30) < 0.7 ? B.yard : B.shrubs, hh(i, j, 25)),
          list = protoOf[name],
          pi = list[(hh(i, j, 26) * list.length) | 0],
          s = 0.7 + hh(i, j, 27) * 0.6;
        normalAt(G, x, z, c, _n).lerp(UP, 0.5).normalize();
        pushItem(
          c,
          pi,
          x,
          triH(G, x, z, c) - 0.06,
          z,
          hh(i, j, 28) * 6.28,
          s,
          _n,
          leafCol(b, x, z, hh(i, j, 29)),
        );
      }
    lotHedges(c, lotsHere, trunks, (pi, x, y, z, ry, sc, col, sy) =>
      pushItem(c, pi, x, y, z, ry, sc, null, col, sy),
    );
    // understory (vegetation track): every tree gets a skirt: grass tufts / ferns hugging the trunk (soft ground contact, no bare
    // pole standing on the ground) and a few shrubs under the crown, species by biome
    for (const [pi, L] of [...c.lists]) {
      const P = protos[pi],
        kn = P.key.split('#')[0],
        TK = TREE_KINDS[kn];
      if (!TK || TK.shrubLike || !L.n) continue;
      for (let k = 0; k < L.n; k++) {
        const tx = L.m[k * 16 + 12],
          tz = L.m[k * 16 + 14],
          ts = Math.hypot(L.m[k * 16], L.m[k * 16 + 1], L.m[k * 16 + 2]);
        if (tx < c.x0 || tz < c.z0 || tx >= c.x0 + CELLS || tz >= c.z0 + CELLS) continue;
        const b = biomeAtG(G, tx, tz, c);
        if (!b) continue;
        const B = BIOMES[BKEYS[b - 1]],
          i = Math.floor(tx * 7.3),
          j = Math.floor(tz * 7.3),
          base = TK.palm ? 0.5 : TK.wide ? 1.6 : 0.75;
        const nt = 2 + ((hh(i, j, 61) * 4) | 0);
        for (let q = 0; q < nt; q++) {
          const a = hh(i, j, 62 + q) * 6.283,
            d = base * ts + 0.2 + hh(i, j, 70 + q) * 1.1,
            x = tx + Math.cos(a) * d,
            z = tz + Math.sin(a) * d;
          if (bil(G, G.RD, x, z, c) < 1.8 || biomeAtG(G, x, z, c) !== b) continue;
          const nm = B.base ? pick(B.base, hh(i, j, 78 + q)) : 'tuft',
            lst = protoOf[nm];
          if (!lst) continue;
          normalAt(G, x, z, c, _n).lerp(UP, 0.4).normalize();
          pushItem(
            c,
            lst[(hh(i, j, 86 + q) * lst.length) | 0],
            x,
            triH(G, x, z, c) - 0.04,
            z,
            hh(i, j, 94 + q) * 6.28,
            0.75 + hh(i, j, 102 + q) * 0.6,
            _n,
            leafCol(b, x, z, hh(i, j, 110 + q)),
            undefined,
            true,
          );
        }
        if (!B.under) continue;
        const nu = (hh(i, j, 118) * (B.underN || 2.5)) | 0;
        for (let q = 0; q < nu; q++) {
          const a = hh(i, j, 120 + q) * 6.283,
            d = base * ts + 1.4 + hh(i, j, 126 + q) * 2.8,
            x = tx + Math.cos(a) * d,
            z = tz + Math.sin(a) * d;
          if (bil(G, G.RD, x, z, c) < 2.6 || biomeAtG(G, x, z, c) !== b) continue;
          const nm = pick(B.under, hh(i, j, 132 + q)),
            lst = protoOf[nm];
          if (!lst) continue;
          normalAt(G, x, z, c, _n).lerp(UP, 0.5).normalize();
          pushItem(
            c,
            lst[(hh(i, j, 138 + q) * lst.length) | 0],
            x,
            triH(G, x, z, c) - 0.06,
            z,
            hh(i, j, 144 + q) * 6.28,
            0.7 + hh(i, j, 150 + q) * 0.55,
            _n,
            leafCol(b, x, z, hh(i, j, 156 + q)),
          );
        }
      }
    }
    c.lv.s = 1;
  }
  function genGround(c) {
    const G = gridOf(c),
      ST = 0.8,
      col = [1, 1, 1];
    for (let j = Math.ceil(c.z0 / ST); j * ST < c.z0 + CELLS; j++)
      for (let i = Math.ceil(c.x0 / ST); i * ST < c.x0 + CELLS; i++) {
        const x = (i + hh(i, j, 31)) * ST,
          z = (j + hh(i, j, 32)) * ST,
          b = biomeAtG(G, x, z, c);
        if (!b) continue;
        const B = BIOMES[BKEYS[b - 1]],
          rd = bil(G, G.RD, x, z, c);
        if (rd < 0.15) continue;
        const p = hh(i, j, 33),
          y = triH(G, x, z, c),
          ry = hh(i, j, 34) * 6.28;
        normalAt(G, x, z, c, _n);
        if (rd < 1.7) {
          // gravel / dirt shoulder: pebbles and the odd low tuft
          if (p < 0.22) {
            const pi = protoOf.peb[((p * 50) | 0) % 2],
              s = 0.04 + hh(i, j, 35) * 0.09,
              g = 0.8 + hh(i, j, 36) * 0.35;
            pushItem(c, pi, x, y - s * 0.3, z, ry, s, _n, [g, g * 0.97, g * 0.92], s * 0.8);
          }
          if (p > 0.8 && rd > 1.0)
            pushItem(
              c,
              protoOf.short[0],
              x,
              y - 0.02,
              z,
              ry,
              0.7 + hh(i, j, 37) * 0.4,
              _n,
              [0.95, 0.95, 0.75],
            );
          continue;
        }
        const verge = rd < 8 ? 1.25 : 1,
          pat = patchN(x, z, 1);
        let dense =
            B.grass *
            verge *
            (B.matted ? 0.15 + 0.85 * sstep(0.35, 0.8, pat) : 0.35 + 0.9 * sstep(0.25, 0.7, pat)),
          cl = 1;
        if (VEG_R2 && B.matted) {
          // (r2-veg, lead: "polka-dot weeds") trodden Keys sand: weeds in patches of 5-30 tufts with soft edges, more along the street edge, almost none in between
          cl = weedPatch(x, z);
          const edge = rd < 4.5 ? 0.35 * (1 - sstep(2.5, 4.5, rd)) * sstep(0.3, 0.6, pat) : 0;
          dense = B.grass * Math.min(1, cl * 1.2 + edge);
          cl = Math.max(cl, edge * 2);
        }
        if (B.litter && hh(i, j, 49) < B.litter) {
          pushItem(
            c,
            protoOf.litter[((p * 77) | 0) % 2],
            x,
            y,
            z,
            ry,
            0.8 + hh(i, j, 50) * 0.5,
            _n,
            col,
          );
          continue;
        }
        const fl = patchN(x, z, 4),
          r2 = hh(i, j, 38);
        if (B.flower && fl > 0.62 && r2 < B.flower * 6 * sstep(0.62, 0.8, fl)) {
          const k = vn(x / 30, z / 30 + 2) > 0.5 ? 'daisy' : 'tick';
          pushItem(
            c,
            protoOf[k][((r2 * 40) | 0) % 2],
            x,
            y - 0.02,
            z,
            ry,
            0.8 + hh(i, j, 39) * 0.5,
            _n,
            col,
          );
          continue;
        }
        if (B.rock && r2 > 1 - B.rock * (rd < 6 ? 0.5 : 1)) {
          const s = 0.15 + Math.pow(hh(i, j, 40), 2.5) * 0.7;
          pushItem(c, protoOf.rock[((r2 * 300) | 0) % 3], x, y - s * 0.18, z, ry, s, _n, col);
          continue;
        }
        if (p > dense) {
          if (hh(i, j, 44) < dense * (B.matted ? 0.5 : 1.6) && !B.tall)
            pushItem(
              c,
              protoOf.fill[((p * 331) | 0) % 4],
              x + 0.4,
              y - 0.02,
              z - 0.3,
              ry + 2,
              0.8 + hh(i, j, 45) * 0.5,
              _n,
              [B.hue[0] * 0.95, B.hue[1], B.hue[2] * 0.9],
            );
          continue;
        }
        if (hh(i, j, 46) < (B.matted ? 0.25 : 0.8))
          pushItem(
            c,
            protoOf.fill[((p * 517) | 0) % 4],
            x - 0.35,
            y - 0.02,
            z + 0.4,
            ry + 1,
            0.75 + hh(i, j, 47) * 0.5,
            _n,
            [B.hue[0], B.hue[1], B.hue[2] * 0.95],
          );
        const dry = sstep(0.5, 0.85, patchN(x, z, 7)) * B.dry + (rd < 4 ? 0.1 : 0),
          v = 0.85 + hh(i, j, 41) * 0.3;
        const gcol = [
          B.hue[0] * v * (1 + dry * 0.55),
          B.hue[1] * v * (1 + dry * 0.12),
          B.hue[2] * v * (1 - dry * 0.45),
        ];
        const tall = B.tall && patchN(x, z, 9) < B.tall,
          kind0 = tall ? 'tall' : (rd < 5 && pat < 0.45) || pat < 0.3 ? 'short' : 'grass',
          kind =
            B.matted && !tall
              ? hh(i, j, 48) < 0.7
                ? 'flat'
                : 'short'
              : kind0 === 'grass' && hh(i, j, 48) < 0.5
                ? 'half'
                : kind0,
          L = protoOf[kind];
        pushItem(
          c,
          L[((p * 997) | 0) % L.length],
          x,
          y - 0.02,
          z,
          ry,
          VEG_R2 && B.matted ? 0.5 + 0.55 * cl + hh(i, j, 42) * 0.45 : 0.75 + hh(i, j, 42) * 0.55,
          _n,
          gcol,
        ); /* patch centers taller, the rim small */
      }
    c.lv.g = 1;
  }
  function dropLevel(c, cls) {
    for (const [pi, L] of c.lists) if (cls.includes(L.cls)) c.lists.delete(pi);
    dirty = true;
  }
  function reject(x, z) {
    const c = cells.get(cellKey(Math.floor(x / CELLS), Math.floor(z / CELLS)));
    if (c && c.lv.t) {
      for (const [pi] of c.lists)
        if (protos[pi].cls === 'tree' || TREE_KINDS[protos[pi].key.split('#')[0]])
          c.lists.delete(pi);
      c.lv.t = 0;
      dirty = true;
    }
  }
  // ---- streaming work: nearest missing level first, within a frame budget ----
  const st = { gen: 0, genMs: 0, maxMs: 0, rebucket: 0, rebucketMs: 0, lastRebucketMs: 0 };
  // perf (Nov 18): the scan below (task arrays for every cell in range, a hypot per cell, every frame) was 177 MB of garbage in a
  // 90 s probe. With nothing pending, it now runs only when the camera enters another cell or every 0.4 s.
  let wcx = 1e9,
    wcz = 1e9,
    wT = 0,
    wLast = 1;
  function work(cam, budgetMs, syncR = Infinity) {
    // syncR: after a jump only the cells within syncR m are filled at once, the rest streams in
    const t1 = performance.now(),
      ccx = Math.floor(cam.position.x / CELLS),
      ccz = Math.floor(cam.position.z / CELLS),
      N = Math.ceil(R_TREE / CELLS) + 1;
    if (!wLast && ccx === wcx && ccz === wcz && t1 - wT < 400 && syncR === Infinity) return 0;
    wcx = ccx;
    wcz = ccz;
    wT = t1;
    const tasks = [];
    for (let dj = -N; dj <= N; dj++)
      for (let di = -N; di <= N; di++) {
        const cx = (ccx + di + 0.5) * CELLS,
          cz = (ccz + dj + 0.5) * CELLS,
          ex = cx - cam.position.x,
          ez = cz - cam.position.z,
          d = Math.sqrt(ex * ex + ez * ez) - HALF;
        if (d > R_TREE) continue;
        const c = cells.get(cellKey(ccx + di, ccz + dj));
        if (d < R_GC + MARGIN && !(c && c.lv.g)) tasks.push([d - 399, 'g', ccx + di, ccz + dj, d]);
        if (d < R_SHRUB + MARGIN && !(c && c.lv.s))
          tasks.push([d - 149, 's', ccx + di, ccz + dj, d]);
        if (!(c && c.lv.t))
          tasks.push([d - (d < R_SHRUB + MARGIN ? 400 : 0), 't', ccx + di, ccz + dj, d]); // trees before the shrubs / ground cover of a cell (spacing)
      }
    tasks.sort((a, b) => a[0] - b[0]);
    for (const [, lv, ci, cj, dd] of tasks) {
      if (dd > syncR) continue;
      if (performance.now() - t1 > budgetMs) break;
      const c = getCell(ci, cj),
        ts = performance.now();
      if (lv === 't') genTrees(c);
      else if (lv === 's') genShrubs(c);
      else genGround(c);
      seal(c);
      const ms = performance.now() - ts;
      st.gen++;
      st.genMs += ms;
      st.maxMs = Math.max(st.maxMs, ms);
    }
    // forget far data (hysteresis)
    wLast = tasks.length;
    for (const c of cells.values()) {
      const fx = c.cx - cam.position.x,
        fz = c.cz - cam.position.z,
        d = Math.sqrt(fx * fx + fz * fz) - HALF;
      if (d > R_TREE + 140) {
        cells.delete(c.k);
        dirty = true;
        continue;
      }
      if (c.lv.g && d > R_GC + 60) {
        dropLevel(c, ['gc', 'peb', 'gcn', 'gch']);
        c.lv.g = 0;
      }
      if (c.lv.s && d > R_SHRUB + 80) {
        for (const [pi] of c.lists)
          if (protos[pi].cls === 'shrub' && !TREE_KINDS[protos[pi].key.split('#')[0]])
            c.lists.delete(pi);
        c.lv.s = 0;
        c.grid = c.lv.g ? c.grid : null;
        dirty = true;
      }
      if (!c.lv.s && !c.lv.g) c.grid = null;
    }
    return tasks.length;
  }
  // ---- re-bucket: cells -> per-LOD instanced slots, with MARGIN overlap so the shader-side dither fades are always fed ----
  const frus = new THREE.Frustum(),
    pm = new THREE.Matrix4(),
    sph = new THREE.Sphere(),
    lastPos = new V3(1e9, 0, 0),
    lastDir = new V3(),
    dir = new V3();
  function rebucket(cam) {
    const ts = performance.now(),
      px = cam.position.x,
      py = cam.position.y,
      pz = cam.position.z;
    cam.updateMatrixWorld();
    pm.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    frus.setFromProjectionMatrix(pm);
    for (const P of protos) for (const L of P.lods) for (const s of L.slots) s.n = 0;
    for (const c of cells.values()) {
      const ax = c.cx - px,
        ay = c.cy - py,
        az = c.cz - pz,
        dc = Math.sqrt(ax * ax + ay * ay + az * az);
      if (dc - HALF > R_TREE + MARGIN) continue;
      if (dc > 100) {
        sph.center.set(c.cx, c.cy + 8, c.cz);
        sph.radius = HALF + 22;
        if (!frus.intersectsSphere(sph)) continue;
      }
      for (const [pi, L] of c.lists) {
        if (!L.n) continue;
        const P = protos[pi];
        for (const lod of P.lods) {
          const lo = lod.band[1] > 0 ? lod.band[0] - MARGIN : -1,
            hi = lod.band[3] + MARGIN;
          if (dc + HALF + 15 < lo || dc - HALF - 15 > hi) continue;
          if (dc - HALF - 15 >= lo && dc + HALF + 15 <= hi) {
            for (const s of lod.slots) s.bulk(L.m, L.c, L.n);
            continue;
          }
          const m = L.m;
          for (let i = 0; i < L.n; i++) {
            const o = i * 16,
              dx = m[o + 12] - px,
              dy = m[o + 13] - py,
              dz = m[o + 14] - pz,
              d = Math.sqrt(dx * dx + dy * dy + dz * dz);
            if (d >= lo && d <= hi) for (const s of lod.slots) s.one(m, L.c, i);
          }
        }
      }
    }
    for (const P of protos) for (const L of P.lods) for (const s of L.slots) s.end();
    const ms = performance.now() - ts;
    st.rebucket++;
    st.rebucketMs += ms;
    st.lastRebucketMs = ms;
  }
  // (r2-veg) terrain changed under a generated cell (relief switched on / off, a tile's terrain rebuilt): re-sample it. Three lattice
  // heights per cell are the signature; cells near the camera are checked every 2 s and regenerated when one moved > 2 cm
  const hSig = (c) =>
    [
      [0.25, 0.25],
      [0.75, 0.5],
      [0.4, 0.8],
    ].map(([u, v]) =>
      terrain.heightAt(
        Math.round((c.x0 + u * CELLS) / GRID) * GRID,
        Math.round((c.z0 + v * CELLS) / GRID) * GRID,
      ),
    );
  let hsT = 0;
  function terrainCheck(cam, now) {
    if (now - hsT < 2000) return;
    hsT = now;
    let moved = 0;
    for (const c of cells.values()) {
      if (!c.lv.t || !c.hs || Math.hypot(c.cx - cam.position.x, c.cz - cam.position.z) > 260)
        continue;
      const h = hSig(c);
      if (h.some((v, i) => Math.abs(v - c.hs[i]) > 0.02)) {
        moved++;
        if (REGEN_IN_PLACE) {
          c.regen = true;
          regenPending++;
        } else {
          c.lists.clear();
          c.lv.t = c.lv.s = c.lv.g = 0;
          c.grid = null;
          c.hs = null;
          dirty = true;
        }
      }
    }
    if (moved) {
      meshGround(terrain).flush?.();
      st.resampled = (st.resampled || 0) + moved;
    }
  }
  // world_nov19b (user: "things are loading in way too last second"): when the terrain under a cell changed (its LOD streamed
  // in) the cell was emptied and re-planted level by level over the next frames, so every plant in it blinked out and popped
  // back near the camera. The cell now keeps its plants until it is re-planted in one step (nearest first, ~2 ms a frame).
  let regenPending = 0;
  function regenCells(cam, budgetMs) {
    if (!regenPending) return;
    const t0 = performance.now();
    for (;;) {
      let best = null,
        bd = Infinity;
      for (const c of cells.values()) {
        if (!c.regen) continue;
        const d = (c.cx - cam.position.x) ** 2 + (c.cz - cam.position.z) ** 2;
        if (d < bd) {
          bd = d;
          best = c;
        }
      }
      if (!best) {
        regenPending = 0;
        return;
      }
      regenPending = Math.max(0, regenPending - 1);
      const had = { ...best.lv };
      best.regen = false;
      best.lists.clear();
      best.lv.t = best.lv.s = best.lv.g = 0;
      best.grid = null;
      best.hs = null;
      if (had.t) genTrees(best);
      if (had.s) genShrubs(best);
      if (had.g) genGround(best);
      seal(best);
      dirty = true;
      if (performance.now() - t0 > budgetMs) return;
    }
  }
  let frame = 0,
    lotsSeen = -1,
    lotsT = 0,
    solidSeen = -1,
    solidT = 0;
  function update(cam, force = false) {
    if (!cam) return;
    frame++;
    // houses planned after a cell was generated: regenerate nearby plant levels so nothing grows under / inside a new house
    // (filter in place, at most once a second: the other plants stay exactly where they are)
    const nl = houseLots.list ? houseLots.list.size + houseLots.reserved.length : 0,
      now = performance.now();
    if (nl !== lotsSeen && now - lotsT > 1000) {
      lotsSeen = nl;
      lotsT = now;
      for (const c of cells.values()) {
        if (Math.hypot(c.cx - cam.position.x, c.cz - cam.position.z) > 800) continue;
        c.grid = null;
        if (c.lv.t && Math.hypot(c.cx - cam.position.x, c.cz - cam.position.z) < 450)
          addLotTrees(c);
        if (c.lv.s && Math.hypot(c.cx - cam.position.x, c.cz - cam.position.z) < 450)
          addLotHedges(c);
        for (const L of c.lists.values()) {
          const tr = L.cls === 'tree';
          let w = 0;
          for (let i = 0; i < L.n; i++) {
            if (
              tr
                ? inLotCore(L.m[i * 16 + 12], L.m[i * 16 + 14])
                : inLotInner(L.m[i * 16 + 12], L.m[i * 16 + 14])
            )
              continue;
            if (w !== i) {
              L.m.copyWithin(w * 16, i * 16, i * 16 + 16);
              L.c.copyWithin(w * 3, i * 3, i * 3 + 3);
            }
            w++;
          }
          if (w !== L.n) {
            L.n = w;
            dirty = true;
          }
        }
      }
    }
    // docks / decks / piers built after a cell was generated (static colliders appear as tiles and set pieces stream in): drop the
    // trees and plants now standing in one (mangroves beside a dock were growing through it)
    if (solidRev && now - solidT > 1000) {
      const rv = solidRev();
      if (rv !== solidSeen) {
        solidSeen = rv;
        solidT = now;
        for (const c of cells.values()) {
          if (Math.hypot(c.cx - cam.position.x, c.cz - cam.position.z) > 200) continue;
          for (const [pi, L] of c.lists) {
            const P = protos[pi];
            if (P.cls !== 'tree') continue;
            let w = 0;
            for (let i = 0; i < L.n; i++) {
              if (
                BLOCKED &&
                BLOCKED(L.m[i * 16 + 12], L.m[i * 16 + 14], P.cls === 'tree' ? 1.2 : 0.3)
              )
                continue;
              if (w !== i) {
                L.m.copyWithin(w * 16, i * 16, i * 16 + 16);
                L.c.copyWithin(w * 3, i * 3, i * 3 + 3);
              }
              w++;
            }
            if (w !== L.n) {
              L.n = w;
              dirty = true;
            }
          }
        }
      }
    }
    try {
      terrainCheck(cam, now);
      regenCells(cam, 2);
    } catch (e) {
      /* never break the streamer */
    }
    const jump = cam.position.distanceTo(lastPos) > 300;
    // after a teleport / at start: fill the surroundings synchronously so the first frame is complete
    const pending =
      jump || force ? work(cam, 1500, 360) : work(cam, (st.pending || 0) > 150 ? 6 : 2.5); // (vegetation) a jump fills the near 360 m at once (max 1.5 s), the rest streams in over the next frames
    cam.getWorldDirection(dir);
    if (
      dirty ||
      jump ||
      force ||
      cam.position.distanceToSquared(lastPos) > 25 ||
      dir.dot(lastDir) < 0.994
    ) {
      rebucket(cam);
      lastPos.copy(cam.position);
      lastDir.copy(dir);
      dirty = false;
    }
    st.pending = pending;
  }
  function stats() {
    let draws = 0,
      inst = 0,
      tris = 0;
    const byCls = {},
      byTris = {};
    for (const P of protos)
      P.lods.forEach((L, l) => {
        for (const s of L.slots)
          if (s.n) {
            draws++;
            inst += s.n;
            const t =
              s.n * (s.geo.index ? s.geo.index.count / 3 : s.geo.attributes.position.count / 3);
            tris += t;
            byCls[P.cls + l] = (byCls[P.cls + l] || 0) + s.n;
            byTris[P.cls + l] = Math.round((byTris[P.cls + l] || 0) + t);
          }
      });
    return {
      cells: cells.size,
      drawCalls: draws,
      instances: inst,
      tris: Math.round(tris),
      byClassLod: byCls,
      trisByClassLod: byTris,
      gen: st.gen,
      genAvgMs: +(st.genMs / Math.max(1, st.gen)).toFixed(2),
      genMaxMs: +st.maxMs.toFixed(1),
      rebuckets: st.rebucket,
      rebucketAvgMs: +(st.rebucketMs / Math.max(1, st.rebucket)).toFixed(2),
      lastRebucketMs: +st.lastRebucketMs.toFixed(2),
      pending: st.pending,
      initMs: Math.round(initMs),
    };
  }
  function dispose() {
    group.removeFromParent();
    for (const P of protos) for (const L of P.lods) for (const s of L.slots) s.im.dispose();
    cells.clear();
    if (active === api) active = null;
  }
  const initMs = performance.now() - t0;
  function nearestTree(x, z, kind = null) {
    let best = null,
      bd = Infinity;
    for (const c of cells.values())
      for (const [pi, L] of c.lists) {
        const k = protos[pi].key.split('#')[0];
        if (!TREE_KINDS[k] || (kind && k !== kind)) continue;
        for (let i = 0; i < L.n; i++) {
          const d = (L.m[i * 16 + 12] - x) ** 2 + (L.m[i * 16 + 14] - z) ** 2;
          if (d < bd) {
            bd = d;
            best = { kind: k, x: L.m[i * 16 + 12], y: L.m[i * 16 + 13], z: L.m[i * 16 + 14] };
          }
        }
      }
    return best;
  }
  function treesNear(x, z, r) {
    const out = [];
    for (const c of cells.values()) {
      if (Math.abs(c.cx - x) > r + CELLS || Math.abs(c.cz - z) > r + CELLS) continue;
      for (const [pi, L] of c.lists) {
        const k = protos[pi].key.split('#')[0];
        if (!TREE_KINDS[k]) continue;
        for (let i = 0; i < L.n; i++) {
          const o = i * 16,
            tx = L.m[o + 12],
            tz = L.m[o + 14];
          if (
            (tx - x) ** 2 + (tz - z) ** 2 > r * r ||
            (L.m[o] === 0 && L.m[o + 1] === 0 && L.m[o + 2] === 0)
          )
            continue;
          out.push({
            kind: k,
            palm: !!TREE_KINDS[k].palm,
            x: tx,
            y: L.m[o + 13],
            z: tz,
            s: Math.hypot(L.m[o], L.m[o + 1], L.m[o + 2]),
          });
        }
      }
    }
    return out;
  }
  function rejectArea(b) {
    // a new blocked area (game.vegetation.block): regenerate the cells it touches
    const x0 = b.r !== undefined ? b.x - b.r : b.x0,
      x1 = b.r !== undefined ? b.x + b.r : b.x1,
      z0 = b.r !== undefined ? b.z - b.r : b.z0,
      z1 = b.r !== undefined ? b.z + b.r : b.z1;
    for (const c of cells.values())
      if (c.x0 < x1 + 4 && c.x0 + CELLS > x0 - 4 && c.z0 < z1 + 4 && c.z0 + CELLS > z0 - 4) {
        c.lists.clear();
        c.lv.t = c.lv.s = c.lv.g = 0;
        c.grid = null;
        dirty = true;
      }
  }
  // (r2-veg, for r2-physics) ground-cover rocks near (x, z) with their exact instance matrices and the proto's local vertex positions
  function rocksNear(x, z, r, minS = 0.2) {
    const out = [];
    for (const c of cells.values()) {
      if (Math.abs(c.cx - x) > r + CELLS || Math.abs(c.cz - z) > r + CELLS) continue;
      for (const [pi, L] of c.lists) {
        const P = protos[pi];
        if (!P.key.startsWith('rock')) continue;
        const geo = P.lods[0]?.slots[0]?.geo;
        if (!geo) continue;
        for (let i = 0; i < L.n; i++) {
          const o = i * 16,
            rx = L.m[o + 12],
            rz = L.m[o + 14];
          if ((rx - x) ** 2 + (rz - z) ** 2 > r * r) continue;
          const s = Math.hypot(L.m[o], L.m[o + 1], L.m[o + 2]);
          if (s < minS) continue;
          out.push({
            key: c.k + ':' + pi + ':' + i,
            x: rx,
            y: L.m[o + 13],
            z: rz,
            s,
            m: L.m.slice(o, o + 16),
            pos: geo.attributes.position.array,
          });
        }
      }
    }
    return out;
  }
  const api = {
    group,
    update,
    stats,
    dispose,
    reject,
    rejectArea,
    protos,
    nearestTree,
    treesNear,
    rocksNear,
    cells,
    touch() {
      dirty = true;
    },
    /* vegGround.v2.js: ground-truth pass edits the sealed lists in place */ biomeAt: (x, z) =>
      BKEYS[biomeOf(ctx, x, z) - 1] || null,
  };
  active = api;
  return api;
}
