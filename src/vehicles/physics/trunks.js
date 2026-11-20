// r2-physics: tree and palm trunks are solid along the trunk you see (user: Nico stood inside a leaning palm trunk).
// Source: game.vegetation.trunksNear(x, z, r) (r2-veg) -> [{ key, kind, palm, segs: [[x0, y0, z0, x1, y1, z1, radius], ...] }]
// (or { m, local: [[x, y, z, r], ...] } in the model frame). Every trunk within 60 m of the player gets a fixed body with one
// capsule per trunk segment (radius = bark radius + 1.5 cm), following the trunk's lean and curve up to the crown; dropped
// beyond 80 m. Big trunks stop a car (they are fixed colliders: the crash path dents the car at the contact); trunks under
// ~15 cm diameter are tagged so the impact system can treat them as saplings.
export function installTrunks(game) {
  const { RAPIER, world } = game;
  const P = (game.physics ||= {});
  const live = new Map();
  let t = 0,
    queue = [];
  const segsOf = (r) => {
    if (r.segs) return r.segs;
    if (r.local && r.m) {
      const m = r.m,
        out = [];
      const tp = (p) => [
        m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
        m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
        m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
      ];
      const sc = Math.hypot(m[0], m[1], m[2]);
      for (let i = 0; i + 1 < r.local.length; i++) {
        const a = tp(r.local[i]),
          b = tp(r.local[i + 1]);
        out.push([...a, ...b, ((r.local[i][3] + r.local[i + 1][3]) / 2) * sc]);
      }
      return out;
    }
    return [];
  };
  function build(r) {
    const segs = segsOf(r);
    if (!segs.length) return null;
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    body.userData = { tag: 'trunk:' + (r.kind || '?') };
    let thin = true;
    for (const s of segs) {
      const [x0, y0, z0, x1, y1, z1, rad0] = s,
        dx = x1 - x0,
        dy = y1 - y0,
        dz = z1 - z0,
        L = Math.hypot(dx, dy, dz);
      if (!(L > 0.05)) continue;
      const rad = Math.max(0.06, rad0 + 0.015);
      if (rad > 0.09) thin = false;
      // capsule along local Y: rotate +Y onto the segment direction
      const ux = dx / L,
        uy = dy / L,
        uz = dz / L,
        ax = uz,
        az = -ux,
        sn = Math.hypot(ax, az),
        ang = Math.acos(Math.max(-1, Math.min(1, uy)));
      const q =
        sn > 1e-6
          ? {
              x: (ax / sn) * Math.sin(ang / 2),
              y: 0,
              z: (az / sn) * Math.sin(ang / 2),
              w: Math.cos(ang / 2),
            }
          : { x: 0, y: 0, z: 0, w: 1 };
      const cd = RAPIER.ColliderDesc.capsule(Math.max(0.01, L / 2 - rad * 0.5), rad)
        .setTranslation((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2)
        .setRotation(q)
        .setFriction(0.8);
      if (rad0 < 0.11) cd.setSolverGroups(0); // collision tiers: saplings (< ~22 cm trunk) stop people but a car rides them down; big trunks stop cars
      world.createCollider(cd, body);
    }
    // mangrove prop roots: arched roots fanning out from the trunk to the ground (block walking through the tangle)
    if (r.roots) {
      const [rx, rz, rr] = r.roots,
        y0 = segs[0][1];
      for (let k = 0; k < 7; k++) {
        const a = (k / 7) * Math.PI * 2 + 0.4,
          R = rr * (0.7 + (0.25 * ((k * 37) % 5)) / 5),
          x0 = rx + Math.cos(a) * 0.25,
          z0 = rz + Math.sin(a) * 0.25,
          x1 = rx + Math.cos(a) * R,
          z1 = rz + Math.sin(a) * R;
        const dx = x1 - x0,
          dy = -0.75,
          dz = z1 - z0,
          L = Math.hypot(dx, dy, dz),
          ux = dx / L,
          uy = dy / L,
          uz = dz / L,
          sn = Math.hypot(uz, ux),
          ang = Math.acos(uy);
        const q = {
          x: (uz / sn) * Math.sin(ang / 2),
          y: 0,
          z: (-ux / sn) * Math.sin(ang / 2),
          w: Math.cos(ang / 2),
        };
        world.createCollider(
          RAPIER.ColliderDesc.capsule(L / 2, 0.06)
            .setTranslation((x0 + x1) / 2, y0 + 0.4, (z0 + z1) / 2)
            .setRotation(q),
          body,
        );
      }
    }
    if (thin) body.userData.thin = true;
    return body;
  }
  function tick(dt) {
    const src = game.vegetation?.trunksNear;
    if (!src) return;
    const pp = game.player?.position;
    if (!pp) return;
    if ((t -= dt) <= 0) {
      t = 1.0;
      let list = [];
      try {
        list = src(pp.x, pp.z, 60) || [];
      } catch (e) {
        list = [];
      }
      // countryside trees (the synthetic-land streamer) are not in trunksNear: a vertical trunk per tree from treesNear (base, scale),
      // radius by kind (the tile cylinders that used to cover them are off while trunk colliders are on)
      try {
        const cs = game.vegetation?.countryside,
          T = cs?.treesNear?.(pp.x, pp.z, 60) || [];
        if (T.length) {
          // physics-audit: a tree that already has its real (model) trunk gets no stand-in. Matched by distance (any
          // modelled trunk base within 0.8 m), not by rounding both positions to a 0.5 m key: a base 1 cm across a
          // rounding edge used to add a second, upright stand-in capsule beside the drawn leaning trunk.
          const near = new Map();
          for (const e of list) {
            const ck = Math.floor(e.segs[0][0]) + ':' + Math.floor(e.segs[0][2]);
            if (!near.has(ck)) near.set(ck, []);
            near.get(ck).push(e.segs[0]);
          }
          const hasTrunkNear = (x, z) => {
            const cx = Math.floor(x);
            const cz = Math.floor(z);
            for (let i = -1; i <= 1; i++) {
              for (let j = -1; j <= 1; j++) {
                for (const s of near.get(cx + i + ':' + (cz + j)) || []) {
                  if ((s[0] - x) ** 2 + (s[2] - z) ** 2 < 0.64) return true;
                }
              }
            }
            return false;
          };
          for (const tr of T) {
            const gk = Math.round(tr.x * 2) + ':' + Math.round(tr.z * 2);
            if (hasTrunkNear(tr.x, tr.z)) continue;
            const k = String(tr.kind || ''),
              sc = tr.s || 1;
            const rad =
              (tr.palm
                ? 0.17
                : /mangrove/.test(k)
                  ? 0.11
                  : /seagrape/.test(k)
                    ? 0.08
                    : /pine|cypress/.test(k)
                      ? 0.2
                      : /banyan/.test(k)
                        ? 0.6
                        : 0.27) * sc;
            const h = (tr.palm ? 4.5 : /seagrape/.test(k) ? 1.4 : 2.6) * sc;
            const e = {
              key: 'cs:' + gk,
              kind: k,
              palm: !!tr.palm,
              segs: [
                [tr.x, tr.y - 0.1, tr.z, tr.x, tr.y + h * 0.5, tr.z, rad],
                [tr.x, tr.y + h * 0.5, tr.z, tr.x, tr.y + h, tr.z, rad * 0.85],
              ],
            };
            if (/mangrove/.test(k)) e.roots = [tr.x, tr.z, 1.5 * sc];
            list.push(e);
          }
        }
      } catch (e) {
        /* no countryside */
      }
      const want = new Set();
      for (const r of list) {
        const k =
          r.key ??
          `${Math.round((r.segs?.[0]?.[0] ?? 0) * 20)}:${Math.round((r.segs?.[0]?.[2] ?? 0) * 20)}`;
        want.add(k);
        if (!live.has(k)) queue.push([k, r]);
      }
      for (const [k, rec] of live)
        if (
          !want.has(k) &&
          (() => {
            const d = Math.hypot(rec.x - pp.x, rec.z - pp.z);
            return d > 80 || d < 56;
          })()
        ) {
          try {
            world.removeRigidBody(rec.body);
          } catch (e) {
            /* */
          }
          live.delete(k);
        }
    }
    for (let i = 0; i < 40 && queue.length; i++) {
      const [k, r] = queue.shift();
      if (live.has(k)) continue;
      try {
        const body = build(r);
        if (body) {
          const s0 = segsOf(r)[0];
          live.set(k, { body, x: s0[0], z: s0[2] });
        }
      } catch (e) {
        /* bad data */
      }
    }
  }
  game.updaters?.push?.(tick);
  if (globalThis.__r2TrunkColliders === false) {
    P.trunks = { count: () => 0, pending: () => 0, off: true };
    game.updaters.splice(game.updaters.indexOf(tick), 1);
    return P.trunks;
  }
  P.trunks = { count: () => live.size, pending: () => queue.length };
  return P.trunks;
}
