import { searchCatalog } from '@/components/lab/order/lab-order-catalog';
import type { LabTestDef } from '@/lib/settings/facility-settings';

const test = (name: string, section: string, specimen = 'Blood'): LabTestDef =>
  ({ name, specimen, section, tier: 1, loinc: '' } as unknown as LabTestDef);

// Catalogue order is alphabetical (see catalogFor).
const CATALOG = [
  test('Filaria Night Blood Film', 'Malaria & parasitology'),
  test('Guinea Worm Specimen Confirmation', 'Malaria & parasitology', 'Tissue'),
  test('Malaria Microscopy', 'Malaria & parasitology'),
  test('Malaria RDT', 'Malaria & parasitology'),
  test('Schistosoma Urine Filtration', 'Malaria & parasitology', 'Urine'),
];

describe('searchCatalog', () => {
  it('lists the tests named like the query before tests that only share its bench section', () => {
    const names = searchCatalog(CATALOG, 'malaria').map(e => e.name);
    expect(names.slice(0, 2)).toEqual(['Malaria Microscopy', 'Malaria RDT']);
    // The section match still finds the related tests, after the named ones.
    expect(names).toContain('Filaria Night Blood Film');
  });

  it('puts a name that starts with the query ahead of one that only contains it', () => {
    const names = searchCatalog([test('Rapid Malaria Antigen', 'A'), test('Malaria RDT', 'A')], 'malaria').map(e => e.name);
    expect(names).toEqual(['Malaria RDT', 'Rapid Malaria Antigen']);
  });

  it('returns the whole catalogue untouched for an empty query', () => {
    expect(searchCatalog(CATALOG, '  ')).toEqual(CATALOG);
  });
});
