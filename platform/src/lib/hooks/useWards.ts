'use client';

import { useTranslation } from '../i18n/useTranslation';
import { useState, useCallback } from 'react';
import { usePouchLiveReload } from './usePouchLiveReload';
import type { WardDoc, BedDoc, AdmissionDoc } from '../db-types-ward';
import { wardDB } from '../db';
import { useDataScope } from './useDataScope';

export function useWards() {
  const [wards, setWards] = useState<WardDoc[]>([]);
  const [beds, setBeds] = useState<BedDoc[]>([]);
  const [admissions, setAdmissions] = useState<AdmissionDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { t } = useTranslation();
  const scope = useDataScope();

  const load = useCallback(async () => {
    if (!scope) { setWards([]); setBeds([]); setAdmissions([]); setLoading(false); return; }
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
      setError('msg.wardsNotLoaded');
    } finally {
      setLoading(false);
    }
  }, [scope]);

  usePouchLiveReload({ load, database: wardDB });

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
  //
  // Counted per ward: a ward with bed documents is counted from them; a ward
  // that has none (capacity configured, beds never itemised) from its own
  // tallies. Counting the documents alone for the whole facility left those
  // wards out — the census read "8 beds, 1 available" beside an admit form
  // offering a ward with 9 free (the same two-model rule the form follows).
  const census = { total: 0, occupied: 0, available: 0 };
  const wardIds = new Set(wards.map(w => w._id));
  for (const ward of wards) {
    const wardBeds = beds.filter(bed => bed.wardId === ward._id);
    if (wardBeds.length > 0) {
      census.total += wardBeds.length;
      census.occupied += wardBeds.filter(bed => bed.status === 'occupied').length;
      census.available += wardBeds.filter(bed => bed.status === 'available').length;
    } else {
      const total = ward.totalBeds || 0;
      const occupied = Math.min(total, ward.occupiedBeds || 0);
      census.total += total;
      census.occupied += occupied;
      census.available += Math.max(0, ward.availableBeds ?? total - occupied);
    }
  }
  // Beds whose ward is not in this list still exist; count them as they are.
  for (const bed of beds) {
    if (wardIds.has(bed.wardId)) continue;
    census.total += 1;
    if (bed.status === 'occupied') census.occupied += 1;
    if (bed.status === 'available') census.available += 1;
  }
  const totalBeds = census.total;
  const occupiedBeds = census.occupied;
  const availableBeds = census.available;
  const occupancyRate = totalBeds > 0 ? Math.round((occupiedBeds / totalBeds) * 100) : 0;

  return {
    wards, beds, admissions, activeAdmissions,
    totalBeds, occupiedBeds, availableBeds, occupancyRate,
    loading, error: error && t(error),
    admit, discharge, reassignBed, markBedReady, reload: load,
  };
}
