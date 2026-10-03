/**
 * The "Reason for test" block a clinician actually sees.
 *
 * A reviewer read the old "Diagnosis" step as demanding a confirmed diagnosis
 * before the test that would establish one — and the form gave them every
 * reason to: the label said Diagnosis and the tick-grid offered only notifiable
 * diseases. Rendered here with the real English copy, the picker must say a
 * symptom is enough, lead with symptoms, keep diseases behind "suspected", and
 * say who the form is for.
 */
import React, { act } from 'react';
import en from '@/lib/i18n/locales/en';
import { mount, type Mounted } from '../clinical-notes/test-utils';

jest.mock('@/lib/i18n/useTranslation', () => {
  const map = (jest.requireActual('@/lib/i18n/locales/en') as { default: Record<string, string> }).default;
  return {
    useTranslation: () => ({
      t: (key: string, vars: Record<string, string | number> = {}) =>
        (map[key] ?? key).replace(/\{\{(\w+)\}\}/g, (_: string, name: string) => String(vars[name] ?? '')),
    }),
  };
});
jest.mock('@/components/lab/order/useVisitComplaint', () => ({ useVisitComplaint: () => '' }));

import LabOrderReasonPicker from '@/components/lab/order/LabOrderReasonPicker';
import LabOrderStepper from '@/components/lab/order/LabOrderStepper';
import LabOrderSidebar from '@/components/lab/order/LabOrderSidebar';
import { emptyLabOrderDraft, type LabOrderDraft, type OrderIndication } from '@/components/lab/order/lab-order-types';
import type { LabOrderController } from '@/components/lab/order/useLabOrderDraft';

const addIndication = jest.fn();
const removeIndication = jest.fn();

function controllerWith(overrides: { indications?: OrderIndication[]; contextText?: string; chronicConditions?: string[] } = {}) {
  const draft: LabOrderDraft = { ...emptyLabOrderDraft('Dr. Wani'), patientId: 'pat-1', indications: overrides.indications || [] };
  return {
    draft,
    patient: { _id: 'pat-1', chronicConditions: overrides.chronicConditions || [] },
    addIndication,
    removeIndication,
    contextText: overrides.contextText || '',
  } as unknown as LabOrderController;
}

let mounted: Mounted | null = null;
const render = (ui: React.ReactElement) => { mounted = mount(ui); return mounted.container; };
const buttonWith = (container: HTMLElement, text: string) =>
  Array.from(container.querySelectorAll('button')).find(button => button.textContent?.includes(text));
const groupLabels = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('.labord-reason-group > .labord-field-label')).map(el => el.textContent);

beforeEach(() => { jest.clearAllMocks(); });
afterEach(() => { mounted?.unmount(); mounted = null; });

describe('the reason picker', () => {
  it('asks for a reason and says a confirmed diagnosis is not required', () => {
    const container = render(<LabOrderReasonPicker controller={controllerWith()} />);
    expect(container.querySelector('.labord-section-head')?.textContent).toContain('Reason for test');
    expect(container.textContent).toContain('A symptom or a suspected condition is enough — a confirmed diagnosis is not required.');
    expect(container.textContent).not.toMatch(/\bDiagnos[ie]s\b/);
    // Empty is flagged the way the Next button will judge it.
    expect(container.textContent).toContain('Add at least one reason');
    expect(container.textContent).toContain(en['labOrder.noReasonYet']);
  });

  it('leads with symptoms and the no-symptom reasons; diseases stay behind "Show more"', () => {
    const container = render(<LabOrderReasonPicker controller={controllerWith()} />);
    expect(groupLabels(container)).toEqual(['On this order', 'Symptoms and signs', 'No symptoms: screening or follow-up']);
    expect(buttonWith(container, 'Cough')).toBeDefined();
    expect(buttonWith(container, 'QA00')).toBeDefined();
    expect(buttonWith(container, 'Cholera')).toBeUndefined();

    act(() => { buttonWith(container, 'Show more reasons')!.click(); });

    expect(groupLabels(container)).toContain('Suspected conditions (not yet confirmed)');
    expect(buttonWith(container, 'Cholera')).toBeDefined();
  });

  it('adds a symptom as a coded reason in one tick', () => {
    const container = render(<LabOrderReasonPicker controller={controllerWith()} />);
    act(() => { buttonWith(container, 'Cough')!.click(); });
    expect(addIndication).toHaveBeenCalledWith({ code: 'MD12', title: 'Cough' });
  });

  it('offers what the visit already says first, un-ticked', () => {
    const container = render(
      <LabOrderReasonPicker controller={controllerWith({ contextText: 'Fever and headache for 3 days' })} />,
    );
    expect(groupLabels(container)[1]).toBe('From this visit');
    const firstGroup = container.querySelectorAll('.labord-reason-group')[1];
    const offered = Array.from(firstGroup.querySelectorAll('button'));
    expect(offered.map(button => button.querySelector('code')?.textContent)).toEqual(['MG26', 'MB4D']);
    expect(offered.every(button => button.getAttribute('aria-pressed') === 'false')).toBe(true);
    // Offered once: the same symptom is not repeated in the general list.
    expect(Array.from(container.querySelectorAll('button code')).filter(el => el.textContent === 'MG26')).toHaveLength(1);
  });

  it('shows what is on the order and removes it from there', () => {
    const fever = { code: 'MG26', title: 'Fever of unknown origin' };
    const container = render(<LabOrderReasonPicker controller={controllerWith({ indications: [fever] })} />);
    expect(container.textContent).not.toContain('Add at least one reason');
    const chip = container.querySelector('.labord-chip')!;
    expect(chip.textContent).toContain('MG26');
    act(() => { chip.querySelector('button')!.click(); });
    expect(removeIndication).toHaveBeenCalledWith('MG26');
    // Ticked in the grid too, so un-ticking there works the same way.
    expect(buttonWith(container, 'Fever of unknown origin')?.getAttribute('aria-pressed')).toBe('true');
  });
});

describe('the wizard chrome', () => {
  it('has five steps and none of them is Diagnosis', () => {
    const container = render(<LabOrderStepper current="clinical" reachable={() => true} onJump={() => {}} />);
    expect(Array.from(container.querySelectorAll('.labord-step')).map(el => el.textContent)).toEqual([
      'Patient', 'Tests', 'Clinical', 'Review', 'Complete',
    ]);
  });

  it('lists the tests first in the rail, then the reason for them', () => {
    const draft: LabOrderDraft = { ...emptyLabOrderDraft('Dr. Wani'), patientId: 'pat-1' };
    const container = render(<LabOrderSidebar draft={draft} />);
    expect(Array.from(container.querySelectorAll('h4')).map(el => el.textContent)).toEqual([
      'Tests', 'Reason for test', 'Comments',
    ]);
  });
});
