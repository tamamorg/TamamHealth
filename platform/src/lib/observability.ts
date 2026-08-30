/**
 * Observability shim — wraps Sentry so the rest of the codebase doesn't have
 * to care whether the SDK is initialised. All helpers no-op when no DSN is
 * configured (current dev default), keeping the bundle effectively dead-code
 * eliminated and avoiding noisy warnings in local development.
 *
 * Two responsibilities:
 *
 *   1. captureException() / addBreadcrumb() — guarded forwarders.
 *   2. stripPHI()                            — `beforeSend` hook that scrubs
 *                                               cookies + obvious patient-data
 *                                               keys before transport.
 */
import * as Sentry from '@sentry/nextjs';
import type { Event } from '@sentry/core';

/**
 * Returns true when the Sentry SDK has been initialised with a real DSN.
 * Used internally to short-circuit every helper before they touch the SDK.
 *
 * In Sentry v8 the canonical check is `Sentry.getClient()` — the legacy
 * `getCurrentHub().getClient()` form still works (the v8 SDK ships a shim)
 * but the next-build webpack alias does not always re-export it across the
 * client/server/edge entry points. `getClient()` is on every entry point
 * and matches the v8 docs, so we use it directly.
 */
function isSentryReady(): boolean {
  try {
    return !!Sentry.getClient();
  } catch {
    return false;
  }
}

/**
 * Capture an exception with optional structured context. Safe to call
 * unconditionally — no-ops when Sentry is not initialised.
 */
export function captureException(err: unknown, ctx?: Record<string, unknown>): void {
  if (!isSentryReady()) return;
  try {
    if (ctx && Object.keys(ctx).length > 0) {
      Sentry.withScope((scope) => {
        scope.setContext('extra', ctx);
        Sentry.captureException(err);
      });
    } else {
      Sentry.captureException(err);
    }
  } catch {
    // Telemetry must never crash the request path.
  }
}

/**
 * Drop a structured breadcrumb. Used by middleware to leave a trail of
 * non-2xx responses. No-ops when Sentry is not initialised so the call is
 * free in dev.
 */
export function addBreadcrumb(crumb: {
  category?: string;
  message?: string;
  level?: 'fatal' | 'error' | 'warning' | 'info' | 'debug';
  data?: Record<string, unknown>;
}): void {
  if (!isSentryReady()) return;
  try {
    Sentry.addBreadcrumb(crumb);
  } catch {
    // Telemetry must never crash the request path.
  }
}

/**
 * Keys whose VALUES we always drop from any `data`/`extra`/`request.data`
 * payload before transport. Match is case-insensitive and substring-aware
 * (so `passwordHash`, `password_confirm`, `userPassword`, etc. all match).
 *
 * IMPORTANT: this list is the contract documented in
 * `docs/operations/monitoring.md` — keep both in sync.
 */
const PHI_KEY_PATTERNS: readonly RegExp[] = [
  /email/i,
  /phone/i,
  /dob/i,
  /dateofbirth/i,    // `dateOfBirth` — the field name actually used on patient docs
  /birthdate/i,
  /password/i,       // covers `password`, `passwordHash`, `password_confirm`
  /passwordhash/i,   // explicit (covered by /password/i but kept for clarity)
  /nationalid/i,
  /national_id/i,
  /notes/i,
  /patientname/i,    // `patientName` — used across ~170 doc-type sites
  /hospitalnumber/i,
  /address/i,
  /chiefcomplaint/i,
  /diagnos/i,        // `diagnosis`, `diagnoses`
  /firstname/i,
  /lastname/i,
] as const;

const REDACTED = '[redacted]';

function isPHIKey(key: string): boolean {
  return PHI_KEY_PATTERNS.some((re) => re.test(key));
}

/**
 * Recursively scrub keys matching `PHI_KEY_PATTERNS` from a plain object,
 * mutating in place. Arrays are walked but not flattened. Non-object values
 * are returned untouched. Cyclic structures are guarded via a WeakSet.
 */
function scrubObject(obj: unknown, seen: WeakSet<object> = new WeakSet()): void {
  if (obj === null || typeof obj !== 'object') return;
  if (seen.has(obj as object)) return;
  seen.add(obj as object);

  if (Array.isArray(obj)) {
    for (const v of obj) scrubObject(v, seen);
    return;
  }

  const o = obj as Record<string, unknown>;
  for (const k of Object.keys(o)) {
    if (isPHIKey(k)) {
      o[k] = REDACTED;
    } else if (o[k] && typeof o[k] === 'object') {
      scrubObject(o[k], seen);
    }
  }
}

/**
 * Sentry `beforeSend` hook. Removes:
 *
 *   • `event.request.headers.cookie` — full session + CSRF cookies.
 *   • Any nested `data` key matching the PHI patterns above (email, phone,
 *     dob, password*, nationalId, notes).
 *
 * Mutates and returns the event. Called for every captured event regardless
 * of severity. Returning `null` would drop the event entirely; we keep it so
 * operators still see the error, just without PHI attached.
 */
export function stripPHI<T extends Event = Event>(event: T): T {
  // 1. Cookies — session JWT + CSRF token both live here, neither is useful
  //    for debugging and both are highly sensitive.
  if (event.request?.headers && typeof event.request.headers === 'object') {
    const headers = event.request.headers as Record<string, unknown>;
    for (const k of Object.keys(headers)) {
      if (k.toLowerCase() === 'cookie') {
        headers[k] = REDACTED;
      }
    }
  }

  // 2. Top-level request body, if any.
  if (event.request && 'data' in event.request) {
    scrubObject(event.request.data);
  }

  // 3. Per-event `extra` and `contexts.*` blobs (where captureException
  //    attaches the ctx argument).
  if (event.extra) scrubObject(event.extra);
  if (event.contexts) scrubObject(event.contexts);

  // 4. Breadcrumb data payloads.
  if (Array.isArray(event.breadcrumbs)) {
    for (const b of event.breadcrumbs) {
      if (b && typeof b === 'object' && b.data) scrubObject(b.data);
    }
  }

  return event;
}

/**
 * Exposed for tests — the canonical PHI key list. The operations doc
 * references this same set.
 */
export const __PHI_KEY_PATTERNS_FOR_TESTING = PHI_KEY_PATTERNS;
