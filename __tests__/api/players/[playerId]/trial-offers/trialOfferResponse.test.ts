/** @jest-environment node */
import { NextRequest } from 'next/server';
import {
  createTrialOffer,
  clearTrialOffers,
  getTrialOffer,
} from '@/lib/trialOfferStore';
import { clearTrialOfferSubscribers } from '@/lib/trialOfferEvents';

// Import route handlers directly
import { GET } from '@/app/api/players/[playerId]/trial-offers/route';
import { POST as accept } from '@/app/api/players/[playerId]/trial-offers/[offerId]/accept/route';
import { POST as reject } from '@/app/api/players/[playerId]/trial-offers/[offerId]/reject/route';

const PLAYER_A = 'player-wallet-AAAA';
const PLAYER_B = 'player-wallet-BBBB';
const SCOUT_X = 'scout-wallet-XXXX';

function makeReq(
  url: string,
  options: {
    method?: string;
    session?: string;
    body?: unknown;
  } = {},
): NextRequest {
  const headers: Record<string, string> = {};
  if (options.session) headers['cookie'] = `session=${options.session}`;
  if (options.body) headers['content-type'] = 'application/json';

  return new NextRequest(url, {
    method: options.method ?? 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
}

function seedOffer(
  overrides: {
    id?: string;
    playerId?: string;
    scoutId?: string;
    details?: string;
    status?: 'pending' | 'accepted' | 'rejected';
  } = {},
) {
  const record = createTrialOffer({
    id: overrides.id ?? 'offer-001',
    playerId: overrides.playerId ?? PLAYER_A,
    scoutId: overrides.scoutId ?? SCOUT_X,
    details: overrides.details ?? 'Trial at Lagos FC',
  });
  // If a non-pending status is required, manually patch via store
  if (overrides.status && overrides.status !== 'pending') {
    const { updateTrialOfferStatus } = require('@/lib/trialOfferStore');
    updateTrialOfferStatus(record.id, overrides.status);
    return getTrialOffer(record.id)!;
  }
  return record;
}

beforeEach(() => {
  clearTrialOffers();
  clearTrialOfferSubscribers();
});

afterEach(() => {
  clearTrialOffers();
  clearTrialOfferSubscribers();
});

// ── GET /api/players/:playerId/trial-offers ────────────────────────────────

describe('GET /api/players/:playerId/trial-offers', () => {
  it('returns 403 without a session cookie', async () => {
    const res = await GET(
      makeReq(`http://localhost/api/players/${PLAYER_A}/trial-offers`),
      { params: { playerId: PLAYER_A } },
    );
    expect(res.status).toBe(403);
  });

  it('returns 403 when the session belongs to a different player', async () => {
    const res = await GET(
      makeReq(`http://localhost/api/players/${PLAYER_A}/trial-offers`, {
        session: PLAYER_B,
      }),
      { params: { playerId: PLAYER_A } },
    );
    expect(res.status).toBe(403);
  });

  it('returns an empty array when the player has no trial offers', async () => {
    const res = await GET(
      makeReq(`http://localhost/api/players/${PLAYER_A}/trial-offers`, {
        session: PLAYER_A,
      }),
      { params: { playerId: PLAYER_A } },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.trialOffers).toEqual([]);
  });

  it('lists only offers belonging to the requesting player', async () => {
    seedOffer({ id: 'o-1', playerId: PLAYER_A });
    seedOffer({ id: 'o-2', playerId: PLAYER_B }); // different player
    seedOffer({ id: 'o-3', playerId: PLAYER_A });

    const res = await GET(
      makeReq(`http://localhost/api/players/${PLAYER_A}/trial-offers`, {
        session: PLAYER_A,
      }),
      { params: { playerId: PLAYER_A } },
    );
    const body = await res.json();
    expect(body.trialOffers).toHaveLength(2);
    expect(body.trialOffers.map((o: any) => o.id)).toEqual(
      expect.arrayContaining(['o-1', 'o-3']),
    );
  });

  it('includes the current status of each offer', async () => {
    seedOffer({ id: 'o-pending', playerId: PLAYER_A });
    seedOffer({ id: 'o-accepted', playerId: PLAYER_A, status: 'accepted' });

    const res = await GET(
      makeReq(`http://localhost/api/players/${PLAYER_A}/trial-offers`, {
        session: PLAYER_A,
      }),
      { params: { playerId: PLAYER_A } },
    );
    const body = await res.json();
    const statuses = new Set(body.trialOffers.map((o: any) => o.status));
    expect(statuses).toContain('pending');
    expect(statuses).toContain('accepted');
  });
});

// ── POST /api/players/:playerId/trial-offers/:offerId/accept ───────────────

describe('POST /api/players/:playerId/trial-offers/:offerId/accept', () => {
  it('returns 403 without a session cookie', async () => {
    seedOffer({ id: 'o-auth', playerId: PLAYER_A });
    const res = await accept(
      makeReq(`http://localhost/api/players/${PLAYER_A}/trial-offers/o-auth/accept`, {
        method: 'POST',
      }),
      { params: { playerId: PLAYER_A, offerId: 'o-auth' } },
    );
    expect(res.status).toBe(403);
  });

  it('returns 403 when a different player tries to accept the offer', async () => {
    seedOffer({ id: 'o-other', playerId: PLAYER_A });
    const res = await accept(
      makeReq(`http://localhost/api/players/${PLAYER_A}/trial-offers/o-other/accept`, {
        method: 'POST',
        session: PLAYER_B, // wrong player
      }),
      { params: { playerId: PLAYER_A, offerId: 'o-other' } },
    );
    expect(res.status).toBe(403);
  });

  it('returns 404 when the offer does not exist', async () => {
    const res = await accept(
      makeReq(`http://localhost/api/players/${PLAYER_A}/trial-offers/no-such/accept`, {
        method: 'POST',
        session: PLAYER_A,
      }),
      { params: { playerId: PLAYER_A, offerId: 'no-such' } },
    );
    expect(res.status).toBe(404);
  });

  it('returns 200 and updates the offer status to accepted', async () => {
    seedOffer({ id: 'o-acc', playerId: PLAYER_A });

    const res = await accept(
      makeReq(`http://localhost/api/players/${PLAYER_A}/trial-offers/o-acc/accept`, {
        method: 'POST',
        session: PLAYER_A,
      }),
      { params: { playerId: PLAYER_A, offerId: 'o-acc' } },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.trialOffer.status).toBe('accepted');
    expect(body.trialOffer.respondedAt).toBeDefined();
  });

  it('returns 409 when the offer has already been accepted', async () => {
    seedOffer({ id: 'o-dup', playerId: PLAYER_A, status: 'accepted' });

    const res = await accept(
      makeReq(`http://localhost/api/players/${PLAYER_A}/trial-offers/o-dup/accept`, {
        method: 'POST',
        session: PLAYER_A,
      }),
      { params: { playerId: PLAYER_A, offerId: 'o-dup' } },
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toMatch(/already been accepted/i);
  });

  it('returns 409 when the offer has already been rejected', async () => {
    seedOffer({ id: 'o-rej-dup', playerId: PLAYER_A, status: 'rejected' });

    const res = await accept(
      makeReq(`http://localhost/api/players/${PLAYER_A}/trial-offers/o-rej-dup/accept`, {
        method: 'POST',
        session: PLAYER_A,
      }),
      { params: { playerId: PLAYER_A, offerId: 'o-rej-dup' } },
    );
    expect(res.status).toBe(409);
  });
});

// ── POST /api/players/:playerId/trial-offers/:offerId/reject ───────────────

describe('POST /api/players/:playerId/trial-offers/:offerId/reject', () => {
  it('returns 403 without a session cookie', async () => {
    seedOffer({ id: 'o-rej-auth', playerId: PLAYER_A });
    const res = await reject(
      makeReq(`http://localhost/api/players/${PLAYER_A}/trial-offers/o-rej-auth/reject`, {
        method: 'POST',
      }),
      { params: { playerId: PLAYER_A, offerId: 'o-rej-auth' } },
    );
    expect(res.status).toBe(403);
  });

  it('returns 403 when a different player tries to reject the offer', async () => {
    seedOffer({ id: 'o-rej-other', playerId: PLAYER_A });
    const res = await reject(
      makeReq(`http://localhost/api/players/${PLAYER_A}/trial-offers/o-rej-other/reject`, {
        method: 'POST',
        session: PLAYER_B,
      }),
      { params: { playerId: PLAYER_A, offerId: 'o-rej-other' } },
    );
    expect(res.status).toBe(403);
  });

  it('returns 404 when the offer does not exist', async () => {
    const res = await reject(
      makeReq(`http://localhost/api/players/${PLAYER_A}/trial-offers/nonexistent/reject`, {
        method: 'POST',
        session: PLAYER_A,
      }),
      { params: { playerId: PLAYER_A, offerId: 'nonexistent' } },
    );
    expect(res.status).toBe(404);
  });

  it('returns 200 and updates the offer status to rejected', async () => {
    seedOffer({ id: 'o-rej-ok', playerId: PLAYER_A });

    const res = await reject(
      makeReq(`http://localhost/api/players/${PLAYER_A}/trial-offers/o-rej-ok/reject`, {
        method: 'POST',
        session: PLAYER_A,
      }),
      { params: { playerId: PLAYER_A, offerId: 'o-rej-ok' } },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.trialOffer.status).toBe('rejected');
  });

  it('stores the optional rejection reason', async () => {
    seedOffer({ id: 'o-reason', playerId: PLAYER_A });

    const res = await reject(
      makeReq(`http://localhost/api/players/${PLAYER_A}/trial-offers/o-reason/reject`, {
        method: 'POST',
        session: PLAYER_A,
        body: { reason: 'Scheduling conflict' },
      }),
      { params: { playerId: PLAYER_A, offerId: 'o-reason' } },
    );
    const body = await res.json();
    expect(body.trialOffer.responseReason).toBe('Scheduling conflict');
  });

  it('returns 409 when the offer has already been responded to', async () => {
    seedOffer({ id: 'o-rej-twice', playerId: PLAYER_A, status: 'accepted' });

    const res = await reject(
      makeReq(`http://localhost/api/players/${PLAYER_A}/trial-offers/o-rej-twice/reject`, {
        method: 'POST',
        session: PLAYER_A,
      }),
      { params: { playerId: PLAYER_A, offerId: 'o-rej-twice' } },
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toMatch(/already been accepted/i);
  });
});
