// server/config/staffConfig.js
// Who is behind the counter.
//
// Until now the people inside buildings were scenery: `staffFigure` props
// posed by the layout, with no name, nothing to say and no way to serve you.
// The street NPCs, by contrast, walk around and hold real conversations. That
// made every indoor venue feel like a diorama of an abandoned shop.
//
// This gives each kind of venue a named attendant with a line of patter and a
// list of services they actually perform. The services themselves are the
// existing ones in serviceConfig (cost, cooldown and need effects all live on
// the server, as before) — what is new is *who* is allowed to perform which
// service, and *where*.
//
// The server decides who is in the room from the venue the client reports, so
// a modified client cannot summon a surgeon into a nightclub.

/** An attendant for a kind of venue. Services refer to serviceConfig ids. */
const STAFF = {
  supermarket: {
    name: 'Blessing',
    role: 'Till supervisor',
    lines: [
      'Welcome to Surulere Supermarket. Baskets by the door, and mind the wet floor near the chillers.',
      'If you cannot find something, ask me. If I cannot find it, it is not in this shop.',
    ],
    services: ['chat'],
  },
  market: {
    name: 'Mama Nkechi',
    role: 'Market trader',
    lines: [
      'Come and see what I have today. Tomatoes are fresh — I brought them myself this morning.',
      'Oga, no price is fixed in this market. Open your mouth and let us talk.',
    ],
    services: ['chat', 'street-food'],
  },
  bank: {
    name: 'Mr Adewale',
    role: 'Teller',
    lines: [
      'Good afternoon. Deposit or withdrawal? There is a form for everything, but today I will spare you the form.',
      'Mind you, the counter closes at four. The ATM outside does not sleep.',
    ],
    services: ['chat'],
  },
  hospital: {
    name: 'Nurse Adaeze',
    role: 'Triage nurse',
    lines: [
      'Sit down first. Are you the one who has been waiting since morning?',
      'Malaria test is two thousand five hundred. It is better to know than to guess.',
    ],
    services: ['chat', 'clinic'],
  },
  clinic: {
    name: 'Sister Grace',
    role: 'Clinic nurse',
    lines: [
      'Come, sit. What is the complaint today? Do not tell me "body hot" — be specific.',
      'Drink water. Nobody in this city drinks enough water.',
    ],
    services: ['chat', 'clinic'],
  },
  church: {
    name: 'Bro. Emeka',
    role: 'Church usher',
    lines: [
      'Welcome in the name of the Lord. There is space at the middle pew, on the left.',
      'Service finished an hour ago but the doors stay open. People come to sit and think.',
    ],
    services: ['chat'],
  },
  mosque: {
    name: 'Alhaji Musa',
    role: 'Muezzin',
    lines: [
      'As-salamu alaykum. The next prayer is in a little while — you are welcome to stay.',
      'The ablution taps are at the back. Please do not waste the water.',
    ],
    services: ['chat'],
  },
  airport: {
    name: 'Chidinma',
    role: 'Airline agent',
    lines: [
      'Good afternoon, do you have a booking? Please have your ID ready before you reach the desk.',
      'Abuja flight is boarding at gate four. There is no rush — the aircraft will not leave without its passengers.',
    ],
    services: ['chat'],
  },
  airfield: {
    name: 'Capt. Bello',
    role: 'Captain',
    lines: [
      'You are on the apron now, so keep behind the yellow line. Jet blast is not a joke.',
      'Wind is from the south today. We will be off the ground in a few minutes.',
    ],
    services: ['chat'],
  },
  school: {
    name: 'Mr Okonkwo',
    role: 'Teacher',
    lines: [
      'You are late. Sit at the back and try to catch up.',
      'The exam hall is through there. No phones, no notes, and no looking at your neighbour.',
    ],
    services: ['chat'],
  },
  techhub: {
    name: 'Tobi',
    role: 'Community manager',
    lines: [
      'Free desk by the window. Coffee is on the counter, but wash your cup.',
      'We are pitching on Friday. If you have something to show, add your name to the board.',
    ],
    services: ['chat'],
  },
  office: {
    name: 'Halima',
    role: 'Front desk',
    lines: [
      'Good morning. Who are you here to see?',
      'The meeting room is booked until two. You can wait by the coffee.',
    ],
    services: ['chat'],
  },
  police: {
    name: 'Sgt. Danjuma',
    role: 'Desk sergeant',
    lines: [
      'State your complaint clearly and write your name in the book.',
      'If you have lost something, check the property store before you accuse anybody.',
    ],
    services: ['chat'],
  },
  gym: {
    name: 'Kelvin',
    role: 'Trainer',
    lines: [
      'Rack your weights when you finish. Somebody else wants that bench.',
      'If your back hurts, tell me now — not after the third set.',
    ],
    services: ['chat'],
  },
  restaurant: {
    name: 'Yemi',
    role: 'Waiter',
    lines: [
      'Table for one? By the window, there is a breeze.',
      'The jollof is finishing, so if you want it, order now.',
    ],
    services: ['chat', 'street-food'],
  },
  community: {
    name: 'Auntie Bola',
    role: 'Hall caretaker',
    lines: [
      'We are setting up for the meeting tonight. If you can carry a chair, you are welcome.',
      'The kitchen is through there. Whatever you cook, wash the pot.',
    ],
    services: ['chat', 'street-food'],
  },
  garage: {
    name: 'Musa',
    role: 'Mechanic',
    lines: [
      'Bring it inside, let me hear the engine first.',
      'Parts are at the counter. Do not take the good spanner outside.',
    ],
    services: ['chat'],
  },
  kiosk: {
    name: 'Ifeoma',
    role: 'Kiosk owner',
    lines: [
      'Water is cold, bread is warm. What do you want?',
      'Airtime? Which network?',
    ],
    services: ['chat', 'street-food'],
  },
  shop: {
    name: 'Segun',
    role: 'Salesman',
    lines: [
      'You are welcome. Feel free to sit inside any of them — just do not slam the door.',
      'If you want a test drive, bring your licence and a bit of patience.',
    ],
    services: ['chat'],
  },
  home: {
    name: 'Nobody',
    role: '',
    lines: [],
    services: [],
  },
};

/** Who is behind the counter of this kind of room, or null if the room is empty. */
export function staffFor(kind) {
  const s = STAFF[kind];
  if (!s || !s.services.length) return null;
  return { kind, name: s.name, role: s.role, lines: s.lines, services: s.services };
}

/**
 * Is this service performed by a member of staff standing in a room of this
 * kind? Used to keep indoor service calls tied to a place. A room with no
 * attendant returns false, so nothing can be served there.
 */
export function staffOffers(kind, serviceId) {
  const s = STAFF[kind];
  return !!(s && s.services.includes(serviceId));
}

export function allStaffKinds() {
  return Object.keys(STAFF).filter((k) => STAFF[k].services.length);
}
