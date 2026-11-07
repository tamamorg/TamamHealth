import { useSync } from '@/lib/context';
import { AppointmentDoc, EncounterDoc, PatientDoc, TriageDoc } from '@/lib/db-types';
import { APPOINTMENT_SLOT_RELEASED_STATUSES } from '@/lib/appointment-status';
import { patientFullName } from '@/lib/patient-utils';
import { PRIORITY_META, isTriagePriority, type TriagePriority } from '@/lib/clinical/triage-display';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { type EhrCareDashboardMetric } from '@/components/ehr/EhrCareDashboard';
import { hasUnsyncedWrite } from '@/lib/sync/offline-metadata';
import { isoDateKey } from '@/lib/front-desk-utils';
import type { Dispatch, SetStateAction } from 'react';
import type { QueueItem } from './desk-types';

export type PendingSyncDoc = { id: string; kind: 'patient' | 'appointment' | 'triage'; name: string; status: string; error?: string; at?: string };

/** Records this device wrote offline and has not confirmed synced. Moved verbatim. */
export function buildPendingSyncDocs(
  patients: PatientDoc[],
  appointments: AppointmentDoc[],
  triages: TriageDoc[],
): PendingSyncDoc[] {
  const seen = new Set<string>();
  const out: PendingSyncDoc[] = [];
  const consider = (
    kind: 'patient' | 'appointment' | 'triage',
    doc: { _id?: string; offlineSync?: PatientDoc['offlineSync'] },
    name: string,
  ) => {
    if (!doc._id || seen.has(doc._id)) return;
    seen.add(doc._id);
    if (!hasUnsyncedWrite(doc)) return;
    out.push({
      id: doc._id, kind, name,
      status: doc.offlineSync?.status || 'pending',
      error: doc.offlineSync?.error,
      at: doc.offlineSync?.lastLocalChangeAt,
    });
  };
  patients.forEach(p => consider('patient', p, patientFullName(p)));
  appointments.forEach(a => consider('appointment', a, a.patientName));
  triages.forEach(tr => consider('triage', tr, tr.patientName || ''));
  return out.sort((a, b) => (b.at || '').localeCompare(a.at || ''));
}

/** The server's own reason for any record it refused this session, by doc id. */
export function buildDeniedReasonById(syncStatus: ReturnType<typeof useSync>['syncStatus']): Map<string, string> {
  const map = new Map<string, string>();
  for (const db of Object.values(syncStatus?.databases ?? {})) {
    for (const denial of db.deniedDocs ?? []) if (denial.id) map.set(denial.id, denial.reason);
  }
  return map;
}

/** Patients a doctor holds with no booking and no visit today. Moved verbatim. */
export function buildAssignedUnbooked({
  viewingToday, todaysAppointments, encounters, today, triages, patients,
}: {
  viewingToday: boolean;
  todaysAppointments: AppointmentDoc[];
  encounters: EncounterDoc[];
  today: string;
  triages: TriageDoc[];
  patients: PatientDoc[];
}): PatientDoc[] {
  if (!viewingToday) return [];
  const seenToday = new Set<string>();
  // A cancelled / no-show / moved booking leaves the patient unbooked today.
  for (const a of todaysAppointments) {
    if (a.patientId && !APPOINTMENT_SLOT_RELEASED_STATUSES.includes(a.status)) seenToday.add(a.patientId);
  }
  for (const enc of encounters) {
    if (isoDateKey(enc.startedAt || enc.createdAt) === today) seenToday.add(enc.patientId);
  }
  for (const tr of triages) {
    if (isoDateKey(tr.triagedAt || tr.createdAt) === today) seenToday.add(tr.patientId);
  }
  return patients
    .filter(p => p.assignedDoctor && p.assignmentStatus !== 'completed' && !seenToday.has(p._id))
    .sort((a, b) => (b.assignedAt ?? '').localeCompare(a.assignedAt ?? ''));
}

/** The Reception rail tiles: acuity counts plus the optional work-list tiles. */
export function buildDeskMetrics({
  boardQueue, openRequestsCount, pendingSyncCount, assignedUnbookedCount, staleVisitsCount, t,
  setRequestsOpen, setPendingSyncOpen, setUnbookedOpen, setCloseoutOpen,
}: {
  boardQueue: QueueItem[];
  openRequestsCount: number;
  pendingSyncCount: number;
  assignedUnbookedCount: number;
  staleVisitsCount: number;
  t: ReturnType<typeof useTranslation>['t'];
  setRequestsOpen: Dispatch<SetStateAction<boolean>>;
  setPendingSyncOpen: Dispatch<SetStateAction<boolean>>;
  setUnbookedOpen: Dispatch<SetStateAction<boolean>>;
  setCloseoutOpen: Dispatch<SetStateAction<boolean>>;
}): EhrCareDashboardMetric[] {
  const counts = new Map<TriagePriority, number>();
  for (const item of boardQueue) {
    if (isTriagePriority(item.priority)) {
      counts.set(item.priority, (counts.get(item.priority) ?? 0) + 1);
    }
  }
  // Most urgent first — `order` on the acuity table, not this file's opinion.
  const ACUITY_TONE: Record<TriagePriority, EhrCareDashboardMetric['tone']> = {
    RED: 'danger', YELLOW: 'warning', GREEN: 'success',
  };
  const acuityMetrics: EhrCareDashboardMetric[] = (['RED', 'YELLOW', 'GREEN'] as TriagePriority[]).map(code => {
    const count = counts.get(code) ?? 0;
    return {
      label: PRIORITY_META[code].label,
      value: count,
      // A zero is not an alarm: an empty emergency lane reads neutral, the
      // same way the status panel treated its empty rungs.
      tone: count === 0 ? ('neutral' as const) : ACUITY_TONE[code],
    };
  });
  // Only shown when there is something to say — a synced device adds no
  // tile here, same rule the acuity rows follow for a quiet lane.
  if (openRequestsCount > 0) {
    acuityMetrics.push({
      label: t('frontDesk.requestsTitle'), value: openRequestsCount, tone: 'warning',
      onClick: () => setRequestsOpen(true),
    });
  }
  if (pendingSyncCount > 0) {
    acuityMetrics.push({
      label: t('sync.docPendingLabel'), value: pendingSyncCount, tone: 'neutral',
      onClick: () => setPendingSyncOpen(true),
    });
  }
  if (assignedUnbookedCount > 0) {
    acuityMetrics.push({
      label: t('frontDesk.assignedUnbooked'), value: assignedUnbookedCount, tone: 'neutral',
      onClick: () => setUnbookedOpen(true),
    });
  }
  // Open visits left over from a previous day, waiting for a person to
  // close them (see staleOpenVisits). Clicking opens the close-out list.
  if (staleVisitsCount > 0) {
    acuityMetrics.push({
      label: 'Needs close-out', value: staleVisitsCount, tone: 'warning',
      onClick: () => setCloseoutOpen(true),
    });
  }
  return acuityMetrics;
}
