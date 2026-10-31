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

/** Headers that carry credentials, whatever they are called by a proxy or client. */
const SENSITIVE_HEADER = /^(cookie|set-cookie|authorization|proxy-authorization)$|token|secret|api-?key|csrf|session/i;

/** A URL or path without its query string or fragment: `?breakGlassReason=…`, `?patientId=…`, `#access_token=…`. */
export function stripQuery(value: string): string {
  return value.replace(/[?#][\s\S]*$/, '');
}

const SCRUBBERS: ReadonlyArray<readonly [RegExp, string]> = [
  // URLs inside text lose their query string first, so the rest never sees it.
  [/(\bhttps?:\/\/[^\s"'<>?#]+|\B\/[\w./-]+)[?#][^\s"'<>]*/g, '$1'],
  [/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, '[redacted]'],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/g, '[redacted]'],
  [/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted]'],
  // Phone numbers, national ids, hospital numbers: runs of 7+ digits, with the usual separators.
  [/\+?\d[\d\s().-]{6,}\d/g, '[redacted]'],
  // Long opaque strings: keys, hashes, envelopes.
  [/\b(?=[A-Za-z0-9+/_=-]*\d)(?=[A-Za-z0-9+/_=-]*[A-Za-z])[A-Za-z0-9+/_=-]{32,}\b/g, '[redacted]'],
];

const MAX_TEXT = 300;

/**
 * Exception and log text is written by whoever threw it, and routinely
 * interpolates a name, a phone number, a query string or a token ("Patient
 * Ayen Deng not found", "failed for +2119…"). It cannot be allow-listed, so it
 * is scrubbed for the recognisable shapes and capped; the error type, stack
 * frames and route stay, which is what an operator debugs with.
 */
export function scrubText(value: string): string {
  let out = value;
  for (const [pattern, replacement] of SCRUBBERS) out = out.replace(pattern, replacement);
  return out.length > MAX_TEXT ? `${out.slice(0, MAX_TEXT)}…` : out;
}

function scrubHeaders(headers: unknown): void {
  if (!headers || typeof headers !== 'object') return;
  const h = headers as Record<string, unknown>;
  for (const k of Object.keys(h)) {
    if (SENSITIVE_HEADER.test(k)) h[k] = REDACTED;
    else if (/^(referer|referrer|origin|x-forwarded-url|x-original-url)$/i.test(k) && typeof h[k] === 'string') {
      h[k] = stripQuery(h[k] as string);
    }
  }
}

function scrubUrlFields(node: Record<string, unknown> | undefined): void {
  if (!node || typeof node !== 'object') return;
  for (const key of Object.keys(node)) {
    const v = node[key];
    if (typeof v !== 'string') continue;
    if (/(^|[._-])(url|uri|path|route|href|to|from|query|query_string|target)$/i.test(key)) {
      node[key] = /query/i.test(key) ? REDACTED : stripQuery(v);
    }
  }
}

function scrubException(event: Event): void {
  for (const ex of event.exception?.values ?? []) {
    if (typeof ex.value === 'string') ex.value = scrubText(ex.value);
    // Local variables captured per frame are arbitrary application state.
    for (const frame of ex.stacktrace?.frames ?? []) {
      if (frame && 'vars' in frame) delete (frame as { vars?: unknown }).vars;
    }
  }
  if (typeof event.message === 'string') event.message = scrubText(event.message);
  if (event.logentry) {
    if (typeof event.logentry.message === 'string') event.logentry.message = scrubText(event.logentry.message);
    if (event.logentry.params) delete (event.logentry as { params?: unknown }).params;
  }
}

/**
 * Sentry `beforeSend` hook. Removes:
 *
 *   • credentials in request headers — cookie, authorization, CSRF and any
 *     header named like a token, secret, key or session;
 *   • the query string from the request URL and from URLs in breadcrumbs, the
 *     transaction name and referrers (`?patientId=`, `?breakGlassReason=`);
 *   • identifying text in exception messages, log entries and breadcrumbs,
 *     and per-frame local variables;
 *   • the user's email, IP address and username (the id stays);
 *   • any nested `data` key matching the PHI patterns above (email, phone,
 *     dob, password*, nationalId, notes).
 *
 * Mutates and returns the event. Called for every captured event regardless
 * of severity. Returning `null` would drop the event entirely; we keep it so
 * operators still see the error, just without PHI attached.
 */
export function stripPHI<T extends Event = Event>(event: T): T {
  // 1. Credentials in headers — session JWT, CSRF token and bearer tokens are
  //    neither useful for debugging nor safe to ship.
  if (event.request?.headers && typeof event.request.headers === 'object') {
    scrubHeaders(event.request.headers);
  }

  // 2. Request URL, query string and cookies as separate fields.
  if (event.request) {
    const request = event.request as Record<string, unknown>;
    if (typeof request.url === 'string') request.url = stripQuery(request.url);
    if ('query_string' in request) request.query_string = REDACTED;
    if ('cookies' in request) request.cookies = REDACTED;
  }
  if (typeof event.transaction === 'string') event.transaction = stripQuery(event.transaction);

  // 3. Top-level request body, if any.
  if (event.request && 'data' in event.request) {
    scrubObject(event.request.data);
  }

  // 4. Exception, message and log text; the user.
  scrubException(event);
  if (event.user) {
    delete event.user.email;
    delete event.user.ip_address;
    delete event.user.username;
  }

  // 5. Per-event `extra` and `contexts.*` blobs (where captureException
  //    attaches the ctx argument).
  if (event.extra) scrubObject(event.extra);
  if (event.contexts) scrubObject(event.contexts);

  // 6. Breadcrumbs: data payloads, URLs and message text.
  if (Array.isArray(event.breadcrumbs)) {
    for (const b of event.breadcrumbs) {
      if (!b || typeof b !== 'object') continue;
      if (b.data) {
        scrubUrlFields(b.data as Record<string, unknown>);
        scrubObject(b.data);
      }
      if (typeof b.message === 'string') b.message = scrubText(b.message);
    }
  }

  return event;
}

/**
 * Sentry `beforeSendTransaction` hook. A transaction is a performance trace,
 * not an error, so it never went through `beforeSend` and carried the full
 * request (URL with query, headers) and every span's URL and attributes.
 * Same policy as `stripPHI`, plus the spans.
 */
export function stripPHITransaction<T extends Event = Event>(event: T): T {
  stripPHI(event);
  const spans = (event as { spans?: Array<Record<string, unknown>> }).spans;
  if (Array.isArray(spans)) {
    for (const span of spans) {
      if (typeof span.description === 'string') span.description = scrubText(stripQuery(span.description));
      if (span.data && typeof span.data === 'object') {
        scrubUrlFields(span.data as Record<string, unknown>);
        // `http.url`, `url.full`, `http.query` use dotted keys the pattern above reads as suffixes.
        for (const key of Object.keys(span.data as object)) {
          if (/query/i.test(key)) (span.data as Record<string, unknown>)[key] = REDACTED;
        }
        scrubObject(span.data);
      }
    }
  }
  const traceData = (event.contexts?.trace as { data?: Record<string, unknown> } | undefined)?.data;
  if (traceData) {
    scrubUrlFields(traceData);
    for (const key of Object.keys(traceData)) if (/query/i.test(key)) traceData[key] = REDACTED;
  }
  return event;
}

/**
 * Exposed for tests — the canonical PHI key list. The operations doc
 * references this same set.
 */
export const __PHI_KEY_PATTERNS_FOR_TESTING = PHI_KEY_PATTERNS;
