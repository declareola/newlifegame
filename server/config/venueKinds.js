// server/config/venueKinds.js
// What kind of place is the player standing in?
//
// `requiresVenue` in activityConfig gates an activity to exact interior ids,
// which is fine for one-off places like the apron (`in-airfield`). It falls
// apart for anything that can happen in *several* kinds of room, and it cannot
// handle homes at all: every rented property is `in-prop-<propertyId>` and
// every district apartment is `in-home-<district>`, so the server cannot list
// them ahead of time.
//
// So activities can also say `requiresVenueKind: ['home']`, and this file turns
// the id the client reported into a kind.
//
// Why this matters: `venueOnly` in activityConfig only hides an activity from
// the general Activities menu. It does not stop anyone performing it. Before
// this file, "cook dinner", "watch TV", "study", "get treated" and "nap" could
// all be triggered from the middle of a road with no venue reported at all —
// the button existed, so the server allowed it. That is exactly the fake state
// the game is not supposed to have.

/** Named interiors, by the id the client reports as its venue. */
const KIND_BY_VENUE = {
  'in-market': 'market',
  'in-church': 'church',
  'in-mosque': 'mosque',
  'in-hospital': 'hospital',
  'in-airport': 'airport',
  'in-airfield': 'airfield',
  'in-supermarket': 'supermarket',
  'in-bank': 'bank',
  'in-school': 'school',
  'in-tech-hub': 'techhub',
  'in-police': 'police',
  'in-clinic': 'clinic',
  'in-garage': 'garage',
  'in-restaurant': 'restaurant',
  'in-food-court': 'restaurant',
  'in-office-tower': 'office',
  'in-gym': 'gym',
  'in-community': 'community',
  'in-kiosk': 'kiosk',
  'in-fuel': 'kiosk',
  'in-pure-water': 'kiosk',
  'in-dealership': 'shop',
};

/**
 * The kind of place a venue id represents, or null if we do not know it.
 *
 * Homes are matched by prefix because they are generated per property and per
 * district. A rented flat and a district apartment are both somewhere with a
 * bed and a cooker, so both count as `home`; whether the player *owns* the
 * property is a separate question, handled by the housing system, not here.
 *
 * @param {string|null|undefined} venueId
 * @returns {string|null}
 */
export function venueKind(venueId) {
  if (!venueId) return null;
  if (KIND_BY_VENUE[venueId]) return KIND_BY_VENUE[venueId];
  if (venueId.startsWith('in-prop-')) return 'home';
  if (venueId.startsWith('in-home-')) return 'home';
  return null;
}

/** Every kind, for the tests and the docs. */
export function allVenueKinds() {
  return [...new Set(Object.values(KIND_BY_VENUE)), 'home'];
}

/** Human wording for a refusal message. */
export function kindLabel(kind) {
  const labels = {
    home: 'your home',
    church: 'the church',
    mosque: 'the mosque',
    hospital: 'the hospital',
    airport: 'the airport',
    airfield: 'the airfield',
    supermarket: 'the supermarket',
    bank: 'the bank',
    school: 'the school',
    techhub: 'the tech hub',
    police: 'the police station',
    clinic: 'the clinic',
    garage: 'the workshop',
    restaurant: 'the restaurant',
    office: 'the office',
    gym: 'the gym',
    community: 'the community centre',
    kiosk: 'the kiosk',
    market: 'the market',
    shop: 'the shop',
  };
  return labels[kind] || kind;
}
