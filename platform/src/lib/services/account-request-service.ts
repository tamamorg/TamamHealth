/**
 * Account requests — the path from "I need access" to an account, without
 * anyone emailing a password around.
 *
 * The routing rule is the whole feature: a request is only ever shown to
 * someone who could already have created that account by hand. It mirrors the
 * guards in `/api/users` rather than restating them, so the two cannot drift
 * into disagreeing about who may grant what:
 *
 *   - Platform and national roles (`super_admin`, `government`,
 *     `county_health_director`) bypass org scoping in `filterByScope`, so only
 *     a platform operator may grant them. Requests for those go to
 *     `super_admin` alone.
 *   - Every other role is a tenant matter, so the request goes to the
 *     `org_admin` of the organisation the requester named.
 *   - A request naming no organisation has no tenant to route to, so it lands
 *     with `super_admin` for triage. Without this a request with a blank org
 *     would be visible to no one and simply rot.
 *
 * Nothing here trusts the requester. `approverTier` is derived on the server
 * from the requested role and org; if the client could set it, a requester
 * would pick their own approver.
 */

import { accountRequestsDB } from '../db';
import type { AccountRequestDoc, AccountRequestStatus, UserRole } from '../db-types';
import type { DataScope } from './data-scope';
import { findByType } from './db-query';
import {
  PLATFORM_APPROVAL_ROLES, REQUESTABLE_ROLES, isRequestableRole, approverTierFor,
} from '../account-request-roles';
import { v4 as uuidv4 } from 'uuid';

// Re-exported so server callers have one import for the whole feature; the
// definitions live in a DB-free module the public form can also import.
export { PLATFORM_APPROVAL_ROLES, REQUESTABLE_ROLES, isRequestableRole, approverTierFor };

export interface NewAccountRequest {
  fullName: string;
  email: string;
  phone?: string;
  requestedRole: UserRole;
  orgId?: string;
  orgName?: string;
  hospitalId?: string;
  hospitalName?: string;
  note?: string;
}

const MAX_NOTE = 1000;
const MAX_FIELD = 200;

function clean(value: string | undefined, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, max);
}

/**
 * Record a request. Callers are unauthenticated, so this validates shape and
 * nothing else — the approver is the check that matters.
 */
export async function createAccountRequest(input: NewAccountRequest): Promise<AccountRequestDoc> {
  const fullName = clean(input.fullName, MAX_FIELD);
  const email = clean(input.email, MAX_FIELD);
  if (!fullName) throw new Error('Full name is required');
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('A valid email address is required');
  if (!isRequestableRole(input.requestedRole)) throw new Error('Choose a role from the list');

  const orgId = clean(input.orgId, MAX_FIELD);
  const now = new Date().toISOString();
  const doc: AccountRequestDoc = {
    _id: `acctreq-${uuidv4()}`,
    type: 'account_request',
    fullName,
    email: email.toLowerCase(),
    phone: clean(input.phone, MAX_FIELD),
    requestedRole: input.requestedRole,
    orgId,
    orgName: clean(input.orgName, MAX_FIELD),
    hospitalId: clean(input.hospitalId, MAX_FIELD),
    hospitalName: clean(input.hospitalName, MAX_FIELD),
    note: clean(input.note, MAX_NOTE),
    approverTier: approverTierFor(input.requestedRole, orgId),
    status: 'pending',
    createdAt: now,
    updatedAt: now,
  };

  const db = accountRequestsDB();
  await db.put(doc as unknown as PouchDB.Core.PutDocument<object>);
  return doc;
}

/**
 * The requests a viewer may act on.
 *
 * Not `filterByScope`: that answers "may this role read this tenant's data",
 * which is necessary here but not sufficient. An org_admin passing the org
 * check must still never see a request for a national role that happens to
 * carry their orgId — approving it would grant a cross-tenant role. So the
 * tier is checked first and the org second, and both must hold.
 */
export async function listAccountRequests(
  scope: DataScope,
  opts: { status?: AccountRequestStatus } = {},
): Promise<AccountRequestDoc[]> {
  const db = accountRequestsDB();
  const docs = await findByType<AccountRequestDoc>(db, 'account_request');

  const visible = docs.filter(doc => {
    if (scope.role === 'super_admin') return true;
    if (scope.role !== 'org_admin') return false;
    if (doc.approverTier !== 'org_admin') return false;
    // Fail closed on a session without a tenant, matching filterByScope.
    if (!scope.orgId) return false;
    return doc.orgId === scope.orgId;
  });

  return visible
    .filter(doc => !opts.status || doc.status === opts.status)
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
}

/** Whether this viewer may decide this specific request. */
export function canDecide(scope: DataScope, doc: AccountRequestDoc): boolean {
  if (scope.role === 'super_admin') return true;
  if (scope.role !== 'org_admin') return false;
  if (doc.approverTier !== 'org_admin') return false;
  if (!scope.orgId) return false;
  return doc.orgId === scope.orgId;
}

export async function getAccountRequest(id: string): Promise<AccountRequestDoc | null> {
  try {
    const db = accountRequestsDB();
    return (await db.get(id)) as unknown as AccountRequestDoc;
  } catch {
    return null;
  }
}

/**
 * Record the outcome. Creating the account is the caller's job (the API route,
 * which owns the server-side `createUser` path); this only closes the request,
 * and refuses to close one twice so a double-click cannot mint two accounts.
 */
export async function recordDecision(
  id: string,
  decision: Exclude<AccountRequestStatus, 'pending'>,
  actor: { username: string; name?: string },
  extra: { decisionNote?: string; createdUsername?: string } = {},
): Promise<AccountRequestDoc> {
  const db = accountRequestsDB();
  const doc = (await db.get(id)) as unknown as AccountRequestDoc & { _rev: string };
  if (doc.status !== 'pending') {
    throw new Error(`This request was already ${doc.status}`);
  }
  const now = new Date().toISOString();
  const updated: AccountRequestDoc & { _rev: string } = {
    ...doc,
    status: decision,
    decidedBy: actor.username,
    decidedByName: actor.name,
    decidedAt: now,
    decisionNote: clean(extra.decisionNote, MAX_NOTE),
    createdUsername: extra.createdUsername,
    updatedAt: now,
  };
  await db.put(updated as unknown as PouchDB.Core.PutDocument<object>);
  return updated;
}

/**
 * A username derived from the person's name, e.g. "Mary Nyaboth" → "mary.nyaboth",
 * with a numeric suffix when taken. Matches the seeded convention (`dr.wani`,
 * `nurse.stella`) so an approved account looks like every other account.
 */
export function suggestUsername(fullName: string, taken: (name: string) => boolean): string {
  const base = fullName
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s.-]/g, '')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .join('.')
    .replace(/\.+/g, '.')
    .replace(/^\.|\.$/g, '');

  const seed = base || 'user';
  if (!taken(seed)) return seed;
  for (let n = 2; n < 1000; n++) {
    const candidate = `${seed}${n}`;
    if (!taken(candidate)) return candidate;
  }
  /* istanbul ignore next -- 998 collisions on one name is not a real state */
  throw new Error('Could not derive an available username');
}
