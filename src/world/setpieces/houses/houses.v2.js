// Houses in the world (track: houses). Generated houses on residential lots, streamed with importance LOD:
//   near (< 55 m): full-detail build per lot (real geometry: boards, sashes, shutters, rails, tiles, clutter)
//   mid  (cluster within 230 m): every lot of a cluster merged into one mesh per material (lod 1)
//   far  (beyond): merged shells (lod 2) with lit window cards
// A lot whose near build is up is masked out of the merged meshes (lot-hide texture, see materials.js).
// Lots: the Keys spawn street (placed by world-dressing through the lot API, lots.js) and every claimed map house
// footprint (lots.claims) in the city tiles the streamer has at full detail. Colliders within 90 m of the player.
// API: game.houses = { stats(), clusters, lots (the lot API), rebuild() }; game.lots = lot API.
import * as THREE from 'three';
import { createHouseKit } from './materials.js';
import { planHouse, buildHouse, buildHouseGen } from './generator.js';
import { lots } from './lots.js';
import { lotProps } from '../../props/lotProps.v2.js';
import { occupancy } from '../../ground/occupancy.js';
import { surfaceMask } from '../../ground/surfaceMask.js';
// clipping sweep: yard palms / trees never inside a map building footprint or through a pole / another trunk (shared index)
const CLIP_OFF = typeof location !== 'undefined' && /[?&]clipfix=0/.test(location.search);
const TALLV = {
  coconut: [0.3, 9, 2.6],
  sabal: [0.3, 8, 2.4],
  royal: [0.35, 12, 2.6],
  liveoak: [0.35, 9, 3.2],
  gumbo: [0.35, 8, 3],
  seagrape: [0.25, 4, 2],
};

export const order = 75; // after world-dressing (70), which registers the spawn-street lots

const NEAR_IN = 40,
  NEAR_OUT = 50,
  MID_R = 230,
  COL_IN = 90,
  COL_OUT = 120,
  MAP_R = 420;

export async function initV2(game) {
  const { scene, world, RAPIER } = game;
  game.lots = lots;
  if (!lots.enabled) return;
  const hk = createHouseKit(THREE, { shareTex: game.nicoHouse?.house?.kit?.tex });
  // crushed-shell drives go into the terrain's drive mask (ragged blended edge) instead of a hard-edged slab
  let GM = null;
  try {
    GM = surfaceMask();
  } catch (e) {
    GM = null;
  }
  hk.groundDrive = !!(GM && !GM.off && GM.addDrive);
  const drivesDone = new Set();
  function lotDrive(L, dv) {
    if (!dv || !GM || drivesDone.has(L.lotKey)) return;
    const c = Math.cos(L.ry),
      s = Math.sin(L.ry);
    if (GM.addDrive(L.x + c * dv.x + s * dv.z, L.z - s * dv.x + c * dv.z, L.ry, dv.w, dv.len))
      drivesDone.add(L.lotKey);
  }
  const root = new THREE.Group();
  root.name = 'houses';
  scene.add(root);
  game.shaderWarmWrap?.(root); // perf: new LOD groups wait (hidden) for a not-yet-linked shader instead of stalling a frame
  const hm = hk.mat,
    noCast = new Set([
      hm.concrete(),
      hm.metalPaint(),
      hm.plastic(),
      hm.houseWindow(),
      hm.digits(),
      hm.chainlink(),
      hm.screen(),
      hm.poolWater(),
    ]);
  const D = game.miamiData,
    city = game.city;
  const TH = (x, z) => (D?.terrainHeightAt ? D.terrainHeightAt(x, z) : 0);
  const stats = {
    lots: 0,
    clusters: 0,
    near: 0,
    mid: 0,
    far: 0,
    cols: 0,
    buildMs: 0,
    maxNearMs: 0,
    nearBuilt: 0,
    tris: { near: 0, mid: 0, far: 0 },
  };

  // ---------- lot ids (1..4095, recycled) for the hide mask ----------
  const freeIds = [];
  let nextId = 1;
  const takeId = () => freeIds.pop() ?? (nextId < hk.lotMask.size ? nextId++ : 0);
  const dropId = (id) => {
    if (id > 0) {
      hk.lotMask.set(id, false);
      freeIds.push(id);
    }
  };

  // ---------- merge per-lot batch buckets into one mesh per material ----------
  // entries: [{ L, b (Map material -> bucket in house-local coords) }]; ox, oz: mesh origin; hide: per-vertex lot id for the mask
  function mergeBuckets(entries, ox, oz, name, hide, cast) {
    const g = mergeBucketsGen(entries, ox, oz, name, hide, cast);
    let r = g.next();
    while (!r.done) r = g.next();
    return r.value;
  }
  function* mergeBucketsGen(entries, ox, oz, name, hide, cast) {
    const tot = new Map();
    for (const { b } of entries)
      for (const [m, k] of b)
        if (k.n) {
          const t = tot.get(m) || { v: 0, i: 0 };
          t.v += k.n;
          t.i += k.idx.length;
          tot.set(m, t);
        }
    const g = new THREE.Group();
    g.position.set(ox, 0, oz);
    let tris = 0;
    for (const [m, t] of tot) {
      const pos = new Float32Array(t.v * 3),
        nor = new Float32Array(t.v * 3),
        uv = new Float32Array(t.v * 2),
        col = new Float32Array(t.v * 3),
        wear = new Float32Array(t.v),
        lot = hide ? new Float32Array(t.v) : null;
      const idx = t.v > 65535 ? new Uint32Array(t.i) : new Uint16Array(t.i);
      let vo = 0,
        io = 0;
      for (const { L, b } of entries) {
        const k = b.get(m);
        if (!k || !k.n) continue;
        const c = Math.cos(L.ry),
          s = Math.sin(L.ry),
          dx = L.x - ox,
          dz = L.z - oz,
          y0 = L.y;
        for (let i = 0; i < k.n; i++) {
          const x = k.pos[i * 3],
            z = k.pos[i * 3 + 2],
            j = (vo + i) * 3;
          pos[j] = dx + c * x + s * z;
          pos[j + 1] = y0 + k.pos[i * 3 + 1];
          pos[j + 2] = dz - s * x + c * z;
          const nx = k.nor[i * 3],
            nz = k.nor[i * 3 + 2];
          nor[j] = c * nx + s * nz;
          nor[j + 1] = k.nor[i * 3 + 1];
          nor[j + 2] = -s * nx + c * nz;
        }
        uv.set(k.uv, vo * 2);
        col.set(k.col, vo * 3);
        wear.set(k.wear, vo);
        if (lot) lot.fill(L.id, vo, vo + k.n);
        for (let i = 0; i < k.idx.length; i++) idx[io + i] = k.idx[i] + vo;
        vo += k.n;
        io += k.idx.length;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      geo.setAttribute('aWear', new THREE.BufferAttribute(wear, 1));
      if (lot) geo.setAttribute('aLot', new THREE.BufferAttribute(lot, 1));
      geo.setIndex(new THREE.BufferAttribute(idx, 1));
      geo.computeBoundingSphere();
      const mesh = new THREE.Mesh(geo, hk.hideHook(m));
      mesh.name = `houses:${name}:${m.name}`;
      mesh.castShadow = cast && !m.transparent && !noCast.has(m);
      mesh.receiveShadow = true;
      if (hide) mesh.customDepthMaterial = hk.hideDepth;
      if (m.transparent) mesh.renderOrder = 2;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      g.add(mesh);
      tris += t.i / 3;
      yield;
    }
    g.userData.tris = tris;
    return g;
  }
  const okLot = (L) =>
    Number.isFinite(L.x) &&
    Number.isFinite(L.z) &&
    Number.isFinite(L.y) &&
    Number.isFinite(L.ry) &&
    Number.isFinite(L.sp.w) &&
    Number.isFinite(L.sp.d);
  // ---------- build cache (perf, Nov 18): every house is generated at most once per LOD ----------
  // The generator collects geometry in plain JS arrays (about 1.7 GB of garbage per test run when lots were rebuilt each time
  // a tile or a near lot came back). Results are packed into typed arrays once and kept in an LRU (by bytes), keyed by lot.
  const CACHE_MAX = 160e6,
    cache = new Map();
  let cacheBytes = 0;
  function pack(res) {
    const b = new Map();
    let bytes = 0;
    for (const [m, k] of res.batch.b) {
      if (!k.n) continue;
      const q = {
        n: k.n,
        pos: new Float32Array(k.pos),
        nor: new Float32Array(k.nor),
        uv: new Float32Array(k.uv),
        col: new Float32Array(k.col),
        wear: new Float32Array(k.wear),
        idx: k.n > 65535 ? new Uint32Array(k.idx) : new Uint16Array(k.idx),
      };
      bytes += k.n * 48 + q.idx.byteLength;
      b.set(m, q);
    }
    return {
      batch: { b },
      colliders: res.colliders,
      lamps: res.lamps,
      plants: res.plants || [],
      cars: res.cars || [],
      curb: res.curb || [],
      drive: res.drive || null,
      bytes,
    };
  }
  function cacheGet(key) {
    const e = cache.get(key);
    if (e) {
      cache.delete(key);
      cache.set(key, e);
      stats.cacheHits = (stats.cacheHits || 0) + 1;
    }
    return e;
  }
  function cachePut(key, e) {
    const old = cache.get(key);
    if (old) {
      cacheBytes -= old.bytes;
      cache.delete(key);
    }
    cache.set(key, e);
    cacheBytes += e.bytes;
    for (const [k, v] of cache) {
      if (cacheBytes <= CACHE_MAX) break;
      if (v.pinned) continue;
      cache.delete(k);
      cacheBytes -= v.bytes;
    }
    stats.cacheMB = Math.round(cacheBytes / 1e6);
  }
  const ckey = (L, lod) => L.lotKey + '|' + lod;
  function buildCached(L, lod) {
    const k = ckey(L, lod);
    let e = cacheGet(k);
    if (!e) {
      e = pack(buildHouse(hk, L.sp, lod));
      cachePut(k, e);
      stats.builds = (stats.builds || 0) + 1;
    }
    return e;
  }
  // r8 (user: mailbox through the stairs, cars boxed in, van on a pole): every house's solid parts (walls, deck, stairs, posts,
  // piles) go into the shared occupancy index, so lot props, parked cars and any later placer (game.placement.spotOk) keep out
  function lotOccupancy(L, cols, owner) {
    if (!cols || CLIP_OFF) return;
    const c0 = Math.cos(L.ry),
      s0 = Math.sin(L.ry);
    for (const q of cols) {
      try {
        const lx = q.p[0],
          lz = q.p[2],
          wx = L.x + c0 * lx + s0 * lz,
          wz = L.z - s0 * lx + c0 * lz;
        if (q.shape === 'cyl') {
          occupancy.add({
            x: wx,
            z: wz,
            r: q.r,
            y: L.y + q.p[1] - q.hh,
            h: q.hh * 2,
            kind: 'house',
            src: 'houses.v2.js:pile',
            owner,
            audit: false,
          });
          continue;
        }
        const rx = q.rx || 0,
          ca = Math.abs(Math.cos(rx)),
          sa = Math.abs(Math.sin(rx)),
          hx = q.h[0],
          hz = q.h[2] * ca + q.h[1] * sa,
          hy = q.h[1] * ca + q.h[2] * sa;
        const rr = Math.max(0.08, Math.min(hx, hz, 1.2)),
          a = L.ry + (q.ry || 0),
          ca2 = Math.cos(a),
          sa2 = Math.sin(a);
        const nu = Math.max(1, Math.ceil((2 * hx - 2 * rr) / (rr * 1.5)) + 1),
          nv = Math.max(1, Math.ceil((2 * hz - 2 * rr) / (rr * 1.5)) + 1);
        for (let i = 0; i < nu; i++)
          for (let j = 0; j < nv; j++) {
            const u = nu > 1 ? -hx + rr + ((2 * hx - 2 * rr) * i) / (nu - 1) : 0,
              v = nv > 1 ? -hz + rr + ((2 * hz - 2 * rr) * j) / (nv - 1) : 0;
            occupancy.add({
              x: wx + ca2 * u + sa2 * v,
              z: wz - sa2 * u + ca2 * v,
              r: rr,
              y: L.y + q.p[1] - hy,
              h: hy * 2,
              kind: q.ramp ? 'stairs' : 'house',
              src: 'houses.v2.js:lot',
              owner,
              audit: false,
            });
          }
      } catch (e) {
        /* skip a bad descriptor */
      }
    }
  }
  // r8: a deck stair comes down on the side away from the driveway, unless its foot would land on a road or in water there
  function stairSide(L) {
    const sp = L.sp;
    if (!sp.stilt || sp.porch?.kind !== 'deck' || sp.stairSide !== undefined) return;
    const PL = game.placement,
      c = Math.cos(L.ry),
      s = Math.sin(L.ry),
      n = Math.ceil(sp.base / 0.19),
      zf = sp.d / 2 + sp.porch.d + 0.27 * n + 0.6;
    const bad = (side) => {
      const lx = side * (sp.w / 2 - 0.65);
      for (const dz of [0, -1.5])
        for (const dx of [-0.7, 0.7]) {
          const x = L.x + c * (lx + dx) + s * (zf + dz),
            z = L.z - s * (lx + dx) + c * (zf + dz);
          if (
            PL?.onRoad?.(x, z, 0.3) ||
            PL?.inWater?.(x, z) ||
            /asphalt|concrete|parking|water/.test(String(D?.surfaceAt?.(x, z) || ''))
          )
            return true;
        }
      return false;
    }; // surfaceAt also sees cul-de-sac bulbs / aprons
    const pref = sp.drvU > 0 ? -1 : 1;
    sp.stairSide = !bad(pref) ? pref : !bad(-pref) ? -pref : pref;
  }
  function* mergeClusterGen(cl, lod) {
    const entries = [];
    for (const L of cl.lots) {
      if (!okLot(L)) {
        L.bad = true;
        continue;
      }
      stairSide(L);
      const res = buildCached(L, lod);
      lotDrive(L, res.drive);
      if (lod === 1) {
        lotOccupancy(L, res.colliders, 'houses:' + cl.key);
        try {
          lotProps.revalidate?.(L.x, L.z, 22);
        } catch (e) {
          /* */
        }
      }
      if (lod === 1) {
        const c = Math.cos(L.ry),
          s = Math.sin(L.ry);
        L.colliders = res.colliders;
        for (const p of res.plants)
          (cl.plants[p.kind] ||= []).push({
            x: L.x + c * p.x + s * p.z,
            y: L.y,
            z: L.z - s * p.x + c * p.z,
            ry: (p.x * 7 + p.z * 3) % 6.28,
            s: p.s,
          });
        if (res.curb && res.curb.length) {
          const W = (q) => ({
            x: L.x + c * q.x + s * q.z,
            y: L.y,
            z: L.z - s * q.x + c * q.z,
            ry: L.ry,
          }); // props pass: library mailbox + carts (src/world/props/lotProps.v2.js)
          lotProps.add(
            'house:' + L.lotKey,
            res.curb.map((q) => ({
              kind: q.kind,
              ...W(q),
              seed: (L.sp.seed || 1) + q.x * 13,
              side: q.side ? W(q.side) : undefined,
            })),
          );
        }
      }
      entries.push({ L, b: res.batch.b });
      yield;
    }
    return mergeBuckets(entries, cl.ox, cl.oz, cl.key + ':' + lod, true, lod === 1);
  }

  // ---------- jobs: spread over frames (about 3 ms a frame) ----------
  const jobs = [];
  function runJobs(budget) {
    const t0 = performance.now();
    while (jobs.length && performance.now() - t0 < budget) {
      const j = jobs[0];
      let r;
      const ts = performance.now();
      try {
        r = j.next();
        stats.maxStepMs = Math.max(stats.maxStepMs || 0, performance.now() - ts);
      } catch (e) {
        console.error('[houses] job failed', e);
        r = { done: true };
        if (j === nearJob) {
          if (nearBusy) nearBusy.bad = true;
          nearBusy = null;
        }
      }
      if (r.done) jobs.shift();
    }
  }
  let nearJob = null;

  // ---------- clusters ----------
  const clusters = new Map(),
    clList = [];
  function addCluster(key, list, opts = {}) {
    if (!list.length) return null;
    let ox = 0,
      oz = 0;
    for (const L of list) {
      ox += L.x;
      oz += L.z;
    }
    ox /= list.length;
    oz /= list.length;
    let r = 0;
    for (const L of list) r = Math.max(r, Math.hypot(L.x - ox, L.z - oz) + 14);
    const cl = {
      key,
      lots: list,
      ox,
      oz,
      r,
      mid: null,
      far: null,
      tile: opts.tile ?? null,
      always: !!opts.always,
      plants: {},
      fields: [],
      ready: false,
    };
    for (const L of list) {
      L.id = takeId();
      L.cl = cl;
      L.nearData = null;
      L.col = null;
      L.lampIds = null;
    }
    clusters.set(key, cl);
    clList.push(cl);
    stats.lots += list.length;
    stats.clusters++;
    const job = (function* () {
      const t0 = performance.now();
      cl.mid = yield* mergeClusterGen(cl, 1);
      cl.far = yield* mergeClusterGen(cl, 2);
      if (cl.dead) {
        for (const g of [cl.mid, cl.far]) g.traverse((o) => o.geometry?.dispose());
        return;
      }
      root.add(cl.mid, cl.far);
      cl.ready = true;
      // yard planting: one instanced vegetation field per kind and cluster (the vegetation system's own LODs and impostors)
      if (!CLIP_OFF)
        for (const kind of Object.keys(cl.plants)) {
          const T = TALLV[kind];
          if (!T) continue;
          const D = game.miamiData,
            TS = game.city?.streamer?.tileSize || 200;
          const inBld = (x, z, r) => {
            for (const [dx, dz] of [
              [0, 0],
              [r, 0],
              [-r, 0],
              [0, r],
              [0, -r],
            ]) {
              const px = x + dx,
                pz = z + dz,
                tile = D?.getTile?.(Math.floor(px / TS), Math.floor(pz / TS));
              for (const b of (tile && tile.buildings) || []) {
                const ring = b.rings && b.rings[0];
                if (!ring) continue;
                let c = false;
                for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
                  const [xi, zi] = ring[i],
                    [xj, zj] = ring[j];
                  if (zi > pz !== zj > pz && px < ((xj - xi) * (pz - zi)) / (zj - zi) + xi) c = !c;
                }
                if (c) return true;
              }
            }
            return false;
          };
          cl.plants[kind] = cl.plants[kind].filter((it) => {
            const sc = it.s || 1,
              o = {
                y: it.y || 0,
                h: T[1] * sc,
                gap: 0.1,
                crown: { r: T[2] * sc * 0.8, y0: (it.y || 0) + T[1] * sc * 0.55 },
              };
            if (inBld(it.x, it.z, T[0] * sc + 0.3) || occupancy.blocked(it.x, it.z, T[0] * sc, o))
              return false;
            occupancy.add({
              x: it.x,
              z: it.z,
              r: T[0] * sc,
              y: o.y,
              h: o.h,
              kind: 'palm',
              src: 'houses.v2.js:yard plants',
              crown: o.crown,
              owner: 'houses:' + cl.key,
              audit: false,
            });
            return true;
          });
        }
      if (game.vegetation?.field)
        for (const [kind, items] of Object.entries(cl.plants)) {
          yield;
          try {
            cl.fields.push(
              game.vegetation.field(kind, items, { variants: 2, seed: 7, parent: root }),
            );
          } catch (e) {
            console.warn('[houses] plants', kind, e);
          }
        }
      stats.buildMs += performance.now() - t0;
    })();
    if (opts.sync) {
      let r = job.next();
      while (!r.done) r = job.next();
    } else jobs.push(job);
    return cl;
  }
  function removeCluster(cl) {
    cl.dead = true;
    occupancy.removeOwner('houses:' + cl.key);
    for (const L of cl.lots) {
      dropNear(L);
      dropCols(L);
      lots.remove(L.lotKey);
      dropId(L.id);
      lotProps.remove('house:' + L.lotKey);
    }
    for (const g of [cl.mid, cl.far]) {
      if (!g) continue;
      g.traverse((o) => o.geometry?.dispose());
      g.removeFromParent();
    }
    for (const f of cl.fields) {
      try {
        f.remove();
      } catch (e) {
        /* */
      }
    }
    clusters.delete(cl.key);
    {
      const i = clList.indexOf(cl);
      if (i >= 0) clList.splice(i, 1);
    }
    stats.lots -= cl.lots.length;
    stats.clusters--;
    nearDirty = true;
  }

  // ---------- full detail: built over frames, all near lots merged per material into one group ----------
  let nearBusy = null,
    nearDirty = false,
    nearGroup = null,
    nearShown = new Set();
  function startNear(L) {
    nearBusy = L;
    jobs.unshift(
      (nearJob = (function* () {
        stairSide(L);
        const k = ckey(L, 0);
        let val = cacheGet(k);
        if (!val) {
          const g = buildHouseGen(hk, L.sp, 0);
          let r = g.next(),
            work = 0,
            t1 = performance.now();
          while (!r.done) {
            work += performance.now() - t1;
            yield;
            t1 = performance.now();
            r = g.next();
          }
          val = pack(r.value);
          work += performance.now() - t1;
          cachePut(k, val);
          stats.maxNearMs = Math.max(stats.maxNearMs, work);
          stats.nearBuilt++;
        }
        const r = { value: val };
        nearBusy = null;
        if (!L.wantNear || L.cl.dead) return;
        L.nearData = r.value.batch.b;
        L.nearLamps = r.value.lamps;
        nearDirty = true;
        // QA-035 (r2-physics): the generator seeds its RNG with the LOD, so the LOD 1 colliders sat up to ~1 m off the full-detail
        // roof / porch; up close the colliders come from this LOD 0 build (what the player sees and touches)
        if (r.value.colliders?.length) {
          L.colliders = r.value.colliders;
          if (L.col) {
            dropCols(L);
            makeCols(L);
          }
        }
        // parked car on the driveway: a real (parked, locked) traffic vehicle while the lot is at full detail
        if (r.value.cars.length && game.vehicles?.spawn && !L.car) {
          const cr = r.value.cars[0],
            c = Math.cos(L.ry),
            s = Math.sin(L.ry);
          const T = ['sedan', 'compact', 'suv', 'pickup', 'van', 'sedan', 'suv'][
            (L.sp.seed >>> 3) % 7
          ];
          let px = L.x + c * cr.x + s * cr.z,
            pz = L.z - s * cr.x + c * cr.z;
          const PL = game.placement;
          // r8: the drive must be clear (no pole, stairs, bins, shrubs); else nudge along the drive, else no car
          const q = PL?.clearSpot
            ? PL.clearSpot(px, pz, L.ry + cr.ry, 4.9, 2.0, 2.5, { y: L.y, cars: true })
            : [px, pz];
          if (q) {
            [px, pz] = q;
            try {
              L.car = game.vehicles.spawn(T, new THREE.Vector3(px, L.y + 0.6, pz), L.ry + cr.ry, {
                snap: false,
              });
            } catch (e) {
              L.car = null;
            }
          }
        }
      })()),
    );
  }
  function dropNear(L) {
    L.wantNear = false;
    if (!L.nearData) return;
    L.nearData = null;
    nearDirty = true;
    setLamps(L, false);
    if (L.car) {
      const V = game.vehicles,
        car = L.car;
      L.car = null;
      try {
        if (V?.list?.includes(car) && game.player?.state?.vehicle !== car && !car.driver?.isPlayer)
          V.remove(car);
      } catch (e) {
        /* */
      }
    }
  }
  let merging = false;
  function rebuildNear() {
    nearDirty = false;
    merging = true;
    jobs.push(rebuildNearGen());
  }
  function* rebuildNearGen() {
    const t0 = performance.now(),
      entries = [],
      now = new Set();
    for (const cl of clusters.values())
      for (const L of cl.lots)
        if (L.nearData) {
          entries.push({ L, b: L.nearData });
          now.add(L);
        }
    const old = nearGroup;
    nearGroup = entries.length
      ? yield* mergeBucketsGen(entries, entries[0].L.x, entries[0].L.z, 'near', false, true)
      : null;
    merging = false;
    if (nearGroup) root.add(nearGroup);
    for (const L of now) hk.lotMask.set(L.id, true);
    for (const L of nearShown) if (!now.has(L)) hk.lotMask.set(L.id, false);
    nearShown = now;
    if (old) {
      old.traverse((o) => o.geometry?.dispose());
      old.removeFromParent();
    }
    stats.mergeSpanMs = Math.round(performance.now() - t0);
  }
  const qy = new THREE.Quaternion(),
    qe = new THREE.Euler();
  function makeCols(L) {
    if (!world || !RAPIER || !L.colliders) return;
    qy.setFromAxisAngle(new THREE.Vector3(0, 1, 0), L.ry);
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed()
        .setTranslation(L.x, L.y, L.z)
        .setRotation({ x: qy.x, y: qy.y, z: qy.z, w: qy.w }),
    );
    for (const c of L.colliders) {
      try {
        const d =
          c.shape === 'cyl'
            ? RAPIER.ColliderDesc.cylinder(c.hh, c.r)
            : RAPIER.ColliderDesc.cuboid(c.h[0], c.h[1], c.h[2]);
        const q = new THREE.Quaternion().setFromEuler(qe.set(c.rx || 0, c.ry || 0, 0, 'YXZ'));
        d.setTranslation(c.p[0], c.p[1], c.p[2]).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w });
        world.createCollider(d, body);
      } catch (e) {
        /* skip a bad descriptor */
      }
    }
    L.col = body;
    stats.cols++;
  }
  function dropCols(L) {
    if (L.col) {
      try {
        world.removeRigidBody(L.col);
      } catch (e) {
        /* already gone */
      }
      L.col = null;
      stats.cols--;
    }
  }
  const _lp = new THREE.Vector3();
  function setLamps(L, on) {
    const lamps = game.env?.lamps;
    if (!lamps?.add) return;
    if (on && !L.lampIds && L.nearLamps?.length) {
      L.lampIds = L.nearLamps.slice(0, 2).map((l) => {
        _lp
          .set(l.pos[0], l.pos[1], l.pos[2])
          .applyAxisAngle(new THREE.Vector3(0, 1, 0), L.ry)
          .add(new THREE.Vector3(L.x, L.y, L.z));
        return lamps.add(_lp.x, _lp.y, _lp.z, {
          color: l.color,
          intensity: (l.intensity ?? 20) * 2,
          range: l.range ?? 7,
          gy: L.y,
        });
      });
    } else if (!on && L.lampIds) {
      for (const id of L.lampIds) lamps.removeGroup?.(id);
      L.lampIds = null;
    }
  }

  // ---------- lot sources ----------
  // (1) the spawn street: lots registered by world-dressing (house size, stilts, driveway side)
  const districtAt = (x, z) => {
    try {
      return city?.districtAt?.(x, z) || '';
    } catch (e) {
      return '';
    }
  };
  {
    const list = [];
    for (const l of lots.list.values()) {
      if (l.source !== 'street' || !l.house) continue;
      const h = l.house;
      const sp = planHouse({
        seed: l.seed,
        w: h.w,
        d: h.d,
        stilt: h.stilt,
        base: h.base,
        district: districtAt(l.x, l.z),
        drvU: h.drvU ?? undefined,
        front: h.front ?? Math.min(3.2, (h.roadV ?? 8) - 3),
        style: h.style,
        yard: h.yard,
      });
      // hand-placed Keys lots (dressing/keysStreet.data.js): explicit colors and yard choices override the seeded plan
      if (h.over) {
        const { colors, ...rest } = h.over;
        Object.assign(sp, rest);
        if (colors) Object.assign(sp.colors, colors);
      }
      {
        // hand-placed Keys lots were laid out for the old Keys roads: skip any whose footprint now sits on a carriageway
        const RG = game.miamiData?.roadGraph || game.city?.roadGraph,
          c0 = Math.cos(l.heading || 0),
          s0 = Math.sin(l.heading || 0);
        let bad = false;
        if (RG?.nearestEdge)
          for (const [uu, vv] of [
            [-0.5, -0.5],
            [0.5, -0.5],
            [-0.5, 0.5],
            [0.5, 0.5],
            [0, 0],
          ]) {
            const u = uu * (h.w || 9),
              v = vv * (h.d || 9),
              e = RG.nearestEdge(l.x + c0 * u + s0 * v, l.z - s0 * u + c0 * v, {}, 20);
            if (
              e &&
              e.edge &&
              !/service|track|path|driveway|footway|dirt/.test(String(e.edge.kind || '')) &&
              e.dist < (e.edge.width || 6) / 2 - 0.2
            ) {
              bad = true;
              break;
            }
          }
        if (bad) {
          try {
            lots.remove?.(l.id);
          } catch (e) {
            /* */
          }
          continue;
        }
      }
      list.push({ lotKey: l.id, x: l.x, y: l.y, z: l.z, ry: l.heading, sp });
      l.style = sp.style;
    }
    addCluster('spawn', list, { always: true, sync: true });
  }
  // (2) claimed map footprints, per city tile at full detail
  // free distance from (x, z) along (dx, dz) before another footprint or a street (max m)
  function freeRun(x, z, dx, dz, others, self, max) {
    for (let t = 0.5; t <= max; t += 0.75) {
      const px = x + dx * t,
        pz = z + dz * t;
      if (D?.roadGraph?.nearestEdge) {
        const e = D.roadGraph.nearestEdge(px, pz, _ne, 12);
        if (e && e.dist < e.edge.width / 2 + 1.2) return t - 0.5;
      }
      for (const o of others) {
        if (o === self || !o._bb) continue;
        const bb = o._bb;
        if (px < bb[0] || px > bb[1] || pz < bb[2] || pz > bb[3]) continue;
        if (pip(o.rings[0], px, pz)) return t - 0.5;
      }
    }
    return max;
  }
  const _ne = {};
  const pip = (r, x, z) => {
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
  function lotFromBuilding(b, others = []) {
    const ring = b.rings[0];
    let cx = 0,
      cz = 0;
    for (const [x, z] of ring) {
      cx += x;
      cz += z;
    }
    cx /= ring.length;
    cz /= ring.length;
    // facing: the footprint axis (longest edge) closest to the direction of the nearest street
    let ang = 0,
      best = 0;
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i],
        q = ring[(i + 1) % ring.length],
        l = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (l > best) {
        best = l;
        ang = Math.atan2(q[0] - p[0], q[1] - p[1]);
      }
    }
    const rd = D?.roadGraph?.nearestEdge?.(cx, cz, {}, 60);
    let fx = 0,
      fz = 1,
      gap = 6;
    if (rd) {
      fx = rd.point.x - cx;
      fz = rd.point.z - cz;
      const l = Math.hypot(fx, fz) || 1;
      fx /= l;
      fz /= l;
      gap = rd.dist - rd.edge.width / 2;
    }
    const want = Math.atan2(fx, fz);
    let ry = ang,
      bd = 9;
    for (let k = 0; k < 4; k++) {
      const a = ang + (k * Math.PI) / 2,
        dd = Math.abs(Math.atan2(Math.sin(a - want), Math.cos(a - want)));
      if (dd < bd) {
        bd = dd;
        ry = a;
      }
    }
    const c = Math.cos(ry),
      s = Math.sin(ry);
    let u0 = Infinity,
      u1 = -Infinity,
      v0 = Infinity,
      v1 = -Infinity;
    for (const [x, z] of ring) {
      const dx = x - cx,
        dz = z - cz,
        u = dx * c - dz * s,
        v = dx * s + dz * c;
      u0 = Math.min(u0, u);
      u1 = Math.max(u1, u);
      v0 = Math.min(v0, v);
      v1 = Math.max(v1, v);
    }
    const mu = (u0 + u1) / 2,
      mv = (v0 + v1) / 2,
      x = cx + c * mu + s * mv,
      z = cz - s * mu + c * mv;
    const w = (u1 - u0) * 0.95,
      d = (v1 - v0) * 0.95;
    // user (Nov 18): "a house in the middle of the road". A building footprint from the map can overlap a street (the Keys
    // layout re-cut the roads): any footprint corner or edge midpoint inside a drivable carriageway -> no house on this lot
    if (D?.roadGraph?.nearestEdge) {
      const NOHIT = /service|track|path|driveway|footway|dirt/;
      for (const [uu, vv] of [
        [-0.5, -0.5],
        [0.5, -0.5],
        [-0.5, 0.5],
        [0.5, 0.5],
        [0, -0.5],
        [0, 0.5],
        [-0.5, 0],
        [0.5, 0],
        [0, 0],
      ]) {
        const u = uu * w,
          v = vv * d,
          px = x + c * u + s * v,
          pz = z - s * u + c * v,
          e = D.roadGraph.nearestEdge(px, pz, {}, 20);
        if (
          e &&
          e.edge &&
          !NOHIT.test(String(e.edge.kind || '')) &&
          e.dist < (e.edge.width || 6) / 2 - 0.2
        )
          return null;
      }
    }
    let y = Infinity;
    for (const [px, pz] of ring) y = Math.min(y, TH(px, pz));
    if (!Number.isFinite(y)) y = 0;
    for (const o of others)
      if (!o._bb && o.rings) {
        let a0 = Infinity,
          a1 = -Infinity,
          b0 = Infinity,
          b1 = -Infinity;
        for (const [px, pz] of o.rings[0]) {
          a0 = Math.min(a0, px);
          a1 = Math.max(a1, px);
          b0 = Math.min(b0, pz);
          b1 = Math.max(b1, pz);
        }
        o._bb = [a0, a1, b0, b1];
      }
    const fx2 = s,
      fz2 = c,
      rx2 = c,
      rz2 = -s; // lot +Z (street) and +X in world
    const gapF = freeRun(x + (fx2 * d) / 2, z + (fz2 * d) / 2, fx2, fz2, others, b, 16);
    const back = freeRun(x - (fx2 * d) / 2, z - (fz2 * d) / 2, -fx2, -fz2, others, b, 14);
    const sideL = freeRun(x - (rx2 * w) / 2, z - (rz2 * w) / 2, -rx2, -rz2, others, b, 8),
      sideR = freeRun(x + (rx2 * w) / 2, z + (rz2 * w) / 2, rx2, rz2, others, b, 8);
    const front = Math.max(0.8, Math.min(3, gapF - 1.5));
    const sp = planHouse({
      seed: (b.id * 2654435761) >>> 0,
      w,
      d,
      stilt: b.style === 'stilt',
      base: b.style === 'stilt' ? Math.max(2.4, b.minH || 2.7) : undefined,
      district: districtAt(cx, cz),
      front,
      tall: (b.h || 0) > 6.2,
      drvU: (sideR >= sideL ? 1 : -1) * (w / 2 + 2),
      yard: { gap: gapF, back: back * 0.5, side: Math.min(sideL, sideR) * 0.5 + 0.3 },
    });
    if ((b.h || 0) <= 6.2 && sp.stories > 1) sp.stories = 1;
    const lotKey = 'map:' + b.id;
    lots.add({
      id: lotKey,
      x,
      z,
      y,
      heading: ry,
      w: w + Math.min(sideL, sideR),
      d: d + back * 0.5 + Math.max(0, gapF - 0.9),
      roadGap: 0.9,
      style: sp.style,
      source: 'map',
      buildingId: b.id,
      seed: sp.seed,
    });
    return { lotKey, x, y, z, ry, sp };
  }
  const tilePending = [],
    _nearOut = [];
  function scanTiles(px, pz) {
    const S = city?.streamer;
    if (!S?.tiles || !D?.getTile) return;
    const TS = S.tileSize || 200;
    for (const t of S.tiles.values()) {
      const k = t._houseKey || (t._houseKey = 'tile:' + t.tx + '_' + t.tz),
        has = t._houseEmpty || clusters.has(k);
      const tdx = t.cx - px,
        tdz = t.cz - pz,
        d = Math.sqrt(tdx * tdx + tdz * tdz);
      if (!has && t.near && d < MAP_R && !tilePending.includes(t) && !lots.townPending(t.cx, t.cz))
        tilePending.push(t);
      if (clusters.has(k) && (!t.near || d > MAP_R + 120)) removeCluster(clusters.get(k));
    }
    // memory leak (Nov 19): the loop above only sees tiles the streamer still holds. Once the streamer dropped a far
    // tile, its cluster (meshes, plant fields, lots, colliders) was never removed: houses piled up as the player drove.
    for (let i = clList.length - 1; i >= 0; i--) {
      const cl = clList[i];
      if (!cl.tile || cl.always || S.tiles.get(cl.tile.k) === cl.tile) continue;
      removeCluster(cl);
    }
    if (TS && tilePending.length) {
      tilePending.sort(
        (a, b) => Math.hypot(a.cx - px, a.cz - pz) - Math.hypot(b.cx - px, b.cz - pz),
      );
      const t = tilePending.shift(),
        tile = D.getTile(t.tx, t.tz);
      if (!tile) {
        t._houseEmpty = true;
        return;
      }
      // a map footprint under a hand-placed spawn-street lot is that lot's house: building both drew two houses in one spot
      // (REQUESTS Nov 18 eve: houses:spawn mid copy fighting a houses:near copy at about -1117, 5336)
      const onStreetLot = (b) => {
        let cx = 0,
          cz = 0;
        const r = b.rings[0];
        for (const [x, z] of r) {
          cx += x;
          cz += z;
        }
        cx /= r.length;
        cz /= r.length;
        for (const l of lots.near(cx, cz, 1.5, _nearOut)) if (l.source === 'street') return true;
        return false;
      };
      const list = [];
      for (const b of tile.buildings || [])
        if (
          lots.claims(b) &&
          !onStreetLot(b) &&
          !(
            lots.reserved.length &&
            b.rings[0]
              .concat([[b.cx, b.cz]])
              .some(([x, z]) => Number.isFinite(x) && lots.reservedAt(x, z, 1.5))
          )
        ) {
          const L0 = lotFromBuilding(b, tile.buildings);
          if (L0) list.push(L0);
        }
      if (!list.length) {
        t._houseEmpty = true;
        return;
      }
      addCluster('tile:' + t.tx + '_' + t.tz, list, { tile: t });
    }
  }

  // ---------- per-frame ----------
  const cam = new THREE.Vector3();
  let scanT = 0,
    nearQueue = null;
  game.updaters.push(function housesTick(dt) {
    try {
      const h = game.timeOfDay ?? 12;
      hk.uNight.value =
        h >= 19.2 || h < 5.4 ? 1 : h > 17.8 ? (h - 17.8) / 1.4 : h < 6.6 ? (6.6 - h) / 1.2 : 0;
      cam.copy(game.camera.position);
      const P = game.player?.position || cam;
      if ((scanT -= dt) <= 0) {
        scanT = 0.5;
        scanTiles(cam.x, cam.z);
      }
      const night = hk.uNight.value > 0.5;
      let bestNear = null,
        bestD = Infinity;
      stats.near = stats.mid = stats.far = 0;
      stats.tris.mid = stats.tris.far = 0;
      for (let ci = 0; ci < clList.length; ci++) {
        const cl = clList[ci];
        if (!cl.ready) continue;
        const cdx = cl.ox - cam.x,
          cdz = cl.oz - cam.z,
          dc = Math.max(0, Math.sqrt(cdx * cdx + cdz * cdz) - cl.r),
          vis = cl.always ? dc < 1400 : !!(cl.tile && cl.tile.near);
        const mid = vis && dc < MID_R;
        cl.mid.visible = mid;
        cl.far.visible = vis && !mid;
        if (mid) {
          stats.mid++;
          stats.tris.mid += cl.mid.userData.tris;
        } else if (vis) {
          stats.far++;
          stats.tris.far += cl.far.userData.tris;
        }
        if (dc > NEAR_OUT + 20 && dc > COL_OUT) {
          for (const L of cl.lots) {
            if (L.nearData || L.wantNear) dropNear(L);
            if (L.col) dropCols(L);
          }
          continue;
        }
        for (let li = 0; li < cl.lots.length; li++) {
          const L = cl.lots[li];
          const ax = L.x - cam.x,
            az = L.z - cam.z,
            bx = L.x - P.x,
            bz = L.z - P.z,
            d = Math.sqrt(ax * ax + az * az),
            dp = Math.sqrt(bx * bx + bz * bz);
          if ((L.nearData || L.wantNear) && (d > NEAR_OUT || !vis)) dropNear(L);
          else if (!L.nearData && !L.bad && L.id && d < NEAR_IN && vis) {
            /* clipping sweep: a lot without a mask id cannot hide its merged copy, so it stays merged */ L.wantNear = true;
            if (nearBusy !== L && d < bestD) {
              bestD = d;
              bestNear = L;
            }
          }
          if (L.nearData) {
            stats.near++;
            setLamps(L, night);
          }
          if (!L.col && !L.bad && dp < COL_IN) makeCols(L);
          else if (L.col && dp > COL_OUT) dropCols(L);
        }
      }
      if (bestNear && !nearBusy) startNear(bestNear); // one full build at a time, nearest first, spread over frames
      runJobs(3);
      if (nearDirty && !nearBusy && !merging) rebuildNear(); // merge once the pending build is in (one swap, not one per house)
      stats.tris.near = nearGroup ? nearGroup.userData.tris : 0;
      stats.jobs = jobs.length;
    } catch (e) {
      if (!housesTick._err) {
        housesTick._err = true;
        console.error('[houses] update failed', e);
      }
    }
  });

  game.houses = {
    lots,
    clusters,
    kit: hk,
    stats: () => ({
      ...stats,
      buildMs: Math.round(stats.buildMs),
      maxNearMs: Math.round(stats.maxNearMs),
      maxStepMs: Math.round(stats.maxStepMs || 0),
      styles: [...clusters.values()]
        .flatMap((c) => c.lots.map((l) => l.sp.style))
        .reduce((a, s) => ((a[s] = (a[s] || 0) + 1), a), {}),
    }),
  };
  game.emit?.('houses:ready', game.houses);
}
