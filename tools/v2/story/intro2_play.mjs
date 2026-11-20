#!/usr/bin/env node
// Intro v2 end-to-end driver: plays the intro missions in order in one game session and auto-completes every step
// (each step's own `auto(ctx)` hook if it has one, else a generic one per trigger type: teleport to a reach spot,
// board the vehicle, press E at an interact spot, down the targets of a killAll, touch every collect ring), skips
// cutscenes after watching a few seconds, and checks for console errors and mission fails.
//
//   node tools/v2/story/intro2_play.mjs                     the whole chain: Restart Story, then Play (14 missions)
//   node tools/v2/story/intro2_play.mjs --from intro2.switchNico [--to intro2.home]
//                                                           skip the missions before --from, play from there
//   --shots           screenshots per cutscene and per step into docs/v2/shots/intro2/ (<mission>_<step>.png)
//   --watch 4         seconds of each cutscene played before it is skipped (default 3; --shots uses 7)
//   --settle 2.5      seconds a step runs before the auto-play acts (default 2)
//   --force 30        seconds a step WITHOUT an auto(ctx) hook may run before the driver calls ctx.next() (reported)
//   --max 2400        hard time limit of the run in seconds
//   --hang 12         minutes the page may stop answering (a software-GL stall) before the run fails
//   --w 1280 --h 720  window size (1600 x 900 with --shots)
// Report: docs/v2/reports/intro2-play[-<tag>].json (missions, steps, fails, console errors, pass / fail).
// macOS has no `timeout`: perl -e 'alarm shift; exec @ARGV' 2400 node tools/v2/story/intro2_play.mjs
import fs from 'node:fs';
import path from 'node:path';
import { withBrowser, GAME_READY, startGame } from '../browser.mjs';

const args = process.argv.slice(2);
const o = {};
for (let i = 0; i < args.length; i++) {
  if (!args[i].startsWith('--')) continue;
  const k = args[i].slice(2);
  o[k] = args[i + 1] && !args[i + 1].startsWith('--') ? args[++i] : true;
}
const SHOTS = !!o.shots;
const WATCH = +(o.watch ?? (SHOTS ? 7 : 3));
const SETTLE = +(o.settle ?? 2);
const HANG_MAX = +(o.hang ?? 12); // ticks of 60 s without an answer before the run counts the page as hung
const FORCE = +(o.force ?? 30); // s a step without an auto hook may run before it is forced
const MAX = +(o.max ?? 2400);
const TAG = o.tag ? '-' + o.tag : '';
const SHOT_DIR = path.resolve('docs/v2/shots/intro2');
const REPORT = path.resolve(`docs/v2/reports/intro2-play${TAG}.json`);
fs.mkdirSync(SHOT_DIR, { recursive: true });
fs.mkdirSync(path.dirname(REPORT), { recursive: true });

// ---------------------------------------------------------------- the in-page driver
const DRIVER = `(() => {
  if (window.__i2) return 'ok';
  const log = [];
  const I = (window.__i2 = { log, stepT: 0, lastKey: '', acted: 0 });
  for (const ev of ['mission:start', 'mission:step', 'mission:pass', 'mission:fail', 'mission:quit', 'cutscene:start', 'cutscene:end']) {
    game.on(ev, (d) => log.push({ ev, t: Math.round(performance.now()), heapMB: Math.round((performance.memory?.usedJSHeapSize || 0) / 1e6), ...(d || {}) }));
  }
  const pos = (ctx, x) => ctx.pos(x);
  function pressE() {
    dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE', key: 'e' }));
    setTimeout(() => dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyE', key: 'e' })), 120);
  }
  function moveVehicle(v, p) {
    try {
      if (v.S && v.S.pos) { v.S.pos.set(p.x, v.S.pos.y, p.z); v.S.vel.set(0, 0, 0); return; }
      const t = v.body.translation();
      v.body.setTranslation({ x: p.x, y: t.y, z: p.z }, true);
      v.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    } catch (e) {}
  }
  // one generic auto action for a step without its own auto()
  function generic(ctx, step) {
    const t = step.trigger;
    const P = game.player;
    if (!t || typeof t === 'function') {
      // no trigger object (an until / a custom check): stay with the step's waypoint (follow the guard, go to the
      // spot); a step that still does not finish is forced after a while (tick below)
      const w = step.waypoint;
      const p = w && w !== false ? pos(ctx, w) : null;
      if (p) {
        if (P.state.inVehicle) game.exitVehicle?.();
        const away = Math.hypot(P.position.x - p.x, P.position.z - p.z);
        if (away > 1.6) game.teleport(p.x + 0.9, p.y ?? null, p.z + 0.9, P.heading);
        return 'follow';
      }
      return t ? 'fn' : 'none';
    }
    if (t.reach) {
      const r = t.reach;
      const p = pos(ctx, r.at ?? r);
      if (!p) return 'reach:nopos';
      if (r.inVehicle) {
        const v = r.inVehicle === true ? P.state.vehicle : ctx.h[r.inVehicle];
        if (v && P.state.inVehicle) { moveVehicle(v, p); return 'reach:vehicle'; }
      }
      if (r.onFoot && P.state.inVehicle) game.exitVehicle?.();
      game.teleport(p.x, p.y ?? null, p.z, p.heading ?? P.heading);
      return 'reach';
    }
    if (t.enterVehicle) {
      const v = typeof t.enterVehicle === 'string' ? ctx.h[t.enterVehicle] : null;
      if (v) game.enterVehicle(v);
      return 'enter';
    }
    if (t.interact) {
      const p = pos(ctx, t.interact.at ?? t.interact);
      if (!p) return 'interact:nopos';
      if (P.state.inVehicle) game.exitVehicle?.();
      game.teleport(p.x + 0.6, p.y ?? null, p.z + 0.6, P.heading);
      setTimeout(pressE, 400);
      return 'interact';
    }
    if (t.killAll) {
      const v = typeof t.killAll === 'function' ? t.killAll(ctx) : ctx.h[t.killAll];
      for (const p of [].concat(v || [])) { if (p) { p.health = 0; p.dead = true; } }
      return 'kill';
    }
    if (t.collect) {
      const items = typeof t.collect.items === 'function' ? t.collect.items(ctx) : t.collect.items;
      const next = items[(I.acted++) % items.length];
      if (P.state.inVehicle) moveVehicle(P.state.vehicle, next);
      else game.teleport(next.x, null, next.z, P.heading);
      return 'collect';
    }
    return 'wait';
  }
  I.tick = (dt, settle, watch, force) => {
    const S = game.story;
    const cs = S.cutscenes.active;
    if (cs) {
      if (cs.t > watch) cs.skipped = true;
      return { cs: cs.id, t: +cs.t.toFixed(1) };
    }
    const r = S.active;
    if (!r) return { idle: true, done: S.state.has('intro.done') };
    if (r.starting || r.ending) return { m: r.def.id, starting: true };
    const step = r.def.steps[r.index] || {};
    const key = r.def.id + '#' + r.index;
    if (key !== I.lastKey) { I.lastKey = key; I.stepT = 0; I.acted = 0; I.age = 0; }
    I.stepT += dt;
    I.age += dt;
    // a step without an auto hook that the generic actions could not finish: force it (reported as forced)
    if (!step.auto && I.age > force) {
      I.age = -1e9;
      I.forced = (I.forced || []).concat(key + ' ' + (step.id || ''));
      try { r.ctx.next(); } catch (e) {}
      return { m: r.def.id, i: r.index, step: step.id || null, did: 'forced' };
    }
    let did = 'settle';
    if (I.stepT >= settle) {
      try { did = step.auto ? (step.auto(r.ctx), 'auto') : generic(r.ctx, step); }
      catch (e) { did = 'autoErr ' + e; }
      I.stepT = settle - 1.2; // act again in a little while if the step is still running
    }
    return { m: r.def.id, i: r.index, step: step.id || null, text: step.text || null, did };
  };
  return 'installed';
})()`;

// a CDP call that never answers (a hung page) must not hang the run
function withTimeout(promise, ms, label) {
  let timer = null;
  const late = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label}: no answer in ${ms / 1000} s`)), ms);
  });
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

// the JS stack of a page that stopped answering (CDP Debugger.pause)
async function pausedStack(b) {
  let got = null;
  b.on((method, params) => {
    if (method === 'Debugger.paused' && !got) {
      got = (params.callFrames || []).slice(0, 14).map((f) => {
        const url = String(f.url || '')
          .split('/')
          .slice(-2)
          .join('/')
          .replace(/\?.*$/, '');
        return `${f.functionName || '(anon)'} ${url}:${f.location.lineNumber + 1}`;
      });
    }
  });
  try {
    await withTimeout(b.send('Debugger.enable'), 20000, 'debugger');
    await withTimeout(b.send('Debugger.pause'), 20000, 'pause');
    for (let i = 0; i < 40 && !got; i++) await b.sleep(250);
    await withTimeout(b.send('Debugger.resume'), 20000, 'resume').catch(() => null);
  } catch (e) {
    return ['no stack: ' + e];
  }
  return got || ['no paused event'];
}

const report = {
  when: new Date().toISOString(),
  args: o,
  missions: {},
  fails: [],
  errors: [],
  shots: [],
  ok: false,
};

const W = +(o.w ?? (SHOTS ? 1600 : 1280));
const H = +(o.h ?? (SHOTS ? 900 : 720));
await withBrowser({ width: W, height: H, maxSeconds: MAX + 300 }, async (b) => {
  const T0 = Date.now();
  const lg = (m) => console.log(`[${Math.round((Date.now() - T0) / 1000)}s] ${m}`);
  await b.goto('http://127.0.0.1:5200/?mute&intro=1');
  await b.waitFor(GAME_READY, 600);
  await startGame(b);
  lg('game started');
  b.errors.length = 0;
  await b.eval(DRIVER);
  // a renderer that dies (out of memory) never answers again: notice it
  let crashed = false;
  b.on((method) => {
    if (method === 'Inspector.targetCrashed') {
      crashed = true;
      lg('RENDERER CRASHED');
    }
  });
  await b.send('Inspector.enable').catch(() => null);
  // the start: a fresh story (Restart Story + Play) or the missions before --from skipped
  if (o.from) {
    await b.eval(`(async () => {
      game.story.quitMission();
      game.story.state.reset();
      const ids = game.story.intro;
      for (const id of ids) { if (id === ${JSON.stringify(o.from)}) break; await game.story.skipMission(id, { save: false, teleport: false }); }
      game.story.startMission(${JSON.stringify(o.from)}, { from: 'play' });
      return 1;
    })()`);
  } else {
    await b.eval(
      `(async () => { await game.story.restartStory({ save: false }); game.story.beginPlay(); return 1; })()`,
    );
  }
  lg('story started from ' + (o.from || 'the beginning'));
  const seen = new Set();
  let last = '';
  let idleT = 0;
  let hung = 0;
  for (;;) {
    if ((Date.now() - T0) / 1000 > MAX) {
      lg('time limit');
      break;
    }
    await b.sleep(700);
    let st;
    try {
      st = await withTimeout(
        b.eval(`JSON.stringify(window.__i2.tick(0.7, ${SETTLE}, ${WATCH}, ${FORCE}))`, 30000),
        60000,
        'tick',
      );
      st = JSON.parse(st);
      hung = 0;
    } catch (e) {
      lg('tick failed ' + e);
      // where is the page stuck? pause the debugger and keep the JS stack
      if (hung === 0) {
        const stack = await pausedStack(b);
        report.hang = stack;
        lg('hang stack: ' + JSON.stringify(stack).slice(0, 1500));
      }
      // a software-GL test browser can stall for minutes on a big teleport (shader compiles for a whole new area):
      // wait it out, fail only when it never comes back
      if (crashed) {
        report.fails.push({ id: 'page', reason: 'the renderer crashed (out of memory?)' });
        break;
      }
      if (++hung >= HANG_MAX) {
        report.fails.push({ id: 'page', reason: 'the page stopped answering' });
        break;
      }
      continue;
    }
    const line = JSON.stringify(st);
    if (line !== last) {
      lg(line);
      last = line;
    }
    // screenshots: each cutscene once (a couple of seconds in), each step once (after it settled)
    if (SHOTS) {
      if (st.cs && st.t > 2.2 && !seen.has(st.cs)) {
        seen.add(st.cs);
        const f = path.join(SHOT_DIR, `${st.cs.replace(/[^\w.-]/g, '_')}.png`);
        await withTimeout(b.screenshot(f), 60000, 'screenshot').catch((e) => lg(String(e)));
        report.shots.push(path.relative(process.cwd(), f));
      }
      if (st.cs && st.t > WATCH - 1.2 && !seen.has(st.cs + ':late')) {
        seen.add(st.cs + ':late');
        const f = path.join(SHOT_DIR, `${st.cs.replace(/[^\w.-]/g, '_')}_b.png`);
        await withTimeout(b.screenshot(f), 60000, 'screenshot').catch((e) => lg(String(e)));
        report.shots.push(path.relative(process.cwd(), f));
      }
      if (st.m && st.step && st.did === 'settle' && !seen.has(st.m + st.i)) {
        seen.add(st.m + st.i);
        await b.sleep(900);
        const f = path.join(SHOT_DIR, `${st.m}_${st.i}_${st.step}.png`);
        await withTimeout(b.screenshot(f), 60000, 'screenshot').catch((e) => lg(String(e)));
        report.shots.push(path.relative(process.cwd(), f));
      }
    }
    if (st.idle) {
      idleT += 0.7;
      if (st.done) {
        lg('intro done');
        break;
      }
      if (idleT > 25) {
        lg('nothing running for 25 s');
        break;
      }
    } else idleT = 0;
    if (o.to && st.m && report.missions[o.to]?.passed) break;
    // mission log
    let evs = [];
    try {
      evs = JSON.parse(
        await withTimeout(b.eval(`JSON.stringify(window.__i2.log.splice(0))`), 60000, 'log'),
      );
    } catch (e) {
      lg(String(e));
    }
    for (const e of evs) {
      const m = (report.missions[e.id] ||= { steps: [], passed: false, fails: 0 });
      if (e.ev === 'mission:start') {
        m.start = e.t;
        m.heapMB = e.heapMB;
        lg(`START ${e.id} heap ${e.heapMB} MB`);
      }
      if (e.ev === 'mission:step') m.steps.push(e.name ?? e.step);
      if (e.ev === 'mission:pass') {
        m.passed = true;
        m.ms = e.t - (m.start || e.t);
        lg('PASS ' + e.id);
      }
      if (e.ev === 'mission:fail') {
        m.fails++;
        report.fails.push({ id: e.id, reason: e.reason });
        lg('FAIL ' + e.id + ' ' + e.reason);
      }
    }
    if (report.fails.length) break;
  }
  const state = JSON.parse(
    await b.eval(
      `JSON.stringify({ forced: window.__i2.forced || [], done: game.story.state.has('intro.done'), freeRoam: game.story.state.isUnlocked('freeRoam'), finished: Object.keys(game.story.state.done), locked: game.characters?.locked, active: game.characters?.active?.id })`,
    ),
  );
  report.state = state;
  report.errors = [...new Set(b.errors)]
    .filter((e) => !/favicon|\[HMR\]|\[vite\]/.test(e))
    .slice(0, 80);
  const expected = o.to ? null : JSON.parse(await b.eval(`JSON.stringify(game.story.intro)`));
  const all = expected ? expected.every((id) => report.missions[id]?.passed) : true;
  report.ok =
    !report.fails.length &&
    !report.errors.some((e) => e.startsWith('ERR')) &&
    all &&
    (o.to ? report.missions[o.to]?.passed : state.done);
  report.seconds = Math.round((Date.now() - T0) / 1000);
});

fs.writeFileSync(REPORT, JSON.stringify(report, null, 1));
console.log(
  `${report.ok ? 'OK' : 'NOT OK'}: ${Object.entries(report.missions)
    .map(([id, m]) => `${id} ${m.passed ? 'pass' : 'no'}`)
    .join(', ')}`,
);
console.log(
  'fails',
  report.fails,
  'errors',
  report.errors.length,
  '->',
  path.relative(process.cwd(), REPORT),
);
process.exit(report.ok ? 0 : 1);
