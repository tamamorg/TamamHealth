// ─────────────────────────────────────────────────────────────────────────────
// Formulary — WHO Essential Medicines List (EML) aligned drug reference.
//
// This is the single, bundled source of truth for prescribable medicines. Each
// entry carries a WHO ATC classification code so interaction/duplicate logic can
// reason by drug class, and a dosage form. `medications` (name + category) is
// derived from it for backward-compatible consumers (pharmacy, consultation).
//
// Curated to the WHO Model List of Essential Medicines with the South Sudan
// disease burden in mind (malaria, TB, HIV, maternal/child health, NTDs). Extend
// here — never hardcode drug names in components.
// ─────────────────────────────────────────────────────────────────────────────

export type FormularyDrug = {
  name: string;
  category: string;
  atc: string;   // WHO ATC classification code
  form?: string; // typical dosage form
};

export const FORMULARY: FormularyDrug[] = [
  // ── Antimalarials ──
  { name: 'Artemether-Lumefantrine (Coartem)', category: 'Antimalarial', atc: 'P01BF01', form: 'Tablet' },
  { name: 'Artesunate (injection)', category: 'Antimalarial', atc: 'P01BE03', form: 'Injection' },
  { name: 'Artesunate-Amodiaquine', category: 'Antimalarial', atc: 'P01BF03', form: 'Tablet' },
  { name: 'Quinine', category: 'Antimalarial', atc: 'P01BC01', form: 'Tablet / Injection' },
  { name: 'Sulfadoxine-Pyrimethamine', category: 'Antimalarial', atc: 'P01BD51', form: 'Tablet' },
  { name: 'Primaquine', category: 'Antimalarial', atc: 'P01BA03', form: 'Tablet' },

  // ── Antibacterials ──
  { name: 'Amoxicillin', category: 'Antibiotic', atc: 'J01CA04', form: 'Capsule / Suspension' },
  { name: 'Amoxicillin-Clavulanate', category: 'Antibiotic', atc: 'J01CR02', form: 'Tablet / Suspension' },
  { name: 'Ampicillin', category: 'Antibiotic', atc: 'J01CA01', form: 'Injection' },
  { name: 'Benzylpenicillin', category: 'Antibiotic', atc: 'J01CE01', form: 'Injection' },
  { name: 'Benzathine benzylpenicillin', category: 'Antibiotic', atc: 'J01CE08', form: 'Injection' },
  { name: 'Phenoxymethylpenicillin', category: 'Antibiotic', atc: 'J01CE02', form: 'Tablet' },
  { name: 'Cloxacillin', category: 'Antibiotic', atc: 'J01CF02', form: 'Capsule / Injection' },
  { name: 'Ceftriaxone', category: 'Antibiotic', atc: 'J01DD04', form: 'Injection' },
  { name: 'Cefazolin', category: 'Antibiotic', atc: 'J01DB04', form: 'Injection' },
  { name: 'Cefixime', category: 'Antibiotic', atc: 'J01DD08', form: 'Tablet' },
  { name: 'Azithromycin', category: 'Antibiotic', atc: 'J01FA10', form: 'Tablet / Suspension' },
  { name: 'Erythromycin', category: 'Antibiotic', atc: 'J01FA01', form: 'Tablet' },
  { name: 'Ciprofloxacin', category: 'Antibiotic', atc: 'J01MA02', form: 'Tablet / Injection' },
  { name: 'Metronidazole', category: 'Antibiotic', atc: 'J01XD01', form: 'Tablet / Injection' },
  { name: 'Doxycycline', category: 'Antibiotic', atc: 'J01AA02', form: 'Capsule' },
  { name: 'Cotrimoxazole (Sulfamethoxazole-Trimethoprim)', category: 'Antibiotic', atc: 'J01EE01', form: 'Tablet / Suspension' },
  { name: 'Gentamicin', category: 'Antibiotic', atc: 'J01GB03', form: 'Injection' },
  { name: 'Chloramphenicol', category: 'Antibiotic', atc: 'J01BA01', form: 'Capsule / Injection' },
  { name: 'Nitrofurantoin', category: 'Antibiotic', atc: 'J01XE01', form: 'Tablet' },
  { name: 'Clindamycin', category: 'Antibiotic', atc: 'J01FF01', form: 'Capsule' },

  // ── Anti-TB ──
  { name: 'RHZE (Rifampicin-Isoniazid-Pyrazinamide-Ethambutol FDC)', category: 'Anti-TB', atc: 'J04AM06', form: 'Tablet' },
  { name: 'RH (Rifampicin-Isoniazid FDC)', category: 'Anti-TB', atc: 'J04AM02', form: 'Tablet' },
  { name: 'Isoniazid', category: 'Anti-TB', atc: 'J04AC01', form: 'Tablet' },
  { name: 'Rifampicin', category: 'Anti-TB', atc: 'J04AB02', form: 'Capsule' },
  { name: 'Ethambutol', category: 'Anti-TB', atc: 'J04AK02', form: 'Tablet' },
  { name: 'Pyrazinamide', category: 'Anti-TB', atc: 'J04AK01', form: 'Tablet' },

  // ── Antivirals / ARV ──
  { name: 'Tenofovir-Lamivudine-Dolutegravir (TLD)', category: 'Antiretroviral', atc: 'J05AR27', form: 'Tablet' },
  { name: 'Zidovudine-Lamivudine', category: 'Antiretroviral', atc: 'J05AR01', form: 'Tablet' },
  { name: 'Efavirenz', category: 'Antiretroviral', atc: 'J05AG03', form: 'Tablet' },
  { name: 'Nevirapine', category: 'Antiretroviral', atc: 'J05AG01', form: 'Tablet / Suspension' },
  { name: 'Dolutegravir', category: 'Antiretroviral', atc: 'J05AJ03', form: 'Tablet' },
  { name: 'Aciclovir', category: 'Antiviral', atc: 'J05AB01', form: 'Tablet / Injection' },

  // ── Antifungals / Antiparasitics ──
  { name: 'Fluconazole', category: 'Antifungal', atc: 'J02AC01', form: 'Capsule / Injection' },
  { name: 'Nystatin', category: 'Antifungal', atc: 'A07AA02', form: 'Suspension' },
  { name: 'Griseofulvin', category: 'Antifungal', atc: 'D01BA01', form: 'Tablet' },
  { name: 'Albendazole', category: 'Antiparasitic', atc: 'P02CA03', form: 'Tablet' },
  { name: 'Mebendazole', category: 'Antiparasitic', atc: 'P02CA01', form: 'Tablet' },
  { name: 'Praziquantel', category: 'Antiparasitic', atc: 'P02BA01', form: 'Tablet' },
  { name: 'Ivermectin', category: 'Antiparasitic', atc: 'P02CF01', form: 'Tablet' },

  // ── Analgesics / Antipyretics / NSAIDs ──
  { name: 'Paracetamol', category: 'Analgesic', atc: 'N02BE01', form: 'Tablet / Suspension' },
  { name: 'Ibuprofen', category: 'NSAID', atc: 'M01AE01', form: 'Tablet' },
  { name: 'Diclofenac', category: 'NSAID', atc: 'M01AB05', form: 'Tablet / Injection' },
  { name: 'Aspirin', category: 'Analgesic', atc: 'N02BA01', form: 'Tablet' },
  { name: 'Morphine', category: 'Opioid analgesic', atc: 'N02AA01', form: 'Tablet / Injection' },
  { name: 'Tramadol', category: 'Opioid analgesic', atc: 'N02AX02', form: 'Capsule / Injection' },
  { name: 'Codeine', category: 'Opioid analgesic', atc: 'R05DA04', form: 'Tablet' },

  // ── GI / rehydration ──
  { name: 'Oral Rehydration Salts (ORS)', category: 'Rehydration', atc: 'A07CA', form: 'Sachet' },
  { name: 'Zinc sulfate', category: 'Supplement', atc: 'A12CB01', form: 'Tablet' },
  { name: 'Omeprazole', category: 'Antacid / PPI', atc: 'A02BC01', form: 'Capsule' },
  { name: 'Ranitidine', category: 'Antacid / H2', atc: 'A02BA02', form: 'Tablet' },
  { name: 'Ondansetron', category: 'Antiemetic', atc: 'A04AA01', form: 'Tablet / Injection' },
  { name: 'Metoclopramide', category: 'Antiemetic', atc: 'A03FA01', form: 'Tablet / Injection' },
  { name: 'Hyoscine butylbromide', category: 'Antispasmodic', atc: 'A03BB01', form: 'Tablet / Injection' },
  { name: 'Loperamide', category: 'Antidiarrhoeal', atc: 'A07DA03', form: 'Capsule' },

  // ── Cardiovascular / chronic ──
  { name: 'Amlodipine', category: 'Antihypertensive', atc: 'C08CA01', form: 'Tablet' },
  { name: 'Nifedipine', category: 'Antihypertensive', atc: 'C08CA05', form: 'Tablet' },
  { name: 'Hydrochlorothiazide', category: 'Diuretic', atc: 'C03AA03', form: 'Tablet' },
  { name: 'Furosemide', category: 'Diuretic', atc: 'C03CA01', form: 'Tablet / Injection' },
  { name: 'Lisinopril', category: 'Antihypertensive', atc: 'C09AA03', form: 'Tablet' },
  { name: 'Enalapril', category: 'Antihypertensive', atc: 'C09AA02', form: 'Tablet' },
  { name: 'Atenolol', category: 'Beta-blocker', atc: 'C07AB03', form: 'Tablet' },
  { name: 'Bisoprolol', category: 'Beta-blocker', atc: 'C07AB07', form: 'Tablet' },
  { name: 'Methyldopa', category: 'Antihypertensive', atc: 'C02AB01', form: 'Tablet' },
  { name: 'Atorvastatin', category: 'Lipid-lowering', atc: 'C10AA05', form: 'Tablet' },
  { name: 'Digoxin', category: 'Cardiac glycoside', atc: 'C01AA05', form: 'Tablet' },

  // ── Endocrine / diabetes ──
  { name: 'Metformin', category: 'Antidiabetic', atc: 'A10BA02', form: 'Tablet' },
  { name: 'Glibenclamide', category: 'Antidiabetic', atc: 'A10BB01', form: 'Tablet' },
  { name: 'Insulin (soluble/regular)', category: 'Antidiabetic', atc: 'A10AB01', form: 'Injection' },
  { name: 'Insulin (isophane/NPH)', category: 'Antidiabetic', atc: 'A10AC01', form: 'Injection' },
  { name: 'Levothyroxine', category: 'Thyroid', atc: 'H03AA01', form: 'Tablet' },
  { name: 'Prednisolone', category: 'Corticosteroid', atc: 'H02AB06', form: 'Tablet' },
  { name: 'Hydrocortisone', category: 'Corticosteroid', atc: 'H02AB09', form: 'Injection' },
  { name: 'Dexamethasone', category: 'Corticosteroid', atc: 'H02AB02', form: 'Tablet / Injection' },

  // ── Respiratory ──
  { name: 'Salbutamol', category: 'Bronchodilator', atc: 'R03AC02', form: 'Inhaler / Nebule' },
  { name: 'Beclometasone (inhaled)', category: 'Inhaled corticosteroid', atc: 'R03BA01', form: 'Inhaler' },
  { name: 'Aminophylline', category: 'Bronchodilator', atc: 'R03DA05', form: 'Injection' },
  { name: 'Cetirizine', category: 'Antihistamine', atc: 'R06AE07', form: 'Tablet' },
  { name: 'Chlorphenamine', category: 'Antihistamine', atc: 'R06AB04', form: 'Tablet / Injection' },
  { name: 'Promethazine', category: 'Antihistamine', atc: 'R06AD02', form: 'Tablet / Injection' },

  // ── Haematinics / obstetric / vitamins ──
  { name: 'Ferrous sulfate', category: 'Haematinic', atc: 'B03AA07', form: 'Tablet' },
  { name: 'Ferrous + Folic acid', category: 'Haematinic', atc: 'B03AD03', form: 'Tablet' },
  { name: 'Folic acid', category: 'Supplement', atc: 'B03BB01', form: 'Tablet' },
  { name: 'Vitamin A (retinol)', category: 'Supplement', atc: 'A11CA01', form: 'Capsule' },
  { name: 'Vitamin B complex', category: 'Supplement', atc: 'A11EA', form: 'Tablet' },
  { name: 'Vitamin K (phytomenadione)', category: 'Haemostatic', atc: 'B02BA01', form: 'Injection' },
  { name: 'Oxytocin', category: 'Uterotonic', atc: 'H01BB02', form: 'Injection' },
  { name: 'Misoprostol', category: 'Uterotonic', atc: 'G02AD06', form: 'Tablet' },
  { name: 'Magnesium sulfate', category: 'Anticonvulsant (eclampsia)', atc: 'B05XA05', form: 'Injection' },
  { name: 'Calcium gluconate', category: 'Electrolyte', atc: 'A12AA03', form: 'Injection' },

  // ── Neuro / psych ──
  { name: 'Diazepam', category: 'Benzodiazepine', atc: 'N05BA01', form: 'Tablet / Injection' },
  { name: 'Phenobarbital', category: 'Antiepileptic', atc: 'N03AA02', form: 'Tablet / Injection' },
  { name: 'Phenytoin', category: 'Antiepileptic', atc: 'N03AB02', form: 'Tablet / Injection' },
  { name: 'Carbamazepine', category: 'Antiepileptic', atc: 'N03AF01', form: 'Tablet' },
  { name: 'Sodium valproate', category: 'Antiepileptic', atc: 'N03AG01', form: 'Tablet' },
  { name: 'Amitriptyline', category: 'Antidepressant', atc: 'N06AA09', form: 'Tablet' },
  { name: 'Fluoxetine', category: 'Antidepressant', atc: 'N06AB03', form: 'Capsule' },
  { name: 'Haloperidol', category: 'Antipsychotic', atc: 'N05AD01', form: 'Tablet / Injection' },
  { name: 'Chlorpromazine', category: 'Antipsychotic', atc: 'N05AA01', form: 'Tablet / Injection' },

  // ── Emergency / anaesthesia ──
  { name: 'Adrenaline (epinephrine)', category: 'Emergency', atc: 'C01CA24', form: 'Injection' },
  { name: 'Atropine', category: 'Emergency', atc: 'A03BA01', form: 'Injection' },
  { name: 'Hydralazine', category: 'Antihypertensive (emergency)', atc: 'C02DB02', form: 'Injection' },
  { name: 'Naloxone', category: 'Antidote', atc: 'V03AB15', form: 'Injection' },
  { name: 'Ketamine', category: 'Anaesthetic', atc: 'N01AX03', form: 'Injection' },
  { name: 'Lidocaine', category: 'Local anaesthetic', atc: 'N01BB02', form: 'Injection' },

  // ── Fluids ──
  { name: 'Sodium chloride 0.9% (Normal saline)', category: 'IV fluid', atc: 'B05BB01', form: 'Infusion' },
  { name: "Ringer's lactate", category: 'IV fluid', atc: 'B05BB01', form: 'Infusion' },
  { name: 'Dextrose 5%', category: 'IV fluid', atc: 'B05BA03', form: 'Infusion' },
  { name: 'Dextrose 50%', category: 'IV fluid', atc: 'B05BA03', form: 'Injection' },
];

/**
 * Backward-compatible `{ name, category }` list derived from the formulary, so
 * existing consumers (pharmacy, consultation search) keep working while the
 * real EML dataset lives in one place.
 */
export const medications: { name: string; category: string }[] =
  FORMULARY.map(({ name, category }) => ({ name, category }));

/** ATC class code for a medication name (ingredient-substring match). */
export function atcForMedication(name: string): string | undefined {
  const n = (name || '').toLowerCase();
  const hit = FORMULARY.find(d => n.includes(d.name.split(' ')[0].toLowerCase()) || d.name.toLowerCase().includes(n));
  return hit?.atc;
}

/**
 * ATC classes whose medicines are controlled: opioid analgesics and
 * anaesthetics, opium-alkaloid antitussives (codeine), opioid-dependence
 * agents, benzodiazepines (anxiolytic, hypnotic, antiepileptic), z-drugs,
 * barbiturates, centrally acting stimulants, and ketamine.
 */
const CONTROLLED_ATC_PREFIXES = [
  'N02A', 'N01AH', 'R05DA', 'N07BC', 'N05BA', 'N05CD', 'N05CF', 'N03AE', 'N03AA', 'N06BA', 'N01AX03',
];

/**
 * Controlled ingredients a prescriber may type that this list does not carry
 * as formulary lines. Kept beside the formulary so the knowledge has one home.
 */
const CONTROLLED_INGREDIENTS_NOT_LISTED = [
  'pethidine', 'fentanyl', 'methadone', 'buprenorphine', 'oxycodone', 'hydromorphone', 'dihydrocodeine',
  'pentazocine', 'midazolam', 'lorazepam', 'clonazepam', 'alprazolam', 'bromazepam', 'nitrazepam',
  'zolpidem', 'methylphenidate', 'thiopental',
];

/**
 * Whether a medicine is controlled by its class, whatever this facility
 * stocks. An inventory line can also mark a product controlled, but only for
 * what is on the shelf — and the decisions that most need this (may a script
 * be texted, may it be sent to an outside pharmacy) are made about medicines
 * the facility does not hold.
 *
 * Matches any controlled ingredient named anywhere in the string, so a
 * combination ("Paracetamol + Codeine") is caught by its controlled part. An
 * unrecognised name is not assumed controlled.
 */
export function isControlledMedicine(name: string): boolean {
  const n = (name || '').toLowerCase();
  if (!n.trim()) return false;
  if (CONTROLLED_INGREDIENTS_NOT_LISTED.some(ingredient => n.includes(ingredient))) return true;
  return FORMULARY.some(drug =>
    CONTROLLED_ATC_PREFIXES.some(prefix => drug.atc.startsWith(prefix))
    && n.includes(drug.name.split(' ')[0].toLowerCase()));
}
