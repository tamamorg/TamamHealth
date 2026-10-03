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

// Common ICD-11 codes for South Sudan context — expanded for clinical diagnosis use
// Covers both cause-of-death AND clinical diagnosis at all facility levels
export const COMMON_ICD11_CODES: ICD11CodeEntry[] = [
  // ===== INFECTIOUS DISEASES (highest burden in South Sudan) =====
  { code: '1A40', title: 'Malaria due to Plasmodium falciparum', chapter: 'Infectious diseases', minLevel: 'boma', causeOfDeath: true, notifiable: true, keywords: ['malaria', 'fever', 'chills'] },
  { code: '1A41', title: 'Malaria due to Plasmodium vivax', chapter: 'Infectious diseases', minLevel: 'payam', notifiable: true, keywords: ['vivax', 'malaria'] },
  { code: '1A42', title: 'Malaria, unspecified', chapter: 'Infectious diseases', minLevel: 'boma', notifiable: true, keywords: ['malaria', 'suspected malaria'] },
  { code: '1B10', title: 'Tuberculosis of lung', chapter: 'Infectious diseases', minLevel: 'county', causeOfDeath: true, notifiable: true, keywords: ['tb', 'tuberculosis', 'cough'] },
  { code: '1B11', title: 'Tuberculosis, extrapulmonary', chapter: 'Infectious diseases', minLevel: 'state', causeOfDeath: true, notifiable: true },
  { code: '1C60', title: 'HIV disease', chapter: 'Infectious diseases', minLevel: 'payam', causeOfDeath: true, notifiable: true, keywords: ['hiv', 'aids'] },
  { code: '1C62.Z', title: 'HIV disease, unspecified', chapter: 'Infectious diseases', minLevel: 'payam', notifiable: true },
  { code: '1A00', title: 'Cholera', chapter: 'Infectious diseases', minLevel: 'boma', causeOfDeath: true, notifiable: true, keywords: ['cholera', 'watery diarrhea'] },
  { code: '1A07', title: 'Typhoid fever', chapter: 'Infectious diseases', minLevel: 'payam', causeOfDeath: true, notifiable: true, keywords: ['typhoid', 'enteric fever'] },
  { code: '1E30', title: 'Measles', chapter: 'Infectious diseases', minLevel: 'boma', causeOfDeath: true, notifiable: true, keywords: ['measles', 'rash', 'rubella'] },
  { code: '1D80', title: 'Hepatitis B', chapter: 'Infectious diseases', minLevel: 'county', causeOfDeath: true, notifiable: true },
  { code: '1D81', title: 'Hepatitis C', chapter: 'Infectious diseases', minLevel: 'county', notifiable: true },
  { code: '1A30', title: 'Leishmaniasis (Kala-azar)', chapter: 'Infectious diseases', minLevel: 'county', causeOfDeath: true, notifiable: true, keywords: ['kala-azar', 'visceral leishmaniasis'] },
  { code: '1B90', title: 'Meningitis', chapter: 'Infectious diseases', minLevel: 'county', causeOfDeath: true, notifiable: true, keywords: ['meningitis', 'neck stiffness'] },
  { code: '1C80', title: 'Acute viral hepatitis', chapter: 'Infectious diseases', minLevel: 'payam', notifiable: true },
  { code: '1A70', title: 'Yellow fever', chapter: 'Infectious diseases', minLevel: 'payam', notifiable: true, keywords: ['yellow fever', 'jaundice'] },
  { code: '1E50', title: 'Rabies', chapter: 'Infectious diseases', minLevel: 'county', causeOfDeath: true, notifiable: true, keywords: ['rabies', 'dog bite'] },
  { code: '1A80', title: 'Tetanus', chapter: 'Infectious diseases', minLevel: 'county', causeOfDeath: true, notifiable: true, keywords: ['tetanus', 'lockjaw'] },

  // ===== DIARRHEAL & GI DISEASES =====
  { code: 'DA90', title: 'Diarrhoeal diseases', chapter: 'Digestive system', minLevel: 'boma', causeOfDeath: true, keywords: ['diarrhea', 'loose stool', 'gastroenteritis'] },
  { code: 'DA93', title: 'Dysentery', chapter: 'Digestive system', minLevel: 'boma', notifiable: true, keywords: ['dysentery', 'bloody diarrhea'] },
  { code: 'DA70', title: 'Intestinal worms (Helminthiasis)', chapter: 'Digestive system', minLevel: 'boma', keywords: ['worms', 'parasites'] },

  // ===== RESPIRATORY =====
  { code: 'CA40', title: 'Pneumonia', chapter: 'Respiratory system', minLevel: 'boma', causeOfDeath: true, keywords: ['pneumonia', 'chest infection', 'breathing difficulty'] },
  { code: 'CA07', title: 'Acute upper respiratory infection', chapter: 'Respiratory system', minLevel: 'boma', keywords: ['cold', 'cough', 'sore throat', 'URTI'] },
  { code: 'CA20', title: 'Chronic obstructive pulmonary disease', chapter: 'Respiratory system', minLevel: 'county', causeOfDeath: true },
  { code: 'CA23', title: 'Asthma', chapter: 'Respiratory system', minLevel: 'payam', keywords: ['asthma', 'wheeze'] },

  // ===== CIRCULATORY =====
  { code: 'BA00', title: 'Ischaemic heart disease', chapter: 'Circulatory system', minLevel: 'state', causeOfDeath: true },
  { code: 'BA01', title: 'Cerebrovascular diseases (Stroke)', chapter: 'Circulatory system', minLevel: 'state', causeOfDeath: true, keywords: ['stroke', 'CVA'] },
  { code: 'BA80', title: 'Hypertensive heart disease', chapter: 'Circulatory system', minLevel: 'payam', causeOfDeath: true, keywords: ['hypertension', 'high blood pressure'] },
  { code: 'BA02', title: 'Hypertension, essential', chapter: 'Circulatory system', minLevel: 'payam', keywords: ['hypertension', 'high BP'] },

  // ===== NUTRITIONAL =====
  { code: '5B70', title: 'Malnutrition', chapter: 'Nutritional deficiencies', minLevel: 'boma', causeOfDeath: true, keywords: ['malnutrition', 'wasting', 'MUAC'] },
  { code: '5B71', title: 'Severe acute malnutrition (SAM)', chapter: 'Nutritional deficiencies', minLevel: 'boma', causeOfDeath: true, notifiable: true, keywords: ['SAM', 'kwashiorkor', 'marasmus'] },
  { code: '5B72', title: 'Moderate acute malnutrition (MAM)', chapter: 'Nutritional deficiencies', minLevel: 'boma', keywords: ['MAM', 'underweight'] },
  { code: '5A00', title: 'Anaemia', chapter: 'Blood diseases', minLevel: 'payam', causeOfDeath: true, keywords: ['anemia', 'anaemia', 'pale'] },
  { code: '5B50', title: 'Vitamin A deficiency', chapter: 'Nutritional deficiencies', minLevel: 'payam', keywords: ['night blindness'] },

  // ===== PREGNANCY & CHILDBIRTH =====
  { code: 'JA00', title: 'Maternal haemorrhage', chapter: 'Pregnancy/childbirth', minLevel: 'payam', causeOfDeath: true, notifiable: true, keywords: ['PPH', 'bleeding'] },
  { code: 'JA03', title: 'Maternal sepsis', chapter: 'Pregnancy/childbirth', minLevel: 'county', causeOfDeath: true, notifiable: true },
  { code: 'JA04', title: 'Pre-eclampsia / Eclampsia', chapter: 'Pregnancy/childbirth', minLevel: 'payam', causeOfDeath: true, notifiable: true, keywords: ['eclampsia', 'fits in pregnancy'] },
  { code: 'JA06', title: 'Obstructed labour', chapter: 'Pregnancy/childbirth', minLevel: 'payam', causeOfDeath: true, keywords: ['obstructed labour', 'prolonged labour'] },
  { code: 'JA10', title: 'Ectopic pregnancy', chapter: 'Pregnancy/childbirth', minLevel: 'county', causeOfDeath: true },
  { code: 'JA20', title: 'Spontaneous abortion', chapter: 'Pregnancy/childbirth', minLevel: 'payam', keywords: ['miscarriage'] },

  // ===== PERINATAL =====
  { code: 'KA00', title: 'Neonatal sepsis', chapter: 'Perinatal conditions', minLevel: 'payam', causeOfDeath: true, notifiable: true },
  { code: 'KA01', title: 'Birth asphyxia', chapter: 'Perinatal conditions', minLevel: 'payam', causeOfDeath: true },
  { code: 'KA02', title: 'Neonatal prematurity', chapter: 'Perinatal conditions', minLevel: 'payam', causeOfDeath: true },
  { code: 'KA03', title: 'Low birth weight', chapter: 'Perinatal conditions', minLevel: 'payam', causeOfDeath: true },

  // ===== ENDOCRINE =====
  { code: 'DB90', title: 'Diabetes mellitus', chapter: 'Endocrine diseases', minLevel: 'payam', causeOfDeath: true, keywords: ['diabetes', 'sugar'] },
  { code: 'DB91', title: 'Diabetes mellitus, type 1', chapter: 'Endocrine diseases', minLevel: 'county' },
  { code: 'DB92', title: 'Diabetes mellitus, type 2', chapter: 'Endocrine diseases', minLevel: 'payam', keywords: ['type 2 diabetes'] },

  // ===== SKIN & EYES =====
  { code: 'ED90', title: 'Skin infection', chapter: 'Skin diseases', minLevel: 'boma', keywords: ['skin infection', 'abscess', 'boil'] },
  { code: '9A00', title: 'Conjunctivitis', chapter: 'Eye diseases', minLevel: 'boma', keywords: ['red eye', 'eye infection'] },
  { code: '9B10', title: 'Trachoma', chapter: 'Eye diseases', minLevel: 'payam', notifiable: true, keywords: ['trachoma'] },

  // ===== MENTAL HEALTH =====
  { code: '6A70', title: 'Depression', chapter: 'Mental health', minLevel: 'payam', keywords: ['depression', 'sadness'] },
  { code: '6B40', title: 'Post-traumatic stress disorder', chapter: 'Mental health', minLevel: 'county', keywords: ['PTSD', 'trauma'] },
  { code: '6A20', title: 'Epilepsy', chapter: 'Neurological', minLevel: 'payam', keywords: ['epilepsy', 'seizure', 'fits'] },

  // ===== EXTERNAL CAUSES =====
  { code: 'NF00', title: 'Road traffic injuries', chapter: 'External causes', minLevel: 'payam', causeOfDeath: true },
  { code: 'NE00', title: 'Drowning', chapter: 'External causes', minLevel: 'payam', causeOfDeath: true },
  { code: 'PB00', title: 'Assault by sharp object', chapter: 'External causes', minLevel: 'payam', causeOfDeath: true },
  { code: 'PA00', title: 'Assault by firearm', chapter: 'External causes', minLevel: 'payam', causeOfDeath: true },
  { code: 'MG30', title: 'Snakebite envenoming', chapter: 'External causes', minLevel: 'boma', causeOfDeath: true, keywords: ['snakebite', 'snake'] },
  { code: 'NC00', title: 'Burns', chapter: 'External causes', minLevel: 'payam', causeOfDeath: true, keywords: ['burn', 'scalding'] },

  // ===== NEOPLASMS =====
  { code: '2C00', title: 'Malignant neoplasm (Cancer)', chapter: 'Neoplasms', minLevel: 'state', causeOfDeath: true },
  { code: '2E00', title: "Kaposi's sarcoma", chapter: 'Neoplasms', minLevel: 'state', causeOfDeath: true },

  // ===== UROGENITAL =====
  { code: 'GC00', title: 'Urinary tract infection', chapter: 'Genitourinary', minLevel: 'payam', keywords: ['UTI', 'burning urination'] },
  { code: 'GA00', title: 'Acute kidney injury', chapter: 'Genitourinary', minLevel: 'county', causeOfDeath: true },

  // ===== STIs =====
  { code: '1A60', title: 'Syphilis', chapter: 'Infectious diseases', minLevel: 'payam', notifiable: true, keywords: ['syphilis'] },
  { code: '1A61', title: 'Gonorrhoea', chapter: 'Infectious diseases', minLevel: 'payam', keywords: ['gonorrhea', 'discharge'] },
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

