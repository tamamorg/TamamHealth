'use client';

/**
 * The check-in questions — what Start a visit asks of a booked arrival — as
 * one draft every check-in surface shares: the status slider on a dashboard
 * row (CheckInSlider) and the appointment editor when its Status is set to
 * Checked in. Visit setting, attendance and punctuality; then payment.
 *
 * `layout` matches the host: 'row' is the editor's label-and-dropdown rows,
 * 'stack' the slider's label-above-field form.
 */

import { useEffect, useState, type ReactNode } from 'react';
import Select from '@/components/Select';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { useDataScope } from '@/lib/hooks/useDataScope';
import { jubaTime } from '@/lib/time-juba';
import {
  APPOINTMENT_TYPE_OPTIONS, VISIT_EXEMPTIONS, VISIT_PAYMENT_METHODS, VISIT_PUNCTUALITY, VISIT_TYPES,
  cleanVisitBilling, derivePunctuality, visitBillingComplete, visitTypeForBooking,
  type VisitBilling, type VisitDetails, type VisitPunctuality, type VisitType,
} from '@/lib/visits/visit-details';
import type { AttendanceType } from '@/lib/services/check-in-service';
import type { AppointmentDoc, AppointmentType } from '@/lib/db-types';

export interface CheckInDraft {
  attendance: AttendanceType;
  visit: VisitDetails;
  /** Payment answered fully enough to check in. */
  complete: boolean;
  detailsFields: ReactNode;
  billingFields: ReactNode;
}

export function useCheckInDraft(
  appointment: Pick<AppointmentDoc, 'patientId' | 'appointmentTime' | 'appointmentType'>,
  active: boolean,
  layout: 'row' | 'stack',
): CheckInDraft {
  const { t } = useTranslation();
  const scope = useDataScope();
  // The row host (the appointment editor) has its own Visit type field.
  const [appointmentType, setAppointmentType] = useState<AppointmentType>(visitTypeForBooking(appointment.appointmentType));
  const [visitType, setVisitType] = useState<VisitType>('opd');
  const [attendance, setAttendance] = useState<AttendanceType>('new');
  const [billing, setBilling] = useState<Partial<VisitBilling>>({});
  const [punctuality, setPunctuality] = useState<VisitPunctuality | ''>('');
  const [punctualityTouched, setPunctualityTouched] = useState(false);
  const effectivePunctuality: VisitPunctuality | '' = punctualityTouched
    ? punctuality
    : (active ? derivePunctuality(appointment.appointmentTime, jubaTime()) ?? '' : '');

  // New case or re-attendance, from the patient's history.
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    void import('@/lib/services/check-in-service')
      .then(m => m.deriveAttendanceType(appointment.patientId))
      .then(derived => { if (!cancelled) setAttendance(derived); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [active, appointment.patientId]);

  // An insured patient arrives paying by insurance, scheme and policy filled
  // from their primary policy — as Start a visit does.
  useEffect(() => {
    if (!active || !scope) return;
    let cancelled = false;
    void import('@/lib/services/payments/insurance')
      .then(m => m.getPrimaryPolicy(appointment.patientId, scope))
      .then(policy => {
        if (cancelled || !policy || !policy.isActive) return;
        setBilling(prev => (prev.payment ? prev : {
          payment: 'paying', method: 'insurance',
          insuranceScheme: policy.payerName,
          policyNumber: policy.policyNumber || policy.memberId || '',
        }));
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [active, scope, appointment.patientId]);

  // One field in the host's shape.
  const field = (label: string, control: ReactNode) => (layout === 'row'
    ? <div key={label}><label>{label}</label>{control}</div>
    : <label key={label} className="sv-field"><span className="sv-label">{label}</span>{control}</label>);

  const detailsFields = active ? (<>
    {layout === 'stack' && field(t('startVisit.visitTypeTitle'), (
      <Select value={appointmentType} onChange={e => setAppointmentType(e.target.value as AppointmentType)}>
        {APPOINTMENT_TYPE_OPTIONS.map(option => <option key={option.value} value={option.value}>{t(option.labelKey)}</option>)}
      </Select>
    ))}
    {field(t('startVisit.settingLabel'), (
      <Select value={visitType} onChange={e => setVisitType(e.target.value as VisitType)}>
        {VISIT_TYPES.map(option => <option key={option} value={option}>{t(`startVisit.visitType.${option}`)}</option>)}
      </Select>
    ))}
    {field(t('startVisit.attendance'), (
      <Select value={attendance} onChange={e => setAttendance(e.target.value as AttendanceType)}>
        <option value="new">{t('startVisit.attendance.new')}</option>
        <option value="repeat">{t('startVisit.attendance.repeat')}</option>
      </Select>
    ))}
    {field(t('startVisit.punctuality'), (
      <Select value={effectivePunctuality} onChange={e => { setPunctualityTouched(true); setPunctuality(e.target.value as VisitPunctuality | ''); }}>
        <option value="">{t('startVisit.selectOption')}</option>
        {VISIT_PUNCTUALITY.map(option => <option key={option} value={option}>{t(`startVisit.punctuality.${option}`)}</option>)}
      </Select>
    ))}
  </>) : null;

  const billingFields = active ? (<>
    {field(t('startVisit.paymentDetails'), (
      <Select value={billing.payment || ''} onChange={e => setBilling(prev => ({ ...prev, payment: (e.target.value || undefined) as VisitBilling['payment'] }))}>
        <option value="">{t('startVisit.selectOption')}</option>
        <option value="paying">{t('startVisit.payment.paying')}</option>
        <option value="non_paying">{t('startVisit.payment.non_paying')}</option>
      </Select>
    ))}
    {billing.payment === 'paying' && field(t('startVisit.paymentMethod'), (
      <Select value={billing.method || ''} onChange={e => setBilling(prev => ({ ...prev, method: (e.target.value || undefined) as VisitBilling['method'] }))}>
        <option value="">{t('startVisit.selectOption')}</option>
        {VISIT_PAYMENT_METHODS.map(method => <option key={method} value={method}>{t(`startVisit.method.${method}`)}</option>)}
      </Select>
    ))}
    {billing.payment === 'paying' && billing.method === 'insurance' && (<>
      {field(t('startVisit.insuranceScheme'), (
        <input type="text" value={billing.insuranceScheme || ''} placeholder={t('startVisit.insuranceSchemePlaceholder')} onChange={e => setBilling(prev => ({ ...prev, insuranceScheme: e.target.value }))} />
      ))}
      {field(t('startVisit.policyNumber'), (
        <input type="text" value={billing.policyNumber || ''} onChange={e => setBilling(prev => ({ ...prev, policyNumber: e.target.value }))} />
      ))}
    </>)}
    {billing.payment === 'non_paying' && field(t('startVisit.exemption'), (
      <Select value={billing.exemption || ''} onChange={e => setBilling(prev => ({ ...prev, exemption: (e.target.value || undefined) as VisitBilling['exemption'] }))}>
        <option value="">{t('startVisit.selectOption')}</option>
        {VISIT_EXEMPTIONS.map(exemption => <option key={exemption} value={exemption}>{t(`startVisit.exemption.${exemption}`)}</option>)}
      </Select>
    ))}
    {billing.payment === 'non_paying' && billing.exemption === 'other' && field(t('startVisit.exemptionReason'), (
      <input type="text" value={billing.exemptionReason || ''} onChange={e => setBilling(prev => ({ ...prev, exemptionReason: e.target.value }))} />
    ))}
  </>) : null;

  return {
    attendance,
    visit: {
      ...(layout === 'stack' ? { appointmentType } : {}),
      visitType,
      visitBilling: cleanVisitBilling(billing),
      ...(effectivePunctuality ? { punctuality: effectivePunctuality } : {}),
    },
    complete: visitBillingComplete(billing),
    detailsFields,
    billingFields,
  };
}
