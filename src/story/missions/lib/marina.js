// The employer's dock on the Florida Bay beach of Key Largo (intro2: the smuggling crew meets here, the floatplane
// comes back here): a long plank pier out from the sand over the turquoise flats, a boathouse beside it, crates, a
// lifebuoy and fishing gear. Built only while a mission that uses it runs (ctx.track(marina, () => marina.dispose())).
//
//   const marina = await buildMarina(game, PLACES.marina);
//   marina.spots     { shore, pierEnd, boat, plane, crew }   world points along the pier
//   marina.dispose()
import * as THREE from 'three';
import { loadModel } from '../../../world/everglades/models.js';

const SECTION = 11.4; // m of one clean_pier piece (the model is 11.6 long; a little overlap hides the joint)
const DECK_TOP = 0; // the dock models have their origin on the walking surface (docks/SOURCES.txt)

export async function buildMarina(game, at) {
  const city = game.city;
  const sea = city?.seaLevel ?? -0.12;
  const h = at.heading || 0;
  const fx = Math.sin(h);
  const fz = Math.cos(h);
  // walk out from `at` along the heading to the first water: the pier starts a few meters up the beach
  let start = 0;
  for (let d = 0; d < 80; d += 1) {
    if (city?.isWater?.(at.x + fx * d, at.z + fz * d)) {
      start = d - 4;
      break;
    }
  }
  const P = (d, side = 0) => ({
    x: at.x + fx * d + fz * side,
    z: at.z + fz * d - fx * side,
  });
  const group = new THREE.Group();
  group.name = 'intro2:marina';
  const deckY = sea + 0.75;
  const pieces = 3;
  const pier = await loadModel('docks/clean_pier.glb');
  if (pier) {
    for (let i = 0; i < pieces; i++) {
      const c = P(start + SECTION * (i + 0.5));
      const m = pier.clone(true);
      m.position.set(c.x, deckY - DECK_TOP, c.z);
      m.rotation.y = h;
      group.add(m);
    }
  }
  const len = SECTION * pieces;
  const extras = [
    ['docks/boathouse.glb', P(start + len * 0.45, -9.5), h + Math.PI / 2, deckY],
    ['keys/crate.glb', P(start + 6, 0.9), h + 0.3, deckY],
    ['keys/crate.glb', P(start + 6.7, 1.1), h + 1.1, deckY],
    ['keys/crate.glb', P(start + 6.3, 1.0), h + 0.7, deckY + 0.6],
    ['keys/lifebuoy.glb', P(start + 14, 1.55), h + Math.PI / 2, deckY],
    ['keys/fishing_gear.glb', P(start + len - 3, -1.1), h, deckY],
    ['keys/coolers.glb', P(start + len - 6, 1.0), h + 0.4, deckY],
  ];
  for (const [path, p, yaw, y] of extras) {
    const src = await loadModel(path);
    if (!src) continue;
    const m = src.clone(true);
    m.position.set(p.x, y, p.z);
    m.rotation.y = yaw;
    group.add(m);
  }
  game.scene.add(group);
  try {
    game.shaderWarmWrap?.(group);
  } catch (e) {
    /* optional */
  }

  // one walkable slab over the whole pier (Rapier, rotated with it)
  let body = null;
  const R = game.RAPIER;
  const W = game.world;
  if (R && W) {
    const c = P(start + len / 2);
    const q = { x: 0, y: Math.sin(h / 2), z: 0, w: Math.cos(h / 2) };
    body = W.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(c.x, deckY - 0.15, c.z));
    W.createCollider(R.ColliderDesc.cuboid(1.7, 0.15, len / 2).setRotation(q), body);
  }

  const spots = {
    shore: { ...P(start + 1), heading: h },
    pierEnd: { ...P(start + len - 1.5), y: deckY, heading: h },
    crew: { ...P(start + len - 5), y: deckY, heading: h + Math.PI },
    boat: { ...P(start + len - 4, 4.2), heading: h },
    plane: { ...P(start + len + 14, 9), heading: h + Math.PI },
    planeApproach: { ...P(start + len + 320, 0), heading: h + Math.PI },
    deckY,
  };

  function dispose() {
    if (body) {
      try {
        W.removeRigidBody(body);
      } catch (e) {
        /* the world was reset */
      }
      body = null;
    }
    group.parent?.remove(group);
  }

  return { group, spots, dispose };
}
