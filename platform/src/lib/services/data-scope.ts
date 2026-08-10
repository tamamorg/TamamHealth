import type { UserRole } from '../db-types';

/**
 * Document `type`s that are legitimately stored WITHOUT any hospital field and
 * are meant to be visible org-wide (or platform-wide) to every user. These are
 * reference/configuration records, not facility-scoped operational data:
 *   - 'organization'    — the tenant org record itself
 *   - 'hospital'        — facility directory (users pick/see other facilities)
 *   - 'platform_config' — global platform settings + service-price catalog
 * Any other no-hospital doc is only allowed through on an orgId match (see the
 * hospital-scoping rule below), which keeps genuinely shared org data (e.g.
 * announcements, disease alerts/surveillance) visible without leaking it across
 * tenants.
 */
const GLOBAL_NO_HOSPITAL_TYPES = new Set([
  'organization',
  'hospital',
  'platform_config',
]);

/**
 * National/government roles that operate above any single facility. Their
 * `user` account docs carry no hospitalId, so under the old "no hospital field"
 * fallback they leaked into every facility's staff directory. These accounts
 * must never be surfaced as facility staff to hospital-scoped users.
 */
const NATIONAL_ROLES = new Set<UserRole>([
  'super_admin',
  'government',
  'county_health_director',
]);

export interface DataScope {
  orgId?: string;
  hospitalId?: string;
  payam?: string;
  county?: string;
  state?: string;
  role: UserRole;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function filterByScope<T extends Record<string, any>>(
  docs: T[],
  scope: DataScope
): T[] {
  // Super admin and national government see everything
  if (scope.role === 'super_admin' || scope.role === 'government') return docs;

  // A tenant is the minimum authorization context for every other role. A
  // missing orgId must fail closed; otherwise the later facility fallback can
  // return hospital-less documents from every tenant to a partially-created
  // or stale session.
  if (!scope.orgId) return [];

  // Everyone else is filtered by orgId
  let filtered = docs;
  if (scope.orgId) {
    // Require orgId match — reject docs without orgId for data isolation.
    //
    // `toOrgId` is the one deliberate exception (KAN-101). A referral's `orgId`
    // is the SENDING org, and this filter runs before the hospital filter
    // below — so a referral sent across an organisational boundary was
    // invisible to the receiving org entirely. The referring clinician saw a
    // sent referral that the receiver would never get.
    //
    // Narrow by construction: `toOrgId` is only set by `createReferral` when
    // the destination org genuinely differs, so no other document type can
    // widen its own visibility through this branch. The receiving org still
    // has to pass the facility filter below, which already matches on
    // `toHospitalId` — so this grants sight of referrals addressed to that
    // org's facilities, not of the sending org's data in general.
    filtered = filtered.filter(d => d.orgId === scope.orgId || d.toOrgId === scope.orgId);
  }

  // Non-admin roles that have a hospitalId are further scoped
  const ADMIN_ROLES: UserRole[] = ['super_admin', 'org_admin', 'government'];
  if (!ADMIN_ROLES.includes(scope.role) && scope.hospitalId) {
    const hospId = scope.hospitalId;
    filtered = filtered.filter(d => {
      const matches =
        d.hospitalId === hospId ||
        d.registrationHospital === hospId ||
        d.lastVisitHospital === hospId ||
        d.fromHospitalId === hospId ||
        d.toHospitalId === hospId ||
        d.recipientHospitalId === hospId ||
        d.facilityId === hospId;
      if (matches) return true;

      // No-hospital docs: tightened to close the cross-facility leak where ANY
      // hospital-less record was visible to EVERY scoped user. A doc whose only
      // facility tie is recipientHospitalId (inbound messages) is hospital-tied,
      // not org-wide — without this check it fell through to the org fallback
      // and was visible to every facility in the org.
      const noHospital =
        !d.hospitalId && !d.registrationHospital && !d.facilityId &&
        !d.recipientHospitalId && !d.fromHospitalId;
      if (!noHospital) return false;

      // (a) Genuinely global reference types (organization/hospital/
      //     platform_config) stay visible regardless of org so users can see
      //     the facility directory and platform config.
      if (typeof d.type === 'string' && GLOBAL_NO_HOSPITAL_TYPES.has(d.type)) {
        return true;
      }

      // (b) National-role user accounts (super_admin/government/
      //     county_health_director) must NOT appear as facility staff — they
      //     have no hospitalId and previously leaked into every directory.
      if (d.type === 'user' && NATIONAL_ROLES.has(d.role as UserRole)) {
        return false;
      }

      // (c) Otherwise keep the no-hospital doc only when it belongs to the same
      //     org (when both orgIds are present). This preserves legitimate
      //     org-wide data (announcements, surveillance, generic records) while
      //     blocking cross-tenant leakage. Docs lacking orgId already failed the
      //     earlier orgId filter, so this is conservative — favouring not hiding
      //     data over strictness when the org can't be compared.
      if (scope.orgId && d.orgId && d.orgId !== scope.orgId) return false;
      return true;
    });
  }

  return filtered;
}

/**
 * Build a DataScope from a JWT auth payload (used by API routes).
 */
export function buildScopeFromAuth(auth: {
  role: string;
  orgId?: string;
  hospitalId?: string;
  payam?: string;
  county?: string;
  state?: string;
}): DataScope {
  return {
    role: auth.role as UserRole,
    orgId: auth.orgId,
    hospitalId: auth.hospitalId,
    payam: auth.payam,
    county: auth.county,
    state: auth.state,
  };
}
