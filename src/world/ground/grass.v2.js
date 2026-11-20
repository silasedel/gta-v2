// Near grass from the user's grass models (r2-ground, item 17): Grass Clump 1 (green and dry variants) and Moss 1, converted by
// the vegetation pipeline into public/assets/models/vegetation/{grass_tuft_a,grass_tuft_b,moss_clump}{,_lod1}.glb.
// Wild / long grass grows in clumps on open natural ground around the camera: scrub, meadow, verges, Keys yards (in patches in
// the sand), long grass, grove and pine floors, a little in the glades; mown lawns keep the GPU blade lawn (lawn.js), with only a
// rare weed clump. Dense, greener grass gathers in the micro-relief's drainage lows (terrain/relief.js lowAt).
//  - CPU-placed instances on a world-stable 1.25 m cell grid, re-gathered when the camera moves 2 m (no per-frame cost):
//    full model within 12 m, its LOD1 to 30 m, clumps shrink into the ground over the last 6 m (no pop, no dither).
//  - The ground mask (surfaceMask.js gmVeg) removes clumps on asphalt / pavement / drives and presses them flat and splays them
//    away under and around cars (soft, car-shaped).
//  - Wind: the shared gust field (vegetation/materials.js uniforms); alpha-tested cards with alpha to coverage.
//  - game.groundGrass = { patches(list), stats }: patches([{ x, z, r, density, kind: 'clump' | 'dry' | 'moss' }]) adds
//    hand-placed grass patches (set pieces: r2-keys uses it in Nico's yard). Before this module is up, push the same objects to
//    game.groundGrassQueue (an array); they are taken over at init.
// ?ggrass=0 turns it off (A/B).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { vegUniforms } from '../vegetation/materials.js';
import { gmVeg } from './surfaceMask.js';
import GRADE from '../vegetation/grade.json'; // r2-veg's per-model color gain into the shared palette (lush (84, 98, 46), dry straw hue ~47)

export const order = 66;
const OFF = typeof location !== 'undefined' && /[?&]ggrass=0\b/.test(location.search);
const SLAB_CHECK = !(typeof location !== 'undefined' && /[?&]nov19b=0\b/.test(location.search)); // world_nov19b
const CELL = 1.25,
  R_NEAR = 12,
  R_FAR = 30,
  FADE = 6;
const MOSS = false; // the converted moss_clump reads as a flat dark disc (its card alpha is lost in the lod): off until it is re-baked
const hash = (x, z, s = 0) => {
  let h = Math.imul((x * 73856093) ^ (z * 19349663) ^ (s * 83492791), 2654435761);
  h ^= h >>> 15;
  h = Math.imul(h, 2246822519);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
};
function vn(x, z) {
  const ix = Math.floor(x),
    iz = Math.floor(z);
  let fx = x - ix,
    fz = z - iz;
  fx = fx * fx * (3 - 2 * fx);
  fz = fz * fz * (3 - 2 * fz);
  const a = hash(ix, iz, 7),
    b = hash(ix + 1, iz, 7),
    c = hash(ix, iz + 1, 7),
    d = hash(ix + 1, iz + 1, 7);
  return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
}
const ss = (a, b, v) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
// grass amount per terrain class (terrain.js LAYERS keys): [density, dryness]
const LAYER_G = {
  lawn: [0.05, 0.2],
  scrub: [0.62, 0.45],
  forest: [0.08, 0.5],
  pine: [0.3, 0.55],
  sawgrass: [0.4, 0.75],
  marsh: [0.12, 0.4],
  sand: [0.05, 0.7],
  shell: [0.06, 0.7],
  dirt: [0.14, 0.6],
  farm: [0.03, 0.5],
  grove: [0.32, 0.4],
  rock: [0.1, 0.6],
  gravel: [0.07, 0.6],
  damp: [0.06, 0.5],
  base: [0.1, 0.55],
  meadow: [0.72, 0.4],
};

// shared wind + up-facing normals (soft card lighting) for the clump materials
function windPatch(mat) {
  mat.onBeforeCompile = (sh) => {
    for (const k of ['uVegTime', 'uVegWindDir', 'uVegWindSpeed', 'uVegWindT'])
      sh.uniforms[k] = vegUniforms[k];
    sh.vertexShader =
      'uniform float uVegTime; uniform vec2 uVegWindDir; uniform float uVegWindSpeed; uniform float uVegWindT;\n' +
      sh.vertexShader
        .replace(
          '#include <beginnormal_vertex>',
          '#include <beginnormal_vertex>\n  objectNormal = normalize(mix(objectNormal, vec3(0.0, 1.0, 0.0), 0.65));',
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
      #ifdef USE_INSTANCING
      { vec3 ip = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz; vec2 d = uVegWindDir; float s = max(uVegWindSpeed, 0.5);
        float al = dot(ip.xz, d), g = clamp(0.5 + 0.32 * sin(6.2831 * ((al - s * 0.9 * uVegWindT) / 140.0)) + 0.18 * sin(6.2831 * ((al - s * 0.7 * uVegWindT) / 31.0) + 1.7), 0.0, 1.0);
        float k = transformed.y * transformed.y * 2.2, w = clamp(uVegWindSpeed / 4.0, 0.08, 2.0);
        vec3 wl = vec3(d.x, 0.0, d.y) * mat3(modelMatrix * instanceMatrix); vec2 wl2 = length(wl.xz) > 1e-4 ? normalize(wl.xz) : vec2(0.0);
        transformed.xz += wl2 * k * w * (0.08 + 0.22 * g + 0.05 * sin(uVegTime * 2.6 + ip.x * 1.7 + ip.z * 2.3)); }
      #endif`,
        );
  };
  mat.customProgramCacheKey = () => 'r2-grass-wind';
  return mat;
}

export async function initV2(game) {
  if (OFF) return;
  const city = game.city,
    terr = city && city.terrain,
    data = game.miamiData;
  if (!city || !game.scene) return;
  const base = (import.meta.env?.BASE_URL ?? '/') + 'assets/models/vegetation/';
  const loader = new GLTFLoader();
  const load = (f) =>
    new Promise((res) =>
      loader.load(
        base + f,
        (g) => {
          let m = null;
          g.scene.traverse((o) => {
            if (!m && o.isMesh) m = o;
          });
          res(m);
        },
        undefined,
        () => res(null),
      ),
    );
  const files = [
    'grass_tuft_a',
    'grass_tuft_a_lod1',
    'grass_tuft_b',
    'grass_tuft_b_lod1',
    'moss_clump',
    'moss_clump_lod1',
  ];
  const got = await Promise.all(files.map((f) => load(f + '.glb')));
  if (!got[0] || !got[2]) {
    console.warn('[grass] clump models missing');
    return;
  }
  const root = new THREE.Group();
  root.name = 'groundGrass';
  game.scene.add(root);
  const mats = new Map();
  function matFor(src, kind, file) {
    // one material per source texture: alpha-tested cards, graded toward the terrain grass
    const key = (src.material.map && src.material.map.uuid) + kind;
    if (mats.has(key)) return mats.get(key);
    const moss = kind === 'moss';
    const m = new THREE.MeshStandardMaterial({
      map: src.material.map,
      alphaTest: 0.42,
      alphaToCoverage: true,
      transparent: false,
      side: THREE.DoubleSide,
      roughness: 0.88,
      metalness: 0,
      color: moss
        ? new THREE.Color(0.78, 0.8, 0.62)
        : kind === 'dry'
          ? new THREE.Color(0.86, 0.82, 0.66)
          : new THREE.Color(0.8, 0.86, 0.66),
    });
    const gr = GRADE[file] && (GRADE[file][src.material.name] || Object.values(GRADE[file])[0]);
    if (gr) m.color.setRGB(gr[0], gr[1], gr[2]);
    m.color.multiplyScalar(moss ? 0.4 : kind === 'dry' ? 0.42 : 0.32); // r2-art audit: on-screen L was 0.3-0.39 (green), 0.28-0.31 (dry), 0.63 (moss) -> grass 0.07-0.13 / dry 0.12-0.20 / moss 0.06-0.12
    m.name = 'groundGrass:' + kind;
    windPatch(m);
    gmVeg(m, { edge: true });
    mats.set(key, m);
    return m;
  }
  // draw sets: [kind, near mesh, far mesh, max instances near / far]
  const sets = [
    ['green', got[0], got[1] || got[0], 1400, 3600, 'grass_tuft_a'],
    ['dry', got[2], got[3] || got[2], 900, 2400, 'grass_tuft_b'],
    ['moss', MOSS ? got[4] : null, got[5] || got[4], 300, 700, 'moss_clump'],
  ]
    .filter((s) => s[1])
    .map(([kind, n, f, cn, cf, file]) => {
      const mk = (src, cap) => {
        const im = new THREE.InstancedMesh(src.geometry, matFor(src, kind, file), cap);
        im.count = 0;
        im.frustumCulled = false;
        im.castShadow = false;
        im.receiveShadow = true;
        im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
        im.name = 'groundGrass:' + kind;
        root.add(im);
        return im;
      };
      return { kind, near: mk(n, cn), far: mk(f, cf) };
    });
  const SET = Object.fromEntries(sets.map((s) => [s.kind, s]));

  // ---- where grass grows (cached per cell) ----
  const lowAt = data && data.terrainHeightAt && data.terrainHeightAt.lowAt;
  const KEYS = terr ? terr.LAYERS.map((l) => l.key) : [];
  const cache = new Map(),
    hand = [];
  function cellInfo(i, j) {
    const k = i * 100003 + j;
    let c = cache.get(k);
    if (c) return c;
    const x = (i + 0.5) * CELL,
      z = (j + 0.5) * CELL;
    let dens = 0,
      dry = 0.4,
      y = 0,
      gx = 0,
      gz = 0,
      handF = 0;
    try {
      if (!(city.isWater && city.isWater(x, z))) {
        const real = terr ? terr.real(x, z) : true;
        if (!real && terr) {
          const L = KEYS[terr.layerAt(x, z)] || 'base';
          [dens, dry] = LAYER_G[L] || [0.08, 0.5];
          if (L === 'sand' && terr.isKeys(x, z)) {
            dens =
              0.75 *
              ss(
                0.5,
                0.74,
                vn(x / 5.5 + 3.3, z / 5.5 - 1.1) * 0.75 + vn(x / 1.8 + 7.1, z / 1.8) * 0.25,
              );
            dry = 0.62;
            handF = Math.max(handF, 0.001);
          } // Keys sand: grass only in clumped patches (same scales as r2-veg's ground cover), bare sand between // Keys yards: grass in patches in the sand
          y = terr.heightAt(x, z) - 0.02;
          gx = (terr.heightAt(x + 0.6, z) - 0.02 - y) / 0.6;
          gz = (terr.heightAt(x, z + 0.6) - 0.02 - y) / 0.6;
        } else {
          const s = data && data.surfaceAt ? data.surfaceAt(x, z) : 'grass_short';
          dens =
            s === 'grass_long'
              ? 0.55
              : s === 'dirt'
                ? 0.12
                : s === 'grass_short'
                  ? 0.03
                  : s === 'sand'
                    ? 0.03
                    : 0;
          dry = 0.4;
          y = city.groundHeightAt ? city.groundHeightAt(x, z) : 0;
          // world_nov19b (user: "random grass patches over the road"): a raised built surface (town plaza slab, pad, deck)
          // the map still calls grass: the clumps stood on the slab. Grass only grows on ground at the drawn terrain level.
          if (SLAB_CHECK && terr?.heightAt && y - terr.heightAt(x, z) > 0.15) dens = 0;
        }
        let clear = 0;
        const jn = (vn(x / 4.1 + 2.7, z / 4.1 - 6.3) - 0.5) * 6;
        for (const p of hand) {
          const dx = x - p.x,
            dz = z - p.z,
            d = Math.sqrt(dx * dx + dz * dz);
          if (p.kind === 'clear') {
            if (d < p.r + 6) clear = Math.max(clear, ss(p.r + 3, p.r - 3, d + jn));
            continue;
          } // r8: a ragged, feathered edge (it was a hard line of grass / no grass)
          if (d < p.r) {
            const f = ss(p.r, p.r * 0.45, d) * (p.density ?? 0.8);
            handF = Math.max(handF, f);
            if (p.kind === 'dry') dry = Math.max(dry, 0.7);
            if (p.kind === 'moss') dry = -1;
          }
        }
        if (clear > 0 && handF <= 0.05) dens *= 1 - clear; // 'clear' zones (set pieces with their own hand-placed grass, e.g. Nico's lot): no automatic grass
        if (dens > 0 && handF < 0.0005) {
          dens *=
            ss(
              0.22,
              0.62,
              vn(x / 6.5 + 1.7, z / 6.5 - 8.2) * 0.65 + vn(x / 2.2 - 4.4, z / 2.2 + 2.9) * 0.35,
            ) * 1.6; // clustered: clumps gather, gaps between
          const lo = lowAt ? lowAt(x, z) : 0;
          if (lo > 0.05) {
            dens = Math.min(1, dens + lo * 0.5);
            dry *= 1 - lo * 0.6;
          } // greener, thicker in the wet lows
          dry = Math.min(
            1,
            Math.max(dry < 0 ? -1 : 0, dry + (vn(x / 23 - 5.1, z / 23 + 2.2) - 0.5) * 0.5),
          );
        }
        if (!Number.isFinite(y)) dens = 0;
      }
    } catch (e) {
      dens = 0;
    }
    if (!(Math.abs(gx) < 2 && Math.abs(gz) < 2)) {
      gx = 0;
      gz = 0;
    }
    c = {
      dens: handF > 0.05 ? Math.max(Math.min(1, dens), handF * 1.6) : Math.min(1, dens),
      dry,
      y,
      gx,
      gz,
      mat: handF > 0.05,
    }; // hand patches: dense matted sheets (up to 3 clumps per cell)
    if (cache.size > 120000) cache.clear();
    cache.set(k, c);
    return c;
  }

  // ---- gather instances around the camera ----
  const _m = new THREE.Matrix4(),
    _q = new THREE.Quaternion(),
    _p = new THREE.Vector3(),
    _s = new THREE.Vector3(),
    _c = new THREE.Color(),
    UP = new THREE.Vector3(0, 1, 0);
  const stats = { near: 0, far: 0, cells: 0, ms: 0, builds: 0 };
  let lastX = 1e9,
    lastZ = 1e9,
    t = 0;
  function gather() {
    const t0 = performance.now(),
      cp = game.camera.position;
    lastX = cp.x;
    lastZ = cp.z;
    for (const s of sets) {
      s.near.count = 0;
      s.far.count = 0;
    }
    const i0 = Math.floor((cp.x - R_FAR) / CELL),
      i1 = Math.floor((cp.x + R_FAR) / CELL),
      j0 = Math.floor((cp.z - R_FAR) / CELL),
      j1 = Math.floor((cp.z + R_FAR) / CELL);
    const camY = cp.y;
    let cells = 0;
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const cx = (i + 0.5) * CELL,
          cz = (j + 0.5) * CELL,
          d = Math.hypot(cx - cp.x, cz - cp.z);
        if (d > R_FAR) continue;
        const c = cellInfo(i, j);
        cells++;
        if (c.dens <= 0.01) continue;
        const nPer = c.mat ? 1 + (c.dens > 0.7 ? 1 : 0) + (c.dens > 1.2 ? 1 : 0) : 1;
        for (let q = 0; q < nPer; q++) {
          const h0 = hash(i, j, 1 + q * 13);
          if (h0 > Math.min(1, c.dens - q * 0.4)) continue;
          const x = cx + (hash(i, j, 2 + q * 31) - 0.5) * CELL * 0.95,
            z = cz + (hash(i, j, 3 + q * 31) - 0.5) * CELL * 0.95,
            dd = Math.hypot(x - cp.x, z - cp.z);
          if (Math.abs(c.y - camY) > 60) continue;
          const kind =
            SET.moss && (c.dry < 0 || (c.dry < 0.42 && !c.mat && hash(i, j, 4) < 0.05))
              ? 'moss'
              : c.dry > 0.64 + (hash(i, j, 5) - 0.5) * 0.2
                ? 'dry'
                : 'green'; // moss only in the greener, damp spots
          const S = SET[kind] || SET.green,
            near = dd < R_NEAR,
            im = near ? S.near : S.far;
          if (im.count >= im.instanceMatrix.count) continue;
          const fade = 1 - ss(R_FAR - FADE, R_FAR, dd);
          const sc = (0.7 + hash(i, j, 6) * 0.6) * (kind === 'moss' ? 0.8 : 1) * fade,
            sy = sc * (0.8 + hash(i, j, 8) * 0.45) * (kind === 'dry' ? 1.1 : 1);
          _q.setFromAxisAngle(UP, hash(i, j, 7 + q * 31) * 6.2832);
          _m.compose(_p.set(x, c.y + (x - cx) * c.gx + (z - cz) * c.gz, z), _q, _s.set(sc, sy, sc));
          im.setMatrixAt(im.count, _m);
          const v = 0.86 + hash(i, j, 9) * 0.24,
            hshift = (hash(i, j, 10) - 0.5) * 0.08;
          _c.setRGB(v * (1 + hshift), v, v * (1 - hshift * 1.5));
          if (c.mat) {
            const l = _c.r * 0.3 + _c.g * 0.6 + _c.b * 0.1;
            _c.lerp(_s.set(l * 1.02, l, l * 0.95), 0.35);
          } // Keys yard mats read green-gray (mock-up) im.instanceColor.setXYZ(im.count, _c.r, _c.g, _c.b);
          im.count++;
        }
      }
    for (const s of sets)
      for (const im of [s.near, s.far]) {
        im.instanceMatrix.needsUpdate = true;
        im.instanceColor.needsUpdate = true;
      }
    stats.near = sets.reduce((a, s) => a + s.near.count, 0);
    stats.far = sets.reduce((a, s) => a + s.far.count, 0);
    stats.cells = cells;
    stats.ms = performance.now() - t0;
    stats.builds++;
  }
  game.updaters.push(function groundGrassTick(dt) {
    if (!game.camera) return;
    t += dt || 0.016;
    const cp = game.camera.position,
      moved = Math.hypot(cp.x - lastX, cp.z - lastZ);
    if (moved > 2 || (t > 1.5 && moved > 0.3)) {
      t = 0;
      gather();
    }
  });
  game.groundGrass = {
    stats,
    root,
    patches(list = []) {
      for (const p of list)
        if (p && Number.isFinite(p.x) && Number.isFinite(p.z))
          hand.push({
            x: p.x,
            z: p.z,
            r: Math.max(0.5, p.r || 2),
            density: p.density,
            kind: p.kind || 'clump',
          });
      cache.clear();
      lastX = 1e9;
    },
    refresh() {
      cache.clear();
      lastX = 1e9;
    },
  };
  if (Array.isArray(game.groundGrassQueue) && game.groundGrassQueue.length)
    game.groundGrass.patches(game.groundGrassQueue.splice(0)); // patches queued before this module was up
}
