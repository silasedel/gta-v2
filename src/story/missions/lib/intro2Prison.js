// Shared bits of the intro v2 opening and prison missions (intro2.opening, intro2.prisonCell, intro2.prisonWalk,
// intro2.counselor1; docs/v2/plan/INTRO_V2_PLAN.md steps 1-2). Not a mission file.
import { loadPerson } from '../../../npc/people/lib.js';
import { acquirePrisonSet, releasePrisonSet, prisonSpot, PRISON } from '../../sets/prison.js';
import { COUNSELOR } from '../../sets/prisonOffice.js';

// the user's Tripo people for these scenes (public/assets/npc/people/index.json, Models/NPCs/NPC 194-200)
export const CAST2 = {
  counselor: COUNSELOR.person, // p194: curly hair, glasses, olive blazer, lanyard
  guard: 'p195', // corrections officer, dark uniform, duty belt
  cellmate: 'p196', // Dolores: older inmate, orange scrubs, ID badge
  inmates: ['p197', 'p198', 'p199'],
  cashier: 'p200', // the payday-loan cashier (another mission)
};
export const CELLMATE = 'Dolores';
export const GUARD = 'Officer Pratt';
export const MARI_NUMBER = 'Four-one-one-two-seven';

// Load people under the black of a mission start (spawnPosed then gets the real person, not a crowd stand-in).
export function loadPeople(ids, ms = 25000) {
  const all = Promise.all(ids.map((id) => loadPerson(id).catch(() => null)));
  const late = new Promise((resolve) => setTimeout(resolve, ms));
  return Promise.race([all, late]);
}

// Play as Mari for the rest of the mission: an instant switch (no sky cut), the switch wheel locked, no weapon drawn.
// Everything is undone on the mission's cleanup except the character (the next intro mission is Mari's too).
export async function playAsMari(ctx) {
  const { game } = ctx;
  const ch = game.characters;
  if (ch) {
    try {
      await ch.ready?.();
    } catch (e) {
      /* her model failed: the mission runs with whoever is loaded */
    }
    if (ch.active?.id !== 'mari') await ch.switchTo('mari', { instant: true });
    ch.locked = true;
    ctx.track(ch, () => {
      ch.locked = false;
    });
  }
  const P = game.player;
  P.weapon = 'fist';
}

// The prison set for a mission: built (or reused) now, released on the mission's cleanup. Puts Mari at `spot` (set frame).
export async function enterPrison(ctx, spot, mode = 'full') {
  const set = await acquirePrisonSet(ctx.game, mode);
  ctx.track(set, () => releasePrisonSet(ctx.game));
  ctx.data.set = set;
  if (spot) {
    const at = prisonSpot(spot);
    ctx.game.teleport(at.x, at.y, at.z, at.heading);
  }
  return set;
}

// A staged person in the prison (set-frame spot). If that person was not loaded yet (spawnPosed then stands in someone
// from the street crowd), the stand-in is swapped for the real one as soon as the model is in.
export function prisonActor(ctx, name, person, spot, pose = 'idle') {
  const a = stage(ctx, name, person, prisonSpot(spot), pose);
  if (a && a.character?.personMeta?.id !== person) {
    loadPerson(person)
      .then(() => {
        if (ctx.h[name] !== a || a.removed) return;
        const r = a.root;
        const at = { x: r.position.x, y: r.position.y, z: r.position.z, heading: r.rotation.y };
        const b = stage(ctx, name, person, at, a.pose);
        if (!b) return;
        b.speed = a.speed;
        b.lookAt = a.lookAt;
        a.remove();
      })
      .catch(() => {});
  }
  return a;
}

// spawnActor + a removed flag (removing twice is harmless) + the pose it was given
function stage(ctx, name, person, at, pose) {
  const a = ctx.spawnActor(name, { person, at, pose });
  if (!a) return null;
  a.pose = pose;
  const remove = a.remove;
  a.remove = () => {
    if (a.removed) return;
    a.removed = true;
    remove();
  };
  return a;
}

// Quit from a prison mission (or Free Roam over it): the player must not stay in the floating set.
export function leavePrisonOnQuit(game, ids) {
  if (game.__intro2QuitHook) return;
  game.__intro2QuitHook = true;
  game.on?.('mission:quit', ({ id }) => {
    if (!ids.includes(id)) return;
    const p = game.player?.position;
    const s = PRISON.site;
    if (p && Math.abs(p.y - s.y) < 20 && Math.abs(p.x - s.x) < 60) game.story?.toHouse?.();
  });
}

// ---------------------------------------------------------------- the guard who walks ahead
// Moves a staged actor along `path` (set-frame points) at walking pace; waits (turned to her) when Mari falls behind more
// than `wait` m and goes on once she is within `resume` m. Returns { update(dt), done, waiting }.
export function walker(ctx, actorOf, path, o = {}) {
  const pts = path.map((p) => prisonSpot(p));
  const speed = o.speed ?? 1.25;
  const W = {
    i: 0,
    done: false,
    waiting: false,
    speed: 0,
    nagged: 0,
  };
  W.update = (dt) => {
    const actor = typeof actorOf === 'function' ? actorOf() : actorOf;
    const r = actor?.root;
    if (!r || W.done) {
      if (actor) actor.speed = 0;
      return;
    }
    const pp = ctx.game.player.position;
    const dPlayer = Math.hypot(pp.x - r.position.x, pp.z - r.position.z);
    if (!W.waiting && dPlayer > (o.wait ?? 5.5)) {
      W.waiting = true;
      W.waitT = 0;
    }
    if (W.waiting && dPlayer < (o.resume ?? 3.2)) W.waiting = false;
    const target = pts[W.i];
    const dx = target.x - r.position.x;
    const dz = target.z - r.position.z;
    const d = Math.hypot(dx, dz);
    let want = W.waiting ? 0 : speed;
    if (W.i === pts.length - 1) want = Math.min(want, d * 1.5);
    W.speed += (want - W.speed) * Math.min(1, dt * 4);
    actor.speed = W.speed;
    let face = Math.atan2(dx, dz);
    if (W.waiting) {
      W.waitT += dt;
      face = Math.atan2(pp.x - r.position.x, pp.z - r.position.z);
      if (W.waitT > 1.2 && W.nagged < 2 && o.onWait) {
        W.nagged++;
        W.waitT = -6;
        o.onWait(W.nagged);
      }
    }
    turnTo(r, face, dt * 5);
    if (d < 0.25) {
      if (W.i < pts.length - 1) W.i++;
      else {
        W.done = true;
        actor.speed = 0;
        return;
      }
    }
    const step = Math.min(d, W.speed * dt);
    if (d > 1e-4) {
      r.position.x += (dx / d) * step;
      r.position.z += (dz / d) * step;
    }
  };
  return W;
}

function turnTo(obj, heading, k) {
  const a = obj.rotation.y;
  const diff = Math.atan2(Math.sin(heading - a), Math.cos(heading - a));
  obj.rotation.y = a + diff * Math.min(1, k);
}

// ---------------------------------------------------------------- time / place card
// A small lower-left card over the picture ("Two years later" / the place), fades in and out on its own.
const CARD_CSS = `
.i2-card{position:fixed;left:6vw;bottom:19vh;z-index:64;pointer-events:none;opacity:0;transition:opacity 1.1s;
  color:#f4efe6;text-shadow:0 2px 8px rgba(0,0,0,.85)}
.i2-card.on{opacity:1}
.i2-card b{display:block;font:800 30px/1.1 var(--ps-sans,Inter,sans-serif);letter-spacing:.08em;text-transform:uppercase}
.i2-card small{display:block;margin-top:8px;font:500 17px/1.2 var(--ps-sans,Inter,sans-serif);letter-spacing:.2em;
  text-transform:uppercase;color:#d8cbb8}
`;
export function placeCard(title, sub = '', ms = 4200) {
  if (typeof document === 'undefined') return;
  if (!document.getElementById('i2-card-css')) {
    const st = document.createElement('style');
    st.id = 'i2-card-css';
    st.textContent = CARD_CSS;
    document.head.appendChild(st);
  }
  const el = document.createElement('div');
  el.className = 'i2-card';
  const b = document.createElement('b');
  b.textContent = title;
  el.appendChild(b);
  if (sub) {
    const s = document.createElement('small');
    s.textContent = sub;
    el.appendChild(s);
  }
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('on'));
  setTimeout(() => el.classList.remove('on'), ms);
  setTimeout(() => el.remove(), ms + 1400);
}

// The cut into a flashback: the picture washes out to white over `ms`, holds, and clears again on its own.
export function flashback(ms = 1400, hold = 2200) {
  if (typeof document === 'undefined') return;
  const el = document.createElement('div');
  el.style.cssText =
    'position:fixed;inset:0;z-index:65;pointer-events:none;opacity:0;' +
    `background:radial-gradient(ellipse at center,#fffdf6,#f3ead8);transition:opacity ${ms}ms ease-in`;
  document.body.appendChild(el);
  requestAnimationFrame(() => {
    el.style.opacity = '1';
  });
  setTimeout(() => {
    el.style.transition = 'opacity 900ms ease-out';
    el.style.opacity = '0';
  }, ms + hold);
  setTimeout(() => el.remove(), ms + hold + 1000);
}
