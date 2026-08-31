// Shared ESLint flat config for the whole workspace (phase-01 §2).
//
// Deliberately minimal. The rules that actually protect this codebase live elsewhere:
//   * architecture boundaries  -> .dependency-cruiser.cjs   (Articles II, VII, VIII)
//   * type safety              -> tsconfig.base.json strict (Article I)
//   * formatting               -> prettier
// ESLint is here to catch the things neither of those can see.

import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',

      // firebase/functions compiles to lib/ (its tsconfig outDir). Anchored to that one
      // path on purpose: a bare `**/lib/**` also matches firebase/functions/src/lib/, the
      // real source directory holding identity.ts and friends — which is precisely the
      // mistake an unanchored `lib/` already made in .gitignore, where it silently kept
      // those files out of the repo entirely.
      'firebase/functions/lib/**',
      '**/coverage/**',
      '**/playwright-report/**',
      '**/test-results/**',
      '**/blob-report/**',
      '.emulator-data/**',
      '.firebase/**',
      '**/*.tsbuildinfo',
    ],
  },

  js.configs.recommended,
  tseslint.configs.recommended,

  {
    rules: {
      // Unused args are fine when they document a signature, as long as they are
      // prefixed with an underscore.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      // verbatimModuleSyntax means the `type` keyword is load-bearing, not decoration.
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
    },
  },

  // ── React hooks — apps only. `packages/core` may use `react`, so it is included. ──
  {
    files: ['apps/**/*.{ts,tsx}', 'packages/core/src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },

  // ── Article I: money is never a float. ────────────────────────────────────────
  // The domain layer is the one place that must never see a floating-point currency
  // value. `parseFloat` there is the exact bug that makes a group unable to settle up.
  {
    files: ['packages/core/src/domain/**/*.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        {
          name: 'parseFloat',
          message:
            'Article I: money is never a float. Parse to integer minor units (MinorUnits) instead.',
        },
      ],
      'no-restricted-properties': [
        'error',
        {
          object: 'Number',
          property: 'parseFloat',
          message:
            'Article I: money is never a float. Parse to integer minor units (MinorUnits) instead.',
        },
        {
          object: 'Math',
          property: 'random',
          message: 'Article VII: domain logic is pure. Seed randomness from stored data.',
        },
      ],
    },
  },

  // ── Config files at the repo root run in Node, not the browser. ───────────────
  // Flat config does not hand out Node globals for free, and `js.configs.recommended`
  // leaves `no-undef` on for plain .js/.cjs — so CommonJS config files (notably
  // .dependency-cruiser.cjs) need the handful of globals they actually use declared.
  {
    files: ['**/*.cjs'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: {
        module: 'writable',
        exports: 'writable',
        require: 'readonly',
        process: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        console: 'readonly',
      },
    },
  },
  {
    files: ['*.{js,cjs,mjs,ts}', '.*.{js,cjs,mjs}'],
    rules: {
      'no-console': 'off',
    },
  },

  // ── Repo tooling under scripts/ runs in Node, as ESM. ─────────────────────────
  // Neither block above covers it. The .cjs block pins sourceType: "commonjs", which is
  // wrong for an .mjs module, and the no-console exemption matches only root-level files
  // (`*.{js,cjs,mjs,ts}`), not a subdirectory — so a Node script in scripts/ fails both
  // `no-undef` on process/console and `no-console`, which is how CI broke once already.
  {
    // `**/scripts/**`, not `scripts/**`: a workspace has build tooling of its own
    // (`apps/web/scripts/make-icons.mjs`), and the anchored pattern missed it in exactly the
    // way described above — the same CI break, one directory deeper.
    files: ['**/scripts/**/*.{js,mjs}'],
    languageOptions: {
      sourceType: 'module',
      globals: {
        process: 'readonly',
        console: 'readonly',
        // Resolving a path relative to the script itself needs `new URL(..., import.meta.url)`,
        // which is the only portable way to do it in an ESM file that may be spawned from any cwd.
        URL: 'readonly',
        // Node's Buffer — binary output (a PNG encoder) has no portable alternative.
        Buffer: 'readonly',
      },
    },
    rules: {
      // Printing is the entire point of a CLI script.
      'no-console': 'off',
    },
  },

  // ── Tests may reach for the things production code may not. ───────────────────
  {
    files: [
      '**/__tests__/**/*.{ts,tsx}',
      '**/*.test.{ts,tsx}',
      '**/*.spec.{ts,tsx}',
      'e2e/**/*.ts',
      'firebase/tests/**/*.ts',
    ],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      'no-console': 'off',
    },
  },
);
