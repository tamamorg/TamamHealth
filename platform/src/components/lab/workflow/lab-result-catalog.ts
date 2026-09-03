/**
 * Structured result definitions reconstructed from the supplied legacy lab
 * forms. The catalogue deliberately separates concepts the old form combined
 * (crystal type vs quantity), removes duplicate ALP entries, and normalizes
 * units while retaining every distinct investigation shown in the source.
 */

import type { LabResultObservation } from '@/lib/db-types';

export type LabResultFieldKind = 'number' | 'text' | 'select';

export interface LabResultFieldDefinition {
  id: string;
  label: string;
  kind: LabResultFieldKind;
  unit?: string;
  options?: string[];
}

export interface LabResultSectionDefinition {
  id: string;
  label: string;
  fields: LabResultFieldDefinition[];
}

export interface LabResultProfile {
  id: 'hematology' | 'chemistry' | 'urine' | 'stool';
  label: string;
  sections: LabResultSectionDefinition[];
}

const quantity = ['Negative', 'Rare', '1+', '2+', '3+'];
const amount = ['None', 'Few', 'Moderate', 'High'];

export const HEMATOLOGY_PROFILE: LabResultProfile = {
  id: 'hematology',
  label: 'Hematology',
  sections: [{
    id: 'cbc',
    label: 'Complete blood count',
    fields: [
      { id: 'cbc.wbc', label: 'White blood cells (WBC)', kind: 'number', unit: '10³/µL' },
      { id: 'cbc.rbc', label: 'Red blood cells (RBC)', kind: 'number', unit: '10⁶/µL' },
      { id: 'cbc.platelets', label: 'Platelets', kind: 'number', unit: '10³/µL' },
      { id: 'cbc.neutrophils', label: 'Neutrophils', kind: 'number', unit: '%' },
      { id: 'cbc.lymphocytes', label: 'Lymphocytes — microscopic exam', kind: 'number', unit: '%' },
      { id: 'cbc.mixed_cells', label: 'Monocytes, eosinophils and basophils — combined', kind: 'number', unit: '%' },
      { id: 'cbc.hemoglobin', label: 'Hemoglobin', kind: 'number', unit: 'g/dL' },
      { id: 'cbc.hematocrit', label: 'Hematocrit', kind: 'number', unit: '%' },
      { id: 'cbc.mcv', label: 'Mean corpuscular volume (MCV)', kind: 'number', unit: 'fL' },
      { id: 'cbc.mch', label: 'Mean corpuscular hemoglobin (MCH)', kind: 'number', unit: 'pg' },
      { id: 'cbc.mchc', label: 'Mean corpuscular hemoglobin concentration (MCHC)', kind: 'number', unit: 'g/dL' },
    ],
  }],
};

export const CHEMISTRY_PROFILE: LabResultProfile = {
  id: 'chemistry',
  label: 'Chemistry',
  sections: [
    {
      id: 'renal-electrolytes', label: 'Renal function & electrolytes', fields: [
        { id: 'chem.bun', label: 'Blood urea nitrogen (BUN)', kind: 'number', unit: 'mmol/L' },
        { id: 'chem.creatinine', label: 'Serum creatinine', kind: 'number', unit: 'µmol/L' },
        { id: 'chem.sodium', label: 'Serum sodium', kind: 'number', unit: 'mmol/L' },
        { id: 'chem.potassium', label: 'Serum potassium', kind: 'number', unit: 'mmol/L' },
        { id: 'chem.calcium', label: 'Serum calcium', kind: 'number', unit: 'mg/dL' },
        { id: 'chem.co2', label: 'Serum carbon dioxide (CO₂)', kind: 'number', unit: 'mmol/L' },
        { id: 'chem.uric_acid', label: 'Serum uric acid', kind: 'number', unit: 'mg/dL' },
      ],
    },
    {
      id: 'glucose', label: 'Glucose', fields: [
        { id: 'chem.glucose_fasting', label: 'Fasting blood glucose', kind: 'number', unit: 'mg/dL' },
        { id: 'chem.glucose_postprandial', label: 'Post-prandial blood glucose', kind: 'number', unit: 'mg/dL' },
        { id: 'chem.glucose_serum_mg', label: 'Serum glucose', kind: 'number', unit: 'mg/dL' },
        { id: 'chem.glucose_serum_mmol', label: 'Serum glucose', kind: 'number', unit: 'mmol/L' },
      ],
    },
    {
      id: 'liver-proteins', label: 'Liver enzymes & proteins', fields: [
        { id: 'chem.alp', label: 'Alkaline phosphatase (ALP)', kind: 'number', unit: 'U/L' },
        { id: 'chem.ast', label: 'Aspartate aminotransferase (AST/SGOT)', kind: 'number', unit: 'U/L' },
        { id: 'chem.bilirubin_total', label: 'Total bilirubin', kind: 'number', unit: 'µmol/L' },
        { id: 'chem.albumin', label: 'Serum albumin', kind: 'number', unit: 'g/dL' },
        { id: 'chem.protein_total', label: 'Total protein', kind: 'number', unit: 'g/dL' },
        { id: 'chem.amylase', label: 'Amylase', kind: 'number', unit: 'U/L' },
      ],
    },
    {
      id: 'lipids', label: 'Lipids', fields: [
        { id: 'chem.cholesterol_total', label: 'Total cholesterol', kind: 'number', unit: 'mmol/L' },
        { id: 'chem.triglycerides', label: 'Triglycerides', kind: 'number', unit: 'mmol/L' },
      ],
    },
  ],
};

export const URINE_PROFILE: LabResultProfile = {
  id: 'urine',
  label: 'Urine',
  sections: [
    {
      id: 'urine-screening', label: 'Culture & screening', fields: [
        { id: 'urine.culture_sensitivity', label: 'Urine culture and sensitivity (C&S)', kind: 'text' },
        { id: 'urine.pregnancy', label: 'Urine pregnancy test', kind: 'select', options: ['Negative', 'Indeterminate', 'Positive', 'Poor sample quality'] },
        { id: 'urine.protein', label: 'Urine protein (dipstick)', kind: 'select', options: ['Negative', 'Trace', '1+', '2+', '3+', '4+'] },
        { id: 'urine.bacteriuria', label: 'Urine bacteriuria', kind: 'select', options: ['Not done', 'Negative', 'Indeterminate', 'Positive', 'Unknown'] },
      ],
    },
    {
      id: 'urine-sediment', label: 'Sediment microscopy', fields: [
        { id: 'urine.erythrocytes', label: 'Erythrocytes', kind: 'select', options: amount },
        { id: 'urine.leukocytes', label: 'Leukocytes', kind: 'select', options: amount },
        { id: 'urine.epithelial_casts', label: 'Epithelial casts', kind: 'select', options: quantity },
        { id: 'urine.yeast', label: 'Yeast', kind: 'select', options: quantity },
        { id: 'urine.yeast_hyphae', label: 'Yeast hyphae', kind: 'select', options: quantity },
        { id: 'urine.spores', label: 'Spores', kind: 'select', options: quantity },
        { id: 'urine.trichomonas', label: 'Trichomonas vaginalis', kind: 'select', options: amount },
      ],
    },
    {
      id: 'urine-crystals', label: 'Crystals', fields: [
        { id: 'urine.crystal_quantity', label: 'Crystal quantity', kind: 'select', options: amount },
        { id: 'urine.crystal_type', label: 'Crystal type', kind: 'select', options: [
          'None', 'Ammonium urate', 'Amorphous phosphate', 'Amorphous urate',
          'Calcium oxalate', 'Calcium phosphate', 'Calcium sulfate', 'Cystine',
          'Magnesium phosphate', 'Triple phosphate', 'Uric acid', 'Hyaline cast',
        ] },
      ],
    },
  ],
};

export const STOOL_PROFILE: LabResultProfile = {
  id: 'stool',
  label: 'Stool',
  sections: [
    {
      id: 'stool-microbiology', label: 'Culture & microscopy', fields: [
        { id: 'stool.culture', label: 'Stool culture (bacterial)', kind: 'text' },
        { id: 'stool.exam', label: 'Stool exam', kind: 'text' },
        { id: 'stool.microscopy_concentration', label: 'Stool microscopy with concentration', kind: 'text' },
        { id: 'stool.kinyoun', label: "Kinyoun's stain for coccidian oocysts", kind: 'text' },
      ],
    },
    {
      id: 'stool-screening', label: 'Screening tests', fields: [
        { id: 'stool.fat', label: 'Stool fat — semi-quantitative', kind: 'select', options: ['Negative', 'Trace', '1+', '2+', '3+', '4+'] },
        { id: 'stool.reducing_substance', label: 'Reducing substance', kind: 'select', options: ['Negative', 'Positive'] },
        { id: 'stool.occult_blood', label: 'Fecal occult blood', kind: 'select', options: ['Negative', 'Indeterminate', 'Positive'] },
      ],
    },
  ],
};

const sectionSubset = (profile: LabResultProfile, ids: string[]): LabResultProfile => ({
  ...profile,
  sections: profile.sections.filter(section => ids.includes(section.id)),
});

const fieldSubset = (profile: LabResultProfile, fieldIds: string[]): LabResultProfile => ({
  ...profile,
  sections: profile.sections
    .map(section => ({ ...section, fields: section.fields.filter(field => fieldIds.includes(field.id)) }))
    .filter(section => section.fields.length > 0),
});

/** Return only the panel relevant to what was actually ordered. */
export function resolveLabResultProfile(testName: string, specimen?: string): LabResultProfile | null {
  const name = testName.trim().toLowerCase();
  if (/^(full|complete) blood count$|^fbc$|^cbc$/.test(name)) return HEMATOLOGY_PROFILE;
  if (/urinalysis|urine (exam|test|microscopy)/.test(name)) return URINE_PROFILE;
  if (/stool/.test(name) || specimen?.toLowerCase() === 'stool') return STOOL_PROFILE;
  if (/^(chemistry|chemistry panel|comprehensive metabolic panel)$/.test(name)) return CHEMISTRY_PROFILE;
  if (/liver function/.test(name)) return sectionSubset(CHEMISTRY_PROFILE, ['liver-proteins']);
  if (/renal function|electrolyte/.test(name)) return sectionSubset(CHEMISTRY_PROFILE, ['renal-electrolytes']);
  if (/lipid/.test(name)) return sectionSubset(CHEMISTRY_PROFILE, ['lipids']);
  if (/glucose/.test(name)) return sectionSubset(CHEMISTRY_PROFILE, ['glucose']);
  if (/uric acid/.test(name)) return fieldSubset(CHEMISTRY_PROFILE, ['chem.uric_acid']);
  return null;
}

export function valuesFromObservations(observations?: LabResultObservation[]): Record<string, string> {
  return Object.fromEntries((observations || []).map(observation => [observation.id, observation.value]));
}

export function buildLabObservations(
  profile: LabResultProfile,
  values: Record<string, string>,
): LabResultObservation[] {
  return profile.sections.flatMap(section => section.fields.flatMap(field => {
    const value = values[field.id]?.trim();
    return value ? [{ id: field.id, label: field.label, group: section.label, value, unit: field.unit }] : [];
  }));
}

/** Compact fallback consumed by older result lists, messages, and exports. */
export function summarizeLabObservations(observations: LabResultObservation[]): string {
  return observations.map(item => `${item.label}: ${item.value}${item.unit ? ` ${item.unit}` : ''}`).join('; ');
}
