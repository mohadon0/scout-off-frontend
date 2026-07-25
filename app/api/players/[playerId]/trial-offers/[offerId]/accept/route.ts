import { NextRequest, NextResponse } from 'next/server';
import { getTrialOffer, updateTrialOfferStatus } from '@/lib/trialOfferStore';
import { emitTrialOfferEvent } from '@/lib/trialOfferEvents';
import { createRequestLogger } from '@/lib/logger';

export const runtime = 'nodejs';

/**
 * POST /api/players/:playerId/trial-offers/:offerId/accept
 *
 * Updates the trial offer status to `accepted` and emits a
 * `trial_offer_accepted` SSE event to the relevant scout's connection.
 *
 * Rules:
 * - Requires a player session cookie matching playerId.
 * - The offer must belong to the requesting player (403 otherwise).
 * - A trial offer can only be responded to once; a second accept/reject
 *   returns HTTP 409.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { playerId: string; offerId: string } },
) {
  const log = createRequestLogger(req);
  const { playerId, offerId } = params;

  // Auth: session cookie must match playerId.
  const sessionCookie = req.cookies.get('session')?.value;
  if (!sessionCookie || sessionCookie !== playerId) {
    log.warn('Unauthorized trial-offer accept attempt', { playerId, offerId });
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const offer = getTrialOffer(offerId);
  if (!offer) {
    return NextResponse.json({ error: 'Trial offer not found' }, { status: 404 });
  }

  // The responding player must be the offer recipient.
  if (offer.playerId !== playerId) {
    log.warn('Player tried to accept another player\'s offer', { playerId, offerId });
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // A trial offer can only be responded to once.
  if (offer.status !== 'pending') {
    return NextResponse.json(
      { error: `Trial offer has already been ${offer.status}` },
      { status: 409 },
    );
  }

  const updated = updateTrialOfferStatus(offerId, 'accepted');
  if (!updated) {
    return NextResponse.json({ error: 'Failed to update trial offer' }, { status: 500 });
  }

  // Emit SSE event to the relevant scout's connection.
  emitTrialOfferEvent({
    type: 'trial_offer_accepted',
    offerId,
    playerId,
    scoutId: offer.scoutId,
    timestamp: updated.respondedAt ?? Math.floor(Date.now() / 1000),
  });

  log.info('Trial offer accepted', { offerId, playerId, scoutId: offer.scoutId });
  return NextResponse.json({ trialOffer: updated }, { status: 200 });
}
