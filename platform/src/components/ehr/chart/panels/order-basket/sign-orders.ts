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

import { hasSafetyStop, safetyStopPrompt } from '@/lib/pharmacy/rx-safety';
import type { PatientDoc, UserRole } from '@/lib/db-types';
import type { DataScope } from '@/lib/services/data-scope';
import type { PrescriptionCreateInput } from '@/lib/services/prescription-service';
import type { ConfirmPromptOptions } from '@/components/ConfirmDialog';
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
  orders, patient, currentUser, scope, onSitePharmacy, confirmPrompt, t,
}: {
  orders: BasketOrder[];
  patient: PatientDoc;
  currentUser: ChartPanelUser | null | undefined;
  scope: DataScope;
  /** Facility policy: with no dispensary every script goes to the patient. */
  onSitePharmacy: boolean;
  confirmPrompt: (options: ConfirmPromptOptions) => Promise<string | null>;
  t: Translate;
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
        const safety = await assessPrescriptionSafety(patient._id, order.drug.name, scope);
        if (safety.allergyCheckUnavailable) outcome.warnings.push(t('prescribe.allergyCheckUnavailable'));
        let medicationSafetyAcknowledgement: PrescriptionCreateInput['medicationSafetyAcknowledgement'];
        if (hasSafetyStop(safety)) {
          const reason = await confirmPrompt({
            ...safetyStopPrompt(t, order.drug.name, safety),
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
        if (result.interactionWarnings?.hasInteractions) {
          outcome.warnings.push(t('basket.interactionWarning', {
            medication: order.drug.name,
            value: result.interactionWarnings.interactions.map(i => `${i.drug1} ↔ ${i.drug2}`).join(', '),
          }));
        }
        outcome.signed.push(order.id);
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
      await placeLabOrder({
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
    } catch (err) {
      for (const o of group) outcome.kept.push({ id: o.id, reason: 'failed', message: err instanceof Error ? err.message : undefined });
    }
  }

  return outcome;
}
