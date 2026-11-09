/**
 * Correcting a filed lab result takes two lab techs.
 *
 * "Save correction" used to overwrite the filed value at once. A clinician may
 * already have acted on that value, so a correction is now only proposed: it
 * waits on the result (`pendingCorrection`) while the filed value stays what
 * every reader shows, and a SECOND lab tech, a different user from the one who
 * entered it, approves or rejects it. The patient portal never sees it.
 */
import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let uuidCounter = 0;
jest.mock('uuid', () => ({ v4: () => `${String(++uuidCounter).padStart(8, '0')}-tuid` }));
jest.mock('@/lib/db', () => require('../helpers/test-db').createDBMock());

const CURRENT_USER = {
  _id: 'user-lab-a', name: 'Achol Lab', role: 'lab_tech' as string,
  hospitalId: 'hosp-001', hospitalName: 'Juba Teaching Hospital', orgId: 'org-moh-ss',
};
jest.mock('@/lib/context', () => ({ useAuth: () => ({ currentUser: CURRENT_USER }) }));
const mockCreateMessage = jest.fn();
jest.mock('@/modules/communication/services/message-service', () => ({ createMessage: (...args: unknown[]) => mockCreateMessage(...args) }));

jest.setTimeout(30000);

import { teardownTestDBs } from '../helpers/test-db';
import { createLabResult, getLabResultById } from '@/lib/services/lab-service';
import { useLabWorkflow, type LabWorkflowController } from '@/components/lab/workflow/useLabWorkflow';
import { correctionReviewState } from '@/components/lab/workflow/lab-workflow-types';
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
  mockCreateMessage.mockReset();
});

afterEach(async () => {
  act(() => { root.unmount(); });
  container.remove();
  await teardownTestDBs();
  uuidCounter = 0;
});

const TECH_A = { _id: 'user-lab-a', name: 'Achol Lab', role: 'lab_tech' };
const TECH_B = { _id: 'user-lab-b', name: 'Ladu Lab', role: 'lab_tech' };
const DOCTOR = { _id: 'user-dr-wani', name: 'Dr. James Wani Igga', role: 'doctor' };

const filed = (over: Partial<LabResultDoc> = {}) => createLabResult({
  patientId: 'pat-00001', patientName: 'Nyakuma Deng', hospitalNumber: 'JTH-000001',
  testName: 'Malaria RDT', specimen: 'Blood', status: 'completed', orderStatus: 'resulted',
  result: 'Positive (P. falciparum)', unit: '', referenceRange: 'Negative', abnormal: true, critical: false,
  orderedBy: 'Dr. James Wani Igga', orderedById: 'user-dr-wani', orderedAt: new Date().toISOString(),
  completedAt: new Date().toISOString(), hospitalId: 'hosp-001', orgId: 'org-moh-ss',
  ...over,
} as never);

async function mountAs(user: typeof TECH_A, orderId: string) {
  Object.assign(CURRENT_USER, user);
  const order = (await getLabResultById(orderId))!;
  act(() => { root.render(<Harness key={`${user._id}-${order._rev}`} order={order} canWork={user.role === 'lab_tech'} />); });
  await act(async () => { await flush(); });
}

async function propose(orderId: string, value: string, reason: string, critical = false) {
  await mountAs(TECH_A, orderId);
  act(() => {
    harness.controller!.setResultDraft(prev => ({ ...prev, result: value, abnormal: critical, critical, criticalManual: true }));
    harness.controller!.setAmendReason(reason);
  });
  let ok = false;
  await act(async () => { ok = await harness.controller!.amendResult(); });
  return ok;
}

it('saving a correction proposes it and leaves the filed value untouched', async () => {
  const order = await filed();
  expect(await propose(order._id, 'Negative', 'Transcription error')).toBe(true);

  const saved = (await getLabResultById(order._id))!;
  expect(saved.result).toBe('Positive (P. falciparum)');
  expect(saved.amended).toBeFalsy();
  expect(saved.pendingCorrection).toMatchObject({
    result: 'Negative', reason: 'Transcription error', proposedBy: 'Achol Lab', proposedById: 'user-lab-a',
  });

  // One at a time: a second proposal would bury the first unreviewed.
  await mountAs(TECH_A, order._id);
  act(() => { harness.controller!.setAmendReason('Another go'); });
  await act(async () => { expect(await harness.controller!.amendResult()).toBe(false); });
  expect(harness.controller!.error).toBe('labFlow.errCorrectionPending');
});

it('refuses to let the proposer approve their own correction', async () => {
  const order = await filed();
  await propose(order._id, 'Negative', 'Transcription error');

  await mountAs(TECH_A, order._id);
  expect(harness.controller!.correctionReview).toBe('own');
  await act(async () => { expect(await harness.controller!.approveCorrection()).toBe(false); });
  expect(harness.controller!.error).toBe('labFlow.errOwnCorrection');
  const saved = (await getLabResultById(order._id))!;
  expect(saved.result).toBe('Positive (P. falciparum)');
  expect(saved.pendingCorrection).toBeDefined();
});

it('a second lab tech approves: the correction becomes the result with the amendment stamps', async () => {
  const order = await filed();
  await propose(order._id, 'Negative', 'Transcription error');

  await mountAs(TECH_B, order._id);
  expect(harness.controller!.correctionReview).toBe('can_review');
  await act(async () => { expect(await harness.controller!.approveCorrection()).toBe(true); });

  const saved = (await getLabResultById(order._id))!;
  expect(saved).toMatchObject({
    result: 'Negative',
    amended: true,
    amendedBy: 'Achol Lab',
    amendedFrom: 'Positive (P. falciparum)',
    amendmentReason: 'Transcription error',
    correctionVerifiedBy: 'Ladu Lab',
    correctionVerifiedById: 'user-lab-b',
  });
  expect(saved.correctionVerifiedAt).toBeTruthy();
  expect(saved.pendingCorrection).toBeUndefined();
  // Not critical: no critical-result message.
  expect(mockCreateMessage).not.toHaveBeenCalled();

  // A later correction still records the FIRST reported value.
  await propose(order._id, 'Invalid', 'Wrong cassette');
  await mountAs(TECH_B, order._id);
  await act(async () => { await harness.controller!.approveCorrection(); });
  expect((await getLabResultById(order._id))!.amendedFrom).toBe('Positive (P. falciparum)');
});

it('an approved critical correction sends the critical staff message', async () => {
  const order = await filed({ testName: 'Serum potassium', result: '4.1', unit: 'mmol/L', referenceRange: '3.5-5.1', abnormal: false });
  await propose(order._id, '6.9', 'Re-run on fresh sample', true);
  expect(mockCreateMessage).not.toHaveBeenCalled();

  await mountAs(TECH_B, order._id);
  await act(async () => { expect(await harness.controller!.approveCorrection()).toBe(true); });
  expect(mockCreateMessage).toHaveBeenCalledTimes(1);
  expect(mockCreateMessage.mock.calls[0][0]).toMatchObject({
    recipientType: 'staff',
    subject: 'CRITICAL: Serum potassium for Nyakuma Deng',
  });
  expect((await getLabResultById(order._id))!.critical).toBe(true);
});

it('a second lab tech rejects with a reason: the filed value stands and the rejection is kept', async () => {
  const order = await filed();
  await propose(order._id, 'Negative', 'Transcription error');

  await mountAs(TECH_B, order._id);
  await act(async () => { expect(await harness.controller!.rejectCorrection()).toBe(false); });
  expect(harness.controller!.error).toBe('labFlow.errCorrectionRejectReason');

  act(() => { harness.controller!.setCorrectionRejectReason('Original reading confirmed on re-check'); });
  await act(async () => { expect(await harness.controller!.rejectCorrection()).toBe(true); });

  const saved = (await getLabResultById(order._id))!;
  expect(saved.result).toBe('Positive (P. falciparum)');
  expect(saved.amended).toBeFalsy();
  expect(saved.pendingCorrection).toBeUndefined();
  expect(saved.rejectedCorrections).toHaveLength(1);
  expect(saved.rejectedCorrections![0]).toMatchObject({
    result: 'Negative', proposedById: 'user-lab-a', rejectedBy: 'Ladu Lab', rejectedById: 'user-lab-b',
    rejectionReason: 'Original reading confirmed on re-check',
  });
});

// Audit 2026-11-08: one lab tech on shift could leave a correction pending
// for good, blocking every later one.
it('the proposer can withdraw their own correction; a second tech cannot withdraw it', async () => {
  const order = await filed();
  await propose(order._id, 'Negative', 'Transcription error');

  await mountAs(TECH_B, order._id);
  act(() => { harness.controller!.setCorrectionRejectReason('Not mine to withdraw'); });
  await act(async () => { expect(await harness.controller!.withdrawCorrection()).toBe(false); });
  expect((await getLabResultById(order._id))!.pendingCorrection).toBeDefined();

  await mountAs(TECH_A, order._id);
  await act(async () => { expect(await harness.controller!.withdrawCorrection()).toBe(false); });
  expect(harness.controller!.error).toBe('labFlow.errCorrectionWithdrawReason');
  act(() => { harness.controller!.setCorrectionRejectReason('Entered against the wrong patient'); });
  await act(async () => { expect(await harness.controller!.withdrawCorrection()).toBe(true); });

  const saved = (await getLabResultById(order._id))!;
  expect(saved.result).toBe('Positive (P. falciparum)');
  expect(saved.pendingCorrection).toBeUndefined();
  expect(saved.rejectedCorrections![0]).toMatchObject({
    result: 'Negative', proposedById: 'user-lab-a', rejectedById: 'user-lab-a', withdrawn: true,
    rejectionReason: 'Entered against the wrong patient',
  });
});

it('a clinician sees the correction but cannot approve it', async () => {
  const order = await filed();
  await propose(order._id, 'Negative', 'Transcription error');

  await mountAs(DOCTOR, order._id);
  expect(harness.controller!.correctionReview).toBe('view');
  await act(async () => { expect(await harness.controller!.approveCorrection()).toBe(false); });
  expect((await getLabResultById(order._id))!.pendingCorrection).toBeDefined();
});

it('never puts the pending value in front of the patient', async () => {
  const order = await filed({ orderStatus: 'communicated_to_patient' });
  await propose(order._id, 'Negative', 'Transcription error');
  const portal = toPortalLabResult((await getLabResultById(order._id))!);
  // Held back while the correction is undecided: neither value reaches the patient.
  expect(portal.result).toBeUndefined();
  expect(JSON.stringify(portal)).not.toMatch(/Transcription|pendingCorrection|Achol|Negative|falciparum/);
});

describe('correctionReviewState', () => {
  const pending = { pendingCorrection: { proposedById: 'user-lab-a' } };
  it('compares by user id', () => {
    expect(correctionReviewState({}, TECH_B)).toBe('none');
    expect(correctionReviewState(pending, TECH_A)).toBe('own');
    expect(correctionReviewState(pending, { _id: 'user-lab-c', role: 'lab_tech' })).toBe('can_review');
    expect(correctionReviewState(pending, TECH_B, false)).toBe('view');
    expect(correctionReviewState(pending, DOCTOR)).toBe('view');
    expect(correctionReviewState(pending, { role: 'lab_tech' })).toBe('view');
  });
});

describe('amending a filed critical result', () => {
  const criticalHemoglobin = () => filed({
    testName: 'Hemoglobin', result: '4.2', unit: 'g/dL', referenceRange: '12.0-16.0',
    abnormal: true, critical: true,
  });

  it('re-derives the critical flag when the corrected value is no longer critical', async () => {
    const order = await criticalHemoglobin();
    await mountAs(TECH_A, order._id);
    expect(harness.controller!.resultDraft.critical).toBe(true);
    act(() => { harness.controller!.setResultValue('12.4'); });
    // Frozen on "critical" before the fix: a false critical alert then went out
    // when the correction was approved.
    expect(harness.controller!.resultDraft.critical).toBe(false);
    expect(harness.controller!.resultDraft.criticalManual).toBe(false);
  });

  it('keeps a hand-set critical flag on a value the table does not call critical', async () => {
    const order = await filed({ testName: 'Malaria RDT', result: 'Positive (P. falciparum)', abnormal: true, critical: true });
    await mountAs(TECH_A, order._id);
    expect(harness.controller!.resultDraft.criticalManual).toBe(true);
    act(() => { harness.controller!.setResultValue('Positive (mixed)'); });
    expect(harness.controller!.resultDraft.critical).toBe(true);
  });
});

it('never sends a pending correction to the patient portal', async () => {
  const order = await filed({ orderStatus: 'reviewed_by_clinician' });
  await propose(order._id, 'Negative', 'Transcription error');
  const saved = (await getLabResultById(order._id))!;
  const portal = toPortalLabResult(saved);
  // Reviewed, but a correction is pending: the patient waits for the decision.
  expect(portal.result).toBeUndefined();
  expect(portal.awaitingReview).toBe(true);
  expect(JSON.stringify(portal)).not.toMatch(/pendingCorrection|Transcription error|Negative/);
});
