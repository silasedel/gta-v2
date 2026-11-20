// Shared bits of the robbery flashback (intro v2 step 3, storyboard panels 5-7): intro2.robbery, intro2.escape,
// intro2.arrest. Not a mission file. The block, its spots and the escape route: src/story/sets/robberyBlock.js;
// the bag, the dye pack, the cuffs: src/story/sets/robberyFx.js.
import { playAsMari, loadPeople, CAST2 } from './intro2Prison.js';
import { house } from './intro.js';
import { getCinema } from '../../../ui/menu/cinema.js';
import { spot, P, SHOP_LOT, CAFE_LOT, storeBuilt } from '../../sets/robberyBlock.js';
import { makeCashBag, carryBag, disposeObject, stainBag, lightsOn } from '../../sets/robberyFx.js';

export { loadPeople };

// the people of the flashback (public/assets/npc/people/index.json)
export const CAST3 = {
  cashier: CAST2.cashier, // p200: heavy-set, glasses, blue floral shirt (Models/_Incoming_nov19_intro 009b7435)
  customer: 'p92', // the customer who grabs her: heavy-set man, grey tee and jeans
  officerF: 'p73', // the arresting officers (panel 7): a woman and a man in dark uniforms
  officerM: 'p63',
  barista: 'p17',
};
export const CASHIER = 'Cashier';
export const CUSTOMER = 'Customer';
export const OFFICER_F = 'Officer Reyes';
export const OFFICER_M = 'Officer Dunn';

// dusk over Miami Beach for the whole flashback: the clock stops at 18:55 and runs again on cleanup
export const DUSK = 18.92;
export function dusk(ctx) {
  // a clear evening (the storyboard's warm dusk light), no weather change while the flashback runs
  const Wx = ctx.game.weather;
  if (Wx?.set) {
    Wx.set('clear', { instant: true });
    Wx.hold?.(true);
    ctx.track(Wx, () => Wx.hold?.(false));
  }
  const T = ctx.game.time;
  if (!T) {
    ctx.game.timeOfDay = DUSK;
    return;
  }
  const was = T.paused;
  T.set?.({ hour: DUSK });
  T.paused = true;
  ctx.track(T, () => {
    T.paused = was;
  });
}

// Mari, no switching, no stars from before, the shop and the cafe streamed in
export async function flashbackSetup(ctx, o = {}) {
  await playAsMari(ctx);
  // Nico is not in this story yet: his double waits at his house, not on the sidewalk where she was switched in
  try {
    ctx.game.characters?.stage?.('nico', house(ctx.game, 'spawnYard'));
  } catch (e) {
    /* no double */
  }
  dusk(ctx);
  try {
    ctx.game.wanted?.clear?.('script');
  } catch (e) {
    /* police not loaded */
  }
  // the interior engine keeps three shops loaded, nearest first: these two stay in while the mission runs
  const V2 = ctx.game.interiorsV2;
  for (const lot of [SHOP_LOT, CAFE_LOT]) {
    V2?.pin?.(lot, true);
    ctx.track(lot, () => V2?.pin?.(lot, false));
  }
  // the street around her streamed in before the picture comes up
  const pp = ctx.game.player.position;
  const streamed = getCinema(ctx.game).waitStream(pp.x, pp.z, 8000, 120);
  await loadPeople(o.people || [CAST3.cashier, CAST3.customer, CAST3.officerF, CAST3.officerM]);
  await streamed;
  await Promise.all([storeBuilt(ctx.game, SHOP_LOT, 15000), storeBuilt(ctx.game, CAFE_LOT, 15000)]);
}

// Mari's pistol: in her hand (`draw`) or holstered
export function arm(ctx, draw) {
  const W = ctx.game.weapons;
  if (W && !W.has('pistol')) W.give('pistol', 34, { select: false });
  if (draw) W?.select?.('pistol');
  else {
    ctx.game.player.weapon = 'fist';
    ctx.game.emit?.('weaponChange', { weapon: 'fist' });
  }
}

// the cash bag in Mari's right hand (ctx.h.bag); stained = the dye pack already went off
export function giveBag(ctx, stained = false) {
  const bag = makeCashBag();
  if (stained) stainBag(bag);
  const drop = carryBag(ctx.game, bag);
  ctx.h.bag = bag;
  ctx.track(bag, () => {
    drop();
    disposeObject(bag);
  });
  return bag;
}

// a police car parked at a block spot with its light bar on (cleaned up with the mission)
export async function policeCar(ctx, name, u, v, ry) {
  const at = P(u, v, ry);
  const car = await ctx.spawnVehicle(name, 'police1', at, { keepOnPass: false });
  if (car) lightsOn(car);
  return car;
}

// raise the alarm: two stars, the police know where (the payday shop)
export function alarm(ctx) {
  const at = spot('shopDoorOut');
  try {
    ctx.game.wanted?.set?.(2, { x: at.x, y: 0.2, z: at.z }, { visual: true });
  } catch (e) {
    console.warn('[intro2] wanted', e);
  }
}

// move a staged actor toward a world point at `speed` m/s (walk / run clip by speed); true when there
export function stepActor(actor, to, speed, dt) {
  const r = actor?.root;
  if (!r) return true;
  const dx = to.x - r.position.x;
  const dz = to.z - r.position.z;
  const d = Math.sqrt(dx * dx + dz * dz);
  if (d < 0.08) {
    actor.speed = 0;
    return true;
  }
  const step = Math.min(d, speed * dt);
  r.position.x += (dx / d) * step;
  r.position.z += (dz / d) * step;
  r.rotation.y = Math.atan2(dx, dz);
  actor.speed = speed;
  return false;
}

export { spot, P };
