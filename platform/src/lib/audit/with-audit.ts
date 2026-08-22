/**
 * `withAuditLog` — a thin route-handler decorator that emits exactly one
 * audit row for every state-changing API call. Lives next to the existing
 * `audit-service.ts` so the two stay reviewed together.
 *
 * The platform already has `logAudit(action, userId, username, details,
 * success)`; the gap this fills is *consistency*. Some mutation routes
 * called it, many didn't. Wrapping every POST/PUT/PATCH/DELETE handler
 * removes the question of whether a developer remembered to log.
 *
 * Design choices:
 *   - The audit write is fire-and-forget. The wrapper never lets a logging
 *     failure surface to the caller — a CouchDB hiccup must not 500 a
 *     real clinical write. Wrapped in try/catch and `void`-cast.
 *   - Read methods (GET/HEAD/OPTIONS) bypass the wrapper entirely. PHI
 *     access on those routes should call `logDataAccess` from the route
 *     itself; otherwise we'd flood the log with reads.
 *   - Unauthenticated requests still log. Failed-auth attempts on a
 *     mutation endpoint are exactly the kind of thing an auditor wants to
 *     see — recorded with `username='anonymous'` and the eventual 401.
 *   - Handler exceptions still log: we record `success=false` and rethrow
 *     so the caller's error path runs unchanged.
 *   - Naming convention: `<resource>.<verb>` lower-case dot-separated, e.g.
 *     `patient.create`, `lab.update`. Picked from the route file path at
 *     migration time — see `docs/security/audit-logging.md`.
 *
 * Opt-out: simply don't wrap a route. The exempt list (auth endpoints,
 * read-only public routes, patient-portal, sync) is documented and lives
 * in the migration record, not in code.
 */
import type { NextRequest, NextResponse } from 'next/server';
import { getAuthPayload } from '@/modules/identity';
import { logAudit } from '@/lib/services/audit-service';

/**
 * Next.js passes a route context whose shape depends on whether the route
 * has dynamic segments and which Next.js version is in use (`{ params: { id }
 * }` in 14.0–14.1, `{ params: Promise<{ id }> }` from 15+). The decorator
 * doesn't dispatch on context shape — it just passes it through to the
 * underlying handler — so we type the parameter as `any` here. This keeps
 * the wrapped export's type identical to the original handler (`T`),
 * which is what Next.js's per-route type-check expects.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type RouteHandler = (request: NextRequest, ctx?: any) => Promise<NextResponse>;

export type AuditCategory = 'CREATE' | 'UPDATE' | 'DELETE' | 'EXPORT' | 'OTHER';

/**
 * Response header a handler may set to name what it ACTUALLY did.
 *
 * `/api/users` is one route serving six verbs, so a fixed action name recorded
 * every deletion, reset and deactivation as `user.create`. The audit trail
 * then held one accurate row (written by the service layer) and one wrong one
 * per event, and an auditor reading the wrapper's rows would conclude accounts
 * were created at the moment they were destroyed.
 *
 * The wrapper cannot work the verb out for itself: the request body has
 * already been consumed by the handler, and reading it twice is not possible.
 * So the handler says so on the way out, and the wrapper strips the header
 * before the response leaves — it is an internal channel, not an API.
 */
export const AUDIT_ACTION_HEADER = 'x-audit-action';

export interface AuditOptions {
  /** Logical action name, e.g. 'patient.create', 'lab.result.update'. Required.
   *  A handler may override it per-request via `AUDIT_ACTION_HEADER`. */
  action: string;
  /** Optional resource extractor — pulls the resource id from the request for the log. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  resourceId?: (request: NextRequest, ctx?: any) => string | undefined;
  /** Default: read off request.method (POST → CREATE, PUT/PATCH → UPDATE, DELETE → DELETE). */
  category?: AuditCategory;
}

/** Methods that *don't* mutate state and are skipped by the wrapper. */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Map an HTTP method to a default audit category. */
function defaultCategory(method: string): AuditCategory {
  switch (method.toUpperCase()) {
    case 'POST': return 'CREATE';
    case 'PUT':
    case 'PATCH': return 'UPDATE';
    case 'DELETE': return 'DELETE';
    default: return 'OTHER';
  }
}

/**
 * Pull a path-only string off a NextRequest URL. Falls back to '' if the URL
 * isn't parseable (shouldn't happen in practice; defensive).
 */
function extractPath(request: NextRequest): string {
  try {
    return new URL(request.url).pathname;
  } catch {
    /* istanbul ignore next -- defensive: NextRequest URL is always parseable */
    return '';
  }
}

/**
 * Fire-and-forget audit write. Swallows every error — the caller never
 * sees logging failures. Marked async so the underlying `logAudit` promise
 * is consumed (avoids unhandled-rejection warnings) but we never await it
 * from the request path.
 */
function emitAudit(
  action: string,
  userId: string | undefined,
  username: string,
  details: Record<string, unknown>,
  success: boolean,
): void {
  try {
    void logAudit(action, userId, username, JSON.stringify(details), success).catch(() => {
      // logAudit is itself fault-tolerant, but defensive double-catch in
      // case the wrapper is invoked before the service module is fully
      // initialised (e.g. during test mocking).
    });
  } catch {
    // Synchronous throw from logAudit (very unlikely — JSON.stringify or
    // module-init error). Never propagate.
  }
}

export function withAuditLog<T extends RouteHandler>(handler: T, opts: AuditOptions): T {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const wrapped = (async (request: NextRequest, ctx?: any) => {
    const method = request.method?.toUpperCase() || 'GET';

    // Safe methods bypass the wrapper. Routes that need to record PHI
    // access on a read should call `logDataAccess` directly.
    if (SAFE_METHODS.has(method)) {
      return handler(request, ctx);
    }

    const start = Date.now();
    const path = extractPath(request);
    const auth = await getAuthPayload(request).catch(() => null);
    const resourceId = opts.resourceId ? (() => {
      try {
        return opts.resourceId!(request, ctx);
      } catch {
        // Resource extractors are user-supplied lambdas; never let them
        // break the request.
        return undefined;
      }
    })() : undefined;

    const userId = auth?.sub;
    const username = auth?.username || 'anonymous';
    const category = opts.category || defaultCategory(method);
    // When a super-admin is signed in AS another role, record the real account
    // role so impersonated actions are a filterable class in the audit trail
    // (the acting identity — sub/username — is already the real account).
    const impersonation = auth?.actualRole ? { actualRole: auth.actualRole } : {};

    let response: NextResponse;
    let success = false;
    let status = 500;
    // Overridden below when the handler names the verb it actually performed.
    let action = opts.action;
    try {
      response = await handler(request, ctx);
      status = response.status;
      success = status < 400;
      const declared = response.headers.get(AUDIT_ACTION_HEADER);
      if (declared) {
        action = declared;
        response.headers.delete(AUDIT_ACTION_HEADER);
      }
      return response;
    } catch (err) {
      // Handler threw — record the failure, then rethrow so the caller's
      // error path (Next.js's own 500 page, Sentry, etc.) runs as before.
      emitAudit(action, userId, username, {
        method,
        path,
        resourceId,
        status: 500,
        durationMs: Date.now() - start,
        category,
        error: err instanceof Error ? err.name : 'UnknownError',
        ...impersonation,
      }, false);
      throw err;
    } finally {
      // Only emit on the success/non-throw path here — the catch above
      // already emitted on throw. We use a sentinel: if we got here via
      // throw, `response` is undefined and we skip.
      // (Set in the try block; left undefined on throw.)
      if (response! !== undefined) {
        emitAudit(action, userId, username, {
          method,
          path,
          resourceId,
          status,
          durationMs: Date.now() - start,
          category,
          ...impersonation,
        }, success);
      }
    }
  }) as T;

  return wrapped;
}
