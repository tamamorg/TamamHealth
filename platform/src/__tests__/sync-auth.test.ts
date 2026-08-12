import {
  buildSyncCanonicalPayload,
  computeSyncSignature,
  isSyncTimestampFresh,
  verifySyncMachineRequest,
} from '@/lib/sync-auth';

const SECRET = 's'.repeat(64);

function signedRequest(options: { method?: string; body?: string; timestamp?: string; nonce?: string } = {}) {
  const method = options.method || 'POST';
  const body = options.body || '{"db":"tamamhealth_patients","changes":[]}';
  const timestamp = options.timestamp || String(Math.floor(Date.now() / 1000));
  const nonce = options.nonce || crypto.randomUUID();
  const signature = computeSyncSignature(SECRET, {
    timestamp,
    nonce,
    method,
    pathname: '/api/sync',
    body,
  });
  const headerValues = new Map<string, string>([
    ['x-tamamhealth-signature', signature],
    ['x-tamamhealth-timestamp', timestamp],
    ['x-tamamhealth-nonce', nonce],
  ]);
  return {
    body,
    request: {
      method,
      url: 'https://app.example.org/api/sync',
      headers: {
        get(name: string) { return headerValues.get(name.toLowerCase()) || null; },
      },
    } as Request,
  };
}

describe('sync machine authentication', () => {
  const savedSecret = process.env.COUCHDB_WEBHOOK_SECRET;
  const savedUpstashUrl = process.env.UPSTASH_REDIS_REST_URL;
  const savedUpstashToken = process.env.UPSTASH_REDIS_REST_TOKEN;
  const savedKvUrl = process.env.KV_REST_API_URL;
  const savedKvToken = process.env.KV_REST_API_TOKEN;

  beforeAll(() => {
    process.env.COUCHDB_WEBHOOK_SECRET = SECRET;
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    delete process.env.KV_REST_API_URL;
    delete process.env.KV_REST_API_TOKEN;
  });

  afterAll(() => {
    if (savedSecret === undefined) delete process.env.COUCHDB_WEBHOOK_SECRET;
    else process.env.COUCHDB_WEBHOOK_SECRET = savedSecret;
    if (savedUpstashUrl === undefined) delete process.env.UPSTASH_REDIS_REST_URL;
    else process.env.UPSTASH_REDIS_REST_URL = savedUpstashUrl;
    if (savedUpstashToken === undefined) delete process.env.UPSTASH_REDIS_REST_TOKEN;
    else process.env.UPSTASH_REDIS_REST_TOKEN = savedUpstashToken;
    if (savedKvUrl === undefined) delete process.env.KV_REST_API_URL;
    else process.env.KV_REST_API_URL = savedKvUrl;
    if (savedKvToken === undefined) delete process.env.KV_REST_API_TOKEN;
    else process.env.KV_REST_API_TOKEN = savedKvToken;
  });

  it('uses an unambiguous canonical payload', () => {
    expect(buildSyncCanonicalPayload({
      timestamp: '1700000000', nonce: 'nonce', method: 'post', pathname: '/api/sync', body: '{}',
    })).toBe('1700000000\nnonce\nPOST\n/api/sync\n{}');
  });

  it('accepts a valid request once and rejects an exact replay', async () => {
    const signed = signedRequest();
    await expect(verifySyncMachineRequest(signed.request, signed.body)).resolves.toMatchObject({ ok: true });
    await expect(verifySyncMachineRequest(signed.request, signed.body)).resolves.toMatchObject({ ok: false, reason: 'replay' });
  });

  it('rejects stale timestamps and tampered bodies', async () => {
    const stale = String(Math.floor(Date.now() / 1000) - 301);
    expect(isSyncTimestampFresh(stale)).toBe(false);
    const signed = signedRequest({ timestamp: stale });
    await expect(verifySyncMachineRequest(signed.request, signed.body)).resolves.toMatchObject({ ok: false, reason: 'invalid' });

    const current = signedRequest();
    await expect(verifySyncMachineRequest(current.request, current.body + ' ')).resolves.toMatchObject({ ok: false, reason: 'invalid' });
  });
});
