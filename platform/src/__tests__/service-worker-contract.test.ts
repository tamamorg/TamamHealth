/**
 * Offline-shell regression contracts.
 *
 * The service worker is deliberately a dependency-free browser script rather
 * than an imported module, so these tests pin the failure modes at the source
 * boundary: one missing route must not make installation atomic, upgrades
 * must retain a fallback build, and API GET responses must not become a
 * second PHI cache.
 */

import fs from 'node:fs';
import path from 'node:path';

const source = fs.readFileSync(path.join(process.cwd(), 'public', 'sw.js'), 'utf8');

describe('service worker offline shell', () => {
  it('precaches entries independently instead of using atomic cache.addAll', () => {
    expect(source).toContain('Promise.allSettled(STATIC_ASSETS.map');
    expect(source).not.toContain('cache.addAll(STATIC_ASSETS)');
  });

  it('keeps a previous application cache during an upgrade', () => {
    expect(source).toContain('MAX_APP_CACHES = 2');
    expect(source).toContain('appCaches.slice(-MAX_APP_CACHES)');
  });

  it('uses the local database rather than CacheStorage for offline API reads', () => {
    expect(source).toContain("request.method === 'GET' && url.pathname.startsWith('/api/')");
    expect(source).toContain("'X-TamamHealth-Offline': 'network-only'");
  });

  it('does not duplicate PouchDB replication writes in the generic request queue', () => {
    expect(source).toMatch(/ONLINE_REQUIRED_API_PREFIXES[\s\S]*'\/api\/couch'/);
  });

  it('has a cached offline sign-in entry point', () => {
    expect(source).toContain("'/login'");
    expect(source).toContain("matchQuietly('/login')");
  });
});
