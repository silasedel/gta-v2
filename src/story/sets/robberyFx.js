// Small effects for the intro v2 robbery flashback (storyboard panels 5-7): the cash bag, the dye pack burst, red/pink
// dye on Mari and the bag, the handcuffed (hands behind the back) arm pose, and police cars with their light bars on.
// Everything here is made for one mission and disposed by it (ctx.track): nothing stays in memory afterwards.
import * as THREE from 'three';

const DYE = new THREE.Color('#e0245e');

// ---------------------------------------------------------------- the cash bag (a dark canvas zip bag stuffed with bills)
function bagTexture(stained) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#23262b';
  g.fillRect(0, 0, 256, 128);
  g.fillStyle = 'rgba(255, 255, 255, 0.05)';
  for (let i = 0; i < 128; i += 3) {
    g.fillRect(0, i, 256, 1);
  }
  g.fillStyle = '#121418';
  g.fillRect(0, 10, 256, 6);
  if (stained) {
    paintDye(g, 256, 128, 7);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// red / pink dye blots: dense in the middle of each blot, thin spatter around it
function paintDye(g, w, h, seed) {
  let s = seed;
  const rnd = () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
  for (let k = 0; k < 9; k++) {
    const x = rnd() * w;
    const y = rnd() * h;
    const r = 10 + rnd() * h * 0.35;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, 'rgba(214, 22, 78, 0.95)');
    gr.addColorStop(0.6, 'rgba(232, 60, 120, 0.7)');
    gr.addColorStop(1, 'rgba(240, 90, 150, 0)');
    g.fillStyle = gr;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
    for (let i = 0; i < 18; i++) {
      const a = rnd() * Math.PI * 2;
      const d = r * (0.8 + rnd() * 0.9);
      g.fillStyle = 'rgba(220, 30, 90, 0.85)';
      g.beginPath();
      g.arc(x + Math.cos(a) * d, y + Math.sin(a) * d, 1 + rnd() * 3, 0, Math.PI * 2);
      g.fill();
    }
  }
}

export function makeCashBag() {
  const root = new THREE.Group();
  root.name = 'intro2:cashBag';
  const cloth = new THREE.MeshStandardMaterial({ map: bagTexture(false), roughness: 0.85 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 0.26, 4, 10), cloth);
  body.rotation.z = Math.PI / 2;
  body.scale.set(1, 1, 0.8);
  body.position.y = 0.11;
  root.add(body);
  const strap = new THREE.Mesh(
    new THREE.TorusGeometry(0.12, 0.012, 6, 16, Math.PI),
    new THREE.MeshStandardMaterial({ color: '#111214', roughness: 0.7 }),
  );
  strap.position.y = 0.2;
  root.add(strap);
  // a few bills sticking out of the open zip
  const bill = new THREE.MeshStandardMaterial({ color: '#86a074', roughness: 0.9 });
  for (let i = 0; i < 3; i++) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.004, 0.07), bill);
    b.position.set(-0.08 + i * 0.07, 0.215, (i - 1) * 0.02);
    b.rotation.set(0.3 * (i - 1), i * 0.4, 0.25);
    root.add(b);
  }
  root.userData.cloth = cloth;
  root.userData.bill = bill;
  root.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
    }
  });
  return root;
}

export function stainBag(bag) {
  const cloth = bag.userData.cloth;
  if (!cloth || bag.userData.stained) return;
  bag.userData.stained = true;
  cloth.map.dispose();
  cloth.map = bagTexture(true);
  cloth.needsUpdate = true;
  bag.userData.bill.color.set('#d8507e');
}

export function disposeObject(obj) {
  obj.parent?.remove(obj);
  obj.traverse((o) => {
    if (!o.isMesh && !o.isPoints) return;
    o.geometry?.dispose();
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      m?.map?.dispose?.();
      m?.dispose?.();
    }
  });
}

// ---------------------------------------------------------------- carrying: the bag hangs from Mari's right hand
function findBone(root, re) {
  let hit = null;
  root?.traverse((o) => {
    if (!hit && o.isBone && re.test(o.name)) hit = o;
  });
  return hit;
}

// anything small in Mari's right hand (a coffee cup): `at` = offset in meters in the hand bone's frame
export function holdInHand(game, obj, at = [0, -0.08, 0.04], rot = [0, 0, 0]) {
  const root = game.playerCharacter?.root;
  const hand = findBone(root, /RightHand$/i) || findBone(root, /hand_?r$/i);
  if (!hand) return () => {};
  hand.updateWorldMatrix(true, false);
  const s = new THREE.Vector3();
  hand.matrixWorld.decompose(new THREE.Vector3(), new THREE.Quaternion(), s);
  const k = 1 / Math.max(1e-3, s.x);
  obj.scale.setScalar(k);
  obj.position.set(at[0] * k, at[1] * k, at[2] * k);
  obj.rotation.set(rot[0], rot[1], rot[2]);
  hand.add(obj);
  return () => hand.remove(obj);
}

export function carryBag(game, bag) {
  const root = game.playerCharacter?.root;
  const hand = findBone(root, /RightHand$/i) || findBone(root, /hand_?r$/i);
  if (!hand) {
    game.scene.add(bag);
    return () => {};
  }
  // the bone may be scaled (centimeter rigs): undo the world scale so the bag keeps its size
  hand.updateWorldMatrix(true, false);
  const s = new THREE.Vector3();
  hand.matrixWorld.decompose(new THREE.Vector3(), new THREE.Quaternion(), s);
  bag.scale.setScalar(1 / Math.max(1e-3, s.x));
  bag.position.set(0, -0.22 / Math.max(1e-3, s.x), 0);
  bag.rotation.set(0, 0, 0);
  hand.add(bag);
  return () => hand.remove(bag);
}

// ---------------------------------------------------------------- dye pack burst (a pink cloud that blooms and settles)
export function dyeBurst(game, at) {
  const N = 260;
  const pos = new Float32Array(N * 3);
  const vel = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    pos[i * 3] = at.x;
    pos[i * 3 + 1] = at.y;
    pos[i * 3 + 2] = at.z;
    const a = Math.random() * Math.PI * 2;
    const up = Math.random() * 1.6 + 0.3;
    const sp = Math.random() * 1.8 + 0.4;
    vel[i * 3] = Math.cos(a) * sp;
    vel[i * 3 + 1] = up;
    vel[i * 3 + 2] = Math.sin(a) * sp;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255, 255, 255, 1)');
  gr.addColorStop(1, 'rgba(255, 255, 255, 0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  const mat = new THREE.PointsMaterial({
    color: DYE,
    map: tex,
    size: 0.5,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  pts.name = 'intro2:dye';
  pts.userData.noDetailCull = true;
  game.scene.add(pts);
  let t = 0;
  const tick = (dt) => {
    t += dt;
    const drag = Math.exp(-dt * 2.2);
    for (let i = 0; i < N; i++) {
      vel[i * 3] *= drag;
      vel[i * 3 + 1] = vel[i * 3 + 1] * drag - dt * 0.25;
      vel[i * 3 + 2] *= drag;
      pos[i * 3] += vel[i * 3] * dt;
      pos[i * 3 + 1] += vel[i * 3 + 1] * dt;
      pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
    }
    geo.attributes.position.needsUpdate = true;
    mat.size = 0.5 + t * 0.55;
    mat.opacity = Math.max(0, 0.85 - t * 0.09);
    if (t > 9.5) stop();
  };
  game.updaters.push(tick);
  function stop() {
    const i = game.updaters.indexOf(tick);
    if (i >= 0) game.updaters.splice(i, 1);
    tex.dispose();
    disposeObject(pts);
  }
  return stop;
}

// ---------------------------------------------------------------- dye on Mari: her outfit takes a pink cast (restored after)
export function dyeOnHero(game, k = 0.42) {
  const root = game.playerCharacter?.root;
  const saved = [];
  root?.traverse((o) => {
    if (!o.isMesh || !o.material) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (!m.color || saved.some((s) => s.m === m)) continue;
      saved.push({ m, c: m.color.clone() });
      m.color.lerp(DYE, k);
    }
  });
  return () => {
    for (const s of saved) s.m.color.copy(s.c);
  };
}

// ---------------------------------------------------------------- bone poses on top of the animation
// poseBones(game, root, table): every frame, after the character's animation, each named bone (Mixamo names, with or
// without the "mixamorig:" prefix) is turned by its Euler (local axes) and its matrices refreshed. Returns stop().
// Runs from scene.onBeforeRender, so it also covers the player model inside cutscenes.
// (measured on the people rig: Arm about +x swings back, about -x forward; ForeArm about -z / +z bends the left / right
// hand in toward the body's middle)
export const CUFFED = {
  LeftArm: [0.42, 0, 0],
  LeftForeArm: [0, 0, -1.42],
  RightArm: [0.42, 0, 0],
  RightForeArm: [0, 0, 1.42],
};
// the customer's grab from behind: both arms forward round her waist
export const BEAR_HUG = {
  LeftArm: [-0.95, 0, 0.15],
  LeftForeArm: [0, 0, -1.45],
  RightArm: [-0.95, 0, -0.15],
  RightForeArm: [0, 0, 1.45],
};

// the cashier's "don't shoot": upper arms out to the sides, forearms straight up, palms forward
export const HANDS_UP = {
  LeftArm: [-0.25, 0, 1.3],
  LeftForeArm: [0, 0, 1.55],
  RightArm: [-0.25, 0, -1.3],
  RightForeArm: [0, 0, -1.55],
};

const hooks = new Set();
let hookScene = null;
function runHooks() {
  for (const h of hooks) h();
}

export function poseBones(game, root, table) {
  if (!root) return () => {};
  const items = [];
  for (const [name, e] of Object.entries(table)) {
    const b = findBone(root, new RegExp(`(^|:|mixamorig)${name}$`));
    if (!b) continue;
    items.push({
      b,
      q: new THREE.Quaternion().setFromEuler(new THREE.Euler(e[0], e[1], e[2])),
      done: null,
    });
  }
  const apply = () => {
    for (const it of items) {
      // the scene may render more than once a frame: turn only a freshly animated bone
      if (it.done && it.b.quaternion.equals(it.done)) continue;
      it.b.quaternion.multiply(it.q);
      it.done = (it.done || new THREE.Quaternion()).copy(it.b.quaternion);
      it.b.updateMatrixWorld(true);
    }
  };
  hooks.add(apply);
  const scene = game.scene;
  if (hookScene !== scene) {
    const prev = scene.onBeforeRender;
    scene.onBeforeRender = function (...a) {
      prev?.apply(this, a);
      runHooks();
    };
    hookScene = scene;
  }
  return () => hooks.delete(apply);
}

// Mari handcuffed: both hands behind her back
export function cuffPose(game) {
  return poseBones(game, game.playerCharacter?.root, CUFFED);
}

// ---------------------------------------------------------------- police cars with the light bar on
export function lightsOn(v) {
  try {
    v.police = true;
    v.siren?.(true);
    v.sirenOn = true;
  } catch (e) {
    /* a car without a light bar */
  }
}

// Real red / blue light from a patrol car's light bar: two point lights over the roof that strobe out of phase, so the
// colors sweep over the walls, the wet street and the faces nearby. Returns stop(). (Two per car: the scene's light
// budget fades extras instead of popping, see CONVENTIONS "Lights".)
export function policeGlow(game, v) {
  const red = new THREE.PointLight('#ff2a2a', 0, 16, 2);
  const blue = new THREE.PointLight('#2a5aff', 0, 16, 2);
  red.name = 'intro2:copRed';
  blue.name = 'intro2:copBlue';
  game.scene.add(red, blue);
  let t = Math.random();
  const side = new THREE.Vector3();
  const tick = (dt) => {
    t += dt;
    const p = v.body?.translation?.() || v.mesh?.position;
    if (!p) return;
    const r = v.body?.rotation?.();
    const h = r ? 2 * Math.atan2(r.y, r.w) : 0;
    side.set(Math.cos(h) * 0.45, 0, -Math.sin(h) * 0.45);
    red.position.set(p.x - side.x, p.y + 1.75, p.z - side.z);
    blue.position.set(p.x + side.x, p.y + 1.75, p.z + side.z);
    // double flash, then the other color: 0.7 s per cycle
    const ph = (t / 0.7) % 1;
    const flash = (a) => (a < 0.12 || (a > 0.2 && a < 0.32) ? 1 : 0);
    red.intensity = 38 * flash(ph);
    blue.intensity = 42 * flash((ph + 0.5) % 1);
  };
  game.updaters.push(tick);
  return () => {
    const i = game.updaters.indexOf(tick);
    if (i >= 0) game.updaters.splice(i, 1);
    game.scene.remove(red, blue);
    red.dispose();
    blue.dispose();
  };
}
