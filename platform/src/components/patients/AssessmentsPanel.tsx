'use client';

import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/lib/context';
import type { PatientDoc } from '@/lib/db-types';
import { useAssessments } from '@/lib/hooks/useAssessments';
import { ASSESSMENT_INSTRUMENTS, getInstrument, scoreAssessment } from '@/lib/clinical/assessment-instruments';
import { isClinicalAuthorRole } from '@/lib/clinical-roles';
import { Lock } from '@/components/icons/lucide';
import ChartSection, { OmrsEmptyState } from '@/components/ehr/chart/ChartSection';
import { formatDateTime } from '@/lib/format-utils';
import { patientFullName } from '@/lib/patient-utils';
import Select from '@/components/Select';

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
  const { currentUser } = useAuth();
  const { assessments } = useAssessments(patient._id);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [instrumentId, setInstrumentId] = useState(ASSESSMENT_INSTRUMENTS[0].id);
  const [answers, setAnswers] = useState<Record<string, number>>({});

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
  const liveScore = useMemo(() => scoreAssessment(instrument, answers), [instrument, answers]);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      setAdding(false);
      setAnswers({});
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed');
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
      {adding && (
        <div className="rounded-lg p-3 mb-3 space-y-3" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-light)' }}>
          <Select value={instrumentId} onChange={(e) => { setInstrumentId(e.target.value); setAnswers({}); }}
            className="w-full p-2 rounded-md text-[13px]" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-light)', color: 'var(--text-primary)' }}>
            {ASSESSMENT_INSTRUMENTS.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
          </Select>
          <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{instrument.description}</p>
          <ol className="space-y-2">
            {instrument.questions.map((q, idx) => (
              <li key={q.id}>
                <p className="text-[12px] mb-1" style={{ color: 'var(--text-primary)' }}>{idx + 1}. {q.text}</p>
                <div className="flex flex-wrap gap-1.5">
                  {instrument.options.map((opt) => {
                    const selected = answers[q.id] === opt.value;
                    return (
                      <button key={opt.value} type="button"
                        onClick={() => setAnswers((a) => ({ ...a, [q.id]: opt.value }))}
                        className="text-[11px] px-2 py-1 rounded-md"
                        style={selected
                          ? { background: 'var(--accent-primary)', color: '#fff' }
                          : { background: 'var(--bg-card)', border: '1px solid var(--border-light)', color: 'var(--text-secondary)' }}>
                        {opt.label} ({opt.value})
                      </button>
                    );
                  })}
                </div>
              </li>
            ))}
          </ol>
          <div className="flex items-center justify-between">
            <span className="text-[12px] font-semibold" style={{ color: 'var(--text-primary)' }}>
              Score: {liveScore.total}
              {liveScore.band && <span style={{ color: SEVERITY_COLOR[liveScore.band.severity] }}> · {liveScore.band.label}</span>}
              <span className="font-normal" style={{ color: 'var(--text-muted)' }}> ({liveScore.answered}/{liveScore.questionCount} answered)</span>
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button className="btn btn-sm btn-primary" disabled={busy || liveScore.answered === 0} onClick={() => run(doCreate)}>Save (hold for provider)</button>
            <button className="btn btn-sm btn-secondary" disabled={busy} onClick={() => setAdding(false)}>Cancel</button>
          </div>
        </div>
      )}

      {assessments.length === 0 && !adding && (
        <OmrsEmptyState itemLabel="assessments" actionLabel="New assessment" onAction={() => { setAdding(true); setAnswers({}); }} />
      )}

      {assessments.length > 0 && (
        <table className="omrs-table omrs-table--fixed">
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
              <th>Actions</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {assessments.map((a) => {
              const signed = a.documentStatus === 'signed';
              return (
                <tr
                  key={a._id}
                  id={`assessment-${a._id}`}
                  style={a._id === focusId ? { background: 'var(--accent-light)', boxShadow: 'inset 3px 0 0 var(--accent-primary)' } : undefined}
                >
                  <td className="omrs-cell-strong">{a.instrumentName}</td>
                  <td>
                    <span className="font-bold" style={{ color: a.severity ? SEVERITY_COLOR[a.severity] : 'var(--text-secondary)' }}>
                      {a.totalScore}
                    </span>
                    {a.interpretation ? <span className="omrs-cell-sub"> · {a.interpretation}</span> : null}
                  </td>
                  <td>{a.answeredCount}/{a.questionCount}</td>
                  <td>
                    {a.enteredByName || '—'}
                    {signed && a.signedByName && <div className="omrs-cell-sub">signed by {a.signedByName}</div>}
                  </td>
                  <td>{formatDateTime(a.createdAt)}</td>
                  <td>
                    {!signed && isProvider && (
                      <button className="btn btn-xs btn-primary" disabled={busy} onClick={() => run(() => doSign(a._id))}>
                        <Lock className="w-3 h-3" /> Review &amp; sign
                      </button>
                    )}
                  </td>
                  <td>
                    <span className={signed ? 'omrs-panel-badge omrs-panel-badge--done' : 'omrs-panel-badge omrs-panel-badge--pending'}>
                      {signed ? 'Signed' : 'Held'}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {error && <p className="mt-2 text-[11px]" style={{ color: 'var(--color-danger-text)' }}>{error}</p>}
    </ChartSection>
  );
}
