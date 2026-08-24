/**
 * The gateway's self-healing tenant provisioning.
 *
 * The production failure it closes: organizations created while the server ran
 * with tenant databases disabled exist without a single tenant database, and
 * the gateway (correctly) refuses to let a browser create databases — so every
 * push from those tenants 404s forever. `ensureOrganizationProvisioned` runs on
 * the serving path, so the guarantees under test are as much about what it
 * DOESN'T do (fetch storms, throws that 502 the gateway) as what it does.
 */

import {
  ensureOrganizationProvisioned,
} from '@/lib/sync/couch-auth';
import { DATABASE_SYNC_CONFIGS } from '@/lib/sync/sync-config';

const ORG_SCOPED_COUNT = DATABASE_SYNC_CONFIGS.filter(c => c.orgScoped).length;

type Call = { method: string; url: string; body?: unknown };
let calls: Call[];
let sentinelResponse: { status: number; body: unknown };

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

beforeEach(() => {
  calls = [];
  sentinelResponse = { status: 404, body: {} };
  process.env.NEXT_PUBLIC_COUCHDB_TENANT_DATABASES_ENABLED = 'true';
  process.env.COUCHDB_URL = 'http://couch.test:5984';
  process.env.COUCHDB_ADMIN_USER = 'admin-test';
  process.env.COUCHDB_ADMIN_PASSWORD = 'admin-test-password';
  global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method || 'GET').toUpperCase();
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ method, url, body });
    if (method === 'GET' && url.includes('/_local/tamamhealth-provisioning')) {
      return jsonResponse(sentinelResponse.status, sentinelResponse.body);
    }
    if (method === 'GET') return jsonResponse(404, {});
    return jsonResponse(201, { ok: true });
  }) as unknown as typeof fetch;
});

afterEach(() => {
  // Jest workers share process.env across suite files — leave nothing behind.
  delete process.env.NEXT_PUBLIC_COUCHDB_TENANT_DATABASES_ENABLED;
  delete process.env.COUCHDB_URL;
  delete process.env.COUCHDB_ADMIN_USER;
  delete process.env.COUCHDB_ADMIN_PASSWORD;
});

describe('the cheap paths make no network calls at all', () => {
  it('skips without an orgId (super admins, platform operators)', async () => {
    await ensureOrganizationProvisioned(undefined);
    await ensureOrganizationProvisioned('');
    expect(calls).toHaveLength(0);
  });

  it('skips when tenant databases are disabled', async () => {
    process.env.NEXT_PUBLIC_COUCHDB_TENANT_DATABASES_ENABLED = 'false';
    await ensureOrganizationProvisioned('org-disabled-mode');
    expect(calls).toHaveLength(0);
  });

  it('skips a malformed org id instead of throwing — a bad token must not 502 the gateway', async () => {
    await expect(ensureOrganizationProvisioned('Robert"; DROP')).resolves.toBeUndefined();
    expect(calls).toHaveLength(0);
  });
});

describe('a provisioned organization', () => {
  it('costs one sentinel read, then the memo makes repeats free', async () => {
    sentinelResponse = { status: 200, body: { _rev: '1-a', databaseCount: ORG_SCOPED_COUNT } };
    await ensureOrganizationProvisioned('org-already-done');
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe('GET');

    await ensureOrganizationProvisioned('org-already-done');
    expect(calls).toHaveLength(1);
  });
});

describe('an unprovisioned organization', () => {
  it('creates every org-scoped database, then records the sentinel', async () => {
    await ensureOrganizationProvisioned('org-healed-tenant');

    // Top-level paths only — _replicator doc ids also end in the org name.
    const dbCreates = calls.filter(c => {
      const path = new URL(c.url).pathname.slice(1);
      return c.method === 'PUT' && !path.includes('/') && path.endsWith('--org-healed-tenant');
    });
    expect(dbCreates).toHaveLength(ORG_SCOPED_COUNT);

    const security = calls.filter(c => c.method === 'PUT' && c.url.endsWith('/_security'));
    // Every tenant database gets _security, and every shared browser database
    // gains this org's member role.
    expect(security.length).toBeGreaterThanOrEqual(ORG_SCOPED_COUNT);

    const sentinelWrite = calls.find(c =>
      c.method === 'PUT' && c.url.includes('/_local/tamamhealth-provisioning'));
    expect(sentinelWrite?.body).toMatchObject({ databaseCount: ORG_SCOPED_COUNT });
  });

  it('re-provisions when the sync map has grown past the recorded count', async () => {
    sentinelResponse = { status: 200, body: { _rev: '3-c', databaseCount: ORG_SCOPED_COUNT - 2 } };
    await ensureOrganizationProvisioned('org-grown-map');
    const dbCreates = calls.filter(c => {
      const path = new URL(c.url).pathname.slice(1);
      return c.method === 'PUT' && !path.includes('/') && path.endsWith('--org-grown-map');
    });
    expect(dbCreates).toHaveLength(ORG_SCOPED_COUNT);
    const sentinelWrite = calls.find(c =>
      c.method === 'PUT' && c.url.includes('/_local/tamamhealth-provisioning'));
    expect(sentinelWrite?.body).toMatchObject({ _rev: '3-c', databaseCount: ORG_SCOPED_COUNT });
  });
});
