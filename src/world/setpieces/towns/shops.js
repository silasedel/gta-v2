// Town buildings (track: houses / towns): shops and civic places built like the houses (kit materials, real trim,
// storefront glass lit at night, awnings, signs from a per-town atlas). Every building is its own design: kind sets the
// program (storefront, diner, bank, church, motel office, school, marina office), the seed sets proportions, colors,
// awning, door, upper floor and parapet. Local frame: +Z = the street, footprint x in [-w/2, w/2], z in [-d/2, d/2].
//   buildShop(hk, s, lod) -> { batch, colliders, lamps }      s = { seed, kind, w, d, stories, sign: atlas cell, colors }
const PI = Math.PI;

export const KINDS = {
  cafe: {
    awn: 'striped',
    front: 'bay',
    stories: [1, 2],
    palette: ['#2f6b5a', '#a8442e', '#2b4a6b'],
  },
  hardware: { awn: 'flat', front: 'wide', stories: [1], palette: ['#b23a2e', '#2f4f6f'] },
  bait: { awn: 'tin', front: 'shack', stories: [1], palette: ['#2f7d82', '#c8873a'] },
  diner: { awn: 'chrome', front: 'ribbon', stories: [1], palette: ['#c8302a', '#2a7ab0'] },
  pharmacy: { awn: 'flat', front: 'wide', stories: [1, 2], palette: ['#2a7a4a', '#2a5a9a'] },
  bakery: { awn: 'striped', front: 'bay', stories: [2], palette: ['#d27a9a', '#c8902a'] },
  barber: { awn: 'striped', front: 'narrow', stories: [1, 2], palette: ['#2a3a6a', '#8a2a2a'] },
  books: { awn: 'striped', front: 'bay', stories: [2], palette: ['#3a5a3a', '#6a3a5a'] },
  florist: { awn: 'striped', front: 'narrow', stories: [1], palette: ['#7a9a3a', '#d26a8a'] },
  seafood: { awn: 'tin', front: 'wide', stories: [1], palette: ['#2a6a8a', '#e0a030'] },
  realty: { awn: 'flat', front: 'narrow', stories: [2], palette: ['#1e3a5a', '#7a6a4a'] },
  bank: { awn: 'none', front: 'columns', stories: [2], palette: ['#1e2e3e', '#5a4a2a'] },
  icecream: { awn: 'striped', front: 'narrow', stories: [1], palette: ['#e86a9a', '#4ab8c8'] },
  laundry: { awn: 'flat', front: 'wide', stories: [1], palette: ['#2a8ab8', '#5a5a5a'] },
  church: { awn: 'none', front: 'church', stories: [1], palette: ['#f2efe6'] },
  motel: { awn: 'none', front: 'motel', stories: [2], palette: ['#2f8f8a', '#e07a2a'] },
  school: { awn: 'none', front: 'school', stories: [1], palette: ['#b85a38'] },
  marina: { awn: 'tin', front: 'shack', stories: [1], palette: ['#2a5a8a'] },
  boutique: { awn: 'flat', front: 'bay', stories: [2], palette: ['#1e1e1e', '#6a2a3a', '#2a4a3a'] },
  gallery: { awn: 'none', front: 'wide', stories: [1, 2], palette: ['#2a2a2a', '#f2efe6'] },
  wine: { awn: 'striped', front: 'narrow', stories: [2], palette: ['#5a1e2a', '#2a3a2a'] },
  jeweler: { awn: 'flat', front: 'narrow', stories: [2], palette: ['#1e2e3e', '#7a6a3a'] },
  salon: { awn: 'striped', front: 'narrow', stories: [1, 2], palette: ['#d28aa0', '#2a6a6a'] },
  deli: { awn: 'striped', front: 'bay', stories: [1], palette: ['#2a5a2a', '#b84a2a'] },
  toys: { awn: 'striped', front: 'bay', stories: [1], palette: ['#e0a020', '#2a7ac8'] },
};
// room behind the shop glass (interior mapping kind, see houses/materials.js shopGlass)
const ROOM = {
  hardware: 1,
  pharmacy: 1,
  books: 1,
  bait: 1,
  seafood: 1,
  wine: 1,
  toys: 1,
  cafe: 2,
  bakery: 2,
  icecream: 2,
  deli: 2,
  diner: 5,
  bank: 4,
  realty: 4,
  gallery: 0,
  florist: 3,
  boutique: 3,
  jeweler: 3,
  salon: 0,
  barber: 0,
  laundry: 0,
  motel: 0,
  school: 0,
  marina: 1,
};
const BODY = [
  '#efe4cf',
  '#f3e6d6',
  '#e7d3b5',
  '#f2dcc8',
  '#dfe6dc',
  '#f4efe2',
  '#e9d8c4',
  '#d8e2e6',
  '#f0d9c0',
  '#e6e0d0',
  '#f5e9d9',
];
const hex = (s) => parseInt(s.slice(1), 16);

export function buildShop(hk, s, lod = 0) {
  const THREE = hk.THREE,
    kit = hk,
    M = kit.M,
    mat = kit.mat,
    B = kit.batch('shop'),
    cols = [],
    lamps = [];
  let sd = (s.seed * 2654435761 + lod * 7) >>> 0 || 1;
  const r = () => {
    sd ^= sd << 13;
    sd >>>= 0;
    sd ^= sd >>> 17;
    sd ^= sd << 5;
    sd >>>= 0;
    return sd / 4294967296;
  };
  const L0 = lod === 0,
    L1 = lod <= 1,
    K = KINDS[s.kind] || KINDS.cafe;
  const STU = mat.stucco(),
    PAINT = mat.paint({ peel: 'a', fade: 0.22 }),
    CONC = mat.concrete(),
    WIN = mat.houseWindow(),
    MET = mat.metalPaint(),
    TIN = mat.tin(),
    WOOD = mat.wood(),
    PLAST = mat.plastic();
  const w = s.w,
    d = s.d,
    x0 = -w / 2,
    x1 = w / 2,
    z0 = -d / 2,
    z1 = d / 2,
    FL = 3.6,
    h = s.stories * FL + (s.stories > 1 ? 0.2 : 0.6),
    wear = 0.1 + r() * 0.25;
  const body = s.colors.body,
    trim = s.colors.trim,
    acc = s.colors.accent,
    awnC = s.colors.awn;
  const box = (m, sx, sy, sz, x, y, z, o = {}, ry = 0, rx = 0, rz = 0) =>
    B.box(m, sx, sy, sz, M(x, y, z, rx, ry, rz), o);
  const vary = (c, a = 0.04) => kit.vary(c, r, a);
  const front = K.front,
    SG = mat.shopGlass(),
    room = ROOM[s.kind] ?? 0,
    rw = (lit) => room + Math.min(0.98, Math.max(0, lit));
  // facade material by rule (set by the town: quarter, kind, neighbors): stucco, painted brick or raw brick, board and batten, stone
  const FAC =
    s.facade === 'brick'
      ? mat.brick()
      : s.facade === 'batten'
        ? PAINT
        : s.facade === 'stone'
          ? mat.stoneVeneer()
          : STU;
  const facC =
    s.facade === 'brick'
      ? s.paintedBrick
        ? body
        : 0xa86450 /* r2-art: raw brick is brick-red (L ~0.1), the white multiplier left the pale canvas brick reading as painted (L 0.46) */
      : s.facade === 'stone'
        ? 0xf0e8d8
        : body;

  // ---------- shell ----------
  if (front === 'church') return church();
  box(STU, w, h, d, 0, h / 2, 0, { color: body, wear: [wear + 0.25, wear] });
  // facade skin on the street face above the storefront (the ground floor is glass, bulkheads and pilasters), and on the
  // ground floor only for the civic fronts that have no shop window
  const skin0 = /columns|motel|school/.test(K.front) ? 0.35 : 2.78;
  if (FAC !== STU)
    box(FAC, w + 0.04, h - skin0, 0.05, 0, (h + skin0) / 2, z1 + 0.02, {
      color: facC,
      wear: wear,
      grain: 1,
    });
  if (s.facade === 'batten' && L1 && h > 4.4)
    for (let x = x0 + 0.3; x < x1 - 0.1; x += 0.6)
      box(PAINT, 0.06, h - 3.9, 0.03, x, (h + 3.9) / 2, z1 + 0.06, {
        color: kit.mul(body, 0.92),
        wear: wear + 0.1,
        grain: 1,
      });
  if (s.stoneBase && L1)
    box(mat.stoneVeneer(), w + 0.1, 0.9, 0.08, 0, 0.45, z1 + 0.05, { color: 0xe8e0d0 });
  box(CONC, w + 0.12, 0.35, d + 0.12, 0, 0.12, 0, { color: 0xbab3a6, wear: 0.4 }); // base / water table
  cols.push({ shape: 'box', p: [0, h / 2, 0], h: [w / 2, h / 2, d / 2], ry: 0 });
  // parapet, cornice, coping (stepped center on some)
  const par = 0.7 + r() * 0.5;
  for (const [sx, sz, x, z] of [
    [w + 0.1, 0.22, 0, z1 - 0.06],
    [w + 0.1, 0.22, 0, z0 + 0.06],
    [0.22, d, x0 + 0.06, 0],
    [0.22, d, x1 - 0.06, 0],
  ])
    box(STU, sx, par, sz, x, h + par / 2, z, { color: body, wear: 0.3 });
  box(STU, w + 0.34, 0.16, 0.3, 0, h + par + 0.06, z1 - 0.05, { color: trim, wear: 0.25 });
  // cornice by style: stepped (three projecting courses), dentil (block row under a crown), arched center, false front
  const cor = s.cornice || 'stepped';
  if (L1) {
    box(STU, w + 0.22, 0.2, 0.2, 0, h - 0.06, z1 + 0.06, { color: trim, wear: 0.25 });
    box(STU, w + 0.32, 0.12, 0.3, 0, h + 0.1, z1 + 0.08, { color: trim, wear: 0.25 });
  }
  if (cor === 'stepped' && L1)
    box(STU, w + 0.12, 0.1, 0.12, 0, h - 0.26, z1 + 0.03, { color: trim, wear: 0.25 });
  if (cor === 'dentil' && L0)
    for (let x = x0 + 0.15; x < x1 - 0.1; x += 0.24)
      box(STU, 0.1, 0.12, 0.1, x, h - 0.22, z1 + 0.07, { color: trim });
  if (cor === 'arched' && L1 && w > 6) {
    const R = Math.min(w * 0.22, 1.6),
      sh = new THREE.Shape();
    sh.moveTo(-R - 0.3, 0);
    sh.lineTo(-R, 0);
    sh.absarc(0, 0, R, PI, 0, true);
    sh.lineTo(R + 0.3, 0);
    sh.lineTo(R + 0.3, -0.01);
    sh.lineTo(-R - 0.3, -0.01);
    B.geo(
      STU,
      new THREE.ExtrudeGeometry(sh, {
        depth: 0.22,
        bevelEnabled: false,
        curveSegments: L0 ? 12 : 6,
      }),
      M(0, h + par, z1 - 0.17),
      { color: body, wear: 0.3, uvMul: [0.7, 0.7] },
    );
    B.geo(
      STU,
      new THREE.TorusGeometry(R + 0.05, 0.08, 6, L0 ? 18 : 8, PI),
      M(0, h + par, z1 - 0.04),
      { color: trim },
    );
  }
  if (cor === 'false' && L1) {
    const fh = 1.3;
    box(FAC, w + 0.04, fh, 0.12, 0, h + par + fh / 2, z1 - 0.04, { color: facC, wear });
    box(STU, w + 0.3, 0.14, 0.26, 0, h + par + fh + 0.07, z1 - 0.02, { color: trim });
  }
  if (cor === 'stepped' && w > 7 && L1) {
    const sw = w * 0.4;
    box(STU, sw, 0.6, 0.22, 0, h + par + 0.3, z1 - 0.06, { color: body, wear: 0.3 });
    box(STU, sw + 0.2, 0.12, 0.3, 0, h + par + 0.62, z1 - 0.05, { color: trim, wear: 0.25 });
  }
  box(CONC, w - 0.3, 0.06, d - 0.3, 0, h + 0.03, 0, { color: 0x8a867e, wear: 0.6 }); // roof deck
  if (L1) {
    const n = 1 + (((w * d) / 90) | 0);
    for (let k = 0; k < Math.min(3, n); k++) {
      const ax = x0 + 1.2 + r() * (w - 2.4),
        az = z0 + 1.2 + r() * (d * 0.5);
      box(MET, 1.0, 0.8, 1.2, ax, h + 0.45, az, { color: 0xc8c6bc, wear: 0.4 });
      if (L0) B.cyl(MET, 0.35, 0.35, 0.02, M(ax, h + 0.86, az), { seg: 12, color: 0x2a2a2a });
    }
  }
  // pilasters at the front corners
  for (const sx of [-1, 1])
    box(STU, 0.36, h, 0.14, sx * (w / 2 - 0.18), h / 2, z1 + 0.06, { color: trim, wear: 0.25 });

  // ---------- ground floor front ----------
  const gfH = FL - 0.1,
    signY0 = 2.95,
    signY1 = Math.min(gfH + 0.25, 3.75);
  if (front === 'columns') bankFront();
  else if (front === 'motel') motelFront();
  else if (front === 'school') schoolFront();
  else storefront();
  // sign board on the fascia (atlas cell), gooseneck lamps over it
  if (front !== 'school' && front !== 'church' && s.sign) {
    const sw = Math.min(w - 1.0, 7),
      sy = (signY0 + signY1) / 2,
      sh2 = signY1 - signY0 - 0.06;
    box(PAINT, sw + 0.16, sh2 + 0.14, 0.06, 0, sy, z1 + 0.11, { color: acc, wear: 0.2 });
    signCard(sw, sh2, 0, sy, z1 + 0.145);
    if (L0)
      for (const sx of [-0.33, 0.33]) {
        B.tube(
          MET,
          [
            [sx * sw, sy + sh2 / 2 + 0.05, z1 + 0.12],
            [sx * sw, sy + sh2 / 2 + 0.35, z1 + 0.3],
            [sx * sw, sy + sh2 / 2 + 0.3, z1 + 0.55],
          ],
          0.018,
          { color: 0x1e3a2a },
        );
        B.cyl(mat.houseBulb(), 0.12, 0.06, 0.1, M(sx * sw, sy + sh2 / 2 + 0.26, z1 + 0.55), {
          seg: 10,
          color: 0xfff0d0,
          wear: 1,
        });
      }
  }
  awning();
  // upper floors
  for (let fl = 1; fl < s.stories; fl++) upperFloor(fl);
  // side walls: two windows and a back door
  // r2-art (architectural depth): side walls were one blank slab with two windows. Now: a window every ~3.4 m on every floor,
  // the floor band and the cornice wrap the corner, downspouts with kick-outs at the back corners, a meter box + conduit
  const ARTGEO_OFF = typeof location !== 'undefined' && /[?&]artgeo=0\b/.test(location.search); // before/after: the old two-window side walls
  const nSide = ARTGEO_OFF
    ? Math.max(1, Math.floor(d / 5))
    : Math.max(1, Math.floor((d - 1.0) / 3.4));
  for (const sx of [-1, 1]) {
    const ry = sx > 0 ? PI / 2 : -PI / 2,
      xw = sx * (w / 2 + 0.01);
    for (let fl = 0; fl < (ARTGEO_OFF ? 1 : s.stories); fl++)
      for (let k = 0; k < nSide; k++) {
        const z = z0 + (d / (nSide + 1)) * (k + 1);
        win(xw, fl * FL + (fl ? 0.9 : 1.1), z, 1.0, fl ? 1.5 : 1.3, ry, k + sx + fl * 5);
      }
    if (L1 && !ARTGEO_OFF) {
      for (let fl = 1; fl < s.stories; fl++)
        box(STU, 0.12, 0.12, d + 0.1, sx * (w / 2 + 0.05), fl * FL + 0.05, 0, {
          color: trim,
          wear: 0.25,
        }); // floor band around the corner
      box(STU, 0.2, 0.2, d + 0.22, sx * (w / 2 + 0.06), h - 0.06, 0, { color: trim, wear: 0.25 }); // cornice return
      const zs = z0 + 0.25;
      box(MET, 0.08, h - 0.2, 0.08, sx * (w / 2 + 0.07), (h - 0.2) / 2 + 0.05, zs, {
        color: kit.mul(body, 0.8),
        wear: 0.4,
      }); // downspout
      box(MET, 0.08, 0.08, 0.32, sx * (w / 2 + 0.07), 0.1, zs - 0.16, {
        color: kit.mul(body, 0.8),
        wear: 0.4,
      }); // kick-out shoe
      if (L0 && sx < 0) {
        box(
          MET,
          0.36,
          0.48,
          0.16,
          sx * (w / 2 + 0.09),
          1.5,
          z0 + d * 0.3,
          { color: 0x8e918f, wear: 0.4 },
          ry,
        );
        box(MET, 0.05, 1.6, 0.05, sx * (w / 2 + 0.04), 2.55, z0 + d * 0.3, { color: 0x7c7f7d });
      } // meter + conduit
    }
  }
  box(PAINT, 1.0, 2.1, 0.06, x0 + 1.5, 1.05 + 0.1, z0 - 0.02, { color: 0x5a5a58, wear: 0.4 });
  if (!ARTGEO_OFF && L1 && s.stories > 1) {
    const nR = Math.max(1, Math.floor((w - 1.0) / 3.0));
    for (let fl = 1; fl < s.stories; fl++)
      for (let k = 0; k < nR; k++)
        win(x0 + (w / (nR + 1)) * (k + 1), fl * FL + 0.9, z0 - 0.01, 1.0, 1.4, PI, k + fl * 7 + 3);
  } // r2-art: upper-floor windows on the back wall
  if (!ARTGEO_OFF && L1)
    box(MET, 0.45, 0.06, 0.6, x0 + 1.5, 2.45, z0 - 0.3, { color: 0x6a6a66, wear: 0.4 }); // hood over the back door
  return { batch: B, colliders: cols, lamps };

  // =============================================================== parts
  function signCard(sw, sh2, x, y, z, ry = 0) {
    const g = new THREE.PlaneGeometry(sw, sh2),
      uv = g.attributes.uv,
      c = s.sign;
    for (let i = 0; i < uv.count; i++) {
      uv.setX(i, c.u0 + uv.getX(i) * (c.u1 - c.u0));
      uv.setY(i, c.v0 + uv.getY(i) * (c.v1 - c.v0));
    }
    B.geo(s.signMat, g, M(x, y, z, 0, ry), {});
  }
  function win(x, y0, z, ww, wh, ry, k) {
    // punched window set deep: projecting surround (jambs, lintel, sill) so the glass sits 0.16 m back
    const lit = (s.seed >> (k & 7)) & 1 && r() < 0.8 ? 0.4 + r() * 0.6 : 0,
      cur = [0xe8dcc0, 0xf2eee4, 0xd8c8a0, 0xc8d8e0, 0xe8c8b0][(r() * 5) | 0];
    const P = (lx, ly, lz) => M(x, y0, z, 0, ry).multiply(M(lx, ly, lz)),
      dep = 0.17,
      stone = s.facade === 'brick' || s.facade === 'stone' ? 0xe6dfd0 : trim;
    B.box(SG, ww, wh, 0.03, P(0, wh / 2, 0.01), { color: cur, wear: rw(lit * 0.8) });
    if (!L1) return;
    for (const sx of [-1, 1])
      B.box(STU, 0.12, wh + 0.08, dep, P(sx * (ww / 2 + 0.06), wh / 2, dep / 2), {
        color: trim,
        wear: 0.25,
      }); // jambs / reveals
    B.box(STU, ww + 0.42, 0.2, dep + 0.04, P(0, wh + 0.1, (dep + 0.04) / 2), {
      color: stone,
      wear: 0.25,
    }); // lintel
    B.box(STU, ww + 0.38, 0.08, dep + 0.1, P(0, -0.04, (dep + 0.1) / 2), {
      color: stone,
      wear: 0.35,
    }); // sill
    if (L0) {
      B.box(STU, ww + 0.2, 0.06, 0.05, P(0, -0.11, 0.05), { color: stone });
      B.box(MET, 0.03, wh, 0.04, P(0, wh / 2, 0.03), { color: 0xf0f0ec });
      B.box(MET, ww, 0.03, 0.04, P(0, wh * 0.62, 0.03), { color: 0xf0f0ec });
      if (s.facade !== 'brick' && ww > 0.8)
        B.box(STU, 0.16, 0.24, 0.06, P(0, wh + 0.12, dep + 0.05), { color: stone });
    } // keystone
  }
  function storefront() {
    const kick = 0.5,
      gy0 = kick,
      gy1 = signY0 - 0.25,
      doorW = front === 'wide' ? 1.8 : 1.0,
      doorU =
        front === 'narrow'
          ? (r() < 0.5 ? -1 : 1) * (w / 2 - 1.2)
          : r() < 0.7
            ? 0
            : (r() < 0.5 ? -1 : 1) * w * 0.25;
    const recess = front !== 'shack' && r() < 0.7 ? 0.9 : 0.08,
      zf = z1 + 0.02;
    const xa = x0 + 0.42,
      xb = x1 - 0.42;
    // display windows either side of the door (bay windows project for cafe / bakery / books)
    const bay = front === 'bay' ? 0.45 : 0;
    for (const [a, b] of [
      [xa, doorU - doorW / 2 - 0.12],
      [doorU + doorW / 2 + 0.12, xb],
    ]) {
      if (b - a < 0.4) continue;
      const cx = (a + b) / 2,
        ww = b - a;
      box(STU, ww, kick, 0.2 + bay, cx, kick / 2, zf + bay / 2, {
        color: kit.mul(trim, 0.92),
        wear: 0.35,
      });
      B.box(SG, ww - 0.08, gy1 - gy0, 0.03, M(cx, (gy0 + gy1) / 2, zf + bay - 0.02), {
        color: s.colors.interior,
        wear: rw(s.lit),
      });
      if (L1) {
        const nm = Math.max(1, Math.round(ww / 1.3));
        for (let k = 0; k <= nm; k++)
          box(MET, 0.06, gy1 - gy0, 0.08, a + (ww * k) / nm, (gy0 + gy1) / 2, zf + bay, {
            color: acc,
            wear: 0.2,
          });
        box(MET, ww, 0.07, 0.09, cx, gy1, zf + bay, { color: acc });
        box(MET, ww, 0.05, 0.12, cx, gy0, zf + bay, { color: acc });
      }
      if (bay && L1) {
        box(STU, ww + 0.1, 0.1, bay + 0.25, cx, gy1 + 0.1, zf + bay / 2, {
          color: trim,
          wear: 0.25,
        });
        for (const ex of [a, b])
          B.box(SG, 0.03, gy1 - gy0, bay, M(ex, (gy0 + gy1) / 2, zf + bay / 2), {
            color: s.colors.interior,
            wear: rw(s.lit),
          });
      }
      // transom band above the display with small lights
      if (L1)
        B.box(WIN, ww - 0.1, 0.32, 0.03, M(cx, gy1 + 0.27, zf), {
          color: 0xd8e4e8,
          wear: s.lit * 0.6,
        });
      if (L0) {
        // window displays behind the glass: shelves and goods by kind
        const sh = {
          hardware: 0x8a6a3a,
          bait: 0x2a6a8a,
          pharmacy: 0xe8e8e0,
          bakery: 0xd8a860,
          books: 0x6a3a2a,
          florist: 0x5a8a3a,
          seafood: 0xd8e0e0,
          icecream: 0xf0b8c8,
        }[s.kind];
        if (sh !== undefined)
          for (let k = 0; k < Math.floor(ww / 0.6); k++)
            box(PLAST, 0.4, 0.25 + r() * 0.3, 0.3, a + 0.35 + k * 0.6, gy0 + 0.25, zf - 0.25, {
              color: vary(sh, 0.15),
            });
      }
    }
    // door: recessed entry with side glass, glass door with push bar, transom
    const dz = zf - recess;
    if (recess > 0.2) {
      box(CONC, doorW + 0.3, 0.04, recess, doorU, 0.02, zf - recess / 2, { color: 0x9a9690 });
      for (const sx of [-1, 1])
        B.box(
          SG,
          0.03,
          gy1 - 0.05,
          recess,
          M(doorU + sx * (doorW / 2 + 0.12), (gy1 + 0.05) / 2, zf - recess / 2),
          { color: s.colors.interior, wear: rw(s.lit) },
        );
    }
    B.box(SG, doorW - 0.1, 2.1, 0.03, M(doorU, 1.08, dz), {
      color: s.colors.interior,
      wear: rw(s.lit),
    });
    if (L1) {
      for (const sx of [-1, 1])
        box(MET, 0.08, 2.2, 0.08, doorU + (sx * doorW) / 2, 1.1, dz, { color: acc });
      box(MET, doorW, 0.1, 0.08, doorU, 2.2, dz, { color: acc });
    }
    if (L0) {
      box(MET, doorW * 0.6, 0.04, 0.06, doorU, 1.05, dz + 0.04, { color: 0xc8c8c4 });
      box(PLAST, 0.5, 0.25, 0.01, doorU + doorW * 0.2, 1.55, dz + 0.03, { color: 0xf2f0ea });
    }
    lamps.push({ pos: [doorU, 2.6, z1 + 0.8], color: 0xffd7a0, intensity: 16, range: 6 });
    // physics-audit: the body is solid up to the shop windows (and bay windows) on both sides of the door, and
    // only the entry is set back to the door. (It was one box set back by the entry depth over the whole width:
    // the front 0.9 m of every window, 1.35 m with a bay, could be walked and driven into.)
    cols.length = 0;
    const doorA = doorU - doorW / 2 - 0.12,
      doorB = doorU + doorW / 2 + 0.12;
    const bodyBox = (a, b, zMax) => {
      if (b - a < 0.05) return;
      cols.push({
        shape: 'box',
        p: [(a + b) / 2, h / 2, (zMax - d / 2) / 2],
        h: [(b - a) / 2, h / 2, (zMax + d / 2) / 2],
        ry: 0,
      });
    };
    bodyBox(-w / 2, doorA, zf + bay);
    bodyBox(doorA, doorB, dz);
    bodyBox(doorB, w / 2, zf + bay);
    // shack fronts (bait / marina / seafood): board and batten skin over the stucco and a tin awning
    // shack fronts get their board and batten from the facade skin above the windows (never over the glass)
    // cafe tables, sidewalk sale racks and plants are placed by the town (they sit on the sidewalk)
  }
  function awning() {
    const t = K.awn;
    if (t === 'none') return;
    const aw = w - 0.5,
      dep = t === 'flat' || t === 'chrome' ? 1.4 : 1.6,
      y = signY0 - 0.12,
      zf = z1 + 0.1;
    if (t === 'striped') {
      const n = Math.max(4, Math.round(aw / 0.32)),
        ang = 0.42;
      for (let k = 0; k < n; k++)
        box(
          PLAST,
          aw / n + 0.002,
          0.02,
          dep / Math.cos(ang),
          x0 + 0.25 + (aw / n) * (k + 0.5),
          y - (Math.sin(ang) * dep) / 2,
          zf + dep / 2,
          { color: k % 2 ? 0xf4f0e6 : awnC },
          0,
          ang,
        );
      if (L1)
        for (let k = 0; k < (L0 ? n : 1); k++) {
          const xc = L0 ? x0 + 0.25 + (aw / n) * (k + 0.5) : 0;
          box(PLAST, L0 ? aw / n : aw, 0.24, 0.015, xc, y - Math.sin(ang) * dep - 0.12, zf + dep, {
            color: L0 ? (k % 2 ? 0xf4f0e6 : awnC) : awnC,
          });
        }
      if (L0)
        for (const sx of [-1, 1])
          B.rod(
            MET,
            [(sx * aw) / 2, y - 0.9, zf],
            [(sx * aw) / 2, y - Math.sin(ang) * dep, zf + dep],
            0.012,
            { color: 0x2a2a2a },
          );
    } else if (t === 'tin') {
      box(TIN, aw, 0.05, dep, 0, y - 0.2, zf + dep / 2, { color: 0xb8bcc0, wear: 0.5 }, 0, 0.18);
      for (const sx of [-1, 1]) {
        box(WOOD, 0.12, y - 0.3, 0.12, sx * (aw / 2 - 0.1), (y - 0.3) / 2, zf + dep - 0.1, {
          color: 0x8a8478,
          wear: 0.5,
        });
        cols.push({
          shape: 'box',
          p: [sx * (aw / 2 - 0.1), y / 2, zf + dep - 0.1],
          h: [0.07, y / 2, 0.07],
          ry: 0,
        });
      }
    } else {
      box(t === 'chrome' ? mat.steel() : MET, aw, 0.22, dep, 0, y, zf + dep / 2, {
        color: t === 'chrome' ? 0xd8dadc : acc,
      });
      if (L0)
        for (let k = 0; k < 3; k++)
          B.box(
            mat.houseBulb(),
            0.25,
            0.03,
            0.25,
            M(-aw / 3 + (k * aw) / 3, y - 0.12, zf + dep / 2),
            { color: 0xfff4e0, wear: 1 },
          );
      if (t === 'chrome' && L1)
        box(PLAST, aw, 0.08, 0.02, 0, y + 0.06, zf + dep + 0.01, { color: acc });
    }
  }
  function upperFloor(fl) {
    const y0 = fl * FL + 0.9,
      n = Math.max(2, Math.round(w / 2.4));
    for (let k = 0; k < n; k++) {
      const x = x0 + (w / n) * (k + 0.5);
      win(x, y0, z1 + 0.01, (w / n) * 0.5, 1.5, 0, k + fl * 3);
      if (L1 && s.shutters)
        for (const sx of [-1, 1])
          box(PAINT, (w / n) * 0.26, 1.55, 0.04, x + sx * ((w / n) * 0.39), y0 + 0.75, z1 + 0.04, {
            color: acc,
            wear: 0.3,
          });
    }
    if (s.balcony && L1) {
      box(CONC, w * 0.5, 0.12, 0.9, 0, fl * FL + 0.1, z1 + 0.45, { color: trim });
      for (let x = -w * 0.25; x <= w * 0.25 + 0.01; x += L0 ? 0.12 : w * 0.5)
        box(MET, L0 ? 0.02 : w * 0.5, 0.9, L0 ? 0.02 : 0.01, L0 ? x : 0, fl * FL + 0.6, z1 + 0.88, {
          color: 0x1a1a1a,
        });
      box(MET, w * 0.5, 0.04, 0.04, 0, fl * FL + 1.05, z1 + 0.88, { color: 0x1a1a1a });
    }
    box(STU, w + 0.1, 0.12, 0.12, 0, fl * FL + 0.05, z1 + 0.05, { color: trim, wear: 0.25 }); // floor band
    if (L1)
      for (let k = 0; k < n; k++) {
        const x = x0 + (w / n) * (k + 0.5),
          ww = (w / n) * 0.5;
        if ((s.seed >>> (k + fl)) % 5 === 1) {
          box(MET, ww * 0.8, 0.42, 0.6, x, y0 + 0.24, z1 + 0.28, { color: 0xd8d6cc, wear: 0.4 });
          if (L0)
            for (let j = 0; j < 6; j++)
              box(MET, ww * 0.7, 0.012, 0.01, x, y0 + 0.08 + j * 0.05, z1 + 0.585, {
                color: 0x8a8a84,
              });
        } // window AC
        else if (!s.balcony && (s.seed >>> (k + 2)) % 3 === 0) {
          box(WOOD, ww + 0.1, 0.22, 0.26, x, y0 - 0.2, z1 + 0.25, { color: 0x6a4a30, wear: 0.4 });
          if (L0)
            for (let j = 0; j < 5; j++)
              B.geo(
                PLAST,
                new THREE.SphereGeometry(0.12, 6, 4),
                M(x - ww / 2 + 0.1 + j * (ww / 4), y0 - 0.02, z1 + 0.25, 0, 0, 0, 1, 0.8, 1),
                { color: [0xd8304a, 0xf0c020, 0x3a7a2a, 0xe86aa0][j % 4] },
              );
        }
      } // flower box
    // second-floor signage: a projecting blade sign by the corner (the shop's own name) on two-story shops
    if (fl === 1 && s.sign && L1 && !/bank|church|school|motel/.test(s.kind)) {
      const bx = (s.seed & 1 ? 1 : -1) * (w / 2 - 0.35);
      box(MET, 0.05, 0.05, 1.9, bx, FL + 1.75, z1 + 0.95, { color: 0x1a1a1a });
      for (const dz of [0.25, 1.65])
        box(MET, 0.03, 0.2, 0.03, bx, FL + 1.63, z1 + dz, { color: 0x1a1a1a });
      box(PAINT, 0.08, 0.5, 1.7, bx, FL + 1.28, z1 + 0.95, { color: acc });
      signCard(1.6, 0.4, bx + 0.045, FL + 1.28, z1 + 0.95, Math.PI / 2);
      signCard(1.6, 0.4, bx - 0.045, FL + 1.28, z1 + 0.95, -Math.PI / 2);
    }
  }
  function bankFront() {
    box(mat.stoneVeneer(), w, 1.0, 0.14, 0, 0.5, z1 + 0.07, { color: 0xe8e2d4 });
    const n = 4;
    for (let k = 0; k < n; k++) {
      const x = x0 + 0.9 + ((w - 1.8) * k) / (n - 1);
      B.cyl(STU, 0.24, 0.27, h - 1.4, M(x, (h - 1.4) / 2 + 0.6, z1 + 0.9), {
        seg: L0 ? 14 : 6,
        color: 0xf2efe6,
        wear: 0.2,
      });
      box(STU, 0.62, 0.3, 0.62, x, 0.45, z1 + 0.9, { color: 0xe8e2d4 });
      box(STU, 0.62, 0.25, 0.62, x, h - 0.75, z1 + 0.9, { color: 0xe8e2d4 });
      cols.push({ shape: 'cyl', p: [x, h / 2, z1 + 0.9], r: 0.27, hh: h / 2 });
    }
    box(STU, w + 0.2, 0.7, 1.4, 0, h - 0.35, z1 + 0.6, { color: 0xf2efe6, wear: 0.2 });
    if (L1) {
      const tri = new THREE.Shape();
      tri.moveTo(-w / 2 - 0.1, 0);
      tri.lineTo(w / 2 + 0.1, 0);
      tri.lineTo(0, 1.2);
      tri.lineTo(-w / 2 - 0.1, 0);
      B.geo(STU, new THREE.ShapeGeometry(tri), M(0, h, z1 + 1.31), {
        color: 0xf2efe6,
        wear: 0.2,
        uvMul: [0.7, 0.7],
      });
    }
    box(CONC, w + 0.6, 0.15, 2.0, 0, 0.08, z1 + 1.0, { color: 0xd8d2c4 });
    B.box(SG, 1.6, 2.5, 0.03, M(0, 1.35, z1 + 0.02), { color: 0xe8d8b0, wear: rw(s.lit) });
    for (const x of [-w / 3, w / 3])
      B.box(SG, 1.1, 2.0, 0.03, M(x, 1.6, z1 + 0.02), { color: 0xe8d8b0, wear: rw(s.lit * 0.7) });
  }
  function motelFront() {
    // two-story walkway with rail, doors and windows per room, office at one end with a tall sign on a pole
    const rooms = Math.max(3, Math.floor(w / 3.4));
    for (let fl = 0; fl < 2; fl++)
      for (let k = 0; k < rooms; k++) {
        const x = x0 + (w / rooms) * (k + 0.5),
          y = 0.15 + fl * FL;
        box(PAINT, 0.9, 2.05, 0.05, x - 0.7, y + 1.03, z1 + 0.03, {
          color: [acc, 0xf2f0ea][k % 2 ? 1 : 0],
          wear: 0.3,
        });
        win(x + 0.55, y + 1.0, z1 + 0.02, 1.0, 1.1, 0, k + fl * 5);
        if (L0)
          B.box(mat.houseBulb(), 0.1, 0.16, 0.06, M(x - 0.1, y + 2.1, z1 + 0.05), {
            color: 0xfff0d0,
            wear: 1,
          });
      }
    box(CONC, w, 0.18, 1.8, 0, FL, z1 + 0.9, { color: 0xd8d2c4 });
    cols.push({ shape: 'box', p: [0, FL, z1 + 0.9], h: [w / 2, 0.1, 0.9], ry: 0 });
    for (let x = x0 + 0.2; x <= x1; x += 3) {
      box(MET, 0.1, FL, 0.1, x, FL / 2, z1 + 1.7, { color: 0xf2f0ea });
      cols.push({ shape: 'box', p: [x, FL / 2, z1 + 1.7], h: [0.06, FL / 2, 0.06], ry: 0 });
    }
    box(MET, w, 0.05, 0.05, 0, FL + 1.0, z1 + 1.78, { color: 0xf2f0ea });
    if (L1) box(MET, w, 0.9, 0.01, 0, FL + 0.55, z1 + 1.78, { color: 0x7a8a8a });
    box(CONC, 1.2, 0.12, 3.6, x1 + 0.6, FL / 2, z1, { color: 0xd8d2c4 }, 0, -0.75); // stair
    // pole sign
    box(MET, 0.25, 6.5, 0.25, x0 + 0.8, 3.25, z1 + 3.2, { color: 0xd8d8d0 });
    cols.push({ shape: 'box', p: [x0 + 0.8, 3.25, z1 + 3.2], h: [0.15, 3.25, 0.15], ry: 0 });
    if (s.sign) {
      box(PAINT, 3.0, 1.3, 0.25, x0 + 0.8, 6.6, z1 + 3.2, { color: acc });
      signCard(2.8, 1.1, x0 + 0.8, 6.6, z1 + 3.33);
      signCard(2.8, 1.1, x0 + 0.8, 6.6, z1 + 3.07, PI);
    }
  }
  function schoolFront() {
    const n = Math.floor((w - 2) / 1.6);
    for (let k = 0; k < n; k++) win(x0 + 1 + 1.6 * (k + 0.5), 1.0, z1 + 0.02, 1.3, 1.6, 0, k);
    box(CONC, 3.0, 0.2, 2.4, 0, h - 0.6, z1 + 1.2, { color: 0xe6e2da });
    for (const sx of [-1, 1])
      box(MET, 0.12, h - 0.7, 0.12, sx * 1.3, (h - 0.7) / 2, z1 + 2.2, { color: 0x2a2a2a });
    B.box(WIN, 1.8, 2.2, 0.03, M(0, 1.15, z1 + 0.02), { color: 0xd8e0e0, wear: 0.4 });
    if (s.sign) {
      box(PAINT, Math.min(6, w - 2), 0.8, 0.08, 0, h - 0.2, z1 + 2.42, { color: acc });
      signCard(Math.min(5.8, w - 2.2), 0.6, 0, h - 0.2, z1 + 2.47);
    }
    box(STEEL(), 0.06, 8, 0.06, x1 - 1, 4, z1 + 4, { color: 0xd8d8d8 });
    if (L1) box(PLAST, 1.2, 0.7, 0.01, x1 - 0.38, 7.4, z1 + 4, { color: 0x2a5a9a });
  }
  function STEEL() {
    return mat.steel();
  }
  function church() {
    // gable nave, entry tower with louvered belfry and a spire, tall arched windows, steps
    const H = 5.6;
    box(STU, w, H, d, 0, H / 2, 0, { color: 0xf2efe6, wear: 0.2 });
    cols.push({ shape: 'box', p: [0, H / 2, 0], h: [w / 2, H / 2, d / 2], ry: 0 });
    const rise = w * 0.45,
      ang = Math.atan2(rise, w / 2 + 0.3),
      sl = Math.hypot(w / 2 + 0.3, rise);
    for (const sx of [-1, 1])
      box(
        mat.shingle(),
        sl,
        0.1,
        d + 0.6,
        sx * (w / 4 + 0.15),
        H + rise / 2,
        0,
        { color: 0x5a5e62 },
        0,
        0,
        -sx * ang,
      );
    for (const sz of [z0, z1]) {
      const tri = new THREE.Shape();
      tri.moveTo(-w / 2, 0);
      tri.lineTo(w / 2, 0);
      tri.lineTo(0, rise);
      tri.lineTo(-w / 2, 0);
      B.geo(
        STU,
        new THREE.ShapeGeometry(tri),
        M(0, H, sz + (sz > 0 ? 0.01 : -0.01), 0, sz > 0 ? 0 : PI),
        { color: 0xf2efe6, uvMul: [0.7, 0.7] },
      );
    }
    for (const sx of [-1, 1])
      for (let k = 0; k < Math.floor(d / 3.2); k++) {
        const z = z0 + 1.6 + k * 3.2;
        B.box(WIN, 0.03, 2.6, 1.0, M(sx * (w / 2 + 0.01), 3.0, z), {
          color: 0xc8a8d8,
          wear: s.lit,
        });
        if (L1)
          B.geo(
            WIN,
            new THREE.CircleGeometry(0.5, 10, 0, PI),
            M(sx * (w / 2 + 0.012), 4.3, z, 0, (sx * PI) / 2),
            { color: 0xc8a8d8, wear: s.lit },
          );
      }
    const tw = 3.0,
      th = H + rise + 3.5;
    box(STU, tw, th, tw, 0, th / 2, z1 + tw / 2 - 0.2, { color: 0xf2efe6, wear: 0.2 });
    cols.push({
      shape: 'box',
      p: [0, th / 2, z1 + tw / 2 - 0.2],
      h: [tw / 2, th / 2, tw / 2],
      ry: 0,
    });
    if (L1)
      for (const [rx, rz] of [
        [0, 1],
        [0, -1],
        [1, 0],
        [-1, 0],
      ])
        box(
          PAINT,
          1.0,
          1.6,
          0.05,
          rx * (tw / 2 + 0.01),
          th - 1.3,
          z1 + tw / 2 - 0.2 + rz * (tw / 2 + 0.01),
          { color: 0x6a7a6a },
          rx ? PI / 2 : 0,
        );
    B.cyl(mat.shingle(), 0, tw * 0.62, 4.2, M(0, th + 2.1, z1 + tw / 2 - 0.2, 0, PI / 4), {
      seg: 4,
      color: 0x5a5e62,
    });
    if (L1) {
      box(MET, 0.06, 1.2, 0.06, 0, th + 4.7, z1 + tw / 2 - 0.2, { color: 0xc8a850 });
      box(MET, 0.6, 0.06, 0.06, 0, th + 4.95, z1 + tw / 2 - 0.2, { color: 0xc8a850 });
    }
    box(PAINT, 1.6, 2.6, 0.08, 0, 1.4, z1 + tw - 0.18, { color: 0x6a3a24, wear: 0.3 });
    if (L1)
      B.geo(WIN, new THREE.CircleGeometry(0.8, 12, 0, PI), M(0, 2.7, z1 + tw - 0.15), {
        color: 0xd8b880,
        wear: s.lit,
      });
    for (let k = 0; k < 3; k++)
      box(CONC, 3.2 - k * 0.3, 0.17, 0.35, 0, 0.085 + k * 0.17, z1 + tw + 0.5 - k * 0.35, {
        color: 0xd8d2c4,
      });
    if (s.sign) {
      box(PAINT, 2.2, 0.9, 0.12, x1 - 0.5, 0.9, z1 + tw + 2.2, { color: 0x2a3a2a });
      signCard(2.0, 0.7, x1 - 0.5, 0.95, z1 + tw + 2.27);
      for (const sx of [-1, 1])
        box(STU, 0.2, 1.0, 0.2, x1 - 0.5 + sx * 1.2, 0.5, z1 + tw + 2.2, { color: 0xd8d2c4 });
    }
    lamps.push({ pos: [0, 3.2, z1 + tw + 0.5], color: 0xffd7a0, intensity: 18, range: 7 });
    return { batch: B, colliders: cols, lamps };
  }
}

// sign atlas: one canvas per town, 4 x 8 cells of 512 x 128; returns { material, cell(i) }
export function signAtlas(hk, key, names, styles) {
  const W = 2048,
    H = 1024,
    cw = 512,
    ch = 128,
    cells = [];
  const mat = hk.mat.art(
    'signs:' + key,
    W,
    H,
    (g) => {
      g.clearRect(0, 0, W, H);
      names.forEach((n, i) => {
        const cx = (i % 4) * cw,
          cy = ((i / 4) | 0) * ch,
          st = styles[i] || {};
        g.fillStyle = st.bg || '#1e3a2a';
        g.fillRect(cx, cy, cw, ch);
        g.strokeStyle = st.ink || '#f4ecd8';
        g.lineWidth = 5;
        g.strokeRect(cx + 8, cy + 8, cw - 16, ch - 16);
        g.fillStyle = st.ink || '#f4ecd8';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        let px = 64;
        g.font = `${st.weight || 700} ${px}px ${st.font || 'Georgia, serif'}`;
        while (g.measureText(n).width > cw - 48 && px > 26) {
          px -= 2;
          g.font = `${st.weight || 700} ${px}px ${st.font || 'Georgia, serif'}`;
        }
        g.fillText(n, cx + cw / 2, cy + ch / 2 + 3);
        if (st.sub) {
          g.font = `600 20px Helvetica, Arial, sans-serif`;
          g.fillText(st.sub, cx + cw / 2, cy + ch - 22);
        }
      });
    },
    { emissive: 0.35, flat: true },
  );
  for (let i = 0; i < names.length; i++) {
    const c = i % 4,
      rr = (i / 4) | 0;
    cells.push({
      u0: c / 4 + 0.002,
      u1: (c + 1) / 4 - 0.002,
      v0: 1 - (rr + 1) / 8 + 0.002,
      v1: 1 - rr / 8 - 0.002,
    });
  }
  return { material: mat, cells };
}
export { BODY, hex };
