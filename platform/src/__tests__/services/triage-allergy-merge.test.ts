/**
 * The triage → patient allergy bridge. Allergies a nurse captures in the
 * triage form's free-text field must land on the patient document's canonical
 * `allergies` list — the source the chart header banner, AllergiesSection and
 * the prescribing safety checks read. Before this bridge existed the header
 * kept claiming "no allergies" for a patient whose penicillin allergy was
 * sitting on the triage record.
 */
import { mergeTriageAllergies } from '@/lib/services/triage-service';

describe('mergeTriageAllergies', () => {
  it('adds parsed allergens to an empty list', () => {
    expect(mergeTriageAllergies(undefined, 'Penicillin')).toEqual(['Penicillin']);
    expect(mergeTriageAllergies([], 'Penicillin, Sulfa drugs; Peanuts')).toEqual([
      'Penicillin', 'Sulfa drugs', 'Peanuts',
    ]);
  });

  it('appends only what is new, case-insensitively, keeping existing order and casing', () => {
    expect(mergeTriageAllergies(['Penicillin'], 'penicillin, Latex')).toEqual(['Penicillin', 'Latex']);
  });

  it('returns null when everything is already on file', () => {
    expect(mergeTriageAllergies(['Penicillin', 'Latex'], 'penicillin; LATEX')).toBeNull();
  });

  it('returns null for empty or no-allergy sentinel text — a sentinel never overwrites real data', () => {
    expect(mergeTriageAllergies(['Penicillin'], '')).toBeNull();
    expect(mergeTriageAllergies(['Penicillin'], undefined)).toBeNull();
    expect(mergeTriageAllergies(['Penicillin'], 'none')).toBeNull();
    expect(mergeTriageAllergies(['Penicillin'], 'NKDA')).toBeNull();
    expect(mergeTriageAllergies(['Penicillin'], 'None known, n/a')).toBeNull();
  });

  it('drops sentinel tokens mixed in with real allergens', () => {
    expect(mergeTriageAllergies([], 'none, Penicillin')).toEqual(['Penicillin']);
  });

  it('removes contradicted no-allergy sentinel ENTRIES when a real allergen arrives', () => {
    expect(mergeTriageAllergies(['None known'], 'Penicillin')).toEqual(['Penicillin']);
  });

  it('does not deduplicate away entries that differ in substance', () => {
    expect(mergeTriageAllergies(['Penicillin rash'], 'Penicillin')).toEqual(['Penicillin rash', 'Penicillin']);
  });

  it('deduplicates repeats within the incoming text itself', () => {
    expect(mergeTriageAllergies([], 'Latex, latex , LATEX')).toEqual(['Latex']);
  });
});
