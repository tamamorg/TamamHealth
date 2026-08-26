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
const STATIC_ASSETS = [
  '/',
  '/login',
  '/manifest.json',
  '/assets/tamam-favicon.svg',
  '/icons/icon-192.svg',
  '/icons/icon-512.svg',
  '/icons/icon-maskable-512.svg',
  '/patient-portal',
  '/dashboard',
  '/patients',
  '/consultation',
  '/referrals',
  '/lab',
  '/pharmacy',
  '/surveillance',
  '/reports',
  '/government',
  '/appointments',
  '/immunizations',
  '/births',
  '/deaths',
  '/anc',
  '/messages',
  '/settings',
  '/epidemic-intelligence',
  '/data-quality',
  '/vital-statistics',
  '/mch-analytics',
  '/facility-assessments',
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
async function precacheUrl(cache, path) {
  try {
    const request = new Request(path, { credentials: 'same-origin' });
    const response = await fetch(request);
    // A protected route may redirect to /login while the worker installs.
    // Never store that login response under the protected route's cache key.
    if (!response.ok || response.redirected) return;

    await cache.put(request, response.clone());

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('text/html')) return;

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

    await Promise.allSettled([...assetPaths].map(async (assetPath) => {
      const assetRequest = new Request(assetPath, { credentials: 'same-origin' });
      const assetResponse = await fetch(assetRequest);
      if (assetResponse.ok && !assetResponse.redirected) {
        await cache.put(assetRequest, assetResponse);
      }
    }));
  } catch {
    // Optional route unavailable during deploy; every other entry still gets
    // its own attempt and an older complete cache remains available.
  }
}

const ONLINE_REQUIRED_API_PREFIXES = [
  '/api/auth',
  // PouchDB already owns the durable local write and retry lifecycle. Queuing
  // its replication protocol a second time here would replay stale CouchDB
  // requests (including old revisions) after SyncManager has already retried
  // them, creating avoidable conflicts and an extra PHI-bearing outbox.
  '/api/couch',
  '/api/users',
  '/api/admin',
  '/api/receipts',
  '/api/payment-link',
  '/api/checkout',
  '/api/patient-portal/login',
];

function isOnlineRequiredApi(pathname) {
  return ONLINE_REQUIRED_API_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

// Background sync queue stored in IndexedDB
const SYNC_DB_NAME = 'tamamhealth-sync-queue';
const SYNC_STORE = 'pending-requests';

function openSyncDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(SYNC_DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(SYNC_STORE)) {
        db.createObjectStore(SYNC_STORE, { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function queueRequest(url, options) {
  try {
    const db = await openSyncDB();
    const tx = db.transaction(SYNC_STORE, 'readwrite');
    tx.objectStore(SYNC_STORE).add({
      url,
      method: options.method || 'POST',
      headers: options.headers || {},
      body: options.body || null,
      idempotencyKey: options.idempotencyKey || null,
      timestamp: Date.now(),
    });
    return new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = reject;
    });
  } catch {
    // IndexedDB not available
  }
}

async function flushSyncQueue() {
  try {
    const db = await openSyncDB();
    const tx = db.transaction(SYNC_STORE, 'readonly');
    const store = tx.objectStore(SYNC_STORE);
    const all = await new Promise((resolve, reject) => {
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });

    for (const entry of all) {
      try {
        const response = await fetch(entry.url, {
          method: entry.method,
          headers: entry.headers,
          body: entry.body,
        });
        if (!response.ok) {
          break;
        }
        // Remove from queue on success
        const delTx = db.transaction(SYNC_STORE, 'readwrite');
        delTx.objectStore(SYNC_STORE).delete(entry.id);
      } catch {
        // Still offline, keep in queue
        break;
      }
    }
  } catch {
    // IndexedDB not available
  }
}

// Install: cache app shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => Promise.allSettled(STATIC_ASSETS.map((path) => precacheUrl(cache, path))))
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
      .then(() => flushSyncQueue())
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

  // For other API POST/PUT/DELETE: try network, queue if offline
  if (request.method !== 'GET') {
    if (url.origin !== self.location.origin || !url.pathname.startsWith('/api/')) {
      return;
    }
    if (url.pathname.startsWith('/api/') && isOnlineRequiredApi(url.pathname)) {
      event.respondWith(
        fetch(request).catch(() => new Response(JSON.stringify({
          offline: true,
          queued: false,
          error: 'This action requires a connection.',
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
    event.respondWith(
      fetch(request).catch(async () => {
        // Queue the request for background sync
        const body = await request.clone().text();
        const idempotencyKey = request.headers.get('X-Idempotency-Key') ||
          (crypto?.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
        await queueRequest(request.url, {
          method: request.method,
          headers: {
            ...Object.fromEntries(request.headers.entries()),
            'X-Idempotency-Key': idempotencyKey,
          },
          body,
          idempotencyKey,
        });
        return new Response(JSON.stringify({ queued: true, offline: true }), {
          status: 202,
          headers: {
            'Content-Type': 'application/json',
            'X-TamamHealth-Offline': 'queued',
            'X-Idempotency-Key': idempotencyKey,
          },
        });
      })
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
            return matchQuietly('/login').then((loginShell) => {
              if (loginShell) return loginShell;
              return matchQuietly('/').then((shell) => shell || new Response('Offline', { status: 503 }));
            });
          }
          return new Response('Offline', { status: 503 });
        });
      })
  );
});

// Listen for online event to flush sync queue
self.addEventListener('message', (event) => {
  if (event.data === 'ONLINE') {
    flushSyncQueue();
  }
});
