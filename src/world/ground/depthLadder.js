// Ground depth ladder (W4, Nov 19 playtest: "the road layers are the same height, so depending on the angle they glitch over
// each other"). ONE rule for every flat layer that can lie on top of another one: a layer drawn over another one is
//   (1) at least as high in y (the build's y stack below), and
//   (2) pulled further toward the camera by polygonOffset, by at least 2 depth steps per rung (units) and 0.25 x the depth
//       slope per rung (factor, for grazing angles and relief tiles whose layers are not exactly coplanar).
// The old stack had ties (parking = sidewalk = wood = promenade = panels = -4; covers / collars / lamp pools / grates at
// -2 under the -4/-6 surfaces they sit on) and inversions (asphalt at y 0.05 pulled harder than paved areas, so at range a
// 2 cm gap and a 2-step offset fought). A depth step is constant in window depth, so the offset grows with distance (d^2 / near)
// exactly the way 24-bit depth precision falls off; the y stack handles the near field, the offset the far field.
// y stack (m over the graded ground): land 0, sand 0.01, grass 0.02, paved / parking / wood 0.03, asphalt 0.05,
// junction 0.055, shoulder 0.058, decals 0.062, markings 0.065, lines 0.066, sidewalk slabs CURB 0.15.
// ?ladder=0 = the old offsets, ?ladder=w4 = the W4 factors (before ground nov19b).
export const LADDER_ON = !(
  typeof location !== 'undefined' && /[?&]ladder=0\b/.test(location.search)
);
// rung: [units, factor]
// (ground nov19b, user: "jiggly, overlapping, quickly glitching layers") the factors were compacted. Two problems with the old
// spread (-0.75 per land rung down to -3.25 for paint):
//   - inversions with the curb: the poured curb's gutter pan lies 8-10 mm OVER the asphalt / junction but is drawn with the
//     sidewalk batch, which the old ladder pulled LESS (-1.75 vs -2.25 / -2.5). A 0.5 slope-step difference beats an 8 mm gap
//     beyond ~15 m (0.5 px of depth slope ~ 0.55 mm per m of distance), so the gutter strip flickered with the road under jitter.
//     The sidewalk rung now matches the junction rung (the real height gap decides, at any distance).
//   - the slope term also pulls the ground in front of whatever stands on it: at grazing angles 1 factor step is ~1 px of
//     depth, so tires, feet, poles and curb feet sank 2-3 px into the road at 30-80 m and that edge crawled under the TAA jitter.
//     Land covers keep their W4 factors (-0.75 .. -1.375), roads and slabs share -1.5 .. -1.625 (still well clear of the terrain
//     under them) and only thin paint / decals sit above that. Order of the flat road layers is kept by the real y gaps (5-20 mm: 100+ depth steps at 100 m) and the units.
export const LADDER = {
  land: [-1, -0.5], // unchanged (dressing.v2.js looks the land material up by these exact values)
  sand: [-2, -0.75],
  grass: [-3, -1],
  parking: [-4, -1.25],
  wood: [-5, -1.375],
  sidewalk: [-7, -1.625],
  promenade: [-7, -1.625],
  panels: [-7, -1.625],
  paving2: [-8, -1.75], // a dressing pavement laid over the sidewalk slab (brickellRow), under the grates / pools below
  overSidewalk: [-9, -1.875], // tree grates, mulch collars, lamp light pools, flush covers on a sidewalk
  dirtRoad: [-9, -1.5],
  asphalt: [-11, -1.5],
  junction: [-13, -1.625],
  shoulder: [-15, -1.625],
  decal: [-17, -2],
  cover: [-17, -2],
  markings: [-19, -2.125],
  lines: [-19, -2.125],
};
// the W4 factors, for A/B shots (?ladder=w4)
const LADDER_W4_FACTOR = {
  sand: -0.75,
  grass: -1,
  parking: -1.25,
  wood: -1.5,
  sidewalk: -1.75,
  promenade: -1.75,
  panels: -1.75,
  paving2: -1.875,
  overSidewalk: -2,
  dirtRoad: -2,
  asphalt: -2.25,
  junction: -2.5,
  shoulder: -2.75,
  decal: -3,
  cover: -3,
  markings: -3.25,
  lines: -3.25,
};
const LADDER_W4 = typeof location !== 'undefined' && /[?&]ladder=w4\b/.test(location.search);
if (LADDER_W4) {
  for (const k of Object.keys(LADDER_W4_FACTOR)) LADDER[k][1] = LADDER_W4_FACTOR[k];
}
export function ladder(mat, key) {
  if (!LADDER_ON || !mat || !mat.isMaterial) return mat;
  const r = LADDER[key];
  if (!r) return mat;
  mat.polygonOffset = true;
  mat.polygonOffsetUnits = r[0];
  mat.polygonOffsetFactor = r[1];
  mat.userData.ladder = key;
  return mat;
}
