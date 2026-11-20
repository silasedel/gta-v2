// Intro v2, step 2c (storyboard panel 4, PRISON INTERVIEW): a cutscene in the counselor's office. Ms. Harlow asks about
// the arrest and the early release the review board could grant; Mari starts to tell it, and the scene goes into the
// robbery flashback (another mission). The office: src/story/sets/prisonOffice.js (intro2.counselor2 reuses it).
import { defineMission } from '../runner.js';
import { openPrisonOffice, officeShots, officeSpot, COUNSELOR } from '../sets/prisonOffice.js';
import { seatedPose } from '../sets/prison.js';
import { CAST2, loadPeople, playAsMari, leavePrisonOnQuit, flashback } from './lib/intro2Prison.js';

const WHO = COUNSELOR.name;

function interview(ctx) {
  const base = officeShots(ctx);
  const [wide, onHer, onMari] = base.shots;
  return {
    id: 'counselor1.interview',
    frame: base.frame,
    player: { at: officeSpot('mariChair') },
    setup: () => seatedPose(ctx.game, true),
    shots: [
      { ...wide, dur: 5.6 },
      { ...onHer, dur: 7.4 },
      { ...onMari, dur: 5.0 },
      { ...onHer, dur: 6.6, from: { ...onHer.from, pos: [0.28, 1.27, -0.92] } },
      { ...onMari, dur: 5.6 },
      // the push-in on Mari as she remembers: long lens, very shallow, into the flashback
      {
        dur: 7.2,
        mm: 70,
        mm1: 95,
        from: { pos: [-0.42, 1.24, 1.55], look: [-0.05, 1.12, -0.42] },
        to: { pos: [-0.3, 1.2, 0.95] },
        focus: [-0.05, 1.12, -0.42],
        aperture: 3.2,
        ease: 'inOut',
      },
    ],
    lines: [
      { at: 0.8, who: WHO, text: 'Sit down, Mari. You’re my first one this morning.', ms: 2800 },
      {
        at: 5.9,
        who: WHO,
        text: 'The review board meets on the twelfth. With your good time, they could let you out early.',
        ms: 3600,
      },
      { at: 9.8, who: WHO, text: 'Months early.', ms: 1600 },
      { at: 13.4, who: 'Mari', text: 'But.', ms: 1200 },
      {
        at: 15.0,
        who: WHO,
        text: 'But they’ll read your arrest report out loud. Then they’ll look at you.',
        ms: 3400,
      },
      { at: 18.6, who: 'Mari', text: 'I know what the report says.', ms: 2000 },
      {
        at: 20.4,
        who: WHO,
        text: 'I don’t want the report. I want it from you. Start with that morning.',
        ms: 3200,
      },
      {
        at: 25.1,
        who: 'Mari',
        text: 'It was hot. I’d been up all night doing the math on rent. The math didn’t work.',
        ms: 3800,
      },
      { at: 29.2, who: WHO, text: 'And the loan place?', ms: 1600 },
      {
        at: 31.0,
        who: 'Mari',
        text: 'Across from the coffee shop. I walked past it every day.',
        ms: 2800,
      },
      { at: 34.0, who: 'Mari', text: 'That morning I didn’t walk past.', ms: 2600 },
    ],
    events: [
      { at: 13.0, run: () => ctx.h.counselor?.setPose?.('sit') },
      { at: 36.6, run: () => flashback(1400) },
    ],
    onEnd() {
      seatedPose(ctx.game, false);
    },
  };
}

export default defineMission({
  id: 'intro2.counselor1',
  title: 'Early Release',
  giver: 'Mari',
  intro: true,
  async setup(ctx) {
    leavePrisonOnQuit(ctx.game, ['intro2.prisonCell', 'intro2.prisonWalk', 'intro2.counselor1']);
    await loadPeople([CAST2.counselor]);
    await playAsMari(ctx);
    await openPrisonOffice(ctx);
  },
  steps: [{ id: 'interview', cutscene: interview }],
});
