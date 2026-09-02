# 16 — Testing Framework Setup

> [09-testing.md](09-testing.md) decides **what to test and why**.
> This document is the **mechanics**: packages, config files, directory layout, scripts,
> and CI wiring. Executed in [../checklists/phase-02b-testing-setup.md](../checklists/phase-02b-testing-setup.md).

**Set this up before Phase 03.** Article X of the [constitution](../CONSTITUTION.md) says
tests come before UI for anything that computes — that's only possible if the harness
already exists. Retrofitting a test setup after three phases of code is a bad week.

---

## The stack

| Layer            | Tool                                             | Why this one                                                                                                 |
| ---------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| Test runner      | **Vitest**                                       | ESM + TS native, shares Vite config, fastest watch loop. Jest needs a transform pipeline we'd be maintaining |
| Property testing | **fast-check**                                   | The zero-sum and allocation invariants are the highest-value tests in the project                            |
| Coverage         | **@vitest/coverage-v8**                          | Native V8 coverage, no instrumentation step                                                                  |
| Security rules   | **@firebase/rules-unit-testing**                 | The only supported way; requires Java                                                                        |
| Integration      | **Vitest + firebase-admin** against the emulator | Real triggers, real transactions                                                                             |
| Component        | **@testing-library/react + happy-dom**           | Deliberately light — see §7                                                                                  |
| E2E              | **Playwright**                                   | Multi-browser, great traces, first-class CI                                                                  |
| A11y             | **@axe-core/playwright**                         | NFR-5                                                                                                        |
| Architecture     | **dependency-cruiser**                           | NFR-10 — the rule that protects the mobile port                                                              |

### Two opinions worth stating up front

**1. Never mock Firestore.** Use the emulator. A hand-rolled Firestore mock drifts from
real behaviour — transactions, `serverTimestamp()`, security rules, trigger ordering — and
gives confident green tests over broken code. The emulator is fast enough.

**2. Almost no snapshot tests.** They test React, not this product, and they rot into
"press `u` until green". Test behaviour and money, not markup.

---

## Directory layout

```
packages/core/
├── src/
│   ├── domain/
│   │   ├── allocate.ts
│   │   └── __tests__/            # colocated — unit + property tests
│   │       ├── allocate.test.ts
│   │       ├── balances.test.ts
│   │       └── simplify.test.ts
│   └── testing/                  # factories + helpers, exported as @splitsutra/core/testing
│       ├── factories.ts
│       ├── arbitraries.ts        # fast-check generators
│       └── index.ts
│
firebase/
├── tests/
│   ├── rules/                    # @firebase/rules-unit-testing
│   │   ├── setup.ts
│   │   ├── groups.test.ts
│   │   ├── expenses.test.ts
│   │   └── ...
│   └── integration/              # emulator-backed Functions tests
│       ├── setup.ts
│       ├── balances.test.ts
│       └── callables.test.ts
│
apps/web/src/**/__tests__/        # component tests (sparse by design)
│
e2e/                              # Playwright
├── fixtures/
│   └── auth.ts                   # programmatic sign-in
├── global-setup.ts
└── specs/
    ├── e1-signup.spec.ts
    └── ...
```

`packages/core/src/testing/` is a **separate export path** (`@splitsutra/core/testing`) so
factories never end up in the production bundle:

```json
// packages/core/package.json
"exports": {
  ".":         { "import": "./src/index.ts" },
  "./testing": { "import": "./src/testing/index.ts" }
}
```

---

## 1. Vitest projects (monorepo)

The four test kinds need different environments, timeouts, and parallelism. Vitest
"projects" handle this from one root config.

```ts
// vitest.config.ts (repo root)
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        // Pure domain logic — no I/O, milliseconds
        test: {
          name: 'unit',
          root: './packages/core',
          environment: 'node',
          include: ['src/**/__tests__/**/*.test.ts'],
        },
      },
      {
        // Web components — sparse
        test: {
          name: 'component',
          root: './apps/web',
          environment: 'happy-dom',
          setupFiles: ['./src/test-setup.ts'],
          include: ['src/**/__tests__/**/*.test.tsx'],
        },
      },
      {
        // Security rules — shared emulator state
        test: {
          name: 'rules',
          root: './firebase',
          environment: 'node',
          include: ['tests/rules/**/*.test.ts'],
          testTimeout: 15_000,
          fileParallelism: false, // ← see the warning below
        },
      },
      {
        // Cloud Functions against the emulator
        test: {
          name: 'integration',
          root: './firebase',
          environment: 'node',
          include: ['tests/integration/**/*.test.ts'],
          testTimeout: 30_000, // trigger round-trips take seconds
          hookTimeout: 30_000,
          fileParallelism: false,
        },
      },
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      thresholds: {
        // NFR + Article VII: the money math must be exhaustively covered
        'packages/core/src/domain/**': {
          branches: 100,
          functions: 100,
          lines: 100,
          statements: 100,
        },
      },
    },
  },
});
```

> ⚠️ **Vitest renamed this API.** Older versions used a separate `vitest.workspace.ts`
> file; current versions use `test.projects` as above. Check the version you install and
> use whichever it documents — the concept is identical.

> ⚠️ **`fileParallelism: false` on emulator-backed projects.** Rules and integration tests
> share one emulator instance. Running files in parallel means one test's
> `clearFirestore()` wipes another's fixtures, producing failures that don't reproduce
> locally. See §3 for the faster alternative once the suite grows.

### Naming convention 🔴

Put the requirement ID in the test name. This mechanically links
[01-requirements.md](01-requirements.md) and [05-security-rules.md](05-security-rules.md)
to the suite, so a grep answers "is this covered?".

```ts
test('AC-D2.3: percentages must total exactly 100%', ...)
test('T5: list on usernames is denied', ...)
```

This is the single highest-leverage testing habit in the project and it costs nothing.

---

## 2. Factories, not fixture files

Fixture JSON goes stale and hides what a test actually depends on. Use overridable
factories.

```ts
// packages/core/src/testing/factories.ts
let seq = 0;
const nextId = (p: string) => `${p}-${++seq}`;

export function makeUser(over: Partial<User> = {}): User {
  return {
    uid: nextId('user'),
    displayName: 'Test User',
    email: `${nextId('email')}@example.com`,
    phoneNumber: null,
    photoURL: null,
    defaultCurrency: 'USD',
    createdAt: Timestamp.fromMillis(0),
    updatedAt: Timestamp.fromMillis(0),
    deletedAt: null,
    ...over,
  };
}

export function makeExpense(over: Partial<Expense> = {}): Expense {
  /* ... */
}
export function makeGroup(over: Partial<Group> = {}): Group {
  /* ... */
}
export function makeSettlement(over: Partial<Settlement> = {}): Settlement {
  /* ... */
}
```

Every factory returns something **valid by default**, so a test only states what it cares
about:

```ts
const expense = makeExpense({ amountMinor: 10_000, splitMethod: 'equal' });
```

### fast-check arbitraries

The property tests need generators that produce _valid_ ledgers, or they'll fail on
malformed input rather than on real bugs.

```ts
// packages/core/src/testing/arbitraries.ts
import fc from 'fast-check';

export const arbMinorUnits = fc.integer({ min: 1, max: 1_000_000_000 });

export const arbUids = fc.uniqueArray(fc.string({ minLength: 3, maxLength: 12 }), {
  minLength: 1,
  maxLength: 15,
});

/** A group ledger whose expenses are internally consistent by construction. */
export const arbLedger = () =>
  arbUids.chain((uids) =>
    fc.record({
      memberIds: fc.constant(uids),
      expenses: fc.array(arbValidExpense(uids), { maxLength: 40 }),
      settlements: fc.array(arbSettlement(uids), { maxLength: 20 }),
    }),
  );
```

> The point of `arbLedger` is that it generates expenses which already satisfy
> `sum(paidBy) === sum(splits) === amountMinor`. That way a zero-sum failure means the
> _balance engine_ is wrong, which is the thing under test.

---

## 3. Security rules tests

```ts
// firebase/tests/rules/setup.ts
import { initializeTestEnvironment, RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { readFileSync } from 'node:fs';

export async function makeTestEnv(projectId: string): Promise<RulesTestEnvironment> {
  return initializeTestEnvironment({
    projectId, // MUST start with "demo-" — see below
    firestore: {
      rules: readFileSync('firestore.rules', 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  });
}
```

> 💡 **Use a `demo-` project ID.** The emulator treats `demo-*` project IDs as guaranteed-
> local: no credentials required, and no possibility of a misconfigured test reaching a
> real project. Cheap insurance.

### Test shape

```ts
// firebase/tests/rules/expenses.test.ts
let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await makeTestEnv('demo-rules-expenses');
});
afterAll(async () => {
  await env.cleanup();
});
beforeEach(async () => {
  await env.clearFirestore();
  await seed();
});

// Seeding bypasses rules — otherwise setup fights the thing under test
async function seed() {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'groups/g1'), makeGroup({ id: 'g1', memberIds: ['alice'] }));
    await setDoc(doc(db, 'groups/g1/members/alice'), {
      uid: 'alice',
      role: 'admin',
      balanceMinor: 0,
    });
  });
}

const asAlice = () => env.authenticatedContext('alice').firestore();
const asMallory = () => env.authenticatedContext('mallory').firestore();
const asAnon = () => env.unauthenticatedContext().firestore();

test('T1: non-member cannot read a group expense', async () => {
  await assertFails(getDoc(doc(asMallory(), 'groups/g1/expenses/e1')));
});

test('positive: a member can create a valid expense', async () => {
  await assertSucceeds(setDoc(doc(asAlice(), 'groups/g1/expenses/e1'), validExpense()));
});
```

**The rule from [09-testing.md](09-testing.md): for every `allow`, one test that passes and
one that fails.** A denial-only suite doesn't prove the app works; a happy-path-only suite
doesn't prove it's secure.

### Faster parallel rules tests (do this only when the suite gets slow)

Give each **test file** its own `demo-rules-<name>` project ID. The emulator isolates data
per project, so files can then run in parallel and `fileParallelism: false` can be dropped.

⚠️ This requires **`singleProjectMode: false`** in `firebase.json` — Phase 02 sets it to
`true`. Flip it when you make this change, or the emulator rejects the extra project IDs.

---

## 4. Integration tests (Cloud Functions)

Gen 2 triggers are awkward to unit-test in isolation. Testing them **through the emulator**
is both simpler and more realistic: write a document with the Admin SDK, then wait for the
trigger's effect.

> ⚠️ **What was actually built differs from the sketch below, deliberately.** The suite in
> `firebase/tests/integration/` writes as a **real client SDK app holding a real ID token from
> the Auth emulator**, and reaches for privilege only through `@firebase/rules-unit-testing`'s
> `withSecurityRulesDisabled`.
>
> An admin-SDK harness bypasses Rules entirely, and the claims worth making here are precisely
> the ones that need Rules in the loop: that a client's write to `balanceMinor` is _refused_
> and the Function-computed value survives it (Article III), and that holding a real invite id
> handed back by `createInvite` still buys a client nothing on `invites/{id}`. Those are
> pipeline claims, not rule claims — a rules test can only deny a made-up id. Privileged
> access is still there for setup and for polling, which is all the sketch used it for.
>
> 🔴 **Do not run `emulators:exec` for this directly.** Function discovery has a 10s budget and
> the cold import is 65s on Windows; it fails with
> `Cannot determine backend specification. Timeout after 10000` and then **runs the tests
> anyway** against zero registered functions, so every test dies on its own `waitFor` and it
> reads as broken tests rather than a missing backend. Go through
> `scripts/test-integration.mjs`, which raises the budget to 120s and rebuilds the esbuild
> bundle first — `pnpm build` overwrites it with a tsc version that cannot resolve
> `@splitsutra/core` at runtime.

```ts
// firebase/tests/integration/setup.ts
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';

import { initializeApp } from 'firebase-admin/app';
initializeApp({ projectId: 'demo-integration' });

/** Poll until `check` passes or we time out. Triggers take 1–3s in the emulator. */
export async function waitFor<T>(
  fn: () => Promise<T>,
  check: (v: T) => boolean,
  { timeout = 20_000, interval = 250 } = {},
): Promise<T> {
  const deadline = Date.now() + timeout;
  let last: T;
  while (Date.now() < deadline) {
    last = await fn();
    if (check(last)) return last;
    await new Promise((r) => setTimeout(r, interval));
  }
  throw new Error(`waitFor timed out. Last value: ${JSON.stringify(last!)}`);
}
```

```ts
// firebase/tests/integration/balances.test.ts
test('onExpenseWritten recomputes balances and holds zero-sum', async () => {
  await db.doc('groups/g1/expenses/e1').set(
    makeExpense({
      amountMinor: 3000,
      paidBy: [{ uid: 'alice', amountMinor: 3000 }],
      splits: [
        { uid: 'alice', amountMinor: 1000, rawValue: null },
        { uid: 'bob', amountMinor: 1000, rawValue: null },
        { uid: 'carol', amountMinor: 1000, rawValue: null },
      ],
    }),
  );

  const members = await waitFor(
    () => db.collection('groups/g1/members').get(),
    (s) => s.docs.some((d) => d.data().balanceMinor !== 0),
  );

  const byUid = Object.fromEntries(members.docs.map((d) => [d.id, d.data().balanceMinor]));
  expect(byUid.alice).toBe(2000);
  expect(byUid.bob).toBe(-1000);
  expect(byUid.carol).toBe(-1000);
  expect(byUid.alice + byUid.bob + byUid.carol).toBe(0);
});

test('recompute is idempotent', async () => {
  // touch the doc again; balances must be identical, not doubled
});
```

⚠️ **Never use a fixed `sleep()` to wait for a trigger.** It's flaky when CI is slow and
wasteful when it's fast. `waitFor` with a real assertion is the only reliable pattern.

---

## 5. Emulator lifecycle

Wrap test commands in `firebase emulators:exec`. It starts the emulators, runs the
command, and tears down cleanly — including on failure, which a manual start/stop in
`globalSetup` frequently gets wrong in CI.

```jsonc
// package.json (root)
{
  "scripts": {
    "test": "pnpm test:unit && pnpm test:rules && pnpm test:integration",
    "test:unit": "vitest run --project unit --project component",
    "test:watch": "vitest --project unit",
    "test:coverage": "vitest run --project unit --coverage",

    "test:rules": "firebase emulators:exec --only firestore --project demo-rules 'vitest run --project rules'",
    "test:integration": "firebase emulators:exec --only firestore,auth,functions --project demo-integration 'vitest run --project integration'",

    "test:e2e": "playwright test",
    "test:e2e:ui": "playwright test --ui",

    "typecheck": "tsc --noEmit -b",
    "lint": "eslint .",
    "depcruise": "depcruise packages apps firebase/functions",

    "verify": "pnpm typecheck && pnpm lint && pnpm depcruise && pnpm test:unit",
  },
}
```

`pnpm verify` is the fast gate every phase ends on (no emulator needed).
`pnpm test` is the full local run.

---

## 6. Playwright

```ts
// playwright.config.ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e/specs',
  globalSetup: './e2e/global-setup.ts',
  timeout: 30_000,
  fullyParallel: false, // one shared emulator
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['html'], ['github']] : 'list',
  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'on-first-retry', // traces are how you debug CI-only failures
    video: 'retain-on-failure',
  },
  projects: [
    { name: 'mobile', use: { ...devices['Pixel 7'] } }, // NFR-3: the real target
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'pnpm --filter web dev',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: !process.env.CI,
    env: { VITE_USE_EMULATORS: 'true' },
  },
});
```

> **Run the `mobile` project first.** The phone viewport is the design target
> ([07-ui-ux-spec.md](07-ui-ux-spec.md)); desktop is the secondary case.

### Auth in E2E — don't drive the widget

Signing in through FirebaseUI in every test is slow and couples unrelated tests to the auth
UI. Create users directly against the **Auth emulator REST API** and reuse a saved session:

```ts
// e2e/fixtures/auth.ts
const AUTH = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1';

export async function createTestUser(email: string, password: string) {
  const res = await fetch(`${AUTH}/accounts:signUp?key=fake-api-key`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  return res.json(); // { idToken, refreshToken, localId }
}
```

Then seed `localStorage` with the Firebase session and save it as a Playwright
`storageState`, so every spec starts signed in.

**Exception: E1 (sign-up) must drive the real widget** — it's the one test whose subject
_is_ the auth UI.

`e2e/global-setup.ts` should: wait for the emulators, clear Firestore, run the seed script,
and create the E2E users.

### Accessibility, folded into E2E

```ts
import AxeBuilder from '@axe-core/playwright';

test('groups screen has no critical a11y violations', async ({ page }) => {
  await page.goto('/groups');
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(violations.filter((v) => v.impact === 'critical')).toEqual([]);
});
```

And the NFR-3 guard, which catches a whole class of layout regressions in one line:

```ts
test('no horizontal scroll at 390px', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/groups');
  const overflows = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflows).toBe(false);
});
```

---

## 7. Component tests — deliberately sparse

Per [09-testing.md](09-testing.md), we under-invest here on purpose. Write a component test
only when the component has **real logic**:

- `<AmountInput>` — parses to minor units, rejects excess decimals, handles `"1,234.5"`
- `<Money>` — formats and colours correctly per currency and sign
- The **split sheet** — the live "left to assign" indicator and the save guard
- `<AdSlot>` — reserves height when empty (Article XIV)

Everything else is covered better by E2E.

```ts
// apps/web/src/test-setup.ts
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
afterEach(cleanup);
```

---

## 8. Static analysis

```js
// .dependency-cruiser.cjs — the rules that protect the mobile port
forbidden: [
  {
    name: 'core-is-platform-agnostic', // NFR-10, Article II
    severity: 'error',
    from: { path: '^packages/core' },
    to: { path: 'react-dom|react-native|^packages/core/.*\\bdom\\b' },
  },
  {
    name: 'domain-is-pure', // Article VII
    severity: 'error',
    from: { path: '^packages/core/src/domain' },
    to: { path: '^(firebase|react)' },
  },
  {
    name: 'screens-never-touch-firestore', // Article VIII
    severity: 'error',
    from: { path: '^apps/web/src/screens' },
    to: { path: '^firebase/firestore' },
  },
  {
    name: 'firebaseui-is-quarantined', // ADR-03
    severity: 'error',
    from: { pathNot: '^apps/web/src/auth' },
    to: { path: '^(firebaseui|firebase/compat)' },
  },
];
```

🔴 **Prove each rule fails.** Write a deliberately violating file, confirm CI goes red,
then delete it. An unverified guard rail is not a guard rail — and these four are the ones
standing between you and a painful Phase 12.

---

## 9. CI wiring

```yaml
- uses: actions/setup-java@v4 # REQUIRED — the emulators are Java processes
  with: { distribution: temurin, java-version: 21 }

- run: pnpm install --frozen-lockfile
- run: pnpm typecheck # ~40s
- run: pnpm lint
- run: pnpm depcruise
- run: pnpm test:unit --coverage # enforces 100% branch on domain/
- run: pnpm test:rules # emulator
- run: pnpm test:integration # emulator
- run: pnpm build
- run: pnpm test:e2e # slowest, last

- uses: actions/upload-artifact@v4
  if: failure()
  with:
    name: test-artifacts
    path: |
      playwright-report/
      coverage/
```

Cheap-to-expensive ordering means a type error fails in under a minute instead of after a
six-minute E2E run.

⚠️ Cache the Playwright browser download (`~/.cache/ms-playwright`) or it re-downloads
~400 MB on every run.

---

## 10. Flakiness policy

Emulator-backed suites go flaky if you let them. Rules:

1. **Never `sleep()` for a trigger** — use `waitFor` with a real assertion.
2. **Always `clearFirestore()` in `beforeEach`**, never rely on test ordering.
3. **No shared mutable module state** between test files.
4. **Deterministic factories** — seeded sequences, fixed timestamps, no `Date.now()` or
   `Math.random()` in assertions.
5. **A quarantined flaky test is a bug ticket, not a solution.** `test.skip` with a TODO
   and no owner is how suites die.
6. Playwright `retries: 2` in CI **only** — locally, a flake should fail loudly so you fix it.
