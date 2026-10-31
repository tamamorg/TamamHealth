#!/usr/bin/env node
// Runs eslint / tsc for one package with the CWD set to that package.
//
// Why this wrapper exists: each package (platform/, website/) has its
// own flat `eslint.config.*` and `tsconfig.json`. ESLint 9 resolves its flat
// config from the CURRENT WORKING DIRECTORY, not from the files it is given —
// so invoking it from the repo root fails with "couldn't find eslint.config"
// no matter how the paths are written. `npm --prefix <pkg> exec` does not help
// either: it changes which package's binaries are used, not the CWD.
//
// lint-staged runs commands without a shell, so `cd pkg && eslint …` is not an
// option. Hence: spawn the tools ourselves with an explicit `cwd`.
//
// Usage:
//   node scripts/lint-staged-runner.mjs --pkg platform --eslint <abs files...>
//   node scripts/lint-staged-runner.mjs --pkg platform --tsc

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { relative, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const argv = process.argv.slice(2);
const pkgIndex = argv.indexOf('--pkg');
if (pkgIndex === -1 || !argv[pkgIndex + 1]) {
  console.error('lint-staged-runner: --pkg <name> is required');
  process.exit(2);
}
const pkg = argv[pkgIndex + 1];
const pkgDir = resolve(REPO_ROOT, pkg);

const mode = argv.includes('--tsc') ? 'tsc' : 'eslint';
const files = argv.slice(argv.indexOf(mode === 'tsc' ? '--tsc' : '--eslint') + 1);

/** Major version of the package's own ESLint (0 if it cannot be read). */
function eslintMajor() {
  try {
    const pkgJson = resolve(pkgDir, 'node_modules/eslint/package.json');
    return Number(JSON.parse(readFileSync(pkgJson, 'utf8')).version.split('.')[0]);
  } catch {
    return 0;
  }
}

/** Run a package-local binary with CWD inside the package. */
function run(bin, args) {
  const result = spawnSync('npx', ['--no-install', bin, ...args], {
    cwd: pkgDir,
    stdio: 'inherit',
    encoding: 'utf8',
  });
  // spawnSync sets .error when the binary could not be launched at all.
  if (result.error) {
    console.error(`lint-staged-runner: failed to run ${bin} in ${pkg}:`, result.error.message);
    return 1;
  }
  return result.status ?? 1;
}

let status = 0;

if (mode === 'eslint') {
  if (files.length === 0) process.exit(0);
  // Paths must be relative to the package so ESLint's ignore rules apply.
  const rel = files.map((f) => relative(pkgDir, resolve(REPO_ROOT, f)));
  // `--no-warn-ignored` is flat-config only (ESLint 9+); older majors reject it.
  const ignoredFlag = eslintMajor() >= 9 ? ['--no-warn-ignored'] : [];
  status = run('eslint', ['--fix', ...ignoredFlag, ...rel]);
} else {
  // Whole-project type-check: TS cannot check these files in isolation
  // (path aliases, JSX, ambient types all come from the tsconfig).
  status = run('tsc', ['--noEmit']);
}

process.exit(status);
