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
    expect(source).toContain('precachePaths(cache, STATIC_ASSETS)');
    expect(source).toContain('return { path, cached: false, executable: false }');
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

  it('never reports an API mutation as queued by a generic worker outbox', () => {
    expect(source).not.toContain('queueRequest(');
    expect(source).not.toContain('pending-requests');
    expect(source).toContain('queued: false');
    expect(source).toContain("'X-TamamHealth-Offline': 'required-online'");
  });

  it('has a cached offline sign-in entry point', () => {
    expect(source).toContain("'/login'");
    expect(source).toContain("matchQuietly('/login')");
  });

  it('records readiness only in the current build cache after executable assets succeed', () => {
    expect(source).toContain("OFFLINE_MANIFEST_URL = '/__tamamhealth_offline_manifest__'");
    expect(source).toContain('buildVersion: BUILD_VERSION');
    expect(source).toContain('login?.cached && login?.executable');
  });

  it('supports explicit role-workspace provisioning', () => {
    expect(source).toContain("event.data?.type !== 'PREPARE_OFFLINE'");
    expect(source).toContain("type: 'OFFLINE_PACK_RESULT'");
    expect(source).toContain('provisionedPaths');
    expect(source).toContain('url.origin !== self.location.origin');
    expect(source).toContain('.slice(0, 2500)');
  });

  it('keeps install-time work to the login shell and deduplicates shared chunks', () => {
    const staticAssets = source.match(/const STATIC_ASSETS = \[([\s\S]*?)\n\];/)?.[1] ?? '';
    expect(staticAssets).toContain("'/login'");
    expect(staticAssets).not.toContain("'/dashboard'");
    expect(staticAssets).not.toContain("'/patients'");
    expect(source).toContain('const assetPromises = new Map()');
    expect(source).toContain('await cache.match(assetRequest)');
  });
});
