import { platformConfigDB } from '../db';
import type { PlatformConfigDoc } from '../db-types';
import { BRAND_PRIMARY, BRAND_SECONDARY } from '../theme-colors';
import {
  DEFAULT_FEATURE_CATALOG_CONFIG,
  TAMAM_FEATURE_IDS,
  normalizeFeatureCatalogConfig,
} from '@/modules/feature-catalog';

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
  featureCatalog: DEFAULT_FEATURE_CATALOG_CONFIG,
  defaultPrimaryColor: BRAND_PRIMARY,
  defaultSecondaryColor: BRAND_SECONDARY,
  superAdminPolicies: {
    passwordMinLength: 12,
    sessionTimeoutMinutes: 15,
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
  },
};

export async function getPlatformConfig(): Promise<PlatformConfigDoc> {
  const db = platformConfigDB();
  try {
    const stored = await db.get(CONFIG_ID) as PlatformConfigDoc;
    return {
      ...stored,
      featureCatalog: normalizeFeatureCatalogConfig(stored.featureCatalog),
    };
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
  const normalizedData = data.featureCatalog === undefined
    ? data
    : {
        ...data,
        featureCatalog: normalizeFeatureCatalogConfig(data.featureCatalog),
      };

  const updated: PlatformConfigDoc = {
    ...existing,
    ...normalizedData,
    _id: existing._id,
    _rev: existing._rev,
    updatedAt: new Date().toISOString(),
  };

  const resp = await db.put(updated);
  updated._rev = resp.rev;
  const { logAudit } = await import('./audit-service');
  if (data.featureCatalog !== undefined) {
    const before = normalizeFeatureCatalogConfig(existing.featureCatalog);
    const after = normalizeFeatureCatalogConfig(updated.featureCatalog);
    const stageChanges = TAMAM_FEATURE_IDS.flatMap(id => {
      const previous = before.cutovers[id] ?? 'default';
      const next = after.cutovers[id] ?? 'default';
      return previous === next ? [] : [`${id}: ${previous} -> ${next}`];
    });
    const changes = [
      ...(before.mode === after.mode ? [] : [`mode: ${before.mode} -> ${after.mode}`]),
      ...stageChanges,
    ];
    await logAudit(
      'feature_catalog_updated',
      actorId,
      actorUsername,
      changes.length > 0 ? `Updated Tamam capability rollout (${changes.join('; ')})` : 'Saved Tamam capability rollout without changes',
      true,
    );
  } else {
    await logAudit('platform_config_updated', actorId, actorUsername, 'Updated platform configuration', true);
  }
  return updated;
}
