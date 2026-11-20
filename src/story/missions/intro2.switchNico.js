// Intro v2, step 4 (docs/v2/plan/INTRO_V2_PLAN.md): the story switches from Mari in the counselor's office to Nico on
// the Keys the same afternoon. Cutscene: Nico with his associates Dex and Lou on the employer's dock on the Florida
// Bay side of Key Largo, the white center-console motorboat tied up, the drop plane circling low over the flats.
// Then Nico takes the helm (the smuggling run, intro2.smuggling, starts from there).
import { defineMission } from '../runner.js';
import {
  PLACES,
  CAST,
  HOURS,
  loadCast,
  asNico,
  setHour,
  useMarina,
  shared,
  dropOldBoats,
  boardBoat,
  standAt,
} from './lib/intro.js';
import { createDropPlane } from './lib/dropPlane.js';

// the plane's track: in over the island from the ocean side, then the drop line (bales at points 1..6)
export function dropPath() {
  return PLACES.dropLine.map((p) => ({ x: p.x, z: p.z }));
}

// the drop plane, already flying (it circles over the dock while the crew talks); intro2.smuggling takes it over
async function launchPlane(game) {
  if (shared.plane && !shared.plane.A.disposed) return shared.plane;
  const plane = await createDropPlane(game, {
    path: dropPath(),
    start: PLACES.planeIn,
    drops: [1, 2, 3, 4, 5, 6],
    alt: 34,
  });
  if (!plane) return null;
  plane.hold = true;
  shared.plane = plane;
  return plane;
}

function meeting(ctx) {
  const m = ctx.data.marina.spots;
  return {
    id: 'intro2.switchNico.dock',
    frame: m.crew,
    // the crew on the end of the pier: Lou with the radio, Dex by the boat; Nico walks up from the shore
    actors: {
      lou: { person: CAST.lou, at: [-0.9, 0.05, -1.2, 0.4], pose: 'phone_text' },
      dex: { person: CAST.dex, at: [1.1, 0.05, 1.4, Math.PI + 0.3], pose: 'cross_arms' },
    },
    // on the deck (cs.at gives the frame's deck height)
    setup: (cs) => standAt(ctx.game, { ...cs.at([0.1, 0.05, -3.2, 0]), y: m.deckY + 0.05 }),
    shots: [
      // wide: the dock, the boat, turquoise water; a slow crane down
      {
        dur: 5,
        mm: 24,
        from: { pos: [-16, 9, -10], look: [0, 1, 6] },
        to: { pos: [-12, 4, -7], look: [0, 1.2, 4] },
        ease: 'inOut',
      },
      // Lou on the radio, over Nico's shoulder
      { dur: 4.5, mm: 50, from: { pos: [0.6, 1.75, -4.4], look: 'actor:lou' }, aperture: 1.6 },
      // Dex
      { dur: 3.5, mm: 65, from: { pos: [-0.8, 1.6, -0.6], look: 'actor:dex' }, aperture: 1.8 },
      // the plane passes low over the dock
      {
        dur: 4.5,
        mm: 28,
        from: { pos: [1.5, 1.4, -1.5], look: () => planeLook(ctx) },
        handheld: 0.8,
      },
      // Nico
      { dur: 3.5, mm: 85, cut: 'dissolve', from: { pos: [1.4, 1.7, -1.4], look: 'player' } },
    ],
    lines: [
      {
        at: 5.3,
        who: 'Lou',
        text: 'Plane’s up. Six bales, one pass, low over the flats.',
        ms: 3300,
      },
      {
        at: 8.8,
        who: 'Lou',
        text: 'Coast Guard cutter is down at Marathon all afternoon.',
        ms: 2800,
      },
      { at: 10.2, who: 'Dex', text: 'We follow it, fish them out, home before dark.', ms: 2800 },
      { at: 14.2, who: 'Lou', text: 'There’s your bird.', ms: 1800 },
      { at: 18.6, who: 'Nico', text: 'Keep the coffee hot.', ms: 1800 },
    ],
    onEnd: (cs) => standAt(ctx.game, { ...m.pierEnd, y: m.deckY + 0.05 }),
  };
}

// where the camera looks for the fly-by: the plane if it is in the air, else the sky over the water
function planeLook(ctx) {
  const p = shared.plane?.A?.mesh?.position;
  if (p) return [p.x, p.y, p.z];
  const m = ctx.data.marina.spots.boat;
  return [m.x, 30, m.z];
}

export default defineMission({
  id: 'intro2.switchNico',
  title: 'Nico',
  giver: 'Lou',
  intro: true,
  requires: ['intro2.counselor2'],
  start: { teleport: true, at: PLACES.marina },
  end: { at: PLACES.marina },
  async setup(ctx) {
    await asNico(ctx.game);
    setHour(ctx.game, HOURS.marina);
    dropOldBoats(ctx.game);
    ctx.data.marina = await useMarina(ctx, true);
    await loadCast([CAST.lou, CAST.dex]);
  },
  steps: [
    {
      id: 'dock',
      async enter(ctx) {
        // the boat waits at the end of the pier (it stays: Nico drives it in the next mission)
        const b = ctx.spawnBoat('boat', 'console', ctx.data.marina.spots.boat, {
          color: 0xf4f4f0,
          keepOnPass: true,
        });
        if (b) b.intro2 = true;
        const plane = await launchPlane(ctx.game);
        if (plane) {
          plane.follow = () => ctx.pos('boat');
          // it flies on into the next mission; a fail or quit drops it
          ctx.track(
            plane,
            () => {
              plane.dispose();
              if (shared.plane === plane) shared.plane = null;
            },
            { keepOnPass: true },
          );
        }
      },
      cutscene: meeting,
    },
    {
      id: 'board',
      text: 'Get in the boat.',
      trigger: { enterVehicle: 'boat' },
      waypoint: 'boat',
      auto: (ctx) => boardBoat(ctx.game, ctx.h.boat),
    },
  ],
});
