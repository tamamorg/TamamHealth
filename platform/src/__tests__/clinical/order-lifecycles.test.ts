/**
 * Clinical-flow — lab, procedure and prescription order lifecycles
 * (src/lib/clinical-flow/order-lifecycles.ts).
 *
 * Journey B (lab): ordered → specimen_collected → received_at_lab → in_process
 * → resulted → reviewed_by_clinician → acted_upon → communicated_to_patient.
 * A result must be reviewed by a clinician before it can be acted upon — the
 * lab bench cannot self-approve a result into the chart.
 */
import { labOrder, procedure, prescription, RESULT_REVIEW_SLA, LAB_ORDER_TRANSITIONS } from '@/lib/clinical-flow/order-lifecycles';

describe('lab order lifecycle (Journey B)', () => {
  test('the happy path is legal end to end', () => {
    const path = [
      'ordered', 'specimen_collected', 'received_at_lab', 'in_process',
      'resulted', 'reviewed_by_clinician', 'acted_upon', 'communicated_to_patient',
    ] as const;
    for (let i = 0; i < path.length - 1; i++) {
      expect(labOrder.can(path[i], path[i + 1])).toBe(true);
    }
  });

  test('a resulted lab must be reviewed before it can be acted upon', () => {
    expect(labOrder.can('resulted', 'acted_upon')).toBe(false);
    expect(labOrder.can('resulted', 'reviewed_by_clinician')).toBe(true);
    expect(labOrder.can('reviewed_by_clinician', 'acted_upon')).toBe(true);
  });

  test('a rejected specimen loops back to collection, not forward', () => {
    expect(labOrder.can('specimen_collected', 'rejected_needs_recollection')).toBe(true);
    expect(labOrder.can('rejected_needs_recollection', 'specimen_collected')).toBe(true);
    expect(labOrder.can('rejected_needs_recollection', 'resulted')).toBe(false);
  });

  test('you cannot skip from ordered straight to resulted', () => {
    expect(labOrder.can('ordered', 'resulted')).toBe(false);
  });

  test('communicated_to_patient is terminal', () => {
    expect(labOrder.next('communicated_to_patient')).toHaveLength(0);
  });

  test('critical results have a tighter review SLA than routine', () => {
    expect(RESULT_REVIEW_SLA.criticalHours).toBeLessThan(RESULT_REVIEW_SLA.routineHours);
  });

  test('every lab status target is itself a defined key', () => {
    const keys = new Set(Object.keys(LAB_ORDER_TRANSITIONS));
    for (const targets of Object.values(LAB_ORDER_TRANSITIONS)) {
      for (const t of targets) expect(keys.has(t)).toBe(true);
    }
  });
});

describe('procedure lifecycle', () => {
  test('consent precedes the procedure; abort needs a reason path', () => {
    expect(procedure.can('ordered', 'consented')).toBe(true);
    expect(procedure.can('consented', 'in_progress')).toBe(true);
    expect(procedure.can('ordered', 'in_progress')).toBe(false); // no skipping consent
  });
  test('a complication can be reported as an adverse event', () => {
    expect(procedure.can('complication', 'ae_reported')).toBe(true);
  });
});

describe('prescription (pharmacy) lifecycle', () => {
  test('pharmacist review and clearance can be recorded in one action', () => {
    expect(prescription.can('received_in_pharmacy_queue', 'under_review')).toBe(true);
    expect(prescription.can('received_in_pharmacy_queue', 'cleared_for_dispensing')).toBe(true);
    expect(prescription.can('under_review', 'cleared_for_dispensing')).toBe(true);
    expect(prescription.can('received_in_pharmacy_queue', 'dispensed')).toBe(false);
  });
  test('a cleared prescription can be dispensed then counseled to completion', () => {
    expect(prescription.can('cleared_for_dispensing', 'dispensed')).toBe(true);
    expect(prescription.can('dispensed', 'counseled')).toBe(true);
    expect(prescription.can('counseled', 'complete')).toBe(true);
  });
  test('a stock-out re-queues the order rather than completing it', () => {
    expect(prescription.can('cleared_for_dispensing', 'stockout_partial_referred')).toBe(true);
    expect(prescription.can('stockout_partial_referred', 'received_in_pharmacy_queue')).toBe(true);
  });
});
