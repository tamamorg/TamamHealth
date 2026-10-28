/**
 * Record vitals slides in from the right as a dialog: vitals then biometrics,
 * blood pressure as one tile, BMI worked out as weight and height are typed,
 * Escape closes it, the chart beside it is not covered, and Save writes one
 * nursing vitals record.
 */
import React from 'react';
import { act, click, flush, mountAndFlush, setValue, type Mounted } from '../clinical-notes/test-utils';

jest.mock('@/lib/i18n/useTranslation', () => {
  const map = (jest.requireActual('@/lib/i18n/locales/en') as { default: Record<string, string> }).default;
  const t = (key: string, vars?: Record<string, unknown>) =>
    (map[key] ?? key).replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(vars?.[name] ?? ''));
  return { useTranslation: () => ({ t }) };
});
const showToast = jest.fn();
const TOAST = { showToast };
jest.mock('@/components/Toast', () => ({ useToast: () => TOAST }));
const push = jest.fn();
const ROUTER = { push };
jest.mock('next/navigation', () => ({ useRouter: () => ROUTER }));
const recordNursingVitals = jest.fn(async () => ({}));
jest.mock('@/lib/services/medical-record-service', () => ({ recordNursingVitals: (...args: unknown[]) => recordNursingVitals(...(args as [])) }));

import NurseVitalsModal from '@/components/nurse/NurseVitalsModal';

let mounted: Mounted;
const onClose = jest.fn();
const onSaved = jest.fn();

async function open() {
  mounted = await mountAndFlush(
    <NurseVitalsModal
      patientId="p1" patientName="Deng Garang" hospitalNumber="JTH-1" hospitalId="h1" orgId="o1"
      currentUser={{ _id: 'u1', name: 'Nurse Stella' }} onClose={onClose} onSaved={onSaved}
    />,
  );
}
const panel = () => document.body.querySelector('.nv-panel') as HTMLElement;
const input = (label: string) => panel().querySelector(`input[aria-label="${label}"]`) as HTMLInputElement;

afterEach(() => { act(() => mounted?.unmount()); jest.clearAllMocks(); });

it('opens as a right-hand dialog with vitals, then biometrics', async () => {
  await open();
  expect(panel().getAttribute('role')).toBe('dialog');
  expect(panel().textContent).toContain('Record vitals and biometrics');
  const headings = Array.from(panel().querySelectorAll('h3')).map(h => h.textContent);
  expect(headings).toEqual(['Record vitals', 'Record biometrics', 'More measurements']);
  // Blood pressure is one tile holding both numbers.
  const bp = input('Systolic blood pressure').closest('.nv-tile');
  expect(bp?.querySelector('input[aria-label="Diastolic blood pressure"]')).not.toBeNull();
});

it('works out BMI from weight and height', async () => {
  await open();
  await act(async () => { setValue(input('Weight'), '70'); setValue(input('Height'), '175'); await flush(); });
  expect(panel().querySelector('.nv-tile--readonly')?.textContent).toContain('22.9');
});

it('docks beside the chart instead of covering it', async () => {
  await open();
  expect(document.body.querySelector('.nv-backdrop')).toBeNull();
  expect(panel().getAttribute('aria-modal')).toBe('false');
});

it('closes on Escape', async () => {
  await open();
  await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); await flush(); });
  expect(onClose).toHaveBeenCalled();
});

it('saves the reading and closes', async () => {
  await open();
  await act(async () => { setValue(input('Temperature'), '37.2'); setValue(input('Heart rate'), '88'); await flush(); });
  const save = Array.from(panel().querySelectorAll('button')).find(b => b.textContent?.includes('Save and close'))!;
  await act(async () => { click(save); await flush(); await flush(); });
  expect(recordNursingVitals).toHaveBeenCalledWith(expect.objectContaining({
    patientId: 'p1',
    vitals: expect.objectContaining({ temperature: '37.2', pulse: '88' }),
  }));
  expect(onSaved).toHaveBeenCalled();
  expect(onClose).toHaveBeenCalled();
});
