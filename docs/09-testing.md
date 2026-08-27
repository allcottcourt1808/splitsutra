# 09 — Testing Strategy

> **This document is the _what and why_.** For the concrete setup — packages, config files,
> directory layout, harnesses, scripts, CI wiring — see
> [16-testing-setup.md](16-testing-setup.md), executed in
> [../checklists/phase-02b-testing-setup.md](../checklists/phase-02b-testing-setup.md).

## Where to spend effort

This app has an unusual risk profile: **the money math must be perfect, and the security
rules must be airtight.** Everything else is ordinary CRUD UI. Test budget follows that.

```
        ╱╲          E2E (Playwright) — ~8 journeys
       ╱  ╲
      ╱────╲        Rules tests — one per threat + one per allow   ◄── high value
     ╱      ╲
    ╱────────╲      Integration (emulator + repositories)
   ╱          ╲
  ╱────────────╲    Unit + property tests on domain/               ◄── highest value
 ╱──────────────╲
```

The two shaded layers are where bugs are expensive. Deliberately **under-invest** in
component snapshot tests — they mostly test React, not this product.

---

## 1. Domain unit + property tests (Vitest + fast-check)

Target: `packages/core/src/domain/` — pure functions, no emulator, milliseconds to run.

**Coverage requirement: 100% branch coverage on `domain/`.** This is the one place a
coverage gate is worth enforcing.

The full table of required tests is in [04-split-engine.md](04-split-engine.md) §5. The
three that matter most:

```ts
// The single most valuable test in the project
test.prop([arbitraryGroupLedger()])('balances always sum to zero', (ledger) => {
  const balances = computeBalances(ledger);
  expect(sum(Object.values(balances))).toBe(0);
});

test.prop([fc.integer({ min: 0, max: 1e9 }), arbitraryWeights()])(
  'allocation is exact',
  (total, weights) => {
    const out = allocate(total, weights, 'seed');
    expect(sum(out.map((o) => o.amountMinor))).toBe(total);
    out.forEach((o) => expect(Number.isInteger(o.amountMinor)).toBe(true));
  },
);

test.prop([arbitraryBalances()])('simplifyDebts settles everyone', (balances) => {
  const payments = simplifyDebts(balances);
  expect(payments.length).toBeLessThanOrEqual(balances.length - 1);
  expect(applyPayments(balances, payments).every((b) => b.balanceMinor === 0)).toBe(true);
});
```

Property tests generate thousands of cases including the awkward ones ($0.01 split 7 ways,
33.33% thrice, a single participant, zero shares) that nobody thinks to write by hand.

---

## 2. Security Rules tests (`@firebase/rules-unit-testing`)

Requires Java + the Firestore emulator.

**Rule: for every `allow` in `firestore.rules`, write one test that passes and one that
fails.** A rules suite with only happy paths is worthless.

```ts
// firebase/tests/rules/setup.ts
const testEnv = await initializeTestEnvironment({
  projectId: 'demo-splitsutra',
  firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
});
const alice = testEnv.authenticatedContext('alice').firestore();
const outsider = testEnv.authenticatedContext('mallory').firestore();
const anon = testEnv.unauthenticatedContext().firestore();
```

Required denial tests — one per threat in [05-security-rules.md](05-security-rules.md):

| Test | Asserts                                                                     |
| ---- | --------------------------------------------------------------------------- |
| T1   | Non-member `get` on a group and its expenses fails                          |
| T2   | Member writing `balanceMinor` on their own member doc fails                 |
| T3   | Expense whose splits ≠ total fails                                          |
| T4   | Client adding itself to `members` fails                                     |
| T5   | `list` on `usernames` fails                                                 |
| T6   | Split naming a non-member fails                                             |
| T7   | Expense with a forged `createdBy` fails                                     |
| T8   | Any client write to `activity` fails                                        |
| T9   | Collection-group `expenses` query without the `participantIds` filter fails |
| T10  | Updating `group.currency` fails                                             |
| T11  | Non-creator, non-admin editing an expense fails                             |
| T12  | Editing any comment fails                                                   |
| —    | Unauthenticated read of anything fails                                      |

Plus positive tests: a member _can_ create a valid expense, read the group, comment, and
delete their own comment.

Use `testEnv.withSecurityRulesDisabled()` to seed fixtures, so setup isn't fighting the
rules you're testing.

---

## 3. Integration tests (emulator + repositories)

Target: `packages/core/src/repositories/` and the Cloud Functions.

- Repository functions round-trip correctly against the emulator.
- **`onExpenseWritten` recomputes balances to the expected values** — the highest-value
  integration test.
- Recompute is **idempotent**: firing the trigger twice yields identical balances.
- `redeemInvite` is idempotent, rejects expired/used tokens, and enforces the member cap.
- `addFriend` writes both sides reciprocally in one transaction.
- `leaveGroup` refuses with a non-zero balance and succeeds at zero.
- `deleteAccount` refuses when balances are outstanding.

Run with `firebase emulators:exec --only firestore,auth,functions 'vitest run integration'`.

---

## 4. E2E journeys (Playwright, against emulators)

Eight journeys, no more. Each is slow, so each must earn its place.

| #   | Journey                                                                        |
| --- | ------------------------------------------------------------------------------ |
| E1  | Sign up with email → profile created → lands on Groups                         |
| E2  | Create group → add member by invite link → member appears                      |
| E3  | Add an equal-split expense → both users see correct balances                   |
| E4  | Add an exact-split expense → the "left to assign" guard blocks an invalid save |
| E5  | Percentage and shares splits produce the amounts the preview showed            |
| E6  | Settle up → balance goes to zero → activity feed shows it                      |
| E7  | Debt simplification suggests ≤ n−1 payments; applying them zeroes the group    |
| E8  | Edit then soft-delete an expense → balances reverse correctly                  |

Auth in E2E: use the **Auth emulator** and its test phone numbers, or sign in
programmatically via the emulator REST API to skip the FirebaseUI widget in tests that
aren't about auth. Only E1 should drive the widget itself.

Also assert in E2E:

- No horizontal scroll at 390×844 (NFR-3).
- `axe-core` finds no critical violations (NFR-5).
- One full keyboard-only journey (NFR-6).

---

## 5. Static checks in CI

| Check           | Tool                                     | Enforces                                                           |
| --------------- | ---------------------------------------- | ------------------------------------------------------------------ |
| Types           | `tsc --noEmit`, `strict: true`           | —                                                                  |
| Lint            | ESLint + `@typescript-eslint`            | —                                                                  |
| **Core purity** | `dependency-cruiser`                     | **NFR-10** — `core` must not import `react-dom`/DOM/`react-native` |
| No float money  | custom ESLint rule                       | NFR-8 — bans `parseFloat` and `/` in `domain/money` paths          |
| Bundle size     | `rollup-plugin-visualizer` + size budget | NFR-2 (350 KB gz)                                                  |
| Secrets         | `gitleaks` pre-commit                    | NFR-7                                                              |
| Perf            | Lighthouse CI                            | NFR-1                                                              |

The dependency-cruiser rule is the one that silently saves Phase 12. Without it, a single
`import { something } from 'react-dom'` in a shared hook goes unnoticed for months.

---

## Manual test checklist (pre-release)

Automation can't catch these:

- [ ] Real SMS OTP on a real phone (emulator test numbers don't exercise the real path)
- [ ] Google sign-in on a real device
- [ ] Account linking: sign in by email, then Google with the same address → one account
- [ ] iOS Safari: viewport, safe-area insets, no rubber-band jank
- [ ] Android Chrome: back button behaviour through modals
- [ ] Airplane mode: reads work from cache, writes queue and flush on reconnect
- [ ] Two devices side by side: add an expense on A, see it on B within 5s
- [ ] Deep link to `/invite/:token` while logged out, then after signing in
- [ ] Large group (10+ members) split-sheet usability
- [ ] Currency formatting for each supported currency
