// Mission sets: small closed interiors that exist only while their mission runs (the prison of the intro, later others).
// A set is built from boxes and cylinders in its own frame (x right, y up, z forward, floor at y = 0), merged into one
// mesh per material, with Rapier cuboid colliders and a few real point lights (the perf guard keeps the scene at its fixed
// light budget, so adding them never recompiles shaders). dispose() removes everything it made: meshes, geometries,
// materials, canvas textures, colliders and lights. The surface textures come from the interiors kit (shared, cached).
//
//   const S = createSet(game, { x, y, z, name: 'prison' });
//   const wall = S.surf('cmu', { c: [180, 180, 176] }, { rough: 0.9 });
//   S.box(wall, x0, y0, z0, x1, y1, z1);            // a solid block (collider too)
//   S.box(wall, ..., { collide: false });            // looks only
//   S.light(x, y, z, 0xf2f6ff, 18, 9);               // a point light
//   S.build();                                       // merge, add to the scene, make the colliders
//   S.dispose();
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { surfaceTextures, surfacesPending } from '../../world/interiors/kit/surfaces.js';

const _v = new THREE.Vector3();
const _n = new THREE.Vector3();

// Box-projected UVs in set meters, so textures run on across neighbouring pieces and never stretch.
function projectUVs(geo, metersPerRepeat) {
  const pos = geo.attributes.position;
  const nor = geo.attributes.normal;
  const uv = geo.attributes.uv;
  const k = 1 / metersPerRepeat;
  for (let i = 0; i < pos.count; i++) {
    _v.fromBufferAttribute(pos, i);
    _n.fromBufferAttribute(nor, i);
    const ax = Math.abs(_n.x);
    const ay = Math.abs(_n.y);
    const az = Math.abs(_n.z);
    if (ax >= ay && ax >= az) {
      uv.setXY(i, _v.z * k * Math.sign(_n.x || 1), _v.y * k);
    } else if (ay >= az) {
      uv.setXY(i, _v.x * k, _v.z * k);
    } else {
      uv.setXY(i, _v.x * k * -Math.sign(_n.z || 1), _v.y * k);
    }
  }
  uv.needsUpdate = true;
}

export function createSet(game, opts = {}) {
  const root = new THREE.Group();
  root.name = 'set:' + (opts.name || 'mission');
  root.position.set(opts.x || 0, opts.y || 0, opts.z || 0);
  const buckets = new Map(); // material -> geometries waiting to be merged
  const materials = [];
  const ownTextures = [];
  const solids = [];
  const lights = [];
  const extra = [];
  const doors = [];
  const anims = [];
  let body = null;
  let built = false;

  // ---------------------------------------------------------------- materials
  // A PBR material from one of the interiors kit's procedural surfaces (cmu, concrete, paint, vct, steel, fabric ...).
  // `ambient` fakes the bounce light of a closed room (emissive from the albedo map), so corners never go pitch black.
  function surf(name, o = {}, m = {}) {
    const t = surfaceTextures(name, { c: o.c, c2: o.c2, wear: o.wear ?? 0.4 });
    const mat = new THREE.MeshStandardMaterial({
      map: t.map,
      normalMap: t.normalMap,
      roughnessMap: t.roughnessMap,
      roughness: m.rough ?? t.rough ?? 0.9,
      metalness: m.metal ?? t.metal ?? 0,
      color: m.tint ?? 0xffffff,
      emissive: new THREE.Color(m.ambient ?? 0x0c0c0c),
      emissiveMap: t.map,
    });
    mat.normalScale.setScalar(m.bump ?? 0.6);
    mat.userData.meters = (t.m || 1) * (m.scale || 1);
    return keep(mat);
  }

  // a plain painted / metal / plastic finish
  function flat(color, o = {}) {
    const mat = new THREE.MeshStandardMaterial({
      color,
      roughness: o.rough ?? 0.7,
      metalness: o.metal ?? 0,
      emissive: new THREE.Color(o.ambient ?? 0x000000),
      side: o.side ?? THREE.FrontSide,
    });
    mat.userData.meters = 1;
    return keep(mat);
  }

  // a light source surface (fluorescent diffuser, window glow): bright, unlit, blooms
  function glow(color, k = 4) {
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k) });
    mat.toneMapped = true;
    mat.userData.meters = 1;
    return keep(mat);
  }

  // a canvas-drawn picture (signs, the palm print, the notebook page): draw(ctx2d, w, h)
  function picture(w, h, draw, o = {}) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    draw(c.getContext('2d'), w, h);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    ownTextures.push(tex);
    const mat = new THREE.MeshStandardMaterial({
      map: tex,
      roughness: o.rough ?? 0.8,
      metalness: 0,
      emissive: new THREE.Color(o.ambient ?? 0x141414),
      emissiveMap: tex,
      transparent: !!o.transparent,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -2,
    });
    return keep(mat);
  }

  function keep(mat) {
    mat.defines = { ...(mat.defines || {}), NO_WET: '' };
    materials.push(mat);
    return mat;
  }

  // ---------------------------------------------------------------- geometry
  function push(mat, geo) {
    projectUVs(geo, mat.userData.meters || 1);
    if (!buckets.has(mat)) buckets.set(mat, []);
    buckets.get(mat).push(geo);
  }

  // an axis-aligned block between two corners; collide (default true) adds a cuboid collider of the same size
  function box(mat, x0, y0, z0, x1, y1, z1, o = {}) {
    const w = Math.abs(x1 - x0);
    const h = Math.abs(y1 - y0);
    const d = Math.abs(z1 - z0);
    if (w < 1e-4 || h < 1e-4 || d < 1e-4) return;
    const g = new THREE.BoxGeometry(w, h, d);
    g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    if (mat) push(mat, g);
    if (o.collide !== false && mat !== null) solid(x0, y0, z0, x1, y1, z1);
  }

  // a box turned about Y (yaw, radians) around its center; looks only
  function rbox(mat, cx, cy, cz, w, h, d, yaw = 0, o = {}) {
    const g = new THREE.BoxGeometry(w, h, d);
    if (o.pitch) g.rotateX(o.pitch);
    if (o.roll) g.rotateZ(o.roll);
    g.rotateY(yaw);
    g.translate(cx, cy, cz);
    push(mat, g);
  }

  // a cylinder along Y (axis 'y'), X or Z, centered at (x, y, z)
  function cyl(mat, x, y, z, r, len, o = {}) {
    const g = new THREE.CylinderGeometry(o.r1 ?? r, r, len, o.seg || 12, 1, !!o.open);
    if (o.axis === 'x') g.rotateZ(Math.PI / 2);
    if (o.axis === 'z') g.rotateX(Math.PI / 2);
    g.translate(x, y, z);
    push(mat, g);
  }

  // a flat quad facing +z (pitch tips it about X first, yaw turns it), for pictures and signs; no collider
  function quad(mat, cx, cy, cz, w, h, yaw = 0, pitch = 0) {
    const g = new THREE.PlaneGeometry(w, h);
    if (pitch) g.rotateX(pitch);
    g.rotateY(yaw);
    g.translate(cx, cy, cz);
    // pictures keep their own 0..1 UVs (no projection)
    const own = new THREE.Mesh(g, mat);
    own.matrixAutoUpdate = false;
    own.updateMatrix();
    extra.push(own);
    root.add(own);
    return own;
  }

  // a collider only (invisible walls, the bunk's footprint)
  function solid(x0, y0, z0, x1, y1, z1) {
    solids.push([
      (x0 + x1) / 2,
      (y0 + y1) / 2,
      (z0 + z1) / 2,
      Math.abs(x1 - x0) / 2,
      Math.abs(y1 - y0) / 2,
      Math.abs(z1 - z0) / 2,
    ]);
  }

  // a real point light (set frame); decay 2, distance = range in meters
  function light(x, y, z, color, intensity, range = 8) {
    const l = new THREE.PointLight(color, intensity, range, 2);
    l.castShadow = false;
    l.position.set(x, y, z);
    l.userData.setLight = true;
    lights.push(l);
    root.add(l);
    return l;
  }

  // ---------------------------------------------------------------- doors
  // A door is a group that moves (swings about its hinge or slides) with a collider in its closed place that is switched off
  // while it is open. door.set(t) (0 closed .. 1 open), await door.animate(to, seconds).
  function makeDoor(group, closedBox, apply) {
    add(group);
    const door = { group, t: 0, closedBox, collider: null };
    door.set = (t) => {
      door.t = t;
      apply(t);
      group.updateMatrixWorld(true);
      if (door.collider) door.collider.setEnabled(t < 0.05);
    };
    door.animate = (to, sec = 1) =>
      new Promise((resolve) => {
        const from = door.t;
        let k = 0;
        const tick = (dt) => {
          k = Math.min(1, k + dt / Math.max(0.01, sec));
          const e = k * k * (3 - 2 * k);
          door.set(from + (to - from) * e);
          if (k >= 1) {
            const i = game.updaters.indexOf(tick);
            if (i >= 0) game.updaters.splice(i, 1);
            resolve();
          }
        };
        game.updaters.push(tick);
        anims.push(tick);
      });
    doors.push(door);
    return door;
  }

  // a hinged door: closed it runs along +z from the hinge (hingeZ .. hingeZ + width), thick along +x from hingeX;
  // open(1) turns it by openYaw about the hinge
  function swingDoor(o) {
    const pivot = new THREE.Group();
    pivot.position.set(o.hingeX, o.y || 0, o.hingeZ);
    const panel = new THREE.Mesh(new THREE.BoxGeometry(o.thick, o.height, o.width), o.material);
    panel.position.set(o.thick / 2, o.height / 2, o.width / 2);
    pivot.add(panel);
    if (o.trim) {
      for (const side of [-1, 1]) {
        const lever = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 0.13), o.trim);
        lever.position.set(o.thick / 2 + side * (o.thick / 2 + 0.03), 1.02, o.width - 0.14);
        pivot.add(lever);
      }
    }
    if (o.window) {
      const pane = new THREE.Mesh(new THREE.BoxGeometry(o.thick + 0.004, 0.62, 0.12), o.window);
      pane.position.set(o.thick / 2, 1.5, o.width - 0.24);
      pivot.add(pane);
    }
    const box = [o.hingeX, 0, o.hingeZ, o.hingeX + o.thick, o.height, o.hingeZ + o.width];
    return makeDoor(pivot, box, (t) => {
      pivot.rotation.y = (o.openYaw ?? 1.45) * t;
    });
  }

  // a sliding door: the panel box (x0..x1, z0..z1, height) moves by slide [dx, dz] when open; parts = extra meshes made by
  // the caller in the same closed frame (vision slot, tray slot) that move with it
  function slideDoor(o) {
    const g = new THREE.Group();
    const panel = new THREE.Mesh(
      new THREE.BoxGeometry(o.x1 - o.x0, o.height, o.z1 - o.z0),
      o.material,
    );
    panel.position.set((o.x0 + o.x1) / 2, o.height / 2, (o.z0 + o.z1) / 2);
    g.add(panel);
    for (const p of o.parts || []) g.add(p);
    const box = [o.x0, 0, o.z0, o.x1, o.height, o.z1];
    return makeDoor(g, box, (t) => {
      g.position.set(o.slide[0] * t, 0, o.slide[1] * t);
    });
  }

  // anything else (a moving door group): added under the set root, disposed with it
  function add(obj) {
    extra.push(obj);
    root.add(obj);
    return obj;
  }

  // ---------------------------------------------------------------- build / dispose
  function build() {
    if (built) return root;
    built = true;
    for (const [mat, list] of buckets) {
      const merged = list.length === 1 ? list[0] : mergeGeometries(list, false);
      for (const g of list) if (g !== merged) g.dispose();
      if (!merged) continue;
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, mat);
      mesh.matrixAutoUpdate = false;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.userData.noTileBatch = true;
      mesh.userData.noDetailCull = true;
      root.add(mesh);
    }
    buckets.clear();
    root.updateMatrixWorld(true);
    game.scene.add(root);
    try {
      game.shaderWarmWrap?.(root);
    } catch (e) {
      /* warm-up is optional */
    }
    makeColliders();
    return root;
  }

  function makeColliders() {
    const R = game.RAPIER;
    const W = game.world;
    if (!R || !W || (!solids.length && !doors.length)) return;
    const p = root.position;
    body = W.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(p.x, p.y, p.z));
    for (const [x, y, z, hx, hy, hz] of solids) {
      W.createCollider(
        R.ColliderDesc.cuboid(hx, hy, hz).setTranslation(x, y, z).setFriction(0.8),
        body,
      );
    }
    for (const d of doors) {
      const [x0, y0, z0, x1, y1, z1] = d.closedBox;
      d.collider = W.createCollider(
        R.ColliderDesc.cuboid((x1 - x0) / 2, (y1 - y0) / 2, (z1 - z0) / 2).setTranslation(
          (x0 + x1) / 2,
          (y0 + y1) / 2,
          (z0 + z1) / 2,
        ),
        body,
      );
      d.collider.setEnabled(d.t < 0.05);
    }
  }

  function dispose() {
    for (const t of anims) {
      const i = game.updaters.indexOf(t);
      if (i >= 0) game.updaters.splice(i, 1);
    }
    anims.length = 0;
    doors.length = 0;
    if (body) {
      try {
        game.world.removeRigidBody(body);
      } catch (e) {
        /* the world was reset */
      }
      body = null;
    }
    root.parent?.remove(root);
    root.traverse((o) => {
      if (o.isMesh) o.geometry?.dispose();
    });
    for (const g of buckets.values()) for (const geo of g) geo.dispose();
    buckets.clear();
    for (const m of materials) m.dispose();
    for (const t of ownTextures) t.dispose();
    materials.length = 0;
    ownTextures.length = 0;
    lights.length = 0;
    extra.length = 0;
    solids.length = 0;
  }

  // the surface textures are drawn in a worker: wait for them (under the black of a mission start)
  async function ready(maxMs = 6000) {
    const t0 = performance.now();
    while (surfacesPending() > 0 && performance.now() - t0 < maxMs) {
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  // set frame -> world
  function toWorld(x, y, z) {
    return { x: root.position.x + x, y: root.position.y + y, z: root.position.z + z };
  }

  return {
    root,
    surf,
    flat,
    glow,
    picture,
    box,
    rbox,
    cyl,
    quad,
    solid,
    light,
    add,
    swingDoor,
    slideDoor,
    build,
    ready,
    dispose,
    toWorld,
    lights,
  };
}
