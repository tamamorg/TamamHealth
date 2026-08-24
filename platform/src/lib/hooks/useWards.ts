'use client';

import { useState, useEffect, useCallback } from 'react';
import { makeCoalescer } from './live-reload';
import type { WardDoc, BedDoc, AdmissionDoc } from '../db-types-ward';
import { wardDB } from '../db';
import { useDataScope } from './useDataScope';

export function useWards() {
  const [wards, setWards] = useState<WardDoc[]>([]);
  const [beds, setBeds] = useState<BedDoc[]>([]);
  const [admissions, setAdmissions] = useState<AdmissionDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const scope = useDataScope();

  const load = useCallback(async () => {
    try {
      setError(null);
      const { getAllWards, getAllAdmissions, getAllBeds } = await import('../services/ward-service');
      const [w, a, bedDocs] = await Promise.all([
        getAllWards(scope),
        getAllAdmissions(scope),
        getAllBeds(scope),
      ]);
      setWards(w);
      setAdmissions(a);
      setBeds(bedDocs);
    } catch (err) {
      console.error('Failed to load wards', err);
      setError('Failed to load wards');
    } finally {
      setLoading(false);
    }
  }, [scope]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    let cancelled = false;
    const reload = makeCoalescer(() => { if (!cancelled) load(); });
    const changes = wardDB().changes({ since: 'now', live: true, include_docs: false })
      .on('change', () => reload.trigger())
      .on('error', () => { /* swallow */ });
    return () => {
      cancelled = true;
      reload.cancel();
      try { changes.cancel(); } catch { /* noop */ }
    };
  }, [load]);

  const admit = useCallback(async (
    input: import('../services/ward-service').AdmitPatientInput,
  ) => {
    const { admitPatient } = await import('../services/ward-service');
    const doc = await admitPatient(input);
    await load();
    return doc;
  }, [load]);

  const discharge = useCallback(async (
    admissionId: string,
    data: Parameters<typeof import('../services/ward-service').dischargePatient>[1],
  ) => {
    const { dischargePatient } = await import('../services/ward-service');
    const doc = await dischargePatient(admissionId, data);
    await load();
    return doc;
  }, [load]);

  const reassignBed = useCallback(async (
    admissionId: string,
    destination: { wardId: string; wardName: string; bedId: string; bedNumber: string },
  ) => {
    const { reassignAdmissionBed } = await import('../services/ward-service');
    const doc = await reassignAdmissionBed(admissionId, destination);
    await load();
    return doc;
  }, [load]);

  const markBedReady = useCallback(async (
    bedId: string,
    actor?: { id?: string; name?: string },
  ) => {
    const { completeBedTurnover } = await import('../services/ward-service');
    const doc = await completeBedTurnover(bedId, actor);
    await load();
    return doc;
  }, [load]);

  // Derived: active admissions (still in ward)
  const activeAdmissions = admissions.filter(a => a.status === 'admitted');

  // Derived: census KPIs
  // The bed documents are the live operational truth. Ward counters are a
  // reporting cache and can lag after an offline conflict or interrupted
  // update, so they must not drive the board a nurse uses to place a patient.
  const configuredCapacity = wards.reduce((s, w) => s + (w.totalBeds || 0), 0);
  const totalBeds = beds.length > 0 ? beds.length : configuredCapacity;
  const occupiedBeds = beds.filter(bed => bed.status === 'occupied').length;
  const availableBeds = beds.filter(bed => bed.status === 'available').length;
  const occupancyRate = totalBeds > 0 ? Math.round((occupiedBeds / totalBeds) * 100) : 0;

  return {
    wards, beds, admissions, activeAdmissions,
    totalBeds, occupiedBeds, availableBeds, occupancyRate,
    loading, error,
    admit, discharge, reassignBed, markBedReady, reload: load,
  };
}
