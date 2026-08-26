'use client';

import { useState, useEffect, useCallback } from 'react';
import type { AppointmentDoc, AppointmentStatus } from '../db-types';
import { appointmentsDB } from '../db';
import { useAuth } from '../context';
import { makeCoalescer } from './live-reload';
import { useDataScope } from './useDataScope';
import type { AppointmentStatusUpdateExtra } from '../services/appointment-service';

export function useAppointments() {
  const [appointments, setAppointments] = useState<AppointmentDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const scope = useDataScope();
  const { currentUser } = useAuth();

  const load = useCallback(async () => {
    try {
      setError(null);
      const { getAllAppointments } = await import('../services/appointment-service');
      const data = await getAllAppointments(scope);
      setAppointments(data);
    } catch (err) {
      console.error(err);
      setError('Failed to load appointments');
    } finally {
      setLoading(false);
    }
  }, [scope]);

  useEffect(() => { load(); }, [load]);

  // Live PouchDB subscription: re-load on any appointment change.
  useEffect(() => {
    let cancelled = false;
    const reload = makeCoalescer(() => { if (!cancelled) load(); });
    const changes = appointmentsDB().changes({ since: 'now', live: true, include_docs: false })
      .on('change', () => reload.trigger())
      .on('error', () => { /* swallow */ });
    return () => {
      cancelled = true;
      reload.cancel();
      try { changes.cancel(); } catch { /* noop */ }
    };
  }, [load]);

  const create = useCallback(async (data: Omit<AppointmentDoc, '_id' | '_rev' | 'type' | 'createdAt' | 'updatedAt'>) => {
    const { createAppointment } = await import('../services/appointment-service');
    const appointment = await createAppointment(data);
    await load();
    return appointment;
  }, [load]);

  const updateStatus = useCallback(async (
    id: string,
    status: AppointmentStatus,
    extra?: AppointmentStatusUpdateExtra
  ) => {
    const { updateAppointmentStatus } = await import('../services/appointment-service');
    const updated = await updateAppointmentStatus(id, status, {
      ...extra,
      actorId: extra?.actorId || currentUser?._id,
      actorName: extra?.actorName || currentUser?.name,
      actorRole: extra?.actorRole || currentUser?.role,
    });
    if (!updated) throw new Error('Failed to update appointment status');
    await load();
  }, [currentUser?._id, currentUser?.name, currentUser?.role, load]);

  const reschedule = useCallback(async (id: string, newDate: string, newTime: string) => {
    const { rescheduleAppointment } = await import('../services/appointment-service');
    await rescheduleAppointment(id, newDate, newTime);
    await load();
  }, [load]);

  const update = useCallback(async (id: string, updates: Partial<AppointmentDoc>) => {
    const { updateAppointment } = await import('../services/appointment-service');
    await updateAppointment(id, updates);
    await load();
  }, [load]);

  return { appointments, loading, error, create, updateStatus, reschedule, update, reload: load };
}

export function usePatientAppointments(patientId?: string) {
  const [appointments, setAppointments] = useState<AppointmentDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const scope = useDataScope();

  const load = useCallback(async () => {
    if (!patientId) { setAppointments([]); setLoading(false); return; }
    try {
      setError(null);
      const { getAppointmentsByPatient } = await import('../services/appointment-service');
      const data = await getAppointmentsByPatient(patientId, scope);
      setAppointments(data);
    } catch (err) {
      console.error(err);
      setError('Failed to load patient appointments');
    } finally {
      setLoading(false);
    }
  }, [patientId, scope]);

  useEffect(() => { load(); }, [load]);

  return { appointments, loading, error, reload: load };
}

export function useAppointmentStats() {
  const [stats, setStats] = useState<Awaited<ReturnType<typeof import('../services/appointment-service').getAppointmentStats>> | null>(null);
  const [loading, setLoading] = useState(true);
  const scope = useDataScope();

  const load = useCallback(async () => {
    try {
      const { getAppointmentStats } = await import('../services/appointment-service');
      const data = await getAppointmentStats(scope);
      setStats(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [scope]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    let cancelled = false;
    const reload = makeCoalescer(() => { if (!cancelled) load(); });
    const changes = appointmentsDB().changes({ since: 'now', live: true, include_docs: false })
      .on('change', () => reload.trigger())
      .on('error', () => { /* swallow */ });
    return () => {
      cancelled = true;
      reload.cancel();
      try { changes.cancel(); } catch { /* noop */ }
    };
  }, [load]);

  return { stats, loading, reload: load };
}
