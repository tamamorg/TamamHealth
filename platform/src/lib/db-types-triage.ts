/**
 * Triage (ETAT — Emergency Triage Assessment & Treatment).
 * Captures the WHO ETAT ABCC assessment plus vitals taken at triage.
 * One record per triage encounter; a patient may have many over time.
 */
import type { AppointmentStatus, BaseDoc } from './db-types';

export type TriagePriority = 'RED' | 'YELLOW' | 'GREEN';
export type TriageDisposition = 'emergency' | 'general_clinic' | 'specialty_clinic' | 'telehealth' | 'home_care';
export type TriageHandoffStatus = 'awaiting_room' | 'awaiting_provider' | 'assigned' | 'acknowledged' | 'in_consultation' | 'completed';

export interface TriageDoc extends BaseDoc {
  type: 'triage';
  patientId: string;
  patientName: string;
  /**
   * Where this walk-in sits on the front desk's visit ladder (the same
   * vocabulary a booked appointment uses: arrived → checked_in → in_progress →
   * completed). Kept separate from `status`, which is triage's own clinical
   * state — a desk clerk moving someone to "Checked Out" must not silently
   * rewrite the ETAT record. Absent on older docs; the queue stage stands in.
   */
  visitStatus?: AppointmentStatus;
  hospitalNumber?: string;
  // ETAT ABCC. 'not_assessed' means exactly that — no clinician has examined
  // this dimension yet (e.g. a clerical check-in). It must never be defaulted
  // to a normal-looking value: fabricated ETAT was a KAN-100 record-integrity
  // finding.
  airway: 'clear' | 'obstructed' | 'not_assessed';
  breathing: 'normal' | 'distressed' | 'absent' | 'not_assessed';
  circulation: 'normal' | 'impaired' | 'absent' | 'not_assessed';
  consciousness: 'alert' | 'verbal' | 'pain' | 'unresponsive' | 'not_assessed';
  priority: TriagePriority;
  /**
   * Who produced the ABCC values (KAN-100): a clinician running the ETAT
   * decision tree, or clerical check-in (which records 'not_assessed' ABCC and
   * only the clerk-selected acuity). Absent on records created before the
   * field existed — treat those as unknown provenance, not as clinical.
   */
  assessmentSource?: 'clinician' | 'clerical_checkin';
  // Vitals captured at triage (optional — string for partial entry)
  temperature?: string;
  pulse?: string;
  respiratoryRate?: string;
  systolic?: string;
  diastolic?: string;
  oxygenSaturation?: string;
  weight?: string;
  painScore?: string;       // 0–10 numeric rating scale
  bloodGlucose?: string;    // mmol/L
  gcs?: string;             // Glasgow Coma Scale 3–15
  muac?: string;            // mid-upper arm circumference, cm
  // Context
  chiefComplaint?: string;
  notes?: string;
  modeOfArrival?: 'walk-in' | 'ambulance' | 'referral' | 'police' | 'other' | '';
  symptomDuration?: string;   // free text, e.g. "2 days"
  referralSource?: string;    // referring facility / person
  knownAllergies?: string;    // free text; "" / "None known" when none
  /** Clinical destination selected by the triage nurse. */
  disposition?: TriageDisposition;
  destinationClinic?: string;
  assignedProviderId?: string;
  assignedProviderName?: string;
  handoffStatus?: TriageHandoffStatus;
  handoffNote?: string;
  acknowledgedAt?: string;
  acknowledgedBy?: string;
  acknowledgedByName?: string;
  // Audit
  triagedBy: string;       // user id
  triagedByName: string;   // display name at time of triage
  triagedAt: string;       // ISO datetime (distinct from createdAt to allow backfill)
  facilityId?: string;
  facilityName?: string;
  orgId?: string;
  // Follow-through. 'lwbs' = left without being seen (terminal; pairs with the
  // encounter-level lwbs transition, KAN-100).
  status: 'pending' | 'seen' | 'admitted' | 'discharged' | 'referred' | 'lwbs';
  /**
   * OPD rooming: the exam room / bay the patient has been placed in to meet
   * the provider (e.g. "Room 3", "Bay B"). Set by front-desk/rooming staff.
   * Optional — only walk-in (triage-sourced) queue entries carry this.
   */
  assignedRoom?: string;
  handoffTo?: string;      // clinician id who took over
  handoffToName?: string;
  handoffAt?: string;
  /** The visit this triage belongs to — set by check-in-service.ts at arrival. */
  encounterId?: string;
}
