#!/usr/bin/env node
// Memory probe (Nov 19, after the out-of-memory crash on the user's Mac). Visits a loop of places by teleport, twice,
// and samples at each stop:
//   V8 heap (JS objects) and ArrayBuffer backing store (Runtime.getHeapUsage), scene geometry bytes per top-level group
//   (attribute + index arrays still held on the CPU, and the GPU-side size of the same buffers), texture bytes,
//   renderer.info, streamer tile counts, the Chrome GPU / renderer process footprint (vmmap),
// then takes a 10 s CPU profile downtown and reports the garbage-collector share.
// The second lap revisits the same places: any growth between lap 1 and lap 2 is a leak.
//   node tools/v2/perf/memprobe.mjs [--url http://127.0.0.1:5200] [--set name] [--wait 20] [--q "&foo=1"] [--laps 2] [--noprof]
// Report: docs/v2/reports/memprobe-<set>.json
import fs from 'node:fs';
import os from 'node:os';
import { execSync } from 'node:child_process';
import { withBrowser, GAME_READY, startGame } from '../browser.mjs';

const argv = process.argv.slice(2);
const o = {};
for (let i = 0; i < argv.length; i++) {
  if (argv[i].startsWith('--')) {
    const k = argv[i].slice(2);
    o[k] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
  }
}
const SET = o.set || 'base';
const WAIT = +(o.wait || 20);
const LAPS = +(o.laps || 2);
const STOPS = [
  ['downtown', 407, -110],
  ['brickell', 0, 1760],
  ['beach', 2332, -660],
  ['edgewater', 308, -1452],
  ['havana', -660, -55],
];
const T_START = Date.now();
const BASE = o.url || 'http://127.0.0.1:5200';

// this run's Chrome profile dir (the first ps-v2-chrome-* created after the script started)
let profName = null;
function myProfile() {
  if (profName) {
    return profName;
  }
  try {
    const dirs = fs
      .readdirSync(os.tmpdir())
      .filter((n) => n.startsWith('ps-v2-chrome-'))
      .map((n) => [n, fs.statSync(os.tmpdir() + '/' + n).birthtimeMs])
      .filter((x) => x[1] >= T_START - 2000)
      .sort((a, b) => a[1] - b[1]);
    profName = dirs[0] ? dirs[0][0] : null;
  } catch (e) {
    /* none */
  }
  return profName;
}

// physical footprint in MB of this run's GPU and renderer processes
function footprints() {
  const out = {};
  const prof = myProfile();
  if (!prof) {
    return out;
  }
  const ps = execSync('ps -axo pid,command', { encoding: 'utf8', maxBuffer: 32e6 });
  for (const line of ps.split('\n')) {
    if (!line.includes(prof)) {
      continue;
    }
    const ty = (line.match(/--type=(gpu-process|renderer)/) || [])[1];
    if (!ty || /--extension-process/.test(line)) {
      continue;
    }
    const pid = +line.trim().split(/\s+/)[0];
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
      /* process gone */
    }
  }
  return out;
}

// page side: geometry / texture census of the scene
const CENSUS = `(() => {
  const G = game;
  const seenArr = new Set();
  const seenGeo = new Set();
  const seenTex = new Set();
  const groups = {};
  let cpuTotal = 0, gpuTotal = 0, geoCount = 0, dropped = 0, texBytes = 0;
  function attrBytes(a, rec) {
    if (!a) return;
    const arr = a.isInterleavedBufferAttribute ? a.data.array : a.array;
    const key = a.isInterleavedBufferAttribute ? a.data : a;
    const gpuLen = (a.isInterleavedBufferAttribute ? a.data.count * a.data.stride : a.count * a.itemSize) * 4;
    if (seenArr.has(key)) return;
    seenArr.add(key);
    rec.gpu += gpuLen;
    if (arr && arr.byteLength > 0) rec.cpu += arr.byteLength;
    else dropped++;
  }
  function texOf(m) {
    for (const k in m) {
      const t = m[k];
      if (t && t.isTexture && !seenTex.has(t)) {
        seenTex.add(t);
        const img = t.image;
        let w = 0, h = 0, d = 1;
        if (img) { w = img.width || 0; h = img.height || 0; d = img.depth || 1; }
        if (t.isDataTexture || t.isDataArrayTexture || t.isData3DTexture) {
          texBytes += (t.image?.data?.byteLength || w * h * d * 4);
        } else {
          texBytes += w * h * d * 4 * (t.generateMipmaps ? 1.33 : 1);
        }
      }
    }
  }
  for (const ch of G.scene.children) {
    const name = ch.name || ch.type;
    const rec = groups[name] || (groups[name] = { cpu: 0, gpu: 0, geos: 0 });
    ch.traverse((x) => {
      const m = x.material;
      if (m) (Array.isArray(m) ? m : [m]).forEach(texOf);
      const g = x.geometry;
      if (!g || seenGeo.has(g)) return;
      seenGeo.add(g);
      rec.geos++;
      geoCount++;
      for (const k in g.attributes) attrBytes(g.attributes[k], rec);
      attrBytes(g.index, rec);
      if (x.isInstancedMesh) {
        attrBytes(x.instanceMatrix, rec);
        attrBytes(x.instanceColor, rec);
      }
    });
  }
  const top = Object.entries(groups)
    .map(([k, v]) => [k, Math.round(v.cpu / 1048576), Math.round(v.gpu / 1048576), v.geos])
    .sort((a, b) => b[2] - a[2])
    .slice(0, 12);
  for (const v of Object.values(groups)) { cpuTotal += v.cpu; gpuTotal += v.gpu; }
  const ri = G.renderer.info;
  const st = G.city?.streamer;
  const P = G.player.position;
  return JSON.stringify({
    pos: [Math.round(P.x), Math.round(P.z)],
    geoCpuMB: Math.round(cpuTotal / 1048576),
    geoGpuMB: Math.round(gpuTotal / 1048576),
    texMB: Math.round(texBytes / 1048576),
    geoCount, dropped, top,
    ri: { geo: ri.memory.geometries, tex: ri.memory.textures, calls: ri.render.calls, tris: ri.render.triangles },
    tiles: st ? { n: st.tiles.size, near: st.stats.near, mid: st.stats.mid, far: st.stats.far, col: st.stats.col, queued: st.stats.queued } : null,
    maxStep: st ? st.stats.maxStep : null,
    longSteps: st ? st.stats.longSteps || null : null,
    tb: G.city?.tileBatch?.stats ? { batches: G.city.tileBatch.stats.batches, meshes: G.city.tileBatch.stats.meshes, dropped: G.city.tileBatch.stats.dropped } : null,
    work: +(G.perf?.workAvg ?? 0).toFixed(1),
  });
})()`;

const rep = { set: SET, q: o.q || '', when: new Date().toISOString(), samples: [] };

await withBrowser({ width: 1280, height: 720, maxSeconds: 900 }, async (b) => {
  await b.goto(BASE + '/?mute' + (o.q || ''));
  await b.waitFor(GAME_READY + " && typeof game.teleport === 'function'", 600);
  await startGame(b);
  const sample = async (label) => {
    try {
      await b.send('HeapProfiler.collectGarbage');
    } catch (e) {
      /* optional */
    }
    const s = JSON.parse(await b.eval(CENSUS, 60000));
    const hu = (await b.send('Runtime.getHeapUsage')).result;
    s.label = label;
    s.v8MB = Math.round(hu.usedSize / 1048576);
    s.abMB = Math.round(hu.backingStorageSize / 1048576);
    s.fp = footprints();
    s.wall = Math.round((Date.now() - T_START) / 1000);
    rep.samples.push(s);
    console.log(
      `${label.padEnd(14)} v8 ${s.v8MB} ab ${s.abMB} geoCpu ${s.geoCpuMB} geoGpu ${s.geoGpuMB} tex ${s.texMB} ` +
        `geos ${s.geoCount} riGeo ${s.ri.geo} riTex ${s.ri.tex} fp ${JSON.stringify(s.fp)} tiles ${JSON.stringify(s.tiles)} ` +
        `maxStep ${JSON.stringify(s.maxStep)} long ${JSON.stringify(s.longSteps)} tb ${JSON.stringify(s.tb)}`,
    );
    console.log('   top', JSON.stringify(s.top.slice(0, 7)));
  };
  for (let lap = 1; lap <= LAPS; lap++) {
    for (const [name, x, z] of STOPS) {
      await b.eval(`(game.teleport(${x}, undefined, ${z}), 1)`);
      await b.sleep(WAIT * 1000);
      await sample(`${name}#${lap}`);
    }
  }
  if (!o.noprof) {
    await b.eval(`(game.teleport(${STOPS[0][1]}, undefined, ${STOPS[0][2]}), 1)`);
    await b.sleep(4000);
    await b.send('Profiler.enable');
    await b.send('Profiler.start');
    await b.sleep(10000);
    const prof = (await b.send('Profiler.stop')).result.profile;
    const byId = new Map(prof.nodes.map((n) => [n.id, n]));
    let gc = 0;
    let idle = 0;
    let all = 0;
    for (let i = 0; i < prof.samples.length; i++) {
      const dt = prof.timeDeltas[i] || 0;
      const fn = byId.get(prof.samples[i])?.callFrame.functionName;
      all += dt;
      if (fn === '(garbage collector)') {
        gc += dt;
      } else if (fn === '(idle)') {
        idle += dt;
      }
    }
    rep.gc = {
      gcMs: Math.round(gc / 1000),
      busyMs: Math.round((all - idle) / 1000),
      share: +(gc / Math.max(1, all - idle)).toFixed(3),
    };
    console.log('gc (10 s downtown, teleport arrival)', JSON.stringify(rep.gc));
  }
  rep.errors = [...new Set(b.errors)].slice(0, 20);
});
fs.writeFileSync(`docs/v2/reports/memprobe-${SET}.json`, JSON.stringify(rep, null, 1));
console.log('wrote docs/v2/reports/memprobe-' + SET + '.json');
