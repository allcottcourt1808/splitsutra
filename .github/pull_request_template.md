# What & why

<!-- One or two sentences. Link the requirement / AC / threat ID if there is one. -->

Closes #

## Constitution check

<!--
CONSTITUTION.md — if a change violates an article, the change is wrong, not the article.
Amending an article is allowed, but it must be a recorded decision in docs/12-decisions.md.
Tick only what this PR actually touches; delete the rest.
-->

- [ ] **I — Money is never a float.** Integer minor units, branded `MinorUnits`, no `parseFloat`. Every split sums to the total exactly; every group's balances sum to exactly zero.
- [ ] **II — `packages/core` is platform-agnostic.** No DOM, no `react-dom`, no `react-native`, no `window`/`document`/`localStorage`. `pnpm depcruise` passes.
- [ ] **III/V — The server owns balances; the ledger is the truth.** No client writes a `balanceMinor`. Nothing is hard-deleted.
- [ ] **IV — Security Rules are the boundary.** For every `allow` touched, one test that passes and one that fails.
- [ ] **VI — One implementation of the money math.** No second copy of the split engine, not even for a preview or a rule.
- [ ] **VII — Domain logic is pure.** No I/O, no clock, no unseeded randomness in `core/src/domain/`.
- [ ] **VIII — Screens never touch Firestore.** All data access via `core/src/repositories`.
- [ ] **IX — Mobile-first, flexbox-only, tokens-only.** No CSS Grid, no hard-coded colours/spacing/radii/font sizes, touch targets ≥ 44×44, no hover-only affordances.
- [ ] **X — Tests before UI for anything that computes.** The pure functions were green before the screen.
- [ ] **XI — Cost has a ceiling.** Every new Function sets `maxInstances` and has a diff guard if it writes back to its own trigger path.
- [ ] **XIII/XIV — Ads.** One enum value, nothing else, on-device only; no ad in Add Expense, the split sheet, or Settle Up.

## Verification

- [ ] `pnpm verify` passes locally (`typecheck && lint && depcruise && test:unit`)
- [ ] New tests carry their requirement ID in the name — `test('AC-D2.3: ...')`, `test('T5: ...')`
- [ ] CI is green (advisory until v1.0 — but a red `main` is a same-day fix)

## ⚠️ Security Rules changed?

<!-- Delete this whole section if firestore.rules is untouched. -->

**Firestore rules have no rollback. None.** A bad deploy locks every user out of their own
data and can only be undone by deploying corrected rules. This needs explicit sign-off,
separate from ordinary code review.

- [ ] `pnpm test:rules` passes, with a passing _and_ a failing test for every `allow` touched
- [ ] The threat table in `docs/05-security-rules.md` is still accurate
- [ ] I have read the diff line by line, not just the test result

## Screenshots / preview

<!-- Mobile viewport (390px) first — that is the design target. Preview channel URL if there is one. -->
