/**
 * The combinations that stop replication dead must be said out loud.
 *
 * Each of these leaves the app looking healthy — every screen reads the
 * browser's own PouchDB — while the server receives nothing at all.
 */
import { syncConfigProblems } from '@/lib/config-validation';

const GOOD = {
  NEXT_PUBLIC_SYNC_ENABLED: 'true',
  NEXT_PUBLIC_COUCHDB_GATEWAY_ENABLED: 'true',
  NEXT_PUBLIC_COUCHDB_TENANT_DATABASES_ENABLED: 'true',
  COUCHDB_GATEWAY_SECRET: 'x'.repeat(48),
};

describe('syncConfigProblems', () => {
  it('is quiet when the gateway is configured end to end', () => {
    expect(syncConfigProblems(GOOD)).toEqual([]);
  });

  it('is quiet when replication is deliberately switched off', () => {
    expect(syncConfigProblems({ ...GOOD, NEXT_PUBLIC_SYNC_ENABLED: 'false', COUCHDB_GATEWAY_SECRET: '' })).toEqual([]);
  });

  it('is quiet when the gateway itself is off', () => {
    expect(syncConfigProblems({
      NEXT_PUBLIC_SYNC_ENABLED: 'true',
      NEXT_PUBLIC_COUCHDB_GATEWAY_ENABLED: 'false',
    })).toEqual([]);
  });

  it('names the tenant-database mismatch, which 403s every clinical database', () => {
    const problems = syncConfigProblems({ ...GOOD, NEXT_PUBLIC_COUCHDB_TENANT_DATABASES_ENABLED: undefined });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/403/);
    expect(problems[0]).toMatch(/db:migrate:couchdb-tenants/);
  });

  it('names the missing gateway secret, which 502s every proxied request', () => {
    const problems = syncConfigProblems({ ...GOOD, COUCHDB_GATEWAY_SECRET: '' });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/502/);
    // A short secret is as broken as none at all.
    expect(syncConfigProblems({ ...GOOD, COUCHDB_GATEWAY_SECRET: 'too-short' })).toHaveLength(1);
  });

  it('reports both when both are wrong', () => {
    expect(syncConfigProblems({
      NEXT_PUBLIC_SYNC_ENABLED: 'true',
      NEXT_PUBLIC_COUCHDB_GATEWAY_ENABLED: 'true',
    })).toHaveLength(2);
  });
});
