'use client';

import { useState, useEffect, useCallback } from 'react';
import type { OrganizationDoc } from '../db-types';
import { makeCoalescer } from './live-reload';
import { organizationsDB } from '../db';
import { useApp } from '../context';

export function useOrganizations(enabled = true) {
  const [organizations, setOrganizations] = useState<OrganizationDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { currentUser } = useApp();
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
      setError('Failed to load organizations');
    } finally {
      setLoading(false);
    }
  }, [enabled, orgId, role]);

  useEffect(() => { loadOrganizations(); }, [loadOrganizations]);

  // Live PouchDB subscription — reflect writes arriving from sync/other tabs.
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const reload = makeCoalescer(() => { if (!cancelled) loadOrganizations(); });
    const changes = organizationsDB().changes({ since: 'now', live: true, include_docs: false })
      .on('change', () => reload.trigger())
      .on('error', () => { /* transient feed errors; next load resyncs */ });
    return () => {
      cancelled = true;
      reload.cancel();
      try { changes.cancel(); } catch { /* noop */ }
    };
  }, [enabled, loadOrganizations]);

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
    loading, error, create, update, deactivate, restore, purge, getStats,
    reload: loadOrganizations,
  };
}
