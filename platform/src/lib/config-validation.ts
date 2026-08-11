/**
 * Production configuration safety checks (fail-closed).
 *
 * Extracted from instrumentation.ts so the rules are unit-testable. Each rule
 * returns a human-readable error; a non-empty list means production must refuse
 * to boot rather than silently ship a known-bad / missing credential.
 */

const PLACEHOLDER = /REPLACE|CHANGE|PLACEHOLDER|ChangeMe/i;
const JWT_PLACEHOLDER = /REPLACE|CHANGE|PLACEHOLDER|default|example|tamamhealth-south-sudan/i;

export interface ConfigEnv {
  [key: string]: string | undefined;
}

/**
 * Validate production config. Returns a list of fatal errors (empty = OK).
 * Pure: takes the env so tests can exercise every branch deterministically.
 */
export function validateProductionConfig(env: ConfigEnv): string[] {
  const errors: string[] = [];

  // --- Bootstrap admin password -------------------------------------------
  const adminPass = env.ADMIN_INITIAL_PASSWORD || '';
  if (adminPass && PLACEHOLDER.test(adminPass)) {
    errors.push('ADMIN_INITIAL_PASSWORD still contains a placeholder — rotate it before boot.');
  }
  if (env.NEXT_PUBLIC_ADMIN_PASSWORD) {
    errors.push('NEXT_PUBLIC_ADMIN_PASSWORD is set — remove it. Use ADMIN_INITIAL_PASSWORD (server-only) instead.');
  }

  // --- JWT signing secret --------------------------------------------------
  const jwt = env.JWT_SECRET || '';
  if (!jwt) {
    errors.push('JWT_SECRET is unset — generate one with `openssl rand -base64 48`.');
  } else if (JWT_PLACEHOLDER.test(jwt)) {
    errors.push('JWT_SECRET still contains a placeholder / default — generate one with `openssl rand -base64 48`.');
  } else if (jwt.length < 32) {
    errors.push(`JWT_SECRET must be at least 32 characters in production (got ${jwt.length}).`);
  }

  // --- Field encryption key (encryption at rest) ---------------------------
  // REQUIRED in production. The previous rule only fired when encryption was
  // already switched ON, so the dangerous case — an operator who never set the
  // flag at all and is silently writing plaintext PHI — passed validation
  // cleanly. That is exactly backwards for a fail-closed check.
  // Exempt only an explicit demo deployment, which by definition holds seeded
  // fake data rather than real patients. Any other production boot must encrypt.
  const isDemo = env.NEXT_PUBLIC_DEMO_MODE === 'true';
  if (!isDemo && env.NEXT_PUBLIC_CLEAR_SEEDED_DATA_ONCE === 'true') {
    errors.push('NEXT_PUBLIC_CLEAR_SEEDED_DATA_ONCE must be false in production — destructive cleanup is an operator-only migration.');
  }
  if (!isDemo && env.PHI_ENCRYPTION_ENABLED !== 'true') {
    errors.push(
      'PHI_ENCRYPTION_ENABLED must be "true" in production — patient data would otherwise be stored unencrypted. ' +
      'Set it and supply PHI_ENCRYPTION_KEY (`openssl rand -base64 32`). ' +
      'Only an explicit demo deployment (NEXT_PUBLIC_DEMO_MODE=true, seeded fake data) may run without it.',
    );
  } else if (env.PHI_ENCRYPTION_ENABLED === 'true') {
    const key = env.PHI_ENCRYPTION_KEY || '';
    if (!key) {
      errors.push('PHI_ENCRYPTION_ENABLED=true but PHI_ENCRYPTION_KEY is unset — generate one with `openssl rand -base64 32`.');
    } else if (PLACEHOLDER.test(key)) {
      errors.push('PHI_ENCRYPTION_KEY still contains a placeholder — generate a real one with `openssl rand -base64 32`.');
    } else if (Buffer.from(key, 'base64').length !== 32) {
      errors.push('PHI_ENCRYPTION_KEY must decode to exactly 32 bytes (AES-256) — generate with `openssl rand -base64 32`.');
    }
  }

  // --- Shared security state (Upstash Redis) -------------------------------
  // Rate-limit counters and the JWT revocation list are per-instance unless a
  // shared store is configured. With more than one replica that means an
  // attacker gets `limit` login attempts PER REPLICA, and a token revoked at
  // logout on replica A keeps working on replica B until its `exp` passes.
  //
  // A process cannot tell how many replicas it is one of, so this is required
  // in production and the single-replica case must say so explicitly. Same
  // fail-closed shape as the PHI rule above: the dangerous configuration is
  // reachable, but only as a deliberate, recorded choice.
  const sharedRedisUrl = env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL;
  const sharedRedisToken = env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN;
  if (!isDemo && !sharedRedisUrl) {
    if (env.SINGLE_REPLICA_ACK !== 'true') {
      errors.push(
        'UPSTASH_REDIS_REST_URL/TOKEN are unset, so rate-limit counters and the JWT ' +
        'revocation list are per-instance — a logged-out token stays valid on other ' +
        'replicas. Configure Upstash, or set SINGLE_REPLICA_ACK=true to confirm this ' +
        'deploy runs exactly ONE platform replica.',
      );
    }
  } else if (!isDemo && sharedRedisUrl && !sharedRedisToken) {
    errors.push('A shared Redis URL is set but its token is unset — the shared store would be unreachable.');
  }

  // --- Sync (CouchDB) ------------------------------------------------------
  // A Vercel deployment is multi-user/serverless by definition. Browser-only
  // PouchDB is an offline cache, not shared durable storage, so allowing sync
  // to be disabled in production would make users on different devices see
  // different patient charts and worklists.
  if (!isDemo && env.NEXT_PUBLIC_SYNC_ENABLED !== 'true') {
    errors.push('NEXT_PUBLIC_SYNC_ENABLED must be true in production — shared CouchDB replication is required for multi-user patient data.');
  }
  if (!isDemo && !env.COUCHDB_URL) {
    errors.push('COUCHDB_URL is unset — server routes on Vercel need a durable CouchDB endpoint, not local filesystem storage.');
  }
  if (!isDemo) {
    for (const [name, value] of [
      ['COUCHDB_URL', env.COUCHDB_URL],
      ['NEXT_PUBLIC_COUCHDB_URL', env.NEXT_PUBLIC_COUCHDB_URL],
    ] as const) {
      if (!value) continue;
      try {
        const url = new URL(value);
        const localHost = /^(localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|couchdb)$/i.test(url.hostname);
        if (url.protocol !== 'https:') {
          errors.push(`${name} must use https:// in production — clinical data must not cross the network in clear text.`);
        }
        if (localHost || url.hostname.endsWith('.internal')) {
          errors.push(`${name} points to a private/local Docker hostname (${url.hostname}) — configure the reachable production CouchDB hostname.`);
        }
      } catch {
        errors.push(`${name} is not a valid URL.`);
      }
    }
  }
  if (env.NEXT_PUBLIC_SYNC_ENABLED === 'true') {
    if (!env.NEXT_PUBLIC_COUCHDB_URL) {
      errors.push('NEXT_PUBLIC_SYNC_ENABLED=true but NEXT_PUBLIC_COUCHDB_URL is unset.');
    }
    if (!env.COUCHDB_WEBHOOK_SECRET) {
      errors.push('NEXT_PUBLIC_SYNC_ENABLED=true but COUCHDB_WEBHOOK_SECRET is unset.');
    }
  }

  // --- Telehealth video (LiveKit) -------------------------------------------
  // Video is OPTIONAL: a deployment with no LiveKit server is a legitimate
  // configuration, and the platform degrades honestly for it — the token route
  // returns 503 and the visit room says video is unconfigured.
  //
  // What must not be reachable is a PARTIAL configuration. An operator who set
  // two of the three keys clearly intended working video, and the omission
  // surfaces as a 503 the first time a clinician opens a consultation — the
  // worst possible moment to discover it. So: all three, or none.
  const lkUrl = env.LIVEKIT_URL || env.NEXT_PUBLIC_LIVEKIT_URL || '';
  const lkKey = env.LIVEKIT_API_KEY || '';
  const lkSecret = env.LIVEKIT_API_SECRET || '';
  const lkSet = [lkUrl, lkKey, lkSecret].filter(Boolean).length;

  if (lkSet > 0 && lkSet < 3) {
    const missing = [
      lkUrl ? null : 'LIVEKIT_URL',
      lkKey ? null : 'LIVEKIT_API_KEY',
      lkSecret ? null : 'LIVEKIT_API_SECRET',
    ].filter(Boolean).join(', ');
    errors.push(
      `Telehealth video is partially configured — ${missing} unset. Set all three, ` +
      'or none at all (video then reports itself unavailable instead of failing mid-visit).',
    );
  }

  if (lkSecret && PLACEHOLDER.test(lkSecret)) {
    errors.push('LIVEKIT_API_SECRET still contains a placeholder — it signs join tokens, so treat it like JWT_SECRET.');
  }

  // The API key/secret sign tokens that grant entry to any consultation. A
  // NEXT_PUBLIC_ copy is compiled into the browser bundle and served to every
  // visitor — same failure shape as NEXT_PUBLIC_ADMIN_PASSWORD above.
  for (const leaked of ['NEXT_PUBLIC_LIVEKIT_API_KEY', 'NEXT_PUBLIC_LIVEKIT_API_SECRET']) {
    if (env[leaked]) {
      errors.push(`${leaked} is set — it would ship in the client bundle and lets anyone mint a token for any visit. Use the server-only variable.`);
    }
  }

  // PHI-bearing media must not cross the network in the clear. `ws://` is
  // acceptable for a local dev server only.
  if (lkUrl && !isDemo && /^ws:\/\//i.test(lkUrl) && !/^ws:\/\/(localhost|127\.0\.0\.1)/i.test(lkUrl)) {
    errors.push('LIVEKIT_URL uses ws:// — telehealth media carries PHI and must use wss:// in production.');
  }

  // --- Payment webhooks ------------------------------------------------------
  // Public money-movement callbacks must not run unsigned in production. The
  // individual routes keep a non-production fallback for local gateway testing.
  if (!env.AIRTEL_WEBHOOK_SECRET) {
    errors.push('AIRTEL_WEBHOOK_SECRET is unset — Airtel webhooks would be unsigned in production.');
  }
  if (!env.MPESA_WEBHOOK_SECRET) {
    errors.push('MPESA_WEBHOOK_SECRET is unset — M-Pesa webhooks would be unsigned in production.');
  }

  return errors;
}
