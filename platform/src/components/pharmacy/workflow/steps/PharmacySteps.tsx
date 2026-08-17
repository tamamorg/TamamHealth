'use client';

/**
 * The six counter steps. Each renders the same way as the lab bench's: what was
 * captured (once the script has moved past it) or the form plus its one action
 * (when the script is sitting on it). They share a file because each is small
 * and they are only ever rendered by PharmacyWorkflowPanel.
 */

import { AlertTriangle, CheckCircle2, ShieldAlert } from '@/components/icons/lucide';
import Select from '@/components/Select';
import { formatDateTime } from '@/lib/format-utils';
import { useTranslation } from '@/lib/i18n/useTranslation';
import type { PrescriptionDoc } from '@/lib/db-types';
import {
  CLARIFICATION_REASONS,
  COUNSELLING_POINTS,
  courseQuantity,
  sigLine,
  UNFILLED_REASONS,
  type CounsellingPointKey,
} from '../pharmacy-workflow-types';
import type { PharmacyWorkflowController } from '../usePharmacyWorkflow';

export function Field({ label, value }: { label: string; value?: React.ReactNode }) {
  return (
    <div>
      <span className="labord-field-label">{label}</span>
      <span className="labord-field-value">{value || '—'}</span>
    </div>
  );
}

/** Step 1 — the prescription as written. Read-only by definition. */
export function RxStep({ rx }: { rx: PrescriptionDoc }) {
  const { t } = useTranslation();
  return (
    <div>
      <div className="labord-section">
        <div className="labord-section-head">{t('rxFlow.theScript')}</div>
        <div className="labord-section-body">
          <div className="labord-grid-2">
            <Field label={t('rxFlow.medication')} value={rx.medication} />
            <Field label={t('rxFlow.sig')} value={sigLine(rx)} />
            <Field label={t('rxFlow.prescriber')} value={rx.prescribedBy} />
            <Field label={t('rxFlow.prescribedAt')} value={rx.createdAt ? formatDateTime(rx.createdAt) : '—'} />
            <Field label={t('rxFlow.quantity')} value={courseQuantity(rx)} />
            <Field label={t('rxFlow.refills')} value={typeof rx.refills === 'number' ? rx.refills : '—'} />
            <Field
              label={t('rxFlow.substitution')}
              value={rx.allowSubstitution ? t('rxFlow.substitutionAllowed') : t('rxFlow.substitutionNo')}
            />
            <Field
              label={t('rxFlow.urgency')}
              value={rx.urgency === 'immediate' ? t('rxFlow.urgencyImmediate') : t('rxFlow.urgencyDefinitive')}
            />
          </div>
        </div>
      </div>

      {(rx.indication || rx.pharmacyInstructions) && (
        <div className="labord-section">
          <div className="labord-section-head">{t('rxFlow.clinicalContext')}</div>
          <div className="labord-section-body">
            {rx.indication && (
              <div className="labord-chip-row" style={{ marginBottom: rx.pharmacyInstructions ? 10 : 0 }}>
                <span className="labord-chip">{rx.indication}</span>
              </div>
            )}
            {rx.pharmacyInstructions && <p className="labord-help" style={{ margin: 0 }}>{rx.pharmacyInstructions}</p>}
          </div>
        </div>
      )}
    </div>
  );
}

/** Step 2 — take the script onto the pharmacy queue. */
export function ReceiveStep({ rx, ctrl }: { rx: PrescriptionDoc; ctrl: PharmacyWorkflowController }) {
  const { t } = useTranslation();
  const done = ctrl.doneThrough >= 1;

  return (
    <div className="labord-section">
      <div className="labord-section-head">{t('rxFlow.receiveHead')}</div>
      <div className="labord-section-body">
        {done ? (
          <div className="labord-grid-2">
            <Field label={t('rxFlow.stage')} value={t(`rxFlow.stage_${ctrl.stage}`)} />
            <Field label={t('rxFlow.medication')} value={rx.medication} />
          </div>
        ) : (
          <p className="labord-help" style={{ margin: 0 }}>{t('rxFlow.receiveHelp')}</p>
        )}
      </div>
    </div>
  );
}

/** The safety panel — computed for the pharmacist to read, never auto-actioned. */
function SafetyPanel({ ctrl }: { ctrl: PharmacyWorkflowController }) {
  const { t } = useTranslation();
  const { safety } = ctrl;

  if (safety.loading) {
    return <p className="labord-help" style={{ margin: 0 }}>{t('rxFlow.safetyChecking')}</p>;
  }

  if (!ctrl.hasSafetySignal) {
    return (
      <p className="labord-help" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
        <CheckCircle2 className="w-4 h-4" aria-hidden /> {t('rxFlow.safetyClear')}
      </p>
    );
  }

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {safety.allergyAlerts.map(line => (
        <p key={line} className="labord-required" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
          <ShieldAlert className="w-4 h-4" aria-hidden /> {line}
        </p>
      ))}
      {(safety.interactions?.interactions || []).map(hit => (
        <p key={`${hit.drug1}-${hit.drug2}`} className="labord-help" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
          <AlertTriangle className="w-4 h-4" aria-hidden />
          {t('rxFlow.interactionLine', { a: hit.drug1, b: hit.drug2, severity: hit.severity })}
          {hit.description ? ` — ${hit.description}` : ''}
        </p>
      ))}
      {safety.duplicates.map(dup => (
        <p key={dup} className="labord-help" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
          <AlertTriangle className="w-4 h-4" aria-hidden /> {t('rxFlow.duplicateLine', { medication: dup })}
        </p>
      ))}
    </div>
  );
}

/** Step 3 — the safety review, and the decision that comes out of it. */
export function ReviewStep({ rx, ctrl }: { rx: PrescriptionDoc; ctrl: PharmacyWorkflowController }) {
  const { t } = useTranslation();
  const done = ctrl.doneThrough >= 2;

  return (
    <div>
      {ctrl.parked && (
        <div className="labord-section">
          <div className="labord-section-head labord-required">{t(`rxFlow.parked_${ctrl.stage}`)}</div>
          <div className="labord-section-body">
            <Field label={t('rxFlow.note')} value={rx.dispenseNote} />
            <p className="labord-help" style={{ margin: '8px 0 0' }}>{t('rxFlow.parkedHelp')}</p>
          </div>
        </div>
      )}

      <div className="labord-section">
        <div className="labord-section-head">{t('rxFlow.safetyHead')}</div>
        <div className="labord-section-body"><SafetyPanel ctrl={ctrl} /></div>
      </div>

      <div className="labord-section">
        <div className="labord-section-head">{t('rxFlow.stockHead')}</div>
        <div className="labord-section-body">
          {ctrl.stock.loading ? (
            <p className="labord-help" style={{ margin: 0 }}>{t('rxFlow.stockChecking')}</p>
          ) : (
            <div className="labord-grid-2">
              <Field label={t('rxFlow.stockAvailable')} value={ctrl.stock.plan?.available ?? 0} />
              <Field label={t('rxFlow.courseNeeds')} value={courseQuantity(rx)} />
              {ctrl.short && (
                <Field
                  label={t('rxFlow.shortfall')}
                  value={<span className="labord-required">{ctrl.stock.plan?.shortfall}</span>}
                />
              )}
            </div>
          )}
        </div>
      </div>

      {done ? (
        <div className="labord-section">
          <div className="labord-section-head">{t('rxFlow.clearedHead')}</div>
          <div className="labord-section-body">
            <Field label={t('rxFlow.stage')} value={t(`rxFlow.stage_${ctrl.stage}`)} />
          </div>
        </div>
      ) : (
        <div className="labord-section">
          <div className="labord-section-head">{t('rxFlow.decisionHead')}</div>
          <div className="labord-section-body">
            <label className={`labord-check ${ctrl.reviewDraft.checksAcknowledged ? 'labord-check--on' : ''}`}>
              <input
                type="checkbox"
                checked={ctrl.reviewDraft.checksAcknowledged}
                onChange={e => ctrl.setReviewDraft({ ...ctrl.reviewDraft, checksAcknowledged: e.target.checked })}
              />
              <span>{t('rxFlow.acknowledgeChecks')}</span>
            </label>

            <div className="labord-divider" />

            <p className="labord-help" style={{ marginTop: 0 }}>{t('rxFlow.holdHelp')}</p>
            <div className="labord-form">
              <label className="labord-field-label" htmlFor="rx-hold-reason">{t('rxFlow.holdReason')}</label>
              <Select
                id="rx-hold-reason"
                value={ctrl.reviewDraft.clarificationReason}
                onChange={e => ctrl.setReviewDraft({ ...ctrl.reviewDraft, clarificationReason: e.target.value })}
              >
                <option value="">{t('rxFlow.holdReasonNone')}</option>
                {CLARIFICATION_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
              </Select>
              <label className="labord-field-label" htmlFor="rx-hold-note">{t('rxFlow.note')}</label>
              <input
                id="rx-hold-note"
                className="labord-x"
                value={ctrl.reviewDraft.clarificationNote}
                onChange={e => ctrl.setReviewDraft({ ...ctrl.reviewDraft, clarificationNote: e.target.value })}
                placeholder={t('rxFlow.holdNotePlaceholder')}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Step 4 — hand the medicine over. */
export function DispenseStep({ rx, ctrl }: { rx: PrescriptionDoc; ctrl: PharmacyWorkflowController }) {
  const { t } = useTranslation();
  const done = ctrl.doneThrough >= 3;

  if (done) {
    return (
      <div className="labord-section">
        <div className="labord-section-head">{t('rxFlow.dispensedHead')}</div>
        <div className="labord-section-body">
          <div className="labord-grid-2">
            <Field label={t('rxFlow.quantityDispensed')} value={rx.quantityDispensed} />
            <Field label={t('rxFlow.dispensedBy')} value={rx.dispensedByName} />
            <Field label={t('rxFlow.dispensedAt')} value={rx.dispensedAt ? formatDateTime(rx.dispensedAt) : '—'} />
            <Field label={t('rxFlow.outcome')} value={rx.dispenseOutcome} />
          </div>
          {rx.dispenseAllocations?.length ? (
            <>
              <div className="labord-divider" />
              <div className="labord-section-head" style={{ border: 0, padding: 0 }}>{t('rxFlow.batches')}</div>
              {rx.dispenseAllocations.map(a => (
                <div key={`${a.batchNumber}-${a.quantity}`} className="labord-row">
                  <span className="labord-pick-meta">{a.batchNumber || t('rxFlow.batchUnlabelled')}</span>
                  <span className="labord-field-value">{a.quantity}</span>
                </div>
              ))}
            </>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="labord-section">
        <div className="labord-section-head">{t('rxFlow.handOverHead')}</div>
        <div className="labord-section-body">
          <div className="labord-form">
            <label className="labord-field-label" htmlFor="rx-qty">{t('rxFlow.quantityToHand')}</label>
            <input
              id="rx-qty"
              className="labord-x"
              type="number"
              min={1}
              value={ctrl.dispenseDraft.quantity}
              onChange={e => ctrl.setDispenseDraft({ ...ctrl.dispenseDraft, quantity: Number(e.target.value) })}
            />
            <p className="labord-help" style={{ margin: 0 }}>
              {t('rxFlow.courseHelp', { quantity: courseQuantity(rx) })}
            </p>
          </div>

          <div className="labord-divider" />

          {/* The stock gate, shown before it is enforced — the pharmacist sees
              the shortfall rather than discovering it in an error toast. */}
          <div className="labord-grid-2">
            <Field label={t('rxFlow.stockAvailable')} value={ctrl.stock.plan?.available ?? 0} />
            <Field label={t('rxFlow.allocated')} value={ctrl.stock.plan?.allocated ?? 0} />
          </div>

          {(ctrl.stock.plan?.allocations || []).length > 0 && (
            <>
              <div className="labord-section-head" style={{ border: 0, padding: '10px 0 0' }}>{t('rxFlow.fefoHead')}</div>
              {(ctrl.stock.plan?.allocations || []).map(a => (
                <div key={a.batch._id} className="labord-row">
                  <span className="labord-pick-meta">
                    {a.batch.batchNumber || t('rxFlow.batchUnlabelled')}
                    {a.batch.expiryDate ? ` · ${t('rxFlow.expires', { date: a.batch.expiryDate })}` : ''}
                    {a.batch.controlledSchedule ? ` · ${t('rxFlow.schedule', { schedule: a.batch.controlledSchedule })}` : ''}
                  </span>
                  <span className="labord-field-value">{a.quantity}</span>
                </div>
              ))}
            </>
          )}

          {ctrl.short && (
            <>
              <p className="labord-required" style={{ margin: '10px 0 0', display: 'flex', alignItems: 'center', gap: 6 }}>
                <AlertTriangle className="w-4 h-4" aria-hidden />
                {t('rxFlow.shortWarning', { shortfall: ctrl.stock.plan?.shortfall ?? 0 })}
              </p>
              <label className={`labord-check ${ctrl.dispenseDraft.allowPartial ? 'labord-check--on' : ''}`}>
                <input
                  type="checkbox"
                  checked={ctrl.dispenseDraft.allowPartial}
                  onChange={e => ctrl.setDispenseDraft({ ...ctrl.dispenseDraft, allowPartial: e.target.checked })}
                />
                <span>{t('rxFlow.allowPartial')}</span>
              </label>
            </>
          )}

          {/* Controlled medicines move on two signatures, and the witness is
              recorded before the stock does. */}
          {ctrl.needsWitness && (
            <>
              <div className="labord-divider" />
              <div className="labord-form">
                <p className="labord-required" style={{ marginTop: 0 }}>{t('rxFlow.witnessRequired')}</p>
                <label className="labord-field-label" htmlFor="rx-witness-id">{t('rxFlow.witnessId')}</label>
                <input
                  id="rx-witness-id"
                  className="labord-x"
                  value={ctrl.dispenseDraft.witnessId}
                  onChange={e => ctrl.setDispenseDraft({ ...ctrl.dispenseDraft, witnessId: e.target.value })}
                />
                <label className="labord-field-label" htmlFor="rx-witness-name">{t('rxFlow.witnessName')}</label>
                <input
                  id="rx-witness-name"
                  className="labord-x"
                  value={ctrl.dispenseDraft.witnessName}
                  onChange={e => ctrl.setDispenseDraft({ ...ctrl.dispenseDraft, witnessName: e.target.value })}
                />
              </div>
            </>
          )}
        </div>
      </div>

      <div className="labord-section">
        <div className="labord-section-head">{t('rxFlow.cannotFillHead')}</div>
        <div className="labord-section-body">
          <div className="labord-form">
            <label className="labord-field-label" htmlFor="rx-unfilled">{t('rxFlow.unfilledReason')}</label>
            <Select
              id="rx-unfilled"
              value={ctrl.dispenseDraft.unfilledReason}
              onChange={e => ctrl.setDispenseDraft({ ...ctrl.dispenseDraft, unfilledReason: e.target.value })}
            >
              <option value="">{t('rxFlow.holdReasonNone')}</option>
              {UNFILLED_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
            </Select>
            <label className="labord-field-label" htmlFor="rx-note">{t('rxFlow.note')}</label>
            <input
              id="rx-note"
              className="labord-x"
              value={ctrl.dispenseDraft.note}
              onChange={e => ctrl.setDispenseDraft({ ...ctrl.dispenseDraft, note: e.target.value })}
            />
            <p className="labord-help" style={{ margin: 0 }}>{t('rxFlow.unfilledHelp')}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Step 5 — counselling. */
export function CounselStep({ rx, ctrl }: { rx: PrescriptionDoc; ctrl: PharmacyWorkflowController }) {
  const { t } = useTranslation();
  const done = ctrl.doneThrough >= 4;

  if (done) {
    return (
      <div className="labord-section">
        <div className="labord-section-head">{t('rxFlow.counselledHead')}</div>
        <div className="labord-section-body">
          <div className="labord-grid-2">
            <Field label={t('rxFlow.counselledBy')} value={rx.counselledBy} />
            <Field label={t('rxFlow.counselledAt')} value={rx.counselledAt ? formatDateTime(rx.counselledAt) : '—'} />
          </div>
          {rx.counselledPoints?.length ? (
            <div className="labord-chip-row" style={{ marginTop: 10 }}>
              {rx.counselledPoints.map(point => {
                const known = COUNSELLING_POINTS.find(p => p.key === point);
                return <span key={point} className="labord-chip">{known ? t(known.label) : point}</span>;
              })}
            </div>
          ) : null}
          {rx.counsellingNote && <p className="labord-help" style={{ margin: '10px 0 0' }}>{rx.counsellingNote}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="labord-section">
      <div className="labord-section-head">{t('rxFlow.counselHead')}</div>
      <div className="labord-section-body">
        <p className="labord-help" style={{ marginTop: 0 }}>{t('rxFlow.counselHelp', { sig: sigLine(rx) })}</p>
        <div className="labord-check-grid">
          {COUNSELLING_POINTS.map(point => {
            const on = ctrl.counselDraft.points[point.key as CounsellingPointKey];
            return (
              <label key={point.key} className={`labord-check ${on ? 'labord-check--on' : ''}`}>
                <input
                  type="checkbox"
                  checked={on}
                  onChange={e => ctrl.setCounselDraft({
                    ...ctrl.counselDraft,
                    points: { ...ctrl.counselDraft.points, [point.key]: e.target.checked },
                  })}
                />
                <span>{t(point.label)}</span>
              </label>
            );
          })}
        </div>
        <div className="labord-form" style={{ marginTop: 10 }}>
          <label className="labord-field-label" htmlFor="rx-counsel-note">{t('rxFlow.note')}</label>
          <input
            id="rx-counsel-note"
            className="labord-x"
            value={ctrl.counselDraft.note}
            onChange={e => ctrl.setCounselDraft({ ...ctrl.counselDraft, note: e.target.value })}
            placeholder={t('rxFlow.counselNotePlaceholder')}
          />
        </div>
      </div>
    </div>
  );
}

/** Step 6 — the script, closed out. */
export function CloseStep({ rx, ctrl }: { rx: PrescriptionDoc; ctrl: PharmacyWorkflowController }) {
  const { t } = useTranslation();
  const complete = ctrl.stage === 'complete';

  return (
    <div className="labord-section">
      <div className="labord-section-head">{t('rxFlow.closeHead')}</div>
      <div className="labord-section-body">
        <div className="labord-grid-2">
          <Field label={t('rxFlow.medication')} value={rx.medication} />
          <Field label={t('rxFlow.sig')} value={sigLine(rx)} />
          <Field label={t('rxFlow.quantityDispensed')} value={rx.quantityDispensed} />
          <Field label={t('rxFlow.stage')} value={t(`rxFlow.stage_${ctrl.stage}`)} />
        </div>
        <p className="labord-help" style={{ margin: '10px 0 0', display: 'flex', alignItems: 'center', gap: 6 }}>
          {complete
            ? <><CheckCircle2 className="w-4 h-4" aria-hidden /> {t('rxFlow.closeDone')}</>
            : t('rxFlow.closeHelp')}
        </p>
      </div>
    </div>
  );
}
