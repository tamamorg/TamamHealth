'use client';

/**
 * Start a visit — one form for opening a patient's visit, wherever it starts:
 * the chart's workspace and the front desk's Check in. The OpenMRS O3 shape:
 * "The visit is New / Ongoing / In the past", the patient's upcoming
 * appointments to fulfil, the visit location and type, billing details and
 * punctuality, with Discard / Start visit pinned at the foot.
 *
 * Starting a visit is check-in, not a parallel write. Choosing one of today's
 * appointments checks that booking in (`checkInAppointment`); choosing none is
 * a walk-in (`checkInPatient`). Either way the same encounter, triage entry,
 * booking link and notifications follow, and the visit type, payer and
 * punctuality answered here are stamped on that encounter
 * (lib/visits/visit-details.ts). Check-in records the payer only — no charge
 * is posted here.
 */

import { useEffect, useMemo, useState } from 'react';
import InlineBanner from '@/components/overlay/InlineBanner';
import { useToast } from '@/components/Toast';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { useDepartments } from '@/lib/hooks/useDepartments';
import { useDataScope } from '@/lib/hooks/useDataScope';
import { describeError } from '@/lib/user-facing-error';
import { encounterVisitState } from '@/lib/clinical-flow/visit-state';
import { APPOINTMENT_PENDING_STATUSES } from '@/lib/appointment-status';
import { jubaDate, jubaTime } from '@/lib/time-juba';
import { formatClockTime } from '@/lib/format-utils';
import {
  APPOINTMENT_TYPE_OPTIONS, VISIT_EXEMPTIONS, VISIT_PAYMENT_METHODS, VISIT_PUNCTUALITY, VISIT_TYPES,
  cleanVisitBilling, derivePunctuality, visitBillingComplete, visitTypeForBooking,
  type VisitBilling, type VisitPunctuality, type VisitType,
} from '@/lib/visits/visit-details';
import type { AppointmentDoc, AppointmentType, EncounterDoc, PatientDoc } from '@/lib/db-types';
import type { AttendanceType, CheckInAcuity } from '@/lib/services/check-in-service';
import './start-visit-panel.css';
import FormNotices from '@/components/overlay/FormNotices';
import Select from '@/components/Select';

type VisitTiming = 'new' | 'ongoing' | 'past';
type Arrival = 'walk-in' | 'ambulance' | 'referral' | 'police' | 'other';

export interface StartVisitUser {
  _id: string;
  name: string;
  role?: string;
  hospitalId?: string;
  hospitalName?: string;
  orgId?: string;
}

/** The patient fields the form needs — the chart passes the whole record,
 *  the front desk what the appointment carries. */
export type StartVisitPatient = Pick<PatientDoc, '_id'> & Partial<Pick<PatientDoc, 'hospitalNumber' | 'phone' | 'dateOfBirth'>>;

const ARRIVALS: Arrival[] = ['walk-in', 'referral', 'ambulance', 'police', 'other'];
const ACUITIES: CheckInAcuity[] = ['routine', 'priority', 'emergency'];
/** The radio value for "no appointment — this is a walk-in". */
const WALK_IN = '';

const ageInYears = (dob?: string): number | null => {
  if (!dob) return null;
  const born = new Date(dob);
  if (Number.isNaN(born.getTime())) return null;
  return (Date.now() - born.getTime()) / (365.25 * 24 * 3600 * 1000);
};

export default function StartVisitPanel({ patient, patientName, currentUser, appointmentId, onClose, onStarted }: {
  patient: StartVisitPatient;
  patientName: string;
  currentUser: StartVisitUser;
  /** Pre-select this booking — the front desk's Check in on an appointment row. */
  appointmentId?: string;
  onClose: () => void;
  onStarted?: (encounter: EncounterDoc | null) => void;
}) {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const scope = useDataScope();
  const { departments } = useDepartments();
  const facilityId = currentUser.hospitalId || '';
  const today = jubaDate();

  const [activeVisit, setActiveVisit] = useState<EncounterDoc | null | undefined>(undefined);
  const [timing, setTiming] = useState<VisitTiming>('new');
  const [bannerOpen, setBannerOpen] = useState(true);
  const [appointments, setAppointments] = useState<AppointmentDoc[]>([]);
  const [chosenAppointmentId, setChosenAppointmentId] = useState<string>(appointmentId ?? WALK_IN);
  const [typeChoice, setTypeChoice] = useState<AppointmentType | null>(null);
  const [visitType, setVisitType] = useState<VisitType>('opd');
  const [department, setDepartment] = useState('');
  const [attendance, setAttendance] = useState<AttendanceType>('new');
  const [attendanceTouched, setAttendanceTouched] = useState(false);
  const [arrival, setArrival] = useState<Arrival>('walk-in');
  const [acuity, setAcuity] = useState<CheckInAcuity>('routine');
  const [reason, setReason] = useState('');
  const [billing, setBilling] = useState<Partial<VisitBilling>>({});
  const [punctuality, setPunctuality] = useState<VisitPunctuality | ''>('');
  const [punctualityTouched, setPunctualityTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  // A visit may still be started on a record marked as a duplicate (an
  // emergency must be treatable); the panel says so rather than blocking.
  const [keptRecord, setKeptRecord] = useState<{ name: string } | null>(null);
  useEffect(() => {
    if (!scope) return;
    let cancelled = false;
    void import('@/lib/services/patient-service')
      .then(async svc => {
        const chart = await svc.getPatientById(patient._id, scope);
        if (!chart?.duplicateOf) return null;
        const kept = await svc.getPatientById(chart.duplicateOf, scope);
        return { name: kept ? [kept.firstName, kept.surname].filter(Boolean).join(' ') : t('dup.keptUnknown') };
      })
      .then(found => { if (!cancelled) setKeptRecord(found); })
      .catch(() => { if (!cancelled) setKeptRecord(null); });
    return () => { cancelled = true; };
  }, [patient._id, scope, t]);

  // Is a visit already open here? One open visit per patient per facility is
  // the rule the queues are built on, so a second one is refused up front.
  useEffect(() => {
    let cancelled = false;
    void import('@/lib/services/encounter-service')
      .then(m => m.findOpenEncounterForPatient(patient._id, facilityId))
      .then(found => {
        if (cancelled) return;
        setActiveVisit(found);
        if (found) setTiming('ongoing');
      })
      .catch(() => { if (!cancelled) setActiveVisit(null); });
    return () => { cancelled = true; };
  }, [patient._id, facilityId]);

  // The patient's bookings still waiting for them at THIS facility, today and
  // ahead. The lookup is unscoped (it spans every facility the patient has
  // visited), so the org and facility filter here is the tenant barrier.
  useEffect(() => {
    let cancelled = false;
    void import('@/lib/services/appointment-service')
      .then(m => m.getAppointmentsByPatient(patient._id))
      .then(rows => {
        if (cancelled) return;
        setAppointments(rows
          .filter(a => a.facilityId === facilityId && a.orgId === currentUser.orgId)
          .filter(a => a.appointmentDate >= today)
          .filter(a => APPOINTMENT_PENDING_STATUSES.includes(a.status) || (a.status === 'requested' && a.appointmentDate === today))
          .sort((a, b) => `${a.appointmentDate}${a.appointmentTime}`.localeCompare(`${b.appointmentDate}${b.appointmentTime}`)));
      })
      .catch(() => { if (!cancelled) setAppointments([]); });
    return () => { cancelled = true; };
  }, [patient._id, facilityId, currentUser.orgId, today]);

  // New case or re-attendance, from the patient's history; the desk may change it.
  useEffect(() => {
    let cancelled = false;
    void import('@/lib/services/check-in-service')
      .then(m => m.deriveAttendanceType(patient._id))
      .then(derived => { if (!cancelled && !attendanceTouched) setAttendance(derived); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [patient._id, attendanceTouched]);

  // An insured patient arrives paying by insurance, with the scheme and policy
  // number already filled from their primary policy.
  useEffect(() => {
    if (!scope) return;
    let cancelled = false;
    void import('@/lib/services/payments/insurance')
      .then(m => m.getPrimaryPolicy(patient._id, scope))
      .then(policy => {
        if (cancelled || !policy || !policy.isActive) return;
        setBilling(prev => (prev.payment ? prev : {
          payment: 'paying',
          method: 'insurance',
          insuranceScheme: policy.payerName,
          policyNumber: policy.policyNumber || policy.memberId || '',
        }));
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [patient._id, scope]);

  const chosenAppointment = useMemo(
    () => appointments.find(a => a._id === chosenAppointmentId) ?? null,
    [appointments, chosenAppointmentId],
  );

  // A booked arrival is early, on time or late against its slot — suggested
  // from the clock until the desk picks one.
  const suggestedPunctuality = chosenAppointment ? derivePunctuality(chosenAppointment.appointmentTime, jubaTime()) : undefined;
  const effectivePunctuality: VisitPunctuality | '' = punctualityTouched ? punctuality : suggestedPunctuality ?? '';

  const departmentNames = departments.length ? departments.map(d => d.name) : ['OPD'];
  const chosenDepartment = department || departmentNames[0];
  const isWalkIn = !chosenAppointment;
  const appointmentType = typeChoice ?? visitTypeForBooking(chosenAppointment?.appointmentType);
  const childUnderFive = (ageInYears(patient.dateOfBirth) ?? 99) < 5;

  const canStart = timing === 'new'
    && activeVisit === null
    && Boolean(visitType)
    && visitBillingComplete(billing)
    && (!isWalkIn || reason.trim().length > 0)
    && !saving;

  const start = async () => {
    if (!canStart) return;
    setSaving(true);
    const visit = {
      appointmentType,
      visitType,
      visitBilling: cleanVisitBilling(billing),
      ...(chosenAppointment && effectivePunctuality ? { punctuality: effectivePunctuality } : {}),
    };
    try {
      const checkIn = await import('@/lib/services/check-in-service');
      let encounter: EncounterDoc | null = null;
      if (chosenAppointment) {
        await checkIn.checkInAppointment({
          appointmentId: chosenAppointment._id,
          patientId: patient._id,
          patientName,
          hospitalNumber: patient.hospitalNumber,
          facilityId: chosenAppointment.facilityId || facilityId,
          facilityName: chosenAppointment.facilityName || currentUser.hospitalName || '',
          orgId: chosenAppointment.orgId || currentUser.orgId,
          attendanceType: attendance,
          visit,
          actorId: currentUser._id,
          actorName: currentUser.name,
          actorRole: currentUser.role,
        });
        const { findOpenEncounterForPatient } = await import('@/lib/services/encounter-service');
        encounter = await findOpenEncounterForPatient(patient._id, chosenAppointment.facilityId || facilityId);
        showToast(t('startVisit.checkedIn', { name: patientName }), 'success');
      } else {
        const result = await checkIn.checkInPatient({
          patientId: patient._id,
          patientName,
          hospitalNumber: patient.hospitalNumber,
          patientPhone: patient.phone || undefined,
          facilityId,
          facilityName: currentUser.hospitalName || '',
          orgId: currentUser.orgId,
          department: chosenDepartment,
          departmentId: departments.find(d => d.name === chosenDepartment)?._id,
          modeOfArrival: arrival,
          acuity,
          chiefComplaint: reason.trim(),
          attendanceType: attendance,
          visit,
          checkedInById: currentUser._id,
          checkedInByName: currentUser.name,
        });
        encounter = result.encounter;
        showToast(t('startVisit.started', { name: patientName }), 'success');
      }
      if (keptRecord) showToast(t('dup.visitWarning', { name: keptRecord.name }), 'warning');
      onStarted?.(encounter);
      onClose();
    } catch (error) {
      showToast(describeError(error, t('startVisit.notStarted')), 'error');
    } finally {
      setSaving(false);
    }
  };

  const activeState = activeVisit ? encounterVisitState(activeVisit.status) : null;
  const startedAt = activeVisit?.createdAt ? new Date(activeVisit.createdAt) : null;
  const appointmentWhen = (a: AppointmentDoc) => `${a.appointmentDate === today ? t('startVisit.today') : a.appointmentDate}, ${formatClockTime(a.appointmentTime)}`;

  const setPayment = (payment: VisitBilling['payment']) => setBilling(prev => ({
    ...prev,
    payment,
    // A child under five is exempt by policy — offer that first.
    ...(payment === 'non_paying' && !prev.exemption && childUnderFive ? { exemption: 'under_five' as const } : {}),
  }));

  return (
    <div className="sv-root">
      <div className="sv-body">
        <fieldset className="sv-fieldset">
          <legend className="sv-label">{t('startVisit.timingLabel')}</legend>
          <div className="sv-segmented" role="radiogroup" aria-label={t('startVisit.timingLabel')}>
            {(['new', 'ongoing', 'past'] as VisitTiming[]).map(option => (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={timing === option}
                className={timing === option ? 'is-selected' : ''}
                onClick={() => setTiming(option)}
              >
                {t(`startVisit.timing.${option}`)}
              </button>
            ))}
          </div>
        </fieldset>

        {keptRecord && (
          <InlineBanner tone="warning" compact>{t('dup.visitPanelWarning', { name: keptRecord.name })}</InlineBanner>
        )}

        {activeVisit && bannerOpen && (
          <InlineBanner tone="info" title={t('startVisit.activeTitle')} onDismiss={() => setBannerOpen(false)}>
            {t('startVisit.activeBody')}
          </InlineBanner>
        )}

        {timing === 'ongoing' && (
          activeVisit ? (
            <dl className="sv-facts">
              <div><dt>{t('startVisit.stage')}</dt><dd>{activeState?.label || '—'}</dd></div>
              <div><dt>{t('startVisit.startedAt')}</dt><dd>{startedAt ? startedAt.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—'}</dd></div>
              <div><dt>{t('startVisit.clinician')}</dt><dd>{activeVisit.assignedClinicianName || activeVisit.clinicianName || t('startVisit.unassigned')}</dd></div>
            </dl>
          ) : activeVisit === null ? (
            <p className="sv-empty">{t('startVisit.noActive')}</p>
          ) : null
        )}

        {timing === 'past' && <p className="sv-empty">{t('startVisit.pastUnavailable')}</p>}

        {timing === 'new' && activeVisit === null && (
          <div className="sv-form">
            {/* Upcoming appointments — today's can be fulfilled now; later
                ones are listed so the desk sees them, but checking one in
                today would stamp the wrong day on it. */}
            <section className="sv-section">
              <h3 className="sv-section-title">{t('startVisit.appointmentsTitle')}</h3>
              <p className="sv-label">{t('startVisit.appointmentsHint')}</p>
              <table className="sv-appts">
                <thead>
                  <tr>
                    <th scope="col">{t('startVisit.colDate')}</th>
                    <th scope="col">{t('startVisit.colType')}</th>
                    <th scope="col" className="sv-appts-action">{t('startVisit.colAction')}</th>
                  </tr>
                </thead>
                <tbody>
                  {appointments.map(a => {
                    const isToday = a.appointmentDate === today;
                    const inputId = `sv-appt-${a._id}`;
                    return (
                      <tr key={a._id} className={isToday ? '' : 'is-later'}>
                        <td><label htmlFor={inputId}>{appointmentWhen(a)}</label></td>
                        <td>{a.department || a.reason || '—'}{!isToday && <span className="sv-appts-note">{t('startVisit.notToday')}</span>}</td>
                        <td className="sv-appts-action">
                          <input
                            id={inputId}
                            type="radio"
                            name="sv-appointment"
                            checked={chosenAppointmentId === a._id}
                            disabled={!isToday}
                            onChange={() => setChosenAppointmentId(a._id)}
                          />
                        </td>
                      </tr>
                    );
                  })}
                  <tr>
                    <td colSpan={2}><label htmlFor="sv-appt-walk-in">{appointments.length ? t('startVisit.noAppointmentChoice') : t('startVisit.noAppointments')}</label></td>
                    <td className="sv-appts-action">
                      <input
                        id="sv-appt-walk-in"
                        type="radio"
                        name="sv-appointment"
                        checked={chosenAppointmentId === WALK_IN}
                        onChange={() => setChosenAppointmentId(WALK_IN)}
                      />
                    </td>
                  </tr>
                </tbody>
              </table>
            </section>

            <section className="sv-section">
              <h3 className="sv-section-title">{t('startVisit.locationTitle')}</h3>
              <p className="sv-readonly">{currentUser.hospitalName || '—'}</p>
            </section>

            <section className="sv-section">
              <h3 className="sv-section-title">{t('startVisit.visitTypeTitle')}</h3>
              <Select value={appointmentType} aria-label={t('startVisit.visitTypeTitle')} onChange={e => setTypeChoice(e.target.value as AppointmentType)}>
                {APPOINTMENT_TYPE_OPTIONS.map(option => <option key={option.value} value={option.value}>{t(option.labelKey)}</option>)}
              </Select>
            </section>

            <fieldset className="sv-fieldset sv-section">
              <legend className="sv-section-title">{t('startVisit.settingLabel')}</legend>
              <div className="sv-choices">
                {VISIT_TYPES.map(type => (
                  <label key={type} className="sv-choice">
                    <input type="radio" name="sv-visit-type" checked={visitType === type} onChange={() => setVisitType(type)} />
                    {t(`startVisit.visitType.${type}`)}
                  </label>
                ))}
              </div>
            </fieldset>

            <fieldset className="sv-fieldset">
              <legend className="sv-label">{t('startVisit.attendance')}</legend>
              <div className="sv-segmented" role="radiogroup" aria-label={t('startVisit.attendance')}>
                {(['new', 'repeat'] as AttendanceType[]).map(option => (
                  <button
                    key={option}
                    type="button"
                    role="radio"
                    aria-checked={attendance === option}
                    className={attendance === option ? 'is-selected' : ''}
                    onClick={() => { setAttendanceTouched(true); setAttendance(option); }}
                  >
                    {t(`startVisit.attendance.${option}`)}
                  </button>
                ))}
              </div>
            </fieldset>

            {/* A walk-in has no booking to say where they are going, why they
                came or how urgent it is, so the desk asks; a booked arrival
                carries all three. */}
            {isWalkIn && (
              <>
                <label className="sv-field">
                  <span className="sv-label">{t('startVisit.department')}</span>
                  <Select value={chosenDepartment} onChange={event => setDepartment(event.target.value)}>
                    {departmentNames.map(name => <option key={name} value={name}>{name}</option>)}
                  </Select>
                </label>
                <label className="sv-field">
                  <span className="sv-label">{t('startVisit.arrival')}</span>
                  <Select value={arrival} onChange={event => setArrival(event.target.value as Arrival)}>
                    {ARRIVALS.map(option => <option key={option} value={option}>{t(`startVisit.arrival.${option}`)}</option>)}
                  </Select>
                </label>
                <fieldset className="sv-fieldset">
                  <legend className="sv-label">{t('startVisit.urgency')}</legend>
                  <div className="sv-segmented" role="radiogroup" aria-label={t('startVisit.urgency')}>
                    {ACUITIES.map(option => (
                      <button
                        key={option}
                        type="button"
                        role="radio"
                        aria-checked={acuity === option}
                        className={`${acuity === option ? 'is-selected' : ''}${option === 'emergency' ? ' is-danger' : ''}`}
                        onClick={() => setAcuity(option)}
                      >
                        {t(`startVisit.acuity.${option}`)}
                      </button>
                    ))}
                  </div>
                </fieldset>
                <label className="sv-field">
                  <span className="sv-label">{t('startVisit.reason')}</span>
                  <textarea rows={3} value={reason} onChange={event => setReason(event.target.value)} placeholder={t('startVisit.reasonPlaceholder')} />
                </label>
              </>
            )}

            {/* Billing details — who pays for this visit. Recorded only:
                bills raised later read it; nothing is charged here. */}
            <section className="sv-section">
              <h3 className="sv-section-title">{t('startVisit.billingTitle')}</h3>
              <fieldset className="sv-fieldset">
                <legend className="sv-label">{t('startVisit.paymentDetails')}</legend>
                <div className="sv-radios">
                  {(['paying', 'non_paying'] as const).map(option => (
                    <label key={option} className="sv-choice">
                      <input type="radio" name="sv-payment" checked={billing.payment === option} onChange={() => setPayment(option)} />
                      {t(`startVisit.payment.${option}`)}
                    </label>
                  ))}
                </div>
              </fieldset>

              {billing.payment === 'paying' && (
                <>
                  <fieldset className="sv-fieldset">
                    <legend className="sv-label">{t('startVisit.paymentMethod')}</legend>
                    <div className="sv-radios">
                      {VISIT_PAYMENT_METHODS.map(method => (
                        <label key={method} className="sv-choice">
                          <input type="radio" name="sv-method" checked={billing.method === method} onChange={() => setBilling(prev => ({ ...prev, method }))} />
                          {t(`startVisit.method.${method}`)}
                        </label>
                      ))}
                    </div>
                  </fieldset>
                  {billing.method === 'insurance' && (
                    <>
                      <label className="sv-field">
                        <span className="sv-label">{t('startVisit.insuranceScheme')}</span>
                        <input type="text" value={billing.insuranceScheme || ''} onChange={event => setBilling(prev => ({ ...prev, insuranceScheme: event.target.value }))} placeholder={t('startVisit.insuranceSchemePlaceholder')} />
                      </label>
                      <label className="sv-field">
                        <span className="sv-label">{t('startVisit.policyNumber')}</span>
                        <input type="text" value={billing.policyNumber || ''} onChange={event => setBilling(prev => ({ ...prev, policyNumber: event.target.value }))} placeholder={t('startVisit.policyNumber')} />
                      </label>
                    </>
                  )}
                </>
              )}

              {billing.payment === 'non_paying' && (
                <>
                  <label className="sv-field">
                    <span className="sv-label">{t('startVisit.exemption')}</span>
                    <Select value={billing.exemption || ''} onChange={event => setBilling(prev => ({ ...prev, exemption: (event.target.value || undefined) as VisitBilling['exemption'] }))}>
                      <option value="">{t('startVisit.selectOption')}</option>
                      {VISIT_EXEMPTIONS.map(exemption => <option key={exemption} value={exemption}>{t(`startVisit.exemption.${exemption}`)}</option>)}
                    </Select>
                  </label>
                  {billing.exemption === 'other' && (
                    <label className="sv-field">
                      <span className="sv-label">{t('startVisit.exemptionReason')}</span>
                      <input type="text" value={billing.exemptionReason || ''} onChange={event => setBilling(prev => ({ ...prev, exemptionReason: event.target.value }))} />
                    </label>
                  )}
                  <p className="sv-hint">{t('startVisit.nonPayingHint')}</p>
                </>
              )}
            </section>

            {chosenAppointment && (
              <label className="sv-field">
                <span className="sv-label">{t('startVisit.punctuality')}</span>
                <Select
                  value={effectivePunctuality}
                  onChange={event => { setPunctualityTouched(true); setPunctuality(event.target.value as VisitPunctuality | ''); }}
                >
                  <option value="">{t('startVisit.selectOption')}</option>
                  {VISIT_PUNCTUALITY.map(option => <option key={option} value={option}>{t(`startVisit.punctuality.${option}`)}</option>)}
                </Select>
              </label>
            )}
          </div>
        )}
      </div>

      <FormNotices />
      <div className="sv-footer">
        <button type="button" className="sv-footer-btn sv-footer-btn--discard" onClick={onClose} disabled={saving}>
          {t('startVisit.discard')}
        </button>
        <button type="button" className="sv-footer-btn sv-footer-btn--primary" onClick={() => void start()} disabled={!canStart}>
          {saving ? t('startVisit.starting') : t('startVisit.start')}
        </button>
      </div>
    </div>
  );
}
