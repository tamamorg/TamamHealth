/**
 * Service-worker cache purge on sign-out (security audit 2026-11 L3, client half).
 *
 * `public/sw.js` caches every non-API GET it sees, network-first: page HTML,
 * RSC payloads, and the offline role pack (patient chart routes, whose URLs
 * name patient ids, plus any query string). Those outlive the session on a
 * shared tablet. API JSON is never cached by the worker (network only).
 *
 * KEPT (public, needed to sign in again offline and to boot the app):
 *   - `/_next/static/*` content-hashed JS/CSS chunks, `/assets/*`, `/icons/*`
 *   - `/login` (exactly, no query), `/manifest.json`
 *   - the offline manifest entry, rewritten with no provisioned paths
 * DELETED: everything else - authenticated route HTML/RSC, `?patient=` style
 * URLs, `/`, and any stray cached response.
 *
 * Offline-sign-in risk: the device's offline credential is itself cleared by
 * the same wipe (local-wipe.ts), so after a logout the next offline sign-in is
 * already impossible until the user signs in online once; the role pack is
 * re-prepared from Settings then. Purging route HTML therefore removes no
 * working offline path. A browser that is merely closed (no logout) is not
 * purged, so that shift-change case keeps working.
 *
 * Runs from the page against CacheStorage (shared with the worker); no worker
 * message is needed and it works even when the worker is stopped.
 */

const CACHE_PREFIX = 'tamamhealth-';
const OFFLINE_MANIFEST_PATH = '/__tamamhealth_offline_manifest__';
const KEEP_EXACT = new Set(['/login', '/manifest.json', OFFLINE_MANIFEST_PATH, '/assets/tamam-favicon.svg']);
const KEEP_PREFIXES = ['/_next/static/', '/assets/', '/icons/'];

/** Is a cached request public shell material that must survive sign-out? */
export function isShellRequest(url: string, origin = 'http://localhost'): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url, origin);
  } catch {
    return false;
  }
  if (KEEP_PREFIXES.some(prefix => parsed.pathname.startsWith(prefix))) return true;
  return KEEP_EXACT.has(parsed.pathname) && parsed.search === '';
}

export async function purgeServiceWorkerCaches(): Promise<{ deleted: number }> {
  if (typeof caches === 'undefined') return { deleted: 0 };
  let deleted = 0;
  const names = (await caches.keys()).filter(name => name.startsWith(CACHE_PREFIX));
  for (const name of names) {
    const cache = await caches.open(name);
    for (const request of await cache.keys()) {
      if (isShellRequest(request.url, typeof location !== 'undefined' ? location.origin : undefined)) continue;
      if (await cache.delete(request)) deleted += 1;
    }
    // The pack list named patient chart routes; reset it, keep shell status.
    try {
      const response = await cache.match(OFFLINE_MANIFEST_PATH);
      if (response) {
        const manifest = await response.json() as Record<string, unknown>;
        await cache.put(OFFLINE_MANIFEST_PATH, new Response(JSON.stringify({
          ...manifest, provisionedPaths: [], failedPaths: [],
        }), { headers: { 'Content-Type': 'application/json' } }));
      }
    } catch {
      // An unreadable manifest just reads as "not provisioned".
    }
  }
  return { deleted };
}
