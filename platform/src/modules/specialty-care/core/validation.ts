import { getSpecialtyPathway } from './catalog';
import type { SpecialtyCareEpisodeDoc, SpecialtyFieldDefinition, SpecialtyFieldValue, SpecialtyValidationResult } from './types';

function missing(value: SpecialtyFieldValue | undefined): boolean {
  return value === undefined || value === null || (typeof value === 'string' && !value.trim()) || (Array.isArray(value) && value.length === 0);
}

function fieldError(field: SpecialtyFieldDefinition, value: SpecialtyFieldValue | undefined): string | null {
  if (value === 'not_applicable' && field.allowNotApplicable) return null;
  if (field.requiredToComplete && missing(value)) return `${field.label} is required`;
  if (missing(value)) return null;
  const correctType = field.kind === 'number' ? typeof value === 'number'
    : field.kind === 'boolean' ? typeof value === 'boolean'
    : field.kind === 'multi_select' ? Array.isArray(value) && value.every(item => typeof item === 'string')
    : typeof value === 'string';
  if (!correctType) return `${field.label} has an invalid type`;
  if (Array.isArray(value) && value.length > 1 && field.exclusiveOptions?.some(option => value.includes(option))) return `${field.label} contains mutually exclusive choices`;
  if (field.kind === 'date' && typeof value === 'string' && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value)) return `${field.label} must be a valid date`;
  if (field.kind === 'boolean' && field.requiredToComplete && value !== true) return `${field.label} must be confirmed`;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return `${field.label} must be a valid number`;
    if (field.min !== undefined && value < field.min) return `${field.label} must be at least ${field.min}`;
    if (field.max !== undefined && value > field.max) return `${field.label} must not exceed ${field.max}`;
  }
  if ((field.kind === 'select' || field.kind === 'multi_select') && field.options && value !== undefined) {
    const allowed = new Set(field.options.map((option) => option.value));
    const values = Array.isArray(value) ? value : [value];
    if (values.some((item) => typeof item !== 'string' || !allowed.has(item))) return `${field.label} contains an unsupported value`;
  }
  return null;
}

export function validateSpecialtyEpisode(episode: Pick<SpecialtyCareEpisodeDoc, 'pathway' | 'status' | 'patientId' | 'patientName' | 'hospitalId' | 'orgId' | 'values'>): SpecialtyValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!episode.patientId.trim()) errors.push('Patient ID is required');
  if (!episode.patientName.trim()) errors.push('Patient name is required');
  if (!episode.hospitalId.trim()) errors.push('Facility is required');
  if (!episode.orgId.trim()) errors.push('Organization is required');

  const pathway = getSpecialtyPathway(episode.pathway);
  const allowedKeys = new Set(pathway.fields.map((item) => item.key));
  if (episode.status !== 'completed') {
    for (const definition of pathway.fields) {
      const error = fieldError({ ...definition, requiredToComplete: false }, episode.values[definition.key]);
      if (error) errors.push(error);
    }
  }
  if (Object.keys(episode.values).some((key) => key === 'restrictedNarrative' || key === 'psychotherapyNote')) {
    errors.push('Sensitive mental-health narrative cannot be stored in the replicated specialty-care record');
  }
  if (Object.keys(episode.values).some((key) => !allowedKeys.has(key))) {
    errors.push('The record contains fields that are not part of the controlled pathway schema');
  }

  if (episode.status === 'completed') {
    for (const definition of pathway.fields) {
      const error = fieldError(definition, episode.values[definition.key]);
      if (error) errors.push(error);
    }
    if (episode.pathway === 'dermatology') {
      const consent = episode.values.photoConsent;
      const ids = episode.values.photoDocumentIds;
      if (typeof ids === 'string' && ids.trim() && consent !== 'clinical_care_only' && consent !== 'care_and_teaching') {
        errors.push('A dermatology image reference requires recorded photography consent');
      }
    }
    if (episode.pathway === 'mental_health' && episode.values.selfHarmRisk === 'high_imminent' && missing(episode.values.safetyAction)) {
      errors.push('High or imminent self-harm risk requires a documented safety action');
    }
    if (episode.pathway === 'cardiac_diagnostics' && episode.values.acquisitionQuality === 'repeat_required') {
      errors.push('A study marked repeat required cannot be completed');
    }
  } else {
    const missingCount = pathway.fields.filter((item) => item.requiredToComplete && missing(episode.values[item.key])).length;
    if (missingCount) warnings.push(`${missingCount} completion field${missingCount === 1 ? '' : 's'} remain`);
  }
  return { valid: errors.length === 0, errors, warnings };
}
