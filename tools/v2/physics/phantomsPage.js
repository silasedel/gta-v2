// Collision-vs-drawn audit, page side (driven by tools/v2/physics/phantoms.mjs). Defines window.__ph:
//   __ph.roads(cx, cz, rad)    rays along every road lane inside the circle at car height; each collider hit is checked
//                              for a drawn mesh within 0.5 m (phantom = nothing drawn), each solid mesh hit for a
//                              collider within 0.35 m behind it (missing collider = you drive through it)
//   __ph.open(cx, cz, rad, n)  the same on open ground (not road, not water), 8 directions per point
//   __ph.terrain(cx, cz, rad, step)  drawn ground height vs collider ground height vs city.groundHeightAt on a grid
//   __ph.owner(collider)       where the collider was created (stack recorded by the init hook in phantoms.mjs)
// The three.js side uses every VISIBLE mesh (foliage too: a bush you can see is not a phantom). Materials are raycast
// double-sided so a hit point inside a mesh still finds it.
(() => {
  const g = window.game;
  const T = g.THREE || window.THREE;
  const R = g.RAPIER;
  const W = g.world;
  const QF = R.QueryFilterFlags;
  const STATIC_ONLY = QF.EXCLUDE_DYNAMIC | QF.EXCLUDE_KINEMATIC | QF.EXCLUDE_SENSORS;
  const NO_SENSORS = QF.EXCLUDE_SENSORS;

  // Not solid by design: walking or driving through these is expected.
  const SOFT_NAME =
    /leaf|leaves|grass|foliage|canopy|frond|bush|shrub|flower|fern|weed|vine|ivy|decal|water|ocean|sea|sky|cloud|shadow|pool|glow|light|beam|particle|smoke|fog|marker|blob|contact|ground_cover|lawn|paint|mark|wire|cable|line|helper|hud|reticle|puddle|crown|palm_top|umbrella|awning|reed|sawgrass|moss|flora|veg|rain|spray|wake|foam|splash|road|asphalt|sidewalk|terrain|sand|ground|seabed|deck|ramp/i;
  // Drawn ground: the meshes whose top surface people and cars stand on.
  const GROUND_NAME = /terrain|ground|road|sidewalk|plaza|sand|beach|seabed|yard|lot|curb|tile/i;
  const NOT_GROUND = /grass|weed|flower|decal|line|mark|puddle|leaf|shadow|blob/i;

  const raycaster = new T.Raycaster();
  const tmpSphere = new T.Sphere();
  const tmpVec = new T.Vector3();
  const tmpDir = new T.Vector3();
  const tmpOrg = new T.Vector3();
  const rapierRay = new R.Ray({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 });

  function materialOf(o) {
    return Array.isArray(o.material) ? o.material[0] : o.material;
  }

  function labelOf(o) {
    const m = materialOf(o);
    const name = o.name || o.parent?.name || o.parent?.parent?.name || '?';
    return (name + '|' + (m?.name || m?.type || '')).slice(0, 90);
  }

  // A mesh is drawn when it and all its parents are visible and its material actually writes color.
  function isDrawn(o) {
    const m = materialOf(o);
    if (!m || m.visible === false || m.colorWrite === false) {
      return false;
    }
    if (m.transparent && m.opacity < 0.05) {
      return false;
    }
    if (o.isInstancedMesh && o.count === 0) {
      return false;
    }
    return !!o.geometry;
  }

  // Mesh index for one stop: every drawn mesh, and every instance of every drawn InstancedMesh, near (cx, cz) becomes an
  // item { mesh, matrix, cx, cy, cz, r } (world bounding sphere) in a uniform 8 m grid, so a short ray only tests the
  // items of the cells it crosses (raycasting whole InstancedMeshes of grass per ray took minutes per stop).
  const CELL = 8;
  const tmpMat = new T.Matrix4();
  const proxy = new T.Mesh();

  function makeIndex() {
    return { cells: new Map(), big: [], n: 0 };
  }

  function addItem(idx, mesh, matrix, rad) {
    const bs = mesh.geometry.boundingSphere;
    tmpSphere.copy(bs).applyMatrix4(matrix);
    const it = {
      mesh,
      matrix: matrix.clone(),
      cx: tmpSphere.center.x,
      cy: tmpSphere.center.y,
      cz: tmpSphere.center.z,
      r: tmpSphere.radius,
    };
    if (Math.hypot(it.cx - idx.x, it.cz - idx.z) - it.r > rad) {
      return;
    }
    idx.n++;
    if (it.r > CELL * 3) {
      idx.big.push(it);
      return;
    }
    const i0 = Math.floor((it.cx - it.r) / CELL);
    const i1 = Math.floor((it.cx + it.r) / CELL);
    const j0 = Math.floor((it.cz - it.r) / CELL);
    const j1 = Math.floor((it.cz + it.r) / CELL);
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const k = i + ',' + j;
        let a = idx.cells.get(k);
        if (!a) {
          a = [];
          idx.cells.set(k, a);
        }
        a.push(it);
      }
    }
  }

  function addMesh(idx, o, rad) {
    if (!o.geometry.boundingSphere) {
      o.geometry.computeBoundingSphere();
    }
    if (!o.isInstancedMesh) {
      addItem(idx, o, o.matrixWorld, rad);
      return;
    }
    for (let i = 0; i < o.count; i++) {
      o.getMatrixAt(i, tmpMat);
      const e = tmpMat.elements;
      if (e[0] === 0 && e[1] === 0 && e[2] === 0) {
        continue;
      }
      const x = o.matrixWorld.elements[12] + e[12];
      const z = o.matrixWorld.elements[14] + e[14];
      if (Math.hypot(x - idx.x, z - idx.z) > rad + 30) {
        continue;
      }
      tmpMat.premultiply(o.matrixWorld);
      addItem(idx, o, tmpMat, rad);
    }
  }

  // Mid / far LOD meshes (city.js nearCut) discard, in the fragment shader, every pixel of a tile that has a finished
  // near build. A raycast must do the same, or it finds coarse LOD ground and far facades the player never sees.
  let nearTiles = () => false;
  function nearTileTest(cx, cz) {
    const st = g.city?.streamer;
    if (!st?.nearMask) {
      return () => false;
    }
    const N = 15;
    const arr = new Float32Array(N * N);
    const o = st.nearMask(arr, N, cx, cz);
    return (tx, tz) => {
      const i = tx - o[0];
      const j = tz - o[1];
      if (i < 0 || j < 0 || i >= N || j >= N) {
        return false;
      }
      return arr[j * N + i] > 0.5;
    };
  }
  const cutCache = new WeakMap();
  function hasNearCut(mat) {
    if (!mat) {
      return false;
    }
    let v = cutCache.get(mat);
    if (v === undefined) {
      v = /nearCut|uNearMask/.test(String(mat.onBeforeCompile || ''));
      cutCache.set(mat, v);
    }
    return v;
  }
  // true when the hit face is cut away by the near-tile mask
  function cutAway(h, mesh) {
    const at = mesh.geometry.attributes.aTile;
    if (!at || !h.face) {
      return false;
    }
    const mat = Array.isArray(mesh.material)
      ? mesh.material[h.face.materialIndex || 0]
      : mesh.material;
    const lod = /^chunk-(mid|far)|terrain-lod/.test(mesh.name || '') || mat?.name === 'facade-far';
    if (!lod && !hasNearCut(mat)) {
      return false;
    }
    const tx = Math.floor(at.getX(h.face.a) + 0.5);
    const tz = Math.floor(at.getY(h.face.a) + 0.5);
    return nearTiles(tx, tz);
  }

  // Visible meshes near (cx, cz): { all, solid, ground } mesh indexes.
  function collect(cx, cz, rad) {
    const all = makeIndex();
    const solid = makeIndex();
    const ground = makeIndex();
    for (const idx of [all, solid, ground]) {
      idx.x = cx;
      idx.z = cz;
    }
    nearTiles = nearTileTest(cx, cz);
    g.scene.traverseVisible((o) => {
      if (!(o.isMesh || o.isInstancedMesh)) {
        return;
      }
      // tileBatch.js BatchedMeshes are draw-only copies of tile meshes (with freed, stale ranges); the originals stay
      // in the scene graph and are what we test
      if (o.isBatchedMesh) {
        return;
      }
      if (!isDrawn(o)) {
        return;
      }
      const nm = labelOf(o) + ' ' + (o.parent?.name || '');
      addMesh(all, o, rad);
      if (GROUND_NAME.test(nm) && !NOT_GROUND.test(nm)) {
        addMesh(ground, o, rad);
      }
      if (o.isSkinnedMesh) {
        return;
      }
      const m = materialOf(o);
      if (SOFT_NAME.test(nm)) {
        return;
      }
      if ((m.transparent && m.opacity < 0.9) || m.alphaTest > 0.05 || m.depthWrite === false) {
        return;
      }
      addMesh(solid, o, rad);
    });
    return { all, solid, ground };
  }

  // Items whose cells the segment origin -> origin + dir * far crosses (plus the big ones).
  const seenItems = new Set();
  function itemsAlong(idx, origin, dir, far) {
    seenItems.clear();
    const out = [];
    const steps = Math.ceil(far / (CELL / 2)) + 1;
    for (let s = 0; s <= steps; s++) {
      const t = Math.min(far, (s * CELL) / 2);
      const x = origin.x + dir.x * t;
      const z = origin.z + dir.z * t;
      const a = idx.cells.get(Math.floor(x / CELL) + ',' + Math.floor(z / CELL));
      if (!a) {
        continue;
      }
      for (const it of a) {
        if (!seenItems.has(it)) {
          seenItems.add(it);
          out.push(it);
        }
      }
    }
    for (const it of idx.big) {
      out.push(it);
    }
    return out;
  }

  // Nearest three.js hit of a ray against a mesh index, double-sided. Returns the intersection or null.
  const raySphere = new T.Sphere();
  function meshRay(idx, origin, dir, far) {
    raycaster.set(origin, dir);
    raycaster.near = 0;
    raycaster.far = far;
    let best = null;
    const hits = [];
    for (const it of itemsAlong(idx, origin, dir, far)) {
      raySphere.center.set(it.cx, it.cy, it.cz);
      raySphere.radius = it.r;
      if (!raycaster.ray.intersectsSphere(raySphere)) {
        continue;
      }
      const m = it.mesh;
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      const sides = mats.map((mt) => mt.side);
      for (const mt of mats) {
        mt.side = T.DoubleSide;
      }
      proxy.geometry = m.geometry;
      proxy.material = m.material;
      proxy.matrixWorld.copy(it.matrix);
      hits.length = 0;
      try {
        T.Mesh.prototype.raycast.call(proxy, raycaster, hits);
      } catch (e) {
        // a broken geometry must not stop the audit
      }
      mats.forEach((mt, i) => {
        mt.side = sides[i];
      });
      for (const h of hits) {
        if (cutAway(h, m)) {
          continue;
        }
        if (h.distance <= far && (!best || h.distance < best.distance)) {
          best = h;
          best.object = m;
          best.worldMatrix = it.matrix;
        }
      }
    }
    return best;
  }

  // Face normal of a three.js hit in world space (y component only is needed).
  function hitNormalY(h) {
    if (!h.face) {
      return 0;
    }
    tmpVec.copy(h.face.normal).transformDirection(h.worldMatrix || h.object.matrixWorld);
    return tmpVec.y;
  }

  // Probe directions around a hit point: the 6 axes and the 8 diagonals.
  const PROBE = [];
  for (const x of [-1, 0, 1]) {
    for (const y of [-1, 0, 1]) {
      for (const z of [-1, 0, 1]) {
        if (x || y || z) {
          PROBE.push(new T.Vector3(x, y, z).normalize());
        }
      }
    }
  }

  // Is anything drawn within r of point p (walls, poles, trunks; flat ground faces do not count)?
  function drawnNear(list, p, r) {
    for (const d of PROBE) {
      tmpOrg.copy(p);
      const h = meshRay(list, tmpOrg, d, r);
      if (h && Math.abs(hitNormalY(h)) < 0.75) {
        return h;
      }
    }
    return null;
  }

  function colliderRay(origin, dir, far, flags) {
    rapierRay.origin.x = origin.x;
    rapierRay.origin.y = origin.y;
    rapierRay.origin.z = origin.z;
    rapierRay.dir.x = dir.x;
    rapierRay.dir.y = dir.y;
    rapierRay.dir.z = dir.z;
    try {
      return W.castRayAndGetNormal(rapierRay, far, true, flags);
    } catch (e) {
      return null;
    }
  }

  function bodyKind(c) {
    const b = c.parent();
    if (!b) {
      return 'static';
    }
    if (b.isDynamic()) {
      return 'dynamic';
    }
    if (b.isKinematic()) {
      return 'kinematic';
    }
    return 'fixed';
  }

  // body speed (m/s): a moving car's drawn mesh is interpolated between physics steps and can trail its collider
  function speedOf(c) {
    const b = c.parent();
    if (!b || !b.isDynamic()) {
      return 0;
    }
    const v = b.linvel();
    return +Math.hypot(v.x, v.z).toFixed(1);
  }

  const SHAPES = [
    'ball',
    'cuboid',
    'capsule',
    'segment',
    'polyline',
    'triangle',
    'trimesh',
    'heightfield',
  ];

  function owner(c) {
    const reg = window.__colOwners;
    const rec = reg ? reg.get(c.handle) : null;
    return rec || 'unknown';
  }

  // Collider ground top under (x, z), searched downward from y0 (static colliders only).
  function colliderGround(x, z, y0, depth = 8) {
    tmpOrg.set(x, y0, z);
    tmpDir.set(0, -1, 0);
    const h = colliderRay(tmpOrg, tmpDir, depth, STATIC_ONLY);
    if (!h) {
      return null;
    }
    return { y: y0 - h.timeOfImpact, n: h.normal.y, c: h.collider };
  }

  function playerPos() {
    return g.player?.position || { x: 1e9, y: 0, z: 1e9 };
  }

  // One horizontal probe: a collider ray and a mesh ray from origin along dir. Adds findings to res.
  function probe(res, lists, origin, dir, far, h, where) {
    const ch = colliderRay(origin, dir, far, NO_SENSORS);
    const mh = meshRay(lists.solid, origin, dir, far);
    const dc = ch ? ch.timeOfImpact : Infinity;
    const dm = mh ? mh.distance : Infinity;
    res.rays++;
    const P = playerPos();
    // a collider hit that is a wall (not ground or a ramp)
    if (dc < far && Math.abs(ch.normal.y) < 0.7) {
      const p = origin.clone().addScaledVector(dir, dc);
      if (Math.hypot(p.x - P.x, p.z - P.z) < 2) {
        return;
      }
      res.colHits++;
      const front = meshRay(lists.all, origin, dir, far);
      const seen = front && front.distance < dc + 0.5;
      const near = seen ? front : drawnNear(lists.all, p, 0.5);
      if (!near) {
        const c = ch.collider;
        res.phantoms.push({
          x: +p.x.toFixed(2),
          y: +p.y.toFixed(2),
          z: +p.z.toFixed(2),
          h,
          where,
          shape: SHAPES[c.shapeType()] || c.shapeType(),
          body: bodyKind(c),
          tag: g.city?.colTags?.get?.(c.handle) || null,
          owner: owner(c),
          speed: speedOf(c),
          // false: the tile at the hit has no near (full-detail) build yet, so only mid / far LOD is drawn there
          tileNear: nearTiles(Math.floor(p.x / 200), Math.floor(p.z / 200)),
          handle: c.handle,
        });
      }
    }
    // a solid drawn wall with no collider at it or just behind it
    if (dm < far && Math.abs(hitNormalY(mh)) < 0.7 && dc > dm + 0.35) {
      const p = origin.clone().addScaledVector(dir, dm);
      if (Math.hypot(p.x - P.x, p.z - P.z) < 2) {
        return;
      }
      res.missing.push({
        x: +p.x.toFixed(2),
        y: +p.y.toFixed(2),
        z: +p.z.toFixed(2),
        h,
        where,
        mesh: labelOf(mh.object),
        dc: dc === Infinity ? null : +dc.toFixed(2),
      });
    }
  }

  function newResult() {
    return { rays: 0, colHits: 0, roadM: 0, points: 0, phantoms: [], missing: [] };
  }

  const HEIGHTS = [0.6, 1.2];

  // Rays along every lane of every road edge inside the circle, one ray per STEP meters, at two car heights.
  function roads(cx, cz, rad, opts = {}) {
    const STEP = opts.step || 4;
    const lists = collect(cx, cz, rad + 10);
    const res = newResult();
    const graph = g.city?.roadGraph;
    if (!graph) {
      res.error = 'no roadGraph';
      return res;
    }
    const origin = new T.Vector3();
    const dir = new T.Vector3();
    for (const e of graph.edges) {
      if (e.elevated || e.bridge || !e.pts || e.pts.length < 2) {
        continue;
      }
      const pts = e.pts;
      for (let i = 0; i + 1 < pts.length; i++) {
        const a = pts[i];
        const b = pts[i + 1];
        const ax = a.x ?? a[0];
        const az = a.z ?? a[1];
        const bx = b.x ?? b[0];
        const bz = b.z ?? b[1];
        const len = Math.hypot(bx - ax, bz - az);
        if (len < 0.5) {
          continue;
        }
        dir.set((bx - ax) / len, 0, (bz - az) / len);
        const nx = -dir.z;
        const nz = dir.x;
        const half = Math.max(1.5, (e.width || 7) / 2 - 1.2);
        const lanes = [-half / 2, half / 2];
        for (let s = 0; s < len; s += STEP) {
          const px = ax + dir.x * s;
          const pz = az + dir.z * s;
          if (Math.hypot(px - cx, pz - cz) > rad) {
            continue;
          }
          res.roadM += Math.min(STEP, len - s);
          for (const off of lanes) {
            const x = px + nx * off;
            const z = pz + nz * off;
            const gy = colliderGround(x, z, (g.city.groundHeightAt(x, z) || 0) + 3);
            if (!gy) {
              continue;
            }
            res.points++;
            for (const h of HEIGHTS) {
              origin.set(x, gy.y + h, z);
              probe(res, lists, origin, dir, STEP, h, 'road');
            }
          }
        }
      }
    }
    return res;
  }

  // Random open-ground points (land, off the road graph lanes), 8 horizontal directions of 6 m each.
  function open(cx, cz, rad, n = 60) {
    const lists = collect(cx, cz, rad + 10);
    const res = newResult();
    const C = g.city;
    const origin = new T.Vector3();
    const dir = new T.Vector3();
    let seed = 1234567;
    const rnd = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    for (let k = 0; k < n * 4 && res.points < n; k++) {
      const a = rnd() * Math.PI * 2;
      const r = Math.sqrt(rnd()) * rad;
      const x = cx + Math.cos(a) * r;
      const z = cz + Math.sin(a) * r;
      if (C.isWater?.(x, z)) {
        continue;
      }
      const surf = C.surfaceAt?.(x, z);
      if (surf === 'building' || surf === 'asphalt') {
        continue;
      }
      const gy = colliderGround(x, z, (C.groundHeightAt(x, z) || 0) + 3);
      if (!gy || gy.n < 0.7) {
        continue;
      }
      // never start inside a solid (a ball at chest height must be free)
      const inside = W.intersectionWithShape(
        { x, y: gy.y + 1, z },
        { x: 0, y: 0, z: 0, w: 1 },
        new R.Ball(0.25),
        NO_SENSORS,
      );
      if (inside) {
        continue;
      }
      res.points++;
      for (let d = 0; d < 8; d++) {
        const ang = (d / 8) * Math.PI * 2;
        dir.set(Math.cos(ang), 0, Math.sin(ang));
        for (const h of HEIGHTS) {
          origin.set(x, gy.y + h, z);
          probe(res, lists, origin, dir, 6, h, 'open');
        }
      }
    }
    return res;
  }

  // Where a person is placed (src/npc/peds.js groundAt): the map height, snapped to a static collider top within
  // 0.45 m of it when one is there. Mirrors the game code so the audit measures what NPCs actually stand on.
  function npcGround(x, z, gha) {
    if (!g.peds?.groundSnap) {
      return gha;
    }
    tmpOrg.set(x, gha + 0.45, z);
    tmpDir.set(0, -1, 0);
    const h = colliderRay(tmpOrg, tmpDir, 0.9, STATIC_ONLY);
    if (!h || h.timeOfImpact < 0.01) {
      return gha;
    }
    return gha + 0.45 - h.timeOfImpact;
  }

  // Drawn ground vs collider ground vs groundHeightAt on a grid (land only, off buildings). Errors in meters.
  function terrain(cx, cz, rad, step = 3) {
    const lists = collect(cx, cz, rad + 10);
    const C = g.city;
    const out = {
      n: 0,
      drawnMinusCol: [],
      ghaMinusDrawn: [],
      npcMinusDrawn: [],
      noCollider: 0,
      insideSolid: 0,
      lodOnly: 0,
      lodDrawnMinusCol: [],
      worst: [],
      noDrawn: 0,
      groundMeshes: {},
    };
    const origin = new T.Vector3();
    const down = new T.Vector3(0, -1, 0);
    for (let x = cx - rad; x <= cx + rad; x += step) {
      for (let z = cz - rad; z <= cz + rad; z += step) {
        if (Math.hypot(x - cx, z - cz) > rad) {
          continue;
        }
        if (C.isWater?.(x, z)) {
          continue;
        }
        const surf = C.surfaceAt?.(x, z);
        if (surf === 'building') {
          continue;
        }
        const gha = C.groundHeightAt(x, z);
        // the drawn ground first (from 3 m over the map height, ground meshes only: no props, grass cards or roofs)
        origin.set(x, gha + 3, z);
        const mh = meshRay(lists.ground, origin, down, 6);
        if (!mh || hitNormalY(mh) < 0.5) {
          out.noDrawn++;
          continue;
        }
        const drawn = origin.y - mh.distance;
        // then the collider surface at that drawn ground (a 1 m window around it)
        const col = colliderGround(x, z, drawn + 0.5, 1);
        // the ray starting inside a solid (a trunk, a post) is not a ground reading
        if (col && col.y > drawn + 0.49) {
          out.insideSolid++;
          continue;
        }
        if (!col || col.n < 0.5) {
          out.noCollider++;
          continue;
        }
        const d = drawn - col.y;
        const ga = gha - drawn;
        const npc = npcGround(x, z, gha) - drawn;
        const nm = labelOf(mh.object);
        out.groundMeshes[nm] = (out.groundMeshes[nm] || 0) + 1;
        // a tile without its near build shows only the coarse LOD ground: counted apart (a streaming state, not a
        // collider / mesh mismatch of the finished tile)
        if (!nearTiles(Math.floor(x / 200), Math.floor(z / 200))) {
          out.lodOnly++;
          out.lodDrawnMinusCol.push(+d.toFixed(3));
          continue;
        }
        out.n++;
        out.drawnMinusCol.push(+d.toFixed(3));
        out.ghaMinusDrawn.push(+ga.toFixed(3));
        out.npcMinusDrawn.push(+npc.toFixed(3));
        if (Math.abs(d) > 0.03 || Math.abs(npc) > 0.05) {
          out.worst.push({
            x: +x.toFixed(1),
            z: +z.toFixed(1),
            drawn: +drawn.toFixed(3),
            col: +col.y.toFixed(3),
            gha: +gha.toFixed(3),
            npc: +(npc + drawn).toFixed(3),
            mesh: nm,
            colOwner: owner(col.c),
            surf,
          });
        }
      }
    }
    out.worst.sort(
      (a, b) =>
        Math.max(Math.abs(b.drawn - b.col), Math.abs(b.npc - b.drawn)) -
        Math.max(Math.abs(a.drawn - a.col), Math.abs(a.npc - a.drawn)),
    );
    out.worst = out.worst.slice(0, 40);
    return out;
  }

  // Group nearby findings (cell meters) so one fence or one stale box counts once.
  function cluster(list, cell = 2) {
    const m = new Map();
    for (const f of list) {
      const k =
        Math.round(f.x / cell) + ',' + Math.round(f.z / cell) + ',' + (f.mesh || f.owner || '');
      const e = m.get(k);
      if (e) {
        e.n++;
      } else {
        m.set(k, { ...f, n: 1 });
      }
    }
    return [...m.values()].sort((a, b) => b.n - a.n);
  }

  window.__ph = { roads, open, terrain, cluster, collect, owner, colliderGround, meshRay };
  return true;
})();
