/**
 * The prescribe form's quantity follows the course until the prescriber types
 * one. It used to start at a literal 1, so an untouched "twice daily × 5 days"
 * Coartem script was dispensed as a single tablet (found walking a patient
 * through pharmacy on 2026-10-29).
 */
jest.mock('@/lib/settings/role-settings-store', () => ({ getRoleChoice: () => '' }));

import { draftQuantity, emptyDraft } from '@/components/clinical-notes/prescribe/types';
import type { FormularyDrug } from '@/lib/data/formulary';

const coartem = { name: 'Artemether-Lumefantrine (Coartem)', form: 'Tablet' } as unknown as FormularyDrug;
const paracetamol = { name: 'Paracetamol 500mg', form: 'Tablet' } as unknown as FormularyDrug;

describe('draftQuantity', () => {
  it('is the full course while the prescriber has not typed a quantity', () => {
    const draft = { ...emptyDraft('Juba'), drug: coartem, instructions: 'Twice daily with food', daysSupply: '5' };
    expect(draftQuantity(draft, false)).toBe('10');
  });

  it('counts three-times-daily courses', () => {
    const draft = { ...emptyDraft('Juba'), drug: paracetamol, instructions: 'Three times daily after meals', daysSupply: '3' };
    expect(draftQuantity(draft, false)).toBe('9');
  });

  it('keeps the prescriber\'s own figure once they have typed one', () => {
    const draft = { ...emptyDraft('Juba'), drug: coartem, instructions: 'Twice daily', daysSupply: '3', quantity: '24' };
    expect(draftQuantity(draft, true)).toBe('24');
  });

  it('leaves the field alone before a drug is picked', () => {
    expect(draftQuantity(emptyDraft('Juba'), false)).toBe('1');
  });
});
