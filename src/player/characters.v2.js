// Southline — two protagonists (Phase F2 / F1, Nov 19): Nico and Mari (src/player/mari).
//   game.characters.list           -> [{ id, name, role, active, follow, place, pos }]
//   game.characters.active         -> the one you play ({ id, name })
//   game.characters.switchTo(id, { instant })  -> Promise<bool>: sky cut over to the other character
//   game.characters.call(id)       -> Promise: the phone call (subtitled); calling the other protagonist asks them to
//                                     come help (follower) or, if they already follow you, sends them off
//   game.characters.summon(id) / dismiss(id), game.characters.locked = true (missions: no switching)
// Each character keeps their own position, vehicle, cash, weapons, ammo, outfit, health, armor and wanted level; the bank
// account is shared. The one you are not playing stays in the world as a double (src/player/double.js): idle where you
// left them, in their car, or following you. Saved as the 'characters' slice (src/systems/save.js).
// Events: 'character:switch' { from, to }, 'character:follow' { id, on }, 'call:line' (src/ui/phone/storyCalls.js).
import { MARI, preloadMari } from './mari/index.js';
import { createCharacter, loadHeroBase } from './characterModel.js';
import { createDouble } from './double.js';
import { skyCut, createWheel } from './switch.js';
import { callScript as phoneCallScript, lineMs } from '../ui/phone/storyCalls.js';
import { subtitle } from '../story/ui.js';

export const order = 60;
const WHEEL_KEY = 'KeyO';

// fresh-game state of each character (the active one's live state comes from the core systems instead)
function freshRecord(id) {
  if (id === MARI.id)
    return {
      pos: [MARI.home.x, null, MARI.home.z],
      heading: MARI.home.heading,
      cash: 260,
      inventory: ['fist', 'pistol'],
      ammo: { pistol: 48 },
      weapon: 'fist',
      health: 100,
      armor: 0,
      wanted: 0,
      outfit: null,
      veh: null,
    };
  return {
    pos: null,
    heading: 0,
    cash: 120,
    inventory: ['fist'],
    ammo: {},
    weapon: 'fist',
    health: 100,
    armor: 0,
    wanted: 0,
    outfit: null,
    veh: null,
  };
}

export async function initV2(game) {
  const P = game.player;
  const R = {
    nico: {
      id: 'nico',
      name: 'Nico',
      role: 'Partner',
      char: null,
      double: null,
      rec: null,
      follow: false,
    },
    [MARI.id]: {
      id: MARI.id,
      name: MARI.name,
      role: MARI.role,
      char: null,
      double: null,
      rec: freshRecord(MARI.id),
      follow: false,
    },
  };
  let activeId = 'nico';
  let busy = false;
  let pending = null; // saved slice waiting for Mari's model

  const other = () => (activeId === 'nico' ? R[MARI.id] : R.nico);

  // ---------------------------------------------------------------- Mari's model (loaded after boot, off the hot path)
  let mariReady = null;
  function ensureMari() {
    if (mariReady) return mariReady;
    mariReady = (async () => {
      const base = await loadHeroBase(MARI.id, preloadMari);
      if (!base) throw new Error('Mari model unavailable');
      const c = createCharacter(game, { variant: 'player', hero: MARI.id, seed: 2 });
      R[MARI.id].char = c;
      R[MARI.id].double = createDouble(game, c);
      return c;
    })();
    mariReady.catch((e) => console.warn('[characters]', e));
    return mariReady;
  }

  // ---------------------------------------------------------------- live state <-> record
  function capture() {
    const v = P.state?.inVehicle ? P.state.vehicle : null;
    const t = v?.body?.translation?.();
    const rot = v?.body?.rotation?.();
    const ch = game.playerCharacter;
    return {
      pos: [P.position.x, P.position.y, P.position.z],
      heading: P.heading || 0,
      cash: game.wallet?.cash ?? 0,
      inventory: Array.isArray(P.inventory) ? P.inventory.slice() : ['fist'],
      ammo: { ...(P.ammo || {}) },
      weapon: P.weapon || 'fist',
      health: Number(P.health) || 100,
      armor: Number(P.armor) || 0,
      wanted: game.wanted?.level || 0,
      outfit: ch?.outfit?.ids?.() || null,
      veh:
        v && t
          ? {
              type: v.typeKey || v.type || 'sedan',
              x: t.x,
              y: t.y,
              z: t.z,
              h: rot ? 2 * Math.atan2(rot.y, rot.w) : 0,
            }
          : null,
      vehRef: v,
    };
  }

  function applyStats(rec) {
    if (game.wallet?.setCashDirect && Number.isFinite(rec.cash))
      game.wallet.setCashDirect(rec.cash, 'Switch');
    P.inventory = rec.inventory?.length ? rec.inventory.slice() : ['fist'];
    P.ammo = { ...(rec.ammo || {}) };
    P.weapon = P.inventory.includes(rec.weapon) ? rec.weapon : 'fist';
    P.health = Math.max(20, rec.health || 100);
    P.armor = rec.armor || 0;
    try {
      if (game.wanted && game.wanted.level !== (rec.wanted || 0))
        game.wanted.level = rec.wanted || 0;
    } catch (e) {
      /* police not loaded */
    }
    const ch = game.playerCharacter;
    if (rec.outfit && ch?.outfit?.set) ch.outfit.set(rec.outfit);
  }

  // Put a character's double where its record says: in its car, or standing at its spot.
  function placeDouble(c) {
    const D = c.double;
    const rec = c.rec;
    if (!D || !rec) return;
    let v = rec.vehRef && !rec.vehRef.disposed ? rec.vehRef : null;
    if (!v && rec.veh) v = spawnCar(rec.veh);
    if (v) {
      v.keep = true;
      rec.vehRef = v;
      D.seatIn(v, 'driver');
      return;
    }
    const p = rec.pos || [MARI.home.x, null, MARI.home.z];
    D.place(p[0], p[1], p[2], rec.heading || 0);
  }

  function spawnCar(veh) {
    try {
      const v = game.vehicles?.spawn?.(veh.type, { x: veh.x, y: veh.y + 0.3, z: veh.z }, veh.h, {
        exact: true,
      });
      if (v) v.keep = true;
      return v || null;
    } catch (e) {
      return null;
    }
  }

  // ---------------------------------------------------------------- switching
  // The swap itself (camera up in the sky): the active one becomes a double, the double becomes the player.
  async function swapTo(id) {
    const from = R[activeId];
    const to = R[id];
    // 1. the one we leave: record, out of the car (the double sits back in it)
    from.rec = capture();
    if (P.state?.inVehicle) {
      from.rec.vehRef.keep = true;
      game.exitVehicle?.();
      game.playerSeat?.exit?.();
      if (P.script?.kind === 'exitVehicle') P.script = null;
    }
    // 2. the one we become: out of their seat, model handed to the player
    to.double?.release();
    to.follow = false;
    to.double?.setMode('idle');
    if (!from.double) from.double = createDouble(game, from.char);
    game.setPlayerCharacter(to.char);
    to.char.setVisible?.(true);
    activeId = id;
    // 3. move the player there (streams the place in; the sky cut waits for the ground)
    const rec = to.rec;
    const v = rec.vehRef && !rec.vehRef.disposed ? rec.vehRef : rec.veh ? spawnCar(rec.veh) : null;
    if (v) {
      const t = v.body.translation();
      game.teleport(t.x + 2, t.y, t.z, rec.heading);
      to.char.root.visible = false;
      game.enterVehicle(v);
    } else if (rec.pos) game.teleport(rec.pos[0], rec.pos[1] ?? undefined, rec.pos[2], rec.heading);
    applyStats(rec);
    // 4. the one we left appears a few frames later (the weapons module re-binds to the new player model meanwhile)
    from.char.root.parent?.remove(from.char.root);
    setTimeout(() => placeDouble(from), 300);
    game.emit?.('character:switch', { from: from.id, to: id });
  }

  async function switchTo(id, opts = {}) {
    if (busy || id === activeId || !R[id] || api.locked) return false;
    if (game.ui?.dead || game.ui?.arrested || game.ui?.busted) return false;
    busy = true;
    try {
      if (id === MARI.id) await ensureMari();
      if (!R[id].char) return false;
      if (!R[id].rec) R[id].rec = freshRecord(id);
      game.phone?.close?.();
      const lock = { lock: true, kind: 'switch' };
      P.script = lock;
      if (opts.instant) await swapTo(id);
      else {
        const target = R[id];
        await skyCut(game, {
          from: P.position.clone(),
          swap: () => swapTo(id),
          to: () => (activeId === id ? P.position : target.double.where()),
        });
      }
      if (P.script === lock) P.script = null;
      game.hud?.notify?.(`Playing as ${R[id].name}`, 2200);
      return true;
    } catch (e) {
      console.error('[characters] switch', e);
      return false;
    } finally {
      busy = false;
    }
  }

  // ---------------------------------------------------------------- calls and the follower
  function setFollow(id, on) {
    const c = R[id];
    if (!c || id === activeId || !c.double) return false;
    c.follow = on;
    c.double.setMode(on ? 'follow' : 'idle');
    if (!on) {
      c.rec ||= freshRecord(id);
      c.rec.vehRef = null;
      c.rec.veh = null;
    }
    game.emit?.('character:follow', { id, on });
    return true;
  }

  function callScript(id) {
    const c = R[id];
    if (!c || id === activeId) return null;
    const me = R[activeId].name;
    if (c.follow)
      return {
        lines: [
          { who: me, text: 'I got it from here. Thanks.' },
          { who: c.name, text: 'Any time. Call me if it gets ugly.' },
        ],
        onEnd: () => setFollow(id, false),
      };
    return {
      lines: [
        { who: me, text: 'Hey. I could use a hand.' },
        { who: c.name, text: 'Where are you? ... Got it. On my way.' },
      ],
      onEnd: async () => {
        if (id === MARI.id) await ensureMari();
        setFollow(id, true);
      },
    };
  }

  // A call without the phone screen (missions, the wheel): subtitles + voice hook, then the call's effect.
  async function call(id) {
    const s = phoneCallScript(game, id);
    if (!s) return false;
    for (let i = 0; i < s.lines.length; i++) {
      const l = s.lines[i];
      const ms = lineMs(l.text);
      game.emit?.('call:line', { contact: id, who: l.who, text: l.text, index: i });
      subtitle(l.who, l.text, ms);
      await new Promise((r) => setTimeout(r, ms));
    }
    await s.onEnd?.();
    return true;
  }

  // ---------------------------------------------------------------- per frame
  const wheel = createWheel(game, {
    key: WHEEL_KEY,
    list: () => api.list,
    onPick: (id) => switchTo(id),
  });
  game.bindings?.register?.({
    id: 'characterWheel',
    label: 'Switch character (hold)',
    group: 'On foot',
    context: 'any',
    key: WHEEL_KEY,
  });

  game.updaters.push(function charactersTick(dt) {
    if (game.ui?.title) return;
    try {
      if (!busy) wheel.update(dt);
      const o = other();
      // the player took the double's car: the double gets out
      if (o.double?.vehicle && o.double.vehicle === P.state?.vehicle && !o.follow) {
        o.double.unseat();
        if (o.rec) o.rec.vehRef = null;
      }
      if (o.double && !busy) o.double.update(dt);
    } catch (e) {
      console.error('[characters] tick', e);
    }
  });

  // ---------------------------------------------------------------- save slice
  function recordFor(c) {
    if (c.id === activeId) return null; // the core slices hold the active one
    const rec = c.rec || freshRecord(c.id);
    const D = c.double;
    const where = D ? D.where() : null;
    const v = D?.vehicle && D.seat === 'driver' ? D.vehicle : null;
    const t = v?.body?.translation?.();
    const rot = v?.body?.rotation?.();
    return {
      ...rec,
      vehRef: undefined,
      pos: where && !v ? [where.x, where.y, where.z] : rec.pos,
      heading: D && !v ? D.heading : rec.heading,
      veh: t
        ? { type: v.typeKey || 'sedan', x: t.x, y: t.y, z: t.z, h: 2 * Math.atan2(rot.y, rot.w) }
        : null,
      follow: !!c.follow,
    };
  }

  game.save?.register?.('characters', {
    version: 1,
    order: 45,
    save: () => ({
      active: activeId,
      chars: Object.fromEntries(Object.values(R).map((c) => [c.id, recordFor(c)])),
    }),
    load: (d) => {
      pending = d || { active: 'nico', chars: {} };
      applyLoaded();
    },
  });

  // After a load: who is active (the core slices already restored that one) and where the other one is.
  async function applyLoaded() {
    const d = pending;
    if (!d) return;
    pending = null;
    try {
      await ensureMari();
    } catch (e) {
      return;
    }
    for (const c of Object.values(R)) {
      c.rec = d.chars?.[c.id] || freshRecord(c.id);
      c.follow = false;
      c.double?.setMode('idle');
    }
    if (!R.nico.char) R.nico.char = game.playerCharacter;
    const want = R[d.active] ? d.active : 'nico';
    if (want !== activeId) {
      // hand the model over without stashing: the live state already belongs to `want`
      R[want].double?.release();
      game.setPlayerCharacter(R[want].char);
      activeId = want;
      R[want].char.setVisible?.(!P.state?.inVehicle);
    }
    const o = other();
    if (!o.double) o.double = createDouble(game, o.char);
    o.char.root.parent?.remove(o.char.root);
    setTimeout(() => {
      placeDouble(o);
      if (o.rec?.follow) setFollow(o.id, true);
    }, 300);
  }

  // ---------------------------------------------------------------- public API
  const api = {
    locked: false,
    get list() {
      return Object.values(R).map((c) => {
        const D = c.double;
        const at = c.id === activeId ? P.position : D?.where?.();
        return {
          id: c.id,
          name: c.name,
          role: c.role,
          active: c.id === activeId,
          follow: !!c.follow,
          place: placeName(at),
          pos: at ? { x: at.x, y: at.y, z: at.z } : null,
        };
      });
    },
    get active() {
      return { id: activeId, name: R[activeId].name };
    },
    switchTo,
    call,
    callScript,
    // story hook (intro v2 cutscenes): stand the character you are NOT playing at a spot { x, y?, z, heading }, idle and
    // out of any car. Returns the double's model root (for camera targets), or null when that one is the player.
    stage(id, at) {
      const c = R[id];
      if (!c || id === activeId || !c.double || !at) return null;
      c.follow = false;
      c.double.setMode('idle');
      c.double.place(at.x, at.y ?? null, at.z, at.heading || 0);
      c.rec = {
        ...(c.rec || freshRecord(id)),
        pos: [at.x, at.y ?? null, at.z],
        heading: at.heading || 0,
      };
      c.rec.vehRef = null;
      c.rec.veh = null;
      return c.char?.root || null;
    },
    summon: (id) => setFollow(id, true),
    dismiss: (id) => setFollow(id, false),
    ready: () => ensureMari(),
    // test / debug view of the other character's double
    debug: () => {
      const D = other().double;
      return D
        ? {
            id: other().id,
            mode: D.mode,
            seat: D.seat,
            dist: D.dist,
            target: !!D.target,
            shots: D.shots || 0,
          }
        : null;
    },
    get busy() {
      return busy;
    },
  };
  function placeName(p) {
    if (!p) return '';
    try {
      return game.city?.districtAt?.(p.x, p.z)?.name || game.city?.districtAt?.(p.x, p.z) || '';
    } catch (e) {
      return '';
    }
  }
  game.characters = api;

  // Nico is the boot player model; Mari loads once the world is up and stands at her start until you switch.
  R.nico.char = game.playerCharacter;
  const boot = () => {
    if (!game.ready) return setTimeout(boot, 500);
    ensureMari()
      .then(() => {
        if (activeId === 'nico' && !R[MARI.id].double.shown && !pending) placeDouble(R[MARI.id]);
      })
      .catch(() => {});
  };
  boot();
}
