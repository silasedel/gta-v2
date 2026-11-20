// V2 terrain: textured, height-displaced land-cover ground for the synthetic world (everything outside the real-Miami rectangle).
// One material draws every natural cover class from a sampler2DArray of Poly Haven PBR sets (albedo+roughness, normal+AO);
// each triangle carries the three cover layers of its corners and blends them per pixel (height-weighted barycentrics), so a
// tile stays one draw call and class borders are soft. The same height samples feed the Rapier trimesh (render == collider).
import * as THREE from 'three';
import { loadArray, loadSet, setParams } from '../city/pbr.js';
import { loadGroundArrays } from './groundtex.js';
import { patchGround, recipeUniforms } from './groundShader.js';
import { groundClaims } from '../ground/claims.js';
import { R4WATER } from '../env/freshMask.js';
// ground v2 (user's ground scans, hex-tiled recipes, shore bands): ?ground2=0 restores the previous Poly Haven array shader (A/B audits)
export const GROUND2 = typeof location === 'undefined' || !/[?&]ground2=0\b/.test(location.search);

// key, Poly Haven set, uv scale (1 / meters per repeat), tint, wet (standing water amount), rows (farm furrows), macro variation
export const LAYERS = [
  { key: 'lawn', name: 'leafy_grass', scale: 1 / 4.5, tint: 0xeef4dc },
  { key: 'scrub', name: 'sparse_grass', scale: 1 / 6, tint: 0xcfe4b6, level: 0.42 }, // ground-continuity R2: green verges, not orange
  { key: 'forest', name: 'forest_leaves_02', scale: 1 / 5, tint: 0xd8d4c8 },
  { key: 'pine', name: 'forest_ground_04', scale: 1 / 5, tint: 0xe6dccb },
  { key: 'sawgrass', name: 'sparse_grass', scale: 1 / 5, tint: 0xe6d49a, wet: 0.55, level: 0.4 },
  { key: 'marsh', name: 'brown_mud', scale: 1 / 4, tint: 0xb8b49a, wet: 1 },
  { key: 'sand', name: 'coast_sand_01', scale: 1 / 4, tint: 0xfff6e6 },
  { key: 'shell', name: 'coral_gravel', scale: 1 / 2.5, tint: 0xf4efe4, level: 0.62 },
  { key: 'dirt', name: 'dirt', scale: 1 / 5, tint: 0xe8dccb },
  { key: 'farm', name: 'brown_mud', scale: 1 / 3, tint: 0xc0a080, rows: 1 },
  { key: 'grove', name: 'grass_path_2', scale: 1 / 5, tint: 0xe4ecc8 },
  { key: 'rock', name: 'rocky_gravel', scale: 1 / 4, tint: 0xe6e0d4 },
  { key: 'gravel', name: 'gravel_floor', scale: 1 / 3, tint: 0xf0ebe0 },
  { key: 'damp', name: 'damp_sand', scale: 1 / 4, tint: 0xf0e6d2, wet: 0.25 },
  { key: 'base', name: 'sandy_gravel', scale: 1 / 4, tint: 0xe8e2d6 },
  { key: 'meadow', name: 'aerial_grass_rock', scale: 1 / 14, tint: 0xcfe2bc },
];
const LI = Object.fromEntries(LAYERS.map((l, i) => [l.key, i]));
const CLS = {
  park: 'lawn',
  grass: 'lawn',
  garden: 'lawn',
  cemetery: 'lawn',
  golf: 'lawn',
  pitch: 'lawn',
  playground: 'lawn',
  wild: 'scrub',
  scrub: 'scrub',
  forest: 'forest',
  pine: 'pine',
  sawgrass: 'sawgrass',
  wetland: 'marsh',
  mangrove: 'marsh',
  sand: 'sand',
  dune: 'sand',
  island: 'sand',
  dirt: 'dirt',
  construction: 'dirt',
  farmland: 'farm',
  grove: 'grove',
  rock: 'rock',
  gravel: 'gravel',
  campground: 'base',
  parking: 'base',
  plaza: 'base',
  paved: 'base',
  apron: 'lawn',
  runway: 'lawn',
  taxiway: 'lawn',
  marina: 'base',
  pool: 'base',
};
export const LAYER_INDEX = LI;
const YARD = LAYERS.length; // ground v2: render-only class for inland sand (Keys yards, sand lots); layerAt() still answers 'sand'

const hash2 = (x, z) => {
  let h = Math.imul((x * 73856093) ^ (z * 19349663), 2654435761);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
};
// cheap value noise (same family as the shader's) for CPU-side patchiness
export function vnoise(x, z) {
  const ix = Math.floor(x),
    iz = Math.floor(z);
  let fx = x - ix,
    fz = z - iz;
  fx = fx * fx * (3 - 2 * fx);
  fz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz),
    b = hash2(ix + 1, iz),
    c = hash2(ix, iz + 1),
    d = hash2(ix + 1, iz + 1);
  return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
}

export async function createTerrain(renderer, data, opts = {}) {
  const T = data.tileSize || 200,
    WATER_Y = -0.55,
    Y_OFF = -0.02;
  const arr = GROUND2
    ? null
    : await loadArray(
        renderer,
        LAYERS.map((l) => ({ key: l.key, name: l.name, level: l.level })),
        { size: 512 },
      );
  const gtex = GROUND2 ? await loadGroundArrays(renderer) : null,
    gU = GROUND2 ? recipeUniforms([...LAYERS.map((l) => l.key), 'yard']) : null;
  // w: how strongly the layer is graded toward living grass (vegetation track: lush, varied rural green instead of brown / orange)
  const GREEN = {
    lawn: 1,
    scrub: 0.95,
    meadow: 0.9,
    grove: 0.85,
    pine: 0.72,
    forest: 0.68,
    sawgrass: 0.45,
    farm: 0.15,
  };
  const uLay = LAYERS.map(
    (l) => new THREE.Vector4(l.scale, l.wet || 0, l.rows || 0, GREEN[l.key] || 0),
  );
  const uTint = LAYERS.map((l) => new THREE.Color(l.tint ?? 0xffffff));
  const N = LAYERS.length;
  const real = (x, z) => (data.inRealMiami ? data.inRealMiami(x, z) : false);
  const lowAt =
    data.terrainHeightAt && data.terrainHeightAt.lowAt ? data.terrainHeightAt.lowAt : null; // micro-relief drainage lows (relief.js)
  // r8 (user: "sand meets grass in a hard straight line"): the shell apron around a set-piece yard ends in a wandering, patchy
  // edge (1-10 m out, two noise scales), never along the claim rectangle's straight side
  let _claims = null;
  const claimAt = (x, z) => {
    if (!_claims) _claims = groundClaims(data.setpieces || []);
    if (!_claims.at(x, z, 10)) return false;
    if (
      _claims.at(x + 4, z, 0) &&
      _claims.at(x - 4, z, 0) &&
      _claims.at(x, z + 4, 0) &&
      _claims.at(x, z - 4, 0)
    )
      return true; // deep inside: always
    const jx = (vnoise(x * 0.09 + 3.1, z * 0.09) - 0.5) * 7,
      jz = (vnoise(x * 0.09, z * 0.09 - 5.7) - 0.5) * 7,
      pad =
        0.5 +
        6 * vnoise(x * 0.035 - 1.3, z * 0.035 + 2.2) * (0.6 + 0.4 * vnoise(x * 0.21, z * 0.21));
    return !!_claims.at(x + jx, z + jz, pad);
  };
  // the Keys: data-driven (layout places whose kind or name says key), cached on a 64 m grid; no hard-coded coordinates
  const keyPlaces = (data.places || [])
    .filter((p) => /key/i.test(p.kind || '') || /\bkeys?\b/i.test(p.name || ''))
    .map((p) => [p.x, p.z, Math.max(400, p.r || 800)]);
  const keyCache = new Map();
  const isKeys = (x, z) => {
    const k = Math.floor(x / 64) * 100003 + Math.floor(z / 64);
    let v = keyCache.get(k);
    if (v === undefined) {
      v = keyPlaces.some(([px, pz, r]) => (px - x) ** 2 + (pz - z) ** 2 < r * r);
      if (keyCache.size > 200000) keyCache.clear();
      keyCache.set(k, v);
    }
    return v;
  };

  function patch(mat, lod) {
    mat.customProgramCacheKey = () => 'ps-terrain-' + (lod ? 'lod' : 'near');
    mat.onBeforeCompile = (sh) => {
      if (lod && opts.nearCut) opts.nearCut(sh);
      Object.assign(sh.uniforms, {
        tTCol: { value: arr.colR },
        tTNrm: { value: arr.nrmAO },
        uLay: { value: uLay },
        uTint: { value: uTint },
      });
      sh.vertexShader =
        'attribute vec3 aL;\nvarying vec3 vL;\nvarying vec3 vBary;\nvarying vec3 vWP;\nvarying vec3 vWN;\n' +
        sh.vertexShader.replace(
          '#include <fog_vertex>',
          `#include <fog_vertex>
        vL = aL; int tid = gl_VertexID % 3; vBary = vec3(tid == 0 ? 1.0 : 0.0, tid == 1 ? 1.0 : 0.0, tid == 2 ? 1.0 : 0.0);
        vWP = (modelMatrix * vec4(transformed, 1.0)).xyz; vWN = normalize(mat3(modelMatrix) * normal);`,
        );
      sh.fragmentShader =
        `precision highp sampler2DArray;
uniform sampler2DArray tTCol; uniform sampler2DArray tTNrm; uniform vec4 uLay[${N}]; uniform vec3 uTint[${N}];
varying vec3 vL; varying vec3 vBary; varying vec3 vWP; varying vec3 vWN;
float tHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float tNoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(tHash(i), tHash(i + vec2(1.0, 0.0)), f.x), mix(tHash(i + vec2(0.0, 1.0)), tHash(i + vec2(1.0, 1.0)), f.x), f.y); }
` +
        sh.fragmentShader
          .replace(
            '#include <map_fragment>',
            `
          vec2 tp = vWP.xz;
          float n1 = tNoise(tp * 0.011), n2 = tNoise(tp * 0.067 + 3.1), n3 = tNoise(tp * 0.29 + 7.7);
          vec4 tcA[3]; vec4 tnA[3]; float tw[3]; float twet[3]; float trow[3]; float tgrn[3];
          for (int i = 0; i < 3; i++) {
            float Lf = floor(vL[i] + 0.5); int L = int(Lf); vec4 P = uLay[L];
            vec2 uv = tp * P.x;
            vec4 c0 = texture(tTCol, vec3(uv, Lf));
            vec4 c1 = texture(tTCol, vec3(uv * 0.23 + vec2(0.31, 0.71), Lf)); // second, rotated-scale sample kills visible tiling
            vec4 c = mix(c0, c1, 0.25 + 0.3 * n2); c.rgb *= uTint[L];
            tcA[i] = c; tnA[i] = texture(tTNrm, vec3(uv, Lf));
            tw[i] = vBary[i] + dot(c0.rgb, vec3(0.333)) * 0.45 + n3 * 0.2 * vBary[i];
            twet[i] = P.y; trow[i] = P.z; tgrn[i] = P.w;
          }
          float tmx = max(tw[0], max(tw[1], tw[2])) - 0.2;
          vec3 tW = vec3(max(tw[0] - tmx, 0.0), max(tw[1] - tmx, 0.0), max(tw[2] - tmx, 0.0)); tW /= max(1e-4, tW.x + tW.y + tW.z);
          vec4 tCol = tcA[0] * tW.x + tcA[1] * tW.y + tcA[2] * tW.z;
          vec4 tNr = tnA[0] * tW.x + tnA[1] * tW.y + tnA[2] * tW.z;
          float wetK = twet[0] * tW.x + twet[1] * tW.y + twet[2] * tW.z, rowK = trow[0] * tW.x + trow[1] * tW.y + trow[2] * tW.z;
          vec3 alb = tCol.rgb * mix(0.8, 1.12, n1) * mix(0.92, 1.06, n2);
          float grnK = tgrn[0] * tW.x + tgrn[1] * tW.y + tgrn[2] * tW.z;
          alb = mix(alb, alb * vec3(1.04, 1.0, 0.86), smoothstep(0.6, 0.9, n1) * 0.3 * (1.0 - grnK)); // sun-bleached, drier patches (bare layers)
          { // living-grass grade: keep the texture's luminance detail, recolour it as lush green with olive-dry and sandy patches (low frequency)
            float lum = dot(alb, vec3(0.3, 0.59, 0.11)), lv = mix(lum, 0.16, 0.35) * 1.08;
            float lush = smoothstep(0.28, 0.72, n1 * 0.7 + n2 * 0.3), sandy = smoothstep(0.8, 0.94, n2 * 0.75 + n1 * 0.25);
            vec3 gLush = lv * vec3(0.58, 1.0, 0.34), gDry = lv * vec3(0.86, 1.0, 0.5), gSand = lv * vec3(1.18, 1.1, 0.84);
            vec3 g = mix(mix(gDry, gLush, 0.25 + 0.75 * lush), gSand, sandy * 0.4) * mix(0.94, 1.05, n3); // mostly fresh green, olive-dry and sandy only in patches
            alb = mix(alb, g, grnK);
          }
          if (rowK > 0.01) { float fr = 0.5 + 0.5 * sin(tp.x * 3.927); alb *= mix(1.0, mix(0.6, 1.1, fr), rowK); }
          float tRough = tCol.a;
          float pud = wetK * smoothstep(0.5, 0.58, n2 * 0.6 + n3 * 0.4); // standing water in marsh / mangrove mud
          alb = mix(alb, alb * 0.18 + vec3(0.012, 0.02, 0.018), pud); tRough = mix(tRough, 0.05, pud);
          tRough = mix(tRough, tRough * 0.75, wetK * 0.5);
          diffuseColor.rgb *= alb * mix(1.0, tNr.b, 0.7);`,
          )
          .replace(
            '#include <roughnessmap_fragment>',
            'float roughnessFactor = clamp(tRough, 0.04, 1.0);',
          )
          .replace(
            '#include <normal_fragment_maps>',
            `{
          vec3 tnm = vec3(tNr.xy * 2.0 - 1.0, 0.0); tnm.xy *= (1.0 - pud) * 1.15; tnm.z = sqrt(max(0.0, 1.0 - dot(tnm.xy, tnm.xy)));
          if (rowK > 0.01) tnm.x += cos(tp.x * 3.927) * 0.35 * rowK;
          vec3 Nw = normalize(vWN), Tw = normalize(vec3(1.0, 0.0, 0.0) - Nw * Nw.x), Bw = normalize(cross(Nw, Tw));
          if (Bw.z < 0.0) Bw = -Bw;
          normal = normalize((viewMatrix * vec4(normalize(Tw * tnm.x + Bw * tnm.y + Nw * tnm.z), 0.0)).xyz);
        }`,
          );
    };
    return mat;
  }
  const P = GROUND2 ? (m, lod) => patchGround(m, lod, opts, gtex, gU) : patch;
  const nearMat = P(new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0 }), false);
  nearMat.name = 'terrain';
  nearMat.userData.pbr = true;
  const lodMat = P(
    new THREE.MeshStandardMaterial({
      roughness: 1,
      metalness: 0,
      polygonOffset: true,
      polygonOffsetFactor: 2,
      polygonOffsetUnits: 8,
    }),
    true,
  );
  lodMat.name = 'terrain-lod';
  lodMat.userData.pbr = true; // r2-ground: the coarse LOD always loses the depth test to the near terrain where both exist (no z-fight)

  // hard airport / service surfaces (polygons drawn above the terrain)
  const mk = async (name, o) => {
    const s = await loadSet(renderer, name);
    for (const t of [s.map, s.normalMap, s.arm]) {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = 8;
      t.needsUpdate = true;
    }
    const m = new THREE.MeshStandardMaterial(
      setParams(s, {
        vertexColors: true,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -5,
        ...o,
      }),
    );
    m.userData.pbr = true;
    return m;
  };
  const [runway, apron, taxiway] = await Promise.all([
    mk('clean_asphalt', { color: 0xc4c4c4 }),
    mk('hangar_concrete_floor', { color: 0xe8e6e0 }),
    mk('asphalt_04', { color: 0xbdbdbd }),
  ]);
  const surfaces = { runway, apron, taxiway };

  // ---- cover -> layer ----
  // ground v2: open rural land is broken into rectangular crop fields (parcels on a 230 x 170 m grid, ~45 % plowed), with grass
  // margins along the parcel edges and kept 26 m clear of roads (farmyards and houses sit by the road)
  const _farmQ = {};
  function farmAt(x, z) {
    const u = x + 37,
      v = z - 53,
      fi = Math.floor(u / 230),
      fj = Math.floor(v / 170),
      fu = u - fi * 230,
      fv = v - fj * 170;
    if (z > -1200 || x > 1000) return false; // the sugarcane / vegetable belt north of the city (Clewiston, Lake O), not the Everglades or the coast
    if (hash2(fi, fj) > 0.45 || fu < 6 || fu > 224 || fv < 6 || fv > 164) return false;
    if (isKeys(x, z)) return false;
    if (data.roadGraph && data.roadGraph.nearestEdge) {
      const r = data.roadGraph.nearestEdge(x, z, _farmQ, 30);
      if (r && r.dist - r.edge.width / 2 < 26) return false;
    }
    return true;
  }
  const _vergeQ = {};
  // perf (Nov 18): flat probe offsets (the array literals + destructuring here allocated ~110 MB per probe run)
  const W8 = new Float64Array([40, 0, -40, 0, 0, 40, 0, -40, 28, 28, -28, 28, 28, -28, -28, -28]),
    SH4 = new Float64Array([5, 0, -5, 0, 0, 5, 0, -5]);
  const nearWater8 = (x, z) => {
    for (let q = 0; q < 16; q += 2) if (data.isWater(x + W8[q], z + W8[q + 1])) return true;
    return false;
  };
  function layerAt(x, z) {
    const cls = data.coverAt ? data.coverAt(x, z) : 'none';
    let k = CLS[cls];
    if (k === 'sand' && !(data.isWater && nearWater8(x, z))) {
      // inland sand fields (Keys lots): bare sand broken by shell, scrub, rough meadow and mown patches; beaches within 40 m of water stay sand
      const nk =
        vnoise(x * 0.018 + 2.3, z * 0.018 - 7.1) * 0.65 + vnoise(x * 0.06, z * 0.06) * 0.35;
      k =
        nk < 0.22
          ? 'sand'
          : nk < 0.45
            ? 'scrub'
            : nk < 0.62
              ? 'meadow'
              : isKeys(x, z) && nk < 0.8
                ? 'sand'
                : 'lawn'; // (greenery) Keys lots: sandy, matted yards, little lush lawn
    }
    if (!k) {
      // unclassified land: by zone / region, broken into patches
      const zn = data.zoneAt ? data.zoneAt(x, z) : '',
        nz = vnoise(x * 0.02, z * 0.02);
      if (isKeys(x, z)) {
        // Keys: scrub, crushed shell, mown green, rough meadow and sand in two scales of patches (no single flat field)
        const nk = nz * 0.65 + vnoise(x * 0.071 + 13.7, z * 0.071 - 4.1) * 0.35;
        k =
          nk < 0.3
            ? 'scrub'
            : nk < 0.38
              ? 'shell'
              : nk < 0.5
                ? 'lawn'
                : nk < 0.66
                  ? 'sand'
                  : nk < 0.84
                    ? 'scrub'
                    : nk < 0.92
                      ? 'meadow'
                      : 'sand';
      } // (greenery) sandy yards, less mown lawn
      else if (zn === 'airport') k = 'lawn';
      else if (zn === 'wilderness') k = nz < 0.6 ? 'scrub' : 'meadow';
      else if (zn === 'rural') {
        k = nz < 0.55 ? 'meadow' : nz < 0.8 ? 'scrub' : 'dirt';
        if (GROUND2 && farmAt(x, z)) k = 'farm';
      } else k = nz < 0.75 ? 'lawn' : 'scrub';
    }
    // ground pass: the Everglades / Big Cypress are sawgrass prairie with open water sloughs and tree islands, not lawn
    if (
      (k === 'scrub' || k === 'meadow' || k === 'lawn') &&
      data.districtAt &&
      /^(Everglades|Big Cypress)$/.test(String(data.districtAt(x, z) || ''))
    ) {
      const ne =
        vnoise(x * 0.011 + 3.3, z * 0.011 - 1.7) * 0.7 + vnoise(x * 0.047, z * 0.047 + 9.1) * 0.3;
      k = ne < 0.2 ? 'marsh' : ne < 0.78 ? 'sawgrass' : 'scrub';
    }
    // greenery: Keys yards and lots are sandy, matted ground broken by grass patches (user mock-up), not lush lawn
    if (
      isKeys(x, z) &&
      (k === 'lawn' || k === 'meadow' || k === 'scrub') &&
      !(cls === 'park' || cls === 'golf' || cls === 'pitch') &&
      vnoise(x * 0.045 + 5.1, z * 0.045 - 3.3) * 0.7 + vnoise(x * 0.13, z * 0.13) * 0.3 < 0.55
    )
      k = 'sand';
    // vegetation track: road verges through hammock / pine / glade cover are mown grass, not leaf litter (the 'forest' layer read
    // olive-orange along the Overseas Highway); 9-13 m from the carriageway edge, wobbling so the edge is not a ruled line
    if (
      (k === 'forest' || k === 'pine' || k === 'sawgrass') &&
      data.roadGraph &&
      data.roadGraph.nearestEdge
    ) {
      const r = data.roadGraph.nearestEdge(x, z, _vergeQ, 16);
      if (r && r.dist - r.edge.width / 2 < 9 + 4 * vnoise(x * 0.07, z * 0.07)) k = 'scrub';
    }
    // shoreline: a few meters of beach sand on open coast, mud on marsh / mangrove banks
    if (data.isWater && k !== 'marsh')
      for (let q = 0; q < 8; q += 2) {
        const dx = SH4[q],
          dz = SH4[q + 1];
        if (!data.isWater(x + dx, z + dz)) continue;
        let wk = data.waterKindAt ? data.waterKindAt(x + dx, z + dz) : 'sea';
        if (R4WATER && wk === 'sea' && data.waterKindAt)
          for (const s of [2.5, 4.5]) {
            const w2 = data.waterKindAt(x + dx * s, z + dz * s);
            if (w2 && w2 !== 'sea') {
              wk = w2;
              break;
            }
          } // r4-water: a pond's 'sea' raster fringe (Brickell Ave swamp) made a beach-sand strip round the pond
        k =
          wk === 'sea'
            ? k === 'sawgrass' || k === 'forest'
              ? 'marsh'
              : isKeys(x, z) && vnoise(x * 0.05, z * 0.05) < 0.4
                ? 'damp'
                : 'sand'
            : wk === 'lake'
              ? 'damp'
              : k === 'lawn' || k === 'forest' || k === 'pine'
                ? k
                : 'marsh';
        break; // canal / pond / river banks: mud and grass, not beach
      }
    return LI[k];
  }
  // ground-continuity: the shore height follows the share of water around the point (9 probes, 4.5 m) instead of jumping
  // from land to WATER_Y between two 4 m grid vertices: the waterline is a smooth contour, not a jagged triangle saw that
  // z-fights with the ocean plane
  const SH = [
    [0, 0],
    [4.5, 0],
    [-4.5, 0],
    [0, 4.5],
    [0, -4.5],
    [3.2, 3.2],
    [-3.2, 3.2],
    [3.2, -3.2],
    [-3.2, -3.2],
  ];
  const SHF = new Float64Array(SH.flat());
  // coarse = far LOD grids: the base height only (the ±0.3 m micro-relief is invisible there and its 4 m samples are not worth computing)
  const TH0 = data.terrainHeightAt && data.terrainHeightAt.base ? data.terrainHeightAt.base : null;
  const heightAt = (x, z, coarse) => {
    const land =
      (coarse && TH0 ? TH0(x, z) : data.terrainHeightAt ? data.terrainHeightAt(x, z) : 0) + Y_OFF;
    if (!data.isWater) return land;
    let w = 0;
    for (let i = 0; i < 18; i += 2) if (data.isWater(x + SHF[i], z + SHF[i + 1])) w++; // r2-perf: flat offsets (the destructuring for-of allocated ~0.7 GB per 40 s drive)
    if (w === 0) return land;
    if (w === 9) return WATER_Y;
    const f = w / 9,
      k = f * f * (3 - 2 * f);
    // r2-ground: a smooth beach profile across the waterline. Land vertices ease down to ~9 cm above the still water (-0.12),
    // water vertices start ~18 cm under it and deepen with the share of water around them, so the sea plane meets the ground
    // inside a sloping triangle (a clean contour), not on a flat shelf 2 cm above the water ending in a stepped edge
    // height follows the smooth 9-probe water share alone (not the binary water flag, whose raster staircase made a sawtooth
    // waterline); the flag only clamps: land never more than 3 cm under the still water, water at least 4 cm under it
    const t = Math.min(1, Math.max(0, (f - 0.15) / 0.75)),
      s = t * t * (3 - 2 * t),
      h = land + (WATER_Y - land) * s;
    return data.isWater(x, z) ? Math.min(h, -0.16) : Math.max(h, Math.min(land, -0.15));
  };

  // ground v2: meters to the nearest water (0..48), for the beach dry / damp / wet bands and the yard / beach split of 'sand'
  const SR = [2, 4, 7, 11, 16, 23, 32, 48],
    SD8 = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
      [0.707, 0.707],
      [-0.707, 0.707],
      [0.707, -0.707],
      [-0.707, -0.707],
    ];
  const shoreDist = (x, z) => {
    if (!data.isWater) return 48;
    if (data.isWater(x, z)) return 0;
    let any = false;
    for (let q = 0; q < 8; q++) {
      const dx = SD8[q][0],
        dz = SD8[q][1];
      if (data.isWater(x + dx * 48, z + dz * 48) || data.isWater(x + dx * 23, z + dz * 23)) {
        any = true;
        break;
      }
    }
    if (!any) return 48;
    let prev = 0;
    for (let ri = 0; ri < SR.length; ri++) {
      const r = SR[ri];
      for (let q = 0; q < 8; q++)
        if (data.isWater(x + SD8[q][0] * r, z + SD8[q][1] * r)) return (prev + r) / 2;
      prev = r;
    }
    return 48;
  };
  // ---- grid builder (generator: yields every few rows so the streamer stays inside its frame budget) ----
  // returns { geometry, coll: Float32Array (triangle soup, same vertices) } ; skips triangles that are all water or all real Miami
  function* gridGen(x0, z0, x1, z1, cell, o = {}) {
    const nx = Math.max(1, Math.round((x1 - x0) / cell)),
      nz = Math.max(1, Math.round((z1 - z0) / cell)),
      W = nx + 3;
    const H = new Float32Array(W * (nz + 3)),
      Lr = new Uint8Array(W * (nz + 3)),
      Wt = new Uint8Array(W * (nz + 3)),
      Rl = new Uint8Array(W * (nz + 3)),
      Sd = GROUND2 ? new Float32Array(W * (nz + 3)) : null;
    // stream hitches (Nov 19): yield on elapsed time too (8 rows of a mid-LOD chunk took ~150 ms in one step)
    let tY = performance.now();
    for (let j = -1; j <= nz + 1; j++) {
      for (let i = -1; i <= nx + 1; i++) {
        const x = x0 + i * cell,
          z = z0 + j * cell,
          k = (j + 1) * W + i + 1;
        const w = data.isWater ? data.isWater(x, z) : false;
        Wt[k] = w ? 1 : 0;
        H[k] = heightAt(x, z, !!o.lod);
        if (i >= 0 && j >= 0 && i <= nx && j <= nz) {
          Rl[k] = real(x, z) ? 1 : 0;
          Lr[k] = w
            ? LI.marsh
            : layerAt(
                x + (vnoise(x * 0.031 + 7.7, z * 0.031) - 0.5) * 11,
                z + (vnoise(x * 0.031, z * 0.031 - 3.3) - 0.5) * 11,
              ); // ground pass: land-cover borders wander (no ruled straight class edges from the cover polygons)
          if (Sd) {
            const sd = w ? 0 : shoreDist(x, z);
            Sd[k] = sd;
            if (
              Lr[k] === LI.sand &&
              sd > (isKeys(x, z) ? 8 : 24) + 14 * vnoise(x * 0.045 + 7.3, z * 0.045 - 2.9)
            )
              Lr[k] = YARD;
          } // r8: beach -> yard sand along a wandering line, not a contour parallel to the shore
          if (!w && claimAt(x, z)) Lr[k] = LI.shell;
        }
      } // r2-ground: around set-piece yards (Nico's lot) the terrain is the same pale crushed shell as the yard sheet, so its sunk edge has no seam
      if ((j & 7) === 7 || performance.now() - tY > 4) {
        yield;
        tY = performance.now();
      }
    }
    const at = (i, j) => (j + 1) * W + i + 1;
    const P = [],
      Nn = [],
      A = [],
      SA = Sd ? [] : null,
      TL = o.lod ? [] : null,
      LW = Sd && lowAt ? [] : null; // r2-ground: drainage-low strength per vertex (rain puddles)
    const nrm = (i, j) => {
      const hx = H[at(i + 1, j)] - H[at(i - 1, j)],
        hz = H[at(i, j + 1)] - H[at(i, j - 1)];
      const nxv = -hx / (2 * cell),
        nzv = -hz / (2 * cell),
        l = Math.hypot(nxv, 1, nzv);
      return [nxv / l, 1 / l, nzv / l];
    };
    const vtx = (i, j, L) => {
      const k = at(i, j),
        n = nrm(i, j);
      P.push(x0 + i * cell, H[k], z0 + j * cell);
      Nn.push(n[0], n[1], n[2]);
      A.push(L[0], L[1], L[2]);
      if (SA) SA.push(Sd[k]);
      if (LW) LW.push(lowAt(x0 + i * cell, z0 + j * cell));
    };
    const tri = (a, b, c) => {
      // a,b,c = [i, j]; counter-clockwise seen from above (+Y normal)
      const ka = at(a[0], a[1]),
        kb = at(b[0], b[1]),
        kc = at(c[0], c[1]);
      if (Wt[ka] && Wt[kb] && Wt[kc] && H[ka] < -0.45 && H[kb] < -0.45 && H[kc] < -0.45) return;
      if (Rl[ka] && Rl[kb] && Rl[kc]) return; // r2-ground: a 1-2 row strip of shallow mud / sand floor stays under the water next to land (mangroves and riprap stand on it; the seabed takes over beyond) // ground pass: keep water-flagged triangles that still rise above the sea, so the shoreline is where the ground meets the water plane (no stair-step triangle edge)
      const L = [Lr[ka], Lr[kb], Lr[kc]];
      vtx(a[0], a[1], L);
      vtx(b[0], b[1], L);
      vtx(c[0], c[1], L);
      if (TL) {
        const cx = x0 + ((a[0] + b[0] + c[0]) / 3) * cell,
          cz = z0 + ((a[1] + b[1] + c[1]) / 3) * cell,
          tx = Math.floor(cx / T),
          tz = Math.floor(cz / T);
        for (let q = 0; q < 3; q++) TL.push(tx, tz);
      }
    };
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const a = [i, j],
          b = [i + 1, j],
          c = [i + 1, j + 1],
          d = [i, j + 1];
        if ((i + j) & 1) {
          tri(a, d, c);
          tri(a, c, b);
        } else {
          tri(a, d, b);
          tri(b, d, c);
        }
      }
      if ((j & 15) === 15 || performance.now() - tY > 4) {
        yield;
        tY = performance.now();
      }
    }
    const nColl = P.length;
    if (o.skirt) {
      // vertical skirt along the tile border hides cracks against the coarser mid-LOD terrain next door
      const S = o.skirt,
        edge = (i0, j0, i1, j1) => {
          const ka = at(i0, j0),
            kb = at(i1, j1);
          if (Wt[ka] && Wt[kb]) return;
          if (Rl[ka] && Rl[kb]) return;
          const xa = x0 + i0 * cell,
            za = z0 + j0 * cell,
            xb = x0 + i1 * cell,
            zb = z0 + j1 * cell,
            ya = H[ka],
            yb = H[kb],
            L = [Lr[ka], Lr[kb], Lr[ka]];
          for (const [x, y, z] of [
            [xa, ya, za],
            [xa, ya - S, za],
            [xb, yb, zb],
            [xb, yb, zb],
            [xa, ya - S, za],
            [xb, yb - S, zb],
          ]) {
            P.push(x, y, z);
            Nn.push(0, 1, 0);
            A.push(L[0], L[1], L[2]);
            if (SA) SA.push(Sd[x === xa ? ka : kb]);
            if (LW) LW.push(0);
          }
        };
      for (let i = 0; i < nx; i++) {
        edge(i, 0, i + 1, 0);
        edge(i + 1, nz, i, nz);
      }
      for (let j = 0; j < nz; j++) {
        edge(nx, j, nx, j + 1);
        edge(0, j + 1, 0, j);
      }
    }
    if (!P.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(Nn, 3));
    g.setAttribute('aL', new THREE.Float32BufferAttribute(A, 3));
    if (SA) g.setAttribute('aS', new THREE.Float32BufferAttribute(SA, 1));
    if (SA)
      g.setAttribute(
        'aLow',
        new THREE.Float32BufferAttribute(LW || new Array(SA.length).fill(0), 1),
      );
    if (TL) g.setAttribute('aTile', new THREE.Float32BufferAttribute(TL, 2));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return { geometry: g, coll: o.coll ? new Float32Array(P.slice(0, nColl)) : null };
  }
  function grid(x0, z0, x1, z1, cell, o) {
    const it = gridGen(x0, z0, x1, z1, cell, o);
    let r = it.next();
    while (!r.done) r = it.next();
    return r.value;
  }
  const tileHasLand = (tx, tz) => {
    // any synthetic land in this tile (cheap 25 m probe)
    for (let z = tz * T + 12.5; z < (tz + 1) * T; z += 25)
      for (let x = tx * T + 12.5; x < (tx + 1) * T; x += 25)
        if (!real(x, z) && !(data.isWater && data.isWater(x, z))) return true;
    return false;
  };
  const synthetic = (tx, tz) =>
    !(
      real(tx * T, tz * T) &&
      real((tx + 1) * T, tz * T) &&
      real(tx * T, (tz + 1) * T) &&
      real((tx + 1) * T, (tz + 1) * T)
    );
  return {
    LAYERS,
    LI,
    nearMat,
    lodMat,
    surfaces,
    materials: [nearMat, lodMat, runway, apron, taxiway],
    layerAt,
    heightAt,
    isKeys,
    gridGen,
    grid,
    synthetic,
    tileHasLand,
    real,
    Y_OFF,
    WATER_Y,
    tileSize: T,
  };
}
