/**
 * What the ordering clinician told the laboratory has to be on the screen the
 * bench is working from. The workflow opens on the step that needs doing —
 * usually Collect — and the reason for the test, the notes, the internal
 * comment and the order-entry answers ("fasting: No") were one step back, on
 * Order, where nobody drawing a sample would look.
 */
import fs from 'fs';
import path from 'path';
import React from 'react';
import { mount, type Mounted } from '../clinical-notes/test-utils';

jest.mock('@/lib/i18n/useTranslation', () => {
  const map = (jest.requireActual('@/lib/i18n/locales/en') as { default: Record<string, string> }).default;
  return { useTranslation: () => ({ t: (key: string) => map[key] ?? key }) };
});

import { OrderContext } from '@/components/lab/workflow/steps/LabSteps';
import type { LabResultDoc } from '@/lib/db-types';

const order = (overrides: Partial<LabResultDoc> = {}) => ({
  _id: 'lab-1', type: 'lab_result', patientId: 'pat-1', patientName: 'Mary Akol', testName: 'Blood Glucose',
  specimen: 'Blood', status: 'pending', result: '', unit: '', referenceRange: '', abnormal: false, critical: false,
  orderedBy: 'Dr. James Wani', orderedAt: '2026-10-03T08:00:00.000Z', completedAt: '',
  ...overrides,
}) as unknown as LabResultDoc;

let mounted: Mounted | null = null;
afterEach(() => { mounted?.unmount(); mounted = null; });

describe('OrderContext', () => {
  it('shows the reason, the notes, the internal comment and the order-entry answers, each labelled', () => {
    mounted = mount(<OrderContext order={order({
      indications: [{ code: 'MG26', title: 'Fever of unknown origin' }],
      clinicalNotes: 'Fever 3 days, RDT pending',
      orderComment: 'Call ext. 204 with the result',
      aoeAnswers: [{ question: 'Was the patient fasting?', answer: 'No' }],
    })} />);
    const text = mounted.container.textContent || '';
    for (const expected of [
      'Reason for test', 'MG26', 'Fever of unknown origin',
      'Notes to the laboratory', 'Fever 3 days, RDT pending',
      'Internal comment', 'Call ext. 204 with the result',
      'Order-entry questions', 'Was the patient fasting?', 'No',
    ]) expect(text).toContain(expected);
  });

  it('renders nothing for an order that carried no context', () => {
    mounted = mount(<OrderContext order={order()} />);
    expect(mounted.container.innerHTML).toBe('');
  });

  it('shows the order-entry answers even when there is no reason or note', () => {
    mounted = mount(<OrderContext order={order({ aoeAnswers: [{ question: 'Was the patient fasting?', answer: 'Yes' }] })} />);
    expect(mounted.container.textContent).toContain('Was the patient fasting?');
    expect(mounted.container.textContent).not.toContain('Clinical context');
  });
});

describe('the lab workflow panel', () => {
  const panel = fs.readFileSync(path.join(process.cwd(), 'src/components/lab/workflow/LabWorkflowPanel.tsx'), 'utf8');

  it('carries that context onto every bench step', () => {
    expect(panel).toContain("(ctrl.step === 'collect' || ctrl.step === 'receive' || ctrl.step === 'process' || ctrl.step === 'result')");
    expect(panel).toContain('<OrderContext order={order} />');
  });
});
