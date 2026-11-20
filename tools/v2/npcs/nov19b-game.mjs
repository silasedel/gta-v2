#!/usr/bin/env node
// Nov 19b in-game NPC check (one boot): crowd-tier people close to the camera with the old far mesh everywhere
// (before) and with the distance LODs (after), the crowd LOD counts, the women's jiggle state and fps.
// Shots in docs/v2/shots/npc_nov19b/game_*.png.
//   node tools/v2/npcs/nov19b-game.mjs [--at 407,-110]
import { withBrowser, GAME_READY, startGame } from '../browser.mjs';

const D = 'docs/v2/shots/npc_nov19b';
const atArg = process.argv.indexOf('--at');
const AT = (atArg > 0 ? process.argv[atArg + 1] : '407,-110').split(',').map(Number);

const STATS = `(async () => {
  const J = await import('/src/npc/people/jiggle.js');
  const peds = game.peds?.list || [];
  const women = peds.filter((p) => p.active && p.char?.human?.person && p.char.human.gender === 'f');
  const cam = game.camera.position;
  const near = women.map((p) => Math.round(p.char.root.position.distanceTo(cam))).sort((a, b) => a - b).slice(0, 6);
  return {
    crowd: game.people?.crowd?.impl?.stats?.(),
    jiggle: J.npcJiggleStats(),
    womenNear: near,
    fps: game.perf?.fps,
  };
})().then((o) => JSON.stringify(o))`;

await withBrowser({ width: 1280, height: 760, maxSeconds: 420 }, async (b) => {
  await b.goto((process.env.SL_HOST || 'http://127.0.0.1:5200') + '/?mute=1');
  await b.waitFor(GAME_READY + " && typeof game.teleport === 'function'", 300);
  if (!(await startGame(b, 60))) console.log('WARN: title did not close');
  await b.eval(
    `(() => { game.timeExternal = true; game.timeOfDay = 12; game.teleport(${AT[0]}, undefined, ${AT[1]}, 0); return 1; })()`,
  );
  await b.sleep(35000);
  console.log('stats', await b.eval(STATS));
  // the crowd-tier walker nearest to 12 m from the player: stand 5 m from it, facing it
  const T = JSON.parse(
    await b.eval(`JSON.stringify((() => {
      const L = game.people.crowd.positions();
      const pp = game.player.position;
      let best = null;
      let bd = 1e9;
      for (const p of L) {
        const d = Math.abs(Math.hypot(p[0] - pp.x, p[1] - pp.z) - 12);
        if (d < bd) { bd = d; best = p; }
      }
      return best && { x: best[0], z: best[1], n: L.length };
    })())`),
  );
  console.log('target', T);
  if (T) {
    const face = `(() => {
      const pp = game.player.position;
      const dx = ${T.x} - pp.x, dz = ${T.z} - pp.z, L = Math.hypot(dx, dz) || 1;
      const px = ${T.x} - (dx / L) * 5, pz = ${T.z} - (dz / L) * 5;
      game.teleport(px, undefined, pz, Math.atan2(dx, dz));
      return 1;
    })()`;
    await b.eval(face);
    await b.sleep(2500);
    await b.eval('game.people.crowd.impl.setLodNear?.(-1, -1); 1');
    await b.sleep(1200);
    console.log('before lods', await b.eval('JSON.stringify(game.people.crowd.impl.stats().lods)'));
    await b.screenshot(`${D}/before_game_crowd_close.png`);
    await b.eval('game.people.crowd.impl.setLodNear?.(10, 45); 1');
    await b.sleep(1200);
    console.log('after lods', await b.eval('JSON.stringify(game.people.crowd.impl.stats().lods)'));
    await b.screenshot(`${D}/after_game_crowd_close.png`);
  }
  await b.sleep(8000);
  console.log('stats', await b.eval(STATS));
  await b.screenshot(`${D}/after_game_street.png`);
  if (b.errors.length) console.log('CONSOLE ERRORS', b.errors.slice(0, 10));
});
