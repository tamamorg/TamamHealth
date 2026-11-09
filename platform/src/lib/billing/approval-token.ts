/**
 * Signed manager approval.
 *
 * `/api/auth/manager-override` checks the approver's password and used to hand
 * the cashier's device a plain object ("approvedBy: manager"). The device then
 * copied it onto the waiver, and nothing downstream could tell that object from
 * one the device typed itself. The route now also signs it: an HMAC (key
 * derived from the server's JWT secret, so it adds no new secret to manage)
 * over who approved, who asked, what it was for and how long it is good.
 *
 * The device stores the token on the waiver / adjustment / waived bill. It
 * cannot mint or change one without the secret. Two places check it:
 *
 *   - the sync gateway, for every NEW waiver, adjustment or human bill waiver
 *     (`moneyApprovalRefusal`), which refuses the write;
 *   - reconciliation (`reconcileMoneyApprovals`), which lists records already
 *     on the server whose token is missing or does not verify, for review.
 *
 * Server-only: it needs node:crypto and the secret. The password is never an
 * input here and neither the token secret nor a token is logged.
 */
import { createHmac } from 'node:crypto';
import { resolveJwtSecret } from '@/modules/identity/edge';
import type { ManagerApproval } from './manager-override-policy';

/** How long an approval is good for after the manager typed their password. */
export const APPROVAL_TTL_MS = 15 * 60 * 1000;
/** Slack for a device clock that differs from the server's. */
const CLOCK_SLACK_MS = 5 * 60 * 1000;

export interface ApprovalBinding {
  /** The person the approval was granted at the device of (the signed-in user). */
  requesterId: string;
  /** What it covers: the patient id (waiver payment, adjustment) or the bill id (waiving a bill). */
  subjectId: string;
  /** The amount approved, when the request named one. Bound in cents. */
  amount?: number;
}

interface TokenPayload {
  v: 1;
  by: string;
  role: string;
  at: string;
  req: string;
  sub: string;
  amt?: number;
  exp: number;
}

const b64u = (s: string) => Buffer.from(s, 'utf8').toString('base64url');

function key(secret?: string): string {
  // Domain-separated from the session tokens that share the secret.
  return createHmac('sha256', secret ?? resolveJwtSecret()).update('tamam:money-approval:v1').digest('hex');
}

/** Constant-time comparison of two equal-purpose strings. */
function sameString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function mac(body: string, secret?: string): string {
  return createHmac('sha256', key(secret)).update(body).digest('base64url');
}

const cents = (n: number) => Math.round(n * 100);

export function signApproval(approval: ManagerApproval, binding: ApprovalBinding, secret?: string, now = Date.now()): string {
  const payload: TokenPayload = {
    v: 1, by: approval.approvedBy, role: approval.approvedByRole, at: approval.approvedAt,
    req: binding.requesterId, sub: binding.subjectId,
    ...(typeof binding.amount === 'number' ? { amt: cents(binding.amount) } : {}),
    exp: now + APPROVAL_TTL_MS,
  };
  const body = b64u(JSON.stringify(payload));
  return `${body}.${mac(body, secret)}`;
}

function open(token: unknown, secret?: string): TokenPayload | null {
  if (typeof token !== 'string' || token.length > 2000) return null;
  const dot = token.indexOf('.');
  if (dot < 1) return null;
  const body = token.slice(0, dot);
  if (!sameString(token.slice(dot + 1), mac(body, secret))) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as TokenPayload;
    return p && p.v === 1 && typeof p.by === 'string' ? p : null;
  } catch {
    return null;
  }
}

export interface ApprovalClaim {
  token: unknown;
  approvedBy: unknown;
  approvedByRole: unknown;
  /** Who entered the record on the device. */
  requesterId: unknown;
  subjectId: unknown;
  amount?: unknown;
  /** When the record was written (its own timestamp), to be checked against the token's window. */
  writtenAt?: unknown;
}

/** True when the token is genuine and says what the record claims. */
export function approvalVerifies(claim: ApprovalClaim, secret?: string): boolean {
  const p = open(claim.token, secret);
  if (!p) return false;
  if (p.by !== claim.approvedBy || p.role !== claim.approvedByRole) return false;
  if (p.req !== claim.requesterId || p.sub !== claim.subjectId) return false;
  if (p.amt !== undefined && (typeof claim.amount !== 'number' || cents(claim.amount) !== p.amt)) return false;
  // The record must have been written inside the approval's window. The
  // record's own clock is the device's, so this bounds a replay, it does not
  // make one impossible: the same approval cannot be reused for another
  // patient, bill, amount or cashier, nor after it lapsed on an honest clock.
  const written = typeof claim.writtenAt === 'string' ? Date.parse(claim.writtenAt) : NaN;
  if (!Number.isFinite(written)) return false;
  if (written > p.exp + CLOCK_SLACK_MS) return false;
  if (written < Date.parse(p.at) - CLOCK_SLACK_MS) return false;
  return true;
}

type Doc = Record<string, unknown>;
const str = (v: unknown) => (typeof v === 'string' ? v : '');

/** The record's approval claim, by document kind; null when the document needs none. */
export function approvalClaimFor(doc: Doc): ApprovalClaim | null {
  if (doc.type === 'adjustment') {
    return { token: doc.approvalToken, approvedBy: doc.approvedBy, approvedByRole: doc.approvedByRole,
      requesterId: doc.createdBy, subjectId: doc.patientId, amount: doc.amount, writtenAt: doc.createdAt };
  }
  if (doc.type === 'payment' && doc.method === 'waiver') {
    return { token: doc.approvalToken, approvedBy: doc.approvedBy, approvedByRole: doc.approvedByRole,
      requesterId: doc.processedBy ?? doc.createdBy, subjectId: doc.patientId, amount: doc.amount, writtenAt: doc.processedAt ?? doc.createdAt };
  }
  if (doc.type === 'billing' && doc.status === 'waived') {
    return { token: doc.waiverApprovalToken, approvedBy: doc.waiverApprovedBy, approvedByRole: doc.waiverApprovedByRole,
      requesterId: doc.waivedBy, subjectId: doc._id, writtenAt: doc.waivedAt ?? doc.updatedAt };
  }
  return null;
}

/** An exempt visit: a bill created already waived, with a reason and no money on it. Owes no approver. */
export function isExemptCreation(doc: Doc): boolean {
  return doc.type === 'billing' && doc.status === 'waived' && !doc.waiverApprovedBy
    && str(doc.exemptReason).trim() !== '' && !(Number(doc.amountPaid) > 0)
    && !(Array.isArray(doc.payments) && doc.payments.length > 0);
}

/**
 * The gateway's verdict on one document in a push. `serverCopy` is what the
 * server already holds under that id (null when it holds none).
 * Returns a plain reason when the write must be refused, else null.
 */
export function moneyApprovalRefusal(doc: Doc, serverCopy: Doc | null, secret?: string): string | null {
  const needsApproval =
    doc.type === 'adjustment' || (doc.type === 'payment' && doc.method === 'waiver')
    || (doc.type === 'billing' && doc.status === 'waived');
  if (!needsApproval) return null;
  // A document the server already holds is replication repeating itself (or an
  // edit the validator judges); only the first write of an approval is checked,
  // except a bill the server holds un-waived: that is a human waiver, however
  // the incoming copy describes its ancestry.
  if (serverCopy) {
    const humanWaiver = doc.type === 'billing' && serverCopy.status !== 'waived';
    if (!humanWaiver) return null;
  } else if (isExemptCreation(doc)) {
    return null;
  }
  const claim = approvalClaimFor(doc);
  if (!claim || !approvalVerifies(claim, secret)) {
    return 'Approval not verified. The manager must approve it with their own password while online.';
  }
  return null;
}

export type ApprovalState = 'verified' | 'exempt' | 'not_verified';

/** Reconciliation: does a record already stored carry an approval that verifies? */
export function approvalState(doc: Doc, secret?: string): ApprovalState | null {
  const claim = approvalClaimFor(doc);
  if (!claim) return null;
  if (isExemptCreation(doc)) return 'exempt';
  return approvalVerifies(claim, secret) ? 'verified' : 'not_verified';
}

export interface UnverifiedApproval { id: string; type: string; approvedBy: string | null }

/** Lists waivers / adjustments whose approval is missing or forged: the "approval not verified" flag. */
export function reconcileMoneyApprovals(docs: Doc[], secret?: string): UnverifiedApproval[] {
  const out: UnverifiedApproval[] = [];
  for (const doc of docs) {
    if (approvalState(doc, secret) !== 'not_verified') continue;
    out.push({
      id: str(doc._id), type: str(doc.type),
      approvedBy: str(doc.approvedBy) || str(doc.waiverApprovedBy) || null,
    });
  }
  return out;
}
