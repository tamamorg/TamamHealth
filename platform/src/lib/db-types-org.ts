/**
 * Organization (Multi-Tenant) & platform-wide configuration.
 */
import type { BaseDoc } from './db-types';

export interface OrganizationDoc extends BaseDoc {
  type: 'organization';
  name: string;
  slug: string;
  logoUrl?: string;
  primaryColor: string;
  secondaryColor: string;
  accentColor?: string;
  subscriptionStatus: 'trial' | 'active' | 'suspended' | 'cancelled';
  subscriptionPlan: 'basic' | 'professional' | 'enterprise';
  maxUsers: number;
  maxHospitals: number;
  featureFlags: {
    epidemicIntelligence: boolean;
    mchAnalytics: boolean;
    dhis2Export: boolean;
    aiClinicalSupport: boolean;
    communityHealth: boolean;
    facilityAssessments: boolean;
  };
  orgType: 'public' | 'private';
  contactEmail: string;
  country: string;
  isActive: boolean;
  /** Screen lock timeout in minutes (default 1). Set by org admin. */
  lockTimeoutMinutes?: number;
  /** App language for this organization's facilities. Set by org admin / hospital head. */
  locale?: string;
  /**
   * Free-text, multi-line bank-transfer instructions shown to patients in the
   * payment portals (bank name / account number / branch / reference
   * instructions). When unset, the portals fall back to a "contact billing"
   * placeholder rather than displaying a fabricated account. Set by the org
   * admin on the branding page.
   */
  bankDetails?: string;
}

export interface PlatformConfigDoc extends BaseDoc {
  /**
   * When a backup was last reported as completed (KAN-117).
   *
   * Written by the backup job through `recordBackupCompleted`, never by the
   * UI. Absent means no backup has been reported — which the status service
   * reports as `unknown`, NOT as overdue or healthy.
   */
  lastBackupAt?: string;

  type: 'platform_config';
  platformName: string;
  maintenanceMode: boolean;
  globalFeatureFlags: {
    signupsEnabled: boolean;
    trialDays: number;
    maxOrganizations: number;
  };
  defaultPrimaryColor: string;
  defaultSecondaryColor: string;
  superAdminPolicies?: {
    mfaRequired: boolean;
    passwordMinLength: number;
    sessionTimeoutMinutes: number;
    emergencyAccessEnabled: boolean;
    emergencyAccessReviewHours: number;
    impersonationEnabled: boolean;
    impersonationMaxMinutes: number;
    dualApprovalForHighRisk: boolean;
    auditRetentionYears: number;
    phiExportRequiresReason: boolean;
    dataDeletionRequiresApproval: boolean;
    ssoEnabled: boolean;
    apiKeysEnabled: boolean;
    backupRpoHours: number;
    backupRtoHours: number;
    supportAccessRequiresTicket: boolean;
  };
}
