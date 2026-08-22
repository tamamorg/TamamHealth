/** @jest-environment node */
/**
 * Features that were removed stay removed.
 *
 * Deleting a feature is rarely one commit. The screen goes first, then the
 * service, and what survives is the quiet residue: a type nobody constructs, a
 * feature flag every organisation still carries, a translation key in two
 * locales, a sentence in the terms of service promising a capability that no
 * longer exists.
 *
 * The AI clinical-decision-support feature left exactly that trail — 8
 * translation keys across two locales, an `aiClinicalSupport` flag threaded
 * through the organisation document, its admin toggle, its settings panel, both
 * seeds and the create-organisation API, two exported types nothing referenced,
 * an `aiEvaluation` field that field-level encryption still had special
 * handling for, and 915 lines of scribe service and hook that nothing rendered.
 *
 * This suite is cheap to extend when the next feature is retired, and it is the
 * difference between "deleted" and "deleted everywhere".
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const SRC = path.join(process.cwd(), 'src');

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry !== '__tests__' && entry !== 'node_modules') sourceFiles(full, out);
    } else if (/\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

const FILES = sourceFiles(SRC);
const read = (f: string) => readFileSync(f, 'utf8');

/** Identifiers that must not reappear anywhere in the product source. */
const REMOVED_AI_SYMBOLS = [
  'aiClinicalSupport',
  'AIDiagnosisSuggestion',
  'AIEvaluation',
  'aiEvaluation',
  'clinical-scribe-service',
  'useClinicalScribe',
];

describe('the AI feature is gone from the source', () => {
  it.each(REMOVED_AI_SYMBOLS)('no file references %s', symbol => {
    const offenders = FILES.filter(f => read(f).includes(symbol)).map(f => path.relative(SRC, f));
    expect(offenders).toEqual([]);
  });

  it('leaves no orphaned translation keys behind', () => {
    // A key with no reader is invisible until somebody translating the app asks
    // what "AI Scribe" is and nobody can find the screen.
    const removedKeys = [
      'orgAdmin.featureAiClinicalSupport', 'orgSettings.flagAiClinicalSupport',
      'orgSettings.flagAiClinicalSupportDesc', 'boma.aiDiagnosis', 'boma.aiDisclaimer',
      'boma.aiSuggestedConditions', 'consultation.aiEmptyState',
      'consultation.sectionAiEvaluation', 'boma.aiSymptomChecker',
      'consultation.aiReasoningSummary', 'consultation.aiRunsLocally', 'consultation.aiScribe',
    ];
    for (const locale of ['en', 'apd']) {
      const src = readFileSync(path.join(SRC, 'lib/i18n/locales', `${locale}.ts`), 'utf8');
      for (const key of removedKeys) expect(src).not.toContain(`'${key}'`);
    }
  });

  it('does not promise AI in the terms of service', () => {
    // The terms told users the platform had AI-assisted features and that data
    // could pass to an AI provider. Both were true once and are not now, and a
    // legal document is the wrong place to be out of date.
    const terms = readFileSync(path.join(SRC, 'app/terms/page.tsx'), 'utf8');
    expect(terms).not.toMatch(/\bAI\b/);
  });
});

describe('the organisation feature-flag set matches what exists', () => {
  it('carries no flag for a removed feature', () => {
    // Every organisation document persists this object, so a stale flag
    // outlives the code by as long as the data does.
    const dbTypes = readFileSync(path.join(SRC, 'lib/db-types.ts'), 'utf8');
    const block = /featureFlags: \{([^}]*)\}/.exec(dbTypes)?.[1] ?? '';
    expect(block).not.toMatch(/ai/i);
    // The block is still real, so a regex that silently matched nothing fails here.
    expect(block).toMatch(/epidemicIntelligence/);
  });
});
