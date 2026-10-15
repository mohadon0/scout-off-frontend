import { NextRequest, NextResponse } from 'next/server';
import { listTrialOffersForPlayer } from '@/lib/trialOfferStore';
import { createRequestLogger } from '@/lib/logger';

export const runtime = 'nodejs';

/**
 * GET /api/players/:playerId/trial-offers
 *
 * Lists all trial offers received by the player with their current status.
 * Requires a player session cookie that matches the requested playerId.
 *
 * Returns an array of trial offer records ordered newest-first.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { playerId: string } },
) {
  const log = createRequestLogger(req);
  const { playerId } = params;

  // Auth: the session cookie must match the requested playerId.
  // Players may only list their own offers.
  const sessionCookie = req.cookies.get('session')?.value;
  if (!sessionCookie || sessionCookie !== playerId) {
    log.warn('Unauthorized trial-offer list attempt', { playerId });
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const trialOffers = listTrialOffersForPlayer(playerId);
  return NextResponse.json({ trialOffers });
}
