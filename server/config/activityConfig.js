// server/config/activityConfig.js
// Activities that refill needs and stats. Each activity has a duration
// (milliseconds) and effects (positive = refill, negative = cost).
// The server applies effects when the activity completes — the client
// never decides what a player's needs become.

export const activityConfig = {
  activities: {
    eat: {
      id: 'eat',
      name: 'Eat',
      icon: '🍔',
      description: 'Eat a meal to restore hunger.',
      duration: 10000, // 10 seconds
      effects: {
        hunger: 40,
        energy: -5,
      },
    },
    sleep: {
      id: 'sleep',
      name: 'Sleep',
      icon: '🛏️',
      description: 'Rest to restore energy.',
      duration: 30000, // 30 seconds
      // A better home multiplies the positive effects (see propertyConfig).
      homeBonus: true,
      effects: {
        energy: 60,
        hunger: -10,
        hygiene: -5,
      },
    },
    shower: {
      id: 'shower',
      name: 'Shower',
      icon: '🚿',
      description: 'Take a shower to restore hygiene.',
      duration: 15000, // 15 seconds
      // A better home multiplies the positive effects (see propertyConfig).
      homeBonus: true,
      effects: {
        hygiene: 50,
        energy: -5,
      },
    },
    toilet: {
      id: 'toilet',
      name: 'Use Toilet',
      icon: '🚻',
      description: 'Use the toilet to restore bladder.',
      duration: 5000, // 5 seconds
      effects: {
        bladder: 50,
      },
    },
    social: {
      id: 'social',
      name: 'Socialise',
      icon: '👥',
      description: 'Chat with others to restore social and fun.',
      duration: 20000, // 20 seconds
      effects: {
        social: 40,
        fun: 10,
        energy: -5,
      },
    },
    // ── Things you do at home, at a venue, or at the airport ──
    //
    // These are marked `venueOnly`, which means they are hidden from the
    // generic Activities panel and can only be started from a station in the
    // world (a bed, a hob, an airport gate). That is the difference between
    // "press E on the bed" and "you can sleep anywhere in the universe".
    cook: {
      id: 'cook',
      requiresUtility: 'gas',
      name: 'Cook a Meal',
      icon: '🍳',
      description: 'Stand at the hob and cook something proper.',
      duration: 20000,
      venueOnly: true,
      // A hall kitchen and a restaurant kitchen are still kitchens.
      requiresVenueKind: ['home', 'community', 'restaurant'],
      homeBonus: true,
      effects: { hunger: 45, energy: -8, fun: 6, hygiene: -4 },
    },
    watch_tv: {
      id: 'watch_tv',
      requiresUtility: 'power',
      name: 'Watch TV',
      icon: '📺',
      description: 'Catch up on the news, or a match, and switch off for a bit.',
      duration: 20000,
      venueOnly: true,
      requiresVenueKind: ['home'],
      effects: { fun: 25, energy: 5, social: -4 },
    },
    read_book: {
      id: 'read_book',
      name: 'Read',
      icon: '📖',
      description: 'Read something that is not a phone screen.',
      duration: 20000,
      venueOnly: true,
      requiresVenueKind: ['home', 'church', 'mosque', 'school', 'office', 'techhub', 'community', 'police', 'hospital'],
      effects: { fun: 14, smarts: 8, energy: -2 },
    },
    home_work: {
      id: 'home_work',
      requiresUtility: 'power',
      name: 'Work from Home',
      icon: '💻',
      description: 'Sit at the desk and get the work done without the commute.',
      duration: 30000,
      venueOnly: true,
      requiresVenueKind: ['home', 'office', 'techhub', 'garage'],
      effects: { smarts: 10, charisma: 2, energy: -18, hunger: -6, fun: -4 },
    },
    laundry: {
      id: 'laundry',
      requiresUtility: 'water',
      name: 'Do the Laundry',
      icon: '🧺',
      description: 'Wash and dry. You will feel better afterwards.',
      duration: 15000,
      venueOnly: true,
      requiresVenueKind: ['home'],
      effects: { hygiene: 22, energy: -6 },
    },
    nap: {
      id: 'nap',
      name: 'Nap',
      icon: '😴',
      description: 'A short sleep on the sofa.',
      duration: 12000,
      venueOnly: true,
      requiresVenueKind: ['home', 'hospital', 'clinic', 'garage', 'airport', 'kiosk'],
      homeBonus: true,
      effects: { energy: 25, hunger: -4 },
    },
    study: {
      id: 'study',
      name: 'Study',
      icon: '📚',
      description: 'Sit down and learn something properly.',
      duration: 22000,
      venueOnly: true,
      requiresVenueKind: ['home', 'school', 'techhub'],
      effects: { smarts: 12, fun: -2, energy: -8 },
    },
    treatment: {
      id: 'treatment',
      name: 'Get Treated',
      icon: '🩺',
      description: 'Have a professional look at you.',
      duration: 15000,
      venueOnly: true,
      requiresVenueKind: ['hospital', 'clinic'],
      effects: { energy: 20, hygiene: 10, hunger: -4 },
    },
    rest: {
      id: 'rest',
      name: 'Rest',
      icon: '🛏️',
      description: 'Lie down somewhere safe for a while.',
      duration: 18000,
      venueOnly: true,
      requiresVenueKind: ['home', 'hospital', 'clinic', 'airport', 'airfield', 'market', 'restaurant'],
      homeBonus: true,
      effects: { energy: 30, hunger: -6 },
    },
    // ── Airport ──
    check_in: {
      id: 'check_in',
      name: 'Check In',
      icon: '🎫',
      description: 'Drop your bag and get a boarding pass.',
      duration: 8000,
      venueOnly: true,
      requiresVenue: ['in-airport'],
      effects: { fun: 4, energy: -2 },
    },
    security: {
      id: 'security',
      name: 'Clear Security',
      icon: '🛂',
      description: 'Shoes off, laptop out, walk through.',
      duration: 6000,
      venueOnly: true,
      requiresVenue: ['in-airport'],
      effects: { energy: -3, social: 2 },
    },
    flight: {
      id: 'flight',
      name: 'Take the Flight',
      icon: '✈️',
      description: 'Board, taxi, take off, and come back to Lagos.',
      duration: 40000,
      venueOnly: true,
      requiresVenue: ['in-airfield'],
      effects: { fun: 30, energy: -20, hunger: -12, hygiene: -6, charisma: 4 },
    },
    exercise: {
      id: 'exercise',
      name: 'Exercise',
      icon: '🏃',
      description: 'Work out to restore fitness and fun.',
      duration: 25000, // 25 seconds
      effects: {
        fun: 10,
        fitness: 5,
        energy: -20,
        hunger: -10,
        hygiene: -10,
      },
    },

    // ── Places that had a counter but nothing real to do at it ──
    // Each of these exists because a room was furnished with a genuine feature
    // — a church altar, a school exam hall, a police desk, a garage bay — and
    // the only thing you could press there was "socialise". That is scenery
    // with a button on it. These are the actions those places actually offer.

    worship: {
      id: 'worship',
      name: 'Worship',
      icon: '\u{1F64F}',
      description: 'Sit with the congregation and settle your mind.',
      duration: 20000,
      venueOnly: true,
      requiresVenueKind: ['church', 'mosque'],
      effects: { social: 22, fun: 12, charisma: 2, energy: -6 },
    },
    volunteer: {
      id: 'volunteer',
      name: 'Volunteer',
      icon: '\u{1F91D}',
      description: 'Help out for a while. It costs you energy and pays in goodwill.',
      duration: 25000,
      venueOnly: true,
      requiresVenueKind: ['community', 'police', 'church', 'kiosk', 'market'],
      effects: { social: 20, charisma: 5, fitness: 2, energy: -15, hunger: -5 },
    },
    exam: {
      id: 'exam',
      name: 'Sit an exam',
      icon: '\u{1F4DD}',
      description: 'Half an hour of pure pressure. You come out smarter and exhausted.',
      duration: 30000,
      venueOnly: true,
      requiresVenueKind: ['school'],
      effects: { smarts: 18, charisma: 1, energy: -25, fun: -6 },
    },
    repair: {
      id: 'repair',
      name: 'Work the bay',
      icon: '\u{1F527}',
      description: 'Strip an engine and put it back together.',
      duration: 25000,
      venueOnly: true,
      requiresVenueKind: ['garage', 'restaurant', 'shop'],
      effects: { smarts: 9, fitness: 4, energy: -20, hygiene: -10 },
    },
    meeting: {
      id: 'meeting',
      name: 'Sit in a meeting',
      icon: '\u{1F4BC}',
      description: 'Talk shop in a room with a whiteboard.',
      duration: 22000,
      venueOnly: true,
      requiresVenueKind: ['office', 'techhub', 'bank', 'shop'],
      effects: { charisma: 6, smarts: 5, social: 14, energy: -12, fun: -4 },
    },
    // The hospital and the clinic both treat; the pharmacy counter sells the
    // medicine, this is the part that actually does something for you.
    checkup: {
      id: 'checkup',
      name: 'Full check-up',
      icon: '\u{1FA7A}',
      description: 'Blood pressure, malaria test, the works.',
      duration: 18000,
      venueOnly: true,
      requiresVenueKind: ['hospital', 'clinic'],
      effects: { energy: 28, hygiene: 14, hunger: -5 },
    },
    // The apron used to offer `watch_tv` so it had *something* — which meant a
    // lawn chair on the tarmac watching a television that was not there. This
    // is the actual hobby.
    planespot: {
      id: 'planespot',
      name: 'Plane-spot',
      icon: '\u{1F6EC}',
      description: 'Sit by the fence and watch them come in.',
      duration: 18000,
      venueOnly: true,
      requiresVenueKind: ['airfield'],
      effects: { fun: 25, energy: -3, social: -2 },
    },
    physio: {
      id: 'physio',
      name: 'Physiotherapy',
      icon: '\u{1F9B5}',
      description: 'Stretch it out and put some strength back in.',
      duration: 20000,
      venueOnly: true,
      requiresVenueKind: ['clinic', 'hospital'],
      effects: { fitness: 6, energy: 12, hygiene: -6, hunger: -6 },
    },
  },
};

// Stats that are not needs (they don't decay over time)
export const STAT_KEYS = ['smarts', 'charisma', 'fitness'];

// Need keys that the game loop tracks in-memory
export const NEED_KEYS = ['hunger', 'energy', 'hygiene', 'bladder', 'fun', 'social'];
