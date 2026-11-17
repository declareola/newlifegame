// server/config/vehicleConfig.js
// Vehicle catalogue.
//
// The client renders and drives these from primitives; the server owns what you
// own, what you paid, and where the vehicle is parked.

export const vehicleConfig = {
  vehicles: [
    {
      id: 'tricycle',
      name: 'Keke NAPEP (tricycle)',
      description: 'Three wheels, a bench in the back, and the cheapest way to carry a load.',
      price: 450000,
      maxSpeed: 16,
      acceleration: 9,
      handling: 1.35,
      seats: 3,
      colour: 0xf2c200,
      kind: 'tricycle',
    },
    {
      id: 'motorbike',
      name: 'Okada (motorbike)',
      description: 'Motorcycle. Fast through traffic, no roof, no airs.',
      price: 320000,
      maxSpeed: 22,
      acceleration: 12,
      handling: 1.15,
      seats: 2,
      colour: 0x8b0000,
      kind: 'motorcycle',
    },
    {
      id: 'hiace',
      name: 'Hiace 18-seater',
      description: 'The white-and-yellow long-wheelbase minibus. Eighteen seats and a roof rack.',
      price: 980000,
      maxSpeed: 21,
      acceleration: 7.5,
      handling: 0.78,
      seats: 18,
      colour: 0xdfe5e9,
      kind: 'hiace',
    },
    {
      id: 'corolla',
      name: 'Toyota Corolla',
      description: 'The dependable Lagos sedan.',
      price: 2200000,
      maxSpeed: 28,
      acceleration: 11,
      handling: 1.0,
      seats: 5,
      colour: 0xdfe6ec,
      kind: 'car',
    },
    {
      id: 'taxi',
      name: 'Yellow Taxi',
      description: 'Painted Lagos yellow. Everyone will try to flag you down.',
      price: 1800000,
      maxSpeed: 27,
      acceleration: 10.5,
      handling: 1.05,
      seats: 4,
      colour: 0xf7c948,
      kind: 'car',
    },
    {
      id: 'suv',
      name: 'Range Rover',
      description: 'Victoria Island energy.',
      price: 9500000,
      maxSpeed: 32,
      acceleration: 13,
      handling: 0.9,
      seats: 5,
      colour: 0x1b1f24,
      kind: 'car',
    },
  ],

  // Saves made before the fleet change still hold 'danfo', 'keke' and 'okada'.
  // They resolve to the vehicle that replaced them, so an old garage keeps its
  // vehicles instead of showing three broken rows.
  legacyIds: { danfo: 'hiace', keke: 'tricycle', okada: 'motorbike', bus: 'hiace' },

  get(id) {
    const resolved = this.legacyIds[id] || id;
    return this.vehicles.find((v) => v.id === resolved || v.id === id) || null;
  },

  /** Cost to fill an empty tank, in naira. */
  fuelPricePerLitre: 900,
  tankLitres: 45,

  startingFuel: 40, // litres a purchased vehicle comes with
};
