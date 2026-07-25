/** @jest-environment node */
import { NextRequest } from 'next/server';
import jwt from 'jsonwebtoken';
import { POST } from '@/app/api/admin/introspect/route';
import { revokeToken, clearBlocklist } from '@/lib/tokenBlocklist';

const ADMIN = 'GADMIN0000000000000000000000000000000000000000000000000';
const SECRET = 'test-secret-key';

function makeRequest(
  body: unknown,
  cookie?: string,
): NextRequest {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
  };
  if (cookie !== undefined) {
    headers['cookie'] = `session=${cookie}`;
  }
  return new NextRequest('http://localhost/api/admin/introspect', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

/** Build a signed JWT (signature verification is NOT tested — introspect skips it). */
function makeToken(
  payload: Record<string, unknown>,
  options: jwt.SignOptions = {},
): string {
  return jwt.sign(payload, SECRET, { algorithm: 'HS256', ...options });
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_ADMIN_ADDRESS = ADMIN;
  clearBlocklist();
});

afterEach(() => {
  delete process.env.NEXT_PUBLIC_ADMIN_ADDRESS;
  clearBlocklist();
});

describe('POST /api/admin/introspect', () => {
  describe('auth guard', () => {
    it('returns 403 without a session cookie', async () => {
      const token = makeToken({ role: 'admin' });
      const res = await POST(makeRequest({ token }));
      expect(res.status).toBe(403);
    });

    it('returns 403 with a non-admin session cookie', async () => {
      const token = makeToken({ role: 'admin' });
      const res = await POST(makeRequest({ token }, 'GSOMEONEELSE'));
      expect(res.status).toBe(403);
    });
  });

  describe('input validation', () => {
    it('returns 400 when the token field is missing', async () => {
      const res = await POST(makeRequest({}, ADMIN));
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toMatch(/token field is required/i);
    });

    it('returns 400 when the token field is an empty string', async () => {
      const res = await POST(makeRequest({ token: '' }, ADMIN));
      expect(res.status).toBe(400);
    });

    it('returns 400 for invalid JSON body', async () => {
      const req = new NextRequest('http://localhost/api/admin/introspect', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: `session=${ADMIN}`,
        },
        body: 'not-json{{{',
      });
      const res = await POST(req);
      expect(res.status).toBe(400);
    });

    it('returns 422 for a structurally invalid JWT', async () => {
      const res = await POST(makeRequest({ token: 'not.a.jwt.at.all' }, ADMIN));
      expect(res.status).toBe(422);
    });
  });

  describe('decoding', () => {
    it('returns decoded claims for a valid, non-expired token', async () => {
      const token = makeToken({ sub: 'wallet-abc', role: 'player', jti: 'jti-1' });
      const res = await POST(makeRequest({ token }, ADMIN));
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.header).toMatchObject({ alg: 'HS256', typ: 'JWT' });
      expect(body.payload).toMatchObject({ sub: 'wallet-abc', role: 'player', jti: 'jti-1' });
      expect(body.revoked).toBe(false);
      expect(body.valid).toBe(true);
    });

    it('returns decoded claims for an expired token with valid: false', async () => {
      // Sign with a token that expired 10 seconds ago
      const expiredToken = makeToken(
        { sub: 'wallet-expired', role: 'scout' },
        { expiresIn: -10 }, // already expired
      );

      const res = await POST(makeRequest({ token: expiredToken }, ADMIN));
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.payload.sub).toBe('wallet-expired');
      expect(body.valid).toBe(false);
      expect(body.revoked).toBe(false);
    });

    it('adds ISO 8601 exp_iso and iat_iso to the payload', async () => {
      const token = makeToken({ sub: 'wallet-ts' }, { expiresIn: 3600 });
      const res = await POST(makeRequest({ token }, ADMIN));
      const body = await res.json();

      expect(typeof body.payload.exp_iso).toBe('string');
      expect(body.payload.exp_iso).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(typeof body.payload.iat_iso).toBe('string');
      expect(body.payload.iat_iso).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('does not add exp_iso / iat_iso when timestamps are absent', async () => {
      // Manually build a JWT without iat/exp by using a non-standard payload
      const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
      const payload = Buffer.from(JSON.stringify({ sub: 'no-timestamps' })).toString('base64url');
      const unsignedToken = `${header}.${payload}.`;

      const res = await POST(makeRequest({ token: unsignedToken }, ADMIN));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.payload.exp_iso).toBeUndefined();
      expect(body.payload.iat_iso).toBeUndefined();
    });
  });

  describe('revocation check', () => {
    it('adds revoked: true when the token jti is in the blocklist', async () => {
      const token = makeToken({ sub: 'wallet-rev', jti: 'revoked-jti-42' }, { expiresIn: 3600 });
      revokeToken('revoked-jti-42');

      const res = await POST(makeRequest({ token }, ADMIN));
      const body = await res.json();
      expect(body.revoked).toBe(true);
      expect(body.valid).toBe(false);
    });

    it('uses the raw token as the blocklist key when jti is absent', async () => {
      const token = makeToken({ sub: 'wallet-nojti' }, { expiresIn: 3600 });
      revokeToken(token);

      const res = await POST(makeRequest({ token }, ADMIN));
      const body = await res.json();
      expect(body.revoked).toBe(true);
      expect(body.valid).toBe(false);
    });

    it('does not mark a token as revoked when a different jti is blocked', async () => {
      const token = makeToken({ sub: 'wallet-safe', jti: 'safe-jti' }, { expiresIn: 3600 });
      revokeToken('other-jti');

      const res = await POST(makeRequest({ token }, ADMIN));
      const body = await res.json();
      expect(body.revoked).toBe(false);
      expect(body.valid).toBe(true);
    });
  });
});
