/**
 * The four split methods (doc 04 §2).
 *
 * Each one is a thin choice of weights on top of `allocate`, so the tests here are
 * about the *rules* each method enforces — 100% of basis points, exact amounts that
 * really are exact, a zero-share participant who is listed but owes nothing — plus
 * the one contract all four share:
 *
 *     sum(result[].amountMinor) === totalMinor      // exactly, always, no tolerance
 */

import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { getExponent } from '../../types/currency.js';
import { MAX_AMOUNT_MINOR, type MinorUnits } from '../../types/money.js';
import { MAX_WEIGHT } from '../allocate.js';
import {
  TOTAL_BASIS_POINTS,
  computeSplits,
  splitEqual,
  splitExact,
  splitPercent,
  splitShares,
  type SplitInput,
} from '../splits.js';
import {
  amountsOf,
  arbBasisPoints,
  arbPartitionOf,
  arbSeed,
  arbTotal,
  arbUids,
  ascending,
  expectDomainError,
  minor,
  sumOf,
  unsafeMinor,
} from './arbitraries.js';

/** uids sorted ascending, which is the order every split method returns. */
function uidsOf(parts: ReadonlyArray<{ readonly uid: string }>): string[] {
  return parts.map((part) => part.uid);
}

/* -------------------------------------------------------------------------- */
/* splitEqual                                                                 */
/* -------------------------------------------------------------------------- */

describe('splitEqual', () => {
  it('sums to the total for any group size and any amount (AC-D2.1)', () => {
    fc.assert(
      fc.property(arbTotal, arbUids(1, 12), arbSeed, (total, uids, seed) => {
        expect(sumOf(amountsOf(splitEqual(minor(total), uids, seed)))).toBe(total);
      }),
    );
  });

  it('never leaves two people more than one minor unit apart', () => {
    // "Equal" has to actually look equal on the screen. A gap of two cents between
    // two people on the same dinner is the bug users notice and report.
    fc.assert(
      fc.property(arbTotal, arbUids(1, 12), arbSeed, (total, uids, seed) => {
        const amounts = amountsOf(splitEqual(minor(total), uids, seed));
        const sorted = ascending(amounts);
        expect(sorted[sorted.length - 1]! - sorted[0]!).toBeLessThanOrEqual(1);
      }),
    );
  });

  it('returns participants in ascending uid order whatever order they were given in', () => {
    expect(uidsOf(splitEqual(minor(300), ['u0003', 'u0001', 'u0002'], 'expense-1'))).toEqual([
      'u0001',
      'u0002',
      'u0003',
    ]);
  });

  it('records no raw input, because for an equal split the amount is the whole story', () => {
    for (const part of splitEqual(minor(10), ['u0001', 'u0002', 'u0003'], 'expense-1')) {
      expect(part.rawValue).toBeNull();
    }
  });

  it('splits $100.00 three ways as 3334/3333/3333 (doc 04 §2.1)', () => {
    const parts = splitEqual(minor(10_000), ['u0001', 'u0002', 'u0003'], 'expense-3');
    expect(parts.map((part) => part.amountMinor)).toEqual([3334, 3333, 3333]);
  });

  it('moves the extra minor unit to a different person for a different expense', () => {
    // Same participants, same amount, different expense id. Without this the same
    // person absorbs the rounding on every single equal split, forever.
    const uids = ['u0001', 'u0002', 'u0003'];
    const forExpenseThree = splitEqual(minor(10), uids, 'expense-3');
    const forExpenseOne = splitEqual(minor(10), uids, 'expense-1');
    expect(forExpenseThree[0]!.amountMinor).toBe(4);
    expect(forExpenseOne[1]!.amountMinor).toBe(4);
  });

  it('gives a single participant the entire total', () => {
    expect(splitEqual(minor(999), ['u0001'], 'expense-1')).toEqual([
      { uid: 'u0001', amountMinor: 999, rawValue: null },
    ]);
  });

  it('splits ¥1,000 three ways in whole yen, because JPY has no sub-unit', () => {
    // 🔴 JPY is exponent 0. The leftover unit is a whole yen someone actually pays;
    // any code path that assumes two decimals here produces an unpayable ¥333.33.
    expect(getExponent('JPY')).toBe(0);
    const amounts = amountsOf(splitEqual(minor(1000), ['u0001', 'u0002', 'u0003'], 'expense-3'));
    expect(sumOf(amounts)).toBe(1000);
    expect(ascending(amounts)).toEqual([333, 333, 334]);
  });

  it('splits 1.000 KWD three ways down to the fils, because KWD has three decimals', () => {
    // 🔴 KWD/BHD are exponent 3, so 1000 minor units is one dinar, not ten dollars.
    // The exponent lives in the hardcoded table; the allocator only ever sees integers.
    expect(getExponent('KWD')).toBe(3);
    expect(getExponent('BHD')).toBe(3);
    const amounts = amountsOf(splitEqual(minor(1000), ['u0001', 'u0002', 'u0003'], 'expense-3'));
    expect(sumOf(amounts)).toBe(1000);
    expect(ascending(amounts)).toEqual([333, 333, 334]);
  });

  it('throws when nobody is on the expense', () => {
    expectDomainError(() => splitEqual(minor(100), [], 'expense-1'), 'NO_PARTICIPANTS');
  });

  it('throws when the same person is listed twice', () => {
    expectDomainError(
      () => splitEqual(minor(100), ['u0001', 'u0001'], 'expense-1'),
      'DUPLICATE_UID',
    );
  });
});

/* -------------------------------------------------------------------------- */
/* splitExact                                                                 */
/* -------------------------------------------------------------------------- */

describe('splitExact', () => {
  it('returns exactly the amounts the user typed, in ascending uid order (AC-D2.2)', () => {
    expect(
      splitExact(minor(1000), [
        { uid: 'u0002', amountMinor: 700 },
        { uid: 'u0001', amountMinor: 300 },
      ]),
    ).toEqual([
      { uid: 'u0001', amountMinor: 300, rawValue: null },
      { uid: 'u0002', amountMinor: 700, rawValue: null },
    ]);
  });

  it('never adjusts a number the user typed to force the sum to match', () => {
    // 🔴 Auto-correcting the last participant hides a typo behind a silently altered
    // amount — the user sees a total that balances and a share they never entered.
    expectDomainError(
      () =>
        splitExact(minor(1000), [
          { uid: 'u0001', amountMinor: 300 },
          { uid: 'u0002', amountMinor: 699 },
        ]),
      'EXACT_SUM_MISMATCH',
    );
  });

  it('reports how many minor units are still unassigned', () => {
    // The message drives the live "1 left to assign" indicator on the split sheet.
    expect(() =>
      splitExact(minor(1000), [
        { uid: 'u0001', amountMinor: 300 },
        { uid: 'u0002', amountMinor: 699 },
      ]),
    ).toThrow(/1 minor units/);
  });

  it('rejects an overshoot as firmly as a shortfall', () => {
    expectDomainError(
      () => splitExact(minor(1000), [{ uid: 'u0001', amountMinor: 1001 }]),
      'EXACT_SUM_MISMATCH',
    );
  });

  it('accepts a participant assigned zero, who is on the expense but owes nothing', () => {
    // AC-D2.6.
    expect(
      splitExact(minor(500), [
        { uid: 'u0001', amountMinor: 500 },
        { uid: 'u0002', amountMinor: 0 },
      ]),
    ).toEqual([
      { uid: 'u0001', amountMinor: 500, rawValue: null },
      { uid: 'u0002', amountMinor: 0, rawValue: null },
    ]);
  });

  it('accepts a total of zero split into zeros', () => {
    expect(amountsOf(splitExact(minor(0), [{ uid: 'u0001', amountMinor: 0 }]))).toEqual([0]);
  });

  it('rejects a negative share, because there is no refund concept in the ledger', () => {
    expectDomainError(
      () =>
        splitExact(minor(100), [
          { uid: 'u0001', amountMinor: 200 },
          { uid: 'u0002', amountMinor: -100 },
        ]),
      'INVALID_AMOUNT',
    );
  });

  it('rejects a fractional share, because money is never a float', () => {
    // Article I. Reaching this branch means a float survived parsing upstream.
    expectDomainError(
      () =>
        splitExact(minor(100), [
          { uid: 'u0001', amountMinor: 50.5 },
          { uid: 'u0002', amountMinor: 49.5 },
        ]),
      'INVALID_AMOUNT',
    );
  });

  it('rejects a share past the safe bound even when the arithmetic would balance', () => {
    expectDomainError(
      () => splitExact(minor(MAX_AMOUNT_MINOR), [{ uid: 'u0001', amountMinor: 2e9 }]),
      'INVALID_AMOUNT',
    );
  });

  it('rejects an invalid total before looking at the shares', () => {
    expectDomainError(
      () => splitExact(unsafeMinor(-100), [{ uid: 'u0001', amountMinor: -100 }]),
      'NEGATIVE_TOTAL',
    );
  });

  it('throws when nobody is on the expense', () => {
    expectDomainError(() => splitExact(minor(0), []), 'NO_PARTICIPANTS');
  });

  it('throws when the same person is listed twice', () => {
    expectDomainError(
      () =>
        splitExact(minor(100), [
          { uid: 'u0001', amountMinor: 50 },
          { uid: 'u0001', amountMinor: 50 },
        ]),
      'DUPLICATE_UID',
    );
  });

  it('accepts any set of non-negative amounts that genuinely sum to the total', () => {
    // The partition is built from cut points, never from `allocate` — a generator that
    // shared arithmetic with the code under test could hide the same bug twice.
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1_000_000 }).chain((total) =>
          arbUids(1, 8).chain((uids) =>
            arbPartitionOf(total, uids.length).map((amounts) => ({
              total,
              entries: uids.map((uid, index) => ({ uid, amountMinor: amounts[index] ?? 0 })),
            })),
          ),
        ),
        ({ total, entries }) => {
          const parts = splitExact(minor(total), entries);
          expect(sumOf(amountsOf(parts))).toBe(total);
          expect(uidsOf(parts)).toEqual([...entries.map((entry) => entry.uid)].sort());
        },
      ),
    );
  });
});

/* -------------------------------------------------------------------------- */
/* splitPercent                                                               */
/* -------------------------------------------------------------------------- */

describe('splitPercent', () => {
  it('sums to the total for any basis points that add up to 100% (AC-D2.3)', () => {
    fc.assert(
      fc.property(
        arbTotal,
        arbUids(1, 10).chain((uids) =>
          arbBasisPoints(uids.length).map((bps) =>
            uids.map((uid, index) => ({ uid, bps: bps[index] ?? 0 })),
          ),
        ),
        arbSeed,
        (total, percentages, seed) => {
          expect(sumOf(amountsOf(splitPercent(minor(total), percentages, seed)))).toBe(total);
        },
      ),
    );
  });

  it('keeps the entered percentage so the edit screen can show it back unchanged', () => {
    const parts = splitPercent(
      minor(1000),
      [
        { uid: 'u0001', bps: 3333 },
        { uid: 'u0002', bps: 3333 },
        { uid: 'u0003', bps: 3334 },
      ],
      'expense-1',
    );
    expect(parts.map((part) => part.rawValue)).toEqual([3333, 3333, 3334]);
  });

  it('splits $10.00 at 33.33/33.33/33.34% as 333/333/334 (doc 04 §2.3)', () => {
    // 🔴 The leftover unit goes to the largest remainder — the 33.34% participant —
    // not to whoever the seed points at. Getting this backwards makes the person who
    // agreed to pay *less* pay more, which is the version users notice.
    const parts = splitPercent(
      minor(1000),
      [
        { uid: 'u0001', bps: 3333 },
        { uid: 'u0002', bps: 3333 },
        { uid: 'u0003', bps: 3334 },
      ],
      'expense-1',
    );
    expect(amountsOf(parts)).toEqual([333, 333, 334]);
  });

  it('splits $100.00 at 33.33/33.33/33.34% with no leftover at all (doc 04 §2.3)', () => {
    const parts = splitPercent(
      minor(10_000),
      [
        { uid: 'u0001', bps: 3333 },
        { uid: 'u0002', bps: 3333 },
        { uid: 'u0003', bps: 3334 },
      ],
      'expense-1',
    );
    expect(amountsOf(parts)).toEqual([3333, 3333, 3334]);
  });

  it('accepts one participant taking the whole 100%', () => {
    expect(
      amountsOf(
        splitPercent(minor(1234), [{ uid: 'u0001', bps: TOTAL_BASIS_POINTS }], 'expense-1'),
      ),
    ).toEqual([1234]);
  });

  it('accepts a participant on 0%, who is listed but owes nothing', () => {
    // AC-D2.6. A zero weight has a zero remainder, so it can never pick up a leftover.
    const parts = splitPercent(
      minor(999),
      [
        { uid: 'u0001', bps: TOTAL_BASIS_POINTS },
        { uid: 'u0002', bps: 0 },
      ],
      'expense-1',
    );
    expect(amountsOf(parts)).toEqual([999, 0]);
  });

  it('throws when the split percentages do not total 100', () => {
    expectDomainError(
      () =>
        splitPercent(
          minor(1000),
          [
            { uid: 'u0001', bps: 5000 },
            { uid: 'u0002', bps: 4999 },
          ],
          'expense-1',
        ),
      'PERCENT_SUM_MISMATCH',
    );
  });

  it('throws when the percentages total more than 100', () => {
    expectDomainError(
      () =>
        splitPercent(
          minor(1000),
          [
            { uid: 'u0001', bps: 5000 },
            { uid: 'u0002', bps: 5001 },
          ],
          'expense-1',
        ),
      'PERCENT_SUM_MISMATCH',
    );
  });

  it('throws on a fractional basis point, because 33.33% is 3333 and not 33.33', () => {
    // 🔴 The classic mistake: passing the percentage instead of the basis points.
    // `33.33 + 33.33 + 33.34` is not 100 in binary floating point, so a float-based
    // rule can never be satisfied and the user can never save the expense.
    expectDomainError(
      () => splitPercent(minor(1000), [{ uid: 'u0001', bps: 33.33 }], 'expense-1'),
      'INVALID_WEIGHT',
    );
  });

  it('throws on a negative percentage', () => {
    expectDomainError(
      () =>
        splitPercent(
          minor(1000),
          [
            { uid: 'u0001', bps: -1 },
            { uid: 'u0002', bps: 10_001 },
          ],
          'expense-1',
        ),
      'INVALID_WEIGHT',
    );
  });

  it('throws when nobody is on the expense', () => {
    expectDomainError(() => splitPercent(minor(100), [], 'expense-1'), 'NO_PARTICIPANTS');
  });

  it('throws when the same person is listed twice', () => {
    expectDomainError(
      () =>
        splitPercent(
          minor(100),
          [
            { uid: 'u0001', bps: 5000 },
            { uid: 'u0001', bps: 5000 },
          ],
          'expense-1',
        ),
      'DUPLICATE_UID',
    );
  });
});

/* -------------------------------------------------------------------------- */
/* splitShares                                                                */
/* -------------------------------------------------------------------------- */

describe('splitShares', () => {
  it('sums to the total for any non-degenerate share vector (AC-D2.4)', () => {
    fc.assert(
      fc.property(
        arbTotal,
        arbUids(1, 10).chain((uids) =>
          fc
            .array(fc.integer({ min: 0, max: MAX_WEIGHT }), {
              minLength: uids.length,
              maxLength: uids.length,
            })
            .map((counts) =>
              uids.map((uid, index) => ({
                uid,
                shares: index === 0 ? Math.max(counts[index] ?? 0, 1) : (counts[index] ?? 0),
              })),
            ),
        ),
        arbSeed,
        (total, shares, seed) => {
          expect(sumOf(amountsOf(splitShares(minor(total), shares, seed)))).toBe(total);
        },
      ),
    );
  });

  it('splits $100.00 in a 2:1:1 ratio as 5000/2500/2500 (doc 04 §2.4)', () => {
    const parts = splitShares(
      minor(10_000),
      [
        { uid: 'u0001', shares: 2 },
        { uid: 'u0002', shares: 1 },
        { uid: 'u0003', shares: 1 },
      ],
      'expense-1',
    );
    expect(amountsOf(parts)).toEqual([5000, 2500, 2500]);
  });

  it('keeps the entered share count alongside the resolved amount', () => {
    const parts = splitShares(
      minor(10_000),
      [
        { uid: 'u0001', shares: 2 },
        { uid: 'u0002', shares: 1 },
      ],
      'expense-1',
    );
    expect(parts.map((part) => part.rawValue)).toEqual([2, 1]);
  });

  it('gives exactly zero to a participant holding zero shares (AC-D2.6)', () => {
    // The roommate who was at the table but did not eat. They must show on the
    // expense — and must owe nothing, even when there is a leftover unit going spare.
    const parts = splitShares(
      minor(101),
      [
        { uid: 'u0001', shares: 1 },
        { uid: 'u0002', shares: 1 },
        { uid: 'u0003', shares: 0 },
      ],
      'expense-1',
    );
    expect(parts[2]!.amountMinor).toBe(0);
    expect(sumOf(amountsOf(parts))).toBe(101);
  });

  it('throws when every participant holds zero shares', () => {
    expectDomainError(
      () =>
        splitShares(
          minor(100),
          [
            { uid: 'u0001', shares: 0 },
            { uid: 'u0002', shares: 0 },
          ],
          'expense-1',
        ),
      'ZERO_TOTAL_WEIGHT',
    );
  });

  it('throws on a fractional share count', () => {
    expectDomainError(
      () => splitShares(minor(100), [{ uid: 'u0001', shares: 1.5 }], 'expense-1'),
      'INVALID_WEIGHT',
    );
  });

  it('throws on a share count past the ceiling that keeps the arithmetic exact', () => {
    // 🔴 Share counts have no natural ceiling, so a fat-fingered "10000000" would push
    // `total * shares` past 2^53, where the sums-to-total guarantee dies silently.
    expectDomainError(
      () => splitShares(minor(100), [{ uid: 'u0001', shares: MAX_WEIGHT + 1 }], 'expense-1'),
      'INVALID_WEIGHT',
    );
  });

  it('throws when nobody is on the expense', () => {
    expectDomainError(() => splitShares(minor(100), [], 'expense-1'), 'NO_PARTICIPANTS');
  });

  it('throws when the same person is listed twice', () => {
    expectDomainError(
      () =>
        splitShares(
          minor(100),
          [
            { uid: 'u0001', shares: 1 },
            { uid: 'u0001', shares: 1 },
          ],
          'expense-1',
        ),
      'DUPLICATE_UID',
    );
  });
});

/* -------------------------------------------------------------------------- */
/* computeSplits                                                              */
/* -------------------------------------------------------------------------- */

describe('computeSplits', () => {
  const totalMinor: MinorUnits = minor(1000);
  const uids = ['u0001', 'u0002', 'u0003'];

  it('dispatches an equal split to splitEqual', () => {
    expect(computeSplits({ method: 'equal', totalMinor, uids, tieBreakSeed: 'expense-1' })).toEqual(
      splitEqual(totalMinor, uids, 'expense-1'),
    );
  });

  it('dispatches an exact split to splitExact', () => {
    const amounts = [
      { uid: 'u0001', amountMinor: 400 },
      { uid: 'u0002', amountMinor: 600 },
    ];
    expect(computeSplits({ method: 'exact', totalMinor, amounts })).toEqual(
      splitExact(totalMinor, amounts),
    );
  });

  it('dispatches a percentage split to splitPercent', () => {
    const percentages = [
      { uid: 'u0001', bps: 2500 },
      { uid: 'u0002', bps: 7500 },
    ];
    expect(
      computeSplits({ method: 'percent', totalMinor, percentages, tieBreakSeed: 'expense-1' }),
    ).toEqual(splitPercent(totalMinor, percentages, 'expense-1'));
  });

  it('dispatches a shares split to splitShares', () => {
    const shares = [
      { uid: 'u0001', shares: 3 },
      { uid: 'u0002', shares: 1 },
    ];
    expect(
      computeSplits({ method: 'shares', totalMinor, shares, tieBreakSeed: 'expense-1' }),
    ).toEqual(splitShares(totalMinor, shares, 'expense-1'));
  });

  it('sums to the total whichever method the caller switched to (AC-D2.5)', () => {
    // Switching split method is a change of input, not a change of code path — so the
    // contract has to hold identically across all four.
    const results = [
      computeSplits({ method: 'equal', totalMinor, uids, tieBreakSeed: 'expense-1' }),
      computeSplits({
        method: 'exact',
        totalMinor,
        amounts: [
          { uid: 'u0001', amountMinor: 1 },
          { uid: 'u0002', amountMinor: 999 },
        ],
      }),
      computeSplits({
        method: 'percent',
        totalMinor,
        percentages: [
          { uid: 'u0001', bps: 3333 },
          { uid: 'u0002', bps: 3333 },
          { uid: 'u0003', bps: 3334 },
        ],
        tieBreakSeed: 'expense-1',
      }),
      computeSplits({
        method: 'shares',
        totalMinor,
        shares: [
          { uid: 'u0001', shares: 2 },
          { uid: 'u0002', shares: 1 },
        ],
        tieBreakSeed: 'expense-1',
      }),
    ];
    for (const result of results) {
      expect(sumOf(amountsOf(result))).toBe(1000);
    }
  });

  it('throws on a split method it does not recognise, rather than guessing one', () => {
    // 🔴 Unreachable for a well-typed caller, reachable for a stale Firestore document
    // or a hostile client (Article IV). Falling through to "equal" here would rewrite
    // somebody's stored split silently.
    expectDomainError(
      () => computeSplits({ method: 'weighted' } as unknown as SplitInput),
      'INVALID_SPLIT_METHOD',
    );
  });

  it('names the unknown method in the error so the bad document can be found', () => {
    expect(() => computeSplits({ method: 'weighted' } as unknown as SplitInput)).toThrow(
      /weighted/,
    );
  });
});
