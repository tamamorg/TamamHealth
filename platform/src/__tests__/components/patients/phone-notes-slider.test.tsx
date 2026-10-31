import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import PhoneNotes from '@/components/patients/PhoneNotes';
import type { PatientDoc } from '@/lib/db-types';

const notes = [{ _id: 'n1', subject: 'Refill', message: 'Needs metformin', status: 'open', createdAt: '2026-10-30T09:00:00Z', callerName: 'Akol' }];

jest.mock('@/lib/i18n/useTranslation', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
jest.mock('@/lib/context', () => ({ useAuth: () => ({ currentUser: { _id: 'u1', role: 'doctor', name: 'Dr A' } }) }));
jest.mock('@/lib/hooks/useUsers', () => ({ useUsers: () => ({ users: [] }) }));
jest.mock('@/lib/hooks/usePhoneNotes', () => ({ usePhoneNotes: () => ({ notes }) }));
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }), usePathname: () => '/patients/p1' }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('PhoneNotes sliders', () => {
  let host: HTMLDivElement;
  let root: Root;
  const patient = { _id: 'p1', firstName: 'Akol', surname: 'Deng' } as unknown as PatientDoc;
  beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); });
  afterEach(() => { act(() => root.unmount()); host.remove(); });
  const button = (text: string) => [...document.querySelectorAll('button')].find(b => b.textContent?.includes(text));

  it('logs a call in a slider, never inline in the section', () => {
    act(() => { root.render(<PhoneNotes patient={patient} />); });
    expect(document.querySelector('textarea')).toBeNull();
    act(() => { button('Log call')?.click(); });
    expect(document.querySelector('.tm-slider textarea')).not.toBeNull();
    expect(host.querySelector('textarea')).toBeNull();
  });
});
