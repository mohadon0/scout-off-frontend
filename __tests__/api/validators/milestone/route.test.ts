/** @jest-environment node */
import { NextRequest } from 'next/server';
import axios from 'axios';
import { POST } from '@/app/api/validators/milestone/route';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;
// Also mock isAxiosError used in evidencePinner
(axios.isAxiosError as jest.Mock) = jest.fn((err) => {
  return err && err.__isAxiosError === true;
});

const SESSION = 'validator-wallet-TEST';

function makeRequest(
  body: unknown,
  session?: string,
): NextRequest {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
  };
  if (session) headers['cookie'] = `session=${session}`;
  return new NextRequest('http://localhost/api/validators/milestone', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

function makeAxiosDownloadResponse(contentType: string, body: Buffer | Uint8Array = Buffer.from('data')) {
  return {
    data: body.buffer ?? body,
    headers: { 'content-type': contentType },
    status: 200,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.PINATA_API_KEY = 'test-pinata-key';
  process.env.PINATA_SECRET = 'test-pinata-secret';
  delete process.env.EVIDENCE_MAX_BYTES;
});

afterEach(() => {
  delete process.env.PINATA_API_KEY;
  delete process.env.PINATA_SECRET;
  delete process.env.EVIDENCE_MAX_BYTES;
});

describe('POST /api/validators/milestone', () => {
  describe('auth', () => {
    it('returns 401 without a session cookie', async () => {
      const res = await POST(
        makeRequest({ playerId: 'p1', validatorId: 'v1', description: 'd', evidence_uri: 'QmFakeCid' }),
      );
      expect(res.status).toBe(401);
    });
  });

  describe('input validation', () => {
    const validBody = {
      playerId: 'player-001',
      validatorId: 'validator-001',
      description: 'Scored 5 goals in Local Cup',
      evidence_uri: 'QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG',
    };

    it.each([
      ['playerId', { ...validBody, playerId: '' }],
      ['validatorId', { ...validBody, validatorId: '' }],
      ['description', { ...validBody, description: '' }],
      ['evidence_uri', { ...validBody, evidence_uri: '' }],
    ])('returns 400 when %s is missing or empty', async (field, body) => {
      const res = await POST(makeRequest(body, SESSION));
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toMatch(new RegExp(field, 'i'));
    });

    it('returns 400 when evidence_uri is not a CID or HTTPS URL', async () => {
      const res = await POST(makeRequest({ ...validBody, evidence_uri: 'ftp://invalid' }, SESSION));
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toMatch(/IPFS CID or an HTTPS URL/i);
    });
  });

  describe('CID passthrough', () => {
    it('stores a CIDv0 as-is without calling Pinata', async () => {
      const cid = 'QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG';
      const res = await POST(
        makeRequest(
          { playerId: 'p1', validatorId: 'v1', description: 'Goal', evidence_uri: cid },
          SESSION,
        ),
      );
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.milestone.evidence_uri).toBe(cid);
      expect(mockedAxios.post).not.toHaveBeenCalled();
    });

    it('stores a CIDv1 as-is without calling Pinata', async () => {
      const cid = 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi';
      const res = await POST(
        makeRequest(
          { playerId: 'p1', validatorId: 'v1', description: 'Sprint', evidence_uri: cid },
          SESSION,
        ),
      );
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.milestone.evidence_uri).toBe(cid);
      expect(mockedAxios.post).not.toHaveBeenCalled();
    });
  });

  describe('HTTPS URL pinning', () => {
    it('pins a valid video URL and returns the CID', async () => {
      mockedAxios.get.mockResolvedValue(
        makeAxiosDownloadResponse('video/mp4', Buffer.alloc(1024)),
      );
      mockedAxios.post.mockResolvedValue({ data: { IpfsHash: 'QmPinnedVideoCid' } });

      const res = await POST(
        makeRequest(
          {
            playerId: 'p1',
            validatorId: 'v1',
            description: 'Match recording',
            evidence_uri: 'https://example.com/video.mp4',
          },
          SESSION,
        ),
      );
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.milestone.evidence_uri).toBe('QmPinnedVideoCid');
    });

    it('pins a valid image URL and returns the CID', async () => {
      mockedAxios.get.mockResolvedValue(
        makeAxiosDownloadResponse('image/jpeg', Buffer.alloc(512)),
      );
      mockedAxios.post.mockResolvedValue({ data: { IpfsHash: 'QmPinnedImageCid' } });

      const res = await POST(
        makeRequest(
          {
            playerId: 'p1',
            validatorId: 'v1',
            description: 'Action photo',
            evidence_uri: 'https://example.com/photo.jpg',
          },
          SESSION,
        ),
      );
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.milestone.evidence_uri).toBe('QmPinnedImageCid');
    });

    it('pins application/pdf and returns the CID', async () => {
      mockedAxios.get.mockResolvedValue(
        makeAxiosDownloadResponse('application/pdf', Buffer.alloc(256)),
      );
      mockedAxios.post.mockResolvedValue({ data: { IpfsHash: 'QmPinnedPdfCid' } });

      const res = await POST(
        makeRequest(
          {
            playerId: 'p1',
            validatorId: 'v1',
            description: 'Certificate',
            evidence_uri: 'https://example.com/cert.pdf',
          },
          SESSION,
        ),
      );
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.milestone.evidence_uri).toBe('QmPinnedPdfCid');
    });

    it('pins text/plain and returns the CID', async () => {
      mockedAxios.get.mockResolvedValue(
        makeAxiosDownloadResponse('text/plain; charset=utf-8', Buffer.from('stats')),
      );
      mockedAxios.post.mockResolvedValue({ data: { IpfsHash: 'QmPinnedTextCid' } });

      const res = await POST(
        makeRequest(
          {
            playerId: 'p1',
            validatorId: 'v1',
            description: 'Stats note',
            evidence_uri: 'https://example.com/stats.txt',
          },
          SESSION,
        ),
      );
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.milestone.evidence_uri).toBe('QmPinnedTextCid');
    });

    it('rejects application/x-executable with 422', async () => {
      mockedAxios.get.mockResolvedValue(
        makeAxiosDownloadResponse('application/x-executable', Buffer.alloc(100)),
      );

      const res = await POST(
        makeRequest(
          {
            playerId: 'p1',
            validatorId: 'v1',
            description: 'Bad evidence',
            evidence_uri: 'https://example.com/malware.exe',
          },
          SESSION,
        ),
      );
      expect(res.status).toBe(422);
      const body = await res.json();
      expect(body.error).toMatch(/unsupported content type/i);
    });

    it('rejects application/zip with 422', async () => {
      mockedAxios.get.mockResolvedValue(
        makeAxiosDownloadResponse('application/zip', Buffer.alloc(100)),
      );

      const res = await POST(
        makeRequest(
          {
            playerId: 'p1',
            validatorId: 'v1',
            description: 'Zip file',
            evidence_uri: 'https://example.com/archive.zip',
          },
          SESSION,
        ),
      );
      expect(res.status).toBe(422);
    });

    it('rejects files exceeding EVIDENCE_MAX_BYTES with 422', async () => {
      process.env.EVIDENCE_MAX_BYTES = String(1024); // 1 KB limit for this test
      // Simulate axios throwing a size-exceeded error
      const axiosErr = Object.assign(new Error('Content length exceeded'), {
        __isAxiosError: true,
        code: 'ERR_CONTENT_LENGTH_EXCEEDED',
        response: undefined,
      });
      mockedAxios.get.mockRejectedValue(axiosErr);
      (axios.isAxiosError as jest.Mock).mockReturnValueOnce(true);

      const res = await POST(
        makeRequest(
          {
            playerId: 'p1',
            validatorId: 'v1',
            description: 'Huge file',
            evidence_uri: 'https://example.com/huge.mp4',
          },
          SESSION,
        ),
      );
      expect(res.status).toBe(422);
      const body = await res.json();
      expect(body.error).toMatch(/too large/i);
    });

    it('returns 502 when Pinata upload fails', async () => {
      mockedAxios.get.mockResolvedValue(
        makeAxiosDownloadResponse('video/mp4', Buffer.alloc(100)),
      );
      mockedAxios.post.mockRejectedValue(new Error('Pinata unavailable'));

      const res = await POST(
        makeRequest(
          {
            playerId: 'p1',
            validatorId: 'v1',
            description: 'Video',
            evidence_uri: 'https://example.com/clip.mp4',
          },
          SESSION,
        ),
      );
      expect(res.status).toBe(502);
    });
  });

  describe('stored record', () => {
    it('always stores evidence_uri as a CID after pinning', async () => {
      mockedAxios.get.mockResolvedValue(
        makeAxiosDownloadResponse('image/png', Buffer.alloc(64)),
      );
      mockedAxios.post.mockResolvedValue({ data: { IpfsHash: 'QmStoredCid' } });

      const res = await POST(
        makeRequest(
          {
            playerId: 'player-xyz',
            validatorId: 'val-abc',
            description: 'Photo evidence',
            evidence_uri: 'https://example.com/img.png',
          },
          SESSION,
        ),
      );
      const body = await res.json();
      // evidence_uri must be a CID, not the original URL
      expect(body.milestone.evidence_uri).toBe('QmStoredCid');
      expect(body.milestone.evidence_uri).not.toContain('https://');
    });

    it('returns all expected milestone fields', async () => {
      const cid = 'QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG';
      const res = await POST(
        makeRequest(
          {
            playerId: 'player-A',
            validatorId: 'validator-B',
            description: 'Scored a hat-trick',
            evidence_uri: cid,
          },
          SESSION,
        ),
      );
      const body = await res.json();
      const ms = body.milestone;
      expect(typeof ms.id).toBe('string');
      expect(ms.playerId).toBe('player-A');
      expect(ms.validatorId).toBe('validator-B');
      expect(ms.description).toBe('Scored a hat-trick');
      expect(ms.evidence_uri).toBe(cid);
      expect(typeof ms.createdAt).toBe('number');
    });
  });
});
