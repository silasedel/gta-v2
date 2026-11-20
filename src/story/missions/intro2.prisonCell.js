// Intro v2, step 2a (storyboard panel 2, PRISON CELL): playable as Mari in her cell. Talk to the cellmate, Dolores; a guard
// opens the cell door and calls her out for the counselor. Ends when she steps out into the corridor (intro2.prisonWalk
// follows). The set: src/story/sets/prison.js.
import { defineMission } from '../runner.js';
import { PRISON, prisonSpot } from '../sets/prison.js';
import {
  CAST2,
  CELLMATE,
  GUARD,
  MARI_NUMBER,
  enterPrison,
  loadPeople,
  playAsMari,
  prisonActor,
  leavePrisonOnQuit,
} from './lib/intro2Prison.js';

const C = PRISON.cell;
const S = PRISON.site;
// set frame -> world array for cutscene cameras
const W = (x, y, z) => [S.x + x, S.y + y, S.z + z];

// where Mari stands while they talk: a step from the bunk, facing Dolores
const TALK_SPOT = { x: 1.72, z: 3.35, heading: -0.78 };
const OUTSIDE = { x: 2.4, z: 0.55 };

function talkCutscene(ctx) {
  const door = ctx.data.set?.cellDoor;
  return {
    id: 'prisonCell.dolores',
    player: { at: prisonSpot(TALK_SPOT) },
    shots: [
      // panel 2: over Mari's back into the cell, Dolores on the lower bunk, the barred window high up
      {
        dur: 5.2,
        mm: 30,
        from: { pos: W(2.35, 1.62, 2.05), look: W(0.95, 1.2, 4.6) },
        to: { pos: W(2.25, 1.6, 2.25) },
        focus: W(0.95, 1.1, 4.15),
        aperture: 1.4,
      },
      // Dolores, close, from Mari's side
      {
        dur: 6.4,
        mm: 55,
        from: { pos: W(1.55, 1.38, 3.42), look: W(0.98, 1.12, 4.12) },
        focus: W(0.98, 1.12, 4.12),
        aperture: 2.2,
      },
      // reverse: over Dolores' shoulder onto Mari
      {
        dur: 5.6,
        mm: 50,
        from: { pos: W(0.62, 1.28, 4.55), look: W(1.72, 1.55, 3.35) },
        focus: W(1.72, 1.55, 3.35),
        aperture: 2.2,
      },
      // the door: the slot goes dark, the steel slides away, the officer stands there
      {
        dur: 6.8,
        mm: 35,
        from: { pos: W(1.05, 1.5, 4.85), look: W(2.4, 1.35, 1.5) },
        to: { pos: W(1.15, 1.48, 4.6) },
        focus: W(2.4, 1.4, 1.2),
        aperture: 1.2,
      },
    ],
    lines: [
      { at: 0.6, who: CELLMATE, text: 'You’re pacing again.', ms: 2000 },
      { at: 2.7, who: 'Mari', text: 'Couldn’t sleep.', ms: 1800 },
      {
        at: 5.4,
        who: CELLMATE,
        text: 'Big day. Counselor’s seeing people for the board.',
        ms: 2900,
      },
      { at: 8.5, who: 'Mari', text: 'She’ll want the robbery again. Every detail.', ms: 2800 },
      {
        at: 11.6,
        who: CELLMATE,
        text: 'Then give it to her. Sorry, learned my lesson, got a plan.',
        ms: 3300,
      },
      { at: 15.2, who: 'Mari', text: 'And if I don’t have a plan?', ms: 2200 },
      {
        at: 17.6,
        who: CELLMATE,
        text: 'Baby, nobody does. You just say it like you mean it.',
        ms: 3000,
      },
      { at: 19.6, who: GUARD, text: `${MARI_NUMBER}. On your feet.`, ms: 2400 },
      { at: 22.1, who: GUARD, text: 'Counselor’s waiting. Let’s go.', ms: 2300 },
    ],
    events: [
      // the officer walks up while she talks; the door slides open on his call
      {
        at: 17.4,
        always: true,
        run: () => {
          if (!ctx.h.guard) {
            prisonActor(ctx, 'guard', CAST2.guard, C.guardDoor, 'idle');
          }
        },
      },
      { at: 19.3, run: () => door?.animate(1, 1.6) },
      { at: 0, run: (cs) => cs.animate(ctx.h.cellmate, 'sit') },
    ],
    onEnd() {
      door?.set(1);
      if (!ctx.h.guard) prisonActor(ctx, 'guard', CAST2.guard, C.guardDoor, 'idle');
    },
  };
}

export default defineMission({
  id: 'intro2.prisonCell',
  title: 'Count Time',
  giver: 'Mari',
  intro: true,
  async setup(ctx) {
    leavePrisonOnQuit(ctx.game, ['intro2.prisonCell', 'intro2.prisonWalk', 'intro2.counselor1']);
    await loadPeople([CAST2.cellmate, CAST2.guard]);
    await playAsMari(ctx);
    const set = await enterPrison(ctx, C.mariStart);
    set.cellDoor?.set(0);
    set.officeDoor?.set(0);
    prisonActor(ctx, 'cellmate', CAST2.cellmate, C.cellmate, 'sit');
  },
  steps: [
    {
      id: 'talk',
      text: `Talk to ${CELLMATE}.`,
      trigger: { interact: { at: 'cellmate', r: 2.1, label: `talk to ${CELLMATE}` } },
    },
    { id: 'dolores', cutscene: talkCutscene },
    {
      id: 'out',
      text: 'Step out of the cell.',
      enter(ctx) {
        const g = ctx.h.guard;
        if (g) g.lookAt = ctx.game.player.position;
        ctx.say(CELLMATE, 'Go on. Don’t keep the lady waiting.', 2600);
      },
      trigger: { reach: { at: prisonSpot(OUTSIDE), r: 1.1 } },
    },
  ],
});
