// Nico's house r11 (playtest Nov 19: "the plants look terrible"): the yard planting of the r8 lot uses the user's plant
// downloads (tools/v2/keys/r11/plants11.py -> public/assets/models/keys/plants/*.glb) instead of the procedural crotons
// and ti plants of round 3. Every model is drawn once per mesh as an InstancedMesh, so ten bananas cost what one does.
// Positions are in the yard frame G (the set piece group's frame, the same as part 50), grounded on the yard sheet.
// A spot is dropped when it lands on the drive, in the house / decks / canal (plantClear), or on a collider.
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { R8, toS, plantClear } from '../r4/plan4.js';

export const order = 56;

const DIR = 'assets/models/keys/plants/';

// kind -> model file and the radius of its clear footprint (m, at scale 1); trunk: collider radius / height, if any
const KINDS = {
  shrub: { file: 'tropical_shrub.glb', r: 0.5, trunk: [0.08, 1.0] },
  ear: { file: 'elephant_ear.glb', r: 1.3 },
  banana: { file: 'banana.glb', r: 1.2, trunk: [0.14, 2.0] },
  fern: { file: 'fern.glb', r: 1.2 },
  monstera: { file: 'monstera_yard.glb', r: 1.5 },
};

// accents toward the street, by the canal fence and at the open yard's edge: [x, z, kind, scale, heading]
// (the lawn round the house stays open: plantClear keeps the reference views clear)
const ACCENTS = [
  [-4.6, 21.6, 'banana', 1.0, 0.4],
  [-9.2, 21.2, 'monstera', 0.7, 2.0],
  [-7.4, 23.4, 'fern', 0.6, 1.1],
  [8.6, 10.6, 'banana', 1.05, 2.6],
  [6.9, 13.2, 'fern', 0.6, 0.3],
  [-17.2, 4.4, 'ear', 0.6, 0.8],
];

// the street-side row (part 50's spots): 'c' (was a croton) -> the spotted tropical shrub, 't' (was a ti plant) -> elephant ear
function streetRowSpots(ctx, rnd) {
  return (ctx.streetRow || []).map(([x, z, k]) => {
    if (k === 'c') return [x, z, 'shrub', 1.05 + rnd() * 0.25, rnd() * 6.28];
    return [x, z, 'ear', 0.55 + rnd() * 0.1, rnd() * 6.28];
  });
}

// true when a footprint of radius r at (x, z) overlaps any collider of the set piece (posts, stairs, rocks, fences, pots)
function hitsCollider(ctx, x, z, r) {
  for (const c of ctx.colliders) {
    if (!c.p) continue;
    const [cx, , cz] = c.p;
    if (c.shape === 'cyl') {
      if (Math.hypot(x - cx, z - cz) < c.r + r) return true;
      continue;
    }
    if (!c.h) continue;
    // the yard / pad ground slabs are colliders too: only small things (posts, rocks, fences, props) block a plant
    if (c.h[0] > 3 || c.h[2] > 3) continue;
    const reach = Math.hypot(c.h[0], c.h[2]);
    if (Math.hypot(x - cx, z - cz) < reach + r * 0.5) return true;
  }
  return false;
}

function spotIsClear(ctx, x, z, kind, s) {
  const r = KINDS[kind].r * s;
  const drive = ctx.driveD ? ctx.driveD(x, z) : 1e9;
  if (drive < 2.2 + 0.6 + r * 0.5) return false;
  if (plantClear(...toS(x, z), r * 0.6)) return false;
  // front-door view (Nov 19): nothing on the asphalt (the set piece's own road across the front included)
  if (ctx.opts.roadClear && !ctx.opts.roadClear(x, z, r * 0.5)) return false;
  return !hitsCollider(ctx, x, z, r * 0.4);
}

// Alpha-tested leaves that write depth: no sorting, no flicker.
function cutoutLeaves(m) {
  if (m.map && (m.transparent || m.alphaTest > 0)) {
    m.transparent = false;
    m.alphaTest = 0.5;
    m.depthWrite = true;
  }
  m.side = 2;
  m.metalness = 0;
  m.envMapIntensity = Math.min(m.envMapIntensity ?? 1, 0.45);
}

// One InstancedMesh per mesh of the model, an instance per spot.
function addInstances(THREE, parent, scene, spots) {
  scene.updateMatrixWorld(true);
  const place = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  scene.traverse((node) => {
    if (!node.isMesh) return;
    const mat = node.material.clone();
    cutoutLeaves(mat);
    const im = new THREE.InstancedMesh(node.geometry, mat, spots.length);
    spots.forEach((sp, i) => {
      q.setFromAxisAngle(up, sp.ry);
      place.compose(new THREE.Vector3(sp.x, sp.y, sp.z), q, new THREE.Vector3(sp.s, sp.s, sp.s));
      im.setMatrixAt(i, place.clone().multiply(node.matrixWorld));
    });
    im.instanceMatrix.needsUpdate = true;
    im.computeBoundingSphere();
    im.castShadow = true;
    im.receiveShadow = true;
    im.raycast = () => {};
    im.name = 'r11_' + node.name;
    parent.add(im);
  });
}

export function build(ctx) {
  if (!R8) return;
  const { THREE, kit } = ctx;
  const rnd = kit.rng(1156);
  const groundY = ctx.yardY || (() => 0);
  const byKind = {};
  for (const [x, z, kind, s, ry] of [...ACCENTS, ...streetRowSpots(ctx, rnd)]) {
    if (!spotIsClear(ctx, x, z, kind, s)) {
      (ctx.stats.yardDropped ||= []).push([x, z, kind]);
      continue;
    }
    (byKind[kind] ||= []).push({ x, z, s, ry, y: groundY(x, z) - 0.03 });
  }
  const loader = new GLTFLoader();
  const base = import.meta.env?.BASE_URL ?? '/';
  for (const [kind, spots] of Object.entries(byKind)) {
    const K = KINDS[kind];
    if (K.trunk) {
      const [tr, th] = K.trunk;
      for (const sp of spots) {
        ctx.colliders.push({
          shape: 'cyl',
          p: [sp.x, sp.y + (th * sp.s) / 2, sp.z],
          r: tr * sp.s,
          hh: (th * sp.s) / 2,
          q: [0, 0, 0, 1],
          tag: 'tree',
          enabled: true,
        });
      }
    }
    const job = loader
      .loadAsync(base + DIR + K.file)
      .then((g) => addInstances(THREE, ctx.groups.detail, g.scene, spots))
      .catch((e) => console.warn('[nicoHouse] yard plant', K.file, e?.message || e));
    ctx.async.push(job);
  }
  ctx.stats.yardPlants = Object.fromEntries(Object.entries(byKind).map(([k, v]) => [k, v.length]));
}
