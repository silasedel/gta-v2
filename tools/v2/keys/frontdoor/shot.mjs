#!/usr/bin/env node
// Nico's front door, looking south (docs/v2/plan/nico_house/front_door_south_view_TARGET.webp).
//   node tools/v2/keys/frontdoor/shot.mjs --set f1 [--only door,top] [--q "&foo=1"] [--probe file.js]
// Views (house frame B of plan4.js for the eye, compass heading for the look):
//   door  : standing on the front walkway at the front door, third-person camera height, looking south
//   top   : straight down over the drive and the street in front of the house, north up
//   low   : head height on the drive, looking north back at the house (collider / layout sanity)
// Writes docs/v2/shots/house_front_nov19/<set>_<view>.png and the side-by-side sheet <set>_sheet.jpg (sheet.py).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { withBrowser, GAME_READY, startGame } from '../../browser.mjs';

const args = process.argv.slice(2);
const o = {};
for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith('--')) {
    const k = args[i].slice(2);
    const next = args[i + 1];
    o[k] = next && !next.startsWith('--') ? args[++i] : true;
  }
}
const SET = o.set || 'f0';
const DIR = path.resolve('docs/v2/shots/house_front_nov19');
fs.mkdirSync(DIR, { recursive: true });

// eye: [bx, height above the deck floor (or the yard grade when ground: true), bz] in the house frame B
const VIEWS = {
  door: { eye: [-7.5, 2.6, -9.2], hdg: 141.5, pitch: -26, fov: 58, deck: true },
  top: { eye: [-6.5, 75, -7], top: true, fov: 50, south: 17 },
  low: { eye: [-20, 1.7, 0], hdg: 0, pitch: 4, fov: 66, lookAtHouse: true },
};
if (o.eye) VIEWS.door.eye = String(o.eye).split(',').map(Number);
if (o.hdg) VIEWS.door.hdg = +o.hdg;
if (o.pitch) VIEWS.door.pitch = +o.pitch;
if (o.fov) VIEWS.door.fov = +o.fov;
const only = o.only ? String(o.only).split(',') : ['door', 'top'];
const report = { set: SET, when: new Date().toISOString(), shots: {} };

await withBrowser(
  { width: +(o.w || 1600), height: +(o.h || 1050), maxSeconds: +(o.max || 1500) },
  async (b) => {
    await b.goto((o.url || 'http://127.0.0.1:5200/') + '?mute' + (o.q || ''));
    try {
      await b.waitFor(
        GAME_READY + " && typeof game.teleport === 'function' && !!game.nicoHouse",
        480,
      );
    } catch (e) {
      console.log('ERRORS\n' + [...new Set(b.errors)].slice(0, 30).join('\n'));
      throw e;
    }
    if (!(await startGame(b))) {
      console.log('WARN: title did not close');
    }
    await b.eval(`(() => {
      const t = document.getElementById('title');
      if (t) t.style.display = 'none';
      game.timeExternal = true;
      const st = document.createElement('style');
      st.textContent = 'body * { visibility: hidden !important; } canvas.fd-shot { visibility: visible !important; }';
      document.head.appendChild(st);
      game.renderer.domElement.classList.add('fd-shot');
      return 1;
    })()`);
    if (o.probe) {
      const pr = await b.eval(fs.readFileSync(o.probe, 'utf8'));
      const out = path.join(DIR, `${SET}_probe.json`);
      fs.writeFileSync(out, typeof pr === 'string' ? pr : JSON.stringify(pr, null, 1));
      console.log('probe written', out);
    }
    for (const id of only) {
      const v = VIEWS[id];
      if (!v) {
        continue;
      }
      const res = await b.eval(`(async () => {
        const v = ${JSON.stringify(v)};
        const T = game.THREE;
        const NH = game.nicoHouse;
        const P = await import('/src/world/setpieces/nicoHouse/r4/plan4.js');
        const gy = NH.group.position.y;
        const toW = (bx, bz) => {
          const [gx, gz] = P.BtoG(bx, bz);
          return NH.toWorld(new T.Vector3(gx, 0, gz));
        };
        const w = toW(v.eye[0], v.eye[2]);
        const baseY = v.deck ? gy + P.P4.F : gy;
        const eye = new T.Vector3(w.x, baseY + v.eye[1], w.z + (v.south || 0));
        let look;
        if (v.top) {
          look = new T.Vector3(eye.x, gy, eye.z - 0.001);
        } else if (v.lookAtHouse) {
          const c = toW(-1, -7);
          look = new T.Vector3(c.x, gy + 3, c.z);
        } else {
          const h = (v.hdg * Math.PI) / 180;
          const p = (v.pitch * Math.PI) / 180;
          const dir = new T.Vector3(Math.sin(h) * Math.cos(p), Math.sin(p), -Math.cos(h) * Math.cos(p));
          look = eye.clone().add(dir);
        }
        game.timeOfDay = 11;
        if (game.weather?.set) {
          try {
            game.weather.set('clear', { instant: true });
            game.weather.hold?.(true);
          } catch (e) {}
        }
        try {
          game.teleport(eye.x, undefined, eye.z, 0);
        } catch (e) {}
        game.cameraOverride = (dt, cam) => {
          cam.position.copy(eye);
          if (v.top) {
            cam.up.set(0, 0, -1);
          } else {
            cam.up.set(0, 1, 0);
          }
          cam.lookAt(look);
          if (cam.fov !== v.fov) {
            cam.fov = v.fov;
            cam.updateProjectionMatrix();
          }
          return true;
        };
        if (game.player?.mesh) {
          game.player.mesh.visible = false;
        }
        const door = toW(-6.5, -7);
        return { eye: [eye.x, eye.y, eye.z], door: [door.x, door.z], gy };
      })()`);
      await b.sleep(+(o.settle || 4000));
      for (let i = 0; i < 30; i++) {
        const q = await b.eval('(game.city?.streamer?.pending?.() ?? 0)');
        if (q < 3) {
          break;
        }
        await b.sleep(1000);
      }
      await b.sleep(1500);
      const file = path.join(DIR, `${SET}_${id}.png`);
      await b.screenshot(file);
      const calls = await b.eval('game.renderer.info.render.calls');
      report.shots[id] = { ...res, calls };
      console.log(id, JSON.stringify(report.shots[id]));
    }
    if (b.errors.length) {
      report.errors = [...new Set(b.errors)].slice(0, 40);
      console.log('ERRORS\n' + report.errors.join('\n'));
    }
  },
);
fs.writeFileSync(path.join(DIR, `${SET}_report.json`), JSON.stringify(report, null, 2));
if (only.includes('door')) {
  execFileSync('python3', ['tools/v2/keys/frontdoor/sheet.py', SET], { stdio: 'inherit' });
}
