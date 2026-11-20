// Hovering-car check (Nov 19, user: "a car was hovering because its wheels were inside it"). Visits a few spots, waits for
// the traffic and parked cars to settle, and lists every car whose wheels do not reach the ground: the gap between the
// lowest visual wheel bottom and the static ground under the car, plus the wheel tuck (how far each visual wheel sits
// above its resting position) and the car's tier (frozen / ghost / dynamic).
//   node tools/v2/physics/hovercheck.mjs [--spots "407,-110;0,1760"] [--wait 20]
import { withBrowser, GAME_READY, startGame } from '../browser.mjs';
const a = process.argv.slice(2),
  o = {};
for (let i = 0; i < a.length; i++)
  if (a[i].startsWith('--')) {
    const k = a[i].slice(2);
    o[k] = a[i + 1] && !a[i + 1].startsWith('--') ? a[++i] : true;
  }
const SPOTS = String(o.spots || '407,-110;0,1760;-660,-55')
  .split(';')
  .map((s) => s.split(',').map(Number));
const WAIT = +(o.wait || 20);
const Q = o.q || '';
const SCAN = `(() => {
  const W = game.world, R = game.RAPIER, out = [];
  const pp = game.player.position;
  const QF = R.QueryFilterFlags;
  for (const v of game.vehicles.list || []) {
    if (!v.body || v.disposed || v.isBoat || v.isAircraft) continue;
    const t = v.body.translation();
    const d = Math.hypot(t.x - pp.x, t.z - pp.z);
    if (d > 140) continue;
    const ray = new R.Ray({ x: t.x, y: t.y + 0.5, z: t.z }, { x: 0, y: -1, z: 0 });
    const h = W.castRay(ray, 8, true, QF.EXCLUDE_DYNAMIC | QF.EXCLUDE_KINEMATIC | QF.EXCLUDE_SENSORS);
    const gy = h ? t.y + 0.5 - h.timeOfImpact : null;
    let underTag = null;
    try {
      const c = h && W.getCollider ? W.getCollider(h.collider?.handle ?? h.collider) : h?.collider;
      underTag = c ? (game.city?.colTags?.get?.(c.handle) || c.parent()?.userData?.tag || 'static') : null;
    } catch (e) { underTag = '?'; }
    // per wheel: what the wheel itself stands on (ray straight down from the wheel hub, own body excluded)
    const wheelGap = [];
    for (const w of v.car?.wheels || []) {
      const wp = new w.steer.position.constructor();
      w.steer.getWorldPosition(wp);
      const wr = new R.Ray({ x: wp.x, y: wp.y + 0.6, z: wp.z }, { x: 0, y: -1, z: 0 });
      const wh = W.castRay(wr, 4, true, QF.EXCLUDE_SENSORS, undefined, undefined, v.body);
      wheelGap.push(wh ? +(wp.y - (v.spec?.r || 0.33) - (wp.y + 0.6 - wh.timeOfImpact)).toFixed(3) : null);
    }
    const terrain = game.city?.groundHeightAt?.(t.x, t.z) ?? null;
    const rest = v.groundOff - (v.spec?.r || 0.33);
    const tuck = (v.car?.wheels || []).map((w) => +(w.steer.position.y + rest).toFixed(3));
    const bottom = t.y - v.groundOff;
    out.push({
      id: v.id, key: v.typeKey || v.spec?.key, d: Math.round(d),
      tier: v.frozen ? 'frozen' : v.ghost ? 'ghost' : 'dyn',
      parked: !!v.parked, ai: !!v.ai, far: !!v.car?.isFar,
      gap: gy == null ? null : +(bottom - gy).toFixed(3),
      terrainGap: terrain == null ? null : +(bottom - terrain).toFixed(3),
      tuck, wheelGap, underTag, vc: !!v.vc, enabled: v.body.isEnabled ? v.body.isEnabled() : null,
      x: Math.round(t.x), z: Math.round(t.z),
    });
  }
  return JSON.stringify(out);
})()`;
await withBrowser({ width: 960, height: 540, maxSeconds: 900 }, async (b) => {
  await b.goto('http://127.0.0.1:5200/?mute' + Q);
  await b.waitFor(GAME_READY + " && typeof game.teleport === 'function'", 600);
  await startGame(b);
  for (const [x, z] of SPOTS) {
    await b.eval(`(game.teleport(${x}, undefined, ${z}), 1)`);
    await b.sleep(WAIT * 1000);
    const cars = JSON.parse(await b.eval(SCAN));
    const bad = cars.filter(
      (c) =>
      (c.gap != null && Math.abs(c.gap) > 0.12) ||
      c.tuck.some((u) => u > 0.1) ||
      c.wheelGap.some((g) => g != null && g > 0.12),
    );
    console.log(`spot ${x},${z}: ${cars.length} cars, ${bad.length} suspicious`);
    for (const c of bad) console.log('  ', JSON.stringify(c));
  }
});
