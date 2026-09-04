import type {
  ClinicalFormConditionRule,
  ClinicalFormField,
  ClinicalFormSchema,
  ClinicalFormSchemaIssue,
  ClinicalFormTerminologyContext,
  LocalizedClinicalText,
} from './types';
import type { TerminologyConceptBinding, TerminologyValueSetBinding } from '@/modules/terminology/client';

const ID_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*$/;
const FORM_STATUSES = ['draft', 'published', 'retired'] as const;
const TEXT_PATTERNS = ['phone', 'email', 'identifier'] as const;

function addIssue(issues: ClinicalFormSchemaIssue[], path: string, code: ClinicalFormSchemaIssue['code'], message: string): void {
  issues.push({ path, code, message });
}

function validateText(text: LocalizedClinicalText, path: string, issues: ClinicalFormSchemaIssue[]): void {
  if (!text.en.trim()) addIssue(issues, `${path}.en`, 'required', 'English text is required.');
  if (!text.apd.trim()) addIssue(issues, `${path}.apd`, 'required', 'Juba Arabic text is required.');
}

export function isValidClinicalDate(type: 'date' | 'datetime', value: string): boolean {
  if (type === 'date') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }
  const match = /^(\d{4}-\d{2}-\d{2})T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) return false;
  return isValidClinicalDate('date', match[1]) && Number.isFinite(Date.parse(value));
}

export function compareClinicalDates(type: 'date' | 'datetime', left: string, right: string): number {
  if (type === 'date') return left < right ? -1 : left > right ? 1 : 0;
  return Date.parse(left) - Date.parse(right);
}

function sameConcept(left: TerminologyConceptBinding, right: TerminologyConceptBinding): boolean {
  return left.system === right.system && left.version === right.version && left.code === right.code;
}

function sameValueSet(left: TerminologyValueSetBinding, right: TerminologyValueSetBinding): boolean {
  return left.canonicalUrl === right.canonicalUrl && left.version === right.version;
}

function validateConceptBinding(
  binding: TerminologyConceptBinding,
  path: string,
  issues: ClinicalFormSchemaIssue[],
  context: ClinicalFormTerminologyContext,
): void {
  for (const [name, value] of Object.entries(binding)) {
    if (!value.trim()) addIssue(issues, `${path}.${name}`, 'required', 'A terminology binding value is required.');
  }
  try { new URL(binding.system); } catch {
    addIssue(issues, `${path}.system`, 'invalidValue', 'Concept system must be an absolute URL.');
  }
  if (!context.concepts?.some(candidate => sameConcept(candidate, binding))) {
    addIssue(issues, path, 'unknownReference', 'The exact terminology concept version is not available.');
  }
}

function validateBinding(
  field: Exclude<ClinicalFormField, { type: 'group' }>,
  path: string,
  issues: ClinicalFormSchemaIssue[],
  context: ClinicalFormTerminologyContext,
): void {
  const binding = field.observation;
  if (!binding) return;
  validateConceptBinding(binding.concept, `${path}.observation.concept`, issues, context);
  if (binding.unit && field.type !== 'number') {
    addIssue(issues, `${path}.observation.unit`, 'invalidValue', 'Only numeric observations may declare a unit.');
  }
  if (binding.unit) validateConceptBinding(binding.unit, `${path}.observation.unit`, issues, context);
}

interface FieldLocation {
  readonly field: ClinicalFormField;
  readonly path: string;
  readonly siblingIds: ReadonlySet<string>;
  readonly topLevel: boolean;
}

function validateCondition(
  owner: FieldLocation,
  rule: ClinicalFormConditionRule,
  path: string,
  fieldsById: ReadonlyMap<string, ClinicalFormField>,
  rootIds: ReadonlySet<string>,
  issues: ClinicalFormSchemaIssue[],
): string | null {
  const targetId = rule.fieldId.startsWith('$root.') ? rule.fieldId.slice(6) : rule.fieldId;
  if (!ID_PATTERN.test(targetId)) {
    addIssue(issues, `${path}.fieldId`, 'invalidValue', 'Condition field reference is invalid.');
    return null;
  }
  const explicitlyRoot = rule.fieldId.startsWith('$root.');
  const accessible = explicitlyRoot ? rootIds.has(targetId)
    : owner.topLevel ? rootIds.has(targetId) : owner.siblingIds.has(targetId);
  const target = accessible ? fieldsById.get(targetId) : undefined;
  if (!target) {
    addIssue(issues, `${path}.fieldId`, 'unknownReference', 'Condition references a field outside its sibling or root scope.');
    return null;
  }
  if (target.id === owner.field.id) addIssue(issues, `${path}.fieldId`, 'cycle', 'A field cannot control its own visibility.');

  if (rule.operator === 'exists') {
    if (rule.value !== undefined && typeof rule.value !== 'boolean') {
      addIssue(issues, `${path}.value`, 'invalidType', 'Existence conditions accept only true or false.');
    }
  } else if (rule.value === undefined) {
    addIssue(issues, `${path}.value`, 'required', 'This condition requires a comparison value.');
  }

  const numeric = ['greaterThan', 'greaterThanOrEqual', 'lessThan', 'lessThanOrEqual'].includes(rule.operator);
  if (numeric && (target.type !== 'number' || typeof rule.value !== 'number')) {
    addIssue(issues, path, 'invalidType', 'Numeric comparison requires a numeric field and value.');
  }
  if (rule.operator === 'contains') {
    const supportsContains = target.type === 'text' || target.type === 'textarea' || target.type === 'multiSelect';
    const codedValue = rule.value !== null && typeof rule.value === 'object';
    if (!supportsContains || (target.type === 'multiSelect' && target.valueSet ? !codedValue : typeof rule.value !== 'string')) {
      addIssue(issues, path, 'invalidType', 'Contains value does not match the referenced field.');
    }
  }
  if ((rule.operator === 'equals' || rule.operator === 'notEquals') && rule.value !== undefined) {
    const expected = target.type === 'number' ? 'number'
      : target.type === 'boolean' ? 'boolean'
        : ['text', 'textarea', 'date', 'datetime'].includes(target.type) || (target.type === 'select' && target.options) ? 'string'
          : null;
    const codedEquality = target.type === 'select' && target.valueSet && rule.value !== null && typeof rule.value === 'object';
    if (!codedEquality && (expected === null || (rule.value !== null && typeof rule.value !== expected))) {
      addIssue(issues, path, 'invalidType', 'Equality comparison value does not match the referenced field.');
    }
  }
  return targetId;
}

function validateFields(
  fields: readonly ClinicalFormField[],
  path: string,
  locations: Map<string, FieldLocation>,
  issues: ClinicalFormSchemaIssue[],
  context: ClinicalFormTerminologyContext,
  topLevel: boolean,
): void {
  const siblingIds = new Set(fields.map(field => field.id));
  fields.forEach((field, index) => {
    const fieldPath = `${path}[${index}]`;
    if (!ID_PATTERN.test(field.id)) addIssue(issues, `${fieldPath}.id`, 'invalidValue', 'Field id uses an unsupported format.');
    if (locations.has(field.id)) addIssue(issues, `${fieldPath}.id`, 'duplicate', `Duplicate field id: ${field.id}.`);
    locations.set(field.id, { field, path: fieldPath, siblingIds, topLevel });
    validateText(field.label, `${fieldPath}.label`, issues);
    if (field.helpText) validateText(field.helpText, `${fieldPath}.helpText`, issues);
    if (field.visibility?.rules.length === 0) addIssue(issues, `${fieldPath}.visibility.rules`, 'required', 'Visibility must contain at least one rule.');

    if (field.type === 'text' || field.type === 'textarea') {
      if (field.minLength !== undefined && (!Number.isInteger(field.minLength) || field.minLength < 0)) addIssue(issues, `${fieldPath}.minLength`, 'invalidValue', 'Minimum length must be a non-negative integer.');
      if (field.maxLength !== undefined && (!Number.isInteger(field.maxLength) || field.maxLength < 1)) addIssue(issues, `${fieldPath}.maxLength`, 'invalidValue', 'Maximum length must be a positive integer.');
      if (field.minLength !== undefined && field.maxLength !== undefined && field.minLength > field.maxLength) addIssue(issues, fieldPath, 'invalidValue', 'Minimum length cannot exceed maximum length.');
      if (field.pattern !== undefined && !TEXT_PATTERNS.includes(field.pattern)) addIssue(issues, `${fieldPath}.pattern`, 'invalidValue', 'Text pattern is not supported.');
    }

    if (field.type === 'number') {
      if (field.min !== undefined && !Number.isFinite(field.min)) addIssue(issues, `${fieldPath}.min`, 'invalidValue', 'Minimum must be finite.');
      if (field.max !== undefined && !Number.isFinite(field.max)) addIssue(issues, `${fieldPath}.max`, 'invalidValue', 'Maximum must be finite.');
      if (field.min !== undefined && field.max !== undefined && field.min > field.max) addIssue(issues, fieldPath, 'invalidValue', 'Minimum cannot exceed maximum.');
      if (field.precision !== undefined && (!Number.isInteger(field.precision) || field.precision < 0 || field.precision > 10)) addIssue(issues, `${fieldPath}.precision`, 'invalidValue', 'Precision must be an integer from 0 through 10.');
    }

    if (field.type === 'date' || field.type === 'datetime') {
      if (field.min !== undefined && !isValidClinicalDate(field.type, field.min)) addIssue(issues, `${fieldPath}.min`, 'invalidValue', 'Minimum date is invalid.');
      if (field.max !== undefined && !isValidClinicalDate(field.type, field.max)) addIssue(issues, `${fieldPath}.max`, 'invalidValue', 'Maximum date is invalid.');
      if (field.min !== undefined && field.max !== undefined
        && isValidClinicalDate(field.type, field.min) && isValidClinicalDate(field.type, field.max)
        && compareClinicalDates(field.type, field.min, field.max) > 0) {
        addIssue(issues, fieldPath, 'invalidValue', 'Minimum date cannot exceed maximum date.');
      }
    }

    if (field.type === 'select' || field.type === 'multiSelect') {
      const hasOptions = field.options !== undefined;
      const hasValueSet = field.valueSet !== undefined;
      if (hasOptions === hasValueSet) addIssue(issues, fieldPath, 'invalidValue', 'Choice fields require exactly one option source.');
      const values = new Set<string>();
      if (field.options?.length === 0) addIssue(issues, `${fieldPath}.options`, 'required', 'Inline choice fields require at least one option.');
      field.options?.forEach((option, optionIndex) => {
        const optionPath = `${fieldPath}.options[${optionIndex}]`;
        if (!option.value.trim()) addIssue(issues, `${optionPath}.value`, 'required', 'Option value is required.');
        const key = option.value.trim().toLowerCase();
        if (values.has(key)) addIssue(issues, `${optionPath}.value`, 'duplicate', `Duplicate option value: ${option.value}.`);
        values.add(key);
        validateText(option.label, `${optionPath}.label`, issues);
      });
      if (field.valueSet) {
        if (!field.valueSet.canonicalUrl.trim()) addIssue(issues, `${fieldPath}.valueSet.canonicalUrl`, 'required', 'Value-set URL is required.');
        if (!field.valueSet.version.trim()) addIssue(issues, `${fieldPath}.valueSet.version`, 'required', 'Value-set version is required.');
        try { new URL(field.valueSet.canonicalUrl); } catch { addIssue(issues, `${fieldPath}.valueSet.canonicalUrl`, 'invalidValue', 'Value-set URL must be absolute.'); }
        if (!context.valueSets?.some(candidate => sameValueSet(candidate, field.valueSet!))) {
          addIssue(issues, `${fieldPath}.valueSet`, 'unknownReference', 'The exact value-set version is not available.');
        }
      }
    }

    if (field.type === 'group') {
      if (field.fields.length === 0) addIssue(issues, `${fieldPath}.fields`, 'required', 'Groups require at least one field.');
      const min = field.repeatable?.minItems;
      const max = field.repeatable?.maxItems;
      if (min !== undefined && (!Number.isInteger(min) || min < 0)) addIssue(issues, `${fieldPath}.repeatable.minItems`, 'invalidValue', 'Minimum items must be a non-negative integer.');
      if (max !== undefined && (!Number.isInteger(max) || max < 1)) addIssue(issues, `${fieldPath}.repeatable.maxItems`, 'invalidValue', 'Maximum items must be a positive integer.');
      if (min !== undefined && max !== undefined && min > max) addIssue(issues, `${fieldPath}.repeatable`, 'invalidValue', 'Minimum items cannot exceed maximum items.');
      validateFields(field.fields, `${fieldPath}.fields`, locations, issues, context, false);
    } else {
      validateBinding(field, fieldPath, issues, context);
    }
  });
}

function validateConditions(locations: ReadonlyMap<string, FieldLocation>, rootIds: ReadonlySet<string>, issues: ClinicalFormSchemaIssue[]): void {
  const fieldsById = new Map([...locations].map(([id, location]) => [id, location.field]));
  const edges = new Map<string, string[]>();
  for (const [id, location] of locations) {
    const { field, path } = location;
    const targets: string[] = [];
    field.visibility?.rules.forEach((rule, index) => {
      const target = validateCondition(location, rule, `${path}.visibility.rules[${index}]`, fieldsById, rootIds, issues);
      if (target) targets.push(target);
    });
    edges.set(id, targets);
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const reported = new Set<string>();
  const visit = (id: string): void => {
    if (visiting.has(id)) {
      if (!reported.has(id)) {
        addIssue(issues, `${locations.get(id)?.path}.visibility`, 'cycle', 'Conditional visibility contains a cycle.');
        reported.add(id);
      }
      return;
    }
    if (visited.has(id)) return;
    visiting.add(id);
    for (const target of edges.get(id) ?? []) visit(target);
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of locations.keys()) visit(id);
}

export function validateClinicalFormSchema(
  schema: ClinicalFormSchema,
  context: ClinicalFormTerminologyContext = {},
): readonly ClinicalFormSchemaIssue[] {
  const issues: ClinicalFormSchemaIssue[] = [];
  if (!ID_PATTERN.test(schema.id)) addIssue(issues, 'id', 'invalidValue', 'Schema id must use the supported identifier format.');
  if (!Number.isInteger(schema.version) || schema.version < 1) addIssue(issues, 'version', 'invalidValue', 'Schema version must be a positive integer.');
  if (!FORM_STATUSES.includes(schema.status)) addIssue(issues, 'status', 'invalidValue', 'Schema status is invalid.');
  validateText(schema.title, 'title', issues);
  if (schema.description) validateText(schema.description, 'description', issues);
  if (schema.sections.length === 0) addIssue(issues, 'sections', 'required', 'A schema requires at least one section.');

  const sectionIds = new Set<string>();
  const locations = new Map<string, FieldLocation>();
  const rootIds = new Set(schema.sections.flatMap(section => section.fields.map(field => field.id)));
  schema.sections.forEach((section, index) => {
    const sectionPath = `sections[${index}]`;
    if (!ID_PATTERN.test(section.id)) addIssue(issues, `${sectionPath}.id`, 'invalidValue', 'Section id uses an unsupported format.');
    if (sectionIds.has(section.id)) addIssue(issues, `${sectionPath}.id`, 'duplicate', `Duplicate section id: ${section.id}.`);
    sectionIds.add(section.id);
    validateText(section.label, `${sectionPath}.label`, issues);
    if (section.description) validateText(section.description, `${sectionPath}.description`, issues);
    validateFields(section.fields, `${sectionPath}.fields`, locations, issues, context, true);
  });
  validateConditions(locations, rootIds, issues);
  return issues;
}

export function clinicalFormVersionKey(schema: Pick<ClinicalFormSchema, 'id' | 'version'>): string {
  return `${schema.id}@${schema.version}`;
}

export function compareClinicalFormVersions(left: Pick<ClinicalFormSchema, 'id' | 'version'>, right: Pick<ClinicalFormSchema, 'id' | 'version'>): number {
  if (left.id !== right.id) throw new Error('Clinical form versions must have the same schema id.');
  return left.version - right.version;
}
