import type { PlatformConfigDoc } from '@/lib/db-types';

/**
 * Platform governance policies: the single source for the defaults that
 * unspecified `config.superAdminPolicies` keys resolve to. Previously this
 * object lived unexported inside the retired SuperAdminControlCenter and was
 * hand-copied into /admin/security — two owners for one set of defaults.
 */
export type SuperAdminPolicies = NonNullable<PlatformConfigDoc['superAdminPolicies']>;

export const DEFAULT_POLICIES: SuperAdminPolicies = {
  passwordMinLength: 12,
  sessionTimeoutMinutes: 15,
  // Off by default, and deliberately: this value ships with every install, so
  // defaulting it on would mean nobody, anywhere, could switch off a lock
  // that no operator ever asked for. An operator who runs shared clinical
  // hardware turns it on and it becomes mandatory for everyone.
  screenLockRequired: false,
  emergencyAccessEnabled: true,
  emergencyAccessReviewHours: 24,
  impersonationEnabled: false,
  impersonationMaxMinutes: 30,
  dualApprovalForHighRisk: true,
  auditRetentionYears: 6,
  phiExportRequiresReason: true,
  dataDeletionRequiresApproval: true,
  ssoEnabled: false,
  apiKeysEnabled: false,
  backupRpoHours: 24,
  backupRtoHours: 8,
  supportAccessRequiresTicket: true,
};
