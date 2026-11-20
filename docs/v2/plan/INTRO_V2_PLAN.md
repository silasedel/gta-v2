# Intro v2: two characters (Mari and Nico)

The user's final outline (written with ChatGPT, Nov 19) and a 12-panel storyboard. Build it exactly in this order, from the
start of a new game until the first house and free roam, using the existing world and assets. Every shot must look
cinematic: golden or night grade, shallow depth of field in close-ups, motivated light, letterbox in cutscenes, no
floating props, no clipping, faces lit.

## Sequence

1. **Opening cinematic (cutscene)**: how Nico and Mari first met, then a transition to Mari inside a prison.
   - Storyboard panel 1, FIRST ENCOUNTER: night, wet street, palm trees, police lights (blue/red) in the background.
     Nico (white t-shirt, stubble) and Mari (tank top, hair tied back) stand close by a car, talking low and tense.
     "The two main characters meet during a stolen car situation involving police."
2. **Prison introduction (playable as Mari)**
   - Panel 2, PRISON CELL (playable): grey concrete-block cell, small barred window high up, metal bunk bed with a thin
     stained mattress, steel sink and toilet. Mari (tank top, ponytail) seen from behind; her cellmate (older Black woman,
     orange jumpsuit) sits on the lower bunk. Control Mari, talk to the cellmate.
   - A guard opens the cell and escorts her.
   - Panel 3, PRISON WALK (playable): long corridor, grey steel cell doors both sides, fluorescent ceiling lights, a
     male guard (dark uniform, duty belt) walks ahead; follow him to the counselor's office.
   - Panel 4, PRISON INTERVIEW (cutscene): office with a window with blinds, filing cabinets, a framed palm picture, a desk
     with a notebook and a mug. The counselor (woman, 50s, curly hair, glasses, green cardigan, lanyard) asks about the
     arrest and a possible early release. Over-the-shoulder shots. Transition into a flashback.
3. **Robbery flashback**
   - Cutscene: Mari leaves a coffee shop and decides to rob the payday-loan business nearby.
   - Panel 5, PAYDAY LOAN ROBBERY (playable): small shop, "PAYDAY LOANS" painted on the wall, signs (LOANS, CHECKS,
     CASH), counter with a glass partition, a computer, stacks of cash. The cashier (heavy-set man, glasses, floral
     shirt) raises his hands. Aim the gun at the cashier, threaten him, collect the money.
   - A customer grabs her: break free (button-mash / QTE).
   - Run outside as police arrive.
   - Panel 6, ESCAPE (playable): dusk, rooftops with AC units and parapets, palm trees and police cars on the street
     below. Escape across rooftops, through buildings, along streets. Temporarily evade the police (wanted level drops).
   - Head back toward the coffee shop.
   - Panel 7, ARREST (cutscene): outside the cafe ("CAFE" awning, red), police cars with lights, a female and a male
     officer handcuff Mari from behind. The stolen cash released a dye pack (red/pink dye on her and the bag).
   - Back to the counselor's office: consequences of the robbery, her hopes for release.
4. **Switch to Nico**
   - Cutscene: Nico working with criminal associates on a tropical coast (Keys). A smuggling operation with a small
     aircraft and a motorboat.
   - Panel 8, SMUGGLING RUN (playable): Nico drives a white center-console motorboat across turquoise water, a small
     single-engine plane flies low ahead. Follow the aircraft over the water.
   - Panel 9, COLLECT PACKAGES (playable): wrapped bales floating in the sea; collect them.
   - Discover one associate has been captured by a gang. Travel to the gang's remote island camp.
5. **Swamp rescue (playable)**
   - Panel 10, SWAMP INFILTRATION: dense swamp, cypress/oak trees with hanging moss, tall grass, a stilted wooden shack
     with a porch and warm lamp light, armed gang members. Reach the camp, approach the buildings, sneak or fight.
   - Panel 11, RESCUE: firefight across the camp (muzzle flashes, rusty barrels, a weathered red/grey shack). Search the
     camp, enter the shack, untie the associate, escape through the remaining enemies. Optional: recover stolen cash
     from a trailer. Reach the seaplane at the far dock.
6. **Seaplane escape (playable)**
   - Panel 12: a white and red floatplane takes off from the water, spray behind it, palms and stilt houses on the shore.
     Board, take off, fly back across the islands to the employer's marina, land on the water, reach the dock.
   - Cutscene: the job is done; transition to Nico's house.
7. **Free-roam unlock**: the house is the first home base; the game is fully free and normal from here.

## Characters and models

The new Tripo models are in `Models/_Incoming_nov19_intro/` (FBX + textures in zips). File names say what each one is:

| Zip id | Model | Role |
|---|---|---|
| 0804a034 | professional_woman | prison counselor (panel 4) |
| aea8439e | police_officer | prison guard / escort (panel 3) |
| 16d56c01 | prisoner | Mari's cellmate (panel 2), check gender |
| c29e6b8c, e1b37aaf, fbb8e42b | female_prisoner | inmates in the cell block and yard |
| 009b7435 | man_standing | payday-loan cashier (panel 5) |

Existing: Nico (src/player/nicoTripo), Mari (src/player/mari, character switch hold O), police officers, gang members,
associates, poachers (people p172-p193), bush/seaplane pilots, the Everglades swamp region, airports, seaplanes, boats.

## Existing code to reuse

`src/story/**` (runner, cutscenes, markers, props loader, missions), `src/story/missions/intro.*.js` (the old Dex intro:
firstJob, oceanSmuggling, swampRescue, seaplaneEscape, freeRoamUnlock; reuse the smuggling, swamp and seaplane parts),
`docs/v2/plan/STORY_INTRO_SCRIPT.md` (old script), `game.characters` (Mari switch, calls).

While the new intro is in progress, Play keeps going to free roam (`?intro=1` in src/ui/menu/frontend.v2.js runs the
intro). Flip the default only when the whole chain plays start to finish without errors.
