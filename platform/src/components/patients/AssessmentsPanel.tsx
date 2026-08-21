'use client';

import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/lib/context';
import type { PatientDoc } from '@/lib/db-types';
import { useAssessments } from '@/lib/hooks/useAssessments';
import { ASSESSMENT_INSTRUMENTS, getInstrument, scoreAssessment } from '@/lib/clinical/assessment-instruments';
import { isClinicalAuthorRole } from '@/lib/clinical-roles';
import { ClipboardList, Plus, Lock } from '@/components/icons/lucide';
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
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-sm inline-flex items-center gap-2">
          <ClipboardList className="w-4 h-4" style={{ color: 'var(--accent-primary)' }} /> Outcome measures
        </h3>
        {!adding && (
          <button className="btn btn-sm btn-secondary" onClick={() => { setAdding(true); setAnswers({}); }}>
            <Plus className="w-3.5 h-3.5" /> New assessment
          </button>
        )}
      </div>

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
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>No assessments recorded.</p>
      )}

      <ul className="space-y-2">
        {assessments.map((a) => {
          const signed = a.documentStatus === 'signed';
          return (
            <li
              key={a._id}
              id={`assessment-${a._id}`}
              className="rounded-lg p-3"
              style={a._id === focusId
                ? { background: 'var(--accent-light)', border: '1px solid var(--accent-primary)', boxShadow: 'inset 3px 0 0 var(--accent-primary)' }
                : { background: 'var(--overlay-subtle)', border: '1px solid var(--border-light)' }}
            >
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>{a.instrumentName}</span>
                <span className="text-[12px] font-bold" style={{ color: a.severity ? SEVERITY_COLOR[a.severity] : 'var(--text-secondary)' }}>
                  {a.totalScore}{a.interpretation ? ` · ${a.interpretation}` : ''}
                </span>
                <span className="flex-1" />
                {signed ? (
                  <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ background: 'rgba(10, 110, 74,0.12)', color: 'var(--color-success-text)' }}>
                    <Lock className="w-3 h-3" /> Signed
                  </span>
                ) : (
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ background: 'rgba(230, 114, 0,0.12)', color: 'var(--color-warning-text)' }}>Held</span>
                )}
              </div>
              <p className="text-[10px] mt-1" style={{ color: 'var(--text-muted)' }}>
                {a.answeredCount}/{a.questionCount} answered · {a.enteredByName ? `entered by ${a.enteredByName}` : 'entered'} · {formatDateTime(a.createdAt)}
                {signed && a.signedByName ? ` · signed by ${a.signedByName}` : ''}
              </p>
              {!signed && isProvider && (
                <div className="mt-2">
                  <button className="btn btn-xs btn-primary" disabled={busy} onClick={() => run(() => doSign(a._id))}>
                    <Lock className="w-3 h-3" /> Review &amp; sign
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {error && <p className="mt-2 text-[11px]" style={{ color: 'var(--color-danger-text)' }}>{error}</p>}
    </div>
  );
}
