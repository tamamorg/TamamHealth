/**
 * Sentry — Edge runtime config (middleware + edge route handlers).
 *
 * No-op when no DSN is configured. Loaded by `instrumentation.ts` in the
 * `edge` runtime.
 *
 * PII safety: every event passes through `stripPHI` (see
 * `src/lib/observability.ts`) before transport.
 */
import * as Sentry from '@sentry/nextjs';
import { stripPHI, stripPHITransaction } from '@/lib/observability';

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN || process.env.SENTRY_DSN;

Sentry.init({
  dsn,
  enabled: !!dsn,
  tracesSampleRate: 0.1,
  release: process.env.SENTRY_RELEASE,
  beforeSend: (event) => stripPHI(event),
  beforeSendTransaction: (event) => stripPHITransaction(event),
});
