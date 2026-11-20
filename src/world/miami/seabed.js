import * as THREE from 'three';
import { vegUniforms } from '../vegetation/materials.js';
import { CAUSTIC_GLSL } from '../ground/caustics.js';
const U_T = vegUniforms.uVegTime; // shared world clock (same as the terrain caustics)

// Visible sea floor around the player: a 2 m grid (240 m square) that follows the player and takes its heights from
// city.seabedDepthAt (the same seabed the swim code uses; ignores bridge decks overhead). Land vertices are tucked just under the land surface, so the
// shoreline becomes a natural underwater slope. Rebuilt a few rows per frame when the player moves, so there is no hitch.
export function createSeabed(game, city) {
  const SIZE = 240,
    STEP = 2,
    N = SIZE / STEP + 1,
    SEA = city.seaLevel ?? -0.12;
  const geoms = [0, 1].map(() => {
    const g = new THREE.PlaneGeometry(SIZE, SIZE, N - 1, N - 1);
    g.rotateX(-Math.PI / 2);
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(N * N * 3), 3));
    return g;
  });
  // world_nov19b (user: "water edges glitching back and forth"): next to the shore the seabed is laid 5 mm under the
  // terrain's under-water strip (the collider must match the drawn bottom), so the two fought in depth at range and the
  // bank flickered through the water. The seabed now always loses that tie to the drawn ground (a negative offset that let
  // it win drew it over the land at grazing angles: the factor term scales with the depth slope).
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.6,
    metalness: 0,
    polygonOffset: !(typeof location !== 'undefined' && /[?&]nov19b=0\b/.test(location.search)),
    polygonOffsetFactor: 1.5,
    polygonOffsetUnits: 4,
  });
  // r2-ground: the same soft moving caustics as the terrain under the water (groundShader.js), fading out by 2.5 m depth
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uSbT = U_T;
    sh.uniforms.uSbSea = { value: SEA };
    sh.vertexShader =
      'varying vec3 vSbW;\n' +
      sh.vertexShader.replace(
        '#include <worldpos_vertex>',
        '#include <worldpos_vertex>\n  vSbW = (modelMatrix * vec4(transformed, 1.0)).xyz;',
      );
    sh.fragmentShader =
      CAUSTIC_GLSL +
      `uniform float uSbT; uniform float uSbSea; varying vec3 vSbW;
float sbH(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float sbN(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(sbH(i), sbH(i + vec2(1.0, 0.0)), f.x), mix(sbH(i + vec2(0.0, 1.0)), sbH(i + vec2(1.0, 1.0)), f.x), f.y); }
` +
      sh.fragmentShader.replace(
        '#include <color_fragment>',
        `#include <color_fragment>
  { vec2 wp = vSbW.xz; float cdp = clamp(uSbSea - vSbW.y, 0.0, 3.0);
    float ca = r2Caustic(wp, uSbT);
    diffuseColor.rgb *= (1.0 + ca * 0.55 * smoothstep(0.02, 0.18, cdp) * (1.0 - smoothstep(1.0, 3.0, cdp))) * mix(0.92, 1.06, sbN(wp * 0.9 + 3.0)); }`,
      );
  };
  mat.customProgramCacheKey = () => 'seabed-caustics';
  const mesh = new THREE.Mesh(geoms[0], mat);
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.frustumCulled = false;
  mesh.visible = false;
  mesh.name = 'seabed';
  game.scene.add(mesh);

  // cheap value noise for sand ripples, darker rock and seagrass patches
  const hash = (x, z) => {
    const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
    return s - Math.floor(s);
  };
  const noise = (x, z) => {
    const xi = Math.floor(x),
      zi = Math.floor(z),
      xf = x - xi,
      zf = z - zi,
      u = xf * xf * (3 - 2 * xf),
      v = zf * zf * (3 - 2 * zf);
    const a = hash(xi, zi),
      b = hash(xi + 1, zi),
      c = hash(xi, zi + 1),
      d = hash(xi + 1, zi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  const SAND = new THREE.Color().setRGB(0.5, 0.47, 0.4),
    WET = new THREE.Color().setRGB(
      0.4,
      0.375,
      0.315,
    ) /* linear: the terrain's own wet sand under water */,
    GRASS = new THREE.Color(0x3f5a2e),
    ROCK = new THREE.Color(0x6b6558),
    _c = new THREE.Color();

  let center = null,
    job = null,
    cur = 0;
  // r2-ground: the shelf follows the distance to land, measured on the grid itself (one water test per vertex + a chamfer
  // distance pass) instead of 48+ probes per vertex. It runs out ~40 m and deepens smoothly (0.4 m at 1.5 m out, ~1.8 m at
  // 14 m, ~4 m at 28 m), so the depth-colored shallows fade into deep water over tens of meters instead of a step at 14 m.
  const shelfDepth = (r) => 0.08 + r * 0.025 + r * r * 0.00035;
  // W4 (Nov 19, user: "walking on top of the water" at Miami Beach): off a sand beach the bottom drops like a real surf beach
  // (0.5 m at 6 m out, 1 m at 12 m, swimming depth ~16 m out) instead of the Keys flats' 35 m of ankle-to-knee water where
  // he ran on and on over the caustics. ?beachshelf=0 = flats everywhere.
  const BEACH = !(typeof location !== 'undefined' && /[?&]beachshelf=0\b/.test(location.search));
  // the first ~8 m stay on the drawn terrain bank (all-water terrain vertices sit at -0.55, 0.43 m down), then 0.11 m per m
  const beachDepth = (r) =>
    Math.max(shelfDepth(r), r < 8 ? 0.06 + r * 0.06 : 0.54 + (r - 8) * 0.11); // Keys flats: 0.2 m at 4 m out, 0.7 m at 20 m, 1.6 m at 40 m, 2.8 m at 60 m, 5.2 m at 90 m (same profile as the ocean's far estimate)
  // r2-ground: the seabed you see is the seabed you stand / drive on. A Rapier heightfield built from the very same grid heights
  // (column-major: rows along z, columns along x), swapped with every rebuild; city.seabed.heightAt reads the same grid.
  const W = game.world,
    R = game.RAPIER || globalThis.RAPIER;
  let col = null,
    hfData = null;
  function setCollider(j) {
    if (!W || !R || !R.ColliderDesc || !R.ColliderDesc.heightfield) return;
    try {
      if (col) {
        W.removeCollider(col, false);
        col = null;
      }
      if (!(j.water > 0)) {
        hfData = null;
        return;
      }
      const pos = j.g.attributes.position.array,
        hs = new Float32Array(N * N);
      for (let r = 0; r < N; r++)
        for (let c = 0; c < N; c++) hs[r + c * N] = pos[(r * N + c) * 3 + 1];
      col = W.createCollider(
        R.ColliderDesc.heightfield(N - 1, N - 1, hs, { x: SIZE, y: 1, z: SIZE }).setTranslation(
          j.cx,
          0,
          j.cz,
        ),
      );
      hfData = { cx: j.cx, cz: j.cz, pos };
    } catch (e) {
      console.warn('[seabed] collider failed', e);
    }
  }
  function heightAt(x, z) {
    // bilinear over the current grid (null outside it)
    if (!hfData) return null;
    const fx = (x - (hfData.cx - SIZE / 2)) / STEP,
      fz = (z - (hfData.cz - SIZE / 2)) / STEP;
    const i = Math.floor(fx),
      r = Math.floor(fz);
    if (i < 0 || r < 0 || i >= N - 1 || r >= N - 1) return null;
    const u = fx - i,
      v = fz - r,
      P = hfData.pos,
      y = (rr, cc) => P[(rr * N + cc) * 3 + 1];
    return (
      (y(r, i) * (1 - u) + y(r, i + 1) * u) * (1 - v) +
      (y(r + 1, i) * (1 - u) + y(r + 1, i + 1) * u) * v
    );
  }
  function startBuild(cx, cz) {
    const g = geoms[1 - cur];
    job = {
      g,
      cx,
      cz,
      row: 0,
      water: 0,
      phase: 0,
      W: new Uint8Array(N * N),
      D: new Float32Array(N * N),
    };
  }
  function stepBuild(rows) {
    const j = job,
      pos = j.g.attributes.position.array,
      col = j.g.attributes.color.array;
    const x0 = j.cx - SIZE / 2,
      z0 = j.cz - SIZE / 2;
    if (j.phase === 0) {
      // water mask, a few rows per frame
      for (let r = 0; r < rows * 2 && j.row < N; r++, j.row++) {
        const z = z0 + j.row * STEP;
        for (let i = 0; i < N; i++)
          j.W[j.row * N + i] = city.isWater && city.isWater(x0 + i * STEP, z) ? 1 : 0;
      }
      if (j.row < N) return;
      // chamfer distance (m) from every water vertex to the nearest land vertex (grid border counts as far)
      const D = j.D,
        Wm = j.W,
        A = STEP,
        B = STEP * Math.SQRT2;
      for (let k = 0; k < N * N; k++) D[k] = Wm[k] ? 1e6 : 0;
      for (let y = 0; y < N; y++)
        for (let x = 0; x < N; x++) {
          const k = y * N + x;
          let v = D[k];
          if (!v) continue;
          if (x > 0) v = Math.min(v, D[k - 1] + A);
          if (y > 0) {
            v = Math.min(v, D[k - N] + A);
            if (x > 0) v = Math.min(v, D[k - N - 1] + B);
            if (x < N - 1) v = Math.min(v, D[k - N + 1] + B);
          }
          D[k] = v;
        }
      for (let y = N - 1; y >= 0; y--)
        for (let x = N - 1; x >= 0; x--) {
          const k = y * N + x;
          let v = D[k];
          if (!v) continue;
          if (x < N - 1) v = Math.min(v, D[k + 1] + A);
          if (y < N - 1) {
            v = Math.min(v, D[k + N] + A);
            if (x < N - 1) v = Math.min(v, D[k + N + 1] + B);
            if (x > 0) v = Math.min(v, D[k + N - 1] + B);
          }
          D[k] = v;
        }
      j.phase = 1;
      j.row = 0;
      return;
    }
    for (let r = 0; r < rows && j.row < N; r++, j.row++) {
      const z = z0 + j.row * STEP;
      for (let i = 0; i < N; i++) {
        const x = x0 + i * STEP,
          k = j.row * N + i;
        const water = !!j.W[k],
          sbd = water ? city.seabedDepthAt(x, z) : 0;
        // a sea beach: the data's swim floor is ramped down near sand (minDepthAt) and it is open sea, not a canal / pond / marsh
        // weight 1 within ~37 m of the sand, fading out to the flats by ~55 m (a gentle bar, no step where the ramp ends)
        const bch =
          BEACH &&
          water &&
          sbd < 4.9 &&
          sbd > 0.9 &&
          (!game.miamiData?.waterKindAt || game.miamiData.waterKindAt(x, z) === 'sea')
            ? 1 - Math.min(1, Math.max(0, (sbd - 3) / 1.9))
            : 0;
        const rr = Math.max(0, j.D[k] - 0.5),
          shelf =
            j.D[k] < 1e5
              ? bch > 0
                ? shelfDepth(rr) + (beachDepth(rr) - shelfDepth(rr)) * bch
                : shelfDepth(rr)
              : 99;
        let y = water ? SEA - Math.max(0.2, Math.min(sbd, shelf)) : -0.35; // under land: hidden by the land surface, forms the shore slope
        if (!Number.isFinite(y)) y = SEA - 3;
        if (water) {
          j.water++;
          y += (noise(x * 0.35, z * 0.35) - 0.5) * 0.35 * Math.min(1, j.D[k] / 12);
          const eb = Math.min(i, j.row, N - 1 - i, N - 1 - j.row);
          if (eb < 2) y -= 1.5;
        } // the outer rim tucks down (the ocean fades its see-through out before it: uSbRect)
        if (water && j.D[k] < (bch > 0.5 ? 8 : 12) && city.terrain && city.terrain.heightAt) {
          const th = city.terrain.heightAt(x, z);
          if (th > y && th > -0.6) y = th - 0.005;
        } // off a beach only the drawn bank strip (all-water terrain reads -0.55 but is not drawn) // r2-ground: meet the terrain's under-water strip, so the collider is the drawn bottom there too
        pos[k * 3] = x;
        pos[k * 3 + 1] = y;
        pos[k * 3 + 2] = z;
        const n1 = noise(x * 0.08, z * 0.08),
          n2 = noise(x * 0.6 + 17, z * 0.6 - 9);
        _c.copy(SAND).lerp(WET, 0.2 + 0.3 * n2); // pale coral sand like the beach above (r2-ground)
        const far = water ? Math.min(1, Math.max(0, (j.D[k] - 8) / 10)) : 0; // seagrass / rock only away from the beach
        if (n1 > 0.62 && far > 0)
          _c.lerp(GRASS, Math.min(1, (n1 - 0.62) * 4) * far); // seagrass meadows
        else if (n1 < 0.18 && far > 0) _c.lerp(ROCK, Math.min(1, (0.18 - n1) * 5) * far); // rocky patches
        col[k * 3] = _c.r;
        col[k * 3 + 1] = _c.g;
        col[k * 3 + 2] = _c.b;
      }
    }
    if (j.row >= N) {
      j.g.attributes.position.needsUpdate = true;
      j.g.attributes.color.needsUpdate = true;
      j.g.computeVertexNormals();
      j.g.computeBoundingSphere();
      cur = 1 - cur;
      mesh.geometry = j.g;
      mesh.visible = j.water > 0;
      setCollider(j);
      center = { x: j.cx, z: j.cz };
      job = null;
      const oc = game.env && game.env.ocean;
      if (oc && oc.uniforms && oc.uniforms.uSbRect)
        oc.uniforms.uSbRect.value.set(j.cx, j.cz, SIZE / 2, j.water > 0 ? 1 : 0); // r2-ground: the ocean fades its see-through out at the grid rim
    }
  }
  function update() {
    const p = game.player?.position;
    if (!p || !city.seabedDepthAt) return;
    const cx = Math.round(p.x / 20) * 20,
      cz = Math.round(p.z / 20) * 20;
    // only rebuild when the player is within ~100 m of water (swimming, boating, on a pier, a beach or a coast road): the floor is
    // only visible from (or through) nearby water; the shallows' depth color (ocean.js) reads it too
    const W = city.isWater,
      nearWater =
        !!W &&
        (W(p.x, p.z) ||
          [
            [60, 0],
            [-60, 0],
            [0, 60],
            [0, -60],
            [100, 0],
            [-100, 0],
            [0, 100],
            [0, -100],
            [70, 70],
            [-70, 70],
            [70, -70],
            [-70, -70],
          ].some(([a, b]) => W(p.x + a, p.z + b)));
    if (!job && nearWater && (!center || Math.hypot(cx - center.x, cz - center.z) > 40))
      startBuild(cx, cz);
    if (job) {
      if (!center) {
        while (job) stepBuild(N);
      } else stepBuild(6);
    } // first build at once (loading), later builds spread over ~30 frames
  }
  game.updaters.push(update);
  return {
    mesh,
    update,
    heightAt,
    get collider() {
      return col;
    },
  };
}
