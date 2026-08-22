// Next.js 16 removed the `next lint` command and eslint 9 uses flat config.
// eslint-config-next@16 ships native flat-config arrays, so we spread them
// directly instead of going through @eslint/eslintrc/FlatCompat — that legacy
// compat layer pulls old ajv/minimatch that this repo's package.json
// `overrides` force-upgrade, which crashes it. The eslint core binary itself
// still needs ajv 6 (pinned via the scoped override in package.json).
import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';
import reactHooks from 'eslint-plugin-react-hooks';

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
];

export default eslintConfig;
