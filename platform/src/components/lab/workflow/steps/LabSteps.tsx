'use client';

/**
 * The six bench steps. Each renders the same way: what was captured (once the
 * order has moved past it) or the form plus its one action (when the order is
 * sitting on it). They share a file because each is small and they are only
 * ever rendered by LabWorkflowPanel.
 */

import { AlertTriangle, CheckCircle2, Printer } from '@/components/icons/lucide';
import { formatDateTime } from '@/lib/format-utils';
import { useTranslation } from '@/lib/i18n/useTranslation';
import type { LabResultDoc } from '@/lib/db-types';
import { containersFor, SPECIMEN_REJECTION_REASONS } from '../lab-workflow-types';
import type { LabWorkflowController } from '../useLabWorkflow';
import Select from '@/components/Select';
import { printElementById } from '@/lib/safe-html';

const SPECIMEN_CONDITIONS: { value: NonNullable<LabResultDoc['specimenCondition']>; label: string }[] = [
  { value: 'acceptable', label: 'Acceptable' },
  { value: 'hemolyzed', label: 'Hemolyzed' },
  { value: 'clotted', label: 'Clotted' },
  { value: 'insufficient_quantity', label: 'Insufficient quantity' },
  { value: 'wrong_container', label: 'Wrong container' },
  { value: 'unlabeled', label: 'Unlabeled' },
  { value: 'leaking', label: 'Leaking' },
  { value: 'delayed_transport', label: 'Delayed transport' },
  { value: 'other', label: 'Other' },
];

export function Field({ label, value }: { label: string; value?: React.ReactNode }) {
  return (
    <div>
      <span className="labord-field-label">{label}</span>
      <span className="labord-field-value">{value || '—'}</span>
    </div>
  );
}

/**
 * What the order entry asked for that changes how the specimen must be taken.
 * Only renders when there is something to say — a routine draw-now, non-fasting
 * order shows nothing rather than a row of "not stated".
 */
function CollectPreconditions({ order }: { order: LabResultDoc }) {
  const { t } = useTranslation();
  const notes: { key: string; text: string; strong?: boolean }[] = [];

  if (order.fasting === 'yes') notes.push({ key: 'fasting', text: t('labFlow.precondFasting'), strong: true });
  else if (order.fasting === 'no') notes.push({ key: 'fasting', text: t('labFlow.precondNotFasting') });

  if (order.collectionTiming === 'future' && order.scheduledCollectionAt) {
    notes.push({ key: 'scheduled', text: t('labFlow.precondScheduled', { at: formatDateTime(order.scheduledCollectionAt) }) });
  } else if (order.collectionTiming === 'lab_collect') {
    notes.push({ key: 'labcollect', text: t('labFlow.precondLabCollect') });
  }

  if (order.processing === 'send_out') {
    notes.push({ key: 'sendout', text: t('labFlow.precondSendOut'), strong: true });
  }

  if (!notes.length) return null;

  return (
    <div className="labord-chip-row" style={{ marginBottom: 12 }}>
      {notes.map(note => (
        <span
          key={note.key}
          className="labord-chip"
          style={note.strong ? { borderColor: 'var(--color-warning, #CC6600)', color: 'var(--color-warning, #CC6600)' } : undefined}
        >
          {note.text}
        </span>
      ))}
    </div>
  );
}

/** Step 1 — the requisition as it arrived. Read-only by definition. */
export function OrderStep({ order }: { order: LabResultDoc }) {
  const { t } = useTranslation();
  return (
    <div>
      <div className="labord-section">
        <div className="labord-section-head">{t('labFlow.requisition')}</div>
        <div className="labord-section-body">
          <div className="labord-grid-2">
            <Field label={t('labFlow.test')} value={order.testName} />
            <Field label={t('labFlow.specimen')} value={order.specimen} />
            <Field label={t('labOrder.orderingProvider')} value={order.orderedBy} />
            <Field label={t('labFlow.orderedAt')} value={order.orderedAt} />
            <Field
              label={t('labOrder.priority')}
              value={order.priority === 'stat' ? t('lab.priorityStat') : order.priority === 'urgent' ? t('appointments.priorityUrgent') : t('appointments.priorityRoutine')}
            />
            <Field
              label={t('labOrder.processing')}
              value={order.processing === 'send_out' ? t('labOrder.processingSendOut') : t('labOrder.processingInHouse')}
            />
            <Field
              label={t('labOrder.fastingState')}
              value={order.fasting === 'yes' ? t('labOrder.fastingYes') : order.fasting === 'no' ? t('labOrder.fastingNo') : t('labOrder.fastingUnknown')}
            />
            <Field label={t('labFlow.accession')} value={order.accessionNumber} />
          </div>
        </div>
      </div>

      {(order.indications?.length || order.clinicalNotes) && (
        <div className="labord-section">
          <div className="labord-section-head">{t('labFlow.clinicalContext')}</div>
          <div className="labord-section-body">
            {order.indications?.length ? (
              <div className="labord-chip-row" style={{ marginBottom: order.clinicalNotes ? 10 : 0 }}>
                {order.indications.map(indication => (
                  <span key={indication.code} className="labord-chip"><code>{indication.code}</code> {indication.title}</span>
                ))}
              </div>
            ) : null}
            {order.clinicalNotes && <p className="labord-help" style={{ margin: 0 }}>{order.clinicalNotes}</p>}
          </div>
        </div>
      )}

      {order.aoeAnswers?.length ? (
        <div className="labord-section">
          <div className="labord-section-head">{t('labOrder.aoeHeading')}</div>
          <div className="labord-section-body" style={{ padding: 0 }}>
            {order.aoeAnswers.map(entry => (
              <div key={entry.question} className="labord-row">
                <span className="labord-pick-meta">{entry.question}</span>
                <span className="labord-field-value">{entry.answer}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Step 2 — draw the specimen. */
export function CollectStep({ order, ctrl }: { order: LabResultDoc; ctrl: LabWorkflowController }) {
  const { t } = useTranslation();
  const done = ctrl.doneThrough >= 1;
  const rejected = ctrl.stage === 'rejected_needs_recollection';

  return (
    <div>
      {rejected && (
        <div className="labord-section">
          <div className="labord-section-head" style={{ color: 'var(--color-danger, #D92B20)' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <AlertTriangle className="w-4 h-4" aria-hidden /> {t('labFlow.rejectedHeading')}
            </span>
          </div>
          <div className="labord-section-body">
            <div className="labord-grid-2">
              <Field label={t('labFlow.rejectionReason')} value={order.specimenRejectionReason} />
              <Field label={t('labFlow.rejectedBy')} value={order.specimenRejectedBy} />
              <Field label={t('labFlow.rejectedAt')} value={order.specimenRejectedAt ? formatDateTime(order.specimenRejectedAt) : undefined} />
              <Field label={t('labFlow.rejectionNotes')} value={order.specimenRejectionNotes} />
            </div>
          </div>
        </div>
      )}

      <div className="labord-section">
        <div className="labord-section-head">{t('labFlow.collectHeading')}</div>
        <div className="labord-section-body">
          {done && !rejected ? (
            <div className="labord-grid-2">
              <Field label={t('labFlow.collectedBy')} value={order.specimenCollectedBy} />
              <Field label={t('labFlow.collectedAt')} value={order.specimenCollectedAt ? formatDateTime(order.specimenCollectedAt) : undefined} />
              <Field label={t('labFlow.container')} value={order.specimenContainer} />
              <Field label={t('labFlow.accession')} value={order.accessionNumber} />
            </div>
          ) : (
            <>
              <p className="labord-help" style={{ marginTop: 0 }}>
                {t('labFlow.collectHelp', { specimen: order.specimen })}
              </p>

              {/* Preconditions the order carried but the person holding the
                  needle never saw. Fasting was captured at order entry and
                  printed on the requisition, then dropped — so a non-fasting
                  draw on a fasting glucose was only caught after the run. */}
              <CollectPreconditions order={order} />

              <div className="labord-grid-2">
                <div>
                  <label htmlFor="labflow-container">{t('labFlow.container')}</label>
                  <Select
                    id="labflow-container"
                    value={ctrl.collectDraft.container}
                    onChange={e => ctrl.setCollectDraft({ ...ctrl.collectDraft, container: e.target.value })}
                  >
                    <option value="">—</option>
                    {containersFor(order.specimen).map(container => (
                      <option key={container} value={container}>{container}</option>
                    ))}
                  </Select>
                </div>
                <div>
                  <label htmlFor="labflow-collected-by">{t('labFlow.collectedBy')}</label>
                  <input
                    id="labflow-collected-by"
                    type="text"
                    value={ctrl.collectDraft.collectedBy}
                    onChange={e => ctrl.setCollectDraft({ ...ctrl.collectDraft, collectedBy: e.target.value })}
                  />
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** Step 3 — book the specimen in, or send it back. */
export function ReceiveStep({ order, ctrl }: { order: LabResultDoc; ctrl: LabWorkflowController }) {
  const { t } = useTranslation();
  const done = ctrl.doneThrough >= 2;

  return (
    <div>
      <div className="labord-section">
        <div className="labord-section-head">{t('labFlow.receiveHeading')}</div>
        <div className="labord-section-body">
          {done ? (
            <div className="labord-grid-2">
              <Field label={t('labFlow.accession')} value={order.accessionNumber} />
              <Field
                label={t('labFlow.condition')}
                value={SPECIMEN_CONDITIONS.find(c => c.value === order.specimenCondition)?.label}
              />
              <Field label={t('labFlow.receivedBy')} value={order.specimenReceivedBy} />
              <Field label={t('labFlow.receivedAt')} value={order.specimenReceivedAt ? formatDateTime(order.specimenReceivedAt) : undefined} />
            </div>
          ) : (
            <div className="labord-grid-2">
              <div>
                <label htmlFor="labflow-accession">{t('labFlow.accession')}</label>
                <input
                  id="labflow-accession"
                  type="text"
                  value={ctrl.receiveDraft.accessionNumber}
                  onChange={e => ctrl.setReceiveDraft({ ...ctrl.receiveDraft, accessionNumber: e.target.value })}
                />
                <p className="labord-help">{t('labFlow.accessionHelp')}</p>
              </div>
              <div>
                <label htmlFor="labflow-condition">{t('labFlow.condition')}</label>
                <Select
                  id="labflow-condition"
                  value={ctrl.receiveDraft.condition}
                  onChange={e => ctrl.setReceiveDraft({ ...ctrl.receiveDraft, condition: e.target.value as NonNullable<LabResultDoc['specimenCondition']> })}
                >
                  {SPECIMEN_CONDITIONS.map(condition => (
                    <option key={condition.value} value={condition.value}>{condition.label}</option>
                  ))}
                </Select>
              </div>
            </div>
          )}
        </div>
      </div>

      {!done && (
        <div className="labord-section">
          <div className="labord-section-head">{t('labFlow.rejectHeading')}</div>
          <div className="labord-section-body">
            <p className="labord-help" style={{ marginTop: 0 }}>{t('labFlow.rejectHelp')}</p>
            <div className="labord-grid-2">
              <div>
                <label htmlFor="labflow-reject-reason">{t('labFlow.rejectionReason')}</label>
                <Select
                  id="labflow-reject-reason"
                  value={ctrl.receiveDraft.rejectionReason}
                  onChange={e => ctrl.setReceiveDraft({ ...ctrl.receiveDraft, rejectionReason: e.target.value })}
                >
                  <option value="">—</option>
                  {SPECIMEN_REJECTION_REASONS.map(reason => <option key={reason} value={reason}>{reason}</option>)}
                </Select>
              </div>
              <div>
                <label htmlFor="labflow-reject-notes">{t('labFlow.rejectionNotes')}</label>
                <input
                  id="labflow-reject-notes"
                  type="text"
                  value={ctrl.receiveDraft.rejectionNotes}
                  onChange={e => ctrl.setReceiveDraft({ ...ctrl.receiveDraft, rejectionNotes: e.target.value })}
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Step 4 — on the bench. */
export function ProcessStep({ order, ctrl }: { order: LabResultDoc; ctrl: LabWorkflowController }) {
  const { t } = useTranslation();
  const done = ctrl.doneThrough >= 3;

  return (
    <div className="labord-section">
      <div className="labord-section-head">{t('labFlow.processHeading')}</div>
      <div className="labord-section-body">
        <p className="labord-help" style={{ marginTop: 0 }}>
          {done ? t('labFlow.processDone') : t('labFlow.processHelp')}
        </p>
        <div className="labord-grid-2">
          <Field label={t('labFlow.test')} value={order.testName} />
          <Field label={t('labFlow.specimen')} value={`${order.specimen}${order.specimenContainer ? ` · ${order.specimenContainer}` : ''}`} />
          <Field label={t('labFlow.accession')} value={order.accessionNumber} />
          <Field label={t('labFlow.receivedAt')} value={order.specimenReceivedAt ? formatDateTime(order.specimenReceivedAt) : undefined} />
        </div>
      </div>
    </div>
  );
}

/** Step 5 — the value, with the QC check attached to it. */
export function ResultStep({ order, ctrl }: { order: LabResultDoc; ctrl: LabWorkflowController }) {
  const { t } = useTranslation();
  const filed = ctrl.doneThrough >= 4;
  const draft = ctrl.resultDraft;

  return (
    <div>
      <div className="labord-section">
        <div className="labord-section-head">
          <span>{t('labFlow.resultHeading')}</span>
          {filed && (
            <span className="labord-pick-meta" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--color-success, #0E9463)' }}>
              <CheckCircle2 className="w-3.5 h-3.5" aria-hidden /> {t('labFlow.filed')}
            </span>
          )}
        </div>
        <div className="labord-section-body">
          <div className="labord-grid-2">
            <div>
              <label htmlFor="labflow-value">{t('labFlow.value')}</label>
              <input
                id="labflow-value"
                type="text"
                value={draft.result}
                onChange={e => ctrl.setResultValue(e.target.value)}
                placeholder={t('lab.enterValue')}
                autoFocus={!filed}
              />
            </div>
            <div>
              <label htmlFor="labflow-unit">{t('lab.unit')}</label>
              <input
                id="labflow-unit"
                type="text"
                value={draft.unit}
                onChange={e => ctrl.setResultDraft({ ...draft, unit: e.target.value })}
                placeholder={t('lab.unitExamplePlaceholder')}
              />
            </div>
            <div>
              <label htmlFor="labflow-range">{t('lab.referenceRange')}</label>
              <input
                id="labflow-range"
                type="text"
                value={draft.referenceRange}
                onChange={e => ctrl.setResultDraft({ ...draft, referenceRange: e.target.value })}
              />
            </div>
            <div>
              <span className="labord-field-label">{t('labFlow.flags')}</span>
              <div style={{ display: 'flex', gap: 16, paddingTop: 4 }}>
                <label className="labord-check" style={{ width: 'auto', padding: 0 }}>
                  <input
                    type="checkbox"
                    checked={draft.abnormal}
                    onChange={e => ctrl.setResultDraft({ ...draft, abnormal: e.target.checked, critical: e.target.checked ? draft.critical : false })}
                  />
                  <span>{t('lab.abnormal')}</span>
                </label>
                <label className="labord-check" style={{ width: 'auto', padding: 0 }}>
                  <input
                    type="checkbox"
                    checked={draft.critical}
                    onChange={e => ctrl.setResultDraft({ ...draft, critical: e.target.checked, criticalManual: true, abnormal: e.target.checked ? true : draft.abnormal })}
                  />
                  <span>{t('lab.criticalLabel')}</span>
                </label>
              </div>
            </div>
          </div>

          {ctrl.criticalVerdict.isCriticalValue && (
            <p className="labord-help" style={{ color: 'var(--color-danger, #D92B20)', fontWeight: 600 }}>
              <AlertTriangle className="w-3.5 h-3.5" aria-hidden style={{ display: 'inline', marginInlineEnd: 6 }} />
              {t('lab.flagCriticalMsg')}
            </p>
          )}
          {draft.critical && (
            <p className="labord-help">{t('labFlow.criticalNotice')}</p>
          )}
        </div>
      </div>

      {/* Once a value has been reported, changing it is an amendment and needs
          a reason on the record — a clinician may already have acted on what it
          said before. */}
      {filed && (
        <div className="labord-section">
          <div className="labord-section-head">{t('labFlow.amendHeading')}</div>
          <div className="labord-section-body">
            {order.amended && (
              <p className="labord-help" style={{ marginTop: 0, color: 'var(--color-warning, #CC6600)', fontWeight: 600 }}>
                {t('labFlow.amendedNotice', {
                  from: order.amendedFrom || '—',
                  by: order.amendedBy || '—',
                  reason: order.amendmentReason || '—',
                })}
              </p>
            )}
            <label htmlFor="labflow-amend-reason">{t('labFlow.amendReason')}</label>
            <textarea
              id="labflow-amend-reason"
              rows={2}
              value={ctrl.amendReason}
              onChange={e => ctrl.setAmendReason(e.target.value)}
              placeholder={t('labFlow.amendReasonPlaceholder')}
            />
            <p className="labord-help">{t('labFlow.amendHelp')}</p>
          </div>
        </div>
      )}
    </div>
  );
}

/** Step 6 — the report that goes back to the clinician. */
export function ReportStep({ order, ctrl }: { order: LabResultDoc; ctrl: LabWorkflowController }) {
  const { t } = useTranslation();

  return (
    <div>
      <div className="labord-section">
        <div className="labord-section-head">
          <span>{t('labFlow.reportHeading')}</span>
          <button type="button" className="labord-btn" style={{ padding: '4px 10px' }} onClick={() => printElementById('lab-result-print')}>
            <Printer className="w-3.5 h-3.5" aria-hidden /> {t('labFlow.printReport')}
          </button>
        </div>
        <div id="lab-result-print" className="labord-section-body labord-print">
          <div className="labord-print-only labord-req-head">
            <div>
              <div className="labord-req-facility">{order.hospitalName || 'TamamHealth Health Facility'}</div>
              <div className="labord-req-meta">Final diagnostic result report</div>
            </div>
            <div className="labord-req-meta" style={{ textAlign: 'end' }}>
              Patient: {order.patientName}<br />
              Hospital number: {order.hospitalNumber || '—'}<br />
              Specimen: {order.specimen || '—'}
            </div>
          </div>
          {order.amended && (
            <div className="labord-print-only" style={{ border: '1px solid var(--color-warning-border)', padding: 8, marginBottom: 10 }}>
              <strong>AMENDED RESULT</strong> — Previous value: {order.amendedFrom || '—'} · Reason: {order.amendmentReason || '—'} · Amended by: {order.amendedBy || '—'}
            </div>
          )}
          <div className="labord-grid-2">
            <Field label={t('labFlow.test')} value={order.testName} />
            <Field label={t('labFlow.accession')} value={order.accessionNumber} />
            <Field
              label={t('labFlow.value')}
              value={
                <span style={{ color: order.critical ? 'var(--color-danger, #D92B20)' : order.abnormal ? 'var(--color-warning, #CC6600)' : undefined }}>
                  {order.result || '—'} {order.unit}
                </span>
              }
            />
            <Field label={t('lab.referenceRange')} value={order.referenceRange} />
            <Field label={t('labFlow.reportedAt')} value={order.completedAt} />
            <Field label={t('lab.specimen')} value={order.specimen || '—'} />
            <Field label="Ordered by" value={order.orderedBy || '—'} />
            <Field
              label={t('labFlow.interpretation')}
              value={order.critical ? t('lab.critical') : order.abnormal ? t('lab.abnormal') : t('labFlow.withinRange')}
            />
          </div>
        </div>
      </div>

      <div className="labord-section">
        <div className="labord-section-head">{t('labFlow.handoffHeading')}</div>
        <div className="labord-section-body">
          <p className="labord-help" style={{ marginTop: 0 }}>{t('labFlow.handoffHelp')}</p>
          <div className="labord-grid-2">
            <Field label={t('labOrder.orderingProvider')} value={order.orderedBy} />
            <Field
              label={t('labFlow.reviewStatus')}
              value={ctrl.stage === 'resulted' ? t('labFlow.awaitingReview') : t(`labFlow.stage_${ctrl.stage}`)}
            />
          </div>
          <button type="button" className="labord-btn" style={{ marginTop: 12 }} onClick={ctrl.notifyClinician} disabled={ctrl.busy}>
            {t('labFlow.notifyClinician')}
          </button>
        </div>
      </div>

      {/* Closing the loop. These three stages existed in the lifecycle and in
          the queue's status labels but had no way to be entered, so every
          reported result stayed "awaiting review" and kept escalating against
          its SLA. One step at a time — the transition guard rejects skips. */}
      <div className="labord-section">
        <div className="labord-section-head">{t('labFlow.closeoutHeading')}</div>
        <div className="labord-section-body">
          <p className="labord-help" style={{ marginTop: 0 }}>{t('labFlow.closeoutHelp')}</p>
          <div className="labord-numbered">
            <CloseoutRow
              index={1}
              label={t('labFlow.stage_reviewed_by_clinician')}
              by={order.reviewedBy}
              at={order.reviewedAt}
              actionLabel={t('labFlow.markReviewed')}
              onAction={ctrl.markReviewed}
              enabled={ctrl.stage === 'resulted'}
              busy={ctrl.busy}
            />
            <CloseoutRow
              index={2}
              label={t('labFlow.stage_acted_upon')}
              by={order.actedUponBy}
              at={order.actedUponAt}
              actionLabel={t('labFlow.markActedUpon')}
              onAction={ctrl.markActedUpon}
              enabled={ctrl.stage === 'reviewed_by_clinician'}
              busy={ctrl.busy}
            />
            <CloseoutRow
              index={3}
              label={t('labFlow.stage_communicated_to_patient')}
              by={order.communicatedBy}
              at={order.communicatedAt}
              actionLabel={t('labFlow.markCommunicated')}
              onAction={ctrl.markCommunicated}
              enabled={ctrl.stage === 'acted_upon'}
              busy={ctrl.busy}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

/** One rung of the close-out ladder: done (who/when) or the button to do it. */
function CloseoutRow({
  index, label, by, at, actionLabel, onAction, enabled, busy,
}: {
  index: number;
  label: string;
  by?: string;
  at?: string;
  actionLabel: string;
  onAction: () => void;
  enabled: boolean;
  busy: boolean;
}) {
  const done = !!at;
  return (
    <div className="labord-numbered-row">
      <span className="labord-num">{index}</span>
      <span className="labord-numbered-body">
        <strong>{label}</strong>
        {done && (
          <span className="labord-check-meta">
            {by || '—'} · {new Date(at!).toLocaleString()}
          </span>
        )}
      </span>
      {done ? (
        <CheckCircle2 className="w-4 h-4" aria-hidden style={{ color: 'var(--color-success, #0E9463)' }} />
      ) : (
        <button
          type="button"
          className="labord-btn labord-btn--sm"
          onClick={onAction}
          disabled={!enabled || busy}
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}
