// Cutscenes as data, filmed on the cinematic director (src/ui/menu/cinema.js: lens, moves, depth of field, letterbox,
// fades). A cutscene places actors (the user's people through game.npc.spawnPosed), vehicles and props, plays its shots
// back to back, shows subtitles and a phone-call card on a timeline, and can be skipped by holding Enter / Esc / pad B
// for one second. Skipping jumps straight to the end state (end.player, end.vehicle, onEnd), so a skipped scene leaves
// the world exactly as a watched one. See README.md for the full format; the short version:
//
//   await game.story.playCutscene({
//     id: 'demo', skippable: true,
//     frame: { x, z, heading },                       // optional: shot / actor arrays are local to this frame
//     actors:   { boss: { person: 'p12', at: [0, 0, 6, Math.PI], pose: 'talk_g' } },
//     vehicles: { car:  { key: 'pickup', at: { x, z, heading } } },
//     shots: [{ dur: 4, mm: 35, from: { pos: [2, 1.7, -3], look: 'actor:boss' }, to: { ... } }],
//     lines: [{ at: 0.5, who: 'Marcus', text: 'You up?', ms: 2500, audio: 'vo/marcus_01.ogg' }],
//     phone: { who: 'Marcus', from: 0, to: 4 },
//     events: [{ at: 2, run: (cs) => cs.actors.boss.setPose('cross_arms') }],
//     end: { player: { at: { x, z, heading } }, vehicle: 'car' },
//     onEnd(cs, { skipped }) {},
//   });
//
// Positions: { x, y?, z, heading? } is world space. With a frame, [right, up, forward, heading?] is local to it (right =
// screen right when you stand on the frame facing its heading; up is above the ground at the frame origin). Look targets
// may also be 'actor:<name>', 'vehicle:<name>' or 'player' (that object's head / roof height).
import { getCinema, EASE, mmToFov } from '../ui/menu/cinema.js';
import { subtitle, skipPrompt, phoneCall } from './ui.js';
import { loadMissionProp } from './props.js';

const SKIP_HOLD_S = 1;
const BASE = (import.meta.env && import.meta.env.BASE_URL) || '/';

export function createCutscenes(game) {
  const P = game.player;
  const C = {
    active: null,
    // Animation hook: return true when you played `name` on the actor yourself (Mixamo clips, later). Otherwise the
    // actor's built-in pose library is used (game.npc.poses()).
    animHook: null,
    // Voice hook: called for every subtitle line that names an `audio` file; the default plays it from /assets/audio/.
    voice: defaultVoice,
    play,
  };

  function defaultVoice(line) {
    if (!line.audio) return null;
    try {
      const a = new Audio(BASE + 'assets/audio/' + line.audio);
      const vols = game.audio?.busVolumes || {};
      a.volume = Math.min(1, (vols.master ?? 1) * (vols.voice ?? vols.sfx ?? 1));
      a.play().catch(() => {});
      return a;
    } catch (e) {
      return null;
    }
  }

  // ---------------------------------------------------------------- coordinates
  function groundY(x, z) {
    try {
      const y = game.city?.groundHeightAt?.(x, z, 40);
      return Number.isFinite(y) ? y : 0;
    } catch (e) {
      return 0;
    }
  }

  function makeFrame(def) {
    const f = typeof def.frame === 'function' ? def.frame(game) : def.frame;
    if (!f) return null;
    const heading = f.heading || 0;
    return { x: f.x, z: f.z, y: f.y ?? groundY(f.x, f.z), heading };
  }

  // local [right, up, forward] -> world [x, y, z]
  function toWorld(frame, v) {
    if (!frame) return [v[0], v[1], v[2]];
    const fx = Math.sin(frame.heading);
    const fz = Math.cos(frame.heading);
    const x = frame.x - v[0] * fz + v[2] * fx;
    const z = frame.z + v[0] * fx + v[2] * fz;
    return [x, frame.y + v[1], z];
  }

  // any position spec -> { x, y, z, heading }
  function resolveAt(cs, at) {
    if (!at) return null;
    if (typeof at === 'function') return resolveAt(cs, at(game, cs));
    if (Array.isArray(at)) {
      const w = toWorld(cs.frame, at);
      const heading = (cs.frame?.heading || 0) + (at[3] || 0);
      return { x: w[0], y: cs.frame ? w[1] : (at[1] ?? groundY(w[0], w[2])), z: w[2], heading };
    }
    if (at.isVector3) return { x: at.x, y: at.y, z: at.z, heading: 0 };
    // fixedY: the spot gave its own height (a floor above the terrain: an interior set, a deck), keep it when teleporting
    const fixedY = Number.isFinite(at.y);
    return {
      x: at.x,
      y: fixedY ? at.y : groundY(at.x, at.z),
      z: at.z,
      heading: at.heading || 0,
      fixedY,
    };
  }

  // a look / camera point: array, {x,y,z}, or 'actor:name' / 'vehicle:name' / 'player'
  function resolvePoint(cs, p) {
    if (typeof p === 'string') return () => namedPoint(cs, p);
    if (typeof p === 'function') return () => p(game, cs);
    if (Array.isArray(p)) return toWorld(cs.frame, p);
    return [p.x, p.y ?? groundY(p.x, p.z) + 1.6, p.z];
  }

  function namedPoint(cs, name) {
    if (name === 'player') {
      const pp = P.position;
      return [pp.x, pp.y + 1.6, pp.z];
    }
    const [kind, id] = name.split(':');
    // the scene's own actors first, then the running mission's handles (opts.handles)
    const actor = kind === 'actor' && (cs.actors[id] || cs.handles[id]);
    if (actor?.root) {
      const r = actor.root.position;
      return [r.x, r.y + 1.62, r.z];
    }
    const v = kind === 'vehicle' && (cs.vehicles[id] || cs.handles[id]);
    if (v) {
      const t = v.body?.translation?.() || v.mesh?.position || { x: 0, y: 0, z: 0 };
      return [t.x, t.y + 1.2, t.z];
    }
    return [0, 0, 0];
  }

  // ---------------------------------------------------------------- cast and set
  function spawnActor(cs, name, a) {
    const at = resolveAt(cs, a.at);
    if (!at || !game.npc?.spawnPosed) return null;
    let h = null;
    try {
      h = game.npc.spawnPosed({
        person: a.person,
        place: a.place,
        pos: { x: at.x, y: at.y, z: at.z },
        rot: at.heading,
        pose: a.pose || 'idle',
        seed: a.seed,
        gender: a.gender,
      });
    } catch (e) {
      console.warn('[story] actor', name, e);
    }
    if (!h) return null;
    if (a.anim) animate(h, a.anim);
    cs.actors[name] = h;
    return h;
  }

  function animate(handle, name) {
    if (!handle || !name) return;
    try {
      if (C.animHook && C.animHook(handle, name) === true) return;
    } catch (e) {
      console.warn('[story] animHook', e);
    }
    const known = game.npc?.poses?.() || [];
    const pose = !known.length || known.includes(name) ? name : 'idle';
    try {
      handle.setPose(pose);
    } catch (e) {
      /* pose missing on this rig */
    }
  }

  async function spawnVehicle(cs, name, v) {
    const at = resolveAt(cs, v.at);
    if (!at || !game.vehicles?.spawnParked) return null;
    try {
      const car = await game.vehicles.spawnParked(v.key || 'sedan', {
        x: at.x,
        z: at.z,
        heading: at.heading,
        color: v.color,
        wear: v.wear,
        keepSpot: true,
        locked: false,
      });
      if (car) cs.vehicles[name] = car;
      return car;
    } catch (e) {
      console.warn('[story] vehicle', name, e);
      return null;
    }
  }

  async function spawnProp(cs, name, p) {
    const at = resolveAt(cs, p.at);
    let obj = null;
    try {
      if (p.prop) obj = await loadMissionProp(p.prop);
      else if (typeof p.object === 'function') obj = await p.object(game, cs);
      else if (p.url) obj = await loadGLB(p.url);
    } catch (e) {
      console.warn('[story] prop', name, e);
    }
    if (!obj) return null;
    if (at) {
      obj.position.set(at.x, at.y, at.z);
      obj.rotation.y = at.heading;
    }
    if (p.scale) obj.scale.setScalar(p.scale);
    game.scene.add(obj);
    cs.props[name] = obj;
    return obj;
  }

  async function loadGLB(url) {
    const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
    const gltf = await new GLTFLoader().loadAsync(url.startsWith('/') ? url : BASE + url);
    return gltf.scene;
  }

  // ---------------------------------------------------------------- shots
  function shotSpec(cs, s) {
    const from = { pos: resolvePoint(cs, s.from.pos), look: resolvePoint(cs, s.from.look) };
    const to = s.to
      ? {
          pos: resolvePoint(cs, s.to.pos ?? s.from.pos),
          look: resolvePoint(cs, s.to.look ?? s.from.look),
        }
      : null;
    return {
      dur: s.dur || 4,
      fov: s.mm ? mmToFov(s.mm) : (s.fov ?? 40),
      fov1: s.mm1 ? mmToFov(s.mm1) : s.fov1,
      aperture: s.aperture ?? 0.8,
      handheld: s.handheld ?? 0.5,
      focus: s.focus ? resolvePoint(cs, s.focus) : undefined,
      ease: typeof s.ease === 'function' ? s.ease : EASE[s.ease || 'slider'],
      from,
      to,
    };
  }

  // ---------------------------------------------------------------- play
  async function play(def, opts = {}) {
    if (C.active) {
      console.warn('[story] a cutscene is already playing:', C.active.id);
      return { skipped: false, busy: true };
    }
    const cin = getCinema(game);
    const skippable = opts.skippable ?? def.skippable ?? true;
    const cs = {
      id: def.id || 'cutscene',
      def,
      game,
      frame: makeFrame(def),
      actors: {},
      handles: opts.handles || {},
      vehicles: {},
      props: {},
      t: 0,
      skipped: false,
      at: (a) => resolveAt(cs, a),
      animate,
    };
    C.active = cs;
    const wasScript = P.script;
    P.script = { lock: true, fixed() {}, anim: { speed: 0, grounded: true }, cutscene: cs.id };
    const leaveUI = game.bindings?.pushMode?.('ui');
    document.body.classList.add('pm-intro', 'st-cutscene');
    game.emit?.('cutscene:start', { id: cs.id });

    // ---- set the stage under black
    cin.begin({
      letterbox: def.letterbox !== false,
      dof: true,
      flare: true,
      grain: 1.4,
      vignette: 0.14,
      owner: 'story',
    });
    if (def.fadeIn !== false) await cin.black(true, opts.fastIn ? 1 : 450);
    if (def.player?.at) {
      const p = resolveAt(cs, def.player.at);
      try {
        game.teleport(p.x, p.fixedY ? p.y : null, p.z, p.heading);
      } catch (e) {
        /* */
      }
    }
    try {
      game.playerCharacter?.setVisible?.(def.player?.visible !== false);
    } catch (e) {
      /* */
    }
    for (const [name, a] of Object.entries(def.actors || {})) spawnActor(cs, name, a);
    const loads = [];
    for (const [name, v] of Object.entries(def.vehicles || {}))
      loads.push(spawnVehicle(cs, name, v));
    for (const [name, p] of Object.entries(def.props || {})) loads.push(spawnProp(cs, name, p));
    await Promise.race([Promise.all(loads), sleepMs(9000)]);
    try {
      def.setup?.(cs);
    } catch (e) {
      console.error('[story] cutscene setup', e);
    }
    const shots = def.shots || [];
    if (shots.length) {
      const first = shotSpec(cs, shots[0]);
      cin.shot({ ...first, dur: 1e6 });
      const p0 = typeof first.from.pos === 'function' ? first.from.pos() : first.from.pos;
      await cin.waitStream(p0[0], p0[2], 4000, 160);
    }

    // ---- timeline: lines, phone card, events and the hold-to-skip input, driven by one updater
    const lines = (def.lines || []).map((l) => ({ ...l, fired: false }));
    const events = (def.events || []).map((e) => ({ ...e, fired: false }));
    let hold = 0;
    let phoneOn = false;
    const glyph = game.bindings?.codeGlyph?.('Enter') || 'Enter';
    function tick(dt) {
      // the timeline runs on the same real-time clock as the shots (they sleep in real time), so lines and events stay
      // on their shots even when frames are slow and the game's dt is clamped
      cs.t = (performance.now() - cs.t0) / 1000 / slow;
      for (const l of lines) {
        if (l.fired || cs.t < (l.at || 0)) continue;
        l.fired = true;
        subtitle(l.who, l.text, l.ms || 3000);
        if (l.audio) {
          try {
            l.sound = C.voice?.(l);
          } catch (e) {
            /* */
          }
        }
      }
      for (const e of events) {
        if (e.fired || cs.t < (e.at || 0)) continue;
        e.fired = true;
        try {
          e.run?.(cs);
        } catch (err) {
          console.error('[story] cutscene event', err);
        }
      }
      if (def.phone) {
        const want = cs.t >= (def.phone.from || 0) && cs.t < (def.phone.to ?? 1e9);
        if (want !== phoneOn) {
          phoneOn = want;
          phoneCall(want ? def.phone.who : null);
        }
      }
      if (skippable) {
        const B = game.bindings;
        const held =
          B?.held?.('Enter') ||
          B?.held?.('Escape') ||
          B?.held?.('NumpadEnter') ||
          B?.padHeld?.('B');
        hold = held ? hold + dt : Math.max(0, hold - dt * 2);
        skipPrompt(true, Math.min(1, hold / SKIP_HOLD_S), glyph);
        if (hold >= SKIP_HOLD_S) cs.skipped = true;
      }
    }
    // game.cutsceneSlow = k (tests): every shot and the whole timeline run k times slower, so a slow machine still films
    // each shot while it is on screen
    const slow = Math.max(1, game.cutsceneSlow || 1);
    cs.t0 = performance.now();
    game.updaters.push(tick);
    const sleep = (sec) =>
      new Promise((r) => {
        const t0 = performance.now();
        const step = () => {
          if (cs.skipped || (performance.now() - t0) / 1000 >= sec) r();
          else setTimeout(step, 30);
        };
        step();
      });

    try {
      if (def.fadeIn !== false) cin.black(false, 700);
      for (let i = 0; i < shots.length && !cs.skipped; i++) {
        cs.shot = i; // which shot is on screen (tests film by shot, not by the game-time clock)
        const s = shots[i];
        if (i > 0 && s.cut === 'dissolve') cin.crossfade(900);
        const spec = shotSpec(cs, s);
        // the move runs a little past the cut so the camera still travels when the next shot lands
        cin.shot({ ...spec, dur: (spec.dur + 0.4) * slow });
        await sleep(spec.dur * slow);
      }
      if (!shots.length && def.duration) await sleep(def.duration);
    } catch (e) {
      console.error('[story] cutscene', e);
    }

    // ---- end state (the same whether watched or skipped)
    const ti = game.updaters.indexOf(tick);
    if (ti >= 0) game.updaters.splice(ti, 1);
    skipPrompt(false);
    subtitle(null);
    phoneCall(null);
    for (const l of lines) l.sound?.pause?.();
    if (cs.skipped || def.fadeOut !== false) {
      cin.cancelFade();
      await cin.black(true, cs.skipped ? 200 : 450);
    }
    for (const e of events) {
      // events marked `always` change the world (not just the picture): they run on a skip too
      if (!e.fired && e.always) {
        try {
          e.run?.(cs);
        } catch (err) {
          console.error('[story] cutscene event', err);
        }
      }
    }
    applyEnd(cs, def);
    try {
      def.onEnd?.(cs, { skipped: cs.skipped });
    } catch (e) {
      console.error('[story] cutscene onEnd', e);
    }
    game.cameraYaw = P.heading + Math.PI;
    game.cameraPitch = 0.2;
    cin.handoff(cs.skipped || def.fadeOut !== false ? 10 : 900);
    cin.end();
    P.script = wasScript?.cutscene || wasScript?.title ? null : wasScript || null;
    leaveUI?.();
    document.body.classList.remove('pm-intro', 'st-cutscene');
    C.active = null;
    if (def.fadeOut !== false || cs.skipped) cin.black(false, 500);
    game.emit?.('cutscene:end', { id: cs.id, skipped: cs.skipped });
    return { skipped: cs.skipped, actors: cs.actors, vehicles: cs.vehicles, props: cs.props };
  }

  function applyEnd(cs, def) {
    const end = def.end || {};
    try {
      game.playerCharacter?.setVisible?.(true);
    } catch (e) {
      /* */
    }
    if (end.player?.at) {
      const p = resolveAt(cs, end.player.at);
      try {
        game.teleport(p.x, p.fixedY ? p.y : null, p.z, p.heading);
      } catch (e) {
        /* */
      }
    }
    const keep = new Set(end.keep || []);
    for (const [name, h] of Object.entries(cs.actors)) {
      if (keep.has(name)) continue;
      try {
        h.remove();
      } catch (e) {
        /* */
      }
    }
    for (const [name, o] of Object.entries(cs.props)) {
      if (keep.has(name)) continue;
      game.scene.remove(o);
    }
    // vehicles stay by default (the car he drives off in); `temp: true` ones go
    for (const [name, v] of Object.entries(cs.vehicles)) {
      if (!def.vehicles?.[name]?.temp || keep.has(name)) continue;
      try {
        game.vehicles?.remove?.(v, { force: true });
      } catch (e) {
        /* */
      }
    }
    if (end.vehicle && cs.vehicles[end.vehicle]) {
      try {
        game.enterVehicle(cs.vehicles[end.vehicle]);
      } catch (e) {
        console.warn('[story] end.vehicle', e);
      }
    }
  }

  return C;
}

const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));
