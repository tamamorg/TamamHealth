/**
 * A saved reading opens locked: nothing can be typed, and the only way forward
 * is Edit, which is offered only to those who may correct it.
 */
import { mount } from '../clinical-notes/test-utils';
import NurseVitalsModal from '@/components/nurse/NurseVitalsModal';
import type { MedicalRecordDoc } from '@/lib/db-types';

jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('@/lib/i18n/useTranslation', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/components/Toast', () => ({ useToast: () => ({ showToast: jest.fn() }) }));
jest.mock('@/components/overlay/FormNotices', () => ({ __esModule: true, default: () => null }));
jest.mock('@/lib/services/medical-record-service', () => ({ recordNursingVitals: jest.fn() }));

const record = {
  _id: 'rec-1', patientId: 'pat-1', recordKind: 'nursing_vitals',
  vitalSigns: { temperature: '37.2', pulse: '80' },
} as unknown as MedicalRecordDoc;

const render = (props: Partial<Parameters<typeof NurseVitalsModal>[0]>) => mount(
  <NurseVitalsModal
    presentation="workspace"
    patientId="pat-1"
    patientName="Test Patient"
    hospitalId="hosp-1"
    correctingRecord={record}
    currentUser={{ _id: 'u1', name: 'Nurse' }}
    onClose={jest.fn()}
    {...props}
  />,
);

const footerLabels = (root: HTMLElement) => Array.from(root.querySelectorAll('.nv-footer button')).map(b => b.textContent);

describe('locked vitals', () => {
  it('disables every field and offers Close and Edit', () => {
    const { container, unmount } = render({ readOnly: true, onEdit: jest.fn() });
    const fields = Array.from(container.querySelectorAll<HTMLInputElement>('input, textarea'));
    expect(fields.length).toBeGreaterThan(0);
    expect(fields.every(field => field.disabled)).toBe(true);
    expect(footerLabels(container)).toEqual(['vitalsPanel.close', 'chart.vitalsEdit']);
    unmount();
  });

  it('offers no Edit without permission, and no correction reason', () => {
    const { container, unmount } = render({ readOnly: true });
    expect(footerLabels(container)).toEqual(['vitalsPanel.close']);
    expect(container.textContent).not.toContain('chart.correctionReason');
    unmount();
  });

  it('stays editable once the user chooses Edit', () => {
    const { container, unmount } = render({ readOnly: false });
    expect(Array.from(container.querySelectorAll('input')).some(field => !field.disabled)).toBe(true);
    expect(container.textContent).toContain('chart.correctionReason');
    unmount();
  });
});
