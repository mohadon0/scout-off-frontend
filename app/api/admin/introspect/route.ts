import { NextRequest, NextResponse } from 'next/server';
import jwt from 'jsonwebtoken';
import { requireAdminWallet } from '@/lib/adminAuth';
import { isRevoked } from '@/lib/tokenBlocklist';
import { createRequestLogger } from '@/lib/logger';

export const runtime = 'nodejs';

/**
 * POST /api/admin/introspect
 *
 * Decodes a JWT's claims WITHOUT verifying the signature — useful for
 * debugging expired or malformed tokens without needing DB access.
 *
 * Request body: { token: string }
 *
 * Response:
 * {
 *   header:   { alg, typ, ... }           — raw JOSE header
 *   payload:  { ...claims, exp_iso?, iat_iso? }  — decoded payload with
 *                                            human-readable timestamp fields
 *   revoked:  boolean                      — true if token is in the blocklist
 *   valid:    boolean                      — not expired AND not revoked
 * }
 *
 * Requires an admin session cookie. Returns 403 for non-admins and 400 when
 * the `token` field is missing.
 */
export async function POST(req: NextRequest) {
  const log = createRequestLogger(req);

  const admin = requireAdminWallet(req);
  if (!admin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { token } = (body ?? {}) as Record<string, unknown>;
  if (typeof token !== 'string' || token.trim() === '') {
    return NextResponse.json({ error: 'token field is required' }, { status: 400 });
  }

  // Decode without signature verification so expired / malformed tokens are
  // still readable. jwt.decode returns null for structurally invalid JWTs.
  const decoded = jwt.decode(token.trim(), { complete: true });
  if (!decoded) {
    log.warn('Introspect received structurally invalid JWT');
    return NextResponse.json({ error: 'Unable to decode token — not a valid JWT structure' }, { status: 422 });
  }

  const { header, payload } = decoded as {
    header: Record<string, unknown>;
    payload: Record<string, unknown> | string;
  };

  // jwt.decode can return a string payload for non-JSON tokens; normalise to
  // an object so the response shape is always consistent.
  const payloadObj: Record<string, unknown> =
    typeof payload === 'string' ? { raw: payload } : { ...payload };

  // Add human-readable ISO 8601 equivalents for numeric timestamps.
  if (typeof payloadObj.exp === 'number') {
    payloadObj.exp_iso = new Date(payloadObj.exp * 1000).toISOString();
  }
  if (typeof payloadObj.iat === 'number') {
    payloadObj.iat_iso = new Date(payloadObj.iat * 1000).toISOString();
  }

  // Determine revocation state. Prefer jti as the blocklist key; fall back to
  // the raw token string for tokens that lack a jti.
  const blocklistKey =
    typeof payloadObj.jti === 'string' ? payloadObj.jti : token.trim();
  const revoked = isRevoked(blocklistKey);

  // A token is "valid" only when it is not expired AND not revoked.
  const nowSec = Math.floor(Date.now() / 1000);
  const expired =
    typeof payloadObj.exp === 'number' && payloadObj.exp < nowSec;
  const valid = !expired && !revoked;

  return NextResponse.json({
    header,
    payload: payloadObj,
    revoked,
    valid,
  });
}
