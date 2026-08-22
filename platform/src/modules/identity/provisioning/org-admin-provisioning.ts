/**
 * Pure helpers behind the "create an administrator for this organization"
 * step on Super-admin → Organizations (src/app/(dashboard)/admin/organizations/page.tsx).
 *
 * When a super_admin creates a new organization, the create form can
 * optionally provision that organization's first `org_admin` account in the
 * same step — collapsing what used to be two trips (create the org, then
 * separately visit /admin/users) into one. This module only holds the
 * decision logic (validation + payload shaping); the actual write goes
 * through the existing `createUser()` in `lib/services/user-service.ts` so it
 * gets the same central-provisioning path (POST /api/users,
 * `mustChangePassword: true` set server-side) as every other admin-created
 * account. No new write path is introduced here.
 */

import type { UserRole } from '@/lib/db-types';

export const ORG_ADMIN_MIN_PASSWORD_LENGTH = 8;

export interface OrgAdminFormData {
  name: string;
  username: string;
  /** Optional — createUser() does not require an email. */
  email: string;
  password: string;
}

export const emptyOrgAdminForm: OrgAdminFormData = { name: '', username: '', email: '', password: '' };

export type OrgAdminFormErrorCode = 'required' | 'password-too-short';

/**
 * Validate the admin sub-form before the organization is created — this runs
 * BEFORE the org write so a trivial typo (empty username, short password)
 * never leaves an organization behind with no admin attempt at all. Returns
 * an error code (the caller maps it to a localized message) or `null` when
 * the form is ready to submit.
 */
export function validateOrgAdminForm(form: OrgAdminFormData): OrgAdminFormErrorCode | null {
  if (!form.name.trim() || !form.username.trim() || !form.password) return 'required';
  if (form.password.length < ORG_ADMIN_MIN_PASSWORD_LENGTH) return 'password-too-short';
  return null;
}

/** The shape `createUser()` (lib/services/user-service.ts) expects. */
export interface OrgAdminUserPayload {
  name: string;
  username: string;
  password: string;
  role: UserRole;
  orgId: string;
  email?: string;
}

/**
 * Build the createUser() payload for a new organization's first admin.
 * Role is always `org_admin`, scoped to the organization that was just
 * created — never editable from this form, since that is the entire point
 * of this shortcut (a platform-level or cross-tenant role here would be a
 * privilege-escalation bug, not a convenience).
 */
export function buildOrgAdminUserPayload(form: OrgAdminFormData, orgId: string): OrgAdminUserPayload {
  return {
    name: form.name.trim(),
    username: form.username.trim(),
    password: form.password,
    role: 'org_admin',
    orgId,
    email: form.email.trim() || undefined,
  };
}
