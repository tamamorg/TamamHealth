/** @jest-environment node */
/**
 * Nothing in the tree should be unreachable.
 *
 * Commit `f02a21b3` removed 36 dead source files and 4,570 lines. It missed
 * eight, because it removed the *consumers* and the files themselves were
 * only reachable through them — `order-set-service`, `clinical-guidelines`,
 * `consultation-progress-derive`, `DirectiveList`, `StaffPhotoField`,
 * `useDisabledApps`, and the `useSidebarBadges` hook whose `badgeKey` field
 * stayed on four nav items producing no badge. A hand-audit finds the file it
 * was looking for and stops; this walks the graph.
 *
 * Two traps this had to survive, both of which produced false positives on the
 * first attempt:
 *
 *   - Import specifiers use BOTH quote styles. Matching only `from '…'` marked
 *     `TextareaAutoResize` dead while `layout.tsx` renders it, imported with
 *     double quotes.
 *   - Locales load via a template literal — `import(\`./locales/${locale}\`)` —
 *     so `apd.ts` (5,894 lines, the Juba Arabic translation) resolves to no
 *     static specifier and looks like the largest dead file in the repo.
 *
 * Deleting either would have been a bad day, which is why the allowlist below
 * is explicit about why each entry is there rather than being a list of paths.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const SRC = path.join(process.cwd(), 'src');

function allFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) allFiles(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

const FILES = new Map(allFiles(SRC).map(f => [f, readFileSync(f, 'utf8')]));

/** Resolve a module specifier the way the bundler would. */
function resolve(spec: string, from: string): string | null {
  let base: string;
  if (spec.startsWith('@/')) base = path.join(SRC, spec.slice(2));
  else if (spec.startsWith('.')) base = path.resolve(path.dirname(from), spec);
  else return null;
  for (const candidate of [`${base}.ts`, `${base}.tsx`,
                           path.join(base, 'index.ts'), path.join(base, 'index.tsx')]) {
    if (FILES.has(candidate)) return candidate;
  }
  return null;
}

/** Static imports, dynamic imports and re-exports, in either quote style. */
const SPECIFIER = /(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g;

const imported = new Set<string>();
for (const [file, source] of FILES) {
  for (const [, spec] of source.matchAll(SPECIFIER)) {
    const target = resolve(spec, file);
    if (target) imported.add(target);
  }
}

/** Files the framework loads by convention, with no import anywhere. */
const FRAMEWORK_ENTRIES = new Set([
  'page.tsx', 'layout.tsx', 'route.ts', 'loading.tsx', 'error.tsx', 'not-found.tsx',
  'template.tsx', 'global-error.tsx', 'proxy.ts', 'instrumentation.ts',
  'instrumentation-client.ts', 'sitemap.ts', 'robots.ts', 'manifest.ts',
]);

/** Reachable, but not by a specifier this scanner can resolve. */
const REACHED_DYNAMICALLY = new Map([
  ['lib/i18n/locales/apd.ts', 'loaded by `import(`./locales/${locale}`)` in lib/i18n/index.ts'],
]);

/** Unused convenience barrels over live modules. Not dead features. */
const UNUSED_BARRELS = new Map([
  ['components/lab/order/index.ts', 're-exports the live lab-order modules'],
  ['lib/clinical-flow/index.ts', 're-exports the live clinical-flow spec layer, and documents it'],
]);

function isEntry(file: string): boolean {
  const base = path.basename(file);
  return FRAMEWORK_ENTRIES.has(base)
    || file.includes(`${path.sep}__tests__${path.sep}`)
    || base.endsWith('.d.ts')
    || base.includes('.test.');
}

describe('every file is reachable', () => {
  const orphans = [...FILES.keys()]
    .filter(f => !imported.has(f) && !isEntry(f))
    .map(f => path.relative(SRC, f))
    .filter(rel => !REACHED_DYNAMICALLY.has(rel) && !UNUSED_BARRELS.has(rel))
    .sort();

  it('finds no unreachable source file', () => {
    // A failure here is usually a feature whose last consumer was removed.
    // Delete the file, or add it to an allowlist above with the reason.
    expect(orphans).toEqual([]);
  });

  it('still resolves a healthy majority of the tree, so the scan is real', () => {
    // If `resolve` broke, everything would look dead and the assertion above
    // would fail loudly — but if the SPECIFIER regex broke the other way,
    // nothing would look dead and this suite would pass vacuously.
    expect(imported.size).toBeGreaterThan(FILES.size * 0.5);
  });
});

describe('the allowlists stay honest', () => {
  it('keeps every dynamically-reached file present', () => {
    for (const rel of REACHED_DYNAMICALLY.keys()) {
      expect(FILES.has(path.join(SRC, rel))).toBe(true);
    }
  });

  it('keeps every allowlisted barrel genuinely unimported', () => {
    // If something starts importing a barrel it stops being an exception, and
    // the entry should go rather than sit there implying a rule that no longer
    // applies.
    for (const rel of UNUSED_BARRELS.keys()) {
      const full = path.join(SRC, rel);
      if (!FILES.has(full)) continue;
      expect(imported.has(full)).toBe(false);
    }
  });
});
