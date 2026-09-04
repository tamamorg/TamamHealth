import {
  CODE_SYSTEM_CONTENT_MODES,
  CONCEPT_DATA_TYPES,
  MAPPING_EQUIVALENCES,
  terminologyId,
  type CodeSystemDefinition,
  type ConceptDefinition,
  type ConceptMapping,
  type LocalizedTerm,
  type TerminologyParseResult,
  type TerminologyResource,
  type ValueSetDefinition,
  type ValueSetInclude,
} from './types';
import {
  hasValidationErrors,
  validateCodeSystem,
  validateValueSet,
  type TerminologyValidationContext,
  type ValidationIssue,
} from './validation';

type UnknownRecord = Readonly<Record<string, unknown>>;
const MAX_CONCEPTS = 50_000;
const MAX_TERMS_PER_CONCEPT = 100;
const MAX_MAPPINGS_PER_CONCEPT = 100;
const MAX_COMPOSITIONS = 1_000;
const MAX_CODES_PER_COMPOSITION = 50_000;

function record(value: unknown, path: string, issues: ValidationIssue[]): UnknownRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    issues.push({ severity: 'error', code: 'invalid_type', path, message: 'Expected an object.' });
    return null;
  }
  return value as UnknownRecord;
}

function text(value: unknown, path: string, issues: ValidationIssue[]): string {
  if (typeof value !== 'string') {
    issues.push({ severity: 'error', code: 'invalid_type', path, message: 'Expected text.' });
    return '';
  }
  return value;
}

function optionalText(value: unknown, path: string, issues: ValidationIssue[]): string | undefined {
  return value === undefined ? undefined : text(value, path, issues);
}

function localized(value: unknown, path: string, issues: ValidationIssue[]): LocalizedTerm {
  const item = record(value, path, issues);
  if (!item) return { en: '' };
  const en = text(item.en, `${path}.en`, issues);
  const apd = optionalText(item.apd, `${path}.apd`, issues);
  return apd === undefined ? { en } : { en, apd };
}

function array(value: unknown, path: string, issues: ValidationIssue[], maximum: number): readonly unknown[] {
  if (!Array.isArray(value)) {
    issues.push({ severity: 'error', code: 'invalid_type', path, message: 'Expected a list.' });
    return [];
  }
  if (value.length > maximum) {
    issues.push({ severity: 'error', code: 'limit_exceeded', path, message: `List exceeds the import limit of ${maximum}.` });
  }
  return value.slice(0, maximum);
}

function mapping(value: unknown, path: string, issues: ValidationIssue[]): ConceptMapping {
  const item = record(value, path, issues) ?? {};
  const equivalence = text(item.equivalence, `${path}.equivalence`, issues);
  if (!MAPPING_EQUIVALENCES.includes(equivalence as ConceptMapping['equivalence'])) {
    issues.push({ severity: 'error', code: 'invalid_value', path: `${path}.equivalence`, message: 'Unknown mapping equivalence.' });
  }
  return {
    targetSystem: text(item.targetSystem, `${path}.targetSystem`, issues),
    targetCode: text(item.targetCode, `${path}.targetCode`, issues),
    equivalence: equivalence as ConceptMapping['equivalence'],
    ...(item.comment === undefined ? {} : { comment: text(item.comment, `${path}.comment`, issues) }),
  };
}

function concept(value: unknown, path: string, issues: ValidationIssue[]): ConceptDefinition {
  const item = record(value, path, issues) ?? {};
  const dataType = text(item.dataType, `${path}.dataType`, issues);
  if (!CONCEPT_DATA_TYPES.includes(dataType as ConceptDefinition['dataType'])) {
    issues.push({ severity: 'error', code: 'invalid_value', path: `${path}.dataType`, message: 'Unknown concept data type.' });
  }
  if (item.inactive !== undefined && typeof item.inactive !== 'boolean') {
    issues.push({ severity: 'error', code: 'invalid_type', path: `${path}.inactive`, message: 'Expected true or false.' });
  }
  return {
    id: terminologyId(text(item.id, `${path}.id`, issues) || `invalid-${path}`),
    code: text(item.code, `${path}.code`, issues),
    display: localized(item.display, `${path}.display`, issues),
    dataType: dataType as ConceptDefinition['dataType'],
    ...(item.definition === undefined ? {} : { definition: localized(item.definition, `${path}.definition`, issues) }),
    ...(item.synonyms === undefined ? {} : {
      synonyms: array(item.synonyms, `${path}.synonyms`, issues, MAX_TERMS_PER_CONCEPT)
        .map((term, index) => localized(term, `${path}.synonyms[${index}]`, issues)),
    }),
    ...(item.mappings === undefined ? {} : {
      mappings: array(item.mappings, `${path}.mappings`, issues, MAX_MAPPINGS_PER_CONCEPT)
        .map((entry, index) => mapping(entry, `${path}.mappings[${index}]`, issues)),
    }),
    ...(typeof item.inactive === 'boolean' ? { inactive: item.inactive } : {}),
  };
}

function include(value: unknown, path: string, issues: ValidationIssue[]): ValueSetInclude {
  const item = record(value, path, issues) ?? {};
  return {
    system: text(item.system, `${path}.system`, issues),
    ...(item.version === undefined ? {} : { version: text(item.version, `${path}.version`, issues) }),
    ...(item.concepts === undefined ? {} : {
      concepts: array(item.concepts, `${path}.concepts`, issues, MAX_CODES_PER_COMPOSITION).map((entry, index) => {
        const conceptItem = record(entry, `${path}.concepts[${index}]`, issues) ?? {};
        return {
          code: text(conceptItem.code, `${path}.concepts[${index}].code`, issues),
          ...(conceptItem.display === undefined ? {} : {
            display: localized(conceptItem.display, `${path}.concepts[${index}].display`, issues),
          }),
        };
      }),
    }),
  };
}

function finish<T extends TerminologyResource>(
  value: T,
  issues: ValidationIssue[],
  semanticIssues: readonly ValidationIssue[],
): TerminologyParseResult<T> {
  const combined = [...issues, ...semanticIssues];
  return hasValidationErrors(combined) ? { ok: false, issues: combined } : { ok: true, value };
}

export function parseCodeSystem(input: unknown): TerminologyParseResult<CodeSystemDefinition> {
  const issues: ValidationIssue[] = [];
  const item = record(input, '$', issues) ?? {};
  const content = text(item.content, 'content', issues);
  if (!CODE_SYSTEM_CONTENT_MODES.includes(content as CodeSystemDefinition['content'])) {
    issues.push({ severity: 'error', code: 'invalid_value', path: 'content', message: 'Unknown code-system content mode.' });
  }
  const value: CodeSystemDefinition = {
    id: terminologyId(text(item.id, 'id', issues) || 'invalid-code-system'),
    canonicalUrl: text(item.canonicalUrl, 'canonicalUrl', issues),
    name: text(item.name, 'name', issues),
    title: localized(item.title, 'title', issues),
    version: text(item.version, 'version', issues),
    content: content as CodeSystemDefinition['content'],
    concepts: array(item.concepts, 'concepts', issues, MAX_CONCEPTS).map((entry, index) => concept(entry, `concepts[${index}]`, issues)),
  };
  return finish(value, issues, issues.length === 0 ? validateCodeSystem(value) : []);
}

export function parseValueSet(
  input: unknown,
  context: TerminologyValidationContext = {},
): TerminologyParseResult<ValueSetDefinition> {
  const issues: ValidationIssue[] = [];
  const item = record(input, '$', issues) ?? {};
  const value: ValueSetDefinition = {
    id: terminologyId(text(item.id, 'id', issues) || 'invalid-value-set'),
    canonicalUrl: text(item.canonicalUrl, 'canonicalUrl', issues),
    name: text(item.name, 'name', issues),
    title: localized(item.title, 'title', issues),
    version: text(item.version, 'version', issues),
    includes: array(item.includes, 'includes', issues, MAX_COMPOSITIONS).map((entry, index) => include(entry, `includes[${index}]`, issues)),
    ...(item.excludes === undefined ? {} : {
      excludes: array(item.excludes, 'excludes', issues, MAX_COMPOSITIONS).map((entry, index) => include(entry, `excludes[${index}]`, issues)),
    }),
  };
  return finish(value, issues, issues.length === 0 ? validateValueSet(value, context) : []);
}
