/**
 * Shared Upstash Redis REST client (KAN-34 / HIGH-04).
 *
 * Extracted from `rate-limit.ts` so the token blacklist can use the same
 * backend. Both are per-instance security state that must be shared across
 * replicas: a rate-limit counter that only one replica can see lets an attacker
 * multiply their allowance by the replica count, and a revocation list that
 * only one replica can see lets a logged-out token keep working on the others.
 *
 * REST rather than the `redis` driver, and no `@upstash/redis` SDK: this is
 * plain HTTPS + JSON, so it runs unchanged in both the Node and Edge runtimes
 * with `fetch` alone. Keep it free of `node:` imports — `proxy.ts` runs on Edge
 * and may need this later.
 */

export interface UpstashConfig {
  url: string;
  token: string;
}

/** Returns null when Upstash is not configured — callers fall back locally. */
export function getUpstashConfig(): UpstashConfig | null {
  // Vercel's Upstash marketplace uses KV_REST_* names; direct Upstash
  // projects commonly use UPSTASH_REDIS_REST_*. Support both so the shared
  // security store cannot silently degrade to per-instance memory.
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;
  return { url: url.replace(/\/+$/, ''), token };
}

/** True when a shared backend is available for security state. */
export function hasSharedStore(): boolean {
  return getUpstashConfig() !== null;
}

/**
 * POST a Redis pipeline to Upstash. Returns the array of `{ result }` /
 * `{ error }` entries. Throws on transport failure or 5xx so the caller can
 * decide how to degrade.
 */
export async function upstashPipeline(
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
 * If both the original call and the retry throw, propagate the first error.
 *
 * The backoff is deliberately short (50 ms): login latency budget is tight, and
 * the caller degrades to a local fallback rather than hanging.
 */
export async function withRetry<T>(fn: () => Promise<T>, label = 'upstash'): Promise<T> {
  try {
    return await fn();
  } catch (firstErr) {
    await new Promise((r) => setTimeout(r, 50));
    try {
      return await fn();
    } catch (secondErr) {
      console.error(`[${label}] upstash retry failed:`, secondErr);
      throw firstErr;
    }
  }
}

/**
 * SHA-256 the caller's key and truncate to 16 hex chars.
 *
 * Hashed so raw usernames / IPs / JWTs are never stored in Redis. An operator
 * console showing "failed-attempt counter for user dr.wani" is itself a small
 * information leak, and a blacklist holding full JWTs would be a credential
 * store. Web Crypto so this stays Edge-safe.
 */
export async function hashKey(key: string, namespace = 'tamam'): Promise<string> {
  const data = new TextEncoder().encode(`${namespace}:${key}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  const bytes = new Uint8Array(digest);
  let hex = '';
  for (let i = 0; i < 8; i++) hex += bytes[i].toString(16).padStart(2, '0');
  return hex;
}
