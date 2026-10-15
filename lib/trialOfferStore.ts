/**
 * In-memory store for trial offer records.
 *
 * Manages the lifecycle of trial offers: creation, acceptance, and rejection.
 * Equivalent to what the DB migration db/002_trial_offer_events.sql would
 * persist in a full deployment; the interface is intentionally thin so this
 * can be swapped for a real DB layer without changing the route handlers.
 *
 * In a multi-instance deployment, replace the module-level Map with a shared
 * data store (SQLite via better-sqlite3, Redis, etc.).
 */

export type TrialOfferStatus = 'pending' | 'accepted' | 'rejected';

export interface TrialOfferRecord {
  id: string;
  playerId: string;
  scoutId: string;
  details: string;
  location?: string;
  startDate?: string;
  status: TrialOfferStatus;
  responseReason?: string;
  createdAt: number; // Unix seconds
  respondedAt?: number; // Unix seconds
}

// Module-level singleton — shared across all Next.js API route invocations
// in the same process.
const offers = new Map<string, TrialOfferRecord>();

/**
 * Create a new trial offer. Called when a scout logs a trial offer.
 */
export function createTrialOffer(
  params: Omit<TrialOfferRecord, 'status' | 'createdAt'>,
): TrialOfferRecord {
  const record: TrialOfferRecord = {
    ...params,
    status: 'pending',
    createdAt: Math.floor(Date.now() / 1000),
  };
  offers.set(record.id, record);
  return record;
}

/**
 * Retrieve a single trial offer by ID.
 */
export function getTrialOffer(offerId: string): TrialOfferRecord | undefined {
  return offers.get(offerId);
}

/**
 * List all trial offers for a given player, newest first.
 */
export function listTrialOffersForPlayer(playerId: string): TrialOfferRecord[] {
  return [...offers.values()]
    .filter((o) => o.playerId === playerId)
    .sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * Update the status of a trial offer. Returns the updated record, or
 * `undefined` if no such offer exists.
 */
export function updateTrialOfferStatus(
  offerId: string,
  status: 'accepted' | 'rejected',
  responseReason?: string,
): TrialOfferRecord | undefined {
  const record = offers.get(offerId);
  if (!record) return undefined;

  const updated: TrialOfferRecord = {
    ...record,
    status,
    responseReason,
    respondedAt: Math.floor(Date.now() / 1000),
  };
  offers.set(offerId, updated);
  return updated;
}

/** Clear all records. Intended for use in tests only. */
export function clearTrialOffers(): void {
  offers.clear();
}
