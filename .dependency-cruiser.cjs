/**
 * Architecture boundary enforcement — phase-01 §4, docs/16-testing-setup.md §8.
 *
 * "This is the item that saves Phase 12." These four rules are the mechanical form of the
 * Constitution; without them the boundaries are just prose that rots.
 *
 *   1. core-is-platform-agnostic  — Article II  (packages/core is platform-agnostic) + NFR-10
 *   2. screens-never-touch-firestore — Article VIII (screens never touch Firestore)
 *   3. domain-is-pure             — Article VII (domain logic is pure) + Article VI
 *   4. no-firebaseui-or-compat    — Q17/R7: FirebaseUI dropped; nothing imports it or firebase/compat
 *
 * All four are severity `error`, so `pnpm depcruise` — and therefore `pnpm verify` and CI —
 * fail on a violation.
 *
 * 🔴 PROVE EACH ONE FAILS. Write a deliberately-violating file, watch it go red, delete it.
 *    An unverified guard rail is not a guard rail. (phase-01 §4, phase-02b §9)
 *
 * ── On the `to.path` patterns ────────────────────────────────────────────────────────────
 * dependency-cruiser matches `to.path` against the *resolved* module path, not the import
 * specifier. An npm package therefore appears as `node_modules/<pkg>/...` — and under pnpm
 * it can appear nested, e.g. `node_modules/.pnpm/react@19.../node_modules/react/index.js`.
 * Hence the `(^|/)node_modules/` prefix and the `(/|$)` suffix (which is what stops the
 * bare `react` pattern from also matching `react-dom`). Workspace-internal violations —
 * core importing an app — match on the plain repo-relative path instead.
 */

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'core-is-platform-agnostic',
      comment:
        'Article II + NFR-10: packages/core must not depend on react-dom, react-native, or ' +
        'anything in apps/*. This single boundary is the entire reason the mobile app is a ' +
        'port and not a rewrite. Platform capabilities arrive through the injected ' +
        'PlatformAdapter, never through a direct import.',
      severity: 'error',
      from: { path: '^packages/core' },
      to: {
        path: '(^|/)node_modules/(react-dom|react-native)(/|$)|^apps/',
      },
    },

    {
      name: 'screens-never-touch-firestore',
      comment:
        'Article VIII: all data access goes through core/src/repositories. A screen ' +
        'importing the Firebase SDK directly means logic escaped the portable layer and ' +
        'will not port to React Native.',
      severity: 'error',
      from: { path: '^apps/web/src/screens' },
      to: {
        path: '(^|/)node_modules/(firebase|@firebase)(/|$)',
      },
    },

    {
      name: 'domain-is-pure',
      comment:
        'Article VII: everything in core/src/domain is a pure function — no I/O, no ' +
        'Firebase, no React, no clock. Purity is what makes 100% branch coverage and ' +
        'property-based testing achievable on the part of the system that must be perfect.',
      severity: 'error',
      from: { path: '^packages/core/src/domain' },
      to: {
        path: '(^|/)node_modules/(firebase|@firebase|react)(/|$)',
      },
    },

    {
      name: 'no-firebaseui-or-compat',
      comment:
        'Q17/R7: FirebaseUI was DROPPED. firebaseui@6.1.0 supports Firebase SDK 9-10 only — ' +
        'pnpm reported it as an unmet peer against SDK 11 — and docs/02-architecture.md notes it ' +
        'is web-only and does not port to React Native, so Phase 12 needed custom auth screens ' +
        'either way. Auth uses the MODULAR firebase/auth SDK. This was a carve-out permitting ' +
        'apps/web/src/auth/**; it is now a BLANKET BAN, a strictly stronger guarantee — ' +
        'firebase/compat must not re-enter the tree through any path.',
      severity: 'error',
      from: {},
      to: {
        path: '(^|/)node_modules/(firebaseui(/|$)|firebase/compat)',
      },
    },
  ],

  options: {
    doNotFollow: {
      path: 'node_modules',
    },

    exclude: {
      path: '(^|/)(dist|coverage|playwright-report|test-results|\\.emulator-data|\\.firebase)(/|$)',
    },

    /**
     * Follow type-only imports too. Under `verbatimModuleSyntax` an `import type` is still a
     * real coupling to a platform-specific package — a core file that imports React DOM types
     * has still made an assumption the mobile port cannot honour.
     */
    tsPreCompilationDeps: true,

    moduleSystems: ['es6', 'cjs'],

    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'types', 'default'],
      mainFields: ['module', 'main', 'types', 'typings'],
    },

    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
};
