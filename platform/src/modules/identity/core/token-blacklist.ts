/**
 * Token revocation store — server-side.
 *
 * When a user logs out (or their session is force-revoked) we add the
 * session JWT to this store. Every authenticated request — both the page
 * middleware and the /api/auth/me bootstrap — consults the store before
 * trusting a presented token, so a logged-out session can't be replayed
 * even while the JWT itself is still inside its 8-hour `exp` window.
 *
 * Design choices:
 *
 *   - Keyed by the full JWT string (not the jti) so we don't have to
 *     re-issue every existing token to add a jti claim. Forged tokens
 *     never reach this layer because verifyToken() checks the HMAC first.
 *   - Stores the JWT's `exp` (unix seconds) alongside each entry. Entries
 *     past their exp are evicted lazily on every read and proactively on
 *     a 60-second sweep — once a token is expired it can't be replayed
 *     anyway, so keeping it in the blacklist is wasted memory.
 *   - Persisted to a gitignored JSON file on every write so a server
 *     restart doesn't reset the revocation list. The path is configurable
 *     via TOKEN_BLACKLIST_FILE for tests and tuning.
 *   - Single-process today; the persistence layer is small enough that
 *     swapping to Redis (per the rate-limiting ticket) means replacing
 *     this one file, not touching every caller.
 *
 * OPERATIONAL CONSTRAINT — the store is per-instance. The file lives on one
 * container's filesystem, so with more than one platform replica a logout
 * recorded on replica A is invisible to replica B, and the revoked token keeps
 * working there until its `exp` passes. Rate limiting already moved to shared
 * Upstash Redis for exactly this reason; this store has not. Until it does,
 * the platform must run as a SINGLE replica in production — or every replica
 * must share the TOKEN_BLACKLIST_FILE path on a shared volume. We warn once at
 * first use in production rather than failing closed, because refusing to boot
 * would take down a correctly-configured single-replica deploy too.
 *
 * NOT a replacement for short JWT lifetimes — it complements them.
 */

import { captureException } from '@/lib/observability';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { getUpstashConfig, upstashPipeline, withRetry, hashKey } from '@/lib/upstash';
import { SESSION_TTL_SEC } from '@/modules/identity/core/session';

interface RevocationEntry {
  /** Unix epoch *seconds* when the JWT itself expires. */
  expSec: number;
}

const SWEEP_INTERVAL_MS = 60_000;
const PERSIST_DEBOUNCE_MS = 250;

let store: Map<string, RevocationEntry> | null = null;
let loadPromise: Promise<void> | null = null;
let persistTimer: NodeJS.Timeout | null = null;
let sweepTimer: NodeJS.Timeout | null = null;

function filePath(): string {
  const override = process.env.TOKEN_BLACKLIST_FILE;
  if (override) return path.resolve(override);
  return path.resolve(process.cwd(), '.token-blacklist.json');
}

let singleInstanceWarned = false;

/**
 * Warn once, in production only, that revocation state is per-instance.
 * Mirrors the in-process warning `rate-limit.ts` emits when it falls back off
 * shared Redis — a silent per-instance security store is the failure mode we
 * are trying not to repeat.
 */
function maybeWarnSingleInstance(): void {
  if (singleInstanceWarned) return;
  singleInstanceWarned = true;
  if (process.env.NODE_ENV !== 'production') return;
  console.warn(
    '[token-blacklist] Revocation state is stored per-instance at ' +
      `${filePath()}. This deploy MUST run a single platform replica, or all ` +
      'replicas must share TOKEN_BLACKLIST_FILE on a shared volume — ' +
      'otherwise a logged-out token stays valid on the other replicas until it expires.',
  );
}

async function loadFromDisk(): Promise<Map<string, RevocationEntry>> {
  try {
    const raw = await fs.readFile(/* turbopackIgnore: true */ filePath(), 'utf8');
    const json = raw.replace(/^\s*#[^\n]*\n/, '');
    const parsed = JSON.parse(json) as Record<string, RevocationEntry>;
    const m = new Map<string, RevocationEntry>();
    const nowSec = Math.floor(Date.now() / 1000);
    for (const [token, entry] of Object.entries(parsed)) {
      if (!entry || typeof entry.expSec !== 'number') continue;
      if (entry.expSec <= nowSec) continue; // already expired — skip
      m.set(token, entry);
    }
    return m;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return new Map();
    console.warn('[token-blacklist] failed to load persisted entries; starting empty.', err);
    return new Map();
  }
}

async function ensureLoaded(): Promise<void> {
  if (store) return;
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    maybeWarnSingleInstance();
    store = await loadFromDisk();
    if (!sweepTimer) {
      sweepTimer = setInterval(sweep, SWEEP_INTERVAL_MS);
      sweepTimer.unref?.();
    }
  })();
  return loadPromise;
}

function schedulePersist(): void {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(persistNow, PERSIST_DEBOUNCE_MS);
  persistTimer.unref?.();
}

async function persistNow(): Promise<void> {
  if (!store) return;
  try {
    const obj: Record<string, RevocationEntry> = {};
    for (const [t, e] of store.entries()) obj[t] = e;
    const body =
      '# TamamHealth token blacklist — gitignored, do not commit.\n' +
      JSON.stringify(obj) +
      '\n';
    await fs.writeFile(filePath(), body, { mode: 0o600 });
  } catch (err) {
    console.error('[token-blacklist] failed to persist:', err);
    captureException(err, { tag: '[token-blacklist] failed to persist:' });
  }
}

function sweep(): void {
  if (!store) return;
  const nowSec = Math.floor(Date.now() / 1000);
  let dropped = 0;
  for (const [t, e] of store.entries()) {
    if (e.expSec <= nowSec) {
      store.delete(t);
      dropped++;
    }
  }
  if (dropped > 0) schedulePersist();
}

/**
 * Best-effort extraction of the JWT `exp` claim. Doesn't verify the signature
 * — by the time we revoke a token we have already verified it (login or the
 * caller's own verifyToken). If the JWT is malformed, fall back to "now + one
 * full session TTL" so the entry still has an upper bound on its lifetime.
 */
function readExpFromJwt(token: string): number {
  const fallback = Math.floor(Date.now() / 1000) + SESSION_TTL_SEC;
  const parts = token.split('.');
  if (parts.length !== 3) return fallback;
  try {
    // Accept both base64 and base64url; pad as needed.
    const payloadB64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = payloadB64 + '='.repeat((4 - (payloadB64.length % 4)) % 4);
    const payload = JSON.parse(
      Buffer.from(padded, 'base64').toString('utf8'),
    ) as { exp?: number };
    if (typeof payload.exp === 'number' && payload.exp > 0) return payload.exp;
  } catch {
    /* fall through */
  }
  return fallback;
}

// ---------------------------------------------------------------------------
// Shared (Upstash) backend — KAN-34
// ---------------------------------------------------------------------------
//
// The token is HASHED before it becomes a Redis key. Storing raw JWTs in Redis
// would turn the revocation list into a credential store: anyone who could read
// it would hold a set of still-valid session tokens, since a revoked JWT stays
// cryptographically valid until its `exp`. The hash is enough to answer "is
// this exact token revoked?" without ever holding the token itself.
//
// Redis TTL does the eviction: the key expires exactly when the JWT does, so
// there is no sweep to run and no unbounded growth.

const REVOKED_PREFIX = 'revoked:';

async function upstashRevoke(token: string, expSec: number): Promise<void> {
  const cfg = getUpstashConfig();
  if (!cfg) throw new Error('upstash not configured');
  const ttlSec = Math.max(1, expSec - Math.floor(Date.now() / 1000));
  const key = REVOKED_PREFIX + (await hashKey(token, 'tamam-revoked'));
  await withRetry(() => upstashPipeline(cfg, [['SET', key, '1', 'EX', ttlSec]]), 'token-blacklist');
}

async function upstashIsRevoked(token: string): Promise<boolean> {
  const cfg = getUpstashConfig();
  if (!cfg) throw new Error('upstash not configured');
  const key = REVOKED_PREFIX + (await hashKey(token, 'tamam-revoked'));
  const res = await withRetry(() => upstashPipeline(cfg, [['GET', key]]), 'token-blacklist');
  return res[0]?.result != null;
}

/**
 * Mark a token as revoked. The store is durable across server restarts —
 * once added, the token cannot be replayed until its `exp` passes.
 *
 * Writes to BOTH backends when Upstash is configured. The local file is kept as
 * a warm fallback so a later Upstash outage degrades to "revocations this
 * replica recorded" rather than to "nothing is revoked".
 */
export async function revokeToken(token: string): Promise<void> {
  if (!token) return;
  const expSec = readExpFromJwt(token);

  if (getUpstashConfig()) {
    try {
      await upstashRevoke(token, expSec);
    } catch (err) {
      // Do not swallow: a failed revocation means logout did not actually
      // invalidate the session. The local write below still happens, so this
      // replica is protected, but the operator needs to see it.
      console.error('[token-blacklist] shared revocation failed — token is revoked on THIS replica only:', err);
      captureException(err, { tag: '[token-blacklist] shared revocation failed — token is revoked on THIS replica only:' });
    }
  }

  await ensureLoaded();
  store!.set(token, { expSec });
  schedulePersist();
}

/**
 * True if the token has been revoked AND has not yet expired. Lazy-evicts
 * an entry that has aged past its `exp`.
 *
 * Checks the shared store first so a logout on any replica is honoured here.
 * On an Upstash failure it falls through to the local file rather than
 * returning false — answering "not revoked" because the network hiccuped would
 * hand a valid session back to a logged-out token.
 */
export async function isTokenRevoked(token: string): Promise<boolean> {
  if (!token) return false;

  if (getUpstashConfig()) {
    try {
      if (await upstashIsRevoked(token)) return true;
    } catch (err) {
      console.error('[token-blacklist] shared lookup failed — falling back to local store:', err);
      captureException(err, { tag: '[token-blacklist] shared lookup failed — falling back to local store:' });
    }
  }

  await ensureLoaded();
  const entry = store!.get(token);
  if (!entry) return false;
  const nowSec = Math.floor(Date.now() / 1000);
  if (entry.expSec <= nowSec) {
    store!.delete(token);
    schedulePersist();
    return false;
  }
  return true;
}

/**
 * Test-only helper. Resets the in-memory cache so the next call reloads
 * from disk (or, with TOKEN_BLACKLIST_FILE pointed at a tmp file, gives
 * each test an isolated store).
 */
export function _resetTokenBlacklistForTest(): void {
  store = null;
  loadPromise = null;
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  if (sweepTimer) {
    clearInterval(sweepTimer);
    sweepTimer = null;
  }
}

/** Test-only helper. Force-flush the debounced persist queue. */
export async function _flushTokenBlacklistForTest(): Promise<void> {
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  await persistNow();
}
