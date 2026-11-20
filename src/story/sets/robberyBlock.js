// The robbery block of the intro v2 flashback (storyboard panels 5-7): 21st St between Washington Ave and Euclid Ave,
// Miami Beach. Sunshine Payday Loans (storefront 882, types/payday.js) on the north side, Cafe Colada with the red CAFE
// awning (storefront 1028, types/robberyCafe.js) straight across the street, low flat-roofed walk-ups all round.
//
// The escape route (panel 6) is built here for the escape mission only and disposed with it:
//   payday door -> east along the sidewalk -> steel fire escape up the alley wall of No. 5955 (9.1 m roof)
//   -> across that roof -> plank bridge down to No. 5957 (7.4 m) -> plank bridge up to No. 5956 (8.2 m)
//   -> roof door of the narrow stair house filling the alley between No. 5954 and No. 5956 -> stairs down inside it
//   -> street door into the service alley -> east to Euclid Ave -> streets -> back to the cafe.
// Every stair flight is 34-37 degrees (the player climbs up to 50, slides from 40), every walkway at least 0.9 m wide.
//
// Positions use the block frame: origin = the payday shop's center, heading = the block's facing (0.0995 rad, the
// buildings are turned 5.7 degrees off the grid). u = meters east along 21st St, v = meters toward the street (south).
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export const SHOP_LOT = 882;
export const CAFE_LOT = 1028;

export const FRAME = { x: 2416.4, z: -769.9, heading: 0.0995 };
const COS = Math.cos(FRAME.heading);
const SIN = Math.sin(FRAME.heading);

// block-local (u east, v south) -> world { x, z, heading } (heading: local yaw `ry` 0 faces +v / the street)
export function P(u, v, ry = 0) {
  return {
    x: FRAME.x + u * COS + v * SIN,
    z: FRAME.z - u * SIN + v * COS,
    heading: FRAME.heading + ry,
  };
}

// world heading for a direction in the block frame: 'north' (-v), 'south' (+v), 'east' (+u), 'west' (-u)
export const FACE = {
  south: FRAME.heading,
  north: FRAME.heading + Math.PI,
  east: FRAME.heading + Math.PI / 2,
  west: FRAME.heading - Math.PI / 2,
};

// the places the missions use (block frame; P() turns them into world points)
export const SPOTS = {
  cafeDoor: [0.2, 25.4, Math.PI], // on the cafe's sidewalk, facing the street (north)
  cafeTable: [-2.6, 24.6, Math.PI],
  shopDoorOut: [0, 6.6, Math.PI], // sidewalk outside the payday shop, facing the door
  street: [4, 15], // middle of 21st St in front of the shop
  alleyA: [11.8, 6.2], // mouth of the alley the fire escape stands in
  stairFoot: [13.5, 4.6],
  roofTop: [17.5, 3.6], // on the roof of No. 5955 by the fire escape
  roof1: [30, 0], // east side of that roof, at the first plank
  roof2: [47, -2.5], // on No. 5957
  roof3: [44, -12.5], // on No. 5956
  bulkhead: [39.6, -10.5], // in front of the stair house's roof door
  towerFoot: [34.7, -11.6], // inside, at the foot of the stairs
  towerOut: [34.7, -7.6], // in the service alley outside the stair house's street door
  alleyEast: [60, -7.4], // alley mouth on Euclid Ave
  euclid: [66, 2],
  loop: [66, 26], // Euclid Ave at 21st St, south corner
};

export function spot(name) {
  const s = SPOTS[name];
  return P(s[0], s[1], s[2] || 0);
}

// ---------------------------------------------------------------- the V2 interiors of the block
export function findStore(game, lot) {
  return (game.interiorsV2?.list || []).find((s) => s.sf?.id === lot) || null;
}

// waits until the interior engine has built the lot (it streams interiors in around the player)
export async function storeBuilt(game, lot, ms = 15000) {
  const t0 = performance.now();
  for (;;) {
    const s = findStore(game, lot);
    if (s?.built) return s;
    if (performance.now() - t0 > ms) return s || null;
    await new Promise((r) => setTimeout(r, 200));
  }
}

// store-local point (x across, z toward the street, ry) -> world { x, y, z, heading }
export function storePoint(store, p, y = 0) {
  const w = store.toWorld(p.x, p.z);
  return { x: w.x, y: store.baseY + y, z: w.z, heading: store.facing + (p.ry || 0) };
}

// ---------------------------------------------------------------- geometry kit: boxes merged per material, cuboid colliders
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();

function makeKit(game) {
  const parts = new Map(); // material -> [geometries]
  const colliders = [];
  const body = game.world.createRigidBody(game.RAPIER.RigidBodyDesc.fixed());
  const kit = {
    // a box centered at block (u, y, v), size (w along u, h, d along v), pitched by `pitch` about the u axis
    box(mat, u, y, v, w, h, d, o = {}) {
      const g = new THREE.BoxGeometry(w, h, d);
      const pos = P(u, v);
      _e.set(o.pitch || 0, FRAME.heading + (o.yaw || 0), o.roll || 0, 'YXZ');
      _q.setFromEuler(_e);
      _m.compose(_p.set(pos.x, y, pos.z), _q, _s.set(1, 1, 1));
      g.applyMatrix4(_m);
      if (!parts.has(mat)) parts.set(mat, []);
      parts.get(mat).push(g);
      if (o.collide) kit.collider(u, y, v, w, h, d, o);
    },
    collider(u, y, v, w, h, d, o = {}) {
      const R = game.RAPIER;
      const pos = P(u, v);
      _e.set(o.pitch || 0, FRAME.heading + (o.yaw || 0), o.roll || 0, 'YXZ');
      _q.setFromEuler(_e);
      const desc = R.ColliderDesc.cuboid(w / 2, h / 2, d / 2)
        .setTranslation(pos.x, y, pos.z)
        .setRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w });
      const c = game.world.createCollider(desc, body);
      if (o.surface) game.footSurface?.tagCollider?.(c, o.surface);
      colliders.push(c);
      return c;
    },
    build(group) {
      for (const [mat, list] of parts) {
        const geo = mergeGeometries(list, false);
        for (const g of list) g.dispose();
        const mesh = new THREE.Mesh(geo, mat);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        group.add(mesh);
      }
      parts.clear();
    },
    dispose() {
      for (const c of colliders) {
        try {
          game.world.removeCollider(c, false);
        } catch (e) {
          /* already gone */
        }
      }
      colliders.length = 0;
      try {
        game.world.removeRigidBody(body);
      } catch (e) {
        /* */
      }
    },
  };
  return kit;
}

function canvasTex(w, h, draw, repeat) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (repeat) t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = 4;
  return t;
}

function materials() {
  const steel = new THREE.MeshStandardMaterial({
    color: '#2b2e33',
    roughness: 0.55,
    metalness: 0.6,
  });
  const rust = new THREE.MeshStandardMaterial({ color: '#4a3a30', roughness: 0.8, metalness: 0.3 });
  const grate = new THREE.MeshStandardMaterial({
    color: '#3a3d42',
    roughness: 0.6,
    metalness: 0.55,
    map: canvasTex(64, 64, (g, w, h) => {
      g.fillStyle = '#9a9ea4';
      g.fillRect(0, 0, w, h);
      g.fillStyle = '#2a2c30';
      for (let i = 0; i < w; i += 8) {
        g.fillRect(i, 0, 3, h);
      }
    }),
  });
  const plank = new THREE.MeshStandardMaterial({
    color: '#c9a878',
    roughness: 0.85,
    map: canvasTex(256, 64, (g, w, h) => {
      g.fillStyle = '#b08a5a';
      g.fillRect(0, 0, w, h);
      g.strokeStyle = 'rgba(70, 45, 25, 0.35)';
      for (let i = 0; i < 26; i++) {
        g.beginPath();
        const y = Math.random() * h;
        g.moveTo(0, y);
        g.bezierCurveTo(w * 0.3, y + 4, w * 0.6, y - 4, w, y + 2);
        g.stroke();
      }
      g.fillStyle = 'rgba(40, 25, 15, 0.5)';
      g.fillRect(0, h / 2 - 1, w, 2);
    }),
  });
  const wall = new THREE.MeshStandardMaterial({
    color: '#ffffff',
    roughness: 0.92,
    map: canvasTex(
      256,
      256,
      (g, w, h) => {
        g.fillStyle = '#cdb898';
        g.fillRect(0, 0, w, h);
        for (let i = 0; i < 2200; i++) {
          const v = Math.random() * 30 - 15;
          g.fillStyle = `rgba(${120 + v}, ${100 + v}, ${80 + v}, 0.12)`;
          g.fillRect(
            Math.random() * w,
            Math.random() * h,
            2 + Math.random() * 4,
            2 + Math.random() * 4,
          );
        }
        g.fillStyle = 'rgba(60, 45, 30, 0.18)';
        for (let i = 0; i < 10; i++) {
          g.fillRect(Math.random() * w, 0, 1 + Math.random() * 2, h * (0.3 + Math.random() * 0.7));
        }
      },
      [2, 3],
    ),
  });
  const inner = new THREE.MeshStandardMaterial({ color: '#8f8a80', roughness: 0.95 });
  const door = new THREE.MeshStandardMaterial({ color: '#5b2a22', roughness: 0.6, metalness: 0.4 });
  const roof = new THREE.MeshStandardMaterial({ color: '#4c4a47', roughness: 0.95 });
  const ac = new THREE.MeshStandardMaterial({ color: '#b9bcbf', roughness: 0.5, metalness: 0.5 });
  const dark = new THREE.MeshStandardMaterial({ color: '#16181b', roughness: 0.7 });
  const glass = new THREE.MeshStandardMaterial({
    color: '#1e2a33',
    roughness: 0.15,
    metalness: 0.4,
  });
  const bulb = new THREE.MeshStandardMaterial({
    color: '#fff2d0',
    emissive: '#ffd890',
    emissiveIntensity: 4,
  });
  return { steel, rust, grate, plank, wall, inner, door, roof, ac, dark, glass, bulb };
}

// ---------------------------------------------------------------- pieces
// a straight stair flight from (u, v0, y0) to (u, v1, y1): treads, stringers, handrails, one ramp collider under it
function flight(kit, M, u, w, v0, y0, v1, y1, o = {}) {
  const run = Math.abs(v1 - v0);
  const rise = y1 - y0;
  const dir = Math.sign(v1 - v0);
  const n = Math.max(2, Math.round(Math.abs(rise) / 0.19));
  const len = Math.sqrt(run * run + rise * rise);
  // pitch about u: a box's local +z runs along +v; climbing toward +v means a negative pitch
  const pitch = -Math.atan2(rise, run) * dir;
  const vm = (v0 + v1) / 2;
  const ym = (y0 + y1) / 2;
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const tv = v0 + (v1 - v0) * t;
    const ty = y0 + rise * ((i + 1) / n);
    kit.box(M.grate, u, ty - 0.02, tv, w - 0.08, 0.035, (run / n) * 1.05);
  }
  for (const s of [-1, 1]) {
    kit.box(M.steel, u + s * (w / 2 - 0.03), ym - 0.08, vm, 0.05, 0.22, len, { pitch });
    if (o.rails !== false && (o.rails === undefined || o.rails === s || o.rails === 2)) {
      kit.box(M.steel, u + s * (w / 2 - 0.02), ym + 0.95, vm, 0.04, 0.04, len, { pitch });
      for (let k = 0; k <= 3; k++) {
        const t = k / 3;
        kit.box(
          M.steel,
          u + s * (w / 2 - 0.02),
          y0 + rise * t + 0.48,
          v0 + (v1 - v0) * t,
          0.03,
          0.95,
          0.03,
        );
      }
    }
  }
  // the walking surface: one thin ramp slab just under the tread tops
  kit.collider(u, ym - 0.06, vm, w, 0.12, len + 0.1, { pitch, surface: 'metal' });
}

// a flat platform (landing, walkway) with an optional rail along some edges
function landing(kit, M, u0, u1, v0, v1, y, o = {}) {
  const u = (u0 + u1) / 2;
  const v = (v0 + v1) / 2;
  kit.box(M.grate, u, y - 0.03, v, u1 - u0, 0.06, v1 - v0, { collide: true, surface: 'metal' });
  kit.box(M.steel, u, y - 0.12, v, u1 - u0, 0.1, 0.06);
  for (const e of o.rails || []) {
    const along = e === 'u0' || e === 'u1';
    const eu = e === 'u0' ? u0 : e === 'u1' ? u1 : u;
    const ev = e === 'v0' ? v0 : e === 'v1' ? v1 : v;
    const w = along ? 0.04 : u1 - u0;
    const d = along ? v1 - v0 : 0.04;
    kit.box(M.steel, eu, y + 1.0, ev, w, 0.04, d);
    kit.box(M.steel, eu, y + 0.5, ev, w, 0.03, d);
    kit.collider(eu, y + 0.55, ev, Math.max(w, 0.08), 1.1, Math.max(d, 0.08));
    const n = Math.max(1, Math.round((along ? d : w) / 1.2));
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      const pu = along ? eu : u0 + (u1 - u0) * t;
      const pv = along ? v0 + (v1 - v0) * t : ev;
      kit.box(M.steel, pu, y + 0.5, pv, 0.04, 1.0, 0.04);
    }
  }
}

// a scaffold plank bridge between two roofs (two boards side by side, cleats, a ramp collider)
function plankBridge(kit, M, a, b) {
  const du = b[0] - a[0];
  const dv = b[1] - a[1];
  const dy = b[2] - a[2];
  const flat = Math.sqrt(du * du + dv * dv);
  const len = Math.sqrt(flat * flat + dy * dy);
  const yaw = Math.atan2(du, dv);
  const pitch = -Math.atan2(dy, flat);
  const um = (a[0] + b[0]) / 2;
  const vm = (a[1] + b[1]) / 2;
  const ym = (a[2] + b[2]) / 2 + 0.05;
  const cu = Math.cos(yaw);
  const cv = -Math.sin(yaw);
  for (const s of [-0.24, 0.24]) {
    kit.box(M.plank, um + cu * s, ym, vm + cv * s, 0.46, 0.05, len, { yaw, pitch });
  }
  for (let k = 0; k < 4; k++) {
    const t = 0.15 + (k / 3) * 0.7;
    kit.box(M.plank, a[0] + du * t, a[2] + dy * t + 0.09, a[1] + dv * t, 0.9, 0.03, 0.06, {
      yaw,
      pitch,
    });
  }
  kit.collider(um, ym - 0.02, vm, 0.95, 0.1, len + 0.6, { yaw, pitch, surface: 'wood' });
}

// a rooftop AC condenser with its collider
function acUnit(kit, M, u, v, y, ry = 0) {
  kit.box(M.ac, u, y + 0.45, v, 1.1, 0.9, 0.8, { yaw: ry, collide: true, surface: 'metal' });
  kit.box(M.dark, u, y + 0.92, v, 0.7, 0.04, 0.5, { yaw: ry });
  kit.box(M.rust, u, y + 0.04, v, 1.3, 0.08, 1.0, { yaw: ry });
}

// ---------------------------------------------------------------- the escape route
// Returns { group, light, dispose }. Mesh count stays small (one merged mesh per material).
export function buildEscapeRoute(game) {
  const M = materials();
  const kit = makeKit(game);
  const group = new THREE.Group();
  group.name = 'intro2:escapeRoute';
  const g0 = 0.15; // sidewalk / alley level

  // 1. fire escape on the west wall of No. 5955 (alley u 9.34 .. 14.29): two flights and a walkway to the roof
  const roofA = 9.1;
  const mid = (g0 + roofA) / 2;
  flight(kit, M, 13.6, 1.15, 4.4, g0, -1.6, mid, { rails: -1 });
  landing(kit, M, 11.3, 14.2, -2.9, -1.6, mid, { rails: ['u0', 'v0'] });
  flight(kit, M, 12.0, 1.15, -1.6, mid, 4.4, roofA, { rails: -1 });
  landing(kit, M, 11.3, 12.6, 4.4, 5.3, roofA, { rails: ['u0', 'v1'] });
  landing(kit, M, 12.6, 14.6, 3.3, 5.3, roofA, { rails: ['v1'] });
  // wall brackets that carry it
  for (const v of [-2.2, 1.0, 4.8]) {
    kit.box(M.steel, 14.1, mid - 0.4, v, 0.3, 0.08, 0.08);
    kit.box(M.steel, 14.1, roofA - 0.4, v, 0.3, 0.08, 0.08);
  }
  // a drop ladder hanging from the first landing (look only)
  kit.box(M.steel, 11.5, mid - 1.6, -2.3, 0.04, 2.6, 0.04);
  kit.box(M.steel, 11.5, mid - 1.6, -2.8, 0.04, 2.6, 0.04);

  // 2. rooftop clutter on the route (AC units the player runs between) and the plank bridges
  acUnit(kit, M, 20.5, -2.6, roofA, 0.2);
  acUnit(kit, M, 26.0, 2.2, roofA, -0.1);
  acUnit(kit, M, 29.0, -3.4, roofA, 0);
  const roofB = 7.4;
  const roofC = 8.2;
  plankBridge(kit, M, [32.6, 0.2, roofA], [39.0, 0.2, roofB]);
  acUnit(kit, M, 44.0, 2.4, roofB, 0.3);
  acUnit(kit, M, 52.0, -1.0, roofB, 0);
  plankBridge(kit, M, [47.0, -4.2, roofB], [47.0, -10.4, roofC]);
  acUnit(kit, M, 50.5, -15.0, roofC, 0.1);

  // 3. the stair house filling the alley between No. 5954 and No. 5956 (u 33.4 .. 38.25, v -19.39 .. -9.72)
  const T = { u0: 33.4, u1: 38.25, v0: -19.39, v1: -9.72, top: roofC };
  const wt = 0.22;
  const wallH = T.top - g0;
  const wy = g0 + wallH / 2;
  // south wall (street door at u 34.0 .. 35.4, 2.1 m high)
  const dU0 = 34.0;
  const dU1 = 35.4;
  const doorH = 2.15;
  kit.box(M.wall, (T.u0 + dU0) / 2, wy, T.v1 - wt / 2, dU0 - T.u0, wallH, wt, { collide: true });
  kit.box(M.wall, (dU1 + T.u1) / 2, wy, T.v1 - wt / 2, T.u1 - dU1, wallH, wt, { collide: true });
  kit.box(
    M.wall,
    (dU0 + dU1) / 2,
    (g0 + doorH + T.top) / 2,
    T.v1 - wt / 2,
    dU1 - dU0,
    T.top - g0 - doorH,
    wt,
    { collide: true },
  );
  // north wall, east and west walls (the neighbors' walls are right behind them)
  kit.box(M.wall, (T.u0 + T.u1) / 2, wy, T.v0 + wt / 2, T.u1 - T.u0, wallH, wt, { collide: true });
  kit.box(M.inner, T.u0 + wt / 2, wy, (T.v0 + T.v1) / 2, wt, wallH, T.v1 - T.v0, { collide: true });
  kit.box(M.inner, T.u1 - wt / 2, wy, (T.v0 + T.v1) / 2, wt, wallH, T.v1 - T.v0, { collide: true });
  // the open street door leaf, a light over it, a small sign
  kit.box(M.door, dU0 + 0.05, g0 + doorH / 2, T.v1 + 0.45, 0.05, doorH, 0.9);
  kit.box(M.dark, (dU0 + dU1) / 2, g0 + doorH + 0.05, T.v1 + 0.01, dU1 - dU0 + 0.2, 0.1, 0.06);
  kit.box(M.bulb, (dU0 + dU1) / 2, g0 + doorH + 0.35, T.v1 + 0.08, 0.16, 0.1, 0.08);
  // street-side windows (dark glass, one per floor)
  for (const y of [3.6, 6.3]) {
    kit.box(M.glass, 36.8, y, T.v1 + 0.005, 0.9, 1.1, 0.02);
    kit.box(M.steel, 36.8, y - 0.6, T.v1 + 0.04, 1.0, 0.05, 0.08);
  }
  // stairs inside: F1 from the roof door down to a landing at mid height, F2 down to the street door
  const tMid = (g0 + T.top) / 2;
  const fU1 = 37.35; // F1 along the east wall
  const fU2 = 34.7; // F2 along the west wall, ends at the street door
  flight(kit, M, fU1, 1.25, -11.2, T.top, -17.2, tMid, { rails: -1 });
  landing(kit, M, T.u0 + wt, T.u1 - wt, -19.17, -17.2, tMid, {});
  flight(kit, M, fU2, 1.25, -17.2, tMid, -11.2, g0, { rails: 1 });
  // the floor under the stairs (concrete) and a rail between the flights
  kit.box(M.inner, (T.u0 + T.u1) / 2, g0 - 0.04, (T.v0 + T.v1) / 2, T.u1 - T.u0, 0.08, T.v1 - T.v0);
  // roof slab with the stair opening over F1 (u fU1 +- 0.7, v -9.94 .. -17.2)
  const oU0 = fU1 - 0.7;
  const oV0 = -17.2;
  const slabY = T.top - 0.1;
  kit.box(M.roof, (T.u0 + oU0) / 2, slabY, (T.v0 + T.v1) / 2, oU0 - T.u0, 0.2, T.v1 - T.v0, {
    collide: true,
  });
  kit.box(M.roof, (oU0 + T.u1) / 2, slabY, (T.v0 + oV0) / 2, T.u1 - oU0, 0.2, oV0 - T.v0, {
    collide: true,
  });
  // the roof bulkhead (stair house on the roof) around the opening, its door facing east toward No. 5956
  const bH = 2.4;
  const bY = T.top + bH / 2;
  const bU0 = oU0 - 0.15;
  const bV0 = oV0 - 0.15;
  const bV1 = T.v1;
  const bdV0 = -11.4; // door in the east face, v -11.4 .. -10.2
  const bdV1 = -10.2;
  kit.box(M.wall, bU0, bY, (bV0 + bV1) / 2, wt, bH, bV1 - bV0, { collide: true });
  kit.box(M.wall, (bU0 + T.u1) / 2, bY, bV0, T.u1 - bU0, bH, wt, { collide: true });
  kit.box(M.wall, (bU0 + T.u1) / 2, bY, bV1 - wt / 2, T.u1 - bU0, bH, wt, { collide: true });
  kit.box(M.wall, T.u1, bY, (bV0 + bdV0) / 2, wt, bH, bdV0 - bV0, { collide: true });
  kit.box(M.wall, T.u1, bY, (bdV1 + bV1) / 2, wt, bH, bV1 - bdV1, { collide: true });
  kit.box(M.wall, T.u1, T.top + 2.2 + (bH - 2.2) / 2, (bdV0 + bdV1) / 2, wt, bH - 2.2, bdV1 - bdV0);
  kit.box(
    M.roof,
    (bU0 + T.u1) / 2,
    T.top + bH + 0.08,
    (bV0 + bV1) / 2,
    T.u1 - bU0 + 0.3,
    0.16,
    bV1 - bV0 + 0.3,
  );
  kit.box(M.door, T.u1 + 0.5, T.top + 1.05, bdV0 + 0.05, 0.9, 2.1, 0.05, { yaw: 0.6 });
  kit.box(M.bulb, T.u1 + 0.15, T.top + 2.3, (bdV0 + bdV1) / 2, 0.08, 0.1, 0.16);
  // a landing at the top of F1 inside the bulkhead door (the door sill sits at roof level)
  landing(kit, M, oU0, T.u1 - wt, -11.2, -9.94, T.top, {});
  // the stairwell bulbs
  kit.box(M.bulb, 36.0, tMid + 2.3, -18.6, 0.12, 0.12, 0.12);
  kit.box(M.bulb, 36.0, T.top + 2.2, -12.0, 0.12, 0.12, 0.12);
  kit.build(group);

  // one real light in the stairwell (dark inside otherwise), warm
  const light = new THREE.PointLight('#ffcf8a', 7, 9, 2);
  const lp = P(36.0, -15.0);
  light.position.set(lp.x, tMid + 1.6, lp.z);
  group.add(light);
  game.scene.add(group);
  return {
    group,
    dispose() {
      kit.dispose();
      game.scene.remove(group);
      group.traverse((o) => {
        if (o.isMesh) o.geometry.dispose();
      });
      for (const m of Object.values(M)) {
        m.map?.dispose();
        m.dispose();
      }
    },
  };
}

// ---------------------------------------------------------------- the cafe's red CAFE awning (panel 7)
// The city shell already hangs a striped awning on the cafe lot (store-local x -4.7 .. 4.7, from the wall at z 3.9 out
// to z 5.45, 3.35 m high at the wall, 2.75 m at the edge). This one sits just outside it and hides it: red canvas, a
// scalloped valance, side cheeks, CAFE in white on the slope and on the valance. Built for the missions only.
export function buildCafeAwning(game, store) {
  const group = new THREE.Group();
  group.name = 'intro2:cafeAwning';
  group.position.set(store.center.x, store.baseY, store.center.z);
  group.rotation.y = store.facing;
  const red = '#a3161f';
  const fabric = canvasTex(512, 128, (g, w, h) => {
    g.fillStyle = red;
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 90; i++) {
      g.fillStyle = `rgba(0, 0, 0, ${0.03 + Math.random() * 0.04})`;
      g.fillRect(0, Math.random() * h, w, 1);
    }
  });
  const letters = canvasTex(1024, 256, (g, w, h) => {
    g.fillStyle = red;
    g.fillRect(0, 0, w, h);
    g.font = `900 ${Math.round(h * 0.7)}px "Arial Black", Impact, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = '#fbf4e4';
    g.fillText('CAFE', w / 2, h * 0.54);
  });
  const mFab = new THREE.MeshStandardMaterial({
    map: fabric,
    roughness: 0.9,
    side: THREE.DoubleSide,
  });
  const mTxt = new THREE.MeshStandardMaterial({
    map: letters,
    roughness: 0.9,
    side: THREE.DoubleSide,
  });
  const W = 9.9;
  const z0 = store.D / 2 + 0.02;
  const z1 = z0 + 1.85;
  const yT = 3.5;
  const yB = 2.84;
  const len = Math.sqrt((z1 - z0) * (z1 - z0) + (yT - yB) * (yT - yB));
  const tilt = Math.atan2(z1 - z0, yT - yB);
  // the slope: plain canvas either side of the lettered middle panel
  const side = (W - 3.4) / 2;
  for (const [x, w, m] of [
    [-(3.4 + side) / 2, side, mFab],
    [0, 3.4, mTxt],
    [(3.4 + side) / 2, side, mFab],
  ]) {
    const slope = new THREE.Mesh(new THREE.PlaneGeometry(w, len), m);
    slope.position.set(x, (yT + yB) / 2, (z0 + z1) / 2);
    slope.rotation.x = -tilt;
    group.add(slope);
  }
  // valance: straight band, then scallops
  const valance = new THREE.Mesh(new THREE.PlaneGeometry(W, 0.34), mFab);
  valance.position.set(0, yB - 0.17, z1);
  group.add(valance);
  const word = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.34), mTxt);
  word.position.set(0, yB - 0.17, z1 + 0.006);
  group.add(word);
  const n = Math.round(W / 0.42);
  const scallop = new THREE.CircleGeometry(W / n / 2, 10, Math.PI, Math.PI);
  for (let i = 0; i < n; i++) {
    const s = new THREE.Mesh(scallop, mFab);
    s.position.set(-W / 2 + (i + 0.5) * (W / n), yB - 0.34, z1);
    group.add(s);
  }
  // side cheeks (triangles down to the valance)
  const cheek = new THREE.BufferGeometry();
  cheek.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(
      [0, yT, z0, 0, yB, z1, 0, yB - 0.34, z1, 0, yB - 0.34, z1, 0, yT - 0.3, z0, 0, yT, z0],
      3,
    ),
  );
  cheek.setAttribute(
    'uv',
    new THREE.Float32BufferAttribute([0, 1, 1, 0.6, 1, 0, 1, 0, 0, 0.8, 0, 1], 2),
  );
  cheek.computeVertexNormals();
  for (const x of [-W / 2, W / 2]) {
    const c = new THREE.Mesh(cheek, mFab);
    c.position.x = x;
    group.add(c);
  }
  // frame: a steel bar along the wall and the front edge
  const steel = new THREE.MeshStandardMaterial({
    color: '#202226',
    roughness: 0.5,
    metalness: 0.7,
  });
  for (const [y, z] of [
    [yT + 0.02, z0 + 0.03],
    [yB + 0.02, z1 - 0.03],
  ]) {
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, W, 8), steel);
    bar.rotation.z = Math.PI / 2;
    bar.position.set(0, y, z);
    group.add(bar);
  }
  group.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  game.scene.add(group);
  return {
    group,
    dispose() {
      game.scene.remove(group);
      group.traverse((o) => {
        if (o.isMesh) o.geometry.dispose();
      });
      fabric.dispose();
      letters.dispose();
      mFab.dispose();
      mTxt.dispose();
      steel.dispose();
    },
  };
}
