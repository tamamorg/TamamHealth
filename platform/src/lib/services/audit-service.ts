import { captureException } from '@/lib/observability';
import { auditLogDB, isClosingConnectionError } from '../db';
import type { AuditLogDoc } from '../db-types';
import { v4 as uuidv4 } from 'uuid';
import { findByType } from './db-query';
import { filterByScope, type DataScope } from './data-scope';

export async function logAuditSafe(...args: Parameters<typeof logAudit>): Promise<void> {
  try {
    await logAudit(...args);
  } catch (err) {
    // Don't break the caller's transaction, but make the loss visible
    // so monitoring can alert on '[AUDIT LOST]' patterns.
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[AUDIT LOST] ${args[0] || 'unknown'}: ${msg}`);
  }
}

/**
 * Who is acting, for the fields a write-audit row needs beyond the two its
 * callers pass.
 *
 * `logAudit` is called from ~75 places with an action, sometimes a user, and a
 * sentence. None of them passes an organisation — and the audit database is
 * organisation-scoped: the push filter drops a row whose `orgId` is not the
 * user's, and the server's validator would refuse it anyway. So every
 * write-audit row a browser produced ("history entry recorded", "note signed",
 * "message sent") stayed on the device that wrote it, was never seen by an
 * administrator, and was eventually trimmed by local retention. The trail
 * existed only where the person it records could erase it.
 *
 * The signed-in session knows the organisation, so it is recorded once here
 * (the dashboard layout sets it on sign-in and clears it on sign-out) instead
 * of threading a context argument through 75 call sites.
 */
export interface AuditActor {
  userId?: string;
  username?: string;
  /** The account's real role — not one borrowed through "sign in as". */
  role?: string;
  orgId?: string;
  hospitalId?: string;
}

let ambientActor: AuditActor | null = null;

/**
 * Record (or clear, with `null`) the signed-in user for write-audit rows.
 *
 * Browser only, and that is enforced: on the server this module is shared by
 * every request in the process, so an ambient actor there would stamp one
 * user's organisation onto another user's audit rows. Server callers pass an
 * explicit `context` to `logAudit` instead.
 */
export function setAuditActor(actor: AuditActor | null): void {
  if (typeof window === 'undefined') return;
  ambientActor = actor && (actor.userId || actor.orgId) ? { ...actor } : null;
}

/** Extra fields a caller can attach to a write-audit row. */
export type AuditContext = Pick<AuditLogDoc,
  'orgId' | 'hospitalId' | 'role' | 'patientId' | 'resourceType' | 'resourceId' | 'subjectUserId'>;

export async function logAudit(
  action: string,
  userId: string | undefined,
  username: string | undefined,
  details: string,
  success: boolean = true,
  context: Partial<AuditContext> = {},
): Promise<void> {
  try {
    const db = auditLogDB();
    const now = new Date().toISOString();
    const actor = typeof window === 'undefined' ? null : ambientActor;
    const doc: AuditLogDoc = {
      _id: `audit-${uuidv4()}`,
      type: 'audit_log',
      action,
      // The actor is whoever is signed in. Several callers pass the id of the
      // person the action concerns instead (the clinician a check-in was made
      // for, the doctor who certified a death) — filed as `userId`, that put
      // a front-desk action under a doctor's name. With a session, the
      // session is the actor and a different id from the caller is kept as
      // the subject. Without one (server code), the caller's word stands.
      userId: actor?.userId ?? userId,
      // The name follows the id. When the caller named someone other than
      // the signed-in user, their name is that person's too — keeping it
      // would pair the session's id with another person's name, and the audit
      // screen shows the name. Otherwise the caller's display name stands.
      username: actor && userId && userId !== actor.userId
        ? actor.username
        : (username ?? actor?.username),
      details,
      success,
      ...definedOnly({
        subjectUserId: context.subjectUserId
          ?? (actor?.userId && userId && userId !== actor.userId ? userId : undefined),
        // Organisation and facility come from ONE source: the caller's explicit
        // context when it names an organisation (server routes), otherwise the
        // signed-in session. Mixing them could pair one organisation with
        // another's facility.
        orgId: context.orgId ?? actor?.orgId,
        hospitalId: context.orgId ? context.hospitalId : (context.hospitalId ?? actor?.hospitalId),
        role: context.role ?? actor?.role,
        patientId: context.patientId,
        resourceType: context.resourceType,
        resourceId: context.resourceId,
      }),
      createdAt: now,
      updatedAt: now,
    };
    try {
      await db.put(doc);
    } catch (err) {
      // The cached auditLogDB() instance can be closed mid-write by a
      // concurrent background wipe (logout / session-expiry / device
      // handover — lib/security/local-wipe.ts), most commonly right after a
      // fast re-login on the same device. A fresh auditLogDB() call is
      // guaranteed to return a healthy instance — see isClosingConnectionError
      // in lib/db.ts — so retry once before falling through to the outer
      // catch's "never break the caller" handling.
      if (!isClosingConnectionError(err)) throw err;
      await auditLogDB().put(doc);
    }
  } catch (err) {
    // Never let audit logging failures break the main flow
    console.error('[Audit] Failed to write audit log:', err);
    captureException(err, { tag: '[Audit] Failed to write audit log:' });
  }
}

function definedOnly<T extends Record<string, unknown>>(fields: T): Partial<T> {
  return Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined && v !== '')) as Partial<T>;
}

/** Log a data access event for compliance tracking */
export async function logDataAccess(
  userId: string | undefined,
  username: string | undefined,
  resource: string,
  resourceId: string,
  action: 'VIEW' | 'CREATE' | 'UPDATE' | 'DELETE' | 'EXPORT'
): Promise<void> {
  await logAudit(
    `DATA_${action}`,
    userId,
    username,
    `${action} ${resource}: ${resourceId}`
  );
}

/**
 * One person's activity, newest first.
 *
 * The account page could show who someone IS and never what they had DONE:
 * the only reader on this store was `getRecentAuditLogs`, which answers "what
 * happened lately" across everyone. An access review asks the opposite —
 * "what did this account do" — and there was no way to ask it.
 *
 * Matches on `userId`, falling back to `username` for older rows written
 * before the id was carried. Both are compared exactly; a partial match here
 * would fold two accounts with similar names into one person's history, which
 * is the one mistake an access review must not make.
 */
export async function getAuditLogsForUser(
  user: { id?: string; username?: string },
  limit: number = 50,
): Promise<AuditLogDoc[]> {
  const { id, username } = user;
  // No identifier means no history — returning "everyone" here would report
  // the whole platform's activity as one account's.
  if (!id && !username) return [];
  const db = auditLogDB();
  const docs = await findByType<AuditLogDoc>(db, 'audit_log');
  const mine = docs.filter(d =>
    (id !== undefined && d.userId === id)
    || (username !== undefined && d.userId === undefined && d.username === username));
  mine.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  return mine.slice(0, limit);
}

/**
 * The platform-wide audit trail, newest first.
 *
 * `scope` is optional only to avoid a breaking signature change; every real
 * caller must supply one. Fails closed like `getAuditLogsForUser`: no scope
 * means the caller cannot establish who is asking, so nothing is returned
 * rather than the whole platform's activity. `super_admin` and `government`
 * are the only roles that see every org's rows unscoped — that escape hatch
 * lives in `filterByScope` itself (its own early return), not duplicated
 * here, so the two stay in lockstep. Every other role is filtered exactly
 * like any other org-scoped read. Write-audit rows carry the signed-in
 * session's `orgId` (see `setAuditActor`); rows written before that, and rows
 * from server code that passed no context, carry none and stay visible only to
 * the platform roles.
 */
export async function getRecentAuditLogs(limit: number = 50, scope?: DataScope): Promise<AuditLogDoc[]> {
  const db = auditLogDB();
  const docs = await findByType<AuditLogDoc>(db, 'audit_log');
  /* istanbul ignore next -- defensive null-safety in sort comparator */
  docs.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  if (!scope) return [];
  const visible = filterByScope(docs, scope);
  return visible.slice(0, limit);
}

// ── PHI read auditing (KAN-97) ───────────────────────────────────────────
//
// Writes were audited; reads were not. There was no record of who opened which
// patient chart, viewed which lab result, or read which prescription — which
// fails the basic accountability expectation for an EMR and is usually the
// first thing asked for after a suspected privacy breach.
//
// ## Known limitation, stated explicitly
//
// **Reads served from the offline PouchDB replica are NOT audited.** The
// platform is offline-first: a clinician's browser holds a local replica and
// most chart views are satisfied from it without any server round-trip. There
// is nowhere to intercept those reads that the user could not also bypass,
// and an audit log written client-side into a database the user controls is
// not evidence of anything.
//
// What IS audited is every read that crosses the API boundary. Treat the read
// log as complete for server-served access and silent for local replica reads,
// rather than as a complete record of all PHI viewing. Closing that gap needs
// the CouchDB-side access controls in KAN-95 — per-facility replication means
// the server can log what it *replicates* to a device even when it cannot see
// each individual chart open.

export interface PhiReadContext {
  userId?: string;
  username?: string;
  role?: string;
  orgId?: string;
  hospitalId?: string;
  /** API route the read came through, e.g. '/api/lab'. */
  route?: string;
}

/**
 * Record a read of one patient's PHI.
 *
 * Fire-and-forget by design — callers should not await this on the response
 * path. A failed audit write must never turn a clinician's chart open into an
 * error, and `logAudit` already swallows its own failures.
 */
export async function logPhiRead(
  ctx: PhiReadContext,
  resourceType: string,
  opts: { patientId?: string; resourceId?: string; resultCount?: number } = {},
): Promise<void> {
  await writeReadEntry('PHI_READ', ctx, {
    resourceType,
    patientId: opts.patientId,
    resourceId: opts.resourceId,
    resultCount: opts.resultCount,
    details:
      `Read ${resourceType}` +
      (opts.resourceId ? ` ${opts.resourceId}` : '') +
      (opts.patientId ? ` for patient ${opts.patientId}` : ''),
  });
}

/**
 * Record a SEARCH or list read as a single entry.
 *
 * Deliberately one entry per query rather than one per result row: a registry
 * search returning 400 patients would otherwise write 400 audit rows, which
 * both drowns the log and makes the retention cost scale with browsing rather
 * than with actual access. The query and the result count together are what an
 * access review needs — "this user searched for 'Deng' and saw 43 records".
 */
export async function logPhiSearch(
  ctx: PhiReadContext,
  resourceType: string,
  opts: { query?: string; resultCount: number },
): Promise<void> {
  await writeReadEntry('PHI_SEARCH', ctx, {
    resourceType,
    query: opts.query,
    resultCount: opts.resultCount,
    details:
      `Searched ${resourceType}` +
      (opts.query ? ` for "${opts.query}"` : ' (unfiltered list)') +
      ` — ${opts.resultCount} record(s)`,
  });
}

async function writeReadEntry(
  action: 'PHI_READ' | 'PHI_SEARCH',
  ctx: PhiReadContext,
  fields: Partial<AuditLogDoc> & { details: string },
): Promise<void> {
  try {
    const db = auditLogDB();
    const now = new Date().toISOString();
    const doc: AuditLogDoc = {
      _id: `audit-${uuidv4()}`,
      type: 'audit_log',
      action,
      userId: ctx.userId,
      username: ctx.username,
      role: ctx.role,
      orgId: ctx.orgId,
      hospitalId: ctx.hospitalId,
      route: ctx.route,
      success: true,
      createdAt: now,
      updatedAt: now,
      ...fields,
    } as AuditLogDoc;
    try {
      await db.put(doc);
    } catch (err) {
      // Same race as logAudit's retry above — retry once against a fresh
      // connection before falling through to the outer catch.
      if (!isClosingConnectionError(err)) throw err;
      await auditLogDB().put(doc);
    }
  } catch (err) {
    // Same posture as logAudit: never break the read path over the log.
    console.error('[Audit] Failed to write PHI read log:', err);
    captureException(err, { tag: '[Audit] Failed to write PHI read log:' });
  }
}
