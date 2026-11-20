// Intro v2, storyboard panel 9 (COLLECT PACKAGES): the wrapped bales float on the turquoise water where the plane
// dropped them; Nico runs the boat alongside each one and hauls it aboard. Then Lou on the radio: Cisco, the crew's
// man in the Glades, was grabbed by the Sawgrass Boys and is held at their island camp. Nico heads for the Glades.
import { defineMission } from '../runner.js';
import {
  PLACES,
  HOURS,
  asNico,
  setHour,
  takeBoat,
  placeBoat,
  spawnBale,
  bobBales,
  playerVehicle,
} from './lib/intro.js';

const PICK_R = 7; // m from a bale: alongside, he hauls it in

// where the bales are: the spots the drop plane left them at (story state), else spread along the drop line
function baleSpots(ctx) {
  const saved = ctx.story.state.get('intro2.bales');
  if (Array.isArray(saved) && saved.length >= 6) return saved.slice(0, 6);
  const out = [];
  for (let i = 1; i <= 6; i++) {
    const p = PLACES.dropLine[i];
    out.push({ x: p.x + Math.sin(i * 2.1) * 25 - 30, z: p.z + Math.cos(i * 1.3) * 25 - 45 });
  }
  return out;
}

function radioCall(ctx) {
  const p = ctx.game.player.position;
  const h = ctx.game.player.heading || 0;
  const back = [p.x - Math.sin(h) * 10, p.y + 3.6, p.z - Math.cos(h) * 10];
  return {
    id: 'intro2.packages.radio',
    letterbox: false,
    fadeIn: false,
    fadeOut: false,
    shots: [
      { dur: 6, mm: 35, from: { pos: back, look: [p.x, p.y + 1.2, p.z] }, handheld: 0.6 },
      {
        dur: 7.5,
        mm: 60,
        from: {
          pos: [p.x + Math.cos(h) * 3.2, p.y + 1.9, p.z - Math.sin(h) * 3.2],
          look: [p.x, p.y + 1.6, p.z],
        },
        aperture: 1.6,
      },
    ],
    phone: { who: 'Lou', from: 0, to: 13.5 },
    lines: [
      {
        at: 0.4,
        who: 'Lou',
        text: 'Nico. Cisco’s not answering. Our man in the Glades.',
        ms: 2900,
      },
      {
        at: 3.5,
        who: 'Lou',
        text: 'His last call said airboats. The Sawgrass Boys took him off his skiff.',
        ms: 3300,
      },
      {
        at: 7.0,
        who: 'Lou',
        text: 'They’ve got a camp on a hammock out in the sloughs. They want what’s in your boat.',
        ms: 3500,
      },
      { at: 10.8, who: 'Nico', text: 'Then they can come get it. Send me the spot.', ms: 2600 },
    ],
  };
}

export default defineMission({
  id: 'intro2.packages',
  title: 'The Drop',
  giver: 'Lou',
  intro: true,
  requires: ['intro2.smuggling'],
  start: { teleport: false, at: PLACES.dropLine[3] },
  end: { at: PLACES.gladesMouth },
  async setup(ctx) {
    await asNico(ctx.game);
    setHour(ctx.game, HOURS.marina + 0.4);
    const spots = baleSpots(ctx);
    ctx.data.spots = spots;
    // a resumed save or a replay starts at the first bale, in the boat
    if (!playerVehicle(ctx.game)) {
      const a = spots[0];
      const at = { x: a.x + 30, z: a.z + 30, heading: Math.atan2(-30, -30) };
      ctx.game.teleport(at.x, null, at.z, at.heading);
      takeBoat(ctx, 'boat', at);
    } else takeBoat(ctx, 'boat', spots[0]);
    for (let i = 0; i < spots.length; i++) await spawnBale(ctx, i, spots[i]);
  },
  steps: [
    {
      id: 'collect',
      text: 'Collect the bales',
      checkpoint: {
        at: (game) => {
          const s = game.story?.state?.get('intro2.bales')?.[0] || PLACES.dropLine[1];
          return { x: s.x + 30, z: s.z + 30, heading: Math.atan2(-30, -30) };
        },
      },
      onTick: (ctx, dt) => bobBales(ctx, dt),
      trigger: {
        collect: {
          items: (ctx) => ctx.data.spots,
          r: PICK_R,
          onCollect(ctx, p, got) {
            const i = ctx.data.spots.indexOf(p);
            const obj = ctx.h['bale' + i];
            if (obj) {
              obj.parent?.remove(obj);
              ctx.h['bale' + i] = null;
            }
            try {
              ctx.game.audio?.play?.('splash', { volume: 0.6 });
            } catch (e) {
              /* */
            }
            if (got === 3) ctx.say('Lou', 'Halfway. Don’t leave one for the fish.', 2400);
          },
        },
      },
      fail: { vehicleDestroyed: 'boat' },
      // dev auto-play: hop the boat from bale to bale
      auto(ctx) {
        const b = ctx.data.spots.find((p, i) => ctx.h['bale' + i]);
        if (b) placeBoat(ctx.h.boat, b);
      },
    },
    { id: 'radio', cutscene: radioCall },
    {
      id: 'glades',
      text: 'Head for the Glades.',
      gps: false,
      trigger: { reach: { at: PLACES.gladesMouth, r: 60, inVehicle: 'boat' } },
      fail: { vehicleDestroyed: 'boat' },
      auto: (ctx) => placeBoat(ctx.h.boat, PLACES.gladesMouth, Math.PI),
    },
  ],
});
