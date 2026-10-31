'use client';

/**
 * Filling one prescription: a single form, in the frame of the chart's clinical
 * forms, on the dashboard's slider and in the chart. There are no steps to walk.
 * The pharmacist reads the prescription and its safety and stock lines, says how
 * much to give, and presses Dispense; the lifecycle's own hops happen behind that
 * one press (see `fill` in usePharmacyWorkflow).
 *
 * What the steps guarded still stands: allergy review, a tick against any safety
 * warning, the stock gate, the second signature on controlled medicines, payment.
 */

import { CheckCircle2, AlertTriangle, ShieldAlert } from '@/components/icons/lucide';
import { ObfQuestion, ObfSection, ObfSelectField, ObfTextField, ObfValue } from '@/components/ehr/chart/panels/order-basket/ObfFields';
import FormNotices from '@/components/overlay/FormNotices';
import RxSafetyNotice, { useUnreviewedAllergies } from '@/components/pharmacy/RxSafetyNotice';
import { useToast } from '@/components/Toast';
import { formatDateTime } from '@/lib/format-utils';
import { useTranslation } from '@/lib/i18n/useTranslation';
import type { PrescriptionDoc } from '@/lib/db-types';
import { CLARIFICATION_REASONS, courseQuantity, isFilled, sigLine, UNFILLED_REASONS } from './pharmacy-workflow-types';
import { usePharmacyWorkflow, type PharmacyWorkflowController } from './usePharmacyWorkflow';
import '@/components/lab/order/lab-order.css';
import '@/components/lab/workflow/lab-workflow.css';

/** Picked from the row's dropdown: this form sends it back, or records it cannot be filled. */
export type RxIntent = 'hold' | 'stockout';

/** Computed for the pharmacist to read, never auto-actioned. */
function SafetyLines({ ctrl }: { ctrl: PharmacyWorkflowController }) {
  const { t } = useTranslation();
  const { safety } = ctrl;
  if (safety.loading) return <p className="labord-help">{t('rxFlow.safetyChecking')}</p>;
  if (!ctrl.hasSafetySignal) {
    return <p className="labord-help rx-line"><CheckCircle2 className="w-4 h-4" aria-hidden /> {t('rxFlow.safetyClear')}</p>;
  }
  return (
    <>
      {safety.allergyAlerts.map(line => (
        <p key={line} className="labord-required rx-line"><ShieldAlert className="w-4 h-4" aria-hidden /> {line}</p>
      ))}
      {(safety.interactions?.interactions || []).map(hit => (
        <p key={`${hit.drug1}-${hit.drug2}`} className="labord-help rx-line">
          <AlertTriangle className="w-4 h-4" aria-hidden />
          {t('rxFlow.interactionLine', { a: hit.drug1, b: hit.drug2, severity: hit.severity })}
          {hit.description ? ` — ${hit.description}` : ''}
        </p>
      ))}
      {safety.duplicates.map(dup => (
        <p key={dup} className="labord-help rx-line"><AlertTriangle className="w-4 h-4" aria-hidden /> {t('rxFlow.duplicateLine', { medication: dup })}</p>
      ))}
      <label className={`labord-check ${ctrl.reviewDraft.checksAcknowledged ? 'labord-check--on' : ''}`}>
        <input
          type="checkbox"
          checked={ctrl.reviewDraft.checksAcknowledged}
          onChange={e => ctrl.setReviewDraft({ ...ctrl.reviewDraft, checksAcknowledged: e.target.checked })}
        />
        <span>{t('rxFlow.acknowledgeChecks')}</span>
      </label>
    </>
  );
}

export default function PharmacyWorkflowPanel({
  rx: rxFromList,
  onClose,
  canWork,
  activeMedications,
  intent,
}: {
  rx: PrescriptionDoc;
  /** Back to the list, or closes the slider. */
  onClose: () => void;
  /** False for viewers without dispensing permission: they read it, nothing more. */
  canWork: boolean;
  /** The patient's other active medicines, for interaction and duplicate checks. */
  activeMedications?: string[];
  intent?: RxIntent;
}) {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const ctrl = usePharmacyWorkflow(rxFromList, activeMedications);
  const { rx, dispenseDraft: draft, setDispenseDraft: setDraft } = ctrl;
  const conflicts = useUnreviewedAllergies(rx);
  const filled = isFilled(ctrl.stage);

  const finish = async (fn: () => Promise<boolean>, successKey: string, closes = true) => {
    const ok = await fn();
    // An outcome of the form, not its validation: it goes to the corner.
    showToast(ok ? t(successKey) : t(ctrl.lastError.current || 'rxFlow.errGeneric'), ok ? 'success' : 'error', { placement: 'corner' });
    if (ok && closes) onClose();
  };

  const prescription = {
    id: 'prescription',
    label: t('rxFlow.theScript'),
    body: (
      <>
        <RxSafetyNotice
          rx={rx}
          conflicts={conflicts}
          review={!filled && !intent ? draft.allergyReview : undefined}
          onReview={!filled && !intent ? allergyReview => setDraft({ ...draft, allergyReview }) : undefined}
        />
        <ObfValue label={t('rxFlow.medication')} value={rx.medication} />
        <ObfValue label={t('rxFlow.sig')} value={sigLine(rx)} />
        <ObfValue label={t('rxFlow.prescriber')} value={rx.prescribedBy} />
        <ObfValue label={t('rxFlow.quantity')} value={courseQuantity(rx)} />
        <ObfValue label={t('rxFlow.substitution')} value={rx.allowSubstitution ? t('rxFlow.substitutionAllowed') : t('rxFlow.substitutionNo')} />
        {rx.indication && <ObfValue label={t('rxFlow.clinicalContext')} value={rx.indication} />}
        {rx.pharmacyInstructions && <ObfValue label={t('rxFlow.instructions')} value={rx.pharmacyInstructions} />}
        {rx.dispenseNote && !filled && <ObfValue label={t('rxFlow.note')} value={rx.dispenseNote} />}
      </>
    ),
  };

  const sections = filled ? [prescription, {
    id: 'dispensed',
    label: t('rxFlow.dispensedHead'),
    body: (
      <>
        <ObfValue label={t('rxFlow.quantityDispensed')} value={rx.quantityDispensed} />
        <ObfValue label={t('rxFlow.dispensedBy')} value={rx.dispensedByName} />
        <ObfValue label={t('rxFlow.dispensedAt')} value={rx.dispensedAt ? formatDateTime(rx.dispensedAt) : undefined} />
        {(rx.dispenseAllocations || []).map(a => (
          <ObfValue key={`${a.batchNumber}-${a.quantity}`} label={a.batchNumber || t('rxFlow.batchUnlabelled')} value={a.quantity} />
        ))}
        {canWork && (<>
          <ObfTextField id="rx-recall-note" label={t('rxFlow.note')} value={draft.note} onChange={note => setDraft({ ...draft, note })} />
          {/* A recall without a stated reason is just an undo. */}
          <button type="button" className="labord-btn" disabled={ctrl.busy || !draft.note.trim()} onClick={() => void finish(ctrl.recall, 'rxFlow.okRecalled')}>
            {t('rxFlow.actionRecall')}
          </button>
        </>)}
      </>
    ),
  }] : intent === 'hold' ? [prescription, {
    id: 'hold',
    label: t('rxFlow.actionHold'),
    body: (
      <>
        <p className="labord-help">{t('rxFlow.holdHelp')}</p>
        <ObfSelectField
          id="rx-hold-reason" label={t('rxFlow.holdReason')} required value={ctrl.reviewDraft.clarificationReason}
          options={CLARIFICATION_REASONS.map(r => ({ value: r, label: r }))}
          onChange={clarificationReason => ctrl.setReviewDraft({ ...ctrl.reviewDraft, clarificationReason })}
        />
        <ObfTextField
          id="rx-hold-note" label={t('rxFlow.note')} value={ctrl.reviewDraft.clarificationNote}
          placeholder={t('rxFlow.holdNotePlaceholder')}
          onChange={clarificationNote => ctrl.setReviewDraft({ ...ctrl.reviewDraft, clarificationNote })}
        />
      </>
    ),
  }] : intent === 'stockout' ? [prescription, {
    id: 'stockout',
    label: t('rxFlow.cannotFillHead'),
    body: (
      <>
        <p className="labord-help">{t('rxFlow.unfilledHelp')}</p>
        <ObfSelectField
          id="rx-unfilled" label={t('rxFlow.unfilledReason')} required value={draft.unfilledReason}
          options={UNFILLED_REASONS.map(r => ({ value: r, label: r }))}
          onChange={unfilledReason => setDraft({ ...draft, unfilledReason })}
        />
        <ObfTextField id="rx-note" label={t('rxFlow.note')} value={draft.note} onChange={note => setDraft({ ...draft, note })} />
      </>
    ),
  }] : [prescription, {
    id: 'safety',
    label: t('rxFlow.safetyHead'),
    body: <SafetyLines ctrl={ctrl} />,
  }, {
    id: 'give',
    label: t('rxFlow.handOverHead'),
    body: (
      <>
        <ObfQuestion label={t('rxFlow.quantityToHand')} htmlFor="rx-qty" required>
          <input
            id="rx-qty" type="number" step="any" min={1}
            value={draft.quantity}
            onChange={e => setDraft({ ...draft, quantity: Number(e.target.value) })}
          />
        </ObfQuestion>
        <ObfValue label={t('rxFlow.stockAvailable')} value={ctrl.stock.loading ? t('rxFlow.stockChecking') : ctrl.stock.plan?.available ?? 0} />
        {(ctrl.stock.plan?.allocations || []).map(a => (
          <ObfValue
            key={a.batch._id}
            label={[
              a.batch.batchNumber || t('rxFlow.batchUnlabelled'),
              a.batch.expiryDate && t('rxFlow.expires', { date: a.batch.expiryDate }),
              a.batch.controlledSchedule && t('rxFlow.schedule', { schedule: a.batch.controlledSchedule }),
            ].filter(Boolean).join(' · ')}
            value={a.quantity}
          />
        ))}
        {ctrl.short && (<>
          <p className="labord-required rx-line">
            <AlertTriangle className="w-4 h-4" aria-hidden /> {t('rxFlow.shortWarning', { shortfall: ctrl.stock.plan?.shortfall ?? 0 })}
          </p>
          <ObfSelectField
            id="rx-partial" label={t('rxFlow.allowPartial')} value={draft.allowPartial ? 'yes' : 'no'} placeholder={null}
            options={[{ value: 'no', label: t('rxFlow.partialNo') }, { value: 'yes', label: t('rxFlow.partialYes') }]}
            onChange={value => setDraft({ ...draft, allowPartial: value === 'yes' })}
          />
        </>)}
        {/* Controlled medicines move on two signatures, recorded before the stock does. */}
        {ctrl.needsWitness && (<>
          <p className="labord-required rx-line">{t('rxFlow.witnessRequired')}</p>
          <ObfTextField id="rx-witness-id" label={t('rxFlow.witnessId')} required value={draft.witnessId} onChange={witnessId => setDraft({ ...draft, witnessId })} />
          <ObfTextField id="rx-witness-name" label={t('rxFlow.witnessName')} value={draft.witnessName} onChange={witnessName => setDraft({ ...draft, witnessName })} />
        </>)}
        <ObfTextField id="rx-give-note" label={t('rxFlow.note')} value={draft.note} onChange={note => setDraft({ ...draft, note })} />
      </>
    ),
  }];

  const save = !canWork || filled ? undefined
    : intent === 'hold' ? () => void finish(ctrl.hold, 'rxFlow.okHeld')
    : intent === 'stockout' ? () => void finish(ctrl.recordStockOut, 'rxFlow.okStockOut')
    : () => void finish(ctrl.fill, 'rxFlow.okDispensed');
  const blocked = intent === 'hold' ? !ctrl.reviewDraft.clarificationReason
    : intent === 'stockout' ? !draft.unfilledReason
    : draft.quantity <= 0 || (ctrl.short && !draft.allowPartial) || (ctrl.needsWitness && !draft.witnessId.trim())
      || (ctrl.hasSafetySignal && !ctrl.reviewDraft.checksAcknowledged);

  return (
    <div className="station-form-slider obk-root lwf rx-fill">
      <div className="obf-form">
        <div className="obf-form-body">
          <div className="obf-pad">
            {sections.map(section => <ObfSection key={section.id} title={section.label}>{section.body}</ObfSection>)}
          </div>
        </div>
        <FormNotices />
        <div className="obk-footer">
          <button type="button" className="obk-footer-btn obk-footer-btn--secondary" disabled={ctrl.busy} onClick={onClose}>
            {t(save ? 'action.cancel' : 'action.close')}
          </button>
          {save && (
            <button type="button" className="obk-footer-btn obk-footer-btn--primary" disabled={ctrl.busy || blocked} onClick={save}>
              {t(intent === 'hold' ? 'rxFlow.actionHold' : intent === 'stockout' ? 'rxFlow.actionStockOut' : 'rxFlow.fillAction')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
