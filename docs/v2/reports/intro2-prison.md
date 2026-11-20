# Intro v2: opening, prison cell, walk, counselor (storyboard panels 1-4)

Plan: `docs/v2/plan/INTRO_V2_PLAN.md` steps 1-2. Missions (all `marker: false`, started from code or the intro chain):

| Id | Panel | What |
|---|---|---|
| `intro2.opening` | 1 | Cutscene: night, rain, Little Havana side street (County Road 846), Mari boosting a red sedan, Nico walks up (it is the car he was hired to take), police light bar strobing a block up (plus two strobing point lights on the wet street). Black, "Two years later / Women's Correctional Facility", the cell block corridor, along the doors to her cell, Mari under the barred window. Ends with Mari in the cell. |
| `intro2.prisonCell` | 2 | Playable as Mari in her cell. Talk to Dolores (E): over-the-shoulder conversation cutscene; Officer Pratt calls her number and the steel door slides open. Objective: step out of the cell. |
| `intro2.prisonWalk` | 3 | Playable: follow the officer down the corridor (he waits and nags when she lags; inmates in the dayroom and by the wall call out as she passes). Cutscene at the office door, he opens it. |
| `intro2.counselor1` | 4 | Cutscene in the office: Ms. Harlow, the review board, early release, the arrest report; Mari starts to tell it; push-in and white-out into the robbery flashback. |

## The prison set (`src/story/sets/`)

- `setKit.js`: small closed mission sets: boxes / cylinders merged per material, box-projected UVs in meters (the interiors kit's
  procedural surfaces: cmu, concrete, vct, dropTile, laminate, fabric), Rapier cuboid colliders, real point lights (the perf
  guard's fixed light budget, so no shader recompiles), sliding / swinging doors with colliders that switch off when open,
  canvas pictures. `dispose()` removes meshes, geometries, materials, canvas textures, colliders, lights and door animators.
- `prison.js`: the set floats 300 m over the open Gulf (-7050, 300, 1500), where nothing else streams. `acquirePrisonSet(game,
  'full' | 'office')` builds or reuses it; `releasePrisonSet()` on mission cleanup; a watcher disposes it as soon as nobody holds
  it and the player is outside. While the player is inside: indoor exposure, no rain / haze / sun glare, clock held at 6:10,
  the HUD district reads "Women's Correctional" (the legacy shop manager's per-frame indoor reset is overridden while inside).
  Contents: Mari's cell (bunk with thin stained mattresses, steel toilet-sink, desk shelf, bolted stool, barred window, tally
  marks, photo), the 33 m corridor (two-tone painted block, polished concrete with yellow lines, grey steel doors both sides,
  fluorescent strips, conduit, camera dome, exit sign, sally-port gate), the dayroom (steel tables with bolted stools, caged TV).
- `prisonOffice.js`: the office (window with blinds behind the counselor, filing cabinets with a plant, framed palm print,
  calendar, desk with notebook / mug / monitor / phone, bulletin board, clock, bookshelf, swinging door). Reusable:
  `openPrisonOffice(ctx)` (builds, seats the counselor p194, puts Mari on her chair), `officeShots()` (frame + wide / over the
  shoulder shots), `SPOTS`, `officeSpot(name)`, `COUNSELOR`, `seatedPose(game, on)` (Mari's bench sit in a cutscene).

## People (Models/NPCs/NPC 194-200, `tools/v2/npcs/people.json`)

p194 counselor (Ms. Harlow), p195 corrections officer (Officer Pratt), p196 older inmate (Dolores, the cellmate), p197-p199
inmates, p200 payday-loan cashier (for the robbery mission). Places `prison_staff`, `inmate`, `payday_loan`: script-only.

## Framework changes (shared, small)

- `src/story/cutscene.js`: a player / end spot with its own `y` keeps it when teleporting (interiors above the terrain); the
  line / event timeline runs on the same real-time clock as the shots; `cs.shot`; `game.cutsceneSlow` for filming tests.
- `src/player/characters.v2.js`: `game.characters.stage(id, at)` stands the character you are not playing at a spot.

## Test

`node tools/v2/story/intro2-test.mjs [--missions opening,prisonCell,prisonWalk,counselor1] [--slow 4]`: plays all four, films
each storyboard shot into `docs/v2/shots/intro2/p1_* .. p4_*`, writes `prison_report.json` (results, console errors, whether
the set was disposed after leaving).
