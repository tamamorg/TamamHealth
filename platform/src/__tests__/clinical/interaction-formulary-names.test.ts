/**
 * An interaction rule fires by name, so a rule spelled differently from the
 * formulary is silently dead: "phenobarbitone" never met "Phenobarbital".
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FORMULARY } from '@/lib/data/formulary';
import { checkAllergies, checkAllergiesStructured, checkInteractions, checkNewPrescription } from '@/lib/services/drug-interaction-service';

const source = readFileSync(join(process.cwd(), 'src/lib/services/drug-interaction-service.ts'), 'utf8');
const ruleDrugs = [...new Set(
  [...source.matchAll(/drug[12]: '([^']+)'/g)].map(match => match[1]),
)];

// Not prescribable from the formulary. Simvastatin and tizanidine are not on
// the South Sudan Essential Medicines List 2018; contrast dye is not a medicine.
const NOT_ON_FORMULARY = ['contrast dye', 'simvastatin', 'tizanidine'];

describe('interaction rule names', () => {
  it('reads the rules from the source', () => {
    expect(ruleDrugs.length).toBeGreaterThan(15);
  });

  it.each(ruleDrugs.filter(drug => !NOT_ON_FORMULARY.includes(drug)))('%s is on the formulary by that name', drug => {
    expect(FORMULARY.some(item => item.name.toLowerCase().includes(drug))).toBe(true);
  });

  it.each(NOT_ON_FORMULARY)('%s is still off the formulary, so this list stays true', drug => {
    expect(FORMULARY.some(item => item.name.toLowerCase().includes(drug))).toBe(false);
  });

  it('fires the phenobarbital rule from the formulary name and the older spelling', () => {
    for (const name of ['Phenobarbital', 'Phenobarbitone']) {
      expect(checkInteractions([name, 'Artemether-Lumefantrine (Coartem)']).highestSeverity).toBe('serious');
    }
  });

  it.each(['Ferrous sulfate', 'Ferrous + Folic acid', 'Ferrous Sulfate + Folic Acid', 'Iron Folate'])(
    'fires the iron rules for %s',
    name => {
      expect(checkInteractions(['Ciprofloxacin', name]).hasInteractions).toBe(true);
      expect(checkInteractions(['Doxycycline', name]).hasInteractions).toBe(true);
    },
  );

  it.each([
    ['Warfarin', 'Metronidazole'],
    ['Methotrexate', 'Cotrimoxazole (Sulfamethoxazole-Trimethoprim)'],
    ['Artemether-Lumefantrine (Coartem)', 'Quinine'],
  ])('stops %s with %s from the formulary names', (first, second) => {
    for (const name of [first, second]) expect(FORMULARY.some(item => item.name === name)).toBe(true);
    expect(checkNewPrescription(second, [first]).highestSeverity).toBe('contraindicated');
  });

  it('leaves medicines with no rule alone', () => {
    expect(checkInteractions(['Paracetamol', 'Ferrous sulfate']).hasInteractions).toBe(false);
  });
});

describe('checkNewPrescription', () => {
  const onChart = ['Artemether-Lumefantrine (Coartem)', 'Quinine'];

  it('does not raise a pair already on the chart against an unrelated new drug', () => {
    expect(checkInteractions(onChart).highestSeverity).toBe('contraindicated');
    expect(checkNewPrescription('Insulin (soluble/regular)', onChart).hasInteractions).toBe(false);
  });

  it('raises the pair when the new drug is one half of it', () => {
    expect(checkNewPrescription('Quinine', ['Artemether-Lumefantrine (Coartem)']).highestSeverity).toBe('contraindicated');
  });

  it('keeps what the new drug does with each current medicine', () => {
    const result = checkNewPrescription('Ciprofloxacin', ['Insulin (soluble/regular)', 'Diclofenac', 'Paracetamol']);
    expect(result.interactions.map(i => i.severity)).toEqual(['serious', 'moderate']);
  });
});

describe('sulfa allergy and sulfate salts', () => {
  const salts = ['Zinc sulfate', 'Ferrous sulfate', 'Magnesium sulfate', 'Ferrous Sulfate + Folic Acid'];
  const allergies = ['Sulfa drugs', 'Sulfa', 'Sulfonamide', 'sulpha'];

  it.each(salts)('does not flag %s', salt => {
    for (const substance of allergies) {
      expect(checkAllergies([salt], [substance])).toEqual([]);
      expect(checkAllergiesStructured([salt], [{ substance, criticality: 'unknown' }])).toEqual([]);
    }
  });

  it.each(['Cotrimoxazole (Sulfamethoxazole-Trimethoprim)', 'Sulfadoxine-Pyrimethamine'])('still flags %s', drug => {
    expect(checkAllergiesStructured([drug], [{ substance: 'Sulfa drugs', criticality: 'severe' }])[0].requiresOverride).toBe(true);
  });

  it('still flags an allergy to the salt itself', () => {
    expect(checkAllergies(['Magnesium sulfate'], ['Magnesium sulfate'])).toHaveLength(1);
    expect(checkAllergies(['Ferrous sulfate'], ['Ferrous'])).toHaveLength(1);
  });
});
