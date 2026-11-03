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
    ['Carbamazepine', 'Clozapine', 'contraindicated'],
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
