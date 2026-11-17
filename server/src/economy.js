// server/src/economy.js
// Atomic wallet + property + shop operations.
//
// Every function here moves money. Each one:
//   1. runs its DB writes inside a single SQLite transaction, so a failure
//      rolls back completely (no "money gone, item missing")
//   2. re-reads the authoritative cash figure from the game loop
//   3. only updates in-memory cash AFTER the transaction commits
//
// Cash is the awkward part: the game loop keeps it in memory and flushes to
// the DB every tick. If a route wrote cash to the DB directly, the next tick
// would overwrite it with the stale in-memory value. So all cash changes go
// through gameLoop.adjustCash(), and the DB write is part of the transaction.

import {
  withTransaction,
  getUserById,
  getUserPropertyRow,
  getRental,
  buyProperty as dbBuyProperty,
  rentProperty as dbRentProperty,
  setHome,
  deductBank,
  addBank,
  updateCash,
  transferProperty,
  setRentalTerms,
  db as database,
} from './db.js';
import { RENT_PERIOD_MS } from '../config/propertyConfig.js';

/** Thrown when an operation is not allowed. Carries an HTTP status. */
export class EconomyError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'EconomyError';
    this.status = status;
  }
}

/**
 * Set a user's cash to an absolute value in memory *and* the database,
 * atomically from the caller's point of view.
 * Returns the resulting balance.
 */
function setCash(userId, newCash, gameLoop) {
  gameLoop.setCash(userId, newCash);   // memory (authoritative while online)
  updateCash(userId, newCash);         // persist immediately
  return newCash;
}

function naira(n) {
  return '₦' + Math.round(n).toLocaleString('en-NG');
}

/**
 * Buy a property outright.
 * Cash is spent first, then the bank balance. If the player is homeless the
 * property also becomes their home.
 *
 * @returns {{ cash: number, bankBalance: number, movedIn: boolean }}
 */
export function buyPropertyAtomic({ userId, property, gameLoop }) {
  const cash = gameLoop.getCash(userId);
  const user = getUserById(userId);
  if (!user) throw new EconomyError('User not found', 404);

  if (getUserPropertyRow(userId, property.id)) {
    throw new EconomyError('You already have this property');
  }

  const bankBalance = user.bank_balance;
  if (cash + bankBalance < property.price) {
    throw new EconomyError(
      `Not enough money — ${property.name} costs ${naira(property.price)}`
    );
  }

  const fromCash = Math.min(cash, property.price);
  const fromBank = property.price - fromCash;
  const newCash = cash - fromCash;
  const newBank = bankBalance - fromBank;
  const movedIn = !user.home_property;

  withTransaction(() => {
    updateCash(userId, newCash);
    if (fromBank > 0) deductBank(userId, fromBank);
    dbBuyProperty(userId, property.id);
    if (movedIn) setHome(userId, property.id);
  });

  // Only touch memory after the commit succeeded.
  gameLoop.setCash(userId, newCash);

  return { cash: newCash, bankBalance: newBank, movedIn };
}

/**
 * Start renting a property: deposit + one rent period, upfront.
 *
 * @returns {{ cash: number, bankBalance: number, rentPaidUntil: number }}
 */
export function rentPropertyAtomic({ userId, property, gameLoop }) {
  const cash = gameLoop.getCash(userId);
  const user = getUserById(userId);
  if (!user) throw new EconomyError('User not found', 404);

  if (getUserPropertyRow(userId, property.id)) {
    throw new EconomyError('You already have this property');
  }

  // Renting several places at once is allowed — a player may keep a flat in
  // Yaba and a house on the Island. Each tenancy pays its own rent; the game
  // loop charges every rented row, not just one.

  const upfront = property.deposit + property.rentPerPeriod;
  const bankBalance = user.bank_balance;
  if (cash + bankBalance < upfront) {
    throw new EconomyError(
      `Not enough money — moving in costs ${naira(upfront)} upfront`
    );
  }

  const fromCash = Math.min(cash, upfront);
  const fromBank = upfront - fromCash;
  const newCash = cash - fromCash;
  const newBank = bankBalance - fromBank;
  const paidUntil = Date.now() + RENT_PERIOD_MS;

  withTransaction(() => {
    updateCash(userId, newCash);
    if (fromBank > 0) deductBank(userId, fromBank);
    dbRentProperty(userId, property.id, paidUntil);
    setHome(userId, property.id);
  });

  gameLoop.setCash(userId, newCash);

  return { cash: newCash, bankBalance: newBank, rentPaidUntil: paidUntil };
}

/**
 * Move cash into the bank.
 * @returns {{ cash: number, bankBalance: number }}
 */
export function depositAtomic({ userId, amount, gameLoop }) {
  const cash = gameLoop.getCash(userId);
  if (cash < amount) {
    throw new EconomyError('You do not have that much cash');
  }

  const newCash = cash - amount;
  let newBank = 0;

  withTransaction(() => {
    updateCash(userId, newCash);
    newBank = addBank(userId, amount);
  });

  gameLoop.setCash(userId, newCash);
  return { cash: newCash, bankBalance: newBank };
}

/**
 * Take cash out of the bank.
 * @returns {{ cash: number, bankBalance: number }}
 */
export function withdrawAtomic({ userId, amount, gameLoop }) {
  const user = getUserById(userId);
  if (!user) throw new EconomyError('User not found', 404);

  if (user.bank_balance < amount) {
    throw new EconomyError('You do not have that much in the bank');
  }

  const cash = gameLoop.getCash(userId);
  const newCash = cash + amount;
  let newBank = 0;

  withTransaction(() => {
    newBank = deductBank(userId, amount);
    updateCash(userId, newCash);
  });

  gameLoop.setCash(userId, newCash);
  return { cash: newCash, bankBalance: newBank };
}

/**
 * Pay for a shop item. The need effects are applied by the caller after the
 * money has definitely moved.
 * @returns {{ cash: number }}
 */
export function buyItemAtomic({ userId, item, gameLoop }) {
  const cash = gameLoop.getCash(userId);
  if (cash < item.price) {
    throw new EconomyError('Not enough cash');
  }

  const newCash = cash - item.price;

  withTransaction(() => {
    updateCash(userId, newCash);
  });

  gameLoop.setCash(userId, newCash);
  return { cash: newCash };
}


// ══════════════════════════════════════════════════════════════
// Player property market
// ══════════════════════════════════════════════════════════════
//
// A player who owns a title can sell it, or let it out. Both are real transfers:
// money moves between two accounts, the ownership row moves between two users,
// and the seller's name appears on the listing. The rent of a player-let
// property is paid to the landlord, not to the city.

/**
 * Sell one of your properties to another player.
 *
 * @param {{sellerId:number, buyerId:number, property, listing, gameLoop}} o
 * @returns {{paid:number, newBuyerCash:number, newSellerCash:number}}
 */
export function buyListingAtomic({ sellerId, buyerId, property, listing, gameLoop }) {
  if (sellerId === buyerId) throw new EconomyError('That is your own listing');
  if (listing.mode !== 'sale') throw new EconomyError('That property is not for sale');
  if (listing.active !== 1) throw new EconomyError('That listing is no longer available');

  const buyer = getUserById(buyerId);
  const seller = getUserById(sellerId);
  if (!buyer || !seller) throw new EconomyError('User not found', 404);

  const price = listing.price;
  const buyerCash = gameLoop.getCash(buyerId);
  if (buyerCash + buyer.bank_balance < price) {
    throw new EconomyError(`Not enough money — that title costs ${naira(price)}`);
  }
  if (getUserPropertyRow(buyerId, property.id)) {
    throw new EconomyError('You already own that property');
  }
  if (!getUserPropertyRow(sellerId, property.id)) {
    throw new EconomyError('The seller no longer owns that property');
  }

  const fromCash = Math.min(buyerCash, price);
  const fromBank = price - fromCash;
  const newBuyerCash = buyerCash - fromCash;
  const sellerCash = gameLoop.getCash(sellerId);
  const newSellerCash = sellerCash + price;

  withTransaction(() => {
    updateCash(buyerId, newBuyerCash);
    if (fromBank > 0) deductBank(buyerId, fromBank);
    updateCash(sellerId, newSellerCash);
    transferProperty(sellerId, buyerId, property.id);
    database.prepare('UPDATE property_listings SET active = 0 WHERE id = ?').run(listing.id);
  });

  // Only touch memory after the commit.
  gameLoop.setCash(buyerId, newBuyerCash);
  gameLoop.setCash(sellerId, newSellerCash);

  return { paid: price, newBuyerCash, newSellerCash };
}

/**
 * Take a player's property on a private tenancy.
 *
 * The upfront payment is the deposit plus the first period; the deposit goes to
 * the landlord (it is returned when the tenancy ends, by the caller), and every
 * later period is paid to the landlord instead of the city.
 *
 * @param {{landlordId:number, renterId:number, property, listing, gameLoop}} o
 */
export function rentListingAtomic({ landlordId, renterId, property, listing, gameLoop }) {
  if (landlordId === renterId) throw new EconomyError('That is your own listing');
  if (listing.mode !== 'rent') throw new EconomyError('That property is not being let');
  if (listing.active !== 1) throw new EconomyError('That listing is no longer available');

  const renter = getUserById(renterId);
  if (!renter) throw new EconomyError('User not found', 404);
  if (getUserPropertyRow(renterId, property.id)) {
    throw new EconomyError('You already rent or own that property');
  }
  if (!getUserPropertyRow(landlordId, property.id)) {
    throw new EconomyError('The landlord no longer owns that property');
  }

  const rent = listing.price || property.rentPerPeriod;
  const deposit = listing.deposit || 0;
  const period = listing.rent_period_ms || RENT_PERIOD_MS;
  const upfront = deposit + rent;

  const cash = gameLoop.getCash(renterId);
  if (cash + renter.bank_balance < upfront) {
    throw new EconomyError(`Not enough money — moving in costs ${naira(upfront)} upfront`);
  }

  const fromCash = Math.min(cash, upfront);
  const fromBank = upfront - fromCash;
  const newCash = cash - fromCash;
  const landlordCash = gameLoop.getCash(landlordId);
  const paidUntil = Date.now() + period;

  withTransaction(() => {
    updateCash(renterId, newCash);
    if (fromBank > 0) deductBank(renterId, fromBank);
    updateCash(landlordId, landlordCash + upfront);
    dbRentProperty(renterId, property.id, paidUntil);
    setHome(renterId, property.id);
    setRentalTerms(renterId, property.id, { landlordUserId: landlordId, rentAmount: rent });
  });

  gameLoop.setCash(renterId, newCash);
  gameLoop.setCash(landlordId, landlordCash + upfront);

  return { cash: newCash, paidUntil, landlord: getUserById(landlordId)?.username || null };
}
