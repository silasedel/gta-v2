// Southline vehicles: procedural cars + Rapier raycast-vehicle physics + lane-following traffic AI.
import * as THREE from 'three';
import { breathe, compileSliced, initTexturesSliced } from '../core/pace.js';
import {
  buildCar,
  CAR_TYPES,
  MODELS,
  CLASSES,
  ALL_KEYS,
  rollVariant,
  brokenGlassMat,
  isBuilt,
  wheelBuilt,
  prebuild,
  releaseCar,
  evictIdleModels,
  noteOwnGeoFreed,
  modelGpuStats,
} from './carModel2.js';
import {
  rollLook,
  visualSignature,
  lookSignature,
  incomeFor,
  fleetMix,
  tierWeight,
} from './catalog.js';
import { rollDriver, createDriverStats } from './traffic/drivers.js';
import { smoothAiControls } from './traffic/smooth.js'; // [vehicles-look hook]
import { setPaintWetness } from './model/materials.js';
import { dentMesh } from './damage.js';
import { createBoats } from './boats.js';
import {
  buildRoadNet,
  project,
  sampleEdge,
  laneOffset,
  laneCount,
  driveLaneMax,
  lanePointAt,
  exitsAt,
  edgeDirAt,
  signalState,
  randomLane,
} from './roadnet.js';
import { createCharacter } from '../player/characterModel.js';
import { createSkids, createScreech, createSmoke, createShards, playImpact } from './skids.js';
import {
  addExternalModel,
  hasExternalModel,
  buildExternalCar,
  createKindRegistry,
  externalModelKeys,
} from './registry.js';
import { initFleet } from './glb/index.js';
import { createHotwire } from './ui/hotwire.js';
import { createRadioUI } from './ui/radio.js';
import { loadCarModel, buildStaticCar } from './glb/glbCar.js';
import { RARE_PLACEMENTS } from './glb/placements.js';
import { createUtilitySpots } from './glb/spots.js';
import { createShapeVehicle } from './physics/suspension.js'; // r2-physics (carphys 2)
import { WEATHER_U } from '../render/wetSurfaces.js'; // r2-physics: wet-road grip

const PALETTE = [
  0xff6a2b, 0x1fb5b0, 0x173b8f, 0xeeeeea, 0x101214, 0xa9aeb4, 0xb3121b, 0x7c2fbf, 0x2f6d3a,
  0xf0b62a, 0x5a6470, 0xd9447a, 0x0e5e7a, 0xe7dcc4,
];
const UP = new THREE.Vector3(0, 1, 0);
const _v = new THREE.Vector3(),
  _v2 = new THREE.Vector3(),
  _q = new THREE.Quaternion();
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
// finite-or-fallback, then clamp to +-lim (lim only for magnitude)
const fin = (x, fallback, lim) =>
  Number.isFinite(x) ? Math.max(-lim, Math.min(lim, x)) : fallback;
const lerp = (a, b, t) => a + (b - a) * t;

export async function createVehicles(game) {
  const { RAPIER, world, scene } = game;
  const city = game.city;
  const list = [];
  // r2-physics: which car physics runs (1 = Rapier ray-cast controller, 2 = shape-cast suspension); default 1 until verified
  const CARPHYS_Q = /[?&]carphys=(\d)/.exec(globalThis.location?.search || '');
  const carPhys = () => game.physics?.carphys ?? (CARPHYS_Q ? +CARPHYS_Q[1] : 1);

  // ------------------------------------------------------------ road network (city.roadGraph or legacy grid)
  const net = buildRoadNet(city);
  net.game = game; // signalState reads game.traffic?.signalAt when a world module drives the lights
  // the user's library cars (src/vehicles/glb): registered into CAR_TYPES / MODELS / CLASSES, GLBs stream in; ?libcars=0 = procedural only
  let fleet = null;
  try {
    if (!/[?&]libcars=0/.test(globalThis.location?.search || ''))
      fleet = await initFleet({ CAR_TYPES, MODELS, CLASSES, ALL_KEYS });
  } catch (e) {
    console.error('[cars] library fleet failed', e);
    fleet = null;
  }
  const groundY = (x, z, y) => (y != null ? y : (city?.groundHeightAt?.(x, z) ?? 0));
  const isNear = (p, R) =>
    list.some(
      (v) => v.body && distXZ(v.body.translation(), p) < Math.max(R, (v.spec.L + 5) / 2 + 1.2),
    );
  // footprint test: inflated chassis box vs every existing collider (buildings, props, kerbs above 0.3 m, other cars)
  const _fq = new THREE.Quaternion();
  function spotFree(pos, heading, spec = CAR_TYPES.sedan, ignoreBody = null) {
    if (isNear(pos, (spec.L + 4.5) / 2 + 0.8)) {
      // precise check against our own cars (oriented boxes, fast path)
      for (const v of list) {
        if (v.body === ignoreBody) continue;
        const t = v.body.translation();
        const need = (spec.L + v.spec.L) / 2 + 0.8;
        if (distXZ(t, pos) < need && Math.abs(t.y - v.groundOff - (pos.y || 0)) < 3) {
          // lateral separation along our heading's right axis
          const dx = t.x - pos.x,
            dz = t.z - pos.z;
          const lat = Math.abs(dx * Math.cos(heading) - dz * Math.sin(heading));
          const lon = Math.abs(dx * Math.sin(heading) + dz * Math.cos(heading));
          if (lat < (spec.W + v.spec.W) / 2 + 0.35 && lon < need) {
            spotWhy = 'car';
            return false;
          }
        }
      }
    }
    // curbside trash / recycling carts (lot props): keep the car body 2 m clear of each cart pair (pair = point +-0.6 m)
    const owners = game.lotProps?.owners;
    if (owners) {
      const c = Math.cos(heading),
        s = Math.sin(heading);
      for (const its of owners.values())
        for (const it of its) {
          if (it.name !== 'cart' && it.name !== 'bin_wheel') continue;
          const dx = it.x - pos.x,
            dz = it.z - pos.z;
          if (dx * dx + dz * dz > 100) continue;
          const ex = Math.max(0, Math.abs(dx * c - dz * s) - spec.W / 2),
            ez = Math.max(0, Math.abs(dx * s + dz * c) - spec.L / 2);
          if (ex * ex + ez * ez < 2.0 * 2.0) {
            spotWhy = 'cart';
            return false;
          }
        }
    }
    // perf (Nov 19): physics shape queries for spawn spots get at most ~2 ms a frame; past that the spot is refused and the
    // caller tries again next frame (traffic respawns ran 40 tries x several cars in one frame: 100-640 ms stalls)
    const qNow = performance.now(),
      qF = game.clock?.elapsed ?? qNow;
    if (qF !== spotQ.t) {
      spotQ.t = qF;
      spotQ.ms = 0;
    }
    if (spotQ.ms > 2) {
      spotWhy = 'budget';
      return false;
    }
    try {
      const hh = Math.max(0.3, (spec.roofY - 0.35) / 2);
      _fq.setFromAxisAngle(UP, heading);
      const shape = new RAPIER.Cuboid(spec.W / 2 + 0.25, hh, spec.L / 2 + 0.35);
      const hit = world.intersectionWithShape(
        { x: pos.x, y: (pos.y || 0) + 0.35 + hh, z: pos.z },
        { x: _fq.x, y: _fq.y, z: _fq.z, w: _fq.w },
        shape,
        QF.EXCLUDE_SENSORS,
        undefined,
        undefined,
        ignoreBody || undefined,
      );
      if (hit) {
        spotWhy = 'solid';
        spotQ.ms += performance.now() - qNow;
        return false;
      }
      if (city?.collidersReadyAt && !city.collidersReadyAt(pos.x, pos.z)) {
        spotWhy = 'tile';
        return false;
      }
      // the ground (streamed static colliders) must exist under the spot
      const gh = world.castRay(
        new RAPIER.Ray({ x: pos.x, y: (pos.y || 0) + 2.5, z: pos.z }, { x: 0, y: -1, z: 0 }),
        6,
        true,
        QF.EXCLUDE_DYNAMIC | QF.EXCLUDE_KINEMATIC | QF.EXCLUDE_SENSORS,
      );
      if (!gh) {
        spotWhy = 'ground';
        spotQ.ms += performance.now() - qNow;
        return false;
      }
    } catch (e) {
      spotWhy = 'query';
      return false; /* query pipeline not ready: try later */
    }
    spotQ.ms += performance.now() - qNow;
    return true;
  }
  const spotQ = { t: 0, ms: 0 };
  let spotWhy = ''; // why spotFree last said no (traffic spawn diagnostics: game.vehicles.trafficDebug.rej)
  const spawnRej = {};
  const rej = (k) => {
    spawnRej[k] = (spawnRej[k] || 0) + 1;
  };
  // random lane position: { edge, dir, d, lane, pos: Vector3, heading }
  const MINOR = /service|living|track|path|parking|driveway|pedestrian/;
  const trafficEdge = { edge: (e) => !MINOR.test(e.kind || '') };
  function randomLanePos(nearPos, minD, maxD, notInView, tries = 40, spec) {
    for (let i = 0; i < tries; i++) {
      const info = randomLane(net, nearPos, minD, maxD, trafficEdge, 4);
      if (!info) {
        rej('lane');
        continue;
      }
      const pos = new THREE.Vector3(info.x, groundY(info.x, info.z, info.y), info.z);
      if (notInView && spawnVisible(pos)) {
        rej('view');
        continue;
      }
      if (isNear(pos, 10)) {
        rej('near');
        continue;
      }
      if (!spotFree(pos, info.heading, spec || CAR_TYPES.sedan)) {
        rej(spotWhy);
        if (spotWhy === 'budget') return null;
        continue;
      }
      // keep clear of junctions
      if (info.d < 10 || info.edge.len - info.d < 10) {
        rej('junction');
        continue;
      }
      rej('ok');
      return { ...info, pos };
    }
    return null;
  }
  const PARK_KINDS = /residential|living|unclassified|tertiary|secondary|street|service/;
  function parkedSpot(near, minD, maxD, notInView = false, spec = CAR_TYPES.suv) {
    for (let i = 0; i < 60; i++) {
      const info = randomLane(net, near, minD, maxD, null, 3);
      if (!info) continue;
      const e = info.edge;
      if (e.bridge || (!net.legacy && !PARK_KINDS.test(e.kind || ''))) continue;
      if (info.d < 12 || e.len - info.d < 12) continue;
      const curb = (e.oneway ? e.width / 2 : e.width / 2) - 1.15;
      const p = lanePointAt(e, info.dir, info.d, curb);
      const pos = new THREE.Vector3(p.x, groundY(p.x, p.z, p.y), p.z);
      if (city?.isWater?.(pos.x, pos.z)) continue;
      if (notInView && spawnVisible(pos)) continue;
      if (isNear(pos, 7)) continue;
      const heading = Math.atan2(p.fx, p.fz);
      if (!spotFree(pos, heading, spec)) {
        if (spotWhy === 'budget') return null;
        continue;
      }
      if (
        game.placement?.parkOk &&
        !game.placement.parkOk(pos.x, pos.z, heading, spec?.L || 4.8, spec?.W || 2.0, e)
      )
        continue; // map audit: no curb spot in a bush or a narrow lane (world/placement.v2.js)
      return { pos, heading, edge: e };
    }
    return null;
  }
  const distXZ = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
  const _frus = new THREE.Frustum(),
    _pm = new THREE.Matrix4();
  function inView(p) {
    const cam = game.camera;
    if (!cam) return false;
    cam.updateMatrixWorld();
    _pm.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    _frus.setFromProjectionMatrix(_pm);
    return (
      _frus.intersectsSphere(new THREE.Sphere(new THREE.Vector3(p.x, 1, p.z), 4)) &&
      cam.position.distanceTo(p) < 260
    );
  }
  // spawn visibility: wider than inView (a margin around the screen, out to the fog), plus a corridor along the player car's
  // velocity, so a car never appears where the player will be looking or driving in the next few seconds
  const _sph = new THREE.Sphere(new THREE.Vector3(), 12);
  function spawnVisible(p) {
    const cam = game.camera;
    if (cam) {
      cam.updateMatrixWorld();
      _pm.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
      _frus.setFromProjectionMatrix(_pm);
      _sph.center.set(p.x, (p.y || 0) + 1, p.z);
      if (cam.position.distanceTo(_sph.center) < 420 && _frus.intersectsSphere(_sph)) return true;
    }
    let pv = null;
    try {
      pv = playerCarRef && !playerCarRef.disposed ? playerCarRef.body.linvel() : null;
    } catch (e) {
      pv = null;
    } // (declared further down)
    if (pv) {
      const sp = Math.hypot(pv.x, pv.z);
      if (sp > 6) {
        const pt = playerCarRef.body.translation(),
          dx = p.x - pt.x,
          dz = p.z - pt.z,
          d = Math.hypot(dx, dz) || 1;
        const cos = (dx * pv.x + dz * pv.z) / (d * sp);
        if (cos > 0.45 && d < 80 + sp * 7) return true; // ahead within ~7 s of travel
      }
    }
    return false;
  }

  // ------------------------------------------------------------ shared headlight spot (player car only)
  const spot = new THREE.SpotLight(0xfff0dc, 0, 80, 0.62, 0.55, 1.2);
  spot.castShadow = false;
  scene.add(spot);
  scene.add(spot.target);
  const spot2 = new THREE.SpotLight(0xfff0dc, 0, 45, 0.9, 0.8, 1.4); // wide near fill
  scene.add(spot2);
  scene.add(spot2.target);

  const skids = createSkids(scene);
  const screech = createScreech();
  const smoke = createSmoke(scene);
  const shards = createShards(scene);
  const exhaust = createSmoke(scene, 80, { color: 0x9a9894, scale: 0.3 });
  const fire = createSmoke(scene, 160, { color: 0xff7a1a, additive: true, fire: true });
  const fireLight = new THREE.PointLight(0xff7a2a, 0, 18, 1.5);
  scene.add(fireLight);
  let impactCooldown = 0;

  // fake headlight pools on the ground (cheap night glow for every car)
  function poolTexture(red) {
    const cv = document.createElement('canvas');
    cv.width = 64;
    cv.height = 64;
    const c = cv.getContext('2d');
    const g = c.createRadialGradient(32, red ? 32 : 24, 0, 32, red ? 32 : 28, red ? 30 : 28);
    g.addColorStop(0, red ? 'rgba(255,40,20,0.9)' : 'rgba(255,240,215,1)');
    g.addColorStop(0.5, red ? 'rgba(255,20,10,0.25)' : 'rgba(255,225,190,0.35)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, 64, 64);
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }
  const poolMat = new THREE.MeshBasicMaterial({
    map: poolTexture(false),
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    opacity: 0.5,
    polygonOffset: true,
    polygonOffsetFactor: -3,
    fog: true,
  });
  const tailPoolMat = new THREE.MeshBasicMaterial({
    map: poolTexture(true),
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    opacity: 0.35,
    polygonOffset: true,
    polygonOffsetFactor: -3,
    fog: true,
  });
  const poolGeo = new THREE.PlaneGeometry(6.5, 13).rotateX(-Math.PI / 2);
  const tailPoolGeo = new THREE.PlaneGeometry(2.6, 2.0).rotateX(-Math.PI / 2);

  const copRed = new THREE.PointLight(0xff1a1a, 0, 28, 1.6);
  const copBlue = new THREE.PointLight(0x2a4dff, 0, 28, 1.6);
  scene.add(copRed, copBlue);

  // ------------------------------------------------------------ horn audio
  let actx = null;
  function horn(vehicle) {
    try {
      actx ||= new (window.AudioContext || window.webkitAudioContext)();
      const now = actx.currentTime;
      const g = actx.createGain();
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(0.18, now + 0.02);
      g.gain.setValueAtTime(0.18, now + 0.45);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.55);
      const f = actx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 1800;
      g.connect(f);
      f.connect(actx.destination);
      const cls = vehicle?.spec?.cls;
      const base = vehicle?.spec?.heavy
        ? 260
        : cls === 'sports' || cls === 'super'
          ? 470
          : cls === 'suv' || cls === 'pickup'
            ? 330
            : 400;
      for (const fr of [base, base * 1.26]) {
        const o = actx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = fr;
        o.connect(g);
        o.start(now);
        o.stop(now + 0.6);
      }
    } catch (e) {
      /* no audio */
    }
  }

  let siren = null;
  function sirenAudio(on) {
    try {
      if (on && !siren) {
        actx ||= new (window.AudioContext || window.webkitAudioContext)();
        if (actx.state === 'suspended') actx.resume();
        const o = actx.createOscillator();
        o.type = 'square';
        o.frequency.value = 750;
        const lfo = actx.createOscillator();
        lfo.type = 'triangle';
        lfo.frequency.value = 0.35;
        const lg = actx.createGain();
        lg.gain.value = 320;
        lfo.connect(lg).connect(o.frequency);
        const f = actx.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.value = 2200;
        const g = actx.createGain();
        g.gain.value = 0.045;
        o.connect(f).connect(g).connect(actx.destination);
        o.start();
        lfo.start();
        siren = { o, lfo, g };
      } else if (!on && siren) {
        const t = actx.currentTime;
        siren.g.gain.setTargetAtTime(0, t, 0.05);
        siren.o.stop(t + 0.3);
        siren.lfo.stop(t + 0.3);
        siren = null;
      }
    } catch (e) {
      siren = null;
    }
  }

  // ------------------------------------------------------------ vehicle factory
  let nameCounter = 0;
  const PROC_FOR = {
    suv: 'suv',
    pickup: 'pickup',
    van: 'van',
    truck: 'atlas_box',
    compact: 'compact',
    sports: 'sports',
    muscle: 'muscle',
    super: 'super',
    police: 'police',
    taxi: 'taxi',
    ambulance: 'ambulance',
    firetruck: 'firetruck',
  };
  function createVehicle(typeKey, color, pos, heading, opts = {}) {
    if (fleet && !opts.look && !opts.exact && !hasExternalModel(typeKey))
      typeKey = fleet.resolve(typeKey);
    if (!CAR_TYPES[typeKey]) typeKey = 'sedan';
    const spec = CAR_TYPES[typeKey];
    const isExt = hasExternalModel(typeKey);
    let look = null;
    if (!isExt) {
      look = opts.look || rollUniqueLook(typeKey, pos, opts.seed);
      if (fleet?.isGlb(typeKey) && !opts.look) fleet.look(typeKey, look);
      if (opts.stripe) look.stripe = opts.stripe;
      if (opts.interior != null) look.interior = opts.interior; // cabin leather color (glbCar interiorGeo)
      if (opts.ride != null) look.ride = opts.ride;
      if (opts.finish) look.finish = opts.finish;
      if (opts.old) look.old = true; // flat chrome, dusty glass (glbCar)
      if (opts.tint != null) look.tint = opts.tint; // window tint level 0-3 (model/body/mats.js TINTS)
      if (opts.wear && typeof opts.wear === 'object' && !opts.look) {
        const W = opts.wear;
        for (const k of ['dirt', 'rust', 'fade', 'age']) if (W[k] != null) look.wear[k] = W[k];
        if (W.dirtColor) look.wear.dirtColor = W.dirtColor;
        look.signature = lookSignature(look);
      } else if (opts.wear != null && !opts.look) {
        const w = Math.max(0, Math.min(1, +opts.wear));
        look.wear.dirt = Math.max(look.wear.dirt, 0.15 + w * 0.6);
        look.wear.rust = w > 0.35 ? Math.min(1, (w - 0.3) * 1.3) : 0;
        look.wear.fade = w > 0.4 ? Math.min(0.8, (w - 0.4) * 1.3) : 0;
        look.wear.age = Math.max(look.wear.age || 0, w);
        look.signature = lookSignature(look);
      }
      if (color != null && !opts.look) {
        look.color = color;
        look.twoTone = opts.twoTone ?? null;
        if (opts.wear == null) {
          look.wear.dirt = Math.min(look.wear.dirt, 0.15);
          look.wear.rust = 0;
          look.dents = [];
        }
        look.signature = lookSignature(look);
      }
      if (!isBuilt(typeKey, look.kit)) look.kit = 'base';
    }
    const variant =
      opts.variant ||
      (isExt
        ? {
            color: spec.palette[(Math.random() * spec.palette.length) | 0],
            kit: 'base',
            wheel: null,
            blackRoof: false,
          }
        : { color: look.color, kit: look.kit, wheel: look.wheel, blackRoof: !!look.twoTone });
    if (color == null) color = variant.color;
    let model = isExt
      ? buildExternalCar(typeKey, color, {
          variant,
          seed: opts.seed ?? (Math.random() * 0x7fffffff) | 0,
          custom: opts.custom,
        })
      : null;
    if (!model && fleet && spec.glb) {
      try {
        model = fleet.build(typeKey, look);
      } catch (e) {
        console.error('[cars] build failed', typeKey, e);
        model = null;
      }
    }
    if (!model && spec.glb) {
      const pk = PROC_FOR[spec.cls] || 'sedan';
      model = buildCar(pk, color ?? look?.color ?? 0xa9aeb4, {});
    }
    if (!model)
      model = buildCar(
        CAR_TYPES[typeKey] && !isExt
          ? typeKey
          : spec.cls === 'super'
            ? 'super'
            : spec.cls === 'suv'
              ? 'suv'
              : 'sports',
        !isExt && look ? look : color,
        {
          kit: variant.kit === 'base' || !isExt ? variant.kit : 'base',
          wheel: variant.wheel,
          blackRoof: variant.blackRoof,
        },
      );
    const [restLen, stiff] = spec.susp || [0.36, 34];
    const eqLen = restLen - 9.81 / (4 * stiff);
    const groundOff = eqLen + spec.r; // body origin height above ground at rest
    model.shell.position.y = -groundOff + (look?.ride || 0); // per-car ride height (lowered / lifted)
    scene.add(model.root);
    const pool = new THREE.Mesh(poolGeo, poolMat);
    pool.position.set(0, -groundOff + 0.04, spec.L / 2 + 6.0);
    pool.visible = false;
    pool.renderOrder = 1;
    const tailPool = new THREE.Mesh(tailPoolGeo, tailPoolMat);
    tailPool.position.set(0, -groundOff + 0.04, -spec.L / 2 - 0.3);
    tailPool.visible = false;
    tailPool.renderOrder = 1;
    model.root.add(pool, tailPool);
    model.pool = pool;
    model.tailPool = tailPool;
    // sun shadows: every car mesh is a caster of the per-frame dynamic shadow map (world/env/shadows.js LAYER_DYNAMIC = 7)
    // right away, not only once the shadow tagger has discovered the car (parked cars spawned early were missed)
    model.root.traverse((o) => {
      if (o.isMesh || o.isInstancedMesh) {
        o.layers.enable(7);
        o.layers.disable(6);
      }
    });

    // rigid body
    const q = new THREE.Quaternion().setFromAxisAngle(UP, heading);
    const mass = spec.mass;
    const L = spec.L,
      W = spec.W,
      H = spec.belt - spec.yb;
    const bd = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(pos.x, (pos.y || 0) + groundOff + 0.08, pos.z)
      .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
      .setCcdEnabled(false)
      .setLinearDamping(0.02)
      .setAngularDamping(0.35)
      .setCanSleep(true)
      .setAdditionalMassProperties(
        mass,
        // library cars: center of mass at a real height above the ground (spec.comY, per class), else the old offsets
        {
          x: 0,
          y:
            spec.comY != null
              ? spec.comY - groundOff
              : spec.comHigh
                ? 0.05
                : spec.wedge
                  ? -0.24
                  : -0.18,
          z: spec.wedge ? -0.15 : 0.05,
        },
        {
          x: (mass / 12) * (H * H + L * L) * 1.15,
          y: (mass / 12) * (W * W + L * L) * 1.15,
          z: (mass / 12) * (W * W + H * H) * 1.3,
        },
        { x: 0, y: 0, z: 0, w: 1 },
      );
    const body = world.createRigidBody(bd);
    const rr = 0.08;
    const lowerCy = (spec.yb + 0.06 + spec.belt) / 2 - groundOff;
    const c1 = RAPIER.ColliderDesc.roundCuboid(
      W / 2 - 0.02 - rr,
      (spec.belt - spec.yb - 0.06) / 2 - rr,
      L / 2 - 0.03 - rr,
      rr,
    )
      .setTranslation(0, lowerCy, 0)
      .setDensity(0)
      .setFriction(0.6)
      .setRestitution(0.15);
    const Wc = W - 2 * spec.cabInset;
    const c2 = RAPIER.ColliderDesc.roundCuboid(
      Wc / 2 - rr,
      (spec.roofY - spec.belt) / 2 - rr,
      (spec.zA - spec.zD) / 2 - rr,
      rr,
    )
      .setTranslation(0, (spec.roofY + spec.belt) / 2 - groundOff, (spec.zA + spec.zD) / 2)
      .setDensity(0)
      .setFriction(0.3)
      .setRestitution(0.05);
    let col1 = null;
    try {
      const hp = model.hull;
      if (hp && hp.length >= 12) {
        const pts = new Float32Array(hp.length);
        for (let i = 0; i < hp.length; i += 3) {
          pts[i] = hp[i];
          pts[i + 1] = hp[i + 1] - groundOff;
          pts[i + 2] = hp[i + 2];
        }
        const hd = RAPIER.ColliderDesc.convexHull(pts);
        if (hd)
          col1 = world.createCollider(hd.setDensity(0).setFriction(0.6).setRestitution(0.15), body);
      }
    } catch (e) {
      col1 = null;
    }
    if (!col1) {
      col1 = world.createCollider(c1, body);
      if (!(spec.convertible || spec.cls === 'roadster' || spec.roadster))
        world.createCollider(c2, body);
    } // [car-bodies C2] open cars: no cabin box
    // vertical bumper blocks at both ends (0.28-0.68 m): car-to-car hits push horizontally instead of ramping
    for (const zs of [1, -1]) {
      const bh = 0.2,
        by = 0.48 - groundOff,
        bz = zs * (L / 2 - 0.16);
      world.createCollider(
        RAPIER.ColliderDesc.cuboid(W / 2 - 0.12, bh, 0.16)
          .setTranslation(0, by, bz)
          .setDensity(0)
          .setFriction(0.6)
          .setRestitution(0.15),
        body,
      );
    }

    // mass properties are otherwise only computed at the next world.step(): a vehicle-controller tick before that
    // sees mass 0 (inverse mass inf) and produces NaN velocities.  Compute them now.
    try {
      body.recomputeMassPropertiesFromColliders();
    } catch (e) {
      /* older rapier */
    }
    // raycast vehicle
    const vc = makeController(body, model.wheels, spec, restLen, stiff);

    const v = {
      name: opts.name || `${spec.label} #${++nameCounter}`,
      typeKey,
      spec,
      body,
      vc,
      mesh: model.root,
      car: model,
      collider: col1,
      groundOff,
      restLen,
      stiff,
      id: nameCounter,
      speedKmh: 0,
      speed: 0,
      playerDriven: false,
      lightsOn: false,
      braking: false,
      reversing: false,
      sirenActive: false,
      sirenOn: false,
      police: !!spec.police || !!opts.police,
      health: 1000,
      disabled: false,
      locked: !!opts.locked,
      variant,
      alive: true,
      disposed: false,
      external: !!opts.external,
      engineOn: !!opts.ai,
      engineOffT: 0,
      submerged: 0,
      inWater: false,
      flooded: false,
      velocity: new THREE.Vector3(),
      wheelDmg: [0, 0, 0, 0],
      driver: null,
      driverChar: null,
      chaseTarget: null,
      model: { key: typeKey, ...(MODELS[typeKey] || MODELS.sedan) },
      rpm: (MODELS[typeKey] || MODELS.sedan).idleRpm,
      gear: 1,
      throttle: 0,
      load: 0,
      shiftT: 0,
      guardT: 0,
      prevPD: false,
      ctrl: { throttle: 0, steer: 0, brake: 0, handbrake: false },
      steerCur: 0,
      flipT: 0,
      ai: opts.ai ? makeAI() : null,
      parked: !opts.ai,
      setControls(c) {
        const k = this.ctrl;
        k.throttle = clamp(+c.throttle || 0, -1, 1);
        k.steer = clamp(+c.steer || 0, -1, 1);
        k.brake = clamp(+c.brake || 0, 0, 1);
        k.handbrake = !!c.handbrake;
      },
      exitPosition() {
        const t = body.translation(),
          r = body.rotation();
        _q.set(r.x, r.y, r.z, r.w);
        const p = new THREE.Vector3(spec.W / 2 + 1.05, 0, 0.35).applyQuaternion(_q);
        p.y = 0;
        return new THREE.Vector3(t.x + p.x, Math.max(0, t.y - groundOff), t.z + p.z);
      },
      // world position of seat i's hip point (H-point), driver = 0
      seatPosition(i = 0) {
        return seatWorld(this, i);
      },
      seatAnchor(i = 0) {
        return seatAnchor(this, i);
      },
      get seatCount() {
        return seatList(this).length;
      },
      horn() {
        if (this.police) {
          this.sirenOn = !this.sirenOn;
          return;
        }
        horn(this);
      },
      siren(on) {
        this.sirenOn = on === undefined ? !this.sirenOn : !!on;
        return this.sirenOn;
      },
      setChaseTarget(target) {
        this.chaseTarget = target || null;
        try {
          if (target) city?.registerAnchor?.(this, 70);
          else city?.unregisterAnchor?.(this);
        } catch (e) {
          /* city without anchors */
        }
        if (target) {
          if (!this.ai) this.ai = makeAI();
          this.ai.chase = { stuckT: 0, revT: 0 };
          this.parked = false;
          if (this.police) this.sirenOn = true;
        } else if (this.ai) {
          this.ai.chase = null;
          this.ai.edge = null;
          this.ai.next = null;
          this.ai.stuckT = 0;
        }
      },
      ejectDriver() {
        const p = this.exitPosition();
        removeDriver(this);
        if (this.ai) this.ai = null;
        return p;
      },
      damage(amount, localPoint) {
        applyDamage(this, amount, localPoint);
      },
      flip() {
        flipReset(this);
      },
      get position() {
        const t = body.translation();
        return new THREE.Vector3(t.x, t.y, t.z);
      },
      get heading() {
        const r = body.rotation();
        _q.set(r.x, r.y, r.z, r.w);
        _v.set(0, 0, 1).applyQuaternion(_q);
        return Math.atan2(_v.x, _v.z);
      },
    };
    v.kind = 'car';
    list.push(v);
    if (look) {
      v.look = look;
      registerLook(v);
    }
    game.emit?.('vehicle:spawned', { vehicle: v });
    // driver is added lazily in update() when the car is near (one per frame)
    return v;
  }
  // (re)build a ray-cast vehicle controller; a fresh one never holds stale ground-collider handles
  // r2-physics: carphys 2 = shape-cast suspension + tire model (src/vehicles/physics/suspension.js), same controller API.
  // ?carphys=2 (or game.physics.setCarPhysics(2) at runtime); falls back to Rapier's ray-cast controller on any error.
  function makeController(body, wheels, spec, restLen, stiff) {
    if (carPhys() === 2) {
      try {
        let vr = null;
        return createShapeVehicle(game, body, wheels, spec, restLen, stiff, {
          isPlayer: () => !!(vr ||= list.find((x) => x.body === body))?.playerDriven,
        });
      } catch (e) {
        console.error('[r2-physics] shape-cast controller failed, using the ray-cast one', e);
      }
    }
    const vc = world.createVehicleController(body);
    vc.indexUpAxis = 1;
    vc.setIndexForwardAxis = 2;
    wheels.forEach((w, i) => {
      vc.addWheel(
        { x: w.x, y: 0, z: w.z },
        { x: 0, y: -1, z: 0 },
        { x: -1, y: 0, z: 0 },
        restLen,
        spec.r,
      );
      vc.setWheelSuspensionStiffness(i, stiff);
      vc.setWheelSuspensionCompression(i, 0.55 * 2 * Math.sqrt(stiff));
      vc.setWheelSuspensionRelaxation(i, 0.75 * 2 * Math.sqrt(stiff));
      vc.setWheelMaxSuspensionTravel(i, spec.travel ?? 0.25); // library cars: compression limited to the real room under the fender
      vc.setWheelMaxSuspensionForce(i, spec.mass * 40);
      vc.setWheelFrictionSlip(i, spec.grip);
      vc.setWheelSideFrictionStiffness(i, 1.0);
    });
    return vc;
  }
  let driverSeq = (Date.now() >>> 3) & 0xffff;
  const driverStats = createDriverStats();
  function makeAI() {
    return {
      drv: null,
      lcT: 2 + Math.random() * 4,
      signal: 0,
      phoneT: 0,
      wanderT: 0,
      wanderK: 1,
      seenBlock: null,
      edge: null,
      dir: 1,
      d: 0,
      lane: 0,
      next: null,
      cruiseK: 0.85 + Math.random() * 0.25,
      stuckT: 0,
      blockedT: 0,
      fleeT: 0,
      honkT: 0,
      chase: null,
    };
  }

  // ------------------------------------------------------------ soft ground under a car: 1 = loose sand, 0 = pavement
  const SOFT = [
    [/^(sand|dune|beach|shell|island|sandbar)$/, 1],
    [/mud|swamp|wetland/, 0.8],
    [/damp/, 0.75],
    [/dirt|gravel|soil|track|farm/, 0.45],
    [/grass|lawn|turf|field|park|meadow|scrub/, 0.3],
  ];
  function softAt(x, z, y) {
    try {
      const k = String((game.surfaceAt || city?.surfaceAt)?.(x, z, y) ?? '');
      if (/asphalt|concrete|paved|metal|wood|tile|brick|stone|pier/.test(k)) return 0;
      if (game.sand?.isSand?.(x, z)) return 1;
      for (const [re, s] of SOFT) if (re.test(k)) return s;
    } catch (e) {
      /* no surface data */
    }
    return 0;
  }

  // ------------------------------------------------------------ seat anchors (src/vehicles/README.md "Seats")
  // Shell space (children of v.car.shell): ground y = 0, +Z forward, +X = the car's left (US driver side), z = 0 mid-wheelbase.
  // Library models carry seats measured from their interior (tools/v2/cars/seats.py -> manifest `seats` / `wheel`); procedural
  // and hero cars get the old estimate from the spec.  hip = H-point (hip joint), heel = floor where the heels rest,
  // wheel = steering wheel rim center / radius / tilt (driver only), roofY = headliner over the hip, doorX = inner door |x|.
  function seatList(v) {
    if (v._seats) return v._seats;
    const sp = v.spec,
      A = v.car?.seatAnchors || sp.seatAnchors;
    let L;
    if (A?.length)
      L = A.map((q) => ({
        id: q.id,
        hip: q.hip,
        heel: q.heel,
        yaw: q.yaw || 0,
        roofY: q.roofY,
        doorX: q.doorX,
      }));
    else {
      const seatZ = sp.zA - (sp.coupe ? 1.15 : 1.25) + 0.2,
        y = Math.min(sp.belt - 0.09, sp.roofY - 0.88) + 0.12,
        x = Math.min(0.4, (sp.W || 1.8) / 2 - 0.42);
      const mk = (id, sx, z) => ({
        id,
        hip: [sx, y, z],
        heel: [sx, y - 0.32, z + 0.78],
        yaw: 0,
        roofY: sp.roofY - 0.06,
        doorX: (sp.W || 1.8) / 2 - 0.08,
      });
      L = [mk('driver', x, seatZ), mk('front', -x, seatZ)];
      if (!sp.coupe && !sp.bike)
        L.push(mk('rearL', x, seatZ - 0.95), mk('rearR', -x, seatZ - 0.95));
    }
    const W = v.car?.steerWheel || sp.steerWheel;
    v._seats = L.map((q, i) => ({
      id: q.id || (i === 0 ? 'driver' : i === 1 ? 'front' : 'rear' + i),
      i,
      side: q.hip[0] >= 0 ? 1 : -1,
      yaw: q.yaw || 0,
      hip: new THREE.Vector3().fromArray(q.hip),
      heel: new THREE.Vector3().fromArray(q.heel || [q.hip[0], q.hip[1] - 0.32, q.hip[2] + 0.78]),
      roofY: q.roofY ?? sp.roofY - 0.06,
      doorX: q.doorX ?? (sp.W || 1.8) / 2 - 0.08,
      wheel:
        i === 0
          ? W
            ? { c: new THREE.Vector3().fromArray(W.c), r: W.r ?? 0.19, tilt: W.tilt ?? 0.38 }
            : {
                c: new THREE.Vector3(q.hip[0], q.hip[1] + 0.34, q.hip[2] + 0.5),
                r: 0.19,
                tilt: 0.38,
              }
          : null,
    }));
    return v._seats;
  }
  /** seatAnchor(v, i = 0) -> { id, i, hip, heel, yaw, wheel: { c, r, tilt } | null, side, roofY, doorX } in shell space (null if no seat i) */
  function seatAnchor(v, i = 0) {
    const L = v?.car ? seatList(v) : null;
    return L?.[i] || null;
  }
  /** seatWorld(v, i = 0, out?) -> world-space hip point of seat i */
  function seatWorld(v, i = 0, out = new THREE.Vector3()) {
    const a = seatAnchor(v, i);
    if (!a) return out.copy(v.position);
    v.car.shell.updateWorldMatrix(true, false);
    return out.copy(a.hip).applyMatrix4(v.car.shell.matrixWorld);
  }
  // until src/npc/seat.js exists (r2-people): the drive clip's pelvis sits this far above / ahead of the character root
  const HIP_IN_ROOT = new THREE.Vector3(0, 0.095, -0.059); // hip joints (UpLeg bones) in the drive clip, measured
  let seatMod = null; // { seatCharacter, createSeatedPerson } once r2-people's module lands
  try {
    const g = import.meta.glob('../npc/seat.js');
    const f = g['../npc/seat.js'];
    if (f)
      f()
        .then((m) => {
          seatMod = m;
        })
        .catch(() => {});
  } catch (e) {
    /* no glob outside vite */
  }
  function placeInSeat(ch, v, i, role) {
    const a = seatAnchor(v, i);
    if (!a) return false;
    if (seatMod?.seatCharacter) {
      try {
        seatMod.seatCharacter(ch, a, { role, vehicle: v });
        return true;
      } catch (e) {
        console.warn('[cars] seatCharacter', e);
      }
    }
    ch.root.rotation.set(0, a.yaw, 0);
    ch.root.position.copy(a.hip).sub(HIP_IN_ROOT);
    return true;
  }

  // ------------------------------------------------------------ drivers (ped models seated in AI cars)
  let driverSeed = 500;
  function addDriver(v) {
    if (v.driver) return;
    let ch = null;
    const t = v.body.translation();
    if (game.npc?.createDriver) {
      // the user's own people (r2-people); null while none is loaded yet -> try again on a later frame
      // anchor / shell / vehicle: r2-people picks only people whose seated crown clears this car's roof (null when nobody fits)
      if ((v._driverTries = (v._driverTries || 0) + 1) > 40) return; // nobody fits / loads: stop asking every frame
      try {
        ch = game.npc.createDriver({
          pos: new THREE.Vector3(t.x, t.y, t.z),
          role: 'driver',
          seed: driverSeed++,
          anchor: v.seatAnchor?.(0),
          shell: v.car.shell,
          vehicle: v,
        });
      } catch (e) {
        ch = null;
      }
    } else {
      try {
        ch = createCharacter(game, { variant: 'ped', seed: driverSeed++ });
      } catch (e) {
        ch = null;
      }
    }
    if (!ch || !ch.root) return;
    ch.root.traverse((o) => {
      if (o.isMesh) o.castShadow = false;
    });
    v.car.shell.add(ch.root);
    ch.update?.(0.5, { driving: true, speed: 0, grounded: true });
    placeInSeat(ch, v, 0, 'driver');
    v.driver = ch.root;
    v.driverChar = ch;
    // passengers: most cars carry only the driver; ~30 % one passenger, ~8 % two (front first, then a rear seat)
    if (game.npc?.createDriver && !v.police && !v.spec.heavy) {
      const n = seatList(v).length,
        roll = Math.random(),
        k = roll < 0.08 ? 2 : roll < 0.38 ? 1 : 0;
      const seats = [1, 3, 2].filter((i) => i < n).slice(0, k);
      for (const i of seats) {
        let p = null;
        try {
          p = game.npc.createDriver({
            pos: new THREE.Vector3(t.x, t.y, t.z),
            role: 'passenger',
            seed: driverSeed++,
            anchor: v.seatAnchor?.(i),
            shell: v.car.shell,
            vehicle: v,
          });
        } catch (e) {
          p = null;
        }
        if (!p?.root) continue; // nobody fits this seat: it stays empty (no retry)
        p.root.traverse((o) => {
          if (o.isMesh) o.castShadow = false;
        });
        v.car.shell.add(p.root);
        p.update?.(0.5, { driving: true, speed: 0, grounded: true });
        placeInSeat(p, v, i, 'passenger');
        (v.passengerChars ||= []).push(p);
      }
    }
  }
  function removeDriver(v) {
    for (const p of v.passengerChars || []) {
      p.root?.parent?.remove(p.root);
      try {
        p.dispose?.();
      } catch (e) {
        /* ignore */
      }
    }
    v.passengerChars = null;
    if (!v.driver) return;
    v.driver.parent?.remove(v.driver);
    try {
      v.driverChar?.dispose?.();
    } catch (e) {
      /* ignore */
    }
    v.driver = null;
    v.driverChar = null;
  }

  // ------------------------------------------------------------ damage
  const _lp = new THREE.Vector3();
  function applyDamage(v, amount, localPoint) {
    if (v.health <= 0) return;
    v.health = Math.max(0, v.health - amount);
    const spec = v.spec;
    game.emit?.('vehicle:damage', {
      vehicle: v,
      amount,
      health: v.health,
      localPoint: localPoint || null,
      kind: 'impact',
    });
    if (localPoint) {
      // shell coordinates (ground = 0)
      const sp = {
        x: localPoint.x,
        y: localPoint.y + v.groundOff,
        z: localPoint.z,
        cy: spec.belt * 0.7,
      };
      const depth = Math.min(0.22, amount / 900);
      dentMesh(v.car.parts?.paint, sp, depth, 0.75);
      dentMesh(v.car.parts?.roof, sp, depth, 0.75);
      if (localPoint.z > spec.L / 2 - 0.7 && amount > 60 && !v.headBroken) {
        v.headBroken = true;
        const hm = v.car.lightMats.head;
        hm.color.setHex(0x2a2d30);
        hm.emissive.setHex(0x000000);
      }
      if (amount > 160 && !v.glassBroken) breakGlass(v);
      if (amount > 120) {
        v.car.wheels.forEach((w, i) => {
          const d = Math.hypot(localPoint.x - w.x, localPoint.z - w.z);
          if (d < 1.0) {
            v.wheelDmg[i] = Math.min(1, v.wheelDmg[i] + amount / 500);
            w.steer.rotation.z = (w.side > 0 ? -1 : 1) * 0.12 * v.wheelDmg[i];
          }
        });
      }
    }
    if (v.health <= 0) disableVehicle(v);
  }
  function breakGlass(v) {
    if (v.glassBroken) return;
    v.glassBroken = true;
    for (const g of v.car.slots?.glass || []) g.material = brokenGlassMat();
    const t = v.body.translation();
    shards.burst({ x: t.x, y: t.y + 0.5, z: t.z }, null, 50, Math.max(0, t.y - v.groundOff));
    game.audio?.play?.('glass', { position: new THREE.Vector3(t.x, t.y, t.z), volume: 0.8 });
  }
  function disableVehicle(v) {
    v.disabled = true;
    const t = v.body.translation();
    const pos = new THREE.Vector3(t.x, t.y + 0.5, t.z);
    game.fx?.sparks?.(pos, UP);
    game.fx?.smoke?.(pos);
    game.audio?.play?.('car_crash', { position: pos, volume: 1 });
    game.emit?.('crash', { vehicle: v, impulse: v.spec.mass * 12, point: pos });
    game.emit?.('vehicle:destroyed', { vehicle: v, position: pos.clone(), cause: 'damage' });
    // charred paint
    const burnt = (v.burntMat = v.car.paint.clone());
    burnt.color.setHex(0x16120f);
    burnt.metalness = 0.2;
    burnt.roughness = 0.8;
    burnt.clearcoat = 0.1;
    for (const mm of [...(v.car.slots?.paint || []), ...(v.car.slots?.roof || [])])
      mm.material = burnt;
    breakGlass(v);
    v.body.applyImpulse({ x: 0, y: v.spec.mass * 5, z: 0 }, true);
    v.body.applyTorqueImpulse(
      {
        x: (Math.random() - 0.5) * v.spec.mass * 2,
        y: 0,
        z: (Math.random() - 0.5) * v.spec.mass * 2,
      },
      true,
    );
    if (v.ai) v.ai = null;
    removeDriver(v);
  }

  function placeVehicle(v, pos, heading) {
    if (v.ghost) {
      v.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
      v.ghost = false;
      if (!v.vc) v.vc = makeController(v.body, v.car.wheels, v.spec, v.restLen, v.stiff);
    }
    const q = new THREE.Quaternion().setFromAxisAngle(UP, heading);
    v.body.setTranslation({ x: pos.x, y: (pos.y || 0) + v.groundOff + 0.08, z: pos.z }, true);
    v.body.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true);
    v.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    v.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    v.steerCur = 0;
    v.bodySway = null;
    if (v.frozen) thaw(v);
    else if (v.vc) {
      // teleported: drop wheel ground caches by rebuilding the controller
      try {
        world.removeVehicleController(v.vc);
      } catch (e) {
        /* ignore */
      }
      v.vc = makeController(v.body, v.car.wheels, v.spec, v.restLen, v.stiff);
    }
  }
  function flipReset(v) {
    const t = v.body.translation();
    placeVehicle(v, { x: t.x, y: Math.max(0, t.y - v.groundOff) + 0.6, z: t.z }, v.heading);
  }

  // ------------------------------------------------------------ physics per tick
  const hotwire = createHotwire(game); // stolen-car minigame (idle: no per-frame cost)
  try {
    if (game.renderer?.domElement && !game.radioUI) game.radioUI = createRadioUI(game);
  } catch (e) {
    console.warn('[vehicles] radio ui', e);
  } // station bar (key-driven, no per-frame cost)
  const QF = RAPIER.QueryFilterFlags;
  const wheelFilter = QF.EXCLUDE_SENSORS | QF.EXCLUDE_KINEMATIC;
  const _up = new THREE.Vector3(),
    _fw = new THREE.Vector3();

  // engine torque shape over the rev range (0..1 of maxRpm)
  function torqueCurve(v) {
    const m = v.model,
      n = clamp(v.rpm / m.maxRpm, 0, 1);
    return m.engine === 'diesel'
      ? 1.15 - 0.45 * n
      : m.engine === 'electric'
        ? 1.8 - 0.85 * n
        : 0.82 + 0.38 * Math.sin(Math.PI * Math.min(1, n * 1.05));
  }
  // automatic gearbox: drives v.rpm / v.gear / v.throttle / v.load for audio and torque
  function gearbox(v, speed, c, engine, brake, dt) {
    const m = v.model,
      G = m.gears,
      r = v.spec.r;
    const thr = v.disabled || !v.engineOn ? 0 : Math.abs(c.throttle || 0) * (brake > 0.3 ? 0 : 1);
    if (v.shiftT > 0) v.shiftT -= dt;
    let gear = v.gear;
    if (v.reversing || (speed < -0.5 && c.throttle < 0)) gear = -1;
    else if (gear < 1) gear = 1;
    const wheelRpm = ((Math.abs(speed) / r) * 60) / (2 * Math.PI);
    const ratio = gear === -1 ? G[0] * 1.1 : G[gear - 1];
    let rpm = wheelRpm * ratio * m.final;
    if (gear > 0 && v.shiftT <= 0) {
      if (
        rpm > m.maxRpm * (0.42 + 0.5 * thr * thr * thr) &&
        gear < G.length &&
        (thr > 0.05 || rpm > m.maxRpm * 0.6)
      ) {
        gear++;
        v.shiftT = v.spec.shift ?? 0.22;
      } // spec.shift: dual-clutch exotics change gear in well under 0.1 s
      else if (
        (rpm < m.maxRpm * 0.28 || (thr > 0.95 && rpm < m.maxRpm * 0.5 && gear > 2)) &&
        gear > 1
      ) {
        gear--;
        v.shiftT = Math.min(0.15, v.spec.shift ?? 0.15);
      }
      rpm = wheelRpm * G[gear - 1] * m.final;
    }
    // clutch slip / burnout at low speed
    const slipRpm =
      m.idleRpm + thr * m.maxRpm * (v.spec.drive === 'rwd' && Math.abs(speed) < 6 ? 0.75 : 0.45);
    if (Math.abs(speed) < 7 && gear >= 1)
      rpm = Math.max(rpm, slipRpm * (1 - Math.abs(speed) / 9) + rpm * 0.3);
    rpm = clamp(Math.max(rpm, m.idleRpm), m.idleRpm, m.maxRpm);
    if (m.engine === 'electric') rpm = Math.max(0, wheelRpm * G[0] * m.final);
    if (v.disabled || !v.engineOn) rpm = 0;
    v.gear = gear;
    v.rpm += (rpm - v.rpm) * Math.min(1, dt * (v.shiftT > 0 ? 18 : 10));
    v.throttle = thr;
    v.load = clamp(
      thr * (v.shiftT > 0 ? 0.25 : 1) * (0.5 + 0.5 * clamp(Math.abs(engine) / v.spec.engine, 0, 1)),
      0,
      1,
    );
  }

  // ---- water: stall, float briefly nose-up, sink with heavy drag, no traction; flooded cars stay dead
  const SEA = city?.seaLevel ?? -0.12;
  const _wp = { x: 0, y: 0, z: 0 },
    _wi = { x: 0, y: 0, z: 0 };
  function waterTick(v, dt) {
    if (game.carWater) {
      try {
        if (game.carWater(v, dt)) return;
      } catch (e) {
        console.warn('[r2-water] car water', e);
        game.carWater = null;
      }
    } // r2-water ?carwater=2
    const body = v.body,
      t = body.translation();
    const below = t.y < SEA + 0.3 && (city?.isWater ? city.isWater(t.x, t.z) : t.y < SEA);
    const roofY = t.y - v.groundOff + v.spec.roofY;
    v.submerged = v.inWater ? clamp((SEA - roofY) / 0.3, 0, 1) : 0;
    if (!below) return;
    if (!v.inWater) {
      v.inWater = true;
      v.flooded = true;
      v.floodT = 0;
      const lv = body.linvel(),
        sp = Math.hypot(lv.x, lv.y, lv.z);
      game.fx?.splash?.(new THREE.Vector3(t.x, SEA, t.z), clamp(sp / 15, 0.3, 3));
      game.audio?.play?.('splash', {
        position: new THREE.Vector3(t.x, SEA, t.z),
        volume: clamp(sp / 20, 0.3, 1),
      });
      if (v.engineOn) {
        v.engineOn = false;
        game.emit?.('engineStop', { vehicle: v });
      }
      body.setLinearDamping(2.5);
      body.setAngularDamping(2);
      if (v.ai) v.ai = null;
    }
    v.floodT += dt;
    // buoyancy: starts above weight, decays over ~4 s; applied ahead of the centre -> floats nose-up
    const buoy = v.spec.mass * 9.81 * 1.25 * Math.exp(-v.floodT / 1.6) * dt;
    if (buoy > 1) {
      const r = body.rotation();
      _q.set(r.x, r.y, r.z, r.w);
      _v.set(0, 0, v.spec.L * 0.22).applyQuaternion(_q);
      _wp.x = t.x + _v.x;
      _wp.y = t.y;
      _wp.z = t.z + _v.z;
      _wi.y = buoy;
      body.applyImpulseAtPoint(_wi, _wp, true);
    }
    v.engineOn = false;
  }
  const PARK_CTRL = { throttle: 0, steer: 0, brake: 1, handbrake: true };
  const DEAD_CTRL = { throttle: 0, steer: 0, brake: 0.5, handbrake: true };
  function physicsTick(v, dt) {
    // a chassis removed behind our back (another module) must never reach updateVehicle -> wasm panic
    if (v.body.isValid && !v.body.isValid()) {
      dropVehicle(v);
      return;
    }
    if (v.frozen && v.playerDriven && !v.ghost) thaw(v, true); // the player's car is never left frozen, not even for a manager tick
    if (v.frozen || !v.vc) {
      v.speed = 0;
      return;
    }
    // never drive onto ground whose colliders are not streamed in (would fall through the world)
    if (!v.playerDriven && city?.collidersReadyAt && (v.edgeT = (v.edgeT || 0) - dt) <= 0) {
      v.edgeT = 0.2;
      const t0 = v.body.translation(),
        lv = v.body.linvel();
      const ax = t0.x + clamp(lv.x * 0.6, -12, 12),
        az = t0.z + clamp(lv.z * 0.6, -12, 12);
      if (!city.collidersReadyAt(t0.x, t0.z) || !city.collidersReadyAt(ax, az)) {
        freeze(v);
        v.speed = 0;
        return;
      }
    }
    const body = v.body;
    // AI traffic does not roll over on its own: past ~30 deg of lean the roll / pitch rate is damped and a righting torque
    // brings the car back onto its wheels (crashes involving the player still knock cars about: disabled / chased cars excluded)
    if (v.ai && !v.playerDriven && !v.chaseTarget && !v.disabled && !v.ghost) {
      const r0 = body.rotation();
      _q.set(r0.x, r0.y, r0.z, r0.w);
      _v2.set(0, 1, 0).applyQuaternion(_q);
      if (_v2.y < 0.86 && (v.hitCd || 0) <= 0) {
        const av = body.angvel(),
          m = v.spec.mass,
          k = (0.86 - _v2.y) * 6;
        body.setAngvel({ x: av.x * 0.92, y: av.y, z: av.z * 0.92 }, true);
        body.applyTorqueImpulse({ x: -_v2.z * m * k * dt, y: 0, z: _v2.x * m * k * dt }, true);
        v.rightedT = (v.rightedT || 0) + dt;
      }
    }
    // r2-physics trip guard (QA: hatch2 rolled onto its side after a 30 deg curb hit at ~25 km/h): a curb strike kicks a roll rate
    // that a real car's tires and anti-roll bars soak up. Below 80 km/h, between 8 and 50 deg of lean, a roll rate above 1.1 rad/s
    // is cut back to 0.95 rad/s each tick (light, tall cars trip first); a real roll-over (high speed, big lean,
    // a crash) is left alone
    if (!v.ghost && !v.disabled && game.physics?.tripGuard !== false) {
      const r1 = body.rotation();
      _q.set(r1.x, r1.y, r1.z, r1.w);
      _v2.set(0, 1, 0).applyQuaternion(_q);
      _fw.set(0, 0, 1).applyQuaternion(_q);
      const lean = Math.acos(Math.max(-1, Math.min(1, _v2.y))),
        lv1 = body.linvel(),
        sp1 = Math.hypot(lv1.x, lv1.z);
      if (lean > 0.14 && lean < 0.87 && sp1 < 22) {
        const av = body.angvel(),
          rr = av.x * _fw.x + av.y * _fw.y + av.z * _fw.z; // roll rate about the car's forward axis
        if (Math.abs(rr) > 1.1) {
          const k = (Math.abs(rr) - 0.95) / Math.abs(rr);
          body.setAngvel(
            { x: av.x - _fw.x * rr * k, y: av.y - _fw.y * rr * k, z: av.z - _fw.z * rr * k },
            true,
          );
          v.tripGuards = (v.tripGuards || 0) + 1;
        }
      }
    }
    const tt = body.translation();
    if (!Number.isFinite(tt.x) || !Number.isFinite(tt.y) || tt.y < -30) {
      // fell out of the world / NaN: never teleport onto the player; freeze at the last good spot or drop it
      if (v.playerDriven && v.lastGood) {
        placeVehicle(v, { x: v.lastGood.x, y: v.lastGoodY ?? 0, z: v.lastGood.z }, v.heading || 0);
        return;
      }
      if (v.lastGood && groundReady(v.lastGood.x, v.lastGoodY ?? 0, v.lastGood.z))
        placeVehicle(v, { x: v.lastGood.x, y: v.lastGoodY ?? 0, z: v.lastGood.z }, 0);
      else if (v.external) freeze(v);
      else removeVehicle(v);
      return;
    }
    if ((v.goodT = (v.goodT || 0) + dt) > 1) {
      v.goodT = 0;
      if (v.vc && v.vc.wheelIsInContact(0)) {
        (v.lastGood ||= new THREE.Vector3()).set(tt.x, 0, tt.z);
        v.lastGoodY = tt.y - v.groundOff;
      }
    }
    // enter/exit transition guard: kill absurd velocity spikes (player capsule overlap etc.)
    if (v.playerDriven !== v.prevPD) {
      v.prevPD = v.playerDriven;
      v.guardT = 0.8;
      if (v.playerDriven) {
        const start = () => {
          if (!v.engineOn && !v.disabled && !v.flooded) {
            v.engineOn = true;
            v.rpm = v.model.idleRpm * 1.8;
            game.emit?.('engineStart', { vehicle: v });
          }
        };
        // a broken-into car has to be hotwired first (src/vehicles/ui/hotwire.js); owned, unlocked and running cars start as before
        if (
          v.needsHotwire &&
          !v.engineOn &&
          hotwire.start(v, (ok) => {
            if (ok) {
              v.needsHotwire = false;
              if (v.playerDriven) start();
            }
          })
        ) {
          /* wiring */
        } else start();
        v.engineOffT = 0;
      } else {
        v.shiftT = 0;
        v.engineOffT = 4;
      }
    }
    if (v.engineOffT > 0 && !v.playerDriven) {
      v.engineOffT -= dt;
      if (v.engineOffT <= 0 && !v.ai) {
        v.engineOn = false;
        game.emit?.('engineStop', { vehicle: v });
      }
    }
    if (v.guardT > 0 || (!v.playerDriven && !v.ai && !v.disabled)) {
      if (v.guardT > 0) v.guardT -= dt;
      const lv = body.linvel(),
        av = body.angvel();
      const maxUp = v.guardT > 0 ? 2.5 : 6;
      if (lv.y > maxUp || Math.abs(av.x) > 2 || Math.abs(av.z) > 2) {
        body.setLinvel({ x: lv.x, y: Math.min(lv.y, maxUp), z: lv.z }, true);
        body.setAngvel({ x: clamp(av.x, -1.5, 1.5), y: av.y, z: clamp(av.z, -1.5, 1.5) }, true);
        v.spikeCount = (v.spikeCount || 0) + 1;
      }
    }
    if (!v.playerDriven && (!v.ai || v.disabled) && body.isSleeping()) {
      v.speed = 0;
      v.rpm = 0;
      v.throttle = 0;
      v.load = 0;
      return;
    }
    if (v.playerDriven && body.isSleeping()) body.wakeUp();
    const spec = v.spec;
    if (v.ai && !v.playerDriven) aiDrive(v, dt);
    waterTick(v, dt);
    // read the controller only now: aiDrive / respawn / ghost mode may have freed or replaced it this tick
    // (playtest: "current_vehicle_speed" read from a freed Rapier controller)
    const vc = v.vc;
    if (!vc || !v.body || !world.getRigidBody?.(v.body.handle)) {
      v.speed = v.ghostSpeed ?? 0;
      return;
    }
    const c = v.disabled || v.flooded ? DEAD_CTRL : v.playerDriven || v.ai ? v.ctrl : PARK_CTRL;
    let speed = 0;
    try {
      speed = vc.currentVehicleSpeed();
    } catch (e) {
      v.vc = null;
      v.speed = 0;
      return;
    }
    const aspd = Math.abs(speed);
    // CCD only when it matters (fast or player-driven) - it is costly with a dense city
    const lv0 = body.linvel();
    let wantCcd = v.playerDriven;
    if (!wantCcd && playerCarRef) {
      const pt = playerCarRef.body.translation();
      wantCcd = distXZ(pt, body.translation()) < 40;
    }
    if (wantCcd !== v.ccd) {
      body.enableCcd(wantCcd);
      v.ccd = wantCcd;
    }

    // steering (speed sensitive, smoothed)
    const maxSteer = spec.steer * lerp(1, 0.24, clamp(aspd / 42, 0, 1));
    const target = c.steer * maxSteer;
    const rate =
      (Math.sign(target - v.steerCur) !== Math.sign(v.steerCur) ? 5.0 : 2.8) *
      spec.steer *
      lerp(1, 0.5, clamp(aspd / 40, 0, 1));
    v.steerCur += clamp(target - v.steerCur, -rate * dt, rate * dt);

    // longitudinal
    let engine = 0,
      brake = 0;
    v.reversing = false;
    if (c.brake > 0.05 && !(c.throttle < 0 && speed < 1)) {
      brake = c.brake;
    } else if (c.throttle > 0.02) {
      if (speed < -1) brake = 1;
      else
        engine =
          c.throttle *
          spec.engine *
          Math.max(0, 1 - Math.pow(Math.max(0, speed) / spec.vmax, 2.2)) *
          (speed < 6 ? 1.15 : 1) *
          torqueCurve(v);
    } else if (c.throttle < -0.02) {
      if (speed > 1) brake = 1;
      else {
        engine = c.throttle * spec.engine * 0.55 * (speed > -8.5 ? 1 : 0);
        v.reversing = true;
      }
    } else {
      brake = 0.06; // engine braking / rolling resistance
    }
    v.braking = brake > 0.3;
    if (!v.engineOn) engine = 0;
    gearbox(v, speed, c, engine, brake, dt);
    if (v.shiftT > 0) engine *= 0.2;
    // soft ground (beach sand, dunes, mud, dirt, grass): the tires dig in a little, the car rolls heavier, grips and steers less
    if ((v.softT = (v.softT ?? 0) - dt) <= 0) {
      v.softT = 0.25 + Math.random() * 0.05;
      const tp = body.translation();
      v.softTarget = softAt(tp.x, tp.z, tp.y - v.groundOff);
    }
    v.soft = (v.soft ?? 0) + ((v.softTarget || 0) - (v.soft ?? 0)) * Math.min(1, dt * 3);
    const soft = v.inWater ? 0 : v.soft;
    if (soft > 0.01) engine *= 1 - 0.2 * soft;
    const brakeImpulse = brake * spec.mass * 2.1 * (spec.brakeK ?? 1) * dt; // per wheel (r2-physics: ~8.4 m/s2 full braking on dry asphalt, was 10.4)
    const drive = spec.drive;
    const nDrive = drive === 'awd' ? 4 : 2;
    for (let i = 0; i < 4; i++) {
      const front = i < 2;
      vc.setWheelSteering(
        i,
        fin(
          (front ? v.steerCur : 0) + (v.wheelDmg[i] ? 0.035 * v.wheelDmg[i] * (i % 2 ? -1 : 1) : 0),
          0,
          1,
        ),
      );
      const driven = drive === 'awd' || (drive === 'fwd' ? front : !front);
      vc.setWheelEngineForce(i, fin(driven ? engine / nDrive : 0, 0, spec.engine * 2));
      let b = brakeImpulse * (front ? 1.15 : 0.85);
      let slip = spec.grip * (front ? 1 : spec.rearGrip || 1) * (1 - 0.45 * (v.wheelDmg[i] || 0)),
        side = 1.0;
      if (!front && spec.powerSlide && engine > 0 && v.shiftT <= 0) {
        const k =
          spec.powerSlide * clamp(c.throttle, 0, 1) * clamp(Math.abs(c.steer) * 1.5 + 0.3, 0, 1);
        side = 1 - k;
        slip *= 1 - 0.9 * k;
      }
      if (c.handbrake && !front) {
        b = Math.max(b, spec.mass * 0.9 * dt);
        slip = spec.grip * 0.45;
        side = 0.75;
      }
      if (soft > 0.01) {
        slip *= 1 - 0.3 * soft;
        side *= 1 - 0.22 * soft;
      }
      if (WEATHER_U[0] > 0.02) {
        const wk = 1 - 0.3 * Math.min(1, WEATHER_U[0]);
        slip *= wk;
        side *= 0.5 + 0.5 * wk;
      } // r2-physics: wet roads ~0.7 grip
      vc.setWheelBrake(i, fin(b, 0, spec.mass * 10));
      vc.setWheelFrictionSlip(i, fin(v.inWater ? 0.03 : slip, spec.grip, 10));
      vc.setWheelSideFrictionStiffness(i, fin(side, 1, 2));
    }
    // sanity: never hand Rapier a body that left the world or holds NaN state
    {
      const lv = body.linvel(),
        av = body.angvel();
      if (
        ![lv.x, lv.y, lv.z, av.x, av.y, av.z].every(Number.isFinite) ||
        Math.hypot(lv.x, lv.y, lv.z) > 160
      ) {
        body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      }
    }
    if (!(body.mass() > 0)) {
      try {
        body.recomputeMassPropertiesFromColliders();
      } catch (e) {
        /* ignore */
      }
      if (!(body.mass() > 0)) return;
    }
    const pl = body.linvel(),
      pa = body.angvel();
    vc.updateVehicle(dt, wheelFilter);
    if (soft > 0.01) {
      // rolling resistance of tires plowing sand: ~1.2 m/s2 at walking pace, ~2 m/s2 at 70 km/h
      let gr = 0;
      for (let i = 0; i < 4; i++) if (vc.wheelIsInContact(i)) gr++;
      const lv = body.linvel(),
        vh = Math.hypot(lv.x, lv.z);
      if (gr >= 2 && vh > 0.05) {
        const k = Math.max(0, 1 - (soft * (1.1 + 0.045 * vh) * dt) / vh);
        body.setLinvel({ x: lv.x * k, y: lv.y, z: lv.z * k }, true);
      }
    }
    // anti-roll bars: per axle, the side that compresses more is pushed up and the other pulled down (the ray-cast
    // controller has none: without them tall cars lean far, unload the inner wheels and trip over in corners)
    if (spec.antiRoll && !vc.ownsAntiRoll) {
      // (carphys 2 has its own anti-roll bars inside the suspension)
      const R = body.rotation();
      _q.set(R.x, R.y, R.z, R.w);
      _up.set(0, 1, 0).applyQuaternion(_q);
      const T0 = body.translation();
      for (const [a, b] of [
        [0, 1],
        [2, 3],
      ]) {
        if (!vc.wheelIsInContact(a) && !vc.wheelIsInContact(b)) continue;
        const la = vc.wheelSuspensionLength(a) ?? v.restLen,
          lb = vc.wheelSuspensionLength(b) ?? v.restLen;
        const d = clamp(lb - la, -0.25, 0.25); // > 0: wheel a compressed more
        if (Math.abs(d) < 1e-4) continue;
        const J = spec.antiRoll * spec.mass * 9.81 * d * dt * (a === 0 ? 1.1 : 0.9);
        for (const [i, sg] of [
          [a, 1],
          [b, -1],
        ]) {
          const w = v.car.wheels[i];
          _fw.set(w.x, 0, w.z).applyQuaternion(_q);
          body.applyImpulseAtPoint(
            { x: _up.x * J * sg, y: _up.y * J * sg, z: _up.z * J * sg },
            { x: T0.x + _fw.x, y: T0.y + _fw.y, z: T0.z + _fw.z },
            true,
          );
        }
      }
    }
    {
      // a degenerate ground triangle can make the ray-cast suspension produce NaN: undo and rebuild the controller
      const nl = body.linvel(),
        na = body.angvel();
      if (![nl.x, nl.y, nl.z, na.x, na.y, na.z].every(Number.isFinite)) {
        body.setLinvel(Number.isFinite(pl.x + pl.y + pl.z) ? pl : { x: 0, y: 0, z: 0 }, true);
        body.setAngvel(Number.isFinite(pa.x + pa.y + pa.z) ? pa : { x: 0, y: 0, z: 0 }, true);
        try {
          world.removeVehicleController(vc);
        } catch (e) {
          /* ignore */
        }
        v.vc = makeController(body, v.car.wheels, v.spec, v.restLen, v.stiff);
        v.nanFixes = (v.nanFixes || 0) + 1;
        {
          const now = performance.now();
          if (!(now - (v.nanWarnT || -1e9) < 10000)) {
            v.nanWarnT = now;
            const tp = body.translation();
            console.warn(
              `[vehicles] NaN from wheel ray-cast (x${v.nanFixes}) at ${tp.x.toFixed(1)},${tp.y.toFixed(1)},${tp.z.toFixed(1)} ${v.name}`,
            );
          }
        }
        v.speed = 0;
        return;
      }
    }

    // downforce + upright assist
    const r = body.rotation();
    _q.set(r.x, r.y, r.z, r.w);
    _up.set(0, 1, 0).applyQuaternion(_q);
    let grounded = 0;
    for (let i = 0; i < 4; i++) if (vc.wheelIsInContact(i)) grounded++;
    if (grounded >= 2) {
      const df = spec.mass * 9.81 * 0.35 * (spec.downforce || 1) * Math.min(4, (aspd / 30) ** 2);
      body.applyImpulse({ x: -_up.x * df * dt, y: -_up.y * df * dt, z: -_up.z * df * dt }, true);
    }
    if (_up.y < 0.64) {
      _v.copy(_up).cross(UP);
      const len = _v.length();
      if (len > 1e-4) {
        _v.multiplyScalar((1 / len) * spec.mass * 7 * (1 - _up.y) * dt);
        body.applyTorqueImpulse({ x: _v.x, y: _v.y, z: _v.z }, true);
      }
      if (_up.y < 0.3 && aspd < 3) v.flipT += dt;
      else v.flipT = Math.max(0, v.flipT - dt);
      if (v.flipT > 2.5) {
        v.flipT = 0;
        flipReset(v);
      }
    } else v.flipT = 0;
    // airborne: mild pitch/roll stabilization so jumps land wheels-down
    if (grounded === 0) {
      const av = body.angvel();
      body.setAngvel({ x: av.x * 0.985, y: av.y, z: av.z * 0.985 }, true);
    }
    // yaw-rate cap keeps spins catchable
    {
      const av = body.angvel();
      const cap = 2.2;
      if (Math.abs(av.y) > cap)
        body.setAngvel({ x: av.x, y: av.y - (av.y - Math.sign(av.y) * cap) * 0.15, z: av.z }, true);
    }
    v.speed = speed;
    // stage 1 perf: a parked car standing still on all four wheels is put to sleep. The ray-cast suspension nudged it
    // every step, so Rapier never slept it and every parked car near the player cost a full controller update (four
    // wheel ray casts + suspension and friction) per sub-step. Asleep it does not move at all (it was at rest anyway); any contact, impulse, bullet
    // or the player getting in wakes it and the controller runs again from the next step. game.vehicles.parkSleep = false
    // turns this off.
    // (the suspension leaves a ~0.06 m/s jitter on the velocity of a car at rest, so "still" is judged by how far it
    // actually moved over the 1.5 s window: under 3 cm)
    if (
      !v.playerDriven &&
      (!v.ai || v.disabled) &&
      !v.inWater &&
      grounded === 4 &&
      aspd < 0.2 &&
      game.vehicles?.parkSleep !== false
    ) {
      const lv = body.linvel(),
        av = body.angvel(),
        tp = body.translation();
      if (
        lv.x * lv.x + lv.y * lv.y + lv.z * lv.z < 0.04 &&
        av.x * av.x + av.y * av.y + av.z * av.z < 0.04
      ) {
        if (!v.restP || !(v.restT > 0)) {
          (v.restP ||= new THREE.Vector3()).set(tp.x, tp.y, tp.z);
          v.restT = 0;
        }
        v.restT += dt;
        if (v.restT > 1.5) {
          const moved = Math.hypot(tp.x - v.restP.x, tp.y - v.restP.y, tp.z - v.restP.z);
          v.restT = 0;
          if (moved < 0.03) {
            body.setLinvel({ x: 0, y: 0, z: 0 }, false);
            body.setAngvel({ x: 0, y: 0, z: 0 }, false);
            body.sleep();
          }
        }
      } else v.restT = 0;
    } else v.restT = 0;
  }

  // ------------------------------------------------------------ AI
  const ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 });
  const _p = new THREE.Vector3(),
    _f = new THREE.Vector3(),
    _rt = new THREE.Vector3(),
    _tgt = new THREE.Vector3();

  function aiAssign(v, info) {
    const ai = v.ai;
    ai.edge = info.edge;
    ai.dir = info.dir;
    ai.d = info.d ?? 0;
    ai.lane = Math.min(info.lane ?? 0, driveLaneMax(info.edge, info.dir));
    ai.next = null;
    ai.stuckT = 0;
    ai.waitT = 0;
  }
  function laneOfV(v) {
    return laneOffset(v.ai.edge, v.ai.dir, v.ai.lane);
  }
  function snapAI(v, t) {
    let best = null,
      bd = 1e9;
    for (const e of net.near(t.x, t.z, 40)) {
      const pr = project(e, t.x, t.z);
      if (pr.dist < bd) {
        bd = pr.dist;
        best = { e, pr };
      }
    }
    if (!best || bd > 25) return false;
    const e = best.e,
      sd = {};
    sampleEdge(e, best.pr.s, sd);
    let dir = sd.dx * _f.x + sd.dz * _f.z >= 0 ? 1 : -1;
    if (laneCount(e, dir) <= 0) dir = -dir;
    const n = laneCount(e, dir);
    aiAssign(v, {
      edge: e,
      dir,
      d: dir > 0 ? best.pr.s : e.len - best.pr.s,
      lane: Math.max(0, Math.min(n - 1, Math.round(Math.abs(best.pr.lat) / e.laneW - 0.5))),
    });
    return true;
  }
  function endNodeOf(ai) {
    return ai.dir > 0 ? ai.edge.b : ai.edge.a;
  }
  function chooseNext(v) {
    const ai = v.ai,
      node = endNodeOf(ai);
    const opts = exitsAt(net, node, ai.edge);
    if (!opts.length) {
      ai.next = null;
      ai.deadEnd = true;
      return;
    }
    ai.deadEnd = false;
    const din = edgeDirAt(ai.edge, ai.dir, false);
    let tot = 0;
    for (const o of opts) {
      const dout = edgeDirAt(o.edge, o.dir, true);
      const cross = din.x * dout.z - din.z * dout.x,
        dot = din.x * dout.x + din.z * dout.z;
      o.ang = Math.atan2(cross, dot); // >0 = turning left (heading convention)
      const a = Math.abs(o.ang);
      o.w = o.edge === ai.edge ? 0.02 : a < 0.45 ? 1.0 : a < 2.4 ? 0.45 : 0.05;
      // prefer bigger roads a little
      o.w *= 0.7 + 0.15 * Math.min(4, laneCount(o.edge, o.dir));
      if (MINOR.test(o.edge.kind || '')) o.w *= 0.04;
      if (ai.drv?.wander && a > 0.45 && a < 2.4) o.w *= 1 + ai.drv.wander * 2.5; // lost / tourist: turn more, often off the main road
      tot += o.w;
    }
    let r = Math.random() * tot,
      pick = opts[0];
    for (const o of opts) {
      r -= o.w;
      if (r <= 0) {
        pick = o;
        break;
      }
    }
    const n = driveLaneMax(pick.edge, pick.dir) + 1;
    const lane = pick.ang < -0.45 ? n - 1 : pick.ang > 0.45 ? 0 : Math.min(ai.lane, n - 1);
    ai.next = { edge: pick.edge, dir: pick.dir, lane, ang: pick.ang };
  }
  const _lp1 = {},
    _lp2 = {};
  // lane point at distance `ahead` beyond the car's current position along its route
  function routePoint(ai, ahead, out) {
    const rem = ai.edge.len - ai.d;
    if (ahead <= rem || !ai.next)
      return lanePointAt(
        ai.edge,
        ai.dir,
        Math.min(ai.edge.len, ai.d + ahead),
        laneOffset(ai.edge, ai.dir, ai.lane),
        out,
      );
    const n = ai.next;
    return lanePointAt(
      n.edge,
      n.dir,
      Math.min(n.edge.len, ahead - rem),
      laneOffset(n.edge, n.dir, n.lane),
      out,
    );
  }

  function aiDrive(v, dt) {
    const ai = v.ai,
      body = v.body;
    const t = body.translation();
    _p.set(t.x, t.y, t.z);
    const r = body.rotation();
    _q.set(r.x, r.y, r.z, r.w);
    _f.set(0, 0, 1).applyQuaternion(_q);
    _f.y = 0;
    _f.normalize();
    const left = _v2.set(_f.z, 0, -_f.x); // left of forward (heading 0 -> +X)
    if (v.chaseTarget) {
      chaseDrive(v, dt, t, left);
      return;
    }
    if (ai.fleeT > 0) ai.fleeT -= dt;
    const fleeing = ai.fleeT > 0;
    const P = (ai.drv ||= rollDriver(driverSeq++, {
      zone: zoneAt(_p),
      fleet: !!(v.police || v.spec.taxi || v.spec.heavy || v.spec.busLivery),
    }));
    const S = driverStats.get(P.type);
    S.seen.add(v.id);
    if (!ai.edge && !snapAI(v, t)) {
      v.ctrl.throttle = 0;
      v.ctrl.brake = 1;
      ai.stuckT += dt;
      return;
    }
    // progress along the current edge
    const pr = project(ai.edge, t.x, t.z, ai.dir > 0 ? ai.d : ai.edge.len - ai.d);
    ai.d = ai.dir > 0 ? pr.s : ai.edge.len - pr.s;
    if (pr.dist > 14) {
      ai.edge = null;
      return;
    }
    if (!ai.next && !ai.deadEnd) chooseNext(v);
    if (ai.d > ai.edge.len - 0.8 && ai.next) {
      const n = ai.next;
      const p2 = project(n.edge, t.x, t.z);
      ai.edge = n.edge;
      ai.dir = n.dir;
      ai.lane = n.lane;
      ai.d = n.dir > 0 ? p2.s : n.edge.len - p2.s;
      ai.next = null;
      ai.waitT = 0;
      chooseNext(v);
    } else if (ai.d > ai.edge.len - 0.8 && ai.deadEnd) {
      if (!spawnVisible(_p)) {
        respawnAI(v);
        return;
      }
      ai.dir = -ai.dir;
      ai.d = ai.edge.len - ai.d;
      ai.deadEnd = false;
      chooseNext(v); // U-turn
    }
    const spd = Math.max(0, v.speed);
    // pure pursuit along the route
    const Ld = Math.max(6, spd * 0.9);
    routePoint(ai, Ld, _lp1);
    _tgt.set(_lp1.x - t.x, 0, _lp1.z - t.z);
    const lx = _tgt.dot(left),
      lz = _tgt.dot(_f);
    const wb = v.spec.wb;
    let steerAng = Math.atan2(2 * wb * lx, Math.max(1, lx * lx + lz * lz));
    if (lz < 0) steerAng = Math.sign(lx || 1) * v.spec.steer;
    const maxSteer = v.spec.steer * lerp(1, 0.24, clamp(spd / 42, 0, 1));
    v.ctrl.steer = clamp(steerAng / maxSteer, -1, 1);

    // target speed: speed limit, curves, junction turns
    // personality: wandering (lost / tourist slow down to read signs), phone glances (distracted)
    if (P.wander) {
      ai.wanderT -= dt;
      if (ai.wanderT <= 0) {
        const slow = Math.random() < P.wander * 0.35;
        ai.wanderK = slow ? 0.45 + Math.random() * 0.25 : 1;
        ai.wanderT = slow ? 3 + Math.random() * 4 : 6 + Math.random() * 10;
      }
    }
    if (P.phone) {
      if (ai.phoneT > 0) ai.phoneT -= dt;
      else if (Math.random() < P.phone * 0.12 * dt) ai.phoneT = 0.8 + Math.random() * 1.6;
    }
    const limitMs = (ai.edge.speedKmh || 40) / 3.6;
    const limit = Math.min(
      v.spec.vmax * 0.85,
      limitMs * P.speed * ai.wanderK * (0.97 + ((v.id * 37) % 7) / 100),
    );
    let desired = fleeing ? Math.min(v.spec.vmax * 0.8, limit * 1.6 + 6) : limit;
    const distToNode = ai.edge.len - ai.d;
    if (ai.next && distToNode < 40) {
      const a = Math.abs(ai.next.ang);
      const vTurn = a > 2.4 ? 3 : a > 1.1 ? 5 : a > 0.6 ? 8 : a > 0.3 ? 12 : desired;
      desired = Math.min(desired, lerp(vTurn, desired, clamp((distToNode - 6) / 30, 0, 1)));
    }
    // curvature ahead on the polyline (roundabouts, ramps, bends)
    routePoint(ai, Math.min(30, 8 + spd * 1.2), _lp2);
    const curve = Math.abs(
      Math.atan2(_lp1.fx * _lp2.fz - _lp1.fz * _lp2.fx, _lp1.fx * _lp2.fx + _lp1.fz * _lp2.fz),
    );
    if (curve > 0.25) desired = Math.min(desired, Math.max(5, 17 - curve * 12));
    if (Math.abs(steerAng) > 0.25) desired = Math.min(desired, 7);

    // obstacles: other vehicles + player
    let block = 99,
      leadSpd = 99,
      stopBlock = 99;
    for (const o of list) {
      if (o === v) continue;
      const ot = o.body.translation();
      const dx = ot.x - t.x,
        dz = ot.z - t.z;
      if (dx * dx + dz * dz > 900 || Math.abs(ot.y - t.y) > 4) continue;
      const a = dx * _f.x + dz * _f.z,
        lat = Math.abs(dx * left.x + dz * left.z);
      if (a > 0 && a < 40 && lat < 1.9 + Math.min(0.6, Math.abs(steerAng))) {
        const g = a - (o.spec.L + v.spec.L) / 2;
        if (g < block) {
          block = g;
          leadSpd = o.speed;
        }
      }
    }
    let byPlayer = false;
    for (const o of list) {
      if (!o.playerDriven || o === v) continue;
      const ot = o.body.translation();
      const dx = ot.x - t.x,
        dz = ot.z - t.z;
      const a = dx * _f.x + dz * _f.z,
        lat = Math.abs(dx * left.x + dz * left.z);
      if (a > 0 && a < 12 && lat < 2.2) byPlayer = true;
    }
    const pp = game.player?.position;
    if (pp && !game.player?.state?.inVehicle) {
      const dx = pp.x - t.x,
        dz = pp.z - t.z;
      const a = dx * _f.x + dz * _f.z,
        lat = Math.abs(dx * left.x + dz * left.z);
      if (a > 0 && a < 16 && lat < 2.0) {
        block = Math.min(block, a - v.spec.L / 2);
        byPlayer = true;
      }
    }
    const peds = game.peds?.list;
    if (peds) {
      for (const ped of peds) {
        if (!ped || ped.dead) continue;
        const q2 = ped.pos || ped.root?.position;
        if (!q2) continue;
        const dx = q2.x - t.x,
          dz = q2.z - t.z;
        if (dx * dx + dz * dz > 300) continue;
        const a = dx * _f.x + dz * _f.z,
          latS = dx * left.x + dz * left.z,
          lat = Math.abs(latS);
        if (a > 0 && a < 15 + P.pedMargin * 8 && lat < 1.8 + P.pedMargin) {
          block = Math.min(block, a - v.spec.L / 2);
          if ((ai.pedT || 0) <= 0 && spd > 2) {
            S.pedYields++;
            ai.pedT = 6;
          }
          if (a < 11 && v.speed > 4)
            v.ctrl.steer = clamp(v.ctrl.steer - Math.sign(latS || 1) * 0.45, -1, 1);
        }
      }
    }
    // signals / yielding at the junction ahead
    const node = net.nodes.get(endNodeOf(ai));
    if (ai.pedT > 0) ai.pedT -= dt;
    const ctrl = ai.dir > 0 ? ai.edge.src?.controlB : ai.edge.src?.controlA;
    if (node && ai.approachNode !== node.id) {
      ai.approachNode = node.id;
      ai.runRed = Math.random() < P.redRun;
      ai.rolls = Math.random() > P.stopFull;
      ai.redSeen = false;
      ai.redRunCounted = false;
      ai.stopSeen = false;
      ai.stopDone = 0;
    }
    if (node && (node.edges.length >= 3 || ctrl === 'stop') && distToNode < 45 && !fleeing) {
      let clear = 4;
      for (const e of node.edges) if (e !== ai.edge) clear = Math.max(clear, e.width / 2 + 1.5);
      const stopAt = distToNode - clear - v.spec.L / 2; // distance from our nose to the stop line
      const sig = signalState(net, node.id, ai.edge);
      let mustStop = false;
      if (sig === 'red') {
        if (!ai.redSeen && stopAt > 0 && stopAt < 40) {
          ai.redSeen = true;
          S.redApproach++;
        }
        mustStop = stopAt > -1.5 && !(ai.runRed && stopAt < 22 && spd > 4);
        if (!mustStop && ai.redSeen && stopAt < -1 && !ai.redRunCounted && spd > 2) {
          ai.redRunCounted = true;
          S.redRun++;
        }
      } else if (sig === 'yellow')
        mustStop = stopAt > P.amberGo || (stopAt > 6 && spd * 1.3 < stopAt && P.amberGo < 15);
      else if (!sig && ctrl === 'stop' && stopAt > -1) {
        // stop sign: full stop and a look (stopWait s), or a rolling stop for the impatient
        if (!ai.stopSeen && stopAt < 30) {
          ai.stopSeen = true;
          S.stopApproach++;
          if (ai.rolls) S.stopRolled++;
        }
        if (ai.rolls) desired = Math.min(desired, 3.2 + Math.max(0, stopAt) * 0.5);
        else {
          if (spd < 0.4 && stopAt < 3.5) ai.stopDone += dt;
          mustStop = ai.stopDone < P.stopWait;
        }
      } else if (!sig && ai.next && stopAt < 14 && stopAt > -1) {
        // uncontrolled junction: yield to anyone already moving through it
        for (const o of list) {
          if (o === v) continue;
          const ot = o.body.translation();
          const dn = Math.hypot(ot.x - node.x, ot.z - node.z);
          if (dn < clear + 3 && Math.abs(o.speed) > 1.5 && (!o.ai || o.ai.edge !== ai.edge)) {
            mustStop = true;
            break;
          }
        }
        if (Math.abs(ai.next.ang) > 0.45) desired = Math.min(desired, 6);
      }
      if (mustStop) {
        stopBlock = Math.min(stopBlock, stopAt + 2.5);
        ai.waitT += dt;
      } else ai.waitT = 0;
    }
    if (fleeing) block = Math.max(block, 99 * (block > 6 ? 1 : 0) || block);
    // ray for anything else (props, unknown obstacles)
    const fr = v.spec.L / 2 + 0.2;
    ray.origin = { x: t.x + _f.x * fr, y: t.y + 0.15, z: t.z + _f.z * fr };
    ray.dir = { x: _f.x, y: 0, z: _f.z };
    if ((tickN + v.id) % 3 === 0) {
      // only keep plain numbers between ticks (a stored hit would reference a collider that may be gone)
      const hit = world.castRay(ray, 12, true, QF.EXCLUDE_SENSORS, undefined, undefined, body);
      if (hit) {
        const pb = hit.collider.parent();
        ai.rayToi = hit.timeOfImpact ?? hit.toi;
        ai.rayFixed = !pb || pb.isFixed();
      } else ai.rayToi = null;
    }
    if (ai.rayToi != null) {
      if (ai.rayFixed) {
        if (ai.rayToi < 4) block = Math.min(block, ai.rayToi);
      } else block = Math.min(block, ai.rayToi);
    }
    // perception: the gap the driver *believes* lags the real one by their reaction time; a phone glance freezes it
    if (ai.seenBlock == null) ai.seenBlock = block;
    if (!(ai.phoneT > 0)) ai.seenBlock += (block - ai.seenBlock) * Math.min(1, dt / P.react);
    if (block < Math.min(ai.seenBlock, 4 + spd * 0.25)) ai.seenBlock = block; // emergency: everyone reacts to something right at the bumper
    const pb = Math.min(ai.seenBlock, block + 6);
    const decel = 2.6 * P.brake;
    if (pb < 99)
      desired = Math.min(
        desired,
        Math.max(
          0,
          Math.min(
            (pb - P.gap) / P.headway,
            Math.sqrt(2 * decel * Math.max(0, pb - P.gap)) +
              Math.max(0, leadSpd < 90 ? leadSpd : 0),
          ),
        ),
      );
    if (stopBlock < 99)
      desired = Math.min(
        desired,
        Math.max(
          0,
          Math.min(Math.sqrt(2 * decel * Math.max(0, stopBlock - 2.5)), (stopBlock - 2.5) * 1.1),
        ),
      );
    if (ai.phoneT > 0 && spd > 3)
      v.ctrl.steer = clamp(v.ctrl.steer + Math.sin(ai.phoneT * 3 + v.id) * 0.04, -1, 1); // weaving while looking down
    // lane changes with turn signals: overtake slower traffic on multi-lane roads (rate by personality)
    if (ai.lcT > 0) ai.lcT -= dt;
    const maxLane = driveLaneMax(ai.edge, ai.dir);
    if (maxLane >= 1 && ai.lcT <= 0 && !ai.lcTarget && distToNode > 22 && !fleeing) {
      const slowLead = block < 35 && leadSpd < Math.max(4, limit * 0.8);
      const rate = slowLead ? P.lane * 0.09 : P.lane * 0.006; // per second
      if (Math.random() < rate * dt) {
        const tl =
          ai.lane > 0 && (ai.lane >= maxLane || Math.random() < 0.6)
            ? ai.lane - 1
            : Math.min(maxLane, ai.lane + 1);
        if (tl !== ai.lane) {
          ai.lcTarget = {
            lane: tl,
            t: P.lane > 1.5 && Math.random() < 0.35 ? 0.25 : 1.2 + (P.react - 0.3) * 1.5,
          };
        }
      }
    }
    if (ai.lcTarget) {
      const lc = ai.lcTarget;
      lanePointAt(
        ai.edge,
        ai.dir,
        Math.min(ai.edge.len, ai.d + 8),
        laneOffset(ai.edge, ai.dir, lc.lane),
        _lp2,
      );
      const sx = (_lp2.x - t.x) * left.x + (_lp2.z - t.z) * left.z,
        cx = (_lp1.x - t.x) * left.x + (_lp1.z - t.z) * left.z;
      ai.signal = sx > cx ? 1 : -1;
      lc.t -= dt;
      if (lc.t <= 0) {
        let free = lc.lane <= maxLane;
        lanePointAt(ai.edge, ai.dir, ai.d, laneOffset(ai.edge, ai.dir, lc.lane), _lp2);
        for (const o of list) {
          if (o === v || !free) continue;
          const ot = o.body.translation(),
            dx = ot.x - _lp2.x,
            dz = ot.z - _lp2.z;
          const al = dx * _f.x + dz * _f.z,
            lat = Math.abs(dx * left.x + dz * left.z);
          if (lat < 1.7 && al > -10 - Math.max(0, o.speed - spd) * 1.5 && al < 12) free = false;
        }
        if (free) {
          ai.lane = lc.lane;
          S.laneChanges++;
          ai.lcTarget = null;
          ai.signal = 0;
          ai.lcT = 4 + 8 / Math.max(0.2, P.lane);
        } else if (lc.t < -4) {
          ai.lcTarget = null;
          ai.signal = 0;
          ai.lcT = 3;
        }
      }
    }
    // sirens: pull to the curb lane and crawl (if the driver notices)
    let siren = null;
    for (const o of list)
      if (o !== v && o.sirenActive && distXZ(o.body.translation(), t) < 70) {
        siren = o;
        break;
      }
    if (siren) {
      if (ai.sirenNotice == null) {
        ai.sirenNotice = Math.random() < P.siren;
        if (ai.sirenNotice) S.sirenYields++;
      }
      if (ai.sirenNotice) {
        ai.lane = maxLane;
        desired = Math.min(desired, 2.5);
      }
    } else ai.sirenNotice = null;

    const err = desired - v.speed;
    if (desired < 0.3) {
      v.ctrl.throttle = 0;
      v.ctrl.brake = v.speed > 0.2 ? 1 : 0.6;
    } else if (err < -1.2) {
      v.ctrl.throttle = 0;
      v.ctrl.brake = clamp((-err / 6) * P.brake, 0.15, 1);
    } else {
      v.ctrl.brake = 0;
      v.ctrl.throttle = clamp(err * 0.35 + 0.15, 0, 0.45 + 0.55 * P.accel);
    }
    smoothAiControls(v, dt); // [vehicles-look hook] calm steering and progressive pedals (traffic/smooth.js)
    // measurement (traffic/drivers.js): time, distance, free-flow speed vs limit, following gap
    S.seconds += dt;
    S.meters += spd * dt;
    if (
      block > 60 &&
      stopBlock > 60 &&
      distToNode > 50 &&
      curve < 0.15 &&
      Math.abs(steerAng) < 0.1 &&
      spd > 3
    ) {
      S.ratioSum += (spd / limitMs) * dt;
      S.ratioN += dt;
    }
    if (block < 40 && leadSpd > 2 && spd > 3) {
      S.gapSum += block * dt;
      S.gapN += dt;
    }
    v.ctrl.handbrake = false;

    if (byPlayer && v.speed < 1) {
      ai.honkT += dt;
      if (ai.honkT > 1.6 / Math.max(0.08, P.honk)) {
        ai.honkT = -4 - Math.random() * 3;
        S.honks++;
        const hp = new THREE.Vector3(t.x, t.y, t.z);
        if (game.audio?.play) game.audio.play('horn', { position: hp, volume: 0.6 });
        else if (pp && distXZ(t, pp) < 40) horn(v);
      }
    } else if (block < 9 && leadSpd < 0.5 && v.speed < 1 && stopBlock > 60 && P.honk > 0.3) {
      // impatient drivers lean on the horn at a car that does not move on green
      ai.honkT += dt * P.honk;
      if (ai.honkT > 2.5) {
        ai.honkT = -6 - Math.random() * 4;
        S.honks++;
        const hp = new THREE.Vector3(t.x, t.y, t.z);
        if (game.audio?.play) game.audio.play('horn', { position: hp, volume: 0.45 });
      }
    } else if (ai.honkT > 0) ai.honkT = 0;

    // stuck detection (waiting at a red light does not count)
    if (Math.abs(v.speed) < 0.5 && ai.waitT <= 0) ai.stuckT += dt;
    else ai.stuckT = 0;
    // wedged (a hedge, a curb, a parked car): one reverse with opposite lock after 3.5 s; still stuck at 8 s -> recycled
    if (ai.stuckT > 3.5 && !ai.revTried) {
      ai.revTried = true;
      ai.revT = 1.4;
    }
    if (Math.abs(v.speed) > 2) ai.revTried = false;
    if (ai.revT > 0) {
      ai.revT -= dt;
      v.ctrl.throttle = -0.7;
      v.ctrl.brake = 0;
      v.ctrl.handbrake = false;
      v.ctrl.steer = -(v.ctrl.steer || 0.6);
    }
  }

  // aggressive pursuit: ignores lanes, rams, avoids buildings with forward rays
  const _cr = new THREE.Vector3();
  function rayFree(v, t, dx, dz, len) {
    const fr = v.spec.L / 2 + 0.15;
    ray.origin = { x: t.x + dx * fr, y: t.y + 0.1, z: t.z + dz * fr };
    ray.dir = { x: dx, y: 0, z: dz };
    const hit = world.castRay(
      ray,
      len,
      true,
      QF.EXCLUDE_SENSORS | QF.EXCLUDE_DYNAMIC | QF.EXCLUDE_KINEMATIC,
      undefined,
      undefined,
      v.body,
    );
    return hit ? (hit.timeOfImpact ?? hit.toi) : len;
  }
  function chaseDrive(v, dt, t, left) {
    const ai = v.ai,
      ch = (ai.chase ||= { stuckT: 0, revT: 0 });
    const tg = v.chaseTarget;
    const tx = tg.x ?? tg.position?.x,
      tz = tg.z ?? tg.position?.z;
    const dx = tx - t.x,
      dz = tz - t.z;
    const dist = Math.hypot(dx, dz);
    const lx = dx * left.x + dz * left.z,
      lz = dx * _f.x + dz * _f.z;
    let steerAng = Math.atan2(lx, lz) * 1.4;
    const spd = v.speed;
    // building avoidance
    const len = 8 + Math.max(0, spd) * 0.8;
    const c = rayFree(v, t, _f.x, _f.z, len);
    if (c < len) {
      const a = 0.5,
        ca = Math.cos(a),
        sa = Math.sin(a);
      const lxv = _f.x * ca + left.x * sa,
        lzv = _f.z * ca + left.z * sa;
      const rxv = _f.x * ca - left.x * sa,
        rzv = _f.z * ca - left.z * sa;
      const lf = rayFree(v, t, lxv, lzv, len),
        rf = rayFree(v, t, rxv, rzv, len);
      steerAng += (lf >= rf ? 1 : -1) * (1 - c / len) * 1.2;
    }
    const maxSteer = v.spec.steer * lerp(1, 0.3, clamp(Math.abs(spd) / 42, 0, 1));
    let desired = dist > 35 ? 34 : Math.max(7, dist * 0.8);
    if (c < 10 && spd > 14) desired = Math.min(desired, 12);
    if (Math.abs(steerAng) > 0.9 && spd > 14) desired = Math.min(desired, 14);
    // unstick: reverse with opposite lock
    if (ch.revT > 0) {
      ch.revT -= dt;
      v.ctrl.throttle = -1;
      v.ctrl.brake = 0;
      v.ctrl.handbrake = false;
      v.ctrl.steer = clamp(-Math.sign(steerAng || 1), -1, 1);
      return;
    }
    if (Math.abs(spd) < 1.2) {
      ch.stuckT += dt;
      if (ch.stuckT > 1.4) {
        ch.stuckT = 0;
        ch.revT = 1.3;
      }
    } else ch.stuckT = 0;
    v.ctrl.steer = clamp(steerAng / maxSteer, -1, 1);
    const err = desired - spd;
    if (err < -4) {
      v.ctrl.throttle = 0;
      v.ctrl.brake = clamp(-err / 10, 0.2, 1);
    } else {
      v.ctrl.brake = 0;
      v.ctrl.throttle = clamp(err * 0.3 + 0.4, 0, 1);
    }
    v.ctrl.handbrake = Math.abs(steerAng) > 1.1 && spd > 11;
    ai.stuckT = 0;
  }

  let respawnCount = 0;
  function respawnAI(v) {
    respawnCount++;
    const pp = game.player?.position || city?.playerSpawn || new THREE.Vector3();
    const info = randomLanePos(pp, 90, PHYS_R - 15, true, 40, v.spec);
    if (!info) return false; // nothing hidden right now: try again next frame rather than spawn in view
    placeVehicle(v, info.pos, info.heading);
    aiAssign(v, info);
    return true;
  }

  // ------------------------------------------------------------ prebuild every model during the loading screen
  // (a cold parametric build costs ~100-200 ms; doing it in-game caused long frames)
  {
    const t0 = performance.now();
    const keys = ALL_KEYS.slice();
    const sportKeys = keys.filter((k) => ['sports', 'super', 'muscle'].includes(CAR_TYPES[k].cls));
    for (const [k, kit] of [
      ...keys.map((k) => [k, 'base']),
      ...sportKeys.map((k) => [k, 'sport']),
    ]) {
      if (!isBuilt(k, kit)) {
        try {
          prebuild(k, kit);
        } catch (e) {
          console.warn('[vehicles] prebuild', k, e);
        }
      }
      await new Promise((r) => setTimeout(r, 0)); // keep the loading screen alive
    }
    console.info(
      `[vehicles] prebuilt ${keys.length} models in ${Math.round(performance.now() - t0)} ms`,
    );
  }

  // ------------------------------------------------------------ spawn
  const spawn = city?.playerSpawn || new THREE.Vector3();
  // weighted class mixes -> random model of that class
  const pickW = (w) => {
    let tot = 0;
    for (const k in w) tot += w[k];
    let r = Math.random() * tot;
    for (const k in w) {
      r -= w[k];
      if (r <= 0) return k;
    }
    return Object.keys(w)[0];
  };
  const fromClass = (cls) => {
    const ks = CLASSES[cls] || CLASSES.sedan;
    return ks[(Math.random() * ks.length) | 0];
  };
  const TRAFFIC_MIX = {
    sedan: 26,
    compact: 20,
    suv: 18,
    pickup: 8,
    van: 7,
    taxi: 7,
    sports: 4,
    muscle: 2,
    police: 3,
    truck: 3,
    bus: 1.5,
    super: 0.6,
  };
  const PARKED_MIX = {
    sedan: 26,
    compact: 22,
    suv: 18,
    pickup: 9,
    van: 7,
    sports: 6,
    muscle: 4,
    truck: 2,
    super: 1,
  };
  const EXOTIC_MIX = { super: 4, sports: 5, muscle: 2 };
  const colorFor = () => null; // colour comes from the model's palette via rollVariant
  const randomModel = (mix) => {
    const k = fromClass(pickW(mix));
    // police class: unmarked/SUV/sedan; never ambulance/fire in random traffic too often
    return k;
  };
  const zoneAt = (p) => city?.zoneAt?.(p.x, p.z) || 'commercial';
  const RICH = new Set(['beach', 'nightlife', 'downtown', 'business']);
  // neighborhood-matched fleet: class mix and model tier follow the income of the zone (catalog.fleetMix / tierWeight)
  function pickModel(mix, income) {
    const ks0 = CLASSES[pickW(mix)] || CLASSES.sedan;
    let ks = fleet ? ks0.filter((k) => !CAR_TYPES[k]?.glb || fleet.loaded(k)) : ks0;
    if (!ks.length) ks = ks0;
    let tot = 0;
    for (const k of ks) tot += tierWeight(k, income);
    let r = Math.random() * tot;
    for (const k of ks) {
      r -= tierWeight(k, income);
      if (r <= 0) return k;
    }
    return ks[0];
  }
  // luxury districts lift the model tier too (tierWeight), so the SUVs and sports cars there are the expensive ones
  const luxInc = (inc, env) => (env.lux ? Math.max(inc, 0.62 + 0.33 * env.lux) : inc);
  function parkedTypeFor(pos) {
    const env = envAt(pos),
      inc = luxInc(env.income, env);
    let k = pickModel(fleet ? fleet.zoneMix(env.zone, inc, true, env) : fleetMix(inc, true), inc);
    if (CAR_TYPES[k].police && CAR_TYPES[k].police !== 'hidden' && Math.random() < 0.7) k = 'sedan';
    return k;
  }
  function trafficTypeFor(pos) {
    const env = pos ? envAt(pos) : {},
      inc = pos ? luxInc(env.income, env) : 0.5;
    let k = pickModel(
      fleet ? fleet.zoneMix(pos ? env.zone : 'commercial', inc, false, env) : fleetMix(inc),
      inc,
    );
    if ((k === 'firetruck' || k === 'ambulance') && Math.random() < 0.6) k = 'atlas_box';
    if (CAR_TYPES[k].cls === 'super' && inc < 0.7 && Math.random() < 0.5) k = fromClass('sports');
    return k;
  }
  // ---- unique looks: every live car has a different look; collisions re-roll (lookAudit proves it on 500 cars)
  const liveReg = { vis: new Map(), full: new Set() };
  let lookSeq = (Date.now() * 2654435761) >>> 0;
  const lookStats = { rolled: 0, rerolled: 0 };
  function envAt(pos) {
    const zone = pos ? zoneAt(pos) : 'commercial';
    const salt = zone === 'keys' || zone === 'causeway' || (!!pos && pos.z > 4300);
    const rural =
      ['rural', 'farm', 'park', 'wetland', 'everglades'].includes(zone) ||
      (!!pos && (pos.x < -3800 || pos.z < -3300 || (pos.z > 2900 && pos.z < 4300)));
    let lux = 0;
    if (pos && fleet?.luxuryAt) {
      try {
        lux = fleet.luxuryAt(city?.districtAt?.(pos.x, pos.z));
      } catch (e) {
        lux = 0;
      }
    }
    return { zone, income: incomeFor(zone), salt, rural, lux };
  }
  function rollUniqueLook(key, pos, seed, reg = liveReg, env = envAt(pos)) {
    let look = null;
    for (let k = 0; k < 8; k++) {
      look = rollLook(
        key,
        seed != null && k === 0 ? seed : (lookSeq = (lookSeq + 0x9e3779b1) >>> 0),
        env,
      );
      if (!reg.vis.has(visualSignature(look)) && !reg.full.has(look.signature)) break;
      lookStats.rerolled++;
    }
    lookStats.rolled++;
    return look;
  }
  function registerLook(v, reg = liveReg) {
    v._vsig = visualSignature(v.look);
    reg.vis.set(v._vsig, (reg.vis.get(v._vsig) || 0) + 1);
    reg.full.add(v.look.signature);
  }
  function unregisterLook(v) {
    if (!v._vsig) return;
    const n = (liveReg.vis.get(v._vsig) || 1) - 1;
    if (n > 0) liveReg.vis.set(v._vsig, n);
    else liveReg.vis.delete(v._vsig);
    liveReg.full.delete(v.look.signature);
    v._vsig = null;
  }
  // audit: roll + build n cars through the spawner's own model/look path at random road spots in every zone, all
  // treated as alive at once; reports duplicate full and visual signatures (expected 0) and build errors
  function lookAudit(n = 500) {
    const reg = { vis: new Map(), full: new Set() },
      zones = {},
      models = {},
      t0 = performance.now();
    let dupFull = 0,
      dupVis = 0,
      buildErr = 0,
      built = 0;
    const nodes = [...net.nodes.values()];
    const fullSeen = new Set(),
      visSeen = new Set();
    for (let i = 0; i < n; i++) {
      const nd = nodes[(Math.random() * nodes.length) | 0],
        pos = new THREE.Vector3(nd?.x ?? 0, 0, nd?.z ?? 0);
      const type = i % 3 ? trafficTypeFor(pos) : parkedTypeFor(pos);
      const look = rollUniqueLook(type, pos, undefined, reg);
      const fake = { look };
      registerLook(fake, reg);
      if (fullSeen.has(look.signature)) dupFull++;
      fullSeen.add(look.signature);
      if (visSeen.has(fake._vsig)) dupVis++;
      visSeen.add(fake._vsig);
      const z = envAt(pos).zone;
      zones[z] = (zones[z] || 0) + 1;
      models[type] = (models[type] || 0) + 1;
      try {
        const car = buildCar(type, look);
        built++;
        car.dispose?.();
        releaseCar(car);
      } catch (e) {
        buildErr++;
        if (buildErr < 3) console.warn('[lookAudit]', type, e);
      }
    }
    return {
      cars: n,
      built,
      buildErr,
      dupFull,
      dupVisual: dupVis,
      rerolls: lookStats.rerolled,
      models: Object.keys(models).length,
      zones,
      ms: Math.round(performance.now() - t0),
    };
  }
  // a hero sports car right next to the player spawn + special spawns close by so they are found quickly
  const specials = new Set();
  const pendingSpecials = fleet
    ? [
        ['sports', 0xff5a1f, null, 18],
        ['muscle', 0x1d3f8f, null, 30],
      ] // library fleet: the rare cars are placed by hand (glb/placements.js)
    : [
        ['sports', 0xff5a1f, 'Solano GT 400', 18],
        ['super', 0xffc21a, null, 30],
        ['muscle', 0x1d3f8f, null, 30],
        ['roadster', 0xb3121b, null, 30],
      ];
  let specT = -1e9;
  function trySpecials() {
    try {
      world.updateSceneQueries?.();
    } catch (e) {
      /* older rapier */
    }
    for (const entry of pendingSpecials.slice()) {
      const [type, color, name, r0] = entry;
      let sp = null;
      for (let k = 0; k < 8 && !sp; k++)
        sp = parkedSpot(spawn, type === 'sports' ? 0 : 6, r0 + k * 14, false, CAR_TYPES[type]);
      if (sp) {
        specials.add(createVehicle(type, color, sp.pos, sp.heading, name ? { name } : {}));
        pendingSpecials.splice(pendingSpecials.indexOf(entry), 1);
      }
    }
  }
  const noPark = []; // (declared before the boot spawn loops below: parkChecked reads it)
  // registering a zone also clears parked cars already standing in it (zones arrive after the boot spawn)
  const addNoParkZone = (x, z, r = 12) => {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return noPark.length;
    noPark.push({ x, z, r });
    for (const v of list.slice()) {
      if (!v.parked || v.pinned || v.playerDriven || v.ai || v.everDriven) continue;
      const t = v.body?.translation?.();
      if (!t || Math.hypot(t.x - x, t.z - z) >= r) continue;
      try {
        removeVehicle(v);
      } catch (e) {
        /* gone */
      }
    }
    return noPark.length;
  };
  trySpecials();
  await breathe(); // stage 1 boot pacing (src/core/pace.js): the spawn loops run in short tasks
  for (let k = 0; k < 40 && list.length < 14; k++) {
    const s = parkedSpot(spawn, 10, 170 + k * 8);
    if (s) {
      const type = parkedTypeFor(s.pos);
      parkChecked(type, s.pos, s.heading);
    }
    await breathe();
  }
  for (let k = 0; k < 60 && list.filter((v) => v.ai).length < 12; k++) {
    await breathe();
    const info = randomLanePos(spawn, 25, 260 + k * 10, false);
    if (!info) continue;
    const type = trafficTypeFor(info.pos);
    const v = createVehicle(type, colorFor(type), info.pos, info.heading, { ai: true });
    aiAssign(v, info);
  }

  // ------------------------------------------------------------ hand-placed cars
  // spawnParked(key, { x, z, heading, color, wear 0..1, y?, locked?, seed? }) -> Promise<vehicle>: a parked car that the
  // traffic manager never recycles (driveways, set pieces).  Waits for the library model to load; wheels settle on the ground.
  // a parked car only where its footprint is clear of fences, walls, props and other cars (r2-physics clearance.js);
  // slid to the nearest free spot, skipped when there is none; re-checked after spawn (colliders that stream in later)
  // no-parking zones { x, z, r } (STOP corners, drive mouths: US rule, no parking within 20 ft of a STOP sign / crosswalk)
  function parkChecked(type, pos, heading) {
    for (const zn of noPark) if (Math.hypot(pos.x - zn.x, pos.z - zn.z) < zn.r) return null;
    const t = CAR_TYPES[type] || CAR_TYPES.sedan;
    let p = pos,
      h = heading;
    if (game.physics?.findCarSpot) {
      const s = game.physics.findCarSpot(pos.x, pos.z, heading, t.L, t.W);
      if (!s) return null;
      p = new THREE.Vector3(s.x, s.y ?? pos.y, s.z);
      h = s.heading ?? heading;
    }
    const v = createVehicle(type, colorFor(type), p, h, { locked: Math.random() < 0.4 });
    try {
      game.physics?.watchParked?.(v);
    } catch (e) {
      /* optional */
    }
    return v;
  }
  // lot planting blocks parking (user: an SUV wedged in the hedge by Nico's stairs): no parked car within 1.5 m of a drawn
  // shrub / hedge (r2-physics' shrub zones, registered within 50 m of the player) at its center or corners
  function lotBlocked(x, z, heading = 0, L = 4.8, W = 2.0) {
    if (
      game.placement?.parkOk &&
      !(game.placement.spotOk || game.placement.parkOk)(x, z, heading, L, W)
    )
      return true; // map audit: the shared rule (bushes anywhere on the map, water)
    const at = game.physics?.shrubs?.at;
    if (!at) return false;
    const c = Math.cos(heading),
      s_ = Math.sin(heading);
    for (const [a, b] of [
      [0, 0],
      [W / 2, L / 2],
      [-W / 2, L / 2],
      [W / 2, -L / 2],
      [-W / 2, -L / 2],
      [0, L / 2],
      [0, -L / 2],
    ]) {
      if (at(x + a * c + b * s_, z - a * s_ + b * c, 1.5) > 0) return true;
    }
    return false;
  }
  async function spawnParked(key, o = {}) {
    if (fleet && !CAR_TYPES[key]?.glb) key = fleet.resolve(key); // generic keys ('sedan', 'pickup'...) -> a library model of that class
    if (fleet && CAR_TYPES[key]?.glb && !fleet.loaded(key)) {
      try {
        await loadCarModel(CAR_TYPES[key].fileKey || key);
      } catch (e) {
        /* falls back below */
      }
    }
    // the ground (streamed colliders) must exist under the spot, or the car drops through / lands hard and dents itself
    for (let i = 0; i < 120 && city?.collidersReadyAt && !city.collidersReadyAt(o.x, o.z); i++)
      await new Promise((r) => setTimeout(r, 250));
    try {
      syncQueries();
    } catch (e) {
      /* */
    }
    if (!o.keepSpot && game.physics?.findCarSpot && CAR_TYPES[key]) {
      const s = game.physics.findCarSpot(
        o.x,
        o.z,
        o.heading || 0,
        CAR_TYPES[key].L,
        CAR_TYPES[key].W,
      );
      if (!s) return null;
      if (lotBlocked(s.x, s.z, o.heading || 0, CAR_TYPES[key].L, CAR_TYPES[key].W)) return null;
      o = { ...o, x: s.x, z: s.z, y: s.y ?? o.y };
    }
    // Nov 19 (Nico's yard: cars tipped onto their nose, flew 100 m or dropped through): the city terrain height can sit under a
    // set piece's own ground (yard, lot, pad) by up to ~1 m, so a car spawned at it started inside that collider. Spawn on the
    // topmost static surface within 1.6 m above the terrain instead (never a roof: higher surfaces are ignored).
    let y = o.y;
    if (y == null) {
      y = groundY(o.x, o.z);
      try {
        const h = world.castRay(
          new RAPIER.Ray({ x: o.x, y: y + 1.6, z: o.z }, { x: 0, y: -1, z: 0 }),
          2.4,
          true,
          QF.EXCLUDE_SENSORS | QF.EXCLUDE_DYNAMIC | QF.EXCLUDE_KINEMATIC,
        );
        if (h) {
          const hy = y + 1.6 - h.timeOfImpact;
          if (hy > y + 0.05) y = hy;
        }
      } catch (e) {
        /* terrain height stands */
      }
    }
    const v = createVehicle(
      CAR_TYPES[key] ? key : 'sedan',
      o.color ?? null,
      new THREE.Vector3(o.x, y, o.z),
      o.heading || 0,
      {
        locked: o.locked ?? false,
        wear: o.wear,
        seed: o.seed,
        exact: true,
        twoTone: o.twoTone,
        stripe: o.stripe,
        interior: o.interior,
        ride: o.ride,
        finish: o.finish,
        old: o.old,
        tint: o.tint,
      },
    );
    specials.add(v);
    v.pinned = true;
    if (!o.keepSpot) {
      try {
        game.physics?.watchParked?.(v);
      } catch (e) {
        /* optional */
      }
    }
    return v;
  }
  // Nico's yard (Key Largo, user mock-up docs/v2/plan/nico_house/0_front_deck_mockup.webp): the gray lifted pickup with a black
  // hood stripe in front of the deck, the old faded pale-blue classic broadside to its right.  House-local frame: +Z = street.
  // Nico's main car to come (user, Nov 19; mock-ups docs/v2/plan/nico_car/mockup_side.webp, mockup_rear.webp): a coupe-utility
  // (pickup-bed muscle car) in warm glossy yellow, an orange-red band over the hood and along both flanks above the wheel
  // arches, chrome trim, tan / brown leather cabin; no lettering or badges.  Spread into its NICO_CARS entry once the ute model
  // is imported (then it replaces truck9 in the drive).  side.y = flank band height (m above ground): measure per model.
  const NICO_UTE_SCHEME = {
    color: 0xf2a90f,
    finish: 'gloss',
    interior: 0x8a5634,
    wear: { dirt: 0.06, rust: 0, fade: 0, dirtColor: 'sand' },
    stripe: { w: 1.1, color: 0xd8461a, satin: false, side: { y: [0.62, 0.74] } },
  };
  const NICO_CARS = [
    // User (Nov 19, afternoon): the gray off-road pickup stays in the drive, and the yellow coupe-utility takes the old blue
    // classic's spot (the blue car is gone). The truck uses the open sandy pad in front of the stairs / lattice that was
    // checked clear for the ute (house frame after the r10 10 degree turn), nose to the street (+Z).
    {
      key: 'truck9',
      local: [-1.3, 7.5],
      heading: 0,
      color: 0x9a9ea3,
      finish: 'metallic',
      wear: { dirt: 0.16, rust: 0, fade: 0, dirtColor: 'sand' },
      // hood / roof stripe boxes measured per model (manifest .stripe, seats.py)
      stripe: {
        w: 0.86,
        roofW: 0.78,
        color: 0x515458,
        satin: true,
        line: { color: 0x9da0a4, w: 0.022 },
      },
      ride: 0.07,
      tint: 0, // factory glass: Nico shows through the windows
    },
    // Nico's yellow coupe-utility (ute1, mock-ups docs/v2/plan/nico_car), where the faded blue classic used to sit.
    // The orange-red hood band / hockey stick / flank band is cut into the model (tools/v2/cars/ute1), so no shader stripe.
    {
      key: 'ute1',
      local: [-18.8, 5.5],
      heading: 1.03,
      ...NICO_UTE_SCHEME,
      color: 0xf4a40a,
      wear: { dirt: 0.03, rust: 0, fade: 0, dirtColor: 'sand' },
      stripe: null,
      tint: 0,
    },
  ];
  const nicoCars = [];
  (async () => {
    if (!fleet) return;
    await new Promise((r) => setTimeout(r, 1500));
    for (let i = 0; i < 240 && !game.nicoHouse?.toWorld; i++)
      await new Promise((r) => setTimeout(r, 1000));
    const NH = game.nicoHouse;
    if (!NH?.toWorld) return;
    const h0 = NH.spot?.heading || 0;
    // the STOP corner and Nico's drive mouth stay clear of curb parking (mock-up: one SUV crossing, nothing parked)
    for (const [lx, lz, r] of [
      [-20.9, 23.8, 15],
      [-18.5, 20.5, 9],
    ]) {
      const p = NH.toWorld(new THREE.Vector3(lx, 0, lz));
      addNoParkZone(p.x, p.z, r);
    }
    // the neighbors: a sedan under a cover in the next yard, the old graffiti van rusting on the lot across the lane
    for (const [k, lx, lz, h] of [['covered1', -22.9, -3.5, -0.37]]) {
      // spots from r2-keys (rotated house, mock-up frame)
      const p = NH.toWorld(new THREE.Vector3(lx, 0, lz));
      try {
        await placeStatic(k, { x: p.x, z: p.z, heading: h + h0 });
      } catch (e) {
        /* optional */
      }
    }
    for (const c of NICO_CARS) {
      const ta = c.drive && NH.house?.anchors?.truckR4,
        q = ta ? ta.pos.clone() : new THREE.Vector3(c.local[0], 0, c.local[1]); // r4-house: the drive spot follows the rebuilt house
      // the yard ground collider (house part 05) stands 0.6-0.9 m above the city terrain that spawnParked's groundY reads: spawned at
      // the terrain height the car started inside the yard collider and was thrown out (tipped, flown off) or pushed through it
      q.y = NH.house?.yardY ? NH.house.yardY(q.x, q.z) : 0;
      const p = NH.toWorld(q);
      try {
        const v = await spawnParked(c.key, {
          x: p.x,
          y: p.y + 0.02,
          z: p.z,
          heading: (ta ? ta.heading : c.heading) + h0,
          color: c.color,
          wear: c.wear,
          finish: c.finish,
          locked: false,
          stripe: c.stripe || null,
          interior: c.interior,
          ride: c.ride,
          old: c.old,
          tint: c.tint,
          keepSpot: true,
        });
        if (v) {
          v.playerOwned = true;
          v.locked = false;
        }
        nicoCars.push(v);
      } catch (e) {
        console.warn('[cars] nico yard car', c.key, e);
      }
    }
    // the old van rusting on the lot across the lane (user r8: the 2.8k-tri graffiti van read very low-res): the HD boxy passenger
    // van (Van 5), sun-faded, rusted and salt-crusted, locked, on a clear spot (game.placement: never on a pole, stairs or bins)
    try {
      for (let i = 0; i < 40 && game.lots?.enabled !== false && !game.houses; i++)
        await new Promise((r) => setTimeout(r, 500));
      const p = NH.toWorld(new THREE.Vector3(18.6, 0, 25.0)),
        hv = 1.58 + h0,
        q = game.placement?.clearSpot
          ? game.placement.clearSpot(p.x, p.z, hv, 5.3, 2.1, 8, { cars: true })
          : [p.x, p.z];
      if (q) {
        const v = await spawnParked('van5', {
          x: q[0],
          z: q[1],
          heading: hv,
          color: 0x9a968a,
          finish: 'solid',
          old: true,
          locked: true,
          keepSpot: true,
          wear: { dirt: 0.45, rust: 0.42, fade: 0.7, age: 1, dirtColor: 'salt' },
        });
        if (v) {
          v.pinned = true;
          v.derelict = true;
          import('../world/props/weathered.js')
            .then((m) => m.weatherObject(v.mesh, { fade: 0.7, rust: 0.55, grime: 0.6, seed: 5 }))
            .catch(() => {
              /* cosmetic */
            });
        }
      }
    } catch (e) {
      /* optional */
    }
  })();
  // placeStatic('covered1', { x, z, heading }) -> Promise<Object3D>: a static library prop (car under a cover) with a box collider
  async function placeStatic(key, o = {}) {
    const rec = await loadCarModel(key);
    if (!rec) return null;
    for (let i = 0; i < 40 && game.lots?.enabled !== false && !game.houses; i++)
      await new Promise((r) => setTimeout(r, 500)); // the lots' solids (stairs, decks) register with the houses module
    const g = buildStaticCar(key);
    if (!g) return null;
    {
      const d0 = g.userData.dims,
        PL = game.placement; // r8 (map / lots agent): never on a utility pole, in a house's stairs or bins (game.placement.clearSpot)
      if (PL?.clearSpot && d0) {
        const q = PL.clearSpot(o.x, o.z, o.heading || 0, d0.L, d0.W, 5, { cars: true });
        if (!q) return null;
        o = { ...o, x: q[0], z: q[1] };
      }
    }
    const y = o.y ?? groundY(o.x, o.z),
      d = g.userData.dims;
    g.position.set(o.x, y, o.z);
    g.rotation.y = o.heading || 0;
    scene.add(g);
    try {
      const q = new THREE.Quaternion().setFromAxisAngle(UP, o.heading || 0);
      const body = world.createRigidBody(
        RAPIER.RigidBodyDesc.fixed()
          .setTranslation(o.x, y + d.H / 2, o.z)
          .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }),
      );
      world.createCollider(
        RAPIER.ColliderDesc.roundCuboid(
          d.W / 2 - 0.12,
          d.H / 2 - 0.12,
          d.L / 2 - 0.12,
          0.1,
        ).setFriction(0.7),
        body,
      );
      g.userData.body = body;
    } catch (e) {
      /* no physics */
    }
    return g;
  }
  // utility vehicles at their spots (glb/spots.js: Nico's yard, the air station, MIA), spawned within 400 m
  const utilitySpots = createUtilitySpots(game);
  const rareDone = new Set();
  function placeRare(pp) {
    if (!fleet) return;
    for (const P of RARE_PLACEMENTS) {
      if (rareDone.has(P.key) || !CAR_TYPES[P.key]?.glb) continue;
      const d = Math.hypot(pp.x - P.at[0], pp.z - P.at[1]);
      if (d > 320 || d < 40) continue;
      if (!fleet.loaded(P.key)) {
        loadCarModel(CAR_TYPES[P.key].fileKey || P.key);
        continue;
      }
      // the best of several curb spots: farthest from both ends of its street (never on a corner or a crosswalk)
      let sp = null,
        best = -1;
      for (let k = 0; k < 14; k++) {
        const c = parkedSpot(
          new THREE.Vector3(P.at[0], 0, P.at[1]),
          0,
          P.r,
          false,
          CAR_TYPES[P.key],
        );
        if (!c) continue;
        const pts = c.edge?.pts || [],
          a0 = pts[0],
          a1 = pts[pts.length - 1];
        const dEnd =
          a0 && a1
            ? Math.min(
                Math.hypot((a0.x ?? a0[0]) - c.pos.x, (a0.z ?? a0[1]) - c.pos.z),
                Math.hypot((a1.x ?? a1[0]) - c.pos.x, (a1.z ?? a1[1]) - c.pos.z),
              )
            : 20;
        if (dEnd > best) {
          best = dEnd;
          sp = c;
        }
      }
      if (!sp || best < 18) continue;
      rareDone.add(P.key);
      const v = createVehicle(P.key, P.color ?? null, sp.pos, sp.heading, {
        locked: true,
        exact: true,
      });
      specials.add(v);
      v.pinned = true;
      v.rare = true;
    }
  }

  // ------------------------------------------------------------ traffic density manager (stream around the player)
  const PHYS_R = 190; // simulate cars within this radius of the player (colliders stream to ~250-300 m)
  const DENS = {
    downtown: 1.45,
    business: 1.35,
    causeway: 1.25,
    nightlife: 1.25,
    commercial: 1.1,
    beach: 0.95,
    residential: 0.8,
    port: 0.7,
    industrial: 0.7,
    park: 0.55,
    water: 0.5,
  };
  let mgrT = 0;
  const trafficDebug = { target: null, rej: spawnRej };
  // simulation tiers: full ray-cast physics within SIM_R; beyond it AI traffic becomes a kinematic
  // "ghost" that follows its lane on the road graph (no controller, no wheel rays), parked cars freeze.
  const SIM_R = 95; // stage 1 perf: full wheel-ray physics only near the player (was 180); farther AI cars glide on their lanes (identical at range)
  let playerCarRef = null;
  function physicsRange(pp) {
    playerCarRef = list.find((v) => v.playerDriven) || null;
    const pv = playerCarRef ? playerCarRef.body.linvel() : null;
    for (const v of list) {
      if (v.playerDriven) {
        if (v.ghost) fromGhost(v, true);
        if (v.frozen) thaw(v, true);
        continue;
      }
      const t = v.body.translation();
      let d = distXZ(t, pp);
      // closing fast on the player's car (time-to-reach < 5 s) counts as near
      if (pv) {
        const ov = v.body.linvel();
        const dx = t.x - pp.x,
          dz = t.z - pp.z,
          L = Math.hypot(dx, dz) || 1;
        const closing = -((ov.x - pv.x) * dx + (ov.z - pv.z) * dz) / L;
        if (closing > 0 && L / closing < 5) d = Math.min(d, SIM_R - 20);
      }
      const aiCar = v.ai && !v.chaseTarget && !v.disabled;
      if (aiCar) {
        if (v.frozen && d < PHYS_R) {
          thaw(v, true);
          toGhost(v);
        } else if (!v.ghost && !v.frozen && d > SIM_R + 10 && v.ai.edge) toGhost(v);
        else if (v.ghost && d < SIM_R - 10) fromGhost(v);
      } else {
        if (v.ghost) fromGhost(v, true);
        const chaseR = v.chaseTarget && !v.disabled ? 450 : SIM_R; // dispatched police drive in from far away
        if (!v.frozen && d > chaseR + 10) freeze(v);
        else if (v.frozen && d < chaseR - 10) thaw(v);
      }
    }
  }
  const RBT = RAPIER.RigidBodyType;
  function toGhost(v) {
    if (v.ghost || !v.ai) return;
    if (!v.ai.edge) {
      freeze(v);
      return;
    }
    if (v.vc) {
      try {
        world.removeVehicleController(v.vc);
      } catch (e) {
        /* ignore */
      }
      v.vc = null;
    }
    restWheels(v);
    try {
      v.body.setEnabled(true);
    } catch (e) {
      /* ignore */
    }
    v.body.setBodyType(RBT.KinematicPositionBased, true);
    if (v.ccd) {
      v.body.enableCcd(false);
      v.ccd = false;
    }
    v.ghost = true;
    v.frozen = false;
    v.ghostSpeed = Math.max(0, v.speed || 8);
    v.hitCd = 0.6;
    v.ai.next = null;
    v.ai.deadEnd = false;
  }
  function fromGhost(v, force = false) {
    if (!v.ghost) return;
    const t = v.body.translation();
    if (!force && !groundReady(t.x, t.y - v.groundOff, t.z)) return;
    // the ghost pose follows the lane polyline height; the real road collider can sit a few cm higher (crown, curb ramps,
    // bridge joints). Re-seat the body on the collider under it first, so the hull never starts inside the road and
    // gets kicked out (the one roll-over cause left in the stability probe: flips 0.6 s after leaving ghost mode)
    try {
      const gh = world.castRay(
        new RAPIER.Ray({ x: t.x, y: t.y + 1.5, z: t.z }, { x: 0, y: -1, z: 0 }),
        5,
        true,
        QF.EXCLUDE_DYNAMIC | QF.EXCLUDE_KINEMATIC | QF.EXCLUDE_SENSORS,
      );
      if (gh) {
        const gyR = t.y + 1.5 - (gh.timeOfImpact ?? gh.toi);
        v.body.setTranslation({ x: t.x, y: gyR + v.groundOff + 0.02, z: t.z }, true);
      }
    } catch (e) {
      /* query pipeline busy: keep the ghost pose */
    }
    v.body.setBodyType(RBT.Dynamic, true);
    const r = v.body.rotation();
    _q.set(r.x, r.y, r.z, r.w);
    _v.set(0, 0, 1).applyQuaternion(_q);
    const sp = v.ghostSpeed || 0;
    v.body.setLinvel({ x: _v.x * sp, y: 0, z: _v.z * sp }, true);
    v.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    v.vc = makeController(v.body, v.car.wheels, v.spec, v.restLen, v.stiff);
    v.ghost = false;
    v.bodySway = null;
    v.hitCd = 0.6;
    v.fromGhostT = game.clock?.elapsed ?? performance.now() / 1000;
  }
  const _gp = {},
    _gq = new THREE.Quaternion(),
    _gTr = { x: 0, y: 0, z: 0 },
    _gRo = { x: 0, y: 0, z: 0, w: 1 };
  function ghostTick(v, dt) {
    const ai = v.ai;
    if (!ai || !ai.edge) {
      v.speed = 0;
      return;
    }
    // speed: limit, junction slow-down, keep distance to the car ahead (cheap scan)
    let desired = Math.min(v.spec.vmax * 0.8, ((ai.edge.speedKmh || 40) / 3.6) * ai.cruiseK);
    const distToNode = ai.edge.len - ai.d;
    if (!ai.next && !ai.deadEnd) chooseNext(v);
    if (ai.next && distToNode < 30 && Math.abs(ai.next.ang) > 0.45)
      desired = Math.min(desired, lerp(6, desired, clamp((distToNode - 5) / 25, 0, 1)));
    if ((tickN + v.id) % 6 === 0) {
      const t = v.body.translation();
      const fx = Math.sin(v.ghostHeading || 0),
        fz = Math.cos(v.ghostHeading || 0);
      let block = 99;
      for (let i = 0; i < list.length; i++) {
        const o = list[i];
        if (o === v) continue;
        const ot = o.body.translation();
        const dx = ot.x - t.x,
          dz = ot.z - t.z;
        if (dx * dx + dz * dz > 625) continue;
        const a = dx * fx + dz * fz,
          lat = Math.abs(dx * fz - dz * fx);
        if (a > 0 && lat < 2) block = Math.min(block, a - (o.spec.L + v.spec.L) / 2);
      }
      ai.ghostBlock = block;
    }
    if (ai.ghostBlock < 99) desired = Math.min(desired, Math.max(0, (ai.ghostBlock - 3) * 0.9));
    const sp = (v.ghostSpeed = v.ghostSpeed + clamp(desired - v.ghostSpeed, -6 * dt, 3 * dt));
    ai.d += sp * dt;
    if (ai.d > ai.edge.len) {
      if (ai.next) {
        const n = ai.next;
        ai.d -= ai.edge.len;
        ai.edge = n.edge;
        ai.dir = n.dir;
        ai.lane = n.lane;
        ai.next = null;
        chooseNext(v);
      } else {
        ai.dir = -ai.dir;
        ai.d = 0;
        ai.deadEnd = false;
      }
    }
    lanePointAt(
      ai.edge,
      ai.dir,
      Math.min(ai.edge.len, ai.d),
      laneOffset(ai.edge, ai.dir, ai.lane),
      _gp,
    );
    const h = Math.atan2(_gp.fx, _gp.fz);
    // smooth heading through corners
    let dh = h - (v.ghostHeading ?? h);
    dh = Math.atan2(Math.sin(dh), Math.cos(dh));
    v.ghostHeading = (v.ghostHeading ?? h) + dh * Math.min(1, dt * 6);
    const gy = _gp.y != null ? _gp.y : (city?.groundHeightAt?.(_gp.x, _gp.z) ?? 0);
    _gTr.x = _gp.x;
    _gTr.y = gy + v.groundOff;
    _gTr.z = _gp.z;
    _gq.setFromAxisAngle(UP, v.ghostHeading);
    _gRo.x = _gq.x;
    _gRo.y = _gq.y;
    _gRo.z = _gq.z;
    _gRo.w = _gq.w;
    v.body.setNextKinematicTranslation(_gTr);
    v.body.setNextKinematicRotation(_gRo);
    v.speed = sp;
    ai.stuckT = 0;
  }
  // freeze: controller removed (its wheels cache ground-collider handles), body disabled
  // Nov 19 (user: "a car was hovering because its wheels were inside it"): without a controller (ghost and frozen cars)
  // nothing moves the drawn wheels, so they kept their last pose (often the body origin, see the wheel loop) and the
  // far LOD baked that pose. Put them at the static ride height instead: the tires stand on the ground under the body.
  function restWheels(v) {
    const rest = v.groundOff - v.spec.r;
    for (const w of v.car?.wheels || []) w.steer.position.set(w.x, -rest, w.z);
  }
  function freeze(v) {
    if (v.frozen) return;
    v.frozen = true;
    if (v.vc) {
      try {
        world.removeVehicleController(v.vc);
      } catch (e) {
        /* ignore */
      }
      v.vc = null;
    }
    restWheels(v);
    try {
      v.body.setEnabled(false);
    } catch (e) {
      /* old rapier */
    }
    v.speed = 0;
  }
  function groundReady(x, y, z) {
    if (city?.collidersReadyAt && !city.collidersReadyAt(x, z)) return false;
    const gh = world.castRay(
      new RAPIER.Ray({ x, y: y + 2.5, z }, { x: 0, y: -1, z: 0 }),
      7,
      true,
      QF.EXCLUDE_DYNAMIC | QF.EXCLUDE_KINEMATIC | QF.EXCLUDE_SENSORS,
    );
    return !!gh;
  }
  function thaw(v, force = false) {
    if (!v.frozen) return;
    const t = v.body.translation();
    if (!force && !groundReady(t.x, t.y - v.groundOff, t.z)) return;
    v.frozen = false;
    try {
      v.body.setEnabled(true);
      v.body.wakeUp();
    } catch (e) {
      /* ignore */
    }
    if (!v.vc) v.vc = makeController(v.body, v.car.wheels, v.spec, v.restLen, v.stiff);
    v.bodySway = null;
  }
  // the CITY tells us before it drops a tile's colliders: freeze everything standing on it
  city?.onTileCollidersRemoving?.((b) => {
    const pad = 6;
    for (const v of list) {
      if (v.playerDriven || v.frozen) continue;
      const t = v.body.translation();
      if (t.x > b.minX - pad && t.x < b.maxX + pad && t.z > b.minZ - pad && t.z < b.maxZ + pad)
        freeze(v);
    }
  });
  function trafficManager(dt) {
    mgrT -= dt;
    if (mgrT > 0) return;
    mgrT = 0.5;
    syncQueries();
    const pp = game.player?.position;
    if (!pp) return;
    physicsRange(pp);
    // perf (Nov 19): every 1.5 s instead of every manager tick (each try is up to 8 x 60 spot queries; with the per-frame
    // query budget in spotFree this was still a quarter of the main thread in the first 90 s after loading)
    const specNow = game.clock?.elapsed ?? 0;
    if (pendingSpecials.length && specNow < 90 && specNow - specT >= 1.5) {
      specT = specNow;
      trySpecials();
    }
    placeRare(pp);
    if (fleet) utilitySpots.tick(pp);
    const h = game.timeOfDay ?? 12;
    const tf =
      h < 5
        ? 0.4
        : h < 6.5
          ? 0.6
          : (h > 7 && h < 9.5) || (h > 16 && h < 19)
            ? 1.2
            : h > 22
              ? 0.65
              : 1;
    // busier streets (playtest: downtown looked empty at noon): about 21 cars around the player downtown at midday
    const target =
      trafficDebug.target ?? clamp(Math.round(14.5 * (DENS[zoneAt(pp)] ?? 1) * tf), 5, 24);
    const ais = list.filter(
      (v) => v.ai && !v.chaseTarget && !v.playerDriven && !v.disabled && !v.external,
    );
    // recycle far / stuck traffic
    let moved = 0;
    for (const v of ais) {
      const t = v.body.translation();
      const far = distXZ(t, pp) > PHYS_R + 15,
        stuck = v.ai.stuckT > 8; // stalled cars recover within 8 s (out of view)
      if ((far || stuck) && moved < 2) {
        // in view, a stalled car first gets a long grace (it may be waiting behind something); after 25 s it is recycled anyway
        if (stuck && !far && v.ai.stuckT < 25 && inView(new THREE.Vector3(t.x, t.y, t.z))) continue;
        if (ais.length > target + 1 && far) {
          removeVehicle(v);
          moved++;
          continue;
        }
        if (respawnAI(v)) moved++;
      }
    }
    if (ais.length < target && moved < 2) {
      const info = randomLanePos(pp, 90, PHYS_R - 15, true);
      if (info) {
        const type = trafficTypeFor(info.pos);
        const v = createVehicle(type, colorFor(type), info.pos, info.heading, { ai: true });
        aiAssign(v, info);
      }
    }
    // parked cars: keep ~10 at the curbs near the player
    const parked = list.filter(
      (v) =>
        !v.ai && !v.playerDriven && !v.everDriven && !specials.has(v) && !(LEAKFIX && v.disabled),
    ); // r3-perf: a wreck is not a parked car (it was re-placed at a curb as one)
    const nearParked = parked.filter((v) => distXZ(v.body.translation(), pp) < PHYS_R).length;
    if (nearParked < 10) {
      const farP = parked.find((v) => distXZ(v.body.translation(), pp) > PHYS_R + 60);
      const sp = parkedSpot(pp, 70, PHYS_R - 15, true);
      if (sp && !lotBlocked(sp.pos.x, sp.pos.z, sp.heading)) {
        if (farP) {
          placeVehicle(farP, sp.pos, sp.heading);
          farP.locked = Math.random() < 0.4;
        } else if (parked.length < 18) {
          const type = parkedTypeFor(sp.pos);
          parkChecked(type, sp.pos, sp.heading);
        }
      }
    }
    if (LEAKFIX) sweepLeftovers(pp);
  }
  // r3-perf (leak, ?leakfix=0 rolls back): wrecks and cars the player drove and left were never removed (the traffic manager
  // only recycles live AI traffic; police only drops its own cars). A long chase left a trail of carjacked cars and burnt-out
  // wrecks across the city, each a full car (meshes, materials, body, collider, wheel controller) in the scene for good.
  // Every 2 s: a wreck or a left car (not the player's last car, not one the player owns, not a placed special) goes once it
  // is out of view and more than 220 m away (any view past 400 m); more than 8 such cars: the farthest out-of-view ones past
  // 90 m go first.
  const LEAKFIX = !(typeof location !== 'undefined' && /[?&]leakfix=0/.test(location.search));
  let sweepT = 0,
    lastPlayerCar = null;
  const sweepStats = { removed: 0 };
  function sweepLeftovers(pp) {
    for (const v of list) if (v.playerDriven) lastPlayerCar = v;
    const et = game.clock?.elapsed ?? 0;
    if (et - sweepT < 2) return;
    sweepT = et;
    const left = [];
    for (const v of list) {
      if (
        v.playerDriven ||
        v === lastPlayerCar ||
        v.playerOwned ||
        v.owned ||
        v.keep ||
        specials.has(v) ||
        (v.ai && !v.disabled) ||
        (v.chaseTarget && !v.disabled)
      )
        continue;
      if (!(v.disabled || v.everDriven || v.flooded)) continue;
      const t = v.body.translation(),
        seen = inView(t);
      // GTA rule (user: the car despawned when he got out): a car the player drove goes only after it has been out of view for
      // a while (30 s, 90 s within 5 min of driving it); wrecks / flooded cars keep the old 0 s
      v._unseenT = seen ? 0 : (v._unseenT || 0) + 2;
      const need =
        v.everDriven && !v.disabled ? (et - (v.lastDrivenAt ?? -1e9) < 300 ? 90 : 30) : 0;
      left.push({ v, d: distXZ(t, pp), seen: seen || v._unseenT < need });
    }
    left.sort((a, b) => b.d - a.d);
    let n = left.length;
    for (const e of left) {
      if ((e.d > 220 && !e.seen) || e.d > 400 || (n > 8 && e.d > 90 && !e.seen)) {
        try {
          if (removeVehicle(e.v)) {
            n--;
            sweepStats.removed++;
          }
        } catch (er) {
          /* gone */
        }
      }
    }
  }
  // ------------------------------------------------------------ hooks
  // Rapier's query pipeline (used by the wheel ray casts and every castRay / intersection query) is only
  // refreshed inside world.step(). Streaming removes/adds static colliders (and we enable/disable far
  // cars) between steps, so a ray cast against the stale BVH can touch a freed collider -> wasm panic
  // ("unreachable" in update_vehicle). Refresh it before we query anything.
  function syncQueries() {
    try {
      world.updateSceneQueries();
    } catch (e) {
      /* older rapier: no-op */
    }
  }
  let tickN = 0;
  function vehiclesFixed(dt) {
    if (!(dt > 0 && dt < 0.2)) return;
    tickN++;
    for (let i = 0; i < list.length; i++) {
      const v = list[i];
      try {
        if (v.ghost) ghostTick(v, dt);
        else physicsTick(v, dt);
      } catch (e) {
        console.error('[vehicles] tick', v.name, e);
      }
      // driving through bushes and flower beds (no colliders): they drag the car down instead of stopping it dead
      if (!v.ghost && !v.frozen && !v.isBoat && !v.disposed && city?.bushAt) {
        try {
          const t = v.body.translation(),
            bd = city.bushAt(t.x, t.z, 0.9);
          if (bd > 0) {
            const lv = v.body.linvel(),
              k = Math.exp(-dt * 2.2 * Math.min(1, bd * 2));
            v.body.setLinvel({ x: lv.x * k, y: lv.y, z: lv.z * k }, true);
          }
        } catch (e) {
          /* body gone */
        }
      }
    }
  }
  const kindReg = createKindRegistry();
  game.fixedHooks.push(function vehicleKindsFixed(dt) {
    kindReg.fixed(dt);
  });
  Object.defineProperty(vehiclesFixed, 'name', { value: 'vehiclesFixed' }); // survives minification for the profiler
  game.fixedHooks.push(vehiclesFixed);

  // ------------------------------------------------------------ per-frame visuals
  let lastT = -1;
  const _spotPos = new THREE.Vector3();
  let lastEvict = 0;
  let paintWet = 0;
  let bushT = 0;
  function update(dt) {
    // parked cars in bushes (user, Nov 18: a car glitched through a yard bush): lot planting streams in after the parked cars,
    // so the spawn-time check (lotBlocked) misses plants that arrive later. Every 1.2 s, a parked car within 50 m (where shrub
    // zones exist) that now stands in a shrub is recycled as soon as it is out of view (never popped while on screen)
    if ((bushT += dt) > 1.2) {
      bushT = 0;
      try {
        const pp = game.player?.position;
        if (pp && game.physics?.shrubs?.at)
          for (const v of list.slice()) {
            if (
              !v.parked ||
              v.pinned ||
              v.playerDriven ||
              v.ai ||
              v.everDriven ||
              v.rare ||
              v.playerOwned
            )
              continue;
            const t = v.body?.translation?.();
            if (!t || Math.hypot(t.x - pp.x, t.z - pp.z) > (game.placement?.parkOk ? 180 : 50))
              continue; // map audit: the placement rule knows every drawn shrub, not only the 50 m physics zones
            const r = v.body.rotation(),
              h = Math.atan2(2 * (r.w * r.y + r.x * r.z), 1 - 2 * (r.y * r.y + r.x * r.x)),
              T = CAR_TYPES[v.typeKey] || {};
            const hit = lotBlocked(t.x, t.z, h, (T.L || 4.6) * 0.9, (T.W || 1.9) * 0.9);
            if (hit && !inView(new THREE.Vector3(t.x, t.y, t.z))) removeVehicle(v); // seen right now: re-checked next tick, removed once off screen
          }
      } catch (e) {
        /* cosmetic */
      }
    }
    {
      // car paint wetness follows rain: builds in ~10 s, dries over ~90 s
      const w = game.weather;
      const kind = String(
        typeof w === 'string' ? w : w?.kind || w?.type || w?.current || w?.state || '',
      ).toLowerCase();
      const rain =
        typeof w?.rain === 'number' ? w.rain : /storm|hurricane|rain|shower/.test(kind) ? 1 : 0;
      paintWet +=
        ((rain > 0.05 ? 1 : 0) - paintWet) * Math.min(1, dt * (rain > 0.05 ? 0.1 : 0.011));
      setPaintWetness(paintWet);
    }
    const et = game.clock?.elapsed ?? performance.now() / 1000;
    if (et === lastT) return;
    lastT = et;
    const tod = game.timeOfDay ?? 18;
    const night = tod < 6.6 || tod > 18.7;
    const pp = game.player?.position;
    let playerCar = null;
    let sirenBest = null,
      sirenBestD = 1e9;
    let driverBuiltThisFrame = false;
    if (et - lastEvict > 1) {
      lastEvict = et;
      try {
        evictIdleModels();
      } catch (e) {
        /* non-fatal */
      }
    }
    try {
      trafficManager(dt);
    } catch (e) {
      console.error('[traffic]', e);
    }
    let fireBest = null,
      fireBestD = 1e9;
    for (const v of list) {
      const t = v.body.translation(),
        r = v.body.rotation();
      // tires dig ~3.5 cm into loose sand (visual only; the sand is opaque and depth-tested, so the buried part is hidden)
      v.mesh.position.set(t.x, t.y - (v.soft > 0.01 && !v.inWater ? 0.035 * v.soft : 0), t.z);
      v.mesh.quaternion.set(r.x, r.y, r.z, r.w);
      v.speedKmh = Math.abs(v.benchSpeed ?? v.speed) * 3.6; // benchSpeed: the benchmark route drives the car kinematically (no wheel speed)
      {
        const lv = v.body.linvel();
        v.velocity.set(lv.x, lv.y, lv.z);
      }
      if (game.camera) {
        const cd = game.camera.position.distanceTo(v.mesh.position);
        const wd = cd < (v.spec.heavy ? 160 : 70);
        if (wd !== v._wheelDetail) {
          v._wheelDetail = wd;
          for (const w of v.car.wheels) {
            for (const dm of w.detail) dm.visible = wd;
            if (w.lo) w.lo.visible = !wd;
          }
        }
      }
      v.lightsOn = night && !v.disabled && (v.ai || v.playerDriven);
      if (v.flooded) {
        const ft = v.floodT || 0;
        v.lightsOn = ft < 4 && Math.random() < 1 - ft / 4.5;
      }
      if (v.playerDriven) {
        playerCar = v;
        v.everDriven = true;
        v.lastDrivenAt = et;
        lastPlayerCar = v;
        if (v.ai) {
          v.ai = null;
        }
        v.parked = false;
      }
      // visual body roll / pitch from local acceleration (spring-damped for a weighty feel)
      if (dt > 0 && dt < 0.2) {
        const lv = v.body.linvel();
        const bs = (v.bodySway ||= {
          pv: new THREE.Vector3(lv.x, lv.y, lv.z),
          ax: 0,
          az: 0,
          roll: 0,
          rollV: 0,
          pitch: 0,
          pitchV: 0,
        });
        _q.set(r.x, r.y, r.z, r.w).invert();
        _v.set((lv.x - bs.pv.x) / dt, (lv.y - bs.pv.y) / dt, (lv.z - bs.pv.z) / dt).applyQuaternion(
          _q,
        ); // world accel -> local
        bs.pv.set(lv.x, lv.y, lv.z);
        {
          const dv = Math.hypot(_v.x, _v.z, Math.min(0, _v.y + 9.81) * 0.5) * dt; // horizontal-ish velocity change this frame (m/s)
          if (v.ghost || v.frozen) v.hitCd = 0.6; // kinematic/frozen tiers: no impact damage from tier switches
          if (dv > 3.2 && (v.hitCd || 0) <= 0) {
            v.hitCd = 0.25;
            v.lastImpactT = et;
            v.lastImpactDv = dv;
            // impact point: opposite of the acceleration direction, projected to the body box
            _lp.set(-_v.x, 0, -_v.z).normalize();
            const sx = Math.abs(_lp.x) > 1e-3 ? v.spec.W / 2 / Math.abs(_lp.x) : 1e9;
            const sz = Math.abs(_lp.z) > 1e-3 ? v.spec.L / 2 / Math.abs(_lp.z) : 1e9;
            _lp.multiplyScalar(Math.min(sx, sz));
            _lp.y = v.spec.belt * 0.6 - v.groundOff;
            // r2-physics impacts (flag): the dent / scratches / lamps land at the real contact on the body, scaled by the hit
            if (game.physics?.impacts && game.physics.damageAt) {
              applyDamage(v, 2.2 * Math.pow(dv - 3, 1.75) + 4, null);
              try {
                const wp = _lp
                  .clone()
                  .applyQuaternion(_q.set(r.x, r.y, r.z, r.w))
                  .add(_v2.set(t.x, t.y, t.z));
                game.physics.damageAt(v, wp, { speedKmh: dv * 3.6 * 1.3, hardness: 0.85 });
              } catch (e) {
                /* */
              }
            } else applyDamage(v, 2.2 * Math.pow(dv - 3, 1.75) + 4, _lp.clone());
            if (dv > 4.5) {
              const wp = _lp
                .clone()
                .applyQuaternion(_q.set(r.x, r.y, r.z, r.w))
                .add(_v2.set(t.x, t.y, t.z));
              game.emit?.('crash', { vehicle: v, impulse: dv * v.spec.mass, point: wp });
              game.fx?.sparks?.(wp, _v2.set(0, 1, 0));
              if (v.playerDriven && impactCooldown <= 0) {
                if (game.audio?.play)
                  game.audio.play('car_crash', {
                    position: wp,
                    volume: Math.min(1, (dv - 4) / 10),
                  });
                else playImpact(Math.min(1, (dv - 4.5) / 10));
                impactCooldown = 0.35;
              }
            }
          } else if (
            dv > 0.9 &&
            Math.abs(v.speed) > 4 &&
            (v.scrapeCd || 0) <= 0 &&
            pp &&
            distXZ(t, pp) < 80
          ) {
            // scraping along a wall / another car: sparks at the contact side
            v.scrapeCd = 0.06;
            _lp.set(-_v.x, 0, -_v.z).normalize();
            const sx = Math.abs(_lp.x) > 1e-3 ? v.spec.W / 2 / Math.abs(_lp.x) : 1e9;
            const sz = Math.abs(_lp.z) > 1e-3 ? v.spec.L / 2 / Math.abs(_lp.z) : 1e9;
            _lp.multiplyScalar(Math.min(sx, sz));
            _lp.y = v.spec.yb + 0.25 - v.groundOff;
            const wp = _lp
              .clone()
              .applyQuaternion(_q.set(r.x, r.y, r.z, r.w))
              .add(_v2.set(t.x, t.y, t.z));
            game.fx?.sparks?.(wp, _lp.clone().applyQuaternion(_q).negate().normalize());
          }
          v.scrapeCd = (v.scrapeCd || 0) - dt;
          v.hitCd = (v.hitCd || 0) - dt;
        }
        const k = Math.min(1, dt * 8);
        bs.ax += (clamp(_v.x, -30, 30) - bs.ax) * k;
        bs.az += (clamp(_v.z, -30, 30) - bs.az) * k;
        // carphys 2: the chassis itself pitches and rolls on its springs, so the fake shell sway is off
        const swayK = v.vc?.isShapeVehicle ? 0 : 1;
        const rollK = (v.spec.rollK || 1) * swayK;
        const tRoll = clamp(bs.ax * 0.0065 * rollK, -0.075 * rollK, 0.075 * rollK);
        const tPitch = swayK * clamp(-bs.az * 0.0042, -0.05, 0.05);
        bs.rollV += ((tRoll - bs.roll) * 70 - bs.rollV * 11) * dt;
        bs.pitchV += ((tPitch - bs.pitch) * 60 - bs.pitchV * 10) * dt;
        bs.roll += bs.rollV * dt;
        bs.pitch += bs.pitchV * dt;
        v.car.shell.rotation.set(bs.pitch, 0, bs.roll);
      }
      // wheels
      const vc = v.vc;
      v.car.wheelCapExtra = vc?.isShapeVehicle ? 0.045 : undefined; // r2-physics: carphys 2 bump travel = arch gap + 4.5 cm tuck (glbCar visual cap)
      // far LOD (glb/farLod.js): the wheels are baked into the one far mesh, nothing reads the wheel nodes
      if (vc && !v.car.isFar)
        for (let i = 0; i < 4; i++) {
          const w = v.car.wheels[i];
          // Rapier reports 0 before the car's first physics step: drawn as is, the wheels sat at the body origin, tucked
          // up into the arches, and the far LOD baked them there (the "hovering car with its wheels inside it")
          const raw = vc.wheelSuspensionLength(i);
          const sl = raw > 0.01 ? raw : v.groundOff - v.spec.r;
          w.steer.position.set(w.x, -sl, w.z);
          {
            const sa = vc.wheelSteering(i) || 0,
              sm = v.car.steerMax || 0.7;
            w.steer.rotation.y = sa > sm ? sm : sa < -sm ? -sm : sa;
          } // [car-bodies C1] visual lock limit
          w.spin.rotation.x = vc.wheelRotation(i) || 0;
        }
      if (v.car.steeringWheel) v.car.steeringWheel.rotation.z = -v.steerCur * 7;
      // lights
      const lm = v.car.lightMats;
      lm.head.emissiveIntensity = v.lightsOn ? 7 : v.ai || v.playerDriven ? 0.9 : 0.05;
      const alive = (v.ai || v.playerDriven) && !v.disabled && (!v.flooded || v.lightsOn);
      if (v.flooded && !v.lightsOn) lm.head.emissiveIntensity = 0;
      if (lm.drl) lm.drl.emissiveIntensity = v.headBroken ? 0 : alive ? 6 : 0;
      if (lm.lens) lm.lens.emissiveIntensity = v.headBroken ? 0 : v.lightsOn ? 12 : 0;
      if (lm.tailLed)
        lm.tailLed.emissiveIntensity = v.disabled
          ? 0
          : v.braking && alive
            ? 3.2
            : v.lightsOn
              ? 2.2
              : alive
                ? 1.4
                : 0.2;
      lm.tail.emissiveIntensity = v.disabled
        ? 0
        : v.braking && (v.ai || v.playerDriven)
          ? 1.8
          : v.lightsOn
            ? 0.9
            : 0.15; // [car-bodies] hotter pure red tone-maps to yellow-white
      // exhaust backfire pops when lifting off at high revs (player car)
      if (v.playerDriven && !v.disabled) {
        const thr = v.ctrl.throttle;
        const perf = ['sports', 'super', 'muscle'].includes(v.spec.cls) || v.spec.police === 'bar';
        if (perf && (v.prevThr || 0) > 0.8 && thr < 0.2 && v.speed > 12) v.popT = 0.45;
        if (perf && v.shiftT > 0.18 && Math.random() < 0.3) v.popT = Math.max(v.popT || 0, 0.12);
        v.prevThr = thr;
        if (v.popT > 0) {
          v.popT -= dt;
          if (Math.random() < 0.5) {
            const ex = v.spec.W / 2 - 0.45;
            for (const sx of v.spec.coupe ? [1, -1] : [1]) {
              _spotPos.set(sx * ex, v.spec.yb + 0.1 - v.groundOff, -v.spec.L / 2 - 0.12);
              v.mesh.localToWorld(_spotPos);
              fire.emit(_spotPos, 0, 0, 1);
            }
            if (Math.random() < 0.25)
              game.audio?.play?.('backfire', { position: _spotPos.clone(), volume: 0.4 });
          }
        }
      }
      lm.reverse.emissiveIntensity = v.reversing ? 4 : 0;
      lm.fog.emissiveIntensity = v.lightsOn ? 4 : 0;
      // turn signals: AI announces planned turns; player car blinks while steering hard at low speed; hazards when parked by player
      let bl = 0,
        br = 0;
      const blinkOn = (et * 1.6) % 1 < 0.5 ? 1 : 0;
      if (v.ai && !v.playerDriven && v.ai.next && v.ai.edge && Math.abs(v.ai.next.ang) > 0.45) {
        const sigD =
          v.ai.drv?.type === 'lost' || v.ai.drv?.type === 'distracted'
            ? 12
            : v.ai.drv?.type === 'aggressive'
              ? 18
              : 40; // late signalers
        if (v.ai.edge.len - v.ai.d < sigD) {
          if (v.ai.next.ang > 0) bl = blinkOn;
          else br = blinkOn;
        }
      } else if (v.ai && !v.playerDriven && v.ai.signal) {
        if (v.ai.signal > 0) bl = blinkOn;
        else br = blinkOn;
      } else if (v.playerDriven && Math.abs(v.ctrl.steer) > 0.5 && Math.abs(v.speed) < 8) {
        if (v.ctrl.steer > 0) bl = blinkOn;
        else br = blinkOn;
      }
      lm.blinkL.emissiveIntensity = bl * 6;
      lm.blinkR.emissiveIntensity = br * 6;
      v.car.pool.visible = v.lightsOn && !v.headBroken;
      v.car.tailPool.visible = v.lightsOn || (v.braking && (v.ai || v.playerDriven) && night);
      v.sirenActive =
        v.police && !v.disabled && (!!v.sirenOn || (!v.playerDriven && !!v.ai && !!v.chaseTarget));
      if (v.sirenActive && pp) {
        const d = distXZ(t, pp);
        if (d < sirenBestD) {
          sirenBestD = d;
          sirenBest = v;
        }
      }
      if (v.spec.police) {
        const ph = (et * 2.6) % 1;
        const strobe = (x) => (x < 0.1 || (x > 0.18 && x < 0.28) ? 1 : 0);
        lm.red.emissiveIntensity = v.sirenActive ? 10 * strobe(ph) + 0.2 : 0.15;
        lm.blue.emissiveIntensity = v.sirenActive ? 10 * strobe((ph + 0.5) % 1) + 0.2 : 0.15;
      }
      if (v.spec.taxi || v.spec.busLivery) lm.sign.emissiveIntensity = night ? 2.5 : 0.8;
      // skid marks
      let skidAmt = 0;
      if (vc && pp && distXZ(t, pp) < 140 && !v.body.isSleeping()) {
        const lv = v.body.linvel();
        _q.set(r.x, r.y, r.z, r.w);
        _rt.set(1, 0, 0).applyQuaternion(_q);
        const lat = Math.abs(lv.x * _rt.x + lv.y * _rt.y + lv.z * _rt.z);
        const aspd = Math.abs(v.speed);
        const c = v.ctrl;
        const drv = v.playerDriven || v.ai;
        for (let i = 0; i < 4; i++) {
          const front = i < 2;
          let s = Math.max(0, (lat - 2.6) / 4);
          if (drv && v.braking && aspd > 9) s = Math.max(s, front ? 0.35 : 0.3);
          if (drv && c.handbrake && aspd > 4 && !front) s = Math.max(s, 0.6);
          if (drv && c.throttle > 0.9 && aspd < 8 && v.spec.drive === 'rwd' && !front)
            s = Math.max(s, 0.55);
          const key = v.name + i;
          if (s > 0.05 && vc.wheelIsInContact(i)) {
            const cp = vc.wheelContactPoint(i);
            if (cp) {
              skids.add(key, cp, _rt.x, _rt.z, v.spec.tw * 0.9, 0.25 + s);
              const sm = (v.smokeAcc =
                (v.smokeAcc || 0) + dt * (s > 0.3 ? 40 * Math.min(1.5, s) : 0));
              if (sm >= 1) {
                v.smokeAcc = 0;
                if (game.fx?.tireSmoke) game.fx.tireSmoke(new THREE.Vector3(cp.x, cp.y, cp.z));
                else smoke.emit(cp, lv.x, lv.z, s);
              }
            }
            skidAmt = Math.max(skidAmt, s);
          } else skids.end(key);
        }
      }
      if (v.playerDriven) screech.set(Math.min(1, skidAmt), Math.abs(v.speed));
      // driver: created lazily near the player (at most one per frame); hidden when far
      if (
        !v.driver &&
        v.ai &&
        !v.disabled &&
        !v.flooded &&
        !driverBuiltThisFrame &&
        pp &&
        distXZ(t, pp) < 60
      ) {
        addDriver(v);
        driverBuiltThisFrame = true;
      }
      if (v.driver) {
        if (v.playerDriven) {
          // nobody carjacked properly: the driver bails out and runs
          const ep = v.ejectDriver();
          game.peds?.spawnAt?.(ep, { state: 'flee' });
        } else {
          // behind the far LOD's opaque glass nobody is seen: no skinned draws, no animation update
          const near = (pp ? distXZ(t, pp) < 70 : true) && !v.car.isFar;
          v.driver.visible = near;
          if (near) v.driverChar.update?.(dt, { driving: true, speed: 0, grounded: true });
          for (const pc of v.passengerChars || []) {
            pc.root.visible = near;
            if (near) pc.update?.(dt, { driving: true, speed: 0, grounded: true });
          }
        }
      }
      // burning wreck
      if (v.disabled && (v.burnT = (v.burnT ?? 25) - dt) > 0 && pp && distXZ(t, pp) < 150) {
        v.fireAcc = (v.fireAcc || 0) + dt * 45;
        while (v.fireAcc >= 1) {
          v.fireAcc -= 1;
          _spotPos.set(
            (Math.random() - 0.5) * v.spec.W * 0.6,
            v.spec.belt - v.groundOff,
            v.spec.L / 2 - 0.6 - Math.random() * 1.2,
          );
          v.mesh.localToWorld(_spotPos);
          fire.emit(_spotPos, 0, 0, 1);
        }
        const d = distXZ(t, pp);
        if (d < fireBestD) {
          fireBestD = d;
          fireBest = v;
        }
      }
      // exhaust: faint idle smoke / heat puffs, harder on throttle
      if (!v.disabled && (v.playerDriven || v.ai) && pp && distXZ(t, pp) < 35) {
        v.exAcc =
          (v.exAcc || 0) +
          dt * (Math.abs(v.speed) < 2 ? 2.5 + v.throttle * 10 : v.throttle > 0.8 ? 3 : 0);
        if (v.exAcc >= 1) {
          v.exAcc = 0;
          _spotPos.set(v.spec.W / 2 - 0.45, v.spec.yb + 0.1 - v.groundOff, -v.spec.L / 2 - 0.15);
          v.mesh.localToWorld(_spotPos);
          exhaust.emit(_spotPos, 0, 0, 0.2);
        }
      }
      // smoking engine when badly damaged
      if (v.health < 300) {
        v.smokeT = (v.smokeT || 0) - dt;
        if (v.smokeT <= 0 && pp && distXZ(t, pp) < 120) {
          v.smokeT = v.health <= 0 ? 0.08 : 0.25;
          _spotPos.set(0, v.spec.belt - v.groundOff + 0.1, v.spec.L / 2 - 0.7);
          v.mesh.localToWorld(_spotPos);
          if (game.fx?.smoke) game.fx.smoke(_spotPos.clone());
          else smoke.emit(_spotPos, 0, 0, 0.8);
        }
      }
      // pedestrian hits
      if (Math.abs(v.speed) > 1.4 && game.peds?.list?.length) hitPeds(v, t, r); // user: drove straight through people (was > 5.5 m/s = 20 km/h); damage scales with speed
    }
    sirenAudio(playerCar && playerCar.sirenActive && !game.audio?.play);
    // police light bar point lights on the nearest active siren
    if (sirenBest && sirenBestD < 90) {
      const m = sirenBest.mesh,
        sp = sirenBest.spec;
      const ph = (et * 2.6) % 1;
      const zb = (sp.zB + sp.zC) / 2 + 0.1,
        y = sp.roofY + 0.3 - sirenBest.groundOff;
      _spotPos.set(0.5, y, zb);
      m.localToWorld(_spotPos);
      copRed.position.copy(_spotPos);
      _spotPos.set(-0.5, y, zb);
      m.localToWorld(_spotPos);
      copBlue.position.copy(_spotPos);
      copRed.intensity = ph < 0.5 ? 40 : 0;
      copBlue.intensity = ph >= 0.5 ? 40 : 0;
    } else {
      copRed.intensity = 0;
      copBlue.intensity = 0;
    }
    skids.flush();
    smoke.update(dt);
    {
      // smoke is unlit: dim it with the time of day
      const day = clamp(1 - Math.abs(tod - 13) / 7, 0, 1);
      const b = 0.22 + 0.63 * Math.min(1, day * 1.6);
      smoke.points.material.uniforms.color.value.setRGB(b, b * 0.98, b * 0.95);
    }
    fire.update(dt);
    shards.update(dt);
    exhaust.update(dt);
    if (fireBest) {
      _spotPos.set(0, fireBest.spec.belt - fireBest.groundOff + 0.6, fireBest.spec.L / 2 - 1);
      fireBest.mesh.localToWorld(_spotPos);
      fireLight.position.copy(_spotPos);
      fireLight.intensity = 25 + Math.sin(et * 23) * 6 + Math.sin(et * 37) * 5;
    } else fireLight.intensity = 0;
    impactCooldown -= dt;
    if (!playerCar) screech.set(0, 0);
    // player's headlight spot
    if (playerCar && night && !playerCar.disabled && !playerCar.headBroken) {
      const m = playerCar.mesh;
      _spotPos.set(0, 0.1, playerCar.spec.L / 2 + 0.2);
      m.localToWorld(_spotPos);
      spot.position.copy(_spotPos);
      spot2.position.copy(_spotPos);
      _spotPos.set(0, -1.2, 30);
      m.localToWorld(_spotPos);
      spot.target.position.copy(_spotPos);
      _spotPos.set(0, -1.5, 10);
      m.localToWorld(_spotPos);
      spot2.target.position.copy(_spotPos);
      spot.intensity = 320;
      spot2.intensity = 60;
    } else {
      spot.intensity = 0;
      spot2.intensity = 0;
    }
  }
  game.updaters?.push(update);

  const _pl = new THREE.Vector3();
  function hitPeds(v, t, r) {
    _q.set(r.x, r.y, r.z, r.w).invert();
    const spec = v.spec;
    // crowd-tier walkers (people.v2 far crowd) had no hit test: one just ahead of the bumper becomes a full person and is hit
    try {
      const C = game.people?.crowd;
      if (C?.hitAt && game.peds?.spawnAt) {
        const sg = v.speed >= 0 ? 1 : -1,
          fq = new THREE.Quaternion(r.x, r.y, r.z, r.w);
        const f = new THREE.Vector3(0, 0, sg * (spec.L / 2 + 0.3)).applyQuaternion(fq),
          w = C.hitAt(t.x + f.x, t.z + f.z, spec.W / 2 + 0.4);
        if (w) {
          const ped = game.peds.spawnAt(new THREE.Vector3(w.x, w.y, w.z), { heading: w.heading });
          if (ped) ped._carHitT = 0;
        }
      }
    } catch (e) {
      /* crowd optional */
    }
    for (const ped of game.peds.list) {
      if (!ped || ped.dead) continue;
      const pp = ped.pos || ped.root?.position;
      if (!pp) continue;
      const dx = pp.x - t.x,
        dz = pp.z - t.z;
      if (dx * dx + dz * dz > 25) continue;
      if (Math.abs((pp.y ?? 0) - (t.y - v.groundOff)) > 1.5) continue;
      _pl.set(dx, 0, dz).applyQuaternion(_q);
      const ahead = 0.45 + Math.min(1.2, Math.abs(v.speed) * 0.07);
      if (
        Math.abs(_pl.x) > spec.W / 2 + 0.35 ||
        _pl.z > spec.L / 2 + (v.speed > 0 ? ahead : 0.45) ||
        _pl.z < -spec.L / 2 - (v.speed < 0 ? ahead : 0.45)
      )
        continue;
      const now = game.clock?.elapsed ?? 0;
      if (ped._carHitT && now - ped._carHitT < 1.2) continue;
      ped._carHitT = now;
      const lv = v.body.linvel();
      const kmh = Math.abs(v.speed) * 3.6;
      const dir = new THREE.Vector3(lv.x, 0.35 * Math.hypot(lv.x, lv.z), lv.z).normalize();
      game.peds.damage?.(ped, kmh * 1.5, dir, 'car');
      const point = new THREE.Vector3(pp.x, (pp.y ?? 0) + 1, pp.z);
      game.emit?.('hit', {
        target: 'ped',
        object: ped,
        point,
        normal: dir.clone().negate(),
        damage: kmh * 1.5,
        kind: 'car',
      });
      if (v.playerDriven)
        game.emit?.('crime', {
          type: 'hit_pedestrian',
          position: point.clone(),
          severity: kmh > 50 ? 3 : 2,
          witnessed: true,
        });
      applyDamage(v, 15, null);
    }
  }

  // ------------------------------------------------------------ events: locked cars, gunshots
  const _shot = new THREE.Vector3();
  if (game.on) {
    game.on('enterVehicle', (e) => {
      const v = e?.vehicle;
      if (!v || !v.locked || v.breakingIn || v.playerOwned) return;
      v.breakingIn = true;
      if (!v.engineOn) v.needsHotwire = true; // no key: wired under the column once inside
      game.audio?.play?.('glass', { position: v.mesh.position.clone(), volume: 0.9 });
      breakGlass(v);
      game.emit?.('crime', {
        type: 'vehicle_theft',
        position: v.mesh.position.clone(),
        severity: 1,
      });
      game.hud?.notify?.('Breaking in...', 1200);
      setTimeout(() => {
        v.locked = false;
        v.breakingIn = false;
        const pp = game.player?.position;
        if (pp && !game.player.state?.inVehicle && distXZ(v.body.translation(), pp) < 6)
          game.enterVehicle?.(v);
      }, 1200);
      return false;
    });
    game.on('shot', (e) => {
      const o = e?.origin;
      if (!o) return;
      for (const v of list) {
        if (!v.ai || v.chaseTarget || v.playerDriven) continue;
        if (distXZ(v.body.translation(), o) < 70) v.ai.fleeT = 10 + Math.random() * 5;
      }
    });
  }

  // release everything this car owns (shared/cached geometry and materials stay)
  function disposeCar(v) {
    removeDriver(v);
    v.mesh.traverse((o) => {
      if (o.isMesh && o.userData.ownGeo) {
        o.geometry.dispose();
        o.userData.ownGeo = false;
        noteOwnGeoFreed();
      }
    });
    unregisterLook(v);
    try {
      v.car.dispose?.();
    } catch (e) {
      /* per-car materials */
    }
    releaseCar(v.car); // model GPU buffers freed once no car of this model remains (after a grace period)
    for (const k in v.car.lightMats) v.car.lightMats[k].dispose();
    if (v.burntMat) v.burntMat.dispose();
  }
  function dropVehicle(v) {
    disposeCar(v);
    const i = list.indexOf(v);
    if (i >= 0) list.splice(i, 1);
    v.alive = false;
    v.disposed = true;
    if (v.vc) {
      try {
        world.removeVehicleController(v.vc);
      } catch (e) {
        /* ignore */
      }
      v.vc = null;
    }
    scene.remove(v.mesh);
    console.warn(
      '[vehicles] chassis body vanished (removed externally?) - vehicle dropped:',
      v.name,
    );
  }
  // game.vehicles.remove(v, { force }) for other systems: the player's last car, and any car he drove in the last 10 min while it
  // is within 250 m or on screen, stays where he left it (house lots, police, gang and job cleanups used to delete it the moment
  // he got out).  Garage-managed cars (property.js: v.owned) and force: true bypass the guard.  Returns false when kept.
  function removeGuarded(v, opts = {}) {
    if (v && !opts.force && v.everDriven && !v.owned && !v.ownedId && !v.disabled) {
      if (v === lastPlayerCar) return false;
      const et = game.clock?.elapsed ?? 0,
        pp = game.player?.position;
      if (et - (v.lastDrivenAt ?? -1e9) < 600) {
        try {
          const t = v.body.translation();
          if (!pp || distXZ(t, pp) < 250 || inView(t)) return false;
        } catch (e) {
          return false;
        }
      }
    }
    return removeVehicle(v);
  }
  function removeVehicle(v) {
    const i = list.indexOf(v);
    if (i < 0 || v.playerDriven) return false;
    list.splice(i, 1);
    v.alive = false;
    v.disposed = true;
    try {
      city?.unregisterAnchor?.(v);
    } catch (e) {
      /* */
    }
    disposeCar(v);
    for (let k = 0; k < 4; k++) skids.end(v.name + k);
    scene.remove(v.mesh);
    if (v.vc) {
      try {
        world.removeVehicleController(v.vc);
      } catch (e) {
        /* ignore */
      }
      v.vc = null;
    }
    let t0 = { x: 0, y: 0, z: 0 },
      r0 = { x: 0, y: 0, z: 0, w: 1 };
    try {
      const a = v.body.translation(),
        b = v.body.rotation();
      t0 = { x: a.x, y: a.y, z: a.z };
      r0 = { x: b.x, y: b.y, z: b.z, w: b.w };
    } catch (e) {
      /* */
    }
    try {
      world.removeRigidBody(v.body);
    } catch (e) {
      /* ignore */
    }
    // other systems may still hold this car (pending impacts, prop hits, traffic, police): calling a freed Rapier body is a Rust
    // panic that poisons the whole physics world, so the car keeps a harmless stand-in (last pose, zero motion, no-op setters)
    v.body = deadBody(t0, r0);
    return true;
  }
  function deadBody(t, r) {
    const Z = { x: 0, y: 0, z: 0 };
    const known = {
      translation: () => ({ ...t }),
      rotation: () => ({ ...r }),
      linvel: () => ({ ...Z }),
      angvel: () => ({ ...Z }),
      mass: () => 0,
      isValid: () => false,
      isSleeping: () => true,
      isEnabled: () => false,
      numColliders: () => 0,
      bodyType: () => 1,
      isFixed: () => true,
      isDynamic: () => false,
      isKinematic: () => false,
    };
    return new Proxy(
      { dead: true, handle: -1 },
      {
        get: (o, k) =>
          k in o
            ? o[k]
            : k in known
              ? known[k]
              : typeof k === 'string'
                ? () => undefined
                : undefined,
      },
    );
  }

  function spawnVehicle(type = 'sedan', pos, heading = 0, opts = {}) {
    // non-car kinds registered by other tracks: 'boat:skiff', 'aircraft:heli', 'scooter', ...
    const routed = kindReg.route(type);
    if (routed && typeof routed[0].spawn === 'function') {
      try {
        return routed[0].spawn(routed[1], pos, heading, opts);
      } catch (e) {
        console.error('[vehicles] kind spawn', type, e);
        return null;
      }
    }
    const key = CAR_TYPES[type]
      ? type
      : CLASSES[type]
        ? fromClass(type)
        : opts.police
          ? 'police'
          : 'sedan';
    const color = opts.color ?? null;
    let p = pos || game.player?.position || new THREE.Vector3();
    if (opts.snap !== false) {
      // snap onto the nearest lane so we never spawn inside a building
      let best = null,
        bd = 1e9;
      for (const e of net.near(p.x, p.z, 60)) {
        const pr = project(e, p.x, p.z);
        if (pr.dist < bd) {
          bd = pr.dist;
          best = { e, pr };
        }
      }
      if (best && bd > best.e.width / 2 - 1) {
        const e = best.e,
          sd = sampleEdge(e, best.pr.s, {});
        let dir = Math.sin(heading) * sd.dx + Math.cos(heading) * sd.dz >= 0 ? 1 : -1;
        if (laneCount(e, dir) <= 0) dir = -dir;
        const lp = lanePointAt(
          e,
          dir,
          dir > 0 ? best.pr.s : e.len - best.pr.s,
          laneOffset(e, dir, 0),
        );
        p = new THREE.Vector3(lp.x, groundY(lp.x, lp.z, lp.y), lp.z);
        heading = Math.atan2(lp.fx, lp.fz);
      }
    }
    spotQ.ms = 0; // explicit API spawns (police, missions) are never refused by the per-frame query budget
    if (opts.snap !== false && !spotFree(p, heading, CAR_TYPES[key])) {
      const alt = randomLanePos(p, 0, 45, false, 40, CAR_TYPES[key]);
      if (alt) {
        p = alt.pos;
        heading = alt.heading;
      }
    }
    if (!isBuilt(key, 'base')) prebuild(key, 'base'); // API spawns may need a cold build (rare models)
    const v = createVehicle(key, color, p, heading, {
      ai: !!opts.ai,
      police: !!opts.police || key === 'police',
      external: true,
    });
    return v;
  }

  function nearest(pos, maxDist = 6) {
    let best = null,
      bd = maxDist;
    for (const v of list) {
      if (v.disabled) continue;
      const t = v.body.translation();
      const d = Math.hypot(t.x - pos.x, t.y - v.groundOff - (pos.y || 0), t.z - pos.z);
      if (d < bd) {
        bd = d;
        best = v;
      }
    }
    return best;
  }

  // ---- boats (own physics; share nearest()/enter/exit through this API)
  let boatSys = null;
  try {
    boatSys = createBoats(game);
  } catch (e) {
    console.error('[vehicles] boats', e);
  }

  // ---- warm-up: compile every vehicle material variant and upload every texture now (loading screen), so
  // entering a car / seeing LOD0 / first skid or smoke never compiles shaders mid-game.
  async function warmup() {
    const r = game.renderer,
      cam = game.camera;
    if (!r || !cam) return;
    const restore = [];
    const show = (o) => {
      if (!o.visible) {
        restore.push(o);
        o.visible = true;
      }
    };
    for (const v of list) {
      for (const lvl of v.car.lod.levels) {
        show(lvl.object);
        lvl.object.traverse(show);
      }
      for (const w of v.car.wheels) {
        for (const d of w.detail) show(d);
        if (w.lo) show(w.lo);
      }
      show(v.car.pool);
      show(v.car.tailPool);
    }
    const ranges = [];
    for (const o of [skids.mesh, smoke.points, fire.points, exhaust.points, shards.points]) {
      if (o?.geometry) {
        ranges.push([o.geometry, o.geometry.drawRange.count]);
        o.geometry.setDrawRange(0, Infinity);
      }
    }
    // also the broken-glass material (used when windows shatter)
    const probe = new THREE.Mesh(new THREE.PlaneGeometry(0.01, 0.01), brokenGlassMat());
    probe.position.copy(cam.position);
    scene.add(probe);
    try {
      // stage 1 boot pacing: compiled per car / effect in short slices for the HDR target the game draws into (the old
      // whole-scene compile ran in one long task and for the canvas, a variant never drawn), textures uploaded one per slice
      const objs = list
        .map((v) => v.mesh)
        .concat([skids.mesh, smoke.points, fire.points, exhaust.points, shards.points, probe]);
      await compileSliced(r, THREE, objs, cam, scene);
      const tex = new Set();
      scene.traverse((o) => {
        const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
        for (const m of mats)
          for (const k of ['map', 'emissiveMap', 'normalMap', 'roughnessMap'])
            if (m[k]?.isTexture) tex.add(m[k]);
      });
      await initTexturesSliced(r, tex);
    } catch (e) {
      console.warn('[vehicles] warmup', e);
    }
    scene.remove(probe);
    for (const o of restore) o.visible = false;
    for (const [g, c] of ranges) g.setDrawRange(0, c);
  }
  try {
    await warmup();
  } catch (e) {
    /* non-fatal */
  }

  const carNearest = nearest;
  function nearestAny(pos, maxDist = 6) {
    const cb = nearestCarOrBoat(pos, maxDist);
    const k = kindReg.nearest(pos, maxDist);
    if (!k) return cb;
    if (!cb) return k.vehicle;
    const t = cb.body.translation(),
      d = Math.hypot(t.x - pos.x, t.y - (cb.groundOff || 0) - (pos.y || 0), t.z - pos.z);
    return k.dist < d ? k.vehicle : cb;
  }
  function nearestCarOrBoat(pos, maxDist = 6) {
    const c = carNearest(pos, maxDist);
    const b = kindReg.has('boat') ? null : boatSys?.nearest(pos, maxDist);
    if (!b) return c;
    if (!c) return b;
    // a boat is long: compare the distance to its hull outline with the car's (centre) distance
    const ct = c.body.translation(),
      cd = Math.hypot(ct.x - pos.x, ct.y - c.groundOff - (pos.y || 0), ct.z - pos.z);
    const bd = boatSys.hullDist
      ? boatSys.hullDist(b, pos)
      : Math.hypot(b.body.translation().x - pos.x, b.body.translation().z - pos.z);
    return bd <= cd ? b : c;
  }
  const updateAll = (dt) => {
    update(dt);
    try {
      if (!kindReg.has('boat')) boatSys?.update(dt);
    } catch (e) {
      console.error('[boats]', e);
    }
    kindReg.update(dt);
  };
  // ---- registration hooks (see src/vehicles/README.md)
  function registerModel(entry, builder) {
    const n = addExternalModel(entry, builder);
    const prevCls = CAR_TYPES[entry.key]?.cls;
    CAR_TYPES[entry.key] = n.spec;
    MODELS[entry.key] = n.model;
    if (prevCls && CLASSES[prevCls]) {
      const i = CLASSES[prevCls].indexOf(entry.key);
      if (i >= 0) CLASSES[prevCls].splice(i, 1);
    }
    // hero / rare models stay out of the random class pools; they spawn through their own spawn rules
    const pool = entry.pool ?? (n.model.hero ? 'hero' : n.spec.cls);
    (CLASSES[pool] ||= []).includes(entry.key) || CLASSES[pool].push(entry.key);
    if (!ALL_KEYS.includes(entry.key)) ALL_KEYS.push(entry.key);
    game.emit?.('vehicle:modelRegistered', { key: entry.key, model: n.model, spec: n.spec });
    return n.model;
  }
  function registerKind(kind, impl) {
    const k = kindReg.register(kind, impl);
    game.emit?.('vehicle:kindRegistered', { kind, impl: k });
    return k;
  }
  // hero cars: src/vehicles/hero/index.js may export `register(vehiclesApi)` or `models = [{ entry, builder }]`
  const apiEarly = { registerModel, registerKind };
  try {
    const heroMods = import.meta.glob('./hero/index.js');
    for (const k of Object.keys(heroMods)) {
      heroMods[k]()
        .then((m) => {
          try {
            if (typeof m.register === 'function') m.register(api);
            else for (const it of m.models || m.default || []) registerModel(it.entry, it.builder);
          } catch (e) {
            console.error('[vehicles] hero registration failed', e);
          }
        })
        .catch((e) => console.error('[vehicles] hero module failed to load', e));
    }
  } catch (e) {
    /* no glob support (plain esbuild check) */
  }
  // r2-physics: switch car physics at runtime (A/B in one session): rebuilds every live controller
  (game.physics ||= {}).setCarPhysics = (n) => {
    game.physics.carphys = n === 2 ? 2 : 1;
    for (const v of list) {
      if (!v.vc || v.ghost || v.frozen) continue;
      try {
        world.removeVehicleController(v.vc);
      } catch (e) {
        /* */
      }
      v.vc = makeController(v.body, v.car.wheels, v.spec, v.restLen, v.stiff);
      v.bodySway = null;
    }
    return game.physics.carphys;
  };
  const api = {
    ...apiEarly,
    lookAudit,
    trafficStats: () => driverStats.report(),
    resetTrafficStats: () => driverStats.reset(),
    trafficDebug,
    liveLooks: () => liveReg.vis.size,
    lookStats,
    kinds: kindReg.kinds,
    kind: (k) => kindReg.get(k),
    all: () => [...list, ...(kindReg.has('boat') ? [] : boatSys?.list || []), ...kindReg.all()],
    models: MODELS,
    types: CAR_TYPES,
    classes: CLASSES,
    modelKeys: () => ALL_KEYS.slice(),
    externalModelKeys,
    list,
    nearest: nearestAny,
    update: updateAll,
    boats: boatSys?.list || [],
    spawnBoat: boatSys?.spawn,
    removeBoat: boatSys?.remove,
    boatNav: boatSys?.nav,
    boatBoarding: boatSys?.boarding || null,
    warmup,
    spawn: spawnVehicle,
    spawnParked,
    placeStatic,
    fleet,
    nicoCars,
    seatAnchor,
    seatWorld,
    addDriver,
    removeDriver,
    placeVehicle,
    addNoParkZone,
    remove: removeGuarded,
    sweepStats: () => sweepStats,
    respawn: respawnAI,
    get respawnCount() {
      return respawnCount;
    },
    gpuStats: modelGpuStats,
  };
  return api;
}
