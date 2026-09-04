import {
  conceptDisplay,
  hasValidationErrors,
  passesTerminologyImportUrlPrecheck,
  parseCodeSystem,
  parseValueSet,
  searchConcepts,
  terminologyId,
  transitionVocabularyVersion,
  validateCodeSystem,
  validateValueSet,
  type CodeSystemDefinition,
  type ValueSetDefinition,
} from '@/modules/terminology';
import { searchConcepts as searchOnClient } from '@/modules/terminology/client';

const conditions: CodeSystemDefinition = {
  id: terminologyId('conditions'),
  canonicalUrl: 'https://tamamhealth.org/terminology/conditions',
  name: 'ClinicalConditions',
  title: { en: 'Clinical conditions', apd: 'حالات مرضية' },
  version: '2026.09',
  content: 'complete',
  concepts: [
    {
      id: terminologyId('condition-malaria'),
      code: 'MAL',
      display: { en: 'Malaria', apd: 'ملاريا' },
      synonyms: [{ en: 'Malaria infection' }],
      dataType: 'coded',
      mappings: [{
        targetSystem: 'https://id.who.int/icd/release/11/mms',
        targetCode: '1F40',
        equivalence: 'equivalent',
      }],
    },
    {
      id: terminologyId('condition-measles'),
      code: 'MEA',
      display: { en: 'Measles', apd: 'حصبة' },
      dataType: 'coded',
      inactive: true,
    },
  ],
};

const malariaOnly: ValueSetDefinition = {
  id: terminologyId('malaria-only'),
  canonicalUrl: 'https://tamamhealth.org/terminology/value-sets/malaria-only',
  name: 'MalariaOnly',
  title: { en: 'Malaria only' },
  version: '1',
  includes: [{
    system: conditions.canonicalUrl,
    version: conditions.version,
    concepts: [{ code: 'MAL' }],
  }],
};

describe('terminology validation', () => {
  it('accepts a well-formed code system with localized concepts and mappings', () => {
    expect(validateCodeSystem(conditions)).toEqual([]);
  });

  it('reports duplicate codes and mappings at precise paths', () => {
    const duplicate: CodeSystemDefinition = {
      ...conditions,
      concepts: [conditions.concepts[0], {
        ...conditions.concepts[0],
        id: terminologyId('duplicate'),
        code: 'mal',
        mappings: [conditions.concepts[0].mappings![0], conditions.concepts[0].mappings![0]],
      }],
    };

    const issues = validateCodeSystem(duplicate);
    expect(issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'duplicate_code', path: 'concepts[1].code' }),
      expect.objectContaining({ code: 'duplicate_mapping', path: 'concepts[1].mappings[1]' }),
    ]));
    expect(hasValidationErrors(issues)).toBe(true);
  });

  it('rejects duplicate concept identifiers', () => {
    const duplicateId: CodeSystemDefinition = {
      ...conditions,
      concepts: [conditions.concepts[0], { ...conditions.concepts[1], id: conditions.concepts[0].id }],
    };
    expect(validateCodeSystem(duplicateId)).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'duplicate_id', path: 'concepts[1].id' }),
    ]));
  });

  it('checks value-set references against known code-system versions and codes', () => {
    expect(validateValueSet(malariaOnly, { codeSystems: [conditions] })).toEqual([]);

    const invalid: ValueSetDefinition = {
      ...malariaOnly,
      includes: [{ system: conditions.canonicalUrl, version: 'old', concepts: [{ code: 'UNKNOWN' }] }],
    };
    expect(validateValueSet(invalid, { codeSystems: [conditions] }))
      .toEqual(expect.arrayContaining([expect.objectContaining({ code: 'unknown_system' })]));
  });

  it('validates the requested code-system version when several versions share a canonical URL', () => {
    const next: CodeSystemDefinition = {
      ...conditions,
      id: terminologyId('conditions-v2'),
      version: '2027.01',
      concepts: [{
        id: terminologyId('condition-new'),
        code: 'NEW',
        display: { en: 'New condition' },
        dataType: 'coded',
      }],
    };
    expect(validateValueSet(malariaOnly, { codeSystems: [conditions, next] })).toEqual([]);
    expect(validateValueSet({
      ...malariaOnly,
      includes: [{ system: conditions.canonicalUrl }],
    }, { codeSystems: [conditions, next] })).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'ambiguous_system', path: 'includes[0].version' }),
    ]));
  });

  it('decodes untrusted terminology JSON without throwing', () => {
    expect(parseCodeSystem({ id: 'broken' })).toEqual(expect.objectContaining({ ok: false }));
    expect(parseValueSet(null)).toEqual(expect.objectContaining({ ok: false }));
    expect(parseCodeSystem(conditions)).toEqual({ ok: true, value: conditions });
  });

  it('bounds nested terminology arrays before processing them', () => {
    const oversized = {
      ...conditions,
      concepts: [{
        ...conditions.concepts[0],
        synonyms: Array.from({ length: 101 }, (_, index) => ({ en: `Term ${index}` })),
      }],
    };
    expect(parseCodeSystem(oversized)).toEqual(expect.objectContaining({
      ok: false,
      issues: expect.arrayContaining([
        expect.objectContaining({ code: 'limit_exceeded', path: 'concepts[0].synonyms' }),
      ]),
    }));
  });

  it('keeps canonical identifiers separate from the remote URL lexical precheck', () => {
    expect(passesTerminologyImportUrlPrecheck('https://terminology.example.org/package.json')).toBe(true);
    expect(passesTerminologyImportUrlPrecheck('http://127.0.0.1/private')).toBe(false);
    expect(passesTerminologyImportUrlPrecheck('https://user:secret@example.org/package.json')).toBe(false);
  });
});

describe('terminology search', () => {
  it('ranks exact codes before label and synonym matches', () => {
    const exact = searchConcepts([conditions], 'MAL');
    expect(exact[0]).toMatchObject({ score: 100, display: 'Malaria' });
    expect(searchOnClient([conditions], 'MAL')[0]).toMatchObject({ score: 100, display: 'Malaria' });

    const synonym = searchConcepts([conditions], 'infection');
    expect(synonym[0]?.concept.code).toBe('MAL');
  });

  it('uses the requested locale, falls back to English and excludes inactive concepts', () => {
    expect(conceptDisplay(conditions.concepts[0], 'apd')).toBe('ملاريا');
    expect(searchConcepts([conditions], '', { locale: 'apd' }).map(item => item.concept.code)).toEqual(['MAL']);
    expect(searchConcepts([conditions], '', { includeInactive: true })).toHaveLength(2);
  });

  it('limits results to concepts composed by a value set', () => {
    const results = searchConcepts([conditions], '', { valueSet: malariaOnly, includeInactive: true });
    expect(results.map(item => item.concept.code)).toEqual(['MAL']);
  });

  it('subtracts concept exclusions from a whole-system inclusion', () => {
    const exceptMeasles: ValueSetDefinition = {
      ...malariaOnly,
      includes: [{ system: conditions.canonicalUrl }],
      excludes: [{ system: conditions.canonicalUrl, concepts: [{ code: 'MEA' }] }],
    };

    expect(validateValueSet(exceptMeasles, { codeSystems: [conditions] }))
      .not.toEqual(expect.arrayContaining([expect.objectContaining({ code: 'duplicate_include' })]));
    expect(searchConcepts([conditions], '', { valueSet: exceptMeasles, includeInactive: true })
      .map(item => item.concept.code)).toEqual(['MAL']);
  });
});

describe('vocabulary version lifecycle', () => {
  it('allows draft to publish and active to retire', () => {
    const published = transitionVocabularyVersion(
      { status: 'draft', version: '1', createdAt: '2026-09-01T00:00:00Z' },
      { type: 'publish', at: '2026-09-02T00:00:00Z' },
    );
    expect(published).toEqual(expect.objectContaining({ ok: true }));
    if (!published.ok) throw new Error('Expected a published version.');

    expect(transitionVocabularyVersion(
      published.version,
      { type: 'retire', at: '2026-09-03T00:00:00Z' },
    )).toEqual({
      ok: true,
      version: {
        status: 'retired',
        version: '1',
        createdAt: '2026-09-01T00:00:00.000Z',
        publishedAt: '2026-09-02T00:00:00.000Z',
        retiredAt: '2026-09-03T00:00:00.000Z',
      },
    });
  });

  it('rejects invalid and time-travelling transitions', () => {
    expect(transitionVocabularyVersion(
      { status: 'draft', version: '1', createdAt: '2026-09-02T00:00:00Z' },
      { type: 'retire', at: '2026-09-03T00:00:00Z' },
    )).toEqual({ ok: false, reason: 'invalid_transition' });

    expect(transitionVocabularyVersion(
      { status: 'draft', version: '1', createdAt: '2026-09-02T00:00:00Z' },
      { type: 'publish', at: '2026-09-01T00:00:00Z' },
    )).toEqual({ ok: false, reason: 'timestamp_before_previous_event' });

    expect(transitionVocabularyVersion(
      { status: 'draft', version: '1', createdAt: 'not-a-date' },
      { type: 'publish', at: '2026-09-01T00:00:00Z' },
    )).toEqual({ ok: false, reason: 'invalid_timestamp' });
  });
});
