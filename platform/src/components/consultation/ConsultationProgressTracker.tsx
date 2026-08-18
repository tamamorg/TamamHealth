'use client';

/**
 * ConsultationProgressTracker — a read-only view of what has actually been
 * recorded for this visit, and by whom.
 *
 * Why it looks like this (the previous version got all three wrong):
 *
 *  - **No numbered stepper.** A progress indicator should not double as
 *    navigation, and should not be used when the number of steps can change
 *    (NSW Design System). The old one was clickable — each node wrote a new
 *    stage — and rendered "Cancelled" as step 8 of 8, which implies a patient
 *    advances toward being cancelled. Non-linear outcomes (LWBS, escalated,
 *    admitted, referred out, deceased) are now a callout, not a step.
 *
 *  - **No inputs.** Every row is derived from a real document, so a tick means
 *    "a record proves this happened", not "somebody remembered to click it".
 *    See `consultation-progress-derive.ts`.
 *
 *  - **Attribution over decoration.** The useful content on a shared care-team
 *    tracker is who did what and when, so that is what each row carries. The
 *    old layout spent its space on a 0% bar, a gradient panel, and four tiles
 *    that restated the same word ("New") three times.
 *
 * Completed rows use plain dark text and outstanding rows carry the tinted
 * marker, following the GOV.UK task list convention: draw the eye to what
 * still needs action rather than lighting up what is already finished.
 */

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, Clock } from '@/components/icons/lucide';
import type { PatientDoc, EncounterDoc } from '@/lib/db-types';
import { getOpenEncounterForPatient, getEncounter } from '@/lib/services/encounter-service';
import { useTriage } from '@/lib/hooks/useTriage';
import { useMedicalRecords } from '@/lib/hooks/useMedicalRecords';
import { usePrescriptions } from '@/lib/hooks/usePrescriptions';
import { useLabResults } from '@/lib/hooks/useLabResults';
import { useAppointments } from '@/lib/hooks/useAppointments';
// Local calendar day, matching how every other client surface computes "today".
import { toIsoDate } from '@/components/ehr/EhrMiniCalendar';
import { deriveConsultationProgress, type DerivedStep } from '@/lib/clinical-flow/consultation-progress-derive';

/** "2:41 PM" for today, "Jul 26, 2:41 PM" otherwise — the year is noise here. */
function stamp(iso?: string, dayKey?: string): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const time = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (dayKey && iso.slice(0, 10) === dayKey) return time;
  return `${date.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${time}`;
}

function StepRow({ step, dayKey }: { step: DerivedStep; dayKey: string }) {
  const done = step.state === 'done';
  const when = stamp(step.at, dayKey);
  // Only claim attribution the record actually carries. An em dash beats a
  // filler word like "Recorded", which reads as a person's name in a column
  // headed by people's names.
  const by = done ? step.actor : undefined;

  return (
    <li className="flex items-start gap-3 py-2.5" style={{ borderTop: '1px solid var(--border-light)' }}>
      <span
        aria-hidden="true"
        className="flex items-center justify-center flex-shrink-0"
        style={{
          width: 18, height: 18, marginTop: 1, borderRadius: 999,
          background: done ? 'var(--accent-primary)' : 'transparent',
          border: done ? 'none' : '1.5px dashed var(--border-medium)',
          color: '#fff',
        }}
      >
        {done && <Check className="w-3 h-3" strokeWidth={3} />}
      </span>

      <span className="flex-1 min-w-0">
        <span
          className="block text-[13px]"
          style={{
            color: done ? 'var(--text-primary)' : 'var(--text-muted)',
            fontWeight: done ? 600 : 400,
          }}
        >
          {step.label}
        </span>
        {!done && step.hint && (
          <span className="block text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>{step.hint}</span>
        )}
      </span>

      <span className="text-end flex-shrink-0" style={{ minWidth: 0 }}>
        {done ? (
          <>
            <span
              className="block text-[12px] truncate"
              style={{ color: by ? 'var(--text-secondary)' : 'var(--text-muted)', maxWidth: 180 }}
              title={by ? undefined : 'The record does not name who did this'}
            >
              {by || '—'}
            </span>
            {when && <span className="block text-[11px]" style={{ color: 'var(--text-muted)' }}>{when}</span>}
          </>
        ) : (
          <span className="text-[11px] font-semibold px-2 py-0.5 rounded" style={{ background: 'var(--overlay-subtle)', color: 'var(--text-muted)' }}>
            To do
          </span>
        )}
      </span>
    </li>
  );
}

export default function ConsultationProgressTracker({
  patient,
  encounterId,
  compact = false,
}: {
  patient: PatientDoc;
  encounterId?: string | null;
  /** Retained for call-site compatibility; the layout is already dense. */
  appointmentId?: string;
  compact?: boolean;
}) {
  const [encounter, setEncounter] = useState<EncounterDoc | null>(null);
  const [encounterLoading, setEncounterLoading] = useState(true);

  const { triages } = useTriage();
  const { records } = useMedicalRecords();
  const { prescriptions } = usePrescriptions();
  const { results: labResults } = useLabResults();
  const { appointments } = useAppointments();

  const dayKey = toIsoDate(new Date());

  // Prefer the encounter the caller is working in; otherwise the patient's
  // open one. Nothing is created here — this view never writes.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setEncounterLoading(true);
      try {
        const found = encounterId ? await getEncounter(encounterId) : await getOpenEncounterForPatient(patient._id);
        if (!cancelled) setEncounter(found);
      } catch {
        if (!cancelled) setEncounter(null);
      } finally {
        if (!cancelled) setEncounterLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [encounterId, patient._id]);

  const derived = useMemo(() => deriveConsultationProgress({
    patientId: patient._id,
    encounter,
    appointments,
    triages,
    records,
    prescriptions,
    labResults,
    dayKey,
  }), [patient._id, encounter, appointments, triages, records, prescriptions, labResults, dayKey]);

  if (encounterLoading) {
    return (
      <section className={`card-elevated ${compact ? 'p-3' : 'p-4'} text-[13px]`} style={{ color: 'var(--text-muted)' }}>
        Loading visit progress…
      </section>
    );
  }

  const { steps, doneCount, currentLabel, exception, notStarted } = derived;

  return (
    <section className={`card-elevated ${compact ? 'p-3' : 'p-4'}`} aria-label="Visit progress">
      {/* One summary line, not three. The old header said "Ready to begin",
          "0%" and "0/9 milestones" — three ways of saying nothing happened. */}
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <h2 className="text-[13px] font-bold" style={{ color: 'var(--text-primary)' }}>Visit progress</h2>
        <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
          {notStarted ? 'No visit activity yet' : `${doneCount} of ${steps.length} recorded`}
        </span>
      </div>
      <p className="text-[12px] mt-1" style={{ color: 'var(--text-secondary)' }}>
        {notStarted
          ? 'Steps appear here as the care team records them.'
          : currentLabel
            ? <>Currently <strong style={{ color: 'var(--text-primary)' }}>{currentLabel.toLowerCase()}</strong></>
            : 'No open encounter — showing what has been recorded.'}
      </p>

      {exception && (
        <div
          role="status"
          className="flex items-start gap-2 mt-3 p-2.5 rounded-lg"
          style={{ background: 'rgba(196,69,54,.08)', border: '1px solid rgba(196,69,54,.22)' }}
        >
          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: 'var(--color-danger, #DC2626)' }} />
          <span className="min-w-0">
            <span className="block text-[12px] font-bold" style={{ color: 'var(--color-danger, #DC2626)' }}>{exception.label}</span>
            <span className="block text-[11px] mt-0.5" style={{ color: 'var(--text-secondary)' }}>{exception.detail}</span>
          </span>
        </div>
      )}

      <ul className="mt-3 mb-0" style={{ listStyle: 'none', padding: 0 }}>
        {steps.map(step => <StepRow key={step.key} step={step} dayKey={dayKey} />)}
      </ul>

      <p className="flex items-center gap-1.5 text-[11px] mt-3 pt-2.5" style={{ color: 'var(--text-muted)', borderTop: '1px solid var(--border-light)' }}>
        <Clock className="w-3 h-3 flex-shrink-0" />
        Updated automatically from the visit record — nothing here is entered by hand.
      </p>
    </section>
  );
}
