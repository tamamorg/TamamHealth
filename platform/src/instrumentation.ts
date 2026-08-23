/**
 * Next.js Instrumentation — runs once on server startup.
 */

import { productionConfigWarnings, syncConfigProblems, validateProductionConfig } from './lib/config-validation';
import * as Sentry from '@sentry/nextjs';

// Capture failures from nested React Server Components and server request
// handling. Sentry remains transport-disabled when no DSN is configured.
export const onRequestError = Sentry.captureRequestError;

/**
 * Boot-time configuration safety check. Refuses to start in production if an
 * obvious placeholder / empty / missing secret leaked through — better to fail
 * loudly on deploy than to silently ship a known-bad credential. The rules live
 * in lib/config-validation.ts so they are unit-testable.
 */
/**
 * Say it out loud when replication cannot work.
 *
 * Production refuses to boot on these; development used to accept them in
 * silence, which is the worst place for this particular failure to hide — the
 * app looks healthy because every screen reads the local database, and the
 * server simply never receives anything.
 */
function reportSyncConfig(): void {
  const problems = syncConfigProblems(process.env);
  if (problems.length === 0) return;
  console.warn('');
  console.warn('  ------------------------------------------------------------');
  console.warn('  SYNC IS DISABLED BY CONFIGURATION — nothing will reach CouchDB');
  console.warn('  ------------------------------------------------------------');
  for (const p of problems) console.warn(`  • ${p}`);
  console.warn('  ------------------------------------------------------------');
  console.warn('');
}

function assertProductionConfig(): void {
  if (process.env.NODE_ENV !== 'production') {
    reportSyncConfig();
    return;
  }

  const errors = validateProductionConfig(process.env);

  if (errors.length > 0) {
    console.error('');
    console.error('  ============================================================');
    console.error('  PRODUCTION STARTUP REFUSED — invalid configuration');
    console.error('  ============================================================');
    for (const e of errors) console.error(`  • ${e}`);
    console.error('  ============================================================');
    console.error('');
    throw new Error('Invalid production configuration — see errors above.');
  }

  // Printed, not thrown: these do not make the deployment unsafe, they make it
  // hard to operate. Surfaced on every boot so the gap is a decision someone
  // keeps making rather than one nobody knows about.
  const warnings = productionConfigWarnings(process.env);
  if (warnings.length > 0) {
    console.warn('');
    console.warn('  ------------------------------------------------------------');
    console.warn('  PRODUCTION CONFIGURATION WARNINGS');
    console.warn('  ------------------------------------------------------------');
    for (const w of warnings) console.warn(`  • ${w}`);
    console.warn('  ------------------------------------------------------------');
    console.warn('');
  }
}

export async function register() {
  // Wire Sentry early so any error thrown by the boot path below (license
  // check, migrations) gets captured. Gated on a DSN being set: with no DSN
  // configured this is a no-op and the SDK loader never fires a network
  // request — preserving the local "no Sentry account required" dev flow.
  const sentryDsn = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN;

  if (sentryDsn && process.env.NEXT_RUNTIME === 'nodejs') {
    await import('../sentry.server.config');
  }
  if (sentryDsn && process.env.NEXT_RUNTIME === 'edge') {
    await import('../sentry.edge.config');
  }

  // Only run on the server (not during build or in the edge runtime)
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // If the operator has opted into Doppler (DOPPLER_TOKEN is set), verify
    // the secret injection actually populated process.env. No-op otherwise,
    // so existing .env_file-based deploys continue to work unchanged.
    const { assertDopplerEnv } = await import('./lib/secrets');
    assertDopplerEnv();
    assertProductionConfig();

    // Apply pending Postgres migrations before the app starts serving. The
    // runner takes a Postgres advisory lock so rolling-deploy replicas can't
    // race. If DATABASE_URL is unset the platform isn't using analytics
    // Postgres yet — that's a valid dev configuration, so we just log and
    // skip rather than crash.
    if (!process.env.DATABASE_URL) {
      console.log('  [migrate] DATABASE_URL not set — skipping Postgres migrations.');
    } else if (process.env.SKIP_DB_MIGRATIONS === 'true') {
      console.log('  [migrate] SKIP_DB_MIGRATIONS=true — operator has disabled the boot-time runner.');
    } else {
      try {
        const { runMigrations } = await import('./lib/db/migrate');
        await runMigrations();
      } catch (err) {
        console.error('');
        console.error('  ============================================================');
        console.error('  STARTUP REFUSED — Postgres migrations failed');
        console.error('  ============================================================');
        console.error(`  ${err instanceof Error ? err.message : String(err)}`);
        console.error('  ============================================================');
        console.error('');
        throw err;
      }
    }
  }
}
