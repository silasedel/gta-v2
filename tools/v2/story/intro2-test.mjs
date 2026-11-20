#!/usr/bin/env node
// Intro v2, steps 1-2 (storyboard panels 1-4): plays intro2.opening -> intro2.prisonCell -> intro2.prisonWalk ->
// intro2.counselor1 start to finish in the game and saves a screenshot per storyboard moment.
//   node tools/v2/story/intro2-test.mjs [--missions opening,prisonCell,prisonWalk,counselor1] [--out docs/v2/shots/intro2]
//        [--q "&foo=1"] [--w 1600 --h 900] [--slow 4]
// The player is driven by script: E at the interaction prompts, teleport steps behind the guard on the walk. Reports each
// mission's result (pass / fail / timeout), console errors, and whether the prison set was disposed afterwards.
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
// cutscenes run this many times slower while filmed (screenshots on a loaded machine take seconds)
const SLOW = +(o.slow || 4);
const ALL = ['opening', 'prisonCell', 'prisonWalk', 'counselor1'];
const WANT = (o.missions || ALL.join(',')).split(',');
fs.mkdirSync(OUT, { recursive: true });

const report = { missions: {}, shots: [], errors: [] };
const log = (...m) => console.log('[intro2]', ...m);

await withBrowser(
  { width: +(o.w || 1600), height: +(o.h || 900), maxSeconds: +(o.max || 1500) },
  async (b) => {
    await b.goto('http://127.0.0.1:5200/?mute' + (o.q || ''));
    await b.waitFor(GAME_READY, 480);
    await startGame(b);
    await b.sleep(3000);
    await b.eval(`game.cutsceneSlow = ${SLOW}; true`);
    // pass / fail events into a page-side log
    await b.eval(`(() => {
      window.__i2 = { events: [] };
      for (const ev of ['mission:start', 'mission:pass', 'mission:fail', 'mission:quit', 'cutscene:start', 'cutscene:end'])
        game.on(ev, (d) => window.__i2.events.push({ ev, id: d && d.id, t: performance.now() }));
      return true;
    })()`);

    const shot = async (name) => {
      const f = path.join(OUT, name + '.png');
      await b.screenshot(f);
      report.shots.push(f);
      log('shot', f);
    };
    // wait until shot `i` of the running cutscene is on screen, then `after` seconds more (the move and focus settle)
    const atShot = async (i, after = 1.2, maxS = 120) => {
      for (let k = 0; k < maxS * 5; k++) {
        const now = await b.eval(
          'game.story.cutscenes.active ? game.story.cutscenes.active.shot ?? -1 : -2',
        );
        if (now >= i) {
          await b.sleep(after * SLOW * 1000);
          return true;
        }
        await b.sleep(200);
      }
      return false;
    };
    const waitEvent = async (ev, id, maxS = 120) => {
      for (let i = 0; i < maxS * 2; i++) {
        const hit = await b.eval(
          `window.__i2.events.some((e) => e.ev === ${JSON.stringify(ev)} && e.id === ${JSON.stringify(id)})`,
        );
        if (hit) return true;
        const failed = await b.eval(
          `window.__i2.events.find((e) => e.ev === 'mission:fail' && e.id === ${JSON.stringify(id)}) ? true : false`,
        );
        if (failed) return false;
        await b.sleep(500);
      }
      return false;
    };
    const step = () => b.eval('game.story.active ? game.story.active.index : -1');
    const waitStep = async (n, maxS = 60) => {
      for (let i = 0; i < maxS * 4; i++) {
        if ((await step()) >= n) return true;
        await b.sleep(250);
      }
      return false;
    };
    const pressE = async () => {
      await b.key('KeyE', true, 'e');
      await b.sleep(120);
      await b.key('KeyE', false, 'e');
    };
    const start = async (id) => {
      await b.eval(`game.story.startMission(${JSON.stringify(id)}).then(() => true)`);
      log('started', id);
    };

    // ---------------------------------------------------------------- 1. opening (panel 1 + the cut to the prison)
    if (WANT.includes('opening')) {
      const id = 'intro2.opening';
      await start(id);
      const opening = [
        [0, 3.0, 'p1_wide'],
        [1, 2.2, 'p1_ots_mari'],
        [2, 2.0, 'p1_ots_nico'],
        [3, 1.6, 'p1_close_mari'],
        [4, 2.5, 'p1_twoshot'],
        [5, 1.5, 'p1_close_nico'],
        [6, 3.5, 'p1_crane'],
        [8, 2.0, 'p1b_card_corridor'],
        [9, 2.0, 'p1b_cell_door'],
        [10, 3.0, 'p1b_cell_window'],
      ];
      for (const [i, after, name] of opening) {
        if (await atShot(i, after)) await shot(name);
      }
      report.missions[id] = (await waitEvent('mission:pass', id, 60)) ? 'pass' : 'FAIL';
      log(id, report.missions[id]);
      await b.sleep(2500);
    }

    // ---------------------------------------------------------------- 2. the cell (panel 2)
    if (WANT.includes('prisonCell')) {
      const id = 'intro2.prisonCell';
      await start(id);
      await b.sleep(3500);
      await shot('p2_cell_play');
      // walk up to Dolores (teleport beside her) and press E
      await b.eval(`(() => {
        const h = game.story.active.ctx.h.cellmate.root.position;
        game.teleport(h.x + 0.9, h.y, h.z - 0.75, -0.9);
        return true;
      })()`);
      await b.sleep(1500);
      await shot('p2_cell_prompt');
      for (let i = 0; i < 6 && (await step()) < 1; i++) {
        await pressE();
        await b.sleep(700);
      }
      for (const [i, after, name] of [
        [0, 2.4, 'p2_cell_ots'],
        [1, 2.5, 'p2_cell_dolores'],
        [2, 2.5, 'p2_cell_mari'],
        [3, 4.2, 'p2_cell_door'],
      ]) {
        if (await atShot(i, after)) await shot(name);
      }
      await waitStep(2, 60);
      await b.sleep(1200);
      await shot('p2_cell_guard');
      await b.eval(`(() => {
        const s = game.story.active.ctx;
        const p = game.story.active.def.steps[2].trigger.reach.at;
        game.teleport(p.x, p.y, p.z, Math.PI);
        return true;
      })()`);
      report.missions[id] = (await waitEvent('mission:pass', id, 30)) ? 'pass' : 'FAIL';
      log(id, report.missions[id]);
      await b.sleep(2500);
    }

    // ---------------------------------------------------------------- 3. the walk (panel 3)
    if (WANT.includes('prisonWalk')) {
      const id = 'intro2.prisonWalk';
      await start(id);
      await b.sleep(2500);
      // follow 2.4 m behind the guard, facing him (a teleport step every 0.4 s), screenshots on the way
      const marks = {
        3: 'p3_walk_start',
        14: 'p3_walk_dayroom',
        30: 'p3_walk_corridor',
        52: 'p3_walk_end',
      };
      for (let i = 0; i < 160; i++) {
        const r = await b.eval(`(() => {
          const A = game.story.active;
          if (!A || A.index > 0) return 'done';
          const g = A.ctx.h.guard.root;
          const h = g.rotation.y;
          const x = g.position.x - Math.sin(h) * 2.4;
          const z = g.position.z - Math.cos(h) * 2.4;
          game.teleport(x, g.position.y, z, h);
          return 'ok';
        })()`);
        if (r === 'done') break;
        if (marks[i]) await shot(marks[i]);
        await b.sleep(400);
      }
      if (await atShot(0, 2.6)) await shot('p3_office_door');
      report.missions[id] = (await waitEvent('mission:pass', id, 40)) ? 'pass' : 'FAIL';
      log(id, report.missions[id]);
      await b.sleep(2500);
    }

    // ---------------------------------------------------------------- 4. the counselor (panel 4)
    if (WANT.includes('counselor1')) {
      const id = 'intro2.counselor1';
      await start(id);
      for (const [i, after, name] of [
        [0, 3.0, 'p4_office_wide'],
        [1, 3.0, 'p4_ots_counselor'],
        [2, 2.5, 'p4_ots_mari'],
        [3, 3.0, 'p4_ots_counselor2'],
        [4, 2.5, 'p4_mari'],
        [5, 3.5, 'p4_pushin'],
        [5, 6.6, 'p4_flashback'],
      ]) {
        if (await atShot(i, i === 5 && name === 'p4_flashback' ? 3.1 : after)) await shot(name);
      }
      report.missions[id] = (await waitEvent('mission:pass', id, 60)) ? 'pass' : 'FAIL';
      log(id, report.missions[id]);
    }

    // ---------------------------------------------------------------- leave the prison: the set must go
    await b.eval('game.story.toHouse(); true');
    await b.sleep(4000);
    report.setAfterLeaving = await b.eval(
      `(() => { let n = 0; game.scene.traverse((o) => { if (/^set:prison/.test(o.name)) n++; }); return n; })()`,
    );
    report.errors = [...new Set(b.errors)].slice(0, 40);
    log('set roots left in the scene after leaving:', report.setAfterLeaving);
  },
);

fs.writeFileSync(path.join(OUT, 'prison_report.json'), JSON.stringify(report, null, 1));
log(JSON.stringify(report.missions), 'errors', report.errors.length);
