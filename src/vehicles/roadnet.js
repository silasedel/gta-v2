// Road network adapter for traffic: wraps city.roadGraph (Miami / new API) or builds an
// equivalent graph from the legacy grid city (city.roads). Everything the traffic AI needs:
// polyline sampling with arc length, right-hand lane offsets, node turn options, signals.

const SQ = (x) => x * x;

export function buildRoadNet(city) {
  const src = city?.roadGraph;
  const net =
    src && src.nodes?.length && src.edges?.length ? fromGraph(src, city) : fromLegacy(city);
  finalize(net, city);
  return net;
}

function fromGraph(g, city) {
  const nodes = new Map();
  for (const n of g.nodes)
    nodes.set(n.id, {
      id: n.id,
      x: n.x,
      z: n.z,
      edges: [],
      signal: !!(n.signal || n.control === 'signal'),
    });
  const edges = [];
  for (const e of g.edges) {
    if (!e.pts || e.pts.length < 2 || !nodes.has(e.a) || !nodes.has(e.b)) continue;
    const kind = e.kind || 'road';
    if (/foot|path|cycle|steps|pedestrian|track|service_private/.test(kind)) continue;
    edges.push({
      id: e.id,
      a: e.a,
      b: e.b,
      pts: e.pts.map((p) => [p[0], p[1]]),
      // Nov 19 (hovering cars): only decks (bridges, ramps) and terrain-following roads carry real heights; a flat street's
      // y is all zeros, and ghost traffic glided at y = 0 where the ground sits lower (1.2 m above the road downtown at
      // (300, -62)). Without y the lane height comes from city.groundHeightAt.
      y: e.elevated === false && !e.terrain ? null : e.y || null,
      width: e.width || 7,
      lanesFwd: e.lanesFwd ?? 1,
      lanesBack: e.oneway ? 0 : (e.lanesBack ?? 1),
      oneway: !!e.oneway,
      speedKmh: e.speedKmh || 40,
      name: e.name || null,
      kind,
      bridge: !!e.bridge,
      src: e,
    });
  }
  return { nodes, edges, graph: g, legacy: false };
}

function fromLegacy(city) {
  const nodes = new Map(),
    edges = [];
  const lines = [];
  const W = city?.grid?.roadWidth || 14;
  const v = new Map(),
    h = new Map();
  for (const r of city?.roads || []) {
    const vert = Math.abs(r.x1 - r.x2) < 0.01,
      hor = Math.abs(r.z1 - r.z2) < 0.01;
    if (!vert && !hor) continue;
    const map = vert ? v : h,
      c = vert ? r.x1 : r.z1,
      key = Math.round(c * 2) / 2;
    if (!map.has(key)) map.set(key, { axis: vert ? 'v' : 'h', c, width: r.width || W, segs: [] });
    map
      .get(key)
      .segs.push(
        vert
          ? [Math.min(r.z1, r.z2), Math.max(r.z1, r.z2)]
          : [Math.min(r.x1, r.x2), Math.max(r.x1, r.x2)],
      );
  }
  lines.push(...v.values(), ...h.values());
  const covers = (l, t) => l.segs.some(([a, b]) => t >= a - 1 && t <= b + 1);
  const nodeAt = (x, z) => {
    const id = `${Math.round(x * 2) / 2},${Math.round(z * 2) / 2}`;
    if (!nodes.has(id)) nodes.set(id, { id, x, z, edges: [] });
    return id;
  };
  let eid = 0;
  for (const l of lines) {
    const others = l.axis === 'v' ? [...h.values()] : [...v.values()];
    for (const [a, b] of l.segs) {
      const stops = [a, b];
      for (const o of others) if (covers(o, l.c) && o.c > a + 0.5 && o.c < b - 0.5) stops.push(o.c);
      stops.sort((p, q) => p - q);
      for (let i = 0; i < stops.length - 1; i++) {
        const s0 = stops[i],
          s1 = stops[i + 1];
        if (s1 - s0 < 2) continue;
        const p0 = l.axis === 'v' ? [l.c, s0] : [s0, l.c],
          p1 = l.axis === 'v' ? [l.c, s1] : [s1, l.c];
        const lanes = l.width >= 12 ? 2 : 1;
        edges.push({
          id: 'L' + eid++,
          a: nodeAt(p0[0], p0[1]),
          b: nodeAt(p1[0], p1[1]),
          pts: [p0, p1],
          y: null,
          width: l.width,
          lanesFwd: lanes,
          lanesBack: lanes,
          oneway: false,
          speedKmh: 50,
          name: null,
          kind: 'street',
          bridge: false,
          axis: l.axis === 'v' ? 'z' : 'x',
        });
      }
    }
  }
  return { nodes, edges, graph: null, legacy: true, laneOffsets: city?.grid?.laneOffsets };
}

function finalize(net, city) {
  const byId = new Map();
  for (const e of net.edges) {
    byId.set(e.id, e);
    const cum = [0];
    for (let i = 1; i < e.pts.length; i++)
      cum.push(
        cum[i - 1] + Math.hypot(e.pts[i][0] - e.pts[i - 1][0], e.pts[i][1] - e.pts[i - 1][1]),
      );
    e.cum = cum;
    e.len = cum[cum.length - 1] || 0.001;
    const nl = Math.max(1, e.lanesFwd + e.lanesBack);
    e.laneW = Math.min(3.8, Math.max(2.6, e.width / nl));
    net.nodes.get(e.a)?.edges.push(e);
    net.nodes.get(e.b)?.edges.push(e);
  }
  net.edgeById = byId;
  net.edges = net.edges.filter((e) => e.len > 1);
  // spatial hash for nearest-edge queries
  const CELL = 60,
    grid = new Map();
  const key = (i, j) => (i * 73856093) ^ (j * 19349663);
  for (const e of net.edges) {
    for (let i = 0; i < e.pts.length - 1; i++) {
      const [x0, z0] = e.pts[i],
        [x1, z1] = e.pts[i + 1];
      const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / (CELL * 0.5)));
      for (let k = 0; k <= n; k++) {
        const x = x0 + ((x1 - x0) * k) / n,
          z = z0 + ((z1 - z0) * k) / n;
        const kk = key(Math.floor(x / CELL), Math.floor(z / CELL));
        let arr = grid.get(kk);
        if (!arr) grid.set(kk, (arr = []));
        if (arr[arr.length - 1] !== e) arr.push(e);
      }
    }
  }
  net.near = (x, z, r = 60) => {
    if (!(r < 3000)) return new Set(net.edges); // huge radius: everything (avoid walking millions of cells)
    const out = new Set();
    const i0 = Math.floor((x - r) / CELL),
      i1 = Math.floor((x + r) / CELL),
      j0 = Math.floor((z - r) / CELL),
      j1 = Math.floor((z + r) / CELL);
    for (let i = i0; i <= i1; i++)
      for (let j = j0; j <= j1; j++) {
        const a = grid.get(key(i, j));
        if (a) for (const e of a) out.add(e);
      }
    return out;
  };
  net.city = city;
}

// ---- geometry helpers --------------------------------------------------------------------

// project (x,z) onto edge polyline -> arc length s (from node a), lateral (left of a->b positive)
export function project(e, x, z, hintS = null) {
  let best = 1e18,
    bs = 0,
    blat = 0;
  const n = e.pts.length;
  for (let i = 0; i < n - 1; i++) {
    if (hintS !== null && (e.cum[i + 1] < hintS - 40 || e.cum[i] > hintS + 40)) continue;
    const [x0, z0] = e.pts[i],
      [x1, z1] = e.pts[i + 1];
    const dx = x1 - x0,
      dz = z1 - z0,
      L2 = dx * dx + dz * dz || 1e-6;
    let t = ((x - x0) * dx + (z - z0) * dz) / L2;
    t = Math.max(0, Math.min(1, t));
    const px = x0 + dx * t,
      pz = z0 + dz * t;
    const d = SQ(x - px) + SQ(z - pz);
    if (d < best) {
      best = d;
      bs = e.cum[i] + t * Math.sqrt(L2);
      const L = Math.sqrt(L2);
      blat = ((x - px) * dz - (z - pz) * dx) / L; // left of travel a->b (heading convention: left = +x when facing +z)
    }
  }
  if (hintS !== null && best === 1e18) return project(e, x, z, null);
  return { s: bs, dist: Math.sqrt(best), lat: blat };
}

// point + unit direction at arc length s (from node a)
export function sampleEdge(e, s, out = {}) {
  s = Math.max(0, Math.min(e.len, s));
  let i = 0;
  while (i < e.cum.length - 2 && e.cum[i + 1] < s) i++;
  const [x0, z0] = e.pts[i],
    [x1, z1] = e.pts[i + 1];
  const L = e.cum[i + 1] - e.cum[i] || 1e-6,
    t = (s - e.cum[i]) / L;
  out.x = x0 + (x1 - x0) * t;
  out.z = z0 + (z1 - z0) * t;
  out.dx = (x1 - x0) / L;
  out.dz = (z1 - z0) / L;
  if (e.y && e.y.length === e.pts.length) out.y = e.y[i] + (e.y[i + 1] - e.y[i]) * t;
  else out.y = null;
  return out;
}

// right-hand lane centre offset (positive = to the right of travel) for lane k (0 = kerb-most... we use 0 = inner)
export function laneOffset(e, dir, k = 0) {
  if (e.oneway) {
    const n = Math.max(1, e.lanesFwd);
    return (Math.min(k, n - 1) + 0.5) * e.laneW - (n * e.laneW) / 2;
  }
  const n = Math.max(1, dir > 0 ? e.lanesFwd : e.lanesBack);
  return (Math.min(k, n - 1) + 0.5) * e.laneW;
}
// lanes traffic actually uses: the kerb lane of 2-lane carriageways is left for parking
export function driveLaneMax(e, dir) {
  const n = laneCount(e, dir);
  return n <= 2 ? 0 : n - 2;
}
export function laneCount(e, dir) {
  if (e.oneway) return dir > 0 ? Math.max(1, e.lanesFwd) : 0;
  return Math.max(0, dir > 0 ? e.lanesFwd : e.lanesBack) || (e.oneway ? 0 : 1);
}

// world-space lane point at travel distance d along edge in direction dir (+1 a->b, -1 b->a)
export function lanePointAt(e, dir, d, off, out = {}) {
  const s = dir > 0 ? d : e.len - d;
  sampleEdge(e, s, out);
  let fx = out.dx * dir,
    fz = out.dz * dir;
  // right of travel (heading convention: forward (0,0,1) -> right (-1,0,0))
  const rx = -fz,
    rz = fx;
  out.x += rx * off;
  out.z += rz * off;
  out.fx = fx;
  out.fz = fz;
  return out;
}

// options leaving node for a car arriving on edge e (travel dir)
export function exitsAt(net, nodeId, fromEdge) {
  const n = net.nodes.get(nodeId);
  if (!n) return [];
  const out = [];
  for (const e of n.edges) {
    if (e === fromEdge && n.edges.length > 1) continue;
    const dir = e.a === nodeId ? 1 : -1;
    if (laneCount(e, dir) <= 0) continue;
    if (e.a === e.b) continue;
    out.push({ edge: e, dir });
  }
  return out;
}

// heading of edge leaving / arriving at node
export function edgeDirAt(e, dir, atStart) {
  const p = {};
  const d = atStart ? Math.min(3, e.len * 0.3) : Math.max(0, e.len - Math.min(3, e.len * 0.3));
  sampleEdge(e, dir > 0 ? d : e.len - d, p);
  return { x: p.dx * dir, z: p.dz * dir };
}

// Fixed-time signal plan for mapped signals when no world module drives them (game.traffic.signalAt overrides):
// two phases by approach axis, 32 s cycle (13 s green, 3 s yellow, 0 s+... 1 s all-red each), offset per node so the city
// does not switch in lockstep.  The approach axis is the edge's direction at the node relative to the node's first edge.
const SIG_CYCLE = 34,
  SIG_GREEN = 13,
  SIG_YELLOW = 3;
function edgeAngleAt(e, nodeId) {
  const p = e.pts,
    atB = e.b === nodeId,
    i0 = atB ? p.length - 1 : 0,
    i1 = atB ? Math.max(0, p.length - 2) : Math.min(p.length - 1, 1);
  return Math.atan2(p[i1][0] - p[i0][0], p[i1][1] - p[i0][1]);
}
export function fixedSignal(net, node, e, t = performance.now() / 1000) {
  if (!node.axisRef) node.axisRef = edgeAngleAt(node.edges[0], node.id);
  const d = Math.abs(Math.sin(edgeAngleAt(e, node.id) - node.axisRef)); // 0 = same axis as the reference, 1 = crossing
  const phase = d < 0.6 ? 0 : 1;
  const off = (((node.id * 7.31) % SIG_CYCLE) + SIG_CYCLE) % SIG_CYCLE;
  const k = (t + off) % SIG_CYCLE,
    half = SIG_CYCLE / 2,
    s = phase === 0 ? k : (k + half) % SIG_CYCLE;
  return s < SIG_GREEN ? 'green' : s < SIG_GREEN + SIG_YELLOW ? 'yellow' : 'red';
}
export function signalState(net, nodeId, e) {
  const c = net.city;
  const gt = net.game?.traffic;
  if (typeof gt?.signalAt === 'function') {
    const r = gt.signalAt(nodeId, e.id);
    if (r !== undefined) return r || null;
  }
  if (!c) return null;
  if (typeof c.signalAt === 'function') return c.signalAt(nodeId, e.id) || null;
  const node = net.nodes.get(nodeId);
  if (node?.signal && node.edges.length >= 3 && e.pts?.length >= 2)
    return fixedSignal(net, node, e);
  if (typeof c.trafficLight === 'function') {
    const n = net.nodes.get(nodeId);
    if (n && n.edges.length >= 3) {
      let axis = e.axis;
      if (!axis) {
        const dx = e.pts[e.pts.length - 1][0] - e.pts[0][0],
          dz = e.pts[e.pts.length - 1][1] - e.pts[0][1];
        axis = Math.abs(dx) > Math.abs(dz) ? 'x' : 'z';
      }
      return c.trafficLight(axis);
    }
  }
  return null;
}

// random lane position near a point (within [rMin, rMax]) -> {edge, dir, d, lane, x, z, y, heading}
export function randomLane(net, near, rMin, rMax, filter, tries = 40) {
  const cands = near ? [...net.near(near.x, near.z, rMax)] : net.edges;
  if (!cands.length) return null;
  for (let t = 0; t < tries; t++) {
    const e = cands[(Math.random() * cands.length) | 0];
    if (e.len < 12) continue;
    if (filter && filter.edge && !filter.edge(e)) continue;
    let dir = Math.random() < 0.5 ? 1 : -1;
    if (laneCount(e, dir) <= 0) dir = -dir;
    if (laneCount(e, dir) <= 0) continue;
    const d = 5 + Math.random() * (e.len - 10);
    const lane = (Math.random() * laneCount(e, dir)) | 0;
    const p = lanePointAt(e, dir, d, laneOffset(e, dir, lane));
    if (near) {
      const dd = Math.hypot(p.x - near.x, p.z - near.z);
      if (dd < rMin || dd > rMax) continue;
    }
    if (typeof filter === 'function' && !filter(p, e)) continue;
    return { edge: e, dir, d, lane, x: p.x, z: p.z, y: p.y, heading: Math.atan2(p.fx, p.fz) };
  }
  return null;
}
