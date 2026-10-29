import type { FacilityLevel } from './db-types';

// ICD-11 code with facility level support
export interface ICD11CodeEntry {
  code: string;
  title: string;
  chapter: string;
  /** Minimum facility level where this diagnosis can be confirmed */
  minLevel?: FacilityLevel;
  /** Whether this code is commonly used for cause-of-death certification */
  causeOfDeath?: boolean;
  /** Whether this is a notifiable disease (must be reported to DHIS2) */
  notifiable?: boolean;
  /** Common synonyms or local names for search */
  keywords?: string[];
}

// Common ICD-11 codes for South Sudan context. Every code was checked against
// the WHO ICD-11 MMS tabulation (LinearizationMiniOutput-MMS-en, 2026-10-28);
// 54 of the earlier entries named the wrong condition (e.g. epilepsy filed
// under 6A20, which is schizophrenia).
// — expanded for clinical diagnosis use
// Covers both cause-of-death AND clinical diagnosis at all facility levels
export const COMMON_ICD11_CODES: ICD11CodeEntry[] = [
  // ===== INFECTIOUS DISEASES (highest burden in South Sudan) =====
  { code: '1F40', title: 'Malaria due to Plasmodium falciparum', chapter: 'Infectious diseases', minLevel: 'boma', causeOfDeath: true, notifiable: true, keywords: ['malaria', 'fever', 'chills'] },
  { code: '1F41', title: 'Malaria due to Plasmodium vivax', chapter: 'Infectious diseases', minLevel: 'payam', notifiable: true, keywords: ['vivax', 'malaria'] },
  { code: '1F4Z', title: 'Malaria, unspecified', chapter: 'Infectious diseases', minLevel: 'boma', notifiable: true, keywords: ['malaria', 'suspected malaria'] },
  { code: '1B10', title: 'Tuberculosis of the respiratory system', chapter: 'Infectious diseases', minLevel: 'county', causeOfDeath: true, notifiable: true, keywords: ['tb', 'tuberculosis', 'cough'] },
  { code: '1B12', title: 'Tuberculosis of other systems or organs (extrapulmonary)', chapter: 'Infectious diseases', minLevel: 'state', causeOfDeath: true, notifiable: true },
  { code: '1C62', title: 'HIV disease', chapter: 'Infectious diseases', minLevel: 'payam', causeOfDeath: true, notifiable: true, keywords: ['hiv', 'aids'] },
  { code: '1C62.Z', title: 'HIV disease, unspecified', chapter: 'Infectious diseases', minLevel: 'payam', notifiable: true },
  { code: '1A00', title: 'Cholera', chapter: 'Infectious diseases', minLevel: 'boma', causeOfDeath: true, notifiable: true, keywords: ['cholera', 'watery diarrhea'] },
  { code: '1A07', title: 'Typhoid fever', chapter: 'Infectious diseases', minLevel: 'payam', causeOfDeath: true, notifiable: true, keywords: ['typhoid', 'enteric fever'] },
  { code: '1F03', title: 'Measles', chapter: 'Infectious diseases', minLevel: 'boma', causeOfDeath: true, notifiable: true, keywords: ['measles', 'rash', 'rubella'] },
  { code: '1E51.0', title: 'Chronic hepatitis B', chapter: 'Infectious diseases', minLevel: 'county', causeOfDeath: true, notifiable: true },
  { code: '1E51.1', title: 'Chronic hepatitis C', chapter: 'Infectious diseases', minLevel: 'county', notifiable: true },
  { code: '1F54.0', title: 'Visceral leishmaniasis (Kala-azar)', chapter: 'Infectious diseases', minLevel: 'county', causeOfDeath: true, notifiable: true, keywords: ['kala-azar', 'visceral leishmaniasis'] },
  { code: '1D01', title: 'Infectious meningitis', chapter: 'Infectious diseases', minLevel: 'county', causeOfDeath: true, notifiable: true, keywords: ['meningitis', 'neck stiffness'] },
  { code: '1E50', title: 'Acute viral hepatitis', chapter: 'Infectious diseases', minLevel: 'payam', notifiable: true },
  { code: '1D47', title: 'Yellow fever', chapter: 'Infectious diseases', minLevel: 'payam', notifiable: true, keywords: ['yellow fever', 'jaundice'] },
  { code: '1C82', title: 'Rabies', chapter: 'Infectious diseases', minLevel: 'county', causeOfDeath: true, notifiable: true, keywords: ['rabies', 'dog bite'] },
  { code: '1C13', title: 'Tetanus', chapter: 'Infectious diseases', minLevel: 'county', causeOfDeath: true, notifiable: true, keywords: ['tetanus', 'lockjaw'] },

  // ===== DIARRHEAL & GI DISEASES =====
  { code: '1A40', title: 'Diarrhoeal disease (gastroenteritis)', chapter: 'Digestive system', minLevel: 'boma', causeOfDeath: true, keywords: ['diarrhea', 'loose stool', 'gastroenteritis'] },
  { code: '1A02', title: 'Dysentery (shigellosis)', chapter: 'Digestive system', minLevel: 'boma', notifiable: true, keywords: ['dysentery', 'bloody diarrhea'] },
  { code: '1F9Z', title: 'Intestinal worms (Helminthiasis)', chapter: 'Digestive system', minLevel: 'boma', keywords: ['worms', 'parasites'] },

  // ===== RESPIRATORY =====
  { code: 'CA40', title: 'Pneumonia', chapter: 'Respiratory system', minLevel: 'boma', causeOfDeath: true, keywords: ['pneumonia', 'chest infection', 'breathing difficulty'] },
  { code: 'CA07', title: 'Acute upper respiratory infection', chapter: 'Respiratory system', minLevel: 'boma', keywords: ['cold', 'cough', 'sore throat', 'URTI'] },
  { code: 'CA22', title: 'Chronic obstructive pulmonary disease', chapter: 'Respiratory system', minLevel: 'county', causeOfDeath: true },
  { code: 'CA23', title: 'Asthma', chapter: 'Respiratory system', minLevel: 'payam', keywords: ['asthma', 'wheeze'] },

  // ===== CIRCULATORY =====
  { code: 'BA6Z', title: 'Ischaemic heart disease', chapter: 'Circulatory system', minLevel: 'state', causeOfDeath: true },
  { code: '8B20', title: 'Stroke', chapter: 'Neurological', minLevel: 'state', causeOfDeath: true, keywords: ['stroke', 'CVA'] },
  { code: 'BA01', title: 'Hypertensive heart disease', chapter: 'Circulatory system', minLevel: 'payam', causeOfDeath: true, keywords: ['hypertension', 'high blood pressure'] },
  { code: 'BA00', title: 'Essential hypertension', chapter: 'Circulatory system', minLevel: 'payam', keywords: ['hypertension', 'high BP'] },

  // ===== NUTRITIONAL =====
  { code: '5B7Z', title: 'Undernutrition (malnutrition)', chapter: 'Nutritional deficiencies', minLevel: 'boma', causeOfDeath: true, keywords: ['malnutrition', 'wasting', 'MUAC'] },
  { code: '5B51', title: 'Acute malnutrition (wasting): SAM or MAM', chapter: 'Nutritional deficiencies', minLevel: 'boma', causeOfDeath: true, notifiable: true, keywords: ['SAM', 'MAM', 'kwashiorkor', 'marasmus', 'acute malnutrition', 'wasting'] },
  { code: '3A00', title: 'Iron deficiency anaemia', chapter: 'Blood diseases', minLevel: 'payam', causeOfDeath: true, keywords: ['anemia', 'anaemia', 'pale'] },
  { code: '5B55', title: 'Vitamin A deficiency', chapter: 'Nutritional deficiencies', minLevel: 'payam', keywords: ['night blindness'] },

  // ===== PREGNANCY & CHILDBIRTH =====
  { code: 'JA43', title: 'Postpartum haemorrhage', chapter: 'Pregnancy/childbirth', minLevel: 'payam', causeOfDeath: true, notifiable: true, keywords: ['PPH', 'bleeding'] },
  { code: 'JB40.0', title: 'Puerperal sepsis', chapter: 'Pregnancy/childbirth', minLevel: 'county', causeOfDeath: true, notifiable: true },
  { code: 'JA24', title: 'Pre-eclampsia', chapter: 'Pregnancy/childbirth', minLevel: 'payam', causeOfDeath: true, notifiable: true, keywords: ['eclampsia', 'fits in pregnancy'] },
  { code: 'JB06', title: 'Obstructed labour', chapter: 'Pregnancy/childbirth', minLevel: 'payam', causeOfDeath: true, keywords: ['obstructed labour', 'prolonged labour'] },
  { code: 'JA01', title: 'Ectopic pregnancy', chapter: 'Pregnancy/childbirth', minLevel: 'county', causeOfDeath: true },
  { code: 'JA00.0', title: 'Spontaneous abortion', chapter: 'Pregnancy/childbirth', minLevel: 'payam', keywords: ['miscarriage'] },

  // ===== PERINATAL =====
  { code: 'KA60', title: 'Neonatal sepsis', chapter: 'Perinatal conditions', minLevel: 'payam', causeOfDeath: true, notifiable: true },
  { code: 'KB21', title: 'Birth asphyxia', chapter: 'Perinatal conditions', minLevel: 'payam', causeOfDeath: true },
  { code: 'KA21.4', title: 'Preterm newborn', chapter: 'Perinatal conditions', minLevel: 'payam', causeOfDeath: true },
  { code: 'KA21', title: 'Low birth weight or short gestation', chapter: 'Perinatal conditions', minLevel: 'payam', causeOfDeath: true },

  // ===== ENDOCRINE =====
  { code: '5A14', title: 'Diabetes mellitus, type unspecified', chapter: 'Endocrine diseases', minLevel: 'payam', causeOfDeath: true, keywords: ['diabetes', 'sugar'] },
  { code: '5A10', title: 'Type 1 diabetes mellitus', chapter: 'Endocrine diseases', minLevel: 'county' },
  { code: '5A11', title: 'Type 2 diabetes mellitus', chapter: 'Endocrine diseases', minLevel: 'payam', keywords: ['type 2 diabetes'] },

  // ===== SKIN & EYES =====
  { code: '1B7Z', title: 'Bacterial skin infection', chapter: 'Infectious diseases', minLevel: 'boma', keywords: ['skin infection', 'abscess', 'boil'] },
  { code: '9A60', title: 'Conjunctivitis', chapter: 'Eye diseases', minLevel: 'boma', keywords: ['red eye', 'eye infection'] },
  { code: '1C23', title: 'Trachoma', chapter: 'Eye diseases', minLevel: 'payam', notifiable: true, keywords: ['trachoma'] },

  // ===== MENTAL HEALTH =====
  { code: '6A7Z', title: 'Depressive disorder', chapter: 'Mental health', minLevel: 'payam', keywords: ['depression', 'sadness'] },
  { code: '6B40', title: 'Post-traumatic stress disorder', chapter: 'Mental health', minLevel: 'county', keywords: ['PTSD', 'trauma'] },
  { code: '8A6Z', title: 'Epilepsy or seizures', chapter: 'Neurological', minLevel: 'payam', keywords: ['epilepsy', 'seizure', 'fits'] },

  // ===== EXTERNAL CAUSES =====
  { code: 'PA0Z', title: 'Road traffic injury', chapter: 'External causes', minLevel: 'payam', causeOfDeath: true },
  { code: 'NF08.1', title: 'Drowning or nonfatal submersion', chapter: 'External causes', minLevel: 'payam', causeOfDeath: true },
  { code: 'PE3Z', title: 'Assault by sharp object', chapter: 'External causes', minLevel: 'payam', causeOfDeath: true },
  { code: 'PE20.Z', title: 'Assault by firearm', chapter: 'External causes', minLevel: 'payam', causeOfDeath: true },
  { code: 'PA78', title: 'Snakebite or other animal envenoming', chapter: 'External causes', minLevel: 'boma', causeOfDeath: true, keywords: ['snakebite', 'snake'] },
  { code: 'NE2Z', title: 'Burns', chapter: 'External causes', minLevel: 'payam', causeOfDeath: true, keywords: ['burn', 'scalding'] },

  // ===== NEOPLASMS =====
  { code: '2D4Z', title: 'Malignant neoplasm (cancer), site unspecified', chapter: 'Neoplasms', minLevel: 'state', causeOfDeath: true },
  { code: '2E00', title: "Kaposi's sarcoma", chapter: 'Neoplasms', minLevel: 'state', causeOfDeath: true },

  // ===== UROGENITAL =====
  { code: 'GC08', title: 'Urinary tract infection', chapter: 'Genitourinary', minLevel: 'payam', keywords: ['UTI', 'burning urination'] },
  { code: 'GB60', title: 'Acute kidney failure', chapter: 'Genitourinary', minLevel: 'county', causeOfDeath: true },

  // ===== STIs =====
  { code: '1A6Z', title: 'Syphilis', chapter: 'Infectious diseases', minLevel: 'payam', notifiable: true, keywords: ['syphilis'] },
  { code: '1A7Z', title: 'Gonorrhoea (gonococcal infection)', chapter: 'Infectious diseases', minLevel: 'payam', keywords: ['gonorrhea', 'discharge'] },
  // ===== ADDITIONAL COMMON PRESENTATIONS =====
  { code: 'RA01', title: 'COVID-19', chapter: 'Infectious diseases', minLevel: 'payam', notifiable: true, keywords: ['covid', 'coronavirus', 'sars-cov-2'] },
  { code: '1G40', title: 'Sepsis', chapter: 'Infectious diseases', minLevel: 'county', causeOfDeath: true, keywords: ['sepsis', 'septicaemia', 'blood infection'] },
  { code: '1F86', title: 'Schistosomiasis (Bilharzia)', chapter: 'Infectious diseases', minLevel: 'county', notifiable: true, keywords: ['schistosomiasis', 'bilharzia'] },
  { code: '3A51', title: 'Sickle cell disorders', chapter: 'Blood disorders', minLevel: 'county', causeOfDeath: true, keywords: ['sickle cell', 'crisis', 'anaemia'] },
  { code: 'BD1Z', title: 'Heart failure, unspecified', chapter: 'Circulatory', minLevel: 'county', causeOfDeath: true, keywords: ['heart failure', 'oedema', 'breathlessness'] },
  { code: '8A80', title: 'Migraine', chapter: 'Nervous system', minLevel: 'payam', keywords: ['migraine', 'headache'] },
  { code: '6B00', title: 'Generalised anxiety disorder', chapter: 'Mental health', minLevel: 'payam', keywords: ['anxiety', 'worry'] },
  { code: 'EA80', title: 'Atopic eczema (dermatitis)', chapter: 'Skin', minLevel: 'boma', keywords: ['eczema', 'dermatitis', 'rash', 'itch'] },
  { code: 'DA42', title: 'Gastritis', chapter: 'Digestive', minLevel: 'payam', keywords: ['gastritis', 'epigastric pain'] },
  { code: 'MG26', title: 'Fever of unknown origin', chapter: 'Symptoms & signs', minLevel: 'boma', keywords: ['fever', 'pyrexia'] },

  // ===== SYMPTOMS & SIGNS — physical exam findings (ICD-11 Chapter 21) =====
  // Verified against the WHO ICD-11 MMS browser (via findacode.com), not
  // inferred — these back the physical-exam "Search ICD findings" fields in
  // the consultation flow, so accuracy matters more than usual here.
  { code: 'MG22', title: 'Fatigue', chapter: 'Symptoms & signs', minLevel: 'boma', keywords: ['fatigue', 'tired', 'tiredness', 'lethargy'] },
  { code: 'MG29', title: 'Oedema', chapter: 'Symptoms & signs', minLevel: 'boma', keywords: ['edema', 'oedema', 'swelling'] },
  { code: 'MG45', title: 'Syncope or collapse', chapter: 'Symptoms & signs', minLevel: 'boma', keywords: ['syncope', 'fainting', 'collapse', 'passed out'] },
  { code: 'MC16', title: 'Pallor conjunctiva', chapter: 'Symptoms & signs', minLevel: 'boma', keywords: ['pallor', 'pale', 'anaemia sign'] },
  { code: 'MC83.Z', title: 'Cardiac murmurs or sounds, unspecified', chapter: 'Symptoms & signs', minLevel: 'boma', keywords: ['murmur', 'heart sound', 'cardiac bruit'] },
  { code: 'MC81.0', title: 'Tachycardia, unspecified', chapter: 'Symptoms & signs', minLevel: 'boma', keywords: ['tachycardia', 'fast heart rate', 'rapid pulse'] },
  { code: 'MC81.1', title: 'Bradycardia, unspecified', chapter: 'Symptoms & signs', minLevel: 'boma', keywords: ['bradycardia', 'slow heart rate', 'slow pulse'] },
  { code: 'ME64.1', title: 'Cyanosis', chapter: 'Symptoms & signs', minLevel: 'boma', keywords: ['cyanosis', 'bluish skin', 'blue lips'] },
  { code: 'MD11.C', title: 'Wheezing', chapter: 'Symptoms & signs', minLevel: 'boma', keywords: ['wheeze', 'wheezing'] },
  { code: 'MD11.5', title: 'Dyspnoea', chapter: 'Symptoms & signs', minLevel: 'boma', keywords: ['dyspnea', 'dyspnoea', 'shortness of breath', 'breathlessness'] },
  { code: 'MD12', title: 'Cough', chapter: 'Symptoms & signs', minLevel: 'boma', keywords: ['cough'] },
  { code: 'MD81.4', title: 'Other and unspecified abdominal pain', chapter: 'Symptoms & signs', minLevel: 'boma', keywords: ['abdominal pain', 'stomach pain', 'belly pain'] },
  { code: 'ME10.00', title: 'Hepatomegaly, not elsewhere classified', chapter: 'Symptoms & signs', minLevel: 'boma', keywords: ['hepatomegaly', 'enlarged liver'] },
  { code: 'ME10.01', title: 'Splenomegaly, not elsewhere classified', chapter: 'Symptoms & signs', minLevel: 'boma', keywords: ['splenomegaly', 'enlarged spleen'] },
  { code: 'MB4D', title: 'Headache, not elsewhere classified', chapter: 'Symptoms & signs', minLevel: 'boma', keywords: ['headache'] },
  { code: 'MB47', title: 'Abnormality of tonus or reflex', chapter: 'Symptoms & signs', minLevel: 'boma', keywords: ['reflex', 'abnormal reflex', 'tone', 'hypertonia', 'hypotonia'] },
  { code: 'MB20.2', title: 'Clouding of consciousness', chapter: 'Symptoms & signs', minLevel: 'boma', keywords: ['altered consciousness', 'confusion', 'obtunded'] },
];

