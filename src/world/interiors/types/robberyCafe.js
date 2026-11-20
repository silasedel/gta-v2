// Store type: the cafe of the intro v2 robbery flashback (storyboard panel 7). It is the regular cafe type (types/cafe.js)
// on one lot, always the Cuban ventanita variant, named Cafe Colada, with a red awning where the facade draws its own.
// (On this lot the city shell hangs the awning; the robbery missions cover it with the red one lettered CAFE:
// src/story/sets/robberyBlock.js buildCafeAwning.) Claims only the lot ids in ROBBERY_CAFE_LOTS.
import { registerStoreType, getStoreType } from '../registry.js';

// storefront id (spots.json) -> name. Across 21st St from the payday-loan shop (types/payday.js PAYDAY_LOTS).
export const ROBBERY_CAFE_LOTS = {
  1028: { name: 'Café Colada' },
};

const RED = '#b3202a';

const cafe = getStoreType('cafe');
if (cafe) {
  registerStoreType({
    ...cafe,
    type: 'cafe_robbery',
    label: 'Cafe (intro)',
    kinds: [],
    variants: 1,
    standouts: [],
    match(sf) {
      return ROBBERY_CAFE_LOTS[sf.id] ? 1 : 0;
    },
    profile(base, c) {
      // always the Cuban ventanita variant
      base.variant = 0;
      const prof = cafe.profile(base, c) || {};
      prof.name = ROBBERY_CAFE_LOTS[c.sf.id]?.name || prof.name;
      return prof;
    },
    plan(P, ctx) {
      const storefront = P.storefront;
      P.storefront = function (o) {
        return storefront.call(this, { ...o, awning: { c: RED, c2: RED } });
      };
      try {
        cafe.plan(P, ctx);
      } finally {
        P.storefront = storefront;
      }
    },
  });
}
