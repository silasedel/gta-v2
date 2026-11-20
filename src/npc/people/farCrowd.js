// Far crowd tier made of the user's people (r2-people, item 15). Same API as src/npc/crowd.js createCrowd() (the old
// procedural mannequin body), so src/npc/people.v2.js drives it unchanged:
//   alloc / release / setLook(i, L with L.personId) / setPose(i, POSE id, cadence, phase, amp) / setTransform / setFade /
//   setBands / update(dt)
// Every person used at distance is the person's own LOD2 mesh (1.2k tris, its own albedo) drawn as one InstancedMesh per
// person, skinned in the vertex shader from a small baked bone texture: the person's own rig posed by the game's own
// clips (idle, walk, jog, run, sit, lie, talk, phone, dance ... the same clips as the near tier), sampled once when the
// person is first used, fingers folded into the hands. Instances pick a clip row range + phase, so hundreds of people
// animate with zero per-frame CPU skinning. Only people the cast has loaded (src/npc/people/cast.js) are used.
import * as THREE from 'three';
import { FRAME_NOISE, RENDER_R2, IGN_R2_GLSL } from '../../render/frameNoise.js';
import { getPerson, loadedPeople } from './lib.js';

const POSE = {
  stand: 0,
  walk: 1,
  run: 2,
  sit: 3,
  sitGround: 4,
  lie: 5,
  talk: 6,
  phone: 7,
  call: 8,
  dance: 9,
  cower: 10,
  film: 11,
  kneel: 12,
  push: 13,
  swim: 14,
  lean: 15,
  wave: 16,
  dead: 17,
  ride: 18,
  volley: 19,
  work: 20,
  panic: 21,
  carry: 22,
  sitEat: 23,
  lounge: 24,
  bike: 25,
  sip: 26,
  lieFront: 27,
  argue: 28,
  fish: 29,
};
// baked rows per person: [slot, clip (or base + overlay), frames, end-only]
const KEEP = [
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
const NB = KEEP.length;
// crowd people's mesh detail by camera distance: full scan within [0] m, the 5k LOD1 within [1] m, 1.2k LOD2 beyond
// (the near tier's own switch is 15 / 60 m; '?farlod=0' = LOD2 everywhere, as before Nov 19b)
const LOD_NEAR =
  typeof location !== 'undefined' && /[?&]farlod=0\b/.test(location.search) ? [-1, -1] : [10, 45];
function bakeList(base) {
  const m = base.meta || {};
  const old = (m.years || 30) > 62,
    fem = m.gender === 'f' || m.g === 'f';
  const C = base.clips;
  const walk =
    m.heels && C.walk_heels
      ? 'walk_heels'
      : old && C.walk_old
        ? 'walk_old'
        : fem && C.walk_f
          ? 'walk_f'
          : 'walk';
  const idle = old && C.idle_old ? 'idle_old' : fem && C.idle_f ? 'idle_f' : 'idle';
  return [
    ['stand', idle, 28],
    ['walk', walk, 24],
    ['jog', 'jog', 16],
    ['run', 'run', 16],
    ['sprint', 'sprint', 14],
    ['sit', 'sitBench', 10],
    ['sitGround', 'sitGround', 10],
    ['lie', 'lie', 8],
    ['talk', 'talk_g', 20],
    ['phone', 'phone_text', 14],
    ['call', [idle, 'phoneCall'], 12],
    ['dance', 'dance', 16],
    ['cower', 'cower', 6],
    ['film', 'photo', 10],
    ['kneel', 'kneel', 8],
    ['swim', 'swim', 16],
    ['lean', 'lean_wall', 10],
    ['wave', [idle, 'wave'], 14],
    ['dead', 'deadBack', 1, true],
    ['lieFront', 'deadFwd', 1, true],
    ['volley', 'volley', 20],
    ['cross', 'cross_arms', 12],
    ['sip', 'drink', 16],
    ['argue', [idle, 'argue'], 14],
    ['chair', 'sit', 10],
  ];
}
// crowd pose id -> baked slot (+ rate kind: 'loco' follows the cadence, 'idle' plays the clip at its own speed)
const POSE_SLOT = {
  0: 'stand',
  1: 'walk',
  2: 'run',
  3: 'sit',
  4: 'sitGround',
  5: 'lie',
  6: 'talk',
  7: 'phone',
  8: 'call',
  9: 'dance',
  10: 'cower',
  11: 'film',
  12: 'kneel',
  13: 'walk',
  14: 'swim',
  15: 'lean',
  16: 'wave',
  17: 'dead',
  18: 'sit',
  19: 'volley',
  20: 'cross',
  21: 'sprint',
  22: 'walk',
  23: 'chair',
  24: 'sitGround',
  25: 'sit',
  26: 'sip',
  27: 'lieFront',
  28: 'argue',
  29: 'cross',
};
const LOCO = new Set(['walk', 'jog', 'run', 'sprint']);
// src/npc/people.v2.js gaitFor: the cadence it sends assumes this stride (m per cycle at amp 1, 1.75 m tall)
const STRIDE_REF = 1.41;
/** people the far crowd is showing (src/npc/people/cast.js never unloads these) */
export const FAR_IN_USE = new Set();

// ---------------------------------------------------------------- per-person bake (rig posed by the shared clips)
const _m = new THREE.Matrix4(),
  _m2 = new THREE.Matrix4();
function* bakePerson(base) {
  // a generator: one clip per step, so a bake never costs a frame more than ~1-2 ms
  const scene = base.scene;
  let mesh = null;
  scene.traverse((o) => {
    if (o.isSkinnedMesh && /LOD2/.test(o.name) && /_body/.test(o.name)) mesh = o;
  });
  if (!mesh)
    scene.traverse((o) => {
      if (!mesh && o.isSkinnedMesh && /LOD2/.test(o.name)) mesh = o;
    });
  if (!mesh) return null;
  const sk = mesh.skeleton;
  const norm = (n) => n.replace(/^mixamorig[:_]?/, '');
  // skeleton bone index -> kept slot (finger joints fold into their hand)
  const slotOf = sk.bones.map((b) => {
    let n = norm(b.name);
    const f = /^(Left|Right)Hand(Index|Middle|Ring|Pinky|Thumb)/.exec(n);
    if (f) n = f[1] + 'Hand';
    const k = KEEP.indexOf(n);
    return k < 0 ? 0 : k;
  });
  const keptBone = KEEP.map((n) => sk.bones.find((b) => norm(b.name) === n) || null);
  const keptInv = KEEP.map((n, k) => {
    const i = sk.bones.findIndex((b) => norm(b.name) === n);
    return i >= 0 ? sk.boneInverses[i] : new THREE.Matrix4();
  });
  // geometry: positions / normals / uvs, skin indices remapped to kept slots
  const skinGeo = (m, slots) => {
    const g0 = m.geometry;
    const g = new THREE.InstancedBufferGeometry();
    g.index = g0.index;
    for (const k of ['position', 'normal', 'uv'])
      if (g0.attributes[k]) g.setAttribute(k, g0.attributes[k]);
    const si = g0.attributes.skinIndex,
      sw = g0.attributes.skinWeight;
    const fi = new Float32Array(si.count * 4);
    for (let v = 0; v < si.count; v++)
      for (let c = 0; c < 4; c++) fi[v * 4 + c] = slots[si.getComponent(v, c)] ?? 0;
    g.setAttribute('fSkinIdx', new THREE.BufferAttribute(fi, 4));
    g.setAttribute('fSkinW', sw);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    return g;
  };
  const g = skinGeo(mesh, slotOf);
  // Nov 19b (user: "some NPCs are insanely low poly"): crowd people who come close use the person's own 5k LOD1 / full
  // LOD0 body (same skeleton, bind and bone inverses as LOD2, so the same bone texture drives them), built on first use
  const geos = { 2: g };
  const geoFor = (lv) => {
    if (geos[lv] !== undefined) return geos[lv];
    geos[lv] = null;
    let m = null;
    scene.traverse((o) => {
      if (!m && o.isSkinnedMesh && o.name.includes('LOD' + lv) && /_body/.test(o.name)) m = o;
    });
    if (!m || !m.bindMatrix.equals(mesh.bindMatrix)) return null;
    const sk2 = m.skeleton;
    const same = sk2.bones.every((b, i) => {
      const j = sk.bones.findIndex((x) => x.name === b.name);
      return j >= 0 && sk2.boneInverses[i].equals(sk.boneInverses[j]);
    });
    if (!same) return null;
    const slots = sk2.bones.map((b) => slotOf[sk.bones.findIndex((x) => x.name === b.name)] ?? 0);
    geos[lv] = skinGeo(m, slots);
    return geos[lv];
  };
  // rows
  const list = bakeList(base);
  const slots = {};
  let rows = 0;
  for (const [nm, , fr] of list) {
    slots[nm] = { row: rows, n: fr };
    rows += fr;
  }
  const W = NB * 3;
  const data = new Float32Array(W * rows * 4);
  const saved = sk.bones.map((b) => [b.position.clone(), b.quaternion.clone(), b.scale.clone()]);
  const mixer = new THREE.AnimationMixer(scene);
  scene.updateMatrixWorld(true);
  const bind = mesh.bindMatrix;
  const rootInv = new THREE.Matrix4().copy(scene.matrixWorld).invert();
  const restore = () => {
    sk.bones.forEach((b, i) => {
      b.position.copy(saved[i][0]);
      b.quaternion.copy(saved[i][1]);
      b.scale.copy(saved[i][2]);
    });
    scene.updateMatrixWorld(true);
  };
  for (const [nm, clip, fr, endOnly] of list) {
    const s = slots[nm];
    const names = Array.isArray(clip) ? clip : [clip];
    mixer.stopAllAction();
    const acts = names
      .map((n, j) => {
        const c = base.clips[n];
        if (!c) return null;
        const a = mixer.clipAction(c);
        a.reset();
        a.setLoop(THREE.LoopRepeat, Infinity);
        a.setEffectiveWeight(j ? 4 : 1);
        a.play();
        return a;
      })
      .filter(Boolean);
    if (!acts.length) {
      const fb = base.clips.idle;
      if (fb) {
        const a = mixer.clipAction(fb);
        a.reset();
        a.play();
        acts.push(a);
      }
    }
    const dur = acts.length ? acts[0].getClip().duration : 1;
    for (let f = 0; f < fr; f++) {
      const t = endOnly ? dur - 0.001 : (f / fr) * dur;
      for (const a of acts) a.time = a === acts[0] ? t : (t / dur) * a.getClip().duration;
      mixer.update(0);
      scene.updateMatrixWorld(true);
      for (let k = 0; k < NB; k++) {
        const b = keptBone[k];
        // person-root space skin matrix (three's attached bind mode): rootInverse * bone world * boneInverse * bindMatrix
        if (b) _m2.multiplyMatrices(rootInv, b.matrixWorld).multiply(keptInv[k]).multiply(bind);
        else _m2.copy(bind);
        const e = _m2.elements;
        const o = ((s.row + f) * W + k * 3) * 4;
        // rows of the 3x4 affine part
        data[o] = e[0];
        data[o + 1] = e[4];
        data[o + 2] = e[8];
        data[o + 3] = e[12];
        data[o + 4] = e[1];
        data[o + 5] = e[5];
        data[o + 6] = e[9];
        data[o + 7] = e[13];
        data[o + 8] = e[2];
        data[o + 9] = e[6];
        data[o + 10] = e[10];
        data[o + 11] = e[14];
      }
    }
    for (const n of names) {
      const c = base.clips[n];
      if (c) mixer.uncacheAction(c);
    }
    restore(); // the template stays in its rest pose between steps (people are cloned from it)
    yield null;
  }
  mixer.stopAllAction();
  mixer.uncacheRoot(scene);
  sk.bones.forEach((b, i) => {
    b.position.copy(saved[i][0]);
    b.quaternion.copy(saved[i][1]);
    b.scale.copy(saved[i][2]);
  });
  scene.updateMatrixWorld(true);
  const tex = new THREE.DataTexture(data, W, rows, THREE.RGBAFormat, THREE.FloatType);
  tex.minFilter = tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  const durOf = {};
  const strideOf = {};
  for (const [nm, clip] of list) {
    const c = base.clips[Array.isArray(clip) ? clip[0] : clip];
    durOf[nm] = c ? c.duration : 1;
    if (c && c.userData.speed) strideOf[nm] = c.userData.speed * c.duration;
  }
  return {
    geo: g,
    geoFor,
    geos,
    mat: null,
    tex,
    slots,
    durOf,
    strideOf,
    height: base.height || base.meta?.height || 1.75,
  };
}

// ---------------------------------------------------------------- shader
const VERT_PARS = /* glsl */ `
uniform sampler2D uBoneTex; uniform float uNpcTime;
attribute vec4 fSkinIdx; attribute vec4 fSkinW; attribute vec4 aAnim; attribute float aFade;
varying float vNpcFade;
mat4 fBone(float row, float b) {
  int x = int(b + 0.5) * 3; int y = int(row + 0.5);
  vec4 r0 = texelFetch(uBoneTex, ivec2(x, y), 0), r1 = texelFetch(uBoneTex, ivec2(x + 1, y), 0), r2 = texelFetch(uBoneTex, ivec2(x + 2, y), 0);
  return transpose(mat4(r0, r1, r2, vec4(0.0, 0.0, 0.0, 1.0)));
}
mat4 fSkin(float row) { return fSkinW.x * fBone(row, fSkinIdx.x) + fSkinW.y * fBone(row, fSkinIdx.y) + fSkinW.z * fBone(row, fSkinIdx.z) + fSkinW.w * fBone(row, fSkinIdx.w); }
`;
const VERT_SKIN = /* glsl */ `
  float fU = fract(uNpcTime * aAnim.w + aAnim.z);
  float fF = fU * aAnim.y; float f0 = floor(fF); float fK = fF - f0; float f1 = mod(f0 + 1.0, aAnim.y);
  mat4 fS = fSkin(aAnim.x + f0) * (1.0 - fK) + fSkin(aAnim.x + f1) * fK;
  vNpcFade = aFade;
  vec3 objectNormal = normalize(mat3(fS) * normal);
#ifdef USE_TANGENT
  vec3 objectTangent = vec3(tangent.xyz);
#endif
`;
const FRAG_PARS = /* glsl */ `
varying float vNpcFade;
uniform vec4 uNpcBands; uniform float uFrameN; uniform float uRenderR2;
${IGN_R2_GLSL}
`;
const FRAG_DITHER = /* glsl */ `
  {
    float dCam = length(vViewPosition);
    float a = vNpcFade * smoothstep(uNpcBands.x, uNpcBands.y, dCam) * (1.0 - smoothstep(uNpcBands.z, uNpcBands.w, dCam));
    if (a < 0.999 && a <= psIgnT(gl_FragCoord.xy)) discard;
  }
`;

export function createPeopleCrowd(game, opts = {}) {
  const MAX = opts.max || 380;
  const uTime = { value: 0 };
  const uBands = { value: new THREE.Vector4(0, 0.01, 1e5, 1e5 + 1) };
  const group = new THREE.Group();
  group.name = 'npc-people-crowd';
  (opts.scene || game.scene).add(group);
  const baked = new Map(); // person id -> bake (or null when it failed)
  const buckets = new Map(); // person id -> { mesh, n, cap, idx: [global i ...], aAnim, aFade }
  const inst = []; // global i -> { pid, li, pose, cad, off, amp, fade, mat, h, visible }
  const free = [];
  let high = 0;
  const waiting = new Set(); // instances whose person is still being baked (r2-perf: no full scan per frame)
  const _q = new THREE.Quaternion(),
    _e = new THREE.Euler(),
    _p = new THREE.Vector3(),
    _s = new THREE.Vector3(),
    _mx = new THREE.Matrix4();
  // soft contact shadows (shared, global index)
  const sg = new THREE.PlaneGeometry(1, 1);
  sg.rotateX(-Math.PI / 2);
  const smat = new THREE.MeshBasicMaterial({
    color: 0x000000,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    name: 'npcPeopleBlob',
  });
  smat.onBeforeCompile = (sh) => {
    sh.vertexShader =
      'varying vec2 vBlobUv;\n' +
      sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vBlobUv = uv;');
    sh.fragmentShader =
      'varying vec2 vBlobUv;\n' +
      sh.fragmentShader.replace(
        '#include <color_fragment>',
        '#include <color_fragment>\n float bd = length(vBlobUv - 0.5) * 2.0; diffuseColor.a = 0.34 * (1.0 - smoothstep(0.25, 1.0, bd));',
      );
  };
  const blobs = new THREE.InstancedMesh(sg, smat, MAX);
  blobs.name = 'npc-people-crowd-blobs';
  blobs.frustumCulled = false;
  blobs.count = 0;
  blobs.renderOrder = 1;
  blobs.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  (opts.scene || game.scene).add(blobs);
  const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
  let bakeBudget = 0;
  let lodScan = 0;

  const jobs = new Map(); // person id -> running bake generator
  function getBake(pid) {
    if (baked.has(pid)) return baked.get(pid);
    const b = getPerson(pid);
    if (!b) return null;
    if (!jobs.has(pid)) {
      try {
        jobs.set(pid, bakePerson(b));
      } catch (e) {
        baked.set(pid, null);
        return null;
      }
    }
    if (bakeBudget > 0) return null; // one bake step per frame
    bakeBudget = 1;
    let r;
    try {
      r = jobs.get(pid).next();
    } catch (e) {
      console.warn('[farCrowd] bake', pid, e);
      jobs.delete(pid);
      baked.set(pid, null);
      return null;
    }
    if (r.done) {
      jobs.delete(pid);
      baked.set(pid, r.value || null);
      return r.value || null;
    }
    return null;
  }
  function material(bk, base) {
    const m = new THREE.MeshStandardMaterial({
      map: base.tex.a,
      roughness: 0.86,
      metalness: 0,
      name: 'npcPeopleFar',
    });
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uBoneTex = { value: bk.tex };
      sh.uniforms.uNpcTime = uTime;
      sh.uniforms.uNpcBands = uBands;
      sh.uniforms.uFrameN = FRAME_NOISE;
      sh.uniforms.uRenderR2 = RENDER_R2;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\n' + VERT_PARS)
        .replace('#include <beginnormal_vertex>', VERT_SKIN)
        .replace('#include <begin_vertex>', 'vec3 transformed = (fS * vec4(position, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\n' + FRAG_PARS)
        .replace(
          '#include <clipping_planes_fragment>',
          '#include <clipping_planes_fragment>\n' + FRAG_DITHER,
        );
    };
    m.customProgramCacheKey = () => 'npcPeopleFar1';
    return m;
  }
  function bucketFor(pid, lv = 2) {
    const key = lv === 2 ? pid : pid + ':' + lv;
    let B = buckets.get(key);
    if (B) return B;
    const bk = getBake(pid);
    const base = getPerson(pid);
    if (!bk || !base) return null;
    const geo = lv === 2 ? bk.geo : bk.geoFor(lv);
    if (!geo) return null;
    B = { pid, lv, bk, base, geo, n: 0, cap: 0, idx: [], mesh: null, aAnim: null, aFade: null };
    grow(B, 8);
    buckets.set(key, B);
    return B;
  }
  function grow(B, cap) {
    const g = B.geo.clone(); // shares the vertex buffers, own instance attributes
    const aAnim = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
    aAnim.setUsage(THREE.DynamicDrawUsage);
    const aFade = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1);
    aFade.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aAnim', aAnim);
    g.setAttribute('aFade', aFade);
    // one material (one bone texture) per person, shared by its LOD buckets: no new shader program
    B.bk.mat ||= material(B.bk, B.base);
    const mesh = new THREE.InstancedMesh(g, B.bk.mat, cap);
    mesh.name = 'npc-far:' + B.pid + (B.lv === 2 ? '' : ':LOD' + B.lv);
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    if (B.mesh) {
      for (let k = 0; k < B.n; k++) {
        B.mesh.getMatrixAt(k, _mx);
        mesh.setMatrixAt(k, _mx);
      }
      aAnim.array.set(B.aAnim.array.subarray(0, B.n * 4));
      aFade.array.set(B.aFade.array.subarray(0, B.n));
      group.remove(B.mesh);
      B.mesh.geometry.dispose();
      B.mesh.dispose();
    }
    mesh.count = B.n;
    group.add(mesh);
    B.mesh = mesh;
    B.aAnim = aAnim;
    B.aFade = aFade;
    B.cap = cap;
  }
  function personShown(pid) {
    for (const lv of [2, 1, 0]) {
      const B = buckets.get(lv === 2 ? pid : pid + ':' + lv);
      if (B && B.n) return true;
    }
    return false;
  }
  function detach(i) {
    const I = inst[i];
    if (!I || !I.B) return;
    const B = I.B,
      li = I.li,
      last = B.n - 1;
    if (li !== last) {
      const j = B.idx[last];
      B.mesh.getMatrixAt(last, _mx);
      B.mesh.setMatrixAt(li, _mx);
      for (let c = 0; c < 4; c++) B.aAnim.array[li * 4 + c] = B.aAnim.array[last * 4 + c];
      B.aFade.array[li] = B.aFade.array[last];
      B.idx[li] = j;
      inst[j].li = li;
    }
    B.idx.length = last;
    B.n = last;
    B.mesh.count = B.n;
    if (!B.n && !personShown(B.pid)) FAR_IN_USE.delete(B.pid);
    B.mesh.instanceMatrix.needsUpdate = true;
    B.aAnim.needsUpdate = true;
    B.aFade.needsUpdate = true;
    I.B = null;
    I.li = -1;
  }
  function attach(i, pid) {
    const I = inst[i];
    let B = I.lv !== 2 ? bucketFor(pid, I.lv) : null;
    if (!B) {
      I.lv = 2;
      B = bucketFor(pid, 2);
    }
    if (!B) return false;
    if (B.n >= B.cap) grow(B, B.cap * 2);
    I.B = B;
    I.li = B.n;
    B.idx[B.n] = i;
    B.n++;
    B.mesh.count = B.n;
    FAR_IN_USE.add(B.pid);
    writeAnim(i);
    writeMat(i);
    B.aFade.array[I.li] = I.fade;
    B.aFade.needsUpdate = true;
    return true;
  }
  // mesh detail by camera distance (Nov 19b): LOD2 (1.2k tris) far, the person's 5k LOD1 within LOD_NEAR[1] m, the full
  // scan within LOD_NEAR[0] m (crowd walkers who come close keep walking until out of view: they must not look like the
  // 1.2k far mesh next to the camera). Moves the instance to the other bucket; returns true when it did (matrix written).
  function relod(i) {
    const I = inst[i];
    const cam = game.camera?.position;
    if (!I || !I.B || !cam) return false;
    const d = Math.hypot(I.x - cam.x, I.y - cam.y, I.z - cam.z);
    let lv = I.lv;
    if (lv === 2 && d < LOD_NEAR[1] * 0.92) lv = 1;
    if (lv === 1 && d > LOD_NEAR[1] * 1.08) lv = 2;
    if (lv === 1 && d < LOD_NEAR[0] * 0.9) lv = 0;
    if (lv === 0 && d > LOD_NEAR[0] * 1.1) lv = d > LOD_NEAR[1] ? 2 : 1;
    if (lv === I.lv) return false;
    const pid = I.B.pid;
    detach(i);
    I.lv = lv;
    attach(i, pid);
    return true;
  }
  // foot sync (Nov 19b): the crowd's cadence assumes STRIDE_REF; this person's baked cycle covers its own measured stride
  // (scaled with the instance), so the cycle rate is corrected by their ratio and the feet do not slide
  function strideK(I) {
    const bk = I.B?.bk;
    if (!bk) return 1;
    let slot = POSE_SLOT[I.pose] || 'stand';
    if (I.pose === POSE.run && I.amp < 0.9) slot = 'jog';
    const st = bk.strideOf[slot];
    if (!LOCO.has(slot) || !st) return 1;
    const used = STRIDE_REF * I.amp * (I.h / 1.75);
    const own = st * (I.h / (bk.height || 1.75));
    return THREE.MathUtils.clamp(used / own, 0.5, 2);
  }
  function writeAnim(i) {
    const I = inst[i];
    const B = I.B;
    if (!B) return;
    const bk = B.bk;
    let slot = POSE_SLOT[I.pose] || 'stand';
    if (I.pose === POSE.run && I.amp < 0.9) slot = 'jog';
    const s = bk.slots[slot] || bk.slots.stand;
    let rate, off;
    if (LOCO.has(slot)) {
      const k = strideK(I);
      if (k !== I.k) {
        // keep the phase continuous when the factor changes (first attach, new person, new height)
        const t = uTime.value;
        I.off += t * I.cad * (I.k - k);
        I.k = k;
      }
      rate = (I.cad * I.k) / (Math.PI * 2);
      off = I.off / (Math.PI * 2);
    } else {
      rate = (1 / Math.max(0.2, bk.durOf[slot] || 1)) * (slot === 'dance' ? 1 : 1);
      off = I.seed;
    }
    const o = I.li * 4;
    const A = B.aAnim.array;
    A[o] = s.row;
    A[o + 1] = s.n;
    A[o + 2] = ((off % 1) + 1) % 1;
    A[o + 3] = rate;
    B.aAnim.needsUpdate = true;
  }
  function writeMat(i) {
    const I = inst[i];
    const B = I.B;
    if (!B) return;
    const sc = I.h / (B.bk.height || 1.75);
    _q.setFromEuler(_e.set(0, I.hd, 0));
    _mx.compose(_p.set(I.x, I.y, I.z), _q, _s.set(sc, sc, sc));
    B.mesh.setMatrixAt(I.li, _mx);
    B.mesh.instanceMatrix.needsUpdate = true;
  }
  function pickLoaded(L) {
    const all = loadedPeople().filter(
      (b) => !(b.meta?.places || []).some((x) => x === 'police' || x === 'police_swat'),
    );
    if (!all.length) return null;
    const g = L?.gender;
    const c = g ? all.filter((b) => (b.meta?.g || b.meta?.gender) === g) : all;
    const L2 = c.length ? c : all;
    return L2[(Math.random() * L2.length) | 0].id;
  }
  const api = {
    mesh: group,
    blobs,
    max: MAX,
    POSE,
    people: true,
    alloc() {
      const i = free.length ? free.pop() : high < MAX ? high++ : -1;
      if (i < 0) return -1;
      inst[i] = {
        pid: null,
        B: null,
        li: -1,
        pose: 0,
        cad: 1,
        off: 0,
        amp: 1,
        fade: 0,
        x: 0,
        y: -1e4,
        z: 0,
        hd: 0,
        h: 1.75,
        seed: Math.random(),
        lv: 2,
        k: 1,
      };
      blobs.count = high;
      return i;
    },
    release(i) {
      if (i < 0 || !inst[i]) return;
      waiting.delete(i);
      detach(i);
      blobs.setMatrixAt(i, ZERO);
      blobs.instanceMatrix.needsUpdate = true;
      inst[i] = null;
      free.push(i);
    },
    setFade(i, f) {
      const I = inst[i];
      if (!I) return;
      I.fade = f;
      if (I.B) {
        I.B.aFade.array[I.li] = f;
        I.B.aFade.needsUpdate = true;
      }
    },
    setBands(n0, n1, f0, f1) {
      uBands.value.set(n0, n1, f0, f1);
    },
    setLook(i, L) {
      const I = inst[i];
      if (!I) return;
      let pid =
        L?.personId && getPerson(L.personId)
          ? L.personId
          : I.pid && getPerson(I.pid)
            ? I.pid
            : pickLoaded(L);
      if (I.B && I.B.pid === pid) return;
      detach(i);
      I.pid = pid;
      if (pid) {
        if (!attach(i, pid)) waiting.add(i);
        else waiting.delete(i);
      }
    },
    setPose(i, id, cadence = 1, phase = null, amp = 1) {
      const I = inst[i];
      if (!I) return;
      const t = uTime.value;
      const cur = phase === null ? t * I.cad * I.k + I.off : phase;
      I.pose = id;
      I.cad = cadence;
      I.amp = amp;
      I.off = (cur % 6283.185307) - t * cadence * I.k;
      writeAnim(i);
    },
    setTransform(i, x, y, z, heading, height, blobScale = 1) {
      const I = inst[i];
      if (!I) return;
      // r2-perf: no matrix compose / buffer re-upload for a person who did not move (> 1 cm) or turn
      if (
        I.B &&
        Math.abs(I.x - x) < 0.01 &&
        Math.abs(I.z - z) < 0.01 &&
        Math.abs(I.y - y) < 0.01 &&
        Math.abs(I.hd - heading) < 0.003 &&
        (!height || Math.abs(I.h - height) < 1e-4) &&
        I.bs === blobScale
      )
        return;
      I.bs = blobScale;
      I.x = x;
      I.y = y;
      I.z = z;
      I.hd = heading;
      I.h = height || I.h;
      if (!relod(i)) writeMat(i);
      _q.setFromEuler(_e.set(0, heading, 0));
      _mx.compose(
        _p.set(x, y + 0.03, z),
        _q,
        _s.set(0.95 * blobScale, 1, 0.95 * blobScale * (blobScale > 1.2 ? 1.6 : 1)),
      );
      blobs.setMatrixAt(i, _mx);
      blobs.instanceMatrix.needsUpdate = true;
    },
    update(dt) {
      uTime.value += dt;
      bakeBudget = 0;
      // standing people do not call setTransform: re-check a slice of them against the moving camera every frame
      for (let k = 0; k < 40 && high > 0; k++) {
        lodScan = (lodScan + 1) % high;
        if (inst[lodScan]?.B) relod(lodScan);
      }
      // instances waiting for their person's bake (one bake per frame)
      for (const i of waiting) {
        const I = inst[i];
        if (!I || I.B || !I.pid) {
          waiting.delete(i);
          continue;
        }
        if (attach(i, I.pid)) {
          waiting.delete(i);
          break;
        } else if (bakeBudget) break;
      }
    },
    get time() {
      return uTime.value;
    },
    get active() {
      return high - free.length;
    },
    get tris() {
      let n = 0;
      for (const B of buckets.values()) n += (B.geo.index ? B.geo.index.count / 3 : 0) * B.n;
      return n;
    },
    stats() {
      return {
        buckets: buckets.size,
        baked: baked.size,
        inst: high - free.length,
        shown: [...buckets.values()].reduce((s, B) => s + B.n, 0),
        lods: [0, 1, 2].map((lv) =>
          [...buckets.values()].filter((B) => B.lv === lv).reduce((s, B) => s + B.n, 0),
        ),
      };
    },
    // tests / A-B: the LOD switch distances ([-1, -1] = LOD2 everywhere, as before Nov 19b)
    setLodNear(n0, n1) {
      LOD_NEAR[0] = n0;
      LOD_NEAR[1] = n1;
    },
    dispose() {
      group.parent?.remove(group);
      blobs.parent?.remove(blobs);
      for (const B of buckets.values()) {
        B.mesh.geometry.dispose();
      }
      for (const b of baked.values()) b?.mat?.dispose();
      for (const b of baked.values()) b?.tex.dispose();
      sg.dispose();
      smat.dispose();
    },
  };
  return api;
}
