// server/config/serviceConfig.js
// Things an NPC can do for you.
//
// Every service is defined here, on the server: the price, the need effects and
// the cooldown. The client only sends an id, so a player cannot invent a
// cheaper clinic visit or a bigger meal.

export const services = [
  {
    id: 'chat',
    name: 'Chat',
    cost: 0,
    cooldownMs: 60_000,
    effects: { social: 8 },
    text: 'You talked for a while. Lagos people are friendly like that.',
  },
  {
    id: 'street-food',
    name: 'Street food',
    cost: 1_500,
    cooldownMs: 0,
    effects: { hunger: 35 },
    text: 'Suya wrapped in paper. Pepper hits the back of your throat.',
  },
  {
    id: 'clinic',
    name: 'Clinic check-up',
    cost: 2_500,
    cooldownMs: 300_000,
    effects: { energy: 30, hygiene: 10 },
    text: 'The nurse cleaned you up and told you to drink water.',
  },
  {
    id: 'directions',
    name: 'Ask for directions',
    cost: 0,
    cooldownMs: 0,
    effects: {},
    text: 'They pointed you the right way.',
  },
];

export const serviceConfig = {
  services,
  get(id) {
    return services.find((s) => s.id === id) || null;
  },
};

export default serviceConfig;
