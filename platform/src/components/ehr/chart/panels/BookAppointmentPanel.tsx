'use client';

/**
 * Create new appointment — the chart's booking workspace, in the OpenMRS O3
 * shape: Service, Appointment type, Recurring, Appointment time (date, time,
 * duration), Provider, the second staff member, the date it was scheduled, and
 * a note, with Discard / Save and close pinned at the foot.
 *
 * It writes the SAME appointment the front desk's booking flow writes
 * (`createAppointment`, source 'staff', status 'scheduled', no confirmedAt), so
 * a booking made here lands on the desk's board for that day and on the desk's
 * bell as "to confirm" the moment it is saved — confirming stays the desk's
 * step (see AppointmentEditModal). The service's conflict rule runs live as
 * the time and people change, so a clash with the provider's or the nurse's
 * calendar shows before Save rather than on it.
 */

import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/lib/context';
import { useToast } from '@/components/Toast';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { usePermissions } from '@/lib/hooks/usePermissions';
import { useAppointments } from '@/lib/hooks/useAppointments';
import { useUsers } from '@/lib/hooks/useUsers';
import { useVisitReasons } from '@/lib/hooks/useVisitReasons';
import { useDepartments } from '@/lib/hooks/useDepartments';
import { canAssignStaffAtFacility } from '@/lib/care-team-permissions';
import { mirrorBookingCareTeam } from '@/lib/booking/mirror-booking-care-team';
import { serverBookingConflict, withServerConflictCheck } from '@/lib/booking/server-conflict-check';
import { createBookingSeries, SERIES_DEFAULT, SERIES_MAX, SERIES_MIN } from '@/lib/booking/recurring-series';
import { describeError } from '@/lib/user-facing-error';
import { jubaDate, jubaTime } from '@/lib/time-juba';
import { formatDate } from '@/lib/format-utils';
import InlineBanner from '@/components/overlay/InlineBanner';
import type { AppointmentType, FacilityLevel, PatientDoc } from '@/lib/db-types';
import './book-appointment-panel.css';

const TYPE_OPTIONS: { value: AppointmentType; labelKey: string }[] = [
  { value: 'general', labelKey: 'appointments.typeGeneral' },
  { value: 'follow_up', labelKey: 'appointments.typeFollowUp' },
  { value: 'specialist', labelKey: 'appointments.typeSpecialist' },
  { value: 'anc', labelKey: 'appointments.typeAnc' },
  { value: 'immunization', labelKey: 'appointments.typeImmunization' },
  { value: 'lab', labelKey: 'appointments.typeLab' },
  { value: 'surgical', labelKey: 'appointments.typeSurgical' },
  { value: 'dental', labelKey: 'appointments.typeDental' },
  { value: 'mental_health', labelKey: 'appointments.typeMentalHealth' },
];
const PATTERNS = ['weekly', 'biweekly', 'monthly', 'quarterly'] as const;
const SECOND_STAFF_ROLES = new Set(['nurse', 'midwife', 'triage_nurse', 'rooming_nurse']);
const NOTE_MAX = 255;

/** "02:29" + "PM" → "14:29"; null when the clock reading is not a real time. */
function to24h(clock: string, meridiem: 'AM' | 'PM'): string | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(clock.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 1 || hour > 12 || minute > 59) return null;
  const h24 = (hour % 12) + (meridiem === 'PM' ? 12 : 0);
  return `${String(h24).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/** The next half hour from now, as the form's starting time. */
function nextHalfHour(): { clock: string; meridiem: 'AM' | 'PM' } {
  const now = new Date();
  const minutes = now.getHours() * 60 + now.getMinutes();
  const rounded = Math.min(Math.ceil(minutes / 30) * 30, 23 * 60 + 30);
  const h24 = Math.floor(rounded / 60);
  const hour12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return { clock: `${String(hour12).padStart(2, '0')}:${String(rounded % 60).padStart(2, '0')}`, meridiem: h24 >= 12 ? 'PM' : 'AM' };
}

export default function BookAppointmentPanel({ patient, patientName, onClose, onBooked }: {
  patient: PatientDoc;
  patientName: string;
  onClose: () => void;
  onBooked?: () => void;
}) {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const { currentUser } = useAuth();
  const { canBookAppointments, canAssignCareTeam } = usePermissions();
  const { create } = useAppointments();
  const { users, loading: usersLoading } = useUsers();
  const { reasons } = useVisitReasons();
  const { departments } = useDepartments();
  const today = jubaDate();
  const [start] = useState(nextHalfHour);

  const myId = currentUser?._id;
  const myRole = currentUser?.role;
  const myHospitalId = currentUser?.hospitalId;

  const providerOptions = useMemo(() => users
    .filter(u => (u.role === 'doctor' || u.role === 'clinical_officer')
      && u.isActive !== false && canAssignStaffAtFacility(myHospitalId, u.hospitalId))
    .sort((a, b) => (a.name || '').localeCompare(b.name || '')), [users, myHospitalId]);
  const staffOptions = useMemo(() => users
    .filter(u => SECOND_STAFF_ROLES.has(u.role)
      && u.isActive !== false && canAssignStaffAtFacility(myHospitalId, u.hospitalId))
    .sort((a, b) => (a.name || '').localeCompare(b.name || '')), [users, myHospitalId]);

  const [visitReasonId, setVisitReasonId] = useState('');
  const [type, setType] = useState<AppointmentType>('general');
  const [recurring, setRecurring] = useState(false);
  const [pattern, setPattern] = useState<typeof PATTERNS[number]>('monthly');
  const [visits, setVisits] = useState(SERIES_DEFAULT);
  const [date, setDate] = useState(today);
  const [clock, setClock] = useState(start.clock);
  const [meridiem, setMeridiem] = useState<'AM' | 'PM'>(start.meridiem);
  const [duration, setDuration] = useState('30');
  // The booker's own diary is the obvious default: a doctor books with
  // themselves, a nurse books themselves in as the visit's nurse.
  const [providerId, setProviderId] = useState(myRole === 'doctor' || myRole === 'clinical_officer' ? myId || '' : '');
  const [staffId, setStaffId] = useState(myRole && SECOND_STAFF_ROLES.has(myRole) ? myId || '' : '');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [clash, setClash] = useState<string | null>(null);

  const visitReason = reasons.find(r => r._id === visitReasonId) ?? null;
  const provider = providerOptions.find(u => u._id === providerId);
  const staff = staffOptions.find(u => u._id === staffId);
  const time24 = to24h(clock, meridiem);
  const minutes = Number(duration);
  const durationValid = Number.isInteger(minutes) && minutes >= 5 && minutes <= 480;
  const dateValid = !!date && date >= today;
  // Today's slots must still be ahead of the clock (Juba time, like the date).
  // Same 5-minute grace the server allows for "the slot the doctor is in".
  const graceClock = (() => {
    const [h, m] = jubaTime().split(':').map(Number);
    const total = Math.max(0, h * 60 + m - 5);
    return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
  })();
  const timeInPast = !!time24 && date === today && time24 < graceClock;

  const pickReason = (id: string) => {
    setVisitReasonId(id);
    const picked = reasons.find(r => r._id === id);
    if (!picked) return;
    setType(picked.appointmentType);
    setDuration(String(picked.durationMinutes));
  };

  // The same conflict rule the save runs, asked as soon as the slot and the
  // people are known: the provider's calendar, the nurse's, the room and the
  // patient's own bookings.
  useEffect(() => {
    if (!time24 || !durationValid || !dateValid) return;
    let cancelled = false;
    const handle = window.setTimeout(() => {
      void import('@/lib/services/appointment-service').then(m => m.assertNoBookingConflicts({
        providerId: providerId || undefined,
        providerName: provider?.name,
        staffId: staffId || undefined,
        staffName: staff?.name,
        patientId: patient._id,
        patientName,
        orgId: currentUser?.orgId,
        facilityId: myHospitalId,
        appointmentDate: date,
        appointmentTime: time24,
        duration: minutes,
      })).then(
        // Clear on this device: ask the server about the facilities this
        // device does not hold (a colleague booked elsewhere in the org).
        async () => {
          const remote = await serverBookingConflict({
            providerId: providerId || undefined, providerName: provider?.name,
            staffId: staffId || undefined, staffName: staff?.name,
            patientId: patient._id, facilityId: myHospitalId,
            appointmentDate: date, appointmentTime: time24, duration: minutes,
          });
          if (!cancelled) setClash(remote);
        },
        (error: unknown) => {
          if (cancelled) return;
          setClash(error instanceof Error && error.name === 'BookingConflictError' ? error.message : null);
        },
      );
    }, 400);
    return () => { cancelled = true; window.clearTimeout(handle); };
  }, [time24, durationValid, dateValid, minutes, date, providerId, staffId, provider?.name, staff?.name, patient._id, patientName, currentUser?.orgId, myHospitalId]);

  // A clash only means something for a slot that is itself valid.
  const shownClash = time24 && durationValid && dateValid ? clash : null;

  const canSave = canBookAppointments && !!currentUser && !!time24 && !timeInPast && durationValid && dateValid
    && (!!providerId || !!staffId) && !shownClash && !saving && !usersLoading;

  const save = async () => {
    if (!canSave || !currentUser || !time24) return;
    setSaving(true);
    try {
      const department = visitReason?.department || 'Outpatient';
      const series = await createBookingSeries({
        patientId: patient._id,
        patientName,
        patientPhone: patient.phone || undefined,
        providerId,
        providerName: provider?.name || '',
        staffId: staffId || undefined,
        staffName: staff?.name || undefined,
        facilityId: myHospitalId || '',
        facilityName: currentUser.hospitalName || '',
        facilityLevel: 'payam' as FacilityLevel,
        appointmentDate: date,
        appointmentTime: time24,
        duration: minutes,
        appointmentType: type,
        priority: 'routine',
        department,
        departmentId: departments.find(d => d.name === department)?._id,
        reason: visitReason?.name || t(TYPE_OPTIONS.find(o => o.value === type)?.labelKey || 'appointments.typeGeneral'),
        notes: note.trim() || undefined,
        // Booked, not confirmed: the front desk confirms it (no confirmedAt
        // here — updateAppointmentStatus owns that stamp).
        status: 'scheduled',
        source: 'staff',
        visitReasonId: visitReason?._id,
        visitReasonName: visitReason?.name,
        reminderSent: false,
        isRecurring: false,
        bookedBy: currentUser._id,
        bookedByName: currentUser.name,
        state: '',
        orgId: currentUser.orgId,
      }, withServerConflictCheck(create), recurring ? { pattern, count: visits } : undefined);
      const appointment = series.first;
      const failures = await mirrorBookingCareTeam({
        appointment,
        canAssignCareTeam,
        actor: { id: currentUser._id, name: currentUser.name, role: currentUser.role, hospitalId: myHospitalId, hospitalName: currentUser.hospitalName, orgId: currentUser.orgId },
        providerRole: provider?.role,
      });
      showToast(
        failures.length > 0 ? t('appointments.toastBookedAssignmentIncomplete')
          : canAssignCareTeam ? t('appointments.toastBooked') : t('bookPanel.bookedForDesk'),
        failures.length > 0 ? 'error' : 'success',
        failures.length > 0 ? { durationMs: 8000 } : undefined,
      );
      // A series reports what it could not book rather than hiding it.
      if (series.skipped.length > 0) {
        showToast(t('bookPanel.seriesPartial', {
          booked: series.booked.length,
          total: series.booked.length + series.skipped.length,
          dates: series.skipped.map(s => formatDate(s.date)).join(', '),
        }), 'warning', { durationMs: 10000 });
      }
      onBooked?.();
      onClose();
    } catch (error) {
      if (error instanceof Error && error.name === 'BookingConflictError') setClash(error.message);
      showToast(describeError(error, t('appointments.toastFailedBook')), 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bap-root">
      <div className="bap-body">
        <section className="bap-section">
          <h3 className="bap-heading">{t('bookPanel.service')}</h3>
          <label className="bap-field">
            <span className="bap-label">{t('bookPanel.selectService')}</span>
            <select value={visitReasonId} onChange={e => pickReason(e.target.value)}>
              <option value="">{t('bookPanel.selectServicePlaceholder')}</option>
              {reasons.map(r => <option key={r._id} value={r._id}>{r.name}</option>)}
            </select>
          </label>
        </section>

        <section className="bap-section">
          <h3 className="bap-heading">{t('bookPanel.type')}</h3>
          <label className="bap-field">
            <span className="bap-label">{t('bookPanel.selectType')}</span>
            <select value={type} onChange={e => setType(e.target.value as AppointmentType)}>
              {TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{t(o.labelKey)}</option>)}
            </select>
          </label>
        </section>

        <section className="bap-section">
          <h3 className="bap-heading">{t('appointments.recurringAppointment')}</h3>
          <span className="bap-label" id="bap-recurring-label">{t('bookPanel.isRecurring')}</span>
          <div className="bap-toggle-row">
            <button
              type="button"
              role="switch"
              aria-checked={recurring}
              aria-labelledby="bap-recurring-label"
              className={recurring ? 'bap-switch is-on' : 'bap-switch'}
              onClick={() => setRecurring(v => !v)}
            >
              <span className="bap-switch-knob" />
            </button>
            <span>{recurring ? t('bookPanel.yes') : t('bookPanel.no')}</span>
          </div>
          {recurring && (
            <label className="bap-field">
              <span className="bap-label">{t('bookPanel.repeats')}</span>
              <select value={pattern} onChange={e => setPattern(e.target.value as typeof PATTERNS[number])}>
                {PATTERNS.map(p => <option key={p} value={p}>{t(`bookPanel.pattern.${p}`)}</option>)}
              </select>
            </label>
          )}
          {recurring && (
            <label className="bap-field">
              <span className="bap-label">{t('bookPanel.visits')}</span>
              <select value={visits} onChange={e => setVisits(Number(e.target.value))}>
                {Array.from({ length: SERIES_MAX - SERIES_MIN + 1 }, (_, i) => i + SERIES_MIN).map(n => (
                  <option key={n} value={n}>{t('bookPanel.visitsCount', { count: n })}</option>
                ))}
              </select>
            </label>
          )}
        </section>

        <section className="bap-section">
          <h3 className="bap-heading">{t('bookPanel.time')}</h3>
          <label className="bap-field bap-field--date">
            <span className="bap-label">{t('bookPanel.date')}</span>
            <input type="date" value={date} min={today} onChange={e => setDate(e.target.value)} aria-invalid={!dateValid} />
          </label>
          <div className="bap-time-row">
            <div className="bap-field">
              <span className="bap-label" id="bap-time-label">{t('bookPanel.clock')}</span>
              <div className="bap-clock">
                <input
                  type="text"
                  inputMode="numeric"
                  value={clock}
                  onChange={e => setClock(e.target.value)}
                  aria-labelledby="bap-time-label"
                  aria-invalid={!time24 || timeInPast}
                  placeholder="hh:mm"
                  maxLength={5}
                />
                <select value={meridiem} onChange={e => setMeridiem(e.target.value as 'AM' | 'PM')} aria-label={t('bookPanel.meridiem')}>
                  <option value="AM">AM</option>
                  <option value="PM">PM</option>
                </select>
              </div>
            </div>
            <label className="bap-field">
              <span className="bap-label">{t('bookPanel.duration')}</span>
              <input type="number" min={5} max={480} step={5} value={duration} onChange={e => setDuration(e.target.value)} aria-invalid={!durationValid} />
            </label>
          </div>
        </section>

        <section className="bap-section">
          <h3 className="bap-heading">{t('bookPanel.provider')}</h3>
          <label className="bap-field">
            <span className="bap-label">{t('bookPanel.selectProvider')}</span>
            <select value={providerId} onChange={e => setProviderId(e.target.value)}>
              <option value="">{t('bookPanel.noProvider')}</option>
              {providerOptions.map(u => <option key={u._id} value={u._id}>{u.name}</option>)}
            </select>
          </label>
          <label className="bap-field">
            <span className="bap-label">{t('bookPanel.selectNurse')}</span>
            <select value={staffId} onChange={e => setStaffId(e.target.value)}>
              <option value="">{t('bookPanel.noNurse')}</option>
              {staffOptions.map(u => <option key={u._id} value={u._id}>{u.name}</option>)}
            </select>
          </label>
        </section>

        {timeInPast && (
          <InlineBanner tone="warning" title={t('bookPanel.pastTitle')}>{t('bookPanel.pastBody')}</InlineBanner>
        )}

        {shownClash && (
          <InlineBanner tone="danger" title={t('bookPanel.clashTitle')}>{shownClash}</InlineBanner>
        )}

        <section className="bap-section">
          <h3 className="bap-heading">{t('bookPanel.scheduledOn')}</h3>
          <label className="bap-field bap-field--date">
            <span className="bap-label">{t('bookPanel.issued')}</span>
            <input type="text" value={formatDate(today)} readOnly />
          </label>
        </section>

        <section className="bap-section">
          <h3 className="bap-heading">{t('bookPanel.note')}</h3>
          <label className="bap-field">
            <span className="bap-label bap-label--split">
              <span>{t('bookPanel.noteLabel')}</span>
              <span>{note.length}/{NOTE_MAX}</span>
            </span>
            <textarea rows={4} maxLength={NOTE_MAX} value={note} onChange={e => setNote(e.target.value)} placeholder={t('bookPanel.notePlaceholder')} />
          </label>
        </section>

        <p className="bap-desk-note">{t('bookPanel.deskConfirms')}</p>
      </div>

      <div className="tm-action-bar">
        <button type="button" className="tm-action-bar__btn tm-action-bar__btn--secondary" onClick={onClose} disabled={saving}>
          {t('bookPanel.discard')}
        </button>
        <button type="button" className="tm-action-bar__btn tm-action-bar__btn--primary" onClick={() => void save()} disabled={!canSave}>
          {saving ? t('bookPanel.saving') : t('bookPanel.saveAndClose')}
        </button>
      </div>
    </div>
  );
}
