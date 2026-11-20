// Mission runner: missions are data plus small step functions (see README.md for the format and a full example).
//
//   defineMission({ id, title, giver, start: { marker, at }, requires, steps: [...], rewards, flags, end,
//                   setup, onPass, onFail, apply, fail })
//
// One mission runs at a time. Each step shows its objective text and waypoint (map blip, minimap, GPS route and a ground
// ring), runs its `enter` (and `cutscene`), then waits for its trigger while the fail conditions are watched. A step
// with `checkpoint` is where Retry restarts. Pass: fade, cleanup, rewards, "Mission Passed" card with the sting and the
// payout, autosave. Fail: "Mission Failed" with Retry (from the last checkpoint) or Quit. skip(id) applies exactly
// what a pass applies (flags, unlocks, money, items) and puts the player at the mission's end position.
import { getCinema } from '../ui/menu/cinema.js';
import { help, makeMarker, removeMarker, spawnKitPed, pedOut, release, fmt } from '../jobs/kit.js';
import { pill } from '../activities/common.js';
import { createObjectiveMarker } from './markers.js';
import { showBanner, showFailScreen, subtitle } from './ui.js';
import { loadMissionProp } from './props.js';

const DEFAULT_FAIL = { died: true, arrested: true };
const REASONS = {
  died: 'You died.',
  arrested: 'You were arrested.',
  vehicleDestroyed: 'The vehicle was destroyed.',
  escaped: 'The target got away.',
  leftArea: 'You left the area.',
  timer: 'You ran out of time.',
};

// ---------------------------------------------------------------- definition (pure: no game needed)
export function defineMission(def) {
  if (!def || typeof def.id !== 'string' || !def.id)
    throw new Error('defineMission: id is required');
  if (!Array.isArray(def.steps) || !def.steps.length)
    throw new Error(`defineMission('${def.id}'): steps must be a non-empty array`);
  def.steps.forEach((s, i) => {
    if (!s || typeof s !== 'object')
      throw new Error(`defineMission('${def.id}'): step ${i} must be an object`);
  });
  return {
    title: def.id,
    giver: '',
    start: {},
    rewards: {},
    flags: {},
    ...def,
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// E taps are latched for 0.4 s: a tap shorter than one frame (low frame rates, a loading hitch) still counts.
// The bindings layer re-sends re-bound keys and the pad's X as KeyE, so this sees those too.
let interactAt = -1e9;
if (typeof addEventListener === 'function') {
  addEventListener('keydown', (e) => {
    if (e.code === 'KeyE' && !e.repeat) interactAt = performance.now();
  });
}
function interactPressed(game) {
  if (game.input?.pressed?.('KeyE') || performance.now() - interactAt < 400) {
    interactAt = -1e9;
    return true;
  }
  return false;
}

export function createRunner(game, story) {
  const P = game.player;
  const missions = new Map();
  const waypoint = createObjectiveMarker(game);
  let run = null; // the running mission (see start)
  let token = 0; // bumped to abort a running step chain

  // ---------------------------------------------------------------- positions
  function posOf(ctx, x) {
    if (!x) return null;
    if (typeof x === 'function') return posOf(ctx, x(ctx));
    if (typeof x === 'string') return posOf(ctx, ctx.h[x]);
    if (x.isVector3) return x;
    if (x.isObject3D && !x.root) return x.position; // a prop
    if (x.root?.position) return x.root.position; // staged actor
    if (x.body?.translation) {
      try {
        return x.body.translation(); // vehicle
      } catch (e) {
        return null;
      }
    }
    if (x.pos?.isVector3) return x.pos; // crowd ped
    if (x.mesh?.position) return x.mesh.position;
    if (Number.isFinite(x.x) && Number.isFinite(x.z)) return x;
    return null;
  }

  function distTo(ctx, x) {
    const p = posOf(ctx, x);
    if (!p) return Infinity;
    const pp = P.position;
    return Math.hypot(pp.x - p.x, pp.z - p.z);
  }

  function teleportTo(at) {
    if (!at) return;
    try {
      game.teleport(at.x, at.y ?? null, at.z, at.heading);
    } catch (e) {
      console.warn('[story] teleport', e);
    }
  }

  function resolveAt(at) {
    return typeof at === 'function' ? at(game) : at;
  }

  // ---------------------------------------------------------------- mission context (what step functions get)
  function makeContext(def) {
    const tracked = [];
    const ctx = {
      game,
      story,
      state: story.state,
      mission: def,
      data: {}, // scratch for the mission's own step functions (fresh on every retry)
      h: {}, // named handles: vehicles, actors, peds (strings in triggers / fail rules refer to these)
      step: 0,
      pos: (x) => posOf(ctx, x),
      dist: (x) => distTo(ctx, x),
      objective: (text) => game.hud?.setMission?.(text || null),
      say: (who, text, ms = 3200) => subtitle(who, text, ms),
      notify: (text, ms = 3200) => game.hud?.notify?.(text, ms),
      help: (text) => help(game, 'story', text),
      wait: (sec) => sleep(sec * 1000),
      // remember something to clean up; keepOnPass leaves it in the world after a pass
      track(obj, dispose, opts = {}) {
        tracked.push({ obj, dispose, keepOnPass: !!opts.keepOnPass });
        return obj;
      },
      async spawnVehicle(name, key, at, opts = {}) {
        const p = resolveAt(at);
        const v = await game.vehicles?.spawnParked?.(key, {
          x: p.x,
          z: p.z,
          heading: p.heading || 0,
          color: opts.color,
          wear: opts.wear,
          keepSpot: true,
          locked: false,
        });
        if (!v) return null;
        ctx.h[name] = v;
        ctx.track(v, () => removeVehicle(v), { keepOnPass: opts.keepOnPass ?? true });
        return v;
      },
      spawnActor(name, o = {}) {
        const p = resolveAt(o.at);
        const y = p.y ?? game.city?.groundHeightAt?.(p.x, p.z) ?? 0;
        const a = game.npc?.spawnPosed?.({
          person: o.person,
          place: o.place,
          pos: { x: p.x, y, z: p.z },
          rot: p.heading || 0,
          pose: o.pose || 'idle',
          seed: o.seed,
        });
        if (!a) return null;
        ctx.h[name] = a;
        ctx.track(a, () => a.remove(), { keepOnPass: o.keepOnPass });
        return a;
      },
      // a person from the crowd system, dressed in a kit (src/jobs/kit.js applyKit); list handles collect several
      spawnPed(name, o = {}) {
        const p = resolveAt(o.at);
        const kit = o.kit || { top: [0x333333], bottom: [0x222222], shoes: [0x111111] };
        const ped = spawnKitPed(game, p, kit, o.seed ?? Math.floor(Math.random() * 999), {
          tag: o.tag || { story: def.id, gang: !!o.gang },
          health: o.health,
        });
        if (!ped) return null;
        if (o.list) {
          ctx.h[name] = ctx.h[name] || [];
          ctx.h[name].push(ped);
        } else ctx.h[name] = ped;
        ctx.track(ped, () => release(ped));
        return ped;
      },
      // a boat from game.boatSystem ('console' motorboat, 'skiff', 'racer', 'cruiser', 'jetski', 'police')
      spawnBoat(name, key, at, opts = {}) {
        const p = resolveAt(at);
        const b = game.boatSystem?.spawn?.(key, { x: p.x, z: p.z }, p.heading || 0, opts);
        if (!b) return null;
        ctx.h[name] = b;
        ctx.track(b, () => removeBoat(b), { keepOnPass: opts.keepOnPass ?? true });
        return b;
      },
      // an aircraft from game.air ('floatplane', 'prop', 'bizjet'); y defaults to the sea for a floatplane
      spawnAircraft(name, type, at, opts = {}) {
        const p = resolveAt(at);
        const y = p.y ?? game.city?.seaLevel ?? -0.12;
        const a = game.air?.spawn?.(type, { x: p.x, y, z: p.z }, p.heading || 0, opts);
        if (!a) return null;
        ctx.h[name] = a;
        ctx.track(a, () => game.air?.remove?.(a), { keepOnPass: opts.keepOnPass ?? true });
        return a;
      },
      // a mission prop (src/story/props.js, public/assets/models/mission/manifest.json) on the ground at `at`
      async spawnProp(name, id, at, opts = {}) {
        const p = resolveAt(at);
        let obj = null;
        try {
          obj = await loadMissionProp(id, { lod: !!opts.lod });
        } catch (e) {
          console.warn('[story] prop', id, e);
          return null;
        }
        const y = p.y ?? game.city?.groundHeightAt?.(p.x, p.z) ?? 0;
        obj.position.set(p.x, y + (opts.lift || 0), p.z);
        obj.rotation.y = p.heading || 0;
        if (opts.scale) obj.scale.setScalar(opts.scale);
        game.scene.add(obj);
        ctx.h[name] = obj;
        ctx.track(obj, () => game.scene.remove(obj), { keepOnPass: opts.keepOnPass });
        return obj;
      },
      async cutscene(csDef, opts = {}) {
        const cs = typeof csDef === 'function' ? csDef(ctx) : csDef;
        const r = await story.playCutscene(cs, { handles: ctx.h, ...opts });
        // the scene's vehicles and kept actors become mission handles (cleaned up like the rest)
        for (const [name, v] of Object.entries(r.vehicles || {})) {
          ctx.h[name] = v;
          ctx.track(v, () => removeVehicle(v), { keepOnPass: true });
        }
        for (const name of cs.end?.keep || []) {
          const a = r.actors?.[name];
          if (!a) continue;
          ctx.h[name] = a;
          ctx.track(a, () => a.remove());
        }
        return r;
      },
      next: () => run?.ctx === ctx && run.resolveStep?.(),
      pass: () => run?.ctx === ctx && pass(),
      fail: (reason) => run?.ctx === ctx && fail(reason),
    };
    ctx._cleanup = (passed) => {
      for (const t of tracked.splice(0)) {
        if (passed && t.keepOnPass) continue;
        try {
          t.dispose?.(t.obj);
        } catch (e) {
          console.warn('[story] cleanup', e);
        }
      }
    };
    return ctx;
  }

  function removeBoat(b) {
    if (P.state?.inVehicle && P.state.vehicle === b) game.exitVehicle?.();
    game.boatSystem?.remove?.(b);
  }

  function removeVehicle(v) {
    if (!v || v.disposed) return;
    if (P.state?.inVehicle && P.state.vehicle === v) game.exitVehicle?.();
    game.vehicles?.remove?.(v, { force: true });
  }

  // ---------------------------------------------------------------- triggers
  // A step trigger becomes { check(ctx, dt) -> bool, target, label, cleanup }.
  function buildTrigger(ctx, step) {
    const t = step.trigger;
    if (!t) return null;
    if (typeof t === 'function') return { check: t };
    if (t.reach) return reachTrigger(ctx, t.reach);
    if (t.enterVehicle) return enterVehicleTrigger(ctx, t.enterVehicle);
    if (t.interact) return interactTrigger(ctx, t.interact);
    if (t.killAll) return killAllTrigger(ctx, t.killAll);
    if (t.collect) return collectTrigger(ctx, step, t.collect);
    if (t.timer) return timerTrigger(ctx, t.timer, true);
    if (t.wait) return timerTrigger(ctx, t.wait, false);
    console.warn('[story] unknown trigger', t);
    return null;
  }

  function reachTrigger(ctx, r) {
    const radius = r.r ?? 5;
    const at = r.at ?? r;
    return {
      target: at,
      check() {
        if (ctx.dist(at) > radius) return false;
        const st = P.state || {};
        if (r.onFoot && st.inVehicle) {
          ctx.help('Get out of the vehicle');
          return false;
        }
        if (r.inVehicle) {
          const want = r.inVehicle === true ? null : ctx.h[r.inVehicle];
          if (!st.inVehicle || (want && st.vehicle !== want)) {
            ctx.help(r.inVehicle === true ? 'You need a vehicle' : 'Bring the vehicle here');
            return false;
          }
        }
        ctx.help(null);
        return true;
      },
      cleanup: () => ctx.help(null),
    };
  }

  function enterVehicleTrigger(ctx, which) {
    return {
      target: typeof which === 'string' ? () => posOf(ctx, which) : null,
      check() {
        const st = P.state || {};
        if (!st.inVehicle) return false;
        if (which === true) return true;
        if (typeof which === 'function') return !!which(st.vehicle, ctx);
        return st.vehicle === ctx.h[which];
      },
    };
  }

  function interactTrigger(ctx, it) {
    const radius = it.r ?? 2.2;
    const at = it.at ?? it;
    const label = it.label || 'interact';
    let shown = false;
    return {
      target: at,
      check() {
        const near = ctx.dist(at) <= radius && !P.state?.inVehicle;
        if (near !== shown) {
          shown = near;
          ctx.help(near ? `Press [E] to ${label}` : null);
        }
        return near && interactPressed(game);
      },
      cleanup: () => ctx.help(null),
    };
  }

  function killAllTrigger(ctx, who) {
    const list = () => {
      const v = typeof who === 'function' ? who(ctx) : ctx.h[who];
      return Array.isArray(v) ? v : v ? [v] : [];
    };
    return {
      check: () => list().every((p) => pedOut(p) || p.dead || (p.health ?? 100) <= 0),
    };
  }

  function collectTrigger(ctx, step, c) {
    const items = (typeof c.items === 'function' ? c.items(ctx) : c.items).map((p) => ({
      p,
      got: false,
      ring: makeMarker(game, p, 0x7dffb0, { radius: c.r ?? 1.4 }),
    }));
    const need = c.n ?? items.length;
    let got = 0;
    const text = step.text || 'Collect the items';
    ctx.objective(`${text} (0/${need})`);
    return {
      check() {
        for (const it of items) {
          if (it.got || ctx.dist(it.p) > (c.r ?? 1.8)) continue;
          it.got = true;
          got++;
          removeMarker(game, it.ring);
          it.ring = null;
          ctx.objective(`${text} (${got}/${need})`);
          c.onCollect?.(ctx, it.p, got);
        }
        return got >= need;
      },
      cleanup() {
        for (const it of items) removeMarker(game, it.ring);
      },
    };
  }

  function timerTrigger(ctx, seconds, showPill) {
    let left = seconds;
    return {
      check(_, dt) {
        left -= dt;
        if (showPill) pill('story-timer', clock(Math.max(0, left)));
        return left <= 0;
      },
      cleanup: () => pill('story-timer', null),
    };
  }

  const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

  // ---------------------------------------------------------------- fail conditions
  // mission-level `fail` + step-level `fail` (step wins); returns a reason string or null
  function checkFail(ctx, rules, dt) {
    const ui = game.ui || {};
    if (rules.died && (ui.dead || P.health <= 0)) return text(rules.died, REASONS.died);
    if (rules.arrested && ui.arrested) return text(rules.arrested, REASONS.arrested);
    if (rules.vehicleDestroyed) {
      for (const name of [].concat(rules.vehicleDestroyed)) {
        const v = ctx.h[name];
        if (v && (v.health <= 0 || v.disposed || v.alive === false || v.sunk))
          return REASONS.vehicleDestroyed;
      }
    }
    if (rules.protect) {
      for (const name of [].concat(rules.protect)) {
        const p = ctx.h[name];
        if (p && (p.dead || (p.health ?? 100) <= 0)) return `${capital(name)} died.`;
      }
    }
    if (rules.escaped) {
      const e = rules.escaped;
      if (ctx.dist(e.target) > (e.dist ?? 200)) return text(e.text, REASONS.escaped);
    }
    if (rules.leftArea) {
      // { at, r }: at is a point, a handle name or a function (ctx) => point; { x, z, r } also works
      const a = rules.leftArea;
      const d = ctx.dist(a.at ?? a);
      pill('story-area', d > a.r * 0.8 ? 'Go back to the area' : null, true);
      if (d > a.r) return text(a.text, REASONS.leftArea);
    }
    if (rules.timer) {
      run.failTimer = (run.failTimer ?? rules.timer) - dt;
      pill('story-timer', clock(Math.max(0, run.failTimer)), run.failTimer < 10);
      if (run.failTimer <= 0) return REASONS.timer;
    }
    if (typeof rules.custom === 'function') {
      const r = rules.custom(ctx);
      if (r) return typeof r === 'string' ? r : 'Mission failed.';
    }
    return null;
  }
  const text = (v, fallback) => (typeof v === 'string' ? v : fallback);
  const capital = (s) => String(s).charAt(0).toUpperCase() + String(s).slice(1);

  // ---------------------------------------------------------------- start / run
  async function start(id, opts = {}) {
    const def = missions.get(id);
    if (!def) {
      console.warn('[story] no mission', id);
      return false;
    }
    if (run || story.cutscenes.active) return false;
    const cp = opts.checkpoint ?? 0;
    const ctx = makeContext(def);
    run = {
      def,
      ctx,
      index: cp,
      checkpoint: cp,
      from: opts.from || 'code',
      starting: true, // no fail checks until the player stands where this attempt begins
      ending: false,
      startPos: opts.startPos || { x: P.position.x, z: P.position.z, heading: P.heading },
    };
    const myToken = ++token;
    story.state.resume = { id, checkpoint: cp };
    game.save?.inhibit?.('story');
    story.markers.refresh();
    if (!opts.retry) game.emit?.('mission:start', { id, replay: story.state.isDone(id) });

    const cin = getCinema(game);
    await cin.black(true, opts.retry ? 10 : 500);
    if (myToken !== token) return false;
    // where this attempt begins: the checkpoint's spot, the mission start on a retry, or where he stands
    const cpStep = def.steps[cp];
    if (cp > 0 && cpStep?.checkpoint?.at) teleportTo(resolveAt(cpStep.checkpoint.at));
    else if (opts.retry || def.start?.teleport)
      teleportTo(resolveAt(def.start?.at) || run.startPos);
    try {
      await def.setup?.(ctx, cp);
      if (cp > 0) await cpStep?.checkpoint?.restore?.(ctx);
    } catch (e) {
      console.error('[story] setup', e);
    }
    if (myToken !== token) return false;
    await sleep(250);
    cin.black(false, 600);
    showBanner(def.title, def.giver || 'Mission');
    run.starting = false;
    runSteps(cp, myToken);
    return true;
  }

  async function runSteps(from, myToken) {
    const { def, ctx } = run;
    for (let i = from; i < def.steps.length; i++) {
      if (myToken !== token) return;
      const step = def.steps[i];
      run.index = i;
      ctx.step = i;
      if (step.checkpoint && i > run.checkpoint) {
        run.checkpoint = i;
        story.state.resume = { id: def.id, checkpoint: i };
      }
      game.emit?.('mission:step', { id: def.id, step: i, name: step.id || null });
      if (step.text) ctx.objective(step.text);
      try {
        await step.enter?.(ctx);
        if (myToken !== token) return;
        if (step.cutscene) {
          run.inCutscene = true;
          await ctx.cutscene(step.cutscene);
          run.inCutscene = false;
          if (step.text) ctx.objective(step.text);
        }
      } catch (e) {
        console.error(`[story] ${def.id} step ${i} enter`, e);
      }
      if (myToken !== token) return;
      run.trigger = buildTrigger(ctx, step);
      const target = step.waypoint === false ? null : (step.waypoint ?? run.trigger?.target);
      if (target) {
        // handles (a car, a man) and functions are followed every frame; a handle gets no ground ring
        const moving = typeof target === 'string' || typeof target === 'function';
        waypoint.set(moving ? () => posOf(ctx, target) : target, {
          label: step.text,
          ring: typeof target !== 'string',
          radius: step.trigger?.interact ? 1.2 : 2.2,
          // gps: false = blip and ring only, no road route (on foot in a swamp, in the air)
          gps: step.gps,
        });
      }
      if (run.trigger || step.until) {
        await new Promise((resolve) => {
          run.resolveStep = resolve;
        });
      }
      if (myToken !== token) return;
      endStep(step);
    }
    if (myToken === token) pass();
  }

  function endStep(step) {
    try {
      run.trigger?.cleanup?.();
      step.exit?.(run.ctx);
    } catch (e) {
      console.error('[story] step exit', e);
    }
    run.trigger = null;
    run.resolveStep = null;
    waypoint.clear();
    pill('story-area', null);
    pill('story-timer', null);
  }

  // every frame (index.js): fail rules, the current trigger, moving waypoints
  function update(dt) {
    if (!run || run.starting || run.ending || run.inCutscene || story.cutscenes.active) return;
    if (game.ui?.paused) return;
    const { def, ctx } = run;
    const step = def.steps[run.index] || {};
    const rules = { ...DEFAULT_FAIL, ...(def.fail || {}), ...(step.fail || {}) };
    const reason = checkFail(ctx, rules, dt);
    if (reason) {
      fail(reason);
      return;
    }
    try {
      step.onTick?.(ctx, dt);
      if (run.trigger?.check(ctx, dt)) run.resolveStep?.();
      else if (step.until?.(ctx, dt)) run.resolveStep?.();
    } catch (e) {
      console.error('[story] trigger', e);
    }
    waypoint.update(dt);
  }

  // ---------------------------------------------------------------- end of a run
  function stopRun() {
    token++;
    const r = run;
    if (!r) return null;
    r.ending = true;
    try {
      r.trigger?.cleanup?.();
    } catch (e) {
      /* */
    }
    waypoint.clear();
    pill('story-area', null);
    pill('story-timer', null);
    help(game, 'story', null);
    game.hud?.setMission?.(null);
    return r;
  }

  async function pass() {
    const r = stopRun();
    if (!r) return;
    const { def, ctx } = r;
    const cin = getCinema(game);
    await cin.black(true, 400);
    ctx._cleanup(true);
    const grant = applyOutcome(def, 'pass');
    try {
      def.onPass?.(ctx);
    } catch (e) {
      console.error('[story] onPass', e);
    }
    finishRun();
    await sleep(200);
    cin.black(false, 700);
    const money = grant.money ? ` · <b>+${fmt(grant.money)}</b>` : '';
    if (game.passed?.play)
      game.passed.play({ title: 'Mission Passed', sub: `${def.title}${money}` });
    else game.hud?.notify?.(`Mission Passed: ${def.title}`, 4000);
    game.emit?.('mission:pass', { id: def.id, money: grant.money, items: grant.items });
    await autosave(`mission:${def.id}`);
  }

  async function fail(reason) {
    const r = stopRun();
    if (!r) return;
    const { def, ctx } = r;
    game.emit?.('mission:fail', { id: def.id, reason });
    try {
      def.onFail?.(ctx, reason);
    } catch (e) {
      console.error('[story] onFail', e);
    }
    // let the death / arrest sequence play out first (hospital or station respawn)
    for (let i = 0; i < 200 && (game.ui?.dead || game.ui?.arrested); i++) await sleep(100);
    await sleep(600);
    ctx._cleanup(false);
    const choice = await showFailScreen(game, { reason, canRetry: def.retry !== false });
    const cp = r.checkpoint;
    finishRun();
    if (choice === 'retry') {
      start(def.id, { checkpoint: cp, retry: true, startPos: r.startPos, from: r.from });
    } else {
      story.markers.latch(def.id);
      game.emit?.('mission:quit', { id: def.id });
    }
  }

  function finishRun() {
    run = null;
    story.state.resume = null;
    game.save?.release?.('story');
    story.markers.refresh();
  }

  // Leave the running mission at once (no fail screen): Free Roam, Restart Story, a dev command.
  function quit() {
    const r = stopRun();
    if (!r) return false;
    r.ctx._cleanup(false);
    finishRun();
    game.emit?.('mission:quit', { id: r.def.id });
    return true;
  }

  // ---------------------------------------------------------------- outcome (shared by pass and skip)
  function applyOutcome(def, how) {
    const S = story.state;
    const first = !S.granted[def.id];
    const rw = def.rewards || {};
    const grant = { money: 0, items: [] };
    if (first || def.repeatPays) {
      if (rw.money > 0) {
        game.wallet?.earn?.(rw.money, {
          category: 'mission',
          memo: def.title,
          from: def.giver || 'Mission',
        });
        grant.money = rw.money;
      }
      for (const it of rw.items || []) {
        const r = game.inventory?.add?.(it.id, { qty: it.qty || 1 });
        if (r && r.ok === false) console.warn('[story] item not given', it.id, r.reason);
        else grant.items.push({ id: it.id, qty: it.qty || 1 });
      }
      S.recordGrant(def.id, grant);
    }
    for (const u of rw.unlocks || []) S.unlock(u);
    S.setMany(def.flags || {});
    S.set(`${def.id}.done`, true);
    S.markDone(def.id);
    try {
      def.apply?.(story, how);
    } catch (e) {
      console.error('[story] apply', e);
    }
    return grant;
  }

  // Mark a mission complete without playing it. Unknown ids (missions not written yet) still get their done flag, so
  // Free Roam can skip the intro before every intro mission exists.
  async function skip(id, opts = {}) {
    const def = missions.get(id);
    if (story.state.isDone(id) && !opts.force) return false;
    if (run?.def.id === id) quit();
    if (!def) {
      story.state.set(`${id}.done`, true);
      story.state.markDone(id);
      return true;
    }
    applyOutcome(def, 'skip');
    if (opts.teleport !== false && def.end?.at) teleportTo(resolveAt(def.end.at));
    story.markers.refresh();
    game.emit?.('mission:skip', { id });
    if (opts.save !== false) await autosave(`skip:${id}`);
    return true;
  }

  async function autosave(reason) {
    try {
      return await game.save?.save?.({ kind: 'auto', reason });
    } catch (e) {
      console.warn('[story] autosave', e);
      return null;
    }
  }

  function register(def) {
    const d = def.steps && def.title !== undefined && def.rewards ? def : defineMission(def);
    missions.set(d.id, d);
    story.markers?.refresh?.();
    return d;
  }

  return {
    missions,
    register,
    start,
    skip,
    quit,
    update,
    autosave,
    get active() {
      return run;
    },
  };
}
