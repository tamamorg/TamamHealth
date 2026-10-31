/**
 * The pharmacist reads the actual warning and the prescriber's justification,
 * not just a flag on the queue row.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import RxSafetyNotice from '@/components/pharmacy/RxSafetyNotice';
import type { PrescriptionDoc } from '@/lib/db-types';

jest.mock('@/lib/hooks/useDataScope', () => ({ useDataScope: () => undefined }));
jest.mock('@/lib/i18n/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string, params?: Record<string, string>) => `${key} ${Object.values(params || {}).join(' ')}` }),
}));

const rx = {
  _id: 'rx-1', patientId: 'pat-1', medication: 'Amoxicillin 500mg',
  medicationSafety: {
    assessedAt: '',
    allergyWarnings: [{ medication: 'Amoxicillin 500mg', allergy: 'Penicillin', reason: 'class', criticality: 'severe', requiresOverride: true }],
    interactionWarnings: [],
    duplicateWarnings: [],
    acknowledgement: { reviewedBy: 'Dr. Wani', reviewedAt: '', reason: 'Tolerated a full course last year.' },
  },
} as unknown as PrescriptionDoc;

const conflict = { medication: 'Amoxicillin 500mg', allergy: 'Latex', reason: 'direct', criticality: 'severe', requiresOverride: true } as const;

describe('RxSafetyNotice', () => {
  it('shows the allergy and who justified it, and why', () => {
    const html = renderToStaticMarkup(<RxSafetyNotice rx={rx} />);
    expect(html).toContain('Penicillin');
    expect(html).toContain('Dr. Wani');
    expect(html).toContain('Tolerated a full course last year.');
    expect(html).not.toContain('<textarea');
  });

  it('renders nothing for an order with no warnings', () => {
    expect(renderToStaticMarkup(<RxSafetyNotice rx={{ ...rx, medicationSafety: undefined }} />)).toBe('');
  });

  it('asks for a written review of an unanswered conflict', () => {
    const html = renderToStaticMarkup(<RxSafetyNotice rx={rx} conflicts={[conflict]} review="" onReview={() => {}} />);
    expect(html).toContain('Latex');
    expect(html).toContain('<textarea');
  });
});
