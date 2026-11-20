// Nico's house r8: the ANNEX and the LOWER back deck (SPEC r8, references C, D, E, F, 19). A lower teal board-and-batten room under the NE
// half of the house and on under the back deck: its door faces the under-house passage (C: white panel door, the purple neon box on
// the lattice above it, wall lamp, meter boxes and conduit, green drum, propane tank, a small table and pots, hose reel), a shuttered
// window beside it. On its roof, flush with the canal wall, the LOWER deck (about half the old back deck): Nico's gym and grill spot
// (E / 19 / F: patio table and four chairs under the gray / yellow umbrella, bench with rack and a loaded bar, plate tree, rubber mat
// with a loose bar, green mat with kettlebells, gas grill, cooler, the zig-zag towel on the canal rail). Its stair comes down from the
// deck's SE edge running back toward the house. Also the life under the house (C): fluorescent tube, string lights, the downpipe and
// vines on the posts, and the boat on its trailer at the canal's end (B / D). House frame H (r4/plan4.js) through r4/frame.js.
import { R8, P4 } from '../r4/plan4.js';
import { frame } from '../r4/frame.js';
import { makeGeo } from '../r4/geo.js';
import { loadKeysModels } from '../models.js';
import { glb } from '../r4/glb.js';
import { potPlant as userPot } from '../r4/pots.js';
import { carpentry } from '../r4/carp8.js';
export const order = 12;

export function build(ctx) {
  if (!R8) return;
  const { THREE, kit, mat } = ctx,
    Fr = frame(ctx, 'house'),
    B = kit.batch('r8annex'),
    D = kit.batch('r8annexD'),
    M = kit.M,
    P = P4,
    A = P.annex,
    LD = P.lower,
    C = P.colors,
    r = kit.rng(1218);
  const { lathe, subtract, hexa } = makeGeo(THREE, kit);
  ctx.geo8 ||= { hexa };
  ctx.colors8 ||= C;
  ctx.rail8 ||= P.rail;
  ctx.F8 ||= P.F;
  const { railRun, flight } = carpentry(ctx, Fr, B, r);
  const WOOD = mat.wood(),
    WHITE = mat.paint({ peel: 'a', fade: 0.55, gloss: 0.93 }),
    TEAL = mat.paint({ peel: 'b', fade: 0.45, gloss: 0.92, scale: 1.2 }),
    DOORP = mat.paint({ peel: 'a', fade: 0.2, gloss: 0.8, scale: 0.6 });
  const CONC = mat.concrete(),
    STEEL = mat.steel(),
    GLASS = mat.glass(),
    PL = mat.plastic();
  const box = (m, sx, sy, sz, x, y, z, o = {}, rx = 0, ry = 0, rz = 0, Bt = B) =>
    Bt.box(m, sx, sy, sz, M(x, y, z, rx, ry, rz), { bevel: 0.004, rand: r, ...o });
  const gray = (k = 1) => kit.vary(kit.mul(C.deck, k), r, 0.08),
    postC = () => kit.vary(C.post, r, 0.04);
  const H = A.h,
    BT = 0.022,
    T = 0.12,
    dY = LD.y,
    beamBot = ctx.r4?.beamBot ?? 3.04;
  // ---------- slab ----------
  box(CONC, A.x1 - A.x0 + 0.2, 0.1, A.z1 - A.z0 + 0.2, (A.x0 + A.x1) / 2, 0.03, (A.z0 + A.z1) / 2, {
    color: 0xb3b0a8,
    wear: 0.9,
    bevel: 0.02,
  });
  // ---------- walls: core (closed solid, cut at the openings) + vertical boards + battens ----------
  const door = { u: A.door - A.z0, w: 0.86, y0: 0.08, y1: 2.1 },
    win = { u: A.win - A.z0, w: 0.8, y0: 0.95, y1: 1.9 },
    win2 = { u: 7.0 - A.x0, w: 1.0, y0: 0.95, y1: 1.9 };
  const wall = (ax, az, bx, bz, ops) => {
    const L = Math.hypot(bx - ax, bz - az),
      ux = (bx - ax) / L,
      uz = (bz - az) / L,
      nx = -uz,
      nz = ux,
      ry = Math.atan2(-uz, ux),
      pt = (u, w) => [ax + ux * u + nx * w, az + uz * u + nz * w];
    const edges = [...new Set([0, L, ...ops.flatMap((o) => [o.u - o.w / 2, o.u + o.w / 2])])].sort(
      (p, q) => p - q,
    );
    for (let i = 0; i < edges.length - 1; i++) {
      const u0 = edges[i],
        u1 = edges[i + 1],
        um = (u0 + u1) / 2,
        cuts = ops.filter((o) => Math.abs(um - o.u) < o.w / 2).map((o) => [o.y0, o.y1]);
      for (const [y0, y1] of subtract(0.08, H, cuts)) {
        const [x, z] = pt(um, -T / 2);
        box(
          TEAL,
          u1 - u0,
          y1 - y0,
          T,
          x,
          (y0 + y1) / 2,
          z,
          { color: kit.mul(C.tealDeep, 0.8), wear: 0.2 },
          0,
          ry,
        );
      }
    }
    const nB = Math.ceil(L / 0.3);
    for (let i = 0; i < nB; i++) {
      const u0 = (i * L) / nB,
        u1 = ((i + 1) * L) / nB;
      for (const [s0, s1] of subtract(
        u0,
        u1,
        ops.map((o) => [o.u - o.w / 2 - 0.004, o.u + o.w / 2 + 0.004]),
        0.004,
      )) {
        const cut = ops
          .filter((o) => Math.abs((s0 + s1) / 2 - o.u) < o.w / 2 + 0.01)
          .map((o) => [o.y0, o.y1]);
        for (const [y0, y1] of subtract(0.08, H, cut)) {
          const [x, z] = pt((s0 + s1) / 2, BT / 2);
          box(
            TEAL,
            s1 - s0 - 0.002,
            y1 - y0,
            BT,
            x,
            (y0 + y1) / 2,
            z,
            { grain: 1, color: kit.vary(C.teal, r, 0.07), wear: 0.1 + r() * 0.3, bevel: 0.003 },
            0,
            ry,
          );
        }
      }
      if (i) {
        const cuts = ops
          .filter((o) => Math.abs(u0 - o.u) < o.w / 2 + 0.16)
          .map((o) => [o.y0 - 0.14, o.y1 + 0.14]);
        for (const [y0, y1] of subtract(0.1, H - 0.02, cuts)) {
          const [x, z] = pt(u0, BT + 0.01);
          box(
            TEAL,
            0.065,
            y1 - y0,
            0.02,
            x,
            (y0 + y1) / 2,
            z,
            { grain: 1, color: kit.vary(C.teal, r, 0.07), wear: 0.3 },
            0,
            ry,
          );
        }
      }
    }
    const [cx, cz] = pt(L / 2, -T / 2);
    Fr.col.box(cx, H / 2, cz, L + 0.1, H, T + 0.06, { ry, tag: 'wall' });
    return { pt, ry, L };
  };
  // walls a -> b with the outside on the left of the run seen from above (n = (-uz, ux))
  wall(A.x0, A.z1, A.x1, A.z1, [win2]);
  wall(A.x1, A.z1, A.x1, A.z0, []);
  wall(A.x1, A.z0, A.x0, A.z0, []);
  const front = wall(A.x0, A.z0, A.x0, A.z1, [door, win]);
  for (const [x, z] of [
    [A.x0, A.z0],
    [A.x1, A.z0],
    [A.x0, A.z1],
    [A.x1, A.z1],
  ])
    box(TEAL, 0.14, H - 0.06, 0.14, x, H / 2 + 0.02, z, {
      grain: 1,
      color: kit.vary(C.tealDeep, r, 0.05),
      wear: 0.5,
    });
  // roof slab of the annex where it is under the house (the lower deck covers the rest)
  box(TEAL, LD.x0 - A.x0, 0.12, A.z1 - A.z0, (A.x0 + LD.x0) / 2, H + 0.06, (A.z0 + A.z1) / 2, {
    color: kit.mul(C.tealDeep, 0.75),
    wear: 0.3,
  });
  // casings (white), the door (white 4-panel, closed), the windows (white sash, dim room behind, dark board shutters)
  {
    const cas = (W, o, isDoor) => {
      const { pt, ry } = W;
      for (const s of [-1, 1]) {
        const [x, z] = pt(o.u + s * (o.w / 2 + 0.05), BT + 0.014);
        box(
          WHITE,
          0.1,
          o.y1 - o.y0 + (isDoor ? 0.05 : 0.16),
          0.028,
          x,
          (o.y0 + o.y1) / 2 + (isDoor ? 0.025 : 0),
          z,
          { grain: 1, color: kit.vary(C.white, r, 0.04), wear: 0.5 },
          0,
          ry,
        );
      }
      const [hx, hz] = pt(o.u, BT + 0.016);
      box(
        WHITE,
        o.w + 0.3,
        0.12,
        0.032,
        hx,
        o.y1 + 0.09,
        hz,
        { color: kit.vary(C.white, r, 0.04), wear: 0.5 },
        0,
        ry,
      );
    };
    const sash = (W, o) => {
      const { pt, ry } = W,
        [x, z] = pt(o.u, -0.05);
      for (const yy of [o.y0 + 0.025, (o.y0 + o.y1) / 2, o.y1 - 0.025])
        box(PL, o.w, 0.05, 0.05, x, yy, z, { color: 0xe9e6dc }, 0, ry);
      for (const s of [-1, 1]) {
        const [sx, sz] = pt(o.u + s * (o.w / 2 - 0.025), -0.05);
        box(PL, 0.05, o.y1 - o.y0, 0.05, sx, (o.y0 + o.y1) / 2, sz, { color: 0xe9e6dc }, 0, ry);
      }
      box(
        GLASS,
        o.w - 0.06,
        o.y1 - o.y0 - 0.06,
        0.006,
        x,
        (o.y0 + o.y1) / 2,
        z,
        { color: 0xffffff, bevel: 0 },
        0,
        ry,
      );
      const [rx, rz] = pt(o.u, -0.4);
      box(
        mat.matte(),
        o.w + 0.2,
        o.y1 - o.y0 + 0.2,
        0.03,
        rx,
        (o.y0 + o.y1) / 2,
        rz,
        { color: 0x2a2420 },
        0,
        ry,
      );
      for (const s of [-1, 1])
        for (let k = 0; k < 3; k++) {
          const sw = o.w / 2 + 0.04,
            [bx, bz] = pt(
              o.u + s * (o.w / 2 + 0.16 + sw / 2) - (s * sw) / 2 + (s * sw * (k + 0.5)) / 3,
              BT + 0.04,
            );
          box(
            DOORP,
            sw / 3 - 0.004,
            o.y1 - o.y0 + 0.1,
            0.022,
            bx,
            (o.y0 + o.y1) / 2,
            bz,
            { grain: 1, color: kit.vary(C.shutter, r, 0.06), wear: 0.4 },
            0,
            ry,
          );
        }
    };
    cas(front, door, true);
    cas(front, win, false);
    sash(front, win);
    const sideW = { pt: (u, w) => [A.x0 + u, A.z1 + w], ry: 0 };
    cas(sideW, win2, false);
    sash(sideW, win2);
    const { pt, ry } = front;
    {
      const [x, z] = pt(door.u, -0.03);
      box(
        DOORP,
        door.w - 0.02,
        door.y1 - door.y0 - 0.01,
        0.045,
        x,
        (door.y0 + door.y1) / 2,
        z,
        { color: 0xe4e1d8, wear: 0.35 },
        0,
        ry,
      );
      for (const [du, dy] of [
        [-0.19, 0.5],
        [0.19, 0.5],
        [-0.19, 1.45],
        [0.19, 1.45],
      ]) {
        const [px, pz] = pt(door.u + du, -0.004);
        box(
          DOORP,
          0.3,
          dy < 1 ? 0.7 : 0.9,
          0.012,
          px,
          door.y0 + dy,
          pz,
          { color: 0xd8d4ca, wear: 0.3 },
          0,
          ry,
        );
      }
      const [kx, kz] = pt(door.u + door.w / 2 - 0.09, 0.0);
      lathe(
        D,
        mat.chrome(),
        [
          [0.001, 0],
          [0.026, 0.004],
          [0.03, 0.02],
          [0.026, 0.036],
          [0.001, 0.04],
        ],
        M(kx, 0.98, kz, -Math.PI / 2, ry, 0),
        { color: 0xb8b4aa, seg: 16 },
      );
    }
    // the purple neon box on the lattice above the door (C / D): a glowing tube in a dark box; a lamp in the lamp system at night
    {
      const NEON = mat.emissive(0x9a5cff, 3.2, 'r8neon'),
        [nx2, nz2] = pt(door.u, BT + 0.09);
      box(PL, 0.5, 0.3, 0.1, nx2, H + 0.3, nz2, { color: 0x2a2a30, bevel: 0.01 }, 0, ry);
      for (const dy of [-0.07, 0, 0.07]) {
        const [tx2, tz2] = pt(door.u, BT + 0.145);
        D.cyl(NEON, 0.013, 0.013, 0.4, M(tx2, H + 0.3 + dy, tz2, 0, ry, Math.PI / 2), { seg: 10 });
      }
      const [lx, lz] = pt(door.u, 0.6);
      const nl = Fr.light({
        id: 'r7_neon',
        pos: [lx, H + 0.2, lz],
        color: 0x8a52ff,
        intensity: 34,
        range: 6.5,
        on: false,
      });
      ctx.updaters.push((dt, env) => {
        const t = env?.timeOfDay ?? 12;
        nl.on = t < 6.4 || t > 18.2;
        NEON.emissiveIntensity = nl.on ? 3.2 : 0.6;
      });
    }
    ctx.async.push(
      kit.model('garden_hose_wall_mounted_01').then((m) => {
        if (!m) return;
        const [x, z] = pt(door.u + 1.0, BT + 0.05);
        m.position.set(x, 0.85, z);
        m.rotation.y = ry;
        Fr.groups.ext.add(m);
      }),
    );
    const POT = mat.paint({ peel: 'a', fade: 0.1, gloss: 0.6, scale: 0.5 }),
      LEAF = mat.plastic();
    const pot = (u, w, s) => {
      const [x, z] = pt(u, w);
      lathe(
        B,
        POT,
        [
          [0.001, 0],
          [0.12 * s, 0],
          [0.17 * s, 0.26 * s],
          [0.19 * s, 0.3 * s],
          [0.17 * s, 0.31 * s],
          [0.001, 0.29 * s],
        ],
        M(x, 0.08, z),
        { color: 0xb5603a, seg: 18, wear: 0.4 },
      );
      for (let k = 0; k < 9; k++) {
        const a = k * 2.4 + u,
          l = (0.35 + (k % 3) * 0.12) * s;
        B.strut(
          LEAF,
          [x, 0.08 + 0.27 * s, z],
          [x + Math.cos(a) * l * 0.55, 0.08 + 0.27 * s + l, z + Math.sin(a) * l * 0.55],
          0.06 * s,
          0.006,
          { color: kit.vary(0x3f7a34, r, 0.15), rand: r },
        );
      }
      Fr.col.cyl(x, 0.25, z, 0.18 * s, 0.4, { tag: 'prop' });
    };
    void pot; // r10 (playtest: the strut plants looked bad): the user's potted palm beside the door
    {
      const [px, pz] = pt(door.u + 0.85, 0.42);
      userPot(ctx, Fr, 'gardenCroton', px, 0.08, pz, { s: 1.0, ry: 0.8 });
    } // r11: the scanned croton
    // lattice panel over the door between the annex top and the beam (C), the wall lamp, the meter boxes and conduit
    {
      const xw = A.x0 - 0.03,
        dz0 = A.z0 + door.u,
        LTW = mat.paint({ peel: 'a', fade: 0.6, gloss: 0.9 }),
        yb = beamBot - 0.02;
      for (const sg of [1, -1])
        for (let k = -8; k < 16; k++) {
          const c0 = dz0 - 0.9 + k * 0.12,
            a0 = [c0, H],
            a1 = [c0 + sg * (yb - H), yb];
          const zA = Math.max(dz0 - 0.9, Math.min(dz0 + 0.9, a0[0])),
            zB = Math.max(dz0 - 0.9, Math.min(dz0 + 0.9, a1[0]));
          if (Math.abs(zB - zA) < 0.05) continue;
          const yA = H + Math.abs(zA - a0[0]),
            yB = yb - Math.abs(zB - a1[0]);
          B.strut(
            LTW,
            [xw - (sg > 0 ? 0.01 : 0.025), yA, zA],
            [xw - (sg > 0 ? 0.01 : 0.025), yB, zB],
            0.035,
            0.012,
            { color: 0xe2ddd0, rand: r },
          );
        }
      box(LTW, 0.05, 0.06, 1.9, xw - 0.02, H + 0.03, dz0, { color: 0xe2ddd0 });
      box(LTW, 0.05, 0.06, 1.9, xw - 0.02, yb - 0.03, dz0, { color: 0xe2ddd0 });
      lathe(
        D,
        mat.metalPaint(),
        [
          [0.001, 0],
          [0.05, 0],
          [0.06, 0.1],
          [0.04, 0.16],
          [0.001, 0.17],
        ],
        M(xw - 0.08, 1.95, dz0 + 0.62),
        { color: 0xcfccc4, seg: 14 },
      );
      glb(kit, 'meter_boxes.glb', {
        parent: Fr.groups.detail,
        pos: [xw - 0.07, 0.75, dz0 + 1.45],
        ry: -Math.PI / 2,
        scale: 0.8,
        mat: (m) => {
          m.roughness = Math.max(0.6, m.roughness ?? 0.6);
          m.color.multiplyScalar(0.85);
        },
      });
      D.cyl(STEEL, 0.014, 0.014, yb - 1.55, M(xw - 0.04, (yb + 1.55) / 2, dz0 + 1.3), {
        color: 0x9a9890,
        seg: 8,
      });
      // green steel drum and a small silver propane tank left of the door (C), a small table with pots right of it
      const gx = xw - 0.52,
        gz = dz0 - 1.4; // r10 (playtest: the drum clipped the post at (2.2, -7.0))
      glb(kit, 'steel_drum.glb', {
        parent: Fr.groups.detail,
        pos: [gx, 0.06, gz],
        mat: (m) => {
          m.color.setRGB(0.22, 0.4, 0.25);
          m.metalness = 0.5;
          m.roughness = 0.6;
        },
      });
      Fr.col.cyl(gx, 0.5, gz, 0.27, 0.9, { tag: 'prop' });
      const tx2 = xw - 0.36,
        tz2 = dz0 - 1.98;
      glb(kit, 'propane_small.glb', {
        parent: Fr.groups.detail,
        pos: [tx2, 0.06, tz2],
        mat: (m) => {
          m.metalness = 0.4;
          m.roughness = 0.5;
        },
      });
      Fr.col.cyl(tx2, 0.3, tz2, 0.18, 0.55, { tag: 'prop' });
      const sx2 = xw - 0.35,
        sz2 = dz0 + 2.1;
      box(mat.wood(), 0.4, 0.03, 0.4, sx2, 0.62, sz2, { grain: 0, color: 0x8a6a48, wear: 0.6 });
      for (const [dx, dzz] of [
        [-0.16, -0.16],
        [0.16, -0.16],
        [-0.16, 0.16],
        [0.16, 0.16],
      ])
        box(mat.wood(), 0.03, 0.6, 0.03, sx2 + dx, 0.31, sz2 + dzz, { grain: 1, color: 0x7a5c3e });
      Fr.col.box(sx2, 0.32, sz2, 0.42, 0.64, 0.42, { tag: 'furniture' });
      userPot(ctx, Fr, 'succulent', sx2 + 0.05, 0.635, sz2, { s: 1.0, noCol: true });
    }
  }
  // ---------- the lower deck on the annex roof (flush with the canal wall): joists, rim, boards, posts where nothing is under it ----------
  const db = P.board,
    pitch = db.w + db.gap,
    jb = dY - db.t;
  box(
    TEAL,
    A.x1 - LD.x0,
    jb - 0.3 - H,
    A.z1 - A.z0,
    (LD.x0 + A.x1) / 2,
    (H + jb - 0.3) / 2,
    (A.z0 + A.z1) / 2,
    { color: kit.mul(C.tealDeep, 0.8), wear: 0.3 },
  ); // roof structure under the deck
  for (const [ax, az, bx, bz] of [
    [LD.x0, LD.z0, LD.x1, LD.z0],
    [LD.x0, LD.z1, LD.x1, LD.z1],
    [LD.x1, LD.z0, LD.x1, LD.z1],
  ]) {
    const hz = Math.abs(bz - az) < 0.01,
      len = hz ? bx - ax : bz - az;
    box(
      WOOD,
      hz ? len + 0.04 : 0.04,
      0.24,
      hz ? 0.04 : len,
      (ax + bx) / 2,
      jb - 0.12,
      (az + bz) / 2,
      { grain: hz ? 0 : 2, color: gray(0.8), wear: 0.6 },
    );
  }
  for (let z = LD.z0 + pitch / 2; z < LD.z1 - 0.02; z += pitch) {
    const patchB = r() < 0.06;
    box(WOOD, LD.x1 - LD.x0 - 0.06, db.t, db.w, (LD.x0 + LD.x1) / 2 + 0.03, dY - db.t / 2, z, {
      grain: 0,
      color: patchB ? kit.vary(0xb59a72, r, 0.06) : gray(0.62 + r() * 0.2),
      wear: 0.6 + r() * 0.4,
      bevel: 0.005,
    });
  }
  for (let x = LD.x0 + 0.3; x < LD.x1; x += 0.61)
    box(
      WOOD,
      0.045,
      0.2,
      LD.z1 - LD.z0 - 0.1,
      x,
      jb - 0.12,
      (LD.z0 + LD.z1) / 2,
      { grain: 2, color: gray(0.6), wear: 0.5 },
      0,
      0,
      0,
      D,
    );
  Fr.col.box(
    (LD.x0 + LD.x1) / 2,
    dY - 0.15,
    (LD.z0 + LD.z1) / 2,
    LD.x1 - LD.x0,
    0.3,
    LD.z1 - LD.z0,
    { tag: 'deck', surface: 'wood' },
  );
  const postL = (x, z, top = jb - 0.24) => {
    box(mat.wood(), 0.2, top, 0.2, x, top / 2 + 0.03, z, {
      grain: 1,
      color: postC(),
      wear: [0.7, 0.5],
      bevel: 0.01,
    });
    box(CONC, 0.32, 0.1, 0.32, x, 0.05, z, { color: 0xb9b5aa, wear: 0.8, bevel: 0.015 });
    Fr.col.box(x, top / 2, z, 0.22, top, 0.22, { tag: 'pile' });
  };
  for (const z of [LD.z0 + 0.12, LD.z1 - 0.12])
    for (const x of [LD.x0 + 0.12, (LD.x0 + LD.x1) / 2, LD.x1 - 0.14]) postL(x, z);
  // rails: canal (NE) side, the NW end, the SE side up to the stair-head pad, the short ends past the upper strip
  const e = 0.05,
    LS = P.lowerStair,
    UP = P.upper;
  // r10: the stair-head pad is on the NW side now (the NW rail stops at it; the SE side is one full run)
  railRun(LD.x1 - e, LD.z0 + e, LD.x1 - e, LD.z1 - e, { y: dY, noStart: true });
  railRun(LD.x0 + e, LD.z0 + e, LS.pad.x0, LD.z0 + e, { y: dY });
  railRun(LD.x0 + e, LD.z1 - e, LD.x1 - e, LD.z1 - e, { y: dY, noEnd: true });
  railRun(LD.x0 + e, LD.z0 + e, LD.x0 + e, UP.z0 - 0.02, { y: dY, noStart: true });
  railRun(LD.x0 + e, UP.z1 + 0.02, LD.x0 + e, LD.z1 - e, { y: dY, noEnd: true });
  // ---------- the stair from the lower deck down to the yard: head pad beside the deck's SE edge, one flight going -X (toward the house) ----------
  {
    const pd = LS.pad,
      w = LS.w,
      zc = LS.zc,
      n = LS.n ?? 13,
      run = LS.run ?? 0.28,
      rr = dY / (n + 1);
    for (let z = pd.z0 + pitch / 2; z < pd.z1 - 0.02; z += pitch)
      box(WOOD, pd.x1 - pd.x0, db.t, db.w, (pd.x0 + pd.x1) / 2, dY - db.t / 2, z, {
        grain: 0,
        color: gray(0.66 + r() * 0.2),
        wear: 0.6,
        bevel: 0.005,
      });
    for (const zz of [pd.z0 + 0.03, pd.z1 - 0.03])
      box(WOOD, pd.x1 - pd.x0, 0.22, 0.045, (pd.x0 + pd.x1) / 2, jb - 0.11, zz, {
        grain: 0,
        color: gray(0.7),
        wear: 0.5,
      });
    Fr.col.box(
      (pd.x0 + pd.x1) / 2,
      dY - 0.15,
      (pd.z0 + pd.z1) / 2,
      pd.x1 - pd.x0,
      0.3,
      pd.z1 - pd.z0,
      { tag: 'deck', surface: 'wood' },
    );
    for (const [x, z] of [
      [pd.x1 - 0.1, pd.z0 + 0.1],
      [pd.x0 + 0.1, pd.z0 + 0.1],
    ])
      postL(x, z, jb - 0.24);
    // the pad's rails (r10: NW side): NE end and NW side (to the flight's outer head newel), the flight's head is its -X edge
    railRun(pd.x1 - e, pd.z1, pd.x1 - e, pd.z0 + e, { y: dY, noStart: true });
    railRun(pd.x1 - e, pd.z0 + e, pd.x0 - 0.06, pd.z0 + e, { y: dY, noStart: true, noEnd: true });
    flight({
      x: pd.x0,
      z: zc,
      y0: dY,
      dir: [-1, 0],
      n,
      w,
      rise: rr,
      run,
      headNewels: true,
      tHead: -0.06,
      headBase: 0.05,
    });
    // foot step
    const fx = pd.x0 - n * run - 0.02 - 0.31;
    box(WOOD, 0.62, 0.06, w + 0.3, fx, 0.13, zc, {
      grain: 2,
      color: gray(0.86),
      wear: 0.6,
      bevel: 0.01,
    });
    Fr.col.box(fx, 0.08, zc, 0.62, 0.16, w + 0.3, { tag: 'deck', surface: 'wood' });
  }

  // ---------- the gym and grill deck (E / 19 / F) ----------
  {
    const IRON = mat.metalPaint(),
      RUBM = mat.rubber(),
      PLY = mat.pbr('plywood', { rep: 1.0, grunge: true }),
      BLK = 0x1b1b1c,
      y0 = dY,
      DG = Fr.groups.detail;
    const aging =
      (k = 0.85) =>
      (m) => {
        m.color?.multiplyScalar(k);
        m.roughness = Math.max(0.55, m.roughness ?? 0.6);
      };
    // iron plates (the user's 45 lb plate, scaled per size): ONE instanced mesh per plate sub-mesh for every plate on the deck
    const plateM = [],
      plate = (x, y, z, r2, ry = 0, rz = Math.PI / 2) => {
        const s = r2 / 0.225;
        plateM.push(
          new THREE.Matrix4().compose(
            new THREE.Vector3(x, y, z),
            new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry, rz, 'YXZ')),
            new THREE.Vector3(s, 1.2, s),
          ),
        );
      };
    ctx.async.push(
      glb(kit, 'plate_45.glb', {
        mat: (m) => {
          m.color.setRGB(0.16, 0.16, 0.17);
          m.metalness = 0.6;
          m.roughness = 0.55;
        },
      }).then((g) => {
        if (!g || !plateM.length) return;
        g.updateMatrixWorld(true);
        g.traverse((n) => {
          if (!n.isMesh) return;
          const im = new THREE.InstancedMesh(n.geometry, n.material, plateM.length);
          plateM.forEach((m, k) =>
            im.setMatrixAt(k, new THREE.Matrix4().multiplyMatrices(m, n.matrixWorld)),
          );
          im.instanceMatrix.needsUpdate = true;
          im.castShadow = true;
          im.receiveShadow = true;
          im.raycast = () => {};
          im.computeBoundingSphere();
          im.name = 'r8plates';
          DG.add(im);
        });
      }),
    );
    const bar = (x, y, z, len, ry, plates) => {
      D.cyl(STEEL, 0.014, 0.014, len, M(x, y, z, 0, ry, Math.PI / 2), { color: 0xb8b8b4, seg: 10 });
      const ux = Math.cos(ry),
        uz = -Math.sin(ry);
      for (const sd of [-1, 1])
        for (let k = 0; k < plates; k++)
          plate(
            x + ux * sd * (len / 2 - 0.14 - k * 0.045),
            y,
            z + uz * sd * (len / 2 - 0.14 - k * 0.045),
            0.225 - k * 0.03,
            ry,
          );
    };
    // patio table (long side along the deck), umbrella, four chairs: the NW half (E: nearest the slider's end of the strip)
    {
      const tx = 11.9,
        tz = -8.45, // r10 (playtest): the table, the bench and the mat stand against the canal-side rail
        GRAY = (m) => {
          m.color.setRGB(0.6, 0.61, 0.6);
          m.roughness = 0.75;
          m.metalness = 0;
          m.map = null;
          m.needsUpdate = true;
        };
      glb(kit, 'plastic_table.glb', {
        parent: DG,
        pos: [tx, y0, tz],
        ry: Math.PI / 2,
        scale: [1.5, 1, 1.0],
        mat: GRAY,
      });
      box(
        mat.paint({ peel: 'a', fade: 0, gloss: 0.5 }),
        0.21,
        0.004,
        0.28,
        tx - 0.1,
        y0 + 0.725,
        tz + 0.15,
        { color: 0xc94b3a, bevel: 0 },
        0,
        1.9,
        0,
        D,
      );
      D.cyl(STEEL, 0.02, 0.02, 2.3, M(tx, y0 + 1.15, tz), { color: 0xcfccc4, seg: 10 });
      // umbrella: white and yellow panels (E), a closed fabric shell with thickness, valance
      {
        const UMB = mat.art(
          'r8umb',
          512,
          64,
          (g, w, h) => {
            for (let i = 0; i < 8; i++) {
              g.fillStyle = i % 2 ? '#f3f0e6' : '#e8c22e';
              g.fillRect((i * w) / 8, 0, w / 8 + 1, h);
            }
          },
          { rough: 0.9 },
        );
        UMB.userData.uvScale = 0;
        const prof = [
            [0.001, 0.42],
            [0.5, 0.3],
            [1.05, 0.08],
            [1.12, 0.0],
            [1.1, -0.06],
            [1.02, 0.05],
            [0.45, 0.24],
            [0.001, 0.36],
          ],
          g = new THREE.LatheGeometry(
            prof.map(([a, b]) => new THREE.Vector2(a, b)),
            16,
          );
        B.geo(UMB, g, M(tx, y0 + 2.0, tz), {});
        g.dispose();
      }
      for (const [dx, dz, ry] of [
        [-0.78, -0.35, Math.PI / 2],
        [-0.78, 0.4, Math.PI / 2 + 0.15],
        [-0.1, 1.08, Math.PI + 0.1],
      ])
        glb(kit, 'plastic_chair.glb', { parent: DG, pos: [tx + dx, y0, tz + dz], ry, mat: GRAY });
      Fr.col.box(tx, y0 + 0.4, tz, 0.9, 0.8, 1.4, { tag: 'furniture' });
    }
    // the gym: bench with its loaded rack, plywood platform with a loose bar on its rubber mat, the plate tree, mats and kettlebells (SE half)
    {
      // r12 (user): the bench goes in the deck's corner (canal rail / SE end)
      const bx = 11.72,
        bz = -3.62;
      glb(kit, 'weight_bench.glb', {
        parent: DG,
        pos: [bx, y0, bz],
        ry: Math.PI / 2,
        mat: (m) => {
          const c = m.color,
            l = (c.r + c.g + c.b) / 3;
          m.map = null;
          if (l > 0.55) {
            c.setRGB(0.2, 0.2, 0.21);
            m.metalness = 0.6;
            m.roughness = 0.45;
          } else {
            c.setRGB(0.05, 0.05, 0.055);
            m.metalness = 0;
            m.roughness = 0.6;
          }
          m.needsUpdate = true;
        },
      });
      Fr.col.box(bx, y0 + 0.5, bz, 1.2, 1.0, 1.6, { tag: 'furniture' });
    }
    box(PLY, 1.2, 0.04, 2.2, 10.0, y0 + 0.02, -4.0, { color: 0xc9a77a, wear: 0.6, bevel: 0.006 });
    box(RUBM, 1.1, 0.02, 1.0, 10.0, y0 + 0.05, -4.0, { color: 0x151515, bevel: 0.004 });
    bar(10.0, y0 + 0.285, -4.0, 2.1, Math.PI / 2, 2);
    {
      const px = 12.05,
        pz = -4.85;
      D.cyl(IRON, 0.02, 0.02, 0.9, M(px, y0 + 0.45, pz), { color: BLK, seg: 8 });
      box(IRON, 0.5, 0.03, 0.5, px, y0 + 0.015, pz, { color: BLK });
      for (let k = 0; k < 5; k++)
        plate(
          px,
          y0 + 0.25 + k * 0.13,
          pz + (k % 2 ? 0.06 : -0.06),
          0.12 + (k % 3) * 0.04,
          0,
          Math.PI / 2,
        );
      Fr.col.cyl(px, y0 + 0.45, pz, 0.25, 0.9, { tag: 'prop' });
    }
    glb(kit, 'yoga_mat.glb', {
      parent: DG,
      pos: [11.95, y0 + 0.004, -6.05], // r12 (user): a little to the left (seen from the slider), where the bench stood
      ry: 0,
      mat: (m) => {
        m.color.setRGB(0.36, 0.62, 0.48);
        m.roughness = 0.85;
        m.map = null;
        m.needsUpdate = true;
      },
    }); // the green mat (E / 19)
    for (const [kx, kz, ks] of [
      [11.25, -5.35, 1],
      [11.27, -5.75, 0.8],
    ]) {
      lathe(
        D,
        IRON,
        [
          [0.001, 0],
          [0.09 * ks, 0.01],
          [0.11 * ks, 0.1 * ks],
          [0.08 * ks, 0.18 * ks],
          [0.001, 0.19 * ks],
        ],
        M(kx, y0 + 0.012, kz),
        { color: BLK, seg: 14 },
      );
      D.geo(
        IRON,
        new THREE.TorusGeometry(0.06 * ks, 0.014, 6, 16, Math.PI),
        M(kx, y0 + 0.012 + 0.19 * ks, kz),
        { color: BLK },
      );
    }
    // the gas grill against the NW rail (r12, user: off the stair head, which is at the rail's canal end), the red / white
    // cooler, a rope coil
    {
      const gx = 10.3,
        gz = -10.75;
      glb(kit, 'gas_grill.glb', { parent: DG, pos: [gx, y0, gz], ry: Math.PI, mat: aging(0.8) });
      Fr.col.box(gx, y0 + 0.5, gz, 1.05, 1.0, 0.62, { tag: 'prop' });
    }
    box(PL, 0.62, 0.36, 0.42, 9.25, y0 + 0.18, -10.75, { color: 0xb5332a, bevel: 0.03 });
    box(PL, 0.64, 0.06, 0.44, 9.25, y0 + 0.39, -10.75, { color: 0xeeeeea, bevel: 0.02 });
    Fr.col.box(9.25, y0 + 0.2, -10.75, 0.62, 0.42, 0.42, { tag: 'prop' });
    {
      const pts = [];
      for (let k = 0; k < 90; k++) {
        const t = k / 90,
          a = t * 6.283 * 5,
          rr = 0.06 + t * 0.16;
        pts.push([
          12.05 + Math.cos(a) * rr,
          y0 + 0.015 + (k % 18) * 0.0008,
          -9.75 + Math.sin(a) * rr,
        ]);
      }
      D.tube(mat.fabric('wool_boucle', { rep: 0.05 }), pts, 0.012, {
        seg: 6,
        color: 0xd9d2b8,
        steps: 150,
      });
    }
    // the yellow / blue zig-zag beach towel draped over the canal rail (E / 19): a real cloth sheet over the cap rail, folds, terry relief
    {
      const ZZ = mat.art(
        'r8towel',
        256,
        512,
        (g, w, h) => {
          g.fillStyle = '#f2c233';
          g.fillRect(0, 0, w, h);
          g.fillStyle = '#2e5fae';
          for (let y = 0; y < h; y += 64) {
            g.beginPath();
            for (let x = 0; x <= w; x += 32) g.lineTo(x, y + ((x / 32) % 2 ? 26 : 0));
            for (let x = w; x >= 0; x -= 32) g.lineTo(x, y + 18 + ((x / 32) % 2 ? 26 : 0));
            g.fill();
          }
          g.fillStyle = 'rgba(255,255,255,0.9)';
          g.fillRect(0, 0, w, 10);
          g.fillRect(0, h - 10, w, 10);
        },
        { rough: 0.98 },
      );
      const TM = new THREE.MeshStandardMaterial({
        map: ZZ.map,
        roughness: 1,
        metalness: 0,
        side: THREE.DoubleSide,
      });
      TM.name = 'r8towel:cloth';
      {
        const t = new THREE.TextureLoader().load(
          (import.meta.env?.BASE_URL ?? '/') + 'assets/models/keys/tex/towel_terry_normal.jpg',
        );
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.repeat.set(2, 4);
        TM.normalMap = t;
        TM.normalScale.set(1.2, 1.2);
      }
      const W2 = 0.72,
        Lt = 1.5,
        g = new THREE.PlaneGeometry(W2, Lt, 18, 48),
        pa = g.attributes.position,
        rx = LD.x1 - e,
        yTop = dY + 1.06,
        R2 = 0.08,
        zc = -7.35;
      for (let i = 0; i < pa.count; i++) {
        const u = pa.getX(i),
          v = pa.getY(i) + Lt / 2,
          a = (v - 0.62) / R2;
        let y, x;
        if (a < 0) {
          y = yTop - (0.62 - v);
          x = rx + R2;
        } else if (a < Math.PI) {
          y = yTop + Math.sin(a) * R2 * 0.6;
          x = rx + Math.cos(a) * R2;
        } else {
          y = yTop - (v - 0.62 - Math.PI * R2);
          x = rx - R2;
        }
        const fold =
          Math.sin(u * 17 + v * 2.1) * 0.012 * Math.min(1, Math.abs(yTop - y) * 2) +
          Math.sin(u * 7.3) * 0.006;
        pa.setXYZ(
          i,
          x + fold * Math.sign(x - rx || 1),
          y,
          zc + u * (1 + Math.max(0, yTop - y - 0.3) * 0.04),
        );
      }
      g.computeVertexNormals();
      const tw = new THREE.Mesh(g, TM);
      tw.name = 'r8_towel';
      tw.castShadow = true;
      tw.receiveShadow = true;
      tw.raycast = () => {};
      Fr.groups.detail.add(tw);
    }
    // Adirondack chairs on the upper strip by the window (E)
    {
      const AW = mat.wood(),
        ac = (x, z, ry) => {
          const g = kit.batch('r8adk');
          void g;
          for (let k = 0; k < 5; k++)
            box(
              AW,
              0.09,
              0.02,
              0.55,
              x - 0.2 + k * 0.1,
              P.F + 0.36,
              z,
              { grain: 2, color: kit.vary(0x8a7a66, r, 0.06), wear: 0.6 },
              0,
              ry,
            );
          for (let k = 0; k < 5; k++)
            box(
              AW,
              0.08,
              0.75,
              0.02,
              x - 0.18 + k * 0.09,
              P.F + 0.72,
              z + 0.32,
              { grain: 1, color: kit.vary(0x8a7a66, r, 0.06), wear: 0.6 },
              -0.35,
              ry,
            );
          for (const s of [-1, 1]) {
            box(
              AW,
              0.1,
              0.02,
              0.7,
              x + s * 0.32,
              P.F + 0.58,
              z + 0.02,
              { grain: 2, color: kit.vary(0x7a6a58, r, 0.05), wear: 0.6 },
              0,
              ry,
            );
            box(
              AW,
              0.05,
              0.58,
              0.05,
              x + s * 0.32,
              P.F + 0.29,
              z - 0.28,
              { grain: 1, color: 0x6f604f },
              0,
              ry,
            );
            box(
              AW,
              0.05,
              0.4,
              0.05,
              x + s * 0.32,
              P.F + 0.2,
              z + 0.26,
              { grain: 1, color: 0x6f604f },
              0,
              ry,
            );
          }
          Fr.col.box(x, P.F + 0.45, z, 0.75, 0.9, 0.85, { ry, tag: 'furniture' });
        };
      ac(7.7, -6.1, Math.PI / 2 + 0.2);
      ac(7.75, -4.9, Math.PI / 2 - 0.15);
    }
  }
  // ---------- the fluorescent tube under the house over the passage (C), string lights along the NW beam, downpipe and vines ----------
  {
    const tx = -1.0,
      tz = -5.4,
      ty = beamBot - 0.08,
      TUBE = mat.emissive(0xeaf4ff, 2.6, 'r8tube');
    box(PL, 0.12, 0.06, 1.3, tx, ty + 0.03, tz, { color: 0xd6d4cc, bevel: 0.01 }, 0, 0, 0, D);
    D.cyl(TUBE, 0.016, 0.016, 1.22, M(tx, ty - 0.02, tz, Math.PI / 2, 0, 0), { seg: 10 });
    const tl = Fr.light({
      id: 'r7_carport_tube',
      pos: [tx, ty - 0.2, tz],
      color: 0xdfeeff,
      intensity: 30,
      range: 8,
      on: false,
    });
    ctx.updaters.push((dt, env) => {
      const t = env?.timeOfDay ?? 12;
      tl.on = t < 6.3 || t > 18.4;
      TUBE.emissiveIntensity = tl.on ? 2.6 : 0.25;
    });
  }
  {
    const FIL = mat.emissive(0xffc477, 0.3, 'r8filament'),
      GL2 = new THREE.MeshPhysicalMaterial({
        color: 0xfff6e8,
        roughness: 0.05,
        metalness: 0,
        transparent: true,
        opacity: 0.28,
        depthWrite: false,
      });
    GL2.name = 'r8bulbGlass';
    const ys = beamBot - 0.06,
      zS = -10.4 + 0.12,
      x0s = -6.3,
      x1s = 2.1,
      hooks = 6,
      pts = [];
    for (let i = 0; i <= 80; i++) {
      const t = i / 80,
        x = x0s + t * (x1s - x0s),
        seg = t * hooks,
        f = seg - Math.floor(seg);
      pts.push([x, ys - 0.22 * 4 * f * (1 - f), zS]);
    }
    D.tube(mat.rubber(), pts, 0.004, { seg: 4, color: 0x111111, steps: 160 });
    for (let h = 0; h <= hooks; h++) {
      const x = x0s + (h / hooks) * (x1s - x0s);
      D.tube(
        STEEL,
        [
          [x, ys + 0.035, zS],
          [x, ys - 0.005, zS],
          [x + 0.02, ys - 0.02, zS],
        ],
        0.003,
        { seg: 4, color: 0x8a8a86, steps: 6 },
      );
    }
    const glassG = new THREE.SphereGeometry(0.028, 12, 9),
      bulbs = [];
    for (let i = 3; i < 80; i += 4) {
      const p = pts[i];
      D.cyl(mat.plastic(), 0.011, 0.011, 0.035, M(p[0], p[1] - 0.02, p[2]), {
        color: 0x151515,
        seg: 8,
      });
      D.cyl(FIL, 0.003, 0.003, 0.025, M(p[0], p[1] - 0.065, p[2]), { seg: 4 });
      bulbs.push([p[0], p[1] - 0.065, p[2]]);
    }
    const gm = new THREE.InstancedMesh(glassG, GL2, bulbs.length);
    bulbs.forEach((b, k) => gm.setMatrixAt(k, M(b[0], b[1], b[2])));
    gm.name = 'r8_string_glass';
    gm.raycast = () => {};
    gm.renderOrder = 8;
    Fr.groups.detail.add(gm);
    const sl = Fr.light({
      id: 'r7_string',
      pos: [(x0s + x1s) / 2, ys - 0.25, zS + 0.3],
      color: 0xffc98a,
      intensity: 18,
      range: 9,
      on: false,
    });
    ctx.updaters.push((dt, env) => {
      const t = env?.timeOfDay ?? 12,
        on = t < 6.6 || t > 18.3;
      FIL.emissiveIntensity = on ? 9.0 : 0.3;
      sl.on = on;
    });
  }
  {
    const WP = mat.plastic(),
      px = -2.2 + 0.17,
      pz = -3.6 + 0.08,
      yb = beamBot;
    D.cyl(WP, 0.04, 0.04, yb - 0.4, M(px, (yb + 0.4) / 2, pz), { color: 0xeeeeea, seg: 12 });
    D.tube(
      WP,
      [
        [px, 0.42, pz],
        [px, 0.3, pz],
        [px + 0.1, 0.16, pz],
        [px + 0.35, 0.12, pz],
      ],
      0.04,
      { seg: 10, color: 0xeeeeea, steps: 16 },
    );
  }
  {
    const VINE = mat.plastic(),
      MOSS = mat.matte();
    for (const [vx, vz] of [
      [-2.2, -3.6],
      [2.2, -3.6],
      [-2.2, -7.0],
      [-6.5, -3.6],
    ]) {
      const pts = [];
      for (let i = 0; i <= 40; i++) {
        const t = i / 40,
          a = t * 9 + vx;
        pts.push([vx + Math.cos(a) * 0.15, 0.05 + t * (beamBot - 0.1), vz + Math.sin(a) * 0.15]);
      }
      D.tube(VINE, pts, 0.008, { seg: 4, color: 0x4a5a2a, steps: 90 });
      for (let i = 2; i < 40; i += 2) {
        const p = pts[i];
        B.strut(
          VINE,
          p,
          [p[0] + Math.cos(i) * 0.12, p[1] + 0.08, p[2] + Math.sin(i) * 0.12],
          0.07,
          0.004,
          { color: kit.vary(0x4f7a32, r, 0.15), rand: r },
        );
      }
      for (let k = 0; k < 4; k++)
        box(
          MOSS,
          0.245,
          0.25 + r() * 0.3,
          0.245,
          vx,
          0.2 + r() * 0.4,
          vz,
          { color: kit.vary(0x4d5a32, r, 0.12), bevel: 0.01 },
          0,
          k * 0.4,
          0,
          D,
        );
    }
  }
  // r10: the trailer by the canal's end and the drive island's grass belong to the site (they do not turn with the house)
  const Fs = frame(ctx, 'site'),
    TB = kit.batch('r8annexS'),
    TD = kit.batch('r8annexSD');
  // ---------- the boat on its trailer at the canal's end (B / D) ----------
  {
    const bx = 9.6,
      bz = 15.5,
      MPt = mat.metalPaint(),
      RUB = mat.rubber();
    for (const s of [-1, 1])
      TB.strut(MPt, [bx - 2.6, 0.42, bz + s * 0.75], [bx + 2.0, 0.42, bz + s * 0.75], 0.08, 0.1, {
        color: 0x9a9c9c,
        rand: r,
      });
    TB.strut(MPt, [bx - 1.9, 0.4, bz], [bx - 3.4, 0.38, bz], 0.1, 0.1, {
      color: 0x9a9c9c,
      rand: r,
    });
    for (const s of [-1, 1]) {
      TD.cyl(RUB, 0.3, 0.3, 0.2, M(bx + 0.4, 0.3, bz + s * 0.95, Math.PI / 2, 0, 0), {
        color: 0x1a1a1a,
        seg: 18,
      });
      TD.cyl(STEEL, 0.14, 0.14, 0.21, M(bx + 0.4, 0.3, bz + s * 0.95, Math.PI / 2, 0, 0), {
        color: 0xbfc0bc,
        seg: 14,
      });
    }
    Fs.col.box(bx, 0.8, bz, 6.0, 1.6, 2.1, { tag: 'vehicle' });
    const lib = loadKeysModels(THREE, ['skiff']);
    ctx.async.push(
      lib.ready
        .then(() => {
          const nm = lib.names('skiff'),
            p = nm.length ? lib.piece('skiff', nm[0]) : null;
          if (!p) return;
          const g = new THREE.Group(),
            ext = new THREE.Vector3();
          p.box.getSize(ext);
          const inner = new THREE.Group();
          if (ext.z > ext.x) inner.rotation.y = Math.PI / 2;
          g.add(inner);
          for (const q of p.parts) {
            const m = new THREE.Mesh(q.geometry, q.material);
            m.castShadow = true;
            m.raycast = () => {};
            inner.add(m);
          }
          inner.updateMatrixWorld(true);
          const wb = new THREE.Box3().setFromObject(inner);
          const k = Math.min(1, 5.2 / Math.max(0.1, wb.max.x - wb.min.x));
          g.scale.setScalar(k);
          g.position.set(
            bx + 0.3 - ((wb.min.x + wb.max.x) / 2) * k,
            0.55 - wb.min.y * k,
            bz - ((wb.min.z + wb.max.z) / 2) * k,
          );
          Fs.groups.detail.add(g);
        })
        .catch(() => {}),
    );
  }
  // the tall bunch grass with purple flowers (B); front-door view (Nov 19): the drive island is gone, the clumps grow by the rocks
  // at the right edge of the dirt
  for (const [gx, gz, gs] of [
    [-24.46, 1.52, 1.0],
    [-18.86, 4.25, 0.8],
  ]) {
    const gy = ctx.yardY ? ctx.yardY(...Fs.toG(gx, gz)) : 0,
      GR = mat.plastic(),
      FL = mat.plastic(),
      q = kit.rng(1414 + gx * 10);
    for (let k = 0; k < 80 * gs; k++) {
      const a = q() * 6.283,
        d = Math.sqrt(q()) * 0.4 * gs,
        h = (0.6 + q() * 0.75) * gs,
        lean = 0.15 + q() * 0.35,
        bx = gx + Math.cos(a) * d,
        bz = gz + Math.sin(a) * d;
      TB.strut(
        GR,
        [bx, gy, bz],
        [bx + Math.cos(a) * lean * h, gy + h, bz + Math.sin(a) * lean * h],
        0.018,
        0.003,
        { color: kit.vary(k % 5 ? 0x6f8a3a : 0x9a9a52, q, 0.12), rand: q },
      );
      if (k % 3 === 0)
        TD.geo(
          FL,
          new THREE.SphereGeometry(0.028, 6, 5),
          M(bx + Math.cos(a) * lean * h, gy + h + 0.02, bz + Math.sin(a) * lean * h),
          { color: kit.vary(0x8e4fb5, q, 0.1) },
        );
    }
  }
  // r10: the user's potted palms on the decks: the dead end of the front walkway (past the door) and the SE end of the upper back strip
  // r11: the user's flowering urn and caladium bowl replace the palms
  userPot(ctx, Fr, 'urn', P.walk.x0 + 0.55, P.F, P.walk.z0 + 0.5, { s: 1.0, ry: 1.3 });
  userPot(ctx, Fr, 'caladium', P.upper.x1 - 0.4, P.F, P.upper.z1 - 0.38, { s: 1.0, ry: 2.4 });
  Fr.anchor('annexDoor', A.x0 - 0.8, 0, A.door, -Math.PI / 2);
  B.build(Fr.groups.ext);
  D.build(Fr.groups.detail);
  TB.build(Fs.groups.ext);
  TD.build(Fs.groups.detail);
  for (const g of [Fr.groups.ext, Fr.groups.detail, Fs.groups.ext, Fs.groups.detail])
    g.traverse((o) => {
      const m = o.material;
      if (!m || m.userData?.r4matte || m.transparent) return;
      m.userData.r4matte = true;
      m.envMapIntensity = Math.min(m.envMapIntensity ?? 1, m.metalness > 0.5 ? 0.6 : 0.35);
    });
}
