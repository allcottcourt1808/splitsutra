# Project Constitution

Non-negotiable principles for this codebase. Every PR, every AI-generated change, and
every review is checked against these.

The idea is borrowed from [GitHub Spec Kit](https://github.com/github/spec-kit) — see
[docs/13-spec-kit.md](docs/13-spec-kit.md). It works whether or not you adopt the rest of
that toolchain: it gives an agent (or a future you) a short, stable set of rules to
re-check against, instead of re-deriving intent from thousands of lines of docs.

**If a change violates an article below, the change is wrong — not the article.**
Amending an article is allowed, but it must be a deliberate, recorded decision in
[docs/12-decisions.md](docs/12-decisions.md), not an incidental exception.

---

## Article I — Money is never a float

All monetary values are integers in minor units, carrying the branded `MinorUnits` type.
No `parseFloat`. No division producing a fractional currency amount outside the allocator.

**Test of compliance:** every split of every amount sums to the total _exactly_, and every
group's balances sum to exactly zero.

**Why:** `0.1 + 0.2 !== 0.3`. In this product that becomes a group that can never settle
up, and a user who cannot be told why.

## Article II — `packages/core` is platform-agnostic

Core imports no DOM, no `react-dom`, no `react-native`, no `window`, no `document`, no
`localStorage`. Platform capabilities arrive through an injected `PlatformAdapter`.

**Test of compliance:** `pnpm depcruise` passes, and `core` compiles with `"lib": ["ES2022"]`
and no `"DOM"`.

**Why:** this single boundary is the entire reason the mobile app is a port and not a rewrite.

## Article III — The server owns the truth about balances

Balances are computed by Cloud Functions and are read-only to clients. Security Rules deny
all client writes to any `balanceMinor` field. Clients may compute optimistic balances for
display; those are never persisted.

**Why:** a client that can write its own balance can erase its own debt.

## Article IV — Security Rules are the boundary, not the UI

Every invariant that matters is enforced in Security Rules or a Cloud Function, regardless
of what the client validates. Client-side validation exists for UX only.

**Test of compliance:** for every `allow` in `firestore.rules`, there is one test that
passes and one that fails.

**Why:** the Firebase config is public and the REST API is open. The UI is not a
security control.

## Article V — The ledger is the truth; balances are a cache

Expenses and settlements are the source of truth. Every derived value must be rebuildable
from them at any time. Nothing is hard-deleted; soft-delete preserves the audit trail.

**Why:** derived state that cannot be recomputed becomes permanently wrong the first time
anything goes sideways.

## Article VI — One implementation of the money math

The split engine and balance computation exist once, in `core/src/domain/`, imported by
both the client and Cloud Functions. A second implementation — even a "quick" one for
validation, previews, or a rule — is forbidden.

**Why:** two implementations diverge. When they do, the bug is invisible until someone's
balance is wrong.

## Article VII — Domain logic is pure

Everything in `core/src/domain/` is a pure function: no I/O, no Firebase, no React, no
clock, no randomness that isn't seeded from stored data.

**Why:** purity is what makes 100% branch coverage and property-based testing achievable
on the part of the system that must be perfect.

## Article VIII — Screens never touch Firestore

All data access goes through `core/src/repositories`. A screen importing `firebase/firestore`
is a bug: it means logic escaped the portable layer.

## Article IX — Mobile-first, flexbox-only, tokens-only

Layout uses flexbox exclusively. No hard-coded colours, spacing, radii, or font sizes
outside `tokens.ts`. Touch targets are at least 44×44. No hover-only affordances.

**Why:** each of these is a thing Yoga (React Native's layout engine) cannot do, or a
thing a phone cannot do.

## Article X — Tests before UI for anything that computes

For any feature involving money, the pure functions and their tests are written and green
_before_ the screen that uses them.

**Why:** debugging allocation arithmetic through a form is dramatically slower than
debugging it through a failing unit test.

## Article XI — Cost has a ceiling

Every Cloud Function sets `maxInstances`. Every project has a budget alert. No function
writes back to its own trigger path without a diff guard.

**Why:** Blaze has no hard spending cap, and a trigger loop is a bill, not an error.

## Article XII — Measure before optimising

Performance and cost optimisations (per-user feed collections, incremental balance deltas,
list virtualisation) require a measurement first. Anticipated bottlenecks are recorded as
open questions, not pre-emptively engineered.

**Why:** the naive version is usually fine, and the optimised version is usually the one
with the correctness bug.

## Article XIII — Only one enum leaves the app for advertising

An ad request may carry **one category string from a fixed enum** and nothing else. The
enum value may be derived from the user's own aggregate spending — their top category over
a rolling window — or from the screen they are currently on.

It may **never** carry an amount, a merchant, a balance, a group name, a counterparty, a
date, or any user identifier. The derived category is computed **on-device and never
persisted server-side**.

Four hard limits on the derivation:

1. **Sensitive categories are excluded from the enum entirely** — anything health-,
   medical-, or hardship-adjacent. Inferring those crosses into special-category data.
2. **Minimum evidence:** no category is inferred from fewer than 10 expenses over 30 days.
   Below that, the value is `general`.
3. **Opt-in and revocable**, surfaced in Account settings, defaulting to off.
4. Declining changes nothing about how the app works.

**Test of compliance:** a unit test asserting the ad request payload contains exactly one
value, and that it is a member of the enum.

**Why:** one coarse enum is what Google's ad policies permit and what keeps this out of
GDPR's profiling regime. A money app that ships transaction detail to advertisers loses the
trust the product runs on. See [docs/14-monetization-ads.md](docs/14-monetization-ads.md).

## Article XIV — Ads never touch the money flows

No ad appears in Add Expense, the split sheet, or Settle Up. No user action ever blocks on
an ad loading. Every ad slot reserves its height so nothing shifts. Minimum 48dp between
an ad and any control.

**Why:** interrupting someone mid-amount-entry is how you lose them — and accidental
clicks next to a Save button are an AdMob invalid-traffic violation that costs you the
revenue anyway.

---

## Amendment log

| Date | Article | Change           | Reason |
| ---- | ------- | ---------------- | ------ |
| —    | —       | Initial adoption | —      |
