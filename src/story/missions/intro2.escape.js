// Intro v2, step 3b (storyboard panel 6, ESCAPE): dusk, two stars, patrol cars outside the payday shop. Mari runs to
// the alley, climbs the fire escape, crosses three roofs (AC units, parapets, plank bridges over the gaps), goes down
// through the narrow stair house between two buildings, comes out in the service alley, loses the police in the
// streets (the stars drop) and heads back toward the coffee shop. Then intro2.arrest.
// The route (fire escape, planks, stair house, rooftop units) is built for this mission only and disposed with it:
// src/story/sets/robberyBlock.js buildEscapeRoute.
import { defineMission } from '../runner.js';
import {
  buildEscapeRoute,
  buildCafeAwning,
  findStore,
  CAFE_LOT,
  spot,
  P,
} from '../sets/robberyBlock.js';
import { flashbackSetup, arm, giveBag, alarm, policeCar } from './lib/intro2Robbery.js';

const ROOF_A = 9.1;
const ROOF_C = 8.2;

// a block spot with a height (the objective ring floats on the roof)
const high = (name, y) => ({ ...spot(name), y });
const above = (ctx, y) => ctx.game.player.position.y > y;

// The police lose her once she is off the street: the stars flash and drop after a short search. Helps the search
// along when she is far from the shop and out of sight (the officers never climb the roofs).
function searchTick(ctx, dt) {
  const W = ctx.game.wanted;
  if (!W || W.level <= 0) return;
  ctx.data.unseen = W.seen ? 0 : (ctx.data.unseen || 0) + dt;
  const shop = spot('shopDoorOut');
  const pp = ctx.game.player.position;
  const far = Math.sqrt((pp.x - shop.x) ** 2 + (pp.z - shop.z) ** 2) > 45;
  if (far && ctx.data.unseen > 9 && !ctx.data.dropped) {
    ctx.data.dropped = true;
    W.set(1, { x: shop.x, y: 0.2, z: shop.z }, { visual: false });
  }
  if (far && ctx.data.unseen > 18 && W.level > 0) W.clear('escaped');
}

async function scene(ctx) {
  const route = buildEscapeRoute(ctx.game);
  ctx.track(route, () => route.dispose());
  const cafe = findStore(ctx.game, CAFE_LOT);
  if (cafe) {
    const aw = buildCafeAwning(ctx.game, cafe);
    ctx.track(aw, () => aw.dispose());
  }
}

export default defineMission({
  id: 'intro2.escape',
  title: 'Over the Rooftops',
  giver: 'Mari',
  intro: true,
  start: { marker: false, teleport: true, at: () => P(0, 6.4, 0) },
  end: { at: () => spot('cafeDoor') },
  fail: {
    leftArea: { at: () => P(30, 0), r: 260, text: 'You left the neighborhood.' },
  },
  async setup(ctx, fromStep) {
    await flashbackSetup(ctx, { people: [] });
    arm(ctx, false);
    giveBag(ctx);
    await scene(ctx);
    if (fromStep < 4) {
      alarm(ctx);
      await policeCar(ctx, 'cop1', -6, 12.2, Math.PI / 2 - 0.25);
      await policeCar(ctx, 'cop2', 15, 13.8, -Math.PI / 2);
    }
  },
  steps: [
    {
      id: 'fireEscape',
      text: 'Climb the fire escape in the alley.',
      enter(ctx) {
        ctx.say('Police', 'She’s running! East side!', 2200);
      },
      trigger: (ctx) => above(ctx, ROOF_A - 0.6) && ctx.dist(spot('roofTop')) < 5,
      waypoint: () => spot('stairFoot'),
    },
    {
      id: 'roofs',
      text: 'Cross the rooftops.',
      checkpoint: { at: () => high('roofTop', ROOF_A + 0.1) },
      trigger: (ctx) => above(ctx, ROOF_C - 0.6) && ctx.dist(spot('roof3')) < 3.2,
      waypoint: (ctx) => {
        // the next roof along: No. 5955, the plank, No. 5957, the plank, No. 5956
        const pp = ctx.game.player.position;
        const onFirst = pp.y > ROOF_A - 0.4 && ctx.dist(spot('roof1')) < 20 && ctx.data.leg !== 2;
        if (onFirst && ctx.dist(spot('roof1')) > 2.5) return high('roof1', ROOF_A);
        ctx.data.leg = ctx.dist(spot('roof2')) < 3 || ctx.data.leg === 2 ? 2 : 1;
        return ctx.data.leg === 2 ? high('roof3', ROOF_C) : high('roof2', 7.4);
      },
    },
    {
      id: 'roofDoor',
      text: 'Take the roof door down.',
      trigger: (ctx) => above(ctx, ROOF_C - 0.6) && ctx.dist(spot('bulkhead')) < 1.8,
      waypoint: () => high('bulkhead', ROOF_C),
    },
    {
      id: 'down',
      text: 'Get down to the street.',
      checkpoint: { at: () => high('bulkhead', ROOF_C + 0.1) },
      trigger: (ctx) => !above(ctx, 1.2) && ctx.dist(spot('towerOut')) < 2.6,
      waypoint: () => spot('towerOut'),
    },
    {
      id: 'lose',
      text: 'Lose the police.',
      checkpoint: { at: () => spot('towerOut') },
      enter(ctx) {
        ctx.data.unseen = 0;
        ctx.data.dropped = false;
        ctx.help('Stay out of sight and leave the search area');
      },
      onTick: searchTick,
      until: (ctx) => (ctx.game.wanted?.level || 0) === 0,
      waypoint: false,
      exit(ctx) {
        ctx.help(null);
        ctx.say('Mari', 'Lost them. Breathe. Just walk.', 2400);
      },
    },
    {
      id: 'cafe',
      text: 'Head back to the coffee shop.',
      trigger: { reach: { at: () => spot('cafeDoor'), r: 3, onFoot: true } },
    },
  ],
});
