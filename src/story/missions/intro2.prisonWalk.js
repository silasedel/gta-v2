// Intro v2, step 2b (storyboard panel 3, PRISON WALK): playable as Mari. Follow the corrections officer down the cell
// block corridor (grey steel doors both sides, fluorescent strips) past the dayroom to the counselor's office. He waits
// when she lags. Ends at the office door, which he opens (intro2.counselor1 follows). The set: src/story/sets/prison.js.
import { defineMission } from '../runner.js';
import { PRISON, prisonSpot } from '../sets/prison.js';
import {
  CAST2,
  GUARD,
  enterPrison,
  loadPeople,
  playAsMari,
  prisonActor,
  walker,
  leavePrisonOnQuit,
} from './lib/intro2Prison.js';

const S = PRISON.site;
const W = (x, y, z) => [S.x + x, S.y + y, S.z + z];
// she starts just outside her cell; he starts a step ahead of her
const MARI_START = { x: 2.3, z: 0.55, heading: Math.PI / 2 };
const GUARD_START = { x: 3.7, z: 0.35, heading: Math.PI / 2 };

// what the inmates call out as she passes (each once, when she comes within 3.5 m)
const CALLS = [
  { who: 'p197', name: 'Keisha', text: 'Look who got called up to see the counselor.' },
  { who: 'p198', name: 'Tina', text: 'Bring us back a real coffee, Mari.' },
  { who: 'p199', name: 'Rosa', text: 'Tell her you found God. They love that.' },
];

function doorCutscene(ctx) {
  const door = ctx.data.set?.officeDoor;
  return {
    id: 'prisonWalk.door',
    player: { at: prisonSpot({ x: 28.3, z: 0.6, heading: Math.PI / 2 }) },
    shots: [
      {
        dur: 4.6,
        mm: 35,
        from: { pos: W(26.4, 1.7, -0.9), look: W(29.6, 1.3, 1.0) },
        to: { pos: W(26.8, 1.65, -0.7) },
        focus: W(29.0, 1.4, 0.9),
        aperture: 1.2,
      },
    ],
    lines: [
      { at: 0.4, who: GUARD, text: 'In. Ten minutes, then I walk you back.', ms: 2600 },
      { at: 3.1, who: 'Mari', text: 'Ten minutes. Sure.', ms: 1500 },
    ],
    events: [{ at: 0.6, always: true, run: () => door?.animate(1, 1.4) }],
    onEnd() {
      door?.set(1);
    },
  };
}

export default defineMission({
  id: 'intro2.prisonWalk',
  title: 'The Walk',
  giver: 'Mari',
  intro: true,
  async setup(ctx) {
    leavePrisonOnQuit(ctx.game, ['intro2.prisonCell', 'intro2.prisonWalk', 'intro2.counselor1']);
    await loadPeople([CAST2.guard, ...CAST2.inmates]);
    await playAsMari(ctx);
    const set = await enterPrison(ctx, MARI_START);
    set.cellDoor?.set(1);
    set.officeDoor?.set(0);
    prisonActor(ctx, 'guard', CAST2.guard, GUARD_START, 'idle');
    ctx.data.inmates = [];
    for (const m of PRISON.inmates) {
      const a = prisonActor(ctx, 'inmate_' + m.person, m.person, m, m.pose);
      if (a) ctx.data.inmates.push({ name: 'inmate_' + m.person, person: m.person, said: false });
    }
    ctx.data.walk = walker(ctx, () => ctx.h.guard, PRISON.walk, {
      speed: 1.2,
      onWait: (n) =>
        ctx.say(GUARD, n === 1 ? 'Keep up. Stay on the line.' : 'Today, please.', 2200),
    });
  },
  steps: [
    {
      id: 'follow',
      text: 'Follow the officer.',
      waypoint: 'guard',
      enter(ctx) {
        ctx.say(GUARD, 'Hands where I can see them. Walk the line.', 2600);
      },
      onTick(ctx, dt) {
        ctx.data.walk.update(dt);
        const pp = ctx.game.player.position;
        for (const m of ctx.data.inmates) {
          const a = ctx.h[m.name];
          if (!a) continue;
          const r = a.root.position;
          const d = Math.hypot(pp.x - r.x, pp.z - r.z);
          if (d < 6) a.lookAt = pp;
          if (!m.said && d < 3.6) {
            m.said = true;
            const c = CALLS.find((k) => k.who === m.person);
            if (c) ctx.say(c.name, c.text, 2600);
          }
        }
      },
      until(ctx) {
        return ctx.data.walk.done && ctx.dist(prisonSpot(PRISON.officeDoor)) < 3.2;
      },
    },
    { id: 'door', cutscene: doorCutscene },
  ],
});
