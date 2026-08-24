'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import type { UserDoc, UserRole } from '../db-types';
import { useDataScope } from './useDataScope';
import { canReadStaffDirectory } from '@/modules/identity/client';
/**
 * How long a loaded staff directory stays fresh across tab switches.
 *
 * The directory changes when an administrator provisions or retires an
 * account — a few times a week, not a few times a minute. The visibility
 * refresh below used to refetch unconditionally, and the hook is mounted on
 * every page (MessagingDock lives in the dashboard shell), so a clinician
 * flicking between this tab and the lab system produced one full directory
 * fetch per return, indefinitely — measured at ~10 requests/minute on an
 * idle admin screen. Mutations still refresh immediately; only the "came
 * back to the tab" path is throttled.
 */
const DIRECTORY_FRESH_MS = 60_000;

export function useUsers(enabled = true) {
  const [users, setUsers] = useState<UserDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const lastLoadedAtRef = useRef(0);
  const inFlightRef = useRef(false);
  const scope = useDataScope();
  // The app shell mounts this hook for every signed-in role (MessagingDock),
  // but only some roles may read the directory. Without this check a front-desk
  // or cashier session fetched a guaranteed 403 from every consumer and again
  // on every tab focus, filling the console with "Forbidden" and the server log
  // with denied requests. `/api/users` still enforces the rule; this only stops
  // asking a question whose answer is already known.
  const mayRead = enabled && canReadStaffDirectory(scope?.role);

  const loadUsers = useCallback(async () => {
    if (!mayRead) {
      setUsers([]);
      setError(null);
      setLoading(false);
      return;
    }
    // One request at a time: several consumers mounting together (the dock
    // plus a page-level useUsers) must not each fire their own copy.
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      const { getAllUsers } = await import('@/modules/identity/services/user-service');
      const data = await getAllUsers(scope);
      setUsers(data);
      setError(null);
      lastLoadedAtRef.current = Date.now();
    } catch (err) {
      setError('Failed to load users');
      console.error(err);
    } finally {
      inFlightRef.current = false;
      setLoading(false);
    }
  }, [scope, mayRead]);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  // Staff identity is server-managed and deliberately excluded from browser
  // replication because user docs contain password/PIN hashes. Refresh when
  // the tab regains focus; mutations below also refresh immediately.
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - lastLoadedAtRef.current < DIRECTORY_FRESH_MS) return;
      void loadUsers();
    };
    document.addEventListener('visibilitychange', refresh);
    return () => document.removeEventListener('visibilitychange', refresh);
  }, [loadUsers]);

  const create = useCallback(async (data: {
    username: string;
    password: string;
    name: string;
    role: UserRole;
    /**
     * The owning tenant. Absent from this type until 2026-08-21, so callers
     * could not set it at all: creating an `org_admin` always 400'd, and a
     * facility role only got a tenant because the server back-infers one from
     * the assigned hospital.
     */
    orgId?: string;
    email?: string;
    hospitalId?: string;
    hospitalName?: string;
    photoUrl?: string;
    department?: string;
    specialty?: string;
    phone?: string;
  }, actorId?: string, actorUsername?: string) => {
    const { createUser } = await import('@/modules/identity/services/user-service');
    const user = await createUser(data, actorId, actorUsername);
    await loadUsers();
    return user;
  }, [loadUsers]);

  const update = useCallback(async (id: string, data: {
    name?: string;
    phone?: string;
    role?: UserRole;
    hospitalId?: string;
    hospitalName?: string;
    isActive?: boolean;
    /** `null` clears the photo back to initials. */
    photoUrl?: string | null;
    department?: string;
    specialty?: string;
  }, actorId?: string, actorUsername?: string) => {
    const { updateUser } = await import('@/modules/identity/services/user-service');
    const user = await updateUser(id, data, actorId, actorUsername);
    await loadUsers();
    return user;
  }, [loadUsers]);

  const resetPassword = useCallback(async (
    id: string,
    newPassword: string,
    actorId?: string,
    actorUsername?: string
  ) => {
    const { resetPassword: resetPw } = await import('@/modules/identity/services/user-service');
    await resetPw(id, newPassword, actorId, actorUsername);
  }, []);

  const deactivate = useCallback(async (
    id: string,
    actorId?: string,
    actorUsername?: string
  ) => {
    const { deactivateUser } = await import('@/modules/identity/services/user-service');
    await deactivateUser(id, actorId, actorUsername);
    await loadUsers();
  }, [loadUsers]);

  /**
   * Turn a login back on. Its own call, not `update({ isActive: true })`: the
   * generic update path re-validates the account's organization and hospital,
   * so re-activating someone whose org had since been deactivated failed on a
   * check that has nothing to do with restoring access.
   */
  const reactivate = useCallback(async (
    id: string,
    actorId?: string,
    actorUsername?: string
  ) => {
    const { reactivateUser } = await import('@/modules/identity/services/user-service');
    await reactivateUser(id, actorId, actorUsername);
    await loadUsers();
  }, [loadUsers]);

  return { users, loading, error, create, update, resetPassword, deactivate, reactivate, reload: loadUsers };
}
