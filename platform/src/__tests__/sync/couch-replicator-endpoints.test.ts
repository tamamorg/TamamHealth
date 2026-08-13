/**
 * Regression guard for CouchDB 3's `local_endpoints_not_supported`.
 *
 * Persisted `_replicator` documents must name absolute endpoints. Bare database
 * names are accepted by the one-shot `/_replicate` API but rejected with HTTP
 * 403 when stored in `_replicator`, so the failure surfaces only after a tenant
 * database has already been created, secured, and populated — the worst place
 * to discover it. `tenant-database.ts` deliberately deals in topology names, so
 * the resolution to URLs happens here, on the way out.
 */

const ORIGINAL_ENV = { ...process.env };

describe('_replicator endpoint resolution', () => {
  let requests: Array<{ method: string; url: string; body: unknown }>;

  beforeEach(() => {
    jest.resetModules();
    requests = [];

    process.env.COUCHDB_URL = 'http://10.114.0.3:5984';
    process.env.COUCHDB_ADMIN_USER = 'couchadmin';
    process.env.COUCHDB_ADMIN_PASSWORD = 'a-real-looking-admin-password';
    delete process.env.COUCHDB_REPLICATION_URL;

    const reply = (status: number, body: unknown) => ({
      status,
      ok: status >= 200 && status < 300,
      json: async () => body,
      text: async () => JSON.stringify(body),
    });

    global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method || 'GET';
      requests.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      // Everything is "not yet there", so each ensure* helper takes its create path.
      if (method === 'GET') return reply(404, {});
      return reply(201, { ok: true });
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  async function replicatorWrites() {
    const { provisionOrganizationDatabases } = await import('@/lib/sync/couch-auth');
    await provisionOrganizationDatabases('org-juba-teaching');
    return requests.filter(r => r.method === 'PUT' && r.url.includes('/_replicator/'));
  }

  it('stores absolute URLs rather than bare database names', async () => {
    const writes = await replicatorWrites();
    expect(writes.length).toBeGreaterThan(0);

    for (const write of writes) {
      const doc = write.body as { source: unknown; target: unknown };
      for (const endpoint of [doc.source, doc.target]) {
        // A bare name like "tamamhealth_patients" is exactly what CouchDB 3 rejects.
        expect(typeof endpoint).not.toBe('string');
        expect(endpoint).toMatchObject({ url: expect.stringMatching(/^https?:\/\/.+\/tamamhealth_/) });
      }
    }
  });

  it('defaults to the CouchDB node loopback, not the VPC address it is served on', async () => {
    const writes = await replicatorWrites();
    const urls = writes.flatMap(w => {
      const doc = w.body as { source: { url: string }; target: { url: string } };
      return [doc.source.url, doc.target.url];
    });

    // COUCHDB_URL is the address *clients* use to reach the droplet. The
    // replicator dials from inside CouchDB itself, so reusing it would hairpin
    // out of the container and back in.
    expect(urls.every(u => u.startsWith('http://127.0.0.1:5984/'))).toBe(true);
    expect(urls.some(u => u.includes('10.114.0.3'))).toBe(false);
  });

  it('honours COUCHDB_REPLICATION_URL when CouchDB cannot reach itself on loopback', async () => {
    process.env.COUCHDB_REPLICATION_URL = 'http://couchdb.internal:5984/';
    const writes = await replicatorWrites();
    const doc = writes[0].body as { source: { url: string } };
    expect(doc.source.url).toMatch(/^http:\/\/couchdb\.internal:5984\/tamamhealth_/);
  });

  it('carries credentials in auth.basic and never inside the URL', async () => {
    const writes = await replicatorWrites();

    for (const write of writes) {
      const doc = write.body as {
        source: { url: string; auth: { basic: { username: string; password: string } } };
        target: { url: string; auth: { basic: { username: string; password: string } } };
      };
      for (const endpoint of [doc.source, doc.target]) {
        expect(endpoint.auth.basic).toEqual({
          username: 'couchadmin',
          password: 'a-real-looking-admin-password',
        });
        // Embedded credentials corrupt on special characters and are echoed
        // verbatim into CouchDB's replication logs.
        expect(endpoint.url).not.toContain('@');
        expect(endpoint.url).not.toContain('a-real-looking-admin-password');
      }
    }
  });
});
