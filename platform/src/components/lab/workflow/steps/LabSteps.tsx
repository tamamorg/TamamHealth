'use client';

/**
 * The sections of the lab's one form. Each renders the same way: what was
 * captured, or its fields while they are still to fill. They share a file because
 * each is small and they are only ever rendered by LabWorkflowPanel.
 */

import { AlertTriangle, CheckCircle2, Pencil, Printer } from '@/components/icons/lucide';
import { formatDateTime } from '@/lib/format-utils';
import { useToast } from '@/components/Toast';
import { useTranslation } from '@/lib/i18n/useTranslation';
import type { LabResultDoc } from '@/lib/db-types';
import { containersFor, fallbackAccessionNumber, isOutsideRequest, SPECIMEN_REJECTION_REASONS } from '../lab-workflow-types';
import type { LabWorkflowController } from '../useLabWorkflow';
import type { LabOrderStatus } from '@/lib/clinical-flow/order-lifecycles';
import { printElementById } from '@/lib/safe-html';
import O3Form from '@/components/forms/O3Form';
import { ObfQuestion, ObfSelectField, ObfTextField, ObfValue } from '@/components/ehr/chart/panels/order-basket/ObfFields';
import { labProfilePage } from '@/lib/forms/o3-form-definitions';
import { resolveLabResultProfile } from '../lab-result-catalog';
import { getLabReferenceRange } from '@/lib/services/lab-critical-flag';

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
  return <ObfValue label={label} value={value} />;
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

/**
 * What the ordering clinician told the laboratory: why the test was asked for,
 * their notes, the internal comment, and the answers to the order-entry
 * questions. Rendered on the Order step, and again above every bench step —
 * the workflow opens on the step that needs doing (usually Collect), and a
 * fasting answer or "call ext. 204" that sits one step back is one nobody
 * reads while drawing the sample.
 */
export function OrderContext({ order }: { order: LabResultDoc }) {
  const { t } = useTranslation();
  if (!order.indications?.length && !order.clinicalNotes && !order.orderComment && !order.aoeAnswers?.length) return null;
  return (
    <>
    {/* Each line says what it is: the orderer wrote these for the bench, and
        an unlabelled chip row reads as a diagnosis rather than the reason
        the test was asked for. */}
    {(order.indications?.length || order.clinicalNotes || order.orderComment) && (
      <div className="obf-section">
        <div className="obf-section-head lwf-section-head">{t('labFlow.clinicalContext')}</div>
        <div className="lwf-section-body labord-context">
          {order.indications?.length ? (
            <div>
              <span className="labord-field-label">{t('labOrder.reasons')}</span>
              <div className="labord-chip-row">
                {order.indications.map(indication => (
                  <span key={indication.code} className="labord-chip"><code>{indication.code}</code> {indication.title}</span>
                ))}
              </div>
            </div>
          ) : null}
          {order.clinicalNotes && (
            <div>
              <span className="labord-field-label">{t('labOrder.notesToLab')}</span>
              <p className="labord-help" style={{ margin: 0 }}>{order.clinicalNotes}</p>
            </div>
          )}
          {order.orderComment && (
            <div>
              <span className="labord-field-label">{t('labOrder.internalComment')}</span>
              <p className="labord-help" style={{ margin: 0 }}>{order.orderComment}</p>
            </div>
          )}
        </div>
      </div>
    )}

    {order.aoeAnswers?.length ? (
      <div className="obf-section">
        <div className="obf-section-head lwf-section-head">{t('labOrder.aoeHeading')}</div>
        <div className="lwf-section-body" style={{ padding: 0 }}>
          {order.aoeAnswers.map(entry => (
            <div key={entry.question} className="labord-row">
              <span className="labord-pick-meta">{entry.question}</span>
              <span className="labord-field-value">{entry.answer}</span>
            </div>
          ))}
        </div>
      </div>
    ) : null}
    </>
  );
}

/** The requisition as it arrived. Read-only by definition. */
export function OrderStep({ order }: { order: LabResultDoc }) {
  const { t } = useTranslation();
  return (
    <div>
      <div className="obf-section">
        <div className="obf-section-head lwf-section-head">{t('labFlow.requisition')}</div>
        <div className="lwf-section-body">
          <div className="obf-row">
            <Field label={t('labFlow.test')} value={order.testName} />
            <Field label={t('labFlow.specimen')} value={order.specimen} />
            <Field label={t('labOrder.orderingProviderLabel')} value={order.orderedBy} />
            <Field label={t('labFlow.orderedAt')} value={order.orderedAt ? formatDateTime(order.orderedAt) : undefined} />
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
            <Field label={t('labFlow.accession')} value={fallbackAccessionNumber(order)} />
            {order.requestSource && <Field label={t('labIntake.source')} value={t(`labIntake.source_${order.requestSource}`)} />}
            {order.externalFacility && <Field label={t('labIntake.facility')} value={order.externalFacility} />}
            {order.externalReference && <Field label={t('labIntake.reference')} value={order.externalReference} />}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Draw the specimen. */
export function CollectStep({ order, ctrl }: { order: LabResultDoc; ctrl: LabWorkflowController }) {
  const { t } = useTranslation();
  const done = ctrl.doneThrough >= 1;
  const rejected = ctrl.stage === 'rejected_needs_recollection';

  return (
    <div>
      {rejected && (
        <div className="obf-section">
          <div className="obf-section-head lwf-section-head" style={{ color: 'var(--color-danger, #D92B20)' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <AlertTriangle className="w-4 h-4" aria-hidden /> {t('labFlow.rejectedHeading')}
            </span>
          </div>
          <div className="lwf-section-body">
            <div className="obf-row">
              <Field label={t('labFlow.rejectionReason')} value={order.specimenRejectionReason} />
              <Field label={t('labFlow.rejectedBy')} value={order.specimenRejectedBy} />
              <Field label={t('labFlow.rejectedAt')} value={order.specimenRejectedAt ? formatDateTime(order.specimenRejectedAt) : undefined} />
              <Field label={t('labFlow.rejectionNotes')} value={order.specimenRejectionNotes} />
            </div>
          </div>
        </div>
      )}

      <div className="obf-section">
        <div className="obf-section-head lwf-section-head">{t('labFlow.collectHeading')}</div>
        <div className="lwf-section-body">
          {done && !rejected ? (
            <div className="obf-row">
              <Field label={t('labFlow.collectedBy')} value={order.specimenCollectedBy} />
              <Field label={t('labFlow.collectedAt')} value={order.specimenCollectedAt ? formatDateTime(order.specimenCollectedAt) : undefined} />
              <Field label={t('labFlow.container')} value={order.specimenContainer} />
              {order.specimenCollectedOutside && <Field label={t('labFlow.collectedOutside')} value={order.externalFacility || t('labIntake.source_walk_in')} />}
              {order.specimenCollectionNote && <Field label={t('labFlow.collectionNote')} value={order.specimenCollectionNote} />}
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

              <div className="obf-row">
                <Field label={t('labFlow.accession')} value={ctrl.receiveDraft.accessionNumber} />
                <ObfSelectField
                  id="labflow-container"
                  label={t('labFlow.container')}
                  required
                  value={ctrl.collectDraft.container}
                  options={containersFor(order.specimen).map(container => ({ value: container, label: container }))}
                  onChange={container => ctrl.setCollectDraft({ ...ctrl.collectDraft, container })}
                />
                <ObfTextField
                  id="labflow-collected-by"
                  label={t('labFlow.collectedBy')}
                  required
                  value={ctrl.collectDraft.collectedBy}
                  onChange={collectedBy => ctrl.setCollectDraft({ ...ctrl.collectDraft, collectedBy })}
                />
                <ObfQuestion label={t('labFlow.collectedAt')} htmlFor="labflow-collected-at">
                  <input
                    id="labflow-collected-at"
                    type="datetime-local"
                    value={ctrl.collectDraft.collectedAt}
                    onChange={e => ctrl.setCollectDraft({ ...ctrl.collectDraft, collectedAt: e.target.value })}
                  />
                </ObfQuestion>
                <ObfTextField
                  id="labflow-collect-note"
                  label={t('labFlow.collectionNote')}
                  multiline
                  value={ctrl.collectDraft.note}
                  onChange={note => ctrl.setCollectDraft({ ...ctrl.collectDraft, note })}
                />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** Book the specimen in, or (picked from the row) send it back. */
export function ReceiveStep({ order, ctrl, rejecting = false }: { order: LabResultDoc; ctrl: LabWorkflowController; rejecting?: boolean }) {
  const { t } = useTranslation();
  const done = ctrl.doneThrough >= 2;

  return (
    <div>
      {!rejecting && (
      <div className="obf-section">
        <div className="obf-section-head lwf-section-head">{t('labFlow.receiveHeading')}</div>
        <div className="lwf-section-body">
          {done ? (
            <div className="obf-row">
              <Field label={t('labFlow.accession')} value={order.accessionNumber} />
              <Field
                label={t('labFlow.condition')}
                value={SPECIMEN_CONDITIONS.find(c => c.value === order.specimenCondition)?.label}
              />
              <Field label={t('labFlow.receivedBy')} value={order.specimenReceivedBy} />
              <Field label={t('labFlow.receivedAt')} value={order.specimenReceivedAt ? formatDateTime(order.specimenReceivedAt) : undefined} />
            </div>
          ) : (
            <div className="obf-row">
              <ObfTextField
                id="labflow-accession"
                label={t('labFlow.accession')}
                required
                value={ctrl.receiveDraft.accessionNumber}
                onChange={accessionNumber => ctrl.setReceiveDraft({ ...ctrl.receiveDraft, accessionNumber })}
              />
              <ObfSelectField
                id="labflow-condition"
                label={t('labFlow.condition')}
                value={ctrl.receiveDraft.condition}
                placeholder={null}
                options={SPECIMEN_CONDITIONS}
                onChange={condition => ctrl.setReceiveDraft({ ...ctrl.receiveDraft, condition: condition as NonNullable<LabResultDoc['specimenCondition']> })}
              />
              <p className="labord-help">{t('labFlow.accessionHelp')}</p>
            </div>
          )}
        </div>
      </div>
      )}

      {!done && rejecting && (
        <div className="obf-section">
          <div className="obf-section-head lwf-section-head">{t('labFlow.rejectHeading')}</div>
          <div className="lwf-section-body">
            <p className="labord-help" style={{ marginTop: 0 }}>{t('labFlow.rejectHelp')}</p>
            <div className="obf-row">
              <ObfSelectField
                id="labflow-reject-reason"
                label={t('labFlow.rejectionReason')}
                value={ctrl.receiveDraft.rejectionReason}
                options={SPECIMEN_REJECTION_REASONS.map(reason => ({ value: reason, label: reason }))}
                onChange={rejectionReason => ctrl.setReceiveDraft({ ...ctrl.receiveDraft, rejectionReason })}
              />
              <ObfTextField
                id="labflow-reject-notes"
                label={t('labFlow.rejectionNotes')}
                value={ctrl.receiveDraft.rejectionNotes}
                onChange={rejectionNotes => ctrl.setReceiveDraft({ ...ctrl.receiveDraft, rejectionNotes })}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** The value, with the QC check attached to it. */
export function ResultStep({ order, ctrl }: { order: LabResultDoc; ctrl: LabWorkflowController }) {
  const { t } = useTranslation();
  const filed = ctrl.doneThrough >= 4;
  const draft = ctrl.resultDraft;
  const structuredProfile = resolveLabResultProfile(order.testName, order.specimen);
  const qualitative = getLabReferenceRange(order.testName)?.qualitative;

  return (
    <div>
      <div className="obf-section">
        <div className="obf-section-head lwf-section-head">{t('labFlow.resultHeading')}</div>
        <div className="lwf-section-body">
          {structuredProfile ? (
            // The same O3 form the chart's Laboratory Test Results opens, one
            // page per profile; the step's own File action saves it.
            <div className="labord-o3">
              <O3Form
                pages={[labProfilePage(structuredProfile)]}
                values={draft.observations}
                onChange={ctrl.setObservationValue}
              />
            </div>
          ) : (
            <div className="obf-row">
              {qualitative ? (
                // A qualitative test is a choice, not free text: "pos", "+ve"
                // and "P.f seen" all meant Positive and none of them flagged.
                <ObfSelectField
                  id="labflow-value"
                  label={t('labFlow.value')}
                  required
                  value={draft.result}
                  placeholder={t('labFlow.chooseResult')}
                  options={qualitative.map(option => ({ value: option, label: option }))}
                  onChange={ctrl.setResultValue}
                />
              ) : (
                <ObfTextField
                  id="labflow-value"
                  label={t('labFlow.value')}
                  required
                  value={draft.result}
                  onChange={ctrl.setResultValue}
                  placeholder={t('lab.enterValue')}
                />
              )}
              <ObfTextField
                id="labflow-unit"
                label={t('lab.unit')}
                value={draft.unit}
                onChange={unit => ctrl.setResultDraft({ ...draft, unit })}
                placeholder={t('lab.unitExamplePlaceholder')}
              />
              <ObfTextField
                id="labflow-range"
                label={t('lab.referenceRange')}
                value={draft.referenceRange}
                onChange={referenceRange => ctrl.setResultDraft({ ...draft, referenceRange })}
              />
            </div>
          )}

          <div className="obf-row">
            <ObfSelectField
              id="labflow-flag"
              label={t('labFlow.flags')}
              value={draft.critical ? 'critical' : draft.abnormal ? 'abnormal' : 'normal'}
              placeholder={null}
              options={[
                { value: 'normal', label: t('labFlow.withinRange') },
                { value: 'abnormal', label: t('lab.abnormal') },
                { value: 'critical', label: t('lab.criticalLabel') },
              ]}
              onChange={flag => ctrl.setResultDraft({ ...draft, abnormal: flag !== 'normal', critical: flag === 'critical', criticalManual: true })}
            />
          </div>

          {ctrl.criticalVerdict.isCriticalValue && (
            <div className="labord-help" style={{ color: 'var(--color-danger, #D92B20)', fontWeight: 600 }}>
              <p style={{ margin: 0 }}>
                <AlertTriangle className="w-3.5 h-3.5" aria-hidden style={{ display: 'inline', marginInlineEnd: 6 }} />
                {t('lab.flagCriticalMsg')}
              </p>
              {ctrl.criticalVerdict.hits.length > 0 && (
                <ul style={{ margin: '4px 0 0', paddingInlineStart: '1.25em' }}>
                  {ctrl.criticalVerdict.hits.map(hit => (
                    <li key={hit.id}>
                      {t('labFlow.criticalObservationLine', {
                        analyte: hit.label,
                        value: hit.unit ? `${hit.value} ${hit.unit}` : hit.value,
                        comparison: hit.comparison,
                      })}
                    </li>
                  ))}
                </ul>
              )}
            </div>
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
        <div className="obf-section">
          <div className="obf-section-head lwf-section-head">{t('labFlow.amendHeading')}</div>
          <div className="lwf-section-body">
            <ObfTextField
              id="labflow-amend-reason"
              label={t('labFlow.amendReason')}
              multiline
              value={ctrl.amendReason}
              onChange={ctrl.setAmendReason}
              placeholder={t('labFlow.amendReasonPlaceholder')}
            />
            <p className="labord-help">{t('labFlow.amendHelp')}</p>
          </div>
        </div>
      )}
    </div>
  );
}

/** The report that goes back to the clinician. */
export function ReportStep({
  order, ctrl, readOnly = false, onAmend,
}: {
  order: LabResultDoc;
  ctrl: LabWorkflowController;
  /** The viewer cannot work the bench; they may still read, print and — if they
   *  are a clinician — review the result. */
  readOnly?: boolean;
  /** Opens the correction form. Absent for a viewer who may not amend. */
  onAmend?: () => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="lwf-fields">
      <div className="obf-section">
        <div className="obf-section-head lwf-section-head">
          <span>{t('labFlow.reportHeading')}</span>
          <span className="labord-report-actions">
          {onAmend && (
            <button type="button" className="labord-btn" style={{ padding: '4px 10px' }} onClick={onAmend}>
              <Pencil className="w-3.5 h-3.5" aria-hidden /> {t('labFlow.amendAction')}
            </button>
          )}
          <button type="button" className="labord-btn" style={{ padding: '4px 10px' }} onClick={() => printElementById('lab-result-print', {
            label: t('labFlow.finalDiagnosticReport'),
            date: order.completedAt,
            fieldsTitle: t('print.patientInformation'),
            fields: [
              { label: t('print.patientName'), value: order.patientName },
              { label: t('print.patientId'), value: order.hospitalNumber },
              { label: t('lab.specimen'), value: order.specimen },
              { label: t('labFlow.accession'), value: order.accessionNumber },
            ],
          })}>
            <Printer className="w-3.5 h-3.5" aria-hidden /> {t('labFlow.printReport')}
          </button>
          </span>
        </div>
        {order.amended && (
          <p className="labord-help labord-amended">
            {t('labFlow.amendedNotice', {
              from: order.amendedFrom || '—',
              by: order.amendedBy || '—',
              reason: order.amendmentReason || '—',
            })}
          </p>
        )}
        <div id="lab-result-print" className="lwf-section-body labord-print">
          {order.amended && (
            <div className="labord-print-only" style={{ border: '1px solid var(--color-warning-border)', padding: 8, marginBottom: 10 }}>
              <strong>{t('labFlow.amendedResult')}</strong> — {t('labFlow.previousValue')}: {order.amendedFrom || '—'} · {t('labFlow.reason')}: {order.amendmentReason || '—'} · {t('labFlow.amendedBy')}: {order.amendedBy || '—'}
            </div>
          )}
          {order.observations?.length ? (
            <>
              <table className="lab-result-report-table">
                <thead><tr><th>{t('labStructured.investigation')}</th><th>{t('labFlow.value')}</th><th>{t('lab.unit')}</th></tr></thead>
                <tbody>
                  {order.observations.map(observation => (
                    <tr key={observation.id}>
                      <td><span>{observation.label}</span><small>{observation.group}</small></td>
                      <td>{observation.value}</td>
                      <td>{observation.unit || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="obf-row lab-result-report-meta">
                <Field label={t('labFlow.test')} value={order.testName} />
                <Field label={t('labFlow.accession')} value={order.accessionNumber} />
                <Field label={t('labFlow.reportedAt')} value={order.completedAt ? formatDateTime(order.completedAt) : undefined} />
                <Field label={t('lab.specimen')} value={order.specimen || '—'} />
                <Field label={t('labOrder.orderingProviderLabel')} value={order.orderedBy || '—'} />
                <Field
                  label={t('labFlow.interpretation')}
                  value={order.critical ? t('lab.critical') : order.abnormal ? t('lab.abnormal') : t('labFlow.withinRange')}
                />
              </div>
            </>
          ) : (
          <div className="obf-row">
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
            <Field label={t('labFlow.reportedAt')} value={order.completedAt ? formatDateTime(order.completedAt) : undefined} />
            <Field label={t('lab.specimen')} value={order.specimen || '—'} />
            <Field label={t('labOrder.orderingProviderLabel')} value={order.orderedBy || '—'} />
            <Field
              label={t('labFlow.interpretation')}
              value={order.critical ? t('lab.critical') : order.abnormal ? t('lab.abnormal') : t('labFlow.withinRange')}
            />
          </div>
          )}
        </div>
      </div>

      {isOutsideRequest(order) ? (
        <div className="obf-section">
          <div className="obf-section-head lwf-section-head">{t('labFlow.releaseHeading')}</div>
          <div className="lwf-section-body">
            <p className="labord-help" style={{ marginTop: 0 }}>
              {t('labFlow.releaseHelp', { to: order.externalFacility || order.patientName })}
            </p>
            {order.reportReleasedAt ? (
              <Field label={t('labFlow.releasedBy')} value={`${order.reportReleasedBy || '—'} · ${formatDateTime(order.reportReleasedAt)}`} />
            ) : (
              <button type="button" className="labord-btn" onClick={ctrl.releaseReport} disabled={ctrl.busy || readOnly}>
                {t('labFlow.markReleased')}
              </button>
            )}
          </div>
        </div>
      ) : ctrl.canCloseOut && (
        <div className="obf-section">
          <div className="obf-section-head lwf-section-head">{t('labFlow.reviewHeading')}</div>
          <div className="lwf-section-body"><ResultReview order={order} ctrl={ctrl} /></div>
        </div>
      )}
    </div>
  );
}

/** Once filed, the record's facts the report does not already show. */
export function FiledRecord({ order }: { order: LabResultDoc }) {
  const { t } = useTranslation();
  return (
    <div className="obf-section">
      <div className="obf-section-head lwf-section-head">{t('labFlow.recordHeading')}</div>
      <div className="lwf-section-body">
        <div className="obf-row">
          <Field label={t('labFlow.collectedBy')} value={order.specimenCollectedBy} />
          <Field label={t('labFlow.collectedAt')} value={order.specimenCollectedAt ? formatDateTime(order.specimenCollectedAt) : undefined} />
          <Field label={t('labFlow.container')} value={order.specimenContainer} />
          <Field label={t('labFlow.condition')} value={SPECIMEN_CONDITIONS.find(c => c.value === order.specimenCondition)?.label} />
          <Field label={t('labFlow.receivedBy')} value={order.specimenReceivedBy} />
          <Field label={t('labFlow.receivedAt')} value={order.specimenReceivedAt ? formatDateTime(order.specimenReceivedAt) : undefined} />
          {order.specimenCollectedOutside && <Field label={t('labFlow.collectedOutside')} value={order.externalFacility || t('labIntake.source_walk_in')} />}
          {order.specimenCollectionNote && <Field label={t('labFlow.collectionNote')} value={order.specimenCollectionNote} />}
          <Field label={t('labFlow.orderedAt')} value={order.orderedAt ? formatDateTime(order.orderedAt) : undefined} />
          {order.requestSource && <Field label={t('labIntake.source')} value={t(`labIntake.source_${order.requestSource}`)} />}
          {order.externalReference && <Field label={t('labIntake.reference')} value={order.externalReference} />}
        </div>
      </div>
    </div>
  );
}

/** What a result's review needs, on a lab order or an imaging study. */
interface ReviewControls {
  stage: LabOrderStatus;
  busy: boolean;
  lastError: { current: string | null };
  markReviewed: () => Promise<boolean>;
  markActedUpon: () => Promise<boolean>;
  markCommunicated: () => Promise<boolean>;
}

/**
 * The ordering clinician's side of a result: what is on record, and the one
 * thing to do next. These stages are what release a result to the patient
 * portal and stop it escalating, so this is for clinicians only — the bench
 * files the result and the bell tells them it is ready.
 */
export function ResultReview({ order, ctrl }: { order: LabResultDoc; ctrl: ReviewControls }) {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const stages = [
    { from: 'resulted', label: 'labFlow.stage_reviewed_by_clinician', by: order.reviewedBy, at: order.reviewedAt, action: 'labFlow.markReviewed', run: ctrl.markReviewed },
    { from: 'reviewed_by_clinician', label: 'labFlow.stage_acted_upon', by: order.actedUponBy, at: order.actedUponAt, action: 'labFlow.markActedUpon', run: ctrl.markActedUpon },
    { from: 'acted_upon', label: 'labFlow.stage_communicated_to_patient', by: order.communicatedBy, at: order.communicatedAt, action: 'labFlow.markCommunicated', run: ctrl.markCommunicated },
  ];
  const next = stages.find(stage => stage.from === ctrl.stage);

  const press = async () => {
    if (!next || await next.run()) return;
    showToast(t(ctrl.lastError.current || 'labFlow.errGeneric'), 'error', { placement: 'corner' });
  };

  return (
    <div className="labord-review">
      {stages.filter(stage => stage.at).map(stage => (
        <div key={stage.label} className="labord-review-row">
          <CheckCircle2 className="w-4 h-4" aria-hidden />
          <span>
            <strong>{t(stage.label)}</strong>
            <small>{stage.by || '—'} · {formatDateTime(stage.at!)}</small>
          </span>
        </div>
      ))}
      {next && (
        <button type="button" className="labord-btn labord-btn--primary" onClick={() => void press()} disabled={ctrl.busy}>
          {t(next.action)}
        </button>
      )}
    </div>
  );
}
