// Intro v2, step 7 (FREE-ROAM UNLOCK): night at Nico's house on Key Largo after the job. The house is his first home
// base; Vale calls about more work; the intro ends, the character wheel opens (Mari and Nico) and the game is free
// from here.
import { defineMission } from '../runner.js';
import { HOURS, house, asNico, setHour, shared } from './lib/intro.js';
import { INTRO_DONE_FLAG, FREE_ROAM_UNLOCK } from '../intro.js';
import { MARI } from '../../player/mari/index.js';

// cameras around the house: from the yard side, framed on the house center (game.nicoHouse.center)
function homeCutscene(ctx) {
  const game = ctx.game;
  const yard = house(game, 'spawnYard');
  const c = game.nicoHouse?.center || { x: yard.x + 10, y: 0, z: yard.z + 10 };
  let dx = yard.x - c.x;
  let dz = yard.z - c.z;
  const d = Math.sqrt(dx * dx + dz * dz) || 1;
  dx /= d;
  dz /= d;
  const gy = game.city?.groundHeightAt?.(yard.x, yard.z) ?? 0;
  // out from the house past the yard, a little to the side, up high, then a push in
  const out = (k, side, up) => [yard.x + dx * k - dz * side, gy + up, yard.z + dz * k + dx * side];
  const houseLook = [c.x, gy + 3.2, c.z];
  return {
    id: 'intro2.home.night',
    player: { at: { ...yard, heading: Math.atan2(-dx, -dz) } },
    shots: [
      {
        dur: 5.5,
        mm: 24,
        from: { pos: out(16, 7, 6), look: houseLook },
        to: { pos: out(11, 5, 4), look: houseLook },
        ease: 'inOut',
      },
      { dur: 4.5, mm: 50, from: { pos: out(-2.2, 1.6, 1.65), look: 'player' }, aperture: 1.6 },
      {
        dur: 5,
        mm: 85,
        cut: 'dissolve',
        from: { pos: out(-1.6, -0.9, 1.7), look: 'player' },
        aperture: 1.8,
      },
    ],
    phone: { who: 'Vale', from: 4.2, to: 15 },
    lines: [
      { at: 4.6, who: 'Vale', text: 'You did good work today.', ms: 2000 },
      {
        at: 6.8,
        who: 'Vale',
        text: 'There’s more where that came from. Boats, cargo, people who owe me.',
        ms: 3200,
      },
      { at: 10.2, who: 'Vale', text: 'When you’re ready, you know where the dock is.', ms: 2600 },
      { at: 13.0, who: 'Nico', text: 'Get some sleep, Vale.', ms: 1800 },
    ],
  };
}

export default defineMission({
  id: 'intro2.home',
  title: 'Home',
  giver: 'Vale',
  intro: true,
  requires: ['intro2.seaplane'],
  rewards: { unlocks: [FREE_ROAM_UNLOCK] },
  flags: { [INTRO_DONE_FLAG]: true, 'home.base': 'nicoHouse' },
  start: { teleport: true, at: (game) => house(game, 'spawnYard') },
  end: { at: (game) => house(game, 'spawnYard') },
  async setup(ctx) {
    await asNico(ctx.game);
    setHour(ctx.game, HOURS.home);
    // nothing of the job stays behind in memory
    for (const k of ['marina', 'camp']) {
      shared[k]?.dispose?.();
      shared[k] = null;
    }
    shared.plane?.dispose?.();
    shared.plane = null;
    // Mari is out of the story's hands too: in free roam she is back at her place above the dive shop
    ctx.game.characters?.stage?.('mari', MARI.home);
  },
  steps: [
    { id: 'night', cutscene: homeCutscene },
    {
      id: 'free',
      enter(ctx) {
        ctx.notify(
          'Free roam unlocked. The house is your home base: save, rest and change here.',
          6500,
        );
      },
    },
  ],
  // the intro is over: both characters are playable (pass and skip)
  apply(story) {
    const C = story.game.characters;
    if (C) C.locked = false;
  },
});
