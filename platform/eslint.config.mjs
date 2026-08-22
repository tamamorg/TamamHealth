// Next.js 16 removed the `next lint` command and eslint 9 uses flat config.
// eslint-config-next@16 ships native flat-config arrays, so we spread them
// directly instead of going through @eslint/eslintrc/FlatCompat — that legacy
// compat layer pulls old ajv/minimatch that this repo's package.json
// `overrides` force-upgrade, which crashes it. The eslint core binary itself
// still needs ajv 6 (pinned via the scoped override in package.json).
import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';
import reactHooks from 'eslint-plugin-react-hooks';

/**
 * Domain modules that have migrated to `src/modules/` — see
 * docs/adr/0003-domain-modules.md.
 *
 * Listed explicitly rather than globbed, and that is deliberate: the migration
 * runs one domain per commit, so a half-migrated tree is the normal state for
 * a while. Globbing `src/modules/*` would make the rules apply to code that
 * has not moved yet and turn every intermediate commit into a wall of errors.
 * Adding a name here is the last step of migrating that domain.
 */
const MIGRATED_MODULES = ['identity'];

/**
 * The directories inside a module that are private.
 *
 * Listed rather than expressed as "everything except the public entrypoints".
 * A negated glob (`!(client|services)`) reads more cleverly and silently
 * matched nothing here — minimatch's extglob binds to a single path segment,
 * so `@/modules/identity/core/auth` slipped straight through a rule that
 * looked correct. An explicit list cannot fail that way, and it doubles as
 * documentation of what a module keeps to itself.
 */
const PRIVATE_MODULE_DIRS = ['core', 'policy', 'mfa', 'provisioning', 'email', 'components', 'hooks'];

/** Every deep path that is off-limits from outside a module. */
function privatePaths(name) {
  return PRIVATE_MODULE_DIRS.flatMap(dir => [
    `@/modules/${name}/${dir}`,
    `@/modules/${name}/${dir}/*`,
    `@/modules/${name}/${dir}/**`,
  ]);
}

/**
 * The boundary rules, as ESLint path restrictions.
 *
 * Errors, not warnings. This repo carries 449 warnings, which is the empirical
 * case for the distinction: a rule nobody has to act on is a rule that records
 * violations rather than preventing them.
 *
 * No new dependency. A graph tool (dependency-cruiser, madge) would express
 * this more elegantly, but the flat-config comment above documents why this
 * repo's ajv/minimatch overrides make new eslint-adjacent dependencies a
 * resolution hazard — and `no-restricted-imports` already says everything the
 * three rules in the ADR need to say.
 */
function moduleBoundaryRules() {
  return [
    // ── Rule 1: a module's internals are private. ───────────────────────
    //
    // A module has exactly three public entrypoints:
    //
    //   @/modules/<name>              the server surface (guards, policy, types)
    //   @/modules/<name>/client       the browser-safe surface
    //   @/modules/<name>/services/*   one service at a time
    //
    // The third tier is not a compromise, it is a bundling decision with a
    // measured reason: services reach the database, and re-exporting them from
    // the barrel made every route that wanted `getAuthPayload` eagerly load
    // PouchDB at module-init. Naming the service keeps `await import()` doing
    // what it was written to do. See the note in the module's index.ts.
    //
    // `core/`, `policy/`, `mfa/`, `provisioning/`, `email/`, `components/` and
    // `hooks/` are private. The `ignores` entry is what lets a module import
    // its own internals by deep path.
    //
    // Note this governs the STATIC graph. `no-restricted-imports` does not see
    // `await import()`, and that is the right place to draw the line: a lazy
    // import names a file deliberately, and the alternative — routing every
    // lazy load through a barrel — is the eager-loading bug above.
    ...MIGRATED_MODULES.map(name => ({
      files: [`src/**/*.{ts,tsx}`],
      ignores: [`src/modules/${name}/**`],
      rules: {
        'no-restricted-imports': ['error', {
          patterns: [{
            group: privatePaths(name),
            message:
              `Import from '@/modules/${name}', '@/modules/${name}/client', or a named service `
              + `('@/modules/${name}/services/<name>'). A module's internals are private — reaching `
              + 'past them is how the previous layout ended up with no boundaries at all '
              + '(docs/adr/0003-domain-modules.md).',
          }],
        }],
      },
    })),

    // ── Rule 2: shared/ is the bottom of the graph. ─────────────────────
    {
      files: ['src/shared/**/*.{ts,tsx}'],
      rules: {
        'no-restricted-imports': ['error', {
          patterns: [{
            group: ['@/modules/*', '@/modules/*/**'],
            message:
              'src/shared/ must not depend on a domain module. If this needs domain knowledge '
              + 'it is not shared — move it into the module that owns the rule.',
          }],
        }],
      },
    },

    // ── Rule 3: the app/ tree routes, it does not implement. ────────────
    // Route files re-export from a module (see the ADR on why they cannot
    // simply move). Reaching into a module's internals from a route would
    // reintroduce exactly the coupling this removes.
    {
      files: ['src/app/**/*.{ts,tsx}'],
      rules: {
        'no-restricted-imports': ['error', {
          patterns: MIGRATED_MODULES.map(name => ({
            group: privatePaths(name),
            message:
              `Route files reach '@/modules/${name}', its /client surface, or a named service. `
              + 'Everything else in the module is private.',
          })),
        }],
      },
    },
  ];
}

const eslintConfig = [
  { ignores: ['.next/**', 'node_modules/**', 'coverage/**', 'out/**', 'next-env.d.ts', 'public/sw.js', 'scripts/**'] },
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    // Accessibility: three rules, not the whole recommended set.
    //
    // The codebase is already in good shape here — 1,320 real <button>
    // elements against 1,674 click handlers says the default was to reach for
    // the right element. The full preset would produce hundreds of warnings
    // nobody triages; three rules keep the first run actionable, and they
    // found two real ARIA bugs a grep could not see (aria-haspopup on a native
    // <select>, aria-expanded on a plain <input>).
    //
    // Warnings rather than errors so this lands without gating CI, matching
    // how the react-hooks compiler rules below were adopted.
    //
    // No `plugins` key: eslint-config-next/core-web-vitals already registers
    // jsx-a11y, and flat config rejects a second registration outright
    // ("Cannot redefine plugin"). Rules only.
    rules: {
      'jsx-a11y/click-events-have-key-events': 'warn',
      'jsx-a11y/no-static-element-interactions': 'warn',
      'jsx-a11y/alt-text': 'warn',
    },
  },
  {
    // An underscore prefix means "deliberately unused".
    //
    // The pattern this repo actually relies on is destructuring-to-omit —
    // `const { passwordHash: _passwordHash, ...safe } = user` is how a
    // credential is stripped before a document crosses an API boundary. The
    // binding exists precisely so the field does NOT end up in `safe`; being
    // unused is the whole point. Without this option the only way to quiet the
    // rule was a trailing `void _passwordHash;`, and `redactUserForClient`
    // showed why that is worse than useless: it had the `void` for two of its
    // three omitted credentials and not the third, so the one line that
    // mattered most looked like an oversight rather than a decision.
    //
    // `ignoreRestSiblings` covers the omit pattern even unprefixed; the `^_`
    // patterns cover the rest (unused props like `flat: _flat`, fetch-mock
    // signatures that must accept `(_url, _init)` to match the real one).
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', {
        args: 'after-used',
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
        destructuredArrayIgnorePattern: '^_',
        ignoreRestSiblings: true,
      }],
    },
  },
  {
    // react-hooks@7 (pulled in by eslint-config-next@16) enables the new
    // "React Compiler" rule family — a much stricter opinion set the existing
    // code was never written against (~220 hits). Surface them as warnings so
    // they're visible and can be adopted incrementally, without turning a
    // linter-version bump into a red CI gate. The long-standing correctness
    // rules (unused vars, exhaustive-deps, no-explicit-any, etc.) stay errors.
    // Flat config requires the plugin be registered in the same object that
    // overrides its rules.
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/static-components': 'warn',
      'react-hooks/immutability': 'warn',
      'react-hooks/purity': 'warn',
      'react-hooks/preserve-manual-memoization': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/set-state-in-render': 'warn',
      'react-hooks/globals': 'warn',
      'react-hooks/error-boundaries': 'warn',
    },
  },
  {
    // Test infra legitimately needs `any` (mocks/polyfills) and the occasional
    // ts-suppression (jsdom global shims). Keep product code strict; relax only
    // here.
    files: ['**/*.test.ts', '**/*.test.tsx', 'src/__tests__/**', 'jest.setup.ts', 'jest.config.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/ban-ts-comment': 'off',
      // `jest.mock()` factories are hoisted above the imports, so they cannot
      // close over one — `require()` inside the factory is the only way to
      // reach a helper, and it is what every mock in this suite already does.
      // The rule fired on .tsx tests only, which made the same line legal in
      // an integration test and an error in a component test.
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  ...moduleBoundaryRules(),
  {
    // LAST, deliberately. Flat config resolves by order, and the boundary
    // rules above match `src/**` — including tests. A test may reach into the
    // module it is testing: boundaries exist to stop production code coupling,
    // not to stop a unit test naming its unit. Put this block before
    // `moduleBoundaryRules()` and it silently does nothing, which is how it
    // was written the first time.
    files: ['**/*.test.ts', '**/*.test.tsx', 'src/__tests__/**', 'jest.setup.ts', 'jest.config.ts'],
    rules: { 'no-restricted-imports': 'off' },
  },
];

export default eslintConfig;
