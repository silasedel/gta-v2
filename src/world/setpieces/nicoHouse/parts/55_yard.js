// Nico's house, part 55 (track: keys): the front yard and the street corner from the front-deck mock-up
// (docs/v2/plan/nico_house/0_front_deck_mockup.webp). Everything is hand placed in ../yard.data.js (house-local meters):
// the white lattice planter box on the street side (its bougainvillea grows in part 50), bins at the curb in pairs, the
// all-way STOP at the T corner, wooden utility poles with sagging wires, the red roll-off dumpster with the tear-out around it,
// pale limestone boulders along the frontage, clutter (pallets, drywall, lumber, buckets, a tire, cinder blocks, a cooler and
// resin chairs, coconut husks, a tarp), and the yard surface: tire ruts, leaf litter and matted grass patches, and puddles that
// grow after rain. Library models: the user's (public/assets/models/keys, street kit STOP plates); the rest is built here.
// Colliders follow the visible shapes (planter, bins, poles, signs, dumpster, rocks, pallets, chairs).
import {
  PLANTER,
  BINS,
  STOPS,
  POLES,
  WIRES,
  WIRE_ENDS,
  DUMPSTER,
  ROCKS,
  DEBRIS,
  PUDDLES,
  TRACKS,
  LITTER,
  CAR_SPOTS,
  CORNER_PUDDLE,
  STICKS,
  DRIVE,
} from '../yard.data.js';
import { loadKeysModels } from '../models.js';
import { R4, R8, toS, plantClear } from '../r4/plan4.js';
// r7: nothing of the yard dressing inside the r4 house footprint, its stairs or the canal (the house is square to the lot since r7)
const r4Blocked = (x, z, pad = 0.4) => R4 && plantClear(...toS(x, z), pad);
import { breakables } from '../../../miami/breakables.js';
export const order = 55;

export function build(ctx) {
  const { THREE, kit, mat, col } = ctx,
    B = ctx.site,
    D = ctx.site,
    M = kit.M, // one batch: a material shared by poles, clutter and decals is one draw call, not two
    PI = Math.PI,
    r = kit.rng(5501);
  const V = (c, a = 0.06) => kit.vary(c, r, a),
    rs = (a = 1) => (r() - 0.5) * 2 * a;
  const PEEL = mat.paint({ peel: 'b', fade: 0.32 }),
    W = mat.wood(),
    CONC = mat.concrete(),
    PLG = mat.plasticGloss(),
    PL = PLG,
    ST = mat.steel(),
    MATTE = mat.matte(),
    RUB = MATTE;
  ctx.anchors.carSpots = CAR_SPOTS.map((c) => ({ ...c, pos: new THREE.Vector3(c.x, 0, c.z) }));
  // r2-keys: every prop stands on what is under it: the yard sheet's swells (part 05 ctx.yardY) or, off the sheet, the terrain
  const yG = ctx.yardY || (() => 0),
    gT = ctx.opts.groundAt || (() => 0),
    yS = (x, z) => Math.max(yG(x, z), gT(x, z));
  // roll-off pose (QA first-minutes #9): stepped east into the yard until no corner is within 0.4 m of the asphalt, and set flat on its
  // rails at the lowest corner's ground (it sat on its center height, so on the sloping verge one end hung in the air)
  const DP = (() => {
    const d = DUMPSTER,
      rd = ctx.opts.roadDist || (() => 25),
      hw = (3.26 * d.scale) / 2 + 0.1,
      hl = (8.81 * d.scale) / 2 + 0.1,
      c = Math.cos(d.heading),
      sn = Math.sin(d.heading);
    const corners = (x, z) =>
      [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ].map(([a, b]) => [x + a * hw * c + b * hl * sn, z - a * hw * sn + b * hl * c]);
    let x = d.x;
    for (let k = 0; k < 16 && corners(x, d.z).some(([px, pz]) => rd(px, pz) < 0.4); k++) x += 0.25;
    return {
      x,
      z: d.z,
      y: Math.min(...[...corners(x, d.z), [x, d.z]].map(([px, pz]) => yS(px, pz))) - 0.02,
      dx: x - d.x,
    };
  })();
  ctx.stats.dumpsterShift = +DP.dx.toFixed(2);

  // ======================================================================= lattice planter box
  {
    let oy = 0;
    const MY = (x, y, z, ...a) => M(x, y + oy, z, ...a);
    const H = PLANTER.h,
      Dp = PLANTER.depth,
      white = () => ({ color: V(0xe6e1d2, 0.04), wear: 0.35 + r() * 0.35, bevel: 0.003, rand: r });
    const lattice = (base, len, h) => {
      // diagonal strips, two layers, on a panel of length len (local +X) and height h, facing local +Z
      const sp = 0.105 * Math.SQRT2,
        L = (x, y, z, rz = 0) => kit.mulM(base, M(x, y, z, 0, 0, rz));
      for (const s of [-1, 1])
        for (let c = -h; c < len; c += sp) {
          let xa = s > 0 ? c : c + h,
            ya = 0,
            xb = s > 0 ? c + h : c,
            yb = h;
          if (xa < 0) {
            ya += -xa;
            xa = 0;
          }
          if (xa > len) {
            ya += xa - len;
            xa = len;
          }
          if (xb > len) {
            yb -= xb - len;
            xb = len;
          }
          if (xb < 0) {
            yb -= -xb;
            xb = 0;
          }
          const l = Math.hypot(xb - xa, yb - ya);
          if (l < 0.06 || r() < 0.03) continue;
          B.box(
            PEEL,
            l,
            0.034,
            0.007,
            L((xa + xb) / 2, (ya + yb) / 2, s * 0.0045, Math.atan2(yb - ya, xb - xa)),
            { grain: 0, ...white(), bevel: 0 },
          );
        }
    };
    for (const [ax, az, bx, bz] of PLANTER.runs) {
      const len = Math.hypot(bx - ax, bz - az),
        ry = Math.atan2(-(bz - az), bx - ax),
        nx = Math.sin(ry),
        nz = Math.cos(ry),
        cx = (ax + bx) / 2,
        cz = (az + bz) / 2;
      oy = Math.min(yG(ax, az), yG(bx, bz), yG(cx, cz)) - 0.02;
      // outer face (toward the street, +normal side) and inner face, a cap rail, corner posts, soil
      for (const side of [1, -1]) {
        const ox = (nx * side * Dp) / 2,
          oz = (nz * side * Dp) / 2;
        lattice(MY(ax + ox, 0.06, az + oz, 0, ry + (side < 0 ? 0 : 0), 0), len, H - 0.12);
        B.box(PEEL, len, 0.09, 0.035, MY(cx + ox, H - 0.02, cz + oz, 0, ry, 0), {
          grain: 0,
          ...white(),
        });
        B.box(PEEL, len, 0.07, 0.035, MY(cx + ox, 0.05, cz + oz, 0, ry, 0), {
          grain: 0,
          ...white(),
          wear: 0.8,
        });
      }
      B.box(PEEL, len + 0.06, 0.035, Dp + 0.08, MY(cx, H + 0.03, cz, 0, ry, 0), {
        grain: 0,
        ...white(),
      }); // cap
      for (const t of [0, 1])
        for (const side of [1, -1])
          B.box(
            PEEL,
            0.07,
            H + 0.04,
            0.07,
            MY(
              ax + (bx - ax) * t + (nx * side * Dp) / 2,
              (H + 0.04) / 2,
              az + (bz - az) * t + (nz * side * Dp) / 2,
              0,
              ry,
              0,
            ),
            { grain: 1, ...white() },
          );
      B.box(CONC, len - 0.05, 0.04, Dp - 0.06, MY(cx, H - 0.1, cz, 0, ry, 0), {
        color: [0.32, 0.25, 0.18],
      }); // potting soil (dark, damp)
      B.box(CONC, len - 0.08, H - 0.18, Dp - 0.12, MY(cx, (H - 0.18) / 2, cz, 0, ry, 0), {
        color: 0x3a3028,
        wear: 1,
      }); // liner, dark behind the lattice
      col.box(cx, H / 2 + oy, cz, len + 0.06, H + 0.06, Dp + 0.08, { ry, tag: 'planter' });
    }
  }

  // ======================================================================= galvanized can (own model) for BINS with can: 'galv'
  // r2-keys (Nov 17 pm): the user's galvanized can with lid (Trash Can 7 -> keys/galv_can.glb); the hand-built can is the fallback
  const LIBGALV = true;
  const DYNBINS =
    R8 &&
    !!ctx.opts.game?.world &&
    !(typeof location !== 'undefined' && /[?&]dynbins=0\b/.test(location.search)); // r8 (SPEC: hitting a bin must not explode it into blocks): real rigid-body bins
  for (const b of BINS)
    if (b.can === 'galv' && LIBGALV && !DYNBINS) {
      const gy = yG(b.x, b.z);
      (ctx.libProps ||= []).push(['galv_can', M(b.x, gy, b.z, 0, (b.h || 0) + b.x * 1.7, 0)]);
      col.cyl(b.x, 0.38 + gy, b.z, 0.28, 0.76, { tag: 'bin' });
    }
  for (const b of BINS)
    if (b.can === 'galv' && !LIBGALV) {
      const x = b.x,
        z = b.z,
        gy = yG(x, z),
        M = (x2, y2, z2, ...a) => kit.M(x2, y2 + gy, z2, ...a);
      D.geo(ST, new THREE.CylinderGeometry(0.27, 0.24, 0.72, 18, 3, true), M(x, 0.37, z), {
        color: 0xa4a7a1,
        wear: 0.6,
      });
      for (const y of [0.16, 0.38, 0.6])
        D.geo(
          ST,
          new THREE.TorusGeometry(0.255 + y * 0.03, 0.009, 4, 24),
          M(x, y, z, PI / 2, 0, 0),
          { color: 0x9a9d97 },
        );
      D.cyl(ST, 0.24, 0.24, 0.01, M(x, 0.02, z), { color: 0x6b6d68 });
      D.geo(
        ST,
        new THREE.CylinderGeometry(0.29, 0.29, 0.05, 18),
        M(x + 0.06, 0.765, z - 0.03, 0.12, 0.3, 0.06),
        { color: 0xb0b2ac },
      ); // lid ajar
      D.box(ST, 0.12, 0.03, 0.02, M(x + 0.06, 0.81, z - 0.03, 0.12, 0.3, 0.06), {
        color: 0x8f918c,
      });
      col.cyl(x, 0.38 + gy, z, 0.28, 0.76, { tag: 'bin' });
    }

  // ======================================================================= utility poles and wires
  const poleTop = [];
  // r2-keys (Nov 17 pm): the poles are the user's library model (Models/Utility Poles/Utility Pole 1, crossarm with three insulators,
  // tools/v2/keys/build_models.sh -> keys/utility_pole.glb: 6 m, arm 2 m, pole axis 0.183 m off its footprint center), scaled to
  // a ~2.7 m arm and stretched so the arm sits where the code-built one did; wires hang from its insulator tops
  const PS = 1.35,
    PZ = -0.183 * PS,
    POLE_M = [];
  POLES.forEach(([x, z, h0, lean, arm], i) => {
    const gy = yS(x, z),
      h = h0 + gy; // h: crossarm height above the yard grade
    const ry = arm ?? 0.31 + i * 0.05; // cross arms square to the wires
    const sy = (h0 - 0.35) / 5.906;
    POLE_M.push(M(x - PZ * Math.sin(ry), gy - 0.06, z - PZ * Math.cos(ry), 0, ry, 0, PS, sy, PS));
    const ins = [];
    for (const s of [-1.0, 0, 1.0])
      ins.push([
        x + Math.cos(ry) * s * 0.95 * PS,
        gy - 0.06 + (s ? 5.99 : 6.0) * sy + 0.02,
        z - Math.sin(ry) * s * 0.95 * PS,
      ]);
    if (i === 0) {
      B.cyl(mat.metalPaint(), 0.22, 0.22, 0.75, M(x + 0.3, h - 1.6, z + 0.12), {
        color: 0x7d8486,
        seg: 16,
      });
      B.cyl(mat.metalPaint(), 0.23, 0.23, 0.04, M(x + 0.3, h - 1.2, z + 0.12), {
        color: 0x6d7476,
        seg: 16,
      });
    }
    B.box(mat.metalPaint(), 0.1, 0.16, 0.02, M(x, gy + 1.9, z + 0.09, 0, 0, 0), {
      color: 0xc9b23a,
    }); // pole tag (on the library pole face)
    if (i === 0) {
      // street lamp over the corner (mock-up): a pipe arm toward the junction and a gray cobra head
      const la = Math.atan2(-20.9 - x, 23.8 - z),
        ax = Math.sin(la),
        az = Math.cos(la),
        y0 = h - 2.6;
      B.tube(
        ST,
        [
          [x + ax * 0.12, y0, z + az * 0.12],
          [x + ax * 0.9, y0 + 0.45, z + az * 0.9],
          [x + ax * 1.9, y0 + 0.6, z + az * 1.9],
        ],
        0.03,
        { seg: 6, color: 0x8a8c88 },
      );
      B.geo(
        mat.metalPaint(),
        new THREE.SphereGeometry(0.2, 12, 6, 0, PI * 2, 0, PI / 2),
        M(x + ax * 2.1, y0 + 0.62, z + az * 2.1, 0, la, 0, 1.0, 0.55, 1.9),
        { color: 0x9a9c98 },
      );
      B.geo(
        mat.emissive(0xfff0d0, 1.2, 'streetlamp'),
        new THREE.CircleGeometry(0.15, 12),
        M(x + ax * 2.1, y0 + 0.6, z + az * 2.1, PI / 2, 0, la, 0.9, 1.6, 1),
        {},
      );
    }
    poleTop.push(ins);
    col.cyl(x, gy + h0 / 2, z, 0.15, h0 + 0.4, { tag: 'pole' });
  });
  const ends = WIRE_ENDS;
  for (const w of WIRES) {
    const A = poleTop[w.a],
      Bn = typeof w.b === 'number' ? poleTop[w.b] : ends[w.b];
    if (!A || !Bn) continue;
    for (let k = 0; k < Math.min(w.n, A.length, Bn.length); k++) {
      const a = A[k],
        b = Bn[k],
        pts = [];
      for (let i = 0; i <= 14; i++) {
        const t = i / 14;
        pts.push([
          a[0] + (b[0] - a[0]) * t,
          a[1] + (b[1] - a[1]) * t - w.sag * (1 + k * 0.08) * 4 * t * (1 - t),
          a[2] + (b[2] - a[2]) * t,
        ]);
      }
      B.tube(RUB, pts, 0.011, { seg: 4, color: 0x1b1b1b });
    }
  }

  // ======================================================================= satellite dish (mock-up: a big round dish low at the left edge of the deck view)
  // a real offset-free prime-focus dish: parabolic reflector (closed lathe, so it reads from both sides), feed arm to the LNB at the
  // focus, back bracket to a short mast clamped to the porch-front rail post
  if (!R4) {
    const F = ctx.plan.F,
      mx = -7.32,
      mz = 5.06,
      R = 0.4,
      f = 0.32,
      MD = mat.metalPaint(),
      V3 = THREE.Vector3; // r7: r3 only (the r4 house has its own dish; this one floated on a mast in the drive)
    const pts = [];
    for (let k = 0; k <= 10; k++) {
      const r = (R * k) / 10;
      pts.push(new THREE.Vector2(r, (r * r) / (4 * f)));
    }
    for (let k = 10; k >= 0; k--) {
      const r = ((R * k) / 10) * 0.985;
      pts.push(new THREE.Vector2(r, (r * r) / (4 * f) - 0.018));
    }
    const dg = new THREE.LatheGeometry(pts, 32);
    const axis = new V3(-0.32, 0.72, 0.62).normalize(),
      q = new THREE.Quaternion().setFromUnitVectors(new V3(0, 1, 0), axis);
    const c = new V3(mx - 0.05, F + 0.78, mz + 0.34),
      mD = new THREE.Matrix4().compose(c, q, new V3(1, 1, 1));
    B.geo(MD, dg, mD, { color: 0xcfcdc5, wear: 0.55 });
    dg.dispose();
    const at = (x, y, z) => new V3(x, y, z).applyQuaternion(q).add(c),
      rim = at(0, (R * R) / (4 * f), -R * 0.96),
      foc = at(0, f, 0),
      back = at(0, -0.05, 0);
    B.rod(ST, [rim.x, rim.y, rim.z], [foc.x, foc.y, foc.z], 0.011, { color: 0x8f918c });
    B.box(PLG, 0.07, 0.11, 0.07, M(foc.x, foc.y, foc.z, 0, 0, 0), { color: 0xdedcd4, bevel: 0.01 });
    B.rod(ST, [back.x, back.y, back.z], [mx, F + 0.72, mz], 0.022, { color: 0x8f918c }); // bracket to the mast
    B.cyl(ST, 0.024, 0.024, 0.95, M(mx, F + 0.5, mz), { color: 0x8f918c, seg: 10 }); // short mast on the rail post
    for (const y of [F + 0.2, F + 0.86])
      B.box(ST, 0.07, 0.05, 0.07, M(mx, y, mz), { color: 0x7d7f7a }); // U-bolt clamps
    B.tube(
      RUB,
      [
        [foc.x, foc.y - 0.05, foc.z],
        [mx + 0.02, F + 0.9, mz],
        [mx + 0.03, F + 0.1, mz + 0.02],
      ],
      0.004,
      { seg: 4, color: 0x1a1a1a },
    ); // coax
    col.box(c.x, c.y, c.z, 0.85, 0.85, 0.5, { tag: 'prop' });
  }

  // ======================================================================= debris and clutter (own models)
  const wood = () => ({
    color: V(r() < 0.3 ? 0xb39a74 : 0x8f8676, 0.1),
    wear: 0.5 + r() * 0.4,
    bevel: 0.004,
    rand: r,
  });
  const LIBP = []; // library props placed with the keys models below (r2-keys Nov 17 pm: the user's cooler set and patio chair)
  for (const d of DEBRIS) {
    if (r4Blocked(d.x, d.z, 0.8)) continue;
    const x = d.x,
      z = d.z,
      h = d.h || 0,
      y0 = (d.y || 0) + yS(x, z),
      base = M(x, y0, z, d.tilt || 0, h, 0),
      L = (lx, ly, lz, a = 0, b = 0, c = 0, s = 1) =>
        kit.mulM(base, M(lx, ly, lz, a, b, c, s, s, s));
    if (d.k === 'pallet') {
      for (const lz of [-0.45, 0, 0.45])
        D.box(W, 1.2, 0.022, 0.1, L(0, 0.011, lz), { grain: 0, ...wood() });
      for (const lx of [-0.55, 0, 0.55])
        D.box(W, 0.09, 0.09, 1.0, L(lx, 0.067, 0), { grain: 2, ...wood() });
      for (let k = 0; k < 7; k++)
        if (r() > 0.1)
          D.box(W, 1.2, 0.02, 0.1, L(0, 0.122, -0.45 + k * 0.15, 0, 0, rs(0.01)), {
            grain: 0,
            ...wood(),
          });
      col.box(x, y0 + 0.07, z, 1.2, 0.14, 1.0, { ry: h, tag: 'prop' });
    } else if (d.k === 'drywall') {
      D.box(MATTE, 1.2, 0.013, 0.86, L(0, 0.02, 0, 0.05, 0, rs(0.08)), {
        color: V(0xd8d4cb, 0.03),
      });
      D.box(MATTE, 0.5, 0.013, 0.4, L(0.5, 0.05, 0.4, rs(0.3), 0.4, 0.2), { color: 0xcfcac0 });
    } else if (d.k === 'lumber') {
      for (let k = 0; k < 7; k++)
        D.box(
          W,
          2.4 + rs(0.8),
          0.09,
          0.04,
          L(rs(0.2), 0.045 + (k % 3) * 0.09, -0.15 + (k % 4) * 0.08, 0, rs(0.06), 0),
          { grain: 0, color: V(0xc9b28a, 0.08), wear: 0.3 },
        );
      col.box(x, 0.15, z, 2.6, 0.3, 0.4, { ry: h, tag: 'prop' });
    } else if (d.k === 'bucket') {
      const c = d.color ?? 0xece8de;
      D.geo(PL, new THREE.CylinderGeometry(0.15, 0.13, 0.36, 16, 1, true), L(0, 0.18, 0), {
        color: c,
      });
      D.cyl(PL, 0.13, 0.13, 0.01, L(0, 0.01, 0), { color: kit.mul(c, 0.7) });
      D.geo(ST, new THREE.TorusGeometry(0.15, 0.004, 4, 16, PI), L(0, 0.36, 0, 0, 0, 0.4), {
        color: 0x9a9a96,
      });
    } else if (d.k === 'tire') {
      D.geo(RUB, new THREE.TorusGeometry(0.29, 0.1, 10, 22), L(0, 0.1, 0, PI / 2, 0, 0, 1), {
        color: 0x1d1d1c,
      });
      col.cyl(x, 0.1, z, 0.39, 0.2, { tag: 'prop' });
    } else if (d.k === 'cinder') {
      const cb = (lx, ly, lz, a) => {
        D.box(CONC, 0.39, 0.19, 0.19, L(lx, ly, lz, 0, a, 0), {
          color: V(0xa7a39a, 0.05),
          wear: 0.9,
          bevel: 0.01,
        });
      };
      cb(0, 0.095, 0, 0);
      cb(0.42, 0.095, 0.05, 0.1);
      cb(0.2, 0.285, 0.02, -0.15);
    } else if (d.k === 'cooler') {
      LIBP.push(['coolers', base]);
      col.box(x, y0 + 0.19, z, 1.35, 0.38, 0.42, { ry: h, tag: 'prop' }); // a big white chest and a small faded red one side by side
    } else if (d.k === 'chair' && !d.tipped) {
      // weathered wood patio chair (library)
      LIBP.push(['patio_chair', base]);
      col.box(x, y0 + 0.45, z, 0.8, 0.9, 0.64, { ry: h, tag: 'prop' });
    } else if (d.k === 'chair') {
      // white resin patio chair (tipped: lying on its back)
      const cb = d.tipped ? kit.mulM(base, M(0, 0.42, 0, -PI / 2 + 0.1, 0, 0)) : base,
        C2 = (lx, ly, lz, a = 0, b = 0, c = 0) => kit.mulM(cb, M(lx, ly, lz, a, b, c));
      const c = V(0xeeeae0, 0.03);
      D.box(PLG, 0.46, 0.03, 0.44, C2(0, 0.42, 0), { color: c, bevel: 0.015 });
      D.box(PLG, 0.46, 0.5, 0.03, C2(0, 0.7, -0.21, -0.18, 0, 0), { color: c, bevel: 0.015 });
      for (const [lx, lz] of [
        [-0.21, -0.19],
        [0.21, -0.19],
        [-0.21, 0.2],
        [0.21, 0.2],
      ])
        D.box(PLG, 0.04, 0.42, 0.04, C2(lx, 0.21, lz), { color: c, bevel: 0.01 });
      for (const s of [-1, 1])
        D.box(PLG, 0.04, 0.03, 0.44, C2(s * 0.24, 0.62, 0), { color: c, bevel: 0.01 });
      col.box(x, d.tipped ? 0.25 : 0.45, z, 0.5, d.tipped ? 0.5 : 0.9, 0.5, { ry: h, tag: 'prop' });
    } else if (d.k === 'husks') {
      for (let k = 0; k < 6; k++) {
        const a = r() * 6.28,
          rr = r() * 0.5;
        D.geo(
          MATTE,
          new THREE.SphereGeometry(0.13, 9, 6),
          L(Math.cos(a) * rr, 0.07, Math.sin(a) * rr, rs(0.4), r() * 6, 0, 1),
          { color: V(k < 2 ? 0x5b4a2c : 0x8a6a42, 0.1) },
        );
      }
    } else if (d.k === 'tarp') {
      const g = new THREE.PlaneGeometry(1.5, 1.1, 12, 9);
      g.rotateX(-PI / 2);
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++)
        p.setY(
          i,
          0.03 +
            Math.abs(Math.sin(p.getX(i) * 7 + p.getZ(i) * 3)) * 0.05 +
            (Math.abs(p.getX(i)) > 0.6 ? 0.04 : 0),
        );
      g.computeVertexNormals();
      D.geo(PL, g, L(0, 0, 0), { color: 0x2f5f9a });
    }
  }

  // ======================================================================= sticks, twigs, frond bits and bark scraps on the yard
  {
    const q = kit.rng(5599),
      yYs = ctx.yardY || (() => 0);
    for (const [cx, cz, rad, n] of STICKS)
      for (let i = 0; i < n; i++) {
        const a = q() * 6.283,
          d = Math.sqrt(q()) * rad,
          x = cx + Math.cos(a) * d,
          z = cz + Math.sin(a) * d,
          k = q(),
          y = yYs(x, z);
        if (r4Blocked(x, z, 0.2)) continue;
        if (k < 0.55)
          D.box(
            W,
            0.18 + q() * 0.45,
            0.012 + q() * 0.01,
            0.014 + q() * 0.01,
            M(x, y + 0.012, z, (q() - 0.5) * 0.2, q() * 6.28, (q() - 0.5) * 0.1),
            { grain: 0, color: V(k < 0.3 ? 0x6b5640 : 0x8f7a5e, 0.15), wear: 0.8 },
          ); // twigs
        else if (k < 0.8)
          D.box(
            MATTE,
            0.35 + q() * 0.6,
            0.004,
            0.05 + q() * 0.05,
            M(x, y + 0.008, z, 0, q() * 6.28, 0),
            { color: V(0x9a8a62, 0.12) },
          ); // dry frond strips
        else
          D.box(
            W,
            0.08 + q() * 0.1,
            0.01,
            0.05 + q() * 0.06,
            M(x, y + 0.008, z, (q() - 0.5) * 0.3, q() * 6.28, 0),
            { grain: 1, color: V(0x5a4632, 0.15), wear: 1 },
          );
      }
  } // bark scraps

  // ======================================================================= the roll-off's load (r2-keys, lead review): real tear-out at real sizes, lying
  // INSIDE the bin just under the rim: broken drywall with thickness and torn edges, 2x4 studs, a bent sheet of roofing tin, a folded tarp
  {
    const d = DUMPSTER,
      sc = d.scale,
      sy = d.sy ?? 1,
      base = M(DP.x, DP.y, DP.z, 0, d.heading, 0),
      L = (x, y, z, a = 0, b = 0, c = 0) => kit.mulM(base, M(x, y, z, a, b, c)),
      q = kit.rng(5577);
    const GYP = mat.pbr('concrete_wall_008', { rep: 0.7, tint: 0xdfe8ff, gain: 2.6, grunge: true }); // (the scan is warm: a blue tint lands it on off-white)   // gypsum board: paper face with a chalky grain
    const rim = 3.37 * sc * sy,
      hx = (3.26 * sc) / 2 - 0.16,
      hz = (8.81 * sc) / 2 - 0.2,
      fill = rim - 0.62;
    // a real heap: a mound that rises from just under the rim at the walls to above it in the middle, and every piece is stacked on
    // that surface (partly buried, tilted), so no floor shows
    const mound = (x, z) => {
      const e = Math.max(0, Math.min(1, (hx - Math.abs(x)) / 0.6, (hz - Math.abs(z)) / 1.0));
      return (
        fill +
        e * (0.45 + 0.12 * Math.sin(x * 2.3 + z * 0.9) + 0.1 * Math.sin(z * 1.7 - x * 3.1)) +
        0.025 * Math.sin(x * 9 + z * 7)
      );
    };
    {
      const g = new THREE.PlaneGeometry(hx * 2, hz * 2, 24, 56),
        pp = g.attributes.position;
      g.rotateX(-PI / 2);
      for (let i = 0; i < pp.count; i++) pp.setY(i, mound(pp.getX(i), pp.getZ(i)) - 0.06);
      g.computeVertexNormals();
      D.geo(GYP, g, L(0, 0, 0), { color: 0x6a6258, wear: 0.9 });
      g.dispose();
    }
    const torn = (w, h, k) => {
      const sh = new THREE.Shape(),
        n = 9;
      for (let i = 0; i <= n; i++) {
        const t = (i / n) * 6.283,
          rr = 0.82 + 0.22 * Math.sin(t * 3 + k) * q() + (q() < 0.3 ? -0.15 : 0);
        const px = ((Math.cos(t) * w) / 2) * rr,
          py = ((Math.sin(t) * h) / 2) * rr;
        i ? sh.lineTo(px, py) : sh.moveTo(px, py);
      }
      const g = new THREE.ExtrudeGeometry(sh, {
        depth: 0.022,
        bevelEnabled: true,
        bevelThickness: 0.004,
        bevelSize: 0.006,
        bevelSegments: 1,
      });
      g.rotateX(-PI / 2);
      return g;
    }; // board thickness with a crumbled gypsum edge
    const onHeap = (x, z, up = 0) => mound(x, z) + up;
    for (let i = 0; i < 26; i++) {
      const w = 0.22 + q() * 0.4,
        h = 0.18 + q() * 0.3,
        g = torn(w, h, i),
        x = (q() - 0.5) * hx * 1.7,
        z = (q() - 0.5) * hz * 1.8; // broken drywall chunks
      D.geo(
        GYP,
        g,
        L(x, onHeap(x, z, 0.02 + q() * 0.08), z, (q() - 0.5) * 1.4, q() * 6.28, (q() - 0.5) * 1.1),
        { color: V(q() < 0.7 ? 0xece8df : 0xd2cdc2, 0.04), wear: 0.5 },
      );
      g.dispose();
    }
    for (let i = 0; i < 14; i++) {
      const len = 0.9 + q() * 2.2,
        a = (q() - 0.5) * 0.8,
        x = (q() - 0.5) * hx * 1.3,
        z = (q() - 0.5) * (hz * 2 - len) * 0.9; // studs and offcuts, stacked and angled, some ends over the rim
      D.box(
        W,
        0.038,
        0.089,
        len,
        L(x, onHeap(x, z, 0.08 + Math.abs(a) * 0.35), z, a, (q() - 0.5) * 0.9, (q() - 0.5) * 0.6),
        { grain: 2, color: V(q() < 0.3 ? 0xb39a74 : 0x9a8e7a, 0.1), wear: 0.6 },
      );
    }
    {
      const g = new THREE.PlaneGeometry(0.75, 1.9, 6, 12),
        pp = g.attributes.position;
      for (let i = 0; i < pp.count; i++) {
        const x = pp.getX(i),
          y = pp.getY(i);
        pp.setZ(i, Math.sin(x * 26) * 0.012 + Math.max(0, y - 0.2) ** 2 * 0.35);
      }
      g.computeVertexNormals(); // a bent sheet of roofing tin
      D.geo(
        mat.tin(),
        g,
        L(hx * 0.35, onHeap(hx * 0.35, -hz * 0.3, 0.25), -hz * 0.3, -PI / 2 + 0.35, 0.4, 0.15),
        { color: 0xb9bcbd, wear: 0.8 },
      );
      g.dispose();
    }
    {
      const g = new THREE.PlaneGeometry(1.7, 1.2, 34, 24),
        pp = g.attributes.position;
      for (let i = 0; i < pp.count; i++) {
        const x = pp.getX(i),
          y = pp.getY(i),
          e = Math.max(0, Math.abs(x) - 0.55) * 1.4; // a blue poly tarp draped over the heap
        pp.setZ(
          i,
          Math.sin(x * 5.5 + y * 2) * 0.08 +
            Math.sin(y * 9 + x * 1.5) * 0.035 +
            Math.sin(x * 23 + y * 17) * 0.006 +
            Math.cos(x * 31 - y * 27) * 0.004 -
            e * e * 0.5,
        );
      }
      g.computeVertexNormals();
      D.geo(PLG, g, L(-hx * 0.3, onHeap(-hx * 0.3, hz * 0.45, 0.1), hz * 0.45, -PI / 2, 1.1, 0), {
        color: 0x2c5b94,
      });
      g.dispose();
    }
    for (let i = 0; i < 5; i++) {
      const g = new THREE.SphereGeometry(0.3, 14, 10),
        pp = g.attributes.position,
        k0 = q() * 9,
        x = (q() - 0.5) * hx * 1.2,
        z = (q() - 0.5) * hz * 1.5; // black contractor bags: lumpy, slumped, glossy
      for (let j = 0; j < pp.count; j++) {
        const px = pp.getX(j),
          py = pp.getY(j),
          pz = pp.getZ(j),
          w =
            1 +
            0.16 * Math.sin(px * 11 + k0) * Math.cos(pz * 9 - k0) +
            0.08 * Math.sin(py * 19 + px * 7);
        pp.setXYZ(j, px * w * 1.05, Math.max(-0.17, py * w * 0.72), pz * w * 1.25);
      }
      pp.needsUpdate = true;
      g.computeVertexNormals();
      D.geo(PLG, g, L(x, onHeap(x, z, 0.12), z, (q() - 0.5) * 0.4, q() * 6.28, (q() - 0.5) * 0.3), {
        color: V(0x141414, 0.05),
      });
      g.dispose();
    }
    for (let i = 0; i < 6; i++) {
      const sd = i % 2 ? 1 : -1,
        g = torn(0.18 + q() * 0.25, 0.14 + q() * 0.2, 20 + i); // spill at the base: drywall shards and offcuts in the dirt
      D.geo(
        GYP,
        g,
        L(
          sd * (hx + 0.35 + q() * 0.7),
          0.012,
          (q() - 0.5) * hz * 1.6,
          (q() - 0.5) * 0.2,
          q() * 6.28,
          (q() - 0.5) * 0.2,
        ),
        { color: V(0xe2ddd2, 0.05), wear: 0.7 },
      );
      g.dispose();
      if (i < 3)
        D.box(
          W,
          0.038,
          0.089,
          0.3 + q() * 0.4,
          L(-sd * (hx + 0.3 + q() * 0.6), 0.05, (q() - 0.5) * hz * 1.4, 0, q() * 3, PI / 2),
          { grain: 2, color: V(0x9a8e7a, 0.1), wear: 0.7 },
        );
    }
  }

  // ======================================================================= yard surface decals: litter, matted grass, tire ruts, puddles
  const decal = (name, w, h, draw) => {
    const t = kit.canvasTex(w, h, draw, { srgb: true });
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    const m = new THREE.MeshStandardMaterial({
      map: t,
      transparent: true,
      depthWrite: false,
      roughness: 0.95,
      metalness: 0,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -6,
    });
    m.name = 'keys:' + name;
    m.userData.uvScale = 1;
    // soft edges: the batch's per-vertex aWear carries the patch fade (1 in the middle, 0 at the ragged rim)
    m.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace(
          '#include <common>',
          '#include <common>\nattribute float aWear;\nvarying float vKFade;',
        )
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvKFade = aWear;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vKFade;')
        .replace(
          '#include <alphamap_fragment>',
          '#include <alphamap_fragment>\n  diffuseColor.a *= vKFade;',
        );
    };
    m.customProgramCacheKey = () => 'keys:decal';
    return m;
  };
  const LEAVES = decal('leaves', 512, 512, (g, w, h) => {
    const q = kit.rng(91);
    g.clearRect(0, 0, w, h);
    for (let i = 0; i < 520; i++) {
      const x = q() * w,
        y = q() * h,
        l = 7 + q() * 16,
        a = q() * 6.28,
        k = q();
      g.save();
      g.translate(x, y);
      g.rotate(a);
      g.fillStyle =
        k < 0.45
          ? `rgba(${120 + q() * 50},${86 + q() * 30},${40 + q() * 20},0.95)`
          : k < 0.75
            ? `rgba(${170 + q() * 40},${140 + q() * 30},${70 + q() * 20},0.9)`
            : k < 0.9
              ? `rgba(${92 + q() * 30},${102 + q() * 30},${46},0.9)`
              : `rgba(${180 + q() * 40},${50 + q() * 30},${30},0.9)`;
      g.beginPath();
      g.ellipse(0, 0, l, l * (0.3 + q() * 0.25), 0, 0, 6.28);
      g.fill();
      g.strokeStyle = 'rgba(60,40,20,0.5)';
      g.lineWidth = 0.8;
      g.beginPath();
      g.moveTo(-l, 0);
      g.lineTo(l * 1.2, 0);
      g.stroke();
      g.restore();
    }
  });
  LEAVES.color.setScalar(0.3);
  LEAVES.roughness = 0.7; // r2-art: leaf litter L <= 0.19 (measured 0.29 at 0.45)
  const MATTED = decal('matted', 512, 512, (g, w, h) => {
    const q = kit.rng(92);
    g.clearRect(0, 0, w, h);
    for (let i = 0; i < 2600; i++) {
      const x = q() * w,
        y = q() * h,
        l = 6 + q() * 22,
        a = 0.4 + (q() - 0.5) * 0.9 + (x / w) * 0.6,
        k = q();
      g.strokeStyle =
        k < 0.55
          ? `rgba(${150 + q() * 40},${150 + q() * 30},${80 + q() * 20},0.75)`
          : `rgba(${86 + q() * 30},${110 + q() * 30},${50 + q() * 20},0.8)`;
      g.lineWidth = 0.8 + q() * 1.2;
      g.beginPath();
      g.moveTo(x, y);
      g.quadraticCurveTo(
        x + Math.cos(a) * l * 0.5,
        y + Math.sin(a) * l * 0.5 - 2,
        x + Math.cos(a) * l,
        y + Math.sin(a) * l,
      );
      g.stroke();
    }
  });
  // crushed shell / marl dust: the pale, almost white yard surface of the mock-up, laid over the sand where cars and feet go
  const SHELLD = decal('shell', 512, 512, (g, w, h) => {
    const q = kit.rng(94);
    g.clearRect(0, 0, w, h);
    for (let i = 0; i < 70; i++) {
      const x = q() * w,
        y = q() * h,
        r2 = 40 + q() * 90,
        gr = g.createRadialGradient(x, y, 0, x, y, r2);
      gr.addColorStop(
        0,
        `rgba(${178 + q() * 18},${174 + q() * 16},${164 + q() * 14},${0.14 + q() * 0.12})`,
      );
      gr.addColorStop(1, 'rgba(178,174,164,0)');
      g.fillStyle = gr;
      for (const ox of [-w, 0, w])
        for (const oy of [-h, 0, h]) {
          g.save();
          g.translate(ox, oy);
          g.fillRect(x - r2, y - r2, r2 * 2, r2 * 2);
          g.restore();
        }
    } // pale marl dust wash (wrapped: the tile repeats seamlessly)
    for (let i = 0; i < 9000; i++) {
      const x = q() * w,
        y = q() * h,
        s = 0.6 + q() * q() * 3.2,
        v = 150 + q() * 70;
      g.fillStyle = `rgba(${v},${v - 4 - q() * 8},${v - 14 - q() * 16},${0.25 + q() * 0.4})`;
      g.beginPath();
      g.ellipse(x, y, s, s * (0.5 + q() * 0.5), q() * 3, 0, 6.28);
      g.fill();
    }
    for (let i = 0; i < 260; i++) {
      const x = q() * w,
        y = q() * h,
        s = 2 + q() * 4;
      g.fillStyle = `rgba(${206 + q() * 30},${200 + q() * 28},${188 + q() * 26},0.8)`;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + s, y + s * 0.3);
      g.lineTo(x + s * 0.4, y + s);
      g.closePath();
      g.fill();
    } // shell chips
    for (let i = 0; i < 1600; i++) {
      g.fillStyle = `rgba(90,82,70,${0.15 + q() * 0.25})`;
      g.fillRect(q() * w, q() * h, 1, 1);
    }
  });
  SHELLD.roughness = 0.97;
  const RUTS = decal('ruts', 64, 512, (g, w, h) => {
    const q = kit.rng(93);
    g.clearRect(0, 0, w, h);
    const gr = g.createLinearGradient(0, 0, w, 0);
    gr.addColorStop(0, 'rgba(70,58,42,0)');
    gr.addColorStop(0.25, 'rgba(70,58,42,0.24)');
    gr.addColorStop(0.75, 'rgba(70,58,42,0.24)');
    gr.addColorStop(1, 'rgba(70,58,42,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 9) {
      g.fillStyle = 'rgba(50,40,28,0.35)';
      g.fillRect(10, y, w - 20, 3);
    }
    for (let i = 0; i < 200; i++) {
      g.fillStyle = `rgba(230,220,200,${q() * 0.3})`;
      g.fillRect(q() * w, q() * h, 2, 2);
    }
  });
  RUTS.roughness = 1;
  const yY = ctx.yardY || (() => 0); // the yard sheet's surface (part 05): every ground layer rides on it, never sinks into its bumps
  const patch = (m, x, z, rad, dens, seed) => {
    const q = kit.rng(seed),
      n = 40,
      g = new THREE.CircleGeometry(rad, n, 0, PI * 2);
    const p = g.attributes.position,
      uv = g.attributes.uv,
      c = new Float32Array(p.count * 3),
      a0 = q() * 6.28,
      s = 1 / 1.6;
    for (let i = 0; i < p.count; i++) {
      const px = p.getX(i),
        py = p.getY(i),
        d = Math.hypot(px, py) / rad,
        ang = Math.atan2(py, px),
        k = 1 + 0.28 * Math.sin(ang * 3 + seed) + 0.16 * Math.sin(ang * 7 + seed * 2);
      p.setX(i, px * k);
      p.setY(i, py * k);
      const ux = px * k,
        uy = py * k;
      uv.setXY(
        i,
        (ux * Math.cos(a0) - uy * Math.sin(a0)) * s,
        (ux * Math.sin(a0) + uy * Math.cos(a0)) * s,
      );
      const f = Math.max(0, 1 - d) * dens;
      c[i * 3] = c[i * 3 + 1] = c[i * 3 + 2] = 1;
    }
    g.rotateX(-PI / 2);
    g.translate(x, 0, z);
    {
      const pp = g.attributes.position;
      for (let i = 0; i < pp.count; i++)
        pp.setY(i, yY(pp.getX(i), pp.getZ(i)) + 0.016 + seed * 0.0002);
    }
    D.geo(m, g, null, {
      keepColor: false,
      wear: (vx, vy, vz) =>
        Math.max(0, Math.min(1, (1 - Math.hypot(vx - x, vz - z) / (rad * 1.3)) * 2.4)) * dens,
    });
    g.dispose();
  };
  LITTER.forEach(([x, z, rad, dens, kind], i) =>
    patch(
      kind === 'matted' ? MATTED : kind === 'shell' ? SHELLD : LEAVES,
      x,
      z,
      rad,
      dens,
      300 + i,
    ),
  );
  // draw order of the overlapping ground layers (they do not write depth): shell dust, matted grass, ruts, leaves, puddles
  {
    let done = false;
    const ord = {
      'keys:shell': 3,
      'keys:matted': 4,
      'keys:ruts': 5,
      'keys:leaves': 6,
      'keys:puddle': 7,
    };
    ctx.updaters.push(() => {
      if (done) return;
      done = true;
      ctx.groups.detail.traverse((o) => {
        const n = o.material?.name;
        if (n && ord[n]) o.renderOrder = ord[n];
      });
    });
  }
  for (const t of TRACKS)
    for (const s of [-1, 1]) {
      // two ruts per track, a strip along the polyline (resampled every 0.5 m)
      const P = [];
      for (let i = 0; i < t.pts.length - 1; i++) {
        const a = t.pts[i],
          b = t.pts[i + 1],
          n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.5));
        for (let k = 0; k < n; k++)
          P.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
      }
      P.push(t.pts[t.pts.length - 1]);
      const pos = [],
        uvs = [],
        idx = [];
      let v = 0;
      for (let i = 0; i < P.length; i++) {
        const a = P[Math.max(0, i - 1)],
          b = P[Math.min(P.length - 1, i + 1)],
          dx = b[0] - a[0],
          dz = b[1] - a[1],
          L = Math.hypot(dx, dz) || 1,
          nx = -dz / L,
          nz = dx / L,
          cx = P[i][0] + (nx * s * t.gauge) / 2,
          cz = P[i][1] + (nz * s * t.gauge) / 2;
        if (i) v += Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]);
        pos.push(
          cx - nx * 0.17,
          yY(cx - nx * 0.17, cz - nz * 0.17) + 0.02,
          cz - nz * 0.17,
          cx + nx * 0.17,
          yY(cx + nx * 0.17, cz + nz * 0.17) + 0.02,
          cz + nz * 0.17,
        );
        uvs.push(0, v / 2.2, 1, v / 2.2);
        if (i) {
          const k = i * 2;
          idx.push(k - 2, k, k - 1, k - 1, k, k + 1);
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      g.setIndex(idx);
      g.computeVertexNormals();
      // flip to face up if needed
      if (g.attributes.normal.getY(0) < 0) {
        const ix = g.index.array;
        for (let i = 0; i < ix.length; i += 3) {
          const tt = ix[i];
          ix[i] = ix[i + 1];
          ix[i + 1] = tt;
        }
        g.computeVertexNormals();
      }
      const tot = v;
      D.geo(RUTS, g, null, {
        wear: (vx, vy, vz) => {
          let best = 1e9,
            bi = 0;
          for (let i = 0; i < P.length; i++) {
            const d = Math.hypot(P[i][0] - vx, P[i][1] - vz);
            if (d < best) {
              best = d;
              bi = i;
            }
          }
          return bi === 0 || bi === P.length - 1 ? 0.15 : 1;
        },
      });
      g.dispose();
    }
  // puddles: a mask that fills from the deepest point with the weather's puddle level (always a little water in the ruts)
  {
    const uWet = { value: 0.25 },
      mask = kit.canvasTex(
        256,
        256,
        (g, w, h) => {
          const im = g.createImageData(w, h),
            q = kit.rng(95),
            oct = [
              [4, 0.5],
              [9, 0.3],
              [21, 0.2],
            ].map(([f, a]) => ({ f, a, ph: [q() * 6, q() * 6, q() * 6, q() * 6] }));
          for (let y = 0; y < h; y++)
            for (let x = 0; x < w; x++) {
              const u = (x / w) * 2 - 1,
                v = (y / h) * 2 - 1,
                d = Math.hypot(u, v);
              let n = 0;
              for (const o of oct)
                n +=
                  o.a *
                  Math.sin(u * o.f + o.ph[0] + Math.sin(v * o.f * 0.7 + o.ph[1])) *
                  Math.cos(v * o.f + o.ph[2]);
              const val = Math.max(0, Math.min(1, (1 - d) * 1.25 + n * 0.35));
              const j = (y * w + x) * 4;
              im.data[j] = im.data[j + 1] = im.data[j + 2] = val * 255;
              im.data[j + 3] = 255;
            }
          g.putImageData(im, 0, 0);
        },
        { srgb: false },
      );
    // front-door view (Nov 19): murky gray-brown shallow water (0x2a2620 read as a navy stain from the deck)
    const PUD = new THREE.MeshStandardMaterial({
      color: 0x6e675c,
      roughness: 0.05,
      metalness: 0,
      transparent: true,
      depthWrite: false,
      alphaMap: mask,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -8,
      envMapIntensity: 1.2,
    });
    PUD.name = 'keys:puddle';
    PUD.userData.uvScale = 1;
    PUD.defines = { NO_WET: '' };
    PUD.onBeforeCompile = (sh) => {
      sh.uniforms.uKWet = uWet;
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uKWet;')
        .replace(
          '#include <alphamap_fragment>',
          `
      { float k = texture2D( alphaMap, vAlphaMapUv ).g; float th = mix( 0.82, 0.3, uKWet ); float fw = max( fwidth( k ) * 1.5, 0.02 );
        diffuseColor.a = smoothstep( th - fw, th + fw, k ) * 0.92; diffuseColor.rgb *= mix( 1.25, 0.7, smoothstep( th, th + 0.35, k ) ); }`,
        );
    };
    PUD.customProgramCacheKey = () => 'keys:puddle';
    for (const [x, z, a, b, rot] of PUDDLES) {
      const g = new THREE.PlaneGeometry(a * 2, b * 2, 8, 4);
      g.rotateX(-PI / 2);
      g.applyMatrix4(M(x, 0, z, 0, rot, 0));
      const pp = g.attributes.position;
      for (let i = 0; i < pp.count; i++) pp.setY(i, yY(pp.getX(i), pp.getZ(i)) + 0.024);
      D.geo(PUD, g, null, {});
      g.dispose();
    }
    // the corner puddle: always standing water (its own threshold), over a mud rim; rides on the asphalt or the yard, whichever is higher
    // r2-keys: the drive-end puddle (PUDDLES row with big = 1) gets the same damp mud rim (a stained low spot when dry); its water is
    // the weather-driven PUD above, so it fills after rain and shrinks back as the yard dries
    const RIMS = [
      CORNER_PUDDLE,
      ...PUDDLES.filter((p) => p[5]).map(([x, z, a, b, rot]) => ({
        x,
        z,
        a,
        b,
        rot,
        rimOnly: true,
      })),
    ].filter(Boolean);
    if (RIMS.length) {
      const gA = ctx.opts.groundAt || (() => -1),
        surf = (x, z) => Math.max(yY(x, z) + 0.024, gA(x, z) + 0.085);
      const P2 = PUD.clone();
      P2.name = 'keys:puddleCorner';
      const uC = { value: 0.82 };
      P2.onBeforeCompile = (sh) => {
        PUD.onBeforeCompile(sh);
        sh.uniforms.uKWet = uC;
      };
      P2.customProgramCacheKey = () => 'keys:puddleCorner';
      const MUD = decal('mud', 256, 256, (g, w, h) => {
        const q = kit.rng(97);
        g.clearRect(0, 0, w, h);
        for (let i = 0; i < 900; i++) {
          const x = q() * w,
            y = q() * h,
            d = Math.hypot(x / w - 0.5, y / h - 0.5);
          if (d > 0.48) continue;
          g.fillStyle = `rgba(${70 + q() * 30},${60 + q() * 24},${46 + q() * 18},${(0.5 - d) * 1.4})`;
          g.beginPath();
          g.ellipse(x, y, 4 + q() * 10, 3 + q() * 6, q() * 3, 0, 6.28);
          g.fill();
        }
      });
      MUD.map.wrapS = MUD.map.wrapT = THREE.ClampToEdgeWrapping;
      for (const CP of RIMS) {
        const mk = (m, sx, sy, dy) => {
          const g = new THREE.PlaneGeometry(CP.a * 2 * sx, CP.b * 2 * sy, 10, 5);
          g.rotateX(-PI / 2);
          g.applyMatrix4(M(CP.x, 0, CP.z, 0, CP.rot, 0));
          const pp = g.attributes.position;
          for (let i = 0; i < pp.count; i++) pp.setY(i, surf(pp.getX(i), pp.getZ(i)) + dy);
          D.geo(m, g, null, { wear: 1 });
          g.dispose();
        };
        mk(MUD, 1.35, 1.6, 0.0);
        if (!CP.rimOnly) mk(P2, 1.0, 1.0, 0.006);
      }
      // the street after a morning shower (lead review): a wet gutter strip along Nico's edges of Pelican Point Ln and a few standing
      // puddles in it, dry weather too (same always-wet water as the drive-mouth puddle)
      const WETS = decal('wetgutter', 64, 64, (g, w, h) => {
        g.fillStyle = 'rgba(28,26,24,0.55)';
        g.fillRect(0, 0, w, h);
      });
      WETS.roughness = 0.22;
      WETS.map.wrapS = WETS.map.wrapT = THREE.ClampToEdgeWrapping;
      const ribbon = (m, pts, side, o0, o1, dy, fade) => {
        const pos = [],
          idx = [];
        let n = 0;
        for (let i = 0; i < pts.length; i++) {
          const a2 = pts[Math.max(0, i - 1)],
            b2 = pts[Math.min(pts.length - 1, i + 1)],
            dx = b2[0] - a2[0],
            dz = b2[1] - a2[1],
            L2 = Math.hypot(dx, dz) || 1,
            nx = (-dz / L2) * side,
            nz = (dx / L2) * side;
          for (const o of [o0, o1]) {
            const x = pts[i][0] + nx * o,
              z = pts[i][1] + nz * o;
            pos.push(x, surf(x, z) + dy, z);
          }
          if (i) idx.push(n - 2, n - 1, n, n - 1, n + 1, n);
          n += 2;
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        g.setAttribute(
          'uv',
          new THREE.Float32BufferAttribute(new Float32Array((pos.length / 3) * 2).fill(0.5), 2),
        );
        g.setIndex(idx);
        g.computeVertexNormals();
        if (g.attributes.normal.getY(0) < 0) {
          const ix = g.index.array;
          for (let i = 0; i < ix.length; i += 3) {
            const t = ix[i];
            ix[i] = ix[i + 1];
            ix[i + 1] = t;
          }
          g.computeVertexNormals();
        }
        D.geo(m, g, null, { wear: (vx, vy, vz) => fade(vx, vz) });
        g.dispose();
      };
      const dense = (P, step = 0.8) => {
        const out = [];
        for (let i = 0; i < P.length - 1; i++) {
          const n2 = Math.max(
            1,
            Math.ceil(Math.hypot(P[i + 1][0] - P[i][0], P[i + 1][1] - P[i][1]) / step),
          );
          for (let k = 0; k < n2; k++)
            out.push([
              P[i][0] + ((P[i + 1][0] - P[i][0]) * k) / n2,
              P[i][1] + ((P[i + 1][1] - P[i][1]) * k) / n2,
            ]);
        }
        out.push(P[P.length - 1]);
        return out;
      };
      const EAST = dense([
          [8.0, 31.75],
          [5.4, 31.8],
          [-4.2, 31.6],
          [-13.8, 29.8],
          [-20.9, 23.8],
        ]),
        WEST = dense([
          [-20.9, 23.8],
          [-27.5, 12.6],
        ]);
      const patchy = (x, z) =>
        Math.max(
          0,
          Math.min(1, 0.55 + 0.45 * Math.sin(x * 0.37 + z * 0.21) * Math.cos(z * 0.29 - x * 0.13)),
        );
      ribbon(WETS, EAST, -1, 2.45, 3.2, 0.004, patchy);
      ribbon(WETS, WEST, -1, 2.45, 3.2, 0.004, patchy); // the yard-side gutter of each leg
      for (const [x, z, a2, b2, rot] of [
        [-8.6, 27.9, 1.5, 0.45, -0.18],
        [-0.8, 28.75, 1.1, 0.36, -0.02],
        [5.0, 28.95, 1.3, 0.38, 0.03],
        [-23.3, 14.3, 1.2, 0.42, -1.03],
      ]) {
        const g = new THREE.PlaneGeometry(a2 * 2, b2 * 2, 8, 3);
        g.rotateX(-PI / 2);
        g.applyMatrix4(M(x, 0, z, 0, rot, 0));
        const pp = g.attributes.position;
        for (let i = 0; i < pp.count; i++) pp.setY(i, surf(pp.getX(i), pp.getZ(i)) + 0.008);
        D.geo(P2, g, null, { wear: 1 });
        g.dispose();
      }
    }
    ctx.updaters.push((dt, env) => {
      const w = env?.game?.weather;
      uWet.value = w
        ? Math.max(0.25, Math.min(1, 0.25 + (w.puddles || 0) * 0.9 + (w.wetness || 0) * 0.25))
        : 0.25;
    });
  }

  // ======================================================================= library models: bins, dumpster, rocks, STOP signs
  // colliders now (the house's collider list is read right after the build), visuals when the models arrive
  // curb carts: breakable (a car above ~15 km/h knocks one over; src/world/miami/breakables.js), static box otherwise
  const BRK = breakables.enabled && !DYNBINS;
  if (!BRK && !DYNBINS)
    for (const b of BINS)
      if (b.piece)
        col.box(b.x, 0.56 + yG(b.x, b.z), b.z, 0.6, 1.12, 0.62, { ry: b.h || 0, tag: 'bin' });
  {
    const d = DUMPSTER,
      sy = d.sy ?? 1;
    col.box(
      DP.x,
      (3.37 * d.scale * sy) / 2 + DP.y,
      DP.z,
      3.26 * d.scale,
      3.37 * d.scale * sy,
      8.81 * d.scale,
      { ry: d.heading, tag: 'dumpster' },
    );
  }
  const ROCK_SZ = [
    [2.2, 1.5, 3.3],
    [2.6, 1.3, 3.3],
    [2.1, 1.1, 2.1],
    [2.1, 1.8, 2.0],
    [1.8, 1.2, 3.0],
    [2.1, 1.3, 2.8],
  ];
  // user (Nov 18): "there shouldn't be rocks in the road". The yard rocks were laid out for the old lot; on the new Keys lot
  // (r4-keys: local x -24..11.4, z -14.2..33, driveway straight out along +Z at x = -6) drop any outside the lot or on the drive
  const STOPS_OK = []; // the yard STOP signs marked the OLD lot's T corner; on the new Keys lot the street signs come from the road sign system (user: a stop sign in the middle of the sand)
  // front-door view (Nov 19): the rocks line the right edge of the dirt; only the ones in the house footprint or on the drive drop
  const ROCKS_OK = ROCKS.filter(
    ([x, z]) => !r4Blocked(x, z, 0.5) && !(ctx.driveD && ctx.driveD(x, z) < DRIVE.halfWidth + 0.2),
  );
  for (const [x, z, k, sc, h, sink] of ROCKS_OK) {
    const q = ROCK_SZ[[0, 1, 2, 0, 1, 2][(k - 1) % 6]];
    col.box(
      x,
      q[1] * sc * 0.8 * 0.45 - sink + yS(x, z),
      z,
      q[0] * sc * 0.75,
      q[1] * sc * 0.8 * 0.9,
      q[2] * sc * 0.75,
      { ry: h, tag: 'rock' },
    );
  }
  for (const st of STOPS_OK) col.cyl(st.x, 1.3 + yS(st.x, st.z), st.z, 0.05, 2.6, { tag: 'sign' });
  const lib = loadKeysModels(THREE, [
    'bins',
    'rolloff',
    'rocks',
    'utility_pole',
    'coolers',
    'patio_chair',
    'window_ac',
    'galv_can',
    'mailbox_post',
    'wicker_chair',
  ]);
  ctx.async.push(
    lib.ready.then(() => {
      const I = lib.instancer('keysYard');
      if (!DYNBINS)
        for (const b of BINS)
          if (b.piece)
            I.add('bins', b.piece, M(b.x, yG(b.x, b.z), b.z, 0, (b.h || 0) + PI / 2, 0), {
              tint: b.tint,
            });
      if (DYNBINS) dynamicBins(ctx, lib, yG);
      for (const m of POLE_M) I.add('utility_pole', 'dock', m);
      for (const [k, m] of [...LIBP, ...(ctx.libProps || [])]) I.add(k, 'dock', m);
      {
        const d = DUMPSTER;
        I.add(
          'rolloff',
          'dock',
          M(DP.x, DP.y, DP.z, 0, d.heading, 0, d.scale, d.scale * (d.sy ?? 1), d.scale),
          { tint: d.tint },
        );
      }
      const rockNames = lib.names('rocks').sort(); // three rock shapes (3 draw calls), varied by scale / yaw / tint
      for (const [x, z, k, sc, h, sink] of ROCKS_OK) {
        const n = rockNames[[0, 1, 2, 0, 1, 2][(k - 1) % 6] % rockNames.length];
        I.add('rocks', n, M(x, -sink + yS(x, z), z, 0, h, 0, sc, sc * 0.8, sc), {
          tint: [0.95 + r() * 0.1, 0.95 + r() * 0.08, 0.92 + r() * 0.08],
        });
      }
      const meshes = I.build(ctx.groups.site);
      for (const m of meshes) m.raycast = () => {};
      if (BRK) {
        // register the carts in world space once the house group is placed; hiding a cart collapses its instance
        const binMeshes = (piece) =>
            meshes.filter((m) =>
              lib.piece('bins', piece)?.parts.some((q) => q.geometry === m.geometry),
            ),
          idx = {},
          zero = new THREE.Matrix4().makeScale(0, 0, 0);
        const recs = BINS.filter((b) => b.piece).map((b) => ({
          b,
          i: (idx[b.piece] = (idx[b.piece] ?? -1) + 1),
        }));
        let done = false;
        ctx.updaters.push(() => {
          if (done) return;
          done = true;
          ctx.group.updateMatrixWorld(true);
          const yaw = new THREE.Euler().setFromRotationMatrix(ctx.group.matrixWorld).y;
          for (const { b, i } of recs) {
            const p = new THREE.Vector3(b.x, yG(b.x, b.z), b.z).applyMatrix4(ctx.group.matrixWorld);
            breakables.add({
              x: p.x,
              y: p.y,
              z: p.z,
              hx: 0.3,
              hy: 0.56,
              hz: 0.31,
              ry: (b.h || 0) + yaw,
              kind: 'bin',
              owner: 'nicoYard',
              color: 0x2c4f7c,
              hide: () => {
                for (const m of binMeshes(b.piece)) {
                  m.setMatrixAt(i, zero);
                  m.instanceMatrix.needsUpdate = true;
                }
              },
            });
          }
        });
      }
      ctx.stats.keysYard = { instances: I.count(), meshes: meshes.length, rocks: rockNames };
    }),
  );
  // STOP plates and posts from the street kit (the library plate on its U-channel post, as regulatory.v2.js uses them)
  const game = ctx.opts.game;
  if (game)
    ctx.async.push(
      (async () => {
        for (let i = 0; i < 60 && !game.city?.streetKit?.signs?.stop; i++)
          await new Promise((res) => setTimeout(res, 500));
        const SK = game.city?.streetKit;
        if (!SK?.signs?.stop) return;
        const g = new THREE.Group();
        g.name = 'keysStops';
        // one instanced mesh per part for the three signs (post, plate)
        const inst = (part, mats) => {
          const im = new THREE.InstancedMesh(part.geometry, part.material, mats.length);
          mats.forEach((m, i) => im.setMatrixAt(i, m));
          im.instanceMatrix.needsUpdate = true;
          im.castShadow = true;
          im.receiveShadow = true;
          im.raycast = () => {};
          im.computeBoundingSphere();
          g.add(im);
        };
        const bases = STOPS_OK.map((st) =>
          M(st.x, yS(st.x, st.z) - 0.04, st.z, st.lean || 0, st.face, 0),
        );
        // user: the STOP plate sat off the post. The kit's post geometry is not centered on its origin, so the 2.4x width scale pushed
        // it sideways: center both parts on the sign axis from their own bounding boxes (plate just in front of the post)
        const ctr = (geo) => {
          try {
            geo.computeBoundingBox();
            const bb = geo.boundingBox;
            return {
              x: (bb.min.x + bb.max.x) / 2,
              z: (bb.min.z + bb.max.z) / 2,
              d: bb.max.z - bb.min.z,
            };
          } catch (e) {
            return { x: 0, z: 0, d: 0 };
          }
        };
        const pc = SK.signs.post ? ctr(SK.signs.post.geometry) : { x: 0, z: 0, d: 0 },
          sc = ctr(SK.signs.stop.geometry);
        if (SK.signs.post)
          inst(
            SK.signs.post,
            bases.map((b) =>
              kit.mulM(b, M(-pc.x * 2.4, -0.12, -pc.z * 2.4, 0, 0, 0, 2.4, 2.9, 2.4)),
            ),
          );
        inst(
          SK.signs.stop,
          bases.map((b) => kit.mulM(b, M(-sc.x, 2.33, -sc.z + (pc.d * 2.4) / 2 + 0.012))),
        );
        ctx.groups.site.add(g);
      })(),
    );
}

// r8 (SPEC r8, physics): Nico's yard bins are real rigid bodies: a car or a shove tips them over, they roll and come to rest, and a bin
// that falls over spills its bags and litter once (no shattering into blocks). Each bin: the library piece as its own mesh (tinted),
// one dynamic Rapier body (a cuboid for the carts, a cylinder for the galvanized cans, ~10 kg), sleeping until something hits it;
// the mesh follows the body while it is awake.
function dynamicBins(ctx, lib, yG) {
  const { THREE, kit } = ctx,
    game = ctx.opts.game,
    RAPIER = game.RAPIER,
    world = game.world,
    M = kit.M,
    r = kit.rng(5151);
  const list = [];
  for (const b of BINS) {
    const piece = b.piece
      ? lib.piece('bins', b.piece)
      : b.can === 'galv'
        ? lib.piece('galv_can', 'dock')
        : null;
    if (!piece) continue;
    const g = new THREE.Group();
    g.name = 'r8bin';
    for (const q of piece.parts) {
      let m = q.material;
      if (b.tint) {
        m = m.clone();
        m.color.multiply(new THREE.Color(...b.tint));
      }
      const mesh = new THREE.Mesh(q.geometry, m);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.raycast = () => {};
      mesh.rotation.y = b.piece ? Math.PI / 2 : 0;
      g.add(mesh);
    }
    list.push({ b, g, cart: !!b.piece });
  }
  let placed = false;
  ctx.updaters.push(() => {
    if (!placed) {
      placed = true;
      ctx.group.updateMatrixWorld(true);
      const yaw = new THREE.Euler().setFromRotationMatrix(ctx.group.matrixWorld, 'YXZ').y;
      for (const it of list) {
        const { b } = it,
          p = new THREE.Vector3(b.x, yG(b.x, b.z) + 0.01, b.z).applyMatrix4(ctx.group.matrixWorld),
          h = (b.h || 0) + (b.piece ? 0 : b.x * 1.7) + yaw,
          q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), h);
        const body = world.createRigidBody(
          RAPIER.RigidBodyDesc.dynamic()
            .setTranslation(p.x, p.y, p.z)
            .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
            .setLinearDamping(0.35)
            .setAngularDamping(0.6)
            .setCanSleep(true)
            .setCcdEnabled(false),
        );
        const cd = it.cart
          ? RAPIER.ColliderDesc.cuboid(0.3, 0.56, 0.31).setTranslation(0, 0.56, 0)
          : RAPIER.ColliderDesc.cylinder(0.38, 0.28).setTranslation(0, 0.38, 0);
        world.createCollider(
          cd
            .setDensity(it.cart ? 24 : 30)
            .setFriction(0.7)
            .setRestitution(0.08),
          body,
        );
        body.sleep();
        it.body = body;
        it.g.position.copy(p);
        it.g.quaternion.copy(q);
        game.scene.add(it.g);
      }
      return;
    }
    for (const it of list) {
      const body = it.body;
      if (!body || body.isSleeping()) continue;
      const t = body.translation(),
        q = body.rotation();
      it.g.position.set(t.x, t.y, t.z);
      it.g.quaternion.set(q.x, q.y, q.z, q.w);
      if (!it.spilled) {
        const up = new THREE.Vector3(0, 1, 0).applyQuaternion(it.g.quaternion);
        if (up.y < 0.45) {
          it.spilled = true;
          spill(it);
        }
      }
      if (t.y < -50) {
        world.removeRigidBody(body);
        it.body = null;
        game.scene.remove(it.g);
      }
    }
  });
  // the spill: two or three black bags and paper / can litter on the ground in front of the bin's mouth (static: no physics cost)
  const BAG = new THREE.MeshStandardMaterial({ color: 0x141416, roughness: 0.35, metalness: 0 }),
    LIT = new THREE.MeshStandardMaterial({ color: 0xd9d4c4, roughness: 0.9 });
  function spill(it) {
    const grp = new THREE.Group(),
      up = new THREE.Vector3(0, 1, 0).applyQuaternion(it.g.quaternion);
    up.y = 0;
    if (up.lengthSq() < 1e-4) up.set(1, 0, 0);
    up.normalize();
    const base = it.g.position.clone(),
      gy = game.city?.groundHeightAt?.(base.x, base.z);
    for (let k = 0; k < 3; k++) {
      const d = 0.7 + k * 0.35 + r() * 0.2,
        s = 0.22 + r() * 0.08,
        m = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), BAG);
      m.scale.set(s * 1.2, s * 0.8, s);
      m.position.copy(base).addScaledVector(up, d);
      m.position.x += (r() - 0.5) * 0.4;
      m.position.z += (r() - 0.5) * 0.4;
      m.position.y = (Number.isFinite(gy) ? Math.max(gy, base.y - 0.3) : base.y) + s * 0.7;
      m.castShadow = true;
      grp.add(m);
    }
    for (let k = 0; k < 10; k++) {
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(0.12 + r() * 0.1, 0.006, 0.1 + r() * 0.1),
        LIT,
      );
      m.position.copy(base).addScaledVector(up, 0.6 + r() * 1.6);
      m.position.x += (r() - 0.5) * 1.2;
      m.position.z += (r() - 0.5) * 1.2;
      m.position.y = (Number.isFinite(gy) ? Math.max(gy, base.y - 0.3) : base.y) + 0.01;
      m.rotation.y = r() * 6;
      grp.add(m);
    }
    grp.name = 'r8binSpill';
    game.scene.add(grp);
  }
  void M;
}
