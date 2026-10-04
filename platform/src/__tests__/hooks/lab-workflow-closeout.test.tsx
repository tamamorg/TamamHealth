/**
 * Who may close out a lab result.
 *
 * "Reviewed by clinician", "acted upon" and "communicated to patient" are the
 * clinician's attestations. They were gated like bench work, so only a lab
 * tech could press "Mark reviewed" — recording a clinician's review that had
 * not happened — and the clinician who ordered the test could not. The patient
 * portal releases a result on that stage, so who may set it decides who can
 * put a result in front of a patient.
 */
import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let uuidCounter = 0;
jest.mock('uuid', () => ({ v4: () => `${String(++uuidCounter).padStart(8, '0')}-tuid` }));
jest.mock('@/lib/db', () => require('../helpers/test-db').createDBMock());

const CURRENT_USER = {
  _id: 'user-dr-wani', name: 'Dr. James Wani Igga', role: 'doctor' as string,
  hospitalId: 'hosp-001', hospitalName: 'Juba Teaching Hospital', orgId: 'org-moh-ss',
};
jest.mock('@/lib/context', () => ({ useAuth: () => ({ currentUser: CURRENT_USER }) }));
jest.mock('@/modules/communication/services/message-service', () => ({ createMessage: jest.fn() }));

jest.setTimeout(30000);

import { teardownTestDBs } from '../helpers/test-db';
import { createLabResult, getLabResultById } from '@/lib/services/lab-service';
import { useLabWorkflow, type LabWorkflowController } from '@/components/lab/workflow/useLabWorkflow';
import { toPortalLabResult } from '@/lib/patient-portal-labs';
import type { LabResultDoc } from '@/lib/db-types';

const flush = () => new Promise<void>(resolve => setTimeout(resolve, 0));

const harness: { controller: LabWorkflowController | null } = { controller: null };
function Harness({ order, canWork }: { order: LabResultDoc; canWork: boolean }) {
  const controller = useLabWorkflow(order, undefined, canWork);
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

const resulted = () => createLabResult({
  patientId: 'pat-00001', patientName: 'Nyakuma Deng', hospitalNumber: 'JTH-000001',
  testName: 'Malaria RDT', specimen: 'Blood', status: 'completed', orderStatus: 'resulted',
  result: 'Positive (P. falciparum)', unit: '', referenceRange: 'Negative', abnormal: true, critical: false,
  orderedBy: 'Dr. James Wani Igga', orderedById: 'user-dr-wani', orderedAt: new Date().toISOString(),
  completedAt: new Date().toISOString(), hospitalId: 'hosp-001', orgId: 'org-moh-ss',
} as never);

async function mount(order: LabResultDoc, role: string) {
  CURRENT_USER.role = role;
  // Only a lab tech can work the bench; everyone else opens the panel read-only.
  act(() => { root.render(<Harness order={order} canWork={role === 'lab_tech'} />); });
  await act(async () => { await flush(); });
}

it('lets the ordering clinician review, act on and communicate a result', async () => {
  const order = await resulted();
  await mount(order, 'doctor');
  expect(harness.controller!.canCloseOut).toBe(true);

  await act(async () => { expect(await harness.controller!.markReviewed()).toBe(true); });
  let saved = await getLabResultById(order._id);
  expect(saved?.orderStatus).toBe('reviewed_by_clinician');
  expect(saved?.reviewedBy).toBe('Dr. James Wani Igga');

  // Each hop re-reads the order, as the panel does when its data refreshes.
  await mount(saved!, 'doctor');
  await act(async () => { expect(await harness.controller!.markActedUpon()).toBe(true); });
  saved = await getLabResultById(order._id);
  await mount(saved!, 'doctor');
  await act(async () => { expect(await harness.controller!.markCommunicated()).toBe(true); });
  expect((await getLabResultById(order._id))?.orderStatus).toBe('communicated_to_patient');
});

it('does not let the bench record a clinician\'s review', async () => {
  const order = await resulted();
  await mount(order, 'lab_tech');
  expect(harness.controller!.canCloseOut).toBe(false);

  await act(async () => { expect(await harness.controller!.markReviewed()).toBe(false); });
  expect(harness.controller!.error).toBe('labFlow.closeoutClinicianOnly');
  expect((await getLabResultById(order._id))?.orderStatus).toBe('resulted');
});

it('still keeps bench work to the bench', async () => {
  const order = await resulted();
  await mount(order, 'doctor');
  await act(async () => { expect(await harness.controller!.amendResult()).toBe(false); });
  expect(harness.controller!.error).toBe('labFlow.readOnly');
});

it('a clinician\'s review is what releases the result to the patient portal', async () => {
  const order = await resulted();
  expect(toPortalLabResult((await getLabResultById(order._id))!)).toMatchObject({ status: 'pending', awaitingReview: true });

  await mount(order, 'clinical_officer');
  await act(async () => { await harness.controller!.markReviewed(); });

  expect(toPortalLabResult((await getLabResultById(order._id))!)).toMatchObject({
    status: 'completed', awaitingReview: false, result: 'Positive (P. falciparum)',
  });
});
