// Miami city — shared materials (one set for all tiles so merged tile meshes batch well).
import * as THREE from 'three';
import { facadeVariants, VARIANTS } from './facades.js';
import {
  officeFacade,
  decoFacade,
  glassFacade,
  bandFacade,
  shopFacade,
  trunkTexture,
  frondTexture,
  radialTexture,
  loadPBR,
  rng,
} from '../city/tex.js';
import { loadSet } from '../city/pbr.js';
import { loadPropArray, patchPropMaterial, SURF } from '../city/propmat.js';
import { loadWallArray, createFacadeMaterial } from '../city/facade.js';
import { bakeRoomAtlas } from '../city/rooms.js';
import { sharedVegMaterials, vegUniforms } from '../vegetation/materials.js';
import { LOOK_OFF } from '../env/fogChunks.js';
import { makeSandMaterial } from '../ground/sandMaterial.js';
import { FRAME_NOISE, RENDER_R2, IGN_R2_GLSL } from '../../render/frameNoise.js';
import { makeDecalMaterial } from '../ground/decalMaterial.js';
import { patchRoadEdges, patchFillEdges } from '../ground/groundEdge.js';
import { patchRecipeGround } from '../ground/groundMaterial.js';
import { patchCitySurfaces } from '../surfaces/surfaceShaders.js';
import { ladder, LADDER_ON } from '../ground/depthLadder.js';

// Downtown paving panel joints on the panel canvas (N x N panels of cs px, canvas S px; 1 px ~ 6 mm).
// A 2 px joint, a shade darker than the slab, and a 1 px light lip on one side of each cut.
function drawPanelJoints(ctx, N, cs, S) {
  ctx.fillStyle = 'rgba(96,90,82,0.5)';
  for (let k = 0; k <= N; k++) {
    ctx.fillRect(k * cs - 1, 0, 2, S);
    ctx.fillRect(0, k * cs - 1, S, 2);
  }
  ctx.fillStyle = 'rgba(255,250,240,0.12)';
  for (let k = 0; k <= N; k++) {
    ctx.fillRect(k * cs + 1, 0, 1, S);
    ctx.fillRect(0, k * cs + 1, S, 1);
  }
}

function warehouseFacade(renderer) {
  // corrugated metal with a high window band and roller doors; tile = 24m x 12m
  const S = 512,
    c = document.createElement('canvas');
  c.width = c.height = S;
  const x = c.getContext('2d');
  const e = document.createElement('canvas');
  e.width = e.height = S;
  const ex = e.getContext('2d');
  const r = rng(77);
  x.fillStyle = '#c9ccc8';
  x.fillRect(0, 0, S, S);
  for (let i = 0; i < S; i += 8) {
    x.fillStyle = i % 16 ? 'rgba(0,0,0,0.10)' : 'rgba(255,255,255,0.18)';
    x.fillRect(i, 0, 4, S);
  }
  for (let i = 0; i < 2000; i++) {
    x.fillStyle = `rgba(90,70,50,${r() * 0.08})`;
    x.fillRect(r() * S, r() * S, 2 + r() * 6, 2 + r() * 12);
  }
  ex.fillStyle = '#000';
  ex.fillRect(0, 0, S, S);
  for (let k = 0; k < 6; k++) {
    const X = 10 + k * 84;
    x.fillStyle = '#2b3a44';
    x.fillRect(X, 60, 64, 40);
    if (r() < 0.4) {
      ex.fillStyle = '#ffe6b0';
      ex.fillRect(X + 2, 62, 60, 36);
    }
  }
  for (let k = 0; k < 2; k++) {
    const X = 60 + k * 256;
    x.fillStyle = '#8f9496';
    x.fillRect(X, 300, 140, 212);
    x.fillStyle = 'rgba(0,0,0,0.18)';
    for (let j = 300; j < 512; j += 10) x.fillRect(X, j, 140, 3);
  }
  x.fillStyle = '#e8b400';
  x.fillRect(0, 488, S, 24);
  const mk = (cv, srgb) => {
    const t = new THREE.CanvasTexture(cv);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  };
  return { map: mk(c, true), emissive: mk(e, true), rm: null, tileW: 24, tileH: 12 };
}

// job 4: road surface sets repacked from the user's road models (public/assets/textures/roads/<name>_{col,nrm,arm}.jpg)
const roadSetCache = new Map();
function loadRoadSet(renderer, name) {
  let p = roadSetCache.get(name);
  if (p) return p;
  const tex = async (k, srgb) => {
    const r = await fetch(
      `${import.meta.env?.BASE_URL ?? '/'}assets/textures/roads/${name}_${k}.jpg`,
    );
    if (!r.ok) throw new Error('road texture ' + name + ' ' + r.status);
    const t = new THREE.Texture(
      await createImageBitmap(await r.blob(), { colorSpaceConversion: 'none' }),
    );
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.flipY = false;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = Math.min(16, renderer.capabilities.getMaxAnisotropy());
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.needsUpdate = true;
    return t;
  };
  p = Promise.all([tex('col', true), tex('nrm', false), tex('arm', false)]).then(
    ([map, normalMap, arm]) => ({ name, map, normalMap, arm }),
  );
  roadSetCache.set(name, p);
  return p;
}

export async function createMaterials(renderer) {
  const [asph, conc, tiles, sand, grass, wood, plaster] = await Promise.all([
    loadPBR(renderer, 'asphalt_02'),
    loadPBR(renderer, 'concrete_floor_worn_001'),
    loadPBR(renderer, 'concrete_tiles_02'),
    loadPBR(renderer, 'coast_sand_01'),
    loadPBR(renderer, 'aerial_grass_rock'),
    loadPBR(renderer, 'brown_planks_03'),
    loadPBR(renderer, 'white_plaster_02'),
  ]);
  const pbr = (set, o = {}) =>
    new THREE.MeshStandardMaterial({
      map: set.map,
      normalMap: set.normalMap,
      roughnessMap: set.roughnessMap,
      roughness: 1,
      metalness: 0,
      ...o,
    });
  const F = {
    office: officeFacade(renderer, 5),
    deco: decoFacade(renderer, 7),
    glass: glassFacade(renderer, 9, { variance: 0.3 }),
    band: bandFacade(renderer, 31),
    shop: shopFacade(renderer, 21),
    warehouse: warehouseFacade(renderer),
  };
  const facade = (f, o = {}) =>
    new THREE.MeshStandardMaterial({
      map: f.map,
      emissiveMap: f.emissive,
      emissive: 0xffffff,
      emissiveIntensity: 0.05,
      roughnessMap: f.rm || null,
      metalnessMap: f.rm || null,
      roughness: f.rm ? 1 : 0.7,
      metalness: f.rm ? 1 : 0.2,
      vertexColors: true,
      ...o,
    });
  const M = {
    asphalt: pbr(asph, { color: 0x9e9e9c, vertexColors: true }), // ground-continuity R2: mid-grey worn asphalt
    sidewalk: pbr(tiles, { vertexColors: true }),
    roof: pbr(conc, { vertexColors: true }),
    sand: pbr(sand, { color: 0xfff0d8, vertexColors: true }),
    grass: pbr(grass, { color: 0xb8d890, vertexColors: true }),
    land: pbr(conc, { vertexColors: true }),
    wood: pbr(wood, { color: 0xd8b898, vertexColors: true }),
    office: facade(F.office),
    deco: facade(F.deco),
    glass: facade(F.glass, { envMapIntensity: 1.6 }),
    band: facade(F.band),
    shop: facade(F.shop),
    warehouse: facade(F.warehouse),
    trim: new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.6,
      metalness: 0.05,
      normalMap: plaster.normalMap,
      normalScale: new THREE.Vector2(0.4, 0.4),
    }),
    metal: new THREE.MeshStandardMaterial({ color: 0x3b4046, roughness: 0.45, metalness: 0.8 }),
    markings: new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.75,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    }),
    neon: (() => {
      // r2-art: unlit by day the tube is pale gray glass (its vertex color is the gas color, which only shows lit); uNeonDay 1 = day
      const m = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
      m.userData.uNeonDay = { value: 1 };
      m.onBeforeCompile = (sh) => {
        sh.uniforms.uNeonDay = m.userData.uNeonDay;
        sh.fragmentShader =
          'uniform float uNeonDay;\n' +
          sh.fragmentShader.replace(
            '#include <color_fragment>',
            '#include <color_fragment>\n  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.55, 0.56, 0.57) * dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11)) + vec3(0.06), uNeonDay);',
          );
      };
      m.customProgramCacheKey = () => 'neon-day';
      return m;
    })(),
    far: new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.8,
      metalness: 0.1,
      emissive: 0xffd9a0,
      emissiveIntensity: 0,
    }),
    // colour 0x232323 (not 0x222222) opts the pooled heads out of env/lamps.js signature scanning; tiles publish userData.psLamps instead
    lampHead: new THREE.MeshStandardMaterial({
      color: 0x232323,
      emissive: 0xffd7a0,
      emissiveIntensity: 0,
      roughness: 0.4,
    }),
    pool: new THREE.MeshBasicMaterial({
      map: radialTexture(renderer),
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      color: 0xffc890,
    }),
    beacon: new THREE.MeshBasicMaterial({ color: 0xff2020, toneMapped: false }),
    bulb: new THREE.MeshBasicMaterial({ color: 0xffd9a0, toneMapped: false }),
  };
  // facade / atlas textures: full mip chains + max anisotropy (no moire on window grids at grazing angles)
  const maxAniso = renderer.capabilities.getMaxAnisotropy();
  for (const f of Object.values(F))
    for (const tx of [f.map, f.emissive, f.rm])
      if (tx) {
        tx.anisotropy = maxAniso;
        tx.generateMipmaps = true;
        tx.minFilter = THREE.LinearMipmapLinearFilter;
        tx.needsUpdate = true;
      }
  M.far.emissiveMap = F.office.emissive;
  M.far.map = F.office.map;
  // distant glass towers: same curtain-wall look as near glass (reflective, tinted, lit at night) on the mid/far chunk meshes
  M.farGlass = new THREE.MeshStandardMaterial({
    map: F.glass.map,
    emissiveMap: F.glass.emissive,
    emissive: 0xfff0d8,
    emissiveIntensity: 0,
    roughnessMap: F.glass.rm,
    metalnessMap: F.glass.rm,
    roughness: 1,
    metalness: 1,
    vertexColors: true,
    envMapIntensity: 1.6,
  }); // mid/far facades show window grids by day too (vertex colour tints) // mid/far LOD: windows glow at night; ground/roofs use uv (0,0) = black texel
  M.sand.color.setRGB(1.55, 1.42, 1.22);
  M.sidewalk.color.setScalar(2.4);
  M.roof.color.setScalar(2.4);
  M.land.color.setScalar(1.6);
  // ground-continuity: beaches and sand areas use the fine sand material (three-scale stochastic sampling, grain, ripples,
  // shells and debris, moisture bands toward the waterline once beach.v2.js has built the shore field); was one tiled photo
  if (!(typeof location !== 'undefined' && /[?&]groundfix=0/.test(location.search))) {
    const base = (import.meta.env && import.meta.env.BASE_URL) || '/';
    M.sandPhoto = M.sand;
    M.sand = makeSandMaterial(THREE, {
      base,
      vertexColors: true,
      tint: /[?&]ground2=0\b/.test(location.search) ? 0xc9b591 : 0xb59775,
      tile: /[?&]ground2=0\b/.test(location.search) ? 1.3 : 2.6, // ground pass: same sand and tone as the terrain's beaches
      shells: 0.5,
      litter: 0.15,
      damp: 0.25,
      ripples: 0.7,
      marks: 0.25,
      anisotropy: 8,
    });
  }
  for (const [m, b] of [
    [M.office, 2.0],
    [M.deco, 1.6],
    [M.band, 1.6],
    [M.shop, 1.2],
  ]) {
    m.bumpMap = m.map;
    m.bumpScale = b;
  }

  // lit windows: warm tint + per-window on/off switching over time (a few flicker)
  const winU = { uWinTime: { value: 0 }, uWinDensity: { value: 0.8 } };
  const winPatch = (mat, cells, warm) => {
    mat.emissive.set(warm);
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uWinTime = winU.uWinTime;
      sh.uniforms.uWinDensity = winU.uWinDensity;
      sh.uniforms.uWinCells = { value: new THREE.Vector2(cells[0], cells[1]) };
      sh.fragmentShader =
        'uniform float uWinTime;\nuniform float uWinDensity;\nuniform vec2 uWinCells;\n' +
        sh.fragmentShader.replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
        #ifdef USE_EMISSIVEMAP
          vec2 wCell = floor(vEmissiveMapUv * uWinCells);
          float wH = fract(sin(dot(wCell, vec2(127.1, 311.7))) * 43758.5453);
          float wSlot = floor((uWinTime + wH * 100.0) / (25.0 + wH * 70.0));
          float wS = fract(sin(dot(wCell + wSlot * 1.37, vec2(269.5, 183.3))) * 43758.5453);
          float wOn = step(wS, uWinDensity);
          float wFl = 0.55 + 0.45 * step(0.5, fract(sin(floor(uWinTime * 9.0) + wH * 91.0) * 43758.5));
          totalEmissiveRadiance *= mix(wOn, wFl, step(0.993, wH));
        #endif`,
        );
    };
  };
  {
    const FV = facadeVariants(renderer);
    for (const [n, f] of Object.entries(FV)) {
      F[n] = f;
      M[n] = facade(f, n === 'curtain' ? { envMapIntensity: 1.5 } : {});
      M[n].bumpMap = f.map;
      M[n].bumpScale = n === 'curtain' ? 0.6 : 1.4;
      winPatch(M[n], f.cells, n === 'curtain' ? 0xfff0d8 : 0xffdcb0);
    }
  }
  winPatch(M.office, [8, 8], 0xffdca8);
  winPatch(M.deco, [4, 4], 0xffd8a0);
  winPatch(M.band, [16, 8], 0xffe2b8);
  winPatch(M.glass, [16, 16], 0xfff0d8);
  winPatch(M.warehouse, [6, 1], 0xffe6b0);

  // palms: wind sway in the vertex shader (per-instance phase from the instance position, global gust)
  const windU = { uWindTime: { value: 0 }, uGust: { value: 0.4 } };
  M.timeU = windU.uWindTime; // shared clock uniform (boats bob, palms sway)
  const windPatch = (frond) => (sh) => {
    sh.uniforms.uWindTime = windU.uWindTime;
    sh.uniforms.uGust = windU.uGust;
    sh.vertexShader =
      'uniform float uWindTime;\nuniform float uGust;\n' +
      sh.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
      #ifdef USE_INSTANCING
        vec2 ipw = vec2(instanceMatrix[3][0], instanceMatrix[3][2]);
      #else
        vec2 ipw = vec2(0.0);
      #endif
      float ph = fract(sin(dot(ipw, vec2(12.9898, 78.233))) * 43758.5453) * 6.2831;
      float amp = 0.55 + 0.9 * fract(ph * 7.13);
      float hN = clamp(transformed.y / 11.0, 0.0, 1.6); float bend = hN * hN;
      float sway = (sin(uWindTime * 1.3 + ph) * 0.6 + sin(uWindTime * 2.7 + ph * 1.7) * 0.25) * (0.3 + uGust) * amp;
      transformed.x += bend * sway * 0.45;
      transformed.z += bend * (sway * 0.2 + cos(uWindTime * 1.1 + ph) * 0.1 * amp);
      ${frond ? 'transformed.y += sin(uWindTime * 4.5 + ph + transformed.x * 1.3 + transformed.z) * 0.12 * uv.y * (0.4 + uGust) * amp;' : ''}`,
      );
  };
  const frondMap = frondTexture(renderer);
  M.trunk = new THREE.MeshStandardMaterial({
    map: trunkTexture(renderer),
    roughness: 0.9,
    side: THREE.DoubleSide,
  });
  M.royalTrunk = new THREE.MeshStandardMaterial({
    map: M.trunk.map,
    color: 0xc8c4bc,
    roughness: 0.8,
    side: THREE.DoubleSide,
  });
  M.frond = new THREE.MeshStandardMaterial({
    map: frondMap,
    alphaTest: 0.45,
    side: THREE.DoubleSide,
    roughness: 0.75,
    color: 0xb8d498,
  });
  M.shaft = new THREE.MeshStandardMaterial({ color: 0x5f8f3a, roughness: 0.6 });
  for (const m of [M.trunk, M.royalTrunk, M.shaft]) m.onBeforeCompile = windPatch(false);
  M.frond.onBeforeCompile = windPatch(true);
  M.frondDepth = new THREE.MeshDepthMaterial({
    depthPacking: THREE.RGBADepthPacking,
    map: frondMap,
    alphaTest: 0.45,
    side: THREE.DoubleSide,
  });
  M.frondDepth.onBeforeCompile = windPatch(true);
  M.trunkDepth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  M.trunkDepth.onBeforeCompile = windPatch(false);
  {
    // vegetation track: palms and street shrubs use the shared vegetation materials (bark atlas + normal/roughness, translucent leaves, per-instance variation)
    const VM = sharedVegMaterials();
    M.trunk = VM.bark;
    M.royalTrunk = VM.bark;
    M.trunkDepth = VM.barkDepth;
    M.frond = VM.leaf;
    M.frondDepth = VM.leafDepth;
    M.vegBark = VM.bark;
    M.vegBarkDepth = VM.barkDepth;
    M.vegLeaf = VM.leaf;
    M.vegLeafDepth = VM.leafDepth;
  }

  {
    // graffiti atlas: original procedural tags (4x2 cells)
    const c = document.createElement('canvas');
    c.width = 1024;
    c.height = 512;
    const x = c.getContext('2d');
    const gr = rng(4242);
    ['ZEPH', 'K-ROW', 'SOLO', 'MANGO', 'VYBE', 'NOVA', 'RAZ', 'OKE'].forEach((t2, i) => {
      const X = (i % 4) * 256 + 128,
        Y = Math.floor(i / 4) * 256 + 128,
        c1 = `hsl(${(gr() * 360) | 0},90%,60%)`,
        c2 = `hsl(${(gr() * 360) | 0},90%,55%)`;
      x.save();
      x.translate(X, Y);
      x.rotate((gr() - 0.5) * 0.35);
      x.font = `bold ${t2.length > 4 ? 58 : 72}px "Arial Black", Impact, sans-serif`;
      x.textAlign = 'center';
      x.textBaseline = 'middle';
      x.lineJoin = 'round';
      x.lineWidth = 16;
      x.strokeStyle = '#111';
      x.strokeText(t2, 0, 0);
      const g = x.createLinearGradient(0, -36, 0, 36);
      g.addColorStop(0, c1);
      g.addColorStop(1, c2);
      x.fillStyle = g;
      x.fillText(t2, 0, 0);
      x.lineWidth = 3;
      x.strokeStyle = '#fff';
      x.strokeText(t2, -2, -2);
      x.fillStyle = c2;
      for (let k = 0; k < 5; k++) x.fillRect(-90 + gr() * 180, 26, 3, 10 + gr() * 34);
      x.restore();
    });
    const tx = new THREE.CanvasTexture(c);
    tx.colorSpace = THREE.SRGBColorSpace;
    M.graffiti = new THREE.MeshStandardMaterial({
      map: tx,
      transparent: true,
      alphaTest: 0.05,
      roughness: 0.9,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
  }
  // ground stack depth separation (pairs with the fixed y stack in tilebuild): more negative = drawn over
  M.junction = M.asphalt.clone();
  M.parking = M.asphalt.clone();
  const zOff = (mat, u) => {
    mat.polygonOffset = true;
    mat.polygonOffsetFactor = Math.max(-2, u / 2);
    mat.polygonOffsetUnits = u;
  };
  {
    // ground variety: promenade terrazzo (beach/nightlife), concrete panels (downtown/business); world-UV tiles: 8 m and 6 m
    const mk = (c, rep = true) => {
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      if (rep) t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = maxAniso;
      return t;
    };
    const S = 1024,
      c = document.createElement('canvas');
    c.width = c.height = S;
    const x = c.getContext('2d'),
      r = rng(808);
    x.fillStyle = '#e6ddd0';
    x.fillRect(0, 0, S, S);
    for (let i = 0; i < 4; i++)
      for (let j = 0; j < 4; j++) {
        x.fillStyle = (i + j) % 2 ? 'rgba(255,250,240,0.35)' : 'rgba(205,190,170,0.25)';
        x.fillRect(i * 256, j * 256, 256, 256);
      }
    const chips = [
      '#b9a58e',
      '#8d8478',
      '#f4efe6',
      '#d9a08a',
      '#7fb6b0',
      '#c9c1b4',
      '#a3593f',
      '#5f6f73',
    ];
    for (let i = 0; i < 26000; i++) {
      x.fillStyle = chips[(r() * chips.length) | 0];
      const w = 1 + r() * 4;
      x.globalAlpha = 0.35 + r() * 0.5;
      x.fillRect(r() * S, r() * S, w, w * (0.5 + r()));
    }
    x.globalAlpha = 1;
    const band = (pos, col, w, horiz) => {
      x.fillStyle = col;
      if (horiz) x.fillRect(0, pos - w / 2, S, w);
      else x.fillRect(pos - w / 2, 0, w, S);
    };
    for (let k = 0; k <= 4; k++) {
      const P = (k * 256) % S,
        col = k % 2 ? '#2a9d8f' : '#e07a5f';
      band(P, col, 10, true);
      band(P, col, 10, false);
      band(P, '#f7f3ea', 3, true);
      band(P, '#f7f3ea', 3, false);
    }
    x.save();
    x.translate(512, 512);
    x.rotate(Math.PI / 4);
    x.strokeStyle = '#e07a5f';
    x.lineWidth = 9;
    x.strokeRect(-110, -110, 220, 220);
    x.fillStyle = 'rgba(42,157,143,0.55)';
    x.fillRect(-60, -60, 120, 120);
    x.restore();
    x.fillStyle = '#e07a5f';
    x.beginPath();
    x.arc(0, 0, 40, 0, 7);
    x.arc(S, 0, 40, 0, 7);
    x.arc(0, S, 40, 0, 7);
    x.arc(S, S, 40, 0, 7);
    x.fill();
    for (let i = 0; i < 14; i++) {
      const g = x.createRadialGradient(0, 0, 0, 0, 0, 1);
      x.save();
      x.translate(r() * S, r() * S);
      x.scale(20 + r() * 70, 14 + r() * 40);
      g.addColorStop(0, 'rgba(90,75,60,0.16)');
      g.addColorStop(1, 'rgba(90,75,60,0)');
      x.fillStyle = g;
      x.beginPath();
      x.arc(0, 0, 1, 0, 7);
      x.fill();
      x.restore();
    }
    M.promenade = new THREE.MeshStandardMaterial({
      map: mk(c),
      roughness: 0.55,
      metalness: 0,
      vertexColors: true,
      normalMap: tiles.normalMap,
      normalScale: new THREE.Vector2(0.15, 0.15),
    });
    const c2 = document.createElement('canvas');
    c2.width = c2.height = S;
    const y = c2.getContext('2d'),
      r2 = rng(909),
      N = 4,
      cs = S / N;
    for (let i = 0; i < N; i++)
      for (let j = 0; j < N; j++) {
        const v = 196 + ((r2() * 26) | 0);
        y.fillStyle = `rgb(${v},${v - 3},${v - 8})`;
        y.fillRect(i * cs, j * cs, cs, cs);
        for (let k = 0; k < 900; k++) {
          const q = (r2() * 40) | 0;
          y.fillStyle = `rgba(${q + 80},${q + 78},${q + 72},${0.05 + r2() * 0.1})`;
          y.fillRect(i * cs + r2() * cs, j * cs + r2() * cs, 2, 2);
        }
        y.strokeStyle = 'rgba(0,0,0,0.05)';
        y.lineWidth = 1;
        for (let k = 0; k < cs; k += 3) {
          y.beginPath();
          y.moveTo(i * cs + k, j * cs);
          y.lineTo(i * cs + k, j * cs + cs);
          y.stroke();
        } // broom finish
        if (r2() < 0.18) {
          y.strokeStyle = 'rgba(60,55,50,0.35)';
          y.lineWidth = 1.5;
          y.beginPath();
          let px = i * cs + r2() * cs,
            py = j * cs;
          y.moveTo(px, py);
          for (let k = 0; k < 8; k++) {
            px += (r2() - 0.5) * 30;
            py += cs / 8;
            y.lineTo(px, py);
          }
          y.stroke();
        } // crack
      }
    // ground pass (Nov 19): saw-cut joints. They were 6 px of near-black at 85 % (3.5 cm on the ground, a
    // thick dark grid from any distance); a real joint is ~1 cm and only a shade darker than the slab,
    // with a faint lit lip on one side.
    drawPanelJoints(y, N, cs, S);
    for (let i = 0; i < 10; i++) {
      const g = y.createRadialGradient(0, 0, 0, 0, 0, 1);
      y.save();
      y.translate(r2() * S, r2() * S);
      y.scale(25 + r2() * 90, 18 + r2() * 50);
      y.rotate(r2() * 3);
      const wet = r2() < 0.4;
      g.addColorStop(0, wet ? 'rgba(40,45,50,0.38)' : 'rgba(70,60,45,0.2)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      y.fillStyle = g;
      y.beginPath();
      y.arc(0, 0, 1, 0, 7);
      y.fill();
      y.restore();
    } // stains / damp patches
    const rc = document.createElement('canvas');
    rc.width = rc.height = 256;
    const rx = rc.getContext('2d');
    rx.drawImage(c2, 0, 0, 256, 256);
    const id = rx.getImageData(0, 0, 256, 256);
    for (let i = 0; i < id.data.length; i += 4) {
      const l = id.data[i];
      const rough = l < 120 ? 120 : 235;
      id.data[i] = id.data[i + 2] = 0;
      id.data[i + 1] = rough;
    }
    rx.putImageData(id, 0, 0); // damp = glossier
    const rTex = new THREE.CanvasTexture(rc);
    rTex.wrapS = rTex.wrapT = THREE.RepeatWrapping;
    M.panels = new THREE.MeshStandardMaterial({
      map: mk(c2),
      roughnessMap: rTex,
      roughness: 1,
      metalness: 0,
      vertexColors: true,
      normalMap: conc.normalMap,
      normalScale: new THREE.Vector2(0.3, 0.3),
    });
    M.panels.color.setScalar(1.15);
  }
  {
    // leaf-card foliage atlas: left half leaves, right half leaves + small bougainvillea/hibiscus flower clusters
    const W = 1024,
      H = 512,
      c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const x = c.getContext('2d'),
      r = rng(515);
    const leaf = (cx, cy, len, ang, col) => {
      x.save();
      x.translate(cx, cy);
      x.rotate(ang);
      x.fillStyle = col;
      x.beginPath();
      x.moveTo(0, 0);
      x.quadraticCurveTo(len * 0.5, -len * 0.32, len, 0);
      x.quadraticCurveTo(len * 0.5, len * 0.32, 0, 0);
      x.fill();
      x.strokeStyle = 'rgba(20,40,10,0.35)';
      x.lineWidth = 1;
      x.beginPath();
      x.moveTo(0, 0);
      x.lineTo(len * 0.9, 0);
      x.stroke();
      x.restore();
    };
    for (const ox of [0, 512]) {
      for (let i = 0; i < 520; i++) {
        const a = r() * Math.PI * 2,
          d = Math.sqrt(r()) * 0.92,
          cx = ox + 256 + Math.cos(a) * d * 240,
          cy = 280 + Math.sin(a) * d * 220 * (Math.sin(a) < 0 ? 1 : 0.9);
        const l = 40 + r() * 26 + (1 - d) * 18,
          t = 0.35 + 0.65 * (1 - d) * r();
        leaf(
          cx,
          cy,
          l,
          r() * 6.28,
          `hsl(${95 + r() * 30},${45 + r() * 25}%,${16 + t * 26 + (cy < 200 ? 8 : 0)}%)`,
        );
      }
      // a few twigs at the base so the card bottoms are not hard-edged
      x.strokeStyle = '#4a3a28';
      x.lineWidth = 4;
      for (let k = 0; k < 7; k++) {
        x.beginPath();
        x.moveTo(ox + 230 + k * 8, 512);
        x.lineTo(ox + 200 + r() * 112, 420 - r() * 80);
        x.stroke();
      }
    }
    for (let i = 0; i < 230; i++) {
      // flower clusters (3–7 florets, papery bracts)
      const a = r() * 6.28,
        d = Math.pow(r(), 0.6) * 0.85,
        cx = 512 + 256 + Math.cos(a) * d * 230,
        cy = 270 + Math.sin(a) * d * 200;
      const hue = r() < 0.7 ? 318 + r() * 20 : r() < 0.6 ? 8 + r() * 14 : 40;
      const n = 3 + ((r() * 5) | 0);
      for (let k = 0; k < n; k++) {
        const fx = cx + (r() - 0.5) * 22,
          fy = cy + (r() - 0.5) * 18,
          rr = 5 + r() * 4;
        x.fillStyle = `hsl(${hue},${75 + r() * 20}%,${48 + r() * 18}%)`;
        for (let pp = 0; pp < 3; pp++) {
          x.beginPath();
          x.ellipse(
            fx + Math.cos(pp * 2.1) * rr * 0.6,
            fy + Math.sin(pp * 2.1) * rr * 0.6,
            rr,
            rr * 0.7,
            pp * 2.1,
            0,
            7,
          );
          x.fill();
        }
        x.fillStyle = '#f6efd0';
        x.fillRect(fx - 1, fy - 1, 2, 2);
      }
    }
    const tx = new THREE.CanvasTexture(c);
    tx.colorSpace = THREE.SRGBColorSpace;
    tx.anisotropy = maxAniso;
    M.leaf = new THREE.MeshStandardMaterial({
      map: tx,
      alphaTest: 0.5,
      side: THREE.DoubleSide,
      roughness: 0.8,
      metalness: 0,
    });
    M.leafDepth = new THREE.MeshDepthMaterial({
      depthPacking: THREE.RGBADepthPacking,
      map: tx,
      alphaTest: 0.5,
      side: THREE.DoubleSide,
    });
    // gentle rustle (shares the palm wind clock)
    const rustle = (sh) => {
      sh.uniforms.uWindTime = windU.uWindTime;
      sh.uniforms.uGust = windU.uGust;
      sh.vertexShader =
        'uniform float uWindTime;\nuniform float uGust;\n' +
        sh.vertexShader.replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
      #ifdef USE_INSTANCING
        float lph = instanceMatrix[3][0] * 0.37 + instanceMatrix[3][2] * 0.61;
      #else
        float lph = 0.0;
      #endif
      float lw = clamp(transformed.y, 0.0, 1.4) * (0.25 + uGust) * 0.05;
      transformed.x += sin(uWindTime * 2.3 + lph + transformed.z * 2.0) * lw; transformed.z += cos(uWindTime * 1.9 + lph * 1.3 + transformed.x * 2.0) * lw;`,
        );
    };
    M.leaf.onBeforeCompile = rustle;
    M.leafDepth.onBeforeCompile = rustle;
    // sea oats: thin arching blades + drooping seed panicles
    const oc = document.createElement('canvas');
    oc.width = 512;
    oc.height = 512;
    const o = oc.getContext('2d'),
      r3 = rng(626);
    for (let i = 0; i < 60; i++) {
      const bx = 256 + (r3() - 0.5) * 200,
        lean = (r3() - 0.5) * 260,
        top = 40 + r3() * 220;
      o.strokeStyle = `hsl(${60 + r3() * 30},${30 + r3() * 25}%,${38 + r3() * 25}%)`;
      o.lineWidth = 2 + r3() * 3;
      o.beginPath();
      o.moveTo(bx, 512);
      o.quadraticCurveTo(bx + lean * 0.3, (512 + top) / 2, bx + lean, top);
      o.stroke();
    }
    for (let i = 0; i < 9; i++) {
      const bx = 200 + r3() * 112,
        top = 20 + r3() * 60,
        lean = (r3() - 0.5) * 120;
      o.strokeStyle = '#b8a070';
      o.lineWidth = 2;
      o.beginPath();
      o.moveTo(bx, 512);
      o.quadraticCurveTo(bx, 250, bx + lean, top);
      o.stroke();
      for (let k = 0; k < 9; k++) {
        o.fillStyle = `hsl(40,${40 + r3() * 20}%,${62 + r3() * 15}%)`;
        o.beginPath();
        o.ellipse(bx + lean + (r3() - 0.5) * 30 + k * lean * 0.02, top + k * 9, 4, 8, 0.3, 0, 7);
        o.fill();
      }
    }
    const otx = new THREE.CanvasTexture(oc);
    otx.colorSpace = THREE.SRGBColorSpace;
    otx.anisotropy = maxAniso;
    M.oats = new THREE.MeshStandardMaterial({
      map: otx,
      alphaTest: 0.45,
      side: THREE.DoubleSide,
      roughness: 0.9,
    });
    M.oats.onBeforeCompile = rustle;
    M.dune = new THREE.MeshStandardMaterial({
      map: sand.map,
      normalMap: sand.normalMap,
      roughness: 1,
      metalness: 0,
      color: 0xfff0d8,
    });
    M.dune.color.setRGB(1.5, 1.38, 1.18);
    if (M.sand.userData.isSand)
      M.dune = makeSandMaterial(THREE, {
        base: (import.meta.env && import.meta.env.BASE_URL) || '/',
        tint: 0xc9b591,
        tile: 1.3,
        shells: 0.3,
        litter: 0.05,
        damp: 0.1,
        ripples: 0.9,
        marks: 0.1,
      }); // ground-continuity: dunes match the beach
  }
  for (const [mat, u] of [
    [M.land, -1],
    [M.sand, -2],
    [M.grass, -3],
    [M.wood, -4],
    [M.parking, -4],
    [M.sidewalk, -4],
    [M.promenade, -4],
    [M.panels, -4],
    [M.asphalt, -6],
    [M.junction, -7],
    [M.markings, -9],
  ])
    if (mat) zOff(mat, u);
  if (LADDER_ON)
    for (const k of [
      'sand',
      'grass',
      'wood',
      'parking',
      'sidewalk',
      'promenade',
      'panels',
      'asphalt',
      'junction',
      'markings',
    ])
      ladder(M[k], k); // W4: one strict ground ladder (ground/depthLadder.js)
  {
    // world-space (triplanar) surface detail for street props: galvanized / painted metal, wood grain, concrete, corrugated steel
    const mkTex = (draw, n = 256) => {
      const c = document.createElement('canvas');
      c.width = c.height = n;
      const x = c.getContext('2d');
      draw(x, n, rng(n + draw.length));
      const t = new THREE.CanvasTexture(c);
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = 4;
      return t;
    };
    const noise = (x, n, r, k, a) => {
      for (let i = 0; i < k; i++) {
        const v = (r() * 255) | 0;
        x.fillStyle = `rgba(${v},${v},${v},${a})`;
        x.fillRect(r() * n, r() * n, 1 + r() * 3, 1 + r() * 3);
      }
    };
    const TEX = {
      metal: mkTex((x, n, r) => {
        x.fillStyle = '#808080';
        x.fillRect(0, 0, n, n);
        noise(x, n, r, 6000, 0.25);
        for (let i = 0; i < 40; i++) {
          x.fillStyle = `rgba(${r() < 0.5 ? '40,35,30' : '200,200,200'},${0.08 + r() * 0.1})`;
          x.fillRect(r() * n, r() * n, 1 + r() * 2, 20 + r() * 80);
        }
        for (let i = 0; i < 18; i++) {
          const g = x.createRadialGradient(0, 0, 0, 0, 0, 1);
          x.save();
          x.translate(r() * n, r() * n);
          x.scale(6 + r() * 14, 3 + r() * 8);
          g.addColorStop(0, 'rgba(110,70,40,0.35)');
          g.addColorStop(1, 'rgba(110,70,40,0)');
          x.fillStyle = g;
          x.beginPath();
          x.arc(0, 0, 1, 0, 7);
          x.fill();
          x.restore();
        }
      }),
      paint: mkTex((x, n, r) => {
        x.fillStyle = '#868686';
        x.fillRect(0, 0, n, n);
        noise(x, n, r, 3000, 0.12);
        for (let i = 0; i < 60; i++) {
          x.strokeStyle = `rgba(${r() < 0.6 ? '230,230,230' : '50,45,40'},${0.25 + r() * 0.3})`;
          x.lineWidth = 0.6 + r();
          x.beginPath();
          const px = r() * n,
            py = r() * n;
          x.moveTo(px, py);
          x.lineTo(px + (r() - 0.5) * 30, py + (r() - 0.5) * 12);
          x.stroke();
        }
      }),
      wood: mkTex((x, n, r) => {
        x.fillStyle = '#7d7d7d';
        x.fillRect(0, 0, n, n);
        for (let i = 0; i < 90; i++) {
          const yy = r() * n,
            v = 90 + r() * 90;
          x.strokeStyle = `rgba(${v},${v},${v},0.35)`;
          x.lineWidth = 1 + r() * 2;
          x.beginPath();
          x.moveTo(0, yy);
          for (let k = 0; k <= 8; k++) x.lineTo((k * n) / 8, yy + Math.sin(k * 0.9 + i) * 3);
          x.stroke();
        }
        for (let i = 0; i < 6; i++) {
          x.fillStyle = 'rgba(40,30,20,0.35)';
          x.beginPath();
          x.ellipse(r() * n, r() * n, 3 + r() * 4, 2 + r() * 2, 0, 0, 7);
          x.fill();
        }
      }),
      concrete: mkTex((x, n, r) => {
        x.fillStyle = '#8a8a8a';
        x.fillRect(0, 0, n, n);
        noise(x, n, r, 9000, 0.18);
        for (let i = 0; i < 8; i++) {
          const g = x.createRadialGradient(0, 0, 0, 0, 0, 1);
          x.save();
          x.translate(r() * n, r() * n);
          x.scale(20 + r() * 40, 15 + r() * 30);
          g.addColorStop(0, 'rgba(40,40,40,0.18)');
          g.addColorStop(1, 'rgba(40,40,40,0)');
          x.fillStyle = g;
          x.beginPath();
          x.arc(0, 0, 1, 0, 7);
          x.fill();
          x.restore();
        }
      }),
      ribs: mkTex((x, n, r) => {
        for (let i = 0; i < n; i++) {
          const v = 128 + Math.sin((i / n) * Math.PI * 2 * 12) * 50;
          x.fillStyle = `rgb(${v},${v},${v})`;
          x.fillRect(i, 0, 1, n);
        }
        noise(x, n, r, 2500, 0.15);
        for (let i = 0; i < 10; i++) {
          x.fillStyle = 'rgba(120,60,30,0.25)';
          x.fillRect(r() * n, r() * n, 2 + r() * 6, 10 + r() * 40);
        }
      }),
    };
    // detail(mat, kind, scale): multiplies albedo by the world-space detail texture and varies roughness with it
    // real CC0 PBR atlas (ambientCG: PaintedMetal004, Metal032, Rust004, Wood066, Concrete034, Plaster001 at 1K, 3x2 cells) - see CREDITS.md
    const tl = new THREE.TextureLoader(),
      base = (import.meta.env?.BASE_URL ?? '/') + 'assets/city/tex/';
    const ATL = {
      color: tl.load(base + 'props_color.jpg', undefined, undefined, () => {}),
      rough: tl.load(base + 'props_rough.jpg', undefined, undefined, () => {}),
      normal: tl.load(base + 'props_normal.jpg', undefined, undefined, () => {}),
    };
    ATL.color.colorSpace = THREE.SRGBColorSpace;
    for (const t of Object.values(ATL)) {
      t.anisotropy = maxAniso;
      t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    }
    const CELL = { paint: 0, metal: 1, rust: 2, wood: 3, concrete: 4, plaster: 5, ribs: 2 };
    M.detail = (mat, kind = 'metal', scale = 0.8, strength = 0.9, normalK = 1.4) => {
      const tex = TEX[kind] || TEX.metal,
        prev = mat.onBeforeCompile,
        cell = CELL[kind] ?? 1;
      mat.onBeforeCompile = (sh, r) => {
        if (prev) prev(sh, r);
        sh.uniforms.uDet = { value: tex };
        sh.uniforms.uDetS = { value: scale };
        sh.uniforms.uDetK = { value: strength };
        sh.uniforms.uAtl = { value: ATL.color };
        sh.uniforms.uAtlR = { value: ATL.rough };
        sh.uniforms.uAtlN = { value: ATL.normal };
        sh.uniforms.uDetN = { value: normalK };
        sh.uniforms.uCell = { value: new THREE.Vector2(cell % 3, Math.floor(cell / 3)) };
        sh.vertexShader =
          'varying vec3 vDetP;\nvarying vec3 vDetN;\n' +
          sh.vertexShader.replace(
            '#include <begin_vertex>',
            `#include <begin_vertex>
          vec4 dwp = vec4(transformed, 1.0); vec3 dwn = objectNormal;
          #ifdef USE_INSTANCING
            dwp = instanceMatrix * dwp; dwn = mat3(instanceMatrix) * dwn;
          #endif
          dwp = modelMatrix * dwp; vDetP = dwp.xyz; vDetN = normalize(mat3(modelMatrix) * dwn);`,
          );
        sh.fragmentShader =
          'uniform sampler2D uDet;\nuniform sampler2D uAtl;\nuniform sampler2D uAtlR;\nuniform sampler2D uAtlN;\nuniform float uDetN;\nuniform vec2 uCell;\nuniform float uDetS;\nuniform float uDetK;\nvarying vec3 vDetP;\nvarying vec3 vDetN;\nvec4 atl(sampler2D t, vec2 p) { vec2 f = fract(p) * 0.98 + 0.01; vec2 uv = (uCell + f) / vec2(3.0, 2.0); return textureGrad(t, uv, dFdx(p) / vec2(3.0, 2.0), dFdy(p) / vec2(3.0, 2.0)); }\nvec4 tri(sampler2D t, vec3 bw) { return atl(t, vDetP.zy * uDetS * 0.35) * bw.x + atl(t, vDetP.xz * uDetS * 0.35) * bw.y + atl(t, vDetP.xy * uDetS * 0.35) * bw.z; }\n' +
          sh.fragmentShader
            .replace(
              '#include <map_fragment>',
              `#include <map_fragment>
          vec3 bw = pow(abs(vDetN), vec3(4.0)); bw /= (bw.x + bw.y + bw.z + 1e-4);
          float det = texture2D(uDet, vDetP.zy * uDetS).r * bw.x + texture2D(uDet, vDetP.xz * uDetS).r * bw.y + texture2D(uDet, vDetP.xy * uDetS).r * bw.z;
          vec3 pbr = tri(uAtl, bw).rgb; float lum = dot(pbr, vec3(0.299, 0.587, 0.114)) + 1e-3;
          diffuseColor.rgb *= mix(vec3(1.0), mix(pbr / lum * 0.5 + 0.5, vec3(1.0), 0.35) * (lum * 1.6 + 0.2) * mix(1.0, det * 1.4, 0.3), uDetK);`,
            )
            .replace(
              '#include <normal_fragment_maps>',
              `#include <normal_fragment_maps>
          { // triplanar atlas normal map (whiteout blend in world space), then back to view space
            vec3 wn = normalize(vDetN); vec3 bwn = pow(abs(wn), vec3(4.0)); bwn /= (bwn.x + bwn.y + bwn.z + 1e-4); float s3 = uDetS * 0.35;
            vec3 tX = atl(uAtlN, vDetP.zy * s3).xyz * 2.0 - 1.0, tY = atl(uAtlN, vDetP.xz * s3).xyz * 2.0 - 1.0, tZ = atl(uAtlN, vDetP.xy * s3).xyz * 2.0 - 1.0;
            tX.xy *= uDetN; tY.xy *= uDetN; tZ.xy *= uDetN;
            tX = vec3(tX.xy + wn.zy, abs(tX.z) * wn.x); tY = vec3(tY.xy + wn.xz, abs(tY.z) * wn.y); tZ = vec3(tZ.xy + wn.xy, abs(tZ.z) * wn.z);
            vec3 nW = normalize(tX.zyx * bwn.x + tY.xzy * bwn.y + tZ.xyz * bwn.z);
            vec3 nV = normalize((viewMatrix * vec4(nW, 0.0)).xyz); normal = normalize(mix(normal, nV * faceDirection, uDetK));
          }`,
            )
            .replace(
              '#include <roughnessmap_fragment>',
              `#include <roughnessmap_fragment>
          roughnessFactor = clamp(mix(roughnessFactor, tri(uAtlR, bw).r * 1.1, uDetK), 0.04, 1.0);`,
            );
      };
      mat.needsUpdate = true;
      return mat;
    };
    M.detail(M.metal, 'metal', 1.2);
  }
  {
    // grass: world-space colour variation (sun-bleached / lush / dry patches) breaks up the tiling
    const prevG = M.grass.onBeforeCompile;
    M.grass.onBeforeCompile = (sh) => {
      sh.vertexShader =
        'varying vec2 vGW;\n' +
        sh.vertexShader.replace(
          '#include <worldpos_vertex>',
          '#include <worldpos_vertex>\n  vGW = (modelMatrix * vec4(transformed, 1.0)).xz;',
        );
      sh.fragmentShader =
        'varying vec2 vGW;\nfloat mgGrassN(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f); float a = fract(sin(dot(i, vec2(127.1,311.7)))*43758.5), b = fract(sin(dot(i+vec2(1,0), vec2(127.1,311.7)))*43758.5), c = fract(sin(dot(i+vec2(0,1), vec2(127.1,311.7)))*43758.5), d = fract(sin(dot(i+vec2(1,1), vec2(127.1,311.7)))*43758.5); return mix(mix(a,b,f.x), mix(c,d,f.x), f.y); }\n' +
        sh.fragmentShader.replace(
          '#include <map_fragment>',
          `#include <map_fragment>
        float gn = mgGrassN(vGW * 0.035) * 0.6 + mgGrassN(vGW * 0.13) * 0.3 + mgGrassN(vGW * 0.6) * 0.1;
        diffuseColor.rgb *= mix(vec3(0.78, 0.92, 0.62), vec3(1.12, 1.06, 0.82), smoothstep(0.25, 0.8, gn));
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.25, 1.1, 0.75), smoothstep(0.72, 0.9, mgGrassN(vGW * 0.09 + 17.0)) * 0.6);`,
        );
      if (prevG) prevG(sh);
    };
  }
  M.guardrail = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.4,
    metalness: 0.7,
  });
  // storefront glass: see the INTERIORS agent's shops from the street (reflections come from scene.environment)
  M.shopGlass = new THREE.MeshPhysicalMaterial({
    color: 0xd6eaee,
    roughness: 0.04,
    metalness: 0.0,
    transparent: true,
    opacity: 0.2,
    depthWrite: false,
    side: THREE.DoubleSide,
    envMapIntensity: 1.3,
    clearcoat: 0.6,
    clearcoatRoughness: 0.05,
  });
  M.poolWater = new THREE.MeshStandardMaterial({
    color: 0x2aa6b8,
    roughness: 0.05,
    metalness: 0.3,
    vertexColors: true,
  });
  // ---- V2 city-look: real CC0 PBR on every surface ----
  const facU = {
      uFLit: { value: new Float32Array(8) },
      uFNight: { value: 0 },
      uFDay: { value: 0.5 },
      uFTime: { value: 0 },
      uFGlow: { value: 1.0 },
      uFAwn: {
        value: typeof location !== 'undefined' && /noawningglow/.test(location.search) ? 0 : 1,
      },
    },
    propU = { uEmis: { value: 0 } };
  try {
    const [wallArr, propArr, sSide, sPark, sBark, sPlank, sConc] = await Promise.all([
      loadWallArray(renderer),
      loadPropArray(renderer),
      loadSet(renderer, 'concrete_pavement'),
      loadSet(renderer, 'asphalt_04'),
      loadSet(renderer, 'palm_bark'),
      loadSet(renderer, 'weathered_planks'),
      loadSet(renderer, 'brushed_concrete'),
    ]);
    // (ground nov19b, user: "this just looks really bad with the concrete") lots and aprons: the brushed-concrete scan carries
    // big trowel swirls in its normal and albedo, which read as a repeating fingerprint over a whole lot and sparkle at
    // grazing angles. The calm hangar-floor scan (already loaded for the airport aprons by terrain.js: the same cached
    // textures, no extra memory) is plain poured concrete; the 4.5 m joints and stains still come from groundWear.
    // ?lotconc=old = the brushed scan.
    const LOT_OLD = typeof location !== 'undefined' && /[?&]lotconc=old\b/.test(location.search);
    const sLot = LOT_OLD ? sConc : await loadSet(renderer, 'hangar_concrete_floor');
    const rooms = await bakeRoomAtlas(renderer);
    M.facade = createFacadeMaterial(wallArr, rooms, facU);
    M.facade.userData.pbr = 'facade-array';
    M.makeFacadeFar = (extra) => {
      const m = createFacadeMaterial(wallArr, rooms, facU, extra);
      m.userData.pbr = 'facade-array';
      return m;
    };
    M.roomAtlas = rooms;
    M.propArr = propArr;
    M.propU = propU;
    // ground: full sets (albedo, normal, roughness + AO from the packed ARM map)
    const rep = (t, k) => {
      if (!k || k === 1) return t;
      const c = t.clone();
      c.repeat.set(k, k);
      c.needsUpdate = true;
      return c;
    };
    const full = (mat, set, col, k = 1) => {
      mat.map = rep(set.map, k);
      mat.normalMap = rep(set.normalMap, k);
      mat.roughnessMap = rep(set.arm, k);
      mat.aoMap = mat.roughnessMap;
      mat.roughness = 1;
      if (col !== undefined) mat.color.setScalar(col);
      mat.needsUpdate = true;
    };
    full(M.sidewalk, sSide, 1.75);
    // same mean brightness as before: the hangar scan's albedo is ~4.2x darker than the brushed one
    if (LOT_OLD) full(M.parking, sConc, 1.45, 0.6);
    else {
      full(M.parking, sLot, 6.1, 0.6);
      M.parking.normalScale.set(0.6, 0.6);
    }
    full(M.panels, sSide, 1.9, 2.4);
    full(M.promenade, sSide, 1, 3.2);
    M.promenade.color.setRGB(2.1, 1.5, 1.36);
    M.promenade.normalScale.set(1, 1);
    full(M.wood, sPlank, 1.9);
    full(M.roof, sConc, 1.9, 2);
    if (M.asphalt.normalScale) M.asphalt.normalScale.multiplyScalar(0.6); // calmer grain at car height
    M.markings.normalMap = M.asphalt.normalMap;
    M.markings.roughnessMap = M.asphalt.roughnessMap;
    M.markings.roughness = 1;
    M.markings.map = sConc.map;
    M.markings.color.setScalar(2.3); // paint over the road texture, worn by the grain
    // stage 1 job 4 (road surfaces): every road surface is a photoscanned set from the user's road models (Models/Roads, repacked
    // by tools/v2/roads/build_road_textures.py into public/assets/textures/roads, see SOURCES.txt): Road 6 asphalt, Road 4 sidewalk
    // panels, Road 2 Block05 pavers (downtown), Road 11 dirt road + crumbling dusty road edge (shoulders), Road 1 RoadLines (paint)
    if (!/[?&]job4=0/.test(typeof location !== 'undefined' ? location.search : ''))
      try {
        const [sRoad, sWalk, sPave, sDirt, sEdge, sLine] = await Promise.all(
          ['asphalt', 'sidewalk', 'pavers', 'dirt', 'edge', 'lines'].map((n) =>
            loadRoadSet(renderer, n),
          ),
        );
        for (const m of [M.asphalt, M.junction]) {
          full(m, sRoad, undefined, 7 / 3.2);
          m.normalScale.set(0.7, 0.7);
          m.color.setScalar(0.56);
          m.userData.mipBias = 0.35;
        } // calm texture: no extra blur needed
        full(M.sidewalk, sWalk, 1.2, 2.5 / 3);
        M.sidewalk.normalScale.set(0.8, 0.8);
        M.sidewalk.userData.job4 = true; // world uv 2.5 m -> 3 m per scan tile (1.5 m panels)
        if (M.panels) {
          full(M.panels, sPave, 1.3, 6 / 2.4);
          M.panels.normalScale.set(0.8, 0.8);
        } // downtown pavers, 2.4 m per scan tile
        // W4 (Nov 19 playtest: "concrete slabs with dots placed broadly"): the Concrete 3 scan has a grid of form-tie holes 30 cm apart,
        // and every lot, apron and driveway used it, so it read as tactile warning pads everywhere. Lots keep the plain poured concrete set
        // (sConc, above); the yellow pads stay only at the curb ramps of real crosswalks. ?lotdots=1 = old.
        if (M.parking && typeof location !== 'undefined' && /[?&]lotdots=1\b/.test(location.search))
          try {
            const sCon = await loadRoadSet(renderer, 'concrete');
            full(M.parking, sCon, 1.25, 1.5);
            M.parking.normalScale.set(0.9, 0.9);
          } catch (e) {
            console.warn('[miami] concrete set', e);
          } // ground pass: the user's poured concrete (Concrete 3) for lots / aprons, 4 m per tile
        M.dirtRoad = new THREE.MeshStandardMaterial({
          vertexColors: true,
          roughness: 1,
          metalness: 0,
        });
        full(M.dirtRoad, sDirt, 1.1);
        zOff(M.dirtRoad, -6);
        ladder(M.dirtRoad, 'dirtRoad'); // unpaved tracks (surface 'dirt')
        // paint: strip uv (u across the line inside an atlas column, v along the line), the scan's own wear / chips / grain
        M.lines = new THREE.MeshStandardMaterial({
          map: sLine.map,
          normalMap: sLine.normalMap,
          roughnessMap: sLine.arm,
          roughness: 1,
          metalness: 0,
          vertexColors: true,
        });
        zOff(M.lines, -9);
        ladder(M.lines, 'lines');
        M.lines.name = 'roadLines';
        // shoulders: the scan's crumbling asphalt-to-dust edge; its dark pixels are cut out, so asphalt shows through the crumbs and the
        // jagged outer edge breaks up into the verge (no hard strip edge)
        M.shoulder = new THREE.MeshStandardMaterial({
          map: sEdge.map,
          normalMap: sEdge.normalMap,
          roughnessMap: sEdge.arm,
          roughness: 1,
          metalness: 0,
          vertexColors: true,
        });
        zOff(M.shoulder, -7);
        ladder(M.shoulder, 'shoulder');
        M.shoulder.onBeforeCompile = (sh) => {
          sh.fragmentShader = sh.fragmentShader.replace(
            '#include <map_fragment>',
            '#include <map_fragment>\n  { vec4 eT = texture2D( map, vMapUv ); if ( dot( eT.rgb, vec3( 0.3333 ) ) < 0.045 || vMapUv.y > 0.452 ) discard; }',
          );
        };
        M.shoulder.customProgramCacheKey = () => 'job4-shoulder';
        // road decals (cracks, potholes, patches, manholes, storm drains, oil, turn arrows): one atlas baked from the user's road-detail
        // scans (Models/Road Details, Models/Sewer Grates; tools/v2/roads/bake_decals.mjs + build_decal_atlas.py), alpha-blended over the
        // asphalt with a polygon offset (no z-fight), one merged mesh per tile
        const png = async (n, srgb) => {
          const r = await fetch(
            `${import.meta.env?.BASE_URL ?? '/'}assets/textures/roads/decals_${n}.png`,
          );
          if (!r.ok) throw new Error('decals ' + n);
          const t = new THREE.Texture(
            await createImageBitmap(await r.blob(), {
              colorSpaceConversion: 'none',
              premultiplyAlpha: 'none',
            }),
          );
          t.flipY = false;
          if (srgb) t.colorSpace = THREE.SRGBColorSpace;
          t.anisotropy = Math.min(16, renderer.capabilities.getMaxAnisotropy());
          t.generateMipmaps = true;
          t.minFilter = THREE.LinearMipmapLinearFilter;
          t.needsUpdate = true;
          return t;
        };
        const [dC, dN, dA] = await Promise.all([
          png('col', true),
          png('nrm', false),
          png('arm', false),
        ]);
        M.roadDecals = makeDecalMaterial(THREE, M.asphalt, { col: dC, nrm: dN, arm: dA });
        ladder(M.roadDecals, 'decal'); // ground pass: decals drawn from the road's own asphalt (ground/decalMaterial.js)
      } catch (e) {
        console.warn('[miami] road textures', e);
      }
    M.trunk.map = sBark.map;
    M.trunk.normalMap = sBark.normalMap;
    M.trunk.roughnessMap = sBark.arm;
    M.trunk.roughness = 1;
    M.trunk.color.setScalar(1.6);
    M.royalTrunk.map = sConc.map;
    M.royalTrunk.normalMap = sConc.normalMap;
    M.royalTrunk.roughnessMap = sConc.arm;
    M.royalTrunk.color.setScalar(1.7);
    // props: one shared triplanar PBR array (painted metal, galvanized, rust, wood, concrete ...)
    M.propify = (mat, surf, emis = 0) =>
      patchPropMaterial(mat, propArr, propU, { surf: SURF[surf] ?? 0, emis });
    M.propify(M.trim, 'plaster');
    M.propify(M.guardrail, 'galv');
    M.propify(M.lampHead, 'plastic');
    M.propify(M.shaft, 'plastic');
    M.propify(M.poolWater, 'glass');
    M.propify(M.shopGlass, 'glass');
    M.metal.userData.pbr = 'triplanar-atlas';
  } catch (e) {
    console.error('[miami] PBR library failed, falling back to v1 materials', e);
  }
  // ---------- look track: ground wear (world space, no extra textures) ----------
  // Breaks the "one flat canvas" read of large ground surfaces: macro tone patches (30 m and 9 m), fine 1 m mottling,
  // and on asphalt oil stains / sealed patches that are darker and glossier. Roughness follows the same noise.
  // amp = macro tone amplitude, stain = asphalt stain strength. ?lookoff skips it.
  const WEAR_FN = `
    varying vec3 vWWear;
    float psWH( vec2 p ) { vec3 p3 = fract( vec3( p.xyx ) * 0.1031 ); p3 += dot( p3, p3.yzx + 33.33 ); return fract( ( p3.x + p3.y ) * p3.z ); }
    float psWN( vec2 p ) {
      vec2 i = floor( p );
      vec2 f = fract( p );
      vec2 u = f * f * ( 3.0 - 2.0 * f );
      return mix( mix( psWH( i ), psWH( i + vec2( 1.0, 0.0 ) ), u.x ), mix( psWH( i + vec2( 0.0, 1.0 ) ), psWH( i + vec2( 1.0, 1.0 ) ), u.x ), u.y );
    }
  `;
  const groundWear = (
    mat,
    amp,
    stain,
    key,
    crack = 0,
    tone = 1,
    minRough = 0,
    joint = null,
    fine = 0.1,
  ) => {
    if (!mat || LOOK_OFF) return;
    const prev = mat.onBeforeCompile;
    const prevKey = mat.customProgramCacheKey ? mat.customProgramCacheKey.bind(mat) : () => '';
    mat.onBeforeCompile = (sh, r) => {
      if (prev) prev(sh, r);
      sh.vertexShader =
        'varying vec3 vWWear;\n' +
        sh.vertexShader.replace(
          '#include <project_vertex>',
          `#include <project_vertex>
        {
          vec4 wwp = vec4( transformed, 1.0 );
          #ifdef USE_INSTANCING
            wwp = instanceMatrix * wwp;
          #endif
          vWWear = ( modelMatrix * wwp ).xyz;
        }`,
        );
      // all wear code goes after roughnessmap_fragment (diffuseColor is still editable there); robust when another
      // patch (e.g. sand-wear) has already inlined map_fragment
      sh.fragmentShader =
        WEAR_FN +
        sh.fragmentShader.replace(
          '#include <roughnessmap_fragment>',
          `#include <roughnessmap_fragment>
        float wMacro = psWN( vWWear.xz * 0.033 ) * 0.62 + psWN( vWWear.xz * 0.11 + 7.3 ) * 0.38;
        float wFine = psWN( vWWear.xz * 0.95 + 3.1 );
        float wStain = smoothstep( 0.6, 0.8, psWN( vWWear.xz * 0.21 + 1.7 ) * 0.72 + wFine * 0.28 ) * ${stain.toFixed(3)};
        // hairline cracks: the zero crossings of a warped noise, only in patches; sealed with dark tar
        float wCrkN = psWN( vWWear.xz * 0.42 + psWN( vWWear.xz * 1.7 ) * 0.6 ) + 0.5 * psWN( vWWear.xz * 1.3 + 9.1 );
        float wFw = max( fwidth( wCrkN ), 1e-4 );
        float wCrk = ( 1.0 - smoothstep( 0.0, max( 0.007, wFw ), abs( wCrkN - 0.75 ) ) ) * clamp( 0.012 / wFw, 0.0, 1.0 ) * smoothstep( 0.5, 0.72, psWN( vWWear.xz * 0.05 + 4.4 ) ) * ${crack.toFixed(3)};
        wStain = max( wStain, wCrk * 0.4 );
        diffuseColor.rgb *= ( 1.0 + ${amp.toFixed(3)} * ( wMacro * 2.0 - 1.0 ) ) * ( 1.0 - ${(fine / 2).toFixed(3)} + ${fine.toFixed(3)} * wFine ) * ( 1.0 - 0.45 * wStain ) * ( 1.0 - 0.3 * wCrk ) * ${tone.toFixed(3)};
        ${
          joint
            ? `{ // joint grid: pavers / poured slabs, each unit with its own tone, joints dark and rough, fading out with distance
          vec2 jp = vWWear.xz / vec2( ${joint[0].toFixed(3)}, ${joint[1].toFixed(3)} );
          jp.x += ${joint[2] ? '0.5 * mod( floor( jp.y ), 2.0 )' : '0.0'};
          vec2 jf = abs( fract( jp ) - 0.5 );
          vec2 jw = max( fwidth( jp ), vec2( 1e-4 ) );
          float jl = 1.0 - smoothstep( 0.5 - ${joint[3].toFixed(3)} / ${joint[0].toFixed(3)} - jw.x, 0.5 - jw.x * 0.5, max( jf.x, jf.y * ${(joint[0] / joint[1]).toFixed(3)} ) );
          jl = ( 1.0 - jl ) * clamp( 0.35 / max( jw.x, jw.y ) - 0.4, 0.0, 1.0 );
          // (ground nov19b) once a pixel is wider than the joint, the band is drawn about half a pixel wide: scale its contrast
          // by the share of the pixel the real joint covers (a grid of full-strength 1 px lines read as moire on every lot)
          jl *= ${(joint[3] / joint[0]).toFixed(4)} / ( ${(joint[3] / joint[0]).toFixed(4)} + 0.5 * max( jw.x, jw.y ) );
          float ju = psWH( floor( jp ) + 3.7 );
          diffuseColor.rgb *= ( 1.0 - ${joint[4].toFixed(3)} * jl ) * ( 0.96 + 0.08 * ju );
          roughnessFactor = mix( roughnessFactor, 0.95, jl );
        }`
            : ''
        }
        roughnessFactor = mix( roughnessFactor * ( 0.86 + 0.24 * wMacro ), 0.42, wStain );
        roughnessFactor = max( roughnessFactor, ${minRough.toFixed(3)} );`,
        );
    };
    if (key === 'a') {
      // calmer asphalt: sample the albedo one mip softer so the white aggregate speckle does not shimmer
      const pv = mat.onBeforeCompile;
      mat.onBeforeCompile = (sh, r) => {
        pv(sh, r);
        sh.fragmentShader = sh.fragmentShader.replace(
          '#include <map_fragment>',
          '#ifdef USE_MAP\n  diffuseColor *= texture2D( map, vMapUv, ' +
            (mat.userData.mipBias ?? 1.25).toFixed(2) +
            ' );\n#endif',
        );
      };
    }
    mat.customProgramCacheKey = () => prevKey() + '|wear' + key;
    mat.needsUpdate = true;
  };
  // look track: max anisotropic filtering on every ground texture (roads and sand stay crisp at grazing angles)
  for (const m of [
    M.asphalt,
    M.junction,
    M.parking,
    M.sidewalk,
    M.panels,
    M.promenade,
    M.sand,
    M.dune,
    M.land,
    M.roof,
    M.grass,
    M.markings,
    M.wood,
  ]) {
    if (!m) continue;
    for (const k of ['map', 'normalMap', 'roughnessMap', 'aoMap']) {
      const t = m[k];
      if (t && t.anisotropy !== maxAniso) {
        t.anisotropy = maxAniso;
        t.needsUpdate = true;
      }
    }
  }
  for (const m of [M.asphalt, M.junction, M.roadDecals])
    if (m)
      groundWear(
        m,
        m.userData.mipBias !== undefined ? 0.17 : 0.12,
        0.42,
        'a',
        0.7,
        1.55,
        0,
        null,
        m.userData.mipBias !== undefined ? 0.07 : 0.04,
      ); // tone 1.55: sun-bleached gray asphalt; calm grain, softer cracks
  // parking lots and station aprons: poured concrete slabs with expansion joints every 4.5 m and oil stains
  if (M.parking)
    groundWear(M.parking, 0.1, 0.75, 'k', 0.35, 1.0, 0, [4.5, 4.5, 0, 0.035, 0.5], 0.06);
  for (const m of [M.markings]) groundWear(m, 0.1, 0.0, 'm', 0.6); // worn, chipped paint over the same cracks
  for (const m of [M.land, M.grass]) if (m) patchFillEdges(m); // ground pass: worn soil band + crumbs along roads / pavement on city ground fills
  for (const m of [M.asphalt, M.junction, M.roadDecals, M.lines, M.markings])
    if (m) patchRoadEdges(m); // ground pass: open asphalt edges crumble into the shoulder (ground/groundEdge.js)
  // sidewalks: 0.6 x 0.6 m concrete pavers in a running bond, dark sand joints (panels / promenade keep their own sets)
  if (M.sidewalk.userData.job4)
    groundWear(M.sidewalk, 0.07, 0.1, 'p4', 0.1, 1, 0, null, 0.04); // scan already carries the panel joints
  else groundWear(M.sidewalk, 0.08, 0.12, 'p2', 0, 1, 0, [0.6, 0.6, 1, 0.012, 0.45], 0.06);
  for (const m of [M.panels, M.promenade]) groundWear(m, 0.12, 0.18, 'p');
  patchCitySurfaces(M); // surfaces pass: asphalt / paint / sidewalk detail, lane wear, gutters, wet response (src/world/surfaces/surfaceShaders.js)
  for (const m of [M.sand, M.dune])
    if (!m?.userData?.isSand) groundWear(m, 0.1, 0.0, 's', 0, 1, 0.93); // dry sand is rough: no mirror-like sun hot spot
  for (const m of [M.land, M.roof]) groundWear(m, 0.14, 0.12, 'l');
  groundWear(M.grass, 0.2, 0.16, 'g', 0, 0.97); // ground-continuity: mown park lawns get macro light / dark mowing and dry patches (no flat single-colour lawn)
  // ground pass: plain city land (lots, verges, open blocks) uses the terrain's recipes over the user's ground scans (scrub / lawn /
  // dirt patches, hex-tiled), so the city ground matches the countryside; its polygon offset is nudged so world-dressing's older
  // land re-skin (which looks the material up by offset) leaves it alone. ?ground2=0 keeps the previous Poly Haven blend.
  let recipeLand = false;
  if (!/[?&]ground2=0\b/.test(typeof location !== 'undefined' ? location.search : ''))
    try {
      patchRecipeGround(M.land, renderer, ['scrub', 'lawn', 'dirt'], { mix: [0.42, 0.7] });
      M.land.polygonOffsetUnits = -1.02;
      recipeLand = true;
      if (M.grass) patchRecipeGround(M.grass, renderer, ['lawn', 'meadow'], { mix: [0.58, 0.82] });
    } catch (e) {
      console.warn('[miami] recipe land', e);
    }
  if (!recipeLand)
    try {
      const [gS, sS, dS] = await Promise.all([
        loadSet(renderer, 'leafy_grass'),
        loadSet(renderer, 'sparse_grass'),
        loadSet(renderer, 'dirt'),
      ]);
      for (const t of [gS.map, gS.normalMap, gS.arm, sS.map, dS.map])
        if (t) {
          t.wrapS = t.wrapT = THREE.RepeatWrapping;
          t.anisotropy = 8;
          t.needsUpdate = true;
        }
      const L = M.land,
        prev = L.onBeforeCompile,
        prevKey = L.customProgramCacheKey ? L.customProgramCacheKey.bind(L) : () => '';
      L.map = gS.map;
      L.normalMap = gS.normalMap;
      if (gS.arm) L.roughnessMap = gS.arm;
      L.color.setRGB(0.92, 0.95, 0.88);
      L.userData.pbr = 'land-blend';
      L.onBeforeCompile = (sh, r) => {
        if (prev) prev(sh, r);
        sh.uniforms.tSparse = { value: sS.map };
        sh.uniforms.tDirt = { value: dS.map };
        sh.vertexShader =
          'varying vec3 vLandWP;\n' +
          sh.vertexShader.replace(
            '#include <worldpos_vertex>',
            '#include <worldpos_vertex>\nvLandWP = (modelMatrix * vec4(transformed, 1.0)).xyz;',
          );
        sh.fragmentShader =
          `uniform sampler2D tSparse;
uniform sampler2D tDirt;
varying vec3 vLandWP;
float lHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float lNoise(vec2 p) { vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f); return mix(mix(lHash(i), lHash(i + vec2(1.0, 0.0)), u.x), mix(lHash(i + vec2(0.0, 1.0)), lHash(i + vec2(1.0, 1.0)), u.x), u.y); }
` +
          sh.fragmentShader.replace(
            '#include <map_fragment>',
            `{
    vec2 wp = vLandWP.xz;
    vec4 cg = texture2D(map, wp / 5.0), cs = texture2D(tSparse, wp / 4.3 + 0.37), cd = texture2D(tDirt, wp / 3.7 + 0.11);
    float n1 = lNoise(wp * 0.031) * 0.65 + lNoise(wp * 0.11) * 0.35, n2 = lNoise(wp * 0.017 + 7.3) * 0.7 + lNoise(wp * 0.07) * 0.3;
    vec4 c = mix(mix(cg, cs, smoothstep(0.42, 0.62, n2)), cd, smoothstep(0.7, 0.86, n1) * 0.7);
    c.rgb = mix(c.rgb, c.rgb * vec3(1.08, 1.05, 0.9), smoothstep(0.55, 0.85, lNoise(wp * 0.009 + 3.1)) * 0.35);
    c.rgb *= 0.9 + 0.2 * lNoise(wp * 0.23);
    diffuseColor *= c;
  }`,
          );
      };
      L.customProgramCacheKey = () => prevKey() + '|landblend';
      L.needsUpdate = true;
    } catch (e) {
      console.warn('[miami] land blend textures unavailable', e);
    }

  // lit-window fraction per building type (office, home, hotel, retail, industrial, garage, lobby, restaurant) by hour
  const LIT = [
    [
      [0, 0.1],
      [5, 0.1],
      [7, 0.3],
      [17, 0.75],
      [19, 0.5],
      [21, 0.24],
      [24, 0.1],
    ],
    [
      [0, 0.22],
      [2, 0.07],
      [5, 0.06],
      [6.5, 0.36],
      [18, 0.7],
      [22, 0.5],
      [24, 0.22],
    ],
    [
      [0, 0.3],
      [2, 0.13],
      [5, 0.12],
      [7, 0.3],
      [18, 0.55],
      [23, 0.32],
      [24, 0.3],
    ],
    [
      [0, 0.2],
      [6, 0.2],
      [17, 0.9],
      [22, 0.55],
      [24, 0.2],
    ],
    [
      [0, 0.25],
      [24, 0.25],
    ],
    [
      [0, 1],
      [24, 1],
    ],
    [
      [0, 0.95],
      [24, 0.95],
    ],
    [
      [0, 0.5],
      [1, 0.12],
      [17, 0.12],
      [18, 0.95],
      [23, 0.65],
      [24, 0.5],
    ],
  ];
  const litAt = (tab, h) => {
    for (let i = 1; i < tab.length; i++)
      if (h <= tab[i][0]) {
        const a = tab[i - 1],
          b = tab[i];
        return a[1] + (b[1] - a[1]) * ((h - a[0]) / Math.max(1e-6, b[0] - a[0]));
      }
    return tab[tab.length - 1][1];
  };
  let t = 0;
  const night = (h) =>
    h >= 19.5 || h < 6 ? 1 : h > 18.6 ? (h - 18.6) / 0.9 : h < 7 ? 1 - (h - 6) : 0;
  const duskF = (h) =>
    h >= 18.0 ? Math.min(1, (h - 18.0) / 0.5) : h < 6.2 ? 1 : h < 6.7 ? (6.7 - h) / 0.5 : 0;
  function update(dt, hour) {
    t += dt;
    const n = night(hour),
      dusk = duskF(hour);
    for (let i = 0; i < 8; i++) facU.uFLit.value[i] = litAt(LIT[i], hour);
    facU.uFNight.value = Math.max(n, dusk * 0.85);
    facU.uFDay.value = 0.05 + 0.5 * (1 - n);
    facU.uFTime.value = t;
    propU.uEmis.value = Math.max(n, dusk);
    winU.uWinTime.value = t;
    winU.uWinDensity.value = hour >= 17 || hour < 0.5 ? 0.85 : hour < 5 ? 0.45 : 0.6;
    windU.uWindTime.value = t;
    windU.uGust.value =
      0.25 +
      0.3 * (0.5 + 0.5 * Math.sin(t * 0.13)) +
      0.35 * Math.max(0, Math.sin(t * 0.41) * Math.sin(t * 0.067 + 1.3));
    vegUniforms.uVegTime.value = t;
    vegUniforms.uVegGust.value = windU.uGust.value;
    for (const m of [
      M.office,
      M.deco,
      M.band,
      M.warehouse,
      ...Object.keys(VARIANTS).map((k) => M[k]),
    ])
      m.emissiveIntensity = 0.04 + 1.0 * n;
    M.glass.emissiveIntensity = 0.03 + 0.9 * n;
    M.farGlass.emissiveIntensity = 0.03 + 0.9 * n;
    M.shop.emissiveIntensity = 0.35 + 1.1 * n;
    M.far.emissiveIntensity = 0.9 * n;
    M.lampHead.emissiveIntensity = 6 * n;
    M.pool.opacity = 0.5 * n;
    M.neon.color.setScalar(dusk > 0.02 ? 0.3 + 3.0 * dusk : 1.0);
    if (M.neon.userData.uNeonDay) M.neon.userData.uNeonDay.value = 1 - Math.min(1, dusk * 1.5); // r2-art: unlit neon tubes by day are dull colored glass (a full-strength unlit magenta read as a missing-texture bar)
    if (dusk > 0.02) M.bulb.color.setRGB(1, 0.85, 0.63).multiplyScalar(0.3 + 3.2 * dusk);
    else M.bulb.color.setRGB(0.2, 0.19, 0.17); // unlit by day: dull glass bulb, not a glowing beige dot
    if (M.roomGlassKit) {
      M.roomGlassKit.uNight.value = Math.max(n, dusk * 0.8);
      const qn = globalThis.game?.quality?.name;
      M.roomGlassU.uRoomOn.value = qn === 'medium' || qn === 'low' ? 0 : 1;
    }
    const blink = t % 1.6 < 0.25;
    M.beacon.color.setRGB(blink ? 4 : 0.25, blink ? 0.2 : 0.02, blink ? 0.2 : 0.02);
    return { n, dusk };
  }
  // downtown shop windows: the towns track's interior-room glass (furnished box rooms behind the pane, warm at night)
  // ?noshoprooms turns it off (costs about 6 ms a frame on a downtown street at car height, measured Nov 14)
  if (!(typeof location !== 'undefined' && /noshoprooms/.test(location.search)))
    try {
      const { createHouseKit } = await import('../setpieces/houses/materials.js');
      const hk = createHouseKit(THREE, {});
      M.roomGlass = hk.mat.shopGlass();
      M.roomGlass.side = THREE.FrontSide;
      M.roomGlassKit = hk;
      // cost control: rooms only within ~70 m (dithered 55-70 m, the facade's own shop glass shows beyond) and only on the
      // high / ultra presets; the panes draw first (renderOrder -1) so the facade shader behind them is depth-rejected
      M.roomGlassU = { uRoomOn: { value: 1 } };
      const prevRG = M.roomGlass.onBeforeCompile;
      M.roomGlass.onBeforeCompile = (sh, r) => {
        prevRG(sh, r);
        sh.uniforms.uRoomOn = M.roomGlassU.uRoomOn;
        sh.uniforms.uFrameN = FRAME_NOISE;
        sh.uniforms.uRenderR2 = RENDER_R2; // r2-render: the fixed hash left a dot pattern on shop windows at 55-70 m
        sh.fragmentShader = sh.fragmentShader.replace(
          'void main() {',
          `uniform float uRoomOn; uniform float uFrameN; uniform float uRenderR2;
${IGN_R2_GLSL}
void main() {
  {
    float rd = distance( vRoomW, cameraPosition );
    float rth = uRenderR2 > 0.5 ? psIgnT( gl_FragCoord.xy ) : fract( dot( gl_FragCoord.xy, vec2( 0.0671, 0.5831 ) ) * 52.98 );
    if ( uRoomOn < 0.5 || rd > 55.0 + 15.0 * rth ) discard;
  }`,
        );
      };
      M.roomGlass.customProgramCacheKey = () => 'house:shopGlass|near70';
    } catch (e) {
      console.warn('[city-look] shop room glass unavailable', e);
    }
  for (const k in M) {
    const m = M[k];
    if (m && m.isMaterial && !m.name) m.name = 'M.' + k;
  } // ground pass: named materials (layer / clipping audits)
  return { M, F, update };
}
