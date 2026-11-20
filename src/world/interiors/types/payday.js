// Store type: payday-loan / check-cashing shop (intro v2 robbery flashback, storyboard panel 5). Claims only the lots listed
// in PAYDAY_LOTS (the robbery block of the intro; src/story/sets/robberyBlock.js) so the rest of the city keeps its shops.
// Panel 5: a small shop, "PAYDAY LOANS" painted big on the back wall, LOANS / CHECKS / CASH signs, a teller counter with a
// floor-to-ceiling glass partition (deal trays under the glass), a computer, stacks of cash behind the glass, a waiting row.
// The mission reads `store.heist` (store-local points: teller, tray, customer spot, staff door) once the interior is built.
import { registerStoreType } from '../registry.js';
import { cut } from '../plan.js';
import { clamp } from '../kit/util.js';
import { text } from '../kit/atlas.js';
import { family, trashCan, cctvDome, exitSign, floorMat, wallFan } from '../fixtures/retail.js';
import { officeDesk, safe, wallClock, breakerPanel } from '../fixtures/backroom.js';
import { waitingChairs } from '../fixtures/specialty.js';

// storefront ids (spots.json) this type claims, with the name on the fascia
// (the robbery block on 21st St, Miami Beach: src/story/sets/robberyBlock.js)
export const PAYDAY_LOTS = {
  882: { name: 'Sunshine Payday Loans' },
};

const GREEN = '#127a3e';
const YELLOW = '#ffd21f';
const INK = '#14161a';

// a painted / printed panel with one or two lines of text, drawn once into the store's atlas
function textPanel(ctx, key, wpx, hpx, lines, o = {}) {
  return ctx.prints.make(
    key,
    wpx,
    hpx,
    (g, w, h) => {
      if (o.bg) {
        g.fillStyle = o.bg;
        g.fillRect(0, 0, w, h);
      } else {
        g.clearRect(0, 0, w, h);
      }
      if (o.border) {
        g.strokeStyle = o.border;
        g.lineWidth = Math.max(4, h * 0.05);
        g.strokeRect(h * 0.05, h * 0.05, w - h * 0.1, h - h * 0.1);
      }
      const n = lines.length;
      for (let i = 0; i < n; i++) {
        const ln = lines[i];
        const y0 = (h * (0.08 + (i * 0.84) / n)) | 0;
        text(g, ln.t, w * 0.05, y0, w * 0.9, (h * 0.84) / n - h * 0.04, {
          role: ln.role || 'block',
          color: ln.c || INK,
          upper: true,
          stroke: ln.stroke || null,
          strokeW: ln.strokeW || 0,
        });
      }
      if (o.grime) {
        g.fillStyle = 'rgba(40, 30, 20, 0.08)';
        for (let i = 0; i < 40; i++) {
          g.fillRect(Math.random() * w, Math.random() * h, w * 0.1, 1 + Math.random() * 3);
        }
      }
    },
    { lit: o.lit, alpha: !o.bg, ch: o.ch },
  );
}

// a bundle of banded bills (simple box with a printed band) on the back counter
function cashStack(ctx, x, y, z, ry, n) {
  const { G, M } = ctx;
  const bill = M.flat('#7f9a6e', { rough: 0.85 });
  const band = M.flat('#e8dcb8', { rough: 0.8 });
  G.at(
    x,
    z,
    ry,
    () => {
      for (let i = 0; i < n; i++) {
        const lift = i * 0.032;
        G.boxB(bill, 0, lift, 0, 0.156, 0.03, 0.068);
        G.boxB(band, 0, lift + 0.002, 0, 0.03, 0.028, 0.07);
      }
    },
    y,
  );
}

registerStoreType({
  type: 'payday',
  label: 'Payday loans',
  kinds: [],
  minSize: { w: 5, d: 7 },
  variants: 1,
  match(sf) {
    return PAYDAY_LOTS[sf.id] ? 1 : 0;
  },
  depth(sf, { room }) {
    return clamp(room, 8.5, 10.5);
  },
  profile(base, { sf }) {
    return {
      name: PAYDAY_LOTS[sf.id]?.name || 'Sunshine Payday Loans',
      tier: 'budget',
      wear: 0.55,
      accent: GREEN,
      lamp: 'coolwhite',
      hours: [0, 24],
      open24: true,
      bounce: 0.5,
      floor: ['vct', { c: [206, 200, 186], c2: [120, 128, 120], probe: 0.35 }],
      ceil: { type: 'drop' },
      wall: {
        surf: ['paint', { c: [232, 228, 212] }],
        base: '#2a2c30',
        band: { y: 2.25, h: 0.1, c: GREEN },
      },
      facade: { style: 'aluminum' },
      lore: {
        story: `${base.owner} cashes checks and writes two-week loans at 390 % APR. The glass went in after the second break-in.`,
      },
    };
  },
  plan(P) {
    const bd = clamp(P.D * 0.22, 2.0, 2.6);
    const [back, front] = cut(P.lot, 'back', bd);
    const [office, store] = cut(back, 'right', clamp((back.x1 - back.x0) * 0.42, 2, 3));
    P.room('sales', 'sales', front, { h: Math.min(2.95, P.H - 0.3) });
    P.room('back', 'stock', store, {
      h: 2.7,
      floor: ['concrete', { c: [128, 126, 120] }],
      wall: { surf: ['cmu', { c: [204, 202, 194] }], base: '#2a2c30' },
      ceil: { type: 'open', c: [70, 70, 72] },
    });
    P.room('office', 'office', office, {
      h: 2.6,
      floor: ['carpet', { c: [64, 70, 76] }],
      wall: { surf: ['paint', { c: [214, 210, 196] }], base: '#3a3d42' },
      ceil: { type: 'drop' },
    });
    P.door('sales', 'back', { kind: 'hinged', w: 0.95, at: 0.2, staff: true, locked: false });
    P.door('back', 'office', { kind: 'hinged', w: 0.9, staff: true });
    P.door('back', 'outside:back', { kind: 'hinged', w: 0.95, locked: true, sign: false });
    P.storefront({
      style: 'aluminum',
      door: { kind: 'hinged', w: Math.min(P.doorW, 1.1), x: P.doorX },
      bulkhead: 0.6,
      bars: true,
    });
  },
  *fixtures(ctx) {
    const { G, M, plan: P, prints } = ctx;
    const S = P.get('sales');
    family(ctx, 'black');
    const ch = S.ceilY;
    const W = S.w;
    // ---- the teller line: a solid counter across the room, glass from its top to the ceiling, a staff door at the left
    const lz = S.z0 + clamp(S.d * 0.36, 2.1, 2.6);
    const doorW = 0.85;
    const xL = S.x0 + doorW + 0.1;
    const xR = S.x1;
    const cl = xR - xL;
    const cxm = (xL + xR) / 2;
    const top = 1.02;
    const front = M.surf('laminate', { c: [36, 88, 60], wear: 0.5 });
    const counterTop = M.surf('laminate', { c: [210, 206, 196], wear: 0.4 });
    const steel = M.flat('#b9bec3', { metal: 0.8, rough: 0.3 });
    const glass = M.glass({ opacity: 0.07, tint: '#dff2f0', rough: 0.02, env: 0.25 });
    G.boxB(front, cxm, 0, lz, cl, top - 0.04, 0.5);
    G.boxB(counterTop, cxm, top - 0.04, lz + 0.04, cl, 0.04, 0.62);
    G.boxB(M.flat('#1b1d21', {}), cxm, 0, lz + 0.255, cl, 0.1, 0.01);
    ctx.solid(xL, 0, lz - 0.25, xR, top, lz + 0.35);
    // glass partition: framed bays, a speak grille and a deal tray in front of each teller window
    const tellers = [cxm - cl * 0.22, cxm + cl * 0.22];
    const gz = lz + 0.02;
    G.box(glass, cxm, (top + ch) / 2, gz, cl, ch - top, 0.012);
    const bays = Math.max(2, Math.round(cl / 1.1));
    for (let i = 0; i <= bays; i++) {
      const x = xL + (i * cl) / bays;
      G.boxB(steel, x, top, gz, 0.05, ch - top, 0.06);
    }
    G.box(steel, cxm, top + 0.02, gz, cl, 0.04, 0.07);
    G.box(steel, cxm, ch - 0.03, gz, cl, 0.06, 0.07);
    ctx.solid(xL, top, gz - 0.04, xR, ch, gz + 0.04, { occ: false });
    for (const tx of tellers) {
      // recessed deal tray through the counter under the glass
      G.boxB(steel, tx, top - 0.06, gz, 0.42, 0.02, 0.5);
      G.boxB(steel, tx - 0.21, top - 0.06, gz, 0.012, 0.06, 0.5);
      G.boxB(steel, tx + 0.21, top - 0.06, gz, 0.012, 0.06, 0.5);
      G.cyl(steel, tx, 1.5, gz + 0.012, 0.07, 0.01, { rx: Math.PI / 2, seg: 16 });
      // teller station behind the glass: monitor, keyboard, cash drawer, a stack of bills, a receipt printer
      const pm = M.flat('#17181b', { rough: 0.45 });
      G.boxB(counterTop, tx, 0.86, lz - 0.45, 1.0, 0.04, 0.5);
      ctx.solid(tx - 0.5, 0, lz - 0.7, tx + 0.5, 0.9, lz - 0.2, { occ: false });
      G.boxB(pm, tx + 0.18, 0.9, lz - 0.58, 0.16, 0.012, 0.12);
      G.cylB(pm, tx + 0.18, 0.9, lz - 0.6, 0.02, 0.12, { seg: 6 });
      G.box(pm, tx + 0.18, 1.2, lz - 0.6, 0.48, 0.3, 0.03);
      const scr = prints.screen('loanpos' + tx.toFixed(1), 200, 120, (g, sw, sh) => {
        g.fillStyle = '#e8eef2';
        g.fillRect(0, 0, sw, sh);
        g.fillStyle = GREEN;
        g.fillRect(0, 0, sw, 16);
        g.fillStyle = '#fff';
        g.font = '700 10px Arial';
        g.fillText('LOAN DESK  -  CUSTOMER LOOKUP', 4, 12);
        g.fillStyle = '#333';
        g.font = '9px Menlo';
        const rows = [
          'ACCT 40217  ADVANCE  $300.00',
          'FEE  $45.00   DUE 12/03',
          'CHECK #1184  $612.40',
          'ID VERIFIED',
          'BALANCE DUE  $345.00',
        ];
        for (let i = 0; i < rows.length; i++) {
          g.fillText(rows[i], 6, 32 + i * 16);
        }
      });
      G.plane(scr.mat, tx + 0.18, 1.2, lz - 0.584, 0.44, 0.26, { uvRect: scr.rect });
      G.boxB(pm, tx - 0.1, 0.9, lz - 0.4, 0.4, 0.02, 0.14);
      G.boxB(
        M.flat('#2a2d31', { metal: 0.5, rough: 0.4 }),
        tx - 0.2,
        0.78,
        lz - 0.32,
        0.44,
        0.08,
        0.38,
      );
      cashStack(ctx, tx - 0.32, 0.9, lz - 0.55, 0.2, 3);
      cashStack(ctx, tx - 0.12, 0.9, lz - 0.58, -0.1, 2);
      ctx.light.glowPanel(ctx, tx + 0.18, 1.2, lz - 0.56, {
        w: 0.4,
        h: 0.24,
        color: '#dfe9ff',
        k: 0.5,
      });
      ctx.poi('counter', tx, lz - 0.85, 0, {});
    }
    // the staff door at the left end of the counter (closed, solid, with a vision panel)
    const dX = S.x0 + doorW / 2 + 0.05;
    G.boxB(M.flat('#3a3d42', { metal: 0.4, rough: 0.5 }), dX, 0, lz, doorW, 2.05, 0.05);
    G.box(glass, dX, 1.5, lz + 0.03, 0.3, 0.4, 0.01);
    G.boxB(steel, dX, 2.05, lz, doorW + 0.1, ch - 2.05, 0.06);
    G.box(glass, dX, (2.05 + ch) / 2, gz, doorW, ch - 2.05, 0.012);
    ctx.solid(S.x0, 0, lz - 0.05, S.x0 + doorW + 0.1, ch, lz + 0.05);
    yield;
    // ---- back wall: "PAYDAY LOANS" painted big, cash stacks and a safe on the back counter, a money counter, a clock
    const bw = Math.min(W - 0.6, 4.6);
    const paint = textPanel(
      ctx,
      'pdl-wall',
      1024,
      300,
      [
        { t: 'PAYDAY', c: GREEN, role: 'impact', stroke: '#0a3a1c', strokeW: 6 },
        { t: 'LOANS', c: GREEN, role: 'impact', stroke: '#0a3a1c', strokeW: 6 },
      ],
      // painted straight on the wall: the wall's own color around the letters
      { bg: '#e8e4d4', grime: true },
    );
    G.plane(paint.mat, cxm * 0.4, 1.85, S.z0 + 0.012, bw, bw * 0.3, { uvRect: paint.rect });
    G.boxB(counterTop, cxm, 0, S.z0 + 0.32, Math.min(cl, W - 1.2), 0.9, 0.6);
    ctx.solid(
      cxm - Math.min(cl, W - 1.2) / 2,
      0,
      S.z0,
      cxm + Math.min(cl, W - 1.2) / 2,
      0.9,
      S.z0 + 0.62,
    );
    const stacks = [
      [-1.1, 4],
      [-0.85, 5],
      [-0.6, 3],
      [0.5, 6],
      [0.74, 4],
    ];
    for (const [u, n] of stacks) {
      cashStack(ctx, cxm + u, 0.9, S.z0 + 0.3, u * 0.3, n);
    }
    // bill counter machine
    G.boxB(M.flat('#d8dadc', { rough: 0.4 }), cxm + 0.05, 0.9, S.z0 + 0.3, 0.3, 0.2, 0.26);
    G.box(M.glow('#7dffb0', 1.2, 1), cxm + 0.05, 1.06, S.z0 + 0.435, 0.12, 0.03, 0.004);
    safe(ctx, S.x1 - 0.4, S.z0 + 0.32, 0, { w: 0.6, h: 0.9 });
    wallClock(ctx, S.x1 - 0.6, 2.35, S.z0 + 0.005, 0);
    cctvDome(ctx, cxm, ch, lz - 0.6);
    cctvDome(ctx, P.doorX, ch, S.z1 - 0.8);
    yield;
    // ---- customer side: LOANS / CHECKS / CASH signs above the glass, rate boards, a waiting row, a brochure rack
    const signs = [
      ['LOANS', GREEN, '#ffffff'],
      ['CHECKS', YELLOW, INK],
      ['CASH', GREEN, '#ffffff'],
    ];
    const sw = Math.min(1.25, (cl - 0.3) / 3);
    for (let i = 0; i < signs.length; i++) {
      const [t, bg, fg] = signs[i];
      const p = textPanel(ctx, 'pdl-' + t, 400, 128, [{ t, c: fg, role: 'block' }], {
        bg,
        border: fg,
        lit: 1.3,
        ch: 1,
      });
      const sx = xL + ((i + 0.5) * cl) / 3;
      G.box(M.flat('#1b1d21', {}), sx, ch - 0.3, gz + 0.06, sw + 0.04, sw * 0.32 + 0.04, 0.03);
      G.plane(p.mat, sx, ch - 0.3, gz + 0.077, sw, sw * 0.32, { uvRect: p.rect });
    }
    const rate = textPanel(
      ctx,
      'pdl-rates',
      360,
      480,
      [
        { t: 'CASH ADVANCE', c: GREEN, role: 'cond' },
        { t: '$100 - $500', c: INK, role: 'block' },
        { t: 'NO CREDIT CHECK', c: '#b01515', role: 'cond' },
        { t: 'CHECKS CASHED', c: INK, role: 'cond' },
      ],
      { bg: '#fbfaf3', border: GREEN },
    );
    for (const sp of P.spans(S, 'left', 1.2)) {
      if (sp.b < lz + 0.8) continue;
      const a = Math.max(sp.a, lz + 0.6);
      const b = Math.min(sp.b, S.z1 - 0.8);
      if (b - a < 1.2) continue;
      const at = P.onFace(sp.face, (a + b) / 2, 0);
      waitingChairs(ctx, at.x, at.z, at.ry, Math.min(4, Math.floor((b - a) / 0.55)), {
        c: [30, 60, 46],
      });
      const r2 = P.onFace(sp.face, (a + b) / 2, 0.01);
      G.at(r2.x, r2.z, r2.ry, () => {
        G.plane(rate.mat, 0, 1.75, 0, 0.6, 0.8, { uvRect: rate.rect });
      });
      break;
    }
    for (const sp of P.spans(S, 'right', 1.0)) {
      if (sp.b < lz + 0.8) continue;
      const at = P.onFace(sp.face, Math.max(sp.a, lz + 0.9) + 0.4, 0);
      G.at(at.x, at.z, at.ry, () => {
        const rk = M.flat('#2a2c30', { metal: 0.5, rough: 0.4 });
        G.boxB(rk, 0, 0, 0.12, 0.5, 1.4, 0.24);
        for (let k = 0; k < 4; k++) {
          G.box(
            M.flat(k % 2 ? GREEN : YELLOW, { rough: 0.8 }),
            0,
            0.5 + k * 0.24,
            0.25,
            0.4,
            0.2,
            0.01,
            { rx: -0.2 },
          );
        }
        ctx.solid(-0.25, 0, 0, 0.25, 1.4, 0.26, { occ: false });
      });
      break;
    }
    // front glass: CHECKS CASHED / PAYDAY LOANS neon facing the street
    const zg = S.z1 - 0.075;
    const gl2 = ctx.front.glazed;
    const neons = [
      ['CHECKS CASHED', YELLOW],
      ['PAYDAY LOANS', '#3bff7a'],
    ];
    for (let i = 0; i < Math.min(2, gl2.length); i++) {
      const b = gl2[i === 0 ? 0 : gl2.length - 1];
      if (i && gl2.length < 2) break;
      const op = prints.neon(neons[i][0], { color: neons[i][1] });
      for (const s of [1, -1]) {
        G.plane(op.mat, b.x, 1.85, zg + s * 0.002, Math.min(1.3, b.w - 0.1), 0.3, {
          ry: s > 0 ? 0 : Math.PI,
          uvRect: op.rect,
        });
      }
      ctx.light.glowPanel(ctx, b.x, 1.85, zg - 0.02, {
        w: 0.8,
        h: 0.3,
        color: neons[i][1],
        k: 2.2,
        ry: Math.PI,
      });
    }
    // fascia sign
    const sg = prints.storeSign({ style: 'box', sub: 'LOANS · CHECKS · CASH', font: 'impact' });
    const fw = Math.min(P.W - 1, 6.2);
    const sy = ctx.front.gh + ctx.front.fascia / 2;
    G.box(M.flat(GREEN, { rough: 0.5 }), 0, sy, S.z1 + 0.06, fw + 0.12, fw / 5.2 + 0.1, 0.1);
    G.plane(sg.mat, 0, sy, S.z1 + 0.112, fw, fw / 5.2, { uvRect: sg.rect });
    floorMat(ctx, P.doorX, S.z1 - 0.9, 1.4, 0.9, [36, 40, 36]);
    trashCan(ctx, P.doorX + 1.2, S.z1 - 0.4);
    exitSign(ctx, P.doorX, Math.min(ch - 0.12, ctx.front.gh + 0.25), S.z1 - 0.24, Math.PI);
    wallFan(ctx, S.x1 - 0.1, 2.3, (lz + S.z1) / 2, -Math.PI / 2);
    for (const [k, x] of [
      ['camera', -0.6],
      ['nocash', 0.4],
    ]) {
      const nt = prints.notice(k);
      G.plane(nt.mat, cxm + x, 1.3, gz + 0.012, 0.22, 0.17, { uvRect: nt.rect });
    }
    ctx.gridRig(S, { type: 'troffer', lamp: 'coolwhite', k: 4.5, sx: 2.2, sz: 2.2 });
    yield;
    // ---- back of house
    const K = P.get('back');
    const O = P.get('office');
    breakerPanel(ctx, K.x0 + 0.02, 1.5, K.cz, Math.PI / 2);
    {
      const sp = P.spans(O, 'back', 1.1)[0] || P.spans(O, null, 1.1)[0];
      if (sp) {
        const at = P.onFace(sp.face, (sp.a + sp.b) / 2, 0);
        officeDesk(ctx, at.x, at.z, at.ry, { w: Math.min(1.3, sp.len - 0.1) });
      }
    }
    ctx.probe = {
      box: { x0: S.x0, x1: S.x1, z0: S.z0, z1: S.z1, y0: 0, y1: ch },
      at: { x: 0, y: 1.5, z: S.cz },
      size: 256,
    };
    // where the robbery is staged (store-local, floor y = 0): the mission turns these into world points
    ctx.store.heist = {
      teller: { x: tellers[0], z: lz - 0.8, ry: 0 },
      tray: { x: tellers[0], z: lz + 0.45 },
      window2: { x: tellers[1], z: lz + 0.9, ry: Math.PI },
      staffDoor: { x: dX, z: lz },
      lobby: { x: (xL + xR) / 2, z: (lz + S.z1) / 2 },
      waiting: { x: S.x0 + 0.6, z: (lz + S.z1) / 2 },
      door: { x: P.doorX, z: S.z1 - 0.6 },
      outside: { x: P.doorX, z: S.z1 + 2.2 },
      // dressing spots (the missions add library props here: chair, terminal, TV, cooler, bills)
      station2: { x: tellers[1], z: lz - 0.45 },
      backCounter: { x: cxm, z: S.z0 + 0.32, y: 0.9 },
      room: { x0: S.x0, x1: S.x1, z0: S.z0, z1: S.z1, lz, ch },
    };
    ctx.store.counterLocal = { x: tellers[0], z: lz };
  },
});
