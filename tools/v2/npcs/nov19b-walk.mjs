#!/usr/bin/env node
// Nov 19b NPC walk check: side-view walk line-ups (men and women) and front-view idles in the people preview, plus the
// clip speeds the foot sync uses. Shots in docs/v2/shots/npc_nov19b/<tag>_*.png.
//   node tools/v2/npcs/nov19b-walk.mjs            (before = ?mocap=0, then after)
//   node tools/v2/npcs/nov19b-walk.mjs after      (one tag only)
import { withBrowser } from '../browser.mjs';

const D = 'docs/v2/shots/npc_nov19b';
const RUNS = process.argv[2]
  ? [[process.argv[2], process.argv[3] || '']]
  : [
      ['before', '&mocap=0'],
      ['after', ''],
    ];
const HOST = process.env.SL_HOST || 'http://127.0.0.1:5200';
const URL = HOST + '/src/npc/people/preview.html';
const MEN = 'p02,p07,p12,p15,p171';
const WOMEN = 'p05,p30,p21,p170,p01';

await withBrowser({ width: 1400, height: 700, maxSeconds: 200 }, async (b) => {
  const shots = [
    ['walk_men_side', `ids=${MEN}&pose=walk&cam=side&cols=5&spacing=1.1&t=1.3`],
    ['walk_women_side', `ids=${WOMEN}&pose=walk&cam=side&cols=5&spacing=1.1&t=1.3`],
    ['walk_men_34', `ids=${MEN}&pose=walk&cam=34&cols=5&spacing=1.1&t=2.1`],
    ['walk_women_34', `ids=${WOMEN}&pose=walk&cam=34&cols=5&spacing=1.1&t=2.1`],
    ['run_side', `ids=p02,p05,p12&pose=run&cam=side&cols=3&spacing=1.3&t=1.2`],
  ];
  for (const [tag, extra] of RUNS) {
    for (const [name, q] of shots) {
      await b.goto(`${URL}?${q}${extra}`);
      await b.waitFor('window.ready === true', 90);
      await b.sleep(600);
      if (name === 'walk_men_side') {
        console.log(tag, 'speeds', await b.eval('JSON.stringify(window.stats.speeds)'));
      }
      await b.screenshot(`${D}/${tag}_${name}.png`);
    }
  }
  if (b.errors.length) console.log('CONSOLE ERRORS', b.errors.slice(0, 8));
});
