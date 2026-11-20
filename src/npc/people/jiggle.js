// Subtle soft-tissue secondary motion (chest, glutes) for the women among the user's people, near the camera only
// (Nov 19b, user: "make all the women have jiggle physics"). Same model as Mari's (src/player/mari/jiggle.js): a painted
// weight per vertex moves the skinned vertex by a per-region offset from damped springs driven by the hips' acceleration
// (walking bob, stops, hits), small and quickly damped.
// Cost: nothing for far people. A woman within NPC_JIGGLE_DIST at full detail (LOD0) gets her own clone of her person
// material (same shader program for all of them, compiled once off the frame with compileAsync before the first one
// shows); at most MAX_ACTIVE at a time. The weights are painted once per person (Uint8, 2 per vertex) on first use.
// '?npcjiggle=0' (or '?jiggle=0') = off.
import * as THREE from 'three';
import { paintWeights } from '../../player/mari/jiggle.js';

export const NPC_JIGGLE_DIST = 12;
const MAX_ACTIVE = 6;
const ON = !(typeof location !== 'undefined' && /[?&](npc)?jiggle=0\b/.test(location.search));

// natural frequency (Hz), damping ratio, gain (s^2), max offset (m): a touch softer than Mari's
const REGIONS = [
  { hz: 3.3, zeta: 0.38, gain: 0.0008, max: 0.016 },
  { hz: 2.9, zeta: 0.42, gain: 0.0007, max: 0.013 },
];
const AXIS = { side: 0.35, up: 1, fwd: 0.55 };
const HP_S = 0.22;

const active = new Set();
let program = 'none'; // 'none' | 'compiling' | 'ready'

const _p = new THREE.Vector3();
const _f = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m3 = new THREE.Matrix3();

// weights for one person's full-detail body: painted from the template mesh at rest, kept as 2 normalized bytes
function ensureWeights(template) {
  const g = template.geometry;
  if (g.attributes.aJig) {
    return true;
  }
  try {
    template.updateWorldMatrix(true, false);
    paintWeights(template, null);
  } catch (e) {
    console.warn('[npc jiggle] paint', e);
    return false;
  }
  const w = g.attributes.aJiggle.array;
  const n = g.attributes.position.count;
  const out = new Uint8Array(n * 2);
  for (let i = 0; i < n; i++) {
    out[i * 2] = Math.round(Math.min(1, w[i * 3]) * 255);
    out[i * 2 + 1] = Math.round(Math.min(1, w[i * 3 + 1]) * 255);
  }
  g.deleteAttribute('aJiggle');
  g.setAttribute('aJig', new THREE.BufferAttribute(out, 2, true));
  return true;
}

function jiggleMaterial(src, u) {
  const m = src.clone();
  const prev = src.onBeforeCompile;
  const prevKey = src.customProgramCacheKey;
  m.onBeforeCompile = (sh, r) => {
    prev?.call(m, sh, r);
    sh.uniforms.uJigChest = u.chest;
    sh.uniforms.uJigGlute = u.glute;
    sh.vertexShader = sh.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute vec2 aJig;\nuniform vec3 uJigChest;\nuniform vec3 uJigGlute;',
      )
      .replace(
        '#include <skinning_vertex>',
        '#include <skinning_vertex>\ntransformed += aJig.x * uJigChest + aJig.y * uJigGlute;',
      );
  };
  m.customProgramCacheKey = () => (prevKey ? prevKey.call(src) : '') + 'npcJig';
  m.userData = { ...src.userData, shared: false, jiggle: true };
  return m;
}

function release(J) {
  if (!J.on) {
    return;
  }
  J.on = false;
  active.delete(J);
  J.mesh.material = J.src;
  for (const s of J.springs) {
    s.x.set(0, 0, 0);
    s.v.set(0, 0, 0);
  }
  J.u.chest.value.set(0, 0, 0);
  J.u.glute.value.set(0, 0, 0);
  J.has = false;
}

/**
 * game, mesh: the clone's LOD0 body (SkinnedMesh), template: the person's template mesh (same geometry), hips: bone,
 * root: the character root. Returns { update(dt, dist, lod), dispose() } or null.
 */
export function createNpcJiggle(game, { mesh, template, hips, root }) {
  if (!ON || !mesh || !template || !hips || mesh.geometry !== template.geometry) {
    return null;
  }
  const J = {
    on: false,
    has: false,
    mesh,
    src: null,
    mat: null,
    seen: 0,
    u: { chest: { value: new THREE.Vector3() }, glute: { value: new THREE.Vector3() } },
    springs: REGIONS.map((r) => ({
      ...r,
      x: new THREE.Vector3(),
      v: new THREE.Vector3(),
      k: (2 * Math.PI * r.hz) ** 2,
      c: 2 * r.zeta * 2 * Math.PI * r.hz,
    })),
    p0: new THREE.Vector3(),
    vel: new THREE.Vector3(),
    acc: new THREE.Vector3(),
    slow: new THREE.Vector3(),
  };

  // first use: compile the shared jiggle program off the frame (KHR_parallel_shader_compile); nobody jiggles until it is linked
  function warm() {
    const r = game?.renderer;
    if (!r?.compileAsync || !game.camera || !game.scene) {
      program = 'ready';
      return;
    }
    program = 'compiling';
    const tmp = new THREE.SkinnedMesh(mesh.geometry, J.mat);
    tmp.bind(mesh.skeleton, mesh.bindMatrix);
    tmp.frustumCulled = false;
    r.compileAsync(tmp, game.camera, game.scene)
      .then(() => {
        program = 'ready';
      })
      .catch(() => {
        program = 'ready';
      });
  }

  // drop people that stopped updating (despawned, pooled) so they never hold a slot
  function prune(now) {
    for (const o of active) {
      if (now - o.seen > 1) {
        release(o);
      }
    }
  }

  J.update = (dt, dist, lod) => {
    const now = performance.now() / 1000;
    J.seen = now;
    const want = dist < NPC_JIGGLE_DIST && lod === 0 && root.visible;
    if (!want) {
      if (J.on && dist < NPC_JIGGLE_DIST * 1.15 && lod === 0) {
        // hysteresis: keep it a little past the edge
      } else {
        release(J);
        return;
      }
    }
    if (!J.on) {
      if (active.size >= MAX_ACTIVE) {
        prune(now);
        if (active.size >= MAX_ACTIVE) {
          return;
        }
      }
      if (!J.mat) {
        if (!ensureWeights(template)) {
          J.update = () => {};
          return;
        }
        J.src = mesh.material;
        J.mat = jiggleMaterial(J.src, J.u);
      }
      if (program === 'none') {
        warm();
      }
      if (program !== 'ready') {
        return;
      }
      J.src = mesh.material === J.mat ? J.src : mesh.material;
      J.on = true;
      active.add(J);
    }
    // the person material's textures can change (close-up resolution): follow them
    const s = J.src;
    const m = J.mat;
    m.map = s.map;
    m.normalMap = s.normalMap;
    m.roughnessMap = s.roughnessMap;
    m.metalnessMap = s.metalnessMap;
    m.color.copy(s.color);
    if (mesh.material !== m) {
      mesh.material = m;
    }
    if (dt <= 0) {
      return;
    }
    dt = Math.min(dt, 1 / 30);
    hips.getWorldPosition(_p);
    if (!J.has || _p.distanceToSquared(J.p0) > 2.25) {
      J.p0.copy(_p);
      J.vel.set(0, 0, 0);
      J.acc.set(0, 0, 0);
      J.slow.set(0, 0, 0);
      J.has = true;
      return;
    }
    // hips velocity / acceleration (lightly low-passed), minus its slow average (no offset in a steady turn or fall)
    _f.copy(_p).sub(J.p0).divideScalar(dt);
    J.p0.copy(_p);
    const nvx = _f.x;
    const nvy = _f.y;
    const nvz = _f.z;
    _f.sub(J.vel).divideScalar(dt);
    J.vel.set(nvx, nvy, nvz);
    J.acc.lerp(_f, Math.min(1, dt * 14));
    if (J.acc.length() > 120) {
      J.acc.setLength(120);
    }
    J.slow.lerp(J.acc, Math.min(1, dt / HP_S));
    const push = _f.copy(J.acc).sub(J.slow);
    // weight the axes in the character's frame (world -> character, scale, back: invert() flips _q in place)
    root.getWorldQuaternion(_q);
    push.applyQuaternion(_q.invert());
    push.x *= AXIS.side;
    push.y *= AXIS.up;
    push.z *= AXIS.fwd;
    push.applyQuaternion(_q.invert());
    const px = push.x;
    const py = push.y;
    const pz = push.z;
    _m3.setFromMatrix4(mesh.matrixWorld).invert();
    J.springs.forEach((sp, i) => {
      // tissue lags behind the body: pushed against the acceleration, pulled back by the spring, damped
      const fx = -sp.gain * sp.k * px - sp.k * sp.x.x - sp.c * sp.v.x;
      const fy = -sp.gain * sp.k * py - sp.k * sp.x.y - sp.c * sp.v.y;
      const fz = -sp.gain * sp.k * pz - sp.k * sp.x.z - sp.c * sp.v.z;
      sp.v.x += fx * dt;
      sp.v.y += fy * dt;
      sp.v.z += fz * dt;
      sp.x.addScaledVector(sp.v, dt);
      if (sp.x.length() > sp.max) {
        sp.x.setLength(sp.max);
        sp.v.multiplyScalar(0.5);
      }
      const u = i === 0 ? J.u.chest : J.u.glute;
      u.value.copy(sp.x).applyMatrix3(_m3);
    });
  };
  // the clone is not disposed: it keeps the shared program linked for the next woman who comes near
  J.dispose = () => {
    release(J);
  };
  return J;
}

/** tests: how many women jiggle right now, and whether the shared program is linked */
export function npcJiggleStats() {
  return { active: active.size, program };
}
