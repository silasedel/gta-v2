#!/usr/bin/env node
// Bake motion-captured locomotion (Mixamo clips from the three.js examples: Xbot.glb, Soldier.glb, see CREDITS.md) into
// the canonical form of src/npc/arch/anim.js, so ONE shared clip set drives every person and the far crowd bake.
// Canonical form: per key, per bone a model-space delta from the canonical T-pose, relative to the parent's delta
// (q_bone = delta_parent^-1 * delta_bone, delta = world_anim * T^-1, T = the bone's T-pose frame with the limb axis
// aligned like makeFrames does), the hips delta, and the hips offset in meters at the reference hip height (0.98 m).
// Fingers are left out on purpose: the scanned hands keep the game's soft relaxed hand poses.
// Output: src/npc/arch/mocap.data.js
//   node tools/v2/npcs/bake_mocap.mjs
import fs from 'node:fs';
import * as THREE from 'three';
import { makeFrames } from '../../../src/npc/arch/anim.js';

const OUT = 'src/npc/arch/mocap.data.js';
const BODY = [
  'Hips',
  'Spine',
  'Spine1',
  'Spine2',
  'Neck',
  'Head',
  'LeftShoulder',
  'LeftArm',
  'LeftForeArm',
  'LeftHand',
  'RightShoulder',
  'RightArm',
  'RightForeArm',
  'RightHand',
  'LeftUpLeg',
  'LeftLeg',
  'LeftFoot',
  'LeftToeBase',
  'RightUpLeg',
  'RightLeg',
  'RightFoot',
  'RightToeBase',
];
// [source file, source clip, output name, rest clip (the T-pose take) or null = the bind pose]
const JOBS = [
  ['Xbot.glb', 'walk', 'xbot_walk', null],
  ['Xbot.glb', 'run', 'xbot_run', null],
  ['Xbot.glb', 'idle', 'xbot_idle', null],
  ['Soldier.glb', 'Walk', 'soldier_walk', 'TPose'],
  ['Soldier.glb', 'Run', 'soldier_run', 'TPose'],
  ['Soldier.glb', 'Idle', 'soldier_idle', 'TPose'],
];
const norm = (n) => n.replace(/^mixamorig[:_]?/, '');

function readGlb(file) {
  const buf = fs.readFileSync(file);
  const len = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + len).toString());
  const bin = 20 + len + 8;
  const acc = (i) => {
    const a = json.accessors[i];
    const bv = json.bufferViews[a.bufferView];
    const n = { SCALAR: 1, VEC3: 3, VEC4: 4 }[a.type];
    const off = buf.byteOffset + bin + (bv.byteOffset || 0) + (a.byteOffset || 0);
    return new Float32Array(buf.buffer.slice(off, off + a.count * n * 4));
  };
  return { json, acc };
}

function buildScene(json) {
  const objs = json.nodes.map((n) => {
    const o = n.mesh !== undefined ? new THREE.Object3D() : new THREE.Bone();
    o.name = n.name || '';
    if (n.translation) o.position.fromArray(n.translation);
    if (n.rotation) o.quaternion.fromArray(n.rotation);
    if (n.scale) o.scale.fromArray(n.scale);
    return o;
  });
  json.nodes.forEach((n, i) => {
    for (const c of n.children || []) objs[i].add(objs[c]);
  });
  const wrap = new THREE.Group();
  const fix = new THREE.Group();
  wrap.add(fix);
  for (const i of json.scenes[0].nodes) fix.add(objs[i]);
  return { wrap, fix, objs };
}

// sampled channels of one animation: node -> { path -> (t) => array }
function channels(json, acc, anim) {
  const out = [];
  for (const ch of anim.channels) {
    const s = anim.samplers[ch.sampler];
    const times = acc(s.input);
    const vals = acc(s.output);
    out.push({ node: ch.target.node, path: ch.target.path, times, vals });
  }
  return out;
}
const _qa = new THREE.Quaternion();
const _qb = new THREE.Quaternion();
function applyAt(objs, chans, t) {
  for (const c of chans) {
    const o = objs[c.node];
    const n = c.path === 'rotation' ? 4 : 3;
    const T = c.times;
    let i = 0;
    while (i < T.length - 1 && T[i + 1] <= t) i++;
    const j = Math.min(T.length - 1, i + 1);
    const k = j === i ? 0 : Math.min(1, Math.max(0, (t - T[i]) / (T[j] - T[i])));
    if (c.path === 'rotation') {
      _qa.fromArray(c.vals, i * 4);
      _qb.fromArray(c.vals, j * 4);
      o.quaternion.copy(_qa).slerp(_qb, k);
    } else {
      const a = c.vals.subarray(i * n, i * n + n);
      const b = c.vals.subarray(j * n, j * n + n);
      const v = c.path === 'translation' ? o.position : o.scale;
      v.set(a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k);
    }
  }
}

const r4 = (x) => Math.round(x * 1e4) / 1e4;
const result = {};
for (const [file, clipName, outName, restName] of JOBS) {
  const { json, acc } = readGlb('public/assets/characters/' + file);
  const { wrap, fix, objs } = buildScene(json);
  const anim = json.animations.find((a) => a.name === clipName);
  const chans = channels(json, acc, anim);
  const bones = {};
  objs.forEach((o) => {
    const n = norm(o.name);
    const want = BODY.includes(n) || n === 'LeftHandMiddle1' || n === 'RightHandMiddle1';
    if (o.isBone && want && !bones[n]) bones[n] = o;
  });
  // rest = the T-pose take (Soldier) or the bind pose (Xbot)
  if (restName) {
    const restAnim = json.animations.find((a) => a.name === restName);
    applyAt(objs, channels(json, acc, restAnim), 0);
  }
  // face +Z (character-left = +X): yaw the whole scene from the legs
  wrap.updateMatrixWorld(true);
  const l = bones.LeftUpLeg.getWorldPosition(new THREE.Vector3());
  const r = bones.RightUpLeg.getWorldPosition(new THREE.Vector3());
  const left = l.sub(r);
  const yaw = Math.atan2(left.z, left.x);
  fix.rotation.y = yaw;
  wrap.updateMatrixWorld(true);
  const rig = { bones, root: wrap };
  const F = makeFrames(rig);
  const restHips = bones.Hips.getWorldPosition(new THREE.Vector3());
  const footY = Math.min(
    bones.LeftFoot.getWorldPosition(new THREE.Vector3()).y,
    bones.RightFoot.getWorldPosition(new THREE.Vector3()).y,
  );
  const hipH = restHips.y - footY + 0.08; // ankle height above the floor
  const restLocal = new Map(objs.map((o) => [o, [o.position.clone(), o.quaternion.clone()]]));
  const dur = Math.max(...chans.map((c) => c.times[c.times.length - 1]));
  const nKeys = chans.reduce((m, c) => Math.max(m, c.times.length), 0);
  const N = Math.max(2, nKeys - 1);
  const keys = [];
  const Tinv = {};
  for (const n of BODY) Tinv[n] = F.T[n].clone().invert();
  for (let i = 0; i <= N; i++) {
    const t = (i / N) * dur;
    for (const [o, [p, q]] of restLocal) {
      o.position.copy(p);
      o.quaternion.copy(q);
    }
    applyAt(objs, chans, t);
    wrap.updateMatrixWorld(true);
    const delta = {};
    for (const n of BODY) {
      const w = bones[n].getWorldQuaternion(new THREE.Quaternion());
      delta[n] = w.multiply(Tinv[n]);
    }
    const q = {};
    for (const n of BODY) {
      const p = bones[n].parent;
      const pn = BODY.find((m) => bones[m] === p);
      const d = pn ? delta[pn].clone().invert().multiply(delta[n]) : delta[n].clone();
      q[n] = d.normalize();
    }
    const hp = bones.Hips.getWorldPosition(new THREE.Vector3()).sub(restHips);
    hp.multiplyScalar(0.98 / hipH);
    keys.push({ t, q, hips: [hp.x, hp.y, hp.z] });
  }
  // in place: remove the mean horizontal hips offset (the oscillation stays)
  const mx = keys.reduce((s, k) => s + k.hips[0], 0) / keys.length;
  const mz = keys.reduce((s, k) => s + k.hips[2], 0) / keys.length;
  // quaternion signs continuous
  for (const n of BODY)
    for (let i = 1; i < keys.length; i++)
      if (keys[i].q[n].dot(keys[i - 1].q[n]) < 0)
        keys[i].q[n].set(-keys[i].q[n].x, -keys[i].q[n].y, -keys[i].q[n].z, -keys[i].q[n].w);
  result[outName] = {
    src: file + ' ' + clipName,
    dur: r4(dur),
    bones: BODY,
    t: keys.map((k) => r4(k.t)),
    hips: keys.flatMap((k) => [r4(k.hips[0] - mx), r4(k.hips[1]), r4(k.hips[2] - mz)]),
    q: keys.flatMap((k) => BODY.flatMap((n) => k.q[n].toArray().map(r4))),
  };
  console.log(
    outName,
    'keys',
    keys.length,
    'dur',
    dur.toFixed(3),
    'hipH',
    hipH.toFixed(3),
    'yaw',
    ((yaw * 180) / Math.PI).toFixed(1),
  );
}

const head =
  '// GENERATED by tools/v2/npcs/bake_mocap.mjs from Mixamo motion capture (Xbot.glb, Soldier.glb from the three.js\n' +
  '// examples, see CREDITS.md). Canonical deltas for src/npc/arch/anim.js; do not edit by hand.\n' +
  '/* eslint-disable */\n// prettier-ignore\n';
fs.writeFileSync(OUT, head + 'export const MOCAP = ' + JSON.stringify(result) + ';\n');
console.log('wrote', OUT, (fs.statSync(OUT).size / 1024).toFixed(1), 'KB');
