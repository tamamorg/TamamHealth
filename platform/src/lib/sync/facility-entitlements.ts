/**
 * Facility entitlements and the replication selector (KAN-95).
 *
 * ## The problem
 *
 * Facility-level PHI separation was enforced entirely on the client. The
 * replication filter in `sync-service.ts` was a **JavaScript function running
 * in the browser**, and it filtered on `orgId` only — there was no facility
 * condition at all. So every user in an organisation replicated every
 * facility's PHI onto their device, and `filterByScope` hid it at render time.
 *
 * The UI hid it; the data was present. Anyone with access to the device's local
 * database could read other facilities' patients.
 *
 * ## What this changes, and what it does not
 *
 * The filter becomes a CouchDB **selector**, which is evaluated SERVER-SIDE in
 * the `_changes` feed. Non-entitled documents are therefore never sent and
 * never land in the local replica. That closes the threat the ticket actually
 * describes — device compromise, or anyone inspecting the local database.
 *
 * It is NOT a complete authorization boundary, and this distinction matters
 * enough to state plainly: **CouchDB has no per-document read ACL.** A selector
 * is supplied by the client, so an authenticated user who modifies the client
 * can ask for everything the database holds. The only true read boundary in
 * CouchDB is the database itself, via `_security`. Reaching the ticket's full
 * intent therefore requires partitioning into per-facility databases — see
 * `docs/FACILITY-ISOLATION.md`. This module is the entitlement model that
 * migration will also need, and it removes the bulk exposure in the meantime.
 *
 * Being precise about that gap is the point. Treating this as "done" would
 * leave a confidentiality failure behind a control that looks complete.
 */

import type { UserRole } from '../db-types';

// Only these records may be global when an older/reference document has no
// orgId. Clinical and operational documents without a tenant are malformed
// and must not be copied to a user's device as a convenient fallback.
const GLOBAL_NO_ORG_TYPES = ['organization', 'platform_config'] as const;

// Documents use different names for their owning facility across modules. The
// selector must cover the same fields as data-scope.ts or replication can
// leak a document before the UI has a chance to hide it.
const FACILITY_FIELDS = [
  'hospitalId',
  'facilityId',
  'registrationHospital',
  'lastVisitHospital',
  'fromHospitalId',
  'toHospitalId',
  'recipientHospitalId',
] as const;

function noFacilityTieSelector(): Record<string, unknown> {
  return {
    $and: FACILITY_FIELDS.map(field => ({ [field]: { $exists: false } })),
  };
}

/**
 * Roles entitled to read across every facility in their organisation.
 *
 * Deliberately short. Each entry is a decision to let that role hold other
 * facilities' PHI on their device, so it should be defensible one name at a
 * time rather than by category.
 */
export const MULTI_FACILITY_ROLES: readonly UserRole[] = [
  'super_admin',
  'org_admin',
  // Clinical and operational oversight across an organisation's facilities.
  'medical_superintendent',
  'hospital_manager',
  // Public-health roles report on facilities they do not work in.
  'county_health_director',
  'government',
];

export interface FacilityEntitlement {
  orgId?: string;
  /** Facilities this user may replicate. Empty means "all in the org". */
  facilityIds: string[];
  /** True when the user is entitled to the whole organisation. */
  allFacilities: boolean;
}

/**
 * What a user is entitled to replicate.
 *
 * `allFacilities` is explicit rather than being inferred from an empty list at
 * each call site — "no facilities" and "every facility" are opposite answers,
 * and an empty array has been read as both in code like this before.
 */
export function entitlementFor(user: {
  role?: UserRole;
  orgId?: string;
  hospitalId?: string;
  /**
   * Extra facilities granted beyond the user's home facility.
   *
   * NOT YET POPULATED in production: there is no per-user multi-facility grant
   * field on the user record, so today this is always empty and cross-facility
   * access comes from `MULTI_FACILITY_ROLES` alone. The parameter exists
   * because the ticket requires explicit entitlements, and wiring the selector
   * to read them now means adding the field later is a data change rather than
   * another pass over the replication path.
   */
  facilityIds?: string[];
} | null | undefined): FacilityEntitlement {
  if (!user) {
    // No user means no entitlement. Returning "all" here would make a logged-out
    // or half-initialised client replicate the entire organisation.
    return { facilityIds: [], allFacilities: false };
  }

  if (user.role && MULTI_FACILITY_ROLES.includes(user.role)) {
    return { orgId: user.orgId, facilityIds: [], allFacilities: true };
  }

  const explicit = user.facilityIds ?? [];
  const home = user.hospitalId ? [user.hospitalId] : [];
  const facilityIds = [...new Set([...home, ...explicit])];

  return { orgId: user.orgId, facilityIds, allFacilities: false };
}

/**
 * The CouchDB selector for a replication.
 *
 * Returns `undefined` when there is nothing to constrain, so the caller can
 * omit the option entirely rather than passing a selector that matches
 * everything (which reads as an intentional "allow all" in a log).
 *
 * Documents with no `hospitalId` are always included: reference data,
 * organisation records and configuration are not facility PHI, and excluding
 * them would break every screen. The same rule already applies to `orgId`.
 */
export function replicationSelector(
  entitlement: FacilityEntitlement,
): Record<string, unknown> | undefined {
  const conditions: Record<string, unknown>[] = [];

  if (entitlement.orgId) {
    conditions.push({
      $or: [
        { orgId: entitlement.orgId },
        // Only explicitly global reference/config docs may lack orgId.
        {
          $and: [
            { orgId: { $exists: false } },
            { type: { $in: GLOBAL_NO_ORG_TYPES } },
          ],
        },
      ],
    });
  }

  if (!entitlement.allFacilities) {
    if (entitlement.facilityIds.length === 0) {
      // Entitled to nothing: replicate only non-facility documents. This is
      // fail-CLOSED on purpose — a user whose facility is unknown must not
      // fall through to receiving everything.
      conditions.push(noFacilityTieSelector());
    } else {
      conditions.push({
        $or: [
          ...FACILITY_FIELDS.map(field => ({ [field]: { $in: entitlement.facilityIds } })),
          noFacilityTieSelector(),
        ],
      });
    }
  }

  if (conditions.length === 0) return undefined;
  return conditions.length === 1 ? conditions[0] : { $and: conditions };
}
