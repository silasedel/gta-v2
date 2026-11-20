// The drop plane of the smuggling run (storyboard panel 8): the user's single-engine high-wing prop (game.air 'prop',
// Caloosa Skimmer 210) flown on a script low over the water ahead of Nico's boat. It leads along the drop line, circles
// back over the boat when the boat falls behind, and drops wrapped bales on the way (they fall, splash and float).
//
//   const plane = await createDropPlane(game, { path, start, alt });
//   plane.follow = () => pos        what it leads (default: the player); it updates itself every frame
//   plane.onDrop = (i, at) => {};   called when bale i hits the water at `at`
//   plane.done                      true once the last drop is behind it
//   plane.dispose();
import * as THREE from 'three';
import { loadMissionProp } from '../../props.js';

const GRAVITY = 9.81;
const CRUISE = 38; // m/s along the line
const SLOW = 30; // m/s while it waits for the boat
const TURN_RATE = 0.32; // rad/s at cruise (a gentle, low bank)
const LEAD_MAX = 380; // m ahead of the boat before it turns back
const LEAD_OK = 170; // m: close enough again, back on the line
const DROP_LEAD = 300; // m: the boat must be this close for a drop

const _q = new THREE.Quaternion();
const _e = new THREE.Euler();

export async function createDropPlane(game, opts) {
  const path = opts.path;
  const start = opts.start || path[0];
  const alt = opts.alt ?? 32;
  const sea = game.city?.seaLevel ?? -0.12;
  const heading0 = Math.atan2(path[0].x - start.x, path[0].z - start.z);
  const A = await game.air?.spawn?.('prop', { x: start.x, y: sea + alt, z: start.z }, heading0, {
    owned: false,
  });
  if (!A) return null;
  A.locked = true; // nobody boards a plane in flight
  A.active = true;

  const st = {
    x: start.x,
    y: sea + alt,
    z: start.z,
    h: heading0,
    speed: CRUISE,
    bank: 0,
    wp: 0,
    mode: 'line', // 'line' | 'wait' | 'away'
    drops: opts.drops || path.map((_, i) => i),
    dropped: 0,
  };
  const bales = [];
  const plane = {
    A,
    st,
    hold: false, // true: circle over the boat (the briefing at the dock)
    follow: null,
    onDrop: null,
    get done() {
      return st.mode === 'away';
    },
    get position() {
      return A.mesh.position;
    },
    update,
    dispose,
  };

  // the script flies the plane: the sim only integrates one fixed step from where we put it
  A.ap = (AA, S) => {
    _e.set(0, st.h, -st.bank, 'YXZ');
    _q.setFromEuler(_e);
    S.q.copy(_q);
    S.pos.set(st.x, st.y, st.z);
    S.vel.set(Math.sin(st.h) * st.speed, 0, Math.cos(st.h) * st.speed);
    S.w.set(0, 0, 0);
    S.ctl.throttle = 0.72;
    S.ctl.brake = 0;
    S.ctl.roll = -st.bank * 0.6;
    S.ctl.pitch = 0;
  };

  function steerTo(tx, tz, dt) {
    const want = Math.atan2(tx - st.x, tz - st.z);
    const d = Math.atan2(Math.sin(want - st.h), Math.cos(want - st.h));
    const rate = TURN_RATE * (CRUISE / Math.max(20, st.speed));
    const turn = Math.max(-rate * dt, Math.min(rate * dt, d));
    st.h += turn;
    // bank into the turn (coordinated: tan(bank) = v * omega / g)
    const omega = turn / Math.max(1e-3, dt);
    const bankWant = Math.atan((st.speed * omega) / GRAVITY);
    st.bank += (bankWant - st.bank) * Math.min(1, dt * 2.5);
  }

  function update(dt, boat) {
    if (!dt || A.disposed) return;
    const bx = boat?.x ?? st.x;
    const bz = boat?.z ?? st.z;
    const lead = Math.hypot(st.x - bx, st.z - bz);
    if (st.mode === 'line' && lead > LEAD_MAX) st.mode = 'wait';
    if (st.mode === 'wait' && lead < LEAD_OK && !plane.hold) st.mode = 'line';
    if (plane.hold && st.mode === 'line') st.mode = 'wait';
    let tx;
    let tz;
    if (st.mode === 'wait') {
      // turn back and pass over the boat, then pick the line up again
      tx = bx;
      tz = bz;
      st.speed += (SLOW - st.speed) * Math.min(1, dt);
    } else if (st.mode === 'line') {
      const p = path[st.wp];
      tx = p.x;
      tz = p.z;
      st.speed += (CRUISE - st.speed) * Math.min(1, dt);
      if (Math.hypot(st.x - p.x, st.z - p.z) < 45) passWaypoint(lead);
    } else {
      // away: climb out to the west and keep going
      tx = st.x + Math.sin(st.h) * 500;
      tz = st.z + Math.cos(st.h) * 500;
      st.y += dt * 4;
      st.speed += (46 - st.speed) * Math.min(1, dt * 0.5);
    }
    steerTo(tx, tz, dt);
    st.x += Math.sin(st.h) * st.speed * dt;
    st.z += Math.cos(st.h) * st.speed * dt;
    // the drop run is flown low
    const low = st.mode === 'line' && st.wp > 0 ? alt * 0.7 : alt;
    if (st.mode !== 'away') st.y += (sea + low - st.y) * Math.min(1, dt * 0.6);
    updateBales(dt);
  }

  // a drop happens only with the boat close behind; else the plane goes round again and comes back to this point
  function passWaypoint(lead) {
    if (st.drops.includes(st.wp)) {
      if (lead > DROP_LEAD) {
        st.mode = 'wait';
        return;
      }
      dropBale(st.dropped++);
    }
    st.wp++;
    if (st.wp >= path.length) st.mode = 'away';
  }

  // a bale leaves the cargo door and falls with the plane's speed
  async function dropBale(i) {
    const b = {
      i,
      x: st.x,
      y: st.y - 1.2,
      z: st.z,
      vx: Math.sin(st.h) * st.speed * 0.8,
      vz: Math.cos(st.h) * st.speed * 0.8,
      vy: 0,
      obj: null,
      landed: false,
    };
    bales.push(b);
    try {
      b.obj = await loadMissionProp('package_waterproof');
      b.obj.scale.setScalar(2.1);
      b.obj.position.set(b.x, b.y, b.z);
      game.scene.add(b.obj);
    } catch (e) {
      console.warn('[dropPlane] bale', e);
    }
  }

  function updateBales(dt) {
    for (const b of bales) {
      if (b.landed) continue;
      b.vy -= GRAVITY * dt;
      b.vx *= 1 - dt * 0.35;
      b.vz *= 1 - dt * 0.35;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.z += b.vz * dt;
      if (b.obj) {
        b.obj.position.set(b.x, b.y, b.z);
        b.obj.rotation.x += dt * 2.1;
        b.obj.rotation.z += dt * 1.3;
      }
      if (b.y <= sea) {
        b.landed = true;
        if (b.obj) game.scene.remove(b.obj);
        splash(b.x, b.z);
        plane.onDrop?.(b.i, { x: b.x, z: b.z });
      }
    }
  }

  function splash(x, z) {
    try {
      game.fx?.splash?.(new THREE.Vector3(x, sea, z), 1.6);
    } catch (e) {
      /* the fx module is optional */
    }
    try {
      game.audio?.play?.('splash', { position: { x, y: sea, z }, volume: 0.9 });
    } catch (e) {
      /* */
    }
  }

  // it flies itself (one updater, removed on dispose), so it keeps flying between two missions
  const tick = (dt) => {
    const f = plane.follow ? plane.follow() : game.player?.position;
    update(dt, f);
  };
  game.updaters.push(tick);

  function dispose() {
    const i = game.updaters.indexOf(tick);
    if (i >= 0) game.updaters.splice(i, 1);
    for (const b of bales) if (b.obj) game.scene.remove(b.obj);
    bales.length = 0;
    A.ap = null;
    try {
      game.air?.remove?.(A);
    } catch (e) {
      /* */
    }
  }

  return plane;
}
