// NPC characters built from archetypes (PEOPLE-LOOK track). createNpc() returns the same interface as the character
// track's ped characters (root, model, update(dt, anim), getBone, restyle, setCopGear, snapshotPose, setLOD, dispose,
// human, zoneTag, persona ...), so peds.js, ragdoll.js, people.v2.js and the jobs kit drive them unchanged.
// Extras: npcArch (archetype id), setPose(name) for staged people, applyLook(L) to map a people.v2 look onto the
// archetype's color slots.
// Level of detail by camera distance: full mesh to 15 m (budgeted), 7k-tri mesh to 60 m, 1.7k-tri mesh beyond;
// shadows only near; animation every frame near, every 2nd / 3rd frame farther, rarely off screen.
import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { getBase } from './lib.js';
import {
  makeBodyMaterial,
  makeHairMaterial,
  makeEyeMaterial,
  makeBrowMaterial,
  makeShoeMaterial,
} from './materials.js';
import { PERSONAS } from '../personality.js';
import { createNpcJiggle } from '../people/jiggle.js';
const _gL = new THREE.Vector3(),
  _gR = new THREE.Vector3();
const R4GAIT = !(typeof location !== 'undefined' && /[?&]r4gait=0/.test(location.search));
// planted-foot cadence feedback (below): experimental, off until verified on more people (?r4gaitfb=1 = on)
const R4GAITFB =
  R4GAIT && typeof location !== 'undefined' && /[?&]r4gaitfb=1/.test(location.search);
// shadow-only proxy layer for the user's people (enabled on the shadow cameras by src/npc/people/cast.js)
export const SHADOW_PROXY = { on: false, layer: 7 }; // layer 7 = the split sun's dynamic caster layer (render/stage/env/shadows.js)

export const LOD_DIST = [15, 60];
export const LOD_CFG = { maxFull: 8, shadowDist: 26, alwaysFull: 7 }; // nearest-first, anyone within 7 m always full; 8 slots (12 cost too much skinning in the app)   // user: close people must always be full quality
const rng = (seed) => {
  let a = (seed | 0) ^ 0x9e3779b9;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
const approach = (x, t, rate, dt) => x + (t - x) * (1 - Math.exp(-rate * dt));
const UP = new THREE.Vector3(0, 1, 0);
const _q1 = new THREE.Quaternion(),
  _q2 = new THREE.Quaternion(),
  _qa = new THREE.Quaternion(),
  _v = new THREE.Vector3();

// shared per archetype / color
const shared = new Map();
function sharedMat(key, make) {
  let m = shared.get(key);
  if (!m) {
    m = make();
    shared.set(key, m);
  }
  return m;
}

// idle style (peds / people.v2 vocabulary) -> clip
const STYLE_CLIP = {
  phone: 'phone_text',
  talk: 'talk_g',
  film: 'photo',
  photo: 'photo',
  cower: 'cower',
  lie: 'lie',
  sitGround: 'sitGround',
  sitBench: 'sitBench',
  sit: 'sit',
  stool: 'sit_stool',
  lean: 'lean_cross',
  lean_wall: 'lean_wall',
  lean_cross: 'lean_cross',
  kneel: 'kneel',
  volley: 'volley',
  swim: 'swim',
  drink: 'drink',
  smoke: 'smoke',
  cross_arms: 'cross_arms',
  cross: 'cross_arms',
  bartend: 'bartend',
  pour: 'pour',
  shake: 'shake',
  cook: 'cook',
  carry_tray: 'carry_tray',
  tray: 'carry_tray',
  idle_old: 'idle_old',
  idle_f: 'idle_f',
  idle: 'idle',
};
const FULL = new Set([
  'cower',
  'lie',
  'sitGround',
  'sitBench',
  'sit',
  'sit_stool',
  'lean_cross',
  'lean_wall',
  'kneel',
  'volley',
  'swim',
  'dance',
  'dance_arms',
  'dance_sway',
  'bartend',
  'cook',
  'shake',
  'pour',
]);
const UPPER = ['phoneCall', 'wave', 'argue', 'leash', 'handsUp'];

// ------------------------------------------------------------------ small props (original, procedural)
const PROP_MAT = {};
const _propOn = {
  phone: false,
  cup: false,
  rag: false,
  shaker: false,
  bottle: false,
  tray: false,
  cig: false,
};
const pm = (k, c, r = 0.5, m = 0) =>
  (PROP_MAT[k] ||= new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m }));
function makeProp(kind) {
  const g = new THREE.Group();
  g.name = 'npcProp:' + kind;
  const add = (geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    m.castShadow = true;
    g.add(m);
    return m;
  };
  if (kind === 'phone') {
    add(new THREE.BoxGeometry(0.072, 0.152, 0.009), pm('phone', 0x101114, 0.3, 0.4));
    add(
      new THREE.PlaneGeometry(0.064, 0.14),
      new THREE.MeshBasicMaterial({ color: 0x8fb4d8 }),
      0,
      0,
      0.0047,
    );
  } else if (kind === 'cup') {
    add(
      new THREE.CylinderGeometry(0.034, 0.028, 0.11, 14, 1, true),
      pm('glass', 0xd8e8ee, 0.08, 0.0),
    ).material.side = THREE.DoubleSide;
    add(new THREE.CylinderGeometry(0.03, 0.027, 0.06, 14), pm('drink', 0xb5541f, 0.2), 0, -0.022);
  } else if (kind === 'bottle') {
    add(
      new THREE.CylinderGeometry(0.035, 0.035, 0.2, 12),
      pm('bottle', 0x2f4a2a, 0.15, 0.1),
      0,
      -0.04,
    );
    add(new THREE.CylinderGeometry(0.012, 0.03, 0.08, 10), pm('bottle', 0x2f4a2a), 0, 0.1);
  } else if (kind === 'cig') {
    add(
      new THREE.CylinderGeometry(0.0045, 0.0045, 0.08, 8),
      pm('cig', 0xf2efe8, 0.8),
      0,
      0,
      0.03,
      Math.PI / 2,
      0,
      0,
    );
    add(
      new THREE.CylinderGeometry(0.0047, 0.0047, 0.022, 8),
      pm('cigF', 0xc98a4b, 0.8),
      0,
      0,
      -0.005,
      Math.PI / 2,
      0,
      0,
    );
    add(
      new THREE.CylinderGeometry(0.0047, 0.0047, 0.006, 8),
      new THREE.MeshBasicMaterial({ color: 0xff6a1a }),
      0,
      0,
      0.071,
      Math.PI / 2,
      0,
      0,
    );
  } // across the fingers, lit end out
  else if (kind === 'shaker') {
    add(new THREE.CylinderGeometry(0.04, 0.034, 0.2, 14), pm('steel', 0xc8ccd0, 0.25, 1.0));
  } else if (kind === 'rag') {
    add(new THREE.BoxGeometry(0.16, 0.012, 0.12), pm('rag', 0xe9e4d8, 0.95), 0, -0.03, 0.02);
  } else if (kind === 'tray') {
    add(new THREE.CylinderGeometry(0.19, 0.19, 0.012, 24), pm('tray', 0x2a2a2c, 0.35, 0.6));
    for (let i = 0; i < 3; i++)
      add(
        new THREE.CylinderGeometry(0.03, 0.025, 0.12, 10),
        pm('glass', 0xd8e8ee, 0.08),
        -0.07 + i * 0.07,
        0.066,
        (i % 2) * 0.05,
      );
  }
  return g;
}
// hand-local offsets (canonical: the right hand points -X, palm -Y in T-pose)
const PROP_AT = {
  cig: [-0.05, -0.022, -0.012, 0, 0, 0],
  phone: [-0.085, -0.025, 0.02, 0, 0, Math.PI / 2],
  cup: [-0.07, -0.04, 0.0, 0, 0, 0],
  bottle: [-0.08, -0.04, 0, 0, 0, Math.PI / 2],
  shaker: [-0.07, -0.04, 0, 0, 0, Math.PI / 2],
  rag: [-0.08, -0.03, 0, 0, 0, 0],
  tray: [-0.1, 0.03, 0, 0, 0, 0],
};

// ------------------------------------------------------------------ variants
const HAIR_SHADES = {
  dark: ['#0e0b09', '#16100c', '#1c130e', '#24170f'],
  brown: ['#3a2414', '#4f3622', '#5a3f28', '#6b4a2e'],
  fair: ['#7a5a36', '#8a6a3e', '#a8854f'],
  grey: ['#8f8a80', '#a8a49b', '#bab4aa', '#cfcac0'],
};
function hairFamily(hex) {
  const c = new THREE.Color(hex);
  const l = c.r * 0.3 + c.g * 0.59 + c.b * 0.11;
  if (Math.abs(c.r - c.b) < 0.08 && l > 0.3) return 'grey';
  return l < 0.09 ? 'dark' : l < 0.25 ? 'brown' : 'fair';
}

export function createNpc(game, opts = {}) {
  const base = opts.base || getBase(opts.archetype);
  if (!base) return null;
  const seed = opts.seed ?? (Math.random() * 1e9) | 0;
  const r = rng(seed * 7 + 3);
  const meta = base.meta;
  const model = SkeletonUtils.clone(base.scene);
  model.name = 'npc:' + base.id;
  // ---- materials (body per person: tints + garment slot variants; the rest shared)
  // the user's people (src/npc/people): one baked-texture material per person (+ a small tint variant); archetypes: slots
  const isPerson = !!base.person;
  const vary = opts.vary ?? 0.7;
  const body = isPerson
    ? opts.personMaterial
      ? opts.personMaterial(base, opts.tint || 0)
      : null
    : makeBodyMaterial(base);
  const U = body?.userData?.u || null;
  if (U)
    U.uSkinTint.value.setRGB(
      1 + (r() - 0.5) * 0.06 * vary,
      1 + (r() - 0.5) * 0.05 * vary,
      1 + (r() - 0.5) * 0.05 * vary,
    );
  const hairHex =
    opts.hairColor ||
    (r() < 0.6 * vary
      ? HAIR_SHADES[hairFamily(meta.hairColor || '#1a1410')][
          Math.floor(r() * 4) % HAIR_SHADES[hairFamily(meta.hairColor || '#1a1410')].length
        ]
      : meta.hairColor || '#1a1410');
  const hairCol = new THREE.Color(hairHex);
  if (U) {
    const b = new THREE.Color(meta.hairColor || '#1a1410');
    U.uHairTint.value.setRGB(
      hairCol.r / Math.max(0.02, b.r),
      hairCol.g / Math.max(0.02, b.g),
      hairCol.b / Math.max(0.02, b.b),
    );
  }
  const setSlots = (rr, k) => {
    if (!U) return;
    for (let s = 1; s <= 5; s++) {
      const big = rr() < 0.55 * k;
      U.uSlot.value[s].set(
        big ? (rr() - 0.5) * Math.PI * 2 * k : (rr() - 0.5) * 0.35 * k,
        1 + (rr() - 0.5) * 0.3 * k,
        0,
        0,
      );
    }
  };
  setSlots(r, vary);
  const hairMat = base.shared.hair
    ? sharedMat(base.id + ':hair:' + hairHex, () => makeHairMaterial(base.shared.hair, hairHex))
    : null;
  const eyeMat = base.shared.eye
    ? sharedMat('eye:' + meta.eyes, () => makeEyeMaterial(base.shared.eye))
    : null;
  const browMat = base.shared.brow
    ? sharedMat('brow:' + meta.brows + ':' + hairHex, () =>
        makeBrowMaterial(base.shared.brow, hairCol.clone().multiplyScalar(1.2), false),
      )
    : null;
  const lashMat = base.shared.lash
    ? sharedMat('lash:' + meta.lashes, () => makeBrowMaterial(base.shared.lash, 0x0c0a09, true))
    : null;
  const shoeMat = base.shared.shoe
    ? sharedMat('shoe:' + meta.shoes, () => makeShoeMaterial(base.shared.shoe))
    : null;
  const lods = [[], [], []];
  const meshes = [];
  const detail = [];
  model.traverse((m) => {
    if (!m.isMesh) return;
    const nm = m.name;
    const lv = +(/LOD(\d)/.exec(nm) || [0, 0])[1];
    if (/_body/.test(nm)) {
      if (body) m.material = body;
    } else if (/_hair/.test(nm)) {
      if (hairMat) m.material = hairMat;
      else m.visible = false;
    } else if (/_eyes/.test(nm)) {
      m.material = eyeMat;
      detail.push(m);
    } else if (/_brows/.test(nm)) {
      m.material = browMat;
      detail.push(m);
    } else if (/_lashes/.test(nm)) {
      m.material = lashMat;
      detail.push(m);
    } else if (/_shoes/.test(nm)) {
      if (shoeMat) m.material = shoeMat;
    }
    m.frustumCulled = true;
    m.receiveShadow = true;
    m.castShadow = !detail.includes(m);
    if (m.isSkinnedMesh && m.geometry) {
      if (!m.geometry.boundingSphere) m.geometry.computeBoundingSphere();
      const bs = m.geometry.boundingSphere.clone();
      bs.radius *= 1.4;
      m.boundingSphere = bs;
    }
    lods[lv].push(m);
    meshes.push(m);
    m.visible = lv === 0;
  });
  // LOD0 hair stays on at LOD1 (cards); LOD2 hair only where the archetype has a low hair mesh
  const hairL0 = lods[0].filter((m) => /_hair/.test(m.name));
  const hasL2Hair = lods[2].some((m) => /_hair/.test(m.name));
  const root = new THREE.Group();
  root.name = 'npc-' + base.id;
  const holder = new THREE.Group();
  holder.add(model);
  root.add(holder);
  const hs = opts.scale || 1 + (r() - 0.5) * 0.045 * vary;
  holder.scale.setScalar(hs);
  const bones = {};
  model.traverse((o) => {
    if (o.isBone) bones[o.name.replace(/^mixamorig[:_]?/, '')] = o;
  });
  // Nov 19b: subtle chest / glute secondary motion for the women among the user's people, near and at full detail only
  // (src/npc/people/jiggle.js; costs nothing farther away)
  const jigMesh =
    isPerson && meta.gender === 'f'
      ? lods[0].find((m) => m.isSkinnedMesh && /_body/.test(m.name))
      : null;
  const jig = jigMesh
    ? createNpcJiggle(game, {
        mesh: jigMesh,
        template: base.meshes?.[jigMesh.name] || null,
        hips: bones.Hips || null,
        root,
      })
    : null;
  const headBone = bones.Head,
    handR = bones.RightHand,
    handL = bones.LeftHand;

  // ---- animation (actions created lazily the first time they get weight)
  const mixer = new THREE.AnimationMixer(model);
  const C = base.clips;
  const realA = {},
    stubs = {};
  const realize = (n) => {
    let a = realA[n];
    if (!a) {
      a = mixer.clipAction(C[n]);
      a.setLoop(THREE.LoopRepeat, Infinity);
      a.timeScale = 0;
      a.setEffectiveWeight(0);
      a.play();
      realA[n] = a;
    }
    return a;
  };
  const mkStub = (n) => {
    const sb = {
      time: 0,
      setEffectiveWeight(w) {
        if (w > 0.001) {
          const a = realize(n);
          a.time = sb.time;
          a.setEffectiveWeight(w);
        }
      },
      getEffectiveWeight() {
        return 0;
      },
      getClip() {
        return C[n];
      },
    };
    return sb;
  };
  const A = new Proxy(realA, {
    get(t, n) {
      if (t[n]) return t[n];
      if (typeof n === 'string' && C[n]) return (stubs[n] ||= mkStub(n));
      return undefined;
    },
  });
  const setW = (a, w) => {
    if (a) a.setEffectiveWeight(w);
  };
  const setT = (a, t) => {
    if (a) a.time = t;
  };
  const old = (meta.years || 30) > 62,
    fem = meta.gender === 'f';
  const walkName = meta.heels
    ? 'walk_heels'
    : old
      ? 'walk_old'
      : fem
        ? 'walk_f'
        : r() < 0.5
          ? 'walk_m'
          : 'walk';
  const idleBase = old ? 'idle_old' : fem ? (r() < 0.6 ? 'idle_f' : 'idle') : 'idle';
  const idleName = C[idleBase + '_m'] && r() < 0.5 ? idleBase + '_m' : idleBase;
  const loco = [];
  const pushLoco = (n) => {
    if (C[n]) loco.push({ n, c: C[n], v: C[n].userData.speed || 1.3 });
  };
  pushLoco(walkName);
  if (C.walk_brisk && !old && !meta.heels) pushLoco('walk_brisk');
  pushLoco('jog');
  pushLoco('run');
  pushLoco('sprint');
  loco.sort((x, y) => x.v - y.v);
  for (let i = 1; i < loco.length; i++)
    if (loco[i].v < loco[i - 1].v + 0.35) loco[i].v = loco[i - 1].v + 0.35;
  const ws = new Array(loco.length).fill(0);
  const danceName = ['dance', 'dance_arms', 'dance_sway'][Math.floor(r() * 3)];
  const mirror = r() < 0.5;
  const styleClip = (s) => {
    if (!s) return null;
    if (s === 'dance') return danceName;
    const c = STYLE_CLIP[s] || s;
    const m = mirror && C[c + '_m'] ? c + '_m' : c;
    return C[m] ? m : C[c] ? c : null;
  };
  let persona = opts.personality ? PERSONAS[opts.personality] || null : null;
  const OWN = {
    idle: 0,
    idle_f: 0,
    idle_old: 0,
    walk: 0,
    walk_f: 0,
    walk_heels: 0,
    walk_old: 0,
    jog: 0,
    lean_cross: 0,
    lean_wall: 0,
    sit: 0,
    sit_stool: 0,
    dance: 0,
    volley: 0,
    carry_tray: 1,
    phone: 'phone_text',
    talk: 'talk_g',
    photo: 'photo',
  };
  const ownPoses = (meta.poses || [])
    .map((p) => (OWN[p] === 0 ? null : typeof OWN[p] === 'string' ? OWN[p] : p))
    .filter((p) => p && C[p]);
  const st = {
    s: 0,
    phase: r(),
    idleT: r() * 20,
    air: 0,
    airT: 0,
    jumpT: 0,
    drive: 0,
    dead: 0,
    deadT: 0,
    deadName: 'deadBack',
    punchT: -1,
    punchName: 'punchR',
    prevPunch: false,
    prevDead: false,
    accum: 0,
    lean: 0,
    prevHeading: null,
    styleW: 0,
    styleName: null,
    look: 0,
    lookYaw: 0,
    hitT: -1,
    throwT: -1,
    getUpName: null,
    getUpT: 0,
    snap: null,
    snapT: 0,
    snapDur: 0,
    forced: opts.pose || null,
    lodTick: 0,
  };
  // props held in the hands
  const props = {};
  const prop = (kind) => {
    if (!props[kind] && handR && PROP_AT[kind]) {
      const p = makeProp(kind);
      const o = PROP_AT[kind];
      const holderP = new THREE.Group();
      holderP.add(p);
      p.position.set(o[0], o[1], o[2]);
      p.rotation.set(o[3], o[4], o[5]);
      // hand-local: undo the hand's rest world rotation so offsets are in model axes, then re-express in bone space
      const hb = kind === 'tray' ? handL : handR;
      hb.add(holderP);
      model.updateMatrixWorld(true);
      const wq = hb.getWorldQuaternion(new THREE.Quaternion());
      const mq = model.getWorldQuaternion(new THREE.Quaternion());
      holderP.quaternion.copy(wq.invert().multiply(mq));
      if (kind === 'tray') p.position.x = -p.position.x;
      props[kind] = holderP;
    }
    return props[kind];
  };

  function update(dt, anim = {}) {
    const dtRaw = dt || 0;
    dt = Math.min(dt || 0, 0.1);
    const dead = !!anim.dead,
      driving = !!anim.driving && !dead,
      airborne = !dead && !driving && anim.grounded === false;
    const speed = dead || driving ? 0 : Math.max(0, anim.speed || 0);
    if (speed < st.s * 0.6 && !dead && !driving && !airborne) st.dipT = (st.dipT || 0) + dt;
    else st.dipT = 0;
    const sIn = st.dipT > 0 && st.dipT < 0.18 ? st.s : speed;
    st.s = approach(st.s, sIn, sIn > st.s ? 6 : 4, dt);
    if (dead && !st.prevDead) {
      st.deadT = 0;
      st.deadName =
        anim.deadStyle === 'fwd' && C.deadFwd
          ? 'deadFwd'
          : anim.deadStyle === 'back'
            ? 'deadBack'
            : C.deadFwd && Math.random() < 0.5
              ? 'deadFwd'
              : 'deadBack';
    }
    st.prevDead = dead;
    st.dead = approach(st.dead, dead ? 1 : 0, dead ? 14 : 3, dt);
    if (dead) st.deadT += dt;
    st.drive = approach(st.drive, driving ? 1 : 0, 6, dt);
    if (airborne) {
      st.airT += dt;
      if (anim.jumping) st.jumpT += dt;
    } else {
      st.airT = 0;
      st.jumpT = 0;
    }
    st.air = approach(
      st.air,
      airborne && (st.airT > 0.3 || anim.jumping) ? 1 : 0,
      airborne ? 8 : 14,
      dt,
    );
    const p = !!anim.punch;
    if (p && !st.prevPunch && !dead && !driving && (st.punchT < 0 || st.punchT > 0.22)) {
      st.punchT = 0;
      st.punchName = st.punchName === 'punchR' ? 'punchL' : 'punchR';
    }
    st.prevPunch = p;
    let punchW = 0;
    if (st.punchT >= 0) {
      const pc = C[st.punchName];
      const dur = pc ? pc.duration : 0.5;
      st.punchT += dt;
      if (st.punchT > dur) st.punchT = -1;
      else punchW = Math.min(1, st.punchT / 0.05) * Math.min(1, (dur - st.punchT) / 0.14);
    }
    if (
      anim.getUp &&
      anim.getUp !== st.getUpPrev &&
      C[anim.getUp === 'fwd' ? 'getUpFwd' : 'getUpBack']
    ) {
      st.getUpName = anim.getUp === 'fwd' ? 'getUpFwd' : 'getUpBack';
      st.getUpT = 0;
    }
    st.getUpPrev = anim.getUp || null;
    let gw = 0;
    if (st.getUpName) {
      const gd = C[st.getUpName].duration;
      st.getUpT += dt;
      gw = st.getUpT < gd - 0.3 ? 1 : Math.max(0, (gd - st.getUpT) / 0.3);
      if (st.getUpT > gd) st.getUpName = null;
    }
    for (const gn of ['getUpBack', 'getUpFwd'])
      if (C[gn]) {
        setT(A[gn], gn === st.getUpName ? Math.min(st.getUpT, C[gn].duration - 0.001) : 0);
        setW(A[gn], gn === st.getUpName ? gw : 0);
      }
    const baseW = (1 - st.dead) * (1 - st.drive) * (1 - gw);
    const locoW = baseW * (1 - st.air);
    ws.fill(0);
    let idleW = 0;
    const s = st.s;
    if (!loco.length || s <= 0.05) idleW = 1;
    else if (s < loco[0].v) {
      const k = s / loco[0].v;
      const kk = THREE.MathUtils.smoothstep(k, 0.0, 0.7);
      idleW = 1 - kk;
      ws[0] = kk;
    } else {
      let done = false;
      for (let i = 0; i < loco.length - 1; i++)
        if (s < loco[i + 1].v) {
          const k = (s - loco[i].v) / (loco[i + 1].v - loco[i].v);
          ws[i] = 1 - k;
          ws[i + 1] = k;
          done = true;
          break;
        }
      if (!done) ws[loco.length - 1] = 1;
    }
    let D = 0,
      wsum = 0;
    loco.forEach((l, i) => {
      D += ws[i] * l.v * l.c.duration;
      wsum += ws[i];
    });
    // r4-anim (user: people "float/slide when walking"): the cycle advances by the distance the body REALLY travels (root
    // displacement per frame, low-passed; the commanded speed is only a guide, kept within 0.6-1.4x of it) over the stride
    // of THIS body (the clip's stride is measured at the reference scale: times the holder / root scale), so planted feet
    // stay planted. ?r4gait=0 = the old cadence from the commanded speed at the reference stride.
    if (R4GAIT) {
      const pp = root.position,
        dtr = dtRaw;
      if (st.gp && dtr > 1e-4 && dtr < 0.3) {
        const d = Math.hypot(pp.x - st.gp.x, pp.z - st.gp.z);
        if (d < 4) st.gs = approach(st.gs ?? s, d / dtr, 10, dtr);
      }
      (st.gp ||= new THREE.Vector3()).copy(pp);
    }
    if (wsum > 0.001) {
      D /= wsum;
      let effS = Math.max(s, loco[0].v * 0.55);
      if (R4GAIT) {
        const sc = hs * (root.scale.x || 1);
        D *= sc;
        if (Number.isFinite(st.gs) && s > 0.3)
          effS = Math.max(THREE.MathUtils.clamp(st.gs, s * 0.6, s * 1.4), loco[0].v * 0.55 * sc);
      }
      if (R4GAITFB) effS *= st.gk || 1;
      st.phase = (st.phase + (dt * effS) / Math.max(D, 0.3)) % 1;
    }
    for (let i = 0; i < loco.length; i++) {
      const l = loco[i],
        a = A[l.n];
      setT(a, st.phase * l.c.duration);
      setW(a, ws[i] * locoW);
    }
    st.idleT += dt;
    // idle styles: forced pose (staged people) > requested style > persona idles
    let want = st.forced || anim.idleStyle;
    // the archetype's own repertoire (bartenders wipe and pour, workers cross their arms, people check phones) when
    // nobody asked for anything and the person has been standing a while
    if (!want && st.s < 0.1 && ownPoses.length) {
      st.ownT = (st.ownT ?? 3 + r() * 6) - dt;
      if (st.ownT <= 0) {
        st.ownT = 7 + r() * 9;
        st.own = r() < 0.35 ? null : ownPoses[Math.floor(r() * ownPoses.length)];
      }
      want = st.own || null;
    } else if (st.s >= 0.1) {
      st.own = null;
      st.ownT = 2 + r() * 4;
    }
    if (want === undefined && persona?.idles) {
      st.pIdleT = (st.pIdleT ?? 0) - dt;
      if (st.pIdleT <= 0) {
        st.pIdleT = 4 + r() * 8;
        st.pIdle = persona.idles[Math.floor(r() * persona.idles.length)];
      }
      want = st.pIdle;
    }
    const wantClip = styleClip(want);
    if (wantClip && wantClip !== st.styleName) {
      if (st.styleW < 0.05 || !st.styleName) {
        st.styleName = wantClip;
        st.styleT0 = st.idleT;
      }
    }
    st.styleW = approach(
      st.styleW,
      wantClip && wantClip === st.styleName ? 1 : 0,
      wantClip === 'cower' ? 10 : st.forced ? 30 : 4,
      dt,
    );
    if (st.styleW < 0.02 && !wantClip) st.styleName = null;
    const full = st.styleName && FULL.has(st.styleName.replace(/_m$/, ''));
    const styleW = st.styleW * (full ? 1 : idleW);
    for (const n in C) {
      if (
        C[n].userData.loco ||
        (n === idleName && n !== st.styleName) ||
        UPPER.includes(n) ||
        /^(getUp|dead|punch|jump|fall|drive|hitReact|throwDisc)/.test(n)
      )
        continue;
      if (n === st.styleName) {
        setT(A[n], (st.idleT - (st.styleT0 || 0) + (seed % 7)) % C[n].duration);
        setW(A[n], styleW * locoW);
      } else if (realA[n]) setW(realA[n], 0);
    }
    if (full)
      for (let i = 0; i < loco.length; i++) setW(A[loco[i].n], ws[i] * locoW * (1 - st.styleW));
    const idleA = A[idleName];
    if (idleA && st.styleName !== idleName) {
      setT(idleA, (st.idleT + (seed % 11)) % C[idleName].duration);
      setW(idleA, idleW * locoW * (1 - styleW));
    }
    // upper-body overlays
    st.callW = approach(st.callW || 0, anim.call ? 1 : 0, 4, dt);
    if (C.phoneCall) {
      setT(A.phoneCall, st.idleT % C.phoneCall.duration);
      setW(A.phoneCall, st.callW * 4 * locoW);
    }
    st.waveW = approach(st.waveW || 0, anim.wave ? 1 : 0, 6, dt);
    if (C.wave) {
      setT(A.wave, (st.idleT * 0.9) % C.wave.duration);
      setW(A.wave, st.waveW * 5 * locoW);
    }
    st.argW = approach(st.argW || 0, anim.argue ? 1 : 0, 5, dt);
    if (C.argue) {
      setT(A.argue, st.idleT % C.argue.duration);
      setW(A.argue, st.argW * 4 * locoW);
    }
    st.leashW = approach(st.leashW || 0, anim.leash ? 1 : 0, 4, dt);
    if (C.leash) {
      setT(A.leash, st.idleT % C.leash.duration);
      setW(A.leash, st.leashW * 3 * locoW);
    }
    if (anim.hit && !st.prevHit) st.hitT = 0;
    st.prevHit = !!anim.hit;
    if (C.hitReact) {
      let hw = 0;
      const d = C.hitReact.duration;
      if (st.hitT >= 0) {
        st.hitT += dt;
        if (st.hitT > d) st.hitT = -1;
        else hw = Math.min(1, st.hitT / 0.04) * Math.min(1, (d - st.hitT) / 0.2);
      }
      setT(A.hitReact, Math.max(0, Math.min(st.hitT, d - 0.001)));
      setW(A.hitReact, hw * 6 * baseW);
    }
    if (anim.throw && !st.prevThrow) st.throwT = 0;
    st.prevThrow = !!anim.throw;
    if (C.throwDisc) {
      let tw = 0;
      const d = C.throwDisc.duration;
      if (st.throwT >= 0) {
        st.throwT += dt;
        if (st.throwT > d) st.throwT = -1;
        else tw = Math.min(1, st.throwT / 0.15) * Math.min(1, (d - st.throwT) / 0.3);
      }
      setT(A.throwDisc, Math.max(0, Math.min(st.throwT, d - 0.001)));
      setW(A.throwDisc, tw * 5 * baseW);
    }
    st.upW = approach(st.upW || 0, anim.handsUp && s > 1 ? 1 : 0, 6, dt);
    if (C.handsUp) {
      setT(A.handsUp, st.idleT % C.handsUp.duration);
      setW(A.handsUp, st.upW * 3 * locoW);
    }
    const airW = baseW * st.air;
    const jf = anim.jumping ? THREE.MathUtils.smoothstep(st.airT, 0.45, 0.9) : 1;
    if (C.jump) {
      setT(A.jump, Math.min(st.jumpT, C.jump.duration - 0.001));
      setW(A.jump, airW * (1 - jf));
    }
    if (C.fall) {
      setT(A.fall, st.airT % C.fall.duration);
      setW(A.fall, airW * jf);
    }
    if (C.drive) {
      setT(A.drive, (st.idleT * 0.5) % C.drive.duration);
      setW(A.drive, (1 - st.dead) * st.drive);
    }
    for (const dn of ['deadBack', 'deadFwd'])
      if (C[dn]) {
        setT(A[dn], Math.min(st.deadT, C[dn].duration - 0.001));
        setW(A[dn], dn === st.deadName ? st.dead : 0);
      }
    for (const pn of ['punchR', 'punchL'])
      if (C[pn]) {
        setT(A[pn], pn === st.punchName && st.punchT >= 0 ? st.punchT : 0);
        setW(A[pn], pn === st.punchName ? punchW * 8 * (1 - st.dead) * (1 - st.drive) : 0);
      }
    st.guardW = approach(st.guardW || 0, anim.guard && !dead ? 1 : 0, 8, dt);
    if (st.guardW > 0.01 && C.punchR && !(st.punchT >= 0)) {
      setT(A.punchR, 0);
      setW(A.punchR, st.guardW * 6 * baseW);
    }
    // props: phone for texting / filming / calls, cup, bar tools, tray
    const pc = st.styleName ? C[st.styleName]?.userData.prop : null;
    const propOn = _propOn;
    propOn.phone = (pc === 'phone' && styleW > 0.4) || st.callW > 0.4;
    propOn.cup = pc === 'cup' && styleW > 0.4;
    propOn.rag = pc === 'rag' && styleW > 0.4;
    propOn.shaker = pc === 'shaker' && styleW > 0.4;
    propOn.bottle = pc === 'bottle' && styleW > 0.4;
    propOn.tray = pc === 'tray' && styleW > 0.4;
    propOn.cig = pc === 'cig' && styleW > 0.4; // (no per-frame object)
    for (const k in propOn) {
      if (propOn[k]) prop(k).visible = true;
      else if (props[k]) props[k].visible = false;
    }
    st.cupUp = !!(props.cup && props.cup.visible);
    character.hasPhone = true;
    // lean into turns, pitch with acceleration (on the holder)
    let turn = 0;
    if (st.prevHeading !== null && dt > 0) {
      let dh = root.rotation.y - st.prevHeading;
      dh = Math.atan2(Math.sin(dh), Math.cos(dh));
      turn = THREE.MathUtils.clamp(dh / dt, -4, 4);
    }
    st.prevHeading = root.rotation.y;
    st.lean = approach(st.lean, -turn * Math.min(1, s / 6) * 0.05 * baseW * (1 - st.air), 6, dt);
    holder.rotation.z =
      st.lean +
      (persona?.sway ? Math.sin(st.idleT * 1.7) * persona.sway * 0.12 * Math.min(1, 0.3 + s) : 0);
    const rawAcc = dt > 0 ? (speed - (st.prevSpeed ?? speed)) / dt : 0;
    st.prevSpeed = speed;
    st.acc = approach(st.acc || 0, THREE.MathUtils.clamp(rawAcc, -12, 12), 5, dt);
    st.pitch = approach(
      st.pitch || 0,
      THREE.MathUtils.clamp(st.acc * 0.011, -0.07, 0.08) * baseW * (1 - st.air),
      7,
      dt,
    );
    holder.rotation.x = st.pitch;
    // distance LOD + animation rate
    const cam = game?.camera?.position;
    const rp = character.inCar && root.parent ? root.getWorldPosition(_v) : root.position; // seated in a car: shell space
    const d = cam ? Math.hypot(rp.x - cam.x, rp.y - cam.y, rp.z - cam.z) : 5;
    pickLOD(d);
    const every = opts.lod && opts.lod > 2 ? opts.lod : d < 30 ? 1 : d < 60 ? 2 : 3;
    st.accum += dt;
    st.lodTick = (st.lodTick + 1) % every;
    if (st.lodTick !== 0 && !st.snap) return;
    const mdt = st.accum;
    mixer.update(st.accum);
    st.accum = 0;
    if (jig) jig.update(mdt, d, cur);
    // r4-anim: planted-foot feedback. The clip's measured stride speed can be off for a body (shared clips rescaled by hip
    // height only; one test walker's stance foot moved back at 0.8-1.04 m/s at 1.35 m/s walking; the measure is not conclusive yet).
    // While walking steadily, the stance foot's backward speed under the body is compared with the body's real speed and
    // the cadence factor st.gk is nudged until they match (feet then stay put on the ground).
    if (
      R4GAITFB &&
      locoW * wsum > 0.8 &&
      s > 0.6 &&
      !st.snap &&
      bones.LeftFoot &&
      bones.RightFoot
    ) {
      bones.LeftFoot.getWorldPosition(_gL);
      bones.RightFoot.getWorldPosition(_gR);
      const lo = _gL.y < _gR.y ? 0 : 1,
        p = lo ? _gR : _gL,
        sy = Math.sin(root.rotation.y),
        cy = Math.cos(root.rotation.y);
      const z = (p.x - root.position.x) * sy + (p.z - root.position.z) * cy,
        y = p.y - root.position.y,
        g = (st.gf ||= { lo: -1, z: 0, y: 0 });
      if (g.lo === lo && mdt > 1e-4 && Math.abs(y - g.y) < 0.012) {
        const vz = (z - g.z) / mdt,
          want = Number.isFinite(st.gs) ? st.gs : s;
        if (vz < -0.3 && want > 0.4)
          st.gk = THREE.MathUtils.clamp(
            approach(st.gk || 1, ((st.gk || 1) * want) / -vz, 1.2, mdt),
            0.6,
            1.7,
          );
      }
      g.lo = lo;
      g.z = z;
      g.y = y;
    } else if (st.gf) st.gf.lo = -1;
    if (st.cupUp) {
      const h = props.cup;
      h.parent.getWorldQuaternion(_q1);
      root.getWorldQuaternion(_q2);
      h.quaternion.copy(_q1.invert().multiply(_q2));
    } // drinks stay upright
    // head look-at
    let wantYaw = 0,
      wantLook = 0;
    if (anim.lookAt && headBone && !dead && !driving && cur < 2) {
      const dx = anim.lookAt.x - root.position.x,
        dz = anim.lookAt.z - root.position.z;
      let a = Math.atan2(dx, dz) - root.rotation.y;
      a = Math.atan2(Math.sin(a), Math.cos(a));
      if (Math.abs(a) < 1.9) {
        wantYaw = THREE.MathUtils.clamp(a, -1.1, 1.1);
        wantLook = 1;
      }
    }
    st.look = approach(st.look, wantLook, 4, dt * every);
    st.lookYaw = approach(st.lookYaw, wantYaw, 5, dt * every);
    if (headBone && st.look > 0.01) {
      headBone.parent.getWorldQuaternion(_q1);
      _q2.setFromAxisAngle(UP, st.lookYaw * st.look * 0.75);
      headBone.quaternion.premultiply(_qa.copy(_q1).invert().multiply(_q2).multiply(_q1));
    }
    if (st.snap && st.snapT < st.snapDur) {
      st.snapT += dt * every;
      const k = THREE.MathUtils.smoothstep(st.snapT / st.snapDur, 0, 1);
      // Nov 19: slerpQuaternions(e.q, e.b.quaternion, k) overwrote the bone before reading it, so the blend did nothing and
      // the bones snapped from the ragdoll pose to the clip at the end (same fix as src/player/characterModel.js)
      for (const e of st.snap) {
        const animQ = (e.aq ||= new THREE.Quaternion()).copy(e.b.quaternion);
        const animP = (e.ap ||= new THREE.Vector3()).copy(e.b.position);
        e.b.quaternion.slerpQuaternions(e.q, animQ, k);
        e.b.position.lerpVectors(e.p, animP, k);
      }
      if (st.snapT >= st.snapDur) st.snap = null;
    }
  }

  // ---- LOD (distance + a budget of full-detail people per frame)
  let cur = -1,
    curSh = null;
  function pickLOD(d) {
    let lv = cur < 0 ? (d < LOD_DIST[0] ? 0 : d < LOD_DIST[1] ? 1 : 2) : cur;
    if (lv === 0 && d > LOD_DIST[0] * 1.1) lv = 1;
    if (lv <= 1 && d > LOD_DIST[1] * 1.08) lv = 2;
    if (lv === 2 && d < LOD_DIST[1] * 0.92) lv = 1;
    if (lv >= 1 && d < LOD_DIST[0] * 0.9) lv = 0;
    if (lv === 0) {
      // full-detail slots go to the NEAREST people (last frame's ranking), not to whoever updates first;
      // anyone within alwaysFull meters is always full detail (user: a woman next to the camera showed the 5k LOD1 body)
      const f = budget(game);
      f.cand.push(d);
      if (d > LOD_CFG.alwaysFull && (d > f.cut || f.full >= LOD_CFG.maxFull + 4)) lv = 1;
      else f.full++;
    }
    applyLOD(lv, d < LOD_CFG.shadowDist);
  }
  function applyLOD(lv, sh) {
    if (lv === cur && sh === curSh) return;
    cur = lv;
    curSh = sh;
    for (let i = 0; i < 3; i++) for (const m of lods[i]) m.visible = i === lv;
    if (lv === 1) for (const m of hairL0) m.visible = true;
    if (lv === 2 && !hasL2Hair && /afro|long|bob|braid|pony|bun/.test(meta.hair || ''))
      for (const m of hairL0) m.visible = true;
    for (const m of meshes) m.castShadow = sh && !detail.includes(m) && m.visible;
    // the user's people: a full-detail person (LOD0 = the whole scan) casts its shadow with the 5k LOD1 mesh on the
    // shadow-only layer (src/npc/people/lib.js SHADOW_LAYER), the same silhouette for a fraction of the skinning cost
    if (isPerson && SHADOW_PROXY.on) {
      // three tests casters against the MAIN camera's layers; the split sun renders its dynamic map with that mask set to
      // the dynamic layer (7), so the proxy lives on layer 7 only (cast, never drawn) and LOD1 keeps 0 + 7 when drawn
      for (const m of lods[1]) {
        m.layers.set(0);
        m.layers.enable(SHADOW_PROXY.layer);
      }
      if (lv === 0 && sh) {
        for (const m of lods[0]) m.castShadow = false;
        for (const m of lods[1]) {
          m.visible = true;
          m.castShadow = true;
          m.layers.set(SHADOW_PROXY.layer);
        }
      }
    }
    character.lodLevel = lv;
  }

  const human = {
    id: base.id,
    gender: meta.gender,
    race: meta.race,
    zone: (meta.place || [])[0] || 'street',
    years: meta.years,
    shells: [],
    clothes: [],
    arch: !isPerson,
    person: isPerson,
    role: meta.role || null,
    age: meta.age || null,
  };
  const character = {
    root,
    model,
    mixer,
    base: 'npc',
    npcArch: base.id,
    archetype: meta,
    lodLevel: 0,
    update,
    setVisible(v) {
      root.visible = v;
    },
    getBone(name) {
      return bones[name] || null;
    },
    restyle(zone) {
      const cop = zone === 'cop';
      character.setCopGear(cop);
    },
    setCopGear() {
      /* police archetypes are dressed in uniform already */
    },
    hasPhone: true,
    personality: opts.personality || null,
    persona,
    setPersonality(n) {
      persona = PERSONAS[n] || null;
      st.pIdleT = 0;
      character.personality = n;
      character.persona = persona;
    },
    setPose(name) {
      st.forced = name || null;
      st.pIdleT = 0;
    },
    get pose() {
      return st.forced;
    },
    /** map a people.v2 look record onto this archetype: garment slot hue/value from its colors, height */
    applyLook(L) {
      if (!L) return null;
      const rr = rng((L.sig ? L.sig.length * 131 : 7) + seed);
      setSlots(rr, Math.min(1, vary + 0.2));
      if (L.height && meta.height && !isPerson)
        holder.scale.setScalar(THREE.MathUtils.clamp(L.height / meta.height, 0.94, 1.06));
      return {
        props: [],
        accKinds: [],
        height: meta.height * holder.scale.y,
        scale: holder.scale.y,
        body: base.id,
        pal: null,
      };
    },
    _applyLOD: applyLOD,
    dispose() {
      try {
        mixer.stopAllAction();
        mixer.uncacheRoot(model);
      } catch (e) {
        /* */
      }
      model.traverse((o) => {
        if (o.isSkinnedMesh && o.skeleton) {
          try {
            o.skeleton.dispose();
          } catch (e) {
            /* */
          }
        }
      });
      if (body && !body.userData.shared) body.dispose();
      if (jig) jig.dispose();
    },
    snapshotPose(dur = 0.35) {
      const arr = [];
      model.traverse((o) => {
        if (o.isBone) arr.push({ b: o, q: o.quaternion.clone(), p: o.position.clone() });
      });
      st.snap = arr;
      st.snapT = 0;
      st.snapDur = dur;
    },
    human,
    zoneTag: human.zone,
    setLOD(n) {
      opts.lod = n;
    },
    setVariant(k) {
      setSlots(rng(seed + 99), k);
    },
  };
  update(0, { speed: 0, grounded: true });
  return character;
}

// frame budget for full-detail meshes
let _bf = -1;
const _budget = { full: 0, cand: [], cut: Infinity };
function budget(game) {
  const f = game?.clock?.elapsed ?? game?.frame ?? Math.floor(performance.now() / 16);
  if (f !== _bf) {
    _bf = f;
    _budget.full = 0;
    const c = _budget.cand; // the maxFull-th nearest candidate of the last frame sets the cut-off
    if (c.length > LOD_CFG.maxFull) {
      c.sort((a, b) => a - b);
      _budget.cut = c[LOD_CFG.maxFull - 1] + 0.5;
    } else _budget.cut = Infinity;
    c.length = 0;
  }
  return _budget;
}
