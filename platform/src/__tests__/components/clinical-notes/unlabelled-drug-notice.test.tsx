/**
 * The notice shown on a medicine the US label standard does not cover, and the
 * flag it files. The flag must reach the Issues queue without a patient in it.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const createIssueReport = jest.fn().mockResolvedValue({});
jest.mock('@/modules/communication/services/issue-report-service', () => ({ createIssueReport }));
jest.mock('@/lib/context', () => ({
  useAuth: () => ({ currentUser: { _id: 'user-dr-wani', name: 'Dr. Wani', role: 'doctor', hospitalId: 'hosp-001', hospitalName: 'Juba', orgId: 'org-1' } }),
}));
jest.mock('@/lib/i18n/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string, p?: Record<string, string>) => `${key}${p?.name ? `:${p.name}` : ''}${p?.role ? `:${p.role}` : ''}` }),
}));

import UnlabelledDrugNotice from '@/components/clinical-notes/prescribe/UnlabelledDrugNotice';

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  createIssueReport.mockClear();
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

const render = (medication: string) => act(() => root.render(<UnlabelledDrugNotice medication={medication} />));

describe('UnlabelledDrugNotice', () => {
  it('stays silent for a medicine with a US label', () => {
    render('Amoxicillin');
    expect(container.textContent).toBe('');
  });

  it('tells the prescriber and files a flag without the patient', async () => {
    render('Sodium stibogluconate');
    expect(container.textContent).toContain('rxLabel.noUsLabel:Sodium stibogluconate');
    const button = [...container.querySelectorAll('button')].find(b => b.textContent === 'rxLabel.flag')!;
    await act(async () => { button.click(); });
    expect(createIssueReport).toHaveBeenCalledTimes(1);
    const [input, reporter] = createIssueReport.mock.calls[0];
    expect(input).toMatchObject({ category: 'drug_safety', summary: 'rxLabel.reportSummary:Sodium stibogluconate' });
    expect(JSON.stringify(input)).not.toMatch(/pat-|patient/i);
    expect(reporter).toMatchObject({ id: 'user-dr-wani', role: 'doctor' });
    expect(container.textContent).toContain('rxLabel.flagged');
    expect([...container.querySelectorAll('button')].some(b => b.textContent === 'rxLabel.flag')).toBe(false);
  });

  it('uses the off-list wording for a typed medicine', () => {
    render('Naproxen');
    expect(container.textContent).toContain('prescribe.offListNotice');
  });

  it('says when the flag did not send', async () => {
    createIssueReport.mockRejectedValueOnce(new Error('offline'));
    render('Ergometrine');
    const button = [...container.querySelectorAll('button')].find(b => b.textContent === 'rxLabel.flag')!;
    await act(async () => { button.click(); });
    expect(container.textContent).toContain('rxLabel.flagFailed');
  });
});
