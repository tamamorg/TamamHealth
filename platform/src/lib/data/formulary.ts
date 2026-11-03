// ─────────────────────────────────────────────────────────────────────────────
// Formulary — WHO Essential Medicines List (EML) aligned drug reference.
//
// This is the single, bundled source of truth for prescribable medicines. Each
// entry carries a WHO ATC classification code so interaction/duplicate logic can
// reason by drug class, and a dosage form. `medications` (name + category) is
// derived from it for backward-compatible consumers (pharmacy, consultation).
//
// Covers the South Sudan Essential Medicines List 2018 and the essential care it
// leaves out (tranexamic acid, fexinidazole, midazolam and others). Two groups
// are not here on purpose: blood products, which go through the blood bank's
// crossmatch, and routine schedule vaccines, which the immunization record owns.
// Strengths stay out of the names: the prescriber writes the dose. Extend here —
// never hardcode drug names in components.
// ─────────────────────────────────────────────────────────────────────────────

export type FormularyDrug = {
  name: string;
  category: string;
  atc: string;   // WHO ATC classification code
  form?: string; // typical dosage form
  note?: string; // shown to the prescriber: why to think twice about this medicine
};

/** The category an order carries when its medicine is not on this list. */
export const OFF_FORMULARY_CATEGORY = 'Not on the drug list';

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
  { name: 'Efavirenz', category: 'Antiretroviral', atc: 'J05AG03', form: 'Tablet', note: 'WHO prefers dolutegravir-based treatment for most people with HIV.' },
  { name: 'Nevirapine', category: 'Antiretroviral', atc: 'J05AG01', form: 'Tablet / Suspension', note: 'WHO prefers dolutegravir-based treatment for most people with HIV.' },
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
  { name: 'Ranitidine', category: 'Antacid / H2', atc: 'A02BA02', form: 'Tablet', note: 'Withdrawn in many countries over NDMA contamination. Omeprazole is the usual alternative.' },
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
  { name: 'Warfarin', category: 'Anticoagulant', atc: 'B01AA03', form: 'Tablet' },

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
  { name: 'Aminophylline', category: 'Bronchodilator', atc: 'R03DA05', form: 'Tablet / Injection' },
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

  // ── Antineoplastic / immunosuppressant ──
  { name: 'Methotrexate', category: 'Antineoplastic', atc: 'L01BA01', form: 'Tablet / Injection' },

  // ── Emergency / anaesthesia ──
  { name: 'Adrenaline (epinephrine)', category: 'Emergency', atc: 'C01CA24', form: 'Injection' },
  { name: 'Atropine', category: 'Emergency', atc: 'A03BA01', form: 'Injection' },
  { name: 'Hydralazine', category: 'Antihypertensive (emergency)', atc: 'C02DB02', form: 'Tablet / Injection' },
  { name: 'Naloxone', category: 'Antidote', atc: 'V03AB15', form: 'Injection' },
  { name: 'Ketamine', category: 'Anaesthetic', atc: 'N01AX03', form: 'Injection' },
  { name: 'Lidocaine', category: 'Local anaesthetic', atc: 'N01BB02', form: 'Injection' },

  // ── Fluids ──
  { name: 'Sodium chloride 0.9% (Normal saline)', category: 'IV fluid', atc: 'B05BB01', form: 'Infusion' },
  { name: "Ringer's lactate", category: 'IV fluid', atc: 'B05BB01', form: 'Infusion' },
  { name: 'Dextrose 5%', category: 'IV fluid', atc: 'B05BA03', form: 'Infusion' },
  { name: 'Dextrose 50%', category: 'IV fluid', atc: 'B05BA03', form: 'Injection' },

  // ── Anaesthesia, gases and neuromuscular ──
  { name: 'Halothane', category: 'General anaesthetic', atc: 'N01AB01', form: 'Inhalation' },
  { name: 'Isoflurane', category: 'General anaesthetic', atc: 'N01AB06', form: 'Inhalation' },
  { name: 'Medical oxygen', category: 'Medical gas', atc: 'V03AN01', form: 'Gas' },
  { name: 'Nitrous oxide', category: 'General anaesthetic', atc: 'N01AX13', form: 'Inhalation' },
  { name: 'Propofol', category: 'General anaesthetic', atc: 'N01AX10', form: 'Injection' },
  { name: 'Thiopental', category: 'General anaesthetic', atc: 'N01AF03', form: 'Injection' },
  { name: 'Bupivacaine', category: 'Local anaesthetic', atc: 'N01BB01', form: 'Injection' },
  { name: 'Lidocaine + adrenaline', category: 'Local anaesthetic', atc: 'N01BB52', form: 'Injection' },
  { name: 'Fentanyl', category: 'Opioid analgesic', atc: 'N01AH01', form: 'Injection' },
  { name: 'Pethidine', category: 'Opioid analgesic', atc: 'N02AB02', form: 'Injection' },
  { name: 'Midazolam', category: 'Benzodiazepine', atc: 'N05CD08', form: 'Injection' },
  { name: 'Atracurium', category: 'Muscle relaxant', atc: 'M03AC04', form: 'Injection' },
  { name: 'Suxamethonium', category: 'Muscle relaxant', atc: 'M03AB01', form: 'Injection' },
  { name: 'Pancuronium', category: 'Muscle relaxant', atc: 'M03AC01', form: 'Injection' },
  { name: 'Vecuronium', category: 'Muscle relaxant', atc: 'M03AC03', form: 'Injection' },
  { name: 'Neostigmine', category: 'Cholinesterase inhibitor', atc: 'N07AA01', form: 'Injection' },

  // ── Antidotes and antisera ──
  { name: 'Activated charcoal', category: 'Antidote', atc: 'A07BA01', form: 'Tablet' },
  { name: 'Acetylcysteine', category: 'Antidote', atc: 'V03AB23', form: 'Injection' },
  { name: 'Deferoxamine', category: 'Antidote', atc: 'V03AC01', form: 'Injection' },
  { name: 'Dimercaprol', category: 'Antidote', atc: 'V03AB09', form: 'Injection' },
  { name: 'Methylene blue (methylthioninium chloride)', category: 'Antidote', atc: 'V03AB17', form: 'Injection' },
  { name: 'Penicillamine', category: 'Antidote', atc: 'M01CC01', form: 'Tablet' },
  { name: 'Pralidoxime', category: 'Antidote', atc: 'V03AB04', form: 'Injection' },
  { name: 'Protamine', category: 'Antidote', atc: 'V03AB14', form: 'Injection' },
  { name: 'Sodium nitrite', category: 'Antidote', atc: 'V03AB08', form: 'Injection' },
  { name: 'Sodium thiosulfate', category: 'Antidote', atc: 'V03AB06', form: 'Injection' },
  { name: 'Antivenom, snake polyvalent (SAIMR)', category: 'Antivenom', atc: 'J06AA03', form: 'Injection' },
  { name: 'Antivenom, snake polyvalent (EchiTAb-Plus-ICP)', category: 'Antivenom', atc: 'J06AA03', form: 'Injection' },
  { name: 'Antiscorpion serum', category: 'Antivenom', atc: 'J06AA', form: 'Injection' },
  { name: 'Tetanus antitoxin (antitetanus serum)', category: 'Immunoglobulin', atc: 'J06AA02', form: 'Injection' },
  { name: 'Tetanus immunoglobulin, human', category: 'Immunoglobulin', atc: 'J06BB02', form: 'Injection' },
  { name: 'Rabies immunoglobulin, human', category: 'Immunoglobulin', atc: 'J06BB05', form: 'Injection' },
  { name: 'Anti-D immunoglobulin, human', category: 'Immunoglobulin', atc: 'J06BB01', form: 'Injection' },
  { name: 'Normal immunoglobulin, human', category: 'Immunoglobulin', atc: 'J06BA02', form: 'Injection' },

  // ── Vaccines outside the routine schedule the immunization module records ──
  { name: 'Rabies vaccine', category: 'Vaccine', atc: 'J07BG01', form: 'Injection' },
  { name: 'Tetanus toxoid', category: 'Vaccine', atc: 'J07AM01', form: 'Injection' },
  { name: 'Tetanus + diphtheria (Td)', category: 'Vaccine', atc: 'J07AM51', form: 'Injection' },
  { name: 'Poliomyelitis vaccine, inactivated (IPV)', category: 'Vaccine', atc: 'J07BF03', form: 'Injection' },
  { name: 'Hepatitis B vaccine', category: 'Vaccine', atc: 'J07BC01', form: 'Injection' },
  { name: 'Human papillomavirus vaccine', category: 'Vaccine', atc: 'J07BM', form: 'Injection' },
  { name: 'Meningococcal conjugate vaccine', category: 'Vaccine', atc: 'J07AH', form: 'Injection' },
  { name: 'Oral cholera vaccine', category: 'Vaccine', atc: 'J07AE01', form: 'Oral suspension' },
  { name: 'Anthrax vaccine', category: 'Vaccine', atc: 'J07AC01', form: 'Injection' },
  { name: 'Tuberculin PPD', category: 'Diagnostic agent', atc: 'V04CF01', form: 'Injection' },

  // ── Antibacterials ──
  { name: 'Cefalexin', category: 'Antibiotic', atc: 'J01DB01', form: 'Capsule' },
  { name: 'Cefotaxime', category: 'Antibiotic', atc: 'J01DD01', form: 'Injection' },
  { name: 'Ceftazidime', category: 'Antibiotic', atc: 'J01DD02', form: 'Injection' },
  { name: 'Flucloxacillin', category: 'Antibiotic', atc: 'J01CF05', form: 'Capsule / Injection' },
  { name: 'Ampicillin + Cloxacillin', category: 'Antibiotic', atc: 'J01CR50', form: 'Capsule / Injection' },
  { name: 'Procaine benzylpenicillin', category: 'Antibiotic', atc: 'J01CE09', form: 'Injection' },
  { name: 'Piperacillin-Tazobactam', category: 'Antibiotic', atc: 'J01CR05', form: 'Injection' },
  { name: 'Amikacin', category: 'Antibiotic', atc: 'J01GB06', form: 'Injection' },
  { name: 'Meropenem', category: 'Antibiotic', atc: 'J01DH02', form: 'Injection' },
  { name: 'Vancomycin', category: 'Antibiotic', atc: 'J01XA01', form: 'Injection' },
  { name: 'Sulfadiazine', category: 'Antibiotic', atc: 'J01EC02', form: 'Tablet' },
  { name: 'Linezolid', category: 'Antibiotic', atc: 'J01XX08', form: 'Tablet' },

  // ── Leprosy ──
  { name: 'Dapsone', category: 'Antileprosy', atc: 'J04BA02', form: 'Tablet' },
  { name: 'Clofazimine', category: 'Antileprosy', atc: 'J04BA01', form: 'Capsule' },
  { name: 'Rifampicin + dapsone (leprosy blister)', category: 'Antileprosy', atc: 'J04BA', form: 'Tablet' },
  { name: 'Rifampicin + clofazimine + dapsone (leprosy blister)', category: 'Antileprosy', atc: 'J04BA', form: 'Tablet' },

  // ── Tuberculosis ──
  { name: 'Ethambutol + isoniazid', category: 'Anti-TB', atc: 'J04AM03', form: 'Tablet' },
  { name: 'Rifampicin + isoniazid + pyrazinamide', category: 'Anti-TB', atc: 'J04AM05', form: 'Tablet' },
  { name: 'Rifampicin + isoniazid + ethambutol', category: 'Anti-TB', atc: 'J04AM07', form: 'Tablet' },
  { name: 'Isoniazid + pyridoxine + sulfamethoxazole + trimethoprim', category: 'Anti-TB', atc: 'J04AC51', form: 'Tablet' },
  { name: 'Bedaquiline', category: 'Anti-TB', atc: 'J04AK05', form: 'Tablet' },
  { name: 'Capreomycin', category: 'Anti-TB', atc: 'J04AB30', form: 'Injection', note: 'WHO no longer recommends this for drug-resistant TB. Follow current TB guidance.' },
  { name: 'Cycloserine', category: 'Anti-TB', atc: 'J04AB01', form: 'Capsule' },
  { name: 'Ethionamide', category: 'Anti-TB', atc: 'J04AD03', form: 'Tablet' },
  { name: 'Kanamycin', category: 'Anti-TB', atc: 'J01GB04', form: 'Injection', note: 'WHO no longer recommends this for drug-resistant TB. Follow current TB guidance.' },
  { name: 'Levofloxacin', category: 'Antibiotic', atc: 'J01MA12', form: 'Tablet' },
  { name: 'Moxifloxacin', category: 'Antibiotic', atc: 'J01MA14', form: 'Tablet' },
  { name: 'p-Aminosalicylic acid', category: 'Anti-TB', atc: 'J04AA01', form: 'Tablet' },
  { name: 'Rifabutin', category: 'Anti-TB', atc: 'J04AB04', form: 'Capsule' },
  { name: 'Streptomycin', category: 'Anti-TB', atc: 'J01GA01', form: 'Injection' },

  // ── Antifungals and antivirals ──
  { name: 'Clotrimazole', category: 'Antifungal', atc: 'G01AF02', form: 'Pessary / Cream' },
  { name: 'Clotrimazole ear solution', category: 'Antifungal', atc: 'S02AA', form: 'Ear drops' },
  { name: 'Amphotericin B', category: 'Antifungal', atc: 'J02AA01', form: 'Injection' },
  { name: 'Liposomal amphotericin B', category: 'Antifungal', atc: 'J02AA01', form: 'Injection' },
  { name: 'Flucytosine', category: 'Antifungal', atc: 'J02AX01', form: 'Injection' },
  { name: 'Itraconazole', category: 'Antifungal', atc: 'J02AC02', form: 'Capsule' },
  { name: 'Terbinafine', category: 'Antifungal', atc: 'D01AE15', form: 'Cream' },
  { name: 'Miconazole', category: 'Antifungal', atc: 'D01AC02', form: 'Cream' },
  { name: 'Abacavir', category: 'Antiretroviral', atc: 'J05AF06', form: 'Tablet' },
  { name: 'Lamivudine', category: 'Antiretroviral', atc: 'J05AF05', form: 'Tablet' },
  { name: 'Tenofovir', category: 'Antiretroviral', atc: 'J05AF07', form: 'Tablet' },
  { name: 'Zidovudine', category: 'Antiretroviral', atc: 'J05AF01', form: 'Tablet' },
  { name: 'Ritonavir', category: 'Antiretroviral', atc: 'J05AE03', form: 'Tablet' },
  { name: 'Atazanavir + ritonavir', category: 'Antiretroviral', atc: 'J05AR23', form: 'Tablet' },
  { name: 'Darunavir + ritonavir', category: 'Antiretroviral', atc: 'J05AE10', form: 'Tablet' },
  { name: 'Lopinavir + ritonavir', category: 'Antiretroviral', atc: 'J05AR10', form: 'Tablet / Pellets' },
  { name: 'Raltegravir', category: 'Antiretroviral', atc: 'J05AJ01', form: 'Tablet' },
  { name: 'Abacavir + Lamivudine', category: 'Antiretroviral', atc: 'J05AR02', form: 'Tablet' },
  { name: 'Abacavir + Lamivudine + Zidovudine', category: 'Antiretroviral', atc: 'J05AR04', form: 'Tablet' },
  { name: 'Tenofovir + Lamivudine', category: 'Antiretroviral', atc: 'J05AR12', form: 'Tablet' },
  { name: 'Tenofovir + Lamivudine + Efavirenz', category: 'Antiretroviral', atc: 'J05AR11', form: 'Tablet' },
  { name: 'Zidovudine + Lamivudine + Nevirapine', category: 'Antiretroviral', atc: 'J05AR05', form: 'Tablet' },
  { name: 'Oseltamivir', category: 'Antiviral', atc: 'J05AH02', form: 'Capsule' },
  { name: 'Entecavir', category: 'Antiviral', atc: 'J05AF10', form: 'Tablet' },
  { name: 'Daclatasvir', category: 'Antiviral', atc: 'J05AP07', form: 'Tablet' },
  { name: 'Sofosbuvir', category: 'Antiviral', atc: 'J05AP08', form: 'Tablet' },
  { name: 'Sofosbuvir + Velpatasvir', category: 'Antiviral', atc: 'J05AP55', form: 'Tablet' },
  { name: 'Sofosbuvir + Ledipasvir', category: 'Antiviral', atc: 'J05AP51', form: 'Tablet' },
  { name: 'Ribavirin', category: 'Antiviral', atc: 'J05AP01', form: 'Tablet / Injection' },
  { name: 'Simeprevir', category: 'Antiviral', atc: 'J05AP05', form: 'Capsule', note: 'Discontinued by the manufacturer. Sofosbuvir + Velpatasvir is the usual alternative.' },

  // ── Kala-azar, sleeping sickness, malaria and other parasites ──
  { name: 'Sodium stibogluconate', category: 'Antileishmanial', atc: 'P01CB02', form: 'Injection' },
  { name: 'Paromomycin', category: 'Antileishmanial', atc: 'A07AA06', form: 'Injection' },
  { name: 'Miltefosine', category: 'Antileishmanial', atc: 'P01CX04', form: 'Capsule' },
  { name: 'Pentamidine', category: 'Antitrypanosomal', atc: 'P01CX01', form: 'Injection' },
  { name: 'Suramin', category: 'Antitrypanosomal', atc: 'P01CX02', form: 'Injection' },
  { name: 'Melarsoprol', category: 'Antitrypanosomal', atc: 'P01CD01', form: 'Injection', note: 'Can cause fatal encephalopathy. Use only where guidelines still call for it.' },
  { name: 'Eflornithine', category: 'Antitrypanosomal', atc: 'P01CX03', form: 'Injection' },
  { name: 'Nifurtimox', category: 'Antitrypanosomal', atc: 'P01CC01', form: 'Tablet' },
  { name: 'Fexinidazole', category: 'Antitrypanosomal', atc: 'P01CA03', form: 'Tablet' },
  { name: 'Artemether (injection)', category: 'Antimalarial', atc: 'P01BE02', form: 'Injection' },
  { name: 'Artesunate (suppository)', category: 'Antimalarial', atc: 'P01BE03', form: 'Suppository' },
  { name: 'Dihydroartemisinin + piperaquine', category: 'Antimalarial', atc: 'P01BF05', form: 'Tablet' },
  { name: 'Mefloquine', category: 'Antimalarial', atc: 'P01BC02', form: 'Tablet' },
  { name: 'Chloroquine', category: 'Antimalarial', atc: 'P01BA01', form: 'Tablet', note: 'Not for falciparum malaria: resistance is widespread.' },
  { name: 'Pyrimethamine', category: 'Antiparasitic', atc: 'P01BD01', form: 'Tablet' },
  { name: 'Tinidazole', category: 'Antiparasitic', atc: 'P01AB02', form: 'Tablet' },
  { name: 'Niclosamide', category: 'Antiparasitic', atc: 'P02DA01', form: 'Tablet' },
  { name: 'Diethylcarbamazine', category: 'Antiparasitic', atc: 'P02CB02', form: 'Tablet' },

  // ── Critical care, blood and cardiovascular ──
  { name: 'Noradrenaline (norepinephrine)', category: 'Emergency', atc: 'C01CA03', form: 'Injection' },
  { name: 'Dopamine', category: 'Emergency', atc: 'C01CA04', form: 'Infusion' },
  { name: 'Amiodarone', category: 'Antiarrhythmic', atc: 'C01BD01', form: 'Tablet / Injection' },
  { name: 'Adenosine', category: 'Antiarrhythmic', atc: 'C01EB10', form: 'Injection' },
  { name: 'Sodium bicarbonate', category: 'Electrolyte', atc: 'B05XA02', form: 'Injection' },
  { name: 'Potassium chloride', category: 'Electrolyte', atc: 'B05XA01', form: 'Injection' },
  { name: 'Mannitol', category: 'Diuretic', atc: 'B05BC01', form: 'Infusion' },
  { name: 'Water for injection', category: 'Diluent', atc: 'V07AB', form: 'Injection' },
  { name: 'Dextran 70', category: 'Plasma expander', atc: 'B05AA05', form: 'Infusion' },
  { name: "Darrow's solution", category: 'IV fluid', atc: 'B05BB', form: 'Infusion' },
  { name: 'Heparin', category: 'Anticoagulant', atc: 'B01AB01', form: 'Injection' },
  { name: 'Enoxaparin', category: 'Anticoagulant', atc: 'B01AB05', form: 'Injection' },
  { name: 'Tranexamic acid', category: 'Antifibrinolytic', atc: 'B02AA02', form: 'Injection' },
  { name: 'Hydroxocobalamin (vitamin B12)', category: 'Haematinic', atc: 'B03BA03', form: 'Injection' },
  { name: 'Glyceryl trinitrate', category: 'Antianginal', atc: 'C01DA02', form: 'Sublingual tablet' },
  { name: 'Isosorbide dinitrate', category: 'Antianginal', atc: 'C01DA08', form: 'Tablet' },
  { name: 'Clopidogrel', category: 'Antiplatelet', atc: 'B01AC04', form: 'Tablet' },
  { name: 'Propranolol', category: 'Beta-blocker', atc: 'C07AA05', form: 'Tablet' },
  { name: 'Carvedilol', category: 'Beta-blocker', atc: 'C07AG02', form: 'Tablet' },
  { name: 'Labetalol', category: 'Antihypertensive (emergency)', atc: 'C07AG01', form: 'Tablet / Injection' },
  { name: 'Captopril', category: 'Antihypertensive', atc: 'C09AA01', form: 'Tablet' },
  { name: 'Losartan', category: 'Antihypertensive', atc: 'C09CA01', form: 'Tablet' },
  { name: 'Spironolactone', category: 'Diuretic', atc: 'C03DA01', form: 'Tablet' },
  { name: 'Bendroflumethiazide', category: 'Diuretic', atc: 'C03AA01', form: 'Tablet' },

  // ── Maternal care and family planning ──
  { name: 'Ergometrine', category: 'Uterotonic', atc: 'G02AB03', form: 'Injection' },
  { name: 'Carbetocin', category: 'Uterotonic', atc: 'H01BB03', form: 'Injection' },
  { name: 'Mifepristone', category: 'Antiprogestogen', atc: 'G03XB01', form: 'Tablet' },
  { name: 'Clomifene', category: 'Ovulation inducer', atc: 'G03GB02', form: 'Tablet' },
  { name: 'Ethinylestradiol + Levonorgestrel', category: 'Contraceptive', atc: 'G03AA07', form: 'Tablet' },
  { name: 'Ethinylestradiol + Levonorgestrel + Ferrous fumarate', category: 'Contraceptive', atc: 'G03AA07', form: 'Tablet' },
  { name: 'Ethinylestradiol + Desogestrel', category: 'Contraceptive', atc: 'G03AA09', form: 'Tablet' },
  { name: 'Ethinylestradiol + Norethisterone', category: 'Contraceptive', atc: 'G03AA05', form: 'Tablet' },
  { name: 'Ethinylestradiol + Norgestrel', category: 'Contraceptive', atc: 'G03AA06', form: 'Tablet' },
  { name: 'Levonorgestrel (emergency contraception)', category: 'Contraceptive', atc: 'G03AD01', form: 'Tablet' },
  { name: 'Levonorgestrel (progestogen-only pill)', category: 'Contraceptive', atc: 'G03AC03', form: 'Tablet' },
  { name: 'Norethindrone (progestogen-only pill)', category: 'Contraceptive', atc: 'G03AC01', form: 'Tablet' },
  { name: 'Lynestrenol', category: 'Contraceptive', atc: 'G03AC02', form: 'Tablet' },
  { name: 'Medroxyprogesterone acetate (DMPA-IM)', category: 'Contraceptive', atc: 'G03AC06', form: 'Injection' },
  { name: 'Medroxyprogesterone acetate (DMPA-SC)', category: 'Contraceptive', atc: 'G03AC06', form: 'Subcutaneous injection' },
  { name: 'Norethisterone enanthate', category: 'Contraceptive', atc: 'G03AC01', form: 'Oily injection' },
  { name: 'Norethisterone enanthate + Estradiol valerate', category: 'Contraceptive', atc: 'G03AA', form: 'Oily injection' },
  { name: 'Etonogestrel implant', category: 'Contraceptive', atc: 'G03AC08', form: 'Implant' },
  { name: 'Levonorgestrel implant', category: 'Contraceptive', atc: 'G03AC03', form: 'Implant' },
  { name: 'Copper intrauterine device (TCu380A)', category: 'Contraceptive', atc: 'G02BA02', form: 'Intrauterine device' },
  { name: 'Levonorgestrel intrauterine system', category: 'Contraceptive', atc: 'G02BA03', form: 'Intrauterine device' },
  { name: 'Condom, male', category: 'Contraceptive', atc: '', form: 'Latex' },
  { name: 'Condom, female', category: 'Contraceptive', atc: '', form: 'Polyurethane, latex or nitrile' },
  { name: 'Medroxyprogesterone acetate (tablet)', category: 'Progestogen', atc: 'G03DA02', form: 'Tablet' },
  { name: 'Norethisterone (tablet)', category: 'Progestogen', atc: 'G03DC02', form: 'Tablet' },

  // ── Endocrine ──
  { name: 'Biphasic isophane insulin', category: 'Antidiabetic', atc: 'A10AD01', form: 'Injection' },
  { name: 'Insulin zinc suspension', category: 'Antidiabetic', atc: 'A10AC', form: 'Injection' },
  { name: 'Gliclazide', category: 'Antidiabetic', atc: 'A10BB09', form: 'Tablet' },
  { name: 'Glimepiride', category: 'Antidiabetic', atc: 'A10BB12', form: 'Tablet' },
  { name: 'Carbimazole', category: 'Thyroid', atc: 'H03BB01', form: 'Tablet' },
  { name: "Lugol's iodine (iodine + potassium iodide)", category: 'Thyroid', atc: 'H03CA', form: 'Oral solution' },
  { name: 'Corticotrophin (ACTH)', category: 'Corticosteroid', atc: 'H01AA01', form: 'Injection' },
  { name: 'Cortisone', category: 'Corticosteroid', atc: 'H02AB10', form: 'Tablet' },
  { name: 'Methylprednisolone', category: 'Corticosteroid', atc: 'H02AB04', form: 'Injection' },
  { name: 'Triamcinolone', category: 'Corticosteroid', atc: 'H02AB08', form: 'Injection' },
  { name: 'Betamethasone', category: 'Corticosteroid', atc: 'H02AB01', form: 'Injection' },
  { name: 'Methyltestosterone', category: 'Androgen', atc: 'G03BA02', form: 'Tablet' },
  { name: 'Testosterone enanthate', category: 'Androgen', atc: 'G03BA03', form: 'Injection' },

  // ── Neurology and mental health ──
  { name: 'Ethosuximide', category: 'Antiepileptic', atc: 'N03AD01', form: 'Capsule' },
  { name: 'Lamotrigine', category: 'Antiepileptic', atc: 'N03AX09', form: 'Tablet' },
  { name: 'Levetiracetam', category: 'Antiepileptic', atc: 'N03AX14', form: 'Tablet' },
  { name: 'Diazepam (rectal tube)', category: 'Benzodiazepine', atc: 'N05BA01', form: 'Rectal tube' },
  { name: 'Ergotamine', category: 'Antimigraine', atc: 'N02CA02', form: 'Tablet' },
  { name: 'Biperiden', category: 'Anti-parkinsonism', atc: 'N04AA02', form: 'Tablet' },
  { name: 'Trihexyphenidyl (benzhexol)', category: 'Anti-parkinsonism', atc: 'N04AA01', form: 'Tablet' },
  { name: 'Benztropine', category: 'Anti-parkinsonism', atc: 'N04AC01', form: 'Injection' },
  { name: 'Levodopa + carbidopa', category: 'Anti-parkinsonism', atc: 'N04BA02', form: 'Tablet' },
  { name: 'Fluphenazine decanoate', category: 'Antipsychotic', atc: 'N05AB02', form: 'Oily injection' },
  { name: 'Haloperidol decanoate', category: 'Antipsychotic', atc: 'N05AD01', form: 'Oily injection' },
  { name: 'Risperidone', category: 'Antipsychotic', atc: 'N05AX08', form: 'Tablet' },
  { name: 'Olanzapine', category: 'Antipsychotic', atc: 'N05AH03', form: 'Tablet' },
  { name: 'Clozapine', category: 'Antipsychotic', atc: 'N05AH02', form: 'Tablet' },
  { name: 'Imipramine', category: 'Antidepressant', atc: 'N06AA02', form: 'Tablet' },
  { name: 'Clomipramine', category: 'Antidepressant', atc: 'N06AA04', form: 'Capsule' },
  { name: 'Sertraline', category: 'Antidepressant', atc: 'N06AB06', form: 'Tablet' },
  { name: 'Lithium carbonate', category: 'Mood stabiliser', atc: 'N05AN01', form: 'Tablet' },
  { name: 'Methadone', category: 'Opioid dependence', atc: 'N07BC02', form: 'Oral liquid' },
  { name: 'Nicotine replacement gum', category: 'Smoking cessation', atc: 'N07BA01', form: 'Gum' },

  // ── Gastrointestinal and respiratory ──
  { name: 'Magnesium trisilicate', category: 'Antacid / PPI', atc: 'A02AA05', form: 'Tablet' },
  { name: 'Doxylamine + pyridoxine', category: 'Antiemetic', atc: 'R06AA59', form: 'Tablet' },
  { name: 'Bisacodyl', category: 'Laxative', atc: 'A06AB02', form: 'Tablet / Suppository' },
  { name: 'Docusate sodium', category: 'Laxative', atc: 'A06AA02', form: 'Capsule' },
  { name: 'Lactulose', category: 'Laxative', atc: 'A06AD11', form: 'Solution' },
  { name: 'Liquid paraffin', category: 'Laxative', atc: 'A06AA01', form: 'Oral emulsion' },
  { name: 'Senna', category: 'Laxative', atc: 'A06AB06', form: 'Tablet' },
  { name: 'Loratadine', category: 'Antihistamine', atc: 'R06AX13', form: 'Tablet' },
  { name: 'Ipratropium bromide', category: 'Bronchodilator', atc: 'R03BB01', form: 'Inhaler' },
  { name: 'Xylometazoline', category: 'Decongestant', atc: 'R01AA07', form: 'Nasal drops' },

  // ── Vitamins, minerals and nutrition ──
  { name: 'Ascorbic acid (vitamin C)', category: 'Supplement', atc: 'A11GA01', form: 'Tablet' },
  { name: 'Calcium lactate', category: 'Supplement', atc: 'A12AA05', form: 'Tablet' },
  { name: 'Calcium carbonate', category: 'Supplement', atc: 'A12AA04', form: 'Tablet' },
  { name: 'Pyridoxine (vitamin B6)', category: 'Supplement', atc: 'A11HA02', form: 'Tablet' },
  { name: 'Thiamine (vitamin B1)', category: 'Supplement', atc: 'A11DA01', form: 'Tablet' },
  { name: 'Ergocalciferol (vitamin D2)', category: 'Supplement', atc: 'A11CC01', form: 'Tablet' },
  { name: 'Therapeutic milk F-75', category: 'Nutrition', atc: 'V06DX', form: 'Powder' },
  { name: 'Therapeutic milk F-100', category: 'Nutrition', atc: 'V06DX', form: 'Powder' },
  { name: 'Ready-to-use therapeutic food (RUTF)', category: 'Nutrition', atc: 'V06DX', form: 'Paste' },
  { name: 'Lipid-based nutrient supplement (RUSF)', category: 'Nutrition', atc: 'V06DX', form: 'Sachet' },
  { name: 'Fortified blended food (CSB++)', category: 'Nutrition', atc: 'V06DX', form: 'Packet' },
  { name: 'ReSoMal', category: 'Rehydration', atc: 'A07CA', form: 'Sachet' },

  // ── Gout and joints ──
  { name: 'Allopurinol', category: 'Antigout', atc: 'M04AA01', form: 'Tablet' },
  { name: 'Colchicine', category: 'Antigout', atc: 'M04AC01', form: 'Tablet' },

  // ── Immunosuppressants and cancer care ──
  { name: 'Azathioprine', category: 'Immunosuppressant', atc: 'L04AX01', form: 'Tablet / Injection' },
  { name: 'Ciclosporin', category: 'Immunosuppressant', atc: 'L04AD01', form: 'Capsule / Infusion' },
  { name: 'Thalidomide', category: 'Immunosuppressant', atc: 'L04AX02', form: 'Capsule' },
  { name: 'Anastrozole', category: 'Antineoplastic', atc: 'L02BG03', form: 'Tablet' },
  { name: 'Bicalutamide', category: 'Antineoplastic', atc: 'L02BB03', form: 'Tablet' },
  { name: 'Bleomycin', category: 'Antineoplastic', atc: 'L01DC01', form: 'Injection' },
  { name: 'Calcium folinate (folinic acid)', category: 'Antineoplastic adjuvant', atc: 'V03AF03', form: 'Tablet / Injection' },
  { name: 'Capecitabine', category: 'Antineoplastic', atc: 'L01BC06', form: 'Tablet' },
  { name: 'Carboplatin', category: 'Antineoplastic', atc: 'L01XA02', form: 'Injection' },
  { name: 'Chlorambucil', category: 'Antineoplastic', atc: 'L01AA02', form: 'Tablet' },
  { name: 'Cisplatin', category: 'Antineoplastic', atc: 'L01XA01', form: 'Injection' },
  { name: 'Cyclophosphamide', category: 'Antineoplastic', atc: 'L01AA01', form: 'Capsule / Injection' },
  { name: 'Cytarabine', category: 'Antineoplastic', atc: 'L01BC01', form: 'Injection' },
  { name: 'Dacarbazine', category: 'Antineoplastic', atc: 'L01AX04', form: 'Injection' },
  { name: 'Dactinomycin', category: 'Antineoplastic', atc: 'L01DA01', form: 'Injection' },
  { name: 'Daunorubicin', category: 'Antineoplastic', atc: 'L01DB02', form: 'Injection' },
  { name: 'Docetaxel', category: 'Antineoplastic', atc: 'L01CD02', form: 'Infusion' },
  { name: 'Doxorubicin', category: 'Antineoplastic', atc: 'L01DB01', form: 'Injection' },
  { name: 'Etoposide', category: 'Antineoplastic', atc: 'L01CB01', form: 'Injection' },
  { name: 'Filgrastim', category: 'Antineoplastic adjuvant', atc: 'L03AA02', form: 'Injection' },
  { name: 'Fluorouracil', category: 'Antineoplastic', atc: 'L01BC02', form: 'Injection' },
  { name: 'Gemcitabine', category: 'Antineoplastic', atc: 'L01BC05', form: 'Injection' },
  { name: 'Goserelin', category: 'Antineoplastic', atc: 'L02AE03', form: 'Injection / Implant' },
  { name: 'Hydroxycarbamide (hydroxyurea)', category: 'Antineoplastic', atc: 'L01XX05', form: 'Capsule' },
  { name: 'Ifosfamide + mesna', category: 'Antineoplastic', atc: 'L01AA06', form: 'Injection' },
  { name: 'Imatinib', category: 'Antineoplastic', atc: 'L01EA01', form: 'Tablet' },
  { name: 'Irinotecan', category: 'Antineoplastic', atc: 'L01CE02', form: 'Infusion' },
  { name: 'L-asparaginase', category: 'Antineoplastic', atc: 'L01XX02', form: 'Injection' },
  { name: 'Mercaptopurine', category: 'Antineoplastic', atc: 'L01BB02', form: 'Tablet' },
  { name: 'Mitomycin', category: 'Antineoplastic', atc: 'L01DC03', form: 'Injection' },
  { name: 'Mustine (chlormethine)', category: 'Antineoplastic', atc: 'L01AA05', form: 'Injection', note: 'Rarely used now. Confirm the regimen with a specialist.' },
  { name: 'Oxaliplatin', category: 'Antineoplastic', atc: 'L01XA03', form: 'Injection' },
  { name: 'Paclitaxel', category: 'Antineoplastic', atc: 'L01CD01', form: 'Injection' },
  { name: 'Procarbazine', category: 'Antineoplastic', atc: 'L01XB01', form: 'Capsule' },
  { name: 'Rituximab', category: 'Antineoplastic', atc: 'L01FA01', form: 'Infusion' },
  { name: 'Stilboestrol', category: 'Antineoplastic', atc: 'G03CB02', form: 'Tablet', note: 'Largely abandoned for safety reasons. Confirm the indication with a specialist.' },
  { name: 'Tamoxifen', category: 'Antineoplastic', atc: 'L02BA01', form: 'Tablet' },
  { name: 'Temozolomide', category: 'Antineoplastic', atc: 'L01AX03', form: 'Capsule' },
  { name: 'Tioguanine', category: 'Antineoplastic', atc: 'L01BB03', form: 'Tablet' },
  { name: 'Vinblastine', category: 'Antineoplastic', atc: 'L01CA01', form: 'Injection' },
  { name: 'Vincristine', category: 'Antineoplastic', atc: 'L01CA02', form: 'Injection' },

  // ── Skin, wound and antiseptics ──
  { name: 'Benzoic acid + salicylic acid', category: 'Dermatological', atc: 'D01AE20', form: 'Ointment' },
  { name: 'Sulphur + salicylic acid', category: 'Dermatological', atc: 'D10AB', form: 'Cream / Ointment' },
  { name: 'Salicylic acid', category: 'Dermatological', atc: 'D02AF', form: 'Ointment' },
  { name: 'Benzoyl peroxide', category: 'Dermatological', atc: 'D10AE01', form: 'Lotion / Cream' },
  { name: 'Coal tar', category: 'Dermatological', atc: 'D05AA', form: 'Solution' },
  { name: 'Podophyllum resin', category: 'Dermatological', atc: 'D06BB04', form: 'Solution' },
  { name: 'Calamine', category: 'Dermatological', atc: 'D02AB', form: 'Lotion' },
  { name: 'Betamethasone (topical)', category: 'Dermatological', atc: 'D07AC01', form: 'Cream / Ointment' },
  { name: 'Hydrocortisone (topical)', category: 'Dermatological', atc: 'D07AA02', form: 'Cream / Ointment' },
  { name: 'Nystatin (topical)', category: 'Antifungal', atc: 'D01AA01', form: 'Cream / Ointment' },
  { name: 'Nystatin (pessary)', category: 'Antifungal', atc: 'G01AA01', form: 'Pessary' },
  { name: 'Silver sulfadiazine', category: 'Dermatological', atc: 'D06BA01', form: 'Cream' },
  { name: 'Gentian violet (methylrosanilinium chloride)', category: 'Antiseptic', atc: 'D01AE02', form: 'Paint' },
  { name: 'Potassium permanganate', category: 'Antiseptic', atc: 'D08AX06', form: 'Aqueous solution' },
  { name: 'Benzyl benzoate', category: 'Scabicide', atc: 'P03AX01', form: 'Lotion' },
  { name: 'Permethrin', category: 'Scabicide', atc: 'P03AC04', form: 'Cream / Solution' },
  { name: 'Chlorhexidine (cord care)', category: 'Antiseptic', atc: 'D08AC02', form: 'Gel' },
  { name: 'Chlorhexidine (skin)', category: 'Antiseptic', atc: 'D08AC02', form: 'Cream / Solution' },
  { name: 'Chlorhexidine gluconate (mouthwash)', category: 'Antiseptic', atc: 'A01AB03', form: 'Mouthwash' },
  { name: 'Cetrimide + chlorhexidine', category: 'Antiseptic', atc: 'D08AC52', form: 'Solution' },
  { name: 'Hydrogen peroxide', category: 'Antiseptic', atc: 'D08AX01', form: 'Solution' },
  { name: 'Povidone iodine', category: 'Antiseptic', atc: 'D08AG02', form: 'Solution' },
  { name: 'Ethanol 70%', category: 'Antiseptic', atc: 'D08AX08', form: 'Solution' },
  { name: 'Alcohol hand rub', category: 'Disinfectant', atc: 'D08AX', form: 'Solution' },
  { name: 'Calcium or sodium hypochlorite', category: 'Disinfectant', atc: 'D08AX07', form: 'Solution' },
  { name: 'Glutaraldehyde', category: 'Disinfectant', atc: 'V07AV', form: 'Solution' },
  { name: 'Water purification tablet (NaDCC)', category: 'Disinfectant', atc: 'V07AV', form: 'Tablet' },

  // ── Eye and ear ──
  { name: 'Chloramphenicol eye ointment', category: 'Ophthalmic', atc: 'S01AA01', form: 'Eye ointment' },
  { name: 'Ciprofloxacin eye drops', category: 'Ophthalmic', atc: 'S01AE03', form: 'Eye drops' },
  { name: 'Ciprofloxacin ear drops', category: 'Otic', atc: 'S02AA15', form: 'Ear drops' },
  { name: 'Gentamicin eye/ear drops', category: 'Ophthalmic', atc: 'S01AA11', form: 'Drops' },
  { name: 'Povidone iodine eye drops', category: 'Ophthalmic', atc: 'S01AX18', form: 'Eye drops' },
  { name: 'Tetracycline eye ointment', category: 'Ophthalmic', atc: 'S01AA09', form: 'Eye ointment' },
  { name: 'Aciclovir eye ointment', category: 'Ophthalmic', atc: 'S01AD03', form: 'Eye ointment' },
  { name: 'Econazole eye drops', category: 'Ophthalmic', atc: 'S01AX', form: 'Eye drops' },
  { name: 'Dexamethasone + tobramycin eye drops', category: 'Ophthalmic', atc: 'S01CA01', form: 'Eye drops' },
  { name: 'Hydrocortisone + oxytetracycline + polymyxin B eye drops', category: 'Ophthalmic', atc: 'S01CA', form: 'Eye drops' },
  { name: 'Hydrocortisone eye ointment', category: 'Ophthalmic', atc: 'S01BA02', form: 'Eye ointment' },
  { name: 'Prednisolone eye drops', category: 'Ophthalmic', atc: 'S01BA04', form: 'Eye drops' },
  { name: 'Betamethasone eye/ear drops', category: 'Ophthalmic', atc: 'S01BA06', form: 'Drops' },
  { name: 'Tetracaine eye drops', category: 'Ophthalmic', atc: 'S01HA03', form: 'Eye drops' },
  { name: 'Acetazolamide', category: 'Antiglaucoma', atc: 'S01EC01', form: 'Tablet' },
  { name: 'Pilocarpine eye drops', category: 'Antiglaucoma', atc: 'S01EB01', form: 'Eye drops' },
  { name: 'Timolol eye drops', category: 'Antiglaucoma', atc: 'S01ED01', form: 'Eye drops' },
  { name: 'Atropine eye drops', category: 'Ophthalmic', atc: 'S01FA01', form: 'Eye drops' },
  { name: 'Cyclopentolate eye drops', category: 'Ophthalmic', atc: 'S01FA04', form: 'Eye drops' },
  { name: 'Phenylephrine eye drops', category: 'Ophthalmic', atc: 'S01FB01', form: 'Eye drops' },
  { name: 'Tropicamide eye drops', category: 'Diagnostic agent', atc: 'S01FA06', form: 'Eye drops' },
  { name: 'Fluorescein eye drops', category: 'Diagnostic agent', atc: 'S01JA01', form: 'Eye drops' },
  { name: 'Rose bengal eye drops', category: 'Diagnostic agent', atc: 'S01JA02', form: 'Eye drops' },
  { name: 'Physostigmine eye drops', category: 'Antiglaucoma', atc: 'S01EB05', form: 'Eye drops' },

  // ── Contrast media and dialysis ──
  { name: 'Barium sulfate (contrast medium)', category: 'Contrast medium', atc: 'V08BA02', form: 'Powder' },
  { name: 'Iohexol (contrast medium)', category: 'Contrast medium', atc: 'V08AB02', form: 'Injection' },
  { name: 'Amidotrizoate (contrast medium)', category: 'Contrast medium', atc: 'V08AA01', form: 'Injection' },
  { name: 'Peritoneal dialysis solution', category: 'Dialysis', atc: 'B05DB', form: 'Solution' },
  { name: 'Haemodialysis concentrate', category: 'Dialysis', atc: 'B05ZA', form: 'Liquid' },
];

/**
 * Backward-compatible `{ name, category }` list derived from the formulary, so
 * existing consumers (pharmacy, consultation search) keep working while the
 * real EML dataset lives in one place.
 */
export const medications: { name: string; category: string }[] =
  FORMULARY.map(({ name, category }) => ({ name, category }));

// Words shared by unrelated medicines, so they identify nothing on their own.
const SHARED_FIRST_WORDS = new Set([
  'sodium', 'potassium', 'calcium', 'magnesium', 'ferrous', 'vitamin', 'oral', 'water', 'liquid', 'normal', 'human',
]);

const headOf = (drug: FormularyDrug) => drug.name.split(' (')[0].toLowerCase();

/**
 * The formulary line a medication name refers to. The exact name first, then
 * the longest listed name inside it, so "Sodium bicarbonate 8.4%" is never read
 * as sodium valproate. A first word only decides when it names one medicine.
 */
export function findFormularyDrug(name: string): FormularyDrug | undefined {
  const n = (name || '').trim().toLowerCase();
  if (!n) return undefined;
  const exact = FORMULARY.find(d => d.name.toLowerCase() === n);
  if (exact) return exact;
  const contained = FORMULARY.filter(d => n.includes(headOf(d)))
    .sort((a, b) => headOf(b).length - headOf(a).length)[0];
  if (contained) return contained;
  if (n.length >= 3) {
    const within = FORMULARY.find(d => d.name.toLowerCase().includes(n));
    if (within) return within;
  }
  return FORMULARY.find(d => {
    const first = d.name.split(' ')[0].toLowerCase();
    return !SHARED_FIRST_WORDS.has(first) && n.includes(first);
  });
}

/** ATC class code for a medication name. */
export function atcForMedication(name: string): string | undefined {
  return findFormularyDrug(name)?.atc || undefined;
}

/** A medicine the prescriber typed because it is not on this list. */
export function offFormularyDrug(name: string): FormularyDrug {
  return { name: name.trim(), category: OFF_FORMULARY_CATEGORY, atc: '' };
}

/**
 * ATC classes whose medicines are controlled: opioid analgesics and
 * anaesthetics, opium-alkaloid antitussives (codeine), opioid-dependence
 * agents, benzodiazepines (anxiolytic, hypnotic, antiepileptic), z-drugs,
 * barbiturates, centrally acting stimulants, and ketamine.
 */
const CONTROLLED_ATC_PREFIXES = [
  'N02A', 'N01AH', 'N01AF', 'R05DA', 'N07BC', 'N05BA', 'N05CD', 'N05CF', 'N03AE', 'N03AA', 'N06BA', 'N01AX03',
];

/**
 * Controlled ingredients a prescriber may type that this list does not carry
 * as formulary lines. Kept beside the formulary so the knowledge has one home.
 */
const CONTROLLED_INGREDIENTS_NOT_LISTED = [
  'buprenorphine', 'oxycodone', 'hydromorphone', 'dihydrocodeine', 'pentazocine', 'lorazepam', 'clonazepam',
  'alprazolam', 'bromazepam', 'nitrazepam', 'zolpidem', 'methylphenidate',
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
