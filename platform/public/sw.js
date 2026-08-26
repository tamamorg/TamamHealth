// CACHE_NAME is versioned per deploy. The registering page passes the
// current build id as ?v=<BUILD_ID>, which we read off the SW's own URL.
// Falls back to a static tag if the query is missing (e.g. direct navigation).
const BUILD_VERSION = (() => {
  try {
    return new URL(self.location.href).searchParams.get('v') || 'static';
  } catch {
    return 'static';
  }
})();
const CACHE_NAME = `tamamhealth-${BUILD_VERSION}`;
const CACHE_PREFIX = 'tamamhealth-';
const MAX_APP_CACHES = 2;
const OFFLINE_MANIFEST_URL = '/__tamamhealth_offline_manifest__';
// Installation must stay tiny. Role routes and patient workspaces are prepared
// explicitly from Settings after sign-in; fetching them here competes with the
// visible login screen and, for protected routes, only downloads redirects.
const STATIC_ASSETS = [
  '/login',
  '/manifest.json',
  '/assets/tamam-favicon.svg',
  '/icons/icon-192.svg',
  '/icons/icon-512.svg',
  '/icons/icon-maskable-512.svg',
];

/**
 * Cache one URL without allowing a missing/redirecting optional route to
 * abort installation of the whole offline shell.
 *
 * Next.js route HTML names the content-hashed JS and CSS needed to hydrate
 * that route. Fetch those assets too: registering the worker happens after
 * the current page has already loaded, so relying only on the runtime fetch
 * handler leaves a first-time installation with HTML but no executable app.
 */
async function precacheUrl(cache, path, assetPromises = new Map()) {
  try {
    const request = new Request(path, { credentials: 'same-origin' });
    const response = await fetch(request);
    // A protected route may redirect to /login while the worker installs.
    // Never store that login response under the protected route's cache key.
    if (!response.ok || response.redirected) {
      return { path, cached: false, executable: false };
    }

    await cache.put(request, response.clone());

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('text/html')) {
      return { path, cached: true, executable: true };
    }

    const html = await response.text();
    const assetPaths = new Set();
    const attributePattern = /(?:src|href)=["']([^"']+)["']/g;
    for (const match of html.matchAll(attributePattern)) {
      try {
        const assetUrl = new URL(match[1], self.location.origin);
        if (assetUrl.origin !== self.location.origin) continue;
        if (
          assetUrl.pathname.startsWith('/_next/static/') ||
          assetUrl.pathname.startsWith('/assets/') ||
          assetUrl.pathname.startsWith('/icons/')
        ) {
          assetPaths.add(`${assetUrl.pathname}${assetUrl.search}`);
        }
      } catch {
        // Ignore malformed or non-URL attributes.
      }
    }

    // Most Next.js routes reference the same runtime chunks. An offline pack
    // can contain hundreds of patient paths; without this shared promise map
    // every page re-fetched and re-wrote the same chunks into CacheStorage.
    const assetResults = await Promise.all([...assetPaths].map((assetPath) => {
      let pending = assetPromises.get(assetPath);
      if (!pending) {
        pending = (async () => {
          try {
            const assetRequest = new Request(assetPath, { credentials: 'same-origin' });
            const cached = await cache.match(assetRequest);
            if (cached) return true;
            const assetResponse = await fetch(assetRequest);
            if (!assetResponse.ok || assetResponse.redirected) return false;
            await cache.put(assetRequest, assetResponse);
            return true;
          } catch {
            return false;
          }
        })();
        assetPromises.set(assetPath, pending);
      }
      return pending;
    }));
    return {
      path,
      cached: true,
      // HTML without every referenced executable asset is not an offline app.
      executable: assetPaths.size > 0 && assetResults.every(Boolean),
    };
  } catch {
    // Optional route unavailable during deploy; every other entry still gets
    // its own attempt and an older complete cache remains available.
    return { path, cached: false, executable: false };
  }
}

async function readOfflineManifest(cache) {
  try {
    const response = await cache.match(OFFLINE_MANIFEST_URL);
    return response ? await response.json() : null;
  } catch {
    return null;
  }
}

async function writeOfflineManifest(cache, value) {
  await cache.put(OFFLINE_MANIFEST_URL, new Response(JSON.stringify({
    buildVersion: BUILD_VERSION,
    checkedAt: new Date().toISOString(),
    ...value,
  }), { headers: { 'Content-Type': 'application/json' } }));
}

async function precachePaths(cache, paths, concurrency = 6) {
  const results = [];
  const assetPromises = new Map();
  for (let index = 0; index < paths.length; index += concurrency) {
    results.push(...await Promise.all(
      paths.slice(index, index + concurrency).map(path => precacheUrl(cache, path, assetPromises))
    ));
  }
  return results;
}

// Install: cache app shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(async (cache) => {
        const results = await precachePaths(cache, STATIC_ASSETS);
        const login = results.find(result => result.path === '/login');
        await writeOfflineManifest(cache, {
          shellReady: Boolean(login?.cached && login?.executable),
          provisionedPaths: [],
          failedPaths: login?.cached && login?.executable ? [] : ['/login'],
        });
      })
    // Precaching is an optimisation, not a precondition. A previously loaded
    // build can still be used and runtime caching can fill this cache later.
    .catch(() => { /* no offline shell this time; the app still works online */ })
  );
  self.skipWaiting();
});

// Activate: keep the current cache plus one known-good previous deployment.
// Deleting every old cache immediately used to turn a partial install during
// a flaky deploy into a device with no working offline build at all. Cache
// storage preserves key creation order, so the final two are the newest two.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => {
        const appCaches = keys.filter((key) => key.startsWith(CACHE_PREFIX));
        const keep = new Set([...appCaches.slice(-MAX_APP_CACHES), CACHE_NAME]);
        return Promise.all(
          appCaches
            .filter((key) => !keep.has(key))
            .map((key) => caches.delete(key).catch(() => false))
        );
      })
      .catch(() => [])
  );
  self.clients.claim();
});

// Fetch handler
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-HTTP requests
  if (!request.url.startsWith('http')) return;

  // For API auth routes: network only (don't cache auth responses)
  if (url.pathname.startsWith('/api/auth')) {
    return;
  }

  // IndexedDB/PouchDB is the offline clinical datastore. Caching arbitrary
  // GET API responses here duplicates PHI outside that scoped store, can show
  // one user's cached response to the next user of a shared tablet, and makes
  // stale server data look authoritative. API reads therefore remain network
  // only and callers use their explicit local-replica fallback.
  if (request.method === 'GET' && url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request).catch(() => new Response(JSON.stringify({
        offline: true,
        error: 'This server request is unavailable offline.',
      }), {
        status: 503,
        headers: {
          'Content-Type': 'application/json',
          'X-TamamHealth-Offline': 'network-only',
        },
      }))
    );
    return;
  }

  // UI clinical writes belong in PouchDB and replicate from there. A generic
  // service-worker outbox cannot enforce domain validation, user ownership or
  // conflict policy, so every API mutation is explicitly online-only.
  if (request.method !== 'GET') {
    if (url.origin !== self.location.origin || !url.pathname.startsWith('/api/')) {
      return;
    }
    event.respondWith(
      fetch(request).catch(() => new Response(JSON.stringify({
        offline: true,
        queued: false,
        error: 'This server action requires a connection.',
      }), {
          status: 503,
          headers: {
            'Content-Type': 'application/json',
            'X-TamamHealth-Offline': 'required-online',
          },
        }))
    );
    return;
  }

  // Writing to the cache is best-effort and must never affect the response.
  //
  // `activate` deletes the previous deploy's cache, so a request in flight
  // during that window can be putting into a cache that no longer exists. As a
  // bare `.then()` that rejection was unhandled; worse, any rejection inside a
  // promise passed to `respondWith` becomes a NETWORK ERROR for the request —
  // which for a script tag is indistinguishable from the asset being missing,
  // and is exactly what BootIntegrityGuard reloads the page over. A cache miss
  // must degrade to "fetch it from the network", never to "this asset failed".
  const cacheQuietly = (req, response) => {
    if (response.status !== 200) return;
    const clone = response.clone();
    caches.open(CACHE_NAME)
      .then((cache) => cache.put(req, clone))
      .catch(() => { /* cache evicted or storage full — the response still stands */ });
  };
  const matchQuietly = (req) => caches.match(req).catch(() => undefined);

  // For Next.js static assets: cache-first (they have content hashes)
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(
      matchQuietly(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          cacheQuietly(request, response);
          return response;
        });
      })
    );
    return;
  }

  // For everything else: network first, fallback to cache
  event.respondWith(
    fetch(request)
      .then((response) => {
        cacheQuietly(request, response);
        return response;
      })
      .catch(() => {
        return matchQuietly(request).then((cached) => {
          if (cached) return cached;
          // For navigation requests, return the cached sign-in shell first.
          // It can verify the device credential locally; the public landing
          // page cannot open an authenticated offline session.
          if (request.mode === 'navigate') {
            return matchQuietly(url.pathname).then((routeShell) => {
              if (routeShell) return routeShell;
              return matchQuietly('/login').then((loginShell) => {
                if (loginShell) return loginShell;
                return matchQuietly('/').then((shell) => shell || new Response('Offline', { status: 503 }));
              });
            });
          }
          return new Response('Offline', { status: 503 });
        });
      })
  );
});

// Provision the signed-in role's offline application pack. The page supplies
// only same-origin route paths; the worker fetches them with the current
// server session and records an atomic, build-specific result for Settings.
self.addEventListener('message', (event) => {
  if (event.data?.type !== 'PREPARE_OFFLINE') return;
  const reply = event.ports?.[0];
  const paths = [...new Set(Array.isArray(event.data.paths) ? event.data.paths : [])]
    // Role packs may include hundreds of patient workspaces. Keep a hard
    // ceiling against abusive messages while allowing the configured maximum
    // (2,000 patient charts plus role routes) to be prepared deliberately.
    .slice(0, 2500)
    .flatMap(path => {
      if (typeof path !== 'string' || path.length > 512) return [];
      try {
        const url = new URL(path, self.location.origin);
        if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return [];
        return [`${url.pathname}${url.search}`];
      } catch {
        return [];
      }
    });
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    const previous = await readOfflineManifest(cache);
    const results = await precachePaths(cache, paths);
    const successful = results.filter(result => result.cached && result.executable).map(result => result.path);
    const failed = results.filter(result => !result.cached || !result.executable).map(result => result.path);
    const provisionedPaths = [...new Set([...(previous?.provisionedPaths || []), ...successful])];
    await writeOfflineManifest(cache, {
      shellReady: previous?.shellReady === true,
      provisionedPaths,
      failedPaths: failed,
    });
    reply?.postMessage({
      type: 'OFFLINE_PACK_RESULT',
      ok: failed.length === 0,
      provisionedPaths,
      failedPaths: failed,
      buildVersion: BUILD_VERSION,
    });
  })().catch(() => {
    reply?.postMessage({ type: 'OFFLINE_PACK_RESULT', ok: false, provisionedPaths: [], failedPaths: paths });
  }));
});
