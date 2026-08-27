'use client';

/**
 * BookAppointmentModal — booking as a short sequence, not one long form.
 *
 * The order matters and is the whole point of the rewrite: you settle WHAT the
 * visit is and WHO it needs, then look at when those people are free, and only
 * then say who the patient is. A form that asks for everything at once has to
 * accept a time typed from nowhere and discover the clash on save.
 *
 *   1. Visit    — reason, how long, in-person or virtual, which clinician,
 *                 and any second staff member the visit needs
 *   2. Time     — clinician × day grid, already narrowed to the people chosen
 *   3. Patient  — who it is for, and why
 *   4. Insurance— coverage and anything the practice should know
 *
 * Every facility has a service menu from the moment it exists — the built-in
 * one until it authors its own (see DEFAULT_VISIT_REASONS), so nobody has to
 * configure a list before the desk can book. What a facility may genuinely not
 * have yet is clinic hours; step 1 falls back to entering a time by hand in
 * that case rather than refusing the booking.
 */

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import PortalModal from '@/components/Modal';
import AppointmentStatusSelect from '@/components/appointments/AppointmentStatusSelect';
import WeekSlotGrid, { type GridProvider } from '@/components/booking/WeekSlotGrid';
import BookingSummaryHeader, { BookingStepDots } from '@/components/booking/BookingSummaryHeader';
import { useAppointments } from '@/lib/hooks/useAppointments';
import { useBookingSlots } from '@/lib/hooks/useBookingSlots';
import { useVisitReasons } from '@/lib/hooks/useVisitReasons';
import { usePatients } from '@/lib/hooks/usePatients';
import { useUsers } from '@/lib/hooks/useUsers';
import { staffOptionLabel, type StaffSlotContext } from '@/lib/appointment-staff';
import { useAuth } from '@/lib/context';
import { useSettings } from '@/lib/settings/SettingsProvider';
import { getRoleChoice } from '@/lib/settings/role-settings-store';
import { useToast } from '@/components/Toast';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { jubaDate } from '@/lib/time-juba';
import { ArrowLeft, ArrowRight, Maximize2, X } from '@/components/icons/lucide';
import { expandHref } from '@/lib/navigation/expand-to-page';
import type { Slot } from '@/lib/booking/slot-engine';
import type {
  AppointmentType, AppointmentPriority, AppointmentStatus, FacilityLevel,
} from '@/lib/db-types';
import Select from '@/components/Select';

const FALLBACK_DEPARTMENTS = [
  'Internal Medicine', 'Pediatrics', 'Obstetrics & Gynecology', 'Surgery',
  'Emergency', 'Cardiology', 'Orthopedics', 'Ophthalmology', 'Neurology',
  'Dermatology', 'ENT', 'Outpatient',
];

/** "20 min" → 20, falling back to the platform's long-standing 30. */
function defaultAppointmentMinutes(): number {
  const match = /^(\d+)/.exec(getRoleChoice('consult.length', '').trim());
  const minutes = match ? Number(match[1]) : NaN;
  return Number.isFinite(minutes) && minutes > 0 ? minutes : 30;
}

/** 07:00 → 18:30 on the half hour — the manual fallback for unconfigured sites. */
const TIME_SLOTS = Array.from({ length: 24 }, (_, h) =>
  ['00', '30'].map(m => `${h.toString().padStart(2, '0')}:${m}`),
).flat().filter(slot => {
  const hour = parseInt(slot.split(':')[0], 10);
  return hour >= 7 && hour <= 18;
});

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

/**
 * Four steps, in the order the decisions actually happen.
 *
 * "Visit" and "Time" used to be one screen, with the duration welded onto the
 * reason's label ("New Patient Visit · 40 min") and the clinician a filter
 * above the grid. That put three unrelated decisions in one place and made the
 * duration look like part of the visit's NAME rather than something the desk
 * can change.
 *
 * Now: decide what the visit IS and who is needed for it, then look at when
 * those people are free. The grid on step 2 already knows the provider, the
 * second staff member and the length, so it shows times that will actually
 * work rather than every opening in the building.
 */
const STEPS = ['Visit', 'Time', 'Patient', 'Insurance'] as const;

export default function BookAppointmentModal({
  onClose,
  onBooked,
  defaultDate,
  defaultPatientId,
  presentation = 'modal',
}: {
  onClose: () => void;
  /** Fires after a successful booking, before the dialog closes. */
  onBooked?: () => void;
  /** Pre-selected day — the dashboard passes whichever day is being viewed. */
  defaultDate?: string;
  defaultPatientId?: string;
  /**
   * 'page' drops the dialog frame so `/appointments/new` can host the same
   * four steps — this popup's Expand control routes there.
   *
   * The step bar stays in both. It is not dialog chrome: it carries Back and
   * says which of the four steps you are on, and a wizard without that is
   * lost on any surface.
   */
  presentation?: 'modal' | 'page';
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const { create, appointments } = useAppointments();
  const { patients } = usePatients();
  const { users } = useUsers();
  const { currentUser } = useAuth();
  const { departments: facilityDepartments } = useSettings();
  const { showToast } = useToast();
  const departments = facilityDepartments.length ? facilityDepartments : FALLBACK_DEPARTMENTS;
  const today = jubaDate();

  const [step, setStep] = useState(0);
  const [patientId, setPatientId] = useState(defaultPatientId || '');
  // Provider is a staff-directory pick (id + name), not free text — the id is
  // what arms the service's double-booking guard.
  const [providerId, setProviderId] = useState('');
  const [provider, setProvider] = useState('');
  const [date, setDate] = useState(defaultDate || today);
  const [time, setTime] = useState('');
  // Seeded from the clinician's "Default appointment length" (`consult.length`),
  // which is exactly what that row promises: "Used when you book from your
  // calendar". A reason or a published slot still overrides it below.
  const [duration, setDuration] = useState(defaultAppointmentMinutes);
  const [type, setType] = useState<AppointmentType>('general');
  const [priority, setPriority] = useState<AppointmentPriority>('routine');
  const [status, setStatus] = useState<AppointmentStatus>('scheduled');
  const [department, setDepartment] = useState('Outpatient');
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');
  const [recurring, setRecurring] = useState(false);
  const [recurrencePattern, setRecurrencePattern] = useState<'weekly' | 'biweekly' | 'monthly' | 'quarterly'>('monthly');
  const [insuranceProvider, setInsuranceProvider] = useState('');
  const [insuranceMemberId, setInsuranceMemberId] = useState('');
  const [insuranceGroupId, setInsuranceGroupId] = useState('');
  const [submitting, setSubmitting] = useState(false);

  /**
   * A clinician booking into their own diary, with the patient in front of them.
   *
   * That is not a request for anyone to approve — the person who owns the slot
   * has already agreed to it — so it is confirmed outright and the status
   * control is not offered: every other value it could take would describe
   * what happened less accurately than "confirmed". The booking still appears
   * on the front desk's list like any other, because from the moment it is
   * made it is a real appointment in the facility's day.
   */
  const bookingOwnDiary = Boolean(
    currentUser
    && (currentUser.role === 'doctor' || currentUser.role === 'clinical_officer')
    && providerId
    && providerId === currentUser._id,
  );

  // Step 1 controls
  const [providerFilter, setProviderFilter] = useState('');
  // The second person the visit needs — rooming nurse, interpreter, scribe.
  // Optional, and when set the grid only offers times they are free too.
  const [staffId, setStaffId] = useState('');
  const [staffName, setStaffName] = useState('');
  const [weekStart, setWeekStart] = useState(defaultDate || today);

  const providerOptions = useMemo(() => users
    .filter(u => (u.role === 'doctor' || u.role === 'clinical_officer')
      && u.isActive !== false
      && (!currentUser?.hospitalId || u.hospitalId === currentUser.hospitalId))
    .sort((a, b) => (a.name || '').localeCompare(b.name || '')), [users, currentUser?.hospitalId]);
  /**
   * Staff who can be the second person on a visit.
   *
   * Deliberately wider than `nurse`: the people who actually room, triage and
   * assist are recorded under their station's role. Juba Teaching Hospital has
   * no `nurse` at all — its ward staff are `triage_nurse` and `rooming_nurse`
   * — so a filter on `nurse` alone offered an empty list at the busiest
   * facility in the dataset.
   */
  const nurseOptions = useMemo(() => {
    const SECOND_STAFF_ROLES = new Set(['nurse', 'midwife', 'triage_nurse', 'rooming_nurse']);
    return users
      .filter(u => SECOND_STAFF_ROLES.has(u.role)
        && u.isActive !== false
        && (!currentUser?.hospitalId || u.hospitalId === currentUser.hospitalId))
      .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  }, [users, currentUser?.hospitalId]);
  const providerSlotContext = useMemo<StaffSlotContext>(() => ({
    appointments, date, time: time || '09:00', duration,
  }), [appointments, date, time, duration]);

  const { reasons, loading: reasonsLoading } = useVisitReasons();
  const [visitReasonId, setVisitReasonId] = useState('');
  const visitReason = useMemo(
    () => reasons.find(r => r._id === visitReasonId) ?? null,
    [reasons, visitReasonId],
  );
  /**
   * Guards the stepped layout against an empty menu. In practice this is always
   * true — a facility with nothing authored still gets the built-in reasons —
   * but the flow has no meaning without at least one, so it stays a condition
   * rather than an assumption.
   */
  const stepped = reasons.length > 0;

  const { slots, firstAvailableDate, loading: slotsLoading } = useBookingSlots({
    facilityId: currentUser?.hospitalId,
    orgId: currentUser?.orgId,
    visitReason,
    patientClass: 'returning',
    channel: 'staff',
    from: today,
    days: 90,
    providerIds: providerFilter ? [providerFilter] : undefined,
    secondaryStaffId: staffId || undefined,
    enabled: stepped,
  });

  // Open the grid on the first week that actually has something, rather than on
  // a run of empty days the reader has to page past.
  useEffect(() => {
    if (!stepped || !firstAvailableDate) return;
    if (slots.some(s => s.date >= weekStart)) return;
    setWeekStart(firstAvailableDate);
  }, [stepped, firstAvailableDate, slots, weekStart]);

  /** Rows for the grid, in staff-directory order. */
  const gridProviders = useMemo<GridProvider[]>(() => {
    const known = new Map(providerOptions.map(p => [p._id, p]));
    const ids = [...new Set(slots.map(s => s.providerId))];
    return ids.map(id => {
      const person = known.get(id);
      const fromSlot = slots.find(s => s.providerId === id);
      return {
        providerId: id,
        providerName: person?.name || fromSlot?.providerName || 'Clinician',
        subtitle: person?.specialty || person?.department,
      };
    }).sort((a, b) => a.providerName.localeCompare(b.providerName));
  }, [slots, providerOptions]);

  // Choosing a reason settles what the visit IS — its length, its department,
  // and how it is recorded on the chart — so those stop being three guesses.
  const pickVisitReason = (id: string) => {
    setVisitReasonId(id);
    const picked = reasons.find(r => r._id === id);
    if (!picked) return;
    setDuration(picked.durationMinutes);
    setDepartment(picked.department);
    setType(picked.appointmentType);
    if (!reason.trim()) setReason(picked.name);
    setTime('');   // the previous time belonged to the previous duration
  };

  const pickSlot = (slot: Slot) => {
    setTime(slot.startTime);
    setDate(slot.date);
    setDuration(slot.durationMinutes);
    setProviderId(slot.providerId);
    setProvider(slot.providerName);
  };

  const slotChosen = Boolean(time && providerId);
  const patient = patients.find(p => p._id === patientId);

  /**
   * The facility has a service menu but nobody has clinic hours recorded, so
   * there is nothing to draw. The desk still has to be able to book — a
   * missing roster is an admin task, not a reason to refuse a patient — so the
   * step falls back to entering a time by hand.
   */
  const noAvailability = stepped && Boolean(visitReason) && !slotsLoading && slots.length === 0;

  const canAdvance = step === 0
    ? Boolean(visitReason)
    : step === 1
      ? (stepped && !noAvailability ? slotChosen : Boolean(date && time))
      : step === 2
        ? Boolean(patientId && reason.trim())
        : true;

  const handleSubmit = async () => {
    if (!patientId || !date || !time || !reason) {
      showToast(t('appointments.toastFillRequired'), 'error');
      setStep(patientId && reason.trim() ? 1 : 2);
      return;
    }
    if (!patient) {
      showToast(t('appointments.toastSelectValidPatient'), 'error');
      setStep(2);
      return;
    }
    setSubmitting(true);
    try {
      await create({
        patientId: patient._id,
        patientName: `${patient.firstName} ${patient.surname}`,
        patientPhone: patient.phone || undefined,
        providerId,
        providerName: provider,
        staffId: staffId || undefined,
        staffName: staffName || undefined,
        facilityId: currentUser?.hospitalId || '',
        facilityName: currentUser?.hospitalName || '',
        facilityLevel: 'payam' as FacilityLevel,
        appointmentDate: date,
        appointmentTime: time,
        duration,
        appointmentType: type,
        priority,
        department,
        reason,
        notes: notes || undefined,
        // A clinician's own booking is confirmed on the spot; anyone else's
        // keeps whatever the booker chose.
        status: bookingOwnDiary ? 'scheduled' : status,
        confirmedAt: bookingOwnDiary ? new Date().toISOString() : undefined,
        source: 'staff',
        visitReasonId: visitReason?._id,
        // Denormalised so the booking still reads correctly if the reason is
        // later renamed or retired.
        visitReasonName: visitReason?.name,
        insuranceSubmitted: insuranceProvider.trim() && insuranceMemberId.trim()
          ? {
            provider: insuranceProvider.trim(),
            memberId: insuranceMemberId.trim(),
            groupId: insuranceGroupId.trim() || undefined,
            verificationStatus: 'pending' as const,
          }
          : undefined,
        reminderSent: false,
        isRecurring: recurring,
        recurrencePattern: recurring ? recurrencePattern : undefined,
        bookedBy: currentUser?._id || '',
        bookedByName: currentUser?.name || '',
        state: '',
        orgId: currentUser?.orgId,
      });
      showToast(t('appointments.toastBooked'), 'success');
      onBooked?.();
      onClose();
    } catch (err) {
      // A clash is about the slot, so send the booker back to where slots are.
      showToast(err instanceof Error ? err.message : t('appointments.toastFailedBook'), 'error');
      setStep(1);
    } finally {
      setSubmitting(false);
    }
  };

  const panel = (
      <div
        className={presentation === 'page' ? undefined : 'modal-panel modal-panel--lg'}
        // Guided-tour anchor (front-desk journey's "book" step) — the booking
        // dialog itself, so the tour can spotlight the real 4-step flow
        // instead of the trigger button that opened it.
        data-tour="book-appointment-modal"
        style={presentation === 'page' ? { width: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 } : {
          width: '100%',
          // Grows with its content, then stops at the dialog's height and
          // scrolls inside. The grid is as tall as the clinic is busy — three
          // clinicians with a morning each ran past the bottom of the screen,
          // taking Next with it — so past that point the body scrolls and the
          // title and buttons stay pinned either side of it.
          //
          // `flex` rather than `height: 100%`: the dialog is a flex column
          // sized by its content and capped by max-height, so a percentage
          // height has nothing definite to resolve against and collapses to
          // auto. Shrinking to the cap is what makes the inner scroll work.
          flex: '1 1 auto',
          maxHeight: '100%',
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
          overflow: 'hidden',
        }}
      >
        {/* ── Title bar ── */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18, gap: 10, flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
            {stepped && step > 0 && (
              <button
                type="button"
                onClick={() => setStep(step - 1)}
                aria-label="Back"
                style={{
                  background: 'var(--overlay-subtle)', border: 'none', cursor: 'pointer',
                  width: 32, height: 32, borderRadius: 10, display: 'flex',
                  alignItems: 'center', justifyContent: 'center', color: 'var(--text-primary)', flexShrink: 0,
                }}
              >
                <ArrowLeft size={16} />
              </button>
            )}
            <div style={{ minWidth: 0 }}>
              <h2 className="truncate" style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)' }}>
                {t('appointments.bookAppointment')}
              </h2>
              {stepped && (
                <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)' }}>
                  Step {step + 1} of {STEPS.length} · {STEPS[step]}
                </p>
              )}
            </div>
          </div>
          {presentation === 'modal' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
              {/* Same pair every create popup carries — promote to the full
                  page, or close. The band this sits in is the wizard's own
                  rather than PopupHeader's, because the step counter and its
                  Back control live here too. */}
              <button
                type="button"
                onClick={() => { onClose(); router.push(expandHref('/appointments/new')); }}
                aria-label="Open full page"
                title="Open full page"
                data-action="popup-expand"
                style={{
                  background: 'var(--overlay-subtle)', border: 'none', cursor: 'pointer',
                  width: 32, height: 32, borderRadius: 10, display: 'flex', alignItems: 'center',
                  justifyContent: 'center', color: 'var(--text-muted)', flexShrink: 0,
                }}
              >
                <Maximize2 size={16} />
              </button>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                data-action="popup-close"
                style={{
                  background: 'var(--overlay-subtle)', border: 'none', cursor: 'pointer',
                  width: 32, height: 32, borderRadius: 10, display: 'flex', alignItems: 'center',
                  justifyContent: 'center', color: 'var(--text-muted)', flexShrink: 0,
                }}
              >
                <X size={16} />
              </button>
            </div>
          )}
        </div>

        <div
          style={{
            display: 'flex', flexDirection: 'column', gap: 14,
            flex: 1, minHeight: 0, overflowY: 'auto',
            // Room for the scrollbar so it never sits on top of a slot chip.
            paddingInlineEnd: 2,
          }}
        >
          {/* ═══ Step 1 — the visit: what it is, and who it needs ═══ */}
          {stepped && step === 0 && (
            <>
              <div>
                <label>Reason for visit</label>
                <Select
                  value={visitReasonId}
                  disabled={reasonsLoading}
                  onChange={e => pickVisitReason(e.target.value)}
                >
                  <option value="">{reasonsLoading ? 'Loading visit types…' : 'Select a visit type…'}</option>
                  {/* Names only. The duration used to be welded onto the label,
                      which read as part of the visit's name and hid the fact
                      that it is a number the desk can change — it has its own
                      field below, seeded from whatever is chosen here. */}
                  {reasons.map(r => (
                    <option key={r._id} value={r._id}>{r.name}</option>
                  ))}
                </Select>
              </div>

              {/* The whole visit is one view. This block used to be hidden until
                  a reason was chosen, so the step opened as a single lonely
                  select and grew a form underneath it — the desk could not see
                  what booking a visit would ask for until it had already
                  started answering. Everything renders from the outset;
                  choosing a reason seeds duration and department
                  rather than revealing the fields that hold them. */}
              <>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
                    <div>
                      <label>{t('appointments.labelDuration')}</label>
                      <Select value={duration} onChange={e => { setDuration(Number(e.target.value)); setTime(''); }}>
                        {[...new Set([...(visitReason ? [visitReason.durationMinutes] : []), 10, 15, 20, 30, 40, 45, 60, 90])]
                          .sort((a, b) => a - b)
                          .map(d => (
                            <option key={d} value={d}>
                              {t('appointments.durationMin', { count: d })}
                              {visitReason && d === visitReason.durationMinutes ? ' (standard)' : ''}
                            </option>
                          ))}
                      </Select>
                    </div>
                    <div>
                      <label>{t('appointments.labelDepartment')}</label>
                      <Select value={department} onChange={e => setDepartment(e.target.value)}>
                        {departments.map(d => <option key={d} value={d}>{d}</option>)}
                      </Select>
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
                    <div>
                      <label>{t('appointments.labelProvider')}</label>
                      <Select
                        value={providerFilter}
                        onChange={e => { setProviderFilter(e.target.value); setTime(''); }}
                      >
                        <option value="">Any clinician</option>
                        {providerOptions.map(person => (
                          <option key={person._id} value={person._id}>
                            {staffOptionLabel(person, providerSlotContext)}
                          </option>
                        ))}
                      </Select>
                    </div>
                    <div>
                      <label>Nurse or second staff</label>
                      <Select
                        value={staffId}
                        onChange={e => {
                          const person = nurseOptions.find(p => p._id === e.target.value);
                          setStaffId(e.target.value);
                          setStaffName(person ? (person.name || person.username || '') : '');
                          setTime('');
                        }}
                      >
                        <option value="">Not needed</option>
                        {nurseOptions.map(person => (
                          <option key={person._id} value={person._id}>
                            {staffOptionLabel(person, providerSlotContext)}
                          </option>
                        ))}
                      </Select>
                    </div>
                  </div>

                  <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)' }}>
                    {staffId
                      ? `Next you will see times when ${providerFilter ? 'the clinician' : 'a clinician'} and ${staffName || 'the second staff member'} are both free.`
                      : 'Next you will see when each clinician is free. Naming a nurse here narrows those times to when they are free too.'}
                  </p>
              </>
            </>
          )}

          {/* ═══ Step 2 — when ═══ */}
          {stepped && step === 1 && (
            <>
              {visitReason && (
                <div
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
                    fontSize: 12, color: 'var(--text-muted)',
                  }}
                >
                  <strong style={{ color: 'var(--text-primary)', fontSize: 13 }}>{visitReason.name}</strong>
                  <span>· {t('appointments.durationMin', { count: duration })}</span>
                  {staffName && <span>· with {staffName}</span>}
                </div>
              )}

              {noAvailability ? (
                <ManualTimeFallback
                  t={t}
                  today={today}
                  date={date} setDate={setDate}
                  time={time} setTime={setTime}
                  duration={duration} setDuration={setDuration}
                  providerId={providerId}
                  onProviderChange={id => {
                    const person = providerOptions.find(p => p._id === id);
                    setProviderId(id);
                    setProvider(person ? (person.name || person.username || '') : '');
                  }}
                  providerOptions={providerOptions}
                  providerSlotContext={providerSlotContext}
                />
              ) : (
                <div
                  style={{
                    // Full-bleed to the panel edges. The grid was sitting in a
                    // bordered card inset inside a padded panel, so it carried
                    // two frames and a white gutter between them — and the
                    // widest thing in the dialog was the thing with the least
                    // room. The panel pads itself 24px; this pulls back out
                    // over that and repaints the band edge to edge.
                    margin: '0 -24px',
                    padding: '4px 24px 8px',
                    background: 'var(--bg-card-solid)',
                  }}
                >
                  <WeekSlotGrid
                    slots={slots}
                    providers={gridProviders}
                    startDate={weekStart}
                    onStartDateChange={setWeekStart}
                    onPick={pickSlot}
                    selected={slotChosen ? { providerId, date, startTime: time } : undefined}
                    loading={slotsLoading}
                    minDate={today}
                  />
                </div>
              )}

              {slotChosen && (
                <BookingSummaryHeader
                  providerName={provider}
                  date={date}
                  startTime={time}
                  durationMinutes={duration}
                  facilityName={currentUser?.hospitalName}
                />
              )}
            </>
          )}

          {/* ═══ Step 3 — patient details ═══ */}
          {stepped && step === 2 && (
            <>
              <BookingSummaryHeader
                providerName={provider}
                date={date}
                startTime={time}
                durationMinutes={duration}
                facilityName={currentUser?.hospitalName}
                onChange={() => setStep(1)}
              />

              <div>
                <label className="field-required">{t('appointments.labelPatient')}</label>
                <Select value={patientId} onChange={e => setPatientId(e.target.value)}>
                  <option value="">{t('appointments.selectPatient')}</option>
                  {patients.map(p => (
                    <option key={p._id} value={p._id}>
                      {p.firstName} {p.surname} {p.hospitalNumber ? `(${p.hospitalNumber})` : ''}
                    </option>
                  ))}
                </Select>
              </div>

              <div><label className="field-required">{t('appointments.labelReason')}</label><textarea value={reason} onChange={e => setReason(e.target.value)} rows={2} placeholder={t('appointments.reasonPlaceholder')} /></div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', alignItems: 'stretch', gap: 12 }}>
                <div><label>{t('appointments.labelType')}</label><Select value={type} onChange={e => setType(e.target.value as AppointmentType)}>{TYPE_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{t(opt.labelKey)}</option>)}</Select></div>
                <div>
                  <label>{t('appointments.labelPriority')}</label>
                  <Select value={priority} onChange={e => setPriority(e.target.value as AppointmentPriority)}>
                    <option value="routine">{t('appointments.priorityRoutine')}</option>
                    <option value="urgent">{t('appointments.priorityUrgent')}</option>
                    <option value="emergency">{t('appointments.priorityEmergency')}</option>
                  </Select>
                </div>
                {/* Usually left at Scheduled, but the desk books patients already
                    standing at the window, and data entry back-fills visits that
                    have happened — both need to start on a different rung.
                    A clinician booking their own diary gets no such choice: the
                    appointment is agreed and confirmed, and saying so is more
                    honest than offering a control whose other values are wrong. */}
                {bookingOwnDiary ? (
                  <div>
                    <label>{t('appointments.labelStatus')}</label>
                    <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--text-muted)' }}>
                      Confirmed — booked into your own diary. Reception will see it on their list.
                    </p>
                  </div>
                ) : (
                  <div><label>{t('appointments.labelStatus')}</label><AppointmentStatusSelect status={status} layout="bare" onChange={setStatus} /></div>
                )}
              </div>

              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', textTransform: 'none', fontSize: 13 }}>
                <input type="checkbox" checked={recurring} onChange={e => setRecurring(e.target.checked)} /> {t('appointments.recurringAppointment')}
                {recurring && (
                  <Select value={recurrencePattern} onChange={e => setRecurrencePattern(e.target.value as typeof recurrencePattern)} style={{ width: 'auto' }}>
                    <option value="weekly">{t('appointments.recurrenceWeekly')}</option>
                    <option value="biweekly">{t('appointments.recurrenceBiweekly')}</option>
                    <option value="monthly">{t('appointments.recurrenceMonthly')}</option>
                    <option value="quarterly">{t('appointments.recurrenceQuarterly')}</option>
                  </Select>
                )}
              </label>
            </>
          )}

          {/* ═══ Step 4 — insurance ═══ */}
          {stepped && step === 3 && (
            <>
              <BookingSummaryHeader
                providerName={provider}
                date={date}
                startTime={time}
                durationMinutes={duration}
                facilityName={currentUser?.hospitalName}
                onChange={() => setStep(1)}
              />
              <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)' }}>
                Optional. Recording cover now is what lets eligibility be checked before the visit,
                rather than at the desk on the day.
              </p>

              <div><label>Insurance provider</label><input type="text" value={insuranceProvider} onChange={e => setInsuranceProvider(e.target.value)} placeholder="e.g. NHIF" /></div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
                <div><label>Member ID</label><input type="text" value={insuranceMemberId} onChange={e => setInsuranceMemberId(e.target.value)} /></div>
                <div><label>Group ID</label><input type="text" value={insuranceGroupId} onChange={e => setInsuranceGroupId(e.target.value)} /></div>
              </div>
              <div><label>{t('appointments.labelNotes')}</label><textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} placeholder={t('appointments.notesPlaceholder')} /></div>
            </>
          )}

        </div>

        {/* ── Footer — outside the scroll area, so Next is always reachable ── */}
        <div
          style={{
            flexShrink: 0, paddingTop: 14, marginTop: 4,
            borderTop: '1px solid var(--border-light)',
          }}
        >
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <button
              type="button"
              onClick={() => (stepped && step > 0 ? setStep(step - 1) : onClose())}
              className="btn btn-secondary"
              style={{ flex: 1 }}
            >
              {stepped && step > 0 ? 'Back' : t('action.cancel')}
            </button>

            {stepped && step < STEPS.length - 1 ? (
              <button
                type="button"
                onClick={() => setStep(step + 1)}
                disabled={!canAdvance}
                className="btn btn-primary"
                style={{
                  flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  opacity: canAdvance ? 1 : 0.5, cursor: canAdvance ? 'pointer' : 'not-allowed',
                }}
              >
                Next <ArrowRight size={15} />
              </button>
            ) : (
              <button
                type="button"
                onClick={handleSubmit}
                disabled={submitting}
                className="btn btn-primary"
                style={{ flex: 1, opacity: submitting ? 0.6 : 1, cursor: submitting ? 'not-allowed' : 'pointer' }}
              >
                {submitting ? t('appointments.booking') : t('appointments.bookAppointment')}
              </button>
            )}
          </div>

          {stepped && (
            <div style={{ paddingTop: 2 }}>
              <BookingStepDots step={step} total={STEPS.length} />
            </div>
          )}
        </div>
      </div>
  );

  if (presentation === 'page') return panel;

  return (
    <PortalModal onClose={onClose} width={stepped && step === 1 ? 1080 : 720}>
      {panel}
    </PortalModal>
  );
}


/**
 * Booking by hand, when no clinician has clinic hours recorded yet.
 *
 * Every facility has a service menu from day one, but availability is a real
 * roster somebody has to enter. Until they do there is nothing to draw, and
 * refusing to book would make an admin task into a patient's problem. So the
 * step degrades to a date, a time and a clinician — the old behaviour — and
 * says plainly why, and where to fix it.
 */
function ManualTimeFallback({
  t, today, date, setDate, time, setTime, duration, setDuration,
  providerId, onProviderChange, providerOptions, providerSlotContext,
}: {
  t: (key: string, vars?: Record<string, string | number>) => string;
  today: string;
  date: string; setDate: (v: string) => void;
  time: string; setTime: (v: string) => void;
  duration: number; setDuration: (v: number) => void;
  providerId: string;
  onProviderChange: (id: string) => void;
  providerOptions: { _id: string; name?: string; username?: string }[];
  providerSlotContext: StaffSlotContext;
}) {
  return (
    <div
      style={{
        border: '1px solid var(--border-medium)', borderRadius: 12,
        padding: 14, background: 'var(--bg-card-solid)',
        display: 'flex', flexDirection: 'column', gap: 12,
      }}
    >
      <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)' }}>
        No clinic hours have been recorded for this facility yet, so there are no
        openings to choose from. Book by entering a time below — or set each
        clinician&apos;s hours in <strong>Settings → Visit types &amp; availability</strong>
        {' '}and this step will show their real openings.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', alignItems: 'stretch', gap: 12 }}>
        <div><label className="field-required">{t('appointments.labelDate')}</label><input type="date" value={date} onChange={e => setDate(e.target.value)} min={today} /></div>
        <div>
          <label className="field-required">{t('appointments.labelTime')}</label>
          <Select value={time} onChange={e => setTime(e.target.value)}>
            <option value="">Select a time…</option>
            {TIME_SLOTS.map(ts => <option key={ts} value={ts}>{ts}</option>)}
          </Select>
        </div>
        <div><label>{t('appointments.labelDuration')}</label><Select value={duration} onChange={e => setDuration(Number(e.target.value))}>{[15, 20, 30, 45, 60, 90].map(d => <option key={d} value={d}>{t('appointments.durationMin', { count: d })}</option>)}</Select></div>
      </div>
      <div>
        <label>{t('appointments.labelProvider')}</label>
        <Select value={providerId} onChange={e => onProviderChange(e.target.value)}>
          <option value="">Unassigned</option>
          {providerOptions.map(person => (
            <option key={person._id} value={person._id}>{staffOptionLabel(person as never, providerSlotContext)}</option>
          ))}
        </Select>
      </div>
    </div>
  );
}
