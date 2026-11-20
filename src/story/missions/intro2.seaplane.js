// Intro v2, storyboard panel 12 (SEAPLANE ESCAPE): the gang's white and red floatplane at the far dock of the swamp
// camp. Nico climbs in, takes off from the water down the open slough (spray behind the floats), flies back across the
// islands of Florida Bay to the employer's dock on Key Largo, lands on the water and taxis in. Cutscene: Vale pays,
// the job is done, and the day ends at Nico's house.
import { defineMission } from '../runner.js';
import {
  PLACES,
  CAST,
  HOURS,
  loadCast,
  asNico,
  setHour,
  shared,
  spawnPlane,
  useMarina,
  playerVehicle,
  house,
  standAt,
  redLivery,
} from './lib/intro.js';
import { buildSwampCamp } from './lib/swampCamp.js';

const SEA = -0.12;
const AIRBORNE = 25; // m over the water counts as off
const NEAR_MARINA = 450; // m: start the landing

function aircraft(ctx) {
  return ctx.h.plane || null;
}

function speedKmh(ctx) {
  const A = aircraft(ctx);
  return Math.abs(A?.speedKmh ?? 0);
}

// the camp is left behind: drop it once the plane is well away (or when the mission ends)
function dropCampWhenFar(ctx) {
  const c = ctx.data.camp;
  if (!c || ctx.dist(PLACES.camp) < 900) return;
  c.dispose();
  ctx.data.camp = null;
  if (shared.camp === c) shared.camp = null;
}

// dev auto-play: put the plane somewhere (a flight state: position, heading, speed)
function placePlane(ctx, at, y, speed, heading) {
  const A = aircraft(ctx);
  const S = A?.S;
  if (!S) return;
  S.pos.set(at.x, y, at.z);
  S.q.setFromAxisAngle(S.pos.clone().set(0, 1, 0), heading);
  S.vel.set(Math.sin(heading) * speed, 0, Math.cos(heading) * speed);
  S.w.set(0, 0, 0);
  S.ctl.throttle = speed > 20 ? 0.75 : 0.1;
}

// the camera rides low off the plane's left wing, then drops behind it (positions follow the plane every frame)
function liftoff(ctx) {
  const A = aircraft(ctx);
  const at = (side, back, up) => () => {
    const p = A?.mesh?.position;
    if (!p) return [0, 0, 0];
    const h = A.S ? Math.atan2(2 * (A.S.q.w * A.S.q.y), 1 - 2 * A.S.q.y * A.S.q.y) : 0;
    const fx = Math.sin(h);
    const fz = Math.cos(h);
    return [p.x - fx * back + fz * side, p.y + up, p.z - fz * back - fx * side];
  };
  return {
    id: 'intro2.seaplane.liftoff',
    fadeIn: false,
    fadeOut: false,
    shots: [
      { dur: 2.6, mm: 32, from: { pos: at(14, 6, 1), look: 'vehicle:plane' }, handheld: 0.7 },
      { dur: 2.4, mm: 40, from: { pos: at(2, 24, 5), look: 'vehicle:plane' }, handheld: 0.5 },
    ],
    lines: [{ at: 0.4, who: 'Cisco', text: 'She flies! Head south-east, Key Largo.', ms: 2600 }],
  };
}

function paid(ctx) {
  const m = ctx.data.marina.spots;
  return {
    id: 'intro2.seaplane.paid',
    frame: m.meet,
    actors: {
      vale: { person: CAST.vale, at: [0, 0.05, 2.4, Math.PI], pose: 'idle' },
      lou: { person: CAST.lou, at: [-1.4, 0.05, 3.4, Math.PI - 0.3], pose: 'cross_arms' },
      dex: { person: CAST.dex, at: [1.5, 0.05, 3.6, Math.PI + 0.3], pose: 'idle' },
      cisco: { person: CAST.cisco, at: [2.3, 0.05, 1.2, -Math.PI / 2], pose: 'cross_arms' },
      guard: { person: CAST.guards[0], at: [-0.4, 0.05, 5.2, Math.PI], pose: 'cross_arms' },
    },
    props: { case: { prop: 'briefcase', at: [0.5, 0.05, 1.7, 0] } },
    setup: (cs) => standAt(cs.game, { ...cs.at([0, 0.05, 0, 0]), y: m.deckY + 0.05 }),
    shots: [
      // the floatplane at the dock in the last light, the crew waiting
      {
        dur: 4.5,
        mm: 28,
        from: { pos: [-9, 3.2, -6], look: [0, 1.4, 2.5] },
        to: { pos: [-7, 2.6, -4] },
      },
      { dur: 4.5, mm: 50, from: { pos: [-0.9, 1.7, -1.6], look: 'actor:vale' }, aperture: 1.6 },
      { dur: 3.8, mm: 60, from: { pos: [1.1, 1.6, 1.4], look: 'player' }, aperture: 1.8 },
      { dur: 4, mm: 40, from: { pos: [2.6, 1.7, 0.2], look: 'actor:vale' }, aperture: 1.5 },
    ],
    lines: [
      { at: 0.4, who: 'Vale', text: 'Six bales, my money back, and Cisco in one piece.', ms: 3000 },
      { at: 3.6, who: 'Cisco', text: 'Mostly one piece.', ms: 1500 },
      {
        at: 5.4,
        who: 'Vale',
        text: 'Five thousand, as promised. A little more for the swamp.',
        ms: 3000,
      },
      { at: 8.8, who: 'Nico', text: 'Next time you need a pilot, hire a pilot.', ms: 2600 },
      { at: 11.6, who: 'Vale', text: 'Go home, Nico. Sleep. I’ll call.', ms: 2600 },
    ],
    // the day ends at home: under the black, nightfall at the house
    end: { player: { at: (game) => house(game, 'spawnYard') } },
    onEnd(cs) {
      setHour(cs.game, HOURS.home);
    },
  };
}

export default defineMission({
  id: 'intro2.seaplane',
  title: 'Floatplane',
  giver: 'Vale',
  intro: true,
  requires: ['intro2.swamp'],
  rewards: { money: 5000 },
  flags: { 'vale.trust': 1, 'cisco.saved': true },
  start: { teleport: false, at: PLACES.farDock },
  end: { at: (game) => house(game, 'spawnYard') },
  async setup(ctx, fromStep) {
    const game = ctx.game;
    await asNico(game);
    setHour(game, HOURS.seaplane);
    if (!fromStep) {
      // the camp and its dock (still standing from the rescue, else built again for a resumed save)
      let c = shared.camp;
      if (!c) c = await buildSwampCamp(game, { ...PLACES.camp, landing: [1, 0] });
      shared.camp = c;
      ctx.data.camp = c;
      ctx.track(c, () => {
        c.dispose();
        if (shared.camp === c) shared.camp = null;
      });
      if (ctx.dist(PLACES.farDock) > 30)
        game.teleport(c.spots.dockEnd.x, null, c.spots.dockEnd.z - 1, 0);
    }
    // the floatplane: the one waiting at the dock, else a new one
    const A = shared.seaplane;
    if (A && !A.disposed && !fromStep) {
      ctx.h.plane = A;
      ctx.track(A, () => {
        if (playerVehicle(game) === A) game.exitVehicle?.();
        game.air?.remove?.(A);
      });
    } else {
      await spawnPlane(ctx, 'plane', 'floatplane', PLACES.farDockWater);
      redLivery(ctx, ctx.h.plane);
    }
    shared.seaplane = null;
    ctx.data.marina = await useMarina(ctx, false);
    await loadCast([CAST.vale, CAST.lou, CAST.dex, CAST.cisco, CAST.guards[0]]);
  },
  steps: [
    {
      id: 'board',
      text: 'Get in the floatplane.',
      enter(ctx) {
        const d = ctx.data.camp?.spots?.dockEnd;
        if (d)
          ctx.spawnActor('cisco', {
            person: CAST.cisco,
            at: { ...d, heading: Math.PI },
            pose: 'idle',
          });
      },
      trigger: { enterVehicle: 'plane' },
      waypoint: 'plane',
      exit: (ctx) => ctx.h.cisco?.remove?.(),
      auto: (ctx) => ctx.game.enterVehicle?.(aircraft(ctx)),
    },
    {
      id: 'takeoff',
      text: 'Take off.',
      enter(ctx) {
        ctx.say('Cisco', 'Full throttle, keep it straight, pull back when she’s light.', 3000);
        ctx.help('W: throttle up. Mouse or K: pull up. A / D: roll.');
      },
      until: (ctx) => ctx.game.player.position.y > SEA + AIRBORNE,
      waypoint: false,
      exit: (ctx) => ctx.help(null),
      auto: (ctx) =>
        placePlane(
          ctx,
          { x: PLACES.farDockWater.x + 350, z: PLACES.farDockWater.z },
          40,
          48,
          Math.PI / 2,
        ),
    },
    // a short chase shot as she climbs away from the slough (storyboard panel 12)
    { id: 'liftoff', cutscene: liftoff },
    {
      id: 'fly',
      text: 'Fly back to the dock on Key Largo.',
      checkpoint: {
        at: PLACES.farDock,
        // back in the floatplane on the water (a retry takes off again)
        restore: (ctx) => ctx.game.enterVehicle?.(aircraft(ctx)),
      },
      onTick: (ctx) => dropCampWhenFar(ctx),
      until: (ctx) => ctx.dist(ctx.data.marina.spots.plane) < NEAR_MARINA,
      waypoint: (ctx) => ctx.data.marina.spots.plane,
      gps: false,
      auto(ctx) {
        const p = ctx.data.marina.spots.planeApproach;
        placePlane(ctx, p, 40, 45, p.heading);
      },
    },
    {
      id: 'land',
      text: 'Land on the water.',
      until: (ctx) => ctx.game.player.position.y < SEA + 3 && speedKmh(ctx) < 75,
      waypoint: (ctx) => ctx.data.marina.spots.plane,
      gps: false,
      fail: {
        leftArea: {
          at: (ctx) => ctx.data.marina.spots.plane,
          r: 3500,
          text: 'You flew away from Key Largo.',
        },
      },
      auto(ctx) {
        const p = ctx.data.marina.spots.planeApproach;
        const q = ctx.data.marina.spots.plane;
        placePlane(ctx, { x: (p.x + q.x) / 2, z: (p.z + q.z) / 2 }, SEA + 1.2, 8, p.heading);
      },
    },
    {
      id: 'taxi',
      text: 'Taxi to the dock.',
      gps: false,
      trigger: { reach: { at: (ctx) => ctx.data.marina.spots.plane, r: 26, inVehicle: true } },
      auto(ctx) {
        const q = ctx.data.marina.spots.plane;
        placePlane(ctx, q, SEA + 1.2, 0, q.heading);
      },
    },
    {
      id: 'paid',
      enter(ctx) {
        if (playerVehicle(ctx.game)) ctx.game.exitVehicle?.();
      },
      cutscene: paid,
    },
  ],
});
