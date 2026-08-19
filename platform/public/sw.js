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
const STATIC_ASSETS = [
  '/',
  '/login',
  '/patient-portal',
  '/dashboard',
  '/patients',
  '/consultation',
  '/referrals',
  '/lab',
  '/pharmacy',
  '/surveillance',
  '/reports',
  '/hospitals',
  '/government',
  '/appointments',
  '/immunizations',
  '/births',
  '/deaths',
  '/anc',
  '/messages',
  '/settings',
  '/telehealth',
  '/epidemic-intelligence',
  '/data-quality',
  '/vital-statistics',
  '/mch-analytics',
  '/facility-assessments',
];

const ONLINE_REQUIRED_API_PREFIXES = [
  '/api/auth',
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
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch(() => {
        // Some routes may not be available at install time
        return cache.addAll(['/']);
      });
    })
    // Precaching is an optimisation, not a precondition. Letting it reject
    // fails the whole installation, so a single route that 503s mid-deploy
    // would leave the browser with no worker at all.
    .catch(() => { /* no offline shell this time; the app still works online */ })
  );
  self.skipWaiting();
});

// Activate: clean old caches and flush sync queue
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k).catch(() => false)))
      )
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
          // For navigation requests, return cached app shell
          if (request.mode === 'navigate') {
            return matchQuietly('/').then((shell) => shell || new Response('Offline', { status: 503 }));
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
