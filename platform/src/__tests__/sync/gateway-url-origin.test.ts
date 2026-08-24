/**
 * The gateway URL must follow the page origin, not the build.
 *
 * One image serves several hostnames (staging and production promote the same
 * digest), and the gateway is same-origin by contract — config-validation
 * refuses any other shape. Production shipped a bundle whose baked URL pointed
 * every client at https://couch.tamamhealth.org directly: 401 on every push,
 * nothing ever synced. Deriving from window.location.origin makes the baked
 * host irrelevant wherever the gateway is on.
 */

import { getCouchDBUrl } from '@/lib/sync/sync-config';

afterEach(() => {
  delete process.env.NEXT_PUBLIC_COUCHDB_GATEWAY_ENABLED;
  delete process.env.NEXT_PUBLIC_COUCHDB_URL;
});

describe('with the gateway enabled (jsdom provides the browser window)', () => {
  it('returns this origin under /api/couch, ignoring the baked URL', () => {
    process.env.NEXT_PUBLIC_COUCHDB_GATEWAY_ENABLED = 'true';
    process.env.NEXT_PUBLIC_COUCHDB_URL = 'https://some-other-host.example/api/couch';
    expect(getCouchDBUrl()).toBe(`${window.location.origin}/api/couch`);
  });
});

describe('without the gateway', () => {
  it('uses the configured URL — direct-CouchDB deployments keep their shape', () => {
    process.env.NEXT_PUBLIC_COUCHDB_URL = 'http://localhost:5984';
    expect(getCouchDBUrl()).toBe('http://localhost:5984');
  });

  it('falls back to the local default when nothing is configured', () => {
    expect(getCouchDBUrl()).toBe('http://localhost:5984');
  });
});
