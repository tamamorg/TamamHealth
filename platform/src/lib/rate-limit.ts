/**
 * Centralised rate limiter — async, sliding-window counters.
 *
 * Two backends, selected at module-init by env:
 *
 *   - Upstash Redis REST (used iff UPSTASH_REDIS_REST_URL and
 *     UPSTASH_REDIS_REST_TOKEN are both set). State is shared across every
 *     instance, so horizontally scaled deploys and cold restarts no longer
 *     forget who is locked out.
 *
 *   - In-process Map (fallback). Works for single-instance dev. Logs a
 *     one-time warning at first use to remind operators that any
 *     multi-instance deploy MUST set the Upstash vars.
 *
 * Why Upstash REST over the `redis` driver?
 *   The REST API is plain HTTPS + JSON. It works in both the Node and Edge
 *   runtimes with `fetch` only — no native sockets, no Node-only deps. Rate
 *   limiting is one of the things we may want to push into middleware (Edge)
 *   later, and the REST backend lets the *same* module run there. The
 *   `@upstash/redis` SDK would also work, but pulling another runtime dep
 *   for two commands is not worth it.
 *
 * Algorithm: sliding-window via INCR + EXPIRE
 *   - Bucket key = sha256(prefix:key) hex-truncated to 16 chars. We hash so
 *     usernames / IPs aren't stored as plaintext in Redis (the operator
 *     console showing "failed-attempt counter for user dr.wani" is itself
 *     a small information leak).
 *   - INCR on the bucket; if the result equals 1 (first hit in the window)
 *     EXPIRE the bucket to windowMs. This gives a fixed-window counter
 *     bound by the EXPIRE TTL, which is what the existing in-memory code
 *     was already approximating ("count + lockedUntil"). The verdict
 *     reports `remaining` as `limit - count` clamped to >= 0 and `resetAt`
 *     as now + the bucket's TTL.
 *
 * Fail-open posture
 *   If Upstash returns a 5xx, throws, or times out, we let the request
 *   through and log. Rate limiting is a defence-in-depth measure; making
 *   the *whole login route* unavailable when Redis hiccups would be a
 *   self-inflicted DoS. The other layers (CSRF, password verifier, audit
 *   log) still run.
 *
 * Edge-runtime safety
 *   Implemented with Web Crypto (`crypto.subtle.digest`) and `fetch` — no
 *   `node:` imports — so the module can be moved into middleware later
 *   without changes.
 */

export interface RateLimitVerdict {
  /** True iff this request is below the limit and may proceed. */
  allowed: boolean;
  /** Unix epoch ms at which the bucket resets. */
  resetAt: number;
  /** Remaining requests in the current window (>= 0). */
  remaining: number;
}

interface RateLimitOptions {
  /** Caller-supplied identifier (e.g. `login:user:dr.wani`). Hashed before storage. */
  key: string;
  /** Maximum requests permitted in `windowMs`. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
}

const ENCODER = new TextEncoder();

/**
 * sha256(prefix-namespaced key) hex-truncated to 16 chars. 64 bits of
 * collision resistance is plenty for a per-key bucket — at expected
 * cardinality (~thousands of usernames + IPs), birthday collisions are
 * astronomically unlikely, and a collision only means two keys share a
 * counter (a rate limit gets a tiny bit stricter), which is safe.
 */
async function hashKey(key: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', ENCODER.encode(`tamam-rl:${key}`));
  const bytes = new Uint8Array(digest);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex.slice(0, 16);
}

// ---------------------------------------------------------------------------
// In-memory backend
// ---------------------------------------------------------------------------

interface MemBucket {
  count: number;
  /** Unix epoch ms at which this bucket expires. */
  resetAt: number;
}

const memStore = new Map<string, MemBucket>();
let memWarned = false;

function maybeWarnMemoryFallback(): void {
  if (memWarned) return;
  memWarned = true;
  console.warn(
    '[rate-limit] Using in-process memory backend. Horizontally scaled ' +
      'deploys MUST set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN ' +
      'so per-IP / per-user counters are shared across instances.',
  );
}

function memIncrement(hashed: string, windowMs: number, limit: number): RateLimitVerdict {
  maybeWarnMemoryFallback();
  const now = Date.now();
  let bucket = memStore.get(hashed);
  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + windowMs };
    memStore.set(hashed, bucket);
  }
  bucket.count += 1;
  const remaining = Math.max(0, limit - bucket.count);
  return {
    allowed: bucket.count <= limit,
    resetAt: bucket.resetAt,
    remaining,
  };
}

function memReset(hashed: string): void {
  memStore.delete(hashed);
}

// ---------------------------------------------------------------------------
// Upstash backend
// ---------------------------------------------------------------------------

interface UpstashConfig {
  url: string;
  token: string;
}

function getUpstashConfig(): UpstashConfig | null {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;
  return { url: url.replace(/\/+$/, ''), token };
}

/**
 * POST a Redis pipeline to Upstash. Returns the array of `{ result }` /
 * `{ error }` entries. Throws on transport failure or 5xx so the caller
 * can fall through to fail-open.
 */
async function upstashPipeline(
  cfg: UpstashConfig,
  commands: (string | number)[][],
): Promise<Array<{ result?: unknown; error?: string }>> {
  const res = await fetch(`${cfg.url}/pipeline`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(commands),
    // Edge-safe; Node's fetch silently ignores unknown options.
    cache: 'no-store',
  });
  if (res.status >= 500) {
    throw new Error(`Upstash 5xx: ${res.status}`);
  }
  if (!res.ok) {
    // 4xx is a programming error (bad token, bad command). Surface it loudly.
    const text = await res.text().catch(() => '');
    throw new Error(`Upstash ${res.status}: ${text.slice(0, 200)}`);
  }
  return (await res.json()) as Array<{ result?: unknown; error?: string }>;
}

/**
 * Run a function with one round of exponential backoff on transient failure.
 * If both the original call and the retry throw, propagate the latter so
 * the caller can fail-open.
 */
async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (firstErr) {
    // 50ms backoff before the single retry. We deliberately keep this short:
    // login latency budget is tight, and the alternative on persistent
    // failure is fail-open, which is bounded by the other layers.
    await new Promise((r) => setTimeout(r, 50));
    try {
      return await fn();
    } catch (secondErr) {
      console.error('[rate-limit] upstash retry failed:', secondErr);
      throw firstErr;
    }
  }
}

async function upstashIncrement(
  cfg: UpstashConfig,
  hashed: string,
  windowMs: number,
  limit: number,
): Promise<RateLimitVerdict> {
  const ttlSec = Math.max(1, Math.ceil(windowMs / 1000));
  const fullKey = `rl:${hashed}`;
  const results = await withRetry(() =>
    upstashPipeline(cfg, [
      ['INCR', fullKey],
      ['EXPIRE', fullKey, ttlSec, 'NX'],
      ['PTTL', fullKey],
    ]),
  );
  const incrEntry = results[0];
  if (!incrEntry || incrEntry.error || typeof incrEntry.result !== 'number') {
    throw new Error(`Upstash INCR returned no result: ${JSON.stringify(incrEntry)}`);
  }
  const count = incrEntry.result;
  const pttlEntry = results[2];
  let resetAt = Date.now() + windowMs;
  if (pttlEntry && typeof pttlEntry.result === 'number' && pttlEntry.result > 0) {
    resetAt = Date.now() + pttlEntry.result;
  }
  return {
    allowed: count <= limit,
    resetAt,
    remaining: Math.max(0, limit - count),
  };
}

async function upstashReset(cfg: UpstashConfig, hashed: string): Promise<void> {
  await withRetry(() => upstashPipeline(cfg, [['DEL', `rl:${hashed}`]]));
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Increment the counter for `key` and report whether the request is allowed.
 *
 * On Upstash failure we fail-open (return `allowed: true`) and log; rate
 * limiting must never deny legitimate traffic because of an upstream blip.
 */
export async function rateLimit(opts: RateLimitOptions): Promise<RateLimitVerdict> {
  const { key, limit, windowMs } = opts;
  const hashed = await hashKey(key);
  const cfg = getUpstashConfig();

  if (cfg) {
    try {
      return await upstashIncrement(cfg, hashed, windowMs, limit);
    } catch (err) {
      // Degrade to the in-process counter rather than failing fully open
      // (KAN-34). The old behaviour returned `allowed: true`, which suspended
      // rate limiting entirely for the duration of an Upstash outage — an
      // attacker who could induce or wait out a blip got unlimited login
      // attempts. The in-process bucket is per-replica and therefore weaker
      // than the shared one, but it is bounded: brute force is still capped at
      // `limit` per replica per window instead of infinity.
      console.error('[rate-limit] Upstash failed — degrading to in-process counter:', err);
      return memIncrement(hashed, windowMs, limit);
    }
  }

  return memIncrement(hashed, windowMs, limit);
}

/**
 * Clear the counter for `key`. Called after a successful login so the
 * legitimate user's failed-attempt streak is forgotten — otherwise a
 * clinician who fat-fingered the password four times before getting it
 * right would still be one bad guess away from a 15-minute lockout.
 *
 * Best-effort: a backend failure here is logged but not raised. The next
 * INCR will still respect the limit, just from the bucket's pre-reset
 * count rather than zero.
 */
export async function resetRateLimit(key: string): Promise<void> {
  const hashed = await hashKey(key);
  const cfg = getUpstashConfig();
  if (cfg) {
    try {
      await upstashReset(cfg, hashed);
      return;
    } catch (err) {
      console.error('[rate-limit] Upstash reset failed:', err);
      return;
    }
  }
  memReset(hashed);
}

// ---------------------------------------------------------------------------
// Test helpers (not part of the public surface)
// ---------------------------------------------------------------------------

/**
 * Test-only: drop all in-memory state and reset the warn-once latch.
 * Production code should never call this.
 */
export function _resetRateLimitForTest(): void {
  memStore.clear();
  memWarned = false;
}
