/**
 * The orderable catalogue for the Create Lab Order flow.
 *
 * Reads the live facility catalogue (`FacilitySettings.labCatalog`, editable by
 * admins) rather than a list hard-coded in the page, and splits it into the two
 * order types the dialog toggles between: bench investigations and imaging
 * studies. Imaging is not a different catalogue — it is the same entries whose
 * specimen is `Imaging`, which is what routes them to the radiology queue.
 */

import type { LabTestDef } from '@/lib/settings/facility-settings';
import { isImagingStudy } from '@/lib/clinical-flow/lab-catalog';
import type { LabOrderKind, OrderedTest } from './lab-order-types';

/** Named bench groupings, so the Tests step reads like a lab request form. */
const SECTION_BY_SPECIMEN: Record<string, string> = {
  Blood: 'Haematology & chemistry',
  Urine: 'Urine',
  Stool: 'Stool',
  Sputum: 'Sputum',
  Swab: 'Microbiology',
  Imaging: 'Imaging',
};

export const sectionFor = (test: { specimen: string; section?: string }): string =>
  test.section || SECTION_BY_SPECIMEN[test.specimen] || 'Other';

/** The catalogue entries offered for one order type. */
export function catalogFor(catalog: LabTestDef[], kind: LabOrderKind): LabTestDef[] {
  return catalog
    .filter(entry => {
      const imaging = isImagingStudy({ specimen: entry.specimen, testName: entry.name });
      return kind === 'imaging' ? imaging : !imaging;
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Free-text search across name, specimen and LOINC. */
export function searchCatalog(entries: LabTestDef[], query: string): LabTestDef[] {
  const q = query.trim().toLowerCase();
  if (!q) return entries;
  const hits = entries.filter(e =>
    e.name.toLowerCase().includes(q) ||
    e.specimen.toLowerCase().includes(q) ||
    (e.section || '').toLowerCase().includes(q) ||
    (e.loinc || '').toLowerCase().includes(q)
  );
  // Name matches lead, so the first row is the test that was typed. Matching the
  // bench section too is useful ("malaria" also finds the other parasitology
  // tests), but alphabetical order put "Filaria Night Blood Film" above
  // "Malaria RDT" and a tap on the first result ordered the wrong test.
  // Array.prototype.sort is stable, so each group keeps catalogue order.
  const rank = (e: LabTestDef) => {
    const name = e.name.toLowerCase();
    return name.startsWith(q) ? 0 : name.includes(q) ? 1 : 2;
  };
  return [...hits].sort((a, b) => rank(a) - rank(b));
}

/** Group entries by bench section for the picker's headings. */
export function groupBySection(entries: LabTestDef[]): { section: string; tests: LabTestDef[] }[] {
  const map = new Map<string, LabTestDef[]>();
  for (const entry of entries) {
    const section = sectionFor(entry);
    const list = map.get(section);
    if (list) list.push(entry);
    else map.set(section, [entry]);
  }
  return [...map.entries()]
    .map(([section, tests]) => ({ section, tests }))
    .sort((a, b) => a.section.localeCompare(b.section));
}

export const toOrderedTest = (entry: LabTestDef): OrderedTest => ({
  name: entry.name,
  specimen: entry.specimen,
  tier: entry.tier,
  loinc: entry.loinc,
});

/**
 * The distinct specimens a set of tests needs — what the phlebotomist actually
 * has to draw, deduplicated so "Blood ×4" is one tube line, not four.
 */
export function specimenSummary(tests: OrderedTest[]): { specimen: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const test of tests) counts.set(test.specimen, (counts.get(test.specimen) || 0) + 1);
  return [...counts.entries()].map(([specimen, count]) => ({ specimen, count }));
}
