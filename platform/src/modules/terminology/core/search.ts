import type {
  CodeSystemDefinition,
  ConceptDefinition,
  TerminologyLocale,
  ValueSetDefinition,
} from './types';

export interface ConceptSearchOptions {
  readonly locale?: TerminologyLocale;
  readonly includeInactive?: boolean;
  readonly limit?: number;
  readonly valueSet?: ValueSetDefinition;
}

export interface ConceptSearchResult {
  readonly system: string;
  readonly systemVersion: string;
  readonly concept: ConceptDefinition;
  readonly display: string;
  readonly score: number;
}

function normalized(value: string): string {
  return value.normalize('NFKD').toLowerCase().replace(/[\u0300-\u036f]/g, '').trim();
}

function compareStable(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function conceptDisplay(concept: ConceptDefinition, locale: TerminologyLocale = 'en'): string {
  return concept.display[locale]?.trim() || concept.display.en.trim() || concept.code;
}

function compositionMatches(
  item: ValueSetDefinition['includes'][number],
  system: CodeSystemDefinition,
): boolean {
  return item.system === system.canonicalUrl
    && (item.version === undefined || item.version === system.version);
}

function conceptAllowed(
  valueSet: ValueSetDefinition | undefined,
  system: CodeSystemDefinition,
  code: string,
): boolean {
  if (!valueSet) return true;
  const included = valueSet.includes.some(item => compositionMatches(item, system)
    && (item.concepts === undefined || item.concepts.some(concept => concept.code === code)));
  if (!included) return false;
  return !(valueSet.excludes ?? []).some(item => compositionMatches(item, system)
    && (item.concepts === undefined || item.concepts.some(concept => concept.code === code)));
}

function rankConcept(concept: ConceptDefinition, query: string, locale: TerminologyLocale): number {
  if (!query) return 1;
  const code = normalized(concept.code);
  const preferred = normalized(conceptDisplay(concept, locale));
  const labels = [preferred, normalized(concept.display.en),
    ...(concept.synonyms ?? []).flatMap(term => [normalized(term[locale] ?? ''), normalized(term.en)]),
  ].filter(Boolean);
  if (code === query) return 100;
  if (labels.includes(query)) return 90;
  if (code.startsWith(query)) return 80;
  if (labels.some(label => label.startsWith(query))) return 70;
  if (code.includes(query)) return 60;
  if (labels.some(label => label.includes(query))) return 50;
  const words = query.split(/\s+/).filter(Boolean);
  return words.length > 1 && words.every(word => labels.some(label => label.includes(word))) ? 40 : 0;
}

/** Deterministic ranked search across code, preferred display and synonyms. */
export function searchConcepts(
  systems: readonly CodeSystemDefinition[],
  query: string,
  options: ConceptSearchOptions = {},
): readonly ConceptSearchResult[] {
  const locale = options.locale ?? 'en';
  const needle = normalized(query);
  const results: ConceptSearchResult[] = [];

  for (const system of systems) {
    for (const concept of system.concepts) {
      if (concept.inactive && !options.includeInactive) continue;
      if (!conceptAllowed(options.valueSet, system, concept.code)) continue;
      const score = rankConcept(concept, needle, locale);
      if (score === 0) continue;
      results.push({
        system: system.canonicalUrl,
        systemVersion: system.version,
        concept,
        display: conceptDisplay(concept, locale),
        score,
      });
    }
  }

  return results
    .sort((left, right) => right.score - left.score
      || compareStable(left.display, right.display)
      || compareStable(left.concept.code, right.concept.code)
      || compareStable(left.systemVersion, right.systemVersion))
    .slice(0, Math.max(0, options.limit ?? 25));
}
