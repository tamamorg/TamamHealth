'use client';

/**
 * Start a visit — the chart's workspace for opening today's visit, in the
 * OpenMRS O3 shape: "The visit is New / Ongoing / In the past", a warning when
 * the patient already has a visit open, and Discard / Start visit pinned at
 * the foot.
 *
 * Starting a visit is the front desk's walk-in check-in (`checkInPatient`),
 * not a parallel write: the same encounter, triage entry, booking link and
 * notifications, so a visit opened from the chart is indistinguishable on
 * every worklist from one opened at reception.
 */

import { useEffect, useState } from 'react';
import InlineBanner from '@/components/overlay/InlineBanner';
import { useToast } from '@/components/Toast';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { useDepartments } from '@/lib/hooks/useDepartments';
import { describeError } from '@/lib/user-facing-error';
import { encounterVisitState } from '@/lib/clinical-flow/visit-state';
import type { EncounterDoc, PatientDoc } from '@/lib/db-types';
import type { CheckInAcuity } from '@/lib/services/check-in-service';
import './start-visit-panel.css';
import FormNotices from '@/components/overlay/FormNotices';

type VisitTiming = 'new' | 'ongoing' | 'past';
type Arrival = 'walk-in' | 'ambulance' | 'referral' | 'police' | 'other';

export interface StartVisitUser {
  _id: string;
  name: string;
  hospitalId?: string;
  hospitalName?: string;
  orgId?: string;
}

const ARRIVALS: Arrival[] = ['walk-in', 'referral', 'ambulance', 'police', 'other'];
const ACUITIES: CheckInAcuity[] = ['routine', 'priority', 'emergency'];

export default function StartVisitPanel({ patient, patientName, currentUser, onClose, onStarted }: {
  patient: PatientDoc;
  patientName: string;
  currentUser: StartVisitUser;
  onClose: () => void;
  onStarted?: (encounter: EncounterDoc) => void;
}) {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const { departments } = useDepartments();
  const [activeVisit, setActiveVisit] = useState<EncounterDoc | null | undefined>(undefined);
  const [timing, setTiming] = useState<VisitTiming>('new');
  const [bannerOpen, setBannerOpen] = useState(true);
  const [department, setDepartment] = useState('');
  const [arrival, setArrival] = useState<Arrival>('walk-in');
  const [acuity, setAcuity] = useState<CheckInAcuity>('routine');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  // Is a visit already open here? One open visit per patient per facility is
  // the rule the queues are built on, so a second one is refused up front.
  useEffect(() => {
    let cancelled = false;
    void import('@/lib/services/encounter-service')
      .then(m => m.findOpenEncounterForPatient(patient._id, currentUser.hospitalId || ''))
      .then(found => {
        if (cancelled) return;
        setActiveVisit(found);
        if (found) setTiming('ongoing');
      })
      .catch(() => { if (!cancelled) setActiveVisit(null); });
    return () => { cancelled = true; };
  }, [patient._id, currentUser.hospitalId]);

  const departmentNames = departments.length ? departments.map(d => d.name) : ['OPD'];
  const chosenDepartment = department || departmentNames[0];
  const canStart = timing === 'new' && activeVisit === null && reason.trim().length > 0 && !saving;

  const start = async () => {
    if (!canStart) return;
    setSaving(true);
    try {
      const { checkInPatient } = await import('@/lib/services/check-in-service');
      const result = await checkInPatient({
        patientId: patient._id,
        patientName,
        hospitalNumber: patient.hospitalNumber,
        patientPhone: patient.phone || undefined,
        facilityId: currentUser.hospitalId || '',
        facilityName: currentUser.hospitalName || '',
        orgId: currentUser.orgId,
        department: chosenDepartment,
        departmentId: departments.find(d => d.name === chosenDepartment)?._id,
        modeOfArrival: arrival,
        acuity,
        chiefComplaint: reason.trim(),
        checkedInById: currentUser._id,
        checkedInByName: currentUser.name,
      });
      showToast(t('startVisit.started', { name: patientName }), 'success');
      onStarted?.(result.encounter);
      onClose();
    } catch (error) {
      showToast(describeError(error, t('startVisit.notStarted')), 'error');
    } finally {
      setSaving(false);
    }
  };

  const activeState = activeVisit ? encounterVisitState(activeVisit.status) : null;
  const startedAt = activeVisit?.createdAt ? new Date(activeVisit.createdAt) : null;

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
            <label className="sv-field">
              <span className="sv-label">{t('startVisit.department')}</span>
              <select value={chosenDepartment} onChange={event => setDepartment(event.target.value)}>
                {departmentNames.map(name => <option key={name} value={name}>{name}</option>)}
              </select>
            </label>
            <label className="sv-field">
              <span className="sv-label">{t('startVisit.arrival')}</span>
              <select value={arrival} onChange={event => setArrival(event.target.value as Arrival)}>
                {ARRIVALS.map(option => <option key={option} value={option}>{t(`startVisit.arrival.${option}`)}</option>)}
              </select>
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
