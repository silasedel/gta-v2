// Nico's canal in the running world (r12, playtest Nov 19: "he floats above the canal").
// The published map predates the canal carve, so under the channel the world still has land: a tile ground trimesh at the
// lawn's height, a seabed heightfield that treats it as shore, and city queries that say "not water". Until the map is
// rebuilt with the carve, this module makes the channel real at runtime:
//   - city.isWater / groundHeightAt / seabedDepthAt / terrain.heightAt answer "water, bed 2.0-2.5 m down" inside the channel
//     (swimming, footsteps, grass, the seabed and boats all read these),
//   - the tile ground trimeshes that reach into the channel are rebuilt without the part inside it (clipped, not dropped),
//   - the seabed heightfield is lowered under the channel each time it is rebuilt around the player,
//   - a bed collider (a trimesh on the same profile as the drawn bed) is the floor,
//   - no parked cars on the canal walls (the neighbor's van stood on the far bulkhead).
// The channel is the H-frame box of P4.canal (plan4.js); toWorld / toH convert H <-> world xz.

const TRIMESH = 6;

// bed depth below the sea at an H-frame point: 2.0 m at the walls, 2.5 m down the middle, a soft silty unevenness
export function canalDepth(C, x, z) {
  const dw = Math.max(0, Math.min(x - C.x0, C.x1 - x, C.z1 - z));
  const t = Math.min(1, dw / 4);
  const s = t * t * (3 - 2 * t);
  const n = Math.sin(x * 0.9 + z * 0.37) * Math.sin(z * 0.61 - x * 0.23);
  return 2.0 + 0.5 * s + 0.08 * n;
}

// true when (x, z) is clearly outside the box (with pad and a 2 m safety margin)
function outsideBox(b, x, z, pad) {
  const m = pad + 2;
  return x < b[0] - m || x > b[2] + m || z < b[1] - m || z > b[3] + m;
}

export function installCanal(game, o) {
  const { RAPIER: R, world: W, THREE } = game;
  const city = game.city;
  if (!city || !W || !R) return null;
  const C = o.canal,
    sea = o.sea,
    toWorld = o.toWorld,
    toH = o.toH;
  // the water's footprint in H: inside the walls, and on past the mouth into the bay a little
  const hx0 = C.x0 + 0.12,
    hx1 = C.x1 - 0.12,
    hz0 = o.wallZ - 1.0,
    hz1 = C.z1 - 0.12;
  const inH = (x, z, pad = 0) => x > hx0 - pad && x < hx1 + pad && z > hz0 - pad && z < hz1 + pad;
  // world AABB of the channel and the bay strip (corners of both H-frame boxes through toWorld)
  function worldBox() {
    const b = [Infinity, Infinity, -Infinity, -Infinity];
    const boxes = [[hx0, hz0, hx1, hz1]];
    if (o.bay) {
      boxes.push([o.bay.x0, o.bay.z0, o.bay.x1, o.bay.z1]);
    }
    for (const [a0, c0, a1, c1] of boxes) {
      for (const [hx, hz] of [
        [a0, c0],
        [a1, c0],
        [a1, c1],
        [a0, c1],
      ]) {
        const [x, z] = toWorld(hx, hz);
        b[0] = Math.min(b[0], x);
        b[1] = Math.min(b[1], z);
        b[2] = Math.max(b[2], x);
        b[3] = Math.max(b[3], z);
      }
    }
    return b;
  }
  // the bay strip past Nico's bay wall, where the set piece draws water over the map's old beach (o.bay, H frame): water for the
  // city queries too, so grass, plants and scatter never grow there (r12: a grass clump stood in the bay beside the skiff)
  const B = o.bay;
  // perf (Nov 19, memory pass): city.isWater runs for every grass / plant / scatter probe in the whole world and toH()
  // allocates an array per call. A world-space box around the channel and the bay strip rejects almost every call first.
  const near = worldBox();
  const inside = (x, z, pad = 0) => {
    if (outsideBox(near, x, z, pad)) return false;
    const [hx, hz] = toH(x, z);
    return inH(hx, hz, pad);
  };
  const inBay = (x, z) => {
    if (!B) return false;
    if (outsideBox(near, x, z, 0)) return false;
    const [hx, hz] = toH(x, z);
    return hx > B.x0 && hx < B.x1 && hz > B.z0 && hz < B.z1;
  };
  const bedAt = (x, z) => {
    const [hx, hz] = toH(x, z);
    return sea - canalDepth(C, hx, hz);
  };
  // world quad (convex) and its AABB
  const quad = [toWorld(hx0, hz0), toWorld(hx1, hz0), toWorld(hx1, hz1), toWorld(hx0, hz1)];
  const bb = quad.reduce(
    (b, [x, z]) => [Math.min(b[0], x), Math.min(b[1], z), Math.max(b[2], x), Math.max(b[3], z)],
    [Infinity, Infinity, -Infinity, -Infinity],
  );
  const cx = (bb[0] + bb[2]) / 2,
    cz = (bb[1] + bb[3]) / 2;

  patchQueries();
  const bed = buildBed();
  const st = { cut: 0, cutTris: 0, seabed: 0, noPark: 0 };
  let replaced = []; // { col, x, z }: rebuilt tile trimeshes (removed with their tile)
  const done = new WeakSet();
  let seabedTheirs = null,
    seabedMine = null,
    scanT = 0,
    noParkDone = false;
  city.onTileCollidersRemoving?.((b) => {
    replaced = replaced.filter((r) => {
      const inTile = r.x >= b.minX && r.x <= b.maxX && r.z >= b.minZ && r.z <= b.maxZ;
      if (inTile) removeSafe(r.col);
      return !inTile;
    });
  });
  game.groundGrass?.refresh?.();
  game.updaters.push(function nicoCanal(dt) {
    fixSeabed();
    if ((scanT -= dt) > 0) return;
    scanT = 1.0;
    const p = game.player?.position;
    if (p && Math.hypot(p.x - cx, p.z - cz) > 260) return;
    cutTiles();
    if (!noParkDone) noParkDone = noParkWalls();
  });

  // ---- city queries ----
  function patchQueries() {
    const isW = city.isWater?.bind(city),
      gh = city.groundHeightAt?.bind(city),
      sd = city.seabedDepthAt?.bind(city);
    city.isWater = (x, z) => inside(x, z) || inBay(x, z) || (isW ? isW(x, z) : false);
    if (gh) city.groundHeightAt = (x, z, y) => (inside(x, z) ? bedAt(x, z) : gh(x, z, y));
    if (sd) city.seabedDepthAt = (x, z) => (inside(x, z) ? sea - bedAt(x, z) : sd(x, z));
    const T = city.terrain;
    if (T?.heightAt) {
      const th = T.heightAt.bind(T);
      T.heightAt = (x, z) => (inside(x, z) ? bedAt(x, z) : th(x, z));
    }
  }

  // ---- the bed: a trimesh on a 1 m grid (H frame), one fixed body ----
  function buildBed() {
    const nx = Math.ceil(hx1 - hx0) + 1,
      nz = Math.ceil(hz1 - hz0) + 1,
      v = new Float32Array(nx * nz * 3),
      idx = [];
    for (let j = 0; j < nz; j++)
      for (let i = 0; i < nx; i++) {
        const hx = hx0 - 0.3 + ((hx1 - hx0 + 0.6) * i) / (nx - 1),
          hz = hz0 + ((hz1 - hz0 + 0.3) * j) / (nz - 1),
          [x, z] = toWorld(hx, hz),
          k = (j * nx + i) * 3;
        v[k] = x;
        v[k + 1] = sea - canalDepth(C, hx, hz);
        v[k + 2] = z;
      }
    for (let j = 0; j < nz - 1; j++)
      for (let i = 0; i < nx - 1; i++) {
        const a = j * nx + i;
        idx.push(a, a + nx, a + 1, a + 1, a + nx, a + nx + 1);
      }
    const col = W.createCollider(R.ColliderDesc.trimesh(v, Uint32Array.from(idx)));
    try {
      game.footSurface?.tagCollider?.(col, 'sand');
    } catch (e) {
      /* footsteps module off */
    }
    return col;
  }

  // ---- tile ground: rebuild every tile trimesh that reaches into the channel without the part inside it ----
  function cutTiles() {
    const found = [];
    W.collidersWithAabbIntersectingAabb(
      { x: cx, y: 0, z: cz },
      { x: (bb[2] - bb[0]) / 2, y: 30, z: (bb[3] - bb[1]) / 2 },
      (c) => {
        if (c !== bed && !done.has(c) && c.shape?.type === TRIMESH && !c.parent()) found.push(c);
        return true;
      },
    );
    for (const c of found) {
      done.add(c);
      const t = c.translation(),
        q = c.rotation();
      if (Math.abs(t.x) + Math.abs(t.y) + Math.abs(t.z) > 1e-3 || Math.abs(q.w) < 0.9999) continue;
      const v = c.vertices(),
        ix = c.indices();
      if (!v || !ix) continue;
      const out = clipSoup(v, ix);
      if (!out) continue;
      try {
        const nc = W.createCollider(R.ColliderDesc.trimesh(out.v, out.i));
        done.add(nc);
        removeSafe(c);
        replaced.push({ col: nc, x: out.cx, z: out.cz });
        st.cut++;
        st.cutTris += out.dropped;
      } catch (e) {
        console.warn('[nicoHouse canal] tile cut', e);
      }
    }
  }
  // the triangle soup minus the channel quad (null when nothing of it is inside); y is interpolated along the cuts
  function clipSoup(v, ix) {
    const keep = [];
    let dropped = 0,
      sx = 0,
      sz = 0;
    for (let t = 0; t < ix.length; t += 3) {
      const tri = [0, 1, 2].map((k) => [
        v[ix[t + k] * 3],
        v[ix[t + k] * 3 + 1],
        v[ix[t + k] * 3 + 2],
      ]);
      sx += tri[0][0];
      sz += tri[0][2];
      const mnx = Math.min(tri[0][0], tri[1][0], tri[2][0]),
        mxx = Math.max(tri[0][0], tri[1][0], tri[2][0]),
        mnz = Math.min(tri[0][2], tri[1][2], tri[2][2]),
        mxz = Math.max(tri[0][2], tri[1][2], tri[2][2]);
      // deep geometry (below the bed) and triangles off the channel's AABB stay as they are
      const low = Math.max(tri[0][1], tri[1][1], tri[2][1]) < sea - 2.6;
      if (low || mxx < bb[0] || mnx > bb[2] || mxz < bb[1] || mnz > bb[3]) {
        keep.push(tri);
        continue;
      }
      const pieces = minusQuad(tri);
      if (pieces.length === 1 && pieces[0] === tri) keep.push(tri);
      else {
        dropped++;
        for (const p of pieces) keep.push(p);
      }
    }
    if (!dropped) return null;
    const n = ix.length / 3;
    const out = new Float32Array(keep.length * 9);
    keep.forEach((tri, k) => {
      for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) out[k * 9 + a * 3 + b] = tri[a][b];
    });
    const ii = new Uint32Array(keep.length * 3);
    for (let k = 0; k < ii.length; k++) ii[k] = k;
    return { v: out, i: ii, dropped, cx: sx / n, cz: sz / n };
  }
  // a triangle minus the convex channel quad: split by each quad edge; the parts in front of an edge are outside (kept),
  // what lies behind every edge is inside (dropped). Returns [tri] itself when it does not touch the quad.
  function minusQuad(tri) {
    let rest = tri;
    const kept = [];
    let touched = false;
    for (let e = 0; e < 4 && rest.length >= 3; e++) {
      const a = quad[e],
        b = quad[(e + 1) % 4];
      // outward normal of the quad edge (quad wound H-frame: x0z0 -> x1z0 -> x1z1 -> x0z1)
      const side = (p) => (b[0] - a[0]) * (p[2] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
      const sgn = quadSign();
      const [front, back] = splitPoly(rest, (p) => -sgn * side(p));
      if (back.length < 3) {
        // what is left lies wholly outside this edge
        if (!touched) return [tri];
        fan(front, kept);
        return kept;
      }
      if (front.length >= 3) {
        touched = true;
        fan(front, kept);
      }
      rest = back;
    }
    if (!touched && rest.length >= 3) return [];
    return kept;
  }
  function quadSign() {
    const [a, b, c] = quad;
    return Math.sign((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) || 1;
  }
  // split a convex polygon by f(p) > 0 (front) / <= 0 (back)
  function splitPoly(poly, f) {
    const front = [],
      back = [];
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i],
        q = poly[(i + 1) % poly.length],
        fp = f(p),
        fq = f(q);
      (fp > 0 ? front : back).push(p);
      if (fp > 0 !== fq > 0) {
        const t = fp / (fp - fq),
          m = [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t];
        front.push(m);
        back.push(m);
      }
    }
    return [front, back];
  }
  function fan(poly, out) {
    for (let i = 1; i + 1 < poly.length; i++) out.push([poly[0], poly[i], poly[i + 1]]);
  }
  function removeSafe(c) {
    try {
      if (c && W.getCollider(c.handle) === c) W.removeCollider(c, false);
    } catch (e) {
      /* already gone */
    }
  }

  // ---- seabed heightfield (src/world/miami/seabed.js): lowered under the channel after every rebuild ----
  function fixSeabed() {
    const S = city.seabed;
    if (!S || !S.mesh) return;
    const theirs = S.collider;
    if (theirs === seabedTheirs) return;
    seabedTheirs = theirs;
    if (seabedMine) removeSafe(seabedMine);
    seabedMine = null;
    if (!theirs) return;
    const pos = S.mesh.geometry.attributes.position.array,
      N = Math.round(Math.sqrt(pos.length / 3)),
      x0 = pos[0],
      z0 = pos[2],
      size = pos[(N - 1) * 3] - x0;
    if (
      !(N > 2) ||
      x0 > bb[2] + 3 ||
      x0 + size < bb[0] - 3 ||
      z0 > bb[3] + 3 ||
      z0 + size < bb[1] - 3
    )
      return;
    let n = 0;
    for (let k = 0; k < N * N; k++) {
      const x = pos[k * 3],
        z = pos[k * 3 + 2];
      if (!inside(x, z, 2.1)) continue;
      const [hx, hz] = toH(x, z),
        y =
          sea -
          canalDepth(C, Math.min(hx1, Math.max(hx0, hx)), Math.min(hz1, Math.max(hz0, hz))) -
          0.08;
      if (pos[k * 3 + 1] > y) {
        pos[k * 3 + 1] = y;
        n++;
      }
    }
    if (!n) return;
    S.mesh.geometry.attributes.position.needsUpdate = true;
    const hs = new Float32Array(N * N);
    for (let r = 0; r < N; r++)
      for (let c = 0; c < N; c++) hs[r + c * N] = pos[(r * N + c) * 3 + 1];
    try {
      removeSafe(theirs);
      seabedMine = W.createCollider(
        R.ColliderDesc.heightfield(N - 1, N - 1, hs, { x: size, y: 1, z: size }).setTranslation(
          x0 + size / 2,
          0,
          z0 + size / 2,
        ),
      );
      st.seabed++;
    } catch (e) {
      console.warn('[nicoHouse canal] seabed', e);
    }
  }

  // ---- no parking on the canal walls (and the cars already parked there go) ----
  function noParkWalls() {
    const add = game.vehicles?.addNoParkZone;
    if (!add) return false;
    for (let hz = o.wallZ; hz <= C.z1 + 0.1; hz += 3)
      for (const hx of [C.x0, C.x1]) {
        const [x, z] = toWorld(hx, hz);
        add(x, z, 3.6);
        st.noPark++;
      }
    for (let hx = C.x0; hx <= C.x1 + 0.1; hx += 3) {
      const [x, z] = toWorld(hx, C.z1);
      add(x, z, 3.6);
      st.noPark++;
    }
    return true;
  }

  void THREE;
  return { inside, bedAt, stats: st, bed };
}
