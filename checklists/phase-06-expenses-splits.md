# Phase 06 — Expenses & The Split Engine

**Est. 4 days.** Depends on 05. **The most important phase in the project.**
Covers **Epic D**. Reference: [../docs/04-split-engine.md](../docs/04-split-engine.md)

> Build §1 completely, with its tests green, **before writing a single line of UI.** The
> split engine is pure and testable in isolation; debugging money math through a form is
> misery. This ordering is the main reason this phase is 4 days and not 8.

---

## 1. 🔴 Domain layer — money & splits (pure, no Firebase, no React)

### Money

- [ ] 🔴 `domain/money.ts`: branded `MinorUnits`, `toMinor`, `toMajor`
- [ ] 🔴 `CURRENCIES` table with `exponent` per currency
- [ ] 🔴 `parseAmount(input, currency)` — accepts `"1,234.5"`, rejects excess decimals,
      **throws rather than rounds**
- [ ] 🔴 `formatAmount(minor, currency)` via `Intl.NumberFormat`
- [ ] 🔴 `MAX_AMOUNT_MINOR = 1_000_000_000`, enforced at every entry point
      (keeps `amount × weight` inside `MAX_SAFE_INTEGER` — see the doc's derivation)
- [ ] 🔴 ESLint rule banning `parseFloat` in `domain/` (NFR-8)

### The allocator

- [ ] 🔴 `domain/allocate.ts` — **one** function all four split methods funnel into:
      `allocate(total, weights, tieBreakSeed)`
- [ ] 🔴 Largest-remainder method: floors, remainders, distribute leftover units
- [ ] 🔴 Deterministic tie-break on ascending uid
- [ ] 🔴 Guarantee: output sums to `total` **exactly**, all non-negative integers

### The four methods

- [ ] 🔴 `splitEqual` — base + remainder, rotation seeded by `expenseId` so the extra
      cent moves around instead of always taxing the same person
- [ ] 🔴 `splitExact` — validation only, no computation, no auto-adjusting the last person
- [ ] 🔴 `splitPercent` — **basis points as integers**, must total exactly 10000
- [ ] 🔴 `splitShares` — non-negative integer shares, at least one > 0

### Balances

- [ ] 🔴 `domain/balances.ts` → `computeBalances({ expenses, settlements, memberIds })`
- [ ] 🔴 Sign convention: **positive = owed to them**
- [ ] 🔴 `assertZeroSum(balances)` — throws on violation

### Tests 🔴 _Non-negotiable, and the highest-value work in the project_

- [ ] 🔴 Property: `allocate` output always sums to total, for random inputs
- [ ] 🔴 Property: all outputs are non-negative integers
- [ ] 🔴 Property: same input → same output (determinism)
- [ ] 🔴 Property: **balances always sum to zero** over random ledgers
- [ ] 🔴 Unit: $100/3 → `3334, 3333, 3333`
- [ ] 🔴 Unit: $10 at 33.33/33.33/33.34% → `333, 333, 334`
- [ ] 🔴 Unit: $100 at 2:1:1 → `5000, 2500, 2500`
- [ ] 🔴 Unit: equal-split rotation differs across `expenseId`s
- [ ] 🔴 Unit: percentages not totalling 100% throw
- [ ] 🔴 Unit: `parseAmount("1.234")` with exponent 2 throws
- [ ] 🔴 Unit: `MAX_AMOUNT_MINOR + 1` rejected
- [ ] 🔴 **100% branch coverage on `domain/`**, gated in CI

## 2. Expense data layer

- [ ] 🔴 `expenseRepo.ts`: `createExpense`, `updateExpense`, `softDeleteExpense`,
      `watchGroupExpenses`, `watchExpense`
- [ ] 🔴 Client-side validation mirrors the rules exactly (all 7 invariants from the
      data model doc)
- [ ] 🔴 Store `participantIds` denormalized, `rawValue` preserved for re-editing
- [ ] 🔴 Indexes: `expenses` → `deletedAt` ASC + `date` DESC
- [ ] 🟡 Collection-group index for `participantIds` ARRAY + `date` DESC
- [ ] 🟡 ⚠️ `watchMyExpenses` **must** include `where('participantIds','array-contains',uid)`
      or the collection-group rule rejects the whole query (threat T9). Bake it into the
      repository so a screen cannot get it wrong.

## 3. Security rules 🔴 _Resolve open question Q1 first_

- [ ] 🔴 **Decide Q1** (how rules validate that splits sum to the total) — see
      [../docs/05-security-rules.md](../docs/05-security-rules.md). Recommendation: Option A.
- [ ] 🔴 If Option A: add `splitsTotalMinor` + `paidTotalMinor` to the schema; rules assert
      they equal `amountMinor`
- [ ] 🔴 Rules: `amountMinor` is a positive int within bounds
- [ ] 🔴 Rules: `currency == group.currency`
- [ ] 🔴 Rules: description length 1–100
- [ ] 🔴 Rules: `createdBy == auth.uid`, `createdAt == request.time` (threat T7)
- [ ] 🔴 Rules: update cannot change `createdBy`, `createdAt`, `groupId`, `currency`
- [ ] 🔴 ⚠️ **Rules: update/soft-delete requires `resource.data.createdBy == auth.uid ||
isAdmin(gid)`** (ADR-11, threat T11). This overrides the earlier permissive model.
- [ ] 🔴 Rules: `isCurrencyCode()` is a shallow shape check (`^[A-Z]{3}$`) — 180 ISO codes
      can't be enumerated in a rule. The **Function** validates against the real ISO table,
      same two-layer shape as the split-sum check
- [ ] 🔴 Rules: `delete: false` — soft delete via update only
- [ ] 🔴 Rules: the collection-group `{path=**}/expenses` block (threat T9)
- [ ] 🔴 Rules: split uids must be current members (threat T6)

## 4. Cloud Functions

- [ ] 🔴 `onExpenseWritten` — verify integrity, `recomputeBalances(gid)`, write activity
- [ ] 🔴 ⚠️ **Function-side verification of the real split sum** — this is what makes
      Option A safe rather than theatre. Quarantine or reject documents that disagree.
- [ ] 🔴 `recomputeBalances` runs in a transaction and calls the **same** `computeBalances`
      from `@splitsutra/core`. Never write a second implementation.
- [ ] 🔴 `assertZeroSum` before writing — fail loudly rather than persist bad balances
- [ ] 🔴 Idempotent: firing the trigger twice yields identical balances
- [ ] 🔴 `maxInstances` set
- [ ] 🟡 `RECOMPUTE_THRESHOLD` guard (Q2) for very large groups
- [ ] 🟡 `recomputeGroupBalances` callable — the manual repair valve

## 5. Add Expense screen 🔴 _The screen the product lives or dies on_

- [ ] 🔴 `/expense/new` per the wireframe in the UI spec
- [ ] 🔴 **Amount autofocused, numeric keypad, `<AmountInput>` outputting minor units**
- [ ] 🔴 Defaults: payer = you, split = equally, date = today, group = context
- [ ] 🔴 Target: **an expense addable in 3 taps**
- [ ] 🔴 Description (1–100), date picker (not >1 day future), category chips
- [ ] 🟡 "Paid by" sheet — single payer, plus a multiple-payers mode (AC-D1.4)
- [ ] 🟡 Multiple payers must sum to the total, with the same live-remainder UI
- [ ] 🟡 Optimistic write — do not block the UI on the network
- [ ] 🟡 Inline validation errors, never alerts

## 6. Split sheet

- [ ] 🔴 Segmented control: Equally | Exactly | Percentages | Shares
- [ ] 🔴 **Preview amounts come from the real split engine**, including remainder
      distribution — the preview must equal what gets stored
- [ ] 🔴 Live footer per method; save blocked unless remaining is exactly 0
      (AC-D2.2, AC-D2.3)
- [ ] 🔴 Switching methods preserves participants and total (AC-D2.5)
- [ ] 🟡 Equally: per-member checkboxes, "$X per person"
- [ ] 🟡 Exactly: amount inputs, "$X left to assign" in red when non-zero
- [ ] 🟡 Percentages: percent inputs, "N% remaining"
- [ ] 🟡 Shares: steppers, "4 shares · A pays $1,500.00"
- [ ] 🟡 Zero-share participants stay listed (AC-D2.6)

## 7. Expense list, detail, edit, delete

- [ ] 🔴 Group expense list, month-grouped, newest first, 25/page infinite scroll
- [ ] 🔴 Row shows "you paid $X" / "you owe $Y" from the current user's perspective
- [ ] 🟡 `/expense/:gid/:eid` — full breakdown: payers, per-person splits, meta
- [ ] 🟡 `/expense/:gid/:eid/edit` — prefilled from `rawValue` so percentages restore as
      typed
- [ ] 🔴 ⚠️ **Edit is creator-or-admin only** (ADR-11). Everyone else sees **Discuss**,
      opening the thread with the composer focused. Empty-thread copy explains the rule:
      _"Something look wrong? Start a discussion — only Priya or a group admin can edit
      this expense."_
- [ ] 🔴 Edit recalculates for the **union** of old and new participants (AC-D3.2)
- [ ] 🟡 Soft delete with a 5-second undo toast before the write commits (AC-D3.3)

## 8. Tests

- [ ] 🔴 Rules: splits not summing to total rejected (T3)
- [ ] 🔴 Rules: split naming a non-member rejected (T6)
- [ ] 🔴 Rules: forged `createdBy` rejected (T7)
- [ ] 🔴 Rules: collection-group query without the `participantIds` filter rejected (T9)
- [ ] 🔴 Rules: positive — a member can create a valid expense
- [ ] 🔴 Integration: `onExpenseWritten` produces the expected balances
- [ ] 🔴 Integration: firing the trigger twice is idempotent
- [ ] 🟡 E2E **E3**: equal split → both users see correct balances
- [ ] 🟡 E2E **E4**: exact split → invalid save blocked by the remainder guard
- [ ] 🟡 E2E **E5**: percent and shares produce exactly the previewed amounts
- [ ] 🟡 E2E **E8**: edit then soft-delete → balances reverse correctly

---

## Exit criteria

- [ ] All four split methods produce amounts summing **exactly** to the total, always
- [ ] 100% branch coverage on `domain/`, property tests green
- [ ] Two users adding expenses see identical, correct balances
- [ ] The zero-sum invariant holds across every test scenario
- [ ] Editing and soft-deleting reverse balances correctly
- [ ] All Phase 06 rules tests pass, denials and positives
- [ ] `pnpm verify` green
