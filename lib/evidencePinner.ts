import axios from 'axios';

/**
 * Accepted MIME type prefixes for milestone evidence.
 * Anything that doesn't start with one of these is rejected with HTTP 422.
 */
export const ACCEPTED_CONTENT_TYPES = [
  'video/',
  'image/',
  'application/pdf',
  'text/plain',
] as const;

/**
 * Default maximum evidence file size in bytes (50 MB).
 * Override with the EVIDENCE_MAX_BYTES env var.
 */
export function getEvidenceMaxBytes(): number {
  const raw = process.env.EVIDENCE_MAX_BYTES;
  if (raw) {
    const parsed = parseInt(raw, 10);
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }
  return 50 * 1024 * 1024; // 50 MB default
}

/**
 * Returns true when the given string looks like an IPFS CID (v0 or v1).
 * - CIDv0: Qm… (Base58, 46 characters)
 * - CIDv1: bafy… or similar (Base32/Base58btc, ≥32 chars, no protocol prefix)
 */
export function isIpfsCid(value: string): boolean {
  // CIDv0: starts with "Qm" followed by 44 base58 characters
  if (/^Qm[1-9A-HJ-NP-Za-km-z]{44}$/.test(value)) return true;
  // CIDv1: starts with "b" or "z" followed by at least 30 base32/base58 chars
  if (/^[bz][a-zA-Z0-9]{30,}$/.test(value)) return true;
  return false;
}

/**
 * Returns true if the content type is accepted for milestone evidence.
 */
export function isAcceptedContentType(contentType: string): boolean {
  const ct = contentType.toLowerCase().split(';')[0].trim();
  return ACCEPTED_CONTENT_TYPES.some((prefix) => ct.startsWith(prefix));
}

/**
 * Download an HTTPS URL, validate its Content-Type and size, then pin it to
 * IPFS via Pinata's `pinFileToIPFS` endpoint. Returns the resulting CID.
 *
 * Throws typed errors so callers can map them to the right HTTP status:
 * - `EvidenceContentTypeError` → 422
 * - `EvidenceSizeError`        → 422
 * - `EvidencePinError`         → 502
 */
export class EvidenceContentTypeError extends Error {
  contentType: string;
  constructor(contentType: string) {
    super(`Unsupported content type: ${contentType}`);
    this.name = 'EvidenceContentTypeError';
    this.contentType = contentType;
  }
}

export class EvidenceSizeError extends Error {
  bytes: number;
  maxBytes: number;
  constructor(bytes: number, maxBytes: number) {
    super(
      `Evidence file is too large: ${(bytes / 1024 / 1024).toFixed(1)} MB (max ${(maxBytes / 1024 / 1024).toFixed(0)} MB)`,
    );
    this.name = 'EvidenceSizeError';
    this.bytes = bytes;
    this.maxBytes = maxBytes;
  }
}

export class EvidencePinError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EvidencePinError';
  }
}

/**
 * Download the content at `url`, validate content type and size, then pin it
 * to IPFS via Pinata. Returns the CID string.
 */
export async function downloadAndPin(url: string): Promise<string> {
  const maxBytes = getEvidenceMaxBytes();

  // Stream the response so we can check Content-Type and size before
  // buffering the whole file.
  let response: Awaited<ReturnType<typeof axios.get>>;
  try {
    response = await axios.get(url, {
      responseType: 'arraybuffer',
      maxContentLength: maxBytes,
      maxBodyLength: maxBytes,
      validateStatus: (s) => s === 200,
    });
  } catch (err: unknown) {
    if (axios.isAxiosError(err)) {
      if (err.code === 'ERR_CONTENT_LENGTH_EXCEEDED' || err.code === 'ERR_BODY_LENGTH_EXCEEDED') {
        throw new EvidenceSizeError(maxBytes + 1, maxBytes);
      }
      const msg = err.response
        ? `Remote server returned HTTP ${err.response.status}`
        : (err.message ?? 'Failed to download evidence URL');
      throw new EvidencePinError(msg);
    }
    throw new EvidencePinError(
      err instanceof Error ? err.message : 'Failed to download evidence URL',
    );
  }

  // Content-Type validation
  const rawCt = (response.headers['content-type'] as string | undefined) ?? '';
  if (!isAcceptedContentType(rawCt)) {
    throw new EvidenceContentTypeError(rawCt || 'unknown');
  }

  // Size validation (defensive — axios maxContentLength should catch most cases)
  const buffer = Buffer.from(response.data as ArrayBuffer);
  if (buffer.length > maxBytes) {
    throw new EvidenceSizeError(buffer.length, maxBytes);
  }

  // Derive a filename from the URL path, falling back to "evidence"
  const urlPath = new URL(url).pathname;
  const filename = urlPath.split('/').pop() || 'evidence';
  const mimeType = rawCt.split(';')[0].trim();

  // Pin to Pinata
  const pinataForm = new FormData();
  const file = new File([new Uint8Array(buffer)], filename, { type: mimeType });
  pinataForm.append('file', file);

  let cid: string;
  try {
    const { data } = await axios.post(
      'https://api.pinata.cloud/pinning/pinFileToIPFS',
      pinataForm,
      {
        headers: {
          pinata_api_key: process.env.PINATA_API_KEY!,
          pinata_secret_api_key: process.env.PINATA_SECRET!,
        },
      },
    );
    cid = data.IpfsHash as string;
  } catch (err) {
    throw new EvidencePinError(
      err instanceof Error ? `Pinata upload failed: ${err.message}` : 'Pinata upload failed',
    );
  }

  return cid;
}
