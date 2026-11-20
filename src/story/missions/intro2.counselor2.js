// Intro v2, step 3d: back from the robbery flashback to the counselor's office (the same room and the same Ms. Harlow as
// intro2.counselor1, src/story/sets/prisonOffice.js). The consequences (the dye pack, the plea, the years) and what
// Mari hopes for once she is out. Then the intro switches to Nico (another mission).
import { defineMission } from '../runner.js';
import { openPrisonOffice, officeShots, officeSpot, COUNSELOR } from '../sets/prisonOffice.js';
import { seatedPose } from '../sets/prison.js';
import { CAST2, loadPeople, playAsMari, leavePrisonOnQuit } from './lib/intro2Prison.js';

const WHO = COUNSELOR.name;

// The picture comes back from the white of the flashback onto Mari, then the conversation over the shoulders.
function aftermath(ctx) {
  const base = officeShots(ctx);
  const [wide, onHer, onMari] = base.shots;
  return {
    id: 'counselor2.aftermath',
    frame: base.frame,
    player: { at: officeSpot('mariChair') },
    setup: () => seatedPose(ctx.game, true),
    shots: [
      // out of the flashback: long lens on Mari, pulling back
      {
        dur: 6.0,
        mm: 95,
        mm1: 70,
        from: { pos: [-0.3, 1.2, 0.95], look: [-0.05, 1.12, -0.42] },
        to: { pos: [-0.42, 1.24, 1.55] },
        focus: [-0.05, 1.12, -0.42],
        aperture: 3.0,
        ease: 'inOut',
      },
      { ...onHer, dur: 7.2 },
      { ...onMari, dur: 6.4 },
      { ...onHer, dur: 6.0, from: { ...onHer.from, pos: [0.28, 1.27, -0.92] } },
      { ...onMari, dur: 7.0 },
      { ...wide, dur: 6.4 },
    ],
    lines: [
      {
        at: 1.0,
        who: 'Mari',
        text: 'Pink. I was pink for a week. You can’t wash that stuff off.',
        ms: 3200,
      },
      {
        at: 4.6,
        who: 'Mari',
        text: 'Two thousand one hundred dollars. All of it ruined.',
        ms: 2800,
      },
      {
        at: 7.4,
        who: WHO,
        text: 'Armed robbery. You took the plea: six years, with the gun.',
        ms: 3200,
      },
      {
        at: 10.8,
        who: WHO,
        text: 'The cashier still has nightmares. His name is Walter. Did you know that?',
        ms: 3400,
      },
      { at: 14.4, who: 'Mari', text: 'I know. I wrote him. He didn’t write back.', ms: 2800 },
      {
        at: 17.8,
        who: WHO,
        text: 'The board will ask what you’d do different. And what you’ll do out there.',
        ms: 3400,
      },
      {
        at: 21.4,
        who: 'Mari',
        text: 'Get a real job. There’s a dive shop in Key Largo that hires people like me.',
        ms: 3600,
      },
      {
        at: 25.2,
        who: 'Mari',
        text: 'A room over the shop. Pay rent on time. Not owe anybody anything.',
        ms: 3400,
      },
      { at: 29.0, who: WHO, text: 'And the people you used to know?', ms: 2200 },
      { at: 31.4, who: 'Mari', text: 'Some of them I’d call. One of them, anyway.', ms: 2800 },
      {
        at: 34.4,
        who: WHO,
        text: 'Keep your record clean in here. I’ll write the letter.',
        ms: 3000,
      },
      { at: 37.6, who: 'Mari', text: 'Thank you, Ms. Harlow.', ms: 2200 },
    ],
    onEnd() {
      seatedPose(ctx.game, false);
    },
  };
}

export default defineMission({
  id: 'intro2.counselor2',
  title: 'The Letter',
  giver: 'Mari',
  intro: true,
  retry: false,
  async setup(ctx) {
    leavePrisonOnQuit(ctx.game, ['intro2.counselor2']);
    await loadPeople([CAST2.counselor]);
    await playAsMari(ctx);
    // back from the flashback: no stars, no weapon, the clock running again (the robbery missions stop it at dusk)
    try {
      ctx.game.wanted?.clear?.('script');
    } catch (e) {
      /* */
    }
    await openPrisonOffice(ctx);
  },
  steps: [{ id: 'aftermath', cutscene: aftermath }],
  apply(story) {
    story.state?.set?.('mari.letter', true);
  },
});
