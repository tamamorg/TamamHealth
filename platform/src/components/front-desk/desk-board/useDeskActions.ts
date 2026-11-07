import { useState, useMemo, useCallback } from 'react';
import { isNurseFamilyRole } from '@/lib/clinical-roles';
import { appointmentAmendRefusalMessage } from '@/lib/appointment-amend-message';
import { useAuth, useSync } from '@/lib/context';
import { useConfirm } from '@/components/ConfirmDialog';
import { useUsers } from '@/lib/hooks/useUsers';
import { useAppointments } from '@/lib/hooks/useAppointments';
import { useTriage } from '@/lib/hooks/useTriage';
import { useDataScope } from '@/lib/hooks/useDataScope';
import { AppointmentDoc, AppointmentStatus, EncounterDoc, PatientDoc, TriageDoc } from '@/lib/db-types';
import { formatClockTime } from '@/lib/format-utils';
import { useToast } from '@/components/Toast';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { statusWord } from '@/lib/i18n/status-word';
import { canAssignStaffAtFacility } from '@/lib/care-team-permissions';
import { formatDayMonthYear, isoDateKey, type CheckoutTarget } from '@/lib/front-desk-utils';
import { describeError } from '@/lib/user-facing-error';
import type { Dispatch, SetStateAction } from 'react';
import type { DeskCancelTarget, DeskStatusTarget } from './desk-types';

export function useDeskActions({
  confirm, t, currentUser, showToast, updateTriage, updateAppointmentStatus,
  rescheduleAppointment, scope, users, encounters, syncNow,
  cancelTarget, cancelReason, rescheduleTarget, rescheduleDate, rescheduleTime,
  setCheckoutTarget, setCheckInTarget, setNoShowTarget, setCancelReason, setCancelTarget,
  setStatusTarget, setRescheduleDate, setRescheduleTime, setRescheduleTarget, setReschedSaving,
}: {
  confirm: ReturnType<typeof useConfirm>;
  t: ReturnType<typeof useTranslation>['t'];
  currentUser: ReturnType<typeof useAuth>['currentUser'];
  showToast: ReturnType<typeof useToast>['showToast'];
  updateTriage: ReturnType<typeof useTriage>['update'];
  updateAppointmentStatus: ReturnType<typeof useAppointments>['updateStatus'];
  rescheduleAppointment: ReturnType<typeof useAppointments>['reschedule'];
  scope: ReturnType<typeof useDataScope>;
  users: ReturnType<typeof useUsers>['users'];
  encounters: EncounterDoc[];
  syncNow: ReturnType<typeof useSync>['syncNow'];
  cancelTarget: DeskCancelTarget | null;
  cancelReason: string;
  rescheduleTarget: AppointmentDoc | null;
  rescheduleDate: string;
  rescheduleTime: string;
  setCheckoutTarget: Dispatch<SetStateAction<CheckoutTarget | null>>;
  setCheckInTarget: Dispatch<SetStateAction<AppointmentDoc | null>>;
  setNoShowTarget: Dispatch<SetStateAction<AppointmentDoc | null>>;
  setCancelReason: Dispatch<SetStateAction<string>>;
  setCancelTarget: Dispatch<SetStateAction<DeskCancelTarget | null>>;
  setStatusTarget: Dispatch<SetStateAction<DeskStatusTarget | null>>;
  setRescheduleDate: Dispatch<SetStateAction<string>>;
  setRescheduleTime: Dispatch<SetStateAction<string>>;
  setRescheduleTarget: Dispatch<SetStateAction<AppointmentDoc | null>>;
  setReschedSaving: Dispatch<SetStateAction<boolean>>;
}) {
  // "Sync now" used to fire with no feedback at all, so a list that did not
  // change (a conflict row, which no sync can clear) read as a dead button.
  const [syncNowBusy, setSyncNowBusy] = useState(false);
  const runSyncNow = useCallback(async () => {
    setSyncNowBusy(true);
    try {
      await syncNow();
      showToast(t('frontDesk.syncNowDone'), 'success');
    } catch {
      showToast(t('frontDesk.syncNowFailed'), 'error');
    } finally {
      setSyncNowBusy(false);
    }
  }, [syncNow, showToast, t]);
  /** Close a stale open visit as "left without being seen": the encounter
   *  takes its terminal lwbs transition (which projects the appointment to
   *  no_show), and the triage the patient arrived through — when one is
   *  linked — is closed the same way. A person's decision, audited; never
   *  automatic. */
  const closeStaleVisitAsLwbs = useCallback(async (encounter: EncounterDoc) => {
    const name = encounter.patientName || t('frontDesk.thisPatient');
    if (!await confirm({
      title: t('confirm.frontDeskLwbsTitle'),
      message: t('confirm.frontDeskLwbsMessage', { name }),
      confirmLabel: t('confirm.frontDeskLwbsConfirm'),
      tone: 'warning',
    })) return;
    try {
      const { recordLeftWithoutBeingSeen } = await import('@/lib/services/encounter-service');
      await recordLeftWithoutBeingSeen(encounter._id, {
        actorId: currentUser?._id, reason: 'Day-end close-out at reception',
      });
      try {
        const { getTriageByEncounter } = await import('@/lib/services/triage-service');
        const triage = await getTriageByEncounter(encounter._id);
        if (triage && (triage.status === 'pending' || triage.status === 'seen')) {
          await updateTriage(triage._id, { status: 'lwbs' }, { userId: currentUser?._id, username: currentUser?.name });
        }
      } catch { /* the encounter closure is the authoritative record */ }
      showToast(t('msg.recordedAsLeftWithoutBeing2', { patientName: encounter.patientName || t('statusWord.thePatient') }), 'success');
    } catch (err) {
      showToast(describeError(err, t('msg.visitNotClosedTryAgain')), 'error');
    }
  }, [confirm, currentUser, showToast, t, updateTriage]);
  // Read out of the user once, so the memo below depends on the FIELD and not
  // on the whole user object — the compiler cannot see that a dependency list
  // naming `currentUser?.hospitalId` was meant to be narrower than the object
  // its body reads, and skips optimizing the component rather than guess.
  const myHospitalId = currentUser?.hospitalId;
  const assignableDoctors = useMemo(() => users
    .filter(u => (u.role === 'doctor' || u.role === 'clinical_officer')
      && canAssignStaffAtFacility(myHospitalId, u.hospitalId))
    .sort((a, b) => (a.name || '').localeCompare(b.name || '')), [users, myHospitalId]);

  const assignableNurses = useMemo(() => users
    .filter(u => isNurseFamilyRole(u.role)
      && canAssignStaffAtFacility(myHospitalId, u.hospitalId))
    .sort((a, b) => (a.name || '').localeCompare(b.name || '')), [users, myHospitalId]);

  const handleAssignDoctor = useCallback(async (patient: PatientDoc, doctorId: string, visit?: { triageId?: string; appointmentId?: string; encounterId?: string }) => {
    const doctor = assignableDoctors.find(d => d._id === doctorId);
    if (!doctor) { showToast(t('msg.selectADoctorToAssign'), 'error'); return; }
    try {
      const { assignProviderToPatient } = await import('@/lib/services/patient-assignment-service');
      await assignProviderToPatient({
        patientId: patient._id,
        patientName: `${patient.firstName} ${patient.surname}`.trim(),
        provider: { id: doctor._id, name: doctor.name || doctor.username || 'Provider', role: doctor.role },
        actor: { id: currentUser?._id, name: currentUser?.name, role: currentUser?.role },
        hospitalId: myHospitalId,
        hospitalName: currentUser?.hospitalName,
        orgId: currentUser?.orgId,
        triageId: visit?.triageId,
        appointmentId: visit?.appointmentId,
        encounterId: visit?.encounterId,
      });
      showToast(t('msg.patientAssignedTo', { name: doctor.name || doctor.username }), 'success');
    } catch {
      showToast(t('msg.doctorNotAssignedTryAgain'), 'error');
    }
  }, [assignableDoctors, currentUser, showToast, myHospitalId, t]);

  const handleAssignNurse = useCallback(async (patient: PatientDoc, nurseId: string, visit?: { appointmentId?: string; encounterId?: string }) => {
    const nurse = nurseId ? assignableNurses.find(n => n._id === nurseId) : null;
    if (nurseId && !nurse) { showToast(t('msg.selectANurseToAssign'), 'error'); return; }
    try {
      const { assignNurseToPatient } = await import('@/lib/services/patient-assignment-service');
      await assignNurseToPatient({
        patientId: patient._id,
        nurse: nurse ? { id: nurse._id, name: nurse.name || nurse.username || 'Nurse' } : null,
        actor: { id: currentUser?._id, name: currentUser?.name, role: currentUser?.role },
        hospitalId: myHospitalId,
        orgId: currentUser?.orgId,
        appointmentId: visit?.appointmentId,
        encounterId: visit?.encounterId,
      });
      showToast(nurse ? t('msg.nurseAssigned', { name: nurse.name || nurse.username }) : t('msg.nurseAssignmentRemoved'), 'success');
    } catch {
      showToast(t('msg.nurseNotAssignedTryAgain'), 'error');
    }
  }, [assignableNurses, currentUser, showToast, myHospitalId, t]);

  const handleSaveRoom = useCallback(async (triageId: string, room: string) => {
    try {
      await updateTriage(triageId, { assignedRoom: room || undefined });
      showToast(room ? t('msg.roomAssigned', { room }) : t('msg.roomAssignmentRemoved'), 'success');
      // Only assigning a room (not clearing one) counts as "roomed a walk-in".
    } catch {
      showToast(t('msg.roomNotAssignedTryAgain'), 'error');
    }
  }, [updateTriage, showToast, t]);

  // ── Final checkout: close out a completed visit ──
  // Stage 10 — Facility checkout gate (KAN-96). The gate decision comes from
  // evaluateCheckoutGate against LIVE data — never from a hand-asserted key
  // list, which is exactly the self-satisfying behaviour the ticket removed.
  // Unmet critical conditions BLOCK the discharge; the desk may override only
  // with an explicit reason, which is audited naming the overridden conditions.
  const handleCompleteCheckout = useCallback(async (
    target: CheckoutTarget,
    override?: { reason: string; authorizedBy: string },
    disposition?: import('@/lib/services/encounter-service').DischargeDisposition,
  ) => {
    try {
      let overrideItems = '';
      try {
        const {
          getEncounter, getOpenEncounterForPatient, dischargeEncounter,
        } = await import('@/lib/services/encounter-service');
        const enc = target.encounterId
          ? await getEncounter(target.encounterId)
          : await getOpenEncounterForPatient(target.patientId);
        if (enc) {
          const { evaluateCheckoutGate } = await import('@/lib/services/checkout-gate-service');
          const evaluation = await evaluateCheckoutGate(target.patientId, enc as never, scope);

          if (!evaluation.canDischarge && !override) {
            showToast(
              t('msg.patientNotCheckedOutComplete', { value: evaluation.blocking.map(b => b.label).join('; ') }),
              'error',
            );
            return;
          }
          if (!evaluation.canDischarge && override) {
            const { logAuditSafe } = await import('@/lib/services/audit-service');
            await logAuditSafe(
              'CHECKOUT_GATE_OVERRIDDEN', currentUser?._id, currentUser?.name,
              `Discharged patient ${target.patientId} over unmet gate conditions ` +
              `[${evaluation.blocking.map(b => b.key).join(', ')}]; reason recorded on the visit ` +
              `(authorized by ${override.authorizedBy})`,
            );
            overrideItems = evaluation.blocking.map(b => b.label).join('; ');
          }
          // A walk-out ("dismissed") keeps its disposition even over unmet
          // items — it IS the maximal pending case; otherwise unmet items
          // force discharged_with_pending_items.
          const finalDisposition = disposition === 'dismissed_without_formal_checkout'
            ? disposition
            : !evaluation.canDischarge
              ? 'discharged_with_pending_items'
              : disposition ?? 'discharged';
          await dischargeEncounter(enc._id, {
            actorId: currentUser?._id,
            actorRole: currentUser?.role,
            reason: override?.reason,
            disposition: finalDisposition,
          });
        }
      } catch (e) {
        console.warn('Encounter discharge during checkout failed', e);
        throw e;
      }

      // Both, never either/or: since check-in gives every walk-in a booking of
      // its own, a walk-in row now carries an appointment AND a triage row.
      // Completing only the appointment left the triage record active, and the
      // queue builders kept re-showing a patient who had already gone home.
      if (target.appointmentId) {
        await updateAppointmentStatus(target.appointmentId, 'completed');
      }
      if (target.triageId) {
        // 'discharged' is the terminal status in the TriageDoc status union.
        await updateTriage(target.triageId, { status: 'discharged' });
      }
      showToast(overrideItems
        ? t('msg.checkedOutWithOverride', { patientName: target.patientName, items: overrideItems })
        : t('msg.checkedOut', { patientName: target.patientName }), 'success');
      setCheckoutTarget(null);
    } catch (error) {
      showToast(error instanceof Error && error.message.includes('DISCHARGE_OVERRIDE') ? t('postConsult.clinicianAuthorization') : t('msg.patientNotCheckedOutTry'), 'error');
    }
  }, [updateAppointmentStatus, updateTriage, showToast, currentUser, scope, t, setCheckoutTarget]);

  // ── Appointment check-in lives in CheckInModal: the shared Start a visit
  //    form, with the booking pre-selected, which checks it in
  //    (`checkInAppointment`) and stamps visit type, payer and punctuality. ──

  // ── Mark an appointment a no-show. Confirmed first: a mistaken no-show
  //    hides the patient from the arrivals list, so reception gets one beat to
  //    check the waiting room before it lands. ──
  const handleNoShow = useCallback(async (appt: AppointmentDoc) => {
    try {
      await updateAppointmentStatus(appt._id, 'no_show');
      showToast(t('msg.markedAsANoShow', { patientName: appt.patientName }), 'success');
    } catch {
      showToast(t('msg.noShowNotRecordedTry'), 'error');
    } finally {
      setNoShowTarget(null);
    }
  }, [updateAppointmentStatus, showToast, t, setNoShowTarget]);

  // ── A walk-in has no booking, so its rung lives on the triage record. The
  //    desk sets it from the same dropdown a booked patient uses; triage's own
  //    clinical `status` is only touched when the visit actually closes, which
  //    is the one place the two vocabularies genuinely agree. ──
  // `silent` is set when the row also has an appointment whose own handler has
  // already reported the change — the two writes are one action to the clerk.
  const handleWalkInStatusChange = useCallback(async (triage: TriageDoc, status: AppointmentStatus, silent = false) => {
    try {
      // 'completed' closes the visit and is only ever set through the
      // checkout gate (handleCompleteCheckout) — never by a bare status write.
      if (status === 'completed') {
        setCheckoutTarget({ patientId: triage.patientId, patientName: triage.patientName,
          encounterId: triage.encounterId, triageId: triage._id });
        return;
      }
      const patch: Partial<TriageDoc> = { visitStatus: status };
      await updateTriage(triage._id, patch);
      if (!silent) showToast(t('msg.statusChangedTo', { patientName: triage.patientName, value: statusWord(t, status) }), 'success');
    } catch (err) {
      showToast(describeError(err, t('msg.statusNotChangedTryAgain')), 'error');
    }
  }, [updateTriage, showToast, t, setCheckoutTarget]);

  // ── Set any rung on the ladder straight from the row's status dropdown.
  //    Checking in, no-show and cancelling keep their own dialogs: those do
  //    more than move a status (open the visit thread; confirm before hiding
  //    the patient from the board), so the dropdown routes to them rather than
  //    writing the status behind their backs.
  //    `mirrorTriage` is the walk-in row's triage record, when there is one —
  //    written in the same action so the two records never disagree, and
  //    restored together by Undo. ──
  const handleAppointmentStatusChange = useCallback(async (
    appt: AppointmentDoc,
    status: AppointmentStatus,
    mirrorTriage?: TriageDoc,
  ) => {
    if (status === 'completed') {
      const encounter = encounters.find(enc => enc.appointmentId === appt._id)
        ?? (mirrorTriage?.encounterId ? encounters.find(enc => enc._id === mirrorTriage.encounterId) : undefined);
      setCheckoutTarget({ patientId: appt.patientId, patientName: appt.patientName,
        appointmentId: appt._id, encounterId: encounter?._id, triageId: mirrorTriage?._id });
      return;
    }
    if (status === 'checked_in') { setCheckInTarget(appt); return; }
    if (status === 'no_show') { setNoShowTarget(appt); return; }
    if (status === 'cancelled') { setCancelReason(''); setCancelTarget({ appt, triage: mirrorTriage }); return; }
    setStatusTarget({ appt, triage: mirrorTriage, status });
  }, [encounters, setCancelReason, setCancelTarget, setCheckInTarget, setCheckoutTarget, setNoShowTarget, setStatusTarget]);

  // ── A plain rung, after StatusChangeSlider confirms it. ──
  const applyAppointmentStatus = useCallback(async (
    appt: AppointmentDoc,
    status: AppointmentStatus,
    mirrorTriage?: TriageDoc,
  ) => {
    // 'rescheduled' is set directly, and means "not happening at this time, to
    // be rebooked" — the Reschedule action beside it moves a booking to a known
    // new slot in place, which leaves it scheduled, not rescheduled.
    const prevStatus = appt.status;
    const prevVisitStatus = mirrorTriage?.visitStatus;
    try {
      await updateAppointmentStatus(appt._id, status, {
        actorId: currentUser?._id,
        actorName: currentUser?.name || currentUser?.username,
        actorRole: currentUser?.role,
      });
      if (mirrorTriage) await handleWalkInStatusChange(mirrorTriage, status, true);
      if (status === 'rescheduled') {
        // One accidental click away from dropping off the live board — the
        // toast itself is the recovery path, restoring both records.
        showToast(t('msg.appointmentMarkedAsRescheduled', { patientName: appt.patientName }), 'success', {
          action: {
            label: t('action.undo'),
            onClick: async () => {
              try {
                await updateAppointmentStatus(appt._id, prevStatus, {
                  actorId: currentUser?._id,
                  actorName: currentUser?.name || currentUser?.username,
                  actorRole: currentUser?.role,
                });
                if (mirrorTriage) await updateTriage(mirrorTriage._id, { visitStatus: prevVisitStatus });
                showToast(t('msg.appointmentRestoredTo', { patientName: appt.patientName, value: statusWord(t, prevStatus) }), 'success');
              } catch {
                showToast(t('msg.appointmentNotRestoredTryAgain'), 'error');
              }
            },
          },
        });
      } else {
        showToast(t('msg.appointmentStatusChangedTo', { patientName: appt.patientName, value: statusWord(t, status) }), 'success');
      }
    } catch (err) {
      showToast(describeError(err, t('msg.appointmentStatusNotChangedTry')), 'error');
    }
  }, [updateAppointmentStatus, updateTriage, handleWalkInStatusChange, showToast, currentUser, t]);

  // ── Cancel, after the dialog confirms it. Mirrors handleNoShow, and leaves
  //    an Undo on the toast that restores the pre-cancel rung (the cancel
  //    reason stays in the status history for the audit trail). ──
  const handleCancelAppointment = useCallback(async () => {
    if (!cancelTarget) return;
    const { appt, triage } = cancelTarget;
    const prevStatus = appt.status;
    const prevVisitStatus = triage?.visitStatus;
    try {
      await updateAppointmentStatus(appt._id, 'cancelled', {
        cancelledReason: cancelReason.trim() || undefined,
        cancelledByName: currentUser?.name || currentUser?.username,
        actorId: currentUser?._id,
        actorName: currentUser?.name || currentUser?.username,
        actorRole: currentUser?.role,
      });
      if (triage) await handleWalkInStatusChange(triage, 'cancelled', true);
      showToast(t('msg.appointmentCancelled', { patientName: appt.patientName }), 'success', {
        action: {
          label: t('action.undo'),
          onClick: async () => {
            try {
              await updateAppointmentStatus(appt._id, prevStatus, {
                actorId: currentUser?._id,
                actorName: currentUser?.name || currentUser?.username,
                actorRole: currentUser?.role,
              });
              if (triage) await updateTriage(triage._id, { visitStatus: prevVisitStatus });
              showToast(t('msg.appointmentRestoredTo', { patientName: appt.patientName, value: statusWord(t, prevStatus) }), 'success');
            } catch {
              showToast(t('msg.appointmentNotRestoredTryAgain'), 'error');
            }
          },
        },
      });
    } catch {
      showToast(t('msg.appointmentNotCancelledTryAgain'), 'error');
    } finally {
      setCancelTarget(null);
      setCancelReason('');
    }
  }, [cancelTarget, cancelReason, updateAppointmentStatus, updateTriage, handleWalkInStatusChange, showToast, currentUser, t, setCancelReason, setCancelTarget]);

  // ── Move an appointment to a new date/time without leaving the desk. ──
  const openReschedule = useCallback((appt: AppointmentDoc) => {
    setRescheduleDate(isoDateKey(appt.appointmentDate));
    setRescheduleTime(appt.appointmentTime || '09:00');
    setRescheduleTarget(appt);
  }, [setRescheduleDate, setRescheduleTarget, setRescheduleTime]);

  const submitReschedule = useCallback(async () => {
    if (!rescheduleTarget || !rescheduleDate || !rescheduleTime) return;
    setReschedSaving(true);
    try {
      await rescheduleAppointment(rescheduleTarget._id, rescheduleDate, rescheduleTime);
      showToast(t('msg.appointmentMovedToAt', { patientName: rescheduleTarget.patientName, value: formatDayMonthYear(rescheduleDate), value2: formatClockTime(rescheduleTime) }), 'success');
      setRescheduleTarget(null);
    } catch (err) {
      // A booking conflict names the clash — show it rather than a shrug.
      showToast(appointmentAmendRefusalMessage(err, t) ?? describeError(err, t('msg.appointmentNotRescheduledTryAgain')), 'error');
    } finally {
      setReschedSaving(false);
    }
  }, [rescheduleTarget, rescheduleDate, rescheduleTime, rescheduleAppointment, showToast, t, setReschedSaving, setRescheduleTarget]);

  // ── Reverse an appointment check-in: send the patient back to scheduled so
  //    a mistaken "arrived" can be corrected. Appointment status has no
  //    forward-only guard, so this round-trips cleanly. (Triage check-in has
  //    no equivalent here — see BACKEND GAPS.) ──
  const handleUndoCheckIn = useCallback(async (appt: AppointmentDoc) => {
    try {
      await updateAppointmentStatus(appt._id, 'scheduled');
      showToast(t('msg.checkInReversed', { patientName: appt.patientName }), 'success');
      setCheckInTarget(null);
    } catch {
      showToast(t('msg.checkInNotReversedTry'), 'error');
    }
  }, [updateAppointmentStatus, showToast, t, setCheckInTarget]);

  // ── Reverse a completed checkout for an APPOINTMENT-sourced visit: set the
  //    appointment back to checked_in so the patient re-enters the live queue.
  //    Only appointment checkouts are reversible — a triage checkout writes the
  //    terminal `discharged` status (see BACKEND GAPS). ──
  const handleUndoCheckout = useCallback(async (appointmentId: string, patientName: string) => {
    try {
      await updateAppointmentStatus(appointmentId, 'checked_in');
      showToast(t('msg.checkoutReversed', { patientName }), 'success');
    } catch {
      showToast(t('msg.checkoutNotReversedTryAgain'), 'error');
    }
  }, [updateAppointmentStatus, showToast, t]);

  return {
    syncNowBusy, runSyncNow, closeStaleVisitAsLwbs, assignableDoctors, assignableNurses,
    handleAssignDoctor, handleAssignNurse, handleSaveRoom, handleCompleteCheckout,
    handleNoShow, handleWalkInStatusChange, handleAppointmentStatusChange,
    applyAppointmentStatus, handleCancelAppointment, openReschedule, submitReschedule,
    handleUndoCheckIn, handleUndoCheckout,
  };
}
