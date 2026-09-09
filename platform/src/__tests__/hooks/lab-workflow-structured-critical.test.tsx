/**
 * `useLabWorkflow`'s live critical-value verdict used to be wired only to the
 * plain single-value result field (`evaluateCritical(order.testName,
 * resultDraft.result)`). Any test that resolves to a STRUCTURED result
 * profile in `lab-result-catalog.ts` — Full Blood Count, chemistry panels,
 * Urinalysis, Stool — writes its analytes into `resultDraft.observations`
 * instead, which that call never saw. Every DEFAULT_CRITICAL_VALUES analyte
 * (Hemoglobin, WBC, Platelets, Glucose, Potassium, Sodium, Calcium,
 * Creatinine) lives inside one of those panels, so the automatic flag was
 * dead code for exactly the tests it most needed to cover — only the manual
 * "Critical" checkbox worked.
 *
 * This drives the real hook (not just the pure `evaluateCriticalObservations`
 * matcher, which lab-critical-flag.test.ts covers) through a Full Blood Count
 * order: entering a critically low Hemoglobin must flag the live verdict,
 * default the critical checkbox on without being touched, and file with
 * `critical: true` on the persisted document — raising the same
 * critical-result task a plain critical value does.
 */
import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let uuidCounter = 0;
jest.mock('uuid', () => ({ v4: () => `${String(++uuidCounter).padStart(8, '0')}-tuid` }));
jest.mock('@/lib/db', () => require('../helpers/test-db').createDBMock());

const CURRENT_USER = {
  _id: 'user-dr-wani', name: 'Dr. James Wani Igga', role: 'lab_technician' as const,
  hospitalId: 'hosp-001', hospitalName: 'Juba Teaching Hospital', orgId: 'org-moh-ss',
};
jest.mock('@/lib/context', () => ({ useAuth: () => ({ currentUser: CURRENT_USER }) }));
jest.mock('@/modules/communication/services/message-service', () => ({ createMessage: jest.fn() }));

import { teardownTestDBs } from '../helpers/test-db';
import { createLabResult, getLabResultById } from '@/lib/services/lab-service';
import { getTasks } from '@/lib/services/clinician-task-service';
import { useLabWorkflow, type LabWorkflowController } from '@/components/lab/workflow/useLabWorkflow';
import type { LabResultDoc } from '@/lib/db-types';

function flush(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}

const harness: { controller: LabWorkflowController | null } = { controller: null };
function Harness({ order }: { order: LabResultDoc }) {
  const controller = useLabWorkflow(order);
  useEffect(() => { harness.controller = controller; });
  return null;
}

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  harness.controller = null;
});

afterEach(async () => {
  act(() => { root.unmount(); });
  container.remove();
  await teardownTestDBs();
  uuidCounter = 0;
});

function baseFbcOrder(overrides: Partial<LabResultDoc> = {}) {
  return {
    patientId: 'pat-00001',
    patientName: 'Nyakuma Deng',
    hospitalNumber: 'JTH-000001',
    testName: 'Full Blood Count',
    specimen: 'Blood',
    status: 'pending' as const,
    result: '',
    unit: '',
    referenceRange: '',
    abnormal: false,
    critical: false,
    orderedBy: CURRENT_USER.name,
    orderedById: CURRENT_USER._id,
    orderedAt: new Date().toISOString(),
    completedAt: '',
    hospitalId: CURRENT_USER.hospitalId,
    orgId: CURRENT_USER.orgId,
    ...overrides,
  };
}

it('flags a critically low Hemoglobin entered into a Full Blood Count panel and files with the flag', async () => {
  const order = await createLabResult(baseFbcOrder() as never);

  act(() => { root.render(<Harness order={order} />); });
  await act(async () => { await flush(); });

  // Before anything is entered, nothing is critical.
  expect(harness.controller!.criticalVerdict.isCriticalValue).toBe(false);

  // 4.1 g/dL is well under the Hemoglobin critical-low cutoff of 5.
  act(() => { harness.controller!.setObservationValue('cbc.hemoglobin', '4.1'); });

  expect(harness.controller!.criticalVerdict.isCriticalValue).toBe(true);
  expect(harness.controller!.criticalVerdict.hits).toHaveLength(1);
  expect(harness.controller!.criticalVerdict.hits[0].label).toBe('Hemoglobin');
  expect(harness.controller!.criticalVerdict.hits[0].comparison).toBe('≤ 5');
  // The checkbox reflects the derived flag without the tech touching it.
  expect(harness.controller!.resultDraft.critical).toBe(true);
  expect(harness.controller!.resultDraft.criticalManual).toBe(false);

  // Walk the specimen through to the bench, same as a real filing.
  await act(async () => { await harness.controller!.collect(); });
  await act(async () => { await harness.controller!.receive(); });
  await act(async () => { await harness.controller!.startProcessing(); });
  await act(async () => { await harness.controller!.fileResult(); });

  const filed = await getLabResultById(order._id);
  expect(filed?.critical).toBe(true);
  expect(filed?.orderStatus).toBe('resulted');
  expect(filed?.observations?.some(o => o.id === 'cbc.hemoglobin' && o.value === '4.1')).toBe(true);

  // The same critical-result task a plain critical value raises.
  const tasks = await getTasks(CURRENT_USER._id);
  expect(tasks).toHaveLength(1);
  expect(tasks[0].title).toContain('Critical result: Full Blood Count');
});

it('adding a second, normal analyte does not clear a critical flag already raised', async () => {
  const order = await createLabResult(baseFbcOrder() as never);
  act(() => { root.render(<Harness order={order} />); });
  await act(async () => { await flush(); });

  act(() => { harness.controller!.setObservationValue('cbc.hemoglobin', '4.1'); });
  act(() => { harness.controller!.setObservationValue('cbc.platelets', '250'); });

  expect(harness.controller!.criticalVerdict.isCriticalValue).toBe(true);
  expect(harness.controller!.resultDraft.critical).toBe(true);
});

it('a manual override to NOT critical survives further structured edits', async () => {
  const order = await createLabResult(baseFbcOrder() as never);
  act(() => { root.render(<Harness order={order} />); });
  await act(async () => { await flush(); });

  act(() => { harness.controller!.setObservationValue('cbc.hemoglobin', '4.1'); });
  expect(harness.controller!.resultDraft.critical).toBe(true);

  // The tech reviews and manually un-flags it (e.g. a known bad draw being repeated).
  act(() => {
    harness.controller!.setResultDraft({ ...harness.controller!.resultDraft, critical: false, criticalManual: true });
  });
  expect(harness.controller!.resultDraft.critical).toBe(false);

  // Further edits do not silently re-derive over the manual override.
  act(() => { harness.controller!.setObservationValue('cbc.wbc', '0.5'); });
  expect(harness.controller!.resultDraft.critical).toBe(false);
  // The live QC verdict itself is unaffected by the override — it still
  // reports the truth so the UI can show it alongside the overridden checkbox.
  expect(harness.controller!.criticalVerdict.isCriticalValue).toBe(true);
});
