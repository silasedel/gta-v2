// Driving smoothness check (Nov 19, user: "the camera tracking the car is glitching back and forth"). Same drive as camcheck.mjs;
// every frame logs the frame time, the drawn car position, the camera position and the yaw. Reports:
//   speedJit  frame-to-frame relative variation of the drawn car speed (|d mesh| / frame dt): 0 = perfectly even motion
//   camLocalJit  frame-to-frame movement of the camera in the car's own frame (cm): the car shaking against the camera
//   driverJit  driver seat offset change against the car mesh (cm)
//   screenJitPx  frame-to-frame jerk of the car's center on screen (|second difference| in pixels at 1280x720): the
//                visible "car jiggles against the camera"; a steady drift across the screen counts as 0
//   node tools/v2/physics/jitter.mjs [--q "&fixstep=0"] [--kmh 50] [--burn 18]
//   camDistJerkCm  |second difference| of the camera-to-car distance per frame (cm): the camera pumping closer / farther
//   --ab: one drive, the camera switches between the smooth follow and the old one (game.smoothCam) every 4 s;
//         the metrics are reported per camera (frames right after a switch are left out)
//   --burn N: busy-wait N ms in every frame (simulates a slow machine, ~30 fps with 18)
import fs from 'node:fs';
import { withBrowser, GAME_READY, startGame } from '../browser.mjs';
const a = process.argv.slice(2),
  o = {};
for (let i = 0; i < a.length; i++)
  if (a[i].startsWith('--')) {
    const k = a[i].slice(2);
    o[k] = a[i + 1] && !a[i + 1].startsWith('--') ? a[++i] : true;
  }
const KMH = +(o.kmh || 50),
  Q = o.q || '',
  BURN = +(o.burn || 0),
  AB = !!o.ab;
await withBrowser({ width: 1280, height: 720, maxSeconds: 600 }, async (b) => {
  await b.goto('http://127.0.0.1:5200/?mute' + Q);
  await b.waitFor(GAME_READY + " && typeof game.teleport === 'function'", 600);
  await startGame(b);
  await b.eval(`(() => { game.timeExternal = true; game.timeOfDay = 11; return 1; })()`);
  await b.eval(fs.readFileSync('tools/v2/physics/labPage.js', 'utf8'));
  await b.eval(`JSON.stringify(__lab.findSpot(407, -110))`);
  await b.eval(
    `(() => { const S = __lab.spot; game.teleport(S.x0 + S.rx * 2.4, undefined, S.z0 + S.rz * 2.4); return 1; })()`,
  );
  await b.sleep(9000);
  for (let k = 0; k < 2; k++) {
    await b.key('Enter', true, 'Enter');
    await b.key('Enter', false, 'Enter');
    await b.sleep(700);
  }
  await b.eval(`__lab.spawn('sedan3', 0).then(() => { __lab.v.playerDriven = false; return 1; })`);
  await b.eval(
    `(() => { const S = __lab.spot, v = __lab.v; const t = v.body.translation(); game.teleport(t.x + S.rx * 2.2, undefined, t.z + S.rz * 2.2); return 1; })()`,
  );
  await b.sleep(800);
  await b.eval('(game.enterVehicle(__lab.v), 1)');
  await b.sleep(2500);
  console.log('in car', await b.eval('!!(game.player.state?.inVehicle)'));
  await b.eval(`(() => { game.cameraOverride = null; window.__J = []; const v = __lab.v; let last = performance.now();
    let seg = 0, since = 0, segT = performance.now(); if (${AB}) game.smoothCam = true;
    const tick = () => { const now = performance.now(), m = v.mesh, c = game.camera.position, q = m.quaternion.clone().invert();
      const lc = c.clone().sub(m.position).applyQuaternion(q); const dr = game.player.character?.root || game.player.mesh;
      let ld = null; if (dr && dr.getWorldPosition) { const w = dr.getWorldPosition(new m.position.constructor()); ld = w.sub(m.position).applyQuaternion(q).toArray(); }
      const sc = m.position.clone().project(game.camera);
      if (${AB} && now - segT > 4000) { game.smoothCam = !game.smoothCam; seg++; since = 0; segT = now; }
      window.__J.push([now - last, m.position.x, m.position.z, lc.x, lc.y, lc.z, ld, game.cameraYaw, sc.x * 640, sc.y * 360, game.smoothCam !== false, seg, since++]); last = now;
      const bEnd = performance.now() + ${BURN}; while (performance.now() < bEnd) {}
      window.__jR = requestAnimationFrame(tick); };
    window.__jR = requestAnimationFrame(tick); return 1; })()`);
  await b.eval(
    `__lab.run({ kmh: ${KMH}, sEnd: 140, maxT: 25 }).then((r) => JSON.stringify(r))`,
    200000,
  );
  // metrics over frame windows that stay inside one camera segment (keep(i, n): frames i-n+1 .. i)
  const METRICS = `(J0) => { const J = J0.slice(30); const keep = (i, n) => { for (let k = 1; k < n; k++) if (J[i - k][11] !== J[i][11]) return false; return J[i][12] >= 12; };
    const sp = [], cl = [], dj = [], ft = [], sj = [], dz = [];
    for (let i = 2; i < J.length; i++) { if (!keep(i, 3)) continue; const a = J[i - 2], b2 = J[i - 1], c = J[i]; sj.push(Math.hypot(c[8] - 2 * b2[8] + a[8], c[9] - 2 * b2[9] + a[9]));
      const dd = (e) => Math.hypot(e[3], e[4], e[5]); dz.push(Math.abs(dd(c) - 2 * dd(b2) + dd(a)) * 100); }
    for (let i = 1; i < J.length; i++) { if (!keep(i, 2)) continue; const a = J[i - 1], c = J[i]; ft.push(c[0]); const s = Math.hypot(c[1] - a[1], c[2] - a[2]) / (c[0] / 1000); if (s > 2) sp.push(s);
      cl.push(Math.hypot(c[3] - a[3], c[4] - a[4], c[5] - a[5]) * 100); if (a[6] && c[6]) dj.push(Math.hypot(c[6][0] - a[6][0], c[6][1] - a[6][1], c[6][2] - a[6][2]) * 100); }
    const rel = []; for (let i = 1; i < sp.length; i++) rel.push(Math.abs(sp[i] - sp[i - 1]) / ((sp[i] + sp[i - 1]) / 2));
    const med = (x) => { const s = [...x].sort((p, q) => p - q); return +(s[s.length >> 1] || 0).toFixed(3); }, p95 = (x) => { const s = [...x].sort((p, q) => p - q); return +(s[Math.floor(s.length * 0.95)] || 0).toFixed(3); };
    return { frames: ft.length, frameMs: [med(ft), p95(ft)], speedJit: [med(rel), p95(rel)], camLocalJitCm: [med(cl), p95(cl)], driverJitCm: [med(dj), p95(dj)], screenJitPx: [med(sj), p95(sj)], camDistJerkCm: [med(dz), p95(dz)] }; }`;
  const r = JSON.parse(
    await b.eval(`(() => { cancelAnimationFrame(window.__jR); const M = ${METRICS}; const J = window.__J;
      if (!${AB}) return JSON.stringify(M(J));
      // split by camera: same frames list, the other camera's frames become their own segments
      const on = J.map((f) => f[10] ? f : [...f.slice(0, 11), -1, 0]), off = J.map((f) => !f[10] ? f : [...f.slice(0, 11), -1, 0]);
      const only = (L, want) => L.filter((f) => f[10] === want);
      return JSON.stringify({ smooth: M(only(on, true)), old: M(only(off, false)) }); })()`),
  );
  console.log('jitter', Q || '(default)', 'burn', BURN, JSON.stringify(r));
});
