/**
 * Manager override: who may approve a waiver or adjustment for someone else.
 *
 * Pure, so the server route, the service guard and the tests share one rule.
 * Separation of duties: the approver is a different, real staff member in the
 * same organisation and facility (org-level roles cover every facility of the
 * org), holding an approver role.
 */
import type { UserRole } from '@/lib/db-types';
import { WAIVER_APPROVERS } from '@/lib/sync/write-permissions';

export type OverrideRefusal = 'self' | 'role' | 'org' | 'facility';

export interface OverrideParty {
  id: string;
  role: string;
  orgId?: string;
  hospitalId?: string;
  facilityIds?: string[];
}

/** Roles with no home facility: their approval covers every facility in the org. */
const ORG_LEVEL_APPROVERS: readonly string[] = ['super_admin', 'org_admin'];

export function overrideRefusal(approver: OverrideParty, requester: OverrideParty): OverrideRefusal | null {
  if (!approver.id || approver.id === requester.id) return 'self';
  if (!WAIVER_APPROVERS.includes(approver.role as UserRole)) return 'role';
  if (approver.role !== 'super_admin' && requester.orgId && approver.orgId !== requester.orgId) return 'org';
  if (!ORG_LEVEL_APPROVERS.includes(approver.role) && requester.hospitalId) {
    const covers = approver.hospitalId === requester.hospitalId || (approver.facilityIds ?? []).includes(requester.hospitalId);
    if (!covers) return 'facility';
  }
  return null;
}

/** Plain refusal text, safe to show to the cashier. */
export const OVERRIDE_REFUSAL_MESSAGE: Record<OverrideRefusal, string> = {
  self: 'You cannot approve your own waiver. Ask another manager.',
  role: 'This person cannot approve waivers. Ask a manager or administrator.',
  org: 'This person works for a different organisation. Ask a manager here.',
  facility: 'This person works at a different facility. Ask a manager here.',
};

/** What a verified override records on the waiver, adjustment or payment. */
export interface ManagerApproval {
  approvedBy: string;
  approvedByName: string;
  approvedByRole: string;
  approvedAt: string;
  /** Server signature over this approval (approval-token.ts). The device cannot mint one. */
  approvalToken?: string;
}
