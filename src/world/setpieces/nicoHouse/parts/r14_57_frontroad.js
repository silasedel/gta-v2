// Nico's house, part 57 (Nov 19, front-door view: docs/v2/plan/nico_house/front_door_south_view_TARGET.webp): the paved road
// across the front of the lot and the boats on trailers. Yard frame G (yard.data.js FRONT_ROAD, BOATS).
//
// The road links the dead ends of the world road graph around the lot (the turning circle at the canal end, Pelican Point Ln and
// the street to the west), so from the front door a normal paved road runs straight left to right across the view: sun-bleached
// asphalt (the city's road scans), faded double yellow center lines (open at the Pelican Point Ln mouth) and a shallow puddle.
// It lies 5 cm over the terrain (as the city roads do) with a skirt down into it; the yard sheet sinks under it like under any
// asphalt (nicoHouse.v2.js roadDist), so people and cars stand on the terrain collider. Three meshes, no per-frame work.
import { FRONT_ROAD, BOATS } from '../yard.data.js';
import { loadKeysModels } from '../models.js';

export const order = 57;

const BASE = (typeof import.meta !== 'undefined' && import.meta.env?.BASE_URL) || '/';
const OFF = typeof location !== 'undefined' && /[?&]frontroad=0\b/.test(location.search);
const LIFT = 0.05;

export function build(ctx) {
  if (OFF || !FRONT_ROAD) {
    return;
  }
  buildRoad(ctx);
  buildBoats(ctx);
}

function groundY(ctx, x, z) {
  const gT = ctx.opts.groundAt || (() => 0);
  const yG = ctx.yardY || (() => -99);
  return Math.max(gT(x, z), yG(x, z));
}

function roadTexture(THREE, file, srgb) {
  const t = new THREE.TextureLoader().load(BASE + 'assets/textures/roads/' + file);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  if (srgb) {
    t.colorSpace = THREE.SRGBColorSpace;
  }
  return t;
}

// a polyline rounded at its corners (two Chaikin passes, ends kept), then sampled every ~1 m: [{ x, z, s, tx, tz }]
function samplePath(pts) {
  let p = pts.map((q) => [q[0], q[1]]);
  for (let k = 0; k < 2; k++) {
    const out = [p[0]];
    for (let i = 0; i < p.length - 1; i++) {
      const [ax, az] = p[i];
      const [bx, bz] = p[i + 1];
      if (i > 0) {
        out.push([ax * 0.75 + bx * 0.25, az * 0.75 + bz * 0.25]);
      }
      if (i < p.length - 2) {
        out.push([ax * 0.25 + bx * 0.75, az * 0.25 + bz * 0.75]);
      }
    }
    out.push(p[p.length - 1]);
    p = out;
  }
  const res = [];
  let s = 0;
  for (let i = 0; i < p.length - 1; i++) {
    const [ax, az] = p[i];
    const [bx, bz] = p[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    const n = Math.max(1, Math.round(len / 1.0));
    for (let k = i === 0 ? 0 : 1; k <= n; k++) {
      const t = k / n;
      res.push({ x: ax + (bx - ax) * t, z: az + (bz - az) * t, s: s + len * t });
    }
    s += len;
  }
  for (let i = 0; i < res.length; i++) {
    const a = res[Math.max(0, i - 1)];
    const b = res[Math.min(res.length - 1, i + 1)];
    const l = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    res[i].tx = (b.x - a.x) / l;
    res[i].tz = (b.z - a.z) / l;
  }
  return res;
}

function buildRoad(ctx) {
  const { THREE } = ctx;
  const R = FRONT_ROAD;
  const gT = ctx.opts.groundAt || (() => 0);
  const hw = R.halfWidth;
  // across the road: a skirt down into the ground at both edges, then the surface
  const across = [-hw - 0.05, -hw, -hw * 0.72, -hw * 0.3, 0, hw * 0.3, hw * 0.72, hw, hw + 0.05];
  const drop = (j) => (j === 0 || j === across.length - 1 ? -0.3 : 0);
  const noise = (x, z) =>
    Math.sin(x * 0.37 + Math.sin(z * 0.23) * 2) * Math.cos(z * 0.31 + Math.sin(x * 0.19) * 2);
  const pos = [];
  const uv = [];
  const col = [];
  const idx = [];
  const lp = [];
  const li = [];
  const W = across.length;
  R.paths.forEach((path, pi) => {
    const S = samplePath(path.pts);
    // the spur sits a hair under the main road where they overlap
    const lift = LIFT - pi * 0.006;
    const base = pos.length / 3;
    for (const q of S) {
      const nx = -q.tz;
      const nz = q.tx;
      for (let j = 0; j < W; j++) {
        const o = across[j];
        const x = q.x + nx * o;
        const z = q.z + nz * o;
        pos.push(x, gT(x, z) + lift + drop(j), z);
        uv.push(o / 3.2, q.s / 3.2);
        // sun-bleached gray, dusty toward the edges, a darker oil band in each lane, soft patches
        const edge = Math.min(1, Math.abs(o) / hw);
        const n = noise(x * 0.6, z * 0.6) * 0.5 + 0.5;
        const lane = Math.exp(-((Math.abs(o) - hw * 0.5) ** 2) / 0.6);
        const k = 1.22 + 0.1 * n - 0.08 * lane;
        const dust = edge > 0.9 ? 0.22 : 0;
        col.push(k + dust * 0.32, k + dust * 0.26, k + dust * 0.14);
      }
    }
    for (let i = 0; i < S.length - 1; i++) {
      for (let j = 0; j < W - 1; j++) {
        const a = base + i * W + j;
        const b = a + 1;
        const c = a + W;
        const d = c + 1;
        idx.push(a, b, c, b, d, c);
      }
    }
    // faded double yellow center lines, open at the gap (the mouth of a side road) and short of the ends
    if (!path.lines) {
      return;
    }
    const total = S[S.length - 1].s;
    const open = (q) =>
      q.s < 1.0 ||
      q.s > total - 1.0 ||
      (path.gap && Math.hypot(q.x - path.gap[0], q.z - path.gap[1]) < path.gapR);
    for (const off of [-0.11, 0.11]) {
      for (let i = 0; i < S.length - 1; i++) {
        const q0 = S[i];
        const q1 = S[i + 1];
        if (open(q0) || open(q1)) {
          continue;
        }
        const b0 = lp.length / 3;
        for (const q of [q0, q1]) {
          for (const w of [-0.05, 0.05]) {
            const x = q.x - q.tz * (off + w);
            const z = q.z + q.tx * (off + w);
            lp.push(x, gT(x, z) + lift + 0.012, z);
          }
        }
        li.push(b0, b0 + 1, b0 + 2, b0 + 1, b0 + 3, b0 + 2);
      }
    }
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const asphalt = new THREE.MeshStandardMaterial({
    map: roadTexture(THREE, 'asphalt_col.jpg', true),
    normalMap: roadTexture(THREE, 'asphalt_nrm.jpg', false),
    roughnessMap: roadTexture(THREE, 'asphalt_arm.jpg', false),
    vertexColors: true,
    roughness: 1,
    metalness: 0,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -2,
  });
  asphalt.name = 'asphalt:nicoFrontRoad';
  addStatic(ctx, new THREE.Mesh(geo, asphalt), 'nh_frontroad', true);

  const lgeo = new THREE.BufferGeometry();
  lgeo.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3));
  lgeo.setIndex(li);
  lgeo.computeVertexNormals();
  const paint = new THREE.MeshStandardMaterial({
    color: 0xc9a542,
    roughness: 0.85,
    metalness: 0,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -4,
  });
  paint.name = 'paint:nicoFrontRoad';
  addStatic(ctx, new THREE.Mesh(lgeo, paint), 'nh_frontroad_lines', false);

  // ---- a shallow puddle on the asphalt (reflects the sky) ----
  if (R.puddle) {
    const P = R.puddle;
    const pg = new THREE.CircleGeometry(1, 28);
    pg.rotateX(-Math.PI / 2);
    const pa = pg.attributes.position;
    const c = Math.cos(P.rot || 0);
    const sn = Math.sin(P.rot || 0);
    for (let i = 0; i < pa.count; i++) {
      const lx = pa.getX(i);
      const lz = pa.getZ(i);
      const a = Math.atan2(lz, lx);
      const wob = 1 + 0.18 * Math.sin(a * 3 + 1.3) + 0.08 * Math.sin(a * 7);
      const qx = lx * P.a * wob;
      const qz = lz * P.b * wob;
      const x = P.x + qx * c + qz * sn;
      const z = P.z - qx * sn + qz * c;
      pa.setXYZ(i, x, gT(x, z) + LIFT + 0.016, z);
    }
    pg.computeVertexNormals();
    // shallow water over gray asphalt: a mid sky-tinted gray (a near-black base read as a navy stain from the deck)
    const water = new THREE.MeshStandardMaterial({
      color: 0x59636b,
      roughness: 0.03,
      metalness: 0,
      envMapIntensity: 1.3,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -6,
    });
    water.name = 'water:nicoFrontRoadPuddle';
    addStatic(ctx, new THREE.Mesh(pg, water), 'nh_frontroad_puddle', false);
  }
}

function addStatic(ctx, mesh, name, receive) {
  mesh.name = name;
  mesh.receiveShadow = receive;
  mesh.castShadow = false;
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();
  ctx.groups.site.add(mesh);
}

// ---- boats on galvanized trailers (yard.data.js BOATS): a library hull on a code-built trailer, one box collider each ----
function buildBoats(ctx) {
  const { THREE, kit, mat, col } = ctx;
  if (!BOATS?.length) {
    return;
  }
  const M = kit.M;
  const B = ctx.site;
  const D = ctx.detail;
  const MP = mat.metalPaint();
  const RUB = mat.rubber ? mat.rubber() : mat.matte();
  const r = kit.rng(5714);
  for (const bt of BOATS) {
    const h = bt.heading;
    const c = Math.cos(h);
    const s = Math.sin(h);
    // local (u across, v along the hull, +v = bow) -> yard frame
    const at = (u, v) => [bt.x + u * c + v * s, bt.z - u * s + v * c];
    const y0 = groundY(ctx, bt.x, bt.z);
    const half = bt.len / 2;
    for (const side of [-1, 1]) {
      const [x0, z0] = at(side * 0.72, -half + 0.3);
      const [x1, z1] = at(side * 0.72, half - 0.6);
      B.strut(MP, [x0, y0 + 0.42, z0], [x1, y0 + 0.42, z1], 0.08, 0.1, {
        color: 0x9a9c9c,
        rand: r,
      });
    }
    {
      const [x0, z0] = at(0, half - 0.8);
      const [x1, z1] = at(0, half + 0.9);
      B.strut(MP, [x0, y0 + 0.4, z0], [x1, y0 + 0.36, z1], 0.1, 0.1, { color: 0x9a9c9c, rand: r });
    }
    for (const side of [-1, 1]) {
      const [wx, wz] = at(side * 0.95, -0.3);
      D.cyl(RUB, 0.3, 0.3, 0.2, M(wx, y0 + 0.3, wz, 0, h, Math.PI / 2), {
        color: 0x1a1a1a,
        seg: 18,
      });
      D.cyl(MP, 0.14, 0.14, 0.21, M(wx, y0 + 0.3, wz, 0, h, Math.PI / 2), {
        color: 0xbfc0bc,
        seg: 14,
      });
    }
    col.box(bt.x, y0 + 0.9, bt.z, 2.2, 1.8, bt.len + 0.8, { ry: h, tag: 'vehicle' });
  }
  const lib = loadKeysModels(THREE, ['skiff_cc']);
  ctx.async.push(
    lib.ready
      .then(() => {
        const names = lib.names('skiff_cc');
        const p = names.length ? lib.piece('skiff_cc', names[0]) : null;
        if (!p) {
          return;
        }
        const ext = new THREE.Vector3();
        p.box.getSize(ext);
        for (const bt of BOATS) {
          const g = new THREE.Group();
          const inner = new THREE.Group();
          // the hull's long axis along local +Z (the trailer's v)
          if (ext.x > ext.z) {
            inner.rotation.y = Math.PI / 2;
          }
          g.add(inner);
          for (const q of p.parts) {
            const m = new THREE.Mesh(q.geometry, q.material);
            m.castShadow = true;
            m.raycast = () => {};
            inner.add(m);
          }
          inner.updateMatrixWorld(true);
          const wb = new THREE.Box3().setFromObject(inner);
          const k = bt.len / Math.max(0.1, wb.max.z - wb.min.z);
          inner.scale.setScalar(k);
          inner.position.set(
            -((wb.min.x + wb.max.x) / 2) * k,
            0.55 - wb.min.y * k,
            -((wb.min.z + wb.max.z) / 2) * k,
          );
          g.position.set(bt.x, groundY(ctx, bt.x, bt.z), bt.z);
          g.rotation.y = bt.heading;
          ctx.groups.detail.add(g);
        }
      })
      .catch(() => {}),
  );
}
