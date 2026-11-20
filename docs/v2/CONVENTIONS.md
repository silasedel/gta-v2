# Southline conventions (written by stage 1; every later stage keeps this current)

How the world and the systems connect. If something here is wrong, fix the code or this file in the same commit.

## 0. Code style (user, Nov 19): readable, normally formatted code
Write code the way shipped game codebases read, not dense one-liners:
- One statement per line. No chains of statements joined with `;` on one line, no `if (...) { a; b; c; }` on one line.
- Lines up to ~100 characters. Break long calls, object literals and conditions over several lines.
- Small, named functions with a short comment on what and why, instead of long inline lambdas.
- Prettier is the formatter (`.prettierrc` at the repo root, `npm run format`). Format what you touch before committing.
- Comments explain decisions (why), not what the next line obviously does.

## 1. World frame and map
- Meters. **+X east, +Z south, Y up.** Heading 0 faces +Z; a direction from heading h is (sin h, cos h).
- The map is traced from the user's own images: roads `docs/v2/plan/map_roads_target.webp`, land/water/cover
  `docs/v2/plan/map_colour_target.webp`. **Road-image pixel (px, py) -> world x = (px - 700) * 11, z = (py - 800) * 11.**
- World bounds x -7700 .. 3883, z -8800 .. 7623 (the island is about 9.8 x 14.5 km). Sea level y = -0.12.
- Rebuild: `./tools/v2/map3/run.sh` (register + trace + build + runtime data, into `tools/v2/map3/out/`), then
  `./tools/v2/map3/publish.sh` (copies into `public/assets/miami/<build>/`, `public/assets/miami/world.json`,
  `public/assets/world/layout.json`). Builders: `tools/v2/map3/{register,trace,build_v3}.py`; runtime data:
  `tools/osm/merge.py` in no-OSM mode (`MIAMI_NO_OSM=1`, no real-Miami data). Overlay test: `tools/v2/map3/overlay_test.py`.
- Districts (name, center x/z, kind): see `ANCHORS` in `tools/v2/map3/build_v3.py`, also `layout.json` `places` and
  `districts`. Downtown (407, -110), Brickell (0, 1760), Edgewater (308, -1452), Little Havana (-660, -55),
  Miami Beach (2332, -660), South Beach (2398, 660), Dodge Island Port (1595, 792), Miami International Airport
  (-1210, 1045), Miami Gardens (715, -3080), Clewiston (-1540, -2805), Okeechobee (-2200, -6435), Fort Myers (-5335, -3960),
  Naples (-4730, -220), Homestead (-1320, 3190), Florida City (-330, 3520), Key Largo (-1155, 5500), Marathon (-2783, 6600),
  Key West (-4895, 5940). Regions: Everglades, Big Cypress, Lake Okeechobee. Waters: Biscayne Bay, Atlantic Ocean, Gulf of
  Mexico, Florida Bay.

## 2. Runtime world API (`game.city`)
- `groundHeightAt(x, z, y?)`, `isWater(x, z)`, `surfaceAt(x, z)`, `zoneAt(x, z)` (water, beach, nightlife, downtown,
  business, residential, commercial, park, port, causeway, industrial, airport, rural, wilderness), `districtAt(x, z)`,
  `streetNameAt(x, z)`, `bounds`, `seaLevel`, `playerSpawn`, `playerSpawnHeading`.
- **Road graph** `city.roadGraph`: `nodes[{id, x, z, y, edges, control}]`, `edges[{id, a, b, pts, cum, length, width,
  lanesFwd, lanesBack, oneway, speedKmh, name, ref, kind, bridge, elevated, surface, controlA, controlB}]`;
  `controlA/B` = control met when ARRIVING at node a / b: `'signal' | 'stop' | 'yield' | null`.
  Helpers: `nearestEdge(x, z, opts, maxDist, filter)`, `pointAt`, `edgesAt`, `turnAllowed`, `controlAt`.
  Navigation / GPS: `src/nav/*` builds on it (A* in a worker). Traffic: `src/vehicles/roadnet.js` (+ `signalState`).
- **Controls (stage 1):** rule based (US practice) in `tools/osm/roads.py controls()`: main x main = signal, main x minor
  = stop on the minor legs, minor 4-way = all-way stop, minor T = stop on the stem. Metro streets are `secondary`, so
  downtown corners are signalized.
- **Spawn points:** people: `city.randomSidewalkPoint(near, radius, zone)`, benches `city.benches`/`benchesNear`,
  lean spots `city.leanSpots`; cars: `city.randomRoadPoint(near, radius)` (on a lane of the graph). There is no separate
  parking-space table yet: park along curbs (right lane edge + 1.2 m) or in `plaza`/`paved` cover near storefronts.
- **Shop slots:** `city.storefronts` / `city.storefrontsNear(x, z, r)`: ground-floor shop lots with `{x, z, kind, street,
  facing, building}` (door on the street side, `facing` toward the street). Interiors attach to these (interior id =
  storefront id). Synthetic ground-floor shops (`synthShopsNear`) fill commercial streets.
- **Set pieces:** `layout.json` `setpieces`: `nico_house` (Key Largo, Pelican Point Ln, layout spot x -836, z 5272, heading 0.91; the built house stands at about x -1008, z 5174 after the r10 turn and shifts,
  lot ring, spawnX/Z in the yard), `keys_sign` (start of the Overseas Highway), `keys_bar` (Key Largo strip).
- **Key Largo by hand (keys pass, Nov 17):** Nico's yard and street corner are explicit data in
  `src/world/setpieces/nicoHouse/yard.data.js` (house-local frame of plan.js; built by parts/55_yard.js, dock by parts/06_dock.js
  from the user's pier kit), the neighbors and bay-shore docks in `src/world/dressing/keysStreet.data.js` (built by
  dressing/keysLots.js through the house generator's lots: `house.style/yard/over` overrides). Auto street lots stay out of
  `HAND_R` around the house; Nico's lot is `lots.reserve`d (no scatter). Converted dock / prop models:
  `public/assets/models/docks|keys/` (tools/v2/keys/build_models.sh), loaded by `nicoHouse/models.js`. Shots in house-local
  cameras: `node tools/v2/keys/shots.mjs --set X [--spots tools/v2/keys/spots_refs.json] [--ab "&keys=0"]`; `?keys=0` = before.
- **School:** `layout.json` setpiece `school` (~(457, -1354), Edgewater, 179 m from the Edgewater police substation) for
  the user's mission `docs/v2/plan/MISSION_SCHOOL_ABANDONED_CLASSROOM.md` (stage 2 builds the school, stage 4 the mission).
- **Robbery block (intro v2 flashback, Nov 19):** 21st St between Washington and Euclid Ave, Miami Beach. Store types that
  claim single lots: `payday` (Sunshine Payday Loans, storefront 882, `src/world/interiors/types/payday.js`; `store.heist`
  = store-local staging points) and `cafe_robbery` (Cafe Colada, storefront 1028, `types/robberyCafe.js`). Block frame,
  spots, the mission-only escape route (fire escape, plank bridges, stair house) and the red CAFE awning:
  `src/story/sets/robberyBlock.js`. `game.interiorsV2.pin(storefrontId, on)` keeps a lot's interior among the three
  active ones while a mission needs it (pinned lots within 70 m go first).
- **Fire alarm distraction:** `docs/v2/plan/DISTRACTION_FIRE_ALARM.md` (pull stations in casino, hotels, school, offices).
- **Rough district:** Overtown and Liberty City (district kind `ghetto`), buildings tagged `condition: rundown|abandoned`.
  At runtime the condition is `hash(id + 6101) < 0.18 ? abandoned : rundown` (same rule in `bldmodels.js` and
  `src/world/city/families.js`): worn walls, grime, window AC units, security bars, roll-down shutters, boarded and dark
  windows when abandoned, rusty metal roofs, graffiti, chain-link fences (with colliders) around the vacant dirt lots.
- **Police stations:** `src/gameplay/police/stations.js` `STATION_SITES` (district centers, snapped to the nearest road at
  run time). HQ: Southline PD Headquarters, Downtown (407, -110).
- **Jail:** use Southline PD Headquarters (407, -110) until a jail interior exists (stage 4 adds the scene).
- **Cameras:** speed / red-light cameras: put them at signalized nodes of `primary`/`trunk` roads in downtown/business
  zones (none in rural zones), security cameras on storefronts (stage 2/3).
- **Airport and docks:** airports: `src/world/airport/airports.json` (see Airports below; `layout.json airport` /
  `airfield` carry the same runway centerlines for the map); moorings `city.moorings` / `claimMooring` (boats); the port is Dodge Island (1595, 792).
- **Casino (Golden Palm Casino):** the curved spiral casino tower (Models/Buildings "Building 15") stands on a Miami Beach
  superblock centered at **(2183, -370)**, footprint about 130 m (x) by 117 m (z), main entrance facing **west onto Collins
  Ave**; Meridian Ave runs behind it (east side, ~40 m): use that side for the loading dock / back lot. Constant
  `CASINO` in `src/world/miami/bldmodels.js`; generated lots under it are cleared.
- **Library building models:** `src/world/miami/bldmodels.js` places the user's models (converted GLBs in
  `public/assets/models/buildings/`, see SOURCES.txt; converter `tools/v2/buildings/convert_v2.sh` + `models.json`: meters,
  origin at the footprint center on the ground, front toward +Z, WebP textures, `<name>_lod1.glb` far LOD, `<name>_col.glb`
  collision mesh) on fitting generated lots. Classes: `tower` (h > 60), `mid` (11-62 m office/band/glass/deco), `shop`
  (strip / commercial low-rise, motel, gas station, diner), `house`, `ind` (factories, garage rows), `hangar` (airport hangar
  lots), `rlow` (rough-side walk-ups and corner stores). Picks are deterministic per building id (neighbors with a smaller id
  choose first, no two neighbors share a model). One InstancedMesh per (model, material, LOD, condition) per 900 m cell; per
  instance: tint (instanceColor), mirrored copies of text-free models, shader weathering and lit-window share keyed on the
  instance origin, far LOD past ~400 m (towers) / ~180 m (houses, shops). Colliders are each model's own collision mesh
  (`collide()`), plus a plinth where the lot falls away. Roof / wall clutter (`addClutter`): roof vents and tanks on procedural
  roofs, fire escapes on brick walk-ups, utility cabinets, squatter shacks. `?libmodels=0` turns it all off. New models: add a
  row to `tools/v2/buildings/models.json`, run `convert_v2.sh <name>`, add a `LIB` row.
- **Airports (airports agent, Nov 19):** `src/world/airport/` (`airport.v2.js`, order 184, `game.airport`) builds Miami
  International and Key West International from ONE data file, `src/world/airport/airports.json`, generated by
  `tools/v2/airport/design.py` (runways, taxiways, aprons, stands with jet bridges, terminal, tower, hangars, wind socks,
  airside polygon = fence line, landside pocket, fence gates, pavement polygons). Change the design script, never the JSON.
  The map build drops every road / lot / tree / prop inside an airside (`build_v3.py` section 9d, at export; `MAP3_AIRPORTS=0`
  off) and makes it one `airport` land-use area (zone airport, flat: `relief.js` airport weight 0). Runtime parts: `pavement.js`
  (polygons, PBR asphalt / concrete, rubber in the touchdown zones, slab joints; joins the ground mask), `markings.js` (FAA
  paint as geometry), `lights.js` (one point-sprite draw per airport: edge / threshold / centerline / approach + rabbit / PAPI /
  taxiway / beacon; fixtures instanced), `terminal.js` (walk-in: sliding doors, check-in hall = the user's Terminal Hall 1,
  security, gate lounges, departure boards fed by the traffic), `structures.js` (towers, hangars, jet bridges, wind socks,
  taxiway signs, baggage carts, catering trucks), `fence.js` (no gaps: gates are closed leaves; `nearest()` for climbing),
  `climb.js` (Space at a fence: GTA-style climb over), AI traffic `src/vehicles/air/traffic/traffic.js` (land, taxi, park,
  push back, take off; liveries painted over the source brands by `livery.js`). Airside trespass on foot / by car emits
  `crime trespass` (police: true) and holds at least 2 stars; boarding: E at a gate podium (fare via the wallet) flies you to
  the other airport. `?airport=0` off, `?airtraffic=0` no AI flights, `?oldairport=1` the old bldmodels set. The old
  `AIRPORT` constant in `bldmodels.js` is empty unless `?oldairport=1`. Review: `node tools/v2/airport/shots.mjs --ap mia|eyw`.
  Models: `tools/v2/airport/convert.sh` (`models.json`) -> `public/assets/models/airport/`.

- **Street furniture (stage 1 jobs 4-5):** the user's library models, converted to `public/assets/models/street/*.glb`
  (`tools/v2/street-models/build.sh`, `signals.py`, `signs.py`; sources in `SOURCES.txt`), loaded by
  `src/world/miami/streetkit.js` (`city.streetKit`) and instanced per tile by `tilebuild.js` (global pools: one draw
  call per part material). Traffic signals: `src/world/miami/signals.js` lays out each signalized job-4 junction (US
  far-side mast arm on the far-right corner behind the crosswalk, one head per approach lane, post-mounted heads at
  narrow junctions and T stems, pedestrian heads at every crosswalk end, a controller cabinet, street-name blades on the
  arms). The lenses light in the shader from per-instance data with the SAME fixed-time plan as the traffic AI
  (`roadnet.js fixedSignal`: 34 s cycle, phase by approach axis, offset per node; `streetkit.signalPhase/walkPhase`):
  if the AI signal plan changes, change `streetkit.js` with it. Lamps: `lamp.t` picks the model (`lamp_single` davit
  arm default, `lamp_twin`, `lantern_post`; small `s` = lantern); `group.userData.psLamps` puts the clustered lamp
  light at each model's luminaire. Keys / rural lanes: wooden utility poles with wires + a davit lamp on every second
  pole, carts and rural mailboxes (`keysLane`). Regulatory signs (`src/world/signs/regulatory.v2.js`) use the library
  STOP plate and a repainted library plate for SPEED LIMIT. Audit: `node tools/v2/furniture-audit.mjs`.
- **Street props (overnight props pass, Nov 17):** more library props in `public/assets/models/street/`
  (`tools/v2/street-models/build_props.sh`: curbside cart, cone, channelizer, flex bollard, ROAD CLOSED barricade, jersey
  barrier, roll-off, site cabin, tarp crates, patio table / chair, cafe umbrella, planters, hot dog cart; brand text painted out
  by `fix_textures.py`). **Variants:** `variants.py` writes N edited copies of a prop's color texture (`var/<set>.jpg`), loaded
  as a texture array by `src/world/props/variants.v2.js` (`kit.variants[part]`); instances of such a part are drawn with
  `colors: true` and the instance color = `variantColor(layer, brightness, fade)` (tilebuild `kitParts` does this; items may
  carry `vl` / `vlFixed`). Items can carry `rx` / `rz` (lean) and `m` (a saved 4x4 pose) for the instance pools.
  **Per-house curb props:** `src/world/props/lotProps.v2.js` (`lotProps.add(owner, [{ kind: 'mailbox' | 'carts' | ... }])`),
  fed by the house generator (`curb` list from `yard()`, placed by `houses.v2.js`) and the spawn street (`dressing.v2.js`);
  `?lotprops=0` restores the old code-built boxes. **Physics:** `src/world/props/dynamicProps.v2.js` (`game.dynProps`):
  'push' props are sleeping Rapier bodies (carts, cones, barricades, chairs), 'knock' props are fixed until a vehicle hits them
  (post mailboxes, parking-sign posts, STOP / SPEED LIMIT posts near the player); collider shapes measured from the meshes by
  `propShapes.v2.js`; a hard hydrant hit gushes (`hydrantSpray.v2.js`). Work zones / construction sites: tilebuild
  `workZones()` (`props.work`, item `v` = part name; `window.__workNear(x, z, r)` for review). Review driver:
  `node tools/v2/street-models/props-shots.mjs --steps tools/v2/street-models/steps/final.json --set name`.

- **Cars (overnight Nov 17):** every road car is one of the user's models (`Models/Cars`, converted by `tools/v2/cars/`,
  runtime `src/vehicles/glb/`, see `src/vehicles/README.md` section 0). Park a specific car with
  `game.vehicles.spawnParked(key, { x, z, heading, color, wear })`; static covered car: `game.vehicles.placeStatic('covered1', ...)`.
  Nico's yard cars: `game.vehicles.nicoCars` (gray pickup with a black hood stripe, faded pale-blue classic).

- **Vegetation (overnight Nov 17):** every tree / palm / shrub is one of the user's library plants: converted by
  `tools/v2/vegetation/build.sh` (`species.json` -> `public/assets/models/vegetation/<key>.glb` + `_lod1.glb`), registered in
  `src/world/vegetation/species.js` (models + species GROUPS), loaded by `models.js` (impostor baked at load). Placement:
  countryside streamer (`countryside.js`, biomes), city tiles (`tilebuild.js` greenery: palms by zone, street trees, bushes,
  tree grates only on city sidewalks), set pieces via `game.vegetation.field(kind, items)` / `place(kind, x, z, opts)`.
  `game.vegetation.block(x, z, r)` keeps an area free; plants never stand where a static collider sits above the ground.
  `?veglib=0`: procedural plants only (A/B). Shader variation per instance: mirror, twist, bend, crown spread, frond droop, color jitter.

- **Everglades (r7, Nov 18):** `src/world/everglades/` (`everglades.v2.js`, order 160, `game.everglades.stats()`), active
  within ~500 m of the districts Everglades / Everglades City / Big Cypress: tannin film + duckweed + lily pads on the open
  water (`water.js`), procedural cypress domes / strands with trunk colliders (`cypress.js`), Spanish moss (`moss.js`), snags
  and knees (`snags.js`), gators / egrets / herons (`wildlife.js`, the user's Alligator 1-3 in
  `public/assets/models/everglades/`, `tools/v2/everglades/build_models.sh`), dawn mist (`mist.js`), and the camps
  (`camps.js`: Gator Gus Airboat Rides with 3 rentable airboats, $25 on boarding via `game.wallet.pay`; stilt fish camps,
  tarp shack, airboat-only island shack; sites found on the map data near target points in `PLACES`, people by cast id via
  `game.npc.spawnPosed`). `?gl7=0` off, `?gl7parts=water,moss` subset. Shots: `tools/v2/everglades/shots.mjs`, `check.mjs`.
  r7b: the user's Nov 18 downloads (bald cypress + its moss, great blue heron, RV trailer, oil drums, junk car, flatbed, mossy
  stone) are aged / regraded by `tools/v2/everglades/age_tex.py` and converted by `build_models.sh` (`X=` / `A=` section).

## 3. Rendering rules (stage 1)
- Locked 1080p-class internal resolution; TAA in every preset; no film grain. Any screen-space dither must use the
  per-frame offset `uFrameN` from `src/render/frameNoise.js` (TAA resolves it).
- Global shader patches (imported first in `main.js`): `src/render/specularAA.js` (specular anti-aliasing) and
  `src/render/wetSurfaces.js` (weather wetness; opt out with `material.defines.NO_WET`).
- `src/render/detailCull.v2.js`: objects under ~1.6 px are not drawn; small far objects skip shadows. Set
  `userData.noDetailCull = true` to opt out.
- Merge static meshes per material (`src/render/staticBatch.js` helper); instanced props; one mesh per material per tile.
- City draw calls (Nov 19): the streamed tiles' opaque non-casting meshes are drawn from shared BatchedMeshes per material
  (`src/world/miami/tileBatch.js`, ~24 tiles per batch, `?tilebatch=0` = old); the originals stay in the tile (raycasts) and
  read invisible only while the scene renders. Prop pools with nothing in view are hidden (`?poolhide=0`). A tile material
  that needs per-object state must set `userData.noTileBatch`. Measure: `node tools/v2/perf/drawcalls.mjs`.
- Shop interiors (Nov 19): groups are named `shop:<key>` (V2), `shop1:` / `shop1-in:<key>` (v1). V2 `Geo.buildIter({ merge: M })`
  merges materials that differ only in color / roughness / metalness (`surf`, `flat`, opaque `page`) and every `glow()` into one
  material each, values in vertex attributes (`color` + `rm` / `glw`); v1 `Bucket.build` does the same for plain untextured
  materials. Fixture geometry (`G.fine`) and products draw only within 48 m of the player (`engine.js applyDetail`, coarse
  prefix via `drawRange`). A material that must keep its own mesh: leave `userData.mergeable` unset. A/B: `?shopmerge=0`,
  `?shopdetail=0`.
- Dynamic shadow map (cars, people): every frame whenever a car near the player moves, half rate only for scenes of
  walkers (`game.dynShadowHalfRate`: unset = auto, `true` = always half, `false` = always full). A stale map shows as a
  shadow that jumps every other frame.
- Sun shadows: far static map (city, 300 m), near static cascade (+-40 m, 2 cm texels, `game.shadowNear = false` for
  A/B), dynamic map (+-42 m). Soft-shadow / AO / any per-pixel noise must converge under TAA in one 16-frame cycle:
  use a per-pixel offset plus a golden-ratio step per frame (`uFrameN`), or an interleaved 4x4 pattern plus a resolve.
- Lit opaque built-in materials write their ambient light share to alpha in the main scene pass (look3.js); the contact
  AO darkens only that share. Code that renders the scene into its own target is unaffected (`LOOK_V.z` is 0 there).
- Round-2 look A/B in one session: `game.lookR2 = false` restores the overnight look3. Knobs: `game.lookCloudShadows`
  (ground cloud shadows), `game.lookShafts` (volumetric sun shafts; auto at low sun), `game.lookShadeAmb` /
  `game.lookShadeBounce` (sky cut / bounce in cast shadows), `game.lookExpR2`, `game.lookAOR2`, `game.lookHazeR2`.
- **Cinematic look (Nov 19).** `src/render/cine.js` nudges the grade, bloom and haze every frame: golden hours by the
  clock (6-9, 17-20), filmic saturation / S-curve, vignette, a golden-hour haze floor (`LOOK_V.y`, read in fogChunks.js)
  and screen-space sun shafts (`src/render/sunRays.js`, quarter resolution, added in the grade via `tRays`). A/B:
  `game.lookCine = false` or `?cine=0`; tunables `game.cine`. Hero (Nico / Mari) material: no ground-wetness patch
  (`NO_WET`), its own satin wet look, a sky / bounce fill that rises when the sun is weak, a backlit sun rim
  (`src/player/nicoTripo/index.js`, `?herolight=0` = old).
- The sky's cumulus field is world-anchored (`env.cloudBase` m); post.js repeats `cloudShape()` for the cloud-shadow
  map: change both together.

- **No coplanar faces (Nov 18).** Anything drawn on another surface (trim, casing, decal, sticker, paint line, pad) either has
  real thickness in front (5 mm or more) or `polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2` (decals
  -2 / -4). Never two faces in the same plane, never the same mesh built twice in one place (LOD copies must hide each
  other). Check a view with `await game.zfight()` in a session or `node tools/v2/render/zfight.mjs` (names both meshes).
- **Lights (Nov 18).** Over the 16 point / 4 spot budget, lights fade (~0.3 s) instead of popping (`perfGuards.v2.js`,
  `?lightfade=0`); street lamps use the clustered lamp system (`game.env.lamps`, 16 per 22 m tile, strongest first).
  Auto exposure eases with a dead zone and a 0.7 stop/s cap (`post.js`; `game.lookAESnap = true` = old).
- **Frame smoothness (Nov 18 night).** No per-frame garbage in hot paths: no `Math.hypot` (use `Math.sqrt(x*x+z*z)`), no
  array literals / destructuring `for (const [a, b] of ...)` per sample, no `Map`/`Set` `for...of` per frame (keep an array
  or use `forEach` with a function made once), return scratch objects instead of new arrays. Streamed groups that may need
  new shader programs go through `game.shaderWarmWrap(group)` (children stay hidden until their programs link, no frame
  stall). Generated houses are built once per lot and LOD (`houses.v2.js` build cache, typed arrays, LRU 160 MB); a map
  footprint under a hand-placed spawn-street lot is not built a second time. Auto exposure reads back with its own fence
  (`getSyncParameter`, never `clientWaitSync`; `?aeread=three` = old). Measure: `node tools/v2/freeze-probe.mjs --secs 60
  --still 30 [--heapalloc 1]`; live session for experiments: `node tools/v2/render/sess.mjs --dir <d>` (write `c<N>.js`,
  read `r<N>.json`; `//heap start` / `//heap stop` for an allocation ranking).
- **Frame budget / benchmark (perf lead, Nov 19).** The 60 fps gate is measured in the Mac app, not headless:
  `node tools/v2/bench.mjs --label <x> [--web <vite build dir> | --app <Southline.app>] [--preset high] [--jsflags "..."]`
  plays a fixed route (`src/perf/bench.v2.js`, `?bench=<label>`; Mac app `--ps-bench=<label>`): spawn, walk, drive the
  Keys, downtown, beach, downtown at night; report `docs/v2/reports/bench-<label>.json` (p50/p95/p99, frames over
  16.7/25/33/50/100 ms, per-segment system times, worst frames with what ran, GC count, console errors) + summary lines in
  the test profile's app log. Teleport settles are recorded apart (load screens). CPU / allocation profile of the same route
  over DevTools: `node tools/v2/bench-prof.mjs --web <unminified build> --segs downtown,night --heap 1`.
  Rules from the measurements: no CPU readback of GPU data in a frame (`readPixels`, `getBufferSubData`, `getImageData` on
  an accelerated canvas: create canvases you read with `willReadFrequently`); never ray-test the whole scene
  (`scene.traverse` + `Raycaster` against every InstancedMesh); a new shader program is never first-used in a frame
  (`src/perf/shaderGate.v2.js` skips the draw until it links; `?shadergate=0` = off). The same module draws transparent
  double-sided materials in one pass (`forceSinglePass`, `?singlepass=0`) and gives each shadow caster class its own depth
  material (`?shadowdepth=0`): never flip `material.side` / `needsUpdate` per frame. `world.updateSceneQueries()` is cheap
  now (`src/perf/physicsGuard.v2.js` skips it unless colliders changed); physics spawn-spot queries have a per-frame budget
  (`vehicles.js spotQ`). The frame cap defaults to 60 with even pacing on 120 Hz panels (`perfGuards.v2.js`).
- **Water edge (Nov 18).** The ocean reads the opaque scene depth (copied before its first pass) for the true water depth
  near the shore: ground meeting the water needs no special mesh work; `?softshore=0` = old edge.

- **Road surfaces (roads pass, Nov 19).** Curbs are one poured concrete profile (`src/world/miami/curbs.js`: gutter pan 7 mm over
  the asphalt, battered face, rounded nose, baked AO / wear in vertex colors, same sidewalk batch); slab and curb-strip edges that
  face lawn slope into the ground (no vertical box faces). The asphalt gutter strip at junction corners is off with it. Owned
  (elevated) edges whose ramp stops short of a ground junction get the missing at-grade stretch from `groundTail` (tilebuild); pieces
  cut at a tile seam tuck a 0.2 m flap under the neighbor (no hairline at seams). `?roadfix=0` = all of it off, `?curb3d=0` = old
  curbs. Audit: `node tools/v2/road-audit.mjs --surface --set <name> [--near x,z,r]` (every road tile built off-scene,
  `tools/v2/road-surface.page.js`; report `docs/v2/reports/road-surface-<set>.json`); shots `node tools/v2/roads/shots.mjs --set <s>`.

## 4. Events (`game.emit` / `game.on`)
- `crime` `{ type, position|pos, severity?, by?: 'officer'|'witness'|'alarm'|'camera'|'self', witnesses? }` — types in
  `src/gameplay/wantedCore.js SEV` (assault, shoplift, vehicle_theft, carjack, trespass, vandalism, speeding, red_light,
  reckless, weapon_display, ...). Stars exist only once a crime is known to the police.
- `wantedChange` `{ level, before, reason }` — `game.wanted` (0..6 stars, `MAX_STARS = 6`, search radius per star
  `SEARCH_R`); the HUD reads it. The top-right corner (`src/ui/hud/corner.js`, matches
  `docs/v2/plan/hud_corner_target.webp`) shows `game.wanted.level` as charcoal stars and flashes them while
  `game.wanted.evading` (police lost sight); `game.hud.setWantedFlash(true|false|null)` forces the flash (null = auto),
  `game.hud.setKnown({ cameras, witnesses, outfit, face, weapon })` forces the five evidence badges (null = read
  `game.evidence`). Test: `node tools/v2/hud-shots.mjs`.
- `money` `{ account, amount, balance, entry }` (`src/systems/money.js`).
- `mission:start` `{ id, replay? }`; missions also emit progress through `game.story` (stage 4).
- `weather` `{ kind, prev }`, `lightning` `{ x, z, distance }` (`game.weather`, stage 1).
- Other common ones: `enterVehicle`, `crash`, `shot`, `hit`, `punch`, `arrest`, `witness`, `footstep`.

## 4a. Police and wanted API (police track, Nov 19) — for missions, the heist and anything that needs the law
Code: `src/gameplay/police.js` (units, cars, tactics), `src/gameplay/police/` (law glue, arrest, response, comms, radio,
stations, models), `src/gameplay/wantedCore.js` (six-star state machine, pure), `wantedSense.js` (witnesses, cameras),
`evidence.js` (what the police know). Tuning: `docs/gameplay/police_tuning.md`.
- **Rule: stars only come from a known crime.** Report one with `game.emit('crime', { type, position, severity?, police?,
  witnessed?, store?, witnessName?, victim? })`. `police: true` = an officer saw it (known at once); otherwise witnesses,
  cameras or an alarm must report it first. Unknown types need a `severity` (0..3) or they are ignored. NPC 911 calls
  (`'witness'` events from src/npc) only corroborate a recent player crime nearby; they never create one.
- `game.wanted`: `level` (0..6), `phase` ('clean' | 'search' | 'pursuit'), `seen`, `evading` (stars flash), `searchArea()`
  `{ x, z, radius, progress }`, `lastKnown()`, `bounty`, `heat`, `description()`, `evidence` / `snapshot()` (what they know),
  `add(stars, pos)` (an officer-witnessed bump), `set(stars, pos, { visual })` (scripted: missions, heist alarm), `clear(reason)`,
  `closeCase(why)`. `game.wanted.law.S.history` = every star change `{ t, level, before, reason }` (reason = crime type).
- `game.police`: `dispatchUnit({ swat?, near? })` (send one more car), `spawnCop(pos, heading, car?, { swat? })`,
  `units`, `cars`, `blocks`, `stations`, `hardReset()`, `perf` `{ ms, idle }`, `arrest` (below), `comms.shout(unit|null, text,
  { who, priority })`, `response.stats` `{ helis, heliOn, spikes }`.
- `game.police.arrest`: `setSurrender(bool)` (hands up; H on foot), `surrendered`, `holdFire()`, `startJail(info)`.
- Events: `wantedChange` `{ level, before, reason }`, `wanted:phase` `{ phase, before }`, `wanted:report`, `wanted:escaped`
  `{ peak, bounty }`, `wanted:manhunt` `{ bounty }` (6 stars), `wanted:callIgnored`, `crime:reported`, `police:radio`
  `{ speaker, text, code, priority }`, `police:shout` `{ who, text }`, `police:stop` (1-star stop), `police:tased`,
  `police:surrender`, `police:pit` `{ vehicle }`, `police:heli` `{ on, name }`, `police:released` (after the jail scene),
  `arrest` `{ fee }` (gameplay.js), `playerDied`.
- Star levels (GTA V scale): 1 = warrant-style stop (officers shout, 6.5 s to comply; run and it becomes 2), taser,
  arrest; 2 = more units, taser, armed suspects get shot; 3 = shoot on sight, PIT, roadblocks + spike strips, helicopter;
  4 = SWAT vans, rifles, heli marksman, window shooting; 5 = more of everything; 6 = TIDEWALL manhunt: second helicopter,
  three SWAT vans, statewide $50,000 bounty. Escape = break line of sight, leave the flashing search circle, hide, or stop
  matching the description (other car, mask).

## 4b. People (the user's Tripo people, Nov 17)
- Assets: `public/assets/npc/people/<id>.glb` (p01..p95 = `Models/NPCs/NPC n`), textures `<id>_a.webp` (1K albedo),
  `_n.webp` (512 normal), `_o.webp` (ORM), close-up `_a2.webp` (2K), `_a4.webp` (4K) + `_n2.webp` (2K normal);
  `index.json` rows: `{ id, name, g, age, years, role, places, height, hipH, tris, cols }`. Cast list (heights, roles,
  places, hat height, logo boxes): `tools/v2/npcs/people.json`; rebuild `tools/v2/npcs/build.sh [ids]`.
- Skeleton: the 52 Mixamo-named joints of the archetypes (`mixamorig:Hips` ... fingers), canonical T-pose rest; the clip
  library `src/npc/arch/anim.js` drives everybody (`src/npc/people/lib.js` shares one bound clip set).
- Locomotion (Nov 19b): walk / run / base idle cycles are Mixamo motion capture (`Xbot.glb`, `Soldier.glb`) baked by
  `tools/v2/npcs/bake_mocap.mjs` into `src/npc/arch/mocap.data.js` (canonical parent-relative deltas, no fingers);
  `MOCAP_STYLE` in anim.js derives walk_f / walk_heels / walk_old / walk_brisk / jog / sprint. Foot sync: a captured
  clip's speed is the mid-stance ankle speed; the cycle advances by real distance over stride. `?mocap=0` = old gaits.
- Crowd tier detail (Nov 19b): `farCrowd.js` instances switch to the person's LOD1 within 45 m and LOD0 within 10 m
  (same bone texture and material, buckets per person + LOD); `?farlod=0` = LOD2 everywhere.
- Women's secondary motion (Nov 19b): `src/npc/people/jiggle.js` (Mari's spring model and painted weights from
  `src/player/mari/jiggle.js`), women of the user's people within 12 m at LOD0, at most 6; `?npcjiggle=0` off.
- Places (roles -> where they spawn, `src/npc/people/cast.js placesFor`): street, residential, keys, rural, farm, dock,
  fishing, port, work, industrial, business, nightlife, bar, tourist, beach, beach_walk, swim, sport, park, rough,
  shop_staff, shop_guest, kitchen, hotel_staff, security, medic, lifeguard, police, police_swat, police_detective.
- API: `game.npc.createPed({ zone, act, pos, gender })` (crowd; people first, archetypes as fallback, `?people=0` off),
  `game.npc.createCop({ pos })` (police model hook, SWAT armor at 4+ stars), `game.npc.spawnPosed({ place: 'cashier' |
  'kitchen' | 'bar' | 'hotel' | 'security' | 'lifeguard' | 'dock' | 'medic' | 'farm' | ..., pos, rot, pose })` (staff),
  `game.npc.cast` (people list, `stats()`, role posts: lifeguards on the sand by day, fishermen at moorings).
  A character with `c.human.person === true` is one of the user's people; `c.personMeta` is its index row.
- Rules: the same person never twice within 320 m (the crowd radius); per spawn height +-3 % and a slight tint; no added glasses/bags.
- Groups (r7, Nov 18-19): `src/npc/people/groups.js` (themes friends / seniors / teens / workers / business / family /
  night; `groupMate(theme, first, person, slot)`). `game.npc.createPed({ ..., cand })` and `cast.farPerson(..., cand)` take a
  filter on index rows. `game.peds.groups` / `groupStats` / `clearWhy` (why a member spot was refused), `game.peds._crowd(c,
  zone, n)` (test hook). Standing people skip the character controller and hold their ground height.
- Player memory: `game.peds.remember(ped, 'hurt' | 'threat' | 'helped')`, `game.peds.deeds` (by identity id). Hurt /
  threatened -> they back off or run when he comes near again; helped -> a greeting. Reactions get `byPlayer`: 911 calls
  only for what the player did.
- Walking: `src/npc/walk.js obstacleSteer` (trunks, poles: static ray ahead), `carYield` (on roads without a sidewalk they
  step to the verge for an approaching car; `updateCarList` once a frame in peds.update).
- Smart peds (Nov 19, `?pedsmart=0` = before): building footprints for people come from the map rings rasterized per
  data tile (`src/npc/bldMask.js`, `game.peds._nav.inBuilding(x, z)`, `.bld.segmentFree/lastFree`); edge sides whose
  lane runs through buildings are closed (`_nav.sideOpen(edge, side)`), corner routes never cut through a building or the
  road and cross streets only at real junctions (3+ streets, not driveways / service lanes). At the curb both tiers wait
  in `walk.js crossWait` (walk phase at a light + no moving car over the crossing line within the time to cross,
  `crossingClear`), then cross without stopping. Crowd walkers window-shop at their destination half of the time.
  Audit: `node tools/v2/npcs/ped-audit.mjs --hour 12 --tag after [--q "&pedsmart=0"] [--prof]`.
- Beach towels: `src/npc/beachTowel.js makeTowel / drapeTowel / makeBeachThings` (terry scan textures in
  `public/assets/npc/towel/`); the towel is re-laid under the settled body (head to heels). `?lowerlegs=0` = old leg pose.
- Footsteps: `game.footSurfaceAt(x, y, z)` (`src/player/footSurface.v2.js`): `userData.surface` tags,
  `game.footSurface.tag(obj, s)` / `tagCollider(collider, s)`, else the floor under the feet; 'water' only when wading.

## 4c. Activities (src/activities, Nov 19) — standalone things to do; missions / the heist may call these APIs
- Folder `src/activities/` (auto-loaded `*.v2.js`, orders 182-192). Placement data: `src/activities/sites.data.js` (edit there
  to move or add a site; every spot is snapped to the map at run time). Shared helpers `src/activities/common.js`:
  `getHub(game)` = `game.activityHub` (site streamer: `H.site({ id, x, z, on, off, build, drop, tick, anchor?, busy?, force? })`
  builds a site inside `on` m and drops it past `off` m, so far activities cost nothing; `H.apis` lists every activity API),
  `blip(game, { x, z, kind: 'jetski'|'yacht'|'job'|'danger', color, label })` / `unblip` (minimap + pause map through
  `game.mapBlips`), `say(game, who, text, ms, color)` (bottom-center subtitle line), `pill(owner, html, warn)` (top-center
  timer / status), `payCash` / `earnCash` (wallet + register sound), `findShore(game, x, z, opts)`, `loadGLB(path)` + `fit()`.
  Prompts use `help(game, owner, html)` from `src/jobs/kit.js` (never clobbers another owner's text).
- `src/activities/crew.js` `createCrew(game, { peds, name, knife, noticeR, mug, onEnd(outcome) })`: a hostile group that
  notices you, taunts, tries to mug you (E hands over up to 35 % of your cash, max $400), and fights as a group (a knife
  carrier cuts for 7). Outcomes: paid | beaten (they drop $40-150) | fled | calm | lost. Used by the subway and the gangs.
- **Jet ski rentals** `game.jetskiRentals` (`jetski/jetski.v2.js`): stands at `JETSKI_SITES` (South Beach, Miami Beach,
  Key Largo). E at the counter -> plan (3 min $45 / 8 min $95) + $50 deposit -> F at the ski. Return = get off within the
  return marker (deposit back minus $5 per 15 s late); abandon = 15 s off it and 140 m away (deposit kept); a stand ski
  taken without paying = `crime vehicle_theft` (witness). API: `rent(siteId, plan)`, `endRental(returned)`, `rental`,
  `skin(boat)`, `locate(siteId)`. Every `jetski` in `game.boatSystem` is re-skinned with the code-built PWC
  (`jetski/model.js`, exposes `b.visual.parts.wheel` so the player seat solver poses the rider; `rider.js` then puts his feet
  in the footwells) and gets a rooster tail + turn spray through `boatSystem.wake.spray`. `?jetski=0` off.
- **Subway life** `game.subwayLife` (`subway/subwayLife.v2.js`), on top of `game.metro` (read-only use of its `mode`, `here`,
  `root`, `stations`): every arrival on a platform spawns the station's regulars (`SUBWAY_CAST`): hobos at a camp end
  (cardboard, bags, burning drum), one who asks for change (E $5) and may get pushy, and a chance of a crew at the other end
  (crew.js). Peds are pinned to the platform with `ped.v21 = { y }`. `subway/boards.v2.js`: next-train LED boards over the
  platform (destination, minutes / ARRIVING / BOARDING / DOORS CLOSING, scrolling notices), Platform 1 / direction signs and
  the station PA as subtitles; reads `game.metro` only. `?subwaylife=0` off.
- Casting: `castPed(game, pos, outfit, tries, any)` retries `peds.spawnAt` until the person fits (gang / rough /
  security); `stillOurs(ped)` tells whether the crowd recycled a ped since (see REQUESTS.md, Nov 19). Staged people use
  `game.npc.spawnPosed({ person: 'pNN' })` with the right role from `public/assets/npc/people/index.json` where it matters.
- **Yacht party** `game.yachtParty` (`yacht/yachtParty.v2.js`, yacht = `yacht/partyYacht.def.js` built with the yacht kit):
  private pier + "Midnight Tide" moored stern-to at `YACHT_PARTY` (South Beach bay side, Sunset Harbour, ~(2060, 372)). Status `outside | guest | staff |
  sneak | banned`; ways in: look the part (wardrobe score: dress shoes, gold watch, long pants, smart shirt), "on the list"
  gamble, bribe ($250 cash), staff uniform (valet / security / delivery disguise), or E at the stern ladder from the water.
  Suspicion (sneaking near the deck guard, pickpocketing) -> spotted -> the guard throws you overboard (banned 4 min); hit
  security -> fight + `crime trespass`. API: `admit(how)`, `spot(why)`, `throwOut()`, `talkToBouncer()`, `looks()`, `state`.
  Events: `activity:start { id: 'yachtParty', how }`, `activity:yachtSpotted`, `activity:end { outcome: 'thrownOut' }`.
- **Dock shift** `game.dockJob` (`dock/dockJob.v2.js`): Gulfstream Stevedores yard beside the nearest port road to
  `DOCK_JOB` (Dodge Island). E at the foreman: carry 5 crates to the van (carry pose `dock/carry.js`), hold E on 3
  container seals, clock out -> `wallet.wage({ job: 'dock_worker' })`, "Shift complete" card (`game.passed`), `jobEnd`.
- **Ambient life** `game.ambientLife` (`ambient/ambient.v2.js`): street performers (`AMBIENT_PERFORMERS`: gold living
  statue, street dancers, bucket drummer with a synthesized beat; E tips $5), fishermen on seawalls (`AMBIENT_FISHING`),
  hobos on cardboard along walls in `HOBO_DISTRICTS` (E $5; they fight back), corner crews in `GANG_DISTRICTS` (Overtown,
  Liberty City; crew.js, one at a time, 60 s cool-down). `?ambient=0` off, `?ambient=perf,fish,hobo,gang` subset.
- Events from activities: `activity:start { id, ... }`, `activity:end { id, ok|outcome }`, `activity:crewFight`; the dock
  shift also emits `jobEnd` (the "passed" stinger listens). Activities never start missions; a mission can call the APIs.
- Test driver: `node tools/v2/activities/repl.mjs` (one booted browser, commands through `tools/v2/activities/do.mjs`).

## 4d. Music: Mission Passed sting and menu music (Nov 18)
- **Mission Passed sting** `game.audio.missionPassed()` (`src/audio/passed.v2.js`): plays
  `public/assets/audio/stingers/mission_passed.ogg`, a 7.2 s cut of the user's theme (`music/theme/port_solana_theme.aac`,
  9.60 s .. 16.80 s, starts on the drop, 2.2 s fade out). Radio and music buses duck under it. Returns a promise (true when
  it played; one at a time). `game.audio.missionPassed({ title: 'Mission Passed', sub })` also shows the big title card;
  `game.passed.play({ title, sub })` is the same. Missions call it on success; `jobEnd` (ok), `activityEnd` (success),
  `turfFightEnd` (won) and `businessBought` already trigger it.
- **Menu music** (`src/audio/loadingMusic.js`): the Sleepwalking loop (`music/theme/loading_loop.flac`, sample-accurate
  loop) plays from the boot loading screen through the title, the menus and the second loading screen as one continuous
  loop, and fades at the reveal. `start()` while it plays only takes it over (no restart). The theme no longer plays on the
  title. Setting `menuMusic` (Audio) turns it off.

## 5. Notes for later stages
- Stage 1 status, open items and measured fps: `docs/v2/briefs/STATUS_stage1.md`.
- Model requests: `docs/v2/briefs/MODEL_REQUESTS_stage1.md`.
