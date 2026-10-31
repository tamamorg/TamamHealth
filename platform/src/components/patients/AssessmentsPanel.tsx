'use client';

import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/lib/context';
import type { AssessmentDoc, PatientDoc } from '@/lib/db-types';
import { useAssessments } from '@/lib/hooks/useAssessments';
import { ASSESSMENT_INSTRUMENTS, getInstrument, scoreAssessment } from '@/lib/clinical/assessment-instruments';
import { isClinicalAuthorRole } from '@/lib/clinical-roles';
import ChartSection, { OmrsEmptyState } from '@/components/ehr/chart/ChartSection';
import { formatDateTime } from '@/lib/format-utils';
import { patientFullName } from '@/lib/patient-utils';
import Select from '@/components/Select';
import { describeError } from '@/lib/user-facing-error';
import { useTranslation } from '@/lib/i18n/useTranslation';
import RowActionsMenu from '@/components/RowActionsMenu';
import { FormError } from '@/components/overlay/FormNotices';
import FormField from '@/components/overlay/FormField';
import FormSlider from '@/components/overlay/FormSlider';

const SEVERITY_COLOR: Record<string, string> = {
  minimal: 'var(--color-success)',
  mild: 'var(--color-success)',
  moderate: 'var(--color-warning)',
  moderately_severe: 'var(--color-danger)',
  severe: 'var(--color-danger)',
};

/**
 * Outcome-measure assessments on the chart (P2.2). The front desk enters answers
 * (held); the score auto-totals; the provider reviews with the patient and signs.
 */
export default function AssessmentsPanel({ patient, focusId }: {
  patient: PatientDoc;
  /** Deep-link target from the dashboard's "documents to sign" list — this
   *  assessment is scrolled to and highlighted so the signer lands on the exact
   *  document they were sent to sign, not on a list to search. */
  focusId?: string;
}) {
  const { t } = useTranslation();
  const { currentUser } = useAuth();
  const { assessments } = useAssessments(patient._id);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [instrumentId, setInstrumentId] = useState(ASSESSMENT_INSTRUMENTS[0].id);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  // The held assessment open in the slider for the provider to review and sign.
  const [reviewing, setReviewing] = useState<AssessmentDoc | null>(null);

  const isProvider = isClinicalAuthorRole(currentUser?.role);

  // Scroll the deep-linked assessment into view once the list has loaded.
  useEffect(() => {
    if (!focusId || !assessments.some(a => a._id === focusId)) return;
    const raf = requestAnimationFrame(() => {
      document.getElementById(`assessment-${focusId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    return () => cancelAnimationFrame(raf);
  }, [focusId, assessments]);

  const instrument = getInstrument(instrumentId)!;
  const reviewInstrument = reviewing ? getInstrument(reviewing.instrumentId) : undefined;
  const closeForm = () => { setAdding(false); setReviewing(null); setError(null); };
  const liveScore = useMemo(() => scoreAssessment(instrument, answers), [instrument, answers]);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      setAdding(false);
      setReviewing(null);
      setAnswers({});
    } catch (e) {
      setError(describeError(e, t('msg.changeNotSavedTryAgain')));
    } finally {
      setBusy(false);
    }
  }
  async function doCreate() {
    const svc = await import('@/lib/services/assessment-service');
    await svc.createAssessment({
      patientId: patient._id,
      patientName: patientFullName(patient),
      instrumentId,
      answers,
      enteredById: currentUser?._id,
      enteredByName: currentUser?.name || currentUser?.username,
      hospitalId: patient.registrationHospital,
      orgId: patient.orgId,
    });
  }
  async function doSign(id: string) {
    const svc = await import('@/lib/services/assessment-service');
    await svc.signAssessment(id, { userId: currentUser?._id, userName: currentUser?.name || currentUser?.username || 'Provider', userRole: currentUser?.role });
  }

  return (
    <ChartSection title="Outcome measures" addLabel="New assessment" onAdd={() => { setAdding(true); setAnswers({}); }}>
      <table className="tamam-table tamam-table--fixed">
          <colgroup>
            <col /><col /><col /><col /><col /><col /><col />
          </colgroup>
          <thead>
            <tr>
              <th>Instrument</th>
              <th>Score</th>
              <th>Answered</th>
              <th>Entered by</th>
              <th>Date</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {assessments.length === 0 && (
              <tr>
                <td colSpan={7} style={{ cursor: 'default', background: 'transparent' }}>
                  <OmrsEmptyState itemLabel="assessments" actionLabel="New assessment" onAction={() => { setAdding(true); setAnswers({}); }} />
                </td>
              </tr>
            )}
            {assessments.map((a) => {
              const signed = a.documentStatus === 'signed';
              return (
                <tr
                  key={a._id}
                  id={`assessment-${a._id}`}
                  style={a._id === focusId ? { background: 'var(--accent-light)', boxShadow: 'inset 3px 0 0 var(--accent-primary)' } : undefined}
                >
                  <td className="tamam-cell-strong">{a.instrumentName}</td>
                  <td>
                    <span className="font-bold" style={{ color: a.severity ? SEVERITY_COLOR[a.severity] : 'var(--text-secondary)' }}>
                      {a.totalScore}
                    </span>
                    {a.interpretation ? <span className="tamam-cell-sub"> · {a.interpretation}</span> : null}
                  </td>
                  <td>{a.answeredCount}/{a.questionCount}</td>
                  <td>
                    {a.enteredByName || '—'}
                    {signed && a.signedByName && <div className="tamam-cell-sub">signed by {a.signedByName}</div>}
                  </td>
                  <td>{formatDateTime(a.createdAt)}</td>
                  <td>
                    <span className={signed ? 'tamam-panel-badge tamam-panel-badge--done' : 'tamam-panel-badge tamam-panel-badge--pending'}>
                      {signed ? 'Signed' : 'Held'}
                    </span>
                  </td>
                  <td>
                    <RowActionsMenu
                      ariaLabel={`Actions for ${a.instrumentName}`}
                      actions={[
                        !signed && isProvider
                          ? { key: 'sign', label: t('assessments.reviewSign'), onClick: () => setReviewing(a) }
                          : { key: 'view', label: t('assessments.view'), onClick: () => setReviewing(a) },
                      ]}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

      {error && !adding && !reviewing && <FormError message={error} />}

      {adding && (
        <FormSlider
          title={t('assessments.newTitle')}
          subtitle={patientFullName(patient)}
          className="tamam-dialog"
          size="lg"
          onClose={closeForm}
          busy={busy}
          footerNote={(
            <>
              {t('assessments.score', { score: liveScore.total })}
              {liveScore.band && <span style={{ color: SEVERITY_COLOR[liveScore.band.severity] }}> · {liveScore.band.label}</span>}
              {` (${t('assessments.answered', { answered: liveScore.answered, total: liveScore.questionCount })})`}
            </>
          )}
          footer={<>
            <button type="button" className="btn btn-secondary" disabled={busy} onClick={closeForm}>{t('action.cancel')}</button>
            <button type="button" className="btn btn-primary" disabled={busy || liveScore.answered === 0} onClick={() => run(doCreate)}>{t('assessments.save')}</button>
          </>}
        >
          <div className="space-y-4">
            <FormField label={t('assessments.instrument')} hint={instrument.description}>
              {control => (
                <Select {...control} value={instrumentId} onChange={e => { setInstrumentId(e.target.value); setAnswers({}); }}>
                  {ASSESSMENT_INSTRUMENTS.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
                </Select>
              )}
            </FormField>
            {instrument.questions.map((q, idx) => (
              <FormField key={q.id} label={`${idx + 1}. ${q.text}`}>
                {control => (
                  <Select
                    {...control}
                    value={answers[q.id] === undefined ? '' : String(answers[q.id])}
                    onChange={e => setAnswers(a => {
                      const next = { ...a };
                      if (e.target.value === '') delete next[q.id]; else next[q.id] = Number(e.target.value);
                      return next;
                    })}
                  >
                    <option value="">{t('o3form.chooseOption')}</option>
                    {instrument.options.map(opt => <option key={opt.value} value={opt.value}>{opt.label} ({opt.value})</option>)}
                  </Select>
                )}
              </FormField>
            ))}
            {error && <FormError message={error} />}
          </div>
        </FormSlider>
      )}

      {reviewing && (
        <FormSlider
          title={reviewing.instrumentName}
          subtitle={patientFullName(patient)}
          className="tamam-dialog"
          size="lg"
          onClose={closeForm}
          busy={busy}
          footer={<>
            <button type="button" className="btn btn-secondary" disabled={busy} onClick={closeForm}>{t(reviewing.documentStatus === 'signed' ? 'action.close' : 'action.cancel')}</button>
            {reviewing.documentStatus !== 'signed' && isProvider && (
              <button type="button" className="btn btn-primary" disabled={busy} onClick={() => run(() => doSign(reviewing._id))}>{t('assessments.sign')}</button>
            )}
          </>}
        >
          <div className="space-y-4">
            <FormField label={t('assessments.scoreLabel')}>
              <p className="tamam-slider-value">
                {reviewing.totalScore}{reviewing.interpretation ? ` · ${reviewing.interpretation}` : ''}
                {` (${t('assessments.answered', { answered: reviewing.answeredCount, total: reviewing.questionCount })})`}
              </p>
            </FormField>
            <FormField label={t('assessments.enteredBy')}><p className="tamam-slider-value">{reviewing.enteredByName || '—'} · {formatDateTime(reviewing.createdAt)}</p></FormField>
            {reviewing.signedByName && <FormField label={t('assessments.signedBy')}><p className="tamam-slider-value">{reviewing.signedByName} · {formatDateTime(reviewing.signedAt)}</p></FormField>}
            {reviewInstrument?.questions.map((q, idx) => {
              const value = reviewing.answers[q.id];
              const option = reviewInstrument.options.find(o => o.value === value);
              return (
                <FormField key={q.id} label={`${idx + 1}. ${q.text}`}>
                  <p className="tamam-slider-value">{option ? `${option.label} (${option.value})` : t('assessments.notAnswered')}</p>
                </FormField>
              );
            })}
            {error && <FormError message={error} />}
          </div>
        </FormSlider>
      )}
    </ChartSection>
  );
}
