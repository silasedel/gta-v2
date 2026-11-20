// Ground shader v2 for the land-cover terrain (one draw call per tile, as before).
// Every cover class is a recipe over the user's ground set (groundtex.js): a detail texture A, a second texture B mixed in by a
// noise + height mask, and an optional scan used as large-scale (macro) variation. All texture reads are hex-tiled
// (Mikkelsen 2022: three randomly offset + rotated samples per pixel, blended by barycentric weight x height), so no texture
// ever shows a repeat pattern, at any distance. Class borders blend by triangle barycentrics x texture height x noise.
// Beaches get a dry / damp / wet band from the shore distance (vertex attribute aS, meters to the nearest water).
import * as THREE from 'three';
import { GT } from './groundtex.js';
import { vegUniforms } from '../vegetation/materials.js';
import { CAUSTIC_GLSL } from '../ground/caustics.js';
import { FRESH_U } from '../env/freshMask.js';

// A / B: [texture, meters per repeat, tint (linear multiplier)]; cov: share of B (0..1); mf: B patch size (m);
// M: [macro texture, meters, color strength, B-mask push from the macro's darkness (signed)];
// grade: recolor the grass texture as living grass (0..1), lush: green (1) vs dry olive / straw (0); wet: standing water;
// rows: farm furrows; shore: how strongly the shore wet band applies; nrm: normal strength
const T = (r, g, b) => [r, g, b];
export const RECIPES = {
  lawn: {
    A: ['grass', 1.6, T(1, 1, 1)],
    B: ['soil', 2.4, T(1.12, 1.01, 0.87)],
    cov: 0.06,
    mf: 6,
    M: ['lawn', 23, 0.8, 1.4],
    grade: 0.9,
    lush: 0.78,
    shore: 0.3,
  },
  scrub: {
    A: ['grass', 1.8, T(1, 1, 1)],
    B: ['soil', 2.6, T(1.13, 1.01, 0.86)],
    cov: 0.3,
    mf: 4.5,
    M: ['lawn', 17, 0.8, 1.8],
    grade: 0.8,
    lush: 0.58,
    shore: 0.3,
  },
  forest: {
    A: ['leaves', 3.6, T(0.9, 0.88, 0.82)],
    B: ['soil', 2.8, T(1.1, 1.01, 0.89)],
    cov: 0.32,
    mf: 5,
    M: ['lawn', 21, 0.25, 0.6],
    shore: 0.4,
  },
  pine: {
    A: ['grass', 1.9, T(1, 1, 1)],
    B: ['stony', 3.6, T(1.05, 1.02, 0.95)],
    cov: 0.45,
    mf: 5,
    grade: 0.75,
    lush: 0.32,
    shore: 0.4,
  },
  sawgrass: {
    A: ['grass', 2.0, T(1.05, 1, 0.85)],
    B: ['mud', 3.2, T(1, 1, 1)],
    cov: 0.32,
    mf: 4,
    grade: 0.65,
    lush: 0.3,
    wet: 0.7,
    shore: 0.6,
  }, // ground pass: more standing water in the glades
  marsh: {
    A: ['mud', 3.4, T(1, 1, 1)],
    B: ['grass', 2.0, T(1, 1, 0.9)],
    cov: 0.35,
    mf: 3.5,
    grade: 0.6,
    lush: 0.35,
    wet: 1,
    shore: 0.8,
  },
  sand: {
    A: ['sand', 3.0, T(0.95, 0.92, 0.85)], // r2-ground: near-neutral shell / quartz sand (ART_STYLE: hue 35-45, sat <= 0.18)
    B: ['gravel', 2.2, T(1.18, 1.14, 1.06)],
    cov: 0.04,
    mf: 2.5,
    shore: 1,
    nrm: 0.8,
  },
  shell: {
    A: ['gravel', 2.0, T(1.22, 1.18, 1.1)],
    B: ['sand', 3.0, T(1, 1, 1)],
    cov: 0.3,
    mf: 4,
    shore: 0.8,
  },
  dirt: {
    A: ['soil', 2.8, T(1.14, 1.02, 0.88)],
    B: ['gravel', 2.6, T(0.78, 0.74, 0.68)],
    cov: 0.35,
    mf: 5,
    M: ['sandgrass', 26, 0.3, 0],
    shore: 0.6,
  },
  farm: {
    A: ['soil', 2.4, T(1.0, 0.9, 0.77)],
    B: ['grass', 1.8, T(1, 1, 1)],
    cov: 0.08,
    mf: 3,
    grade: 0.7,
    lush: 0.6,
    rows: 1,
    shore: 0.6,
  },
  grove: {
    A: ['grass', 1.8, T(1, 1, 1)],
    B: ['soil', 2.4, T(1.12, 1.01, 0.87)],
    cov: 0.22,
    mf: 4,
    M: ['lawn', 22, 0.4, 1],
    grade: 0.85,
    lush: 0.62,
    shore: 0.4,
  },
  rock: {
    A: ['stony', 3.6, T(1.05, 1.03, 1)],
    B: ['gravel', 2.6, T(1, 1, 1)],
    cov: 0.4,
    mf: 5,
    shore: 0.5,
  },
  gravel: {
    A: ['gravel', 2.4, T(1, 1, 1)],
    B: ['soil', 2.8, T(1.1, 1.01, 0.89)],
    cov: 0.2,
    mf: 4,
    shore: 0.5,
  },
  damp: {
    A: ['sand', 3.0, T(0.8, 0.78, 0.74)],
    B: ['mud', 3.2, T(1, 1, 1)],
    cov: 0.3,
    mf: 5,
    wet: 0.35,
    shore: 1,
  },
  base: {
    A: ['gravel', 2.4, T(0.98, 0.96, 0.92)],
    B: ['soil', 2.8, T(1.1, 1.01, 0.89)],
    cov: 0.3,
    mf: 5,
    shore: 0.5,
  },
  meadow: {
    A: ['grass', 2.0, T(1, 1, 1)],
    B: ['soil', 2.6, T(1.12, 1.01, 0.87)],
    cov: 0.15,
    mf: 6,
    M: ['lawn', 29, 0.8, 1.4],
    grade: 0.85,
    lush: 0.68,
    shore: 0.4,
  },
  // Keys yards and inland sand lots (user mock-up): matted dry grass and sand, the user's grassy-sand scan as macro
  yard: {
    A: ['sandgrass', 4.6, T(1, 1, 1)],
    B: ['sand', 3.0, T(0.88, 0.86, 0.8)],
    cov: 0.42,
    mf: 7,
    M: ['sandgrass', 31, 0.4, -1.2],
    grade: 0.0,
    lush: 0.3,
    shore: 0.5,
  },
};

export function recipeUniforms(keys) {
  const NC = keys.length,
    RA = [],
    RB = [],
    RC = [],
    RD = [],
    TA = [],
    TB = [];
  for (const k of keys) {
    const r = RECIPES[k] || RECIPES.base,
      a = r.A,
      b = r.B || r.A,
      m = r.M;
    const ga = a[0] === 'grass' ? r.grade || 0 : 0,
      gb = b[0] === 'grass' ? r.grade || 0 : 0;
    RA.push(new THREE.Vector4(GT[a[0]], 1 / a[1], GT[b[0]], 1 / b[1]));
    RB.push(
      new THREE.Vector4(r.B ? r.cov : 0, 1 / (r.mf || 5), m ? GT[m[0]] : -1, m ? 1 / m[1] : 0),
    );
    RC.push(new THREE.Vector4(ga, gb, r.lush ?? 0.5, r.wet || 0));
    RD.push(new THREE.Vector4(m ? m[2] : 0, m ? m[3] : 0, r.rows || 0, r.shore ?? 0.4));
    TA.push(new THREE.Vector3(...a[2]));
    TB.push(new THREE.Vector3(...(b[2] || [1, 1, 1])));
  }
  return {
    NC,
    uRA: { value: RA },
    uRB: { value: RB },
    uRC: { value: RC },
    uRD: { value: RD },
    uTA: { value: TA },
    uTB: { value: TB },
    uRN: { value: keys.map((k) => RECIPES[k]?.nrm ?? 1) },
  };
}

// world_nov19b: seamless class borders across terrain triangles (see the blend in patchGround). ?nov19b=0 = old.
const GSEAM = !(typeof location !== 'undefined' && /[?&]nov19b=0\b/.test(location.search));

export const GROUND_GLSL_HEAD =
  CAUSTIC_GLSL +
  /* glsl */ `
precision highp sampler2DArray;
uniform sampler2DArray tGC; uniform sampler2DArray tGN;
uniform vec4 uRA[NC]; uniform vec4 uRB[NC]; uniform vec4 uRC[NC]; uniform vec4 uRD[NC]; uniform vec3 uTA[NC]; uniform vec3 uTB[NC]; uniform float uRN[NC];
uniform float uVegTime; uniform float uGSea;
varying vec3 vL; varying vec3 vBary; varying vec3 vWP; varying vec3 vWN; varying float vShore; varying float vLow;
float gH1(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
vec2 gH2(vec2 p) { return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))) * 43758.5453); }
float gN(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(gH1(i), gH1(i + vec2(1.0, 0.0)), f.x), mix(gH1(i + vec2(0.0, 1.0)), gH1(i + vec2(1.0, 1.0)), f.x), f.y); }
float gF(vec2 p) { return gN(p) * 0.55 + gN(p * 2.07 + 7.3) * 0.3 + gN(p * 4.3 - 3.1) * 0.15; }
// hex tiling: triangle grid of the skewed uv, per-vertex random rotation + offset, height-weighted blend of the 3 samples
struct GHx { vec3 w; vec2 v1; vec2 v2; vec2 v3; };
GHx gGrid(vec2 uv) {
  vec2 sk = vec2(uv.x - 0.57735027 * uv.y, 1.15470054 * uv.y) * 1.1;
  vec2 b = floor(sk); vec3 t = vec3(fract(sk), 0.0); t.z = 1.0 - t.x - t.y;
  float s = step(0.0, -t.z), s2 = 2.0 * s - 1.0;
  GHx g; g.w = vec3(-t.z * s2, s - t.y * s2, s - t.x * s2);
  g.v1 = b + vec2(s); g.v2 = b + vec2(s, 1.0 - s); g.v3 = b + vec2(1.0 - s, s); return g;
}
mat2 gRot(vec2 v, float L) { float a = gH1(v + L * 7.31) * 6.2832; float c = cos(a), s = sin(a); return mat2(c, s, -s, c); }
vec2 gOff(vec2 v, float L) { return gH2(v * 1.37 + L * 3.17); }
vec3 gWts(vec3 w, vec3 h) { vec3 W = w * w * w * pow(vec3(0.3) + h, vec3(5.0)); return W / max(1e-5, W.x + W.y + W.z); }
// color (rgb + height) only
vec4 gHexC(float L, vec2 uv, vec2 dx, vec2 dy) {
  GHx g = gGrid(uv);
  mat2 R1 = gRot(g.v1, L), R2 = gRot(g.v2, L), R3 = gRot(g.v3, L);
  vec4 c1 = textureGrad(tGC, vec3(R1 * uv + gOff(g.v1, L), L), R1 * dx, R1 * dy);
  vec4 c2 = textureGrad(tGC, vec3(R2 * uv + gOff(g.v2, L), L), R2 * dx, R2 * dy);
  vec4 c3 = textureGrad(tGC, vec3(R3 * uv + gOff(g.v3, L), L), R3 * dx, R3 * dy);
  vec3 W = gWts(g.w, vec3(c1.a, c2.a, c3.a));
  return c1 * W.x + c2 * W.y + c3 * W.z;
}
// color + normal: n.xy = world tilt (x, z), n.z = AO, n.w = roughness
void gHexCN(float L, vec2 uv, vec2 dx, vec2 dy, bool wantN, out vec4 oc, out vec4 on) {
  GHx g = gGrid(uv);
  mat2 R1 = gRot(g.v1, L), R2 = gRot(g.v2, L), R3 = gRot(g.v3, L);
  vec3 u1 = vec3(R1 * uv + gOff(g.v1, L), L), u2 = vec3(R2 * uv + gOff(g.v2, L), L), u3 = vec3(R3 * uv + gOff(g.v3, L), L);
  vec4 c1 = textureGrad(tGC, u1, R1 * dx, R1 * dy), c2 = textureGrad(tGC, u2, R2 * dx, R2 * dy), c3 = textureGrad(tGC, u3, R3 * dx, R3 * dy);
  vec3 W = gWts(g.w, vec3(c1.a, c2.a, c3.a));
  oc = c1 * W.x + c2 * W.y + c3 * W.z;
  on = vec4(0.0, 0.0, 1.0, 0.85);
  if (wantN) {
    vec4 n1 = textureGrad(tGN, u1, R1 * dx, R1 * dy), n2 = textureGrad(tGN, u2, R2 * dx, R2 * dy), n3 = textureGrad(tGN, u3, R3 * dx, R3 * dy);
    // OpenGL normal: +y = image up = -v. Tilt in the rotated uv frame -> back to world (x, z) with the transposed rotation
    vec2 t1 = vec2(n1.x * 2.0 - 1.0, 1.0 - n1.y * 2.0) * R1, t2 = vec2(n2.x * 2.0 - 1.0, 1.0 - n2.y * 2.0) * R2, t3 = vec2(n3.x * 2.0 - 1.0, 1.0 - n3.y * 2.0) * R3;
    on = vec4(t1 * W.x + t2 * W.y + t3 * W.z, n1.z * W.x + n2.z * W.y + n3.z * W.z, n1.w * W.x + n2.w * W.y + n3.w * W.z);
  }
}
// living grass: keep the texture's luminance detail, recolor along a dry straw -> olive -> lush green ramp (low-frequency patches)
vec3 gGrade(vec3 c, float k, float lush, vec2 wp) {
  float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float n = gN(wp * 0.017 + 4.1) * 0.6 + gN(wp * 0.083 - 2.7) * 0.4;
  float lu = clamp(lush + (n - 0.5) * 1.1, 0.0, 1.0);
  vec3 dry = vec3(0.74, 0.69, 0.47), olive = vec3(0.52, 0.57, 0.29), green = vec3(0.36, 0.55, 0.18); // ground pass: straw less orange, olive greener (Florida verges read green with dry patches, not rust)
  vec3 ramp = lu < 0.5 ? mix(dry, olive, lu * 2.0) : mix(olive, green, lu * 2.0 - 2.0 * 0.5);
  ramp /= dot(ramp, vec3(0.2126, 0.7152, 0.0722));
  vec3 g = lum * ramp * mix(0.98, 0.72, lu) * mix(0.88, 1.08, gN(wp * 0.31 + 1.7)) * mix(0.9, 1.06, gF(wp * 0.15 + 2.2)); // straw is brighter than lush green
  return mix(c, g, k);
}
// ground pass: the Keys are pale coral / limestone country (off-white, gray-beige sand, gray-green weeds), not orange
vec3 gKeysGrade(vec3 c, vec2 wp) {
  float k = smoothstep(4150.0, 4500.0, wp.y); if (k <= 0.0) return c;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  vec3 g = vec3(l) * vec3(1.04, 1.0, 0.93);
  vec3 d = mix(c, g, 0.62); // r2-ground: Keys sand / marl near neutral gray-white (mock-up yard sand ~ (176, 171, 162))
  d *= mix(1.3, 1.0, smoothstep(0.12, 0.32, l)) * mix(1.0, 1.05, smoothstep(0.18, 0.45, l)) * mix(1.0, 0.9, smoothstep(0.45, 0.75, l)); // marl / limestone soil: dark dirt lifted toward pale gray-beige, no blown-out white
  return mix(c, d, k);
}
struct GS { vec3 alb; vec2 tilt; float ao; float rough; float h; float wet; float shore; };
GS gRecipe(int i, vec2 wp, vec2 dx, vec2 dy, bool wantN) {
  vec4 A = uRA[i], B = uRB[i], C = uRC[i], D = uRD[i];
  vec4 ca, na; gHexCN(A.x, wp * A.y, dx * A.y, dy * A.y, wantN, ca, na);
  ca.rgb *= uTA[i]; if (C.x > 0.0) ca.rgb = gGrade(ca.rgb, C.x, C.z, wp);
  vec3 mm = vec3(1.0); float mk = 0.0;
  if (B.z >= 0.0) { // macro scan: color ratio against its own average, darkness pushes the B mask
    vec4 mc = gHexC(B.z, wp * B.w + 0.37, dx * B.w, dy * B.w); vec3 avg = max(textureLod(tGC, vec3(0.5, 0.5, B.z), 12.0).rgb, vec3(0.02));
    mm = mc.rgb / avg; mk = 1.0 - dot(mc.rgb, vec3(0.333)) / dot(avg, vec3(0.333));
  }
  GS s; s.alb = ca.rgb; s.tilt = na.xy; s.ao = na.z; s.rough = na.w; s.h = ca.a;
  if (B.x > 0.0) {
    float n = gF(wp * B.y + float(i) * 5.3) + (gN(wp * B.y * 4.1) - 0.5) * 0.25 + mk * D.y;
    float t = smoothstep(B.x - 0.14, B.x + 0.14, n); // 1 = A
    if (t < 0.999) {
      vec4 cb, nb; gHexCN(A.z, wp * A.w + 0.61, dx * A.w, dy * A.w, wantN, cb, nb);
      cb.rgb *= uTB[i]; if (C.y > 0.0) cb.rgb = gGrade(cb.rgb, C.y, C.z, wp);
      float wa = t + ca.a * 0.6, wb = 1.0 - t + cb.a * 0.6, mx = max(wa, wb) - 0.22; wa = max(wa - mx, 0.0); wb = max(wb - mx, 0.0);
      float sw = wa + wb; wa /= sw; wb /= sw;
      s.alb = ca.rgb * wa + cb.rgb * wb; s.tilt = na.xy * wa + nb.xy * wb; s.ao = na.z * wa + nb.z * wb; s.rough = na.w * wa + nb.w * wb; s.h = ca.a * wa + cb.a * wb;
    }
  }
  s.alb *= mix(vec3(1.0), mm, D.x);
  s.tilt *= uRN[i];
  if (D.z > 0.0) { float fr = 0.5 + 0.5 * sin(wp.x * 3.927); s.alb *= mix(1.0, mix(0.68, 1.1, fr), D.z); s.tilt.x += cos(wp.x * 3.927) * 0.4 * D.z; s.h = mix(s.h, fr, 0.5 * D.z); }
  s.wet = C.w; s.shore = D.w;
  return s;
}
`;

export function patchGround(mat, lod, opts, tex, U) {
  mat.customProgramCacheKey = () => 'ps-ground2-' + (lod ? 'lod' : 'near');
  mat.onBeforeCompile = (sh) => {
    if (lod && opts.nearCut) opts.nearCut(sh);
    Object.assign(sh.uniforms, {
      tGC: { value: tex.col },
      tGN: { value: tex.aux },
      uRA: U.uRA,
      uRB: U.uRB,
      uRC: U.uRC,
      uRD: U.uRD,
      uTA: U.uTA,
      uTB: U.uTB,
      uRN: U.uRN,
      uVegTime: vegUniforms.uVegTime,
      uGSea: { value: opts.seaLevel ?? -0.12 },
      tR4Fresh: FRESH_U.tFresh,
      uR4Rect: FRESH_U.uFreshRect,
      uR4g: FRESH_U.uR4,
    });
    sh.vertexShader =
      'attribute vec3 aL;\nattribute float aS;\nattribute float aLow;\nvarying vec3 vL;\nvarying vec3 vBary;\nvarying vec3 vWP;\nvarying vec3 vWN;\nvarying float vShore;\nvarying float vLow;\n' +
      sh.vertexShader.replace(
        '#include <fog_vertex>',
        `#include <fog_vertex>
      vL = aL; vShore = aS; vLow = aLow; int tid = gl_VertexID % 3; vBary = vec3(tid == 0 ? 1.0 : 0.0, tid == 1 ? 1.0 : 0.0, tid == 2 ? 1.0 : 0.0);
      vWP = (modelMatrix * vec4(transformed, 1.0)).xyz; vWN = normalize(mat3(modelMatrix) * normal);`,
      );
    sh.fragmentShader =
      'uniform sampler2D tR4Fresh; uniform vec4 uR4Rect; uniform float uR4g;\n' +
      GROUND_GLSL_HEAD.replace(/\bNC\b/g, String(U.NC)) +
      sh.fragmentShader
        .replace(
          '#include <map_fragment>',
          /* glsl */ `
      vec2 wp = vWP.xz, gdx = dFdx(wp), gdy = dFdy(wp);
      float gdC = distance(cameraPosition, vWP);
      bool gWantN = gdC < 260.0;
      int c0 = int(vL.x + 0.5), c1 = int(vL.y + 0.5), c2 = int(vL.z + 0.5);
      GS s0 = gRecipe(c0, wp, gdx, gdy, gWantN);
      GS gs = s0;
      if (c1 != c0 || c2 != c0) { // class border inside this triangle: height + noise weighted barycentrics
        GS s1 = s0; if (c1 != c0) s1 = gRecipe(c1, wp, gdx, gdy, gWantN);
        GS s2 = s0; if (c2 == c1) s2 = s1; else if (c2 != c0) s2 = gRecipe(c2, wp, gdx, gdy, gWantN);
        float bn = gN(wp * 0.45) * 0.6 + gN(wp * 1.7 + 3.3) * 0.4;
        // ground pass: per-corner world noise (two scales) breaks the triangle-shaped class borders into irregular patches
        ${
          GSEAM
            ? `// world_nov19b (user: "weird triangle formations" in the grass): the blend was not continuous across triangle edges. The
        // corner noise was keyed by the corner's slot (0 / 1 / 2, which differs between the two triangles of an edge) and the texture
        // height term was not scaled by the barycentric, so a corner kept weight on the far edge: every class border showed the
        // triangle outline as a seam. Now the noise is keyed by the class and every term vanishes at the far edge, and the border
        // band is a little wider (one soft transition instead of a stepped quilt). ?nov19b=0 = old.
        vec3 bk = vec3(float(c0), float(c1), float(c2)) * 7.13;
        vec3 bnc = vec3(gN(wp * 0.37 + bk.x), gN(wp * 0.37 + bk.y), gN(wp * 0.37 + bk.z)) * 0.65 + vec3(gN(wp * 1.9 - bk.x), gN(wp * 1.9 - bk.y), gN(wp * 1.9 - bk.z)) * 0.35;
        vec3 tw = vBary * mix(vec3(0.3), vec3(1.7), bnc) + vec3(s0.h, s1.h, s2.h) * 0.55 * smoothstep(0.0, 0.3, vBary) + (bn - 0.5) * 0.5 * vBary;
        float tmx = max(tw.x, max(tw.y, tw.z)) - 0.32; tw = max(tw - tmx, vec3(0.0)); tw /= max(1e-4, tw.x + tw.y + tw.z);`
            : `vec3 bnc = vec3(gN(wp * 0.37 + 11.0), gN(wp * 0.37 - 7.0), gN(wp * 0.37 + 23.0)) * 0.65 + vec3(gN(wp * 1.9 + 3.0), gN(wp * 1.9 - 5.0), gN(wp * 1.9 + 9.0)) * 0.35;
        vec3 tw = vBary * mix(vec3(0.3), vec3(1.7), bnc) + vec3(s0.h, s1.h, s2.h) * 0.55 + (bn - 0.5) * 0.5 * vBary; // multiplicative: a corner's weight still vanishes on the far edge (no seam to the next triangle)
        float tmx = max(tw.x, max(tw.y, tw.z)) - 0.24; tw = max(tw - tmx, vec3(0.0)); tw /= max(1e-4, tw.x + tw.y + tw.z);`
        }
        gs.alb = s0.alb * tw.x + s1.alb * tw.y + s2.alb * tw.z; gs.tilt = s0.tilt * tw.x + s1.tilt * tw.y + s2.tilt * tw.z;
        gs.ao = s0.ao * tw.x + s1.ao * tw.y + s2.ao * tw.z; gs.rough = s0.rough * tw.x + s1.rough * tw.y + s2.rough * tw.z;
        gs.h = s0.h * tw.x + s1.h * tw.y + s2.h * tw.z; gs.wet = s0.wet * tw.x + s1.wet * tw.y + s2.wet * tw.z; gs.shore = s0.shore * tw.x + s1.shore * tw.y + s2.shore * tw.z;
      }
      // macro variation over everything: brightness and hue drift at 40-400 m (aerial views never read as one flat color)
      vec3 alb = gs.alb * mix(0.86, 1.1, gF(wp * 0.0095)) * mix(0.94, 1.05, gN(wp * 0.0023 + 5.0));
      alb *= mix(vec3(1.0), vec3(1.05, 1.0, 0.9), smoothstep(0.55, 0.85, gN(wp * 0.0041 + 9.0)) * 0.7);
      alb = gKeysGrade(alb, wp);
      if (gdC < 32.0) { // ground pass: close-range micro detail (dominant layer at 3.7x frequency, luminance only): crisp grit at the feet, no blur
        float dL = uRA[c0].x, dS = uRA[c0].y * 3.7; vec4 dcol = gHexC(dL, wp * dS + 0.71, gdx * dS, gdy * dS);
        float dAvg = dot(textureLod(tGC, vec3(0.5, 0.5, dL), 12.0).rgb, vec3(0.333)), dR = clamp(dot(dcol.rgb, vec3(0.333)) / max(dAvg, 0.02), 0.55, 1.5);
        alb *= mix(1.0, dR, 0.3 * (1.0 - smoothstep(14.0, 32.0, gdC)));
      }
      float tRough = gs.rough;
      // r2-ground shore (per pixel, from the height above the still water, not the coarse 4 m shore distance): the waterline is where
      // the ground meets the sea plane; a thin sheet of swash rushes up and drains back a meter or so (glossy, foam lace at its front,
      // a bubble line left at the top of the run), soaked dark sand in the swash zone, damp sand fading up the beach, and under the
      // water: darker wet sand with soft caustics (the ocean shader adds the depth color on top)
      float hsea = vWP.y - uGSea;
      float shG = gs.shore * (1.0 - smoothstep(9.0, 22.0, vShore));
      // r4-water: banks of inland water (ponds, canals, the Brickell Ave swamp) are not surf beaches: no swash film / foam lace /
      // caustics there; a damp dark mud band at the waterline, a dark mud bed under the water, no marsh puddles on the bank
      float r4Fg = 0.0;
      if (uR4g > 0.5 && uR4Rect.w > 0.5) { vec2 fu = (wp - uR4Rect.xy) * uR4Rect.z; if (fu.x > 0.0 && fu.y > 0.0 && fu.x < 1.0 && fu.y < 1.0) r4Fg = texture2D(tR4Fresh, fu).r * (1.0 - smoothstep(10.0, 22.0, vShore)); }
      shG *= 1.0 - r4Fg;
      float sn = gN(wp * 0.7 + 3.0), sn2 = gN(wp * 2.9 - 1.0);
      float film = 0.0, wetZ = 0.0, foamS = 0.0;
      if (shG > 0.002 && hsea < 0.6) {
        float slope = length(vWN.xz) / max(vWN.y, 0.2);
        float swPh = uVegTime * 0.5 + gN(wp * 0.013 + 2.0) * 6.2832 + gN(wp * 0.061) * 1.2; // sections of beach out of step with each other
        float su = fract(swPh / 6.2832);
        float run = su < 0.3 ? smoothstep(0.0, 0.3, su) : 1.0 - smoothstep(0.3, 0.97, su); // rush up fast, drain back slowly
        float A = 0.07 + 0.05 * gN(wp * 0.031 + 7.0); // highest run-up (m above the still water)
        float lvl = A * run, rel = hsea + (sn - 0.5) * 0.01 + (sn2 - 0.5) * 0.004;
        film = (1.0 - smoothstep(lvl - 0.005, lvl + 0.002, rel)) * smoothstep(-0.05, -0.01, hsea) * shG;
        wetZ = (1.0 - smoothstep(A * 0.5, A + 0.05 + sn * 0.03, rel)) * shG;
        float upD = max(hsea - A, 0.0) / max(slope, 0.015); // meters up the beach above the swash zone
        float dampZ = (1.0 - smoothstep(0.3, 3.2 + sn * 1.6, upD)) * (1.0 - smoothstep(0.1, 0.3, hsea)) * shG;
        float lace = smoothstep(0.42, 0.68, gN(wp * 5.3 + vec2(uVegTime * 0.11, 0.0)) * 0.55 + gN(wp * 17.0 - vec2(0.0, uVegTime * 0.07)) * 0.45);
        float front = (1.0 - smoothstep(0.0, 0.004 + 0.004 * sn2, abs(rel - lvl))) * smoothstep(0.05, 0.25, run) * mix(1.0, 0.25, smoothstep(0.3, 0.55, su));
        float mark = (1.0 - smoothstep(0.0, 0.003, abs(rel - A))) * smoothstep(0.25, 0.35, su) * (1.0 - smoothstep(0.4, 0.75, su)); // bubbles left at the top of the run
        foamS = clamp(front * 0.9 + mark * 0.45, 0.0, 1.0) * lace * shG * step(-0.02, hsea);
        alb *= mix(vec3(1.0), vec3(0.84, 0.81, 0.77), dampZ * 0.75);
        alb *= mix(vec3(1.0), vec3(0.66, 0.64, 0.61), wetZ);
        tRough = mix(tRough, tRough * 0.8, dampZ); tRough = mix(tRough, 0.26, wetZ * 0.85);
        alb *= mix(vec3(1.0), vec3(0.9, 0.95, 0.95), film); tRough = mix(tRough, 0.05, film);
      }
      if (r4Fg > 0.002) { float bn = gN(wp * 0.45 + 1.7);
        float dB = r4Fg * (1.0 - smoothstep(0.8, 3.2 + bn * 2.2, vShore)) * (1.0 - smoothstep(0.12, 0.35, hsea));
        alb *= mix(vec3(1.0), vec3(0.58, 0.56, 0.52), dB); tRough = mix(tRough, tRough * 0.55, dB); }
      { // under the water: wet, darker, soft moving caustics in the first 2 m
        float under = 1.0 - smoothstep(-0.04, 0.0, hsea);
        if (under > 0.0) {
          float cdp = clamp(-hsea, 0.0, 3.0);
          float ca = r2Caustic(wp, uVegTime);
          ca *= 1.0 - r4Fg;
          alb = mix(alb * 0.8, mix(vec3(0.45, 0.42, 0.355), vec3(0.15, 0.13, 0.095), r4Fg), under * mix(0.7, 1.0, smoothstep(0.03, 0.12, cdp))) /* deeper than ~10 cm: exactly the seabed's wet sand, no lighter terrain triangles near docks */ * (1.0 + ca * 0.55 * under * smoothstep(0.02, 0.18, cdp) * (1.0 - smoothstep(1.0, 3.0, cdp)));
          tRough = mix(tRough, 0.55, under);
        }
      }
      alb = mix(alb, vec3(0.8, 0.82, 0.82), foamS * 0.85); tRough = mix(tRough, 0.45, foamS);
      float wetB = max(wetZ * 0.6, film);
      float pud = gs.wet * smoothstep(0.5, 0.58, gF(wp * 0.067 + 3.1) * 0.6 + gN(wp * 0.29 + 7.7) * 0.4) * (1.0 - r4Fg); // standing water in marsh / mud
      { // r2-ground: rain collects in the micro-relief's drainage lows and roadside swales (fills with the weather's puddle level, dries with it)
        float lowK = vLow + (gF(wp * 0.19 + 5.0) - 0.5) * 0.35 + (gN(wp * 1.3) - 0.5) * 0.08;
        float lp = uWeather.y * smoothstep(0.62 - 0.22 * uWeather.y, 0.7 - 0.2 * uWeather.y, lowK);
        float ld = max(uWeather.x * 0.7, uWeather.y) * smoothstep(0.35, 0.6, lowK); // soaked soil around them
        alb *= 1.0 - ld * 0.3; tRough = mix(tRough, tRough * 0.6, ld);
        pud = max(pud, lp);
      }
      alb = mix(alb, alb * 0.2 + vec3(0.008, 0.012, 0.01), pud); tRough = mix(tRough, 0.05, pud); tRough = mix(tRough, tRough * 0.78, gs.wet * 0.5);
      vec2 gTilt = gs.tilt * (1.0 - pud) * (1.0 - wetB * 0.6);
      diffuseColor.rgb *= alb * mix(1.0, gs.ao, 0.65);`,
        )
        .replace(
          '#include <roughnessmap_fragment>',
          'float roughnessFactor = clamp(tRough, 0.04, 1.0);',
        )
        .replace(
          '#include <normal_fragment_maps>',
          /* glsl */ `{
        vec3 Nw = normalize(vWN), Tw = normalize(vec3(1.0, 0.0, 0.0) - Nw * Nw.x), Bw = normalize(vec3(0.0, 0.0, 1.0) - Nw * Nw.z);
        normal = normalize((viewMatrix * vec4(normalize(Tw * gTilt.x + Bw * gTilt.y + Nw), 0.0)).xyz);
      }`,
        );
  };
  return mat;
}
