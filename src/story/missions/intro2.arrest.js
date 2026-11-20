// Intro v2, step 3c (storyboard panel 7, ARREST), a cutscene: Mari is back outside Cafe Colada (red CAFE awning) when
// the dye pack in the cash goes off: a red/pink cloud, dye on her and on the bag. Two patrol cars pull in, lights on; a
// female and a male officer take her from behind and cuff her. Then intro2.counselor2 (back in the prison office).
import { defineMission } from '../runner.js';
import { spot, P, FACE } from '../sets/robberyBlock.js';
import {
  dyeBurst,
  stainBag,
  dyeOnHero,
  cuffPose,
  lightsOn,
  policeGlow,
} from '../sets/robberyFx.js';
import {
  CAST3,
  OFFICER_F,
  OFFICER_M,
  flashbackSetup,
  arm,
  giveBag,
  stepActor,
  dressBlock,
} from './lib/intro2Robbery.js';

// walk a staged actor along points (removed from the list as they are reached); true at the last one
function followPath(actor, path, speed, dt) {
  if (!path.length) return true;
  if (stepActor(actor, path[0], speed, dt) && path.length > 1) path.shift();
  return path.length === 1 && stepActor(actor, path[0], speed, 0);
}

// Frame: Mari's spot on the cafe sidewalk facing the street (right = east, forward = north, back = the cafe door).
function arrestCutscene(ctx) {
  // 1.6 m out from the cafe door (room behind her for the shot over the officers' shoulders)
  const door0 = spot('cafeDoor');
  const door = {
    x: door0.x + Math.sin(FACE.north) * 1.6,
    z: door0.z + Math.cos(FACE.north) * 1.6,
  };
  const at = (r, f) => {
    // frame-local [right, forward] -> world { x, z }
    const h = FACE.north;
    return {
      x: door.x - r * Math.cos(h) + f * Math.sin(h),
      z: door.z + r * Math.sin(h) + f * Math.cos(h),
    };
  };
  // where the officers come from (their car, on the street) and where they end (behind her)
  const fFrom = at(-3.2, 5.4);
  const mFrom = at(-1.2, 6.2);
  // round her (not through her) to the places at her back
  const fPath = [at(-1.4, 0.2), at(-0.9, -0.7), at(-0.18, -0.55)];
  const mPath = [at(1.5, 0.9), at(1.2, -0.5), at(0.75, -0.35)];
  let walk = null;
  let stopCuffs = null;
  let restoreDye = null;
  let stopDye = null;
  const glows = [];
  return {
    id: 'arrest.cafe',
    frame: { x: door.x, z: door.z, heading: FACE.north },
    player: { at: [0, 0, 0.6, 0] },
    actors: {
      officerF: { person: CAST3.officerF, at: [-3.2, 0, 5.4, Math.PI], pose: 'idle' },
      officerM: { person: CAST3.officerM, at: [-1.2, 0, 6.2, Math.PI], pose: 'idle' },
    },
    vehicles: {
      copA: { key: 'police1', at: (game) => P(-4.5, 15.6, -Math.PI / 2 + 0.3), temp: true },
      copB: { key: 'police1', at: (game) => P(7, 16.4, Math.PI / 2 - 0.2), temp: true },
    },
    setup(cs) {
      for (const v of Object.values(cs.vehicles)) {
        lightsOn(v);
        glows.push(policeGlow(ctx.game, v));
      }
      // the officers start out of shot by their car
      for (const a of [cs.actors.officerF, cs.actors.officerM]) {
        if (a?.root) a.root.visible = false;
      }
    },
    shots: [
      // 1. wide from across the street: the red CAFE awning, Mari walking back with the bag
      {
        dur: 4.2,
        mm: 32,
        from: { pos: [2.6, 1.3, 11.5], look: [0, 1.7, -0.6] },
        to: { pos: [2.0, 1.35, 10.2] },
        focus: 'player',
        aperture: 1.2,
      },
      // 2. medium on her and the bag: it pops
      {
        dur: 3.6,
        mm: 45,
        from: { pos: [1.6, 1.25, 3.0], look: [0.1, 1.0, 0.6] },
        to: { pos: [1.4, 1.3, 2.6] },
        focus: [0.1, 1.0, 0.6],
        aperture: 2.2,
        handheld: 0.6,
      },
      // 3. her face in the pink haze, lights starting to flash on it
      {
        dur: 3.4,
        mm: 85,
        from: { pos: [-0.5, 1.58, 2.3], look: 'player' },
        focus: 'player',
        aperture: 3.0,
        handheld: 0.4,
      },
      // 4. the patrol cars from low on the sidewalk, officers getting out and coming at her
      {
        dur: 4.4,
        mm: 28,
        from: { pos: [3.4, 0.6, 1.4], look: [-1.6, 1.25, 3.2] },
        to: { pos: [3.2, 0.65, 1.0] },
        focus: [-1.4, 1.25, 3.0],
        aperture: 1.0,
      },
      // 5. cuffed from behind: Mari to camera, the officers at her back, lights red / blue over all three
      {
        dur: 6.0,
        mm: 50,
        from: { pos: [0.3, 1.5, 3.1], look: [0.15, 1.3, 0.4] },
        to: { pos: [0.25, 1.48, 2.6] },
        focus: 'player',
        aperture: 2.4,
        handheld: 0.3,
      },
      // 6. from behind: the two officers either side of her, her wrists in the cuffs, the street and the lights ahead
      {
        dur: 4.6,
        mm: 40,
        from: { pos: [0.3, 1.72, -1.9], look: [0, 1.1, 0.5] },
        to: { pos: [0.2, 1.68, -1.6] },
        focus: [0, 1.1, 0.5],
        aperture: 2.2,
        handheld: 0.25,
      },
      // 7. pull back wide: the cafe, the dye on the sidewalk, the cars, the lights
      {
        dur: 5.0,
        mm: 30,
        from: { pos: [-3.5, 2.2, 9.5], look: [0, 1.4, 0.4] },
        to: { pos: [-4.4, 3.4, 12.0] },
        focus: 'player',
        aperture: 0.8,
        ease: 'inOut',
      },
    ],
    lines: [
      { at: 1.4, who: 'Mari', text: 'Okay. You did it. Just walk.', ms: 2200 },
      { at: 4.6, who: 'Mari', text: 'What—', ms: 1000 },
      { at: 6.0, who: 'Mari', text: 'No, no, no!', ms: 1600 },
      {
        at: 8.2,
        who: OFFICER_F,
        text: 'Police! Drop the bag! Hands where I can see them!',
        ms: 2600,
      },
      {
        at: 11.4,
        who: OFFICER_M,
        text: 'On your knees— no, stay right there. Don’t move.',
        ms: 2400,
      },
      { at: 14.2, who: OFFICER_F, text: 'Hands behind your back.', ms: 2000 },
      { at: 16.4, who: OFFICER_F, text: 'You have the right to remain silent.', ms: 2400 },
      { at: 19.0, who: OFFICER_M, text: 'Dye pack. They always forget the dye pack.', ms: 2600 },
      { at: 22.2, who: 'Mari', text: 'I was going to pay the rent.', ms: 2600 },
    ],
    events: [
      {
        // the dye pack goes off in the bag
        at: 5.0,
        run(cs) {
          const bag = ctx.h.bag;
          const p = bag ? bag.getWorldPosition(bag.position.clone()) : null;
          const pp = ctx.game.player.position;
          stopDye = dyeBurst(ctx.game, p || { x: pp.x, y: pp.y + 0.9, z: pp.z });
          if (bag) stainBag(bag);
          restoreDye = dyeOnHero(ctx.game, 0.34);
        },
        always: true,
      },
      {
        // the officers come round the car
        at: 7.6,
        run(cs) {
          const F = cs.actors.officerF;
          const M = cs.actors.officerM;
          for (const a of [F, M]) {
            if (a?.root) a.root.visible = true;
          }
          let t = 0;
          walk = (dt) => {
            t += dt;
            const fDone = followPath(F, fPath, t < 4 ? 2.6 : 1.2, dt);
            const mDone = followPath(M, mPath, t < 4 ? 2.4 : 1.1, dt);
            if (fDone && F?.root) F.root.rotation.y = FACE.north;
            if (mDone && M?.root) M.root.rotation.y = FACE.north - 0.5;
          };
          ctx.game.updaters.push(walk);
        },
      },
      {
        // hands behind her back
        at: 14.4,
        run(cs) {
          stopCuffs = cuffPose(ctx.game);
          cs.actors.officerM?.setPose?.('cross_arms');
        },
      },
    ],
    end: { player: { at: [0, 0, 0.6, 0] } },
    onEnd(cs) {
      if (walk) {
        const i = ctx.game.updaters.indexOf(walk);
        if (i >= 0) ctx.game.updaters.splice(i, 1);
      }
      stopCuffs?.();
      for (const g of glows) g();
      stopDye?.();
      restoreDye?.();
    },
  };
}

export default defineMission({
  id: 'intro2.arrest',
  title: 'Dye Pack',
  giver: 'Mari',
  intro: true,
  retry: false,
  start: { marker: false, teleport: true, at: () => spot('cafeDoor') },
  end: { at: () => spot('cafeDoor') },
  async setup(ctx) {
    await flashbackSetup(ctx, { people: [CAST3.officerF, CAST3.officerM] });
    arm(ctx, false);
    giveBag(ctx);
    await dressBlock(ctx, { cafe: true });
  },
  steps: [{ id: 'arrest', cutscene: arrestCutscene }],
  apply(story) {
    story.state?.set?.('mari.arrested', true);
  },
});
