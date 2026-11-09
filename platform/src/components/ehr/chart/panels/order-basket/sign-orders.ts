/**
 * "Sign and close": write the basket's unsigned orders.
 *
 * Each drug order is checked again at the moment it is signed — the same
 * assessment the chart's Renew runs — because the basket may have sat for a
 * while and the patient's allergies or active medicines may have changed. A
 * severe allergy match still needs the prescriber's written override before
 * that order is written. Test orders go through placeLabOrder, the one path
 * the lab wizard also uses, grouped so tests that share a priority and
 * instructions travel on one requisition.
 *
 * Orders are signed one by one: one that is refused or fails stays in the
 * basket, the rest are written.
 */

import { doseWarningText, hasSafetyStop, needsWeeklyReview, safetyStopPrompt } from '@/lib/pharmacy/rx-safety';
import type { PatientDoc, UserRole } from '@/lib/db-types';
import type { DataScope } from '@/lib/services/data-scope';
import type { PrescriptionCreateInput } from '@/lib/services/prescription-service';
import type { ConfirmPromptOptions } from '@/components/ConfirmDialog';
import { OFF_FORMULARY_CATEGORY } from '@/lib/data/formulary';
import { emptyLabOrderDraft } from '@/components/lab/order/lab-order-types';
import { placeLabOrder } from '@/components/lab/order/place-lab-order';
import type { ChartPanelUser } from '../types';
import {
  doseText, durationText, frequencyText, quantityFor,
  type BasketOrder, type DrugOrderDraft, type TestOrderDraft,
} from './basket-types';

type Translate = (key: string, values?: Record<string, string | number>) => string;

export interface SignOutcome {
  /** Ids of the orders that were written (and leave the basket). */
  signed: string[];
  /** Orders the prescriber declined to override, or that failed to write. */
  kept: { id: string; reason: 'declined' | 'failed'; message?: string }[];
  /** Advisory warnings to show after the write (interactions, an allergy
   *  overridden), one line each. */
  warnings: string[];
}

export async function signOrders({
  orders, patient, currentUser, scope, onSitePharmacy, confirmPrompt, t, onSigned,
}: {
  orders: BasketOrder[];
  patient: PatientDoc;
  currentUser: ChartPanelUser | null | undefined;
  scope: DataScope;
  /** Facility policy: with no dispensary every script goes to the patient. */
  onSitePharmacy: boolean;
  confirmPrompt: (options: ConfirmPromptOptions) => Promise<string | null>;
  t: Translate;
  /**
   * Told the moment each order is written, so the caller can take it out of
   * the basket then and not only when signing ends. A later safety prompt
   * left unanswered (the drawer closed mid-sign) used to leave an order that
   * was already a prescription in the basket, and signing again made a
   * second one (2026-11-08 end-to-end check).
   */
  onSigned?: (ids: string[]) => void;
}): Promise<SignOutcome> {
  const outcome: SignOutcome = { signed: [], kept: [], warnings: [] };
  const prescriber = currentUser?.name || currentUser?.username || 'Unknown user';
  const patientName = `${patient.firstName} ${patient.surname}`.trim();
  const hospitalId = currentUser?.hospitalId || patient.registrationHospital;

  const drugs = orders.filter((o): o is DrugOrderDraft => o.kind === 'drug');
  const tests = orders.filter((o): o is TestOrderDraft => o.kind === 'test');

  if (drugs.length) {
    const { assessPrescriptionSafety, createPrescription } = await import('@/lib/services/prescription-service');
    for (const order of drugs) {
      try {
        const safety = await assessPrescriptionSafety(patient._id, order.drug.name, scope, {
          dose: order.freeText ? '' : doseText(order), frequency: frequencyText(order),
          replacing: order.replaces?.medication,
        });
        if (safety.allergyCheckUnavailable) outcome.warnings.push(t('prescribe.allergyCheckUnavailable'));
        if (safety.interactionCheckUnavailable) outcome.warnings.push(t('prescribe.interactionCheckUnavailable'));
        for (const w of safety.doseWarnings || []) outcome.warnings.push(doseWarningText(t, w));
        let offFormularyReason: string | undefined;
        if (order.drug.category === OFF_FORMULARY_CATEGORY) {
          const reason = await confirmPrompt({
            title: t('prescribe.offListTitle', { name: order.drug.name }),
            message: t('prescribe.offListNotice'),
            inputLabel: t('prescribe.overrideReason'),
            confirmLabel: t('prescribe.overrideConfirm'),
            inputRequired: true,
            tone: 'danger',
          });
          if (reason === null || reason.trim().length < 10) {
            outcome.kept.push({ id: order.id, reason: 'declined', message: reason === null ? undefined : t('prescribe.overrideReasonRequired') });
            continue;
          }
          offFormularyReason = reason.trim();
        }
        let medicationSafetyAcknowledgement: PrescriptionCreateInput['medicationSafetyAcknowledgement'];
        const stops = { ...safety, weeklyOnly: needsWeeklyReview(order.drug.name, frequencyText(order)) };
        if (hasSafetyStop(stops)) {
          const reason = await confirmPrompt({
            ...safetyStopPrompt(t, order.drug.name, stops),
            inputLabel: t('prescribe.overrideReason'),
            confirmLabel: t('prescribe.overrideConfirm'),
            inputRequired: true,
            tone: 'danger',
          });
          if (reason === null || reason.trim().length < 10) {
            outcome.kept.push({ id: order.id, reason: 'declined', message: reason === null ? undefined : t('prescribe.overrideReasonRequired') });
            continue;
          }
          medicationSafetyAcknowledgement = { reviewedBy: prescriber, reason: reason.trim() };
        }
        const instructions = [
          order.patientInstructions.trim(),
          order.prn && order.prnReason.trim() ? t('basket.prnReasonLine', { reason: order.prnReason.trim() }) : '',
        ].filter(Boolean).join(' · ');
        const result = await createPrescription({
          patientId: patient._id,
          patientName,
          // A prescription raised from a note belongs to that note's visit.
          encounterId: order.context?.encounterId,
          medication: order.drug.name,
          offFormularyReason,
          dose: order.freeText ? '' : doseText(order),
          route: order.freeText ? '' : order.route,
          frequency: frequencyText(order),
          duration: durationText(order),
          prescribedBy: prescriber,
          status: 'pending',
          // Signing sends the order on: into this facility's pharmacy queue,
          // or — with no dispensary — to the patient as a script.
          orderStatus: onSitePharmacy ? 'received_in_pharmacy_queue' : 'prescribed',
          fulfilment: onSitePharmacy ? undefined : 'external',
          quantityToDispense: quantityFor(order),
          indication: order.indication.trim() || undefined,
          refills: parseInt(order.refills, 10) || 0,
          effectiveOn: order.startDate,
          pharmacyInstructions: instructions || undefined,
          hospitalId,
          hospitalName: currentUser?.hospitalName,
          orgId: currentUser?.orgId,
          medicationSafetyAcknowledgement,
        } as PrescriptionCreateInput, scope);
        // A Modify is written before the order it replaces is stopped, so the
        // write's own checks still see that order: drop the warnings that are
        // only the new order meeting its old self.
        const replaced = order.replaces?.medication.trim().toLowerCase();
        const isReplaced = (name: string) => !!replaced && name.trim().toLowerCase() === replaced;
        // Only the pair "new order ↔ the order it replaces" goes; the new
        // order's interactions with anything else still show.
        const isNew = (name: string) => name.trim().toLowerCase() === order.drug.name.trim().toLowerCase();
        const interactions = (result.interactionWarnings?.interactions || [])
          .filter(i => !((isReplaced(i.drug1) && isNew(i.drug2)) || (isReplaced(i.drug2) && isNew(i.drug1))));
        if (interactions.length) {
          outcome.warnings.push(t('basket.interactionWarning', {
            medication: order.drug.name,
            value: interactions.map(i => `${i.drug1} ↔ ${i.drug2}`).join(', '),
          }));
        }
        const duplicates = (result.duplicateWarnings || []).filter(name => !isReplaced(name));
        if (duplicates.length) {
          outcome.warnings.push(t('msg.possibleDuplicateIsAlreadyActive', { value: duplicates.join(', ') }));
        }
        if (result.duplicateRecord) {
          outcome.warnings.push(t('dup.orderWarning', { name: result.duplicateRecord.survivorName }));
        }
        // Modify: the new order is written, so the one it changes stops now.
        // If that write fails the new order stands and the prescriber is told
        // to stop the old one by hand, rather than both silently staying live.
        if (order.replaces) {
          try {
            const { discontinuePrescription } = await import('@/lib/services/prescription-service');
            const stopped = await discontinuePrescription(
              order.replaces.id,
              { id: currentUser?._id, name: prescriber },
              t('basket.replacedReason'),
            );
            if (!stopped) throw new Error('not saved');
          } catch {
            outcome.warnings.push(t('basket.replaceStopFailed', { medication: order.replaces.medication }));
          }
        }
        outcome.signed.push(order.id);
        onSigned?.([order.id]);
      } catch (err) {
        outcome.kept.push({ id: order.id, reason: 'failed', message: err instanceof Error ? err.message : undefined });
      }
    }
  }

  // One requisition per priority + instructions + reference: tests ordered
  // together the same way go to the bench together.
  const groups = new Map<string, TestOrderDraft[]>();
  for (const order of tests) {
    const key = [order.priority, order.instructions.trim(), order.referenceNumber.trim()].join('\u0000');
    groups.set(key, [...(groups.get(key) || []), order]);
  }
  for (const group of groups.values()) {
    const first = group[0];
    try {
      const placed = await placeLabOrder({
        patient,
        // ChartPanelUser keeps role as a plain string; it is the signed-in
        // user's role, which the bill's scope needs.
        currentUser: currentUser ? { ...currentUser, role: currentUser.role as UserRole | undefined } : currentUser,
        draft: {
          ...emptyLabOrderDraft(prescriber),
          patientId: patient._id,
          priority: first.priority,
          tests: group.map(o => o.test),
          notes: first.instructions.trim(),
          comments: first.referenceNumber.trim() ? t('basket.referenceLine', { value: first.referenceNumber.trim() }) : '',
        },
      });
      outcome.signed.push(...group.map(o => o.id));
      onSigned?.(group.map(o => o.id));
      if (placed && placed.billed === false) outcome.warnings.push(t('lab.orderNotBilled', { tests: placed.unbilledTests.join(', ') }));
    } catch (err) {
      for (const o of group) outcome.kept.push({ id: o.id, reason: 'failed', message: err instanceof Error ? err.message : undefined });
    }
  }

  return outcome;
}
