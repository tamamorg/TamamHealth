/** Browser-safe vocabulary for terminology definitions and their lifecycle. */

declare const terminologyIdBrand: unique symbol;

export type TerminologyId = string & { readonly [terminologyIdBrand]: 'TerminologyId' };

export const TERMINOLOGY_LOCALES = ['en', 'apd'] as const;
export type TerminologyLocale = (typeof TERMINOLOGY_LOCALES)[number];

/** English is required as the deployment-wide fallback; Juba Arabic is optional per term. */
export type LocalizedTerm = Readonly<Record<'en', string> & Partial<Record<'apd', string>>>;

export const CONCEPT_DATA_TYPES = [
  'coded', 'text', 'numeric', 'boolean', 'date', 'datetime',
] as const;
export type ConceptDataType = (typeof CONCEPT_DATA_TYPES)[number];

export const MAPPING_EQUIVALENCES = [
  'exact', 'equivalent', 'wider', 'narrower', 'related',
] as const;
export type MappingEquivalence = (typeof MAPPING_EQUIVALENCES)[number];

export interface ConceptMapping {
  readonly targetSystem: string;
  readonly targetCode: string;
  readonly equivalence: MappingEquivalence;
  readonly comment?: string;
}

/** Stable reference stored with clinical data so later terminology releases cannot change its meaning. */
export interface TerminologyConceptBinding {
  readonly system: string;
  readonly version: string;
  readonly code: string;
}

/** Stable reference to the exact value-set version used to constrain a coded answer. */
export interface TerminologyValueSetBinding {
  readonly canonicalUrl: string;
  readonly version: string;
}

export interface ConceptDefinition {
  readonly id: TerminologyId;
  readonly code: string;
  readonly display: LocalizedTerm;
  readonly definition?: LocalizedTerm;
  readonly synonyms?: readonly LocalizedTerm[];
  readonly dataType: ConceptDataType;
  readonly mappings?: readonly ConceptMapping[];
  readonly inactive?: boolean;
}

export const CODE_SYSTEM_CONTENT_MODES = ['complete', 'fragment', 'example'] as const;
export type CodeSystemContentMode = (typeof CODE_SYSTEM_CONTENT_MODES)[number];

export interface CodeSystemDefinition {
  readonly id: TerminologyId;
  readonly canonicalUrl: string;
  readonly name: string;
  readonly title: LocalizedTerm;
  readonly version: string;
  readonly content: CodeSystemContentMode;
  readonly concepts: readonly ConceptDefinition[];
}

export interface ValueSetConceptReference {
  readonly code: string;
  readonly display?: LocalizedTerm;
}

export interface ValueSetInclude {
  readonly system: string;
  readonly version?: string;
  /** Omit concepts to include every active concept from the named system. */
  readonly concepts?: readonly ValueSetConceptReference[];
}

export interface ValueSetDefinition {
  readonly id: TerminologyId;
  readonly canonicalUrl: string;
  readonly name: string;
  readonly title: LocalizedTerm;
  readonly version: string;
  readonly includes: readonly ValueSetInclude[];
  readonly excludes?: readonly ValueSetInclude[];
}

export interface DraftVocabularyVersion {
  readonly status: 'draft';
  readonly version: string;
  readonly createdAt: string;
}

export interface ActiveVocabularyVersion {
  readonly status: 'active';
  readonly version: string;
  readonly createdAt: string;
  readonly publishedAt: string;
}

export interface RetiredVocabularyVersion {
  readonly status: 'retired';
  readonly version: string;
  readonly createdAt: string;
  readonly publishedAt: string;
  readonly retiredAt: string;
}

export type VocabularyVersion =
  | DraftVocabularyVersion
  | ActiveVocabularyVersion
  | RetiredVocabularyVersion;

export type VocabularyVersionEvent =
  | { readonly type: 'publish'; readonly at: string }
  | { readonly type: 'retire'; readonly at: string };

export type VocabularyVersionTransition =
  | { readonly ok: true; readonly version: VocabularyVersion }
  | {
    readonly ok: false;
    readonly reason: 'invalid_transition' | 'invalid_timestamp' | 'timestamp_before_previous_event';
  };

export type TerminologyResource = CodeSystemDefinition | ValueSetDefinition;

export type TerminologyParseResult<T extends TerminologyResource> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly issues: readonly import('./validation').ValidationIssue[] };

export function terminologyId(value: string): TerminologyId {
  const normalized = value.trim();
  if (!normalized) throw new Error('Terminology identifiers cannot be empty.');
  return normalized as TerminologyId;
}
