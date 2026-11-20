// Shared data for Nico's half of the intro (docs/v2/plan/INTRO_V2_PLAN.md steps 4-7, storyboard panels 8-12): places,
// cast and small helpers for intro2.switchNico, smuggling, packages, swamp, seaplane and home.
// Not a mission file (the loader only reads src/story/missions/*.js).
import { loadPerson } from '../../../npc/people/lib.js';

// World meters (CONVENTIONS section 1: +X east, +Z south, heading 0 faces +Z). Water spots were checked in game with
// game.city.isWater (tools/v2/story/intro2_probe.mjs).
export const PLACES = {
  // the employer's dock on the Florida Bay beach of Key Largo (a pier is built out from here along the heading,
  // lib/marina.js): the crew meets here, the floatplane comes back here
  marina: { x: -1430, z: 5718, heading: -2.47 },
  // the drop plane comes in over the island from the ocean side and flies the drop line north-west over the
  // turquoise flats of the bay
  planeIn: { x: -1150, z: 6080 },
  dropLine: [
    { x: -1470, z: 5640 },
    { x: -1540, z: 5520 },
    { x: -1600, z: 5410 },
    { x: -1660, z: 5290 },
    { x: -1720, z: 5180 },
    { x: -1780, z: 5070 },
    { x: -1830, z: 4980 },
  ],
  // the mouth of the mangrove channels on the north shore of the bay (the boat run to the Glades starts here)
  gladesMouth: { x: -2050, z: 4100, heading: Math.PI },
  // the gang's island camp: a cypress hammock in the open water of the Everglades sloughs, far from any road.
  // The camp is built around `camp`; the boat lands on its east shore, the far dock is on the south shore, and the
  // floatplane takes off east down the open channel south of the island.
  camp: { x: -2068, z: -708, heading: 0 },
  campLanding: { x: -1987, z: -708, heading: -Math.PI / 2 },
  campApproach: { x: -1890, z: -700, heading: -Math.PI / 2 },
  farDock: { x: -2068, z: -656, heading: 0 },
  farDockWater: { x: -2061, z: -644, heading: Math.PI / 2 },
};

// the cast (index rows in public/assets/npc/people/index.json)
export const CAST = {
  vale: 'p44', // the employer, at the marina
  dex: 'p159', // Nico's partner on the boat
  lou: 'p162', // the fixer on the radio
  cisco: 'p155', // the associate the gang takes
  guards: ['p175', 'p176'], // Vale's bodyguards: black polo, charcoal suit
  poachers: ['p177', 'p178', 'p188'], // swamp poachers who ride with the Sawgrass Boys
  sawgrass: ['p151', 'p152', 'p153', 'p154', 'p156', 'p157'],
  seaplanePilot: 'p174', // Vale's floatplane pilot
  dropPilot: 'p187', // the bush pilot who flies the drop plane
};

// The hour each part of Nico's day is set at (storyboard: bright turquoise water, a moody swamp late in the day, the
// floatplane in golden light, home at night).
export const HOURS = {
  marina: 15.2,
  swamp: 17.4,
  seaplane: 18.1,
  home: 21.4,
};

// Load the people a mission stages (under the black of its start), so spawnPosed gets the real person and not a
// stand-in from the street crowd. Gives up after `ms` (a slow load then falls back to the stand-in).
export function loadCast(ids, ms = 8000) {
  const all = Promise.all(ids.map((id) => loadPerson(id).catch(() => null)));
  const late = new Promise((resolve) => setTimeout(resolve, ms));
  return Promise.race([all, late]);
}

// Nico's house anchors in world space (src/world/setpieces/nicoHouse), with the set piece spot as a fallback
export function house(game, name = 'spawnYard') {
  const a = game.nicoHouse?.anchors?.[name];
  if (a?.pos) return { x: a.pos.x, y: a.pos.y, z: a.pos.z, heading: a.heading || 0 };
  return { x: -1008, z: 5174, heading: 0.42 };
}

// point `t` (0..1) along the line a -> b
export function along(a, b, t) {
  return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
}

// Nico's missions are played as Nico: switch over under the black of the mission start (a resumed save, a replay
// from the menu) and keep the character wheel shut until the intro is done.
export async function asNico(game) {
  const C = game.characters;
  if (!C) return;
  if (C.active?.id !== 'nico') {
    const was = C.locked;
    C.locked = false;
    try {
      await C.switchTo('nico', { instant: true });
    } catch (e) {
      console.warn('[intro2] switch to Nico', e);
    }
    C.locked = was;
  }
  C.locked = true;
}

// the clock for a scene (weather held clear so the storyboard light is there)
export function setHour(game, hour) {
  try {
    game.timeOfDay = hour;
  } catch (e) {
    /* */
  }
  try {
    game.weather?.set?.('clear', { instant: true });
  } catch (e) {
    /* */
  }
}

// a pistol for the swamp (given on a skip too)
export function givePistol(game) {
  try {
    game.weapons?.give?.('pistol', 72);
  } catch (e) {
    console.warn('[intro2] pistol', e);
  }
}

// the vehicle the player sits in, if any
export function playerVehicle(game) {
  const st = game.player?.state;
  return st?.inVehicle ? st.vehicle : null;
}

// Put the player at the helm of a boat (a mission start that continues on the water): teleport beside it, then board.
export function boardBoat(game, boat) {
  if (!boat) return;
  try {
    const t = boat.body?.translation?.() || boat.mesh?.position;
    if (t) game.teleport(t.x + 1.5, null, t.z, boat.heading || 0);
    game.enterVehicle?.(boat);
  } catch (e) {
    console.warn('[intro2] board', e);
  }
}

// Move a boat (and whoever sits in it) to a spot on the water: used by the dev auto-play hooks (step.auto)
export function placeBoat(boat, at, heading) {
  if (!boat?.body) return;
  try {
    boat.body.setTranslation({ x: at.x, y: 0.2, z: at.z }, true);
    boat.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    boat.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    if (heading !== undefined) {
      const h = heading / 2;
      boat.body.setRotation({ x: 0, y: Math.sin(h), z: 0, w: Math.cos(h) }, true);
    }
  } catch (e) {
    console.warn('[intro2] place boat', e);
  }
}

// An aircraft from game.air as a mission handle. game.air.spawn loads the model first (it returns a promise), so this
// waits for it; the plane is removed on fail / retry (and on pass unless keepOnPass).
export async function spawnPlane(ctx, name, type, at, opts = {}) {
  const game = ctx.game;
  const sea = game.city?.seaLevel ?? -0.12;
  let A = null;
  try {
    A = await game.air?.spawn?.(type, { x: at.x, y: at.y ?? sea, z: at.z }, at.heading || 0, opts);
  } catch (e) {
    console.warn('[intro2] plane', e);
  }
  if (!A) return null;
  ctx.h[name] = A;
  ctx.track(
    A,
    () => {
      if (playerVehicle(game) === A) game.exitVehicle?.();
      game.air?.remove?.(A);
    },
    { keepOnPass: !!opts.keepOnPass },
  );
  return A;
}

// The boat Nico runs the job in: the one he sits in (carried over from the mission before), else a new white center
// console at `at` with him at the helm. Becomes handle `name`.
export function takeBoat(ctx, name, at) {
  const game = ctx.game;
  const v = playerVehicle(game);
  if (v && game.boatSystem?.list?.includes(v)) {
    ctx.h[name] = v;
    v.intro2 = true;
    ctx.track(
      v,
      () => {
        if (playerVehicle(game) === v) game.exitVehicle?.();
        game.boatSystem?.remove?.(v);
      },
      { keepOnPass: true },
    );
    return v;
  }
  const b = ctx.spawnBoat(name, 'console', at, { color: 0xf4f4f0, keepOnPass: true });
  if (b) b.intro2 = true;
  boardBoat(game, b);
  return b;
}

// The run's boat stays in the world from one mission to the next; once the story leaves it behind (the swamp, the
// flight home) it goes, so no stray boats pile up in memory.
export function dropOldBoats(game, keep = null) {
  const list = game.boatSystem?.list || [];
  for (const b of list.slice()) {
    if (!b.intro2 || b === keep) continue;
    if (playerVehicle(game) === b) game.exitVehicle?.();
    game.boatSystem?.remove?.(b);
  }
}

// A mission set (marina, camp) that exists only while the mission runs
export function trackSet(ctx, set) {
  if (set) ctx.track(set, () => set.dispose());
  return set;
}

// Things one mission hands to the next in the same session (the marina dock, the drop plane already in the air). A
// mission that finds one here takes it over (and its cleanup); one that does not builds its own.
export const shared = { marina: null, plane: null, camp: null, seaplane: null };

// the marina dock: the one still standing from the mission before, else a new one; `keep` leaves it in the world
// after a pass for the next mission
export async function useMarina(ctx, keep = false) {
  const { buildMarina } = await import('./marina.js');
  let m = shared.marina;
  if (!m) {
    m = await buildMarina(ctx.game, PLACES.marina);
    shared.marina = m;
  }
  ctx.track(
    m,
    () => {
      m.dispose();
      if (shared.marina === m) shared.marina = null;
    },
    { keepOnPass: keep },
  );
  return m;
}

// ---------------------------------------------------------------- the floating bales (panels 8-9)
// A wrapped bale floating at `at` (handle 'bale<i>'): the waterproof brick bundle scaled up to a bale, with an orange
// marker float tied to it so it can be spotted on the water.
export async function spawnBale(ctx, i, at) {
  const sea = ctx.game.city?.seaLevel ?? -0.12;
  const obj = await ctx.spawnProp(
    'bale' + i,
    'package_waterproof',
    { x: at.x, y: sea - 0.18, z: at.z },
    {
      scale: 2.2,
    },
  );
  if (obj) {
    obj.rotation.y = i * 1.7;
    obj.userData.bob = { t: i * 1.3, y: sea - 0.18 };
  }
  return obj;
}

// every frame: the bales ride the swell
export function bobBales(ctx, dt) {
  for (let i = 0; i < 8; i++) {
    const o = ctx.h['bale' + i];
    const b = o?.userData?.bob;
    if (!b) continue;
    b.t += dt;
    o.position.y = b.y + Math.sin(b.t * 1.4) * 0.07;
    o.rotation.z = Math.sin(b.t * 1.1) * 0.06;
    o.rotation.x = Math.sin(b.t * 0.9 + 1) * 0.05;
  }
}

// Stand the player on a deck / floor at an exact height (the cutscene player.at puts him on the terrain, which is the
// sea floor under a pier and the ground under a stilt shack). `at` is world { x, y, z, heading }.
export function standAt(game, at) {
  try {
    game.teleport(at.x, at.y ?? null, at.z, at.heading ?? 0);
  } catch (e) {
    console.warn('[intro2] stand', e);
  }
}
