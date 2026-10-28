'use client';

import { useTranslation } from '../i18n/useTranslation';
import { useState, useCallback } from 'react';
import type { OrganizationDoc } from '../db-types';
import { usePouchLiveReload } from './usePouchLiveReload';
import { organizationsDB } from '../db';
import { useAuth } from '../context';

export function useOrganizations(enabled = true) {
  const [organizations, setOrganizations] = useState<OrganizationDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { t } = useTranslation();
  const { currentUser } = useAuth();
  const role = currentUser?.role;
  const orgId = currentUser?.orgId;

  const loadOrganizations = useCallback(async () => {
    if (!enabled) {
      setOrganizations([]);
      setError(null);
      setLoading(false);
      return;
    }
    try {
      setError(null);
      const { getAllOrganizations } = await import('../services/organization-service');
      const data = await getAllOrganizations();
      // The organizations database is shared reference data and can contain
      // every tenant. The API returns a scoped answer when online; enforce the
      // same boundary on the offline fallback instead of exposing the whole
      // replica to an org/facility role.
      const visible = role === 'super_admin' || role === 'government'
        ? data
        : orgId
          ? data.filter(organization => organization._id === orgId)
          : [];
      setOrganizations(visible);
    } catch (err) {
      console.error(err);
      setError('msg.organizationsNotLoaded');
    } finally {
      setLoading(false);
    }
  }, [enabled, orgId, role]);

  // Live PouchDB subscription — reflect writes arriving from sync/other tabs.
  usePouchLiveReload({ load: loadOrganizations, database: organizationsDB, enabled });

  const create = useCallback(async (
    data: Omit<OrganizationDoc, '_id' | '_rev' | 'type' | 'createdAt' | 'updatedAt'>,
    actorId?: string, actorUsername?: string
  ) => {
    const { createOrganization } = await import('../services/organization-service');
    const org = await createOrganization(data, actorId, actorUsername);
    await loadOrganizations();
    return org;
  }, [loadOrganizations]);

  const update = useCallback(async (
    id: string,
    data: Partial<OrganizationDoc>,
    actorId?: string, actorUsername?: string
  ) => {
    const { updateOrganization } = await import('../services/organization-service');
    const org = await updateOrganization(id, data, actorId, actorUsername);
    await loadOrganizations();
    return org;
  }, [loadOrganizations]);

  const deactivate = useCallback(async (
    id: string,
    actorId?: string, actorUsername?: string
  ) => {
    const { deactivateOrganization } = await import('../services/organization-service');
    await deactivateOrganization(id, actorId, actorUsername);
    await loadOrganizations();
  }, [loadOrganizations]);

  const restore = useCallback(async (
    id: string,
    actorId?: string, actorUsername?: string
  ) => {
    const { restoreOrganization } = await import('../services/organization-service');
    await restoreOrganization(id, actorId, actorUsername);
    await loadOrganizations();
  }, [loadOrganizations]);

  /**
   * Permanent. The service refuses while the tenant still owns records, unless
   * `cascade` is set — then its facilities and staff accounts go with it.
   * Patients block the delete either way.
   */
  const purge = useCallback(async (
    id: string,
    actorId?: string, actorUsername?: string,
    options?: { cascade?: boolean },
  ) => {
    const { purgeOrganization } = await import('../services/organization-service');
    await purgeOrganization(id, actorId, actorUsername, options);
    await loadOrganizations();
  }, [loadOrganizations]);

  const getStats = useCallback(async (orgId: string) => {
    const { getOrganizationStats } = await import('../services/organization-service');
    return getOrganizationStats(orgId);
  }, []);

  /**
   * The tenants a console should show, and the ones in Trash.
   *
   * Deactivating a tenant takes it out of every list rather than leaving it in
   * place wearing a red chip: it is not something you are running any more, and
   * a roster that mixes the two makes every count on the page a question about
   * which kind it means. `trashed` is the Trash panel's list, and the only
   * place a deactivated tenant is visible.
   */
  const liveOrganizations = organizations.filter(o => o.isActive !== false);
  const trashedOrganizations = organizations.filter(o => o.isActive === false);

  return {
    organizations: liveOrganizations,
    trashedOrganizations,
    /** Every tenant, live and trashed — for callers that must not filter. */
    allOrganizations: organizations,
    loading, error: error && t(error), create, update, deactivate, restore, purge, getStats,
    reload: loadOrganizations,
  };
}
