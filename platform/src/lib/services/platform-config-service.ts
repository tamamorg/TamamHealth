import { platformConfigDB } from '../db';
import type { PlatformConfigDoc } from '../db-types';
import { BRAND_PRIMARY, BRAND_SECONDARY } from '../theme-colors';

const CONFIG_ID = 'platform-config';

const DEFAULT_CONFIG: Omit<PlatformConfigDoc, '_id' | '_rev' | 'createdAt' | 'updatedAt'> = {
  type: 'platform_config',
  platformName: 'TamamHealth',
  maintenanceMode: false,
  globalFeatureFlags: {
    signupsEnabled: true,
    trialDays: 30,
    maxOrganizations: 100,
  },
  defaultPrimaryColor: BRAND_PRIMARY,
  defaultSecondaryColor: BRAND_SECONDARY,
  superAdminPolicies: {
    passwordMinLength: 12,
    sessionTimeoutMinutes: 15,
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
  },
};

export async function getPlatformConfig(): Promise<PlatformConfigDoc> {
  const db = platformConfigDB();
  try {
    return await db.get(CONFIG_ID) as PlatformConfigDoc;
  } catch (error) {
    // Only a genuine miss should create the singleton. Authentication,
    // storage, and other read failures must remain visible to the caller.
    if ((error as { status?: number }).status !== 404) throw error;

    const now = new Date().toISOString();
    const doc: PlatformConfigDoc = {
      ...DEFAULT_CONFIG,
      _id: CONFIG_ID,
      createdAt: now,
      updatedAt: now,
    };
    try {
      const resp = await db.put(doc);
      doc._rev = resp.rev;
      return doc;
    } catch (putError) {
      // React StrictMode can run both initializers together, and replication
      // can land the singleton between our get and put. In either case the
      // 409 means another writer won, so return the winning revision.
      if ((putError as { status?: number }).status === 409) {
        return await db.get(CONFIG_ID) as PlatformConfigDoc;
      }
      throw putError;
    }
  }
}

export async function updatePlatformConfig(
  data: Partial<Omit<PlatformConfigDoc, '_id' | '_rev' | 'type' | 'createdAt'>>,
  actorId?: string,
  actorUsername?: string
): Promise<PlatformConfigDoc> {
  const db = platformConfigDB();
  const existing = await getPlatformConfig();

  const updated: PlatformConfigDoc = {
    ...existing,
    ...data,
    _id: existing._id,
    _rev: existing._rev,
    updatedAt: new Date().toISOString(),
  };

  const resp = await db.put(updated);
  updated._rev = resp.rev;
  const { logAudit } = await import('./audit-service');
  await logAudit('platform_config_updated', actorId, actorUsername, 'Updated platform configuration', true);
  return updated;
}
