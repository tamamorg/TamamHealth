/**
 * The lab order's reason gate, through the REAL draft hook.
 *
 * Three things the wizard promises and nothing else was checking:
 *   - the Clinical step holds Next until there is a reason, and a symptom is a
 *     complete one — no confirmed diagnosis needed;
 *   - an order opened from a note starts with the reasons the note already has;
 *   - the "Internal comment" the form collects is actually saved. It used to
 *     live only in the draft: printed on the requisition in that session, then
 *     gone, under a label that said "Only staff see this".
 */
import { act, useEffect } from 'react';
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
import { getLabResultById } from '@/lib/services/lab-service';
import { useLabOrderDraft, type LabOrderController } from '@/components/lab/order/useLabOrderDraft';
import type { OrderIndication } from '@/components/lab/order/lab-order-types';

const FEVER: OrderIndication = { code: 'MG26', title: 'Fever of unknown origin' };
const SUSPECTED_MALARIA: OrderIndication = { code: '1A42', title: 'Malaria, unspecified' };
const FROM_NOTE: OrderIndication[] = [SUSPECTED_MALARIA];

function flush(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}

const draft: { controller: LabOrderController | null } = { controller: null };
function Harness({ presetIndications, contextText }: { presetIndications?: OrderIndication[]; contextText?: string }) {
  const controller = useLabOrderDraft({ presetPatientId: PATIENT._id, presetIndications, contextText });
  useEffect(() => { draft.controller = controller; });
  return null;
}

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  draft.controller = null;
});

afterEach(async () => {
  act(() => { root.unmount(); });
  container.remove();
  await teardownTestDBs();
  uuidCounter = 0;
});

async function mountDraft(props: Parameters<typeof Harness>[0] = {}) {
  act(() => { root.render(<Harness {...props} />); });
  await act(async () => { await flush(); });
}

it('holds the Clinical step until the order has a reason — and a symptom is enough', async () => {
  await mountDraft();
  act(() => { draft.controller!.toggleTest({ name: 'Full Blood Count', specimen: 'Blood', tier: 'basic' }); });

  expect(draft.controller!.blockersFor('clinical')).toEqual(['labOrder.errReason']);
  expect(draft.controller!.isComplete('clinical')).toBe(false);

  act(() => { draft.controller!.addIndication(FEVER); });

  expect(draft.controller!.blockersFor('clinical')).toEqual([]);
  expect(draft.controller!.isComplete('clinical')).toBe(true);
});

it('reports the reason before the order-entry answers, the order the step shows them', async () => {
  await mountDraft();
  // Glucose demands the fasting answer.
  act(() => { draft.controller!.toggleTest({ name: 'Blood Glucose', specimen: 'Blood', tier: 'basic' }); });
  expect(draft.controller!.blockersFor('clinical')).toEqual(['labOrder.errReason', 'labOrder.errAoe']);

  act(() => { draft.controller!.addIndication(FEVER); });
  expect(draft.controller!.blockersFor('clinical')).toEqual(['labOrder.errAoe']);

  act(() => { draft.controller!.setAoe('Blood Glucose', 'fasting', 'No'); });
  expect(draft.controller!.blockersFor('clinical')).toEqual([]);
});

it('starts an order opened from a note with the note’s reasons, removable', async () => {
  await mountDraft({ presetIndications: FROM_NOTE, contextText: 'Fever for three days' });

  expect(draft.controller!.draft.indications).toEqual([SUSPECTED_MALARIA]);
  expect(draft.controller!.contextText).toBe('Fever for three days');
  act(() => { draft.controller!.toggleTest({ name: 'Full Blood Count', specimen: 'Blood', tier: 'basic' }); });
  expect(draft.controller!.blockersFor('clinical')).toEqual([]);

  act(() => { draft.controller!.removeIndication('1A42'); });
  expect(draft.controller!.draft.indications).toEqual([]);
  expect(draft.controller!.blockersFor('clinical')).toEqual(['labOrder.errReason']);

  // Starting over brings back what the note said, not an empty order.
  act(() => { draft.controller!.reset(); });
  expect(draft.controller!.draft.indications).toEqual([SUSPECTED_MALARIA]);
});

it('saves the reason and the internal comment on the order the bench reads', async () => {
  await mountDraft();
  act(() => {
    draft.controller!.toggleTest({ name: 'Full Blood Count', specimen: 'Blood', tier: 'basic' });
    draft.controller!.addIndication(FEVER);
    draft.controller!.patch({ notes: 'Fever 3 days, RDT negative', comments: '  Call ext. 204 with the result  ' });
  });

  let receipt!: Awaited<ReturnType<LabOrderController['submit']>>;
  await act(async () => { receipt = await draft.controller!.submit(); });

  const order = await getLabResultById(receipt.createdIds[0]);
  expect(order?.indications).toEqual([FEVER]);
  expect(order?.clinicalNotes).toBe('Fever 3 days, RDT negative');
  expect(order?.orderComment).toBe('Call ext. 204 with the result');
});

it('writes no comment field at all when the comment is blank', async () => {
  await mountDraft();
  act(() => {
    draft.controller!.toggleTest({ name: 'Full Blood Count', specimen: 'Blood', tier: 'basic' });
    draft.controller!.addIndication(FEVER);
    draft.controller!.patch({ comments: '   ' });
  });

  let receipt!: Awaited<ReturnType<LabOrderController['submit']>>;
  await act(async () => { receipt = await draft.controller!.submit(); });

  const order = await getLabResultById(receipt.createdIds[0]);
  expect(order).not.toBeNull();
  expect(order && 'orderComment' in order && order.orderComment !== undefined).toBe(false);
});
