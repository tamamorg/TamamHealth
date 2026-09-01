'use client';

import { useState, useEffect, useCallback } from 'react';
import type { PatientDoc } from '../db-types';
import { patientsDB } from '../db';
import { makeCoalescer } from './live-reload';
import { useDataScope } from './useDataScope';

/**
 * Ceiling on a registration write. On a device still completing its initial
 * sync, a local write can stall indefinitely under IndexedDB contention — the
 * index build behind the duplicate scan, or the raw counter reads/writes that
 * mint a hospital number (see patient-service `generateHospitalNumber`). The
 * read path degrades gracefully (findByType falls back to a scan), but a stalled
 * write has no fallback: without a ceiling the form spins on "Saving…" forever,
 * never erroring, and the clerk never learns the patient was not saved — silent
 * data loss, and an invitation to click again. Bounding it turns the hang into a
 * retryable error the form already surfaces (`toastRegisterFailed`, and
 * `setSubmitting(false)` re-enables the form). Mirrors WALK_IN_CHECKIN_TIMEOUT_MS.
 */
const REGISTRATION_WRITE_TIMEOUT_MS = 30_000;

/** Rejects with `message` after `ms` if `promise` has not settled by then. */
function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      value => { clearTimeout(timer); resolve(value); },
      error => { clearTimeout(timer); reject(error); },
    );
  });
}

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
    // error instead of an unbounded "Saving…" (see the constant's doc above).
    const patient = await withTimeout(
      createPatient(data, scope),
      REGISTRATION_WRITE_TIMEOUT_MS,
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
