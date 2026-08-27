# Phase 01 — Repo, Monorepo & Core Scaffold

**Est. 1 day.** Depends on Phase 00.
Goal: an empty-but-correct monorepo where `pnpm verify` passes and the architecture
boundary is enforced by CI from day one.

---

## 1. Git repository

- [ ] 🔴 `git init` in `C:\Users\neeth\coding\splitsutra`
- [ ] 🔴 Create the GitHub repo (private to start)
  ```bash
  gh repo create allcottcourt1808/splitsutra --private --source=. --remote=origin
  ```
- [ ] 🔴 `.gitignore`: `node_modules/`, `dist/`, `.env*` (keep `.env.example`),
      `.emulator-data/`, `.firebase/`, `*-firebase-adminsdk-*.json`, `coverage/`,
      `playwright-report/`, `.DS_Store`
- [ ] 🔴 Commit the existing `docs/` and `checklists/` as the first commit
- [ ] 🟡 `gitleaks` pre-commit hook (NFR-7) via husky
- [ ] 🔴 **CI runs on every push and PR — advisory only, nothing blocks yet (Stage 1).**
      Reference: [../docs/20-test-automation-pipeline.md](../docs/20-test-automation-pipeline.md) §5a
  - [x] ✅ **Leave branch protection OFF until v1.0.** Through Phases 01–10 the codebase is
        churning, tests are written alongside the code they cover, and there is no deployed
        environment to protect. A hard gate here costs momentum and guards nothing.
  - [ ] 🔴 The `verify` job still runs on **every** push and PR — you see red, you just
        aren't blocked by it
  - [ ] 🟡 PRs stay optional; use them for anything substantial (diff + preview channel)
  - [ ] 🟡 ⚠️ **Add the CI status badge to `README.md`.** Advisory mode reliably decays into
        permanently-ignored; visible red is harder to skip than a tick in the Actions tab.
  - [ ] 🟡 **Norm: a red `main` is a same-day fix.** Enforcement is social during Stage 1 —
        the habit is what makes the Phase 11 flip a formality instead of a cleanup project.
  - [ ] 🟢 Enforcement (Stage 2) is flipped on in
        [phase-11-deploy.md](phase-11-deploy.md), immediately before the launch tag
- [ ] 🟢 `LICENSE` (MIT) and a real `README.md` for the app itself

## 2. Workspace root

- [ ] 🔴 `pnpm-workspace.yaml`
  ```yaml
  packages:
    - 'packages/*'
    - 'apps/*'
    - 'firebase/functions'
  ```
- [ ] 🔴 Root `package.json` with scripts: `dev`, `build`, `typecheck`, `lint`, `test`,
      `test:unit`, `test:rules`, `test:e2e`, `depcruise`, `verify`, `emulators`, `seed`
  - `verify` = `typecheck && lint && depcruise && test:unit` — the gate every phase ends on
- [ ] 🔴 `tsconfig.base.json` with **`"strict": true`**, `noUncheckedIndexedAccess`,
      `exactOptionalPropertyTypes`, `verbatimModuleSyntax`
- [x] ✅ `.nvmrc` / `engines` pinning **Node 24** (see [../docs/19-qa-log.md](../docs/19-qa-log.md) R5 — Node 20 is EOL)
- [ ] 🟡 Prettier + `.editorconfig`
- [ ] 🟡 ESLint flat config, shared across packages

## 3. `packages/core` — the platform-agnostic package

- [ ] 🔴 `packages/core/package.json` as `@splitsutra/core`
  - **Dependencies allowed:** `firebase`, `zod`, `react`, `zustand`
  - **Never:** `react-dom`, anything DOM-typed, anything React-Native-specific
- [ ] 🔴 Directory skeleton with an `index.ts` barrel per folder:
  ```
  src/types/  src/firebase/  src/repositories/  src/domain/
  src/hooks/  src/stores/    src/theme/         src/utils/
  ```
- [ ] 🔴 `tsconfig.json` extending the base, **with `"lib": ["ES2022"]` and no `"DOM"`**
      — this alone makes `window`/`document` a compile error in core
- [ ] 🟢 Leave test config alone here — the whole harness is set up in
      [Phase 02b](phase-02b-testing-setup.md)

## 4. Enforce the architecture boundary 🔴 _This is the item that saves Phase 12_

- [ ] 🔴 Install `dependency-cruiser`; add `.dependency-cruiser.cjs` with rules:
  - `packages/core` must not depend on `react-dom`, `react-native`, or `apps/*`
  - `apps/web/src/screens` must not import `firebase/*` directly
  - `packages/core/src/domain` must not import `firebase/*` or `react`
  - only `apps/web/src/auth/**` may import `firebaseui` or `firebase/compat`
- [ ] 🔴 Add `pnpm depcruise` to `verify` and to CI
- [ ] 🟡 Write one deliberately-violating file, confirm CI fails, then delete it.
      **An unverified guard rail is not a guard rail.**

## 5. `apps/web` — Vite scaffold

- [ ] 🔴 `pnpm create vite apps/web --template react-ts`
- [ ] 🔴 Rename to `@splitsutra/web`; add `@splitsutra/core` as a workspace dependency
- [ ] 🔴 Vite config: path aliases, `envPrefix: 'VITE_'`
- [ ] 🔴 `.env.example` with every `VITE_FIREBASE_*` key, values blank
- [ ] 🟡 `rollup-plugin-visualizer` + a bundle size budget (NFR-2)
- [ ] 🟡 React Router v7 installed; empty route table file created
- [ ] 🟢 Strip the Vite demo boilerplate

## 6. Types & schemas (single source of truth)

- [ ] 🔴 Zod schemas in `core/src/types/` for every entity in
      [../docs/03-data-model.md](../docs/03-data-model.md):
      `User`, `Friend`, `Group`, `GroupMember`, `Expense`, `Split`, `Payer`,
      `Settlement`, `Comment`, `Activity`, `Invite`
- [ ] 🔴 Export inferred TS types (`z.infer`) — **never hand-write a parallel interface**
- [ ] 🔴 `CurrencyCode` union + the `CURRENCIES` metadata table
- [ ] 🔴 The branded `MinorUnits` type
- [ ] 🟡 Firestore converters (`withConverter`) that parse through Zod on read, so a
      malformed document fails loudly at the boundary instead of deep in the UI

## 7. Firebase client init

- [ ] 🔴 `core/src/firebase/init.ts` — `initializeApp` from env config
- [ ] 🔴 Emulator connection guarded by `VITE_USE_EMULATORS`, using **`127.0.0.1`, not
      `localhost`** (Node/IPv6 gotcha — see [../docs/08-firebase-setup.md](../docs/08-firebase-setup.md))
- [ ] 🔴 `PlatformAdapter` interface + a web implementation
- [ ] 🟡 Enable Firestore offline persistence (`persistentLocalCache`)

## 8. CI

- [ ] 🔴 `.github/workflows/ci.yml` per [../docs/10-deployment.md](../docs/10-deployment.md)
- [ ] 🔴 Include `actions/setup-java` — **the rules tests need it in Phase 10**
- [ ] 🔴 Confirm CI is green on the first PR

---

## Exit criteria

- [ ] `pnpm install` succeeds from a clean clone
- [ ] `pnpm verify` passes locally and in CI
- [ ] `pnpm --filter web dev` serves a blank page with no console errors
- [ ] `packages/core` compiles with **no DOM lib** available
- [ ] dependency-cruiser has been _proven_ to fail on a real violation
- [ ] Repo pushed to GitHub with branch protection on
