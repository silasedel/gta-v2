#!/usr/bin/env node
// Storyboard check for the swamp camp (intro v2 panels 10-11) and the floatplane (panel 12): starts intro2.swamp,
// waits for the camp and the gang, then films fixed cameras: the stilted shack with its porch lamp seen from the
// grass, the firefight (the camp alerted, muzzle flashes), Cisco tied up inside, the trailer with the cash, and the
// white / red floatplane at the far dock. HUD hidden. -> docs/v2/shots/intro2/camp_<name>.png
//   perl -e 'alarm shift; exec @ARGV' 900 node tools/v2/story/intro2_camp_shots.mjs [--hour 18] [--only a,b]
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
const DIR = path.resolve('docs/v2/shots/intro2');
fs.mkdirSync(DIR, { recursive: true });
const only = o.only ? String(o.only).split(',') : null;

// cameras in camp spots: [eye, look] built in the page from game.story.active.ctx.data.camp.spots
const SHOTS = {
  porch: `(s) => [[s.center.x + 15, 1.25, s.center.z - 19], [s.porch.x, 2.4, s.porch.z]]`,
  yard: `(s) => [[s.center.x + 17, 1.7, s.center.z + 6], [s.center.x - 4, 1.6, s.center.z - 3]]`,
  fight: `(s) => [[s.center.x - 3, 1.7, s.center.z + 11], [s.center.x + 7, 1.5, s.center.z - 5]]`,
  inside: `(s) => [[s.inside.x + 1.4, s.floorY + 1.6, s.inside.z - 0.6], [s.cisco.x, s.floorY + 0.6, s.cisco.z]]`,
  trailer: `(s) => [[s.cash.x - 4, 1.6, s.cash.z - 5], [s.cash.x, 0.9, s.cash.z]]`,
  dock: `(s) => [[s.dockEnd.x - 22, 2.2, s.dockEnd.z + 18], [s.dockEnd.x + 4, 1.5, s.dockEnd.z + 2]]`,
};

await withBrowser({ width: 1600, height: 900, maxSeconds: 1800 }, async (b) => {
  const T0 = Date.now();
  const lg = (m) => console.log(`[${Math.round((Date.now() - T0) / 1000)}s] ${m}`);
  await b.goto('http://127.0.0.1:5200/?mute');
  await b.waitFor(GAME_READY, 600);
  await startGame(b);
  lg('started');
  await b.eval(`(async () => {
    game.story.state.reset();
    for (const id of game.story.intro) { if (id === 'intro2.swamp') break; await game.story.skipMission(id, { save: false, teleport: false }); }
    game.story.startMission('intro2.swamp');
    return 1;
  })()`);
  // until the arrival cutscene runs: skip it, then the camp and its gang stand
  for (let i = 0; i < 400; i++) {
    await b.sleep(1000);
    const st = await b.eval(
      `(() => { const cs = game.story.cutscenes.active; if (cs) { cs.skipped = true; return 'cs'; } const r = game.story.active; return r && !r.starting ? r.index : -1; })()`,
    );
    if (st >= 1) break;
  }
  lg('in the camp');
  await b.eval(`(() => {
    game.timeOfDay = ${+(o.hour ?? 18)};
    const st = document.createElement('style');
    st.textContent = 'body * { visibility: hidden !important; } canvas { visibility: visible !important; }';
    document.head.appendChild(st);
    window.__shotSt = st;
    return 1;
  })()`);
  for (const [name, cam] of Object.entries(SHOTS)) {
    if (only && !only.includes(name)) continue;
    await b.eval(`(() => {
      const ctx = game.story.active.ctx;
      const s = ctx.data.camp.spots;
      const [eye, look] = (${cam})(s);
      if (${JSON.stringify(name)} === 'fight' || ${JSON.stringify(name)} === 'yard') {
        game.teleport(s.center.x + 3, null, s.center.z + 8, Math.PI);
        if (${JSON.stringify(name)} === 'fight') {
          // film the shoot-out, not the death: Nico takes no damage while the camera rolls
          const P = game.player;
          window.__keepAlive ||= setInterval(() => { P.health = 100; }, 100);
          ctx.data.crew?.alert('shots');
        }
      } else game.teleport(eye[0], null, eye[2] + 3, 0);
      game.player.mesh && (game.player.mesh.visible = ${JSON.stringify(name)} === 'fight' || ${JSON.stringify(name)} === 'yard');
      game.cameraOverride = (dt, c) => { c.position.set(eye[0], eye[1], eye[2]); c.lookAt(look[0], look[1], look[2]); if (c.fov !== 50) { c.fov = 50; c.updateProjectionMatrix(); } return true; };
      return 1;
    })()`);
    await b.sleep(name === 'fight' ? 2500 : 5000);
    const frames = name === 'fight' ? 4 : 1;
    for (let k = 0; k < frames; k++) {
      const f = path.join(DIR, `camp_${name}${frames > 1 ? '_' + k : ''}.png`);
      await b.screenshot(f);
      lg('shot ' + path.relative(process.cwd(), f));
      if (frames > 1) await b.sleep(350);
    }
  }
  await b.eval(
    `(() => { game.cameraOverride = null; window.__shotSt?.remove(); game.story.quitMission(); return 1; })()`,
  );
  const errs = [...new Set(b.errors)].filter((e) => e.startsWith('ERR')).slice(0, 20);
  if (errs.length) console.log('console errors', errs);
});
