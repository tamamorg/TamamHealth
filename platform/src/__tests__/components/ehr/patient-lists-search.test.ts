/** The search inside each patient list. */
import { matchesListSearch } from '@/components/ehr/chart/panels/PatientListsPanel';
import type { PatientDoc } from '@/lib/db-types';

const patient = {
  firstName: 'Grace', middleName: 'Mabior', surname: 'Deng',
  hospitalNumber: 'JTH-000005', phone: '+211912197986',
} as PatientDoc;

describe('patient list search', () => {
  it('shows everyone with an empty search', () => {
    expect(matchesListSearch(patient, '  ')).toBe(true);
  });

  it('matches any part of the full name, in any case', () => {
    expect(matchesListSearch(patient, 'mabior')).toBe(true);
  });

  it('matches the hospital number', () => {
    expect(matchesListSearch(patient, 'jth-0000')).toBe(true);
  });

  it('matches a phone however it is spaced', () => {
    expect(matchesListSearch(patient, '912 197')).toBe(true);
  });

  it('finds nothing for someone else', () => {
    expect(matchesListSearch(patient, 'Akol')).toBe(false);
    expect(matchesListSearch(patient, '555')).toBe(false);
  });
});
