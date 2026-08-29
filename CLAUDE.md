# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Read first

**[CONSTITUTION.md](CONSTITUTION.md) — 14 non-negotiable articles.** It is short, and it is the
stable statement of intent that the ~20 files in `docs/` elaborate on. **If a change violates an
article, the change is wrong — not the article.** Amending one is allowed but must be a recorded
decision in [docs/12-decisions.md](docs/12-decisions.md), not an incidental exception.

[RESUME.md](RESUME.md) is the running session log: current state, open PRs, and traps already hit.
Read it before starting work and update it as you go.

`docs/` says **what and why**; `checklists/phase-NN-*.md` says **what to actually do**, phase by
phase, and is where progress is ticked.

## Commands

```bash
pnpm verify            # typecheck + lint + depcruise + test:unit — the gate before any PR
```

| Task             | Command                                              |
| ---------------- | ---------------------------------------------------- |
| Dev server       | `pnpm dev` (Vite, port 5173)                         |
| Typecheck        | `pnpm typecheck` — **runs two resolvers**, see below |
| Lint / format    | `pnpm lint` · `pnpm format` · `pnpm format:check`    |
| Boundary rules   | `pnpm depcruise`                                     |
| Unit + component | `pnpm test:unit`                                     |
| Watch            | `pnpm test:watch`                                    |
| Coverage         | `pnpm test:coverage`                                 |
| Rules tests      | `pnpm test:rules` (starts its own emulator)          |
| Integration      | `pnpm test:integration` (starts its own emulator)    |
| E2E              | `pnpm test:e2e`                                      |
| Emulators        | `pnpm emulators`                                     |
| Seed data        | `pnpm seed`                                          |

### Running one test

Vitest is configured with four **projects** (`vitest.config.ts`), each with its own root and
environment, so a project flag is almost always needed:

```bash
pnpm vitest run --project unit path/to/file.test.ts     # core, node env
pnpm vitest run --project component src/auth            # apps/web, happy-dom
pnpm vitest run --project unit -t "rejects a self-request"
```

| Project       | Root            | Env       | Matches                          |
| ------------- | --------------- | --------- | -------------------------------- |
| `unit`        | `packages/core` | node      | `src/**/__tests__/**/*.test.ts`  |
| `component`   | `apps/web`      | happy-dom | `src/**/__tests__/**/*.test.tsx` |
| `rules`       | `firebase`      | node      | `tests/rules/**/*.test.ts`       |
| `integration` | `firebase`      | node      | `tests/integration/**/*.test.ts` |

`rules` and `integration` need an emulator and run with `fileParallelism: false` — they share
emulator state, so a parallel `clearFirestore()` wipes another file's fixtures.

Node 24 (`.nvmrc`). **JDK 21 must be on `PATH` for the Firestore emulator** — it is a Java
process and fails with a stack trace, not a helpful message, without one.

## Architecture

```
packages/core      ← platform-agnostic: types, domain, repositories, hooks. NO DOM.
apps/web           ← React 19 + Vite. Screens, design system, routing.
firebase/functions ← Cloud Functions (admin SDK). Imports core for the money math.
firebase/seed.ts   ← seed script. NOT a workspace package (see typecheck:seed).
```

The whole structure exists to serve **Article II**: `packages/core` is the layer a future React
Native app reuses unchanged, so it may not import `react-dom`, `react-native`, `window`,
`document`, or `localStorage`. Platform capabilities arrive through an injected
`PlatformAdapter` (`setPlatformAdapter` at startup). `pnpm depcruise` enforces this and four
other boundaries mechanically — treat a depcruise failure as an architecture error, not a config
problem.

### The layering that matters

```
screens  →  hooks  →  repositories  →  firebase/init.ts  →  Firestore
            (core)     (core)           (core)
```

- **Article VIII: screens never touch Firestore.** A screen importing `firebase/firestore` is a
  bug — it means logic escaped the portable layer. Enforced by `screens-never-touch-firestore`.
- **Article III + V: the server owns balances.** Expenses and settlements are the ledger and the
  only truth; `balanceMinor` is a cache written exclusively by Cloud Functions and denied to
  clients by Security Rules. Clients may compute optimistic balances for display, never persist
  them.
- **Article VI: one implementation of the money math**, in `core/src/domain/`, imported by both
  the client and Functions. A second "quick" one for a preview or a validation is forbidden.
- **Article I: money is never a float.** Integer minor units carrying the branded `MinorUnits`
  type. `balanceByCurrency` maps are **sparse** — a settled balance is an absent key, not `0`,
  and amounts are never summed across currencies.
- **Article IV: Security Rules are the boundary.** Client-side validation is UX only. For every
  `allow` in `firestore.rules` there should be one passing and one failing test.

### 🔴 `@splitsutra/core` subpaths are not in the root barrel

`packages/core/src/index.ts` re-exports `./types`, `./domain`, `./theme`, `./platform`,
`./utils` — and **deliberately not** `./firebase`, `./repositories`, `./hooks`, `./stores`,
because a runtime Firebase import in the root barrel would reach every consumer including Cloud
Functions, which use the admin SDK. Reach those through their subpaths:

```ts
import { tokens, type Expense } from '@splitsutra/core';
import { initFirebase } from '@splitsutra/core/firebase';
import { useAuth } from '@splitsutra/core/hooks';
import { updateUserProfile } from '@splitsutra/core/repositories';
```

### 🔴 Two resolvers, and `pnpm verify` only sees one

`packages/core`'s `package.json` entry points name `dist/`, because `firebase/functions` is real
Node and needs emitted `.js`. But `apps/web` aliases `@splitsutra/core` straight to **source**,
in _two_ places that must be kept in step:

- `apps/web/tsconfig.json` → `paths`
- `apps/web/vite.config.ts` → `resolve.alias`

**Adding a `paths` entry without the matching Vite alias compiles perfectly and breaks the dev
server**, because typecheck resolves through tsconfig and never asks Vite anything. This has
already happened once: the bare `@splitsutra/core` alias prefix-matched `@splitsutra/core/hooks`
and rewrote it to `…/index.ts/hooks`. The alias is now an **array** with the subpath regex
first — order is load-bearing, and `vite.config.ts` explains it at the point of the fix.

After changing anything in that area, run a real `pnpm --filter @splitsutra/web build` and load
the app; a green `pnpm verify` is not evidence.

`pnpm typecheck` therefore runs both resolvers, plus `typecheck:seed` — `firebase/seed.ts` is
not a workspace package, so `pnpm -r` never reaches it, and it needs `core` built first for the
`.d.ts` files.

### Auth

`initFirebase()` (core) is the **only** initialisation, called from
`apps/web/src/platform/startup.ts` in a fixed order: tokens → platform adapter → Firebase. It
calls `initializeAuth()`, not `getAuth()` — the two collide with `auth/already-initialized` on
the same app. `initializeAuth` is also the only entry point accepting a persistence strategy but
installs **no popup resolver**, so `popupRedirectResolver` must be passed explicitly or Google
sign-in fails at runtime with nothing complaining earlier.

`/login` is rendered by **FirebaseUI**, confined to `apps/web/src/auth/FirebaseUIMount.tsx` and
enforced there by `firebaseui-only-in-web-auth`. It is an unmet peer (`firebaseui@6.1.0` wants
firebase 9–10; this repo is on 12) that works only because firebase 12 still ships
`firebase/compat`. That file documents the compat bridge and the cost.

Route guards are **layout routes** in `routes.tsx`, so guarding is structural rather than a
wrapper someone must remember. `useAuth()` reports **three** states — collapsing
`loading: true / user: null` ("nobody knows yet") into "signed out" is the flash-of-login-screen
bug, and it destroys the preserved destination on every hard refresh.

### Emulators

Use a **`demo-` prefixed project id** for anything local: it forces the SDKs offline, so a
misconfigured build physically cannot reach a real project. `apps/web/.env.local` (gitignored,
template in `.env.example`) points the app at them. Emulator hosts are hard-coded to `127.0.0.1`,
never `localhost` — Node resolves `localhost` to `::1` first and the emulators bind IPv4 only,
which fails as a confusing timeout.

Firebase web config values are **public identifiers, not secrets** — they ship in the bundle by
design, and security comes from Rules and App Check. That reasoning does **not** extend: anything
that genuinely is a secret must never appear in a `VITE_*` variable, because every `VITE_*`
variable is inlined into the public bundle at build time.

## Conventions

- **Article IX: mobile-first, flexbox-only, tokens-only.** No hard-coded colours, spacing, radii
  or font sizes outside `tokens.ts`; 44×44 minimum touch targets; no hover-only affordances.
  Design target is 390px.
- **No `<div>` in a screen file.** Screens compose `<Screen>`, `<Stack>`, `<Row>`, `<Card>` from
  `apps/web/src/components/Layout.tsx`, which map 1:1 onto React Native primitives. Raw elements
  that genuinely need a DOM node live in a non-screen module.
- **CSS cascade layers** — `@layer reset, primitives;` in `styles/reset.css`; primitive base
  rules are layered and consumer rules are not, so a caller's `className` wins by construction
  rather than by CSS-module import order. `styles/__tests__/cascadeLayers.test.tsx` holds it.
  happy-dom applies no stylesheet and computes no layout, so component tests are structurally
  blind to cascade and layout bugs.
- **Article X: tests before UI for anything that computes.** `core/src/domain/**` is held at 100%
  branch coverage.
- **Article XI: cost has a ceiling.** Every Cloud Function sets `maxInstances`; no function writes
  back to its own trigger path without a diff guard. Function **export names are deployed function
  names** — removing one is a teardown (delete + create), not a refactor.
- Routes are declared once in `navigation/paths.ts` (`ROUTE_PATTERNS` + typed `paths` builders)
  and `routes.tsx` derives the table by mapping over it. Never concatenate a route string by hand.

## Working agreements

- **Open every PR against `main`; never stack.** Stacking has already silently lost 1,673 lines
  from `main`: GitHub only retargets a stacked PR after its base branch is deleted, so three PRs
  merged within seconds of each other landed in each other's branches while all showing green
  MERGED badges. If two changes depend on each other, merge the first before opening the second.
- CI is **advisory** until v1.0 — nothing blocks a merge. A red `main` is a same-day fix.
- **Bulk renames need a dry run.** `scripts/rename-brand.sh` has over-matched before, rewriting
  historical and third-party references in docs. Print the matched files and a sample diff before
  writing anything.
- The project is developed on Windows. Prefer the Bash tool over PowerShell (`pnpm` and `firebase`
  are missing from the PowerShell `PATH`), and write patch scripts to a file and `node` them
  rather than using long heredocs, which get mangled.
