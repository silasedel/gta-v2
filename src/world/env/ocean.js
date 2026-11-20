import * as THREE from 'three';
import { fillLandFromWater } from './shoreFill.js';
import { R4WATER } from './freshMask.js';

// Global ocean: one huge camera-following plane at sea level with
//  - multi-scale scrolling normal maps, flattened with distance (LOD normals, no shimmer on the horizon)
//  - analytic sky reflection (same gradient/glow uniforms as the sky dome -> always matches the sky)
//  - sun glitter, moon path, Fresnel, deep/shallow colour from a shoreline distance field
//  - animated shore foam bands built from city.mapLayers (land/water polygons) or city.isWater
// No planar reflection pass (the old Water.js re-rendered the whole city every frame).

const SHORE_MAX = 140; // metres encoded in the distance field
const DBG = typeof location !== 'undefined' && /[?&]gdbg=1\b/.test(location.search); // r2-ground: depth debug view
// world_nov19b: pixel-width antialiasing of the shore bands (edge fade, foam lace, wet fringe). ?nov19b=0 = old.
const NOV19B = !(typeof location !== 'undefined' && /[?&]nov19b=0\b/.test(location.search));
const AAK = NOV19B ? '1.0' : '0.0';

export function createOcean(game, skyUniforms, normalsTex) {
  const u = skyUniforms;
  const uniforms = THREE.UniformsUtils.merge([
    THREE.UniformsLib.fog,
    THREE.UniformsLib.lights,
    {
      tNormal: { value: null },
      tShore: { value: null },
      uShoreRect: { value: new THREE.Vector4(0, 0, 1, 1) },
      uHasShore: { value: 0 },
      uTime: { value: 0 },
      uWindOff: { value: new THREE.Vector2() },
      uWindChop: { value: 1 },
      uDeep: { value: new THREE.Color(0.005, 0.05, 0.1) }, // ground pass: deep water reads blue (reference aerial), shallows turquoise / cyan
      uShallow: { value: new THREE.Color(0.05, 0.52, 0.55) },
      uAmbient: { value: new THREE.Color(0.3, 0.3, 0.35) },
      uSunCol: { value: new THREE.Color(1, 1, 1) },
      // r2-ground: top-down height of the ground under the water near the camera (terrain, seabed, beach sand): r = y * w, g = w
      tHgt: { value: null },
      uHRect: { value: new THREE.Vector4(0, 0, 1, 0) },
      uSea: { value: -0.12 },
      uSbRect: { value: new THREE.Vector4(0, 0, 1, 0) }, // seabed grid (center x, z, half size, on): see-through fades out before its rim
      // render track (Nov 18, user: "the water line at the shore glitches and looks harsh"): the opaque scene's depth, copied
      // right before the water draws (oceanSoftEdge below), gives the TRUE water depth at every pixel near the shore
      tSceneDepth: { value: null },
      tSceneColor: { value: null },
      uProj: { value: new THREE.Matrix4() },
      uSSR: { value: 1 },
      uSoft: { value: 0 },
      uWader: { value: new THREE.Vector4(0, 0, 0, 0) },
      uDepthSize: { value: new THREE.Vector2(1, 1) },
      uNearFar: { value: new THREE.Vector2(0.25, 8000) },
    },
  ]);
  // share sky uniform objects (by reference) so the ocean always reflects the current sky
  for (const k of [
    'lightDir',
    'lightColor',
    'sunDir',
    'moonDir',
    'uZenith',
    'uHorizon',
    'uHorizonSun',
    'uSunGlow',
    'uNight',
    'uFogColor',
  ])
    uniforms[k] = u[k];
  uniforms.tNormal.value = normalsTex;

  const makeMat = (pass) =>
    new THREE.ShaderMaterial({
      name: pass ? 'PortSolanaOcean' : 'PortSolanaOcean:transmit',
      defines: { PASS: pass },
      uniforms,
      lights: true,
      fog: true,
      vertexShader: /* glsl */ `
      varying vec3 vWorld;
      varying float vViewZ;
      #include <fog_pars_vertex>
      void main() {
        vec4 wp = modelMatrix * vec4( position, 1.0 );
        vWorld = wp.xyz;
        vec4 mvPosition = viewMatrix * wp;
        vViewZ = -mvPosition.z;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
      fragmentShader: /* glsl */ `
      uniform sampler2D tNormal;
      uniform sampler2D tShore;
      uniform vec4 uShoreRect;
      uniform float uHasShore;
      uniform float uTime;
      uniform vec2 uWindOff;
      uniform float uWindChop;
      uniform vec3 uDeep, uShallow, uAmbient, uSunCol;
      uniform vec3 lightDir, lightColor, sunDir, moonDir;
      uniform vec3 uZenith, uHorizon, uHorizonSun, uSunGlow, uFogColor;
      uniform float uNight;
      uniform sampler2D tHgt; uniform vec4 uHRect; uniform float uSea; uniform vec4 uSbRect;
      uniform sampler2D tSceneDepth; uniform float uSoft; uniform vec4 uWader; uniform vec2 uDepthSize, uNearFar;
      uniform sampler2D tSceneColor; uniform mat4 uProj; uniform float uSSR;
      varying vec3 vWorld;
      varying float vViewZ;
      #include <common>
      #include <packing>
      #include <bsdfs>
      #include <fog_pars_fragment>
      #include <lights_pars_begin>

      vec3 skyColor( vec3 dir ) {
        float hh = max( dir.y, 0.0 );
        vec3 art = mix( uHorizon, uZenith, pow( hh, 0.42 ) );
        float cosT = dot( dir, normalize( sunDir ) );
        float sunSide = pow( cosT * 0.5 + 0.5, 2.2 );
        art = mix( art, uHorizonSun, clamp( sunSide * exp( -hh * 5.0 ), 0.0, 1.0 ) );
        float cp = max( cosT, 0.0 );
        art += uSunGlow * ( pow( cp, 6.0 ) * 0.22 + pow( cp, 48.0 ) * 0.6 );
        float md = max( dot( dir, normalize( moonDir ) ), 0.0 );
        art += uNight * vec3( 0.75, 0.82, 1.0 ) * ( pow( md, 900.0 ) * 3.0 + pow( md, 60.0 ) * 0.08 ) * step( 0.0, moonDir.y );
        art += uNight * vec3( 0.035, 0.018, 0.016 ) * exp( -hh * 9.0 ); // city glow (dimmed in reflection)
        return art;
      }
      // render track (Nov 18, mock-ups r4/17, r4/18: calm water mirrors the dock, boats and shore): screen-space reflection
      // against the opaque scene copied before the water draws (depth + color). 18 growing steps in view space, jittered
      // per pixel (TAA resolves it), faded at the screen border and with distance traveled; misses keep the analytic sky.
      vec4 ssrTrace( vec3 wp, vec3 rd ) {
        vec3 q = ( viewMatrix * vec4( wp, 1.0 ) ).xyz, vd = normalize( ( viewMatrix * vec4( rd, 0.0 ) ).xyz );
        float stepL = 0.35 + 0.015 * -q.z;
        q += vd * stepL * fract( sin( dot( gl_FragCoord.xy, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 );
        for ( int i = 0; i < 18; i ++ ) {
          q += vd * stepL; stepL *= 1.22;
          vec4 cp = uProj * vec4( q, 1.0 ); if ( cp.w <= 0.0 ) break;
          vec2 uv = cp.xy / cp.w * 0.5 + 0.5;
          if ( uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0 ) break;
          float sd = texture2D( tSceneDepth, uv ).x; if ( sd >= 0.999999 ) continue;
          float dz = -q.z + perspectiveDepthToViewZ( sd, uNearFar.x, uNearFar.y );
          if ( dz > 0.0 && dz < stepL * 1.6 + 0.25 ) {
            vec2 e = smoothstep( 0.0, 0.07, uv ) * smoothstep( 0.0, 0.07, 1.0 - uv );
            return vec4( texture2D( tSceneColor, uv ).rgb, e.x * e.y * ( 1.0 - float( i ) / 26.0 ) );
          }
        }
        return vec4( 0.0 );
      }
      vec3 nrm( vec2 uv ) { return texture2D( tNormal, uv ).xyz * 2.0 - 1.0; }
      float oH( vec2 q ) { return fract( sin( dot( q, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
      float oN( vec2 q ) { vec2 i = floor( q ), f = fract( q ); f = f * f * ( 3.0 - 2.0 * f ); return mix( mix( oH( i ), oH( i + vec2( 1.0, 0.0 ) ), f.x ), mix( oH( i + vec2( 0.0, 1.0 ) ), oH( i + vec2( 1.0, 1.0 ) ), f.x ), f.y ); }

      void main() {
        vec3 toEye = cameraPosition - vWorld;
        float dist = length( toEye );
        vec3 V = toEye / dist;
        vec2 p = vWorld.xz;
        float t = uTime;
        vec2 pw = p - uWindOff; // ripples drift downwind (game.wind); the long swell keeps its own heading
        // ---- multi-scale normals, flattened with distance ----
        vec3 n = nrm( pw / 41.0 + t * vec2( 0.012, 0.009 ) ) * 0.55
               + nrm( ( p - uWindOff * 1.6 ) / 13.0 + t * vec2( -0.021, 0.016 ) ) * 0.35
               + nrm( ( p - uWindOff * 2.2 ) / 4.3 + t * vec2( 0.033, -0.041 ) ) * 0.26 * ( 1.0 - smoothstep( 40.0, 260.0, dist ) )
               + nrm( ( p - uWindOff * 2.6 ) / 1.37 + t * vec2( -0.047, 0.052 ) ) * 0.16 * ( 1.0 - smoothstep( 8.0, 60.0, dist ) )
               + nrm( p / 197.0 + t * vec2( 0.004, -0.003 ) ) * 0.6;
        float lod = 1.0 / ( 1.0 + dist * 0.0022 );
        float lowSun = 1.0 - smoothstep( 0.08, 0.45, normalize( lightDir ).y );
        float chop = ( 0.55 + 0.35 * lowSun ) * lod * uWindChop; // choppier ripples at low sun: dark troughs, bright glitter
        vec3 N = normalize( vec3( n.x * chop, 1.0, n.y * chop ) );

        // ---- shoreline distance (0 at the coast .. 1 = SHORE_MAX m or more) ----
        float shoreD = 1.0;
        if ( uHasShore > 0.5 ) {
          vec2 suv = ( p - uShoreRect.xy ) * uShoreRect.zw;
          if ( suv.x > 0.0 && suv.y > 0.0 && suv.x < 1.0 && suv.y < 1.0 ) shoreD = texture2D( tShore, suv ).r;
        }
        float shoreM = shoreD * ${SHORE_MAX.toFixed(1)};

        // ---- r2-ground: true water depth near the camera (height cascade of the ground under the water) ----
        float sE = shoreM * mix( 0.75, 1.3, oN( p / 85.0 ) * 0.7 + oN( p / 23.0 + 4.0 ) * 0.3 ); // sand bars / channels break up the estimate
        float r4Land = 0.0; // r4-water: blurred share of ground at / above the waterline (b / g of the cascade), 0 = open water
        float hK = 0.0, gwO = 0.0, wD = 0.08 + sE * 0.025 + sE * sE * 0.00035, wS = 0.06; // cascade weight, ground-data weight, depth (m; without ground data: the seabed shelf profile over the coarse shore distance), bottom slope
        if ( uHRect.w > 0.5 ) {
          vec2 hu = vec2( ( p.x - uHRect.x ) * uHRect.z, 1.0 - ( p.y - uHRect.y ) * uHRect.z );
          vec2 he = min( hu, 1.0 - hu );
          float hb = smoothstep( 0.02, 0.22, min( he.x, he.y ) ); // ~50 m crossfade at the cascade border
          if ( hb > 0.0 ) {
            float tx = 1.5 * uHRect.z;
            vec4 h0 = texture2D( tHgt, hu ), hx = texture2D( tHgt, hu + vec2( tx, 0.0 ) ), hz = texture2D( tHgt, hu - vec2( 0.0, tx ) );
            hK = hb;
            if ( h0.g > 0.01 ) {
              float y0 = h0.r / h0.g, gw = smoothstep( 0.08, 0.9, h0.g ); r4Land = clamp( h0.b / h0.g, 0.0, 1.0 );
              float sbF = 1.0; if ( uSbRect.w > 0.5 ) { vec2 sbd = abs( p - uSbRect.xy ); sbF = 1.0 - smoothstep( uSbRect.z - 70.0, uSbRect.z - 10.0, max( sbd.x, sbd.y ) ); } // long crossfade to the estimate before the seabed grid's rim: no straight edge
              gw *= sbF;
              wD = mix( wD, uSea - y0, gw );
              if ( hx.g > 0.01 && hz.g > 0.01 ) wS = mix( wS, length( vec2( hx.r / hx.g - y0, hz.r / hz.g - y0 ) ) / 1.5, gw );
              gwO = gw * hb;
            }
          }
        }
        // ---- reflection / refraction ----
        float NdV = max( dot( N, V ), 0.0 );
        float F = ( 0.02 + 0.98 * pow( 1.0 - NdV, 5.0 ) ) * mix( 0.55, 1.0, lowSun ); // rough daytime sea mirrors less sky: the green-teal body shows
        vec3 R = reflect( -V, N );
        R.y = abs( R.y ) + 0.01;
        vec3 refl = skyColor( normalize( R ) ) * ( 1.0 - 0.22 * lowSun );
      #if PASS == 1
        if ( uSoft > 0.5 && uSSR > 0.5 && dist < 600.0 ) { vec4 sr = ssrTrace( vWorld, normalize( R ) ); refl = mix( refl, sr.rgb, sr.a * 0.92 ); }
      #endif

        vec3 L = normalize( lightDir );
        float sunUp = smoothstep( -0.05, 0.05, L.y );
        // ---- r2-ground: physically shaded water, two passes over the same surface (user feedback: no painted teal ramp) ----
        //  PASS 0 (multiply blend): how much of the ground behind survives: (1 - Fresnel) * exp(-sigma * path), per channel
        //  PASS 1 (additive): in-scatter toward the deep-water color, Fresnel sky reflection, sun glitter, foam
        // path = refracted view ray down to the bottom + sunlight down to it (Snell, n 1.33); sigma: clear tropical seawater
        vec3 amb = mix( uAmbient, vec3( dot( uAmbient, vec3( 0.3333 ) ) ), 0.5 );
        vec3 Ein = amb + uSunCol * max( L.y, 0.0 ) * sunUp; // light reaching into the water
        float wob = ( ( oN( p * 0.9 + vec2( t * 0.35, -t * 0.2 ) ) - 0.5 ) * 0.03 + 0.012 * sin( t * 0.8 + p.x * 0.07 + p.y * 0.05 ) ) * hK; // the edge breathes a few cm
        float dE = wD + wob, dP = max( dE, 0.0 );
        // render track: true depth from the scene depth buffer (vertical, m). Near the shore it replaces the blurred, 1.5 s
        // stepped height-cascade estimate, so the edge sits exactly where the ground meets the water, fades to nothing there
        // (no hard cut line, no shimmer of the intersection under TAA jitter) and never jumps when the cascade recenters.
        float softD = 1e3, softP = 1e3; // vertical water depth, and the view ray's path through the water (m)
        // W4 (Nov 19, user: "walking on top of the water"): the scene depth also holds the player's legs (or his boat / car hull),
        // and the soft edge below read them as a bank: the water thinned out to nothing around his shins, so he seemed to stand
        // on the caustics. Around the wader (uWader: x, z, radius, on) the ground depth (cascade) is kept and the water stays
        // drawn up to the body: a real waterline on the legs and a foam ring. ?wader=0 = old.
        float wR = length( p - uWader.xy ), wOn = step( 0.01, uWader.w );
        float wadeK = wOn * ( 1.0 - smoothstep( uWader.z * 0.6, uWader.z, wR ) ) * smoothstep( 0.12, 0.3, dE );
        if ( uSoft > 0.5 ) {
          float sd = texture2D( tSceneDepth, gl_FragCoord.xy / uDepthSize ).x;
          if ( sd < 0.999999 ) {
            float sceneZ = -perspectiveDepthToViewZ( sd, uNearFar.x, uNearFar.y );
            softP = max( sceneZ - vViewZ, 0.0 ) * dist / max( vViewZ, 1e-3 );
            softD = softP * max( V.y, 0.03 );
          }
          dE = softD < 1.6 ? mix( softD, dE, mix( smoothstep( 0.35, 1.6, softD ), 1.0, wadeK ) ) : dE;
        }
        // r8 (user: "water edges sharp and glitching in and out"): the edge fades over the ray's PATH through the water as
        // well, so where the bank is a step / mesh rim (path short even though the water is suddenly deep) the water still
        // thins out softly over ~0.4 m instead of cutting off on the ground mesh's polygon outline; scaled with distance so
        // far shores stay soft without going blurry up close.
        // world_nov19b (user: "harsh edges, glitching back and forth"): every edge band is at least ~1.5 px wide on screen.
        // A 2 cm depth band is sub-pixel at range, so the waterline snapped between land and water with each TAA jitter and
        // the resolve rejected it (crawling, flickering shore). fwidth widens the bands where the depth changes fast per pixel.
        float aaD = uSoft > 0.5 ? min( fwidth( softD ), 0.5 ) * ${AAK} : 0.0;
        float aaP = uSoft > 0.5 ? min( fwidth( softP ), 2.0 ) * ${AAK} : 0.0;
        float kEdge = uSoft > 0.5 ? smoothstep( 0.0, 0.02 + aaD * 1.5, softD ) * smoothstep( 0.0, 0.25 + 0.004 * dist + aaP * 1.5, softP ) : 1.0;
        kEdge = mix( kEdge, 1.0, wadeK );
        dP = max( dE, 0.0 );
        float cv = sqrt( max( 1.0 - ( 1.0 - NdV * NdV ) / 1.769, 0.0 ) ), cs = sqrt( max( 1.0 - ( 1.0 - L.y * L.y ) / 1.769, 0.0 ) );
        float Lp = dP / max( cv, 0.25 ) + dP / max( cs, 0.35 );
        vec3 Tr = exp( -vec3( 0.42, 0.072, 0.034 ) * Lp );
        float facet = 0.85 + 0.3 * smoothstep( -0.5, 0.5, n.x + n.y ); // wave facets read from the air
        vec3 inS = mix( vec3( 0.012, 0.075, 0.075 ), vec3( 0.004, 0.03, 0.065 ), smoothstep( 2.0, 12.0, dP ) ) * Ein * ( 1.0 - Tr ) * facet; // forward scatter by fine particles: faint green-aqua in the shallows, deep blue where the path is long // single scatter of clear water: deep blue where the path is long
        // where no ground is rendered under the water (beyond the near cascade / seabed) a stand-in sea floor: sand with seagrass beds
        float dataK = gwO;
        // (gwO already fades out over the last 70 m before the seabed grid's rim, together with the depth)
        float bn = oN( p / 60.0 ) * 0.6 + oN( p / 19.0 + 3.7 ) * 0.3 + oN( p / 6.0 ) * 0.1;
        float grassB = smoothstep( 0.52, 0.64, bn ) * smoothstep( 0.8, 2.5, dP );
        vec3 bedFake = mix( vec3( 0.46, 0.43, 0.37 ), vec3( 0.05, 0.08, 0.045 ), grassB ) * Ein * Tr * ( 1.0 - dataK );
        float Fn = F * smoothstep( 0.0, 0.05, dE ); // reflection thins out with the water itself at the very edge
        vec3 H = normalize( L + V );
        float NdH = max( dot( N, H ), 0.0 );
        vec3 glit = lightColor * ( pow( NdH, 1200.0 ) * 18.0 + pow( NdH, 160.0 ) * 0.35 + pow( NdH, 36.0 ) * 0.02 * lowSun ) * Fn * 4.0 * sunUp;
        vec3 addC = refl * Fn + ( 1.0 - Fn ) * ( inS + bedFake ) + glit;
        vec3 mulC = vec3( 1.0 - Fn ) * Tr * dataK;
        // tiny wavelets running up the slope (subtle crests), a thin broken foam lap line hugging the waterline
        float wDS = dP / max( wS, 0.025 );
        float ph = wDS * 2.6 - t * 1.7 + oN( p * 0.15 ) * 5.0;
        float crest = pow( 0.5 + 0.5 * sin( ph ), 6.0 ) * smoothstep( 0.02, 0.12, dE ) * ( 1.0 - smoothstep( 0.4, 1.4, dE ) ) * hK;
        addC += vec3( 0.02 ) * crest * Ein;
        float lw = ( 0.004 + 0.006 * ( 0.5 + 0.5 * sin( t * 1.1 + p.x * 0.11 - p.y * 0.07 ) ) ) * clamp( wS / 0.05, 0.6, 2.5 );
        float lwA = lw + min( fwidth( dE ), 0.2 ) * 0.75 * ${AAK}; // world_nov19b: no sub-pixel foam line (it sparkled at range)
        float lace = ( 1.0 - smoothstep( 0.0, lwA, abs( dE - lw * 0.8 ) ) ) * ( lw / lwA ) * smoothstep( 0.35, 0.65, oN( p * 2.4 + vec2( t * 0.07, 0.0 ) ) * 0.6 + oN( p * 9.0 - vec2( 0.0, t * 0.1 ) ) * 0.4 ) * hK;
        float fA = clamp( lace * 0.55, 0.0, 1.0 ) * smoothstep( -0.01, 0.004, dE );
        // soft wet-foam fringe on the true edge: a few cm of broken, breathing foam that thins out into the water
        float eDw = uSoft > 0.5 ? min( fwidth( min( softD, softP * 0.15 ) ), 0.3 ) * ${AAK} : 0.0; // world_nov19b: fringe >= ~1.5 px wide
        if ( uSoft > 0.5 && min( softD, softP * 0.15 ) < 0.12 + eDw * 1.5 ) {
          float eD = min( softD, softP * 0.15 ); // the step banks get the same gentle fringe as sloped beaches
          float frW = 0.06 + 0.03 * sin( t * 0.9 + p.x * 0.21 + p.y * 0.17 );
          float fr = ( 1.0 - smoothstep( 0.004, frW + eDw * 1.5, eD ) ) * ( frW / ( frW + eDw * 1.5 ) ) * smoothstep( 0.3, 0.7, oN( p * 3.1 + vec2( t * 0.05, -t * 0.04 ) ) * 0.7 + oN( p * 11.0 ) * 0.3 );
          fA = max( fA, fr * mix( 0.28, 0.55, wadeK ) );
        }
        // the wader's own water: a broken foam collar where the body cuts the surface and small rings running out from it
        // (stronger while moving: uWader.w = 0.35 standing .. 1 running); wading depth only, gone in deep water / on land
        if ( wOn > 0.5 && uWader.z < 2.0 && wR < uWader.z * 4.0 ) {
          float wd = smoothstep( 0.05, 0.16, dE ) * ( 1.0 - smoothstep( 1.4, 2.2, dE ) ), bz = uWader.z * 0.42;
          float nzW = oN( p * 6.0 + vec2( t * 0.6, -t * 0.45 ) ) * 0.65 + oN( p * 17.0 - t * 0.3 ) * 0.35;
          float collar = smoothstep( bz * 0.55, bz * 0.9, wR ) * ( 1.0 - smoothstep( bz * 1.05, bz * 1.7, wR ) ) * smoothstep( 0.38, 0.62, nzW ) * ( 0.35 + 0.35 * uWader.w );
          float rr = wR / uWader.z, ringW = pow( 0.5 + 0.5 * sin( ( rr * 1.25 - t * 0.9 ) * 6.2832 ), 6.0 ) * smoothstep( 0.55, 0.95, rr ) * ( 1.0 - smoothstep( 1.3, 2.8, rr ) ) * smoothstep( 0.45, 0.7, nzW + 0.1 );
          fA = max( fA, ( collar + ringW * 0.2 * uWader.w ) * wd );
        }
        // far field (no depth data): a faint broken foam line at the coarse coast, no broad band
        if ( shoreM < 12.0 && hK < 1.0 ) { float nz = texture2D( tNormal, p / 9.0 + t * 0.02 ).r; fA = max( fA, ( 1.0 - smoothstep( 1.0, 5.0 + nz * 4.0, shoreM ) ) * smoothstep( 0.45, 0.8, nz + 0.2 ) * 0.4 * ( 1.0 - hK ) ); }
        vec3 foamC = ( amb * 1.05 + uSunCol * 0.5 * sunUp * max( L.y, 0.15 ) ) * vec3( 0.95, 0.97, 0.97 );
        addC = mix( addC, foamC, fA ); mulC *= 1.0 - fA;
        // past the coarse shore field's edge with no data at all: plain deep water (the multiply pass blocks what is behind)
      #if PASS == 0
        vec3 mo = mulC;
        #ifdef USE_FOG
          #ifdef FOG_EXP2
            float ffo = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
          #else
            float ffo = smoothstep( fogNear, fogFar, vFogDepth );
          #endif
          mo *= 1.0 - ffo;
        #endif
        gl_FragColor = vec4( mix( vec3( 1.0 ), mo, kEdge ), 1.0 );
      #else
        gl_FragColor = vec4( addC * kEdge, 1.0 );
        ${DBG ? 'gl_FragColor = vec4( fract( wD ), dataK, hK, 1.0 );' : ''}
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      #endif
      }`,
      // push the ocean slightly back in depth so land just above sea level never z-fights with it far away
      polygonOffset: true,
      polygonOffsetFactor: 2,
      polygonOffsetUnits: 6,
      transparent: true,
      depthWrite: !!pass, // r2-ground: transmit pass (multiply, renderOrder -6) then the light pass (additive, -5)
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: pass ? THREE.OneFactor : THREE.ZeroFactor,
      blendDst: pass ? THREE.OneFactor : THREE.SrcColorFactor,
      blendSrcAlpha: THREE.ZeroFactor,
      blendDstAlpha: THREE.OneFactor,
    });
  const mat = makeMat(1),
    matT = makeMat(0);

  const SIZE = 60000;
  const geo = new THREE.PlaneGeometry(SIZE, SIZE, 1, 1);
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'ocean';
  mesh.frustumCulled = false;
  mesh.renderOrder = -5;
  const meshT = new THREE.Mesh(geo, matT);
  meshT.name = 'ocean:transmit';
  meshT.frustumCulled = false;
  meshT.renderOrder = -6;
  mesh.add(meshT); // same surface, multiply pass
  // ---- soft edge: copy the opaque scene's depth just before the first water pass draws (the transmit pass, order -6) ----
  // Only for the main scene target (it carries a depthTexture); env cubes, probes and tools render without it (uSoft 0).
  // One depth blit per frame (multisampled targets resolve their depth in the blit). ?softshore=0 = old edge.
  const SOFT = !(typeof location !== 'undefined' && /[?&]softshore=0\b/.test(location.search));
  const WADER = !(typeof location !== 'undefined' && /[?&]wader=0\b/.test(location.search));
  const SSR = typeof location !== 'undefined' && /[?&]waterssr=1\b/.test(location.search); // screen-space reflections on the water: OFF by default until its GPU cost is measured on a quiet machine (?waterssr=1 or game.waterSSR)
  const dRT = new THREE.WebGLRenderTarget(4, 4, {
    type: THREE.HalfFloatType,
    depthBuffer: true,
    samples: 0,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    generateMipmaps: false,
  });
  dRT.depthTexture = new THREE.DepthTexture(4, 4, THREE.UnsignedIntType);
  dRT.depthTexture.format = THREE.DepthFormat;
  dRT.depthTexture.minFilter = dRT.depthTexture.magFilter = THREE.NearestFilter;
  const softStats = { blits: 0, skipped: 0, fail: false };
  let softFail = false,
    softChecks = 3; // getError syncs with the GPU process: checked on the first blits only
  meshT.onBeforeRender = (r, sc, cam) => {
    uniforms.uSoft.value = 0;
    if (!SOFT || softFail || !cam.isPerspectiveCamera) return;
    const rt = r.getRenderTarget();
    if (
      !rt ||
      !rt.depthTexture ||
      rt.depthTexture.type !== THREE.UnsignedIntType ||
      rt.isWebGLCubeRenderTarget
    ) {
      softStats.skipped++;
      return;
    }
    try {
      const w = rt.width,
        h = rt.height;
      if (dRT.width !== w || dRT.height !== h) {
        dRT.setSize(w, h);
        dRT.depthTexture.image.width = w;
        dRT.depthTexture.image.height = h;
      }
      const gl = r.getContext(),
        props = r.properties.get(dRT);
      const src = gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING); // the scene target being drawn (read BEFORE initRenderTarget binds dRT)
      if (!props.__webglFramebuffer) {
        r.initRenderTarget(dRT);
        gl.bindFramebuffer(gl.FRAMEBUFFER, src);
      }
      if (softChecks > 0) for (let k = 0; k < 16 && gl.getError() !== gl.NO_ERROR; k++); // clear older, unrelated errors
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, src);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, props.__webglFramebuffer);
      gl.blitFramebuffer(
        0,
        0,
        w,
        h,
        0,
        0,
        w,
        h,
        gl.DEPTH_BUFFER_BIT |
          ((SSR || game.waterSSR === true) &&
          game.waterSSR !== false &&
          rt.texture?.type === THREE.HalfFloatType
            ? gl.COLOR_BUFFER_BIT
            : 0),
        gl.NEAREST,
      );
      gl.bindFramebuffer(gl.FRAMEBUFFER, src);
      if (softChecks > 0) {
        softChecks--;
        const e = gl.getError();
        if (e !== gl.NO_ERROR) {
          let info = '';
          try {
            gl.bindFramebuffer(gl.READ_FRAMEBUFFER, src);
            const a = gl.getFramebufferAttachmentParameter(
                gl.READ_FRAMEBUFFER,
                gl.DEPTH_ATTACHMENT,
                gl.FRAMEBUFFER_ATTACHMENT_DEPTH_SIZE,
              ),
              st = gl.getFramebufferAttachmentParameter(
                gl.READ_FRAMEBUFFER,
                gl.DEPTH_ATTACHMENT,
                gl.FRAMEBUFFER_ATTACHMENT_STENCIL_SIZE,
              ),
              ty = gl.getFramebufferAttachmentParameter(
                gl.READ_FRAMEBUFFER,
                gl.DEPTH_ATTACHMENT,
                gl.FRAMEBUFFER_ATTACHMENT_COMPONENT_TYPE,
              );
            info = 'src depth ' + a + ' stencil ' + st + ' type ' + ty + ' samples ' + rt.samples;
            gl.bindFramebuffer(gl.FRAMEBUFFER, src);
          } catch (e2) {
            /* */
          }
          softFail = softStats.fail = true;
          softStats.err = e + ' ' + info;
          console.warn('[ocean] soft shore off (depth blit failed)', softStats.err);
          return;
        }
      }
      uniforms.tSceneDepth.value = dRT.depthTexture;
      uniforms.uDepthSize.value.set(w, h);
      uniforms.uNearFar.value.set(cam.near, cam.far);
      uniforms.tSceneColor.value = dRT.texture;
      uniforms.uProj.value.copy(cam.projectionMatrix);
      uniforms.uSSR.value =
        (SSR || game.waterSSR === true) &&
        game.waterSSR !== false &&
        rt.texture?.type === THREE.HalfFloatType
          ? 1
          : 0;
      uniforms.uSoft.value = 1;
      softStats.blits++;
    } catch (e) {
      softFail = true;
      console.warn('[ocean] soft shore off', e);
    }
  };
  mesh.receiveShadow = false;
  mesh.castShadow = false;

  // ---------- shoreline distance field ----------
  let shoreState = 'none';
  // built as a generator and stepped from update() under a per-frame time budget (no load spike)
  function* buildShore(city) {
    const b = city.bounds;
    if (!b) return false;
    const M = 300;
    const minX = b.minX - M,
      minZ = b.minZ - M,
      maxX = b.maxX + M,
      maxZ = b.maxZ + M;
    const ex = maxX - minX,
      ez = maxZ - minZ;
    const cell = Math.max(2.5, Math.max(ex, ez) / 1536);
    const W = Math.ceil(ex / cell),
      H = Math.ceil(ez / cell);
    const land = new Uint8Array(W * H);
    const ml = city.mapLayers;
    if (ml && Array.isArray(ml.land) && ml.land.length) {
      const cv = document.createElement('canvas');
      cv.width = W;
      cv.height = H;
      const g = cv.getContext('2d', { willReadFrequently: true });
      g.fillStyle = '#000';
      g.fillRect(0, 0, W, H);
      const poly = (pts) => {
        g.beginPath();
        pts.forEach(([x, z], i) => {
          const px = (x - minX) / cell,
            pz = (z - minZ) / cell;
          i ? g.lineTo(px, pz) : g.moveTo(px, pz);
        });
        g.closePath();
        g.fill();
      };
      let k = 0;
      g.fillStyle = '#fff';
      for (const key of ['land', 'beach', 'park'])
        for (const pl of ml[key] || []) {
          if (pl && pl.length > 2) poly(pl);
          if (++k % 40 === 0) yield;
        }
      if (Array.isArray(ml.water)) {
        g.fillStyle = '#000';
        for (const pl of ml.water) {
          if (pl && pl.length > 2) poly(pl);
          if (++k % 40 === 0) yield;
        }
      }
      const STRIP = 40;
      for (let y0 = 0; y0 < H; y0 += STRIP) {
        const h = Math.min(STRIP, H - y0);
        const px = g.getImageData(0, y0, W, h).data;
        for (let i = 0; i < W * h; i++) land[y0 * W + i] = px[i * 4] > 127 ? 1 : 0;
        yield;
      }
    }
    // ground pass: the synthetic coasts (Keys, Gulf towns) are not all in mapLayers: every cell the water mask calls land counts too
    if (typeof city.isWater === 'function') {
      // r2-perf's fill: one raw lookup per cell, the full water rules only within ~100 m of raw land
      const OLD = typeof location !== 'undefined' && /[?&]shorefill=0\b/.test(location.search);
      yield* fillLandFromWater(
        land,
        W,
        H,
        minX,
        minZ,
        cell,
        city.isWater,
        OLD ? null : game.miamiData?.isWaterRaw,
      );
    }
    if (!(ml && Array.isArray(ml.land) && ml.land.length) && typeof city.isWater !== 'function')
      return false;
    if (false) {
    }
    const INF = 1e9,
      d = new Float32Array(W * H);
    for (let i = 0; i < W * H; i++) d[i] = land[i] ? 0 : INF;
    const A = 1,
      B = Math.SQRT2;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        let v = d[i];
        if (v === 0) continue;
        if (x > 0) v = Math.min(v, d[i - 1] + A);
        if (y > 0) {
          v = Math.min(v, d[i - W] + A);
          if (x > 0) v = Math.min(v, d[i - W - 1] + B);
          if (x < W - 1) v = Math.min(v, d[i - W + 1] + B);
        }
        d[i] = v;
      }
      if (y % 32 === 0) yield;
    }
    for (let y = H - 1; y >= 0; y--) {
      for (let x = W - 1; x >= 0; x--) {
        const i = y * W + x;
        let v = d[i];
        if (v === 0) continue;
        if (x < W - 1) v = Math.min(v, d[i + 1] + A);
        if (y < H - 1) {
          v = Math.min(v, d[i + W] + A);
          if (x < W - 1) v = Math.min(v, d[i + W + 1] + B);
          if (x > 0) v = Math.min(v, d[i + W - 1] + B);
        }
        d[i] = v;
      }
      if (y % 32 === 0) yield;
    }
    const out = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        out[i] = Math.min(255, Math.round(((d[i] * cell) / SHORE_MAX) * 255));
      }
      if (y % 96 === 0) yield;
    }
    const tex = new THREE.DataTexture(out, W, H, THREE.RedFormat, THREE.UnsignedByteType);
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.needsUpdate = true;
    if (uniforms.tShore.value && uniforms.tShore.value !== tex) uniforms.tShore.value.dispose(); // rebuilds never leak
    uniforms.tShore.value = tex;
    uniforms.uShoreRect.value.set(minX, minZ, 1 / (W * cell), 1 / (H * cell));
    uniforms.uHasShore.value = 1;
    return true;
  }
  let shoreJob = null;

  // ---------- r2-ground: ground height cascade under the shallows (true per-pixel water depth near the camera) ----------
  // The terrain, the seabed and beach sand are drawn straight down into a half-float target (r = y, g = 1; cleared to 0, so a
  // bilinear fetch r / g averages only real ground). Refreshed only near water: every 1.5 s or 24 m of camera travel.
  const HC = {
    span: 256,
    size: 512,
    t: 1e9,
    cx: 1e9,
    cz: 1e9,
    scanT: 1e9,
    wetT: 0,
    near: false,
    renders: 0,
    ms: 0,
  };
  const hRT = new THREE.WebGLRenderTarget(HC.size, HC.size, {
    type: THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    depthBuffer: true,
    stencilBuffer: false,
    magFilter: THREE.LinearFilter,
    minFilter: THREE.LinearFilter,
    generateMipmaps: false,
  });
  hRT.texture.colorSpace = THREE.NoColorSpace;
  // soft copy (Gaussian, sigma ~1.4 m at 1 m texels): data / no-data borders fade over meters, depth steps between meshes round off
  const hRTb = (n) => {
    const t = new THREE.WebGLRenderTarget(n, n, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      depthBuffer: false,
      stencilBuffer: false,
      magFilter: THREE.LinearFilter,
      minFilter: THREE.LinearFilter,
      generateMipmaps: false,
    });
    t.texture.colorSpace = THREE.NoColorSpace;
    return t;
  };
  const hB0 = hRTb(256),
    hB1 = hRTb(256);
  uniforms.tHgt.value = hB1.texture;
  const hBlur = new THREE.ShaderMaterial({
    uniforms: { tSrc: { value: null }, uDir: { value: new THREE.Vector2() } },
    depthTest: false,
    depthWrite: false,
    vertexShader:
      'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader:
      'uniform sampler2D tSrc; uniform vec2 uDir; varying vec2 vUv; void main() { vec4 c = texture2D(tSrc, vUv) * 0.1592; c += (texture2D(tSrc, vUv + uDir * 1.4706) + texture2D(tSrc, vUv - uDir * 1.4706)) * 0.2659; c += (texture2D(tSrc, vUv + uDir * 3.4302) + texture2D(tSrc, vUv - uDir * 3.4302)) * 0.1263; c += (texture2D(tSrc, vUv + uDir * 5.4) + texture2D(tSrc, vUv - uDir * 5.4)) * 0.0332; c += (texture2D(tSrc, vUv + uDir * 7.38) + texture2D(tSrc, vUv - uDir * 7.38)) * 0.005; gl_FragColor = c / 1.02; }',
  });
  const hQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), hBlur),
    hQS = new THREE.Scene(),
    hQC = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  hQuad.frustumCulled = false;
  hQS.add(hQuad);
  // r4-water: b = 1 where the ground is "land" for the bank fade (less than 5 cm under the still water counts: a 3 cm film over a
  // flat lot is not a pond, it was the flickering puddle sheet next to Brickell Ave); blurred with the rest -> a soft bank contour
  const hMat = new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    uniforms: { uLandY: { value: -0.17 } },
    vertexShader:
      'varying float vY; void main() { vec4 w = modelMatrix * vec4(position, 1.0); vY = w.y; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader:
      'uniform float uLandY; varying float vY; void main() { gl_FragColor = vec4(vY, 1.0, step(uLandY, vY), 1.0); }',
  });
  // the land base only where it is drawn: on synthetic (terrain) land the ground shader drops it under full-detail ground (aTile)
  const hMatLB = new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    uniforms: hMat.uniforms,
    vertexShader:
      'attribute vec2 aTile; varying float vY; varying float vCut; void main() { vec4 w = modelMatrix * vec4(position, 1.0); vY = w.y; vCut = aTile.x > -1e5 ? 1.0 : 0.0; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader:
      'uniform float uLandY; varying float vY; varying float vCut; void main() { if (vCut > 0.5) discard; gl_FragColor = vec4(vY, 1.0, step(uLandY, vY), 1.0); }',
  });
  const hLod = new THREE.Scene(),
    hNear = new THREE.Scene();
  hLod.matrixWorldAutoUpdate = false;
  hNear.matrixWorldAutoUpdate = false;
  const hCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 700);
  hCam.rotation.set(-Math.PI / 2, 0, 0);
  const hProx = new Map();
  const groundKind = (o) => {
    if (!o.isMesh || o.isInstancedMesh || !o.geometry) return 0;
    if (o.name === 'seabed') return 2;
    const m = Array.isArray(o.material) ? o.material[0] : o.material,
      n = (m && m.name) || '';
    if (n === 'terrain-lod') return 1;
    if (n === 'terrain' || /^ground:/.test(n) || (R4WATER && n === 'land-base')) return 2;
    /* r4: the map's land polygons (-0.05) are the visible bank in real Miami */ const sand =
      game.city && game.city.materials && game.city.materials.sand;
    return sand && m === sand ? 2 : 0;
  };
  function scanGround() {
    const live = new Set();
    game.scene.traverse((o) => {
      const k = groundKind(o);
      if (!k) return;
      live.add(o);
      if (!hProx.has(o)) {
        const lb =
          R4WATER &&
          o.geometry.attributes.aTile &&
          (Array.isArray(o.material) ? o.material[0] : o.material)?.name === 'land-base';
        const p = new THREE.Mesh(o.geometry, lb ? hMatLB : hMat);
        p.matrixAutoUpdate = false;
        p.matrixWorldAutoUpdate = false;
        hProx.set(o, p);
        (k === 1 ? hLod : hNear).add(p);
      }
    });
    for (const [o, p] of hProx)
      if (!live.has(o)) {
        p.removeFromParent();
        hProx.delete(o);
      }
  }
  // r3-perf (leak, ?leakfix=0 rolls back): a proxy kept its source mesh (and through .parent the whole streamed tile, every
  // geometry in it) after the tile was disposed: the scan that drops them only runs near water, so inland the tiles piled up
  // (about 0.2-0.5 GB a minute while driving downtown). Worse, a detached tile still has a parent group, so its proxy kept
  // drawing: the disposed geometry was uploaded to the GPU again and never freed. Proxies whose source left the scene go now.
  const LEAKFIX = !(typeof location !== 'undefined' && /[?&]leakfix=0/.test(location.search));
  const inScene = (o) => {
    for (let q = o; q; q = q.parent) if (q === game.scene) return true;
    return false;
  };
  function pruneProx() {
    for (const [o, p] of hProx)
      if (!inScene(o)) {
        p.removeFromParent();
        hProx.delete(o);
      }
  }
  function renderHeights(renderer, x, z) {
    const t0 = performance.now(),
      tx = (HC.span / HC.size) * 8,
      cx = Math.round(x / tx) * tx,
      cz = Math.round(z / tx) * tx,
      h = HC.span / 2;
    if (LEAKFIX) pruneProx();
    for (const [o, p] of hProx) {
      let v = true;
      for (let q = o; q; q = q.parent)
        if (q.visible === false) {
          v = false;
          break;
        }
      p.visible = v && !!o.parent;
      if (v) {
        p.matrixWorld.copy(o.matrixWorld);
        if (p.geometry !== o.geometry) p.geometry = o.geometry;
      }
    } // the seabed swaps its geometry on every rebuild
    hCam.left = -h;
    hCam.right = h;
    hCam.top = h;
    hCam.bottom = -h;
    hCam.position.set(cx, 350, cz);
    hCam.updateProjectionMatrix();
    hCam.updateMatrixWorld(true);
    const prevRT = renderer.getRenderTarget(),
      prevAC = renderer.autoClear,
      prevCol = renderer.getClearColor(new THREE.Color()),
      prevA = renderer.getClearAlpha(),
      prevSh = renderer.shadowMap.autoUpdate,
      prevNU = renderer.shadowMap.needsUpdate;
    try {
      renderer.autoClear = false;
      renderer.shadowMap.autoUpdate = false;
      renderer.shadowMap.needsUpdate = false;
      renderer.setRenderTarget(hRT);
      renderer.setClearColor(0x000000, 0);
      renderer.clear(true, true, false);
      renderer.render(hLod, hCam);
      renderer.clear(false, true, false);
      renderer.render(hNear, hCam); // full-detail ground wins over the coarse LOD under it
      hBlur.uniforms.tSrc.value = hRT.texture;
      hBlur.uniforms.uDir.value.set(0.55 / 256, 0);
      renderer.setRenderTarget(hB0);
      renderer.render(hQS, hQC);
      hBlur.uniforms.tSrc.value = hB0.texture;
      hBlur.uniforms.uDir.value.set(0, 0.55 / 256);
      renderer.setRenderTarget(hB1);
      renderer.render(hQS, hQC);
    } finally {
      renderer.setRenderTarget(prevRT);
      renderer.autoClear = prevAC;
      renderer.setClearColor(prevCol, prevA);
      renderer.shadowMap.autoUpdate = prevSh;
      renderer.shadowMap.needsUpdate = prevNU;
    }
    hMat.uniforms.uLandY.value = uniforms.uSea.value - 0.05;
    uniforms.uHRect.value.set(cx - h, cz - h, 1 / HC.span, 1);
    HC.cx = cx;
    HC.cz = cz;
    HC.t = 0;
    HC.renders++;
    HC.ms = performance.now() - t0;
  }
  function updateHeights(dt, camera) {
    const r = game.renderer,
      W = game.city && game.city.isWater;
    if (!r || !W) return;
    const p = camera.position;
    HC.t += dt;
    HC.scanT += dt;
    HC.wetT -= dt;
    if (HC.wetT <= 0) {
      HC.wetT = 0.5;
      HC.near =
        p.y < 400 &&
        [
          [0, 0],
          [90, 0],
          [-90, 0],
          [0, 90],
          [0, -90],
          [64, 64],
          [-64, 64],
          [64, -64],
          [-64, -64],
        ].some(([a, b]) => W(p.x + a, p.z + b));
    }
    if (LEAKFIX && (HC.pruneT = (HC.pruneT || 0) + dt) > 2) {
      HC.pruneT = 0;
      pruneProx();
    }
    if (!HC.near) {
      uniforms.uHRect.value.w = 0;
      return;
    }
    if (HC.t < 1.5 && Math.hypot(p.x - HC.cx, p.z - HC.cz) < 24) return;
    if (HC.scanT > 3) {
      HC.scanT = 0;
      scanGround();
    }
    renderHeights(r, p.x, p.z);
  }

  const ocean = {
    mesh,
    material: mat,
    uniforms,
    heights: HC,
    softStats,
    rebuildShore() {
      shoreState = 'none';
    },
    update(dt, camera, env) {
      uniforms.uTime.value += dt;
      const wnd = game.wind;
      if (wnd) {
        const g = 0.55 + 1.05 * wnd.gust;
        uniforms.uWindOff.value.x += wnd.dir.x * wnd.speed * g * dt * 0.12;
        uniforms.uWindOff.value.y += wnd.dir.y * wnd.speed * g * dt * 0.12;
        uniforms.uWindChop.value +=
          (THREE.MathUtils.clamp(0.72 + 0.07 * wnd.speed + 0.12 * wnd.gust, 0.7, 1.7) -
            uniforms.uWindChop.value) *
          Math.min(1, dt * 0.8);
      }
      // follow the camera, snapped (normals are world-space so snapping is invisible)
      mesh.position.set(
        Math.round(camera.position.x / 200) * 200,
        game.city?.seaLevel ?? env.seaLevel ?? -0.12,
        Math.round(camera.position.z / 200) * 200,
      );
      // lighting
      uniforms.uSea.value = mesh.position.y;
      if (WADER) {
        const P = game.player,
          v = P?.state?.inVehicle ? P.state.vehicle : null,
          q = v ? v.mesh?.position || v.group?.position || v.position || P.position : P?.position;
        const sp = v ? 0 : Math.hypot(P.velocity?.x || 0, P.velocity?.z || 0);
        if (q)
          uniforms.uWader.value.set(q.x, q.z, v ? 3.2 : 0.75, 0.35 + 0.65 * Math.min(1, sp / 3));
        else uniforms.uWader.value.w = 0;
      }
      try {
        updateHeights(dt, camera);
      } catch (e) {
        uniforms.uHRect.value.w = 0;
        if (!HC.err) {
          HC.err = true;
          console.warn('[ocean] height cascade off', e);
        }
      }
      const h = env.hemi,
        s = env.sun;
      uniforms.uAmbient.value.copy(h.color).multiplyScalar(h.intensity * 0.9);
      uniforms.uSunCol.value.copy(s.color).multiplyScalar(s.intensity);
      if (shoreState === 'none' && game.city) {
        shoreState = 'pending';
        shoreJob = buildShore(game.city);
      }
      if (shoreJob) {
        const t0 = performance.now();
        try {
          while (performance.now() - t0 < 1.5) {
            const r = shoreJob.next();
            if (r.done) {
              shoreState = r.value ? 'ok' : 'nodata';
              shoreJob = null;
              break;
            }
          }
        } catch (e) {
          shoreState = 'error';
          shoreJob = null;
          console.warn('[ocean] shore field failed', e);
        }
      }
    },
  };
  return ocean;
}
