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
 * must share the TOKEN_BLACKLIST_FILE path on a shared volume.
 *
 * DURABILITY — the default path (`.token-blacklist.json` in the working
 * directory) is inside the container image and is erased by every restart and
 * redeploy, after which each logged-out token works again until its `exp`.
 * lib/config-validation.ts therefore refuses to boot in production unless
 * Upstash is configured or TOKEN_BLACKLIST_FILE names a path on a mounted
 * volume. (We still warn at first use: the multi-replica caveat is not
 * something a single process can detect.)
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
  /** User-wide entries only: every token ISSUED at or before this instant
   *  (unix seconds) is revoked. Later sign-ins are unaffected. */
  issuedBefore?: number;
}

// Store keys. A JWT always contains dots, so neither prefix can collide with a
// token key. `sid:` revokes one whole sign-in (every renewal of it); `usr:`
// revokes every session a user held up to a cutoff ("sign out everywhere").
const SID_PREFIX = 'sid:';
const USER_PREFIX = 'usr:';

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
    await fs.mkdir(path.dirname(filePath()), { recursive: true });
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

async function upstashRevoke(storeKey: string, expSec: number, value = '1'): Promise<void> {
  const cfg = getUpstashConfig();
  if (!cfg) throw new Error('upstash not configured');
  const ttlSec = Math.max(1, expSec - Math.floor(Date.now() / 1000));
  const key = REVOKED_PREFIX + (await hashKey(storeKey, 'tamam-revoked'));
  await withRetry(() => upstashPipeline(cfg, [['SET', key, value, 'EX', ttlSec]]), 'token-blacklist');
}

/** The stored value for `storeKey`, or null when absent. */
async function upstashGet(storeKey: string): Promise<string | null> {
  const cfg = getUpstashConfig();
  if (!cfg) throw new Error('upstash not configured');
  const key = REVOKED_PREFIX + (await hashKey(storeKey, 'tamam-revoked'));
  const res = await withRetry(() => upstashPipeline(cfg, [['GET', key]]), 'token-blacklist');
  const v = res[0]?.result;
  return v == null ? null : String(v);
}

/**
 * Write one revocation entry to both backends (shared first, then the local
 * file as a warm fallback). Shared failures are logged, never swallowed
 * silently, and never block the local write.
 */
async function writeRevocation(storeKey: string, entry: RevocationEntry): Promise<void> {
  if (getUpstashConfig()) {
    try {
      await upstashRevoke(storeKey, entry.expSec, entry.issuedBefore !== undefined ? String(entry.issuedBefore) : '1');
    } catch (err) {
      // Do not swallow: a failed revocation means logout did not actually
      // invalidate the session. The local write below still happens, so this
      // replica is protected, but the operator needs to see it.
      console.error('[token-blacklist] shared revocation failed — token is revoked on THIS replica only:', err);
      captureException(err, { tag: '[token-blacklist] shared revocation failed — token is revoked on THIS replica only:' });
    }
  }

  await ensureLoaded();
  store!.set(storeKey, entry);
  if (getUpstashConfig() || process.env.NODE_ENV !== 'production') {
    schedulePersist();
  } else {
    // In production the file is the only durable record. A debounced write
    // could be lost to a restart inside its window, and the logout would
    // already have been reported as done.
    if (persistTimer) {
      clearTimeout(persistTimer);
      persistTimer = null;
    }
    await flushDurably();
  }
}

function clampedExp(expSec: number): number {
  // Clamp the stored lifetime to at most one session TTL. A legitimately issued
  // token's `exp` is always within one TTL of now, so this is a no-op for real
  // logouts; it caps a forged `exp` (e.g. the year 9999) that would otherwise
  // create an entry the sweeper never evicts and the Upstash TTL keeps for
  // centuries. Defence in depth behind the verify check at the logout route.
  return Math.min(expSec, Math.floor(Date.now() / 1000) + SESSION_TTL_SEC);
}

/** Decode (WITHOUT verifying) the claims we need to look a token up. Only ever
 *  used to choose which store keys to consult; a forged claim fails
 *  verifyToken afterwards, and a forged `sid` can only match a real session. */
function readClaims(token: string): { sid?: string; sub?: string; iat?: number } {
  const parts = token.split('.');
  if (parts.length !== 3) return {};
  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const c = JSON.parse(Buffer.from(padded, 'base64').toString('utf8')) as Record<string, unknown>;
    return {
      sid: typeof c.sid === 'string' && c.sid.length <= 128 ? c.sid : undefined,
      sub: typeof c.sub === 'string' && c.sub.length <= 256 ? c.sub : undefined,
      iat: typeof c.iat === 'number' ? c.iat : undefined,
    };
  } catch {
    return {};
  }
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
  const expSec = clampedExp(readExpFromJwt(token));
  await writeRevocation(token, { expSec });
  // Revoke the whole sign-in, not just this string: every renewal of a session
  // shares its `sid`, so a stolen earlier copy (or the next renewal of this
  // one) stops working too. Tokens minted before `sid` existed have none and
  // are covered by the exact-string entry above.
  const { sid } = readClaims(token);
  if (sid) await revokeSession(sid);
}

/** Revoke one session (the renewal family sharing `sid`). Safe to repeat. */
export async function revokeSession(sid: string): Promise<void> {
  if (!sid) return;
  // Held for one full TTL: every token of the family dies within one TTL of
  // its last renewal, and renewal itself is refused once the session is revoked.
  await writeRevocation(SID_PREFIX + sid, { expSec: clampedExp(Number.MAX_SAFE_INTEGER) });
}

/**
 * Sign a user out everywhere: every token issued to `userId` at or before now
 * stops working. A later sign-in (iat after the cutoff) is unaffected.
 */
export async function revokeUserSessions(userId: string): Promise<void> {
  if (!userId) return;
  const nowSec = Math.floor(Date.now() / 1000);
  await writeRevocation(USER_PREFIX + userId, {
    expSec: clampedExp(Number.MAX_SAFE_INTEGER),
    issuedBefore: nowSec,
  });
}

let writing: Promise<void> | null = null;
let queuedWrite: Promise<void> | null = null;

/**
 * Write the file and resolve once a write that started AFTER this call has
 * finished. Concurrent logouts share one follow-up write instead of each
 * rewriting the file.
 */
function flushDurably(): Promise<void> {
  if (!writing) {
    writing = persistNow().finally(() => { writing = null; });
    return writing;
  }
  if (!queuedWrite) {
    queuedWrite = writing.then(() => {
      queuedWrite = null;
      return flushDurably();
    });
  }
  return queuedWrite;
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
  const { sid, sub, iat } = readClaims(token);

  if (getUpstashConfig()) {
    try {
      if (await upstashGet(token) !== null) return true;
      if (sid && await upstashGet(SID_PREFIX + sid) !== null) return true;
      if (sub) {
        const cutoff = await upstashGet(USER_PREFIX + sub);
        if (cutoff !== null && (iat === undefined || iat <= Number(cutoff))) return true;
      }
    } catch (err) {
      console.error('[token-blacklist] shared lookup failed — falling back to local store:', err);
      captureException(err, { tag: '[token-blacklist] shared lookup failed — falling back to local store:' });
    }
  }

  await ensureLoaded();
  const nowSec = Math.floor(Date.now() / 1000);
  const live = (key: string): RevocationEntry | null => {
    const entry = store!.get(key);
    if (!entry) return null;
    if (entry.expSec <= nowSec) {
      store!.delete(key);
      schedulePersist();
      return null;
    }
    return entry;
  };
  if (live(token)) return true;
  if (sid && live(SID_PREFIX + sid)) return true;
  if (sub) {
    const entry = live(USER_PREFIX + sub);
    if (entry && (iat === undefined || iat <= (entry.issuedBefore ?? Infinity))) return true;
  }
  return false;
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
