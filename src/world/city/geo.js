// Southline city — geometry helpers (batched merges, world-UV walls, palms)
import * as THREE from 'three';
import { buildPalm } from '../vegetation/palms.js';

const _c = new THREE.Color();

// perf (Nov 19): staging in growable Float64Arrays instead of JS arrays (the pushes promoted ~70 MB/s of large arrays into
// V8's old space while driving: full GCs). Same values (doubles until build), same output. b.p / b.n / b.uv / b.c are exact-
// length typed views (index read / write, .length, copy into Float32Array all work); code that assigns its own arrays to them
// switches that batch to plain arrays. ?batchf32=0 = the JS-array path.
const BATCH_F64 = !(typeof location !== 'undefined' && /[?&]batchf32=0\b/.test(location.search));
const STAGE = ['p', 'n', 'uv', 'c'],
  STRIDE = { p: 3, n: 3, uv: 2, c: 3 };
// Accumulates non-indexed triangles with position/normal/uv/color -> one Mesh.
export class Batch {
  constructor() {
    if (BATCH_F64) {
      this._sv = 0;
      this._cap = 0;
      this._st = null;
      this._vw = null;
      this._vwN = -1;
    } else {
      this.p = [];
      this.n = [];
      this.uv = [];
      this.c = [];
    }
  }
  _grow(need) {
    const cap = Math.max(256, this._cap * 2, need);
    const st = {};
    for (const k of STAGE) {
      const a = new Float64Array(cap * STRIDE[k]);
      if (this._st) a.set(this._st[k].subarray(0, this._sv * STRIDE[k]));
      st[k] = a;
    }
    this._st = st;
    this._cap = cap;
    this._vwN = -1;
  }
  vert(x, y, z, nx, ny, nz, u, v, col) {
    if (this._plain || !BATCH_F64) {
      this.p.push(x, y, z);
      this.n.push(nx, ny, nz);
      this.uv.push(u, v);
      this.c.push(col.r, col.g, col.b);
      return;
    }
    this.vertRaw(x, y, z, nx, ny, nz, u, v, col.r, col.g, col.b);
  }
  // one vertex from plain numbers (for code that used to push into b.p / b.n / b.uv / b.c directly)
  vertRaw(x, y, z, nx, ny, nz, u, v, r, g, b) {
    if (this._plain || !BATCH_F64) {
      this.p.push(x, y, z);
      this.n.push(nx, ny, nz);
      this.uv.push(u, v);
      this.c.push(r, g, b);
      return;
    }
    const i = this._sv;
    if (i >= this._cap) this._grow(i + 1);
    const S = this._st,
      i3 = i * 3,
      i2 = i * 2;
    S.p[i3] = x;
    S.p[i3 + 1] = y;
    S.p[i3 + 2] = z;
    S.n[i3] = nx;
    S.n[i3 + 1] = ny;
    S.n[i3 + 2] = nz;
    S.uv[i2] = u;
    S.uv[i2 + 1] = v;
    S.c[i3] = r;
    S.c[i3 + 1] = g;
    S.c[i3 + 2] = b;
    this._sv = i + 1;
  }
  // add any BufferGeometry (cloned + transformed). uvScale optional [su, sv]
  addGeometry(geom, matrix, color = 0xffffff, uvScale = null, uvOff = null) {
    let g = geom.index ? geom.toNonIndexed() : geom.clone();
    if (matrix) g.applyMatrix4(matrix);
    const P = g.attributes.position.array,
      N = g.attributes.normal.array,
      U = g.attributes.uv ? g.attributes.uv.array : null;
    const col = color.isColor ? color : _c.set(color);
    for (let i = 0, k = 0; i < P.length; i += 3, k += 2) {
      let u = U ? U[k] : 0,
        v = U ? U[k + 1] : 0;
      if (uvScale) {
        u *= uvScale[0];
        v *= uvScale[1];
      }
      if (uvOff) {
        u += uvOff[0];
        v += uvOff[1];
      }
      this.vert(P[i], P[i + 1], P[i + 2], N[i], N[i + 1], N[i + 2], u, v, col);
    }
    g.dispose();
  }
  // world-planar UV for a geometry (projects xz for up faces, else along wall) — used for slabs
  addGeometryWorldUV(geom, matrix, color, scale) {
    let g = geom.index ? geom.toNonIndexed() : geom.clone();
    if (matrix) g.applyMatrix4(matrix);
    const P = g.attributes.position.array,
      N = g.attributes.normal.array;
    const col = color.isColor ? color : _c.set(color);
    for (let i = 0; i < P.length; i += 3) {
      const nx = N[i],
        ny = N[i + 1],
        nz = N[i + 2];
      let u, v;
      if (Math.abs(ny) > 0.5) {
        u = P[i] * scale;
        v = P[i + 2] * scale;
      } else if (Math.abs(nx) > Math.abs(nz)) {
        u = P[i + 2] * scale;
        v = P[i + 1] * scale;
      } else {
        u = P[i] * scale;
        v = P[i + 1] * scale;
      }
      this.vert(P[i], P[i + 1], P[i + 2], nx, ny, nz, u, v, col);
    }
    g.dispose();
  }
  // horizontal quad (y up), world uv
  hquad(x0, z0, x1, z1, y, color, scale = 1) {
    const col = color.isColor ? color : _c.set(color);
    const s = scale;
    // two triangles, CCW from above => normal +y : (x0,z1),(x1,z1),(x1,z0) etc.
    this.vert(x0, y, z0, 0, 1, 0, x0 * s, z0 * s, col);
    this.vert(x0, y, z1, 0, 1, 0, x0 * s, z1 * s, col);
    this.vert(x1, y, z1, 0, 1, 0, x1 * s, z1 * s, col);
    this.vert(x0, y, z0, 0, 1, 0, x0 * s, z0 * s, col);
    this.vert(x1, y, z1, 0, 1, 0, x1 * s, z1 * s, col);
    this.vert(x1, y, z0, 0, 1, 0, x1 * s, z0 * s, col);
  }
  get empty() {
    // memory pass (Nov 19): no typed views built just to read the vertex count
    if (BATCH_F64 && !this._plain) return this._sv === 0;
    return this.p.length === 0;
  }
  _view(k) {
    if (this._vwN !== this._sv) {
      const n = this._sv,
        st = this._st;
      this._vw = st
        ? {
            p: st.p.subarray(0, n * 3),
            n: st.n.subarray(0, n * 3),
            uv: st.uv.subarray(0, n * 2),
            c: st.c.subarray(0, n * 3),
          }
        : { p: EMPTY, n: EMPTY, uv: EMPTY, c: EMPTY };
      this._vwN = n;
    }
    return this._vw[k];
  }
  build(material, { cast = true, receive = true } = {}) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.computeBoundingBox();
    g.boundingSphere = g.boundingBox.getBoundingSphere(new THREE.Sphere()); // perf: sphere from the box (one pass, not three)
    const m = new THREE.Mesh(g, material);
    m.castShadow = cast;
    m.receiveShadow = receive;
    m.matrixAutoUpdate = false;
    m.updateMatrix();
    return m;
  }
}

const EMPTY = new Float64Array(0);
if (BATCH_F64)
  for (const k of STAGE) {
    Object.defineProperty(Batch.prototype, k, {
      configurable: true,
      get() {
        return this._plain ? this['_a' + k] : this._view(k);
      },
      set(v) {
        // someone assigns its own array: this batch keeps plain arrays from now on (current data copied over)
        if (!this._plain) {
          this._plain = true;
          for (const q of STAGE) this['_a' + q] = Array.from(this._view(q));
        }
        this['_a' + k] = v;
      },
    });
  }

// Closed polygon [[x,z],...] oriented so (-dz,dx) of each edge points outward (negative signed area).
export function orient(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i],
      q = pts[(i + 1) % pts.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a > 0 ? pts.slice().reverse() : pts;
}

export function rectPts(cx, cz, w, d) {
  const hw = w / 2,
    hd = d / 2;
  return orient([
    [cx - hw, cz - hd],
    [cx + hw, cz - hd],
    [cx + hw, cz + hd],
    [cx - hw, cz + hd],
  ]);
}

export function roundRectPts(cx, cz, w, d, r, seg = 4) {
  const hw = w / 2,
    hd = d / 2;
  r = Math.min(r, hw - 0.1, hd - 0.1);
  const pts = [];
  const corners = [
    [cx + hw - r, cz + hd - r, 0],
    [cx - hw + r, cz + hd - r, Math.PI / 2],
    [cx - hw + r, cz - hd + r, Math.PI],
    [cx + hw - r, cz - hd + r, Math.PI * 1.5],
  ];
  for (const [ox, oz, a0] of corners)
    for (let i = 0; i <= seg; i++) {
      const a = a0 + (i / seg) * (Math.PI / 2);
      pts.push([ox + Math.cos(a) * r, oz + Math.sin(a) * r]);
    }
  return orient(pts);
}

// Walls around polygon from y0..y1. uv in tiles: u = perimeter/tileW + uOff, v = y/tileH + vOff
export function wallStrip(batch, pts, y0, y1, tileW, tileH, color, uOff = 0, vOff = 0) {
  const n = pts.length;
  const col = color.isColor ? color : new THREE.Color(color);
  const en = [];
  for (let i = 0; i < n; i++) {
    const p = pts[i],
      q = pts[(i + 1) % n];
    const dx = q[0] - p[0],
      dz = q[1] - p[1];
    const L = Math.hypot(dx, dz) || 1;
    en.push([-dz / L, dx / L, L]);
  }
  let u = uOff;
  for (let i = 0; i < n; i++) {
    const p = pts[i],
      q = pts[(i + 1) % n],
      e = en[i],
      prev = en[(i - 1 + n) % n],
      next = en[(i + 1) % n];
    const smooth = (a, b) =>
      a[0] * b[0] + a[1] * b[1] > 0.6 ? norm2(a[0] + b[0], a[1] + b[1]) : [a[0], a[1]];
    const n0 = smooth(e, prev),
      n1 = smooth(e, next);
    const u0 = u,
      u1 = u + e[2] / tileW;
    u = u1;
    const v0 = y0 / tileH + vOff,
      v1 = y1 / tileH + vOff;
    // a(p,y0) b(q,y0) c(q,y1) d(p,y1)
    batch.vert(p[0], y0, p[1], n0[0], 0, n0[1], u0, v0, col);
    batch.vert(q[0], y0, q[1], n1[0], 0, n1[1], u1, v0, col);
    batch.vert(q[0], y1, q[1], n1[0], 0, n1[1], u1, v1, col);
    batch.vert(p[0], y0, p[1], n0[0], 0, n0[1], u0, v0, col);
    batch.vert(q[0], y1, q[1], n1[0], 0, n1[1], u1, v1, col);
    batch.vert(p[0], y1, p[1], n0[0], 0, n0[1], u0, v1, col);
  }
}
function norm2(x, z) {
  const L = Math.hypot(x, z) || 1;
  return [x / L, z / L];
}

// Flat cap (fan) at height y, world uv * scale
export function capPoly(batch, pts, y, color, scale = 0.125) {
  const col = color.isColor ? color : new THREE.Color(color);
  let cx = 0,
    cz = 0;
  for (const p of pts) {
    cx += p[0];
    cz += p[1];
  }
  cx /= pts.length;
  cz /= pts.length;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i],
      q = pts[(i + 1) % pts.length];
    batch.vert(cx, y, cz, 0, 1, 0, cx * scale, cz * scale, col);
    batch.vert(p[0], y, p[1], 0, 1, 0, p[0] * scale, p[1] * scale, col);
    batch.vert(q[0], y, q[1], 0, 1, 0, q[0] * scale, q[1] * scale, col);
  }
}

// Inset polygon (approximate for convex shapes) toward centroid by distance d
export function insetPts(pts, d) {
  let cx = 0,
    cz = 0;
  for (const p of pts) {
    cx += p[0];
    cz += p[1];
  }
  cx /= pts.length;
  cz /= pts.length;
  return pts.map(([x, z]) => {
    const dx = x - cx,
      dz = z - cz;
    const sx = Math.sign(dx),
      sz = Math.sign(dz);
    return [x - sx * Math.min(d, Math.abs(dx)), z - sz * Math.min(d, Math.abs(dz))];
  });
}

// Parapet: thin wall ring (outer + inner faces + top) around roof
export function parapet(batch, pts, y, h, t, color) {
  const inner = orient(insetPts(pts, t));
  wallStrip(batch, pts, y, y + h, 4, 4, color);
  // inner faces: reverse orientation so normals point inward
  const rev = inner.slice().reverse();
  const n = rev.length;
  const col = color.isColor ? color : new THREE.Color(color);
  for (let i = 0; i < n; i++) {
    const p = rev[i],
      q = rev[(i + 1) % n];
    const dx = q[0] - p[0],
      dz = q[1] - p[1];
    const L = Math.hypot(dx, dz) || 1;
    const nx = dz / L,
      nz = -dx / L; // natural winding normal reversed for this order
    // winding with (a,c,b) so face normal = -(-dz,dx) = inward
    batch.vert(p[0], y, p[1], nx, 0, nz, 0, 0, col);
    batch.vert(p[0], y + h, p[1], nx, 0, nz, 0, 1, col);
    batch.vert(q[0], y + h, q[1], nx, 0, nz, 1, 1, col);
    batch.vert(p[0], y, p[1], nx, 0, nz, 0, 0, col);
    batch.vert(q[0], y + h, q[1], nx, 0, nz, 1, 1, col);
    batch.vert(q[0], y, q[1], nx, 0, nz, 1, 0, col);
  }
  // top ring
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i],
      b = pts[(i + 1) % pts.length],
      c = inner[i],
      d = inner[(i + 1) % pts.length];
    batch.vert(a[0], y + h, a[1], 0, 1, 0, 0, 0, col);
    batch.vert(c[0], y + h, c[1], 0, 1, 0, 0, 0, col);
    batch.vert(b[0], y + h, b[1], 0, 1, 0, 0, 0, col);
    batch.vert(b[0], y + h, b[1], 0, 1, 0, 0, 0, col);
    batch.vert(c[0], y + h, c[1], 0, 1, 0, 0, 0, col);
    batch.vert(d[0], y + h, d[1], 0, 1, 0, 0, 0, col);
  }
}

// ---------- Palm tree geometry (vegetation track: real species from src/world/vegetation/palms.js) ----------
// Signature kept for the old call sites. Species: o.species, else royal for seeds 40..69, palmetto for 70+, otherwise one of 12
// street-palm variants picked from the seed (coconut-heavy, plus royal, sabal, queen, date). Height is folded into the species range.
const PALM_BY_VARIANT = [
  'coconut',
  'royal',
  'coconut',
  'sabal',
  'queen',
  'date',
  'coconut',
  'queen',
  'coconut',
  'royal',
  'date',
  'sabal',
];
const PALM_RANGE = {
  coconut: [8, 15],
  royal: [12, 18],
  sabal: [6, 11],
  date: [6, 10],
  queen: [8, 12],
  palmetto: [0.1, 0.6],
};
export function palmGeometry(seed, height, lean, rnd, o = {}) {
  const species =
    o.species ||
    (seed >= 70
      ? 'palmetto'
      : seed >= 40
        ? 'royal'
        : PALM_BY_VARIANT[Math.abs(Math.round((seed - 1) / 2.3)) % PALM_BY_VARIANT.length]);
  const [h0, h1] = PALM_RANGE[species];
  let h = height;
  if (!(h >= h0 && h <= h1)) h = h0 + ((Math.abs(height) * 7.31) % 1) * (h1 - h0);
  const p = buildPalm({
    species,
    seed: seed * 3.7 + 1,
    height: h,
    lean: species === 'coconut' ? Math.min(0.38, lean * 1.3) : lean * 0.25,
    frondLen: Math.min(1.12, Math.max(0.88, o.frondLen ?? 1)),
    droop: Math.min(1.2, Math.max(0.85, o.droop ?? 1)),
    lod: o.lod | 0,
  });
  const nuts = new THREE.SphereGeometry(0.14, 5, 3).toNonIndexed();
  return {
    trunk: p.trunk,
    fronds: p.fronds,
    top: p.top,
    nuts,
    species,
    height: p.height,
    args: [seed, height, lean, o],
  };
}
