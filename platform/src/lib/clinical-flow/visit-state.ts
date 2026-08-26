import type { AppointmentDoc, AppointmentStatus, EncounterDoc } from '../db-types';
import type { EncounterStatus } from './encounter-journey';

export type VisitLane = 'upcoming' | 'in_facility' | 'finished';

export interface OperationalVisitState {
  key: EncounterStatus | AppointmentStatus;
  label: string;
  i18nKey: string;
  lane: VisitLane;
}

const encounterStates: Record<EncounterStatus, Omit<OperationalVisitState, 'key'>> = {
  scheduled: { label: 'Scheduled', i18nKey: 'visitStages.scheduled', lane: 'upcoming' },
  registered: { label: 'Registered', i18nKey: 'visitStages.registered', lane: 'upcoming' },
  arrived_at_facility: { label: 'Arrived', i18nKey: 'visitStages.arrived', lane: 'in_facility' },
  awaiting_next_station: { label: 'Awaiting next station', i18nKey: 'visitStages.awaitingNextStation', lane: 'in_facility' },
  awaiting_triage: { label: 'Awaiting triage', i18nKey: 'visitStages.awaitingTriage', lane: 'in_facility' },
  in_triage: { label: 'In triage', i18nKey: 'visitStages.inTriage', lane: 'in_facility' },
  triaged_awaiting_destination: { label: 'Triage completed', i18nKey: 'visitStages.triageCompleted', lane: 'in_facility' },
  escalated_to_emergency: { label: 'Emergency care', i18nKey: 'visitStages.emergencyCare', lane: 'in_facility' },
  lwbs: { label: 'Left without being seen', i18nKey: 'visitStages.leftWithoutBeingSeen', lane: 'finished' },
  routed_to_clinic: { label: 'Awaiting clinic arrival', i18nKey: 'visitStages.awaitingClinicArrival', lane: 'in_facility' },
  arrived_at_clinic_awaiting_rooming: { label: 'Awaiting rooming', i18nKey: 'visitStages.awaitingRooming', lane: 'in_facility' },
  in_rooming: { label: 'In rooming', i18nKey: 'visitStages.inRooming', lane: 'in_facility' },
  ready_for_clinician: { label: 'Awaiting consultation', i18nKey: 'visitStages.awaitingConsultation', lane: 'in_facility' },
  transferred_to_other_clinic: { label: 'Transferring clinic', i18nKey: 'visitStages.transferringClinic', lane: 'in_facility' },
  with_clinician: { label: 'In consultation', i18nKey: 'visitStages.inConsultation', lane: 'in_facility' },
  awaiting_labs: { label: 'Awaiting lab results', i18nKey: 'visitStages.awaitingLabs', lane: 'in_facility' },
  awaiting_imaging: { label: 'Awaiting imaging', i18nKey: 'visitStages.awaitingImaging', lane: 'in_facility' },
  awaiting_pharmacy: { label: 'Awaiting pharmacy', i18nKey: 'visitStages.awaitingPharmacy', lane: 'in_facility' },
  awaiting_procedure: { label: 'Awaiting procedure', i18nKey: 'visitStages.awaitingProcedure', lane: 'in_facility' },
  ready_for_clinic_checkout: { label: 'Ready for clinic checkout', i18nKey: 'visitStages.readyForClinicCheckout', lane: 'in_facility' },
  referred_out: { label: 'Referral in progress', i18nKey: 'visitStages.referralInProgress', lane: 'in_facility' },
  admitted: { label: 'Admitted', i18nKey: 'visitStages.admitted', lane: 'finished' },
  deceased: { label: 'Deceased', i18nKey: 'visitStages.deceased', lane: 'finished' },
  consultation_paused_draft: { label: 'Consultation paused', i18nKey: 'visitStages.consultationPaused', lane: 'in_facility' },
  in_clinic_checkout: { label: 'Clinic checkout', i18nKey: 'visitStages.clinicCheckout', lane: 'in_facility' },
  clinic_complete_awaiting_next_station: { label: 'Awaiting next station', i18nKey: 'visitStages.awaitingNextStation', lane: 'in_facility' },
  awaiting_facility_checkout: { label: 'Awaiting facility checkout', i18nKey: 'visitStages.awaitingFacilityCheckout', lane: 'in_facility' },
  in_facility_checkout: { label: 'Facility checkout', i18nKey: 'visitStages.facilityCheckout', lane: 'in_facility' },
  discharged: { label: 'Discharged', i18nKey: 'visitStages.discharged', lane: 'finished' },
  discharged_with_referral: { label: 'Discharged with referral', i18nKey: 'visitStages.dischargedWithReferral', lane: 'finished' },
  discharged_with_pending_items: { label: 'Discharged with pending items', i18nKey: 'visitStages.dischargedWithPendingItems', lane: 'finished' },
  dismissed_without_formal_checkout: { label: 'Visit closed', i18nKey: 'visitStages.visitClosed', lane: 'finished' },
};

const appointmentFallbacks: Record<AppointmentStatus, Omit<OperationalVisitState, 'key'>> = {
  requested: { label: 'Requested', i18nKey: 'appointments.statusRequested', lane: 'upcoming' },
  scheduled: { label: 'Scheduled', i18nKey: 'appointments.statusScheduled', lane: 'upcoming' },
  reminder_sent: { label: 'Scheduled', i18nKey: 'appointments.statusReminderSent', lane: 'upcoming' },
  confirmed: { label: 'Scheduled', i18nKey: 'appointments.statusConfirmed', lane: 'upcoming' },
  arrived: { label: 'Arrived', i18nKey: 'appointments.statusArrived', lane: 'in_facility' },
  checked_in: { label: 'Checked in', i18nKey: 'appointments.statusCheckedIn', lane: 'in_facility' },
  triaged: { label: 'Triage completed', i18nKey: 'appointments.statusTriaged', lane: 'in_facility' },
  in_progress: { label: 'In consultation', i18nKey: 'appointments.statusInProgress', lane: 'in_facility' },
  completed: { label: 'Completed', i18nKey: 'appointments.statusCompleted', lane: 'finished' },
  no_show: { label: 'No show', i18nKey: 'appointments.statusNoShow', lane: 'finished' },
  rescheduled: { label: 'Rescheduled', i18nKey: 'appointments.statusRescheduled', lane: 'finished' },
  cancelled: { label: 'Cancelled', i18nKey: 'appointments.statusCancelled', lane: 'finished' },
};

/** The encounter is authoritative once a patient arrives; appointment status is only a fallback. */
export function resolveOperationalVisitState(
  appointment: Pick<AppointmentDoc, 'status'>,
  encounter?: Pick<EncounterDoc, 'status'> | null,
): OperationalVisitState {
  const key = encounter?.status ?? appointment.status;
  const state = encounter ? encounterStates[encounter.status] : appointmentFallbacks[appointment.status];
  return { key, ...state };
}

/** Coarse appointment projection retained for legacy consumers and reporting. */
export function appointmentStatusForEncounter(status: EncounterStatus): AppointmentStatus {
  const lane = encounterStates[status].lane;
  if (lane === 'upcoming') return 'scheduled';
  if (lane === 'finished') return status === 'lwbs' ? 'no_show' : 'completed';
  if (status === 'triaged_awaiting_destination') return 'triaged';
  if (
    status === 'with_clinician' || status === 'consultation_paused_draft' ||
    status === 'awaiting_labs' || status === 'awaiting_imaging' ||
    status === 'awaiting_pharmacy' || status === 'awaiting_procedure' ||
    status === 'ready_for_clinic_checkout' || status === 'in_clinic_checkout' ||
    status === 'clinic_complete_awaiting_next_station' ||
    status === 'awaiting_facility_checkout' || status === 'in_facility_checkout'
  ) return 'in_progress';
  return 'checked_in';
}

const activeVisitRank: Partial<Record<AppointmentStatus, number>> = {
  arrived: 0,
  checked_in: 1,
  triaged: 2,
  in_progress: 3,
  completed: 4,
};

/** Encounter catch-up transitions must never move the legacy ladder backward. */
export function nonRegressingAppointmentStatus(
  current: AppointmentStatus,
  projected: AppointmentStatus,
): AppointmentStatus {
  const currentRank = activeVisitRank[current];
  const projectedRank = activeVisitRank[projected];
  if (currentRank != null && projectedRank != null && currentRank > projectedRank) return current;
  return projected;
}
