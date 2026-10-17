/** @jest-environment node */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const SRC = path.join(process.cwd(), 'src');

/**
 * Read from eslint.config.mjs (the same parse module-registry.test.ts does)
 * rather than hand-copied: a hand list here froze at four modules while the
 * registry grew to thirteen, leaving nine migrated modules unguarded.
 */
function migratedModules(): Set<string> {
  const config = readFileSync(path.join(process.cwd(), 'eslint.config.mjs'), 'utf8');
  const m = config.match(/const MIGRATED_MODULES = \[([^\]]*)\]/);
  if (!m) throw new Error('MIGRATED_MODULES not found in eslint.config.mjs');
  return new Set([...m[1].matchAll(/'([^']+)'/g)].map(x => x[1]));
}
const MIGRATED_MODULES = migratedModules();
const OPTIONAL_SCOPE = /scope\?:\s*DataScope/g;
const LEGACY_BASELINE = 119;

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry !== '__tests__') sourceFiles(full, out);
    } else if (/\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

const optionalScopes = sourceFiles(SRC).flatMap(file => {
  const count = [...readFileSync(file, 'utf8').matchAll(OPTIONAL_SCOPE)].length;
  return Array.from({ length: count }, () => path.relative(SRC, file));
});

describe('DataScope is authority, not an optional convenience', () => {
  it('reads the migrated-module registry', () => {
    expect(MIGRATED_MODULES.size).toBeGreaterThanOrEqual(13);
    expect(MIGRATED_MODULES.has('identity')).toBe(true);
  });

  it('allows no optional scope in a migrated domain module', () => {
    const violations = optionalScopes.filter(relative => {
      const [top, moduleName] = relative.split(path.sep);
      return top === 'modules' && MIGRATED_MODULES.has(moduleName);
    });
    expect(violations).toEqual([]);
  });

  it('ratchets the legacy optional-scope backlog downward', () => {
    // Lower this number whenever a legacy domain is migrated. It intentionally
    // cannot increase: a new optional scope would recreate the ambient-authority
    // API this migration is removing.
    expect(optionalScopes.length).toBeLessThanOrEqual(LEGACY_BASELINE);
  });
});
