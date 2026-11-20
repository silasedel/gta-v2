// Town centers in the world (track: houses / towns). For each listed town: when the player comes within 1.4 km the
// center is planned on the live street grid (towns.js), its shop and plaza footprints are reserved in the lot API (so the
// house generator leaves them free), and the buildings and streetscape are built over several frames: full detail merged
// per material (all shops, sidewalks, furniture), a far version past 280 m. Colliders within 300 m, street lamps light up
// at night (the nearest 24 through the clustered lamp system), planting through instanced vegetation fields.
// ?notown turns it off (before / after shots).  API: game.towns = { list, stats() }
import * as THREE from 'three';
import { planTown, buildStreetscape } from './towns.js';
import { buildShop, signAtlas, KINDS } from './shops.js';
import { lots } from '../houses/lots.js';

export const order = 76; // after the house generator (75): shares its kit, materials and night uniform
const TOWNS = [{ name: 'Port Calabash', short: 'Calabash' }];
const START = 1400,
  NEAR = 280,
  COL = 300;

export async function initV2(game) {
  if (/[?&]notown\b/.test(location.search) || !lots.enabled) return;
  const hk = game.houses?.kit,
    D = game.miamiData,
    city = game.city;
  if (!hk || !D?.roadGraph) return;
  let layout = null;
  try {
    layout = await (
      await fetch((import.meta.env?.BASE_URL ?? '/') + 'assets/world/layout.json', {
        cache: 'no-cache',
      })
    ).json();
  } catch (e) {
    /* */
  }
  const list = [];
  // every fictional-land town on the map (the main street is found on whatever grid the map-roads track has built)
  const towns = (layout?.places || [])
    .filter(
      (q) =>
        q.kind === 'town' &&
        !/Outskirts/.test(q.name) &&
        !(
          layout.realRect &&
          q.x > layout.realRect.minX &&
          q.x < layout.realRect.maxX &&
          q.z > layout.realRect.minZ &&
          q.z < layout.realRect.maxZ
        ),
    )
    .map((q) => ({
      name: q.name,
      short:
        q.name
          .split(' ')
          .filter((w) => w.length > 3)
          .pop() || q.name,
    }));
  for (const t of towns.length ? towns : TOWNS) {
    const p = layout?.places?.find((q) => q.name === t.name);
    if (!p) continue;
    const T = {
      ...t,
      x: p.x,
      z: p.z,
      r: p.r,
      R: Math.min(330, Math.max(180, p.r * 0.4)),
      planned: false,
      state: 'idle',
    };
    list.push(T);
    lots.towns.push(T);
  }
  if (!list.length) return;
  const root = new THREE.Group();
  root.name = 'towns';
  game.scene.add(root);
  const stats = {};
  // ground: the city's own surface query (terrain relief included), so buildings and furniture sit where the ground is drawn
  const groundAt = (x, z) => {
    try {
      const g = city.groundHeightAt
        ? city.groundHeightAt(x, z)
        : D.terrainHeightAt
          ? D.terrainHeightAt(x, z)
          : 0;
      return Number.isFinite(g) ? Math.max(0, g) : 0;
    } catch (e) {
      return 0;
    }
  };
  const roadDist = (x, z) => {
    const r = D.roadGraph.nearestEdge(x, z, {}, 30);
    return r ? r.dist - r.edge.width / 2 : 99;
  };
  const isWater = (x, z) => {
    try {
      return city.isWater(x, z);
    } catch (e) {
      return false;
    }
  };
  const TS = D.tileSize || 200;
  const buildingsNear = (x, z) => {
    const t = D.getTile(Math.floor(x / TS), Math.floor(z / TS));
    if (!t) return [];
    for (const b of t.buildings)
      if (!b._bb) {
        let a = Infinity,
          c = -Infinity,
          d = Infinity,
          e = -Infinity;
        for (const [px, pz] of b.rings[0]) {
          a = Math.min(a, px);
          c = Math.max(c, px);
          d = Math.min(d, pz);
          e = Math.max(e, pz);
        }
        b._bb = [a, c, d, e];
      }
    return t.buildings;
  };
  const tilesReady = (T) => {
    let ok = true;
    for (let i = Math.floor((T.x - T.R - 60) / TS); i <= Math.floor((T.x + T.R + 60) / TS); i++)
      for (let j = Math.floor((T.z - T.R - 60) / TS); j <= Math.floor((T.z + T.R + 60) / TS); j++) {
        if (D.tileReady && !D.tileReady(i, j)) {
          D.requestTile?.(i, j);
          ok = false;
        }
      }
    return ok;
  };

  // merge kit batch buckets (local frames) into one mesh per material
  function merge(entries, ox, oz, name, cast) {
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
    g.name = name;
    let tris = 0;
    for (const [m, t] of tot) {
      const pos = new Float32Array(t.v * 3),
        nor = new Float32Array(t.v * 3),
        uv = new Float32Array(t.v * 2),
        col = new Float32Array(t.v * 3),
        wear = new Float32Array(t.v),
        idx = t.v > 65535 ? new Uint32Array(t.i) : new Uint16Array(t.i);
      let vo = 0,
        io = 0;
      for (const { b, x, y, z, ry } of entries) {
        const k = b.get(m);
        if (!k || !k.n) continue;
        const c = Math.cos(ry),
          s = Math.sin(ry),
          dx = x - ox,
          dz = z - oz;
        for (let i = 0; i < k.n; i++) {
          const px = k.pos[i * 3],
            pz = k.pos[i * 3 + 2],
            j = (vo + i) * 3;
          pos[j] = dx + c * px + s * pz;
          pos[j + 1] = y + k.pos[i * 3 + 1];
          pos[j + 2] = dz - s * px + c * pz;
          const nx = k.nor[i * 3],
            nz = k.nor[i * 3 + 2];
          nor[j] = c * nx + s * nz;
          nor[j + 1] = k.nor[i * 3 + 1];
          nor[j + 2] = -s * nx + c * nz;
        }
        uv.set(k.uv, vo * 2);
        col.set(k.col, vo * 3);
        wear.set(k.wear, vo);
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
      geo.setIndex(new THREE.BufferAttribute(idx, 1));
      geo.computeBoundingSphere();
      const mesh = new THREE.Mesh(geo, m);
      mesh.name = name + ':' + m.name;
      mesh.castShadow = cast && !m.transparent;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      g.add(mesh);
      tris += t.i / 3;
    }
    g.userData.tris = tris;
    return g;
  }

  function* build(T) {
    const t0 = performance.now();
    // a town unloaded far away keeps its plan: rebuilt from the same plan, its lots already reserved
    const plan = T.plan || planTown(T, { D, isWater, roadDist, groundAt, buildingsNear, lots });
    T.planned = true;
    if (!plan) {
      T.state = 'none';
      return;
    }
    if (!T.plan) for (const q of plan.reserved) lots.reserve(q);
    T.plan = plan;
    yield;
    const atlas = signAtlas(
      hk,
      T.name,
      plan.shops.map((s) => s.name),
      plan.shops.map((s) => ({
        bg: '#' + s.colors.accent.toString(16).padStart(6, '0'),
        ink: '#f6f0e2',
        font: /bank|realty|church|books/.test(s.kind)
          ? 'Georgia, serif'
          : /diner|icecream|bait|seafood/.test(s.kind)
            ? 'Futura, Helvetica, Arial, sans-serif'
            : 'Didot, Georgia, serif',
        sub: {
          bait: 'LIVE BAIT · ICE · TACKLE',
          diner: 'OPEN 6 AM',
          pharmacy: 'PRESCRIPTIONS',
          hardware: 'MARINE · PAINT · TOOLS',
          motel: 'VACANCY',
          bank: 'EST. 1924',
          seafood: 'FRESH DAILY',
        }[s.kind],
      })),
    );
    const e0 = [],
      e2 = [],
      cols = [];
    T.lampList = [];
    T.atlas = atlas;
    plan.shops.forEach((s, i) => {
      s.sign = atlas.cells[i];
      s.signMat = atlas.material;
    });
    for (const s of plan.shops) {
      for (const [lod, arr] of [
        [0, e0],
        [2, e2],
      ]) {
        const res = buildShop(hk, s, lod);
        arr.push({ b: res.batch.b, x: s.x, y: s.y, z: s.z, ry: s.ry });
        if (lod === 0) {
          for (const c of res.colliders) cols.push({ ...c, base: s });
          for (const l of res.lamps) T.lampList.push(toWorld(s, l.pos, l));
        }
      }
      yield;
    }
    const st0 = buildStreetscape(hk, plan, 0, 0, 0),
      st2 = buildStreetscape(hk, plan, 0, 0, 2);
    e0.push({ b: st0.batch.b, x: 0, y: 0, z: 0, ry: 0 });
    e2.push({ b: st2.batch.b, x: 0, y: 0, z: 0, ry: 0 });
    for (const c of st0.colliders) cols.push(c);
    for (const l of st0.lamps)
      T.lampList.push({
        x: l.pos[0],
        y: l.pos[1],
        z: l.pos[2],
        color: l.color,
        intensity: l.intensity,
        range: l.range,
      });
    yield;
    T.near = merge(e0, T.x, T.z, 'town:' + T.name + ':near', true);
    yield;
    T.far = merge(e2, T.x, T.z, 'town:' + T.name + ':far', false);
    root.add(T.near, T.far);
    T.far.visible = false;
    T.cols = cols;
    T.state = 'built';
    // planting: plaza palms and planter shrubs (instanced vegetation)
    T.fields = [];
    const byKind = {};
    for (const t of plan.trees)
      (byKind[t.kind] ||= []).push({
        x: t.x,
        y: t.y,
        z: t.z,
        ry: (t.x * 3.1) % 6.28,
        s: t.s ?? 0.9,
      });
    if (game.vegetation?.field)
      for (const [k, items] of Object.entries(byKind)) {
        try {
          T.fields.push(game.vegetation.field(k, items, { variants: 2, seed: 11, parent: root }));
        } catch (e) {
          /* */
        }
      }
    stats[T.name] = {
      ...plan.counts,
      main: plan.main,
      plaza: !!plan.plaza,
      kinds: plan.shops.map((s) => s.kind + ':' + s.name),
      trisNear: T.near.userData.tris,
      trisFar: T.far.userData.tris,
      buildMs: Math.round(performance.now() - t0),
    };
  }
  function toWorld(s, p, l) {
    const c = Math.cos(s.ry),
      sn = Math.sin(s.ry);
    return {
      x: s.x + c * p[0] + sn * p[2],
      y: s.y + p[1],
      z: s.z - sn * p[0] + c * p[2],
      color: l.color,
      intensity: l.intensity,
      range: l.range,
    };
  }
  function makeCols(T) {
    const { world, RAPIER } = game;
    if (!world || !RAPIER) return;
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    T.body = body;
    const q = new THREE.Quaternion(),
      e = new THREE.Euler();
    for (const c of T.cols) {
      try {
        const s = c.base,
          cs = s ? Math.cos(s.ry) : 1,
          sn = s ? Math.sin(s.ry) : 0,
          x = s ? s.x + cs * c.p[0] + sn * c.p[2] : c.p[0],
          z = s ? s.z - sn * c.p[0] + cs * c.p[2] : c.p[2],
          y = (s ? s.y : 0) + c.p[1];
        const d =
          c.shape === 'cyl'
            ? RAPIER.ColliderDesc.cylinder(c.hh, c.r)
            : RAPIER.ColliderDesc.cuboid(c.h[0], c.h[1], c.h[2]);
        q.setFromEuler(e.set(c.rx || 0, (c.ry || 0) + (s ? s.ry : 0), 0, 'YXZ'));
        d.setTranslation(x, y, z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w });
        world.createCollider(d, body);
      } catch (err) {
        /* skip */
      }
    }
  }
  let job = null;
  const lampIds = new Map();
  // memory leak (Nov 19): a built town stayed in memory for good (merged meshes, sign atlas canvas, plant fields).
  // Past the far-LOD range it is freed now and rebuilt from its saved plan when the camera comes back.
  const UNLOAD_D = 4800;
  function unloadTown(T) {
    for (const g of [T.near, T.far]) {
      if (!g) continue;
      g.traverse((o) => {
        if (o.isMesh) o.geometry?.dispose();
      });
      g.removeFromParent();
    }
    T.near = null;
    T.far = null;
    for (const f of T.fields || []) {
      try {
        f.remove();
      } catch (e) {
        /* already gone */
      }
    }
    T.fields = [];
    const am = T.atlas?.material;
    if (am) {
      am.map?.dispose();
      am.emissiveMap?.dispose();
      am.dispose();
    }
    T.atlas = null;
    if (T.body) {
      try {
        game.world.removeRigidBody(T.body);
      } catch (e) {
        /* */
      }
      T.body = null;
    }
    const L = game.env?.lamps;
    for (const l of T.lampList || []) {
      const id = lampIds.get(l);
      if (id === undefined) continue;
      L?.removeGroup?.(id);
      lampIds.delete(l);
    }
    T.state = 'idle';
  }
  game.updaters.push(function townsTick() {
    try {
      const cam = game.camera.position,
        P = game.player?.position || cam,
        night = (hk.uNight?.value ?? 0) > 0.5;
      for (const T of list) {
        const d = Math.hypot(cam.x - T.x, cam.z - T.z);
        // an unloaded town (it has a plan) comes back before its far LOD would show again (4 km)
        const startD = T.plan ? UNLOAD_D - 400 : START;
        if (T.state === 'idle' && d < startD && !job && tilesReady(T)) {
          T.state = 'building';
          job = build(T);
        }
        if (T.state !== 'built') continue;
        if (d > UNLOAD_D + T.R) {
          unloadTown(T);
          continue;
        }
        const near = d < T.R + NEAR;
        T.near.visible = near;
        T.far.visible = !near && d < 4000;
        const dp = Math.hypot(P.x - T.x, P.z - T.z);
        if (!T.body && dp < T.R + COL) makeCols(T);
        else if (T.body && dp > T.R + COL + 80) {
          try {
            game.world.removeRigidBody(T.body);
          } catch (e) {
            /* */
          }
          T.body = null;
        }
        // night: the nearest street lamps and shop lights through the clustered lamp system
        const L = game.env?.lamps;
        if (L?.add && (T._lt = (T._lt || 0) - 1) <= 0) {
          T._lt = 30;
          const want =
            night && near
              ? T.lampList
                  .map((l) => [Math.hypot(l.x - cam.x, l.z - cam.z), l])
                  .filter(([dd]) => dd < 160)
                  .sort((a, b) => a[0] - b[0])
                  .slice(0, 24)
                  .map(([, l]) => l)
              : [];
          for (const [l, id] of lampIds)
            if (!want.includes(l)) {
              L.removeGroup?.(id);
              lampIds.delete(l);
            }
          for (const l of want)
            if (!lampIds.has(l))
              lampIds.set(
                l,
                L.add(l.x, l.y, l.z, {
                  color: l.color,
                  intensity: (l.intensity ?? 20) * 2,
                  range: l.range ?? 8,
                  gy: l.y - 3,
                }),
              );
        }
      }
      if (job) {
        const t0 = performance.now();
        while (job && performance.now() - t0 < 4) {
          const r = job.next();
          if (r.done) job = null;
        }
      }
    } catch (e) {
      if (!townsTick._err) {
        townsTick._err = true;
        console.error('[towns] update failed', e);
      }
      job = null;
      for (const T of list)
        if (T.state === 'building') {
          T.state = 'none';
          T.planned = true;
        }
    }
  });
  game.towns = {
    list,
    stats: () => ({ ...stats, states: list.map((t) => t.name + ':' + t.state) }),
  };
  void KINDS;
}
