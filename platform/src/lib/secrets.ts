/**
 * Doppler boot-time guard.
 *
 * The platform supports two runtime modes for secrets:
 *
 *   Mode A (legacy): docker-compose loads `platform/.env.production` via
 *                    env_file. `process.env` is fully populated by the time
 *                    Node starts. DOPPLER_TOKEN is unset.
 *
 *   Mode B (target): the host wraps the platform start command with
 *                    `doppler run --`, which fetches secrets from Doppler
 *                    and exports them into the process env. DOPPLER_TOKEN
 *                    is set on the host so this code can verify the
 *                    injection happened.
 *
 * This helper:
 *
 *   - is a no-op when DOPPLER_TOKEN is unset (Mode A — preserves the legacy
 *     deploy path so existing operators are not broken by the rollout),
 *   - when DOPPLER_TOKEN IS set (Mode B), asserts that the critical secrets
 *     actually arrived in process.env. If they didn't, the platform refuses
 *     to start with a clear "Doppler env not loaded" error rather than
 *     silently booting with a half-empty config.
 *
 * Why this matters: the most common Doppler misconfiguration is an operator
 * setting DOPPLER_TOKEN but forgetting to wrap the start command with
 * `doppler run --`. The result is a process that has DOPPLER_TOKEN but no
 * actual secrets — which would happily boot the platform with a JWT_SECRET
 * of `undefined` and leak sessions. The check here turns that into a loud
 * crash instead.
 *
 * Called from `src/instrumentation.ts` during the production boot path.
 */

/**
 * Secrets that MUST be present whenever Doppler-mode is engaged.
 *
 * Session signing is always required. Payment gateways are optional and are
 * validated only when their verified callback flag enables them.
 * `DATABASE_URL` is conditionally required: when the operator opts into
 *   Postgres analytics (presence in the Doppler config), it must arrive too.
 *
 * Add new entries here when you add a new boot-required secret to Doppler.
 * Optional integrations (RESEND_API_KEY, Flutterwave, etc.) do not belong
 * here. Flutterwave is validated as a pair by config-validation when enabled.
 */
const ALWAYS_REQUIRED: readonly string[] = [
  'JWT_SECRET',
];

const CONDITIONALLY_REQUIRED: readonly string[] = ['DATABASE_URL'];

/**
 * Verify Doppler-injected secrets arrived in process.env.
 *
 * Throws (and prints a banner) if Doppler-mode is engaged but the secrets
 * are missing. Returns silently in legacy mode and on success.
 */
export function assertDopplerEnv(): void {
  // Legacy mode — operator hasn't opted into Doppler yet. Nothing to check.
  if (!process.env.DOPPLER_TOKEN) return;

  const missing: string[] = [];

  for (const key of ALWAYS_REQUIRED) {
    if (!process.env[key]) missing.push(key);
  }

  // Only require DATABASE_URL if the operator has put it in the Doppler
  // config — i.e. they explicitly intend to use Postgres analytics. Detection:
  // we cannot ask Doppler at runtime, but if the env contains *any* DATABASE_*
  // hint then they meant to ship a DATABASE_URL too.
  const looksLikePostgresEnabled =
    typeof process.env.DATABASE_URL === 'string' && process.env.DATABASE_URL.length > 0
      ? true
      : Object.keys(process.env).some(k => k.startsWith('DATABASE_') && k !== 'DATABASE_URL');

  if (looksLikePostgresEnabled) {
    for (const key of CONDITIONALLY_REQUIRED) {
      if (!process.env[key]) missing.push(key);
    }
  }

  if (missing.length === 0) return;

  // Loud, easy-to-grep banner. The exact phrase "Doppler env not loaded" is
  // referenced in docs/operations/secrets.md — do not reword without updating
  // the doc.
  console.error('');
  console.error('  ============================================================');
  console.error('  STARTUP REFUSED — Doppler env not loaded');
  console.error('  ============================================================');
  console.error('  DOPPLER_TOKEN is set but the following secrets are missing:');
  for (const key of missing) console.error(`    - ${key}`);
  console.error('');
  console.error("  Run the platform via 'doppler run --' so secrets are");
  console.error('  injected into the process environment, OR unset');
  console.error('  DOPPLER_TOKEN to fall back to the legacy .env_file path.');
  console.error('  See docs/operations/secrets.md for setup details.');
  console.error('  ============================================================');
  console.error('');

  throw new Error(
    `Doppler env not loaded — missing: ${missing.join(', ')}. ` +
      `Run via 'doppler run --' or unset DOPPLER_TOKEN.`,
  );
}
