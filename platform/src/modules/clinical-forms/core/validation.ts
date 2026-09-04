import { isClinicalFormFieldVisible } from './conditions';
import { compareClinicalDates, isValidClinicalDate } from './schema';
import type {
  ClinicalFormAnswers,
  ClinicalFormAnswerValidationContext,
  ClinicalFormField,
  ClinicalFormSchema,
  ClinicalFormValidationCode,
  ClinicalFormValidationError,
  ClinicalFormValidationResult,
} from './types';
import type { TerminologyConceptBinding, TerminologyValueSetBinding } from '@/modules/terminology/client';

function isEmpty(value: unknown): boolean {
  return value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0);
}

function addError(
  errors: ClinicalFormValidationError[],
  field: ClinicalFormField,
  path: string,
  code: ClinicalFormValidationCode,
): void {
  errors.push({ path, fieldId: field.id, code, messageKey: `clinicalForms.validation.${code}` });
}

function addUnknownFieldError(errors: ClinicalFormValidationError[], path: string, fieldId: string): void {
  errors.push({ path, fieldId, code: 'unknownField', messageKey: 'clinicalForms.validation.unknownField' });
}

function decimalPlaces(value: number): number {
  if (Number.isInteger(value)) return 0;
  const normalized = value.toString().toLowerCase();
  if (!normalized.includes('e')) return normalized.split('.')[1]?.length ?? 0;
  const [coefficient, exponentText] = normalized.split('e');
  const exponent = Number(exponentText);
  const fraction = coefficient.split('.')[1]?.length ?? 0;
  return Math.max(0, fraction - exponent);
}

const TEXT_PATTERNS = {
  phone: /^\+?[0-9 ()-]{7,24}$/,
  email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  identifier: /^[A-Za-z0-9][A-Za-z0-9._/-]{0,63}$/,
} as const;

function isConceptBinding(value: unknown): value is TerminologyConceptBinding {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Readonly<Record<string, unknown>>;
  return typeof candidate.system === 'string'
    && typeof candidate.version === 'string'
    && typeof candidate.code === 'string'
    && Object.keys(candidate).every(key => ['system', 'version', 'code'].includes(key));
}

function sameConcept(left: TerminologyConceptBinding, right: TerminologyConceptBinding): boolean {
  return left.system === right.system && left.version === right.version && left.code === right.code;
}

function sameValueSet(left: TerminologyValueSetBinding, right: TerminologyValueSetBinding): boolean {
  return left.canonicalUrl === right.canonicalUrl && left.version === right.version;
}

function validateScalar(
  field: Exclude<ClinicalFormField, { type: 'group' }>,
  value: unknown,
  path: string,
  errors: ClinicalFormValidationError[],
  context: ClinicalFormAnswerValidationContext,
): void {
  if (isEmpty(value)) {
    if (field.required) addError(errors, field, path, 'required');
    return;
  }

  if (field.type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) addError(errors, field, path, 'invalidType');
    else if (field.min !== undefined && value < field.min) addError(errors, field, path, 'minimum');
    else if (field.max !== undefined && value > field.max) addError(errors, field, path, 'maximum');
    else if (field.precision !== undefined && decimalPlaces(value) > field.precision) addError(errors, field, path, 'precision');
  } else if (field.type === 'boolean' && typeof value !== 'boolean') {
    addError(errors, field, path, 'invalidType');
  } else if (field.type === 'text' || field.type === 'textarea') {
    if (typeof value !== 'string') addError(errors, field, path, 'invalidType');
    else if (field.minLength !== undefined && value.length < field.minLength) addError(errors, field, path, 'minLength');
    else if (field.maxLength !== undefined && value.length > field.maxLength) addError(errors, field, path, 'maxLength');
    else if (field.pattern !== undefined && !TEXT_PATTERNS[field.pattern].test(value)) addError(errors, field, path, 'pattern');
  } else if (field.type === 'date' || field.type === 'datetime') {
    if (typeof value !== 'string' || !isValidClinicalDate(field.type, value)) addError(errors, field, path, 'invalidDate');
    else if (field.min !== undefined && compareClinicalDates(field.type, value, field.min) < 0) addError(errors, field, path, 'minimum');
    else if (field.max !== undefined && compareClinicalDates(field.type, value, field.max) > 0) addError(errors, field, path, 'maximum');
  } else if (field.type === 'select' && field.options && typeof value !== 'string') {
    addError(errors, field, path, 'invalidType');
  } else if (field.type === 'select' && field.valueSet && !isConceptBinding(value)) {
    addError(errors, field, path, 'invalidType');
  } else if (field.type === 'multiSelect' && field.options
    && (!Array.isArray(value) || value.some(item => typeof item !== 'string'))) {
    addError(errors, field, path, 'invalidType');
  } else if (field.type === 'multiSelect' && field.valueSet
    && (!Array.isArray(value) || value.some(item => !isConceptBinding(item)))) {
    addError(errors, field, path, 'invalidType');
  } else if (field.type === 'select') {
    if (field.options && !field.options.some(option => option.value === value)) {
      addError(errors, field, path, 'invalidOption');
    } else if (field.valueSet && isConceptBinding(value)) {
      const resolved = context.valueSetsByField?.[field.id];
      if (!resolved || !sameValueSet(resolved.binding, field.valueSet)) addError(errors, field, path, 'unresolvedValueSet');
      else if (!resolved.concepts.some(concept => sameConcept(concept, value))) addError(errors, field, path, 'invalidOption');
    }
  } else if (field.type === 'multiSelect' && Array.isArray(value)) {
    const keys = value.map(item => isConceptBinding(item)
      ? `${item.system}\u0000${item.version}\u0000${item.code}`
      : String(item));
    if (new Set(keys).size !== keys.length) addError(errors, field, path, 'duplicateSelection');
    else {
      const resolved = context.valueSetsByField?.[field.id];
      if (field.valueSet && (!resolved || !sameValueSet(resolved.binding, field.valueSet))) {
        addError(errors, field, path, 'unresolvedValueSet');
        return;
      }
      if (field.options && value.some(item => !field.options?.some(option => option.value === item))) {
        addError(errors, field, path, 'invalidOption');
      } else if (resolved && value.some(item => isConceptBinding(item)
        && !resolved.concepts.some(concept => sameConcept(concept, item)))) {
        addError(errors, field, path, 'invalidOption');
      }
    }
  }
}

function validateFields(
  fields: readonly ClinicalFormField[],
  localAnswers: ClinicalFormAnswers,
  rootAnswers: ClinicalFormAnswers,
  prefix: string,
  errors: ClinicalFormValidationError[],
  context: ClinicalFormAnswerValidationContext,
  checkUnknown = true,
): void {
  if (checkUnknown) {
    const fieldsById = new Set(fields.map(field => field.id));
    for (const fieldId of Object.keys(localAnswers)) {
      if (!fieldsById.has(fieldId)) addUnknownFieldError(errors, prefix ? `${prefix}.${fieldId}` : fieldId, fieldId);
    }
  }
  fields.forEach(field => {
    const path = prefix ? `${prefix}.${field.id}` : field.id;
    const value = localAnswers[field.id];
    if (!isClinicalFormFieldVisible(field.visibility, rootAnswers, localAnswers)) {
      if (!isEmpty(value)) addError(errors, field, path, 'hiddenField');
      return;
    }

    if (field.type !== 'group') {
      validateScalar(field, value, path, errors, context);
      return;
    }

    if (field.repeatable) {
      if (isEmpty(value)) {
        if ((field.repeatable.minItems ?? 0) > 0) addError(errors, field, path, 'minItems');
        else if (field.required) addError(errors, field, path, 'required');
        return;
      }
      if (!Array.isArray(value)) {
        addError(errors, field, path, 'invalidType');
        return;
      }
      if (value.length < (field.repeatable.minItems ?? 0)) addError(errors, field, path, 'minItems');
      if (field.repeatable.maxItems !== undefined && value.length > field.repeatable.maxItems) {
        addError(errors, field, path, 'maxItems');
      }
      value.forEach((entry, index) => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
          addError(errors, field, `${path}[${index}]`, 'invalidType');
          return;
        }
        validateFields(
          field.fields,
          entry as Readonly<Record<string, unknown>>,
          rootAnswers,
          `${path}[${index}]`,
          errors,
          context,
        );
      });
      return;
    }

    if (isEmpty(value)) {
      if (field.required) addError(errors, field, path, 'required');
      return;
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      addError(errors, field, path, 'invalidType');
      return;
    }
    validateFields(field.fields, value as Readonly<Record<string, unknown>>, rootAnswers, path, errors, context);
  });
}

export function validateClinicalFormAnswers(
  schema: ClinicalFormSchema,
  answers: ClinicalFormAnswers,
  context: ClinicalFormAnswerValidationContext = {},
): ClinicalFormValidationResult {
  const errors: ClinicalFormValidationError[] = [];
  const rootFieldIds = new Set(schema.sections.flatMap(section => section.fields.map(field => field.id)));
  for (const fieldId of Object.keys(answers)) {
    if (!rootFieldIds.has(fieldId)) addUnknownFieldError(errors, fieldId, fieldId);
  }
  schema.sections.forEach(section => validateFields(section.fields, answers, answers, '', errors, context, false));
  return { valid: errors.length === 0, errors };
}
