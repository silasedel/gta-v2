// Intro v2, step 1 (storyboard panel 1, FIRST ENCOUNTER): the opening cinematic. Night, rain on a palm-lined street,
// police lights working the next block. Mari is boosting a car; Nico walks up: it is the car he was hired to take.
// Then the cut to two years later: the women's prison, Mari awake in her cell (intro2.prisonCell plays from there).
import * as THREE from 'three';
import { defineMission } from '../runner.js';
import { getCinema } from '../../ui/menu/cinema.js';
import { PRISON, prisonSpot, talkPose } from '../sets/prison.js';
import {
  CAST2,
  enterPrison,
  loadPeople,
  playAsMari,
  prisonActor,
  placeCard,
} from './lib/intro2Prison.js';

// The street: the car at the curb, `heading` along the street (frame forward), the sidewalk on the frame's right.
// Little Havana, a palm-lined side street (County Road 846), picked in game at night.
const STREET = { x: -762.7, z: -232.9, heading: -3.107 };
const HOUR = 23.6;

// staging in the street frame: [right, up, forward, heading offset]
// they face each other across the frame (both read in profile from the wide shots), Mari by the driver's door
const MARI_AT = [-1.25, 0, 0.6, 1.79];
const NICO_AT = [-2.6, 0, 0.3, -1.35];
const POLICE_AT = [-3.2, 0, 44, Math.PI / 2];

// frame-local [right, forward] -> world { x, z, heading }
function local(r, f, dh = 0) {
  const s = Math.sin(STREET.heading);
  const c = Math.cos(STREET.heading);
  return { x: STREET.x - r * c + f * s, z: STREET.z + r * s + f * c, heading: STREET.heading + dh };
}

// police strobes that light the wet street and faces (the car's own light bar only glows)
function policeLights(ctx) {
  const red = new THREE.PointLight(0xff2a2a, 0, 26, 2);
  const blue = new THREE.PointLight(0x2a5bff, 0, 26, 2);
  const near = new THREE.PointLight(0x4a6bff, 0, 9, 2);
  const p = local(-2.6, 40);
  const q = local(-0.4, 7);
  const gy = ctx.game.city?.groundHeightAt?.(p.x, p.z) ?? 0;
  red.position.set(p.x - 0.4, gy + 2.2, p.z);
  blue.position.set(p.x + 0.4, gy + 2.2, p.z);
  near.position.set(q.x, gy + 2.6, q.z);
  for (const l of [red, blue, near]) ctx.game.scene.add(l);
  let t = 0;
  const tick = (dt) => {
    t += dt;
    const ph = (t * 2.6) % 1;
    const on = (x) => (x < 0.1 || (x > 0.18 && x < 0.28) ? 1 : 0);
    red.intensity = 260 * on(ph);
    blue.intensity = 300 * on((ph + 0.5) % 1);
    near.intensity = 3.2 * (0.35 + on((ph + 0.5) % 1)) + 1.6 * on(ph);
    near.color.setHex(on(ph) ? 0xff4040 : 0x4a6bff);
  };
  ctx.game.updaters.push(tick);
  ctx.track(tick, () => {
    const i = ctx.game.updaters.indexOf(tick);
    if (i >= 0) ctx.game.updaters.splice(i, 1);
    for (const l of [red, blue, near]) {
      ctx.game.scene.remove(l);
      l.dispose?.();
    }
  });
}

// night, light rain, the clock held for the scene
function nightAndRain(ctx) {
  const g = ctx.game;
  const saved = { external: g.timeExternal };
  g.timeExternal = true;
  g.timeOfDay = HOUR;
  g.weather?.set?.('rain', { instant: true });
  g.weather?.hold?.(true);
  ctx.track(saved, () => {
    g.timeExternal = saved.external || false;
    g.weather?.hold?.(false);
  });
}

// the street, 7 shots (STREET_T seconds)
function streetShots() {
  const mari = [-1.25, 1.58, 0.6];
  const nico = [-2.6, 1.66, 0.3];
  return [
    // wide and low on the wet asphalt: the two by the car in profile, palms, the police lights a block up
    {
      dur: 6.5,
      mm: 24,
      from: { pos: [-5.4, 0.5, -10.5], look: [-1.9, 1.2, 2.5] },
      to: { pos: [-4.8, 0.62, -8.2] },
      focus: [-1.9, 1.2, 0.45],
      aperture: 0.9,
    },
    // over Nico's shoulder onto Mari, the car and the palms behind her
    {
      dur: 6.2,
      mm: 50,
      from: { pos: [-3.35, 1.7, 0.7], look: mari },
      focus: mari,
      aperture: 2.4,
      handheld: 0.6,
    },
    // reverse: over Mari's shoulder onto Nico
    {
      dur: 5.4,
      mm: 50,
      from: { pos: [-0.45, 1.66, 1.5], look: nico },
      focus: nico,
      aperture: 2.4,
      handheld: 0.6,
    },
    // Mari, close: she looks up the street at the lights
    {
      dur: 4.6,
      mm: 85,
      from: { pos: [-2.15, 1.56, 1.55], look: mari },
      focus: mari,
      aperture: 3,
      handheld: 0.4,
    },
    // two-shot across the car roof from the sidewalk
    {
      dur: 6.0,
      mm: 35,
      from: { pos: [2.6, 1.55, -0.6], look: [-1.9, 1.45, 0.45] },
      to: { pos: [2.5, 1.5, 0.3] },
      focus: [-1.9, 1.5, 0.45],
      aperture: 1.6,
    },
    // Nico, close
    {
      dur: 4.2,
      mm: 85,
      from: { pos: [-1.65, 1.62, 1.2], look: nico },
      focus: nico,
      aperture: 3,
      handheld: 0.4,
    },
    // crane up and away: the car, the two of them, the police lights up the street
    {
      dur: 6.5,
      mm: 28,
      from: { pos: [-7.0, 2.2, -12], look: [-1.6, 1.0, 1.5] },
      to: { pos: [-8.0, 7.5, -17] },
      focus: [-1.9, 1.0, 0.45],
      aperture: 0.8,
      ease: 'inOut',
    },
  ];
}
const STREET_T = 6.5 + 6.2 + 5.4 + 4.6 + 6.0 + 4.2 + 6.5;

// two years later: the cell block corridor, along the doors to hers, Mari under the barred window
const UNDER_WINDOW = { x: 1.5, z: 4.85, heading: 0 };
function prisonShots() {
  const S = PRISON.site;
  const W = (x, y, z) => ({ x: S.x + x, y: S.y + y, z: S.z + z });
  return [
    // (behind the black) the corridor, empty, the strips humming
    {
      dur: 2.8,
      mm: 28,
      from: { pos: W(-2.6, 1.75, -0.7), look: W(29, 1.35, 0.4) },
      to: { pos: W(-2.3, 1.74, -0.66) },
    },
    {
      dur: 5.0,
      mm: 28,
      from: { pos: W(-2.3, 1.74, -0.66), look: W(29, 1.35, 0.4) },
      to: { pos: W(-1.0, 1.7, -0.5) },
      focus: W(8, 1.4, 0),
      aperture: 0.7,
    },
    // along the doors to hers
    {
      dur: 4.5,
      mm: 40,
      from: { pos: W(6.2, 1.6, 0.2), look: W(2.4, 1.6, 1.6) },
      to: { pos: W(4.4, 1.6, 0.6) },
      focus: W(2.4, 1.6, 1.55),
      aperture: 1.4,
    },
    // inside: Mari under the barred window, Dolores sitting up on the lower bunk
    {
      dur: 6.0,
      mm: 30,
      from: { pos: W(2.6, 0.95, 2.15), look: W(1.45, 1.9, 5.3) },
      to: { pos: W(2.45, 1.05, 2.45) },
      focus: W(1.5, 1.55, 4.85),
      aperture: 1.6,
    },
  ];
}

function meetCutscene(ctx) {
  return {
    id: 'opening.meet',
    frame: STREET,
    player: { at: MARI_AT },
    setup() {
      talkPose(ctx.game, true);
      // Nico stands across from her (the character you are not playing, staged by game.characters)
      const at = local(NICO_AT[0], NICO_AT[1], NICO_AT[3]);
      const root = ctx.game.characters?.stage?.('nico', at);
      if (root) ctx.h.nico = { root };
    },
    // then black, and two years later: the prison (world positions from here on)
    shots: [...streetShots(), ...prisonShots()],
    events: [
      { at: STREET_T - 0.9, run: () => getCinema(ctx.game).black(true, 800) },
      {
        at: STREET_T,
        always: true,
        run: () => {
          const at = prisonSpot(UNDER_WINDOW);
          ctx.game.teleport(at.x, at.y, at.z, at.heading);
        },
      },
      {
        at: STREET_T + 0.4,
        run: () => placeCard('Two years later', 'Women’s Correctional Facility', 5200),
      },
      { at: STREET_T + 2.6, run: () => getCinema(ctx.game).black(false, 1400) },
    ],
    end: { player: { at: prisonSpot(PRISON.cell.mariStart) } },
    lines: [
      { at: 3.2, who: 'Nico', text: 'That’s not your car.', ms: 1800 },
      { at: 5.4, who: 'Mari', text: 'It’s not yours either.', ms: 1800 },
      {
        at: 7.4,
        who: 'Nico',
        text: 'I’ve been sitting on it two hours. The guy who wants it pays me.',
        ms: 3000,
      },
      { at: 11.0, who: 'Mari', text: 'Then you picked a bad night.', ms: 1900 },
      { at: 13.2, who: 'Mari', text: 'Cops are running plates up on Seventh.', ms: 2300 },
      { at: 17.4, who: 'Nico', text: 'So we’ve got a minute. Maybe.', ms: 2100 },
      { at: 19.8, who: 'Mari', text: 'Then get in, or get out of my way.', ms: 2400 },
      { at: 23.4, who: 'Nico', text: 'You drive like you talk?', ms: 1800 },
      { at: 25.4, who: 'Mari', text: 'Worse.', ms: 1300 },
      { at: 27.6, who: 'Nico', text: 'Nico.', ms: 1100 },
      { at: 29.0, who: 'Mari', text: 'Didn’t ask.', ms: 1300 },
      { at: 31.6, who: 'Mari', text: '...Mari. Get in.', ms: 2000 },
    ],
  };
}

export default defineMission({
  id: 'intro2.opening',
  title: 'Southline',
  giver: 'Nico & Mari',
  intro: true,
  start: { teleport: true, at: () => local(MARI_AT[0], MARI_AT[2], MARI_AT[3]) },
  async setup(ctx) {
    await loadPeople([CAST2.cellmate]);
    await playAsMari(ctx);
    const at = local(MARI_AT[0], MARI_AT[2], MARI_AT[3]);
    ctx.game.teleport(at.x, null, at.z, at.heading);
    nightAndRain(ctx);
    await ctx.spawnVehicle('car', 'sports', local(0, 0, 0), { color: 0x6e0f16, keepOnPass: false });
    const cop = await ctx.spawnVehicle(
      'police',
      'police',
      local(POLICE_AT[0], POLICE_AT[2], POLICE_AT[3]),
      { keepOnPass: false },
    );
    cop?.siren?.(true);
    policeLights(ctx);
    // the prison for the cut at the end (300 m over the Gulf, nothing to see from here)
    const set = await enterPrison(ctx, null);
    set.cellDoor?.set(0);
    set.officeDoor?.set(0);
    prisonActor(ctx, 'cellmate', CAST2.cellmate, PRISON.cell.cellmate, 'sit');
  },
  steps: [{ id: 'meet', cutscene: meetCutscene }],
});
