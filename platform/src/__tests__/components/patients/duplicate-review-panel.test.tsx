import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import DuplicateReviewPanel from '@/components/patients/DuplicateReviewPanel';
import { findDuplicateCandidates } from '@/components/patients/duplicate-candidates';
import type { DuplicateReview } from '@/components/patients/useDuplicateReview';
import type { PatientDoc } from '@/lib/db-types';

let role = 'org_admin';
jest.mock('@/lib/i18n/useTranslation', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
jest.mock('@/lib/context', () => ({ useAuth: () => ({ currentUser: { _id: 'u1', role, name: 'Admin' } }) }));
jest.mock('@/lib/hooks/useDataScope', () => ({ useDataScope: () => ({ orgId: 'org-a', role }) }));
jest.mock('@/lib/hooks/useHospitals', () => ({ useHospitals: () => ({ hospitals: [], loading: false }) }));
jest.mock('@/components/Toast', () => ({ useToast: () => ({ showToast: jest.fn() }) }));
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }), usePathname: () => '/data-quality', useSearchParams: () => new URLSearchParams() }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mk = (id: string) => ({ _id: id, firstName: 'Achol', surname: 'Deng', dateOfBirth: '1990-05-02', hospitalNumber: `H-${id}` }) as unknown as PatientDoc;
const patients = [mk('a'), mk('b')];
const review: DuplicateReview = {
  allPatients: patients, patients, linked: [], candidates: findDuplicateCandidates(patients), loading: false, reload: async () => undefined,
};

describe('DuplicateReviewPanel', () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); });
  afterEach(() => { act(() => root.unmount()); host.remove(); });
  const markButtons = () => [...host.querySelectorAll('button')].filter(b => b.textContent === 'dup.mark');

  it('lists candidates with a mark button for a role that may mark', () => {
    role = 'org_admin';
    act(() => { root.render(<DuplicateReviewPanel review={review} standalone />); });
    expect(host.textContent).toContain('Achol Deng');
    expect(markButtons()).toHaveLength(1);
    expect(host.querySelector('.sadb-scope')).not.toBeNull();
  });

  it('shows the candidates but no mark button to a role that may not', () => {
    role = 'government';
    act(() => { root.render(<DuplicateReviewPanel review={review} standalone />); });
    expect(host.textContent).toContain('Achol Deng');
    expect(markButtons()).toHaveLength(0);
  });
});
