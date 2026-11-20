// Southline — pedestrians (CHARACTER agent), wave 4.
// Population streams around the player using the city API only (zoneAt, randomSidewalkPoint, roadGraph,
// benches, leanSpots, storefronts, groundHeightAt, isWater, surfaceAt). People follow sidewalks along the road
// graph and cross at intersections (crosswalks). Zone/time behaviours: beach sunbathers, volleyball, frisbee,
// swimmers/waders, shoreline walks; business pairs + phone calls; nightlife crowds dancing after 20h;
// residential dog walkers, joggers, gardeners; benches and leaning. Reactions: look-at, step aside, shove,
// panic (flee / cower / film), fight back, cops. Realistic ragdolls + get-up for non-lethal knockdowns.
import * as THREE from 'three';
import { createCharacter, humansLoaded, humansTotal } from '../player/characterModel.js';
import { sitOnFurniture, standUp } from './furnitureSeat.js';
import { makeTowel, makeBeachThings, restOnTowel, clearTowelContact } from './beachTowel.js';
import { createRagdollSystem } from './ragdoll.js';
import {
  cornerRoute,
  cornerSetback,
  laneBase,
  createSpace,
  walkGround,
  SOFT_PATH,
  obstacleSteer,
  carYield,
  updateCarList,
  crossWait,
} from './walk.js';
import { createBuildingMask } from './bldMask.js';
import { PERSONAS, pickPersona } from './personality.js';
import { AGE, GROUP_THEMES, groupMate, pickTheme } from './people/groups.js';
import { createSignals } from './streetlife.js';
import { preloadDog, createLibDog } from './dog.js';
import { preloadLib, libSwap } from '../world/libprops.js';

const DESPAWN = 300,
  SPAWN_MIN = 20,
  SPAWN_MAX = 165;
const _v = new THREE.Vector3(),
  _v2 = new THREE.Vector3(),
  _v3 = new THREE.Vector3(),
  _q = new THREE.Quaternion();
const _nt = { x: 0, z: 0 },
  _frustum = new THREE.Frustum(),
  _proj = new THREE.Matrix4(),
  _sph = new THREE.Sphere(new THREE.Vector3(), 1.3);
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (a) => a[(Math.random() * a.length) | 0];
const approachAngle = (a, b, k) => {
  let d = b - a;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  return a + d * Math.min(1, k);
};
const TOWEL_COLS = [0xe07f68, 0x2f8a86, 0xf0ede6, 0xe8d78a, 0x9cc1de, 0xb8a8d2, 0xe6b3b5, 0x3b6fb6];
const NONMOVING = new Set([
  'convo',
  'freeze',
  'call',
  'watch',
  'talk',
  'dance',
  'bench',
  'lean',
  'garden',
  'sunbathe',
  'volley',
  'frisbee',
  'wade',
  'cower',
  'film',
  'gettingUp',
  'argue',
]);
const LIMB_PART = {
  head: 'head',
  neck: 'head',
  torso_upper: 'chest',
  torso_lower: 'pelvis',
  upperarm_l: 'uArmL',
  forearm_l: 'lArmL',
  upperarm_r: 'uArmR',
  forearm_r: 'lArmR',
  thigh_l: 'thighL',
  shin_l: 'shinL',
  thigh_r: 'thighR',
  shin_r: 'shinR',
};

const _gcache = new Map();
const SG = (key, Ctor, ...a) => {
  const k = key + ':' + a.join(',');
  let g = _gcache.get(k);
  if (!g) {
    g = new Ctor(...a);
    _gcache.set(k, g);
  }
  return g;
};
export async function createPeds(game) {
  const { scene, world, RAPIER } = game;
  const city = game.city || {};
  const list = [];
  const playerPos = () => game.player?.position || _v.set(0, 0, 0);
  const hourNow = () => (((game.timeOfDay ?? 14) % 24) + 24) % 24;
  const zoneAt = (x, z) => {
    try {
      return city.zoneAt?.(x, z) || 'residential';
    } catch (e) {
      return 'residential';
    }
  };
  // height of the surface at the person's own level (hint just above the feet), never the highest deck overhead
  const groundAt = (x, z, fallback = 0) => {
    try {
      const g = city.groundHeightAt?.(x, z, fallback + 1.2);
      return Number.isFinite(g) ? surfaceNear(x, z, g) : fallback;
    } catch (e) {
      return fallback;
    }
  };
  // physics-audit (Nov 19, user: "an NPC halfway through the ground"): groundHeightAt is the map's height function
  // (bilinear 16 m grid, flat road / curb offsets), while the drawn ground is the collider surface (4 m terrain
  // triangles, raised lots and yards, sloped shores). Where the static collider is built, a short downward ray takes
  // its top when it lies within 0.4 m of the map height (so a bin, bench or car roof never lifts anyone).
  let _sRay = null;
  function surfaceNear(x, z, g) {
    const R = game.RAPIER;
    if (!R || !world) return g;
    if (!_sRay) _sRay = new R.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
    _sRay.origin.x = x;
    _sRay.origin.y = g + 0.45;
    _sRay.origin.z = z;
    const QF = R.QueryFilterFlags;
    const hit = world.castRay(
      _sRay,
      0.9,
      true,
      QF.EXCLUDE_DYNAMIC | QF.EXCLUDE_KINEMATIC | QF.EXCLUDE_SENSORS,
    );
    // no surface there, or the ray starts inside a solid (a planter, a step block): keep the map height
    if (!hit || hit.timeOfImpact < 0.01) return g;
    return g + 0.45 - hit.timeOfImpact;
  }
  const isWater = (x, z) => {
    try {
      return !!city.isWater?.(x, z);
    } catch (e) {
      return false;
    }
  };
  const surfaceAt = (x, z) => {
    try {
      return city.surfaceAt?.(x, z) || 'concrete';
    } catch (e) {
      return 'concrete';
    }
  };
  const seaLevel = city.seaLevel ?? -0.12;
  const collidersReady = (x, z) => {
    try {
      return city.collidersReadyAt ? !!city.collidersReadyAt(x, z) : true;
    } catch (e) {
      return true;
    }
  };

  let rag = null;
  try {
    rag = createRagdollSystem(game, 6);
  } catch (e) {
    rag = null;
  }
  let kcc = null;
  try {
    kcc = world.createCharacterController(0.02);
    kcc.enableAutostep(0.32, 0.15, true);
    kcc.enableSnapToGround(0.4);
    kcc.setSlideEnabled(true);
    kcc.setApplyImpulsesToDynamicBodies(false);
    kcc.setMaxSlopeClimbAngle((50 * Math.PI) / 180);
  } catch (e) {
    kcc = null;
    console.warn('[peds] no character controller', e);
  }

  const signals = createSignals(game);
  // ---------------------------------------------------------------- road graph sidewalk navigation
  const RG =
    city.roadGraph && city.roadGraph.edges && city.roadGraph.nearestEdge ? city.roadGraph : null;
  const cumCache = new WeakMap();
  function cum(edge) {
    let c = cumCache.get(edge);
    if (!c) {
      c = [0];
      const p = edge.pts;
      for (let i = 1; i < p.length; i++)
        c.push(c[i - 1] + Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]));
      cumCache.set(edge, c);
    }
    return c;
  }
  const edgeLen = (e) => {
    const c = cum(e);
    return c[c.length - 1];
  };
  function edgeAt(e, d, out) {
    const c = cum(e),
      p = e.pts;
    const L = c[c.length - 1];
    d = Math.max(0, Math.min(L, d));
    let i = 1;
    while (i < c.length - 1 && c[i] < d) i++;
    const seg = c[i] - c[i - 1] || 1,
      t = (d - c[i - 1]) / seg;
    const x0 = p[i - 1][0],
      z0 = p[i - 1][1],
      x1 = p[i][0],
      z1 = p[i][1];
    const tx = (x1 - x0) / seg,
      tz = (z1 - z0) / seg;
    out.x = x0 + (x1 - x0) * t;
    out.z = z0 + (z1 - z0) * t;
    out.tx = tx;
    out.tz = tz;
    return out;
  }
  // smart-peds (Nov 19): building footprints from the map data (1 m mask), for both tiers at any distance.
  // '?pedsmart=0' = the previous walking (audit before / after).
  // off by default until it has been verified in game (Nov 19); ?pedsmart=1 turns it on
  const SMART = typeof location !== 'undefined' && /[?&]pedsmart=1/.test(location.search);
  const bld = createBuildingMask(game);
  const inBuilding = (x, z) => SMART && bld.inside(x, z);
  // Which sides of an edge have a walkable lane: footpaths and lot lines of the graph run through the library
  // building models, and some streets have a building right at the road edge. Sampled once per edge along the lane
  // (+1 / -1 = the side as in navTarget). Sides where more than a quarter of the lane is inside buildings are closed.
  const sideCache = new WeakMap();
  const _sp = { x: 0, z: 0, tx: 0, tz: 1 };
  function sideOpen(e, side) {
    if (!SMART) return true;
    let c = sideCache.get(e);
    if (!c) {
      if (!game.miamiData?.getTile) return true;
      const L = edgeLen(e);
      const soft = SOFT_PATH.test(e.kind || '');
      const n = Math.max(2, Math.min(40, Math.ceil(L / 4)));
      c = { 1: 0, '-1': 0 };
      for (const sd of [1, -1]) {
        const off = soft ? 0 : laneBase(e, 0.35);
        let bad = 0;
        for (let i = 0; i <= n; i++) {
          edgeAt(e, (L * i) / n, _sp);
          if (bld.inside(_sp.x - _sp.tz * sd * off, _sp.z + _sp.tx * sd * off)) bad++;
        }
        c[sd] = bad / (n + 1) <= 0.25 ? 1 : -1;
      }
      sideCache.set(e, c);
    }
    return c[side] > 0;
  }
  const walkable = (e) =>
    e &&
    e.pts &&
    e.pts.length > 1 &&
    !/motorway|trunk|_link|rail|ferry/.test(e.kind || '') &&
    (e.speedKmh || 40) < 75 &&
    !(e.bridge && (e.speedKmh || 40) > 55) &&
    (sideOpen(e, 1) || sideOpen(e, -1));
  const sideOffset = (e) => (e.width || 8) / 2 + 2.0;
  // r3-people (user, Nov 17 PM: "~20 NPCs in a line along the road edge", "NPCs walk diagonally through walls"): every
  // walker used one line at width/2 + 2 m (+-0.7 m), so a busy edge read as a single file, and that line ignored the
  // sidewalk width and the buildings. Now each walker keeps its own lane across the real sidewalk width, and the lane
  // is clamped in front of the first wall (two sideways rays from the road against the static world, max of both so a
  // lamp post does not pull people to the curb), refreshed every few meters. Straight-line moves (corners, crossing
  // to the other side) that would pass through a wall go via the curb instead. '?pednav=old' = the previous behavior.
  const NAV_OLD = typeof location !== 'undefined' && /[?&]pednav=old/.test(location.search);
  const _rO = { x: 0, y: 0, z: 0 },
    _rD = { x: 0, y: 0, z: 0 };
  let _ray = null;
  function wallDist(x, y, z, dx, dz, max) {
    try {
      const R = game.RAPIER,
        W = game.world;
      if (!R || !W) return max;
      _rO.x = x;
      _rO.y = y;
      _rO.z = z;
      _rD.x = dx;
      _rD.y = 0;
      _rD.z = dz;
      if (!_ray) _ray = new R.Ray(_rO, _rD);
      else {
        _ray.origin = _rO;
        _ray.dir = _rD;
      }
      const hit = W.castRay(
        _ray,
        max,
        true,
        R.QueryFilterFlags.EXCLUDE_DYNAMIC |
          (R.QueryFilterFlags.EXCLUDE_KINEMATIC || 0) |
          R.QueryFilterFlags.EXCLUDE_SENSORS,
      );
      return hit && Number.isFinite(hit.timeOfImpact) ? hit.timeOfImpact : max;
    } catch (e) {
      return max;
    }
  }
  // lateral offset of this walker's lane on its edge and side (m from the centerline)
  const _wp2 = { x: 0, z: 0, tx: 0, tz: 1 };
  function laneOff(n, side) {
    const e = n.edge,
      hw = (e.width || 8) / 2,
      soft = SOFT_PATH.test(e.kind || '');
    if (n.lane === undefined) n.lane = Math.random();
    // r6-walk: the lane sits on the sidewalk, on the road edge where there is none (0.5-1.5 m off the carriageway), and
    // ON footpaths / pedestrian streets (src/npc/walk.js laneBase)
    let off = laneBase(e, n.lane);
    // wall clamp (cached per edge / side / ~6 m of travel)
    if (n.wE !== e || n.wSide !== side || Math.abs(n.s - n.wS) > 6) {
      n.wE = e;
      n.wSide = side;
      n.wS = n.s;
      n.wMax = 1e9;
      if (!soft && collidersReady(_ep.x, _ep.z)) {
        const nx = -_ep.tz * side,
          nz = _ep.tx * side;
        let best = 0;
        const y = groundAt(_ep.x, _ep.z, 0) + 1.3;
        for (const k of [-1.6, 1.6]) {
          const L = edgeLen(e);
          edgeAt(e, Math.max(0, Math.min(L, n.s + k)), _wp2);
          // start just outside the carriageway (parked cars / the road itself are not walls)
          best = Math.max(
            best,
            hw * 0.6 +
              wallDist(
                _wp2.x + nx * hw * 0.6,
                y,
                _wp2.z + nz * hw * 0.6,
                nx,
                nz,
                hw * 0.4 + off + 1.5,
              ),
          );
        }
        if (best < hw + off + 1.5 - 0.01) n.wMax = best - 0.55;
      }
      // building footprints from the map raster too (works beyond the collider radius, for the far crowd)
      try {
        const nx = -_ep.tz * side,
          nz = _ep.tx * side;
        for (let k = hw + 0.25; k < off + 1.6 && k < n.wMax + 0.55; k += 0.5)
          if (
            inBuilding(_ep.x + nx * k, _ep.z + nz * k) ||
            surfaceAt(_ep.x + nx * k, _ep.z + nz * k) === 'building'
          ) {
            n.wMax = Math.min(n.wMax, k - 0.6);
            break;
          }
      } catch (e) {
        /* */
      }
    }
    if (n.jit0 === undefined) n.jit0 = n.jit || 0;
    off += (n.jit || 0) - n.jit0 + (n.sway || 0); // sidesteps (avoidance) and the walker's own slight sway shift the lane
    if (soft) {
      if (off > hw + 0.5) off = hw + 0.5;
      else if (off < -hw * 0.5) off = -hw * 0.5;
    } else {
      if (off > n.wMax) off = n.wMax;
      if (off < hw + 0.3) off = hw + 0.3;
    } // never on the carriageway
    n.offNow = off;
    return off;
  }
  // room (m) between a walker's lane and the wall / the outer edge of its sidewalk (for a companion walking beside it)
  function laneRoom(n) {
    if (!n || !n.edge) return 0;
    return (
      Math.min(n.wMax ?? 1e9, laneBase(n.edge, 1) + 0.35) -
      (n.offNow ?? laneBase(n.edge, n.lane ?? 0.5))
    );
  }
  // is the straight line from the walker to (x, z) free of walls?
  function lineFree(ped, x, z) {
    const dx = x - ped.pos.x,
      dz = z - ped.pos.z,
      d = Math.hypot(dx, dz);
    if (d < 0.5 || !collidersReady(ped.pos.x, ped.pos.z)) return true;
    return (
      wallDist(
        ped.pos.x,
        (ped.pos.y || groundAt(ped.pos.x, ped.pos.z, 0)) + 1.3,
        ped.pos.z,
        dx / d,
        dz / d,
        d,
      ) >=
      d - 0.01
    );
  }
  const nodeEdges = (id) => {
    try {
      return RG.edgesAt(id) || [];
    } catch (e) {
      return [];
    }
  };
  const _ep = { x: 0, z: 0, tx: 0, tz: 1 };
  // place a ped's nav on the nearest walkable edge
  function navFromPos(ped) {
    if (!RG) return null;
    let r = null;
    try {
      r = RG.nearestEdge(ped.pos.x, ped.pos.z);
    } catch (e) {
      r = null;
    }
    if (!r || !walkable(r.edge) || r.dist > 25) return null;
    const e = r.edge,
      L = edgeLen(e);
    const s = Math.max(0, Math.min(L, (r.t ?? 0.5) <= 1 ? (r.t ?? 0.5) * L : r.t));
    edgeAt(e, s, _ep);
    const nx = -_ep.tz,
      nz = _ep.tx;
    const side = (ped.pos.x - _ep.x) * nx + (ped.pos.z - _ep.z) * nz >= 0 ? 1 : -1;
    // the walker's side of this street has buildings on the lane: not a place to walk
    if (!sideOpen(e, side)) return null;
    const dir = Math.random() < 0.5 ? 1 : -1;
    return {
      edge: e,
      s,
      dir,
      hand: side * dir,
      jit: 0,
      cross: null,
      ph: Math.random() * 6.28,
      t: 0,
    };
  }
  function navTarget(ped, out) {
    const n = ped.nav;
    const e = n.edge;
    edgeAt(e, n.s, _ep);
    const side = n.hand * n.dir;
    const off = NAV_OLD ? sideOffset(e) + n.jit : laneOff(n, side);
    out.x = _ep.x - _ep.tz * side * off;
    out.z = _ep.z + _ep.tx * side * off;
    return Math.atan2(_ep.tx * n.dir, _ep.tz * n.dir);
  }
  // r6-walk: at the end of a street the walker rounds the corner on the sidewalk and crosses one street at a time,
  // corner to corner (src/npc/walk.js cornerRoute). Sets n.path (waypoints) and moves the nav onto the next edge.
  const _jo = { x: 0, z: 0, tx: 0, tz: 1 };
  function junction(ped) {
    const n = ped.nav,
      A = n.edge,
      L = edgeLen(A),
      atEnd = n.dir > 0,
      node = atEnd ? A.b : A.a;
    const all = nodeEdges(node);
    const turnBack = () => {
      n.dir *= -1;
      n.s = Math.max(0, Math.min(L, n.s));
      n.sbE = null;
    };
    const cands = all.filter((e) => e !== A && walkable(e));
    let streets = 0;
    for (const e of all) if (!MINOR_ST.test(e.kind || '')) streets++;
    const minorNode = streets < 3;
    if (!cands.length || !all.includes(A)) {
      turnBack();
      return;
    }
    edgeAt(A, atEnd ? L : 0, _jo);
    const hx = _jo.tx * n.dir,
      hz = _jo.tz * n.dir,
      nxp = _jo.x,
      nzp = _jo.z;
    // which side of A (seen from the node, looking out along A) the walker is on: + = counter-clockwise
    const ux = -hx,
      uz = -hz;
    const sigA = (ped.pos.x - nxp) * -uz + (ped.pos.z - nzp) * ux >= 0 ? 1 : -1;
    const offA = Math.max(0.2, Math.abs((ped.pos.x - nxp) * -uz + (ped.pos.z - nzp) * ux));
    // prefer going roughly straight, and toward the walker's destination when it has one
    let dxn = 0,
      dzn = 0;
    if (n.dest) {
      const dl = Math.hypot(n.dest.x - nxp, n.dest.z - nzp) || 1;
      dxn = (n.dest.x - nxp) / dl;
      dzn = (n.dest.z - nzp) / dl;
    }
    const scored = cands.map((e) => {
      const fwd = e.a === node;
      const q = edgeAt(e, fwd ? 0.5 : edgeLen(e) - 0.5, { x: 0, z: 0, tx: 0, tz: 0 });
      const dd = fwd ? 1 : -1;
      return {
        e,
        fwd,
        w:
          0.35 +
          Math.max(0, q.tx * dd * hx + q.tz * dd * hz) +
          (n.dest ? 1.3 * Math.max(0, q.tx * dd * dxn + q.tz * dd * dzn) : 0),
      };
    });
    for (let tries = 0; tries < 3 && scored.length; tries++) {
      let tot = scored.reduce((a, b) => a + b.w, 0),
        r = Math.random() * tot,
        k = 0;
      for (let i = 0; i < scored.length; i++) {
        r -= scored[i].w;
        if (r <= 0) {
          k = i;
          break;
        }
      }
      const ch = scored.splice(k, 1)[0];
      let rt = null;
      try {
        rt = cornerRoute(
          node,
          A,
          sigA,
          offA,
          ch.e,
          all,
          n.lane ?? 0.5,
          !(SMART && minorNode) && Math.random() < 0.15,
        );
        // smart-peds: never onto a side of B that is built over, never round a corner through a building or the
        // road, cross streets only at real junctions
        if (rt && !routeOk(rt, ch.e, ch.fwd, minorNode)) {
          rt = cornerRoute(node, A, sigA, offA, ch.e, all, n.lane ?? 0.5, true);
          if (rt && !routeOk(rt, ch.e, ch.fwd, minorNode)) rt = null;
        }
      } catch (e) {
        rt = null;
      }
      if (!rt) continue;
      const B = ch.e,
        LB = edgeLen(B),
        sB = Math.min(rt.sB, LB * 0.45);
      n.edge = B;
      n.dir = ch.fwd ? 1 : -1;
      n.hand = rt.sigmaB * (ch.fwd ? 1 : -1) * n.dir;
      n.s = ch.fwd ? sB : LB - sB;
      n.path = rt.pts;
      n.pi = 0;
      n.pathT = 0;
      n.pathNode = node;
      n.cross = null;
      n.wE = null;
      n.sbE = null;
      n.mh = undefined;
      // patient people wait at the corner before crossing; impatient ones go straight (people.v2.js traits)
      if (
        !SMART &&
        rt.crossings &&
        ped.P &&
        ped.P.patience !== undefined &&
        ped.state === 'walk' &&
        ped.P.patience > 0.4 &&
        Math.random() < 0.5
      )
        ped.waitT = rand(0.6, 1.2 + ped.P.patience * 3);
      return;
    }
    turnBack();
  }
  const MINOR_ST = /service|driveway|track|path|footway|pedestrian|steps|cycleway|alley/;
  const onRoadAt = (x, z) => {
    try {
      return !!game.placement?.onRoad?.(x, z, 0);
    } catch (e) {
      return false;
    }
  };
  // a corner route is usable when the side it joins on B is open and no sidewalk leg of it cuts through a building
  // (crossing legs run over the road; the leg from the walker's own lane to the first corner starts at the node)
  function routeOk(rt, B, fwd, minorNode) {
    if (!SMART) return true;
    if (!sideOpen(B, rt.sigmaB * (fwd ? 1 : -1))) return false;
    // where only a driveway or service lane meets a street there is no corner to cross the street at
    if (minorNode && rt.crossed?.some((e) => !MINOR_ST.test(e.kind || ''))) return false;
    let px = rt.pts[0].x;
    let pz = rt.pts[0].z;
    if (inBuilding(px, pz)) return false;
    for (let i = 1; i < rt.pts.length; i++) {
      const q = rt.pts[i];
      if (!q.cross && !bld.segmentFree(px, pz, q.x, q.z)) return false;
      if (inBuilding(q.x, q.z)) return false;
      // corners and sidewalk legs stay off the carriageway (acute junctions put some corners in the other road)
      if (!q.cross && (onRoadAt(q.x, q.z) || onRoadAt((px + q.x) / 2, (pz + q.z) / 2)))
        return false;
      px = q.x;
      pz = q.z;
    }
    return true;
  }
  // advance along the sidewalk; returns desired heading; moves ped.pos in xz
  function navStep(ped, dt, speed) {
    const n = ped.nav;
    // r6-walk natural motion: a slow drift of the walker's lane across the sidewalk (never a zigzag) and a few cm of sway
    n.t = (n.t || 0) + dt;
    if (n.ph === undefined) n.ph = Math.random() * 6.28;
    if (n.lane === undefined) n.lane = Math.random();
    if ((n.laneT = (n.laneT || 0) - dt) <= 0) {
      n.laneT = rand(7, 18);
      n.laneG = Math.max(0, Math.min(n.laneMax ?? 1, n.lane + rand(-0.35, 0.35)));
    }
    n.lane += Math.max(-dt * 0.05, Math.min(dt * 0.05, (n.laneG ?? n.lane) - n.lane));
    n.sway = Math.sin(n.t * 0.9 + n.ph) * 0.035 + Math.sin(n.t * 0.37 + n.ph * 2) * 0.03;
    // sidestep asked for by the avoidance (n.steer: + = toward (cos h, -sin h)); the lane's outward side is -hand there
    if (n.jit0 === undefined) n.jit0 = n.jit || 0;
    if (n.steer)
      n.jit = Math.max(
        n.jit0 - 0.7,
        Math.min(n.jit0 + 1.3, (n.jit || 0) + n.steer * -n.hand * 1.1 * dt),
      );
    else n.jit = (n.jit || 0) + Math.max(-0.12 * dt, Math.min(0.12 * dt, n.jit0 - (n.jit || 0)));
    for (let guard = 0; guard < 6 && n.path; guard++) {
      // waypoints: rounding a corner, crossing at a junction, rejoining the lane
      const wp = n.path[n.pi];
      const dx = wp.x - ped.pos.x,
        dz = wp.z - ped.pos.z,
        d = Math.hypot(dx, dz);
      const nxt = n.path[n.pi + 1];
      if (d < (!nxt || wp.cross || nxt.cross ? 0.3 : 0.8)) {
        // plain corners are cut round, crossings start and end on the corner
        n.pi++;
        if (!nxt) {
          n.path = null;
          n.cross = null;
          break;
        }
        n.cross = nxt.cross ? { x: nxt.x, z: nxt.z, node: n.pathNode, sig: 0 } : null;
        n.crossT = 0;
        continue;
      }
      n.pathT = (n.pathT || 0) + dt;
      if (n.pathT > 40) {
        n.path = null;
        n.cross = null;
        break;
      }
      // eased turn toward the waypoint, straight in for the last stretch
      const hd = Math.atan2(dx, dz);
      n.mh =
        n.mh === undefined
          ? hd
          : n.mh + Math.atan2(Math.sin(hd - n.mh), Math.cos(hd - n.mh)) * Math.min(1, dt * 7);
      const step = speed * dt;
      if (d < 1.3 || step >= d) {
        const k = Math.min(1, step / d);
        ped.pos.x += dx * k;
        ped.pos.z += dz * k;
      } else {
        ped.pos.x += Math.sin(n.mh) * step;
        ped.pos.z += Math.cos(n.mh) * step;
      }
      return hd;
    }
    const L = edgeLen(n.edge);
    n.s += n.dir * speed * dt;
    if (n.sbE !== n.edge || n.sbD !== n.dir) {
      n.sbE = n.edge;
      n.sbD = n.dir;
      try {
        n.sb = Math.min(
          cornerSetback(
            n.dir > 0 ? n.edge.b : n.edge.a,
            n.edge,
            nodeEdges(n.dir > 0 ? n.edge.b : n.edge.a),
          ),
          L * 0.45,
        );
      } catch (e) {
        n.sb = 0.5;
      }
    }
    if ((n.dir > 0 ? L - n.s : n.s) <= n.sb) {
      junction(ped);
      if (n.path) {
        const wp = n.path[0];
        return Math.atan2(wp.x - ped.pos.x, wp.z - ped.pos.z);
      }
    }
    const t = _nt;
    const h = navTarget(ped, t);
    const dx = t.x - ped.pos.x,
      dz = t.z - ped.pos.z,
      d = Math.hypot(dx, dz);
    if (d > 6) {
      n.path = [{ x: t.x, z: t.z, cross: false }];
      n.pi = 0;
      n.pathT = 0;
      n.cross = null;
      n.mh = undefined;
      // a wall in the way: step out to the curb first (the curb point of this edge at the walker's station)
      if (
        !NAV_OLD &&
        (!lineFree(ped, t.x, t.z) || (SMART && !bld.segmentFree(ped.pos.x, ped.pos.z, t.x, t.z)))
      ) {
        edgeAt(n.edge, n.s, _ep);
        const hw = (n.edge.width || 8) / 2 + 0.4,
          sd = (ped.pos.x - _ep.x) * -_ep.tz + (ped.pos.z - _ep.z) * _ep.tx >= 0 ? 1 : -1;
        n.path.unshift({ x: _ep.x - _ep.tz * sd * hw, z: _ep.z + _ep.tx * sd * hw, cross: false });
      }
      return Math.atan2(dx, dz);
    }
    // follow the sidewalk line with gentle lateral correction (at most a brisk sidestep, never a slide)
    const k = d > 1e-4 ? Math.min(d * Math.min(1, dt * 2), 1.1 * dt) / d : 0;
    ped.pos.x += Math.sin(h) * speed * dt + dx * k;
    ped.pos.z += Math.cos(h) * speed * dt + dz * k;
    return h;
  }
  // r6-walk: a person without a street to follow (placed by a mission, pushed off its line) walks to the nearest
  // sidewalk and joins it; never a random straight line across roads or fields. Shore walkers stay on the sand.
  const lineOnRoad = (x0, z0, x1, z1) => {
    const d = Math.hypot(x1 - x0, z1 - z0),
      nS = Math.max(1, Math.ceil(d / 1.5));
    for (let i = 1; i <= nS; i++) {
      const k = i / nS;
      try {
        if (game.placement?.onRoad?.(x0 + (x1 - x0) * k, z0 + (z1 - z0) * k, 0)) return true;
      } catch (e) {
        return false;
      }
    }
    return false;
  };
  function freeStep(ped, dt, speed) {
    const shore = ped.act === 'shore';
    if (!shore && ped.state === 'walk') {
      ped.navTry = (ped.navTry || 0) - dt;
      if (ped.navTry <= 0) {
        ped.navTry = 1.5;
        const nv = navFromPos(ped);
        if (nv) {
          ped.nav = nv;
          ped.target = null;
          return navTarget(ped, _nt);
        }
      }
    }
    if (!ped.target || Math.hypot(ped.target.x - ped.pos.x, ped.target.z - ped.pos.z) < 1.2) {
      let tg = shore ? shorePoint(ped.pos, 40) : sidewalkNear(ped.pos, 35);
      const strict = !shore && ped.state === 'walk';
      if (
        tg &&
        strict &&
        (Math.hypot(tg.x - ped.pos.x, tg.z - ped.pos.z) > 60 ||
          lineOnRoad(ped.pos.x, ped.pos.z, tg.x, tg.z))
      )
        tg = null;
      if (!tg && !strict)
        tg = new THREE.Vector3(ped.pos.x + rand(-15, 15), ped.pos.y, ped.pos.z + rand(-15, 15)); // fleeing / chasing: anywhere
      ped.target = tg;
      if (!tg) {
        ped.pause = Math.max(ped.pause || 0, 3);
        ped.lostT = (ped.lostT || 0) + 3;
        if (ped.lostT > 12 && !(ped.pinned > 0) && !inCamView(ped.pos.x, ped.pos.y, ped.pos.z))
          ped.despawnNow = true;
        return ped.heading;
      }
    }
    const dx = ped.target.x - ped.pos.x,
      dz = ped.target.z - ped.pos.z,
      d = Math.hypot(dx, dz) || 1;
    ped.pos.x += (dx / d) * speed * dt;
    ped.pos.z += (dz / d) * speed * dt;
    return Math.atan2(dx, dz);
  }

  // ---------------------------------------------------------------- spots
  function sidewalkNear(c, r, zone = null) {
    // smart-peds: a few tries, never a point on a building footprint
    for (let k = 0; k < (SMART ? 3 : 1); k++) {
      try {
        const p = city.randomSidewalkPoint?.(c, r, zone);
        if (!p || !Number.isFinite(p.x) || inBuilding(p.x, p.z)) continue;
        return p.clone ? p.clone() : new THREE.Vector3(p.x, p.y || 0, p.z);
      } catch (e) {
        /* ignore */
      }
    }
    return null;
  }
  // sand near the water (for sunbathers / shoreline walkers)
  function sandPoint(c, r, nearWater = false) {
    for (let i = 0; i < 40; i++) {
      const a = Math.random() * Math.PI * 2,
        d = Math.sqrt(Math.random()) * r;
      const x = c.x + Math.cos(a) * d,
        z = c.z + Math.sin(a) * d;
      if (isWater(x, z) || zoneAt(x, z) !== 'beach') continue;
      const s = surfaceAt(x, z);
      if (s !== 'sand') continue;
      if (nearWater) {
        let w = false;
        for (const [ox, oz] of [
          [6, 0],
          [-6, 0],
          [0, 6],
          [0, -6],
          [12, 0],
          [-12, 0],
          [0, 12],
          [0, -12],
        ])
          if (isWater(x + ox, z + oz)) {
            w = true;
            break;
          }
        if (!w) continue;
      }
      return new THREE.Vector3(x, groundAt(x, z, 0), z);
    }
    return null;
  }
  function shorePoint(c, r) {
    return sandPoint(c, r, true) || sandPoint(c, r);
  }
  function waterPoint(c, r, shallow) {
    for (let i = 0; i < 40; i++) {
      const a = Math.random() * Math.PI * 2,
        d = Math.sqrt(Math.random()) * r;
      const x = c.x + Math.cos(a) * d,
        z = c.z + Math.sin(a) * d;
      if (!isWater(x, z)) continue;
      const bed = groundAt(x, z, -2);
      const depth = seaLevel - bed;
      if (shallow ? depth > 0.15 && depth < 0.9 : depth > 1.2 && depth < 6) {
        // must be close to a beach
        let ok = false;
        for (const [ox, oz] of [
          [15, 0],
          [-15, 0],
          [0, 15],
          [0, -15],
          [30, 0],
          [-30, 0],
          [0, 30],
          [0, -30],
        ])
          if (!isWater(x + ox, z + oz) && zoneAt(x + ox, z + oz) === 'beach') {
            ok = true;
            break;
          }
        if (ok) return new THREE.Vector3(x, bed, z);
      }
    }
    return null;
  }
  // spot lists near the player (benches / lean spots / storefronts), refreshed every few seconds
  let spotsT = 99;
  const spots = { benches: [], lean: [], fronts: [], stops: [] };
  const used = new Set();
  function refreshSpots(pp) {
    const near = (arr, r, getP) => {
      const out = [];
      if (!Array.isArray(arr)) return out;
      for (const s of arr) {
        const p = getP(s);
        if (p && Math.abs(p.x - pp.x) < r && Math.abs(p.z - pp.z) < r) out.push(s);
      }
      return out;
    };
    spots.benches = near(city.benches, 150, (s) => s.pos);
    spots.lean = near(city.leanSpots, 150, (s) => s.pos);
    spots.fronts = near(city.storefronts || city.shopLots, 160, (s) => s);
    spots.stops = near(game.miamiData?.transit?.stops, 180, (s) => s);
  }
  const freeSpot = (arr, pp) => {
    const c = arr.filter((s) => !used.has(s));
    if (!c.length) return null;
    for (let i = 0; i < 6; i++) {
      const s = pick(c);
      const p = s.pos || s;
      const d = Math.hypot(p.x - pp.x, p.z - pp.z);
      if (d > SPAWN_MIN && d < SPAWN_MAX) return s;
    }
    return null;
  };

  // ---------------------------------------------------------------- props (towels, umbrellas, balls, discs, dogs)
  const propGeo = {
    towel: (() => {
      const g = new THREE.PlaneGeometry(0.95, 1.9);
      g.rotateX(-Math.PI / 2);
      return g;
    })(),
    pole: new THREE.CylinderGeometry(0.022, 0.022, 2.2, 6),
    canopy: new THREE.ConeGeometry(1.15, 0.45, 12, 1, true),
    ball: new THREE.SphereGeometry(0.11, 12, 8),
    disc: new THREE.CylinderGeometry(0.13, 0.12, 0.025, 16),
  };
  const propMat = new Map();
  let netMat = null;
  const leashMat = new THREE.LineBasicMaterial({ color: 0x222222 });
  const pmat = (c, r = 0.8, side = THREE.FrontSide) => {
    const k = c + ':' + r + ':' + side;
    if (!propMat.has(k))
      propMat.set(k, new THREE.MeshStandardMaterial({ color: c, roughness: r, side }));
    return propMat.get(k);
  };
  const props = new Set();
  function addProp(mesh) {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    props.add(mesh);
    return mesh;
  }
  function removeProp(m) {
    if (!m) return;
    scene.remove(m);
    props.delete(m);
    if (m.userData?.disposeGeo)
      m.traverse((o) => {
        if (o.isMesh) o.geometry?.dispose?.();
      });
  }
  preloadLib(['umbrella_beach1', 'umbrella_beach2']);
  function makeUmbrella(x, y, z) {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    const pole = new THREE.Mesh(propGeo.pole, pmat(0xdddddd, 0.4));
    pole.position.y = 1.1;
    g.add(pole);
    const can = new THREE.Mesh(
      propGeo.canopy,
      pmat(pick([0xe07f68, 0x2f8a86, 0xe8d78a, 0xf0ede6, 0x3b6fb6]), 0.85, THREE.DoubleSide),
    );
    can.position.y = 2.15;
    g.add(can);
    g.rotation.z = rand(-0.12, 0.12);
    g.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
      }
    });
    libSwap(g, Math.random() < 0.5 ? 'umbrella_beach1' : 'umbrella_beach2', {
      ry: rand(0, 6.28),
      scale: rand(0.95, 1.05),
    }); // r4-library: the user's beach umbrellas (code one while loading)
    scene.add(g);
    props.add(g);
    return g;
  }
  // a simple procedural dog (low poly, animated legs) + leash line
  const dogMat = [0x3b2a1e, 0xd8c3a0, 0x1c1a18, 0x8a6a46, 0xe9e2d6].map(
    (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.9 }),
  );
  preloadDog(); // r4-library: the user's rigged Doberman (src/npc/dog.js); the code dog below while it loads / if missing
  function makeDog() {
    const lib = createLibDog(scene);
    if (lib) {
      const leash = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
        leashMat,
      );
      leash.frustumCulled = false;
      scene.add(leash);
      return {
        lib,
        g: lib.g,
        leash,
        phase: 0,
        pos: new THREE.Vector3(),
        prev: new THREE.Vector3(),
        heading: 0,
        y: null,
      };
    }
    const s = rand(0.75, 1.25);
    const m = pick(dogMat);
    const g = new THREE.Group();
    g.scale.setScalar(s);
    const body = new THREE.Mesh(SG('CapsuleGeometry', THREE.CapsuleGeometry, 0.11, 0.38, 3, 8), m);
    body.rotation.x = Math.PI / 2;
    body.position.y = 0.36;
    g.add(body);
    const head = new THREE.Mesh(SG('SphereGeometry', THREE.SphereGeometry, 0.1, 10, 8), m);
    head.position.set(0, 0.5, 0.3);
    g.add(head);
    const snout = new THREE.Mesh(
      SG('CapsuleGeometry', THREE.CapsuleGeometry, 0.045, 0.07, 3, 6),
      m,
    );
    snout.rotation.x = Math.PI / 2;
    snout.position.set(0, 0.47, 0.41);
    g.add(snout);
    for (const sx of [-1, 1]) {
      const ear = new THREE.Mesh(SG('ConeGeometry', THREE.ConeGeometry, 0.04, 0.09, 5), m);
      ear.position.set(sx * 0.06, 0.6, 0.28);
      g.add(ear);
    }
    const tail = new THREE.Mesh(
      SG('CylinderGeometry', THREE.CylinderGeometry, 0.015, 0.025, 0.22, 5),
      m,
    );
    tail.position.set(0, 0.45, -0.3);
    tail.rotation.x = -0.7;
    g.add(tail);
    const legs = [];
    for (const [lx, lz] of [
      [-0.07, 0.18],
      [0.07, 0.18],
      [-0.07, -0.18],
      [0.07, -0.18],
    ]) {
      const pivot = new THREE.Group();
      pivot.position.set(lx, 0.32, lz);
      const leg = new THREE.Mesh(
        SG('CylinderGeometry', THREE.CylinderGeometry, 0.025, 0.02, 0.32, 5),
        m,
      );
      leg.position.y = -0.16;
      pivot.add(leg);
      g.add(pivot);
      legs.push(pivot);
    }
    g.traverse((o) => {
      if (o.isMesh) o.castShadow = true;
    });
    const leash = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
      leashMat,
    );
    leash.frustumCulled = false;
    scene.add(g);
    scene.add(leash);
    return { g, legs, tail, leash, phase: 0, pos: new THREE.Vector3(), heading: 0 };
  }
  function updateDog(ped, dt) {
    const d = ped.dog;
    if (!d) return;
    const side = _v3.set(Math.cos(ped.heading), 0, -Math.sin(ped.heading)); // ped's right
    const want = _v.copy(ped.pos).addScaledVector(side, -0.9);
    want.x += Math.sin(ped.heading) * 0.6;
    want.z += Math.cos(ped.heading) * 0.6;
    const dx = want.x - d.pos.x,
      dz = want.z - d.pos.z,
      dist = Math.hypot(dx, dz);
    if (dist > 6) d.pos.copy(want);
    const sp = Math.min(4, dist * 3);
    if (dist > 0.05) {
      d.pos.x += (dx / dist) * sp * dt;
      d.pos.z += (dz / dist) * sp * dt;
      d.heading = approachAngle(d.heading, Math.atan2(dx, dz), dt * 6);
    }
    if (d.lib) {
      // ground snap (own height, so a dog on the street beside a curb walker stands on the street) + measured gait speed
      const gy = groundAt(d.pos.x, d.pos.z, ped.pos.y);
      d.y = d.y == null || Math.abs(gy - d.y) > 1.5 ? gy : d.y + (gy - d.y) * Math.min(1, dt * 12);
      d.pos.y = d.y;
      const gs = dt > 0 ? Math.hypot(d.pos.x - d.prev.x, d.pos.z - d.prev.z) / dt : 0;
      d.prev.copy(d.pos);
      d.lib.pose(dt, Math.min(gs, 4));
      d.g.position.copy(d.pos);
      d.g.rotation.y = d.heading;
      const hand = ped.char.getBone?.('RightHand');
      const a = hand ? hand.getWorldPosition(_v2) : _v2.copy(ped.pos).setY(ped.pos.y + 0.9);
      d.g.updateMatrixWorld(true);
      const b = d.lib.collar(_v3);
      const arr = d.leash.geometry.attributes.position.array;
      arr[0] = a.x;
      arr[1] = a.y;
      arr[2] = a.z;
      arr[3] = b.x;
      arr[4] = b.y;
      arr[5] = b.z;
      d.leash.geometry.attributes.position.needsUpdate = true;
      return;
    }
    d.pos.y = ped.pos.y;
    d.phase += dt * (2 + sp * 4);
    const sw = Math.min(1, sp) * 0.6;
    d.legs.forEach((l, i) => {
      l.rotation.x = Math.sin(d.phase + (i === 0 || i === 3 ? 0 : Math.PI)) * sw;
    });
    d.tail.rotation.z = Math.sin(d.phase * 2) * 0.4;
    d.g.position.copy(d.pos);
    d.g.rotation.y = d.heading;
    // leash from the ped's right hand to the collar
    const hand = ped.char.getBone?.('RightHand');
    const a = hand ? hand.getWorldPosition(_v2) : ped.pos.clone().setY(ped.pos.y + 0.9);
    const b = _v3.copy(d.pos);
    b.x += Math.sin(d.heading) * 0.28;
    b.y += 0.48 * d.g.scale.y;
    b.z += Math.cos(d.heading) * 0.28;
    const arr = d.leash.geometry.attributes.position.array;
    arr[0] = a.x;
    arr[1] = a.y;
    arr[2] = a.z;
    arr[3] = b.x;
    arr[4] = b.y;
    arr[5] = b.z;
    d.leash.geometry.attributes.position.needsUpdate = true;
  }
  function removeDog(ped) {
    if (!ped.dog) return;
    if (ped.dog.lib) ped.dog.lib.dispose();
    else scene.remove(ped.dog.g);
    scene.remove(ped.dog.leash);
    ped.dog.leash.geometry.dispose();
    ped.dog = null;
  }

  // ---------------------------------------------------------------- character pool (reuse by zone)
  const pool = [];
  let seedN = 1;
  let createdThisFrame = 0;
  const canSpawn = (n) => pool.length + (createdThisFrame ? 0 : 1) >= n;
  function getChar(zone, opts = {}) {
    const want = zone;
    // people already on screen: avoid duplicates (every person should look different)
    const activeIds = new Set(
      list.filter((p) => p.active && p.char?.human).map((p) => p.char.human.id),
    );
    for (let i = 0; i < pool.length; i++) {
      const c = pool[i];
      if (c.human && activeIds.has(c.human.id)) continue;
      // the user's people carry a role: only reuse one where that role belongs (and never next to its twin)
      if (c.personMeta && !(game.npc?.fitsPlace?.(c, want, opts.pos) ?? true)) continue;
      if (opts.cand && c.personMeta && !opts.cand(c.personMeta)) continue; // r7-groups: must fit the group
      if (
        c.personMeta &&
        opts.act &&
        /sunbathe|swim|wade|volley|frisbee/.test(opts.act) &&
        !c.personMeta.places.some((x) => x === 'beach' || x === 'swim')
      )
        continue;
      if (
        c.zoneTag &&
        zoneFits(c.zoneTag, want) &&
        (!opts.gender || c.human?.gender === (opts.gender[0] === 'f' ? 'f' : 'm'))
      ) {
        pool.splice(i, 1);
        c.root.visible = true;
        return c;
      }
    }
    if (createdThisFrame >= 1 && !opts.force) {
      // creation budget (<=1 per frame) spent: reuse any pooled person
      if (pool.length) {
        // never a pooled person whose role does not belong here, or whose twin is close by (wait a frame instead)
        let k = -1;
        for (let j = pool.length - 1; j >= 0; j--) {
          const c = pool[j];
          if (c.human && activeIds.has(c.human.id)) continue;
          if (opts.cand && c.personMeta && !opts.cand(c.personMeta)) continue;
          if (!c.personMeta || (game.npc?.fitsPlace?.(c, want, opts.pos) ?? true)) {
            k = j;
            break;
          }
        }
        if (k < 0) return null;
        const c = pool.splice(k, 1)[0];
        c.root.visible = true;
        return c;
      }
      return null;
    }
    createdThisFrame++;
    const sd = 1000 + seedN++ * 37;
    // archetype people (src/npc/arch, PEOPLE-LOOK) when loaded for this place; the legacy library body otherwise
    // the user's people only (src/npc/people): when none fits / is loaded yet, nobody spawns this frame (the cast loads
    // them); the old library body is used only when the people system is off ('?people=0' / '?npc=legacy')
    const c =
      game.npc?.createPed?.({
        seed: sd,
        zone: want,
        gender: opts.gender,
        pos: opts.pos,
        act: opts.act,
        force: opts.force,
        cand: opts.cand,
      }) ||
      (game.npc?.cast
        ? null
        : createCharacter(game, {
            variant: 'ped',
            seed: sd,
            zone: want,
            gender: opts.gender,
            exclude: activeIds,
          }));
    if (!c) {
      createdThisFrame--;
      return null;
    }
    scene.add(c.root);
    return c;
  }
  function zoneFits(tag, zone) {
    const m = {
      beach: ['beach', 'casual', 'sport'],
      business: ['business', 'casual'],
      downtown: ['business', 'casual'],
      nightlife: ['nightlife', 'casual'],
      night: ['nightlife', 'casual'],
      port: ['port'],
      industrial: ['port', 'casual'],
      park: ['sport', 'casual'],
      causeway: ['sport', 'casual'],
      cop: ['cop'],
    };
    return (m[zone] || ['casual', 'sport']).includes(tag);
  }
  // bounded pool; characters beyond it are truly removed and their GPU resources freed (bone textures, per-instance materials)
  function releaseChar(c) {
    if (!c) return;
    c.root.visible = false;
    if (pool.length < 12) pool.push(c);
    else {
      try {
        game.people?.undress?.(c);
      } catch (e) {
        /* ignore */
      }
      scene.remove(c.root);
      c.dispose?.();
    }
  }

  // ---------------------------------------------------------------- ped lifecycle
  // Is (x, z) a place a person can stand? Not inside a road's carriageway, not near a motorway / trunk / link / bridge
  // edge, and not where an elevated deck exists (deck height and street height differ there). Playtest: idle
  // "parked people" on highways, bridges and causeways.
  const _sfr = new THREE.Frustum(),
    _spm = new THREE.Matrix4(),
    _ssp = new THREE.Sphere(new THREE.Vector3(), 1.2);
  let _rainT = -1,
    _rainV = false;
  function isRaining() {
    const t = performance.now();
    if (t - _rainT > 1000) {
      _rainT = t;
      const w = game.weather;
      _rainV =
        !!w &&
        (typeof w.rain === 'number'
          ? w.rain > 0.12 || (w.wetness || 0) > 0.45
          : /rain|storm|shower/.test(String(w.kind || '')));
    }
    return _rainV;
  }
  const _wg = {};
  function inCamView(x, y, z) {
    const c = game.camera;
    if (!c) return false;
    try {
      c.updateMatrixWorld();
      _spm.multiplyMatrices(c.projectionMatrix, c.matrixWorldInverse);
      _sfr.setFromProjectionMatrix(_spm);
      _ssp.center.set(x, y + 1, z);
      return _sfr.intersectsSphere(_ssp);
    } catch (e) {
      return false;
    }
  }
  function spotOK(x, z) {
    try {
      // r6-walk: the one shared ground rule (never a carriageway, never an open field away from any path)
      if (walkGround(game, x, z, _wg) !== 'ok') return false;
      if (inBuilding(x, z)) return false;
      if (RG) {
        const r = RG.nearestEdge(x, z);
        const e = r?.edge;
        if (e && Number.isFinite(r.dist)) {
          const half = (e.width || 8) / 2;
          if (r.dist < half + 0.3) {
            return false;
          }
          if (
            (/motorway|_link/.test(e.kind || '') || e.bridge || (e.speedKmh || 40) >= 75) &&
            r.dist < half + 6
          ) {
            return false;
          }
        }
      }
      const low = city.groundHeightAt?.(x, z, -50);
      const high = city.groundHeightAt?.(x, z, 200);
      if (Number.isFinite(low) && Number.isFinite(high) && high - low > 1.5) {
        return false;
      }
    } catch (e) {
      // no data: allow
    }
    return true;
  }
  let idN = 0;
  function newPed() {
    const ped = {
      id: idN++,
      char: null,
      root: null,
      pos: new THREE.Vector3(),
      heading: 0,
      speed: 0,
      walkSpeed: 1.3,
      state: 'walk',
      act: 'walk',
      nav: null,
      target: null,
      knock: new THREE.Vector3(),
      shoveT: 0,
      health: 100,
      dead: false,
      deadT: 0,
      pending: null,
      threat: null,
      stateT: 0,
      fleeT: 0,
      body: null,
      collider: null,
      rag: null,
      tough: Math.random() < 0.2,
      idleStyle: null,
      isCop: false,
      zone: 'residential',
      active: false,
      group: null,
    };
    // voices (pain, grunts, screams in src/core/audio.js) read ped.gender / ped.female: take them from the body actually
    // worn, then the identity, so a woman never gets a male voice (playtest P5)
    Object.defineProperty(ped, 'gender', {
      configurable: true,
      enumerable: false,
      get() {
        const g = ped.char?.human?.gender || ped.identity?.gender || ped.char?.gender || null;
        return g ? (/^f/i.test(String(g)) ? 'f' : 'm') : undefined;
      },
    });
    Object.defineProperty(ped, 'female', {
      configurable: true,
      enumerable: false,
      get() {
        const g = ped.gender;
        return g === undefined ? undefined : g === 'f';
      },
    });
    try {
      ped.body = world.createRigidBody(
        RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, -200, 0),
      );
      ped.collider = world.createCollider(
        RAPIER.ColliderDesc.capsule(0.6, 0.28).setFriction(0.5),
        ped.body,
      );
      ped.collider.setEnabled(false);
    } catch (e) {
      console.warn('[peds] collider failed', e);
    }
    list.push(ped);
    return ped;
  }
  function despawn(ped) {
    if (ped.rag) {
      try {
        rag.remove(ped.rag);
      } catch (e) {
        /* ignore */
      }
      ped.rag = null;
    }
    removeDog(ped);
    if (ped.towel) {
      removeProp(ped.towel);
      ped.towel = null;
    }
    if (ped.ownProps) {
      ped.ownProps.forEach(removeProp);
      ped.ownProps = null;
    }
    if (ped.spot) {
      used.delete(ped.spot);
      ped.spot = null;
    }
    if (ped.group) {
      ped.group.members = ped.group.members.filter((m) => m !== ped);
      if (!ped.group.members.length) endGroup(ped.group);
      ped.group = null;
    }
    releaseChar(ped.char);
    ped.char = null;
    ped.root = null;
    ped.active = false;
    ped.dead = false;
    ped.state = 'off';
    ped.collider?.setEnabled(false);
    try {
      ped.body?.setTranslation({ x: 0, y: -200, z: 0 }, false);
    } catch (e) {
      /* ignore */
    }
  }
  const groups = new Set();
  function endGroup(g) {
    if (g.props) g.props.forEach(removeProp);
    groups.delete(g);
  }

  function activate(ped, pos, zone, act, opts = {}) {
    if (ped._furn) standUp(ped);
    ped._rest = undefined;
    ped._restN = 0;
    ped.pos.copy(pos);
    ped.zone = zone;
    ped.act = act;
    ped.char = getChar(opts.outfit || zone, { ...opts, pos, act });
    if (!ped.char) {
      ped.active = false;
      return null;
    }
    ped.root = ped.char.root;
    ped.char.restyle?.(opts.outfit || zone);
    ped.active = true;
    ped.dead = false;
    ped.health = 100;
    ped.state = act === 'walk' || act === 'jog' || act === 'dog' || act === 'shore' ? 'walk' : act;
    ped.idleStyle = null;
    ped.pending = null;
    ped.threat = null;
    ped.knock.set(0, 0, 0);
    ped.shoveT = 0;
    ped.deadT = 0;
    ped.isCop = false;
    ped.foughtBack = false;
    ped.guard = false;
    ped.personality = opts.personality || (zone === 'cop' ? 'tough' : pickPersona(zone, hourNow()));
    ped.P = PERSONAS[ped.personality] || PERSONAS.calm;
    ped.tough = Math.random() < ped.P.fight;
    // r6-walk: everybody has their own pace, about 1.1-1.5 m/s (office people at the brisk end, beach strollers slower)
    ped.walkSpeed =
      act === 'jog'
        ? rand(2.6, 3.2)
        : Math.max(
            1.0,
            Math.min(
              1.58,
              (zone === 'business' || zone === 'downtown'
                ? rand(1.3, 1.52)
                : zone === 'beach'
                  ? rand(1.0, 1.25)
                  : rand(1.1, 1.5)) * ped.P.walk,
            ),
          );
    ped.reserved = false;
    ped.pinned = 0;
    ped.follow = null;
    ped.pairId = 0;
    ped.lookDest = null;
    ped.lostT = 0;
    ped.blockT = 0;
    ped.call = Math.random() < ped.P.call;
    ped.greeted = false;
    ped.lookT = 0;
    ped.argueT = 0;
    ped.char.setPersonality?.(ped.personality);
    ped.nav = act === 'walk' || act === 'jog' || act === 'dog' ? navFromPos(ped) : null;
    ped.target = null;
    ped.heading = opts.heading ?? Math.random() * Math.PI * 2;
    if (ped.nav) {
      ped.heading = navTarget(ped, _nt);
      if (act === 'walk') ped.nav.dest = pickDest(ped.pos);
    }
    const gy = groundAt(pos.x, pos.z, pos.y || 0);
    ped.pos.y = opts.y ?? gy;
    ped.groundY = ped.pos.y;
    if (ped.collider) {
      ped.collider.setEnabled(!opts.noCollider);
      ped.body.setTranslation({ x: ped.pos.x, y: ped.pos.y + 0.9, z: ped.pos.z }, true);
      ped.teleported = true;
    }
    if (act === 'dog') {
      ped.dog = makeDog();
      ped.dog.pos.copy(ped.pos);
      ped.dog.prev?.copy(ped.pos);
    }
    // identity, unique look and traits (people.v2.js); a failure leaves the v1 person as is
    ped.identity = null;
    ped.look = null;
    ped.applied = null;
    ped.sig = null;
    ped.sawWeapon = false;
    ped.waitT = 0;
    ped.handsUp = false;
    ped.walkBoostT = 0;
    ped.callPe = null;
    ped.helper = false;
    if (zone !== 'cop' && opts.outfit !== 'cop') {
      try {
        game.people?.dress?.(ped, { zone, act, opts });
      } catch (e) {
        console.warn('[peds] dress', e);
      }
    }
    ped.root.position.copy(ped.pos);
    ped.root.rotation.y = ped.heading;
    return ped;
  }

  // ---------------------------------------------------------------- scenarios (what spawns where)
  function freePeds(n) {
    const out = [];
    for (const p of list) {
      if (!p.active) {
        out.push(p);
        if (out.length >= n) break;
      }
    }
    while (out.length < n) out.push(newPed());
    return out;
  }
  function spawnScenario(pp, budget) {
    if (!canSpawn(1)) return [];
    const h = hourNow();
    const night = h >= 20 || h < 3;
    // a candidate spawn location on a sidewalk around the player (prefer behind the camera or far)
    let base = null;
    for (let i = 0; i < 6 && !base; i++) {
      const p = sidewalkNear(pp, Math.random() < 0.75 ? 60 : 110); // close enough to be seen (playtest: streets looked empty)
      if (!p) continue;
      const d = Math.hypot(p.x - pp.x, p.z - pp.z);
      if (d < SPAWN_MIN) continue;
      if (!collidersReady(p.x, p.z)) continue;
      if (!spotOK(p.x, p.z)) continue;
      const cam = game.camera;
      let behind = true;
      if (cam) {
        cam.getWorldDirection(_v2);
        behind = _v2.x * (p.x - cam.position.x) + _v2.z * (p.z - cam.position.z) < 0;
      }
      if (!behind && d < 45 && Math.random() < 0.85) continue;
      if (!NAV_OLD && d < 150 && inCamView(p.x, p.y || 0, p.z)) continue; // r3-people (user, item 30): never spawn in plain sight
      base = p;
    }
    const zone0 = base ? zoneAt(base.x, base.z) : zoneAt(pp.x, pp.z);
    const beachNear = zone0 === 'beach' || zoneAt(pp.x, pp.z) === 'beach';
    const r = Math.random();
    // ---- beach life
    const raining = isRaining();
    if (beachNear && raining && Math.random() < 0.75) return []; // r3-people: the beach empties in the rain
    if (beachNear && budget >= 2 && !night && !raining && r < 0.65) {
      const k = Math.random();
      if (k < 0.38) {
        const c = sandPoint(pp, 140);
        if (c) return sunbathers(c, Math.min(budget, 1 + ((Math.random() * 3) | 0)));
      }
      // (no beach volleyball games: removed in stage 1 job 6)
      else if (k < 0.6 && countGroups('disc') < 2) {
        const c = sandPoint(pp, 130);
        if (c) return frisbee(c);
      } else if (k < 0.8) {
        const w = waterPoint(pp, 140, Math.random() < 0.5);
        if (w) return swimmer(w);
      } else {
        const c = shorePoint(pp, 140);
        if (c) return [activate(freePeds(1)[0], c, 'beach', 'shore')];
      }
    }
    if (!base) return [];
    // ---- benches / leaning
    if (spots.benches.length && r < 0.12) {
      const s = freeSpot(spots.benches, pp);
      if (s) return seat(s, zone0);
    }
    if (
      spots.lean.length &&
      r < 0.2 &&
      list.filter((p) => p.active && p.state === 'lean').length < 6
    ) {
      const s = freeSpot(spots.lean, pp);
      if (s) return leaner(s, zone0);
    }
    // ---- nightlife crowds
    if (
      night &&
      (zone0 === 'nightlife' || zone0 === 'commercial' || zone0 === 'beach') &&
      budget >= 3 &&
      r < 0.55
    ) {
      const f = spots.fronts.length ? freeSpot(spots.fronts, pp) : null;
      const c = f ? new THREE.Vector3(f.x, f.y ?? groundAt(f.x, f.z), f.z) : base;
      return crowd(c, 'nightlife', Math.min(budget, 3 + ((Math.random() * 5) | 0)), true, f);
    }
    // ---- business pairs outside offices
    if ((zone0 === 'business' || zone0 === 'downtown') && budget >= 2 && r < 0.35)
      return crowd(base, 'business', 2 + (Math.random() < 0.3 ? 1 : 0), false);
    // ---- residential: dog walkers, joggers, gardeners
    if (zone0 === 'residential' || zone0 === 'park') {
      if (r < 0.32) return [activate(freePeds(1)[0], base, zone0, 'dog')];
      if (r < 0.5)
        return [
          activate(freePeds(1)[0], base, zone0 === 'park' ? 'park' : 'residential', 'jog', {
            outfit: 'sport',
          }),
        ];
      if (r < 0.58 && !night) return [gardener(base, zone0)];
    }
    if ((zone0 === 'beach' || zone0 === 'causeway') && r < 0.35)
      return [activate(freePeds(1)[0], base, zone0, 'jog', { outfit: 'sport' })];
    // ---- talking groups anywhere
    if (budget >= 2 && r < 0.62)
      return crowd(base, zone0, 2 + (Math.random() < 0.35 ? 1 : 0), false);
    // ---- default: walker (now and then a couple walking side by side)
    if (budget >= 2 && Math.random() < 0.22) return couple(base, zone0);
    return [activate(freePeds(1)[0], base, zone0, 'walk')];
  }
  const countGroups = (k) => {
    let n = 0;
    for (const g of groups) if (g[k]) n++;
    return n;
  };
  // ---------------------------------------------------------------- r7-groups (user, Nov 18 #23: "about 10 NPCs stand clumped
  // together doing nothing, glitching up and down, mismatched: old people, a little girl, a random old man")
  // A gathering is 2-5 people who belong together, doing one thing: friends chatting, seniors on a corner, workers on a
  // break, teens hanging out, a business pair, a family, a night-out crowd. The first member sets the theme; every other
  // member must fit the first (age band, look family). They stand in a loose, staggered ring facing in, take turns to
  // speak (one talks with gestures, the others listen and face the speaker), and leave together. Groups keep 16 m apart,
  // never stand on a carriageway (game.placement), and every member spot is clear of trunks / poles / walls (static
  // colliders at chest height).
  const _bq = { x: 0, y: 0, z: 0, w: 1 };
  let _ball = null;
  const clearWhy = {};
  const why = (k) => {
    clearWhy[k] = (clearWhy[k] || 0) + 1;
    return false;
  };
  let _gRay = null;
  function rayHit(x, y, z, dx, dz, far) {
    _gRay = _gRay || new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 });
    _gRay.origin.x = x;
    _gRay.origin.y = y;
    _gRay.origin.z = z;
    _gRay.dir.x = dx;
    _gRay.dir.y = 0;
    _gRay.dir.z = dz;
    const QF = RAPIER.QueryFilterFlags;
    const h = world.castRay(
      _gRay,
      far,
      false,
      QF.EXCLUDE_DYNAMIC | QF.EXCLUDE_KINEMATIC | QF.EXCLUDE_SENSORS,
    );
    return h ? h.timeOfImpact : far;
  }
  function memberClear(x, y, z, cx, cz) {
    try {
      if (game.placement?.onRoad?.(x, z, 0.25)) return why('road');
      if (game.placement?.inWater?.(x, z)) return why('water');
    } catch (e) {
      /* */
    }
    if (walkGround(game, x, z, _wg) === 'road') return why('road');
    // trunks (r2-physics colliders), poles, walls, fences: waist-high rays from the group center out to the spot and a short
    // cross at the spot. (A ball overlap test was refused nearly everywhere: the tile colliders are one big trimesh at the
    // origin and the overlap query counted spots near it as inside: clearWhy.solid 140 / 140 downtown.)
    try {
      if (cx !== undefined) {
        const dx = x - cx,
          dz = z - cz,
          d = Math.hypot(dx, dz) || 1e-3;
        if (rayHit(cx, y + 1.0, cz, dx / d, dz / d, d + 0.3) < d + 0.25) return why('solid');
        const px = -dz / d,
          pz = dx / d;
        if (rayHit(x - px * 0.3, y + 1.0, z - pz * 0.3, px, pz, 0.6) < 0.6) return why('solid');
      }
    } catch (e) {
      /* keep */
    }
    return true;
  }
  // r7-groups: no gathering within 16 m of another one, and not where 2+ people already stand around
  function groupRoom(c) {
    for (const g of groups)
      if (g.talk && g.members.length && Math.hypot(g.center.x - c.x, g.center.z - c.z) < 16)
        return false;
    let n = 0;
    for (const p of list)
      if (
        p.active &&
        NONMOVING.has(p.state) &&
        Math.abs(p.pos.x - c.x) < 8 &&
        Math.abs(p.pos.z - c.z) < 8 &&
        ++n >= 2
      )
        return false;
    return true;
  }
  const groupStats = { _fail: {} };
  const LISTEN = {
    friends: [0.15, 'phone'],
    teens: [0.35, 'phone'],
    workers: [0.3, 'phone'],
    business: [0.2, 'phone'],
    night: [0.12, 'phone'],
    seniors: [0, null],
    family: [0.1, 'phone'],
  };
  function crowd(c, zone, n, dance, front) {
    const fail = (k) => {
      groupStats._fail[k] = (groupStats._fail[k] || 0) + 1;
      return [];
    };
    if (!c || !groupRoom(c)) return fail('room');
    const night = dance || hourNow() >= 21 || hourNow() < 4;
    const theme = pickTheme(zone, dance && night, hourNow());
    const T = GROUP_THEMES[theme];
    n = Math.max(T.n[0], Math.min(T.n[1], n, 5));
    if (!canSpawn(n)) return fail('budget');
    // the formation: a loose ring facing in (radius by size, staggered), turned until every spot is clear
    const rr0 = n <= 2 ? 0.62 : n === 3 ? 0.85 : n === 4 ? 1.0 : 1.15;
    // the real ground here (sidewalk points can come back with y = 0; downtown the sidewalk is 1-3 m up, which put the
    // clearance ball inside the ground and refused every downtown group: clearWhy.solid)
    const cy = groundAt(c.x, c.z, (Number.isFinite(c.y) ? c.y : 0) + 4);
    let spots = null,
      ccx = c.x,
      ccz = c.z;
    for (let tr = 0; tr < 10 && !spots; tr++) {
      const a0 = Math.random() * Math.PI * 2,
        rr = rr0 * (tr % 2 ? 0.9 : 1);
      if (tr >= 2) {
        const sa = ((tr - 2) * Math.PI) / 4;
        ccx = c.x + Math.sin(sa) * 1.3;
        ccz = c.z + Math.cos(sa) * 1.3;
      } // nudge the center off a curb / pole
      const out = [];
      for (let k = 0; k < n; k++) {
        const a = a0 + (k / n) * Math.PI * 2 + rand(-0.22, 0.22),
          r = rr + rand(-0.1, 0.14);
        const x = ccx + Math.sin(a) * r,
          z = ccz + Math.cos(a) * r;
        if (!memberClear(x, cy, z, ccx, ccz)) break;
        out.push(x, z);
      }
      if (out.length === n * 2) spots = out;
    }
    if (!spots) return fail('spots');
    const g = {
      members: [],
      center: new THREE.Vector3(ccx, cy, ccz),
      props: [],
      talk: true,
      theme,
      spk: 0,
      spkT: rand(1.5, 4),
      zone,
      dance: !!(dance && night),
      pend: [],
      pendT: 5,
      lead: null,
      stay: rand(30, 80),
    };
    groups.add(g);
    for (let k = 0; k < n; k++) g.pend.push(spots[k * 2], spots[k * 2 + 1]);
    // members come in one per frame (a new body is built at most once a frame, so a group fills over a few frames, out of
    // sight like every spawn); a group that cannot be cast within 5 s is dropped (a single person walks on)
    fillGroup(g);
    if (front) {
      used.add(front);
      g.front = front;
      if (g.members[0]) g.members[0].spot = front;
    }
    groupStats[theme] = (groupStats[theme] || 0) + 1;
    return g.members.slice();
  }
  function fillGroup(g) {
    const T = GROUP_THEMES[g.theme];
    let tries = 0;
    while (g.pend.length && tries++ < 3) {
      const x = g.pend[g.pend.length - 2],
        z = g.pend[g.pend.length - 1];
      const L0 = g.lead,
        kk = g.members.length,
        theme = g.theme;
      const cand = L0 ? (m) => groupMate(theme, L0, m, kk) : T.lead;
      const p = freePeds(1)[0];
      const act = g.dance && theme === 'night' && Math.random() < 0.75 ? 'dance' : 'talk';
      if (
        !activate(p, new THREE.Vector3(x, g.center.y, z), g.zone, act, {
          heading: Math.atan2(g.center.x - x, g.center.z - z) + rand(-0.2, 0.2),
          cand,
        })
      )
        return; // nobody fitting free this frame: try next frame
      if (p.char?.personMeta && !cand(p.char.personMeta)) {
        despawn(p);
        return;
      }
      g.pend.length -= 2;
      if (!g.lead) g.lead = p.char?.personMeta || { years: 32, age: 'adult', look: 'casual' };
      p.group = g;
      g.members.push(p);
      p.stateT = g.stay - (5 - g.pendT) + rand(0, 2.5);
      const ls = LISTEN[theme] || LISTEN.friends;
      p.listenStyle =
        AGE(p.char?.personMeta) === 'kid'
          ? null
          : p.identity?.smoker && g.theme !== 'family' && g.theme !== 'business'
            ? 'smoke'
            : Math.random() < ls[0]
              ? ls[1]
              : null; // r7: smokers smoke while they listen
      p.idleStyle = p.act === 'dance' ? 'dance' : p.listenStyle;
      p.styleT = rand(1, 4);
      if (g.front && g.members.length === 1) p.spot = g.front;
    }
  }
  function updateGroups(dt) {
    for (const g of groups) {
      if (!g.talk || !g.pend || (!g.pend.length && g.pendT <= 0)) continue;
      g.pendT -= dt;
      if (g.pend.length) fillGroup(g);
      if (g.pendT > 0 && g.pend.length) continue;
      g.pend.length = 0;
      g.pendT = 0;
      // what came together: a lone person walks on; a family without an adult (kids alone) never stays
      const kidsOnly =
        g.theme === 'family' && !g.members.some((p) => AGE(p.char?.personMeta) === 'adult');
      if (g.members.length < 2 || kidsOnly) {
        groupStats._fail['cast' + g.members.length] =
          (groupStats._fail['cast' + g.members.length] || 0) + 1;
        for (const p of g.members.slice()) {
          if (kidsOnly) {
            despawn(p);
            continue;
          }
          p.group = null;
          p.state = 'walk';
          p.act = 'walk';
          p.idleStyle = null;
          if (!p.nav) p.nav = navFromPos(p);
          if (p.nav) p.nav.dest = pickDest(p.pos);
        }
        g.members.length = 0;
        endGroup(g);
      }
    }
  }
  function seat(s, zone) {
    const p = freePeds(1)[0];
    used.add(s);
    // root slightly in front of the bench's seat edge, facing away from the backrest
    const fx = Math.sin(s.heading),
      fz = Math.cos(s.heading);
    if (
      !activate(
        p,
        new THREE.Vector3(s.pos.x + fx * 0.12, s.pos.y, s.pos.z + fz * 0.12),
        zone,
        'bench',
        { heading: s.heading, noCollider: false },
      )
    ) {
      used.delete(s);
      return [];
    }
    p.spot = s;
    p.idleStyle = 'sitBench';
    p.stateT = rand(20, 80);
    p.call = Math.random() < 0.15;
    return [p];
  }
  // a lean spot needs room for the elbow, hand and the bent leg: no mailbox / bin / hydrant / sign post within ~0.55 m of
  // the body (QA: an NPC leaned into a mailbox with his hand and leg through it); checked once per spot
  function leanClear(s) {
    if (s._leanOK !== undefined) return s._leanOK;
    let ok = true;
    try {
      const B = game.breakables;
      if (B?.near)
        for (const r of B.near(s.pos.x, s.pos.z, 1.6))
          if (r.collider && Math.hypot(r.x - s.pos.x, r.z - s.pos.z) - (r.r || 0.2) < 0.55) {
            ok = false;
            break;
          }
    } catch (e) {
      /* keep */
    }
    if (ok)
      try {
        // anything solid right in front of the body (poles, planters): a ball ahead of the spot, clear of the wall behind
        const fx = Math.sin(s.heading),
          fz = Math.cos(s.heading);
        const hit = world.intersectionWithShape(
          { x: s.pos.x + fx * 0.22, y: s.pos.y + 0.9, z: s.pos.z + fz * 0.22 },
          { x: 0, y: 0, z: 0, w: 1 },
          new RAPIER.Ball(0.2),
          RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC |
            RAPIER.QueryFilterFlags.EXCLUDE_KINEMATIC |
            RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
        );
        if (hit) ok = false;
      } catch (e) {
        /* keep */
      }
    return (s._leanOK = ok);
  }
  function leaner(s, zone) {
    if (!leanClear(s)) return [];
    const p = freePeds(1)[0];
    used.add(s);
    if (!activate(p, s.pos, zone, 'lean', { heading: s.heading })) {
      used.delete(s);
      return [];
    }
    p.spot = s;
    p.idleStyle = 'lean';
    p.stateT = rand(20, 70);
    p.call = Math.random() < 0.25;
    return [p];
  }
  function gardener(c, zone) {
    const p = freePeds(1)[0];
    if (!activate(p, c, zone, 'garden')) return [];
    p.idleStyle = 'kneel';
    p.stateT = rand(25, 60);
    return p;
  }
  function sunbathers(c, n) {
    if (!canSpawn(n)) return [];
    const g = { members: [], center: c.clone(), props: [] };
    groups.add(g);
    const hd = Math.random() * Math.PI * 2;
    const wantUmb = Math.random() < 0.6;
    const ps = freePeds(n);
    ps.forEach((p, k) => {
      const ox = Math.cos(hd) * (k - (n - 1) / 2) * 1.25,
        oz = -Math.sin(hd) * (k - (n - 1) / 2) * 1.25;
      const pos = new THREE.Vector3(c.x + ox, 0, c.z + oz);
      if (
        !activate(p, pos, 'beach', 'sunbathe', {
          heading: hd + rand(-0.15, 0.15) + (Math.random() < 0.3 ? Math.PI : 0),
          outfit: 'beach',
        })
      )
        return;
      p.idleStyle = Math.random() < 0.65 ? 'lie' : 'sitGround';
      p.group = g;
      g.members.push(p);
      p.stateT = rand(60, 200);
      // a real towel draped on the sand under them (src/npc/beachTowel.js), flip-flops / a bag beside it
      const th = p.heading,
        tz = p.idleStyle === 'lie' ? -0.42 : 0.15,
        tx0 = p.pos.x + Math.sin(th) * tz,
        tz0 = p.pos.z + Math.cos(th) * tz;
      const gA = (x, z) => groundAt(x, z, p.pos.y + 1);
      const towel = makeTowel(tx0, tz0, th, pick(TOWEL_COLS), gA, (p.id || 1) * 7 + k);
      scene.add(towel);
      p.towel = towel;
      props.add(towel);
      if (Math.random() < 0.8) {
        const th2 = makeBeachThings(tx0, tz0, th, gA, (p.id || 1) * 13 + k);
        scene.add(th2);
        props.add(th2);
        (p.ownProps ||= []).push(th2);
        towel.userData.things = th2;
      }
    });
    // the umbrella stands on the sun side of the first towel so the canopy shade falls on that person (the shade lands
    // at canopy - sun_xz * h / sun_y), its pole kept off the towel
    const t0 = g.members[0]?.towel;
    if (wantUmb && t0) {
      const tp = t0.position,
        th = t0.rotation.y,
        cs = Math.cos(th),
        sn = Math.sin(th);
      let dx = Math.cos(hd) * 0.9,
        dz = -Math.sin(hd) * 0.9;
      const sun = game.env?.sun;
      if (sun?.target) {
        const d = _v.subVectors(sun.position, sun.target.position).normalize(),
          hz = Math.hypot(d.x, d.z) || 1e-6;
        if (d.y > 0.2) {
          const off = Math.min(1.8, (2.05 * hz) / d.y);
          dx = (d.x / hz) * off;
          dz = (d.z / hz) * off;
        }
      }
      let lx = dx * cs - dz * sn,
        lz = dx * sn + dz * cs;
      if (Math.abs(lx) < 0.6 && Math.abs(lz) < 1.05) lx = (lx < 0 ? -1 : 1) * 0.6;
      const ux = tp.x + lx * cs + lz * sn,
        uz = tp.z - lx * sn + lz * cs;
      g.props.push(makeUmbrella(ux, groundAt(ux, uz, tp.y + 1), uz));
    }
    return ps;
  }
  function volleyball(c) {
    if (!canSpawn(4)) return [];
    const g = { members: [], center: c.clone(), props: [], ball: null };
    groups.add(g);
    const hd = Math.random() * Math.PI * 2,
      fx = Math.sin(hd),
      fz = Math.cos(hd),
      rx = Math.cos(hd),
      rz = -Math.sin(hd);
    const slots = [
      [-3.2, -1.2],
      [-3.2, 1.2],
      [3.2, -1.2],
      [3.2, 1.2],
    ];
    const ps = freePeds(4);
    ps.forEach((p, k) => {
      const [a, b] = slots[k];
      const pos = new THREE.Vector3(c.x + fx * a + rx * b, 0, c.z + fz * a + rz * b);
      if (
        !activate(p, pos, 'beach', 'volley', {
          heading: Math.atan2(c.x - pos.x, c.z - pos.z) * 0 + (a < 0 ? hd : hd + Math.PI),
          outfit: 'beach',
        })
      )
        return;
      p.idleStyle = 'volley';
      p.group = g;
      g.members.push(p);
      p.stateT = 400;
    });
    // net: two poles + a translucent mesh panel across the middle
    const net = new THREE.Group();
    net.position.set(c.x, c.y, c.z);
    net.rotation.y = hd + Math.PI / 2;
    for (const sx of [-3.4, 3.4]) {
      const pl = new THREE.Mesh(propGeo.pole, pmat(0xdedede, 0.4));
      pl.position.set(sx, 1.1, 0);
      pl.castShadow = true;
      net.add(pl);
    }
    const panel = new THREE.Mesh(
      SG('PlaneGeometry', THREE.PlaneGeometry, 6.8, 0.9, 1, 1),
      (netMat ||= new THREE.MeshStandardMaterial({
        color: 0x111111,
        transparent: true,
        opacity: 0.45,
        side: THREE.DoubleSide,
        roughness: 1,
      })),
    );
    panel.position.y = 1.85;
    net.add(panel);
    const band = new THREE.Mesh(
      SG('BoxGeometry', THREE.BoxGeometry, 6.8, 0.06, 0.02),
      pmat(0xf5f5f5, 0.6),
    );
    band.position.y = 2.3;
    net.add(band);
    scene.add(net);
    props.add(net);
    g.props.push(net);
    const ball = addProp(new THREE.Mesh(propGeo.ball, pmat(0xf2efe6, 0.6)));
    g.props.push(ball);
    g.ball = { mesh: ball, from: 0, to: 2, t: 0, dur: 1.3 };
    return ps;
  }
  function frisbee(c) {
    if (!canSpawn(2)) return [];
    const g = { members: [], center: c.clone(), props: [], disc: null };
    groups.add(g);
    const hd = Math.random() * Math.PI * 2,
      fx = Math.sin(hd),
      fz = Math.cos(hd);
    const ps = freePeds(2);
    ps.forEach((p, k) => {
      const s = k ? 1 : -1;
      const pos = new THREE.Vector3(c.x + fx * 5 * s, 0, c.z + fz * 5 * s);
      if (
        !activate(p, pos, 'beach', 'frisbee', { heading: hd + (k ? Math.PI : 0), outfit: 'beach' })
      )
        return;
      p.group = g;
      g.members.push(p);
      p.stateT = 300;
    });
    const disc = addProp(
      new THREE.Mesh(propGeo.disc, pmat(pick([0xe07f68, 0xf2d84a, 0x2f8a86, 0xffffff]), 0.5)),
    );
    g.props.push(disc);
    g.disc = { mesh: disc, from: 0, to: 1, t: -0.8, dur: 1.4 };
    return ps;
  }
  function swimmer(w) {
    const p = freePeds(1)[0];
    const depth = seaLevel - w.y;
    const wade = depth < 0.9;
    if (
      !activate(p, w, 'beach', wade ? 'wade' : 'swim', {
        outfit: 'beach',
        y: wade ? w.y : seaLevel - 0.05,
        noCollider: true,
      })
    )
      return [];
    p.idleStyle = wade ? null : 'swim';
    p.stateT = rand(40, 120);
    p.swimDir = Math.random() * Math.PI * 2;
    return p ? [p] : [];
  }

  // voice reactions (AUDIO agent may listen): kind = greet | apologise | insult | argue | scream | drunk
  function voice(ped, kind) {
    const now = game.clock?.elapsed ?? 0;
    if (ped.voiceT && now - ped.voiceT < 2.5) return;
    ped.voiceT = now;
    try {
      game.emit?.('pedVoice', {
        ped,
        kind,
        voice: ped.P?.voice || 'calm',
        personality: ped.personality,
        gender: ped.char?.human?.gender,
        position: ped.pos.clone(),
      });
    } catch (e) {
      /* ignore */
    }
    try {
      game.people?.voiceLine?.(ped, kind);
    } catch (e) {
      /* ignore */
    }
  }
  // ---------------------------------------------------------------- incidents / damage / API
  function emitHit(ped, kind, damage, dir, info = {}) {
    if (kind === 'car') return; // vehicles emit their own impact event
    try {
      game.emit?.('hit', {
        target: 'ped',
        object: ped,
        point: info.point ? info.point.clone() : ped.pos.clone().setY(ped.pos.y + 1.1),
        normal: dir ? dir.clone().negate() : new THREE.Vector3(0, 1, 0),
        damage,
        kind,
        zone: info.zone,
        limb: info.limb,
        strength: info.strength,
        byPlayer: info.byPlayer,
        weapon: info.weapon,
      });
    } catch (e) {
      /* ignore */
    }
  }
  function panic(x, z, radius = 20, src = 'incident', byPlayer = true) {
    for (const o of list) {
      if (!o.active || o.dead || o.state === 'fight' || o.state === 'cop' || o.rag) continue;
      const dx = o.pos.x - x,
        dz = o.pos.z - z;
      const d2 = dx * dx + dz * dz;
      const pr = o.P ? o.P.panic : 1;
      if (d2 > radius * radius * pr * pr) continue;
      const d = Math.sqrt(d2),
        r = Math.random();
      let react = null;
      if (o.identity && game.people?.react) {
        try {
          react = game.people.react(o, { src, d, x, z, byPlayer });
        } catch (e) {
          react = null;
        }
        if (react === 'ignore') continue;
      }
      if (react) {
        /* chosen from the person's traits (people.v2.js) */
      } else if (o.act === 'swim') react = 'swimAway';
      else if (d < 7 && r < (o.P ? o.P.cower : 0.22)) react = 'cower';
      else if (d > 6 && r < (o.P ? o.P.film : 0.3) + (o.P ? o.P.cower : 0) && o.char?.hasPhone)
        react = 'film';
      else react = 'flee';
      o.pending = { react, x, z, t: 0.15 + d * 0.03 + Math.random() * 0.35, src };
    }
  }
  function knockDown(ped, dir, opts = {}) {
    if (ped.dead && ped.rag) return;
    const lethal = opts.lethal !== false;
    ped.state = lethal ? 'dead' : 'down';
    ped.deadT = 0;
    ped.guard = false;
    ped.idleStyle = null;
    if (lethal) {
      ped.dead = true;
      ped.health = 0;
    }
    ped.collider?.setEnabled(false);
    removeDog(ped);
    if (ped.towel) ped.towel.visible = false;
    if (ped.group) {
      ped.group.members = ped.group.members.filter((m) => m !== ped);
      ped.group = null;
    }
    if (ped.spot) {
      used.delete(ped.spot);
      ped.spot = null;
    }
    if (rag && !ped.rag) {
      try {
        ped.root.position.copy(ped.pos);
        ped.root.updateMatrixWorld(true);
        const part = opts.limb ? LIMB_PART[opts.limb] : null;
        ped.rag = rag.start(ped.char, {
          vel: opts.vel || { x: 0, y: 0, z: 0 },
          spin: opts.spin || 0,
          hit: opts.impulse ? { impulse: opts.impulse, point: opts.point || null, part } : null,
          kind: opts.kind,
          strength: opts.strength,
          lethal,
          balance: !!opts.balance,
        });
      } catch (e) {
        ped.rag = null;
      }
    }
    panic(ped.pos.x, ped.pos.z, 20, 'knockdown');
  }
  // public: damage(ped, amount, dir, kind, info{zone, limb, point, strength, byPlayer, weapon, heavy})
  // r7-react: people remember roughly what the player did to them (by identity, so the same person met again later
  // knows): hurt / robbed / threatened -> afraid (they back off and hurry away, tough ones mouth off); helped -> friendly
  const deeds = new Map(); // identity id -> { hurt, threat, helped, t }
  function remember(ped, what) {
    const id = ped?.identity?.id;
    if (!id) return;
    const d = deeds.get(id) || { hurt: 0, threat: 0, helped: 0, t: 0 };
    d[what] = (d[what] || 0) + 1;
    d.t = game.clock?.elapsed || 0;
    deeds.set(id, d);
    if (deeds.size > 400) deeds.delete(deeds.keys().next().value);
  }
  function damage(ped, amount = 25, dir = null, kind = 'melee', info = {}) {
    if (!ped || !ped.active || (ped.dead && ped.state === 'dead')) return;
    if (!info.npc && kind !== 'car') remember(ped, 'hurt');
    const d = dir ? new THREE.Vector3(dir.x, 0, dir.z) : new THREE.Vector3(0, 0, 1);
    if (d.lengthSq() < 1e-6) d.set(0, 0, 1);
    d.normalize();
    ped.health = (ped.health ?? 100) - amount;
    emitHit(ped, kind, amount, d, info);
    const strength = info.strength ?? Math.min(1, amount / 100);
    const pt = info.point || ped.pos.clone().setY(ped.pos.y + 1.1);
    if (kind === 'car') {
      // vehicle impact: momentum from the car's velocity (dir carries the car's travel direction incl. slight lift)
      const kmh = amount / 1.5;
      const v = Math.min(16, kmh / 3.6) * 0.8;
      const lethal = ped.health <= 0 || kmh > 32;
      ped.knock.set(0, 0, 0);
      knockDown(ped, d, {
        kind: 'car',
        strength: Math.min(1, kmh / 60),
        lethal,
        vel: { x: d.x * v, y: Math.min(3.2, kmh / 22), z: d.z * v },
        spin: Math.min(3, kmh / 20),
        point: pt,
        impulse: new THREE.Vector3(d.x * v * 6, 0, d.z * v * 6),
      });
      if (!lethal) ped.getUpT = rand(2.2, 3.5);
      return;
    }
    if (ped.health <= 0) {
      const I =
        kind === 'bullet' ? 9 + strength * 14 : kind === 'explosion' ? 120 : 25 + strength * 40;
      knockDown(ped, d, {
        kind,
        strength,
        lethal: true,
        vel: {
          x: d.x * (kind === 'explosion' ? 5 : 0.6),
          y: kind === 'explosion' ? 4 : 0,
          z: d.z * (kind === 'explosion' ? 5 : 0.6),
        },
        point: pt,
        limb: info.limb,
        impulse: new THREE.Vector3(d.x * I, I * 0.1, d.z * I),
      });
      return;
    }
    // non-lethal: heavy blows knock people down (they get back up), others stagger + flinch
    if ((info.heavy || strength > 0.85) && kind !== 'bullet' && Math.random() < 0.6) {
      knockDown(ped, d, {
        kind,
        strength,
        balance: true,
        lethal: false,
        vel: { x: d.x * 1.5, y: 0.3, z: d.z * 1.5 },
        point: pt,
        limb: info.limb,
        impulse: new THREE.Vector3(d.x * 30, 3, d.z * 30),
      });
      ped.getUpT = rand(1.8, 3.2);
      return;
    }
    ped.hitNow = true;
    ped.knock.set(d.x * (1.2 + strength * 2), 0, d.z * (1.2 + strength * 2));
    ped.shoveT = 0.35;
    if (ped.isCop) {
      ped.state = 'cop';
      return;
    }
    if (ped.tough && !ped.foughtBack && kind !== 'bullet') {
      ped.state = 'fight';
      ped.stateT = rand(6, 10);
      ped.foughtBack = true;
      ped.hitCd = 0.6;
      ped.guard = true;
      ped.idleStyle = null;
      ped.leaveGroup = true;
    } else {
      ped.state = 'flee';
      ped.fleeT = rand(4, 7);
      ped.threat = { x: ped.pos.x - d.x, z: ped.pos.z - d.z };
      ped.scream = true;
      ped.idleStyle = null;
      ped.leaveGroup = true;
    }
    panic(ped.pos.x, ped.pos.z, 20, 'hit');
  }
  function spawnAt(pos, o = {}) {
    let p = list.find((q) => !q.active) || null;
    // r7 (activities agent): the recycler never takes a pinned / reserved person (scripted people placed by other
    // systems: bar regulars, the yacht bouncer, job targets, clerks); with nobody free to take the pool grows instead
    if (!p) {
      let bd = -1;
      const pp = playerPos();
      for (const q of list) {
        if (q.pinned > 0 || q.reserved) continue;
        const dd = q.pos.distanceTo(pp);
        if (dd > bd && q.state !== 'fight' && q.state !== 'cop') {
          bd = dd;
          p = q;
        }
      }
      if (p) despawn(p);
    }
    if (!p) p = newPed();
    const zone = o.state === 'cop' ? 'cop' : o.outfit || zoneAt(pos.x, pos.z);
    if (
      !activate(p, new THREE.Vector3(pos.x, pos.y ?? groundAt(pos.x, pos.z), pos.z), zone, 'walk', {
        outfit: o.state === 'cop' ? 'cop' : o.outfit,
        gender: o.gender,
        y: pos.y,
        force: true,
        personality: o.personality,
      })
    )
      return null;
    const pp = playerPos();
    if (o.state === 'flee') {
      p.state = 'flee';
      p.fleeT = rand(4, 7);
      p.threat = { x: pp.x, z: pp.z };
      p.scream = true;
    } else if (o.state === 'fight') {
      p.state = 'fight';
      p.stateT = 15;
      p.hitCd = 1;
      p.guard = true;
    } else if (o.state === 'cop') {
      p.state = 'cop';
      p.isCop = true;
      p.tough = true;
      p.hitCd = 1;
      p.char.restyle?.('cop');
    }
    if (o.dog && !p.dog) {
      p.dog = makeDog();
      p.dog.pos.copy(p.pos);
      p.dog.prev?.copy(p.pos);
    } // a walker with a dog (tests / scripted scenes)
    p.pinned = o.pin || o.reserved ? 1e9 : 20; // spawned by gameplay: don't recycle immediately (o.pin / o.reserved: never)
    p.reserved = !!o.reserved;
    return p;
  }
  try {
    game.on?.('shot', (e) => {
      const o = e?.origin;
      if (o) panic(o.x, o.z, 40, 'shot', e.byPlayer !== false);
    });
    game.on?.('crash', (e) => {
      const pt = e?.point || e?.vehicle?.body?.translation?.();
      if (pt && (e.impulse === undefined || e.impulse > 2000)) {
        const pv = game.player?.state?.vehicle || game.player?.vehicle;
        panic(
          pt.x,
          pt.z,
          25,
          'crash',
          e.byPlayer ?? (!!pv && (e.vehicle === pv || e.other === pv)),
        );
      }
    });
    game.on?.('punch', (e) => {
      const o = e?.position;
      if (o)
        for (const p of list)
          if (p.active && !p.dead && p.pos.distanceTo(o) < 8 && Math.random() < 0.5)
            p.lookUntil = (game.clock?.elapsed ?? 0) + 3;
    });
  } catch (e) {
    /* ignore */
  }
  // tiles whose colliders are being removed: freeze ragdolls + despawn peds there (they would fall through)
  try {
    city.onTileCollidersRemoving?.((b) => {
      for (const p of list) {
        if (!p.active) continue;
        if (
          p.pos.x >= b.minX - 1 &&
          p.pos.x <= b.maxX + 1 &&
          p.pos.z >= b.minZ - 1 &&
          p.pos.z <= b.maxZ + 1
        ) {
          if (p.rag) {
            try {
              rag.freeze(p.rag);
            } catch (e) {
              /* ignore */
            }
          }
          p.despawnNow = true;
        }
      }
    });
  } catch (e) {
    /* ignore */
  }

  // ---------------------------------------------------------------- update
  const vPrev = new WeakMap();
  let spawnT = 0,
    lastPunch = false;
  function targetCount() {
    const h = hourNow();
    let base = h >= 1 && h < 5 ? 10 : h < 7 ? 18 : h < 9 ? 26 : h < 20 ? 32 : h < 23 ? 30 : 20;
    // people.v2.js: who would really be out here at this hour (district x hour schedules)
    try {
      const pp = playerPos();
      const dn = game.people?.densityFor?.(pp.x, pp.z);
      if (Number.isFinite(dn)) base = Math.round(8 + 40 * dn);
    } catch (e) {
      /* ignore */
    }
    const fps = game.perf?.fps || 60;
    // playtest: more people on the street; a dip in frame rate trims the crowd gently instead of halving it
    const cap = fps >= 50 ? 40 : fps >= 38 ? 34 : 28;
    // quality preset (src/render/quality.v2.js) scales how many full characters walk around
    const qs = game.quality?.current?.pedScale ?? 1;
    return Math.round(Math.min(base, cap) * qs);
  }
  // ---- personal space (playtest: people clipped through each other and the player)
  // Within SEP_R of the player, people on foot keep at least SEP_MIN apart (spatial hash, 2 m cells) and stay out
  // of the player's body. Positions are nudged before the wall check, so the KCC still resolves walls afterward.
  const SEP_R = 30;
  const SEP_MIN = 0.62;
  const SEP_PLAYER = 0.72;
  const sepCells = new Map();
  const sepList = [];
  const SEP_SKIP = new Set(['swim', 'off', 'bench', 'sunbathe', 'convo', 'talk']);
  function separate(pp, inCar) {
    sepCells.clear();
    sepList.length = 0;
    for (const ped of list) {
      if (!ped.active || ped.dead || ped.rag || SEP_SKIP.has(ped.state)) {
        continue;
      }
      if (Math.abs(ped.pos.x - pp.x) > SEP_R || Math.abs(ped.pos.z - pp.z) > SEP_R) {
        continue;
      }
      const k = (Math.floor(ped.pos.x / 2) * 73856093) ^ (Math.floor(ped.pos.z / 2) * 19349663);
      let c = sepCells.get(k);
      if (!c) {
        c = [];
        sepCells.set(k, c);
      }
      c.push(ped);
      sepList.push(ped);
    }
    for (const a of sepList) {
      a._sx = a.pos.x;
      a._sz = a.pos.z;
    }
    for (const a of sepList) {
      const cx = Math.floor(a.pos.x / 2);
      const cz = Math.floor(a.pos.z / 2);
      for (let ix = cx - 1; ix <= cx + 1; ix++) {
        for (let iz = cz - 1; iz <= cz + 1; iz++) {
          const c = sepCells.get((ix * 73856093) ^ (iz * 19349663));
          if (!c) {
            continue;
          }
          for (const b of c) {
            if (b.id <= a.id) {
              continue;
            }
            const dx = b.pos.x - a.pos.x;
            const dz = b.pos.z - a.pos.z;
            const d2 = dx * dx + dz * dz;
            if (d2 >= SEP_MIN * SEP_MIN) {
              continue;
            }
            const d = Math.sqrt(d2) || 0.001;
            const push = (SEP_MIN - d) * 0.5;
            const nx = d2 > 1e-8 ? dx / d : Math.cos(a.id);
            const nz = d2 > 1e-8 ? dz / d : Math.sin(a.id);
            // people standing together (in a conversation group) give way less than walkers
            const wa = NONMOVING.has(a.state) ? 0.3 : 1;
            const wb = NONMOVING.has(b.state) ? 0.3 : 1;
            const ws = wa + wb;
            a.pos.x -= nx * push * 2 * (wa / ws);
            a.pos.z -= nz * push * 2 * (wa / ws);
            b.pos.x += nx * push * 2 * (wb / ws);
            b.pos.z += nz * push * 2 * (wb / ws);
          }
        }
      }
      // the player on foot is solid to people
      if (!inCar) {
        const dx = a.pos.x - pp.x;
        const dz = a.pos.z - pp.z;
        const d2 = dx * dx + dz * dz;
        if (d2 < SEP_PLAYER * SEP_PLAYER) {
          const d = Math.sqrt(d2) || 0.001;
          const nx = d2 > 1e-8 ? dx / d : Math.cos(a.id);
          const nz = d2 > 1e-8 ? dz / d : Math.sin(a.id);
          a.pos.x += nx * (SEP_PLAYER - d);
          a.pos.z += nz * (SEP_PLAYER - d);
        }
      }
    }
    // r6-walk: a nudge never lands a walker on the carriageway (the avoidance steers people apart long before this)
    for (const a of sepList) {
      if (a.pos.x === a._sx && a.pos.z === a._sz) continue;
      if (a.state !== 'walk' || a.nav?.cross) continue;
      try {
        if (
          game.placement?.onRoad?.(a.pos.x, a.pos.z, 0) &&
          !game.placement.onRoad(a._sx, a._sz, 0)
        ) {
          a.pos.x = a._sx;
          a.pos.z = a._sz;
        }
      } catch (e) {
        /* */
      }
    }
  }
  // ---- r6-walk: everybody on foot in one spatial hash (near people, the crowd tier, the player) for the avoidance
  const space = createSpace(1.6);
  const playerAg = { id: -1, x: 0, z: 0, vx: 0, vz: 0, still: false, group: 0 };
  function fillSpace(pp, inCar) {
    space.clear();
    if (!inCar) {
      const v = game.player?.velocity;
      playerAg.x = pp.x;
      playerAg.z = pp.z;
      playerAg.vx = v?.x || 0;
      playerAg.vz = v?.z || 0;
      space.add(playerAg);
    }
    for (const p of list) {
      const ag =
        p._ag || (p._ag = { id: p.id, x: 0, z: 0, vx: 0, vz: 0, still: false, group: 0, ped: p });
      if (!p.active || p.dead || p.rag || p.state === 'swim' || p.state === 'off') continue;
      const mv = p.speed > 0.05 && !NONMOVING.has(p.state);
      ag.x = p.pos.x;
      ag.z = p.pos.z;
      ag.vx = mv ? Math.sin(p.heading) * p.speed : 0;
      ag.vz = mv ? Math.cos(p.heading) * p.speed : 0;
      ag.still = !mv;
      ag.group = p.pairId || 0;
      space.add(ag);
    }
    const ws = game.people?.crowd?.list;
    if (ws)
      for (const w of ws) {
        const ag =
          w.ag ||
          (w.ag = { id: 100000 + crowdAgN++, x: 0, z: 0, vx: 0, vz: 0, still: false, group: 0 });
        const v = w.still ? 0 : (w.v ?? w.speed ?? 0);
        ag.x = w.pos.x;
        ag.z = w.pos.z;
        ag.vx = Math.sin(w.heading) * v;
        ag.vz = Math.cos(w.heading) * v;
        ag.still = !!w.still || v < 0.05;
        ag.group = w.group || 0;
        space.add(ag);
      }
  }
  let crowdAgN = 0,
    pairN = 1;
  // a companion walks beside its leader, on the side away from the road (behind it where the sidewalk is narrow)
  function followStep(ped, dt) {
    const Ld = ped.follow,
      h = Ld.heading,
      os = Ld.nav ? -Ld.nav.hand : 1;
    const wide = !Ld.nav || Ld.nav.path || laneRoom(Ld.nav) > 0.7;
    const tx = wide ? Ld.pos.x + Math.cos(h) * os * 0.74 : Ld.pos.x - Math.sin(h) * 0.9,
      tz = wide ? Ld.pos.z - Math.sin(h) * os * 0.74 : Ld.pos.z - Math.cos(h) * 0.9;
    const dx = tx - ped.pos.x,
      dz = tz - ped.pos.z,
      d = Math.hypot(dx, dz);
    const fx = Math.sin(h),
      fz = Math.cos(h);
    // forward at the shared pace, plus a gentle correction toward the spot beside the leader
    const k = d > 1e-4 ? Math.min(d * Math.min(1, dt * 2.5), 1.2 * dt) / d : 0;
    ped.pos.x += fx * ped.speed * dt + dx * k;
    ped.pos.z += fz * ped.speed * dt + dz * k;
    return d > 1.5 ? Math.atan2(dx + fx, dz + fz) : h;
  }
  // where a walker is heading: a shop door / storefront or a bus stop within a few blocks (r6-walk destinations)
  function pickDest(pos) {
    try {
      const c = [];
      for (const f of spots.fronts) {
        const x = f.fx ?? f.x,
          z = f.fz ?? f.z,
          d = Math.hypot(x - pos.x, z - pos.z);
        if (d > 30 && d < 170) c.push({ x, z, stop: false });
      }
      for (const b of spots.stops) {
        const d = Math.hypot(b.x - pos.x, b.z - pos.z);
        if (d > 30 && d < 170) c.push({ x: b.x, z: b.z, stop: true });
      }
      return c.length ? c[(Math.random() * c.length) | 0] : null;
    } catch (e) {
      return null;
    }
  }
  // two people walking side by side at a shared pace
  function couple(base, zone) {
    const [a, b] = freePeds(2);
    if (!activate(a, base, zone, 'walk')) return [];
    if (!a.nav) return [a];
    a.nav.lane = Math.min(a.nav.lane ?? 0.3, 0.3);
    a.nav.laneMax = 0.35;
    a.nav.laneG = a.nav.lane;
    const h = a.heading,
      os = -a.nav.hand;
    const p2 = new THREE.Vector3(
      a.pos.x + Math.cos(h) * os * 0.74,
      a.pos.y,
      a.pos.z - Math.sin(h) * os * 0.74,
    );
    if (!activate(b, p2, zone, 'walk')) return [a];
    b.follow = a;
    b.nav = null;
    b.heading = h;
    a.pairId = b.pairId = 'c' + pairN++;
    b.walkSpeed = a.walkSpeed;
    return [a, b];
  }
  let frameN = 0;
  function update(dt) {
    dt = Math.min(dt, 0.1);
    createdThisFrame = 0;
    frameN++;
    try {
      updateGroups(dt);
    } catch (e) {
      /* never break the crowd */
    }
    try {
      const cp = game.camera?.position;
      if (cp) updateCarList(game, cp.x, cp.z, dt);
    } catch (e) {
      /* */
    }
    const P = game.player || {};
    const pp = playerPos();
    const ph = P.heading || 0;
    const fwdX = Math.sin(ph),
      fwdZ = Math.cos(ph);
    const pSpeed = P.state?.speed || 0;
    const inCar = !!P.state?.inVehicle;
    const vlist = game.vehicles && Array.isArray(game.vehicles.list) ? game.vehicles.list : [];
    const cam = game.camera?.position || pp;
    const now = game.clock?.elapsed ?? 0;
    try {
      rag?.update(dt);
    } catch (e) {
      console.warn('[ragdoll]', e);
    }

    // crash detection fallback (sudden deceleration)
    for (const v of vlist) {
      if (!v) continue;
      const k = Math.abs(v.speedKmh || 0);
      const prev = vPrev.get(v);
      if (prev !== undefined && prev - k > 25) {
        try {
          const t = v.body.translation();
          panic(t.x, t.z, 25, 'crash');
        } catch (e) {
          /* ignore */
        }
      }
      vPrev.set(v, k);
    }

    // ---- population management
    spotsT += dt;
    if (spotsT > 3) {
      spotsT = 0;
      refreshSpots(pp);
    }
    let activeN = 0;
    for (const p of list) if (p.active) activeN++;
    // while the human library is still streaming in, grow the crowd with it (more distinct people)
    const hl = humansLoaded(),
      ht = humansTotal();
    const want = targetCount();
    spawnT -= dt;
    if (spawnT <= 0 && activeN < want) {
      spawnT = activeN < want * 0.5 ? 0.08 : 0.35;
      try {
        spawnScenario(pp, Math.min(8, want - activeN));
      } catch (e) {
        console.warn('[peds] spawn', e);
      }
    }
    // warm the character pool in the background: at most one new person per frame
    if (!createdThisFrame && pool.length < 6 && activeN + pool.length < want + 4) {
      const z = zoneAt(pp.x, pp.z);
      const c = getChar(z === 'water' ? 'beach' : z, {});
      if (c) {
        c.root.visible = false;
        pool.push(c);
      }
    }
    // camera frustum for animation LOD (offscreen peds don't animate)
    const camO = game.camera;
    if (camO) {
      camO.updateMatrixWorld();
      _proj.multiplyMatrices(camO.projectionMatrix, camO.matrixWorldInverse);
      _frustum.setFromProjectionMatrix(_proj);
    }

    // ---- groups: volleyball ball / frisbee disc flights
    for (const g of groups) {
      if (!g.members.length) {
        endGroup(g);
        continue;
      }
      if (g.ball && g.members.length >= 2) {
        const b = g.ball;
        b.t += dt;
        const A = g.members[b.from % g.members.length],
          B = g.members[b.to % g.members.length];
        if (!A || !B) continue;
        const k = Math.min(1, b.t / b.dur);
        b.mesh.position.set(
          A.pos.x + (B.pos.x - A.pos.x) * k,
          A.pos.y + 1.9 + Math.sin(k * Math.PI) * 3.2,
          A.pos.z + (B.pos.z - A.pos.z) * k,
        );
        if (k >= 1) {
          b.t = 0;
          b.from = b.to;
          let n = (Math.random() * g.members.length) | 0;
          if (n === b.from) n = (n + 1) % g.members.length;
          b.to = n;
          b.dur = rand(1.1, 1.6);
        }
      }
      if (g.disc && g.members.length >= 2) {
        const dsc = g.disc;
        dsc.t += dt;
        const A = g.members[dsc.from],
          B = g.members[dsc.to];
        if (!A || !B) continue;
        if (dsc.t < 0) {
          dsc.mesh.position.set(A.pos.x, A.pos.y + 1.0, A.pos.z);
          if (dsc.t > -0.3) A.throwNow = true;
          continue;
        }
        const k = Math.min(1, dsc.t / dsc.dur);
        dsc.mesh.position.set(
          A.pos.x + (B.pos.x - A.pos.x) * k,
          A.pos.y + 1.2 + Math.sin(k * Math.PI) * 1.0,
          A.pos.z + (B.pos.z - A.pos.z) * k,
        );
        dsc.mesh.rotation.y += dt * 20;
        if (k >= 1) {
          dsc.t = rand(-2.2, -1.2);
          [dsc.from, dsc.to] = [dsc.to, dsc.from];
        }
      }
    }

    // colliders may have been added/removed this frame (tile streaming, ragdolls): refresh the query BVH before KCC queries
    try {
      world.updateSceneQueries?.();
    } catch (e) {
      /* older rapier */
    }
    try {
      fillSpace(pp, inCar);
    } catch (e) {
      /* */
    }
    try {
      separate(pp, inCar);
    } catch (e) {
      // separation is cosmetic: never break the crowd
    }
    for (const ped of list) {
      if (!ped.active) continue;
      const dpx = ped.pos.x - pp.x,
        dpz = ped.pos.z - pp.z;
      const dPlayer = Math.hypot(dpx, dpz);
      if (ped.pinned > 0) ped.pinned -= dt;
      // despawn far away / on unloading tiles / long-dead
      if (
        ped.despawnNow ||
        (dPlayer > DESPAWN && !(ped.pinned > 0) && !ped.reserved) ||
        (ped.dead && (ped.deadT += dt) > 25 && dPlayer > 40)
      ) {
        ped.despawnNow = false;
        despawn(ped);
        continue;
      }
      // nobody strolls on an elevated road deck (playtest): a walker standing well above the street-level ground is
      // removed (checked about twice a second per person, out of view first)
      if ((frameN + ped.id) % 30 === 0 && ped.nav && !ped.dead && ped.state === 'walk') {
        try {
          const street = city.groundHeightAt?.(ped.pos.x, ped.pos.z, -50);
          if (Number.isFinite(street) && ped.pos.y - street > 2.5) {
            despawn(ped);
            continue;
          }
        } catch (e) {
          // no height data here
        }
      }
      let targetSpeed = 0,
        lookAt = null,
        moveHeading = ped.heading;
      ped.handsUp = false;

      // ---- knocked down (ragdoll): wait, then get up if alive
      if (ped.state === 'down' || ped.state === 'dead') {
        if (ped.rag) {
          const pt = rag.pelvisPos(ped.rag);
          if (pt) ped.pos.set(pt.x, pt.y - 0.9, pt.z);
          if (ped.state === 'down') {
            ped.getUpT -= dt;
            if (ped.rag.recovered) {
              // active ragdoll kept its feet: blend straight back into animation (ragdoll.js)
              const info = rag.poseInfo(ped.rag);
              if (info) {
                ped.heading = info.heading;
                ped.pos.set(
                  info.pelvis.x,
                  groundAt(info.pelvis.x, info.pelvis.z, ped.pos.y),
                  info.pelvis.z,
                );
                ped.root.position.copy(ped.pos);
                ped.root.rotation.y = ped.heading;
              }
              rag.handoff(ped.rag);
              ped.rag = null;
              ped.char.snapshotPose?.(0.4);
              ped.state = 'flee';
              ped.fleeT = rand(3, 6);
              ped.threat = { x: pp.x, z: pp.z };
              ped.nav = navFromPos(ped);
              ped.collider?.setEnabled(true);
              ped.teleported = true;
              try {
                ped.body.setTranslation({ x: ped.pos.x, y: ped.pos.y + 0.9, z: ped.pos.z }, true);
              } catch (e) {
                /* ignore */
              }
              continue;
            }
            if (rag.readyToGetUp(ped.rag) || ped.getUpT < -2.5) {
              // get up once the body has settled (cap: getUpT + 2.5 s)
              const info = rag.poseInfo(ped.rag);
              const rd0 = ped.rag;
              ped.rag = null;
              if (!info) rag.remove(rd0);
              if (info) {
                // place the root under the pelvis, oriented so the clip's lying pose matches the body
                const hx = info.head.x - info.pelvis.x,
                  hz = info.head.z - info.pelvis.z;
                const face = info.faceUp ? 'back' : 'fwd';
                // getUpBack lies with the head toward local -Z, getUpFwd with the head toward local +Z
                ped.heading = face === 'back' ? Math.atan2(-hx, -hz) : Math.atan2(hx, hz);
                ped.pos.set(
                  info.pelvis.x,
                  groundAt(info.pelvis.x, info.pelvis.z, ped.pos.y),
                  info.pelvis.z,
                );
                ped.root.position.copy(ped.pos);
                ped.root.rotation.y = ped.heading;
                rag.handoff(rd0); // bones re-expressed under the moved root, so the snapshot blend has no pop
                ped.char.snapshotPose?.(0.6);
                ped.getUp = face;
                ped.getUpClock = 2.5;
                ped.state = 'gettingUp';
                ped.collider?.setEnabled(true);
                ped.teleported = true;
                try {
                  ped.body.setTranslation({ x: ped.pos.x, y: ped.pos.y + 0.9, z: ped.pos.z }, true);
                } catch (e) {
                  /* ignore */
                }
              } else ped.state = 'walk';
            }
          }
          continue; // bones are physics driven
        }
        if (ped.state === 'down') {
          ped.state = 'walk';
        } else {
          // dead without ragdoll (limit reached): animated death
          ped.root.position.copy(ped.pos);
          ped.char.update(dt, { speed: 0, grounded: true, dead: true });
          continue;
        }
      }
      if (ped.state === 'gettingUp') {
        ped.getUpClock -= dt;
        if (ped.getUpClock <= 0) {
          ped.getUp = null;
          ped.state = 'flee';
          ped.fleeT = rand(3, 6);
          ped.threat = { x: pp.x, z: pp.z };
          ped.scream = false;
          ped.nav = navFromPos(ped);
        }
      }

      // ---- delayed reactions to incidents
      if (
        ped.pending &&
        ped.state !== 'fight' &&
        ped.state !== 'cop' &&
        ped.state !== 'gettingUp'
      ) {
        ped.pending.t -= dt;
        if (ped.pending.t <= 0) {
          const pe = ped.pending;
          ped.pending = null;
          ped.threat = { x: pe.x, z: pe.z };
          ped.idleStyle = null;
          ped.leaveGroup = true;
          if (ped.towel) ped.towel.visible = false;
          if (pe.react === 'swimAway') {
            ped.swimDir = Math.atan2(ped.pos.x - pe.x, ped.pos.z - pe.z);
            ped.stateT = 20;
          } else if (pe.react === 'cower') {
            ped.state = 'cower';
            ped.stateT = rand(2.5, 5);
          } else if (pe.react === 'film') {
            ped.state = 'film';
            ped.stateT = rand(6, 12);
          } else if (pe.react === 'freeze') {
            ped.state = 'freeze';
            ped.stateT = rand(1.2, 3.5);
          } else if (pe.react === 'call911') {
            ped.state = 'call';
            ped.stateT = rand(5, 9);
            ped.callPe = pe;
            try {
              game.people?.say?.(ped, 'call911', {
                force: true,
                topic: pe.src === 'crash' ? 'crash' : pe.src === 'hit' ? 'fight' : 'shot',
              });
            } catch (e) {
              /* ignore */
            }
          } else if (pe.react === 'fight') {
            ped.state = 'fight';
            ped.stateT = rand(5, 9);
            ped.foughtBack = true;
            ped.hitCd = 0.8;
            ped.guard = true;
          } else if (pe.react === 'help' || pe.react === 'crowd') {
            const a = Math.random() * Math.PI * 2,
              rr = pe.react === 'help' ? 2.2 : rand(4, 7);
            ped.state = 'approach';
            ped.helper = pe.react === 'help';
            ped.stateT = 20;
            ped.target = new THREE.Vector3(
              pe.x + Math.sin(a) * rr,
              ped.pos.y,
              pe.z + Math.cos(a) * rr,
            );
            try {
              game.people?.say?.(ped, 'crash', { force: true });
            } catch (e) {
              /* ignore */
            }
          } else {
            ped.state = 'flee';
            ped.fleeT = rand(4, 8);
            ped.scream = Math.random() < 0.6;
            if (ped.scream) voice(ped, 'scream');
          }
        }
      }
      if (ped.leaveGroup) {
        ped.leaveGroup = false;
        if (ped.group) {
          ped.group.members = ped.group.members.filter((m) => m !== ped);
          ped.group = null;
        }
        if (ped.spot) {
          used.delete(ped.spot);
          ped.spot = null;
        }
        removeDog(ped);
        if (!ped.nav && ped.act !== 'swim') ped.nav = navFromPos(ped);
      }

      // ---- state machine
      switch (ped.state) {
        case 'flee': {
          ped.fleeT -= dt;
          ped.handsUp = ped.scream;
          const th = ped.threat || { x: pp.x, z: pp.z };
          const ax = ped.pos.x - th.x,
            az = ped.pos.z - th.z,
            al = Math.hypot(ax, az) || 1;
          if (ped.nav) {
            edgeAt(ped.nav.edge, ped.nav.s, _ep);
            const along = _ep.tx * ax + _ep.tz * az;
            if (Math.abs(along) > 0.2 * al) ped.nav.dir = along > 0 ? 1 : -1;
          } else
            (ped.target ||= new THREE.Vector3()).set(
              ped.pos.x + (ax / al) * 25,
              ped.pos.y,
              ped.pos.z + (az / al) * 25,
            );
          targetSpeed = 4.7;
          if (ped.fleeT <= 0) {
            ped.state = 'walk';
            ped.act = 'walk';
          }
          break;
        }
        case 'cower': {
          ped.stateT -= dt;
          ped.idleStyle = 'cower';
          if (ped.threat)
            ped.heading = approachAngle(
              ped.heading,
              Math.atan2(ped.threat.x - ped.pos.x, ped.threat.z - ped.pos.z),
              dt * 3,
            );
          if (ped.stateT <= 0) {
            ped.idleStyle = null;
            ped.state = 'flee';
            ped.fleeT = rand(3, 5);
            ped.scream = true;
          }
          break;
        }
        case 'film': {
          ped.stateT -= dt;
          ped.idleStyle = 'film';
          if (ped.threat) {
            ped.heading = approachAngle(
              ped.heading,
              Math.atan2(ped.threat.x - ped.pos.x, ped.threat.z - ped.pos.z),
              dt * 4,
            );
            lookAt = ped.threat;
          }
          if (ped.stateT <= 0) {
            ped.idleStyle = null;
            ped.state = 'walk';
            ped.act = 'walk';
          }
          break;
        }
        case 'fight': {
          ped.stateT -= dt;
          ped.hitCd -= dt;
          ped.guard = true;
          ped.heading = approachAngle(ped.heading, Math.atan2(-dpx, -dpz), dt * 8);
          lookAt = pp;
          if (dPlayer > 1.05 && dPlayer < 14 && !inCar) targetSpeed = dPlayer > 3 ? 3.4 : 1.3;
          if (dPlayer < 1.4 && ped.hitCd <= 0 && !inCar) {
            ped.punchNow = true;
            ped.hitCd = rand(0.7, 1.1);
            if (P.health !== undefined && Math.random() < 0.7)
              P.health = Math.max(0, P.health - 4 - Math.random() * 4);
          }
          if (ped.stateT <= 0 || dPlayer > 20 || inCar) {
            ped.state = 'walk';
            ped.act = 'walk';
            ped.guard = false;
          }
          break;
        }
        case 'cop': {
          const wanted = (P.wanted || 0) > 0 && !inCar;
          ped.guard = wanted && dPlayer < 4;
          ped.hitCd -= dt;
          if (wanted && dPlayer < 60) {
            ped.heading = approachAngle(ped.heading, Math.atan2(-dpx, -dpz), dt * 8);
            lookAt = pp;
            targetSpeed = dPlayer > 6 ? 5.2 : dPlayer > 1.2 ? 2.2 : 0;
            if (dPlayer < 1.4 && ped.hitCd <= 0) {
              ped.punchNow = true;
              ped.hitCd = rand(0.8, 1.2);
              if (P.health !== undefined) P.health = Math.max(0, P.health - 5);
            }
          } else targetSpeed = ped.walkSpeed * 0.8;
          break;
        }
        case 'convo': {
          // talking with the player (talk.js): face them, point when giving directions
          ped.stateT -= dt;
          ped.idleStyle = ped.speakT > 0 ? 'talk' : null;
          const tgt = ped.pointAt || pp;
          ped.heading = approachAngle(
            ped.heading,
            Math.atan2(tgt.x - ped.pos.x, tgt.z - ped.pos.z),
            dt * 4,
          );
          lookAt = pp;
          if (ped.stateT <= 0) {
            ped.state = 'walk';
            ped.act = 'walk';
            ped.idleStyle = null;
          }
          break;
        }
        case 'freeze': {
          // frozen in place, hands up, eyes on the danger
          ped.stateT -= dt;
          ped.handsUp = true;
          ped.idleStyle = null;
          if (ped.threat)
            ped.heading = approachAngle(
              ped.heading,
              Math.atan2(ped.threat.x - ped.pos.x, ped.threat.z - ped.pos.z),
              dt * 5,
            );
          if (ped.stateT <= 0) {
            ped.handsUp = false;
            ped.state = 'flee';
            ped.fleeT = rand(3, 6);
            ped.scream = Math.random() < 0.5;
          }
          break;
        }
        case 'call': {
          // on the phone to 911, turned away from the danger; reports when done
          ped.stateT -= dt;
          ped.idleStyle = 'phone';
          if (ped.threat)
            ped.heading = approachAngle(
              ped.heading,
              Math.atan2(ped.pos.x - ped.threat.x, ped.pos.z - ped.threat.z),
              dt * 2,
            );
          if (ped.stateT <= 0) {
            try {
              game.people?.callDone?.(
                ped,
                ped.callPe || { x: ped.pos.x, z: ped.pos.z, src: 'shot' },
              );
            } catch (e) {
              /* ignore */
            }
            ped.callPe = null;
            ped.idleStyle = null;
            ped.state = 'walk';
            ped.act = 'walk';
          }
          break;
        }
        case 'approach': {
          // walking over to a crash to help or to look
          ped.stateT -= dt;
          targetSpeed = ped.helper ? 3.2 : ped.walkSpeed * 1.1;
          if (
            !ped.target ||
            Math.hypot(ped.target.x - ped.pos.x, ped.target.z - ped.pos.z) < 1.4 ||
            ped.stateT <= 0
          ) {
            ped.state = 'watch';
            ped.stateT = rand(8, 16);
            ped.target = null;
            ped.idleStyle = ped.helper
              ? 'kneel'
              : ped.identity && ped.identity.phoneAddict > 0.5
                ? 'film'
                : 'talk';
          }
          break;
        }
        case 'watch': {
          ped.stateT -= dt;
          if (ped.threat) {
            ped.heading = approachAngle(
              ped.heading,
              Math.atan2(ped.threat.x - ped.pos.x, ped.threat.z - ped.pos.z),
              dt * 3,
            );
            lookAt = ped.threat;
          }
          if (ped.stateT <= 0) {
            ped.idleStyle = null;
            ped.state = 'walk';
            ped.act = 'walk';
            ped.helper = false;
          }
          break;
        }
        case 'gettingUp':
          break;
        case 'argue': {
          ped.argueT -= dt;
          lookAt = pp;
          ped.heading = approachAngle(ped.heading, Math.atan2(-dpx, -dpz), dt * 6);
          if (ped.shoveBack && dPlayer < 1.2) {
            ped.shoveBack = false;
            ped.punchNow = true;
            try {
              game.emit?.('pedShove', { ped, dir: new THREE.Vector3(-dpx, 0, -dpz).normalize() });
            } catch (e) {
              /* ignore */
            }
          }
          if (Math.random() < dt * 0.4) voice(ped, 'argue');
          if (ped.argueT <= 0 || dPlayer > 12) {
            ped.state = 'walk';
            ped.act = 'walk';
          }
          break;
        }
        case 'talk':
        case 'dance': {
          ped.stateT -= dt;
          ped.styleT -= dt;
          const G = ped.group;
          if (G && G.talk && ped.state === 'talk') {
            // r7-groups: one speaker at a time (talk gestures); the others listen, face the speaker, now and then check a phone
            const M = G.members,
              me = M.indexOf(ped);
            if (me === 0) {
              G.spkT -= dt;
              if (G.spkT <= 0 && M.length > 1) {
                G.spkT = rand(2.2, 6.5);
                G.spk = (G.spk + 1 + ((Math.random() * (M.length - 1)) | 0)) % M.length;
              }
            }
            const sp = M[G.spk % Math.max(1, M.length)];
            if (sp === ped || !sp) ped.idleStyle = 'talk';
            else if (ped.styleT <= 0) {
              ped.styleT = rand(4, 9);
              ped.idleStyle = ped.listenStyle && Math.random() < 0.6 ? ped.listenStyle : null;
            }
            const tx = sp && sp !== ped ? (G.center.x + sp.pos.x) * 0.5 : G.center.x,
              tz = sp && sp !== ped ? (G.center.z + sp.pos.z) * 0.5 : G.center.z;
            ped.heading = approachAngle(
              ped.heading,
              Math.atan2(tx - ped.pos.x, tz - ped.pos.z),
              dt * 1.6,
            );
            if (sp && sp !== ped && dPlayer >= 5) lookAt = sp.pos;
            // leaving together: the first to go takes the others along (one walks beside them, the rest go their own way)
            if (ped.stateT <= 0) {
              const lead = ped;
              for (let q = M.length - 1; q >= 0; q--) {
                const o = M[q];
                if (o === lead) continue;
                o.stateT = Math.min(o.stateT, rand(0.2, 1.6));
              }
              if (M.length === 2 || G.theme === 'family') {
                for (const o of M)
                  if (o !== lead && !o.follow && !lead.follow) {
                    o.pendFollow = lead;
                    break;
                  }
              }
            }
          } else if (ped.group)
            ped.heading = approachAngle(
              ped.heading,
              Math.atan2(ped.group.center.x - ped.pos.x, ped.group.center.z - ped.pos.z),
              dt * 2,
            );
          if (ped.state === 'talk' && !(G && G.talk) && ped.styleT <= 0) {
            ped.styleT = rand(2.5, 6);
            ped.idleStyle = Math.random() < 0.6 ? 'talk' : Math.random() < 0.35 ? 'phone' : null;
          }
          if (ped.stateT <= 0) {
            ped.leaveGroup = true;
            ped.state = 'walk';
            ped.act = 'walk';
            ped.idleStyle = null;
            const L2 = ped.pendFollow;
            ped.pendFollow = null;
            if (L2 && L2.active && L2.state === 'walk' && L2.nav) {
              ped.follow = L2;
              ped.nav = null;
              ped.walkSpeed = L2.walkSpeed;
              L2.pairId = ped.pairId = 'c' + pairN++;
              L2.nav.lane = Math.min(L2.nav.lane ?? 0.3, 0.3);
              L2.nav.laneMax = 0.35;
            }
          }
          if (dPlayer < 5 && !inCar) lookAt = pp;
          break;
        }
        case 'bench':
        case 'lean':
        case 'garden':
        case 'sunbathe':
        case 'volley':
        case 'wade': {
          ped.stateT -= dt;
          // r3-people: rain -> sunbathers and waders get up and leave within a few seconds
          if ((ped.state === 'sunbathe' || ped.state === 'wade') && ped.stateT > 6 && isRaining())
            ped.stateT = rand(0.5, 6);
          if (ped.state === 'wade') {
            ped.idleStyle = Math.random() < 0.002 ? 'talk' : ped.idleStyle;
          }
          if (ped.stateT <= 0 && ped.state !== 'volley') {
            // stand up and walk off (sit/stand transitions via style blending)
            if (ped.state === 'sunbathe' && ped.towel) {
              scene.remove(ped.towel);
            }
            if (ped.towel) {
              ped.towel.visible = false;
            }
            ped.leaveGroup = true;
            ped.idleStyle = null;
            ped.state = 'walk';
            ped.act = ped.zone === 'beach' ? 'shore' : 'walk';
          }
          if (dPlayer < 5 && !inCar && ped.state !== 'sunbathe') lookAt = pp;
          break;
        }
        case 'frisbee': {
          if (ped.group)
            ped.heading = approachAngle(
              ped.heading,
              Math.atan2(ped.group.center.x - ped.pos.x, ped.group.center.z - ped.pos.z),
              dt * 3,
            );
          break;
        }
        case 'swim': {
          ped.stateT -= dt;
          ped.idleStyle = 'swim';
          // r3-people (user: "people lying in the air, superman pose"): a swimmer never stays where there is no water under them
          if (
            !isWater(ped.pos.x, ped.pos.z) ||
            groundAt(ped.pos.x, ped.pos.z, -3) > seaLevel - 0.35
          ) {
            ped.despawnNow = true;
            break;
          }
          targetSpeed = 0.8;
          const nx = ped.pos.x + Math.sin(ped.swimDir) * 3,
            nz = ped.pos.z + Math.cos(ped.swimDir) * 3;
          if (!isWater(nx, nz) || seaLevel - groundAt(nx, nz, -3) < 1.0)
            ped.swimDir += Math.PI * rand(0.6, 1.4);
          ped.swimDir += (Math.random() - 0.5) * dt * 0.4;
          moveHeading = ped.swimDir;
          if (ped.stateT <= 0) {
            const sp = shorePoint(ped.pos, 60);
            if (sp) {
              despawn(ped);
              continue;
            }
            ped.stateT = 30;
          }
          break;
        }
        default: {
          // walk / jog / dog / shore
          ped.handsUp = false;
          // smart-peds safety net: a walker on a building footprint (pushed there, stale lane) leaves out of view, or
          // walks back to the nearest open sidewalk
          if (
            SMART &&
            ((frameN + ped.id) & 15) === 0 &&
            !ped.pinned &&
            inBuilding(ped.pos.x, ped.pos.z)
          ) {
            if (!inCamView(ped.pos.x, ped.pos.y, ped.pos.z)) ped.despawnNow = true;
            else {
              ped.nav = navFromPos(ped);
              ped.target = null;
            }
          }
          // npc-life: at a signalized corner, wait for the walk phase (impatient people sometimes go anyway)
          const nc = ped.nav?.cross;
          if (SMART && nc) {
            // smart-peds: wait at the curb for a clear road (and the walk phase at a light), then cross briskly
            if (
              crossWait(nc, ped.pos.x, ped.pos.z, dt, signals, ped.walkSpeed, ped.P?.jaywalk || 0)
            ) {
              ped.sigWaitT = 0.05;
              ped.heading = approachAngle(
                ped.heading,
                Math.atan2(nc.x - ped.pos.x, nc.z - ped.pos.z),
                dt * 3,
              );
            } else {
              ped.sigWaitT = 0;
            }
          } else if (nc && nc.node !== undefined && ped.act !== 'jog' && (nc.sig -= dt) <= 0) {
            nc.sig = 0.5;
            const ws = signals.walkState(nc.node, nc.x - ped.pos.x, nc.z - ped.pos.z);
            const bold = (ped.P?.jaywalk || 0) > 0.5 && Math.random() < 0.15;
            if (!ws || ws.walk || bold) {
              nc.node = undefined;
              ped.sigWaitT = 0;
            } else {
              ped.sigWaitT = 0.6;
            }
          }
          if (ped.sigWaitT > 0) {
            ped.sigWaitT -= dt;
            targetSpeed = 0;
            ped.speed *= Math.exp(-dt * 8);
            ped.idleStyle = ped.call ? 'phone' : null;
            break;
          }
          if (ped.waitT > 0) {
            ped.waitT -= dt;
            targetSpeed = 0;
            ped.idleStyle = ped.call ? 'phone' : null;
            break;
          } // waiting at the corner
          if (ped.pause > 0) {
            ped.pause -= dt;
            targetSpeed = 0;
            if (!ped.idleStyle && ped.pauseStyle) ped.idleStyle = ped.pauseStyle;
            if (ped.pause <= 0) ped.idleStyle = null;
          } else {
            // r6-walk: the pace breathes a little along the way; brisk across a street
            targetSpeed =
              ped.walkSpeed *
              (ped.act === 'jog' ? 1 : 1 + 0.07 * Math.sin(now * 0.23 + ped.id * 1.7)) *
              (ped.nav?.cross && ped.act !== 'jog' ? 1.25 : 1);
            ped.idleStyle = null;
            if (
              ped.act !== 'jog' &&
              !ped.follow &&
              !ped.nav?.path &&
              Math.random() < dt / (ped.P.pauseEvery || 45)
            ) {
              ped.pause = rand(4, 12);
              const ids = ped.P.idles;
              ped.pauseStyle =
                ped.identity?.smoker && Math.random() < 0.55
                  ? 'smoke'
                  : ids[(Math.random() * ids.length) | 0];
              if (ped.pauseStyle === 'smoke') ped.pause = rand(14, 30);
            } // r7: smokers stop for a cigarette
            // arrived at the shop window / bus stop it was heading for: stop and look, then pick the next place
            const dst = ped.nav?.dest;
            if (
              dst &&
              !ped.nav.path &&
              !ped.follow &&
              (frameN + ped.id) % 20 === 0 &&
              Math.hypot(dst.x - ped.pos.x, dst.z - ped.pos.z) < 9
            ) {
              ped.pause = dst.stop ? rand(9, 20) : rand(4, 9);
              ped.pauseStyle =
                dst.stop || Math.random() < 0.5
                  ? ped.P.idles.includes('phone')
                    ? 'phone'
                    : null
                  : null;
              ped.lookDest = dst;
              ped.nav.dest = pickDest(ped.pos);
            }
          }
          if (ped.pause > 0 && ped.lookDest)
            ped.heading = approachAngle(
              ped.heading,
              Math.atan2(ped.lookDest.x - ped.pos.x, ped.lookDest.z - ped.pos.z),
              dt * 2.5,
            );
          else if (ped.lookDest) ped.lookDest = null;
          // a couple: the companion keeps the leader's pace (catching up / easing off a little)
          if (ped.follow) {
            const Ld = ped.follow;
            if (
              !Ld.active ||
              Ld.dead ||
              Ld.state !== 'walk' ||
              Ld.follow ||
              Math.hypot(Ld.pos.x - ped.pos.x, Ld.pos.z - ped.pos.z) > 9
            ) {
              ped.follow = null;
              ped.pairId = 0;
              Ld.pairId = 0;
              ped.nav = navFromPos(ped);
            } else {
              const ah =
                (Ld.pos.x - ped.pos.x) * Math.sin(Ld.heading) +
                (Ld.pos.z - ped.pos.z) * Math.cos(Ld.heading);
              targetSpeed = Math.max(0, Ld.speed * (1 + Math.max(-0.3, Math.min(0.4, ah * 0.5))));
              ped.pause = 0;
              ped.idleStyle = Ld.speed < 0.1 ? Ld.idleStyle : null;
            }
          }
          // local avoidance (src/npc/walk.js): sidestep early inside the walker's own lane, slow down behind someone,
          // never step into anybody (steering only: nobody is pushed into a wall or the road)
          if (targetSpeed > 0) {
            const st = space.steer(
              ped._ag,
              ped.pos.x,
              ped.pos.z,
              Math.sin(ped.heading),
              Math.cos(ped.heading),
              ped.speed,
            );
            const cyS =
              ped.nav && ped.act === 'walk' ? carYield(ped, ped.nav, ped.pos.x, ped.pos.z, dt) : 0;
            if (cyS) targetSpeed *= ped._cySlow;
            if (ped.nav)
              ped.nav.steer =
                cyS ||
                st.side ||
                (ped.speed > 0.2
                  ? obstacleSteer(
                      game,
                      ped,
                      ped.pos.x,
                      ped.pos.y,
                      ped.pos.z,
                      Math.sin(ped.heading),
                      Math.cos(ped.heading),
                      dt,
                    )
                  : 0); // r7-walk: around trunks / poles
            // on the road mid-crossing nobody stops dead: ease past each other instead
            const onCross = SMART && !!ped.nav?.cross?.go;
            targetSpeed *= onCross ? Math.max(st.slow, 0.55) : st.slow;
            if (st.block && !onCross) {
              ped.speed = 0;
              ped.blockT = (ped.blockT || 0) + dt;
              if (ped.blockT > 4 && ped.nav && !ped.nav.path && !ped.follow) {
                ped.nav.dir *= -1;
                ped.nav.sbE = null;
                ped.blockT = 0;
              }
            } // a blocked narrow sidewalk: turn back
            else ped.blockT = 0;
          } else if (ped.nav) ped.nav.steer = 0;
          // impatient people cut across the street mid-block; honked-at people hurry
          // (only on quiet local streets: busy primary / secondary / tertiary / trunk roads are crossed at junctions only)
          if (
            ped.nav &&
            !ped.nav.cross &&
            ped.act === 'walk' &&
            ped.P.jaywalk &&
            /pedestrian|footway|path/.test(ped.nav.edge?.kind || '') &&
            !ped.nav.path &&
            !ped.follow &&
            Math.random() < (dt * ped.P.jaywalk) / 40
          ) {
            ped.nav.hand *= -1;
            ped.jaywalks = (ped.jaywalks || 0) + 1;
          }
          if (ped.walkBoostT > 0) {
            ped.walkBoostT -= dt;
            targetSpeed *= 1.6;
          }
          // step aside when the player walks into us; stumble when shoved by a sprinting player
          if (dPlayer < 1.15 && pSpeed > 0.6 && !inCar) {
            const approaching = (dpx * fwdX + dpz * fwdZ) / Math.max(dPlayer, 0.01) > 0.4;
            const sx = fwdZ,
              sz = -fwdX;
            const sgn = dpx * sx + dpz * sz >= 0 ? 1 : -1;
            if (pSpeed > 4 && dPlayer < 0.85) {
              ped.knock.set(fwdX * 3 + sx * sgn, 0, fwdZ * 3 + sz * sgn);
              ped.hitNow = true;
              ped.shoveT = 0.5;
              const sh = ped.P.shove;
              if (sh === 'shove' || sh === 'argue') {
                ped.state = 'argue';
                ped.argueT = rand(3, 6);
                ped.shoveBack = sh === 'shove';
                voice(ped, sh === 'shove' ? 'insult' : 'argue');
              } else if (sh === 'flee') {
                ped.state = 'flee';
                ped.fleeT = rand(2, 4);
                ped.threat = { x: pp.x, z: pp.z };
                ped.scream = true;
                voice(ped, 'scream');
              } else if (sh === 'apologise') {
                voice(ped, 'apologise');
              } else {
                ped.state = 'flee';
                ped.fleeT = rand(1, 2);
                ped.threat = { x: pp.x, z: pp.z };
                ped.scream = false;
              }
            } else if (approaching) {
              ped.asideT = ped.P.shove === 'shove' ? 0.25 : 0.7;
              ped.asideDir = { x: sx * sgn, z: sz * sgn };
              ped.pause = 0;
              if (ped.P.shove === 'shove' && Math.random() < 0.3) voice(ped, 'insult');
            }
          }
          // personality look-at + greeting
          if (dPlayer < ped.P.look && !inCar) {
            ped.lookT += dt;
            if (ped.lookT < ped.P.lookHold + 2) lookAt = pp;
          } else ped.lookT = 0;
          const dd =
            !ped.greeted && dPlayer < 9 && !inCar && ped.identity
              ? deeds.get(ped.identity.id)
              : null;
          if (dd && (dd.hurt || dd.threat)) {
            // r7-react: they remember him: back off and hurry away (tough ones mouth off first)
            ped.greeted = true;
            if (ped.P.shove === 'shove' && Math.random() < 0.5) {
              voice(ped, 'insult');
              ped.asideT = 0.6;
              ped.asideDir = { x: dpx / Math.max(dPlayer, 0.1), z: dpz / Math.max(dPlayer, 0.1) };
            } else {
              ped.state = 'flee';
              ped.fleeT = rand(3, 5);
              ped.threat = { x: pp.x, z: pp.z };
              ped.scream = false;
              voice(ped, 'scream');
            }
          } else if (dd && dd.helped) {
            ped.greeted = true;
            ped.waveT = 1.4;
            voice(ped, 'greet');
          }
          if (!ped.greeted && dPlayer < 3.5 && !inCar && Math.random() < ped.P.greet * dt * 2) {
            ped.greeted = true;
            ped.waveT = 1.4;
            voice(ped, ped.personality === 'drunk' ? 'drunk' : 'greet');
          }
        }
      }
      if (ped.waveT > 0) ped.waveT -= dt;
      if (ped.lookUntil && now < ped.lookUntil) lookAt = lookAt || pp;

      // ---- integrate
      const accel = ped.state === 'flee' ? 7 : 3;
      ped.speed += (targetSpeed - ped.speed) * Math.min(1, dt * accel);
      if (ped.shoveT > 0 || ped.knock.lengthSq() > 0.01) {
        ped.shoveT -= dt;
        ped.pos.x += ped.knock.x * dt;
        ped.pos.z += ped.knock.z * dt;
        ped.knock.multiplyScalar(Math.exp(-dt * 3.5));
      }
      if (ped.asideT > 0) {
        ped.asideT -= dt;
        ped.pos.x += ped.asideDir.x * 1.3 * dt;
        ped.pos.z += ped.asideDir.z * 1.3 * dt;
      }
      const moving = ped.speed > 0.02 && !NONMOVING.has(ped.state);
      if (moving) {
        if (ped.state === 'fight' || (ped.state === 'cop' && (P.wanted || 0) > 0)) {
          const hd = ped.heading + (ped.detourT > 0 ? ped.detourA : 0);
          if (ped.detourT > 0) ped.detourT -= dt;
          ped.pos.x += Math.sin(hd) * ped.speed * dt;
          ped.pos.z += Math.cos(hd) * ped.speed * dt;
        } else if (ped.state === 'swim') {
          ped.pos.x += Math.sin(ped.swimDir) * ped.speed * dt;
          ped.pos.z += Math.cos(ped.swimDir) * ped.speed * dt;
          ped.heading = approachAngle(ped.heading, ped.swimDir, dt * 2);
        } else {
          moveHeading =
            ped.follow && ped.state === 'walk'
              ? followStep(ped, dt)
              : ped.nav && ped.act !== 'shore' && ped.state !== 'approach'
                ? navStep(ped, dt, ped.speed)
                : freeStep(ped, dt, ped.speed);
          ped.heading = approachAngle(
            ped.heading,
            moveHeading + (ped.P.sway ? Math.sin(now * 1.3 + ped.id) * ped.P.sway : 0),
            dt * (ped.state === 'flee' ? 9 : 4.5),
          );
        }
      }

      // ---- collide & slide (Rapier KCC) on loaded tiles; otherwise follow the ground height
      const groundOK = collidersReady(ped.pos.x, ped.pos.z);
      let kccOk = false;
      // wall checks: every frame close to the player (no clipping where it can be seen), every third frame to 25 m
      const kccTurn = dPlayer < 10 || (dPlayer < 25 && (frameN + ped.id) % 3 === 0);
      // r7-groups (user: "glitching up and down"): people standing still are not run through the character controller;
      // its 0.12 m snap-down plus the neighbors' and the player's capsules bumped them up and down every frame. They hold
      // the ground height (re-read now and then, eased, with a 3 cm dead band).
      const standing =
        !moving &&
        NONMOVING.has(ped.state) &&
        !(ped.asideT > 0) &&
        ped.state !== 'gettingUp' &&
        !ped.knock.lengthSq();
      if (standing && ped.state !== 'swim' && ped.state !== 'wade' && !ped.v21) {
        if (ped.gy === undefined || ((frameN + ped.id) & 15) === 0)
          ped.gy = groundAt(ped.pos.x, ped.pos.z, ped.pos.y);
        const dy = ped.gy - ped.pos.y;
        if (Math.abs(dy) > 0.6) ped.pos.y = ped.gy;
        else if (Math.abs(dy) > 0.03) ped.pos.y += dy * Math.min(1, dt * 4);
        kccOk = true;
      } else if (
        kccTurn &&
        kcc &&
        ped.collider &&
        ped.collider.isEnabled?.() !== false &&
        ped.state !== 'swim' &&
        ped.state !== 'wade' &&
        !ped.teleported &&
        groundOK
      ) {
        try {
          const base = ped.collider.translation();
          const want = { x: ped.pos.x - base.x, y: -0.12, z: ped.pos.z - base.z };
          const wl = Math.hypot(want.x, want.z);
          if (wl < 3) {
            kcc.computeColliderMovement(ped.collider, want);
            let mv = kcc.computedMovement();
            // r3-people2: blocked by a step (curb) taller than the autostep: probe from 0.5 m higher and take it if that gets further (snap-to-ground brings the walker down on the far side)
            if (moving && wl > 0.004 && Math.hypot(mv.x, mv.z) < wl * 0.35) {
              try {
                kcc.computeColliderMovement(ped.collider, { x: want.x, y: 0.5, z: want.z });
                const m2 = kcc.computedMovement();
                if (Math.hypot(m2.x, m2.z) > Math.hypot(mv.x, mv.z) * 2 + 0.002 && m2.y < 0.52) {
                  kcc.computeColliderMovement(ped.collider, { x: m2.x, y: -0.5, z: m2.z });
                  const m3 = kcc.computedMovement();
                  mv = { x: m3.x, y: m2.y + m3.y, z: m3.z };
                }
              } catch (e) {
                /* ignore */
              }
            }
            ped.pos.set(base.x + mv.x, base.y + mv.y - 0.9, base.z + mv.z);
            kccOk = true;
            const got = Math.hypot(mv.x, mv.z);
            if (wl > 0.004 && got < wl * 0.35 && moving) {
              ped.stuckT = (ped.stuckT || 0) + dt;
              if (ped.stuckT > 0.7) {
                ped.stuckT = 0;
                if (ped.state === 'fight' || ped.state === 'cop' || ped.state === 'flee') {
                  ped.detourT = rand(0.6, 1.1);
                  ped.detourA = (Math.random() < 0.5 ? -1 : 1) * rand(0.9, 1.4);
                }
                if (ped.nav && !(SMART && ped.nav.path)) {
                  ped.nav.dir *= -1;
                  ped.nav.cross = null;
                  ped.nav.jit = rand(-0.5, 1.0);
                }
                ped.target = null;
              }
            } else ped.stuckT = 0;
          }
        } catch (e) {
          kccOk = false;
        }
      }
      ped.teleported = false;
      if (ped.v21 && ped.v21.y !== undefined) {
        ped.pos.y = ped.v21.y;
        ped.gy = ped.v21.y;
      } // r3-people2: shop / bar staff and guests stand on the interior floor (a man floated near the counter)
      if (!kccOk) {
        if (ped.state === 'swim')
          ped.pos.y =
            seaLevel -
            0.05 +
            (game.waves?.shaderOn ? game.waves.heightAt(ped.pos.x, ped.pos.z) : 0); // r2-water: swimmers ride the drawn swell
        else {
          if (ped.gy === undefined || ((frameN + ped.id) & 3) === 0)
            ped.gy = groundAt(ped.pos.x, ped.pos.z, ped.pos.y);
          if (dPlayer >= 25 || ped.teleported)
            ped.pos.y += (ped.gy - ped.pos.y) * Math.min(1, dt * 10);
        }
      }
      if (ped.body && ped.collider?.isEnabled?.() !== false) {
        try {
          ped.body.setNextKinematicTranslation({ x: ped.pos.x, y: ped.pos.y + 0.9, z: ped.pos.z });
        } catch (e) {
          /* ignore */
        }
      }

      // ---- visuals
      const root = ped.root;
      root.position.copy(ped.pos);
      root.rotation.y = ped.heading;
      if (ped.dog) updateDog(ped, dt);
      const dCam = Math.hypot(ped.pos.x - cam.x, ped.pos.z - cam.z);
      root.visible = dCam < 190;
      const punch = !!ped.punchNow;
      ped.punchNow = false;
      const hit = !!ped.hitNow;
      ped.hitNow = false;
      const thr = !!ped.throwNow;
      ped.throwNow = false;
      if (!root.visible) continue;
      _sph.center.set(ped.pos.x, ped.pos.y + 1, ped.pos.z);
      const inView = !camO || _frustum.intersectsSphere(_sph);
      // in view: animate every frame up to 60 m, every other frame beyond (skipping more made walks look choppy and
      // "stubbly" at a distance); off screen: rarely
      ped.char.setLOD?.(!inView ? 30 : dCam < 60 ? 1 : 2);
      const swimming = ped.state === 'swim';
      ped.char.update(dt, {
        speed: swimming ? 0 : ped.speed,
        grounded: true,
        jumping: false,
        sprint: ped.state === 'flee',
        driving: false,
        punch,
        dead: false,
        idleStyle: swimming
          ? 'swim'
          : ped.speed < 0.4 || ['cower', 'film'].includes(ped.state)
            ? ped.idleStyle
            : null,
        handsUp: ped.handsUp || ped.shoveT > 0.2,
        guard: ped.state === 'fight',
        lookAt: dCam < 40 ? lookAt : null,
        call: ped.call && (ped.state === 'walk' || ped.state === 'bench' || ped.state === 'lean'),
        wave: ped.waveT > 0,
        argue: ped.state === 'argue',
        leash: !!ped.dog,
        hit,
        throw: thr,
        getUp: ped.getUp || null,
      });
      // seated on the real bench / chair / sofa under them (src/npc/furnitureSeat.js): probed cushion, natural variants, life
      if (ped.state === 'bench' && !(ped.speed > 0.4) && dCam < 60) {
        try {
          sitOnFurniture(game, ped, dt);
        } catch (e) {
          /* keep the clip pose */
        }
      } else if (ped._furn) standUp(ped);
      if (ped.state === 'sunbathe' && dCam < 80) {
        try {
          restOnTowel(ped, (x, z) => groundAt(x, z, ped.pos.y + 1));
        } catch (e) {
          /* keep the clip pose */
        }
      } else if (ped.state !== 'sunbathe' && ped.towel?.userData.contact)
        clearTowelContact(ped.towel);
    }
  }

  return {
    list,
    update,
    groundSnap: true, // physics-audit: groundAt snaps to the collider top (tools/v2/physics/phantomsPage.js reads it)
    panic,
    damage,
    spawnAt,
    _umbrella: makeUmbrella,
    _removeProp: removeProp,
    _nav: {
      navFromPos,
      navStep,
      sidewalkNear,
      sandPoint,
      groundAt,
      zoneAt,
      spotOK,
      inCamView,
      laneRoom,
      space,
      inBuilding,
      bld,
      sideOpen,
    },
    groups,
    groupStats,
    clearWhy,
    deeds,
    remember,
    _sunbathers: (c, n) => sunbathers(c, n),
    _crowd: (c, zone, n) => crowd(c, zone, n, false),
    get count() {
      return list.filter((p) => p.active).length;
    },
  };
}
