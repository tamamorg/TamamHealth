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

/**
 * Every App Router navigation (a Link, router.push/replace, Back) starts here.
 * Sentry gets its transaction; the route progress bar (components/motion/
 * RouteProgress) gets a DOM event. An event rather than React state: this
 * runs inside the navigation's startTransition, so a setState here would wait
 * for the very navigation it is meant to report.
 */
export function onRouterTransitionStart(url: string, navigationType: 'push' | 'replace' | 'traverse') {
  Sentry.captureRouterTransitionStart(url, navigationType);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('tamam:navigation-start', { detail: { url, navigationType } }));
  }
}
