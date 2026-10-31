// Pre-commit checks, scoped to the packages a commit actually touches.
//
// Two-part design, and the asymmetry is deliberate:
//
//   eslint --fix  runs on the STAGED FILES ONLY. Fast, and auto-fixable
//                 problems get repaired in place.
//
//   tsc --noEmit  runs on the WHOLE affected package, not the staged files.
//                 TypeScript cannot type-check files in isolation here — the
//                 packages use path aliases (`@/lib/...`), JSX settings and
//                 ambient types that only resolve through their tsconfig.
//                 Passing individual filenames to tsc makes it ignore the
//                 tsconfig entirely and emit bogus errors. One project-wide
//                 check per touched package is the correct trade.
//
// Both go through scripts/lint-staged-runner.mjs, which sets the CWD to the
// package — ESLint 9 resolves its flat config from the CWD, so running it from
// the repo root fails outright. See that file for the full explanation.
//
// Net effect: touching one file in platform/ checks platform/ only;
// website/ is untouched. Emergency escape hatch: `git commit --no-verify`.

const PACKAGES = ['platform', 'website'];

const RUNNER = 'node scripts/lint-staged-runner.mjs';

const config = {};

for (const pkg of PACKAGES) {
  config[`${pkg}/**/*.{ts,tsx,js,jsx,mjs,cjs}`] = (files) => [
    `${RUNNER} --pkg ${pkg} --eslint ${files.map((f) => JSON.stringify(f)).join(' ')}`,
    `${RUNNER} --pkg ${pkg} --tsc`,
  ];
}

// Shell scripts anywhere in the repo get a syntax check — cheap, and these are
// the deploy/backup scripts where a typo is expensive.
config['**/*.sh'] = (files) => files.map((f) => `bash -n ${JSON.stringify(f)}`);

// Workflow and compose files must stay parseable.
config['{.github/workflows/*.yml,docker-compose*.yml}'] = (files) =>
  files.map(
    (f) => `python3 -c "import yaml,sys;yaml.safe_load(open(sys.argv[1]))" ${JSON.stringify(f)}`,
  );

export default config;
