// Surfaces pass (overnight Nov 17): paved surfaces that read like real Florida streets up close, at grazing angles and from the air.
// Shader patches chained AFTER the existing material chain (materials.js groundWear, ground/groundEdge.js patchRoadEdges):
//   asphalt (roads, junctions, decals): two-layer stochastic sampling of the user's asphalt scan (no visible 3.2 m tiling),
//     limestone aggregate (two scales, faded by pixel footprint: no shimmer), tar crack-sealer snakes, alligator cracking in old
//     wheel paths; on road ribbons (lane frame from roadChannel.js): per-street and per-section pavement age (sun-bleached old
//     pavement vs dark fresh overlays, transverse construction seams), rubber / oil darkening and polish in the wheel paths, oil
//     drip line in the lane center, sealed longitudinal paving joints between lanes, transverse cracks (open or tar-sealed),
//     concrete gutter pans along curbed streets; rain: puddles collect in ruts, gutters and the low road edges, wheel paths sheen
//   paint (road lines, crosswalks, stop bars): worn most in the wheel paths, chipped (the asphalt shows), dirt-darkened, smoother
//     than the asphalt, a thin darker rim (thermoplastic thickness)
//   sidewalks / curbs: per-slab tone, stains, gum spots, cracked and lifted slabs; curb faces dirty at the bottom with tire scuffs,
//     red / yellow painted runs; tactile dome pads at curb ramps
// Global A/B without reload: SRF_U.value.x (1 = on); `?surfaces=0` skips every patch.
import * as THREE from 'three';

export const SRF_U = { value: new THREE.Vector4(1, 1, 0, 0) };
// (r3-world) `?tar=old`: the previous tar crack-sealer look (thin smooth lines), for A/B shots
const TAR_OLD = typeof location !== 'undefined' && /[?&]tar=old\b/.test(location.search);
export const SURF_OFF = typeof location !== 'undefined' && /[?&]surfaces=0\b/.test(location.search);
if (typeof window !== 'undefined')
  window.__surfaces = {
    u: SRF_U,
    set(on) {
      SRF_U.value.x = on ? 1 : 0;
    },
  };

const C = THREE.ShaderChunk;

const COMMON = /* glsl */ `
uniform vec4 uSrf;
#ifdef SRF_CONC
uniform sampler2D tSrfConc;
#endif
varying vec3 vSrfW;
#ifdef SRF_LANE
varying vec4 vSrfA;
varying vec4 vSrfB;
#endif
float srfH(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec2 srfH2(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
float srfN(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(srfH(i), srfH(i + vec2(1.0, 0.0)), u.x), mix(srfH(i + vec2(0.0, 1.0)), srfH(i + vec2(1.0, 1.0)), u.x), u.y); }
float srfF(vec2 p) { return srfN(p) * 0.55 + srfN(p * 2.03 + 17.1) * 0.3 + srfN(p * 4.11 + 3.7) * 0.15; }
// voronoi in cell units: x = distance to the nearest feature, y = second nearest, z = id hash; rel = p - feature
vec3 srfVor(vec2 p, out vec2 rel) {
  vec2 i = floor(p), f = fract(p); float d1 = 8.0, d2 = 8.0, id = 0.0; rel = vec2(0.0);
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 g = vec2(float(x), float(y)), o = srfH2(i + g) * 0.8 + 0.1, r = g + o - f; float d = dot(r, r);
    if (d < d1) { d2 = d1; d1 = d; id = srfH(i + g + 0.37); rel = -r; } else if (d < d2) d2 = d;
  }
  return vec3(sqrt(d1), sqrt(d2), id);
}
// two-layer stochastic sampling: the scan and a rescaled / shifted copy, blended by world noise (contrast kept)
float srfBW() { vec2 w = vSrfW.xz; return smoothstep(0.28, 0.72, srfN(w * 0.083 + 1.7) * 0.6 + srfN(w * 0.31 + 5.3) * 0.4); }
vec2 srfUV2(vec2 uv) { return uv * 0.7731 + vec2(0.371, 0.613); }
vec4 srfTexB(sampler2D t, vec2 uv, float bias) {
  vec4 a = texture2D(t, uv, bias); if (uSrf.x < 0.5) return a;
  vec4 b = texture2D(t, srfUV2(uv), bias); float w = srfBW();
  vec4 m = textureLod(t, vec2(0.5), 12.0);
  return clamp((mix(a, b, w) - m) * inversesqrt(w * w + (1.0 - w) * (1.0 - w)) * 0.92 + m, 0.0, 1.0);
}
// (r3-world) tar crack-seal band: the binder squeezed out unevenly (ragged rim, a few cm of jitter at close range), the line fades
// out by pixel footprint like before (no shimmer far away)
float srfTarBand(float d, float tw, vec2 w, float fwM) {
  // (ground nov19b) octaves fade by pixel footprint (the 1.6 cm one sparkled along the band edge at mid range)
  float rag = (srfN(w * 23.0) - 0.5) * 0.5 * (1.0 - smoothstep(0.2, 0.4, fwM * 23.0))
    + (srfN(w * 61.0 + 3.3) - 0.5) * 0.35 * (1.0 - smoothstep(0.2, 0.4, fwM * 61.0));
  float t = tw * (1.0 + rag);
  return (1.0 - smoothstep(t, t + fwM, d)) * clamp(tw * 2.5 / fwM, 0.0, 1.0);
}
vec4 srfTex(sampler2D t, vec2 uv) { vec4 a = texture2D(t, uv); if (uSrf.x < 0.5) return a; return mix(a, texture2D(t, srfUV2(uv)), srfBW()); }
`;

const VERT_DECL = /* glsl */ `
varying vec3 vSrfW;
#ifdef SRF_LANE
attribute vec4 aSrfA;
attribute vec4 aSrfB;
varying vec4 vSrfA;
varying vec4 vSrfB;
#endif
`;
const VERT_BODY = /* glsl */ `
  { vec4 sw4 = vec4(transformed, 1.0);
    #ifdef USE_INSTANCING
      sw4 = instanceMatrix * sw4;
    #endif
    vSrfW = (modelMatrix * sw4).xyz;
    #ifdef SRF_LANE
      vSrfA = aSrfA; vSrfB = aSrfB;
    #endif
  }`;

// lane frame -> wheel paths etc. (shared by asphalt and paint)
const LANE_FN = /* glsl */ `
#ifdef SRF_LANE
// x: wheel path weight, y: drip line, z: lane-center offset (m), w: junction fade
vec4 srfLane() {
  if (vSrfB.x <= 0.0) return vec4(0.0);
  float o = vSrfA.x, s = vSrfA.y, hw = vSrfA.z, lw = clamp(vSrfA.w, 2.4, 4.6);
  float jf = smoothstep(0.5, 10.0, min(s - vSrfB.y, vSrfB.z - s));
  float x = o + hw, li = floor(x / lw), lc = x - (li + 0.5) * lw;
  float wob = (srfN(vec2(s * 0.031, li * 7.0)) - 0.5) * 0.32 + (srfN(vec2(s * 0.11, li * 3.0 + 1.0)) - 0.5) * 0.1;
  float d = abs(lc + wob);
  float traffic = mod(vSrfB.w, 4.0) < 0.5 ? 0.45 : 1.0;                    // Keys / rural lanes: light traffic
  float wheel = exp(-pow((d - 0.88) / 0.33, 2.0)) * mix(0.55, 1.0, jf) * traffic * (0.45 + 0.55 * smoothstep(0.2, 0.6, srfN(vec2(s * 0.022, li * 1.7 + 4.0))));
  float drip = exp(-pow((lc + wob * 0.6) / 0.3, 2.0)) * smoothstep(0.38, 0.72, srfN(vec2(s * 0.42, li * 3.1))) * jf;
  return vec4(wheel, drip, lc, jf);
}
#endif
`;

const ASPHALT_MAIN = /* glsl */ `
vec2 srfTilt = vec2(0.0); float srfLow = 0.5, srfPolish = 0.0;
if (uSrf.x > 0.5) {
  vec2 w = vSrfW.xz, wl = mod(w, 128.0);
  float fwM = max((fwidth(w.x) + fwidth(w.y)) * 0.5, 1e-4);
  float age = 0.55 + (srfN(w * 0.007 + 3.1) - 0.5) * 0.45 + (srfN(w * 0.05 + 8.0) - 0.5) * 0.12;
  float wheel = 0.0, drip = 0.0, gut = 0.0, tar = 0.0, crk = 0.0, edgeLow = 0.0, gutJ = 0.0, streak = 0.5;
  #ifdef SRF_LANE
  if (vSrfB.x > 0.0) {
    vec4 L = srfLane(); wheel = L.x; drip = L.y; float jf = L.w;
    streak = srfN(vec2(vSrfA.y * 0.25, vSrfA.x * 7.0)) * 0.6 + srfN(vec2(vSrfA.y * 1.3, vSrfA.x * 19.0)) * 0.4;
    float o = vSrfA.x, s = vSrfA.y, hw = vSrfA.z, lw = clamp(vSrfA.w, 2.4, 4.6), seed = vSrfB.x;
    float cls = mod(vSrfB.w, 4.0), curbed = step(3.5, vSrfB.w);
    // pavement age per street, and per repaving section along it (45-155 m runs; ~1 in 4 is a later, darker overlay)
    float secLen = 45.0 + 110.0 * fract(seed * 7.13), ss = s + seed * 977.0, sec = floor(ss / secLen), fs = ss - sec * secLen;
    float hs = srfH(vec2(sec, seed * 91.0)), hsP = srfH(vec2(sec - 1.0, seed * 91.0)), hsN = srfH(vec2(sec + 1.0, seed * 91.0));
    float sAge = fract(seed * 13.37 + 0.31);
    sAge = cls > 2.5 ? 0.15 + sAge * 0.55 : cls < 0.5 ? 0.55 + sAge * 0.45 : 0.2 + sAge * 0.8;
    float fresh = step(hs, 0.24);
    float a1 = mix(sAge, hs * 0.5, fresh);
    // soften the section boundary over ~1.5 m only where both sides share the same age (no visible seam there)
    age = mix(age, a1 + (srfN(w * 0.045) - 0.5) * 0.14, jf);
    float dS = min(fs, secLen - fs) + (srfN(vec2(o * 1.3, sec)) - 0.5) * 0.08;
    float seamHere = max(fresh, fs < secLen * 0.5 ? step(hsP, 0.24) : step(hsN, 0.24));
    tar = max(tar, (1.0 - smoothstep(0.03, 0.03 + fwM, dS)) * seamHere * jf * clamp(0.06 / fwM, 0.0, 1.0) * 0.8);
    // longitudinal paving joints just beside each lane line, sealed with tar (broken where the sealant wore off)
    float x = o + hw, lj = x / lw, dl = (lj - floor(lj + 0.5)) * lw;
    float interior = step(0.7, x) * step(x, 2.0 * hw - 0.7) * step(0.5, cls) * step(3.6, hw);
    float dj = abs(dl - 0.17 + (srfN(vec2(s * 0.27, floor(lj + 0.5))) - 0.5) * 0.06);
    float jw = 0.012 + 0.012 * srfN(vec2(s * 0.8, lj));
    tar = max(tar, (1.0 - smoothstep(jw, jw + fwM, dj)) * interior * smoothstep(0.45, 0.65, srfN(vec2(s * 0.09, lj * 5.0)) + age * 0.15) * clamp(jw * 2.5 / fwM, 0.0, 1.0) * jf * 0.85);
    // transverse cracks every ~9 m on older pavement, some open, most tar-sealed
    float tc = floor(ss / 9.0), tcPos = (tc + 0.2 + 0.6 * srfH(vec2(tc, seed * 3.0))) * 9.0;
    float dT = abs(ss - tcPos + (srfN(vec2(o * 0.8, tc)) - 0.5) * 0.9 + (srfN(vec2(o * 5.0, tc + 5.0)) - 0.5) * 0.08);
    float ext = smoothstep(0.38, 0.52, srfN(vec2(o * 0.22 + tc * 3.1, tc))) * step(srfH(vec2(tc, seed * 5.0)), age * 0.85 - 0.1) * jf;
    float sealed = step(0.4, srfH(vec2(tc + 2.0, seed)));
${
  TAR_OLD
    ? `
    float tw = mix(0.0035, 0.03, sealed);
    float tline = (1.0 - smoothstep(tw, tw + fwM, dT)) * ext * clamp(tw * 2.0 / fwM, 0.0, 1.0);
`
    : `
    float tw = mix(0.0035, 0.024 + 0.03 * srfN(vec2(o * 1.3, tc + 9.0)), sealed); // (r3-world) sealed: 2.5-5.5 cm, uneven along the crack
    float tline = sealed > 0.5 ? srfTarBand(dT, tw, w, fwM) * ext : (1.0 - smoothstep(tw, tw + fwM, dT)) * ext * clamp(tw * 2.0 / fwM, 0.0, 1.0);
`
}
    tar = max(tar, tline * sealed); crk = max(crk, tline * (1.0 - sealed));
    // longitudinal cracks (tar-sealed on most streets) wandering along a wheel path for 10-40 m
    { float lc2 = L.z; float side = srfH(vec2(sec, seed * 3.3)) < 0.5 ? -1.0 : 1.0;
      float run = floor(ss / 23.0), on = step(srfH(vec2(run, seed * 7.7 + sec)), 0.25 + age * 0.45);
      float dLc = abs(lc2 - side * (0.9 + 0.5 * (srfH(vec2(run, 1.0)) - 0.5)) + (srfN(vec2(s * 0.35, run)) - 0.5) * 0.45 + (srfN(vec2(s * 2.1, run)) - 0.5) * 0.06);
${
  TAR_OLD
    ? `
      float lw2 = 0.012 + 0.016 * srfN(vec2(s * 0.5, run + 3.0));
      float fadeE = smoothstep(0.0, 0.25, fract(ss / 23.0)) * smoothstep(1.0, 0.75, fract(ss / 23.0));
      tar = max(tar, (1.0 - smoothstep(lw2, lw2 + fwM, dLc)) * on * fadeE * jf * clamp(lw2 * 2.5 / fwM, 0.0, 1.0)); }
`
    : `
      dLc = abs(dLc + (srfN(vec2(s * 4.3, run + 5.0)) - 0.5) * 0.03); // (r3-world) the crack under the seal kinks at cm scale
      float lw2 = 0.016 + 0.026 * srfN(vec2(s * 0.5, run + 3.0));
      float fadeE = smoothstep(0.0, 0.25, fract(ss / 23.0)) * smoothstep(1.0, 0.75, fract(ss / 23.0));
      tar = max(tar, srfTarBand(dLc, lw2, w, fwM) * on * fadeE * jf); }
`
}
    // concrete gutter pan along curbed streets (0.5 m), contraction joints every 3 m
    float dg = hw - abs(o);
    gut = curbed * (1.0 - smoothstep(0.5, 0.5 + fwM * 1.5, dg));
    float jd = abs(fract(s / 3.05 + 0.5) - 0.5) * 3.05;
    gutJ = gut * (1.0 - smoothstep(0.006, 0.006 + fwM, jd)) * clamp(0.02 / fwM, 0.0, 1.0);
    // crowned road: the edges are the low side
    edgeLow = pow(clamp(abs(o) / max(hw, 1.0), 0.0, 1.0), 3.0) * (1.0 - gut) + gut * smoothstep(0.5, 0.0, dg) ;
  }
  #endif
  // crack sealer snakes (world space: also in junctions), more on older pavement
  {
    float nC = srfN(w * 0.065 + vec2(srfN(w * 0.19), srfN(w * 0.19 + 4.0)) * 1.1);
    float gC = max(fwidth(nC), 1e-6) / fwM;
${
  TAR_OLD
    ? `
    float dC = abs(nC - 0.5) / max(gC, 0.02);
    float mC = smoothstep(0.4, 0.56, srfN(w * 0.021 + 11.0)) * smoothstep(0.2, 0.6, age);
    float tw2 = 0.018 + 0.016 * srfN(w * 0.7);
    tar = max(tar, (1.0 - smoothstep(tw2, tw2 + fwM, dC)) * mC * clamp(tw2 * 2.5 / fwM, 0.0, 1.0));
`
    : `
    // (r3-world, user Nov 17: the smooth pen-drawn curves read fake) the crack under the seal wanders and kinks at 2-60 cm scale,
    // the band width changes along it (thin pour 1-3 cm, squeegeed overband sections 4.5-7.5 cm) and its rim is ragged
    float sC = (nC - 0.5) / max(gC, 0.02) + (srfN(w * 1.7 + 2.0) - 0.5) * 0.06 + (srfN(w * 5.3 + 7.0) - 0.5) * 0.022 + (srfN(w * 13.0 + 1.0) - 0.5) * 0.008;
    float dC = abs(sC);
    float mC = smoothstep(0.4, 0.56, srfN(w * 0.021 + 11.0)) * smoothstep(0.2, 0.6, age);
    float over = smoothstep(0.45, 0.75, srfN(w * 0.23 + 5.0));
    float tw2 = mix(0.011 + 0.016 * srfN(w * 0.9), 0.045 + 0.03 * srfN(w * 0.6 + 1.0), over);
    tar = max(tar, srfTarBand(dC, tw2, w, fwM) * mC);
`
}
  }
  // alligator (fatigue) cracking in old wheel paths
  {
    float m = smoothstep(0.62, 0.9, (wheel * 0.8 + 0.2) * age * (0.4 + srfN(w * 0.11 + 2.0) * 1.1)) * (1.0 - smoothstep(0.005, 0.014, fwM)) * (1.0 - gut);
    if (m > 0.01) { vec2 q = wl + (vec2(srfN(wl * 3.1), srfN(wl * 3.1 + 7.7)) - 0.5) * 0.09; vec2 rel; vec3 v = srfVor(q / 0.16, rel);
      float e = (v.y - v.x) * 0.08; float cw = 0.0012 + 0.0016 * srfN(wl * 9.0);
      float part = smoothstep(0.3, 0.5, srfN(wl * 5.3 + 1.1));               // not every cell edge has opened
      crk = max(crk, (1.0 - smoothstep(cw, cw + fwM, e)) * m * part * clamp(cw * 3.0 / fwM, 0.0, 1.0) * 0.8); }
  }
  // aggregate: pale limestone chips showing through the binder (more on old, worn pavement), two sizes, faded by pixel size
  float expo = clamp(mix(0.1, 0.62, age) * (0.55 + 0.9 * srfN(w * 0.55)) + wheel * 0.18, 0.0, 0.9) * (1.0 - gut) * uSrf.y;
  float aggTone = 1.0;
  for (int k = 0; k < 2; k++) {
    float cell = k == 0 ? 0.0105 : 0.024;
    float fA = 1.0 - smoothstep(cell * 0.2, cell * 0.5, fwM);
    if (fA <= 0.0) continue;
    vec2 rel; vec3 v = srfVor(wl / cell, rel);
    float r = 0.3 + 0.16 * srfH(vec2(v.z, 1.3));
    float st = 1.0 - smoothstep(r * 0.55, r, v.x);
    float show = step(srfH(vec2(v.z * 7.1, 2.0 + float(k))), expo * (k == 0 ? 1.0 : 0.6));
    float tone = v.z < 0.18 ? 0.55 : 1.15 + 0.85 * srfH(vec2(v.z, 9.0));
    aggTone *= mix(1.0, tone, st * show * fA * 0.8);
    float slope = st * (1.0 - st) * 3.2 * show * fA;
    srfTilt += (v.x > 1e-4 ? rel / v.x : vec2(0.0)) * slope * (k == 0 ? 0.5 : 0.35);
  }
  // pores between the chips: tiny dark speckle at close range
  // tone: fresh overlay near-black and fine, old pavement sun-bleached, warm gray
  float toneA = mix(0.7, 1.16, age);
  vec3 bleach = mix(vec3(0.97, 0.98, 1.0), vec3(1.04, 1.02, 0.97), age);
  diffuseColor.rgb *= toneA * bleach * aggTone;
  // tire tracks: rubber-darkened, polished bands; streaky along the lane
  float trk = wheel * (0.75 + 0.5 * streak);
  diffuseColor.rgb *= (1.0 - 0.27 * trk * (0.35 + 0.65 * age)) * (1.0 - 0.3 * drip);
  // gutter pan: poured concrete, dirt and leaf grime toward the curb
  if (gut > 0.0) {
    float l = dot(diffuseColor.rgb, vec3(0.333));
    #ifdef SRF_CONC
      vec3 cc = texture2D(tSrfConc, w / 4.0 + 0.37).rgb * 0.78 * (0.9 + 0.2 * srfF(w * 0.6));
    #else
      vec3 cc = vec3(0.30, 0.295, 0.28) * (0.85 + 0.3 * srfF(w * 2.3)) * (0.9 + 0.2 * clamp(l * 3.0, 0.0, 1.0));
    #endif
    cc *= 1.0 - 0.3 * smoothstep(0.65, 0.95, srfF(w * 0.9 + 3.0));
    diffuseColor.rgb = mix(diffuseColor.rgb, cc * (1.0 - 0.55 * gutJ), gut);
    roughnessFactor = mix(roughnessFactor, 0.88, gut);
  }
${
  TAR_OLD
    ? `
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.026, 0.025, 0.024), tar * 0.8);
  diffuseColor.rgb *= 1.0 - 0.6 * crk;
  roughnessFactor = mix(roughnessFactor, 0.64, tar * 0.8); // sealant: satin, not a mirror line at grazing angles
`
    : `
  // (r3-world) tar sealant body: near-black binder with sand / fine-aggregate grit pressed into it (pale flecks, darker pools),
  // a slight sheen where it is thick and smooth, rougher where the grit shows; the grit fades out by pixel footprint
  float tGF = 1.0 - smoothstep(0.004, 0.012, fwM);
  float tGrit = mix(srfN(w * 38.0) * 0.6 + srfN(w * 91.0 + 1.3) * 0.4, 0.5, smoothstep(0.2, 0.4, fwM * 91.0));
  float tFleck = step(0.86, srfH(floor(w * 160.0))) * (1.0 - smoothstep(0.0015, 0.003, fwM)); // 6 mm cells: only while a cell spans 2+ px
  vec3 tarCol = vec3(0.030, 0.029, 0.027) * (0.8 + 0.55 * (tGrit - 0.5) * tGF) + vec3(0.075, 0.07, 0.062) * tFleck;
  diffuseColor.rgb = mix(diffuseColor.rgb, tarCol, tar * 0.88);
  diffuseColor.rgb *= 1.0 - 0.6 * crk;
  roughnessFactor = mix(roughnessFactor, 0.44 + 0.3 * tGrit * tGF + 0.25 * tFleck, tar * 0.85); // sealant: slight satin sheen, gritty (not a mirror line)
`
}
  roughnessFactor *= 1.0 - 0.24 * wheel - 0.12 * drip;
  roughnessFactor = mix(roughnessFactor, roughnessFactor * 0.9, 1.0 - age);
  srfLow = clamp(0.2 + srfF(w * 0.16) * 0.5 + wheel * age * 0.3 + edgeLow * 0.45 + crk * 0.2, 0.0, 1.0);
  srfPolish = clamp(wheel * 0.9 + drip * 0.5 + tar * 0.6, 0.0, 1.0);
}
`;

const PAINT_MAIN = /* glsl */ `
if (uSrf.x > 0.5) {
  vec2 w = vSrfW.xz;
  float fwM = max((fwidth(w.x) + fwidth(w.y)) * 0.5, 1e-4);
  float wheel = 0.0;
  #ifdef SRF_LANE
  wheel = srfLane().x;
  #endif
  float age = 0.45 + (srfN(w * 0.02 + 2.0) - 0.5) * 0.7;
  float wear = clamp(age * 0.45 + wheel * 0.75, 0.0, 1.0);
  // (ground nov19b) each octave goes to its mean before it gets near one cycle per two pixels: the discard below is a hard
  // per-pixel cut, and the 1.6 cm octave aliased into a crawling speckle along every stripe edge at 5-12 m
  float wn = srfN(w * 7.0) * 0.55
    + mix(srfN(w * 23.0 + 3.0), 0.5, smoothstep(0.2, 0.4, fwM * 23.0)) * 0.3
    + mix(srfN(w * 61.0), 0.5, smoothstep(0.2, 0.4, fwM * 61.0)) * 0.15;
  float near = 1.0 - smoothstep(0.003, 0.008, fwM);
  if (wn < wear * 0.62 * near) discard;                                     // chipped: the asphalt shows
  float gone = smoothstep(0.0, 0.25, wear * 0.62 - wn + 0.12);
  vec3 asph = vec3(0.08, 0.08, 0.082);
  diffuseColor.rgb = mix(diffuseColor.rgb, asph, clamp(gone * (1.0 - near) * 0.55 + wear * 0.25, 0.0, 0.7)); // far: worn paint reads as faded
  diffuseColor.rgb *= 1.0 - 0.28 * smoothstep(0.35, 0.85, srfF(w * 1.1)) - 0.18 * wheel;   // dirt and tire grime
  // thermoplastic thickness: a slightly darker, rounded rim along the stripe edges (atlas column = u quarter)
  #ifdef USE_MAP
  { float q = fract(vMapUv.x * 4.0); float e = min(q - 0.08, 0.92 - q) / 0.84; diffuseColor.rgb *= mix(0.82, 1.0, smoothstep(0.0, 0.07, e)); }
  #endif
  roughnessFactor = mix(roughnessFactor, 0.58, 0.55);
}
`;

const WALK_MAIN = /* glsl */ `
vec2 srfTilt = vec2(0.0);
if (uSrf.x > 0.5) {
  vec2 w = vSrfW.xz, wl = mod(w, 128.0);
  float fwM = max((fwidth(w.x) + fwidth(w.y)) * 0.5, 1e-4);
  vec3 wN = normalize((vec4(vNormal, 0.0) * viewMatrix).xyz);
  bool tactile = false;
  #ifdef USE_COLOR
    tactile = vColor.r > vColor.b * 2.2 && vColor.g > vColor.b * 1.5;
  #endif
  if (wN.y > 0.7 && tactile) {
    // detectable warning pad: truncated domes on a 6 cm grid, molded plastic
    // (ground nov19b) 2.3 cm domes on a 6 cm grid: gone before a pixel reaches ~1/4 of the grid (they turned into moire at 4-12 mm/px)
    float fD = 1.0 - smoothstep(0.0025, 0.006, fwM);
    vec2 g = wl / 0.06, f = fract(g) - 0.5; float r = length(f) * 0.06, R = 0.0115;
    float dome = 1.0 - smoothstep(R * 0.8, R, r);
    srfTilt += (r > 1e-5 ? f / length(f) : vec2(0.0)) * smoothstep(R * 0.45, R, r) * dome * 1.2 * fD;
    diffuseColor.rgb *= mix(1.0, 0.75, smoothstep(R * 0.75, R, r) * dome * fD);
    diffuseColor.rgb *= 1.0 - 0.25 * smoothstep(0.5, 0.9, srfF(w * 3.0));
    roughnessFactor = mix(roughnessFactor, 0.55, 0.7);
  } else if (wN.y > 0.7) {
    // poured slabs (1.5 m): own tone per slab, stains, gum, a few cracked or lifted
    // slab grid of the scan (3 m tile: one joint across u at 0.03, two along v at 0 and 0.452), so tone changes stop at real joints
    vec2 sc = floor(w / 1.5), lp = w / 1.5 - sc - 0.5;
    #if defined( USE_MAP ) && defined( SRF_SLAB )
    { vec2 um = vMapUv; float fu = um.x - 0.03, fv = fract(um.y), lo = step(0.452, fv);
      sc = vec2(floor(fu), floor(um.y) * 2.0 + lo); lp = vec2(fract(fu) - 0.5, lo > 0.5 ? (fv - 0.452) / 0.548 - 0.5 : fv / 0.452 - 0.5); }
    #endif
    float h = srfH(sc + 0.5), h2 = srfH(sc + 7.3);
    #ifndef SRF_SLAB
      h = 0.5;  // pavers / terrazzo: no slab logic, only stains and gum
    #endif
    diffuseColor.rgb *= (0.92 + 0.16 * h) * mix(vec3(1.0), vec3(1.02, 1.0, 0.96), h2);
    #ifdef SRF_SLAB
      diffuseColor.rgb *= 1.38; // r2-roads / r2-art audit: poured concrete in sun reads L 0.20-0.32, clearly lighter than the asphalt (was 0.146)
    #endif
    float stain = smoothstep(0.66, 0.86, srfN(w * 1.1 + h * 17.0) * 0.7 + srfN(w * 4.0) * 0.3);
    diffuseColor.rgb *= 1.0 - 0.22 * stain;
    float drip = smoothstep(0.75, 0.95, srfF(w * 0.35 + 9.0)); diffuseColor.rgb *= 1.0 - 0.12 * drip;
    // gum: flattened dark spots 1.5-3 cm, gone where they would be sub-pixel
    float fG = 1.0 - smoothstep(0.006, 0.018, fwM);
    if (fG > 0.0) { vec2 rel; vec3 v = srfVor(wl / 0.33, rel); float rr = (0.024 + 0.022 * srfH(vec2(v.z, 3.0))) / 0.33;
      float gum = (1.0 - smoothstep(rr * 0.6, rr, v.x + (srfN(wl * 90.0) - 0.5) * 0.05)) * step(srfH(vec2(v.z, 8.0)), 0.07) * fG;
      diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.55, 0.54, 0.53), gum); roughnessFactor = mix(roughnessFactor, 0.6, gum); }
    // cracked slab: one jagged crack across it
    if (h < 0.08) { float a = h2 * 6.283; vec2 dn = vec2(cos(a), sin(a)); float dd = abs(dot(lp, dn) + (srfN(w * 6.0) - 0.5) * 0.06) * 1.5;
      float cw = 0.003; diffuseColor.rgb *= 1.0 - 0.6 * (1.0 - smoothstep(cw, cw + fwM, dd)) * clamp(cw * 3.0 / fwM, 0.0, 1.0); }
    // lifted slab (tree roots): tilted, dark gap along its high edge
    if (h > 0.95) { vec2 dir = normalize(vec2(h2 - 0.5, fract(h2 * 7.0) - 0.5) + 1e-3); srfTilt -= dir * 0.05;
      float edge = 1.0 - smoothstep(0.0, 0.03 + fwM, (0.5 - max(abs(lp.x), abs(lp.y))) * 1.5); diffuseColor.rgb *= 1.0 - 0.35 * edge * step(0.0, dot(lp, dir)); }
  } else if (wN.y < 0.35) {
    // curb face: road grime at the bottom, tire scuffs, red / yellow painted runs
    float hR = 0.0;
    #ifdef USE_MAP
      hR = vMapUv.y / max(0.3 * 0.8333, 1e-3);
    #endif
    float along = w.x * 0.83 + w.y * 0.56;
    float grime = 1.0 - smoothstep(0.0, 0.07 + 0.04 * srfN(vec2(along * 2.0, 0.0)), hR);
    float run = floor(along / 7.5), ph = srfH(vec2(run, 4.2));
    vec3 paint = ph < 0.07 ? vec3(0.62, 0.43, 0.05) : ph < 0.11 ? vec3(0.46, 0.05, 0.04) : vec3(-1.0);
    if (paint.x > 0.0) { float chip = smoothstep(0.35, 0.5, srfN(vec2(along * 9.0, hR * 40.0)) + 0.25 - srfN(vec2(along * 0.4, 2.0)) * 0.3);
      float lum = dot(diffuseColor.rgb, vec3(0.333)); diffuseColor.rgb = mix(diffuseColor.rgb, paint * (0.75 + 0.5 * lum), (1.0 - chip) * 0.92); roughnessFactor = mix(roughnessFactor, 0.6, 1.0 - chip); }
    diffuseColor.rgb *= 1.0 - 0.45 * grime * (0.6 + 0.4 * srfN(vec2(along * 3.0, 1.0)));
    float scuff = smoothstep(0.7, 0.85, srfN(vec2(along * 0.6, 7.0))) * smoothstep(0.012, 0.03, hR) * smoothstep(0.1, 0.06, hR) * smoothstep(0.4, 0.6, srfN(vec2(along * 6.0, 2.0)));
    diffuseColor.rgb *= 1.0 - 0.55 * scuff;
  }
}
`;

const TILT_APPLY =
  '\n{ if (uSrf.x > 0.5) normal = normalize(normal + (viewMatrix * vec4(srfTilt.x, 0.0, srfTilt.y, 0.0)).xyz); }\n';

function wetChunk() {
  // the global wet chunk with puddles steered to the surface's low spots and a sheen in the wheel paths
  let s = C.lights_physical_fragment;
  const p0 = 'float puddle = uWeather.y * up * smoothstep( 0.52, 0.66, pn + 0.18 * uWeather.y );';
  const r0 =
    'material.roughness = mix( material.roughness, mix( 0.24, 0.42, 1.0 - up ), sheen * 0.85 );';
  if (!s.includes(p0) || !s.includes(r0)) return null;
  s = s.replace(
    p0,
    'float puddle = uWeather.y * up * smoothstep( 0.52, 0.66, ( uSrf.x > 0.5 ? mix( pn, srfLow, 0.7 ) : pn ) + 0.18 * uWeather.y );',
  );
  s = s.replace(
    r0,
    r0 +
      '\n  if ( uSrf.x > 0.5 ) material.roughness = mix( material.roughness, mix( 0.35, 0.11, srfPolish ), sheen * 0.9 ); // wet asphalt: ~0.35, polished wheel paths / tar ~0.1 (puddles go to 0.04 below)',
  );
  return s;
}

function resolved(name, from, to) {
  const c = C[name];
  return c && c.includes(from) ? c.split(from).join(to) : null;
}

// kind: 'asphalt' | 'paint' | 'walk'; lane: the mesh carries aSrfA / aSrfB (roadChannel.js)
export function patchSurface(mat, kind, { lane = false, conc = null, slab = false } = {}) {
  if (!mat || SURF_OFF || mat.userData['srf_' + kind]) return mat;
  mat.userData['srf_' + kind] = true;
  const prev = mat.onBeforeCompile,
    prevKey = mat.customProgramCacheKey ? mat.customProgramCacheKey.bind(mat) : () => '';
  mat.onBeforeCompile = (sh, r) => {
    if (prev) prev.call(mat, sh, r);
    sh.uniforms.uSrf = SRF_U;
    if (lane) sh.defines = Object.assign(sh.defines || {}, { SRF_LANE: '' });
    if (slab) sh.defines = Object.assign(sh.defines || {}, { SRF_SLAB: '' });
    if (lane && conc && kind === 'asphalt') {
      sh.defines.SRF_CONC = '';
      sh.uniforms.tSrfConc = { value: conc };
    }
    sh.vertexShader =
      VERT_DECL +
      sh.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>' + VERT_BODY);
    let fs = sh.fragmentShader;
    const head = COMMON + (kind !== 'walk' ? LANE_FN : '');
    fs = fs.replace('void main() {', head + 'void main() {');
    if (kind === 'asphalt') {
      // stochastic sampling of the scan (albedo with groundWear's mip bias, roughness / AO / normal)
      fs = fs.replace(/texture2D\( map, vMapUv, ([0-9.]+) \)/, 'srfTexB( map, vMapUv, $1 )');
      if (!/srfTexB\( map/.test(fs))
        fs = fs.replace(
          '#include <map_fragment>',
          resolved('map_fragment', 'texture2D( map, vMapUv )', 'srfTexB( map, vMapUv, 0.0 )') ||
            '#include <map_fragment>',
        );
      const rough =
        resolved(
          'roughnessmap_fragment',
          'texture2D( roughnessMap, vRoughnessMapUv )',
          'srfTex( roughnessMap, vRoughnessMapUv )',
        ) || C.roughnessmap_fragment;
      fs = fs.replace('#include <roughnessmap_fragment>', rough + ASPHALT_MAIN);
      const ao = resolved(
        'aomap_fragment',
        'texture2D( aoMap, vAoMapUv )',
        'srfTex( aoMap, vAoMapUv )',
      );
      if (ao) fs = fs.replace('#include <aomap_fragment>', ao);
      const nm =
        resolved(
          'normal_fragment_maps',
          'texture2D( normalMap, vNormalMapUv )',
          'srfTex( normalMap, vNormalMapUv )',
        ) || C.normal_fragment_maps;
      fs = fs.replace('#include <normal_fragment_maps>', nm + TILT_APPLY);
      const wet = wetChunk();
      if (wet) fs = fs.replace('#include <lights_physical_fragment>', wet);
    } else if (kind === 'paint') {
      fs = fs.replace(
        '#include <roughnessmap_fragment>',
        '#include <roughnessmap_fragment>' + PAINT_MAIN,
      );
    } else {
      fs = fs.replace(
        '#include <roughnessmap_fragment>',
        '#include <roughnessmap_fragment>' + WALK_MAIN,
      );
      // (ground nov19b, user: "grainy") the sidewalk / paver scans are 2048 px per 2.4-3 m (~1.5 mm a texel) with a salt-and-pepper
      // aggregate: sampled at the stock mip it crawled under the TAA jitter at 3-15 m. Half a mip softer costs nothing visible
      // at the feet (a pixel there is already ~1 mm) and calms the speckle; the normal map gets the same bias (no sun sparkle).
      const walkMap = resolved(
        'map_fragment',
        'texture2D( map, vMapUv )',
        'texture2D( map, vMapUv, 0.6 )',
      );
      if (walkMap) fs = fs.replace('#include <map_fragment>', walkMap);
      const walkNrm = resolved(
        'normal_fragment_maps',
        'texture2D( normalMap, vNormalMapUv )',
        'texture2D( normalMap, vNormalMapUv, 0.6 )',
      );
      fs = fs.replace(
        '#include <normal_fragment_maps>',
        (walkNrm || '#include <normal_fragment_maps>') + TILT_APPLY,
      );
    }
    sh.fragmentShader = fs;
  };
  mat.customProgramCacheKey = () =>
    prevKey() + '|srf-' + kind + (lane ? 'L' : '') + (slab ? 'S' : '');
  mat.needsUpdate = true;
  return mat;
}

// a copy of an already-patched material (same maps, same shader chain) for meshes that carry the road channel
export function laneCopy(mat) {
  const m = mat.clone();
  m.onBeforeCompile = mat.onBeforeCompile;
  const k = mat.customProgramCacheKey ? mat.customProgramCacheKey.bind(mat) : () => '';
  m.customProgramCacheKey = () => k();
  m.userData = { ...mat.userData };
  return m;
}

// materials.js hook: called once after every other road / ground patch
export function patchCitySurfaces(M) {
  if (SURF_OFF || !M) return;
  if (M.junction) patchSurface(M.junction, 'asphalt');
  if (M.roadDecals)
    patchSurface(M.roadDecals, 'asphalt', {
      lane: true,
      conc: M.parking && M.parking !== M.asphalt ? M.parking.map : null,
    }); // decals carry the road channel too: same age / tone as the asphalt under them
  if (M.asphalt) {
    M.roadLane = patchSurface(laneCopy(M.asphalt), 'asphalt', {
      lane: true,
      conc: M.parking && M.parking !== M.asphalt ? M.parking.map : null,
    });
    M.roadLane.name = 'roadLane';
    patchSurface(M.asphalt, 'asphalt');
  }
  if (M.lines) patchSurface(M.lines, 'paint', { lane: true });
  if (M.sidewalk) patchSurface(M.sidewalk, 'walk', { slab: !!M.sidewalk.userData.job4 });
  for (const m of [M.panels, M.promenade]) if (m && m !== M.sidewalk) patchSurface(m, 'walk');
}
