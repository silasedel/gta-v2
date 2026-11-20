// Intro v2, step 3a (storyboard panel 5, PAYDAY LOAN ROBBERY), the flashback Mari tells the counselor: dusk on 21st St,
// Miami Beach. Cutscene: she comes out of Cafe Colada and looks across at Sunshine Payday Loans. Playable: walk in,
// aim the gun at the cashier behind the glass, threaten him, take the bag he pushes through the tray, break free when a
// customer grabs her (mash Space), run out as the police pull up. Then intro2.escape.
// The shop interior is the V2 store type 'payday' (src/world/interiors/types/payday.js), streamed in and out like every
// interior; the cafe is types/robberyCafe.js. Shared bits: ./lib/intro2Robbery.js.
import { defineMission } from '../runner.js';
import { pill } from '../../activities/common.js';
import { findStore, storePoint, SHOP_LOT, FACE } from '../sets/robberyBlock.js';
import { makeCashBag, disposeObject, poseBones, BEAR_HUG, HANDS_UP } from '../sets/robberyFx.js';
import {
  CAST3,
  CASHIER,
  CUSTOMER,
  flashbackSetup,
  arm,
  giveBag,
  alarm,
  policeCar,
  stepActor,
  spot,
  P,
} from './lib/intro2Robbery.js';

// the payday shop's staging points (store-local, from types/payday.js) as world points
function shopPoint(ctx, name, y = 0) {
  const s = findStore(ctx.game, SHOP_LOT);
  const h = s?.heist;
  if (!s || !h?.[name]) {
    // the interior is not built (should not happen: setup waits for it): fall back to the sidewalk
    return spot('shopDoorOut');
  }
  return storePoint(s, h[name], y);
}

// ---------------------------------------------------------------- cutscenes
// Mari leaves the coffee shop at dusk and looks across 21st St at the payday-loan neon. Frame: her spot on the cafe's
// sidewalk facing the street (right = east, forward = north, toward the payday shop).
function cafeCutscene(ctx) {
  const door = spot('cafeDoor');
  const sign = P(0, 4.2);
  return {
    id: 'robbery.cafe',
    frame: { x: door.x, z: door.z, heading: FACE.north },
    player: { at: [0, 0, 0.7, 0] },
    shots: [
      // across the street, low: the red CAFE awning, the door, Mari stepping out under it
      {
        dur: 5.2,
        mm: 30,
        from: { pos: [-4.5, 1.1, 9.5], look: [0.2, 1.9, -0.8] },
        to: { pos: [-3.6, 1.2, 8.2] },
        focus: 'player',
        aperture: 1.4,
      },
      // her face in the last of the sun (key from the west, the cafe's warm light behind her)
      {
        dur: 4.6,
        mm: 65,
        from: { pos: [1.15, 1.62, 2.9], look: 'player' },
        to: { pos: [0.95, 1.6, 2.6] },
        focus: 'player',
        aperture: 2.6,
        handheld: 0.35,
      },
      // over her shoulder: the payday shop across the street, the neon on
      {
        dur: 5.0,
        mm: 40,
        from: { pos: [0.5, 1.68, -0.25], look: [sign.x, 2.0, sign.z] },
        to: { pos: [0.42, 1.66, 0.05] },
        focus: [sign.x, 2.0, sign.z],
        aperture: 1.2,
      },
      // close: the decision
      {
        dur: 4.2,
        mm: 90,
        from: { pos: [-0.7, 1.6, 2.45], look: 'player' },
        focus: 'player',
        aperture: 3.2,
        handheld: 0.25,
      },
    ],
    lines: [
      {
        at: 1.2,
        who: 'Mari',
        text: 'Rent was due Monday. Twelve hundred, and the car note on top.',
        ms: 3400,
      },
      {
        at: 5.6,
        who: 'Mari',
        text: 'Eleven dollars in my account. I just spent four on coffee.',
        ms: 3200,
      },
      {
        at: 10.4,
        who: 'Mari',
        text: 'Sunshine Payday Loans. Three hundred percent interest.',
        ms: 3000,
      },
      { at: 13.6, who: 'Mari', text: 'They rob people every day over there.', ms: 2400 },
      { at: 16.0, who: 'Mari', text: 'Fair’s fair.', ms: 2000 },
    ],
    end: { player: { at: [0, 0, 1.2, 0] } },
  };
}

// She bursts out of the door with the bag; the first patrol car slews in, lights on.
function sirensCutscene(ctx) {
  const out = shopPoint(ctx, 'outside');
  return {
    id: 'robbery.police',
    frame: { x: out.x, z: out.z, heading: FACE.south },
    player: { at: [0, 0, -0.6, 0] },
    shots: [
      {
        dur: 2.6,
        mm: 24,
        from: { pos: [3.6, 0.6, 5.2], look: [0, 1.4, -1.2] },
        to: { pos: [3.2, 0.7, 4.6] },
        focus: 'player',
        aperture: 1.2,
        handheld: 0.7,
      },
      {
        dur: 2.8,
        mm: 45,
        from: { pos: [-1.4, 1.5, 2.8], look: 'vehicle:cop1' },
        focus: 'vehicle:cop1',
        aperture: 1.6,
        handheld: 0.8,
      },
    ],
    lines: [
      { at: 0.4, who: 'Police', text: 'Police! Drop the bag!', ms: 2000 },
      { at: 2.8, who: 'Mari', text: 'Not today.', ms: 1600 },
    ],
    end: { player: { at: [0, 0, 0.2, 0] } },
  };
}

// ---------------------------------------------------------------- playable bits
// aiming at the cashier: right mouse held and the crosshair within ~10 degrees of him
function aimingAt(ctx, actor) {
  const P0 = ctx.game.player;
  const r = actor?.root;
  if (!P0.aiming || !r) return false;
  const dx = r.position.x - P0.position.x;
  const dz = r.position.z - P0.position.z;
  const d = Math.sqrt(dx * dx + dz * dz);
  if (d > 9) return false;
  const yaw = ctx.game.cameraYaw ?? P0.heading;
  const ax = -Math.sin(yaw);
  const az = -Math.cos(yaw);
  return (ax * dx + az * dz) / d > 0.96;
}

// the customer's grab: mash Space (pad A) to break free. Progress fills with every press and drains on its own.
function grabStep() {
  return {
    id: 'grab',
    text: 'Break free!',
    waypoint: false,
    enter(ctx) {
      const P0 = ctx.game.player;
      const cust = ctx.h.customer;
      ctx.data.qte = 0.15;
      ctx.data.grabT = 0;
      ctx.data.prevScript = P0.script;
      P0.script = { lock: true, fixed() {}, anim: { speed: 0, grounded: true }, grabbed: true };
      ctx.say(CUSTOMER, 'Oh no you don’t! Somebody call 911!', 2600);
      if (cust?.root) {
        // he steps in behind her and wraps his arms round her
        const h = P0.heading;
        cust.root.position.set(
          P0.position.x - Math.sin(h) * 0.42,
          cust.root.position.y,
          P0.position.z - Math.cos(h) * 0.42,
        );
        cust.root.rotation.y = h;
        cust.speed = 0;
        cust.setPose?.('idle');
        ctx.data.hug = poseBones(ctx.game, cust.root, BEAR_HUG);
        ctx.track(ctx.data.hug, () => ctx.data.hug());
      }
      // a quit / fail in the middle of the grab: no prompt left on screen, the player not held
      ctx.track(P0, () => {
        pill('story-qte', null);
        removeEventListener('keydown', ctx.data.onKey);
        if (P0.script?.grabbed) P0.script = null;
      });
      ctx.data.onKey = (e) => {
        if (e.code === 'Space' && !e.repeat) ctx.data.qte += 0.11;
      };
      addEventListener('keydown', ctx.data.onKey);
    },
    onTick(ctx, dt) {
      const pad = ctx.game.bindings?.padPressed?.('A');
      if (pad) ctx.data.qte += 0.11;
      ctx.data.grabT += dt;
      ctx.data.qte = Math.max(0, ctx.data.qte - dt * 0.2);
      const pct = Math.round(Math.min(1, ctx.data.qte) * 100);
      const bar =
        '<span style="display:inline-block;width:120px;height:9px;margin-left:10px;border-radius:5px;' +
        'background:rgba(255,255,255,.18);vertical-align:middle;overflow:hidden">' +
        `<span style="display:block;height:100%;width:${pct}%;background:#ff5a4a"></span></span>`;
      pill('story-qte', `Mash <b>[Space]</b> to break free${bar}`, true);
      // the shake: he drags her a little side to side
      const cust = ctx.h.customer;
      if (cust?.root) cust.root.rotation.y += Math.sin(ctx.data.grabT * 9) * 0.004;
    },
    until: (ctx) => ctx.data.qte >= 1,
    exit(ctx) {
      removeEventListener('keydown', ctx.data.onKey);
      pill('story-qte', null);
      ctx.data.hug?.();
      const P0 = ctx.game.player;
      if (P0.script?.grabbed) P0.script = null;
      ctx.say('Mari', 'Get off me!', 1600);
      // she throws him off: he stumbles back and goes down
      const cust = ctx.h.customer;
      if (cust?.root) {
        const h = P0.heading;
        cust.root.position.x -= Math.sin(h) * 1.1;
        cust.root.position.z -= Math.cos(h) * 1.1;
        cust.setPose?.('sitGround');
      }
    },
  };
}

export default defineMission({
  id: 'intro2.robbery',
  title: 'Sunshine Payday Loans',
  giver: 'Mari',
  intro: true,
  start: { marker: false, teleport: true, at: () => spot('cafeDoor') },
  end: { at: () => spot('shopDoorOut') },
  fail: {
    leftArea: { at: () => spot('street'), r: 140, text: 'You left the block.' },
  },
  async setup(ctx) {
    await flashbackSetup(ctx, { people: [CAST3.cashier, CAST3.customer] });
    arm(ctx, false);
  },
  steps: [
    { id: 'cafe', cutscene: cafeCutscene },
    {
      id: 'enter',
      text: 'Go into Sunshine Payday Loans.',
      enter(ctx) {
        // TODO(intro2): p200 is the user's cashier (Models/_Incoming_nov19_intro 009b7435); if it is missing the cast
        // falls back to a street stand-in.
        ctx.spawnActor('cashier', {
          person: CAST3.cashier,
          at: shopPoint(ctx, 'teller'),
          pose: 'idle',
        });
        const w2 = shopPoint(ctx, 'window2');
        ctx.spawnActor('customer', { person: CAST3.customer, at: w2, pose: 'idle' });
      },
      trigger: (ctx) => ctx.dist(shopPoint(ctx, 'lobby')) < 1.8,
      waypoint: (ctx) => shopPoint(ctx, 'lobby'),
    },
    {
      id: 'aim',
      text: 'Aim your gun at the cashier.',
      checkpoint: { at: () => spot('shopDoorOut') },
      enter(ctx) {
        arm(ctx, true);
        ctx.help('Hold <b>[Right Mouse]</b> to aim');
        ctx.say(CASHIER, 'Evening. Cashing a check?', 2200);
        // a retry from here: the cast is gone with the cleanup
        if (!ctx.h.cashier) {
          ctx.spawnActor('cashier', {
            person: CAST3.cashier,
            at: shopPoint(ctx, 'teller'),
            pose: 'idle',
          });
        }
        if (!ctx.h.customer) {
          ctx.spawnActor('customer', {
            person: CAST3.customer,
            at: shopPoint(ctx, 'window2'),
            pose: 'idle',
          });
        }
      },
      trigger: (ctx) => aimingAt(ctx, ctx.h.cashier),
      waypoint: 'cashier',
      exit(ctx) {
        ctx.help(null);
        const stop = poseBones(ctx.game, ctx.h.cashier?.root, HANDS_UP);
        ctx.track(stop, () => stop());
        ctx.h.customer?.setPose?.('cower');
        ctx.say(CASHIER, 'Whoa, whoa! Easy! Easy!', 2000);
      },
    },
    {
      id: 'threaten',
      text: 'Threaten the cashier.',
      trigger: {
        interact: { at: (ctx) => shopPoint(ctx, 'tray'), r: 2.6, label: 'threaten the cashier' },
      },
      exit(ctx) {
        ctx.say('Mari', 'Everything in the drawer. In a bag, through the tray. Now!', 3000);
      },
    },
    {
      id: 'fill',
      text: 'Keep him covered.',
      waypoint: false,
      async enter(ctx) {
        await ctx.wait(3.1);
        ctx.say(CASHIER, 'Okay! It’s all there, it’s all there. Please.', 2600);
      },
      trigger: { wait: 2.2 },
      exit(ctx) {
        // the bag lands in the deal tray
        const bag = makeCashBag();
        const at = shopPoint(ctx, 'tray', 0.98);
        bag.position.set(at.x, at.y, at.z);
        bag.rotation.y = at.heading + 1.3;
        ctx.game.scene.add(bag);
        ctx.h.trayBag = bag;
        ctx.track(bag, () => disposeObject(bag));
      },
    },
    {
      id: 'take',
      text: 'Take the money.',
      trigger: {
        interact: { at: (ctx) => shopPoint(ctx, 'tray'), r: 2.4, label: 'take the money' },
      },
      exit(ctx) {
        disposeObject(ctx.h.trayBag);
        ctx.h.trayBag = null;
        giveBag(ctx);
      },
    },
    grabStep(),
    {
      id: 'out',
      text: 'Get out before the police come!',
      async enter(ctx) {
        alarm(ctx);
        ctx.say(CASHIER, 'Help! She’s got the money!', 2200);
        await policeCar(ctx, 'cop1', -6, 12.2, Math.PI / 2 - 0.25);
        await policeCar(ctx, 'cop2', 15, 13.8, -Math.PI / 2);
      },
      trigger: { reach: { at: (ctx) => shopPoint(ctx, 'outside'), r: 2.4, onFoot: true } },
    },
    { id: 'police', cutscene: sirensCutscene },
  ],
});
