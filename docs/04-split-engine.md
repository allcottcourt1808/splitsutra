# 04 — Split Engine, Money & Debt Simplification

> This is the correctness core of the product. Every function specified here lives in
> `packages/core/src/domain/`, is **pure** (no I/O, no Firebase, no React), and is unit
> tested exhaustively. If balances are ever wrong, the bug is in this document's
> implementation or in a caller that bypassed it.

---

## 1. Money representation

### The rule

**All money is a JavaScript `number` holding an integer count of minor units.**
Never a float. Never a decimal string in arithmetic.

`$125.50` is stored and computed as `12550`.

```ts
type Minor = number; // branded integer; see below

// packages/core/src/domain/money.ts
declare const MinorBrand: unique symbol;
export type MinorUnits = number & { readonly [MinorBrand]: true };
```

The brand makes it a type error to pass a raw float where minor units are expected. It
costs nothing at runtime and catches the class of bug that matters most here.

### Why not floats

`0.1 + 0.2 === 0.30000000000000004`. In an expense app that becomes a balance that never
reaches zero and a group that can never settle up. This is not theoretical — it is the
single most common bug in home-grown expense splitters.

### Why not `bigint` or decimal.js

`bigint` doesn't serialize to Firestore and adds friction everywhere. A decimal library
adds a dependency that must also work in React Native. Integers within
`Number.MAX_SAFE_INTEGER` are sufficient — see the bound below — and are the simplest
thing that is fully correct.

### Currency metadata — all of ISO 4217

The app supports **every ISO 4217 currency** (~180). Each group picks one at creation
(ADR-08). Default for new users: **USD**.

```ts
// packages/core/src/domain/currencies.ts
export const CURRENCIES = {
  USD: { code: 'USD', exponent: 2, name: 'US Dollar' },
  EUR: { code: 'EUR', exponent: 2, name: 'Euro' },
  GBP: { code: 'GBP', exponent: 2, name: 'British Pound' },
  INR: { code: 'INR', exponent: 2, name: 'Indian Rupee' },
  JPY: { code: 'JPY', exponent: 0, name: 'Japanese Yen' }, // ← 0
  KRW: { code: 'KRW', exponent: 0, name: 'South Korean Won' }, // ← 0
  KWD: { code: 'KWD', exponent: 3, name: 'Kuwaiti Dinar' }, // ← 3
  BHD: { code: 'BHD', exponent: 3, name: 'Bahraini Dinar' }, // ← 3
  // ... full ISO 4217 table
} as const;

export const COMMON_CURRENCIES = ['USD', 'EUR', 'GBP', 'INR', 'CAD', 'AUD', 'JPY', 'CNY'] as const;
```

`COMMON_CURRENCIES` pins the top of the picker; the rest is searchable
([07-ui-ux-spec.md](07-ui-ux-spec.md)).

### 🔴 The exponent table MUST be hardcoded

**Not every currency has 2 decimal places.** JPY and KRW have **0**; KWD, BHD, and TND
have **3**. The exponent is what tells you how to _interpret_ a stored integer — `12550`
is $125.50 in USD but ¥12,550 in JPY.

⚠️ **Never derive the exponent from `Intl.NumberFormat`.** It is tempting —
`resolvedOptions().minimumFractionDigits` returns the right answer in a browser — but ICU
data varies between JavaScript runtimes, and **Hermes on React Native is frequently built
with a trimmed ICU**. If the web app stores with exponent 2 and the mobile app reads with
exponent 0, every amount is wrong by 100×, silently, in both directions.

The split is absolute:

- **Static ISO 4217 table** → parsing, storage, and all arithmetic.
- **`Intl.NumberFormat`** → display only. If ICU disagrees about a symbol or separator,
  the worst case is cosmetic.

### Parsing and formatting

- `parseAmount(input: string, currency): MinorUnits` — accepts `"1,234.5"`, `"1234.50"`,
  `"$1234"`; rejects more than `exponent` decimal places for **that** currency (so
  `"100.5"` is invalid for JPY); **rounds nothing**, throws instead.
- `formatAmount(minor, currency)` — `Intl.NumberFormat` with `style: 'currency'`. Confirm
  the Hermes `Intl` build flag in Phase 12; fall back to a symbol table if it's trimmed.

### Property tests this adds

- Round-trip: `parseAmount(formatAmount(n, c), c) === n` for **every** currency, not just
  exponent-2 ones.
- `"100.5"` throws for JPY (exponent 0) and succeeds for USD.
- `"1.2345"` throws for KWD (exponent 3) and succeeds at `"1.234"`.

### Safe bound

`MAX_AMOUNT_MINOR = 1_000_000_000` minor units — which is 10 million major units at
exponent 2, but 1 billion at exponent 0 (JPY) and 1 million at exponent 3 (KWD). **The
bound is on the stored integer, not on the displayed amount**, so it holds regardless of
currency.

Justification: the largest intermediate in any algorithm below is
`amountMinor * weight`, where `weight` is at most `10_000` (percent in basis points).
`1e9 * 1e4 = 1e13`, comfortably under `Number.MAX_SAFE_INTEGER` (`9.007e15`). Amounts
above the bound are rejected at input. **Do not raise this bound without redoing this
arithmetic.**

---

## 2. Split algorithms

All four produce `Array<{ uid, amountMinor }>` that satisfies:

```
sum(result[].amountMinor) === totalMinor      // EXACTLY. Always. No tolerance.
```

This is the contract. Every algorithm below is just a different way of choosing weights.

### 2.1 Equal split

```
base      = floor(total / n)
remainder = total - base * n          // 0 <= remainder < n
```

Give `base` to everyone, then **one extra minor unit** to `remainder` participants.

**Which participants?** This must be deterministic (so recomputation is stable) but not
always the same person (so it is fair over time).

```ts
const ordered = [...uids].sort(); // lexicographic: deterministic
const start = hashToInt(expenseId) % n; // stable rotation per expense
for (let i = 0; i < remainder; i++) {
  amounts[ordered[(start + i) % n]] += 1;
}
```

Using `expenseId` as the seed means the rotation is reproducible from stored data alone,
and stays identical across edits of the same expense — while different expenses spread the
extra cent around instead of always taxing whoever's UID sorts first.

**Worked example:** $100.00 across 3 people → `total=10000, n=3, base=3333, remainder=1`.
Result: `3334, 3333, 3333`. Sum `= 10000` ✓

### 2.2 Exact amounts

User supplies each amount directly. No computation — only validation:

- each `amountMinor >= 0` and integer
- `sum === total`, exactly

The UI shows a live `total - sum` indicator and disables save unless it reads zero
(AC-D2.2). Do not auto-adjust the last participant to force a match; that hides user error.

### 2.3 Percentage

Percentages are stored as **integer basis points** (`33.33% → 3333`), never as floats.
Validation: `sum(bps) === 10_000` exactly.

Allocation uses the **largest remainder method**:

```ts
// exact_i = total * bps_i / 10000
const floors = bps.map((b) => Math.floor((total * b) / 10000));
const rems = bps.map((b) => (total * b) % 10000);
let leftover = total - sum(floors); // 0 <= leftover < n

// hand the leftover units to the largest fractional parts
const order = indices.sort((a, b) => (rems[b] - rems[a] || uids[a] < uids[b] ? -1 : 1));
for (let i = 0; i < leftover; i++) floors[order[i]] += 1;
```

Ties in `rems` break on ascending uid so the result is fully deterministic.

**Worked example:** $100.00, three people at 33.33 / 33.33 / 33.34%
→ floors `3333, 3333, 3334` = 10000, leftover 0. Sum ✓

**Worked example with leftover:** $10.00 (1000), 33.33/33.33/33.34%
→ exact: 333.3, 333.3, 333.4 → floors `333,333,333` = 999, leftover 1;
remainders `3000, 3000, 3400` → largest is index 2 → `333, 333, 334` = 1000 ✓

### 2.4 Shares

Integer shares (`2:1:1`). Identical to percentage but with `W = sum(shares)` in place of
`10000`:

```ts
floors_i = floor((total * shares_i) / W);
rems_i = (total * shares_i) % W;
```

Same largest-remainder distribution, same tie-break.

Validation: every share is a non-negative integer, `W > 0`, at least one share `> 0`.

**Worked example:** $100.00 split 2:1:1 → `W=4`; floors `5000, 2500, 2500` = 10000 ✓

### 2.5 Shared implementation

2.3 and 2.4 are the same function. 2.1 is that function with all weights equal, except
for the rotation tie-break. Implement once:

```ts
function allocate(
  total: MinorUnits,
  weights: Array<{ uid: string; weight: number }>,
  tieBreakSeed: string,
): Array<{ uid: string; amountMinor: MinorUnits }>;
```

and have all four split methods funnel into it. One function to test hard, four thin
callers. Property test: for any total in `[0, MAX]` and any weight vector, the output sums
to `total` and every element is a non-negative integer.

---

## 3. Balance computation

### Sign convention

`balanceMinor > 0` → **this person is owed money** (net creditor).
`balanceMinor < 0` → **this person owes money** (net debtor).

### Rules

```
For each non-deleted expense in the group:
    for each payer p:        balance[p.uid] += p.amountMinor
    for each split s:        balance[s.uid] -= s.amountMinor

For each non-deleted settlement:
    balance[fromUid] += amountMinor      // paying down what you owe moves you toward 0
    balance[toUid]   -= amountMinor
```

### Why it always sums to zero

Each expense contributes `sum(paidBy) - sum(splits) = total - total = 0`.
Each settlement contributes `+amount - amount = 0`.
A sum of zeros is zero. The invariant holds **by construction**, provided the validation
invariants in [03-data-model.md](03-data-model.md) hold — which is exactly why those are
enforced in Security Rules and not just in the client.

### Worked example

Group: Alice, Bob, Carol. Currency USD (amounts shown in minor units = cents).

| #   | Event                                             | Alice |   Bob | Carol |
| --- | ------------------------------------------------- | ----: | ----: | ----: |
| 1   | Alice pays $3000 dinner, equal 3 ways (1000 each) | +2000 | −1000 | −1000 |
| 2   | Bob pays $1500 cab, equal 3 ways (500 each)       | +1500 |    ±0 | −1500 |
| 3   | Carol pays Alice $1500 (settlement)               |    ±0 |    ±0 |    ±0 |

Row 2 running totals: Alice `+2000−500 = +1500`, Bob `−1000+1500−500 = 0`,
Carol `−1000−500 = −1500`. Sum = 0 ✓
Row 3: Carol `−1500+1500 = 0`, Alice `+1500−1500 = 0`. Sum = 0 ✓

### Where it runs

- **Authoritative:** Cloud Function, in a Firestore transaction — see [06-cloud-functions.md](06-cloud-functions.md).
- **Optimistic:** the same pure function, client-side, for instant UI feedback. The
  server value overwrites it on the next snapshot.

Both call the identical function from `packages/core/src/domain/balances.ts`. The
Functions package imports `@splitsutra/core`. **Never** write a second implementation.

---

## 4. Debt simplification

### Problem

Given net balances summing to zero, produce a payment list that zeroes everyone out with
as few payments as possible.

### Algorithm — greedy max-creditor / max-debtor

```ts
export function simplifyDebts(
  balances: Array<{ uid: string; balanceMinor: number }>,
): Array<{ fromUid: string; toUid: string; amountMinor: number }> {
  const creditors = balances
    .filter((b) => b.balanceMinor > 0)
    .sort((a, b) => b.balanceMinor - a.balanceMinor || (a.uid < b.uid ? -1 : 1));
  const debtors = balances
    .filter((b) => b.balanceMinor < 0)
    .sort((a, b) => a.balanceMinor - b.balanceMinor || (a.uid < b.uid ? -1 : 1));

  const payments = [];
  let i = 0,
    j = 0;
  while (i < creditors.length && j < debtors.length) {
    const amount = Math.min(creditors[i].balanceMinor, -debtors[j].balanceMinor);
    payments.push({ fromUid: debtors[j].uid, toUid: creditors[i].uid, amountMinor: amount });
    creditors[i].balanceMinor -= amount;
    debtors[j].balanceMinor += amount;
    if (creditors[i].balanceMinor === 0) i++;
    if (debtors[j].balanceMinor === 0) j++;
  }
  return payments;
}
```

### Properties

- **Terminates**, and produces **at most `n-1` payments**: every iteration zeroes at least
  one party and permanently removes them. After `n-1` removals one party remains, whose
  balance must be 0 because the total is 0.
- **Correct:** applying every payment leaves all balances at 0 (AC-E3.2).
- **Deterministic:** ties break on ascending uid, so the same input always yields the same
  output — important, because the settle-up screen must not reshuffle between renders.
- Integer-only; no rounding ever occurs.

### Honest limitation

This is a **heuristic, not an optimum.** Finding the true minimum number of transactions
is NP-hard (it reduces to partitioning into zero-sum subsets). Greedy can be worse than
optimal:

> Balances `A:+30, B:+10, C:−10, D:−30`. Optimal is 2 payments (D→A 30, C→B 10). Greedy
> also finds 2 here, but on adversarial inputs it can produce more.

`n-1` is a good bound in practice for groups of ≤ 15 and it matches what the
shipping products do. **Do not chase the optimum** — the extra complexity buys nothing at this scale.

### Product semantics (AC-E3.3, AC-E3.5)

- Simplification **never mutates the ledger.** Expenses are untouched. It is purely a
  view over current balances.
- Default: **on** for a new group (ADR-12). The simplified payment list is the view that
  opens first, with the raw "who owes whom" one tab away and never removed.
- With `group.simplifyDebts = false`, that order reverses. Nothing else about the group
  changes — the setting picks a starting tab, not a behaviour.
- The UI must explain the substitution (AC-E3.4), because "why am I paying Carol when I
  borrowed from Bob?" is the number one confusion this feature creates.

---

## 5. Test plan for this module

These are the highest-value tests in the codebase. See [09-testing.md](09-testing.md).

| Test                                   | Type                  | Assertion                                                        |
| -------------------------------------- | --------------------- | ---------------------------------------------------------------- |
| `allocate` sums exactly                | Property (fast-check) | For random total and weights, `sum(out) === total`               |
| `allocate` non-negative integers       | Property              | Every output is an integer `>= 0`                                |
| `allocate` determinism                 | Property              | Same input twice yields identical output                         |
| Equal split rotation                   | Unit                  | Different `expenseId`s rotate who gets the extra unit            |
| Percent must total 10000 bps           | Unit                  | Non-100% input throws                                            |
| Balances sum to zero                   | Property              | Random expense/settlement sets over random members → `sum === 0` |
| `simplifyDebts` zeroes out             | Property              | Applying all payments leaves every balance at 0                  |
| `simplifyDebts` bound                  | Property              | `payments.length <= n - 1`                                       |
| `simplifyDebts` determinism            | Property              | Stable output across runs                                        |
| `parseAmount` rejects excess precision | Unit                  | `"1.234"` with exponent 2 throws                                 |
| Amount bound                           | Unit                  | `MAX_AMOUNT_MINOR + 1` is rejected                               |
| Float never appears                    | Static                | ESLint rule bans `parseFloat` in `domain/`                       |

Property tests use `fast-check`. The zero-sum property test is the single most valuable
test in the project — it catches essentially every class of money bug at once.
