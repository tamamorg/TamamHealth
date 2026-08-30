/**
 * End-to-end through the REAL hooks (KAN-100 audit item 1): the production
 * ordering path (`useLabOrderDraft`) is exactly what a clinician's browser
 * runs, and it never wrote the created lab ids back onto the encounter —
 * every prior test of this loop called `appendLabOrderIds` itself, which is
 * how the bug hid. Placing an order through the real hook must leave
 * `encounter.labOrderIds` populated, and `useResumableEncounters` must then
 * count it — including the fallback for an order that names the encounter
 * (`LabResultDoc.encounterId`) without ever appearing in `labOrderIds` at all
 * (a side-channel order, or one placed before this fix existed).
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let uuidCounter = 0;
jest.mock('uuid', () => ({ v4: () => `${String(++uuidCounter).padStart(8, '0')}-tuid` }));
jest.mock('@/lib/db', () => require('../helpers/test-db').createDBMock());

const CURRENT_USER = {
  _id: 'user-dr-wani', name: 'Dr. Wani', role: 'doctor' as const,
  hospitalId: 'hosp-001', hospitalName: 'Juba Teaching Hospital', orgId: 'org-moh-ss',
};
jest.mock('@/lib/context', () => ({ useAuth: () => ({ currentUser: CURRENT_USER }) }));

const PATIENT = {
  _id: 'pat-00001', firstName: 'Nyakuma', surname: 'Deng', gender: 'female',
  dateOfBirth: '1990-01-01', hospitalNumber: 'HN-001', registrationHospital: 'hosp-001',
};
jest.mock('@/lib/hooks/usePatients', () => ({ usePatients: () => ({ patients: [PATIENT], loading: false }) }));

jest.setTimeout(30000);

import { teardownTestDBs } from '../helpers/test-db';
import { getEncounter } from '@/lib/services/encounter-service';
import { useLabOrderDraft, type LabOrderController } from '@/components/lab/order/useLabOrderDraft';
import { useResumableEncounters } from '@/lib/hooks/useResumableEncounters';

function flush(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}

/**
 * Poll until `check()` is true, one macrotask tick at a time, each wrapped in
 * its own `act()`. `useResumableEncounters` does its real work (Mango index
 * creation + find, on the FIRST call for a given field set in this process)
 * inside a `useEffect`, and that chain needs many more than one or two ticks
 * to settle — a single `flush()` is enough for a directly-awaited call (like
 * `submit()` below) but not for state updates driven by an effect the test
 * can only observe from the outside.
 */
async function settle(check: () => boolean, maxTicks = 100): Promise<void> {
  for (let i = 0; i < maxTicks; i++) {
    if (check()) return;
    await act(async () => { await flush(); });
  }
}

let draftController: LabOrderController | null = null;
function DraftHarness() {
  draftController = useLabOrderDraft({ presetPatientId: PATIENT._id });
  return null;
}

let resumableState: ReturnType<typeof useResumableEncounters> | null = null;
function ResumableHarness() {
  resumableState = useResumableEncounters();
  return null;
}

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  draftController = null;
  resumableState = null;
});

afterEach(async () => {
  act(() => { root.unmount(); });
  container.remove();
  await teardownTestDBs();
  uuidCounter = 0;
});

it('the production ordering path writes the created lab ids back onto the encounter', async () => {
  act(() => { root.render(<DraftHarness />); });
  await act(async () => { await flush(); });

  act(() => {
    draftController!.toggleTest({ name: 'Creatinine', specimen: 'blood', tier: 'basic' });
  });

  let receipt!: Awaited<ReturnType<LabOrderController['submit']>>;
  await act(async () => {
    receipt = await draftController!.submit();
  });

  expect(receipt.encounterId).toBeTruthy();
  expect(receipt.createdIds).toHaveLength(1);

  const encounter = await getEncounter(receipt.encounterId!);
  expect(encounter?.labOrderIds).toEqual(receipt.createdIds);
});

it('useResumableEncounters counts an order placed through the wizard', async () => {
  act(() => { root.render(<DraftHarness />); });
  await act(async () => { await flush(); });
  act(() => {
    draftController!.toggleTest({ name: 'Creatinine', specimen: 'blood', tier: 'basic' });
  });
  let receipt!: Awaited<ReturnType<LabOrderController['submit']>>;
  await act(async () => { receipt = await draftController!.submit(); });

  act(() => { root.render(<ResumableHarness />); });
  await settle(() => resumableState !== null && !resumableState.loading);

  const resumed = resumableState!.encounters.find(e => e._id === receipt.encounterId);
  expect(resumed).toBeDefined();
  expect(resumed!.resultsTotal).toBe(1);
  expect(resumed!.resultsReady).toBe(0);
  expect(resumed!.allResultsBack).toBe(false);
});

it('falls back to LabResultDoc.encounterId for an order that never wrote back to labOrderIds', async () => {
  const { ensureLabOrderEncounter } = await import('@/lib/services/encounter-service');
  const { createLabResult } = await import('@/lib/services/lab-service');
  const encounter = await ensureLabOrderEncounter({
    patientId: PATIENT._id, patientName: 'Nyakuma Deng', hospitalId: 'hosp-001',
    orgId: 'org-moh-ss', clinicianId: CURRENT_USER._id, clinicianName: CURRENT_USER.name,
  });
  // Sanity: this is the legacy shape the fallback exists for — labOrderIds
  // was never populated.
  expect(encounter.labOrderIds).toEqual([]);
  await createLabResult({
    patientId: PATIENT._id, patientName: 'Nyakuma Deng', encounterId: encounter._id,
    testName: 'Malaria RDT', status: 'completed', result: 'Negative', unit: '',
    referenceRange: '', abnormal: false, critical: false,
    orderedBy: CURRENT_USER.name, orderedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(), hospitalId: 'hosp-001', orgId: 'org-moh-ss',
  } as never);

  act(() => { root.render(<ResumableHarness />); });
  await settle(() => resumableState !== null && !resumableState.loading);

  const resumed = resumableState!.encounters.find(e => e._id === encounter._id);
  expect(resumed).toBeDefined();
  expect(resumed!.resultsTotal).toBe(1);
  expect(resumed!.resultsReady).toBe(1);
  expect(resumed!.allResultsBack).toBe(true);
});
