/**
 * The lab dashboard's queue tabs read Tests ordered → In progress →
 * Completed, and the status pill on each queue row lets the technician move
 * an order between the first two without opening the chart. `setLabBenchStatus`
 * is what that pill writes.
 *
 * Every forward move has to satisfy the granular lifecycle guard
 * (LAB_ORDER_TRANSITIONS) rather than skip it, so an order taken onto the
 * bench from the queue carries the same specimen stamps as one walked through
 * the chart's bench workflow. The one backward move — In progress back to
 * Tests ordered — is an undo and must never touch a resulted test.
 */
jest.mock('@/lib/db', () => require('../helpers/test-db').createDBMock());

import { teardownTestDBs } from '../helpers/test-db';
import {
  createLabResult,
  getLabResultById,
  setLabBenchStatus,
  effectiveOrderStatus,
} from '@/lib/services/lab-service';
import type { LabResultDoc } from '@/lib/db-types';

afterEach(async () => {
  await teardownTestDBs();
});

function baseOrder(overrides: Partial<LabResultDoc> = {}) {
  return {
    patientId: 'pat-00001',
    patientName: 'Nyakuma Deng',
    hospitalNumber: 'JTH-000001',
    testName: 'Malaria RDT',
    specimen: 'Blood',
    status: 'pending' as const,
    result: '',
    unit: '',
    referenceRange: 'Negative',
    abnormal: false,
    critical: false,
    orderedBy: 'Dr. Wani',
    orderedAt: new Date().toISOString(),
    completedAt: '',
    hospitalId: 'hosp-001',
    orgId: 'org-moh-ss',
    ...overrides,
  };
}

describe('setLabBenchStatus', () => {
  test('Tests ordered → In progress walks the lifecycle guard and stamps the specimen steps', async () => {
    const order = await createLabResult(baseOrder({ orderStatus: 'ordered' }));

    const moved = await setLabBenchStatus(order._id, 'in_progress', 'Lab Tech Gatluak');

    expect(moved?.status).toBe('in_progress');
    expect(moved?.orderStatus).toBe('in_process');
    expect(moved?.specimenCollectedBy).toBe('Lab Tech Gatluak');
    expect(moved?.specimenCollectedAt).toBeTruthy();
    expect(moved?.specimenReceivedBy).toBe('Lab Tech Gatluak');
    expect(moved?.specimenReceivedAt).toBeTruthy();
    expect(moved?.specimenCondition).toBe('acceptable');
    // The bench is not "done" — nothing stamped a completion time.
    expect(moved?.completedAt).toBe('');
  });

  test('a legacy order with no lifecycle stage is treated as ordered', async () => {
    const order = await createLabResult(baseOrder());
    expect(effectiveOrderStatus(order)).toBe('ordered');

    const moved = await setLabBenchStatus(order._id, 'in_progress');

    expect(moved?.status).toBe('in_progress');
    expect(moved?.orderStatus).toBe('in_process');
    expect(moved?.specimenCollectedBy).toBe('Lab');
  });

  test('a rejected specimen goes back through collection, clearing the rejection', async () => {
    const order = await createLabResult(baseOrder({
      orderStatus: 'rejected_needs_recollection',
      specimenCondition: 'insufficient_quantity',
      specimenRejectionReason: 'Insufficient quantity',
      specimenRejectionNotes: 'Saliva only',
      specimenRejectedBy: 'Lab Tech Gatluak',
    }));

    const moved = await setLabBenchStatus(order._id, 'in_progress', 'Lab Tech Gatluak');

    expect(moved?.orderStatus).toBe('in_process');
    expect(moved?.specimenRejectionReason).toBe('');
    expect(moved?.specimenRejectionNotes).toBe('');
    expect(moved?.specimenCondition).toBe('acceptable');
  });

  test('an order already received at the lab only needs the last hop', async () => {
    const order = await createLabResult(baseOrder({
      orderStatus: 'received_at_lab',
      specimenCollectedBy: 'Nurse Stella',
      specimenReceivedBy: 'Lab Tech Puok',
    }));

    const moved = await setLabBenchStatus(order._id, 'in_progress', 'Lab Tech Gatluak');

    expect(moved?.orderStatus).toBe('in_process');
    // Existing stamps are the record of who really did those steps.
    expect(moved?.specimenCollectedBy).toBe('Nurse Stella');
    expect(moved?.specimenReceivedBy).toBe('Lab Tech Puok');
  });

  test('In progress → Tests ordered is the undo: back to received at lab, specimen kept', async () => {
    const order = await createLabResult(baseOrder({ orderStatus: 'ordered' }));
    await setLabBenchStatus(order._id, 'in_progress', 'Lab Tech Gatluak');

    const undone = await setLabBenchStatus(order._id, 'pending');

    expect(undone?.status).toBe('pending');
    expect(undone?.orderStatus).toBe('received_at_lab');
    expect(undone?.specimenReceivedBy).toBe('Lab Tech Gatluak');
  });

  test('picking the lane an order is already in changes nothing', async () => {
    const order = await createLabResult(baseOrder({ orderStatus: 'ordered' }));

    const same = await setLabBenchStatus(order._id, 'pending');
    const stored = await getLabResultById(order._id);

    expect(same?._rev).toBe(order._rev);
    expect(stored?._rev).toBe(order._rev);
    expect(stored?.orderStatus).toBe('ordered');
  });

  test('a resulted test cannot be moved back onto the bench', async () => {
    const order = await createLabResult(baseOrder({
      status: 'completed',
      orderStatus: 'resulted',
      result: 'Negative',
      completedAt: new Date().toISOString(),
    }));

    await expect(setLabBenchStatus(order._id, 'pending')).rejects.toThrow(/resulted/);
    await expect(setLabBenchStatus(order._id, 'in_progress')).rejects.toThrow(/resulted/);
    const stored = await getLabResultById(order._id);
    expect(stored?.status).toBe('completed');
    expect(stored?.orderStatus).toBe('resulted');
  });
});
