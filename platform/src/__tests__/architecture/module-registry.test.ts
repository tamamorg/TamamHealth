/**
 * @jest-environment node
 *
 * Module registry and lint-boundary coverage.
 *
 * Two failure modes this guards, both silent:
 *
 *   1. A directory under src/modules that is not in MIGRATED_MODULES is not
 *      boundary-checked at all.
 *   2. Flat config REPLACES rule options when several blocks match a file.
 *      The boundary rule was once emitted as one block per module, all
 *      matching the same files, so only the last module was enforced outside
 *      src/app. The check below asks ESLint itself what it would apply.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const MODULES_DIR = path.join(ROOT, 'src/modules');
const ESLINT_CONFIG = path.join(ROOT, 'eslint.config.mjs');

/** Directories under src/modules deliberately not in MIGRATED_MODULES. Add with a reason. */
const UNREGISTERED_MODULE_DIRS: Record<string, string> = {};

function migratedModules(): string[] {
  const src = fs.readFileSync(ESLINT_CONFIG, 'utf8');
  const m = src.match(/const MIGRATED_MODULES = \[([^\]]*)\]/);
  if (!m) throw new Error('MIGRATED_MODULES not found in eslint.config.mjs');
  return [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1]);
}

type Pattern = { group: string[] };

/** Ask ESLint what no-restricted-imports it applies to `file`. */
function restrictedGroups(file: string): string[][] {
  const script = `
    const { ESLint } = require('eslint');
    new ESLint({ cwd: process.cwd() }).calculateConfigForFile(process.argv[1]).then(c => {
      const r = c.rules['no-restricted-imports'];
      process.stdout.write(JSON.stringify(r || null));
    });`;
  const out = execFileSync(process.execPath, ['-e', script, file], { cwd: ROOT, encoding: 'utf8' });
  const rule = JSON.parse(out) as [string, { patterns?: Pattern[] }?] | null;
  return (rule?.[1]?.patterns ?? []).map(p => p.group);
}

describe('module registry', () => {
  it('src/modules directories equal MIGRATED_MODULES (plus named exceptions)', () => {
    const onDisk = fs.readdirSync(MODULES_DIR).filter(d => fs.statSync(path.join(MODULES_DIR, d)).isDirectory()).sort();
    const registered = [...migratedModules(), ...Object.keys(UNREGISTERED_MODULE_DIRS)].sort();
    expect(registered).toEqual(onDisk);
  });

  it('every migrated module has a CODEOWNERS line', () => {
    const co = fs.readFileSync(path.join(ROOT, '..', '.github/CODEOWNERS'), 'utf8');
    const missing = migratedModules().filter(m => !co.includes(`/platform/src/modules/${m}/`));
    expect(missing).toEqual([]);
  });
});

describe('module boundary lint config (as ESLint resolves it)', () => {
  jest.setTimeout(60_000);

  it.each(['src/lib/context.tsx', 'src/components/Placeholder.tsx'])(
    '%s is restricted from the private paths of every migrated module',
    file => {
      const groups = restrictedGroups(path.join(ROOT, file));
      const covered = new Set(groups.flat());
      const missing = migratedModules().filter(m => !covered.has(`@/modules/${m}/core/*`) && !covered.has(`@/modules/${m}/policy/*`));
      expect(missing).toEqual([]);
      // Every module contributes private paths, not just one.
      for (const m of migratedModules()) {
        expect(covered.has(`@/modules/${m}/components/*`)).toBe(true);
      }
    },
  );

  it('a module file may import its own internals but is restricted from the others', () => {
    const modules = migratedModules();
    const own = 'identity';
    const covered = new Set(restrictedGroups(path.join(ROOT, `src/modules/${own}/client.ts`)).flat());
    expect(covered.has(`@/modules/${own}/core/*`)).toBe(false);
    for (const m of modules.filter(x => x !== own)) {
      expect(covered.has(`@/modules/${m}/core/*`)).toBe(true);
    }
  });
});
