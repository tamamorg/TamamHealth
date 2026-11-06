'use client';

/**
 * The nurse's review after the doctor, shown under the patient's notes.
 *
 * Replaces the "Post-consultation nursing" block that sat in the Care plan
 * tab (2026-11-06, the user: delete it; keep only the reviews the nurse does
 * after the doctor, under the notes). What the nurse sees is the four review
 * items and a one-line record of what was done. Owner lines, links, transfer,
 * defer and history are gone from the screen; the handoff record and its
 * checkout gate (postConsultReady) are unchanged, so the first review takes
 * ownership automatically, exactly as "Accept handoff" did.
 */
import { useEffect, useState } from 'react';
import type { EncounterDoc } from '@/lib/db-types';
import { useDataScope } from '@/lib/hooks/useDataScope';
import { useUsers } from '@/lib/hooks/useUsers';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { CLINICIANS, NURSING_AND_CLINICIANS } from '@/lib/sync/write-permissions';
import { isTerminal } from '@/lib/clinical-flow/encounter-journey';
import { FormError } from '@/components/overlay/FormNotices';
import { getHandoffQueue, updateHandoff, type HandoffAction } from '../services/handoff-service';
import { currentPlanRevision } from '../services/plan-service';
import type { PostConsultTask } from '../types';
import './post-consult.css';

export default function NurseReviewPanel({ patientId }: { patientId: string }) {
  const scope = useDataScope();
  const { t } = useTranslation();
  const [visit, setVisit] = useState<EncounterDoc | null>(null);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState(false);
  const [planChanged, setPlanChanged] = useState(false);

  useEffect(() => {
    if (!scope) return;
    let cancelled = false;
    async function refresh() {
      try {
        const queue = await getHandoffQueue(scope!);
        // The patient's latest open review; earlier visits are history.
        const mine = queue
          .filter(d => d.patientId === patientId && d.postConsult)
          .sort((a, b) => (b.postConsult!.createdAt).localeCompare(a.postConsult!.createdAt))[0] ?? null;
        if (cancelled) return;
        setVisit(mine);
        setError(false);
        if (mine && !isTerminal(mine.status)) {
          const h = mine.postConsult!;
          const plan = await currentPlanRevision(mine, scope!);
          if (!cancelled) setPlanChanged(!!(h.reviewedPlan || h.bypass || h.tasks.some(task => task.status !== 'pending')) && h.reviewedPlan !== plan);
        } else if (!cancelled) setPlanChanged(false);
      } catch {
        if (!cancelled) setError(true);
      }
    }
    void refresh();
    const timer = setInterval(() => void refresh(), 15000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [scope, patientId, revision]);

  if (!visit?.postConsult) return error ? <FormError message={t('postConsult.error')} /> : null;
  const h = visit.postConsult;
  const me = scope?.userId;
  const canWork = !!scope && NURSING_AND_CLINICIANS.includes(scope.role);
  const isClinician = !!scope && CLINICIANS.includes(scope.role);
  // Another nurse already took this review: theirs to record.
  const ownedByOther = !!h.ownerId && h.ownerId !== me;

  async function run(actions: HandoffAction[]) {
    if (!scope || !visit?._rev) return;
    setError(false);
    try {
      let rev = visit._rev;
      for (const action of actions) rev = (await updateHandoff(visit._id, rev, action, scope))._rev!;
      setRevision(r => r + 1);
    } catch {
      setError(true);
    }
  }
  // The first review takes ownership (accept), then records the item.
  const review = (task: PostConsultTask, note: string) => run([
    ...(!h.ownerId || (h.ownerId === me && !h.acceptedAt) ? [{ type: 'accept' } as HandoffAction] : []),
    { type: 'task', kind: task.kind, status: 'done', note } as HandoffAction,
  ]);

  return (
    <section id="nurse-review" className="ehr-nurse-review" aria-label={t('postConsult.title')}>
      <h3 className="ehr-nurse-review-title">{t('postConsult.title')}</h3>
      {h.bypass ? (
        <p className="ehr-nurse-review-muted">{t('postConsult.bypassed')}: {h.bypass.reason}</p>
      ) : (
        <>
          {planChanged && (
            <div className="ehr-nurse-review-changed" role="status">
              <span>{t('postConsult.changed')}</span>
              {canWork && (!ownedByOther || isClinician) && (
                <button type="button" className="tm-ghost-btn" onClick={() => void run([{ type: 'reopen', reason: t('postConsult.changed') }])}>
                  {t('postConsult.reopen')}
                </button>
              )}
            </div>
          )}
          {ownedByOther && <OwnerLine ownerId={h.ownerId!} />}
          <ul className="ehr-nurse-review-list">
            {h.tasks.map(task => (
              <ReviewItem
                key={`${h.createdAt}-${task.kind}`}
                task={task}
                editable={canWork && !planChanged && !ownedByOther && task.status === 'pending'}
                onReview={note => review(task, note)}
              />
            ))}
          </ul>
          {isClinician && h.tasks.every(task => task.status === 'pending') && <NotNeeded onConfirm={reason => run([{ type: 'bypass', reason }])} />}
        </>
      )}
      {error && <FormError message={t('postConsult.error')} />}
    </section>
  );
}

function OwnerLine({ ownerId }: { ownerId: string }) {
  const { t } = useTranslation();
  const { users } = useUsers();
  const name = users.find(u => u._id === ownerId)?.name || t('postConsult.unclaimed');
  return <p className="ehr-nurse-review-muted">{t('postConsult.owner')}: {name}</p>;
}

function ReviewItem({ task, editable, onReview }: { task: PostConsultTask; editable: boolean; onReview: (note: string) => Promise<void> }) {
  const { t } = useTranslation();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const statusClass = task.status === 'done' ? 'is-done' : task.status === 'deferred' ? 'is-deferred' : 'is-pending';
  return (
    <li className="ehr-nurse-review-item">
      <div className="ehr-nurse-review-row">
        <span className="ehr-nurse-review-label">{t(`postConsult.task.${task.kind}`)}</span>
        <span className={`ehr-nurse-review-status ${statusClass}`}>{t(`postConsult.status.${task.status}`)}</span>
      </div>
      {task.note && <p className="ehr-nurse-review-muted">{task.note}</p>}
      {editable && (
        <div className="ehr-nurse-review-entry">
          <input
            type="text"
            value={note}
            maxLength={2000}
            placeholder={t('postConsult.evidence')}
            aria-label={`${t(`postConsult.task.${task.kind}`)}: ${t('postConsult.evidence')}`}
            onChange={e => setNote(e.target.value)}
            disabled={busy}
          />
          <button
            type="button"
            className="tm-ghost-btn"
            disabled={busy || !note.trim()}
            onClick={() => { setBusy(true); void onReview(note.trim()).finally(() => setBusy(false)); }}
          >
            {t('postConsult.markReviewed')}
          </button>
        </div>
      )}
    </li>
  );
}

function NotNeeded({ onConfirm }: { onConfirm: (reason: string) => Promise<void> }) {
  const { t } = useTranslation();
  const [reason, setReason] = useState('');
  return (
    <details className="ehr-nurse-review-notneeded">
      <summary>{t('postConsult.noTasks')}</summary>
      <div className="ehr-nurse-review-entry">
        <input type="text" value={reason} maxLength={2000} placeholder={t('postConsult.reason')} aria-label={t('postConsult.reason')} onChange={e => setReason(e.target.value)} />
        <button type="button" className="tm-ghost-btn" disabled={!reason.trim()} onClick={() => void onConfirm(reason.trim())}>{t('postConsult.confirm')}</button>
      </div>
    </details>
  );
}
