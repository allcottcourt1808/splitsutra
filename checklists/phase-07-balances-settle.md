# Phase 07 — Balances, Settle Up & Debt Simplification

**Est. 2.5 days.** Depends on 06.
Covers **Epic E**. Reference: [../docs/04-split-engine.md](../docs/04-split-engine.md) §4

> **Status 2026-08-31 — shipped; the boxes below lag the code.** `simplify.ts` is in
> `packages/core/src/domain/` under the same 100% branch-coverage gate as the rest of the money
> math, and `GroupBalancesScreen` / `SettleUpScreen` are live. **ADR-12** then amended AC-E3.3 so
> simplification is **on by default for new groups** — the default lives in `createGroup`, not in
> `groupSchema`, because the schema also decodes stored documents and a default there would
> silently opt every existing group in.
>
> Two things worth knowing before re-reading this phase:
>
> 1. 🔴 **"Instead of N payments" was removed rather than fixed.** The claim compared
>    `transfers.length` against the number of people who owe money — but every debtor must
>    discharge their own balance, so `transfers.length >= owing` is an **identity**, and the
>    comparison could never show a saving. The honest number is the count of pairwise debts,
>    which docs/03 stores nowhere by design. Do not re-add the banner without that number.
> 2. 🟡 `SettleUpScreen` renders the member list **twice** — up to 99 rows for a 50-person group.
>    See checklists/phase-10-hardening.md §5b.

---

## 1. Debt simplification (pure domain)

- [ ] 🔴 `domain/simplify.ts` → `simplifyDebts(balances)` — greedy max-creditor /
      max-debtor from the doc
- [ ] 🔴 Deterministic tie-break on ascending uid, so the settle-up screen does not
      reshuffle between renders
- [ ] 🔴 Integer-only; no rounding anywhere
- [ ] 🔴 Property test: applying all payments zeroes every balance (AC-E3.2)
- [ ] 🔴 Property test: `payments.length <= n - 1` (AC-E3.1)
- [ ] 🔴 Property test: determinism
- [ ] 🔴 Unit: single debtor / single creditor; already-settled group returns `[]`
- [ ] 🟢 Document in code that this is a **heuristic, not the optimum** — the true minimum
      is NP-hard and Splitwise itself uses a heuristic. Do not let a future reader "fix" it.

## 2. Balance display

- [ ] 🔴 `useGroupBalances(gid)` — reads member docs, **never recomputes authoritatively**
- [ ] 🔴 `useOverallBalance()` — aggregates the already-fetched groups, **0 extra reads**
- [ ] 🔴 Per-currency lines, never summed across currencies (AC-B2.3)
- [ ] 🔴 Group list rows show the user's balance in each group
- [ ] 🔴 Home summary card: "you are owed $X" / "you owe $Y" (AC-E1.1)
- [ ] 🟡 "All settled up" zero state
- [ ] 🟡 Friend balances aggregated across all shared groups (AC-B2.2)
- [ ] 🟡 Optimistic local balance for instant feedback, overwritten by the server snapshot

## 3. `/groups/:gid/balances`

- [ ] 🟡 Tab 1 **Balances** — every member's net (AC-E1.2)
- [ ] 🟡 Tab 2 **Suggested payments** — simplified list
- [ ] 🟡 `simplifyDebts` toggle wired to the group setting (AC-E3.3). **New groups default it
      on** (ADR-12); the toggle turns it off.
- [ ] 🟡 ⚠️ **Inline explanation** (AC-E3.4): "Instead of 5 payments, settle up in 2.
      Amounts owed do not change." Without this, "why am I paying Carol when I borrowed
      from Bob?" becomes your most common support question. 🔴 **Load-bearing since ADR-12** —
      the default is on, so this sentence is the first thing standing between a new group and
      that question. It is not polish and it does not get trimmed.
- [ ] 🟡 Each suggested payment has a **Settle up** action that prefills the settle screen

## 4. Settlements — data & rules

- [ ] 🔴 `settlementRepo.ts`: `createSettlement`, `softDeleteSettlement`,
      `watchSettlements`
- [ ] 🔴 Rules: `amountMinor` positive int, `fromUid != toUid`, both current members,
      `currency == group.currency`, `createdBy == auth.uid`
- [ ] 🔴 Rules: `delete: false` — soft delete only
- [ ] 🔴 Rules: update cannot change `createdBy`, `createdAt`, `amountMinor`
- [ ] 🟡 Index: `settlements` → `deletedAt` ASC + `date` DESC

## 5. Settlements — Cloud Function

- [ ] 🔴 `onSettlementWritten` → same `recomputeBalances(gid)` path as expenses
- [ ] 🔴 Balance effect: `from += amount`, `to -= amount` (paying down a debt moves you
      toward zero)
- [ ] 🔴 Write the activity entry
- [ ] 🔴 Idempotent; `maxInstances` set

## 6. Settle Up screen

- [ ] 🔴 `/groups/:gid/settle` — from/to pickers prefilled from context
- [ ] 🔴 Amount prefilled with the outstanding debt, editable for partial payment (AC-E2.2)
- [ ] 🔴 ⚠️ **Explicit confirmation copy: "This records a payment you have already made
      outside the app. No money will move."** This prevents the single worst possible
      misunderstanding of the feature.
- [ ] 🟡 Optional note (0–200) and date
- [ ] 🟡 Validation: amount > 0, does not exceed the debt beyond tolerance (AC-E2.6)
- [ ] 🟡 Settlements render distinctly in the expense list (AC-E2.4)
- [ ] 🟡 Delete a settlement → balance reverses (AC-E2.5)

## 7. Tests

- [ ] 🔴 Property: simplification zeroes everyone, bounded by `n-1`, deterministic
- [ ] 🔴 Rules: settlement with `fromUid == toUid` rejected
- [ ] 🔴 Rules: negative or zero amount rejected
- [ ] 🔴 Rules: non-member cannot create a settlement
- [ ] 🔴 Integration: settlement recompute produces expected balances and holds zero-sum
- [ ] 🔴 Integration: deleting a settlement reverses it exactly
- [ ] 🟡 E2E **E6**: settle up → balance hits zero → appears in the activity feed
- [ ] 🟡 E2E **E7**: simplification suggests ≤ n−1 payments; applying them zeroes the group

---

## Exit criteria

- [ ] Balances are correct across a multi-member group with mixed split methods
- [ ] **`sum(balanceMinor) === 0` holds in every scenario tested** (AC-E1.3)
- [ ] Settling up drives a balance to exactly zero
- [ ] Partial settlements work
- [ ] Simplification produces ≤ n−1 payments that fully settle the group
- [ ] The simplification explanation is present and clear
- [ ] `pnpm verify` green
