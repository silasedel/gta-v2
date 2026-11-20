// Nico's house, part 05: the lot. Crushed-shell and sand yard with damp patches and puddles, the carport slab, concrete
// seawalls on the two water sides, the sandy bottom beyond them, and the weathered dock with its piles, cleats, rope,
// fish-cleaning station, ladder and light.
import { makeGroundMaterial } from '../../../ground/groundMaterial.js';
import { WEEDS, DRIVE, DRIVE_PUDDLE } from '../yard.data.js';
import {
  R4,
  R8,
  P4,
  toS,
  toG,
  terraceY,
  houseBlock,
  measureSite,
  StoH,
  HtoS,
  HtoB,
  inCanal,
  inCanalH,
  inR as inRect,
} from '../r4/plan4.js';
export const order = 5;
// ground pass: the yard sheet uses the terrain's Keys-yard ground (user's sand / grassy-sand scans, hex-tiled) so it matches the
// lots around it; ?ground2=0 keeps the old shell-floor texture
const GROUND2 = typeof location === 'undefined' || !/[?&]ground2=0\b/.test(location.search);
let yardMat = null;

export function build(ctx) {
  const { THREE, kit, plan: P, mat, col } = ctx,
    B = ctx.site ?? ctx.ext,
    D = ctx.detail,
    M = kit.M,
    r = kit.rng(55),
    L = P.lot,
    sea = P.seaY;
  // ---------- yard: one subdivided sheet, vertex colors blend shell drive, pale sand, damp shade and grassy edges ----------
  // keys pass (Nov 17): the bay is ~15 m beyond the old seawall line in the retraced map; a seawall stands only where the water
  // really meets the lot (opts.waterAt), elsewhere the yard runs on and sinks under the beach sand along a wobbly line
  if (R4) {
    measureSite(ctx.opts.waterAt);
    ctx.r4site = { oz: P4.oz, wallZ: P4.wallZ, canal: P4.canal.on, ...(P4.measured || {}) };
    ctx.r7water = (sx, sz) => !P4.canal.fake && inCanal(sx, sz, -0.05);
  }
  const waterAt = ctx.opts.waterAt,
    wallN = !R4 && (!waterAt || [-20, -10, 0, 8].some((x) => waterAt(x, L.z0 - 2))),
    wallE = !R4 && (!waterAt || [-10, 0, 10, 20].some((z) => waterAt(L.x1 + 2, z)));
  const OPEN_N = !wallN,
    OPEN_E = !wallE;
  ctx.siteWalls = { N: wallN, E: wallE }; // 50_plants keeps its seawall-edge vines / sea oats only where a seawall stands
  // r2-keys (Nov 17): the house is turned in a corner lot (yard.data.js): the sheet runs out to the asphalt of the east leg (front)
  // and the west leg (west side) and sinks under it, follows the drive from the STOP corner past the pickup (DRIVE), and has gentle
  // swells (+-0.2 m) with a low spot at the drive end that holds the after-rain puddle
  // shell fragments read in the normal map without crunchy grazing-angle noise (r2-art: sand class 0.8-1.0) or fine speckle at distance
  // (lead): rep 3.2 m, nscale 0.85
  const SHELL = mat.pbr('shell_floor_01', {
      rep: 3.2,
      gain: 1.5,
      grunge: true,
      nscale: 0.85,
      flat: 0.55,
    }),
    x0 = L.x0 - 10,
    x1 = R4 ? 30 : L.x1 + (OPEN_E ? 2 : -0.2),
    z0 = R4 ? -37 : L.z0 + (OPEN_N ? -3 : 0.2),
    z1 = L.z1 + 8;
  // the shell yard is GROUND, not pavement: the ground mask (src/world/ground/surfaceMask.js autoVeg) treats every flat set-piece mesh
  // as paved unless its material name starts with 'ground:'; as 'paved' it removed every yard plant instance standing on the sheet
  if (!SHELL.name.startsWith('ground:')) SHELL.name = 'ground:' + SHELL.name;
  // porous crushed shell does not turn into a mirror after rain (lead review): out of the global wet sheen; the standing water comes
  // from the drive-end puddle (patchPuddles, nicoHouse.v2.js) and the small always-wet corner puddle (part 55)
  SHELL.defines = { ...(SHELL.defines || {}), NO_WET: '' };
  const gA = ctx.opts.groundAt || (() => 0),
    rdF = ctx.opts.roadDist || (() => 25);
  // asphalt distance on a 1 m grid (bilinear): ~2.5k road queries once, then every surface query is cheap
  const RG = (() => {
    const nx = Math.ceil(x1 - x0) + 2,
      nz = Math.ceil(z1 - z0) + 2,
      a = new Float32Array(nx * nz);
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) a[j * nx + i] = rdF(x0 + i, z0 + j);
    return { nx, nz, a };
  })();
  const roadD = (x, z) => {
    const fx = Math.max(0, Math.min(RG.nx - 1.001, x - x0)),
      fz = Math.max(0, Math.min(RG.nz - 1.001, z - z0)),
      i = fx | 0,
      j = fz | 0,
      u = fx - i,
      v = fz - j,
      A = RG.a,
      n = RG.nx;
    return (
      (A[j * n + i] * (1 - u) + A[j * n + i + 1] * u) * (1 - v) +
      (A[(j + 1) * n + i] * (1 - u) + A[(j + 1) * n + i + 1] * u) * v
    );
  };
  const segD = (x, z, pts) => {
    let best = 1e9;
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az] = pts[i],
        [bx, bz] = pts[i + 1],
        dx = bx - ax,
        dz = bz - az,
        t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
      best = Math.min(best, Math.hypot(x - ax - dx * t, z - az - dz * t));
    }
    return best;
  };
  const driveD = (x, z) =>
    Math.min(
      segD(x, z, DRIVE.main),
      segD(x, z, DRIVE.branch) + 0.4,
      DRIVE.loop ? segD(x, z, DRIVE.loop) + 0.9 : 1e9,
    ); // r7e: + the loop round the island (a little narrower)
  ctx.driveD = driveD;
  {
    const nx = 92,
      nz = 110,
      g = new THREE.PlaneGeometry(x1 - x0, z1 - z0, nx, nz);
    g.rotateX(-Math.PI / 2);
    g.translate((x0 + x1) / 2, 0, (z0 + z1) / 2);
    const pa = g.attributes.position,
      cols = new Float32Array(pa.count * 3),
      n2 = (x, z) =>
        Math.sin(x * 0.37 + Math.sin(z * 0.23) * 2) * Math.cos(z * 0.31 + Math.sin(x * 0.19) * 2);
    const PX = DRIVE_PUDDLE.x,
      PZ = DRIVE_PUDDLE.z;
    // the sheet's height at a plan point (also ctx.yardY: decals, puddles and props of part 55 follow the same surface)
    // r4: flat under the new house footprint (S frame), the lawn terrace rising to the bulkhead, the sheet sinking beyond the wall
    // line and past the lot's east / west ends (S frame) so it never runs over the neighbors' yards
    const underAt = (x, z) => {
      if (!R4) return x > -8.6 && x < 8 && z > -6.4 && z < 8 ? 1 : 0;
      const [sx, sz] = toS(x, z);
      const inP = (Pv) =>
        sx > Pv.x0 - 0.6 && sx < Pv.x1 + 0.6 && sz > Pv.z0 - 0.6 && sz < Pv.z1 + 0.6;
      if (R8) {
        const [hx, hz] = HtoB(...StoH(sx, sz));
        return houseBlock(sx, sz, 0.8) || inRect(P4.pad, hx, hz, 0.6) ? 1 : 0;
      }
      return houseBlock(sx, sz, 0.8) || inP(P4.pavers) || inP(P4.court) ? 1 : 0;
    }; // r7: flat under the paved carport floor too
    const edgeS = (x, z) => {
      if (!R4) return 99;
      const [sx, sz] = toS(x, z);
      if (R8) {
        const [hx, hz] = StoH(sx, sz);
        return Math.min(
          hx + 30,
          33 - hz,
          hz > P4.canal.z1 + 0.5 ? 27 - hx : 99,
        ); /* r8: the bulkheads hold the fill on the bay and canal sides */
      }
      return Math.min(
        sx < P4.wallX0 || sx > P4.wallX1 ? sz - P4.wallZ + 1.5 : 99,
        19 - sx,
        sx + 26,
      );
    };
    const yardY = (x, z) => {
      const dd = driveD(x, z),
        drive = Math.max(0, 1 - dd / (DRIVE.halfWidth + 1.2)),
        under = underAt(x, z),
        near = Math.max(
          0,
          Math.min(
            1,
            Math.hypot(
              Math.max(0, Math.abs(x + 1.5) - 11.5),
              Math.max(0, Math.abs(z - 0.25) - 8.75),
            ) / 5,
          ),
        ); // flat around the house, its stairs, pads and pots
      const dEdge =
          Math.min(x - x0, z1 - z, OPEN_E ? x1 - x : 99, OPEN_N ? z - z0 : 99, edgeS(x, z)) -
          0.4 -
          (n2(x * 0.11, z * 0.13) * 0.5 + 0.5) * 4 -
          (n2(x * 0.5, z * 0.45) * 0.5 + 0.5) * 1.5,
        keep = Math.min(1, Math.max(0, dEdge / 2));
      const rd = roadD(x, z),
        road = Math.min(1, Math.max(0, R8 ? (2.5 - rd) / 5.0 : (1.1 - rd) / 1.4)),
        sink = Math.max(1 - keep, road); // r8: the raised lot ramps over ~5 m to the asphalt
      const swell =
        (n2(x * 0.09 + 1.3, z * 0.08 - 0.7) * 0.13 + n2(x * 0.21 - 2.1, z * 0.17 + 0.4) * 0.06) *
        near *
        (1 - drive * 0.7); // gentle relief, flat at the house and along the drive
      const bowl = -0.09 * Math.exp(-((x - PX) ** 2 + (z - PZ) ** 2) / 5.5); // the drive-end low spot (puddle)
      const fine =
        (n2(x * 2.3, z * 2.1) * 0.012 + n2(x * 0.6, z * 0.7) * 0.025) *
        (1 - under) *
        (1 - drive * 0.5);
      // never under the terrain inside the yard: where a swell dips below the terrain surface the terrain's own triangles poked
      // through as straight-edged patches (user review shot_27); the low spots bottom out 2 cm over it instead
      const y = Math.max((fine + swell + bowl) * (1 - under * 0.8), gA(x, z) + 0.02);
      const yT = R4 ? terraceY(...toS(x, z)) : 0;
      return y + yT + (Math.min(0, gA(x, z)) - 0.3 - y - yT) * Math.sqrt(sink);
    }; // steep dive at the edges: one crossing line with the terrain, no coplanar band   // at the asphalt and the open edges: under the terrain surface
    ctx.yardY = yardY;
    for (let i = 0; i < pa.count; i++) {
      const x = pa.getX(i),
        z = pa.getZ(i),
        dd = driveD(x, z),
        drive = Math.max(0, 1 - dd / (DRIVE.halfWidth + 1.2));
      const under = underAt(x, z),
        n = n2(x, z) * 0.5 + 0.5,
        edge = Math.min(1, Math.max(0, (Math.hypot(x + 2, z - 2) - 19) / 12));
      const nB = n2(x * 0.17 + 3.1, z * 0.21 - 1.7) * 0.5 + 0.5,
        nC = n2(x * 0.71 - 2.3, z * 0.63 + 0.9) * 0.5 + 0.5; // macro + mid breakup
      // r2-art / r2-look calibration: the shell scan is warm (linear mean 0.29, 0.24, 0.18) and the material gain is 1.5, so these per-channel
      // multipliers land the floor at luminance ~0.46, saturation < 0.1 (crushed shell 0.42-0.52, near neutral), before the breakup below
      let c = [1.1, 1.32, 1.69]; // QA first-minutes #19: a notch less white (x0.92)
      c = c.map((v) => v * (0.76 + 0.34 * n) * (0.86 + 0.24 * nC) * (1 - 0.28 * under));
      // r7 (playtest item 6, mock-up 01): the drive reads as a clear compacted dirt-and-shell track: a crisper core, warmer and darker
      // than the pale shell around it, the ruts darker still
      const core = R4
        ? Math.max(0, Math.min(1, (DRIVE.halfWidth + 0.25 - dd) / 0.9)) * (0.85 + 0.15 * nC)
        : 0;
      if (core > 0) {
        const DIRT = R8 ? [0.8, 0.74, 0.64] : [0.9, 0.85, 0.76];
        for (let k = 0; k < 3; k++) c[k] *= 1 + (DIRT[k] - 1) * core;
      }
      const damp =
        Math.min(1, Math.max(0, nB - 0.55) * 2.6 * (1 - drive * 0.4)) +
        0.5 * Math.exp(-((x - PX) ** 2 + (z - PZ) ** 2) / 9) +
        drive * Math.max(0, nC - 0.45) * 1.4;
      c = c.map((v, k) => v * (1 - 0.24 * Math.min(1, damp) * [1, 1.02, 1.06][k])); // damp hollows (soft: one continuous floor, not patches)
      const grass = R4
        ? Math.min(
            1,
            edge * 0.85 + 0.3 + 0.9 * Math.max(0, n - 0.1) + 0.45 * Math.max(0, nC - 0.5),
          ) *
          (1 - core) *
          (1 - 0.7 * under) // r7: patchy grass right up to the drive edges (01), the drive itself bare
        : Math.min(
            1,
            edge * 0.85 + (1 - drive) * 0.7 * Math.max(0, n - 0.3) + 0.45 * Math.max(0, nC - 0.5),
          ); // r7: patchy grass right up to the drive edges (01)
      c = [c[0] * (1 - 0.42 * grass), c[1] * (1 - 0.28 * grass), c[2] * (1 - 0.5 * grass)]; // matted gray-green grass
      {
        const dm = segD(x, z, DRIVE.main),
          rut = Math.exp(-((dm - 0.85) ** 2) / 0.05);
        c = c.map((v) => v * (1 - (R8 ? 0.22 : 0.1) * rut));
      } // faint tire ruts
      {
        // toward the open edges and the asphalt the shell yard takes on the terrain's sand tone, so where the sheet dips under it
        // there is no pale-on-tan cut line
        const dE =
            Math.min(
              x - x0,
              z1 - z,
              OPEN_E ? x1 - x : 99,
              OPEN_N ? z - z0 : 99,
              (roadD(x, z) + 0.5) * 2.2,
            ) -
            (n2(x * 0.11, z * 0.13) * 0.5 + 0.5) * 4,
          f = Math.max(0, Math.min(1, 1 - (dE - 0.5) / 5));
        const SAND = [1.22, 1.36, 1.56]; // the terrain ring around the lot is shell too (r2-ground): a slightly warmer, sandier shell
        for (let k = 0; k < 3; k++) c[k] = c[k] + (SAND[k] - c[k]) * f * 0.85;
      }
      if (R4) {
        const [sx, sz] = toS(x, z),
          lawn = R8
            ? (() => {
                const [hx, hz] = StoH(sx, sz);
                return Math.max(0, Math.min(1, (-11.2 - hz) / 3)) * (hx < P4.canal.x0 ? 1 : 0);
              })()
            : Math.max(0, Math.min(1, (-11.5 - sz) / 4)) * (1 - 0.25 * Math.max(0, nB - 0.6)),
          lt = Math.min(1, lawn * (0.9 + 0.2 * nC));
        const LAWN = [0.42 + 0.12 * n, 0.62 + 0.14 * nC, 0.2 + 0.06 * n]; // thick green St. Augustine lawn, a little patchy
        for (let k = 0; k < 3; k++) c[k] = c[k] + (LAWN[k] - c[k]) * lt;
        void sx;
      }
      cols[i * 3] = c[0];
      cols[i * 3 + 1] = c[1];
      cols[i * 3 + 2] = c[2];
      pa.setY(i, yardY(x, z));
    }
    g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    g.computeVertexNormals();
    if (R8) {
      const ix = g.index.array,
        keep = [],
        out = new Uint8Array(pa.count),
        W = P4.wallZ,
        Cn = P4.canal;
      // r8: the sheet stops at the bay bulkhead (H z = wallZ) and at the canal's walls; vertices past them snap onto the wall line, just
      // under the cap; the far side of the canal (the neighbor's land) and the bay are not the yard
      for (let i = 0; i < pa.count; i++) {
        const [hx, hz] = StoH(...toS(pa.getX(i), pa.getZ(i)));
        out[i] = hz < W + 0.1 ? 1 : inCanalH(hx, hz, 0.1) ? 2 : 0;
      } /* r8: the neighbor's strip beyond the canal is sheeted too (built up behind its own bulkhead) until the world carries it */
      for (let t = 0; t < ix.length; t += 3) {
        const a = ix[t],
          b = ix[t + 1],
          d = ix[t + 2];
        if (out[a] && out[b] && out[d]) continue;
        if (out[a] === 3 || out[b] === 3 || out[d] === 3) continue;
        keep.push(a, b, d);
      }
      for (let i = 0; i < pa.count; i++) {
        if (!out[i] || out[i] === 3) continue;
        let [hx, hz] = StoH(...toS(pa.getX(i), pa.getZ(i)));
        let ox = 0,
          ozz = 0;
        if (out[i] === 1) {
          hz = W + 0.1;
          ozz = 0.12;
        } else {
          const dl = hx - (Cn.x0 - 0.1),
            dr = Cn.x1 + 0.1 - hx,
            de = Cn.z1 + 0.1 - hz;
          if (de < dl && de < dr) {
            hz = Cn.z1 + 0.1;
            ozz = 0.12;
          } else if (dl < dr) {
            hx = Cn.x0 - 0.1;
            ox = -0.12;
          } else {
            hx = Cn.x1 + 0.1;
            ox = 0.12;
          }
        }
        const [gx, gz] = toG(...HtoS(hx, hz));
        pa.setX(i, gx);
        pa.setZ(i, gz);
        pa.setY(i, yardY(...toG(...HtoS(hx + ox, hz + ozz))) - 0.02);
      }
      {
        const hx = new Float32Array(pa.count),
          hz = new Float32Array(pa.count);
        for (let i = 0; i < pa.count; i++) {
          const h = StoH(...toS(pa.getX(i), pa.getZ(i)));
          hx[i] = h[0];
          hz[i] = h[1];
        }
        const k2 = [];
        for (let t = 0; t < keep.length; t += 3) {
          const a = keep[t],
            b = keep[t + 1],
            d = keep[t + 2],
            cx = (hx[a] + hx[b] + hx[d]) / 3,
            cz = (hz[a] + hz[b] + hz[d]) / 3,
            mn = Math.min(hx[a], hx[b], hx[d]),
            mx = Math.max(hx[a], hx[b], hx[d]);
          if (inCanalH(cx, cz, -0.05) || (mn < Cn.x0 - 0.02 && mx > Cn.x1 + 0.02 && cz < Cn.z1))
            continue;
          k2.push(a, b, d);
        } /* no sheet across the canal (its far bank is sheeted too) */
        g.setIndex(k2);
      }
      pa.needsUpdate = true;
    } else if (R4) {
      const ix = g.index.array,
        keep = [],
        lim = P4.wallZ + 0.1,
        inWall = (sx) => sx > P4.wallX0 + 0.3 && sx < P4.wallX1 - 0.3,
        out = new Uint8Array(pa.count);
      for (let i = 0; i < pa.count; i++) {
        const [sx, sz] = toS(pa.getX(i), pa.getZ(i));
        out[i] = inWall(sx) && sz < lim ? 1 : inCanal(sx, sz, 0.1) ? 2 : 0;
      }
      for (let t = 0; t < ix.length; t += 3) {
        const a = ix[t],
          b = ix[t + 1],
          d = ix[t + 2];
        if (out[a] && out[b] && out[d]) continue;
        keep.push(a, b, d);
      }
      for (let i = 0; i < pa.count; i++)
        if (out[i] === 1) {
          const [sx] = toS(pa.getX(i), pa.getZ(i)),
            [gx, gz] = toG(sx, lim);
          pa.setX(i, gx);
          pa.setZ(i, gz);
          pa.setY(i, yardY(...toG(sx, lim + 0.12)) - 0.02);
        }
      // r7: the canal (item 12): sheet vertices in the water snap to the nearest canal wall line, just under the wall cap
      const C = P4.canal;
      for (let i = 0; i < pa.count; i++)
        if (out[i] === 2) {
          let [sx, sz] = toS(pa.getX(i), pa.getZ(i));
          const dl = sx - (C.x0 - 0.1),
            dr = C.x1 + 0.1 - sx,
            de = C.z1 + 0.1 - sz;
          let ox = 0,
            ozz = 0;
          if (de < dl && de < dr) {
            sz = C.z1 + 0.1;
            ozz = 0.12;
          } else if (dl < dr) {
            sx = C.x0 - 0.1;
            ox = -0.12;
          } else {
            sx = C.x1 + 0.1;
            ox = 0.12;
          }
          const [gx, gz] = toG(sx, sz);
          pa.setX(i, gx);
          pa.setZ(i, gz);
          pa.setY(i, yardY(...toG(sx + ox, sz + ozz)) - 0.02);
        }
      g.setIndex(keep);
      pa.needsUpdate = true;
    }
    // keys pass (lead review, Nov 17): the mock-up yard is PALE crushed shell and limestone dust, not the terrain's tan sand; the
    // shell scan carries it, vertex colors add gray-green matted grass, damp dark patches and the ruts. ?keysyard=terrain = old look
    const TERRAIN_YARD =
      GROUND2 && typeof location !== 'undefined' && /[?&]keysyard=terrain\b/.test(location.search);
    B.geo(
      TERRAIN_YARD ? (yardMat ||= makeGroundMaterial(globalThis.game?.renderer || null)) : SHELL,
      g,
      null,
      { keepColor: true, uvMul: [(x1 - x0) / 3.2, (z1 - z0) / 3.2], wear: 0.5 },
    );
    g.dispose();
    // ground collider (r2-keys): a heightfield that follows the sheet's swells (feet and tires sit on what is drawn), over the yard
    // only; at the asphalt and the open edges the terrain's own collider carries on (the sheet is under it there)
    {
      const hx0 = L.x0 - 2,
        hx1 = R4 ? x1 : Math.min(x1, L.x1),
        hz0 = R4 ? z0 : Math.max(z0, L.z0),
        hz1 = L.z1 + 1,
        nX = Math.round((hx1 - hx0) / 0.5),
        nZ = Math.round((hz1 - hz0) / 0.5),
        hs = new Float32Array((nX + 1) * (nZ + 1));
      for (let j = 0; j <= nX; j++)
        for (let i2 = 0; i2 <= nZ; i2++) {
          const x = hx0 + ((hx1 - hx0) * j) / nX,
            z = hz0 + ((hz1 - hz0) * i2) / nZ;
          hs[j * (nZ + 1) + i2] = yardY(x, z) - (roadD(x, z) < 0.3 || x < x0 + 6 ? 0.06 : 0);
          // r7 (playtest item 8, Nico floated over the dock): beyond the bulkhead the collider drops to the sea bed (it stayed at the
          // lawn height over the water, ~0.4 m above the dock boards, where the drawn sheet had been clipped at the wall)
          if (R8) {
            const [hx, hz] = StoH(...toS(x, z));
            if (hz < P4.wallZ + 0.05 || inCanalH(hx, hz, -0.05)) hs[j * (nZ + 1) + i2] = sea - 3.0;
          } else if (R4) {
            const [sx, sz] = toS(x, z);
            if (
              (sz < P4.wallZ + 0.05 && sx > P4.wallX0 - 0.5 && sx < P4.wallX1 + 0.5) ||
              (ctx.r7water && ctx.r7water(sx, sz))
            )
              hs[j * (nZ + 1) + i2] = sea - 3.0;
          }
        }
      ctx.colliders.push({
        shape: 'hf',
        p: [(hx0 + hx1) / 2, 0, (hz0 + hz1) / 2],
        nrows: nZ,
        ncols: nX,
        heights: hs,
        scale: [hx1 - hx0, 1, hz1 - hz0],
        q: [0, 0, 0, 1],
        tag: 'ground',
        surface: 'gravel',
        enabled: true,
      });
      col.box((hx0 + hx1) / 2, R4 ? sea - 4.6 : -1.6, (hz0 + hz1) / 2, hx1 - hx0, 2.6, hz1 - hz0, {
        tag: 'ground',
        surface: 'gravel',
      });
    } // r7: under the sea bed (it stood 0.15 m under the water surface off the bulkhead)   // backstop under it   // not over the open beach edges (the terrain carries those)
  }
  // (r2-keys: the rut puddles of the old straight drive are gone; part 55 PUDDLES lie along the new drive)
  // carport slab: old broom-finished concrete with a crack line and oil stains
  const SLAB = mat.pbr('scuffed_cement', { rep: 2.2, gain: 3.4, tint: 0xbcd2ff, grunge: true }); // r2-art: neutral concrete (the scan is brown)
  if (!R4)
    for (const [cx, cz, sx, sz] of [
      [0.6, 0.6, 2.75, 7.4],
      [3.4, 0.6, 2.75, 7.4],
      [6.15, 0.6, 2.7, 7.4],
      [3.4, 6.15, 8.3, 3.6],
    ])
      B.box(SLAB, sx - 0.004, 0.1, sz - 0.004, M(cx, 0.0, cz), {
        color: kit.vary(0xbdb8aa, r, 0.05),
        wear: 0.9,
        bevel: 0.012,
        rand: r,
      });
  // ---------- seawalls ----------
  const SW = mat.concrete({ marine: true });
  const wall = (ax, az, bx, bz) => {
    const len = Math.hypot(bx - ax, bz - az),
      n = Math.ceil(len / 4.9),
      ry = Math.atan2(-(bz - az), bx - ax);
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n,
        x = ax + (bx - ax) * t,
        z = az + (bz - az) * t;
      B.box(SW, len / n - 0.015, 3.4, 0.3, M(x, 0.1 - 1.7, z, 0, ry, 0), {
        color: kit.vary(0xc4bfb0, r, 0.06),
        wear: 1,
        bevel: 0.01,
        rand: r,
      });
      if (!(
        Math.abs(z - P.lot.z0) < 0.5 &&
        x + len / n / 2 > P.dock.x0 - 0.3 &&
        x - len / n / 2 < P.dock.x1 + 0.3
      ))
        B.box(SW, len / n - 0.01, 0.16, 0.5, M(x, 0.16, z, 0, ry, 0), {
          color: kit.vary(0xd0cabb, r, 0.05),
          wear: 0.8,
          bevel: 0.02,
          rand: r,
        });
    } // no cap poking up under the dock
    col.box((ax + bx) / 2, -1.2, (az + bz) / 2, len, 2.9, 0.5, { ry, tag: 'seawall' });
  };
  if (wallN) wall(L.x0 - 22, L.z0, L.x1 + 0.15, L.z0);
  if (wallE) wall(L.x1, L.z0 - 0.15, L.x1, L.z1 + 22);
  if (wallN || wallE) {
    const g = new THREE.PlaneGeometry(400, 400, 1, 1);
    g.rotateX(-Math.PI / 2);
    B.geo(
      mat.pbr('sand_01', { rep: 5, gain: 1.6, grunge: true }),
      g,
      M(L.x1 - 60, sea - 1.5, L.z0 + 40),
      { color: [0.75, 0.82, 0.7], uvMul: [80, 80] },
    );
    g.dispose();
  }
  // ---------- dock (old plank dock: only when part 06 has no measured waterline) ----------
  if (!P.dock.kit && !R4) {
    const Dk = P.dock,
      W = mat.wood({ marine: true }),
      WD = mat.wood(),
      ST = mat.steel(),
      y = Dk.y;
    const board = (cx, cz, lx) =>
      B.box(
        WD,
        lx,
        0.04,
        0.14,
        M(cx, y - 0.02 + (r() - 0.5) * 0.004, cz, 0, (r() - 0.5) * 0.004, (r() - 0.5) * 0.008),
        {
          grain: 0,
          color: kit.vary(r() < 0.06 ? 0xb49a70 : 0x8f887c, r, 0.12),
          wear: 0.4 + r() * 0.5,
          bevel: 0.005,
          rand: r,
        },
      );
    for (let z = Dk.z0 + 0.08; z < Dk.z1 - 0.02; z += 0.147) {
      if (z < Dk.headZ1) board((Dk.headX0 + Dk.headX1) / 2, z, Dk.headX1 - Dk.headX0);
      else board((Dk.x0 + Dk.x1) / 2, z, Dk.x1 - Dk.x0 + (r() - 0.5) * 0.03);
    }
    for (const x of [Dk.x0 + 0.1, (Dk.x0 + Dk.x1) / 2, Dk.x1 - 0.1])
      B.box(W, 0.07, 0.24, Dk.z1 - Dk.z0, M(x, y - 0.16, (Dk.z0 + Dk.z1) / 2), {
        grain: 2,
        color: 0x6f675c,
        wear: 0.8,
        bevel: 0.006,
      });
    for (const z of [Dk.headZ0 + 0.1, Dk.headZ1 - 0.1])
      B.box(W, Dk.headX1 - Dk.headX0, 0.24, 0.07, M((Dk.headX0 + Dk.headX1) / 2, y - 0.16, z), {
        grain: 0,
        color: 0x6f675c,
        wear: 0.8,
        bevel: 0.006,
      });
    const pile = (x, z, top) => {
      const rr = 0.13 + r() * 0.03,
        h = top - (sea - 2.4),
        lean = (r() - 0.5) * 0.04;
      B.cyl(W, rr * 0.88, rr, h, M(x, top - h / 2, z, lean, r() * 6, lean * 0.6), {
        seg: 12,
        hseg: 4,
        color: kit.vary(0x7d7467, r, 0.12),
        wear: 1,
      });
      if (top > y + 0.3) {
        B.cyl(ST, rr * 0.9 + 0.012, rr * 0.9 + 0.012, 0.012, M(x, top + 0.004, z), {
          seg: 12,
          color: 0x9a8f80,
        });
        for (let k = 0; k < 4; k++)
          B.geo(
            mat.fabric('wool_boucle', { rep: 0.05 }),
            new THREE.TorusGeometry(rr + 0.012, 0.014, 6, 16),
            M(x, top - 0.16 - k * 0.03, z, Math.PI / 2, 0, 0),
            { color: 0xcdbf9a },
          );
      }
      col.cyl(x, y, z, rr + 0.02, top - y + 2.4, { tag: 'pile' });
    };
    for (let z = Dk.z1 - 0.5; z > Dk.headZ1; z -= 2.9) {
      pile(Dk.x0 - 0.1, z, y + (r() > 0.5 ? 0.95 : 0.1));
      pile(Dk.x1 + 0.1, z, y + (r() > 0.4 ? 1.0 : 0.1));
    }
    for (const x of [Dk.headX0 - 0.1, Dk.headX1 + 0.1])
      for (const z of [Dk.headZ0 - 0.1, Dk.headZ1 + 0.1]) pile(x, z, y + 1.05);
    col.box((Dk.x0 + Dk.x1) / 2, y - 0.15, (Dk.z0 + Dk.z1) / 2, Dk.x1 - Dk.x0, 0.3, Dk.z1 - Dk.z0, {
      tag: 'dock',
      surface: 'wood',
    });
    col.box(
      (Dk.headX0 + Dk.headX1) / 2,
      y - 0.15,
      (Dk.headZ0 + Dk.headZ1) / 2,
      Dk.headX1 - Dk.headX0,
      0.3,
      Dk.headZ1 - Dk.headZ0,
      { tag: 'dock', surface: 'wood' },
    );
    // cleats, coiled lines, ladder, light, fish-cleaning station
    const cleat = (x, z, ry) => {
      B.box(ST, 0.24, 0.022, 0.04, M(x, y + 0.062, z, 0, ry, 0), { color: 0xb5b2a8, bevel: 0.01 });
      for (const s of [-1, 1])
        B.cyl(
          ST,
          0.014,
          0.018,
          0.05,
          M(x + Math.cos(ry) * s * 0.05, y + 0.028, z - Math.sin(ry) * s * 0.05),
          { color: 0xb5b2a8, seg: 8 },
        );
    };
    const coil = (x, z, hex) => {
      const pts = [];
      for (let i = 0; i < 90; i++) {
        const t = i / 90,
          a = t * 6.283 * 5,
          rr = 0.07 + t * 0.2;
        pts.push([x + Math.cos(a) * rr, y + 0.02 + (i % 18) * 0.0004, z + Math.sin(a) * rr]);
      }
      pts.push([x + 0.5, y + 0.02, z + 0.2], [x + 0.9, y + 0.03, z + 0.05]);
      D.tube(mat.fabric('wool_boucle', { rep: 0.05 }), pts, 0.011, {
        seg: 5,
        color: hex,
        steps: 150,
      });
    };
    for (const z of [-17, -21.5]) {
      cleat(Dk.x1 - 0.14, z, Math.PI / 2);
      cleat(Dk.x0 + 0.14, z, Math.PI / 2);
    }
    cleat(Dk.headX1 - 0.2, Dk.headZ1 - 0.15, 0);
    cleat(Dk.headX0 + 0.3, Dk.headZ0 + 0.15, 0);
    coil(Dk.x0 + 0.5, -16.2, 0xd8cfae);
    coil(Dk.headX0 + 1.0, Dk.headZ0 + 0.8, 0x4f7f8a);
    for (const s of [-1, 1])
      B.box(ST, 0.04, 2.3, 0.04, M(Dk.headX1 + 0.03, y - 0.75, Dk.headZ0 + 1.3 + s * 0.2), {
        color: 0xa9a59a,
        bevel: 0.008,
      });
    for (let k = 0; k < 6; k++)
      B.cyl(
        ST,
        0.015,
        0.015,
        0.4,
        M(Dk.headX1 + 0.03, y - 0.15 - k * 0.3, Dk.headZ0 + 1.3, Math.PI / 2, 0, 0),
        { color: 0xa9a59a, seg: 8 },
      );
    {
      const tx = Dk.headX0 + 0.9,
        tz = Dk.headZ0 + 0.45; // fish-cleaning table: HDPE top with knife scars, plywood shelf, hose bib
      for (const [dx, dz] of [
        [-0.55, -0.28],
        [0.55, -0.28],
        [-0.55, 0.28],
        [0.55, 0.28],
      ])
        B.box(WD, 0.085, 0.92, 0.085, M(tx + dx, y + 0.46, tz + dz), {
          grain: 1,
          color: kit.vary(0x8f887c, r, 0.1),
          wear: 0.7,
          bevel: 0.006,
          rand: r,
        });
      B.box(mat.plastic(), 1.3, 0.035, 0.7, M(tx, y + 0.94, tz), { color: 0xe9e6dc, bevel: 0.008 });
      B.box(WD, 1.2, 0.02, 0.6, M(tx, y + 0.3, tz), { color: 0x8f887c, wear: 0.8, bevel: 0.004 });
      B.box(
        mat.art('fishtop', 256, 128, (g, w, h) => {
          g.fillStyle = '#ebe7dc';
          g.fillRect(0, 0, w, h);
          const q = kit.rng(4);
          for (let i = 0; i < 260; i++) {
            g.strokeStyle = `rgba(120,110,95,${0.15 + q() * 0.3})`;
            g.lineWidth = 0.6;
            const x = q() * w,
              yy = q() * h,
              a = q() * 3;
            g.beginPath();
            g.moveTo(x, yy);
            g.lineTo(x + Math.cos(a) * 30 * q(), yy + Math.sin(a) * 30 * q());
            g.stroke();
          }
          g.fillStyle = 'rgba(150,60,50,0.18)';
          g.beginPath();
          g.ellipse(90, 60, 40, 22, 0.3, 0, 7);
          g.fill();
        }),
        1.28,
        0.004,
        0.68,
        M(tx, y + 0.96, tz),
        {},
      );
      B.box(mat.plastic(), 0.28, 0.25, 0.28, M(tx + 0.35, y + 0.43, tz), {
        color: 0xd8d4c8,
        bevel: 0.02,
      });
      B.cyl(ST, 0.012, 0.012, 0.3, M(tx - 0.5, y + 1.1, tz - 0.3), { color: 0x8f9a8f, seg: 8 });
      B.box(mat.steel(), 0.02, 0.004, 0.17, M(tx - 0.1, y + 0.965, tz + 0.1, 0, 0.4, 0), {
        color: 0xc8c8c4,
      });
      col.box(tx, y + 0.48, tz, 1.3, 0.96, 0.7, { tag: 'prop' });
    }
    {
      const lx = Dk.x0 - 0.1,
        lz = Dk.headZ1 + 0.2;
      B.cyl(WD, 0.05, 0.06, 2.6, M(lx, y + 1.3, lz), { seg: 10, color: 0x7d7467, wear: 0.8 });
      B.box(ST, 0.5, 0.03, 0.03, M(lx + 0.24, y + 2.5, lz), { color: 0x8c8a82 });
      B.cyl(mat.metalPaint(), 0.16, 0.05, 0.14, M(lx + 0.46, y + 2.44, lz), {
        color: 0x3f6f5f,
        seg: 14,
      });
      B.geo(
        mat.emissive(0xffe2ae, 2.5, 'dock'),
        new THREE.SphereGeometry(0.045, 10, 8),
        M(lx + 0.46, y + 2.38, lz),
        {},
      );
      const lt = ctx.addLight({
        id: 'dock_light',
        pos: [lx + 0.46, y + 2.3, lz],
        color: 0xffd9a0,
        intensity: 55,
        range: 14,
        on: false,
      });
      ctx.updaters.push((dt, env) => {
        const t = env.timeOfDay ?? 12;
        lt.on = t < 6.3 || t > 18.4;
      });
    }
  }
  // ---------- weeds and grass tufts along every edge: footings, lattice base, slab, drive margins, seawall ----------
  {
    const blades = [],
      bc = [],
      q = kit.rng(77);
    for (let k = 0; k < 9; k++) {
      const a = q() * 6.283,
        l = 0.06 + q() * 0.13,
        w = 0.006 + q() * 0.006,
        bx = Math.cos(a),
        bz = Math.sin(a),
        lean = 0.3 + q() * 0.7,
        ox = (q() - 0.5) * 0.1,
        oz = (q() - 0.5) * 0.1;
      blades.push(
        ox - bz * w,
        0,
        oz + bx * w,
        ox + bz * w,
        0,
        oz - bx * w,
        ox + bx * l * lean * 0.5,
        l * 0.6,
        oz + bz * l * lean * 0.5,
        ox - bz * w * 0.6,
        0.02,
        oz + bx * w * 0.6,
        ox + bx * l * lean * 0.5,
        l * 0.6,
        oz + bz * l * lean * 0.5,
        ox + bx * l * lean,
        l,
        oz + bz * l * lean,
      );
      const g0 = 0.16 + q() * 0.1;
      for (let v = 0; v < 6; v++) {
        const tip = v === 2 || v >= 4 ? 1.5 : 0.8;
        bc.push(0.13 * tip * (0.8 + q() * 0.5), g0 * 0.95 * tip, 0.05 * tip);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(blades, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(bc, 3));
    g.computeVertexNormals();
    const gm = new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.85,
        side: THREE.DoubleSide,
        bumpMap: kit.microTex(),
        bumpScale: 0.4,
      }),
      ms = [],
      cs = [];
    const onSlab = R8
      ? (x, z) => {
          const [sx, sz] = toS(x, z),
            [hx, hz] = StoH(sx, sz);
          return (
            houseBlock(sx, sz, 0.1) ||
            inRect(P4.pad, ...HtoB(hx, hz), 0.2) ||
            inCanalH(hx, hz, 0.4) ||
            hz < P4.wallZ + 0.3
          );
        }
      : R4
        ? (x, z) => {
            const [sx, sz] = StoH(...toS(x, z));
            return (
              (sx > P4.pavers.x0 && sx < P4.pavers.x1 && sz > P4.pavers.z0 && sz < P4.pavers.z1) ||
              (sx > P4.deckS.x0 && sx < P4.deckE.x1 && sz > -12.8 && sz < -1.6)
            );
          }
        : (x, z) =>
            (x > -0.85 && x < 7.65 && z > -3.15 && z < 8.0) ||
            (x > -7.1 && x < -0.55 && z > -3.25 && z < 5.05); // carport + front-bay slabs (47): nothing grows through concrete
    const rc = ctx.opts.roadClear || (() => true);
    const put = (x, z, s = 1) => {
      if (onSlab(x, z) || !rc(x, z, 0.4)) return;
      ms.push(M(x, 0.01, z, 0, q() * 6.283, 0, s * (0.7 + q() * 0.9)));
      const d = q();
      cs.push([0.75 + d * 0.5, 0.8 + d * 0.35, 0.6 + d * 0.5]);
    };
    const line = (ax, az, bx, bz, n, spread = 0.25, s = 1) => {
      for (let i = 0; i < n; i++) {
        const t = q();
        put(
          ax + (bx - ax) * t + (q() - 0.5) * spread,
          az + (bz - az) * t + (q() - 0.5) * spread,
          s,
        );
      }
    };
    if (!R4)
      for (const x of P.pileXs)
        for (const z of P.pileZs)
          for (let i = 0; i < 7; i++) {
            const a = q() * 6.283;
            put(x + Math.cos(a) * (0.36 + q() * 0.2), z + Math.sin(a) * (0.36 + q() * 0.2), 0.9);
          }
    if (R4 && !R8) {
      const lineS = (ax, az, bx, bz, n, sp, sc) => {
        const [a1, a2] = toG(...HtoS(ax, az)),
          [b1, b2] = toG(...HtoS(bx, bz));
        line(a1, a2, b1, b2, n, sp, sc);
      }; // r4: at the post feet, the paver edge, the stair feet
      for (const x of P4.postXs)
        for (const z of P4.postZs) {
          if (x > 6.6 && z < -10.5) continue;
          const [gx, gz] = toG(...HtoS(x, z));
          for (let i = 0; i < 6; i++) {
            const a = q() * 6.283;
            put(gx + Math.cos(a) * (0.28 + q() * 0.2), gz + Math.sin(a) * (0.28 + q() * 0.2), 0.9);
          }
        }
      lineS(-7.2, -1.1, 6.8, -1.1, 70, 0.3, 1.1);
      lineS(-7.9, -1.0, -7.9, 3.8, 30, 0.3, 1.0);
      lineS(-6.5, -1.0, -6.5, 3.8, 30, 0.3, 1.0);
      lineS(10.9, -12.8, 10.9, -1.6, 40, 0.4, 1.1);
    }
    if (!R4) line(-8.4, 2.95, -3.6, 2.95, 110, 0.3, 1.3);
    if (!R4) {
      line(-3.5, 3.0, -1.0, 3.0, 40, 0.25);
      line(-0.8, 8.3, 8.0, 8.3, 120, 0.45, 1.2);
      line(8.1, 8, 8.1, -3.3, 90, 0.5, 1.1);
      line(-8.9, 5.4, -8.9, -6.5, 70, 0.5);
    }
    {
      const D2 = DRIVE.main;
      for (let i = 0; i < D2.length - 1; i++) {
        const [ax, az] = D2[i],
          [bx, bz] = D2[i + 1],
          len = Math.hypot(bx - ax, bz - az),
          nx = -(bz - az) / len,
          nz = (bx - ax) / len; // drive margins (r2-keys)
        // QA first-minutes #19: clumps, not an even scatter: a clump of 3-8 tufts every ~1.7 m on about half the stations, gaps between
        for (let t = q() * 1.2; t < len; t += 1.1 + q() * 1.3)
          for (const sgn of [-1, 1]) {
            if (q() < 0.45) continue;
            const off = DRIVE.halfWidth + 0.6 + q() * q() * 4,
              cx = ax + ((bx - ax) * t) / len + nx * sgn * off,
              cz = az + ((bz - az) * t) / len + nz * sgn * off,
              n = 3 + ((q() * 6) | 0);
            for (let k = 0; k < n; k++) {
              const a = q() * 6.283,
                d = Math.sqrt(q()) * (0.18 + n * 0.04);
              put(
                cx + Math.cos(a) * d,
                cz + Math.sin(a) * d,
                (0.7 + q() * 0.8) * (k < 2 ? 1.2 : 1),
              );
            }
          }
      }
    } // front-door view (Nov 19, user: the drive is matted down and clean): no weed runs on the hump between the ruts
    if (wallN) line(L.x0 - 20, L.z0 + 0.7, L.x1 - 0.5, L.z0 + 0.7, 260, 0.8, 1.2);
    if (wallE) line(L.x1 - 0.7, L.z0, L.x1 - 0.7, L.z1 + 15, 300, 0.8, 1.2); // only along a seawall line(-13.5, 6.6 + P.stairW.dz, -9.5, 6.9 + P.stairW.dz, 40, 0.5); line(-12.2, 2.8 + P.stairW.dz, -12.2, 4.4 + P.stairW.dz, 20, 0.3);   // west stair foot / landing (moved)
    for (const [wx, wz, wr, wn, ws] of WEEDS)
      for (let i = 0; i < wn; i++) {
        const a = q() * 6.283,
          d = Math.sqrt(q()) * wr;
        put(wx + Math.cos(a) * d, wz + Math.sin(a) * d, ws * (0.8 + q() * 0.6));
      } // keys pass: hand-placed clumps (yard.data.js WEEDS)
    const im = kit.instances(g, gm, ms, cs, { cast: false });
    im.name = 'weeds';
    ctx.groups.detail.add(im);
  }
  if (!P.dock.kit) {
    ctx.anchors.dock = {
      pos: new THREE.Vector3((P.dock.x0 + P.dock.x1) / 2, P.dock.y, -22),
      heading: Math.PI,
    };
    ctx.anchors.skiff = { pos: new THREE.Vector3(3.75, sea, -19.5), heading: Math.PI };
  }
  ctx.anchors.truck = { pos: new THREE.Vector3(-17, 0, 9.5), heading: 2.7 };
  ctx.anchors.bike = { pos: new THREE.Vector3(-13.5, 0, -2.5), heading: 1.2 };
  ctx.anchors.kayak = { pos: new THREE.Vector3(-10.5, 0, -11), heading: 0.3 };
}
