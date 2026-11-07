// Shapes shared by the front-desk board pieces. Moved verbatim from page.tsx.
import { AppointmentDoc, AppointmentStatus, TriageDoc } from '@/lib/db-types';
import { type QueueStage } from '@/lib/services/patient-queue-service';

export interface QueueItem {
  id: string;
  patientId: string;
  patientName: string;
  type: 'walk-in' | 'appointment' | 'registered';
  priority: 'RED' | 'YELLOW' | 'GREEN' | 'normal';
  complaint: string;
  department: string;
  gender: string;
  age: string;
  date: string;
  time: string;
  /** Full timestamp behind `time` — drives the row's "in 2h 15m" countdown. */
  timeAt?: string;
  calendarDate: string;
  status: 'WAITING' | 'IN CONSULT' | 'DONE';
  /** Raw stage code from patient-queue-service (triage-sourced entries only) —
   *  drives the Context column via STAGE_LABELS, the same vocabulary the
   *  doctor's Queue column uses for this patient. */
  stage?: QueueStage;
  /** Stage-based label from patient-queue-service (triage-sourced entries only). */
  stageLabel?: string;
  /** Precise live state projected from the linked encounter. */
  operationalLabel?: string;
  operationalI18nKey?: string;
  /** Set when the slot closed WITHOUT the patient being seen (cancelled /
   *  rescheduled / no-show). The row files under Finished wearing this
   *  status's own pill, and never offers Checkout. */
  closedStatus?: AppointmentStatus;
  /**
   * The visit's rung on the shared appointment ladder — the SINGLE fact that
   * decides both which lane this row files into (`appointmentStatusGroup`)
   * and which pill it wears. Previously the lane came from the coarse
   * WAITING/IN CONSULT/DONE field below while the pill came from the linked
   * appointment, so a booking still on "Scheduled" showed a Scheduled pill
   * inside the In Office lane.
   */
  visitStatus: AppointmentStatus;
  waitMinutes?: number;
  overTarget?: boolean;
  /** Ordering weight — the service's acuity+wait score for triage-sourced
   *  entries, an equivalent estimate for the rest. Higher sorts first. */
  score: number;
  sourceId: string; // triage / appointment / patient ID
  encounterId?: string;
  assignedRoom?: string; // OPD exam room/bay (walk-in/triage entries only)
  assignedDoctorName?: string;
  assignedNurseName?: string;
  location?: string;
}

/** A status pick waiting for StatusChangeSlider to confirm it. */
export type DeskStatusTarget = { appt?: AppointmentDoc; triage?: TriageDoc; status: AppointmentStatus };

/** A cancel waiting for its confirmation slider. */
export type DeskCancelTarget = { appt: AppointmentDoc; triage?: TriageDoc };
