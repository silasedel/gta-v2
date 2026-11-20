// Intro v2, storyboard panel 8 (SMUGGLING RUN): Nico drives the white center-console motorboat across the turquoise
// flats of Florida Bay while the low single-engine drop plane flies ahead of him. Follow it; it drops six wrapped bales
// into the sea on its way (they float: intro2.packages collects them) and climbs away to the west.
import { defineMission } from '../runner.js';
import {
  PLACES,
  HOURS,
  asNico,
  setHour,
  useMarina,
  shared,
  takeBoat,
  placeBoat,
  spawnBale,
  bobBales,
} from './lib/intro.js';
import { createDropPlane } from './lib/dropPlane.js';
import { dropPath } from './intro2.switchNico.js';

const LOST_AT = 900; // m from the plane: the run is blown

// the plane still in the air from the briefing, else a new one coming in over the island
async function takePlane(ctx) {
  let plane = shared.plane;
  if (!plane || plane.A.disposed) {
    plane = await createDropPlane(ctx.game, {
      path: dropPath(),
      start: PLACES.planeIn,
      drops: [1, 2, 3, 4, 5, 6],
      alt: 34,
    });
    shared.plane = plane;
  }
  if (!plane) return null;
  plane.hold = false;
  plane.follow = () => ctx.pos('boat');
  ctx.h.plane = plane.A;
  ctx.data.plane = plane;
  // the bales hit the water: remember where (the next mission puts them there)
  ctx.data.bales = [];
  plane.onDrop = (i, at) => {
    ctx.data.bales[i] = { x: Math.round(at.x * 10) / 10, z: Math.round(at.z * 10) / 10 };
    ctx.story.state.set('intro2.bales', ctx.data.bales.filter(Boolean));
    spawnBale(ctx, i, at);
    if (i === 0) ctx.say('Lou', 'First one’s in the water. Keep on him.', 2600);
  };
  ctx.track(plane, () => {
    plane.dispose();
    if (shared.plane === plane) shared.plane = null;
  });
  return plane;
}

export default defineMission({
  id: 'intro2.smuggling',
  title: 'Smuggling Run',
  giver: 'Lou',
  intro: true,
  requires: ['intro2.switchNico'],
  start: { teleport: false, at: PLACES.marina },
  end: { at: PLACES.dropLine[6] },
  async setup(ctx) {
    await asNico(ctx.game);
    setHour(ctx.game, HOURS.marina + 0.2);
    // the dock goes when this run is over (it is rebuilt for the flight home)
    const marina = await useMarina(ctx, false);
    takeBoat(ctx, 'boat', marina.spots.boat);
    await takePlane(ctx);
  },
  steps: [
    {
      id: 'follow',
      text: 'Follow the plane.',
      waypoint: 'plane',
      gps: false,
      onTick: (ctx, dt) => bobBales(ctx, dt),
      until: (ctx) => ctx.data.plane?.done && ctx.data.bales.filter(Boolean).length >= 6,
      fail: {
        vehicleDestroyed: 'boat',
        escaped: { target: 'plane', dist: LOST_AT, text: 'You lost the plane.' },
      },
      // dev auto-play: put the boat right under the plane until the drops are done
      auto(ctx) {
        const p = ctx.data.plane?.position;
        if (p) placeBoat(ctx.h.boat, { x: p.x, z: p.z }, ctx.data.plane.st.h);
      },
    },
    {
      id: 'away',
      enter(ctx) {
        ctx.say('Lou', 'That’s six. Bird’s heading home. Go fishing, Nico.', 3200);
      },
      onTick: (ctx, dt) => bobBales(ctx, dt),
      trigger: { wait: 3.4 },
    },
  ],
});
