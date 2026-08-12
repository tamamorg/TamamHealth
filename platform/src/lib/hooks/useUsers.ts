'use client';

import { useState, useEffect, useCallback } from 'react';
import type { UserDoc, UserRole } from '../db-types';
import { useDataScope } from './useDataScope';

export function useUsers() {
  const [users, setUsers] = useState<UserDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const scope = useDataScope();

  const loadUsers = useCallback(async () => {
    try {
      const { getAllUsers } = await import('../services/user-service');
      const data = await getAllUsers(scope);
      setUsers(data);
      setError(null);
    } catch (err) {
      setError('Failed to load users');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [scope]);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  // Staff identity is server-managed and deliberately excluded from browser
  // replication because user docs contain password/PIN hashes. Refresh when
  // the tab regains focus; mutations below also refresh immediately.
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === 'visible') void loadUsers(); };
    document.addEventListener('visibilitychange', refresh);
    return () => document.removeEventListener('visibilitychange', refresh);
  }, [loadUsers]);

  const create = useCallback(async (data: {
    username: string;
    password: string;
    name: string;
    role: UserRole;
    hospitalId?: string;
    hospitalName?: string;
    photoUrl?: string;
    department?: string;
    specialty?: string;
    phone?: string;
  }, actorId?: string, actorUsername?: string) => {
    const { createUser } = await import('../services/user-service');
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
    const { updateUser } = await import('../services/user-service');
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
    const { resetPassword: resetPw } = await import('../services/user-service');
    await resetPw(id, newPassword, actorId, actorUsername);
  }, []);

  const deactivate = useCallback(async (
    id: string,
    actorId?: string,
    actorUsername?: string
  ) => {
    const { deactivateUser } = await import('../services/user-service');
    await deactivateUser(id, actorId, actorUsername);
    await loadUsers();
  }, [loadUsers]);

  return { users, loading, error, create, update, resetPassword, deactivate, reload: loadUsers };
}
