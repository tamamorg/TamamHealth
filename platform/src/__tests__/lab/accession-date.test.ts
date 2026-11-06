/** Accession numbers carry the clinical (Juba) day, not the UTC date. */
jest.mock('uuid', () => ({ v4: () => 'abcde-0000' }));
jest.mock('@/lib/db', () => require('../helpers/test-db').createDBMock());

import { teardownTestDBs } from '../helpers/test-db';
import { accessionDay } from '@/lib/accession-date';
import { createLabResult } from '@/lib/services/lab-service';
import { fallbackAccessionNumber } from '@/components/lab/workflow/lab-workflow-types';
import { fallbackAccessionNumber as imgFallback } from '@/components/radiology/workflow/radiology-workflow-types';

afterEach(async () => { await teardownTestDBs(); jest.useRealTimers(); });

describe('accessionDay', () => {
  test('22:00-24:00 UTC is already the next day in Juba', () => {
    expect(accessionDay('2026-11-05T21:59:00Z')).toBe('261105');
    expect(accessionDay('2026-11-05T22:00:00Z')).toBe('261106');
    expect(accessionDay('2026-11-05T23:30:00Z')).toBe('261106');
  });
  test('rolls over month and year', () => {
    expect(accessionDay('2026-12-31T22:30:00Z')).toBe('270101');
  });
  test('an unreadable date falls back to now rather than NaN', () => {
    expect(accessionDay('not a date')).toMatch(/^\d{6}$/);
  });
});

describe('every accession path agrees', () => {
  const late = '2026-11-05T22:30:00Z';
  test('new orders are stamped on the Juba day', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'queueMicrotask'] }).setSystemTime(new Date(late));
    const o = await createLabResult({
      patientId: 'p', patientName: 'P', hospitalNumber: 'H', testName: 'FBC', specimen: 'Blood', status: 'pending',
      result: '', unit: '', referenceRange: '', abnormal: false, critical: false, orderedBy: 'D', orderedAt: late,
      completedAt: '', hospitalId: 'h', orgId: 'o',
    } as never);
    expect(o.accessionNumber).toMatch(/^ACC-261106-/);
  });
  test('fallbacks for orders without one use the same day; stored numbers are untouched', () => {
    expect(fallbackAccessionNumber({ _id: 'lab-abcdef', orderedAt: late })).toBe('ACC-261106-ABCDE');
    expect(imgFallback({ _id: 'lab-abcdef', orderedAt: late })).toBe('IMG-261106-ABCDE');
    expect(fallbackAccessionNumber({ _id: 'lab-abcdef', orderedAt: late, accessionNumber: 'ACC-261105-001' })).toBe('ACC-261105-001');
  });
});
