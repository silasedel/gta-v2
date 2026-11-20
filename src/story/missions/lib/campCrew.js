// The gang at the swamp camp (storyboard panels 10-11): armed members who stand their posts until they notice Nico,
// then the whole camp fights. Sneak (stay out of their sight, keep low and slow, quiet kills) or go loud.
//
//   const crew = createCampCrew(ctx, { name: 'crew', posts, kit });
//   crew.update(dt)        every frame of the camp steps (perception, alert, gunfire)
//   crew.alerted           true once anyone raised the alarm
//   crew.alive()           members still standing
//   crew.alert(why)        put the camp on alert from the mission (a scripted moment)
//
// Members are crowd people (game.peds, the user's swamp poachers in their own clothes and gang people in the Sawgrass
// kit), each with a pistol in the right hand. Everything they get (the gun model, the pin) is released by ctx cleanup.
import * as THREE from 'three';
import { pedOut, release, keepFighting, applyKit } from '../../../jobs/kit.js';
import { buildWeaponModel } from '../../../gameplay/gunModels.js';

const SAWGRASS_KIT = {
  top: [0x4a5a3a, 0x6b5a3e, 0x2f3a2a, 0x5c4a36],
  bottom: [0x3a3226, 0x2e3440, 0x4b4232],
  shoes: [0x2a2018, 0x111111],
  hats: ['capBack', 'beanie', 'cap'],
  chain: 0.2,
};

const SIGHT_DAY = 26; // m a member sees Nico in the open at a normal pace
const SIGHT_NEAR = 4.5; // m he notices him from any side
const FOV = 2.1; // rad, the forward cone
const NOTICE_S = 1.1; // seconds of clear view at mid range before the alarm (faster up close)
const SHOT_HEAR = 70; // m an unsuppressed shot carries
const FIRE_RANGE = 48;

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _d = new THREE.Vector3();

export function createCampCrew(ctx, opts) {
  const game = ctx.game;
  const P = game.player;
  const name = opts.name || 'crew';
  const members = [];
  ctx.h[name] = [];
  let alerted = false;
  let suspicion = 0;

  for (let i = 0; i < opts.posts.length; i++) addMember(opts.posts[i], i);

  // a member at his post: { x, z, face (heading), poacher?, gun? }
  function addMember(post, i) {
    const y = game.city?.groundHeightAt?.(post.x, post.z) ?? 0;
    const pos = new THREE.Vector3(post.x, y, post.z);
    const outfit = post.poacher ? 'poacher' : 'gang';
    const p = game.peds?.spawnAt?.(pos, { outfit, pin: true });
    if (!p) return;
    if (!post.poacher) applyKit(game, p, opts.kit || SAWGRASS_KIT, 31 + i * 7);
    p.pinned = 1e9;
    p.health = post.health ?? 90;
    p.v21 = { story: ctx.mission?.id || 'intro2.swamp', gang: true };
    holdPost(p, post);
    const m = { p, post, sus: 0, fireCd: 1 + Math.random(), gun: null, dead: false };
    giveGun(m, post.gun || (i % 3 === 2 ? 'revolver' : 'pistol'));
    members.push(m);
    ctx.h[name].push(p);
    ctx.track(m, () => releaseMember(m));
  }

  // stand still at the post, facing `face` (the ped's talk state with a one-man group looking at a point ahead)
  function holdPost(p, post) {
    const face = post.face ?? 0;
    const center = new THREE.Vector3(
      post.x + Math.sin(face) * 3,
      p.pos.y,
      post.z + Math.cos(face) * 3,
    );
    p.heading = face;
    p.state = 'talk';
    p.act = 'talk';
    p.nav = null;
    p.stateT = 1e9;
    p.styleT = 2 + Math.random() * 3;
    p.group = { members: [p], center, props: [], talk: !!post.talk, spk: 0, spkT: 3 };
    if (post.talk && opts.groups?.[post.talk]) {
      // members with the same talk key share one conversation (around the fire)
      const g = opts.groups[post.talk];
      g.members.push(p);
      p.group = g;
    }
  }

  function giveGun(m, kind) {
    const hand = m.p.char?.getBone?.('RightHand');
    if (!hand) return;
    try {
      const g = buildWeaponModel(kind, { procedural: true, wear: 0.9 });
      hand.add(g);
      hand.updateWorldMatrix(true, false);
      const ws = hand.getWorldScale(_a);
      const k = 1 / Math.max(1e-3, ws.x);
      g.scale.setScalar(k);
      // grip in the palm, barrel along the fingers (Mixamo right hand: +Y runs to the fingers)
      g.position.set(-0.02 * k, 0.09 * k, 0.03 * k);
      g.rotation.set(-Math.PI / 2, 0, Math.PI / 2);
      m.gun = g;
    } catch (e) {
      console.warn('[campCrew] gun', e);
    }
  }

  function releaseMember(m) {
    if (m.gun) {
      m.gun.parent?.remove(m.gun);
      m.gun = null;
    }
    const p = m.p;
    if (p?.group && p.group.members) {
      const k = p.group.members.indexOf(p);
      if (k >= 0) p.group.members.splice(k, 1);
    }
    if (p) p.group = null;
    release(p);
  }

  // ---------------------------------------------------------------- perception
  // how much a member sees Nico right now (0..1): range shrinks when he is slow / crouched, in tall grass, at dusk
  function seeing(m) {
    const p = m.p;
    const pp = P.position;
    const dx = pp.x - p.pos.x;
    const dz = pp.z - p.pos.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    let range = SIGHT_DAY;
    const speed = P.state?.speed || 0;
    if (P.state?.crouch || P.state?.crouching || speed < 1.6) range *= 0.55;
    else if (P.state?.sprint || speed > 5) range *= 1.2;
    if (opts.cover?.(pp.x, pp.z)) range *= 0.6;
    const hour = game.timeOfDay ?? 12;
    if (hour > 19.5 || hour < 6) range *= 0.7;
    if (d > range) return 0;
    if (d > SIGHT_NEAR) {
      const a = Math.atan2(dx, dz) - p.heading;
      const off = Math.abs(Math.atan2(Math.sin(a), Math.cos(a)));
      if (off > FOV / 2) return 0;
    }
    if (!lineOfSight(p.pos, pp)) return 0;
    return 1 - d / range;
  }

  // static colliders only (shacks, trunks) block the view
  function lineOfSight(a, b) {
    const W = game.world;
    const R = game.RAPIER;
    if (!W || !R) return true;
    _a.set(a.x, a.y + 1.6, a.z);
    _b.set(b.x, b.y + 1.2, b.z);
    _d.subVectors(_b, _a);
    const len = _d.length();
    if (len < 0.5) return true;
    _d.multiplyScalar(1 / len);
    try {
      const QF = R.QueryFilterFlags;
      const flags = QF.EXCLUDE_DYNAMIC | QF.EXCLUDE_KINEMATIC | QF.EXCLUDE_SENSORS;
      const ray = new R.Ray(_a, _d);
      const hit = W.castRay(ray, len - 0.6, true, flags);
      return !hit;
    } catch (e) {
      return true;
    }
  }

  function alert(why) {
    if (alerted) return;
    alerted = true;
    suspicion = 1;
    opts.onAlert?.(why);
    for (const m of members) {
      if (m.dead) continue;
      m.p.group = null;
      m.fireCd = 0.4 + Math.random() * 1.2;
      keepFighting(m.p);
    }
  }

  // ---------------------------------------------------------------- gunfire
  function shoot(m, d) {
    const p = m.p;
    const G = game.gameplay?.G;
    if (m.gun) m.gun.getWorldPosition(_a);
    else _a.set(p.pos.x, p.pos.y + 1.35, p.pos.z);
    const pp = P.position;
    const speed = P.state?.speed || 0;
    const hitChance = Math.max(0.06, Math.min(0.34, 0.34 - d * 0.007 - speed * 0.03));
    const hit = Math.random() < hitChance;
    const miss = hit ? 0 : 1 + Math.random() * 1.6;
    _b.set(
      pp.x + (Math.random() - 0.5) * miss * 2,
      pp.y + 1.2 + (Math.random() - 0.5) * miss,
      pp.z + (Math.random() - 0.5) * miss * 2,
    );
    try {
      if (G?.tracer) G.tracer(_a.clone(), _b.clone(), { speed: 380 });
      _d.subVectors(_b, _a).normalize();
      game.fx?.muzzleFlash?.(_a.clone(), _d.clone());
      game.audio?.play?.('pistol', { position: { x: _a.x, y: _a.y, z: _a.z }, volume: 0.85 });
    } catch (e) {
      /* fx are optional */
    }
    if (!hit) return;
    const dmg = 5 + Math.random() * 5;
    if (G?.damagePlayer) G.damagePlayer(dmg, { kind: 'bullet', gang: true });
    else P.health = Math.max(0, P.health - dmg);
  }

  // a loud shot near the camp wakes everyone up
  const shotListener = (e) => {
    if (alerted || !e?.origin || e.suppressed) return;
    for (const m of members) {
      if (m.dead) continue;
      const dx = e.origin.x - m.p.pos.x;
      const dz = e.origin.z - m.p.pos.z;
      if (dx * dx + dz * dz < SHOT_HEAR * SHOT_HEAR) {
        alert('gunfire');
        return;
      }
    }
  };
  game.on?.('shot', shotListener);
  // game.on has no off(): the listener goes quiet and lets go of the members when the mission cleans up
  ctx.track(shotListener, () => {
    alerted = true;
    members.length = 0;
  });

  // ---------------------------------------------------------------- every frame
  function update(dt) {
    let best = 0;
    for (const m of members) {
      if (m.dead) continue;
      if (pedOut(m.p)) {
        m.dead = true;
        if (m.gun) {
          m.gun.parent?.remove(m.gun);
          m.gun = null;
        }
        // a body in plain view of another member gives Nico away
        if (!alerted) witnessed(m);
        continue;
      }
      const p = m.p;
      const pp = P.position;
      const dx = pp.x - p.pos.x;
      const dz = pp.z - p.pos.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (!alerted) {
        const k = P.health > 0 ? seeing(m) : 0;
        if (k > 0) m.sus = Math.min(1, m.sus + (dt * (0.4 + 2.2 * k * k)) / NOTICE_S);
        else m.sus = Math.max(0, m.sus - dt * 0.15);
        if (m.sus > 0.35 && k > 0) p.heading = turnTo(p.heading, Math.atan2(dx, dz), dt * 2);
        if (m.sus >= 1) alert('seen');
        if (m.sus > best) best = m.sus;
        continue;
      }
      keepFighting(p);
      m.fireCd -= dt;
      if (m.fireCd <= 0 && d < FIRE_RANGE && P.health > 0) {
        m.fireCd = 1.0 + Math.random() * 1.3;
        if (lineOfSight(p.pos, pp)) shoot(m, d);
      }
    }
    suspicion = alerted ? 1 : best;
  }

  function witnessed(dead) {
    for (const m of members) {
      if (m.dead || m === dead) continue;
      const dx = dead.p.pos.x - m.p.pos.x;
      const dz = dead.p.pos.z - m.p.pos.z;
      if (dx * dx + dz * dz < 14 * 14 && lineOfSight(m.p.pos, dead.p.pos)) {
        alert('body');
        return;
      }
    }
  }

  function turnTo(h, want, k) {
    const d = Math.atan2(Math.sin(want - h), Math.cos(want - h));
    return h + Math.max(-k, Math.min(k, d));
  }

  return {
    members,
    update,
    alert,
    get alerted() {
      return alerted;
    },
    get suspicion() {
      return suspicion;
    },
    alive: () => members.filter((m) => !m.dead && !pedOut(m.p)).map((m) => m.p),
  };
}
