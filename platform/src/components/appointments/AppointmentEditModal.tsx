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
import { useRouter } from 'next/navigation';
import { useUsers } from '@/lib/hooks/useUsers';
import { Video } from '@/components/icons/lucide';
import type { AppointmentDoc, AppointmentPriority, AppointmentStatus, AppointmentType, PatientDoc } from '@/lib/db-types';
import Select from '@/components/Select';

const TYPE_OPTIONS: { value: AppointmentType; label: string }[] = [
  { value: 'general', label: 'General consultation' },
  { value: 'follow_up', label: 'Follow-up' },
  { value: 'specialist', label: 'Specialist' },
  { value: 'anc', label: 'Antenatal' },
  { value: 'immunization', label: 'Immunisation' },
  { value: 'lab', label: 'Laboratory' },
  { value: 'telehealth', label: 'Telehealth' },
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
   * Render as a panel inside the row rather than a centred dialog. The row
   * dropdown is where the doctor dashboard puts a visit's detail, so the desk's
   * rows open the same way instead of throwing a pop-up over the list.
   */
  inline?: boolean;
}) {
  const router = useRouter();
  const { currentUser } = useAuth();
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
    mode: appointment.appointmentMode || (appointment.appointmentType === 'telehealth' ? 'telehealth' : 'in_office'),
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
      mode: appointment.appointmentMode || (appointment.appointmentType === 'telehealth' ? 'telehealth' : 'in_office'),
      recurrence: appointment.isRecurring ? (appointment.recurrencePattern || 'weekly') : '',
      staffId: appointment.staffId || '',
      staffName: appointment.staffName || '',
      room: appointment.room || '',
    });
  }, [appointment._id]);

  useEffect(() => {
    setStatus(appointment.status);
  }, [appointment._id, appointment.status]);

  const save = async () => {
    setSaving(true);
    try {
      const { updateAppointment, updateAppointmentStatus } = await import('@/lib/services/appointment-service');
      await updateAppointment(appointment._id, {
        appointmentDate: date, appointmentTime: time, duration,
        appointmentType: type, priority, department,
        providerId, providerName: provider, reason, notes,
        appointmentMode: detail.mode,
        staffId: detail.staffId || undefined,
        staffName: detail.staffName || undefined,
        room: detail.room || undefined,
        isRecurring: Boolean(detail.recurrence),
        recurrencePattern: detail.recurrence || undefined,
      });
      if (status !== appointment.status) {
        await updateAppointmentStatus(appointment._id, status, {
          actorId: currentUser?._id,
          actorName: currentUser?.name || currentUser?.username,
          actorRole: currentUser?.role,
        });
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
          {([['appointment', 'Details'], ['care', 'Provider & staff'], ['billing', 'Status & billing']] as const).map(([key, label]) => (
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
            <div className="appt-edit-header-actions" role="group" aria-label="Patient actions" onClick={event => event.stopPropagation()}>
              {headerActions}
            </div>
          )}
        </div>
      )}
      <div className="appt-edit-grid">
        {(!inline || hideInlineTabs || tab === 'appointment') && (
        <div className="appt-edit-col">
          {inline && inlineLocation}
          {!inline && <h4 className="appt-edit-section">Appointment mode &amp; location</h4>}
          <AppointmentDetailFields
            section="mode"
            {...detailProps}
            modeSlot={(
              <>
              {/* Telehealth needs a way in, not just a radio: the visit room is
                  the whole point of choosing it. */}
              {detail.mode === 'telehealth' && (
                <div>
                  <label>Telehealth</label>
                  <button
                    type="button"
                    className="appt-telehealth-join"
                    title="Start the telehealth visit"
                    aria-label="Start the telehealth visit"
                    onClick={() => router.push(`/telehealth/visit/${encodeURIComponent(appointment._id)}`)}
                  >
                    <Video className="w-4 h-4" aria-hidden />
                  </button>
                </div>
              )}
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
          {/* A picker, not free text, with its own Assign so the change can be
              committed without saving the whole form. */}
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
                {/* Specialty/department, free-or-busy at this slot, and the
                    day's load — so a clash is visible before the pick, not
                    after saving. */}
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
          <div><label>Status</label><AppointmentStatusSelect status={status} layout="bare" onChange={setStatus} /></div>
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
        <div className="ehr-row-detail__actions appt-edit-inline-actions" role="group" aria-label="Patient actions" onClick={event => event.stopPropagation()}>
          {headerActions}
        </div>
      )}
      <div className="appt-edit-actions">
        <button type="button" className="btn btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
        <button type="button" className="btn btn-primary" onClick={save} disabled={saving}>
          {saving ? 'Saving…' : `Save${status !== appointment.status ? ` · ${appointmentStatusLabel(status)}` : ''}`}
        </button>
      </div>
      </div>
  );

  if (inline) return body;
  return <Modal onClose={onClose} width={1040}>{body}</Modal>;
}
