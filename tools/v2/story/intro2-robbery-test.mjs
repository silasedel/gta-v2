#!/usr/bin/env node
// Intro v2, step 3 (storyboard panels 5-7): plays intro2.robbery -> intro2.escape -> intro2.arrest -> intro2.counselor2
// start to finish in the game and saves a screenshot per storyboard moment.
//   node tools/v2/story/intro2-robbery-test.mjs [--missions robbery,escape,arrest,counselor2] [--out docs/v2/shots/intro2]
//        [--q "&foo=1"] [--w 1600 --h 900] [--live <sess dir>]
// The player is driven by script from inside the page (held keys, the camera turned toward the next point): she really
// walks into the shop, aims (scripted right mouse), presses E, mashes Space, runs the fire escape, the plank bridges and
// the stair house, and walks back to the cafe. Reports each mission's result, console errors and whether everything the
// missions built (route, awning, bag, actors, police cars) is gone afterwards.
// --live <dir>: instead of a new browser, run in a live session (tools/v2/render/sess.mjs --dir <dir>).
import fs from 'node:fs';
import path from 'node:path';
import { withBrowser, GAME_READY, startGame } from '../browser.mjs';

const a = process.argv.slice(2);
const o = {};
for (let i = 0; i < a.length; i++) {
  if (!a[i].startsWith('--')) continue;
  const k = a[i].slice(2);
  o[k] = a[i + 1] && !a[i + 1].startsWith('--') ? a[++i] : true;
}
const OUT = o.out || 'docs/v2/shots/intro2';
const ALL = ['robbery', 'escape', 'arrest', 'counselor2'];
const WANT = (o.missions || ALL.join(',')).split(',');
fs.mkdirSync(OUT, { recursive: true });

const report = { missions: {}, shots: [], notes: [], errors: [] };
const log = (...m) => console.log('[intro2-robbery]', ...m);

// ---------------------------------------------------------------- page-side driver (installed once)
const DRIVER = `(async () => {
  if (window.__rd) return true;
  const B = await import('/src/story/sets/robberyBlock.js');
  const D = (window.__rd = { B, events: [] });
  for (const ev of ['mission:start', 'mission:pass', 'mission:fail', 'mission:quit', 'mission:step', 'cutscene:start', 'cutscene:end'])
    game.on(ev, (d) => D.events.push({ ev, id: d && d.id, step: d && d.step, t: performance.now() }));
  D.key = (code, down) => window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code, key: code, bubbles: true }));
  D.tap = async (code) => {
    D.key(code, true);
    await new Promise((r) => setTimeout(r, 90));
    D.key(code, false);
  };
  // a world point: [u, v] in the block frame, or { x, z }
  D.world = (p) => (Array.isArray(p) ? B.P(p[0], p[1]) : p);
  D.shop = (name) => {
    const s = B.findStore(game, B.SHOP_LOT);
    return s && s.heist ? B.storePoint(s, s.heist[name]) : null;
  };
  // run through points (W + Shift held, the camera turned so W heads at the point); stops when stuck
  D.walk = async (pts, o = {}) => {
    const P = game.player;
    const log = [];
    D.key('KeyW', true);
    if (o.sprint !== false) D.key('ShiftLeft', true);
    try {
      for (const pt of pts) {
        const w = D.world(pt);
        let best = 1e9;
        let stuckT = performance.now();
        for (;;) {
          const dx = w.x - P.position.x;
          const dz = w.z - P.position.z;
          const d = Math.sqrt(dx * dx + dz * dz);
          if (d < (o.r || 0.9)) break;
          if (d < best - 0.2) {
            best = d;
            stuckT = performance.now();
          }
          if (performance.now() - stuckT > (o.stuck || 4000)) {
            log.push({ stuck: pt, at: [P.position.x, P.position.y, P.position.z].map((v) => +v.toFixed(2)) });
            return { ok: false, log };
          }
          game.cameraYaw = Math.atan2(dx, dz) + Math.PI;
          game.cameraPitch = 0.22;
          await new Promise((r) => setTimeout(r, 50));
        }
        log.push({ pt, y: +P.position.y.toFixed(2) });
      }
      return { ok: true, log };
    } finally {
      D.key('KeyW', false);
      D.key('ShiftLeft', false);
    }
  };
  D.face = (p) => {
    const w = D.world(p);
    const P = game.player;
    game.cameraYaw = Math.atan2(w.x - P.position.x, w.z - P.position.z) + Math.PI;
    game.cameraPitch = 0.12;
  };
  return true;
})()`;

async function run(b) {
  await b.eval(DRIVER);
  const shot = async (name) => {
    const f = path.join(OUT, name + '.png');
    await b.screenshot(f);
    report.shots.push(f);
    log('shot', f);
  };
  const ev = (expr) => b.eval(expr);
  const csT = () => ev('game.story.cutscenes.active ? game.story.cutscenes.active.t : -1');
  // wait until the running cutscene's clock passes t (s); false as soon as the cutscene is over without getting there
  const atCs = async (t0, maxS = 120) => {
    // a screenshot lands a moment after it is asked for (much later through a live session): ask a little early
    const t = t0 - (o.live ? 0.8 : 0.25);
    let seen = false;
    for (let i = 0; i < maxS * 5; i++) {
      const now = await csT();
      if (now >= t) return true;
      if (now >= 0) seen = true;
      else if (seen || (i > 30 && !(await ev('!!game.story.active?.starting')))) return false;
      await b.sleep(100);
    }
    return false;
  };
  const step = () => ev('game.story.active ? game.story.active.index : -1');
  const waitStep = async (n, maxS = 90) => {
    for (let i = 0; i < maxS * 4; i++) {
      if ((await step()) >= n) return true;
      await b.sleep(250);
    }
    return false;
  };
  const waitEvent = async (name, id, maxS = 120) => {
    for (let i = 0; i < maxS * 2; i++) {
      const r = await ev(
        `(() => { const e = window.__rd.events; if (e.some((x) => x.ev === ${JSON.stringify(name)} && x.id === ${JSON.stringify(id)})) return 'yes'; if (e.some((x) => x.ev === 'mission:fail' && x.id === ${JSON.stringify(id)})) return 'fail'; return ''; })()`,
      );
      if (r === 'yes') return true;
      if (r === 'fail') return false;
      await b.sleep(500);
    }
    return false;
  };
  // the intro chain (src/story/index.js) starts the next intro mission ~7 s after a pass: take that one if it is ours,
  // start it ourselves otherwise
  const start = async (id) => {
    for (let i = 0; i < 24; i++) {
      const cur = await ev('game.story.active ? game.story.active.def.id : ""');
      if (cur === id) {
        log('chained', id);
        return;
      }
      if (cur) await ev('(game.story.quitMission(), true)');
      if (!(await ev('!!game.story.cutscenes.active'))) break;
      await b.sleep(500);
    }
    await ev(`(game.story.startMission(${JSON.stringify(id)}), true)`);
    log('started', id);
  };
  // the prison part counts as played, so the chain goes robbery -> escape -> arrest -> counselor2
  await ev(`(() => {
    for (const id of ['intro2.opening', 'intro2.prisonCell', 'intro2.prisonWalk', 'intro2.counselor1']) {
      game.story.state.set(id + '.done', true);
      game.story.state.markDone(id);
    }
    game.cutsceneSlow = ${o.live ? 4 : 1};
    return true;
  })()`);
  // a stuck walk (a taser hit, a passer-by in the way) is tried once more from where she stands
  const walk = async (pts, o = {}) => {
    let r = await ev(`window.__rd.walk(${JSON.stringify(pts)}, ${JSON.stringify(o)})`);
    if (!r.ok) {
      report.notes.push({ walk: pts, r });
      const left = pts.slice(Math.max(0, r.log.length - 1));
      await b.sleep(2500);
      r = await ev(`window.__rd.walk(${JSON.stringify(left)}, ${JSON.stringify(o)})`);
      if (!r.ok) report.notes.push({ retry: left, r });
    }
    return r.ok;
  };

  // ---------------------------------------------------------------- panel 5: the robbery
  if (WANT.includes('robbery')) {
    const id = 'intro2.robbery';
    await start(id);
    await atCs(3.6, 240);
    await shot('p5_cafe_wide');
    await atCs(7.4);
    await shot('p5_cafe_face');
    await atCs(12.4);
    await shot('p5_cafe_ots');
    await atCs(16.6);
    await shot('p5_cafe_close');
    await waitStep(1);
    await b.sleep(1500);
    // across 21st St and in through the door
    await walk([
      [0.4, 18],
      [0.2, 8.5],
      [0, 6.0],
      [0, 4.2],
    ]);
    await ev(
      `(async () => { const p = window.__rd.shop('lobby'); return window.__rd.walk([p], { sprint: false }); })()`,
    );
    await waitStep(2, 20);
    await b.sleep(1200);
    await shot('p5_shop_inside');
    // aim at the cashier
    await ev(
      `(() => { window.__rd.face(game.story.active.ctx.h.cashier.root.position); return true; })()`,
    );
    await ev('(game.combatInput.aim = true, true)');
    for (let i = 0; i < 40 && (await step()) < 3; i++) {
      await ev(
        `(() => { const c = game.story.active?.ctx?.h?.cashier; if (c) { const P = game.player; const p = c.root.position; game.cameraYaw = Math.atan2(p.x - P.position.x, p.z - P.position.z) + Math.PI; game.cameraPitch = 0.05; } return true; })()`,
      );
      await b.sleep(250);
    }
    await b.sleep(900);
    await shot('p5_aim_hands_up');
    // threaten: walk up to the tray and press E
    await ev(
      `(async () => { const p = window.__rd.shop('tray'); return window.__rd.walk([{ x: p.x, z: p.z }], { sprint: false, r: 1.4 }); })()`,
    );
    for (let i = 0; i < 8 && (await step()) < 4; i++) {
      await ev('(window.__rd.tap("KeyE"), true)');
      await b.sleep(600);
    }
    await b.sleep(1200);
    await shot('p5_threaten');
    await waitStep(5, 20);
    await b.sleep(800);
    await shot('p5_bag_in_tray');
    for (let i = 0; i < 8 && (await step()) < 6; i++) {
      await ev('(window.__rd.tap("KeyE"), true)');
      await b.sleep(600);
    }
    await ev('(game.combatInput.aim = null, true)');
    // the grab: mash Space
    await b.sleep(900);
    await shot('p5_grabbed');
    for (let i = 0; i < 12 && (await step()) < 7; i++) {
      // mash from inside the page: a tap every 130 ms
      await ev(
        '(async () => { for (let k = 0; k < 12; k++) { await window.__rd.tap("Space"); await new Promise((r) => setTimeout(r, 40)); } return true; })()',
      );
    }
    await b.sleep(900);
    await shot('p5_broke_free');
    // run out
    await ev(
      `(async () => { const p = window.__rd.shop('door'); const q = window.__rd.shop('outside'); return window.__rd.walk([{ x: p.x, z: p.z }, { x: q.x, z: q.z }]); })()`,
    );
    await atCs(1.2, 30);
    await shot('p5_police_arrive');
    await atCs(3.8, 30);
    await shot('p5_police_car');
    report.missions[id] = (await waitEvent('mission:pass', id, 60)) ? 'pass' : 'FAIL';
    log(id, report.missions[id]);
    await b.sleep(3000);
  }

  // ---------------------------------------------------------------- panel 6: the escape
  if (WANT.includes('escape')) {
    const id = 'intro2.escape';
    await start(id);
    await waitStep(0, 120);
    await b.sleep(3500);
    await shot('p6_start_police');
    await walk([
      [8, 7],
      [12.5, 6.4],
      [13.6, 5.0],
    ]);
    await shot('p6_fire_escape');
    await walk([
      [13.6, -1.0],
      [12.6, -2.3],
      [12.0, -1.2],
      [12.0, 4.6],
      [13.5, 4.4],
      [17.5, 3.5],
    ]);
    await b.sleep(400);
    await shot('p6_on_the_roof');
    await walk([
      [24, 0.4],
      [30, 0.2],
    ]);
    await shot('p6_roofs_ac_units');
    await walk([[33.5, 0.2]]);
    await shot('p6_plank');
    await walk([
      [39.5, 0.2],
      [47, -3.5],
      [47, -11.0],
      [41, -10.7],
    ]);
    await shot('p6_roof_door');
    await walk([
      [37.4, -10.7],
      [37.35, -12],
      [37.35, -16.4],
    ]);
    await shot('p6_stair_house');
    await walk([
      [37.35, -17.6],
      [35.5, -18.3],
      [34.7, -17.0],
      [34.7, -11.0],
      [34.7, -8.0],
    ]);
    await shot('p6_service_alley');
    await walk([
      [45, -7.4],
      [60, -7.4],
      [64, -2],
    ]);
    // lose the police: keep moving away down Euclid Ave until the stars are gone
    for (let i = 0; i < 90 && (await step()) < 5; i++) {
      if (i === 6) await shot('p6_stars_flashing');
      await b.sleep(1000);
    }
    await shot('p6_lost_them');
    await walk([
      [64.5, 10],
      [63, 21],
      [40, 23.5],
      [10, 24],
      [0.4, 24.4],
    ]);
    report.missions[id] = (await waitEvent('mission:pass', id, 60)) ? 'pass' : 'FAIL';
    log(id, report.missions[id]);
    await b.sleep(3000);
  }

  // ---------------------------------------------------------------- panel 7: the arrest
  if (WANT.includes('arrest')) {
    const id = 'intro2.arrest';
    await start(id);
    await atCs(3.2, 240);
    await shot('p7_cafe_wide');
    await atCs(5.8);
    await shot('p7_dye_pack');
    await atCs(9.6);
    await shot('p7_dye_face');
    await atCs(13.4);
    await shot('p7_officers');
    await atCs(18.6);
    await shot('p7_cuffed');
    await atCs(24.6);
    await shot('p7_wide_lights');
    report.missions[id] = (await waitEvent('mission:pass', id, 60)) ? 'pass' : 'FAIL';
    log(id, report.missions[id]);
    await b.sleep(3000);
  }

  // ---------------------------------------------------------------- back in the office
  if (WANT.includes('counselor2')) {
    const id = 'intro2.counselor2';
    await start(id);
    await atCs(3.0, 240);
    await shot('p7b_office_back');
    await atCs(9.0);
    await shot('p7b_counselor');
    await atCs(16.0);
    await shot('p7b_mari');
    await atCs(30.0);
    await shot('p7b_mari_hopes');
    await atCs(36.0);
    await shot('p7b_office_wide');
    report.missions[id] = (await waitEvent('mission:pass', id, 60)) ? 'pass' : 'FAIL';
    log(id, report.missions[id]);
  }

  // ---------------------------------------------------------------- nothing may stay behind
  await b.sleep(3000);
  report.leftovers = await ev(`(() => {
    let n = 0;
    game.scene.traverse((o) => { if (/^intro2:(escapeRoute|cafeAwning|cashBag|dye)/.test(o.name)) n++; });
    return { sceneObjects: n, clockPaused: !!game.time?.paused, wanted: game.wanted?.level || 0, locked: !!game.characters?.locked };
  })()`);
  log('leftovers', JSON.stringify(report.leftovers));
}

if (o.live) {
  // a live session (tools/v2/render/sess.mjs): send each eval as a command file
  const dir = o.live;
  let n = +(fs.readFileSync(path.join(dir, 'cnt'), 'utf8') || 1);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const b = {
    errors: [],
    sleep,
    async eval(expr) {
      const k = n++;
      fs.writeFileSync(path.join(dir, 'cnt'), String(n));
      fs.writeFileSync(path.join(dir, `c${k}.js`), `return await (${expr});`);
      for (;;) {
        const f = path.join(dir, `r${k}.json`);
        if (fs.existsSync(f)) {
          await sleep(30);
          let v;
          try {
            v = JSON.parse(fs.readFileSync(f, 'utf8'));
          } catch (e) {
            // still being written
            await sleep(100);
            continue;
          }
          return typeof v === 'string' && /^[[{"]/.test(v) ? JSON.parse(v) : v;
        }
        await sleep(100);
      }
    },
    async screenshot(file) {
      const k = n++;
      fs.writeFileSync(path.join(dir, 'cnt'), String(n));
      fs.writeFileSync(path.join(dir, `c${k}.js`), `//shot ${path.resolve(file)}\nreturn 1;`);
      while (!fs.existsSync(path.join(dir, `r${k}.json`))) await sleep(100);
    },
  };
  await run(b);
  try {
    report.errors = fs
      .readFileSync(path.join(dir, 'errors.txt'), 'utf8')
      .split('\n')
      .filter(Boolean)
      .slice(0, 40);
  } catch (e) {
    /* */
  }
} else {
  await withBrowser(
    { width: +(o.w || 1600), height: +(o.h || 900), maxSeconds: +(o.max || 1800) },
    async (b) => {
      await b.goto('http://127.0.0.1:5200/?mute' + (o.q || ''));
      await b.waitFor(GAME_READY, 480);
      await startGame(b);
      await b.sleep(3000);
      await run(b);
      report.errors = [...new Set(b.errors)].slice(0, 40);
    },
  );
}

fs.writeFileSync(path.join(OUT, 'report-robbery.json'), JSON.stringify(report, null, 1));
log(JSON.stringify(report.missions), 'errors', report.errors.length);
