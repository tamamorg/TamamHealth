import type { PatientDoc } from '@/lib/db-types';

export interface TriageWorkflowProps {
  initialPatientId?: string;
  /**
   * Pin the form to one patient — the per-patient triage page at
   * `/triage/[patientId]`. The picker becomes a read-only identity chip, Reset
   * and a completed save keep the patient instead of clearing it, and "Recent
   * triages" narrows to that patient's own history. Without it the component is
   * the station: pick anyone, and the list is the whole facility's.
   */
  lockedPatientId?: string;
  /** Resolved patient from the focused page, including cross-facility referrals. */
  lockedPatient?: PatientDoc | null;
  /** Focused pages close after a successful save; embedded stations may reset. */
  onSaved?: () => void;
}
