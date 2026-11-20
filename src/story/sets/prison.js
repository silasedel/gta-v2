// The women's prison of the intro v2 (storyboard panels 2-4): Mari's cell, the cell block corridor with its dayroom, and
// the counselor's office at the end of it. A closed interior set (src/story/sets/setKit.js) that floats high above the
// open Gulf west of Naples, where nothing else streams in, so it costs nothing while it is not in use:
//   - it is built only when a prison mission asks for it (acquirePrisonSet), shared by the missions that follow each other
//     (cell -> walk -> counselor), and disposed (meshes, materials, colliders, lights) as soon as no mission holds it and
//     the player is out of it (releasePrisonSet + a small watcher);
//   - while the player is inside: indoor exposure, no rain / haze / sun glare, the clock held at 6:10 in the morning.
// 'office' mode builds the office alone (intro2.counselor2 comes back to it after the flashback).
import * as THREE from 'three';
import { createSet } from './setKit.js';
import { buildOffice } from './prisonOffice.js';

// Where the set floats (world meters): open water in the Gulf of Mexico, 300 m up
const SITE = { x: -7050, y: 300, z: 1500 };
const HOUR = 6.17;
const PLACE_NAME = 'Women’s Correctional'; // 6:10 in the morning: the first count, the counselor's first appointment

// Set-frame anchors (x east, z south, floor y = 0). The corridor runs along +x from the cell to the office.
export const PRISON = {
  site: SITE,
  hour: HOUR,
  office: { x: 32.6, z: 0 },
  cell: {
    x0: 0,
    x1: 3.0,
    z0: 1.8,
    z1: 5.6,
    // Mari starts in the middle of the cell facing the back wall (the barred window), the bunk on her right
    mariStart: { x: 1.95, z: 3.95, heading: -0.3 },
    // the cellmate sits on the edge of the lower bunk, turned a little toward the door
    cellmate: { x: 0.95, z: 4.15, heading: Math.PI / 2 - 0.35 },
    doorX: 2.4,
    // the guard stops in the corridor beside the door
    guardDoor: { x: 3.35, z: 0.85, heading: -0.6 },
  },
  // the guard's route from the cell door to the office door
  walk: [
    { x: 2.4, z: 0.7 },
    { x: 5.5, z: 0.15 },
    { x: 14, z: -0.1 },
    { x: 22, z: -0.1 },
    { x: 28.4, z: 0.55 },
    { x: 29.35, z: 1.0 },
  ],
  officeDoor: { x: 29.35, z: 1.0, heading: Math.PI / 2 },
  // inmates out on the floor: two at a dayroom table, one leaning on the corridor wall
  inmates: [
    { person: 'p198', x: 5.05, z: -3.45, heading: Math.PI, pose: 'sit' },
    { person: 'p199', x: 5.05, z: -4.75, heading: 0, pose: 'sit' },
    { person: 'p197', x: 12.6, z: -1.28, heading: 0.15, pose: 'lean_cross' },
  ],
};

// ---------------------------------------------------------------- the shared set (one at a time)
let cur = null; // { S, mode, holders, door, officeDoor, built }
let watching = false;
const env = { on: false, saved: null, districtAt: null, setIndoor: null };

function worldOf(x, z, y = 0) {
  return { x: SITE.x + x, y: SITE.y + y, z: SITE.z + z };
}

// A set-frame spot as world { x, y, z, heading }
export function prisonSpot(s) {
  return { ...worldOf(s.x, s.z), heading: s.heading ?? 0 };
}

// Build the set (or reuse the one standing). mode 'full' (cell block + office) or 'office'. Resolves once its textures are in.
export async function acquirePrisonSet(game, mode = 'full') {
  if (cur && cur.mode === 'office' && mode === 'full' && cur.holders === 0) {
    disposeSet();
  }
  if (!cur) cur = buildSet(game, mode);
  cur.holders++;
  watch(game);
  await cur.S.ready();
  return cur.api;
}

// A mission is done with it: the set goes once nobody holds it and the player has left it.
export function releasePrisonSet() {
  if (cur) cur.holders = Math.max(0, cur.holders - 1);
}

export function prisonActive() {
  return !!cur;
}

function disposeSet() {
  if (!cur) return;
  try {
    cur.S.dispose();
  } catch (e) {
    console.warn('[prison] dispose', e);
  }
  cur = null;
}

// Every frame while a set exists: the indoor look while the player is in it, disposal once he is gone and nobody holds it.
function watch(game) {
  if (watching) return;
  watching = true;
  const tick = () => {
    const inside = playerInside(game);
    if (inside && !env.on) enterEnv(game);
    if (!inside && env.on) leaveEnv(game);
    if (env.on) {
      game.timeOfDay = HOUR;
    }
    if (cur && cur.holders === 0 && !inside) disposeSet();
    if (!cur && !env.on) {
      const i = game.updaters.indexOf(tick);
      if (i >= 0) game.updaters.splice(i, 1);
      watching = false;
    }
  };
  game.updaters.push(tick);
}

function playerInside(game) {
  if (!cur) return false;
  const p = game.player?.position;
  if (!p) return false;
  return (
    p.x > SITE.x - 8 &&
    p.x < SITE.x + 40 &&
    p.z > SITE.z - 10 &&
    p.z < SITE.z + 10 &&
    Math.abs(p.y - SITE.y) < 12
  );
}

function enterEnv(game) {
  env.on = true;
  env.saved = {
    timeExternal: game.timeExternal,
    hour: game.timeOfDay,
    haze: game.lookHaze,
  };
  game.timeExternal = true;
  game.timeOfDay = HOUR;
  game.lookHaze = { day: 0, golden: 0, night: 0 };
  // the HUD names the district under the player: here that would be the open Gulf
  const city = game.city;
  if (city?.districtAt && !env.districtAt) {
    const orig = city.districtAt;
    env.districtAt = orig;
    city.districtAt = function districtAtPrison(x, z, ...rest) {
      if (Math.abs(x - SITE.x - 16) < 60 && Math.abs(z - SITE.z) < 30) return PLACE_NAME;
      return orig.call(this, x, z, ...rest);
    };
  }
  // the legacy shop manager clears the indoor flag every frame the player is not in one of its shops: while in the
  // prison the flag stays on whatever it asks
  const E = game.env;
  if (E?.setIndoor && !env.setIndoor) {
    env.setIndoor = E.setIndoor;
    E.setIndoor = function setIndoorPrison() {
      return env.setIndoor.call(this, true);
    };
    env.setIndoor.call(E, true);
  }
  if (game.player?.state) game.player.state.indoor = true;
}

function leaveEnv(game) {
  env.on = false;
  const s = env.saved || {};
  game.timeExternal = s.timeExternal || false;
  if (env.districtAt && game.city) {
    game.city.districtAt = env.districtAt;
    env.districtAt = null;
  }
  if (s.haze) game.lookHaze = s.haze;
  else delete game.lookHaze;
  if (env.setIndoor && game.env) {
    game.env.setIndoor = env.setIndoor;
    env.setIndoor = null;
    game.env.setIndoor(false);
  }
  if (game.player?.state) game.player.state.indoor = false;
  env.saved = null;
}

// ---------------------------------------------------------------- building
function buildSet(game, mode) {
  const S = createSet(game, { ...SITE, name: 'prison-' + mode });
  const set = { S, mode, holders: 0, cellDoor: null, officeDoor: null };
  if (mode === 'full') {
    const M = blockMaterials(S);
    buildCorridor(S, M);
    set.cellDoor = buildCell(S, M);
    buildDayroom(S, M);
  }
  const office = buildOffice(S, PRISON.office.x, PRISON.office.z);
  set.officeDoor = office.door;
  S.build();
  set.api = {
    mode,
    root: S.root,
    cellDoor: set.cellDoor,
    officeDoor: set.officeDoor,
    spot: prisonSpot,
    seatPlayer: (ctx, at) => seatPlayer(game, at),
  };
  return set;
}

function blockMaterials(S) {
  return {
    wallUp: S.surf('cmu', { c: [186, 186, 180], wear: 0.5 }, { rough: 0.9, ambient: 0x121212 }),
    wallLow: S.surf('cmu', { c: [104, 114, 120], wear: 0.6 }, { rough: 0.75, ambient: 0x0b0c0d }),
    cellWall: S.surf('cmu', { c: [168, 168, 162], wear: 0.8 }, { rough: 0.92, ambient: 0x101010 }),
    floor: S.surf(
      'concrete',
      { c: [138, 138, 134], wear: 0.6 },
      { rough: 0.42, ambient: 0x0c0c0c },
    ),
    cellFloor: S.surf(
      'concrete',
      { c: [122, 120, 114], wear: 0.9 },
      { rough: 0.7, ambient: 0x0a0a0a },
    ),
    ceil: S.surf('concrete', { c: [176, 176, 172], wear: 0.4 }, { rough: 0.95, ambient: 0x141414 }),
    door: S.flat(0x5d6870, { rough: 0.55, metal: 0.35, ambient: 0x08090a }),
    doorFrame: S.flat(0x4a5258, { rough: 0.5, metal: 0.4 }),
    slot: S.flat(0x0b0e10, { rough: 0.12, metal: 0.3 }),
    steel: S.flat(0xb4babf, { rough: 0.3, metal: 0.45, ambient: 0x141414 }),
    paintedSteel: S.flat(0x6d767c, { rough: 0.5, metal: 0.4, ambient: 0x08090a }),
    bars: S.flat(0x3c4146, { rough: 0.45, metal: 0.6 }),
    mattress: S.flat(0x6f7f8c, { rough: 0.6 }),
    blanket: S.flat(0x4d5257, { rough: 1, ambient: 0x08090a }),
    pillow: S.flat(0xd8d4c8, { rough: 0.9 }),
    housing: S.flat(0xdedfd8, { rough: 0.5 }),
    tube: S.glow(0xeef4ff, 2.6),
    dawn: S.glow(0x5b78a8, 1.1),
    dark: S.flat(0x050607, { rough: 1 }),
    line: S.flat(0xc9a227, { rough: 0.6 }),
    pipe: S.flat(0x7c8186, { rough: 0.4, metal: 0.7 }),
    table: S.flat(0x9aa1a6, { rough: 0.35, metal: 0.8 }),
    tv: S.flat(0x0d0f12, { rough: 0.2 }),
    tvGlow: S.glow(0x3a5878, 0.8),
    book: S.flat(0x7a2e2a, { rough: 0.8 }),
    bookB: S.flat(0x2f4f6a, { rough: 0.8 }),
    cup: S.flat(0xe0dcd0, { rough: 0.5 }),
    redGlow: S.glow(0xff2a1e, 2.4),
  };
}

// The corridor: 3.2 m wide, x -3.4 .. 30, two-tone painted block, polished concrete, fluorescent strips, steel doors.
function buildCorridor(S, M) {
  const X0 = -3.4;
  const X1 = 30.0;
  const H = 3.2;
  // floor, ceiling, the yellow lines prisoners walk on
  S.box(M.floor, X0 - 0.2, -0.3, -1.8, X1, 0, 1.8);
  S.box(M.ceil, X0 - 0.2, H, -1.8, X1, H + 0.2, 1.8);
  S.box(M.line, X0, 0, 1.14, X1, 0.005, 1.22, { collide: false });
  S.box(M.line, X0, 0, -1.22, X1, 0.005, -1.14, { collide: false });
  // south wall: an opening for Mari's cell door (x 1.95 .. 2.85), solid elsewhere
  wall2(S, M, X0, 1.6, 1.95, 1.8, H);
  wall2(S, M, 2.85, 1.6, X1, 1.8, H);
  S.box(M.wallUp, 1.95, 2.1, 1.6, 2.85, H, 1.8);
  // north wall: open to the dayroom between x 3.4 and 9.4 (two square columns)
  wall2(S, M, X0, -1.8, 3.4, -1.6, H);
  wall2(S, M, 9.4, -1.8, X1, -1.6, H);
  S.box(M.wallUp, 3.4, 2.5, -1.8, 9.4, H, -1.6);
  for (const x of [5.4, 7.4]) S.box(M.wallLow, x - 0.15, 0, -1.8, x + 0.15, 2.5, -1.5);
  // the west end: a barred gate onto a dark sally port
  S.box(M.wallUp, X0 - 0.2, 0, -1.8, X0, H, -0.7);
  S.box(M.wallUp, X0 - 0.2, 0, 0.7, X0, H, 1.8);
  S.box(M.wallUp, X0 - 0.2, 2.3, -0.7, X0, H, 0.7);
  S.box(M.dark, X0 - 1.2, 0, -0.7, X0 - 1.0, 2.3, 0.7);
  S.box(M.dark, X0 - 1.2, -0.3, -0.8, X0 - 0.2, 0, 0.8, { collide: false });
  S.solid(X0 - 0.2, 0, -0.7, X0, 2.3, 0.7);
  for (let z = -0.62; z <= 0.63; z += 0.12)
    S.cyl(M.bars, X0 - 0.1, 1.15, z, 0.012, 2.3, { seg: 6 });
  for (const y of [0.1, 1.1, 2.2])
    S.box(M.bars, X0 - 0.13, y, -0.7, X0 - 0.07, y + 0.05, 0.7, { collide: false });
  // the east end wall (the office's west wall stands behind it): the office door opening at z 0.55 .. 1.45
  S.box(M.wallUp, 29.8, 0, -1.8, X1, H, 0.55);
  S.box(M.wallUp, 29.8, 0, 1.45, X1, H, 1.8);
  S.box(M.wallUp, 29.8, 2.1, 0.55, X1, H, 1.45);
  // cell doors along both walls (steel slabs proud of the wall, a dark vision slot, a tray slot)
  for (let i = 1; i < 9; i++) cellDoorDecor(S, M, i * 3.2 + 2.4, 1.6, 1);
  for (let i = 0; i < 9; i++) {
    if (i === 1 || i === 2) continue;
    cellDoorDecor(S, M, i * 3.2 + 0.6, -1.6, -1);
  }
  // fluorescent strips every 3.2 m, a real light on every other one
  for (let x = -1.6; x < X1; x += 3.2) {
    S.box(M.housing, x - 0.7, H - 0.09, -0.14, x + 0.7, H, 0.14, { collide: false });
    S.box(M.tube, x - 0.64, H - 0.1, -0.1, x + 0.64, H - 0.09, 0.1, { collide: false });
  }
  for (const x of [1.6, 8.0, 14.4, 20.8, 27.2]) S.light(x, H - 0.4, 0, 0xeaf0ff, 10, 9);
  // conduit and a sprinkler pipe under the ceiling, a camera dome, the exit sign over the office door
  S.cyl(M.pipe, (X0 + X1) / 2, H - 0.12, 1.3, 0.025, X1 - X0, { axis: 'x', seg: 8 });
  S.cyl(M.pipe, (X0 + X1) / 2, H - 0.16, -1.32, 0.04, X1 - X0, { axis: 'x', seg: 10 });
  S.cyl(M.dark, 12, H - 0.08, -1.2, 0.09, 0.16, { seg: 12 });
  S.box(M.paintedSteel, 29.68, 2.3, 0.75, 29.8, 2.52, 1.25, { collide: false });
  S.box(M.redGlow, 29.67, 2.36, 0.85, 29.68, 2.46, 1.15, { collide: false });
  // block letters on the wall and a sign over the office door
  const sign = S.picture(512, 128, drawBlockSign);
  S.quad(sign, 0.9, 2.55, -1.595, 1.8, 0.45, 0);
  const plate = S.picture(512, 128, drawCounselorPlate);
  S.quad(plate, 29.79, 2.25, 0.25, 0.4, 0.1, -Math.PI / 2);
}

// a corridor wall from (xa, za) to (xb, zb): the lower 1.2 m in the dark band color, block above
function wall2(S, M, xa, za, xb, zb, H) {
  S.box(M.wallLow, xa, 0, za, xb, 1.2, zb);
  S.box(M.wallUp, xa, 1.2, za, xb, H, zb);
}

// a closed cell door on the corridor wall at x center `cx`, wall face z `zf`, `side` +1 south wall / -1 north wall
function cellDoorDecor(S, M, cx, zf, side) {
  const z0 = side > 0 ? zf - 0.05 : zf;
  const z1 = side > 0 ? zf : zf + 0.05;
  const zo0 = side > 0 ? zf - 0.065 : zf + 0.05;
  const zo1 = side > 0 ? zf - 0.05 : zf + 0.065;
  S.box(M.doorFrame, cx - 0.54, 0, z0, cx + 0.54, 2.18, z1, { collide: false });
  S.box(M.door, cx - 0.47, 0.02, zo0, cx + 0.47, 2.1, zo1, { collide: false });
  // the vision slot and the tray slot (5 mm proud)
  const zs0 = side > 0 ? zo0 - 0.006 : zo1;
  const zs1 = side > 0 ? zo0 : zo1 + 0.006;
  S.box(M.slot, cx - 0.06, 1.35, zs0, cx + 0.06, 1.9, zs1, { collide: false });
  S.box(M.paintedSteel, cx - 0.22, 0.95, zs0, cx + 0.22, 1.08, zs1, { collide: false });
  S.box(M.steel, cx + 0.36, 0.98, zs0 - side * 0.01, cx + 0.42, 1.2, zs1, { collide: false });
}

// Mari's cell: grey block, a steel bunk with thin stained mattresses, a steel toilet-sink, a desk shelf, a barred window
// high in the back wall. Returns the sliding steel door.
function buildCell(S, M) {
  const C = PRISON.cell;
  const H = 2.8;
  S.box(M.cellFloor, C.x0 - 0.2, -0.3, C.z0, C.x1 + 0.2, 0, C.z1 + 0.2);
  S.box(M.ceil, C.x0 - 0.2, H, C.z0, C.x1 + 0.2, H + 0.2, C.z1 + 0.2);
  S.box(M.cellWall, C.x0 - 0.2, 0, C.z0, C.x0, H, C.z1 + 0.2);
  S.box(M.cellWall, C.x1, 0, C.z0, C.x1 + 0.2, H, C.z1 + 0.2);
  // back wall with the window opening (x 1.05 .. 1.95, y 2.0 .. 2.45)
  S.box(M.cellWall, C.x0, 0, C.z1, C.x1, 2.0, C.z1 + 0.2);
  S.box(M.cellWall, C.x0, 2.45, C.z1, C.x1, H, C.z1 + 0.2);
  S.box(M.cellWall, C.x0, 2.0, C.z1, 1.05, 2.45, C.z1 + 0.2);
  S.box(M.cellWall, 1.95, 2.0, C.z1, C.x1, 2.45, C.z1 + 0.2);
  S.box(M.dawn, 1.05, 2.0, C.z1 + 0.16, 1.95, 2.45, C.z1 + 0.18, { collide: false });
  for (let x = 1.15; x < 1.95; x += 0.16)
    S.cyl(M.bars, x, 2.225, C.z1 + 0.06, 0.014, 0.45, { seg: 6 });
  S.box(M.bars, 1.05, 2.21, C.z1 + 0.04, 1.95, 2.24, C.z1 + 0.08, { collide: false });
  S.light(1.5, 2.15, C.z1 - 0.5, 0x7d97c8, 2.2, 4);
  // the ceiling fixture (vandal-proof box) and its light
  S.box(M.housing, 1.1, H - 0.08, 3.1, 1.9, H, 3.7, { collide: false });
  S.box(M.tube, 1.15, H - 0.085, 3.15, 1.85, H - 0.08, 3.65, { collide: false });
  S.light(1.5, H - 0.35, 3.4, 0xe6eeff, 11, 7);

  // ---- the bunk along the west wall (x 0 .. 0.82, z 3.2 .. 5.25)
  const bx0 = C.x0;
  const bx1 = 0.82;
  const bz0 = 3.2;
  const bz1 = 5.25;
  for (const [x, z] of [
    [bx1 - 0.03, bz0 + 0.03],
    [bx1 - 0.03, bz1 - 0.03],
  ]) {
    S.box(M.paintedSteel, x - 0.03, 0, z - 0.03, x + 0.03, 1.8, z + 0.03, { collide: false });
  }
  for (const y of [0.38, 1.42]) {
    S.box(M.paintedSteel, bx0, y, bz0, bx1, y + 0.04, bz1);
    S.box(M.paintedSteel, bx1 - 0.04, y - 0.08, bz0, bx1, y + 0.04, bz1, { collide: false });
    S.box(M.mattress, bx0 + 0.02, y + 0.04, bz0 + 0.04, bx1 - 0.05, y + 0.13, bz1 - 0.04, {
      collide: false,
    });
  }
  const stains = S.picture(256, 512, drawMattressStains, { ambient: 0x101010, transparent: true });
  S.quad(
    stains,
    (bx0 + bx1 - 0.03) / 2,
    0.38 + 0.135,
    (bz0 + bz1) / 2,
    bx1 - 0.07,
    bz1 - bz0 - 0.08,
    0,
    -Math.PI / 2,
  );
  S.quad(
    stains,
    (bx0 + bx1 - 0.03) / 2,
    1.42 + 0.135,
    (bz0 + bz1) / 2,
    bx1 - 0.07,
    bz1 - bz0 - 0.08,
    Math.PI,
    -Math.PI / 2,
  );
  // the cellmate's folded blanket and pillow below, Mari's rumpled blanket above
  S.box(M.pillow, 0.08, 0.51, bz1 - 0.5, 0.6, 0.6, bz1 - 0.12, { collide: false });
  S.box(M.blanket, 0.1, 0.51, bz0 + 0.1, 0.62, 0.6, bz0 + 0.55, { collide: false });
  S.rbox(M.blanket, 0.38, 1.6, 4.0, 0.62, 0.06, 0.9, 0.12);
  S.box(M.pillow, 0.08, 1.55, bz1 - 0.48, 0.6, 1.63, bz1 - 0.12, { collide: false });
  // ladder at the foot
  for (const y of [0.75, 1.05])
    S.cyl(M.paintedSteel, bx1 - 0.03, y, bz0 + 0.03, 0.012, 0.01, { seg: 6 });
  S.box(M.paintedSteel, bx1 - 0.05, 0.7, bz0 - 0.02, bx1, 0.73, bz0 + 0.06, { collide: false });
  S.box(M.paintedSteel, bx1 - 0.05, 1.05, bz0 - 0.02, bx1, 1.08, bz0 + 0.06, { collide: false });
  // a tally of days scratched on the wall over the bunk, a photo taped beside it
  const tally = S.picture(256, 128, drawTally, { transparent: true, ambient: 0x101010 });
  S.quad(tally, C.x0 + 0.006, 1.95, 4.3, 0.5, 0.25, Math.PI / 2);
  const photo = S.picture(128, 96, drawSnapshot);
  S.quad(photo, C.x0 + 0.006, 1.0, 4.6, 0.13, 0.1, Math.PI / 2);

  // ---- the steel toilet-sink in the back east corner
  const tx0 = 2.5;
  const tz0 = 4.75;
  const tz1 = 5.5;
  S.box(M.steel, tx0, 0, tz0 + 0.1, C.x1, 0.42, tz1);
  S.box(M.steel, 2.76, 0.42, tz0, C.x1, 1.0, tz1);
  S.cyl(M.steel, 2.58, 0.43, (tz0 + tz1) / 2 + 0.05, 0.19, 0.03, { seg: 18 });
  S.cyl(M.dark, 2.58, 0.445, (tz0 + tz1) / 2 + 0.05, 0.14, 0.004, { seg: 18 });
  S.box(M.slot, 2.8, 0.86, tz0 + 0.12, 2.98, 0.99, tz1 - 0.2, { collide: false });
  S.cyl(M.steel, 2.84, 1.04, tz0 + 0.38, 0.012, 0.08, { seg: 6 });
  S.box(M.steel, 2.95, 1.25, tz0 + 0.12, C.x1, 1.75, tz0 + 0.5, { collide: false }); // polished steel mirror
  // ---- desk shelf and bolted stool on the east wall near the door
  S.box(M.paintedSteel, 2.6, 0.74, 2.3, C.x1, 0.78, 3.25);
  S.box(M.paintedSteel, 2.95, 0.4, 2.7, C.x1, 0.74, 2.85, { collide: false });
  S.cyl(M.paintedSteel, 2.32, 0.23, 2.78, 0.035, 0.46, { seg: 8 });
  S.cyl(M.paintedSteel, 2.32, 0.47, 2.78, 0.16, 0.03, { seg: 16 });
  S.solid(2.16, 0, 2.62, 2.48, 0.48, 2.94);
  S.box(M.book, 2.75, 0.78, 2.4, 2.95, 0.82, 2.68, { collide: false });
  S.box(M.bookB, 2.76, 0.82, 2.42, 2.93, 0.85, 2.64, { collide: false });
  S.cyl(M.cup, 2.78, 0.83, 3.0, 0.035, 0.1, { seg: 12 });

  // ---- the sliding steel door on the corridor side (x 1.9 .. 2.9), slides east along the wall
  const vision = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.55, 0.012), M.slot);
  vision.position.set(2.4, 1.62, 1.494);
  const tray = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.13, 0.012), M.paintedSteel);
  tray.position.set(2.4, 1.0, 1.494);
  const handle = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.24, 0.03), M.steel);
  handle.position.set(1.98, 1.1, 1.485);
  S.box(M.doorFrame, 1.84, 2.1, 1.46, 3.95, 2.2, 1.6, { collide: false }); // the track
  S.box(M.doorFrame, 1.84, 0, 1.56, 1.95, 2.1, 1.6, { collide: false });
  return S.slideDoor({
    x0: 1.9,
    x1: 2.9,
    z0: 1.5,
    z1: 1.56,
    height: 2.1,
    material: M.door,
    parts: [vision, tray, handle],
    slide: [1.0, 0],
  });
}

// The dayroom off the corridor (x 3.4 .. 9.4, z -6.0 .. -1.8): two steel tables with bolted stools, a wall TV.
function buildDayroom(S, M) {
  const H = 3.2;
  const x0 = 3.4;
  const x1 = 9.4;
  const z0 = -6.0;
  S.box(M.floor, x0 - 0.2, -0.3, z0 - 0.2, x1 + 0.2, 0, -1.8);
  S.box(M.ceil, x0 - 0.2, H, z0 - 0.2, x1 + 0.2, H + 0.2, -1.8);
  wall2(S, M, x0 - 0.2, z0 - 0.2, x0, -1.8, H);
  wall2(S, M, x1, z0 - 0.2, x1 + 0.2, -1.8, H);
  wall2(S, M, x0, z0 - 0.2, x1, z0, H);
  for (const tx of [5.05, 7.85]) {
    const tz = -4.1;
    S.cyl(M.table, tx, 0.37, tz, 0.06, 0.74, { seg: 10 });
    S.cyl(M.table, tx, 0.75, tz, 0.5, 0.03, { seg: 24 });
    S.solid(tx - 0.5, 0, tz - 0.5, tx + 0.5, 0.76, tz + 0.5);
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2;
      const sx = tx + Math.sin(a) * 0.72;
      const sz = tz + Math.cos(a) * 0.72;
      S.cyl(M.table, sx, 0.22, sz, 0.03, 0.44, { seg: 8 });
      S.cyl(M.table, sx, 0.455, sz, 0.17, 0.03, { seg: 14 });
    }
  }
  // the TV in a steel cage on the back wall, playing something blue
  S.box(M.tv, 5.9, 1.9, z0, 6.9, 2.5, z0 + 0.1, { collide: false });
  S.box(M.tvGlow, 5.95, 1.95, z0 + 0.1, 6.85, 2.45, z0 + 0.106, { collide: false });
  for (let x = 5.9; x <= 6.91; x += 0.2) S.cyl(M.bars, x, 2.2, z0 + 0.16, 0.008, 0.66, { seg: 5 });
  // light
  for (const x of [5.05, 7.85]) {
    S.box(M.housing, x - 0.7, H - 0.09, -4.24, x + 0.7, H, -3.96, { collide: false });
    S.box(M.tube, x - 0.64, H - 0.1, -4.2, x + 0.64, H - 0.09, -4.0, { collide: false });
  }
  S.light(6.4, H - 0.45, -4.0, 0xeaf0ff, 12, 8);
}

// ---------------------------------------------------------------- seating the player (office chair)
// Mari sits on a chair spot: the player stands on it, and while seated (P.script.seated) the hero plays her sitting pose.
function seatPlayer(game, at) {
  try {
    game.teleport(at.x, at.y, at.z, at.heading);
  } catch (e) {
    /* */
  }
}

// Mari's sitting pose for cutscenes on a chair: the hero's bench sit (root on the seat's front edge, seat ~0.45 m) while
// the scene's player script runs. Call with true from a cutscene's setup and with false from its onEnd.
export function seatedPose(game, on) {
  const s = game.player?.script;
  if (!s) return;
  s.anim = on ? { speed: 0, grounded: true, idleStyle: 'sitBench' } : { speed: 0, grounded: true };
}

// A talking idle for the player during a cutscene (hands move as she speaks)
export function talkPose(game, on) {
  const s = game.player?.script;
  if (!s) return;
  s.anim = on ? { speed: 0, grounded: true, idleStyle: 'talk' } : { speed: 0, grounded: true };
}

// ---------------------------------------------------------------- canvas art (original)
function drawBlockSign(g, w, h) {
  g.clearRect(0, 0, w, h);
  g.fillStyle = 'rgba(30,34,40,0.92)';
  g.font = 'bold 96px Arial, sans-serif';
  g.fillText('C', 20, 104);
  g.font = 'bold 60px Arial, sans-serif';
  g.fillText('BLOCK  101-118', 110, 96);
}

function drawCounselorPlate(g, w, h) {
  g.fillStyle = '#2f3b44';
  g.fillRect(0, 0, w, h);
  g.fillStyle = '#e8e4d8';
  g.font = 'bold 44px Arial, sans-serif';
  g.fillText('COUNSELOR', 24, 58);
  g.font = '30px Arial, sans-serif';
  g.fillText('M. HARLOW', 24, 104);
}

function drawMattressStains(g, w, h) {
  g.clearRect(0, 0, w, h);
  let seed = 11;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  for (let i = 0; i < 9; i++) {
    const x = rnd() * w;
    const y = rnd() * h;
    const r = 20 + rnd() * 60;
    const gr = g.createRadialGradient(x, y, r * 0.2, x, y, r);
    gr.addColorStop(0, 'rgba(96,80,46,0.22)');
    gr.addColorStop(0.8, 'rgba(96,80,46,0.1)');
    gr.addColorStop(1, 'rgba(110,90,50,0)');
    g.fillStyle = gr;
    g.beginPath();
    g.ellipse(x, y, r, r * (0.6 + rnd() * 0.5), rnd() * 3, 0, Math.PI * 2);
    g.fill();
  }
  // seams of the vinyl cover
  g.strokeStyle = 'rgba(40,50,60,0.35)';
  g.lineWidth = 3;
  g.strokeRect(6, 6, w - 12, h - 12);
}

function drawTally(g, w, h) {
  g.clearRect(0, 0, w, h);
  g.strokeStyle = 'rgba(40,40,46,0.7)';
  g.lineWidth = 3;
  let x = 10;
  for (let grp = 0; grp < 9; grp++) {
    const y = grp < 5 ? 14 : 74;
    const gx = grp < 5 ? x : 10 + (grp - 5) * 48;
    for (let k = 0; k < 4; k++) {
      g.beginPath();
      g.moveTo(gx + k * 8, y);
      g.lineTo(gx + k * 8 + 2, y + 40);
      g.stroke();
    }
    g.beginPath();
    g.moveTo(gx - 4, y + 34);
    g.lineTo(gx + 32, y + 6);
    g.stroke();
    if (grp < 5) x += 48;
  }
}

function drawSnapshot(g, w, h) {
  g.fillStyle = '#f4f1ea';
  g.fillRect(0, 0, w, h);
  const sky = g.createLinearGradient(0, 6, 0, h - 16);
  sky.addColorStop(0, '#7fb2d8');
  sky.addColorStop(0.6, '#e8c89a');
  sky.addColorStop(1, '#3d7f96');
  g.fillStyle = sky;
  g.fillRect(6, 6, w - 12, h - 22);
  g.fillStyle = '#2b2b2b';
  g.fillRect(40, 40, 10, 34);
  g.fillRect(66, 36, 10, 38);
  g.fillStyle = 'rgba(255,255,255,0.4)';
  g.fillRect(4, 0, 30, 8);
}
