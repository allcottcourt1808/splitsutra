/**
 * Architecture boundary enforcement — phase-01 §4, docs/16-testing-setup.md §8.
 *
 * "This is the item that saves Phase 12." These five rules are the mechanical form of the
 * Constitution; without them the boundaries are just prose that rots.
 *
 *   1. core-is-platform-agnostic  — Article II  (packages/core is platform-agnostic) + NFR-10
 *   2. screens-never-touch-firestore — Article VIII (screens never touch Firestore)
 *   3. domain-is-pure             — Article VII (domain logic is pure) + Article VI
 *   4. firebaseui-only-in-web-auth — FirebaseUI renders /login; ONLY FirebaseUIMount.tsx may
 *                                    import it, or firebase/compat
 *   5. no-react-firebaseui        — the abandoned React wrapper stays out entirely
 *
 * All five are severity `error`, so `pnpm depcruise` — and therefore `pnpm verify` and CI —
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
      name: 'firebaseui-only-in-web-auth',
      comment:
        'FirebaseUI is BACK, and confined to one file. It renders /login (sign-in AND sign-up), ' +
        'which is what it is good at — but it predates the modular SDK: its ESM build imports ' +
        'firebase/compat/app and firebase/compat/auth, and firebaseui@6.1.0 (published Aug 2023, ' +
        'nothing since) declares peer firebase ^9.1.3 || ^10.0.0 against this project’s ' +
        'firebase 12. That is an unmet peer which works only because firebase 12 still ships the ' +
        'compat layer. Verified end to end against the emulator; the bridge and its cost are ' +
        'documented in apps/web/src/auth/FirebaseUIMount.tsx. Confining it is the entire point ' +
        'of this rule: a future firebase major that drops firebase/compat breaks that ONE file, ' +
        'and Phase 12 — React Native, where FirebaseUI does not port (docs/02) — deletes it ' +
        'rather than untangling it. ' +
        '⚠️ PROVEN HALFWAY, and the half that is proven is the one that matters. A probe file ' +
        'importing firebase/compat/app from outside the carve-out goes red as intended. A probe ' +
        'importing "firebaseui" does NOT: dependency-cruiser does not resolve that specifier ' +
        'under enhancedResolveOptions below (firebaseui ships no "exports" field), so it never ' +
        'appears as a dependency and that half of the pattern is currently inert. It is left in ' +
        'the pattern because it costs nothing and starts working the day resolution does — and ' +
        'because firebase/compat is the real coupling: firebaseui cannot be imported without ' +
        'dragging compat in behind it, which IS caught.',
      severity: 'error',
      from: { pathNot: '^apps/web/src/auth/FirebaseUIMount[.]tsx$' },
      to: {
        path: '(^|/)node_modules/(firebaseui(/|$)|firebase/compat)',
      },
    },

    {
      name: 'no-react-firebaseui',
      comment:
        'react-firebaseui is abandoned, declares React 16 peers, and breaks under React 18/19 ' +
        'StrictMode (checklists/phase-03-auth.md §2). The vanilla widget is mounted by hand in ' +
        'FirebaseUIMount.tsx instead, which is why that file carries the getInstance/reset ' +
        'dance the wrapper got wrong.',
      severity: 'error',
      from: {},
      to: {
        path: '(^|/)node_modules/react-firebaseui(/|$)',
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
