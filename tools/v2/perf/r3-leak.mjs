#!/usr/bin/env node
// r3-perf leak hunt: a long muted session that drives a real car (physics, autopilot along the road graph) through
// Brickell / downtown with a wanted level held up (police chase), and samples every --every seconds what could grow:
//   fps, CPU per system (game.perf.sysAvg), renderer.info (geometries, textures, programs, calls, triangles), scene object
//   census (objects, meshes, instanced meshes, lights, per top-level group), JS heap, Rapier bodies / colliders / joints,
//   vehicles, peds, police units / cars, updaters / fixedHooks, live GL objects (buffers, textures, VAOs, programs),
//   audio nodes created, live event listeners, live intervals / timeouts.
//   node tools/v2/perf/r3-leak.mjs [--secs 660] [--every 20] [--q "&leakfix=0"] [--set name] [--stars 3]
// Report: docs/v2/reports/r3-leak-<set>.json
import fs from 'node:fs';
import { withBrowser, GAME_READY, startGame } from '../browser.mjs';
import { execSync } from 'node:child_process';
const TRACK = fs.readFileSync(new URL('./r3-leak.track.js', import.meta.url), 'utf8');
import os from 'node:os';
const T_START = Date.now();
// this run's Chrome profile: the first ps-v2-chrome-* dir created after the script started
let _prof = null;
function myProfile() {
  if (_prof) return _prof;
  try {
    const c = fs
      .readdirSync(os.tmpdir())
      .filter((n) => n.startsWith('ps-v2-chrome-'))
      .map((n) => [
        os.tmpdir().replace(/\/$/, '') + '/' + n,
        fs.statSync(os.tmpdir() + '/' + n).birthtimeMs,
      ])
      .filter((x) => x[1] >= T_START - 2000)
      .sort((a, b) => a[1] - b[1]);
    _prof = c[0] ? c[0][0].split('/').pop() : null;
  } catch (e) {
    /* */
  }
  return _prof;
}
// physical footprint (MB) of this test's Chrome GPU and renderer processes (found by the temp profile dir in their command line)
function footprints() {
  const out = {};
  try {
    const ps = execSync('ps -axo pid,command', { encoding: 'utf8', maxBuffer: 32e6 });
    const prof = myProfile();
    if (!prof) return out;
    for (const line of ps.split('\n')) {
      if (!line.includes(prof)) continue;
      const ty = (line.match(/--type=(gpu-process|renderer)/) || [])[1];
      if (!ty || (ty === 'renderer' && /--extension-process/.test(line))) continue;
      const pid = +line.trim().split(/\s+/)[0];
      try {
        const vm = execSync(
          `vmmap --summary ${pid} 2>/dev/null | grep -E 'Physical footprint:|IOAccelerator \\(graphics\\)'`,
          { encoding: 'utf8' },
        );
        const f = vm.match(/Physical footprint:\s+([\d.]+)([GMK])/);
        const g = vm.match(/IOAccelerator \(graphics\)\s+([\d.]+)([GMK])/);
        const mb = (m) =>
          m ? Math.round(+m[1] * (m[2] === 'G' ? 1024 : m[2] === 'K' ? 1 / 1024 : 1)) : null;
        out[ty === 'gpu-process' ? 'gpu' : 'ren'] = Math.max(
          out[ty === 'gpu-process' ? 'gpu' : 'ren'] || 0,
          mb(f),
        );
        if (g) out.gfx = mb(g);
      } catch (e) {
        /* */
      }
    }
  } catch (e) {
    /* */
  }
  return out;
}
const a = process.argv.slice(2),
  o = {};
for (let i = 0; i < a.length; i++)
  if (a[i].startsWith('--')) {
    const k = a[i].slice(2);
    o[k] = a[i + 1] && !a[i + 1].startsWith('--') ? a[++i] : true;
  }
const SET = o.set || 'base',
  SECS = +(o.secs || 660),
  EVERY = +(o.every || 20),
  STARS = +(o.stars ?? 3);
const AP = fs.readFileSync(new URL('./r3-leak.ap.js', import.meta.url), 'utf8');
const SHOTS = `docs/v2/shots/perf/r3-leak-${SET}`;
fs.mkdirSync(SHOTS, { recursive: true });
const rep = {
  set: SET,
  q: o.q || '',
  when: new Date().toISOString(),
  secs: SECS,
  samples: [],
  errors: [],
};

// page instrumentation installed before any page script: GL object lifetimes, audio nodes, listeners, timers
const INSTR = `(() => {
  const C = window.__lk = { gl: {}, audio: 0, listeners: 0, intervals: 0, timeouts: 0, raf: 0 };
  const pair = (P, mk, del, key) => { if (!P || !P[mk]) return; const m = P[mk], d = P[del];
    P[mk] = function (...x) { C.gl[key] = (C.gl[key] || 0) + 1; return m.apply(this, x); };
    P[del] = function (o) { if (o) C.gl[key] = (C.gl[key] || 0) - 1; return d.apply(this, arguments); }; };
  for (const P of [window.WebGL2RenderingContext?.prototype]) {
    pair(P, 'createBuffer', 'deleteBuffer', 'buffers'); pair(P, 'createTexture', 'deleteTexture', 'textures');
    pair(P, 'createVertexArray', 'deleteVertexArray', 'vaos'); pair(P, 'createProgram', 'deleteProgram', 'programs');
    pair(P, 'createFramebuffer', 'deleteFramebuffer', 'fbos'); pair(P, 'createRenderbuffer', 'deleteRenderbuffer', 'rbos');
  }
  const BA = window.BaseAudioContext?.prototype;
  if (BA) for (const k of Object.getOwnPropertyNames(BA)) if (/^create/.test(k) && typeof BA[k] === 'function') { const f = BA[k]; BA[k] = function (...x) { C.audio++; return f.apply(this, x); }; }
  const ET = EventTarget.prototype, ae = ET.addEventListener, re = ET.removeEventListener;
  ET.addEventListener = function (...x) { C.listeners++; return ae.apply(this, x); };
  ET.removeEventListener = function (...x) { C.listeners--; return re.apply(this, x); };
  const live = new Set(), si = window.setInterval, ci = window.clearInterval;
  window.setInterval = function (...x) { const id = si.apply(this, x); live.add(id); C.intervals = live.size; return id; };
  window.clearInterval = function (id) { live.delete(id); C.intervals = live.size; return ci.apply(this, arguments); };
})();`;

const SAMPLE = `(() => {
  const G = game, r = G.renderer || G.post?.renderer, info = r?.info, W = G.world;
  let objs = 0, meshes = 0, inst = 0, instCount = 0, lights = 0, visible = 0, sprites = 0, points = 0, lines = 0, skinned = 0;
  const groups = {}, mats = new Set(), geos = new Set();
  const scene = G.scene || G.post?.scene;
  for (const ch of scene.children) {
    let n = 0; ch.traverse((x) => { n++; objs++; if (x.visible) visible++;
      if (x.isMesh) { meshes++; if (x.isInstancedMesh) { inst++; instCount += x.count; } if (x.isSkinnedMesh) skinned++; const m = x.material; if (Array.isArray(m)) m.forEach((q) => mats.add(q)); else if (m) mats.add(m); if (x.geometry) geos.add(x.geometry); }
      else if (x.isLight) lights++; else if (x.isSprite) sprites++; else if (x.isPoints) points++; else if (x.isLine) lines++; });
    const k = (ch.name || ch.type) + (ch.userData?.kind ? ':' + ch.userData.kind : '');
    groups[k] = (groups[k] || 0) + n;
  }
  const sys = Object.entries(G.perf?.sysAvg || {}).filter(([, v]) => v > 0.25).sort((a, b) => b[1] - a[1]).slice(0, 14).map(([k, v]) => [k, +v.toFixed(2)]);
  const pol = G.police || {}; const veh = G.vehicles || {};
  const peds = G.peds?.list || G.peds?.all?.() || [];
  const st = G.city?.streamer;
  const P = G.player.position;
  return JSON.stringify({ t: +(G.clock?.elapsed ?? 0).toFixed(0), fps: +(G.perf?.fps ?? 0).toFixed(1), work: +(G.perf?.workAvg ?? 0).toFixed(2), gap: +(G.perf?.gapAvg ?? 0).toFixed(2),
    preset: G.quality?.preset ?? G.quality?.current ?? null, scale: G.dynres?.scale ?? null, sys,
    ri: info ? { geo: info.memory.geometries, tex: info.memory.textures, prog: info.programs?.length, calls: info.render.calls, tris: info.render.triangles } : null,
    objs, visible, meshes, inst, instCount, lights, sprites, points, lines, skinned, mats: mats.size, geos: geos.size, groups,
    heap: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null,
    rap: W ? { bodies: W.bodies?.len?.(), colliders: W.colliders?.len?.(), ij: W.impulseJoints?.len?.(), mj: W.multibodyJoints?.len?.() } : null,
    veh: { list: veh.list?.length, all: veh.all?.().length, respawn: veh.respawnCount }, peds: { n: peds.length, active: peds.filter?.((p) => p.active).length },
    police: { units: pol.units?.filter?.((u) => u.active).length, cars: pol.cars?.length, barriers: pol.barriers?.length, blocks: pol.blocks?.length },
    upd: G.updaters?.length, fixed: G.fixedHooks?.length, wanted: G.wanted?.level, inVeh: !!G.player.state?.inVehicle,
    tiles: st ? { tiles: st.tiles?.size, chunks: st.chunks?.size, pending: typeof st.pending === 'function' ? st.pending() : null } : null,
    lk: window.__lk, views: G.instVao?.views, pos: [Math.round(P.x), Math.round(P.z)], ap: window.__ap ? { stuck: window.__ap.resets, s: Math.round(window.__ap.s), cars: window.__ap.cars } : null });
})()`;

await withBrowser({ width: 1280, height: 720, maxSeconds: SECS + 900 }, async (b) => {
  await b.send('Page.addScriptToEvaluateOnNewDocument', { source: INSTR });
  await b.goto((o.url || 'http://127.0.0.1:5200') + '/?mute' + (o.q || ''));
  await b.waitFor(GAME_READY + " && typeof game.teleport === 'function'", 480);
  if (!(await startGame(b))) console.log('WARN: title did not close');
  await b.eval(
    `(() => { const t = document.getElementById('title'); if (t) t.style.display = 'none'; game.timeExternal = true; game.timeOfDay = 15; return 1; })()`,
  );
  console.log('tracker', await b.eval(TRACK));
  // route: Brickell -> downtown loop on the road graph (random straight-ish continuation on big roads, no edge reuse)
  const start = (o.from || '0,1760').split(',').map(Number);
  await b.eval(
    `(async () => { game.teleport(${start[0]}, undefined, ${start[1]}); const st = game.city.streamer; const t0 = performance.now();
    while (performance.now() - t0 < 40000) { await new Promise((r) => setTimeout(r, 200)); if (st.readyAround(${start[0]}, ${start[1]}, 120) && game.city.collidersReadyAt(${start[0]}, ${start[1]})) break; } return 1; })()`,
    60000,
  );
  await b.sleep(3000);
  const n = await b.eval(`(() => {
    const G = game.city.roadGraph, need = ${SECS * 20 + 3000}; const P = game.player.position;
    let e = G.nearestEdge(P.x, P.z, {}, 2000).edge, node = e.a, used = new Map(), pts = [], len = 0;
    const rank = { motorway: 1, trunk: 5, primary: 4, secondary: 3, tertiary: 2, residential: 1 };
    for (let guard = 0; guard < 20000 && len < need; guard++) {
      used.set(e.id, (used.get(e.id) || 0) + 1); const fwd = e.a === node; const ep = fwd ? e.pts : [...e.pts].reverse(); const ey = fwd ? [...(e.y || [])] : [...(e.y || [])].reverse();
      for (let i = pts.length ? 1 : 0; i < ep.length; i++) { pts.push([ep[i][0], ey[i] || 0, ep[i][1]]); if (pts.length > 1) { const p = pts[pts.length - 2], q = pts[pts.length - 1]; len += Math.hypot(q[0] - p[0], q[2] - p[2]); } }
      node = fwd ? e.b : e.a; const nd = G.nodes[node];
      const a2 = ep[ep.length - 2], a3 = ep[ep.length - 1]; const dx = a3[0] - a2[0], dz = a3[1] - a2[1], dl = Math.hypot(dx, dz) || 1;
      let best = null;
      for (const k of nd.edges) { const f = G.edges[k]; if (f.id === e.id || (f.oneway && f.a !== node)) continue;
        const fp = f.a === node ? f.pts : [...f.pts].reverse(); const ex = fp[1][0] - fp[0][0], ez = fp[1][1] - fp[0][1], el = Math.hypot(ex, ez) || 1;
        const straight = (dx * ex + dz * ez) / (dl * el); const mid = fp[(fp.length / 2) | 0];
        const home = Math.hypot(mid[0] - ${start[0]}, mid[1] - ${start[1]}) > 1600 ? -3 : 0;   // stay around Brickell / downtown
        const sc = straight * 1.5 + (rank[f.kind] || 0) * 0.35 + Math.random() * 1.2 - (used.get(f.id) || 0) * 1.5 + home;
        if (!best || sc > best[0]) best = [sc, f]; }
      if (!best) { const k = nd.edges.find((k) => G.edges[k].id !== e.id); if (k === undefined) break; best = [0, G.edges[k]]; }
      e = best[1];
    }
    window.__route = pts; window.__routeLen = len; return pts.length; })()`);
  rep.routePoints = n;
  rep.routeLen = await b.eval('Math.round(window.__routeLen)');
  console.log('route', n, 'points', rep.routeLen, 'm');
  // car + autopilot: steer to a look-ahead point on the route (the route loops); reverse when stuck; less than 6 m of
  // progress in 7 s puts the car back on the route 20 m further on (a reset); a wrecked / disabled car is replaced
  await b.eval(AP);
  const ok = await b.eval('window.__apNewCar()');
  if (!ok) throw new Error('no car');
  const t0 = Date.now();
  let lastShot = -1e9,
    k = 0;
  while ((Date.now() - t0) / 1000 < SECS) {
    // keep the chase going: hold the wanted level up
    if (STARS)
      await b
        .eval(
          `(() => { if ((game.wanted?.level ?? 0) < ${STARS}) game.wanted.set(${STARS}, game.player.position, { visual: true }); try { window.__apKeep(); } catch (e) {} if (game.player.health < 50) game.player.health = 100; return 1; })()`,
        )
        .catch(() => {});
    let s0 = null;
    try {
      const s = (s0 = JSON.parse(await b.eval(SAMPLE, 30000)));
      try {
        const hu = (await b.send('Runtime.getHeapUsage')).result;
        s.v8MB = Math.round(hu.usedSize / 1048576);
        s.abMB = Math.round(hu.backingStorageSize / 1048576);
      } catch (e) {
        /* */
      }
      s.wall = Math.round((Date.now() - t0) / 1000);
      s.fp = footprints();
      if (k % 2 === 0 || (Date.now() - t0) / 1000 > SECS - EVERY - 5) {
        try {
          s.orphans = await b.eval('JSON.stringify(window.__trk.census())', 60000).then(JSON.parse);
        } catch (e) {
          /* */
        }
      }
      rep.samples.push(s);
      console.log(
        `${String(s.wall).padStart(4)}s fp ${JSON.stringify(s.fp)} orph ${s.orphans ? s.orphans.orphan : '-'} fps ${s.fps} v8 ${s.v8MB} ab ${s.abMB} vao ${s.lk?.gl?.vaos} views ${s.views} work ${s.work} gap ${s.gap} heap ${s.heap} geo ${s.ri?.geo} tex ${s.ri?.tex} prog ${s.ri?.prog} calls ${s.ri?.calls} objs ${s.objs} inst ${s.inst} lights ${s.lights} bodies ${s.rap?.bodies} col ${s.rap?.colliders} veh ${s.veh.all} peds ${s.peds.active}/${s.peds.n} cops ${s.police.units}/${s.police.cars} upd ${s.upd}/${s.fixed} glbuf ${s.lk?.gl?.buffers} gltex ${s.lk?.gl?.textures} audio ${s.lk?.audio} lis ${s.lk?.listeners} int ${s.lk?.intervals} W${s.wanted} resets ${s.ap?.stuck} top ${s.sys
          .slice(0, 4)
          .map((x) => x.join(' '))
          .join(', ')}`,
      );
    } catch (e) {
      console.log('sample failed', String(e).slice(0, 200));
    }
    if (s0 && s0.orphans) console.log('   orphans', JSON.stringify(s0.orphans.top.slice(0, 6)));
    if ((Date.now() - lastShot) / 1000 >= 120) {
      lastShot = Date.now();
      try {
        await b.screenshot(`${SHOTS}/t${String(k++).padStart(2, '0')}.jpg`, { quality: 70 });
      } catch (e) {
        /* */
      }
    }
    await b.sleep(EVERY * 1000);
  }
  rep.errors = [...new Set(b.errors)].slice(0, 30);
  rep.spikes = JSON.parse(
    await b.eval('JSON.stringify((game.perf.spikes || []).slice(-20))').catch(() => '[]'),
  );
});
fs.writeFileSync(`docs/v2/reports/r3-leak-${SET}.json`, JSON.stringify(rep, null, 1));
console.log('wrote', `docs/v2/reports/r3-leak-${SET}.json`, 'errors', rep.errors.length);
