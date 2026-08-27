# Resume here

**Last updated:** 2026-08-27. The project is **SplitSutra** (renamed from "Settl").

**Nothing is pushed.** There is no git remote yet and `gh` is not authenticated, so the
five pull requests below exist only as local branches.

## Where the work stands

`pnpm verify` (typecheck → lint → depcruise → unit) **passes end-to-end**, on every branch.
That is new — it had never run green before this session.

| Area                              | State                                                               |
| --------------------------------- | ------------------------------------------------------------------- |
| Environment, toolchain, CI config | ✅ complete                                                         |
| `packages/core` types + domain    | ✅ complete — 11 schemas, converters, split engine, balances        |
| `apps/web` design system          | ✅ components, navigation shell, auth client                        |
| `firebase/` rules + functions     | ✅ rules, helpers, 4 callables, 4 triggers                          |
| **Domain tests**                  | ❌ **none exist** — `arbitraries.ts` is written, no `*.test.ts` are |
| `apps/web` entry point            | ❌ no `main.tsx`, no routes, no screens — the app cannot start      |
| `firebase/functions/src/index.ts` | ❌ missing, so **no function is actually exported**                 |
| Seed script                       | ❌ `pnpm seed` points at `firebase/seed.ts`, which does not exist   |

The zero-tests gap is an Article X violation (tests before UI) and is the single most
valuable thing to fix next: the money math is fully written and completely unverified.

## Branches — ready to become five PRs

Stacked, because each needs what it sits on. Merge in this order:

```
main
├── docs/planning-and-constitution     3 commits   (independent)
└── chore/workspace-toolchain          6 commits
    └── feat/core-domain               4 commits
        ├── feat/web-design-system     4 commits
        └── feat/firebase-backend      4 commits
```

Both leaf branches were confirmed to pass `pnpm verify` on their own.

**To publish:** authenticate with `gh auth login`, create the repo, then push each branch
and open its PR against its parent.

## Decisions settled

| #            | Decision                                                                                                                                                                                            |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Q15 / R5** | **Node 20 → 24.** Node 20 reached EOL 2026-04-30.                                                                                                                                                   |
| **Q17 / R7** | **FirebaseUI dropped.** Web-only, so it could never serve the mobile port; auth uses the modular SDK.                                                                                               |
| **Q16 / R6** | **Renamed "Settl" → "SplitSutra"** (2026-08-27). Applied across all branches with `filter-branch`, so no commit ever says "Settl". ⚠️ **SplitSutra is not clearance-checked** — see the risk below. |

### Dependencies: latest, with two forced exceptions

Everything was moved to its newest release except two, where "newest" would break the build:

- **Node stays on 24** though 26 is out. Firebase's tooling enumerates the runtimes Cloud
  Functions Gen 2 accepts and stops at `nodejs24`; 26 would be rejected at deploy.
- **TypeScript is 6.0.3, not 7.0.2.** `typescript-eslint@8` declares `typescript <6.1.0`, so
  the Go-based TS 7 compiler would silently stop linting the repo. TS 6 also reports what
  TS 7 will break, which is the right place to sit before that migration.

Upgraded: vite 6→8, vitest 3→4, eslint 9→10, zod 3→4, firebase 11→12, firebase-admin 13→14,
firebase-functions 6→7, dependency-cruiser 16→18, react-router 7→8, plus the rest. No unmet
peer warnings.

## 🔴 The one open risk

**`SplitSutra` has never been clearance-checked.** The previous name reached the repo, the
docs and the config before anyone searched for it, and it turned out three live
expense-splitting apps already used it.

Renaming is cheap _right now_ — nothing is published, no project ID is reserved, the npm
scope is private, and `scripts/rename-brand.sh` exists. It stops being cheap the moment
**Phase 02 reserves a Firebase project ID**, because those are globally unique and permanent.

So: run the sweep in [docs/21-name-clearance.md](docs/21-name-clearance.md) — App Store,
Play Store, npm scope, domain, USPTO — **before** Phase 02, not after.

## Fixed this session (was a list of known issues)

1. ✅ **Module resolution collision.** `packages/core` ships raw TypeScript, so
   `firebase/functions` compiled core's source under NodeNext, where core's extensionless
   imports are hard errors. All 61 relative imports now carry explicit `.js` extensions —
   legal under bundler, NodeNext and Vite alike. This was the root cause of ~20 apparent
   "no exported member" errors.
2. ✅ **Article VI violation.** `MAX_AMOUNT_MINOR` and the group cap were re-declared in
   `firebase/functions/src/common/config.ts`, the cap under a different name. Now re-exported
   from core.
3. ✅ **`.gitignore` excluded live source.** `firebase/functions/.gitignore` had an
   unanchored `lib/`, which matches at any depth and was silently excluding `src/lib/` —
   including `identity.ts`. A fresh clone would have been missing the identity verification.
   Anchored to `/lib/`; audited the repo for other instances (none).
4. ✅ **Three scripts pointed at a non-existent `firebase/firebase.json`.** `test:rules`,
   `test:integration` and `emulators` could not run. The config is at the repo root.
5. ✅ **`.prettierrc.json` was not valid JSON** (trailing commas) and listed _itself_ under a
   jsonc override — which cannot work, since Prettier must parse the config before it can
   apply anything in it. Tolerated by Prettier 3.6, fatal on 3.9.
6. ✅ `baseUrl` removed from `apps/web/tsconfig.json` (deprecated in TS 6, gone in TS 7).
7. ✅ Two real type errors: an unsafe `RawEntry` cast in `integrity.ts`, and `measurementId`
   typed as `?: string | undefined` where `exactOptionalPropertyTypes` needs `?: string`.
8. ✅ Two dead `= null` initialisers in `identity.ts` that ESLint 10 correctly flagged.

## Next, in order

1. **Domain tests** — the money math is unverified. `arbitraries.ts` is already written and
   deliberately builds ledgers by cut points rather than by calling `allocate()`, so a bug in
   the allocator cannot hide behind a generator that shares its arithmetic.
2. **`firebase/functions/src/index.ts`** — nothing is exported today.
3. **`apps/web/main.tsx`**, routes, screens — the app cannot start.
4. **Seed script** at `firebase/seed.ts`. It must refuse to run against any project ID
   ending in `-prod`.
5. Clearance-check `SplitSutra`, then Phase 02.
