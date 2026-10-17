/**
 * Which side of a referral a caller is on.
 *
 * `filterByScope` only answers "can this caller SEE the referral" -- and both
 * the sending and the receiving side can. Accepting (which re-homes the
 * patient) and acknowledging are RECEIVER actions; cancelling is a SENDER
 * action. Letting a caller who merely sees their own outbound referral accept
 * it is how a cross-tenant patient takeover worked, so the routes check the
 * side explicitly with these pure helpers.
 */
import type { UserRole } from './db-types';
import { entitlementFor } from './sync/facility-entitlements';

export interface ReferralPartyAuth {
  sub?: string;
  role: string;
  orgId?: string;
  hospitalId?: string;
  facilityIds?: string[];
}

export interface ReferralPartyDoc {
  orgId?: string;
  toOrgId?: string;
  fromHospitalId?: string;
  toHospitalId?: string;
  referredBy?: string;
}

function isPlatformRole(auth: ReferralPartyAuth): boolean {
  return auth.role === 'super_admin' || auth.role === 'government';
}

/** True when the caller works at / administers the referral's DESTINATION. */
export function isReceivingSide(auth: ReferralPartyAuth, referral: ReferralPartyDoc): boolean {
  if (isPlatformRole(auth)) return true;
  if (!auth.orgId) return false;
  // toOrgId is only stamped when the destination org differs from the sender's.
  const destinationOrg = referral.toOrgId ?? referral.orgId;
  if (destinationOrg !== auth.orgId) return false;
  const entitlement = entitlementFor({ ...auth, role: auth.role as UserRole });
  if (entitlement.allFacilities) return true;
  return !!referral.toHospitalId && entitlement.facilityIds.includes(referral.toHospitalId);
}

/** True when the caller is on the SENDING side (their facility or org raised it). */
export function isSendingSide(auth: ReferralPartyAuth, referral: ReferralPartyDoc): boolean {
  if (isPlatformRole(auth)) return true;
  if (!auth.orgId || referral.orgId !== auth.orgId) return false;
  const entitlement = entitlementFor({ ...auth, role: auth.role as UserRole });
  if (entitlement.allFacilities) return true;
  return !!referral.fromHospitalId && entitlement.facilityIds.includes(referral.fromHospitalId);
}

/** Referral status changes that only the receiving side may make. */
const RECEIVER_STATUSES = new Set(['received', 'seen', 'completed']);

/** The side required for a status transition: 'receiver', 'sender', or null for an unknown status. */
export function sideForStatus(status: string): 'receiver' | 'sender' | null {
  if (RECEIVER_STATUSES.has(status)) return 'receiver';
  if (status === 'cancelled' || status === 'sent') return 'sender';
  return null;
}
