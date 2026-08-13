'use client';

/**
 * The rest of an appointment, below its status: how and where the visit happens,
 * who else is on it, which room it needs, and what the patient's cover looks
 * like. Everything here was missing from the edit form, which had only
 * date/time/duration/type/priority/department/provider/reason/notes.
 *
 * Split out of the appointments page rather than inlined: that page is already
 * ~1,400 lines and is edited often, and these fields are a self-contained group
 * with their own data (facilities, staff, rooms, insurance).
 *
 * Read-only by design: Billing & Insurance shows what the payer record already
 * says. Cover is edited where policies are managed, not while moving a booking.
 */
import { useMemo, type ReactNode } from 'react';
import { useUsers } from '@/lib/hooks/useUsers';
import { usePatientPayments } from '@/lib/hooks/usePayments';
import { useSettings } from '@/lib/settings/SettingsProvider';
import { formatDate } from '@/lib/format-utils';
import { isTimeOverlap } from '@/lib/appointment-time';
import { APPOINTMENT_SLOT_RELEASED_STATUSES } from '@/lib/appointment-status';
import { staffOptionLabel, type StaffSlotContext } from '@/lib/appointment-staff';
import type { AppointmentDoc, PatientDoc } from '@/lib/db-types';
import { AlertTriangle } from '@/components/icons/lucide';
import Select from '@/components/Select';

export interface AppointmentDetailFieldValues {
  mode: 'in_office' | 'telehealth';
  recurrence: '' | 'weekly' | 'biweekly' | 'monthly' | 'quarterly';
  staffId: string;
  staffName: string;
  room: string;
}

export default function AppointmentDetailFields({
  section,
  modeSlot,
  onAssignStaff,
  staffAssignDisabled,
  patient,
  appointment,
  appointments,
  providerId,
  providerName,
  date,
  time,
  duration,
  values,
  onChange,
}: {
  patient?: PatientDoc;
  /** The appointment being edited, so its own row is excluded from conflicts. */
  appointment?: AppointmentDoc;
  /** Every appointment already loaded by the page, for the conflict check. */
  appointments: AppointmentDoc[];
  providerId?: string;
  providerName?: string;
  date: string;
  time: string;
  duration: number;
  values: AppointmentDetailFieldValues;
  onChange: (patch: Partial<AppointmentDetailFieldValues>) => void;
  /** Which of the design's column groups to render. Omit for all of them. */
  section?: 'mode' | 'provider' | 'billing';
  /** Rendered directly under the mode radios — the caller owns the field, this
   *  just decides where in the group it belongs. */
  modeSlot?: ReactNode;
  /** Commits the staff choice on its own, without saving the whole form. */
  onAssignStaff?: () => void;
  staffAssignDisabled?: boolean;
}) {
  const { users } = useUsers();
  const { rooms } = useSettings();
  const { policies, balance } = usePatientPayments(patient?._id);

  // Staff who can be the second person on a visit — nursing and front-of-house
  // roles, not the provider carrying it.
  const staffOptions = useMemo(() => users
    .filter(u => ['nurse', 'midwife', 'clinical_officer', 'front_desk', 'clinic_clerk'].includes(u.role || ''))
    .sort((a, b) => (a.name || '').localeCompare(b.name || '')), [users]);

  /**
   * Does this slot collide with another booking for the same provider? Same rule
   * the service enforces on create (`isTimeOverlap`, ignoring cancelled and
   * no-show rows) — surfaced here so the clash is visible while editing instead
   * of only as a thrown error on save.
   */
  const conflict = useMemo(() => {
    if (!providerId || !date || !time) return null;
    return appointments.find(other =>
      other._id !== appointment?._id
      && other.providerId === providerId
      && other.appointmentDate === date
      && !APPOINTMENT_SLOT_RELEASED_STATUSES.includes(other.status)
      && isTimeOverlap(other.appointmentTime, other.duration, time, duration)
    ) || null;
  }, [appointments, appointment?._id, providerId, date, time, duration]);

  // Shared by every person dropdown here, so "free" always means free at the
  // slot currently being edited rather than at the appointment's saved time.
  const slotContext: StaffSlotContext = useMemo(() => ({
    appointments, date, time, duration, excludeAppointmentId: appointment?._id,
  }), [appointments, date, time, duration, appointment?._id]);

  const primaryPolicy = policies.find(p => p.isPrimary) || policies[0];

  const showMode = !section || section === 'mode';
  const showProvider = !section || section === 'provider';
  const showBilling = !section || section === 'billing';

  return (
    <>
      {showMode && (<>
      {/* ── How and where ─────────────────────────────────────────────── */}
      <div>
        <label>Appointment mode</label>
        <div style={{ display: 'flex', gap: 18, padding: '6px 0' }}>
          {([['in_office', 'In office'], ['telehealth', 'Telehealth']] as const).map(([value, label]) => (
            <label key={value} style={{ display: 'flex', alignItems: 'center', gap: 7, textTransform: 'none', fontSize: 13, cursor: 'pointer' }}>
              <input
                type="radio"
                name="appointment-mode"
                checked={values.mode === value}
                onChange={() => onChange({ mode: value })}
                style={{ width: 15, height: 15 }}
              />
              {label}
            </label>
          ))}
        </div>
      </div>
      {modeSlot}

      <>
        <div>
          <label>Room</label>
          <Select value={values.room} onChange={e => onChange({ room: e.target.value })}>
            <option value="">No room</option>
            {rooms.map(room => <option key={room} value={room}>{room}</option>)}
          </Select>
        </div>
      </>

      <div>
        <label>Recurrence</label>
        <Select value={values.recurrence} onChange={e => onChange({ recurrence: e.target.value as AppointmentDetailFieldValues['recurrence'] })}>
          <option value="">Does not repeat</option>
          <option value="weekly">Weekly</option>
          <option value="biweekly">Every 2 weeks</option>
          <option value="monthly">Monthly</option>
          <option value="quarterly">Quarterly</option>
        </Select>
      </div>
      </>)}

      {showProvider && (<>
      {/* ── Who else is on it ─────────────────────────────────────────── */}
        <div>
          <label>Staff</label>
          <span className="appt-assign-field">
<Select
            value={values.staffId}
            onChange={e => {
              const person = staffOptions.find(candidate => candidate._id === e.target.value);
              onChange({ staffId: e.target.value, staffName: person?.name || person?.username || '' });
            }}
          >
            <option value="">None</option>
            {/* Role/department, whether they are free at this slot, and how
                many visits they already hold today — the facts the pick turns
                on, rather than a wall of interchangeable names. */}
            {staffOptions.map(person => (
              <option key={person._id} value={person._id}>{staffOptionLabel(person, slotContext)}</option>
            ))}
          </Select>
            {onAssignStaff && (
              <button type="button" className="appt-assign-btn" onClick={onAssignStaff} disabled={staffAssignDisabled}>Assign</button>
            )}
          </span>
        </div>

      {/* The provider clash, stated where the time is being chosen. */}
      {conflict && (
        <p
          role="status"
          style={{ display: 'flex', alignItems: 'center', gap: 6, margin: 0, fontSize: 12, fontWeight: 600, color: 'var(--color-danger-text)' }}
        >
          <AlertTriangle className="w-3.5 h-3.5" />
          {providerName || 'This provider'} already has {conflict.patientName} at {conflict.appointmentTime} — conflicts with another appointment.
        </p>
      )}

      </>)}

      {showBilling && (
      <div className="appointment-billing-panel">
          <div><dt>Balance</dt><dd>{balance ? `SSP ${balance.toLocaleString()}` : 'Nothing due'}</dd></div>
          {primaryPolicy ? (
            <>
              <div><dt>Insurer</dt><dd>{primaryPolicy.payerName}</dd></div>
              <div><dt>Cover from</dt><dd>{primaryPolicy.effectiveDate ? formatDate(primaryPolicy.effectiveDate) : 'Not specified'}</dd></div>
              <div><dt>Co-pay</dt><dd>{typeof primaryPolicy.copayAmount === 'number' ? `SSP ${primaryPolicy.copayAmount.toLocaleString()}` : '—'}</dd></div>
              <div><dt>Cover status</dt><dd>{primaryPolicy.isActive ? 'Active' : 'Lapsed — patient pays'}</dd></div>
            </>
          ) : (
            <div><dt>Insurer</dt><dd>None — patient pays</dd></div>
          )}
      </div>
      )}
    </>
  );
}
