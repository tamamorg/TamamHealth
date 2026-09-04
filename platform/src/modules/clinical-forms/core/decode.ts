import { validateClinicalFormSchema } from './schema';
import type {
  ClinicalFormSchema,
  ClinicalFormSchemaIssue,
  ClinicalFormSchemaParseResult,
  ClinicalFormTerminologyContext,
} from './types';

type UnknownRecord = Readonly<Record<string, unknown>>;
const FIELD_TYPES = ['text', 'textarea', 'number', 'date', 'datetime', 'boolean', 'select', 'multiSelect', 'group'] as const;
const CONDITION_OPERATORS = ['equals', 'notEquals', 'exists', 'greaterThan', 'greaterThanOrEqual', 'lessThan', 'lessThanOrEqual', 'contains'] as const;
const MAX_SECTIONS = 100;
const MAX_FIELDS = 500;
const MAX_DEPTH = 8;
const MAX_OPTIONS = 1_000;
const MAX_RULES = 20;

function add(issues: ClinicalFormSchemaIssue[], path: string, message: string): void {
  issues.push({ path, code: 'invalidType', message });
}

function rejectUnknown(value: UnknownRecord, allowed: readonly string[], path: string, issues: ClinicalFormSchemaIssue[]): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) issues.push({ path: `${path}.${key}`, code: 'invalidValue', message: 'Unknown property.' });
  }
}

function enforceLimit(length: number, maximum: number, path: string, issues: ClinicalFormSchemaIssue[]): void {
  if (length > maximum) issues.push({ path, code: 'invalidValue', message: `List exceeds the limit of ${maximum}.` });
}

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function requireRecord(value: unknown, path: string, issues: ClinicalFormSchemaIssue[]): value is UnknownRecord {
  if (isRecord(value)) return true;
  add(issues, path, 'Expected an object.');
  return false;
}

function requireString(value: unknown, path: string, issues: ClinicalFormSchemaIssue[]): value is string {
  if (typeof value === 'string') return true;
  add(issues, path, 'Expected text.');
  return false;
}

function optionalType(value: unknown, type: 'string' | 'number' | 'boolean', path: string, issues: ClinicalFormSchemaIssue[]): void {
  if (value !== undefined && typeof value !== type) add(issues, path, `Expected ${type}.`);
}

function checkLocalized(value: unknown, path: string, issues: ClinicalFormSchemaIssue[]): void {
  if (!requireRecord(value, path, issues)) return;
  rejectUnknown(value, ['en', 'apd'], path, issues);
  requireString(value.en, `${path}.en`, issues);
  requireString(value.apd, `${path}.apd`, issues);
}

function checkConceptBinding(value: unknown, path: string, issues: ClinicalFormSchemaIssue[]): void {
  if (!requireRecord(value, path, issues)) return;
  rejectUnknown(value, ['system', 'version', 'code'], path, issues);
  requireString(value.system, `${path}.system`, issues);
  requireString(value.version, `${path}.version`, issues);
  requireString(value.code, `${path}.code`, issues);
}

function checkVisibility(value: unknown, path: string, issues: ClinicalFormSchemaIssue[]): void {
  if (value === undefined) return;
  if (!requireRecord(value, path, issues)) return;
  rejectUnknown(value, ['match', 'rules'], path, issues);
  if (value.match !== 'all' && value.match !== 'any') add(issues, `${path}.match`, 'Expected all or any.');
  if (!Array.isArray(value.rules)) {
    add(issues, `${path}.rules`, 'Expected a list.');
    return;
  }
  enforceLimit(value.rules.length, MAX_RULES, `${path}.rules`, issues);
  value.rules.slice(0, MAX_RULES).forEach((candidate, index) => {
    const rulePath = `${path}.rules[${index}]`;
    if (!requireRecord(candidate, rulePath, issues)) return;
    rejectUnknown(candidate, ['fieldId', 'operator', 'value'], rulePath, issues);
    requireString(candidate.fieldId, `${rulePath}.fieldId`, issues);
    if (typeof candidate.operator !== 'string' || !CONDITION_OPERATORS.includes(candidate.operator as typeof CONDITION_OPERATORS[number])) {
      add(issues, `${rulePath}.operator`, 'Unknown condition operator.');
    }
    if (candidate.value !== undefined && candidate.value !== null
      && !['string', 'number', 'boolean'].includes(typeof candidate.value)) {
      if (isRecord(candidate.value)) checkConceptBinding(candidate.value, `${rulePath}.value`, issues);
      else add(issues, `${rulePath}.value`, 'Expected a scalar or coded comparison value.');
    }
  });
}

function checkFields(value: unknown, path: string, issues: ClinicalFormSchemaIssue[], state: { count: number }, depth = 1): void {
  if (!Array.isArray(value)) {
    add(issues, path, 'Expected a list.');
    return;
  }
  if (depth > MAX_DEPTH) {
    issues.push({ path, code: 'invalidValue', message: `Form nesting exceeds the limit of ${MAX_DEPTH}.` });
    return;
  }
  const remaining = Math.max(0, MAX_FIELDS - state.count);
  state.count += value.length;
  if (state.count > MAX_FIELDS) issues.push({ path, code: 'invalidValue', message: `Form exceeds the limit of ${MAX_FIELDS} fields.` });
  value.slice(0, remaining).forEach((candidate, index) => {
    const fieldPath = `${path}[${index}]`;
    if (!requireRecord(candidate, fieldPath, issues)) return;
    requireString(candidate.id, `${fieldPath}.id`, issues);
    checkLocalized(candidate.label, `${fieldPath}.label`, issues);
    if (candidate.helpText !== undefined) checkLocalized(candidate.helpText, `${fieldPath}.helpText`, issues);
    optionalType(candidate.required, 'boolean', `${fieldPath}.required`, issues);
    checkVisibility(candidate.visibility, `${fieldPath}.visibility`, issues);
    if (typeof candidate.type !== 'string' || !FIELD_TYPES.includes(candidate.type as typeof FIELD_TYPES[number])) {
      add(issues, `${fieldPath}.type`, 'Unknown field type.');
      return;
    }
    const common = ['id', 'type', 'label', 'helpText', 'required', 'visibility'];
    const allowed = candidate.type === 'group' ? [...common, 'fields', 'repeatable']
      : candidate.type === 'select' || candidate.type === 'multiSelect' ? [...common, 'observation', 'options', 'valueSet']
        : candidate.type === 'text' || candidate.type === 'textarea' ? [...common, 'observation', 'minLength', 'maxLength', 'pattern']
          : candidate.type === 'number' ? [...common, 'observation', 'min', 'max', 'precision']
            : candidate.type === 'date' || candidate.type === 'datetime' ? [...common, 'observation', 'min', 'max']
              : [...common, 'observation'];
    rejectUnknown(candidate, allowed, fieldPath, issues);

    if (candidate.observation !== undefined) {
      if (candidate.type === 'group') add(issues, `${fieldPath}.observation`, 'Groups cannot store a single observation.');
      if (requireRecord(candidate.observation, `${fieldPath}.observation`, issues)) {
        rejectUnknown(candidate.observation, ['concept', 'unit'], `${fieldPath}.observation`, issues);
        checkConceptBinding(candidate.observation.concept, `${fieldPath}.observation.concept`, issues);
        if (candidate.observation.unit !== undefined) checkConceptBinding(candidate.observation.unit, `${fieldPath}.observation.unit`, issues);
      }
    }

    if (candidate.type === 'text' || candidate.type === 'textarea') {
      optionalType(candidate.minLength, 'number', `${fieldPath}.minLength`, issues);
      optionalType(candidate.maxLength, 'number', `${fieldPath}.maxLength`, issues);
      optionalType(candidate.pattern, 'string', `${fieldPath}.pattern`, issues);
    } else if (candidate.type === 'number') {
      optionalType(candidate.min, 'number', `${fieldPath}.min`, issues);
      optionalType(candidate.max, 'number', `${fieldPath}.max`, issues);
      optionalType(candidate.precision, 'number', `${fieldPath}.precision`, issues);
    } else if (candidate.type === 'date' || candidate.type === 'datetime') {
      optionalType(candidate.min, 'string', `${fieldPath}.min`, issues);
      optionalType(candidate.max, 'string', `${fieldPath}.max`, issues);
    } else if (candidate.type === 'select' || candidate.type === 'multiSelect') {
      if (candidate.options !== undefined) {
        if (!Array.isArray(candidate.options)) add(issues, `${fieldPath}.options`, 'Expected a list.');
        else candidate.options.slice(0, MAX_OPTIONS).forEach((option, optionIndex) => {
          const optionPath = `${fieldPath}.options[${optionIndex}]`;
          if (!requireRecord(option, optionPath, issues)) return;
          rejectUnknown(option, ['value', 'label'], optionPath, issues);
          requireString(option.value, `${optionPath}.value`, issues);
          checkLocalized(option.label, `${optionPath}.label`, issues);
        });
        if (Array.isArray(candidate.options)) enforceLimit(candidate.options.length, MAX_OPTIONS, `${fieldPath}.options`, issues);
      }
      if (candidate.valueSet !== undefined) {
        if (requireRecord(candidate.valueSet, `${fieldPath}.valueSet`, issues)) {
          rejectUnknown(candidate.valueSet, ['canonicalUrl', 'version'], `${fieldPath}.valueSet`, issues);
          requireString(candidate.valueSet.canonicalUrl, `${fieldPath}.valueSet.canonicalUrl`, issues);
          requireString(candidate.valueSet.version, `${fieldPath}.valueSet.version`, issues);
        }
      }
    } else if (candidate.type === 'group') {
      checkFields(candidate.fields, `${fieldPath}.fields`, issues, state, depth + 1);
      if (candidate.repeatable !== undefined && requireRecord(candidate.repeatable, `${fieldPath}.repeatable`, issues)) {
        rejectUnknown(candidate.repeatable, ['minItems', 'maxItems'], `${fieldPath}.repeatable`, issues);
        optionalType(candidate.repeatable.minItems, 'number', `${fieldPath}.repeatable.minItems`, issues);
        optionalType(candidate.repeatable.maxItems, 'number', `${fieldPath}.repeatable.maxItems`, issues);
      }
    }
  });
}

/** Decode untrusted JSON before applying semantic form-schema validation. */
function immutableJsonClone(value: unknown): unknown {
  if (Array.isArray(value)) return Object.freeze(value.map(immutableJsonClone));
  if (isRecord(value)) {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) result[key] = immutableJsonClone(item);
    return Object.freeze(result);
  }
  return value;
}

export function parseClinicalFormSchema(
  input: unknown,
  context: ClinicalFormTerminologyContext = {},
): ClinicalFormSchemaParseResult {
  const issues: ClinicalFormSchemaIssue[] = [];
  if (!requireRecord(input, '$', issues)) return { ok: false, issues };
  rejectUnknown(input, ['id', 'version', 'status', 'title', 'description', 'sections'], '$', issues);
  requireString(input.id, 'id', issues);
  if (typeof input.version !== 'number') add(issues, 'version', 'Expected a number.');
  requireString(input.status, 'status', issues);
  checkLocalized(input.title, 'title', issues);
  if (input.description !== undefined) checkLocalized(input.description, 'description', issues);
  const fieldState = { count: 0 };
  if (!Array.isArray(input.sections)) add(issues, 'sections', 'Expected a list.');
  else input.sections.slice(0, MAX_SECTIONS).forEach((candidate, index) => {
    const sectionPath = `sections[${index}]`;
    if (!requireRecord(candidate, sectionPath, issues)) return;
    rejectUnknown(candidate, ['id', 'label', 'description', 'fields'], sectionPath, issues);
    requireString(candidate.id, `${sectionPath}.id`, issues);
    checkLocalized(candidate.label, `${sectionPath}.label`, issues);
    if (candidate.description !== undefined) checkLocalized(candidate.description, `${sectionPath}.description`, issues);
    checkFields(candidate.fields, `${sectionPath}.fields`, issues, fieldState);
  });
  if (Array.isArray(input.sections)) enforceLimit(input.sections.length, MAX_SECTIONS, 'sections', issues);
  if (issues.length > 0) return { ok: false, issues };

  // Every nested property has been checked above; the assertion converts the validated JSON shape.
  const schema = immutableJsonClone(input) as ClinicalFormSchema;
  const semanticIssues = validateClinicalFormSchema(schema, context);
  return semanticIssues.length > 0 ? { ok: false, issues: semanticIssues } : { ok: true, value: schema };
}
