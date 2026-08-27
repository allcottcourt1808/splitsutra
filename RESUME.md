# Resume here

**Last updated:** 2026-08-27, end of session. Project: **SplitSutra**.
Repo: <https://github.com/allcottcourt1808/splitsutra> (public).
Checkout: `C:\Users\neeth\coding\splitsutra`.

## State: everything merged, `main` is green

All five pull requests are merged. `main` now passes, verified after the merge:

| Gate                                                | Result |
| --------------------------------------------------- | ------ |
| `pnpm verify` (typecheck → lint → depcruise → unit) | ✅     |
| `pnpm build`                                        | ✅     |
| `pnpm format:check`                                 | ✅     |

Working tree is clean. Nothing is in flight and no branch is waiting on anything.

| PR  | Contents                                                                       |
| --- | ------------------------------------------------------------------------------ |
| #1  | constitution, 21 docs, 14 checklists                                           |
| #2  | pnpm workspace, tsconfig, lint, CI                                             |
| #3  | schemas, converters, split engine, balances                                    |
| #4  | Vite app, design system, nav shell, auth client, **entry point + route table** |
| #5  | rules, callables, triggers, emulator config, **functions entry point**         |

## 🔴 The blocker to fix first next session

**`packages/core` cannot be loaded by Node at runtime.** This is the most important
finding of the session and it is not visible to any current gate.

Running the emulator produces:

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find module
  .../packages/core/src/types/index.js
  imported from .../packages/core/src/index.ts
```

Why: core publishes **raw TypeScript** as its entry points (`"main": "./src/index.ts"`,
`noEmit: true`, no build step). Vite transpiles core, so the web app never notices. Cloud
Functions runs real Node, which cannot execute `.ts` — and the `.js` extensions the imports
carry point at files that are never emitted.

**Typecheck, lint, depcruise, unit tests and `pnpm build` all pass anyway.** Only actually
starting the emulator catches it. So the functions are exported and compile, and would still
fail on a real deploy.

**The fix:** give core a real build — `tsc` emitting `dist/` with `.js` + `.d.ts`, and point
`exports`/`main`/`types` at `dist`. The web app is unaffected, because `vite.config.ts` and
`apps/web/tsconfig.json` both alias `@splitsutra/core` to source. This makes `firebase/functions`
depend on core being built first, which the `predeploy` hook and CI need to reflect.

Do this before Phase 02. It is the difference between "functions deploy" and "functions
deploy and then fail on first invocation".

## Also still missing

1. **Zero tests.** `arbitraries.ts` is written; no `*.test.ts` exists anywhere. Article X
   violation, and the money math is fully written and completely unverified. `e2e/specs/`
   does not exist either, so `pnpm test:e2e` finds nothing.
2. **Screens.** Every route renders `PendingScreen`. The shell, tab bar and design system are
   real; the screens behind them are not. Delete `PendingScreen` when the last one lands.
3. **Four callables have schemas but no implementation** — `addFriend`, `deleteGroup`,
   `recomputeGroupBalances`, `deleteAccount`. Deliberately not stubbed: an exported stub is a
   live endpoint that silently does nothing.
4. **Seed script.** `pnpm seed` points at `firebase/seed.ts`, which does not exist. When
   written it must refuse to run against any project ID ending in `-prod`.
5. **Hosting serves nothing** until a build output exists in CI; `apps/web/dist` is local-only.

## ⚠️ The name is still unverified

**`SplitSutra` has never been clearance-checked.** The previous name reached the repo, the
docs and the config before anyone searched, and three live expense-splitting apps already
used it.

Renaming is still cheap: nothing is published to a store, no Firebase project ID is reserved,
and `scripts/rename-brand.sh <new> --display=NewName --go` does it in one command. It stops
being cheap at **Phase 02**, because Firebase project IDs are globally unique and permanent.

⚠️ `.firebaserc` points at `splitsutra-dev`, which is an **unreserved placeholder**. Always
pass `--project demo-splitsutra` to emulator commands so nothing resolves to it.

## Environment — ready, nothing to redo

Node 24.19.0 · pnpm 9.15.9 · Firebase CLI 15.28.1 · **JDK 21** (sufficient; emulators need
11+, and the JARs were verified running on it — a JDK 25 upgrade was declined and is not
needed) · gh authenticated · VS Code configured.

- **Playwright browsers installed** — Chromium only, which is all three projects use
  (`e2e-mobile`, `e2e-desktop`, `smoke` all resolve to chromium; no `channel` pinned).
  703 MB in `%LOCALAPPDATA%\ms-playwright`, plus ffmpeg, which the config needs for
  `video: 'retain-on-failure'`.
- **Emulator JARs cached** in `%USERPROFILE%\.cache\firebase\emulators\` — firestore v1.22.0,
  storage-rules v1.1.3, UI v1.15.0. All six declared emulators start and shut down cleanly.
  Both rules files parse with zero warnings.
- Gotcha: `emulators:exec` does **not** start the UI unless you pass `--ui`. It is a
  standalone flag, not an `--only` value.

## Dependency policy — latest, with two forced exceptions

- **Node stays 24** though 26 exists: Firebase's tooling caps Cloud Functions Gen 2 at
  `nodejs24`, so 26 is rejected at deploy.
- **TypeScript is 6.0.3, not 7.0.2**: `typescript-eslint@8` declares `typescript <6.1.0`, so
  TS 7 would silently stop linting the whole repo.

Everything else is current: vite 8, vitest 4, eslint 10, zod 4, firebase 12, firebase-admin 14,
firebase-functions 7, dependency-cruiser 18, react-router 8.

## Traps already hit — do not re-introduce

- **Unanchored ignore patterns.** `lib/` in `.gitignore` silently excluded
  `firebase/functions/src/lib/` — including `identity.ts`, the identity-verification code.
  The ESLint ignore hit the same trap. Both are anchored now; keep them that way.
- **Renaming the brand sweeps too far.** It rewrote the competitor table in `docs/19` into a
  claim about ourselves. `docs/21-name-clearance.md` and those passages are excluded on
  purpose — they record which names were _rejected_.
- **`pnpm install` on a partial branch** prunes lockfile importers for workspace packages that
  branch lacks. Now that everything is on `main` this should stop happening; if it does,
  `git checkout -- pnpm-lock.yaml`.
- **Run the whole gate before pushing.** A push after only `pnpm depcruise` broke CI on four
  PRs at once.

## Next session, in order

1. Give `packages/core` a build step — the runtime blocker above.
2. Domain tests. The generators are ready and deliberately avoid sharing arithmetic with the
   allocator, so a bug in it cannot hide behind them.
3. Clearance-check `SplitSutra`, then Phase 02.
4. Screens, replacing `PendingScreen` one route at a time.
