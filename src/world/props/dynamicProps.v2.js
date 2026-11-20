// Light street props that react like real objects (overnight props pass, Nov 17; track: props).
//   'push'  trash / recycling carts, cones, barricades, plastic chairs, crates: a FIXED body at its resting pose until the
//           player or a vehicle reaches it, then a Rapier DYNAMIC body (and fixed again once it rests with nobody around), so
//           nothing ever settles or pops after loading and idle props cost nothing. The player's
//           character controller pushes it (kcc applyImpulsesToDynamicBodies), a car shoves it or sends it flying, it tips
//           over and can be pushed back up; once it sleeps again it stays where it ended up (pose kept on the item, so a
//           tile rebuild draws it there too).
//   'knock' mailboxes on posts, small sign posts: a FIXED collider (you cannot walk a post over) until a vehicle meets it
//           above ~6 km/h; then the post snaps and it becomes a dynamic body with the car's momentum. A slow bump only
//           bends it (a permanent lean).
// Heavy things (hydrants, lamps, dumpsters, bolted benches) stay static (hydrants keep src/world/miami/breakables.js).
//   import { dynProps } from '../props/dynamicProps.v2.js'
//   dynProps.add({ kind, cls, x, y, z, ry, rx?, rz?, s?, shapes, mass, owner, m?, setMatrix(Matrix4|null), save(m16) }) -> rec
//     shapes: colliders in the UNSCALED model frame (origin = base center, +Y up), matching the visible mesh:
//       { t: 'box', hx, hy, hz, x, y, z } | { t: 'cyl', r, hh, x, y, z }   (x/y/z = shape center). The body origin is the
//       model origin, so the drawn instance matrix is exactly the body pose (times the instance scale).
//     m = a saved pose matrix (array of 16) to start from (where the prop came to rest last time)
//   dynProps.removeOwner(owner); dynProps.stats; dynProps.near(x, z, r); game.dynProps (debug)
import * as THREE from 'three';

const CELL = 8;
const OFF = typeof location !== 'undefined' && /[?&](dynprops=0|clipfix=0)/.test(location.search);
const KNOCK_SPEED = 6 / 3.6,
  BEND_SPEED = 1.2;
const _q = new THREE.Quaternion(),
  _e = new THREE.Euler(),
  _v = new THREE.Vector3(),
  _s = new THREE.Vector3(),
  _m = new THREE.Matrix4(),
  _o = new THREE.Matrix4(),
  _p = new THREE.Vector3();

function create(game) {
  const { world, RAPIER } = game;
  const grid = new Map(),
    byOwner = new Map(),
    live = new Set();
  const stats = { items: 0, bodies: 0, awake: 0, knocked: 0, bent: 0, pushes: 0, syncMs: 0 };
  const key = (i, j) => i * 100003 + j;
  let soundT = 0;

  function poseOf(rec) {
    // base pose (Matrix4, unscaled) from a saved matrix or x/y/z + euler
    if (rec.m) {
      _m.fromArray(rec.m);
      _m.decompose(_v, _q, _s);
      return { pos: _v.clone(), q: _q.clone() };
    }
    _e.set(rec.rx || 0, rec.ry || 0, rec.rz || 0, 'XYZ');
    return {
      pos: new THREE.Vector3(rec.x, rec.y || 0, rec.z),
      q: new THREE.Quaternion().setFromEuler(_e),
    };
  }
  const volOf = (sh) =>
    sh.t === 'cyl'
      ? Math.PI * sh.r * sh.r * 2 * sh.hh
      : sh.t === 'cone'
        ? (Math.PI * sh.r * sh.r * 2 * sh.hh) / 3
        : 8 * sh.hx * sh.hy * sh.hz;
  function shapeDescs(rec) {
    // scaled collider descs, local to the body (model origin)
    const s = rec.sc,
      tot = rec.shapes.reduce((a, sh) => a + volOf(sh), 0) * s * s * s,
      dens = Math.max(4, rec.mass / Math.max(1e-4, tot));
    return rec.shapes.map((sh) =>
      (sh.t === 'cyl'
        ? RAPIER.ColliderDesc.cylinder(sh.hh * s, sh.r * s)
        : sh.t === 'cone'
          ? RAPIER.ColliderDesc.cone(sh.hh * s, sh.r * s)
          : RAPIER.ColliderDesc.cuboid(sh.hx * s, sh.hy * s, sh.hz * s)
      )
        .setTranslation((sh.x || 0) * s, (sh.y || 0) * s, (sh.z || 0) * s)
        .setFriction(rec.friction ?? 0.7)
        .setRestitution(0.05)
        .setDensity(dens),
    );
  }
  function makeBody(rec, pos, q, sleeping) {
    const b = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(pos.x, pos.y + 0.004, pos.z)
        .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
        .setLinearDamping(0.2)
        .setAngularDamping(0.45)
        .setCanSleep(true)
        .setSleeping(!!sleeping)
        .setCcdEnabled(true),
    );
    for (const d of shapeDescs(rec)) world.createCollider(d, b);
    if (rec.off) b.setEnabled(false);
    rec.body = b;
    live.add(rec);
    stats.bodies++;
    return b;
  }
  function add(rec) {
    if (OFF || !world || !RAPIER || !Number.isFinite(rec.x) || !Number.isFinite(rec.z)) return null;
    const s = rec.s || 1;
    rec.sc = s;
    rec.mass = rec.mass || 15;
    if (!rec.shapes || !rec.shapes.length)
      rec.shapes = [
        { t: 'box', hx: rec.hx || 0.25, hy: rec.hy || 0.5, hz: rec.hz || 0.25, y: rec.hy || 0.5 },
      ];
    rec.top =
      Math.max(...rec.shapes.map((sh) => (sh.y || 0) + (sh.t === 'box' ? sh.hy : sh.hh))) * s;
    rec.rad =
      Math.max(
        ...rec.shapes.map(
          (sh) =>
            Math.hypot(sh.x || 0, sh.z || 0) + (sh.t === 'box' ? Math.max(sh.hx, sh.hz) : sh.r),
        ),
      ) * s;
    rec.cls = rec.cls || 'push';
    const { pos, q } = poseOf(rec);
    if (rec.cls === 'push' && !rec.m) {
      // sit exactly on the static collider below (terrain grid / slab), so it never starts inside it and pops
      try {
        const F = RAPIER.QueryFilterFlags,
          hit = world.castRay(
            new RAPIER.Ray({ x: pos.x, y: pos.y + 0.8, z: pos.z }, { x: 0, y: -1, z: 0 }),
            1.6,
            true,
            F.EXCLUDE_DYNAMIC | F.EXCLUDE_SENSORS,
          );
        if (hit) {
          const gy = pos.y + 0.8 - hit.timeOfImpact;
          if (Math.abs(gy - pos.y) < 0.6) {
            rec._dy = gy - pos.y;
            pos.y = gy;
            rec.y = gy;
          }
        }
      } catch (e) {
        /* no query pipeline yet */
      }
    }
    try {
      // every prop starts as a FIXED body at its resting pose ('dormant'): nothing simulates, nothing can settle or pop after
      // loading. A push prop becomes a dynamic body only when the player or a vehicle actually reaches it (wake()), and goes
      // back to a fixed body at its new resting pose once it sleeps with nobody around (sleepBack()).
      fixedColliders(rec, pos, q);
      if (rec.cls === 'push') rec.dormant = true;
      if (Math.abs(rec._dy || 0) > 0.015) {
        rec.m = new THREE.Matrix4().compose(pos, q, _s.setScalar(rec.sc)).toArray();
        rec.setMatrix?.(new THREE.Matrix4().fromArray(rec.m));
      }
    } catch (e) {
      console.warn('[dynProps] add', e?.message);
      return null;
    }
    rec.k = key(Math.floor(pos.x / CELL), Math.floor(pos.z / CELL));
    rec.px = pos.x;
    rec.pz = pos.z;
    rec.py = pos.y;
    rec.t0 = performance.now();
    rec.p0 = [pos.x, pos.y, pos.z];
    let a = grid.get(rec.k);
    if (!a) grid.set(rec.k, (a = []));
    a.push(rec);
    if (rec.owner !== undefined) {
      let o = byOwner.get(rec.owner);
      if (!o) byOwner.set(rec.owner, (o = []));
      o.push(rec);
    }
    stats.items++;
    return rec;
  }
  function fixedColliders(rec, pos, q) {
    // knock-class: the same shapes as a fixed rigid body (one handle, easy to move / drop)
    const fb = world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed()
        .setTranslation(pos.x, pos.y, pos.z)
        .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }),
    );
    for (const d of shapeDescs(rec)) world.createCollider(d, fb);
    if (rec.off) fb.setEnabled(false);
    rec.fixed = fb;
  }
  function dropFixed(rec) {
    if (rec.fixed) {
      try {
        if (world.getRigidBody(rec.fixed.handle) === rec.fixed) world.removeRigidBody(rec.fixed);
      } catch (e) {
        /* gone */
      }
      rec.fixed = null;
    }
  }
  function drop(rec) {
    const a = grid.get(rec.k);
    if (a) {
      const i = a.indexOf(rec);
      if (i >= 0) {
        a[i] = a[a.length - 1];
        a.pop();
      }
      if (!a.length) grid.delete(rec.k);
    }
    if (rec.body) {
      try {
        if (world.getRigidBody(rec.body.handle) === rec.body) world.removeRigidBody(rec.body);
      } catch (e) {
        /* gone */
      }
      rec.body = null;
      live.delete(rec);
      stats.bodies--;
    }
    dropFixed(rec);
    stats.items--;
    rec.dead = true;
  }
  // physics-audit: a tile's props are drawn by its near build; until that exists their bodies are switched off
  // (src/world/miami/tilebuild.js propCollidersOn), so no undrawn sign post or cart stops a car
  function setOwnerEnabled(owner, on) {
    const o = byOwner.get(owner);
    if (!o) return;
    for (const rec of o) {
      if (rec.dead) continue;
      rec.off = !on;
      if (rec.fixed) rec.fixed.setEnabled(on);
      if (rec.body) rec.body.setEnabled(on);
    }
  }
  function removeOwner(owner) {
    const o = byOwner.get(owner);
    if (!o) return;
    for (const rec of o)
      if (!rec.dead) {
        saveBack(rec);
        drop(rec);
      }
    byOwner.delete(owner);
  }
  // the item keeps its last resting pose (rec.save(m) writes it onto the tile / lot record)
  function saveBack(rec) {
    if (rec.body && rec.moved && rec.save) {
      try {
        rec.save(visualMatrix(rec).toArray());
      } catch (e) {
        /* */
      }
    }
  }
  function visualMatrix(rec) {
    const t = rec.body.translation(),
      r = rec.body.rotation();
    _q.set(r.x, r.y, r.z, r.w);
    _v.set(t.x, t.y, t.z);
    return _o.compose(_v, _q, _s.setScalar(rec.sc));
  }
  function wake(rec, why) {
    // dormant push prop -> dynamic body (awake, no impulse: the contact does the pushing)
    const { pos, q } = poseOf(rec);
    dropFixed(rec);
    rec.dormant = false;
    makeBody(rec, pos, q, false);
    stats.wakes = (stats.wakes || 0) + 1;
    rec.why = why;
  }
  function sleepBack(rec) {
    // resting dynamic body -> fixed body at its pose (keeps the physics islands tiny)
    const M = visualMatrix(rec);
    rec.m = M.toArray();
    rec.save?.(rec.m);
    rec.setMatrix?.(M);
    try {
      if (world.getRigidBody(rec.body.handle) === rec.body) world.removeRigidBody(rec.body);
    } catch (e) {
      /* */
    }
    rec.body = null;
    live.delete(rec);
    stats.bodies--;
    const { pos, q } = poseOf(rec);
    fixedColliders(rec, pos, q);
    rec.dormant = true;
  }
  function knock(rec, vx, vz, speed, car) {
    // fixed post -> dynamic body moving with the car
    const { pos, q } = poseOf(rec);
    dropFixed(rec);
    rec.cls = 'push';
    const b = makeBody(rec, pos, q, false),
      k = 0.75 + Math.random() * 0.25;
    b.setLinvel({ x: vx * k, y: 1.2 + speed * 0.12, z: vz * k }, true);
    b.setAngvel(
      { x: (Math.random() - 0.5) * 6, y: (Math.random() - 0.5) * 3, z: (Math.random() - 0.5) * 6 },
      true,
    );
    rec.moved = true;
    stats.knocked++;
    rec.why = 'knock';
    sound(rec, pos, 0.4);
    game.emit?.('propKnock', { kind: rec.kind, x: pos.x, z: pos.z, speed });
    if (car && game.physics?.impacts)
      try {
        const hit = () =>
          game.physics.propImpact?.(car, {
            kind: rec.kind,
            x: pos.x,
            y: pos.y,
            z: pos.z,
            top: rec.top,
            broke: true,
          });
        if (game.physics.deferImpact)
          game.physics.deferImpact(car, { x: pos.x, z: pos.z, r: rec.rad || 0.15 }, hit);
        else hit();
      } catch (e) {
        /* */
      } // r2-physics: momentum + damage at the contact, when the car gets there
  }
  function bend(rec, vx, vz) {
    // slow bump: lean the post away from the car, a little, once or twice
    const { pos, q } = poseOf(rec),
      L = Math.hypot(vx, vz) || 1,
      ang = Math.min(0.32, (rec.bent || 0) + 0.12);
    rec.bent = ang;
    const axis = _v.set(vz / L, 0, -vx / L);
    const lean = new THREE.Quaternion().setFromAxisAngle(axis, ang);
    const q2 = lean.multiply(new THREE.Quaternion().setFromEuler(_e.set(0, rec.ry || 0, 0)));
    const m = new THREE.Matrix4().compose(pos, q2, _s.setScalar(rec.sc));
    rec.m = m.toArray();
    rec.setMatrix?.(m);
    rec.save?.(rec.m);
    if (rec.fixed) {
      dropFixed(rec);
      fixedColliders(rec, pos, q2);
    }
    stats.bent++;
  }
  function sound(rec, at, vol) {
    if (soundT > 0) return;
    soundT = 0.12;
    try {
      game.audio?.play?.(rec.kind === 'mailbox' || rec.kind === 'signPost' ? 'door' : 'door', {
        position: at,
        volume: vol,
      });
    } catch (e) {
      /* optional */
    }
  }

  const _cq = new THREE.Quaternion(),
    _ce = new THREE.Euler();
  const api = { paused: false },
    wakeLog = [];
  api.wakeLog = wakeLog; // debug: why props wake (spawn settle vs touched)
  function update(dt) {
    if (api.paused) return; // perf A/B
    soundT -= dt;
    const t0 = performance.now();
    // knock-class posts: vehicles that reach them
    const list = game.vehicles?.list;
    if (list && grid.size)
      for (const v of list) {
        const b = v.body;
        if (!b || (b.isValid && !b.isValid())) continue;
        if (
          v.spec?.boat ||
          v.isBoat ||
          v.kind === 'boat' ||
          v.type === 'heli' ||
          v.type === 'plane'
        )
          continue;
        const lv = b.linvel(),
          speed = Math.hypot(lv.x, lv.z);
        if (speed < 0.25) continue;
        const p = b.translation(),
          r = b.rotation();
        _cq.set(r.x, r.y, r.z, r.w);
        _ce.setFromQuaternion(_cq, 'YXZ');
        const yaw = _ce.y,
          c = Math.cos(yaw),
          s = Math.sin(yaw),
          hl = (v.spec?.L || 4.6) / 2,
          hw = (v.spec?.W || 1.9) / 2,
          ahead = speed * Math.max(dt, 1 / 60) * 2 + 0.15;
        const R = hl + ahead + 1.5,
          i0 = Math.floor((p.x - R) / CELL),
          i1 = Math.floor((p.x + R) / CELL),
          j0 = Math.floor((p.z - R) / CELL),
          j1 = Math.floor((p.z + R) / CELL);
        for (let i = i0; i <= i1; i++)
          for (let j = j0; j <= j1; j++) {
            const a = grid.get(key(i, j));
            if (!a) continue;
            for (let k = a.length - 1; k >= 0; k--) {
              const rec = a[k];
              if (
                (rec.cls !== 'knock' && !rec.dormant) ||
                Math.abs(rec.py + rec.top / 2 - p.y) > 2.5
              )
                continue;
              const dx = rec.px - p.x,
                dz = rec.pz - p.z,
                lx = dx * c - dz * s,
                lz = dx * s + dz * c,
                rr = rec.rad;
              if (rec.dormant) {
                if (Math.abs(lx) < hw + rr + 0.35 && Math.abs(lz) < hl + rr + ahead + 0.35)
                  wake(rec, 'car');
                continue;
              }
              if (speed < BEND_SPEED || (v.ai && !v.playerDriven && !v.chaseTarget)) continue; // lane-following traffic never snaps posts (it cuts corners by a few cm)
              if (Math.abs(lx) < hw + rr && Math.abs(lz) < hl + rr + ahead) {
                if (speed >= KNOCK_SPEED) knock(rec, lv.x, lv.z, speed, v);
                else if ((rec.bent || 0) < 0.3 && !rec._bentBy?.has(v)) {
                  (rec._bentBy ||= new WeakSet()).add(v);
                  bend(rec, lv.x, lv.z);
                  if (game.physics?.impacts)
                    try {
                      game.physics.damageAt?.(
                        v,
                        new THREE.Vector3(rec.px, rec.py + Math.min(0.6, rec.top / 2), rec.pz),
                        { speedKmh: speed * 3.6, hardness: 0.3 },
                      );
                    } catch (e) {
                      /* */
                    }
                }
              }
            }
          }
      }
    // the player reaching a dormant push prop wakes it (the character controller then shoves it)
    const pp = game.player?.position;
    if (pp && grid.size) {
      const ci = Math.floor(pp.x / CELL),
        cj = Math.floor(pp.z / CELL);
      for (let i = ci - 1; i <= ci + 1; i++)
        for (let j = cj - 1; j <= cj + 1; j++) {
          const a = grid.get(key(i, j));
          if (!a) continue;
          for (let k = a.length - 1; k >= 0; k--) {
            const rec = a[k];
            if (!rec.dormant) continue;
            const d = Math.hypot(rec.px - pp.x, rec.pz - pp.z);
            if (d < rec.rad + 0.75 && pp.y > rec.py - 1.5 && pp.y < rec.py + rec.top + 1.0)
              wake(rec, 'player');
          }
        }
    }
    // awake bodies: the instanced visual follows the body
    let awake = 0;
    for (const rec of live) {
      const b = rec.body;
      if (!b) continue;
      if (b.isSleeping()) {
        if (rec.awake) {
          rec.awake = false;
          rec.setMatrix?.(visualMatrix(rec));
          saveBack(rec);
          const t = b.translation();
          moveCell(rec, t.x, t.z);
          if (rec._wl) {
            rec._wl.d = [
              +(t.x - rec.p0[0]).toFixed(3),
              +(t.y - rec.p0[1]).toFixed(3),
              +(t.z - rec.p0[2]).toFixed(3),
            ];
            rec._wl = null;
          }
        }
        const t = b.translation();
        let busy = pp && Math.hypot(pp.x - t.x, pp.z - t.z) < rec.rad + 2.5;
        if (!busy)
          for (const v of list || []) {
            try {
              const vt = v.body.translation();
              if (Math.hypot(vt.x - t.x, vt.z - t.z) < 7) {
                busy = true;
                break;
              }
            } catch (e) {
              /* */
            }
          }
        if (!busy) sleepBack(rec);
        continue;
      }
      if (!rec.awake) {
        rec.awake = true;
        rec.moved = true;
        stats.pushes++;
        {
          const pp = game.player?.position,
            near = [];
          if (pp && Math.hypot(pp.x - rec.px, pp.z - rec.pz) < 3) near.push('player');
          for (const v of game.vehicles?.list || []) {
            try {
              const t = v.body.translation();
              if (Math.hypot(t.x - rec.px, t.z - rec.pz) < 6) {
                near.push('car');
                break;
              }
            } catch (e) {
              /* */
            }
          }
          rec._wl = {
            kind: rec.kind,
            x: +rec.px.toFixed(1),
            z: +rec.pz.toFixed(1),
            after: Math.round(performance.now() - rec.t0),
            near: near.join(','),
            why: rec.why || '?',
            d: null,
          };
          wakeLog.push(rec._wl);
          if (wakeLog.length > 200) wakeLog.shift();
        }
        const lv = b.linvel(),
          sp = Math.hypot(lv.x, lv.y, lv.z);
        if (sp > 2.5) sound(rec, b.translation(), Math.min(0.5, 0.1 + sp * 0.03));
      }
      awake++;
      const t = b.translation();
      if (t.y < rec.py - 30) {
        rec.setMatrix?.(null);
        drop(rec);
        continue;
      } // fell out of the world
      rec.setMatrix?.(visualMatrix(rec));
    }
    stats.awake = awake;
    stats.syncMs = +(performance.now() - t0).toFixed(3);
  }
  function moveCell(rec, x, z) {
    const k = key(Math.floor(x / CELL), Math.floor(z / CELL));
    rec.px = x;
    rec.pz = z;
    if (k === rec.k) return;
    const a = grid.get(rec.k);
    if (a) {
      const i = a.indexOf(rec);
      if (i >= 0) {
        a[i] = a[a.length - 1];
        a.pop();
      }
      if (!a.length) grid.delete(rec.k);
    }
    rec.k = k;
    let b = grid.get(k);
    if (!b) grid.set(k, (b = []));
    b.push(rec);
  }
  function near(x, z, r) {
    const out = [];
    for (const a of grid.values())
      for (const rec of a) if (Math.hypot(rec.px - x, rec.pz - z) < r) out.push(rec);
    return out;
  }
  if (game.updaters) game.updaters.push(update);
  return Object.assign(api, {
    add,
    removeOwner,
    setOwnerEnabled,
    update,
    near,
    stats,
    get count() {
      return stats.items;
    },
  });
}

let inst = null;
function get() {
  if (inst) return inst;
  const g = globalThis.game;
  if (!g || !g.world || !g.RAPIER) return null;
  inst = create(g);
  g.dynProps = inst;
  return inst;
}
export const dynProps = {
  get enabled() {
    return !OFF && !!get();
  },
  add(rec) {
    const d = get();
    return d ? d.add(rec) : null;
  },
  removeOwner(owner) {
    if (inst) inst.removeOwner(owner);
  },
  setOwnerEnabled(owner, on) {
    if (inst) inst.setOwnerEnabled(owner, on);
  },
  near(x, z, r) {
    return inst ? inst.near(x, z, r) : [];
  },
  get stats() {
    return inst ? inst.stats : null;
  },
};
