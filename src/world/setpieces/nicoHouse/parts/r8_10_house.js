// Nico's house, round 8 (docs/v2/plan/nico_house/r8/SPEC.md; references B, D, C, E, G): the raised Keys stilt house, DIAGONAL to the
// compass (house frame H of r4/plan4.js: -X = SW front, +X = NE back, +Z = SE, -Z = NW). Whitewashed 10x10 posts with knee braces,
// beams and joists; the 1.2 m front walkway along the SW gable with the front door in its middle, carried round the south corner as
// the head pad of the main stair; the main stair down the SE face in two flights with a landing (closed stringers, newels at every
// end, the handrails die into the newels, balusters between stringer and rail, one ramp collider per flight); the upper back strip
// along the NE gable (slider) with the steps down to the lower gym deck (part r8_12); weathered teal board-and-batten walls with real
// boards and battens, white casings, board shutters, a hatch in the front gable; the gable roof (patched shingles on the SE slope,
// standing seam on the NW slope); the user's satellite dish on the stair-head post; the hoop on the SE edge beam over the under-house
// passage (backboard facing SE); the cracked concrete pad under the house. Every piece is a closed, beveled solid; faces that would
// touch are cut or offset (no coplanar faces). Built in H through r4/frame.js.
import { R8, P4, inR, toS, StoH, HtoB, BtoH } from '../r4/plan4.js';
import { frame } from '../r4/frame.js';
import { makeGeo } from '../r4/geo.js';
import { glb } from '../r4/glb.js';
import { carpentry } from '../r4/carp8.js';
export const order = 10;

export function build(ctx) {
  if (!R8) return;
  const { THREE, kit, mat } = ctx,
    Fr = frame(ctx, 'house'),
    B = Fr.ext,
    D = Fr.detail,
    M = kit.M,
    P = P4,
    C = P.colors,
    r = kit.rng(808);
  const { hexa, subtract, lathe } = makeGeo(THREE, kit);
  const F = P.F,
    db = P.board,
    J = P.joist,
    BM = P.beam,
    joistTop = F - db.t,
    joistBot = joistTop - J.d,
    beamTop = joistBot,
    beamBot = beamTop - BM.d,
    yT = F + P.wallH;
  ctx.r4 = { F, yT, beamBot };
  const WOOD = mat.wood(),
    WHITE = mat.paint({ peel: 'a', fade: 0.55, gloss: 0.93 }),
    TEAL = mat.paint({ peel: 'b', fade: 0.45, gloss: 0.92, scale: 1.2 }),
    DOORP = mat.paint({ peel: 'a', fade: 0.15, gloss: 0.72, scale: 0.6 });
  const GLASS = mat.glass(),
    PLAST = mat.plastic(),
    STEEL = mat.steel(),
    CONC = mat.concrete(),
    RUB = mat.rubber(),
    MP = mat.metalPaint();
  const gray = (k = 1) => kit.vary(kit.mul(C.deck, k), r, 0.08),
    dark = () => kit.vary(C.deckDark, r, 0.09),
    postC = () => kit.vary(C.post, r, 0.04);
  const box = (m, sx, sy, sz, x, y, z, o = {}, rx = 0, ry = 0, rz = 0, Bt = B) =>
    Bt.box(m, sx, sy, sz, M(x, y, z, rx, ry, rz), { bevel: 0.004, rand: r, ...o });
  ctx.geo8 = { hexa };
  ctx.colors8 = C;
  ctx.rail8 = P.rail;
  ctx.F8 = F;
  const RL = P.rail,
    ps = P.post,
    Bd = P.body,
    WK = P.walk,
    UP = P.upper,
    pitch = db.w + db.gap,
    rise = F / 20,
    run = P.run;

  // ================= posts (on concrete piers), beams, knee braces =================
  // body grid + the walkway's outer line + the stair-head corner; the passage under the house (x -2.2..2.2) stays open
  const posts = [];
  for (const x of P.postXs) for (const z of P.postZs) posts.push([x, z, 'body']);
  for (const z of [-10.4, -7.0, -3.6, WK.z1]) posts.push([WK.x0, z, 'walk']);
  posts.push([Bd.x0 - 0.06, WK.z1, 'pad']); // the stair-head corner post runs on up as the stair's outer head newel
  for (const [x, z, k] of posts) {
    const h = (k === 'pad' ? F + 1.02 : beamBot + 0.002) - 0.05,
      lean = (r() - 0.5) * 0.006;
    box(
      WOOD,
      ps,
      h,
      ps,
      x,
      0.05 + h / 2,
      z,
      { grain: 1, color: postC(), wear: [0.7, 0.45 + r() * 0.2], bevel: 0.012 },
      lean,
      (r() - 0.5) * 0.02,
      lean * 0.6,
    );
    box(CONC, ps + 0.12, 0.1, ps + 0.12, x, 0.05, z, {
      color: kit.vary(0xc9c4b6, r, 0.05),
      wear: 0.8,
      bevel: 0.02,
    });
    if (k === 'pad')
      box(WOOD, ps + 0.03, 0.03, ps + 0.03, x, F + 1.02 + 0.015, z, {
        color: gray(0.96),
        wear: 0.6,
      }); // cap
    Fr.col.box(
      x,
      k === 'pad' ? (F + 1.02) / 2 : 1.6,
      z,
      ps + 0.02,
      k === 'pad' ? F + 1.02 : 3.2,
      ps + 0.02,
      { tag: 'pile' },
    );
  }
  // beams along X on every post line (3-ply 2x12), from the walkway's outer posts to the upper strip's outer edge; the stair-head
  // corner gets its own short beam
  const BX0 = WK.x0 - ps / 2 - 0.02,
    BX1 = UP.x1 + 0.02;
  const beamX = (z, x0, x1) => {
    const n = Math.ceil((x1 - x0) / 5.2);
    for (let i = 0; i < n; i++) {
      const a = x0 + ((x1 - x0) * i) / n,
        b = x0 + ((x1 - x0) * (i + 1)) / n - 0.004;
      box(WOOD, b - a, BM.d, 0.16, (a + b) / 2, beamBot + BM.d / 2, z, {
        grain: 0,
        color: dark(),
        wear: 0.55,
        bevel: 0.006,
        shade: [0.82, 1],
      });
    }
  };
  for (const z of P.postZs) beamX(z, BX0, BX1);
  beamX(WK.z1, BX0, Bd.x0 - 0.06 - ps / 2); // the stair head's short beam dies into its corner post
  // knee braces (4x4) on the outside posts, both ways (B, D)
  const knee = (px, pz, dx, dz) => {
    const a = [px + dx * (ps / 2), beamBot - 0.7, pz + dz * (ps / 2)],
      b = [px + dx * 0.72, beamBot - 0.01, pz + dz * 0.72];
    B.strut(WOOD, a, b, 0.09, 0.09, { color: postC(), wear: 0.6, bevel: 0.008, rand: r });
  };
  for (const [x, z, k] of posts) {
    if (k === 'walk' || k === 'pad') {
      if (z > -10.3) knee(x, z, 0, -1);
      if (z < WK.z1 - 0.1) knee(x, z, 0, 1);
      continue;
    }
    if (x > Bd.x0 + 0.1) knee(x, z, -1, 0);
    if (x < Bd.x1 - 0.1) knee(x, z, 1, 0);
    if (z === -3.6 && x < 2) knee(x, z, 0, -1); // SE line: braces in toward the passage
  }
  // joists along Z (on the beams): the walkway + stair head (to WK.z1), the body, the upper strip
  const jRuns = [];
  for (let x = WK.x0 - ps / 2 + 0.03; x < UP.x1 - 0.02; x += J.oc) jRuns.push(x);
  for (const x of jRuns) {
    const z0 = -10.4 - 0.08,
      z1 = (x < Bd.x0 ? WK.z1 : -3.6) + 0.08;
    box(WOOD, J.t, J.d, z1 - z0 - 0.004, x, joistBot + J.d / 2, (z0 + z1) / 2, {
      grain: 2,
      color: kit.vary(kit.mul(C.deckDark, 0.95), r, 0.1),
      wear: 0.4,
      bevel: 0.003,
      shade: [0.8, 1],
    });
  }
  // rim boards (the visible deck edge band), proud of the joist ends
  const rim = (x0, z0, x1, z1) => {
    const hz = Math.abs(z1 - z0) < 0.01,
      len = hz ? Math.abs(x1 - x0) : Math.abs(z1 - z0);
    box(
      WOOD,
      hz ? len : 0.045,
      J.d + 0.02,
      hz ? 0.045 : len,
      (x0 + x1) / 2,
      joistBot + J.d / 2 + 0.005,
      (z0 + z1) / 2,
      { grain: hz ? 0 : 2, color: gray(0.9), wear: 0.7, bevel: 0.006, shade: [0.85, 1] },
    );
  };
  const RX0 = WK.x0 - ps / 2 - 0.05,
    RZ0 = -10.4 - 0.08 - 0.0225,
    RZB = -3.6 + 0.08 + 0.0225,
    RZW = WK.z1 + 0.08 + 0.0225,
    RX1 = UP.x1 + 0.05;
  rim(RX0, RZ0, RX1 + 0.02, RZ0); // NW edge, the whole length
  rim(Bd.x0 + 0.1, RZB, RX1 + 0.02, RZB); // SE edge of the body and the upper strip
  rim(RX0, RZW, Bd.x0 + 0.1, RZW); // SE end of the stair head
  rim(RX0 + 0.0225, RZ0 + 0.0225, RX0 + 0.0225, RZW - 0.0225);
  rim(RX1, RZ0 + 0.0225, RX1, RZB - 0.0225);
  rim(Bd.x0 + 0.0225, RZB, Bd.x0 + 0.0225, RZW - 0.0225); // the stair head's edge, where the flight's stringers hang
  // plywood subfloor under the rooms (seen from below)
  const PLY = mat.pbr('plywood', { rep: 1.2, grunge: true });
  for (let x = Bd.x0; x < Bd.x1 - 0.01; x += 2.44)
    for (let z = Bd.z0; z < Bd.z1 - 0.01; z += 1.22) {
      const sx = Math.min(2.44, Bd.x1 - x),
        sz = Math.min(1.22, Bd.z1 - z);
      box(PLY, sx - 0.006, 0.019, sz - 0.006, x + sx / 2, joistTop + 0.0095 - 0.0005, z + sz / 2, {
        color: kit.vary(0x8f7d62, r, 0.12),
        wear: 0.8,
        bevel: 0,
      });
    }

  // ================= deck boards (run across each deck: along X), screws, colliders =================
  const snap = (x) => jRuns.reduce((b, j) => (Math.abs(j - x) < Math.abs(b - x) ? j : b), jRuns[0]),
    screws = [];
  const deckRow = (z, x0, x1) => {
    let x = x0;
    while (x < x1 - 0.01) {
      let xe = x + [2.44, 3.05, 3.66][Math.floor(r() * 3)];
      xe = xe > x1 - 0.8 ? x1 : Math.min(x1, snap(xe));
      if (xe - x < 0.3) xe = x1;
      const fresh = r() < 0.04,
        tone = fresh ? kit.vary(0xc9b48a, r, 0.06) : gray(0.86 + r() * 0.24),
        len = xe - x - 0.005;
      box(
        WOOD,
        len,
        db.t,
        db.w,
        (x + xe) / 2,
        F - db.t / 2 + (r() - 0.5) * 0.002,
        z,
        { grain: 0, color: tone, wear: fresh ? 0.1 : 0.35 + r() * 0.5, bevel: 0.005 },
        (r() - 0.5) * 0.006,
      );
      for (const j of jRuns)
        if (j > x + 0.03 && j < xe - 0.03)
          for (const dz of [-0.04, 0.04]) screws.push(M(j, F + 0.0006, z + dz));
      x = xe;
    }
  };
  for (let z = -10.4 - 0.08 + pitch / 2; z < WK.z1 + 0.08 - db.w / 2 + 0.01; z += pitch)
    deckRow(z, RX0 + 0.02, z > -3.6 + db.w / 2 + 0.01 ? Bd.x0 - 0.004 : Bd.x0 - 0.03); // the walkway (to the wall) + the stair head (to its edge)
  for (let z = -10.4 - 0.08 + pitch / 2; z < -3.6 + 0.08 - db.w / 2 + 0.01; z += pitch)
    deckRow(z, Bd.x1 + 0.03, RX1 + 0.02); // the upper strip
  {
    const g = new THREE.CylinderGeometry(0.004, 0.004, 0.002, 6);
    const sm = kit.instances(g, mat.steel(), screws, null);
    sm.name = 'r8screws';
    Fr.groups.detail.add(sm);
  }
  Fr.col.box(
    (WK.x0 + Bd.x0) / 2 - 0.05,
    F - 0.16,
    (WK.z0 + WK.z1) / 2,
    Bd.x0 - WK.x0 + 0.25,
    0.32,
    WK.z1 - WK.z0 + 0.16,
    { tag: 'deck', surface: 'wood' },
  );
  Fr.col.box(
    (Bd.x0 + Bd.x1) / 2,
    F - 0.16,
    (Bd.z0 + Bd.z1) / 2,
    Bd.x1 - Bd.x0,
    0.32,
    Bd.z1 - Bd.z0 + 0.16,
    { tag: 'floor', surface: 'wood' },
  );
  Fr.col.box(
    (UP.x0 + UP.x1) / 2 + 0.05,
    F - 0.16,
    (UP.z0 + UP.z1) / 2,
    UP.x1 - UP.x0 + 0.1,
    0.32,
    UP.z1 - UP.z0 + 0.16,
    { tag: 'deck', surface: 'wood' },
  );

  // ================= level rails: posts every <= 1.6 m, top rail under a cap, bottom rail, balusters; one collider per run =================
  const railY = F + RL.h;
  const { railRun, flight, lattice } = carpentry(ctx, Fr, B, r);

  const e = 0.06,
    RW = { x0: RX0 + e, z0: RZ0 + e, z1: WK.z1 };
  railRun(RW.x0, RW.z0, Bd.x0 - 0.02, RW.z0, { noEnd: true }); // walkway NW end, into the house corner
  railRun(RW.x0, RW.z0, RW.x0, RW.z1, { noStart: true }); // walkway outer edge (SW), the whole front
  railRun(RW.x0, RW.z1, Bd.x0 - 0.06, RW.z1, { noStart: true, noEnd: true }); // the stair head's SE end, into the corner post (the stair's outer newel)
  // upper back strip: both ends; its NE edge has the fascia step down to the lower deck (the rail of the lower deck's level change)
  railRun(Bd.x1 + 0.02, RZ0 + e, RX1 - e, RZ0 + e, { noStart: true });
  railRun(Bd.x1 + 0.02, RZB - e, RX1 - e, RZB - e, { noStart: true });
  const SU = P.stepsUL;
  railRun(RX1 - e, RZ0 + e, RX1 - e, SU.z0, { noStart: true });
  railRun(RX1 - e, SU.z1, RX1 - e, RZB - e, { noEnd: true });

  // ================= stairs =================
  // stairs: r4/carp8.js flight() (closed stringers, newels, handrails into the newels, balusters, one ramp collider per flight)
  // lattice: real diagonal strips in a frame (two layers), in the vertical plane along dir from (x, z), length len, top from yA to yB

  // ---- the main stair (B, D): head pad = the walkway's south corner, flight 1 down +X along the SE face, landing, flight 2, foot step ----
  // newels: flight 1's inner head newel on the pad by the wall, its outer one = the corner post; flight 1's foot newels and flight 2's
  // head newels are the four landing posts (full height from the ground)
  {
    const MS = P.mainStair,
      w = MS.w,
      zc = MS.zc,
      yL = F - 10 * rise;
    const f1 = flight({
      x: Bd.x0,
      z: zc,
      y0: F,
      dir: [1, 0],
      n: 9,
      w,
      headNewels: [-1],
      tHead: -0.06,
      headBase: beamBot - 0.1,
      footBase: 0.05,
    });
    const la = Bd.x0 + f1.total,
      lb = la + 1.2,
      lz0 = zc - w / 2,
      lz1 = zc + w / 2,
      nA = Bd.x0 + f1.tFoot,
      nB = lb + 0.02;
    MS.landing = { x0: la, x1: lb, z0: lz0, z1: lz1, y: yL };
    for (const x of [nA, nB])
      for (const z of [lz0 - 0.05, lz1 + 0.05])
        box(CONC, 0.3, 0.1, 0.3, x, 0.05, z, { color: 0xb9b5aa, wear: 0.8, bevel: 0.015 });
    for (let x = la + pitch / 2; x < lb - 0.02; x += pitch)
      box(WOOD, db.w, db.t, w - 0.02, x, yL - db.t / 2, zc, {
        grain: 2,
        color: gray(0.9 + r() * 0.2),
        wear: 0.5,
        bevel: 0.005,
      });
    for (const zz of [lz0 + 0.035, lz1 - 0.035])
      box(WOOD, lb - la, 0.2, 0.05, (la + lb) / 2, yL - db.t - 0.1, zz, {
        grain: 0,
        color: dark(),
        wear: 0.4,
      });
    Fr.col.box((la + lb) / 2, yL - 0.1, zc, lb - la + 0.1, 0.2, w, {
      tag: 'deck',
      surface: 'wood',
    });
    for (const s of [lz0 - 0.05, lz1 + 0.05]) {
      const x0 = nA + 0.05,
        x1 = nB - 0.05,
        len = x1 - x0,
        cx = (x0 + x1) / 2;
      box(WOOD, len + 0.04, 0.04, 0.14, cx, yL + 0.94, s, {
        grain: 0,
        color: gray(0.96),
        wear: 0.65,
      });
      box(WOOD, len, 0.085, 0.045, cx, yL + 0.86, s, { grain: 0, color: gray(0.92), wear: 0.6 });
      box(WOOD, len, 0.04, 0.085, cx, yL + 0.1, s, { grain: 0, color: gray(0.9), wear: 0.6 });
      for (let t = 0.08; t < len - 0.05; t += RL.oc)
        box(WOOD, RL.bal, 0.68, RL.bal, x0 + t, yL + 0.46, s, {
          grain: 1,
          color: gray(0.9),
          wear: 0.6,
        });
      Fr.col.box(cx, yL + 0.55, s, len + 0.1, 1.1, 0.1, { tag: 'rail' });
    }
    const f2 = flight({
      x: lb,
      z: zc,
      y0: yL,
      dir: [1, 0],
      n: 9,
      w,
      headNewels: true,
      tHead: 0.02,
      headBase: 0.05,
    });
    // the foot: a small step platform on the pad
    const px0 = lb + f2.total + 0.02,
      px1 = px0 + 0.62;
    MS.foot = { x: (px0 + px1) / 2, z: zc };
    box(WOOD, px1 - px0, 0.06, w + 0.3, (px0 + px1) / 2, 0.13, zc, {
      grain: 2,
      color: gray(0.86),
      wear: 0.6,
      bevel: 0.01,
    });
    for (const sz of [-1, 1])
      box(WOOD, px1 - px0, 0.1, 0.08, (px0 + px1) / 2, 0.05, zc + sz * (w / 2 + 0.08), {
        grain: 0,
        color: dark(),
        wear: 0.5,
      });
    Fr.col.box((px0 + px1) / 2, 0.08, zc, px1 - px0, 0.16, w + 0.3, {
      tag: 'deck',
      surface: 'wood',
    });
    // lattice under the stair, on its outer side (B / D): under flight 1 (between the corner post and the landing) and under flight 2
    const zo = lz1 + 0.12;
    lattice(Bd.x0 + 0.08, zo, [1, 0], nA - Bd.x0 - 0.16, F - 0.55, yL - 0.42);
    lattice(nB + 0.08, zo, [1, 0], f2.total - 0.55, yL - 0.5, 0.36);
  }
  // ---- steps from the upper strip down to the lower deck (NE edge, NW end): 4 risers, between the strip's rails ----
  {
    const n = 4,
      rr = (F - P.lower.y) / n,
      rn = 0.28,
      w = SU.z1 - SU.z0 - 0.05,
      zc = (SU.z0 + SU.z1) / 2;
    flight({
      x: UP.x1 + 0.05,
      z: zc,
      y0: F,
      dir: [1, 0],
      n: n - 1,
      w,
      rise: rr,
      run: rn,
      headNewels: false,
      tHead: -0.06,
      footBase: P.lower.y,
      risers: true,
    });
  }
  // the fascia where the upper strip steps down to the lower deck (the 0.85 m face along x = UP.x1 above the lower deck)
  for (const [z0, z1] of [
    [RZ0 + 0.03, SU.z0 - 0.02],
    [SU.z1 + 0.02, RZB - 0.03],
  ])
    box(
      WOOD,
      0.04,
      F - P.lower.y - 0.02,
      z1 - z0,
      RX1 + 0.035,
      (F + P.lower.y) / 2,
      (z0 + z1) / 2,
      { grain: 2, color: gray(0.82), wear: 0.7 },
    );
  for (const [z0, z1] of [
    [RZ0, SU.z0],
    [SU.z1, RZB],
  ])
    Fr.col.box(RX1 + 0.035, (F + P.lower.y) / 2, (z0 + z1) / 2, 0.06, F - P.lower.y, z1 - z0, {
      tag: 'wall',
    });

  // ================= under the house: the cracked concrete pad (C) =================
  {
    const PD = P.pad,
      PADM = mat.pbr('scuffed_cement', { rep: 2.2, gain: 3.4, tint: 0xbcd2ff, grunge: true }),
      q = kit.rng(818),
      s = 1.5;
    for (let x = PD.x0; x < PD.x1 - 0.05; x += s)
      for (let z = PD.z0; z < PD.z1 - 0.05; z += s) {
        const sx = Math.min(s, PD.x1 - x),
          sz = Math.min(s, PD.z1 - z);
        const t = kit.vary(0xb4b1aa, q, 0.06),
          tilt = (q() - 0.5) * 0.008;
        box(
          PADM,
          sx - 0.012,
          0.1,
          sz - 0.012,
          x + sx / 2,
          -0.015 + (q() - 0.5) * 0.004,
          z + sz / 2,
          { color: t, wear: 0.7 + q() * 0.3, bevel: 0.006 },
          tilt,
          0,
          -tilt,
        );
        if (q() < 0.35) {
          const a = q() * 3,
            l = 0.4 + q() * 0.8;
          box(
            mat.matte(),
            l,
            0.004,
            0.012,
            x + sx / 2 + (q() - 0.5) * 0.5,
            0.0365,
            z + sz / 2 + (q() - 0.5) * 0.5,
            { color: 0x3e3b36, bevel: 0 },
            0,
            a,
          );
        }
      }
    Fr.col.box(
      (PD.x0 + PD.x1) / 2,
      0.0175,
      (PD.z0 + PD.z1) / 2,
      PD.x1 - PD.x0,
      0.035,
      PD.z1 - PD.z0,
      { tag: 'ground', surface: 'concrete' },
    );
    // pebbles and grit along the slab edges and in the cracks
    const pg = new THREE.DodecahedronGeometry(0.03, 0),
      pm = [],
      pc = [];
    for (let i = 0; i < 160; i++) {
      const side = q() < 0.5,
        x = side ? PD.x0 + (PD.x1 - PD.x0) * q() : (q() < 0.5 ? PD.x0 : PD.x1) + (q() - 0.5) * 0.5,
        z = side ? (q() < 0.5 ? PD.z0 : PD.z1) + (q() - 0.5) * 0.5 : PD.z0 + (PD.z1 - PD.z0) * q();
      pm.push(M(x, 0.035, z, q() * 3, q() * 3, 0, 0.25 + q() * 0.4));
      const v = 0.42 + q() * 0.22;
      pc.push([v, v * 0.92, v * 0.82]);
    }
    // r10 (playtest Nov 19: "no harsh end"): the slab's edge breaks up into the yard: broken-off chunks, half-sunk, a band of rubble and
    // a soft ring of trodden dirt that fades out into the yard sheet (one transparent mesh, no depth write)
    {
      const ch = [],
        cc = [],
        per = 2 * (PD.x1 - PD.x0 + (PD.z1 - PD.z0)),
        at = (t) => {
          let u = t % per;
          const W2 = PD.x1 - PD.x0,
            D2 = PD.z1 - PD.z0;
          if (u < W2) return [PD.x0 + u, PD.z0, 0, -1];
          u -= W2;
          if (u < D2) return [PD.x1, PD.z0 + u, 1, 0];
          u -= D2;
          if (u < W2) return [PD.x1 - u, PD.z1, 0, 1];
          u -= W2;
          return [PD.x0, PD.z1 - u, -1, 0];
        };
      for (let t = 0; t < per; t += 0.22 + q() * 0.3) {
        const [x, z, nx, nz] = at(t),
          o = q() * q() * 0.75 - 0.05,
          sl = (q() - 0.5) * 0.25;
        ch.push(
          M(
            x + nx * o - nz * sl,
            -0.03 + q() * 0.035,
            z + nz * o + nx * sl,
            (q() - 0.5) * 0.25,
            q() * 6.283,
            (q() - 0.5) * 0.25,
            1,
          ),
        );
        ch.at(-1).scale(new THREE.Vector3(0.12 + q() * 0.3, 0.05 + q() * 0.04, 0.1 + q() * 0.25));
        const v = 0.62 + q() * 0.14;
        cc.push([v, v * 0.98, v * 0.93]);
      }
      for (let i = 0; i < 260; i++) {
        const [x, z, nx, nz] = at(q() * per),
          o = 0.1 + q() * q() * 1.1;
        pm.push(
          M(
            x + nx * o + (q() - 0.5) * 0.3 * Math.abs(nz),
            0.0,
            z + nz * o + (q() - 0.5) * 0.3 * Math.abs(nx),
            q() * 3,
            q() * 3,
            0,
            0.3 + q() * 0.6,
          ),
        );
        const v = 0.38 + q() * 0.25;
        pc.push([v, v * 0.9, v * 0.78]);
      }
      const ci = kit.instances(new THREE.BoxGeometry(1, 1, 1), PADM, ch, cc);
      ci.name = 'r10padChunks';
      Fr.groups.ext.add(ci);
      const pos = [],
        col = [],
        idx = [],
        N = 96,
        dirt = [0.34, 0.29, 0.22];
      for (let i = 0; i < N; i++) {
        const [x, z, nx, nz] = at((i / N) * per),
          w = 0.7 + Math.sin(i * 1.7) * 0.25 + q() * 0.3;
        pos.push(x - nx * 0.05, 0.012, z - nz * 0.05, x + nx * w, 0.012, z + nz * w);
        col.push(...dirt, 0.8, ...dirt, 0);
      }
      for (let i = 0; i < N; i++) {
        const a = i * 2,
          b = ((i + 1) % N) * 2;
        idx.push(a, b, a + 1, b, b + 1, a + 1);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
      g.setIndex(idx);
      g.computeVertexNormals();
      if (g.attributes.normal.getY(0) < 0) {
        for (let i = 0; i < idx.length; i += 3) {
          const t2 = idx[i + 1];
          idx[i + 1] = idx[i + 2];
          idx[i + 2] = t2;
        }
        g.setIndex(idx);
        g.computeVertexNormals();
      }
      const dm = new THREE.MeshStandardMaterial({
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        roughness: 1,
        metalness: 0,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      });
      dm.name = 'r10padDirt';
      const dmesh = new THREE.Mesh(g, dm);
      dmesh.name = 'r10padDirt';
      dmesh.receiveShadow = true;
      dmesh.renderOrder = 2;
      dmesh.raycast = () => {};
      Fr.groups.ext.add(dmesh);
    }
    const pi = kit.instances(pg, mat.concrete(), pm, pc);
    pi.name = 'r8pebbles';
    Fr.groups.detail.add(pi);
  }

  // ================= walls: board-and-batten =================
  const T = P.wallT,
    BW = 0.3,
    BT = 0.022,
    BAT = { w: 0.065, t: 0.02 };
  P.yRidge = yT + 0.2 + (P.ridgeZ - P.body.z0) * P.pitch;
  const roofTop = (z) => P.yRidge - Math.abs(z - P.ridgeZ) * P.pitch,
    roofUnder = (z) => roofTop(z) - 0.175;
  const openings = (ctx.r4openings = []);
  // wall list: a -> b with the outside on the right; deck: the wall stands on a deck (siding stops at the floor)
  const WALLS = [
    // SE face (+Z): bedroom, kitchen (over the sink), living room windows, all shuttered (B / D)
    {
      id: 'S',
      a: [-6.5, -3.6],
      b: [6.5, -3.6],
      deck: false,
      ops: [
        { id: 'W_bath', u: 1.8, w: 0.7, sill: 1.35, h: 0.7, kind: 'window', frosted: true }, // r10: bath and bedroom mirrored
        { id: 'W_kit', u: 6.4, w: 1.2, sill: 1.0, h: 1.05, kind: 'window', shutter: true },
        { id: 'W_liv_s', u: 10.35, w: 1.0, sill: 0.85, h: 1.3, kind: 'window', shutter: true },
      ],
    },
    // NW face (-Z, the bay side): the big window behind the sofa (15: bamboo blind), the bathroom window (frosted)
    {
      id: 'N',
      a: [6.5, -10.4],
      b: [-6.5, -10.4],
      deck: false,
      ops: [
        { id: 'W_liv_n', u: 2.7, w: 1.6, sill: 0.95, h: 1.15, kind: 'window', shutter: true },
        { id: 'W_liv_n2', u: 5.6, w: 1.0, sill: 0.85, h: 1.3, kind: 'window', shutter: true },
        { id: 'W_bed_s', u: 11.05, w: 1.0, sill: 0.85, h: 1.3, kind: 'window', shutter: true },
      ],
    },
    // NE gable (+X, back): the slider onto the upper strip and a window (E: the slider, a window with shutters by the chairs)
    {
      id: 'E',
      a: [6.5, -3.6],
      b: [6.5, -10.4],
      deck: true,
      gable: true,
      ops: [
        { id: 'D_slide', u: 5.0, w: 1.9, sill: 0, h: 2.08, kind: 'slider' },
        { id: 'W_back_e', u: 2.0, w: 1.0, sill: 0.85, h: 1.3, kind: 'window', shutter: true },
        { id: 'V_e', u: 3.4, w: 0.5, sill: 3.05, h: 0.5, kind: 'vent' },
      ],
    },
    // SW gable (-X, FRONT): the front door in the middle, a window each side, the small hatch in the gable above the door (B)
    {
      id: 'W',
      a: [-6.5, -10.4],
      b: [-6.5, -3.6],
      deck: true,
      gable: true,
      ops: [
        { id: 'W_bed_f', u: 1.45, w: 1.0, sill: 0.85, h: 1.3, kind: 'window', shutter: true },
        { id: 'D_front', u: 3.4, w: 0.92, sill: 0, h: 2.06, kind: 'door' },
        {
          id: 'W_bath_f',
          u: 5.35,
          w: 0.8,
          sill: 1.0,
          h: 1.0,
          kind: 'window',
          shutter: true,
          frosted: true,
        },
        { id: 'H_gable', u: 3.4, w: 0.62, sill: 2.95, h: 0.72, kind: 'hatch' },
      ],
    },
  ];
  for (const W of WALLS) {
    const [ax, az] = W.a,
      [bx, bz] = W.b,
      L = Math.hypot(bx - ax, bz - az),
      ux = (bx - ax) / L,
      uz = (bz - az) / L,
      nx = -uz,
      nz = ux,
      ry = Math.atan2(-uz, ux);
    const pt = (u, w) => [ax + ux * u + nx * w, az + uz * u + nz * w];
    W.pt = pt;
    W.ry = ry;
    W.L = L;
    W.n = [nx, nz];
    W.u = [ux, uz];
    const yBot = W.deck ? F + 0.004 : F - 0.33,
      topAt = (u) => (W.gable ? roofUnder(pt(u, 0)[1]) - 0.004 : yT + 0.02);
    const ops = W.ops.map((o) => ({
      ...o,
      wall: W,
      y0: F + o.sill,
      y1: F + o.sill + o.h,
      u0: o.u - o.w / 2,
      u1: o.u + o.w / 2,
    }));
    openings.push(...ops);
    const cutOps = ops.filter((o) => o.kind !== 'vent');
    // the core (studs + sheathing), w in [-T + 0.02, 0]: strips between opening edges, sloped top on the gables
    const edges = [...new Set([0, L, ...cutOps.flatMap((o) => [o.u0, o.u1])])].sort(
      (a, b) => a - b,
    );
    for (let i = 0; i < edges.length - 1; i++) {
      const u0 = edges[i],
        u1 = edges[i + 1];
      if (u1 - u0 < 0.005) continue;
      const um = (u0 + u1) / 2;
      const cuts = cutOps.filter((o) => o.u0 < um && o.u1 > um).map((o) => [o.y0, o.y1]);
      for (const [y0, y1] of subtract(yBot, Math.max(topAt(u0), topAt(u1)), cuts)) {
        const top0 = Math.min(y1, topAt(u0)),
          top1 = Math.min(y1, topAt(u1)),
          a0 = pt(u0, -T + 0.02),
          a1 = pt(u1, -T + 0.02),
          b0 = pt(u1, -0.001),
          b1 = pt(u0, -0.001);
        hexa(
          B,
          TEAL,
          [
            [a0[0], y0, a0[1]],
            [a1[0], y0, a1[1]],
            [b0[0], y0, b0[1]],
            [b1[0], y0, b1[1]],
            [a0[0], top0, a0[1]],
            [a1[0], top1, a1[1]],
            [b0[0], top1, b0[1]],
            [b1[0], top0, b1[1]],
          ],
          { color: kit.mul(C.tealDeep, 0.8), wear: 0.2 },
        );
      }
    }
    // siding boards (vertical, BW wide) cut around the openings; battens over every seam, cut around casings and shutters
    const nB = Math.ceil(L / BW);
    for (let i = 0; i < nB; i++) {
      const u0 = (i * L) / nB,
        u1 = ((i + 1) * L) / nB,
        tone = kit.vary(C.teal, r, 0.07),
        wr = 0.06 + r() * 0.26;
      for (const [s0, s1] of subtract(
        u0,
        u1,
        cutOps.map((o) => [o.u0, o.u1]),
        0.004,
      )) {
        const cutsY = cutOps
          .filter((o) => o.u0 < (s0 + s1) / 2 && o.u1 > (s0 + s1) / 2)
          .map((o) => [o.y0, o.y1]);
        for (const [y0, y1] of subtract(yBot, 99, cutsY)) {
          const t0 = Math.min(y1, topAt(s0)),
            t1 = Math.min(y1, topAt(s1));
          if (Math.max(t0, t1) - y0 < 0.02) continue;
          const a0 = pt(s0 + 0.001, 0),
            a1 = pt(s1 - 0.001, 0),
            b0 = pt(s1 - 0.001, BT),
            b1 = pt(s0 + 0.001, BT);
          hexa(
            B,
            TEAL,
            [
              [a0[0], y0, a0[1]],
              [a1[0], y0, a1[1]],
              [b0[0], y0, b0[1]],
              [b1[0], y0, b1[1]],
              [a0[0], t0, a0[1]],
              [a1[0], t1, a1[1]],
              [b0[0], t1, b0[1]],
              [b1[0], t0, b1[1]],
            ],
            { color: tone, wear: wr },
          );
        }
      }
      if (i === 0) continue;
      const u = u0,
        cutsY = cutOps
          .filter(
            (o) =>
              o.u0 - 0.1 - (o.shutter ? o.w / 2 + 0.05 : 0) < u &&
              o.u1 + 0.1 + (o.shutter ? o.w / 2 + 0.05 : 0) > u,
          )
          .map((o) => [o.y0 - 0.12, o.y1 + 0.12]);
      const vc = ops
        .filter((o) => o.kind === 'vent' && o.u0 - 0.06 < u && o.u1 + 0.06 > u)
        .map((o) => [o.y0 - 0.06, o.y1 + 0.06]);
      for (const [y0, y1] of subtract(yBot + 0.004, topAt(u) - 0.01, [...cutsY, ...vc])) {
        const [x, z] = pt(u, BT + BAT.t / 2);
        box(
          TEAL,
          BAT.w,
          y1 - y0,
          BAT.t,
          x,
          (y0 + y1) / 2,
          z,
          {
            grain: 1,
            color: kit.vary(C.teal, r, 0.07),
            wear: 0.08 + r() * 0.25,
            bevel: 0.004,
            skip: 'nz',
          },
          0,
          ry,
        );
      }
    }
    for (const u of [0.05, L - 0.05]) {
      const [x, z] = pt(u, BT + 0.012);
      box(
        TEAL,
        0.12,
        topAt(u) - yBot - 0.02,
        0.024,
        x,
        (topAt(u) + yBot) / 2,
        z,
        { grain: 1, color: kit.vary(C.tealDeep, r, 0.05), wear: 0.5 },
        0,
        ry,
      );
    }
    for (const o of ops) buildOpening(o, W);
  }
  function buildOpening(o, W) {
    const { pt, ry } = W,
      u = o.u,
      yc = (o.y0 + o.y1) / 2,
      h = o.y1 - o.y0,
      cas = 0.09,
      CW = kit.vary(C.white, r, 0.04);
    const atU = (du, w) => pt(u + du, w);
    if (o.kind === 'vent') {
      for (const [du, dy, sx, sy] of [
        [0, h / 2 + 0.03, o.w + 0.12, 0.06],
        [0, -h / 2 - 0.03, o.w + 0.12, 0.06],
        [-o.w / 2 - 0.03, 0, 0.06, h],
        [o.w / 2 + 0.03, 0, 0.06, h],
      ]) {
        const [x, z] = atU(du, BT + BAT.t + 0.02);
        box(WHITE, sx, sy, 0.04, x, yc + dy, z, { color: CW, wear: 0.4 }, 0, ry);
      }
      for (let k = 0; k < 5; k++) {
        const [x, z] = atU(0, BT + BAT.t + 0.02);
        box(
          WHITE,
          o.w,
          0.02,
          0.07,
          x,
          o.y0 + 0.05 + (k * (h - 0.1)) / 4,
          z,
          { color: CW, wear: 0.4 },
          0.6,
          ry,
        );
      }
      return;
    }
    const dep = T + BT + 0.005,
      wc = BT + 0.005 - dep / 2;
    {
      const [x, z] = atU(0, wc);
      box(WHITE, o.w, 0.034, dep, x, o.y1 + 0.013, z, { color: CW, wear: 0.3 }, 0, ry);
      if (o.kind !== 'door' && o.kind !== 'slider')
        box(WHITE, o.w, 0.034, dep, x, o.y0 - 0.013, z, { color: CW, wear: 0.3 }, 0, ry);
    }
    for (const s of [-1, 1]) {
      const [x, z] = atU(s * (o.w / 2 + 0.013), wc);
      box(WHITE, 0.034, h + 0.06, dep, x, yc, z, { color: CW, wear: 0.3 }, 0, ry);
    }
    const isDoor = o.kind === 'door' || o.kind === 'slider';
    for (const s of [-1, 1]) {
      const [x, z] = atU(s * (o.w / 2 + 0.03 + cas / 2), BT + 0.013);
      box(
        WHITE,
        cas,
        h + (isDoor ? 0.03 : 0.16) + 0.06,
        0.026,
        x,
        yc + (isDoor ? 0.03 : 0),
        z,
        { grain: 1, color: o.kind === 'door' ? kit.vary(C.tealDeep, r, 0.05) : CW, wear: 0.55 },
        0,
        ry,
      );
    }
    {
      const [x, z] = atU(0, BT + 0.016);
      box(
        WHITE,
        o.w + 0.06 + cas * 2 + 0.04,
        0.12,
        0.032,
        x,
        o.y1 + 0.03 + 0.06,
        z,
        { color: o.kind === 'door' ? kit.vary(C.tealDeep, r, 0.05) : CW, wear: 0.55 },
        0,
        ry,
      );
      const [x2, z2] = atU(0, BT + 0.045);
      box(
        WHITE,
        o.w + 0.06 + cas * 2 + 0.07,
        0.025,
        0.05,
        x2,
        o.y1 + 0.03 + 0.135,
        z2,
        { color: CW, wear: 0.6 },
        0,
        ry,
      );
    }
    if (o.kind === 'window' || o.kind === 'hatch') {
      const [x, z] = atU(0, BT + 0.03);
      box(
        WHITE,
        o.w + 0.06 + cas * 2 + 0.05,
        0.04,
        0.08,
        x,
        o.y0 - 0.05,
        z,
        { color: CW, wear: 0.65 },
        0,
        ry,
      );
      const [x3, z3] = atU(0, BT + 0.011);
      box(
        WHITE,
        o.w + 0.06 + cas * 2,
        0.08,
        0.022,
        x3,
        o.y0 - 0.11,
        z3,
        { color: CW, wear: 0.55 },
        0,
        ry,
      );
    }
    if (o.kind === 'window') {
      const wS = -T / 2 + 0.01,
        fr = 0.05;
      for (const [y0, y1, k] of [
        [o.y0, yc + 0.02, 0],
        [yc - 0.02, o.y1, 1],
      ]) {
        const ym = (y0 + y1) / 2,
          hh = y1 - y0,
          wk = wS + (k ? 0.03 : -0.01);
        for (const s of [-1, 1]) {
          const [x, z] = atU(s * (o.w / 2 - fr / 2), wk);
          box(PLAST, fr, hh, 0.04, x, ym, z, { color: 0xe9e6dc }, 0, ry);
        }
        for (const yy of [y0 + fr / 2, y1 - fr / 2]) {
          const [x, z] = atU(0, wk);
          box(PLAST, o.w - 2 * fr, fr, 0.04, x, yy, z, { color: 0xe9e6dc }, 0, ry);
        }
        const [gx, gz] = atU(0, wk);
        box(
          GLASS,
          o.w - 2 * fr,
          hh - 2 * fr,
          0.006,
          gx,
          ym,
          gz,
          { color: o.frosted ? 0xdfe6e4 : 0xffffff, bevel: 0 },
          0,
          ry,
        );
      }
    }
    if ((o.kind === 'window' && o.shutter) || o.kind === 'hatch')
      for (const s of o.kind === 'hatch' ? [0] : [-1, 1]) {
        // board-and-batten shutters, open flat beside the casing (windows); the gable hatch is a closed two-batten board door
        const sw = o.kind === 'hatch' ? o.w : o.w / 2 + 0.04,
          du = o.kind === 'hatch' ? 0 : s * (o.w / 2 + 0.03 + cas + 0.02 + sw / 2),
          tone = kit.vary(C.shutter, r, 0.06),
          wsh = o.kind === 'hatch' ? -0.01 : BT + 0.035;
        const nb = o.kind === 'hatch' ? 4 : 3;
        for (let k = 0; k < nb; k++) {
          const [x, z] = atU(du - sw / 2 + (sw * (k + 0.5)) / nb, wsh);
          box(
            DOORP,
            sw / nb - 0.004,
            h + (o.kind === 'hatch' ? -0.01 : 0.1),
            0.022,
            x,
            yc,
            z,
            { grain: 1, color: tone, wear: 0.35 + r() * 0.3 },
            0,
            ry,
          );
        }
        for (const yy of [o.y0 + 0.18, o.y1 - 0.18]) {
          const [x, z] = atU(du, wsh + 0.02);
          box(DOORP, sw - 0.06, 0.09, 0.018, x, yy, z, { grain: 0, color: tone, wear: 0.4 }, 0, ry);
        }
        if (o.kind === 'hatch') {
          const [x, z] = atU(o.w / 2 - 0.1, wsh + 0.035);
          box(STEEL, 0.1, 0.03, 0.02, x, yc, z, { color: 0x3a3a38 }, 0, ry);
        } else
          for (const yy of [o.y0 + 0.2, o.y1 - 0.2]) {
            const [x, z] = atU(s * (o.w / 2 + 0.03 + cas + 0.01), wsh + 0.01);
            box(STEEL, 0.05, 0.025, 0.012, x, yy, z, { color: 0x3a3a38 }, 0, ry);
          }
      }
    if (o.kind === 'door') buildDoor(o, W);
    if (o.kind === 'slider') buildSlider(o, W);
  }
  // ---- the front door: dark painted wood, nine lites in the upper half, hinged, opens inward ----
  function buildDoor(o, W) {
    const g = new THREE.Group();
    g.name = 'r8_frontdoor';
    const hingeU = o.u0 + 0.01,
      [hx, hz] = W.pt(hingeU, -T / 2 + 0.02);
    g.position.set(hx, o.y0, hz);
    g.rotation.y = W.ry;
    Fr.groups.ext.add(g);
    const DB = kit.batch('r8door'),
      w = o.w - 0.02,
      h = o.h - 0.01,
      t = 0.045,
      dk = kit.vary(C.door, r, 0.04),
      bx = (sx, sy, sz, x, y, z, m = DOORP, c = dk) =>
        DB.box(m, sx, sy, sz, M(x, y, z), { color: c, wear: 0.18, bevel: 0.005 });
    bx(0.12, h, t, 0.06, h / 2, 0);
    bx(0.12, h, t, w - 0.06, h / 2, 0);
    bx(w - 0.24, 0.2, t, w / 2, 0.1, 0);
    bx(w - 0.24, 0.14, t, w / 2, h * 0.47, 0);
    bx(w - 0.24, 0.12, t, w / 2, h - 0.06, 0);
    bx(w - 0.24, h * 0.47 - 0.27, t * 0.6, w / 2, (0.2 + h * 0.47 - 0.07) / 2, 0);
    const gy0 = h * 0.47 + 0.07,
      gy1 = h - 0.12,
      gw = w - 0.24,
      gh = gy1 - gy0;
    for (let k = 1; k < 3; k++) {
      bx(0.03, gh, t * 0.8, 0.12 + (gw * k) / 3, (gy0 + gy1) / 2, 0);
      bx(gw, 0.03, t * 0.8, w / 2, gy0 + (gh * k) / 3, 0);
    }
    DB.box(GLASS, gw, gh, 0.006, M(w / 2, (gy0 + gy1) / 2, 0), { color: 0xd8dcdc, bevel: 0 });
    for (const s of [1, -1]) {
      const kz = s * (t / 2 + 0.03);
      lathe(
        DB,
        mat.chrome(),
        [
          [0.001, 0],
          [0.026, 0.004],
          [0.03, 0.02],
          [0.026, 0.036],
          [0.001, 0.04],
        ],
        M(w - 0.07, 0.92, kz - s * 0.02, (s * Math.PI) / 2, 0, 0),
        { color: 0xb8b4aa, seg: 20 },
      );
    }
    DB.build(g);
    const [cx, cz] = W.pt(o.u, -T / 2),
      cl = Fr.col.box(cx, o.y0 + h / 2, cz, o.w, h, 0.08, {
        ry: W.ry,
        tag: 'door',
        id: 'door_front',
      });
    // r12 (user: the front door opens INTO the house): the open leaf has its own collider, swung 1.5 rad into the hall about
    // the hinge; the closed one goes while the leaf is away from the frame, the open one comes once it is nearly open
    const OPEN = 1.5,
      ao = W.ry + OPEN,
      [ox, oz] = [hx + (Math.cos(ao) * w) / 2, hz - (Math.sin(ao) * w) / 2],
      clO = Fr.col.box(ox, o.y0 + h / 2, oz, w, h, 0.06, {
        ry: ao,
        tag: 'door',
        id: 'door_front_open',
        enabled: false,
      });
    const d = { open: false, a: 0 };
    Fr.interact({
      id: 'door_front',
      kind: 'door',
      label: () => (d.open ? 'Close' : 'Open') + ' front door',
      pos: [W.pt(o.u, 0)[0], F + 1.1, W.pt(o.u, 0)[1]],
      radius: 1.6,
      use: () => {
        d.open = !d.open;
      },
    });
    // opens inward: the hinge on the u0 jamb at the wall's inner face; +a turns the leaf's free edge to -n (inside, the hall)
    ctx.updaters.push((dt) => {
      const tgt = d.open ? OPEN : 0;
      if (Math.abs(d.a - tgt) < 1e-3) return;
      d.a += Math.sign(tgt - d.a) * Math.min(Math.abs(tgt - d.a), dt * 2.4);
      g.rotation.y = W.ry + d.a;
      cl.enabled = Math.abs(d.a) < 0.2;
      clO.enabled = Math.abs(d.a - OPEN) < 0.2;
    });
    const [lx, lz] = W.pt(o.u1 + 0.3, BT + 0.08);
    lathe(
      D,
      MP,
      [
        [0.001, 0],
        [0.06, 0.0],
        [0.07, 0.12],
        [0.04, 0.2],
        [0.001, 0.21],
      ],
      M(lx, F + 1.95, lz),
      { color: 0x2a2a28, seg: 16 },
    );
    D.geo(
      mat.emissive(0xffe0b0, 2.2, 'r8porch'),
      new THREE.SphereGeometry(0.035, 12, 8),
      M(lx, F + 1.99, lz),
      {},
    );
    const [plx, plz] = W.pt(o.u1 + 0.3, 0.4);
    const pl = Fr.light({
      id: 'r4_porch',
      pos: [plx, F + 1.9, plz],
      color: 0xffd9a8,
      intensity: 30,
      range: 7,
      on: false,
    });
    ctx.updaters.push((dt, env) => {
      const t2 = env.timeOfDay ?? 12;
      pl.on = t2 < 6.2 || t2 > 18.6;
    });
  }
  // ---- sliding glass doors from the living room onto the upper back strip: white aluminum frame, one leaf slides ----
  function buildSlider(o, W) {
    const g = new THREE.Group();
    g.name = 'r8_slider';
    Fr.groups.ext.add(g);
    const half = o.w / 2,
      wF = -T / 2 + 0.01,
      AL = PLAST,
      aw = 0xe8e6e0;
    const fixed = kit.batch('r8slideF'),
      mov = kit.batch('r8slideM');
    const leaf = (Bt, du, wo) => {
      const m = (sx, sy, sz, ddu, y, mm = AL, c = aw) => {
        const [xx, zz] = W.pt(o.u + du + ddu, wF + wo);
        Bt.box(mm, sx, sy, sz, M(xx, y, zz, 0, W.ry, 0), { color: c, bevel: 0.004 });
      };
      m(0.06, o.h, 0.05, -half / 2 + 0.03, o.y0 + o.h / 2);
      m(0.06, o.h, 0.05, half / 2 - 0.03, o.y0 + o.h / 2);
      m(half - 0.12, 0.1, 0.05, 0, o.y0 + 0.05);
      m(half - 0.12, 0.06, 0.05, 0, o.y1 - 0.03);
      m(half - 0.12, o.h - 0.16, 0.008, 0, o.y0 + 0.1 + (o.h - 0.16) / 2, GLASS, 0xffffff);
      m(0.03, 0.12, 0.03, half / 2 - 0.08, o.y0 + 1.0, PLAST, 0x55534e);
    };
    leaf(fixed, half / 2, -0.03);
    leaf(mov, -half / 2, 0.03);
    {
      const [x, z] = W.pt(o.u, wF);
      fixed.box(AL, o.w, 0.03, T - 0.01, M(x, o.y0 + 0.015, z, 0, W.ry, 0), { color: 0xc9c6bd });
    }
    fixed.build(g);
    const gm = new THREE.Group();
    mov.build(gm);
    g.add(gm);
    const cl = Fr.col.box(
      W.pt(o.u - half / 2, wF)[0],
      o.y0 + o.h / 2,
      W.pt(o.u - half / 2, wF)[1],
      half,
      o.h,
      0.08,
      { ry: W.ry, tag: 'door', id: 'door_slider' },
    );
    Fr.col.box(
      W.pt(o.u + half / 2, wF)[0],
      o.y0 + o.h / 2,
      W.pt(o.u + half / 2, wF)[1],
      half,
      o.h,
      0.08,
      { ry: W.ry, tag: 'window' },
    );
    const d = { open: false, a: 0 },
      [ux, uz] = W.u;
    Fr.interact({
      id: 'door_slider',
      kind: 'door',
      label: () => (d.open ? 'Close' : 'Open') + ' sliding door',
      pos: [W.pt(o.u - half / 2, 0)[0], F + 1.1, W.pt(o.u - half / 2, 0)[1]],
      radius: 1.7,
      use: () => {
        d.open = !d.open;
      },
    });
    ctx.updaters.push((dt) => {
      const tgt = d.open ? half - 0.08 : 0;
      if (Math.abs(d.a - tgt) < 1e-3) return;
      d.a += Math.sign(tgt - d.a) * Math.min(Math.abs(tgt - d.a), dt * 1.6);
      gm.position.set(ux * d.a, 0, uz * d.a);
      cl.enabled = d.a < 0.3;
    });
  }
  // wall colliders: the full wall height, thickness T + 2 cm, cut only at the two doors (windows stay solid: nobody walks through a window)
  for (const W of WALLS) {
    const L = W.L,
      gaps = openings
        .filter((o) => o.wall === W && (o.kind === 'door' || o.kind === 'slider'))
        .map((o) => [o.u0, o.u1]);
    for (const [u0, u1] of subtract(-0.08, L + 0.08, gaps)) {
      const [x, z] = W.pt((u0 + u1) / 2, -T / 2);
      Fr.col.box(x, F + 1.45, z, u1 - u0, 2.9, T + 0.04, { ry: W.ry, tag: 'wall' });
    }
    for (const o of openings.filter(
      (q) => q.wall === W && (q.kind === 'door' || q.kind === 'slider'),
    )) {
      const [x, z] = W.pt(o.u, -T / 2);
      Fr.col.box(x, (o.y1 + yT + 0.3) / 2, z, o.w + 0.02, yT + 0.3 - o.y1, T + 0.04, {
        ry: W.ry,
        tag: 'wall',
      });
    }
  }
  ctx.r4walls = WALLS;

  // ================= roof (gable over the long axis: slopes to the SE 'S' and the NW 'N'; gable ends at the front and the back) =================
  const a = Math.atan(P.pitch),
    ca = Math.cos(a),
    sa = Math.sin(a),
    x0r = P.body.x0 - P.rake,
    x1r = P.body.x1 + P.rake,
    Lr = x1r - x0r;
  const zE = { S: P.body.z1 + P.eave, N: P.body.z0 - P.eave },
    slopeLen = (P.ridgeZ - zE.N) / ca;
  const sp = (side, x, v, hh = 0) => {
    const s = side === 'S' ? 1 : -1,
      z = zE[side] - s * v * ca,
      y = roofTop(zE[side]) + v * sa;
    return [x, y + hh * ca, z + s * hh * sa];
  };
  const slopeRX = (side) => (side === 'S' ? a : -a);
  for (const side of ['S', 'N']) {
    for (let x = P.body.x0 + 0.04; x <= P.body.x1 - 0.03; x += 0.61) {
      const s = side === 'S' ? 1 : -1,
        zr = P.ridgeZ,
        zEv = zE[side] + s * 0.02,
        yA = roofTop(zr) - 0.02 - 0.07 / ca,
        yB = roofTop(zEv) - 0.02 - 0.07 / ca;
      B.strut(WOOD, [x, yA, zr - s * 0.03], [x, yB, zEv], 0.045, 0.14, {
        color: kit.vary(0x9a9284, r, 0.08),
        wear: 0.5,
        bevel: 0.004,
        rand: r,
      });
    }
    for (let x = x0r; x < x1r - 0.01; x += 2.44) {
      const sx = Math.min(2.44, x1r - x);
      const [cx, cy, cz] = sp(side, x + sx / 2, slopeLen / 2, -0.012);
      box(
        PLY,
        sx - 0.006,
        0.019,
        slopeLen - 0.004,
        cx,
        cy,
        cz,
        { color: kit.vary(0x8c7a60, r, 0.1), wear: 0.7, bevel: 0 },
        slopeRX(side),
      );
    }
    {
      const s = side === 'S' ? 1 : -1,
        [fx, fy, fz] = sp(side, (x0r + x1r) / 2, 0, -0.08);
      box(WHITE, Lr + 0.05, 0.19, 0.035, fx, fy - 0.02, fz + s * 0.02, {
        grain: 0,
        color: kit.vary(C.white, r, 0.04),
        wear: 0.6,
      });
    }
    for (const xx of [x0r - 0.018, x1r + 0.018]) {
      const [cx, cy, cz] = sp(side, xx, slopeLen / 2, -0.06);
      box(
        WHITE,
        0.035,
        0.2,
        slopeLen + 0.03,
        cx,
        cy,
        cz,
        { grain: 2, color: kit.vary(C.white, r, 0.04), wear: 0.6 },
        slopeRX(side),
      );
    }
  }
  box(WOOD, Lr, 0.24, 0.045, 0, roofTop(P.ridgeZ) - 0.14, P.ridgeZ, {
    grain: 0,
    color: dark(),
    wear: 0.4,
  });
  // SE slope: 3-tab asphalt shingles, courses lapped, a repair patch near the back with bare felt (01)
  const SH = mat.pbr('scuffed_cement', {
      rep: 0.45,
      gain: 2.6,
      tint: 0xbfc3c8,
      grunge: true,
      nscale: 1.4,
      rlift: 0.35,
    }),
    FELT = mat.matte();
  const patch = (x, v) => x > 2.0 && x < 4.4 && v > 0.9 && v < 2.6 && !(x > 3.9 && v > 2.1);
  {
    const exp = 0.143,
      D0 = 0.19,
      T0 = 0.0085,
      tilt = Math.atan(T0 / D0),
      tabW = 0.333,
      nC = Math.ceil((slopeLen + 0.05) / exp);
    for (let k = 0; k < nC; k++) {
      const v0 = k * exp - 0.02,
        off = ((k % 2) * tabW) / 2,
        toneRow = 0.92 + 0.12 * kit.hash(k, 3);
      for (let x = x0r - off; x < x1r - 0.01; x += tabW) {
        const xa = Math.max(x0r, x),
          xb = Math.min(x1r, x + tabW);
        if (xb - xa < 0.04) continue;
        const xm = (xa + xb) / 2,
          vm = v0 + Math.min(D0, slopeLen - v0) / 2;
        if (patch(xm, vm)) continue;
        const dv = Math.min(D0, slopeLen + 0.02 - v0);
        if (dv < 0.05) continue;
        const loose = r() < 0.012,
          lift = loose ? 0.02 + r() * 0.03 : 0,
          [cx, cy, cz] = sp('S', xm, v0 + dv / 2, T0 + lift * 0.5);
        const tone = kit.mul(
          kit.vary(0x6e7174, r, 0.1),
          toneRow * (r() < 0.06 ? 0.82 : 1) * (r() < 0.04 ? 1.15 : 1),
        );
        box(
          SH,
          xb - xa - 0.005,
          T0,
          dv,
          cx,
          cy,
          cz,
          { color: tone, wear: 0.6 + r() * 0.4, bevel: 0.0025, uv: [r() * 5, r() * 5] },
          a - tilt + (loose ? 0.12 : 0),
          loose ? (r() - 0.5) * 0.2 : 0,
          0,
        );
      }
    }
    {
      const [cx, cy, cz] = sp('S', 3.2, 1.75, 0.0015);
      box(FELT, 2.4, 0.003, 1.7, cx, cy, cz, { color: 0x2a2b2c, wear: 0.9, bevel: 0 }, a);
    }
  }
  // NW slope: standing-seam metal
  {
    const TIN = mat.tin(),
      pw = 0.5,
      n = Math.ceil(Lr / pw);
    for (let i = 0; i < n; i++) {
      const xa = x0r + (i * Lr) / n,
        xb = x0r + ((i + 1) * Lr) / n,
        [cx, cy, cz] = sp('N', (xa + xb) / 2, slopeLen / 2 + 0.01, 0.006);
      box(
        TIN,
        xb - xa - 0.003,
        0.008,
        slopeLen + 0.03,
        cx,
        cy,
        cz,
        {
          color: kit.vary(0xd2d4d4, r, 0.04),
          wear: 0.08 + r() * 0.12,
          bevel: 0.002,
          uv: [i * 0.37, 0],
        },
        slopeRX('N'),
      );
      if (i) {
        const [rx2, ry2, rz2] = sp('N', xa, slopeLen / 2 + 0.01, 0.024);
        box(
          TIN,
          0.02,
          0.032,
          slopeLen + 0.03,
          rx2,
          ry2,
          rz2,
          { color: 0xd8dad9, wear: 0.1, bevel: 0.004 },
          slopeRX('N'),
        );
      }
    }
  }
  {
    const TIN = mat.tin();
    for (const side of ['S', 'N']) {
      const [cx, cy, cz] = sp(side, 0, slopeLen - 0.11, 0.035);
      box(
        TIN,
        Lr + 0.04,
        0.008,
        0.26,
        cx,
        cy,
        cz,
        { color: 0xc8cbcb, wear: 0.25, bevel: 0.002 },
        slopeRX(side),
      );
    }
  }
  for (const side of ['S', 'N']) {
    const [cx, cy, cz] = sp(side, 0, slopeLen / 2, -0.08);
    Fr.col.box(cx, cy, cz, Lr, 0.16, slopeLen, { rx: slopeRX(side), tag: 'roof', surface: 'roof' });
  }
  // gutter and a white downpipe at the east corner (B: the gutter along the SE eave)
  {
    const [gx, gy, gz] = sp('S', 0, 0, -0.12);
    D.cyl(PLAST, 0.055, 0.055, Lr, M(0, gy - 0.07, gz + 0.06, 0, 0, Math.PI / 2), {
      color: 0xdedbd2,
      seg: 10,
    });
    void gx;
    D.cyl(PLAST, 0.04, 0.04, gy - 0.4, M(x1r - 0.25, (gy + 0.4) / 2 - 0.05, gz + 0.06), {
      color: 0xe6e4dc,
      seg: 10,
    });
  }

  // ================= the satellite dish (B): the user's dish (sat_dish.glb) on a galvanized mast clamped to the stair-head post =================
  {
    const px = Bd.x0 + 0.02,
      pz = WK.z1 + 0.13,
      y0 = F - 0.22,
      y1 = F + 1.72,
      GALV = 0x9a9890;
    D.cyl(STEEL, 0.027, 0.027, y1 - y0, M(px, (y0 + y1) / 2, pz), {
      color: GALV,
      seg: 12,
      wear: 0.5,
    });
    for (const yy of [F - 0.12, F + 0.42, F + 0.92])
      box(STEEL, 0.2, 0.035, 0.2, Bd.x0, yy, WK.z1 + 0.04, { color: 0x86847c, bevel: 0.004 });
    D.cyl(STEEL, 0.031, 0.031, 0.02, M(px, y1 + 0.01, pz), { color: 0x7d7b74, seg: 12 });
    // aims south-south-west over the drive (the dish's face toward the viewer-left in B): H heading
    const aimRy = Math.PI * 0.75 + 0.35;
    glb(kit, 'sat_dish.glb', {
      pos: [px + 0.05, y1 - 0.62, pz + 0.02],
      ry: aimRy,
      mat: (m) => {
        m.color.lerp(new THREE.Color(0xcfccc0), 0.5);
        m.roughness = Math.max(0.6, m.roughness ?? 0.6);
      },
    }).then((g) => {
      if (g) Fr.groups.ext.add(g);
    });
    D.tube(
      RUB,
      [
        [px + 0.03, y1 - 0.45, pz + 0.01],
        [px + 0.032, F + 0.1, pz + 0.012],
        [px + 0.035, y0 + 0.02, pz + 0.01],
        [px + 0.2, y0 - 0.03, pz - 0.15],
      ],
      0.006,
      { seg: 5, color: 0x151515, steps: 40 },
    );
    Fr.col.box(px, F + 0.8, pz, 0.1, 1.9, 0.1, { tag: 'pole' });
  }
  // ================= service mast on the east end of the NW wall, the drop goes out to the pole (B: the wire from the east corner) =================
  {
    const mx = 5.6,
      mz = Bd.z0 - 0.12,
      my0 = F + 1.2,
      my1 = roofTop(mz) + 1.1;
    D.cyl(mat.steel(), 0.032, 0.032, my1 - my0, M(mx, (my0 + my1) / 2, mz), {
      color: 0x9c9a93,
      seg: 10,
    });
    lathe(
      D,
      mat.metalPaint(),
      [
        [0.001, 0],
        [0.06, 0.02],
        [0.07, 0.08],
        [0.001, 0.1],
      ],
      M(mx, my1, mz, Math.PI, 0, 0),
      { color: 0x333331, seg: 12 },
    );
    box(MP, 0.28, 0.42, 0.14, mx, my0 - 0.25, mz - 0.02, { color: 0x8e918c, bevel: 0.01 });
    ctx.r8service = { x: mx, y: my1 - 0.05, z: mz };
  }

  // ================= the hoop (r13, user Nov 19 night: "pinned, mounted on the edge of the house", refs r4/10, r4/13) =================
  // bolted to the outer face of the SE edge beam over the under-house passage, between the main stair's foot and the post by the
  // annex, the backboard facing SE (+Z) over the driveway. The beam's underside is at ~3.04 m, so the board hangs from it with its
  // top tucked under the floor line and the rim lands at ~3.03 m (near regulation). The freestanding pole hoop of r12 by the back
  // stair is gone.
  buildEdgeHoop();

  // the backboard, rim and net on the SE edge beam (P.hoop: x = board center, z = the beam's center line)
  function buildEdgeHoop() {
    const H = P.hoop,
      boardH = 0.72,
      boardW = 1.12,
      boardTop = F - 0.03, // just under the floor boards' edge
      boardY = boardTop - boardH / 2,
      beamFace = H.z + 0.08, // outer (+Z) face of the 0.16 m beam
      spacer = 0.06,
      boardZ = beamFace + spacer + 0.0175, // board center (0.035 thick)
      boardFront = boardZ + 0.0175,
      rimY = boardTop - boardH + 0.15,
      rimR = 0.23,
      rimZ = boardFront + 0.05 + rimR,
      BBm = mat.paint({ peel: 'a', fade: 0.4, gloss: 0.6, scale: 0.5 });
    // two 2x4 spacer blocks lag-bolted to the beam (the board stands off the beam face), with their bolt heads
    for (const dx of [-0.38, 0.38]) {
      box(WOOD, 0.09, boardH - 0.1, spacer, H.x + dx, boardY, beamFace + spacer / 2, {
        grain: 1,
        color: dark(),
        wear: 0.5,
      });
      for (const dy of [0.2, -0.2])
        D.cyl(
          STEEL,
          0.012,
          0.012,
          0.03,
          M(H.x + dx, boardY + dy, boardFront + 0.01, Math.PI / 2, 0, 0),
          {
            color: 0x7d7f7a,
            seg: 6,
          },
        );
    }
    // backboard (weathered white), the black border and shooter's square
    box(BBm, boardW, boardH, 0.035, H.x, boardY, boardZ, { color: 0xe8e5dc, wear: 0.45 });
    const lineZ = boardFront + 0.003;
    const lines = [
      // [dx, dy, sx, sy]: the outer border, then the shooter's square above the rim
      [0, boardH / 2 - 0.03, boardW - 0.04, 0.04],
      [0, -boardH / 2 + 0.03, boardW - 0.04, 0.04],
      [-boardW / 2 + 0.03, 0, 0.04, boardH - 0.04],
      [boardW / 2 - 0.03, 0, 0.04, boardH - 0.04],
      [0, rimY - boardY + 0.42, 0.58, 0.04],
      [0, rimY - boardY + 0.04, 0.58, 0.04],
      [-0.27, rimY - boardY + 0.23, 0.04, 0.42],
      [0.27, rimY - boardY + 0.23, 0.04, 0.42],
    ];
    for (const [dx, dy, sx, sy] of lines)
      box(mat.plastic(), sx, sy, 0.006, H.x + dx, boardY + dy, lineZ, {
        color: 0x262626,
        bevel: 0.001,
      });
    // rim (orange), its bracket plate on the board, and the net
    D.geo(
      mat.metalPaint(),
      new THREE.TorusGeometry(rimR, 0.009, 8, 32),
      M(H.x, rimY, rimZ, Math.PI / 2, 0, 0),
      { color: 0xd2531f },
    );
    box(MP, 0.16, 0.12, 0.06, H.x, rimY - 0.03, boardFront + 0.03, { color: 0xd2531f });
    for (let k = 0; k < 12; k++) {
      const a1 = (k / 12) * 6.283,
        a2 = a1 + 0.5,
        pts = [
          [H.x + Math.cos(a1) * 0.22, rimY, rimZ + Math.sin(a1) * 0.22],
          [H.x + Math.cos(a2) * 0.17, rimY - 0.2, rimZ + Math.sin(a2) * 0.17],
          [H.x + Math.cos(a1 + 1.0) * 0.13, rimY - 0.4, rimZ + Math.sin(a1 + 1.0) * 0.13],
        ];
      D.tube(mat.fabric('wool_boucle', { rep: 0.05 }), pts, 0.004, {
        seg: 4,
        color: 0xe5e2da,
        steps: 10,
      });
    }
    Fr.col.box(H.x, boardY, boardZ, boardW, boardH, 0.06, { tag: 'prop' });
    // shooting spot 4 m out on the driveway, facing the rim (-Z)
    Fr.anchor('hoop', H.x, 0, rimZ + 4.0, Math.PI);
    Fr.anchor('hoopRim', H.x, rimY, rimZ, Math.PI);
  }

  // ================= anchors, interior visibility, camera occluder =================
  Fr.anchor('carport', 0, 0.06, -8.5, Math.PI);
  Fr.anchor('front', Bd.x0 - 6, 0, -7, -Math.PI / 2);
  Fr.anchor('truckR4', -3.0, 0, 9.5, -2.76); // G: nose in toward the front walkway corner, right of the B / D sight line
  // the spawn stays where it was in the yard (site frame; turning it with the house put it on the yellow ute's spot), facing
  // the front door
  {
    // front-door view (Nov 19): on the drive beside the pickup's nose (the pickup now stands where the spawn was)
    const sx = -8.79,
      sz = 1.97,
      [dx, dz] = BtoH(Bd.x0 - 0.5, -7);
    frame(ctx, 'site').anchor('spawnYard', sx, 0, sz, Math.atan2(dx - sx, dz - sz));
  }
  const camS = new THREE.Vector3();
  ctx.lookIn = (cx, cy, cz) => {
    const [sx, sz] = HtoB(...StoH(...toS(cx, cz)));
    camS.set(sx, cy, sz);
    return (
      (inR(P.body, sx, sz, 1.4) && cy > F - 1.4) ||
      (inR({ x0: WK.x0, x1: P.lower.x1, z0: P.lower.z0, z1: WK.z1 }, sx, sz, 2.0) && cy > F - 1.6)
    );
  };
  ctx.facing = (dir, cx, cz) => {
    if (!dir) return true;
    const [sx, sz] = HtoB(...StoH(...toS(cx, cz)));
    if (inR(P.body, sx, sz, 0.2)) return true;
    const [d0, d1] = HtoB(...StoH(...toS(0, 0))),
      [d2, d3] = HtoB(...StoH(...toS(dir.x, dir.z))),
      dx = d2 - d0,
      dz = d3 - d1,
      hx = 0 - sx,
      hz = -7 - sz;
    return dx * hx + dz * hz > -0.35 * Math.hypot(hx, hz);
  };
  ctx.buildOccluder = () => {
    const ob = kit.batch('r8occ'),
      m = new THREE.MeshBasicMaterial({ visible: false });
    m.name = 'nh:occluder';
    m.userData.uvScale = 1;
    ob.box(m, Bd.x1 - Bd.x0, yT - F, Bd.z1 - Bd.z0, M(0, (F + yT) / 2, (Bd.z0 + Bd.z1) / 2), {});
    for (const R of [WK, UP])
      ob.box(
        m,
        R.x1 - R.x0,
        0.3,
        R.z1 - R.z0,
        M((R.x0 + R.x1) / 2, F - 0.15, (R.z0 + R.z1) / 2),
        {},
      );
    for (const side of ['S', 'N']) {
      const [cx, cy, cz] = sp(side, 0, slopeLen / 2, -0.05);
      ob.box(m, Lr, 0.12, slopeLen, M(cx, cy, cz, slopeRX(side)), {});
    }
    // r8 (SPEC: beams must not be clipped through): the joists / beams under the decks and the house are in the camera's ray test too
    ob.box(
      m,
      BX1 - BX0,
      0.55,
      Bd.z1 - Bd.z0 + 0.2,
      M((BX0 + BX1) / 2, beamBot + 0.28, (Bd.z0 + Bd.z1) / 2),
      {},
    );
    const out = ob.build(Fr.groups.ext, { cast: false, receive: false })[0];
    if (out) {
      out.name = 'nh_occluder';
      out.frustumCulled = false;
    }
    return out;
  };
  Fr.build();
}
