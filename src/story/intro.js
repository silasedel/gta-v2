// The main introduction (intro v2, docs/v2/plan/INTRO_V2_PLAN.md): Mari's prison and robbery flashback, then Nico's
// smuggling job, played in this order from Play. Their files are src/story/missions/<id>.js; a passed intro mission
// starts the next one (index.js), every pass autosaves (the save between missions), and the last one opens free roam.
// Mari's part plays as Mari, Nico's part as Nico (each mission switches over in its setup through game.characters and
// keeps the character wheel locked until intro2.home).
export const INTRO_MISSIONS = [
  // Mari
  'intro2.opening', // cutscene: how Nico and Mari met, then Mari in prison (panel 1)
  'intro2.prisonCell', // playable: the cell, the cellmate (panel 2)
  'intro2.prisonWalk', // playable: the corridor behind the guard (panel 3)
  'intro2.counselor1', // cutscene: the counselor's office (panel 4)
  'intro2.robbery', // flashback, playable: the payday-loan robbery (panel 5)
  'intro2.escape', // playable: rooftops, lose the police (panel 6)
  'intro2.arrest', // cutscene: the arrest outside the cafe, the dye pack (panel 7)
  'intro2.counselor2', // cutscene: back in the counselor's office
  // Nico
  'intro2.switchNico', // cutscene: Nico and his crew on the Keys, then the boat
  'intro2.smuggling', // playable: follow the drop plane in the motorboat (panel 8)
  'intro2.packages', // playable: collect the bales, the radio call (panel 9)
  'intro2.swamp', // playable: the gang's island camp, Cisco (panels 10-11)
  'intro2.seaplane', // playable: the floatplane home, paid at the dock (panel 12)
  'intro2.home', // the house at night: free roam
];

// set once the whole intro is behind the player (played or skipped through Free Roam)
export const INTRO_DONE_FLAG = 'intro.done';
export const FREE_ROAM_UNLOCK = 'freeRoam';
