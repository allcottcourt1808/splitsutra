# Phase 02b — Testing Framework Setup

**Est. 1 day.** Depends on 01 (monorepo) and 02 (emulators). **Do this before Phase 03.**
Reference: [../docs/16-testing-setup.md](../docs/16-testing-setup.md)

> **Why here and not later.** Article X of the [constitution](../CONSTITUTION.md) requires
> tests before UI for anything that computes — impossible unless the harness already
> exists. And Phase 06 (the split engine) is unbuildable to standard without property
> testing and a coverage gate already wired up. Retrofitting this after three phases of
> code is a bad week.

---

## 1. Install

- [ ] 🔴 Runner + coverage (root, `-w`):
      `vitest`, `@vitest/coverage-v8`
- [ ] 🔴 Property testing: `fast-check`
- [ ] 🔴 Rules: `@firebase/rules-unit-testing`
- [ ] 🔴 Integration: `firebase-admin`
- [ ] 🟡 Component: `@testing-library/react`, `@testing-library/user-event`,
      `@testing-library/jest-dom`, `happy-dom`
- [ ] 🟡 E2E: `@playwright/test`, then `pnpm exec playwright install --with-deps chromium`
- [ ] 🟡 A11y: `@axe-core/playwright`
- [ ] 🔴 Architecture: `dependency-cruiser`
- [ ] 🟢 Install latest of each; pin nothing except where a doc says to

## 2. Vitest projects config

- [ ] 🔴 Root `vitest.config.ts` with four projects: `unit`, `component`, `rules`,
      `integration`
- [ ] 🔴 ⚠️ Check whether your Vitest version wants `test.projects` (current) or a separate
      `vitest.workspace.ts` (older). Same concept, different filename.
- [ ] 🔴 `unit` → `node` environment, `packages/core`
- [ ] 🟡 `component` → `happy-dom`, `apps/web`, with a setup file
- [ ] 🔴 `rules` → `firebase/`, `testTimeout: 15_000`
- [ ] 🔴 `integration` → `firebase/`, `testTimeout: 30_000`, `hookTimeout: 30_000`
- [ ] 🔴 ⚠️ **`fileParallelism: false` on `rules` and `integration`** — they share one
      emulator, and parallel `clearFirestore()` calls wipe each other's fixtures. This
      produces failures that don't reproduce locally.
- [ ] 🔴 **Coverage threshold: 100% branches on `packages/core/src/domain/**`**
      (Article VII / NFR-8)
- [ ] 🟡 Verify the gate works: delete a domain test, confirm coverage fails the build

## 3. Test data factories

- [ ] 🔴 `packages/core/src/testing/factories.ts` — `makeUser`, `makeGroup`,
      `makeGroupMember`, `makeExpense`, `makeSettlement`, `makeComment`, `makeInvite`
- [ ] 🔴 Every factory returns something **valid by default**, with a `Partial<T>` override
- [ ] 🔴 ⚠️ **Deterministic** — seeded ID sequences, fixed timestamps. No `Date.now()`,
      no `Math.random()`.
- [ ] 🔴 `packages/core/package.json` exports map: add `"./testing"` as a separate entry so
      factories never reach the production bundle
- [ ] 🟡 `arbitraries.ts` — fast-check generators: `arbMinorUnits`, `arbUids`,
      `arbValidExpense`, `arbLedger`
- [ ] 🔴 ⚠️ `arbLedger` must generate expenses that are **internally consistent by
      construction** (`sum(paidBy) === sum(splits) === amountMinor`). Otherwise a zero-sum
      failure tells you the generator is broken, not the balance engine.

## 4. Prove the harness works

Write these now, against stubs if the real functions don't exist yet. A harness nobody has
run is not a harness.

- [ ] 🔴 One trivial unit test that passes
- [ ] 🔴 One `fast-check` property test that passes
- [ ] 🔴 One property test that **fails on purpose** — confirm fast-check shrinks the
      counterexample and prints it readably
- [ ] 🔴 Confirm `pnpm test:watch` re-runs in under 2 seconds

## 5. Rules test harness

- [ ] 🔴 `firebase/tests/rules/setup.ts` with `makeTestEnv(projectId)`
- [ ] 🔴 ⚠️ **Project IDs must start with `demo-`** — the emulator treats these as
      guaranteed-local, needing no credentials and unable to reach a real project
- [ ] 🔴 Host `127.0.0.1`, port 8080 (**not `localhost`** — Node resolves it to IPv6 first
      and the emulator binds IPv4)
- [ ] 🔴 `beforeEach` → `clearFirestore()` then seed
- [ ] 🔴 Seed via `withSecurityRulesDisabled` so setup doesn't fight the rules under test
- [ ] 🔴 Context helpers: `asAlice()`, `asMallory()`, `asAnon()`
- [ ] 🔴 Write two proving tests against the current deny-all rules: one `assertFails`,
      one `assertSucceeds` (temporarily loosen a rule to prove the positive path works)
- [ ] 🟢 Note the parallel-rules optimisation (per-file `demo-rules-<name>` project IDs,
      requires `singleProjectMode: false`) for when the suite gets slow

## 6. Integration test harness

- [ ] 🔴 `firebase/tests/integration/setup.ts` setting `FIRESTORE_EMULATOR_HOST` and
      `FIREBASE_AUTH_EMULATOR_HOST` **before** importing `firebase-admin`
- [ ] 🔴 `initializeApp({ projectId: 'demo-integration' })`
- [ ] 🔴 **`waitFor(fn, check, {timeout, interval})`** helper — polls until an assertion
      holds, with the last observed value in the timeout message
- [ ] 🔴 ⚠️ **Never `sleep()` waiting for a trigger.** Flaky when CI is slow, wasteful when
      it's fast. Emulator trigger latency is ~1–3s and varies.
- [ ] 🟡 Helper to reset Firestore between integration tests
- [ ] 🟡 One proving test: write a doc, confirm it reads back

## 7. Component test harness

- [ ] 🟡 `apps/web/src/test-setup.ts` — `jest-dom/vitest` matchers, `cleanup` in `afterEach`
- [ ] 🟡 One proving test rendering a trivial component
- [ ] 🟢 Note the policy: component tests **only** for components with real logic
      (`<AmountInput>`, `<Money>`, split sheet, `<AdSlot>`). Everything else is E2E's job.

## 8. Playwright harness

- [ ] 🟡 `playwright.config.ts` — `testDir: e2e/specs`, `globalSetup`, `webServer` running
      the Vite dev server with `VITE_USE_EMULATORS=true`
- [ ] 🟡 ⚠️ **`fullyParallel: false`** — shared emulator
- [ ] 🟡 Two device projects: **`mobile` (Pixel 7) first**, then `desktop`. The phone
      viewport is the design target.
- [ ] 🟡 `trace: 'on-first-retry'`, `video: 'retain-on-failure'` — traces are how you debug
      failures that only happen in CI
- [ ] 🟡 `retries: 2` **in CI only**; locally a flake must fail loudly
- [ ] 🟡 `e2e/fixtures/auth.ts` — create users via the **Auth emulator REST API**
      (`/accounts:signUp?key=fake-api-key`), save a `storageState`
- [ ] 🔴 ⚠️ **Do not drive the FirebaseUI widget in every test.** It's slow and couples
      unrelated specs to the auth UI. Only E1 (sign-up) should touch the real widget.
- [ ] 🟡 `e2e/global-setup.ts` — wait for emulators, clear Firestore, run seed, create users
- [ ] 🟡 Two standing guards as their own specs:
  - [ ] 🟡 **No horizontal scroll at 390×844** (NFR-3) — catches a whole class of layout
        regressions in one assertion
  - [ ] 🟡 **`axe-core` no critical violations** (NFR-5)
- [ ] 🟡 One proving spec: load `/login`, assert the page renders

## 9. Static analysis

- [ ] 🔴 `.dependency-cruiser.cjs` with four forbidden rules:
  - [ ] 🔴 `core-is-platform-agnostic` — no `react-dom` / `react-native` / DOM (NFR-10, Art. II)
  - [ ] 🔴 `domain-is-pure` — `domain/` imports no `firebase`, no `react` (Art. VII)
  - [ ] 🔴 `screens-never-touch-firestore` (Art. VIII)
  - [ ] 🔴 `firebaseui-is-quarantined` — only `apps/web/src/auth` (ADR-03)
- [ ] 🔴 ⚠️ **Prove each of the four fails.** Write a deliberately violating file, watch CI
      go red, delete it. An unverified guard rail is not a guard rail — and these four are
      what stand between you and a painful Phase 12.
- [ ] 🟡 ESLint rule banning `parseFloat` inside `packages/core/src/domain` (NFR-8, Art. I)
- [ ] 🟡 `tsc --noEmit -b` across the workspace

## 10. Scripts

- [ ] 🔴 `test:unit`, `test:watch`, `test:coverage`
- [ ] 🔴 `test:rules` and `test:integration` wrapped in **`firebase emulators:exec`** —
      it tears down cleanly on failure, which a manual start/stop in `globalSetup`
      frequently gets wrong in CI
- [ ] 🟡 `test:e2e`, `test:e2e:ui`
- [ ] 🔴 `verify` = `typecheck && lint && depcruise && test:unit` — the fast gate every
      phase ends on, no emulator required
- [ ] 🔴 `test` = the full local run

## 11. CI

- [ ] 🔴 `actions/setup-java@v4` (temurin 21) — **the emulators are Java processes**
- [ ] 🔴 Ordered cheap → expensive: typecheck, lint, depcruise, unit+coverage, rules,
      integration, build, e2e
- [ ] 🟡 ⚠️ Cache `~/.cache/ms-playwright` or CI re-downloads ~400 MB every run
- [ ] 🟡 Cache the pnpm store
- [ ] 🟡 Upload `playwright-report/` and `coverage/` as artifacts on failure
- [ ] 🔴 Confirm the full pipeline is green before starting Phase 03

## 12. Conventions to write down

- [ ] 🔴 **Requirement IDs in test names** — `test('AC-D2.3: ...')`, `test('T5: ...')`.
      Mechanically links [../docs/01-requirements.md](../docs/01-requirements.md) and the
      threat table to the suite, so a grep answers "is this covered?". Highest-leverage
      testing habit in the project, and free.
- [ ] 🔴 **Never mock Firestore** — use the emulator. Mocks drift from real transaction,
      timestamp, and rules behaviour, and give confident green tests over broken code.
- [ ] 🟡 **No snapshot tests** except where explicitly justified.
- [ ] 🟡 Flakiness policy: no `sleep()`, always `clearFirestore()`, deterministic factories,
      and **a quarantined flaky test is a bug ticket, not a solution.**

---

## Exit criteria

- [ ] `pnpm verify` passes locally and in CI
- [ ] `pnpm test` runs all four suites green
- [ ] `pnpm test:watch` re-runs in under 2 seconds
- [ ] A deliberately-failing property test shrinks and prints a readable counterexample
- [ ] All four dependency-cruiser rules **proven** to fail on a real violation
- [ ] Coverage gate proven to fail when a domain test is removed
- [ ] Playwright runs one spec green against the emulators
- [ ] Java is installed in CI and the emulator-backed suites pass there
