/**
 * The drug list: names resolve to the right line, new medicines reach the
 * allergy classes and the controlled rules, and nothing that belongs to another
 * record became orderable as a drug.
 */
import {
  FORMULARY, atcForMedication, findFormularyDrug, isControlledMedicine, offFormularyDrug, OFF_FORMULARY_CATEGORY,
} from '@/lib/data/formulary';
import { checkAllergies } from '@/lib/services/drug-interaction-service';
import { checkInteractions } from '@/lib/services/drug-interaction-service';
import { tierForMedicationName } from '@/lib/clinical-flow/medication-tiers';
import { checkDoseAdvisory } from '@/lib/pharmacy/dose-check';

describe('the list itself', () => {
  it('holds each medicine once', () => {
    const names = FORMULARY.map(drug => drug.name.toLowerCase());
    expect(new Set(names).size).toBe(names.length);
  });

  it('gives every medicine a category and a well-formed class code', () => {
    for (const drug of FORMULARY) {
      expect(drug.category).toBeTruthy();
      if (!drug.name.startsWith('Condom')) expect(drug.atc).toMatch(/^[A-Z]\d{2}[A-Z0-9]*$/);
    }
  });

  it.each([
    'Sodium stibogluconate', 'Paromomycin', 'Miltefosine', 'Amphotericin B', 'Melarsoprol', 'Fexinidazole',
    'Tranexamic acid', 'Ergometrine', 'Rabies vaccine', 'Artesunate (suppository)', 'Propofol', 'Heparin',
  ])('carries %s', name => {
    expect(FORMULARY.some(drug => drug.name === name)).toBe(true);
  });

  it('carries snake antivenom', () => {
    expect(FORMULARY.some(drug => drug.category === 'Antivenom' && /snake/i.test(drug.name))).toBe(true);
  });

  it.each(['Whole blood', 'Fresh frozen plasma', 'Platelets', 'BCG vaccine', 'Measles vaccine'])(
    'leaves %s to its own record', name => {
      expect(FORMULARY.some(drug => drug.name.toLowerCase().includes(name.toLowerCase()))).toBe(false);
    },
  );
});

describe('finding a medicine by name', () => {
  it('never reads a shared first word as another medicine', () => {
    expect(atcForMedication('Sodium bicarbonate 8.4%')).toBe('B05XA02');
    expect(atcForMedication('Potassium chloride 10ml')).toBe('B05XA01');
    expect(atcForMedication('Calcium gluconate')).toBe('A12AA03');
    expect(atcForMedication('Vitamin K 10mg')).toBe('B02BA01');
    expect(atcForMedication('Sodium oxybate')).toBeUndefined();
  });

  it('still recognises strengths and brand words', () => {
    expect(findFormularyDrug('Amoxicillin 500mg')?.name).toBe('Amoxicillin');
    expect(findFormularyDrug('coartem')?.name).toBe('Artemether-Lumefantrine (Coartem)');
  });

  it('prefers the longest listed name', () => {
    expect(findFormularyDrug('Amoxicillin-Clavulanate 625mg')?.name).toBe('Amoxicillin-Clavulanate');
  });

  it('does not recognise a medicine the list lacks', () => {
    expect(findFormularyDrug('Naproxen')).toBeUndefined();
  });

  it('tiers new life-sustaining medicines from their class', () => {
    expect(tierForMedicationName('Dopamine')).toBe(1);
    expect(tierForMedicationName('Lamotrigine')).toBe(1);
    expect(tierForMedicationName('Lopinavir + ritonavir')).toBe(2);
  });
});

describe('controlled medicines', () => {
  it.each(['Fentanyl', 'Pethidine', 'Methadone', 'Midazolam', 'Thiopental', 'Lorazepam 1mg'])('%s is controlled', name => {
    expect(isControlledMedicine(name)).toBe(true);
  });

  it.each(['Propofol', 'Sodium stibogluconate', 'Loratadine', 'Water for injection'])('%s is not', name => {
    expect(isControlledMedicine(name)).toBe(false);
  });
});

describe('allergy classes reach the new medicines', () => {
  it.each([
    ['Penicillin', 'Procaine benzylpenicillin'],
    ['Penicillin', 'Flucloxacillin'],
    ['Penicillin', 'Ampicillin + Cloxacillin'],
    ['Penicillin', 'Piperacillin-Tazobactam'],
    ['Cephalosporins', 'Cefalexin'],
    ['Sulfa drugs (sulfonamides)', 'Sulfadiazine'],
    ['Sulfa drugs (sulfonamides)', 'Silver sulfadiazine'],
    ['Tetracycline', 'Doxycycline'],
    ['ACE inhibitors', 'Captopril'],
    ['Local anaesthetics (lidocaine)', 'Bupivacaine'],
    ['Iodine / contrast dye', 'Povidone iodine'],
    ['Iodine / contrast dye', 'Iohexol (contrast medium)'],
    ['Gentamicin', 'Amikacin'],
  ])('%s flags %s', (allergy, medicine) => {
    expect(checkAllergies([medicine], [allergy]).length).toBeGreaterThan(0);
  });

  it('does not read penicillamine as a penicillin', () => {
    expect(checkAllergies(['Penicillamine'], ['Penicillin'])).toHaveLength(0);
  });

  it('keeps sulfate salts clear of a sulfa allergy', () => {
    expect(checkAllergies(['Zinc sulfate'], ['Sulfa drugs (sulfonamides)'])).toHaveLength(0);
  });
});

describe('a medicine not on the list', () => {
  it('marks what the prescriber typed', () => {
    expect(offFormularyDrug('  Naproxen ')).toEqual({ name: 'Naproxen', category: OFF_FORMULARY_CATEGORY, atc: '' });
  });
});

describe('safety rules reach the new medicines', () => {
  it.each([
    ['Lithium carbonate', 'Ibuprofen', 'serious'],
    ['Rifampicin', 'Lopinavir + ritonavir', 'contraindicated'],
    ['Rifampicin + isoniazid', 'Tenofovir-Lamivudine-Dolutegravir (TLD)', 'serious'],
    ['Allopurinol', 'Azathioprine', 'serious'],
    ['Metformin', 'Iohexol (contrast medium)', 'serious'],
    ['Carbamazepine', 'Clozapine', 'serious'],
  ])('%s with %s is %s', (a, b, severity) => {
    expect(checkInteractions([a, b]).highestSeverity).toBe(severity);
  });

  it.each([
    ['Amlodipine', '20 mg', 'OD'],
    ['Colchicine', '1 mg', 'TDS'],
  ])('warns on %s %s %s', (medication, dose, frequency) => {
    expect(checkDoseAdvisory({ medication, dose, frequency })?.drug).toBe(medication.toLowerCase());
  });

  it('stays quiet at the ceiling itself', () => {
    expect(checkDoseAdvisory({ medication: 'Tramadol', dose: '100 mg', frequency: 'QDS' })).toBeNull();
  });

  it('warns past a per-kilogram-only limit when the weight is known', () => {
    expect(checkDoseAdvisory({ medication: 'Azathioprine', dose: '150 mg', frequency: 'OD', weightKg: 50 })?.basis).toBe('per_kg');
    expect(checkDoseAdvisory({ medication: 'Azathioprine', dose: '150 mg', frequency: 'OD' })).toBeNull();
  });

  it('does not round a small dose over its ceiling', () => {
    expect(checkDoseAdvisory({ medication: 'Colchicine', dose: '0.6 mg', frequency: 'TDS' })).toBeNull();
  });

  it('tells the prescriber about a dated medicine', () => {
    expect(findFormularyDrug('Ranitidine')?.note).toMatch(/NDMA/);
    expect(findFormularyDrug('Chloroquine')?.note).toMatch(/falciparum/);
  });
});

describe('US prescribing labels are the source of the safety rules', () => {
  const { readFileSync } = jest.requireActual('node:fs') as typeof import('node:fs');
  const { join } = jest.requireActual('node:path') as typeof import('node:path');
  const source = readFileSync(join(process.cwd(), 'src/lib/services/drug-interaction-service.ts'), 'utf8');
  const rules = [...source.matchAll(/drug1: '([^']+)',\s*drug2: '([^']+)',\s*severity: '[a-z]+',\s*(?:source: '([a-z-]+)',)?/g)]
    .map(m => ({ pair: `${m[1]} + ${m[2]}`, source: m[3] }));

  it('names a source on every interaction rule', () => {
    expect(rules.length).toBeGreaterThan(150);
    expect(rules.filter(rule => !rule.source)).toEqual([]);
  });

  it('keeps the rules no US label states to a known short list', () => {
    expect(rules.filter(rule => rule.source === 'other').map(rule => rule.pair).sort())
      .toEqual(['magnesium sulfate + gentamicin', 'metformin + enalapril']);
  });

  it('names a source on every dose ceiling, and only amoxicillin comes from elsewhere', () => {
    const { DOSE_LIMITS } = jest.requireActual('@/lib/pharmacy/dose-check') as typeof import('@/lib/pharmacy/dose-check');
    const entries = Object.entries(DOSE_LIMITS);
    expect(entries.every(([, limit]) => limit.source === 'us-label' || limit.source === 'other')).toBe(true);
    expect(entries.filter(([, limit]) => limit.source === 'other').map(([key]) => key)).toEqual(['amoxicillin']);
  });

  it('takes the US label ceiling where it differs from the BNF', () => {
    expect(checkDoseAdvisory({ medication: 'Lisinopril', dose: '60 mg', frequency: 'OD' })?.limitMg).toBe(40);
    expect(checkDoseAdvisory({ medication: 'Ibuprofen', dose: '800 mg', frequency: 'QDS' })).toBeNull();
  });

  it('grades a pair the label lists under Contraindications as contraindicated', () => {
    expect(checkInteractions(['Fluoxetine', 'Linezolid']).highestSeverity).toBe('contraindicated');
    expect(checkInteractions(['Ritonavir', 'Ergometrine']).highestSeverity).toBe('contraindicated');
    expect(checkInteractions(['Praziquantel', 'Rifampicin']).highestSeverity).toBe('contraindicated');
  });

  it('grades a pair the label says to avoid as serious', () => {
    expect(checkInteractions(['Clopidogrel', 'Omeprazole']).highestSeverity).toBe('serious');
    expect(checkInteractions(['Warfarin', 'Metronidazole']).highestSeverity).toBe('serious');
  });

  it('leaves eye, ear and skin preparations out of systemic interactions', () => {
    expect(checkInteractions(['Ciprofloxacin eye drops', 'Amiodarone']).hasInteractions).toBe(false);
    expect(checkInteractions(['Ciprofloxacin', 'Amiodarone']).highestSeverity).toBe('serious');
  });

  it('carries the label cross-allergy between quinine and mefloquine', () => {
    expect(checkAllergies(['Mefloquine'], ['Quinine']).length).toBeGreaterThan(0);
  });
});

describe('medicines the US label standard does not cover', () => {
  it('knows which formulary medicines have no US label on file', () => {
    const { hasUsLabel } = jest.requireActual('@/lib/data/formulary') as typeof import('@/lib/data/formulary');
    expect(hasUsLabel('Sodium stibogluconate')).toBe(false);
    expect(hasUsLabel('Antivenom, snake polyvalent (SAIMR)')).toBe(false);
    expect(hasUsLabel('Amoxicillin 500mg')).toBe(true);
    expect(hasUsLabel('Tenofovir-Lamivudine-Dolutegravir (TLD)')).toBe(true);
    expect(hasUsLabel('Naproxen')).toBe(false);
    expect(FORMULARY.filter(drug => !hasUsLabel(drug.name)).length).toBe(66);
  });

  it('files a flag as a drug-safety issue with no patient in it', () => {
    const { ISSUE_CATEGORIES } = jest.requireActual('@/modules/communication/issue-rules') as typeof import('@/modules/communication/issue-rules');
    expect(ISSUE_CATEGORIES).toContain('drug_safety');
  });

  it('says so on the interaction warnings no US label states', () => {
    const hit = checkInteractions(['Metformin', 'Enalapril']).interactions[0];
    expect(hit.source).toBe('other');
    expect(hit.description).toMatch(/No US label states this/);
  });
});
