# Intro v2: the robbery flashback (storyboard panels 5-7)

Plan: `docs/v2/plan/INTRO_V2_PLAN.md` step 3. Missions (all `marker: false`; chained by `src/story/intro.js`):

| Id | Panel | What |
|---|---|---|
| `intro2.robbery` | 5 | Cutscene: dusk, Mari outside Cafe Colada (red CAFE awning) looks across 21st St at Sunshine Payday Loans and decides. Playable: walk in, aim the pistol at the cashier behind the glass (he raises his hands, the customer cowers), E to threaten, he pushes a bag through the deal tray, E to take it, the customer grabs her from behind (mash Space, a red progress bar), the alarm (two stars) and two patrol cars with light bars, run out. Short cutscene at the door: "Police! Drop the bag!" |
| `intro2.escape` | 6 | Playable: two stars, police outside. Fire escape in the alley (two flights), across the roof of No. 5955 (AC units), plank bridge down to No. 5957, plank bridge up to No. 5956, the roof door of a narrow stair house, two flights down inside it, out into the service alley, lose the police (stars flash and drop), back to the coffee shop. |
| `intro2.arrest` | 7 | Cutscene: back at the cafe the dye pack goes off (pink cloud, dye on the bag and on her), two patrol cars with lights, a female and a male officer come up and cuff her from behind (arms behind the back), wide pull-back. |
| `intro2.counselor2` | - | Cutscene in Ms. Harlow's office (the counselor1 set and shots): the consequences (the plea, six years, the cashier), Mari's hopes (the dive shop in Key Largo, a room over the shop, "one of them, anyway"), the letter. |

## The place

21st St between Washington Ave and Euclid Ave, Miami Beach: low flat-roofed walk-ups. Frame, spots and builders:
`src/story/sets/robberyBlock.js` (block frame: origin at the payday shop, turned 0.0995 rad like the buildings).

- Sunshine Payday Loans: storefront 882, store type `payday` (`src/world/interiors/types/payday.js`): PAYDAY LOANS painted on
  the back wall, LOANS / CHECKS / CASH signs over a teller counter with a floor-to-ceiling glass partition and deal trays,
  two teller stations (monitor, keyboard, cash drawer, bill stacks), the back counter with cash stacks, a bill counter and a
  safe, a waiting row, a rate board, a brochure rack, CHECKS CASHED / PAYDAY LOANS neon in the barred window, the fascia sign.
  Streamed like every interior; `store.heist` holds the staging points.
- Cafe Colada: storefront 1028, store type `cafe_robbery` (`types/robberyCafe.js`, the shared cafe type, ventanita variant).
  The city shell hangs its own striped awning on this lot, so the missions cover it with a red one lettered CAFE
  (`buildCafeAwning`, mission-only).
- `game.interiorsV2.pin(id, on)` (engine.js): the engine keeps three interiors loaded, nearest first; the missions pin the shop
  and the cafe so both stay in while the player stands across the street.

## Efficiency

Everything the missions add is built in their setup and disposed by their cleanup (pass, fail, retry, quit): the escape route
(one merged mesh per material, cuboid colliders on one fixed body, one point light), the awning, the bag, the dye cloud,
staged actors, police cars, bone-pose hooks, the clock hold (dusk 18:55, paused while a flashback mission runs), the pins.
The two interiors are regular streamed store types (built within 70 m, disposed past 140 m).

## Test

`node tools/v2/story/intro2-robbery-test.mjs [--missions robbery,escape,arrest,counselor2] [--live <sess dir>]` drives the
player from inside the page (held keys, camera turned toward the next point), takes a shot per storyboard moment into
`docs/v2/shots/intro2/` (p5_*, p6_*, p7_*, p7b_*) and writes `report-robbery.json` (results, console errors, leftovers).
