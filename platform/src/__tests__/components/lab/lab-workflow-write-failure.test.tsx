/**
 * A lab write that is refused (conflict or validator rejection) throws from
 * the service. The bench workflow must surface the error, stay on the same
 * step, and report failure so the panel never shows a success toast.
 */
import React, { useEffect } from 'react';
import { act, flush, mount, type Mounted } from '../clinical-notes/test-utils';

const advance = jest.fn();
jest.mock('@/lib/hooks/useLabResults', () => ({ useLabResults: () => ({ advance, update: jest.fn() }) }));
jest.mock('@/lib/context', () => ({ useAuth: () => ({ currentUser: { _id: 'u1', name: 'Tech', role: 'lab_tech' } }) }));
jest.mock('@/lib/hooks/usePermissions', () => ({ usePermissions: () => ({ can: () => true, canAny: () => true }) }));

import { useLabWorkflow, type LabWorkflowController } from '@/components/lab/workflow/useLabWorkflow';
import type { LabResultDoc } from '@/lib/db-types';

const order = {
  _id: 'lab-1', type: 'lab_result', patientId: 'pat-1', patientName: 'Mary Akol', testName: 'Blood Glucose',
  specimen: 'Blood', status: 'pending', orderStatus: 'ordered', result: '', unit: '', referenceRange: '',
  abnormal: false, critical: false, orderedBy: 'Dr. Wani', orderedAt: '2026-10-03T08:00:00.000Z', completedAt: '',
} as unknown as LabResultDoc;

const harness: { c: LabWorkflowController | null } = { c: null };
function Harness() {
  const c = useLabWorkflow(order, undefined, true);
  useEffect(() => { harness.c = c; });
  return null;
}

let mounted: Mounted | null = null;
afterEach(() => { mounted?.unmount(); mounted = null; jest.clearAllMocks(); });

it('reports failure and keeps the stage when advanceLabOrder throws a conflict', async () => {
  advance.mockRejectedValue(new Error('Lab order was changed by someone else'));
  jest.spyOn(console, 'error').mockImplementation(() => {});
  mounted = mount(<Harness />);
  await act(async () => { await flush(); });
  const stageBefore = harness.c!.stage;

  let ok: unknown;
  await act(async () => { ok = await harness.c!.collect(); await flush(); });

  expect(advance).toHaveBeenCalledTimes(1);
  expect(ok).toBe(false);
  expect(harness.c!.error).toBe('Lab order was changed by someone else');
  expect(harness.c!.stage).toBe(stageBefore);
  expect(harness.c!.busy).toBe(false);
});
