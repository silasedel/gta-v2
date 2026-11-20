# Story framework (`src/story/`)

Missions, cutscenes and story progress for Southline. One mission runs at a time; the story state rides in every save.
Read `docs/v2/CONVENTIONS.md` first (section 0 code style; 4a police, 4b people, 4c activities, 4d the Mission Passed
sting). The intro plot is in `docs/v2/plan/STORY_INTRO_SCRIPT.md`.

| File            | What it does                                                                                                                                                               |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `index.js`      | `game.story` API, the `story` save slice, mission file loading, Play / Free Roam / Restart Story flows                                                                     |
| `state.js`      | flags, unlocks, finished missions, what each mission paid, the mission in progress (`resume`)                                                                              |
| `runner.js`     | `defineMission`, steps, triggers, fail rules, checkpoints, pass / fail / skip                                                                                              |
| `cutscene.js`   | cutscenes as data on the cinema camera (`src/ui/menu/cinema.js`), hold-to-skip                                                                                             |
| `markers.js`    | available-mission markers (lettered blip + ground ring) and the objective waypoint                                                                                         |
| `ui.js`         | title banner, Mission Failed screen (Retry / Quit), subtitles, skip prompt, phone-call card                                                                                |
| `props.js`      | `loadMissionProp(id)`: crates, `package_waterproof`, scuba gear, shipwreck, flares, `zip_tie`, rope, phone, briefcase, cash (`public/assets/models/mission/manifest.json`) |
| `intro.js`      | the intro v2 mission ids (Mari, then Nico: 14), in play order                                                                                                                                 |
| `missions/*.js` | one file per mission, registered automatically (files starting with `_` load only with `?storytest=1`)                                                                     |

## Adding a mission

Make `src/story/missions/<name>.js` and `export default defineMission({ ... })`. That is all: the file is picked up by
`index.js`, its marker shows on the map once its `requires` are met, and walking into the marker starts it.

```js
import { defineMission } from '../runner.js';

const MARINA = { x: -980, z: 5190, heading: 1.2 };

export default defineMission({
  id: 'side.example', // flag 'side.example.done' is set on pass and on skip
  title: 'Example Job',
  giver: 'Marcus', // the blip shows his initial
  requires: ['intro.done'], // flags, unlocks or mission ids that must all be set; or (state) => bool
  start: { marker: true, at: MARINA }, // marker: false = only started from code
  rewards: { money: 750, items: [{ id: 'clara-water', qty: 1 }], unlocks: ['side.example2'] },
  flags: { 'marcus.trust': 1 }, // set on pass and on skip
  end: { at: { x: -900, z: 5100, heading: 0 } }, // where a skip leaves the player
  fail: { leftArea: { at: MARINA, r: 900 } }, // whole-mission fail rules (died / arrested are always on)

  // runs before step 0 and before every retry; fromStep = the checkpoint index
  async setup(ctx, fromStep) {},

  steps: [
    {
      // a cutscene step: plays, then the next step starts
      cutscene: (ctx) => ({
        id: 'example.brief',
        frame: MARINA,
        actors: { marcus: { person: 'p44', at: [0, 0, 3, Math.PI], pose: 'talk_g' } },
        shots: [{ dur: 4, mm: 35, from: { pos: [-2, 1.7, -2], look: 'actor:marcus' } }],
        lines: [{ at: 0.3, who: 'Marcus', text: 'Take the van to the yard.', ms: 3000 }],
      }),
    },
    {
      text: 'Get in the van.',
      async enter(ctx) {
        await ctx.spawnVehicle('van', 'van', { x: -975, z: 5200, heading: 0.4 });
      },
      trigger: { enterVehicle: 'van' },
      fail: { vehicleDestroyed: 'van' },
    },
    {
      text: 'Drive to the yard.',
      checkpoint: {
        at: { x: -975, z: 5205, heading: 0.4 }, // Retry puts the player here
        restore: (ctx) => ctx.spawnVehicle('van', 'van', { x: -975, z: 5200, heading: 0.4 }),
      },
      trigger: { reach: { at: { x: -400, z: 4800 }, r: 8, inVehicle: 'van' } },
      fail: { vehicleDestroyed: 'van' },
    },
    {
      text: 'Pick up the briefcase.',
      enter: (ctx) => ctx.spawnProp('case', 'briefcase', { x: -396, z: 4803 }),
      trigger: { interact: { at: 'case', label: 'pick up the briefcase' } },
    },
  ],
  onPass(ctx) {}, // cosmetic only (a line, a text): lasting changes go in rewards / flags / apply
  onFail(ctx, reason) {},
  apply(story, how) {}, // lasting custom state; runs on pass AND skip (how = 'pass' | 'skip')
});
```

### Steps

Each step may have:

- `text`: the objective line (HUD).
- `enter(ctx)`: set the step up (spawn things); may be async.
- `cutscene`: a cutscene definition, or `(ctx) => definition`. It plays after `enter`.
- `trigger`: what finishes the step (below). A step with no trigger ends as soon as `enter` / `cutscene` are done.
- `waypoint`: where the blip, GPS route and ground ring go. Default: the trigger's spot. `false` = none. A handle name
  (`'van'`) or a function follows a moving target.
- `fail`: rules for this step, merged over the mission's `fail`.
- `checkpoint`: `true` or `{ at, restore(ctx) }`. Reaching this step makes it the Retry point. `at` is where the player
  respawns; `restore` rebuilds what earlier steps made (the car he was driving), since a retry clears everything.
- `onTick(ctx, dt)`, `until(ctx, dt) => bool` (a custom finish), `exit(ctx)`.

### Triggers

| Trigger                                                                        | Finishes when                                                            |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| `{ reach: { at, r = 5, inVehicle?: 'handle' \| true, onFoot? } }`              | the player is within `r` m (in that vehicle / on foot)                   |
| `{ enterVehicle: 'handle' \| true \| (vehicle, ctx) => bool }`                 | he sits in that vehicle                                                  |
| `{ interact: { at, r = 2.2, label } }`                                         | he presses E (pad X) within `r` m; the prompt reads "Press E to <label>" |
| `{ killAll: 'handle' \| (ctx) => peds }`                                       | every ped in that handle (a list) is down                                |
| `{ collect: { items: [points] \| (ctx) => points, n?, r = 1.8, onCollect? } }` | he touched `n` of the green rings; the objective counts "(2/5)"          |
| `{ timer: seconds }`                                                           | the time ran out (shown as a countdown)                                  |
| `{ wait: seconds }`                                                            | the same, without the countdown                                          |
| `(ctx, dt) => bool`                                                            | your function returns true                                               |

### Fail rules

`died` and `arrested` are always on. Add any of:
`vehicleDestroyed: 'van' | ['van', 'boat']`, `protect: 'luis'` ("Luis died."),
`escaped: { target: 'thief', dist: 200 }`, `leftArea: { at, r }` (warning at 80 % of `r`),
`timer: seconds`, `custom: (ctx) => 'reason' | false`. Each built-in rule takes an optional `text` for its message.

### Positions

`{ x, z, y?, heading? }` in world meters (CONVENTIONS section 1: +X east, +Z south, heading 0 faces +Z). Mission-level
positions (`start.at`, `end.at`, `checkpoint.at`) may be functions of `game`; positions inside step triggers may be
functions of `ctx` or handle names. Nico's house anchors: `game.nicoHouse.anchors.{spawnYard, dock, carport, truck}`
(`.pos`, `.heading`).

### The context (`ctx`)

`ctx.game`, `ctx.story`, `ctx.state`, `ctx.data` (your scratch, fresh on every retry), `ctx.h` (named handles), and:

- `await ctx.spawnVehicle(name, key, at, { color, keepOnPass = true })`: a parked car / boat model
  (`game.vehicles.spawnParked` keys).
- `ctx.spawnActor(name, { person: 'p44', place, at, pose })`: a staged person (`game.npc.spawnPosed`), standing still in
  a pose (`game.npc.poses()`).
- `ctx.spawnPed(name, { at, kit, gang, health, list: true })`: a crowd ped in a clothing kit (`src/jobs/kit.js`); with
  `list` the handle is an array (use with `killAll`). Make them fight with `keepFighting` / `fireAtPlayer` from kit.js.
- `await ctx.spawnProp(name, propId, at, { scale, lift })`: a mission prop.
- `ctx.spawnBoat(name, key, at)`: a boat (`game.boatSystem`: `console` motorboat, `skiff`, `racer`, `cruiser`,
  `jetski`, `police`).
- `ctx.spawnAircraft(name, type, at)`: an aircraft (`game.air`: `floatplane`, `prop`, `bizjet`); `y` defaults to the sea.
- `ctx.track(obj, dispose, { keepOnPass })`: anything else that must be cleaned up on fail / retry / quit.
- `await ctx.cutscene(def)`: play a cutscene from inside a step; its vehicles and `end.keep` actors become handles.
- `ctx.objective(text)`, `ctx.say(who, text, ms)`, `ctx.notify(text)`, `ctx.help(text)`, `await ctx.wait(seconds)`.
- `ctx.next()` (finish this step now), `ctx.pass()`, `ctx.fail(reason)`.
- `ctx.pos(x)`, `ctx.dist(x)` for any point / handle / function.

Cutscenes played from a step (`cutscene:` or `ctx.cutscene`) can look at the mission's handles too:
`look: 'actor:dex'` finds `ctx.h.dex` when the scene has no actor of that name.

Nico's intro missions (`missions/intro2.switchNico|smuggling|packages|swamp|seaplane|home.js`, shared data and helpers
in `missions/lib/intro.js`, the drop plane `lib/dropPlane.js`, the swamp camp set `lib/swampCamp.js`, its gang
`lib/campCrew.js`, the employer's dock `lib/marina.js`) are full examples: boats, a scripted plane, a flyable floatplane,
mission sets built in `setup` and disposed by cleanup, a sneak-or-fight crew, protect / escaped / leftArea rules,
checkpoints with `restore`, and `auto(ctx)` step hooks for the end-to-end test (`tools/v2/story/intro2_play.mjs`).

### What pass, fail and skip do

- **Pass**: fade, clean up (vehicles stay), pay `rewards.money` (wallet, once per mission unless `repeatPays`), add
  `rewards.items` (inventory), set `unlocks`, `flags`, `<id>.done`, run `apply`, show "Mission Passed" with the sting
  and the payout, emit `mission:pass`, autosave.
- **Fail**: the death / arrest sequence plays out, then "Mission Failed" with the reason, Retry (from the last checkpoint)
  and Quit. `retry: false` on the mission hides Retry.
- **Skip** (`game.story.skipMission(id)`): exactly what a pass applies, without playing it, then the player goes to
  `end.at`. A finished mission is never skipped (or paid) twice.

## Cutscenes

```js
await game.story.playCutscene({
  id: 'demo',
  skippable: true, // hold Enter / Esc or pad B for 1 s jumps to the end state
  frame: { x, z, heading }, // optional; makes [right, up, forward, headingOffset] arrays local to it
  player: { at: [0, 0, 0, 0], visible: true },
  actors: { boss: { person: 'p44', at: [0, 0, 6, Math.PI], pose: 'talk_g', anim: 'talk_g' } },
  vehicles: { car: { key: 'pickup', at: { x, z, heading }, temp: false } }, // vehicles stay unless temp
  props: { case: { prop: 'briefcase', at: [0.5, 0.9, 6] } }, // or { url } / { object: (game) => Object3D }
  shots: [
    // mm = lens (or fov); from / to = camera move; look = point, 'actor:boss', 'vehicle:car' or 'player'
    { dur: 4, mm: 35, from: { pos: [2, 1.7, 2], look: 'actor:boss' }, to: { pos: [1.5, 1.6, 3] } },
    { dur: 3, mm: 85, cut: 'dissolve', from: { pos: [0, 1.6, 4], look: 'actor:boss' } },
  ],
  lines: [{ at: 0.4, who: 'Boss', text: 'Sit down.', ms: 2500, audio: 'vo/boss_01.ogg' }],
  phone: { who: 'Boss', from: 0, to: 5 }, // phone-call card on screen between these seconds
  events: [{ at: 2, run: (cs) => cs.animate(cs.actors.boss, 'cross_arms') }], // `always: true` = also on a skip
  end: { player: { at: { x, z, heading } }, vehicle: 'car', keep: ['boss'] }, // the state after watch or skip
  onEnd(cs, { skipped }) {},
});
```

Shot options: `dur`, `mm` / `fov` (`mm1` / `fov1` zoom), `from`, `to`, `ease` (`slider`, `inOut`, `out`, `in`, `linear`
or a function), `focus`, `aperture`, `handheld` (0..1), `cut: 'dissolve'`.

Hooks for later assets:

- `game.story.cutscenes.animHook = (actor, name) => bool`: play a named clip yourself (Mixamo); return true when handled.
  Otherwise `anim` / `cs.animate` uses the built-in pose library.
- `game.story.cutscenes.voice = (line) => audio`: voice lines; the default plays `line.audio` from `/assets/audio/`.

## People for the missions (the user's Tripo people, `public/assets/npc/people/index.json`)

Nico's intro cast is `CAST` in `missions/lib/intro.js` (Vale, Dex, Lou, Cisco, the Sawgrass Boys, the poachers, Vale's
bodyguards, the seaplane and drop pilots). A mission's `setup` calls `loadCast(ids)` so `spawnActor` and cutscene actors
get the real person instead of a stand-in from the street crowd. People ready for Phase C:

| Mission               | Person                                                                   | Place (`game.npc.spawnPosed({ place })`) |
| --------------------- | ------------------------------------------------------------------------ | ---------------------------------------- |
| C1 Weapon Purchase    | the gun store clerk, NPC 180 (`p180`): beard, tattoos, holster           | `gun_store`                              |
| C2 Collecting Money   | the nervous shop owner, NPC 181 (`p181`): apron, 60s                     | `shop_owner` (also in `shop_staff`)      |
| C1 ambush / any fight | the swamp poachers `p177`, `p178`, `p188`; the gang people `p150`-`p157` | `poacher`, `gang`                        |

## Story state and menu flows

- `game.story.state`: `get / set / has (flag)`, `unlock / isUnlocked`, `isDone(id)`, `meets(requires)`, `onChange(fn)`.
  Saved in the `story` slice; a new game resets it.
- Play (main menu) continues the newest save: a mission that was running when the game closed restarts at its last
  checkpoint (`state.resume`), else the next intro mission starts (`game.story.stage()`).
- Free Roam: `game.story.skipIntro()`: every intro mission skipped (their flags, money, items), `intro.done`, unlock
  `freeRoam`, at Nico's house.
- Restart Story: `game.story.restartStory()`: every save slot erased, a new game at the house.
- Events: `mission:start`, `mission:step`, `mission:pass`, `mission:fail`, `mission:quit`, `mission:skip`,
  `cutscene:start`, `cutscene:end`.

## Testing

`?storytest=1` loads `missions/_test.js` (Test Errand: a phone-call cutscene, reach the dock, pick up a package). Its
pink marker is on Nico's carport. From a console: `game.story.startMission('test.errand')`,
`game.story.skipMission('test.errand')`, `game.story.state.toJSON()`.

## Two protagonists: `game.characters` (Phase F, player track)

Nico and Mari (`src/player/characters.v2.js`; her name is `MARI.name` in `src/player/mari/index.js`). The one you are
not playing stays in the world (idle, in their car, or following you). Each keeps their own position, car, cash, weapons,
outfit, health and wanted level (the bank account is shared).

- `game.characters.list` -> `[{ id: 'nico' | 'mari', name, active, follow, place, pos }]`, `game.characters.active`.
- `await game.characters.switchTo('mari')` (sky cut; `{ instant: true }` skips the camera). Returns false while locked,
  dead or busted. A mission that must be played as one of them: `switchTo` in its start step, then
  `game.characters.locked = true` (no wheel / Switch app) and `false` again when it ends.
- `await game.characters.call(id)`: a subtitled phone call (story cast `vale`, `dex`, `lou`, `cisco`, or the other
  protagonist). Calling the other protagonist toggles "come help": they come and follow you, ride along as passenger
  and shoot at whoever fights you. Direct: `game.characters.summon('mari')` / `dismiss('mari')`.
- Events: `character:switch { from, to }`, `character:follow { id, on }`, `call:line { contact, who, text, index }`
  (voice hook). Call lines: `src/ui/phone/storyCalls.js`.
- Mari's start: the sidewalk in front of the dive shop on the Overseas Highway, Key Largo (-1164, 5473), her apartment
  is above the shop.
