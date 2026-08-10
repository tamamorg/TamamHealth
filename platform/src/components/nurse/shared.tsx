// Shared utilities, types, and hooks for the nurse workflow components.
// Not a component itself — consumers ('use client') import from here.

import { useEffect, useMemo, useState } from 'react';
import { useAuth, useUi } from '@/lib/context';
import { usePatients } from '@/lib/hooks/usePatients';
import { usePrescriptions } from '@/lib/hooks/usePrescriptions';
import { useTriage } from '@/lib/hooks/useTriage';
import { useWards } from '@/lib/hooks/useWards';
import { useToast } from '@/components/Toast';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { priorityOrder } from '@/lib/clinical/triage-display';
import type { MedicationAdministration, PrescriptionDoc } from '@/lib/db-types';
import type { AdmissionDoc } from '@/lib/db-types-ward';

// Re-export the shared vital-flagging helper so existing importers
// (e.g. WardWorkflow) keep `import { getVitalFlags } from './shared'` working
// while the single source of truth lives in '@/lib/clinical/vitals'.
export { getVitalFlags } from '@/lib/clinical/vitals';

// ============================================================
// Types
// ============================================================

export interface VitalsFormData {
  systolic: string;
  diastolic: string;
  temperature: string;
  pulse: string;
  spo2: string;
  weight: string;
  respiratoryRate: string;
  notes: string;
  // Additional vitals
  painScore: string;
  bloodGlucose: string;
  gcs: string;
  muac: string;
  // Fluid balance (intake/output, mL)
  oralIntakeMl: string;
  ivIntakeMl: string;
  urineOutputMl: string;
  otherOutputMl: string;
}

export interface MAREntry {
  id: string;
  time: string;
  patientId: string;
  patientName: string;
  medication: string;
  dose: string;
  route: string;
  status: 'overdue' | 'due' | 'upcoming' | 'given';
  givenAt?: string;
  // Real prescription wiring (added when MAR rows are sourced from prescriptions)
  prescriptionId: string;
  frequency: string;
  scheduledFor: string;           // ISO datetime of the scheduled dose
  administrationStatus?: MedicationAdministration['status']; // recorded outcome, if any
  administrationId?: string;      // id of the satisfying (non-voided) administration entry, when given
}

export interface TriageResult {
  airway: 'clear' | 'obstructed' | '';
  breathing: 'normal' | 'distressed' | 'absent' | '';
  circulation: 'normal' | 'impaired' | 'absent' | '';
  consciousness: 'alert' | 'verbal' | 'pain' | 'unresponsive' | '';
  priority: 'RED' | 'YELLOW' | 'GREEN' | '';
}

// A ward-board row. Real patient docs are structurally compatible with the
// fields used here; demo rows (below) carry their triage inline via `_triage`.
export type WardRow = {
  _id: string;
  firstName: string;
  surname: string;
  hospitalNumber: string;
  gender: string;
  estimatedAge?: number;
  dateOfBirth?: string;
  assignedDoctor?: string;
  assignedDoctorName?: string;
  _demo?: boolean;
  _triage?: { priority: 'RED' | 'YELLOW' | 'GREEN'; chiefComplaint: string; status: string };
};

// ============================================================
// Module-level constants
// ============================================================

// Demo mode gates the seeded ward roster so the board is never empty during a
// walkthrough. (The old live "Care Feed" ticker has been removed app-wide.)
// Demo data must be explicitly enabled. Treating an absent environment value
// as demo mode leaked hardcoded ward patients into otherwise real facilities.
export const IS_DEMO = process.env.NEXT_PUBLIC_DEMO_MODE === 'true';

export const ACCENT = 'var(--accent-primary)';

// Demo ward roster — shown only in demo mode when the facility has fewer than
// 10 seeded patients, so the ward board is never empty during a walkthrough.
// These are display-only rows: charting/triage/assign actions are suppressed.
export const DEMO_WARD_PATIENTS: WardRow[] = [
  { firstName: 'Deng', surname: 'Mabior', gender: 'Male', age: 34, hn: 'WRD-1042', priority: 'RED', complaint: 'Severe malaria, high fever', status: 'pending' },
  { firstName: 'Achol', surname: 'Mayen', gender: 'Female', age: 27, hn: 'WRD-1043', priority: 'RED', complaint: 'Postpartum haemorrhage', status: 'pending' },
  { firstName: 'Nyamal', surname: 'Koang', gender: 'Female', age: 19, hn: 'WRD-1044', priority: 'YELLOW', complaint: 'Obstructed labour — monitoring', status: 'seen' },
  { firstName: 'Gatluak', surname: 'Ruot', gender: 'Male', age: 45, hn: 'WRD-1045', priority: 'YELLOW', complaint: 'Pneumonia, on IV antibiotics', status: 'seen' },
  { firstName: 'Ayen', surname: 'Dut', gender: 'Female', age: 31, hn: 'WRD-1046', priority: 'YELLOW', complaint: 'Dehydration from diarrhoea', status: 'pending' },
  { firstName: 'Kuol', surname: 'Akot', gender: 'Male', age: 8, hn: 'WRD-1047', priority: 'GREEN', complaint: 'Minor laceration, dressed', status: 'admitted' },
  { firstName: 'Rose', surname: 'Gbudue', gender: 'Female', age: 52, hn: 'WRD-1048', priority: 'GREEN', complaint: 'Hypertension review', status: 'seen' },
  { firstName: 'Majok', surname: 'Chol', gender: 'Male', age: 60, hn: 'WRD-1049', priority: 'YELLOW', complaint: 'Diabetic foot, wound care', status: 'admitted' },
  { firstName: 'Nyandit', surname: 'Dut', gender: 'Female', age: 24, hn: 'WRD-1050', priority: 'GREEN', complaint: 'ANC routine check', status: 'seen' },
  { firstName: 'Garang', surname: 'Makuei', gender: 'Male', age: 38, hn: 'WRD-1051', priority: 'GREEN', complaint: 'Typhoid, recovering', status: 'admitted' },
  { firstName: 'Awut', surname: 'Deng', gender: 'Female', age: 5, hn: 'WRD-1052', priority: 'YELLOW', complaint: 'Acute respiratory infection', status: 'pending' },
  { firstName: 'Tut', surname: 'Chuol', gender: 'Male', age: 29, hn: 'WRD-1053', priority: 'GREEN', complaint: 'Fracture follow-up', status: 'discharged' },
].map((d, i) => ({
  _id: `demo-ward-${i}`,
  firstName: d.firstName,
  surname: d.surname,
  hospitalNumber: d.hn,
  gender: d.gender,
  estimatedAge: d.age,
  _demo: true,
  _triage: { priority: d.priority as 'RED' | 'YELLOW' | 'GREEN', chiefComplaint: d.complaint, status: d.status },
}));

// ============================================================
// Helper: Calculate ETAT triage priority
// ============================================================
export function calculateTriagePriority(triage: TriageResult): 'RED' | 'YELLOW' | 'GREEN' | '' {
  if (!triage.airway || !triage.breathing || !triage.circulation || !triage.consciousness) return '';

  if (
    triage.airway === 'obstructed' ||
    triage.breathing === 'absent' ||
    triage.circulation === 'absent' ||
    triage.consciousness === 'unresponsive'
  ) return 'RED';

  if (
    triage.breathing === 'distressed' ||
    triage.circulation === 'impaired' ||
    triage.consciousness === 'pain' ||
    triage.consciousness === 'verbal'
  ) return 'YELLOW';

  return 'GREEN';
}

// ============================================================
// MAR schedule helpers — expand a prescription's free-text `frequency`
// into clock times for one day, then resolve each scheduled dose's status
// against the prescription's append-only administrations[] record.
// Mirrors the ward MAR (`wards/mar/[admissionId]`) so the dashboard MAR
// and the bedside grid agree on schedule + status.
// ============================================================

/**
 * Parse a free-text frequency string into scheduled clock times (HH:mm) for
 * one 24-hour day. Best-effort — falls back to standard q-times for the most
 * common patterns and a single "PRN" slot when nothing matches.
 */
export function scheduleForFrequency(freq: string): string[] {
  const f = (freq || '').toLowerCase().trim();
  if (!f) return [];

  if (f.includes('prn') || f.includes('as needed') || f.includes('as required')) return ['PRN'];
  if (f === 'od' || f === 'qd' || f.includes('once') || f.includes('daily')) return ['08:00'];
  if (f === 'bd' || f === 'bid' || f.includes('twice')) return ['08:00', '20:00'];
  if (f === 'tds' || f === 'tid' || f.includes('three times') || f.includes('thrice')) {
    return ['08:00', '14:00', '22:00'];
  }
  if (f === 'qds' || f === 'qid' || f.includes('four times')) {
    return ['06:00', '12:00', '18:00', '00:00'];
  }
  const qMatch = f.match(/q\s*(\d+)\s*h/);
  if (qMatch) {
    const interval = parseInt(qMatch[1], 10);
    if (interval > 0 && interval <= 24) {
      const times: string[] = [];
      for (let h = 0; h < 24; h += interval) {
        times.push(`${h.toString().padStart(2, '0')}:00`);
      }
      return times;
    }
  }
  return ['PRN'];
}

// Build the ISO datetime for a scheduled dose. PRN doses have no fixed clock
// time, so they anchor to "now" (the moment the nurse opens the chart).
function scheduledForISO(day: string, time: string): string {
  if (time === 'PRN') return new Date(`${day}T00:00:00`).toISOString();
  return new Date(`${day}T${time}:00`).toISOString();
}

/**
 * The point past which a prescription must stop producing new scheduled-dose
 * rows — either the moment it was stopped, or its prescribed course running
 * out. Without this, a discontinued or long-finished order keeps expanding
 * into "due"/"overdue" rows every day indefinitely. Returns null when neither
 * applies (still an open, unstopped course).
 */
export function doseExpansionCutoff(rx: Pick<PrescriptionDoc, 'stoppedAt' | 'createdAt' | 'duration'>): number | null {
  if (rx.stoppedAt) {
    const stoppedMs = new Date(rx.stoppedAt).getTime();
    if (Number.isFinite(stoppedMs)) return stoppedMs;
  }
  if (rx.createdAt && rx.duration) {
    const days = statedDurationDays(rx.duration);
    const startMs = new Date(rx.createdAt).getTime();
    if (days !== null && Number.isFinite(startMs)) return startMs + days * 24 * 60 * 60 * 1000;
  }
  return null;
}

/**
 * Days the course explicitly runs for, or null when the text doesn't state one.
 *
 * Deliberately NOT `durationToDays`: that helper estimates a dispense quantity
 * and falls back to "assume 1 day" for anything it can't parse. `duration` is
 * free text that the chart's order modal merges with the instructions
 * ("<duration> — <instructions>"), so an ongoing med prescribed with only
 * instructions would inherit that 1-day default and silently stop coming due
 * on the MAR after its first day. No stated duration means no cutoff.
 */
function statedDurationDays(duration: string): number | null {
  const text = duration.trim().toLowerCase();
  const m = text.match(/(\d+(?:\.\d+)?)\s*(day|week|month|hour|hr)/);
  if (m) {
    const value = parseFloat(m[1]);
    const unit = m[2];
    const days =
      unit.startsWith('week') ? value * 7 :
      unit.startsWith('month') ? value * 30 :
      unit.startsWith('hour') || unit === 'hr' ? value / 24 :
      value;
    return Math.max(1, Math.ceil(days));
  }
  // A bare number is the one unambiguous shorthand: "7" means seven days.
  if (/^\d+(?:\.\d+)?$/.test(text)) {
    const n = parseFloat(text);
    return n > 0 ? Math.ceil(n) : null;
  }
  return null;
}

// ============================================================
// Hook: MAR entries sourced from REAL prescriptions + administration persistence
// ============================================================
export function useMarEntries() {
  const { prescriptions, administer, voidAdministration } = usePrescriptions();
  const { currentUser } = useAuth();
  const { showToast } = useToast();
  const { t } = useTranslation();
  const [marEntries, setMarEntries] = useState<MAREntry[]>([]);

  // Expand active/pending prescriptions into one row per scheduled dose for
  // today, deriving each row's status from the real administrations[] record.
  useEffect(() => {
    const day = new Date().toISOString().slice(0, 10);
    const now = Date.now();
    const HOUR = 60 * 60 * 1000;
    const entries: MAREntry[] = [];

    // A prescription is "live" for the MAR when it hasn't been fully dispensed
    // away — i.e. it's still pending (awaiting/active) or dispensed but on an
    // active admission. We surface pending + dispensed alike so an admitted
    // patient's ongoing course shows up; cancelled/complete states never set
    // `status` to those values in this model so they fall through naturally.
    for (const rx of prescriptions) {
      const times = scheduleForFrequency(rx.frequency);
      if (times.length === 0) continue;

      // A discontinued order, or one whose prescribed course has already run
      // out, must not keep producing new due/overdue/upcoming rows forever —
      // but a dose already given before the stop stays visible below, so the
      // skip is per-slot, not a blanket `continue` on the prescription.
      const stopped = rx.status === 'discontinued';
      const cutoff = doseExpansionCutoff(rx);

      for (const time of times) {
        const scheduledFor = scheduledForISO(day, time);
        // Only a non-voided administration satisfies a scheduled dose. A voided
        // entry stays in the append-only history but the slot reverts to
        // due/overdue, so a dose marked given by mistake can be re-recorded.
        const adm = (rx.administrations || []).find(a => a.scheduledFor === scheduledFor && !a.voided);

        if (!adm && (stopped || (cutoff !== null && new Date(scheduledFor).getTime() >= cutoff))) continue;

        let status: MAREntry['status'];
        if (adm) {
          // Any recorded outcome (given/held/refused/missed/corrected) closes
          // the slot for the dashboard list. Only 'given' renders as the green
          // success state; the rest still count as actioned (not pending).
          status = 'given';
        } else if (time === 'PRN') {
          // PRN doses are nurse-initiated, never overdue — show as upcoming.
          status = 'upcoming';
        } else {
          const schedMs = new Date(scheduledFor).getTime();
          if (schedMs < now - HOUR) status = 'overdue';
          else if (schedMs <= now + HOUR) status = 'due';
          else status = 'upcoming';
        }

        entries.push({
          id: `mar-${rx._id}-${time}`,
          time: time === 'PRN'
            ? 'PRN'
            : new Date(scheduledFor).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
          patientId: rx.patientId,
          patientName: rx.patientName,
          medication: rx.medication,
          dose: rx.dose,
          route: rx.route,
          status,
          givenAt: adm?.recordedAt,
          prescriptionId: rx._id,
          frequency: rx.frequency,
          scheduledFor,
          administrationStatus: adm?.status,
          administrationId: adm?.id,
        });
      }
    }

    // Sort: overdue first, then due, then upcoming, then given
    const order = { overdue: 0, due: 1, upcoming: 2, given: 3 };
    entries.sort((a, b) => order[a.status] - order[b.status]);
    setMarEntries(entries);
  }, [prescriptions]);

  // MAR: record an administration against the real prescription. Optimistic UI
  // backed by an append-only MedicationAdministration write (recordAdministration).
  const recordEntry = async (
    entry: MAREntry,
    opts?: {
      status?: MedicationAdministration['status'];
      doseGiven?: string;
      route?: string;
      reason?: string;
      notes?: string;
      witnessName?: string;
    },
  ) => {
    if (!currentUser) {
      showToast(t('nurse.medicationGivenFailedToast'), 'error');
      return false;
    }
    const status = opts?.status ?? 'given';
    const now = new Date().toISOString();

    // Optimistic UI update — slot closes; only 'given' shows the success tick.
    setMarEntries(prev => prev.map(e =>
      e.id === entry.id
        ? { ...e, status: 'given' as const, givenAt: now, administrationStatus: status }
        : e,
    ));

    try {
      await administer({
        prescriptionId: entry.prescriptionId,
        scheduledFor: entry.scheduledFor,
        status,
        doseGiven: opts?.doseGiven?.trim() || undefined,
        route: opts?.route?.trim() || undefined,
        administeredBy: currentUser._id || currentUser.username,
        administeredByName: currentUser.name,
        witnessName: opts?.witnessName?.trim() || undefined,
        reason: opts?.reason?.trim() || undefined,
        notes: opts?.notes?.trim() || undefined,
      });
      showToast(t('nurse.medicationGivenToast'), 'success');
      return true;
    } catch (err) {
      console.error('Failed to persist medication administration:', err);
      showToast(t('nurse.medicationGivenFailedToast'), 'error');
      return false;
    }
  };

  // Quick "Given" path — kept for callers that pass an entry id.
  const markGiven = async (entryId: string) => {
    const entry = marEntries.find(e => e.id === entryId);
    if (!entry) return false;
    return recordEntry(entry, { status: 'given' });
  };

  // Undo a dose recorded by mistake: void the satisfying administration entry
  // (append-only — history is preserved) so the slot reverts to due/overdue.
  const undoAdministration = async (entry: MAREntry, reason: string) => {
    if (!currentUser || !entry.administrationId) {
      showToast(t('nurse.medicationGivenFailedToast'), 'error');
      return false;
    }
    // Optimistic UI — reopen the slot immediately; the live reload reconciles.
    setMarEntries(prev => prev.map(e =>
      e.id === entry.id
        ? { ...e, status: 'due' as const, givenAt: undefined, administrationStatus: undefined, administrationId: undefined }
        : e,
    ));
    try {
      await voidAdministration(
        entry.prescriptionId,
        entry.administrationId,
        currentUser._id || currentUser.username,
        currentUser.name,
        reason,
      );
      return true;
    } catch (err) {
      console.error('Failed to void medication administration:', err);
      showToast(t('nurse.medicationGivenFailedToast'), 'error');
      return false;
    }
  };

  return { marEntries, setMarEntries, markGiven, recordEntry, undoAdministration };
}

// ============================================================
// Hook: Ward roster (admitted patients, search, urgency sort)
// ============================================================

/** Acuity a ward admission implies when the patient has no triage on record. */
export function severityAcuity(severity?: AdmissionDoc['severity']): 'RED' | 'YELLOW' | 'GREEN' | undefined {
  if (severity === 'critical') return 'RED';
  if (severity === 'severe') return 'YELLOW';
  if (severity === 'moderate' || severity === 'mild') return 'GREEN';
  return undefined;
}

export function useWardRoster(opts?: { search?: string; sortByUrgency?: boolean }) {
  const search = opts?.search ?? '';
  const sortByUrgency = opts?.sortByUrgency ?? true;

  const { patients, reload } = usePatients();
  const { triages: triageHistory } = useTriage();
  const { activeAdmissions } = useWards();
  const { globalSearch } = useUi();

  // Map patient IDs to their most recent triage for sorting and display
  const patientTriageMap = useMemo(() => {
    const map = new Map<string, typeof triageHistory[0]>();
    for (const ti of triageHistory) {
      if (!map.has(ti.patientId)) map.set(ti.patientId, ti);
    }
    return map;
  }, [triageHistory]);

  // patientId → their active admission (ward/bed, severity, admission date).
  const admissionByPatient = useMemo(() => {
    const map = new Map<string, AdmissionDoc>();
    for (const a of activeAdmissions) {
      if (!map.has(a.patientId)) map.set(a.patientId, a);
    }
    return map;
  }, [activeAdmissions]);

  // The ward roster IS the set of active admissions — "Review the ward roster:
  // see admitted patients" (onboarding copy). This used to be
  // `patients.slice(0, 12)`: the first twelve registry patients regardless of
  // admission, which put never-admitted outpatients on the ward board with
  // "—/Ward" rows and hid admitted patients that happened to sort past 12.
  // Demo fallback only when the facility has no admissions at all, so a
  // walkthrough still sees a populated board.
  const wardPatients = useMemo<WardRow[]>(() => {
    const patientById = new Map(patients.map(p => [p._id, p]));
    const admitted: WardRow[] = [];
    for (const a of activeAdmissions) {
      if (admitted.some(row => row._id === a.patientId)) continue; // one row per patient
      const doc = patientById.get(a.patientId);
      if (doc) {
        admitted.push(doc as WardRow);
        continue;
      }
      // Admission whose patient doc is outside the loaded registry — synthesize
      // a row from the admission's own denormalized identity so the occupied
      // bed is never invisible on the board.
      const parts = (a.patientName || '').trim().split(/\s+/);
      admitted.push({
        _id: a.patientId,
        firstName: parts[0] || 'Unknown',
        surname: parts.slice(1).join(' '),
        hospitalNumber: a.hospitalNumber || '',
        gender: '',
      });
    }
    const base: WardRow[] = (admitted.length > 0 || !IS_DEMO) ? admitted : DEMO_WARD_PATIENTS;

    const q = (search || globalSearch || '').toLowerCase();
    const filtered = base.filter(p =>
      !q || `${p.firstName} ${p.surname}`.toLowerCase().includes(q) || p.hospitalNumber.toLowerCase().includes(q)
    );

    if (!sortByUrgency) return filtered;

    const priorityOf = (p: WardRow) =>
      patientTriageMap.get(p._id)?.priority
      ?? p._triage?.priority
      ?? severityAcuity(admissionByPatient.get(p._id)?.severity);
    return [...filtered].sort((a, b) => priorityOrder(priorityOf(a)) - priorityOrder(priorityOf(b)));
  }, [patients, activeAdmissions, globalSearch, search, sortByUrgency, patientTriageMap, admissionByPatient]);

  return { patients, reload, triageHistory, wardPatients, patientTriageMap, admissionByPatient };
}
