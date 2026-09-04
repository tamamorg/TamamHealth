import type {
  ClinicalFormAnswers,
  ClinicalFormConditionRule,
  ClinicalFormVisibility,
} from './types';

function readPath(source: ClinicalFormAnswers, path: string): unknown {
  return path.split('.').reduce<unknown>((current, part) => {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined;
    return (current as Readonly<Record<string, unknown>>)[part];
  }, source);
}

function resolveConditionValue(
  fieldId: string,
  rootAnswers: ClinicalFormAnswers,
  localAnswers?: ClinicalFormAnswers,
): unknown {
  if (fieldId.startsWith('$root.')) return readPath(rootAnswers, fieldId.slice(6));
  if (localAnswers) return readPath(localAnswers, fieldId);
  return readPath(rootAnswers, fieldId);
}

function isConceptBinding(value: unknown): value is Readonly<{ system: string; version: string; code: string }> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Readonly<Record<string, unknown>>;
  return typeof candidate.system === 'string'
    && typeof candidate.version === 'string'
    && typeof candidate.code === 'string';
}

function valuesEqual(left: unknown, right: unknown): boolean {
  if (isConceptBinding(left) && isConceptBinding(right)) {
    return left.system === right.system && left.version === right.version && left.code === right.code;
  }
  return Object.is(left, right);
}

function exists(value: unknown): boolean {
  return value !== undefined
    && value !== null
    && value !== ''
    && (!Array.isArray(value) || value.length > 0);
}

export function evaluateClinicalFormCondition(
  rule: ClinicalFormConditionRule,
  rootAnswers: ClinicalFormAnswers,
  localAnswers?: ClinicalFormAnswers,
): boolean {
  const actual = resolveConditionValue(rule.fieldId, rootAnswers, localAnswers);

  switch (rule.operator) {
    case 'exists': return exists(actual) === (rule.value !== false);
    case 'equals': return valuesEqual(actual, rule.value);
    case 'notEquals': return exists(actual) && !valuesEqual(actual, rule.value);
    case 'contains':
      if (Array.isArray(actual)) return actual.some(value => valuesEqual(value, rule.value));
      return typeof actual === 'string' && typeof rule.value === 'string'
        ? actual.includes(rule.value)
        : false;
    case 'greaterThan': return typeof actual === 'number' && typeof rule.value === 'number' && actual > rule.value;
    case 'greaterThanOrEqual': return typeof actual === 'number' && typeof rule.value === 'number' && actual >= rule.value;
    case 'lessThan': return typeof actual === 'number' && typeof rule.value === 'number' && actual < rule.value;
    case 'lessThanOrEqual': return typeof actual === 'number' && typeof rule.value === 'number' && actual <= rule.value;
  }
}

export function isClinicalFormFieldVisible(
  visibility: ClinicalFormVisibility | undefined,
  rootAnswers: ClinicalFormAnswers,
  localAnswers?: ClinicalFormAnswers,
): boolean {
  if (!visibility) return true;
  const results = visibility.rules.map(rule => (
    evaluateClinicalFormCondition(rule, rootAnswers, localAnswers)
  ));
  return visibility.match === 'all' ? results.every(Boolean) : results.some(Boolean);
}
