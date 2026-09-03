'use client';

/**
 * Clinical forms workspace panel — a searchable list of this app's real
 * clinical entry points (Tamam calls these "form templates"; this app
 * doesn't have a form-template registry, so the list below points at the
 * actual pages/flows that create each kind of record). "Last completed" is
 * derived from the same hooks the rest of the chart already uses for this
 * patient — no invented data, and destinations that don't support a
 * `?patientId=` deep-link are still linked to (routing to the existing
 * full-page flow) rather than fabricating a pre-filled form.
 */

import { useEffect, useMemo, useState } from 'react';
import { Search, ChevronRight, FileText } from '@/components/icons/lucide';
import { useMedicalRecords } from '@/lib/hooks/useMedicalRecords';
import { useTriage } from '@/lib/hooks/useTriage';
import { useANC } from '@/lib/hooks/useANC';
import { useNutritionScreenings } from '@/lib/hooks/useNutritionScreenings';
import { useWards } from '@/lib/hooks/useWards';
import { formatDate } from '@/lib/format-utils';
import { isPathAllowed } from '@/lib/role-routes';
import type { PatientDoc } from '@/lib/db-types';
import type { ChartPanelRouter, ChartPanelUser } from './types';

interface ClinicalFormItem {
  id: string;
  name: string;
  lastCompleted: string;
  href: string;
  enabled: boolean;
  /** Shown as the row's tooltip when `enabled` is false. */
  disabledReason?: string;
}

interface ClinicalFormsPanelProps {
  patient: PatientDoc;
  router: ChartPanelRouter;
  canConsult: boolean;
  currentUser: ChartPanelUser | null | undefined;
  onClose: () => void;
}

export default function ClinicalFormsPanel({ patient, router, canConsult, currentUser, onClose }: ClinicalFormsPanelProps) {
  const [search, setSearch] = useState('');
  const { records } = useMedicalRecords(patient._id);
  const { triages } = useTriage(patient._id);
  const { visits: ancVisits } = useANC();
  const { screenings } = useNutritionScreenings();
  const { admissions } = useWards();

  const patientANC = (ancVisits || []).filter(a => a.patientId === patient._id);
  const patientScreenings = (screenings || []).filter(s => s.patientId === patient._id);
  const patientAdmissions = (admissions || []).filter(a => a.patientId === patient._id);

  // The triage form lives on the nursing route, which reception cannot open —
  // gate the row rather than letting the click land on "Access Restricted".
  //
  // Every row that leaves the chart needs the same gate. Three did not have
  // one and were marked `enabled: true` for everybody who can open a chart:
  // a radiologist, lab technician or pharmacist reading a chart was offered
  // "ANC Visit" and "Ward Admission", and clicking either landed them on
  // "Access Restricted". The nutrition row is the same shape and additionally
  // pointed at another role's whole station console — the hand-off
  // PatientDispenseModal was built to stop the pharmacy version of.
  const role = currentUser?.role || '';
  const canTriage = isPathAllowed(role, '/triage');
  const canOpenAnc = isPathAllowed(role, '/anc');
  const canOpenNutrition = isPathAllowed(role, '/dashboard/nutrition');
  const canAdmit = isPathAllowed(role, '/wards');

  // The Ward Admission row deep-links into /wards so admitting from the chart
  // can close the OPD visit it grew out of (wards reads ?encounterId=). The
  // panel isn't handed the open encounter directly, so it's resolved
  // best-effort the same way the rest of the chart would — no encounter found
  // just means the link falls back to a plain admit with nothing to close.
  const [openEncounterId, setOpenEncounterId] = useState<string | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    const hospitalId = currentUser?.hospitalId;
    if (!hospitalId) { setOpenEncounterId(undefined); return; }
    (async () => {
      try {
        const { findOpenEncounterForPatient } = await import('@/lib/services/encounter-service');
        const enc = await findOpenEncounterForPatient(patient._id, hospitalId);
        if (!cancelled) setOpenEncounterId(enc?._id);
      } catch {
        if (!cancelled) setOpenEncounterId(undefined);
      }
    })();
    return () => { cancelled = true; };
  }, [patient._id, currentUser?.hospitalId]);

  const forms = useMemo<ClinicalFormItem[]>(() => {
    const lastRecord = records[0];
    const lastTriage = triages[0];
    const lastANC = [...patientANC].sort((a, b) => (b.visitDate || '').localeCompare(a.visitDate || ''))[0];
    const lastScreening = [...patientScreenings].sort((a, b) => (b.screeningDate || '').localeCompare(a.screeningDate || ''))[0];
    const lastAdmission = [...patientAdmissions].sort((a, b) => (b.admissionDate || '').localeCompare(a.admissionDate || ''))[0];

    return [
      {
        id: 'consultation',
        name: 'Consultation / SOAP Note',
        lastCompleted: lastRecord ? formatDate(lastRecord.consultedAt || lastRecord.visitDate) : 'Never',
        href: `/consultation?patientId=${patient._id}`,
        enabled: canConsult,
        disabledReason: 'Requires consultation permission',
      },
      {
        id: 'triage',
        name: 'Triage / ETAT Assessment',
        lastCompleted: lastTriage ? formatDate(lastTriage.triagedAt) : 'Never',
        // The standalone Check-In module is retired; the per-patient triage
        // route is the ETAT form's real home and is addressable by patient id.
        href: `/triage/${patient._id}`,
        enabled: canTriage,
        disabledReason: 'Requires triage permission',
      },
      {
        id: 'anc',
        name: 'ANC Visit',
        lastCompleted: lastANC ? formatDate(lastANC.visitDate) : 'Never',
        href: `/anc?patientId=${patient._id}`,
        enabled: canOpenAnc,
        disabledReason: 'Requires antenatal care access',
      },
      {
        id: 'nutrition',
        name: 'Nutrition Screening',
        lastCompleted: lastScreening ? formatDate(lastScreening.screeningDate) : 'Never',
        href: `/dashboard/nutrition?patientId=${patient._id}`,
        enabled: canOpenNutrition,
        disabledReason: 'Requires the nutrition module',
      },
      {
        id: 'ward-admission',
        name: 'Ward Admission',
        lastCompleted: lastAdmission ? formatDate(lastAdmission.admissionDate) : 'Never',
        // wards/page.tsx reads `admitPatientId`, not `patientId` — the mismatch
        // meant this link never actually pre-filled the admit modal. The
        // encounterId (when an open visit was found) lets admission close it.
        href: `/wards?admitPatientId=${patient._id}${openEncounterId ? `&encounterId=${openEncounterId}` : ''}`,
        enabled: canAdmit,
        disabledReason: 'Requires ward access',
      },
    ];
  }, [records, triages, patientANC, patientScreenings, patientAdmissions, patient._id,
      canConsult, canTriage, canOpenAnc, canOpenNutrition, canAdmit, openEncounterId]);

  const filtered = forms.filter(f => f.name.toLowerCase().includes(search.trim().toLowerCase()));

  return (
    <div className="tamam-drawer-body">
      <div className="tamam-panel-search-wrap">
        <Search />
        <input
          type="text"
          className="tamam-panel-search"
          placeholder="Search clinical forms…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {filtered.length === 0 && (
        <p className="tamam-panel-empty">No forms match &quot;{search}&quot;.</p>
      )}

      {filtered.map(f => (
        <button
          key={f.id}
          type="button"
          className="tamam-panel-list-item"
          disabled={!f.enabled}
          title={f.enabled ? undefined : f.disabledReason}
          style={f.enabled ? undefined : { opacity: 0.5, cursor: 'not-allowed' }}
          onClick={() => { if (f.enabled) { router.push(f.href); onClose(); } }}
        >
          <FileText />
          <div style={{ flex: 1 }}>
            <div className="tamam-panel-row-main">{f.name}</div>
            <div className="tamam-panel-row-sub">Last completed: {f.lastCompleted}</div>
          </div>
          <ChevronRight />
        </button>
      ))}
    </div>
  );
}
