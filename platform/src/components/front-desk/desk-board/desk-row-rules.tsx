import { useRouter } from 'next/navigation';
import { useUsers } from '@/lib/hooks/useUsers';
import { AppointmentDoc, AppointmentStatus, EncounterDoc, PatientDoc, TriageDoc } from '@/lib/db-types';
import { APPOINTMENT_STATUS_TONES, appointmentStatusLabel } from '@/lib/appointment-status';
import { formatCompactDateTime, formatClockTime } from '@/lib/format-utils';
import { patientRegisteredAt, patientFullName, patientGenderAge } from '@/lib/patient-utils';
import { PRIORITY_META, appointmentPriorityLabel, appointmentTriage } from '@/lib/clinical/triage-display';
import { STAGE_LABELS } from '@/lib/services/patient-queue-service';
import { waitLabel } from '@/components/ehr/EhrVisitPopup';
import { type AssignDoctorTarget } from '@/components/AssignDoctorModal';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { type EhrCareDashboardRow } from '@/components/ehr/EhrCareDashboard';
import { ClipboardCheck, LogOut, Stethoscope, FileText, RotateCcw, type LucideIcon } from '@/components/icons/lucide';
import { formatPhoneShared, formatLocationShared } from '@/lib/field-formats';
import { splitDateTime, appointmentMoment, isoDateKey, patientFacilityName, type CheckoutTarget } from '@/lib/front-desk-utils';
import { RowAppointmentEditor } from '@/components/front-desk/RowAppointmentEditor';
import { FrontDeskDetailActions, FrontDeskDetailFacts } from '@/components/front-desk/DetailPanel';
import { StaffAssignmentControl, RoomAssignmentControl } from '@/components/front-desk/AssignmentControls';
import { findActiveAppointmentForPatient } from '@/lib/appointment-workflow';
import type { Dispatch, SetStateAction } from 'react';
import type { QueueItem, DeskStatusTarget } from './desk-types';

export interface BuildFrontDeskRowsInput {
  patients: PatientDoc[];
  visiblePendingAppointments: AppointmentDoc[];
  hospitalName: string | undefined;
  canSetAppointmentStatus: boolean;
  deskStatusChoices: AppointmentStatus[];
  handleAppointmentStatusChange: (appt: AppointmentDoc, status: AppointmentStatus, mirrorTriage?: TriageDoc) => Promise<void>;
  openReschedule: (appt: AppointmentDoc) => void;
  appointments: AppointmentDoc[];
  filteredQueue: QueueItem[];
  todaysAppointments: AppointmentDoc[];
  encounterById: Map<string, EncounterDoc>;
  router: ReturnType<typeof useRouter>;
  setCheckoutTarget: Dispatch<SetStateAction<CheckoutTarget | null>>;
  setAssignTarget: Dispatch<SetStateAction<AssignDoctorTarget | null>>;
  setStatusTarget: Dispatch<SetStateAction<DeskStatusTarget | null>>;
  handleUndoCheckout: (appointmentId: string, patientName: string) => Promise<void>;
  canConsult: boolean;
  triages: TriageDoc[];
  t: ReturnType<typeof useTranslation>['t'];
  roomOptions: string[];
  handleSaveRoom: (triageId: string, room: string) => Promise<void>;
  canAssignCareTeam: boolean;
  assignableDoctors: ReturnType<typeof useUsers>['users'];
  assignableNurses: ReturnType<typeof useUsers>['users'];
  handleAssignDoctor: (patient: PatientDoc, doctorId: string, visit?: { triageId?: string; appointmentId?: string; encounterId?: string }) => Promise<void>;
  handleAssignNurse: (patient: PatientDoc, nurseId: string, visit?: { appointmentId?: string; encounterId?: string }) => Promise<void>;
  filteredRegisteredPatients: PatientDoc[];
  panelView: string;
}

/**
 * Builds the worklist rows (pending bookings, live queue, registered patients)
 * the board hands to EhrCareDashboard. Moved verbatim from page.tsx's
 * `frontDeskRows` memo; the memo and its dependency list stay in FrontDeskBoard.
 */
export function buildFrontDeskRows({
  patients, visiblePendingAppointments, hospitalName, canSetAppointmentStatus,
  deskStatusChoices, handleAppointmentStatusChange, openReschedule, appointments,
  filteredQueue, todaysAppointments, encounterById, router, setCheckoutTarget,
  setAssignTarget, setStatusTarget, handleUndoCheckout, canConsult, triages, t,
  roomOptions, handleSaveRoom, canAssignCareTeam, assignableDoctors,
  assignableNurses, handleAssignDoctor, handleAssignNurse,
  filteredRegisteredPatients, panelView,
}: BuildFrontDeskRowsInput): EhrCareDashboardRow[] {
  const patientById = new Map(patients.map(patient => [patient._id, patient]));
  const appointmentRows: EhrCareDashboardRow[] = visiblePendingAppointments.map(appointment => {
    const patient = patientById.get(appointment.patientId);
    return {
      id: `pending-appt-${appointment._id}`,
      photoUrl: (patient as { photoUrl?: string } | undefined)?.photoUrl,
      title: appointment.patientName,
      // The sub-line is the chief complaint alone — no demographics, no
      // department; those live in the row's other columns and the popup.
      subtitle: appointment.reason || 'Scheduled visit',
      meta: `${formatClockTime(appointment.appointmentTime) || 'No time'} · ${appointment.providerName || patient?.assignedDoctorName || 'Unassigned'} · ${appointment.facilityName || hospitalName || 'Facility'}`,
      compactMeta: formatClockTime(appointment.appointmentTime) || 'No time',
      time: formatClockTime(appointment.appointmentTime) || undefined,
      timeSecondary: isoDateKey(appointment.appointmentDate),
      timeAt: appointmentMoment(appointment.appointmentDate, appointment.appointmentTime),
      careTeam: appointment.providerName || patient?.assignedDoctorName || 'Doctor unassigned',
      // The nurse cell falls back to the booking exactly as the doctor cell
      // above does — without this, an appointment whose staffName was set at
      // booking read "Nurse unassigned" until reception stamped the patient.
      careTeamSecondary: patient?.assignedNurseName || appointment.staffName || 'Nurse unassigned',
      careTeamLabel: 'Care team',
      location: appointment.department || appointment.facilityName || patientFacilityName(patient, hospitalName || 'Facility'),
      locationSecondary: appointment.department ? patientFacilityName(patient, hospitalName || 'Facility') : 'Location',
      locationLabel: appointment.department ? 'Department' : 'Location',
      // The pill states the rung the booking is actually on — Reminder Sent
      // and Arrived used to collapse into a flat "Scheduled", which hid the
      // desk's own work from it.
      status: appointment.status,
      statusLabel: appointmentStatusLabel(appointment.status),
      // The pill IS the picker: reception moves a booking along the ladder
      // from the row it is reading. Check-in, no-show and cancel route to
      // their own dialogs (see handleAppointmentStatusChange) rather than
      // being written straight from a dropdown.
      statusValue: appointment.status,
      // `requested` is not a rung reception can pick, so a request row carries
      // it as its current (read-only) option and the pill still reads
      // "Requested"; answering it is the Appointment requests list's job.
      statusOptions: canSetAppointmentStatus
        ? [
            ...(appointment.status === 'requested' ? [{ value: 'requested', label: appointmentStatusLabel('requested') }] : []),
            ...deskStatusChoices.map(option => ({ value: option, label: appointmentStatusLabel(option) })),
          ]
        : undefined,
      onStatusChange: canSetAppointmentStatus
        ? value => handleAppointmentStatusChange(appointment, value as AppointmentStatus)
        : undefined,
      // The line under the pill states the booking's urgency in the shared
      // Emergency/Urgent/Routine words. It used to write 'Appointment' for
      // anything routine — the row's type, not its priority — so the column
      // read in two vocabularies at once and the majority of rows said
      // nothing about how urgent they were.
      statusSecondary: appointmentPriorityLabel(appointment.priority),
      statusTone: APPOINTMENT_STATUS_TONES[appointment.status],
      // Move the booking to a known new slot. The dialog and its save path
      // were both still here; the row action that opened them had gone, so
      // `openReschedule` was unreachable and the dialog could never appear —
      // which is exactly what the row type's own docs name as this screen's
      // example of an extra action.
      extraActions: canSetAppointmentStatus
        ? [{ label: 'Reschedule', onClick: () => openReschedule(appointment) }]
        : undefined,
      // Every booking carries its acuity code, routine included. The word and
      // its colour come from the same value, so "Routine" is green here and
      // on the clinician's worklist rather than green on rows that happen to
      // have been triaged and grey on the ones that have not.
      priority: appointmentTriage(appointment.priority),
      date: isoDateKey(appointment.appointmentDate),
      patientId: appointment.patientId,
      // The row drops down into the appointment itself, the way the doctor
      // dashboard's rows drop down into a visit — no pop-up over the list, and
      // nothing restating what the row already shows. It carries no link out
      // to the Appointments page either: the drop-down IS the review, and
      // sending the desk to the calendar to read a booking it already has
      // open costs them the queue they were working.
      popupDetail: (
        <RowAppointmentEditor
          appointment={appointment}
          appointments={appointments}
          patient={patient}
        />
      ),
    };
  });

  const queueRows = filteredQueue.map(entry => {
    const patient = patients.find(pp => pp._id === entry.patientId);
    const activeForCare = entry.status === 'WAITING' || entry.status === 'IN CONSULT';
    // A slot closed without the patient being seen is finished, but there is
    // no visit to check out — it gets its own pill, never the Checkout action.
    const checkoutReady = entry.status === 'DONE' && !entry.closedStatus && entry.visitStatus !== 'completed';
    // Triage-sourced rows carry the real acuity code, so they get the same
    // RED/YELLOW/GREEN pill the doctor and nurse see for this patient.
    // Appointment/registration rows have no acuity — the pill falls back
    // to the status label instead (handled by the shared row renderer).
    const acuity = entry.priority === 'RED' || entry.priority === 'YELLOW' || entry.priority === 'GREEN'
      ? entry.priority
      : undefined;
    // Status column: the plain human state, distinct from the stage
    // vocabulary now shown in Context.
    const statusLabel = entry.status === 'DONE'
      ? (entry.stageLabel || 'Done')
      : entry.status === 'IN CONSULT'
        ? 'In consult'
        : 'Waiting';
    // Context column: for triage-sourced rows, the same stage vocabulary
    // (STAGE_LABELS) the doctor's Queue column shows for this patient;
    // arrived-but-untriaged appointments show their department instead;
    // checkout-only rows (no triage/appointment on file today) keep the
    // honest 'Checkout' state already on the entry.
    const context = entry.operationalI18nKey ? t(entry.operationalI18nKey) : entry.operationalLabel || (entry.stage ? STAGE_LABELS[entry.stage]
      : entry.type === 'appointment' ? entry.department
      : entry.location || entry.department);
    // Same shared acuity words the Appointments tab of this very dashboard
    // uses; this branch called RED "Critical", so one column said two
    // different things depending on which tab you were on.
    const statusContext = acuity ? PRIORITY_META[acuity].label : entry.stageLabel || context;
    // Wait column: the actual queue/slot time, on its own line.
    const waitTime = entry.time || entry.date || undefined;

    // Whatever this row is really about: a booking, or a walk-in's triage
    // record. Both carry the same ladder, so the desk sets status the same
    // way for every patient in the building. Computed up front (not just
    // inside the ladder-status block below) so checkout below can complete
    // the SAME linked appointment for a triage-sourced row, not only rows
    // whose queue entry happened to originate as 'appt-'.
    const queueAppointment = entry.id.startsWith('appt-')
      ? todaysAppointments.find(a => a._id === entry.sourceId)
      // A triage-sourced row still belongs to a booking when the patient has
      // one today — check-in now creates one for every walk-in, so the row
      // gets the same ladder and the same panel as anyone else. Matched via
      // the row's own encounter link first (never the first same-patient
      // appointment of the day regardless of status — see
      // `findActiveAppointmentForPatient`), which is what lets checkout
      // below complete the SAME booking the row is actually about instead of
      // an earlier cancelled one.
      : findActiveAppointmentForPatient(todaysAppointments, entry.patientId, encounterById.get(entry.encounterId || '')?.appointmentId);

    // Icon actions for the row's inline panel. "Open chart" is always
    // offered; the primary desk action (Checkout/Assign) and the secondary
    // one (Undo/Start consultation) mirror the same state machine the old
    // popup's buttons used — a plain "Record" fallback isn't needed here
    // since Open chart already covers it.
    const popupActions: { icon: LucideIcon; label: string; onClick: () => void; primary?: boolean }[] = [
      { icon: FileText, label: 'Open Chart', onClick: () => router.push(`/patients/${entry.patientId}`) },
    ];
    if (checkoutReady) {
      popupActions.push({
        icon: LogOut,
        label: t('frontDesk.checkout'),
        primary: true,
        onClick: () => setCheckoutTarget({
          patientId: entry.patientId,
          patientName: entry.patientName,
          hospitalNumber: patient?.hospitalNumber,
          encounterId: entry.encounterId,
          // Every walk-in now has its own booking (check-in-service), so a
          // triage-sourced row must complete it too — otherwise the queue
          // row reads DONE while its appointment sits at checked_in forever.
          appointmentId: queueAppointment?._id,
          triageId: entry.id.startsWith('triage-') ? entry.sourceId : undefined,
        }),
      });
    } else if (activeForCare) {
      popupActions.push({
        icon: Stethoscope,
        label: t('frontDesk.assign'),
        primary: true,
        onClick: () => setAssignTarget({
          patientId: entry.patientId,
          patientName: entry.patientName,
          hospitalNumber: patient?.hospitalNumber,
          triageId: entry.id.startsWith('triage-') ? entry.sourceId : undefined,
          currentDoctorId: patient?.assignedDoctor,
          stationAssignments: patient?.stationAssignments,
        }),
      });
    }
    if (checkoutReady && entry.id.startsWith('appt-')) {
      popupActions.push({ icon: RotateCcw, label: t('action.undo'), onClick: () => handleUndoCheckout(entry.sourceId, entry.patientName) });
    } else if (canConsult && activeForCare) {
      popupActions.push({ icon: Stethoscope, label: t('frontDesk.startConsultation'), onClick: () => router.push(`/consultation?patientId=${entry.patientId}`) });
    }
    const hasAllergies = Boolean(patient?.allergies?.length) && patient?.allergies[0] !== 'None known';

    const queueTriage = entry.id.startsWith('triage-')
      ? triages.find(tr => tr._id === entry.sourceId)
      : undefined;
    // The pill reads the SAME field the lane was filed by, so a row can
    // never show "Scheduled" while sitting under In Office. Resolved once,
    // when the queue item was built.
    const ladderStatus = entry.visitStatus;
    return {
      id: entry.id,
      photoUrl: (patient as { photoUrl?: string } | undefined)?.photoUrl,
      title: entry.patientName,
      subtitle: entry.complaint,
      meta: `${entry.gender} · ${entry.age}${entry.assignedDoctorName ? ` · ${entry.assignedDoctorName}` : ''}`,
      compactMeta: entry.waitMinutes != null ? waitLabel(entry.waitMinutes) : (entry.time || entry.date),
      time: waitTime,
      timeSecondary: entry.waitMinutes != null ? waitLabel(entry.waitMinutes) : entry.calendarDate,
      timeAt: entry.timeAt,
      status: entry.status.toLowerCase(),
      statusLabel: entry.operationalI18nKey
        ? t(entry.operationalI18nKey)
        : entry.operationalLabel || (ladderStatus ? appointmentStatusLabel(ladderStatus) : statusLabel),
      statusSecondary: statusContext,
      // Colour by meaning (slate/blue/purple/green/red), from the shared rule.
      statusTone: entry.visitTone,
      visitTone: entry.visitTone,
      visitTab: entry.visitTab,
      // A queue row is movable too — advancing a checked-in patient to
      // Roomed, or closing them out, is the desk's most common action. The
      // walk-in's triage row is mirrored in the same write so the two
      // records never disagree (see the handler).
      statusValue: ladderStatus,
      statusOptions: canSetAppointmentStatus
        ? deskStatusChoices.map(option => ({ value: option, label: appointmentStatusLabel(option) }))
        : undefined,
      onStatusChange: canSetAppointmentStatus
        ? async (value: string) => {
            const next = value as AppointmentStatus;
            if (queueAppointment) await handleAppointmentStatusChange(queueAppointment, next, queueTriage);
            else if (next === 'completed') {
              // Completed always goes through the checkout gate, booking or
              // not — a queue row with no matching booking used to fall
              // through to the plain status slider and discharge the triage
              // with no balance / critical-item / disposition check.
              setCheckoutTarget({
                patientId: entry.patientId,
                patientName: entry.patientName,
                hospitalNumber: patient?.hospitalNumber,
                encounterId: entry.encounterId,
                triageId: queueTriage?._id,
              });
            }
            else if (queueTriage) setStatusTarget({ triage: queueTriage, status: next });
          }
        : undefined,
      priority: acuity,
      room: entry.assignedRoom,
      careTeam: entry.assignedDoctorName || 'Doctor unassigned',
      careTeamSecondary: entry.assignedNurseName || 'Nurse unassigned',
      careTeamLabel: 'Care team',
      location: context,
      locationSecondary: entry.stage ? entry.department : entry.location || entry.department,
      locationLabel: entry.stage ? 'Stage' : entry.type === 'appointment' ? 'Department' : 'Location',
      date: entry.calendarDate,
      patientId: entry.patientId,
      // A row with a booking opens the appointment editor in the drop-down
      // below, so it needs no link out. A row without one has no booking to
      // read — its full-page view is the patient's record.
      detailHref: queueAppointment
        ? undefined
        : `/patients/${encodeURIComponent(entry.patientId)}?returnTo=${encodeURIComponent('/dashboard/front-desk')}`,
      detailLabel: queueAppointment ? undefined : t('dashboard.viewPatientRecord'),
      // The same panel a Scheduled row opens — tabs for the appointment,
      // provider & staff, and status & billing — so a patient's row looks
      // and behaves the same wherever they are in the day. Decided by the
      // row's OWN kind, not by whether an appointment matched: every walk-in
      // now has its own booking (check-in-service), so `queueAppointment`
      // alone would swap a triage/queue row over to this panel too and hide
      // the exam-room / doctor / nurse assignment controls below, which are
      // built for exactly those patients.
      // Having a booking is what decides the panel — not what kind of row it
      // came from. The old test (`entry.id.startsWith('appt-')`) meant a
      // patient who arrived as a walk-in kept the legacy facts-and-assign
      // panel even after check-in gave them a real appointment, so the same
      // booking looked different depending on which door it came through.
      // Rows with no booking at all still get the legacy panel: there is
      // nothing for the editor to edit.
      popupDetail: queueAppointment ? (
        <>
        {checkoutReady && <FrontDeskDetailActions actions={popupActions} />}
        <RowAppointmentEditor
          appointment={queueAppointment}
          appointments={appointments}
          patient={patient}
        />
        </>
      ) : (
        <>
          <FrontDeskDetailActions actions={popupActions} />
          <FrontDeskDetailFacts facts={[
            { label: t('patient.phone'), value: patient?.phone ? formatPhoneShared(patient.phone) : undefined },
            { label: 'Hospital number', value: patient?.hospitalNumber },
          ]} />
          {hasAllergies && (
            <p className="ehr-care-alert">{t('frontDesk.allergiesLabel', { list: (patient?.allergies ?? []).join(', ') })}</p>
          )}
          {/* Room, doctor and nurse share one line — three stacked blocks ate
              more of the row panel than the fields they contain. */}
          <div className="ehr-care-assign-grid">
          {entry.id.startsWith('triage-') && (
            <RoomAssignmentControl
              triageId={entry.sourceId}
              currentRoom={entry.assignedRoom}
              priority={entry.priority}
              roomOptions={roomOptions}
              onSave={handleSaveRoom}
            />
          )}
          {/* Room, doctor, nurse — the three things reception routes, all in
              the row, all the same control. */}
          {canAssignCareTeam && patient && (
            <>
              <StaffAssignmentControl
                icon={Stethoscope}
                label={t('adminUsers.role_doctor')}
                staff={assignableDoctors}
                currentId={patient.assignedDoctor}
                currentName={patient.assignedDoctorName}
                emptyLabel={t('noteEditor.unassigned')}
                onSave={doctorId => handleAssignDoctor(patient, doctorId, {
                  triageId: entry.id.startsWith('triage-') ? entry.sourceId : undefined,
                  encounterId: entry.encounterId,
                })}
              />
              <StaffAssignmentControl
                icon={ClipboardCheck}
                label={t('adminUsers.role_nurse')}
                staff={assignableNurses}
                currentId={patient.assignedNurse}
                currentName={patient.assignedNurseName}
                emptyLabel={t('noteEditor.unassigned')}
                onSave={nurseId => handleAssignNurse(patient, nurseId, {
                  encounterId: entry.encounterId,
                })}
              />
            </>
          )}
          </div>
        </>
      ),
    };
  });

  const makeRegisteredRow = (patient: PatientDoc): EhrCareDashboardRow => {
    const registered = splitDateTime(patientRegisteredAt(patient));
    return {
      id: `registered-${patient._id}`,
      photoUrl: (patient as { photoUrl?: string }).photoUrl,
      title: patientFullName(patient),
      subtitle: patient.hospitalNumber || patientGenderAge(patient),
      meta: `${patientGenderAge(patient)} · ${registered.date}${registered.time ? ` · ${registered.time}` : ''}`,
      compactMeta: registered.time || registered.date,
      time: registered.time || undefined,
      timeSecondary: registered.date,
      timeAt: registered.time ? patientRegisteredAt(patient) : undefined,
      careTeam: patient.assignedDoctorName || 'Doctor unassigned',
      careTeamSecondary: patient.assignedNurseName || 'Nurse unassigned',
      careTeamLabel: 'Care team',
      location: patientFacilityName(patient, hospitalName || 'Registration'),
      locationSecondary: formatLocationShared([patient.county, patient.state]) || 'Location',
      locationLabel: 'Location',
      status: 'registered',
      statusLabel: 'Registered',
      statusSecondary: patient.assignmentStatus === 'completed'
        ? 'Visit completed'
        : patient.assignmentStatus === 'accepted' || patient.assignmentStatus === 'in_progress'
          ? 'Provider accepted'
          : patient.assignedDoctor
            ? 'Assigned'
            : 'Needs care team',
      statusTone: 'ready',
      date: isoDateKey(patientRegisteredAt(patient)),
      patientId: patient._id,
      detailHref: `/patients/${encodeURIComponent(patient._id)}?returnTo=${encodeURIComponent('/dashboard/front-desk')}`,
      detailLabel: t('dashboard.viewPatientRecord'),
      popupDetail: (
        <>
          <FrontDeskDetailActions actions={[
            { icon: FileText, label: 'Open Chart', onClick: () => router.push(`/patients/${patient._id}`), primary: true },
            {
              icon: Stethoscope,
              label: patient.assignedDoctor ? t('frontDesk.reassign') : t('frontDesk.assign'),
              onClick: () => setAssignTarget({
                patientId: patient._id,
                patientName: patientFullName(patient),
                hospitalNumber: patient.hospitalNumber,
                currentDoctorId: patient.assignedDoctor,
                stationAssignments: patient.stationAssignments,
              }),
            },
          ]} />
          <FrontDeskDetailFacts facts={[
            { label: t('patient.phone'), value: patient.phone ? formatPhoneShared(patient.phone) : undefined },
            { label: 'Assigned doctor', value: patient.assignedDoctorName },
            {
              label: t('frontDesk.lastVisit'),
              value: patient.lastConsultedAt ? formatCompactDateTime(patient.lastConsultedAt) : (patient.lastVisitDate || t('frontDesk.firstVisit')),
            },
          ]} />
        </>
      ),
    };
  };

  const registeredRows: EhrCareDashboardRow[] = filteredRegisteredPatients.map(makeRegisteredRow);

  if (panelView === 'pending') return appointmentRows;
  if (panelView === 'queue') return queueRows;
  if (panelView === 'registered') return registeredRows;
  return [...appointmentRows, ...queueRows];
}
