import {
  CODE_SYSTEM_CONTENT_MODES,
  CONCEPT_DATA_TYPES,
  MAPPING_EQUIVALENCES,
  type CodeSystemDefinition,
  type ConceptDefinition,
  type ConceptMapping,
  type LocalizedTerm,
  type ValueSetDefinition,
} from './types';

export type ValidationIssueCode =
  | 'required'
  | 'invalid_type'
  | 'invalid_url'
  | 'invalid_value'
  | 'limit_exceeded'
  | 'duplicate_code'
  | 'duplicate_id'
  | 'duplicate_mapping'
  | 'duplicate_include'
  | 'unknown_system'
  | 'ambiguous_system'
  | 'unknown_code';

export interface ValidationIssue {
  readonly severity: 'error' | 'warning';
  readonly code: ValidationIssueCode;
  readonly path: string;
  readonly message: string;
}

export interface TerminologyValidationContext {
  readonly codeSystems?: readonly CodeSystemDefinition[];
}

function required(value: string, path: string, issues: ValidationIssue[]): void {
  if (!value.trim()) issues.push({ severity: 'error', code: 'required', path, message: 'A value is required.' });
}

function validateCanonicalUrl(value: string, path: string, issues: ValidationIssue[]): void {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('unsupported protocol');
  } catch {
    issues.push({ severity: 'error', code: 'invalid_url', path, message: 'Use an absolute HTTP or HTTPS URL.' });
  }
}

function validateLocalizedTerm(value: LocalizedTerm, path: string, issues: ValidationIssue[]): void {
  required(value.en, `${path}.en`, issues);
  if (value.apd !== undefined) required(value.apd, `${path}.apd`, issues);
}

export function validateConceptMapping(mapping: ConceptMapping, path = 'mapping'): readonly ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  required(mapping.targetSystem, `${path}.targetSystem`, issues);
  validateCanonicalUrl(mapping.targetSystem, `${path}.targetSystem`, issues);
  required(mapping.targetCode, `${path}.targetCode`, issues);
  if (!MAPPING_EQUIVALENCES.includes(mapping.equivalence)) {
    issues.push({ severity: 'error', code: 'invalid_value', path: `${path}.equivalence`, message: 'Unknown mapping equivalence.' });
  }
  return issues;
}

export function validateConcept(concept: ConceptDefinition, path = 'concept'): readonly ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  required(concept.id, `${path}.id`, issues);
  required(concept.code, `${path}.code`, issues);
  validateLocalizedTerm(concept.display, `${path}.display`, issues);
  if (concept.definition) validateLocalizedTerm(concept.definition, `${path}.definition`, issues);
  concept.synonyms?.forEach((term, index) => validateLocalizedTerm(term, `${path}.synonyms[${index}]`, issues));
  if (!CONCEPT_DATA_TYPES.includes(concept.dataType)) {
    issues.push({ severity: 'error', code: 'invalid_value', path: `${path}.dataType`, message: 'Unknown concept data type.' });
  }

  const mappings = new Set<string>();
  concept.mappings?.forEach((mapping, index) => {
    issues.push(...validateConceptMapping(mapping, `${path}.mappings[${index}]`));
    const key = `${mapping.targetSystem}\u0000${mapping.targetCode}\u0000${mapping.equivalence}`;
    if (mappings.has(key)) {
      issues.push({ severity: 'error', code: 'duplicate_mapping', path: `${path}.mappings[${index}]`, message: 'This mapping is already defined.' });
    }
    mappings.add(key);
  });
  return issues;
}

export function validateCodeSystem(system: CodeSystemDefinition): readonly ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  required(system.id, 'id', issues);
  required(system.name, 'name', issues);
  required(system.version, 'version', issues);
  validateCanonicalUrl(system.canonicalUrl, 'canonicalUrl', issues);
  validateLocalizedTerm(system.title, 'title', issues);
  if (!CODE_SYSTEM_CONTENT_MODES.includes(system.content)) {
    issues.push({ severity: 'error', code: 'invalid_value', path: 'content', message: 'Unknown code-system content mode.' });
  }

  const codes = new Set<string>();
  const ids = new Set<string>();
  system.concepts.forEach((concept, index) => {
    issues.push(...validateConcept(concept, `concepts[${index}]`));
    const key = concept.code.trim().toLocaleLowerCase();
    if (codes.has(key)) {
      issues.push({ severity: 'error', code: 'duplicate_code', path: `concepts[${index}].code`, message: 'Concept codes must be unique within a code system.' });
    }
    codes.add(key);
    const id = concept.id.trim();
    if (ids.has(id)) {
      issues.push({ severity: 'error', code: 'duplicate_id', path: `concepts[${index}].id`, message: 'Concept identifiers must be unique within a code system.' });
    }
    ids.add(id);
  });
  return issues;
}

export function validateValueSet(
  valueSet: ValueSetDefinition,
  context: TerminologyValidationContext = {},
): readonly ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  required(valueSet.id, 'id', issues);
  required(valueSet.name, 'name', issues);
  required(valueSet.version, 'version', issues);
  validateCanonicalUrl(valueSet.canonicalUrl, 'canonicalUrl', issues);
  validateLocalizedTerm(valueSet.title, 'title', issues);
  if (valueSet.includes.length === 0) {
    issues.push({ severity: 'error', code: 'required', path: 'includes', message: 'A value set must include at least one code system.' });
  }

  const knownSystems = new Map(
    (context.codeSystems ?? []).map(system => [`${system.canonicalUrl}\u0000${system.version}`, system]),
  );
  const systemsByCanonical = new Map<string, CodeSystemDefinition[]>();
  for (const system of context.codeSystems ?? []) {
    const versions = systemsByCanonical.get(system.canonicalUrl) ?? [];
    versions.push(system);
    systemsByCanonical.set(system.canonicalUrl, versions);
  }
  const validateComposition = (
    include: ValueSetDefinition['includes'][number],
    path: string,
    compositionKeys: Set<string>,
  ): void => {
    validateCanonicalUrl(include.system, `${path}.system`, issues);
    const key = `${include.system}\u0000${include.version ?? ''}`;
    if (compositionKeys.has(key)) {
      issues.push({ severity: 'warning', code: 'duplicate_include', path, message: 'This code-system version is composed more than once.' });
    }
    compositionKeys.add(key);

    if (!context.codeSystems) return;
    const matchingVersions = systemsByCanonical.get(include.system) ?? [];
    const system = include.version === undefined
      ? (matchingVersions.length === 1 ? matchingVersions[0] : undefined)
      : knownSystems.get(`${include.system}\u0000${include.version}`);
    if (include.version === undefined && matchingVersions.length > 1) {
      issues.push({ severity: 'error', code: 'ambiguous_system', path: `${path}.version`, message: 'Specify a code-system version when multiple versions are available.' });
      return;
    }
    if (!system) {
      issues.push({ severity: 'error', code: 'unknown_system', path: `${path}.system`, message: 'The referenced code-system version is not available.' });
      return;
    }
    const knownCodes = new Set(system.concepts.map(concept => concept.code));
    include.concepts?.forEach((concept, index) => {
      required(concept.code, `${path}.concepts[${index}].code`, issues);
      if (!knownCodes.has(concept.code)) {
        issues.push({ severity: 'error', code: 'unknown_code', path: `${path}.concepts[${index}].code`, message: 'The referenced concept does not exist in this code system.' });
      }
      if (concept.display) validateLocalizedTerm(concept.display, `${path}.concepts[${index}].display`, issues);
    });
  };

  const includeKeys = new Set<string>();
  const excludeKeys = new Set<string>();
  valueSet.includes.forEach((include, index) => validateComposition(include, `includes[${index}]`, includeKeys));
  valueSet.excludes?.forEach((include, index) => validateComposition(include, `excludes[${index}]`, excludeKeys));
  return issues;
}

export function hasValidationErrors(issues: readonly ValidationIssue[]): boolean {
  return issues.some(issue => issue.severity === 'error');
}

/**
 * Lexical precheck only. A fetcher must also resolve DNS, reject private results,
 * cap redirects and response size, and repeat validation after every redirect.
 */
export function passesTerminologyImportUrlPrecheck(value: string): boolean {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return false;
    const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (host === 'localhost' || host === '::1' || host.endsWith('.local')) return false;
    if (/^(?:fc|fd|fe[89ab])[0-9a-f:]*$/i.test(host)) return false;
    if (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host)) return false;
    const private172 = /^172\.(\d{1,3})\./.exec(host);
    if (private172 && Number(private172[1]) >= 16 && Number(private172[1]) <= 31) return false;
    return !/^169\.254\./.test(host) && host !== '0.0.0.0';
  } catch {
    return false;
  }
}
