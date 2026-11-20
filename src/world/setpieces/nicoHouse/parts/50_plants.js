// Nico's house, part 50: the planting. Coconut palms (ring-scarred leaning trunks, crowns of fronds built from a curved
// rachis with individual drooping leaflets, dead hanging fronds, coconuts, fiber boots), two sea grapes with their big
// round red-veined leaves, magenta and orange bougainvillea (woody canes, leaves, thousands of papery bracts, fallen
// petals), saw palmetto, silver buttonwood, crotons and ti plants, railroad vine and sea oats along the seawalls,
// periwinkle and weeds at the pile footings, sandspur tufts, leaf litter, coconut husks, fallen fronds, and the potted
// plants on the deck, porch and at grade. Everything sways through one cheap vertex-shader term keyed on a per-vertex /
// per-instance attribute (aSw = tree amplitude, tree phase, branch amplitude, branch phase).
import { PLANTER } from '../yard.data.js';
import { R4, R8, toS, plantClear } from '../r4/plan4.js';
const r4Out = (x, z, pad = 1.0) => R4 && plantClear(...toS(x, z), pad); // r4: nothing grows inside the rebuilt house, decks or stairs
export const order = 50;

export function build(ctx) {
  const { THREE, kit, mat, col } = ctx,
    M = kit.M,
    V3 = THREE.Vector3,
    D = ctx.detail,
    SZ = ctx.plan.stairW.dz || 0; // SZ: the west stair's move (plan.js)
  const R = kit.rng(5051),
    rr = (a, b) => a + (b - a) * R(),
    UP = new V3(0, 1, 0),
    ZERO = [0, 0, 0, 0],
    WHITE = [1, 1, 1];
  const rv = (r, s = 1) => new V3((r() - 0.5) * 2 * s, (r() - 0.5) * 2 * s, (r() - 0.5) * 2 * s);
  const cv = (c, r, a = 0.1) => kit.vary(c, r, a);
  let tris = 0,
    calls = 0;

  // ---------- wind ----------
  const uT = { value: 0 };
  ctx.updaters.push((dt) => {
    uT.value += Math.min(dt, 0.1);
  });
  const PROJECT = `
vec4 mvPosition = vec4( transformed, 1.0 );
#ifdef USE_BATCHING
	mvPosition = batchingMatrix * mvPosition;
#endif
#ifdef USE_INSTANCING
	mvPosition = instanceMatrix * mvPosition;
#endif
{
	vec3 nhP = mvPosition.xyz;
	float nhA = sin( uNhT * 0.83 + nhP.x * 0.09 + nhP.z * 0.06 + aSw.y ) * 0.65 + sin( uNhT * 1.71 + aSw.y * 1.7 ) * 0.35;
	float nhB = sin( uNhT * 1.37 + nhP.x * 0.21 - nhP.z * 0.17 + aSw.w ) * 0.6 + sin( uNhT * 2.9 + aSw.w * 2.3 + nhP.y * 0.5 ) * 0.4;
	float nhF = sin( uNhT * 6.1 + aSw.w * 5.0 + nhP.x * 3.1 + nhP.z * 2.3 );
	mvPosition.xyz += vec3( 0.86, 0.0, 0.5 ) * ( ( nhA + 0.35 ) * aSw.x + nhB * aSw.z ) + vec3( 0.1, 0.3, -0.08 ) * nhF * aSw.z * 0.22;
	mvPosition.y -= abs( nhB ) * 0.25 * aSw.z;
}
mvPosition = modelViewMatrix * mvPosition;
gl_Position = projectionMatrix * mvPosition;
`;
  // o: { tile: per-instance atlas offset, back: light shining through thin leaves }
  const sway = (m, o = {}) => {
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uNhT = uT;
      let v = sh.vertexShader.replace(
        '#include <common>',
        '#include <common>\nattribute vec4 aSw;\nuniform float uNhT;\n' +
          (o.tile ? 'attribute vec2 aTile;\n' : ''),
      );
      if (o.tile)
        v = v.replace(
          '#include <uv_vertex>',
          '#include <uv_vertex>\n#ifdef USE_MAP\n\tvMapUv += aTile;\n#endif\n',
        );
      sh.vertexShader = v.replace('#include <project_vertex>', PROJECT);
      if (o.back)
        sh.fragmentShader = sh.fragmentShader.replace(
          '#include <lights_fragment_end>',
          `#include <lights_fragment_end>
#if NUM_DIR_LIGHTS > 0
	reflectedLight.directDiffuse += directionalLights[ 0 ].color * diffuseColor.rgb * vec3( 0.95, 1.0, 0.4 ) * max( dot( - normal, directionalLights[ 0 ].direction ), 0.0 ) * ${(o.back * 0.3183).toFixed(4)};
#endif`,
        );
    };
    m.customProgramCacheKey = () => 'nhPlant' + (o.tile ? 'T' : '') + (o.back ? 'B' + o.back : '');
    return m;
  };
  const depthFor = (m, o) =>
    sway(
      new THREE.MeshDepthMaterial({
        depthPacking: THREE.RGBADepthPacking,
        map: m.alphaTest > 0 ? m.map : null,
        alphaTest: m.alphaTest,
      }),
      { tile: o.tile },
    );

  // ---------- geometry accumulators ----------
  // r2-keys: the yard sheet has gentle swells (part 05 ctx.yardY); every plant vertex / leaf instance rides on the ground under it
  const GY = ctx.yardY || null,
    onGround = (arr, stride, off) => {
      if (GY) for (let i = off; i < arr.length; i += stride) arr[i + 1] += GY(arr[i], arr[i + 2]);
    };
  class Acc {
    // merged, vertex-colored, with the sway attribute
    constructor() {
      this.p = [];
      this.n = [];
      this.u = [];
      this.c = [];
      this.s = [];
      this.i = [];
      this.k = 0;
    }
    // pts: [Vector3]; rad: (t, len) => radius; o: { seg, col(t, ang, len, mod), sw(p, t), uRep, vLen, mod(t, ang, len), n0 }
    tube(pts, rad, o = {}) {
      const n = pts.length,
        seg = o.seg ?? 6,
        base = this.k,
        T = new V3(),
        N = new V3(),
        B = new V3(),
        pT = new V3(),
        q = new THREE.Quaternion();
      let len = 0;
      for (let i = 0; i < n; i++) {
        if (i === 0) T.subVectors(pts[1], pts[0]);
        else if (i === n - 1) T.subVectors(pts[i], pts[i - 1]);
        else T.subVectors(pts[i + 1], pts[i - 1]);
        T.normalize();
        if (i === 0) {
          if (o.n0) N.copy(o.n0);
          else {
            N.set(1, 0, 0);
            if (Math.abs(T.x) > 0.9) N.set(0, 0, 1);
          }
          N.addScaledVector(T, -N.dot(T)).normalize();
        } else {
          q.setFromUnitVectors(pT, T);
          N.applyQuaternion(q);
          N.addScaledVector(T, -N.dot(T)).normalize();
          len += pts[i].distanceTo(pts[i - 1]);
        }
        pT.copy(T);
        B.crossVectors(T, N);
        const t = i / (n - 1),
          r0 = rad(t, len),
          sw = o.sw ? o.sw(pts[i], t) : ZERO;
        for (let j = 0; j <= seg; j++) {
          const a = (j / seg) * Math.PI * 2,
            ca = Math.cos(a),
            sa = Math.sin(a),
            md = o.mod ? o.mod(t, a, len) : 1,
            r = r0 * md;
          const nx = N.x * ca + B.x * sa,
            ny = N.y * ca + B.y * sa,
            nz = N.z * ca + B.z * sa;
          this.p.push(pts[i].x + nx * r, pts[i].y + ny * r, pts[i].z + nz * r);
          this.n.push(nx, ny, nz);
          this.u.push((j / seg) * (o.uRep ?? 1), len / (o.vLen ?? 1));
          const c = o.col ? o.col(t, a, len, md) : WHITE;
          this.c.push(c[0], c[1], c[2]);
          this.s.push(sw[0], sw[1], sw[2], sw[3]);
        }
      }
      for (let i = 0; i < n - 1; i++)
        for (let j = 0; j < seg; j++) {
          const a = base + i * (seg + 1) + j,
            b = a + seg + 1;
          this.i.push(a, a + 1, b, a + 1, b + 1, b);
        }
      this.k += n * (seg + 1);
      return this;
    }
    geo(g, m4, c, sw) {
      const pa = g.attributes.position,
        na = g.attributes.normal,
        ua = g.attributes.uv,
        base = this.k,
        v = new V3(),
        nm = new THREE.Matrix3().getNormalMatrix(m4);
      for (let i = 0; i < pa.count; i++) {
        v.fromBufferAttribute(pa, i).applyMatrix4(m4);
        this.p.push(v.x, v.y, v.z);
        const s = typeof sw === 'function' ? sw(v) : sw || ZERO;
        this.s.push(s[0], s[1], s[2], s[3]);
        const cc = typeof c === 'function' ? c(pa.getY(i)) : c;
        this.c.push(cc[0], cc[1], cc[2]);
        v.fromBufferAttribute(na, i).applyMatrix3(nm).normalize();
        this.n.push(v.x, v.y, v.z);
        this.u.push(ua ? ua.getX(i) : 0, ua ? ua.getY(i) : 0);
      }
      if (g.index) for (let i = 0; i < g.index.count; i++) this.i.push(base + g.index.getX(i));
      else for (let i = 0; i < pa.count; i++) this.i.push(base + i);
      this.k += pa.count;
      return this;
    }
    mesh(material, name, parent) {
      if (!this.k) return null;
      onGround(this.p, 3, 0);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(this.u, 2));
      g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
      g.setAttribute('aSw', new THREE.Float32BufferAttribute(this.s, 4));
      g.setIndex(new THREE.Uint32BufferAttribute(this.i, 1));
      g.computeBoundingSphere();
      g.computeBoundingBox();
      const m = new THREE.Mesh(g, material);
      m.name = 'plants:' + name;
      m.castShadow = true;
      m.receiveShadow = true;
      m.customDepthMaterial = depthFor(material, {});
      parent.add(m);
      tris += this.i.length / 3;
      calls++;
      return m;
    }
  }
  const TU = (t) => (t % 4) / 4,
    TV = (t) => (3 - (t >> 2)) / 4;
  class Inst {
    // instanced leaves: matrix from a scaled basis, color, sway, atlas tile
    constructor() {
      this.m = [];
      this.c = [];
      this.s = [];
      this.t = [];
    }
    add(p, X, Y, Z, c, sw, tile) {
      this.m.push(X.x, X.y, X.z, 0, Y.x, Y.y, Y.z, 0, Z.x, Z.y, Z.z, 0, p.x, p.y, p.z, 1);
      this.c.push(c[0], c[1], c[2]);
      const s = sw || ZERO;
      this.s.push(s[0], s[1], s[2], s[3]);
      this.t.push(tile != null ? TU(tile) : 0, tile != null ? TV(tile) : 0);
    }
    mesh(geo, material, name, parent, o = {}) {
      const n = this.c.length / 3;
      if (!n) return null;
      onGround(this.m, 16, 12);
      const im = new THREE.InstancedMesh(geo, material, n);
      im.instanceMatrix.array.set(this.m);
      im.instanceMatrix.needsUpdate = true;
      im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.c), 3);
      geo.setAttribute('aSw', new THREE.InstancedBufferAttribute(new Float32Array(this.s), 4));
      if (o.tile)
        geo.setAttribute('aTile', new THREE.InstancedBufferAttribute(new Float32Array(this.t), 2));
      im.name = 'plants:' + name;
      im.castShadow = o.cast ?? true;
      im.receiveShadow = true;
      im.customDepthMaterial = depthFor(material, o);
      im.computeBoundingSphere();
      im.computeBoundingBox();
      parent.add(im);
      tris += n * (geo.index.count / 3);
      calls++;
      return im;
    }
  }
  const Lx = new V3(),
    Ly = new V3(),
    Lz = new V3();
  // one leaf: base p, length direction d, facing hint nh, width w, length l, bend / cup depth b
  const leaf = (inst, p, d, nh, w, l, b, c, sw, tile) => {
    Ly.copy(d).normalize();
    Lz.copy(nh).addScaledVector(Ly, -nh.dot(Ly));
    if (Lz.lengthSq() < 1e-5) Lz.set(Ly.y, -Ly.x, 0.3).addScaledVector(Ly, -Lz.dot(Ly));
    Lz.normalize();
    Lx.crossVectors(Ly, Lz);
    inst.add(p, Lx.multiplyScalar(w), Ly.multiplyScalar(l), Lz.multiplyScalar(b), c, sw, tile);
  };
  const mkGeo = (p, u, ix, tileUV = true) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    g.setAttribute(
      'uv',
      new THREE.Float32BufferAttribute(tileUV ? u.map((v) => (0.03 + 0.94 * v) * 0.25) : u, 2),
    );
    g.setIndex(ix);
    g.computeVertexNormals();
    return g;
  };

  // ---------- leaf geometries (unit size; instances scale them) ----------
  const leafletGeo = (() => {
    // palm leaflet: reduplicate fold, tapering, tip bending to -Z
    const p = [],
      u = [],
      ix = [],
      W = [0.78, 1, 0.07],
      V = [0, 0.52, 1];
    for (let i = 0; i < 3; i++) {
      const v = V[i];
      for (const s of [-1, 0, 1]) {
        p.push(s * 0.5 * W[i], v * (1 - 0.1 * v * v), -v * v - Math.abs(s) * 0.05);
        u.push(0.5 + s * 0.5, v);
      }
    }
    for (let i = 0; i < 2; i++) {
      const a = i * 3;
      ix.push(a, a + 1, a + 4, a, a + 4, a + 3, a + 1, a + 2, a + 5, a + 1, a + 5, a + 4);
    }
    return mkGeo(p, u, ix, false);
  })();
  const kiteGeo = mkGeo(
    [0, 0, 0, -0.5, 0.42, 0.1, 0.5, 0.42, 0.1, 0, 1, -0.1],
    [0.5, 0, 0, 0.42, 1, 0.42, 0.5, 1],
    [0, 2, 1, 1, 2, 3],
  );
  const quadGeo = mkGeo(
    [-0.5, 0, 0.16, 0, 0, 0, 0.5, 0, 0.16, -0.5, 1, 0.16, 0, 1, 0, 0.5, 1, 0.16],
    [0, 0, 0.5, 0, 1, 0, 0, 1, 0.5, 1, 1, 1],
    [0, 1, 4, 0, 4, 3, 1, 2, 5, 1, 5, 4],
  );
  const stripGeo = (() => {
    const p = [],
      u = [],
      ix = [];
    for (let i = 0; i <= 4; i++) {
      const v = i / 4;
      p.push(-0.5, v, -v * v, 0.5, v, -v * v);
      u.push(0, v, 1, v);
    }
    for (let i = 0; i < 4; i++) {
      const a = i * 2;
      ix.push(a, a + 1, a + 3, a, a + 3, a + 2);
    }
    return mkGeo(p, u, ix);
  })();
  const discGeo = (() => {
    // sea grape leaf: wavy, cupped disc, petiole at the origin
    const p = [0, 0.5, -0.05],
      u = [0.5, 0.5],
      ix = [],
      N = 10;
    for (let j = 0; j < N; j++) {
      const a = (j / N) * Math.PI * 2,
        x = Math.sin(a) * 0.5,
        y = 0.5 - Math.cos(a) * 0.5;
      p.push(x, y, 0.09 * Math.cos(a * 2) + 0.045 * Math.sin(a * 3 + 1));
      u.push(0.5 + x, y);
      ix.push(0, 1 + j, 1 + ((j + 1) % N));
    }
    return mkGeo(p, u, ix);
  })();
  const tuftGeo = (() => {
    // grass tuft: 6 curved tapering blades
    const p = [],
      n = [],
      u = [],
      ix = [],
      r = kit.rng(31);
    let k = 0;
    for (let b = 0; b < 9; b++) {
      const az = (b / 9) * 6.28 * 2 + r() * 0.8,
        lean = 0.12 + r() * 0.95,
        h = 0.5 + r() * 0.5,
        w = 0.045 + r() * 0.03,
        ox = Math.cos(az) * 0.12 * r(),
        oz = Math.sin(az) * 0.12 * r(),
        sx = -Math.sin(az),
        sz = Math.cos(az);
      for (let i = 0; i <= 2; i++) {
        const t = i / 2,
          out = lean * t * t * h * 0.9 + t * lean * 0.15,
          y = h * t * (1 - 0.25 * lean * t),
          ww = w * (1 - t * 0.9) * 0.5;
        for (const s of [-1, 1]) {
          p.push(ox + Math.cos(az) * out + sx * ww * s, y, oz + Math.sin(az) * out + sz * ww * s);
          n.push(Math.cos(az) * 0.45, 0.85, Math.sin(az) * 0.45);
          u.push(0.5 + s * 0.42, 0.02 + t * 0.96);
        }
      }
      for (let i = 0; i < 2; i++) {
        const a = k + i * 2;
        ix.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
      k += 6;
    }
    const g = mkGeo(p, u, ix);
    g.setAttribute('normal', new THREE.Float32BufferAttribute(n, 3));
    return g;
  })();
  const fanGeo = (() => {
    // saw palmetto fan: pleated segments joined to mid length, free pointed tips
    const p = [],
      u = [],
      ix = [],
      NS = 16,
      span = 3.9;
    let k = 0;
    for (let s = 0; s < NS; s++) {
      const a0 = -span / 2 + (s / NS) * span,
        a1 = a0 + span / NS,
        am = (a0 + a1) / 2,
        L = 0.7 + 0.3 * Math.cos(am * 0.8),
        zf = 0.035;
      const P2 = (a, rad, z) => p.push(Math.sin(a) * rad, Math.cos(a) * rad, z);
      P2(a0, 0.03, 0);
      P2(am, 0.03, 0);
      P2(a1, 0.03, 0);
      P2(a0 + 0.012, 0.55 * L, zf);
      P2(am, 0.56 * L, -zf);
      P2(a1 - 0.012, 0.55 * L, zf);
      P2(am, L, -0.05 - 0.05 * am * am);
      u.push(0.1, 0, 0.5, 0, 0.9, 0, 0, 0.55, 0.5, 0.55, 1, 0.55, 0.5, 1);
      ix.push(
        k,
        k + 1,
        k + 4,
        k,
        k + 4,
        k + 3,
        k + 1,
        k + 2,
        k + 5,
        k + 1,
        k + 5,
        k + 4,
        k + 3,
        k + 4,
        k + 6,
        k + 4,
        k + 5,
        k + 6,
      );
      k += 7;
    }
    return mkGeo(p, u, ix);
  })();

  // ---------- textures ----------
  const TS = 256;
  const atlas = kit.canvasTex(
    1024,
    1024,
    (g) => {
      const r = kit.rng(77),
        C = TS / 2;
      const rgb = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
      const tile = (i, fn) => {
        g.save();
        g.translate((i % 4) * TS, (i >> 2) * TS);
        g.beginPath();
        g.rect(0, 0, TS, TS);
        g.clip();
        g.lineCap = 'round';
        fn();
        g.restore();
      };
      const speck = (n, cols, a, rad = 3) => {
        for (let i = 0; i < n; i++) {
          g.fillStyle = rgb(cols[(r() * cols.length) | 0], a * r());
          g.beginPath();
          g.arc(r() * TS, r() * TS, 0.5 + r() * rad, 0, 6.3);
          g.fill();
        }
      };
      const lens = (w) => {
        g.beginPath();
        g.moveTo(C, TS - 5);
        g.bezierCurveTo(C - w * TS, TS * 0.74, C - w * TS * 0.8, TS * 0.26, C, 5);
        g.bezierCurveTo(C + w * TS * 0.8, TS * 0.26, C + w * TS, TS * 0.74, C, TS - 5);
        g.closePath();
      };
      const veins = (c, n, len, lw = 1.5) => {
        g.strokeStyle = c;
        g.lineWidth = lw * 2.4;
        g.beginPath();
        g.moveTo(C, TS - 5);
        g.lineTo(C, 8);
        g.stroke();
        g.lineWidth = lw;
        for (let k = 0; k < n; k++)
          for (const s of [-1, 1]) {
            const y0 = TS * (0.92 - (k / n) * 0.74),
              l = len * TS * Math.sin(Math.PI * (0.2 + 0.7 * (1 - k / n)));
            g.beginPath();
            g.moveTo(C, y0);
            g.quadraticCurveTo(C + s * l * 0.6, y0 - l * 0.22, C + s * l, y0 - l * 0.7);
            g.stroke();
          }
      };
      // 0..3 sea grape: opaque round leaf, thick red midrib and curved laterals, blemishes
      const grape = (i, c0, c1, vein, blot) =>
        tile(i, () => {
          const rg = g.createRadialGradient(C, TS * 0.6, 10, C, C, TS * 0.75);
          rg.addColorStop(0, rgb(c0));
          rg.addColorStop(1, rgb(c1));
          g.fillStyle = rg;
          g.fillRect(0, 0, TS, TS);
          speck(240, blot, 0.4, 5);
          speck(26, blot, 0.55, 15);
          g.strokeStyle = rgb(vein);
          g.lineWidth = 6;
          g.beginPath();
          g.moveTo(C, TS);
          g.lineTo(C, 4);
          g.stroke();
          for (let k = 0; k < 6; k++)
            for (const s of [-1, 1]) {
              const y0 = TS * (0.95 - k * 0.145),
                l = TS * (0.55 - Math.abs(k - 1.5) * 0.06);
              g.strokeStyle = rgb(vein);
              g.lineWidth = 3.4 - k * 0.35;
              g.beginPath();
              g.moveTo(C, y0);
              g.quadraticCurveTo(C + s * l * 0.62, y0 - l * 0.1, C + s * l, y0 - l * 0.6);
              g.stroke();
              g.strokeStyle = rgb(vein, 0.45);
              g.lineWidth = 1;
              for (let q = 1; q <= 4; q++) {
                const t = q / 5,
                  x = C + s * l * t * 0.9,
                  y = y0 - l * (0.1 * t + 0.5 * t * t);
                g.beginPath();
                g.moveTo(x, y);
                g.lineTo(x + s * 7, y + 24 + r() * 10);
                g.stroke();
              }
            }
          const eg = g.createRadialGradient(C, C, TS * 0.36, C, C, TS * 0.52);
          eg.addColorStop(0, rgb(vein, 0));
          eg.addColorStop(1, rgb(vein, 0.5));
          g.fillStyle = eg;
          g.fillRect(0, 0, TS, TS);
        });
      grape(
        0,
        [86, 128, 52],
        [50, 92, 38],
        [176, 52, 44],
        [
          [34, 70, 30],
          [110, 150, 70],
          [70, 60, 30],
        ],
      );
      grape(
        1,
        [136, 152, 58],
        [96, 124, 44],
        [196, 70, 44],
        [
          [70, 100, 40],
          [170, 160, 70],
          [120, 80, 40],
        ],
      );
      grape(
        2,
        [186, 84, 36],
        [140, 40, 28],
        [226, 170, 80],
        [
          [120, 30, 24],
          [230, 150, 50],
          [90, 40, 24],
        ],
      );
      grape(
        3,
        [150, 100, 58],
        [104, 68, 40],
        [70, 44, 28],
        [
          [70, 44, 28],
          [170, 130, 84],
          [50, 34, 24],
        ],
      );
      const leafTile = (i, w, c0, c1, vc, extra, edge) =>
        tile(i, () => {
          lens(w);
          g.save();
          g.clip();
          const lg = g.createLinearGradient(0, TS, 0, 0);
          lg.addColorStop(0, rgb(c0));
          lg.addColorStop(1, rgb(c1));
          g.fillStyle = lg;
          g.fillRect(0, 0, TS, TS);
          speck(110, [c0, c1, [c1[0] * 0.6, c1[1] * 0.6, c1[2] * 0.6]], 0.3, 5);
          if (extra) extra();
          veins(rgb(vc, 0.85), 7, w * 0.85);
          g.restore();
          lens(w);
          g.strokeStyle = edge ? rgb(edge) : rgb([c0[0] * 0.6, c0[1] * 0.6, c0[2] * 0.6], 0.85);
          g.lineWidth = edge ? 7 : 2.5;
          g.stroke();
        });
      leafTile(4, 0.44, [60, 108, 44], [96, 148, 60], [158, 190, 110]); // generic broadleaf
      leafTile(5, 0.5, [232, 214, 228], [255, 250, 253], [206, 168, 196]); // bougainvillea bract (tinted per instance)
      leafTile(6, 0.36, [34, 70, 30], [52, 98, 36], [240, 205, 60], () =>
        speck(
          70,
          [
            [236, 196, 40],
            [226, 96, 30],
            [204, 40, 40],
          ],
          0.95,
          15,
        ),
      ); // croton
      tile(7, () => {
        // periwinkle flower
        for (let k = 0; k < 5; k++) {
          g.save();
          g.translate(C, C);
          g.rotate(k * 1.2566 + 0.2);
          const pg = g.createLinearGradient(0, 0, 0, -TS * 0.46);
          pg.addColorStop(0.08, rgb([206, 50, 130]));
          pg.addColorStop(0.34, rgb([240, 128, 190]));
          pg.addColorStop(1, rgb([252, 176, 220]));
          g.fillStyle = pg;
          g.beginPath();
          g.moveTo(0, 0);
          g.bezierCurveTo(-TS * 0.3, -TS * 0.2, -TS * 0.24, -TS * 0.5, 0, -TS * 0.45);
          g.bezierCurveTo(TS * 0.24, -TS * 0.5, TS * 0.3, -TS * 0.2, 0, 0);
          g.fill();
          g.restore();
        }
        g.fillStyle = rgb([150, 20, 80]);
        g.beginPath();
        g.arc(C, C, TS * 0.055, 0, 6.3);
        g.fill();
        g.fillStyle = rgb([245, 225, 120]);
        g.beginPath();
        g.arc(C, C, TS * 0.022, 0, 6.3);
        g.fill();
      });
      leafTile(8, 0.3, [92, 22, 48], [156, 38, 76], [232, 96, 146], () => {
        for (let i = 0; i < 16; i++) {
          g.strokeStyle = rgb(r() > 0.4 ? [226, 70, 124] : [50, 80, 40], 0.5);
          g.lineWidth = 2 + r() * 6;
          const x = C + (r() - 0.5) * 120;
          g.beginPath();
          g.moveTo(C + (x - C) * 0.2, TS);
          g.quadraticCurveTo(x, C, C + (x - C) * 0.2, 0);
          g.stroke();
        }
      }); // ti leaf
      tile(9, () => {
        // grass / fan blade (opaque)
        const lg = g.createLinearGradient(0, TS, 0, 0);
        lg.addColorStop(0, rgb([118, 148, 78]));
        lg.addColorStop(0.6, rgb([170, 186, 104]));
        lg.addColorStop(1, rgb([226, 206, 140]));
        g.fillStyle = lg;
        g.fillRect(0, 0, TS, TS);
        for (let i = 0; i < 70; i++) {
          g.strokeStyle = rgb(r() > 0.5 ? [236, 236, 170] : [70, 96, 44], 0.28 * r());
          g.lineWidth = 1 + r() * 3;
          const x = r() * TS;
          g.beginPath();
          g.moveTo(x, 0);
          g.lineTo(x + (r() - 0.5) * 8, TS);
          g.stroke();
        }
        g.strokeStyle = rgb([228, 232, 160], 0.6);
        g.lineWidth = 7;
        g.beginPath();
        g.moveTo(C, 0);
        g.lineTo(C, TS);
        g.stroke();
        speck(50, [[120, 85, 40]], 0.6, 5);
      });
      tile(10, () => {
        // railroad vine leaf (notched tip)
        const path = () => {
          g.beginPath();
          g.arc(C, C + 4, TS * 0.45, -Math.PI / 2 + 0.2, Math.PI * 1.5 - 0.2);
          g.lineTo(C, TS * 0.2);
          g.closePath();
        };
        path();
        g.save();
        g.clip();
        const lg = g.createLinearGradient(0, TS, 0, 0);
        lg.addColorStop(0, rgb([58, 122, 48]));
        lg.addColorStop(1, rgb([100, 164, 72]));
        g.fillStyle = lg;
        g.fillRect(0, 0, TS, TS);
        speck(
          90,
          [
            [40, 90, 36],
            [130, 180, 90],
          ],
          0.3,
          5,
        );
        veins(rgb([170, 205, 120], 0.85), 6, 0.42);
        g.restore();
        path();
        g.strokeStyle = rgb([36, 76, 30], 0.9);
        g.lineWidth = 2.5;
        g.stroke();
      });
      tile(11, () => {
        // fern frond, half dead
        g.strokeStyle = rgb([112, 92, 44]);
        g.lineWidth = 4;
        g.beginPath();
        g.moveTo(C, TS);
        g.lineTo(C, 4);
        g.stroke();
        for (let k = 0; k < 21; k++)
          for (const s of [-1, 1]) {
            const y = TS * (0.96 - k * 0.044),
              l = TS * 0.47 * (1 - Math.pow(k / 21, 1.8)) * (k < 2 ? 0.7 : 1);
            g.fillStyle = rgb(
              r() < 0.45
                ? [152 + r() * 30, 104 + r() * 20, 54]
                : [112 + r() * 30, 150 + r() * 20, 60],
            );
            g.beginPath();
            g.ellipse(C + s * l * 0.48, y - l * 0.14, l * 0.5, 5.6, -s * 0.3, 0, 6.3);
            g.fill();
          }
      });
      leafTile(
        12,
        0.3,
        [38, 76, 44],
        [54, 98, 58],
        [64, 104, 66],
        () => {
          for (let y = 0; y < TS; y += 9 + r() * 9) {
            g.strokeStyle = rgb([126, 156, 112], 0.75);
            g.lineWidth = 2 + r() * 4;
            g.beginPath();
            g.moveTo(0, y);
            for (let x = 0; x <= TS; x += 16) g.lineTo(x, y + (r() - 0.5) * 8);
            g.stroke();
          }
        },
        [204, 194, 92],
      ); // snake plant
      tile(13, () => {
        // orchid flower
        const pet = (ang, w, l, c) => {
          g.save();
          g.translate(C, C);
          g.rotate(ang);
          g.fillStyle = rgb(c);
          g.beginPath();
          g.ellipse(0, -l * 0.5, w, l * 0.5, 0, 0, 6.3);
          g.fill();
          g.strokeStyle = rgb([200, 150, 200], 0.6);
          g.lineWidth = 1.5;
          g.beginPath();
          g.moveTo(0, 0);
          g.lineTo(0, -l * 0.9);
          g.stroke();
          g.restore();
        };
        pet(0, 20, 118, [240, 224, 245]);
        pet(2.2, 20, 112, [238, 222, 244]);
        pet(-2.2, 20, 112, [238, 222, 244]);
        pet(1.15, 40, 116, [250, 240, 252]);
        pet(-1.15, 40, 116, [250, 240, 252]);
        pet(Math.PI, 26, 72, [190, 40, 130]);
        g.fillStyle = rgb([250, 215, 90]);
        g.beginPath();
        g.arc(C, C + 6, 9, 0, 6.3);
        g.fill();
      });
      tile(14, () => {
        // sea oats seed head
        g.strokeStyle = rgb([172, 142, 82]);
        g.lineWidth = 3;
        g.beginPath();
        g.moveTo(C, TS);
        g.lineTo(C, 10);
        g.stroke();
        for (let k = 0; k < 17; k++) {
          const s = k % 2 ? 1 : -1,
            y = TS * (0.84 - k * 0.047),
            x = C + s * (14 + r() * 48);
          g.strokeStyle = rgb([172, 142, 82]);
          g.lineWidth = 1.3;
          g.beginPath();
          g.moveTo(C, y);
          g.lineTo(x, y + 6);
          g.stroke();
          g.save();
          g.translate(x, y + 17);
          g.rotate(s * 0.25 + (r() - 0.5) * 0.4);
          g.fillStyle = rgb([200 + r() * 30, 166 + r() * 24, 92 + r() * 20]);
          g.beginPath();
          g.ellipse(0, 0, 9.5, 22, 0, 0, 6.3);
          g.fill();
          g.strokeStyle = rgb([150, 114, 60], 0.8);
          g.lineWidth = 1.2;
          for (let c = -3; c <= 3; c++) {
            g.beginPath();
            g.moveTo(-8, c * 5.4 + 3);
            g.lineTo(0, c * 5.4 - 2);
            g.lineTo(8, c * 5.4 + 3);
            g.stroke();
          }
          g.restore();
        }
      });
      leafTile(15, 0.42, [118, 80, 44], [168, 122, 72], [92, 60, 34], () =>
        speck(
          40,
          [
            [78, 50, 30],
            [190, 150, 100],
          ],
          0.8,
          11,
        ),
      ); // dry leaf
    },
    { repeat: false },
  );
  const leafletTex = kit.canvasTex(
    64,
    256,
    (g, w, h) => {
      const r = kit.rng(12),
        lg = g.createLinearGradient(0, h, 0, 0);
      lg.addColorStop(0, '#6f9448');
      lg.addColorStop(0.55, '#7ea452');
      lg.addColorStop(0.9, '#93a85a');
      lg.addColorStop(1, '#b09a5c');
      g.fillStyle = lg;
      g.fillRect(0, 0, w, h);
      for (let i = 0; i < 46; i++) {
        g.strokeStyle = `rgba(${r() > 0.5 ? '190,215,130' : '40,70,30'},${0.1 + r() * 0.22})`;
        g.lineWidth = 0.6 + r() * 1.4;
        const x = r() * w;
        g.beginPath();
        g.moveTo(x, 0);
        g.lineTo(x, h);
        g.stroke();
      }
      g.strokeStyle = 'rgba(214,220,140,0.9)';
      g.lineWidth = 5;
      g.beginPath();
      g.moveTo(w / 2, 0);
      g.lineTo(w / 2, h);
      g.stroke();
      for (let i = 0; i < 30; i++) {
        g.fillStyle = `rgba(120,84,40,${r() * 0.5})`;
        g.beginPath();
        g.ellipse(r() * w, r() * h, 1 + r() * 3, 2 + r() * 8, 0, 0, 6.3);
        g.fill();
      }
    },
    { repeat: false },
  );
  const fiberTex = kit.canvasTex(128, 128, (g, w, h) => {
    const r = kit.rng(19);
    g.fillStyle = '#d8d8d8';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 500; i++) {
      g.strokeStyle = `rgba(${r() > 0.5 ? '255,255,255' : '90,90,90'},${0.08 + r() * 0.2})`;
      g.lineWidth = 0.5 + r() * 1.5;
      const x = r() * w,
        y = r() * h;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + (r() - 0.5) * 6, y + 8 + r() * 30);
      g.stroke();
    }
  });

  // ---------- materials ----------
  const barkMat = (id) =>
    sway(
      new THREE.MeshStandardMaterial({
        map: kit.tex(id + '_diff.jpg', { srgb: true }),
        normalMap: kit.tex(id + '_nor_gl.jpg'),
        roughnessMap: kit.tex(id + '_rough.jpg'),
        vertexColors: true,
        roughness: 1,
        metalness: 0,
        name: 'plants:' + id,
      }),
    );
  const palmBarkM = barkMat('palm_tree_bark'),
    limbM = barkMat('bark_brown_02');
  const stemM = sway(
    new THREE.MeshStandardMaterial({
      map: fiberTex,
      bumpMap: kit.microTex(),
      bumpScale: 0.9,
      vertexColors: true,
      roughness: 0.62,
      metalness: 0,
      name: 'plants:stem',
    }),
  );
  const leafletM = sway(
    new THREE.MeshStandardMaterial({
      map: leafletTex,
      side: THREE.DoubleSide,
      roughness: 0.5,
      metalness: 0,
      name: 'plants:leaflet',
    }),
    { back: 0.3 },
  );
  const atlasM = (rough, back, name) =>
    sway(
      new THREE.MeshStandardMaterial({
        map: atlas,
        alphaTest: 0.5,
        side: THREE.DoubleSide,
        roughness: rough,
        metalness: 0,
        name: 'plants:' + name,
      }),
      { tile: true, back },
    );
  const grapeM = atlasM(0.4, 0.4, 'grape'),
    cardM = atlasM(0.68, 0.55, 'card'),
    grassM = atlasM(0.75, 0.35, 'grass');

  const palmBark = new Acc(),
    limbs = new Acc(),
    stems = new Acc();
  const leaflets = new Inst(),
    discs = new Inst(),
    kites = new Inst(),
    quads = new Inst(),
    strips = new Inst(),
    tufts = new Inst(),
    fans = new Inst();
  const sphere = new THREE.SphereGeometry(1, 7, 5),
    ico = new THREE.IcosahedronGeometry(1, 0);

  // ---------- where ground plants may not grow ----------
  const driveHalf = (z) => 4.3 + Math.max(0, z - 19) * 0.36;
  const blocked = (x, z, pad = 0) =>
    r4Out(x, z, pad + 0.4) ||
    x < -23.8 ||
    x > 11.1 ||
    z < -13.9 ||
    z > 26.6 ||
    (z > 4.6 - pad && Math.abs(x + 3) < driveHalf(z) + pad) ||
    (x > -8.9 - pad && x < 6.9 + pad && z > -6.7 - pad && z < 5.5 + pad) ||
    (x > -12.1 - pad && x < -10.3 + pad && z > 2.7 - pad && z < 7.4 + pad) ||
    (x > -0.1 - pad && x < 6.2 + pad && z > -7.9 - pad && z < -6.2 + pad) ||
    (x > 2.3 && x < 6.3 && z > 5.4 && z < 6.9) ||
    (x > 0.4 && x < 3.2 && z < -7.5) ||
    Math.hypot(x + 15.5, z - 16.5) < 1.3;

  // ---------- coconut palm ----------
  const frond = (o) => {
    const r = o.r,
      n = 13,
      pts = [],
      S0 = new V3(-Math.sin(o.az), 0, Math.cos(o.az)),
      p = o.base.clone().add(new V3(Math.cos(o.az) * 0.1, 0, Math.sin(o.az) * 0.1));
    const tw = (r() - 0.5) * 0.5,
      ph = r() * 6.28,
      ds = o.L / n;
    for (let i = 0; i <= n; i++) {
      pts.push(p.clone());
      const s = i / n,
        th = o.el - o.droop * Math.pow(s, 1.6),
        a = o.az + tw * s;
      p.x += Math.cos(th) * Math.cos(a) * ds;
      p.z += Math.cos(th) * Math.sin(a) * ds;
      p.y += Math.sin(th) * ds;
      if (o.flat) p.y = o.base.y;
    }
    const swf = (t) => [o.tree[0], o.tree[1], o.amp * Math.pow(t, 1.5), ph];
    const rc0 = o.dead ? [0.36, 0.26, 0.16] : o.age > 0.85 ? [0.5, 0.45, 0.14] : [0.36, 0.44, 0.12],
      rc1 = o.dead ? [0.3, 0.21, 0.12] : [0.2, 0.36, 0.08],
      k = o.L / 4.8;
    stems.tube(
      pts,
      (t) => (0.006 + 0.03 * Math.pow(1 - t, 0.8) + 0.024 * Math.exp(-t / 0.04)) * k,
      {
        seg: 5,
        col: (t) => kit.mix(rc0, rc1, t),
        sw: (q, t) => swf(t),
        n0: S0,
        mod: (t, a) => 0.55 + 0.45 * Math.abs(Math.cos(a)),
        vLen: 0.4,
      },
    );
    const nL = o.dead ? 26 : o.nL,
      T = new V3(),
      q = new V3(),
      d = new V3(),
      Nf = new V3(),
      Ll = 0.195 * o.L,
      hint = new V3();
    for (let j = 0; j < nL; j++)
      for (const s of [-1, 1]) {
        if (o.dead && r() < 0.3) continue;
        const t = 0.15 + (0.85 * (j + 0.3 + r() * 0.4)) / nL,
          f = t * n,
          i = Math.min(n - 1, Math.floor(f));
        q.lerpVectors(pts[i], pts[i + 1], f - i);
        T.subVectors(pts[i + 1], pts[i]).normalize();
        Nf.crossVectors(S0, T);
        const fw = 0.4 + 0.3 * t + (r() - 0.5) * 0.16,
          len =
            Ll *
            (0.5 + 0.5 * Math.sin(Math.PI * Math.min(1, t * 0.95 + 0.1))) *
            (1 - 0.55 * t * t * t) *
            (0.88 + r() * 0.24) *
            (o.dead ? 0.8 : 1);
        d.copy(S0)
          .multiplyScalar(s * Math.cos(fw))
          .addScaledVector(T, Math.sin(fw));
        if (o.flat) d.y = -0.015;
        else {
          d.addScaledVector(Nf, 0.32 - 0.3 * t);
          d.y -= (0.32 + 0.6 * o.age + (o.dead ? 0.9 : 0)) * (0.7 + r() * 0.6);
        }
        const br = 0.85 + r() * 0.3,
          c = o.dead
            ? [1.6 * br, 0.58 * br, 0.9 * br]
            : o.age > 0.85
              ? [1.2 * br, 0.92 * br, 0.4]
              : o.age < 0.25
                ? [0.6 * br, 0.82 * br, 0.42]
                : [0.4 * br, 0.6 * br, 0.34 * br];
        if (!o.dead && r() < 0.04) {
          c[0] = 1.6;
          c[1] = 0.62;
          c[2] = 0.8;
        }
        hint.copy(UP);
        if (o.dead) hint.set(r() - 0.5, 0.3, r() - 0.5);
        const sw = swf(t);
        sw[2] += 0.012;
        leaf(
          leaflets,
          q,
          d,
          hint,
          (o.dead ? 0.034 : 0.064) * (0.85 + r() * 0.3) * Math.max(0.7, k),
          len,
          len * (o.flat ? 0.03 : 0.2 + 0.3 * o.age + r() * 0.14),
          c,
          o.flat ? ZERO : sw,
        );
      }
    return pts;
  };
  const palms = {};
  const palm = (o) => {
    if (r4Out(o.x, o.z, 1.6)) return;
    const r = kit.rng(o.seed),
      H = o.H,
      phase = r() * 6.28,
      ampTop = o.young ? 0.03 : 0.05 + H * 0.016,
      dx = Math.cos(o.az),
      dz = Math.sin(o.az),
      rB = o.rad ?? 0.15;
    const pts = [],
      n = Math.round((H + 0.3) / 0.05),
      ds = (H + 0.3) / n,
      p = new V3(o.x, -0.3, o.z);
    for (let i = 0; i <= n; i++) {
      const s = i / n,
        th = o.lean * (Math.pow(1 - s, 1.25) * 1.5 - 0.12 * s) + Math.sin(s * 5 + phase) * 0.014;
      pts.push(p.clone());
      p.x += Math.sin(th) * dx * ds;
      p.z += Math.sin(th) * dz * ds;
      p.y += Math.cos(th) * ds;
    }
    const at = (y) => {
      for (let i = 1; i <= n; i++)
        if (pts[i].y >= y) {
          const a = pts[i - 1],
            b = pts[i];
          return a.clone().lerp(b, (y - a.y) / (b.y - a.y));
        }
      return pts[n].clone();
    };
    const radAt = (t, len) =>
      rB * (1 - 0.22 * t) + 0.13 * Math.exp(-Math.max(0, len - 0.3) / 0.42) * (rB / 0.15);
    const tone = cv([1.08, 1.04, 0.98], r, 0.06);
    // shared vegetation system (game.vegetation, passed in as opts.vegetation): its coconut palm replaces the trunk and crown
    // built here; colliders, litter and the trunk curve used by the hammock stay
    let vegPalm = false;
    const veg = ctx.opts.vegetation;
    if (veg?.build && !o.young) {
      try {
        const off = o.lean * H * 0.55;
        const g = veg.build('coconut', {
          seed: o.seed * 7919 + 13,
          height: H,
          lean: [dx * off, dz * off],
        });
        g.position.set(o.x, -0.05, o.z);
        g.traverse((m) => {
          if (m.isMesh) {
            m.castShadow = true;
            m.receiveShadow = true;
          }
        });
        g.name = 'vegPalm:' + o.id;
        ctx.groups.ext.add(g);
        vegPalm = true;
      } catch (e) {
        console.warn('[nicoHouse] vegetation palm failed, using own model', e);
      }
    }
    if (!vegPalm) {
      palmBark.tube(pts, radAt, {
        seg: 9,
        uRep: 2,
        vLen: 1.1,
        sw: (q, t) => [ampTop * t * t, phase, 0, 0],
        mod: (t, a, len) => {
          const ring = (len / 0.1 + 0.2 * Math.sin(a + phase) + 0.07 * Math.sin(a * 3)) % 1,
            tri = ring < 0.5 ? ring * 2 : 2 - ring * 2;
          return (
            1 +
            0.045 * tri +
            0.09 * Math.sin(a * 7 + phase) * Math.exp(-Math.max(0, len - 0.3) / 0.14)
          );
        },
        col: (t, a, len, md) => {
          const k =
            (0.74 + (md - 1) * 9) *
            (0.9 + 0.14 * Math.sin(len * 1.7 + a * 2 + phase)) *
            (len < 1.0 ? 0.72 + 0.28 * len : 1) *
            (1 - 0.25 * Math.pow(t, 6));
          return [tone[0] * k, tone[1] * k, tone[2] * k * (1 + 0.08 * Math.sin(len * 0.9 + a))];
        },
      });
      const top = pts[n],
        tdir = new V3().subVectors(pts[n], pts[n - 4]).normalize(),
        tree = [ampTop, phase],
        rT = rB * 0.78;
      const radial = (az) => new V3(Math.cos(az), 0, Math.sin(az));
      if (!o.young) {
        // brown fiber sleeve and old leaf bases under the crown
        palmBark.tube(pts.slice(n - 13), () => rT * 1.24, {
          seg: 10,
          uRep: 2,
          vLen: 0.5,
          sw: () => [ampTop, phase, 0, 0],
          mod: (t, a, len) =>
            (1 + 0.1 * Math.sin(a * 5 + len * 22) + 0.06 * Math.sin(a * 11 - len * 31)) *
            (0.86 + 0.14 * Math.sin(Math.PI * Math.min(1, t * 1.2))),
          col: (t, a, len) => {
            const k = 0.6 + 0.3 * Math.sin(a * 5 + len * 22);
            return [0.62 * k, 0.44 * k, 0.3 * k];
          },
        });
        for (let b = 0; b < 11; b++) {
          const az = b * 2.4 + phase,
            a = top
              .clone()
              .addScaledVector(tdir, -0.12 - (b / 11) * 0.55)
              .addScaledVector(radial(az), rT * 1.1),
            e = a
              .clone()
              .addScaledVector(radial(az), 0.2 + r() * 0.1)
              .addScaledVector(tdir, 0.26 + r() * 0.12);
          palmBark.tube([a, e], (t) => 0.055 - 0.02 * t, {
            seg: 5,
            vLen: 0.3,
            n0: new V3(-Math.sin(az), 0, Math.cos(az)),
            mod: (t, an) => 0.4 + 0.6 * Math.abs(Math.cos(an)),
            sw: () => [ampTop, phase, 0, 0],
            col: () => cv([0.56, 0.42, 0.28], r, 0.15),
          });
        }
        // coconuts: a couple of hanging clusters, green to ripe yellow to dry brown
        for (let c = 0; c < (o.nuts ?? 3); c++) {
          const az = r() * 6.28,
            nn = 3 + ((r() * 4) | 0),
            ripe = r(),
            root = top.clone().addScaledVector(tdir, -0.16).addScaledVector(radial(az), rT);
          for (let j = 0; j < nn; j++) {
            const q = top
              .clone()
              .addScaledVector(radial(az + (j - nn / 2) * 0.34), rT + 0.16 + r() * 0.14);
            q.y -= 0.34 + r() * 0.24;
            const c3 =
              ripe < 0.45
                ? cv([0.22, 0.34, 0.07], r, 0.15)
                : ripe < 0.8
                  ? cv([0.5, 0.36, 0.07], r, 0.15)
                  : cv([0.2, 0.13, 0.07], r, 0.15);
            stems.geo(
              sphere,
              M(q.x, q.y, q.z, (r() - 0.5) * 0.8, r() * 6.28, (r() - 0.5) * 0.8, 0.1, 0.13, 0.1),
              (y) => kit.mul(c3, 0.8 + 0.25 * y),
              [ampTop, phase, 0.01, j],
            );
            stems.tube(
              [
                root,
                root
                  .clone()
                  .lerp(q, 0.5)
                  .add(new V3(0, 0.06, 0)),
                q.clone().add(new V3(0, 0.12, 0)),
              ],
              () => 0.011,
              { seg: 4, col: () => [0.34, 0.3, 0.1], sw: () => [ampTop, phase, 0.004, j] },
            );
          }
        }
        // unopened spear leaf
        stems.tube(
          [
            top.clone(),
            top.clone().addScaledVector(tdir, 1.0).add(rv(r, 0.06)),
            top.clone().addScaledVector(tdir, 2.1).add(rv(r, 0.12)),
          ],
          (t) => 0.035 * (1 - t) + 0.006,
          {
            seg: 5,
            col: (t) => kit.mix([0.4, 0.5, 0.16], [0.3, 0.46, 0.12], t),
            sw: (q, t) => [ampTop, phase, 0.08 * t, 1],
          },
        );
      }
      const nF = o.fronds,
        nDead = o.dead ?? 3;
      for (let i = 0; i < nF + nDead; i++) {
        const dead = i >= nF,
          a = dead ? 1 : i / (nF - 1),
          az = i * 2.39996 + phase + (r() - 0.5) * 0.4;
        const el = dead
          ? -0.75 - r() * 0.45
          : (o.young ? 1.42 - 1.25 * a : 1.36 - 1.78 * Math.pow(a, 0.85)) + (r() - 0.5) * 0.2;
        const L =
          o.L *
          (dead
            ? 0.6 + r() * 0.25
            : (0.6 + 0.4 * Math.sin((Math.min(1, a * 1.7 + 0.12) * Math.PI) / 2)) *
              (0.92 + r() * 0.13));
        frond({
          r,
          base: top.clone().addScaledVector(tdir, -0.08 - a * 0.5),
          az,
          el,
          L,
          droop: dead ? 0.45 : 0.75 + 1.0 * a + (r() - 0.5) * 0.25,
          age: a,
          dead,
          tree,
          amp: dead ? 0.1 : 0.1 + 0.16 * a,
          nL: o.nL ?? 46,
        });
      }
    } // end of own trunk and crown (vegPalm false)
    const top = pts[n];
    const radial = (az) => new V3(Math.cos(az), 0, Math.sin(az));
    const tdir = new V3().subVectors(pts[n], pts[n - 4]).normalize();
    const rT = rB * 0.78;
    const tree = [ampTop, phase];
    // colliders, litter, husks
    for (const y of [0.5, 1.5]) {
      const c = at(y);
      col.cyl(c.x, y, c.z, radAt(0, y + 0.3) + 0.04, 1.0, { tag: 'tree' });
    }
    const crown = top.clone();
    for (let i = 0; i < (o.litter ?? 34); i++) {
      const a = r() * 6.28,
        d = 0.4 + r() * 3.2,
        x = o.x + (crown.x - o.x) * 0.5 + Math.cos(a) * d,
        z = o.z + (crown.z - o.z) * 0.5 + Math.sin(a) * d;
      if (blocked(x, z)) continue;
      leaf(
        kites,
        new V3(x, 0.012 + r() * 0.01, z),
        radial(r() * 6.28),
        new V3((r() - 0.5) * 0.3, 1, (r() - 0.5) * 0.3),
        0.05 + r() * 0.05,
        0.1 + r() * 0.12,
        0.03,
        cv([0.95, 0.9, 0.82], r, 0.25),
        ZERO,
        15,
      );
    }
    for (let i = 0; i < (o.husks ?? 3); i++) {
      const a = r() * 6.28,
        d = 0.6 + r() * 2.4,
        x = o.x + Math.cos(a) * d,
        z = o.z + Math.sin(a) * d;
      if (blocked(x, z)) continue;
      const whole = r() < 0.45,
        c3 = whole ? cv([0.21, 0.14, 0.08], r, 0.2) : cv([0.3, 0.22, 0.13], r, 0.2);
      stems.geo(
        sphere,
        M(
          x,
          whole ? 0.085 : 0.03,
          z,
          (r() - 0.5) * 0.6,
          r() * 6.28,
          Math.PI / 2 + (r() - 0.5) * 0.5,
          0.1,
          0.14,
          whole ? 0.1 : 0.05,
        ),
        (y) => kit.mul(c3, 0.75 + 0.35 * Math.abs(y)),
        ZERO,
      );
    }
    palms[o.id] = { at, radAt, top };
  };
  const az2 = (x, z) => Math.atan2(z, x);
  palm({
    id: 'bayA',
    x: -3.0,
    z: -10.5,
    H: 11.2,
    az: az2(0.35, -1),
    lean: 0.2,
    fronds: 22,
    L: 5.0,
    seed: 11,
  });
  palm({
    id: 'hamA',
    x: -9.5,
    z: -9.0,
    H: 9.6,
    az: az2(0.75, -0.6),
    lean: 0.2,
    fronds: 21,
    L: 4.8,
    seed: 12,
  });
  palm({
    id: 'hamB',
    x: -11.96,
    z: -8.15,
    H: 7.6,
    az: az2(-0.95, 0.15),
    lean: 0.24,
    fronds: 19,
    L: 4.4,
    seed: 13,
    nuts: 2,
  });
  palm({
    id: 'ne',
    x: 9.0,
    z: -10.0,
    H: 8.6,
    az: az2(0.75, -0.6),
    lean: 0.3,
    fronds: 20,
    L: 4.6,
    seed: 14,
  });
  palm({
    id: 'se',
    x: 9.3,
    z: 9.0,
    H: 9.8,
    az: az2(0.95, 0.3),
    lean: 0.27,
    fronds: 21,
    L: 4.8,
    seed: 15,
  });
  palm({
    id: 'west',
    x: -17.0,
    z: -2.0,
    H: 10.4,
    az: az2(0.9, 0.38),
    lean: 0.4,
    fronds: 22,
    L: 5.0,
    seed: 16,
  });
  palm({
    id: 'young',
    x: 6.5,
    z: 21.0,
    H: 2.7,
    az: az2(-0.3, 0.9),
    lean: 0.1,
    fronds: 13,
    L: 3.3,
    seed: 17,
    young: true,
    dead: 1,
    rad: 0.17,
    nL: 30,
    litter: 10,
    husks: 0,
  });
  // hammock palms: attachment points on the two trunks at y = 1.5
  if (palms.hamA && palms.hamB) {
    const a = palms.hamA.at(1.5),
      b = palms.hamB.at(1.5); // r7d: either palm may be kept out (bigger west deck, the north-view corridor)
    ctx.anchors.hammockA = {
      pos: a,
      heading: Math.atan2(b.x - a.x, b.z - a.z),
      radius: palms.hamA.radAt(0, 1.8),
    };
    ctx.anchors.hammockB = {
      pos: b,
      heading: Math.atan2(a.x - b.x, a.z - b.z),
      radius: palms.hamB.radAt(0, 1.8),
    };
  }
  // fallen dry fronds
  {
    const r = kit.rng(71);
    frond({
      r,
      base: new V3(-15.6, 0.045, -4.6),
      az: 2.2,
      el: 0,
      L: 4.2,
      droop: 0,
      age: 1,
      dead: true,
      flat: true,
      tree: [0, 0],
      amp: 0,
    });
    frond({
      r,
      base: new V3(8.2, 0.045, 12.6),
      az: -2.4,
      el: 0,
      L: 3.8,
      droop: 0,
      age: 1,
      dead: true,
      flat: true,
      tree: [0, 0],
      amp: 0,
    });
    frond({
      r,
      base: new V3(-6.2, 0.045, -11.8),
      az: 0.4,
      el: 0,
      L: 4.4,
      droop: 0,
      age: 1,
      dead: true,
      flat: true,
      tree: [0, 0],
      amp: 0,
    });
  }

  // ---------- generic woody growth ----------
  const grow = (acc, p0, dir, len, r0, depth, o) => {
    const n = Math.max(3, Math.round(len / o.step)),
      pts = [p0.clone()],
      d = dir.clone(),
      p = p0.clone();
    for (let i = 0; i < n; i++) {
      d.x += (o.r() - 0.5) * o.wander;
      d.y += (o.r() - 0.5) * o.wander + (o.up?.[depth] ?? 0);
      d.z += (o.r() - 0.5) * o.wander;
      d.normalize();
      p.addScaledVector(d, len / n);
      if (p.y < (o.minY ?? 0.2) && depth > 0) {
        p.y = o.minY ?? 0.2;
        d.y = Math.abs(d.y) + 0.2;
      }
      if (o.bound) o.bound(p);
      pts.push(p.clone());
    }
    const r1 = r0 * (o.taper ?? 0.74),
      last = depth >= o.depth;
    acc.tube(pts, (t) => (last ? r0 * (1 - t * 0.8) : r0 + (r1 - r0) * t), {
      seg: depth === 0 ? 8 : depth === 1 ? 6 : 4,
      col: o.col,
      sw: o.sw,
      uRep: depth < 2 ? 2 : 1,
      vLen: 0.5,
    });
    if (depth >= o.depth - 1)
      for (let i = last ? 1 : Math.ceil(n / 2); i <= n; i++)
        o.sites.push({ p: pts[i], d: d.clone() });
    if (last) return;
    const k = o.fork(depth);
    for (let j = 0; j < k; j++) {
      const ax = rv(o.r).cross(d).normalize(),
        cd = d.clone().applyAxisAngle(ax, o.spread * (0.6 + o.r() * 0.8) * (j === 0 ? 0.45 : 1));
      grow(
        acc,
        p,
        cd,
        len * o.lenK * (0.8 + o.r() * 0.4),
        r1 * (j === 0 ? 0.92 : 0.74),
        depth + 1,
        o,
      );
    }
  };

  // ---------- sea grape ----------
  const seaGrape = (x, z, o) => {
    if (r4Out(x, z, 2.0)) return;
    const r = kit.rng(o.seed),
      phase = r() * 6.28,
      sites = [],
      H = o.H,
      ctr = new V3(x, H * 0.45, z);
    const sw = (p) => [o.amp * Math.pow(Math.max(0, p.y) / H, 1.5), phase, 0, 0];
    const tone = cv([1.7, 1.55, 1.5], r, 0.05);
    const G = {
      r,
      step: 0.24,
      wander: 0.34,
      up: [0.05, 0.14, 0.2, 0.14],
      depth: 3,
      lenK: 0.72,
      spread: 0.75,
      fork: (d) => (d === 0 ? 2 + (r() < 0.6 ? 1 : 0) : 2 + (r() < 0.35 ? 1 : 0)),
      sites,
      sw,
      bound: o.bound,
      minY: 0.3,
      col: (t, a, len) => {
        const k = 0.8 + 0.3 * Math.sin(len * 5 + a * 2 + phase) * Math.sin(len * 2.3 + a);
        return [tone[0] * k, tone[1] * k, tone[2] * k * 0.96];
      },
    };
    for (let i = 0; i < o.trunks; i++) {
      const az = o.az0 + (i / o.trunks) * o.arc + (r() - 0.5) * 0.5,
        inc = 0.35 + r() * 0.5;
      grow(
        limbs,
        new V3(x + Math.cos(az) * 0.14, -0.15, z + Math.sin(az) * 0.14),
        new V3(Math.sin(inc) * Math.cos(az), Math.cos(inc), Math.sin(inc) * Math.sin(az)),
        o.len * (0.85 + r() * 0.3),
        o.rad * (0.8 + r() * 0.35),
        0,
        G,
      );
    }
    const per = o.leaves / sites.length,
      q = new V3(),
      d = new V3(),
      nh = new V3(),
      out = new V3();
    for (const s of sites) {
      const nl = Math.floor(per) + (r() < per % 1 ? 1 : 0);
      for (let i = 0; i < nl; i++) {
        q.copy(s.p).add(rv(r, 0.34));
        if (o.ok && !o.ok(q)) continue;
        if (q.y < 0.35) q.y = 0.35 + r() * 0.3;
        out.subVectors(q, ctr).normalize();
        d.copy(out).multiplyScalar(0.6).add(rv(r, 0.8));
        d.y -= 0.1;
        nh.copy(UP).multiplyScalar(0.9).addScaledVector(out, 0.55).add(rv(r, 0.55));
        const size = 0.17 + r() * 0.11,
          t = r(),
          tile = t < 0.76 ? 0 : t < 0.91 ? 1 : t < 0.97 ? 2 : 3,
          b = 0.72 + r() * 0.5;
        leaf(
          discs,
          q,
          d,
          nh,
          size * 1.06,
          size,
          size,
          [b, b, b],
          [sw(q)[0], phase, 0.014, r() * 6.28],
          tile,
        );
      }
      // grape racemes
      if (r() < o.grapes) {
        const g0 = s.p.clone().add(rv(r, 0.1)),
          n = 9 + ((r() * 6) | 0),
          ripe = r() < 0.4,
          sg = [sw(g0)[0], phase, 0.01, r() * 6];
        stems.tube(
          [g0, g0.clone().add(new V3(0.02, -0.12, 0)), g0.clone().add(new V3(0.03, -0.26, 0.01))],
          () => 0.003,
          { seg: 3, col: () => [0.3, 0.36, 0.14], sw: () => sg },
        );
        for (let j = 0; j < n; j++) {
          const y = -0.05 - (j / n) * 0.21,
            a = j * 2.4,
            rad = 0.011 + r() * 0.004,
            c3 =
              ripe && r() < 0.6 ? cv([0.22, 0.05, 0.16], r, 0.2) : cv([0.34, 0.46, 0.12], r, 0.15);
          stems.geo(
            ico,
            M(
              g0.x + Math.cos(a) * 0.017 + 0.02,
              g0.y + y,
              g0.z + Math.sin(a) * 0.017,
              0,
              r() * 3,
              0,
              rad,
            ),
            c3,
            sg,
          );
        }
      }
    }
    // fallen leaves beneath
    for (let i = 0; i < o.fallen; i++) {
      const a = r() * 6.28,
        dd = Math.sqrt(r()) * o.H * 0.75,
        fx = x + Math.cos(a) * dd,
        fz = z + Math.sin(a) * dd;
      if (fx > 11.2 || fz < -13.9 || (fx < 6.85 && fz < 5.6 && fx > -9)) continue;
      const size = 0.14 + r() * 0.1,
        b = 0.7 + r() * 0.5;
      leaf(
        discs,
        new V3(fx, 0.014 + r() * 0.012, fz),
        new V3(Math.cos(a * 7), 0, Math.sin(a * 7)),
        new V3((r() - 0.5) * 0.35, 1, (r() - 0.5) * 0.35),
        size,
        size,
        size * 0.5,
        [b, b, b],
        ZERO,
        r() < 0.62 ? 3 : r() < 0.7 ? 2 : 1,
      );
    }
    col.cyl(x, 0.7, z, 0.34, 1.4, { tag: 'tree' });
  };
  seaGrape(9.2, 1.5, {
    seed: 21,
    H: 4.7,
    trunks: 5,
    az0: -1.9,
    arc: 4.3,
    len: 2.15,
    rad: 0.14,
    leaves: 3300,
    amp: 0.05,
    grapes: 0.07,
    fallen: 230,
    bound: (p) => {
      if (p.x < 8.45) p.x = 8.45;
      if (p.y > 4.8) p.y = 4.8;
    },
    ok: (q) => q.x > 8.4,
  }); // clear of the east deck rail (x 8.1): playtest H2
  seaGrape(-13.0, -11.0, {
    seed: 22,
    H: 2.7,
    trunks: 4,
    az0: 0,
    arc: 6.28,
    len: 1.2,
    rad: 0.085,
    leaves: 1000,
    amp: 0.035,
    grapes: 0.05,
    fallen: 70,
    bound: (p) => {
      if (p.z < -13.6) p.z = -13.6;
      if (p.y > 2.9) p.y = 2.9;
    },
  });

  // ---------- bougainvillea ----------
  const bougainvillea = (o) => {
    if (o.base && r4Out(o.base[0], o.base[1], 1.0)) return;
    const r = kit.rng(o.seed),
      phase = r() * 6.28,
      q = new V3(),
      d = new V3(),
      nh = new V3(),
      e1 = new V3(),
      e2 = new V3(),
      ax = new V3();
    const sw = (p) => [
      0.01 + 0.03 * Math.max(0, p.y - 1.2),
      phase,
      0.012,
      phase + p.x * 2 + p.z * 1.3,
    ];
    const bark = cv([1.45, 1.3, 1.15], r, 0.05);
    for (let c = 0; c < o.canes; c++) {
      const sup = o.supports[c % o.supports.length],
        top = o.top * (0.55 + 0.45 * r()),
        pts = [],
        bx = o.base[0] + (r() - 0.5) * 0.3,
        bz = o.base[1] + (r() - 0.5) * 0.3,
        nUp = 5;
      for (let i = 0; i <= nUp; i++) {
        const s = i / nUp,
          k = Math.min(1, s * 2.4);
        q.set(
          bx + (sup[0] - bx) * k + (r() - 0.5) * 0.09,
          -0.05 + (top + 0.05) * s,
          bz + (sup[1] - bz) * k + (r() - 0.5) * 0.09,
        );
        if (i > 1) o.bound(q);
        pts.push(q.clone());
      }
      const az = o.az(r),
        L = (0.5 + r()) * o.reach,
        na = 7;
      let th = 0.5 + r() * 0.6;
      const a = pts[nUp].clone();
      for (let i = 1; i <= na; i++) {
        th -= 0.18 + r() * 0.24;
        const ds = L / na;
        a.x += Math.cos(th) * Math.cos(az) * ds;
        a.z += Math.cos(th) * Math.sin(az) * ds;
        a.y += Math.sin(th) * ds;
        if (a.y < 0.3) a.y = 0.3;
        o.bound(a);
        pts.push(a.clone());
      }
      limbs.tube(pts, (t) => 0.004 + 0.015 * (1 - t) * (1 - t), {
        seg: 5,
        vLen: 0.3,
        sw,
        col: (t, an, len) =>
          kit.mul(bark, (0.75 + 0.25 * Math.sin(len * 9 + an)) * (t > 0.6 ? 0.8 : 1)),
      });
      for (let i = 1; i < nUp; i++)
        for (let k = 0; k < 2; k++) {
          const b = pts[i].clone().lerp(pts[i + 1], r()),
            e = b.clone().add(rv(r, 0.02).setY((r() - 0.3) * 0.02));
          limbs.tube([b, e.clone().lerp(b, 0.5), e], (t) => 0.004 * (1 - t) + 0.0006, {
            seg: 3,
            col: () => [1.2, 1.0, 0.8],
            sw,
          });
        } // thorns
      for (let i = 1; i < pts.length; i++) {
        const b = pts[i];
        for (let l = 0; l < (i < nUp - 1 ? o.leaves * 0.35 : o.leaves); l++) {
          q.copy(b).add(rv(r, 0.2));
          o.bound(q);
          d.copy(rv(r, 1));
          d.y = Math.abs(d.y) * 0.4 - 0.25;
          nh.set(r() - 0.5, 1, r() - 0.5);
          const l2 = 0.075 + r() * 0.055,
            g = 0.55 + r() * 0.45;
          leaf(
            kites,
            q,
            d,
            nh,
            l2 * 0.78,
            l2,
            l2 * 0.5,
            [g * (0.85 + r() * 0.2), g, g * 0.8],
            sw(q),
            4,
          );
        }
        if (i < nUp) continue;
        for (let s2 = 0; s2 < o.shoots; s2++) {
          d.set(r() - 0.5, r() * 1.1 - 0.25, r() - 0.5).normalize();
          const len = 0.18 + r() * 0.32,
            tip = b.clone().addScaledVector(d, len);
          o.bound(tip);
          limbs.tube(
            [b, b.clone().lerp(tip, 0.5).add(rv(r, 0.02)), tip],
            (t) => 0.0045 * (1 - t) + 0.0015,
            { seg: 3, col: () => kit.mul(bark, 0.8), sw },
          );
          for (let k = 0; k < o.clusters; k++) {
            q.copy(b)
              .lerp(tip, 0.3 + 0.7 * r())
              .add(rv(r, 0.11));
            o.bound(q);
            ax.copy(d).add(rv(r, 0.7)).normalize();
            e1.set(ax.y, -ax.x, 0.2).addScaledVector(ax, -e1.dot(ax)).normalize();
            e2.crossVectors(ax, e1);
            const size = 0.046 + r() * 0.026,
              a0 = r() * 6.28,
              c3 = o.color(r),
              ss = sw(q);
            for (let j = 0; j < 3; j++) {
              const an = a0 + j * 2.094,
                cs = Math.cos(an),
                sn = Math.sin(an);
              nh.set(e1.x * cs + e2.x * sn, e1.y * cs + e2.y * sn, e1.z * cs + e2.z * sn);
              Ly.copy(ax).multiplyScalar(0.5).addScaledVector(nh, 0.86);
              const dd = new V3().copy(Ly);
              nh.multiplyScalar(-1).addScaledVector(ax, 0.6);
              leaf(kites, q, dd, nh, size * 0.86, size, size * 0.42, c3, ss, 5);
            }
          }
        }
      }
    }
    col.cyl(o.base[0], 0.4, o.base[1], 0.14, 0.8, { tag: 'tree' });
  };
  const petals = (n, r, f, color) => {
    for (let i = 0; i < n; i++) {
      const p = f(r);
      if (!p) continue;
      const s = 0.03 + r() * 0.016;
      leaf(
        kites,
        p,
        new V3(r() - 0.5, 0, r() - 0.5),
        new V3((r() - 0.5) * 0.5, 1, (r() - 0.5) * 0.5),
        s * 0.86,
        s,
        s * 0.3,
        kit.mul(color(r), 0.7 + r() * 0.3),
        ZERO,
        5,
      );
    }
  };
  const magenta = (r) => {
    const k = 0.75 + r() * 0.45,
      h = r();
    return [0.74 * k + h * 0.12, 0.02 + h * 0.03, (0.26 - h * 0.12) * k];
  };
  const orange = (r) => {
    const k = 0.8 + r() * 0.4,
      h = r();
    return h < 0.8 ? [0.92 * k, (0.2 + h * 0.14) * k, 0.02] : [0.9 * k, 0.16 * k, 0.2 * k];
  };
  // the big one on the west stair landing: up the two west posts and the north-west corner, spilling over the rail and out to the yard
  bougainvillea({
    seed: 31,
    base: [-12.15, 3.55 + SZ],
    supports: [
      [-11.9, 3.05 + SZ],
      [-11.9, 4.15 + SZ],
      [-11.88, 3.6 + SZ],
      [-11.6, 2.9 + SZ],
      [-11.95, 4.35 + SZ],
    ],
    top: 3.0,
    canes: 30,
    reach: 1.45,
    leaves: 12,
    shoots: 2,
    clusters: 12,
    color: magenta,
    az: (r) => {
      const t = r();
      return t < 0.6
        ? Math.PI + (r() - 0.5) * 2.6
        : t < 0.8
          ? -Math.PI / 2 + (r() - 0.5) * 0.9
          : (r() - 0.5) * 1.2;
    },
    bound: (p) => {
      const lim =
        p.z > 4.25 + SZ ? -11.95 : p.z > 2.95 + SZ ? (p.y > 2.45 ? -11.25 : -11.9) : -10.9;
      if (p.x > lim) p.x = lim - (p.x - lim) * 0.15;
      if (p.x < -13.9) p.x = -13.9;
      if (p.y > 3.3) p.y = 3.3;
    },
  });
  {
    const r = kit.rng(33);
    petals(
      260,
      r,
      (r2) => {
        const a = r2() * 6.28,
          d = Math.sqrt(r2()) * 1.9,
          x = -12.6 + Math.cos(a) * d * 0.9,
          z = 3.7 + SZ + Math.sin(a) * d * 1.3;
        return x > -11.95 && z > 2.9 + SZ ? null : new V3(x, 0.012 + r2() * 0.008, z);
      },
      magenta,
    );
    petals(
      46,
      r,
      (r2) => new V3(-11.75 + r2() * r2() * 1.0, 1.508, 3.05 + SZ + r2() * 1.1),
      magenta,
    ); // on the landing
    for (let i = 0; i < 7; i++)
      petals(
        9 - i,
        r,
        (r2) =>
          new V3(
            -11.76 + r2() * r2() * 1.05,
            1.5 - (i + 1) * 0.1875 + 0.008,
            4.23 + SZ + i * 0.28 + r2() * 0.22,
          ),
        magenta,
      ); // on the treads
    petals(30, r, (r2) => new V3(-11.9 + r2() * 1.4, 0.07, 6.3 + SZ + r2() * 0.8), magenta);
  }
  // the orange one on the lattice at the south-east corner of the wing
  bougainvillea({
    seed: 32,
    base: [6.86, 4.66],
    supports: [
      [6.72, 4.5],
      [6.2, 4.5],
      [6.72, 3.9],
      [5.6, 4.5],
      [6.74, 3.2],
    ],
    top: 2.85,
    canes: 18,
    reach: 0.95,
    leaves: 11,
    shoots: 2,
    clusters: 9,
    color: orange,
    az: (r) => {
      const t = r();
      return t < 0.4
        ? Math.PI + (r() - 0.5) * 0.5
        : t < 0.7
          ? -Math.PI / 2 + (r() - 0.5) * 0.5
          : 0.8 + (r() - 0.5) * 1.6;
    },
    bound: (p) => {
      if (p.x < 6.7 && p.z < 4.5) {
        if (6.7 - p.x < 4.5 - p.z) p.x = 6.7 + r01(p) * 0.08;
        else p.z = 4.5 + r01(p) * 0.08;
      }
      if (p.x < 4.6) p.x = 4.6;
      if (p.z < 2.4) p.z = 2.4;
      if (p.x > 8.0) p.x = 8.0;
      if (p.z > 5.6) p.z = 5.6;
      if (p.y > 2.92) p.y = 2.92;
    },
  });
  function r01(p) {
    return kit.hash(p.x * 13.1, p.y * 7.7, p.z * 3.3);
  }
  petals(
    120,
    kit.rng(34),
    (r2) => {
      const a = r2() * 6.28,
        d = Math.sqrt(r2()) * 1.5,
        x = 6.9 + Math.cos(a) * d,
        z = 4.9 + Math.sin(a) * d;
      return (x < 6.65 && z < 4.45) || x > 11.2 ? null : new V3(x, 0.012 + r2() * 0.008, z);
    },
    orange,
  );

  // the lattice planter on the street side (yard.data.js PLANTER, track: keys): canes rise out of the soil, arch over the cap rail
  // and cascade down the lattice faces (mostly the street side), a few trail along the box; petals on the soil, the cap and the sand
  // r2-keys (user: the card-built bougainvillea read layered and splotchy): with PLANTER.library the box is planted with r2-veg's library
  // bougainvillea (volume-shaded) through yard.data.js PLANTING instead of these cards
  if (!PLANTER.library) {
    const PL = PLANTER,
      top = PL.h + 0.05,
      hd = PL.depth / 2 + 0.07;
    const inBox = (q) => {
      for (const [ax, az, bx, bz] of PL.runs) {
        const along = Math.abs(az - bz) < 0.01;
        if (along) {
          if (
            q.x > Math.min(ax, bx) - 0.05 &&
            q.x < Math.max(ax, bx) + 0.05 &&
            Math.abs(q.z - az) < hd
          )
            return { n: [0, Math.sign(q.z - az) || 1], c: az, axis: 'z' };
        } else if (
          q.z > Math.min(az, bz) - 0.05 &&
          q.z < Math.max(az, bz) + 0.05 &&
          Math.abs(q.x - ax) < hd
        )
          return { n: [Math.sign(q.x - ax) || 1, 0], c: ax, axis: 'x' };
      }
      return null;
    };
    PL.plants.forEach((p, i) => {
      const run = PL.runs.find(([ax, az, bx, bz]) =>
          Math.abs(az - bz) < 0.01
            ? Math.abs(p.z - az) < 0.6 && p.x > ax - 0.6 && p.x < bx + 0.6
            : Math.abs(p.x - ax) < 0.6,
        ),
        along = run && Math.abs(run[1] - run[3]) < 0.01;
      const out = along ? 0 : Math.PI / 2,
        col = p.hue === 'coral' ? orange : magenta,
        s = p.s; // out: toward the street (+Z) or out of the return run (+X)
      bougainvillea({
        seed: 61 + i * 7,
        base: [p.x, p.z],
        supports: [
          [p.x - 0.3, p.z],
          [p.x + 0.3, p.z],
          [p.x, p.z + 0.12],
          [p.x - 0.1, p.z - 0.12],
        ],
        top: top + 0.6 * s,
        canes: Math.round(20 * s),
        reach: 0.95 * s,
        leaves: 12,
        shoots: 2,
        clusters: 14,
        color: col, // r2-keys: a dense mound over the box (mock-up), the lattice stays visible
        az: (r) => {
          const t = r();
          const a =
            t < 0.62
              ? out + (r() - 0.5) * 1.1
              : t < 0.8
                ? out + Math.PI + (r() - 0.5) * 0.9
                : (along ? 0 : Math.PI / 2) +
                  (r() < 0.5 ? Math.PI / 2 : -Math.PI / 2) +
                  (r() - 0.5) * 0.5;
          return -a + Math.PI / 2;
        },
        bound: (q) => {
          const b = inBox(q);
          if (b && q.y < top + 0.04) q.y = top + 0.03 + r01(q) * 0.08; // r2-keys: the mound sits on the box, the lattice stays visible (mock-up)
          if (q.y > top + 1.2 * s) q.y = top + 1.2 * s;
          if (q.y < 0.12) q.y = 0.12;
        },
      });
      petals(
        Math.round(60 * s),
        kit.rng(80 + i),
        (r2) => {
          const a = r2() * 6.28,
            d = 0.3 + Math.sqrt(r2()) * 1.5 * s,
            x = p.x + Math.cos(a) * d,
            z = p.z + Math.sin(a) * d * 1.2;
          return inBox({ x, y: 0, z })
            ? new V3(x, PL.h + 0.055, z)
            : new V3(x, 0.03 + r2() * 0.01, z);
        },
        col,
      );
    });
  }

  // ---------- small plant builders ----------
  const NOSW = () => ZERO;
  const RC = ctx.opts.roadClear || (() => true),
    offRoad = (x, z, pad = 0.4) => RC(x, z, pad); // nothing grows in a lane (lead review)
  const tuft = (x, y, z, h, w, c, amp = 0.02, r = R) => {
    if (y < 0.3 && !offRoad(x, z)) return;
    const a = r() * 6.28,
      cs = Math.cos(a),
      sn = Math.sin(a);
    tufts.add(
      new V3(x, y, z),
      new V3(cs * w, 0, sn * w),
      new V3((r() - 0.5) * 0.12 * h, h, (r() - 0.5) * 0.12 * h),
      new V3(-sn * w, 0, cs * w),
      c,
      [0, 0, amp * h * 2, x * 1.7 + z * 2.3],
      9,
    );
  };
  const grassC = (r) => {
    const t = r();
    return t < 0.4
      ? cv([0.5, 0.66, 0.36], r, 0.2)
      : t < 0.8
        ? cv([0.8, 0.8, 0.46], r, 0.18)
        : cv([1.05, 0.88, 0.55], r, 0.14);
  };
  const periwinkle = (x, z, s = 1, y = 0, r = R) => {
    if (y < 0.3 && !offRoad(x, z)) return;
    const n = 6 + ((r() * 4) | 0);
    for (let i = 0; i < n; i++) {
      const az = r() * 6.28,
        lean = 0.2 + r() * 0.7,
        h = (0.16 + r() * 0.2) * s,
        b = new V3(x + (r() - 0.5) * 0.06, y, z + (r() - 0.5) * 0.06),
        tip = new V3(
          b.x + Math.cos(az) * Math.sin(lean) * h,
          y + Math.cos(lean) * h,
          b.z + Math.sin(az) * Math.sin(lean) * h,
        ),
        sw = [0, 0, 0.012, az];
      stems.tube(
        [
          b,
          b
            .clone()
            .lerp(tip, 0.5)
            .add(new V3(0, 0.015, 0)),
          tip,
        ],
        () => 0.0035,
        { seg: 3, col: () => [0.3, 0.3, 0.16], sw: () => sw },
      );
      for (let k = 1; k <= 5; k++)
        for (const sd of [-1, 1]) {
          const q = b.clone().lerp(tip, k / 5.3),
            a2 = az + sd * 1.5 + k * 1.6,
            g = 0.55 + r() * 0.3;
          leaf(
            kites,
            q,
            new V3(Math.cos(a2), 0.25, Math.sin(a2)),
            UP,
            0.03 * s,
            0.05 * s,
            0.012,
            [g * 0.7, g, g * 0.75],
            sw,
            4,
          );
        }
      if (r() < 0.8) {
        const fs = (0.032 + r() * 0.012) * s,
          dv = new V3(Math.cos(az), 0.1, Math.sin(az));
        leaf(
          quads,
          tip
            .clone()
            .addScaledVector(dv, -fs * 0.5)
            .add(new V3(0, 0.006, 0)),
          dv,
          new V3(Math.cos(az) * 0.3, 1, Math.sin(az) * 0.3),
          fs,
          fs,
          fs * 0.25,
          r() < 0.15 ? [1.3, 1.3, 1.3] : [1, 1, 1],
          sw,
          7,
        );
      }
    }
  };
  // rosette of arching strap leaves on an optional stalk (ti plant, croton, snake plant, fern, orchid)
  const rosette = (x, y, z, o, r = R) => {
    if (y < 0.3 && !offRoad(x, z, 0.6)) return;
    const top = new V3(
      x + (r() - 0.5) * 0.1 * (o.stalk ?? 0),
      y + (o.stalk ?? 0),
      z + (r() - 0.5) * 0.1 * (o.stalk ?? 0),
    );
    if (o.stalk)
      stems.tube(
        [
          new V3(x, y - 0.02, z),
          new V3((x + top.x) / 2 + 0.02, y + o.stalk * 0.5, (z + top.z) / 2),
          top,
        ],
        (t) => (o.stalkR ?? 0.012) * (1 - 0.3 * t),
        {
          seg: 5,
          col: () => cv(o.stalkC ?? [0.3, 0.26, 0.18], r, 0.1),
          sw: (q, t) => [0, 0, (o.amp ?? 0.01) * t, x],
        },
      );
    for (let i = 0; i < o.n; i++) {
      const a = i / o.n,
        az = i * 2.4 + r(),
        el = o.el[0] + (o.el[1] - o.el[0]) * a + (r() - 0.5) * 0.2,
        l = o.l * (0.7 + r() * 0.45),
        q = top.clone();
      q.y -= a * (o.drop ?? 0.1) * (o.stalk ?? 0.2);
      const d = new V3(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el)),
        nh = o.upright ? new V3(Math.cos(az), 0.05, Math.sin(az)) : UP;
      leaf(
        strips,
        q.add(new V3(Math.cos(az) * (o.rad ?? 0.01), 0, Math.sin(az) * (o.rad ?? 0.01))),
        d,
        nh,
        l * o.w,
        l,
        l * o.bend * (0.6 + r() * 0.8),
        o.color(r, a),
        [0, 0, (o.amp ?? 0.01) + 0.01, az + x],
        o.tile,
      );
    }
  };
  const tiPlant = (x, y, z, s = 1, r = R) =>
    rosette(
      x,
      y,
      z,
      {
        stalk: (0.35 + r() * 0.5) * s,
        stalkR: 0.014,
        n: 16,
        el: [1.3, -0.1],
        l: 0.42 * s,
        w: 0.24,
        bend: 0.4,
        drop: 0.5,
        tile: 8,
        color: (r2, a) =>
          a < 0.4 ? cv([1.25, 1.0, 1.1], r2, 0.15) : cv([0.8, 0.85, 0.8], r2, 0.2),
        amp: 0.02,
      },
      r,
    );
  const croton = (x, y, z, s = 1, r = R) => {
    for (let i = 0; i < 3; i++)
      rosette(
        x + (r() - 0.5) * 0.25 * s,
        y,
        z + (r() - 0.5) * 0.25 * s,
        {
          stalk: (0.3 + r() * 0.45) * s,
          stalkR: 0.01,
          n: 15,
          el: [1.2, -0.3],
          l: 0.22 * s,
          w: 0.36,
          bend: 0.25,
          drop: 0.85,
          tile: 6,
          color: (r2) => cv([1.05, 1.0, 0.9], r2, 0.22),
          amp: 0.015,
        },
        r,
      );
  };
  const snake = (x, y, z, s = 1, r = R) =>
    rosette(
      x,
      y,
      z,
      {
        n: 10,
        el: [1.5, 1.2],
        l: 0.62 * s,
        w: 0.13,
        bend: 0.07,
        rad: 0.04 * s,
        tile: 12,
        upright: true,
        color: (r2) => cv([1, 1, 1], r2, 0.15),
        amp: 0.004,
      },
      r,
    );
  const aloe = (x, y, z, s = 1, r = R) => {
    for (let i = 0; i < 15; i++) {
      const a = i / 14,
        az = i * 2.4,
        el = 1.35 - 1.1 * a,
        l = (0.2 + 0.2 * Math.sin(Math.PI * (0.25 + a * 0.7))) * s,
        pts = [],
        p = new V3(x + Math.cos(az) * 0.02 * s, y - 0.01, z + Math.sin(az) * 0.02 * s);
      for (let k = 0; k <= 4; k++) {
        pts.push(p.clone());
        const e = el + 0.5 * (k / 4) * (1 - a * 0.4);
        p.x += (Math.cos(e) * Math.cos(az) * l) / 4;
        p.z += (Math.cos(e) * Math.sin(az) * l) / 4;
        p.y += (Math.sin(e) * l) / 4;
      }
      const c3 = cv([0.3, 0.42, 0.27], r, 0.12);
      stems.tube(pts, (t) => 0.03 * s * Math.pow(1 - t, 0.7) + 0.002, {
        seg: 6,
        n0: new V3(-Math.sin(az), 0, Math.cos(az)),
        mod: (t, an) => 0.32 + 0.68 * Math.abs(Math.cos(an)),
        col: (t, an) => kit.mul(c3, 0.8 + 0.3 * t + (Math.sin(an * 9 + t * 40) > 0.86 ? 0.5 : 0)),
        sw: NOSW,
      });
    }
  };
  const herb = (x, y, z, s = 1, c = [0.75, 1.05, 0.6], r = R) => {
    for (let i = 0; i < 7; i++) {
      const az = r() * 6.28,
        h = (0.12 + r() * 0.16) * s,
        tip = new V3(x + Math.cos(az) * h * 0.5, y + h, z + Math.sin(az) * h * 0.5);
      stems.tube([new V3(x, y, z), tip], () => 0.003, {
        seg: 3,
        col: () => [0.3, 0.38, 0.16],
        sw: NOSW,
      });
      for (let k = 0; k < 9; k++) {
        const q = new V3(x, y, z).lerp(tip, 0.3 + 0.7 * r()).add(rv(r, 0.035 * s)),
          l = (0.035 + r() * 0.03) * s;
        leaf(
          kites,
          q,
          new V3(r() - 0.5, 0.2, r() - 0.5),
          UP,
          l * 0.8,
          l,
          l * 0.5,
          cv(c, r, 0.18),
          [0, 0, 0.006, az],
          4,
        );
      }
    }
  };
  const deadPlant = (x, y, z, r = R) => {
    for (let i = 0; i < 6; i++) {
      const az = r() * 6.28,
        h = 0.12 + r() * 0.22,
        tip = new V3(x + Math.cos(az) * h * 0.6, y + h * 0.8, z + Math.sin(az) * h * 0.6);
      stems.tube(
        [new V3(x, y, z), new V3(x, y, z).lerp(tip, 0.5).add(rv(r, 0.02)), tip],
        (t) => 0.003 * (1 - t) + 0.001,
        { seg: 3, col: () => [0.34, 0.25, 0.15], sw: NOSW },
      );
      if (r() < 0.7)
        leaf(
          kites,
          tip,
          new V3(Math.cos(az), -0.6, Math.sin(az)),
          UP,
          0.03,
          0.05,
          0.03,
          [0.9, 0.8, 0.7],
          ZERO,
          15,
        );
    }
  };
  const limeTree = (x, y, z, r = R) => {
    const sites = [],
      sw = (p) => [0.02 * Math.max(0, p.y - y), x, 0, 0];
    grow(limbs, new V3(x, y - 0.03, z), new V3(0.05, 1, 0.03).normalize(), 0.5, 0.016, 0, {
      r,
      step: 0.12,
      wander: 0.25,
      up: [0.1, 0.12, 0.1],
      depth: 2,
      lenK: 0.65,
      spread: 0.8,
      fork: () => 3,
      sites,
      sw,
      minY: y,
      col: () => cv([1.2, 1.15, 0.95], r, 0.1),
    });
    for (const s of sites)
      for (let i = 0; i < 6; i++) {
        const q = s.p.clone().add(rv(r, 0.09)),
          l = 0.05 + r() * 0.035,
          g = 0.5 + r() * 0.3;
        leaf(
          kites,
          q,
          rv(r, 1).setY(r() * 0.4 - 0.3),
          UP.clone().add(rv(r, 0.5)),
          l * 0.75,
          l,
          l * 0.35,
          [g * 0.7, g, g * 0.62],
          [sw(q)[0], x, 0.008, q.x * 9],
          4,
        );
      }
    for (let i = 0; i < 7; i++) {
      const s = sites[(r() * sites.length) | 0].p;
      stems.geo(
        sphere,
        M(
          s.x + (r() - 0.5) * 0.1,
          s.y - 0.04 - r() * 0.05,
          s.z + (r() - 0.5) * 0.1,
          0,
          0,
          0,
          0.022,
          0.024,
          0.022,
        ),
        r() < 0.7 ? cv([0.26, 0.42, 0.06], r, 0.1) : cv([0.6, 0.56, 0.08], r, 0.1),
        [sw(s)[0], x, 0.006, i],
      );
    }
  };

  // ---------- understory ----------
  // saw palmetto clumps along the west lot line
  const palmetto = (x, z, s, r) => {
    if (!offRoad(x, z, 1.2)) return;
    const n = 12 + ((r() * 6) | 0);
    for (let i = 0; i < n; i++) {
      const dead = i >= n - 2,
        az = i * 2.4 + r(),
        el = dead ? 0.1 + r() * 0.2 : 0.35 + r() * 1.0,
        pl = (0.45 + r() * 0.6) * s,
        b = new V3(x + Math.cos(az) * 0.12, 0, z + Math.sin(az) * 0.12);
      const d = new V3(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el)),
        tip = b.clone().addScaledVector(d, pl),
        sw = [0, 0, 0.03 * pl, az + x];
      stems.tube(
        [
          b,
          b
            .clone()
            .lerp(tip, 0.5)
            .add(new V3(0, 0.05 * pl, 0)),
          tip,
        ],
        (t) => 0.011 - 0.004 * t,
        {
          seg: 4,
          col: () => (dead ? [0.36, 0.27, 0.15] : cv([0.3, 0.42, 0.16], r, 0.1)),
          sw: (q, t) => [0, 0, sw[2] * t, sw[3]],
        },
      );
      const fd = d.clone();
      fd.y += dead ? -0.5 : 0.15 - r() * 0.5;
      const size = (0.5 + r() * 0.28) * s,
        t2 = r();
      leaf(
        fans,
        tip,
        fd,
        new V3(-Math.cos(az) * 0.6, 1, -Math.sin(az) * 0.6),
        size,
        size,
        size,
        dead
          ? cv([1.15, 0.85, 0.6], r, 0.1)
          : t2 < 0.6
            ? cv([0.34, 0.56, 0.3], r, 0.14)
            : cv([0.42, 0.62, 0.46], r, 0.12),
        sw,
        9,
      );
    }
    stems.geo(
      sphere,
      M(x, 0.05, z, 0, r() * 3, 0, 0.2, 0.12, 0.16),
      cv([0.25, 0.18, 0.11], r, 0.1),
      ZERO,
    ); // creeping trunk
  };
  {
    const r = kit.rng(41);
    for (const [x, z, s] of [
      [-22.4, -9.2, 1.1],
      [-20.9, -5.4, 0.9],
      [-22.8, -0.8, 1.15],
      [-20.6, 3.6, 1.0],
      [-18.9, 12.9, 1.2],
      [-19.3, 11.0, 0.95],
      [-13.6, 18.2, 1.1],
      [-11.0, 23.5, 1.0],
      [-19.2, -11.4, 0.85],
      [-11.6, 16.0, 0.8],
    ])
      if (!PLANTER.library) palmetto(x, z, s, r); // r2-keys: with the library planting these clumps are r2-veg's volume-shaded tropical beds (yard.data.js PLANTING)   // r2-keys: the turned corner lot (west side, the green mass by the bins, left of the drive)
    for (let i = 0; i < 9; i++)
      tuft(
        -11.4 + (r() - 0.5) * 1.8,
        0,
        16.6 + (r() - 0.5) * 1.6,
        0.2 + r() * 0.3,
        0.4,
        grassC(r),
        0.03,
        r,
      );
    periwinkle(-10.8, 16.9, 1.2, 0, r);
  }
  // silver buttonwood shrubs
  const buttonwood = (x, z, H, seed) => {
    const r = kit.rng(seed),
      sites = [],
      phase = r() * 6.28,
      sw = (p) => [0.05 * Math.pow(Math.max(0, p.y) / H, 1.5), phase, 0, 0];
    for (let i = 0; i < 3; i++) {
      const az = i * 2.1 + r(),
        inc = 0.2 + r() * 0.35;
      grow(
        limbs,
        new V3(x + Math.cos(az) * 0.08, -0.1, z + Math.sin(az) * 0.08),
        new V3(Math.sin(inc) * Math.cos(az), Math.cos(inc), Math.sin(inc) * Math.sin(az)),
        H * 0.36,
        0.05,
        0,
        {
          r,
          step: 0.22,
          wander: 0.3,
          up: [0.03, 0.08, 0.1, 0.1],
          depth: 3,
          lenK: 0.68,
          spread: 0.6,
          fork: () => 2 + (r() < 0.4 ? 1 : 0),
          sites,
          sw,
          col: () => cv([1.1, 1.05, 0.95], r, 0.12),
        },
      );
    }
    const per = (H * 620) / sites.length;
    for (const s of sites)
      for (let i = 0; i < per; i++) {
        const q = s.p.clone().add(rv(r, 0.24)),
          l = 0.08 + r() * 0.05,
          g = 0.85 + r() * 0.4;
        leaf(
          kites,
          q,
          rv(r, 1).setY(r() * 0.9 - 0.2),
          UP.clone().add(rv(r, 0.8)),
          l * 0.66,
          l,
          l * 0.3,
          [g * 3.3, g * 1.85, g * 5.2],
          [sw(q)[0], phase, 0.012, q.x * 5 + q.z],
          4,
        );
      }
    col.cyl(x, 0.6, z, 0.16, 1.2, { tag: 'tree' });
  };
  buttonwood(-19.4, -7.6, 3.1, 51);
  // front-door view (Nov 19): out of the paved road, the open grass by the pickup and the boat; they screen the canal side
  buttonwood(-2.81, 17.2, 2.5, 52);
  buttonwood(-25.02, -2.5, 2.1, 53);
  buttonwood(2.2, 17.33, 2.3, 54);
  // crotons and ti plants toward the street
  {
    const r = kit.rng(55);
    for (const [x, z, k] of [
      [-8.4, 25.6, 'c'],
      [-7.3, 25.4, 't'],
      [-4.6, 26.0, 'c'],
      [-1.8, 26.2, 'c'],
      [-0.6, 26.0, 't'],
      [2.4, 26.3, 'c'],
      [4.2, 26.1, 't'],
      [6.8, 26.0, 'c'],
      [7.9, 25.7, 'c'],
    ]) {
      if (r4Out(x, z, 0.8)) continue;
      // r11: the r8 yard plants this row with the user's plant models (part r11_56_yardplants)
      if (R8) {
        (ctx.streetRow ||= []).push([x, z, k]);
        continue;
      }
      if (k === 'c') croton(x, 0, z, 1.25 + r() * 0.4, r);
      else {
        tiPlant(x, 0, z, 1.4 + r() * 0.4, r);
        tiPlant(x + 0.2, 0, z + 0.15, 1.0, r);
      }
      for (let i = 0; i < 3; i++)
        tuft(
          x + (r() - 0.5) * 0.8,
          0,
          z + (r() - 0.5) * 0.6,
          0.15 + r() * 0.15,
          0.2,
          grassC(r),
          0.02,
          r,
        );
    }
  }
  // railroad vine runners along the seawall edges
  const vine = (pts, r) => {
    stems.tube(pts, () => 0.006, {
      seg: 4,
      col: () => cv([0.32, 0.3, 0.14], r, 0.15),
      sw: NOSW,
      vLen: 0.3,
    });
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i],
        b = pts[i + 1],
        n = Math.round(a.distanceTo(b) / 0.11);
      for (let k = 0; k < n; k++) {
        const q = a.clone().lerp(b, (k + r()) / n),
          az = r() * 6.28,
          s = 0.07 + r() * 0.045,
          g = 0.75 + r() * 0.4;
        q.x += (r() - 0.5) * 0.12;
        q.z += (r() - 0.5) * 0.12;
        q.y = 0.02 + r() * 0.05;
        leaf(
          quads,
          q,
          new V3(Math.cos(az), 0.35 + r() * 0.6, Math.sin(az)),
          UP,
          s,
          s,
          s * 0.5,
          [g, g, g * 0.9],
          [0, 0, 0.006, az],
          10,
        );
        if (r() < 0.035) {
          const fs = 0.06 + r() * 0.02;
          leaf(
            quads,
            new V3(q.x, 0.09, q.z),
            new V3(Math.cos(az), 0.5, Math.sin(az)),
            UP,
            fs,
            fs,
            fs * 0.6,
            [0.95, 0.72, 1.25],
            [0, 0, 0.01, az],
            7,
          );
        }
      }
    }
  };
  {
    const r = kit.rng(61),
      run = (x0, z0, x1, z1, wob) => {
        const pts = [],
          n = Math.max(3, Math.round(Math.hypot(x1 - x0, z1 - z0) / 0.6));
        for (let i = 0; i <= n; i++) {
          const t = i / n;
          pts.push(
            new V3(
              x0 + (x1 - x0) * t + (r() - 0.5) * wob,
              0.012,
              z0 + (z1 - z0) * t + (r() - 0.5) * wob,
            ),
          );
        }
        vine(pts, r);
      };
    const SW = ctx.siteWalls || { N: true, E: true }; // (r2-qa QA: the open north edge sinks under the beach, these floated 1.45 m)
    if (SW.N)
      for (const [a, b] of [
        [-23, -15.5],
        [-12, -7],
        [-6.5, -4.6],
        [-1.6, 0.4],
        [3.4, 6.2],
        [6.6, 10.6],
      ]) {
        run(a, -13.75 + r() * 0.2, b, -13.6 + r() * 0.3, 0.3);
        run(a + 0.5, -13.5, a + 1.5 + r() * 2, -12.4 - r() * 0.8, 0.25);
        run(b - 0.4, -13.5, b - 2 - r(), -12.7 - r() * 0.6, 0.25);
      }
    if (SW.E)
      for (const [a, b] of [
        [-12.5, -8.5],
        [-6.5, -3],
        [5, 7.5],
      ]) {
        run(10.95 - r() * 0.2, a, 10.9 - r() * 0.3, b, 0.3);
        run(10.8, a + 0.6, 9.8 - r() * 0.8, a + 1.6 + r() * 1.5, 0.25);
      }
  }
  // sea oats clumps on the seawall edges
  const seaOats = (x, z, r) => {
    for (let i = 0; i < 3; i++)
      tuft(
        x + (r() - 0.5) * 0.3,
        0,
        z + (r() - 0.5) * 0.3,
        0.7 + r() * 0.4,
        0.6,
        cv([0.82, 0.92, 0.6], r, 0.12),
        0.05,
        r,
      );
    for (let i = 0; i < 8 + ((r() * 5) | 0); i++) {
      const az = r() * 6.28,
        h = 1.05 + r() * 0.6,
        lean = 0.08 + r() * 0.3,
        b = new V3(x + (r() - 0.5) * 0.24, 0, z + (r() - 0.5) * 0.24),
        ph = az + x;
      const m = new V3(
          b.x + Math.cos(az) * lean * h * 0.3,
          h * 0.55,
          b.z + Math.sin(az) * lean * h * 0.3,
        ),
        t = new V3(b.x + Math.cos(az) * lean * h, h, b.z + Math.sin(az) * lean * h);
      stems.tube([b, m, t], () => 0.005, {
        seg: 3,
        col: () => cv([0.62, 0.52, 0.28], r, 0.1),
        sw: (q, tt) => [0, 0, 0.09 * tt * tt, ph],
      });
      const l = 0.34 + r() * 0.14;
      leaf(
        strips,
        t,
        new V3(Math.cos(az) * 0.6, 0.8, Math.sin(az) * 0.6),
        UP,
        l * 0.42,
        l,
        l * 0.75,
        cv([1.05, 1.0, 0.9], r, 0.12),
        [0, 0, 0.1, ph],
        14,
      );
    }
  };
  {
    const r = kit.rng(63);
    for (const [x, z] of [
      [-21.2, -13.4],
      [-17.6, -13.3],
      [-14.9, -13.5],
      [-6.6, -13.3],
      [-1.3, -13.4],
      [4.3, -13.3],
      [7.6, -13.4],
      [10.8, -6.4],
      [10.9, -2.5],
      [10.7, 5.6],
      [10.6, -12.6],
    ]) {
      const SW = ctx.siteWalls || { N: true, E: true };
      if ((z < -12 && !SW.N) || (x > 10 && !SW.E)) continue;
      seaOats(x, z, r);
    }
  }
  // periwinkle, weeds and grass at pile footings and stair feet (not on the carport / front-bay slabs)
  const onSlab = (x, z) =>
    (x > -0.85 && x < 7.65 && z > -3.15 && z < 8.0) ||
    (x > -7.1 && x < -0.55 && z > -3.25 && z < 5.05);
  if (!R8) {
    const r = kit.rng(65);
    for (const [x, z, pw] of [
      [-8.42, 5.02, 1],
      [-8.42, 2.8, 0],
      [-8.42, -0.2, 1],
      [-8.42, -3.2, 0],
      [-8.42, -6.22, 1],
      [-6.4, 5.02, 1],
      [-3.6, 5.02, 0],
      [-0.8, 5.02, 1],
      [2.0, 5.02, 1],
      [-6.4, -6.22, 0],
      [-3.6, -6.22, 1],
      [-0.8, -6.22, 0],
      [6.42, -6.22, 1],
      [2.0, -6.22, 0],
      [-11.95, 6.75 + SZ, 1],
      [-10.4, 6.85 + SZ, 1],
      [-11.75, 3.0 + SZ, 0],
      [0.1, -7.05, 1],
      [-10.65, 3.05 + SZ, 0],
      [6.9, -3.0, 0],
      [6.95, 0.6, 1],
    ]) {
      const a0 = r() * 6.28;
      for (let i = 0; i < 4 + ((r() * 3) | 0); i++) {
        const a = a0 + i * 1.3 + r(),
          d = 0.36 + r() * 0.18,
          tx = x + Math.cos(a) * d,
          tz = z + Math.sin(a) * d,
          h = 0.18 + r() * 0.32,
          w = 0.3 + r() * 0.2,
          gc = grassC(r);
        if (onSlab(tx, tz)) continue;
        tuft(tx, 0, tz, h, w, gc, 0.02, r);
      } // never through the slabs
      if (pw && !onSlab(x + Math.cos(a0 + 2.5) * 0.42, z + Math.sin(a0 + 2.5) * 0.42)) {
        const a = a0 + 2.5,
          d = 0.42;
        periwinkle(x + Math.cos(a) * d, z + Math.sin(a) * d, 1 + r() * 0.3, 0, r);
        if (r() < 0.5)
          periwinkle(
            x + Math.cos(a + 1.2) * (d + 0.1),
            z + Math.sin(a + 1.2) * (d + 0.1),
            0.85,
            0,
            r,
          );
      } else if (!pw && !onSlab(x + Math.cos(a0) * 0.42, z + Math.sin(a0) * 0.42))
        rosette(
          x + Math.cos(a0) * 0.42,
          0,
          z + Math.sin(a0) * 0.42,
          {
            n: 8,
            el: [1.2, 0.3],
            l: 0.28,
            w: 0.4,
            bend: 0.5,
            tile: 11,
            color: (r2) => cv([0.8, 1.05, 0.7], r2, 0.15),
            amp: 0.01,
          },
          r,
        ); // a volunteer fern
    }
  }
  // sandspur and wiregrass tufts across the yard (clumped, thinning toward the trodden ground)
  {
    const r = kit.rng(67);
    let n = 0;
    for (let i = 0; i < 6000 && n < 1450; i++) {
      const x = -24 + r() * 35.2,
        z = -14 + r() * 40.8;
      if (blocked(x, z, 0.25)) continue;
      const clump =
          Math.sin(x * 0.47 + 1.3) * Math.sin(z * 0.39 + 0.7) + 0.6 * Math.sin(x * 1.3 + z * 0.9),
        edge = Math.min(x + 24, 11.4 - x, z + 14.2, 27 - z);
      const nearHouse = x > -10.2 && x < 8.2 && z > -8.6 && z < 6.6,
        path = Math.abs(x + 9) < 2.2 && z > 6 && z < 12;
      if (edge > 3.5 && !nearHouse) continue;
      if (z > 5.2 && Math.abs(x + 2) < 7.5 + Math.max(0, z - 14) * 0.5) continue;
      if (
        r() >
        0.1 +
          0.42 * Math.max(0, clump) +
          (edge < 3 ? 0.5 : 0) +
          (nearHouse ? 0.3 : 0) -
          (path ? 0.3 : 0)
      )
        continue;
      const h = 0.14 + r() * r() * 0.34 + (edge < 1.5 ? 0.1 : 0);
      tuft(x, 0, z, h, 0.3 + r() * 0.3, grassC(r), 0.025, r);
      n++;
    }
  }

  // ---------- pots ----------
  const POT = {
    terra: (a, h) => [
      [0, 0],
      [a * 0.68, 0],
      [a * 0.7, 0.012],
      [a * 0.93, h * 0.8],
      [a, h * 0.8],
      [a, h],
      [a * 0.9, h],
      [a * 0.88, h - 0.035],
      [0, h - 0.035],
    ],
    glazed: (a, h) => [
      [0, 0],
      [a * 0.6, 0],
      [a * 0.86, h * 0.15],
      [a, h * 0.5],
      [a * 0.9, h * 0.85],
      [a * 0.82, h * 0.93],
      [a * 0.9, h],
      [a * 0.8, h],
      [a * 0.76, h - 0.04],
      [0, h - 0.04],
    ],
    bucket: (a, h) => [
      [0, 0],
      [a * 0.78, 0],
      [a * 0.8, 0.01],
      [a * 0.99, h - 0.015],
      [a * 1.03, h - 0.01],
      [a * 1.03, h],
      [a * 0.96, h],
      [a * 0.93, h - 0.04],
      [0, h - 0.04],
    ],
    drum: (a, h) => [
      [0, 0],
      [a * 0.95, 0],
      [a, 0.03],
      [a, h * 0.3],
      [a * 1.035, h * 0.33],
      [a, h * 0.36],
      [a, h * 0.68],
      [a * 1.035, h * 0.71],
      [a, h * 0.74],
      [a, h],
      [a * 0.965, h],
      [a * 0.955, h - 0.05],
      [0, h - 0.05],
    ],
    nursery: (a, h) => [
      [0, 0],
      [a * 0.75, 0],
      [a * 0.97, h * 0.85],
      [a, h * 0.86],
      [a, h],
      [a * 0.94, h],
      [a * 0.92, h - 0.03],
      [0, h - 0.03],
    ],
  };
  const SOIL = mat.matte();
  const pot = (kind, x, y, z, a, h, color) => {
    if (R4 && (y > 0.5 || r4Out(x, z, 0.3))) return -100; // r4: the round-3 deck pots are gone (their plants land under the ground)
    const m =
        kind === 'terra'
          ? mat.matte()
          : kind === 'glazed'
            ? mat.ceramic()
            : kind === 'bucket'
              ? mat.metalPaint()
              : mat.plastic(),
      dip = kind === 'drum' ? 0.05 : kind === 'nursery' ? 0.03 : 0.04;
    D.geo(
      m,
      new THREE.LatheGeometry(
        POT[kind](a, h).map((q) => new THREE.Vector2(q[0], q[1])),
        18,
      ),
      M(x, y, z, 0, R() * 6.28, 0),
      { color: kit.vary(color, R, 0.07), uvMul: [6, 3], wear: 0.6 },
    );
    D.cyl(SOIL, a * 0.9, a * 0.9, 0.012, M(x, y + h - dip + 0.006, z), {
      seg: 14,
      color: kit.vary(0x33261b, R, 0.15),
    });
    for (let i = 0; i < 5; i++) {
      const an = R() * 6.28,
        d = R() * a * 0.75;
      D.box(
        SOIL,
        0.012 + R() * 0.015,
        0.008,
        0.01 + R() * 0.012,
        M(x + Math.cos(an) * d, y + h - dip + 0.014, z + Math.sin(an) * d, 0, R() * 3, 0),
        { color: kit.vary(R() < 0.5 ? 0x7a6a55 : 0x2a1f16, R, 0.2), bevel: 0.002 },
      );
    }
    if (kind === 'bucket')
      D.tube(
        mat.steel(),
        Array.from({ length: 9 }, (_, i) => {
          const t = (i / 8) * Math.PI;
          return [
            x + Math.cos(t) * a * 1.03,
            y + h - 0.02 - Math.sin(t) * a * 0.55,
            z + Math.sin(t) * 0.012 + a * 0.2 * Math.sin(t),
          ];
        }),
        0.0025,
        { seg: 5, color: 0x8f9296 },
      );
    if (kind === 'terra' && R() < 0.6)
      D.geo(
        mat.matte(),
        new THREE.CylinderGeometry(a * 0.86, a * 0.8, 0.018, 16),
        M(x, y + 0.009, z),
        { color: kit.vary(0xa85a36, R, 0.08), uvMul: [5, 1] },
      ); // saucer
    col.cyl(x, y + h / 2, z, a, h, { tag: 'pot' });
    return y + h - dip + 0.012;
  };
  const F = ctx.plan.F,
    TERRA = 0xb5633c,
    COBALT = 0x2b5a92,
    TEAL = 0x3c8c80,
    MUSTARD = 0xc79a32,
    BLACK = 0x1c1c1e;
  let t;
  // r10 (playtest Nov 19: 'remove random plants'): the round-3 pots, the hanging fern, the porch orchids, the front-bay ivy and the pile-footing
  // periwinkle stood at round-3 spots (scattered pots in the yard now); the r8 house has its own potted plants (the user's models, r4/pots.js)
  if (!R8) {
    // porch (along the front rail and the wall)
    t = pot('terra', 5.9, F, 7.6, 0.17, 0.3, TERRA);
    aloe(5.9, t, 7.6, 1.0);
    t = pot('glazed', 6.9, F, 7.55, 0.19, 0.36, COBALT);
    snake(6.9, t, 7.55, 1.05);
    t = pot('bucket', -0.42, F, 3.2, 0.15, 0.27, 0xb2412f);
    herb(-0.42, t, 3.2, 1.15);
    t = pot('terra', -0.4, F, 3.75, 0.1, 0.18, 0xc0714a);
    herb(-0.4, t, 3.75, 0.8, [0.6, 0.8, 0.62]);
    t = pot('drum', 1.45, F, 4.5, 0.29, 0.42, 0x2c5f9e);
    limeTree(1.45, t, 4.5);
    t = pot('glazed', 1.62, F, 3.1, 0.17, 0.32, TEAL);
    tiPlant(1.62, t, 3.1, 0.8);
    // west and bay decks (against the rails)
    t = pot('terra', -8.22, F, 0.7, 0.2, 0.34, 0xa9583a);
    aloe(-8.22, t, 0.7, 1.3);
    t = pot('nursery', -8.25, F, -0.35, 0.13, 0.24, BLACK);
    snake(-8.25, t, -0.35, 0.75);
    t = pot('glazed', -8.15, F, -5.95, 0.24, 0.42, MUSTARD);
    croton(-8.15, t, -5.95, 1.0);
    t = pot('terra', -3.2, F, -6.02, 0.15, 0.27, TERRA);
    herb(-3.2, t, -6.02, 1.2, [0.7, 1.0, 0.5]);
    t = pot('terra', -2.62, F, -6.06, 0.1, 0.18, 0xbf7550);
    deadPlant(-2.62, t, -6.06);
    t = pot('bucket', 1.6, F, -6.0, 0.16, 0.28, 0x7fa6b8);
    aloe(1.6, t, -6.0, 0.8);
    periwinkle(1.66, -5.94, 0.6, t);
    t = pot('glazed', 6.2, F, -5.9, 0.18, 0.34, COBALT);
    snake(6.2, t, -5.9, 0.9);
    // at grade: by the stair foot and along the wing lattice
    t = pot('terra', -12.3, 0, 6.85 + SZ, 0.2, 0.34, TERRA);
    aloe(-12.3, t, 6.85 + SZ, 1.25);
    t = pot('glazed', -12.45, 0, 7.5 + SZ, 0.22, 0.4, TEAL);
    croton(-12.45, t, 7.5 + SZ, 0.95);
    t = pot('nursery', -12.0, 0, 7.95 + SZ, 0.14, 0.25, BLACK);
    periwinkle(-12.0, 7.95 + SZ, 1.1, t);
    t = pot('bucket', -10.1, 0, 7.05 + SZ, 0.16, 0.29, 0xd7c9a0);
    herb(-10.1, t, 7.05 + SZ, 1.2, [0.62, 0.9, 0.5]);
    t = pot('terra', 2.75, 0, 4.82, 0.19, 0.33, 0xad5c3a);
    aloe(2.75, t, 4.82, 1.15);
    t = pot('nursery', 3.5, 0, 4.76, 0.15, 0.27, BLACK);
    snake(3.5, t, 4.76, 0.95);
    t = pot('glazed', 4.4, 0, 4.82, 0.2, 0.37, MUSTARD);
    tiPlant(4.4, t, 4.82, 0.75);
    t = pot('terra', 5.25, 0, 4.76, 0.13, 0.23, 0xc0714a);
    deadPlant(5.25, t, 4.76);
    t = pot('terra', 5.75, 0, 4.9, 0.16, 0.28, TERRA);
    periwinkle(5.75, 4.9, 1.0, t);
    // dying fern in a hanging basket from the porch beam
    {
      const x = 5.6,
        z = 7.76,
        by = 4.8,
        r = kit.rng(81),
        coir = [0.2, 0.13, 0.07];
      D.geo(
        mat.matte(),
        new THREE.SphereGeometry(0.17, 14, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2),
        M(x, by, z),
        { color: coir, uvMul: [8, 3] },
      );
      D.geo(
        mat.steel(),
        new THREE.TorusGeometry(0.17, 0.004, 5, 20),
        M(x, by, z, Math.PI / 2, 0, 0),
        { color: 0x6b6258 },
      );
      for (let i = 0; i < 3; i++) {
        const a = i * 2.094 + 0.4;
        D.rod(
          mat.steel(),
          [x + Math.cos(a) * 0.17, by, z + Math.sin(a) * 0.17],
          [x, 5.29, z],
          0.0018,
          { color: 0x6b6258, seg: 4 },
        );
      }
      D.tube(
        mat.steel(),
        [
          [x, 5.36, z],
          [x, 5.31, z],
          [x + 0.012, 5.285, z],
          [x, 5.27, z],
        ],
        0.003,
        { seg: 5, color: 0x6b6258 },
      );
      D.cyl(SOIL, 0.16, 0.16, 0.01, M(x, by - 0.005, z), { seg: 12, color: 0x2e2218 });
      rosette(
        x,
        by,
        z,
        {
          n: 30,
          el: [1.2, -0.2],
          l: 0.5,
          w: 0.34,
          bend: 0.95,
          rad: 0.05,
          tile: 11,
          color: (r2) =>
            r2() < 0.6 ? cv([1.0, 0.72, 0.5], r2, 0.2) : cv([0.85, 1.0, 0.6], r2, 0.15),
          amp: 0.012,
        },
        r,
      );
    }
    // orchids mounted on two porch posts
    for (const [px, pz, nx, nz] of [
      [2.14, 7.72, 0, -1],
      [6.58, 7.72, 0, -1],
    ]) {
      const y = 4.38,
        r = kit.rng(83 + px * 10),
        ox = px + nx * 0.014,
        oz = pz + nz * 0.014;
      D.box(mat.wood(), nz ? 0.11 : 0.026, 0.2, nz ? 0.026 : 0.11, M(ox, y, oz), {
        color: 0x5b4632,
        bevel: 0.006,
        wear: 0.9,
      });
      D.tube(
        mat.steel(),
        [
          [ox - nz * 0.07 + nx * 0.012, y + 0.03, oz + nx * 0.07 + nz * 0.012],
          [ox + nx * 0.03, y + 0.035, oz + nz * 0.03],
          [ox + nz * 0.07 + nx * 0.012, y + 0.03, oz - nx * 0.07 + nz * 0.012],
        ],
        0.0012,
        { seg: 4, color: 0x8a8a84 },
      );
      const c = new V3(ox + nx * 0.03, y, oz + nz * 0.03);
      for (let i = 0; i < 5; i++) {
        const a = (i - 2) * 0.5,
          d = new V3(
            nx * 0.7 + nz * Math.sin(a),
            0.5 - Math.abs(a) * 0.3,
            nz * 0.7 - nx * Math.sin(a),
          ),
          l = 0.13 + r() * 0.06;
        leaf(strips, c, d, UP, l * 0.26, l, l * 0.45, cv([0.42, 0.72, 0.36], r, 0.12), ZERO, 9);
      }
      for (let i = 0; i < 4; i++) {
        const a = r() * 6.28;
        stems.tube(
          [
            c.clone(),
            c.clone().add(new V3(Math.cos(a) * 0.03, -0.07, Math.sin(a) * 0.03)),
            c
              .clone()
              .add(
                new V3(
                  nx * 0.02 + Math.cos(a) * 0.04,
                  -0.14 - r() * 0.1,
                  nz * 0.02 + Math.sin(a) * 0.04,
                ),
              ),
          ],
          () => 0.0025,
          { seg: 3, col: () => [0.62, 0.66, 0.58], sw: NOSW },
        );
      }
      const sp = [
        c.clone(),
        c.clone().add(new V3(nx * 0.1, 0.16, nz * 0.1)),
        c.clone().add(new V3(nx * 0.24, 0.2, nz * 0.24)),
        c.clone().add(new V3(nx * 0.36, 0.12, nz * 0.36)),
      ];
      stems.tube(sp, () => 0.002, {
        seg: 3,
        col: () => [0.26, 0.36, 0.14],
        sw: (q, tt) => [0, 0, 0.01 * tt, px],
      });
      for (let i = 0; i < 5; i++) {
        const q = sp[1].clone().lerp(sp[3], i / 4.4);
        q.y += 0.03 * Math.sin((i / 4) * Math.PI);
        const s = 0.05;
        leaf(
          quads,
          q.add(new V3(0, -s * 0.5, 0)),
          UP,
          new V3(nx + (r() - 0.5) * 0.5, 0.15, nz + (r() - 0.5) * 0.5),
          s,
          s,
          s * 0.3,
          [1, 1, 1],
          [0, 0, 0.012, px + i],
          13,
        );
      }
    }

    // ---------- street-front bay (part 47): ivy up the piers and the room wall, plants in the rail pots ----------
    {
      const fbay = ctx.frontBay;
      const ri = kit.rng(5047);
      for (const v of fbay?.vines ?? []) {
        const pts = v.pts.map((p) => new V3(p[0], p[1], p[2]));
        if (pts.length < 2) continue;
        stems.tube(pts, (t) => 0.007 * (1 - 0.6 * t) + 0.002, {
          seg: 4,
          col: () => cv([0.36, 0.3, 0.2], ri, 0.12),
          sw: NOSW,
          vLen: 0.3,
        });
        const nrm = new V3(v.n[0], 0, v.n[1]);
        for (let i = 1; i < pts.length; i++) {
          const nLeaves = 3 + Math.floor(ri() * 4);
          for (let k = 0; k < nLeaves; k++) {
            const q = pts[i - 1].clone().lerp(pts[i], ri());
            const side = new V3(-nrm.z, 0, nrm.x).multiplyScalar((ri() - 0.5) * 0.24);
            q.add(side).addScaledVector(nrm, 0.02 + ri() * 0.06);
            const s = 0.05 + ri() * 0.05;
            const d = new V3((ri() - 0.5) * 1.2, -0.4 - ri() * 0.6, 0).addScaledVector(nrm, 0.3);
            const g = 0.7 + ri() * 0.45;
            leaf(
              quads,
              q,
              d,
              nrm.clone().add(new V3(0, 0.3, 0)),
              s,
              s,
              s * 0.35,
              [g * 0.85, g, g * 0.75],
              [0, 0, 0.008, q.y * 3 + i],
              10,
            );
          }
        }
      }
      for (const [x, y, z, s] of fbay?.pots ?? []) {
        if (ri() < 0.5) {
          rosette(
            x,
            y,
            z,
            {
              n: 12,
              el: [1.25, 0.25],
              l: 0.24 * s,
              w: 0.42,
              bend: 0.4,
              tile: 11,
              color: (r2) => cv([0.85, 1.05, 0.72], r2, 0.15),
              amp: 0.02,
            },
            ri,
          );
        } else {
          croton(x, y, z, 0.6 * s, ri);
        }
      }
    }
  } // !R8

  // ---------- build meshes ----------
  const ext = ctx.groups.ext,
    det = ctx.groups.detail;
  palmBark.mesh(palmBarkM, 'palmBark', ext);
  limbs.mesh(limbM, 'limbs', ext);
  stems.mesh(stemM, 'stems', ext);
  leaflets.mesh(leafletGeo, leafletM, 'leaflets', ext);
  discs.mesh(discGeo, grapeM, 'seaGrape', ext, { tile: true });
  kites.mesh(kiteGeo, cardM, 'leaves', ext, { tile: true });
  quads.mesh(quadGeo, cardM, 'flowers', det, { tile: true, cast: false });
  strips.mesh(stripGeo, cardM, 'straps', det, { tile: true });
  tufts.mesh(tuftGeo, grassM, 'grass', det, { tile: true, cast: false });
  fans.mesh(fanGeo, grassM, 'palmetto', det, { tile: true });
  ctx.stats.plants = { tris: Math.round(tris), meshes: calls };
}
