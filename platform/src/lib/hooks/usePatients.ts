'use client';

import { useState, useEffect, useCallback } from 'react';
import type { PatientDoc } from '../db-types';
import { patientsDB } from '../db';
import { makeCoalescer } from './live-reload';
import { useDataScope } from './useDataScope';
import { withTimeout, CLINICAL_WRITE_TIMEOUT_MS } from '../write-timeout';

export function usePatients(enabled = true) {
  const [patients, setPatients] = useState<PatientDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const scope = useDataScope();

  const loadPatients = useCallback(async () => {
    if (!enabled || !scope) {
      setPatients([]);
      setError(null);
      setLoading(false);
      return;
    }
    try {
      const { getAllPatients } = await import('../services/patient-service');
      const data = await getAllPatients(scope);
      setPatients(data);
      setError(null);
    } catch (err) {
      setError('Failed to load patients');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [enabled, scope]);

  useEffect(() => {
    loadPatients();
  }, [loadPatients]);

  // Live PouchDB subscription: re-load whenever a patient is created,
  // updated, or marked deceased anywhere in the app. Replaces 30s polling.
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const reload = makeCoalescer(() => { if (!cancelled) loadPatients(); });
    const changes = patientsDB().changes({ since: 'now', live: true, include_docs: false })
      .on('change', () => reload.trigger())
      .on('error', () => { /* swallow */ });
    return () => {
      cancelled = true;
      reload.cancel();
      try { changes.cancel(); } catch { /* noop */ }
    };
  }, [enabled, loadPatients]);

  const search = useCallback(async (query: string) => {
    if (!scope) {
      setPatients([]);
      return;
    }
    if (!query) {
      await loadPatients();
      return;
    }
    const { searchPatients } = await import('../services/patient-service');
    const results = await searchPatients(query, scope);
    setPatients(results);
  }, [loadPatients, scope]);

  const create = useCallback(async (data: Omit<PatientDoc, '_id' | '_rev' | 'type' | 'createdAt' | 'updatedAt'>) => {
    if (!scope) throw new Error('Your patient data scope is unavailable');
    const { createPatient } = await import('../services/patient-service');
    // Scope so duplicate-detection and geocode assignment don't read/disclose
    // across tenant boundaries (see createPatient's own docs). Bounded so a
    // local write stalled by initial-sync contention surfaces as a retryable
    // error (`toastRegisterFailed`, form re-enabled) instead of an unbounded
    // "Saving…" — see lib/write-timeout.ts for the failure mode.
    const patient = await withTimeout(
      createPatient(data, scope),
      CLINICAL_WRITE_TIMEOUT_MS,
      'Registration timed out — the local database did not respond. Please try again.',
    );
    await loadPatients();
    return patient;
  }, [loadPatients, scope]);

  const update = useCallback(async (id: string, data: Partial<PatientDoc>) => {
    const { updatePatient } = await import('../services/patient-service');
    const patient = await updatePatient(id, data);
    await loadPatients();
    return patient;
  }, [loadPatients]);

  return { patients, loading, error, search, create, update, reload: loadPatients };
}
