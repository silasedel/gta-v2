// NPC animation library (PEOPLE-LOOK track). Poses, idles and action clips are original and hand-keyed / procedural.
// Locomotion (Nov 19b, user: "the NPCs are walking terribly"): the walk, run and base idle cycles are motion capture
// (Mixamo takes from Xbot.glb / Soldier.glb, baked by tools/v2/npcs/bake_mocap.mjs into ./mocap.data.js), with
// per-style variants (women, heels, seniors, brisk) derived from the captured cycles. '?mocap=0' = the old procedural
// gait generator (clinical gait curves) for A/B.
// Convention (same as src/player/proceduralClips.js): canonical T-pose, every bone's rest frame aligned to the model
// axes, facing +Z, character-left = +X, up = +Y. Rotations are lists of [axis, degrees], applied in order about the
// model axes. bindClips() converts them to each archetype's own rest frames (A-pose, heel pose, any proportions).
import * as THREE from 'three';
import { buildProceduralClips } from '../../player/proceduralClips.js';
import { MOCAP } from './mocap.data.js';

const MOCAP_ON = !(typeof location !== 'undefined' && /[?&]mocap=0\b/.test(location.search));

const D2R = Math.PI / 180;
const AX = {
  x: new THREE.Vector3(1, 0, 0),
  y: new THREE.Vector3(0, 1, 0),
  z: new THREE.Vector3(0, 0, 1),
};
const _t = new THREE.Quaternion();
export function Q(ops, out = new THREE.Quaternion()) {
  out.identity();
  for (const [a, d] of ops || []) {
    if (a === 'q') _t.fromArray(d);
    else _t.setFromAxisAngle(AX[a], d * D2R);
    out.premultiply(_t);
  }
  return out;
}
const merge = (...ps) => Object.assign({}, ...ps);
const lerp = (a, b, k) => a + (b - a) * k;
const TAU = Math.PI * 2;

// mirror a pose left <-> right (rotations about y and z flip sign)
const swapLR = (n) =>
  n.startsWith('Left') ? 'Right' + n.slice(4) : n.startsWith('Right') ? 'Left' + n.slice(5) : n;
const mirOps = (ops) =>
  (ops || []).map(([a, d]) =>
    a === 'q' ? ['q', [d[0], -d[1], -d[2], d[3]]] : [a, a === 'x' ? d : -d],
  );
export function mirrorPose(b) {
  const o = {};
  for (const n in b) o[swapLR(n)] = mirOps(b[n]);
  return o;
}
function mirrorKey(k) {
  return {
    ...k,
    b: mirrorPose(k.b || {}),
    hips: k.hips ? [-k.hips[0], k.hips[1], k.hips[2]] : undefined,
    hipsRot: k.hipsRot ? mirOps(k.hipsRot) : undefined,
  };
}

// ------------------------------------------------------------------ hands
// The scanned people's fingers are partly fused (Tripo scans): fingers that bend by different amounts tear the webbing into
// claws. So all four bend together (the pinky only a touch more), the middle joint bends most and the tip joint least
// (a real relaxed hand: MCP 1.0, PIP 0.9, DIP 0.55 of the curl), they converge slightly instead of fanning out, and
// the thumb rests in against the index (adducted, softly flexed) instead of sticking forward.
const FING = ['Index', 'Middle', 'Ring', 'Pinky'];
function handPose(side, curl, thumb = 0.3, spread = 0) {
  const sg = side === 'Left' ? -1 : 1;
  const o = {};
  FING.forEach((f, i) => {
    const c = curl * (1 + i * 0.05);
    o[side + 'Hand' + f + '1'] = [
      ['z', sg * c * 1.0],
      ['y', sg * (spread - 0.6) * (i - 1.5) * 2.5],
    ];
    o[side + 'Hand' + f + '2'] = [['z', sg * c * 0.9]];
    o[side + 'Hand' + f + '3'] = [['z', sg * c * 0.55]];
  });
  const th = Math.max(0.25, thumb);
  o[side + 'HandThumb1'] = [
    ['y', sg * -20 * th],
    ['z', sg * 8 * th],
  ];
  o[side + 'HandThumb2'] = [['z', sg * 12 * th]];
  o[side + 'HandThumb3'] = [['z', sg * 10 * th]]; // the scanned thumb tip tears if its joints bend hard
  return o;
}
const HANDS_RELAX = merge(handPose('Left', 20, 0.55), handPose('Right', 20, 0.55));
const HANDS_LOOSE = merge(handPose('Left', 26, 0.6), handPose('Right', 26, 0.6));
const FIST_L = handPose('Left', 82, 1.0),
  FIST_R = handPose('Right', 82, 1.0);
const GRIP_R = handPose('Right', 55, 0.8),
  GRIP_L = handPose('Left', 55, 0.8);
const OPEN = merge(handPose('Left', 7, 0.3, 1.5), handPose('Right', 7, 0.3, 1.5));
const FISTS = merge(FIST_L, FIST_R);
// hands for the project's procedural action clips (src/player/proceduralClips.js has no finger keys)
const CLIP_HANDS = {
  punchR: FISTS,
  punchL: FISTS,
  guard: FISTS,
  jump: HANDS_LOOSE,
  fall: OPEN,
  deadBack: HANDS_LOOSE,
  deadFwd: HANDS_LOOSE,
  getUpBack: OPEN,
  getUpFwd: OPEN,
  drive: merge(GRIP_L, GRIP_R),
  cower: merge(handPose('Left', 38, 0.7), handPose('Right', 38, 0.7)),
  swim: OPEN,
  volley: OPEN,
  handsUp: OPEN,
  wave: merge(HANDS_RELAX, handPose('Right', 6, 0.3, 1.5)),
  phone: merge(HANDS_RELAX, GRIP_R),
  film: merge(GRIP_L, GRIP_R),
  phoneCall: merge(HANDS_RELAX, handPose('Right', 48, 0.7)),
  leash: merge(HANDS_RELAX, handPose('Right', 70, 0.9)),
  throwDisc: merge(HANDS_RELAX, handPose('Right', 50, 0.8)),
  hitReact: OPEN,
  argue: merge(handPose('Left', 14, 0.4, 1), handPose('Right', 14, 0.4, 1)),
};

// ------------------------------------------------------------------ base stances
export const STAND = merge(
  {
    Spine: [['x', -2]],
    Spine1: [['x', 2]],
    Spine2: [['x', 2]],
    Neck: [['x', -2]],
    Head: [['x', 3]],
    LeftShoulder: [['z', -3]],
    RightShoulder: [['z', 3]],
    LeftArm: [
      ['z', -77],
      ['x', -3],
      ['y', -8],
    ],
    RightArm: [
      ['z', 77],
      ['x', -3],
      ['y', 8],
    ],
    LeftForeArm: [['y', -14]],
    RightForeArm: [['y', 14]],
    LeftHand: [
      ['z', -6],
      ['x', 4],
    ],
    RightHand: [
      ['z', 6],
      ['x', 4],
    ],
    LeftUpLeg: [['z', 2.5]],
    RightUpLeg: [['z', -2.5]],
    LeftLeg: [['x', 2]],
    RightLeg: [['x', 2]],
    LeftFoot: [['z', -2]],
    RightFoot: [['z', 2]],
  },
  HANDS_RELAX,
);
// contrapposto: weight on the left leg, right knee soft, pelvis drops right, shoulders counter-tilt
const WEIGHT_L = {
  hips: [0.028, -0.012, 0],
  hipsRot: [
    ['z', 3.5],
    ['y', -4],
  ],
  b: {
    Spine: [
      ['x', -2],
      ['z', -2.5],
    ],
    Spine1: [
      ['x', 2],
      ['z', -1.5],
    ],
    Spine2: [
      ['x', 2],
      ['z', -1],
    ],
    Head: [
      ['x', 3],
      ['z', 2],
      ['y', 4],
    ],
    LeftUpLeg: [['z', -1]],
    LeftLeg: [['x', 1]],
    LeftFoot: [
      ['z', 1],
      ['y', -6],
    ],
    RightUpLeg: [
      ['x', -7],
      ['z', -6],
      ['y', 8],
    ],
    RightLeg: [['x', 14]],
    RightFoot: [
      ['x', -5],
      ['z', 3],
      ['y', 10],
    ],
  },
};
const withStand = (b) => merge(STAND, b);

// ------------------------------------------------------------------ gait generator
// reference curves (% of the cycle from heel strike): hip flex(+), knee flex(+), ankle dorsiflex(+)
const HIP = [
  [0, 25],
  [10, 22],
  [30, 6],
  [50, -10],
  [60, -5],
  [75, 18],
  [87, 27],
  [100, 25],
];
const KNEE = [
  [0, 3],
  [15, 17],
  [40, 4],
  [60, 36],
  [72, 60],
  [85, 32],
  [95, 5],
  [100, 3],
];
const ANKLE = [
  [0, 0],
  [7, -6],
  [30, 6],
  [48, 10],
  [62, -16],
  [72, -4],
  [88, 1],
  [100, 0],
];
const RUN_HIP = [
  [0, 30],
  [20, 10],
  [40, -14],
  [55, 10],
  [80, 52],
  [100, 30],
];
const RUN_KNEE = [
  [0, 18],
  [15, 38],
  [40, 18],
  [62, 100],
  [80, 72],
  [100, 18],
];
const RUN_ANKLE = [
  [0, 4],
  [15, 16],
  [40, -22],
  [62, -8],
  [85, 4],
  [100, 4],
];
function curve(pts, ph) {
  // periodic Catmull-Rom through (percent, value)
  const x = (((ph % 1) + 1) % 1) * 100;
  let i = 0;
  while (i < pts.length - 2 && pts[i + 1][0] <= x) i++;
  const p1 = pts[i],
    p2 = pts[i + 1];
  const p0 = i > 0 ? pts[i - 1] : [pts[pts.length - 2][0] - 100, pts[pts.length - 2][1]];
  const p3 = i + 2 < pts.length ? pts[i + 2] : [pts[1][0] + 100, pts[1][1]];
  const t = (x - p1[0]) / (p2[0] - p1[0] || 1);
  const m1 = ((p2[1] - p0[1]) / (p2[0] - p0[0])) * (p2[0] - p1[0]),
    m2 = ((p3[1] - p1[1]) / (p3[0] - p1[0])) * (p2[0] - p1[0]);
  const t2 = t * t,
    t3 = t2 * t;
  return (
    (2 * t3 - 3 * t2 + 1) * p1[1] +
    (t3 - 2 * t2 + t) * m1 +
    (-2 * t3 + 3 * t2) * p2[1] +
    (t3 - t2) * m2
  );
}
export const GAITS = {
  walk: {
    dur: 1.12,
    hip: 1.0,
    knee: 1.0,
    ankle: 1.0,
    bob: 0.018,
    lat: 0.022,
    yaw: 5,
    roll: 4,
    twist: 0.7,
    arm: 15,
    elbow: 14,
    elbowSwing: 10,
    lean: 2,
    armOut: 0,
    cross: 0,
  },
  walk_m: {
    dur: 1.1,
    hip: 1.0,
    knee: 1.0,
    ankle: 1.0,
    bob: 0.02,
    lat: 0.02,
    yaw: 4,
    roll: 3,
    twist: 0.8,
    arm: 17,
    elbow: 12,
    elbowSwing: 12,
    lean: 2,
    armOut: 3,
    cross: 0,
  },
  walk_f: {
    dur: 1.04,
    hip: 0.92,
    knee: 0.95,
    ankle: 1.0,
    bob: 0.016,
    lat: 0.03,
    yaw: 6,
    roll: 6,
    twist: 0.6,
    arm: 12,
    elbow: 18,
    elbowSwing: 10,
    lean: 1,
    armOut: -1,
    cross: 0.6,
  },
  walk_heels: {
    dur: 1.0,
    hip: 1.0,
    knee: 0.82,
    ankle: 0.5,
    bob: 0.012,
    lat: 0.034,
    yaw: 7,
    roll: 7.5,
    twist: 0.6,
    arm: 11,
    elbow: 20,
    elbowSwing: 8,
    lean: -1,
    armOut: -1,
    cross: 1.0,
  },
  walk_old: {
    dur: 1.22,
    hip: 0.95,
    knee: 0.9,
    ankle: 0.7,
    bob: 0.01,
    lat: 0.026,
    yaw: 3,
    roll: 2.5,
    twist: 0.4,
    arm: 7,
    elbow: 22,
    elbowSwing: 4,
    lean: 9,
    armOut: 4,
    cross: 0,
    kneeBase: 6,
  },
  walk_brisk: {
    dur: 1.0,
    hip: 1.12,
    knee: 1.05,
    ankle: 1.1,
    bob: 0.022,
    lat: 0.018,
    yaw: 5,
    roll: 3,
    twist: 0.8,
    arm: 21,
    elbow: 16,
    elbowSwing: 16,
    lean: 3,
    armOut: 2,
    cross: 0,
  },
  jog: {
    run: true,
    dur: 0.74,
    hip: 0.82,
    knee: 0.85,
    ankle: 0.8,
    bob: 0.04,
    lat: 0.012,
    yaw: 6,
    roll: 3,
    twist: 0.9,
    arm: 26,
    elbow: 78,
    elbowSwing: 18,
    lean: 6,
    armOut: 6,
    cross: 0,
  },
  run: {
    run: true,
    dur: 0.66,
    hip: 1.05,
    knee: 1.05,
    ankle: 1.0,
    bob: 0.05,
    lat: 0.01,
    yaw: 7,
    roll: 3,
    twist: 1.0,
    arm: 34,
    elbow: 88,
    elbowSwing: 22,
    lean: 9,
    armOut: 8,
    cross: 0,
  },
  sprint: {
    run: true,
    dur: 0.58,
    hip: 1.25,
    knee: 1.12,
    ankle: 1.1,
    bob: 0.055,
    lat: 0.008,
    yaw: 8,
    roll: 3,
    twist: 1.1,
    arm: 46,
    elbow: 92,
    elbowSwing: 26,
    lean: 14,
    armOut: 8,
    cross: 0,
  },
};
function gaitKeys(o, N = 24) {
  const keys = [];
  for (let i = 0; i <= N; i++) {
    const ph = i / N,
      t = ph * o.dur;
    const leg = (p, side) => {
      const H = o.run ? RUN_HIP : HIP,
        K = o.run ? RUN_KNEE : KNEE,
        A = o.run ? RUN_ANKLE : ANKLE;
      const hip = curve(H, p) * o.hip,
        knee = curve(K, p) * o.knee + (o.kneeBase || 0),
        ank = curve(A, p) * o.ankle;
      const sg = side === 'Left' ? 1 : -1;
      // crossing gait (heels / catwalk): the stance foot lands toward the midline
      const add = o.cross * 3.5 * Math.sin(p * TAU) * 0 - o.cross * 2.2;
      return {
        [side + 'UpLeg']: [
          ['x', -hip],
          ['z', sg * (2.2 + add)],
          ['y', sg * -3],
        ],
        [side + 'Leg']: [['x', knee]],
        [side + 'Foot']: [
          ['x', -ank],
          ['z', -sg * 2],
        ],
        [side + 'ToeBase']: [
          ['x', -Math.max(0, -curve(A, p + 0.04) - 4) * 0.8 * (o.run ? 0.6 : 1)],
        ],
      };
    };
    const c = Math.cos(ph * TAU),
      s = Math.sin(ph * TAU);
    const armL = -c * o.arm,
      armR = c * o.arm; // + = forward
    const elL = o.elbow + (Math.max(0, armL) / o.arm) * o.elbowSwing,
      elR = o.elbow + (Math.max(0, armR) / o.arm) * o.elbowSwing;
    const yaw = -c * o.yaw; // left hip forward at left heel strike
    const roll = Math.sin(ph * TAU * 2 - 0.5) * 0.3 * o.roll + s * o.roll * 0.85;
    const hk = (a) => (o.run ? 46 : 22) + ((o.run ? 8 : 7) * a) / o.arm; // fingers follow the swing with the forearm
    const b = merge(
      STAND,
      leg(ph, 'Left'),
      leg(ph + 0.5, 'Right'),
      handPose('Left', hk(-Math.cos(ph * TAU - 0.5) * o.arm), o.run ? 0.7 : 0.6),
      handPose('Right', hk(Math.cos(ph * TAU - 0.5) * o.arm), o.run ? 0.7 : 0.6),
      {
        Spine: [
          ['x', -2 + o.lean * 0.4],
          ['y', -yaw * 0.35 * o.twist],
          ['z', -roll * 0.35],
        ],
        Spine1: [
          ['x', 2 + o.lean * 0.3],
          ['y', -yaw * 0.35 * o.twist],
        ],
        Spine2: [
          ['x', 2 + o.lean * 0.3],
          ['y', -yaw * 0.3 * o.twist],
          ['z', roll * 0.15],
        ],
        Neck: [
          ['x', -2 - o.lean * 0.4],
          ['y', yaw * 0.25],
        ],
        Head: [
          ['x', 3 - o.lean * 0.3 + Math.cos(ph * TAU * 2) * 0.8],
          ['y', yaw * 0.25],
          ['z', -roll * 0.25],
        ],
        LeftArm: [
          ['z', -77 + o.armOut],
          ['x', -armL - 4],
          ['y', -9],
        ],
        RightArm: [
          ['z', 77 - o.armOut],
          ['x', -armR - 4],
          ['y', 9],
        ],
        LeftForeArm: [['y', -elL]],
        RightForeArm: [['y', elR]],
        LeftHand: [
          ['z', -8],
          ['x', 6 - armL * 0.2],
        ],
        RightHand: [
          ['z', 8],
          ['x', 6 - armR * 0.2],
        ],
        LeftShoulder: [
          ['z', -3 + Math.max(0, armL) * 0.06],
          ['y', -armL * 0.12],
        ],
        RightShoulder: [
          ['z', 3 - Math.max(0, armR) * 0.06],
          ['y', armR * 0.12],
        ],
      },
    );
    // pelvis: bob (lowest at double support), lateral shift toward the stance leg, rotation, obliquity
    const bob = o.run ? -o.bob * Math.cos(ph * TAU * 2 - 0.6) : -o.bob * Math.cos(ph * TAU * 2);
    keys.push({
      t,
      b,
      hips: [s * o.lat, bob - (o.run ? 0.03 : 0.006), 0],
      hipsRot: [
        ['x', o.lean * 0.5 + (o.run ? 4 : 0)],
        ['y', yaw],
        ['z', roll],
      ],
    });
  }
  return keys;
}

// ------------------------------------------------------------------ motion capture (./mocap.data.js)
// bone -> style group for the amplitude changes
const MOCAP_GROUP = {
  Hips: 'pelvis',
  Spine: 'trunk',
  Spine1: 'trunk',
  Spine2: 'trunk',
  Neck: 'trunk',
  Head: 'trunk',
  LeftShoulder: 'arms',
  LeftArm: 'arms',
  LeftForeArm: 'arms',
  LeftHand: 'arms',
  RightShoulder: 'arms',
  RightArm: 'arms',
  RightForeArm: 'arms',
  RightHand: 'arms',
  LeftUpLeg: 'legs',
  LeftLeg: 'legs',
  RightUpLeg: 'legs',
  RightLeg: 'legs',
  LeftFoot: 'feet',
  LeftToeBase: 'feet',
  RightFoot: 'feet',
  RightToeBase: 'feet',
};
const _mq = new THREE.Quaternion();
const _mm = new THREE.Quaternion();
const _ma = new THREE.Quaternion();

/**
 * A captured cycle as canonical keys, with optional style changes (all default to "as captured"):
 *   dur:   time scale
 *   amp:   { pelvis | trunk | arms | legs | feet: k } motion amplitude about the cycle mean (legs 0.8 = shorter stride)
 *   add:   { Bone: ops } extra rotation in the parent's frame on top of the capture (posture: stoop, bent knees, arms in)
 *   lat:   lateral hips shift scale (hip sway)
 *   hands: finger pose for both hands
 *   mirror: left <-> right
 */
function mocapKeys(src, o = {}) {
  const M = MOCAP[src];
  const nb = M.bones.length;
  const nk = M.t.length;
  const ts = o.dur || 1;
  const amp = o.amp || {};
  const add = {};
  for (const n in o.add || {}) add[n] = Q(o.add[n]);
  // per-bone cycle mean (sign-aligned average), the pivot of the amplitude changes
  const mean = [];
  for (let bi = 0; bi < nb; bi++) {
    const s = [0, 0, 0, 0];
    const ref = (bi * 4) | 0;
    for (let i = 0; i < nk; i++) {
      const j = (i * nb + bi) * 4;
      const d =
        M.q[j] * M.q[ref] +
        M.q[j + 1] * M.q[ref + 1] +
        M.q[j + 2] * M.q[ref + 2] +
        M.q[j + 3] * M.q[ref + 3];
      const sg = d < 0 ? -1 : 1;
      for (let c = 0; c < 4; c++) s[c] += sg * M.q[j + c];
    }
    mean.push(new THREE.Quaternion(s[0], s[1], s[2], s[3]).normalize());
  }
  const hands = o.hands || HANDS_RELAX;
  const keys = [];
  for (let i = 0; i < nk; i++) {
    const b = { ...hands };
    let hipsRot = null;
    for (let bi = 0; bi < nb; bi++) {
      const n = M.bones[bi];
      const j = (i * nb + bi) * 4;
      _mq.set(M.q[j], M.q[j + 1], M.q[j + 2], M.q[j + 3]);
      const a = amp[MOCAP_GROUP[n]];
      if (a !== undefined && a !== 1) {
        _mm.copy(mean[bi]);
        _mq.copy(_mm.slerp(_mq, a));
      }
      if (add[n]) _mq.premultiply(_ma.copy(add[n]));
      const ops = [['q', _mq.toArray([])]];
      if (n === 'Hips') hipsRot = ops;
      else b[n] = ops;
    }
    const h = M.hips;
    keys.push({
      t: M.t[i] * ts,
      b,
      hips: [h[i * 3] * (o.lat ?? 1), h[i * 3 + 1], h[i * 3 + 2]],
      hipsRot,
    });
  }
  return o.mirror ? keys.map(mirrorKey) : keys;
}
const HANDS_WALK = merge(handPose('Left', 22, 0.6), handPose('Right', 22, 0.6));
const HANDS_RUN = merge(handPose('Left', 46, 0.7), handPose('Right', 46, 0.7));
// style variants of the captured cycles (signs as in gaitKeys: UpLeg z + = foot out for the left leg, x - = thigh
// forward; Leg x + = knee bend; Spine x + = forward flex; Arm z - (left) = arm in to the body; ForeArm y - (left) = elbow bend)
const MOCAP_STYLE = {
  // women: narrower track (feet toward the midline), more hip sway, arms closer with softer elbows and less swing
  fem: {
    dur: 1.03,
    lat: 1.45,
    amp: { pelvis: 1.6, arms: 0.72 },
    add: {
      LeftUpLeg: [['z', -2.6]],
      RightUpLeg: [['z', 2.6]],
      LeftArm: [['z', -3]],
      RightArm: [['z', 3]],
      LeftForeArm: [['y', -7]],
      RightForeArm: [['y', 7]],
    },
  },
  // heels: shorter steps placed on a line, stiffer ankles, the most hip sway
  heels: {
    dur: 0.98,
    lat: 1.7,
    amp: { pelvis: 1.9, arms: 0.62, legs: 0.86, feet: 0.55 },
    add: {
      LeftUpLeg: [['z', -4]],
      RightUpLeg: [['z', 4]],
      LeftArm: [['z', -3]],
      RightArm: [['z', 3]],
      LeftForeArm: [['y', -9]],
      RightForeArm: [['y', 9]],
      Spine2: [['x', -2]],
    },
  },
  // seniors: slower, shorter steps, a slight stoop with bent knees, little arm swing
  old: {
    dur: 1.2,
    lat: 1.1,
    amp: { legs: 0.74, feet: 0.7, arms: 0.45, pelvis: 0.7 },
    add: {
      Spine: [['x', 4]],
      Spine1: [['x', 5]],
      Spine2: [['x', 3]],
      Neck: [['x', -4]],
      Head: [['x', -5]],
      LeftUpLeg: [['x', -5]],
      RightUpLeg: [['x', -5]],
      LeftLeg: [['x', 7]],
      RightLeg: [['x', 7]],
      LeftForeArm: [['y', -10]],
      RightForeArm: [['y', 10]],
    },
  },
  brisk: { dur: 0.88, amp: { legs: 1.08, arms: 1.2 } },
};
function addMocapClips(C) {
  const loco = (name, src, style, run) => {
    const st = typeof style === 'string' ? MOCAP_STYLE[style] : style;
    const o = { ...(st || {}), hands: run ? HANDS_RUN : HANDS_WALK };
    C[name] = {
      name,
      dur: MOCAP[src].dur * (o.dur || 1),
      keys: mocapKeys(src, o),
      loco: true,
      run: !!run,
      ground: true,
      mocap: src,
    };
  };
  loco('walk', 'xbot_walk');
  loco('walk_m', 'soldier_walk');
  loco('walk_f', 'xbot_walk', 'fem');
  loco('walk_heels', 'xbot_walk', 'heels');
  loco('walk_old', 'soldier_walk', 'old');
  loco('walk_brisk', 'soldier_walk', 'brisk');
  loco('jog', 'soldier_run', { dur: 1.18, amp: { legs: 0.78, feet: 0.85, arms: 0.75 } }, true);
  loco('run', 'xbot_run', null, true);
  loco('sprint', 'soldier_run', { dur: 0.92, amp: { legs: 1.1, arms: 1.15 } }, true);
  // captured standing idles (breathing, small weight shifts): the base idle and its mirrored twin are two different takes
  const idle = (name, src, o) => {
    C[name] = {
      name,
      dur: MOCAP[src].dur * (o.dur || 1),
      keys: mocapKeys(src, { hands: HANDS_RELAX, ...o }),
      ground: true,
      mocap: src,
    };
  };
  idle('idle', 'xbot_idle', {});
  idle('idle_m', 'soldier_idle', { mirror: true, dur: 1.15 });
}

// ------------------------------------------------------------------ idles and poses
function breathe(base, n, dur, amp = 1, look = 6) {
  // n keys over dur: breathing (spine, shoulders), slow look-around, small hand drift
  const keys = [];
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * dur,
      ph = i / n;
    const br = Math.sin(ph * TAU * Math.round(dur / 4.2)) * amp;
    const lk = Math.sin(ph * TAU) * look,
      lk2 = Math.sin(ph * TAU * 2 + 1) * look * 0.3;
    const b = merge(base.b, {
      Spine1: [...(base.b.Spine1 || [['x', 2]]), ['x', br * 0.8]],
      Spine2: [...(base.b.Spine2 || [['x', 2]]), ['x', -br * 0.6]],
      LeftShoulder: [...(base.b.LeftShoulder || []), ['z', br * 0.8]],
      RightShoulder: [...(base.b.RightShoulder || []), ['z', -br * 0.8]],
      Head: [...(base.b.Head || [['x', 3]]), ['y', lk], ['x', lk2]],
      Neck: [...(base.b.Neck || []), ['y', lk * 0.4]],
    });
    keys.push({ t, b, hips: base.hips, hipsRot: base.hipsRot });
  }
  return keys;
}
function weightShift(dur, n = 16, amt = 1, extra = {}) {
  // slow transfer L -> R -> L (keys mirrored halfway) with breathing on top
  const A = { b: merge(STAND, WEIGHT_L.b, extra), hips: WEIGHT_L.hips, hipsRot: WEIGHT_L.hipsRot };
  const B = mirrorKey(A);
  const keys = [];
  for (let i = 0; i <= n; i++) {
    const ph = i / n,
      t = ph * dur;
    const w =
      0.5 -
      0.5 * Math.cos(Math.min(1, Math.max(0, (Math.abs(ph - 0.5) < 0.25 ? 1 : 0) + 0)) * Math.PI); // hold, then switch
    const k = smoothHold(ph);
    const b = blendPoses(A.b, B.b, k);
    const br = Math.sin(ph * TAU * Math.round(dur / 4.2)) * amt;
    b.Spine1 = [...(b.Spine1 || []), ['x', br * 0.8]];
    b.Head = [
      ...(b.Head || []),
      ['y', Math.sin(ph * TAU * 1.5) * 7],
      ['x', Math.sin(ph * TAU * 3) * 1.5],
    ];
    if (!extra || !Object.keys(extra).some((n) => /Hand(Index|Thumb)/.test(n)))
      Object.assign(
        b,
        merge(
          handPose('Left', 19 + 4 * Math.sin(ph * TAU * 2 + 0.7), 0.55),
          handPose('Right', 19 + 4 * Math.sin(ph * TAU * 2 + 2.1), 0.55),
        ),
      );
    keys.push({
      t,
      b,
      hips: A.hips.map((v, j) => lerp(v, B.hips[j], k)),
      hipsRot: blendOps(A.hipsRot, B.hipsRot, k),
    });
  }
  return keys;
}
const smoothHold = (ph) => {
  const x = (ph * 2) % 2;
  const f = (u) => u * u * (3 - 2 * u);
  return x < 0.7 ? 0 : x < 1 ? f((x - 0.7) / 0.3) : x < 1.7 ? 1 : 1 - f((x - 1.7) / 0.3);
};
// blend two op lists by composing quaternions (slerp in canonical space), stored as a quaternion op
function blendOps(a, b, k) {
  const qa = Q(a),
    qb = Q(b);
  return [['q', qa.slerp(qb, k).toArray()]];
}
function blendPoses(A, B, k) {
  const o = {};
  for (const n of new Set([...Object.keys(A), ...Object.keys(B)]))
    o[n] = blendOps(A[n] || [], B[n] || [], k);
  return o;
}

const CROSS = {
  // arms crossed on the chest, left forearm on top
  LeftArm: [
    ['z', -78],
    ['x', -10],
    ['y', -72],
  ],
  RightArm: [
    ['z', 79],
    ['x', -4],
    ['y', 66],
  ],
  LeftForeArm: [
    ['y', -98],
    ['x', 4],
  ],
  RightForeArm: [
    ['y', 92],
    ['x', -4],
  ],
  LeftHand: [
    ['z', 8],
    ['x', -6],
  ],
  RightHand: [
    ['z', -10],
    ['x', -4],
  ],
  LeftShoulder: [
    ['z', 2],
    ['y', -6],
  ],
  RightShoulder: [
    ['z', -2],
    ['y', 6],
  ],
  ...handPose('Left', 28, 0.4),
  ...handPose('Right', 34, 0.5),
};
const PHONE = {
  // texting: phone in both hands at chest height, head down
  Head: [['x', 22]],
  Neck: [['x', 8]],
  Spine2: [['x', 4]],
  LeftArm: [
    ['z', -70],
    ['x', -20],
    ['y', -38],
  ],
  RightArm: [
    ['z', 70],
    ['x', -22],
    ['y', 40],
  ],
  LeftForeArm: [
    ['y', -102],
    ['x', 8],
  ],
  RightForeArm: [
    ['y', 96],
    ['x', 6],
  ],
  LeftHand: [
    ['x', -10],
    ['z', 18],
  ],
  RightHand: [
    ['x', -12],
    ['z', -22],
  ],
  ...handPose('Left', 40, 0.6),
  ...handPose('Right', 34, 0.2),
};
const HIP_HAND_L = {
  LeftArm: [
    ['z', -58],
    ['x', 8],
    ['y', -30],
  ],
  LeftForeArm: [['y', -96]],
  LeftHand: [
    ['z', -20],
    ['x', 18],
  ],
  ...handPose('Left', 20, 0.4),
};
const DRINK_R = {
  RightArm: [
    ['z', 74],
    ['x', -16],
    ['y', 30],
  ],
  RightForeArm: [['y', 112]],
  RightHand: [
    ['z', -4],
    ['x', -10],
  ],
  ...GRIP_R,
};
const DRINK_SIP = {
  RightArm: [
    ['z', 64],
    ['x', -34],
    ['y', 40],
  ],
  RightForeArm: [['y', 138]],
  RightHand: [
    ['z', -18],
    ['x', -20],
  ],
  Head: [['x', -10]],
  ...GRIP_R,
};

function poseClip(name, dur, keysFn, o = {}) {
  return { name, dur, keys: keysFn(), ...o };
}

export function canonicalClips() {
  const C = {};
  for (const [n, g] of Object.entries(GAITS))
    C[n] = { name: n, dur: g.dur, keys: gaitKeys(g), loco: true, run: !!g.run, ground: true };
  // idles
  C.idle = { name: 'idle', dur: 16, keys: weightShift(16, 24), ground: true };
  C.idle_f = {
    name: 'idle_f',
    dur: 14,
    keys: weightShift(14, 24, 0.8, { ...HIP_HAND_L }),
    ground: true,
  };
  C.idle_old = {
    name: 'idle_old',
    dur: 12,
    keys: breathe(
      {
        b: merge(STAND, {
          Spine: [['x', 6]],
          Spine1: [['x', 6]],
          Spine2: [['x', 6]],
          Neck: [['x', 6]],
          Head: [['x', -8]],
          LeftLeg: [['x', 7]],
          RightLeg: [['x', 7]],
          LeftUpLeg: [
            ['x', -5],
            ['z', 3],
          ],
          RightUpLeg: [
            ['x', -5],
            ['z', -3],
          ],
          LeftArm: [
            ['z', -76],
            ['x', -10],
            ['y', -12],
          ],
          RightArm: [
            ['z', 76],
            ['x', -10],
            ['y', 12],
          ],
          LeftForeArm: [['y', -26]],
          RightForeArm: [['y', 26]],
        }),
        hips: [0, -0.02, -0.01],
      },
      12,
      12,
      0.8,
      4,
    ),
    ground: true,
  };
  C.cross_arms = {
    name: 'cross_arms',
    dur: 12,
    keys: breathe(
      { b: merge(STAND, WEIGHT_L.b, CROSS), hips: WEIGHT_L.hips, hipsRot: WEIGHT_L.hipsRot },
      12,
      12,
      0.8,
      9,
    ),
    ground: true,
  };
  // leaning back on a wall, arms crossed, left foot flat on the wall behind (origin: feet line; the wall is 0.32 m behind)
  const leanB = merge(STAND, CROSS, {
    Spine: [['x', 4]],
    Spine1: [['x', 4]],
    Spine2: [['x', 2]],
    Neck: [['x', 2]],
    Head: [
      ['x', 4],
      ['y', -14],
    ],
    RightUpLeg: [
      ['x', -8],
      ['z', -4],
    ],
    RightLeg: [['x', 3]],
    RightFoot: [['x', 6]],
    LeftUpLeg: [
      ['x', -34],
      ['z', 4],
      ['y', -12],
    ],
    LeftLeg: [['x', 92]],
    LeftFoot: [['x', 30]],
  });
  C.lean_cross = {
    name: 'lean_cross',
    dur: 10,
    keys: breathe(
      {
        b: leanB,
        hips: [-0.01, -0.035, -0.16],
        hipsRot: [
          ['x', -9],
          ['y', 6],
        ],
      },
      10,
      10,
      0.7,
      10,
    ),
    ground: false,
    wall: 0.3,
  };
  C.lean_wall = {
    name: 'lean_wall',
    dur: 10,
    keys: breathe(
      {
        b: merge(leanB, {
          LeftArm: [
            ['z', -80],
            ['x', 4],
            ['y', -10],
          ],
          RightArm: [
            ['z', 80],
            ['x', 4],
            ['y', 10],
          ],
          LeftForeArm: [['y', -10]],
          RightForeArm: [['y', 10]],
          ...HANDS_RELAX,
        }),
        hips: [-0.01, -0.035, -0.16],
        hipsRot: [
          ['x', -9],
          ['y', 6],
        ],
      },
      10,
      10,
      0.7,
      10,
    ),
    ground: false,
    wall: 0.3,
  };
  // phone (texting) and talking
  C.phone_text = {
    name: 'phone_text',
    dur: 9,
    keys: breathe(
      { b: merge(STAND, WEIGHT_L.b, PHONE), hips: WEIGHT_L.hips, hipsRot: WEIGHT_L.hipsRot },
      9,
      9,
      0.6,
      2,
    ),
    ground: true,
    prop: 'phone',
  };
  const talkK = (k) =>
    merge(STAND, WEIGHT_L.b, {
      RightArm: [
        ['z', 70 - k * 6],
        ['x', -26 - k * 10],
        ['y', 34],
      ],
      RightForeArm: [
        ['y', 74 + k * 18],
        ['x', -14],
      ],
      RightHand: [
        ['z', -10 + k * 14],
        ['x', -20],
      ],
      LeftArm: [
        ['z', -74 + k * 4],
        ['x', -12 + k * 6],
        ['y', -22],
      ],
      LeftForeArm: [['y', -50 - k * 12]],
      LeftHand: [
        ['z', 10],
        ['x', -10],
      ],
      Head: [
        ['x', 3 + k * 4],
        ['y', 6 - k * 10],
        ['z', k * 3],
      ],
      Spine2: [
        ['x', 2],
        ['y', k * 4],
      ],
      ...handPose('Right', 14 + k * 10, 0.3, 1),
      ...handPose('Left', 24, 0.4),
    });
  const tk = [0, 1, -0.4, 0.6, -1, 0.3, 0.9, -0.6, 0];
  C.talk_g = {
    name: 'talk_g',
    dur: 8,
    keys: tk.map((k, i) => ({ t: i, b: talkK(k), hips: WEIGHT_L.hips, hipsRot: WEIGHT_L.hipsRot })),
    ground: true,
  };
  // holding a drink, a sip every few seconds
  const drinkHold = merge(STAND, WEIGHT_L.b, DRINK_R),
    drinkSip = merge(STAND, WEIGHT_L.b, DRINK_SIP);
  // r7: smoking: cigarette low in the right hand (pinched), a drag every ~7 s, the left hand in a pocket-ish rest
  const PINCH_R = handPose('Right', 46, 0.9);
  const smokeHold = merge(STAND, WEIGHT_L.b, {
    RightArm: [
      ['z', 80],
      ['x', -8],
      ['y', 14],
    ],
    RightForeArm: [['y', 48]],
    RightHand: [
      ['z', 10],
      ['x', -12],
    ],
    ...PINCH_R,
  });
  const smokeDrag = merge(STAND, WEIGHT_L.b, {
    RightArm: [
      ['z', 64],
      ['x', -30],
      ['y', 42],
    ],
    RightForeArm: [['y', 140]],
    RightHand: [
      ['z', -24],
      ['x', -6],
    ],
    Head: [['x', -6]],
    ...PINCH_R,
  });
  C.smoke = {
    name: 'smoke',
    dur: 8,
    keys: [0, 1.6, 2.3, 3.3, 4.0, 8].map((t, i) => ({
      t,
      b:
        i === 2 || i === 3
          ? smokeDrag
          : merge(smokeHold, {
              Head: [
                ['x', 2],
                ['y', i * 5 - 10],
              ],
            }),
      hips: WEIGHT_L.hips,
      hipsRot: WEIGHT_L.hipsRot,
    })),
    ground: true,
    prop: 'cig',
  };
  C.drink = {
    name: 'drink',
    dur: 9,
    keys: [0, 2.6, 3.3, 4.1, 4.8, 9].map((t, i) => ({
      t,
      b:
        i === 2 || i === 3
          ? drinkSip
          : merge(drinkHold, {
              Head: [
                ['x', 3],
                ['y', i * 4 - 8],
              ],
            }),
      hips: WEIGHT_L.hips,
      hipsRot: WEIGHT_L.hipsRot,
    })),
    ground: true,
    prop: 'cup',
  };
  // taking a photo: phone held up in landscape at eye height
  const photo = merge(STAND, {
    LeftArm: [
      ['z', -52],
      ['x', -50],
      ['y', -40],
    ],
    RightArm: [
      ['z', 52],
      ['x', -50],
      ['y', 40],
    ],
    LeftForeArm: [
      ['y', -86],
      ['x', 10],
    ],
    RightForeArm: [
      ['y', 86],
      ['x', 10],
    ],
    LeftHand: [
      ['x', -30],
      ['z', 10],
    ],
    RightHand: [
      ['x', -30],
      ['z', -10],
    ],
    Head: [['x', 2]],
    Spine2: [['x', -2]],
    ...handPose('Left', 30, 0.8),
    ...handPose('Right', 30, 0.8),
  });
  C.photo = {
    name: 'photo',
    dur: 6,
    keys: breathe({ b: photo }, 8, 6, 0.4, 3),
    ground: true,
    prop: 'phone',
  };
  // club dancing: three styles
  const dance1 = (k) =>
    merge(STAND, {
      Spine: [
        ['x', 2],
        ['z', -k * 4],
        ['y', k * 6],
      ],
      Spine1: [
        ['x', 3],
        ['z', -k * 3],
      ],
      Spine2: [
        ['x', 2],
        ['y', -k * 5],
      ],
      Head: [
        ['x', 4 + Math.abs(k) * 4],
        ['z', k * 4],
        ['y', -k * 8],
      ],
      LeftArm: [
        ['z', -58 + k * 8],
        ['x', -26],
        ['y', -30],
      ],
      RightArm: [
        ['z', 58 + k * 8],
        ['x', -26],
        ['y', 30],
      ],
      LeftForeArm: [['y', -82 - k * 18]],
      RightForeArm: [['y', 82 - k * 18]],
      LeftHand: [
        ['z', -10],
        ['x', -12],
      ],
      RightHand: [
        ['z', 10],
        ['x', -12],
      ],
      LeftUpLeg: [
        ['x', -6 - Math.max(0, -k) * 10],
        ['z', 4],
      ],
      RightUpLeg: [
        ['x', -6 - Math.max(0, k) * 10],
        ['z', -4],
      ],
      LeftLeg: [['x', 12 + Math.max(0, -k) * 16]],
      RightLeg: [['x', 12 + Math.max(0, k) * 16]],
      ...HANDS_LOOSE,
    });
  const beat = 60 / 118;
  C.dance = {
    name: 'dance',
    dur: beat * 4,
    keys: [0, 1, 2, 3, 4].map((i) => ({
      t: i * beat,
      b: dance1(i % 2 ? 1 : -1),
      hips: [(i % 2 ? 1 : -1) * 0.03, -0.035 - (i % 2) * 0.006, 0],
      hipsRot: [
        ['y', (i % 2 ? 1 : -1) * 8],
        ['z', (i % 2 ? -1 : 1) * 5],
      ],
    })),
    ground: true,
  };
  const dance2 = (k, up) =>
    merge(STAND, {
      Spine: [
        ['x', 3],
        ['y', k * 10],
      ],
      Spine1: [['z', -k * 4]],
      Head: [
        ['x', -6 + up * 10],
        ['y', k * 12],
      ],
      LeftArm: [
        ['z', -20 - up * 20],
        ['x', -30],
        ['y', -10],
      ],
      RightArm: [
        ['z', 20 + up * 20 + k * 10],
        ['x', -30],
        ['y', 10],
      ],
      LeftForeArm: [['y', -40 - up * 20]],
      RightForeArm: [['y', 40 + up * 30]],
      ...HANDS_LOOSE,
      LeftUpLeg: [
        ['x', -8],
        ['z', 5],
      ],
      RightUpLeg: [
        ['x', -8],
        ['z', -5],
      ],
      LeftLeg: [['x', 16 + up * 6]],
      RightLeg: [['x', 16 + up * 6]],
    });
  C.dance_arms = {
    name: 'dance_arms',
    dur: beat * 4,
    keys: [0, 1, 2, 3, 4].map((i) => ({
      t: i * beat,
      b: dance2(i % 2 ? 1 : -1, i % 2),
      hips: [0, -0.05 + (i % 2) * 0.02, 0],
      hipsRot: [['y', (i % 2 ? 1 : -1) * 10]],
    })),
    ground: true,
  };
  const dance3 = (k) =>
    merge(STAND, WEIGHT_L.b, {
      hipsRot: undefined,
      Spine: [['z', k * 5]],
      Spine1: [
        ['z', k * 3],
        ['x', 4],
      ],
      Head: [
        ['x', 6],
        ['z', -k * 6],
        ['y', k * 6],
      ],
      LeftArm: [
        ['z', -66],
        ['x', -18],
        ['y', -24],
      ],
      RightArm: [
        ['z', 66],
        ['x', -18],
        ['y', 24],
      ],
      LeftForeArm: [['y', -70 + k * 10]],
      RightForeArm: [['y', 70 + k * 10]],
      ...HANDS_LOOSE,
    });
  C.dance_sway = {
    name: 'dance_sway',
    dur: beat * 4,
    keys: [0, 1, 2, 3, 4].map((i) => ({
      t: i * beat,
      b: dance3(i % 2 ? 1 : -1),
      hips: [(i % 2 ? 1 : -1) * 0.045, -0.02, 0],
      hipsRot: [
        ['z', (i % 2 ? -1 : 1) * 7],
        ['y', (i % 2 ? 1 : -1) * 6],
      ],
    })),
    ground: true,
  };
  // bartender: wipe the counter (right hand circles at counter height), then shake a cocktail
  const counter = (a) =>
    merge(STAND, {
      Spine: [['x', 10]],
      Spine1: [['x', 6]],
      Head: [
        ['x', 10],
        ['y', -6],
      ],
      RightArm: [
        ['z', 60],
        ['x', -40 - Math.sin(a) * 8],
        ['y', 30 + Math.cos(a) * 10],
      ],
      RightForeArm: [['y', 54 + Math.sin(a) * 14]],
      RightHand: [
        ['x', 30],
        ['z', -4],
      ],
      LeftArm: [
        ['z', -64],
        ['x', -30],
        ['y', -34],
      ],
      LeftForeArm: [['y', -64]],
      LeftHand: [['x', 30]],
      ...handPose('Right', 12, 0.4),
      ...handPose('Left', 10, 0.3),
      LeftUpLeg: [
        ['z', 3],
        ['x', -2],
      ],
      RightUpLeg: [
        ['z', -3],
        ['x', -2],
      ],
    });
  const wipe = [];
  for (let i = 0; i <= 12; i++)
    wipe.push({ t: i * 0.42, b: counter((i / 12) * TAU * 3), hips: [0, -0.01, -0.02] });
  C.bartend = { name: 'bartend', dur: 12 * 0.42, keys: wipe, ground: true, prop: 'rag' };
  const shake = (k) =>
    merge(STAND, {
      RightArm: [
        ['z', 40],
        ['x', -40],
        ['y', 40],
      ],
      RightForeArm: [['y', 120 + k * 16]],
      RightHand: [['x', -10 + k * 14]],
      LeftArm: [
        ['z', -40],
        ['x', -40],
        ['y', -40],
      ],
      LeftForeArm: [['y', -120 - k * 16]],
      LeftHand: [['x', -10 + k * 14]],
      Head: [
        ['x', 2],
        ['y', 10],
      ],
      Spine2: [['y', 4]],
      ...GRIP_R,
      ...GRIP_L,
    });
  C.shake = {
    name: 'shake',
    dur: 0.5,
    keys: [0, 1, 2].map((i) => ({ t: i * 0.25, b: shake(i % 2 ? 1 : -1), hips: [0, 0, 0] })),
    ground: true,
    prop: 'shaker',
  };
  const pour = merge(STAND, {
    RightArm: [
      ['z', 62],
      ['x', -44],
      ['y', 22],
    ],
    RightForeArm: [['y', 60]],
    RightHand: [
      ['x', 10],
      ['y', -50],
    ],
    LeftArm: [
      ['z', -66],
      ['x', -34],
      ['y', -40],
    ],
    LeftForeArm: [['y', -70]],
    Head: [['x', 14]],
    Spine: [['x', 6]],
    ...GRIP_R,
    ...handPose('Left', 40, 0.6),
  });
  C.pour = {
    name: 'pour',
    dur: 5,
    keys: breathe({ b: pour }, 6, 5, 0.4, 2),
    ground: true,
    prop: 'bottle',
  };
  // cook stirring a pot / tossing a pan
  const stir = (a) =>
    merge(STAND, {
      Spine: [['x', 8]],
      Head: [['x', 16]],
      RightArm: [
        ['z', 58],
        ['x', -38 + Math.sin(a) * 6],
        ['y', 26 + Math.cos(a) * 8],
      ],
      RightForeArm: [['y', 70 + Math.sin(a) * 10]],
      RightHand: [['x', 20]],
      ...GRIP_R,
      LeftArm: [
        ['z', -60],
        ['x', -34],
        ['y', -30],
      ],
      LeftForeArm: [['y', -70]],
      ...GRIP_L,
    });
  const sk = [];
  for (let i = 0; i <= 12; i++)
    sk.push({ t: i * 0.25, b: stir((i / 12) * TAU * 2), hips: [0, -0.005, 0] });
  C.cook = { name: 'cook', dur: 3, keys: sk, ground: true };
  // waiter: tray up on the left hand
  const tray = merge(STAND, WEIGHT_L.b, {
    LeftArm: [
      ['z', -74],
      ['x', -10],
      ['y', -60],
    ],
    LeftForeArm: [
      ['y', -96],
      ['x', -40],
    ],
    LeftHand: [
      ['z', 70],
      ['x', 10],
    ],
    ...handPose('Left', 6, 0.2),
  });
  C.carry_tray = {
    name: 'carry_tray',
    dur: 10,
    keys: breathe({ b: tray, hips: WEIGHT_L.hips, hipsRot: WEIGHT_L.hipsRot }, 8, 10, 0.6, 8),
    ground: true,
    prop: 'tray',
  };
  // sitting on a chair or a bar stool (origin = seat front edge center, seat height 0.46)
  const sitChair = merge(STAND, {
    Spine: [['x', -6]],
    Spine1: [['x', 2]],
    Head: [['x', 4]],
    LeftUpLeg: [
      ['x', -86],
      ['z', 6],
    ],
    RightUpLeg: [
      ['x', -86],
      ['z', -6],
    ],
    LeftLeg: [['x', 84]],
    RightLeg: [['x', 80]],
    LeftFoot: [['x', -2]],
    RightFoot: [['x', -4]],
    LeftArm: [
      ['z', -76],
      ['x', -12],
      ['y', -14],
    ],
    RightArm: [
      ['z', 76],
      ['x', -12],
      ['y', 14],
    ],
    LeftForeArm: [
      ['y', -58],
      ['x', 8],
    ],
    RightForeArm: [
      ['y', 58],
      ['x', 8],
    ],
    LeftHand: [
      ['x', 14],
      ['z', -6],
    ],
    RightHand: [
      ['x', 14],
      ['z', 6],
    ],
    ...HANDS_RELAX,
  });
  C.sit = {
    name: 'sit',
    dur: 10,
    keys: breathe({ b: sitChair, hips: [0, -0.475, -0.08] }, 8, 10, 0.6, 12),
    ground: false,
    seat: 0.46,
  };
  C.sit_stool = {
    name: 'sit_stool',
    dur: 10,
    keys: breathe(
      {
        b: merge(sitChair, {
          LeftLeg: [['x', 60]],
          RightLeg: [['x', 96]],
          LeftUpLeg: [
            ['x', -70],
            ['z', 6],
          ],
          RightUpLeg: [
            ['x', -78],
            ['z', -4],
          ],
          RightFoot: [['x', 8]],
        }),
        hips: [0, -0.24, -0.08],
      },
      8,
      10,
      0.6,
      12,
    ),
    ground: false,
    seat: 0.74,
  };
  // mirrored variants keep crowds from looking cloned
  for (const n of ['idle', 'cross_arms', 'phone_text', 'talk_g', 'drink', 'idle_f'])
    C[n + '_m'] = { ...C[n], name: n + '_m', keys: C[n].keys.map(mirrorKey) };
  if (MOCAP_ON) addMocapClips(C);
  return C;
}

// ------------------------------------------------------------------ binding to an archetype rig
const _qa = new THREE.Quaternion(),
  _qb = new THREE.Quaternion(),
  _qc = new THREE.Quaternion(),
  _v = new THREE.Vector3(),
  _v2 = new THREE.Vector3();
const CANON_DIR = {
  Shoulder: new THREE.Vector3(1, 0, 0),
  Arm: new THREE.Vector3(1, 0, 0),
  ForeArm: new THREE.Vector3(1, 0, 0),
  Hand: new THREE.Vector3(1, 0, 0),
  UpLeg: new THREE.Vector3(0, -1, 0),
  Leg: new THREE.Vector3(0, -1, 0),
};
const CHILD = {
  Shoulder: 'Arm',
  Arm: 'ForeArm',
  ForeArm: 'Hand',
  Hand: 'HandMiddle1',
  UpLeg: 'Leg',
  Leg: 'Foot',
};
/** rig: { bones: {Name: Bone}, root: Object3D (gltf scene) } -> canonical frames (T-pose world rotations per bone) */
export function makeFrames(rig) {
  const root = rig.root;
  root.updateMatrixWorld(true);
  const rootInv = new THREE.Quaternion();
  root.getWorldQuaternion(rootInv).invert();
  const W = {},
    T = {},
    P = {};
  const wq = (o) => o.getWorldQuaternion(new THREE.Quaternion()).premultiply(rootInv);
  for (const n in rig.bones) W[n] = wq(rig.bones[n]);
  const D = {};
  for (const n in rig.bones) {
    const b = rig.bones[n];
    P[n] = b.parent && b.parent.isBone ? wq(b.parent) : wq(b.parent || root);
    D[n] = null;
    for (const side of ['Left', 'Right']) {
      if (!n.startsWith(side)) continue;
      const part = n.slice(side.length);
      if (/^Hand(Index|Middle|Ring|Pinky|Thumb)/.test(part)) {
        D[n] = 'finger';
        continue;
      }
      if (CANON_DIR[part] && rig.bones[side + CHILD[part]]) {
        const a = b.getWorldPosition(new THREE.Vector3()),
          c = rig.bones[side + CHILD[part]].getWorldPosition(new THREE.Vector3());
        const dir = c.sub(a).applyQuaternion(rootInv).normalize();
        const want = CANON_DIR[part].clone();
        if (side === 'Right') want.x = -want.x;
        D[n] = new THREE.Quaternion().setFromUnitVectors(dir, want);
      }
    }
  }
  for (const n in D)
    if (D[n] === 'finger') D[n] = D[(n.startsWith('Left') ? 'Left' : 'Right') + 'Hand'] || null;
  for (const n in rig.bones) T[n] = D[n] ? D[n].clone().multiply(W[n]) : W[n].clone();
  // parent T (canonical) for each bone: T of the parent bone, or the parent's world rotation for the root
  const TP = {};
  for (const n in rig.bones) {
    const p = rig.bones[n].parent;
    const pn = p && p.isBone ? Object.keys(rig.bones).find((k) => rig.bones[k] === p) : null;
    TP[n] = pn ? T[pn] : P[n];
  }
  const restLocal = {};
  for (const n in rig.bones)
    restLocal[n] = { q: rig.bones[n].quaternion.clone(), p: rig.bones[n].position.clone() };
  const hipsParentQ = P.Hips ? P.Hips.clone() : new THREE.Quaternion();
  const hp = rig.bones.Hips.parent;
  const hpsc = new THREE.Vector3(1, 1, 1);
  if (hp) hp.getWorldScale(hpsc);
  return { T, TP, restLocal, hipsParentQinv: hipsParentQ.invert(), hipsScale: hpsc.y || 1 };
}
function opsQ(ops, out) {
  if (ops && ops.length === 1 && ops[0][0] === 'q') return out.fromArray(ops[0][1]);
  return Q(ops, out);
}
/** canonical clip -> THREE.AnimationClip on this rig (quaternion tracks per bone, hips position track) */
export function bindClip(rig, F, c, hipH) {
  const bones = new Set();
  for (const k of c.keys) for (const n in k.b || {}) bones.add(n);
  if (!c.upperOnly) for (const n in STAND) bones.add(n);
  const times = new Float32Array(c.keys.map((k) => k.t));
  const tracks = [];
  const qA = new THREE.Quaternion(),
    qL = new THREE.Quaternion();
  const scale = (hipH || 0.98) / 0.98;
  for (const n of bones) {
    const bone = rig.bones[n];
    if (!bone || !F.T[n]) continue;
    const vals = new Float32Array(c.keys.length * 4);
    const Tp = F.TP[n],
      Tb = F.T[n];
    const TpInv = Tp.clone().invert();
    c.keys.forEach((k, i) => {
      const ops = (k.b && k.b[n]) || (c.upperOnly ? null : STAND[n]) || [];
      opsQ(ops, qA);
      qL.copy(TpInv).multiply(qA).multiply(Tb);
      if (i > 0) {
        const prev = vals.subarray((i - 1) * 4, i * 4);
        if (prev[0] * qL.x + prev[1] * qL.y + prev[2] * qL.z + prev[3] * qL.w < 0)
          qL.set(-qL.x, -qL.y, -qL.z, -qL.w);
      }
      qL.toArray(vals, i * 4);
    });
    tracks.push(new THREE.QuaternionKeyframeTrack(bone.name + '.quaternion', times, vals));
  }
  if (!c.upperOnly && rig.bones.Hips) {
    const hb = rig.bones.Hips;
    const r0 = F.restLocal.Hips.p;
    const hq = new Float32Array(c.keys.length * 4),
      hp = new Float32Array(c.keys.length * 3);
    const TpInv = F.TP.Hips.clone().invert();
    c.keys.forEach((k, i) => {
      opsQ(k.hipsRot || [], qA);
      qL.copy(TpInv).multiply(qA).multiply(F.T.Hips);
      if (
        i > 0 &&
        hq[(i - 1) * 4] * qL.x +
          hq[(i - 1) * 4 + 1] * qL.y +
          hq[(i - 1) * 4 + 2] * qL.z +
          hq[(i - 1) * 4 + 3] * qL.w <
          0
      )
        qL.set(-qL.x, -qL.y, -qL.z, -qL.w);
      qL.toArray(hq, i * 4);
      const o = k.hips || [0, 0, 0];
      _v.set(o[0] * scale, o[1] * scale, o[2] * scale)
        .applyQuaternion(F.hipsParentQinv)
        .multiplyScalar(1 / F.hipsScale);
      hp[i * 3] = r0.x + _v.x;
      hp[i * 3 + 1] = r0.y + _v.y;
      hp[i * 3 + 2] = r0.z + _v.z;
    });
    tracks.push(new THREE.QuaternionKeyframeTrack(hb.name + '.quaternion', times, hq));
    tracks.push(new THREE.VectorKeyframeTrack(hb.name + '.position', times, hp));
  }
  const clip = new THREE.AnimationClip(c.name, c.dur, tracks);
  clip.userData = {
    loco: !!c.loco,
    run: !!c.run,
    ground: !!c.ground,
    upperOnly: !!c.upperOnly,
    prop: c.prop || null,
    seat: c.seat || 0,
    wall: c.wall || 0,
    mocap: c.mocap || null,
  };
  return clip;
}

// sample a clip on the rig (FK) to (a) pin the lowest foot to the ground for standing clips and (b) measure gait speed
function evalClip(rig, clip, t, cache) {
  const its = (cache.its ||= clip.tracks.map((tr) => [
    tr,
    tr.createInterpolant(),
    tr.name.split('.'),
  ]));
  for (const [tr, it, [bn, prop]] of its) {
    const r = it.evaluate(t);
    const b = cache.byName[bn];
    if (!b) continue;
    if (prop === 'quaternion') b.quaternion.fromArray(r);
    else b.position.fromArray(r);
  }
  rig.root.updateMatrixWorld(true);
}
export function groundAndSpeed(rig, F, clip, restFoot) {
  const byName = {};
  for (const n in rig.bones) byName[rig.bones[n].name] = rig.bones[n];
  const cache = { byName };
  const hipsTrack = clip.tracks.find((tr) => tr.name.endsWith('.position'));
  const N = clip.userData.loco ? 48 : Math.min(64, hipsTrack ? hipsTrack.times.length * 3 : 16);
  const feet = ['Left', 'Right'].map((s) => [rig.bones[s + 'Foot'], rig.bones[s + 'ToeBase']]);
  const lows = [],
    fz = [[], []],
    ank = [[], []];
  const inv = new THREE.Matrix4().copy(rig.root.matrixWorld).invert();
  for (let i = 0; i < N; i++) {
    const t = (i / N) * clip.duration;
    evalClip(rig, clip, t, cache);
    let low = 1e9;
    feet.forEach(([f, toe], s) => {
      if (!f || !toe) return;
      const a = f.getWorldPosition(_v).applyMatrix4(inv),
        b = toe.getWorldPosition(_v2).applyMatrix4(inv);
      const h = Math.min(a.y - restFoot.ankle, b.y - restFoot.toe);
      low = Math.min(low, h);
      fz[s].push([t, Math.min(a.y - restFoot.ankle, b.y - restFoot.toe), (a.z + b.z) / 2]);
      ank[s].push(a.y, a.z);
    });
    lows.push([t, low]);
  }
  // restore rest
  for (const n in rig.bones) {
    rig.bones[n].quaternion.copy(F.restLocal[n].q);
    rig.bones[n].position.copy(F.restLocal[n].p);
  }
  rig.root.updateMatrixWorld(true);
  if (clip.userData.ground && hipsTrack) {
    const v = hipsTrack.values;
    const tt = hipsTrack.times;
    const lowAt = (t) => {
      const k = (t / clip.duration) * N;
      const i0 = Math.floor(k) % N,
        i1 = (i0 + 1) % N;
      const f = k - Math.floor(k);
      return lows[i0][1] * (1 - f) + lows[i1][1] * f;
    };
    const up = new THREE.Vector3(0, 1, 0)
      .applyQuaternion(F.hipsParentQinv)
      .multiplyScalar(1 / F.hipsScale);
    for (let i = 0; i < tt.length; i++) {
      let d = -lowAt(tt[i]);
      if (clip.userData.run) d = Math.max(0, d); // runners keep their flight phase
      v[i * 3] += up.x * d;
      v[i * 3 + 1] += up.y * d;
      v[i * 3 + 2] += up.z * d;
    }
  }
  if (clip.userData.loco) {
    // ground speed = how fast the planted foot moves backward
    let sum = 0,
      cnt = 0;
    for (const arr of fz)
      for (let i = 0; i < arr.length; i++) {
        const a = arr[i],
          b = arr[(i + 1) % arr.length];
        const lowest = Math.min(...arr.map((x) => x[1]));
        if (a[1] < lowest + 0.02 && b[1] < lowest + 0.02) {
          const dt = (b[0] - a[0] + clip.duration) % clip.duration;
          if (dt > 0) {
            sum += -(b[2] - a[2]) / dt;
            cnt++;
          }
        }
      }
    clip.userData.speed = cnt ? Math.max(0.3, sum / cnt) : 1.3;
    // captured cycles: the speed of the flat foot at mid-stance (the lower ankle, under the body), where sliding shows
    // most. The planted-band average above undercounts captured gaits with soft heel / toe rolls (seniors: 0.36 vs 0.87 m/s)
    if (clip.userData.mocap) {
      let ms = 0;
      let mn = 0;
      for (let i = 0; i < N; i++) {
        const j = (i + 1) % N;
        for (let s = 0; s < 2; s++) {
          const o = 1 - s;
          const y = ank[s][i * 2];
          const z = ank[s][i * 2 + 1];
          if (y < ank[o][i * 2] - 0.01 && Math.abs(z) < 0.1) {
            ms += -(ank[s][j * 2 + 1] - z) / (clip.duration / N);
            mn++;
          }
        }
      }
      if (mn >= 4 && ms / mn > 0.3) clip.userData.speed = ms / mn;
    }
  }
}

/** every clip for one archetype rig (gaits, idles, poses, plus the original procedural action clips) */
export function buildClipsFor(rig, hipH) {
  const F = makeFrames(rig);
  // rest foot heights (ankle, toe base) above the floor
  rig.root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(rig.root.matrixWorld).invert();
  const restFoot = {
    ankle: rig.bones.LeftFoot.getWorldPosition(new THREE.Vector3()).applyMatrix4(inv).y,
    toe: rig.bones.LeftToeBase.getWorldPosition(new THREE.Vector3()).applyMatrix4(inv).y,
  };
  const out = {};
  const canon = canonicalClips();
  for (const n in canon) {
    try {
      const c = bindClip(rig, F, canon[n], hipH);
      groundAndSpeed(rig, F, c, restFoot);
      out[n] = c;
    } catch (e) {
      console.warn('[npc anim] bind', n, e);
    }
  }
  // action clips (jump, fall, punches, deaths, get-ups, drive, swim, cower, lie, sit, phone call, wave, argue, hands up,
  // throw, leash, volley, kneel) are the project's own procedural clips: convert them from their canonical form
  try {
    const names = new Set(Object.keys(rig.bones));
    const fake = {
      bones: new Proxy(
        {},
        { get: (t, n) => (typeof n === 'string' && names.has(n) ? { name: n } : undefined) },
      ),
      rest: { Hips: { p: new THREE.Vector3(0, 100, 0) } },
    };
    const pc = buildProceduralClips(fake);
    for (const n in pc) {
      if (out[n]) continue;
      const src = pc[n];
      const keys = [];
      const tq = src.tracks.filter((tr) => tr.name.endsWith('.quaternion'));
      const tp = src.tracks.find((tr) => tr.name === 'Hips.position');
      const times = tq[0] ? Array.from(tq[0].times) : [0];
      times.forEach((t, i) => {
        const b = {};
        let hipsRot = null;
        for (const tr of tq) {
          const bn = tr.name.split('.')[0];
          const qv = Array.from(tr.values.slice(i * 4, i * 4 + 4));
          if (bn === 'Hips') hipsRot = [['q', qv]];
          else b[bn] = [['q', qv]];
        }
        const hips = tp
          ? [
              tp.values[i * 3] * 0.01,
              (tp.values[i * 3 + 1] - 100) * 0.01,
              tp.values[i * 3 + 2] * 0.01,
            ]
          : undefined;
        keys.push({ t, b: { ...(CLIP_HANDS[n] || HANDS_RELAX), ...b }, hips, hipsRot });
      });
      const c = bindClip(
        rig,
        F,
        { name: n, dur: src.duration, keys, upperOnly: !!src.userData?.upperOnly },
        hipH,
      );
      out[n] = c;
    }
  } catch (e) {
    console.warn('[npc anim] procedural clips', e);
  }
  return out;
}
