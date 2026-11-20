// Collision-vs-drawn audit (Nov 19, user: "an invisible wall in the middle of nowhere", "driving through random
// things", "an NPC halfway through the ground", "sinking into the sand going up a hill").
// For sample areas across the map the player is teleported along the roads; at each stop tools/v2/physics/phantomsPage.js
//   - casts rays along every road lane and over open ground at car height (0.6 / 1.2 m):
//       phantom  = a collider wall with no visible mesh within 0.5 m of the hit point
//       missing  = a solid visible wall with no collider within 0.35 m behind it
//   - compares drawn ground, collider ground and city.groundHeightAt (what NPCs stand on) on a 3 m grid.
// Every collider's creator (file:line) is recorded by an init hook on world.createCollider, so each phantom names its source.
//   node tools/v2/physics/phantoms.mjs [--areas downtown,keys,...] [--stops 4] [--tag before] [--q "&x=1"]
// Output: docs/v2/reports/physics-phantoms[-tag].json and a summary on stdout.
import fs from 'node:fs';
import { withBrowser, GAME_READY, startGame } from '../browser.mjs';

function parseArgs(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const k = argv[i].slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        o[k] = next;
        i++;
      } else {
        o[k] = true;
      }
    }
  }
  return o;
}

const o = parseArgs(process.argv.slice(2));

// name: [x, z, terrain grid on/off]
const AREAS = {
  downtown: [407, -110, false],
  beach: [2398, 660, true],
  keys: [-1155, 5500, true],
  marathon: [-2783, 6600, true],
  homestead: [-1320, 3190, true],
  clewiston: [-1540, -2805, true],
  naples: [-4730, -220, true],
  everglades: [-2600, 1200, true],
  hills: [null, null, true],
};

const AREA_LIST = String(
  o.areas || 'downtown,beach,keys,homestead,clewiston,everglades,hills',
).split(',');
const STOPS = +(o.stops || 4);
const STOP_SPACING = 90;
const ROAD_RAD = 48;

// Records who created each collider (handle -> "file:line < file:line"). Installed before the game boots.
const OWNER_HOOK = `(() => {
  const owners = new Map();
  window.__colOwners = owners;
  const where = () => {
    const lines = String(new Error().stack || '').split('\\n').slice(3);
    const out = [];
    for (const l of lines) {
      const m = l.match(/\\/(src\\/[^?:)]+)(?:\\?[^:)]*)?:(\\d+)/);
      if (m && !/physicsGuard/.test(m[1])) {
        out.push(m[1].replace(/^src\\//, '') + ':' + m[2]);
      }
      if (out.length >= 2) {
        break;
      }
    }
    return out.join(' < ') || 'no-src';
  };
  const patch = (w) => {
    if (!w || w.__ownersPatched) {
      return;
    }
    w.__ownersPatched = true;
    const create = w.createCollider.bind(w);
    w.createCollider = (desc, parent) => {
      const c = create(desc, parent);
      try {
        owners.set(c.handle, where());
      } catch (e) {
        // never break the game
      }
      return c;
    };
  };
  let value;
  Object.defineProperty(window, 'game', {
    configurable: true,
    get() {
      return value;
    },
    set(v) {
      value = v;
      try {
        patch(v && v.world);
      } catch (e) {
        // ignore
      }
    },
  });
})();`;

function quantiles(arr) {
  if (!arr.length) {
    return null;
  }
  const a = arr.map(Math.abs).sort((x, y) => x - y);
  const q = (p) => a[Math.min(a.length - 1, Math.floor(p * a.length))];
  return {
    n: a.length,
    p50: +q(0.5).toFixed(3),
    p95: +q(0.95).toFixed(3),
    max: +a[a.length - 1].toFixed(3),
  };
}

function groupBy(list, keyOf) {
  const m = {};
  for (const f of list) {
    const k = keyOf(f);
    m[k] = (m[k] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(m).sort((a, b) => b[1] - a[1]));
}

const report = { tag: o.tag || null, q: o.q || '', areas: [], totals: {} };
const pageJs = fs.readFileSync(new URL('./phantomsPage.js', import.meta.url), 'utf8');

await withBrowser({ width: 960, height: 540, maxSeconds: 2400 }, async (b) => {
  await b.send('Page.addScriptToEvaluateOnNewDocument', { source: OWNER_HOOK });
  await b.goto('http://127.0.0.1:5200/?mute' + (o.q || ''));
  await b.waitFor(GAME_READY + " && typeof game.teleport === 'function'", 600);
  await startGame(b);
  await b.eval(`(() => { game.timeExternal = true; game.timeOfDay = 12; return 1; })()`);
  await b.eval(pageJs);

  for (const name of AREA_LIST) {
    let [ax, az, doTerrain] = AREAS[name] || [];
    if (name === 'hills') {
      // the steepest synthetic land on the map (dunes, levees, hills)
      const pick = JSON.parse(
        await b.eval(`JSON.stringify((() => {
          const C = game.city;
          const th = C.terrain?.heightAt || ((x, z) => C.groundHeightAt(x, z));
          let best = null;
          for (let x = -7600; x < 3800; x += 120) {
            for (let z = -8700; z < 7600; z += 120) {
              if (C.isWater(x, z) || C.isWater(x + 60, z) || C.isWater(x - 60, z) || C.isWater(x, z + 60) || C.isWater(x, z - 60)) continue;
              if (C.terrain?.real?.(x, z)) continue;
              const s = Math.abs(th(x + 8, z) - th(x - 8, z)) + Math.abs(th(x, z + 8) - th(x, z - 8));
              if (!best || s > best.s) best = { x, z, s };
            }
          }
          return best;
        })())`),
      );
      ax = pick.x;
      az = pick.z;
      console.log('hills at', pick);
    }
    // stops: road points near the area center, at least STOP_SPACING apart
    const stops = JSON.parse(
      await b.eval(`JSON.stringify((() => {
        const G = game.city.roadGraph;
        const pts = [];
        for (const e of G.edges) {
          if (e.elevated || e.bridge) continue;
          for (const p of e.pts) {
            const d = Math.hypot(p[0] - ${ax}, p[1] - ${az});
            if (d < 400) pts.push([p[0], p[1], d]);
          }
        }
        pts.sort((a, b) => a[2] - b[2]);
        const out = [];
        for (const p of pts) {
          if (out.every((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) >= ${STOP_SPACING})) out.push(p);
          if (out.length >= ${STOPS}) break;
        }
        if (!out.length) out.push([${ax}, ${az}, 0]);
        return out.map((p) => [+p[0].toFixed(1), +p[1].toFixed(1)]);
      })())`),
    );
    const area = { name, center: [ax, az], stops: [] };
    let first = true;
    for (const [x, z] of stops) {
      await b.eval(`(() => { game.teleport(${x}, undefined, ${z}); return 1; })()`);
      await b.sleep(first ? 9000 : 3500);
      first = false;
      await b.waitFor(`!game.city.collidersReadyAt || game.city.collidersReadyAt(${x}, ${z})`, 60);
      await b.sleep(1500);
      const r = JSON.parse(
        await b.eval(
          `JSON.stringify((() => {
          const P = game.player.position;
          const px = P.x;
          const pz = P.z;
          const roads = __ph.roads(px, pz, ${ROAD_RAD});
          const open = __ph.open(px, pz, ${ROAD_RAD}, 30);
          const terr = ${doTerrain ? `__ph.terrain(px, pz, 36, 3)` : 'null'};
          // switched-off colliders in the whole world, by creator (tile props wait for their near build)
          const off = {};
          game.world.forEachCollider((c) => {
            if (c.isEnabled()) return;
            const k = window.__colOwners.get(c.handle) || 'unknown';
            off[k] = (off[k] || 0) + 1;
          });
          return { at: [+px.toFixed(1), +pz.toFixed(1)], roads, open, terr, off };
        })())`,
          600000,
        ),
      );
      const ph = r.roads.phantoms.concat(r.open.phantoms);
      const mi = r.roads.missing.concat(r.open.missing);
      console.log(
        `${name} @${r.at}: road ${r.roads.roadM.toFixed(0)} m, phantom rays ${ph.length}, ` +
          `missing rays ${mi.length}` +
          (r.terr ? `, terrain n=${r.terr.n}` : ''),
      );
      area.stops.push(r);
    }
    report.areas.push(area);
  }
  if (b.errors.length) {
    report.consoleErrors = b.errors.slice(0, 20);
  }
});

// ---- summary ----
let roadM = 0;
const phantoms = [];
const missing = [];
const roadPhantoms = [];
const dmc = [];
const gmc = [];
const npc = [];
const lod = [];
for (const a of report.areas) {
  for (const s of a.stops) {
    roadM += s.roads.roadM;
    for (const f of s.roads.phantoms) {
      roadPhantoms.push({ ...f, area: a.name });
    }
    for (const f of s.roads.phantoms.concat(s.open.phantoms)) {
      phantoms.push({ ...f, area: a.name });
    }
    for (const f of s.roads.missing.concat(s.open.missing)) {
      missing.push({ ...f, area: a.name });
    }
    if (s.terr) {
      dmc.push(...s.terr.drawnMinusCol);
      gmc.push(...(s.terr.ghaMinusDrawn || []));
      npc.push(...(s.terr.npcMinusDrawn || []));
      lod.push(...(s.terr.lodDrawnMinusCol || []));
    }
  }
}

// one finding per 2 m cell and source
function clusterOf(list, keyName) {
  const m = new Map();
  for (const f of list) {
    const k = Math.round(f.x / 2) + ',' + Math.round(f.z / 2) + ',' + f[keyName];
    const e = m.get(k);
    if (e) {
      e.n++;
    } else {
      m.set(k, { ...f, n: 1 });
    }
  }
  return [...m.values()];
}

const phC = clusterOf(phantoms, 'owner');
const miC = clusterOf(missing, 'mesh');
const roadPhC = clusterOf(roadPhantoms, 'owner');
report.totals = {
  roadKm: +(roadM / 1000).toFixed(2),
  roadPhantomsPerKm: +(roadPhC.length / Math.max(0.001, roadM / 1000)).toFixed(2),
  phantomClusters: phC.length,
  phantomClustersInView: phC.filter((f) => f.inView !== false).length,
  staticPhantomClusters: phC.filter((f) => f.body !== 'dynamic').length,
  missingClusters: miC.length,
  phantomByOwner: groupBy(
    phC,
    (f) =>
      f.owner +
      ' [' +
      f.body +
      ' ' +
      f.shape +
      (f.tileNear === false ? ', before near build' : '') +
      (f.inView === false ? ', out of view' : '') +
      ']',
  ),
  missingByMesh: groupBy(miC, (f) => f.mesh),
  terrainDrawnMinusCollider: quantiles(dmc),
  groundHeightAtMinusDrawn: quantiles(gmc),
  npcGroundMinusDrawn: quantiles(npc),
  terrainSinkOver3cm: dmc.filter((d) => d > 0.03).length,
  terrainFloatOver3cm: dmc.filter((d) => d < -0.03).length,
  lodOnlyGroundMinusCollider: quantiles(lod),
};
report.phantomList = phC.sort((a, b) => b.n - a.n).slice(0, 200);
report.missingList = miC.sort((a, b) => b.n - a.n).slice(0, 200);
const file = `docs/v2/reports/physics-phantoms${o.tag ? '-' + o.tag : ''}.json`;
fs.writeFileSync(file, JSON.stringify(report, null, 1));
console.log(JSON.stringify(report.totals, null, 1));
console.log('wrote', file);
