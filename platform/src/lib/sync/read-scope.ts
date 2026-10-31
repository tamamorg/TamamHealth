/**
 * Server-side read scoping for org-scoped databases.
 *
 * `facility-entitlements.ts` says in its own header that the replication
 * selector is supplied by the client, so a modified client can ask for
 * everything its organisation holds. The gateway is the only path between a
 * browser and CouchDB, so it applies the SAME entitlement here, on the
 * server, to every read it forwards:
 *
 *   - `_changes` and `_find` are rewritten to carry the selector, so CouchDB
 *     never emits another facility's documents (or their ids);
 *   - `_all_docs`, `_bulk_get` and single-document reads are checked document
 *     by document before they are returned (`canReadFacilityDoc`).
 *
 * The rule is `replicationSelector` / `documentMatchesEntitlement`, with one
 * difference: types in `FACILITY_EXEMPT_TYPES` are organisation-wide (reference
 * data, personal templates) and are not narrowed by a facility field they
 * happen to carry. `patient_transfer` is exempt for WRITES (a relationship
 * rule, enforced elsewhere) but is not exempt for reads: it names both
 * hospitals (`fromHospitalId` / `toHospitalId`) and each of them is entitled
 * through that field, which is what keeps inter-hospital transfers working
 * without exposing every transfer in the organisation.
 *
 * Why the change feed is safe to narrow. A device's checkpoint advances past
 * everything the feed did not emit, so a document wrongly withheld is
 * withheld for good. Three facts keep that from happening:
 *   1. The selector is evaluated against the CURRENT revision on every
 *      change. A patient who later visits this user's facility
 *      (`lastVisitHospital`) is rewritten, gets a new sequence number, and is
 *      emitted then. Shared care therefore arrives when it becomes shared.
 *   2. The server's entitlement is derived from the live user record
 *      (`getAuthPayload`), the same record the client's selector is built
 *      from, and the server is never behind it. The client AND-s its own
 *      selector, so when the two disagree the device receives the
 *      intersection, and a device whose selector changes starts from a new
 *      checkpoint (PouchDB keys checkpoints on the selector).
 *   3. Tombstones are always returned (`documentMatchesEntitlement`).
 */
import { FACILITY_EXEMPT_TYPES } from './write-permissions';
import {
  documentMatchesEntitlement,
  entitlementFor,
  replicationSelector,
  type FacilityEntitlement,
} from './facility-entitlements';
import { mergeSelector } from './participant-scope';
import type { UserRole } from '../db-types';

/** Organisation-wide for reads. */
const READ_EXEMPT_TYPES: readonly string[] = [
  // `patient_transfer` is judged by its two hospitals, and a task carries a
  // patient and a result, so it stays with its facility.
  ...FACILITY_EXEMPT_TYPES.filter(type => type !== 'patient_transfer' && type !== 'clinician_task'),
  // Chat follows its participants, not the facility it started in: a refusal
  // here reads as "you left this group" on a clinician who moved hospitals.
  'conversation', 'message',
];

type Doc = Record<string, unknown>;

export interface ReadScopeUser {
  role?: string;
  actualRole?: string;
  orgId?: string;
  hospitalId?: string;
  facilityIds?: string[];
}

/** What this session may read. The real account decides, not a borrowed role. */
export function readEntitlementFor(user: ReadScopeUser): FacilityEntitlement {
  return entitlementFor({
    role: (user.actualRole || user.role) as UserRole | undefined,
    orgId: user.orgId,
    hospitalId: user.hospitalId,
    facilityIds: user.facilityIds,
  });
}

/**
 * The selector CouchDB evaluates for this user. Always constrains the
 * organisation; adds the facility rule unless the role is organisation-wide.
 */
export function facilityReadSelector(entitlement: FacilityEntitlement): Record<string, unknown> {
  // An entitlement with no organisation constrains nothing by org and, for a
  // facility user, nothing by type either. The gateway never builds one (an
  // org-scoped database is only resolved for a session with an org), but if it
  // did, match nothing rather than everything.
  if (!entitlement.orgId) return { _id: { $exists: false } };
  const orgPart = replicationSelector({ orgId: entitlement.orgId, facilityIds: [], allFacilities: true })!;
  if (entitlement.allFacilities) return orgPart;
  const facilityPart = replicationSelector({ facilityIds: entitlement.facilityIds, allFacilities: false })!;
  return {
    $and: [orgPart, { $or: [{ type: { $in: READ_EXEMPT_TYPES } }, facilityPart] }],
  };
}

/** Whether a fetched document may be returned to this user. */
export function canReadFacilityDoc(entitlement: FacilityEntitlement, doc: unknown): boolean {
  if (!doc || typeof doc !== 'object') return true;
  const value = doc as Doc;
  if (value._deleted === true) return true;
  if (!entitlement.orgId) return false;
  if (typeof value.type === 'string' && READ_EXEMPT_TYPES.includes(value.type)) {
    return documentMatchesEntitlement(value, { ...entitlement, allFacilities: true });
  }
  return documentMatchesEntitlement(value, entitlement);
}

export interface ReadRewrite {
  /** A POST body to send upstream in place of the client's. */
  body?: unknown;
  /** Set when the request must be refused. */
  error?: string;
  /** `_all_docs` was forced to return bodies so they could be checked; strip them again. */
  stripDocs?: boolean;
}

/**
 * Narrow a read to `selector` before CouchDB runs it.
 *
 * `_changes` and `_find` carry the selector. `_all_docs` is forced to
 * `include_docs` so each row can be judged on its document (a bare id listing
 * names records too), and the bodies are removed again afterwards when the
 * client did not ask for them. Anything the gateway cannot narrow is refused.
 */
export function scopeReadRequest(
  selector: Record<string, unknown>,
  searchParams: URLSearchParams,
  pathAfterDatabase: string[],
  parsed: unknown,
  upstream: URL,
): ReadRewrite {
  const endpoint = pathAfterDatabase[0] || '';
  const clientBody = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  if (endpoint === '_changes') {
    const filter = searchParams.get('filter');
    if (filter && filter !== '_selector') return { error: 'Only selector-filtered change feeds are available for this database.' };
    upstream.searchParams.set('filter', '_selector');
    return { body: { ...clientBody, selector: mergeSelector(clientBody.selector, selector) } };
  }
  if (endpoint === '_find') {
    return { body: { ...clientBody, selector: mergeSelector(clientBody.selector, selector) } };
  }
  if (endpoint === '_all_docs') {
    const asked = searchParams.get('include_docs') === 'true' || clientBody.include_docs === true;
    upstream.searchParams.set('include_docs', 'true');
    return {
      stripDocs: !asked,
      ...(parsed && typeof parsed === 'object' ? { body: { ...clientBody, include_docs: true } } : {}),
    };
  }
  return {};
}

/** Remove the bodies `scopeReadRequest` forced onto an `_all_docs` response. */
export function stripAllDocsBodies(payload: unknown): unknown {
  const rows = (payload as { rows?: unknown } | null)?.rows;
  if (!Array.isArray(rows)) return payload;
  return {
    ...(payload as object),
    rows: rows.map(row => {
      if (!row || typeof row !== 'object') return row;
      const { doc: _doc, ...rest } = row as Record<string, unknown>;
      void _doc;
      return rest;
    }),
  };
}

/* ───────────────────────── bulk-read audit throttle ───────────────────────── */

const AUDIT_WINDOW_MS = 10 * 60_000;
const recentAudits = new Map<string, number>();

/**
 * Whether an audit row for this (user, kind) is due. Replication polls every
 * ~15 s across ~76 databases, so an audit row per read would bury the log; one
 * row per window still shows who pulled or dumped what, and when.
 */
export function auditDue(key: string, now = Date.now()): boolean {
  const last = recentAudits.get(key);
  if (last !== undefined && now - last < AUDIT_WINDOW_MS) return false;
  if (recentAudits.size > 5_000) {
    for (const [k, at] of recentAudits) if (now - at >= AUDIT_WINDOW_MS) recentAudits.delete(k);
    if (recentAudits.size > 5_000) recentAudits.clear();
  }
  recentAudits.set(key, now);
  return true;
}

export function _resetAuditThrottleForTest(): void {
  recentAudits.clear();
}

/**
 * Reads that name a whole database rather than follow a checkpoint: a query,
 * a full listing, or a change feed from the beginning (a device's first sync,
 * or someone replaying it). Routine polling resumes from a `since` and is not
 * one of these.
 */
export function bulkReadKind(endpoint: string, searchParams: URLSearchParams, parsed: unknown): 'listing' | 'query' | 'initial_pull' | null {
  if (endpoint === '_all_docs') return 'listing';
  if (endpoint === '_find') return 'query';
  if (endpoint === '_changes') {
    const since = searchParams.get('since') ?? (parsed as { since?: unknown } | null)?.since;
    if (since === undefined || since === null || since === '' || since === '0' || since === 0) return 'initial_pull';
  }
  return null;
}
