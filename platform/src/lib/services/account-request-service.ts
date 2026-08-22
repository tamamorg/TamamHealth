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
  IDENTITY_ATTESTATION_METHODS, isValidAttestation, roleRequiresRegistrationNumber,
} from '../account-request-roles';
import { issueInvite, hashInviteToken, inviteHashMatches, isInviteExpired } from '../user-invite';
import { v4 as uuidv4 } from 'uuid';

// Re-exported so server callers have one import for the whole feature; the
// definitions live in a DB-free module the public form can also import.
export {
  PLATFORM_APPROVAL_ROLES, REQUESTABLE_ROLES, isRequestableRole, approverTierFor,
  IDENTITY_ATTESTATION_METHODS, isValidAttestation, roleRequiresRegistrationNumber,
};

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
  /** Council / board number for clinical roles — free text, human-checked. */
  professionalRegistrationNumber?: string;
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
export async function createAccountRequest(
  input: NewAccountRequest,
): Promise<{ doc: AccountRequestDoc; verificationToken: string }> {
  const fullName = clean(input.fullName, MAX_FIELD);
  const email = clean(input.email, MAX_FIELD);
  if (!fullName) throw new Error('Full name is required');
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('A valid email address is required');
  if (!isRequestableRole(input.requestedRole)) throw new Error('Choose a role from the list');

  const normalisedEmail = email.toLowerCase();

  // One open request per address. Without this the form is a queue-flooding
  // tool for anyone who can press a button ten times, and the rate limiter
  // only caps the rate — a person filling an approver's screen with ten
  // near-identical rows is inside it. Replacing rather than refusing keeps the
  // honest case working: someone who mistyped their role and submits again
  // should not be told to wait an hour.
  const db = accountRequestsDB();
  const existing = (await findByType<AccountRequestDoc>(db, 'account_request'))
    .filter(doc => doc.email === normalisedEmail && doc.status === 'pending');

  const invite = issueInvite();
  const now = new Date().toISOString();
  const doc: AccountRequestDoc = {
    _id: existing[0]?._id ?? `acctreq-${uuidv4()}`,
    ...(existing[0] ? { _rev: (existing[0] as AccountRequestDoc & { _rev?: string })._rev } : {}),
    type: 'account_request',
    fullName,
    email: normalisedEmail,
    phone: clean(input.phone, MAX_FIELD),
    requestedRole: input.requestedRole,
    orgId: clean(input.orgId, MAX_FIELD),
    orgName: clean(input.orgName, MAX_FIELD),
    hospitalId: clean(input.hospitalId, MAX_FIELD),
    hospitalName: clean(input.hospitalName, MAX_FIELD),
    note: clean(input.note, MAX_NOTE),
    professionalRegistrationNumber: clean(input.professionalRegistrationNumber, MAX_FIELD),
    approverTier: approverTierFor(input.requestedRole, clean(input.orgId, MAX_FIELD)),
    status: 'pending',
    // Unverified until the token below comes back. `listAccountRequests` hides
    // unverified rows, so approver attention is only ever spent on someone who
    // has at least proved they can read the mailbox they named.
    emailVerifiedAt: undefined,
    verificationTokenHash: invite.tokenHash,
    verificationExpiresAt: invite.expiresAt,
    createdAt: existing[0]?.createdAt ?? now,
    updatedAt: now,
  };

  await db.put(doc as unknown as PouchDB.Core.PutDocument<object>);
  return { doc, verificationToken: invite.token };
}

export type VerificationResult =
  | { ok: true; doc: AccountRequestDoc }
  | { ok: false; reason: 'not_found' | 'expired' | 'already_decided' };

/**
 * Redeem an email-verification token.
 *
 * Same construction as the account invitation in `lib/user-invite.ts`: a
 * random token, only its hash stored, single-use, expiring. Runs on an
 * UNAUTHENTICATED endpoint, so every failure answers identically to the
 * caller — the distinction here exists for the audit log, not the response.
 */
export async function verifyAccountRequestEmail(token: string): Promise<VerificationResult> {
  if (!token) return { ok: false, reason: 'not_found' };
  const db = accountRequestsDB();
  const candidate = hashInviteToken(token);
  const docs = await findByType<AccountRequestDoc>(db, 'account_request');
  const match = docs.find(doc =>
    doc.verificationTokenHash && inviteHashMatches(doc.verificationTokenHash, candidate));
  if (!match) return { ok: false, reason: 'not_found' };
  if (match.status !== 'pending') return { ok: false, reason: 'already_decided' };
  if (isInviteExpired(match.verificationExpiresAt)) return { ok: false, reason: 'expired' };

  const now = new Date().toISOString();
  const updated: AccountRequestDoc = {
    ...match,
    emailVerifiedAt: now,
    verificationTokenHash: undefined,
    verificationExpiresAt: undefined,
    updatedAt: now,
  };
  await db.put(updated as unknown as PouchDB.Core.PutDocument<object>);
  return { ok: true, doc: updated };
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
    // An unverified request is not yet a request anybody should act on: the
    // form is the one place someone outside the organisation can start a
    // process that ends in prescribing rights, and until the token comes back
    // every field in it is an unchecked claim about somebody else's mailbox.
    // Decided rows stay visible whatever their verification state, so the
    // history of what was granted is never silently pruned.
    if (doc.status === 'pending' && !doc.emailVerifiedAt) return false;
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
  // Same rule as the list: nobody decides a request whose email has not been
  // proved, so a guessed request id cannot route round the verification step.
  if (doc.status === 'pending' && !doc.emailVerifiedAt) return false;
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
  extra: { decisionNote?: string; createdUsername?: string; identityAttestation?: string } = {},
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
    identityAttestation: extra.identityAttestation,
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
