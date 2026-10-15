/**
 * Simple in-process SSE (Server-Sent Events) pub/sub for trial offer
 * notifications. Scouts subscribe by opening an SSE connection; the
 * accept/reject route handlers publish events here.
 *
 * In a real multi-instance deployment you would replace the in-process
 * subscriber map with a Redis pub/sub or similar cross-process channel.
 * The interface is intentionally narrow for easy swapping.
 */

export type TrialOfferEventType = 'trial_offer_accepted' | 'trial_offer_rejected';

export interface TrialOfferEvent {
  type: TrialOfferEventType;
  offerId: string;
  playerId: string;
  scoutId: string;
  responseReason?: string;
  timestamp: number;
}

type Subscriber = (event: TrialOfferEvent) => void;

// Map<scoutId, Set<subscriber callback>>
const subscribers = new Map<string, Set<Subscriber>>();

/**
 * Subscribe to trial offer events for a specific scout.
 * Returns an unsubscribe function.
 */
export function subscribeToTrialOfferEvents(
  scoutId: string,
  callback: Subscriber,
): () => void {
  if (!subscribers.has(scoutId)) {
    subscribers.set(scoutId, new Set());
  }
  subscribers.get(scoutId)!.add(callback);
  return () => {
    subscribers.get(scoutId)?.delete(callback);
  };
}

/**
 * Emit a trial offer event to all subscribers for the relevant scout.
 */
export function emitTrialOfferEvent(event: TrialOfferEvent): void {
  const subs = subscribers.get(event.scoutId);
  if (!subs) return;
  for (const cb of subs) {
    try {
      cb(event);
    } catch {
      // Individual subscriber errors must not disrupt others
    }
  }
}

/** Remove all subscribers. For use in tests only. */
export function clearTrialOfferSubscribers(): void {
  subscribers.clear();
}
