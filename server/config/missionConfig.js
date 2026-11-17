// server/config/missionConfig.js
// Missions with server-validated objectives.
//
// Every mission's completion is checked against the server's own state — cash,
// bank balance, employment, property, vehicle ownership, needs — never against
// anything the client claims. A mission cannot be completed by asking for it;
// the server has to agree that the condition is already true.

export const missionConfig = {
  missions: [
    {
      id: 'first-paycheck',
      name: 'First Paycheck',
      description: 'Get a job and stay employed long enough to be paid.',
      category: 'main',
      reward: { cash: 25000, xp: 10 },
      steps: [
        { id: 'employed', text: 'Take any job', check: (s) => s.job_status === 'working' || !!s.job_type },
        { id: 'paid', text: 'Earn at least ₦20,000 in total income', check: (s) => s.total_earned >= 20000 },
      ],
    },
    {
      id: 'keep-clean',
      name: 'Saturday Bath',
      description: 'Lagos is hot. Stay clean and well rested.',
      category: 'side',
      reward: { cash: 8000, xp: 5 },
      steps: [
        { id: 'hygiene', text: 'Reach 90% hygiene', check: (s) => s.hygiene >= 90 },
        { id: 'energy', text: 'Reach 80% energy', check: (s) => s.energy >= 80 },
      ],
    },
    {
      id: 'bank-run',
      name: 'Bank Run',
      description: 'Put money in the bank instead of spending it all.',
      category: 'side',
      reward: { cash: 15000, xp: 8 },
      steps: [
        { id: 'deposit', text: 'Hold at least ₦50,000 in the bank', check: (s) => s.bank_balance >= 50000 },
      ],
    },
    {
      id: 'roof-over-head',
      name: 'Roof Over Head',
      description: 'Stop sleeping rough. Rent or buy somewhere to live.',
      category: 'main',
      reward: { cash: 40000, xp: 15 },
      steps: [
        { id: 'housed', text: 'Move into any property', check: (s) => !!s.home_property },
      ],
    },
    {
      id: 'wheels',
      name: 'Wheels',
      description: 'Buy a vehicle of your own and see Lagos properly.',
      category: 'main',
      reward: { cash: 50000, xp: 20 },
      steps: [
        { id: 'own', text: 'Own at least one vehicle', check: (s) => s.vehicle_count >= 1 },
      ],
    },
    {
      id: 'well-fed',
      name: 'Well Fed',
      description: 'Keep every need above 70% at the same time.',
      category: 'challenge',
      reward: { cash: 30000, xp: 12 },
      steps: [
        {
          id: 'balanced',
          text: 'All six needs at 70% or better',
          check: (s) => ['hunger', 'energy', 'hygiene', 'bladder', 'fun', 'social']
            .every((k) => s[k] >= 70),
        },
      ],
    },
    {
      id: 'explorer',
      name: 'Lagos Explorer',
      description: 'Visit all four districts. The server tracks where you walk.',
      category: 'exploration',
      reward: { cash: 20000, xp: 10 },
      steps: [
        { id: 'districts', text: 'Enter Mushin, Yaba, Victoria Island and Lekki', check: (s) => (s.districts_visited || 0) >= 4 },
      ],
    },
    {
      id: 'supplier',
      name: 'Supplier Run',
      description: 'Buy something from a shop and use it.',
      category: 'side',
      reward: { cash: 5000, xp: 4 },
      steps: [
        { id: 'bought', text: 'Buy at least one item', check: (s) => (s.items_bought || 0) >= 1 },
        { id: 'used', text: 'Use at least one item', check: (s) => (s.items_used || 0) >= 1 },
      ],
    },
  ],

  get(id) {
    return this.missions.find((m) => m.id === id) || null;
  },
};
