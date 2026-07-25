import { NextRequest, NextResponse } from 'next/server';
import { getTrialOffer, updateTrialOfferStatus } from '@/lib/trialOfferStore';
import { emitTrialOfferEvent } from '@/lib/trialOfferEvents';
import { createRequestLogger } from '@/lib/logger';

export const runtime = 'nodejs';

/**
 * POST /api/players/:playerId/trial-offers/:offerId/reject
 *
 * Updates the trial offer status to `rejected` with an optional `reason`
 * body field and emits a `trial_offer_rejected` SSE event to the relevant
 * scout's connection.
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
    log.warn('Unauthorized trial-offer reject attempt', { playerId, offerId });
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Optional reason from request body.
  let reason: string | undefined;
  try {
    const body = await req.json().catch(() => ({}));
    if (typeof body?.reason === 'string' && body.reason.trim() !== '') {
      reason = body.reason.trim();
    }
  } catch {
    // reason is optional — body parse errors are non-fatal
  }

  const offer = getTrialOffer(offerId);
  if (!offer) {
    return NextResponse.json({ error: 'Trial offer not found' }, { status: 404 });
  }

  // The responding player must be the offer recipient.
  if (offer.playerId !== playerId) {
    log.warn('Player tried to reject another player\'s offer', { playerId, offerId });
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // A trial offer can only be responded to once.
  if (offer.status !== 'pending') {
    return NextResponse.json(
      { error: `Trial offer has already been ${offer.status}` },
      { status: 409 },
    );
  }

  const updated = updateTrialOfferStatus(offerId, 'rejected', reason);
  if (!updated) {
    return NextResponse.json({ error: 'Failed to update trial offer' }, { status: 500 });
  }

  // Emit SSE event to the relevant scout's connection.
  emitTrialOfferEvent({
    type: 'trial_offer_rejected',
    offerId,
    playerId,
    scoutId: offer.scoutId,
    responseReason: reason,
    timestamp: updated.respondedAt ?? Math.floor(Date.now() / 1000),
  });

  log.info('Trial offer rejected', { offerId, playerId, scoutId: offer.scoutId, reason });
  return NextResponse.json({ trialOffer: updated }, { status: 200 });
}
