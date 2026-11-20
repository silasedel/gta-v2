// Miami city — per-tile builders: near (full detail), mid (single merged mesh), far (per chunk), colliders.
import * as THREE from 'three';
import { Batch, orient, wallStrip, parapet, palmGeometry, capPoly } from '../city/geo.js';
import { rng } from '../city/tex.js';
import { buildGeometry as vegGeometry } from '../vegetation/index.js';
import { makeVegMaterial } from '../vegetation/materials.js';
import { createTileBatcher } from './tileBatch.js';
const TREEPITS3 = typeof location !== 'undefined' && /[?&]treepits=3\b/.test(location.search);
import { grassCardMap, weedCard, clumpCard } from '../vegetation/grasscards.js';
import { bakeImpostor } from '../vegetation/field.js';
import { meshGround } from '../vegetation/ground.js';
import {
  polyFrame,
  ribbon,
  sideWall,
  fillPoly,
  polyArea,
  quadUp,
  wallGaps,
  fillPolyDown,
} from './geom.js';
import { curbLine, curbChains } from './curbs.js';
import {
  buildJunction,
  sampleFrame,
  convexCCW,
  subtractConvex,
  bboxOf,
  spandrelFan,
  clipToConvex,
} from './roadgeo.js';

const PASTELS = [
  0xf1cfc2, 0xc4e2da, 0xf3e4bc, 0xdcd3e2, 0xf1d6bc, 0xd3e3c8, 0xcadde6, 0xecccc6, 0xf6efe4,
  0xfbf1da, 0xe9d5dc, 0xcde4df,
]; // r2-art: sun-faded (was candy pastels)
const OFFICE_TINTS = [
  0xf2ece2, 0xe8d2b4, 0xf5c9a8, 0xcfdce6, 0xefe0c8, 0xd9c4b4, 0xfaf3e8, 0xe6b8a0, 0xc8d8c8,
  0xf0d8a0, 0xd8c8e0,
];
const GLASS_TINTS = [
  0xb4d6f4, 0xa0eee4, 0xf0d0a4, 0xf0f6fa, 0xbce8cc, 0x9cc0ec, 0xdce8f4, 0xc8f0ff,
];
const MED = [0xf4e4c8, 0xf2d6b0, 0xfbefe0, 0xe8c9a0, 0xfff3d6];
const NEONS = [0xff2bd6, 0x23f0ff, 0xff7a1a, 0x9d4dff, 0x3dff8f, 0xff3366];
const SIDEWALK_W = 3.0,
  CURB = 0.15;
import { VARIANTS, pickFacade } from './facades.js';
import { boatVariants, BOAT_LEN } from './boats.js';
import { FBatch, facadeWalls, WL, WIN, BIT } from '../city/facade.js';
import { createBuildingModels, CASINO, AIRPORT, LIB as LIBMODELS } from './bldmodels.js';
import { buildingStyle, podiumStyle, groundStyle } from '../city/families.js';
import { lots as houseLots } from '../setpieces/houses/lots.js';
import { groundClaims } from '../ground/claims.js';
const R4SLAB = !(typeof location !== 'undefined' && /[?&]r4slab=0\b/.test(location.search)); // r4-shoreland: no seawall cap on natural inland banks
const MAPFIX_OFF = typeof location !== 'undefined' && /[?&]mapfix=0\b/.test(location.search); // map audit fixes A/B (tools/v2/map-audit.mjs)
const GC_OFF = typeof location !== 'undefined' && /[?&]groundfix=0/.test(location.search); // ground-continuity before/after switch (audit only)
// physics-audit: tile prop colliders wait for the near build that draws the props (?propgate=0 = old behavior)
const PROP_GATE = !(typeof location !== 'undefined' && /[?&]propgate=0\b/.test(location.search));
const AUD = { src: '?', on: false }; // road surface audit: source tag of the vertices being written (surfaceTile)
const ROADFIX = !(typeof location !== 'undefined' && /[?&]roadfix=0\b/.test(location.search)); // roads pass (Nov 19) master switch: ?roadfix=0 = every road-surface fix of this pass off (before shots)
const CURB3D =
  ROADFIX && !(typeof location !== 'undefined' && /[?&]curb3d=0\b/.test(location.search)); // roads pass: poured curb + gutter profile (curbs.js); ?curb3d=0 = old box faces
import { occupancy } from '../ground/occupancy.js';
import { surfaceMask } from '../ground/surfaceMask.js';
import { patchTerrainEdges } from '../ground/groundEdge.js';
const GM_KIND = {
  asphalt: 'asphalt',
  junction: 'asphalt',
  dirtRoad: 'asphalt',
  parking: 'paved',
  promenade: 'paved',
  panels: 'paved',
  sidewalk: 'paved',
  wood: 'paved',
  runway: 'paved',
  taxiway: 'paved',
  apron: 'paved',
}; // ground pass: hard surfaces in the ground mask
import { breakables } from './breakables.js';
import { shopAprons } from '../shops/frontage.js';
import { shopRoomsMaterial, roomKind } from '../shops/roomGlass.js';
import { shopSignAtlas, signQuad } from '../city/shopSigns.js';
const AWN3D = !(typeof location !== 'undefined' && /[?&]shops=0\b/.test(location.search)); // shops pass: 3D scalloped shell awnings
const SHOP_APRONS = !(typeof location !== 'undefined' && /[?&]aprons=0\b/.test(location.search)); // shops pass A/B: ?aprons=0 = before
import { dynProps } from '../props/dynamicProps.v2.js';
import { physOf, boundsOf } from '../props/propShapes.v2.js';
import { variantColor } from '../props/variants.v2.js';
import { signalLayout } from './signals.js';
import { drawBlade } from '../signs/draw.js';
import { bladeLabel } from '../signs/plan.js';
import { covers as COVERS, placeCovers } from '../surfaces/covers.js'; // r2-roads: utility covers (library manholes / inlets / valves)
import { attachRoadChannel, setRoad, applyRoadChannel } from '../surfaces/roadChannel.js';
import { SURF_OFF } from '../surfaces/surfaceShaders.js'; // surfaces pass: lane frame for the asphalt / paint / decal shaders
const TB_YIELD = !(typeof location !== 'undefined' && /[?&]tbyield=0\b/.test(location.search));
const PROPS_SINK = !(typeof location !== 'undefined' && /[?&]propsink=0\b/.test(location.search)); // r2-perf: props-only road pass for the collider job // r2-perf: time-based yields in the building loops
const CLIP_OFF = typeof location !== 'undefined' && /[?&]clipfix=0/.test(location.search); // clipping-sweep before/after switch (audit only)
import { ladder, LADDER_ON } from '../ground/depthLadder.js'; // W4: one strict ground depth ladder (y stack + polygonOffset rungs)
const VEGLOD = !(typeof location !== 'undefined' && /[?&]veglod=0\b/.test(location.search)); // W4 longer palm / tree LOD bands (?veglod=0 = old)
const IMP_MAX = VEGLOD ? 580 : 480; // impostors cover the whole near-tile ring (tiles stay near to ~430 m from their centre)
// W4 far vegetation cache (?farveg=0 = off): a near tile's impostor instances stay in the city-wide pools after the tile drops back to
// its mid / far mesh (which has no plants), out to FAR_MAX; they leave when the tile's near build returns or the camera is far away.
// Before, every palm and tree beyond the near ring simply did not exist, so they all popped in at the ring edge.
const BLD_SLIVER = !(typeof location !== 'undefined' && /[?&]bldsliver=0\b/.test(location.search));
const FARVEG = !(typeof location !== 'undefined' && /[?&]farveg=0\b/.test(location.search)),
  FAR_MAX = 1300;
// perf A/B: empty prop pools stay visible (old behaviour) with ?poolhide=0 or POOL_KEEP_EMPTY.on = true at run time
export const POOL_KEEP_EMPTY = {
  on: typeof location !== 'undefined' && /[?&]poolhide=0\b/.test(location.search),
};
// ground pass (Nov 19): A/B switches. ?lamppool=1 = the old tile lamp-pool quads; ?plazaclip=0 = raised
// plazas drawn as the raw OSM polygon (over the road, chamfer onto the asphalt) instead of clipped like a sidewalk.
const OLD_LAMP_POOLS = typeof location !== 'undefined' && /[?&]lamppool=1\b/.test(location.search);
const PLAZA_CLIP = !(typeof location !== 'undefined' && /[?&]plazaclip=0\b/.test(location.search));
const SH_Y = LADDER_ON ? 0.058 : 0.05; // W4: shoulders sit between the junction fill (0.055) and the decals (0.062), matching their ladder rung
const EXIT_Y = CLIP_OFF ? 0.008 : -0.012; // beach exit aprons sit 2 cm under the sand areas (0.01), not 2 mm (z-fight)
const FAC = {
  ...VARIANTS,
  office: [8, 8, 24, 28],
  deco: [4, 4, 16, 13.6],
  glass: [16, 16, 32, 64],
  band: [16, 8, 24, 30.4],
  warehouse: [6, 1, 24, 12],
};

export function createTileBuilder(ctx) {
  let curWeeds = null;
  let _cwKit;
  function curbWeedKit() {
    // ground pass: photographed weed / grass-clump cards for the gutter cracks (one shared material, 3 variants)
    if (_cwKit !== undefined) return _cwKit;
    _cwKit = null;
    try {
      const rr = globalThis.game?.renderer;
      const vm = makeVegMaterial('leaf', {
        map: grassCardMap(rr),
        alphaTest: 0.38,
        lean: 0.02,
        sway: 0.02,
        wear: 0.15,
        transl: 0.6,
        tint: 0.85,
      });
      _cwKit = {
        geos: [weedCard(5).leaf, weedCard(9).leaf, clumpCard(13, { h: 0.26 }).leaf],
        mat: vm.mat,
        depth: vm.depth,
      };
    } catch (e) {
      console.warn('[ground] curb weeds unavailable', e);
    }
    return _cwKit;
  }
  const GMASK = surfaceMask(),
    GM_ON = !GMASK.off; // ground pass: top-down hard-surface mask (src/world/ground/surfaceMask.js)
  if (ctx.terrain && ctx.terrain.nearMat)
    patchTerrainEdges(ctx.terrain.nearMat, {
      sand: ctx.terrain.LI?.sand,
      gravel: ctx.terrain.LI?.base,
      dirt: ctx.terrain.LI?.dirt,
      shell: ctx.terrain.LI?.shell,
      lawn: ctx.terrain.LI?.lawn,
      mulch: ctx.terrain.LI?.forest,
    }); // ground pass: shoulders / crumbs / no ground through roads
  if (ctx.terrain && ctx.terrain.lodMat)
    patchTerrainEdges(ctx.terrain.lodMat, {
      sand: ctx.terrain.LI?.sand,
      gravel: ctx.terrain.LI?.base,
      dirt: ctx.terrain.LI?.dirt,
      shell: ctx.terrain.LI?.shell,
      lawn: ctx.terrain.LI?.lawn,
      mulch: ctx.terrain.LI?.forest,
    }); // ground pass: mid / far terrain gets the road-graph shoulder too
  const {
    M,
    provider,
    root,
    world,
    RAPIER,
    zoneAt,
    nodeAt,
    models = {},
    onProps = null,
    onSidewalk = null,
    groundAt = null,
    roadDirAt = null,
    isWater = null,
    roadDist = null,
  } = ctx;
  // ---- V2 world-render: terrain, flora and relief (src/world/terrain/) ----
  const terrain = ctx.terrain || null,
    flora = ctx.flora || null,
    D = ctx.data || null;
  const TH = (x, z) => (D && D.terrainHeightAt ? D.terrainHeightAt(x, z) : 0);
  const HARD_CLS = new Set([
    'paved',
    'parking',
    'plaza',
    'marina',
    'pool',
    'runway',
    'taxiway',
    'apron',
  ]);
  const LAWN_CLS = new Set(['park', 'grass', 'garden', 'cemetery', 'golf', 'pitch', 'playground']);
  const synthArea = (a) =>
    !!(
      terrain &&
      a.kind !== 'pool' &&
      !HARD_CLS.has(a.cls) &&
      !terrain.real(a.rings[0][0][0], a.rings[0][0][1])
    );
  // relief tiles: every vertex written through a lifted batch is raised onto the terrain (k = null) or by a constant (building base)
  function liftB(b, L) {
    if (!b || !b.p || b._lifted) return b;
    const v0 = b.vert;
    b._lifted = true;
    b.vert = function (x, y, z, nx, ny, nz, u, vv, col) {
      if (!L.on) return v0.call(this, x, y, z, nx, ny, nz, u, vv, col);
      const dy = L.k !== null ? L.k : TH(x, z);
      if (this.s) {
        const g0 = this.s[8];
        this.s[8] = g0 + dy;
        v0.call(this, x, y + dy, z, nx, ny, nz, u, vv, col);
        this.s[8] = g0;
      } else v0.call(this, x, y + dy, z, nx, ny, nz, u, vv, col);
    };
    return b;
  }
  const baseOf = (b) => {
    let m = TH(b.cx ?? b.rings[0][0][0], b.cz ?? b.rings[0][0][1]);
    for (const [x, z] of b.rings[0]) m = Math.min(m, TH(x, z));
    return m - 0.05;
  };
  function liftProps(props) {
    if (!D || props._lifted) return;
    props._lifted = true;
    for (const k in props) {
      const L = props[k];
      if (!Array.isArray(L)) continue;
      for (const it of L) {
        if (!it || typeof it.x !== 'number' || typeof it.z !== 'number') continue;
        const h = TH(it.x, it.z);
        if (h > 0.3 && (it.y || 0) < h - 0.25) it.y = (it.y || 0) + h;
      }
    }
  }
  const densify = (pts, step) => {
    const out = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1],
        b = pts[i],
        L = Math.hypot(b[0] - a[0], b[1] - a[1]),
        n = Math.max(1, Math.ceil(L / step));
      for (let k = 1; k <= n; k++)
        out.push(k === n ? b : [a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
    }
    return out;
  };
  function* floraInto(t, tile, props) {
    if (props.veg !== undefined) return;
    props.veg = null;
    const T0 = provider.tileSize || 200,
      V = {};
    yield* flora.scatter(
      t.tx * T0,
      t.tz * T0,
      T0,
      {
        data: D,
        terrain,
        roadDist,
        inBuilding: (x, z) =>
          insideBuilding(tile, x, z) ||
          houseLots.claimedNear(buildingsOf(tile, false), x, z, 4) ||
          (houseLots.reserved.length > 0 && houseLots.reservedAt(x, z, 3.5)) ||
          !!(CLAIMS.list.length && CLAIMS.at(x, z, 1.5)),
      },
      V,
    );
    if (V.palm) props.palm.push(...V.palm);
    if (V.oats) props.oats.push(...V.oats);
    if (V.tree) props.tree.push(...V.tree);
    props.veg = V;
  }
  function stiltPiles(B, b) {
    // timber piles under a raised Keys house (minH set in buildingsOf)
    const r = b.rings[0],
      H = b.minH || 2.7;
    let cx = 0,
      cz = 0;
    for (const [x, z] of r) {
      cx += x;
      cz += z;
    }
    cx /= r.length;
    cz /= r.length;
    const pile = (x, z) => {
      const dx = cx - x,
        dz = cz - z,
        l = Math.hypot(dx, dz) || 1;
      fastBox(
        B.wood,
        x + (dx / l) * 0.35,
        H / 2 - 0.3,
        z + (dz / l) * 0.35,
        0.13,
        H / 2 + 0.3,
        0.13,
        0xffffff,
      );
    };
    for (let i = 0; i < r.length; i++) {
      const a = r[i],
        c = r[(i + 1) % r.length];
      pile(a[0], a[1]);
      const L = Math.hypot(c[0] - a[0], c[1] - a[1]);
      for (let k = 1, n = Math.floor(L / 3.2); k < n; k++)
        pile(a[0] + ((c[0] - a[0]) * k) / n, a[1] + ((c[1] - a[1]) * k) / n);
    }
  }
  // ---- airport markings: runway sides, centerline, thresholds, designators, touchdown zone, aiming points; taxiway lines + hold-short ----
  let airMarks = null;
  function frameOf(ring) {
    let mx = 0,
      mz = 0;
    for (const [x, z] of ring) {
      mx += x;
      mz += z;
    }
    mx /= ring.length;
    mz /= ring.length;
    let sxx = 0,
      szz = 0,
      sxz = 0;
    for (const [x, z] of ring) {
      const dx = x - mx,
        dz = z - mz;
      sxx += dx * dx;
      szz += dz * dz;
      sxz += dx * dz;
    }
    const an = 0.5 * Math.atan2(2 * sxz, sxx - szz),
      ux = Math.cos(an),
      uz = Math.sin(an);
    let a0 = Infinity,
      a1 = -Infinity,
      b0 = Infinity,
      b1 = -Infinity;
    for (const [x, z] of ring) {
      const s = (x - mx) * ux + (z - mz) * uz,
        q = -(x - mx) * uz + (z - mz) * ux;
      a0 = Math.min(a0, s);
      a1 = Math.max(a1, s);
      b0 = Math.min(b0, q);
      b1 = Math.max(b1, q);
    }
    const cs = (a0 + a1) / 2,
      cq = (b0 + b1) / 2;
    return {
      cx: mx + ux * cs - uz * cq,
      cz: mz + uz * cs + ux * cq,
      ux,
      uz,
      L: a1 - a0,
      W: b1 - b0,
    };
  }
  // r2-art: hip roof with a ridge (local: eaves on y = 0 over [-L/2, L/2] x [-W/2, W/2], L >= W, ridge along x at height rh),
  // planar UVs in meters (x, z) like the roof slabs; cached per rounded size
  let _dishG = null;
  const ART_GEO_N = (globalThis.__artGeo = globalThis.__artGeo || {
    balc: 0,
    eyebrow: 0,
    fins: 0,
    hip: 0,
  }); // r2-art debug counters (buildings that got each detail)
  const _hipCache = new Map(),
    ARTGEO_OFF = typeof location !== 'undefined' && /[?&]artgeo=0\b/.test(location.search); // r2-art before/after: the old roofs, window depth only up to 40 m / 6 floors
  function hipRoofGeo(L, W, rh) {
    const k = `${L.toFixed(1)}|${W.toFixed(1)}|${rh.toFixed(1)}`;
    if (_hipCache.has(k)) return _hipCache.get(k);
    const a = L / 2,
      c = W / 2,
      r = Math.max(0, a - c),
      P = [],
      U = [];
    const tri = (p, q, t) => {
      for (const v of [p, q, t]) {
        P.push(v[0], v[1], v[2]);
        U.push(v[0] / 6, v[2] / 6);
      }
    };
    const A = [-a, 0, -c],
      Bq = [a, 0, -c],
      C = [a, 0, c],
      Dd = [-a, 0, c],
      R0 = [-r, rh, 0],
      R1 = [r, rh, 0];
    tri(Dd, C, R1);
    tri(Dd, R1, R0); // +z slope
    tri(Bq, A, R0);
    tri(Bq, R0, R1); // -z slope
    tri(C, Bq, R1);
    tri(A, Dd, R0); // hip ends
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
    g.computeVertexNormals();
    if (_hipCache.size > 400) _hipCache.clear();
    _hipCache.set(k, g);
    return g;
  }
  const SEG7 = [
    'abcdef',
    'bc',
    'abged',
    'abgcd',
    'fgbc',
    'afgcd',
    'afgedc',
    'abc',
    'abcdefg',
    'abcdfg',
  ];
  function buildAirMarks() {
    const out = new Map(),
      cov = D?.mapLayers?.cover || {},
      TS = provider.tileSize || 200;
    const WH = new THREE.Color(0.43, 0.43, 0.42),
      YE = new THREE.Color(0.44, 0.3, 0.03);
    const ringOf = (p) => p.outer || (Array.isArray(p[0]?.[0]) ? p[0] : p);
    const R = (f, s0, s1, q0, q1, col) => {
      if (s1 < s0) [s0, s1] = [s1, s0];
      if (q1 < q0) [q0, q1] = [q1, q0];
      for (let a = s0; a < s1 - 1e-6; a += 50) {
        const b = Math.min(s1, a + 50),
          P = (s, q) => [f.cx + f.ux * s - f.uz * q, 0, f.cz + f.uz * s + f.ux * q],
          c = P((a + b) / 2, (q0 + q1) / 2),
          k = Math.floor(c[0] / TS) + ',' + Math.floor(c[2] / TS);
        if (!out.has(k)) out.set(k, []);
        out.get(k).push([P(a, q0), P(b, q0), P(b, q1), P(a, q1), col]);
      }
    };
    const runways = (cov.runway || []).map(ringOf).filter((r) => r && r.length > 2),
      pip = (r, x, z) => {
        let c = false;
        for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
          const xi = r[i][0],
            zi = r[i][1],
            xj = r[j][0],
            zj = r[j][1];
          if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
        }
        return c;
      };
    const onRunway = (x, z) => runways.some((r) => pip(r, x, z));
    for (const ring of runways) {
      const f = frameOf(ring),
        L = f.L,
        W = f.W;
      if (L < 200 || W < 15) continue;
      R(f, -L / 2 + 2, L / 2 - 2, W / 2 - 2.4, W / 2 - 1.5, WH);
      R(f, -L / 2 + 2, L / 2 - 2, -W / 2 + 1.5, -W / 2 + 2.4, WH); // side stripes
      for (let s = -L / 2 + 90; s + 36 < L / 2 - 90; s += 60) R(f, s, s + 36, -0.45, 0.45, WH); // centerline 36 m dash / 24 m gap
      for (const e of [-1, 1]) {
        const end = (e * L) / 2,
          dir = -e,
          at = (d) => end + dir * d;
        for (let k = 0; ; k++) {
          const q = 3 + 0.9 + k * 3.6;
          if (q + 0.9 > W / 2 - 2.8) break;
          for (const sg of [-1, 1]) R(f, at(6), at(51), sg * (q - 0.9), sg * (q + 0.9), WH);
        } // threshold bars
        const dx = dir * f.ux,
          dz = dir * f.uz;
        let brg = (Math.atan2(dx, -dz) * 180) / Math.PI;
        if (brg < 0) brg += 360;
        let num = Math.round(brg / 10) % 36;
        if (num === 0) num = 36;
        const txt = String(num),
          DW = 9,
          DH = 18,
          st = 1.8,
          tot = txt.length * DW + (txt.length - 1) * 4.5,
          sb = 63;
        [...txt].forEach((ch, i) => {
          const u0 = -tot / 2 + i * (DW + 4.5),
            segs = SEG7[+ch];
          const box = {
            a: [0, DW, DH - st, DH],
            b: [DW - st, DW, DH / 2, DH],
            c: [DW - st, DW, 0, DH / 2],
            d: [0, DW, 0, st],
            e: [0, st, 0, DH / 2],
            f: [0, st, DH / 2, DH],
            g: [0, DW, DH / 2 - st / 2, DH / 2 + st / 2],
          };
          for (const sg of segs) {
            const [ua, ub, wa, wb] = box[sg];
            R(f, at(sb + wa), at(sb + wb), dir * (u0 + ua), dir * (u0 + ub), WH);
          }
        });
        for (const d of [150, 450, 600])
          for (const sg of [-1, 1])
            for (let k = 0; k < (d === 150 ? 3 : d === 450 ? 2 : 1); k++) {
              const q = 6 + k * 3.3;
              if (q + 1.8 < W / 2 - 3) R(f, at(d), at(d + 22.5), sg * q, sg * (q + 1.8), WH);
            } // touchdown zone
        for (const sg of [-1, 1])
          R(f, at(300), at(345), sg * (W / 4 - 2.5), sg * (W / 4 + 4.5), WH); // aiming point
      }
    }
    for (const ring of (cov.taxiway || []).map(ringOf)) {
      if (!ring || ring.length < 3) continue;
      const f = frameOf(ring),
        L = f.L,
        W = f.W;
      if (L < 20) continue;
      R(f, -L / 2, L / 2, -0.22, 0.22, YE); // centerline
      for (const sg of [-1, 1]) {
        R(f, -L / 2, L / 2, sg * (W / 2 - 0.75), sg * (W / 2 - 0.6), YE);
        R(f, -L / 2, L / 2, sg * (W / 2 - 1.05), sg * (W / 2 - 0.9), YE);
      }
      for (const e of [-1, 1]) {
        // hold-short: walk in from the end while on the runway; the line sits 45 m before the runway edge
        const P = (s) => [f.cx + f.ux * s, f.cz + f.uz * s];
        let s = e * (L / 2 + 12);
        const [ex, ez] = P(s);
        if (!onRunway(ex, ez) && !onRunway(...P((e * L) / 2 - e * 2))) continue;
        s = (e * L) / 2;
        while (Math.abs(s) > 1 && onRunway(...P(s))) s -= e * 4;
        const sh = s - e * 45;
        if (Math.abs(sh) > L / 2) continue;
        for (const o of [0.3, 0.9])
          R(f, sh - e * o, sh - e * (o + 0.3), -W / 2 + 1.2, W / 2 - 1.2, YE); // solid (holding side)
        for (const o of [0.3, 0.9])
          for (let q = -W / 2 + 1.2; q < W / 2 - 1.2; q += 1.8)
            R(f, sh + e * o, sh + e * (o + 0.3), q, Math.min(W / 2 - 1.2, q + 0.9), YE); // dashed (runway side)
      }
    }
    for (const ring of (cov.apron || []).map(ringOf)) {
      // stands: lead-in lines + stop bars, apron edge
      if (!ring || ring.length < 3) continue;
      const f = frameOf(ring),
        L = f.L,
        W = f.W;
      if (L < 40 || W < 40) continue;
      for (let s = -L / 2 + 40; s < L / 2 - 30; s += 55) {
        R(f, s - 0.15, s + 0.15, -W / 2 + 25, W / 2 - 8, YE);
        R(f, s - 3, s + 3, W / 2 - 34, W / 2 - 33.6, YE);
      }
      for (const sg of [-1, 1])
        R(f, -L / 2 + 1, L / 2 - 1, sg * (W / 2 - 1.2), sg * (W / 2 - 0.9), YE);
    }
    return out;
  }
  function airportMarks(B, X0, Z0, TS) {
    if (!airMarks) airMarks = buildAirMarks();
    const L = airMarks.get(Math.floor((X0 + 1) / TS) + ',' + Math.floor((Z0 + 1) / TS));
    if (!L) return;
    const y = 0.046;
    for (const [a, b, c, d, col] of L)
      quadUp(
        B.marks,
        [a[0], y, a[2]],
        [b[0], y, b[2]],
        [c[0], y, c[2]],
        [d[0], y, d[2]],
        col,
        1 / 3,
      );
  }
  function* terrainLod(group, ca, cb, CS, cell) {
    if (!terrain || !group) return;
    const T0 = provider.tileSize || 200,
      n = CS / T0;
    let any = false;
    for (let i = 0; i < n && !any; i++)
      for (let j = 0; j < n; j++)
        if (terrain.synthetic(ca * n + i, cb * n + j)) {
          any = true;
          break;
        }
    if (!any) return;
    const r = yield* terrain.gridGen(ca * CS, cb * CS, (ca + 1) * CS, (cb + 1) * CS, cell, {
      lod: true,
    });
    if (!r) return;
    const m = new THREE.Mesh(r.geometry, terrain.lodMat);
    m.name = 'terrain-lod';
    m.receiveShadow = true;
    m.matrixAutoUpdate = false;
    m.updateMatrix();
    group.add(m);
  }

  // ELEVATED agent's module (src/world/miami/elevated.js) owns decks, ramps, barriers and piers when present; otherwise our own deck code runs
  const elevated = ctx.elevated || null;
  const owned = (r) =>
    !!(
      elevated &&
      elevated.ownsEdge &&
      (() => {
        try {
          return elevated.ownsEdge(r.edgeId ?? r.id);
        } catch (e) {
          return false;
        }
      })()
    );
  const okFoot = onSidewalk || (() => true);
  const gY = groundAt || (() => 0);
  const gY0 = (x, z) => {
    const y = gY(x, z);
    return y > 0.5 ? 0 : y;
  }; // ground under any bridge deck (groundAt returns the deck top over bridges)
  // tiles may load asynchronously (data.js): builders wait by yielding
  const getTileG = provider.waitTile
    ? (i, j) => provider.waitTile(i, j)
    : function* (i, j) {
        return provider.getTile(i, j);
      };
  const BOXG = new THREE.BoxGeometry(1, 1, 1),
    CYLG = new THREE.CylinderGeometry(0.5, 0.5, 1, 12);
  const tm = new THREE.Matrix4(),
    tq = new THREE.Quaternion(),
    tp = new THREE.Vector3(),
    ts = new THREE.Vector3(),
    te = new THREE.Euler();
  const mat4 = (x, y, z, ry = 0, sx = 1, sy = 1, sz = 1) =>
    tm.compose(tp.set(x, y, z), tq.setFromEuler(te.set(0, ry, 0)), ts.set(sx, sy, sz));
  const dummy = new THREE.Object3D();

  // ---- shared prop geometry ----
  const pr = rng(4242);
  const palmVariants = [];
  for (let v = 0; v < 12; v++) {
    // 12 variants (vegetation track): coconut, royal, sabal, queen, date; per-instance lean / tint / wear in the shader
    const H = 6 + v * 2 + pr();
    palmVariants.push(
      palmGeometry(v * 2.3 + 1, H, 0.03 + pr() * 0.25, pr, {
        bow: (pr() - 0.5) * 2,
        fronds: 9 + ((pr() * 8) | 0),
        frondLen: 0.8 + pr() * 0.45 + H * 0.015,
        droop: 0.75 + pr() * 0.7,
      }),
    );
  }
  const mergeParts = (parts) => {
    const b = new Batch();
    for (const [g, m, c] of parts) b.addGeometry(g, m.clone ? m.clone() : m, c ?? 0xffffff);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(b.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(b.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(b.c, 3));
    return g;
  };
  const m4 = (x, y, z, ry = 0, sx = 1, sy = 1, sz = 1) =>
    new THREE.Matrix4().compose(
      new THREE.Vector3(x, y, z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry, 0)),
      new THREE.Vector3(sx, sy, sz),
    );
  const lampPoleG = mergeParts([
    [new THREE.CylinderGeometry(0.07, 0.11, 7.5, 8), m4(0, 3.75, 0)],
    [new THREE.CylinderGeometry(0.2, 0.24, 0.6, 8), m4(0, 0.3, 0)],
    [BOXG, m4(0, 7.35, 1.1, 0, 0.09, 0.09, 2.3)],
  ]);
  const lampHeadG = mergeParts([[BOXG, m4(0, 7.22, 2.25, 0, 0.42, 0.14, 0.9)]]);
  const mastG = mergeParts([
    [new THREE.CylinderGeometry(0.11, 0.15, 6.4, 8), m4(0, 3.2, 0)],
    [BOXG, m4(3.6, 6.25, 0, 0, 7.2, 0.14, 0.14)],
  ]);
  const sigHeadG = mergeParts([
    [BOXG, m4(0, 0, 0, 0, 0.42, 1.15, 0.32), 0x2a2d24],
    [BOXG, m4(0, 0.36, 0.17, 0, 0.3, 0.3, 0.02), 0xff3020],
    [BOXG, m4(0, 0, 0.17, 0, 0.3, 0.3, 0.02), 0x332200],
    [BOXG, m4(0, -0.36, 0.17, 0, 0.3, 0.3, 0.02), 0x103018],
  ]);
  const sigMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.6,
    emissive: 0x000000,
  });
  const acG = mergeParts([[BOXG, m4(0, 0.55, 0, 0, 1.8, 1.1, 1.3)]]);
  const poolG = new THREE.PlaneGeometry(11, 11);
  poolG.rotateX(-Math.PI / 2);
  const beaconG = new THREE.SphereGeometry(0.35, 6, 4);
  const boatG = (() => {
    const hull = new THREE.BoxGeometry(2.6, 1.1, 8, 1, 1, 4);
    const HP = hull.attributes.position;
    for (let i = 0; i < HP.count; i++) {
      const z = HP.getZ(i),
        y = HP.getY(i),
        k = Math.max(0, z / 4);
      HP.setX(i, HP.getX(i) * (1 - 0.92 * k * k) * (y < 0 ? 0.75 : 1));
      if (y > 0) HP.setY(i, y + k * 0.35);
    }
    hull.computeVertexNormals();
    return mergeParts([
      [hull, m4(0, 0.25, 0), 0xffffff],
      [BOXG, m4(0, 1.15, -1.0, 0, 1.9, 0.9, 2.6), 0xf2f2f2],
      [BOXG, m4(0, 1.3, 0.35, 0, 1.7, 0.6, 0.08), 0x2a4a5a],
      [BOXG, m4(0, 0.55, 0, 0, 2.62, 0.18, 7.0), 0x1f6f9f],
    ]);
  })();
  const boatGs = boatVariants();
  const containerMat = new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0.35 });
  const blobG = (() => {
    const g = new THREE.IcosahedronGeometry(0.9, 1);
    const P = g.attributes.position;
    const br = rng(17);
    for (let i = 0; i < P.count; i++) {
      const k = 0.82 + br() * 0.36;
      P.setXYZ(i, P.getX(i) * k * 1.1, P.getY(i) * k * 0.8, P.getZ(i) * k);
    }
    g.computeVertexNormals();
    return g;
  })();
  const blobMat = new THREE.MeshStandardMaterial({ roughness: 0.9, flatShading: true });
  // leaf-card bush: 7 intersecting alpha-tested cards around a dome; u in [u0,u0+0.5] selects leaves (0) or flowers (0.5) in the atlas
  function cardBush(u0) {
    const b = new Batch(),
      card = new THREE.PlaneGeometry(1.8, 1.3),
      w = new THREE.Color(1, 1, 1);
    for (let k = 0; k < 7; k++) {
      const a = (k / 7) * Math.PI,
        tilt = k % 2 ? 0.35 : -0.25,
        y = k < 4 ? 0.62 : 0.85;
      b.addGeometry(
        card,
        new THREE.Matrix4().compose(
          new THREE.Vector3(Math.cos(a * 2) * 0.12, y, Math.sin(a * 2) * 0.12),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(tilt, a, 0, 'YXZ')),
          new THREE.Vector3(1, 1, 1),
        ),
        w,
        [0.5, 1],
        [u0, 0],
      );
    }
    const top = new THREE.PlaneGeometry(1.5, 1.5);
    top.rotateX(-Math.PI / 2);
    b.addGeometry(top, m4(0, 1.15, 0), w, [0.5, 1], [u0, 0]);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(b.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(b.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
    // normals point up/out for soft foliage lighting
    const N = g.attributes.normal,
      P = g.attributes.position;
    for (let i = 0; i < N.count; i++) {
      const x = P.getX(i),
        y = P.getY(i) - 0.3,
        z = P.getZ(i),
        l = Math.hypot(x, y, z) || 1;
      N.setXYZ(i, x / l, Math.abs(y / l) + 0.4, z / l);
    }
    g.normalizeNormals();
    return g;
  }
  const leafG = cardBush(0),
    flowerG = cardBush(0.5);
  // street palm LODs (vegetation track): full detail < 48 m, simplified 40-165 m, baked impostor cards 150-480 m; dithered cross-fades
  const PL = VEGLOD ? { b0: 44, e0: 54, b1: 178, e1: 196 } : { b0: 40, e0: 48, b1: 150, e1: 165 },
    palmLod = []; // W4 (Nov 19: palms pop in late at low quality): full mesh to 54 m, simplified to 196 m (the triangle budget holds: impostors take more of the ring), impostor to IMP_MAX, far cache beyond
  try {
    const mk = (f, fade) => {
      const b = makeVegMaterial('bark', { fade, lean: 0.006, sway: 0.0035 }),
        l = makeVegMaterial('leaf', { fade, lean: 0.006, sway: 0.0035 });
      return { bark: b, leaf: l };
    };
    const m0 = mk(0, [0, 0, PL.b0, PL.e0]),
      m1 = mk(1, [PL.b0, PL.e0, PL.b1, PL.e1]),
      ren = ctx.renderer || globalThis.game?.renderer;
    palmVariants.forEach((pg, v) => {
      const a = pg.args,
        g1 = palmGeometry(a[0], a[1], a[2], pr, { ...a[3], lod: 1 }); // same seed -> same palm, fewer triangles
      pg.trunk.userData.lodMax = pg.fronds.userData.lodMax = PL.e0;
      g1.trunk.userData.lodMin = g1.fronds.userData.lodMin = PL.b0;
      g1.trunk.userData.lodMax = g1.fronds.userData.lodMax = PL.e1;
      const L = { g0: pg, g1, m0, m1, imp: null };
      if (ren) {
        try {
          const im = bakeImpostor(
            ren,
            'street_palm',
            v,
            { bark: pg.trunk, leaf: pg.fronds },
            makeVegMaterial('bark').mat,
            makeVegMaterial('leaf').mat,
          );
          im.geometry.userData.lodMin = PL.b1;
          im.geometry.userData.lodMax = IMP_MAX;
          L.imp = {
            geo: im.geometry,
            mat: makeVegMaterial('imp', {
              map: im.texture,
              fade: [PL.b1, PL.e1, 0, 0],
              alphaTest: 0.5,
              transl: 0.5,
            }),
          };
        } catch (e) {
          console.warn('[vegetation] palm impostor bake failed', e);
        }
      }
      if (!L.imp) g1.trunk.userData.lodMax = g1.fronds.userData.lodMax = IMP_MAX;
      palmLod.push(L);
    });
  } catch (e) {
    console.warn('[vegetation] palm LODs unavailable', e);
    palmLod.length = 0;
  }
  // greenery: library-model palms (src/world/vegetation/models.js: royal palm, coconut palm) in the same LOD bands as the street palms
  const modelPalm = {},
    greenMats = []; // greenMats: precompiled with the city materials (no first-sight shader stall)
  // (greenery, overnight) every palm of the user's library (species.js VEG_LIB, cls palm) in the street-palm LOD bands; materials
  // built on first use (a tile that plants that model), so unused models cost nothing
  function modelPalmOf(k, paved = false) {
    const ck = paved ? k + '|p' : k;
    if (ck in modelPalm) return modelPalm[ck];
    const md = flora?.models?.[k];
    if (!md) return null;
    /* (r2-veg) not loaded yet: no cache, a later tile retries (the 1.2 MB fan palms arrive after the first tiles) */ modelPalm[
      ck
    ] = null; // paved: root flare clamped to the trunk (sidewalk palms come out of a grate)
    try {
      const L = md.materials(
          [0, 0, PL.b0, PL.e0],
          [PL.b0, PL.e0, PL.b1, PL.e1],
          [PL.b1, PL.e1, 0, 0],
          paved ? { paved: true } : undefined,
        ),
        nearG = new Set(L.near.map((q) => q.geo));
      for (const q of L.near) q.geo.userData.lodMax = PL.e0;
      L.mid = L.mid.filter((q) => !nearG.has(q.geo));
      for (const q of L.mid) {
        q.geo.userData.lodMin = PL.b0;
        q.geo.userData.lodMax = L.imp ? PL.e1 : IMP_MAX;
      }
      if (L.imp) {
        L.imp.geo.userData.lodMin = PL.b1;
        L.imp.geo.userData.lodMax = IMP_MAX;
      }
      for (const q of [...L.near, ...L.mid, ...(L.imp ? [L.imp] : [])]) greenMats.push(q.mat);
      return (modelPalm[ck] = L);
    } catch (e) {
      console.warn('[vegetation] model palm unavailable', k, e);
      return null;
    }
  }
  modelPalmOf('royal_palm');
  modelPalmOf('coconut_palm'); // shared programs compile with the city materials
  const PALM_MODELS = {
    royal: ['royal_palm'],
    coconut: ['coconut_palm', 'coconut_b', 'coconut_c', 'coconut_d'],
    bent: ['bent_a', 'bent_b', 'bent_c', 'bent_d', 'bent_e'],
    date: ['tropical_palm', 'fanpalm_cal1'],
    queen: ['tropical_palm'],
    fan: [
      'fanpalm_rob1',
      'fanpalm_cal1',
    ] /* two models in the city: each palm model costs its parts' draws per tile (4 models: ~200 extra draws at Ocean Drive) */,
    sabal: ['sabal_palm', 'weathered_b', 'sabal_palm', 'weathered_a', 'weathered_b'],
  };
  // palm species by place (Miami planting): royal palms on boulevards, downtown and the causeways, coconut palms at the beach,
  // a residential mix of coconut / sabal / queen. One species per ~70 m stretch so a street is planted in one species.
  const PALM_MIX = {
    beach: [
      ['coconut', 5],
      ['bent', 4],
      ['sabal', 1],
      ['royal', 1],
    ],
    nightlife: [
      ['fan', 6],
      ['coconut', 3],
      ['royal', 1],
    ] /* (r2-veg) Ocean Drive / South Beach: Mexican fan palm rows */,
    downtown: [
      ['royal', 7],
      ['date', 2],
      ['coconut', 1],
    ],
    business: [
      ['royal', 7],
      ['date', 2],
      ['coconut', 1],
    ],
    brickell: [
      ['royal', 8],
      ['date', 2],
    ],
    midtown: [
      ['royal', 5],
      ['date', 2],
      ['coconut', 2],
      ['fan', 1],
    ],
    edgewater: [
      ['royal', 5],
      ['coconut', 3],
    ],
    causeway: [
      ['royal', 7],
      ['coconut', 3],
    ],
    park: [
      ['royal', 4],
      ['coconut', 3],
      ['sabal', 3],
    ],
    residential: [
      ['coconut', 4],
      ['sabal', 3],
      ['queen', 2],
      ['fan', 3],
      ['royal', 1],
      ['date', 1],
    ],
    rural: [
      ['sabal', 6],
      ['coconut', 2],
    ],
    wilderness: [
      ['sabal', 7],
      ['coconut', 1],
    ],
    _: [
      ['coconut', 3],
      ['sabal', 3],
      ['queen', 2],
      ['royal', 2],
      ['date', 1],
    ],
  };
  const PALM_INLAND_RES = [
      ['sabal', 3],
      ['queen', 2],
      ['fan', 2],
      ['date', 1],
    ],
    palmCoastC = new Map();
  const palmMG = terrain ? meshGround(terrain) : null,
    palmGround = (x, z) => {
      let g = palmMG(x, z);
      for (const [dx, dz] of [
        [0.4, 0],
        [-0.4, 0],
        [0, 0.4],
        [0, -0.4],
      ])
        g = Math.min(g, palmMG(x + dx, z + dz));
      return g;
    }; // (r2-veg) the terrain as drawn
  function palmCoast(x, z) {
    // open / salt water within ~250 m (beach, bay, Keys): where coconut palms grow (r2-veg)
    if (!isWater) return true;
    const k = Math.floor(x / 50) + ',' + Math.floor(z / 50);
    let v = palmCoastC.get(k);
    if (v !== undefined) return v;
    v = false;
    const cx0 = (Math.floor(x / 50) + 0.5) * 50,
      cz0 = (Math.floor(z / 50) + 0.5) * 50;
    for (const d of [60, 140, 240]) {
      let n = 0;
      for (let a = 0; a < 8; a++)
        if (isWater(cx0 + Math.cos(a * 0.785) * d, cz0 + Math.sin(a * 0.785) * d)) n++;
      if (n >= (d < 100 ? 1 : 2)) {
        v = true;
        break;
      }
    } // >= 2 of 8 far samples: open water, not a canal
    palmCoastC.set(k, v);
    return v;
  }
  const pickW = (list, r) => {
    let t = 0;
    for (const e of list) t += e[1];
    let a = r * t;
    for (const e of list) {
      a -= e[1];
      if (a <= 0) return e[0];
    }
    return list[list.length - 1][0];
  };
  const palmProc = {};
  palmVariants.forEach((pg, v) => (palmProc[pg.species] ||= []).push(v));
  function palmKindOf(p) {
    // -> 'm:<library model key>' | procedural variant index (only when the model files are missing)
    let zone = '_';
    try {
      zone = zoneAt(p.x, p.z) || '_';
    } catch (e) {
      /* */
    }
    const cx = Math.floor(p.x / 70),
      cz = Math.floor(p.z / 70),
      hc = hash(cx * 7919 + cz * 104729 + 17),
      hp = hash(((p.x * 13.1) | 0) * 31 + ((p.z * 7.7) | 0));
    let sp = pickW(PALM_MIX[zone] || PALM_MIX._, hc);
    if (
      (p.street || (p.y || 0) > 0.1) &&
      /downtown|business|brickell|midtown|causeway|edgewater/.test(zone) &&
      hp < 0.8
    )
      sp = 'royal'; // curbside palms on the commercial boulevards
    {
      // (r2-veg, item 12) each palm where it fits: royal palms only in avenue rows (curbside, medians, causeways), coconut / bent
      // coconut only near salt or open water (beach, bay, Keys), sabal inland, queen / fan / date in residential and commercial yards
      const ave = !!(p.ave || p.street || p.pit || (p.y || 0) > 0.1),
        hz = hash(cx * 131 + cz * 7919 + 29);
      if (p.park)
        sp = p.park === 'royal' && ave ? 'royal' : palmCoast(p.x, p.z) ? 'coconut' : 'sabal';
      if (sp === 'royal' && !ave)
        sp = palmCoast(p.x, p.z)
          ? 'coconut'
          : /residential|nightlife|midtown/.test(zone)
            ? pickW(PALM_INLAND_RES, hz)
            : 'sabal';
      if ((sp === 'coconut' || sp === 'bent') && !palmCoast(p.x, p.z))
        sp = /residential|nightlife|midtown|_/.test(zone)
          ? pickW(PALM_INLAND_RES, hz)
          : /downtown|business|brickell|edgewater/.test(zone)
            ? 'date'
            : 'sabal';
      if (
        (p.street || p.pit) &&
        sp !== 'royal' &&
        (/nightlife|commercial/.test(zone)
          ? hz < 0.8
          : /residential|midtown|beach|_/.test(zone) && hz < 0.5)
      )
        sp =
          'fan'; /* Mexican fan palm street rows (Ocean Drive, South Beach, residential streets); one species per 70 m stretch */
    }
    const list = PALM_MODELS[sp] || PALM_MODELS.coconut; // one species per stretch, a different model / pose per palm
    for (let k = 0; k < list.length; k++) {
      const key = list[(((hp * 997) | 0) + k) % list.length];
      if (modelPalmOf(key)) return 'm:' + key;
    }
    const vs = palmProc[sp] || palmProc.coconut || [0];
    return vs[((hp * 997) | 0) % vs.length];
  }
  // street trees: near mesh (dithered out 60-76 m) -> impostor baked from the same mesh (to 480 m), like the countryside trees
  const TB = VEGLOD ? { b0: 66, e0: 80 } : { b0: 60, e0: 76 },
    treeLod = {},
    crownR = {}; // W4: street trees keep their mesh to 80 m (the impostor took over at 60 m)
  function treeLodOf(sp, v) {
    const key = sp + '#' + v;
    if (key in treeLod) return treeLod[key];
    treeLod[key] = null;
    const g = flora?.VT?.[sp]?.[v];
    if (!g) return null;
    try {
      const ren = ctx.renderer || globalThis.game?.renderer,
        b = makeVegMaterial('bark', { fade: [0, 0, TB.b0, TB.e0], lean: 0.006, sway: 0.0035 }),
        l = makeVegMaterial('leaf', { fade: [0, 0, TB.b0, TB.e0], lean: 0.006, sway: 0.0035 });
      const L = { g, b, l, imp: null };
      g.bark.userData.lodMax = g.leaf.userData.lodMax = TB.e0 + 2;
      if (ren) {
        const im = bakeImpostor(ren, 'street_tree_' + sp, v, g, null, null, 256);
        im.geometry.userData.lodMin = TB.b0;
        im.geometry.userData.lodMax = IMP_MAX;
        L.imp = {
          geo: im.geometry,
          mat: makeVegMaterial('imp', {
            map: im.texture,
            fade: [TB.b0, TB.e0, 0, 0],
            lean: 0.006,
            sway: 0.0035,
            alphaTest: 0.5,
            transl: 0.5,
          }),
        };
      }
      if (!L.imp) g.bark.userData.lodMax = g.leaf.userData.lodMax = IMP_MAX;
      return (treeLod[key] = L);
    } catch (e) {
      console.warn('[vegetation] street tree LOD failed', sp, e);
      return null;
    }
  }
  function treeCrownR(sp) {
    // horizontal crown radius of a species' street-tree meshes at scale 1
    if (sp in crownR) return crownR[sp];
    let r = 0;
    if (TREE_LIB[sp] && flora?.models) {
      for (const k of TREE_LIB[sp][0]) {
        const md = flora.models[k];
        if (md) r = Math.max(r, md.radius * TREE_LIB[sp][1] * 0.85);
      }
      if (r > 0) return (crownR[sp] = r);
    }
    // (greenery, overnight) library crowns; Nov 19: this fallback had been commented out by accident (code after a `//` on
    // one dense line), so species without a library model returned undefined
    for (const g of flora?.VT?.[sp] || []) {
      const P = g.leaf.attributes.position;
      for (let i = 0; i < P.count; i++) r = Math.max(r, Math.hypot(P.getX(i), P.getZ(i)));
    }
    return (crownR[sp] = r);
  }
  function vegTrees(group, sp, items) {
    if (TREE_LIB[sp] && libInst(group, TREE_LIB[sp][0], items, 'tree', TREE_LIB[sp][1]))
      return true; // (greenery, overnight) library models first
    const VT = flora?.VT?.[sp];
    if (!VT || !VT.length || !M.vegLeaf) return false;
    const per = VT.map(() => []);
    items.forEach((it, i) => per[(i + Math.abs((it.x * 3) | 0)) % per.length].push(it));
    per.forEach((it, v) => {
      if (!it.length) return;
      const L = treeLodOf(sp, v);
      for (const p of it) {
        const h = hash(((p.x * 17) | 0) * 13 + ((p.z * 5) | 0)),
          s = p.s || 1;
        p.sx = p.sz = s * (0.9 + h * 0.2);
        p.sy = s * (0.88 + ((h * 7.13) % 1) * 0.24);
      } // no two the same size / shape
      if (L) {
        inst(group, VT[v].bark, L.b.mat, it, { cast: true, depth: L.b.depth });
        inst(group, VT[v].leaf, L.l.mat, it, { cast: true, depth: L.l.depth });
        if (L.imp) inst(group, L.imp.geo, L.imp.mat.mat, it, { cast: false });
      } else {
        inst(group, VT[v].bark, M.vegBark, it, { cast: true, depth: M.vegBarkDepth });
        inst(group, VT[v].leaf, M.vegLeaf, it, { cast: true, depth: M.vegLeafDepth });
      }
    });
    return true;
  }
  // (greenery, overnight) the user's library trees and shrubs (species.js) through the global pools: full mesh near, the converted
  // LOD1 mesh in the middle, baked impostor far (trees); per-instance mirror / twist / bend / crown spread / color jitter in the shader
  const LIB_B = {
      tree: VEGLOD
        ? [[0, 0, 52, 62], [52, 62, 178, 196], [178, 196, 0, 0], IMP_MAX]
        : [[0, 0, 50, 62], [50, 62, 150, 170], [150, 170, 0, 0], 480],
      shrub: [[0, 0, 40, 52], [40, 52, 105, 135], null, 138],
    },
    libL = {};
  function libLodOf(key, cls) {
    if (key in libL) return libL[key];
    libL[key] = null;
    const md = flora?.models?.[key];
    if (!md) return null;
    try {
      const B = LIB_B[cls] || LIB_B.tree,
        L = md.materials(B[0], B[1], B[2]),
        nearG = new Set(L.near.map((q) => q.geo));
      for (const q of L.near) q.geo.userData.lodMax = B[0][3] + 2;
      L.mid = L.mid.filter((q) => !nearG.has(q.geo));
      for (const q of L.mid) {
        q.geo.userData.lodMin = B[1][0];
        q.geo.userData.lodMax = L.imp ? B[1][3] + 2 : B[3];
      }
      if (L.imp) {
        L.imp.geo.userData.lodMin = B[2][0];
        L.imp.geo.userData.lodMax = B[3];
      }
      for (const q of [...L.near, ...L.mid, ...(L.imp ? [L.imp] : [])]) greenMats.push(q.mat);
      return (libL[key] = L);
    } catch (e) {
      console.warn('[vegetation] library plant unavailable', key, e);
      return null;
    }
  }
  function libInst(group, keys, items, cls, k = 1) {
    // items split over the models of a species group (position hash), scaled by k
    const ok = keys.filter((key) => libLodOf(key, cls));
    if (!ok.length) return false;
    const per = ok.map(() => []);
    for (const p of items) {
      if (roadDist && roadDist(p.x, p.z) < (cls === 'tree' ? 0.5 : 0.2)) continue;
      const h = hash(((p.x * 17) | 0) * 13 + ((p.z * 5) | 0)),
        s = (p.s || 1) * k;
      /* (greenery) never in a lane */ p.sx = p.sz = s * (0.88 + h * 0.24);
      p.sy = s * (0.87 + ((h * 7.13) % 1) * 0.26);
      per[((h * 997) | 0) % ok.length].push(
        cls === 'tree' ? { ...p, y: (p.y || 0) - 0.12 * s } : p,
      );
    }
    per.forEach((it, v) => {
      if (!it.length) return;
      const L = libL[ok[v]];
      for (const q of L.near) inst(group, q.geo, q.mat, it, { cast: true, depth: q.depth });
      for (const q of L.mid) inst(group, q.geo, q.mat, it, { cast: true, depth: q.depth });
      if (L.imp) inst(group, L.imp.geo, L.imp.mat, it, { cast: false });
    });
    return true;
  }
  const TREE_LIB = {
    oak: [['liveoak_b', 'liveoak_c', 'oak_gnarled', 'oak_pale_b'], 1],
    tree: [['liveoak_b', 'liveoak_c', 'shade_tree'], 1],
    gumbo: [['shade_tree', 'oak_pale_b', 'oak_pale_a'], 1.05],
    banyan: [['banyan', 'banyan_b'], 1],
    pine: [['pine_a', 'pine_b', 'pine_c'], 1],
    cypress: [['cypress_a', 'cypress_b'], 0.9],
    mangrove: [['mangrove'], 1.0],
    seagrape: [['rubber_fig'], 0.7],
    citrus: [['oak_pale_a'], 0.45],
    poinciana: [['poinciana_hd1', 'poinciana_hd2', 'poinciana_hd3'], 0.62],
  };
  const BUSH_LIB = {
    blob: [
      'tropical_leaf',
      'green_shrub',
      'fern_clump',
      'tropical_bed',
      'tropical_leaf',
      'hibiscus_shrub',
    ],
    flower: [
      'bougainvillea_hd',
      'hibiscus_shrub',
      'hibiscus_hd',
      'oleander',
      'bougainvillea_hd',
      'oleander',
    ],
  }; // r8: no card-blob shrubs (Shrub 1 / 6, Flower Bush 1)
  // street shrubs (vegetation track): real shrub variants (woody skeleton, leaf clusters, flowers, litter) split over bush / flower-bed props
  const vegBush = { blob: [], flower: [] };
  try {
    for (const [k, s] of [
      ['seagrape', 1],
      ['hibiscus', 2],
      ['croton', 3],
      ['ixora', 4],
      ['seagrape', 5],
      ['croton', 6],
      ['hibiscus', 11],
    ])
      vegBush.blob.push(vegGeometry(k, { seed: s, size: 0.72 }));
    for (const [k, s] of [
      ['bougainvillea', 1],
      ['hibiscus', 7],
      ['ixora', 8],
      ['bougainvillea', 9],
    ])
      vegBush.flower.push(vegGeometry(k, { seed: s, size: 0.68 }));
  } catch (e) {
    console.warn('[vegetation] shrubs unavailable', e);
    vegBush.blob.length = vegBush.flower.length = 0;
  }
  // (greenery) shrubs dissolve out between 105 and 135 m (dithered, TAA-resolved) instead of a hard cut at the pool draw distance
  let bushM = null;
  function vegBushes(group, items, list) {
    bushM ||= {
      b: makeVegMaterial('bark', { fade: [0, 0, 105, 135], lean: 0.006, sway: 0.0035 }),
      l: makeVegMaterial('leaf', { fade: [0, 0, 105, 135], lean: 0.006, sway: 0.0035 }),
    };
    const per = list.map(() => []);
    items.forEach((p, i) => per[(i + Math.abs((p.x * 7) | 0)) % per.length].push(p));
    per.forEach((it, v) => {
      if (!it.length) return;
      const g = list[v];
      g.bark.userData.lodMax = g.leaf.userData.lodMax = 138;
      if (g.bark.index.count)
        inst(group, g.bark, bushM.b.mat, it, { cast: true, depth: bushM.b.depth });
      inst(group, g.leaf, bushM.l.mat, it, { cast: true, depth: bushM.l.depth });
    });
  }
  const oatsG = (() => {
    const b = new Batch(),
      c = new THREE.PlaneGeometry(0.9, 1.1),
      w = new THREE.Color(1, 1, 1);
    for (let k = 0; k < 3; k++)
      b.addGeometry(c, m4(0, 0.55, 0, (k / 3) * Math.PI), w, [0.5, 1], [0, 0]);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(b.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(b.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
    return g;
  })();
  const duneG = (() => {
    const g = new THREE.SphereGeometry(1, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2);
    const uv = g.attributes.uv,
      P = g.attributes.position;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, P.getX(i) * 0.8, P.getZ(i) * 0.8);
    return g;
  })();
  const bikeG = (() => {
    const parts = [];
    for (let k = -2; k <= 2; k++)
      parts.push(
        [BOXG, m4(k * 0.7, 0.45, -0.3, 0, 0.05, 0.9, 0.05), 0x9aa3a8],
        [BOXG, m4(k * 0.7, 0.45, 0.3, 0, 0.05, 0.9, 0.05), 0x9aa3a8],
        [BOXG, m4(k * 0.7, 0.9, 0, 0, 0.05, 0.05, 0.65), 0x9aa3a8],
      );
    return mergeParts(parts);
  })();
  const kioskG = mergeParts([
    [BOXG, m4(0, 0.6, 0, 0, 2.4, 1.0, 1.4), 0xffffff],
    [BOXG, m4(0, 1.15, 0, 0, 2.5, 0.08, 1.5), 0xd9d4cc],
    [
      new THREE.CylinderGeometry(0.33, 0.33, 0.12, 12).rotateX(Math.PI / 2),
      m4(-0.8, 0.33, 0.72),
      0x222222,
    ],
    [
      new THREE.CylinderGeometry(0.33, 0.33, 0.12, 12).rotateX(Math.PI / 2),
      m4(0.8, 0.33, 0.72),
      0x222222,
    ],
    [BOXG, m4(-1.05, 1.85, 0, 0, 0.06, 1.4, 0.06), 0xdddddd],
    [BOXG, m4(1.05, 1.85, 0, 0, 0.06, 1.4, 0.06), 0xdddddd],
    [BOXG, m4(0, 2.6, 0, 0, 2.8, 0.12, 1.9), 0xffffff],
    [BOXG, m4(0, 2.48, 0.96, 0, 2.8, 0.3, 0.04), 0xffffff],
  ]);
  const hutG = mergeParts([
    [BOXG, m4(-1.1, 1.1, -1.1, 0, 0.18, 2.2, 0.18), 0xf2f2f2],
    [BOXG, m4(1.1, 1.1, -1.1, 0, 0.18, 2.2, 0.18), 0xf2f2f2],
    [BOXG, m4(-1.1, 1.1, 1.1, 0, 0.18, 2.2, 0.18), 0xf2f2f2],
    [BOXG, m4(1.1, 1.1, 1.1, 0, 0.18, 2.2, 0.18), 0xf2f2f2],
    [BOXG, m4(0, 2.35, 0, 0, 3.0, 0.15, 3.0), 0xf2f2f2],
    [BOXG, m4(0, 3.5, 0, 0, 2.6, 2.1, 2.6), 0xffffff],
    [BOXG, m4(0, 3.7, 1.32, 0, 2.1, 0.9, 0.04), 0x2a4a5a],
    [BOXG, m4(0, 4.75, 0, 0, 3.4, 0.18, 3.4), 0xffffff],
    [BOXG, m4(0, 1.2, -3.2, 0, 1.1, 0.12, 4.6), 0xe8dcc8],
    [BOXG, m4(0.4, 5.6, 0, 0, 0.06, 1.8, 0.06), 0xdddddd],
  ]);
  const hutMat = new THREE.MeshStandardMaterial({ roughness: 0.6 });
  const cafeG = mergeParts([
    [new THREE.CylinderGeometry(0.45, 0.45, 0.04, 14), m4(0, 0.75, 0), 0xf4f4f4],
    [new THREE.CylinderGeometry(0.04, 0.04, 0.75, 6), m4(0, 0.37, 0), 0x333333],
    [BOXG, m4(-0.8, 0.45, 0, 0, 0.42, 0.05, 0.42), 0x2e6e8e],
    [BOXG, m4(-1.0, 0.7, 0, 0, 0.05, 0.5, 0.42), 0x2e6e8e],
    [BOXG, m4(0.8, 0.45, 0, 0, 0.42, 0.05, 0.42), 0x2e6e8e],
    [BOXG, m4(1.0, 0.7, 0, 0, 0.05, 0.5, 0.42), 0x2e6e8e],
  ]);
  const umbG = mergeParts([
    [new THREE.ConeGeometry(1.5, 0.55, 10, 1, true), m4(0, 2.35, 0)],
    [new THREE.CylinderGeometry(0.03, 0.03, 2.4, 5), m4(0, 1.2, 0)],
  ]);
  const umbMat = new THREE.MeshStandardMaterial({ roughness: 0.8, side: THREE.DoubleSide });
  const bulbG = new THREE.SphereGeometry(0.07, 6, 4);
  // (greenery, overnight) tree grate: 1.5 m cast-iron square, four frame bars, ring of slotted bars around a 0.5 m opening, dark
  // mulch bed below; flush with the sidewalk (2-4 mm), its own iron / soil colors (the old grate showed as flat colored squares)
  // W4 (Nov 19: grates at city palms look flat): a real pit. Light granite edging (4 cm proud of the paving, chamfered by a second
  // narrower course), the iron plate with 2.5 cm deep radial bars and frame, the soil / mulch mound rising in the opening round the
  // trunk; grass tufts grow through it (vegetation/collar.js pit grass). ?pit2=0 = old flat grate.
  const PIT2 = !(typeof location !== 'undefined' && /[?&]pit2=0\b/.test(location.search));
  const grateG = PIT2
    ? (() => {
        const parts = [
          [new THREE.CylinderGeometry(0.7, 0.7, 0.012, 24), m4(0, 0.004, 0), 0x2a2119],
        ];
        for (const [x, z, w, d] of [
          [0, 0.79, 1.7, 0.12],
          [0, -0.79, 1.7, 0.12],
          [0.79, 0, 0.12, 1.46],
          [-0.79, 0, 0.12, 1.46],
        ]) {
          parts.push([BOXG, m4(x, 0.02, z, 0, w, 0.04, d), 0x8f8a80]);
          parts.push([
            BOXG,
            m4(
              x * 1.0,
              0.043,
              z * 1.0,
              0,
              w === 1.7 ? w - 0.03 : 0.09,
              0.008,
              d === 1.46 ? d - 0.03 : 0.09,
            ),
            0x9c978c,
          ]);
        } // granite edging + chamfer course
        for (const [x, z, w, d] of [
          [0, 0.7, 1.4, 0.06],
          [0, -0.7, 1.4, 0.06],
          [0.7, 0, 0.06, 1.4],
          [-0.7, 0, 0.06, 1.4],
        ])
          parts.push([BOXG, m4(x, 0.016, z, 0, w, 0.03, d), 0x343434]); // iron frame
        for (let k = 0; k < 24; k++) {
          const a = (k / 24) * Math.PI * 2,
            r = 0.5;
          parts.push([
            BOXG,
            m4(Math.cos(a) * r, 0.014, Math.sin(a) * r, -a, 0.36, 0.026, 0.03),
            0x3a3836,
          ]);
        } // radial bars
        for (const r of [0.3, 0.66])
          for (let k = 0; k < 18; k++) {
            const a = ((k + 0.5) / 18) * Math.PI * 2;
            parts.push([
              BOXG,
              m4(
                Math.cos(a) * r,
                0.016,
                Math.sin(a) * r,
                Math.PI / 2 - a,
                (2 * Math.PI * r) / 18 + 0.01,
                0.03,
                0.04,
              ),
              0x303030,
            ]);
          } // rings
        parts.push([new THREE.CylinderGeometry(0.08, 0.3, 0.07, 14, 1), m4(0, 0.035, 0), 0x3b2a1c]); // soil / mulch mound in the opening
        for (let k = 0; k < 10; k++) {
          const a = k * 2.4,
            r = 0.12 + (k % 3) * 0.06;
          parts.push([
            BOXG,
            m4(Math.cos(a) * r, 0.062, Math.sin(a) * r, a, 0.06, 0.012, 0.03),
            k % 2 ? 0x5a4127 : 0x6b5a3a,
          ]);
        } // bark chips
        return mergeParts(parts);
      })()
    : (() => {
        const parts = [
          [new THREE.CylinderGeometry(0.72, 0.72, 0.012, 20), m4(0, 0.002, 0), 0x2a2119],
        ];
        for (const [x, z, w, d] of [
          [0, 0.71, 1.5, 0.08],
          [0, -0.71, 1.5, 0.08],
          [0.71, 0, 0.08, 1.5],
          [-0.71, 0, 0.08, 1.5],
        ])
          parts.push([BOXG, m4(x, 0.008, z, 0, w, 0.016, d), 0x343434]);
        for (let k = 0; k < 20; k++) {
          const a = (k / 20) * Math.PI * 2,
            r = 0.47;
          parts.push([
            BOXG,
            m4(Math.cos(a) * r, 0.008, Math.sin(a) * r, -a, 0.42, 0.014, 0.035),
            0x3a3836,
          ]);
        }
        for (const r of [0.27, 0.68])
          for (let k = 0; k < 16; k++) {
            const a = ((k + 0.5) / 16) * Math.PI * 2;
            parts.push([
              BOXG,
              m4(
                Math.cos(a) * r,
                0.009,
                Math.sin(a) * r,
                Math.PI / 2 - a,
                (2 * Math.PI * r) / 16 + 0.01,
                0.016,
                0.04,
              ),
              0x303030,
            ]);
          }
        return mergeParts(parts);
      })();
  const grateMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.8,
    metalness: 0,
    color: new THREE.Color(1.7, 1.7, 1.7),
  });
  grateMat.name = 'tree-grate';
  grateMat.polygonOffset = true;
  grateMat.polygonOffsetFactor = -1;
  grateMat.polygonOffsetUnits = -2;
  ladder(grateMat, 'overSidewalk'); // r8 z-fight sweep: flush with the sidewalk panels // r2-roads / r2-art: cast iron as a dielectric (metal 0, L 0.05-0.1, rough 0.75-0.85)
  const boatMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.35,
    metalness: 0.1,
  });
  if (M.timeU)
    boatMat.onBeforeCompile = (sh) => {
      sh.uniforms.uBoatTime = M.timeU;
      sh.vertexShader =
        'uniform float uBoatTime;\n' +
        sh.vertexShader.replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
      #ifdef USE_INSTANCING
        float bph = fract(sin(dot(vec2(instanceMatrix[3][0], instanceMatrix[3][2]), vec2(12.9898, 78.233))) * 43758.5453) * 6.2831;
        transformed.y += sin(uBoatTime * 1.1 + bph) * 0.12 + transformed.x * sin(uBoatTime * 0.9 + bph * 2.0) * 0.035 + transformed.z * sin(uBoatTime * 0.7 + bph) * 0.012;
      #endif`,
        );
    };
  const signPostG = mergeParts([
    [new THREE.CylinderGeometry(0.05, 0.06, 3.5, 6), m4(0, 1.75, 0), 0x8a9096],
    [BOXG, m4(0, 2.35, 0.07, 0, 0.46, 0.6, 0.02), 0xf2f2ee],
    [BOXG, m4(0, 2.55, 0.082, 0, 0.36, 0.12, 0.004), 0xc0262b],
    [BOXG, m4(0, 2.22, 0.082, 0, 0.3, 0.05, 0.004), 0x1d1d1d],
    [BOXG, m4(0, 2.12, 0.082, 0, 0.26, 0.05, 0.004), 0x1d1d1d],
  ]); // pole + parking-regulation plate
  const acMat = new THREE.MeshStandardMaterial({ color: 0xc9cdd0, roughness: 0.5, metalness: 0.4 });
  const pierMat = new THREE.MeshStandardMaterial({ color: 0xc8c6c0, roughness: 0.8 });

  // ---- cross-tile batches: the plain per-material meshes of every streamed tile / chunk drawn as one multi-draw ----
  const tileBatch = createTileBatcher(root);
  // the streamer's build jobs: the finished group's meshes move into the batches as the job's last steps
  function* batched(gen) {
    const group = yield* gen;
    if (group) yield* tileBatch.adoptG(group);
    return group;
  }

  // ---- global instance pools: ONE InstancedMesh per (geometry, material) shared by all near tiles ----
  // tiles add instances on build and remove them on dispose (swap-remove keeps the pool dense).
  const pools = new Map(),
    _col = new THREE.Color();
  function getPool(geom, mat, colors, cast, depth) {
    const key = geom.uuid + '|' + mat.uuid + (colors ? '|c' : '');
    let p = pools.get(key);
    if (!p) {
      p = { cap: 0, count: 0, owner: [], mesh: null, colors, cast, depth, geom, mat };
      growPool(p, 256);
      pools.set(key, p);
    }
    return p;
  }
  // Instances live in CPU source arrays (p.src / p.srcC, swap-remove dense); the InstancedMesh only receives the subset that can
  // matter this frame (cullPools: view frustum + shadow margin + a per-size draw distance), so a pool spanning every near tile
  // no longer draws (and shadow-casts) every palm / bin in a 700 m square each frame.
  function growPool(p, cap) {
    const im = new THREE.InstancedMesh(p.geom, p.mat, cap);
    im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    if (p.colors) {
      im.setColorAt(0, _col.set(0xffffff));
      im.instanceColor.setUsage(THREE.DynamicDrawUsage);
    }
    const src = new Float32Array(cap * 16),
      srcC = p.colors ? new Float32Array(cap * 3) : null;
    if (p.src) {
      src.set(p.src.subarray(0, p.count * 16));
      if (srcC) srcC.set(p.srcC.subarray(0, p.count * 3));
    }
    if (p.mesh) {
      im.renderOrder = p.mesh.renderOrder;
      root.remove(p.mesh);
      p.mesh.dispose();
    }
    p.src = src;
    p.srcC = srcC;
    if (!p.geom.boundingSphere) p.geom.computeBoundingSphere();
    const bs = p.geom.boundingSphere;
    p.rad = bs.radius + bs.center.length();
    p.cy = bs.center.y;
    p.maxD = Math.max(140, Math.min(480, p.rad * 70));
    if (p.geom.userData.lodMax) p.maxD = p.geom.userData.lodMax;
    p.minD = p.geom.userData.lodMin || 0; // vegetation LOD bands
    im.count = 0;
    im.frustumCulled = false;
    im.castShadow = p.cast;
    im.receiveShadow = true;
    if (p.depth) im.customDepthMaterial = p.depth;
    p.mesh = im;
    p.cap = cap;
    p.dirty = true;
    root.add(im);
  }
  const _frus = new THREE.Frustum(),
    _pm = new THREE.Matrix4(),
    _cullPos = new THREE.Vector3(1e9, 0, 0),
    _cullDir = new THREE.Vector3(),
    _cd = new THREE.Vector3();
  const cullStats = { pools: 0, src: 0, drawn: 0, ms: 0 };
  function cullPools(cam, force = false) {
    if (!cam) return cullStats;
    if (FARVEG) farEvict(cam);
    cam.getWorldDirection(_cd);
    let anyDirty = force;
    for (const p of pools.values())
      if (p.dirty) {
        anyDirty = true;
        break;
      }
    if (!anyDirty && cam.position.distanceToSquared(_cullPos) < 2.25 && _cd.dot(_cullDir) > 0.9985)
      return cullStats;
    const t0 = performance.now();
    _cullPos.copy(cam.position);
    _cullDir.copy(_cd);
    cam.updateMatrixWorld();
    _pm.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    _frus.setFromProjectionMatrix(_pm);
    const PL = _frus.planes,
      cx = cam.position.x,
      cz = cam.position.z;
    let srcN = 0,
      drawn = 0;
    for (const p of pools.values()) {
      const im = p.mesh,
        S = p.src,
        D = im.instanceMatrix.array,
        SC = p.srcC,
        DC = SC ? im.instanceColor.array : null,
        md2 = p.maxD * p.maxD;
      let n = 0;
      for (let i = 0; i < p.count; i++) {
        const o = i * 16,
          sc = Math.sqrt(S[o] * S[o] + S[o + 1] * S[o + 1] + S[o + 2] * S[o + 2]) || 1,
          x = S[o + 12],
          y = S[o + 13] + p.cy * sc,
          z = S[o + 14];
        const dx = x - cx,
          dz = z - cz;
        if (dx * dx + dz * dz > md2 || (p.minD && dx * dx + dz * dz < p.minD * p.minD)) continue;
        const r = p.rad * sc + 18;
        let vis = true; // 18 m margin: off-screen casters still throw their shadows into view
        for (let k = 0; k < 6; k++) {
          const pl = PL[k];
          if (pl.normal.x * x + pl.normal.y * y + pl.normal.z * z + pl.constant < -r) {
            vis = false;
            break;
          }
        }
        if (!vis) continue;
        {
          for (let k = 0; k < 16; k++) D[n * 16 + k] = S[o + k];
          if (SC) {
            DC[n * 3] = SC[i * 3];
            DC[n * 3 + 1] = SC[i * 3 + 1];
            DC[n * 3 + 2] = SC[i * 3 + 2];
          }
        }
        n++;
      }
      im.count = n;
      // perf (Nov 19): most of the ~400 pools hold nothing in view at any time. An empty pool that stays visible still
      // goes through the render list, sorting and the draw setup in the main pass and every shadow pass.
      im.visible = n > 0 || POOL_KEEP_EMPTY.on;
      im.instanceMatrix.clearUpdateRanges();
      im.instanceMatrix.addUpdateRange(0, Math.max(16, n * 16));
      im.instanceMatrix.needsUpdate = true;
      if (SC) {
        im.instanceColor.clearUpdateRanges();
        im.instanceColor.addUpdateRange(0, Math.max(3, n * 3));
        im.instanceColor.needsUpdate = true;
      }
      p.dirty = false;
      srcN += p.count;
      drawn += n;
    }
    cullStats.pools = pools.size;
    cullStats.src = srcN;
    cullStats.drawn = drawn;
    cullStats.ms = +(performance.now() - t0).toFixed(2);
    return cullStats;
  }
  const _m16 = new THREE.Matrix4();
  function poolAdd(p, items) {
    const h = { p, idx: [] };
    if (p.count + items.length > p.cap)
      growPool(p, Math.max(p.cap * 2, p.count + items.length + 64));
    for (const it of items) {
      const i = p.count++;
      if (it.m && it.m.length === 16) p.src.set(it.m, i * 16);
      else {
        // it.m: a saved pose (a street prop that was pushed / knocked over: src/world/props/dynamicProps.v2.js)
        dummy.position.set(it.x, it.y || 0, it.z);
        dummy.rotation.set(it.rx || 0, it.ry || 0, it.rz || 0); // rx / rz: a slight lean (props)
        if (it.sx || it.sy) dummy.scale.set(it.sx ?? 1, it.sy ?? 1, it.sz ?? 1);
        else dummy.scale.setScalar(it.s || 1);
        dummy.updateMatrix();
        p.src.set(dummy.matrix.elements, i * 16);
      }
      if (p.colors) {
        _col.set(it.color ?? 0xffffff);
        p.srcC[i * 3] = _col.r;
        p.srcC[i * 3 + 1] = _col.g;
        p.srcC[i * 3 + 2] = _col.b;
      }
      p.owner[i] = [h, h.idx.length];
      h.idx.push(i);
    }
    p.dirty = true;
    return h;
  }
  function poolRemove(h) {
    const p = h.p,
      M4 = p.src,
      C3 = p.colors ? p.srcC : null;
    const idx = h.idx.slice().sort((a, b) => b - a);
    for (const i of idx) {
      const last = --p.count;
      if (i !== last) {
        M4.copyWithin(i * 16, last * 16, last * 16 + 16);
        if (C3) C3.copyWithin(i * 3, last * 3, last * 3 + 3);
        const o = p.owner[last];
        p.owner[i] = o;
        o[0].idx[o[1]] = i;
      }
      p.owner[last] = undefined;
    }
    h.idx.length = 0;
    p.dirty = true;
  }
  function poolSetMatrix(p, i, m) {
    p.src.set(m.elements, i * 16);
    p.dirty = true;
  }
  const farGeoms = new Map(),
    farCache = new Map(); // impostor geometry -> far twin (same buffers, lodMax FAR_MAX); tile key -> { x, z, h: [handles] }
  function farGeom(g) {
    let f = farGeoms.get(g);
    if (f) return f;
    f = new THREE.BufferGeometry();
    for (const k in g.attributes) f.setAttribute(k, g.attributes[k]);
    f.setIndex(g.index);
    if (!g.boundingSphere) g.computeBoundingSphere();
    f.boundingSphere = g.boundingSphere.clone();
    f.userData.lodMin = g.userData.lodMin;
    f.userData.lodMax = FAR_MAX;
    f.userData.farVeg = true;
    farGeoms.set(g, f);
    return f;
  }
  function farKeep(group) {
    const t = group.userData.tile,
      L = group.userData.farVeg;
    if (!t || !L || !L.length) return;
    farDrop(t);
    farCache.set(t.tx + ',' + t.tz, {
      x: t.cx,
      z: t.cz,
      h: L.map(([g, m, items]) => poolAdd(getPool(farGeom(g), m, false, false, null), items)),
    });
  }
  function farDrop(t) {
    const k = t.tx + ',' + t.tz,
      e = farCache.get(k);
    if (!e) return;
    for (const h of e.h) poolRemove(h);
    farCache.delete(k);
  }
  let _farT = 0;
  function farEvict(cam) {
    const now = performance.now();
    if (now - _farT < 2000 || !farCache.size) return;
    _farT = now;
    const R = (FAR_MAX + 300) ** 2;
    for (const [k, e] of farCache)
      if ((e.x - cam.position.x) ** 2 + (e.z - cam.position.z) ** 2 > R) {
        for (const h of e.h) poolRemove(h);
        farCache.delete(k);
      }
  }
  function inst(group, geom, mat, items, { cast = false, colors = false, depth = null } = {}) {
    if (!items.length) return null;
    const p = getPool(geom, mat, colors, cast, depth);
    (group.userData.handles ||= []).push(poolAdd(p, items));
    if (FARVEG && !cast && !colors && geom.userData.lodMin > 0 && geom.userData.lodMax >= 400)
      (group.userData.farVeg ||= []).push([geom, mat, items]); // W4: impostor -> far cache on dispose
    return p.mesh;
  }
  const meshOf = (batch, mat, { cast = true, receive = true } = {}) => {
    if (batch.empty) return null;
    const m = batch.build(mat, { cast, receive });
    m.matrixAutoUpdate = false;
    m.updateMatrix();
    return m;
  };

  // ---- style selection ----
  // ---- skyline landmarks: the tallest towers in the tile data (h >= 140 m, single footprint) each get one of these designs,
  // picked from the building id (deterministic, data-driven, never keyed to coordinates). Names are ours.
  const LANDMARKS = [
    { name: 'Halcyon Crown', style: 'glass', mode: 1, amt: 4, cuts: [0.5, 0.7, 0.86], kind: 0.4 },
    { name: 'Marisol Residences', style: 'band', mode: 2, amt: 5, cuts: [], kind: 0.9, wrap: true },
    { name: 'Coralline Tower', style: 'glass', mode: 2, amt: 60, cuts: [0.8], kind: 0.6 },
    { name: 'Bayline One', style: 'band', mode: 1, amt: 3, cuts: [0.74], kind: 0.8, wrap: true },
    {
      name: 'Southline Center (topping out)',
      style: 'band',
      mode: 0,
      amt: 0,
      cuts: [],
      kind: 0.9,
      crane: true,
    },
    { name: 'Stanton Plaza', style: 'office', mode: 0, amt: 0, cuts: [0.55, 0.8], kind: 0.2 },
    { name: 'Tidewater Point', style: 'glass', mode: 1, amt: 7, cuts: [0.66], kind: 0.65 },
    {
      name: 'Las Brisas Condominium',
      style: 'band',
      mode: 2,
      amt: 9,
      cuts: [0.85],
      kind: 0.45,
      wrap: true,
    },
  ];
  function landmarkOf(b) {
    if (!b || b.part || b._noTower || (b.minH || 0) > 0.5 || !(b.h >= 140) || !(b.area > 450))
      return null;
    return LANDMARKS[(hash(((b.id % 2147483647) | 0) + 80) * LANDMARKS.length) | 0];
  }
  function styleFor(b, zone, seed) {
    if (b._forceStyle) return b._forceStyle;
    {
      const L = landmarkOf(b);
      if (L) return L.style;
    }
    const r = rng(seed)();
    if (b.style) {
      // DATA agent's archetype
      switch (b.style) {
        case 'stilt':
        case 'cabin':
          return 'house';
        case 'strip':
          return r < 0.6 ? 'deco' : 'office';
        case 'hangar':
        case 'barn':
          return 'warehouse';
        case 'terminal':
          return r < 0.5 ? 'glass' : 'band';
        case 'tower':
          return r < 0.4 ? 'glass' : r < 0.78 ? 'band' : 'office';
        case 'deco':
          return 'deco';
        case 'house':
          return 'house';
        case 'industrial':
          return 'warehouse';
        case 'garage':
          return 'band';
        case 'canopy':
          return 'canopy';
        case 'midrise':
          return r < 0.2 ? 'glass' : r < 0.55 ? 'band' : 'office';
        case 'lowrise':
          return zone === 'beach' || zone === 'nightlife'
            ? 'deco'
            : zone === 'residential'
              ? 'house'
              : r < 0.5
                ? 'deco'
                : 'office';
      }
    }
    if (
      zone === 'port' ||
      zone === 'industrial' ||
      /warehouse|industrial|hangar|shed|storage/.test(b.kind)
    )
      return 'warehouse';
    if (b.h > 45) return r < 0.4 ? 'glass' : r < 0.78 ? 'band' : 'office';
    if (zone === 'beach' || zone === 'nightlife') return 'deco';
    if (b.h > 16) return r < 0.25 ? 'glass' : r < 0.55 ? 'band' : 'office';
    if (
      zone === 'residential' ||
      b.kind === 'house' ||
      b.kind === 'residential' ||
      b.kind === 'detached'
    )
      return 'house';
    return r < 0.5 ? 'deco' : 'office';
  }
  const hash = (n) => {
    let x = Math.imul(n | 0, 2654435761) ^ (n >>> 13);
    x = Math.imul(x ^ (x >>> 16), 2246822507);
    return (x >>> 0) / 4294967296;
  };
  // ---- library building models (bldmodels.js): picked lots draw the user's models (instanced city-wide), not a procedural shell ----
  const LIBM = createBuildingModels({
    root,
    roadDist,
    districtAt: ctx.districtAt,
    near: (b) => nearBuildings(b),
    ground: D ? TH : null,
    argsOf: (o) => {
      if (!o.rings || !o.rings[0]) return null;
      if (o.cx === undefined) {
        let x = 0,
          z = 0;
        for (const p of o.rings[0]) {
          x += p[0];
          z += p[1];
        }
        o.cx = x / o.rings[0].length;
        o.cz = z / o.rings[0].length;
      }
      const zn = o.zone || zoneAt(o.cx, o.cz);
      return [styleFor(o, zn, (o.id % 2147483647) | 0), zn];
    },
  });
  const casinoH = LIBMODELS[CASINO.name],
    inCasino = (x, z) => {
      const dx = x - CASINO.x,
        dz = z - CASINO.z,
        c = Math.cos(CASINO.ry),
        s = Math.sin(CASINO.ry),
        lx = dx * c - dz * s,
        lz = dx * s + dz * c;
      return Math.abs(lx) < casinoH.w / 2 + 4 && Math.abs(lz) < casinoH.d / 2 + 4;
    };
  if (!/[?&]libmodels=0/.test(typeof location !== 'undefined' ? location.search : ''))
    LIBM.addFixed(-77, CASINO.name, CASINO.x, CASINO.y || 0, CASINO.z, CASINO.ry, CASINO.s);
  // ---- V2 facade families: a recipe per building (families.js), re-rolled until no adjacent building shares its signature ----
  const isFB = (B) => (B && B.fac && B.fac.fx ? B.fac : null);
  // batch view that writes a full facade style (window grid) instead of a blank wall layer
  const sview = (fb, S, bw, fh) => {
    const v = Object.create(Batch.prototype);
    v.vert = function (x, y, z, nx, ny, nz, u, vv, col) {
      const s = fb.s;
      s[0] = S.layer;
      s[1] = bw;
      s[2] = fh;
      s[3] = S.seed;
      s[4] = S.winW;
      s[5] = S.winH;
      s[6] = S.sill;
      s[7] = S.type;
      s[8] = S.groundY ?? 0;
      s[9] = S.profile ?? 0;
      s[10] = S.glass ?? 0;
      s[11] = S.reflect ?? 0.2;
      s[12] = S.accent.r;
      s[13] = S.accent.g;
      s[14] = S.accent.b;
      s[15] = S.bits || 0;
      fb.vert(x, y, z, nx, ny, nz, u, vv, col);
    };
    return v;
  };
  // awning canvas: plain wall layer (plaster grain reads as woven fabric) plus the awning feature bit
  const awningView = (fb) => {
    const v = Object.create(Batch.prototype);
    v.vert = function (x, y, z, nx, ny, nz, u, vv, col) {
      fb.blank(WL.plaster);
      fb.s[15] = BIT.awning;
      fb.vert(x, y, z, nx, ny, nz, u, vv, col);
    };
    return v;
  };
  const fview = (fb, layer) => {
    const v = Object.create(Batch.prototype);
    v.layer = layer;
    v.vert = function (x, y, z, nx, ny, nz, u, vv, col) {
      fb.blank(this.layer);
      fb.vert(x, y, z, nx, ny, nz, u, vv, col);
    };
    Object.defineProperty(v, 'empty', { get: () => true });
    return v;
  };
  const bbOf = (o) => {
    if (!o._bb) {
      let a = Infinity,
        c = -Infinity,
        d = Infinity,
        e = -Infinity;
      for (const [x, z] of o.rings[0]) {
        a = Math.min(a, x);
        c = Math.max(c, x);
        d = Math.min(d, z);
        e = Math.max(e, z);
      }
      o._bb = [a, c, d, e];
    }
    return o._bb;
  };
  const ADJ = 9; // m between footprints' bounding boxes that still counts as "next door"
  function nearBuildings(b) {
    const bb = bbOf(b),
      T = provider.tileSize || 200,
      out = [];
    if (!provider.getTile) return out;
    for (let i = Math.floor((bb[0] - ADJ) / T); i <= Math.floor((bb[1] + ADJ) / T); i++)
      for (let j = Math.floor((bb[2] - ADJ) / T); j <= Math.floor((bb[3] + ADJ) / T); j++) {
        let t2 = null;
        try {
          t2 = provider.getTile(i, j);
        } catch (e) {
          /* not loaded */
        }
        if (!t2 || typeof t2.then === 'function' || !t2.buildings) continue;
        for (const o of t2.buildings) {
          if (o === b || o._dropped || !o.rings || !o.rings[0] || o.rings[0].length < 3) continue;
          const ob = bbOf(o);
          if (
            ob[0] < bb[1] + ADJ &&
            ob[1] > bb[0] - ADJ &&
            ob[2] < bb[3] + ADJ &&
            ob[3] > bb[2] - ADJ
          )
            out.push(o);
        }
      }
    return out;
  }
  function facStyle(b, zone, style, h) {
    if (b._fs && b._fsStyle === style) return b._fs;
    const ctxS = {
        zone,
        district: ctx.districtAt ? ctx.districtAt(b.cx, b.cz) || '' : '',
        style,
        h,
      },
      nb = nearBuildings(b);
    let salt = 0,
      S = buildingStyle(b, ctxS, 0);
    while (salt < 12 && nb.some((o) => o._fs && o._fs.sig === S.sig))
      S = buildingStyle(b, ctxS, ++salt);
    b._fs = S;
    b._fsStyle = style;
    return S;
  }
  // audit: every building gets its recipe; count adjacent pairs that share a signature (must be 0)
  function auditFacades(bounds) {
    const r = null,
      T = provider.tileSize || 200,
      B0 = bounds || provider.bounds;
    let n = 0,
      pairs = 0,
      same = 0;
    const fams = {},
      sigs = new Set(),
      bad = [];
    const i0 = r ? (r.minX ?? r[0]) : Math.floor(B0.minX / T),
      i1 = r ? (r.maxX ?? r[1]) : Math.floor(B0.maxX / T),
      j0 = r ? (r.minZ ?? r[2]) : Math.floor(B0.minZ / T),
      j1 = r ? (r.maxZ ?? r[3]) : Math.floor(B0.maxZ / T);
    const all = [];
    for (let i = i0; i <= i1; i++)
      for (let j = j0; j <= j1; j++) {
        let t2 = null;
        try {
          t2 = provider.getTile(i, j);
        } catch (e) {
          /* */
        }
        if (!t2 || typeof t2.then === 'function' || !t2.buildings) continue;
        for (const b of buildingsOf(t2, false)) {
          if (!b.rings || b.rings[0].length < 3) continue;
          const zone = zoneAt(b.cx, b.cz),
            st = styleFor(b, b.zone || zone, (b.id % 2147483647) | 0);
          if (st === 'canopy') continue;
          const S = facStyle(b, zone, st, b.h);
          all.push(b);
          n++;
          fams[S.fam] = (fams[S.fam] || 0) + 1;
          sigs.add(S.sig);
        }
      }
    for (const b of all)
      for (const o of nearBuildings(b)) {
        if (!o._fs || (o.id | 0) <= (b.id | 0)) continue;
        pairs++;
        if (o._fs.sig === b._fs.sig) {
          same++;
          if (bad.length < 10) bad.push([b.id, o.id, b._fs.sig]);
        }
      }
    return {
      buildings: n,
      adjacentPairs: pairs,
      sameSignature: same,
      distinctSignatures: sigs.size,
      families: fams,
      examples: bad,
    };
  }

  // polygon grown/shrunk by ~d metres (centroid scaling; fine for the mostly convex tower/podium footprints)
  function scalePoly(pts, cx, cz, d) {
    let r = 0;
    for (const [x, z] of pts) r += Math.hypot(x - cx, z - cz);
    r = r / pts.length || 1;
    const k = Math.max(0.45, 1 + d / r);
    return pts.map(([x, z]) => [cx + (x - cx) * k, cz + (z - cz) * k]);
  }
  // box hanging off an oriented polygon edge (balcony slabs): top, bottom, front and two sides, written directly
  function edgeSlab(batch, ax, az, bx, bz, nx, nz, y, depth, thick, col) {
    const P = (x, z, yy) => [x, yy, z],
      o = [nx * depth, nz * depth];
    const a0 = P(ax, az, y),
      b0 = P(bx, bz, y),
      a1 = P(ax + o[0], az + o[1], y),
      b1 = P(bx + o[0], bz + o[1], y);
    const up = (p, t) => [p[0], p[1] + t, p[2]];
    const tri = (A, Bq, C, n) => {
      for (const v of [A, Bq, C]) batch.vert(v[0], v[1], v[2], n[0], n[1], n[2], 0, 0, col);
    };
    const quad = (A, Bq, C, D, n) => {
      tri(A, Bq, C, n);
      tri(A, C, D, n);
    };
    quad(up(a0, thick), up(a1, thick), up(b1, thick), up(b0, thick), [0, 1, 0]);
    quad(a0, b0, b1, a1, [0, -1, 0]);
    quad(a1, up(a1, thick), up(b1, thick), b1, [nx, 0, nz]);
    quad(a0, up(a0, thick), up(a1, thick), a1, [-(bz - az), 0, bx - ax]);
    quad(b1, up(b1, thick), up(b0, thick), b0, [bz - az, 0, -(bx - ax)]);
  }
  // corner treatment for tower bodies: 0 sharp, 1 chamfered, 2 rounded (quadratic arcs, read as one curved run by facadeWalls)
  function shapeCorners(ring, mode, amt) {
    if (!mode || ring.length > 12) return ring;
    const out = [];
    const n = ring.length;
    for (let i = 0; i < n; i++) {
      const p = ring[(i - 1 + n) % n];
      const c = ring[i];
      const q = ring[(i + 1) % n];
      const l0 = Math.hypot(c[0] - p[0], c[1] - p[1]);
      const l1 = Math.hypot(q[0] - c[0], q[1] - c[1]);
      const d = Math.min(amt, l0 * 0.3, l1 * 0.3);
      if (d < 0.8) {
        out.push(c);
        continue;
      }
      const a = [c[0] + ((p[0] - c[0]) * d) / l0, c[1] + ((p[1] - c[1]) * d) / l0];
      const e = [c[0] + ((q[0] - c[0]) * d) / l1, c[1] + ((q[1] - c[1]) * d) / l1];
      if (mode === 1) {
        out.push(a, e);
        continue;
      }
      for (let k = 0; k <= 4; k++) {
        const t = k / 4;
        const u = 1 - t;
        out.push([
          u * u * a[0] + 2 * u * t * c[0] + t * t * e[0],
          u * u * a[1] + 2 * u * t * c[1] + t * t * e[1],
        ]);
      }
    }
    return out;
  }
  // Tower silhouette, deterministic per building id and shared by the near build and the mid/far LOD (no pop between them):
  // podium on the full footprint, inset body with chamfered / rounded / sharp corners, zero to two setbacks, crown kind.
  function towerShape(b, outer, seed, h) {
    const r1 = hash(seed + 51);
    const r3 = hash(seed + 53);
    const podH = Math.min(h * 0.35, 4.2 + (2 + ((r1 * 6) | 0)) * 3.6);
    const d = Math.min(8, Math.max(3, Math.sqrt(b.area) * 0.12));
    const LM = landmarkOf(b);
    const cm = hash(seed + 62);
    const mode = LM ? LM.mode : cm < 0.3 ? 1 : cm < 0.52 ? 2 : 0;
    const shape = (ring, k) => shapeCorners(ring, mode, k);
    const body = shape(
      scalePoly(outer, b.cx, b.cz, -d),
      LM ? LM.amt : mode === 2 ? 6 + hash(seed + 64) * 8 : 2.5 + hash(seed + 64) * 3,
    );
    const tall = LM ? LM.cuts.length > 0 : h > 120 || (h > 80 && hash(seed + 63) < 0.5);
    const levels = [];
    if (!tall) levels.push({ ring: body, y0: podH, y1: h });
    else {
      const cuts = LM
        ? LM.cuts
        : h > 150 && hash(seed + 65) < 0.55
          ? [0.58 + r3 * 0.08, 0.82 + r3 * 0.06]
          : [0.72 + r3 * 0.1];
      let ring = body;
      let y = podH;
      cuts.forEach((f, k) => {
        levels.push({ ring, y0: y, y1: h * f });
        y = h * f;
        ring = shape(scalePoly(ring, b.cx, b.cz, -(2.2 + hash(seed + 66 + k) * 2.6)), 2);
      });
      levels.push({ ring, y0: y, y1: h });
    }
    const top = levels[levels.length - 1].ring;
    return {
      podH,
      body,
      tall,
      hA: levels[0].y1,
      top,
      levels,
      kind: LM ? LM.kind : hash(seed + 56),
      LM,
    };
  }
  const isTower = (b, style) =>
    !b.part &&
    (b.minH || 0) < 0.5 &&
    b.h > 45 &&
    b.area > 450 &&
    (style === 'glass' || style === 'band' || style === 'office');
  // lattice box column (crane masts, construction frames) from thin boxes: four posts plus rings every `step` m
  function lattice(batch, x, z, y0, y1, w, step, col, ry = 0) {
    const c = Math.cos(ry);
    const s = Math.sin(ry);
    const P = [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ].map(([a, e]) => [x + ((a * c + e * s) * w) / 2, z + ((-a * s + e * c) * w) / 2]);
    for (const [px, pz] of P)
      batch.addGeometry(BOXG, mat4(px, (y0 + y1) / 2, pz, ry, 0.22, y1 - y0, 0.22), col);
    for (let y = y0 + step; y < y1; y += step) {
      batch.addGeometry(BOXG, mat4(x, y, z, ry, w, 0.14, 0.14), col);
      batch.addGeometry(BOXG, mat4(x, y, z, ry, 0.14, 0.14, w), col);
      batch.addGeometry(BOXG, mat4(x, y - step / 2, z, ry + Math.PI / 4, w * 1.3, 0.1, 0.1), col);
    }
  }
  // closed block (walls + lid) on an oriented ring: plant rooms, penthouses
  function block(batch, ring, y0, y1, col) {
    wallStrip(batch, ring, y0, y1, 4, 4, col);
    capPoly(batch, ring, y1, col);
  }
  // rooftop helipad: dark coated disk, white ring, H, and a perimeter safety net
  function helipad(paint, top, b, h, seed) {
    let r = Infinity;
    for (const [x, z] of top) r = Math.min(r, Math.hypot(x - b.cx, z - b.cz));
    r = Math.min(11, r * 0.8);
    if (r < 6) return false;
    const circ = (rr, n = 24) =>
      Array.from({ length: n }, (_, i) => [
        b.cx + Math.cos((-i / n) * Math.PI * 2) * rr,
        b.cz + Math.sin((-i / n) * Math.PI * 2) * rr,
      ]);
    fillPoly(paint, [circ(r)], h + 0.06, new THREE.Color(0x4a4d50), 1 / 6);
    fillPoly(
      paint,
      [circ(r * 0.86), circ(r * 0.8).reverse()],
      h + 0.09,
      new THREE.Color(0xe8e6de),
      1 / 6,
    );
    const a = hash(seed + 71) * Math.PI;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const bar = (u0, v0, u1, v1) => {
      const P = [
        [u0, v0],
        [u1, v0],
        [u1, v1],
        [u0, v1],
      ].map(([u, v]) => [b.cx + u * ca - v * sa, b.cz + u * sa + v * ca]);
      fillPoly(paint, [P], h + 0.1, new THREE.Color(0xe8e6de), 1 / 6);
    };
    const k = r * 0.32;
    bar(-k, -k * 1.2, -k * 0.7, k * 1.2);
    bar(k * 0.7, -k * 1.2, k, k * 1.2);
    bar(-k * 0.7, -k * 0.15, k * 0.7, k * 0.15);
    return true;
  }
  function buildTower(B, b, outer, opts, style, color, seed, h) {
    const r2 = hash(seed + 52);
    const TS = towerShape(b, outer, seed, h);
    const { podH, body, tall, hA, top, levels } = TS;
    // podium: 3-8 floors on the full footprint, built through the normal path (storefronts, roof, AC, colliders)
    const podStyle = r2 < 0.5 ? 'band' : 'office';
    buildBuilding(
      B,
      { ...b, h: podH, _forceStyle: podStyle, _noTower: true, colour: null, _podOf: b, _fs: null },
      opts,
    );
    const zone0 = zoneAt(b.cx, b.cz);
    const bstyle = pickFacade(style, b.zone || zoneAt(b.cx, b.cz), hash(seed + 91));
    const [bays, fl, tw, th] = FAC[bstyle],
      uOff = ((hash(seed + 1) * bays) | 0) / bays,
      vOff = ((hash(seed + 2) * fl) | 0) / fl;
    const tint =
      style === 'glass' ? color : new THREE.Color(OFFICE_TINTS[(hash(seed + 54) * 11) | 0]);
    const FB = isFB(B),
      FS = FB ? facStyle(b, zone0, style, h) : null;
    if (FB) B.roof.layer = FS.roof;
    const terrace = new THREE.Color(0x8a8f94);
    levels.forEach((L, li) => {
      if (FB) facadeWalls(FB, L.ring, L.y0, L.y1, FS, 40 + li * 50);
      else wallStrip(B[bstyle], L.ring, L.y0, L.y1, tw, th, tint, uOff, vOff - L.y0 / th);
      if (li < levels.length - 1) {
        // setback terrace: roof deck with a glass-and-steel railing
        fillPoly(B.roof, [L.ring], L.y1, terrace, 1 / 6);
        parapet(B.trim, L.ring, L.y1, 1.1, 0.18, new THREE.Color(0x4a5056));
      }
      if (opts.coll) {
        wallStrip(opts.coll, L.ring, L.y0, L.y1, 10, 10, new THREE.Color(0xffffff));
        fillPoly(opts.coll, [L.ring], L.y1, 0xffffff, 1);
      }
    });
    fillPoly(B.roof, [top], h, new THREE.Color(0x80868c), 1 / 6);
    // balcony stacks: two longest faces on condo towers, or wraparound on every face of the slender residential landmarks
    const zone = b.zone || zoneAt(b.cx, b.cz);
    const wrap = TS.LM ? !!TS.LM.wrap : style !== 'glass' && h > 90 && hash(seed + 67) < 0.4;
    if (
      style !== 'glass' &&
      (wrap || ((zone === 'residential' || zone === 'business') && hash(seed + 55) < 0.6)) &&
      B.shopGlass
    ) {
      const slabC = new THREE.Color(0xf2efe8),
        white = new THREE.Color(0xffffff);
      for (const L of levels) {
        const ring = L.ring;
        let edges = ring
          .map((p, i) => [p, ring[(i + 1) % ring.length]])
          .map(([p, q]) => ({ p, q, L: Math.hypot(q[0] - p[0], q[1] - p[1]) }))
          .sort((a, c) => c.L - a.L);
        if (!wrap) edges = edges.slice(0, 2);
        for (const { p, q, L: el } of edges) {
          if (el < (wrap ? 6 : 10)) continue;
          const tx = (q[0] - p[0]) / el,
            tz = (q[1] - p[1]) / el,
            nx = -tz,
            nz = tx,
            m = wrap ? 0.2 : 1.5;
          const ax = p[0] + tx * m,
            az = p[1] + tz * m,
            bx = q[0] - tx * m,
            bz = q[1] - tz * m;
          for (let y = L.y0 + 3.2; y < L.y1 - 2.5; y += 3.2) {
            edgeSlab(B.trim, ax, az, bx, bz, nx, nz, y, wrap ? 2.1 : 1.7, 0.2, slabC);
            if (opts.coll) {
              edgeSlab(opts.coll, ax, az, bx, bz, nx, nz, y, wrap ? 2.1 : 1.7, 0.2, 0xffffff);
              edgeSlab(
                opts.coll,
                ax + nx * (wrap ? 2.04 : 1.64),
                az + nz * (wrap ? 2.04 : 1.64),
                bx + nx * (wrap ? 2.04 : 1.64),
                bz + nz * (wrap ? 2.04 : 1.64),
                nx,
                nz,
                y + 0.2,
                0.06,
                1.05,
                0xffffff,
              );
            } // r2-physics: balconies are solid (slab + rail)
            const fx = nx * (wrap ? 2.08 : 1.68),
              fz = nz * (wrap ? 2.08 : 1.68),
              y1 = y + 0.2,
              y2 = y + 1.25;
            for (const v of [
              [ax + fx, y1, az + fz],
              [bx + fx, y1, bz + fz],
              [bx + fx, y2, bz + fz],
              [ax + fx, y1, az + fz],
              [bx + fx, y2, bz + fz],
              [ax + fx, y2, az + fz],
            ])
              B.shopGlass.vert(v[0], v[1], v[2], nx, 0, nz, 0, 0, white);
          }
        }
      }
    }
    // crown
    const kind = TS.kind;
    const paint = FB ? fview(FB, WL.roofCoat) : B.roof;
    const mech = FB ? fview(FB, WL.cladding) : B.trim;
    let crownTop = h;
    const building = TS.LM ? !!TS.LM.crane : h > 120 && hash(seed + 69) < 0.035; // topping out: bare slab edges, column frame and a tower crane
    if (building) {
      b._site = true; // props pass: workZones() fences this site with library jersey barriers, a cabin, a roll-off
      const frameC = new THREE.Color(0x9c9890);
      for (let y = h + 3.4; y <= h + 10.5; y += 3.5) capPoly(B.trim, top, y, frameC);
      for (const [x, z] of top)
        B.trim.addGeometry(BOXG, mat4(x, h + 5.2, z, 0, 0.7, 10.4, 0.7), frameC);
      const craneC = new THREE.Color(0xb89a3e);
      const mx = b.cx + (top[0][0] - b.cx) * 0.3,
        mz = b.cz + (top[0][1] - b.cz) * 0.3,
        mh = h + 34,
        ry = hash(seed + 70) * Math.PI * 2;
      lattice(B.trim, mx, mz, h, mh, 2.0, 2.6, craneC, ry);
      const jx = Math.sin(ry),
        jz = Math.cos(ry);
      B.trim.addGeometry(
        BOXG,
        mat4(mx + jx * 20, mh + 0.8, mz + jz * 20, ry, 1.6, 1.6, 48),
        craneC,
      ); // jib
      B.trim.addGeometry(BOXG, mat4(mx - jx * 9, mh + 0.8, mz - jz * 9, ry, 1.8, 1.4, 16), craneC); // counter-jib
      B.trim.addGeometry(
        BOXG,
        mat4(mx - jx * 15, mh - 0.6, mz - jz * 15, ry, 2.6, 2.2, 3.4),
        new THREE.Color(0x8a8a86),
      ); // counterweights
      B.trim.addGeometry(BOXG, mat4(mx, mh + 4, mz, ry, 0.8, 7, 0.8), craneC); // apex
      B.trim.addGeometry(
        BOXG,
        mat4(mx + jx * 1.6, mh - 1.2, mz + jz * 1.6, ry, 1.8, 2.0, 1.8),
        new THREE.Color(0xd8d6d0),
      ); // cab
      crownTop = mh + 7.5;
    } else if (kind < 0.3) {
      // rooftop mechanical screen around a plant penthouse
      const scr = scalePoly(top, b.cx, b.cz, -2.5);
      wallStrip(B.trim, scr, h, h + 4.5, 10, 10, new THREE.Color(0x5d6266));
      block(mech, scalePoly(top, b.cx, b.cz, -5), h, h + 3.2, new THREE.Color(0x8c9196));
      crownTop = h + 4.5;
    } else if (kind < 0.55) {
      // stepped lit glass crown with light bands
      const c1 = scalePoly(top, b.cx, b.cz, -2.2);
      if (FB) {
        facadeWalls(FB, top, h, h + 6, { ...FS, floorH: 6 }, 150);
        facadeWalls(FB, c1, h + 6, h + 11, { ...FS, floorH: 5 }, 160);
      } else wallStrip(B[bstyle], top, h, h + 6, tw, th, tint, uOff, vOff - h / th);
      fillPoly(B.roof, [top], h + 6, new THREE.Color(0x80868c), 1 / 6);
      fillPoly(B.roof, [c1], h + 11, new THREE.Color(0x80868c), 1 / 6);
      const nc = new THREE.Color(NEONS[(hash(seed + 57) * 6) | 0]),
        ring = scalePoly(top, b.cx, b.cz, 0.12);
      wallStrip(B.neon, ring, h - 2.4, h - 2.0, 10, 10, nc);
      wallStrip(B.neon, ring, h + 5.6, h + 6.0, 10, 10, nc);
      crownTop = h + 11;
    } else if (kind < 0.75) {
      // mechanical penthouse + spire
      block(
        mech,
        scalePoly(top, b.cx, b.cz, -Math.sqrt(b.area) * 0.18),
        h,
        h + 5 + hash(seed + 72) * 3,
        new THREE.Color(0xb4b2ac),
      );
      const sh = 18 + hash(seed + 58) * 30;
      B.trim.addGeometry(
        new THREE.CylinderGeometry(0.35, 1.6, sh, 8),
        mat4(b.cx, h + sh / 2, b.cz),
        new THREE.Color(0xdfe6ec),
      );
      crownTop = h + sh;
    } else if (top.length <= 8 && hash(seed + 73) < 0.5) {
      // angled metal roof
      let x0 = Infinity,
        x1 = -Infinity,
        z0 = Infinity,
        z1 = -Infinity;
      for (const [x, z] of top) {
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
        z0 = Math.min(z0, z);
        z1 = Math.max(z1, z);
      }
      const rh = 6 + hash(seed + 59) * 8,
        rg = new THREE.ConeGeometry(1, 1, 4, 1);
      rg.rotateY(Math.PI / 4);
      B.trim.addGeometry(
        rg,
        mat4(
          (x0 + x1) / 2,
          h + rh / 2,
          (z0 + z1) / 2,
          0,
          (x1 - x0) * 0.7072,
          rh,
          (z1 - z0) * 0.7072,
        ),
        new THREE.Color(0x9aa4ac),
      );
      crownTop = h + rh;
    } else {
      // parapet roof with a helipad or a plant room, and an antenna mast on some
      parapet(B.trim, top, h, 1.6, 0.4, new THREE.Color(0x3c434a));
      if (!(hash(seed + 68) < 0.55 && helipad(paint, top, b, h, seed)))
        block(
          mech,
          scalePoly(top, b.cx, b.cz, -Math.sqrt(b.area) * 0.15),
          h,
          h + 4.5,
          new THREE.Color(0xa8a69e),
        );
      if (hash(seed + 74) < 0.4) {
        const p = top[(hash(seed + 75) * top.length) | 0],
          ax = b.cx + (p[0] - b.cx) * 0.5,
          az = b.cz + (p[1] - b.cz) * 0.5,
          ah = 10 + hash(seed + 76) * 14;
        lattice(B.trim, ax, az, h, h + ah, 0.9, 1.8, new THREE.Color(0xc8ccd0));
        crownTop = h + ah;
      }
    }
    if (opts.props) {
      opts.props.beacon.push({ x: b.cx, y: crownTop + 0.6, z: b.cz, s: 2.5 });
      for (let k = 0; k < 3; k++) {
        const p = top[(hash(seed + 60 + k) * top.length) | 0];
        opts.props.ac.push({
          x: b.cx + (p[0] - b.cx) * 0.4,
          y: h,
          z: b.cz + (p[1] - b.cz) * 0.4,
          ry: 0,
          s: 1.3,
        });
      }
    }
  }
  // ---- building geometry (shared by near + colliders) ----
  function buildBuilding(B, b, opts) {
    const outer = orient(b.rings[0]);
    if (outer.length < 3) return;
    const zone = zoneAt(b.cx, b.cz),
      seed = (b.id % 2147483647) | 0,
      rr = hash(seed);
    let style = styleFor(b, b.zone || zone, seed);
    const y0 = b.minH || 0,
      h = Math.max(b.h, y0 + 2.5);
    {
      // library model lot: register the instance, keep only a box collider
      const LP =
        (opts.lod === 2 && !LIBM.has(b.id)) || b._podOf || b._noTower || houseLots.claims(b)
          ? null
          : LIBM.pick(b, style, b.zone || zone); // lots the house generator owns keep its house; far LOD: only lots already carrying a model
      if (LP) {
        LIBM.register(b, LP, D ? Math.max(0, baseOf(b) + 0.05) : 0);
        if (opts.coll) LIBM.collide(opts.coll, LP, opts.relief ? -baseOf(b) : 0);
        return;
      } // collider: the model's own collision mesh (steps, porches, overhangs)
    }
    if (style === 'canopy') {
      // roof on posts (fuel stations, carports)
      fillPoly(B.roof, b.rings, h, new THREE.Color(0xe8e8e4), 1 / 6);
      fillPolyDown(B.trim, b.rings, h - 0.05, new THREE.Color(0xd0d0cc));
      wallStrip(B.trim, outer, h - 0.6, h, 10, 10, new THREE.Color(0xf2f2f2));
      if (opts.coll) {
        fillPoly(opts.coll, b.rings, h, 0xffffff, 1);
      }
      return;
    }
    let color = new THREE.Color(
      style === 'glass'
        ? GLASS_TINTS[(rr * 8) | 0]
        : style === 'deco'
          ? PASTELS[(rr * 12) | 0]
          : style === 'house'
            ? MED[(rr * 5) | 0]
            : style === 'warehouse'
              ? 0xffffff
              : OFFICE_TINTS[(rr * 11) | 0],
    );
    if (b.colour && style !== 'glass') {
      try {
        color = new THREE.Color(b.colour).lerp(new THREE.Color(0xffffff), 0.25);
      } catch (e) {
        /* unparsable OSM colour */
      }
    }
    // ---- towers: podium base + inset glass/concrete body with setbacks and a crown ----
    if (
      !b._noTower &&
      !b.part &&
      y0 < 0.5 &&
      h > 45 &&
      b.area > 450 &&
      (style === 'glass' || style === 'band' || style === 'office')
    ) {
      buildTower(B, b, outer, opts, style, color, seed, h);
      return;
    }
    const fstyle = pickFacade(style === 'house' ? 'deco' : style, zone, hash(seed + 91));
    const FB = isFB(B);
    let FS = null;
    if (FB) {
      if (b._podOf) {
        const TS = facStyle(
          b._podOf,
          zone,
          styleFor(b._podOf, b._podOf.zone || zone, seed),
          b._podOf.h,
        );
        FS = podiumStyle(TS, b._podOf, zone);
      } else FS = facStyle(b, zone, style, h);
      FS.groundY = 0;
      B.roof.layer = FS.roof;
      color = FS.tint.clone();
    }
    const [bays, fl, tw, th] = FAC[fstyle];
    const uOff = ((hash(seed + 1) * bays) | 0) / bays,
      vOff = ((hash(seed + 2) * fl) | 0) / fl;
    const sfl = b.storefronts || (b.storefront ? [b.storefront] : null);
    const sf = sfl && sfl.length && y0 < 0.5 && !b.part && !b._overlap ? sfl : null;
    // storefront shells also work on single-storey buildings: ground-floor height clamps to the building
    const GF = sf ? Math.max(2.9, Math.min(4.2, h - 0.6)) : 4.2;
    const shops =
      sf ||
      (opts.shops &&
        y0 < 0.5 &&
        h > 7 &&
        (style === 'deco' || style === 'office' || style === 'band') &&
        b.area > 150 &&
        !b.part &&
        h > GF + 0.5);
    if (shops) {
      // storefront SHELL: ground floor walls with real door openings (interiors are filled on demand by the INTERIORS agent)
      const gaps = sf
        ? sf.map((f) => ({ x: f.fx ?? f.x, z: f.fz ?? f.z, w: DOOR_W, h: DOOR_H }))
        : null;
      if (sf) annotateStorefronts(sf, GF);
      // painted shop art stays on plain facades; storefront lots get a real glass front (opened full-height in the painted wall)
      const openings = sf
        ? sf.map((f) => ({
            x: f.fx ?? f.x,
            z: f.fz ?? f.z,
            w: Math.max(DOOR_W + 1, f.w || 6),
            h: GF + 1,
          }))
        : null;
      if (FB && sf) {
        // ground floor around the shop fronts: the building's own windows and doors on every side (no blank back walls)
        const G = groundStyle(FS, false, false) || FS;
        wallGaps(
          sview(FB, G, G.bayW, GF - y0),
          outer,
          y0,
          GF,
          G.bayW,
          GF - y0,
          FS.tint,
          7.37,
          0,
          openings,
        );
        if (style !== 'house' && style !== 'warehouse' && y0 < 0.5 && !b.part && h > GF + 2.5)
          fasciaSigns(B, outer, y0, GF, seed, zone, openings);
      } else if (FB) {
        const G1 = groundStyle(FS, true, false);
        facadeWalls(FB, outer, y0, GF, G1 || FS, 7);
        if (G1 && G1.type === WIN.storefront)
          streetShopDress(B, outer, y0, GF, G1, seed, opts.props);
        if (
          style !== 'house' &&
          style !== 'warehouse' &&
          y0 < 0.5 &&
          !b.part &&
          h > GF + 2.5 &&
          opts.lod !== 1
        )
          fasciaSigns(B, outer, y0, GF, seed, zone);
      } else
        wallGaps(
          B.shop,
          outer,
          y0,
          GF,
          64,
          GF - y0,
          new THREE.Color(0xffffff),
          ((hash(seed + 3) * 8) | 0) / 8,
          -y0 / (GF - y0),
          openings,
        );
      // collider builds pass null batches: no shop-front dressing to compute there
      if (sf && B.shopGlass && B.shopGlass !== NULL_BATCH)
        for (const f of sf) {
          if (frontQueue) frontQueue.push([B, outer, f, y0, GF, color, opts.props, null]);
          else glassFront(B, outer, f, y0, GF, color, opts.props);
        }
      if (FB) facadeWalls(FB, outer, GF, h, FS, 20);
      else wallStrip(B[fstyle], outer, GF, h, tw, th, color, uOff, vOff - GF / th);
      if (sf) fillPolyDown(B.trim, b.rings, GF - 0.02, new THREE.Color(0xe6e2da));
      if (h <= GF + 0.01) {
        /* single storey: roof sits right above the shop */
      }
      if (opts.coll) {
        wallGaps(opts.coll, outer, y0, GF, 64, 4, 0xffffff, 0, 0, gaps);
        wallStrip(opts.coll, outer, GF, h, 10, 10, new THREE.Color(0xffffff));
        if (sf) fillPoly(opts.coll, b.rings, GF, 0xffffff, 1);
      }
    } else {
      if (FB) {
        const G0 = y0 < 0.5 && h > 7.5 ? groundStyle(FS, false, h > 45) : null,
          gh = G0 ? Math.min(G0.type === WIN.roller ? 5.2 : 4.4, h * 0.5) : 0;
        if (G0) facadeWalls(FB, outer, y0, y0 + gh, G0, 7);
        facadeWalls(FB, outer, y0 + gh, h, FS, 20);
      } else wallStrip(B[fstyle], outer, y0, h, tw, th, color, uOff, vOff - y0 / th);
      if (opts.coll) wallStrip(opts.coll, outer, y0, h, 10, 10, new THREE.Color(0xffffff));
    }
    if (opts.coll) fillPoly(opts.coll, b.rings, h, 0xffffff, 1);
    if (
      opts.coll &&
      !sf &&
      opts.relief !== undefined &&
      y0 < 0.5 &&
      h > 7 &&
      (style === 'deco' || style === 'office' || style === 'band') &&
      b.area > 150 &&
      !b.part &&
      h > 4.7
    ) {
      // collider: the street-level pilasters, ledge and kick plates (streetShopDress)
      const G1c = groundStyle(facStyle(b, zone, style, h), true, false);
      if (G1c && G1c.type === WIN.storefront)
        streetShopDress({ trim: opts.coll }, outer, y0, 4.2, G1c, seed, null);
    }
    if (y0 > 0.5 && !b.part) {
      fillPolyDown(B.trim, b.rings, y0, new THREE.Color(0xcfcac2));
      if (opts.coll) fillPolyDown(opts.coll, b.rings, y0, 0xffffff);
    } // passage / overhang soffit
    if (b._passage)
      for (const [x, z] of outer) {
        if (roadDist && roadDist(x, z) < 0.8) continue; // columns at the corners that stand clear of the lanes
        B.trim.addGeometry(CYLG, m4(x, y0 / 2, z, 0, 0.7, y0, 0.7), new THREE.Color(0xd9d4ca));
        if (opts.coll) opts.coll.addGeometry(BOXG, m4(x, y0 / 2, z, 0, 0.7, y0, 0.7), 0xffffff);
      }
    // r2-physics (QA-045 / r2-perf "facades with no collider"): the stacked balconies below hang 1.35 m outside the footprint, so they
    // were drawn without a collider; the collider build adds the same slabs and rail walls (same bays, floors and ground floor)
    if (
      opts.coll &&
      !ARTGEO_OFF &&
      !opts.lod &&
      y0 < 0.5 &&
      !b.part &&
      h >= 10 &&
      h < 46 &&
      outer.length <= 12 &&
      /residential|beach|business|commercial|mixed/.test(b.zone || zone) &&
      (style === 'office' || style === 'band') &&
      hash(seed + 1301) < (/residential|beach/.test(b.zone || zone) ? 0.6 : 0.3)
    ) {
      let FSc = null;
      try {
        FSc = b._podOf
          ? podiumStyle(
              facStyle(b._podOf, zone, styleFor(b._podOf, b._podOf.zone || zone, seed), b._podOf.h),
              b._podOf,
              zone,
            )
          : facStyle(b, zone, style, h);
      } catch (e) {
        FSc = null;
      }
      const shopsV =
        sf ||
        (y0 < 0.5 &&
          h > 7 &&
          (style === 'deco' || style === 'office' || style === 'band') &&
          b.area > 150 &&
          !b.part &&
          h > GF + 0.5);
      const gy = shopsV ? GF : 4.2,
        fh = FSc?.floorH || 3.2;
      const edges = outer
        .map((p, i) => [p, outer[(i + 1) % outer.length]])
        .map(([p, q]) => ({ p, q, L: Math.hypot(q[0] - p[0], q[1] - p[1]) }))
        .sort((a, c) => c.L - a.L)
        .slice(0, 2);
      for (const { p, q, L: el } of edges) {
        if (el < 9) continue;
        const tx = (q[0] - p[0]) / el,
          tz = (q[1] - p[1]) / el,
          nx = -tz,
          nz = tx,
          nb = Math.max(1, Math.floor((el - 2) / 6.5)),
          bw = Math.min(3.4, el / nb - 1.2),
          dep = 1.35;
        for (let k = 0; k < nb; k++) {
          const u = ((k + 0.5) * el) / nb,
            cx = p[0] + tx * u,
            cz = p[1] + tz * u,
            ax = cx - (tx * bw) / 2,
            az = cz - (tz * bw) / 2,
            bx = cx + (tx * bw) / 2,
            bz = cz + (tz * bw) / 2;
          for (let y = gy + fh; y < h - 2.4; y += fh) {
            edgeSlab(opts.coll, ax, az, bx, bz, nx, nz, y - 0.18, dep, 0.18, 0xffffff);
            const fx = nx * (dep - 0.06),
              fz = nz * (dep - 0.06);
            edgeSlab(
              opts.coll,
              ax + fx,
              az + fz,
              bx + fx,
              bz + fz,
              nx,
              nz,
              y,
              0.06,
              1.05,
              0xffffff,
            );
          }
        }
      }
    }
    if (
      !ARTGEO_OFF &&
      FB &&
      FS &&
      !opts.lod &&
      B.shopGlass &&
      y0 < 0.5 &&
      !b.part &&
      h >= 10 &&
      h < 46 &&
      outer.length <= 12 &&
      /residential|beach|business|commercial|mixed/.test(b.zone || zone) &&
      (style === 'office' || style === 'band') &&
      hash(seed + 1301) < (/residential|beach/.test(b.zone || zone) ? 0.6 : 0.3)
    ) {
      // deco gets eyebrows instead
      ART_GEO_N.balc++;
      // r2-art: residential mid-rises read as flat boxes: stacked balconies (slab + glass rail + handrail) on the two longest faces,
      // one per ~6.5 m bay, every floor above the ground floor
      const gy = shops ? GF : 4.2,
        fh = FS.floorH || 3.2,
        slabC = new THREE.Color(FS.tint).lerp(new THREE.Color(0xeeeae2), 0.75),
        railC = new THREE.Color(0x3a3d40),
        white = new THREE.Color(0xffffff);
      const edges = outer
        .map((p, i) => [p, outer[(i + 1) % outer.length]])
        .map(([p, q]) => ({ p, q, L: Math.hypot(q[0] - p[0], q[1] - p[1]) }))
        .sort((a, c) => c.L - a.L)
        .slice(0, 2);
      for (const { p, q, L: el } of edges) {
        if (el < 9) continue;
        const tx = (q[0] - p[0]) / el,
          tz = (q[1] - p[1]) / el,
          nx = -tz,
          nz = tx,
          nb = Math.max(1, Math.floor((el - 2) / 6.5)),
          bw = Math.min(3.4, el / nb - 1.2),
          dep = 1.35;
        for (let k = 0; k < nb; k++) {
          const u = ((k + 0.5) * el) / nb,
            cx = p[0] + tx * u,
            cz = p[1] + tz * u,
            ax = cx - (tx * bw) / 2,
            az = cz - (tz * bw) / 2,
            bx = cx + (tx * bw) / 2,
            bz = cz + (tz * bw) / 2;
          for (let y = gy + fh; y < h - 2.4; y += fh) {
            edgeSlab(B.trim, ax, az, bx, bz, nx, nz, y - 0.18, dep, 0.18, slabC);
            const fx = nx * (dep - 0.03),
              fz = nz * (dep - 0.03),
              y1 = y,
              y2 = y + 1.0;
            for (const v of [
              [ax + fx, y1, az + fz],
              [bx + fx, y1, bz + fz],
              [bx + fx, y2, bz + fz],
              [ax + fx, y1, az + fz],
              [bx + fx, y2, bz + fz],
              [ax + fx, y2, az + fz],
            ])
              B.shopGlass.vert(v[0], v[1], v[2], nx, 0, nz, 0, 0, white);
            edgeSlab(
              B.trim,
              ax + fx - nx * 0.03,
              az + fz - nz * 0.03,
              bx + fx - nx * 0.03,
              bz + fz - nz * 0.03,
              nx,
              nz,
              y2,
              0.06,
              0.05,
              railC,
            ); // handrail
          }
        }
      }
    }
    if (style === 'office' && h > 10 && h < 70 && hash(seed + 41) < 0.6 && outer.length < 40) {
      // concrete floor ledges (older offices)
      const led = scalePoly(outer, b.cx, b.cz, 0.28),
        lc = color.clone().multiplyScalar(0.92);
      for (let y = 4.2 + 3.5; y < h - 0.8; y += 3.5) {
        wallStrip(B.trim, led, y - 0.32, y, 10, 10, lc);
        capPoly(B.trim, led, y, lc);
      }
    }
    for (let i = 1; i < b.rings.length; i++) {
      const hole = orient(b.rings[i]).slice().reverse();
      if (FB) facadeWalls(FB, hole, y0, h, FS, 60);
      else wallStrip(B[fstyle], hole, y0, h, tw, th, color, uOff, vOff);
    }
    // roof
    const roofC = new THREE.Color(
      FB ? FS.roofTint : style === 'glass' ? 0x80868c : style === 'warehouse' ? 0xb8bcc0 : 0xd8d2c8,
    );
    fillPoly(B.roof, b.rings, h, roofC, 1 / 6);
    if (FB && FS && style !== 'house' && style !== 'warehouse' && style !== 'glass')
      corniceBands(B, b, outer, y0, h, FS, opts.lod);
    if (
      FB &&
      FS &&
      opts.props &&
      !opts.lod &&
      y0 < 0.5 &&
      !b.part &&
      h < (ARTGEO_OFF ? 40 : 62) &&
      outer.length <= 12 &&
      (FS.type === WIN.punched || FS.type === WIN.arched)
    ) {
      /* r2-art: was h < 40 (mid-rises up to ~18 floors read flat at street level) */ // real window depth: projecting sills (+ lintels on masonry) on the street faces, window AC units, downspouts, a utility meter
      const yU = shops
          ? GF
          : h > 7.5 && groundStyle(FS, false, h > 45)
            ? Math.min(groundStyle(FS, false, h > 45).type === WIN.roller ? 5.2 : 4.4, h * 0.5)
            : y0,
        nf = Math.max(1, Math.round((h - yU) / FS.floorH)),
        fh = (h - yU) / nf;
      const masonry = /brickRow|stoneBank|calleRow|decoMed|medHouse|precast/.test(FS.fam),
        sc = new THREE.Color(FS.tint).lerp(new THREE.Color(0xe6e0d4), 0.7);
      const acC = [
          new THREE.Color(0xd9d7cf),
          new THREE.Color(0xbfbdb5),
          new THREE.Color(0xe6e2d6),
          new THREE.Color(0xa9a59b),
        ],
        pipeC = new THREE.Color(FS.tint).lerp(new THREE.Color(0x9a9a96), 0.5);
      let colinear = false;
      for (let i = 0; i < outer.length; i++) {
        const a = outer[(i - 1 + outer.length) % outer.length],
          p = outer[i],
          q = outer[(i + 1) % outer.length],
          l1 = Math.hypot(p[0] - a[0], p[1] - a[1]) || 1,
          l2 = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
        if (((p[0] - a[0]) * (q[0] - p[0]) + (p[1] - a[1]) * (q[1] - p[1])) / (l1 * l2) > 0.914)
          colinear = true;
      }
      let meter = false;
      for (let i = 0; i < outer.length; i++) {
        const p = outer[i],
          q = outer[(i + 1) % outer.length],
          L = Math.hypot(q[0] - p[0], q[1] - p[1]);
        if (L < Math.max(1.5, FS.bayW * 0.62)) continue;
        const tx = (q[0] - p[0]) / L,
          tz = (q[1] - p[1]) / L,
          nx = -tz,
          nz = tx,
          street =
            !roadDist || roadDist((p[0] + q[0]) / 2 + nx * 4, (p[1] + q[1]) / 2 + nz * 4) <= 16;
        const nb = Math.max(1, Math.round(L / FS.bayW)),
          bw = L / nb,
          ww = FS.winW * bw,
          ry = Math.atan2(-tz, tx);
        for (let f = 0; f < Math.min(nf, 12); f++) {
          const wy = yU + f * fh + FS.sill * fh,
            wt = wy + FS.winH * fh;
          for (let k = 0; k < nb; k++) {
            const u = (k + 0.5) * bw,
              x = p[0] + tx * u,
              z = p[1] + tz * u;
            if (street && f < (ARTGEO_OFF ? 6 : 8)) {
              B.trim.addGeometry(
                BOXG,
                m4(x + nx * 0.06, wy - 0.06, z + nz * 0.06, ry, ww + 0.18, 0.11, 0.12),
                sc,
              );
              if (masonry && FS.type === WIN.punched)
                B.trim.addGeometry(
                  BOXG,
                  m4(x + nx * 0.035, wt + 0.09, z + nz * 0.035, ry, ww + 0.24, 0.18, 0.07),
                  sc.clone().multiplyScalar(0.95),
                );
            }
            const ha = hash(seed * 131 + i * 37 + f * 11 + k * 3);
            if (FS.acUnits && !colinear && ha < (street ? 0.12 : 0.22) && ww > 0.8) {
              // window AC unit: sits in the lower sash, sticks out over the street
              const aw = Math.min(0.68, ww * 0.75),
                ox = (hash(seed + i * 7 + f * 13 + k) - 0.5) * (ww - aw) * 0.8,
                cx = x + tx * ox,
                cz = z + tz * ox;
              B.trim.addGeometry(
                BOXG,
                m4(cx + nx * 0.13, wy + 0.22, cz + nz * 0.13, ry, aw, 0.44, 0.52),
                acC[((ha * 97) | 0) % 4],
              );
              B.trim.addGeometry(
                BOXG,
                m4(cx + nx * 0.4, wy + 0.22, cz + nz * 0.4, ry, aw - 0.08, 0.34, 0.02),
                new THREE.Color(0x55575a),
              );
            }
          }
        } // grille
        if (!street && !meter && L > 4 && hash(seed + 977 + i) < 0.7) {
          meter = true;
          const u = L * (0.15 + hash(seed + 978) * 0.2),
            x = p[0] + tx * u + nx * 0.1,
            z = p[1] + tz * u + nz * 0.1; // electric meter box + conduit
          B.trim.addGeometry(
            BOXG,
            m4(x, y0 + 1.5, z, ry, 0.34, 0.46, 0.2),
            new THREE.Color(0x8e918f),
          );
          B.trim.addGeometry(
            BOXG,
            m4(x, y0 + 2.6, z, ry, 0.05, 1.8, 0.05),
            new THREE.Color(0x7c7f7d),
          );
        }
      }
      // downspouts at two corners (roof to grade, small kick-out shoe at the bottom)
      for (let n = 0, tries = 0; n < 2 && tries < outer.length; tries++) {
        const ci =
          (((hash(seed + 991) * outer.length) | 0) + tries * (outer.length >> 1 || 1)) %
          outer.length;
        const c = outer[ci],
          a = outer[(ci - 1 + outer.length) % outer.length],
          q = outer[(ci + 1) % outer.length];
        let ax = c[0] - a[0],
          az = c[1] - a[1],
          qx = c[0] - q[0],
          qz = c[1] - q[1];
        const la = Math.hypot(ax, az) || 1,
          lq = Math.hypot(qx, qz) || 1;
        ax /= la;
        az /= la;
        qx /= lq;
        qz /= lq;
        let dx = ax + qx,
          dz = az + qz;
        const ld = Math.hypot(dx, dz);
        if (ld < 0.3 || la < 3 || lq < 3) continue;
        dx /= ld;
        dz /= ld;
        const px = c[0] + dx * 0.16 - ax * 0.25,
          pz = c[1] + dz * 0.16 - az * 0.25; // just around the corner on one face
        B.trim.addGeometry(
          CYLG,
          m4(px, (y0 + 0.25 + h - 0.15) / 2, pz, 0, 0.11, h - 0.4 - y0, 0.11),
          pipeC,
        );
        B.trim.addGeometry(
          BOXG,
          m4(px + dx * 0.12, y0 + 0.15, pz + dz * 0.12, Math.atan2(dx, dz), 0.12, 0.1, 0.32),
          pipeC,
        );
        n++;
      }
    }
    if (b.kind === 'terminal' && b.id === -9101) {
      // airport terminal: a deep flat canopy roof on slim columns over the curb and the gates
      const cv = scalePoly(outer, b.cx, b.cz, 7),
        cc = new THREE.Color(0xe4e2dc);
      fillPoly(B.roof, [cv], h + 1.5, new THREE.Color(0xd8d6d0), 1 / 6);
      fillPolyDown(B.trim, [cv], h + 0.5, cc);
      wallStrip(B.trim, cv, h + 0.5, h + 1.5, 10, 10, cc);
      if (opts.coll) {
        fillPoly(opts.coll, [cv], h + 1.5, 0xffffff, 1);
        fillPolyDown(opts.coll, [cv], h + 0.5, 0xffffff);
      }
      for (let i = 0; i < cv.length; i++) {
        const p = cv[i],
          q = cv[(i + 1) % cv.length],
          L = Math.hypot(q[0] - p[0], q[1] - p[1]),
          n = Math.max(1, Math.round(L / 24));
        for (let k = 0; k < n; k++) {
          const x = p[0] + ((q[0] - p[0]) * (k + 0.5)) / n,
            z = p[1] + ((q[1] - p[1]) * (k + 0.5)) / n,
            mx = x + (b.cx - x) * 0.03,
            mz = z + (b.cz - z) * 0.03;
          B.trim.addGeometry(
            CYLG,
            m4(mx, (h + 0.5) / 2, mz, 0, 0.7, h + 0.5, 0.7),
            new THREE.Color(0xcfd2d4),
          );
          if (opts.coll)
            opts.coll.addGeometry(BOXG, m4(mx, (h + 0.5) / 2, mz, 0, 0.7, h + 0.5, 0.7), 0xffffff);
        }
      }
    }
    if (
      style !== 'house' &&
      style !== 'warehouse' &&
      h > (ARTGEO_OFF ? 6 : 3.2) &&
      outer.length < 60
    )
      parapet(
        style === 'glass' ? B.trim : B.roof,
        outer,
        h,
        style === 'glass' ? 1.6 : 0.9,
        0.3,
        style === 'glass' ? new THREE.Color(0x3c434a) : roofC,
      );
    else if (style === 'warehouse' && !ARTGEO_OFF && h > 4 && outer.length < 60)
      parapet(B.trim, outer, h, 0.55, 0.22, new THREE.Color(0xb9b6ae)); // r2-art: warehouses get a low parapet with coping (the roof edge was a knife edge)
    if (
      style !== 'house' &&
      style !== 'warehouse' &&
      h > 9 &&
      y0 < 0.5 &&
      !b.part &&
      opts.lod !== 2 &&
      (b.area || 0) > 160
    ) {
      // roof dressing: stair / elevator bulkhead, timber-and-steel water tank on legs
      const fr = frameOf(outer),
        ry = Math.atan2(-fr.uz, fr.ux),
        hb = hash(seed + 401);
      if (fr.L > 10 && fr.W > 8) {
        const o = (hb - 0.5) * fr.L * 0.4,
          bh = 2.8 + hash(seed + 402) * 0.8;
        B.trim.addGeometry(
          BOXG,
          m4(fr.cx + fr.ux * o, h + bh / 2, fr.cz + fr.uz * o, ry, 4.2 + hb * 1.6, bh, 3.2),
          new THREE.Color(roofC).multiplyScalar(0.94),
        );
        B.trim.addGeometry(
          BOXG,
          m4(fr.cx + fr.ux * o, h + bh + 0.08, fr.cz + fr.uz * o, ry, 4.6 + hb * 1.6, 0.16, 3.6),
          new THREE.Color(0x6c6a66),
        );
        if (!opts.lod && h > 14 && style !== 'glass' && hash(seed + 403) < 0.35 && fr.L > 16) {
          const tx = fr.cx - fr.ux * (o > 0 ? 1 : -1) * fr.L * 0.22 - fr.uz * fr.W * 0.15,
            tz = fr.cz - fr.uz * (o > 0 ? 1 : -1) * fr.L * 0.22 + fr.ux * fr.W * 0.15,
            legC = new THREE.Color(0x4a4744);
          for (const [lx, lz] of [
            [-1, -1],
            [1, -1],
            [1, 1],
            [-1, 1],
          ])
            B.trim.addGeometry(
              BOXG,
              m4(tx + lx * 1.05, h + 0.85, tz + lz * 1.05, 0, 0.22, 1.7, 0.22),
              legC,
            );
          B.trim.addGeometry(
            CYLG,
            m4(tx, h + 3.2, tz, 0, 3.4, 3.0, 3.4),
            new THREE.Color(0x8a7460),
          );
          B.trim.addGeometry(
            new THREE.ConeGeometry(1.8, 0.9, 12),
            m4(tx, h + 5.15, tz),
            new THREE.Color(0x5a5550),
          );
        }
      }
    }
    if (
      !ARTGEO_OFF &&
      !opts.lod &&
      style !== 'house' &&
      h > 3.5 &&
      h < 46 &&
      y0 < 0.5 &&
      !b.part &&
      (b.area || 0) > 100 &&
      outer.length <= 16
    ) {
      // r2-art silhouette: rooftop package units on curbs and a mast or dish, sized to clear the parapet so the roofline reads
      // broken from the street (the vent covers alone sit below the parapet line)
      const fr = frameOf(outer),
        ry = Math.atan2(-fr.uz, fr.ux),
        n = Math.min(3, 1 + ((b.area / 400) | 0)),
        unitC = new THREE.Color(0xc4c2ba),
        grilleC = new THREE.Color(0x45484a),
        curbC = new THREE.Color(0x8d8a84);
      for (let k = 0; k < n; k++) {
        if (fr.L < 6 || fr.W < 5) break;
        const u = (hash(seed + 1501 + k) - 0.5) * (fr.L - 4),
          v = (hash(seed + 1511 + k) - 0.5) * (fr.W - 4),
          x = fr.cx + fr.ux * u - fr.uz * v,
          z = fr.cz + fr.uz * u + fr.ux * v,
          big = hash(seed + 1521 + k) < 0.5;
        const sx = big ? 2.2 : 1.3,
          sz = big ? 1.4 : 1.1,
          sy = big ? 1.25 : 0.95;
        B.trim.addGeometry(BOXG, m4(x, h + 0.1, z, ry, sx + 0.2, 0.2, sz + 0.2), curbC);
        B.trim.addGeometry(BOXG, m4(x, h + 0.2 + sy / 2, z, ry, sx, sy, sz), unitC);
        if (big)
          B.trim.addGeometry(
            CYLG,
            m4(
              x + fr.ux * sx * 0.25,
              h + 0.2 + sy + 0.04,
              z + fr.uz * sx * 0.25,
              0,
              0.7,
              0.08,
              0.7,
            ),
            grilleC,
          );
        else
          B.trim.addGeometry(
            BOXG,
            m4(x, h + 0.2 + sy * 0.5, z + 0.0, ry, sx * 0.85, sy * 0.7, sz + 0.02),
            grilleC,
          );
      }
      const hm = hash(seed + 1531);
      if (hm < 0.22) {
        const x = fr.cx - fr.ux * fr.L * 0.3,
          z = fr.cz - fr.uz * fr.L * 0.3,
          mh = 3 + hash(seed + 1532) * 3;
        B.trim.addGeometry(
          BOXG,
          m4(x, h + mh / 2, z, 0, 0.07, mh, 0.07),
          new THREE.Color(0x9a9c9e),
        );
        for (let k = 0; k < 3; k++)
          B.trim.addGeometry(
            BOXG,
            m4(x, h + mh - 0.4 - k * 0.5, z, ry + 0.5, 1.2 - k * 0.25, 0.03, 0.03),
            new THREE.Color(0x9a9c9e),
          );
      } else if (hm < 0.42) {
        const x = fr.cx + fr.ux * fr.L * 0.28 - fr.uz * fr.W * 0.2,
          z = fr.cz + fr.uz * fr.L * 0.28 + fr.ux * fr.W * 0.2;
        B.trim.addGeometry(
          BOXG,
          m4(x, h + 0.55, z, ry, 0.08, 1.1, 0.08),
          new THREE.Color(0x8a8a86),
        );
        B.trim.addGeometry(
          _dishG || (_dishG = new THREE.CylinderGeometry(0.32, 0.04, 0.12, 12)),
          m4(x, h + 1.2, z, ry + 2.2)
            .multiply(new THREE.Matrix4().makeRotationX(1.1))
            .multiply(new THREE.Matrix4().makeScale(1.6, 1.6, 1.6)),
          new THREE.Color(0xe2e0da),
        );
      }
    }
    if (
      opts.props &&
      !opts.lod &&
      style !== 'house' &&
      (style !== 'warehouse' || !ARTGEO_OFF) &&
      style !== 'glass' &&
      h > (style === 'warehouse' || !ARTGEO_OFF ? 3.5 : 6) &&
      h < 120 &&
      y0 < 0.5 &&
      !b.part &&
      (b.area || 0) > 120 &&
      outer.length < 40
    ) {
      // roof clutter: the user's vent covers and tanks (r2-art: warehouses too)
      const fr = frameOf(outer),
        ry = Math.atan2(-fr.uz, fr.ux),
        yb = h + (D ? baseOf(b) + 0.05 : 0),
        n = Math.min(4, 1 + ((b.area / 350) | 0));
      for (let k = 0; k < n; k++) {
        const u = (hash(seed + 801 + k) - 0.5) * Math.max(0, fr.L - 5),
          v = (hash(seed + 811 + k) - 0.5) * Math.max(0, fr.W - 3);
        LIBM.addClutter(
          'rv' + b.id + '_' + k,
          'roof_vents',
          fr.cx + fr.ux * u - fr.uz * v,
          yb,
          fr.cz + fr.uz * u + fr.ux * v,
          ry + (hash(seed + 821 + k) < 0.5 ? 0 : Math.PI / 2),
          1,
        );
      }
      if ((b.area || 0) > 420 && hash(seed + 831) < 0.3 && fr.L > 14 && fr.W > 9) {
        const u = (hash(seed + 832) < 0.5 ? -1 : 1) * (fr.L / 2 - 4.2),
          v = (hash(seed + 833) - 0.5) * (fr.W - 5);
        LIBM.addClutter(
          'rt' + b.id,
          'roof_tank',
          fr.cx + fr.ux * u - fr.uz * v,
          yb,
          fr.cz + fr.uz * u + fr.ux * v,
          ry,
          1,
        );
      }
    }
    if (
      opts.props &&
      !opts.lod &&
      FS &&
      FS.fam === 'brickRow' &&
      y0 < 0.5 &&
      !b.part &&
      h > 9 &&
      h < 30 &&
      hash(seed + 851) < 0.6
    ) {
      // brick walk-ups: the user's steel fire escape on a side wall
      let bi = -1,
        bl = 0;
      for (let i = 0; i < outer.length; i++) {
        const p = outer[i],
          q = outer[(i + 1) % outer.length],
          l = Math.hypot(q[0] - p[0], q[1] - p[1]);
        if (
          l > 11 &&
          l > bl &&
          (!roadDist || roadDist((p[0] + q[0]) / 2, (p[1] + q[1]) / 2) > 2.5)
        ) {
          bl = l;
          bi = i;
        }
      }
      if (bi >= 0) {
        const p = outer[bi],
          q = outer[(bi + 1) % outer.length],
          dx = (q[0] - p[0]) / bl,
          dz = (q[1] - p[1]) / bl,
          nx = -dz,
          nz = dx,
          u = bl * (0.3 + hash(seed + 852) * 0.4),
          x = p[0] + dx * u + nx * 1.62,
          z = p[1] + dz * u + nz * 1.62;
        LIBM.addClutter(
          'fe' + b.id,
          'fire_escape',
          x,
          (D ? TH(x, z) : 0) + 0.02,
          z,
          Math.atan2(-nz, nx),
          1,
          Math.min(1.15, Math.max(0.5, (h - 0.6) / 18.57)),
        );
      }
    }
    if (opts.props && !opts.lod && FS && FS.cond && y0 < 0.5 && !b.part && hash(seed + 841) < 0.5) {
      // rough side: a rusty utility cabinet against a wall
      let bi = 0,
        bl = 0;
      for (let i = 0; i < outer.length; i++) {
        const p = outer[i],
          q = outer[(i + 1) % outer.length],
          l = Math.hypot(q[0] - p[0], q[1] - p[1]);
        if (l > bl && (!roadDist || roadDist((p[0] + q[0]) / 2, (p[1] + q[1]) / 2) > 3)) {
          bl = l;
          bi = i;
        }
      }
      if (bl > 4) {
        const p = outer[bi],
          q = outer[(bi + 1) % outer.length],
          dx = (q[0] - p[0]) / bl,
          dz = (q[1] - p[1]) / bl,
          nx = -dz,
          nz = dx,
          u = bl * (0.2 + hash(seed + 842) * 0.6);
        const x = p[0] + dx * u + nx * 0.24,
          z = p[1] + dz * u + nz * 0.24;
        LIBM.addClutter('uc' + b.id, 'util_cabinet', x, D ? TH(x, z) : 0, z, Math.atan2(nx, nz), 1);
      }
    }
    if (
      opts.props &&
      style === 'house' &&
      !sf &&
      y0 < 0.5 &&
      !b.part &&
      h < 14 &&
      outer.length <= 24
    ) {
      // villa garden: clipped hedge ring + a pair of palms
      const ring = scalePoly(outer, b.cx, b.cz, 1.6),
        seedH = hash(seed + 301);
      for (let i = 0; i < ring.length; i++) {
        const p = ring[i],
          q = ring[(i + 1) % ring.length],
          L = Math.hypot(q[0] - p[0], q[1] - p[1]);
        for (let s2 = 1; s2 < L - 0.5; s2 += 2.6) {
          const x = p[0] + ((q[0] - p[0]) * s2) / L,
            z = p[1] + ((q[1] - p[1]) * s2) / L,
            hb = hash(((x * 7) | 0) * 31 + ((z * 5) | 0));
          if (hb < 0.45) continue;
          (hb > 0.93 ? opts.props.flower : opts.props.blob).push({
            x,
            y: 0,
            z,
            ry: hb * 20,
            s: 0.7 + hb * 0.4,
            color: new THREE.Color().setHSL(0.22 + hb * 0.08, 0.4, 0.62),
          });
        }
      }
      if (seedH < 0.8)
        for (const k of [0, 2]) {
          const p = ring[(((k * ring.length) / 4) | 0) % ring.length],
            dx = p[0] - b.cx,
            dz = p[1] - b.cz,
            l = Math.hypot(dx, dz) || 1;
          opts.props.palm.push({
            x: p[0] + (dx / l) * 1.8,
            y: 0,
            z: p[1] + (dz / l) * 1.8,
            ry: seedH * 9 + k,
            s: 0.8 + seedH * 0.4,
          });
        }
    }
    if (style === 'house' && outer.length <= 6 && b.area < 600 && ARTGEO_OFF) {
      /* unchanged before-state */ // before/after (?artgeo=0): the old pyramid over the world-axis bbox
      let x0 = Infinity,
        x1 = -Infinity,
        z0 = Infinity,
        z1 = -Infinity;
      for (const [x, z] of outer) {
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
        z0 = Math.min(z0, z);
        z1 = Math.max(z1, z);
      }
      const rg = new THREE.ConeGeometry(1, 1, 4, 1);
      rg.rotateY(Math.PI / 4);
      (FB ? B.roof : B.trim).addGeometry(
        rg,
        mat4(
          (x0 + x1) / 2,
          h + 1.2,
          (z0 + z1) / 2,
          0,
          (x1 - x0 + 1) * 0.7072,
          2.4,
          (z1 - z0 + 1) * 0.7072,
        ),
        new THREE.Color(
          FB ? (FS && FS.roofTint) || 0xffffff : [0xc8643c, 0xb85a38, 0xd2774a][(rr * 3) | 0],
        ),
      );
    } else if (style === 'house' && outer.length <= 8 && b.area < 900) {
      // hip roof (r2-art: a real ridge on the footprint's own axis, 0.55 m eaves with fascia, soffit, gutters and downspouts; was a pyramid over the world-axis bbox)
      ART_GEO_N.hip++;
      const fr = frameOf(outer),
        ry = Math.atan2(-fr.uz, fr.ux),
        ov = 0.55,
        Lr = Math.max(fr.L, fr.W) + 2 * ov,
        Wr = Math.min(fr.L, fr.W) + 2 * ov,
        ryR = fr.L >= fr.W ? ry : ry + Math.PI / 2;
      const rh = Math.min(4.5, Math.max(1.4, Wr * 0.27)),
        /* ~28 deg, a real Florida shingle / tile pitch (0.21 read as a flat lid) */ eY = h - 0.04,
        rC = new THREE.Color(
          hash(seed + 1211) < 0.4
            ? [0xb0603c, 0xa25a3a, 0xbc6c48][(rr * 3) | 0] /* barrel tile */
            : [0x8a8780, 0x7c7a76, 0x948c80][
                (rr * 3) | 0
              ] /* weathered asphalt shingle (the pale roof-slab tint read as a concrete lid) */,
        ); // per-house roof shade (faded / weathered tile)
      (FB ? B.roof : B.trim).addGeometry(hipRoofGeo(Lr, Wr, rh), mat4(fr.cx, eY, fr.cz, ryR), rC);
      if (opts.lod !== 2) {
        const fC = new THREE.Color(0xe7e3da),
          gC = new THREE.Color(0xd9d5cc),
          cr = Math.cos(ryR),
          sr = Math.sin(ryR),
          at = (lx, lz) => [fr.cx + lx * cr + lz * sr, fr.cz - lx * sr + lz * cr];
        for (const [lx, lz, sx, sz] of [
          [0, Wr / 2, Lr, 0.05],
          [0, -Wr / 2, Lr, 0.05],
          [Lr / 2, 0, 0.05, Wr],
          [-Lr / 2, 0, 0.05, Wr],
        ]) {
          const [x, z] = at(lx, lz);
          B.trim.addGeometry(BOXG, mat4(x, eY - 0.11, z, ryR, sx, 0.24, sz), fC);
        } // fascia boards
        {
          const [x, z] = at(0, 0);
          B.trim.addGeometry(
            BOXG,
            mat4(x, eY - 0.21, z, ryR, Lr - 0.06, 0.03, Wr - 0.06),
            fC.clone().multiplyScalar(0.9),
          );
        } // soffit (vented underside of the eaves)
        if (!opts.lod) {
          for (const sg of [1, -1]) {
            const [x, z] = at(0, sg * (Wr / 2 + 0.07));
            B.trim.addGeometry(BOXG, mat4(x, eY - 0.12, z, ryR, Lr, 0.12, 0.12), gC);
          } // K-style gutters on the eave sides
          const yb = 0; // batch geometry is relative to the building base (like the other downspouts)
          for (const [sx, sz] of [
            [1, 1],
            [-1, -1],
          ]) {
            const lx = sx * (Lr / 2 - ov - 0.12),
              lz = sz * (Wr / 2 - ov + 0.06),
              [x, z] = at(lx, lz),
              dh = eY - 0.15 - (y0 + yb);
            {
              const [ex, ez] = at(lx, sz * (Wr / 2 - ov / 2 + 0.03));
              B.trim.addGeometry(BOXG, mat4(ex, eY - 0.2, ez, ryR, 0.075, 0.075, ov + 0.1), gC);
            } // elbow back from the gutter to the wall // downspouts at two opposite corners, elbow at the gutter, kick-out shoe
            B.trim.addGeometry(
              BOXG,
              mat4(x, (eY - 0.15 + y0 + yb) / 2, z, ryR, 0.075, dh, 0.075),
              gC,
            );
            const [kx, kz] = at(lx, lz + sz * 0.16);
            B.trim.addGeometry(BOXG, mat4(kx, y0 + yb + 0.07, kz, ryR, 0.075, 0.075, 0.3), gC);
          }
          // condenser on a pad against the wall, and a roof breaker on some: TV antenna mast or a small satellite dish
          if (hash(seed + 1201) < 0.75) {
            const sg = hash(seed + 1202) < 0.5 ? 1 : -1,
              lx = (hash(seed + 1203) - 0.5) * (Lr - 2 * ov - 1.6),
              lz = sg * (Wr / 2 - ov + 0.55),
              [x, z] = at(lx, lz);
            B.trim.addGeometry(
              BOXG,
              mat4(x, y0 + 0.05, z, ryR, 1.05, 0.1, 1.0),
              new THREE.Color(0xa9a59c),
            ); // concrete pad
            B.trim.addGeometry(
              BOXG,
              mat4(x, y0 + 0.47, z, ryR, 0.78, 0.74, 0.78),
              new THREE.Color(0xc9c7bf),
            ); // casing
            B.trim.addGeometry(
              BOXG,
              mat4(x, y0 + 0.85, z, ryR, 0.66, 0.03, 0.66),
              new THREE.Color(0x3d3f40),
            ); // fan grille
            const [px, pz] = at(lx + 0.25, sg * (Wr / 2 - ov + 0.08));
            B.trim.addGeometry(
              BOXG,
              mat4(px, y0 + 0.75, pz, ryR, 0.06, 0.9, 0.06),
              new THREE.Color(0x8e8c86),
            );
          } // line set into the wall
          const hb = hash(seed + 1204);
          if (hb < 0.18) {
            const [x, z] = at(-Lr / 2 + ov + 1.2, 0);
            B.trim.addGeometry(
              BOXG,
              mat4(x, eY + rh * 0.6 + 1.0, z, ryR, 0.05, 2.6, 0.05),
              new THREE.Color(0x9a9c9e),
            ); // antenna mast + elements
            for (let k = 0; k < 3; k++)
              B.trim.addGeometry(
                BOXG,
                mat4(x, eY + rh * 0.6 + 1.6 + k * 0.45, z, ryR + 0.6, 1.1 - k * 0.25, 0.025, 0.025),
                new THREE.Color(0x9a9c9e),
              );
          } else if (hb < 0.38) {
            const [x, z] = at(Lr / 4, -Wr / 4);
            const dc = new THREE.Color(0xe2e0da); // dish on the rear slope
            B.trim.addGeometry(
              _dishG || (_dishG = new THREE.CylinderGeometry(0.32, 0.04, 0.12, 12)),
              mat4(x, eY + rh * 0.55 + 0.35, z, ryR + 2.2).multiply(
                new THREE.Matrix4().makeRotationX(1.1),
              ),
              dc,
            );
            B.trim.addGeometry(
              BOXG,
              mat4(x, eY + rh * 0.55 + 0.12, z, ryR, 0.05, 0.3, 0.05),
              new THREE.Color(0x8a8a86),
            );
          }
        }
      }
    }
    if (style === 'deco' && h > 9 && rr < 0.5) {
      const c = new THREE.Color(NEONS[(hash(seed + 5) * 6) | 0]);
      wallStrip(
        B.neon,
        outer.map(([x, z]) => [x + (x - b.cx) * 0.004, z + (z - b.cz) * 0.004]),
        h - 0.35,
        h - 0.12,
        10,
        10,
        c,
      );
    }
    if (
      !ARTGEO_OFF &&
      FB &&
      FS &&
      style === 'glass' &&
      !opts.lod &&
      y0 < 0.5 &&
      !b.part &&
      h > 8 &&
      h < 62 &&
      outer.length <= 12
    ) {
      ART_GEO_N.fins++;
      // r2-art: glass mid-rises were sheer painted boxes: aluminum mullion fins (0.07 x 0.22 m) every bay and a slab-edge band every
      // floor on the street faces, so the curtain wall has depth and casts thin shadows
      const gy = shops ? GF : 4.2,
        fh = FS.floorH || 3.6,
        bay = Math.max(1.2, FS.bayW || 1.5),
        finC = new THREE.Color(0x5d646b),
        bandC = new THREE.Color(0x6e757c);
      for (let i = 0; i < outer.length; i++) {
        const p = outer[i],
          q = outer[(i + 1) % outer.length],
          L = Math.hypot(q[0] - p[0], q[1] - p[1]);
        if (L < 5) continue;
        const tx = (q[0] - p[0]) / L,
          tz = (q[1] - p[1]) / L,
          nx = -tz,
          nz = tx; // every face (glass boxes are seen from lots and plazas too)
        const ry = Math.atan2(-tz, tx),
          nb = Math.max(1, Math.round(L / bay)),
          hh = h - 0.3 - gy;
        if (hh > 2)
          for (let k = 1; k < nb; k++) {
            const u = (k * L) / nb;
            B.trim.addGeometry(
              BOXG,
              m4(
                p[0] + tx * u + nx * 0.11,
                gy + hh / 2,
                p[1] + tz * u + nz * 0.11,
                ry,
                0.07,
                hh,
                0.22,
              ),
              finC,
            );
          }
        for (let y = gy; y < h - 1; y += fh)
          edgeSlab(B.trim, p[0], p[1], q[0], q[1], nx, nz, y - 0.1, 0.12, 0.2, bandC);
      }
    }
    if (
      !ARTGEO_OFF &&
      FB &&
      FS &&
      style === 'deco' &&
      !opts.lod &&
      y0 < 0.5 &&
      !b.part &&
      h > 6 &&
      h < 40 &&
      outer.length <= 12 &&
      hash(seed + 1401) < 0.75
    ) {
      ART_GEO_N.eyebrow++;
      // r2-art: Miami Beach deco "eyebrows": thin concrete sun shades over each window row, wrapping the street faces (the flat
      // painted box was the giveaway); depth 0.4-0.6 m, a soft shadow line every floor
      const gy = shops ? GF : 0,
        fh = FS.floorH || 3.2,
        nf = Math.max(1, Math.round((h - gy) / fh)),
        dep = 0.4 + hash(seed + 1402) * 0.2,
        ebC = new THREE.Color(FS.tint).lerp(new THREE.Color(0xf4f1ea), 0.6);
      for (let i = 0; i < outer.length; i++) {
        const p = outer[i],
          q = outer[(i + 1) % outer.length],
          L = Math.hypot(q[0] - p[0], q[1] - p[1]);
        if (L < 3) continue;
        const tx = (q[0] - p[0]) / L,
          tz = (q[1] - p[1]) / L,
          nx = -tz,
          nz = tx,
          street =
            !roadDist || roadDist((p[0] + q[0]) / 2 + nx * 4, (p[1] + q[1]) / 2 + nz * 4) <= 18;
        if (!street) continue;
        for (let f = 0; f < Math.min(nf, 10); f++) {
          const y = gy + f * fh + ((FS.sill ?? 0.3) + (FS.winH ?? 0.5)) * fh + 0.1;
          if (y > h - 0.6) break;
          edgeSlab(
            B.trim,
            p[0] + tx * 0.05,
            p[1] + tz * 0.05,
            q[0] - tx * 0.05,
            q[1] - tz * 0.05,
            nx,
            nz,
            y,
            dep,
            0.08,
            ebC,
          );
        }
      }
    }
    if (
      style === 'deco' &&
      h > 9 &&
      y0 < 0.5 &&
      !b.part &&
      opts.lod !== 2 &&
      roadDist &&
      outer.length <= 8 &&
      hash(seed + 601) < 0.4 &&
      /Beach/.test(ctx.districtAt ? ctx.districtAt(b.cx, b.cz) || '' : '')
    ) {
      // Ocean Drive deco: a vertical sign fin with neon edges on the street corner
      let bi = 0,
        bd = Infinity;
      for (let i = 0; i < outer.length; i++) {
        const d = roadDist(outer[i][0], outer[i][1]);
        if (d < bd) {
          bd = d;
          bi = i;
        }
      }
      const c = outer[bi],
        p = outer[(bi - 1 + outer.length) % outer.length],
        q = outer[(bi + 1) % outer.length];
      let ax = c[0] - p[0],
        az = c[1] - p[1],
        bx = c[0] - q[0],
        bz = c[1] - q[1];
      const la = Math.hypot(ax, az) || 1,
        lb = Math.hypot(bx, bz) || 1;
      ax /= la;
      az /= la;
      bx /= lb;
      bz /= lb;
      let dx = ax + bx,
        dz = az + bz;
      const ld = Math.hypot(dx, dz);
      if (ld > 0.3) {
        dx /= ld;
        dz /= ld;
        const ry = Math.atan2(-dz, dx),
          fh = Math.min(h - 1.5, 4 + (h - 4) * (0.7 + hash(seed + 602) * 0.25)),
          y1 = h - 0.2;
        B.trim.addGeometry(
          BOXG,
          m4(c[0] + dx * 0.75, y1 - fh / 2 + 0.6, c[1] + dz * 0.75, ry, 1.5, fh, 0.32),
          new THREE.Color(PASTELS[(hash(seed + 603) * 12) | 0]).lerp(
            new THREE.Color(0xffffff),
            0.35,
          ),
        );
        if (!ARTGEO_OFF) {
          const gC = new THREE.Color(PASTELS[(hash(seed + 603) * 12) | 0]).lerp(
            new THREE.Color(0x8a8a86),
            0.45,
          ); // r2-art: deco fin speed lines (horizontal grooves) so the fin reads as architecture, not a blank slab
          for (let k = 0; k < 5; k++)
            B.trim.addGeometry(
              BOXG,
              m4(c[0] + dx * 0.75, y1 - 0.9 - k * 0.55, c[1] + dz * 0.75, ry, 1.54, 0.12, 0.36),
              gC,
            );
        }
        const nc = new THREE.Color(NEONS[(hash(seed + 604) * 6) | 0]);
        B.neon.addGeometry(
          BOXG,
          m4(c[0] + dx * 1.52, y1 - fh / 2 + 0.6, c[1] + dz * 1.52, ry, 0.08, fh - 0.4, 0.36),
          nc,
        );
        B.neon.addGeometry(
          BOXG,
          m4(c[0] + dx * 0.75, y1 + 0.62, c[1] + dz * 0.75, ry, 1.56, 0.08, 0.36),
          nc,
        );
      }
    }
    if (opts.props && style !== 'house' && b.area > 120 && h < 120) {
      const n = Math.min(5, 1 + ((b.area / 300) | 0));
      for (let k = 0; k < n; k++) {
        const p = outer[(hash(seed + 10 + k) * outer.length) | 0];
        opts.props.ac.push({
          x: b.cx + (p[0] - b.cx) * 0.45,
          y: h,
          z: b.cz + (p[1] - b.cz) * 0.45,
          ry: hash(seed + 20 + k) < 0.5 ? 0 : 1.57,
          s: 0.9 + hash(seed + 30 + k) * 0.4,
        });
      }
    }
    if (opts.props && h > 90) opts.props.beacon.push({ x: b.cx, y: h + 2, z: b.cz, s: 2.5 });
    if (
      opts.props &&
      (style === 'warehouse' ||
        zone === 'industrial' ||
        zone === 'port' ||
        zone === 'commercial' ||
        zone === 'residential') &&
      hash(seed + 77) < (FS && FS.cond ? 0.75 : 0.14) &&
      h > 3.5
    ) {
      // rough side: most walls are tagged
      let bi = 0,
        bl = 0;
      for (let i = 0; i < outer.length; i++) {
        const p = outer[i],
          q = outer[(i + 1) % outer.length],
          l = Math.hypot(q[0] - p[0], q[1] - p[1]);
        if (l > bl) {
          bl = l;
          bi = i;
        }
      }
      if (bl > 5) {
        const p = outer[bi],
          q = outer[(bi + 1) % outer.length],
          dx = (q[0] - p[0]) / bl,
          dz = (q[1] - p[1]) / bl,
          nx = -dz,
          nz = dx,
          u = 0.3 + hash(seed + 78) * 0.4,
          sz = 2.2 + hash(seed + 79) * 1.6;
        opts.props.graffiti.push({
          x: p[0] + dx * bl * u + nx * 0.04,
          y: y0 + 0.9 + sz / 4,
          z: p[1] + dz * bl * u + nz * 0.04,
          ry: Math.atan2(nx, nz),
          s: sz,
          k: (hash(seed + 80) * 8) | 0,
        });
      }
    }
  }

  // ---- synthetic storefront lots: ground-floor shops on commercial / mixed-use frontages in the downtown-type districts ----
  // same lot format as DATA's storefronts (x/z inside, fx/fz on the facade, facing, w, d, kind, buildingId); shells get door gaps + h/doorX/doorW stamps
  const synthLots = new Map(),
    SHOP_ZONES = /downtown|business|brickell|commercial|midtown|arts|edgewater|overtown|nightlife/;
  const SHOP_KINDS = {
    downtown: [
      'cafe',
      'restaurant',
      'convenience',
      'pharmacy',
      'bank',
      'clothing',
      'electronics',
      'bar',
    ],
    nightlife: ['bar', 'restaurant', 'cafe', 'clothing', 'convenience'],
    default: [
      'cafe',
      'restaurant',
      'convenience',
      'pharmacy',
      'clothing',
      'electronics',
      'bar',
      'bank',
    ],
  };
  // Lots are only cut where the shell can sit exactly in the drawn ground-floor wall: real (near) footprints only (never the far-LOD
  // map polygons), rendered style with real walls, edge on the outer wall with its outward normal facing a street that no other
  // building blocks, every lot fully on one edge, the whole shell box inside the footprint and clear of the building's other lots.
  const NO_SHOP_STYLE = /warehouse|industrial|garage|house|canopy/;
  const SHOP_KINDS_V2 = {
    downtown: [
      'cafe',
      'restaurant',
      'convenience',
      'pharmacy',
      'clothing',
      'shoes',
      'bar',
      'liquor',
    ],
    nightlife: ['bar', 'restaurant', 'cafe', 'clothing', 'convenience'],
    default: [
      'cafe',
      'restaurant',
      'convenience',
      'pharmacy',
      'clothing',
      'bar',
      'shoes',
      'bakery',
    ],
  }; // shops pass: only kinds the V2 interiors build (no legacy toy rooms on synthetic lots)
  function synthShops(b, others) {
    if (b._synth !== undefined) return;
    b._synth = 0;
    if (
      b.part ||
      (b.minH || 0) > 0.5 ||
      b._overlap ||
      (b.storefronts && b.storefronts.length) ||
      b.h < 3.5 ||
      (b.area || 0) < 90 ||
      !roadDist ||
      !b.rings ||
      b.rings[0].length < 3
    )
      return;
    const zone = b.zone || zoneAt(b.cx, b.cz),
      dist = ctx.districtAt ? ctx.districtAt(b.cx, b.cz) || '' : '',
      mainOnly = !SHOP_ZONES.test(zone);
    if (
      (mainOnly &&
        !/Downtown|Brickell|Edgewater|Overtown|Arts|Collins Park|Wynwood|Midtown|Design District/.test(
          dist,
        )) ||
      NO_SHOP_STYLE.test(b.style || b.kind || '')
    )
      return;
    const rstyle = styleFor(b, zone, (b.id % 2147483647) | 0);
    if (rstyle === 'canopy' || rstyle === 'warehouse') return;
    if (LIBM.pick(b, rstyle, zone)) return; // library model lot: no shop shell inside the model // what buildBuilding will actually draw (a 'house' render still gets a full shop shell)
    const ring = orient(b.rings[0]),
      r0 = b.rings[0],
      inR = (r, x, z) => {
        let c = false;
        for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
          const xi = r[i][0],
            zi = r[i][1],
            xj = r[j][0],
            zj = r[j][1];
          if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
        }
        return c;
      };
    const inP = (x, z) => {
      if (!inR(r0, x, z)) return false;
      for (let k = 1; k < b.rings.length; k++) if (inR(b.rings[k], x, z)) return false;
      return true;
    };
    const pool = (others || []).slice(); // + footprints of the neighbouring tiles (a building across the seam can block / overlap the frontage)
    if (provider.getTile && provider.tileSize) {
      const T = provider.tileSize,
        i0 = Math.floor(b._bb[0] / T - 0.1),
        i1 = Math.floor(b._bb[1] / T + 0.1),
        j0 = Math.floor(b._bb[2] / T - 0.1),
        j1 = Math.floor(b._bb[3] / T + 0.1);
      for (let i = i0 - 1; i <= i1 + 1; i++)
        for (let j = j0 - 1; j <= j1 + 1; j++) {
          let t2 = null;
          try {
            t2 = provider.getTile(i, j);
          } catch (e) {
            /* not loaded */
          }
          if (!t2 || typeof t2.then === 'function' || !t2.buildings) continue;
          for (const o of t2.buildings) {
            if (pool.includes(o) || o.part || o._dropped) continue;
            if (!o._bb) {
              let a = Infinity,
                c = -Infinity,
                d = Infinity,
                e = -Infinity;
              for (const [x, z] of o.rings[0]) {
                a = Math.min(a, x);
                c = Math.max(c, x);
                d = Math.min(d, z);
                e = Math.max(e, z);
              }
              o._bb = [a, c, d, e];
            }
            pool.push(o);
          }
        }
    }
    const nb = pool.filter(
      (o) =>
        o !== b &&
        o.rings &&
        o._bb &&
        o._bb[0] < b._bb[1] + 14 &&
        o._bb[1] > b._bb[0] - 14 &&
        o._bb[2] < b._bb[3] + 14 &&
        o._bb[3] > b._bb[2] - 14,
    );
    const inOther = (x, z) =>
      nb.some(
        (o) =>
          x >= o._bb[0] && x <= o._bb[1] && z >= o._bb[2] && z <= o._bb[3] && inR(o.rings[0], x, z),
      );
    const kinds = AWN3D
        ? SHOP_KINDS_V2[zone] || SHOP_KINDS_V2.default
        : SHOP_KINDS[zone] || SHOP_KINDS.default,
      lots = [],
      W = AWN3D ? 6.5 : 5.5,
      rects = []; // shops pass: 6.5 m bays (the V2 interiors need >= 6 m inside); ?shops=0 = before
    const inLot = (x, z) =>
      rects.some((r) => {
        const dx = x - r.cx,
          dz = z - r.cz,
          u = dx * r.tx + dz * r.tz,
          v = dx * r.nx + dz * r.nz;
        return Math.abs(u) < r.hw && Math.abs(v) < r.hd;
      });
    const D = AWN3D
      ? Math.min(9, Math.max(6.5, Math.sqrt(b.area || 100) * 0.6))
      : Math.min(8, Math.max(5, Math.sqrt(b.area || 100) * 0.6));
    let lenN = 0; // lots on side streets (district rule)
    let perim = 0;
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i],
        q = ring[(i + 1) % ring.length];
      perim += Math.hypot(q[0] - p[0], q[1] - p[1]);
    }
    const maxLots = Math.max(10, Math.min(18, Math.floor(perim / 14))); // long downtown blocks: a shop every ~14 m of perimeter
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i],
        q = ring[(i + 1) % ring.length],
        L = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (L < W + 1.5) continue; // edge shorter than a lot (+ margins): none
      const tx = (q[0] - p[0]) / L,
        tz = (q[1] - p[1]) / L;
      let nx = -tz,
        nz = tx;
      const mx = (p[0] + q[0]) / 2,
        mz = (p[1] + q[1]) / 2;
      if (inP(mx + nx * 0.4, mz + nz * 0.4)) {
        nx = -nx;
        nz = -nz;
      } // outward
      if (inP(mx + nx * 0.4, mz + nz * 0.4) || !inP(mx - nx * 0.4, mz - nz * 0.4)) continue; // not a clean outer-wall edge (sliver / self-touching ring)
      if (roadDist(mx + nx * 6, mz + nz * 6) > 6) continue; // frontage must face a street
      const mainSt =
        !mainOnly ||
        !ctx.roadKindAt ||
        /trunk|primary|secondary|tertiary/.test(ctx.roadKindAt(mx + nx * 6, mz + nz * 6) || '');
      if (
        !mainSt &&
        !(/Collins Park|Overtown/.test(dist) && b.h >= 10 && b.h < 70 && (b.area || 0) < 2500)
      )
        continue;
      const edgeCap = mainSt
        ? maxLots
        : Math.min(maxLots, lots.length + Math.max(0, (/Overtown/.test(dist) ? 1 : 6) - lenN)); // residential districts: shops only on main streets (Collins Park hotel blocks: any street)
      for (let s2 = 0.75; s2 + W <= L - 0.75; s2 += W + 1) {
        if (lots.length >= edgeCap) break;
        const sm = s2 + W / 2,
          fx = p[0] + tx * sm,
          fz = p[1] + tz * sm,
          d = D,
          x = fx - (nx * d) / 2,
          z = fz - (nz * d) / 2;
        // street side: open sidewalk in front (no neighbouring building / party wall), a road within reach
        let blocked = false;
        for (const u of [-W / 2 + 0.3, 0, W / 2 - 0.3])
          for (const v of [0.4, 2, 4])
            if (inOther(fx + tx * u + nx * v, fz + tz * u + nz * v)) blocked = true;
        if (blocked || roadDist(fx + nx * 5, fz + nz * 5) > 8) continue;
        // the whole shell box (W x d behind the facade) inside this footprint, clear of the other lots of this building
        let ok = true;
        for (const u of [-W / 2 + 0.25, 0, W / 2 - 0.25])
          for (const v of [0.3, d / 2, d - 0.3]) {
            const px = fx + tx * u - nx * v,
              pz = fz + tz * u - nz * v;
            if (!inP(px, pz) || inLot(px, pz) || inOther(px, pz)) {
              ok = false;
              break;
            }
          }
        if (!ok) continue;
        rects.push({ cx: x, cz: z, tx, tz, nx, nz, hw: W / 2 + 0.2, hd: d / 2 + 0.2 });
        const id =
            (1e6 + (((Math.round(fx * 4) * 73856093) ^ (Math.round(fz * 4) * 19349663)) % 1e7)) | 0,
          kh = hash(id);
        const lot = {
          id,
          x: +x.toFixed(2),
          z: +z.toFixed(2),
          y: 0,
          w: W,
          d: +d.toFixed(2),
          facing: +Math.atan2(nx, nz).toFixed(4),
          fx: +fx.toFixed(2),
          fz: +fz.toFixed(2),
          kind: kinds[(kh * kinds.length) | 0],
          poi: false,
          buildingId: b.id,
          street: null,
          zone,
          sx: W,
          sz: +d.toFixed(2),
          synthetic: true,
        };
        if (!mainSt) lenN++;
        lots.push(lot);
        if (!synthLots.has(id)) {
          synthLots.set(id, lot);
          if (ctx.storefrontList) ctx.storefrontList.push(lot);
        }
      }
    }
    if (lots.length) {
      b.storefronts = lots;
      b._synth = lots.length;
    }
  }
  function synthShopsNear(x, z, r, out = []) {
    for (const l of synthLots.values()) if ((l.x - x) ** 2 + (l.z - z) ** 2 < r * r) out.push(l);
    return out;
  }
  const bldCache = new WeakMap();
  function runSynth(tile, out) {
    out._synthDone = true;
    for (const b of out) synthShops(b, out);
  }
  function buildingsOf(tile, synth = true) {
    let out = bldCache.get(tile);
    if (out) {
      if (synth && !tile._far && !out._synthDone) runSynth(tile, out);
      return out;
    }
    for (const b0 of tile.buildings || []) if (b0.style === 'stilt' && !b0.minH) b0.minH = 2.7; // Keys stilt houses stand on piles
    if (tile.x0 !== undefined && !tile._apt) {
      tile._apt = true; // Miami International terminal (bldmodels.js AIRPORT): synthetic lots in the tile holding their center
      for (const t of AIRPORT.terminal) {
        let cx = 0,
          cz = 0;
        for (const [x, z] of t.ring) {
          cx += x;
          cz += z;
        }
        cx /= t.ring.length;
        cz /= t.ring.length;
        if (
          cx < tile.x0 ||
          cx >= tile.x0 + (tile.size || provider.tileSize || 200) ||
          cz < tile.z0 ||
          cz >= tile.z0 + (tile.size || provider.tileSize || 200)
        )
          continue;
        (tile.buildings || (tile.buildings = [])).push({
          id: t.id,
          rings: [t.ring.map((p) => p.slice())],
          h: t.h,
          minH: 0,
          levels: Math.round(t.h / 5),
          kind: 'terminal',
          type: 'terminal',
          style: 'terminal',
          _forceStyle: 'glass',
          zone: 'airport',
          part: false,
          cx,
          cz,
          area: Math.abs(polyArea(t.ring)),
        });
      }
    }
    const all = tile.buildings || [],
      bbs = all.map((b) => {
        let a = Infinity,
          c = -Infinity,
          d = Infinity,
          e = -Infinity;
        for (const [x, z] of b.rings[0]) {
          a = Math.min(a, x);
          c = Math.max(c, x);
          d = Math.min(d, z);
          e = Math.max(e, z);
        }
        return [a, c, d, e];
      });
    const inP = (r, x, z) => {
      let c = false;
      for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
        const xi = r[i][0],
          zi = r[i][1],
          xj = r[j][0],
          zj = r[j][1];
        if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
      }
      return c;
    };
    const cen = (b) => {
      if (b.cx !== undefined) return [b.cx, b.cz];
      let x = 0,
        z = 0;
      for (const p of b.rings[0]) {
        x += p[0];
        z += p[1];
      }
      return [x / b.rings[0].length, z / b.rings[0].length];
    };
    const drop = new Set(),
      overlap = new Set();
    for (let i = 0; i < all.length; i++)
      for (let j = 0; j < all.length; j++) {
        if (i === j || drop.has(i) || drop.has(j)) continue;
        const A = bbs[i],
          Bb = bbs[j];
        if (A[1] < Bb[0] || A[0] > Bb[1] || A[3] < Bb[2] || A[2] > Bb[3]) continue;
        const bi = all[i],
          bj = all[j],
          [cx, cz] = cen(bi),
          ai = bi.area || 0,
          aj = bj.area || 0;
        if (inP(bj.rings[0], cx, cz) && (bi.part || (!bj.part && ai <= aj))) {
          drop.add(i);
          placeStats.bldDropped = (placeStats.bldDropped || 0) + 1;
          continue;
        } // part / duplicate inside another footprint
        if (bi.rings[0].some(([x, z]) => inP(bj.rings[0], x, z))) {
          overlap.add(i);
          overlap.add(j);
        }
      }
    out = all.filter(
      (b, i) =>
        !drop.has(i) &&
        !(
          inCasino(b.cx ?? b.rings[0][0][0], b.cz ?? b.rings[0][0][1]) ||
          b.rings[0].some(([x, z]) => inCasino(x, z))
        ),
    );
    for (const i of drop) all[i]._dropped = true;
    for (let i = 0; i < all.length; i++) if (overlap.has(i)) all[i]._overlap = true;
    for (let i = 0; i < all.length; i++) all[i]._bb = bbs[i];
    // W4 (Nov 19 playtest: "a brick store a few feet thick, glitched"): OSM slivers (a wall, sign or fence drawn as a building, or a
    // shop footprint cut down to a strip) under 2.6 m across drew as a full storefront shell a metre or two deep with its walls
    // flickering into each other, plus a solid collider. Dropped everywhere (near, mid / far and colliders read this list). ?bldsliver=0 = old
    if (BLD_SLIVER)
      out = out.filter((b) => {
        if (b.kind === 'terminal' || !b.rings || !b.rings[0] || b.rings[0].length < 3) return true;
        const f = frameOf(b.rings[0]);
        if (f.W >= 2.6 || (b.h || 0) < 2.2) return true;
        b._dropped = true;
        placeStats.bldSliver = (placeStats.bldSliver || 0) + 1;
        return false;
      });
    {
      // a drivable street running through a footprint (porte-cochere, terminal drive-through or OSM misalignment): lift the
      // building over a 5 m passage when it is tall enough, otherwise drop it; never a wall across a traffic lane
      const G = 10,
        grid = new Map(),
        T = provider.tileSize;
      let any = false;
      for (let i = -1; i <= 1; i++)
        for (let j = -1; j <= 1; j++) {
          let t2 = null;
          if (!i && !j) t2 = tile;
          else if (provider.getTile && tile.tx !== undefined) {
            try {
              t2 = provider.getTile(tile.tx + i, tile.tz + j);
            } catch (e) {
              /* */
            }
          }
          if (!t2 || t2.then || !t2.roads) continue;
          for (const r of t2.roads) {
            if (
              /service|footway|path|track|pedestrian|steps/.test(r.kind) ||
              owned(r) ||
              r.pts.length < 2
            )
              continue;
            const hw = r.width / 2;
            for (let k = 0; k < r.pts.length - 1; k++) {
              const a0 = r.pts[k],
                a1 = r.pts[k + 1],
                L = Math.hypot(a1[0] - a0[0], a1[1] - a0[1]);
              if (L < 0.01) continue;
              const dx = (a1[0] - a0[0]) / L,
                dz = (a1[1] - a0[1]) / L;
              for (let u = 0; u < L; u += 2)
                for (const o of [0, -(hw - 1.2), hw - 1.2]) {
                  const x = a0[0] + dx * u - dz * o,
                    z = a0[1] + dz * u + dx * o,
                    key = Math.floor(x / G) * 100003 + Math.floor(z / G);
                  let c = grid.get(key);
                  if (!c) grid.set(key, (c = []));
                  c.push(x, z);
                  any = true;
                }
            }
          }
        }
      if (any)
        out = out.filter((b) => {
          if (b._laneHit === undefined) {
            const bb = b._bb;
            let n = 0;
            if (bb)
              for (let gx = Math.floor(bb[0] / G); gx <= Math.floor(bb[1] / G); gx++)
                for (let gz = Math.floor(bb[2] / G); gz <= Math.floor(bb[3] / G); gz++) {
                  const c = grid.get(gx * 100003 + gz);
                  if (!c) continue;
                  for (let q = 0; q < c.length; q += 2)
                    if (
                      c[q] >= bb[0] &&
                      c[q] <= bb[1] &&
                      c[q + 1] >= bb[2] &&
                      c[q + 1] <= bb[3] &&
                      pipR(b.rings[0], c[q], c[q + 1])
                    )
                      n++;
                }
            b._laneHit = n;
          }
          if (b._laneHit < 3 || (b.minH || 0) >= 4.8) return true;
          if (b.h >= 9) {
            b.minH = 5;
            b._overlap = true;
            b._passage = true;
            placeStats.bldPassage = (placeStats.bldPassage || 0) + 1;
            return true;
          } // over the lanes: no shop shell on a lifted floor
          placeStats.bldOnLane = (placeStats.bldOnLane || 0) + 1;
          return false;
        });
    }
    if (elevated)
      out = out.filter((b) => {
        // no building through a deck: cap below the soffit (deck top - slab - 0.3 m), drop if that leaves < 3 m
        if (b._deckCap === undefined) {
          let lo = Infinity;
          const r0 = b.rings[0],
            pts = r0.slice();
          pts.push([b.cx ?? r0[0][0], b.cz ?? r0[0][1]]);
          for (let i = 0; i < r0.length; i++) {
            const q = r0[(i + 1) % r0.length];
            pts.push([(r0[i][0] + q[0]) / 2, (r0[i][1] + q[1]) / 2]);
          }
          let hits = 0;
          for (const [x, z] of pts) {
            const f = safeCall(() => elevated.footprintAt(x, z), null);
            if (f) {
              hits++;
              if (f.y < lo) lo = f.y;
            }
          }
          b._deckCap =
            lo === Infinity || hits < Math.max(2, pts.length * 0.25) ? null : lo - 1.3 - 0.3;
        } // a corner grazing the deck edge (OSM misalignment) is hidden by the barrier: only real overlaps count
        if (b._deckCap === null || b.h <= b._deckCap) return true;
        if (b._deckCap - (b.minH || 0) < 3) {
          placeStats.bldUnderDeck = (placeStats.bldUnderDeck || 0) + 1;
          return false;
        }
        b.h = b._deckCap;
        placeStats.bldCapped = (placeStats.bldCapped || 0) + 1;
        return true;
      });
    if (synth && !tile._far) runSynth(tile, out); // far-LOD map polygons never get shop lots; mid LOD does not need them
    bldCache.set(tile, out);
    return out;
  }
  // ---- elevated roads: smoothed profiles, node levels, deck cross-section ----
  const ELEV_MIN = 0.4,
    OPEN_Y = 4.5,
    DECK_T = 0.9,
    BAR_W = 0.45,
    BAR_H = 0.85;
  const endKey = (p) => Math.round(p[0] * 2) + ',' + Math.round(p[1] * 2);
  const tileEnds = new WeakMap();
  function endsOf(tile) {
    // endpoint key -> [{y, dx, dz}] for every road piece in the tile (ground roads y = 0)
    let m = tileEnds.get(tile);
    if (m) return m;
    m = new Map();
    for (const r of tile.roads) {
      if (r.pts.length < 2) continue;
      const n = r.pts.length;
      for (const [i, j] of [
        [0, 1],
        [n - 1, n - 2],
      ]) {
        const a = r.pts[i],
          b = r.pts[j],
          l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1,
          k = endKey(a);
        const y = r.y ? r.y[i] : 0;
        if (!m.has(k)) m.set(k, []);
        m.get(k).push({ y, dx: (b[0] - a[0]) / l, dz: (b[1] - a[1]) / l, r });
      }
    }
    tileEnds.set(tile, m);
    return m;
  }
  const profCache = new WeakMap();
  // an endpoint that lies outside its own tile (pieces run a few metres past the border to the next node) counts as a seam end too
  const outsideTile = (tile, p) => {
    const T = provider.tileSize || 200,
      tx = tile.tx ?? Math.floor(p[0] / T),
      tz = tile.tz ?? Math.floor(p[1] / T);
    return Math.floor(p[0] / T) !== tx || Math.floor(p[1] / T) !== tz;
  };
  const onSeam = (p) => {
    const T = provider.tileSize || 200,
      fx = p[0] / T - Math.round(p[0] / T),
      fz = p[1] / T - Math.round(p[1] / T);
    return Math.abs(fx) * T < 8 || Math.abs(fz) * T < 8;
  };
  // dense (3 m) resample + vertical-curve smoothing (endpoints pinned so pieces stay continuous at nodes); null ys = at grade
  function profileBase(r, tile) {
    let pr = baseCache.get(r);
    if (pr) return pr;
    let ymax = 0;
    if (r.y) for (const v of r.y) if (v > ymax) ymax = v;
    if (r.y && ymax >= ELEV_MIN && ymax < 2.0) {
      // low hump: only a real ramp if it continues into a higher deck at one of its ends
      const ends0 = endsOf(tile),
        n0 = r.pts.length;
      let chain = false;
      for (const [pi, yi] of [
        [0, r.y[0]],
        [n0 - 1, r.y[n0 - 1]],
      ])
        if (yi >= 0.3) {
          if (onSeam(r.pts[pi]) || outsideTile(tile, r.pts[pi])) chain = true;
          for (const e of ends0.get(endKey(r.pts[pi])) || [])
            if (e.r !== r && e.r.y && Math.max(...e.r.y) >= ymax + 0.3) chain = true;
        } // a deck cut by a tile seam continues next door
      if (!chain) ymax = 0;
    }
    if (!r.y || ymax < ELEV_MIN) {
      pr = { pts: r.terrainY && D ? densify(r.pts, 4) : r.pts, ys: null };
      baseCache.set(r, pr);
      return pr;
    }
    const pts = [],
      ys = [];
    for (let i = 0; i < r.pts.length - 1; i++) {
      const a = r.pts[i],
        b = r.pts[i + 1],
        L = Math.hypot(b[0] - a[0], b[1] - a[1]),
        n = Math.max(1, Math.ceil(L / 3));
      for (let k = 0; k < n; k++) {
        const t = k / n;
        pts.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
        ys.push(r.y[i] + (r.y[i + 1] - r.y[i]) * t);
      }
    }
    pts.push(r.pts[r.pts.length - 1]);
    ys.push(r.y[r.y.length - 1]);
    // ramp feet: an end that only meets at-grade roads is pinned to the ground (no 1 m step onto the street)
    const ends = endsOf(tile);
    for (const [ei, pi] of [
      [0, 0],
      [ys.length - 1, r.pts.length - 1],
    ]) {
      const others = (ends.get(endKey(r.pts[pi])) || []).filter((e) => e.r !== r);
      if (ys[ei] < 2.5 && others.length && others.every((e) => e.y < 0.3)) ys[ei] = 0;
      else {
        const el = others.filter((e) => e.y >= 0.3);
        if (el.length && ys[ei] >= 0.3)
          ys[ei] = (ys[ei] + el.reduce((a, e) => a + e.y, 0)) / (el.length + 1);
      } // split / merge: every branch meets at one node height
    }
    const n = ys.length,
      tmp = ys.slice();
    const raw = ys.slice();
    for (let it = 0, NIT = /motorway|trunk|primary/.test(r.kind) ? 90 : 28; it < NIT; it++) {
      for (let i = 1; i < n - 1; i++) tmp[i] = ys[i - 1] * 0.25 + ys[i] * 0.5 + ys[i + 1] * 0.25;
      for (let i = 1; i < n - 1; i++) ys[i] = Math.max(0, tmp[i]);
    }
    for (let i = 0; i < n; i++) {
      const w = Math.min(1, (Math.min(i, n - 1 - i) * 3) / 15);
      ys[i] = raw[i] + (ys[i] - raw[i]) * w;
    }
    // a low ramp section lying on top of an at-grade road is that road: bring it down to grade, then ease the transition
    {
      const gi = groundIndex(tile);
      let any = false;
      const hwR = r.width / 2;
      for (let i = 0; i < n; i++) {
        if (ys[i] >= 2.6) continue;
        const a = pts[Math.max(0, i - 1)],
          c = pts[Math.min(n - 1, i + 1)],
          dx = c[0] - a[0],
          dz = c[1] - a[1],
          l = Math.hypot(dx, dz) || 1,
          nx = -dz / l,
          nz = dx / l;
        if (
          !gi(pts[i][0], pts[i][1], -0.3) ||
          !gi(pts[i][0] + nx * hwR, pts[i][1] + nz * hwR, -0.6) ||
          !gi(pts[i][0] - nx * hwR, pts[i][1] - nz * hwR, -0.6)
        ) {
          ys[i] = 0;
          any = true;
        }
      }
      // ramp feet at a junction stay at grade across the whole junction fill, then climb
      for (const [ei, pi, dir] of [
        [0, 0, 1],
        [n - 1, r.pts.length - 1, -1],
      ]) {
        if (ys[ei] > 0.05) continue;
        const nd = nodeAt(r.pts[pi]);
        if (!nd || nd.degree < 3) continue;
        const Rn = nd.width / 2 + JUNC_PAD + 1.5;
        for (let i = ei, acc = 0; i >= 0 && i < n; i += dir) {
          if (i !== ei) acc += Math.hypot(pts[i][0] - pts[i - dir][0], pts[i][1] - pts[i - dir][1]);
          if (acc > Rn) break;
          ys[i] = 0;
          any = true;
        }
      }
      if (any) {
        const fixed = ys.map((v) => v === 0);
        for (let it = 0; it < 24; it++) {
          for (let i = 1; i < n - 1; i++)
            tmp[i] = ys[i - 1] * 0.25 + ys[i] * 0.5 + ys[i + 1] * 0.25;
          for (let i = 1; i < n - 1; i++) if (!fixed[i]) ys[i] = Math.max(0, tmp[i]);
        }
      }
    }
    pr = { pts, ys };
    baseCache.set(r, pr);
    return pr;
  }
  const baseCache = new WeakMap();
  // final profile = per-tile base profile, made continuous with the neighbouring tile's piece at every tile seam
  function roadProfile(r, tile) {
    let pr = profCache.get(r);
    if (pr) return pr;
    const b0 = profileBase(r, tile);
    pr = b0.ys ? { pts: b0.pts, ys: b0.ys.slice() } : { pts: b0.pts, ys: null };
    const T = provider.tileSize || 200;
    for (const atEnd of [false, true]) {
      const P = r.pts,
        n = P.length,
        p = atEnd ? P[n - 1] : P[0],
        q = atEnd ? P[n - 2] : P[1];
      const outside = outsideTile(tile, p);
      if (!onSeam(p) && !outside) continue;
      const dx = p[0] - q[0],
        dz = p[1] - q[1],
        l = Math.hypot(dx, dz) || 1,
        tx0 = tile.tx ?? Math.floor(p[0] / T),
        tz0 = tile.tz ?? Math.floor(p[1] / T);
      let nt = null;
      if (outside) {
        const c = provider.getTile
          ? provider.getTile(Math.floor(p[0] / T), Math.floor(p[1] / T))
          : null;
        if (c && !c.then) nt = c;
      }
      if (!nt)
        for (const st of [0.5, 3, 6, 9]) {
          const c = provider.getTile
            ? provider.getTile(
                Math.floor((p[0] + (dx / l) * st) / T),
                Math.floor((p[1] + (dz / l) * st) / T),
              )
            : null;
          if (c && !c.then && c !== tile && !(c.tx === tx0 && c.tz === tz0)) {
            nt = c;
            break;
          }
        }
      if (!nt || nt.then || nt === tile) continue;
      const k = endKey(p);
      let yN = null;
      for (const r2 of nt.roads) {
        if (r2.pts.length < 2) continue;
        const e0 = endKey(r2.pts[0]) === k,
          e1 = endKey(r2.pts[r2.pts.length - 1]) === k;
        if (!e0 && !e1) continue;
        const b2 = profileBase(r2, nt);
        yN = b2.ys ? (e0 ? b2.ys[0] : b2.ys[b2.ys.length - 1]) : 0;
        break;
      }
      if (yN === null) continue;
      // clipping sweep: on a relief tile every vertex is raised onto the terrain afterwards, so a piece without a deck profile (ground /
      // terrain road) must not inherit the neighbour's ABSOLUTE deck height (it was lifted twice: the collider floated ~7 m over the
      // ramp and cars fell through); compare against the terrain at the seam instead
      if (!CLIP_OFF && !pr.ys && tile.relief && D) {
        yN = yN - TH(p[0], p[1]);
        if (yN < 0.3) continue;
      }
      const yS = pr.ys ? (atEnd ? pr.ys[pr.ys.length - 1] : pr.ys[0]) : 0,
        target = (yS + yN) / 2,
        d = target - yS;
      if (Math.abs(d) < 0.005) continue;
      if (!pr.ys) pr = { pts: P, ys: new Array(n).fill(0) };
      const Q = pr.pts,
        m = Q.length;
      let acc = 0;
      for (let s2 = 0; s2 < m; s2++) {
        const i2 = atEnd ? m - 1 - s2 : s2;
        if (s2) {
          const pPrev = Q[atEnd ? i2 + 1 : i2 - 1];
          acc += Math.hypot(Q[i2][0] - pPrev[0], Q[i2][1] - pPrev[1]);
        }
        if (acc > 20) break;
        pr.ys[i2] = Math.max(0, pr.ys[i2] + d * (1 - acc / 20));
      }
    }
    profCache.set(r, pr);
    return pr;
  }

  const nodeLvCache = new WeakMap();
  // per node: which level gets a junction fill ('ground' at 0, 'deck' at the shared deck height) or none (overpass crossing)
  // ground-continuity R1: mirrors the junction loop in buildRoads: true when a junction fill is drawn at road end p
  let gNodeIdx = null;
  function junctionDrawn(tile, p) {
    if (GC_OFF) return true;
    const k = endKey(p);
    if (!gNodeIdx) {
      gNodeIdx = new Map();
      for (const n of (D && D.roadGraph && D.roadGraph.nodes) || [])
        gNodeIdx.set(endKey([n.x, n.z]), n);
    }
    const gn = gNodeIdx.get(k),
      lv = nodeLevel(tile, { x: p[0], z: p[1] });
    if (!lv.kind) return false;
    if (elevated) {
      const es = endsOf(tile).get(k) || [],
        ow = es.filter((e) => owned(e.r)).length;
      if (
        ow &&
        (ow === es.length || (gn && safeCall(() => elevated.isGroundJunctionBlocked(gn.id), false)))
      )
        return false;
    }
    return true;
  }
  function nodeLevel(tile, n) {
    let m = nodeLvCache.get(tile);
    if (!m) nodeLvCache.set(tile, (m = new Map()));
    const k = endKey([n.x, n.z]);
    if (m.has(k)) return m.get(k);
    const es = (endsOf(tile).get(k) || []).map((e) => {
      const pr = roadProfile(e.r, tile);
      const atStart = endKey(e.r.pts[0]) === k;
      return pr.ys ? (atStart ? pr.ys[0] : pr.ys[pr.ys.length - 1]) : 0;
    });
    const g = es.filter((y) => y < 0.3).length,
      el = es.filter((y) => y >= 0.3);
    const res =
      g >= 2 || (g >= 1 && !el.length) || !es.length
        ? { kind: 'ground', y: 0 }
        : el.length >= 2 && !g
          ? { kind: 'deck', y: el.reduce((a, b) => a + b, 0) / el.length }
          : { kind: null, y: 0 };
    m.set(k, res);
    return res;
  }
  const eIdxCache = new WeakMap();
  function elevIndex(tile) {
    // (x, z, y, self, dy) -> true when (x,z) lies on ANOTHER deck whose surface is within dy of y (dy<0: any deck lower than y)
    let f = eIdxCache.get(tile);
    if (f) return f;
    const CELL = 10,
      segs = [],
      grid = new Map();
    for (const g of tile.roads) {
      if (g.pts.length < 2) continue;
      const pr = roadProfile(g, tile);
      if (!pr.ys) continue;
      const hw = g.width / 2,
        P = pr.pts;
      for (let i = 0; i < P.length - 1; i++) {
        const a = P[i],
          b = P[i + 1];
        segs.push([a[0], a[1], b[0], b[1], hw, pr.ys[i], pr.ys[i + 1], g]);
        const k0 = segs.length - 1;
        for (
          let gx = Math.floor((Math.min(a[0], b[0]) - hw - 1) / CELL);
          gx <= Math.floor((Math.max(a[0], b[0]) + hw + 1) / CELL);
          gx++
        )
          for (
            let gz = Math.floor((Math.min(a[1], b[1]) - hw - 1) / CELL);
            gz <= Math.floor((Math.max(a[1], b[1]) + hw + 1) / CELL);
            gz++
          ) {
            const k = gx * 100003 + gz;
            if (!grid.has(k)) grid.set(k, []);
            grid.get(k).push(k0);
          }
      }
    }
    f = (x, z, y, self, dy) => {
      const c = grid.get(Math.floor(x / CELL) * 100003 + Math.floor(z / CELL));
      if (!c) return false;
      for (const i of c) {
        const [ax, az, bx, bz, hw, y0, y1, g] = segs[i];
        if (g === self) continue;
        const dx = bx - ax,
          dz = bz - az,
          L2 = dx * dx + dz * dz || 1;
        let t = ((x - ax) * dx + (z - az) * dz) / L2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const ex = ax + dx * t - x,
          ez = az + dz * t - z;
        if (ex * ex + ez * ez < (hw + 0.3) * (hw + 0.3)) {
          const yy = y0 + (y1 - y0) * t;
          if (dy >= 0 ? Math.abs(yy - y) < dy : yy < y - 1) return true;
        }
      }
      return false;
    };
    f.nearestY = (x, z, y, tol) => {
      const c = grid.get(Math.floor(x / CELL) * 100003 + Math.floor(z / CELL));
      let best = null,
        bd = tol;
      if (!c) return null;
      for (const i of c) {
        const [ax, az, bx, bz, hw, y0, y1] = segs[i],
          dx = bx - ax,
          dz = bz - az,
          L2 = dx * dx + dz * dz || 1;
        let t = ((x - ax) * dx + (z - az) * dz) / L2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const ex = ax + dx * t - x,
          ez = az + dz * t - z;
        if (ex * ex + ez * ez < hw * hw) {
          const yy = y0 + (y1 - y0) * t,
            d = Math.abs(yy - y);
          if (d < bd) {
            bd = d;
            best = yy;
          }
        }
      }
      return best;
    };
    f.otherY = (x, z, y, self, tol, ux = 0, uz = 0) => {
      const c = grid.get(Math.floor(x / CELL) * 100003 + Math.floor(z / CELL));
      let best = null;
      if (!c) return best;
      for (const i of c) {
        const [ax, az, bx, bz, hw, y0, y1, g] = segs[i];
        if (g === self) continue;
        const dx = bx - ax,
          dz = bz - az,
          L2 = dx * dx + dz * dz || 1;
        let t = ((x - ax) * dx + (z - az) * dz) / L2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const ex = ax + dx * t - x,
          ez = az + dz * t - z;
        if (ex * ex + ez * ez < hw * hw) {
          if ((ux || uz) && Math.abs(dx * ux + dz * uz) / Math.sqrt(L2) < 0.85) continue;
          const yy = y0 + (y1 - y0) * t;
          if (Math.abs(yy - y) < tol && (best === null || yy > best)) best = yy;
        }
      }
      return best;
    };
    f.dyAt = (x, z, y, self) => {
      const c = grid.get(Math.floor(x / CELL) * 100003 + Math.floor(z / CELL));
      let best = Infinity;
      if (!c) return best;
      for (const i of c) {
        const [ax, az, bx, bz, hw, y0, y1, g] = segs[i];
        if (g === self) continue;
        const dx = bx - ax,
          dz = bz - az,
          L2 = dx * dx + dz * dz || 1;
        let t = ((x - ax) * dx + (z - az) * dz) / L2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const ex = ax + dx * t - x,
          ez = az + dz * t - z;
        if (ex * ex + ez * ez < hw * hw) best = Math.min(best, Math.abs(y0 + (y1 - y0) * t - y));
      }
      return best;
    };
    eIdxCache.set(tile, f);
    return f;
  }
  const gIdxCache = new WeakMap();
  function groundIndex(tile) {
    // 10 m grid of at-grade road segments: (x, z, pad) -> true when clear of every ground ribbon
    let f = gIdxCache.get(tile);
    if (f) return f;
    const CELL = 10,
      segs = [],
      grid = new Map();
    for (const g of tile.roads) {
      if (g.pts.length < 2 || (g.y && Math.max(...g.y) >= ELEV_MIN)) continue;
      const hw = g.width / 2;
      for (let i = 0; i < g.pts.length - 1; i++) {
        const a = g.pts[i],
          b = g.pts[i + 1];
        segs.push([a[0], a[1], b[0], b[1], hw]);
        const k0 = segs.length - 1;
        for (
          let gx = Math.floor((Math.min(a[0], b[0]) - hw - 2) / CELL);
          gx <= Math.floor((Math.max(a[0], b[0]) + hw + 2) / CELL);
          gx++
        )
          for (
            let gz = Math.floor((Math.min(a[1], b[1]) - hw - 2) / CELL);
            gz <= Math.floor((Math.max(a[1], b[1]) + hw + 2) / CELL);
            gz++
          ) {
            const k = gx * 100003 + gz;
            if (!grid.has(k)) grid.set(k, []);
            grid.get(k).push(k0);
          }
      }
    }
    f = (x, z, pad) => {
      const c = grid.get(Math.floor(x / CELL) * 100003 + Math.floor(z / CELL));
      if (!c) return true;
      for (const i of c) {
        const [ax, az, bx, bz, hw] = segs[i],
          dx = bx - ax,
          dz = bz - az,
          L2 = dx * dx + dz * dz || 1;
        let t = ((x - ax) * dx + (z - az) * dz) / L2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const ex = ax + dx * t - x,
          ez = az + dz * t - z,
          gw = hw + pad;
        if (gw > 0 && ex * ex + ez * ez < gw * gw) return false;
      }
      return true;
    };
    gIdxCache.set(tile, f);
    return f;
  }
  // a vertical quad between two frame points at lateral offset o, bottom/top heights per end; faces `facing` (+1 = right of travel)
  function wallSeg(batch, A, Bf, o, ya0, ya1, yb0, yb1, col, facing) {
    const ax = A.x + A.nx * o,
      az = A.z + A.nz * o,
      bx = Bf.x + Bf.nx * o,
      bz = Bf.z + Bf.nz * o;
    let nx = -(bz - az),
      nz = bx - ax;
    const l = Math.hypot(nx, nz) || 1;
    nx /= l;
    nz /= l;
    if (facing < 0) {
      nx = -nx;
      nz = -nz;
    }
    const q = [
        [ax, ya0, az],
        [bx, yb0, bz],
        [bx, yb1, bz],
        [ax, ya1, az],
      ],
      L = Math.hypot(bx - ax, bz - az);
    const cr = (q[1][0] - q[0][0]) * nz - (q[1][2] - q[0][2]) * nx,
      order = cr > 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2];
    for (const k of order)
      batch.vert(
        q[k][0],
        q[k][1],
        q[k][2],
        nx,
        0,
        nz,
        (k === 1 || k === 2 ? L : 0) * 0.25,
        q[k][1] * 0.25,
        col,
      );
  }
  function quadDown(batch, a, b, c, d, col) {
    // soffit: face normal -Y
    const ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]),
      P = ny <= 0 ? [a, b, c, a, c, d] : [a, c, b, a, d, c];
    for (const p of P) batch.vert(p[0], p[1], p[2], 0, -1, 0, p[0] * 0.15, p[2] * 0.15, col);
  }
  const WHITE = new THREE.Color(0xffffff),
    C_BAR = new THREE.Color(0xd9d6cf),
    C_FASCIA = new THREE.Color(0xcfccc4),
    C_RETAIN = new THREE.Color(0xbdb8ae),
    C_SOFFIT = new THREE.Color(0x6e6c68),
    C_RAIL = new THREE.Color(0x8d939a),
    C_PIER = new THREE.Color(0xc4c0b8);
  // deck cross-section for an elevated road: jersey barriers + rail, edge fascia + soffit when open, retaining walls on embankment ramps,
  // pier bents (column(s) + cap) every ~30 m where the deck is high, expansion joints; colliders get the exact deck + barrier faces
  function deckDress(B, coll, fr, ys, r, hw, yTop, tile, cutA, cutB) {
    const n = fr.length,
      gIdx = groundIndex(tile),
      eIdx = elevIndex(tile);
    const clearOfGround = (x, z, pad) => gIdx(x, z, pad);
    for (let i = 0; i < n - 1; i++) {
      const A = fr[i],
        Bf = fr[i + 1];
      if (Bf.s <= cutA || A.s >= cutB) continue;
      const y0 = ys[i],
        y1 = ys[i + 1],
        lo = Math.min(y0, y1),
        hi = Math.max(y0, y1);
      if (hi < 1.0) continue; // ramp foot: open like a street
      if (lo < OPEN_Y && !clearOfGround((A.x + Bf.x) / 2, (A.z + Bf.z) / 2, -0.5)) continue; // merge zone over a ground road: no walls across its lanes
      const t0 = y0 + yTop,
        t1 = y1 + yTop; // deck surface
      for (const side of [-1, 1]) {
        const oE = side * hw,
          oB = side * (hw - BAR_W);
        {
          const mx = (A.x + Bf.x) / 2 + ((A.nx + Bf.nx) / 2) * (oE + side * 0.6),
            mz = (A.z + Bf.z) / 2 + ((A.nz + Bf.nz) / 2) * (oE + side * 0.6);
          if (eIdx(mx, mz, (y0 + y1) / 2, r, 4.0)) continue;
          const bx = (A.x + Bf.x) / 2 + ((A.nx + Bf.nx) / 2) * oB,
            bz = (A.z + Bf.z) / 2 + ((A.nz + Bf.nz) / 2) * oB;
          if (eIdx(bx, bz, (y0 + y1) / 2, r, 4.0)) continue;
        } // split / merge: the neighbour deck continues here, no wall across it
        // jersey barrier: inner face, sloped cap, steel rail
        wallSeg(B.trim, A, Bf, oB, t0, t0 + BAR_H, t1, t1 + BAR_H, C_BAR, -side);
        quadUp(
          B.trim,
          [A.x + A.nx * oB, t0 + BAR_H, A.z + A.nz * oB],
          [A.x + A.nx * oE, t0 + BAR_H, A.z + A.nz * oE],
          [Bf.x + Bf.nx * oE, t1 + BAR_H, Bf.z + Bf.nz * oE],
          [Bf.x + Bf.nx * oB, t1 + BAR_H, Bf.z + Bf.nz * oB],
          C_BAR,
          0.25,
        );
        const oR = side * (hw - BAR_W * 0.5);
        wallSeg(
          B.guard,
          A,
          Bf,
          oR,
          t0 + BAR_H + 0.18,
          t0 + BAR_H + 0.3,
          t1 + BAR_H + 0.18,
          t1 + BAR_H + 0.3,
          C_RAIL,
          side,
        );
        wallSeg(
          B.guard,
          A,
          Bf,
          oR,
          t0 + BAR_H + 0.18,
          t0 + BAR_H + 0.3,
          t1 + BAR_H + 0.18,
          t1 + BAR_H + 0.3,
          C_RAIL,
          -side,
        );
        if (coll) coll.tag = 'deckBarrier';
        if (coll)
          wallSeg(
            coll,
            A,
            Bf,
            oB,
            t0 - 0.05,
            t0 + BAR_H + 0.3,
            t1 - 0.05,
            t1 + BAR_H + 0.3,
            C_BAR,
            -side,
          );
        // outer face: retaining wall down to the ground on embankments, slab fascia when the deck is open underneath
        if (hi < OPEN_Y)
          wallSeg(B.trim, A, Bf, oE, -0.3, t0 + BAR_H, -0.3, t1 + BAR_H, C_RETAIN, side);
        else
          wallSeg(
            B.trim,
            A,
            Bf,
            oE,
            t0 - DECK_T,
            t0 + BAR_H,
            t1 - DECK_T,
            t1 + BAR_H,
            C_FASCIA,
            side,
          );
      }
      if (lo >= OPEN_Y - 0.01)
        quadDown(
          B.trim,
          [A.x - A.nx * hw, t0 - DECK_T, A.z - A.nz * hw],
          [A.x + A.nx * hw, t0 - DECK_T, A.z + A.nz * hw],
          [Bf.x + Bf.nx * hw, t1 - DECK_T, Bf.z + Bf.nz * hw],
          [Bf.x - Bf.nx * hw, t1 - DECK_T, Bf.z - Bf.nz * hw],
          C_SOFFIT,
        );
    }
    // piers + expansion joints
    const L = fr[n - 1].s;
    for (let s = Math.max(cutA, 0) + 15; s < Math.min(L, cutB) - 8; s += 30) {
      let q = sampleAt(fr, s, ys);
      if (q.y < OPEN_Y) continue;
      ribbon(
        B.marks,
        fr,
        ys,
        -hw + BAR_W,
        hw - BAR_W,
        yTop + 0.015,
        0x2c2c2e,
        1,
        s - 0.06,
        s + 0.06,
      ); // expansion joint
      let ok = false;
      for (const ds of [0, 5, -5, 10, -10]) {
        const qq = sampleAt(fr, s + ds, ys);
        if (qq.y >= OPEN_Y && clearOfGround(qq.x, qq.z, 1.5) && !eIdx(qq.x, qq.z, qq.y, r, -1)) {
          q = qq;
          ok = true;
          break;
        }
      }
      if (!ok) continue;
      const ry = Math.atan2(q.dx, q.dz),
        bot = q.y + yTop - DECK_T,
        capH = 1.1,
        colTop = bot - capH;
      B.trim.addGeometry(
        BOXG,
        mat4(q.x, bot - capH / 2, q.z, ry, r.width * 0.86, capH, 1.6),
        C_PIER,
      ); // pier cap
      const cols = r.width > 9 ? [-hw * 0.55, hw * 0.55] : [0];
      for (const o of cols) {
        const cx = q.x + q.nx * o,
          cz = q.z + q.nz * o,
          h = colTop + 3;
        B.trim.addGeometry(CYLG, mat4(cx, colTop - h / 2, cz, 0, 1.25, h, 1.25), C_PIER);
        if (coll) coll.tag = 'pier';
        if (coll)
          Batch.prototype.addGeometry.call(
            coll,
            BOXG,
            mat4(cx, colTop - h / 2, cz, 0, 1.2, h, 1.2),
            C_PIER,
          );
      }
    }
  }
  // ground sidewalk slabs that would cut through a low deck / ramp are dropped (render, mid LOD and colliders alike)
  const swCache = new WeakMap(),
    JUNC_PAD = 3.0;
  function sidewalksOf(tile) {
    let out = swCache.get(tile);
    if (out) return out;
    const all0 = tile.sidewalkPolys || [],
      hits = [];
    // Keys / rural lanes have no sidewalks: drop slabs whose outline mostly follows a lane (job 4)
    const G0 = D && D.roadGraph,
      all =
        JOB4_OFF || !G0 || !G0.nearestEdge
          ? all0
          : all0.filter((rings) => {
              const r0 = rings[0],
                st = Math.max(1, Math.floor(r0.length / 12));
              let n = 0,
                l = 0;
              for (let i = 0; i < r0.length; i += st) {
                const q = G0.nearestEdge(r0[i][0], r0[i][1], {}, 25);
                if (!q) continue;
                n++;
                if (laneEdge(q.edge)) l++;
              }
              return !(n && l / n > 0.5);
            });
    if (elevated) {
      out = all.filter(
        (rings) =>
          !rings[0].some(([x, z]) => {
            const f = safeCall(() => elevated.footprintAt(x, z), null);
            return f && (f.type === 1 || f.y < 4.5);
          }),
      );
      swCache.set(tile, out);
      return out;
    }
    for (const r of tile.roads) {
      const pr = r.pts.length > 1 ? roadProfile(r, tile) : null;
      if (!pr || !pr.ys) continue;
      const rad = r.width / 2 + 0.6;
      for (let i = 0; i < pr.pts.length; i++)
        if (pr.ys[i] > 0.25 && pr.ys[i] < OPEN_Y + 1.5)
          hits.push([pr.pts[i][0], pr.pts[i][1], rad]);
    }
    const inPoly = (r, x, z) => {
      let c = false;
      for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
        const xi = r[i][0],
          zi = r[i][1],
          xj = r[j][0],
          zj = r[j][1];
        if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
      }
      return c;
    };
    out = all.filter((rings) => {
      const r0 = rings[0];
      for (const [hx, hz, rad] of hits) {
        if (inPoly(r0, hx, hz)) return false;
        for (const [x, z] of r0) if ((x - hx) ** 2 + (z - hz) ** 2 < rad * rad) return false;
      }
      return true;
    });
    swCache.set(tile, out);
    return out;
  }
  // ribbon with per-vertex left/right offsets (decks narrowed where a parallel deck at another height overlaps)
  function vribbon(batch, fr, ys, oL, oR, yOff, color, uvS, sA = 0, sB = Infinity) {
    const col = new THREE.Color(color);
    for (let i = 0; i < fr.length - 1; i++) {
      const A = fr[i],
        Bf = fr[i + 1],
        L = Bf.s - A.s;
      if (L <= 1e-6 || Bf.s <= sA || A.s >= sB) continue;
      const t0 = A.s < sA ? (sA - A.s) / L : 0,
        t1 = Bf.s > sB ? (sB - A.s) / L : 1;
      const P = (t, side) => {
        const x = A.x + (Bf.x - A.x) * t,
          z = A.z + (Bf.z - A.z) * t,
          nx = A.nx + (Bf.nx - A.nx) * t,
          nz = A.nz + (Bf.nz - A.nz) * t,
          o = side < 0 ? oL[i] + (oL[i + 1] - oL[i]) * t : oR[i] + (oR[i + 1] - oR[i]) * t,
          y = ys[i] + (ys[i + 1] - ys[i]) * t + yOff;
        return [x + nx * o, y, z + nz * o];
      };
      quadUp(batch, P(t0, -1), P(t0, 1), P(t1, 1), P(t1, -1), col, uvS);
    }
  }
  const resolved = new WeakSet();
  function resolveDecks(tile) {
    if (resolved.has(tile)) return;
    resolved.add(tile);
    const el = tile.roads.filter((g) => g.pts.length > 1 && roadProfile(g, tile).ys);
    if (el.length < 2) return;
    for (let pass = 0; pass < 2; pass++) {
      const e = elevIndex(tile);
      eIdxCache.delete(tile);
      for (const g of el) {
        const pr = roadProfile(g, tile),
          P = pr.pts,
          n = P.length;
        let ch = false;
        for (let i = 0; i < n; i++) {
          const a = P[Math.max(0, i - 1)],
            c = P[Math.min(n - 1, i + 1)],
            l = Math.hypot(c[0] - a[0], c[1] - a[1]) || 1;
          const oy = e.otherY(P[i][0], P[i][1], pr.ys[i], g, pass === 0 ? 3.0 : 0.6);
          if (
            oy !== null &&
            oy > pr.ys[i] + 0.01 &&
            pr.ys[i] > 0 &&
            !((i === 0 || i === n - 1) && onSeam(P[i]))
          ) {
            pr.ys[i] = oy;
            ch = true;
          }
        }
        if (ch && pass === 0) {
          const fx = pr.ys.map((v) => v === 0),
            tmp = pr.ys.slice();
          for (let it = 0; it < 20; it++) {
            for (let i = 1; i < n - 1; i++)
              tmp[i] = Math.max(pr.ys[i] * 0.5 + (pr.ys[i - 1] + pr.ys[i + 1]) * 0.25, 0);
            for (let i = 1; i < n - 1; i++) if (!fx[i]) pr.ys[i] = tmp[i];
          }
        }
      }
    }
  }
  function deckWidths(fr, ys, r, hw, tile) {
    const e = elevIndex(tile),
      oL = [],
      oR = [];
    let shrunk = false;
    for (let i = 0; i < fr.length; i++) {
      const A = fr[i],
        nl = Math.hypot(A.nx, A.nz) || 1,
        ux = A.nx / nl,
        uz = A.nz / nl;
      for (const side of [-1, 1]) {
        let o = hw;
        while (o > 1.0) {
          const oy = null,
            dy = 0;
          if (dy >= 0.6 && oy !== null) {
            o -= 0.2;
            /* only the lower deck gives way */ shrunk = true;
          } else break;
        }
        (side < 0 ? oL : oR).push(side * o);
      }
    }
    return { oL, oR, shrunk };
  }
  // ---- road surfaces (stage 1 job 4): at-grade junction outlines from the approach carriageway edges with curb returns
  // (roadgeo.js), approach stations (crosswalk, stop bar, lane-marking start) and curb ramps. One global record per graph node,
  // so every tile (the node's own and the neighbors holding its approach pieces) agrees on where each ribbon starts.
  const JOB4_OFF = typeof location !== 'undefined' && /[?&]job4=0/.test(location.search); // before/after switch (audit only)
  const JN = new Map(),
    CW_W = 3.0,
    CW_SET = 0.6,
    BAR_GAP = 1.2,
    BAR_D = 0.5,
    RAMP_RUN = 1.6,
    RAMP_FLARE = 0.75;
  const URBAN_Z = /downtown|business|commercial|nightlife|beach|residential|brickell|midtown/;
  // Keys / rural lane style (user's Key Largo street design): small paved lanes without curbs, sidewalks, crosswalks or lane lines,
  // a faded center line at most, sun-faded patched asphalt and sandy shoulders. Edge flag `style: 'lane'|'keys'` wins when the
  // road graph carries one; otherwise residential / tertiary streets in a Keys district and rural tertiary roads.
  const LANE_KIND = /residential|tertiary|unclassified|living|service/,
    KEYS_D = /Key Largo|Key West|Marathon|Florida Keys|Islamorada/;
  const laneCache = new Map();
  function laneEdge(e) {
    if (!e || JOB4_OFF) return false;
    const k = e.id ?? e;
    if (laneCache.has(k)) return laneCache.get(k);
    let v = false;
    if (e.style) v = /lane|keys|rural/.test(e.style);
    else if (LANE_KIND.test(e.kind || '') && e.pts && e.pts.length) {
      const m = e.pts[e.pts.length >> 1],
        d = String(ctx.districtAt ? ctx.districtAt(m[0], m[1]) || '' : ''),
        z = String(zoneAt(m[0], m[1]) || '');
      v =
        (KEYS_D.test(d) && !/primary|trunk/.test(e.kind)) ||
        (/rural|wilderness/.test(z) &&
          /tertiary|residential|unclassified/.test(e.kind) &&
          !(e.sidewalk > 0 && /residential/.test(z)));
    }
    laneCache.set(k, v);
    return v;
  }
  const LANE_TINT = new THREE.Color(1.16, 1.13, 1.08); // sun-faded lane asphalt
  const laneOfRoad = (r) => {
    const G = D && D.roadGraph;
    return laneEdge(G && G.edges ? G.edges[r.edgeId] : null);
  };
  // r2-roads (user, shot_12 follow-up): at a curb return the walk's BACK edge came from the sidewalk polygon, cut as one or two
  // straight chamfers, so the walk changed width round the bend and kinked against the round curb. Where the walk runs along the
  // curb on both legs and the block behind the corner is not paved, the slab inside the return's sector (from the arc center O to
  // the curb arc) is cut away and redrawn as a band of constant width, concentric with the curb (back edge radius = curb radius -
  // walk width, a vertex every <= 0.4 m), joints radiating from O; the lawn follows the same arc. A block paved right through
  // (slab at O) keeps its square corner plaza. `?seams=old` = the polygon's own corner.
  function slabAtWorld(x, z) {
    const T0 = provider.tileSize || 200,
      ht = provider.getTile ? provider.getTile(Math.floor(x / T0), Math.floor(z / T0)) : null;
    return !!(ht && !ht.then && ht.roads && slabAt(ht, x, z));
  }
  function roundWalkCorners(J) {
    if (SEAMS_OLD || JOB4_OFF) return;
    for (const c of J.corners) {
      if (c.kind !== 'fillet' || !c.O || c.arc.length < 3) continue;
      const a = J.legs[c.i],
        b = J.legs[c.j];
      if (!(a.sw > 0 && b.sw > 0) || a.lane || b.lane) continue;
      const O = c.O,
        Ta = c.arc[0],
        Tb = c.arc[c.arc.length - 1],
        m = c.arc[c.arc.length >> 1];
      const inw = (p, d) => {
        const dx = O[0] - p[0],
          dz = O[1] - p[1],
          L = Math.hypot(dx, dz) || 1;
        return [p[0] + (dx / L) * d, p[1] + (dz / L) * d];
      };
      if (
        !slabAtWorld(...inw(Ta, 0.5)) ||
        !slabAtWorld(...inw(Tb, 0.5)) ||
        !slabAtWorld(...inw(m, 0.5))
      )
        continue; // walk at the curb all round
      if (slabAtWorld(O[0], O[1])) continue; // paved through behind the corner: square plaza stays
      const ra = Math.hypot(Ta[0] - O[0], Ta[1] - O[1]),
        rb = Math.hypot(Tb[0] - O[0], Tb[1] - O[1]);
      const width = (p, r) => {
        let d = 0.5;
        while (d < Math.min(6, r - 0.4) && slabAtWorld(...inw(p, d + 0.25))) d += 0.25;
        return d + 0.12;
      };
      const wa = width(Ta, ra),
        wb = width(Tb, rb);
      if (ra - wa < 0.4 || rb - wb < 0.4) continue;
      let g0 = Math.atan2(Ta[1] - O[1], Ta[0] - O[0]),
        g1 = Math.atan2(Tb[1] - O[1], Tb[0] - O[0]),
        sw = g1 - g0;
      while (sw > Math.PI) sw -= Math.PI * 2;
      while (sw < -Math.PI) sw += Math.PI * 2;
      if (Math.abs(sw) > Math.PI * 0.95) continue;
      c.walk = { g0, sw, ra, rb, wa, wb };
      J.cuts.push(convexCCW([O, ...c.arc])); // the sector O-Ta-arc-Tb: the polygon's chamfered corner goes, the band below replaces it
    }
  }
  function drawWalkCorners(tgt, curbTgt, coll, J) {
    // the constant-width corner bands planned by roundWalkCorners
    const white = new THREE.Color(0xffffff),
      cc = new THREE.Color(0xd8d4cc),
      H = CURB;
    for (const c of J.corners) {
      const W = c.walk;
      if (!W) continue;
      const O = c.O;
      const len = Math.abs(W.sw) * Math.max(W.ra, W.rb),
        n = Math.max(6, Math.ceil(len / 0.4)),
        P = [];
      for (let k = 0; k <= n; k++) {
        const t = k / n,
          g = W.g0 + W.sw * t,
          ro = W.ra + (W.rb - W.ra) * t,
          ri = ro - (W.wa + (W.wb - W.wa) * t),
          cx = Math.cos(g),
          sz = Math.sin(g);
        P.push({
          o: [O[0] + cx * ro, O[1] + sz * ro],
          i: [O[0] + cx * ri, O[1] + sz * ri],
          u: (Math.abs(W.sw) * t * (ro + ri)) / 2 / 2.5,
          ro,
          ri,
          cx,
          sz,
        });
      }
      const tri = (bt, A, Bv, Cv) => {
        const ny = (Bv[2] - A[2]) * (Cv[0] - A[0]) - (Bv[0] - A[0]) * (Cv[2] - A[2]);
        for (const v of ny >= 0 ? [A, Bv, Cv] : [A, Cv, Bv])
          bt.vert(v[0], H, v[2], 0, 1, 0, v[3], v[4], white);
      };
      for (let k = 0; k < n; k++) {
        const p = P[k],
          q = P[k + 1]; // slab: u along the arc, v across the walk -> joints radiate from O
        const A = [p.o[0], H, p.o[1], p.u, 0],
          Bv = [q.o[0], H, q.o[1], q.u, 0],
          Cv = [q.i[0], H, q.i[1], q.u, (q.ro - q.ri) / 2.5],
          D = [p.i[0], H, p.i[1], p.u, (p.ro - p.ri) / 2.5];
        for (const bt of [tgt, coll])
          if (bt) {
            tri(bt, A, Bv, Cv);
            tri(bt, A, Cv, D);
          }
        // curb face along the curb arc (faces the road: away from O) and the back-edge chamfer down to the lawn (toward O)
        if (curbTgt && CURB3D) {
          curbLine(
            curbTgt,
            [p.o, q.o],
            [
              [p.cx, p.sz],
              [q.cx, q.sz],
            ],
            { h: H, y0: 0.0565, seed: k },
          ); // gutter 6.5 mm over the straight curbs' gutter where the two overlap at the tangent points
          const w = 0.35,
            a1 = [p.i[0], H, p.i[1]],
            b1 = [q.i[0], H, q.i[1]],
            c1 = [q.i[0] - q.cx * w, -0.03, q.i[1] - q.sz * w],
            d1 = [p.i[0] - p.cx * w, -0.03, p.i[1] - p.sz * w];
          quadUp(curbTgt, a1, b1, c1, d1, cc, 0.4);
        } else if (curbTgt) {
          const fx = (p.cx + q.cx) / 2,
            fz = (p.sz + q.sz) / 2,
            fl = Math.hypot(fx, fz) || 1,
            nx = fx / fl,
            nz = fz / fl,
            L = Math.hypot(q.o[0] - p.o[0], q.o[1] - p.o[1]);
          const f = [
            [p.o[0], 0, p.o[1]],
            [q.o[0], 0, q.o[1]],
            [q.o[0], H, q.o[1]],
            [p.o[0], H, p.o[1]],
          ];
          const out = (p.o[0] - O[0]) * (q.o[1] - p.o[1]) - (p.o[1] - O[1]) * (q.o[0] - p.o[0]) > 0; // winding so the face shows from the road side
          for (const ii of out ? [0, 2, 1, 0, 3, 2] : [0, 1, 2, 0, 2, 3])
            curbTgt.vert(
              f[ii][0],
              f[ii][1],
              f[ii][2],
              nx,
              0,
              nz,
              (ii === 1 || ii === 2 ? L : 0) * 0.4,
              f[ii][1] * 0.4,
              cc,
            );
          const w = 0.35,
            a1 = [p.i[0], H, p.i[1]],
            b1 = [q.i[0], H, q.i[1]],
            c1 = [q.i[0] - q.cx * w, 0, q.i[1] - q.sz * w],
            d1 = [p.i[0] - p.cx * w, 0, p.i[1] - p.sz * w],
            sl = Math.hypot(w, H);
          const ny2 = (b1[2] - a1[2]) * (c1[0] - a1[0]) - (b1[0] - a1[0]) * (c1[2] - a1[2]);
          for (const v2 of ny2 >= 0 ? [a1, b1, c1, a1, c1, d1] : [a1, c1, b1, a1, d1, c1])
            curbTgt.vert(
              v2[0],
              v2[1],
              v2[2],
              (-nx * H) / sl,
              w / sl,
              (-nz * H) / sl,
              v2[0] * 0.4,
              v2[2] * 0.4,
              cc,
            );
        }
      }
    }
  }
  function junctionOf(id) {
    // graph node id -> junction record | null (decks, ramps, blocked crossings keep the old disc)
    if (JN.has(id)) return JN.get(id);
    const G = D && D.roadGraph,
      n = G && G.nodes ? G.nodes[id] : null;
    let J = null;
    if (n && !JOB4_OFF && (n.edges || []).length >= 3 && !(n.y > 0.3 && !n.terrain)) {
      J = safeCall(
        () => buildJunction(G, n, { swOf: (e) => (laneEdge(e) ? 0 : e.sidewalk || 0) }),
        null,
      );
      if (J && elevated && safeCall(() => elevated.isGroundJunctionBlocked(id), false)) J = null;
      if (J && J.poly.length < 3) J = null;
    }
    if (J) {
      // approach stations per leg (arc length from the node)
      const zn = String(zoneAt(n.x, n.z) || ''),
        hwyNode = J.legs.some((l) => /motorway|trunk/.test(l.kind)),
        urban = URBAN_Z.test(zn);
      for (const L of J.legs) {
        const e = L.edge,
          ctrl = n.signal ? 'signal' : (L.atA ? e.controlA : e.controlB) || null;
        L.ctrl = ctrl;
        const walk =
          L.sw > 0 &&
          urban &&
          !hwyNode &&
          !/service|track|footway|path/.test(L.kind) &&
          e.surface !== 'dirt';
        L.cw = walk ? [L.D + CW_SET, L.D + CW_SET + CW_W] : null;
        const stop = ctrl === 'signal' || ctrl === 'stop';
        L.lane = laneEdge(e);
        L.bar =
          stop && !L.lane && !/service|track/.test(L.kind)
            ? L.cw
              ? [L.cw[1] + BAR_GAP, L.cw[1] + BAR_GAP + BAR_D]
              : [L.D + 1.0, L.D + 1.0 + BAR_D]
            : null;
        L.mk = L.bar ? L.bar[1] + 0.3 : L.cw ? L.cw[1] + 0.6 : L.D + 1.0; // lane / center lines start here
        L.ramps = [];
        if (L.cw)
          for (const side of [-1, 1]) {
            // curb ramp where the crosswalk lands on a sidewalk
            const sm = sampleFrame(L.fr, (L.cw[0] + L.cw[1]) / 2),
              ox = sm.nx * side,
              oz = sm.nz * side,
              x = sm.x + ox * (L.hw + 1.1),
              z = sm.z + oz * (L.hw + 1.1);
            const T0 = provider.tileSize || 200,
              ht = provider.getTile
                ? provider.getTile(Math.floor(x / T0), Math.floor(z / T0))
                : null;
            if (
              !okFoot(x, z) ||
              (isWater && isWater(x, z)) ||
              (ht && !ht.then && ht.roads && !slabAt(ht, x, z))
            )
              continue; // only where a slab is really drawn
            const at = (s, o) => {
              const q = sampleFrame(L.fr, s);
              return [q.x + q.nx * side * o, q.z + q.nz * side * o];
            };
            const c0 = L.cw[0] - 0.1,
              c1 = L.cw[1] + 0.1,
              o0 = L.hw - 0.05,
              o1 = L.hw + RAMP_RUN;
            L.ramps.push({
              side,
              fl: at(c0 - RAMP_FLARE, L.hw),
              f0: at(c0, L.hw),
              f1: at(c1, L.hw),
              fr: at(c1 + RAMP_FLARE, L.hw),
              b0: at(c0, o1),
              b1: at(c1, o1),
              w0: at(c0, L.hw + 0.6),
              w1: at(c1, L.hw + 0.6),
              cut: convexCCW([
                at(c0 - RAMP_FLARE, o0),
                at(c1 + RAMP_FLARE, o0),
                at(c1, o1),
                at(c0, o1),
              ]),
            });
          }
      }
      J.zone = zn;
      J.hwy = hwyNode;
      J.urban = urban;
      // sidewalk cut shapes: curb-return spandrels (fan from the sharp curb corner), the node core and the curb ramps
      J.cuts = [];
      for (const c of J.corners)
        if (c.kind === 'fillet') for (const t of spandrelFan(c)) J.cuts.push(t);
      for (const L of J.legs) for (const rp of L.ramps) J.cuts.push(rp.cut);
      roundWalkCorners(J);
      J.cutBB = J.cuts.map(bboxOf);
    }
    if (J) {
      const bb = bboxOf(J.poly);
      for (let gx = Math.floor(bb[0] / 32); gx <= Math.floor(bb[2] / 32); gx++)
        for (let gz = Math.floor(bb[1] / 32); gz <= Math.floor(bb[3] / 32); gz++) {
          const k = gx * 100003 + gz;
          let c = JGRID.get(k);
          if (!c) JGRID.set(k, (c = []));
          c.push(J);
        }
    }
    JN.set(id, J);
    return J;
  }
  const JGRID = new Map();
  function inJunction(x, z) {
    // inside an already built junction outline (lawn / ground-cover tests: no grass on the curb returns)
    const c = JGRID.get(Math.floor(x / 32) * 100003 + Math.floor(z / 32));
    if (!c) return false;
    for (const J of c) {
      const P = J.poly;
      let ins = false;
      for (let a = 0, b = P.length - 1; a < P.length; b = a++) {
        const xa = P[a][0],
          za = P[a][1],
          xb = P[b][0],
          zb = P[b][1];
        if (za > z !== zb > z && x < ((xb - xa) * (z - za)) / (zb - za) + xa) ins = !ins;
      }
      if (ins) return true;
    }
    return false;
  }
  // a road piece's position on its graph edge: { s0 (edge arc length at the piece start), LE (edge length), A / B (junction leg at
  // the edge's start / end node, or null) }. Stations along the piece: node A station s -> s - s0; node B station s -> LE - s - s0.
  const pieceCache = new WeakMap();
  function pieceEnds(r) {
    if (pieceCache.has(r)) return pieceCache.get(r);
    let out = null;
    const G = D && D.roadGraph,
      e = G && G.edges ? G.edges[r.edgeId] : null;
    if (e && e.cum && !JOB4_OFF) {
      let i = e.pts.indexOf(r.pts[0]);
      if (i < 0)
        for (let k = 0; k < e.pts.length; k++)
          if (
            Math.abs(e.pts[k][0] - r.pts[0][0]) < 0.01 &&
            Math.abs(e.pts[k][1] - r.pts[0][1]) < 0.01
          ) {
            i = k;
            break;
          }
      if (i >= 0) {
        const Ja = junctionOf(e.a),
          Jb = junctionOf(e.b);
        const disc = (id, J) => {
          if (J) return 0;
          const n = G.nodes[id];
          if (!n || (n.edges || []).length < 3) return 0;
          let w = 0;
          for (const k of n.edges) w = Math.max(w, G.edges[k]?.width || 0);
          return w / 2 + 2.5;
        };
        out = {
          discA: disc(e.a, Ja),
          discB: disc(e.b, Jb),
          s0: e.cum[i],
          LE: e.length,
          e,
          A: Ja ? Ja.legs.find((l) => l.edgeId === r.edgeId && l.atA) || null : null,
          B: Jb ? Jb.legs.find((l) => l.edgeId === r.edgeId && !l.atA) || null : null,
          Ja,
          Jb,
        };
      }
    }
    pieceCache.set(r, out);
    return out;
  }
  // ---- job 4: scanned road surfaces with strip uvs (paint from Road 1's RoadLines scan, shoulders from Road 11's dusty road edge) ----
  // up-facing quad with explicit uvs: q = [[x, y, z, u, v] x4]
  function quadUV(batch, q, col) {
    const ny =
        (q[1][2] - q[0][2]) * (q[2][0] - q[0][0]) - (q[1][0] - q[0][0]) * (q[2][2] - q[0][2]),
      o = ny >= 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2];
    for (const i of o) batch.vert(q[i][0], q[i][1], q[i][2], 0, 1, 0, q[i][3], q[i][4], col);
  }
  // atlas columns of lines_col.jpg: white line, yellow line, second white line, plain asphalt (sealed patches); v repeats every 9 m
  const LINE_U = { w: [0.02, 0.23], y: [0.27, 0.48], w2: [0.52, 0.73], a: [0.78, 0.97] },
    LINE_V = 9,
    _mc = new THREE.Color(),
    _mv = new THREE.Color();
  let skipClip = false,
    NGRID = null,
    paintEdge = null;
  const CLIP_PAINT = !(typeof location !== 'undefined' && /[?&]paintclip=0/.test(location.search)); // before/after switch (audit only)
  function paintBlocked(x, z, noDisc = false) {
    // inside a junction outline (0.15 m in) or an old deck / ramp disc
    if (!NGRID) {
      NGRID = new Map();
      const G = D && D.roadGraph;
      for (const n of (G && G.nodes) || []) {
        if ((n.edges || []).length < 3) continue;
        const k = Math.floor(n.x / 64) * 100003 + Math.floor(n.z / 64);
        let c = NGRID.get(k);
        if (!c) NGRID.set(k, (c = []));
        c.push(n);
      }
    }
    const gx = Math.floor(x / 64),
      gz = Math.floor(z / 64);
    for (let i = -1; i <= 1; i++)
      for (let j = -1; j <= 1; j++) {
        const c = NGRID.get((gx + i) * 100003 + gz + j);
        if (!c) continue;
        for (const n of c) {
          const dn = Math.hypot(n.x - x, n.z - z);
          if (dn > 70) continue;
          const J = junctionOf(n.id);
          if (paintEdge !== null && dn < 60 && !noDisc)
            for (const k of n.edges) {
              if (k === paintEdge) continue; // inside another road's carriageway near a junction (overlapping legs, close node clusters)
              const e2 = D.roadGraph.edges[k];
              if (!e2 || e2.elevated) continue;
              const P2 = e2.a === n.id ? e2.pts : e2.pts.slice().reverse(),
                hw2 = e2.width / 2 - 0.2;
              let acc = 0;
              for (let i = 0; i < P2.length - 1 && acc < 60; i++) {
                const ax = P2[i][0],
                  az = P2[i][1],
                  dx = P2[i + 1][0] - ax,
                  dz = P2[i + 1][1] - az,
                  L2 = dx * dx + dz * dz || 1;
                acc += Math.sqrt(L2);
                let t = ((x - ax) * dx + (z - az) * dz) / L2;
                if (t < 0 || t > 1) continue;
                if (Math.hypot(ax + dx * t - x, az + dz * t - z) < hw2) return true;
              }
            }
          if (!J) {
            if (noDisc || (n.y > 0.3 && !n.terrain)) continue;
            let w = 0;
            for (const k of n.edges) {
              const e = D.roadGraph.edges[k];
              if (e && e.width > w) w = e.width;
            }
            if (dn < w / 2 + JUNC_PAD) return true;
            continue;
          }
          const P = J.poly;
          let ins = false,
            bd = 1e9;
          for (let a = 0, b = P.length - 1; a < P.length; b = a++) {
            const xa = P[a][0],
              za = P[a][1],
              xb = P[b][0],
              zb = P[b][1];
            if (za > z !== zb > z && x < ((xb - xa) * (z - za)) / (zb - za) + xa) ins = !ins;
          }
          if (!ins) continue;
          for (let a = 0, b = P.length - 1; a < P.length; b = a++) {
            const xa = P[a][0],
              za = P[a][1],
              dx = P[b][0] - xa,
              dz = P[b][1] - za,
              L2 = dx * dx + dz * dz || 1;
            let t = ((x - xa) * dx + (z - za) * dz) / L2;
            t = t < 0 ? 0 : t > 1 ? 1 : t;
            bd = Math.min(bd, Math.hypot(xa + dx * t - x, za + dz * t - z));
          }
          if (bd > 0.15) return true;
        }
      }
    return false;
  }
  // same signature as ribbon(); paint color picks the atlas column (yellow / white / asphalt patch) and dims it (faded paint)
  function markRibbon(B, fr, ys, o0, o1, yOff, color, _uv, sA = 0, sB = Infinity) {
    if (!(M.lines && B.lines)) return ribbon(B.marks, fr, ys, o0, o1, yOff, color, 1, sA, sB);
    _mc.set(color);
    const lum = (_mc.r + _mc.g + _mc.b) / 3,
      yel = _mc.r > _mc.b * 2.5,
      dark = !yel && lum < 0.2;
    const cu = yel
        ? LINE_U.y
        : dark
          ? LINE_U.a
          : Math.floor(Math.abs(o0) * 3) & 1
            ? LINE_U.w2
            : LINE_U.w,
      k = dark
        ? Math.min(2.3, Math.max(1.5, (2.1 * lum) / 0.12))
        : Math.min(yel ? 1 : 1.12, lum / (yel ? 0.49 : 0.78)); // patches: the scan's asphalt is darker than the street, lift it to a fresh-seal shade
    _mv.setRGB(k, k, k);
    const yAt = (i) => (typeof ys === 'number' ? ys : ys ? ys[i] : 0) + yOff;
    if (!ys && !skipClip && CLIP_PAINT) {
      // nothing painted inside a junction outline: split the run where its center line enters one (any junction,
      // incl. close node pairs and old discs), so lines can never run into / across a junction whatever the edge's stations say
      const Lf = fr[fr.length - 1].s,
        a0 = Math.max(0, sA),
        b0 = Math.min(Lf, sB),
        om = (o0 + o1) / 2;
      let run = null;
      for (let s = a0; ; s += 0.5) {
        const sc = Math.min(s, b0),
          q = sampleAt(fr, sc),
          inJ = paintBlocked(q.x + q.nx * om, q.z + q.nz * om);
        if (!inJ && run === null) run = sc;
        if ((inJ || sc >= b0) && run !== null) {
          const e = inJ ? Math.max(run, sc - 0.25) : sc;
          if (e > run + 0.05) {
            skipClip = true;
            markRibbon(B, fr, ys, o0, o1, yOff, color, _uv, run, e);
            skipClip = false;
          }
          run = null;
        }
        if (sc >= b0) break;
      }
      return;
    }
    for (let i = 0; i < fr.length - 1; i++) {
      const A = fr[i],
        Bf = fr[i + 1],
        L = Bf.s - A.s;
      if (L <= 1e-6 || Bf.s <= sA || A.s >= sB) continue;
      const t0 = A.s < sA ? (sA - A.s) / L : 0,
        t1 = Bf.s > sB ? (sB - A.s) / L : 1;
      const P = (t, o, u) => {
        const x = A.x + (Bf.x - A.x) * t,
          z = A.z + (Bf.z - A.z) * t,
          nx = A.nx + (Bf.nx - A.nx) * t,
          nz = A.nz + (Bf.nz - A.nz) * t,
          y = yAt(i) + (yAt(i + 1) - yAt(i)) * t;
        return [x + nx * o, y, z + nz * o, u, (A.s + L * t) / LINE_V];
      };
      quadUV(
        B.lines,
        [P(t0, o0, cu[0]), P(t0, o1, cu[1]), P(t1, o1, cu[1]), P(t1, o0, cu[0])],
        _mv,
      );
    }
  }
  // shoulder: the scan's crumbling edge, 0.3 m over the asphalt edge (v = 0, crumbs show the road through) out to an irregular
  // 1.0-1.7 m (v = 0.452, jagged cut into the verge). Keys lanes: warmer, sandier tint and wider.
  const EDGE_U = 5.9,
    _sc = new THREE.Color();
  function shoulderRibbon(B, fr, hw, sA, sB, side, eid, sandy) {
    const Lf = fr[fr.length - 1].s,
      a = Math.max(0, sA),
      b = Math.min(Lf, sB);
    if (b - a < 0.5) return;
    if (sandy) _sc.setRGB(1.22, 1.04, 0.78);
    else _sc.setRGB(0.98, 0.96, 0.93);
    let prev = null;
    for (let s = a; ; s = Math.min(b, s + 2)) {
      const q = sampleAt(fr, s),
        w =
          (sandy ? 1.3 : 0.95) +
          hash(Math.floor(s / 2) * 7 + eid * 13 + (side > 0 ? 5 : 0)) * (sandy ? 0.7 : 0.5) +
          0.2 * Math.sin(s * 0.37 + eid);
      const inn = [
          q.x + q.nx * side * (hw - 0.3),
          SH_Y,
          q.z + q.nz * side * (hw - 0.3),
          s / EDGE_U,
          0,
        ],
        out = [q.x + q.nx * side * (hw + w), SH_Y, q.z + q.nz * side * (hw + w), s / EDGE_U, 0.452];
      if (prev) quadUV(B.shoulder, [prev[0], prev[1], out, inn], _sc);
      prev = [inn, out];
      if (s >= b) break;
    }
  }
  function shoulderArc(B, c, sandy) {
    // along a curb return (open corner): inner edge over the asphalt, outer edge toward the arc center
    if (sandy) _sc.setRGB(1.22, 1.04, 0.78);
    else _sc.setRGB(0.98, 0.96, 0.93);
    let acc = 0,
      prev = null;
    for (let k = 0; k < c.arc.length; k++) {
      const p = c.arc[k],
        dx = c.O[0] - p[0],
        dz = c.O[1] - p[1],
        d = Math.hypot(dx, dz) || 1,
        w = Math.min(
          d * 0.8,
          (sandy ? 1.5 : 1.1) + hash(Math.floor(p[0] * 3) * 31 + Math.floor(p[1] * 3)) * 0.4,
        );
      if (k) acc += Math.hypot(p[0] - c.arc[k - 1][0], p[1] - c.arc[k - 1][1]);
      const inn = [p[0] - (dx / d) * 0.3, SH_Y, p[1] - (dz / d) * 0.3, acc / EDGE_U, 0],
        out = [p[0] + (dx / d) * w, SH_Y, p[1] + (dz / d) * w, acc / EDGE_U, 0.452];
      if (prev) quadUV(B.shoulder, [prev[0], prev[1], out, inn], _sc);
      prev = [inn, out];
    }
  }
  // ---- job 4: road decals (atlas from the user's road-detail scans, tools/v2/roads): cracks, tar-sealed cracks, potholes, patches,
  // manhole covers, storm-drain grates, oil stains, turn arrows. Alpha-blended quads in one merged mesh per tile (B.decals). ----
  const DEC = {
    crack: 0,
    crackNet: 1,
    pothole: 2,
    potholePatched: 3,
    manhole: 4,
    meterCover: 5,
    grate: 6,
    oilA: 7,
    oilB: 8,
    arS: 9,
    arL: 10,
    arR: 11,
    arSL: 12,
    arSR: 13,
    patch: 14,
    tarCrack: 15,
  };
  const _dc = new THREE.Color(1, 1, 1),
    DEC_Y = 0.062,
    WHITE_T = new THREE.Color(1, 1, 1);
  let decTint = WHITE_T;
  // (x, z) center; (ax, az) unit direction the image's top points to; len along it, wid across; cell index
  function decal(B, x, z, ax, az, len, wid, cell, k = 1) {
    if (!B.decals || !M.roadDecals) return;
    const u0 = (cell % 4) * 0.25 + 0.002,
      v0 = Math.floor(cell / 4) * 0.25 + 0.002,
      u1 = u0 + 0.246,
      v1 = v0 + 0.246;
    const bx = -az,
      bz = ax,
      hl = len / 2,
      hw2 = wid / 2;
    _dc.setRGB(k, k, k);
    if (
      (cell !== DEC.manhole && cell !== DEC.meterCover && cell !== DEC.grate && cell < DEC.arS) ||
      cell >= DEC.patch
    )
      _dc.multiply(decTint); // ground pass: asphalt-based decals carry the road's own tint (lanes: sun-faded)
    if (cell >= DEC.pothole && cell <= DEC.meterCover) {
      if (globalThis.__r2Relief) globalThis.__r2Relief.add(cell, x, z, ax, az, len, wid);
      else {
        const Q = (globalThis.__r2ReliefQ ||= []);
        if (Q.length < 20000) Q.push([cell, x, z, ax, az, len, wid]);
      }
    } // r2-physics: tires feel the pothole bowl / patch / cover seat drawn here (src/vehicles/physics/relief.js)
    if (cell === DEC.pothole || cell === DEC.patch || cell === DEC.potholePatched) {
      const L0 = (globalThis.__gpDecals ||= []);
      if (L0.length < 600)
        L0.push([cell, +x.toFixed(1), +z.toFixed(1), +ax.toFixed(3), +az.toFixed(3), len]);
    } // ground pass: audit list (review shots)
    quadUV(
      B.decals,
      [
        [x + ax * hl - bx * hw2, DEC_Y, z + az * hl - bz * hw2, u0, v0],
        [x + ax * hl + bx * hw2, DEC_Y, z + az * hl + bz * hw2, u1, v0],
        [x - ax * hl + bx * hw2, DEC_Y, z - az * hl + bz * hw2, u1, v1],
        [x - ax * hl - bx * hw2, DEC_Y, z - az * hl - bz * hw2, u0, v1],
      ],
      _dc,
    );
  }
  // wear by road class: main roads are kept up (few cracks, tar-sealed joints), residential streets more, Keys / rural lanes most
  function roadDecals(B, fr, ys, r, hw, pe, lane, s0, s1) {
    if (ys || !B.decals || !M.roadDecals || s1 - s0 < 4) return;
    decTint = lane ? LANE_TINT : WHITE_T;
    const kind = r.kind || '',
      main = /motorway|trunk|primary/.test(kind),
      sec = /secondary/.test(kind),
      eid = (r.edgeId ?? 0) + 1,
      base = pe ? pe.s0 : 0;
    const H = (s, salt) => hash(Math.floor((s + base) * 3.7) * 92821 + eid * 7919 + salt);
    const total = r.lanesFwd + r.lanesBack,
      lw = r.width / Math.max(1, total);
    const put = (s, o, cell, len, wid, rot = 0, k = 1) => {
      if (s < s0 || s > s1) return;
      const q = sampleAt(fr, s),
        nl = Math.hypot(q.nx, q.nz) || 1,
        x = q.x + q.nx * o,
        z = q.z + q.nz * o;
      if (paintBlocked(x, z)) return;
      const ca = Math.cos(rot),
        sa = Math.sin(rot),
        ax = q.dx * ca - (q.nx / nl) * sa,
        az = q.dz * ca - (q.nz / nl) * sa;
      decal(B, x, z, ax, az, len, wid, cell, k);
    };
    const step = (gap, fn) => {
      for (let s = Math.ceil((s0 + base) / gap) * gap - base; s < s1; s += gap) fn(s);
    }; // stations fixed to the edge: same decals whatever the tile split
    // cracks / crack networks / tar snakes
    step(lane ? 9 : main ? 34 : sec ? 22 : 14, (s) => {
      const h = H(s, 1);
      if (h > (lane ? 0.85 : 0.7)) return;
      const o = (H(s, 2) - 0.5) * (2 * hw - 1.6),
        rot = H(s, 3) * 6.28,
        sz = 1.6 + H(s, 4) * 2.2;
      put(
        s + H(s, 5) * 6,
        o,
        main && h < 0.45 ? DEC.tarCrack : h < 0.3 ? DEC.crackNet : DEC.crack,
        sz,
        sz,
        rot,
        0.9 + H(s, 6) * 0.2,
      );
    });
    // sealed patches (residential / lanes), potholes (lanes, some residential), none on main roads
    if (!main)
      step(lane ? 26 : 70, (s) => {
        const h = H(s, 7);
        if (h > 0.6) return;
        const o = (H(s, 8) - 0.5) * (2 * hw - 2.5),
          L2 = 1.4 + H(s, 9) * 2.4,
          W2 = 1.0 + H(s, 10) * 1.4;
        put(s + 3, o, DEC.patch, L2, W2, (H(s, 11) - 0.5) * 0.2, 0.95 + h * 0.15);
      });
    if (!main && !sec)
      step(lane ? 45 : 140, (s) => {
        const h = H(s, 12);
        if (h > (lane ? 0.65 : 0.35)) return;
        const o = (H(s, 13) - 0.5) * (2 * hw - 2.2),
          big = h < 0.25,
          sz = big ? 2.0 + H(s, 14) * 0.8 : 1.2 + H(s, 14) * 0.6;
        put(s + 5, o, big ? DEC.potholePatched : DEC.pothole, sz, sz, H(s, 15) * 6.28);
      });
    // manhole covers in the lanes (~1 per 60-90 m on city streets), water-meter covers near the curb
    // (r2-roads: replaced by the library cover models of surfaces/covers.js once they are loaded; `?covers=0` keeps these decals)
    const libCovers = !!COVERS.parts;
    if (!lane && !libCovers)
      step(main ? 90 : 65, (s) => {
        const h = H(s, 16);
        const k = Math.floor(H(s, 17) * Math.max(1, total)),
          o = -hw + lw * (k + 0.5) + (H(s, 18) - 0.5) * 0.8;
        put(s + h * 20, o, DEC.manhole, 0.78, 0.78, H(s, 19) * 6.28);
      });
    if (!lane && !libCovers && (pe ? (pe.e.sidewalk || 0) > 0 : r.sidewalks))
      step(55, (s) => {
        const h = H(s, 20);
        if (h > 0.4) return;
        const side = h < 0.2 ? 1 : -1;
        put(s + 9, side * (hw - 0.6), DEC.meterCover, 0.52, 0.52, H(s, 21) * 6.28);
      });
    // storm-drain grates at curbed edges: one every ~45 m per side and one just upstream of each junction mouth
    if (!lane && !libCovers && (pe ? (pe.e.sidewalk || 0) > 0 : r.sidewalks))
      for (const side of [-1, 1]) {
        step(45, (s) => put(s + 20 + H(s, 22 + side) * 8, side * (hw - 0.3), DEC.grate, 0.95, 0.5));
        if (pe && pe.A && pe.A.D) put(pe.A.mk + 3 - pe.s0, side * (hw - 0.3), DEC.grate, 0.95, 0.5);
        if (pe && pe.B && pe.B.D)
          put(pe.LE - pe.B.mk - 3 - pe.s0, side * (hw - 0.3), DEC.grate, 0.95, 0.5);
      }
    // oil: drips down the lane centers, puddles where cars wait at stop bars
    if (!lane)
      step(main ? 30 : 40, (s) => {
        const h = H(s, 25);
        if (h > 0.3) return;
        /* ground pass: fewer drips */ const k = Math.floor(H(s, 26) * Math.max(1, total)),
          o = -hw + lw * (k + 0.5);
        put(
          s + h * 10,
          o,
          h < 0.27 ? DEC.oilA : DEC.oilB,
          1.4 + H(s, 27),
          0.9 + H(s, 28) * 0.6,
          H(s, 29) * 6.28,
          0.7 + h,
        );
      });
    if (pe)
      for (const [L, atB] of [
        [pe.A, false],
        [pe.B, true],
      ]) {
        if (!L || !L.bar) continue;
        const n = atB ? r.lanesFwd : r.lanesBack,
          c = -hw + r.lanesBack * lw;
        for (let k = 0; k < n; k++) {
          const o = atB
              ? (r.oneway ? -hw : c) + lw * (k + 0.5)
              : (r.oneway ? hw : c) - lw * (k + 0.5),
            st = L.bar[1] + 2.5 + H(k * 13, 30) * 3,
            sl = atB ? pe.LE - st - pe.s0 : st - pe.s0;
          put(sl, o, k & 1 ? DEC.oilA : DEC.oilB, 2.2, 1.3, 0, 0.9);
        }
      }
  }
  // lane-use arrows (r2-roads, MUTCD 3B.20): only in TURN lanes approaching a junction, never on through / shared lanes and never
  // mid-block. Movements come from the junction's legs (through within ~43 deg, left / right beyond; a one-way leg that only flows
  // into the node is no exit). Turn lanes: the leftmost lane of a 3+ lane signalized approach that can turn left (exclusive left-turn
  // lane), or every lane of a 2+ lane approach with no through movement (T stem: left half left, right half right). The first arrow
  // sits ~6 m behind the stop bar; a second one ~36 m back only where the approach is long enough to be clear of the junction behind.
  // `?arrows=old` restores the previous rule (arrows in every lane of every multi-lane approach) for A/B.
  const ARROWS_OLD = typeof location !== 'undefined' && /[?&]arrows=old/.test(location.search);
  function arrowCells(r, L, J, n) {
    // per lane (k = 0: leftmost, next to the center line): decal cell or -1 (no arrow)
    const cells = new Array(n).fill(-1);
    if (L.lane) return cells;
    const tx = -L.dx,
      tz = -L.dz;
    let hasL = false,
      hasS = false,
      hasR = false,
      sharpTurns = true;
    for (const Mg of J.legs) {
      if (Mg === L) continue;
      const e = Mg.edge;
      if (e && e.oneway && !Mg.atA) continue;
      const ang = Math.atan2(tx * Mg.dz - tz * Mg.dx, tx * Mg.dx + tz * Mg.dz); // + = right turn (x east, z south)
      const cont =
        Math.abs(ang) < 1.25 &&
        L.edge &&
        ((L.edge.name && e.name === L.edge.name) ||
          (e.kind === L.edge.kind && Math.abs((e.width || 0) - (L.edge.width || 0)) < 1)); // the same road bending on through the node
      if (Math.abs(ang) < 0.75 || cont) hasS = true;
      else if (Math.abs(ang) < 2.6) {
        if (ang > 0) hasR = true;
        else hasL = true;
        if (Math.abs(ang) < 1.05) sharpTurns = false;
      }
    }
    if (!hasS) {
      if (!sharpTurns) return cells;
      if (hasL && hasR) for (let k = 0; k < n; k++) cells[k] = k < n / 2 ? DEC.arL : DEC.arR;
      else if (hasL) cells.fill(DEC.arL);
      else if (hasR) cells.fill(DEC.arR);
    } else if (hasL && n >= 3 && L.ctrl === 'signal') cells[0] = DEC.arL;
    return cells;
  }
  function turnArrows(B, fr, r, hw, pe) {
    if (!pe || !B.decals || !M.roadDecals) return;
    const total = r.lanesFwd + r.lanesBack,
      lw = r.width / Math.max(1, total),
      c = -hw + r.lanesBack * lw;
    for (const [L, atB, J] of [
      [pe.A, false, pe.Ja],
      [pe.B, true, pe.Jb],
    ]) {
      if (!L || !J || J.legs.length < 3) continue;
      const n = atB ? r.lanesFwd : r.lanesBack;
      if (n < 2 || !/motorway|trunk|primary|secondary|tertiary/.test(r.kind || '')) continue;
      const cells = ARROWS_OLD ? null : arrowCells(r, L, J, n);
      if (cells && cells.every((v) => v < 0)) continue;
      const far = atB ? pe.A : pe.B,
        farMk = far ? far.mk : 0; // the junction behind this approach (its marks end here)
      for (const d of ARROWS_OLD ? [6, 32] : [6, 36]) {
        const st = (L.bar ? L.bar[1] : L.mk) + d + 2.75;
        if (!ARROWS_OLD && (pe.LE < 40 || st + 2.75 > pe.LE - farMk - (d > 6 ? 25 : 8))) continue; // approach too short: no arrow in the next block's departure
        const sl = atB ? pe.LE - st - pe.s0 : st - pe.s0;
        if (sl < 0 || sl > fr[fr.length - 1].s) continue;
        const q = sampleAt(fr, sl),
          dir = atB ? 1 : -1;
        for (let k = 0; k < n; k++) {
          const o = atB
            ? (r.oneway ? -hw : c) + lw * (n - 1 - k + 0.5)
            : (r.oneway ? hw : c) - lw * (n - 1 - k + 0.5); // k = 0: leftmost lane (next to the center line)
          const cell = cells
            ? cells[k]
            : k === 0
              ? n >= 3
                ? DEC.arL
                : DEC.arSL
              : k === n - 1
                ? DEC.arSR
                : DEC.arS;
          if (cell < 0) continue;
          const x = q.x + q.nx * o,
            z = q.z + q.nz * o;
          if (!paintBlocked(x, z))
            decal(B, x, z, q.dx * dir, q.dz * dir, 5.5, Math.min(1.8, lw * 0.6), cell);
        }
      }
    }
  }
  // r2-roads (item 11): the concrete gutter pan of curbed streets runs on around every curb return. The pan is drawn by the asphalt
  // shader from the road frame, so it stopped square at each junction mouth and left a dark asphalt wedge between its end and the
  // curb return (the user's shot_12 "sharp triangle"). Each curbed side of a junction now gets a 0.5 m strip from the previous
  // leg's mouth, along its curb line to the return tangent, around the return and out to the next leg's mouth, written with a
  // road frame of its own (the strip's centerline, curbed class) so the same shader paints the same pan, joints and grime.
  const SEAMS_OLD = typeof location !== 'undefined' && /[?&]seams=old/.test(location.search); // A/B: the old junction seams
  // roads pass: a poured curb along a road edge (frame offset side * hw, profile facing the road) and the soil berm behind a free-standing
  // curb strip (a 0.4 m slope from its back edge down into the ground instead of a vertical face on the lawn)
  function curbAlong(batch, fr, side, hw, a, b, h, seed) {
    const P = [],
      N = [],
      L = fr[fr.length - 1].s,
      s0 = Math.max(0, a),
      s1 = Math.min(L, b);
    if (s1 - s0 < 0.2) return;
    const st = Math.max(2, Math.ceil((s1 - s0) / 1.0));
    for (let k = 0; k <= st; k++) {
      const q = sampleAt(fr, s0 + ((s1 - s0) * k) / st),
        nl = Math.hypot(q.nx, q.nz) || 1;
      P.push([q.x + q.nx * side * hw, q.z + q.nz * side * hw]);
      N.push([(-q.nx * side) / nl, (-q.nz * side) / nl]);
    }
    curbLine(batch, P, N, { h, y0: 0.05, seed: seed || 0 });
  }
  const _bermC = new THREE.Color(0x9c968a);
  function backBerm(batch, fr, side, o, a, b, h) {
    const L = fr[fr.length - 1].s,
      s0 = Math.max(0, a),
      s1 = Math.min(L, b);
    if (s1 - s0 < 0.2) return;
    const st = Math.max(2, Math.ceil((s1 - s0) / 1.0));
    let prev = null;
    for (let k = 0; k <= st; k++) {
      const q = sampleAt(fr, s0 + ((s1 - s0) * k) / st),
        nl = Math.hypot(q.nx, q.nz) || 1,
        ux = (q.nx * side) / nl,
        uz = (q.nz * side) / nl,
        x = q.x + q.nx * side * o,
        z = q.z + q.nz * side * o;
      const cur = [
        [x, h, z],
        [x + ux * 0.4, -0.03, z + uz * 0.4],
      ];
      if (prev) quadUp(batch, prev[0], cur[0], cur[1], prev[1], _bermC, 1 / 2.5);
      prev = cur;
    }
  }
  function curbGutters(B, J) {
    if (SURF_OFF || !B.asphalt || !B.asphalt._srf || SEAMS_OLD || CURB3D) return; // roads pass: the poured curb (curbs.js) has its own concrete gutter pan
    const at = (L, s, side, o) => {
      const q = sampleFrame(L.fr, s);
      return [q.x + q.nx * side * o, q.z + q.nz * side * o];
    };
    const pip = (x, z) => {
      const P = J.poly;
      let ins = false;
      for (let a = 0, b = P.length - 1; a < P.length; b = a++) {
        const xa = P[a][0],
          za = P[a][1],
          xb = P[b][0],
          zb = P[b][1];
        if (za > z !== zb > z && x < ((xb - xa) * (z - za)) / (zb - za) + xa) ins = !ins;
      }
      return ins;
    };
    for (const c of J.corners) {
      const a = J.legs[c.i],
        b = J.legs[c.j];
      if (!(a.sw > 0 && b.sw > 0) || a.lane || b.lane || /service|track/.test(a.kind + b.kind))
        continue;
      if (c.kind !== 'fillet' && c.kind !== 'line') continue;
      const P = [];
      for (let s = a.D + 0.03; s > (c.kind === 'line' ? 0 : c.sa) + 0.4; s -= 1.0)
        P.push(at(a, s, 1, a.hw)); // mouth -> tangent along leg a's curb line
      if (c.kind === 'fillet') for (const p of c.arc) P.push(p);
      else P.push(at(a, 0, 1, a.hw), at(b, 0, -1, b.hw));
      for (let s = (c.kind === 'line' ? 0 : c.sb) + 0.4; s < b.D + 0.03; s += 1.0)
        P.push(at(b, s, -1, b.hw));
      P.push(at(b, b.D + 0.03, -1, b.hw));
      const Q = [];
      for (const p of P) {
        const l = Q[Q.length - 1];
        if (!l || Math.hypot(p[0] - l[0], p[1] - l[1]) > 0.05) Q.push(p);
      }
      if (Q.length < 2) continue;
      // centerline 0.25 m inside the curb line (toward the carriageway)
      const fr0 = polyFrame(Q),
        C0 = [];
      for (const f of fr0) {
        const nl = Math.hypot(f.nx, f.nz) || 1;
        let sg = 1;
        if (!pip(f.x + (f.nx / nl) * 0.4, f.z + (f.nz / nl) * 0.4)) sg = -1;
        C0.push([f.x + (f.nx / nl) * 0.25 * sg, f.z + (f.nz / nl) * 0.25 * sg]);
      }
      const fr = polyFrame(C0);
      setRoad(
        [B.asphalt],
        {
          width: 0.5,
          lanesFwd: 1,
          lanesBack: 0,
          kind: 'residential',
          edgeId: (a.edgeId * 31 + b.edgeId) % 100003,
        },
        fr,
        { e: { sidewalk: 1 }, s0: 0 },
        { a: null, b: null },
      );
      ribbon(B.asphalt, fr, null, -0.25, 0.25, 0.0535, 0xffffff, 1 / 7);
      setRoad([B.asphalt], null);
    }
  }
  // gore striping where two legs split at a sharp angle on highways / big arterials: white border lines from the gore point to the
  // curb-return tangents and chevrons inside the paved wedge (clipped to it)
  function goreStripes(B, J) {
    if (!B.lines || !M.lines) return;
    const W = new THREE.Color(1, 1, 1),
      uw = LINE_U.w;
    for (const c of J.corners) {
      if (c.kind !== 'fillet' || !c.C) continue;
      const a = J.legs[c.i],
        b = J.legs[c.j];
      const cosA = a.dx * b.dx + a.dz * b.dz;
      if (cosA < Math.cos(0.8)) continue;
      if (!(
        J.hwy ||
        (/primary|secondary|trunk/.test(a.kind) && /primary|secondary|trunk/.test(b.kind))
      ))
        continue;
      const Ta = c.arc[0],
        Tb = c.arc[c.arc.length - 1],
        line = (p, q) => {
          const dx = q[0] - p[0],
            dz = q[1] - p[1],
            L = Math.hypot(dx, dz) || 1,
            nx = (-dz / L) * 0.1,
            nz = (dx / L) * 0.1;
          quadUV(
            B.lines,
            [
              [p[0] - nx, 0.066, p[1] - nz, uw[0], 0],
              [p[0] + nx, 0.066, p[1] + nz, uw[1], 0],
              [q[0] + nx, 0.066, q[1] + nz, uw[1], L / LINE_V],
              [q[0] - nx, 0.066, q[1] - nz, uw[0], L / LINE_V],
            ],
            W,
          );
        };
      line(c.C, Ta);
      line(c.C, Tb);
      const mx = (Ta[0] + Tb[0]) / 2 - c.C[0],
        mz = (Ta[1] + Tb[1]) / 2 - c.C[1],
        ml = Math.hypot(mx, mz) || 1,
        ux = mx / ml,
        uz = mz / ml,
        px = -uz,
        pz = ux; // u: from the gore point into the wedge
      const fan = spandrelFan(c);
      for (let d = 2.5; d < ml + 6; d += 3.2)
        for (const sgn of [-1, 1]) {
          // chevron: two stripes leaning back toward the gore point
          const cx = c.C[0] + ux * d,
            cz = c.C[1] + uz * d,
            ex = cx + (px * sgn - ux * 0.9) * 8,
            ez = cz + (pz * sgn - uz * 0.9) * 8,
            sx = -(ez - cz),
            sz = ex - cx,
            sl = Math.hypot(sx, sz) || 1,
            w = 0.25;
          const stripe = convexCCW([
            [cx - (sx / sl) * w, cz - (sz / sl) * w],
            [cx + (sx / sl) * w, cz + (sz / sl) * w],
            [ex + (sx / sl) * w, ez + (sz / sl) * w],
            [ex - (sx / sl) * w, ez - (sz / sl) * w],
          ]);
          for (const t of fan) {
            const P = clipToConvex(stripe, t);
            if (!P) continue;
            for (let k = 1; k < P.length - 1; k++) {
              const tri = [P[0], P[k], P[k + 1]];
              quadUV(
                B.lines,
                tri
                  .concat([tri[2]])
                  .map((p) => [
                    p[0],
                    0.066,
                    p[1],
                    uw[0] + (uw[1] - uw[0]) * 0.5,
                    (p[0] * ux + p[1] * uz) / LINE_V,
                  ]),
                W,
              );
            }
          }
        }
    }
  }
  // continental crosswalk (bars along the travel direction), stop bar, curb ramps for one approach leg drawn on this piece
  function approachMarks(B, fr, ys, r, hw, pe, atB, mY) {
    const L = atB ? pe.B : pe.A;
    if (!L) return;
    const loc = (s) => (atB ? pe.LE - s - pe.s0 : s - pe.s0),
      span = (a, b) => {
        const p = loc(a),
          q = loc(b);
        return p < q ? [p, q] : [q, p];
      };
    const PAINT = 0xf2f1ec;
    const cwFree = () => {
      if (!CLIP_PAINT) return true;
      const [c0, c1] = span(L.cw[0], L.cw[1]);
      for (const sc of [c0, (c0 + c1) / 2, c1])
        for (const o of [-hw * 0.8, 0, hw * 0.8]) {
          const q = sampleAt(fr, Math.max(0, sc));
          if (paintBlocked(q.x + q.nx * o, q.z + q.nz * o, true)) return false;
        }
      return true;
    }; // a crosswalk that would reach into a neighbouring junction (close node pairs) is left out whole
    if (L.cw && cwFree()) {
      const [c0, c1] = span(L.cw[0], L.cw[1]),
        W = 2 * hw - 0.5,
        n = Math.max(2, Math.floor((W + 0.6) / 1.2)),
        o0 = -(n * 1.2 - 0.6) / 2;
      // surfaces pass: crosswalk style by area: ladder (bars + border lines) in the downtown core, continental bars on business /
      // beach / nightlife streets, two plain transverse lines on residential streets and in the towns
      const J = atB ? pe.Jb : pe.Ja,
        zn = String((J && J.zone) || (zoneAt ? zoneAt(fr[0].x, fr[0].z) : '') || ''),
        style = SURF_OFF
          ? 'bars'
          : /downtown/.test(zn)
            ? 'ladder'
            : /business|brickell|commercial|nightlife|beach/.test(zn)
              ? 'bars'
              : 'lines';
      if (style !== 'lines')
        for (let k = 0; k < n; k++)
          markRibbon(B, fr, ys, o0 + k * 1.2, o0 + k * 1.2 + 0.6, mY, PAINT, 1, c0, c1);
      if (style !== 'bars') {
        const lw2 = style === 'ladder' ? 0.2 : 0.3,
          e0 = style === 'ladder' ? c0 - 0.25 : c0,
          e1 = style === 'ladder' ? c1 + 0.25 : c1;
        markRibbon(B, fr, ys, -hw + 0.3, hw - 0.3, mY, PAINT, 1, e0, e0 + lw2);
        markRibbon(B, fr, ys, -hw + 0.3, hw - 0.3, mY, PAINT, 1, e1 - lw2, e1);
      }
    }
    if (L.bar) {
      const [b0, b1] = span(L.bar[0], L.bar[1]),
        total = r.lanesFwd + r.lanesBack,
        lw = r.width / Math.max(1, total),
        c = -hw + r.lanesBack * lw;
      if (atB && r.lanesFwd)
        markRibbon(B, fr, ys, r.oneway ? -hw + 0.3 : c + 0.3, hw - 0.3, mY, PAINT, 1, b0, b1);
      if (!atB && r.lanesBack)
        markRibbon(B, fr, ys, -hw + 0.3, r.oneway ? hw - 0.3 : c - 0.3, mY, PAINT, 1, b0, b1);
    }
  }
  // sandy shoulders along a Keys lane: the asphalt edge crumbles into sand (irregular width, 0.6-1.8 m), sand drawn under the
  // asphalt layer (polygon offset), so where it overlaps the road edge the asphalt wins
  function laneShoulders(B, fr, hw, sA, sB, r) {
    const col = new THREE.Color(0xa49a84),
      eid = r.edgeId ?? 0;
    for (const side of [-1, 1]) {
      let prev = null;
      for (let s = Math.max(0, sA); ; s += 2) {
        const sc = Math.min(s, Math.min(sB, fr[fr.length - 1].s)),
          q = sampleAt(fr, sc),
          w =
            0.6 +
            hash(Math.floor(sc / 2) * 7.3 + eid * 13 + side) * 1.2 +
            0.4 * Math.sin(sc * 0.37 + eid);
        const inn = [q.x + q.nx * side * (hw - 0.12), 0.012, q.z + q.nz * side * (hw - 0.12)],
          out = [q.x + q.nx * side * (hw + w), 0.012, q.z + q.nz * side * (hw + w)];
        if (prev) quadUp(B.sand, prev[0], prev[1], out, inn, col, 1 / 6);
        prev = [inn, out];
        if (sc >= sB - 1e-3 || sc >= fr[fr.length - 1].s - 1e-3) break;
      }
    }
  }
  // curb ramps (sloped concrete, yellow detectable-warning pad at the street edge) for every crosswalk landing on a sidewalk
  function rampsInto(tgt, coll, J) {
    const Y0 = 0.055,
      Y1 = CURB,
      white = new THREE.Color(0xffffff),
      warn = new THREE.Color(0xe8b830);
    for (const L of J.legs)
      for (const rp of L.ramps) {
        const P = (p, y) => [p[0], y, p[1]],
          yW = Y0 + (Y1 - Y0) * (0.6 / RAMP_RUN);
        if (tgt) {
          quadUp(tgt, P(rp.f0, Y0), P(rp.f1, Y0), P(rp.w1, yW), P(rp.w0, yW), warn, 1 / 2.5);
          quadUp(tgt, P(rp.w0, yW), P(rp.w1, yW), P(rp.b1, Y1), P(rp.b0, Y1), white, 1 / 2.5);
          quadUp(tgt, P(rp.fl, Y1), P(rp.f0, Y0), P(rp.b0, Y1), P(rp.b0, Y1), white, 1 / 2.5);
          quadUp(tgt, P(rp.f1, Y0), P(rp.fr, Y1), P(rp.b1, Y1), P(rp.b1, Y1), white, 1 / 2.5);
        }
        if (coll) {
          coll.tag = 'roadSidewalk';
          quadUp(coll, P(rp.f0, Y0), P(rp.f1, Y0), P(rp.b1, Y1), P(rp.b0, Y1), WHITE, 1);
          quadUp(coll, P(rp.fl, Y1), P(rp.f0, Y0), P(rp.b0, Y1), P(rp.b0, Y1), WHITE, 1);
          quadUp(coll, P(rp.f1, Y0), P(rp.fr, Y1), P(rp.b1, Y1), P(rp.b1, Y1), WHITE, 1);
        }
      }
  }
  // ---- roads ----
  // ---- ground-continuity: dead-end road caps ----
  const CLAIMS = groundClaims(D && D.setpieces),
    BND = D && D.bounds,
    CUL_KIND = /residential|living|unclassified|tertiary/;
  const capStats = { bulb: 0, cap: 0, apron: 0 };
  // r's end (atB: the last point) at a degree-1 node -> { kind: 'bulb' | 'cap' | 'apron', cut (asphalt stops this far from the end), mk (markings stop), x, z, R, ox, oz }
  function endCap(r, fr, L, hw, atB, tile) {
    if (L < 4 || GC_OFF) return null;
    const p = atB ? r.pts[r.pts.length - 1] : r.pts[0],
      nd = nodeAt(p);
    if (!nd || nd.degree !== 1) return null;
    if (
      BND &&
      (p[0] < BND.minX + 60 || p[0] > BND.maxX - 60 || p[1] < BND.minZ + 60 || p[1] > BND.maxZ - 60)
    )
      return null; // the map edge cuts it, not a real end
    const q = sampleAt(fr, atB ? L : 0),
      ox = atB ? q.dx : -q.dx,
      oz = atB ? q.dz : -q.dz;
    if (CLAIMS.list.length && CLAIMS.at(p[0], p[1], 2)) {
      // runs into a set piece's own ground (its yard / drive takes over)
      let s = 0;
      for (; s < Math.min(L - 2, 150); s += 0.5) {
        const w = sampleAt(fr, atB ? L - s : s);
        if (!CLAIMS.at(w.x, w.z, 0.2)) break;
      }
      return { kind: 'apron', cut: s + 3, edge: s, mk: s + 4, ox, oz };
    }
    const free = (cx, cz, R) => {
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2,
          x = cx + Math.cos(a) * R,
          z = cz + Math.sin(a) * R;
        if ((isWater && isWater(x, z)) || insideBuilding(tile, x, z)) return false;
      }
      return !(isWater && isWater(cx, cz));
    };
    if (CUL_KIND.test(r.kind || '') && L > 30) {
      const R = Math.max(hw + 3, 8),
        o = R * 0.5,
        cx = p[0] + ox * o,
        cz = p[1] + oz * o;
      if (free(cx, cz, R)) {
        capStats.bulb++;
        return {
          kind: 'bulb',
          x: cx,
          z: cz,
          R,
          cut: Math.max(0, Math.sqrt(R * R - hw * hw) - o - 0.3),
          mk: R - o + 2,
          ox,
          oz,
        };
      }
    }
    capStats.cap++;
    return { kind: 'cap', x: p[0], z: p[1], R: hw, cut: 0, mk: 1, ox, oz };
  }
  function drawCap(B, coll, fr, L, hw, c, atB) {
    if (c.kind === 'apron') {
      // asphalt -> flared broom-finished concrete apron up to the set piece's edge
      capStats.apron++;
      const at = (s, o) => {
        const q = sampleAt(fr, atB ? L - s : s);
        return [q.x + q.nx * o, 0.06, q.z + q.nz * o];
      };
      const sIn = c.cut,
        sOut = c.edge,
        wIn = hw,
        wOut = hw + 1.4;
      const a = at(sIn, -wIn),
        b = at(sIn, wIn),
        cc = at(sOut, wOut),
        d = at(sOut, -wOut);
      quadUp(B.sidewalk, a, b, cc, d, new THREE.Color(0xd9d4c8), 1 / 2.5);
      if (coll) {
        coll.tag = 'road';
        quadUp(coll, a, b, cc, d, WHITE, 1);
      }
      return;
    }
    const seg = c.kind === 'bulb' ? 28 : 16,
      ring = [];
    for (let k = 0; k < seg; k++) {
      const a = (k / seg) * Math.PI * 2;
      ring.push([c.x + Math.cos(a) * c.R, c.z + Math.sin(a) * c.R]);
    }
    fillPoly(B.junction || B.asphalt, [ring], 0.055, 0xffffff, 1 / 7);
    if (coll) {
      coll.tag = 'junction';
      fillPoly(coll, [ring], 0.05, 0xffffff, 1);
    }
  }
  // is (x, z) on a sidewalk slab this tile (or a neighbor) really draws? (the surface grid also marks slabs that were dropped)
  const slabIdx = new WeakMap();
  function slabAt(tile, x, z) {
    let L = slabIdx.get(tile);
    if (!L) {
      L = [];
      const nb = [tile];
      if (provider.getTile && tile.tx !== undefined)
        for (let i = -1; i <= 1; i++)
          for (let j = -1; j <= 1; j++) {
            if (!i && !j) continue;
            const o = provider.getTile(tile.tx + i, tile.tz + j);
            if (o && !o.then && o.roads) nb.push(o);
          }
      for (const tt of nb) {
        for (const rings of sidewalksOf(tt)) L.push({ rings, bb: bboxOf(rings[0]) });
        // ground pass (Nov 19): a raised plaza is a slab too. Without it the corner curb returns and walk
        // corners were built through the plaza: loose curb bars lying on the paving.
        if (PLAZA_CLIP)
          for (const a of tt.areas || [])
            if (plazaRaised(a)) L.push({ rings: a.rings, bb: bboxOf(a.rings[0]) });
      }
      slabIdx.set(tile, L);
    }
    for (const e of L)
      if (
        x >= e.bb[0] &&
        x <= e.bb[2] &&
        z >= e.bb[1] &&
        z <= e.bb[3] &&
        pipR(e.rings[0], x, z) &&
        !e.rings.slice(1).some((h) => pipR(h, x, z))
      )
        return true;
    return false;
  }
  // roads pass (Nov 19, the user's Keys bridge shot): an elevated-network edge ends its ramp ~12 m short of a ground junction (room for
  // the old disc), but the job-4 junction outline only starts 1 m from the node, so sand showed between the ramp foot and the city
  // street. Every stretch of an owned edge that is at grade and not covered by any deck is drawn as plain road (render + collider),
  // butting exactly onto the ramp end and the junction mouth (no overlap, no coplanar layers).
  function groundTail(B, r, tile, coll) {
    if (!elevated || !elevated.footprintAt || r.pts.length < 2) return;
    const fr = polyFrame(r.pts),
      L = fr[fr.length - 1].s,
      hw = r.width / 2,
      pe = pieceEnds(r),
      tailB = pe ? pe.LE - pe.s0 - L : 0;
    const sMin = pe && pe.A ? Math.max(0, pe.A.D - pe.s0) : 0,
      sMax = pe && pe.B ? Math.min(L, pe.LE - pe.B.D - pe.s0) : L;
    void tailB;
    const G = D && D.roadGraph,
      e = G && G.edges ? G.edges[r.edgeId] : null,
      yG = (s) => {
        if (!e || !e.y || !e.cum || !pe) return 0;
        const se = pe.s0 + s;
        let i = 1;
        while (i < e.cum.length - 1 && e.cum[i] < se) i++;
        const t = Math.max(0, Math.min(1, (se - e.cum[i - 1]) / (e.cum[i] - e.cum[i - 1] || 1)));
        return (e.y[i - 1] || 0) + ((e.y[i] || 0) - (e.y[i - 1] || 0)) * t;
      };
    const free = (s) => {
      if (yG(s) > 0.4) return false;
      const q = sampleAt(fr, s);
      for (const o of [0, -hw * 0.8, hw * 0.8])
        if (safeCall(() => elevated.footprintAt(q.x + q.nx * o, q.z + q.nz * o), false))
          return false;
      return !(isWater && isWater(q.x, q.z));
    };
    let a = null;
    const flushRun = (b) => {
      if (a !== null && b - a > 0.3) {
        ribbon(B.asphalt, fr, null, -hw, hw, 0.05, 0xffffff, 1 / 7, a, b);
        if (coll) {
          coll.tag = 'road';
          ribbon(coll, fr, null, -hw, hw, 0.05, 0xffffff, 1, a, b);
        }
      }
      a = null;
    };
    for (let s = sMin; s <= sMax + 1e-6; s += 0.25) {
      const ok = free(s);
      if (ok && a === null) a = Math.max(sMin, s - 0.25);
      else if (!ok && a !== null) flushRun(s);
    }
    flushRun(sMax);
  }
  function* buildRoads(B, tile, props, coll, flush) {
    resolveDecks(tile);
    let rc = 0;
    for (const r of tile.roads) {
      if (r.pts.length < 2) continue;
      if (++rc % 10 === 0) {
        if (flush) flush();
        yield;
      }
      AUD.src = 'r' + (r.edgeId ?? r.id);
      if (owned(r)) {
        if (ROADFIX) groundTail(B, r, tile, coll);
        continue;
      } // decks / ramps come from elevated.js; roads pass: the at-grade end it leaves undrawn is paved here
      paintEdge = r.edgeId ?? null; // job 4: paint clip also keeps this road's lines off the other legs where legs overlap near a sharp junction
      const prof = roadProfile(r, tile);
      const fr = polyFrame(prof.pts),
        L = fr[fr.length - 1].s,
        hw = r.width / 2,
        ys = prof.ys;
      // trim ends at intersections so markings/sidewalks stop at the junction
      const na = nodeAt(r.pts[0]),
        nb = nodeAt(r.pts[r.pts.length - 1]);
      let trimA = na && na.degree >= 3 ? na.width / 2 + 2.5 : 0,
        trimB = nb && nb.degree >= 3 ? nb.width / 2 + 2.5 : 0;
      // job 4: at a junction with a real outline the ribbon starts exactly at that leg's mouth (edge stations, so a piece cut by a
      // tile seam near the node is trimmed too); markings and furniture keep clear of the curb returns
      const pe = pieceEnds(r),
        jA = pe && pe.A,
        jB = pe && pe.B,
        tailB = pe ? pe.LE - pe.s0 - L : 0;
      if (jA) trimA = Math.max(0, jA.D - pe.s0);
      else if (pe && pe.s0 > 0.01) trimA = 0;
      if (jB) trimB = Math.max(0, jB.D - tailB);
      else if (pe && tailB > 0.01) trimB = 0;
      const yRoad = 0.05;
      // stop the ribbon just inside a junction fill drawn at this end's level (no road-over-road duplicates)
      const lvA = trimA && !jA ? nodeLevel(tile, na) : null,
        lvB = trimB && !jB ? nodeLevel(tile, nb) : null;
      const yA = ys ? ys[0] : 0,
        yB = ys ? ys[ys.length - 1] : 0;
      let rA =
          lvA && lvA.kind && junctionDrawn(tile, r.pts[0]) && Math.abs(lvA.y - yA) < 0.3
            ? na.width / 2 + 0.5
            : 0,
        rB =
          lvB &&
          lvB.kind &&
          junctionDrawn(tile, r.pts[r.pts.length - 1]) &&
          Math.abs(lvB.y - yB) < 0.3
            ? L - (nb.width / 2 + 0.5)
            : Infinity; // ground-continuity R1: only cut back for a junction disc that is really drawn (no grass gap between road pieces)
      if (jA) rA = jA.D - pe.s0;
      if (jB) rB = pe.LE - jB.D - pe.s0;
      // ground-continuity: dead ends finish as a cul-de-sac bulb / rounded cap, or (inside a set piece's own ground) stop at its edge with a concrete apron
      const capA = ys ? null : endCap(r, fr, L, hw, false, tile),
        capB = ys ? null : endCap(r, fr, L, hw, true, tile);
      let cA = 0,
        cB = 0; // collider trims
      if (capA) {
        rA = Math.max(rA, capA.cut);
        if (capA.kind === 'apron') cA = capA.cut;
        drawCap(B, coll, fr, L, hw, capA, false);
      }
      if (capB) {
        rB = Math.min(rB, L - capB.cut);
        if (capB.kind === 'apron') cB = capB.cut;
        drawCap(B, coll, fr, L, hw, capB, true);
      }
      setRoad([B.asphalt, B.lines, B.decals], r, fr, pe, {
        a: jA ? rA : null,
        b: jB ? rB : null,
        lane: !ys && !!laneOfRoad(r),
      }); // surfaces pass: road frame for the vertices below
      const dw = ys ? deckWidths(fr, ys, r, hw, tile) : null;
      if (dw && dw.shrunk) {
        if (rB > rA + 0.2) vribbon(B.asphalt, fr, ys, dw.oL, dw.oR, yRoad, 0xffffff, 1 / 7, rA, rB);
        if (coll) {
          coll.tag = 'deck';
          vribbon(coll, fr, ys, dw.oL, dw.oR, yRoad, 0xffffff, 1);
        }
      } else {
        if (rB > rA + 0.2) {
          if (!ys && B.dirtRoad && (r.surface === 'dirt' || /track/.test(r.kind || '')))
            ribbon(B.dirtRoad, fr, ys, -hw, hw, yRoad, 0xffffff, 1 / 4, rA, rB);
          else if (!ys && laneOfRoad(r))
            ribbon(B.asphalt, fr, ys, -hw, hw, yRoad, LANE_TINT, 1 / 7, rA, rB);
          else roadStrips(B.asphalt, fr, ys, hw, yRoad, rA, rB, r);
        }
        if (coll) {
          coll.tag = ys ? 'deck' : 'road';
          ribbon(coll, fr, ys, -hw, hw, yRoad, 0xffffff, 1, cA, L - cB);
        }
      }
      if (ROADFIX && !ys && pe && rB > rA + 0.2) {
        // roads pass: a piece cut at a tile seam tucks a 0.2 m flap under its neighbor, so no hairline of sand shows through the seam
        const tb =
            (r.surface === 'dirt' || /track/.test(r.kind || '')) && B.dirtRoad
              ? B.dirtRoad
              : B.asphalt,
          tint = laneOfRoad(r) ? LANE_TINT : 0xffffff,
          fc = new THREE.Color(tint);
        const flap = (s, dir) => {
          const q = sampleAt(fr, s),
            a = [q.x - q.nx * hw, yRoad, q.z - q.nz * hw],
            b = [q.x + q.nx * hw, yRoad, q.z + q.nz * hw],
            ox = q.dx * dir * 0.2,
            oz = q.dz * dir * 0.2;
          quadUp(
            tb,
            a,
            b,
            [b[0] + ox, yRoad - 0.04, b[2] + oz],
            [a[0] + ox, yRoad - 0.04, a[2] + oz],
            fc,
            1 / 7,
          );
        };
        if (pe.s0 > 0.01 && rA < 0.01) flap(0, -1);
        if (pe.LE - pe.s0 - L > 0.01 && rB > L - 0.01) flap(L, 1);
      }
      // ground-continuity R2: a thin concrete edge strip where an open road meets the verge (no raw asphalt-to-grass cut)
      const lane = !ys && laneOfRoad(r);
      const curbedEdge = !lane && (pe ? (pe.e.sidewalk || 0) > 0 : !!r.sidewalks);
      const sideOpen = (side) => {
        if (!curbedEdge) return true;
        for (const f of [0.2, 0.5, 0.8]) {
          const q = sampleAt(fr, rA + (Math.min(rB, L) - rA) * f),
            o = side * (hw + 1.2);
          if (slabAt(tile, q.x + q.nx * o, q.z + q.nz * o)) return false;
        }
        return true;
      }; // a curbed street can still have one open side
      const scanShoulder =
        !ys &&
        !GC_OFF &&
        !GM_ON &&
        !/service|track|path|footway/.test(r.kind || '') &&
        r.surface !== 'dirt' &&
        M.shoulder &&
        B.shoulder &&
        rB > rA + 1;
      if (scanShoulder)
        for (const side of [-1, 1]) {
          if (!sideOpen(side)) continue; // shoulders run from each side's curb-return tangent (straight-through sides: from the node)
          let a = rA,
            b = rB;
          if (pe && !capA && jA) a = (side > 0 ? jA.tB : jA.tA) - pe.s0;
          if (pe && !capB && jB) b = pe.LE - (side > 0 ? jB.tA : jB.tB) - pe.s0;
          shoulderRibbon(B, fr, hw, a, b, side, r.edgeId ?? 0, lane);
        }
      else if (lane && B.sand && rB > rA + 1 && !GM_ON) laneShoulders(B, fr, hw, rA, rB, r); // ground pass: with the surface mask the terrain / fill shaders draw the shoulders
      if (
        GM_ON &&
        curbedEdge &&
        !ys &&
        rB > rA + 1 &&
        !/service|track|path|footway/.test(r.kind || '')
      )
        for (const side of [-1, 1]) {
          // ground pass: a city street whose sidewalk is set back (tree lawn) still has a granite curb at the asphalt edge
          if (!sideOpen(side)) continue;
          let a = rA,
            b = rB;
          if (pe && !capA && jA) a = (side > 0 ? jA.tB : jA.tA) - pe.s0;
          if (pe && !capB && jB) b = pe.LE - (side > 0 ? jB.tA : jB.tB) - pe.s0;
          if (b < a + 1) continue;
          const oIn = side * hw,
            o1 = side * (hw + 0.3);
          if (B.sidewalk) {
            const hS = CURB3D ? CURB - 0.009 : CURB - 0.004;
            ribbon(
              B.sidewalk,
              fr,
              0,
              Math.min(oIn, o1),
              Math.max(oIn, o1),
              hS,
              0xc9c6bf,
              1 / 2.5,
              a,
              b,
            ); /* r2-roads: under the slab top, so where a slab also reaches the curb it wins (roads pass: 9 mm, was a 4 mm z-fight band) */
            if (CURB3D) {
              curbAlong(B.sidewalk, fr, side, hw, a, b, hS, r.edgeId);
              backBerm(B.sidewalk, fr, side, hw + 0.3, a, b, hS);
            } // roads pass: poured curb + gutter, soil berm behind (no box on the lawn)
            else {
              sideWall(B.sidewalk, fr, 0, oIn, CURB, 0, 0xa8a6a2, -side, a, b);
              sideWall(B.sidewalk, fr, 0, o1, CURB, 0, 0xb4b1aa, side, a, b);
            }
          }
          if (coll) {
            coll.tag = 'roadSidewalk';
            ribbon(coll, fr, 0, Math.min(oIn, o1), Math.max(oIn, o1), CURB, 0xffffff, 1, a, b);
            sideWall(coll, fr, 0, oIn, CURB, 0, 0xffffff, -side, a, b);
          }
        }
      if (
        !scanShoulder &&
        !GM_ON &&
        !ys &&
        !lane &&
        !r.sidewalks &&
        !GC_OFF &&
        !/service|track|path|footway/.test(r.kind || '') &&
        r.surface !== 'dirt' &&
        rB > rA + 1
      )
        for (const side of [-1, 1])
          ribbon(
            B.sidewalk,
            fr,
            ys,
            side < 0 ? -hw - 0.32 : hw,
            side < 0 ? -hw : hw + 0.32,
            yRoad + 0.003,
            0xd9d5cb,
            1 / 2.5,
            rA,
            rB,
          );
      // markings (job 4: per road class; stations on the graph edge so dashes and lines run on across tile seams)
      const total = r.lanesFwd + r.lanesBack,
        lw = r.width / Math.max(1, total),
        dirt = r.surface === 'dirt' || /track/.test(r.kind || '');
      const mY = yRoad + 0.015;
      let s0 = trimA + 1 + (capA ? capA.mk : 0),
        s1 = L - trimB - 1 - (capB ? capB.mk : 0);
      if (pe) {
        s0 =
          (jA
            ? jA.mk - pe.s0
            : pe.discA && CLIP_PAINT
              ? pe.discA + 1 - pe.s0
              : pe.s0 > 0.01
                ? 0
                : 0.5) + (capA ? capA.mk : 0);
        s1 =
          L -
          (jB
            ? jB.mk - tailB
            : pe.discB && CLIP_PAINT
              ? pe.discB + 1 - tailB
              : tailB > 0.01
                ? 0
                : 0.5) -
          (capB ? capB.mk : 0);
      } // old-disc ends keep their trim
      if (pe && B && B.marks) {
        approachMarks(B, fr, ys, r, hw, pe, false, mY);
        approachMarks(B, fr, ys, r, hw, pe, true, mY);
      }
      if (B && B.decals && !dirt && rB > rA + 2) {
        roadDecals(B, fr, ys, r, hw, pe, lane, Math.max(0, rA), Math.min(L, rB));
        turnArrows(B, fr, r, hw, pe);
        if (!ys && props && COVERS.parts) {
          decTint = WHITE_T;
          const cv = placeCovers(
            {
              r,
              pe,
              hw,
              lane,
              L,
              s0: Math.max(0, rA),
              s1: Math.min(L, rB),
              sample: (s) => sampleAt(fr, s),
              blocked: (x, z) => paintBlocked(x, z),
              zoneAt,
              decal: (x, z, ax, az, len, wid, k) => decal(B, x, z, ax, az, len, wid, DEC.patch, k),
            },
            hash,
          );
          if (cv) for (const k in cv) if (cv[k].length) (props['cv_' + k] ||= []).push(...cv[k]);
        }
      } // job 4: lived-in asphalt; r2-roads: utility covers
      if (lane && B.marks && s1 > s0 + 2) {
        // Keys lane: a faded, broken center line on the wider ones, plus dark sealed patches
        if (r.width >= 6 && !r.oneway && hash((r.edgeId ?? 0) * 17 + 3) < 0.6) {
          const base = pe ? -pe.s0 : s0;
          for (let s = base + Math.floor((s0 - base) / 12) * 12; s < s1; s += 12) {
            const a = Math.max(s0, s),
              b = Math.min(s1, s + 4.5);
            if (b > a + 0.3) markRibbon(B, fr, ys, -0.06, 0.06, mY, 0xa89660, 1, a, b);
          }
        }
        if (B.decals && M.roadDecals) {
          decTint = LANE_TINT;
          const eid = r.edgeId ?? 0; // ground pass: sealed patches as irregular soft-edged decals in the lane's own asphalt (were dark rectangles)
          for (let s = s0 + 3 + hash(eid * 7) * 8; s < s1 - 2; s += 8 + hash(s * 3.1 + eid) * 16) {
            const h = hash(s * 17 + eid * 5),
              q = sampleAt(fr, s),
              len = 1.1 + hash(s + 9) * 2.6,
              w = 0.8 + hash(s * 5 + 1) * 1.5,
              o = (h - 0.5) * Math.max(0, 2 * hw - w - 0.6);
            const x = q.x + q.nx * o,
              z = q.z + q.nz * o;
            if (paintBlocked(x, z)) continue;
            const rot = (hash(s * 7 + 3) - 0.5) * 0.5,
              ca = Math.cos(rot),
              sa = Math.sin(rot),
              nl = Math.hypot(q.nx, q.nz) || 1;
            decal(
              B,
              x,
              z,
              q.dx * ca - (q.nx / nl) * sa,
              q.dz * ca - (q.nz / nl) * sa,
              len,
              w,
              h < 0.18 ? DEC.potholePatched : DEC.patch,
              0.94 + hash(s + 2) * 0.12,
            );
          }
        }
      }
      if (s1 > s0 + 2 && total >= 2 && r.kind !== 'service' && !dirt && !lane) {
        const base = pe ? -pe.s0 : s0; // dash phase fixed to the edge
        const dash = (off, w, len, gap, col) => {
          const P = len + gap;
          for (let s = base + Math.floor((s0 - base) / P) * P; s < s1; s += P) {
            const a = Math.max(s0, s),
              b = Math.min(s1, s + len);
            if (b > a + 0.05) markRibbon(B, fr, ys, off - w, off + w, mY, col, 1, a, b);
          }
        };
        const localSt =
          !ARROWS_OLD &&
          /residential|living_street/.test(r.kind || '') &&
          total <= 2 &&
          r.width < 9.5; // r2-roads: local residential streets carry no center line (US practice; MUTCD 3B.01 only asks for it on collectors / arterials)
        if (!r.oneway && !localSt) {
          // yellow double center line at the forward/back split
          const c = -hw + r.lanesBack * lw;
          markRibbon(B, fr, ys, c - 0.26, c - 0.14, mY, 0xf2c230, 1, s0, s1);
          markRibbon(B, fr, ys, c + 0.14, c + 0.26, mY, 0xf2c230, 1, s0, s1);
        }
        for (let k = 1; k < total; k++) {
          if (!r.oneway && k === r.lanesBack) continue;
          dash(-hw + k * lw, 0.07, 3, JOB4_OFF ? 6 : 9, 0xf4f4f0);
        } // 10 ft dashes, 30 ft gaps
        // edge lines on open roads (no curb): white on the right, yellow on the left edge of a one-way (divided) carriageway
        const curbed = pe ? (pe.e.sidewalk || 0) > 0 : !!r.sidewalks;
        if (
          (JOB4_OFF
            ? r.width > 8
            : (!curbed &&
                r.width >= 6.5 &&
                /motorway|trunk|primary|secondary|tertiary/.test(r.kind || '')) ||
              /motorway|trunk/.test(r.kind || '')) &&
          !(dw && dw.shrunk)
        ) {
          markRibbon(
            B,
            fr,
            ys,
            -hw + 0.35,
            -hw + 0.5,
            mY,
            r.oneway && !JOB4_OFF ? 0xf2c230 : 0xf4f4f0,
            1,
            s0,
            s1,
          );
          markRibbon(B, fr, ys, hw - 0.5, hw - 0.35, mY, 0xf4f4f0, 1, s0, s1);
        }
        // stop bars at the old disc junctions (job-4 junctions draw theirs with the crosswalks)
        if ((trimB || pe?.discB) && !jB && !pe?.Jb && r.lanesFwd)
          markRibbon(
            B,
            fr,
            ys,
            r.oneway ? -hw + 0.3 : -hw + r.lanesBack * lw + 0.3,
            hw - 0.3,
            mY,
            0xf4f4f0,
            1,
            s1 - 0.5,
            s1,
          );
        if ((trimA || pe?.discA) && !jA && !pe?.Ja && r.lanesBack)
          markRibbon(
            B,
            fr,
            ys,
            -hw + 0.3,
            -hw + r.lanesBack * lw - 0.3,
            mY,
            0xf4f4f0,
            1,
            s0,
            s0 + 0.5,
          );
      }
      // sidewalks + curbs (raised, with colliders)
      if ((r.sidewalks || r.furniture) && !ys) {
        const a = trimA + 0.5,
          b2 = L - trimB - 0.5;
        if (b2 > a + 1)
          for (const side of [-1, 1]) {
            const oIn = side * hw,
              oOut = side * (hw + SIDEWALK_W);
            if (r.sidewalks && !lane) {
              ribbon(
                B.sidewalk,
                fr,
                0,
                Math.min(oIn, oOut),
                Math.max(oIn, oOut),
                CURB,
                0xffffff,
                1 / 2.5,
                a,
                b2,
              );
              sideWall(B.sidewalk, fr, 0, oIn, CURB, 0, 0xa8a6a2, -side, a, b2); // granite curb face
              if (props && GM_ON) {
                const CW = (props.curbWeed ||= []),
                  eidw = (r.edgeId ?? 0) * 31 + (side > 0 ? 7 : 3);
                for (let sw = a + 2; sw < b2 - 2; sw += 3.5) {
                  const hw0 = hash(eidw * 131 + Math.floor(sw * 2.9));
                  if (hw0 > 0.1) continue;
                  const q = sampleAt(fr, sw + hw0 * 9),
                    o = side * (hw + 0.05);
                  CW.push({
                    x: q.x + q.nx * o,
                    y: 0.05,
                    z: q.z + q.nz * o,
                    ry: hw0 * 63,
                    s: 0.6 + hw0 * 6,
                  });
                  const AW = (globalThis.__gpWeeds ||= []);
                  if (AW.length < 400)
                    AW.push([q.x + q.nx * o, q.z + q.nz * o, q.nx * side, q.nz * side]);
                }
              } // ground pass: sparse weed tufts in the gutter crack along the curb
              {
                // granite curb top: a 0.3 m darker band with a pale arris at the road edge
                const o1 = oIn + side * 0.3,
                  oA = oIn + side * 0.035;
                ribbon(
                  B.sidewalk,
                  fr,
                  0,
                  Math.min(oIn, oA),
                  Math.max(oIn, oA),
                  CURB + 0.004,
                  0xf0eee8,
                  1 / 2.5,
                  a,
                  b2,
                );
                ribbon(
                  B.sidewalk,
                  fr,
                  0,
                  Math.min(oA, o1),
                  Math.max(oA, o1),
                  CURB + 0.004,
                  0xb4b2ae,
                  1 / 2.5,
                  a,
                  b2,
                );
              }
              if (coll) {
                coll.tag = 'roadSidewalk';
                ribbon(
                  coll,
                  fr,
                  0,
                  Math.min(oIn, oOut),
                  Math.max(oIn, oOut),
                  CURB,
                  0xffffff,
                  1,
                  a,
                  b2,
                );
                sideWall(coll, fr, 0, oIn, CURB, 0, 0xffffff, -side, a, b2);
              }
            }
            if (props) {
              // street lamps every ~32m, alternating sides
              const zR = zoneAt(r.pts[0][0], r.pts[0][1]),
                dense = !/beach|nightlife|port|industrial/.test(zR),
                lampSp = /beach|nightlife/.test(zR) || dense ? 24 : 32;
              for (let s = a + 6 + (side > 0 ? 0 : lampSp / 2); s < b2 - 4; s += lampSp) {
                const i = Math.max(0, fr.findIndex((f) => f.s >= s) - 1),
                  A = fr[i],
                  Bf = fr[Math.min(fr.length - 1, i + 1)],
                  t = Bf.s > A.s ? (s - A.s) / (Bf.s - A.s) : 0;
                const x = A.x + (Bf.x - A.x) * t,
                  z = A.z + (Bf.z - A.z) * t,
                  nx = A.nx,
                  nz = A.nz,
                  o = side * (hw + 0.6);
                if (
                  (!props.realLamps ||
                    (!/beach|nightlife/.test(zR) &&
                      !(tile.lamps || []).some(
                        (l) => Math.abs(l.x - x) < 20 && Math.abs(l.z - z) < 20,
                      ))) &&
                  okFoot(x + nx * o, z + nz * o) &&
                  !(SK && nearCrossing(x + nx * o, z + nz * o, 0.2))
                ) {
                  /* mapped lamps cover their own stretch; fill the unmapped gaps */ props.lamp.push(
                    {
                      x: x + nx * o,
                      y: CURB,
                      z: z + nz * o,
                      ry: Math.atan2(-nx * side, -nz * side),
                    },
                  );
                  props.pool.push({
                    x: x + nx * side * (hw - 1.2),
                    y: 0.05,
                    z: z + nz * side * (hw - 1.2),
                    s: 1.35,
                  });
                }
                // user (Nov 19): a tree grate every ~20 ft. Three palms per lamp bay (one 6 m before the lamp, one 12 m after and a
                // curbside pit on top of that one) put a grate every ~8 m; now one palm in a grate halfway between lamps. ?treepits=3 = old
                if (
                  TREEPITS3 &&
                  dense &&
                  props.palmZone(x, z) &&
                  okFoot(x + nx * side * (hw + 1.4), z + nz * side * (hw + 1.4))
                )
                  props.palm.push({
                    x: x + nx * side * (hw + 1.4) - ((Bf.x - A.x) / (Bf.s - A.s || 1)) * 6,
                    y: CURB,
                    pit: 1,
                    z: z + nz * side * (hw + 1.4) - ((Bf.z - A.z) / (Bf.s - A.s || 1)) * 6,
                    ry: hash(i * 13 + s) * 6,
                    s: 0.9,
                  });
                if (
                  TREEPITS3 &&
                  dense &&
                  !/beach|nightlife/.test(zR) &&
                  props.palmZone(x, z) &&
                  /primary|secondary|tertiary|residential/.test(r.kind)
                ) {
                  // curbside tree pit halfway between lamps (shade tree / palm in a grate), unless a mapped tree stands there
                  const q3 = sampleAt(fr, s + lampSp / 2),
                    o3 = side * (hw + 0.95),
                    x3 = q3.x + q3.nx * o3,
                    z3 = q3.z + q3.nz * o3;
                  if (
                    s + lampSp / 2 < b2 - 5 &&
                    okFoot(x3, z3) &&
                    !(tile.trees || []).some(
                      ([tx2, tz2]) => Math.abs(tx2 - x3) < 8 && Math.abs(tz2 - z3) < 8,
                    )
                  )
                    props.palm.push({
                      x: x3,
                      y: CURB,
                      pit: 1,
                      z: z3,
                      ry: hash(((x3 * 13) | 0) + ((z3 * 7) | 0)) * 6,
                      s: 0.8 + hash(((x3 * 3) | 0) + 11) * 0.3,
                    });
                }
                if (
                  props.palmZone(x, z) &&
                  !(
                    props.realTrees &&
                    tile.trees.some(
                      ([tx2, tz2]) => Math.abs(tx2 - x) < 14 && Math.abs(tz2 - z) < 14,
                    )
                  ) &&
                  okFoot(x + nx * side * (hw + 1.4), z + nz * side * (hw + 1.4))
                )
                  props.palm.push({
                    x: x + nx * side * (hw + 1.4) + ((Bf.x - A.x) / (Bf.s - A.s || 1)) * 12,
                    y: CURB,
                    pit: 1,
                    z: z + nz * side * (hw + 1.4) + ((Bf.z - A.z) / (Bf.s - A.s || 1)) * 12,
                    ry: hash(i * 7 + s) * 6,
                    s: 0.85 + hash(i + s) * 0.35,
                  });
              }
              // wooden utility poles + sagging overhead lines on residential / local streets (one side), outside the beach strip
              if (
                side > 0 &&
                dense &&
                /residential|tertiary|unclassified|living/.test(r.kind) &&
                b2 - a > 50
              ) {
                let prev = null;
                for (let s2 = a + 8; s2 < b2 - 6; s2 += 38) {
                  const q = sampleAt(fr, s2),
                    o = side * (hw + 0.45),
                    x = q.x + q.nx * o,
                    z = q.z + q.nz * o;
                  if (!okFoot(x, z)) {
                    prev = null;
                    continue;
                  }
                  const ry = Math.atan2(q.nx, q.nz),
                    pole = { x, y: CURB, z, ry, top: CURB + 9.6 };
                  props.upole.push(pole);
                  if (SK) {
                    pole.top = 9.5;
                    if (prev && B && B.guard) wireSpan(B, prev, pole);
                    prev = pole;
                    continue;
                  }
                  if (prev && B && B.guard)
                    for (const off of [-0.95, 0, 0.95]) {
                      const ax = prev.x + Math.sin(prev.ry + Math.PI / 2) * off,
                        az = prev.z + Math.cos(prev.ry + Math.PI / 2) * off,
                        bx = x + Math.sin(ry + Math.PI / 2) * off,
                        bz = z + Math.cos(ry + Math.PI / 2) * off,
                        L2 = Math.hypot(bx - ax, bz - az),
                        sag = 0.35 + L2 * 0.012;
                      let pp = null;
                      for (let k = 0; k <= 6; k++) {
                        const tt = k / 6,
                          P3 = new THREE.Vector3(
                            ax + (bx - ax) * tt,
                            pole.top - 0.05 - sag * 4 * tt * (1 - tt),
                            az + (bz - az) * tt,
                          );
                        if (pp) {
                          const d = P3.clone().sub(pp),
                            L3 = d.length();
                          B.guard.addGeometry(
                            BOXG,
                            new THREE.Matrix4().compose(
                              pp.clone().addScaledVector(d, 0.5),
                              new THREE.Quaternion().setFromUnitVectors(
                                new THREE.Vector3(0, 0, 1),
                                d.normalize(),
                              ),
                              new THREE.Vector3(0.025, 0.025, L3),
                            ),
                            0x1c1c1c,
                          );
                        }
                        pp = P3;
                      }
                    }
                  prev = pole;
                }
              }
              // street furniture (deterministic per road piece + side): bins near the ends, hydrants ~1/110m, benches + bus shelters on busier streets
              const eh = hash((r.edgeId ?? r.id) * 31 + (side > 0 ? 7 : 3));
              const toRoad = (q) => Math.atan2(-q.nx * side, -q.nz * side);
              const zone = zoneAt(r.pts[0][0], r.pts[0][1]);
              const busy =
                /primary|secondary|tertiary/.test(r.kind) ||
                /nightlife|beach|downtown|business|brickell|commercial|residential/.test(zone);
              const fpush = (list, it) => {
                if (okFoot(it.x, it.z) && !(SK && nearCrossing(it.x, it.z, 0.35))) list.push(it);
              }; // never on a curb ramp / crosswalk landing
              if (
                b2 - a > 25 &&
                eh < 0.7 &&
                (!SK || (zoneKind(sampleAt(fr, a + 8).x, sampleAt(fr, a + 8).z) !== 'res' && busy))
              ) {
                /* props pass: litter bins by shops / parks only */ const q = sampleAt(
                  fr,
                  a + (SK ? 6.5 : 3) + eh * 3,
                );
                fpush(props.bin, {
                  x: q.x + q.nx * side * (hw + 0.7),
                  y: CURB,
                  z: q.z + q.nz * side * (hw + 0.7),
                  ry: toRoad(q) + eh,
                  k: (eh * 3) | 0,
                });
              }
              if (
                !SK ||
                (!lane && side > 0 === eh < 0.5 && !/service|track|path|foot/.test(r.kind))
              )
                for (
                  let s = a + 12 + eh * 50, hk = 0;
                  s < b2 - 8;
                  s += 90 + hash((r.edgeId ?? 0) * 17 + hk++) * 60
                ) {
                  const q = sampleAt(fr, s);
                  fpush(props.hydrant, {
                    x: q.x + q.nx * side * (hw + 0.55),
                    y: CURB,
                    z: q.z + q.nz * side * (hw + 0.55),
                    ry: toRoad(q) + (eh - 0.5) * 0.6,
                  });
                } // props pass: curbed streets only, one side, 90-150 m apart, outlet toward the street
              if (busy && b2 - a > 40)
                for (let s = a + 15 + eh * 30; s < b2 - 15; s += dense ? 32 : 85) {
                  const q = sampleAt(fr, s),
                    sh = hash(((r.edgeId ?? r.id) * 131 + s) | 0);
                  if (/primary|secondary/.test(r.kind) && sh < 0.12 && side > 0 && !props.realBus) {
                    fpush(props.shelter, {
                      x: q.x + q.nx * side * (hw + 1.9),
                      y: CURB,
                      z: q.z + q.nz * side * (hw + 1.9),
                      ry: toRoad(q),
                    });
                    continue;
                  }
                  if (
                    (SK
                      ? zoneKind(q.x, q.z) === 'beach'
                        ? sh < 0.4
                        : zoneKind(q.x, q.z) === 'urban' || zoneKind(q.x, q.z) === 'commercial'
                          ? sh < 0.12
                          : sh < 0.08 && /primary|secondary/.test(r.kind)
                      : sh < 0.55) &&
                    (!props.realBenches ||
                      (!/beach|nightlife/.test(zone) &&
                        !(tile.benches || []).some(
                          (bb) => Math.abs(bb.pos.x - q.x) < 30 && Math.abs(bb.pos.z - q.z) < 30,
                        )))
                  )
                    fpush(props.bench, {
                      x: q.x + q.nx * side * (hw + SIDEWALK_W - 0.55),
                      y: CURB,
                      z: q.z + q.nz * side * (hw + SIDEWALK_W - 0.55),
                      ry: toRoad(q),
                    });
                  if (
                    sh >= 0.55 &&
                    sh < 0.85 &&
                    dense &&
                    !/beach|nightlife/.test(zone) &&
                    (!roadDist ||
                      roadDist(q.x + q.nx * side * (hw + 1.0), q.z + q.nz * side * (hw + 1.0)) >
                        0.9)
                  ) {
                    // mainland / island streets: bike racks and litter bins between the benches
                    if (sh < 0.6)
                      fpush(props.bike, {
                        x: q.x + q.nx * side * (hw + 1.0),
                        y: CURB,
                        z: q.z + q.nz * side * (hw + 1.0),
                        ry: toRoad(q) + Math.PI / 2,
                      });
                    else
                      fpush(props.bin, {
                        x: q.x + q.nx * side * (hw + 0.7),
                        y: CURB,
                        z: q.z + q.nz * side * (hw + 0.7),
                        ry: toRoad(q),
                        k: ((sh * 13) | 0) % 3,
                      });
                  }
                  if (
                    dense &&
                    !/beach|nightlife/.test(zone) &&
                    /primary|secondary|tertiary|residential/.test(r.kind) &&
                    hash(((s * 7) | 0) + (r.edgeId ?? 0) * 3 + side) < 0.7
                  ) {
                    const q2 = sampleAt(fr, s + 11),
                      x2 = q2.x + q2.nx * side * (hw + 0.55),
                      z2 = q2.z + q2.nz * side * (hw + 0.55);
                    if (s + 11 < b2 - 6 && (!roadDist || roadDist(x2, z2) > 0.4))
                      fpush(props.signPost, {
                        x: x2,
                        y: CURB,
                        z: z2,
                        ry: toRoad(q2) + (Math.PI / 2) * side,
                      });
                  } // parking regulation signs at the kerb
                  if (
                    SK &&
                    /primary|secondary|tertiary/.test(r.kind) &&
                    zoneKind(q.x, q.z) === 'urban' &&
                    sh > 0.3 &&
                    sh < 0.55
                  )
                    for (let m = 0; m < 4; m++) {
                      const q4 = sampleAt(fr, s + 3 + m * 6.5);
                      if (s + 3 + m * 6.5 > b2 - 6) break;
                      fpush(props.meter, {
                        x: q4.x + q4.nx * side * (hw + 0.45),
                        y: CURB,
                        z: q4.z + q4.nz * side * (hw + 0.45),
                        ry: toRoad(q4),
                      });
                    }
                  if (SK && sh > 0.93 && zoneKind(q.x, q.z) === 'urban')
                    fpush(props.mailbox, {
                      x: q.x + q.nx * side * (hw + 0.7),
                      y: CURB,
                      z: q.z + q.nz * side * (hw + 0.7),
                      ry: toRoad(q),
                      v: 'mailbox_drop',
                    });
                  // props pass: residential mailboxes are placed per house at its driveway by src/world/props/lotProps.v2.js
                  if (
                    SK &&
                    SK.parts.planter_box &&
                    sh >= 0.12 &&
                    sh < 0.19 &&
                    zoneKind(q.x, q.z) === 'urban'
                  ) {
                    const o = hw + SIDEWALK_W - 0.7,
                      x = q.x + q.nx * side * o,
                      z = q.z + q.nz * side * o,
                      pv = sh < 0.155 ? 'planter_box' : 'planter_pot'; // props pass: sidewalk planters by the shop fronts, a shrub in each
                    const n0 = props.work.length;
                    fpush(props.work, { v: pv, x, y: CURB, z, ry: toRoad(q) });
                    if (props.work.length > n0)
                      props.blob.push({
                        x,
                        y: CURB + (pv === 'planter_box' ? 0.72 : 0.5),
                        z,
                        ry: sh * 50,
                        s: pv === 'planter_box' ? 0.55 : 0.75,
                        color: new THREE.Color().setHSL(0.27 + sh * 0.2, 0.42, 0.42),
                      });
                  }
                  if (sh > 0.85)
                    fpush(props.litter, {
                      x: q.x + q.nx * side * (hw + 1.2),
                      y: CURB + 0.02,
                      z: q.z + q.nz * side * (hw + 1.2),
                      ry: sh * 40,
                      color: [0xffffff, 0xd8261c, 0x2a6fdb, 0xe8d8b0][(sh * 40) & 3],
                    });
                }
            }
          }
      }
      if (lane && props && SK && !ys && L > 30)
        keysLane(B, props, r, fr, L, hw, rA, Math.min(rB, L), tile);
      // residential islands (Star / Palm / Hibiscus / Venetians / Belle Isle / Sunset): palm-lined verges, lanterns at the drive gates
      if (
        !ys &&
        props &&
        /residential|tertiary|unclassified|living/.test(r.kind) &&
        L > 30 &&
        /Star Island|Palm Island|Hibiscus|Island$|Isle|Sunset/.test(
          distAt(r.pts[r.pts.length >> 1][0], r.pts[r.pts.length >> 1][1]),
        ) &&
        !/Fisher|Watson|Brickell Key/.test(
          distAt(r.pts[r.pts.length >> 1][0], r.pts[r.pts.length >> 1][1]),
        )
      ) {
        for (const side of [-1, 1])
          for (
            let s2 = Math.max(6, trimA + 3) + (side > 0 ? 0 : 7);
            s2 < L - Math.max(6, trimB + 3);
            s2 += 14
          ) {
            const q = sampleAt(fr, s2),
              o = side * (hw + 2.2),
              x = q.x + q.nx * o,
              z = q.z + q.nz * o;
            if (
              (isWater && isWater(x, z)) ||
              insideBuilding(tile, x, z) ||
              (onSidewalk && onSidewalk(x, z)) ||
              (tile.trees || []).some(
                ([tx2, tz2]) => Math.abs(tx2 - x) < 6 && Math.abs(tz2 - z) < 6,
              )
            )
              continue;
            const hp = hash(((x * 5) | 0) * 131 + ((z * 3) | 0));
            props.palm.push({ x, y: 0, z, ry: hp * 6, s: 0.95 + hp * 0.3 });
            if (hp < 0.22)
              props.lamp.push({
                x: x - q.dx * 3,
                y: 0,
                z: z - q.dz * 3,
                ry: Math.atan2(-q.nx * side, -q.nz * side),
                s: 0.8,
              });
          }
      }
      // divided boulevards: a landscaped median between a one-way carriageway and its twin gets a royal-palm row + low shrubs
      if (
        !ys &&
        props &&
        r.oneway &&
        /trunk|primary|secondary/.test(r.kind) &&
        L > 40 &&
        roadDist
      ) {
        const ri = roadIndex(tile, true);
        for (let s2 = Math.max(8, trimA + 4); s2 < L - Math.max(8, trimB + 4); s2 += 13) {
          const q = sampleAt(fr, s2);
          let w = 0;
          for (let o = hw + 1.0; o <= hw + 16; o += 0.5) {
            const x = q.x - q.nx * o,
              z = q.z - q.nz * o;
            if (ri(x, z).gap < 0 || (isWater && isWater(x, z))) {
              w = o - hw;
              break;
            }
            if (onSidewalk && onSidewalk(x, z)) {
              w = -1;
              break;
            }
          }
          if (w < 3.2 || w > 16) continue;
          const o = hw + w / 2,
            x = q.x - q.nx * o,
            z = q.z - q.nz * o;
          if (insideBuilding(tile, x, z)) continue;
          props.palm.push({
            x,
            y: 0.02,
            z,
            ry: hash(((x * 5) | 0) + ((z * 3) | 0)) * 6,
            s: 1.0 + hash((x | 0) * 3) * 0.25,
            ave: 1,
          });
          if (w > 4.5)
            for (const d of [-4, 4]) {
              const bx = x + q.dx * d,
                bz = z + q.dz * d,
                hb = hash(((bx * 7) | 0) + ((bz * 11) | 0));
              props.blob.push({
                x: bx,
                y: 0.02,
                z: bz,
                ry: hb * 6,
                s: 0.8 + hb * 0.3,
                color: new THREE.Color().setHSL(0.25 + hb * 0.06, 0.4, 0.45 + hb * 0.12),
              });
            }
        }
      }
      // port roads: tall yard lamps + bollards; causeway fill: royal palm rows on the verges
      if (!ys && props) {
        const zn0 = zoneAt(r.pts[0][0], r.pts[0][1]);
        if (zn0 === 'port' && L > 40)
          for (const side of [-1, 1])
            for (let s2 = 25 + (side > 0 ? 0 : 35); s2 < L - 10; s2 += 100) {
              const q = sampleAt(fr, s2),
                o = side * (hw + 1.2),
                x = q.x + q.nx * o,
                z = q.z + q.nz * o;
              if (!(isWater && isWater(x, z)))
                props.signPost.push({
                  x,
                  y: 0,
                  z,
                  ry: Math.atan2(-q.nx * side, -q.nz * side) + Math.PI / 2,
                });
            } // yard speed / regulation signs
        if (zn0 === 'port')
          for (const side of [-1, 1])
            for (let s2 = 10 + (side > 0 ? 0 : 15); s2 < L - 5; s2 += 30) {
              const q = sampleAt(fr, s2),
                o = side * (hw + 0.8),
                x = q.x + q.nx * o,
                z = q.z + q.nz * o;
              if (isWater && isWater(x, z)) continue;
              props.lamp.push({ x, y: 0, z, ry: Math.atan2(-q.nx * side, -q.nz * side), s: 1.35 });
              props.hydrant.push({
                x: q.x + q.dx * 4 + q.nx * o,
                y: 0,
                z: q.z + q.dz * 4 + q.nz * o,
                ry: 0,
              });
            }
        const cw =
          !/service|footway|path/.test(r.kind) &&
          (zn0 === 'causeway' ||
            /Causeway|Venetian Way/.test(r.name || '') ||
            ISLAND_D.test(distAt(r.pts[r.pts.length >> 1][0], r.pts[r.pts.length >> 1][1])));
        if (cw)
          for (const side of [-1, 1])
            for (let s2 = 8 + (side > 0 ? 0 : 9); s2 < L - 4; s2 += 18) {
              const q = sampleAt(fr, s2),
                o = side * (hw + 2.4),
                x = q.x + q.nx * o,
                z = q.z + q.nz * o;
              if (
                isWater &&
                (isWater(x, z) || isWater(x + q.nx * side * 1.5, z + q.nz * side * 1.5))
              )
                continue;
              props.palm.push({
                x,
                y: 0,
                z,
                ry: hash(((x * 3) | 0) + ((z * 7) | 0)) * 6,
                s: 1.05,
                ave: 1,
              });
            }
        if (cw && L > 20) {
          const walk = pathIndex(tile),
            eh = hash((r.edgeId ?? r.id ?? 0) * 977 + 5);
          for (const side of [-1, 1]) {
            // guardrail only where the carriageway edge runs right along the water (no verge to stop in)
            let gA = -1;
            const longRun = (sEnd) =>
              sEnd - gA > 8 ||
              (!CLIP_OFF && ((gA <= 0.01 && trimA === 0) || (sEnd >= L - 0.01 && trimB === 0)));
            const flush = (sEnd) => {
              if (gA >= 0 && longRun(sEnd) && coll) {
                coll.tag = 'guardrail';
                sideWall(coll, fr, 0, side * (hw + 0.5), 0.8, 0, 0xffffff, -side, gA, sEnd);
              }
              if (gA >= 0 && longRun(sEnd) && B && B.guard) {
                const o = side * (hw + 0.5);
                sideWall(B.guard, fr, 0, o, 0.32, 0.42, 0xc8ccd0, -side, gA, sEnd);
                sideWall(B.guard, fr, 0, o, 0.32, 0.42, 0xb8bcc0, side, gA, sEnd);
                sideWall(B.guard, fr, 0, o + side * 0.08, 0.74, 0.0, 0x8a8f94, -side, gA, sEnd);
                for (let s3 = gA; s3 <= sEnd; s3 += 2) {
                  const q = sampleAt(fr, s3);
                  B.guard.addGeometry(
                    BOXG,
                    m4(
                      q.x + q.nx * (o + side * 0.12),
                      0.38,
                      q.z + q.nz * (o + side * 0.12),
                      Math.atan2(q.nx, q.nz),
                      0.1,
                      0.76,
                      0.1,
                    ),
                    0x7d8287,
                  );
                }
              }
              gA = -1;
            };
            // clipping sweep: a piece cut at a tile seam (trim 0) runs its rail right to the seam, so the neighbor tile's rail continues it
            // without a gap (the old 2 m end margin left a 4 m hole at every seam and dropped the short seam stubs)
            const gS = CLIP_OFF ? Math.max(2, trimA) : trimA,
              gE = L - (CLIP_OFF ? Math.max(2, trimB) : trimB);
            for (let s2 = gS; s2 < gE; s2 += 3) {
              const q = sampleAt(fr, s2),
                x = q.x + q.nx * side * (hw + 3.5),
                z = q.z + q.nz * side * (hw + 3.5);
              let wet = isWater && isWater(x, z);
              if (wet && !SEAMS_OLD) {
                const rx = q.x + q.nx * side * (hw + 0.62),
                  rz = q.z + q.nz * side * (hw + 0.62);
                if (isWater(rx, rz) || /sand|water/.test(String(surfAt(rx, rz)))) wet = false;
              } // r2-roads: the rail's own posts must stand on dry ground (no rail out in the water / on the beach)
              if (wet && gA < 0) gA = s2;
              else if (!wet && gA >= 0) flush(s2);
            }
            flush(gE);
            // bus stop where a sidewalk runs along the verge (one per long piece, right-hand side of travel per direction)
            if (L > 140 && eh < 0.6 && !props.realBus) {
              const s2 = L * (0.35 + eh * 0.3),
                q = sampleAt(fr, s2),
                o = side * (hw + 2.2),
                x = q.x + q.nx * o,
                z = q.z + q.nz * o;
              if (walk(x, z).d < 5 && !(isWater && isWater(x, z))) {
                props.shelter.push({
                  x,
                  y: gY0(x, z),
                  z,
                  ry: Math.atan2(-q.nx * side, -q.nz * side),
                });
                props.bin.push({ x: x + q.dx * 3, y: gY0(x, z), z: z + q.dz * 3, ry: 0, k: 1 });
                props.signPost.push({ x: x - q.dx * 3, y: gY0(x, z), z: z - q.dz * 3 });
              }
            }
          }
          // lamps along the at-grade causeway verges (trunk roads already get deck-edge lamps below)
          if (!/trunk|motorway/.test(r.kind))
            for (const side of [-1, 1])
              for (let s2 = 10 + (side > 0 ? 0 : 17); s2 < L - 6; s2 += 34) {
                const q = sampleAt(fr, s2),
                  o = side * (hw + 0.8),
                  x = q.x + q.nx * o,
                  z = q.z + q.nz * o;
                if (!(isWater && isWater(x, z)))
                  props.lamp.push({
                    x,
                    y: gY0(x, z),
                    z,
                    ry: Math.atan2(-q.nx * side, -q.nz * side),
                  });
              }
        }
      }
      // causeways / highways / bridges: lamp posts on the deck edge both sides; steel guardrails on at-grade trunk/motorway roads
      if ((ys || /trunk|motorway/.test(r.kind)) && !r.sidewalks) {
        const gA = trimA + 1,
          gB = L - trimB - 1;
        if (false && gB > gA + 2)
          for (const side of [-1, 1]) {
            // at-grade guardrails removed (blocked crossings / frontage roads)
            sideWall(B.guard, fr, 0, side * (hw + 0.25), 0.35, 0.45, 0xc8ccd0, -side, gA, gB);
            sideWall(B.guard, fr, 0, side * (hw + 0.25), 0.75, 0.0, 0x8a8f94, -side, gA, gB);
            if (coll) {
              coll.tag = 'guardrail';
              sideWall(coll, fr, 0, side * (hw + 0.25), 0.8, 0, 0xffffff, -side, gA, gB);
            }
          }
        if (props)
          for (const side of [-1, 1])
            for (let s = 12 + (side > 0 ? 0 : 20); s < L - 6; s += 40) {
              const q = sampleAt(fr, s, ys),
                onDeck = ys && q.y >= 1.0 && groundIndex(tile)(q.x, q.z, -0.5),
                o = side * (hw + (onDeck ? -BAR_W * 0.5 : 0.6));
              if (ys && !onDeck) continue;
              if (onDeck && elevIndex(tile)(q.x + q.nx * o, q.z + q.nz * o, q.y, r, 2.5)) continue; // lamp would stand on the neighbouring branch
              props.lamp.push({
                x: q.x + q.nx * o,
                y: q.y + (onDeck ? 0.05 + BAR_H : 0),
                z: q.z + q.nz * o,
                ry: Math.atan2(-q.nx * side, -q.nz * side),
              });
              if (!ys)
                props.pool.push({
                  x: q.x + q.nx * side * (hw - 1.2),
                  y: 0.05,
                  z: q.z + q.nz * side * (hw - 1.2),
                  s: 1.35,
                });
            }
      }
      // elevated deck: barriers, rails, fascia / retaining walls, soffit, piers (lamps sit on the barrier line)
      if (ys) deckDress(B, coll, fr, ys, r, hw, yRoad, tile, rA, rB);
    }
    setRoad([B.asphalt, B.lines, B.decals], null); // surfaces pass
    // intersections: filled discs + crosswalks; traffic signals at signalised nodes
    let nc = 0;
    for (const n of tile.nodes) {
      if (n.degree < 3) continue;
      if (++nc % 15 === 0) {
        if (flush) flush();
        yield;
      }
      const lv = nodeLevel(tile, n);
      if (!lv.kind) continue; // overpass crossing: the levels do not connect
      AUD.src = 'j' + (n.id ?? n.x + ',' + n.z);
      if (elevated) {
        const es = endsOf(tile).get(endKey([n.x, n.z])) || [],
          ow = es.filter((e) => owned(e.r)).length;
        if (
          ow &&
          (ow === es.length || safeCall(() => elevated.isGroundJunctionBlocked(n.id), false))
        )
          continue;
        lv.kind = 'ground';
        lv.y = 0;
      }
      const J = lv.kind === 'ground' ? junctionOf(n.id) : null;
      if (J) {
        // job 4: one outline with curb returns, same layer / texture / height as the approach ribbons (no stacked fills)
        fillPoly(
          B.asphalt,
          [J.poly],
          0.05,
          J.legs.every((l) => l.lane) ? LANE_TINT : 0xffffff,
          1 / 7,
        );
        curbGutters(B, J); // r2-roads: gutter pan around the curb returns
        if (coll) {
          coll.tag = 'junction';
          fillPoly(coll, [J.poly], 0.05, 0xffffff, 1);
        }
        const zn = J.zone,
          swB =
            M.promenade && B.promenade && /beach|nightlife/.test(zn)
              ? B.promenade
              : M.panels && B.panels && /downtown|business|brickell|commercial/.test(zn)
                ? B.panels
                : B.sidewalk;
        rampsInto(swB && !swB.empty ? swB : null, coll, J);
        drawWalkCorners(swB && !swB.empty ? swB : B.sidewalk, B.sidewalk, coll, J); // r2-roads: constant-width round walk corners
        if (B.lines) goreStripes(B, J);
        if (GM_ON && B.sidewalk && !B.sidewalk.empty)
          for (const c of J.corners) {
            // ground pass: curb returns along open corners between curbed legs (tree-lawn streets)
            if (
              c.kind !== 'fillet' ||
              !(J.legs[c.i].sw > 0 && J.legs[c.j].sw > 0) ||
              J.legs[c.i].lane ||
              J.legs[c.j].lane ||
              /service|track/.test(J.legs[c.i].kind + J.legs[c.j].kind)
            )
              continue;
            const m0 = c.arc[c.arc.length >> 1],
              dx0 = c.O[0] - m0[0],
              dz0 = c.O[1] - m0[1],
              d0 = Math.hypot(dx0, dz0) || 1;
            const midSlab = slabAt(tile, m0[0] + (dx0 / d0) * 1.0, m0[1] + (dz0 / d0) * 1.0);
            if (midSlab && SEAMS_OLD) continue;
            const col = new THREE.Color(0xc9c6bf),
              w = 0.3 / c.R;
            // r2-roads: per segment, so a slab that wraps only part of the return no longer leaves the rest of it without a curb (asphalt straight onto the dirt)
            const segSlab = (a, b) => {
              const mx = (a[0] + b[0]) / 2,
                mz = (a[1] + b[1]) / 2,
                dx = c.O[0] - mx,
                dz = c.O[1] - mz,
                d = Math.hypot(dx, dz) || 1;
              return slabAt(tile, mx + (dx / d) * 0.5, mz + (dz / d) * 0.5);
            };
            for (let k = 0; k < c.arc.length - 1; k++) {
              if (!SEAMS_OLD && segSlab(c.arc[k], c.arc[k + 1])) continue;
              const a = c.arc[k],
                b = c.arc[k + 1],
                ai = [a[0] + (c.O[0] - a[0]) * w, a[1] + (c.O[1] - a[1]) * w],
                bi = [b[0] + (c.O[0] - b[0]) * w, b[1] + (c.O[1] - b[1]) * w];
              quadUp(
                B.sidewalk,
                [a[0], CURB3D ? CURB - 0.009 : CURB - 0.004, a[1]],
                [b[0], CURB3D ? CURB - 0.009 : CURB - 0.004, b[1]],
                [bi[0], CURB3D ? CURB - 0.009 : CURB - 0.004, bi[1]],
                [ai[0], CURB3D ? CURB - 0.009 : CURB - 0.004, ai[1]],
                col,
                1 / 2.5,
              ); // r2-roads: under a slab that reaches the return
              if (CURB3D) {
                const ua = [a[0] - c.O[0], a[1] - c.O[1]],
                  ub = [b[0] - c.O[0], b[1] - c.O[1]],
                  la = Math.hypot(ua[0], ua[1]) || 1,
                  lb = Math.hypot(ub[0], ub[1]) || 1; // roads pass: poured curb round the return, berm behind
                curbLine(
                  B.sidewalk,
                  [a, b],
                  [
                    [ua[0] / la, ua[1] / la],
                    [ub[0] / lb, ub[1] / lb],
                  ],
                  { h: CURB3D ? CURB - 0.009 : CURB - 0.004, y0: 0.05, seed: k + J.node.id },
                );
                quadUp(
                  B.sidewalk,
                  [ai[0], CURB3D ? CURB - 0.009 : CURB - 0.004, ai[1]],
                  [bi[0], CURB3D ? CURB - 0.009 : CURB - 0.004, bi[1]],
                  [bi[0] - (ub[0] / lb) * 0.4, -0.03, bi[1] - (ub[1] / lb) * 0.4],
                  [ai[0] - (ua[0] / la) * 0.4, -0.03, ai[1] - (ua[1] / la) * 0.4],
                  _bermC,
                  1 / 2.5,
                );
                continue;
              }
              for (const [p, q] of [
                [a, b],
                [ai, bi],
              ]) {
                const ex = q[0] - p[0],
                  ez = q[1] - p[1],
                  L = Math.hypot(ex, ez) || 1;
                let nx = ez / L,
                  nz = -ex / L;
                const mx = (p[0] + q[0]) / 2,
                  mz = (p[1] + q[1]) / 2;
                const toO = (c.O[0] - mx) * nx + (c.O[1] - mz) * nz;
                if ((p === a) === toO > 0) {
                  nx = -nx;
                  nz = -nz;
                }
                const v = [
                  [p[0], 0, p[1]],
                  [q[0], 0, q[1]],
                  [q[0], CURB, q[1]],
                  [p[0], CURB, p[1]],
                ];
                for (const [sg, ord] of [
                  [1, [0, 1, 2, 0, 2, 3]],
                  [-1, [0, 2, 1, 0, 3, 2]],
                ])
                  for (const ii of ord)
                    B.sidewalk.vert(
                      v[ii][0],
                      v[ii][1],
                      v[ii][2],
                      nx * sg,
                      0,
                      nz * sg,
                      ii === 1 || ii === 2 ? L * 0.4 : 0,
                      v[ii][1] * 0.4,
                      col,
                    );
              }
            } // both windings: the face shows whichever way the arc runs
          }
        if (!GC_OFF && !GM_ON && B.sidewalk && !B.sidewalk.empty)
          for (const c of J.corners) {
            // open corners: the thin concrete edge strip follows the curb return
            const paved = () => {
              const m = c.arc[c.arc.length >> 1],
                dx = c.O[0] - m[0],
                dz = c.O[1] - m[1],
                d = Math.hypot(dx, dz) || 1;
              return slabAt(tile, m[0] + (dx / d) * 1.6, m[1] + (dz / d) * 1.6);
            };
            if (
              c.kind !== 'fillet' ||
              (J.legs[c.i].sw > 0 && J.legs[c.j].sw > 0 && paved()) ||
              /service|track/.test(J.legs[c.i].kind + J.legs[c.j].kind)
            )
              continue;
            if (M.shoulder && B.shoulder) {
              shoulderArc(B, c, J.legs[c.i].lane || J.legs[c.j].lane);
              continue;
            }
            if (J.legs[c.i].lane || J.legs[c.j].lane) {
              if (B.sand) {
                const col = new THREE.Color(0xa49a84);
                for (let k = 0; k < c.arc.length - 1; k++) {
                  const a = c.arc[k],
                    b = c.arc[k + 1],
                    wa = (0.9 + hash(a[0] * 3 + a[1]) * 0.8) / c.R,
                    wb = (0.9 + hash(b[0] * 3 + b[1]) * 0.8) / c.R;
                  quadUp(
                    B.sand,
                    [a[0], 0.03, a[1]],
                    [b[0], 0.03, b[1]],
                    [b[0] + (c.O[0] - b[0]) * wb, 0.03, b[1] + (c.O[1] - b[1]) * wb],
                    [a[0] + (c.O[0] - a[0]) * wa, 0.03, a[1] + (c.O[1] - a[1]) * wa],
                    col,
                    1 / 6,
                  );
                }
              }
              continue;
            }
            const col = new THREE.Color(0xd9d5cb),
              w = 0.32 / c.R;
            for (let k = 0; k < c.arc.length - 1; k++) {
              const a = c.arc[k],
                b = c.arc[k + 1],
                ai = [a[0] + (c.O[0] - a[0]) * w, a[1] + (c.O[1] - a[1]) * w],
                bi = [b[0] + (c.O[0] - b[0]) * w, b[1] + (c.O[1] - b[1]) * w];
              quadUp(
                B.sidewalk,
                [a[0], 0.053, a[1]],
                [b[0], 0.053, b[1]],
                [bi[0], 0.053, bi[1]],
                [ai[0], 0.053, ai[1]],
                col,
                1 / 2.5,
              );
            }
          }
      } else {
        const R = n.width / 2 + (lv.kind === 'deck' ? 0 : JUNC_PAD),
          seg = 24,
          ring = [];
        for (let k = 0; k < seg; k++) {
          const a = (k / seg) * Math.PI * 2;
          ring.push([n.x + Math.cos(a) * R, n.z + Math.sin(a) * R]);
        }
        fillPoly(B.junction || B.asphalt, [ring], lv.y + 0.055, 0xffffff, 1 / 7);
        if (coll) {
          coll.tag = 'junction';
          fillPoly(coll, [ring], lv.y + 0.05, 0xffffff, 1);
        }
      }
      if (lv.kind === 'deck') continue; // ramp split / merge on the deck: no crossings, signals or street signs
      const highwayNode = n.dirs.some((d) => /motorway|trunk/.test(d[3]));
      for (const [dx, dz, w, kind] of n.dirs) {
        if (/service|footway/.test(kind) || highwayNode) continue; // no zebra crossings on causeway / highway merges
        {
          const e = (endsOf(tile).get(endKey([n.x, n.z])) || []).find(
            (q) => q.dx * dx + q.dz * dz > 0.95,
          );
          if (e && roadProfile(e.r, tile).ys) continue;
        } // ramp approach
        const rx = -dz,
          rz = dx,
          d0 = n.width / 2 + 0.6;
        if (!J && (JOB4_OFF || !CLIP_PAINT))
          for (let o = -w / 2 + 0.4; o < w / 2 - 0.3; o += 1.1) {
            // job 4: the old disc crosswalks overlapped each other on 5+ leg discs; deck / ramp discs get none
            const a = [n.x + dx * d0 + rx * o, 0.065, n.z + dz * d0 + rz * o],
              b = [a[0] + rx * 0.55, 0.065, a[2] + rz * 0.55];
            const c = [b[0] + dx * 3, 0.065, b[2] + dz * 3],
              d = [a[0] + dx * 3, 0.065, a[2] + dz * 3];
            quadUp(B.marks, a, b, c, d, new THREE.Color(0xf4f4f0), 1);
          }
        if (props && !props._signedNode) props._signedNode = new Set();
        // Street-name blades are placed by src/world/signs (keys-sign track), mounted on their own posts and readable from
        // both sides. These older corner blades floated beside their poles (cleanProps moves the pole off the walkway but
        // not the signs) and their single double-sided plane showed mirrored text from behind ("teertS ht01").
        if (false && props && !props._signedNode.has(n.id)) {
          // corner post with blade signs naming the two crossing streets
          const named = [];
          for (const d of n.dirs) if (d[4] && !named.some((m) => m[4] === d[4])) named.push(d);
          if (named.length >= 2) {
            props._signedNode.add(n.id);
            const d1 = named[0],
              d2 = named[1];
            let cx2 = d1[0] + d2[0],
              cz2 = d1[1] + d2[1];
            const cl = Math.hypot(cx2, cz2) || 1;
            cx2 /= cl;
            cz2 /= cl;
            const R2 = n.width / 2 + 2.2,
              px = n.x + cx2 * R2 * 1.25,
              pz = n.z + cz2 * R2 * 1.25;
            props.signPost.push({ x: px, y: CURB, z: pz });
            props.signs.push(
              { x: px, y: CURB + 3.05, z: pz, dx: d1[0], dz: d1[1], name: d1[4] },
              { x: px, y: CURB + 3.35, z: pz, dx: d2[0], dz: d2[1], name: d2[4] },
            );
          }
        }
        if (n.signal && props && J && SK) continue; // job-4 junction: full signal layout below (signals.js)
        if (n.signal && props) {
          // mast at the near-right corner of each approach, arm over the lanes
          const px = n.x + dx * (d0 + 4) - rx * (w / 2 + 1.2) * -1,
            pz = n.z + dz * (d0 + 4) - rz * (w / 2 + 1.2) * -1;
          props.mast.push({ x: px, y: CURB, z: pz, ry: Math.atan2(-rz, rx) });
          const fr2 = Math.atan2(dx, dz);
          for (const k of [2.8, 5.6])
            props.sig.push({ x: px - rx * k, y: CURB + 5.6, z: pz - rz * k, ry: fr2 });
        }
      }
      if (n.signal && props && J && SK) placeSignals(props, n, J, tile);
    }
  }

  const PALM_ZONES = new Set([
    'beach',
    'nightlife',
    'park',
    'residential',
    'downtown',
    'business',
    'causeway',
    'commercial',
    'brickell',
    'midtown',
    'arts',
    'edgewater',
    'overtown',
  ]);
  const DOOR_W = 1.9,
    DOOR_H = 2.75,
    GLASS_TOP = 3.25;
  // contract fields for INTERIORS: interior clear height, door offset along the facade (to the right when looking OUT of the shop), door width
  function annotateStorefronts(list, GF) {
    for (const f of list) {
      if (f.doorW !== undefined && f._gf === GF) continue;
      const fx = f.fx ?? f.x,
        fz = f.fz ?? f.z,
        fc = f.facing || 0,
        rx = -Math.cos(fc),
        rz = Math.sin(fc);
      f.h = +(GF - 0.02 - (f.y || 0)).toFixed(2);
      f.doorW = DOOR_W;
      f.doorH = DOOR_H;
      f.doorX = +((fx - f.x) * rx + (fz - f.z) * rz).toFixed(2);
      f._gf = GF;
    }
  }
  // transparent shopfront: kick plate, glass panes + transom, header band; door opening left clear
  // shop-front dressing: striped canvas awning (livery per shop), granite planters with clipped topiary by the door
  const AWN = [0x8c2f2a, 0x2f5a52, 0x283a52, 0x6b4a2a, 0x7a2f45, 0x2e5f6e, 0x3f4a2a];
  let lodDressing = false; // true while lodBuildings builds a mid / far chunk
  // stream hitches (Nov 19): a building with many shop fronts took up to ~470 ms in one streaming step (3D awnings).
  // While a streaming generator builds a building, its shop fronts are queued here and then built one by one with
  // time-based yields (drainFronts). Same geometry in the same batches; only the vertex order differs.
  let frontQueue = null;
  // builds one building, then its queued shop fronts in time slices; `lift` is the batches' relief lift ({ k })
  // (lodDressing is set only around synchronous calls: other tile builds run between the yields)
  function* buildBuildingSliced(B, b, opts, lift, q, lod) {
    q.length = 0;
    const k = lift ? lift.k : null;
    frontQueue = q;
    lodDressing = lod;
    try {
      buildBuilding(B, b, opts);
    } finally {
      frontQueue = null;
      lodDressing = false;
    }
    if (!q.length) return;
    let tY = performance.now();
    for (let i = 0; i < q.length; i++) {
      if (performance.now() - tY > 4) {
        yield;
        tY = performance.now();
      }
      const e = q[i];
      if (lift) lift.k = k;
      lodDressing = lod;
      try {
        glassFront(e[0], e[1], e[2], e[3], e[4], e[5], e[6]);
      } catch (err) {
        console.warn('[city-look] shop front failed', err);
      } finally {
        lodDressing = false;
      }
    }
    q.length = 0;
  }
  function shopFrontDress(B, p, tx, tz, nx, nz, s0, s1, y0, top, GF, fx, fz, props, lot = false) {
    const hA = hash(((fx * 11) | 0) * 31 + ((fz * 17) | 0) * 7 + 3);
    // stream hitches (Nov 19): mid / far LOD chunks (350 m and more away) get the flat awning; the scalloped 3D one cost up
    // to ~400 ms in one streaming step for a building with many shop fronts, for detail too small to see there
    const A3 = AWN3D && !lodDressing;
    let drew = false;
    const P = (sv, o, y) => [p[0] + tx * sv + nx * o, y, p[1] + tz * sv + nz * o];
    const AW = isFB(B) ? awningView(B.fac) : B.trim; // canvas flagged for the facade shader's night bounce
    // r2-perf: same 12 vertices in the same order, without the nested array literals per call (~0.9 GB of garbage per 40 s drive)
    const q2v = (q, n, col) =>
      AW.vert(q[0], q[1], q[2], nx * 0.5 * n, 0.85 * n, nz * 0.5 * n, 0, 0, col);
    const quad2 = (A, Bq, C, D, col) => {
      q2v(A, 1, col);
      q2v(Bq, 1, col);
      q2v(C, 1, col);
      q2v(A, 1, col);
      q2v(C, 1, col);
      q2v(D, 1, col);
      q2v(A, -1, col);
      q2v(C, -1, col);
      q2v(Bq, -1, col);
      q2v(A, -1, col);
      q2v(D, -1, col);
      q2v(C, -1, col);
    };
    if (hA < 0.85 && s1 - s0 > 1.5) {
      const cA = new THREE.Color(AWN[((hA * 1.17 * AWN.length) | 0) % AWN.length]);
      const cB = hA < 0.5 ? new THREE.Color(0xe9e3d3) : cA.clone().multiplyScalar(0.72);
      const yT = Math.min(GF - 0.15, top + (lot && A3 ? 0.12 : 0.5)),
        yB = Math.max(top - (lot && A3 ? 0.48 : 0.35), y0 + 2.35),
        dep = 1.3 + hA * 0.4; // shops pass: on shop lots the awning hangs right over the glass, the sign band above stays readable
      const n = Math.max(2, Math.round((s1 - s0 + 0.4) / 0.45));
      if (A3) {
        // shops pass: 3D canvas: sags between the frame ribs, one scallop per stripe on the valance (both sides drawn)
        const S0 = s0 - 0.2,
          SL = s1 - s0 + 0.4,
          ribs = Math.max(2, Math.round(SL / 1.25)),
          sagA = 0.05 + hA * 0.03,
          NU = 3,
          NV = 5,
          VH = 0.2,
          SC = 0.075;
        const at = (sv, t) => {
          const ru = (((sv - S0) / SL) * ribs) % 1,
            sg = sagA * Math.sin(Math.PI * t) * (0.5 - 0.5 * Math.cos(2 * Math.PI * ru));
          return P(sv, 0.03 + (dep - 0.03) * t - sg * 0.3, yT + (yB - yT) * t - sg);
        };
        for (let k = 0; k < n; k++) {
          const a = S0 + (SL * k) / n,
            b = S0 + (SL * (k + 1)) / n,
            col = k % 2 ? cB : cA;
          for (let i = 0; i < NU; i++) {
            const u0 = a + ((b - a) * i) / NU,
              u1 = a + ((b - a) * (i + 1)) / NU;
            for (let j = 0; j < NV; j++)
              quad2(
                at(u0, j / NV),
                at(u1, j / NV),
                at(u1, (j + 1) / NV),
                at(u0, (j + 1) / NV),
                col,
              );
          }
          for (let i = 0; i < 6; i++) {
            const f0 = i / 6,
              f1 = (i + 1) / 6,
              h0 = VH + SC * Math.sqrt(Math.max(0, 1 - (2 * f0 - 1) ** 2)),
              h1 = VH + SC * Math.sqrt(Math.max(0, 1 - (2 * f1 - 1) ** 2)),
              x0 = a + (b - a) * f0,
              x1 = a + (b - a) * f1;
            quad2(
              P(x0, dep, yB),
              P(x1, dep, yB),
              P(x1, dep + 0.004, yB - h1),
              P(x0, dep + 0.004, yB - h0),
              col,
            );
          }
        }
        for (let k = 0; k <= ribs; k++) {
          const sv = S0 + (SL * k) / ribs,
            A = P(sv, 0.04, yT - 0.025),
            Bq = P(sv, dep, yB - 0.025); // frame ribs under the canvas
          const L = Math.hypot(dep, yT - yB),
            Zd = new THREE.Vector3((nx * dep) / L, (yB - yT) / L, (nz * dep) / L),
            Xd = new THREE.Vector3(tx, 0, tz),
            Yd = new THREE.Vector3().crossVectors(Zd, Xd);
          B.trim.addGeometry(
            BOXG,
            new THREE.Matrix4()
              .makeBasis(
                Xd.multiplyScalar(0.025),
                Yd.multiplyScalar(0.025),
                Zd.clone().multiplyScalar(L),
              )
              .setPosition((A[0] + Bq[0]) / 2, (A[1] + Bq[1]) / 2, (A[2] + Bq[2]) / 2),
            new THREE.Color(0x2a2c30),
          );
        }
      } else
        for (let k = 0; k < n; k++) {
          const a = s0 - 0.2 + ((s1 - s0 + 0.4) * k) / n,
            b = s0 - 0.2 + ((s1 - s0 + 0.4) * (k + 1)) / n,
            col = k % 2 ? cB : cA;
          quad2(P(a, 0.03, yT), P(b, 0.03, yT), P(b, dep, yB), P(a, dep, yB), col);
          quad2(P(a, dep, yB), P(b, dep, yB), P(b, dep, yB - 0.3), P(a, dep, yB - 0.3), col);
        }
      for (const sv of [s0 - 0.2, s1 + 0.2]) {
        // side cheeks
        const A = P(sv, 0.03, yT),
          Bq = P(sv, dep, yB),
          C = P(sv, dep, yB - (A3 ? 0.2 : 0.3));
        for (const q of [A, Bq, C, A, C, Bq]) AW.vert(q[0], q[1], q[2], tx, 0, tz, 0, 0, cA);
      }
      drew = true;
    }
    if (props && hash(((fx * 5) | 0) + ((fz * 13) | 0) * 3) < 0.75) {
      const pc = new THREE.Color(hA < 0.5 ? 0x4a4c4e : 0x8a857c);
      for (const sv of [s0 + 0.45, s1 - 0.45]) {
        const c = P(sv, 0.75, y0);
        B.trim.addGeometry(
          BOXG,
          mat4(c[0], y0 + 0.32, c[2], Math.atan2(tx, tz), 0.62, 0.64, 0.62),
          pc,
        );
        props.blob.push({
          x: c[0],
          y: y0 + 0.62,
          z: c[2],
          ry: hA * 9,
          s: 0.62 + hA * 0.2,
          color: new THREE.Color().setHSL(0.27 + hA * 0.05, 0.42, 0.3),
        });
        if (hA > 0.6) props.flower.push({ x: c[0], y: y0 + 0.66, z: c[2], ry: hA * 5, s: 0.5 });
      }
    }
    return drew;
  }
  // stone cornice at the roof line and a string course over the ground floor (near and mid LOD; far keeps the plain parapet)
  function corniceBands(B, b, outer, y0, h, FS, lod) {
    if (lod === 2 || outer.length > 40 || h < 6) return;
    const stone = new THREE.Color(FS.tint).lerp(new THREE.Color(0xe2dccf), 0.55);
    const heavy =
      FS.parapet === 'cornice' ||
      FS.fam === 'stoneBank' ||
      FS.fam === 'brickRow' ||
      FS.fam === 'precast';
    const d = heavy ? 0.42 : 0.2;
    const ring = scalePoly(outer, b.cx, b.cz, d),
      ring2 = scalePoly(outer, b.cx, b.cz, d * 0.55);
    wallStrip(B.trim, ring, h - (heavy ? 0.8 : 0.45), h - 0.1, 4, 4, stone);
    fillPolyDown(B.trim, [ring], h - (heavy ? 0.8 : 0.45), stone.clone().multiplyScalar(0.8));
    if (heavy) {
      wallStrip(B.trim, ring2, h - 1.25, h - 0.8, 4, 4, stone.clone().multiplyScalar(0.94));
      fillPolyDown(B.trim, [ring2], h - 1.25, stone.clone().multiplyScalar(0.75));
    }
    if (h > 9.5 && y0 < 0.5) {
      // string course over the ground floor
      const gr = scalePoly(outer, b.cx, b.cz, 0.12),
        gy =
          4.2 +
          (CLIP_OFF ? 0 : Math.floor(hash(((b.cx * 7) | 0) * 131 + ((b.cz * 13) | 0)) * 5) * 0.06); // clipping sweep: neighbors' string courses meet at party walls: never at the same height (z-fight)
      wallStrip(B.trim, gr, gy - 0.05, gy + 0.28, 4, 4, stone);
      fillPolyDown(B.trim, [gr], gy - 0.05, stone.clone().multiplyScalar(0.8));
      capPoly(B.trim, gr, gy + 0.28, stone);
    }
  }
  // ground-floor shop bays drawn by the facade shader (no mapped shop lot): awnings and planters on the street-facing bays
  const _white = new THREE.Color(1, 1, 1);
  // r8 (user: downtown ground floors look flat, no signs): tenant signs on commercial ground floors. On each street-facing face
  // (8 m or longer) one to three fascia boards with made-up brand lettering sit in the wall band just above the ground floor
  // (GF + 0.1 .. GF + 0.62, under the first-floor sills), boxed out 14 cm with a lit lettered face (src/world/city/shopSigns.js)
  const SIGN_ZONES =
    /downtown|business|brickell|commercial|midtown|arts|edgewater|overtown|nightlife|retail|mixed|beach|tourist|havana/;
  function fasciaSigns(B, outer, y0, GF, seed, zone, skip = null) {
    if (!B.signs || !B.trim || !SIGN_ZONES.test(String(zone || ''))) return;
    const A = shopSignAtlas(),
      ya = GF + 0.34,
      yb = GF + 0.86; // above the string course / ledge over the shop fronts (GF .. GF + 0.3, 0.34 deep)
    const pip = (x, z) => {
      let c = false;
      for (let a = 0, b2 = outer.length - 1; a < outer.length; b2 = a++) {
        const xa = outer[a][0],
          za = outer[a][1],
          xb = outer[b2][0],
          zb = outer[b2][1];
        if (za > z !== zb > z && x < ((xb - xa) * (z - za)) / (zb - za) + xa) c = !c;
      }
      return c;
    };
    for (let i = 0; i < outer.length; i++) {
      let p = outer[i],
        q = outer[(i + 1) % outer.length];
      if (pip((p[0] + q[0]) / 2 - (q[1] - p[1]) * 0.05, (p[1] + q[1]) / 2 + (q[0] - p[0]) * 0.05)) {
        const t0 = p;
        p = q;
        q = t0;
      } // the sign faces out of the footprint whatever the ring winding
      const dx = q[0] - p[0],
        dz = q[1] - p[1],
        L = Math.hypot(dx, dz);
      if (L < 8) continue;
      const tx = dx / L,
        tz = dz / L,
        nx = -tz,
        nz = tx;
      if (roadDist && roadDist(p[0] + dx / 2 + nx * 3, p[1] + dz / 2 + nz * 3) > 14) continue;
      if (
        skip &&
        skip.some((o) => {
          const ux = o.x - p[0],
            uz = o.z - p[1],
            u = ux * tx + uz * tz,
            v = ux * nx + uz * nz;
          return u > -1 && u < L + 1 && Math.abs(v) < 2.5;
        })
      )
        continue; // shop fronts with their own banners
      const nS = Math.min(3, Math.max(1, Math.floor(L / 12))),
        ry = Math.atan2(-tz, tx);
      for (let k = 0; k < nS; k++) {
        const hk = hash(seed * 59 + i * 17 + k * 5);
        if (hk > 0.8) continue;
        const sm = (L * (k + 0.5)) / nS,
          hw = Math.min(L / nS / 2 - 0.6, 1.6 + hk * 1.6);
        if (hw < 1) continue;
        const bc = new THREE.Color(AWN[((hk * 9.7 * AWN.length) | 0) % AWN.length]).multiplyScalar(
          0.55,
        );
        B.trim.addGeometry(
          BOXG,
          m4(
            p[0] + tx * sm + nx * 0.19,
            (ya + yb) / 2,
            p[1] + tz * sm + nz * 0.19,
            ry,
            hw * 2 + 0.14,
            yb - ya + 0.1,
            0.38,
          ),
          bc,
        ); // boxed sign, proud of the ledge
        const o = 0.385,
          Pt = (sv, y) => [p[0] + tx * sv + nx * o, y, p[1] + tz * sv + nz * o],
          h2 = Math.min(hw, (yb - ya) * 4);
        signQuad(
          B.signs,
          A,
          (hash(seed * 43 + i * 11 + k * 3) * A.n) | 0,
          [
            Pt(sm - h2, ya + 0.02),
            Pt(sm + h2, ya + 0.02),
            Pt(sm + h2, yb - 0.02),
            Pt(sm - h2, yb - 0.02),
          ],
          [nx, 0, nz],
          _white,
        );
      }
    }
  }
  function streetShopDress(B, outer, y0, GF, G, seed, props) {
    const top = Math.min(GLASS_TOP, GF - 0.35);
    for (let i = 0; i < outer.length; i++) {
      const p = outer[i],
        q = outer[(i + 1) % outer.length],
        dx = q[0] - p[0],
        dz = q[1] - p[1],
        L = Math.hypot(dx, dz);
      if (L < 4) continue;
      const tx = dx / L,
        tz = dz / L,
        nx = -tz,
        nz = tx;
      const mx = p[0] + dx / 2 + nx * 3,
        mz = p[1] + dz / 2 + nz * 3;
      if (roadDist && roadDist(mx, mz) > 14) continue; // only the faces that front a street
      const nb = Math.max(1, Math.round(L / G.bayW)),
        bw = L / nb;
      {
        // real depth at street level: stone pilasters between the bays, a granite kick plate under each window, sign boards and a
        // projecting ledge over the shop fronts (the glass reads recessed behind them)
        const ry = Math.atan2(-tz, tx),
          hS = hash(seed * 17 + i * 3),
          base = G.tint ? new THREE.Color(G.tint) : new THREE.Color(0xd8d2c6);
        const stone = base
            .clone()
            .lerp(new THREE.Color([0xd9d3c7, 0xc9c1b4, 0xb8b2a8, 0xe4ddd0][(hS * 4) | 0]), 0.65),
          granite = new THREE.Color([0x2e3034, 0x3b352f, 0x4a4743][(hS * 3) | 0]);
        const box = (s0, s1, ya, yb, d, col) => {
          const sm = (s0 + s1) / 2;
          B.trim.addGeometry(
            BOXG,
            m4(
              p[0] + tx * sm + (nx * d) / 2,
              (ya + yb) / 2,
              p[1] + tz * sm + (nz * d) / 2,
              ry,
              s1 - s0,
              yb - ya,
              d,
            ),
            col,
          );
        };
        for (let k = 0; k <= nb; k++) {
          const sv = Math.min(L - 0.26, Math.max(0.26, k * bw));
          box(sv - 0.26, sv + 0.26, y0, GF - 0.04, 0.24, stone);
          box(sv - 0.3, sv + 0.3, y0, y0 + 0.5, 0.3, stone.clone().multiplyScalar(0.86));
        }
        box(0, L, GF - 0.04, GF + 0.3, 0.34, stone.clone().multiplyScalar(0.93)); // ledge over the shop fronts
        for (let k = 0; k < nb; k++) {
          const sA = k * bw + 0.26,
            sB = (k + 1) * bw - 0.26;
          if (sB - sA < 1.2) continue;
          box(sA, sB, y0, y0 + 0.42, 0.07, granite); // kick plate
          const hB = hash(seed * 23 + i * 11 + k);
          if (hB < 0.55) {
            const sc = new THREE.Color(
              AWN[((hB * 7.3 * AWN.length) | 0) % AWN.length],
            ).multiplyScalar(0.8);
            box(sA + 0.1, sB - 0.1, top + 0.06, Math.min(GF - 0.12, top + 0.62), 0.1, sc);
            box(
              sA + 0.35,
              sB - 0.35,
              top + 0.18,
              Math.min(GF - 0.24, top + 0.5),
              0.12,
              sc.clone().lerp(new THREE.Color(0xf2ece0), 0.75),
            );
            if (B.signs) {
              // r8: made-up brand lettering on the panel (src/world/city/shopSigns.js), never wider than 8:1
              const A = shopSignAtlas(),
                ya = top + 0.2,
                yb = Math.min(GF - 0.26, top + 0.48),
                hh = yb - ya,
                wMax = hh * 8,
                sm = (sA + sB) / 2,
                hw = Math.min((sB - sA - 0.8) / 2, wMax / 2),
                o = 0.125;
              if (hw > 0.4 && hh > 0.12) {
                const Pt = (sv, y) => [p[0] + tx * sv + nx * o, y, p[1] + tz * sv + nz * o];
                signQuad(
                  B.signs,
                  A,
                  (hash(seed * 41 + i * 13 + k * 7) * A.n) | 0,
                  [Pt(sm - hw, ya), Pt(sm + hw, ya), Pt(sm + hw, yb), Pt(sm - hw, yb)],
                  [nx, 0, nz],
                  _white,
                );
              }
            }
          }
        } // sign board with a lighter panel
      }
      for (let k = 0; k < nb; k++) {
        const sA = k * bw + 0.35,
          sB = (k + 1) * bw - 0.35;
        if (sB - sA < 1.6) continue;
        const cx = p[0] + (tx * (sA + sB)) / 2,
          cz = p[1] + (tz * (sA + sB)) / 2;
        if (hash(seed * 31 + i * 7 + k) < 0.6)
          shopFrontDress(B, p, tx, tz, nx, nz, sA, sB, y0, top, GF, cx, cz, props);
        if (B.roomGlass && B.roomGlass.w)
          roomPane(
            B.roomGlass,
            p,
            tx,
            tz,
            nx,
            nz,
            sA + 0.12,
            sB - 0.12,
            y0 + 0.5,
            top - 0.06,
            hash(seed * 13 + i * 5 + k),
          );
      }
    }
  }
  // road surface as lengthwise strips: wheel tracks slightly lighter (polished by tires), a faint oil drip line mid-lane;
  // same world uv as one ribbon, so the texture stays continuous
  function roadStrips(batch, fr, ys, hw, y, sA, sB, r) {
    const lanes = Math.max(1, Math.round(r.lanes || (hw * 2) / 3.4));
    const lw = (hw * 2) / lanes;
    if (lw < 2.6 || /service|track|path|footway/.test(r.kind || '')) {
      ribbon(batch, fr, ys, -hw, hw, y, 0xffffff, 1 / 7, sA, sB);
      return;
    }
    const cuts = [[-hw, 1]];
    for (let k = 0; k < lanes; k++) {
      const c = -hw + lw * (k + 0.5);
      for (const [o0, o1, col] of JOB4_OFF
        ? [
            [c - 1.15, c - 0.6, 1.11],
            [c - 0.6, c - 0.12, 1],
            [c - 0.12, c + 0.12, 0.9],
            [c + 0.12, c + 0.6, 1],
            [c + 0.6, c + 1.15, 1.11],
          ]
        : [
            [c - 1.15, c - 0.6, 1.035],
            [c - 0.6, c - 0.12, 1],
            [c - 0.12, c + 0.12, 0.965],
            [c + 0.12, c + 0.6, 1],
            [c + 0.6, c + 1.15, 1.035],
          ])
        cuts.push([o0, col], [o1, 1]); // job 4: subtle tire polish / drip line (bands read as stripes on the calmer asphalt)
    }
    cuts.push([hw, 1]);
    cuts.sort((p, q) => p[0] - q[0]);
    const col = new THREE.Color();
    for (let i = 0; i < cuts.length - 1; i++) {
      const o0 = Math.max(-hw, cuts[i][0]),
        o1 = Math.min(hw, cuts[i + 1][0]);
      if (o1 - o0 < 0.02) continue;
      col.setScalar(cuts[i][1]);
      ribbon(batch, fr, ys, o0, o1, y, col, 1 / 7, sA, sB);
    }
  }
  // one interior-mapped shop pane (uv 0..1 across the glass); the room kind and light level ride in aWear
  const ROOM_TINT = [0x8c7c66, 0x7a6e60, 0x968a76, 0x6e6252, 0x857866, 0x7c7468]; // mid-tone walls: the room's light and goods carry the read, not a blown-out box
  function roomPane(rb, p, tx, tz, nx, nz, sa, sb, ya, yb, h) {
    if (sb - sa < 0.8 || yb - ya < 0.8) return;
    const qn = globalThis.game?.quality?.name;
    if (qn === 'medium' || qn === 'low') return; // no room panes at all on the cheaper presets
    const o = 0.04,
      col = new THREE.Color(ROOM_TINT[(h * ROOM_TINT.length) | 0]);
    const wear = (1 + ((h * 977) % 1) * 4.99) | 0;
    const w = wear + 0.35 + 0.6 * ((h * 131) % 1);
    const A = [p[0] + tx * sa + nx * o, p[1] + tz * sa + nz * o],
      Bq = [p[0] + tx * sb + nx * o, p[1] + tz * sb + nz * o];
    for (const [x, y, z, u, v] of [
      [A[0], ya, A[1], 0, 0],
      [Bq[0], ya, Bq[1], 1, 0],
      [Bq[0], yb, Bq[1], 1, 1],
      [A[0], ya, A[1], 0, 0],
      [Bq[0], yb, Bq[1], 1, 1],
      [A[0], yb, A[1], 0, 1],
    ]) {
      rb.vert(x, y, z, nx, 0, nz, u, v, col);
      rb.w.push(w);
    }
  }
  function glassFront(B, outer, f, y0, GF, bColor, props = null) {
    const fx = f.fx ?? f.x,
      fz = f.fz ?? f.z;
    let best = null;
    for (let i = 0; i < outer.length; i++) {
      const p = outer[i],
        q = outer[(i + 1) % outer.length],
        dx = q[0] - p[0],
        dz = q[1] - p[1],
        L = Math.hypot(dx, dz);
      if (L < 1) continue;
      const tx = dx / L,
        tz = dz / L,
        sP = (fx - p[0]) * tx + (fz - p[1]) * tz,
        d = Math.abs((fx - p[0]) * -tz + (fz - p[1]) * tx);
      if (sP > -0.5 && sP < L + 0.5 && (!best || d < best.d)) best = { p, tx, tz, L, s: sP, d };
    }
    if (!best || best.d > 1.5) return;
    const { p, tx, tz, L, s } = best,
      nx = -tz,
      nz = tx,
      half = Math.min(Math.max(DOOR_W + 1, f.w || 6), L - 0.2) / 2;
    const s0 = Math.max(0.1, s - half),
      s1 = Math.min(L - 0.1, s + half),
      d0 = s - DOOR_W / 2,
      d1 = s + DOOR_W / 2;
    const q = (batch, sa, sb, ya, yb, col, off = 0) => {
      if (sb - sa < 0.01 || yb - ya < 0.01) return;
      const ax = p[0] + tx * sa + nx * off,
        az = p[1] + tz * sa + nz * off,
        bx = p[0] + tx * sb + nx * off,
        bz = p[1] + tz * sb + nz * off;
      batch.vert(ax, ya, az, nx, 0, nz, 0, 0, col);
      batch.vert(bx, ya, bz, nx, 0, nz, 0, 0, col);
      batch.vert(bx, yb, bz, nx, 0, nz, 0, 0, col);
      batch.vert(ax, ya, az, nx, 0, nz, 0, 0, col);
      batch.vert(bx, yb, bz, nx, 0, nz, 0, 0, col);
      batch.vert(ax, yb, az, nx, 0, nz, 0, 0, col);
    };
    const kick = new THREE.Color(0x2e2e30),
      frame = new THREE.Color(0x1f2124),
      header = bColor.clone().lerp(new THREE.Color(0xffffff), 0.35),
      gl = new THREE.Color(0xffffff);
    const top = Math.min(GLASS_TOP, GF - 0.35);
    for (const [a, b] of [
      [s0, d0],
      [d1, s1],
    ]) {
      q(B.trim, a, b, y0, y0 + 0.45, kick);
      q(B.shopGlass, a, b, y0 + 0.45, top, gl);
    }
    q(B.shopGlass, d0, d1, Math.min(DOOR_H, top), top, gl);
    q(B.trim, s0, s1, top, GF, header);
    // slim frames (slightly proud of the glass)
    for (const sv of [s0, d0, d1, s1]) q(B.trim, sv - 0.05, sv + 0.05, y0, top, frame, 0.03);
    f.shellAwning = shopFrontDress(B, p, tx, tz, nx, nz, s0, s1, y0, top, GF, fx, fz, props, true); // shops pass: the V2 interior front skips its own awning where the shell has one
    q(B.trim, s0, s1, top - 0.06, top, frame, 0.03);
    q(B.trim, d0, d1, DOOR_H - 0.06, DOOR_H, frame, 0.03);
    if (B.shopRooms && B.shopRooms.w) {
      // shops pass: a painted room behind the glass (src/world/shops/roomGlass.js), hidden where a real interior is shown
      const rk = roomKind(f.kind),
        hh = hash(((fx * 13) | 0) * 7 + ((fz * 3) | 0)),
        w = rk + 0.35 + 0.6 * hh,
        col = new THREE.Color(ROOM_TINT[(hh * ROOM_TINT.length) | 0]),
        o = -0.25;
      const A = [p[0] + tx * (s0 + 0.05) + nx * o, p[1] + tz * (s0 + 0.05) + nz * o],
        Bq = [p[0] + tx * (s1 - 0.05) + nx * o, p[1] + tz * (s1 - 0.05) + nz * o],
        ya = y0 + 0.05,
        yb = top;
      for (const [x, y, z, u, v] of [
        [A[0], ya, A[1], 0, 0],
        [Bq[0], ya, Bq[1], 1, 0],
        [Bq[0], yb, Bq[1], 1, 1],
        [A[0], ya, A[1], 0, 0],
        [Bq[0], yb, Bq[1], 1, 1],
        [A[0], yb, A[1], 0, 1],
      ]) {
        B.shopRooms.vert(x, y, z, nx, 0, nz, u, v, col);
        B.shopRooms.w.push(w);
      }
    }
  }
  const NULL_BATCH = { vert() {}, addGeometry() {}, hquad() {}, empty: true };
  const NULLB = new Proxy({}, { get: () => NULL_BATCH });
  // fixed ground stack (m): water -0.12 < land base -0.05 < land 0 < sand/dirt 0.01 < grass 0.02 < plazas/parking/wood 0.03 < road 0.05 < junction 0.055 < markings 0.065 < decals 0.07; sidewalks raised 0.15.
  // Each near layer also has its own material polygonOffset (materials.js); mid/far get a y-driven depth bias (city.js).
  const AREA_Y = {
    land: 0,
    grass: 0.02,
    park: 0.02,
    beach: 0.01,
    sand: 0.01,
    paved: 0.03,
    parking: 0.03,
    dirt: 0.01,
    wood: 0.03,
    pool: 0.06,
  };
  const plazaRaised = (a) => !JOB4_OFF && a.cls === 'plaza' && a.kind === 'paved';
  function areaFill(B, a, tile = null) {
    const k = a.kind,
      y = AREA_Y[k] ?? 0.004;
    if (synthArea(a)) return; // natural cover outside real Miami: drawn by the terrain mesh
    if (terrain && B[a.cls] && (a.cls === 'runway' || a.cls === 'taxiway' || a.cls === 'apron')) {
      fillPoly(B[a.cls], a.rings, y, 0xffffff, a.cls === 'apron' ? 1 / 6 : 1 / 8);
      return;
    }
    if (k === 'land') {
      // seawall / bank face down to the water (edges on tile seams stay hidden under the ground)
      wallStrip(B.trim, orient(a.rings[0]), -1.6, 0, 6, 6, new THREE.Color(0xa8a49a));
      for (let i = 1; i < a.rings.length; i++)
        wallStrip(
          B.trim,
          orient(a.rings[i]).slice().reverse(),
          -1.6,
          0,
          6,
          6,
          new THREE.Color(0xa8a49a),
        );
    }
    const tgt =
      k === 'beach' || k === 'sand'
        ? B.sand
        : k === 'park' || k === 'grass'
          ? B.grass
          : k === 'paved'
            ? B.sidewalk
            : k === 'parking'
              ? B.parking || B.asphalt
              : k === 'pool'
                ? B.pool
                : k === 'wood'
                  ? B.wood
                  : B.land;
    if (plazaRaised(a)) {
      // job 4: downtown block plazas sit flush with the sidewalk (same slab height and paving), raised edge where they meet open ground
      const zn = zoneAt(a.rings[0][0][0], a.rings[0][0][1]),
        tg =
          M.promenade && B.promenade && /beach|nightlife/.test(zn)
            ? B.promenade
            : M.panels && B.panels && /downtown|business|brickell|commercial/.test(zn)
              ? B.panels
              : B.sidewalk;
      const uvS = tg === B.promenade ? 1 / 8 : tg === B.panels ? 1 / 6 : 1 / 2.5;
      if (PLAZA_CLIP && tile && !tg.empty) {
        // ground pass (Nov 19): the OSM plaza polygon runs over the street. Clip it like a sidewalk slab
        // (road ribbons, junction cuts and curb ramps subtracted), so the road side gets the poured curb
        // and the rest the chamfer, instead of a raised slab lying on the asphalt with a hard step.
        sidewalkPoly(tg, a.rings, null, B.sidewalk, uvS, tile);
        return;
      }
      fillPoly(tg, a.rings, CURB, 0xffffff, uvS);
      const cc = new THREE.Color(0xc8c4bc);
      if (CURB3D) {
        a.rings.forEach((ring, ri) => chamferRing(B.sidewalk, ring, CURB, cc, ri > 0));
      } else {
        wallStrip(B.sidewalk, orient(a.rings[0]), 0, CURB, 2.5, 2.5, cc);
        for (let i = 1; i < a.rings.length; i++)
          wallStrip(B.sidewalk, orient(a.rings[i]).slice().reverse(), 0, CURB, 2.5, 2.5, cc);
      } // roads pass: a poured edge sloping into the ground, not a box
      return;
    }
    if (
      k === 'paved' &&
      B.promenade &&
      M.promenade &&
      /beach|nightlife/.test(zoneAt(a.rings[0][0][0], a.rings[0][0][1]))
    ) {
      fillPoly(B.promenade, a.rings, y, 0xffffff, 1 / 8);
      return;
    } // beachfront plazas / walks: terrazzo
    if (k === 'land' && B.grass && ISLAND_D.test(distAt(a.rings[0][0][0], a.rings[0][0][1]))) {
      fillPoly(B.grass, a.rings, y, 0xd8e0c0, 1 / 6);
      return;
    } // causeway islands: open fill is lawn, not bare ground
    fillPoly(
      tgt,
      a.rings,
      y,
      k === 'dirt' ? 0xb89a78 : k === 'paved' ? 0xe8e2d8 : 0xffffff,
      k === 'land' ? 1 / 8 : k === 'paved' ? 1 / 2.5 : 1 / 6,
    );
    if (k === 'pool')
      wallStrip(B.trim, orient(a.rings[0]), 0, 0.3, 4, 4, new THREE.Color(0xf4f1ea));
  }
  // sidewalk slab clipped against every at-grade road ribbon, junction turning circle and driveway (1 m triangle subdivision);
  // curbs follow the clipped outline, so there is never a slab or curb in a lane or a turn path
  const swClip = new WeakMap();
  function clipSidewalk(rings, tile) {
    const c = swClip.get(rings);
    if (c) return c;
    const g = clipGen(rings, tile);
    let r = g.next();
    while (!r.done) r = g.next();
    return r.value;
  }
  // job 4: exact clipping. The slab is triangulated once, then every triangle has the cut shapes subtracted exactly (convex
  // half-plane clipping, roadgeo.js): road ribbon quads, curb-return spandrels, curb ramps, old discs at deck/ramp nodes.
  // Outline edges (polygon outline + every cut edge) become curb faces, so curbs follow the curb returns smoothly.
  const clipShapeCache = new WeakMap();
  function clipShapes(tile) {
    let S = clipShapeCache.get(tile);
    if (S) return S;
    const list = [],
      grid = new Map(),
      CELL = 10;
    const put = (poly) => {
      if (!poly || poly.length < 3) return;
      const bb = bboxOf(poly),
        k0 = list.length;
      list.push({ p: poly, bb });
      for (let gx = Math.floor(bb[0] / CELL); gx <= Math.floor(bb[2] / CELL); gx++)
        for (let gz = Math.floor(bb[1] / CELL); gz <= Math.floor(bb[3] / CELL); gz++) {
          const k = gx * 100003 + gz;
          let c = grid.get(k);
          if (!c) grid.set(k, (c = []));
          c.push(k0);
        }
    };
    const nb = [tile];
    if (provider.getTile && tile.tx !== undefined)
      for (let i = -1; i <= 1; i++)
        for (let j = -1; j <= 1; j++) {
          if (!i && !j) continue;
          const o = provider.getTile(tile.tx + i, tile.tz + j);
          if (o && !o.then && o.roads) nb.push(o);
        }
    const convex = (q) => {
      let sg = 0;
      for (let i = 0; i < q.length; i++) {
        const a = q[i],
          b = q[(i + 1) % q.length],
          c = q[(i + 2) % q.length],
          cr = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
        if (Math.abs(cr) < 1e-9) continue;
        if (!sg) sg = Math.sign(cr);
        else if (Math.sign(cr) !== sg) return false;
      }
      return true;
    };
    for (const tt of nb)
      for (const r of tt.roads) {
        if (r.pts.length < 2) continue;
        const pr = roadProfile(r, tt);
        if (pr.ys) continue;
        const fr = polyFrame(pr.pts),
          hw = r.width / 2;
        for (let i = 0; i < fr.length - 1; i++) {
          const A = fr[i],
            Bf = fr[i + 1];
          if (Bf.s - A.s < 1e-3) continue;
          const q = [
            [A.x - A.nx * hw, A.z - A.nz * hw],
            [A.x + A.nx * hw, A.z + A.nz * hw],
            [Bf.x + Bf.nx * hw, Bf.z + Bf.nz * hw],
            [Bf.x - Bf.nx * hw, Bf.z - Bf.nz * hw],
          ];
          if (convex(q)) put(convexCCW(q));
          else {
            put(convexCCW([q[0], q[1], q[2]]));
            put(convexCCW([q[0], q[2], q[3]]));
          }
        }
      }
    for (const tt of nb)
      for (const n of tt.nodes || []) {
        if (n.degree < 3 || nodeLevel(tt, n).kind !== 'ground') continue;
        const J = junctionOf(n.id);
        if (J) for (const t of J.cuts) put(t);
        else {
          const R = n.width / 2 + JUNC_PAD,
            ring = [];
          for (let k = 0; k < 24; k++) {
            const a = (k / 24) * Math.PI * 2;
            ring.push([n.x + Math.cos(a) * R, n.z + Math.sin(a) * R]);
          }
          put(ring);
        }
      }
    S = { list, grid, CELL };
    clipShapeCache.set(tile, S);
    return S;
  }
  function* clipGen(rings, tile) {
    let c = swClip.get(rings);
    if (c) return c;
    let tc0 = performance.now();
    if (JOB4_OFF) {
      c = yield* clipGenOld(rings, tile);
      return c;
    }
    const S = clipShapes(tile),
      outer = orient(rings[0]),
      holes = rings.slice(1).map((h) => orient(h).slice().reverse());
    const tris = [];
    try {
      const ct = outer.map(([x, z]) => new THREE.Vector2(x, z)),
        hs = holes.map((h) => h.map(([x, z]) => new THREE.Vector2(x, z))),
        all = ct.concat(...hs);
      const ringOf = [],
        posIn = [],
        lens = [outer.length, ...holes.map((h) => h.length)];
      lens.forEach((n, ri) => {
        for (let k = 0; k < n; k++) {
          ringOf.push(ri);
          posIn.push(k);
        }
      });
      const rim = (u, v) =>
        ringOf[u] === ringOf[v] &&
        (Math.abs(posIn[u] - posIn[v]) === 1 ||
          Math.abs(posIn[u] - posIn[v]) === lens[ringOf[u]] - 1);
      for (const [a, b2, d] of THREE.ShapeUtils.triangulateShape(ct, hs))
        tris.push({
          p: [
            [all[a].x, all[a].y],
            [all[b2].x, all[b2].y],
            [all[d].x, all[d].y],
          ],
          b: [rim(a, b2), rim(b2, d), rim(d, a)],
        });
    } catch (e) {
      /* bad ring: no slab */
    }
    const keep = [],
      seen = new Set();
    let guard = 0;
    for (const t of tris) {
      if ((++guard & 63) === 0 && performance.now() - tc0 > 2) {
        colStats.clipMax = Math.max(colStats.clipMax || 0, performance.now() - tc0);
        yield;
        tc0 = performance.now();
      }
      const bb = bboxOf(t.p);
      seen.clear();
      let pieces = [t];
      for (
        let gx = Math.floor(bb[0] / S.CELL);
        gx <= Math.floor(bb[2] / S.CELL) && pieces.length;
        gx++
      )
        for (
          let gz = Math.floor(bb[1] / S.CELL);
          gz <= Math.floor(bb[3] / S.CELL) && pieces.length;
          gz++
        ) {
          const cell = S.grid.get(gx * 100003 + gz);
          if (!cell) continue;
          for (const k of cell) {
            if (seen.has(k)) continue;
            seen.add(k);
            const sh = S.list[k];
            if (sh.bb[2] < bb[0] || sh.bb[0] > bb[2] || sh.bb[3] < bb[1] || sh.bb[1] > bb[3])
              continue;
            const next = [];
            for (const pc of pieces) for (const q of subtractConvex(pc, sh.p, sh.bb)) next.push(q);
            pieces = next;
            if (!pieces.length) break;
          }
        }
      for (const pc of pieces) {
        let a2 = 0;
        for (let i = 0; i < pc.p.length; i++) {
          const p = pc.p[i],
            q = pc.p[(i + 1) % pc.p.length];
          a2 += p[0] * q[1] - q[0] * p[1];
        }
        if (Math.abs(a2) > 0.008) {
          pc.ccw = a2 > 0;
          keep.push(pc);
        }
      }
    }
    const outT = [],
      edges = [],
      nearR = roadIndex(tile, true);
    for (const pc of keep) {
      const P = pc.p,
        n = P.length;
      for (let k = 1; k < n - 1; k++) outT.push([P[0], P[k], P[k + 1]]);
      for (let i = 0; i < n; i++)
        if (pc.b[i]) {
          const p = P[i],
            q = P[(i + 1) % n];
          if (Math.hypot(q[0] - p[0], q[1] - p[1]) > 0.01) {
            const e = pc.ccw ? [p, q] : [q, p],
              dx = e[1][0] - e[0][0],
              dz = e[1][1] - e[0][1],
              L = Math.hypot(dx, dz),
              g = nearR(
                (e[0][0] + e[1][0]) / 2 + (dz / L) * 0.3,
                (e[0][1] + e[1][1]) / 2 - (dx / L) * 0.3,
              ).gap;
            e.push(g < 0.35);
            edges.push(e);
          }
        }
    } // e[2]: the curb faces a road (else: back edge on lawn / lot)
    c = { tris: outT, edges, oriented: true };
    swClip.set(rings, c);
    colStats.clipMax = Math.max(colStats.clipMax || 0, performance.now() - tc0);
    return c;
  }
  function* clipGenOld(rings, tile) {
    let c = swClip.get(rings);
    if (c) return c;
    let tc0 = performance.now();
    const near = roadIndex(tile, true),
      outer = orient(rings[0]),
      holes = rings.slice(1).map((h) => orient(h).slice().reverse());
    let tris = [];
    try {
      const ct = outer.map(([x, z]) => new THREE.Vector2(x, z)),
        hs = holes.map((h) => h.map(([x, z]) => new THREE.Vector2(x, z))),
        all = ct.concat(...hs);
      for (const [a, b2, d] of THREE.ShapeUtils.triangulateShape(ct, hs))
        tris.push([
          [all[a].x, all[a].y],
          [all[b2].x, all[b2].y],
          [all[d].x, all[d].y],
        ]);
    } catch (e) {
      tris = [];
    }
    const keep = [],
      stack = tris.slice(),
      gc_ = new Map(),
      gapAt = (p) => {
        const k = p[0] * 7919.13 + p[1];
        let v = gc_.get(k);
        if (v === undefined) {
          v = near(p[0], p[1]).gap;
          gc_.set(k, v);
        }
        return v;
      };
    let guard = 0;
    while (stack.length && guard++ < 200000) {
      if ((guard & 511) === 0 && performance.now() - tc0 > 2) {
        colStats.clipMax = Math.max(colStats.clipMax || 0, performance.now() - tc0);
        yield;
        tc0 = performance.now();
      }
      const t = stack.pop(),
        [a, b2, d] = t,
        cx = (a[0] + b2[0] + d[0]) / 3,
        cz = (a[1] + b2[1] + d[1]) / 3;
      const gc = gapAt([cx, cz]),
        ga = gapAt(a),
        gb = gapAt(b2),
        gd = gapAt(d);
      if (gc > 0.05 && ga > -0.02 && gb > -0.02 && gd > -0.02) {
        keep.push(t);
        continue;
      }
      const l0 = Math.hypot(b2[0] - a[0], b2[1] - a[1]),
        l1 = Math.hypot(d[0] - b2[0], d[1] - b2[1]),
        l2 = Math.hypot(a[0] - d[0], a[1] - d[1]),
        mx = Math.max(l0, l1, l2);
      if (mx < 1.2) {
        if (gc > 0.05) keep.push(t);
        continue;
      } // small enough: keep only if mostly outside
      if (gc < -2 && ga < -2 && gb < -2 && gd < -2 && mx < 3) continue; // deep inside the road
      if (mx === l0) {
        const m = [(a[0] + b2[0]) / 2, (a[1] + b2[1]) / 2];
        stack.push([a, m, d], [m, b2, d]);
      } else if (mx === l1) {
        const m = [(b2[0] + d[0]) / 2, (b2[1] + d[1]) / 2];
        stack.push([a, b2, m], [a, m, d]);
      } else {
        const m = [(d[0] + a[0]) / 2, (d[1] + a[1]) / 2];
        stack.push([a, b2, m], [m, b2, d]);
      }
    }
    // boundary edges (used once) -> curbs
    const k = (p) => Math.round(p[0] * 100) + ',' + Math.round(p[1] * 100),
      cnt = new Map();
    for (const t of keep)
      for (let i = 0; i < 3; i++) {
        const p = t[i],
          q = t[(i + 1) % 3],
          key = k(p) < k(q) ? k(p) + '|' + k(q) : k(q) + '|' + k(p);
        const e = cnt.get(key);
        if (e) e.n++;
        else cnt.set(key, { n: 1, p, q });
      }
    const edges = [];
    for (const e of cnt.values()) if (e.n === 1) edges.push([e.p, e.q]);
    c = { tris: keep, edges };
    swClip.set(rings, c);
    colStats.clipMax = Math.max(colStats.clipMax || 0, performance.now() - tc0);
    return c;
  }
  function slabInto(batch, clip, y, uvS, col) {
    for (const [a, b2, d] of clip.tris)
      quadUp(batch, [a[0], y, a[1]], [b2[0], y, b2[1]], [d[0], y, d[1]], [d[0], y, d[1]], col, uvS);
  }
  // roads pass: the edge of a raised paved area sloping 0.38 m out and down into the ground (outward from the ring, whatever its winding)
  function chamferRing(batch, ring, h, col, hole = false) {
    const n = ring.length;
    if (n < 3) return;
    let a2 = 0;
    for (let i = 0; i < n; i++) {
      const p = ring[i],
        q = ring[(i + 1) % n];
      a2 += p[0] * q[1] - q[0] * p[1];
    }
    const sg = a2 > 0 !== hole ? 1 : -1,
      w = 0.38; // CCW: outward = (dz, -dx); a hole slopes into its own interior
    for (let i = 0; i < n; i++) {
      const p = ring[i],
        q = ring[(i + 1) % n],
        dx = q[0] - p[0],
        dz = q[1] - p[1],
        L = Math.hypot(dx, dz);
      if (L < 1e-3) continue;
      const nx = (sg * dz) / L,
        nz = (-sg * dx) / L;
      quadUp(
        batch,
        [p[0], h, p[1]],
        [q[0], h, q[1]],
        [q[0] + nx * w, -0.03, q[1] + nz * w],
        [p[0] + nx * w, -0.03, p[1] + nz * w],
        col,
        0.4,
      );
    }
  }
  function curbsInto(batch, clip, h, col, render = false) {
    // low curb faces along the clipped outline (job 4: one outward face per oriented edge)
    if (clip.oriented && render && CURB3D) {
      // roads pass: road-side edges become one continuous poured curb + gutter (curbs.js), chained round the curves
      curbChains(
        batch,
        clip.edges.filter((e) => e[2] === true),
        (p, q) => {
          const dx = q[0] - p[0],
            dz = q[1] - p[1],
            L = Math.hypot(dx, dz) || 1;
          return [dz / L, -dx / L];
        },
        { h, y0: 0.05 },
      );
      clip = { oriented: true, edges: clip.edges.filter((e) => e[2] !== true) };
    }
    if (clip.oriented) {
      for (const [p, q, road] of clip.edges) {
        const dx = q[0] - p[0],
          dz = q[1] - p[1],
          L = Math.hypot(dx, dz) || 1,
          nx = dz / L,
          nz = -dx / L;
        if (road === false && !batch.tag) {
          // back edge (lawn / lot side): a 0.35 m chamfer down to the ground instead of a dark vertical step
          const w = 0.38,
            yb = CURB3D ? -0.03 : 0,
            a = [p[0], h, p[1]],
            b = [q[0], h, q[1]],
            c = [q[0] + nx * w, yb, q[1] + nz * w],
            d = [p[0] + nx * w, yb, p[1] + nz * w],
            sl = Math.hypot(w, h),
            ny = w / sl,
            nh = h / sl;
          for (const v2 of [a, b, c, a, c, d])
            batch.vert(v2[0], v2[1], v2[2], nx * nh, ny, nz * nh, v2[0] * 0.4, v2[2] * 0.4, col);
          continue;
        }
        const v = [
          [p[0], 0, p[1]],
          [q[0], 0, q[1]],
          [q[0], h, q[1]],
          [p[0], h, p[1]],
        ];
        for (const i of [0, 2, 1, 0, 3, 2])
          batch.vert(
            v[i][0],
            v[i][1],
            v[i][2],
            nx,
            0,
            nz,
            (i === 1 || i === 2 ? L : 0) * 0.4,
            v[i][1] * 0.4,
            col,
          );
      }
      return;
    }
    for (const [p, q] of clip.edges) {
      const dx = q[0] - p[0],
        dz = q[1] - p[1],
        L = Math.hypot(dx, dz) || 1,
        nx = -dz / L,
        nz = dx / L;
      for (const s2 of [1, -1]) {
        const v = [
            [p[0], 0, p[1]],
            [q[0], 0, q[1]],
            [q[0], h, q[1]],
            [p[0], h, p[1]],
          ],
          o = s2 > 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2];
        for (const i of o)
          batch.vert(
            v[i][0],
            v[i][1],
            v[i][2],
            nx * s2,
            0,
            nz * s2,
            (i === 1 || i === 2 ? L : 0) * 0.4,
            v[i][1] * 0.4,
            col,
          );
      }
    }
  }
  function sidewalkPoly(tgt, rings, coll, curbTgt = tgt, uvS = 1 / 2.5, tile = null) {
    if (tile) {
      const clip = clipSidewalk(rings, tile),
        white = new THREE.Color(0xffffff),
        cc = new THREE.Color(0xd8d4cc);
      if (tgt) {
        slabInto(tgt, clip, CURB, uvS, white);
        curbsInto(curbTgt, clip, CURB, cc, true);
      }
      if (tgt && curWeeds && clip.oriented)
        for (const [p, q, road] of clip.edges) {
          if (!road) continue;
          const ex = q[0] - p[0],
            ez = q[1] - p[1],
            L = Math.hypot(ex, ez);
          if (L < 1) continue; // ground pass: sparse weeds in the gutter crack of every curb (road side of the slab)
          const nx = ez / L,
            nz = -ex / L;
          for (let t = 0.5; t < L; t += 3.5) {
            const x0 = p[0] + (ex / L) * t,
              z0 = p[1] + (ez / L) * t,
              h = hash(((x0 * 7) | 0) * 131 + ((z0 * 11) | 0));
            if (h > 0.08) continue;
            const x = x0 + nx * 0.05,
              z = z0 + nz * 0.05;
            curWeeds.push({ x, y: 0.05, z, ry: h * 77, s: 0.6 + h * 7 });
            const AW = (globalThis.__gpWeeds ||= []);
            if (AW.length < 400) AW.push([x, z, nx, nz]);
          }
        }
      if (coll) {
        slabInto(coll, clip, CURB, 1, white);
        curbsInto(coll, clip, CURB, white);
      }
      return;
    }
    const outer = orient(rings[0]);
    fillPoly(tgt, rings, CURB, 0xffffff, uvS);
    wallStrip(curbTgt, outer, 0, CURB, 2.5, 2.5, new THREE.Color(0xd8d4cc));
    for (let i = 1; i < rings.length; i++)
      wallStrip(
        curbTgt,
        orient(rings[i]).slice().reverse(),
        0,
        CURB,
        2.5,
        2.5,
        new THREE.Color(0xd8d4cc),
      );
    if (coll) {
      fillPoly(coll, rings, CURB, 0xffffff, 1);
      wallStrip(coll, outer, 0, CURB, 10, 10, new THREE.Color(0xffffff));
      for (let i = 1; i < rings.length; i++)
        wallStrip(
          coll,
          orient(rings[i]).slice().reverse(),
          0,
          CURB,
          10,
          10,
          new THREE.Color(0xffffff),
        );
    }
  }
  function pierDeck(B, p, coll, props) {
    const y = p.y ?? 1.2,
      outer = orient(p.rings[0]);
    if (B) {
      fillPoly(B.wood, p.rings, y, 0xffffff, 1 / 3);
      wallStrip(B.trim, outer, y - 0.35, y, 4, 4, new THREE.Color(0x8b6a4a));
    }
    if (coll) {
      fillPoly(coll, p.rings, y, 0xffffff, 1);
      wallStrip(coll, outer, y - 0.35, y, 10, 10, new THREE.Color(0xffffff));
    }
    if (props && B)
      for (let i = 0; i < outer.length; i += 1) {
        const q = outer[i],
          n2 = outer[(i + 1) % outer.length],
          L = Math.hypot(n2[0] - q[0], n2[1] - q[1]);
        for (let s2 = 0; s2 < L; s2 += 6)
          props.pier.push({
            x: q[0] + (n2[0] - q[0]) * (s2 / L),
            y: (y - 0.35 - 4) / 2,
            z: q[1] + (n2[1] - q[1]) * (s2 / L),
            ry: 0,
            sx: 0.3,
            sy: y - 0.35 + 4,
          });
      }
  }
  function newProps() {
    return {
      tree: [],
      lamp: [],
      pool: [],
      palm: [],
      ac: [],
      beacon: [],
      mast: [],
      sig: [],
      pier: [],
      bench: [],
      bin: [],
      hydrant: [],
      shelter: [],
      litter: [],
      signPost: [],
      signs: [],
      graffiti: [],
      container: [],
      stack: [],
      boat: [],
      blob: [],
      flower: [],
      bike: [],
      kiosk: [],
      dune: [],
      oats: [],
      upole: [],
      hut: [],
      cafe: [],
      umbrella: [],
      bulb: [],
      wire: [],
      grate: [],
      sigPole: [],
      sigArm: [],
      sigHead: [],
      pedHead: [],
      pedPost: [],
      cabinet: [],
      blade: [],
      meter: [],
      mailbox: [],
      work: [],
      palmZone: (x, z) => PALM_ZONES.has(zoneAt(x, z)),
    };
  }
  function sampleAt(fr, s, ys = null) {
    let i = 0;
    while (i < fr.length - 2 && fr[i + 1].s < s) i++;
    const A = fr[i],
      Bf = fr[i + 1] || A,
      L = Bf.s - A.s || 1,
      t = Math.max(0, Math.min(1, (s - A.s) / L));
    const y = ys ? ys[i] + ((ys[i + 1] ?? ys[i]) - ys[i]) * t : 0;
    return {
      x: A.x + (Bf.x - A.x) * t,
      z: A.z + (Bf.z - A.z) * t,
      nx: A.nx + (Bf.nx - A.nx) * t,
      nz: A.nz + (Bf.nz - A.nz) * t,
      y,
      dx: (Bf.x - A.x) / L,
      dz: (Bf.z - A.z) / L,
    };
  }
  // props-only pass (used by the collider job when the near build has not run for this tile)
  // ---- placement guard: nothing stands on a road ribbon, junction fill, crosswalk, driveway or deck/ramp footprint ----
  const placeStats = { checked: 0, rejected: 0, snapped: 0, byKind: {} };
  const PROP_R = {
    palm: 0.35,
    tree: 0.4,
    blob: 0.7,
    flower: 0.7,
    lamp: 0.15,
    mast: 0.18,
    hydrant: 0.18,
    bin: 0.35,
    bench: 0.3,
    bike: 0.4,
    kiosk: 0.8,
    shelter: 0.9,
    cafe: 0.6,
    umbrella: 0.3,
    signPost: 0.08,
    upole: 0.15,
    hut: 1.6,
    grate: 0.8,
    bulb: 0,
    litter: 0.1,
  };
  const TREE_CLR = 0.6,
    FURN_CLR = 0.1;
  const rIdxCache = new WeakMap();
  function roadIndex(tile, groundOnly = false) {
    let cc = rIdxCache.get(tile);
    if (!cc) rIdxCache.set(tile, (cc = {}));
    if (cc[groundOnly]) return cc[groundOnly];
    return (cc[groundOnly] = roadIndex0(tile, groundOnly));
  }
  function roadIndex0(tile, groundOnly) {
    // 10 m grid of road / junction footprints for this tile
    const CELL = 10,
      segs = [],
      grid = new Map(),
      put = (i, x0, z0, x1, z1) => {
        for (let gx = Math.floor(x0 / CELL); gx <= Math.floor(x1 / CELL); gx++)
          for (let gz = Math.floor(z0 / CELL); gz <= Math.floor(z1 / CELL); gz++) {
            const k = gx * 100003 + gz;
            if (!grid.has(k)) grid.set(k, []);
            grid.get(k).push(i);
          }
      };
    const nb = [tile];
    if (provider.getTile && tile.tx !== undefined)
      for (let i = -1; i <= 1; i++)
        for (let j = -1; j <= 1; j++) {
          if (!i && !j) continue;
          const o = provider.getTile(tile.tx + i, tile.tz + j);
          if (o && !o.then && o.roads) nb.push(o);
        }
    for (const tt of nb)
      for (const r of tt.roads) {
        if (r.pts.length < 2) continue;
        if (groundOnly && roadProfile(r, tt).ys) continue;
        const hw = r.width / 2;
        for (let i = 0; i < r.pts.length - 1; i++) {
          const a = r.pts[i],
            b = r.pts[i + 1];
          segs.push([a[0], a[1], b[0], b[1], hw]);
          put(
            segs.length - 1,
            Math.min(a[0], b[0]) - hw - 3,
            Math.min(a[1], b[1]) - hw - 3,
            Math.max(a[0], b[0]) + hw + 3,
            Math.max(a[1], b[1]) + hw + 3,
          );
        }
      }
    const polys = [],
      pgrid = new Map(); // job 4: junction outlines (curb returns) instead of discs
    for (const tt of nb)
      for (const n of tt.nodes || [])
        if (n.degree >= 3 && (!groundOnly || nodeLevel(tt, n).kind === 'ground')) {
          const J = nodeLevel(tt, n).kind === 'ground' ? junctionOf(n.id) : null;
          if (J) {
            const bb = bboxOf(J.poly),
              k0 = polys.length;
            polys.push(J.poly);
            for (
              let gx = Math.floor((bb[0] - 3) / CELL);
              gx <= Math.floor((bb[2] + 3) / CELL);
              gx++
            )
              for (
                let gz = Math.floor((bb[1] - 3) / CELL);
                gz <= Math.floor((bb[3] + 3) / CELL);
                gz++
              ) {
                const k = gx * 100003 + gz;
                if (!pgrid.has(k)) pgrid.set(k, []);
                pgrid.get(k).push(k0);
              }
            continue;
          }
          const R = n.width / 2 + JUNC_PAD;
          segs.push([n.x, n.z, n.x, n.z, R]);
          put(segs.length - 1, n.x - R - 3, n.z - R - 3, n.x + R + 3, n.z + R + 3);
        } // junction fill (crosswalks lie on the approach ribbons)
    // nearest road edge: returns {gap: distance outside the footprint (negative = inside), nx, nz: outward unit vector}
    const out = { gap: 1e9, nx: 0, nz: 0 };
    return (x, z) => {
      out.gap = 1e9;
      const key = Math.floor(x / CELL) * 100003 + Math.floor(z / CELL),
        c = grid.get(key);
      if (c)
        for (const i of c) {
          const [ax, az, bx, bz, hw] = segs[i],
            dx = bx - ax,
            dz = bz - az,
            L2 = dx * dx + dz * dz;
          let t = L2 > 0 ? ((x - ax) * dx + (z - az) * dz) / L2 : 0;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const ex = x - (ax + dx * t),
            ez = z - (az + dz * t),
            d = Math.hypot(ex, ez),
            gap = d - hw;
          if (gap < out.gap) {
            out.gap = gap;
            out.nx = d > 1e-6 ? ex / d : 1;
            out.nz = d > 1e-6 ? ez / d : 0;
          }
        }
      const pc = pgrid.get(key);
      if (pc)
        for (const i of pc) {
          const P = polys[i];
          let ins = false,
            bd = 1e9,
            bx = 0,
            bz = 0;
          for (let a = 0, b = P.length - 1; a < P.length; b = a++) {
            const xa = P[a][0],
              za = P[a][1],
              xb = P[b][0],
              zb = P[b][1];
            if (za > z !== zb > z && x < ((xb - xa) * (z - za)) / (zb - za) + xa) ins = !ins;
            const dx = xb - xa,
              dz = zb - za,
              L2 = dx * dx + dz * dz;
            let t = L2 > 0 ? ((x - xa) * dx + (z - za) * dz) / L2 : 0;
            t = t < 0 ? 0 : t > 1 ? 1 : t;
            const px = xa + dx * t,
              pz = za + dz * t,
              d = Math.hypot(x - px, z - pz);
            if (d < bd) {
              bd = d;
              bx = px;
              bz = pz;
            }
          }
          const gap = ins ? -bd : bd;
          if (gap < out.gap) {
            out.gap = gap;
            const ex = ins ? bx - x : x - bx,
              ez = ins ? bz - z : z - bz;
            out.nx = bd > 1e-6 ? ex / bd : 1;
            out.nz = bd > 1e-6 ? ez / bd : 0;
          }
        }
      return out;
    };
  }
  function pathIndex(tile) {
    // walking lines (OSM sidewalks / footways / pedestrian paths): nearest distance + unit normal toward the point
    const CELL = 10,
      segs = [],
      grid = new Map();
    for (const p of tile.paths || []) {
      if (p.bridge || !/sidewalk|footway|pedestrian|path|crossing/.test(p.kind || '')) continue;
      const P = p.pts;
      if (!P || P.length < 2) continue;
      for (let i = 0; i < P.length - 1; i++) {
        const a = P[i],
          b = P[i + 1];
        segs.push([a[0], a[1], b[0], b[1]]);
        const k0 = segs.length - 1;
        for (
          let gx = Math.floor((Math.min(a[0], b[0]) - 3) / CELL);
          gx <= Math.floor((Math.max(a[0], b[0]) + 3) / CELL);
          gx++
        )
          for (
            let gz = Math.floor((Math.min(a[1], b[1]) - 3) / CELL);
            gz <= Math.floor((Math.max(a[1], b[1]) + 3) / CELL);
            gz++
          ) {
            const k = gx * 100003 + gz;
            if (!grid.has(k)) grid.set(k, []);
            grid.get(k).push(k0);
          }
      }
    }
    const out = { d: 1e9, nx: 0, nz: 0 };
    return (x, z) => {
      out.d = 1e9;
      const c = grid.get(Math.floor(x / CELL) * 100003 + Math.floor(z / CELL));
      if (!c) return out;
      for (const i of c) {
        const [ax, az, bx, bz] = segs[i],
          dx = bx - ax,
          dz = bz - az,
          L2 = dx * dx + dz * dz || 1;
        let t = ((x - ax) * dx + (z - az) * dz) / L2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const ex = x - (ax + dx * t),
          ez = z - (az + dz * t),
          d = Math.hypot(ex, ez);
        if (d < out.d) {
          out.d = d;
          if (d > 1e-3) {
            out.nx = ex / d;
            out.nz = ez / d;
          } else {
            const l = Math.sqrt(L2);
            out.nx = -dz / l;
            out.nz = dx / l;
          }
        }
      }
      return out;
    };
  }
  const PROP_H = {
    palm: 9.5,
    tree: 7,
    lamp: 7.6,
    mast: 6.5,
    upole: 10,
    signPost: 3.6,
    shelter: 2.8,
    kiosk: 3,
    hut: 4.8,
    umbrella: 2.6,
    blob: 1.4,
    flower: 1.3,
    bin: 1.1,
    bench: 1,
    hydrant: 0.8,
    bike: 1,
    cafe: 1,
    grate: 0.1,
    litter: 0.1,
    bulb: 0.5,
  }; // heights for the deck-clearance test
  const WALK_HALF = 0.75,
    WALK_KINDS = new Set([
      'palm',
      'tree',
      'blob',
      'flower',
      'lamp',
      'mast',
      'hydrant',
      'bin',
      'bench',
      'bike',
      'kiosk',
      'shelter',
      'cafe',
      'umbrella',
      'signPost',
      'hut',
      'upole',
    ]);
  // greenery: a street tree's crown must stay clear of the traffic lanes (no limbs hanging into the road below ~5 m): a tree whose
  // crown radius reaches over the curb is scaled down to fit the strip (crown edge at most 0.6 m past the curb); one that would be
  // a sapling becomes a palm (crown far above the lanes) instead
  function treeClearance(near, props, tile) {
    // junction mouths: no palm / tree trunk inside a junction's curb-return area (node disc + 2 m); slide it out along the
    // node -> trunk direction onto the corner, or drop it when that spot is road, building or water
    const J = ((tile && tile.nodes) || []).filter((n) => n.degree >= 3 && n.width);
    if (J.length)
      for (const kind of ['palm', 'tree']) {
        const list = props[kind];
        if (!list || !list.length) continue;
        const keep = [];
        for (const p of list) {
          if (p.cs || p.elev) {
            keep.push(p);
            continue;
          }
          let ok = true;
          for (const n of J) {
            const dx = p.x - n.x,
              dz = p.z - n.z,
              d = Math.hypot(dx, dz),
              need = n.width / 2 + 2.2;
            if (d >= need) continue;
            const x2 = n.x + (d > 0.01 ? dx / d : 1) * need,
              z2 = n.z + (d > 0.01 ? dz / d : 0) * need;
            if (
              near(x2, z2).gap >= 0.95 &&
              !insideBuilding(tile, x2, z2) &&
              !(isWater && isWater(x2, z2))
            ) {
              p.x = x2;
              p.z = z2;
              if ((p.y || 0) < 0.5) p.y = gY(x2, z2);
              placeStats.junctionMoved = (placeStats.junctionMoved || 0) + 1;
            } else {
              ok = false;
              placeStats.junctionDropped = (placeStats.junctionDropped || 0) + 1;
            }
            break;
          }
          if (ok) keep.push(p);
        }
        list.length = 0;
        for (const p of keep) list.push(p);
      }
    if (!props.tree || !props.tree.length) return;
    const keep = [];
    for (const p of props.tree) {
      const cr = treeCrownR(p.sp);
      if (!cr) {
        keep.push(p);
        continue;
      }
      const q = near(p.x, p.z),
        room = q.gap + 0.6;
      if (cr * (p.s || 1) > room) {
        const s2 = room / cr;
        if (s2 < 0.34) {
          props.palm.push({ x: p.x, y: p.y, z: p.z, ry: p.ry, s: 0.8 + ((p.ry * 7.3) % 1) * 0.3 });
          placeStats.treeToPalm = (placeStats.treeToPalm || 0) + 1;
          continue;
        }
        p.s = s2;
        placeStats.treeShrunk = (placeStats.treeShrunk || 0) + 1;
      }
      keep.push(p);
    }
    props.tree.length = 0;
    for (const p of keep) props.tree.push(p);
  }
  function cleanProps(tile, props) {
    if (props._clean) return;
    props._clean = true;
    const near = roadIndex(tile),
      walk = pathIndex(tile);
    if (elevated)
      for (const kind of ['sig', 'signs']) {
        const list = props[kind];
        if (!Array.isArray(list) || !list.length) continue;
        const keep = [];
        for (const p of list) {
          const f = safeCall(() => elevated.footprintAt(p.x, p.z), null);
          if (f && (f.type === 1 || f.y - 1.3 < (p.y || 0) + 1)) {
            placeStats.deckDropped = (placeStats.deckDropped || 0) + 1;
            continue;
          }
          keep.push(p);
        }
        list.length = 0;
        for (const p of keep) list.push(p);
      }
    for (const kind of Object.keys(PROP_R)) {
      const list = props[kind];
      if (!Array.isArray(list) || !list.length) continue;
      const tree = kind === 'palm' || kind === 'tree' || kind === 'blob' || kind === 'flower',
        rad = PROP_R[kind] + (tree ? TREE_CLR : FURN_CLR),
        keep = [];
      for (const p of list) {
        placeStats.checked++;
        if (p.elev) {
          keep.push(p);
          continue;
        } // ELEVATED's deck lamps: already on the barrier tops
        if (houseLots.reserved.length && houseLots.reservedAt(p.x, p.z, tree ? 3.5 : 0.6)) {
          placeStats.rejected++;
          continue;
        } // town shops / plaza (setpieces/towns): no city prop or palm through them
        // never a city / OSM prop on or over a deck: below a low deck / embankment, or anywhere at deck height (raw OSM bridge heights)
        if (elevated) {
          const f = safeCall(() => elevated.footprintAt(p.x, p.z), null);
          if (
            f &&
            (f.type === 1 ||
              f.y < 4.5 ||
              (p.y || 0) > 0.3 ||
              f.y - 1.3 < (p.y || 0) + (PROP_H[kind] || 1.2) * (p.s || 1))
          ) {
            placeStats.rejected++;
            placeStats.deckDropped = (placeStats.deckDropped || 0) + 1;
            placeStats.byKind[kind] = (placeStats.byKind[kind] || 0) + 1;
            continue;
          }
        }
        if ((p.y || 0) > 1.5 && kind !== 'bulb') {
          placeStats.rejected++;
          placeStats.deckDropped = (placeStats.deckDropped || 0) + 1;
          continue;
        } // above pier height = a bridge deck height from the OSM data
        let q = near(p.x, p.z);
        if (q.gap >= rad) {
          // keep a 1.5 m walking corridor on every sidewalk / footway line: shift into the furniture zone (or building side), else drop
          if (WALK_KINDS.has(kind) && !(p.y > 1.0)) {
            const w = walk(p.x, p.z),
              need = WALK_HALF + PROP_R[kind] + 0.05;
            if (w.d < need) {
              let moved = false;
              for (const [sx, amt] of [
                [1, need - w.d],
                [-1, need + w.d],
              ]) {
                const x2 = p.x + w.nx * sx * amt,
                  z2 = p.z + w.nz * sx * amt,
                  q2 = near(x2, z2),
                  w2 = walk(x2, z2);
                if (
                  q2.gap >=
                    (kind === 'shelter'
                      ? 2.3
                      : kind === 'bench' || kind === 'bike' || kind === 'kiosk'
                        ? rad + 0.7
                        : rad) &&
                  w2.d >= need - 0.01 &&
                  !insideBuilding(tile, x2, z2) &&
                  !(isWater && isWater(x2, z2))
                ) {
                  p.x = x2;
                  p.z = z2;
                  if (p.y !== undefined && p.y < 0.5) p.y = gY(x2, z2);
                  moved = true;
                  placeStats.walkMoved = (placeStats.walkMoved || 0) + 1;
                  break;
                }
              }
              if (!moved) {
                placeStats.walkDropped = (placeStats.walkDropped || 0) + 1;
                placeStats.rejected++;
                placeStats.byKind[kind] = (placeStats.byKind[kind] || 0) + 1;
                continue;
              }
            }
          }
          keep.push(p);
          continue;
        }
        // mapped street trees close to the kerb: snap out onto the sidewalk / planting strip (trunk >= 0.8 m from the curb face)
        if (((kind === 'palm' && p.real) || kind === 'tree') && q.gap > -3) {
          // (greenery: mapped species trees too: never a trunk in the carriageway)
          const push = rad + 0.2 - q.gap,
            x2 = p.x + q.nx * push,
            z2 = p.z + q.nz * push,
            q2 = near(x2, z2);
          if (q2.gap >= rad && !(isWater && isWater(x2, z2))) {
            p.x = x2;
            p.z = z2;
            p.y = gY(x2, z2);
            keep.push(p);
            placeStats.snapped++;
            continue;
          }
        }
        placeStats.rejected++;
        placeStats.byKind[kind] = (placeStats.byKind[kind] || 0) + 1;
      }
      list.length = 0;
      for (const p of keep) list.push(p);
    }
    treeClearance(near, props, tile);
    if (!CLIP_OFF) resolveClips(tile, props);
  }
  // ---- clipping sweep: one occupancy pass over every solid prop of the tile against the shared index (src/world/ground/occupancy.js):
  // structural poles first (utility poles carry wires, signal masts carry heads: never moved), then lamps, shelters, signs, plants and
  // furniture. A prop that touches an earlier one (or stands a pole inside a palm crown) slides along the curb to the nearest free spot
  // that is still off the carriageway, outside buildings and on land; if there is none it is dropped. Neighbor tiles, world-dressing and
  // set pieces register in the same index, so props never clip across tile seams or into a set piece either.
  const OCC = {
    sigPole: [0.2, 6.7],
    pedPost: [0.1, 3.4],
    cabinet: [0.45, 1.6],
    meter: [0.1, 1.45],
    mailbox: [0.25, 1.25],
    mast: [0.18, 6.5],
    upole: [0.15, 10],
    lamp: [0.15, 7.6],
    shelter: [1.0, 2.8],
    kiosk: [0.8, 3],
    hut: [1.6, 4.8],
    signPost: [0.06, 3.6],
    hydrant: [0.17, 0.8],
    tree: [0.32, 8],
    palm: [0.3, 9],
    bench: [0.45, 1],
    bin: [0.32, 1.1],
    bike: [0.4, 1],
    cafe: [0.55, 1],
    flower: [0.6, 1.3],
    blob: [0.6, 1.4],
  }; // umbrellas stand in their cafe table on purpose
  const OCC_POLE = new Set(['mast', 'upole', 'lamp', 'sigPole', 'pedPost', 'meter']),
    OCC_FIXED = new Set(['mast', 'upole', 'sigPole', 'pedPost', 'cabinet']),
    OCC_SOFT = new Set(['flower', 'blob']),
    OCC_CROWN = { palm: 2.6, tree: 3.2 };
  const OCC_SHIFT = { palm: 3, tree: 3, lamp: 2, flower: 1.5, blob: 1.5 };
  const OCC_SPACE = {
    lamp: { kinds: new Set(['lamp', 'upole', 'mast']), d: 2.5 },
    signPost: { kinds: new Set(['signPost']), d: 0.9 },
    hydrant: { kinds: new Set(['hydrant']), d: 3 },
  };
  // ground snapping on the surface that is really drawn: the curb-height slab triangles of this tile's sidewalk batches
  // (ribbons along the roads + clipped sidewalk polygons). A prop on the slab stands at its top; a prop off it stands on the
  // ground (the height query reads unclipped sidewalk polygons: palms sunk 15 cm into a slab, lamps floating over a driveway).
  function slabFromBatches(list) {
    const G = new Map(),
      C = 4,
      kk = (i, j) => i * 100003 + j,
      tris = [];
    for (const b of list) {
      if (!b || !b.p || !b.p.length) continue;
      const P = b.p;
      for (let i = 0; i + 8 < P.length; i += 9) {
        const y0 = P[i + 1],
          y1 = P[i + 4],
          y2 = P[i + 7];
        if (y0 < 0.08 || y0 > 0.3 || Math.abs(y1 - y0) > 0.03 || Math.abs(y2 - y0) > 0.03) continue;
        const t = [P[i], P[i + 2], P[i + 3], P[i + 5], P[i + 6], P[i + 8], (y0 + y1 + y2) / 3];
        tris.push(t);
        const x0 = Math.min(t[0], t[2], t[4]),
          x1 = Math.max(t[0], t[2], t[4]),
          z0 = Math.min(t[1], t[3], t[5]),
          z1 = Math.max(t[1], t[3], t[5]);
        for (let a = Math.floor(x0 / C); a <= Math.floor(x1 / C); a++)
          for (let c = Math.floor(z0 / C); c <= Math.floor(z1 / C); c++) {
            const k = kk(a, c);
            let arr = G.get(k);
            if (!arr) G.set(k, (arr = []));
            arr.push(t);
          }
      }
    }
    if (!tris.length) return null;
    return (x, z) => {
      const arr = G.get(kk(Math.floor(x / C), Math.floor(z / C)));
      if (!arr) return null;
      for (const t of arr) {
        const d1 = (x - t[2]) * (t[1] - t[3]) - (t[0] - t[2]) * (z - t[3]),
          d2 = (x - t[4]) * (t[3] - t[5]) - (t[2] - t[4]) * (z - t[5]),
          d3 = (x - t[0]) * (t[5] - t[1]) - (t[4] - t[0]) * (z - t[1]);
        if (!((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0))) return t[6];
      }
      return null;
    };
  }
  function resolveClips(tile, props) {
    const owner = 'tile:' + tile.tx + ',' + tile.tz;
    occupancy.removeOwner(owner);
    const near = roadIndex(tile),
      slab = props._slab || null;
    const snapY = (p, r) => {
      if (!slab) return;
      const y = p.y || 0;
      if (y > 0.3 || y < -0.05) return; // piers, decks, planters, shallows: placed on purpose
      let on = 0,
        top = 0;
      for (const [dx, dz] of [
        [0, 0],
        [r, 0],
        [-r, 0],
        [0, r],
        [0, -r],
      ]) {
        const h = slab(p.x + dx, p.z + dz);
        if (h !== null) {
          on++;
          top = Math.max(top, h);
        }
      }
      if (on >= 3) {
        if (Math.abs(y - top) > 0.02) {
          p.y = top;
          placeStats.groundSnapped = (placeStats.groundSnapped || 0) + 1;
        }
      } else if (on === 0 && y > 0.08) {
        // at curb height but off the slab: only where the slab visibly ends right here (clipped corner,
        // driveway), away from the tile seam (the neighbor tile may own the slab under it)
        const S0 = tile.size || provider.tileSize || 200,
          x0 = tile.x0 ?? tile.tx * S0,
          z0 = tile.z0 ?? tile.tz * S0;
        if (p.x - x0 < 3 || x0 + S0 - p.x < 3 || p.z - z0 < 3 || z0 + S0 - p.z < 3) return;
        let near = 0;
        for (const [dx, dz] of [
          [2.5, 0],
          [-2.5, 0],
          [0, 2.5],
          [0, -2.5],
        ])
          if (slab(p.x + dx, p.z + dz) !== null) near++;
        // map audit (user: palm roots float a few inches): no slab anywhere under or beside it = it stands on the bare ground (Keys lanes,
        // verges without a sidewalk); a curb-height base hung 15 cm in the air there. ?mapfix=0 = old
        if (near >= 1 || !MAPFIX_OFF) {
          p.y = Math.max(0, Math.min(0.03, gY0(p.x, p.z) > 0.1 ? 0 : gY0(p.x, p.z)));
          placeStats.groundSnapped = (placeStats.groundSnapped || 0) + 1;
        }
      }
    };
    const inB = (x, z, r) =>
      insideBuilding(tile, x, z) ||
      insideBuilding(tile, x + r, z) ||
      insideBuilding(tile, x - r, z) ||
      insideBuilding(tile, x, z + r) ||
      insideBuilding(tile, x, z - r); // trunk / post through a wall
    for (const kind of Object.keys(OCC)) {
      const list = props[kind];
      if (!Array.isArray(list) || !list.length) continue;
      const [r0, h0] = OCC[kind],
        keep = [];
      for (const p of list) {
        const s = p.s || 1,
          r = r0 * s,
          h = h0 * s,
          y = p.y || 0;
        const reg = (x, z) =>
          occupancy.add({
            x,
            z,
            r,
            y,
            h,
            kind,
            src: 'tilebuild:' + kind,
            owner,
            pole: OCC_POLE.has(kind),
            soft: OCC_SOFT.has(kind),
            crown: OCC_CROWN[kind] ? { r: OCC_CROWN[kind] * s * 0.8, y0: y + h * 0.55 } : null,
            audit: false,
          });
        if (p.elev || y > 1.5) {
          keep.push(p);
          continue;
        } // ELEVATED deck lamps sit on the barrier tops
        snapY(p, Math.max(r, 0.2));
        const o = {
          y,
          h,
          gap: 0.08,
          pole: OCC_POLE.has(kind),
          soft: OCC_SOFT.has(kind),
          crown: OCC_CROWN[kind] ? { r: OCC_CROWN[kind] * s * 0.8, y0: y + h * 0.55 } : null,
          spacing: OCC_SPACE[kind] || null,
        };
        if (OCC_FIXED.has(kind)) {
          keep.push(p);
          reg(p.x, p.z);
          continue;
        }
        const walled = !OCC_SOFT.has(kind) && inB(p.x, p.z, r + 0.05);
        if (!walled && !occupancy.blocked(p.x, p.z, r, o)) {
          keep.push(p);
          reg(p.x, p.z);
          continue;
        }
        const q = near(p.x, p.z),
          dir = q.gap < 1e8 ? [-q.nz, q.nx] : null;
        const ok = (x, z) =>
          near(x, z).gap >= r + (OCC_SOFT.has(kind) ? 0.3 : 0.1) &&
          !inB(x, z, r + 0.05) &&
          !(isWater && isWater(x, z));
        const f =
          occupancy.free(p.x, p.z, r, { ...o, dir }, OCC_SHIFT[kind] || 1, ok) ||
          (dir ? occupancy.free(p.x, p.z, r, o, Math.min(1, OCC_SHIFT[kind] || 1), ok) : null);
        if (!f) {
          placeStats.clipDropped = (placeStats.clipDropped || 0) + 1;
          continue;
        }
        const y1 = p.y !== undefined && p.y < 0.5 && p.y > -0.3 ? gY0(f[0], f[1]) : null; // a moved prop stands on the ground at its new spot (curb / no curb)
        p.x = f[0];
        p.z = f[1];
        if (y1 !== null && Number.isFinite(y1)) p.y = y1;
        snapY(p, Math.max(r, 0.2));
        keep.push(p);
        reg(p.x, p.z);
        placeStats.clipMoved = (placeStats.clipMoved || 0) + 1;
      }
      list.length = 0;
      for (const p of keep) list.push(p);
    }
  }
  // X1: hide a knocked-over prop (the near build's instance at the same spot; zero scale until the tile is rebuilt)
  const _zeroM = new THREE.Matrix4().makeScale(0, 0, 0);
  function hideProp(t, kind, p) {
    const list = (t.props && t.props[kind]) || [];
    let q = p._vis ? p : null;
    if (!q)
      for (const c of list)
        if (c._vis && Math.abs(c.x - p.x) < 0.05 && Math.abs(c.z - p.z) < 0.05) {
          q = c;
          break;
        }
    if (!q) return false;
    q.broken = true;
    for (const [h, k] of q._vis) {
      const i = h.idx[k];
      if (i !== undefined && h.p && i < h.p.count) poolSetMatrix(h.p, i, _zeroM);
    }
    return true;
  }
  // r2-perf: the collider job only needs the road props, so its buildRoads pass writes geometry into sink batches that
  // drop every vertex (the dummy Batches stored and then threw away full road geometry: about a third of the collider
  // job). Same props (checked with debugProps on 60 tiles). ?propsink=0 = old dummy batches.
  const SINK_ARR = {
    push() {
      return 0;
    },
    length: 0,
  };
  class SinkBatch {
    constructor() {
      this.p = SINK_ARR;
      this.n = SINK_ARR;
      this.uv = SINK_ARR;
      this.c = SINK_ARR;
    }
    vert() {}
    addGeometry() {}
    addGeometryWorldUV() {}
    hquad() {}
    get empty() {
      return true;
    }
  }
  const sinkSet = () => ({
    guard: new SinkBatch(),
    asphalt: new SinkBatch(),
    marks: new SinkBatch(),
    sidewalk: new SinkBatch(),
    trim: new SinkBatch(),
  });
  function* ensureProps(t, tile, sinkMode = PROPS_SINK) {
    if (t.props) return t.props;
    const props = newProps();
    seedRealProps(props, tile);
    const dummy = sinkMode
      ? sinkSet()
      : {
          guard: new Batch(),
          asphalt: new Batch(),
          marks: new Batch(),
          sidewalk: new Batch(),
          trim: new Batch(),
        };
    const it = buildRoads(dummy, tile, props, null);
    for (let r = it.next(); !r.done; r = it.next()) {
      if (!sinkMode) {
        dummy.guard = new Batch();
        dummy.asphalt = new Batch();
        dummy.marks = new Batch();
        dummy.sidewalk = new Batch();
        dummy.trim = new Batch();
      }
      yield;
    }
    cleanProps(tile, props);
    if (SK) {
      shelterClear(props);
      workZones(tile, props);
      propJitter(props);
    }
    if (tile.relief && D) liftProps(props);
    syncKids(props);
    if (flora && terrain && terrain.synthetic(t.tx, t.tz)) yield* floraInto(t, tile, props);
    t.props = props;
    return props;
  }
  // procedural fallbacks + bus shelter / bin variants
  const shelterG = mergeParts([
    [BOXG, m4(0, 2.55, 0, 0, 4.2, 0.12, 1.9), 0xf4f4f4],
    [BOXG, m4(0, 1.3, -0.75, 0, 4.0, 2.2, 0.05), 0x9fc6d4],
    [BOXG, m4(-2.0, 1.3, 0, 0, 0.08, 2.5, 1.7), 0x606a70],
    [BOXG, m4(2.0, 1.3, 0, 0, 0.08, 2.5, 1.7), 0x606a70],
    [BOXG, m4(0, 0.48, -0.45, 0, 3.0, 0.08, 0.4), 0xb07a4a],
    [BOXG, m4(0, 2.66, 0.9, 0, 4.2, 0.18, 0.08), 0x2ec4b6],
  ]);
  const vcMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.5,
    metalness: 0.3,
  });
  const upoleMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.85,
    metalness: 0.05,
  });
  const upoleG = mergeParts([
    [new THREE.CylinderGeometry(0.11, 0.15, 10, 10), m4(0, 5, 0), 0x6b5543],
    [BOXG, m4(0, 9.55, 0, 0, 2.3, 0.12, 0.12), 0x5e4a3a],
    [BOXG, m4(0, 9.2, 0, 0, 1.4, 0.08, 0.08), 0x5e4a3a],
    ...[-0.95, 0, 0.95].map((o) => [
      new THREE.CylinderGeometry(0.05, 0.06, 0.2, 8),
      m4(o, 9.72, 0),
      0xdfe6e8,
    ]),
    [new THREE.CylinderGeometry(0.28, 0.28, 0.85, 12), m4(0, 8.2, 0.32), 0x8a9094],
  ]);
  if (typeof M.detail === 'function') {
    M.detail(upoleMat, 'wood', 2.2, 0.9);
    M.detail(vcMat, 'paint', 1.6, 0.7);
    M.detail(hutMat, 'wood', 1.4, 0.8);
    M.detail(pierMat, 'concrete', 0.7, 0.8);
    M.detail(containerMat, 'ribs', 0.45, 0.8);
    M.detail(acMat, 'metal', 1.0, 0.7);
  }
  const binG = [
    mergeParts([
      [new THREE.CylinderGeometry(0.3, 0.27, 0.95, 12), m4(0, 0.48, 0), 0x2f5d50],
      [new THREE.CylinderGeometry(0.33, 0.33, 0.08, 12), m4(0, 0.98, 0), 0x223f37],
    ]),
    mergeParts([
      [BOXG, m4(0, 0.5, 0, 0, 0.62, 1.0, 0.55), 0x2a6fdb],
      [BOXG, m4(0, 1.03, -0.02, 0, 0.66, 0.06, 0.6), 0x1d4fa0],
    ]),
  ];
  const benchG = mergeParts([
    [BOXG, m4(0, 0.45, 0, 0, 1.8, 0.07, 0.5), 0xb07a4a],
    [BOXG, m4(0, 0.75, -0.24, 0, 1.8, 0.45, 0.06), 0xb07a4a],
    [BOXG, m4(-0.75, 0.22, 0, 0, 0.08, 0.45, 0.5), 0x333333],
    [BOXG, m4(0.75, 0.22, 0, 0, 0.08, 0.45, 0.5), 0x333333],
  ]);
  const hydrantG = mergeParts([
    [new THREE.CylinderGeometry(0.14, 0.17, 0.6, 10), m4(0, 0.3, 0), 0xd8261c],
    [
      new THREE.SphereGeometry(0.15, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2),
      m4(0, 0.6, 0),
      0xd8261c,
    ],
  ]);
  const litterG = new THREE.BoxGeometry(0.16, 0.01, 0.22),
    litterMat = new THREE.MeshStandardMaterial({ roughness: 0.8 });
  if (M.propify) {
    try {
      M.propify(sigMat, 'paint');
      M.propify(containerMat, 'rustPaint');
      M.propify(blobMat, 'plaster');
      M.propify(hutMat, 'paint');
      M.propify(umbMat, 'plastic');
      M.propify(boatMat, 'plastic');
      M.propify(acMat, 'galv');
      M.propify(pierMat, 'concrete');
      M.propify(vcMat, 'paint');
      M.propify(upoleMat, 'creosote');
      M.propify(litterMat, 'plastic');
    } catch (e) {
      console.warn('[miami] prop PBR', e);
    }
  }
  // ---- street furniture kit (stage 1 jobs 4-5, src/world/miami/streetkit.js): the user's library models instead of code boxes.
  // Every part is one global instance pool (inst), so a furniture type costs one draw call per material for the whole city.
  const SK = ctx.street || null;
  const sigStats = { nodes: 0, poles: 0, heads: 0, peds: 0, skipped: 0 };
  const pipXZ = (P, x, z) => {
    let c = false;
    for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
      const xi = P[i][0],
        zi = P[i][1],
        xj = P[j][0],
        zj = P[j][1];
      if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
    }
    return c;
  };
  function placeSignals(props, n, J, tile) {
    // full US signal layout for one job-4 junction (signals.js)
    const G = D && D.roadGraph;
    if (!G) return;
    const landing = (x, z) => {
      const dx = x - n.x,
        dz = z - n.z;
      for (const L of J.legs) {
        if (L.cw) {
          const s = dx * L.dx + dz * L.dz,
            lat = Math.abs(-dx * L.dz + dz * L.dx);
          if (s > L.cw[0] - 0.55 && s < L.cw[1] + 0.55 && lat > L.hw - 0.5 && lat < L.hw + 2.2)
            return true;
        }
        for (const rp of L.ramps || []) if (pipXZ(rp.cut, x, z)) return true;
      }
      return false;
    };
    const trunk = (x, z) =>
      (props.palm || []).some((p) => (p.x - x) ** 2 + (p.z - z) ** 2 < 1.2) ||
      (props.tree || []).some((p) => (p.x - x) ** 2 + (p.z - z) ** 2 < 1.3);
    const ok = (x, z) =>
      !(isWater && isWater(x, z)) &&
      !insideBuilding(tile, x, z) &&
      (!roadDist || roadDist(x, z) > 0.4) &&
      !pipXZ(J.poly, x, z) &&
      !landing(x, z) &&
      !trunk(x, z) &&
      !(houseLots.reserved.length && houseLots.reservedAt(x, z, 0.4));
    const L = safeCall(() => signalLayout(G, n, J, { ok, y: (x, z) => gY0(x, z) }), null);
    if (!L) return;
    const kid = (it) => {
      it._ky = it.y - it.pole.y;
      return it;
    };
    for (const p of L.poles) props.sigPole.push(p);
    for (const p of L.pedPosts) props.pedPost.push(p);
    for (const a of L.arms) props.sigArm.push(kid(a));
    for (const h of L.heads) props.sigHead.push(kid(h));
    for (const h of L.peds) props.pedHead.push(kid(h));
    for (const b of L.blades) props.blade.push(kid(b));
    for (const c of L.cabinets) props.cabinet.push(c);
    sigStats.nodes++;
    sigStats.poles += L.poles.length;
    sigStats.heads += L.heads.length;
    sigStats.peds += L.peds.length;
    sigStats.skipped += L.skipped;
  }
  // furniture landing zones at job-4 junctions: the crosswalk band across the sidewalk and the curb ramps (+ margin r)
  function nearCrossing(x, z, r = 0.3) {
    const c = JGRID.get(Math.floor(x / 32) * 100003 + Math.floor(z / 32));
    if (!c) return false;
    for (const J of c) {
      const dx = x - J.node.x,
        dz = z - J.node.z;
      if (dx * dx + dz * dz > 3600) continue;
      for (const L of J.legs) {
        if (L.cw) {
          const s = dx * L.dx + dz * L.dz,
            lat = Math.abs(-dx * L.dz + dz * L.dx);
          if (
            s > L.cw[0] - 0.9 - r &&
            s < L.cw[1] + 0.9 + r &&
            lat > L.hw - 0.5 &&
            lat < L.hw + 3.4
          )
            return true;
        }
        for (const rp of L.ramps || []) if (pipXZ(rp.cut, x, z)) return true;
      }
    }
    return false;
  }
  // items at curb height that are not on a drawn sidewalk slab (Keys / rural roads without sidewalks, slab-less tiles):
  // furniture slides toward the curb onto a slab when one is right there, else it stands on the ground; poles are set 8 cm
  // into the ground (never a floating base). Items next to a slab edge or a tile seam are left to the clipping sweep (snapY).
  function floorFix(tile, props) {
    const slab = props._slab,
      near = roadIndex(tile),
      S0 = tile.size || provider.tileSize || 200,
      x0 = tile.x0 ?? tile.tx * S0,
      z0 = tile.z0 ?? tile.tz * S0;
    const POLE = /lamp|upole|signPost|sigPole|pedPost|mast/;
    for (const k of [
      'mast',
      'lamp',
      'bench',
      'bin',
      'hydrant',
      'signPost',
      'meter',
      'mailbox',
      'upole',
      'shelter',
      'sigPole',
      'pedPost',
      'cabinet',
    ])
      for (const p of props[k] || []) {
        const y = p.y || 0;
        if (p.elev || y > 0.3 || y < 0.1) continue;
        if (slab) {
          if (slab(p.x, p.z) !== null) continue;
          let moved = false; // furniture first slides toward the curb onto the slab (sidewalks drawn narrower than the nominal 3 m)
          if (!POLE.test(k) && k !== 'cabinet') {
            const q = near(p.x, p.z),
              r = k === 'bench' ? 0.5 : 0.3;
            if (q.gap < 1e8)
              for (const d of [0.3, 0.6, 0.9, 1.2, 1.5]) {
                const x2 = p.x - q.nx * d,
                  z2 = p.z - q.nz * d;
                if (
                  near(x2, z2).gap > r + 0.3 &&
                  slab(x2, z2) !== null &&
                  slab(x2 + q.nx * r, z2 + q.nz * r) !== null
                ) {
                  p.x = x2;
                  p.z = z2;
                  p.y = slab(x2, z2);
                  moved = true;
                  break;
                }
              }
          }
          if (moved) {
            placeStats.floorFixed = (placeStats.floorFixed || 0) + 1;
            continue;
          }
          if (p.x - x0 < 3 || x0 + S0 - p.x < 3 || p.z - z0 < 3 || z0 + S0 - p.z < 3) continue;
          let edge = false;
          for (const [dx, dz] of [
            [2.5, 0],
            [-2.5, 0],
            [0, 2.5],
            [0, -2.5],
          ])
            if (slab(p.x + dx, p.z + dz) !== null) {
              edge = true;
              break;
            }
          if (edge) continue;
        }
        const g = gY0(p.x, p.z);
        p.y = (g < 0.1 ? g : 0.04) - (POLE.test(k) ? 0.08 : 0);
        placeStats.floorFixed = (placeStats.floorFixed || 0) + 1;
      }
  }
  // no palm or street tree inside a bus shelter or in its boarding area (the shelter is a single occupancy circle)
  const SHELTER_L = { shelter_glass: 5.3, shelter_long: 7.5, shelter_black: 4.3, shelter_old: 3.3 };
  function shelterClear(props) {
    if (!props.shelter.length) return;
    const boxes = props.shelter.map((p) => ({
      p,
      hl: (SHELTER_L[VARIANT.shelter(p)] || 4.5) / 2 + 0.6,
      s: Math.sin(p.ry || 0),
      c: Math.cos(p.ry || 0),
    }));
    const inside = (t) =>
      boxes.some(({ p, hl, s, c }) => {
        const dx = t.x - p.x,
          dz = t.z - p.z,
          a = dx * c - dz * s,
          f = dx * s + dz * c;
        return Math.abs(a) < hl && f > -1.5 && f < 2.6;
      });
    for (const k of ['palm', 'tree', 'bench', 'bin', 'bike', 'signPost', 'hydrant', 'meter']) {
      const L = props[k];
      if (!L || !L.length) continue;
      const keep = L.filter((t) => t.cs || !inside(t));
      if (keep.length !== L.length) {
        placeStats.shelterCleared = (placeStats.shelterCleared || 0) + L.length - keep.length;
        L.length = 0;
        L.push(...keep);
      }
    }
  }
  function syncKids(props) {
    for (const k of ['sigArm', 'sigHead', 'pedHead', 'blade'])
      for (const it of props[k] || [])
        if (it.pole && it._ky !== undefined) it.y = it.pole.y + it._ky;
  }
  const sigColor = (it) => {
    if (!it.color)
      it.color = new THREE.Color().setRGB(
        it.sig[0],
        it.sig[1],
        it.sig[2],
        THREE.LinearSRGBColorSpace,
      );
    return it;
  };
  // props pass: parts with texture variants (streetkit kit.variants, src/world/props/variants.v2.js) draw with per-instance
  // variant data (layer, brightness, sun fade) in the instance color; every other part of the model draws as before
  const _vc = new THREE.Color();
  const varOf = (it, n) => {
    if (it.vl === undefined) it.vl = Math.floor(h2(it, 9) * n) % n;
    if (it.vb === undefined) it.vb = 0.88 + h2(it, 10) * 0.2;
    if (it.vf === undefined) it.vf = h2(it, 11) < 0.3 ? h2(it, 12) * 0.3 : 0;
    return new THREE.Color().copy(variantColor(it.vl % n, it.vb, it.vf, _vc));
  };
  const kitParts = (group, name, items, opts = {}) => {
    const P = SK.parts[name];
    if (!P || !items.length) return;
    const vn = SK.variants?.[name];
    for (const q of P) {
      if (vn && q.material === vn.material)
        inst(
          group,
          q.geometry,
          q.material,
          items.map((it) => ({ ...it, color: varOf(it, vn.n) })),
          { ...opts, colors: true },
        );
      else inst(group, q.geometry, q.material, items, opts);
    }
  };
  const zoneKind = (x, z) => {
    const zn = String(zoneAt(x, z) || '');
    return /downtown|business|brickell|midtown/.test(zn)
      ? 'urban'
      : /beach|nightlife|park/.test(zn)
        ? 'beach'
        : /commercial|arts|edgewater|overtown/.test(zn)
          ? 'commercial'
          : /industrial|port/.test(zn)
            ? 'industrial'
            : 'res';
  };
  const h2 = (it, k = 0) => hash(((it.x * 7.3) | 0) * 131 + ((it.z * 5.1) | 0) + k * 977);
  // per-kind variant pickers (by zone, deterministic per spot)
  const VARIANT = {
    hydrant: (it) => (h2(it) < 0.55 ? 'hydrant_a' : 'hydrant_b'),
    bin: (it) => {
      const zk = zoneKind(it.x, it.z);
      if (it.k === 3) return 'bin_wheel';
      if (it.k === 4) return 'bin_set';
      return zk === 'urban' || zk === 'commercial'
        ? 'bin_metal'
        : zk === 'beach'
          ? 'bin_wood'
          : zk === 'industrial'
            ? 'bin_wheel'
            : h2(it, 1) < 0.5
              ? 'bin_wood'
              : 'bin_metal';
    },
    shelter: (it) => {
      const zk = zoneKind(it.x, it.z);
      return zk === 'urban'
        ? h2(it, 2) < 0.65
          ? 'shelter_glass'
          : 'shelter_long'
        : zk === 'beach' || zk === 'commercial'
          ? 'shelter_black'
          : 'shelter_old';
    },
    bench: (it) => {
      const zk = zoneKind(it.x, it.z);
      return zk === 'urban' || zk === 'commercial' ? 'bench_iron' : 'bench_wood';
    },
    mailbox: (it) =>
      it.v ||
      (zoneKind(it.x, it.z) === 'urban'
        ? 'mailbox_drop'
        : h2(it, 3) < 0.5
          ? 'mailbox_twin'
          : 'mailbox_post'),
    work: (it) => it.v, // work zones / construction sites: cone, channelizer, tc_bollard, barricade2, jersey, rolloff, site_cabin, tarp_crates
  };
  VARIANT.bin = ((pick) => (it) => {
    const v = pick(it);
    return v === 'bin_set'
      ? 'cart'
      : v === 'bin_metal' && zoneKind(it.x, it.z) === 'commercial' && h2(it, 4) < 0.3
        ? 'bin_commercial'
        : v;
  })(VARIANT.bin);
  // props pass: no two neighbors alike. Layers are picked per item from a position hash, then bumped until no item of the
  // same model within 14 m (earlier in the list) shows the same layer; size +-7 %, a small yaw jitter and a slight lean.
  const JIT = {
    bin: [0.06, 0.25, 0.02],
    hydrant: [0.04, 0.5, 0.008],
    mailbox: [0.05, 0.08, 0.035],
    bench: [0.03, 0.02, 0],
    meter: [0.03, 0.06, 0.012],
    signPost: [0, 0.05, 0.02],
    upole: [0, 0, 0.006],
    work: [0.05, 0.12, 0.01],
  };
  function propJitter(props) {
    if (props._jit) return;
    props._jit = true;
    for (const kind in JIT) {
      const [ds, dy, dl] = JIT[kind];
      for (const it of props[kind] || []) {
        if (it._j || it.m) continue;
        it._j = 1;
        if (ds && !it.sx && (kind !== 'work' || /cone|chair|channelizer|tc_bollard/.test(it.v)))
          it.s = (it.s || 1) * (1 + (h2(it, 21) - 0.5) * 2 * ds);
        it.ry = (it.ry || 0) + (h2(it, 22) - 0.5) * 2 * dy;
        if (dl) {
          it.rx = (h2(it, 23) - 0.5) * 2 * dl;
          it.rz = (h2(it, 24) - 0.5) * 2 * dl;
        }
      }
    }
  }
  function assignVariants(name, list) {
    const vn = SK.variants?.[name];
    if (!vn) return;
    const n = vn.n,
      R2 = 14 * 14;
    for (let i = 0; i < list.length; i++) {
      const it = list[i];
      if (it.vlFixed) continue;
      let l = Math.floor(h2(it, 9) * n) % n;
      for (let tries = 0; tries < n; tries++) {
        let clash = false;
        for (let j = Math.max(0, i - 40); j < i; j++) {
          const o = list[j];
          if (o.vl === l && (o.x - it.x) ** 2 + (o.z - it.z) ** 2 < R2) {
            clash = true;
            break;
          }
        }
        if (!clash) break;
        l = (l + 1) % n;
      }
      it.vl = l;
    }
  }
  // props pass: a prop the player / a car moved keeps its resting pose across tile rebuilds (dynamicProps saves it here)
  const movedProps = new Map(),
    movedKey = (kind, p) => kind + ':' + Math.round(p.x * 10) + ',' + Math.round(p.z * 10);
  function withMoved(kind, items) {
    if (movedProps.size)
      for (const it of items) {
        const m = movedProps.get(movedKey(kind, it));
        if (m) it.m = m;
      }
    return items;
  }
  function kitVar(group, kind, items, tagVis) {
    if (!items.length) return;
    const by = {};
    withMoved(kind, items);
    for (const it of items) {
      const v = VARIANT[kind](it);
      (by[v] ||= []).push(it);
    }
    for (const v in by) {
      assignVariants(v, by[v]);
      const fn = (list) =>
        kitParts(group, v, list, {
          cast:
            kind === 'shelter' ||
            kind === 'bench' ||
            kind === 'work' ||
            kind === 'mailbox' ||
            kind === 'bin',
        });
      if (tagVis) tagVis(by[v], fn);
      else fn(by[v]);
    }
  }
  // props pass: write a moved prop's pose (or null = hidden) into the pool instances that draw it (like hideProp)
  function setPropMatrix(t, kind, p, m) {
    const list = (t.props && t.props[kind]) || [];
    let q = p._vis ? p : null;
    if (!q)
      for (const c of list)
        if (c._vis && Math.abs(c.x - p.x) < 0.05 && Math.abs(c.z - p.z) < 0.05) {
          q = c;
          break;
        }
    if (!q) return false;
    if (!q._loc) {
      // each part's instance matrix relative to the item's base pose (sign plates sit above their post, etc.)
      const base =
        q.m && q.m.length === 16
          ? new THREE.Matrix4().fromArray(q.m)
          : new THREE.Matrix4().compose(
              new THREE.Vector3(q.x, q.y || 0, q.z),
              new THREE.Quaternion().setFromEuler(new THREE.Euler(q.rx || 0, q.ry || 0, q.rz || 0)),
              new THREE.Vector3().setScalar(q.s || 1),
            );
      const inv = base.invert();
      q._loc = q._vis.map(([h, k]) => {
        const i = h.idx[k];
        return i !== undefined && h.p && i < h.p.count
          ? inv.clone().multiply(new THREE.Matrix4().fromArray(h.p.src, i * 16))
          : new THREE.Matrix4();
      });
    }
    q._vis.forEach(([h, k], j) => {
      const i = h.idx[k];
      if (i === undefined || !h.p || i >= h.p.count) return;
      if (!m) {
        poolSetMatrix(h.p, i, _zeroM);
        return;
      }
      _pm2.copy(m).multiply(q._loc[j]);
      poolSetMatrix(h.p, i, _pm2);
    });
    return true;
  }
  const _pm2 = new THREE.Matrix4();
  // curb regulation signs: library U-channel post + NO PARKING / NO STANDING plate (one plate type per tile, alternating)
  function kitSigns(group, items, tagVis) {
    const S = SK.signs;
    if (movedProps.size) items = items.filter((p) => !movedProps.has(movedKey('signPost', p)));
    if (!items.length || !S.post) return; // props pass: a knocked-down post is gone after a rebuild
    const plate =
      (hash(((items[0].x / 200) | 0) * 31 + ((items[0].z / 200) | 0)) < 0.6
        ? S.noparking
        : S.nostanding) || S.noparking;
    tagVis(items, (list) => {
      inst(
        group,
        S.post.geometry,
        S.post.material,
        list.map((p) => ({
          x: p.x,
          y: p.y || 0,
          z: p.z,
          ry: p.ry || 0,
          sx: 2.4,
          sy: 2.75,
          sz: 2.4,
        })),
        { cast: true },
      );
      if (plate)
        inst(
          group,
          plate.geometry,
          plate.material,
          list.map((p) => ({
            x: p.x + Math.sin(p.ry || 0) * 0.04,
            y: (p.y || 0) + 2.25,
            z: p.z + Math.cos(p.ry || 0) * 0.04,
            ry: p.ry || 0,
          })),
          { cast: true },
        );
    });
  }
  function furnish(group, props) {
    // benches, parking meters, mailboxes
    kitVar(group, 'bench', props.bench, null);
    kitParts(group, 'meter', props.meter, { cast: true });
    kitVar(group, 'mailbox', props.mailbox, null);
  }
  // luminaire position (pole-local reach r along +Z, height y) per lamp model, from the glowing lens part's bounds
  const lampHeadCache = {};
  function lampHeadOf(name) {
    if (lampHeadCache[name]) return lampHeadCache[name];
    let r = { r: 2.4, y: 8.3 };
    for (const q of SK.parts[name] || [])
      if (q.material.userData.lampLens) {
        q.geometry.computeBoundingBox();
        const b = q.geometry.boundingBox;
        r = { r: (b.min.z + b.max.z) / 2, y: b.min.y };
        break;
      }
    return (lampHeadCache[name] = r);
  }
  const lampModel = (l) => l.t || (l.s && l.s < 0.9 ? 'lantern_post' : 'lamp_single');
  const lampHeadAt = (l) => {
    const m = lampModel(l),
      h = lampHeadOf(m);
    return m === 'lamp_single' || m === 'lamp_twin'
      ? { r: h.r / (l.s && l.s > 1.2 ? 1 : 1), y: h.y }
      : h;
  };
  function kitLamps(group, lamps) {
    const by = {};
    for (const l of lamps) {
      const m = lampModel(l),
        it = m === 'lamp_single' && (l.s || 1) > 1.2 ? { ...l, s: 1.1 } : l;
      (by[m] ||= []).push(it);
      if (it !== l) l.s = 1.1;
    }
    for (const m in by) kitParts(group, m, by[m], { cast: true });
  }
  // wooden utility poles: davit lamp bolted on every pole that carries one (Keys lanes, suburbs)
  const UP_LAMP_Y = 1.7;
  function kitUpoleLamps(group, poles) {
    const L = poles
      .filter((p) => p.lamp)
      .map((p) => ({ x: p.x, y: (p.y || 0) + UP_LAMP_Y, z: p.z, ry: p.lampRy }));
    kitParts(group, 'lamp_arm', L, { cast: true });
  }
  function upoleLampsOf(poles) {
    const h = lampHeadOf('lamp_arm');
    return poles
      .filter((p) => p.lamp)
      .map((p) => ({
        x: p.x + Math.sin(p.lampRy) * h.r,
        y: (p.y || 0) + UP_LAMP_Y + h.y,
        z: p.z + Math.cos(p.lampRy) * h.r,
        gy: p.y || 0,
      }));
  }
  // signals: poles, truss arms, heads + lit lenses, pedestrian heads, controller cabinets, street-name blades on the arms
  function kitSignals(group, props) {
    const S = SK.signal;
    if (!S.pole) return;
    inst(group, S.pole.geometry, S.pole.material, props.sigPole.concat(props.pedPost), {
      cast: true,
    });
    if (S.arm) inst(group, S.arm.geometry, S.arm.material, props.sigArm, { cast: true });
    const heads = props.sigHead.map(sigColor),
      peds = props.pedHead.map(sigColor);
    if (S.head) inst(group, S.head.geometry, S.head.material, heads, { cast: true });
    for (const k of ['lensR', 'lensA', 'lensG'])
      if (S[k]) inst(group, S[k].geometry, S[k].material, heads, { colors: true });
    if (S.ped) inst(group, S.ped.geometry, S.ped.material, peds, { cast: true });
    for (const k of ['pedWalk', 'pedDont'])
      if (S[k]) inst(group, S[k].geometry, S[k].material, peds, { colors: true });
    kitParts(group, 'cabinet', props.cabinet, { cast: true });
    if (props.blade.length) bladeMesh(group, props.blade);
  }
  // street-name blades on the mast arms: per-tile atlas (Miami-Dade style labels, src/world/signs), one quad per side so the
  // text reads correctly from both directions
  function bladeMesh(group, blades) {
    const labels = new Map();
    for (const b of blades) if (!labels.has(b.name)) labels.set(b.name, labels.size);
    const cols = 2,
      rows = Math.ceil(labels.size / cols),
      CW = 512,
      CH = 96,
      cv = document.createElement('canvas');
    cv.width = cols * CW;
    cv.height = Math.max(1, rows) * CH;
    const x = cv.getContext('2d');
    for (const [nm, i] of labels) {
      try {
        drawBlade(
          x,
          { name: nm, label: bladeLabel(nm), block: null },
          (i % cols) * CW,
          ((i / cols) | 0) * CH,
          CW,
          CH,
        );
      } catch (e) {
        x.fillStyle = '#0f6b3a';
        x.fillRect((i % cols) * CW, ((i / cols) | 0) * CH, CW, CH);
      }
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    const P = [],
      N = [],
      U = [];
    for (const b of blades) {
      const i = labels.get(b.name),
        u0 = (i % cols) / cols,
        u1 = u0 + 1 / cols,
        v1 = 1 - ((i / cols) | 0) / rows,
        v0 = v1 - 1 / rows,
        hl = b.len / 2,
        h = (b.len * CH) / CW / 2;
      const fx = b.dz,
        fz = -b.dx; // signal face direction (toward approaching drivers)
      for (const f of [1, -1]) {
        // f = 1: the face seen by approaching drivers (text runs along -arm), f = -1: the back
        const nx = fx * f,
          nz = fz * f,
          o = 0.03,
          ax = b.x - b.dx * hl * -f + nx * o,
          az = b.z - b.dz * hl * -f + nz * o,
          bx = b.x + b.dx * hl * -f + nx * o,
          bz = b.z + b.dz * hl * -f + nz * o;
        const q = [
          [ax, b.y - h, az, u0, v0],
          [bx, b.y - h, bz, u1, v0],
          [bx, b.y + h, bz, u1, v1],
          [ax, b.y - h, az, u0, v0],
          [bx, b.y + h, bz, u1, v1],
          [ax, b.y + h, az, u0, v1],
        ];
        for (const t of q) {
          P.push(t[0], t[1], t[2]);
          N.push(nx, 0, nz);
          U.push(t[3], t[4]);
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
    g.computeBoundingSphere();
    const m = new THREE.MeshStandardMaterial({
      map: tex,
      roughness: 0.45,
      metalness: 0.1,
      name: 'arm-blades',
    });
    const mesh = new THREE.Mesh(g, m);
    mesh.name = 'signal-blades';
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    mesh.userData.ownedMaterial = m;
    m.userData.ownedTexture = tex;
    group.add(mesh);
  }
  // Keys / rural lanes (no curbs, no sidewalks): wooden utility poles with overhead lines and a davit lamp on every second pole,
  // (carts + mailboxes per house: src/world/props/lotProps.v2.js; STOP signs come from the road graph: src/world/signs/regulatory.v2.js)
  function keysLane(B, props, r, fr, L, hw, a, b, tile) {
    const eid = r.edgeId ?? r.id ?? 0,
      side = hash(eid * 13 + 1) < 0.5 ? 1 : -1,
      off = hw + 1.7;
    const ok = (x, z, rad = 0.3) =>
      !(isWater && isWater(x, z)) &&
      !insideBuilding(tile, x, z) &&
      (!roadDist || roadDist(x, z) > rad + 0.5) &&
      !inJunction(x, z) &&
      !(houseLots.reserved.length && houseLots.reservedAt(x, z, 0.5));
    let prev = null,
      k = 0;
    for (let s = a + 6 + hash(eid * 3) * 10; s < b - 5; s += 40 + hash(eid + s) * 6) {
      const q = sampleAt(fr, s),
        nl = Math.hypot(q.nx, q.nz) || 1,
        nx = q.nx / nl,
        nz = q.nz / nl,
        x = q.x + nx * side * off,
        z = q.z + nz * side * off;
      if (!ok(x, z)) {
        prev = null;
        continue;
      }
      const pole = {
        x,
        y: gY0(x, z),
        z,
        ry: Math.atan2(nx * side, nz * side),
        top: 9.5,
        lamp: (k++ & 1) === 0,
        lampRy: Math.atan2(-nx * side, -nz * side),
      };
      props.upole.push(pole);
      if (prev && B && B.guard) wireSpan(B, prev, pole);
      prev = pole;
    }
    // carts and mailboxes: one mailbox + a trash / recycling pair per HOUSE at its driveway (src/world/props/lotProps.v2.js,
    // fed by the house generator's lots), no longer sprinkled along the lane (that made clusters of 3-5 mailboxes)
  }
  // props pass: work zones and construction sites from the user's library (cones, channelizers, ROAD CLOSED barricades,
  // striped jersey barriers, roll-off dumpster, site cabin, tarp-covered crates). Deterministic per road / building.
  //   - tower sites: every topping-out tower (buildTower marks b._site) gets a jersey-barrier fence with a gate toward the
  //     street, a site cabin, a roll-off and covered material on the free side
  //   - renovations: ~2 % of low downtown / commercial buildings get a roll-off at the curb in front, cones and a barricade
  //   - curb work: ~4 % of curbed streets get a coned-off strip along the curb (gutter / sidewalk repair) with barricades
  function workZones(tile, props) {
    if (props._work || !SK || !SK.parts.cone) return;
    props._work = true;
    const W = props.work,
      ri = roadIndex(tile, true),
      T0 = provider.tileSize || 200,
      X0 = tile.x0 ?? tile.tx * T0,
      Z0 = tile.z0 ?? tile.tz * T0;
    const inTile = (x, z) => x >= X0 && x < X0 + T0 && z >= Z0 && z < Z0 + T0;
    const yAt = (x, z, onRoad) => (onRoad ? 0 : onSidewalk && onSidewalk(x, z) ? CURB : gY0(x, z));
    const free = (x, z, r, road = false) =>
      inTile(x, z) &&
      !(isWater && isWater(x, z)) &&
      !insideBuilding(tile, x, z) &&
      (road ? true : ri(x, z).gap > r) &&
      !inJunction(x, z) &&
      !W.some((w) => (w.x - x) ** 2 + (w.z - z) ** 2 < (r + 0.25) ** 2);
    const put = (v, x, z, ry, onRoad = false, r = 0.3) => {
      if (!free(x, z, r, onRoad)) return null;
      const it = { v, x, y: yAt(x, z, onRoad), z, ry };
      W.push(it);
      return it;
    };
    // tower sites
    for (const b of tile.buildings || []) {
      if (!b._site || !b.rings || !b.rings[0]) continue;
      const ring = b.rings[0],
        n = ring.length;
      let cx = 0,
        cz = 0;
      for (const [x, z] of ring) {
        cx += x;
        cz += z;
      }
      cx /= n;
      cz /= n;
      const rd = D?.roadGraph?.nearestEdge?.(cx, cz, {}, 120),
        gx = rd ? rd.point.x - cx : 0,
        gz = rd ? rd.point.z - cz : 1;
      let gate = -1,
        gbest = -2;
      for (let i = 0; i < n; i++) {
        const a = ring[i],
          c = ring[(i + 1) % n],
          mx = (a[0] + c[0]) / 2 - cx,
          mz = (a[1] + c[1]) / 2 - cz,
          d = (mx * gx + mz * gz) / (Math.hypot(mx, mz) * Math.hypot(gx, gz) || 1);
        if (d > gbest) {
          gbest = d;
          gate = i;
        }
      }
      for (let i = 0; i < n; i++) {
        const a = ring[i],
          c = ring[(i + 1) % n],
          ex = c[0] - a[0],
          ez = c[1] - a[1],
          L = Math.hypot(ex, ez);
        if (L < 3) continue;
        const ux = ex / L,
          uz = ez / L;
        let ox = uz,
          oz = -ux;
        if ((a[0] + ex / 2 - cx) * ox + (a[1] + ez / 2 - cz) * oz < 0) {
          ox = -ox;
          oz = -oz;
        }
        const off = 2.6,
          ry = Math.atan2(ux, uz) + Math.PI / 2;
        for (let t = 1.1; t < L - 1.0; t += 2.08) {
          if (i === gate && Math.abs(t - L / 2) < 3.5) {
            if (Math.abs(t - L / 2) > 2.4)
              put(
                'barricade2',
                a[0] + ux * t + ox * (off + 0.8),
                a[1] + uz * t + oz * (off + 0.8),
                ry,
                false,
                0.5,
              );
            continue;
          }
          put('jersey', a[0] + ux * t + ox * off, a[1] + uz * t + oz * off, ry, false, 0.4);
        }
      }
      // cabin / roll-off / material on the side facing away from the gate street (else whichever side has room)
      const cands = [];
      for (let i = 0; i < n; i++) {
        const a = ring[i],
          c = ring[(i + 1) % n],
          mx = (a[0] + c[0]) / 2,
          mz = (a[1] + c[1]) / 2,
          dx = mx - cx,
          dz = mz - cz,
          L = Math.hypot(dx, dz) || 1;
        cands.push({
          x: mx + (dx / L) * 8.5,
          z: mz + (dz / L) * 8.5,
          ry: Math.atan2(dx, dz),
          score: -(dx * gx + dz * gz) / (L * (Math.hypot(gx, gz) || 1)),
        });
      }
      cands.sort((p, q) => q.score - p.score);
      const pieces = [
        ['site_cabin', 4.4],
        ['rolloff', 3.2],
        ['tarp_crates', 1.8],
      ];
      for (const c of cands) {
        if (!pieces.length) break;
        const [v, r] = pieces[0];
        const sx = Math.cos(c.ry),
          sz = -Math.sin(c.ry);
        for (const k of [0, -1, 1]) {
          const x = c.x + sx * k * (r + 3),
            z = c.z + sz * k * (r + 3);
          if (put(v, x, z, c.ry, false, r)) {
            pieces.shift();
            break;
          }
        }
      }
    }
    // renovations at low downtown / commercial buildings: roll-off at the curb, cones around it, a barricade
    for (const b of tile.buildings || []) {
      if (b.part || !b.rings || !(b.h < 40) || hash(((b.id || 0) * 13 + 7) | 0) > 0.022) continue;
      const ring = b.rings[0];
      let cx = 0,
        cz = 0;
      for (const [x, z] of ring) {
        cx += x;
        cz += z;
      }
      cx /= ring.length;
      cz /= ring.length;
      const zk = zoneKind(cx, cz);
      if (zk !== 'urban' && zk !== 'commercial') continue;
      const rd = D?.roadGraph?.nearestEdge?.(cx, cz, {}, 60);
      if (!rd || !/secondary|tertiary|residential|unclassified/.test(rd.edge.kind || '')) continue;
      const hw = rd.edge.width / 2,
        dx = rd.dir.x,
        dz = rd.dir.z,
        nx = cx - rd.point.x,
        nz = cz - rd.point.z,
        nl = Math.hypot(nx, nz) || 1,
        ox = nx / nl,
        oz = nz / nl;
      if (
        hw < 6 ||
        W.some((w) => w.v === 'rolloff' && (w.x - cx) ** 2 + (w.z - cz) ** 2 < 120 * 120)
      )
        continue; // only where there is a parking lane; one per block
      const px = rd.point.x + ox * (hw - 1.05),
        pz = rd.point.z + oz * (hw - 1.05),
        ry = Math.atan2(dx, dz) + Math.PI / 2;
      if (!put('rolloff', px, pz, ry, true, 1.2)) continue;
      for (const t of [-4.2, 4.2])
        put(
          'cone',
          px + dx * t - ox * 1.25,
          pz + dz * t - oz * 1.25,
          hash(t * 7 + cx) * 6,
          true,
          0.25,
        );
      for (const t of [-3.0, 0, 3.0])
        put(
          'cone',
          px + dx * t - ox * 1.6,
          pz + dz * t - oz * 1.6,
          hash(t * 3 + cz) * 6,
          true,
          0.25,
        );
      put('barricade2', px - dx * 6, pz - dz * 6, Math.atan2(dx, dz), true, 0.6);
    }
    // props pass: 2-4 plastic chairs around every cafe table, facing it (push props: they scoot when walked into)
    if (SK.parts.chair)
      for (const c of props.cafe || []) {
        if (c._ch) continue;
        c._ch = 1;
        const n = 2 + ((hash(((c.x * 3) | 0) + ((c.z * 7) | 0)) * 3) | 0);
        const set = ((hash(((c.x / 12) | 0) * 31 + ((c.z / 12) | 0)) * 6) | 0) % 6;
        c.vl = set;
        c.vlFixed = true; // one cafe, one furniture color (table + its chairs)
        for (let k = 0; k < n; k++) {
          const a =
              (c.ry || 0) + (k * Math.PI * 2) / n + (hash(((c.x * 11) | 0) + k * 13) - 0.5) * 0.5,
            d = 0.78 + hash(((c.z * 5) | 0) + k) * 0.18,
            x = c.x + Math.sin(a) * d,
            z = c.z + Math.cos(a) * d;
          if (!(isWater && isWater(x, z)) && !insideBuilding(tile, x, z) && ri(x, z).gap > 0.3)
            W.push({
              v: 'chair',
              x,
              y: c.y || 0,
              z,
              ry: Math.atan2(c.x - x, c.z - z) + (hash(k * 7 + ((c.x * 13) | 0)) - 0.5) * 0.5,
              vl: set,
              vlFixed: true,
            });
        }
      }
    // props pass: bike racks (2.5 x 1 m) never run into a shop planter, bush, bin, bench, cafe set or trunk: slide along the
    // rack's axis to a free spot, else leave the rack out
    if (props.bike && props.bike.length) {
      const obs = [];
      const addObs = (L, r) => {
        for (const q of L || []) obs.push([q.x, q.z, typeof r === 'function' ? r(q) : r]);
      };
      addObs(props.blob, (q) => 0.55 * (q.s || 1) + 0.15);
      addObs(props.flower, (q) => 0.55 * (q.s || 1) + 0.15);
      addObs(W, 0.55);
      addObs(props.cafe, 1.1);
      addObs(props.bin, 0.4);
      addObs(props.bench, 1.0);
      addObs(props.kiosk, 1.3);
      addObs(props.palm, 0.45);
      addObs(props.tree, 0.45);
      addObs(props.lamp, 0.25);
      addObs(props.hydrant, 0.35);
      addObs(props.signPost, 0.15);
      addObs(props.meter, 0.15);
      addObs(props.shelter, 2.4);
      const hits = (x, z, ry) => {
        const c = Math.cos(ry),
          sn = Math.sin(ry);
        for (const [ox, oz, r] of obs) {
          const dx = ox - x,
            dz = oz - z;
          if (dx * dx + dz * dz > 9) continue;
          const lx = dx * c - dz * sn,
            lz = dx * sn + dz * c;
          if (Math.abs(lx) < 1.25 + r && Math.abs(lz) < 0.5 + r) return true;
        }
        return false;
      };
      const keep = [];
      for (const b of props.bike) {
        const ry = b.ry || 0,
          ax = Math.cos(ry),
          az = -Math.sin(ry);
        let placed = false;
        for (const d of [0, 0.8, -0.8, 1.6, -1.6]) {
          const x = b.x + ax * d,
            z = b.z + az * d;
          if ((!onSidewalk || onSidewalk(x, z)) && !hits(x, z, ry)) {
            b.x = x;
            b.z = z;
            placed = true;
            break;
          }
        }
        if (placed) {
          keep.push(b);
          obs.push([b.x, b.z, 1.3]);
        }
      }
      props.bike.length = 0;
      props.bike.push(...keep);
    }
    // curb work strips
    for (const r of tile.roads || []) {
      if (
        !r.sidewalks ||
        r.pts.length < 2 ||
        !/secondary|tertiary|residential/.test(r.kind || '') ||
        (r.y && Math.max(...r.y) > 0.5)
      )
        continue;
      const eid = r.edgeId ?? r.id ?? 0;
      if (hash(eid * 7919 + 3) > 0.07) continue;
      const P = r.pts,
        cum = [0];
      for (let i = 1; i < P.length; i++)
        cum.push(cum[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
      const L = cum[cum.length - 1];
      if (L < 70) continue;
      const at = (s) => {
        let i = 1;
        while (i < P.length - 1 && cum[i] < s) i++;
        const a = P[i - 1],
          b = P[i],
          l = cum[i] - cum[i - 1] || 1,
          t = (s - cum[i - 1]) / l,
          dx = (b[0] - a[0]) / l,
          dz = (b[1] - a[1]) / l;
        return {
          x: a[0] + (b[0] - a[0]) * t,
          z: a[1] + (b[1] - a[1]) * t,
          dx,
          dz,
          nx: dz,
          nz: -dx,
        };
      };
      const side = hash(eid * 31) < 0.5 ? 1 : -1,
        hw = r.width / 2,
        s0 = L * (0.3 + hash(eid * 17) * 0.3),
        len = 18 + hash(eid * 5) * 14;
      if (s0 + len > L - 12) continue;
      for (let s = s0, k = 0; s <= s0 + len; s += 3, k++) {
        // taper in over the first 9 m, then along the closed strip
        const q = at(s),
          o = hw - 0.35 - Math.min(1, k / 3) * 1.15,
          x = q.x + q.nx * side * o,
          z = q.z + q.nz * side * o;
        put(
          k % 4 === 3 ? 'channelizer' : 'cone',
          x,
          z,
          Math.atan2(q.dx, q.dz) + hash(s * 3 + eid) * 0.6,
          true,
          0.25,
        );
      }
      for (const s of [s0 - 1.5, s0 + len + 1.5]) {
        const q = at(s),
          o = hw - 0.9,
          x = q.x + q.nx * side * o,
          z = q.z + q.nz * side * o;
        put('barricade2', x, z, Math.atan2(q.dx, q.dz) + (s > s0 ? 0 : Math.PI), true, 0.6);
      }
    }
  }
  // overhead lines between two utility poles: three conductors from the cross-arm insulators (library pole: arm along local X)
  const WIRE_X = [-0.25, 0.53, 1.3],
    WIRE_Z = -0.05;
  function wireSpan(B, p, q) {
    for (const ox of WIRE_X) {
      const at = (P) => [
        P.x + Math.cos(P.ry) * ox + Math.sin(P.ry) * WIRE_Z,
        (P.y || 0) + (P.top || 9.5),
        P.z - Math.sin(P.ry) * ox + Math.cos(P.ry) * WIRE_Z,
      ];
      const A = at(p),
        Bp = at(q),
        L2 = Math.hypot(Bp[0] - A[0], Bp[2] - A[2]),
        sag = 0.3 + L2 * 0.012;
      let pp = null;
      for (let k = 0; k <= 8; k++) {
        const tt = k / 8,
          P3 = new THREE.Vector3(
            A[0] + (Bp[0] - A[0]) * tt,
            A[1] + (Bp[1] - A[1]) * tt - sag * 4 * tt * (1 - tt),
            A[2] + (Bp[2] - A[2]) * tt,
          );
        if (pp) {
          const d = P3.clone().sub(pp),
            L3 = d.length();
          B.guard.addGeometry(
            BOXG,
            new THREE.Matrix4().compose(
              pp.clone().addScaledVector(d, 0.5),
              new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), d.normalize()),
              new THREE.Vector3(0.022, 0.022, L3),
            ),
            0x1c1c1c,
          );
        }
        pp = P3;
      }
    }
  }
  const modelOrProc = (group, key, procG, items, opts = {}) => {
    if (!items.length) return;
    const parts = models[key];
    if (parts && parts.length)
      for (const p of parts) inst(group, p.geometry, p.material, items, { cast: false });
    else inst(group, procG, vcMat, items, opts);
  };

  // ---------------- NEAR ----------------
  // ---- Port of Miami container yards (port-zone land away from roads, buildings and the quay edge) ----
  // container colors: weathered line liveries (one dominant line per stacking row, a few strays), never toy-bright.
  // Nordhaven Line navy comes from src/design (shipping/container); the others are leasing-pool and faded generic boxes.
  const BOX_COLS = [
    0x1f3b52, 0x7a3329, 0x8b8f8c, 0x9a6a34, 0x3e5847, 0xb3ac9c, 0x55595c, 0x5e2a28, 0x46667a,
    0x9c5530, 0x2d3640, 0xa39c8a,
  ];
  const _bc = new THREE.Color();
  function containerColor(x, z, k, row) {
    const line = (hash(row * 7919 + 13) * BOX_COLS.length) | 0;
    const r = hash(((x * 13) | 0) + k * 31 + ((z * 5) | 0));
    const base =
      r < 0.72 ? BOX_COLS[line] : BOX_COLS[((r * 977 * BOX_COLS.length) | 0) % BOX_COLS.length];
    // per-box fade and grime so no two boxes match
    const f = 0.82 + hash(((x * 3) | 0) * 131 + k * 17 + ((z * 11) | 0)) * 0.26;
    return _bc
      .set(base)
      .multiplyScalar(f)
      .lerp(_bc.clone().setRGB(0.55, 0.52, 0.47), 0.12 + r * 0.1)
      .getHex();
  }
  function insideBuilding(tile, x, z) {
    if (!tile._bb)
      tile._bb = tile.buildings.map((b) => {
        let a = Infinity,
          c = -Infinity,
          d = Infinity,
          e = -Infinity;
        for (const [px, pz] of b.rings[0]) {
          if (px < a) a = px;
          if (px > c) c = px;
          if (pz < d) d = pz;
          if (pz > e) e = pz;
        }
        return [a, c, d, e];
      });
    for (let bi = 0; bi < tile.buildings.length; bi++) {
      const bb = tile._bb[bi];
      if (x < bb[0] || x > bb[1] || z < bb[2] || z > bb[3]) continue;
      const b = tile.buildings[bi],
        o = b.rings[0];
      let inside = false;
      for (let i = 0, j = o.length - 1; i < o.length; j = i++) {
        const [xi, zi] = o[i],
          [xj, zj] = o[j];
        if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
      }
      if (inside) return true;
    }
    return false;
  }
  // axis-aligned box (5 faces, no bottom) written straight into a Batch: no geometry allocation per box
  const _fc = new THREE.Color();
  function fastBox(b, cx, cy, cz, hx, hy, hz, color) {
    const c = _fc.set(color),
      x0 = cx - hx,
      x1 = cx + hx,
      y0 = cy - hy,
      y1 = cy + hy,
      z0 = cz - hz,
      z1 = cz + hz;
    const F = [
      [[x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], 0, 1, 0],
      [[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1], 1, 0, 0],
      [[x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [x0, y0, z0], -1, 0, 0],
      [[x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [x0, y0, z1], 0, 0, 1],
      [[x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0], 0, 0, -1],
    ];
    for (const [a, bq, cq, d, nx, ny, nz] of F)
      for (const v of [a, bq, cq, a, cq, d]) b.vert(v[0], v[1], v[2], nx, ny, nz, 0, 0, c);
  }
  const yardCache = new WeakMap();
  function portYard(tile, props) {
    if (!isWater || !roadDist) return;
    let cached = yardCache.get(tile);
    if (!cached) {
      const g = portYardGen(tile);
      for (let r = g.next(); !r.done; r = g.next());
      cached = yardCache.get(tile);
    }
    if (cached) {
      props.container.push(...cached.container);
      props.stack.push(...cached.stack);
    }
  }
  function* portYardGen(tile) {
    if (!isWater || !roadDist || yardCache.has(tile)) return;
    const props = { container: [], stack: [] };
    let slots = 0;
    const x0 = tile.x0,
      z0 = tile.z0,
      S = tile.size || provider.tileSize;
    let anyPort = false;
    for (const [u, v] of [
      [0.25, 0.25],
      [0.75, 0.25],
      [0.25, 0.75],
      [0.75, 0.75],
      [0.5, 0.5],
    ])
      if (zoneAt(x0 + S * u, z0 + S * v) === 'port') anyPort = true;
    if (!anyPort) {
      yardCache.set(tile, { container: [], stack: [] });
      return;
    }
    const PX = 5 * 13 + 8,
      PZ = 8 * 2.8 + 10;
    for (let gx = Math.floor(x0 / PX) * PX; gx < x0 + S; gx += PX)
      for (let gz = Math.floor(z0 / PZ) * PZ; gz < z0 + S; gz += PZ)
        for (let ix = 0; ix < 5; ix++)
          for (let iz = 0; iz < 8; iz++) {
            const x = gx + 6.5 + ix * 13,
              z = gz + 1.4 + iz * 2.8;
            if (x < x0 || x >= x0 + S || z < z0 || z >= z0 + S) continue;
            if (++slots % 60 === 0) yield;
            if (
              zoneAt(x, z) !== 'port' ||
              isWater(x, z) ||
              isWater(x + 30, z) ||
              isWater(x - 30, z) ||
              isWater(x, z + 30) ||
              isWater(x, z - 30)
            )
              continue;
            if (roadDist(x, z) < 6 || insideBuilding(tile, x, z)) continue;
            const h0 = hash(((x * 7.13) | 0) * 9176 + ((z * 3.71) | 0));
            if (h0 < 0.12) continue;
            // orderly blocks: one stacking height per block row (3 to 5 high), a few short stacks where boxes were just lifted out
            const row = ((gx * 0.37) | 0) * 131 + ((gz * 0.53) | 0) * 7 + ix;
            const rowH = 3 + ((hash(row * 17 + 5) * 3) | 0);
            const n = h0 < 0.2 ? 1 + (((h0 * 40) | 0) % rowH) : rowH;
            for (let k = 0; k < n; k++)
              props.container.push({
                x,
                y: k * 2.6 + 1.3,
                z,
                ry: 0,
                sx: 12.2,
                sy: 2.55,
                sz: 2.44,
                color: containerColor(x, z, k, row),
              });
            props.stack.push({ x, z, n, row, col: gx + ',' + gz + ',' + ix });
          }
    yardCache.set(tile, props);
  }
  // ---- moored boats along marina piers / pontoons ----
  function marinaBoats(tile, props) {
    if (!isWater) return;
    for (const pr of tile.piers || []) {
      if (pr.kind === 'breakwater') continue;
      const o = orient(pr.rings[0]);
      for (let i = 0; i < o.length; i++) {
        const p = o[i],
          q = o[(i + 1) % o.length],
          L = Math.hypot(q[0] - p[0], q[1] - p[1]);
        if (L < 6) continue;
        const tx = (q[0] - p[0]) / L,
          tz = (q[1] - p[1]) / L,
          nx = -tz,
          nz = tx;
        for (let sA = 4; sA < L - 3; sA += 7) {
          const bx = p[0] + tx * sA + nx * 5.2,
            bz = p[1] + tz * sA + nz * 5.2;
          if (
            !isWater(bx, bz) ||
            !isWater(bx + nx * 9, bz + nz * 9) ||
            !isWater(bx + tx * 3, bz + tz * 3)
          )
            continue;
          const hb = hash(((bx * 11) | 0) * 7919 + ((bz * 13) | 0));
          if (hb < 0.4) continue;
          const v = (hash(((bx * 3) | 0) + ((bz * 5) | 0) * 131) * 4) | 0,
            sc = 0.92 + hb * 0.16,
            off = 1.2 + (BOAT_LEN[v] * sc) / 2 - 5.2;
          if (v === 3 && !isWater(bx + nx * 15, bz + nz * 15)) continue;
          const tint = 0.9 + hash(((bx * 17) | 0) + 3) * 0.1;
          props.boat.push({
            x: bx + nx * off,
            y: -0.35,
            z: bz + nz * off,
            ry: Math.atan2(-nx, -nz) + (hb > 0.75 ? Math.PI : 0),
            s: sc,
            v,
            color: new THREE.Color(tint, tint, tint * 0.99),
          });
        }
      }
    }
  }
  // ---- Ocean Drive / Lummus Park / beach dressing (beach + nightlife zones) ----
  function beachDress(tile, props, B = null) {
    const S = tile.size || provider.tileSize;
    let beachy = false;
    for (const [u, v] of [
      [0.2, 0.2],
      [0.8, 0.2],
      [0.2, 0.8],
      [0.8, 0.8],
      [0.5, 0.5],
    ])
      if (/beach|nightlife/.test(zoneAt(tile.x0 + S * u, tile.z0 + S * v))) beachy = true;
    if (!beachy) return;
    const nearStreet = (x, z) =>
      (roadDist ? roadDist(x, z) < 9 : false) || (onSidewalk ? onSidewalk(x, z) : false);
    // park edges along the street: double palm row + sea-grape hedge
    for (const a of tile.areas || []) {
      if (a.kind !== 'park' && a.kind !== 'grass') continue;
      const o = orient(a.rings[0]);
      for (let i = 0; i < o.length; i++) {
        const p = o[i],
          q = o[(i + 1) % o.length],
          L = Math.hypot(q[0] - p[0], q[1] - p[1]);
        if (L < 12) continue;
        const tx = (q[0] - p[0]) / L,
          tz = (q[1] - p[1]) / L,
          nx = -tz,
          nz = tx; // outward
        const mx = (p[0] + q[0]) / 2,
          mz = (p[1] + q[1]) / 2;
        if (!nearStreet(mx + nx * 4, mz + nz * 4)) continue;
        for (let sA = 4; sA < L - 3; sA += 1.5) {
          const hx = p[0] + tx * sA - nx * 1.3,
            hz = p[1] + tz * sA - nz * 1.3,
            hb = hash(((hx * 7) | 0) * 7919 + ((hz * 3) | 0));
          if (hb < 0.22)
            props.flower.push({
              x: hx,
              y: 0.0,
              z: hz,
              ry: hb * 29,
              s: 0.9 + hb * 1.5,
              color: new THREE.Color().setHSL(0.1, 0.15, 0.82 + hb * 0.6),
            });
          else
            props.blob.push({
              x: hx,
              y: 0.0,
              z: hz,
              ry: hb * 29,
              s: 0.85 + hb * 0.4,
              color: new THREE.Color().setHSL(0.2 + hb * 0.12, 0.3 + hb * 0.35, 0.62 + hb * 0.25),
            });
        }
        // promenade paving: terrazzo band from the park edge out to the curb (measured at the segment midpoint)
        let W = 0;
        for (let k = 1; k <= 24; k++) {
          const x = mx + nx * k,
            z = mz + nz * k;
          if (
            (roadDist && roadDist(x, z) < 5.5) ||
            (onSidewalk && onSidewalk(x, z)) ||
            (isWater && isWater(x, z))
          )
            break;
          W = k - 0.3;
        }
        if (B && B.promenade && W > 1.5) {
          const y = AREA_Y.paved,
            white = new THREE.Color(0xffffff),
            P4 = [
              [p[0], p[1]],
              [q[0], q[1]],
              [q[0] + nx * W, q[1] + nz * W],
              [p[0] + nx * W, p[1] + nz * W],
            ];
          const tri = (a, b, c) => {
            if ((b[1] - a[1]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[1] - a[1]) < 0) [b, c] = [c, b];
            for (const v of [a, b, c])
              B.promenade.vert(v[0], y, v[1], 0, 1, 0, v[0] / 8, v[1] / 8, white);
          };
          tri(P4[0], P4[1], P4[2]);
          tri(P4[0], P4[2], P4[3]);
        }
        // promenade on the street side of the hedge: benches facing the park, bins, bike racks, lamps, food kiosks
        const okWalk = (x, z) => !(roadDist && roadDist(x, z) < 5.2) && !(isWater && isWater(x, z));
        for (let sA = 8; sA < L - 6; sA += 30) {
          const bx = p[0] + tx * sA + nx * 1.9,
            bz = p[1] + tz * sA + nz * 1.9,
            ry = Math.atan2(-nx, -nz),
            kh = hash(((bx * 5) | 0) * 31 + ((bz * 3) | 0));
          if (!okWalk(bx, bz)) continue;
          props.bench.push({ x: bx, y: gY(bx, bz), z: bz, ry: ry + Math.PI });
          const lx = bx + tx * 12.5,
            lz = bz + tz * 12.5;
          if (!props.realLamps && okWalk(lx, lz))
            props.lamp.push({ x: lx, y: gY(lx, lz), z: lz, ry: Math.atan2(nx, nz) });
          if (kh < 0.35)
            props.bin.push({ x: bx + tx * 2.4, y: gY(bx, bz), z: bz + tz * 2.4, ry, k: 0 });
          else if (kh < 0.5)
            props.bike.push({
              x: bx + tx * 4 + nx * 0.6,
              y: gY(bx, bz),
              z: bz + tz * 4 + nz * 0.6,
              ry: ry + Math.PI / 2,
            });
          else if (kh > 0.86) {
            const kx = bx + nx * 2.2,
              kz = bz + nz * 2.2;
            if (okWalk(kx, kz) && W > 4.5)
              props.kiosk.push({
                x: kx,
                y: gY(kx, kz),
                z: kz,
                ry: Math.atan2(nx, nz),
                color: [0xff5d8f, 0x2ec4b6, 0xffb703, 0x7b61ff][((kh * 40) | 0) % 4],
              });
          }
        }
        for (let sA = 5; sA < L - 4; sA += 9)
          for (const [inset, off] of [
            [4.5, 0],
            [10, 4.5],
          ]) {
            if (sA + off > L - 3) continue;
            const px = p[0] + tx * (sA + off) - nx * inset,
              pz = p[1] + tz * (sA + off) - nz * inset;
            props.palm.push({
              x: px,
              y: 0.02,
              z: pz,
              ry: hash((px * 13) | 0) * 6,
              s: 1.1 + hash((pz * 7) | 0) * 0.35,
            });
          }
      }
    }
    // dunes + sea oats on the landward edge of the sand (never on lawns / paths drawn over the beach polygon)
    const pip = (r, x, z) => {
      let c = false;
      for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
        const [xi, zi] = r[i],
          [xj, zj] = r[j];
        if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
      }
      return c;
    };
    const lawns = (tile.areas || [])
      .filter(
        (a) => a.kind === 'grass' || a.kind === 'park' || a.kind === 'paved' || a.kind === 'land',
      )
      .map((a) => a.rings[0]);
    const onSand = (x, z) =>
      !lawns.some((r) => pip(r, x, z)) &&
      !(roadDist && roadDist(x, z) < 8) &&
      !(onSidewalk && onSidewalk(x, z));
    if (isWater)
      for (const a of tile.areas || []) {
        if (a.kind !== 'beach') continue;
        const o = orient(a.rings[0]);
        for (let i = 0; i < o.length; i++) {
          const p = o[i],
            q = o[(i + 1) % o.length],
            L = Math.hypot(q[0] - p[0], q[1] - p[1]);
          if (L < 8) continue;
          const tx = (q[0] - p[0]) / L,
            tz = (q[1] - p[1]) / L,
            nx = -tz,
            nz = tx;
          const mx = (p[0] + q[0]) / 2,
            mz = (p[1] + q[1]) / 2;
          if (isWater(mx + nx * 6, mz + nz * 6) || isWater(mx - nx * 14, mz - nz * 14)) continue; // landward edges only
          for (let sA = 3; sA < L - 2; sA += 5.5) {
            const dx = p[0] + tx * sA - nx * 7,
              dz = p[1] + tz * sA - nz * 7,
              hd = hash(((dx * 3) | 0) * 7919 + ((dz * 11) | 0));
            if (
              !onSand(dx, dz) ||
              !onSand(dx + tx * 4, dz + tz * 4) ||
              !onSand(dx - tx * 4, dz - tz * 4)
            )
              continue;
            props.dune.push({
              x: dx,
              y: -0.25,
              z: dz,
              ry: Math.atan2(tx, tz),
              sx: 4 + hd * 3,
              sy: 0.6 + hd * 0.6,
              sz: 2.5 + hd * 2,
            });
            for (let k = 0; k < 3; k++) {
              const hk = hash(((dx * 13) | 0) + k * 977);
              props.oats.push({
                x: dx + (hk - 0.5) * 5,
                y: 0.2 + hd * 0.3,
                z: dz + (hash(k * 31 + ((dz * 7) | 0)) - 0.5) * 3,
                ry: hk * 6,
                s: 0.8 + hk * 0.6,
              });
            }
          }
        }
      }
    // lifeguard huts on the sand (~every 170 m), facing the water
    if (isWater)
      for (const a of tile.areas || []) {
        if (a.kind !== 'beach') continue;
        const o = a.rings[0];
        for (let i = 0; i < o.length; i++) {
          const p = o[i],
            q = o[(i + 1) % o.length],
            L = Math.hypot(q[0] - p[0], q[1] - p[1]);
          for (let sA = 0; sA < L; sA += 20) {
            const x = p[0] + (q[0] - p[0]) * (sA / L),
              z = p[1] + (q[1] - p[1]) * (sA / L);
            if (Math.abs(Math.floor(z / 170) * 170 + 85 - z) > 12) continue;
            for (const [dx, dz] of [
              [1, 0],
              [0, 1],
              [-1, 0],
              [0, -1],
            ]) {
              const hx = x - dx * 28,
                hz = z - dz * 28;
              if (
                isWater(x + dx * 6, z + dz * 6) &&
                !isWater(hx, hz) &&
                !props.hut.some((h) => Math.hypot(h.x - hx, h.z - hz) < 140)
              ) {
                props.hut.push({
                  x: hx,
                  y: 0.02,
                  z: hz,
                  ry: Math.atan2(dx, dz),
                  color: [0xff6b9a, 0x4ad8d0, 0xffc93c, 0xa47cff, 0xff8a3d][
                    (hash((hx * 3) | 0) * 5) | 0
                  ],
                });
                break;
              }
            }
          }
        }
      }
    // cafe seating in front of restaurants / cafes / bars (on the sidewalk)
    for (const f of tile.storefronts || []) {
      if (!/restaurant|cafe|bar|pub|fast_food|ice_cream/.test(String(f.kind))) continue;
      const fx = f.fx ?? f.x,
        fz = f.fz ?? f.z,
        ox = Math.sin(f.facing || 0),
        oz = Math.cos(f.facing || 0),
        rx = -oz,
        rz = ox;
      for (const [u, d] of [
        [-2.6, 2.8],
        [2.6, 2.8],
        [0, 5.2],
      ]) {
        const x = fx + ox * d + rx * u,
          z = fz + oz * d + rz * u;
        if (onSidewalk && !onSidewalk(x, z)) continue;
        props.cafe.push({ x, y: gY(x, z), z, ry: (f.facing || 0) + hash((x * 9) | 0) });
        props.umbrella.push({
          x,
          y: gY(x, z),
          z,
          ry: 0,
          color: [0xff5d8f, 0x2ec4b6, 0xffb703, 0xffffff, 0x7b61ff, 0xe63946, 0x06d6a0][
            (hash(((x * 3) | 0) + (z | 0)) * 7) | 0
          ],
        });
      }
    }
  }
  // string lights between consecutive street palms (lit from dusk) + tree grates under sidewalk palms
  function palmDress(props) {
    const rows = props.palm.filter((p) => p.y > 0.1);
    // (greenery, overnight) tree grates only where a palm / street tree really stands in a paved sidewalk of a city street: never in a
    // yard, on sand, on the Keys or in the countryside (those were the colored squares under the Keys palms)
    const pitOk = (p) =>
      !p.cs &&
      !p.real &&
      (onSidewalk
        ? onSidewalk(p.x, p.z)
        : (p.street || p.pit) &&
          !/beach|rural|wilderness|residential|park/.test(zoneAt(p.x, p.z) || '')); // a grate wherever a palm stands in paving (sidewalk or plaza; drawn with the clamped base)
    for (const p of props.palm)
      if (pitOk(p)) props.grate.push({ x: p.x, y: p.y + 0.004, z: p.z, ry: p.ry || 0 });
    for (const p of props.tree)
      if (p.y > 0.1 && pitOk(p))
        props.grate.push({ x: p.x, y: p.y + 0.004, z: p.z, ry: p.ry || 0 });
    const linked = new Set();
    for (let i = 0; i < rows.length; i++) {
      if (!/beach|nightlife/.test(zoneAt(rows[i].x, rows[i].z))) continue;
      let best = -1,
        bd = 1e9;
      for (let j = 0; j < rows.length; j++) {
        if (j === i || linked.has(j * 100003 + i)) continue;
        const d = Math.hypot(rows[j].x - rows[i].x, rows[j].z - rows[i].z);
        if (d > 6 && d < 26 && d < bd) {
          bd = d;
          best = j;
        }
      }
      if (best < 0) continue;
      linked.add(i * 100003 + best);
      const A = rows[i],
        Bp = rows[best],
        n = Math.max(5, Math.round(bd / 0.7));
      const at = (t) => [
        A.x + (Bp.x - A.x) * t,
        4.6 - 1.1 * 4 * t * (1 - t) + A.y + (Bp.y - A.y) * t,
        A.z + (Bp.z - A.z) * t,
      ];
      for (let k = 1; k < n; k++) {
        const p = at(k / n);
        props.bulb.push({ x: p[0], y: p[1] - 0.06, z: p[2] });
      }
      // the cable the bulbs hang from (drawn as a thin sagging strip, palm to palm)
      const segs = Math.max(6, Math.round(bd / 1.5));
      for (let k = 0; k < segs; k++) props.wire.push([at(k / segs), at((k + 1) / segs)]);
    }
  }
  // real props from data.js (OSM): trees/palms, lamps, signals, bus stops, hydrants, bins, benches
  // ---- waterfront + causeway islands (Watson Island, MacArthur / Venetian causeways): seawall caps everywhere; promenades with
  // rails, lamps and benches; palm groves + shrubs on open fill; a public boat ramp by the waterfront parking. Deterministic per tile. ----
  const ISLAND_D = /Watson Island|MacArthur Causeway|Venetian Causeway/;
  const distAt = (x, z) => (ctx.districtAt ? ctx.districtAt(x, z) || '' : '');
  const islandCache = new WeakMap();
  function seawallRuns(tile) {
    // [{p, tx, tz, ox, oz, sA, sB}] straight seawall pieces (land edge with open water outside)
    let c = islandCache.get(tile);
    if (c) return c;
    c = [];
    if (!isWater) {
      islandCache.set(tile, c);
      return c;
    }
    for (const a of tile.areas || []) {
      if (a.kind !== 'land') continue;
      for (const ring of a.rings) {
        for (let i = 0; i < ring.length; i++) {
          const p = ring[i],
            q = ring[(i + 1) % ring.length],
            L = Math.hypot(q[0] - p[0], q[1] - p[1]);
          if (L < 3) continue;
          const tx = (q[0] - p[0]) / L,
            tz = (q[1] - p[1]) / L;
          let run = null;
          for (let s2 = 1; s2 <= L - 1; s2 += 2) {
            const x = p[0] + tx * s2,
              z = p[1] + tz * s2;
            let side = 0;
            if (isWater(x - tz * 2.5, z + tx * 2.5) && !isWater(x + tz * 2.5, z - tx * 2.5))
              side = 1;
            else if (isWater(x + tz * 2.5, z - tx * 2.5) && !isWater(x - tz * 2.5, z + tx * 2.5))
              side = -1;
            const sea =
              side !== 0 &&
              !/beach|sand/.test(String(surfAt(x - tz * side * 3, z + tx * side * 3)));
            if (sea && run && run.side === side) run.sB = s2 + 1;
            else {
              if (run && run.sB - run.sA >= 4) c.push(run);
              run = sea
                ? {
                    p,
                    tx,
                    tz,
                    side,
                    ox: -tz * side,
                    oz: tx * side,
                    sA: Math.max(0, s2 - 1),
                    sB: s2 + 1,
                  }
                : null;
            }
          }
          if (run && run.sB - run.sA >= 4) c.push(run);
        }
      }
    }
    islandCache.set(tile, c);
    return c;
  }
  const surfAt = (x, z) => {
    try {
      return ctx.surfaceAt ? ctx.surfaceAt(x, z) : isBeachAt(x, z) ? 'sand' : '';
    } catch (e) {
      return '';
    }
  };
  const isBeachAt = (x, z) => /beach/.test(zoneAt(x, z));
  function inAreaKinds(tile, x, z, re) {
    for (const a of tile.areas || []) {
      if (!re.test(a.kind)) continue;
      if (pipR(a.rings[0], x, z) && !a.rings.slice(1).some((h) => pipR(h, x, z))) return true;
    }
    return false;
  }
  function islandDress(tile, props, B) {
    const S = tile.size || provider.tileSize,
      x0 = tile.x0 ?? tile.tx * S,
      z0 = tile.z0 ?? tile.tz * S;
    let island = false;
    for (const [u, v] of [
      [0.15, 0.15],
      [0.85, 0.15],
      [0.15, 0.85],
      [0.85, 0.85],
      [0.5, 0.5],
    ])
      if (ISLAND_D.test(distAt(x0 + S * u, z0 + S * v))) island = true;
    const runs = seawallRuns(tile),
      walk = pathIndex(tile),
      elevLow = (x, z) => {
        if (!elevated) return false;
        const f = safeCall(() => elevated.footprintAt(x, z), null);
        return !!(f && (f.type === 1 || f.y < 4.5));
      };
    const cap = new THREE.Color(0xd6d1c4),
      capTop = new THREE.Color(0xe4e0d6),
      rail = new THREE.Color(0xe8ecee),
      postC = new THREE.Color(0x9aa2a8);
    const natShore =
      GM_ON &&
      !island &&
      !!(terrain && tile.tx !== undefined && terrain.synthetic(tile.tx, tile.tz)) &&
      !/port|downtown|business|commercial|nightlife/.test(String(zoneAt(x0 + S / 2, z0 + S / 2))); // ground pass: natural terrain coasts get no concrete seawall coping along the cover polygon's straight edge (it floated on the sand as white beams)
    for (const r of runs) {
      const { p, tx, tz, ox, oz } = r,
        at = (s2, o) => [p[0] + tx * s2 + ox * o, p[1] + tz * s2 + oz * o];
      // seawall cap: 0.6 m concrete coping, 0.12 m proud, face continues down the wall (all waterfronts)
      // r4-shoreland (?r4slab=0 = old): not along inland ponds / lakes / marsh on terrain tiles (Brickell Ave swamp): there the bank is
      // the terrain's natural slope, and the cap lay on it as a white 0.6 m slab, half in the water
      if (
        B &&
        B.trim &&
        !natShore &&
        !(
          R4SLAB &&
          terrain &&
          tile.tx !== undefined &&
          terrain.synthetic(tile.tx, tile.tz) &&
          D &&
          D.waterKindAt &&
          [3, 8].some((o) => {
            const q = at((r.sA + r.sB) / 2, o);
            return /pond|lake|marsh/.test(String(D.waterKindAt(q[0], q[1]) || ''));
          })
        )
      ) {
        const fr = polyFrame([at(r.sA, 0), at(r.sB, 0)]),
          sgn = fr[0].nx * ox + fr[0].nz * oz > 0 ? 1 : -1;
        ribbon(
          B.trim,
          fr,
          0,
          Math.min(-0.55 * sgn, 0.06 * sgn),
          Math.max(-0.55 * sgn, 0.06 * sgn),
          0.12,
          capTop,
          1 / 3,
          r.sA - r.sA,
          r.sB - r.sA,
        );
        sideWall(B.trim, fr, 0, 0.06 * sgn, 0.42, -0.3, cap, sgn, 0, r.sB - r.sA);
        sideWall(B.trim, fr, 0, -0.55 * sgn, 0.12, 0, cap, -sgn, 0, r.sB - r.sA);
      }
      // promenade: islands / causeways, or any park waterfront with a walking path along it
      const mid = at((r.sA + r.sB) / 2, -3),
        promZone = island || /park/.test(zoneAt(mid[0], mid[1]));
      if (!promZone || r.sB - r.sA < 10) continue;
      const pw = walk(mid[0], mid[1]),
        prom = pw.d < 9 || island;
      if (!prom) continue;
      const len = r.sB - r.sA,
        ph = hash(((p[0] * 3) | 0) * 7 + ((p[1] * 5) | 0));
      if (B && B.guard && !elevLow(mid[0], mid[1]) && (SEAMS_OLD || !natShore)) {
        // railing: posts every 2.4 m + top / mid rails (two-faced strips)
        // r2-roads: only on a real seawall (no railing along a natural beach), and only where each post stands on dry, paved-level
        // ground (not sand / water, not below or above the walk): the railing is split into runs between grounded posts
        const posts = [];
        for (let s2 = r.sA + 0.5; s2 <= r.sB - 0.4; s2 += 2.4) {
          const [x, z] = at(s2, -0.25);
          posts.push({
            s2,
            x,
            z,
            ok:
              SEAMS_OLD ||
              (!(isWater && isWater(x, z)) &&
                !/sand|water/.test(String(surfAt(x, z))) &&
                Math.abs(gY0(x, z)) < 0.3),
          });
        }
        for (let i = 0; i < posts.length;) {
          if (!posts[i].ok) {
            i++;
            continue;
          }
          let j = i;
          while (j + 1 < posts.length && posts[j + 1].ok) j++;
          if (j > i) {
            // (ground nov19b, user: "glitched railing") the rails follow every post of the run: a chord from the first to the
            // last post cut through the posts on a curved seawall and left them standing off the rail
            const railPts = [];
            for (let k = i; k <= j; k++) railPts.push([posts[k].x, posts[k].z]);
            const fr = polyFrame(railPts);
            for (const [y0, h] of [
              [1.0, 0.06],
              [0.52, 0.04],
            ]) {
              sideWall(B.guard, fr, 0, 0, h, y0, rail, 1);
              sideWall(B.guard, fr, 0, 0, h, y0, rail, -1);
            }
            for (let k = i; k <= j; k++)
              B.guard.addGeometry(
                BOXG,
                m4(posts[k].x, 0.12 + 0.47, posts[k].z, Math.atan2(tx, tz), 0.06, 0.94, 0.06),
                postC,
              );
          }
          i = j + 1;
        }
      }
      for (let s2 = r.sA + 6 + ph * 10; s2 < r.sB - 4; s2 += 24) {
        const [x, z] = at(s2, -1.3);
        if (!elevLow(x, z)) props.lamp.push({ x, y: gY0(x, z), z, ry: Math.atan2(ox, oz) });
      }
      for (let s2 = r.sA + 14 + ph * 8; s2 < r.sB - 4; s2 += 30) {
        const [x, z] = at(s2, -2.4);
        if (!insideBuilding(tile, x, z) && !elevLow(x, z))
          props.bench.push({ x, y: gY0(x, z), z, ry: Math.atan2(ox, oz) + Math.PI });
      }
      for (let s2 = r.sA + 20 + ph * 30; s2 < r.sB - 4; s2 += 75) {
        const [x, z] = at(s2, -2.0);
        props.bin.push({ x, y: gY0(x, z), z, ry: ph * 6, k: 0 });
      }
      if (len > 40)
        for (let s2 = r.sA + 9 + ph * 7; s2 < r.sB - 6; s2 += 16) {
          const [x, z] = at(s2, -4.6);
          if (!insideBuilding(tile, x, z) && !isWater(x, z) && walk(x, z).d > 1.6)
            props.palm.push({
              x,
              y: gY0(x, z),
              z,
              ry: hash(((x * 3) | 0) + ((z * 7) | 0)) * 6,
              s: 0.95 + hash((x | 0) + 7) * 0.3,
            });
        }
    }
    if (!island) return;
    // boat ramp: one per tile, the seawall run closest to a parking lot (trailer parking)
    if (B && B.trim) {
      let best = null;
      for (const r of runs) {
        const L = r.sB - r.sA;
        if (L < 14) continue;
        const sm = (r.sA + r.sB) / 2,
          x = r.p[0] + r.tx * sm,
          z = r.p[1] + r.tz * sm;
        let dPark = 1e9;
        for (const a of tile.areas || [])
          if (a.kind === 'parking')
            for (const [px, pz] of a.rings[0]) dPark = Math.min(dPark, Math.hypot(px - x, pz - z));
        if (dPark < 45 && !elevLow(x, z) && (!best || dPark < best.d)) best = { r, sm, d: dPark };
      }
      if (best) {
        const { r, sm } = best,
          W = 4.5,
          ramp = new THREE.Color(0xb9b4a8),
          y0 = 0.05,
          y1 = -1.5,
          Lr = 11;
        const c = (u, v) => [
          r.p[0] + r.tx * (sm + u) + r.ox * v,
          r.p[1] + r.tz * (sm + u) + r.oz * v,
        ];
        const P = [
          [c(-W / 2, -1), y0],
          [c(W / 2, -1), y0],
          [c(W / 2, Lr), y1],
          [c(-W / 2, Lr), y1],
        ];
        const v3 = ([[x, z], y]) => [x, y, z];
        quadUp(B.trim, v3(P[0]), v3(P[1]), v3(P[2]), v3(P[3]), ramp, 1 / 2);
        for (const u of [-W / 2 - 0.4, W / 2 + 0.4]) {
          const [x, z] = c(u, -0.6);
          B.trim.addGeometry(CYLG, m4(x, 0.45, z, 0, 0.32, 0.7, 0.32), new THREE.Color(0x3a3f44));
        }
        const [sx, sz] = c(W / 2 + 2, -3);
        props.signPost.push({ x: sx, y: gY0(sx, sz), z: sz });
        props.bin.push({ x: sx + r.tx * 1.5, y: gY0(sx, sz), z: sz + r.tz * 1.5, ry: 0, k: 1 });
      }
    }
    // open fill / lawns: royal-palm groves, sea-grape shrubs and flower beds away from roads, paths, parking and buildings
    const CELL = 9;
    for (let gx = Math.floor(x0 / CELL) * CELL; gx < x0 + S; gx += CELL)
      for (let gz = Math.floor(z0 / CELL) * CELL; gz < z0 + S; gz += CELL) {
        const h0 = hash(((gx * 7.31) | 0) * 7919 + ((gz * 3.17) | 0)),
          h1 = hash(((gx * 3.7) | 0) * 131 + ((gz * 9.1) | 0) + 17);
        const x = gx + 1.5 + h1 * 6,
          z = gz + 1.5 + hash(((gz * 5.3) | 0) + ((gx * 2.9) | 0) * 31) * 6;
        if (x < x0 || x >= x0 + S || z < z0 || z >= z0 + S || h0 < 0.45) continue;
        if (
          !ISLAND_D.test(distAt(x, z)) ||
          isWater(x, z) ||
          isWater(x + 4, z) ||
          isWater(x - 4, z) ||
          isWater(x, z + 4) ||
          isWater(x, z - 4)
        )
          continue;
        if (
          (roadDist && roadDist(x, z) < 6) ||
          (onSidewalk && onSidewalk(x, z)) ||
          insideBuilding(tile, x, z) ||
          walk(x, z).d < 2.2 ||
          elevLow(x, z)
        )
          continue;
        if (
          inAreaKinds(tile, x, z, /parking|paved|pool|wood|beach|sand/) ||
          (tile.piers || []).some((pp) => pipR(pp.rings[0], x, z))
        )
          continue;
        if (h0 > 0.8) {
          const n = 1 + ((h1 * 3) | 0);
          for (let k = 0; k < n; k++) {
            const a = h1 * 40 + k * 2.1,
              rr = k ? 2.2 + h0 * 1.5 : 0;
            props.palm.push({
              x: x + Math.cos(a) * rr,
              y: 0,
              z: z + Math.sin(a) * rr,
              ry: (h0 + k) * 9,
              s: 0.85 + hash(k * 7 + (x | 0)) * 0.45,
            });
          }
        } else if (h0 > 0.6) {
          for (let k = 0; k < 3; k++) {
            const a = h0 * 50 + k * 2.09,
              hk = hash(((x * 11) | 0) + k * 37);
            props.blob.push({
              x: x + Math.cos(a) * 1.3,
              y: 0,
              z: z + Math.sin(a) * 1.3,
              ry: hk * 6,
              s: 0.9 + hk * 0.6,
              color: new THREE.Color().setHSL(0.24 + hk * 0.07, 0.42, 0.42 + hk * 0.14),
            });
          }
        } else if (h0 > 0.52)
          props.flower.push({
            x,
            y: 0,
            z,
            ry: h1 * 6,
            s: 1.1 + h1 * 0.6,
            color: new THREE.Color().setHSL([0.95, 0.08, 0.15, 0.83][(h1 * 4) | 0], 0.6, 0.62),
          });
        else if (inAreaKinds(tile, x, z, /park|grass/) && walk(x, z).d < 7) {
          props.bench.push({ x, y: 0, z, ry: h1 * 6.28 });
          if (h1 > 0.6) props.bin.push({ x: x + 1.4, y: 0, z, ry: 0, k: 0 });
        }
      }
  }
  // ground-floor shop frontage (synthetic lots): sidewalk cafe sets at food & drink, planters / bike racks / A-frame menus elsewhere
  function shopDress(tile, props) {
    {
      // mapped food & drink places outside the beach strip (beachDress seats the beach tiles): two-top tables on the sidewalk
      const S = tile.size || provider.tileSize,
        x0 = tile.x0 ?? tile.tx * S,
        z0 = tile.z0 ?? tile.tz * S;
      let beachy = false;
      for (const [u, v] of [
        [0.2, 0.2],
        [0.8, 0.2],
        [0.2, 0.8],
        [0.8, 0.8],
        [0.5, 0.5],
      ])
        if (/beach|nightlife/.test(zoneAt(x0 + S * u, z0 + S * v))) beachy = true;
      if (!beachy)
        for (const f of tile.storefronts || []) {
          if (!/restaurant|cafe|bar|pub|fast_food|ice_cream/.test(String(f.kind))) continue;
          const fx = f.fx ?? f.x,
            fz = f.fz ?? f.z,
            ox = Math.sin(f.facing || 0),
            oz = Math.cos(f.facing || 0),
            rx = -oz,
            rz = ox,
            kh = hash(((fx * 7) | 0) * 31 + ((fz * 3) | 0));
          for (const [u, d] of [
            [-2.2, 2.2],
            [2.2, 2.2],
          ]) {
            const x = fx + ox * d + rx * u,
              z = fz + oz * d + rz * u;
            if (
              onSidewalk &&
              !(
                onSidewalk(x, z) &&
                onSidewalk(fx + ox * (d + 1.6) + rx * u, fz + oz * (d + 1.6) + rz * u)
              )
            )
              continue;
            props.cafe.push({ x, y: gY0(x, z), z, ry: (f.facing || 0) + kh * 3 });
            if (kh < 0.65)
              props.umbrella.push({
                x,
                y: gY0(x, z),
                z,
                ry: 0,
                color: [0xff5d8f, 0x2ec4b6, 0xffb703, 0xffffff, 0x7b61ff, 0xe63946, 0x06d6a0][
                  (kh * 7) | 0
                ],
              });
          }
        }
    }
    for (const b of buildingsOf(tile))
      for (const f of b.storefronts || []) {
        if (!f.synthetic) continue;
        const fx = f.fx,
          fz = f.fz,
          ox = Math.sin(f.facing),
          oz = Math.cos(f.facing),
          rx = -oz,
          rz = ox,
          kh = hash(f.id);
        const ok = (x, z) => (onSidewalk ? onSidewalk(x, z) : true);
        if (/restaurant|cafe|bar/.test(f.kind)) {
          for (const [u, d] of [
            [-1.9, 1.9],
            [1.9, 1.9],
          ]) {
            const x = fx + ox * d + rx * u,
              z = fz + oz * d + rz * u;
            if (!ok(x, z) || !ok(fx + ox * (d + 1.6) + rx * u, fz + oz * (d + 1.6) + rz * u))
              continue;
            props.cafe.push({ x, y: gY0(x, z), z, ry: f.facing + kh * 3 });
            if (kh < 0.6)
              props.umbrella.push({
                x,
                y: gY0(x, z),
                z,
                ry: 0,
                color: [0xff5d8f, 0x2ec4b6, 0xffb703, 0xffffff, 0x7b61ff, 0xe63946, 0x06d6a0][
                  (kh * 7) | 0
                ],
              });
          }
        } else {
          const u = kh < 0.5 ? -2.2 : 2.2,
            x = fx + ox * 0.9 + rx * u,
            z = fz + oz * 0.9 + rz * u;
          if (!ok(x, z)) continue;
          if (kh < 0.35)
            props.flower.push({
              x,
              y: gY0(x, z),
              z,
              ry: kh * 9,
              s: 0.75,
              color: new THREE.Color().setHSL(0.9 + kh * 0.2, 0.55, 0.6),
            });
          else if (kh < 0.42) {
            const bx = fx + ox * 1.6 + rx * u,
              bz = fz + oz * 1.6 + rz * u;
            if (ok(bx, bz) && (!roadDist || roadDist(bx, bz) > 1.2))
              props.bike.push({ x: bx, y: gY0(bx, bz), z: bz, ry: f.facing + Math.PI / 2 });
          } else props.bin.push({ x, y: gY0(x, z), z, ry: f.facing, k: 1 });
        }
      }
  }
  // mainland plazas (paved OSM areas outside the beach strip): palms in tree grates, benches facing the palms, bins
  function plazaDress(tile, props) {
    for (const a of tile.areas || []) {
      if (a.kind !== 'paved') continue;
      const r0 = a.rings[0];
      if (r0.length < 3 || Math.abs(polyArea(r0)) < 250) continue;
      if (/beach|nightlife|port|industrial/.test(zoneAt(r0[0][0], r0[0][1]))) continue;
      let x0 = Infinity,
        x1 = -Infinity,
        z0 = Infinity,
        z1 = -Infinity;
      for (const [x, z] of r0) {
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
        z0 = Math.min(z0, z);
        z1 = Math.max(z1, z);
      }
      const G = 10;
      for (let gx = Math.floor(x0 / G) * G + G / 2; gx < x1; gx += G)
        for (let gz = Math.floor(z0 / G) * G + G / 2; gz < z1; gz += G) {
          if (!pipR(r0, gx, gz) || a.rings.slice(1).some((h) => pipR(h, gx, gz))) continue;
          if (
            !pipR(r0, gx + 2.5, gz) ||
            !pipR(r0, gx - 2.5, gz) ||
            !pipR(r0, gx, gz + 2.5) ||
            !pipR(r0, gx, gz - 2.5)
          )
            continue; // keep off the plaza edge
          if (
            insideBuilding(tile, gx, gz) ||
            (isWater && isWater(gx, gz)) ||
            (roadDist && roadDist(gx, gz) < 3)
          )
            continue;
          const h0 = hash(((gx * 3.3) | 0) * 7907 + ((gz * 1.7) | 0)),
            y = plazaRaised(a) ? CURB : gY0(gx, gz);
          if (h0 < 0.55) {
            props.palm.push({ x: gx, y, z: gz, ry: h0 * 40, s: 0.85 + h0 * 0.5 });
            props.grate.push({ x: gx, y: y + 0.004, z: gz, ry: 0 });
          } else if (h0 < 0.72)
            props.bench.push({ x: gx, y, z: gz, ry: (((h0 * 4) | 0) * Math.PI) / 2 });
          else if (h0 < 0.78) props.bin.push({ x: gx, y, z: gz, ry: 0, k: 0 });
          else if (h0 < 0.86)
            props.flower.push({
              x: gx,
              y,
              z: gz,
              ry: h0 * 9,
              s: 1.2,
              color: new THREE.Color().setHSL(0.92 + h0 * 0.1, 0.55, 0.6),
            });
        }
    }
  }
  // greenery: downtown / Brickell / midtown street trees in tree pits (1.3 m in from the curb, ~14 m apart) wherever the sidewalk is
  // at least ~3.5 m wide (no building within 3 m of the pit); one species per block face: royal palms or shade trees (live oak,
  // gumbo limbo) kept small enough that the crown stays over the sidewalk. Never near a junction mouth or another street tree.
  const METRO_Z = /downtown|business|brickell|midtown|edgewater|arts/;
  // (greenery, overnight) residential streets of the mainland city: shade trees in the swale behind the curb / sidewalk, ~22-34 m
  // apart, never on a driveway, house lot, building or in a junction mouth; old neighborhoods get live oaks and banyans, the
  // others gumbo limbo / shade trees and red poincianas (synthetic land: the countryside streamer plants those streets)
  const OLD_D = /havana|grove|gables|shenandoah|allapattah|wynwood|overtown|lemon|little/i;
  function resTrees(tile, props, r, fr, L, hw, mid) {
    if (
      terrain &&
      terrain.synthetic &&
      terrain.synthetic(
        Math.floor(mid.x / (provider.tileSize || 200)),
        Math.floor(mid.z / (provider.tileSize || 200)),
      )
    )
      return;
    let dist = '';
    try {
      dist = String(ctx.districtAt?.(mid.x, mid.z)?.name || ctx.districtAt?.(mid.x, mid.z) || '');
    } catch (e) {
      /* */
    }
    const old = OLD_D.test(dist),
      na = nodeAt(r.pts[0]),
      nb = nodeAt(r.pts[r.pts.length - 1]),
      s0 = na && na.degree >= 3 ? na.width / 2 + 10 : 8,
      s1 = L - (nb && nb.degree >= 3 ? nb.width / 2 + 10 : 8);
    const blds = buildingsOf(tile, false),
      off = hw + (r.sidewalks ? 3.4 : 2.6);
    for (const side of [-1, 1]) {
      const hk = hash(((mid.x * 5) | 0) * 7919 + ((mid.z * 5) | 0) * 31 + side * 577);
      if (hk < 0.25) continue; // some block faces have none
      for (let s2 = s0 + hk * 9; s2 < s1; s2 += 22 + hash(s2 * 3.7 + hk) * 12) {
        const q = sampleAt(fr, s2),
          x = q.x + q.nx * side * off,
          z = q.z + q.nz * side * off,
          h = hash(((x * 7) | 0) * 131 + ((z * 13) | 0));
        if (
          insideBuilding(tile, x, z) ||
          (isWater && isWater(x, z)) ||
          (roadDist && roadDist(x, z) < 2.2) ||
          houseLots.claimedNear(blds, x, z, 3.5) ||
          (houseLots.near && houseLots.near(x, z, 2.5, []).length)
        )
          continue;
        if (
          props.tree.some((p) => Math.abs(p.x - x) < 9 && Math.abs(p.z - z) < 9) ||
          props.palm.some((p) => Math.abs(p.x - x) < 6 && Math.abs(p.z - z) < 6)
        )
          continue;
        const sp = old
          ? h < 0.72
            ? 'oak'
            : 'banyan'
          : h < 0.55
            ? 'gumbo'
            : h < 0.8
              ? 'poinciana'
              : 'oak';
        props.tree.push({
          sp,
          x,
          y: gY(x, z),
          z,
          ry: h * 6.28,
          s: (sp === 'banyan' ? 0.55 : 0.62) + h * 0.2,
          res: 1,
          color: new THREE.Color(0x6b8442),
        });
      }
    }
  }
  // (greenery, overnight) city parks / big lawns: shade trees and palms in loose groves (clumps and clearings, never a grid),
  // 4 m off the lawn edge and paths, a few shrubs under the crowns; old neighborhoods lean to live oaks and banyans
  const PARK_MIX = [
    ['oak', 4],
    ['gumbo', 2],
    ['banyan', 0.8],
    ['poinciana', 0.8],
    ['royal', 1.5],
    ['sabal', 1.5],
  ];
  function parkTrees(tile, props) {
    if (terrain && terrain.synthetic && terrain.synthetic(tile.tx ?? 0, tile.tz ?? 0)) return;
    for (const a of tile.areas || []) {
      if (a.kind !== 'park' && a.kind !== 'grass') continue;
      const r0 = a.rings[0];
      if (!r0 || r0.length < 3) continue;
      const area = Math.abs(polyArea(r0));
      if (area < (a.kind === 'park' ? 600 : 2500)) continue;
      let x0 = Infinity,
        x1 = -Infinity,
        z0 = Infinity,
        z1 = -Infinity;
      for (const [x, z] of r0) {
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
        z0 = Math.min(z0, z);
        z1 = Math.max(z1, z);
      }
      let dist = '';
      try {
        dist = String(
          ctx.districtAt?.((x0 + x1) / 2, (z0 + z1) / 2)?.name ||
            ctx.districtAt?.((x0 + x1) / 2, (z0 + z1) / 2) ||
            '',
        );
      } catch (e) {
        /* */
      }
      const old = OLD_D.test(dist),
        G = 11;
      for (let gx = Math.floor(x0 / G) * G; gx < x1; gx += G)
        for (let gz = Math.floor(z0 / G) * G; gz < z1; gz += G) {
          const h0 = hash(((gx * 3.1) | 0) * 7919 + ((gz * 1.9) | 0) * 31 + 7),
            x = gx + G * (0.2 + 0.6 * hash(((gx * 7) | 0) + ((gz * 3) | 0) * 131)),
            z = gz + G * (0.2 + 0.6 * hash(((gx * 5) | 0) * 17 + ((gz * 11) | 0)));
          const clump = hash(Math.floor(x / 45) * 7919 + Math.floor(z / 45) * 104729 + 3);
          if (h0 > 0.15 + 0.55 * clump) continue; // groves and open lawn
          if (!pipR(r0, x, z) || a.rings.slice(1).some((hl) => pipR(hl, x, z))) continue;
          if (
            !pipR(r0, x + 4, z) ||
            !pipR(r0, x - 4, z) ||
            !pipR(r0, x, z + 4) ||
            !pipR(r0, x, z - 4)
          )
            continue;
          if (
            insideBuilding(tile, x, z) ||
            (isWater && isWater(x, z)) ||
            (roadDist && roadDist(x, z) < 7)
          )
            continue;
          if (
            props.tree.some((p) => Math.abs(p.x - x) < 7 && Math.abs(p.z - z) < 7) ||
            props.palm.some((p) => Math.abs(p.x - x) < 5 && Math.abs(p.z - z) < 5)
          )
            continue;
          const h = hash(((x * 13) | 0) * 131 + ((z * 7) | 0)),
            y = gY(x, z);
          let sp = pickW(PARK_MIX, h);
          if (old && sp === 'gumbo') sp = h < 0.5 ? 'oak' : 'banyan';
          if (sp === 'royal' || sp === 'sabal') {
            props.palm.push({ x, y, z, ry: h * 6.28, s: 0.85 + h * 0.3, park: sp });
            continue;
          }
          props.tree.push({
            sp,
            x,
            y,
            z,
            ry: h * 6.28,
            s: (sp === 'banyan' ? 0.7 : 0.78) + h * 0.25,
            park: 1,
            color: new THREE.Color(0x6b8442),
          });
          if (h > 0.55)
            for (let k = 0; k < 2; k++) {
              const an = h * 40 + k * 2.4,
                rr = 3 + k * 1.5;
              props.blob.push({
                x: x + Math.cos(an) * rr,
                y,
                z: z + Math.sin(an) * rr,
                ry: an,
                s: 0.8 + h * 0.4,
              });
            }
        }
    }
  }
  function streetTrees(tile, props) {
    parkTrees(tile, props);
    for (const r of tile.roads || []) {
      if (
        !r.pts ||
        r.pts.length < 2 ||
        (r.y && Math.max(...r.y) > 0.5) ||
        !/primary|secondary|tertiary|residential|trunk/.test(r.kind || '')
      )
        continue;
      const fr = polyFrame(r.pts),
        L = fr[fr.length - 1].s,
        hw = r.width / 2;
      if (L < 30) continue;
      const mid = sampleAt(fr, L / 2);
      let zone = '';
      try {
        zone = zoneAt(mid.x, mid.z) || '';
      } catch (e) {
        /* */
      }
      if (!METRO_Z.test(zone)) {
        if (zone === 'residential') resTrees(tile, props, r, fr, L, hw, mid);
        continue;
      }
      const na = nodeAt(r.pts[0]),
        nb = nodeAt(r.pts[r.pts.length - 1]),
        s0 = na && na.degree >= 3 ? na.width / 2 + 9 : 6,
        s1 = L - (nb && nb.degree >= 3 ? nb.width / 2 + 9 : 6);
      for (const side of [-1, 1]) {
        const hk = hash(((mid.x * 3) | 0) * 7919 + ((mid.z * 3) | 0) * 31 + side * 977),
          sp = hk < 0.45 ? 'royal' : hk < 0.75 ? 'oak' : 'gumbo';
        for (let s2 = s0 + hk * 6; s2 < s1; s2 += 13.5 + hk * 2) {
          const q = sampleAt(fr, s2),
            o = side * (hw + 1.3),
            x = q.x + q.nx * o,
            z = q.z + q.nz * o;
          let room = 9;
          for (const d of [1.0, 2.2, 3.4, 4.6]) {
            const xo = x + q.nx * side * d,
              zo = z + q.nz * side * d;
            if (insideBuilding(tile, xo, zo) || (isWater && isWater(xo, zo))) {
              room = d;
              break;
            }
          }
          if (room < 2.2 || insideBuilding(tile, x, z) || (roadDist && roadDist(x, z) < 1.0))
            continue; // a shade tree needs ~4.6 m to the facade, a royal palm 2.2 m
          if (
            (tile.trees || []).some(([tx, tz]) => Math.abs(tx - x) < 7 && Math.abs(tz - z) < 7) ||
            props.palm.some((p) => Math.abs(p.x - x) < 6 && Math.abs(p.z - z) < 6)
          )
            continue;
          const h = hash(((x * 7) | 0) * 131 + ((z * 13) | 0));
          if (sp === 'royal' || room < 4.6)
            props.palm.push({ x, y: CURB, z, ry: h * 6.28, s: 0.92 + h * 0.2, street: 1 });
          else if (flora && flora.TINT?.[sp])
            props.tree.push({
              sp,
              x,
              y: CURB,
              z,
              ry: h * 6.28,
              s: 0.5 + h * 0.15,
              street: 1,
              color: new THREE.Color(flora.TINT[sp][0]).multiplyScalar(0.88 + h * 0.24),
            });
        }
      }
    }
  }
  function seedRealProps(props, tile, B = null) {
    portYard(tile, props);
    marinaBoats(tile, props);
    beachDress(tile, props, B);
    islandDress(tile, props, B);
    shopDress(tile, props);
    plazaDress(tile, props);
    streetTrees(tile, props);
    const toRoad = (x, z) => (roadDirAt ? roadDirAt(x, z) : 0);
    if (tile.trees && tile.trees.length) {
      props.realTrees = tile.trees.length > 40;
      /* sparse mapped trees: keep generated street trees too */ for (const [
        x,
        z,
        sp0,
      ] of tile.trees) {
        const y = gY(x, z);
        if (flora && sp0 && flora.SPECIES.has(sp0)) {
          const spk = sp0 === 'tree' ? 'oak' : sp0;
          props.tree.push({
            sp: spk,
            x,
            y,
            z,
            ry: hash(x * 13 + z) * 6,
            s: 0.5 + hash(x + z * 7) * 0.22,
            /* street-tree size: crowns stay over the sidewalk, not across the lanes */ color:
              new THREE.Color(flora.TINT[spk][0]).multiplyScalar(0.85 + hash(x * 3 + z) * 0.3),
          });
          continue;
        }
        props.palm.push({
          x,
          y,
          z,
          ry: hash(x * 13 + z) * 6,
          s: 0.8 + hash(x + z * 7) * 0.5,
          real: 1,
        });
        if (y < 0.05)
          for (let k = 0; k < 3; k++) {
            const hk = hash(((x * 17) | 0) + k * 131 + ((z * 5) | 0));
            if (hk < 0.35) continue;
            const a = hk * 6.28,
              rr2 = 1.6 + hk * 1.8;
            (hk > 0.9 ? props.flower : props.blob).push({
              x: x + Math.cos(a) * rr2,
              y: 0,
              z: z + Math.sin(a) * rr2,
              ry: hk * 6,
              s: 0.7 + hk * 0.5,
              color: new THREE.Color().setHSL(0.24 + hk * 0.08, 0.4, 0.6 + hk * 0.2),
            });
          }
      }
    }
    if (tile.lamps && tile.lamps.length > 4) {
      props.realLamps = true;
      for (const l of tile.lamps)
        props.lamp.push({ x: l.x, y: gY(l.x, l.z), z: l.z, ry: toRoad(l.x, l.z) });
    }
    if (tile.busStops)
      for (const b of tile.busStops) {
        props.realBus = true;
        props.shelter.push({ x: b.x, y: gY(b.x, b.z), z: b.z, ry: toRoad(b.x, b.z) });
      }
    if (tile.hydrants)
      for (const h of tile.hydrants)
        props.hydrant.push({ x: h.x, y: gY(h.x, h.z), z: h.z, ry: hash(h.x) * 6 });
    if (tile.bins)
      for (const w of tile.bins)
        props.bin.push({
          x: w.x,
          y: gY(w.x, w.z),
          z: w.z,
          ry: hash(w.z) * 6,
          k: (hash(w.x + w.z) * 3) | 0,
        });
    if (tile.benches && tile.benches.length) {
      props.realBenches = true;
      for (const b of tile.benches)
        props.bench.push({
          x: b.pos.x,
          y: b.pos.y ?? gY(b.pos.x, b.pos.z),
          z: b.pos.z,
          ry: b.heading,
        });
    }
  }
  const lawnIndex = new Map();
  const pipR = (r, x, z) => {
    let c = false;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const xi = r[i][0],
        zi = r[i][1],
        xj = r[j][0],
        zj = r[j][1];
      if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
    }
    return c;
  };
  const inRings = (e, x, z) =>
    x >= e.bb[0] &&
    x <= e.bb[2] &&
    z >= e.bb[1] &&
    z <= e.bb[3] &&
    pipR(e.rings[0], x, z) &&
    !e.rings.slice(1).some((h) => pipR(h, x, z));
  // true/false where a near tile is built, null where nothing is loaded yet (caller retries later)
  function lawnAt(x, z) {
    for (const e of lawnIndex.values()) {
      if (x < e.minX || x >= e.maxX || z < e.minZ || z >= e.maxZ) continue;
      if (!e.lawns.some((l) => inRings(l, x, z))) return false;
      return (
        !e.walks.some((w) => inRings(w, x, z)) &&
        !(roadDist && roadDist(x, z) < 7) &&
        !inJunction(x, z)
      );
    }
    return null;
  }
  // per-area tester (grass cells): prefilters lawn / sidewalk rings by bbox once; null if the tile is not built
  function lawnTester(x0, z0, x1, z1) {
    const cx = (x0 + x1) / 2,
      cz = (z0 + z1) / 2;
    for (const e of lawnIndex.values()) {
      if (cx < e.minX || cx >= e.maxX || cz < e.minZ || cz >= e.maxZ) continue;
      const hit = (l) => !(l.bb[2] < x0 || l.bb[0] > x1 || l.bb[3] < z0 || l.bb[1] > z1);
      const L = e.lawns.filter(hit),
        W = e.walks.filter(hit);
      if (!L.length) return () => false;
      return (x, z) =>
        L.some((l) => inRings(l, x, z)) &&
        !W.some((w) => inRings(w, x, z)) &&
        !(roadDist && roadDist(x, z) < 7) &&
        !inJunction(x, z);
    }
    return null;
  }
  // ground-continuity: water-mask slivers that count as land (data.isSliver: rasterisation gaps between land polygons) get the
  // ground drawn over them, matching the land collider the ground-cover pass now builds there (no sand slab over swimmable water)
  function* sliverFill(B, X0, Z0, T0) {
    const C = 2,
      N = Math.round(T0 / C);
    let n = 0;
    for (let j = 0; j < N; j++) {
      let run = -1,
        sand = false;
      for (let i = 0; i <= N; i++) {
        const x = X0 + (i + 0.5) * C,
          z = Z0 + (j + 0.5) * C,
          on =
            i < N &&
            (D.isSliver(x, z) ||
              D.isSliver(x + C, z) ||
              D.isSliver(x - C, z) ||
              D.isSliver(x, z + C) ||
              D.isSliver(x, z - C) ||
              D.isSliver(x + 2 * C, z) ||
              D.isSliver(x - 2 * C, z) ||
              D.isSliver(x, z + 2 * C) ||
              D.isSliver(x, z - 2 * C)); // dilated one cell: covers the stair-step gaps against diagonal polygon edges
        if (on && run < 0) {
          run = i;
          sand = /sand|beach/.test((D.surfaceAt && D.surfaceAt(x, z)) || '') || isBeachAt(x, z);
        }
        if (!on && run >= 0) {
          const xa = X0 + run * C,
            xb = X0 + i * C,
            za = Z0 + j * C,
            zb = za + C;
          const ys = CLIP_OFF ? 0.012 : -0.025;
          quadUp(
            sand ? B.sand : B.land,
            [xa, ys, za],
            [xb, ys, za],
            [xb, ys, zb],
            [xa, ys, zb],
            WHITE,
            1 / 6,
          );
          /* clipping sweep: under the land / sand polygons (was 1.2 cm over them: z-fight), over the land base */ run =
            -1;
          n++;
        }
      }
      if ((j & 7) === 7) yield;
    }
    sliverStats.runs += n;
  }
  const sliverStats = { runs: 0 };
  function* buildNear(t) {
    const tile = yield* getTileG(t.tx, t.tz);
    const group = new THREE.Group();
    group.name = `tile-near-${t.tx},${t.tz}`;
    if (!tile) {
      root.add(group);
      return group;
    }
    const B = {
      junction: new Batch(),
      parking: new Batch(),
      promenade: new Batch(),
      panels: new Batch(),
      shopGlass: new Batch(),
      wood: new Batch(),
      pool: new Batch(),
      guard: new Batch(),
      asphalt: new Batch(),
      marks: new Batch(),
      sidewalk: new Batch(),
      trim: new Batch(),
      roof: new Batch(),
      neon: new Batch(),
      shop: new Batch(),
      office: new Batch(),
      deco: new Batch(),
      glass: new Batch(),
      band: new Batch(),
      warehouse: new Batch(),
      punched: new Batch(),
      ribbon: new Batch(),
      curtain: new Batch(),
      condo: new Batch(),
      grid: new Batch(),
      land: new Batch(),
      sand: new Batch(),
      grass: new Batch(),
      dirtRoad: new Batch(),
      lines: new Batch(),
      shoulder: new Batch(),
      decals: new Batch(),
    };
    if (M.facade) {
      B.fac = new FBatch();
      B.trim = fview(B.fac, WL.stucco);
      B.roof = fview(B.fac, WL.roofConcrete);
    }
    if (M.roomGlass) {
      B.roomGlass = new Batch();
      B.roomGlass.w = [];
    }
    B.signs = new Batch(); // r8: shop sign lettering
    if (shopRoomsMaterial(M)) {
      B.shopRooms = new Batch();
      B.shopRooms.w = [];
    } // shops pass
    const T0 = provider.tileSize || 200,
      X0 = t.tx * T0,
      Z0 = t.tz * T0,
      synth = !!(terrain && terrain.synthetic(t.tx, t.tz)),
      LF = { on: !!(tile.relief && D), k: null };
    if (terrain) {
      B.runway = new Batch();
      B.taxiway = new Batch();
      B.apron = new Batch();
    }
    if (LF.on) for (const key in B) liftB(B[key], LF);
    for (const key of ['asphalt', 'lines', 'decals']) attachRoadChannel(B[key]); // surfaces pass: per-vertex road frame (src/world/surfaces/roadChannel.js)
    const props = newProps();
    buildingsOf(tile);
    yield;
    seedRealProps(props, tile, B);
    yield;
    for (const a of tile.areas || []) areaFill(B, a, tile);
    const aprons = SHOP_APRONS
      ? shopAprons(
          [...(tile.storefronts || []), ...buildingsOf(tile).flatMap((b) => b.storefronts || [])],
          B,
          { roadDist, onSidewalk, isWater, fillPoly, THREE },
        )
      : []; // shops pass: paved forecourt / parking in front of every shop off the sidewalk grid (src/world/shops/frontage.js)
    if (!synth && D && D.isSliver && !GC_OFF) yield* sliverFill(B, X0, Z0, T0);
    if (terrain) airportMarks(B, X0, Z0, T0);
    if (synth) {
      const tr = yield* terrain.gridGen(X0, Z0, X0 + T0, Z0 + T0, 4, {
        skirt: tile.relief ? 4 : 0.8,
      });
      if (tr) {
        const m = new THREE.Mesh(tr.geometry, terrain.nearMat);
        m.name = 'terrain';
        m.receiveShadow = true;
        m.castShadow = !!tile.relief;
        m.matrixAutoUpdate = false;
        m.updateMatrix();
        group.add(m);
      }
      yield;
    }
    exitVisuals(B, tile, GM_ON && synth); // ground pass: on terrain coasts the terrain draws the beach (damp / wet bands, foam lace, irregular waterline); no straight sand slabs / skirts
    if (t.x0 !== undefined) {
      // visual lawn index (3D grass follows what is drawn: lawn rings minus raised sidewalks)
      const bb = (r) => {
        let a = Infinity,
          b = Infinity,
          c = -Infinity,
          d = -Infinity;
        for (const [x, z] of r) {
          a = Math.min(a, x);
          b = Math.min(b, z);
          c = Math.max(c, x);
          d = Math.max(d, z);
        }
        return [a, b, c, d];
      };
      const lawns = (tile.areas || [])
        .filter((a) => (a.kind === 'grass' || a.kind === 'park') && (!a.cls || LAWN_CLS.has(a.cls)))
        .map((a) => ({ rings: a.rings, bb: bb(a.rings[0]) }));
      const walks = sidewalksOf(tile)
        .map((rings) => ({ rings, bb: bb(rings[0]) }))
        .concat(
          (tile.areas || [])
            .filter((a) => HARD_CLS.has(a.cls))
            .map((a) => ({ rings: a.rings, bb: bb(a.rings[0]) })),
        )
        .concat(aprons.map((a) => ({ rings: a.rings, bb: bb(a.rings[0]) }))); // no lawn grass through aprons / runways / lots
      const TS = (t.cx - t.x0) * 2;
      lawnIndex.set(group, {
        minX: t.x0,
        minZ: t.z0,
        maxX: t.x0 + TS,
        maxZ: t.z0 + TS,
        lawns,
        walks,
      });
    }
    yield;
    sidewalksOf(tile);
    yield;
    roadIndex(tile, true);
    yield;
    for (const rings of sidewalksOf(tile)) {
      yield* clipGen(rings, tile);
      const r0 = rings[0];
      let cx = 0,
        cz = 0;
      for (const [x, z] of r0) {
        cx += x;
        cz += z;
      }
      cx /= r0.length;
      cz /= r0.length;
      const zn = zoneAt(cx, cz);
      curWeeds = props.curbWeed ||= []; // ground pass: curb-crack weeds collected while this slab is built (set / cleared around the synchronous call: tile builds interleave)
      if (M.promenade && /beach|nightlife/.test(zn))
        sidewalkPoly(B.promenade, rings, null, B.sidewalk, 1 / 8, tile);
      else if (M.panels && /downtown|business|brickell|commercial/.test(zn))
        sidewalkPoly(B.panels, rings, null, B.sidewalk, 1 / 6, tile);
      else sidewalkPoly(B.sidewalk, rings, null, B.sidewalk, 1 / 2.5, tile);
      curWeeds = null;
      yield;
    }
    for (const p of tile.piers || []) pierDeck(B, p, null, props);
    yield;
    yield* buildRoads(B, tile, props, null);
    yield;
    const FQ = [];
    let k = 0,
      tY = performance.now();
    // r2-perf: yield on elapsed time (4 ms), not every 25 buildings: 25 downtown buildings with shop-front dressing took
    // 200-600 ms in one step (a hitch while driving). Same output. ?tbyield=0 = old.
    for (const b of buildingsOf(tile)) {
      if (houseLots.claims(b)) continue;
      /* drawn by the house generator (setpieces/houses) */ if (LF.on) LF.k = baseOf(b);
      yield* buildBuildingSliced(B, b, { shops: true, props }, LF, FQ, false);
      if (b.style === 'stilt') stiltPiles(B, b);
      if (TB_YIELD ? performance.now() - tY > 4 : ++k % 25 === 0) {
        yield;
        tY = performance.now();
      }
    }
    LIBM.lotFences(tile); // rough side: chain-link fences around the vacant lots (bldmodels.js, instanced city-wide)
    LF.k = null;
    yield;
    if (!CLIP_OFF && !LF.on) props._slab = slabFromBatches([B.sidewalk, B.promenade, B.panels]);
    cleanProps(tile, props);
    if (SK && !LF.on) {
      floorFix(tile, props);
      shelterClear(props);
    }
    props._slab = null;
    if (SK) {
      workZones(tile, props);
      propJitter(props);
    }
    yield;
    if (LF.on) liftProps(props);
    syncKids(props);
    if (GM_ON) {
      const mp = [];
      for (const it of [...(props.palm || []), ...(props.tree || [])]) {
        if (!it || it.cs || (it.y || 0) > 0.1) continue;
        const z0 = String(zoneAt(it.x, it.z) || '');
        if (!URBAN_Z.test(z0) && !/park/.test(z0)) continue;
        mp.push([it.x, it.z, 0.75 + hash(((it.x * 7) | 0) + ((it.z * 3) | 0)) * 0.5]);
      }
      if (mp.length) GMASK.registerPoints(group, mp);
    } // ground pass: mulch rings at street / park trees (terrain draws them)
    if (synth && flora) yield* floraInto(t, tile, props);
    if (props.veg)
      for (const key of ['sawgrass', 'rush', 'palmetto', 'crop'])
        if (props.veg[key]) {
          if (flora.VG?.[key] && M.vegLeaf) vegBushes(group, props.veg[key], flora.VG[key]);
          else
            inst(group, flora.G[key], flora.grassMat, props.veg[key], {
              colors: true,
              cast: key === 'palmetto',
            });
        }
    for (const [name, mat, cast] of [
      ['junction', M.junction || M.asphalt, false],
      ['parking', M.parking || M.asphalt, false],
      ['promenade', M.promenade || M.sidewalk, false],
      ['panels', M.panels || M.sidewalk, false],
      ['shopGlass', M.shopGlass, false],
      ['wood', M.wood, false],
      ['pool', M.poolWater, false],
      ['guard', M.guardrail, true],
      ['land', M.land, false],
      ['sand', M.sand, false],
      ['grass', M.grass, false],
      ['asphalt', M.roadLane || M.asphalt, false],
      ['dirtRoad', M.dirtRoad || M.land, false],
      ['shoulder', M.shoulder || M.sidewalk, false],
      ['marks', M.markings, false],
      ['lines', M.lines || M.markings, false],
      ['decals', M.roadDecals || M.markings, false],
      ['sidewalk', M.sidewalk, false],
      ['trim', M.trim, true],
      ['roof', M.roof, false],
      ['neon', M.neon, false],
      ['shop', M.shop, true],
      ['office', M.office, true],
      ['deco', M.deco, true],
      ['glass', M.glass, true],
      ['band', M.band, true],
      ['warehouse', M.warehouse, true],
      ...['punched', 'ribbon', 'curtain', 'condo', 'grid'].map((k) => [k, M[k] || M.office, true]),
    ]) {
      const m = meshOf(B[name], mat, { cast });
      if (m) {
        if (B[name]._srf) applyRoadChannel(THREE, m, B[name]);
        if (name === 'shopGlass') m.renderOrder = 10;
        group.add(m);
        const gk = GM_KIND[name];
        if (gk) GMASK.register(m, gk);
        yield;
      }
    }
    if (B.signs && B.signs.p.length) {
      const m = meshOf(B.signs, shopSignAtlas().mat, { cast: false });
      if (m) {
        m.name = 'shop-signs';
        group.add(m);
      }
    }
    if (B.roomGlass && B.roomGlass.p.length) {
      // shop rooms behind street-front glass (aWear = room kind + how lit)
      const m = meshOf(B.roomGlass, M.roomGlass, { cast: false });
      if (m) {
        m.geometry.setAttribute(
          'aWear',
          new THREE.BufferAttribute(new Float32Array(B.roomGlass.w), 1),
        );
        m.name = 'shop-rooms';
        m.renderOrder = -1;
        group.add(m);
      }
    }
    if (B.shopRooms && B.shopRooms.p.length) {
      const m = meshOf(B.shopRooms, M.shopRooms, { cast: false });
      if (m) {
        m.geometry.setAttribute(
          'aWear',
          new THREE.BufferAttribute(new Float32Array(B.shopRooms.w), 1),
        );
        m.name = 'shop-rooms-lots';
        group.add(m);
      }
    } // shops pass: painted rooms behind storefront-lot glass
    if (B.fac && !B.fac.empty) {
      const m = B.fac.build(M.facade, { cast: true });
      m.name = 'facades';
      group.add(m);
      yield;
    }
    if (terrain)
      for (const key of ['runway', 'taxiway', 'apron']) {
        const m = meshOf(
          B[key],
          GM_ON
            ? (key === 'apron' ? M.parking : M.asphalt) || terrain.surfaces[key]
            : terrain.surfaces[key],
          { cast: false },
        );
        if (m) {
          group.add(m);
          GMASK.register(m, 'paved');
        }
      } // ground pass: airfield pavement in the ground mask, on the road asphalt scan (runways / taxiways) and the poured concrete (aprons) instead of flat dark sets
    yield;
    if (SK) furnish(group, props);
    else modelOrProc(group, 'bench', benchG, props.bench);
    const tagVis = (items, fn) => {
      const H = (group.userData.handles ||= []),
        h0 = H.length;
      fn(items);
      const hs = H.slice(h0);
      items.forEach((p, k) => {
        p._vis = hs.map((h) => [h, k]);
      });
    }; // X1: which pool instances draw each breakable prop
    if (SK) {
      kitVar(group, 'hydrant', props.hydrant, tagVis);
      kitVar(group, 'bin', props.bin, tagVis);
      kitVar(group, 'work', props.work, tagVis);
      kitVar(group, 'shelter', props.shelter, null);
      kitSigns(group, props.signPost, tagVis);
    } else {
      tagVis(props.hydrant, (it) => modelOrProc(group, 'hydrant', hydrantG, it, { cast: false }));
      tagVis(
        props.bin.filter((b) => b.k !== 1),
        (it) => modelOrProc(group, 'trash', binG[0], it, { cast: false }),
      );
      tagVis(
        props.bin.filter((b) => b.k === 1),
        (it) => inst(group, binG[1], vcMat, it, { cast: false }),
      );
      inst(group, shelterG, vcMat, props.shelter);
    }
    if (SK && SK.parts.can && SK.parts.cup) {
      // props pass: litter = the user's soda can / paper cup (repainted, no real brands), lying where it was dropped
      const cans = [],
        cups = [];
      for (const l of props.litter) {
        const h = h2(l, 31);
        const m = new THREE.Matrix4().compose(
          new THREE.Vector3(l.x, (l.y || 0) - 0.02 + (h < 0.6 ? 0.032 : 0.045), l.z),
          new THREE.Quaternion().setFromEuler(
            new THREE.Euler(
              Math.PI / 2 + (h2(l, 32) - 0.5) * 0.15,
              l.ry || 0,
              (h2(l, 33) - 0.5) * 6,
              'YXZ',
            ),
          ),
          new THREE.Vector3(1, 1, 1),
        );
        (h < 0.6 ? cans : cups).push({ x: l.x, y: l.y, z: l.z, m: m.elements });
      } // lying on its side, any heading
      kitParts(group, 'can', cans, { cast: false });
      kitParts(group, 'cup', cups, { cast: false });
    } else inst(group, litterG, litterMat, props.litter, { cast: false, colors: true });
    if (props.curbWeed && props.curbWeed.length) {
      const kit = curbWeedKit();
      if (kit) {
        const per = kit.geos.map(() => []);
        props.curbWeed.forEach((w, i) => per[i % per.length].push(w));
        per.forEach((it, i) =>
          inst(group, kit.geos[i], kit.mat, it, { cast: false, depth: kit.depth }),
        );
      }
    } // ground pass: curb-crack weeds
    // street-name blades: per-tile name atlas (2 columns x up to 16 rows)
    if (props.signs.length) {
      const names = [...new Set(props.signs.map((s2) => s2.name))].slice(0, 32),
        rows = Math.ceil(names.length / 2);
      const cv = document.createElement('canvas');
      cv.width = 1024;
      cv.height = 64 * rows;
      const cx = cv.getContext('2d');
      names.forEach((nm, i) => {
        const X = (i % 2) * 512,
          Y = Math.floor(i / 2) * 64;
        cx.fillStyle = '#0f6b3a';
        cx.fillRect(X, Y, 512, 64);
        cx.strokeStyle = '#fff';
        cx.lineWidth = 4;
        cx.strokeRect(X + 5, Y + 5, 502, 54);
        cx.fillStyle = '#fff';
        cx.font = 'bold 38px Arial, sans-serif';
        cx.textAlign = 'center';
        cx.textBaseline = 'middle';
        cx.fillText(nm, X + 256, Y + 34, 480);
      });
      const tx = new THREE.CanvasTexture(cv);
      tx.colorSpace = THREE.SRGBColorSpace;
      tx.anisotropy = 4;
      const sm = new THREE.MeshStandardMaterial({
        map: tx,
        roughness: 0.5,
        side: THREE.DoubleSide,
      });
      sm.userData.ownedTexture = tx;
      const sb = new Batch(),
        pg = new THREE.PlaneGeometry(2.0, 0.25);
      for (const s2 of props.signs) {
        const i = names.indexOf(s2.name);
        if (i < 0) continue;
        sb.addGeometry(
          pg,
          mat4(s2.x + s2.dx * 1.0, s2.y, s2.z + s2.dz * 1.0, Math.atan2(-s2.dz, s2.dx)),
          0xffffff,
          [0.5, 1 / rows],
          [(i % 2) * 0.5, 1 - (Math.floor(i / 2) + 1) / rows],
        );
      }
      const m = meshOf(sb, sm, { cast: false });
      if (m) {
        m.userData.ownedMaterial = sm;
        group.add(m);
      }
      if (!SK) tagVis(props.signPost, (it) => inst(group, signPostG, vcMat, it));
    }
    if (props.graffiti.length) {
      const gb = new Batch();
      for (const g of props.graffiti)
        gb.addGeometry(
          new THREE.PlaneGeometry(g.s, g.s / 2),
          mat4(g.x, g.y, g.z, g.ry),
          0xffffff,
          [0.25, 0.5],
          [(g.k % 4) * 0.25, (1 - Math.floor(g.k / 4)) * 0.5],
        );
      const m = meshOf(gb, M.graffiti, { cast: false });
      if (m) group.add(m);
    }
    inst(group, BOXG, containerMat, props.container, { cast: true, colors: true });
    for (let v = 0; v < 4; v++) {
      const it = props.boat.filter((b) => b.v === v);
      if (!it.length) continue;
      inst(group, boatGs[v], boatMat, it, { colors: true, cast: true });
      const h = group.userData.handles[group.userData.handles.length - 1];
      it.forEach((b, k) => moorVisual(b, h, k));
    }
    palmDress(props);
    {
      /* (r2-veg, QA 13) no shrubs on beach sand or on the beach-edge grass strip by the surf (lone ball bush on South Beach); planters (raised) stay */
      const onBeach = (q) => {
        const s = surfAt(q.x, q.z) || '';
        if (/sand|beach/.test(s)) return true;
        if (!/grass/.test(s) || !isWater) return false;
        let z0 = '';
        try {
          z0 = zoneAt(q.x, q.z) || '';
        } catch (e) {
          /* */
        }
        return (
          /beach/.test(z0) &&
          [
            [30, 0],
            [-30, 0],
            [0, 30],
            [0, -30],
          ].some(([dx, dz]) => isWater(q.x + dx, q.z + dz))
        );
      };
      for (const L of [props.blob, props.flower]) {
        const keep = L.filter((q) => (q.y || 0) > 0.3 || !onBeach(q));
        if (keep.length !== L.length) L.splice(0, L.length, ...keep);
      }
    }
    if (models.bush) {
      for (const pp of models.bush)
        inst(group, pp.geometry, pp.material, props.blob, { colors: true, cast: true });
      for (const pp of models.flowerBush || models.bush)
        inst(group, pp.geometry, pp.material, props.flower, { colors: true, cast: true });
      if (M.leaf)
        libInst(group, ['grass_tuft_b', 'red_grass'], props.oats, 'shrub', 1.7) ||
          inst(group, oatsG, M.oats || M.leaf, props.oats, { colors: false });
    } else if (M.leaf) {
      if (
        libInst(group, BUSH_LIB.blob, props.blob, 'shrub', 0.9) |
        libInst(group, BUSH_LIB.flower, props.flower, 'shrub', 0.85)
      ) {
        /* (greenery, overnight) library shrubs */
      } else if (vegBush.blob.length && M.vegLeaf) {
        vegBushes(group, props.blob, vegBush.blob);
        vegBushes(group, props.flower, vegBush.flower);
      } else {
        inst(group, leafG, M.leaf, props.blob, { colors: true, cast: true, depth: M.leafDepth });
        inst(group, flowerG, M.leaf, props.flower, {
          colors: true,
          cast: true,
          depth: M.leafDepth,
        });
      }
      libInst(group, ['grass_tuft_b', 'red_grass'], props.oats, 'shrub', 1.7) ||
        inst(group, oatsG, M.oats || M.leaf, props.oats, { colors: false });
    } else inst(group, blobG, blobMat, props.blob.concat(props.flower), { colors: true });
    inst(group, duneG, M.dune || M.sand, props.dune, { cast: false });
    if (SK && SK.parts.bike_rack) kitParts(group, 'bike_rack', props.bike, { cast: true });
    else inst(group, bikeG, vcMat, props.bike); // props pass: hoop rack kitbashed from the user's pipe railing
    if (SK && SK.parts.food_cart) kitParts(group, 'food_cart', props.kiosk, { cast: true });
    else inst(group, kioskG, hutMat, props.kiosk, { colors: true, cast: true }); // props pass: the library hot dog cart at kiosk spots
    inst(group, hutG, hutMat, props.hut, { colors: true, cast: true });
    if (SK && SK.parts.patio_table)
      kitParts(group, 'patio_table', withMoved('cafe', props.cafe), { cast: true });
    else inst(group, cafeG, vcMat, props.cafe); // props pass: library patio table (+ chairs in props.work)
    if (SK && SK.parts.umbrella_cafe)
      kitParts(group, 'umbrella_cafe', props.umbrella, { cast: true });
    else inst(group, umbG, umbMat, props.umbrella, { colors: true });
    inst(group, grateG, grateMat, props.grate);
    if (COVERS.parts)
      for (const k in COVERS.parts)
        if (props['cv_' + k]?.length)
          inst(group, COVERS.parts[k].geometry, COVERS.parts[k].material, props['cv_' + k], {
            colors: true,
          }); // r2-roads: utility covers
    if (M.bulb) inst(group, bulbG, M.bulb, props.bulb);
    if (props.wire.length) {
      // string-light cables: two crossed thin strips per segment so they read from every side
      const wb = new Batch(),
        wc = new THREE.Color(0x1c1c1c),
        w = 0.012;
      for (const [p, q] of props.wire) {
        for (const [ox, oy, oz] of [
          [0, w, 0],
          [w, 0, 0],
          [0, 0, w],
        ]) {
          const a0 = [p[0] - ox, p[1] - oy, p[2] - oz],
            a1 = [p[0] + ox, p[1] + oy, p[2] + oz],
            b0 = [q[0] - ox, q[1] - oy, q[2] - oz],
            b1 = [q[0] + ox, q[1] + oy, q[2] + oz];
          for (const v of [a0, b0, b1, a0, b1, a1, a0, b1, b0, a0, a1, b1])
            wb.vert(v[0], v[1], v[2], 0, 1, 0, 0, 0, wc);
        }
      }
      const wm = meshOf(wb, M.guardrail, { cast: false });
      if (wm) {
        wm.name = 'string-light-cables';
        group.add(wm);
      }
    }
    if (elevated) {
      const er = yield* elevTileG(t, { colliders: false });
      if (er && er.group) {
        group.add(er.group);
        for (const l of er.lamps || []) props.lamp.push({ ...l, elev: true });
      }
    } // deck lamps (ELEVATED) before the lamp instances are built
    if (SK) kitLamps(group, props.lamp);
    else {
      inst(group, lampPoleG, M.metal, props.lamp, { cast: true });
      inst(group, lampHeadG, M.lampHead, props.lamp, { cast: false });
    }
    // ground pass (Nov 19): the old 11 m peach additive lamp-pool quads are not drawn any more. They sat at
    // the asphalt height (under a raised plaza, over a sunken one), survived when their lamp was dropped,
    // and doubled the clustered lamp lights (env/lamps.js lights near lamps, its own far pools beyond):
    // a flat orange oval on the ground. `?lamppool=1` = old.
    if (OLD_LAMP_POOLS) {
      const im = inst(group, poolG, M.pool, props.pool, { cast: false });
      if (im) im.renderOrder = 2;
    }
    inst(group, acG, acMat, props.ac);
    inst(group, beaconG, M.beacon, props.beacon, { cast: false });
    inst(group, mastG, M.metal, props.mast);
    if (SK && SK.parts.upole_gear) {
      kitParts(group, 'upole_gear', props.upole, { cast: true });
      kitUpoleLamps(group, props.upole);
    } else inst(group, upoleG, upoleMat, props.upole, { cast: true });
    inst(group, sigHeadG, sigMat, props.sig);
    if (SK) kitSignals(group, props);
    inst(
      group,
      BOXG,
      pierMat,
      props.pier.map((p) => ({ ...p, sz: 2.2 })),
    );
    // palms: split over the shared variants
    // (greenery) species by place; trees / palms the countryside streamer draws (cs: 1) are only colliders here (no double crowns)
    const per = palmVariants.map(() => []),
      perM = {};
    for (const p of props.palm) {
      if (p.cs || (roadDist && roadDist(p.x, p.z) < -0.1)) continue;
      const k = palmKindOf(p);
      /* (greenery) never in a lane */ if (typeof k === 'string') {
        const h = hash(((p.x * 7) | 0) * 131 + ((p.z * 11) | 0)),
          s = p.s || 1;
        p.sx = p.sz = s * (0.88 + h * 0.24);
        p.sy = s * (0.86 + ((h * 5.71) % 1) * 0.28);
        const pv = !p.real && (onSidewalk ? onSidewalk(p.x, p.z) : p.street && (p.y || 0) > 0.1);
        const gT = !pv && terrain?.real && !terrain.real(p.x, p.z) ? palmGround(p.x, p.z) : null;
        (perM[(pv ? 'p' : 'm') + k.slice(1)] ||= []).push({
          ...p,
          y: gT !== null ? gT - 0.08 * s : (p.y || 0) - (pv ? 0.03 : 0.08) * s,
        }); /* (r2-veg) palms out of paving on synthetic land stand on the drawn terrain (were up to 10 cm in the air at curb height) */
      } else per[k].push(p);
    } // (greenery) pv: in paving
    for (const k in perM) {
      const items = perM[k],
        L = modelPalmOf(k.slice(2), k[0] === 'p');
      if (!items.length || !L) continue;
      for (const q of L.near) inst(group, q.geo, q.mat, items, { cast: true, depth: q.depth });
      for (const q of L.mid) inst(group, q.geo, q.mat, items, { cast: true, depth: q.depth });
      if (L.imp) inst(group, L.imp.geo, L.imp.mat, items, { cast: false });
    }
    per.forEach((items, v) => {
      if (!items.length) return;
      const pg = palmVariants[v],
        L = palmLod[v];
      if (L) {
        inst(group, pg.trunk, L.m0.bark.mat, items, { cast: true, depth: L.m0.bark.depth });
        inst(group, pg.fronds, L.m0.leaf.mat, items, { cast: true, depth: L.m0.leaf.depth });
        inst(group, L.g1.trunk, L.m1.bark.mat, items, { cast: true, depth: L.m1.bark.depth });
        inst(group, L.g1.fronds, L.m1.leaf.mat, items, { cast: true, depth: L.m1.leaf.depth });
        if (L.imp) inst(group, L.imp.geo, L.imp.mat.mat, items, { cast: false });
      } else {
        inst(group, pg.trunk, M.trunk, items, { cast: true, depth: M.trunkDepth });
        inst(group, pg.fronds, M.frond, items, { cast: true, depth: M.frondDepth });
      }
    });
    if (flora && props.tree.length) {
      const by = {};
      for (const it of props.tree) if (!it.cs) (by[it.sp] ||= []).push(it);
      for (const sp in by) {
        if (vegTrees(group, sp, by[sp])) continue;
        const TG = flora.T[sp] || flora.T.oak;
        inst(group, TG.trunk, flora.barkMat, by[sp], { cast: true });
        inst(group, TG.crown, flora.leaf, by[sp], {
          colors: true,
          cast: true,
          depth: flora.leafDepth,
        });
        if (sp === 'citrus') inst(group, flora.T.citrusFruit, flora.fruitMat, by[sp]);
      }
    }
    t.props = props;
    group.userData.tile = t;
    if (onProps) onProps(t, props, true);
    if (FARVEG) farDrop(t); // W4: the tile's own plants are back
    // real lamp light: the GRAPHICS clustered-lamp system discovers per-tile lamp lists (removed when the tile group leaves the scene)
    group.userData.psLamps = props.lamp
      .map((l) => {
        const sc = l.s || 1,
          ry = l.ry || 0,
          H = SK ? lampHeadAt(l) : { r: 2.25, y: 7.0 };
        return {
          x: l.x + Math.sin(ry) * H.r * sc,
          y: (l.y || 0) + H.y * sc,
          z: l.z + Math.cos(ry) * H.r * sc,
          gy: l.y || 0,
        };
      })
      .concat(SK ? upoleLampsOf(props.upole) : []);
    propCollidersOn(t, true);
    root.add(group);
    return group;
  }

  // ---------------- MID / FAR: one merged mesh per 800 m chunk ----------------
  // Every vertex carries its owner tile (aTile) so the shader can cut out tiles that currently have a near build.
  const MID_COL = {
    land: 0x8c8a84,
    grass: 0x6f8f4a,
    park: 0x6f8f4a,
    beach: 0xe8dcb8,
    sand: 0xe8dcb8,
    paved: 0xb8b4ac,
    parking: 0x4a4a4c,
    dirt: 0x9a8468,
    pool: 0x3aa8c0,
    wood: 0x8b6a4a,
  };
  // finalise a chunk mesh one attribute per step (typed-array conversion of ~1M floats is the expensive part)
  function* chunkMesh(parts, name) {
    const group = new THREE.Group();
    group.name = name;
    for (const [b, ranges, mat] of parts) {
      if (b.empty) continue;
      const g = new THREE.BufferGeometry();
      // copy the big JS arrays into typed arrays in slices (one-shot Float32BufferAttribute(array) took ~10 ms per attribute in the browser)
      for (const [name, src, k] of [
        ['position', b.p, 3],
        ['normal', b.n, 3],
        ['uv', b.uv, 2],
        ['color', b.c, 3],
      ]) {
        const out = new Float32Array(src.length);
        for (let i0 = 0; i0 < src.length; i0 += 60000) {
          const i1 = Math.min(src.length, i0 + 60000);
          for (let i = i0; i < i1; i++) out[i] = src[i];
          yield;
        }
        g.setAttribute(name, new THREE.BufferAttribute(out, k));
      }
      if (b.fx) {
        // facade batch: the four per-vertex facade vec4s (layer, bays, window type, glass ...) as one interleaved buffer
        const fx = new Float32Array((b.p.length / 3) * 16);
        for (let i0 = 0; i0 < b.fx.length; i0 += 120000) {
          const i1 = Math.min(b.fx.length, i0 + 120000);
          for (let i = i0; i < i1; i++) fx[i] = b.fx[i];
          yield;
        }
        const ib = new THREE.InterleavedBuffer(fx, 16);
        g.setAttribute('aFa', new THREE.InterleavedBufferAttribute(ib, 4, 0));
        g.setAttribute('aFb', new THREE.InterleavedBufferAttribute(ib, 4, 4));
        g.setAttribute('aFc', new THREE.InterleavedBufferAttribute(ib, 4, 8));
        g.setAttribute('aFd', new THREE.InterleavedBufferAttribute(ib, 4, 12));
      }
      const n = g.attributes.position.count,
        at = new Float32Array(n * 2);
      for (const [v0, v1, tx, tz] of ranges)
        for (let v = v0; v < v1; v++) {
          at[v * 2] = tx;
          at[v * 2 + 1] = tz;
        }
      g.setAttribute('aTile', new THREE.BufferAttribute(at, 2));
      // perf (Nov 19): box only, sphere from the box (computeBoundingSphere walked the merged chunk twice more: 50-90 ms steps)
      g.computeBoundingBox();
      yield;
      g.boundingSphere = g.boundingBox.getBoundingSphere(new THREE.Sphere());
      const m = new THREE.Mesh(g, mat);
      m.castShadow = false;
      m.receiveShadow = true;
      m.matrixAutoUpdate = false;
      m.updateMatrix();
      group.add(m);
    }
    root.add(group);
    return group;
  }
  const FARGLASS = () => M.farGlass || M.far;
  // mid/far buildings are written by the near builder itself (same family recipe, tint, window grid, silhouette, crown and roof)
  // into one facade batch drawn with the near facade material: no color or pattern pop at the LOD switch
  const lodFacade = () => !!(M.facadeFar && M.facade);
  function lodBatches(b) {
    const fb = new FBatch();
    const B = new Proxy(
      { fac: fb, trim: fview(fb, WL.stucco), roof: fview(fb, WL.roofConcrete), neon: b },
      { get: (o, k) => (k in o ? o[k] : NULL_BATCH) },
    );
    return { fb, B };
  }
  function* lodBuildings(LB, tile, far) {
    const FQ = [];
    let k = 0,
      tY = performance.now();
    for (const bd of buildingsOf(tile, false)) {
      if (far && bd.h < 12 && bd.area < 1500) continue;
      if (!bd.rings || !bd.rings[0] || bd.rings[0].length < 3) continue;
      if (LB.lift.on) LB.lift.k = baseOf(bd);
      try {
        yield* buildBuildingSliced(LB.B, bd, { shops: false, lod: far ? 2 : 1 }, LB.lift, FQ, true);
      } catch (e) {
        if (!LB.warned) {
          LB.warned = true;
          console.warn('[city-look] LOD building failed', bd.id, e);
        }
      }
      if (TB_YIELD ? performance.now() - tY > 4 : ++k % 6 === 0) {
        yield;
        tY = performance.now();
      } // r2-perf: time-based yields (see buildNear)
    }
  }
  // ELEVATED's LOD decks (vertex-coloured, clipped to the tile) appended straight into a mid/far chunk batch
  function elevLodInto(b, tx, tz) {
    const T = provider.tileSize || 200,
      g = safeCall(
        () =>
          elevated.buildTileLod(tx, tz, {
            minX: tx * T,
            minZ: tz * T,
            maxX: (tx + 1) * T,
            maxZ: (tz + 1) * T,
          }),
        null,
      );
    if (!g) return 0;
    const P = g.attributes.position.array,
      N = g.attributes.normal.array,
      C = g.attributes.color.array,
      I = g.index ? g.index.array : null,
      n = I ? I.length : P.length / 3;
    if (!b.vertRaw) {
      for (let k = 0; k < n; k++) {
        const i = I ? I[k] : k;
        b.p.push(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]);
        b.n.push(N[i * 3], N[i * 3 + 1], N[i * 3 + 2]);
        b.uv.push(0, 0);
        b.c.push(C[i * 3], C[i * 3 + 1], C[i * 3 + 2]);
      }
      g.dispose();
      return n;
    }
    for (let k = 0; k < n; k++) {
      const i = I ? I[k] : k;
      b.vertRaw(
        P[i * 3],
        P[i * 3 + 1],
        P[i * 3 + 2],
        N[i * 3],
        N[i * 3 + 1],
        N[i * 3 + 2],
        0,
        0,
        C[i * 3],
        C[i * 3 + 1],
        C[i * 3 + 2],
      );
    }
    g.dispose();
    return n;
  }
  function* buildMid(ca, cb, CS) {
    const b = new Batch(),
      ranges = [],
      gb = new Batch(),
      granges = [],
      T = provider.tileSize,
      n = CS / T,
      LFm = { on: false, k: null };
    liftB(b, LFm);
    liftB(gb, LFm);
    const LB = lodFacade() ? { ...lodBatches(b), lift: LFm } : null,
      franges = [];
    if (LB) liftB(LB.fb, LFm);
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) {
        const tx = ca * n + i,
          tz = cb * n + j,
          tile = yield* getTileG(tx, tz);
        if (!tile) continue;
        const v0 = b.p.length / 3,
          g0 = gb.p.length / 3,
          f0 = LB ? LB.fb.p.length / 3 : 0;
        LFm.on = !!(tile.relief && D);
        LFm.k = null;
        yield* portYardGen(tile);
        {
          const pp = newProps(),
            cb2 = LB ? fview(LB.fb, WL.corrugated) : b;
          portYard(tile, pp);
          let ns = 0;
          for (const st of pp.stack) {
            fastBox(
              cb2,
              st.x,
              st.n * 1.3,
              st.z,
              6.1,
              st.n * 1.3,
              1.22,
              containerColor(st.x, st.z, st.n - 1, st.row || 0),
            );
            if (++ns % 300 === 0) yield;
          }
        }
        // stream hitches (Nov 19): time-based yields inside the per-tile loops (a whole tile's areas, sidewalks or
        // roads in one step took 100+ ms downtown)
        let tY = performance.now();
        for (const a of tile.areas || []) {
          if (a.kind !== 'land' && !synthArea(a))
            fillPoly(b, a.rings, AREA_Y[a.kind] ?? 0.01, MID_COL[a.kind] ?? 0x8c8a84, 0);
          if (performance.now() - tY > 4) {
            yield;
            tY = performance.now();
          }
        }
        yield;
        tY = performance.now();
        for (const rings of sidewalksOf(tile)) {
          fillPoly(b, rings, CURB, 0xc8c4bc, 0);
          if (performance.now() - tY > 4) {
            yield;
            tY = performance.now();
          }
        }
        yield;
        tY = performance.now();
        for (const pq of tile.piers || []) fillPoly(b, pq.rings, pq.y ?? 1.2, 0x8b6a4a, 0);
        const lodE = !!(elevated && elevated.buildTileLod);
        for (const r of tile.roads) {
          if (r.pts.length < 2 || (lodE && owned(r))) continue;
          if (performance.now() - tY > 4) {
            yield;
            tY = performance.now();
          }
          const pr = roadProfile(r, tile);
          ribbon(b, polyFrame(pr.pts), pr.ys, -r.width / 2, r.width / 2, 0.05, 0x3a3a3c, 0);
          if (pr.ys)
            for (const side of [-1, 1])
              sideWall(
                b,
                polyFrame(pr.pts),
                pr.ys,
                (side * r.width) / 2,
                1.8,
                -0.9,
                0xb8b4ac,
                side,
              );
        }
        for (const n of tile.nodes || []) {
          if (n.degree < 3) continue;
          const J = junctionOf(n.id);
          if (J) fillPoly(b, [J.poly], 0.05, 0x3a3a3c, 0);
        } // job 4: curb returns at mid range too (no grass corners popping in)
        if (lodE) {
          elevLodInto(b, tx, tz);
          yield;
        }
        if (LB) yield* lodBuildings(LB, tile, false);
        else {
          let k = 0;
          for (const bd of buildingsOf(tile, false)) {
            const outer = orient(bd.rings[0]);
            if (outer.length < 3) continue;
            if (LFm.on) LFm.k = baseOf(bd);
            const zone = zoneAt(bd.cx, bd.cz),
              style = styleFor(bd, zone, bd.id | 0),
              rr = hash(bd.id | 0);
            if (isTower(bd, style)) {
              // same silhouette as the near build: podium, inset body, setback, crown
              const ts = towerShape(bd, outer, bd.id | 0, bd.h),
                pc = new THREE.Color(
                  OFFICE_TINTS[(hash((bd.id | 0) + 54) * 11) | 0],
                ).multiplyScalar(0.9);
              wallStrip(b, outer, 0, ts.podH, 24, 28, pc, 0, 0);
              fillPoly(b, bd.rings, ts.podH, new THREE.Color(0x9a968e), 0);
              const tgt = style === 'glass' ? gb : b,
                tc = style === 'glass' ? new THREE.Color(GLASS_TINTS[(rr * 8) | 0]) : pc,
                tw2 = style === 'glass' ? 32 : 24,
                th2 = style === 'glass' ? 64 : 28;
              wallStrip(tgt, ts.body, ts.podH, ts.hA, tw2, th2, tc, ((rr * 16) | 0) / 16, 0);
              if (ts.tall) {
                fillPoly(b, [ts.body], ts.hA, new THREE.Color(0x8a8f94), 0);
                wallStrip(tgt, ts.top, ts.hA, bd.h, tw2, th2, tc, ((rr * 16) | 0) / 16, 0);
              }
              fillPoly(b, [ts.top], bd.h, new THREE.Color(0x80868c), 0);
              if (ts.kind < 0.3)
                wallStrip(
                  b,
                  scalePoly(ts.top, bd.cx, bd.cz, -2.5),
                  bd.h,
                  bd.h + 4.5,
                  10,
                  10,
                  new THREE.Color(0x5d6266),
                );
              else if (ts.kind < 0.55) wallStrip(tgt, ts.top, bd.h, bd.h + 6, tw2, th2, tc, 0, 0);
              else if (ts.kind < 0.75) fastBox(b, bd.cx, bd.h + 15, bd.cz, 0.8, 15, 0.8, 0xdfe6ec);
            } else if (style === 'glass') {
              // glass keeps its material character at distance (reflective curtain wall)
              wallStrip(
                gb,
                outer,
                bd.minH || 0,
                bd.h,
                32,
                64,
                new THREE.Color(GLASS_TINTS[(rr * 8) | 0]),
                ((rr * 16) | 0) / 16,
                0,
              );
              fillPoly(b, bd.rings, bd.h, new THREE.Color(0x80868c), 0);
            } else {
              const c = new THREE.Color(
                style === 'deco'
                  ? PASTELS[(rr * 12) | 0]
                  : style === 'house'
                    ? MED[(rr * 5) | 0]
                    : OFFICE_TINTS[(rr * 11) | 0],
              ).multiplyScalar(0.9);
              wallStrip(b, outer, bd.minH || 0, bd.h, 24, 28, c, ((rr * 8) | 0) / 8, 0);
              fillPoly(b, bd.rings, bd.h, new THREE.Color(0x9a968e), 0);
            }
            if (++k % 25 === 0) yield;
          }
        }
        if (LB) franges.push([f0, LB.fb.p.length / 3, tx, tz]);
        ranges.push([v0, b.p.length / 3, tx, tz]);
        granges.push([g0, gb.p.length / 3, tx, tz]);
        yield;
      }
    yield;
    const cg = yield* chunkMesh(
      [
        [b, ranges, M.far],
        [gb, granges, FARGLASS()],
        ...(LB ? [[LB.fb, franges, M.facadeFar]] : []),
      ],
      `chunk-mid-${ca},${cb}`,
    );
    yield* terrainLod(cg, ca, cb, CS, 16);
    if (cg) midBuilt(ca, cb, n, cg);
    return cg;
  }
  // one global low-detail land base (y = -0.05, under every LOD) so distant islands never float on the ocean
  function* buildLandBase() {
    if (!provider.landPolys) return null;
    const b = new Batch();
    let k = 0;
    const islet = (rings) => {
      if (!D || !D.isIsletAt) return false;
      const r0 = rings[0];
      let a = Infinity,
        c = -Infinity,
        d = Infinity,
        e = -Infinity;
      for (const [x, z] of r0) {
        a = Math.min(a, x);
        c = Math.max(c, x);
        d = Math.min(d, z);
        e = Math.max(e, z);
      }
      return c - a < 270 && e - d < 270 && D.isIsletAt((a + c) / 2, (d + e) / 2);
    }; // tiny offshore specks are open water now
    for (const rings of provider.landPolys) {
      if (!islet(rings)) fillPoly(b, rings, -0.05, 0x5c6645, 0);
      if (++k % 20 === 0) yield;
    }
    if (!GC_OFF) {
      // ground-continuity: muted green-brown, varied per vertex (no flat gray land while tiles stream / at mid range)
      const h2 = (x, z) => {
        const v = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
        return v - Math.floor(v);
      };
      const vn = (x, z) => {
        const xi = Math.floor(x),
          zi = Math.floor(z),
          fx = x - xi,
          fz = z - zi,
          u = fx * fx * (3 - 2 * fx),
          v = fz * fz * (3 - 2 * fz);
        return (
          (h2(xi, zi) * (1 - u) + h2(xi + 1, zi) * u) * (1 - v) +
          (h2(xi, zi + 1) * (1 - u) + h2(xi + 1, zi + 1) * u) * v
        );
      };
      for (let i = 0, n = b.p.length / 3; i < n; i++) {
        const kk = 0.85 + vn(b.p[i * 3] * 0.004, b.p[i * 3 + 2] * 0.004) * 0.3;
        b.c[i * 3] = 0.36 * kk;
        b.c[i * 3 + 1] = 0.4 * kk;
        b.c[i * 3 + 2] = 0.27 * kk;
      }
    }
    const group = new THREE.Group();
    group.name = 'miami-land-base';
    let lbMat = M.far;
    if (GM_ON) {
      lbMat = M.far.clone();
      lbMat.onBeforeCompile = M.far.onBeforeCompile;
      if (M.far.customProgramCacheKey) lbMat.customProgramCacheKey = M.far.customProgramCacheKey;
      lbMat.polygonOffset = true;
      lbMat.polygonOffsetFactor = LADDER_ON ? 2.5 : 1;
      lbMat.polygonOffsetUnits = LADDER_ON ? 11 : 2;
      /* W4 ladder: always behind the coarse terrain LOD (2 / 8) too, not only the near terrain */ lbMat.name =
        'land-base';
      lbMat.metalness = 0;
      lbMat.roughness = 0.92;
    } // ground pass: the base sits 3 cm under the terrain; pushed back in depth so it never z-fights with the terrain far away
    const m = meshOf(b, lbMat, { cast: false });
    if (m) {
      const pa = m.geometry.attributes.position.array,
        nv = m.geometry.attributes.position.count,
        at = new Float32Array(nv * 2),
        TS = provider.tileSize || 200;
      at.fill(-1e6);
      if (GM_ON && terrain && !m.geometry.index)
        for (let i = 0; i + 2 < nv; i += 3) {
          // only triangles wholly on synthetic (terrain) land: real-Miami fills keep the base as their gap filler
          let syn = true;
          for (let k = i; k < i + 3; k++)
            if (terrain.real(pa[k * 3], pa[k * 3 + 2])) {
              syn = false;
              break;
            }
          if (syn)
            for (let k = i; k < i + 3; k++) {
              at[k * 2] = pa[k * 3] / TS - 0.5;
              at[k * 2 + 1] = pa[k * 3 + 2] / TS - 0.5;
            }
        } // ground pass: tile coords are linear in position, so the near-tile cut is exact per pixel: the base is dropped wherever full-detail ground exists (it rose above the shore slope as a pale band)
      m.geometry.setAttribute('aTile', new THREE.BufferAttribute(at, 2));
      group.add(m);
    }
    root.add(group);
    return group;
  }
  function* buildFar(ca, cb, CS) {
    const b = new Batch(),
      ranges = [],
      gb = new Batch(),
      granges = [],
      T = provider.tileSize,
      n = CS / T,
      LFm = { on: false, k: null };
    liftB(b, LFm);
    liftB(gb, LFm);
    const LB = lodFacade() ? { ...lodBatches(b), lift: LFm } : null,
      franges = [];
    if (LB) liftB(LB.fb, LFm);
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) {
        const tx = ca * n + i,
          tz = cb * n + j,
          tile = provider.farTile ? provider.farTile(tx, tz) : yield* getTileG(tx, tz);
        if (!tile) continue;
        if (provider.farTile) tile._far = true;
        const v0 = b.p.length / 3,
          g0 = gb.p.length / 3,
          f0 = LB ? LB.fb.p.length / 3 : 0;
        LFm.on = !!(tile.relief && D);
        LFm.k = null;
        if (elevated && elevated.buildTileLod) {
          elevLodInto(b, tx, tz);
          yield;
        } else
          for (const r of tile.roads)
            if (r.y && r.pts.length > 1) {
              const pr = roadProfile(r, tile);
              if (pr.ys)
                ribbon(b, polyFrame(pr.pts), pr.ys, -r.width / 2, r.width / 2, 0.05, 0x707070, 0);
            }
        if (LB) yield* lodBuildings(LB, tile, true);
        else {
          for (const bd of buildingsOf(tile, false)) {
            if (bd.h < 12 && bd.area < 1500) continue;
            const outer = orient(bd.rings[0]);
            if (outer.length < 3) continue;
            const rr = hash(bd.id | 0);
            if (bd.h > 45)
              wallStrip(
                gb,
                outer,
                bd.minH || 0,
                bd.h,
                32,
                64,
                new THREE.Color(GLASS_TINTS[(rr * 8) | 0]),
                ((rr * 16) | 0) / 16,
                0,
              );
            else
              wallStrip(
                b,
                outer,
                bd.minH || 0,
                bd.h,
                24,
                28,
                new THREE.Color(OFFICE_TINTS[(rr * 11) | 0]).multiplyScalar(0.85),
                ((rr * 8) | 0) / 8,
                0,
              );
            fillPoly(b, [outer], bd.h, new THREE.Color(0x8a867e), 0);
          }
        }
        if (LB) franges.push([f0, LB.fb.p.length / 3, tx, tz]);
        ranges.push([v0, b.p.length / 3, tx, tz]);
        granges.push([g0, gb.p.length / 3, tx, tz]);
        yield;
      }
    yield;
    const cg = yield* chunkMesh(
      [
        [b, ranges, M.far],
        [gb, granges, FARGLASS()],
        ...(LB ? [[LB.fb, franges, M.facadeFar]] : []),
      ],
      `chunk-far-${ca},${cb}`,
    );
    yield* terrainLod(cg, ca, cb, CS, 32);
    return cg;
  }

  // ---------------- COLLIDERS: trimesh per tile (roads/sidewalks/curbs/intersections + building shells) ----------------
  // A growable Float32 triangle soup (memory pass, Nov 19). The soups were plain JS arrays of boxed numbers, copied
  // twice more on commit (slice, then Float32Array): buildColliders was the top allocator while streaming.
  class ColSoup {
    constructor() {
      this.a = new Float32Array(9 * 1024);
      this.length = 0;
      this._tag = null;
    }
    grow(n) {
      if (this.length + n <= this.a.length) return;
      const b = new Float32Array(Math.max(this.a.length * 2, this.length + n));
      b.set(this.a.subarray(0, this.length));
      this.a = b;
    }
    // push(v0, v1, ...): any number of values, like Array.prototype.push
    push() {
      const n = arguments.length;
      this.grow(n);
      for (let k = 0; k < n; k++) this.a[this.length + k] = arguments[k];
      this.length += n;
    }
    pushRange(src, start, n) {
      this.grow(n);
      for (let k = 0; k < n; k++) this.a[this.length + k] = src[start + k];
      this.length += n;
    }
    // a fresh Float32Array of [from, to) (Rapier keeps its own copy, but the caller may reuse the soup afterwards)
    copy(from, to) {
      return this.a.slice(from, to);
    }
  }
  const colStats = { n: 0, max: 0 },
    colTags = new Map();
  // debugging aid for other agents: which CITY generator owns the static geometry at a point (props of collider-built tiles + buildings)
  const colTileReg = new Map();
  if (typeof window !== 'undefined')
    window.__workNear = (x, z, r = 400) => {
      const out = [];
      for (const t of colTileReg.values())
        for (const p of (t.props && t.props.work) || [])
          if (Math.hypot(p.x - x, p.z - z) < r)
            out.push({ v: p.v, x: +p.x.toFixed(1), y: +(p.y || 0).toFixed(2), z: +p.z.toFixed(1) });
      return out;
    }; // props pass: debug / review (work zones, sites)
  function colliderSourceAt(x, z, r = 2) {
    const out = [],
      T = provider.tileSize || 200,
      t = colTileReg.get(Math.floor(x / T) + ',' + Math.floor(z / T));
    if (!t) return out;
    for (const [kind, list] of Object.entries(t.props || {})) {
      if (!Array.isArray(list)) continue;
      for (const p of list)
        if (p && Number.isFinite(p.x) && Math.hypot(p.x - x, p.z - z) < r)
          out.push({ kind, x: +p.x.toFixed(2), y: +(p.y || 0).toFixed(2), z: +p.z.toFixed(2) });
    }
    const tile = provider.getTile ? provider.getTile(Math.floor(x / T), Math.floor(z / T)) : null;
    if (tile && !tile.then)
      for (const b of buildingsOf(tile))
        if (b.rings && pipR(b.rings[0], x, z))
          out.push({
            kind: 'building',
            id: b.id,
            h: b.h,
            minH: b.minH || 0,
            passage: !!b._passage,
          });
    return out;
  }
  function* buildColliders(t) {
    const handles = [];
    t._colPartial = handles;
    const regKey =
      Math.floor((t.cx ?? (t.tx + 0.5) * provider.tileSize) / provider.tileSize) +
      ',' +
      Math.floor((t.cz ?? (t.tz + 0.5) * provider.tileSize) / provider.tileSize);
    colTileReg.set(regKey, t); // lets the streamer release partially built colliders if the job is cancelled
    // memory leak (Nov 19): the registry kept every tile ever given colliders (with all its prop lists) for good;
    // removeColliders now drops the entry with the tile's colliders
    handles.regKey = regKey;
    handles.regTile = t;
    const tile = yield* getTileG(t.tx, t.tz);
    if (!tile) {
      t._colPartial = null;
      return handles;
    }
    const LFc = !!(tile.relief && D); // relief tile: road / building collider vertices are raised onto the terrain like the render
    // trimesh from a triangle soup; drops degenerate / non-finite triangles (they can make parry panic in ray/shape casts)
    const ground = new ColSoup(),
      solid = new ColSoup();
    // audit mode (ctx.auditTags): every collider source gets its own trimesh, tagged in colTags (handle -> source)
    const audit = !!ctx.auditTags,
      soups = new Map(),
      soupOf = (tag) => {
        if (!soups.has(tag)) soups.set(tag, new ColSoup());
        return soups.get(tag);
      };
    const add = (batch, out = ground, dk = null) => {
      if (LFc && !batch.empty) {
        const Q = batch.p;
        for (let i = 1; i < Q.length; i += 3) Q[i] += dk !== null ? dk : TH(Q[i - 1], Q[i + 1]);
      }
      if (batch.empty) return;
      const P = batch.p;
      for (let i = 0; i + 8 < P.length; i += 9) {
        const ax = P[i],
          ay = P[i + 1],
          az = P[i + 2],
          bx = P[i + 3] - ax,
          by = P[i + 4] - ay,
          bz = P[i + 5] - az,
          cx = P[i + 6] - ax,
          cy = P[i + 7] - ay,
          cz = P[i + 8] - az;
        const nx = by * cz - bz * cy,
          ny = bz * cx - bx * cz,
          nz = bx * cy - by * cx,
          a2 = nx * nx + ny * ny + nz * nz;
        if (!(a2 > 1e-8) || !Number.isFinite(a2 + ax + ay + az)) continue;
        out.pushRange(P, i, 9);
      }
    };
    // one trimesh per soup, split only above MAX_TRI so each createCollider (BVH build) stays ~1-3 ms
    const MAX_TRI = 6000;
    function* commit(out) {
      for (let t0 = 0; t0 < out.length; t0 += MAX_TRI * 9) {
        const v = out.copy(t0, Math.min(out.length, t0 + MAX_TRI * 9));
        if (v.length < 9) continue;
        const idx = new Uint32Array(v.length / 3);
        for (let i = 0; i < idx.length; i++) idx[i] = i;
        yield;
        const tc = performance.now();
        handles.push(world.createCollider(RAPIER.ColliderDesc.trimesh(v, idx)));
        if (audit) colTags.set(handles[handles.length - 1].handle, out._tag || '?');
        colStats.n++;
        colStats.max = Math.max(colStats.max, performance.now() - tc);
        yield;
      }
      out.length = 0;
    }
    let g = new Batch(),
      curTag = 'road';
    const tagB = new Map();
    const flush = () => {
      if (audit) {
        for (const [tg, bt] of tagB) add(bt, soupOf(tg));
        tagB.clear();
      }
      add(g);
      g = new Batch();
    };
    const collObj = {
      get tag() {
        return curTag;
      },
      set tag(v) {
        curTag = v;
      },
      vert: (...a) => {
        if (audit) {
          if (!tagB.has(curTag)) tagB.set(curTag, new Batch());
          tagB.get(curTag).vert(...a);
        } else g.vert(...a);
      },
      get empty() {
        return g.empty;
      },
    };
    // the dummy render batches are discarded; only the collision batch `g` is kept (flushed into a trimesh every few roads)
    const dummyB = {
      guard: new Batch(),
      asphalt: new Batch(),
      marks: new Batch(),
      sidewalk: new Batch(),
      trim: new Batch(),
    };
    const it = buildRoads(dummyB, tile, null, collObj, flush);
    for (let r = it.next(); !r.done; r = it.next()) {
      dummyB.guard = new Batch();
      dummyB.asphalt = new Batch();
      dummyB.marks = new Batch();
      dummyB.sidewalk = new Batch();
      dummyB.trim = new Batch();
      yield;
    }
    flush();
    yield;
    if (LFc && terrain) {
      const T0 = provider.tileSize || 200,
        tr = yield* terrain.gridGen(t.tx * T0, t.tz * T0, (t.tx + 1) * T0, (t.tz + 1) * T0, 4, {
          coll: true,
        });
      if (tr) {
        const C3 = tr.coll;
        ground.pushRange(C3, 0, C3.length);
        tr.geometry.dispose();
      }
    } // same vertices as the rendered terrain
    else
      for (const a of tile.areas || [])
        if (a.kind !== 'pool')
          fillPoly(g, a.rings, plazaRaised(a) && !PLAZA_CLIP ? CURB : 0, 0xffffff, 1); // job 4: raised block plazas walk at slab height (clipped slab below)
    // ground cover: every 2 m cell of this tile that is land (not water) gets a floor at y = 0, so no land is ever without a collider
    // (OSM land polygons miss slivers along the coast, tile borders and whole map-edge tiles; the visual land base covers them)
    // r2-physics (QA-030/037, QA-007/036): the fallback land floor stands where the land is DRAWN: no floor where the terrain is drawn
    // under water (it made an invisible floor 0.35 m over the seabed past the shore), and at the land base's own height (-0.05: feet hovered 5 cm)
    const SEA_Y = D?.seaLevel ?? -0.12,
      LB_Y = -0.05,
      shoreWet = (x, z) => {
        try {
          const h = terrain?.heightAt?.(x, z);
          return Number.isFinite(h) && h < SEA_Y - 0.06;
        } catch (e) {
          return false;
        }
      };
    if (isWater && !(LFc && terrain)) {
      const T = tile.size || provider.tileSize || 200,
        x0 = tile.x0 ?? t.x0,
        z0 = tile.z0 ?? t.z0,
        C = 2,
        N = Math.round(T / C);
      for (let j = 0; j < N; j++) {
        let run = -1;
        for (let i = 0; i <= N; i++) {
          const land =
            i < N &&
            !isWater(x0 + (i + 0.5) * C, z0 + (j + 0.5) * C) &&
            !shoreWet(x0 + (i + 0.5) * C, z0 + (j + 0.5) * C);
          if (land && run < 0) run = i;
          if (!land && run >= 0) {
            const xa = x0 + run * C,
              xb = x0 + i * C,
              za = z0 + j * C,
              zb = za + C;
            quadUp(g, [xa, LB_Y, za], [xb, LB_Y, za], [xb, LB_Y, zb], [xa, LB_Y, zb], WHITE, 1);
            run = -1;
          }
        }
        if ((j & 3) === 3) yield;
      }
    }
    if (audit) (add(g, soupOf('area')), (g = new Batch()));
    flush();
    yield;
    sidewalksOf(tile);
    yield;
    roadIndex(tile, true);
    yield;
    for (const rings of sidewalksOf(tile)) {
      yield* clipGen(rings, tile);
      sidewalkPoly(null, rings, g, null, 1, tile);
      yield;
    }
    // ground pass (Nov 19): raised plazas collide where they are drawn: the same clipped slab and curb
    // faces as the render (relief tiles had no plaza collider at all, so feet sank 15 cm into the paving)
    if (PLAZA_CLIP)
      for (const a of tile.areas || []) {
        if (!plazaRaised(a)) continue;
        yield* clipGen(a.rings, tile);
        sidewalkPoly(null, a.rings, g, null, 1, tile);
        yield;
      }
    if (audit) (add(g, soupOf('sidewalkPoly')), (g = new Batch()));
    for (const p of tile.piers || []) pierDeck(null, p, g, null);
    if (audit) (add(g, soupOf('pierDeck')), (g = new Batch()));
    flush();
    yield;
    let bb = new Batch(),
      k = 0,
      tB = performance.now();
    // physics-audit: buildings the far LOD leaves out (farSkips) are drawn only by the mid / near builds, fences and
    // fixed library sites only by the near build: their colliders go into their own soups (see propCollidersOn)
    const smallSoup = new ColSoup(),
      nearSoup = new ColSoup();
    for (const b of buildingsOf(tile)) {
      if (houseLots.claims(b)) continue; // r2-physics (QA-045): building parts are solid too (tall parts above a low outline were walk-through, roofs 11 m above their collider) // claimed houses bring their own colliders (setpieces/houses)
      if (PROP_GATE && !audit && farSkips(b)) {
        add(bb, solid);
        bb = new Batch();
        buildBuilding(NULLB, b, { coll: bb, shops: false, relief: LFc });
        add(bb, smallSoup, LFc ? baseOf(b) : null);
        bb = new Batch();
      } else buildBuilding(NULLB, b, { coll: bb, shops: false, relief: LFc });
      if (LFc) {
        add(bb, audit ? soupOf('building') : solid, baseOf(b));
        bb = new Batch();
      }
      // stream hitches (Nov 19): also yield on elapsed time (40 big downtown buildings were one 100-200 ms step)
      if (++k % 40 === 0 || performance.now() - tB > 4) {
        add(bb, audit ? soupOf('building') : solid);
        bb = new Batch();
        yield;
        tB = performance.now();
      }
    }
    add(bb, audit ? soupOf('building') : solid);
    bb = new Batch();
    LIBM.fenceCollide(bb, tile, LFc);
    add(bb, audit ? soupOf('building') : PROP_GATE ? nearSoup : solid);
    yield;
    if (tile.x0 !== undefined) {
      const fx = new Batch();
      LIBM.fixedCollide(fx, tile.x0, tile.z0, tile.size || provider.tileSize || 200);
      add(fx, audit ? soupOf('building') : PROP_GATE ? nearSoup : solid, 0);
    } // fixed library sites (absolute heights)
    yield* commit(ground);
    // physics-audit: buildings, fences and fixed sites (drawn by the mid / far LOD as well) get their own trimeshes;
    // the colliders from here on belong to street furniture drawn only by this tile's NEAR build (see propCollidersOn)
    yield* commit(solid);
    const smallFrom = handles.length;
    yield* commit(smallSoup);
    const propFrom = handles.length;
    yield* commit(nearSoup);
    const keepOn = new Set();
    // primitive colliders for street furniture and trees
    const P = yield* ensureProps(t, tile);
    let cur = solid;
    const sol = (k) => (cur = audit ? soupOf('prop:' + k) : solid);
    const tri = (a, b, c) => cur.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    const prism = (ring, y0, y1) => {
      const n = ring.length,
        tp = ring.map(([x, z]) => [x, y1, z]),
        bt = ring.map(([x, z]) => [x, y0, z]);
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        tri(bt[i], bt[j], tp[j]);
        tri(bt[i], tp[j], tp[i]);
      }
      for (let i = 1; i < n - 1; i++) {
        tri(tp[0], tp[i + 1], tp[i]);
        tri(bt[0], bt[i], bt[i + 1]);
      }
    };
    const cyl = (x, y, z, hh, r) => {
      const ring = [];
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2;
        ring.push([x + Math.cos(a) * r, z + Math.sin(a) * r]);
      }
      prism(ring, y, y + hh * 2);
    };
    const box = (x, y, z, hx, hy, hz, ry) => {
      const s = Math.sin(ry),
        co = Math.cos(ry),
        P4 = [
          [-hx, -hz],
          [hx, -hz],
          [hx, hz],
          [-hx, hz],
        ].map(([a, b]) => [x + a * co + b * s, z - a * s + b * co]);
      prism(P4, y, y + hy * 2);
    };
    // large / few objects keep real cuboids (solid volumes, cheap)
    const cuboid = (x, y, z, hx, hy, hz, ry) =>
      handles.push(
        world.createCollider(
          RAPIER.ColliderDesc.cuboid(hx, hy, hz)
            .setTranslation(x, y + hy, z)
            .setRotation({ x: 0, y: Math.sin(ry / 2), z: 0, w: Math.cos(ry / 2) }),
        ),
      );
    let c = 0;
    sol('lamp');
    for (const p of P.lamp) {
      cyl(p.x, p.y, p.z, 3.6, 0.14);
      if (++c % 60 === 0) yield;
    }
    // r2-physics: palms / trees get trunk-following capsules from src/vehicles/physics/trunks.js (game.vegetation.trunksNear covers these
    // instances); the old vertical cylinders stood beside leaning trunks (invisible wall) and are skipped then (?trunks=0 keeps them)
    const TRUNKS = !!globalThis.__r2TrunkColliders;
    sol('palm');
    if (!TRUNKS)
      for (const p of P.palm) {
        cyl(p.x, p.y, p.z, 2, 0.28);
        if (++c % 60 === 0) yield;
      }
    sol('tree');
    if (!TRUNKS)
      for (const p of P.tree || []) {
        cyl(
          p.x,
          p.y,
          p.z,
          2.4,
          (p.sp === 'banyan' ? 0.75 : /citrus|seagrape|mangrove/.test(p.sp) ? 0.14 : 0.34) *
            (p.s || 1),
        );
        if (++c % 60 === 0) yield;
      }
    // X1 breakables: small street props get their own box (a car above ~15 km/h knocks them over: src/world/miami/breakables.js)
    const BRK = !audit && breakables.enabled,
      bOwner = 'tile:' + t.tx + ',' + t.tz;
    if (BRK) breakables.removeOwner(bOwner);
    const brk = (kind, p, hx, hy, hz) => {
      const rec = breakables.add({
        x: p.x,
        y: p.y || 0,
        z: p.z,
        hx,
        hy,
        hz,
        ry: p.ry || 0,
        kind,
        owner: bOwner,
        hide: () => hideProp(t, kind, p),
      });
      if (rec) handles.push(rec.collider);
      return !!rec;
    };
    // props pass: light props are Rapier bodies (src/world/props/dynamicProps.v2.js) and every library prop's collider is
    // measured from its mesh (src/world/props/propShapes.v2.js): cylinder bins, box carts, posts with their heads
    const DYN = !audit && dynProps.enabled && !!SK,
      dOwner = 'tile:' + t.tx + ',' + t.tz;
    if (DYN) {
      dynProps.removeOwner(dOwner);
      handles.dynOwner = dOwner;
    }
    const partOf = (kind, p) => (VARIANT[kind] ? VARIANT[kind](p) : p.v);
    const shapesOf = (name) => {
      const parts = SK && SK.parts[name];
      if (!parts) return null;
      const ph = physOf(name, parts);
      if (ph) return ph.shapes;
      const b = boundsOf(parts);
      return [
        {
          t: 'box',
          hx: (b.max.x - b.min.x) / 2,
          hy: (b.max.y - b.min.y) / 2,
          hz: (b.max.z - b.min.z) / 2,
          x: (b.max.x + b.min.x) / 2,
          y: (b.max.y + b.min.y) / 2,
          z: (b.max.z + b.min.z) / 2,
        },
      ];
    };
    const collShapes = (p, shapes) => {
      const sc = p.s || 1,
        ry = p.ry || 0,
        co = Math.cos(ry),
        si = Math.sin(ry);
      for (const sh of shapes) {
        const lx = (sh.x || 0) * sc,
          lz = (sh.z || 0) * sc,
          wx = p.x + lx * co + lz * si,
          wz = p.z - lx * si + lz * co,
          y = p.y || 0;
        if (sh.t === 'box')
          box(wx, y + ((sh.y || 0) - sh.hy) * sc, wz, sh.hx * sc, sh.hy * sc, sh.hz * sc, ry);
        else
          cyl(
            wx,
            y + ((sh.y || 0) - sh.hh) * sc,
            wz,
            sh.hh * sc,
            (sh.t === 'cone' ? sh.r * 0.55 : sh.r) * sc,
          );
      }
    };
    const SIGNPOST_SHAPES = [
      { t: 'box', hx: 0.035, hy: 1.32, hz: 0.035, y: 1.32 },
      { t: 'box', hx: 0.31, hy: 0.38, hz: 0.025, y: 2.25, z: 0.04 },
    ];
    const dyn = (kind, p, name, shapes, ph) => {
      if (!DYN || p.broken) return false;
      const key = movedKey(kind, p),
        rec = dynProps.add({
          kind,
          cls: ph.cls,
          x: p.x,
          y: p.y || 0,
          z: p.z,
          ry: p.ry || 0,
          rx: p.rx,
          rz: p.rz,
          s: p.s || 1,
          shapes,
          mass: ph.mass,
          friction: ph.friction,
          owner: dOwner,
          m: movedProps.get(key) || p.m,
          setMatrix: (m) => setPropMatrix(t, kind, p, m),
          save: (m) => {
            movedProps.set(key, m);
            p.m = m;
          },
        });
      return !!rec;
    };
    const furn = (kind, p, fallback) => {
      // dynamic when the model is light, else a static collider shaped like the mesh
      const name = SK ? partOf(kind, p) : null,
        ph = name && SK.parts[name] ? physOf(name, SK.parts[name]) : null;
      if (ph && ph.cls !== 'static' && dyn(kind, p, name, ph.shapes, ph)) return;
      const sh = name && shapesOf(name);
      if (sh) collShapes(p, sh);
      else fallback();
    };
    sol('hydrant');
    for (const p of P.hydrant) {
      if (p.broken) continue;
      if (!(BRK && brk('hydrant', p, 0.15, 0.4, 0.15))) cyl(p.x, p.y, p.z, 0.4, 0.15);
    } // props pass: a sheared hydrant leaves no invisible collider after a tile collider rebuild
    sol('bin');
    for (const p of P.bin) furn('bin', p, () => cyl(p.x, p.y, p.z, 0.5, 0.3));
    sol('work');
    for (const p of P.work || [])
      furn('work', p, () => box(p.x, p.y, p.z, 0.3, 0.4, 0.3, p.ry || 0));
    sol('upole');
    for (const p of P.upole) cyl(p.x, p.y, p.z, 5, 0.15);
    sol('sigPole');
    for (const p of P.sigPole || []) cyl(p.x, p.y, p.z, 3.3 * (p.sy || 1), 0.17);
    for (const p of P.pedPost || []) cyl(p.x, p.y, p.z, 1.6, 0.08);
    for (const p of P.cabinet || []) box(p.x, p.y, p.z, 0.4, 0.78, 0.18, p.ry || 0);
    for (const p of P.meter || []) cyl(p.x, p.y, p.z, 0.72, 0.07);
    for (const p of P.mailbox || []) furn('mailbox', p, () => cyl(p.x, p.y, p.z, 0.6, 0.12));
    sol('mast');
    for (const p of P.mast) cyl(p.x, p.y, p.z, 3.2, 0.16);
    sol('signPost');
    for (const p of P.signPost)
      if (
        !(SK && dyn('signPost', p, 'signPost', SIGNPOST_SHAPES, { cls: 'knock', mass: 16 })) &&
        !(BRK && brk('signPost', p, 0.08, 1.6, 0.08))
      )
        cyl(p.x, p.y, p.z, 1.6, 0.06); // props pass: a sign post snaps and falls when a car hits it
    {
      // container stacks: one cuboid per block column (stacks 0.36 m apart = solid wall), never across an aisle
      const cols = new Map();
      for (const p of P.stack) {
        let c = cols.get(p.col);
        if (!c) cols.set(p.col, (c = { x: p.x, z0: p.z, z1: p.z, n: 0 }));
        c.z0 = Math.min(c.z0, p.z);
        c.z1 = Math.max(c.z1, p.z);
        c.n = Math.max(c.n, p.n);
      }
      for (const c of cols.values())
        cuboid(c.x, 0, (c.z0 + c.z1) / 2, 6.1, c.n * 1.3, (c.z1 - c.z0) / 2 + 1.22, 0);
    }
    // water exits (stairs down seawalls) and elevated decks are walked on: never switched off with the props
    yield* commit(solid);
    const exitFrom = handles.length;
    sol('exit');
    exitColliders(tile, tri, box);
    yield* commit(solid);
    for (let i = exitFrom; i < handles.length; i++) keepOn.add(handles[i]);
    if (elevated) {
      const er = yield* elevTileG(t, { visual: false });
      if (er) {
        let nc = 0;
        const tc0 = performance.now();
        for (const c of er.colliderDescs || []) {
          if ((++nc & 7) === 0 && performance.now() - tc0 > 2) {
            yield;
          }
          try {
            const h = world.createCollider(c.desc || c);
            handles.push(h);
            keepOn.add(h);
            if (audit) colTags.set(h.handle, 'elev:' + (c.kind || '?'));
          } catch (e) {
            /* bad desc */
          }
        }
      }
    }
    for (const p of P.boat) {
      cuboid(
        p.x,
        -1.2,
        p.z,
        [1.3, 1.6, 1.45, 2.1][p.v ?? 0] * p.s,
        1.1 * p.s,
        (BOAT_LEN[p.v ?? 0] / 2) * p.s,
        p.ry,
      );
      moorCollider(p, handles[handles.length - 1]);
    }
    sol('hut');
    for (const p of P.hut) {
      box(p.x, p.y, p.z, 1.25, 1.2, 1.25, p.ry);
      box(p.x, p.y + 2.4, p.z, 1.5, 1.2, 1.5, p.ry);
    }
    sol('cafe');
    for (const p of P.cafe) {
      const sh = SK && SK.parts.patio_table ? shapesOf('patio_table') : null;
      if (sh) collShapes(p, sh);
      else box(p.x, p.y, p.z, 1.2, 0.45, 0.3, p.ry);
    } // props pass: the table's own size (chairs are push props)
    // bushes and flower beds are NOT solid (you push through them like real life); they're registered as soft zones that slow you down
    if (!bushTiles.has(t.k)) {
      bushTiles.add(t.k);
      for (const arr of [P.blob, P.flower])
        for (const p of arr) addBush(p.x, p.z, 0.75 * (p.s || 1));
    }
    sol('kiosk');
    for (const p of P.kiosk) {
      const sh = SK && SK.parts.food_cart ? shapesOf('food_cart') : null;
      if (sh) collShapes(p, sh.slice(0, 1));
      else box(p.x, p.y, p.z, 1.3, 1.3, 0.8, p.ry);
    } // props pass: the cart body (walk under its umbrellas)
    sol('bike');
    for (const p of P.bike) {
      const sh = SK && SK.parts.bike_rack ? shapesOf('bike_rack') : null;
      if (sh) collShapes(p, sh);
      else box(p.x, p.y, p.z, 1.6, 0.45, 0.35, p.ry);
    } // props pass: the rack's own size
    sol('bench');
    for (const p of P.bench) {
      const sh = SK && shapesOf(VARIANT.bench(p));
      if (sh) collShapes(p, sh);
      else box(p.x, p.y, p.z, 0.9, 0.45, 0.32, p.ry);
    } // props pass: the bench model's own size
    sol('shelter');
    for (const p of P.shelter) {
      const s = Math.sin(p.ry),
        co = Math.cos(p.ry),
        L = (lx, lz) => [p.x + lx * co + lz * s, p.z - lx * s + lz * co];
      const bb = SK && SK.parts[VARIANT.shelter(p)] ? boundsOf(SK.parts[VARIANT.shelter(p)]) : null; // props pass: walls where the model has them (back panel, end panels)
      if (bb) {
        const hx = (bb.max.x - bb.min.x) / 2 - 0.06,
          cxm = (bb.max.x + bb.min.x) / 2,
          z0 = bb.min.z + 0.08,
          dz = bb.max.z - bb.min.z,
          h = Math.min(1.3, (bb.max.y - bb.min.y) / 2 - 0.1);
        const [bx, bz] = L(cxm, z0);
        box(bx, p.y, bz, hx, h, 0.05, p.ry);
        for (const sx of [-hx, hx]) {
          const [qx, qz] = L(cxm + sx, z0 + dz * 0.3);
          box(qx, p.y, qz, 0.05, h, dz * 0.3, p.ry);
        }
        continue;
      }
      const [bx, bz] = L(0, -0.75);
      box(bx, p.y, bz, 2.0, 1.2, 0.05, p.ry);
      for (const sx of [-2, 2]) {
        const [qx, qz] = L(sx, 0);
        box(qx, p.y, qz, 0.05, 1.25, 0.85, p.ry);
      }
    }
    yield;
    yield* commit(solid);
    if (audit)
      for (const [tg, arr] of soups) {
        arr._tag = tg;
        yield* commit(arr);
      }
    t._propCols = handles.slice(propFrom).filter((h) => !keepOn.has(h));
    t._propOwner = handles.dynOwner || null;
    t._propColsOff = false;
    t._smallCols = handles.slice(smallFrom, propFrom);
    t._smallColsOff = false;
    if (!t.near) propCollidersOn(t, false);
    if (!t.near && !midTiles.has(t.tx + ',' + t.tz)) smallBuildingsOn(t, false);
    t._colPartial = null;
    return handles;
  }
  // physics-audit (Nov 19, user: "an invisible wall in the middle of nowhere"): the collider job of a tile runs ahead of
  // its near build (feet and tires must never wait for the ground), but lamp posts, poles, benches, bins, kiosks and
  // shelters are drawn only by the near build. Until it exists their colliders are switched off, so nothing undrawn
  // stands in the street; buildNear switches them on. ?propgate=0 = the old behavior.
  function propCollidersOn(t, on) {
    const list = t._propCols;
    if (!PROP_GATE || !list || t._propColsOff === !on) return;
    t._propColsOff = !on;
    for (const h of list) {
      // a breakable that was knocked over removed its own collider: only touch live handles
      const c = world.getCollider(h.handle);
      if (c) c.setEnabled(on);
    }
    if (t._propOwner) dynProps.setOwnerEnabled(t._propOwner, on);
    if (on) smallBuildingsOn(t, true);
  }
  // buildings under 12 m and 1500 m2 are not in the far LOD (lodBuildings): solid only once a mid or near build draws them
  const farSkips = (b) => b.h < 12 && b.area < 1500;
  const midTiles = new Set();
  function smallBuildingsOn(t, on) {
    const list = t._smallCols;
    if (!PROP_GATE || !list || t._smallColsOff === !on) return;
    t._smallColsOff = !on;
    for (const h of list) {
      const c = world.getCollider(h.handle);
      if (c) c.setEnabled(on);
    }
  }
  // a finished mid chunk draws every building of its tiles
  function midBuilt(ca, cb, n, group) {
    const keys = [];
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) {
        const tx = ca * n + i,
          tz = cb * n + j;
        keys.push(tx + ',' + tz);
        midTiles.add(tx + ',' + tz);
        const t = colTileReg.get(tx + ',' + tz);
        if (t) smallBuildingsOn(t, true);
      }
    group.userData.midTiles = keys;
  }
  // ---- water exits: stair flights down seawalls / pier ends every ~200 m, sloped sand skirts on beaches ----
  const exitCache = new WeakMap();
  function exitsOf(tile) {
    const c0 = exitCache.get(tile);
    if (c0) return c0;
    const t0 = performance.now(),
      r = exitsOf0(tile);
    colStats.exitMax = Math.max(colStats.exitMax || 0, performance.now() - t0);
    return r;
  }
  function exitsOf0(tile) {
    let ex = exitCache.get(tile);
    if (ex) return ex;
    ex = { steps: [], skirts: [] };
    if (!isWater) {
      exitCache.set(tile, ex);
      return ex;
    }
    const T = tile.size || provider.tileSize || 200,
      x0 = tile.x0 ?? tile.tx * T,
      z0 = tile.z0 ?? tile.tz * T,
      inT = (x, z) => x >= x0 && x < x0 + T && z >= z0 && z < z0 + T;
    const walk = (ring, cb) => {
      const o = orient(ring);
      for (let i = 0; i < o.length; i++) {
        const p = o[i],
          q = o[(i + 1) % o.length],
          L = Math.hypot(q[0] - p[0], q[1] - p[1]);
        if (L < 2) continue;
        if (
          Math.max(p[0], q[0]) < x0 - 5 ||
          Math.min(p[0], q[0]) > x0 + T + 5 ||
          Math.max(p[1], q[1]) < z0 - 5 ||
          Math.min(p[1], q[1]) > z0 + T + 5
        )
          continue;
        const tx = (q[0] - p[0]) / L,
          tz = (q[1] - p[1]) / L;
        let nx = -tz,
          nz = tx;
        const mx = (p[0] + q[0]) / 2,
          mz = (p[1] + q[1]) / 2;
        if (isWater(mx - nx * 3, mz - nz * 3) && !isWater(mx + nx * 3, mz + nz * 3)) {
          nx = -nx;
          nz = -nz;
        }
        if (!isWater(mx + nx * 3, mz + nz * 3) || isWater(mx - nx * 2, mz - nz * 2)) continue;
        cb(p, q, L, tx, tz, nx, nz);
      }
    };
    const natCoast =
      GM_ON && !!(terrain && tile.tx !== undefined && terrain.synthetic(tile.tx, tile.tz)); // generated terrain coasts are natural shores (ground pass)
    // seawalls (land edges on water): a stair flight every ~200 m of waterfront (deterministic phase from world position, so seams agree)
    for (const a of tile.areas || []) {
      if (a.kind !== 'land') continue;
      walk(a.rings[0], (p, q, L, tx, tz, nx, nz) => {
        for (let s2 = 6; s2 < L - 6; s2 += 4) {
          const x = p[0] + tx * s2,
            z = p[1] + tz * s2;
          if (!inT(x, z)) continue;
          const cell = Math.floor(x / 200) + ',' + Math.floor(z / 200);
          if (ex.steps.some((e) => e.cell === cell)) continue;
          if (roadDist && roadDist(x, z) < 6) continue;
          if (!GC_OFF && isBeachAt(x, z)) continue; // beaches slope into the sea: no seawall stair
          if (
            !SEAMS_OLD &&
            (/sand/.test(String(surfAt(x - nx * 2, z - nz * 2))) ||
              /sand/.test(String(surfAt(x, z))) ||
              (natCoast &&
                !/port|downtown|business|commercial|nightlife/.test(String(zoneAt(x, z)))))
          )
            continue; // r2-roads: a natural shore has no seawall, so no stair flight (its buried treads left only the two handrails lying in the shallows)
          ex.steps.push({ cell, x, z, nx, nz, tx, tz, top: 0, w: 2.4 });
          s2 += 150;
        }
      });
    }
    // piers / marina docks: one flight at each pier's seaward end
    for (const pq of tile.piers || []) {
      let best = null;
      walk(pq.rings[0], (p, q, L, tx, tz, nx, nz) => {
        const x = (p[0] + q[0]) / 2,
          z = (p[1] + q[1]) / 2;
        if (!inT(x, z)) return;
        const d = roadDist ? roadDist(x, z) : 0;
        if (!best || d > best.d) best = { d, x, z, nx, nz, tx, tz };
      });
      if (best)
        ex.steps.push({
          ...best,
          top: pq.y ?? 1.2,
          w: 1.6,
          ladder:
            !SEAMS_OLD &&
            !/port|downtown|business|commercial|nightlife/.test(String(zoneAt(best.x, best.z))),
        });
    } // r2-roads: a galvanized dock ladder off Keys / residential / natural piers (concrete flights only at urban quays)
    // beaches: the sand keeps sloping into the water (no lip)
    for (const a of tile.areas || []) {
      if (a.kind !== 'beach' && a.kind !== 'sand') continue;
      walk(a.rings[0], (p, q, L, tx, tz, nx, nz) => ex.skirts.push({ p, q, nx, nz }));
    }
    // ground-continuity: plain land meeting open water inside a beach zone is a beach, not a dirt lawn ending at a seawall:
    // a sand band runs inland from the waterline and the sand slopes on into the sea (same skirt, so colliders follow)
    if (!GC_OFF)
      for (const a of tile.areas || []) {
        if (a.kind !== 'land') continue;
        for (const ring of a.rings)
          walk(ring, (p, q, L, tx, tz, nx, nz) => {
            const mx = (p[0] + q[0]) / 2,
              mz = (p[1] + q[1]) / 2;
            if (isBeachAt(mx, mz) || isBeachAt(mx - nx * 20, mz - nz * 20))
              ex.skirts.push({ p, q, nx, nz, band: true });
          });
      }
    exitCache.set(tile, ex);
    return ex;
  }
  const STEP_H = 0.28,
    STEP_D = 0.55,
    C_STEP = new THREE.Color(0xc9c4b8),
    C_RAILX = new THREE.Color(0x9aa0a6);
  function stairBoxes(e) {
    // [cx, top, cz, along-normal offset] for every tread down to -1.4
    const out = [];
    let k = 0;
    for (let y = e.top - STEP_H; y > -1.5; y -= STEP_H, k++)
      out.push({
        cx: e.x + e.nx * (STEP_D * (k + 0.5)),
        cz: e.z + e.nz * (STEP_D * (k + 0.5)),
        top: y,
      });
    return out;
  }
  function exitVisuals(B, tile, noSand = false) {
    const ex = exitsOf(tile);
    const rod = (a, b, r = 0.045) => {
      const d = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]),
        L = d.length() || 1; // galvanized pipe from a to b
      B.guard.addGeometry(
        CYLG,
        new THREE.Matrix4().compose(
          new THREE.Vector3((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2),
          new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()),
          new THREE.Vector3(r * 2, L, r * 2),
        ),
        C_RAILX,
      );
    };
    for (const e of ex.steps) {
      const ry = Math.atan2(e.tx, e.tz);
      if (e.ladder) {
        // dock ladder: two rails 0.5 m apart, 0.12 m off the pier edge, from 1.3 m under water to grab handles 0.9 m above the deck that
        // curve back onto the deck, round rungs every 0.3 m (no concrete flight: that read as a big white ramp out of the water)
        const ox = e.x + e.nx * 0.12,
          oz = e.z + e.nz * 0.12,
          top = e.top,
          bot = -1.3;
        for (const sd of [-0.25, 0.25]) {
          const x = ox + e.tx * sd,
            z = oz + e.tz * sd,
            xi = e.x - e.nx * 0.45 + e.tx * sd,
            zi = e.z - e.nz * 0.45 + e.tz * sd;
          rod([x, bot, z], [x, top + 0.75, z]);
          rod([x, top + 0.75, z], [(x + xi) / 2, top + 0.92, (z + zi) / 2]);
          rod([(x + xi) / 2, top + 0.92, (z + zi) / 2], [xi, top + 0.75, zi]);
          rod([xi, top + 0.75, zi], [xi, top, zi]);
        }
        for (let y = top - 0.3; y > bot + 0.1; y -= 0.3)
          rod(
            [ox - e.tx * 0.25, y, oz - e.tz * 0.25],
            [ox + e.tx * 0.25, y, oz + e.tz * 0.25],
            0.02,
          );
        continue;
      }
      for (const st of stairBoxes(e))
        B.trim.addGeometry(
          BOXG,
          mat4(st.cx, (st.top - 2.2) / 2, st.cz, ry, e.w, st.top + 2.2, STEP_D),
          C_STEP,
        );
      const n = stairBoxes(e).length,
        len = STEP_D * n;
      // (ground nov19b, user: "glitched railing") a quay only ~12 cm over the sea has every tread under water: its two
      // handrails were all that showed, as black rods slanting into the bay. Handrails only on flights with steps above water.
      if (e.top < 0.6) continue;
      for (const side of [-1, 1]) {
        const ox = e.tx * side * (e.w / 2 - 0.05),
          oz = e.tz * side * (e.w / 2 - 0.05);
        B.guard.addGeometry(
          CYLG,
          new THREE.Matrix4().compose(
            new THREE.Vector3(
              e.x + (e.nx * len) / 2 + ox,
              e.top + 0.9 - (n * STEP_H) / 2,
              e.z + (e.nz * len) / 2 + oz,
            ),
            new THREE.Quaternion().setFromUnitVectors(
              new THREE.Vector3(0, 1, 0),
              new THREE.Vector3(e.nx * len, -n * STEP_H, e.nz * len).normalize(),
            ),
            new THREE.Vector3(0.06, Math.hypot(len, n * STEP_H), 0.06),
          ),
          C_RAILX,
        );
      }
    }
    if (!noSand)
      for (const k of ex.skirts)
        if (k.band) {
          // inland sand band behind the waterline, ragged inner edge (6 m steps)
          const a = k.p,
            b2 = k.q,
            L = Math.hypot(b2[0] - a[0], b2[1] - a[1]),
            n = Math.max(1, Math.ceil(L / 6)),
            wAt = (x, z) => 26 + 16 * (Math.sin(x * 0.043 + Math.sin(z * 0.031) * 2) * 0.5 + 0.5);
          for (let i = 0; i < n; i++) {
            const t0 = i / n,
              t1 = (i + 1) / n,
              x0 = a[0] + (b2[0] - a[0]) * t0,
              z0 = a[1] + (b2[1] - a[1]) * t0,
              x1 = a[0] + (b2[0] - a[0]) * t1,
              z1 = a[1] + (b2[1] - a[1]) * t1,
              w0 = wAt(x0, z0),
              w1 = wAt(x1, z1);
            quadUp(
              B.sand,
              [x0, EXIT_Y, z0],
              [x1, EXIT_Y, z1],
              [x1 - k.nx * w1, EXIT_Y, z1 - k.nz * w1],
              [x0 - k.nx * w0, EXIT_Y, z0 - k.nz * w0],
              new THREE.Color(0xffffff),
              1 / 6,
            );
          }
        }
    if (!noSand)
      for (const k of ex.skirts) {
        const a = k.p,
          b2 = k.q,
          D = 9,
          y1 = -1.6;
        quadUp(
          B.sand,
          [a[0], EXIT_Y, a[1]],
          [b2[0], EXIT_Y, b2[1]],
          [b2[0] + k.nx * D, y1, b2[1] + k.nz * D],
          [a[0] + k.nx * D, y1, a[1] + k.nz * D],
          new THREE.Color(0xffffff),
          1 / 6,
        );
      }
  }
  function exitColliders(tile, tri, box) {
    const ex = exitsOf(tile);
    for (const e of ex.steps) {
      if (e.ladder) continue;
      /* r2-roads: a ladder has no invisible stair under it */ const ry = Math.atan2(e.tx, e.tz);
      for (const st of stairBoxes(e))
        box(st.cx, -2.2, st.cz, e.w / 2, (st.top + 2.2) / 2, STEP_D / 2, ry);
    }
    for (const k of ex.skirts) {
      const a = k.p,
        b2 = k.q,
        D = 9,
        y1 = -1.6;
      tri([a[0], 0.0, a[1]], [b2[0] + k.nx * D, y1, b2[1] + k.nz * D], [b2[0], 0.0, b2[1]]);
      tri(
        [a[0], 0.0, a[1]],
        [a[0] + k.nx * D, y1, a[1] + k.nz * D],
        [b2[0] + k.nx * D, y1, b2[1] + k.nz * D],
      );
    }
  }
  // ---- moorings: static marina boats the VEHICLES agent can swap for a drivable one ----
  const moorings = new Map(),
    claimed = new Set(),
    _mz = new THREE.Matrix4().makeScale(0, 0, 0);
  const moorId = (b) => 'm' + Math.round(b.x * 4) + '_' + Math.round(b.z * 4);
  function moorEntry(b) {
    const id = moorId(b);
    let e = moorings.get(id);
    if (!e)
      moorings.set(
        id,
        (e = {
          id,
          x: b.x,
          z: b.z,
          heading: b.ry,
          length: +(BOAT_LEN[b.v ?? 0] * (b.s || 1)).toFixed(2),
          type: ['console', 'cruiser', 'sloop', 'yacht'][b.v ?? 0],
          item: b,
          h: null,
          k: 0,
          col: null,
        }),
      );
    return e;
  }
  function showBoat(e, on) {
    if (e.h && e.h.p.src) {
      const i = e.h.idx[e.k];
      if (i !== undefined) {
        if (on) {
          dummy.position.set(e.item.x, e.item.y || 0, e.item.z);
          dummy.rotation.set(0, e.item.ry || 0, 0);
          dummy.scale.setScalar(e.item.s || 1);
          dummy.updateMatrix();
          poolSetMatrix(e.h.p, i, dummy.matrix);
        } else poolSetMatrix(e.h.p, i, _mz);
      }
    }
    if (e.col) {
      const c = world.getCollider(e.col.handle);
      if (c && c === e.col && (typeof c.isValid !== 'function' || c.isValid())) c.setEnabled(on);
      else e.col = null;
    } // stale collider (tile unloaded): never touch it (a wasm panic poisons the whole world)
  }
  function moorVisual(b, h, k) {
    const e = moorEntry(b);
    e.h = h;
    e.k = k;
    e.item = b;
    if (claimed.has(e.id)) showBoat(e, false);
  }
  function moorCollider(b, col) {
    const e = moorEntry(b);
    e.col = col;
    if (claimed.has(e.id)) showBoat(e, false);
  }
  function mooringsNear(x, z, r = 400) {
    const out = [];
    for (const e of moorings.values())
      if ((e.h || e.col) && Math.hypot(e.x - x, e.z - z) < r)
        out.push({
          id: e.id,
          x: e.x,
          z: e.z,
          heading: e.heading,
          length: e.length,
          type: e.type,
          claimed: claimed.has(e.id),
        });
    return out;
  }
  function claimMooring(id) {
    const e = moorings.get(id);
    if (!e) return null;
    claimed.add(id);
    showBoat(e, false);
    return { id, x: e.x, z: e.z, heading: e.heading, length: e.length, type: e.type };
  }
  function releaseMooring(id) {
    const e = moorings.get(id);
    claimed.delete(id);
    if (e) showBoat(e, true);
    return !!e;
  }
  const safeCall = (f, dflt) => {
    try {
      const v = f();
      return v === undefined ? dflt : v;
    } catch (e) {
      return dflt;
    }
  };
  function* elevTileG(t, opts) {
    const T = provider.tileSize || 200,
      x0 = t.x0 ?? t.tx * T,
      z0 = t.z0 ?? t.tz * T,
      b0 = { minX: x0, minZ: z0, maxX: x0 + T, maxZ: z0 + T };
    try {
      if (elevated.buildTileSteps) return yield* elevated.buildTileSteps(t.tx, t.tz, b0, opts);
      return elevated.buildTile(t.tx, t.tz, b0, opts);
    } catch (e) {
      return null;
    }
  }
  function elevTile(t, forColliders) {
    // one elevated.buildTile per use; the collider path frees its (never rendered) visuals right away
    const T = provider.tileSize || 200,
      x0 = t.x0 ?? t.tx * T,
      z0 = t.z0 ?? t.tz * T;
    const r = safeCall(
      () => elevated.buildTile(t.tx, t.tz, { minX: x0, minZ: z0, maxX: x0 + T, maxZ: z0 + T }),
      null,
    );
    if (!r) return null;
    if (forColliders && r.group)
      r.group.traverse((o) => {
        if (o.isMesh && !o.isInstancedMesh) o.geometry?.dispose?.();
      });
    return r;
  }
  // ---- soft bush zones (no colliders): a 4 m grid of [x, z, r]; queried by the player controller and vehicles for slowdown ----
  const bushTiles = new Set(),
    bushGrid = new Map(),
    BG = 4;
  function addBush(x, z, r) {
    const k = Math.floor(x / BG) + ',' + Math.floor(z / BG);
    let a = bushGrid.get(k);
    if (!a) bushGrid.set(k, (a = []));
    a.push(x, z, r);
  }
  function bushAt(x, z, pad = 0) {
    // 0..1 how deep inside a bush (0 = not in one)
    let best = 0;
    const cx = Math.floor(x / BG),
      cz = Math.floor(z / BG);
    for (let i = -1; i <= 1; i++)
      for (let j = -1; j <= 1; j++) {
        const a = bushGrid.get(cx + i + ',' + (cz + j));
        if (!a) continue;
        for (let q = 0; q < a.length; q += 3) {
          const d = Math.hypot(x - a[q], z - a[q + 1]),
            r = a[q + 2] + pad;
          if (d < r) best = Math.max(best, 1 - d / r);
        }
      }
    return best;
  }
  function removeColliders(handles) {
    if (handles.regKey !== undefined && colTileReg.get(handles.regKey) === handles.regTile) {
      colTileReg.delete(handles.regKey);
    }
    handles.regTile = null;
    if (handles.dynOwner) {
      dynProps.removeOwner(handles.dynOwner);
      handles.dynOwner = null;
    } // props pass: the tile's prop bodies go with its colliders
    for (const h of handles)
      if (
        h &&
        world.getCollider(h.handle) === h &&
        (typeof h.isValid !== 'function' || h.isValid())
      )
        world.removeCollider(h, false);
    handles.length = 0;
  }
  function dispose(group) {
    if (!group) return;
    for (const k of group.userData.midTiles || []) midTiles.delete(k);
    tileBatch.release(group);
    lawnIndex.delete(group);
    for (const e of moorings.values())
      if (e.h && (group.userData.handles || []).includes(e.h)) e.h = null;
    if (group.userData.tile && onProps && group.userData.tile.props)
      onProps(group.userData.tile, group.userData.tile.props, false);
    if (group.userData.tile)
      occupancy.removeOwner('tile:' + group.userData.tile.tx + ',' + group.userData.tile.tz);
    if (FARVEG) farKeep(group); // W4: impostors stay drawn from the far cache
    for (const h of group.userData.handles || []) poolRemove(h);
    group.userData.handles = null;
    group.userData.farVeg = null;
    group.traverse((o) => {
      if (o.isMesh && !o.isInstancedMesh) {
        o.geometry.dispose();
        if (o.userData.ownedMaterial) {
          o.userData.ownedMaterial.userData.ownedTexture?.dispose();
          o.userData.ownedMaterial.dispose();
        }
      }
    });
    root.remove(group);
  }
  const deckSurfaceAt = (x, z, yHint) => {
    if (elevated) {
      const h = safeCall(() => elevated.heightAt(x, z, yHint), null);
      return Number.isFinite(h) ? h : null;
    }
    const T = provider.tileSize,
      tile = provider.getTile ? provider.getTile(Math.floor(x / T), Math.floor(z / T)) : null;
    if (!tile || tile.then) return null;
    resolveDecks(tile);
    const y = elevIndex(tile).nearestY(x, z, yHint, 3.5);
    return y === null ? null : y + 0.05;
  };
  // r2-perf: props of one tile computed fresh with / without the sink batches (equivalence test; not cached)
  async function debugProps(tx, tz, sinkMode) {
    // generator steps are timed (cpu ms); between steps the event loop runs (tile data loads asynchronously)
    const out = { ms: 0 };
    const run = async (g, timed) => {
      let r;
      for (;;) {
        const t0 = performance.now();
        r = g.next();
        if (timed) out.ms += performance.now() - t0;
        if (r.done) return r.value;
        await new Promise((ok) => setTimeout(ok, 0));
      }
    };
    const tile = await run(getTileG(tx, tz), false);
    if (!tile) return null;
    const T = provider.tileSize || 200;
    out.props = await run(
      ensureProps(
        { tx, tz, x0: tx * T, z0: tz * T, cx: (tx + 0.5) * T, cz: (tz + 0.5) * T, props: null },
        tile,
        sinkMode,
      ),
      true,
    );
    return out;
  }
  if (typeof window !== 'undefined') window.__tbDebugProps = debugProps;
  // road surface audit (tools/v2/road-audit.mjs --surface): the ground surfaces of one tile built exactly as buildNear builds them
  // (areas, terrain grid, sidewalk slabs, roads, junctions, caps, curbs, markings, decals), into tagged batches that never reach the
  // scene. Every vertex carries the source it came from (AUD.src: 'r<edge>' road piece, 'j<node>' junction, 's<k>' slab, 'a' area).
  // Returns { tx, tz, relief, batches: { name: { p: Float32Array, t: string[] (per triangle) } }, terrain: Float32Array | null }.
  async function surfaceTile(tx, tz) {
    const run = async (g) => {
      let r,
        n = 0;
      for (;;) {
        r = g.next();
        if (r.done) return r.value;
        if ((++n & 15) === 0) await new Promise((ok) => setTimeout(ok, 0));
        else await null;
      }
    }; // macrotask breaks: tile data loads arrive as network callbacks
    const tile = await run(getTileG(tx, tz));
    if (!tile) return null;
    const T0 = provider.tileSize || 200,
      X0 = tx * T0,
      Z0 = tz * T0,
      synth = !!(terrain && terrain.synthetic(tx, tz)),
      LF = { on: !!(tile.relief && D), k: null };
    class TB extends Batch {
      constructor() {
        super();
        this.t = [];
      }
      vert(x, y, z, nx, ny, nz, u, v, col) {
        super.vert(x, y, z, nx, ny, nz, u, v, col);
        if (this.p.length % 9 === 0) this.t.push(AUD.src);
      }
    }
    const names = [
      'junction',
      'parking',
      'promenade',
      'panels',
      'wood',
      'guard',
      'asphalt',
      'marks',
      'sidewalk',
      'trim',
      'land',
      'sand',
      'grass',
      'dirtRoad',
      'lines',
      'shoulder',
      'decals',
      'runway',
      'taxiway',
      'apron',
    ];
    const B = {};
    for (const k of names) B[k] = new TB();
    const NB = new Proxy(B, { get: (o, k) => (k in o ? o[k] : NULL_BATCH) });
    if (LF.on) for (const key in B) liftB(B[key], LF);
    for (const key of ['asphalt', 'lines', 'decals']) attachRoadChannel(B[key]);
    AUD.src = 'a';
    for (const a of tile.areas || []) areaFill(NB, a);
    let ter = null;
    if (synth) {
      const tr = await run(terrain.gridGen(X0, Z0, X0 + T0, Z0 + T0, 4, { skirt: 0 }));
      if (tr) ter = tr.geometry.attributes.position.array;
      if (tr) tr.geometry.dispose();
    }
    let k = 0;
    for (const rings of sidewalksOf(tile)) {
      AUD.src = 's' + k++;
      await run(clipGen(rings, tile));
      const zn = zoneAt(rings[0][0][0], rings[0][0][1]);
      if (M.promenade && /beach|nightlife/.test(zn))
        sidewalkPoly(B.promenade, rings, null, B.sidewalk, 1 / 8, tile);
      else if (M.panels && /downtown|business|brickell|commercial/.test(zn))
        sidewalkPoly(B.panels, rings, null, B.sidewalk, 1 / 6, tile);
      else sidewalkPoly(B.sidewalk, rings, null, B.sidewalk, 1 / 2.5, tile);
    }
    AUD.src = 'p';
    for (const p of tile.piers || []) pierDeck(NB, p, null, null);
    AUD.on = true;
    await run(buildRoads(NB, tile, null, null));
    AUD.on = false;
    AUD.src = '?';
    const out = {
      tx,
      tz,
      relief: LF.on,
      synth,
      batches: {},
      terrain: ter,
      roads: tile.roads
        .filter((r) => r.pts.length > 1)
        .map((r) => {
          const ow = owned(r),
            pr = ow ? { pts: r.pts, ys: null } : roadProfile(r, tile);
          return {
            owned: ow,
            edgeId: r.edgeId,
            pts: pr.pts,
            ys: pr.ys,
            width: r.width,
            kind: r.kind,
            sidewalks: !!r.sidewalks,
            lane: !pr.ys && !!laneOfRoad(r),
            surface: r.surface,
          };
        }),
    };
    for (const kk of names) {
      const b = B[kk];
      if (!b.p.length) continue;
      out.batches[kk] = { p: new Float32Array(b.p), n: new Float32Array(b.n), t: b.t };
    }
    if (elevated) {
      const er = await run(elevTileG({ tx, tz }, { colliders: false }));
      if (er && er.group) {
        const P = [],
          v = new THREE.Vector3();
        er.group.updateMatrixWorld(true);
        er.group.traverse((o) => {
          if (!o.isMesh || o.isInstancedMesh || !o.geometry?.attributes?.position) return;
          const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry,
            pa = g.attributes.position;
          for (let i = 0; i < pa.count; i++) {
            v.fromBufferAttribute(pa, i).applyMatrix4(o.matrixWorld);
            P.push(v.x, v.y, v.z);
          }
          if (g !== o.geometry) g.dispose();
        });
        er.group.traverse((o) => {
          if (o.isMesh) {
            o.geometry?.dispose?.();
          }
        });
        if (P.length)
          out.batches.elev = { p: new Float32Array(P), t: new Array(P.length / 9).fill('e') };
      }
    }
    return out;
  }
  if (typeof window !== 'undefined') window.__tbSurfaceTile = surfaceTile;
  return {
    debugProps,
    junctionOf,
    sigStats,
    capStats,
    sliverStats,
    groundClaims: CLAIMS,
    auditFacades,
    bushAt,
    colliderSourceAt,
    cullPools,
    cullStats,
    synthLots,
    synthShopsNear,
    mooringsNear,
    claimMooring,
    releaseMooring,
    deckSurfaceAt,
    resolveDecks,
    roadProfile,
    sidewalksOf,
    nodeLevel,
    colTags,
    colStats,
    placeStats,
    lawnAt,
    lawnTester,
    buildLandBase,
    buildNear: (...a) => batched(buildNear(...a)),
    buildMid: (...a) => batched(buildMid(...a)),
    buildFar: (...a) => batched(buildFar(...a)),
    tileBatch,
    buildColliders,
    removeColliders,
    dispose,
    extraMaterials: [
      ...(terrain ? terrain.materials : []),
      ...(flora ? flora.materials : []),
      acMat,
      sigMat,
      pierMat,
      vcMat,
      litterMat,
      containerMat,
      boatMat,
      blobMat,
      hutMat,
      umbMat,
      ...greenMats,
    ],
  };
}
