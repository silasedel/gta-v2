// Intro v2, storyboard panels 10-11 (SWAMP INFILTRATION, RESCUE): the boat run up the channels ends at the Sawgrass
// Boys' camp on a cypress hammock in the Everglades sloughs. Nico lands on the east shore, sneaks (or fights) his way
// into the camp past the armed gang, finds Cisco tied up in the stilted shack, cuts him loose and gets out through
// the rest of the gang to the far dock, where the gang's floatplane is tied up. On the way: the stolen cash in the
// trailer (optional).
import { defineMission } from '../runner.js';
import {
  PLACES,
  CAST,
  HOURS,
  loadCast,
  asNico,
  setHour,
  givePistol,
  dropOldBoats,
  shared,
  spawnPlane,
  playerVehicle,
  standAt,
} from './lib/intro.js';
import { buildSwampCamp } from './lib/swampCamp.js';
import { createCampCrew } from './lib/campCrew.js';

const CASH = 2500; // the stolen money in the trailer (optional)
const AREA = { at: PLACES.camp, r: 420 };

// the camp set: the one still standing (a retry in the same session keeps nothing: it is rebuilt), else a new one
async function camp(ctx) {
  const c = await buildSwampCamp(ctx.game, { ...PLACES.camp, landing: [1, 0] });
  ctx.data.camp = c;
  shared.camp = c;
  // it stays after a pass until the floatplane is off the water (intro2.seaplane drops it)
  ctx.track(
    c,
    () => {
      c.dispose();
      if (shared.camp === c) shared.camp = null;
    },
    { keepOnPass: true },
  );
  ctx.data.tick = (dt) => c.update(dt);
  ctx.game.updaters.push(ctx.data.tick);
  ctx.track(
    ctx.data.tick,
    () => {
      const i = ctx.game.updaters.indexOf(ctx.data.tick);
      if (i >= 0) ctx.game.updaters.splice(i, 1);
    },
    { keepOnPass: true },
  );
  return c;
}

// the gang at their posts (local offsets from the camp spots)
function posts(c) {
  const s = c.spots;
  const C = s.center;
  return [
    // on the porch by the warm lamp, watching the yard
    { x: s.porch.x + 2.2, y: s.floorY, z: s.porch.z + 0.2, face: Math.PI * 0.95, poacher: true },
    // two by the fire, talking
    { x: s.fire.x - 1.9, z: s.fire.z + 0.4, face: Math.PI / 2, talk: 'fire' },
    { x: s.fire.x + 1.3, z: s.fire.z - 1.5, face: -Math.PI / 2, talk: 'fire', poacher: true },
    // at the red shack's door
    { x: C.x + 8.2, z: C.z - 7.4, face: Math.PI * 0.8 },
    // by the trailer, looking down the trail to the east shore
    { x: C.x + 6.5, z: C.z + 3.6, face: Math.PI / 2 - 0.2, poacher: true, gun: 'revolver' },
    // at the far dock, looking out over the water
    { x: s.dock.x + 0.6, z: s.dock.z - 2.2, face: 0.2 },
  ];
}

function arrival(ctx) {
  const s = ctx.data.camp.spots;
  const L = s.landing;
  return {
    id: 'intro2.swamp.arrival',
    // the boat glides in from the open slough to the landing
    setup(cs) {
      const b = ctx.h.boat;
      const from = PLACES.campApproach;
      const t0 = performance.now();
      cs.boatTick = () => {
        const k = Math.min(1, (performance.now() - t0) / 7000);
        const e = 1 - (1 - k) * (1 - k);
        const x = from.x + (L.x - from.x) * e;
        const z = from.z + (L.z - from.z) * e;
        try {
          b?.body?.setTranslation({ x, y: 0.15, z }, true);
          b?.body?.setLinvel({ x: 0, y: 0, z: 0 }, true);
        } catch (err) {
          /* */
        }
      };
      ctx.game.updaters.push(cs.boatTick);
    },
    onEnd(cs) {
      const i = ctx.game.updaters.indexOf(cs.boatTick);
      if (i >= 0) ctx.game.updaters.splice(i, 1);
    },
    player: { at: { x: L.x + 30, z: L.z, heading: L.heading }, visible: false },
    shots: [
      // wide: the dark slough at dusk, the boat coming in, the cypress hammock behind
      {
        dur: 6,
        mm: 28,
        from: { pos: [L.x + 60, 4, L.z + 26], look: 'vehicle:boat' },
        to: { pos: [L.x + 38, 3, L.z + 18], look: 'vehicle:boat' },
        ease: 'inOut',
      },
      // through the tall grass at the stilted shack: warm porch lamp, armed men, god rays
      {
        dur: 6.5,
        mm: 40,
        from: { pos: [s.center.x + 16, 1.3, s.center.z - 22], look: [s.porch.x, 2.6, s.porch.z] },
        to: { pos: [s.center.x + 13, 1.2, s.center.z - 20], look: [s.porch.x, 2.5, s.porch.z] },
        aperture: 2.2,
      },
      // Nico on the landing checks the pistol
      { dur: 4.5, mm: 70, from: { pos: [L.x - 5, 1.7, L.z + 2.2], look: 'player' }, aperture: 1.8 },
    ],
    phone: { who: 'Lou', from: 0.4, to: 11.5 },
    lines: [
      {
        at: 0.8,
        who: 'Lou',
        text: 'That’s their hammock. Five, six of them. All carrying.',
        ms: 3200,
      },
      { at: 4.4, who: 'Nico', text: 'Cisco?', ms: 1200 },
      {
        at: 6.2,
        who: 'Lou',
        text: 'The stilt shack, if he’s still breathing. Quiet is better. Your call.',
        ms: 3400,
      },
      { at: 12.6, who: 'Nico', text: 'Quiet, then. Until it isn’t.', ms: 2400 },
    ],
    events: [{ at: 12.4, always: true, run: () => givePistol(ctx.game) }],
    end: { player: { at: s.landingFoot } },
  };
}

function rescue(ctx) {
  const s = ctx.data.camp.spots;
  return {
    id: 'intro2.swamp.rescue',
    frame: { x: s.inside.x, z: s.inside.z, y: s.floorY, heading: 0 },
    setup: () =>
      standAt(ctx.game, { x: s.inside.x, y: s.floorY + 0.05, z: s.inside.z + 0.6, heading: 0 }),
    shots: [
      { dur: 3.6, mm: 35, from: { pos: [1.2, 1.5, -0.6], look: 'actor:cisco' }, aperture: 1.6 },
      { dur: 3.6, mm: 55, from: { pos: [-0.6, 1.3, 2.9], look: 'player' }, aperture: 1.8 },
      { dur: 4.2, mm: 45, from: { pos: [1.0, 1.6, 0.4], look: 'actor:cisco' }, aperture: 1.6 },
    ],
    lines: [
      { at: 0.3, who: 'Cisco', text: 'About time. Lou send you?', ms: 2200 },
      { at: 2.8, who: 'Nico', text: 'Hold still.', ms: 1200 },
      {
        at: 4.4,
        who: 'Cisco',
        text: 'They took the drop money. It’s in the trailer. And their plane’s at the south dock.',
        ms: 3600,
      },
      { at: 8.4, who: 'Nico', text: 'Can you run?', ms: 1200 },
      { at: 9.8, who: 'Cisco', text: 'Watch me.', ms: 1400 },
    ],
    events: [{ at: 0.2, run: () => ctx.h.cisco?.setPose?.('sit') }],
  };
}

export default defineMission({
  id: 'intro2.swamp',
  title: 'Sawgrass',
  giver: 'Lou',
  intro: true,
  requires: ['intro2.packages'],
  start: { teleport: false, at: PLACES.campLanding },
  end: { at: PLACES.farDock },
  fail: { leftArea: AREA },
  async setup(ctx, fromStep) {
    const game = ctx.game;
    await asNico(game);
    setHour(game, HOURS.swamp);
    if (playerVehicle(game)) game.exitVehicle?.();
    dropOldBoats(game);
    // the boat run from the bay ends here: on the landing (a retry starts at its checkpoint)
    if (!fromStep)
      game.teleport(PLACES.campLanding.x - 14, null, PLACES.campLanding.z, -Math.PI / 2);
    await loadCast([...CAST.poachers, CAST.cisco]);
    const c = await camp(ctx);
    const b = ctx.spawnBoat('boat', 'console', c.spots.landing, { color: 0xf4f4f0 });
    if (b) b.intro2 = true;
    // Cisco on the chair inside (until he is freed), the floatplane at the far dock
    if (!fromStep || fromStep <= 2) {
      ctx.spawnActor('cisco', { person: CAST.cisco, at: c.spots.cisco, pose: 'sit' });
    }
    await spawnPlane(ctx, 'plane', 'floatplane', PLACES.farDockWater, { keepOnPass: true });
    shared.seaplane = ctx.h.plane;
    if (fromStep >= 1) givePistol(game);
  },
  apply(story, how) {
    if (how === 'skip') givePistol(story.game);
  },
  steps: [
    { id: 'arrival', cutscene: arrival },
    {
      id: 'approach',
      text: 'Sneak into the camp.',
      checkpoint: { at: { x: -2001, z: -708, heading: -Math.PI / 2 } },
      enter(ctx) {
        const c = ctx.data.camp;
        ctx.data.crew = createCampCrew(ctx, {
          name: 'crew',
          posts: posts(c),
          groups: {
            fire: { members: [], center: c.spots.fire, props: [], talk: true, spk: 0, spkT: 3 },
          },
          cover: (x, z) => c.cover(x, z),
          onAlert: () => {
            ctx.objective('Fight your way to the stilt shack.');
            ctx.say('Lou', 'They made you. Move!', 2000);
          },
        });
        ctx.help('Stay in the grass and move slowly: they see less of you. A shot wakes the camp.');
      },
      onTick: (ctx, dt) => ctx.data.crew?.update(dt),
      trigger: { reach: { at: (ctx) => ctx.data.camp.spots.yardEdge, r: 6, onFoot: true } },
      auto(ctx) {
        const s = ctx.data.camp.spots.yardEdge;
        ctx.game.teleport(s.x, null, s.z, s.heading);
      },
    },
    {
      id: 'shack',
      text: 'Find Cisco in the stilt shack.',
      onTick: (ctx, dt) => ctx.data.crew?.update(dt),
      trigger: {
        interact: { at: (ctx) => ctx.data.camp.spots.cisco, r: 1.9, label: 'untie Cisco' },
      },
      auto(ctx) {
        const s = ctx.data.camp.spots.inside;
        ctx.game.teleport(s.x, s.y, s.z + 0.8, 0);
        dispatchE();
      },
    },
    {
      id: 'rescue',
      cutscene: rescue,
      exit(ctx) {
        // Cisco runs for the plane (he waits on the dock); the camp is up now, more of them come from the landing
        ctx.h.cisco?.remove?.();
        ciscoAtDock(ctx);
        ctx.data.crew?.alert('rescue');
      },
    },
    {
      id: 'escape',
      text: 'Get to the seaplane at the far dock.',
      checkpoint: {
        at: { x: -2074, y: 1.4, z: -712.4, heading: Math.PI },
        restore(ctx) {
          ciscoAtDock(ctx);
          ctx.data.crew = createCampCrew(ctx, {
            name: 'crew',
            posts: posts(ctx.data.camp).slice(2),
            cover: (x, z) => ctx.data.camp.cover(x, z),
          });
          ctx.data.crew.alert('retry');
        },
      },
      enter(ctx) {
        ctx.help('Optional: the stolen cash is in the trailer.');
        ctx.data.cashTaken = !!ctx.state.get('intro2.swampCash');
      },
      onTick(ctx, dt) {
        ctx.data.crew?.update(dt);
        takeCash(ctx);
      },
      trigger: { reach: { at: (ctx) => ctx.data.camp.spots.dockEnd, r: 4, onFoot: true } },
      fail: { protect: 'cisco' },
      auto(ctx) {
        const d = ctx.data.camp.spots.dockEnd;
        ctx.game.teleport(d.x, null, d.z - 1, 0);
      },
    },
  ],
  onPass(ctx) {
    ctx.h.cisco?.remove?.();
  },
});

// Cisco ran ahead: he waits at the end of the far dock by the plane
function ciscoAtDock(ctx) {
  const d = ctx.data.camp.spots.dockEnd;
  ctx.spawnActor('cisco', { person: CAST.cisco, at: { ...d, heading: Math.PI }, pose: 'idle' });
}

// the optional cash: E at the trailer door
function takeCash(ctx) {
  if (ctx.data.cashTaken) return;
  const c = ctx.data.camp.spots.cash;
  const d = ctx.dist(c);
  if (d > 2.2) {
    if (ctx.data.cashHelp) {
      ctx.data.cashHelp = false;
      ctx.help(null);
    }
    return;
  }
  if (!ctx.data.cashHelp) {
    ctx.data.cashHelp = true;
    ctx.help('Press [E] to take the cash');
  }
  if (!ctx.game.input?.pressed?.('KeyE') && !eLatched()) return;
  ctx.data.cashTaken = true;
  ctx.help(null);
  ctx.state.set('intro2.swampCash', true);
  try {
    ctx.game.wallet?.earn?.(CASH, { category: 'mission', memo: 'Sawgrass camp', from: 'Found' });
  } catch (e) {
    /* */
  }
  const obj = ctx.data.camp.cash;
  if (obj) obj.visible = false;
  ctx.notify(`Recovered the drop money: $${CASH.toLocaleString('en-US')}`, 3200);
}

// E taps are short: latch one for a few frames (the runner does the same for its interact triggers)
let eAt = -1e9;
if (typeof addEventListener === 'function') {
  addEventListener('keydown', (e) => {
    if (e.code === 'KeyE' && !e.repeat) eAt = performance.now();
  });
}
function eLatched() {
  if (performance.now() - eAt < 400) {
    eAt = -1e9;
    return true;
  }
  return false;
}

// dev auto-play: an E tap
function dispatchE() {
  setTimeout(() => {
    dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE', key: 'e' }));
    setTimeout(() => dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyE', key: 'e' })), 120);
  }, 300);
}
