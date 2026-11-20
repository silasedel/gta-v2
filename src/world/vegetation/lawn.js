// Lawn: GPU-generated grass blades over a soil-and-thatch ground, driven by a height field around the camera.
//  - Blades: one tapered, curved blade template (5 triangles) drawn with InstancedBufferGeometry in 3 rings (fine near, coarser
//    farther, out to ~40 m). Every blade's world position, clump, height, width, lean, hue and wind response is derived in the vertex
//    shader from gl_InstanceID and a world-stable hash, so there is no card, grid or repeated pattern. 3 draw calls, no shadow pass.
//  - Field texture (256 x 256 over 128 m, re-centered as the camera moves, built over several frames): height, dryness, weeds and
//    clover, bare/worn soil, mowing-stripe parity. Short park lawns grow back over game days after mowing; verges and lots stay long
//    and seedy; desire paths and worn patches are bare.
//  - Ground: the lawn ground material gets a soil + thatch texture near the camera (seen between blades) and the field's
//    stripes / dryness far away, so the blade zone blends into the textured ground.
//  - Blades bend with the shared wind (game.wind gust fronts) and flatten where the player and pedestrians walk.
//  - game.grass: heightAt(x, z), mow(area), lastMowed(x, z), mower { start(area), stop(), active }, stats().
//  - A ride-on mower with a driver mows park lawns in daytime, cutting stripes lane by lane.
import * as THREE from 'three';
import { vegUniforms } from './materials.js';
import { GM_GLSL, gmUniforms } from '../ground/surfaceMask.js';

const MOWN_Z =
  /beach|nightlife|park|residential|downtown|business|brickell|midtown|edgewater|arts|causeway|commercial/;
// world_nov19b: soft rim of the lawn field window on the ground. ?nov19b=0 = old.
const LAWN_RIM = !(typeof location !== 'undefined' && /[?&]nov19b=0\b/.test(location.search));
const FN = 256,
  FSIZE = 128,
  FRES = FSIZE / FN,
  LANE = 1.3;
const RINGS = [
  { dk: 0.055, R: 9 },
  { dk: 0.11, R: 20 },
  { dk: 0.24, R: 40 },
];

function soilTexture() {
  // dark loam, grit, thatch (dead blades), a few live sprigs; 2 m tile. Low contrast (greenery): read as one
  // soft ground tone at grazing light, not as bright specks (grain)
  const S = 512,
    c = document.createElement('canvas');
  c.width = c.height = S;
  const x = c.getContext('2d');
  let sd = 4242;
  const r = () => (sd = (sd * 16807) % 2147483647) / 2147483647;
  x.fillStyle = '#4b432f';
  x.fillRect(0, 0, S, S);
  for (let i = 0; i < 9000; i++) {
    const v = 58 + r() * 32;
    x.fillStyle = `rgba(${v + 12},${v + 5},${v * 0.72},${0.18 + r() * 0.25})`;
    const w = 1 + r() * 3;
    x.fillRect(r() * S, r() * S, w, w);
  }
  for (let i = 0; i < 2600; i++) {
    const px = r() * S,
      py = r() * S,
      a = r() * 6.28,
      L = 6 + r() * 22,
      l = 32 + r() * 14;
    x.strokeStyle = `hsla(${34 + r() * 16},${22 + r() * 18}%,${l}%,${0.35 + r() * 0.3})`;
    x.lineWidth = 0.8 + r() * 1.4;
    x.beginPath();
    x.moveTo(px, py);
    x.quadraticCurveTo(
      px + Math.cos(a) * L * 0.5 + (r() - 0.5) * 6,
      py + Math.sin(a) * L * 0.5 + (r() - 0.5) * 6,
      px + Math.cos(a) * L,
      py + Math.sin(a) * L,
    );
    x.stroke();
  }
  for (let i = 0; i < 1800; i++) {
    const px = r() * S,
      py = r() * S,
      a = r() * 6.28,
      L = 4 + r() * 10;
    x.strokeStyle = `hsla(${85 + r() * 25},${35 + r() * 15}%,${24 + r() * 10}%,0.6)`;
    x.lineWidth = 1 + r();
    x.beginPath();
    x.moveTo(px, py);
    x.lineTo(px + Math.cos(a) * L, py + Math.sin(a) * L);
    x.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

function bladeTemplate() {
  // x across (-0.5..0.5), y = t along the blade (0 base .. 1 tip)
  const P = [],
    I = [],
    rows = [0, 0.35, 0.68, 1];
  for (let k = 0; k < 3; k++) P.push(-0.5, rows[k], 0, 0.5, rows[k], 0);
  P.push(0, 1, 0);
  I.push(0, 1, 3, 0, 3, 2, 2, 3, 5, 2, 5, 4, 4, 5, 6);
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setIndex(I);
  g.setAttribute(
    'normal',
    new THREE.Float32BufferAttribute(
      new Array(P.length).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)),
      3,
    ),
  );
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
  return g;
}

export function createLawn({ M, root, data, lawnTester = null, game = globalThis.game }) {
  const surf = data?.surfaceAt,
    gh = data?.groundHeightAt;
  const field = new Uint8Array(FN * FN * 4),
    next = new Uint8Array(FN * FN * 4);
  const fieldTex = new THREE.DataTexture(field, FN, FN, THREE.RGBAFormat);
  fieldTex.magFilter = THREE.LinearFilter;
  fieldTex.minFilter = THREE.LinearFilter;
  fieldTex.needsUpdate = true;
  const U = {
    uField: { value: fieldTex },
    uFieldO: { value: new THREE.Vector2(-1e5, -1e5) },
    uFieldS: { value: FSIZE },
    uPress: { value: Array.from({ length: 16 }, () => new THREE.Vector4(1e6, 1e6, 0, 0)) },
    uCamXZ: { value: new THREE.Vector2() },
  };
  const soil = soilTexture();
  // ---- mowing state: 1 m cells -> { t: game day mowed, hd: lane heading (rad), off: lane origin offset } ----
  const mowCells = new Map();
  let days = 3.5,
    lastTod = null;
  const n2 = (x, z, s) => {
    const h = (a, b) => {
      let q = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263);
      q = Math.imul(q ^ (q >>> 13), 1274126177);
      return ((q ^ (q >>> 16)) >>> 0) / 4294967296;
    };
    const X = x / s,
      Z = z / s,
      i = Math.floor(X),
      j = Math.floor(Z),
      fx = X - i,
      fz = Z - j,
      u = fx * fx * (3 - 2 * fx),
      v = fz * fz * (3 - 2 * fz);
    const a = h(i, j),
      b = h(i + 1, j),
      c = h(i, j + 1),
      d = h(i + 1, j + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  const _mow = { t: 0, hd: 0, off: 0, def: true },
    _sm = new Float64Array(5); // perf (Nov 18): scratch results (stepJob ran per texel: ~160 MB a probe)
  function mowAt(x, z) {
    const k = Math.floor(x) * 100003 + Math.floor(z);
    const c = mowCells.get(k);
    if (c) return c;
    const ago = 0.4 + n2(x + 911, z - 37, 60) * 8.5,
      q = n2(x - 300, z + 800, 90) > 0.5 ? 0 : Math.PI / 2;
    _mow.t = days - ago;
    _mow.hd = q;
    _mow.off = 0;
    return _mow;
  }
  const lastMowed = (x, z) => mowAt(x, z).t;
  // ---- field sample: [height m, dry 0..1, weed 0..1, bare 0..1, stripe -1/0/1] ----
  function sample(x, z, test) {
    const s = surf ? surf(x, z) : 'grass_short',
      lawn = test ? test(x, z) : null;
    if (lawn === false || (lawn === null && s !== 'grass_short' && s !== 'grass_long')) return null;
    if (s === 'water' || s === 'asphalt') return null;
    const y = gh ? gh(x, z) : 0;
    if (!(y > -0.5 && y < 0.3)) return null;
    const long = s === 'grass_long' && !(data?.zoneAt && MOWN_Z.test(data.zoneAt(x, z) || '')),
      dry = Math.max(0, n2(x, z, 23) * 1.4 - 0.75) + 0.25 * Math.max(0, n2(x + 50, z, 7) - 0.6); // (greenery) city parks / verges / beach lawns are mown; long grass stays in rural / wild areas
    const path =
      Math.abs(Math.sin((x * 0.71 + z * 0.7) * 0.045 + n2(x, z, 30) * 5.0)) < 0.035 &&
      n2(x - 9, z + 4, 45) > 0.55; // desire paths
    const bare = Math.max(path ? 0.9 : 0, Math.max(0, n2(x + 13, z - 7, 5) - 0.78) * 4);
    const weed = Math.max(0, n2(x - 70, z + 21, 3.5) - 0.55) * 2.2 + (long ? 0.15 : 0);
    let h,
      stripe = 0;
    if (long) h = 0.22 + 0.3 * n2(x + 3, z + 3, 6);
    else {
      const m = mowAt(x, z),
        age = Math.max(0, days - m.t);
      h = Math.min(0.13, 0.03 + 0.011 * age) * (0.85 + 0.3 * n2(x, z, 2));
      if (age < 4.5) {
        const px = -Math.cos(m.hd),
          pz = Math.sin(m.hd);
        stripe = Math.floor((x * px + z * pz - m.off) / LANE) & 1 ? 1 : -1;
      }
    }
    h *= 1 - Math.min(1, bare);
    if (lawn !== null && test) {
      if (!test(x + 1, z) || !test(x - 1, z) || !test(x, z + 1) || !test(x, z - 1)) h *= 0.6;
    }
    _sm[0] = h;
    _sm[1] = Math.min(1, dry);
    _sm[2] = Math.min(1, weed);
    _sm[3] = Math.min(1, bare);
    _sm[4] = stripe;
    return _sm;
  }
  function writeTexel(arr, i, sm) {
    const o = i * 4;
    if (!sm) {
      arr[o] = arr[o + 1] = arr[o + 2] = 0;
      arr[o + 3] = 128;
      return;
    }
    arr[o] = Math.min(255, (sm[0] / 0.6) * 255);
    arr[o + 1] = sm[1] * 255;
    arr[o + 2] = sm[3] > 0.5 ? 128 + sm[3] * 127 : sm[2] * 127;
    arr[o + 3] = 128 + sm[4] * 127;
  }
  // incremental rebuild (rows per frame) into `next`, then swap
  let job = null;
  const ox = U.uFieldO.value;
  function startJob(cx, cz) {
    job = {
      ox: Math.floor((cx - FSIZE / 2) / 16) * 16,
      oz: Math.floor((cz - FSIZE / 2) / 16) * 16,
      row: 0,
      tests: new Map(),
    };
  }
  const tcache = new Map();
  function testFor(x, z) {
    if (!lawnTester) return null;
    const k = Math.floor(x / 8) * 100003 + Math.floor(z / 8);
    if (tcache.has(k)) return tcache.get(k);
    const ci = Math.floor(x / 8),
      cj = Math.floor(z / 8);
    let t = null;
    try {
      t = lawnTester(ci * 8, cj * 8, ci * 8 + 8, cj * 8 + 8);
    } catch (e) {
      t = null;
    }
    if (t !== null) {
      if (tcache.size > 6000) tcache.clear();
      tcache.set(k, t);
    }
    return t;
  }
  function stepJob(rows) {
    if (!job) return;
    const end = Math.min(FN, job.row + rows);
    for (let j = job.row; j < end; j++)
      for (let i = 0; i < FN; i++) {
        const x = job.ox + (i + 0.5) * FRES,
          z = job.oz + (j + 0.5) * FRES,
          t = testFor(x, z);
        writeTexel(next, j * FN + i, t === null && lawnTester ? null : sample(x, z, t));
      }
    job.row = end;
    if (job.row >= FN) {
      field.set(next);
      ox.set(job.ox, job.oz);
      fieldTex.needsUpdate = true;
      job = null;
    }
  }
  function refreshArea(x0, z0, x1, z1) {
    // after mowing: rewrite the touched texels at once
    const i0 = Math.max(0, Math.floor((x0 - ox.x) / FRES)),
      i1 = Math.min(FN - 1, Math.ceil((x1 - ox.x) / FRES)),
      j0 = Math.max(0, Math.floor((z0 - ox.y) / FRES)),
      j1 = Math.min(FN - 1, Math.ceil((z1 - ox.y) / FRES));
    if (i1 < i0 || j1 < j0) return;
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const o = (j * FN + i) * 4;
        if (field[o] === 0 && field[o + 2] < 128) continue;
        const x = ox.x + (i + 0.5) * FRES,
          z = ox.y + (j + 0.5) * FRES;
        writeTexel(field, j * FN + i, sample(x, z, testFor(x, z)));
      }
    fieldTex.needsUpdate = true;
  }
  // mow(area): { x, z, r, heading?, off? } disc, or { x0, z0, x1, z1, heading } box (stripes run along heading)
  function mow(a) {
    const hd = a.heading ?? 0,
      px = -Math.sin(hd),
      pz = Math.cos(hd),
      off = a.off ?? 0;
    const [x0, z0, x1, z1] =
      a.r != null
        ? [a.x - a.r, a.z - a.r, a.x + a.r, a.z + a.r]
        : [Math.min(a.x0, a.x1), Math.min(a.z0, a.z1), Math.max(a.x0, a.x1), Math.max(a.z0, a.z1)];
    for (let x = Math.floor(x0); x <= x1; x++)
      for (let z = Math.floor(z0); z <= z1; z++) {
        if (a.r != null && Math.hypot(x + 0.5 - a.x, z + 0.5 - a.z) > a.r + 0.5) continue;
        mowCells.set(x * 100003 + z, { t: days, hd, off });
      }
    refreshArea(x0 - 1, z0 - 1, x1 + 1, z1 + 1);
    void px;
    void pz;
  }

  // ---- blade material (MeshStandardMaterial so lighting, shadows received, fog and tone mapping match the world) ----
  const mats = [],
    meshes = [];
  RINGS.forEach((ring, k) => {
    const n = Math.ceil((ring.R * 2) / ring.dk),
      Rin = k ? RINGS[k - 1].R : 0;
    const mat = new THREE.MeshStandardMaterial({
      side: THREE.DoubleSide,
      roughness: 0.78,
      metalness: 0,
    });
    const lu = {
      uSnap: { value: new THREE.Vector2() },
      uN: { value: n },
      uDk: { value: ring.dk },
      uRin: { value: Rin },
      uRout: { value: ring.R },
      uWk: { value: k === 0 ? 1 : k === 1 ? 1.7 : 3.2 },
    };
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, U, lu, {
        uVegTime: vegUniforms.uVegTime,
        uVegWindDir: vegUniforms.uVegWindDir,
        uVegWindSpeed: vegUniforms.uVegWindSpeed,
        uVegWindT: vegUniforms.uVegWindT,
      });
      gmUniforms(sh.uniforms);
      sh.vertexShader =
        GM_GLSL +
        `uniform sampler2D uField; uniform vec2 uFieldO; uniform float uFieldS; uniform vec4 uPress[16]; uniform vec2 uSnap; uniform float uN, uDk, uRin, uRout, uWk;
uniform float uVegTime; uniform vec2 uVegWindDir; uniform float uVegWindSpeed; uniform float uVegWindT;
varying vec3 vGc;
float gh1(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float gGust(vec2 p) { vec2 d = uVegWindDir; float along = dot(p, d), across = -p.x * d.y + p.y * d.x, s = max(uVegWindSpeed, 0.5), t = uVegWindT;
  return clamp(0.5 + 0.3 * sin(6.2831 * ((along - s * 0.9 * t) / 140.0 + 0.13 * sin(across / 90.0))) + 0.16 * sin(6.2831 * ((along - s * 0.7 * t) / 37.0 + across / 210.0) + 1.7) + 0.07 * sin(6.2831 * ((along - s * 0.6 * t) / 9.5) + across * 0.11 + 4.1), 0.0, 1.0); }
` +
        sh.vertexShader
          .replace(
            '#include <beginnormal_vertex>',
            `
  float id = float(gl_InstanceID), ix = mod(id, uN), iz = floor(id / uN);
  vec2 cell = uSnap + (vec2(ix, iz) - uN * 0.5) * uDk;
  float h1 = gh1(cell), h2 = gh1(cell + 17.3), h3 = gh1(cell + 41.9), h4 = gh1(cell + 7.7), h5 = gh1(cell - 3.1);
  vec2 bp = cell + (vec2(h1, h2) - 0.5) * uDk * 1.6;
  vec2 cc = floor(bp / 0.32) * 0.32 + vec2(gh1(floor(bp / 0.32)), gh1(floor(bp / 0.32) + 3.0)) * 0.32; bp = mix(bp, cc, 0.3 * h5); // clumps
  float dC = distance(bp, cameraPosition.xz);
  float keep = 1.0;
  if (uRin > 0.0) keep *= smoothstep(uRin * 0.62, uRin, dC);                       // fade in where the finer ring thins out
  keep *= 1.0 - smoothstep(uRout * 0.62, uRout, dC) * step(uRout, 39.0);           // inner rings thin out toward their edge
  float shrink = uRout > 39.0 ? 1.0 - smoothstep(uRout * 0.72, uRout, dC) : 1.0;  // outer ring: blades shrink into the ground texture
  vec4 fld = texture2D(uField, (bp - uFieldO) / uFieldS);
  float H = fld.r * 0.6, dry = fld.g, wb = fld.b, weed = wb < 0.5 ? wb * 2.0 : 0.0, stripe = fld.a * 2.0 - 1.0;
  if (h3 > keep || H < 0.008 || dC > uRout) H = 0.0;
  { vec4 gmh = gmHard(bp); if (max(max(gmh.r, gmh.g), gmh.b) > 0.35) H = 0.0; } // ground pass: no blades on pavement / roads / mulch rings (cars: gmCarPress below)
  bool isWeed = h4 < weed * 0.35, seed = H > 0.2 && h4 > 0.94;
  float bh = H * (0.55 + 0.9 * h5) * shrink * (isWeed ? 0.55 : 1.0) * (seed ? 1.45 : 1.0);
  float bw = (0.007 + 0.006 * h2) * uWk * (isWeed ? 2.6 : 1.0) * (H > 0.2 ? 1.25 : 1.0);
  float la = h1 * 6.2831; vec2 ld = vec2(cos(la), sin(la));
  if (abs(stripe) > 0.5) ld = normalize(mix(ld, vec2(0.15 * stripe, stripe), 0.8));
  float lean = (0.15 + 0.45 * h3) * (H > 0.2 ? 1.2 : 0.8);
  // wind (shared gust fronts) and trampling
  float g = gGust(bp), ws = clamp(uVegWindSpeed / 4.0, 0.06, 2.2);
  vec2 wv = uVegWindDir * (0.15 + g * 0.9) * ws + vec2(sin(uVegTime * 3.1 + h1 * 30.0), cos(uVegTime * 2.7 + h2 * 30.0)) * 0.08 * (0.3 + g);
  float flt = 0.0; vec2 pushD = vec2(0.0);
  for (int q = 0; q < 16; q++) { vec4 pr = uPress[q]; vec2 dd = bp - pr.xy; float L = length(dd); if (L < pr.z) { float f = (1.0 - L / pr.z) * pr.w; if (f > flt) { flt = f; pushD = dd / max(L, 0.01); } } }
  vec2 gcd; float carF = gmCarPress(bp, gcd); // r2-ground: blades under / around a car are pressed flat and splay out from the body (soft, car-shaped)
  if (carF > flt) { pushD = gcd; }
  flt = max(flt, carF);
  vec2 bendV = ld * lean + wv * (H > 0.2 ? 0.9 : 0.45) * (1.0 - carF) + pushD * flt * 1.6;
  float t = position.y;
  vec2 side = normalize(vec2(-ld.y, ld.x) + vec2(0.001));
  float wdt = bw * (1.0 - t * 0.85);
  vec3 vpos = vec3(bp.x + side.x * position.x * wdt + bendV.x * bh * t * t, 0.0, bp.y + side.y * position.x * wdt + bendV.y * bh * t * t);
  vpos.y = bh * t * (1.0 - 0.35 * min(1.0, length(bendV)) * t) * (1.0 - 0.75 * flt) * (1.0 - 0.6 * carF) + 0.006;
  vec3 objectNormal = normalize(vec3(-side.y * 0.0 + bendV.x * 0.3, 1.0, bendV.y * 0.3) + vec3(side.y, 0.0, -side.x) * 0.25);
  // colour: per-blade hue / value, dark base, light tip, dry tan, weeds darker blue-green, seed heads straw, a few white flowers
  vec3 cBase = vec3(0.055, 0.11, 0.035), cTip = mix(vec3(0.15, 0.34, 0.06), vec3(0.25, 0.43, 0.09), h2) * (0.8 + 0.4 * h5);
  cTip = mix(cTip, vec3(0.5, 0.45, 0.22), dry * (0.35 + 0.5 * h3));
  if (isWeed) { cTip = h5 > 0.93 ? vec3(0.9, 0.88, 0.8) : vec3(0.09, 0.22, 0.07); cBase = vec3(0.04, 0.09, 0.03); }
  if (seed) cTip = vec3(0.62, 0.55, 0.36);
  cTip *= 1.0 + 0.2 * stripe; // mowing stripes: lanes laid in opposite directions read light / dark
  vGc = mix(cBase, cTip, smoothstep(0.0, 0.9, t));
`,
          )
          .replace('#include <begin_vertex>', 'vec3 transformed = vpos;');
      sh.fragmentShader =
        'varying vec3 vGc;\n' +
        sh.fragmentShader
          .replace(
            '#include <color_fragment>',
            '#include <color_fragment>\n diffuseColor.rgb = vGc * 2.0;',
          )
          .replace(
            '#include <normal_fragment_maps>',
            '#include <normal_fragment_maps>\n#ifdef DOUBLE_SIDED\n normal *= faceDirection;\n#endif',
          );
    };
    mat.customProgramCacheKey = () => 'veg-lawn-blades';
    const g = bladeTemplate();
    g.instanceCount = n * n;
    const mesh = new THREE.Mesh(g, mat);
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.name = 'lawnBlades' + k;
    mesh.renderOrder = -1;
    root.add(mesh);
    mats.push({ mat, lu, ring });
    meshes.push(mesh);
  });
  M.grassBlades = mats[0].mat;
  // ---- lawn ground material: soil + thatch near the camera, field stripes / dryness / bare spots everywhere in range ----
  if (M.grass) {
    const prev = M.grass.onBeforeCompile;
    M.grass.onBeforeCompile = (sh) => {
      if (prev) prev(sh);
      Object.assign(sh.uniforms, U, { uSoil: { value: soil } });
      if (!sh.vertexShader.includes('vGW'))
        sh.vertexShader =
          'varying vec2 vGW;\n' +
          sh.vertexShader.replace(
            '#include <worldpos_vertex>',
            '#include <worldpos_vertex>\n  vGW = (modelMatrix * vec4(transformed, 1.0)).xz;',
          );
      if (!sh.fragmentShader.includes('varying vec2 vGW'))
        sh.fragmentShader = 'varying vec2 vGW;\n' + sh.fragmentShader;
      sh.fragmentShader =
        'uniform sampler2D uField; uniform vec2 uFieldO; uniform float uFieldS; uniform sampler2D uSoil;\n' +
        sh.fragmentShader.replace(
          '#include <emissivemap_fragment>',
          `
  { vec2 fuv = (vGW - uFieldO) / uFieldS; vec4 fl = texture2D(uField, fuv); float inF = ${LAWN_RIM ? 'smoothstep(0.0, 14.0, min(min(fuv.x, 1.0 - fuv.x), min(fuv.y, 1.0 - fuv.y)) * uFieldS)' : 'step(0.0, fuv.x) * step(fuv.x, 1.0) * step(0.0, fuv.y) * step(fuv.y, 1.0)'}; // world_nov19b: stripes / dryness fade out over the field window's last 14 m (it was a hard square edge that jumped when the field re-centered)
    float dC = distance(vGW, cameraPosition.xz); vec3 soilC = texture2D(uSoil, vGW * 0.5).rgb * 1.25;
    float near = 1.0 - smoothstep(26.0, 42.0, dC), bare = fl.b > 0.5 ? (fl.b - 0.5) * 2.0 : 0.0;
    diffuseColor.rgb = mix(diffuseColor.rgb, soilC * vec3(0.62, 0.95, 0.45), near * 0.55 * inF);
    diffuseColor.rgb = mix(diffuseColor.rgb, soilC * vec3(1.15, 1.05, 0.95), bare * inF);
    diffuseColor.rgb *= 1.0 + (fl.a * 2.0 - 1.0) * 0.15 * inF;
    diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.2, 1.08, 0.7), fl.g * 0.5 * inF); }
#include <emissivemap_fragment>`,
        );
    };
    const pk = M.grass.customProgramCacheKey?.bind(M.grass);
    M.grass.customProgramCacheKey = () => (pk ? pk() : '') + '|veg-lawn';
    M.grass.needsUpdate = true;
  }

  // ---- mower: original ride-on model with a driver, mows lanes across a lawn box ----
  const mower = (() => {
    const g = new THREE.Group();
    g.name = 'rideOnMower';
    g.visible = false;
    const grime = (() => {
      const c = document.createElement('canvas');
      c.width = c.height = 128;
      const x = c.getContext('2d');
      x.fillStyle = '#fff';
      x.fillRect(0, 0, 128, 128);
      let s = 9;
      const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
      for (let i = 0; i < 900; i++) {
        x.fillStyle = `rgba(${60 + r() * 60},${55 + r() * 50},40,${r() * 0.25})`;
        x.fillRect(r() * 128, r() * 128, 1 + r() * 4, 1 + r() * 3);
      }
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    })();
    const m = (c, r = 0.55, mt = 0) =>
      new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: mt, map: grime });
    const paint = m(0xc83a22, 0.4),
      dark = m(0x222222, 0.8),
      steel = m(0x8a8f94, 0.35, 0.8),
      seatM = m(0x1b1b1b, 0.6),
      shirt = m(0x3f6d8a, 0.9),
      skin = m(0xb98466, 0.7),
      pants = m(0x5a5240, 0.9),
      cap = m(0xe8e2d0, 0.8);
    const add = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) => {
      const o = new THREE.Mesh(geo, mat);
      o.position.set(x, y, z);
      o.rotation.set(rx, ry, rz);
      o.castShadow = true;
      g.add(o);
      return o;
    };
    add(new THREE.BoxGeometry(0.95, 0.32, 1.6), paint, 0, 0.55, 0.05);
    add(new THREE.BoxGeometry(0.9, 0.22, 0.55), paint, 0, 0.62, 0.72, -0.25); // body, hood
    add(new THREE.CylinderGeometry(0.62, 0.62, 0.14, 20), dark, 0, 0.26, 0.15); // cutting deck
    for (const [x, z, r, w] of [
      [-0.52, -0.5, 0.3, 0.22],
      [0.52, -0.5, 0.3, 0.22],
      [-0.45, 0.65, 0.2, 0.14],
      [0.45, 0.65, 0.2, 0.14],
    ])
      add(new THREE.CylinderGeometry(r, r, w, 16), dark, x, r, z, 0, 0, Math.PI / 2);
    add(new THREE.BoxGeometry(0.5, 0.1, 0.45), seatM, 0, 0.82, -0.35);
    add(new THREE.BoxGeometry(0.5, 0.45, 0.08), seatM, 0, 1.05, -0.58);
    add(new THREE.CylinderGeometry(0.025, 0.025, 0.6, 8), steel, 0, 0.98, 0.32, -0.5);
    add(new THREE.TorusGeometry(0.16, 0.025, 6, 16), dark, 0, 1.22, 0.2, -1.1);
    add(new THREE.CylinderGeometry(0.17, 0.2, 0.55, 10), shirt, 0, 1.15, -0.38);
    add(new THREE.SphereGeometry(0.12, 12, 10), skin, 0, 1.55, -0.36);
    add(new THREE.CylinderGeometry(0.13, 0.14, 0.07, 12), cap, 0, 1.64, -0.36);
    add(new THREE.BoxGeometry(0.14, 0.02, 0.12), cap, 0, 1.62, -0.24);
    for (const s of [-1, 1]) {
      add(new THREE.CylinderGeometry(0.05, 0.045, 0.45, 8), shirt, s * 0.2, 1.15, -0.2, -0.9);
      add(new THREE.CylinderGeometry(0.065, 0.06, 0.45, 8), pants, s * 0.12, 0.88, -0.12, -1.4);
      add(new THREE.CylinderGeometry(0.055, 0.05, 0.42, 8), pants, s * 0.12, 0.72, 0.12, -0.2);
    }
    root.add(g);
    let job = null,
      tAcc = 0;
    return {
      group: g,
      get active() {
        return !!job;
      },
      // area: { x0, z0, x1, z1, heading } lanes run along heading (0 = +z); the mower starts at one corner
      start(a) {
        const hd = a.heading ?? 0,
          dx = Math.sin(hd),
          dz = Math.cos(hd),
          px = -dz,
          pz = dx;
        const cx = (a.x0 + a.x1) / 2,
          cz = (a.z0 + a.z1) / 2;
        const ext = (vx, vz) =>
          Math.abs(((a.x1 - a.x0) / 2) * vx) + Math.abs(((a.z1 - a.z0) / 2) * vz);
        const L = ext(dx, dz),
          W = ext(px, pz);
        job = {
          cx,
          cz,
          dx,
          dz,
          px,
          pz,
          L,
          W,
          hd,
          lane: 0,
          s: -L,
          dir: 1,
          off: cx * px + cz * pz - W,
        };
        g.visible = true;
      },
      stop() {
        job = null;
        g.visible = false;
      },
      update(dt) {
        if (!job) return;
        const J = job;
        J.s += J.dir * 2.0 * dt;
        if (J.s > J.L || J.s < -J.L) {
          J.dir *= -1;
          J.s = Math.max(-J.L, Math.min(J.L, J.s));
          J.lane++;
          if (J.lane * LANE > 2 * J.W) {
            this.stop();
            return;
          }
        }
        const lo = -J.W + (J.lane + 0.5) * LANE,
          x = J.cx + J.dx * J.s + J.px * lo,
          z = J.cz + J.dz * J.s + J.pz * lo;
        g.position.set(x, gh ? gh(x, z) : 0, z);
        g.rotation.y = Math.atan2(J.dx * J.dir, J.dz * J.dir);
        tAcc += dt;
        if (tAcc > 0.2) {
          tAcc = 0;
          mow({ x, z, r: 0.62, heading: J.hd, off: J.off });
        }
      },
    };
  })();

  // ---- per-frame ----
  let built = false,
    autoT = 0,
    lastT = performance.now();
  function update(cam) {
    if (!cam) return;
    const now = performance.now(),
      dt = Math.min(0.1, (now - lastT) / 1000);
    lastT = now;
    const tod = game?.timeOfDay;
    if (tod != null) {
      if (lastTod != null) {
        let d = tod - lastTod;
        if (d < -12) d += 24;
        if (d > 0 && d < 2) days += d / 24;
      }
      lastTod = tod;
    }
    const cx = cam.position.x,
      cz = cam.position.z;
    U.uCamXZ.value.set(cx, cz);
    const vis = cam.position.y < 120;
    for (const m of meshes) m.visible = vis && built;
    for (const { lu, ring } of mats)
      lu.uSnap.value.set(Math.floor(cx / ring.dk) * ring.dk, Math.floor(cz / ring.dk) * ring.dk);
    if (!job && (Math.abs(cx - (ox.x + FSIZE / 2)) > 24 || Math.abs(cz - (ox.y + FSIZE / 2)) > 24))
      startJob(cx, cz);
    if (job) {
      stepJob(built ? 24 : FN);
      built = true;
    }
    // pressers: player + nearest pedestrians (feet flatten the blades)
    const P = U.uPress.value;
    let n = 0;
    const pp = game?.player?.position;
    if (pp) P[n++].set(pp.x, pp.z, 0.55, 1);
    const list = game?.peds?.list || [];
    for (let i = 0; i < list.length && n < 15; i++) {
      const q = list[i]?.position || list[i]?.group?.position || list[i]?.mesh?.position;
      if (q && Math.abs(q.x - cx) < 40 && Math.abs(q.z - cz) < 40) P[n++].set(q.x, q.z, 0.5, 1);
    }
    if (mower.active) P[n++].set(mower.group.position.x, mower.group.position.z, 0.9, 0.8);
    for (; n < 16; n++) P[n].set(1e6, 1e6, 0, 0);
    mower.update(dt);
    autoT += dt; // daytime schedule: every ~90 s look for an overgrown park lawn near the camera and mow it
    if (!mower.active && autoT > 90 && tod != null && tod > 8 && tod < 17.5) {
      autoT = 0;
      const a = findLawn(cx, cz);
      if (a) mower.start(a);
    }
  }
  function findLawn(cx, cz) {
    for (let k = 0; k < 40; k++) {
      const a = k * 2.4,
        d = 15 + k * 1.2,
        x = cx + Math.cos(a) * d,
        z = cz + Math.sin(a) * d;
      let ok = 0;
      for (let i = -2; i <= 2; i++)
        for (let j = -2; j <= 2; j++) {
          const s = sample(x + i * 4, z + j * 3, testFor(x + i * 4, z + j * 3));
          if (s && s[0] > 0.05 && s[0] < 0.2) ok++;
        }
      if (ok >= 23)
        return {
          x0: x - 10,
          z0: z - 7,
          x1: x + 10,
          z1: z + 7,
          heading: (Math.round(n2(x, z, 50)) * Math.PI) / 2,
        };
    }
    return null;
  }
  const api = {
    heightAt: (x, z) => {
      const s = sample(x, z, testFor(x, z));
      return s ? s[0] : 0;
    },
    mow,
    lastMowed,
    mower,
    get days() {
      return days;
    },
    set days(v) {
      days = v;
    },
    stats() {
      return {
        drawCalls: meshes.length,
        bladeSlots: RINGS.map((r) => Math.ceil((r.R * 2) / r.dk) ** 2),
        trianglesMax: RINGS.reduce((a, r) => a + Math.ceil((r.R * 2) / r.dk) ** 2 * 5, 0),
        rings: RINGS,
        fieldBuilding: !!job,
      };
    },
    refresh() {
      const c = game?.camera?.position;
      if (c) {
        startJob(c.x, c.z);
        stepJob(FN);
      }
    },
  };
  if (game) game.grass = api;
  return {
    mesh: meshes[0],
    meshes,
    update,
    api,
    dispose() {
      for (const m of meshes) {
        root.remove(m);
        m.geometry.dispose();
        m.material.dispose();
      }
      root.remove(mower.group);
      fieldTex.dispose();
      soil.dispose();
    },
  };
}
