/**
 * Sentry — browser instrumentation.
 *
 * No-op when no DSN is configured (current dev default). Loaded automatically
 * through Next.js' instrumentation-client convention.
 *
 * PII safety: every event passes through `stripPHI` (see
 * `src/lib/observability.ts`) before transport. Cookies + obvious patient-data
 * keys (email, phone, dob, password*, nationalId, notes) are scrubbed.
 */
import * as Sentry from '@sentry/nextjs';
import { stripPHI } from '@/lib/observability';

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN || process.env.SENTRY_DSN;

Sentry.init({
  dsn,
  enabled: !!dsn,
  tracesSampleRate: 0.1,
  release: process.env.SENTRY_RELEASE,
  beforeSend: (event) => stripPHI(event),
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
