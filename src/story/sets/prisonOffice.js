// The counselor's office in the women's prison (intro v2, storyboard panel 4): painted block walls, a window with blinds
// behind the counselor, filing cabinets, a framed palm print, a desk with a notebook and a mug, two chairs.
// Used by intro2.counselor1 (after the cell block walk) and intro2.counselor2 (after the robbery flashback): the same room,
// the same counselor, the same spots.
//
// Reuse from another mission (the office alone, the cell block is not built):
//
//   import { openPrisonOffice, officeShots, COUNSELOR } from '../sets/prisonOffice.js';
//   async setup(ctx) { await openPrisonOffice(ctx); }          // builds it, puts Mari in her chair, the counselor at the desk
//   steps: [{ cutscene: (ctx) => ({ id: 'x', ...officeShots(ctx), lines: [...] }) }]
//
// openPrisonOffice(ctx) tracks everything on ctx (released on pass / fail / quit; the set is disposed once nobody holds it
// and the player has left it). officeShots(ctx) gives frame + over-the-shoulder shots; build your own shots from SPOTS.
import { acquirePrisonSet, releasePrisonSet, PRISON } from './prison.js';

// the counselor (the user's NPC 194) and how the prison staff call Mari
export const COUNSELOR = { person: 'p194', name: 'Ms. Harlow' };

// Office-local frame: origin on the floor in the middle of the room, +x toward the window (east), +z south.
// Room inside: x -2.4 .. 2.4, z -2.2 .. 2.2, drop ceiling at 2.75. Door in the west wall at z 0.55 .. 1.45.
export const OFFICE_ROOM = { x0: -2.4, x1: 2.4, z0: -2.2, z1: 2.2, h: 2.75, doorZ: 1.0 };

// Spots in office-local meters (heading 0 faces +z, PI/2 faces +x toward the window)
export const SPOTS = {
  counselorChair: { x: 1.62, z: 0.05, heading: -Math.PI / 2 },
  // the front edge of her chair's seat (the hero's bench sit puts the root there)
  mariChair: { x: -0.32, z: -0.05, heading: Math.PI / 2 },
  // where Mari stands when she comes in (just inside the door)
  mariDoor: { x: -1.9, z: 1.0, heading: Math.PI / 2 },
  desk: { x: 0.95, z: 0 },
};

// ---------------------------------------------------------------- building (called by prison.js)
// S = the set kit (setKit.js), (ox, oz) = where the office origin sits in the set frame.
// Returns { door, anchors } (door: { open(t), group }).
export function buildOffice(S, ox, oz) {
  const R = OFFICE_ROOM;
  const H = R.h;
  const B = (m, x0, y0, z0, x1, y1, z1, o) =>
    S.box(m, ox + x0, y0, oz + z0, ox + x1, y1, oz + z1, o);
  const M = {
    wall: S.surf('cmu', { c: [208, 204, 188], wear: 0.3 }, { rough: 0.85, ambient: 0x161512 }),
    wallLow: S.surf('cmu', { c: [124, 140, 128], wear: 0.4 }, { rough: 0.8, ambient: 0x0d0f0d }),
    floor: S.surf(
      'vct',
      { c: [170, 164, 150], c2: [150, 144, 132], wear: 0.5 },
      { rough: 0.55, ambient: 0x0e0d0b },
    ),
    ceil: S.surf('dropTile', { c: [226, 224, 216] }, { rough: 0.95, ambient: 0x1a1a18 }),
    trim: S.flat(0x3a3f3c, { rough: 0.6 }),
    frame: S.flat(0x8c9196, { rough: 0.4, metal: 0.6 }),
    slat: S.flat(0xe6e2d6, { rough: 0.55, ambient: 0x2a2924 }),
    glass: S.glow(0xfff2dc, 2.6),
    desk: S.surf('laminate', { c: [128, 96, 66] }, { rough: 0.45, ambient: 0x0c0906 }),
    deskMetal: S.flat(0x2f3236, { rough: 0.5, metal: 0.5 }),
    cabinet: S.flat(0xa9aca8, { rough: 0.45, metal: 0.55, ambient: 0x0e0e0e }),
    handle: S.flat(0xc8ccd0, { rough: 0.25, metal: 0.9 }),
    chairSeat: S.surf('fabric', { c: [44, 50, 62] }, { rough: 0.9 }),
    chairFrame: S.flat(0x1d1f22, { rough: 0.5, metal: 0.4 }),
    plastic: S.flat(0x2b5b74, { rough: 0.6 }),
    mug: S.flat(0xd9d3c4, { rough: 0.3 }),
    coffee: S.flat(0x2a1708, { rough: 0.15 }),
    paper: S.flat(0xf1eee6, { rough: 0.9, ambient: 0x141412 }),
    folder: S.flat(0xc9a45c, { rough: 0.8 }),
    folderB: S.flat(0x6f8fa8, { rough: 0.8 }),
    screen: S.flat(0x0d1014, { rough: 0.2, metal: 0.1 }),
    door: S.surf('laminate', { c: [150, 118, 82] }, { rough: 0.5, ambient: 0x0c0906 }),
    plant: S.flat(0x3f6a33, { rough: 0.8 }),
    pot: S.flat(0x8a4f32, { rough: 0.8 }),
    troffer: S.glow(0xf4f7ff, 3.2),
    housing: S.flat(0xe8e8e4, { rough: 0.5 }),
    cork: S.surf('fabric', { c: [176, 132, 86] }, { rough: 0.95 }),
  };

  // ---- shell: slab, ceiling, four walls (the west wall has the door; the east wall the window)
  B(M.floor, R.x0 - 0.2, -0.3, R.z0 - 0.2, R.x1 + 0.2, 0, R.z1 + 0.2);
  B(M.ceil, R.x0, H, R.z0, R.x1, H + 0.05, R.z1);
  B(M.trim, R.x0 - 0.2, H + 0.05, R.z0 - 0.2, R.x1 + 0.2, H + 0.35, R.z1 + 0.2);
  wallTwoTone(B, M, R.x0, R.z0 - 0.2, R.x1, R.z0, 'z', H); // north
  wallTwoTone(B, M, R.x0, R.z1, R.x1, R.z1 + 0.2, 'z', H); // south
  // west wall with the door opening (z 0.55 .. 1.45, 2.1 m)
  const dz0 = R.doorZ - 0.45;
  const dz1 = R.doorZ + 0.45;
  wallTwoTone(B, M, R.x0 - 0.2, R.z0 - 0.2, R.x0, dz0, 'x', H);
  wallTwoTone(B, M, R.x0 - 0.2, dz1, R.x0, R.z1 + 0.2, 'x', H);
  B(M.wall, R.x0 - 0.2, 2.1, dz0, R.x0, H, dz1);
  // door casing (5 mm proud of the wall)
  B(M.frame, R.x0 + 0.0, 0, dz0 - 0.06, R.x0 + 0.03, 2.16, dz0, { collide: false });
  B(M.frame, R.x0 + 0.0, 0, dz1, R.x0 + 0.03, 2.16, dz1 + 0.06, { collide: false });
  B(M.frame, R.x0 + 0.0, 2.1, dz0 - 0.06, R.x0 + 0.03, 2.16, dz1 + 0.06, { collide: false });
  // east wall with the window (z -0.8 .. 0.8, sill 0.95, head 2.15)
  const wz0 = -0.8;
  const wz1 = 0.8;
  const sill = 0.95;
  const head = 2.15;
  wallTwoTone(B, M, R.x1, R.z0 - 0.2, R.x1 + 0.2, wz0, 'x', H);
  wallTwoTone(B, M, R.x1, wz1, R.x1 + 0.2, R.z1 + 0.2, 'x', H);
  B(M.wallLow, R.x1, 0, wz0, R.x1 + 0.2, sill, wz1);
  B(M.wall, R.x1, head, wz0, R.x1 + 0.2, H, wz1);
  // window: aluminum frame, the daylight behind, blinds tilted half open
  B(M.frame, R.x1 - 0.04, sill - 0.04, wz0 - 0.04, R.x1 + 0.02, sill, wz1 + 0.04, {
    collide: false,
  });
  B(M.frame, R.x1 - 0.04, head, wz0 - 0.04, R.x1 + 0.02, head + 0.04, wz1 + 0.04, {
    collide: false,
  });
  B(M.frame, R.x1 - 0.04, sill, wz0 - 0.04, R.x1 + 0.02, head, wz0, { collide: false });
  B(M.frame, R.x1 - 0.04, sill, wz1, R.x1 + 0.02, head, wz1 + 0.04, { collide: false });
  B(M.frame, R.x1 + 0.08, sill, -0.02, R.x1 + 0.1, head, 0.02, { collide: false }); // mullion
  B(M.glass, R.x1 + 0.12, sill, wz0, R.x1 + 0.14, head, wz1, { collide: false });
  B(M.trim, R.x1 - 0.06, sill - 0.04, wz0 - 0.08, R.x1 + 0.02, sill, wz1 + 0.08, {
    collide: false,
  });
  for (let y = sill + 0.05; y < head - 0.02; y += 0.048) {
    S.rbox(M.slat, ox + R.x1 - 0.07, y, oz, 0.026, 0.003, wz1 - wz0 - 0.02, 0, { roll: 0.55 });
  }
  B(M.slat, R.x1 - 0.1, head - 0.06, wz0 - 0.02, R.x1 - 0.04, head, wz1 + 0.02, { collide: false });
  for (const z of [-0.45, 0.45]) {
    B(M.slat, R.x1 - 0.075, sill + 0.02, z - 0.004, R.x1 - 0.07, head - 0.06, z + 0.004, {
      collide: false,
    });
  }

  // ---- lights: the window (warm morning daylight) and two troffers in the drop ceiling
  S.light(ox + R.x1 - 0.5, 1.6, oz, 0xffe7c6, 9, 6);
  for (const [x, z] of [
    [-0.9, 0],
    [1.2, 0],
  ]) {
    B(M.housing, x - 0.62, H - 0.02, z - 0.31, x + 0.62, H, z + 0.31, { collide: false });
    B(M.troffer, x - 0.58, H - 0.025, z - 0.27, x + 0.58, H - 0.02, z + 0.27, { collide: false });
  }
  S.light(ox - 0.9, H - 0.35, oz, 0xf2f4ff, 10, 7);
  S.light(ox + 1.0, H - 0.4, oz + 0.2, 0xfff4e6, 8, 6);

  // ---- the desk (top at 0.75) across the room, the counselor behind it with the window at her back
  const dx = SPOTS.desk.x;
  B(M.desk, dx - 0.4, 0.72, -0.8, dx + 0.4, 0.75, 0.8);
  B(M.deskMetal, dx - 0.38, 0, -0.78, dx + 0.36, 0.72, -0.74);
  B(M.deskMetal, dx - 0.38, 0, 0.74, dx + 0.36, 0.72, 0.78);
  B(M.deskMetal, dx - 0.36, 0.25, -0.74, dx - 0.33, 0.72, 0.74, { collide: false }); // modesty panel
  // drawer pedestal on the counselor's side
  B(M.deskMetal, dx + 0.0, 0, 0.3, dx + 0.36, 0.7, 0.74, { collide: false });
  for (const y of [0.14, 0.38, 0.6]) {
    B(M.handle, dx + 0.36, y, 0.45, dx + 0.375, y + 0.02, 0.6, { collide: false });
  }
  deskThings(S, M, ox, oz, dx);

  // ---- chairs: the counselor's office chair, Mari's plain chair
  officeChair(S, M, ox + SPOTS.counselorChair.x + 0.12, oz + SPOTS.counselorChair.z);
  plainChair(S, M, ox + SPOTS.mariChair.x - 0.23, oz + SPOTS.mariChair.z);

  // ---- filing cabinets in the north-east corner, a plant on top
  for (const [i, x] of [1.0, 1.52].entries()) {
    B(M.cabinet, x - 0.24, 0, R.z0, x + 0.24, 1.32, R.z0 + 0.66);
    for (let d = 0; d < 4; d++) {
      const y = 0.08 + d * 0.31;
      B(M.cabinet, x - 0.22, y, R.z0 + 0.66, x + 0.22, y + 0.28, R.z0 + 0.675, { collide: false });
      B(M.handle, x - 0.07, y + 0.19, R.z0 + 0.675, x + 0.07, y + 0.215, R.z0 + 0.69, {
        collide: false,
      });
      B(M.paper, x - 0.03, y + 0.225, R.z0 + 0.675, x + 0.03, y + 0.255, R.z0 + 0.68, {
        collide: false,
      });
    }
    if (i === 1) {
      S.cyl(M.pot, ox + x, 1.42, oz + R.z0 + 0.3, 0.11, 0.2, { r1: 0.13 });
      for (let k = 0; k < 7; k++) {
        const a = (k / 7) * Math.PI * 2;
        S.rbox(
          M.plant,
          ox + x + Math.sin(a) * 0.08,
          1.62,
          oz + R.z0 + 0.3 + Math.cos(a) * 0.08,
          0.06,
          0.34,
          0.01,
          a,
          {
            pitch: 0.5,
          },
        );
      }
    }
  }
  // a stack of binders on the first cabinet
  for (let k = 0; k < 4; k++) {
    B(
      k % 2 ? M.folderB : M.folder,
      0.82 + k * 0.08,
      1.32,
      R.z0 + 0.12,
      0.88 + k * 0.08,
      1.6,
      R.z0 + 0.4,
      {
        collide: false,
      },
    );
  }

  // ---- the framed palm print (east wall, beside the window) and a calendar
  const palm = S.picture(256, 320, drawPalmPrint, { ambient: 0x1a1a1a });
  B(M.trim, R.x1 - 0.03, 1.22, 1.18, R.x1, 1.98, 1.8, { collide: false });
  S.quad(palm, ox + R.x1 - 0.035, 1.6, oz + 1.49, 0.52, 0.66, -Math.PI / 2);
  const cal = S.picture(256, 320, drawCalendar);
  S.quad(cal, ox + R.x1 - 0.01, 1.55, oz - 1.55, 0.34, 0.44, -Math.PI / 2);

  // ---- the west wall: bulletin board and a clock (the background of the reverse shot)
  B(M.trim, R.x0, 1.05, -1.55, R.x0 + 0.03, 1.85, -0.15, { collide: false });
  B(M.cork, R.x0 + 0.03, 1.08, -1.52, R.x0 + 0.035, 1.82, -0.18, { collide: false });
  const notes = S.picture(512, 288, drawBoardNotes);
  S.quad(notes, ox + R.x0 + 0.04, 1.45, oz - 0.85, 1.3, 0.72, Math.PI / 2);
  const clock = S.picture(128, 128, drawClock, { transparent: true });
  S.quad(clock, ox + R.x0 + 0.03, 2.3, oz - 0.6, 0.32, 0.32, Math.PI / 2);
  // a small bookshelf under the board
  B(M.deskMetal, R.x0, 0, -1.6, R.x0 + 0.32, 0.9, -0.4);
  for (let k = 0; k < 9; k++) {
    const c = [M.folder, M.folderB, M.plastic, M.paper][k % 4];
    B(
      c,
      R.x0 + 0.05,
      0.47,
      -1.55 + k * 0.12,
      R.x0 + 0.28,
      0.75 + (k % 3) * 0.03,
      -1.47 + k * 0.12,
      {
        collide: false,
      },
    );
  }

  // ---- the door: wood with a narrow window, swings into the room (hinge on the north jamb)
  const door = makeDoor(S, M, ox + R.x0, oz + dz0, oz + dz1);

  return { door };
}

// a block wall from (xa, za) to (xb, zb) (one of them thin), the lower 1.1 m in the darker band color
function wallTwoTone(B, M, xa, za, xb, zb, axis, H) {
  B(M.wallLow, xa, 0, za, xb, 1.1, zb);
  B(M.wall, xa, 1.1, za, xb, H, zb);
  // the chair rail between the two paints, 12 mm proud on the room side (the room is around the origin)
  const t = 0.012;
  if (axis === 'z') {
    const inner = Math.abs(za) < Math.abs(zb) ? za : zb;
    const dir = inner < 0 ? 1 : -1;
    B(
      M.trim,
      xa,
      1.08,
      Math.min(inner, inner + dir * t),
      xb,
      1.12,
      Math.max(inner, inner + dir * t),
      {
        collide: false,
      },
    );
  } else {
    const inner = Math.abs(xa) < Math.abs(xb) ? xa : xb;
    const dir = inner < 0 ? 1 : -1;
    B(
      M.trim,
      Math.min(inner, inner + dir * t),
      1.08,
      za,
      Math.max(inner, inner + dir * t),
      1.12,
      zb,
      {
        collide: false,
      },
    );
  }
}

function deskThings(S, M, ox, oz, dx) {
  const top = 0.75;
  // the open notebook in front of the counselor, a pen beside it
  const page = S.picture(512, 360, drawNotebook, { ambient: 0x202020 });
  S.box(M.folderB, ox + dx + 0.02, top, oz - 0.16, ox + dx + 0.3, top + 0.008, oz + 0.24, {
    collide: false,
  });
  S.quad(page, ox + dx + 0.16, top + 0.0095, oz + 0.04, 0.4, 0.28, Math.PI / 2, -Math.PI / 2);
  S.cyl(M.chairFrame, ox + dx + 0.12, top + 0.012, oz + 0.33, 0.005, 0.15, { axis: 'z', seg: 6 });
  // the mug (and its coffee), a file folder, a phone and a small monitor turned toward her
  S.cyl(M.mug, ox + dx + 0.2, top + 0.05, oz - 0.5, 0.042, 0.1, { seg: 16 });
  S.cyl(M.coffee, ox + dx + 0.2, top + 0.095, oz - 0.5, 0.036, 0.004, { seg: 16 });
  S.box(M.mug, ox + dx + 0.235, top + 0.03, oz - 0.505, ox + dx + 0.26, top + 0.08, oz - 0.495, {
    collide: false,
  });
  S.box(M.folder, ox + dx - 0.22, top, oz - 0.62, ox + dx + 0.02, top + 0.02, oz - 0.3, {
    collide: false,
  });
  S.box(M.paper, ox + dx - 0.21, top + 0.02, oz - 0.6, ox + dx + 0.01, top + 0.024, oz - 0.32, {
    collide: false,
  });
  S.box(M.chairFrame, ox + dx + 0.1, top, oz + 0.5, ox + dx + 0.3, top + 0.05, oz + 0.68, {
    collide: false,
  });
  S.rbox(M.chairFrame, ox + dx + 0.28, top + 0.01, oz + 0.62, 0.16, 0.012, 0.12, 0.4);
  S.rbox(M.screen, ox + dx + 0.18, top + 0.3, oz + 0.62, 0.035, 0.32, 0.5, 0.35);
  S.rbox(M.chairFrame, ox + dx + 0.24, top + 0.08, oz + 0.62, 0.05, 0.16, 0.05, 0.35);
}

// office chair: five-star base, gas lift, seat at 0.48, mesh back
function officeChair(S, M, x, z) {
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2;
    S.rbox(M.chairFrame, x + Math.sin(a) * 0.15, 0.06, z + Math.cos(a) * 0.15, 0.04, 0.03, 0.3, a);
  }
  S.cyl(M.chairFrame, x, 0.26, z, 0.025, 0.4);
  S.box(M.chairSeat, x - 0.25, 0.42, z - 0.25, x + 0.25, 0.48, z + 0.25, { collide: false });
  S.box(M.chairSeat, x + 0.2, 0.55, z - 0.23, x + 0.26, 1.05, z + 0.23, { collide: false });
  S.solid(x - 0.25, 0, z - 0.25, x + 0.26, 0.48, z + 0.25);
}

// a plain steel-and-plastic visitor chair, seat at 0.46
function plainChair(S, M, x, z) {
  for (const [a, b] of [
    [-0.2, -0.2],
    [-0.2, 0.2],
    [0.2, -0.2],
    [0.2, 0.2],
  ]) {
    S.cyl(M.chairFrame, x + a, 0.22, z + b, 0.012, 0.44, { seg: 6 });
  }
  S.box(M.plastic, x - 0.23, 0.43, z - 0.23, x + 0.23, 0.46, z + 0.23, { collide: false });
  S.box(M.plastic, x - 0.25, 0.6, z - 0.21, x - 0.22, 0.9, z + 0.21, { collide: false });
  S.cyl(M.chairFrame, x - 0.235, 0.66, z - 0.2, 0.01, 0.42, { seg: 6 });
  S.cyl(M.chairFrame, x - 0.235, 0.66, z + 0.2, 0.01, 0.42, { seg: 6 });
  // no collider: Mari is placed on it (a seat collider would catch the landing ray of her teleport)
}

// the office door: a group that swings about its hinge (north jamb); its collider follows open(t)
function makeDoor(S, M, x, z0, z1) {
  return S.swingDoor({
    hingeX: x + 0.03,
    hingeZ: z0,
    width: z1 - z0,
    height: 2.1,
    thick: 0.045,
    material: M.door,
    trim: M.handle,
    window: M.glass,
    openYaw: 1.45,
  });
}

// ---------------------------------------------------------------- canvas art (original)
function drawPalmPrint(g, w, h) {
  // a faded sunset print with two palms, in a white mat
  g.fillStyle = '#f2efe6';
  g.fillRect(0, 0, w, h);
  const ix = 26;
  const iy = 30;
  const iw = w - 52;
  const ih = h - 60;
  const sky = g.createLinearGradient(0, iy, 0, iy + ih);
  sky.addColorStop(0, '#f6c98a');
  sky.addColorStop(0.45, '#f29b74');
  sky.addColorStop(0.7, '#c86d7e');
  sky.addColorStop(1, '#4a5c7a');
  g.fillStyle = sky;
  g.fillRect(ix, iy, iw, ih);
  g.fillStyle = 'rgba(255,236,190,0.9)';
  g.beginPath();
  g.arc(ix + iw * 0.62, iy + ih * 0.58, 22, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#35465e';
  g.fillRect(ix, iy + ih * 0.72, iw, ih * 0.28);
  g.fillStyle = 'rgba(255,220,170,0.35)';
  for (let i = 0; i < 6; i++)
    g.fillRect(ix + iw * 0.55, iy + ih * (0.75 + i * 0.03), 40 - i * 5, 2);
  palm(g, ix + iw * 0.28, iy + ih * 0.78, 0.9, -0.15);
  palm(g, ix + iw * 0.4, iy + ih * 0.8, 0.65, 0.1);
  g.strokeStyle = '#2b2b2b';
  g.lineWidth = 2;
  g.strokeRect(ix, iy, iw, ih);
}

function palm(g, x, y, s, lean) {
  g.strokeStyle = '#1e1a20';
  g.lineWidth = 6 * s;
  g.beginPath();
  g.moveTo(x, y);
  const tx = x + lean * 120 * s + 14 * s;
  const ty = y - 150 * s;
  g.quadraticCurveTo(x + 30 * s, y - 80 * s, tx, ty);
  g.stroke();
  g.lineWidth = 3 * s;
  for (let i = 0; i < 9; i++) {
    const a = -Math.PI + (i / 8) * Math.PI + (i % 2) * 0.12;
    const len = (55 + (i % 3) * 10) * s;
    g.beginPath();
    g.moveTo(tx, ty);
    g.quadraticCurveTo(
      tx + Math.cos(a) * len * 0.6,
      ty + Math.sin(a) * len * 0.4 - 12 * s,
      tx + Math.cos(a) * len,
      ty + Math.sin(a) * len * 0.5 + 18 * s,
    );
    g.stroke();
  }
}

function drawNotebook(g, w, h) {
  g.fillStyle = '#f4f1e8';
  g.fillRect(0, 0, w, h);
  g.strokeStyle = 'rgba(80,120,190,0.45)';
  g.lineWidth = 1;
  for (let y = 40; y < h; y += 18) {
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(w, y);
    g.stroke();
  }
  g.strokeStyle = 'rgba(200,60,60,0.5)';
  g.beginPath();
  g.moveTo(40, 0);
  g.lineTo(40, h);
  g.moveTo(w / 2 + 40, 0);
  g.lineTo(w / 2 + 40, h);
  g.stroke();
  // the spine
  g.fillStyle = 'rgba(0,0,0,0.12)';
  g.fillRect(w / 2 - 3, 0, 6, h);
  // handwriting scribbles on the left page
  g.strokeStyle = 'rgba(30,40,90,0.8)';
  g.lineWidth = 1.4;
  let seed = 7;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  for (let row = 0; row < 11; row++) {
    const y = 36 + row * 18;
    let x = 48;
    const end = w / 2 - 20 - rnd() * 60;
    g.beginPath();
    g.moveTo(x, y);
    while (x < end) {
      const nx = x + 4 + rnd() * 6;
      g.lineTo(nx, y - 3 - rnd() * 6);
      x = nx;
      g.lineTo(x + 2, y);
      if (rnd() < 0.12) {
        x += 8;
        g.moveTo(x, y);
      }
    }
    g.stroke();
  }
}

function drawCalendar(g, w, h) {
  g.fillStyle = '#fbfaf6';
  g.fillRect(0, 0, w, h);
  g.fillStyle = '#3b6e8f';
  g.fillRect(0, 0, w, 90);
  g.fillStyle = '#fff';
  g.font = 'bold 34px sans-serif';
  g.fillText('NOVEMBER', 24, 58);
  g.strokeStyle = '#c9c6bd';
  for (let r = 0; r < 6; r++) {
    for (let c = 0; c < 7; c++) {
      g.strokeRect(10 + c * 34, 104 + r * 34, 34, 34);
    }
  }
  g.fillStyle = '#c0392b';
  g.font = 'bold 18px sans-serif';
  g.fillText('X', 22, 128);
  g.fillText('X', 56, 128);
  g.fillText('X', 90, 128);
}

function drawBoardNotes(g, w, h) {
  g.clearRect(0, 0, w, h);
  const notes = [
    [20, 18, 120, 150, '#f7f3e8', 'VISITATION'],
    [160, 30, 110, 130, '#fff6a8', ''],
    [290, 14, 140, 170, '#eef3f8', 'GED CLASSES'],
    [40, 180, 150, 90, '#f7f3e8', 'REENTRY'],
    [220, 190, 100, 80, '#ffd7c2', ''],
    [350, 200, 140, 80, '#eef3f8', 'WORK RELEASE'],
  ];
  for (const [x, y, nw, nh, c, title] of notes) {
    g.fillStyle = 'rgba(0,0,0,0.25)';
    g.fillRect(x + 3, y + 4, nw, nh);
    g.fillStyle = c;
    g.fillRect(x, y, nw, nh);
    g.fillStyle = '#333';
    g.font = 'bold 13px sans-serif';
    if (title) g.fillText(title, x + 8, y + 20);
    g.fillStyle = 'rgba(40,40,40,0.5)';
    for (let k = 0; k < 6; k++) g.fillRect(x + 8, y + 32 + k * 10, nw - 16 - (k % 3) * 14, 3);
    g.fillStyle = '#c0392b';
    g.beginPath();
    g.arc(x + nw / 2, y + 6, 4, 0, Math.PI * 2);
    g.fill();
  }
}

function drawClock(g, w, h) {
  const r = w / 2 - 4;
  g.clearRect(0, 0, w, h);
  g.fillStyle = '#222';
  g.beginPath();
  g.arc(w / 2, h / 2, r + 3, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#f6f4ee';
  g.beginPath();
  g.arc(w / 2, h / 2, r - 2, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = '#222';
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    g.lineWidth = i % 3 ? 2 : 4;
    g.beginPath();
    g.moveTo(w / 2 + Math.sin(a) * (r - 12), h / 2 - Math.cos(a) * (r - 12));
    g.lineTo(w / 2 + Math.sin(a) * (r - 4), h / 2 - Math.cos(a) * (r - 4));
    g.stroke();
  }
  // ten past six in the morning
  hand(g, w, h, (6 + 10 / 60) / 12, r * 0.5, 5);
  hand(g, w, h, 10 / 60, r * 0.75, 3);
}

function hand(g, w, h, turn, len, width) {
  const a = turn * Math.PI * 2;
  g.lineWidth = width;
  g.beginPath();
  g.moveTo(w / 2, h / 2);
  g.lineTo(w / 2 + Math.sin(a) * len, h / 2 - Math.cos(a) * len);
  g.stroke();
}

// ---------------------------------------------------------------- mission helpers
// Office-local -> world point
export function officeWorld(x, z, y = 0) {
  return {
    x: PRISON.site.x + PRISON.office.x + x,
    y: PRISON.site.y + y,
    z: PRISON.site.z + PRISON.office.z + z,
  };
}

// a spot in SPOTS as a world { x, y, z, heading }
export function officeSpot(name) {
  const s = SPOTS[name];
  return { ...officeWorld(s.x, s.z), heading: s.heading };
}

// The cutscene frame for the office: local [right, up, forward] arrays with the frame facing the window (+x), origin in
// the middle of the room on the floor. In this frame (right = +z of the office) Mari sits at [-0.05, 0, -0.42] and the counselor at [0.05, 0, 1.62].
export function officeFrame() {
  const o = officeWorld(0, 0);
  return { x: o.x, y: o.y, z: o.z, heading: Math.PI / 2 };
}

// Build (or reuse) the office, seat the counselor at her desk and put Mari in her chair. Everything is released on the
// mission's cleanup. Returns { counselor } (the staged actor; also ctx.h.counselor).
export async function openPrisonOffice(ctx, opts = {}) {
  const { game } = ctx;
  const set = await acquirePrisonSet(game, opts.mode || 'office');
  ctx.track(set, () => releasePrisonSet(game));
  const c = officeSpot('counselorChair');
  const counselor = ctx.spawnActor('counselor', {
    person: COUNSELOR.person,
    at: c,
    pose: 'sit',
  });
  if (opts.seatMari !== false) {
    await set.seatPlayer(ctx, officeSpot('mariChair'));
  }
  return { counselor, set };
}

// Frame and over-the-shoulder shots for an office conversation (the storyboard's panel 4). `lines` is up to you.
export function officeShots() {
  return {
    frame: officeFrame(),
    shots: [
      // establishing: from the door corner, both at the desk, the window and blinds behind the counselor
      {
        dur: 4.5,
        mm: 28,
        from: { pos: [1.9, 1.75, -1.9], look: [-0.1, 1.05, 0.9] },
        to: { pos: [1.6, 1.7, -1.6] },
      },
      // over Mari's right shoulder onto the counselor
      {
        dur: 5,
        mm: 50,
        from: { pos: [0.32, 1.28, -0.98], look: [0.05, 1.12, 1.62] },
        focus: [0.05, 1.15, 1.62],
      },
      // reverse: over the counselor's shoulder onto Mari
      {
        dur: 5,
        mm: 50,
        from: { pos: [-0.35, 1.3, 2.2], look: [-0.05, 1.1, -0.42] },
        focus: [-0.05, 1.1, -0.42],
      },
    ],
  };
}
