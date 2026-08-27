/**
 * fast-check generators and assertion helpers shared by the domain test suite.
 *
 * docs/16-testing-setup.md §2 puts these in `packages/core/src/testing/arbitraries.ts`,
 * behind a `@splitsutra/core/testing` export path. That path is not wired into
 * `packages/core/package.json` yet, so they live here instead — inside `__tests__/`,
 * which Vitest's default `coverage.exclude` already ignores and which the `unit`
 * project's `include` (`src/**\/__tests__/**\/*.test.ts`) does not pick up as a suite.
 * Move them when the `./testing` export lands; nothing here depends on the location.
 *
 * ## The one rule these generators exist to enforce
 *
 * > The point of `arbLedger` is that it generates expenses which already satisfy
 * > `sum(paidBy) === sum(splits) === amountMinor`. That way a zero-sum failure means
 * > the *balance engine* is wrong, which is the thing under test.
 *
 * So the partitioning below is done with cut points rather than by calling the
 * allocator: if `arbLedger` built its splits with `allocate`, a bug in `allocate`
 * would produce ledgers that are internally consistent *with the bug*, and the
 * zero-sum property — the single most valuable test in the project — would happily
 * stay green. The generator and the code under test must not share arithmetic.
 *
 * Uids are generated from a numeric pool (`u0000`…`u9999`) so that lexicographic
 * order, which is what every tie-break in `domain/` sorts on, is obvious on sight.
 */

import * as fc from 'fast-check';
import { expect } from 'vitest';

import { MAX_AMOUNT_MINOR, toMinorUnits, type MinorUnits } from '../../types/money.js';
import { MAX_WEIGHT } from '../allocate.js';
import type { Balance, LedgerExpense, LedgerSettlement } from '../balances.js';
import { DomainError, type DomainErrorCode } from '../errors.js';
import { TOTAL_BASIS_POINTS } from '../splits.js';

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

/** Mints a branded amount, throwing on anything that is not a valid minor-unit integer. */
export const minor = (n: number): MinorUnits => toMinorUnits(n);

/**
 * Mints a branded amount **without checking it**.
 *
 * Only for the tests that prove the domain rejects bad input. The brand is erased
 * at runtime and Cloud Functions run this code over documents written by clients we
 * do not control (Article IV), so "a float reached a `MinorUnits` parameter" is a
 * real state the code has to defend against — and the only way to write that test
 * is to construct the state the type system is meant to prevent.
 */
export const unsafeMinor = (n: number): MinorUnits => n as MinorUnits;

/** Sum of a list of integers. Written out rather than imported, for the same reason as above. */
export function sumOf(values: Iterable<number>): number {
  let total = 0;
  for (const value of values) {
    total += value;
  }
  return total;
}

/** Pulls the `amountMinor` column out of any allocation-shaped list. */
export function amountsOf(parts: ReadonlyArray<{ readonly amountMinor: number }>): number[] {
  return parts.map((part) => part.amountMinor);
}

/** Ascending numeric copy — for assertions that care about the multiset, not the order. */
export function ascending(values: readonly number[]): number[] {
  return [...values].sort((a, b) => a - b);
}

/**
 * Runs `fn` and returns the {@link DomainError} it threw.
 *
 * Rethrows anything that is not a `DomainError` (a `TypeError` from a typo in the
 * test would otherwise be silently accepted as "it threw, good") and fails loudly
 * when nothing is thrown at all.
 */
export function domainErrorFrom(fn: () => unknown): DomainError {
  try {
    fn();
  } catch (error) {
    if (error instanceof DomainError) {
      return error;
    }
    throw error;
  }
  throw new Error('Expected a DomainError, but the call returned normally.');
}

/**
 * Asserts that `fn` throws a `DomainError` carrying exactly `code`.
 *
 * Codes, never message strings: `errors.ts` says the wording is free to improve.
 */
export function expectDomainError(fn: () => unknown, code: DomainErrorCode): void {
  expect(domainErrorFrom(fn).code).toBe(code);
}

/* -------------------------------------------------------------------------- */
/* Exact integer partitions — the ledger generator's arithmetic               */
/* -------------------------------------------------------------------------- */

/**
 * Splits `total` at the given cut points, yielding `cuts.length + 1` non-negative
 * integers that sum to exactly `total`.
 *
 * Cut points may arrive in any order and may repeat (a repeat produces a zero part,
 * which is exactly the AC-D2.6 "listed participant with a zero share" case). Every
 * cut must lie in `[0, total]`, which the generators below guarantee.
 */
export function partitionAt(total: number, cuts: readonly number[]): number[] {
  const parts: number[] = [];
  let previous = 0;
  for (const bound of [...cuts].sort((a, b) => a - b)) {
    parts.push(bound - previous);
    previous = bound;
  }
  parts.push(total - previous);
  return parts;
}

/** `count` non-negative integers summing to exactly `total`. `count` must be >= 1. */
export function arbPartitionOf(total: number, count: number): fc.Arbitrary<number[]> {
  return fc
    .array(fc.integer({ min: 0, max: total }), { minLength: count - 1, maxLength: count - 1 })
    .map((cuts) => partitionAt(total, cuts));
}

/* -------------------------------------------------------------------------- */
/* Primitive arbitraries                                                      */
/* -------------------------------------------------------------------------- */

/** `u0000` … `u9999`. Fixed width so lexicographic and numeric order agree. */
export const arbUid: fc.Arbitrary<string> = fc
  .integer({ min: 0, max: 9999 })
  .map((n) => `u${String(n).padStart(4, '0')}`);

/** A group's worth of distinct uids. */
export function arbUids(minLength = 1, maxLength = 8): fc.Arbitrary<string[]> {
  return fc.uniqueArray(arbUid, { minLength, maxLength });
}

/**
 * A tie-break seed — in production the expense id.
 *
 * Drawn from a pool rather than `fc.string()` so a shrunk counterexample names a
 * seed that can be pasted straight into a repro.
 */
export const arbSeed: fc.Arbitrary<string> = fc
  .integer({ min: 0, max: 100_000 })
  .map((n) => `expense-${String(n)}`);

/** Any total the allocator must accept: an integer in `[0, MAX_AMOUNT_MINOR]`. */
export const arbTotal: fc.Arbitrary<number> = fc.integer({ min: 0, max: MAX_AMOUNT_MINOR });

/** Any single weight the allocator must accept. */
export const arbWeight: fc.Arbitrary<number> = fc.integer({ min: 0, max: MAX_WEIGHT });

/**
 * A weight vector with at least one positive entry — the allocator rejects an
 * all-zero vector with `ZERO_TOTAL_WEIGHT`, which is asserted separately.
 *
 * One entry is forced positive rather than filtering, so no generation is ever
 * discarded and the shrinker keeps a straight path to the minimal counterexample.
 */
export function arbWeights(minLength = 1, maxLength = 12): fc.Arbitrary<number[]> {
  return fc
    .array(arbWeight, { minLength, maxLength })
    .chain((weights) =>
      fc
        .integer({ min: 0, max: weights.length - 1 })
        .map((pivot) =>
          weights.map((weight, index) => (index === pivot ? Math.max(weight, 1) : weight)),
        ),
    );
}

/** Integer basis points for `count` participants, summing to exactly 10 000. */
export function arbBasisPoints(count: number): fc.Arbitrary<number[]> {
  return arbPartitionOf(TOTAL_BASIS_POINTS, count);
}

/* -------------------------------------------------------------------------- */
/* Ledger arbitraries                                                         */
/* -------------------------------------------------------------------------- */

/** Any non-null value means "soft-deleted" — the domain never looks inside it. */
const DELETED_AT = { seconds: 1_700_000_000, nanoseconds: 0 } as const;

/** Roughly one in six generated documents is soft-deleted (Article V: nothing is erased). */
const arbDeletedAt: fc.Arbitrary<unknown> = fc
  .integer({ min: 0, max: 5 })
  .map((n) => (n === 0 ? DELETED_AT : null));

function zipAmounts(
  uids: readonly string[],
  amounts: readonly number[],
): Array<{ uid: string; amountMinor: number }> {
  // `?? 0` never fires — `arbPartitionOf` is asked for exactly `uids.length` parts —
  // but `noUncheckedIndexedAccess` wants a real fallback rather than a `!`.
  return uids.map((uid, index) => ({ uid, amountMinor: amounts[index] ?? 0 }));
}

/**
 * An expense that is internally consistent **by construction**:
 * `sum(paidBy) === sum(splits)`, both partitions of the same random total.
 *
 * Multiple payers are generated (AC-D1.4), and a payer need not be a participant.
 */
export function arbLedgerExpense(uids: readonly string[]): fc.Arbitrary<LedgerExpense> {
  const members = [...uids];
  return fc
    .record({
      participants: fc.subarray(members, { minLength: 1 }),
      payers: fc.subarray(members, { minLength: 1 }),
      total: fc.integer({ min: 0, max: 5_000_000 }),
      deletedAt: arbDeletedAt,
    })
    .chain(({ participants, payers, total, deletedAt }) =>
      fc
        .tuple(arbPartitionOf(total, participants.length), arbPartitionOf(total, payers.length))
        .map(([splitAmounts, paidAmounts]) => ({
          paidBy: zipAmounts(payers, paidAmounts),
          splits: zipAmounts(participants, splitAmounts),
          deletedAt,
        })),
    );
}

/** A settlement between two members. `from === to` is allowed; it nets to zero. */
export function arbLedgerSettlement(uids: readonly string[]): fc.Arbitrary<LedgerSettlement> {
  return fc.record({
    fromUid: fc.constantFrom(...uids),
    toUid: fc.constantFrom(...uids),
    amountMinor: fc.integer({ min: 0, max: 1_000_000 }),
    deletedAt: arbDeletedAt,
  });
}

/** A whole group ledger: members, consistent expenses, and settlements between them. */
export const arbLedger = arbUids(1, 8).chain((uids) =>
  fc.record({
    memberIds: fc.constant(uids),
    expenses: fc.array(arbLedgerExpense(uids), { maxLength: 10 }),
    settlements: fc.array(arbLedgerSettlement(uids), { maxLength: 6 }),
  }),
);

/* -------------------------------------------------------------------------- */
/* Balance arbitraries                                                        */
/* -------------------------------------------------------------------------- */

function withZeroSum(uids: readonly string[], values: readonly number[]): Balance[] {
  const raw = uids.map((uid, index) => ({ uid, balanceMinor: values[index] ?? 0 }));
  const residual = sumOf(raw.map((balance) => balance.balanceMinor));
  // Absorbing the whole residual into the first entry keeps every balance an integer
  // and leaves the rest of the vector untouched, so the shrinker stays useful.
  return raw.map((balance, index) =>
    index === 0 ? { uid: balance.uid, balanceMinor: balance.balanceMinor - residual } : balance,
  );
}

/**
 * Net balances that sum to exactly zero — the state a real group is always in
 * (AC-E1.3), and the only input for which `simplifyDebts` guarantees a full settle.
 */
export const arbZeroSumBalances: fc.Arbitrary<Balance[]> = arbUids(1, 12).chain((uids) =>
  fc
    .array(fc.integer({ min: -1_000_000, max: 1_000_000 }), {
      minLength: uids.length,
      maxLength: uids.length,
    })
    .map((values) => withZeroSum(uids, values)),
);

/**
 * Net balances with no zero-sum guarantee — a transiently inconsistent snapshot.
 * `simplifyDebts` degrades to a shorter suggestion list rather than throwing.
 */
export const arbAnyBalances: fc.Arbitrary<Balance[]> = arbUids(1, 12).chain((uids) =>
  fc
    .array(fc.integer({ min: -1_000_000, max: 1_000_000 }), {
      minLength: uids.length,
      maxLength: uids.length,
    })
    .map((values) => uids.map((uid, index) => ({ uid, balanceMinor: values[index] ?? 0 }))),
);
