/**
 * Every status pill opens a slider before it acts — the HR, inquiry and issue
 * lists through RowStatusSelect, the same as the visit pills on the
 * dashboards (StatusChangeSlider). A pick must not reach `onSelect` until the
 * slider's confirm; Cancel must leave the row as it was.
 */
import React from 'react';
import { act, click, flush, mountAndFlush, qa, type Mounted } from './clinical-notes/test-utils';

jest.mock('@/lib/i18n/useTranslation', () => {
  const map = (jest.requireActual('@/lib/i18n/locales/en') as { default: Record<string, string> }).default;
  return { useTranslation: () => ({ t: (key: string, vars?: Record<string, string>) => (map[key] ?? key).replace(/{{(\w+)}}/g, (_, k) => vars?.[k] ?? '') }) };
});
jest.mock('@/components/Modal', () => ({ __esModule: true, default: ({ children }: { children: React.ReactNode }) => <div data-testid="slider">{children}</div> }));

import RowStatusSelect from '@/components/ehr/RowStatusSelect';

let mounted: Mounted | null = null;
afterEach(() => { mounted?.unmount(); mounted = null; });

async function pick(onSelect: jest.Mock) {
  mounted = await mountAndFlush(
    <RowStatusSelect
      label="Pending"
      value="pending"
      ariaLabel="Leave status for Achol"
      subject="Achol Deng"
      options={[{ value: 'approved', label: 'Approve' }, { value: 'rejected', label: 'Reject' }]}
      onSelect={onSelect}
    />,
  );
  const select = mounted.container.querySelector('select')!;
  await act(async () => {
    select.value = 'approved';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await flush();
  });
}

const button = (text: string) => qa<HTMLButtonElement>(mounted!.container, 'button').find(b => b.textContent?.includes(text))!;

describe('RowStatusSelect confirms in a slider', () => {
  it('opens the slider on a pick and does not act yet', async () => {
    const onSelect = jest.fn();
    await pick(onSelect);
    expect(mounted!.container.textContent).toContain('Change status');
    expect(mounted!.container.textContent).toContain('Achol Deng');
    expect(mounted!.container.textContent).toContain('Pending');
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('acts on confirm, once, with the picked value', async () => {
    const onSelect = jest.fn();
    await pick(onSelect);
    await act(async () => { click(button('Set to Approve')); await flush(); });
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith('approved');
    expect(mounted!.container.textContent).not.toContain('Change status');
  });

  it('does nothing on cancel', async () => {
    const onSelect = jest.fn();
    await pick(onSelect);
    await act(async () => { click(button('Cancel')); await flush(); });
    expect(onSelect).not.toHaveBeenCalled();
    expect(mounted!.container.textContent).not.toContain('Change status');
  });
});
