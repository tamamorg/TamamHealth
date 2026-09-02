/**
 * System Administration config — per-organization overrides for the
 * apps/extensions/global-properties registry (src/lib/admin/system-admin-registry.ts).
 *
 * The registry is the shipped DEFAULT catalog (what apps/extensions exist,
 * their default enabled/disabled state, and each global property's default
 * value). This service stores the org's OVERRIDES on top of those defaults —
 * a toggle flipped off, a property edited — in one doc per organization.
 *
 * Storage: reuses the already-synced, org-scoped `tamamhealth_hospitals`
 * database (same trick as facility-settings.ts: a distinctly-typed doc
 * living alongside `hospital` docs needs no new sync-config entry, no new
 * CouchDB security-role wiring, and replicates to every device in the org
 * for free). Doc id is `system-config:<orgId>` so it never collides with a
 * `hosp-*` hospital doc or a `facility_settings:<hospitalId>` doc.
 */
import { hospitalsDB } from '../db';
import type { BaseDoc } from '../db-types';
import { logAuditSafe } from './audit-service';

export interface SystemConfigDoc extends BaseDoc {
  type: 'system_config';
  orgId: string;
  /** appId -> enabled override (absent = use the registry default). */
  appOverrides: Record<string, boolean>;
  /** extensionId -> enabled override (absent = use the registry default). */
  extensionOverrides: Record<string, boolean>;
  /** globalPropertyId (also reused for a few "configurable" app/extension
   *  notes that have no dedicated settings page) -> current string value
   *  override (absent = use the registry default/currentValue). */
  propertyOverrides: Record<string, string>;
}

export function systemConfigId(orgId: string): string {
  return `system-config:${orgId}`;
}

export function subscribeSystemConfig(orgId: string, onChange: () => void): () => void {
  const id = systemConfigId(orgId);
  let feed: { cancel: () => void } | null = null;
  try {
    feed = hospitalsDB().changes({ since: 'now', live: true, include_docs: false })
      .on('change', (change: { id?: string }) => { if (change.id === id) onChange(); })
      .on('error', () => { /* best effort */ }) as unknown as { cancel: () => void };
  } catch { feed = null; }
  return () => { try { feed?.cancel(); } catch { /* noop */ } };
}

function emptyConfig(orgId: string): SystemConfigDoc {
  const now = new Date().toISOString();
  return {
    _id: systemConfigId(orgId),
    type: 'system_config',
    orgId,
    appOverrides: {},
    extensionOverrides: {},
    propertyOverrides: {},
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Configuration scope for a platform operator, who belongs to no organization.
 *
 * `super_admin` accounts carry no `orgId` — that is what makes them
 * cross-tenant. System administration keyed everything off `orgId` alone, so
 * for the one role whose actual job is platform configuration the console
 * loaded nothing and every toggle answered "No organization on this account."
 * A scope of its own gives the platform its own configuration document,
 * separate from any tenant's.
 */
export const PLATFORM_CONFIG_SCOPE = 'platform';

/**
 * Which configuration document this session reads and writes.
 *
 * An organization always wins when there is one — a super-admin acting inside
 * a tenant configures that tenant, not the platform. Only a platform operator
 * with no organization falls back to the platform scope, and every other role
 * gets an empty scope rather than an invented one, so a nurse cannot be handed
 * platform configuration by an accident of ordering.
 */
export function systemConfigScope(orgId: string | undefined, role: string | undefined): string {
  if (orgId) return orgId;
  return role === 'super_admin' ? PLATFORM_CONFIG_SCOPE : '';
}

/** Read the org's config doc, or a fresh (unsaved) empty one if none exists yet. */
export async function getSystemConfig(orgId: string): Promise<SystemConfigDoc> {
  if (!orgId) return emptyConfig('');
  try {
    const doc = await hospitalsDB().get(systemConfigId(orgId)) as SystemConfigDoc;
    // Defensive defaults in case an older doc predates one of the maps.
    return {
      ...doc,
      appOverrides: doc.appOverrides || {},
      extensionOverrides: doc.extensionOverrides || {},
      propertyOverrides: doc.propertyOverrides || {},
    };
  } catch {
    return emptyConfig(orgId);
  }
}

async function saveSystemConfig(
  orgId: string,
  patch: Partial<Pick<SystemConfigDoc, 'appOverrides' | 'extensionOverrides' | 'propertyOverrides'>>,
  actorId: string | undefined,
  actorUsername: string | undefined,
  auditDetail: string,
): Promise<SystemConfigDoc> {
  const db = hospitalsDB();
  const existing = await getSystemConfig(orgId);
  const now = new Date().toISOString();
  const updated: SystemConfigDoc = {
    ...existing,
    appOverrides: { ...existing.appOverrides, ...(patch.appOverrides || {}) },
    extensionOverrides: { ...existing.extensionOverrides, ...(patch.extensionOverrides || {}) },
    propertyOverrides: { ...existing.propertyOverrides, ...(patch.propertyOverrides || {}) },
    updatedAt: now,
  };
  const resp = await db.put(updated);
  updated._rev = resp.rev;
  await logAuditSafe('system_config_updated', actorId, actorUsername, auditDetail);
  return updated;
}

/** Flip an app's enabled/disabled state for this org. Persists immediately. */
export async function setAppEnabled(
  orgId: string,
  appId: string,
  enabled: boolean,
  actorId?: string,
  actorUsername?: string,
): Promise<SystemConfigDoc> {
  return saveSystemConfig(
    orgId,
    { appOverrides: { [appId]: enabled } },
    actorId, actorUsername,
    `${enabled ? 'Enabled' : 'Disabled'} app "${appId}"`,
  );
}

/** Flip an extension's enabled/disabled state for this org. Persists immediately. */
export async function setExtensionEnabled(
  orgId: string,
  extensionId: string,
  enabled: boolean,
  actorId?: string,
  actorUsername?: string,
): Promise<SystemConfigDoc> {
  return saveSystemConfig(
    orgId,
    { extensionOverrides: { [extensionId]: enabled } },
    actorId, actorUsername,
    `${enabled ? 'Enabled' : 'Disabled'} extension "${extensionId}"`,
  );
}

/** Set the current value of a global property (or a "configurable" item's
 *  inline note) for this org. Persists immediately. */
export async function setPropertyValue(
  orgId: string,
  propertyId: string,
  value: string,
  actorId?: string,
  actorUsername?: string,
): Promise<SystemConfigDoc> {
  return saveSystemConfig(
    orgId,
    { propertyOverrides: { [propertyId]: value } },
    actorId, actorUsername,
    `Updated property "${propertyId}"`,
  );
}
