#!/usr/bin/env node
// Leak drive in the desktop app (Nov 19, after the 24-minute renderer crash). Runs unpackaged Electron (desktop/app) on a
// web build folder, drives it over the DevTools protocol (no browser slot: this is the app itself) and tours the map by
// teleport for --laps laps (the same places every lap). At every stop it samples renderer.info (geometries, textures),
// the V8 heap and ArrayBuffer backing store, scene object counts, and the physical footprint of the app's renderer and
// GPU processes. Any growth from lap to lap is a leak. --track adds the orphan census (r3-leak.track.js) at the end.
//   node tools/v2/perf/appdrive.mjs --web <web build dir> [--laps 3] [--wait 20] [--set name] [--q "&foo=1"] [--track]
// Report: docs/v2/reports/appdrive-<set>.json
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execSync } from 'node:child_process';

const argv = process.argv.slice(2);
const o = {};
for (let i = 0; i < argv.length; i++) {
  if (argv[i].startsWith('--')) {
    const k = argv[i].slice(2);
    o[k] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
  }
}
const SET = o.set || 'app';
const LAPS = +(o.laps || 3);
const WAIT = +(o.wait || 20);
const PORT = +(o.port || 9461);
const STOPS = [
  ['downtown', 407, -110],
  ['edgewater', 308, -1452],
  ['gardens', 715, -3080],
  ['beach', 2332, -660],
  ['southbeach', 2398, 660],
  ['brickell', 0, 1760],
  ['airport', -1210, 1045],
  ['havana', -660, -55],
  ['homestead', -1320, 3190],
  ['keylargo', -1155, 5500],
];
// --n N: only the first N places
if (o.n) STOPS.length = Math.min(STOPS.length, +o.n);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// physical footprint (MB) of the Electron renderer and GPU processes started by this run
function footprints(rootPid) {
  const out = {};
  const ps = execSync('ps -axo pid,ppid,command', { encoding: 'utf8', maxBuffer: 32e6 });
  const kids = new Map();
  for (const line of ps.split('\n').slice(1)) {
    const m = line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/);
    if (m) kids.set(+m[1], { ppid: +m[2], cmd: m[3] });
  }
  const mine = new Set([rootPid]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const [pid, p] of kids) {
      if (!mine.has(pid) && mine.has(p.ppid)) {
        mine.add(pid);
        grew = true;
      }
    }
  }
  for (const pid of mine) {
    const p = kids.get(pid);
    if (!p) continue;
    const ty = (p.cmd.match(/--type=(gpu-process|renderer)/) || [])[1];
    if (!ty) continue;
    try {
      const vm = execSync(`vmmap --summary ${pid} 2>/dev/null | grep -E 'Physical footprint:'`, {
        encoding: 'utf8',
      });
      const f = vm.match(/Physical footprint:\s+([\d.]+)([GMK])/);
      if (f) {
        const scale = f[2] === 'G' ? 1024 : f[2] === 'K' ? 1 / 1024 : 1;
        const key = ty === 'gpu-process' ? 'gpu' : 'ren';
        out[key] = Math.max(out[key] || 0, Math.round(+f[1] * scale));
      }
    } catch (e) {
      /* gone */
    }
  }
  return out;
}

const SAMPLE = `(() => {
  const G = game;
  const ri = G.renderer.info;
  let objs = 0, meshes = 0;
  const groups = {};
  for (const ch of G.scene.children) {
    let n = 0;
    ch.traverse((x) => { n++; objs++; if (x.isMesh) meshes++; });
    const k = ch.name || ch.type;
    groups[k] = (groups[k] || 0) + n;
  }
  const st = G.city?.streamer;
  return JSON.stringify({
    geo: ri.memory.geometries, tex: ri.memory.textures, prog: ri.programs?.length,
    objs, meshes, groups,
    tiles: st ? st.tiles.size : null,
    queued: st ? st.stats.queued : null,
    maxStep: st ? st.stats.maxStep : null,
    bodies: G.world?.bodies?.len?.(), colliders: G.world?.colliders?.len?.(),
    heap: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null,
  });
})()`;

const web = path.resolve(o.web || 'desktop/dist/web');
const q = ['mute', (o.q || '').replace(/^&/, '')].filter(Boolean).join('&');
const app = spawn(
  'npx',
  [
    'electron',
    'desktop/app',
    `--ps-web-root=${web}`,
    '--ps-test-profile',
    `--ps-profile=${SET}`,
    '--ps-size=1600x900',
    `--ps-query=${q}`,
    `--remote-debugging-port=${PORT}`,
  ],
  { stdio: 'ignore', detached: true },
);
const killApp = () => {
  try {
    process.kill(-app.pid, 'SIGKILL');
  } catch (e) {
    /* gone */
  }
};
process.on('exit', killApp);
process.on('SIGINT', () => process.exit(130));
process.on('SIGTERM', () => process.exit(143));

// ---- a minimal DevTools client ----
let wsUrl = null;
for (let i = 0; i < 240 && !wsUrl; i++) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
    const pg = list.find((t) => t.type === 'page' && /index\.html/.test(t.url));
    if (pg) wsUrl = pg.webSocketDebuggerUrl;
  } catch (e) {
    /* not up yet */
  }
  if (!wsUrl) await sleep(500);
}
if (!wsUrl) throw new Error('app did not start');
const ws = new WebSocket(wsUrl);
await new Promise((r, j) => {
  ws.onopen = r;
  ws.onerror = j;
});
let id = 0;
const pending = new Map();
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.id && pending.has(d.id)) {
    pending.get(d.id)(d);
    pending.delete(d.id);
  }
};
const send = (method, params = {}) =>
  new Promise((res) => {
    const i = ++id;
    pending.set(i, res);
    ws.send(JSON.stringify({ id: i, method, params }));
  });
async function ev(expr, timeout = 120000) {
  const r = await Promise.race([
    send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }),
    sleep(timeout).then(() => ({ timeout: true })),
  ]);
  if (r.timeout) throw new Error('eval timeout');
  if (r.result?.exceptionDetails)
    throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 300));
  return r.result?.result?.value;
}
async function key(code) {
  for (const type of ['keyDown', 'keyUp'])
    await send('Input.dispatchKeyEvent', { type, code, key: code, windowsVirtualKeyCode: 13 });
}

const T0 = Date.now();
const READY = `!!(window.game && game.ready === true && game.v2 && typeof game.teleport === 'function')`;
for (let i = 0; i < 600 && !(await ev(READY).catch(() => false)); i++) await sleep(1000);
console.log('ready after', Math.round((Date.now() - T0) / 1000), 's');
for (let i = 0; i < 120; i++) {
  if (await ev('!(game.ui && game.ui.title)')) break;
  if (i % 3 === 0) await key('Enter');
  await sleep(1000);
}
await sleep(2000);
if (o.track)
  console.log(
    'tracker',
    await ev(fs.readFileSync(new URL('./r3-leak.track.js', import.meta.url), 'utf8')),
  );

const rep = { set: SET, web, q, when: new Date().toISOString(), samples: [] };
for (let lap = 1; lap <= LAPS; lap++) {
  for (const [name, x, z] of STOPS) {
    await ev(`(game.teleport(${x}, undefined, ${z}), 1)`);
    await sleep(WAIT * 1000);
    await send('HeapProfiler.collectGarbage');
    const s = JSON.parse(await ev(SAMPLE));
    const hu = (await send('Runtime.getHeapUsage')).result;
    s.v8MB = Math.round(hu.usedSize / 1048576);
    s.abMB = Math.round(hu.backingStorageSize / 1048576);
    s.fp = footprints(app.pid);
    s.label = `${name}#${lap}`;
    s.wall = Math.round((Date.now() - T0) / 1000);
    rep.samples.push(s);
    fs.writeFileSync(`docs/v2/reports/appdrive-${SET}.json`, JSON.stringify(rep, null, 1));
    console.log(
      `${s.label.padEnd(14)} ${String(s.wall).padStart(5)}s ren ${s.fp.ren} gpu ${s.fp.gpu} v8 ${s.v8MB} ab ${s.abMB} ` +
        `geo ${s.geo} tex ${s.tex} prog ${s.prog} objs ${s.objs} tiles ${s.tiles} q ${s.queued} col ${s.colliders} ` +
        `maxStep ${JSON.stringify(s.maxStep)}`,
    );
  }
}
// what grew between the end of lap 1 and the end of the last lap (same place)
const per = STOPS.length;
const A = rep.samples[per - 1];
const B = rep.samples[rep.samples.length - 1];
if (A && B && A !== B) {
  const keys = new Set([...Object.keys(A.groups), ...Object.keys(B.groups)]);
  rep.groupGrowth = [...keys]
    .map((k) => [k, (B.groups[k] || 0) - (A.groups[k] || 0), B.groups[k] || 0])
    .filter((x) => x[1] !== 0)
    .sort((x, y) => y[1] - x[1])
    .slice(0, 20);
  console.log('scene objects grown lap 1 -> last:', JSON.stringify(rep.groupGrowth));
}
if (o.track) {
  await send('HeapProfiler.collectGarbage');
  const c = JSON.parse(await ev('JSON.stringify(window.__trk.census())'));
  rep.orphans = c;
  console.log('orphans', c.orphan, 'of', c.gpu, 'on the GPU');
  for (const [k, n] of c.top) console.log(String(n).padStart(6), k);
}
fs.writeFileSync(`docs/v2/reports/appdrive-${SET}.json`, JSON.stringify(rep, null, 1));
console.log('wrote docs/v2/reports/appdrive-' + SET + '.json');
ws.close();
killApp();
process.exit(0);
