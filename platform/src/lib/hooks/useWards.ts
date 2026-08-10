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
      const { getAllWards, getAllAdmissions } = await import('../services/ward-service');
      const [w, a] = await Promise.all([getAllWards(scope), getAllAdmissions(scope)]);
      setWards(w);
      setAdmissions(a);

      // Beds aren't filtered by scope yet — fetch all and trim by ward.
      const bedDocs: BedDoc[] = [];
      const db = wardDB();
      const all = await db.allDocs({ include_docs: true });
      for (const row of all.rows) {
        const doc = row.doc as { type?: string } | undefined;
        if (doc && doc.type === 'bed') bedDocs.push(doc as unknown as BedDoc);
      }
      setBeds(bedDocs.filter(b => w.some(ward => ward._id === b.wardId)));
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

  // Derived: active admissions (still in ward)
  const activeAdmissions = admissions.filter(a => a.status === 'admitted');

  // Derived: census KPIs
  const totalBeds = wards.reduce((s, w) => s + (w.totalBeds || 0), 0);
  const occupiedBeds = wards.reduce((s, w) => s + (w.occupiedBeds || 0), 0);
  const availableBeds = Math.max(0, totalBeds - occupiedBeds);
  const occupancyRate = totalBeds > 0 ? Math.round((occupiedBeds / totalBeds) * 100) : 0;

  return {
    wards, beds, admissions, activeAdmissions,
    totalBeds, occupiedBeds, availableBeds, occupancyRate,
    loading, error,
    admit, discharge, reassignBed, reload: load,
  };
}
