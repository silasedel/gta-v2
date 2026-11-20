// The gang's island camp in the Everglades (storyboard panels 10-11), built only while intro2.swamp runs and disposed
// with it (ctx.track): a stilted wooden shack with a porch and a warm lamp (Cisco is tied up inside), a weathered red /
// grey tin shack, a trailer with the stolen cash, rusty barrels, a camp fire, the gang's airboats, a landing on the
// north shore and the far dock on the south shore where the floatplane waits. Around it a dense stand of bald cypress
// with hanging moss, tall grass, low mist and god rays slanting through the canopy.
//
//   const camp = await buildSwampCamp(game, { x, z });
//   camp.spots       world points the mission uses (landing, door, cisco, trailer, cash, dock, plane, posts ...)
//   camp.cover(x, z) true in tall grass / under the trees (the crew sees less there)
//   camp.update(dt)  flickers the fire, drifts the mist, fades the shafts
//   camp.dispose()
//
// Everything sits in the world frame (axis aligned, so the set kit's box colliders fit): local (lx, lz) = offsets from
// the camp center, north (-z) is the landing side, south (+z) the far dock.
import * as THREE from 'three';
import { createSet } from '../../sets/setKit.js';
import { loadModel, partsOf } from '../../../world/everglades/models.js';
import { loadMissionProp } from '../../props.js';
import { mossTexture } from '../../../world/everglades/textures.js';

const TREE_N = 96; // bald cypress around the clearing
const GRASS_N = 2600; // tall grass clumps
const CLEAR_R = 19; // the open yard of the camp
const WOOD_R = 78; // how far the dressing reaches

// a small deterministic random generator (the camp looks the same on every retry)
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export async function buildSwampCamp(game, at) {
  const city = game.city;
  const sea = city?.seaLevel ?? -0.12;
  const C = { x: at.x, z: at.z };
  const ground = (x, z) => {
    const y = city?.groundHeightAt?.(x, z);
    return Number.isFinite(y) ? y : 0;
  };
  const isWater = (x, z) => !!city?.isWater?.(x, z);
  const veg = game.vegetation;
  const group = new THREE.Group();
  group.name = 'intro2:swampCamp';
  const own = { geometries: [], materials: [], textures: [] };
  const colliders = [];
  const blocks = [];
  const lights = [];
  const flicker = [];
  const shafts = [];
  const mist = [];
  const random = rng(7151);

  // ---------------------------------------------------------------- colliders (trunks, models)
  let body = null;
  function ensureBody() {
    if (body || !game.world || !game.RAPIER) return body;
    body = game.world.createRigidBody(game.RAPIER.RigidBodyDesc.fixed());
    return body;
  }
  function addBox(x, y, z, hx, hy, hz, yaw) {
    const R = game.RAPIER;
    const b = ensureBody();
    if (!b) return;
    const h = yaw / 2;
    const c = game.world.createCollider(
      R.ColliderDesc.cuboid(hx, hy, hz)
        .setTranslation(x, y + hy, z)
        .setRotation({ x: 0, y: Math.sin(h), z: 0, w: Math.cos(h) }),
      b,
    );
    colliders.push(c);
  }
  function addCylinder(x, y, z, r, hh) {
    const R = game.RAPIER;
    const b = ensureBody();
    if (!b) return;
    const c = game.world.createCollider(
      R.ColliderDesc.cylinder(hh, r).setTranslation(x, y + hh, z),
      b,
    );
    colliders.push(c);
  }

  // ---------------------------------------------------------------- where the shores are
  // walk from the center north and south until the water: the landing and the far dock follow the map if it changes
  function shoreFrom(dx, dz) {
    for (let d = 8; d < 220; d += 2) {
      if (isWater(C.x + dx * d, C.z + dz * d))
        return { x: C.x + dx * (d - 2), z: C.z + dz * (d - 2) };
    }
    return { x: C.x + dx * 60, z: C.z + dz * 60 };
  }
  // the landing side (at.landing = [dx, dz], an axis: north [0, -1] by default); the far dock is always south
  const LD = at.landing || [0, -1];
  const north = shoreFrom(LD[0], LD[1]);
  const south = shoreFrom(0, 1);
  const y0 = ground(C.x, C.z);

  // a material over one of our canvas textures (disposed with the camp)
  function ownMat(tex, meters, o = {}) {
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = 4;
    own.textures.push(tex);
    const m = new THREE.MeshStandardMaterial({
      map: tex,
      roughness: o.rough ?? 0.9,
      metalness: o.metal ?? 0,
    });
    m.defines = { NO_WET: '' };
    m.userData.meters = meters;
    own.materials.push(m);
    return m;
  }

  // ---------------------------------------------------------------- the buildings (set kit: merged, colliders, lights)
  const S = createSet(game, { x: C.x, y: y0, z: C.z, name: 'swampCamp' });
  // weathered boards and corrugated tin, drawn here (2 m per texture repeat, the set kit projects the UVs)
  const planks = ownMat(plankTexture([96, 84, 66], 11), 2, { rough: 0.95 });
  const deck = ownMat(plankTexture([112, 98, 76], 29, true), 2, { rough: 0.95 });
  const tinRed = ownMat(tinTexture([142, 52, 38], 3), 2, { rough: 0.62, metal: 0.35 });
  const tinGrey = ownMat(tinTexture([132, 134, 128], 8), 2, { rough: 0.55, metal: 0.45 });
  const tinRust = ownMat(tinTexture([112, 70, 44], 5, 0.9), 2, { rough: 0.75, metal: 0.3 });
  const darkWood = S.flat(0x2e261d, { rough: 0.95 });
  const rope = S.flat(0x8a7350, { rough: 1 });
  const bulb = S.glow(0xffc67a, 6);
  const windowGlow = S.glow(0xffa95a, 1.2);

  // --- the stilted shack (gang HQ): room x -9..-3, z -6.5..-1.5, floor at FY; porch to the north, steps down
  const FY = 1.35;
  const H = 2.5; // wall height
  const T = 0.12; // wall thickness
  // stilts
  for (const sx of [-9, -6, -3]) {
    for (const sz of [-8.5, -6.5, -4, -1.5]) {
      S.box(darkWood, sx - 0.1, -0.4, sz - 0.1, sx + 0.1, FY, sz + 0.1);
    }
  }
  // floor + porch deck
  S.box(deck, -9.1, FY - 0.12, -6.5, -2.9, FY, -1.4);
  S.box(deck, -9.1, FY - 0.12, -8.6, -2.9, FY, -6.5);
  // walls: back (south), sides, front (north) with a door gap at x -6.5..-5.4 and a window at x -4.6..-3.6
  S.box(planks, -9, FY, -1.5 - T, -3, FY + H, -1.5);
  S.box(planks, -9, FY, -6.5, -9 + T, FY + H, -1.5);
  S.box(planks, -3 - T, FY, -6.5, -3, FY + H, -1.5);
  S.box(planks, -9, FY, -6.5, -6.5, FY + H, -6.5 + T);
  S.box(planks, -5.4, FY, -6.5, -4.6, FY + H, -6.5 + T);
  S.box(planks, -3.6, FY, -6.5, -3, FY + H, -6.5 + T);
  S.box(planks, -4.6, FY, -6.5, -3.6, FY + 0.9, -6.5 + T);
  S.box(planks, -4.6, FY + 1.8, -6.5, -3.6, FY + H, -6.5 + T);
  S.box(planks, -6.5, FY + 2.1, -6.5, -5.4, FY + H, -6.5 + T);
  S.box(windowGlow, -4.6, FY + 0.9, -6.46, -3.6, FY + 1.8, -6.44, { collide: false });
  // roof: a tin shed roof falling to the back, eaves over the porch (looks only) + a ceiling collider
  S.rbox(tinRust, -6, FY + H + 0.45, -4.6, 6.8, 0.06, 8.4, 0, { pitch: 0.12 });
  S.solid(-9, FY + H, -6.5, -3, FY + H + 0.1, -1.5);
  // porch rail and posts
  for (const px of [-9, -3]) S.box(darkWood, px - 0.07, FY, -8.6, px + 0.07, FY + H + 0.3, -8.45);
  S.box(darkWood, -9, FY + 0.85, -8.6, -6.7, FY + 0.95, -8.5, { collide: false });
  S.box(darkWood, -5.2, FY + 0.85, -8.6, -3, FY + 0.95, -8.5, { collide: false });
  // steps from the yard up to the porch (x -6.6..-5.4), each 0.27 m
  const STEPS = 5;
  for (let i = 0; i < STEPS; i++) {
    const top = FY - (STEPS - 1 - i) * (FY / STEPS);
    const z1 = -8.6 - (STEPS - 1 - i) * 0.32;
    S.box(deck, -6.6, -0.2, z1 - 0.32, -5.4, top, z1);
  }
  // inside: a chair in the middle (Cisco), a table with a lantern, crates
  // the post Cisco is tied to (he sits on the floor against it)
  S.box(darkWood, -6.2, FY, -2.75, -6.0, FY + H, -2.55);
  S.box(planks, -8.6, FY, -3.2, -7.4, FY + 0.78, -2.0);
  S.box(bulb, -8.1, FY + 0.82, -2.7, -7.96, FY + 1.02, -2.56, { collide: false });
  S.box(planks, -4.2, FY, -2.6, -3.3, FY + 0.6, -1.7);
  // the porch lamp (a warm bulb beside the door) and the lantern inside
  S.box(bulb, -4.9, FY + 2.0, -6.62, -4.74, FY + 2.18, -6.52, { collide: false });
  lights.push(S.light(-4.82, FY + 1.95, -7.0, 0xffad5c, 9, 11));
  lights.push(S.light(-8.0, FY + 1.3, -2.6, 0xffa050, 4, 6));

  // --- the weathered red / grey tin shack: x 6..11, z -6..-1, closed
  S.box(tinRed, 6, 0, -6, 11, 2.6, -5.9);
  S.box(tinGrey, 6, 0, -1.1, 11, 2.6, -1);
  S.box(tinRed, 6, 0, -6, 6.1, 2.6, -1);
  S.box(tinGrey, 10.9, 0, -6, 11, 2.6, -1);
  S.rbox(tinRust, 8.5, 2.75, -3.5, 5.6, 0.06, 5.6, 0, { roll: 0.08 });
  S.solid(6, 2.6, -6, 11, 2.7, -1);
  S.box(darkWood, 7.6, 0, -6.05, 8.6, 2.0, -6.0, { collide: false }); // the door
  S.box(windowGlow, 9.3, 1.2, -6.06, 10.2, 1.7, -6.02, { collide: false });

  // --- the camp fire: a ring of stones, logs, embers
  const FIRE = { x: 1.5, z: 3 };
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    S.rbox(
      darkWood,
      FIRE.x + Math.cos(a) * 0.7,
      0.1,
      FIRE.z + Math.sin(a) * 0.7,
      0.3,
      0.2,
      0.25,
      a,
    );
  }
  S.rbox(darkWood, FIRE.x, 0.18, FIRE.z, 1.2, 0.16, 0.16, 0.4);
  S.rbox(darkWood, FIRE.x, 0.22, FIRE.z, 1.1, 0.15, 0.15, 2.1);
  const embers = S.glow(0xff7a2a, 5);
  S.rbox(embers, FIRE.x, 0.12, FIRE.z, 0.6, 0.05, 0.6, 0.3);
  const fireLight = S.light(FIRE.x, 1.0, FIRE.z, 0xff8a3a, 10, 12);
  lights.push(fireLight);
  flicker.push({ l: fireLight, base: 10, k: 0.35 });
  // log benches by the fire
  S.rbox(planks, FIRE.x - 2.6, 0.22, FIRE.z, 0.4, 0.44, 2.2, 0.2);
  S.rbox(planks, FIRE.x + 1.6, 0.22, FIRE.z + 2.4, 2.2, 0.44, 0.4, 0.3);

  // --- the landing (north shore) and the far dock (south shore): plank walkways on piles out over the water
  // a pier from shore point p along the axis (dx, dz) for len meters, w wide
  function pier(p, dx, dz, len, w) {
    const alongX = Math.abs(dx) > Math.abs(dz);
    const lx = p.x - C.x;
    const lz = p.z - C.z;
    const a0 = alongX ? lx : lz;
    const a1 = a0 + (alongX ? dx : dz) * len;
    const aA = Math.min(a0, a1);
    const aB = Math.max(a0, a1);
    const c = alongX ? lz : lx;
    const top = sea + 0.55 - y0;
    // box in (along, across) coordinates
    const put = (mat, u0, y0b, v0, u1, y1b, v1) => {
      if (alongX) S.box(mat, u0, y0b, v0, u1, y1b, v1);
      else S.box(mat, v0, y0b, u0, v1, y1b, u1);
    };
    put(deck, aA, top - 0.12, c - w / 2, aB, top, c + w / 2);
    for (let u = aA + 0.6; u < aB; u += 2.4) {
      put(darkWood, u - 0.1, top - 2, c - w / 2 - 0.05, u + 0.1, top + 0.5, c - w / 2 + 0.15);
      put(darkWood, u - 0.1, top - 2, c + w / 2 - 0.15, u + 0.1, top + 0.5, c + w / 2 + 0.05);
    }
    return { x: p.x + dx * len, z: p.z + dz * len, top: top + y0 };
  }
  const landingEnd = pier(north, LD[0], LD[1], 7, 1.8);
  const dockEnd = pier(south, 0, 1, 14, 2.4);
  // a rope coiled on the far dock post
  S.cyl(rope, south.x - C.x + 1.1, sea + 0.75 - y0, south.z - C.z + 10, 0.2, 0.12, { seg: 10 });

  await S.ready(4000);
  S.build();
  // outdoors the set casts and takes shadows
  S.root.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });

  // ---------------------------------------------------------------- the user's models (shared, cached by the everglades
  // module: only the clones are ours)
  async function place(path, lx, lz, o = {}) {
    const src = await loadModel(path);
    if (!src) return null;
    const m = src.clone(true);
    const x = C.x + lx;
    const z = C.z + lz;
    const y = o.y ?? (o.water ? sea + (o.lift || 0) : ground(x, z) + (o.lift || 0));
    m.position.set(x, y, z);
    m.rotation.y = o.yaw || 0;
    if (o.tip) m.rotation.z = Math.PI / 2;
    if (o.s) m.scale.setScalar(o.s);
    if (o.tint) {
      // our own darker copies of the model's materials (the shared originals stay as they are)
      m.traverse((n) => {
        if (!n.isMesh) return;
        n.material = n.material.clone();
        n.material.color?.multiplyScalar(o.tint);
        own.materials.push(n.material);
      });
    }
    group.add(m);
    if (o.col) addBox(x, y, z, o.col[0], o.col[1], o.col[2], o.yaw || 0);
    return m;
  }
  const loads = [
    place('everglades/rv_trailer.glb', 12, 8, { col: [4.2, 1.9, 1.75] }),
    place('everglades/drum_rust.glb', 2.6, -9.2, { yaw: 0.4, col: [0.3, 0.45, 0.3] }),
    place('everglades/drum_rust.glb', 3.3, -9.7, { yaw: 1.9, col: [0.3, 0.45, 0.3] }),
    place('everglades/drum_blue.glb', 2.9, -10.4, { yaw: 2.7, col: [0.3, 0.45, 0.3] }),
    place('everglades/drum_rust.glb', 4.1, -9.0, { yaw: 2.2, tip: true, lift: 0.31 }),
    place('everglades/drum_rust.glb', -1.5, 8.5, { yaw: 0.1, col: [0.3, 0.45, 0.3] }),
    place('everglades/drum_rust.glb', -0.8, 9.1, { yaw: 1.2, col: [0.3, 0.45, 0.3] }),
    place('everglades/drum_rust.glb', 12.2, -7.4, { yaw: 1.2, col: [0.3, 0.45, 0.3] }),
    place('everglades/drum_blue.glb', 12.8, -6.7, { yaw: 0.5, col: [0.3, 0.45, 0.3] }),
    place('everglades/fuel_tank.glb', -13, 8, { yaw: 1.3, col: [1.6, 0.7, 0.55] }),
    place('everglades/clothesline.glb', -13.5, 1, { yaw: 0.2 }),
    place('everglades/junk_car.glb', 16, -10, { yaw: 0.6, col: [2.2, 0.6, 0.9] }),
    place('everglades/fence_tin.glb', -16, -3, {
      yaw: Math.PI / 2 + 0.05,
      col: [2.25, 1.5, 0.08],
      tint: 0.38,
    }),
    place('everglades/fence_tin.glb', -16.2, 1.5, {
      yaw: Math.PI / 2 - 0.04,
      col: [2.25, 1.5, 0.08],
    }),
    place('everglades/fence_tin.glb', -15.9, 6, {
      yaw: Math.PI / 2 + 0.1,
      col: [2.25, 1.5, 0.08],
      tint: 0.38,
    }),
    place('everglades/gas_can.glb', -2.4, -9.8, { yaw: 0.6 }),
    place('everglades/mossy_stone.glb', -18, 12, { yaw: 1.1, s: 0.8 }),
    place('keys/crate.glb', -2.2, -3.4, { yaw: 0.3, col: [0.3, 0.3, 0.3] }),
    place('keys/crate.glb', -1.6, -2.7, { yaw: 1.1, col: [0.3, 0.3, 0.3] }),
    place('keys/crate.glb', -2.0, -3.0, { yaw: 2.0, lift: 0.6 }),
    place('keys/coolers.glb', 3.6, 4.6, { yaw: 1.9 }),
    place('keys/lawn_chair.glb', 4.1, 1.4, { yaw: 2.6 }),
    // the gang's airboats tied up beside the far dock, an old one pulled up at the landing
    place('everglades/airboat_classic.glb', south.x - C.x - 4.2, south.z - C.z + 7, {
      water: true,
      yaw: Math.PI / 2 + 0.1,
    }),
    place('everglades/airboat_classic.glb', south.x - C.x + 4.4, south.z - C.z + 11, {
      water: true,
      yaw: Math.PI / 2 - 0.15,
    }),
  ];
  // the stolen cash in the trailer doorway: an open case and a pile on a crate
  const cashAt = { x: C.x + 9.6, z: C.z + 5.6 };
  loads.push(
    loadMissionProp('cash_case_open').then((m) => {
      m.position.set(cashAt.x, ground(cashAt.x, cashAt.z) + 0.6, cashAt.z);
      m.rotation.y = 2.8;
      group.add(m);
      return m;
    }),
    place('keys/crate.glb', 9.6, 5.6, { yaw: 0.2 }),
  );
  const cashObj = await loads[loads.length - 2].catch(() => null);
  await Promise.all(loads.map((p) => p.catch(() => null)));
  // trampled mud in the yard and along the trails
  const mudTex = mudTexture();
  own.textures.push(mudTex);
  const mudMat = new THREE.MeshStandardMaterial({
    map: mudTex,
    transparent: true,
    depthWrite: false,
    roughness: 0.92,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -4,
  });
  mudMat.defines = { NO_WET: '' };
  own.materials.push(mudMat);
  const mudGeo = new THREE.CircleGeometry(CLEAR_R + 5, 40);
  mudGeo.rotateX(-Math.PI / 2);
  own.geometries.push(mudGeo);
  const mud = new THREE.Mesh(mudGeo, mudMat);
  mud.position.set(C.x, y0 + 0.03, C.z);
  mud.receiveShadow = true;
  mud.renderOrder = 1;
  group.add(mud);
  for (const end of [north, south]) {
    const dx = end.x - C.x;
    const dz = end.z - C.z;
    const len = Math.sqrt(dx * dx + dz * dz);
    const g = new THREE.PlaneGeometry(3.2, Math.max(1, len - CLEAR_R + 6));
    g.rotateX(-Math.PI / 2);
    own.geometries.push(g);
    const m = new THREE.Mesh(g, mudMat);
    const mid = (CLEAR_R + len) / 2;
    m.position.set(C.x + (dx / len) * mid, y0 + 0.035, C.z + (dz / len) * mid);
    m.rotation.y = Math.atan2(dx, dz);
    m.receiveShadow = true;
    m.renderOrder = 1;
    group.add(m);
  }

  // ---------------------------------------------------------------- the cypress stand (instanced) with trunk colliders
  const trees = [];
  const instanced = []; // instanced meshes over the shared tree geometry: only their instance buffers are ours
  const path = (x, z) => {
    // keep the trail from the landing to the yard and the yard to the dock open
    const lx = x - C.x;
    const lz = z - C.z;
    // across / along the landing axis
    const along = lx * LD[0] + lz * LD[1];
    const across = Math.abs(lx * LD[1] - lz * LD[0]);
    const reach = (north.x - C.x) * LD[0] + (north.z - C.z) * LD[1];
    if (along > 0 && across < 3.2 && along < reach + 4) return true;
    if (lz > 0 && Math.abs(lx - (south.x - C.x)) < 3 && lz < south.z - C.z + 2) return true;
    return false;
  };
  for (let tries = 0; trees.length < TREE_N && tries < TREE_N * 30; tries++) {
    const a = random() * Math.PI * 2;
    const r = CLEAR_R + 3 + Math.pow(random(), 0.8) * (WOOD_R - CLEAR_R);
    const x = C.x + Math.cos(a) * r;
    const z = C.z + Math.sin(a) * r;
    if (isWater(x, z) || path(x, z)) continue;
    if (trees.some((t) => (t.x - x) ** 2 + (t.z - z) ** 2 < 5.5 * 5.5)) continue;
    trees.push({ x, z, y: ground(x, z), s: 1.7 + random() * 1.1, yaw: random() * Math.PI * 2 });
  }
  // a few right at the edge of the yard frame the shack
  for (const [lx, lz, s] of [
    [-14, -12, 2.4],
    [-2, -15, 2.1],
    [14, -14, 2.6],
    [-17, 12, 2.2],
    [18, 3, 2.3],
  ]) {
    trees.push({ x: C.x + lx, z: C.z + lz, y: ground(C.x + lx, C.z + lz), s, yaw: lx * 0.7 });
  }
  const cypress = await loadModel('everglades/bald_cypress.glb');
  if (cypress) {
    const parts = partsOf(cypress);
    const M = new THREE.Matrix4();
    const Q = new THREE.Quaternion();
    const V = new THREE.Vector3();
    const Sc = new THREE.Vector3();
    for (const p of parts) {
      const im = new THREE.InstancedMesh(p.geometry, p.material, trees.length);
      trees.forEach((t, i) => {
        Q.setFromAxisAngle(V.set(0, 1, 0), t.yaw);
        M.compose(V.set(t.x, t.y - 0.15, t.z), Q, Sc.set(t.s, t.s * 1.12, t.s));
        im.setMatrixAt(i, M.multiply(p.matrix));
      });
      im.castShadow = true;
      im.receiveShadow = true;
      im.computeBoundingSphere();
      group.add(im);
      instanced.push(im);
    }
    for (const t of trees) addCylinder(t.x, t.y, t.z, 0.32 * t.s, 4);
  }

  // ---------------------------------------------------------------- live oaks around the yard (the vegetation library)
  const oaks = [];
  if (veg?.place) {
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + 0.4;
      const r = CLEAR_R + 6 + random() * 10;
      const x = C.x + Math.cos(a) * r;
      const z = C.z + Math.sin(a) * r;
      if (isWater(x, z) || path(x, z)) continue;
      try {
        const o = veg.place('liveoak', x, z, { s: 1.1 + random() * 0.4 });
        oaks.push({ o, x, z, h: 14 });
      } catch (e) {
        /* the library may not have the oaks */
      }
    }
  }

  // ---------------------------------------------------------------- Spanish moss curtains in the crowns near the yard
  const mossTex = mossTexture();
  own.textures.push(mossTex);
  const mossMat = new THREE.MeshStandardMaterial({
    map: mossTex,
    alphaTest: 0.38,
    side: THREE.DoubleSide,
    roughness: 1,
    color: 0x9a9f86,
  });
  mossMat.defines = { NO_WET: '' };
  own.materials.push(mossMat);
  const mossGeo = mossCards();
  own.geometries.push(mossGeo);
  const hangers = trees
    .filter((t) => (t.x - C.x) ** 2 + (t.z - C.z) ** 2 < 55 * 55)
    .map((t) => ({ x: t.x, z: t.z, y: t.y, h: 7.34 * 1.12 * t.s, r: 1.5 * t.s }))
    .concat(oaks.map((o) => ({ x: o.x, z: o.z, y: ground(o.x, o.z), h: o.h, r: 4 })));
  const MOSS_N = hangers.length * 6;
  const moss = new THREE.InstancedMesh(mossGeo, mossMat, Math.max(1, MOSS_N));
  {
    const M = new THREE.Matrix4();
    const Q = new THREE.Quaternion();
    const V = new THREE.Vector3();
    const Sc = new THREE.Vector3();
    let n = 0;
    for (const t of hangers) {
      for (let k = 0; k < 6; k++) {
        const a = random() * Math.PI * 2;
        const rr = t.r * (0.4 + random() * 0.6);
        const y = t.y + t.h * (0.45 + random() * 0.35);
        Q.setFromAxisAngle(V.set(0, 1, 0), random() * Math.PI);
        M.compose(
          V.set(t.x + Math.cos(a) * rr, y, t.z + Math.sin(a) * rr),
          Q,
          Sc.set(0.8 + random() * 0.8, 1.6 + random() * 2.2, 1),
        );
        moss.setMatrixAt(n++, M);
      }
    }
    moss.count = n;
  }
  moss.castShadow = true;
  moss.computeBoundingSphere();
  group.add(moss);

  // ---------------------------------------------------------------- tall grass (crossed cards, instanced)
  const grassTex = grassTexture();
  const grassMat = new THREE.MeshStandardMaterial({
    map: grassTex,
    alphaTest: 0.42,
    side: THREE.DoubleSide,
    roughness: 0.95,
    color: 0xb8b48a,
  });
  grassMat.defines = { NO_WET: '' };
  own.textures.push(grassTex);
  own.materials.push(grassMat);
  const card = new THREE.PlaneGeometry(1.3, 1, 1, 1);
  card.translate(0, 0.5, 0);
  const card2 = card.clone().rotateY(Math.PI / 2);
  const grassGeo = mergeTwo(card, card2);
  card.dispose();
  card2.dispose();
  own.geometries.push(grassGeo);
  const grass = new THREE.InstancedMesh(grassGeo, grassMat, GRASS_N);
  const grassPts = [];
  {
    const M = new THREE.Matrix4();
    const Q = new THREE.Quaternion();
    const V = new THREE.Vector3();
    const Sc = new THREE.Vector3();
    const col = new THREE.Color();
    let n = 0;
    for (let tries = 0; n < GRASS_N && tries < GRASS_N * 6; tries++) {
      const a = random() * Math.PI * 2;
      const r = 6 + Math.sqrt(random()) * (WOOD_R + 8);
      const x = C.x + Math.cos(a) * r;
      const z = C.z + Math.sin(a) * r;
      const lx = x - C.x;
      const lz = z - C.z;
      // the yard is trampled short: grass only toward its edge, none on the paths or under the buildings
      if (r < CLEAR_R - 4 && random() > 0.08) continue;
      if (lx > -10 && lx < -2 && lz > -11 && lz < -1) continue;
      if (lx > 5 && lx < 17 && lz > -7 && lz < 10) continue;
      if (path(x, z) && random() > 0.15) continue;
      const wet = isWater(x, z);
      // reeds only in the shallows right at the bank
      if (wet && (r > WOOD_R || (isWater(x + 3, z) && isWater(x - 3, z) && isWater(x, z + 3)))) {
        continue;
      }
      const h = (r < CLEAR_R ? 0.6 : 1.1) + random() * (r < CLEAR_R ? 0.4 : 0.9);
      Q.setFromAxisAngle(V.set(0, 1, 0), random() * Math.PI);
      M.compose(
        V.set(x, wet ? sea - 0.05 : ground(x, z) - 0.05, z),
        Q,
        Sc.set(0.8 + random() * 0.6, h, 0.8 + random() * 0.6),
      );
      grass.setMatrixAt(n, M);
      col.setHSL(0.14 + random() * 0.06, 0.35 + random() * 0.2, 0.35 + random() * 0.25);
      grass.setColorAt(n, col);
      grassPts.push(x, z);
      n++;
    }
    grass.count = n;
  }
  grass.castShadow = false;
  grass.receiveShadow = true;
  grass.computeBoundingSphere();
  group.add(grass);

  // ---------------------------------------------------------------- god rays and ground mist
  const shaftTex = shaftTexture();
  own.textures.push(shaftTex);
  const shaftMat = new THREE.MeshBasicMaterial({
    map: shaftTex,
    color: 0xffd9a0,
    transparent: true,
    opacity: 0.16,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: true,
  });
  own.materials.push(shaftMat);
  const shaftGeo = new THREE.PlaneGeometry(1, 1);
  shaftGeo.translate(0, -0.5, 0); // hangs from its top (in the canopy) down along the light
  own.geometries.push(shaftGeo);
  const SHAFT_SPOTS = [
    [-12, -10, 3.2],
    [-4, -14, 2.4],
    [6, -12, 2.8],
    [14, -2, 2.2],
    [-10, 6, 2.6],
    [3, 12, 3.4],
    [-1, -24, 2.2],
    [11, 16, 2.0],
    [-20, -2, 2.4],
  ];
  for (const [lx, lz, w] of SHAFT_SPOTS) {
    for (let k = 0; k < 2; k++) {
      const m = new THREE.Mesh(shaftGeo, shaftMat);
      m.position.set(C.x + lx, y0 + 15, C.z + lz);
      m.scale.set(w, 22, 1);
      m.userData.k = k;
      m.userData.phase = random() * 6;
      m.renderOrder = 3;
      m.frustumCulled = false;
      m.userData.noDetailCull = true;
      group.add(m);
      shafts.push(m);
    }
  }
  const mistTex = mistTexture();
  own.textures.push(mistTex);
  const mistMat = new THREE.MeshBasicMaterial({
    map: mistTex,
    color: 0xd8dccb,
    transparent: true,
    opacity: 0.1,
    depthWrite: false,
    fog: true,
  });
  own.materials.push(mistMat);
  const mistGeo = new THREE.PlaneGeometry(18, 18);
  mistGeo.rotateX(-Math.PI / 2);
  own.geometries.push(mistGeo);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 + random();
    const r = 16 + random() * 40;
    const m = new THREE.Mesh(mistGeo, mistMat);
    const x = C.x + Math.cos(a) * r;
    const z = C.z + Math.sin(a) * r;
    m.position.set(x, Math.max(ground(x, z), sea) + 0.25 + random() * 0.3, z);
    m.rotation.y = random() * 6;
    m.userData.v = 0.08 + random() * 0.1;
    m.userData.a = a;
    m.renderOrder = 2;
    group.add(m);
    mist.push(m);
  }

  // keep the countryside / glades plants out of the yard and off the docks while the camp stands
  if (veg?.block) {
    blocks.push(veg.block(C.x, C.z, CLEAR_R - 2));
    blocks.push(veg.block(south.x, south.z + 6, 8));
    blocks.push(veg.block(north.x + LD[0] * 3, north.z + LD[1] * 3, 5));
  }

  game.scene.add(group);
  try {
    game.shaderWarmWrap?.(group);
  } catch (e) {
    /* optional */
  }

  // ---------------------------------------------------------------- per frame
  const sunDir = new THREE.Vector3();
  const Q1 = new THREE.Quaternion();
  const Q2 = new THREE.Quaternion();
  const toSun = new THREE.Vector3();
  const DOWN = new THREE.Vector3(0, -1, 0);
  let t = 0;
  function update(dt) {
    t += dt;
    for (const f of flicker) {
      f.l.intensity =
        f.base * (1 + Math.sin(t * 13.1) * f.k * 0.4 + Math.sin(t * 7.3 + 1.3) * f.k * 0.35);
    }
    // the shafts lean along the light: the plane's long axis points away from the sun, its face toward the camera
    const env = game.env;
    if (env?.sunDir) sunDir.copy(env.sunDir);
    else sunDir.set(0.4, 0.6, 0.3);
    const low = Math.max(0, Math.min(1, (sunDir.y - 0.02) / 0.25));
    const strength = (env?.dayFactor ?? 1) * (0.4 + 0.6 * (1 - low * 0.6));
    const cam = game.camera?.position;
    Q1.setFromUnitVectors(DOWN, toSun.copy(sunDir).negate().normalize());
    for (const m of shafts) {
      m.quaternion.copy(Q1);
      if (cam) {
        // turn about the light axis toward the camera (a billboard around one axis), the second card crossed
        const axis = sunDir;
        const toCam = Math.atan2(cam.x - m.position.x, cam.z - m.position.z);
        Q2.setFromAxisAngle(axis, toCam + m.userData.k * Math.PI * 0.5);
        m.quaternion.premultiply(Q2);
      }
      const pulse = 0.75 + 0.25 * Math.sin(t * 0.35 + m.userData.phase);
      m.material.opacity = 0.11 * strength * pulse;
      m.visible = strength > 0.05;
    }
    for (const m of mist) {
      m.userData.a += dt * m.userData.v * 0.02;
      m.rotation.y += dt * 0.01;
    }
  }

  // ---------------------------------------------------------------- the spots the mission uses
  const W = (lx, lz, heading = 0) => ({ x: C.x + lx, z: C.z + lz, heading });
  const spots = {
    center: W(0, 0),
    north,
    south,
    // the boat ties up off the end of the landing, its bow toward the island
    landing: {
      x: landingEnd.x + LD[0] * 4,
      z: landingEnd.z + LD[1] * 4,
      heading: Math.atan2(-LD[0], -LD[1]),
    },
    landingFoot: {
      x: north.x - LD[0] * 2,
      z: north.z - LD[1] * 2,
      heading: Math.atan2(-LD[0], -LD[1]),
    },
    trailHead: {
      x: (north.x + C.x) / 2,
      z: (north.z + C.z) / 2,
      heading: Math.atan2(-LD[0], -LD[1]),
    },
    yardEdge: W(LD[0] * (CLEAR_R - 2), LD[1] * (CLEAR_R - 2), Math.atan2(-LD[0], -LD[1])),
    porch: { x: C.x - 6, y: y0 + FY, z: C.z - 7.6, heading: 0 },
    door: { x: C.x - 5.95, y: y0 + FY, z: C.z - 6.9, heading: 0 },
    inside: { x: C.x - 5.95, y: y0 + FY, z: C.z - 5.0, heading: 0 },
    cisco: { x: C.x - 6.1, y: y0 + FY, z: C.z - 3.3, heading: Math.PI },
    trailer: W(9.8, 5.0, 0),
    cash: { x: cashAt.x, z: cashAt.z },
    fire: W(FIRE.x, FIRE.z),
    dock: { x: south.x, y: dockEnd.top + 0.05, z: south.z + 4, heading: 0 },
    dockEnd: { x: dockEnd.x, y: dockEnd.top + 0.05, z: dockEnd.z - 1, heading: 0 },
    plane: { x: south.x + 7, z: south.z + 16, heading: Math.PI / 2 },
    floorY: y0 + FY,
  };

  // in tall grass or among the trees (not in the open yard): the crew sees less of him there
  function cover(x, z) {
    const dx = x - C.x;
    const dz = z - C.z;
    return dx * dx + dz * dz > CLEAR_R * CLEAR_R;
  }

  function dispose() {
    try {
      S.dispose();
    } catch (e) {
      /* */
    }
    if (body) {
      try {
        game.world.removeRigidBody(body);
      } catch (e) {
        /* the world was reset */
      }
      body = null;
    }
    group.parent?.remove(group);
    for (const g of own.geometries) g?.dispose?.();
    for (const m of own.materials) m.dispose();
    for (const tx of own.textures) tx.dispose();
    grass.dispose?.();
    moss.dispose?.();
    for (const o of oaks) o.o.remove?.();
    oaks.length = 0;
    for (const im of instanced) im.dispose?.();
    for (const id of blocks) veg?.unblock?.(id);
    blocks.length = 0;
    colliders.length = 0;
    shafts.length = 0;
    mist.length = 0;
  }

  return { group, spots, cover, update, dispose, cash: cashObj, lights, trees: trees.length };
}

// two crossed cards hanging from y = 0 down to y = -1 (one moss curtain)
function mossCards() {
  const a = new THREE.PlaneGeometry(1, 1);
  a.translate(0, -0.5, 0);
  const b = a.clone().rotateY(Math.PI / 2);
  const g = mergeTwo(a, b);
  a.dispose();
  b.dispose();
  return g;
}

// two plane geometries into one (the crossed grass card)
function mergeTwo(a, b) {
  const out = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'uv']) {
    const A = a.attributes[name];
    const B = b.attributes[name];
    const arr = new Float32Array(A.array.length + B.array.length);
    arr.set(A.array, 0);
    arr.set(B.array, A.array.length);
    out.setAttribute(name, new THREE.BufferAttribute(arr, A.itemSize));
  }
  const ia = a.index.array;
  const ib = b.index.array;
  const idx = new Uint16Array(ia.length + ib.length);
  idx.set(ia, 0);
  for (let i = 0; i < ib.length; i++) idx[ia.length + i] = ib[i] + a.attributes.position.count;
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}

// sawgrass blades on a transparent card
function grassTexture() {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const g = c.getContext('2d');
  const r = rng(99);
  for (let i = 0; i < 34; i++) {
    const x = 8 + r() * 112;
    const lean = (r() - 0.5) * 40;
    const h = 56 + r() * 70;
    const w = 2 + r() * 3;
    const root = 128 - r() * 10;
    const shade = 110 + r() * 100;
    g.fillStyle = `rgb(${(shade * 0.78) | 0}, ${shade | 0}, ${(shade * 0.42) | 0})`;
    g.beginPath();
    g.moveTo(x - w / 2, root);
    g.quadraticCurveTo(x + lean * 0.35, root - h * 0.55, x + lean, root - h);
    g.quadraticCurveTo(x + lean * 0.35 + w * 0.3, root - h * 0.55, x + w / 2, root);
    g.closePath();
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// weathered horizontal boards (deck: lengthwise along the texture's x), grey-brown, grain, dark gaps, nail heads
function plankTexture(base, seed, deckBoards = false) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 512;
  const g = c.getContext('2d');
  const r = rng(seed);
  const board = deckBoards ? 36 : 48; // px per board (2 m = 512 px)
  for (let y = 0; y < 512; y += board) {
    const k = 0.7 + r() * 0.45;
    const grey = r() < 0.3 ? 0.85 : 1;
    const col = base.map((v, i) => Math.round(v * k * (i === 2 ? 1 : grey)));
    g.fillStyle = `rgb(${col[0]}, ${col[1]}, ${col[2]})`;
    g.fillRect(0, y, 512, board);
    // grain
    for (let i = 0; i < 26; i++) {
      const gy = y + 3 + r() * (board - 6);
      g.strokeStyle = `rgba(30, 22, 14, ${0.08 + r() * 0.14})`;
      g.lineWidth = 1 + r();
      g.beginPath();
      g.moveTo(0, gy);
      for (let x = 0; x <= 512; x += 64) g.lineTo(x, gy + Math.sin(x * 0.02 + i) * 1.5);
      g.stroke();
    }
    // butt joints and nails
    let x = r() * 200;
    while (x < 512) {
      g.fillStyle = 'rgba(20, 15, 10, 0.75)';
      g.fillRect(x, y, 2, board);
      g.fillStyle = 'rgba(40, 32, 26, 0.9)';
      g.fillRect(x + 5, y + 8, 3, 3);
      g.fillRect(x + 5, y + board - 11, 3, 3);
      x += 160 + r() * 260;
    }
    // the gap under the board
    g.fillStyle = 'rgba(12, 9, 6, 0.85)';
    g.fillRect(0, y + board - 3, 512, 3);
  }
  // damp, dark lower edge and a few stains
  const grd = g.createLinearGradient(0, 380, 0, 512);
  grd.addColorStop(0, 'rgba(20, 26, 14, 0)');
  grd.addColorStop(1, 'rgba(20, 26, 14, 0.45)');
  g.fillStyle = grd;
  g.fillRect(0, 380, 512, 132);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// corrugated tin: vertical ridges, panel seams, faded paint, rust running down from the top and the rivets
function tinTexture(base, seed, rust = 0.5) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 512;
  const g = c.getContext('2d');
  const r = rng(seed);
  const img = g.createImageData(512, 512);
  for (let y = 0; y < 512; y++) {
    for (let x = 0; x < 512; x++) {
      const ridge = 0.78 + 0.22 * Math.sin((x / 19.5) * Math.PI * 2);
      const n = 0.9 + r() * 0.12;
      const i = (y * 512 + x) * 4;
      img.data[i] = base[0] * ridge * n;
      img.data[i + 1] = base[1] * ridge * n;
      img.data[i + 2] = base[2] * ridge * n;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  // panel seams (overlaps) every ~0.9 m
  for (let x = 0; x < 512; x += 230) {
    g.fillStyle = 'rgba(20, 18, 16, 0.5)';
    g.fillRect(x, 0, 3, 512);
  }
  // rust streaks from the top and from the rivet rows
  for (let k = 0; k < 70 * rust; k++) {
    const x = r() * 512;
    const top = r() < 0.6 ? 0 : 60 + r() * 380;
    const len = 40 + r() * 260;
    const grd = g.createLinearGradient(0, top, 0, top + len);
    grd.addColorStop(0, `rgba(${110 + r() * 40}, ${52 + r() * 20}, 24, ${0.35 + r() * 0.4})`);
    grd.addColorStop(1, 'rgba(90, 44, 20, 0)');
    g.fillStyle = grd;
    g.fillRect(x, top, 3 + r() * 10, len);
  }
  // primer / bare patches
  for (let k = 0; k < 10; k++) {
    g.fillStyle = `rgba(${120 + r() * 30}, ${118 + r() * 20}, ${110 + r() * 20}, ${0.15 + r() * 0.25})`;
    g.beginPath();
    g.ellipse(r() * 512, r() * 512, 10 + r() * 40, 6 + r() * 30, r() * 3, 0, Math.PI * 2);
    g.fill();
  }
  // rivet rows
  for (const y of [40, 470]) {
    for (let x = 10; x < 512; x += 39) {
      g.fillStyle = 'rgba(60, 40, 28, 0.9)';
      g.fillRect(x, y, 3, 3);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// dark wet mud, soft-edged (a disc / strip texture: alpha falls off toward the border)
function mudTexture() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const g = c.getContext('2d');
  const img = g.createImageData(256, 256);
  const r = rng(23);
  for (let y = 0; y < 256; y++) {
    for (let x = 0; x < 256; x++) {
      const dx = (x - 127.5) / 128;
      const dy = (y - 127.5) / 128;
      const d = Math.sqrt(dx * dx + dy * dy);
      const n = r();
      const v = 58 + n * 30;
      const i = (y * 256 + x) * 4;
      img.data[i] = v;
      img.data[i + 1] = v * 0.86;
      img.data[i + 2] = v * 0.66;
      const edge = Math.max(0, Math.min(1, (1 - d) / 0.25));
      img.data[i + 3] = Math.round(255 * edge * (0.7 + n * 0.3));
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// a soft vertical beam: bright core fading to the sides and toward the ground, a few streaks
function shaftTexture() {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 256;
  const g = c.getContext('2d');
  const img = g.createImageData(64, 256);
  const r = rng(5);
  const streak = [];
  for (let x = 0; x < 64; x++) streak.push(0.75 + r() * 0.25);
  for (let y = 0; y < 256; y++) {
    const along = Math.sin((y / 255) * Math.PI) ** 0.7 * (1 - (y / 255) * 0.55);
    for (let x = 0; x < 64; x++) {
      const across = Math.max(0, 1 - Math.abs(x - 31.5) / 32) ** 1.6;
      const v = Math.round(255 * along * across * streak[x]);
      const i = (y * 64 + x) * 4;
      img.data[i] = v;
      img.data[i + 1] = v;
      img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// low, soft noise puffs for the ground mist
function mistTexture() {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const g = c.getContext('2d');
  const r = rng(17);
  for (let i = 0; i < 40; i++) {
    const x = 20 + r() * 88;
    const y = 20 + r() * 88;
    const rad = 10 + r() * 30;
    const gr = g.createRadialGradient(x, y, 0, x, y, rad);
    gr.addColorStop(0, 'rgba(255,255,255,0.16)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 128, 128);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
