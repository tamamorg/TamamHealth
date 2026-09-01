'use client';

/**
 * Edit an appointment — the three-column form: who and when on the left, who is
 * on the visit in the middle, status and cover on the right.
 *
 * Owns its own draft state and its own save, so any screen can open it with just
 * an appointment. It was inline in the appointments page, which is why the front
 * desk had no way to show it; extracting it keeps one form rather than a copy per
 * screen that would drift the moment either changed.
 *
 * Status is saved through `updateAppointmentStatus`, never as a plain field
 * write: that path stamps confirmedAt/checkedInAt, appends the status history,
 * and enforces who may confirm.
 */
import { useEffect, useMemo, useState } from 'react';
import Modal from '@/components/Modal';
import AppointmentStatusSelect from '@/components/appointments/AppointmentStatusSelect';
import AppointmentDetailFields, { type AppointmentDetailFieldValues } from '@/components/appointments/AppointmentDetailFields';
import { staffOptionLabel, type StaffSlotContext } from '@/lib/appointment-staff';
import { useToast } from '@/components/Toast';
import { useAuth } from '@/lib/context';
import { useSettings } from '@/lib/settings/SettingsProvider';
import { appointmentStatusLabel } from '@/lib/appointment-status';
import { useUsers } from '@/lib/hooks/useUsers';
import type { AppointmentDoc, AppointmentPriority, AppointmentStatus, AppointmentType, PatientDoc } from '@/lib/db-types';
import Select from '@/components/Select';
import { stopsClickPropagation } from '@/lib/a11y';
import { usePermissions } from '@/lib/hooks/usePermissions';

const TYPE_OPTIONS: { value: AppointmentType; label: string }[] = [
  { value: 'general', label: 'General consultation' },
  { value: 'follow_up', label: 'Follow-up' },
  { value: 'specialist', label: 'Specialist' },
  { value: 'anc', label: 'Antenatal' },
  { value: 'immunization', label: 'Immunisation' },
  { value: 'lab', label: 'Laboratory' },
  { value: 'surgical', label: 'Surgical' },
  { value: 'dental', label: 'Dental' },
  { value: 'mental_health', label: 'Mental health' },
];

const DURATIONS = [15, 20, 30, 45, 60, 90];
const TIME_SLOTS = Array.from({ length: 28 }, (_, i) => {
  const minutes = 7 * 60 + i * 30;
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
});

export default function AppointmentEditModal({
  inline,
  appointment,
  appointments,
  patient,
  onClose,
  onSaved,
  headerActions,
  hideInlineTabs,
  inlineLocation,
  statusInRow,
}: {
  appointment: AppointmentDoc;
  /** Every appointment in view, for the provider conflict check. */
  appointments: AppointmentDoc[];
  patient?: PatientDoc;
  onClose: () => void;
  onSaved?: () => void;
  /** Actions rendered on the far right of the inline tab header. */
  headerActions?: React.ReactNode;
  /** Remove the inline navigation strip when the parent supplies its own row actions. */
  hideInlineTabs?: boolean;
  /** Optional nurse/ward placement control shown in the Details tab. */
  inlineLocation?: React.ReactNode;
  /**
   * The surface around this editor already carries the status control — set by
   * the worklist rows, whose header pill IS the status picker and sits two
   * lines above this panel. The editor then drops its own Status field rather
   * than offering the same seven rungs twice for one booking, and the tab it
   * lived on says what is actually left on it.
   *
   * Off everywhere else, because everywhere else there is no pill: the
   * calendar's event dialog and the standalone Edit dialog both render this
   * editor with nothing but a patient name above it.
   */
  statusInRow?: boolean;
  /**
   * Render as a panel inside the row rather than a centred dialog. The row
   * dropdown is where the doctor dashboard puts a visit's detail, so the desk's
   * rows open the same way instead of throwing a pop-up over the list.
   */
  inline?: boolean;
}) {
  const { currentUser } = useAuth();
  const { canAssignCareTeam } = usePermissions();
  const { showToast } = useToast();
  const { departments } = useSettings();
  const { users } = useUsers();
  // Providers who can carry a visit at this facility.
  const providerOptions = useMemo(() => users
    .filter(u => (u.role === 'doctor' || u.role === 'clinical_officer')
      && (!currentUser?.hospitalId || u.hospitalId === currentUser.hospitalId))
    .sort((a, b) => (a.name || '').localeCompare(b.name || '')), [users, currentUser?.hospitalId]);
  const [saving, setSaving] = useState(false);
  /* In a row dropdown the form is tabbed, the way the doctor dashboard's visit
     panel is: one tab of fields at a time on the row's own line, instead of a
     column stack that runs past the fold. The dialog shows all three at once. */
  const [tab, setTab] = useState<'appointment' | 'care' | 'billing'>('appointment');

  const [date, setDate] = useState(appointment.appointmentDate);
  const [time, setTime] = useState(appointment.appointmentTime);
  const [duration, setDuration] = useState(appointment.duration);
  const [type, setType] = useState<AppointmentType>(appointment.appointmentType);
  const [priority, setPriority] = useState<AppointmentPriority>(appointment.priority);
  const [status, setStatus] = useState<AppointmentStatus>(appointment.status);
  const [department, setDepartment] = useState(appointment.department);
  // Provider carried as id + name. Name-only saves left providerId pointing
  // at the OLD doctor after a change — conflict checks and provider filters
  // then tested the wrong person's diary.
  const [providerId, setProviderId] = useState(appointment.providerId || '');
  const [provider, setProvider] = useState(appointment.providerName);
  const [reason, setReason] = useState(appointment.reason);
  const [notes, setNotes] = useState(appointment.notes || '');
  const [detail, setDetail] = useState<AppointmentDetailFieldValues>({
    recurrence: appointment.isRecurring ? (appointment.recurrencePattern || 'weekly') : '',
    staffId: appointment.staffId || '',
    staffName: appointment.staffName || '',
    room: appointment.room || '',
  });

  // Availability is judged against the date/time being edited, not the saved
  // one, so moving the slot re-reads who is free before the provider is picked.
  const providerSlotContext: StaffSlotContext = useMemo(() => ({
    appointments, date, time, duration, excludeAppointmentId: appointment._id,
  }), [appointments, date, time, duration, appointment._id]);

  // Opening the inline editor on a different row must re-seed the whole draft.
  // The nurse worklist keeps one editor mounted while the expanded patient
  // changes; resetting only status would leak the previous patient's provider,
  // date, billing, and appointment details into the next row.
  useEffect(() => {
    setDate(appointment.appointmentDate);
    setTime(appointment.appointmentTime);
    setDuration(appointment.duration);
    setType(appointment.appointmentType);
    setPriority(appointment.priority);
    setStatus(appointment.status);
    setDepartment(appointment.department);
    setProviderId(appointment.providerId || '');
    setProvider(appointment.providerName);
    setReason(appointment.reason);
    setNotes(appointment.notes || '');
    setDetail({
      recurrence: appointment.isRecurring ? (appointment.recurrencePattern || 'weekly') : '',
      staffId: appointment.staffId || '',
      staffName: appointment.staffName || '',
      room: appointment.room || '',
    });
  }, [appointment._id]);

  useEffect(() => {
    setStatus(appointment.status);
  }, [appointment._id, appointment.status]);

  // The Cancel/Save bar only appears once the draft differs from the saved
  // appointment — a clean form has nothing to save and nothing to discard.
  // Compared against the same fallbacks the draft was seeded with, so opening
  // the form never counts as a change. staffName follows staffId and is not
  // its own signal.
  const dirty =
    date !== appointment.appointmentDate ||
    time !== appointment.appointmentTime ||
    duration !== appointment.duration ||
    type !== appointment.appointmentType ||
    priority !== appointment.priority ||
    status !== appointment.status ||
    department !== appointment.department ||
    (canAssignCareTeam && providerId !== (appointment.providerId || '')) ||
    (canAssignCareTeam && provider !== appointment.providerName) ||
    reason !== appointment.reason ||
    notes !== (appointment.notes || '') ||
    detail.recurrence !== (appointment.isRecurring ? (appointment.recurrencePattern || 'weekly') : '') ||
    (canAssignCareTeam && detail.staffId !== (appointment.staffId || '')) ||
    detail.room !== (appointment.room || '');

  const save = async () => {
    setSaving(true);
    try {
      const { updateAppointment, updateAppointmentStatus } = await import('@/lib/services/appointment-service');
      const updated = await updateAppointment(appointment._id, {
        appointmentDate: date, appointmentTime: time, duration,
        appointmentType: type, priority, department,
        reason, notes,
        ...(canAssignCareTeam ? {
          providerId,
          providerName: provider,
          staffId: detail.staffId || undefined,
          staffName: detail.staffName || undefined,
        } : {}),
        room: detail.room || undefined,
        isRecurring: Boolean(detail.recurrence),
        recurrencePattern: detail.recurrence || undefined,
      });
      if (!updated) throw new Error('The appointment could not be updated');

      // Provider/staff are visit assignments, not merely calendar decoration.
      // Mirror changes into the encounter and patient compatibility fields so
      // the assignee's worklist updates on every device.
      const providerChanged = canAssignCareTeam && providerId !== (appointment.providerId || '');
      const nurseChanged = canAssignCareTeam && detail.staffId !== (appointment.staffId || '');
      if (providerChanged && providerId) {
        const selected = providerOptions.find(option => option._id === providerId);
        const { assignProviderToPatient } = await import('@/lib/services/patient-assignment-service');
        await assignProviderToPatient({
          patientId: appointment.patientId,
          patientName: appointment.patientName,
          provider: { id: providerId, name: provider, role: selected?.role },
          actor: { id: currentUser?._id, name: currentUser?.name, role: currentUser?.role },
          hospitalId: appointment.facilityId || currentUser?.hospitalId,
          hospitalName: appointment.facilityName || currentUser?.hospitalName,
          orgId: appointment.orgId || currentUser?.orgId,
          appointmentId: appointment._id,
        });
      }
      if (nurseChanged) {
        const selected = users.find(option => option._id === detail.staffId);
        const { assignNurseToPatient } = await import('@/lib/services/patient-assignment-service');
        await assignNurseToPatient({
          patientId: appointment.patientId,
          nurse: detail.staffId ? { id: detail.staffId, name: detail.staffName || selected?.name || 'Nurse' } : null,
          actor: { id: currentUser?._id, name: currentUser?.name, role: currentUser?.role },
          hospitalId: appointment.facilityId || currentUser?.hospitalId,
          orgId: appointment.orgId || currentUser?.orgId,
          appointmentId: appointment._id,
        });
      }
      if (status !== appointment.status) {
        if (status === 'checked_in') {
          // Checking in is the one rung that is more than a status: it opens
          // the visit encounter triage, rooming, the clinician's note and the
          // checkout gate all join. `checkInAppointment` stamps the status
          // itself and is idempotent about the encounter, so this is the same
          // write plus the thread the desk needs. Writing the status alone
          // left a patient standing at the window with no visit to be seen on.
          const { checkInAppointment } = await import('@/lib/services/check-in-service');
          await checkInAppointment({
            appointmentId: appointment._id,
            patientId: appointment.patientId,
            patientName: appointment.patientName,
            hospitalNumber: patient?.hospitalNumber,
            facilityId: appointment.facilityId || currentUser?.hospitalId,
            facilityName: appointment.facilityName || currentUser?.hospitalName,
            orgId: appointment.orgId || currentUser?.orgId,
            actorId: currentUser?._id,
            actorName: currentUser?.name || currentUser?.username,
            actorRole: currentUser?.role,
          });
        } else {
          await updateAppointmentStatus(appointment._id, status, {
            actorId: currentUser?._id,
            actorName: currentUser?.name || currentUser?.username,
            actorRole: currentUser?.role,
          });
        }
      }
      showToast(`${appointment.patientName}'s appointment updated`, 'success');
      onSaved?.();
      onClose();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not save the appointment', 'error');
    } finally {
      setSaving(false);
    }
  };

  const detailProps = {
    patient,
    appointment,
    appointments,
    // The SELECTED provider, so the clash warning follows a changed pick.
    providerId: providerId || appointment.providerId,
    providerName: provider || appointment.providerName,
    date,
    time,
    duration,
    values: detail,
    onChange: (patch: Partial<AppointmentDetailFieldValues>) => setDetail(current => ({ ...current, ...patch })),
  };

  const body = (
      <div className={inline ? 'appt-edit-shell is-inline' : 'appt-edit-shell'}>
      {!inline && (
      <div className="appt-edit-head">
        <h2>Edit appointment</h2>
        <span>{appointment.appointmentDate} · {appointment.appointmentTime}</span>
      </div>
      )}
      {inline && !hideInlineTabs && (
        <div className="ehr-visit-pop-tabs" role="tablist">
          {([
            ['appointment', 'Details'],
            ['care', canAssignCareTeam ? 'Provider & staff' : 'Visit detail'],
            ['billing', statusInRow ? 'Priority & billing' : 'Status & billing'],
          ] as const).map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              className={tab === key ? 'active' : ''}
              onClick={() => setTab(key)}
            >
              {label}
            </button>
          ))}
          {headerActions && (
            <div {...stopsClickPropagation} className="appt-edit-header-actions" role="group" aria-label="Patient actions">
              {headerActions}
            </div>
          )}
        </div>
      )}
      <div className="appt-edit-grid">
        {(!inline || hideInlineTabs || tab === 'appointment') && (
        <div className="appt-edit-col">
          {inline && inlineLocation}
          {!inline && <h4 className="appt-edit-section">Location &amp; visit type</h4>}
          <AppointmentDetailFields
            section="location"
            {...detailProps}
            locationSlot={(
              <>
              <div>
                <label>Visit type</label>
                <Select value={type} onChange={e => setType(e.target.value as AppointmentType)}>
                  {TYPE_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                </Select>
              </div>
              </>
            )}
          />

          {!inline && <h4 className="appt-edit-section">Date &amp; time</h4>}
          <div className="appt-edit-row">
            <div><label>Date</label><input type="date" value={date} onChange={e => setDate(e.target.value)} /></div>
            <div><label>Time</label><Select value={time} onChange={e => setTime(e.target.value)}>{TIME_SLOTS.map(slot => <option key={slot} value={slot}>{slot}</option>)}</Select></div>
            <div><label>Duration</label><Select value={duration} onChange={e => setDuration(Number(e.target.value))}>{DURATIONS.map(d => <option key={d} value={d}>{d} min</option>)}</Select></div>
          </div>
          <div><label>Notes</label><textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} /></div>
        </div>
        )}

        {(!inline || hideInlineTabs || tab === 'care') && (
        <div className="appt-edit-col">
          {!inline && <h4 className="appt-edit-section">Provider &amp; staff</h4>}
          {canAssignCareTeam ? (
            <>
              {/* A picker, not free text, with its own Assign so the change can
                  be committed without saving the whole form. */}
              <div>
                <label>Provider</label>
                <span className="appt-assign-field">
                  <Select
                    value={providerId}
                    onChange={e => {
                      const person = providerOptions.find(p => p._id === e.target.value);
                      setProviderId(e.target.value);
                      setProvider(person ? (person.name || person.username || '') : '');
                    }}
                  >
                    <option value="">{!providerId && provider ? `${provider} (not on staff list)` : 'Unassigned'}</option>
                    {providerId && !providerOptions.some(p => p._id === providerId) && (
                      <option value={providerId}>{provider || 'Current provider'}</option>
                    )}
                    {providerOptions.map(person => (
                      <option key={person._id} value={person._id}>
                        {staffOptionLabel(person, providerSlotContext)}
                      </option>
                    ))}
                  </Select>
                  <button type="button" className="appt-assign-btn" onClick={save} disabled={saving || (providerId === (appointment.providerId || '') && provider === appointment.providerName)}>
                    {saving ? '…' : 'Assign'}
                  </button>
                </span>
              </div>
              <AppointmentDetailFields section="provider" {...detailProps} onAssignStaff={save} staffAssignDisabled={saving || detail.staffId === (appointment.staffId || '')} />
            </>
          ) : (
            <div className="appointment-billing-panel" aria-label="Assigned care team">
              <div><dt>Provider</dt><dd>{appointment.providerName || 'Unassigned'}</dd></div>
              <div><dt>Nurse</dt><dd>{appointment.staffName || 'Unassigned'}</dd></div>
            </div>
          )}

          {!inline && <h4 className="appt-edit-section">Visit detail</h4>}
          <div>
            <label>Department</label>
            <Select value={department} onChange={e => setDepartment(e.target.value)}>
              {(departments.length ? departments : [department]).map(d => <option key={d} value={d}>{d}</option>)}
            </Select>
          </div>
          <div><label>Reason</label><textarea value={reason} onChange={e => setReason(e.target.value)} rows={2} /></div>
        </div>
        )}

        {(!inline || hideInlineTabs || tab === 'billing') && (
        <div className="appt-edit-col">
          {!inline && <h4 className="appt-edit-section">Status &amp; priority</h4>}
          {/* See `statusInRow`: in a worklist row the pill above is the status
              picker, so this field would be the second one on screen. */}
          {!statusInRow && (
            <div><label>Status</label><AppointmentStatusSelect status={status} layout="bare" onChange={setStatus} /></div>
          )}
          <div>
            <label>Priority</label>
            <Select value={priority} onChange={e => setPriority(e.target.value as AppointmentPriority)}>
              <option value="routine">Routine</option>
              <option value="urgent">Urgent</option>
              <option value="emergency">Emergency</option>
            </Select>
          </div>
          <AppointmentDetailFields section="billing" {...detailProps} />
        </div>
        )}
      </div>
      {inline && hideInlineTabs && headerActions && (
        <div {...stopsClickPropagation} className="ehr-row-detail__actions appt-edit-inline-actions" role="group" aria-label="Patient actions">
          {headerActions}
        </div>
      )}
      {dirty && (
      <div className="appt-edit-actions">
        <button type="button" className="btn btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
        <button type="button" className="btn btn-primary" onClick={save} disabled={saving}>
          {saving ? 'Saving…' : `Save${status !== appointment.status ? ` · ${appointmentStatusLabel(status)}` : ''}`}
        </button>
      </div>
      )}
      </div>
  );

  if (inline) return body;
  return <Modal onClose={onClose} width={1040}>{body}</Modal>;
}
