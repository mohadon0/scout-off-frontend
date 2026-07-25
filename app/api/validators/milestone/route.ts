import { NextRequest, NextResponse } from 'next/server';
import { createRequestLogger } from '@/lib/logger';
import {
  isIpfsCid,
  downloadAndPin,
  isAcceptedContentType,
  EvidenceContentTypeError,
  EvidenceSizeError,
  EvidencePinError,
  ACCEPTED_CONTENT_TYPES,
} from '@/lib/evidencePinner';
import { sanitize } from '@/lib/sanitize';

export const runtime = 'nodejs';

/**
 * POST /api/validators/milestone
 *
 * Accepts a validator's milestone submission. The `evidence_uri` field is
 * normalised to a CID before storage:
 *
 * - If it's already an IPFS CID (v0/v1) it is stored as-is.
 * - If it's an HTTPS URL, the content is fetched, its Content-Type and size
 *   are validated, then it is pinned to IPFS via Pinata. The returned CID
 *   replaces the original URL in the stored record.
 *
 * Content-Type rules (HTTP 422 if violated):
 *   - video/*
 *   - image/*
 *   - application/pdf
 *   - text/plain
 *
 * Size limit: EVIDENCE_MAX_BYTES env var (default 50 MB). Returns 422 when
 * exceeded.
 *
 * Request body:
 * {
 *   playerId:     string  — required
 *   validatorId:  string  — required
 *   description:  string  — required
 *   evidence_uri: string  — required; HTTPS URL or IPFS CID
 * }
 *
 * Response on success (201):
 * {
 *   milestone: {
 *     id:           string
 *     playerId:     string
 *     validatorId:  string
 *     description:  string
 *     evidence_uri: string  — always a CID
 *     createdAt:    number  — Unix seconds
 *   }
 * }
 */
export async function POST(req: NextRequest) {
  const log = createRequestLogger(req);

  // Auth: requires a validator session cookie.
  const sessionCookie = req.cookies.get('session')?.value;
  if (!sessionCookie) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Parse body
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const {
    playerId,
    validatorId,
    description,
    evidence_uri: rawEvidence,
  } = (body ?? {}) as Record<string, unknown>;

  // Field validation
  if (typeof playerId !== 'string' || playerId.trim() === '') {
    return NextResponse.json({ error: 'playerId is required' }, { status: 400 });
  }
  if (typeof validatorId !== 'string' || validatorId.trim() === '') {
    return NextResponse.json({ error: 'validatorId is required' }, { status: 400 });
  }
  if (typeof description !== 'string' || description.trim() === '') {
    return NextResponse.json({ error: 'description is required' }, { status: 400 });
  }
  if (typeof rawEvidence !== 'string' || rawEvidence.trim() === '') {
    return NextResponse.json({ error: 'evidence_uri is required' }, { status: 400 });
  }

  const evidenceInput = rawEvidence.trim();

  // Resolve evidence_uri to a CID
  let evidenceCid: string;

  if (isIpfsCid(evidenceInput)) {
    // Already a CID — use as-is
    evidenceCid = evidenceInput;
  } else if (evidenceInput.startsWith('https://') || evidenceInput.startsWith('http://')) {
    // HTTPS URL — download, validate, pin
    try {
      evidenceCid = await downloadAndPin(evidenceInput);
    } catch (err) {
      if (err instanceof EvidenceContentTypeError) {
        log.warn('Rejected evidence: unsupported content type', {
          url: evidenceInput,
          contentType: err.contentType,
        });
        return NextResponse.json(
          {
            error: `Unsupported content type "${err.contentType}". Accepted types: ${ACCEPTED_CONTENT_TYPES.join(', ')}`,
          },
          { status: 422 },
        );
      }
      if (err instanceof EvidenceSizeError) {
        log.warn('Rejected evidence: file too large', {
          url: evidenceInput,
          bytes: err.bytes,
          maxBytes: err.maxBytes,
        });
        return NextResponse.json({ error: err.message }, { status: 422 });
      }
      if (err instanceof EvidencePinError) {
        log.error('Evidence pin failed', {
          url: evidenceInput,
          reason: err.message,
        });
        return NextResponse.json({ error: 'Failed to pin evidence to IPFS' }, { status: 502 });
      }
      throw err;
    }
  } else {
    return NextResponse.json(
      { error: 'evidence_uri must be an IPFS CID or an HTTPS URL' },
      { status: 400 },
    );
  }

  // Build the stored milestone record (sanitize free-text field).
  const milestone = {
    id: `ms-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    playerId: playerId.trim(),
    validatorId: validatorId.trim(),
    description: sanitize(description.trim()),
    evidence_uri: evidenceCid,
    createdAt: Math.floor(Date.now() / 1000),
  };

  log.info('Milestone submitted', {
    milestoneId: milestone.id,
    playerId: milestone.playerId,
    validatorId: milestone.validatorId,
    evidencePinned: rawEvidence !== evidenceCid,
  });

  return NextResponse.json({ milestone }, { status: 201 });
}
