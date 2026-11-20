// Intro v2, step 7 (FREE-ROAM UNLOCK): night at Nico's house on Key Largo after the job. The house is his first home
// base; Vale calls about more work; the intro ends, the character wheel opens (Mari and Nico) and the game is free
// from here.
import { defineMission } from '../runner.js';
import { HOURS, house, asNico, setHour, shared } from './lib/intro.js';
import { INTRO_DONE_FLAG, FREE_ROAM_UNLOCK } from '../intro.js';

function homeCutscene(ctx) {
  const yard = house(ctx.game, 'spawnYard');
  return {
    id: 'intro2.home.night',
    frame: yard,
    player: { at: yard },
    shots: [
      // the house at night, porch lights on, a slow push in
      {
        dur: 5.5,
        mm: 24,
        from: { pos: [14, 7, -26], look: [0, 3, 0] },
        to: { pos: [10, 5, -19], look: [0, 2.6, 0] },
        ease: 'inOut',
      },
      { dur: 4.5, mm: 50, from: { pos: [2.4, 1.6, 2.6], look: 'player' }, aperture: 1.6 },
      {
        dur: 5,
        mm: 85,
        cut: 'dissolve',
        from: { pos: [1.3, 1.7, 1.7], look: 'player' },
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
