#!/usr/bin/env node
// Streaming step profiler (Nov 19): teleports to a spot, CPU-profiles the arrival for N seconds and reports which
// functions take the time inside the streamer's job steps (inclusive ms under runJobs), plus the streamer's own
// step stats (max step per kind, long-step histogram, the longest steps).
//   node tools/v2/perf/streamprof.mjs [--url http://127.0.0.1:5200] [--at 407,-110] [--secs 20] [--q "&foo=1"]
import { withBrowser, GAME_READY, startGame } from '../browser.mjs';

const argv = process.argv.slice(2);
const o = {};
for (let i = 0; i < argv.length; i++) {
  if (argv[i].startsWith('--')) {
    const k = argv[i].slice(2);
    o[k] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
  }
}
const BASE = o.url || 'http://127.0.0.1:5200';
const SECS = +(o.secs || 20);
const [AX, AZ] = String(o.at || '407,-110')
  .split(',')
  .map(Number);

// inclusive time per function name for samples whose stack contains `root`
function attribute(prof, root) {
  const byId = new Map(prof.nodes.map((n) => [n.id, n]));
  const parent = new Map();
  for (const n of prof.nodes) for (const c of n.children || []) parent.set(c, n.id);
  const incl = new Map();
  for (let i = 0; i < prof.samples.length; i++) {
    const dt = (prof.timeDeltas[i] || 0) / 1000;
    const chain = [];
    let id = prof.samples[i];
    let under = false;
    while (id !== undefined) {
      const n = byId.get(id);
      const cf = n.callFrame;
      const name = `${cf.functionName || '(anon)'} ${cf.url.split('/').pop().split('?')[0]}:${cf.lineNumber + 1}`;
      chain.push(name);
      if (cf.functionName === root) under = true;
      id = parent.get(id);
    }
    if (!under) continue;
    for (const name of new Set(chain)) incl.set(name, (incl.get(name) || 0) + dt);
  }
  return [...incl].sort((a, b) => b[1] - a[1]);
}

await withBrowser({ width: 1280, height: 720, maxSeconds: 600 }, async (b) => {
  await b.goto(BASE + '/?mute' + (o.q || ''));
  await b.waitFor(GAME_READY + " && typeof game.teleport === 'function'", 600);
  await startGame(b);
  await b.sleep(3000);
  await b.eval(
    `(() => { const s = game.city.streamer.stats; s.maxStep = { near: 0, mid: 0, far: 0, col: 0 }; s.longSteps = {}; s.longList = []; s.msByKind = {}; return 1; })()`,
  );
  await b.send('Profiler.enable');
  await b.send('Profiler.setSamplingInterval', { interval: 200 });
  await b.send('Profiler.start');
  await b.eval(`(game.teleport(${AX}, undefined, ${AZ}), 1)`);
  await b.sleep(SECS * 1000);
  const prof = (await b.send('Profiler.stop')).result.profile;
  const st = await b.eval(
    `JSON.stringify((() => { const s = game.city.streamer.stats; return { maxStep: s.maxStep, longSteps: s.longSteps, msByKind: s.msByKind, queued: s.queued, longest: (s.longList || []).map((l) => [l[0], l[2] - l[1], l[3], l[4]]).sort((a, b) => b[1] - a[1]).slice(0, 12) }; })())`,
  );
  console.log('stream', st);
  const top = attribute(prof, 'runJobs');
  console.log('inclusive ms under runJobs (top 45):');
  for (const [name, ms] of top.slice(0, 45)) console.log(String(Math.round(ms)).padStart(7), name);
});
