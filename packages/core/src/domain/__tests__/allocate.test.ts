/**
 * The allocator — the single place in this codebase where money is divided
 * (Article VI), and therefore the single place a cent can be created or destroyed.
 *
 * The properties below are the contract `allocate` publishes in its own docblock.
 * Everything else in the money math — all four split methods, every balance, every
 * settle-up suggestion — is downstream of them holding for *every* input, not for
 * the handful a human thought to type.
 */

import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { getExponent } from '../../types/currency.js';
import { MAX_AMOUNT_MINOR } from '../../types/money.js';
import {
  MAX_WEIGHT,
  allocate,
  allocateToUids,
  assertParticipants,
  assertValidTotal,
  compareUid,
} from '../allocate.js';
import {
  amountsOf,
  arbSeed,
  arbTotal,
  arbUids,
  arbWeights,
  ascending,
  expectDomainError,
  minor,
  sumOf,
  unsafeMinor,
} from './arbitraries.js';

/* -------------------------------------------------------------------------- */
/* compareUid                                                                 */
/* -------------------------------------------------------------------------- */

describe('compareUid', () => {
  it('orders uids by UTF-16 code unit rather than by locale', () => {
    // 🔴 Production trap: `localeCompare` would put 'a' before 'B'. It is ICU-backed,
    // and Hermes on React Native ships a trimmed ICU — so the web client and the
    // mobile client would disagree about who absorbs the leftover minor unit, for the
    // same stored expense. Code-unit order is the same on every engine.
    expect(compareUid('B', 'a')).toBe(-1);
    expect(compareUid('a', 'B')).toBe(1);
    expect(['a', 'B', 'A', 'b'].sort(compareUid)).toEqual(['A', 'B', 'a', 'b']);
  });

  it('never reports two uids as equal, because callers guarantee they are distinct', () => {
    // Documented behaviour: the comparator has no zero case. `assertParticipants`
    // is what makes that safe, so the two must never be decoupled.
    expect(compareUid('u0001', 'u0001')).toBe(1);
  });
});

/* -------------------------------------------------------------------------- */
/* Guards                                                                     */
/* -------------------------------------------------------------------------- */

describe('assertParticipants', () => {
  it('accepts any list of distinct uids', () => {
    expect(() => {
      assertParticipants(['u0001', 'u0002', 'u0003']);
    }).not.toThrow();
  });

  it('throws when there is nobody to split between', () => {
    expectDomainError(() => {
      assertParticipants([]);
    }, 'NO_PARTICIPANTS');
  });

  it('throws when the same participant is listed twice', () => {
    // A duplicate uid does not fail loudly on its own: it produces a split that looks
    // perfectly ordinary and quietly charges one person two shares.
    expectDomainError(() => {
      assertParticipants(['u0001', 'u0002', 'u0001']);
    }, 'DUPLICATE_UID');
  });

  it('names the duplicated uid so the caller can find it', () => {
    expect(() => {
      assertParticipants(['u0001', 'u0001']);
    }).toThrow(/u0001/);
  });
});

describe('assertValidTotal', () => {
  it('accepts every integer from zero to the safe bound', () => {
    expect(() => {
      assertValidTotal(0);
    }).not.toThrow();
    expect(() => {
      assertValidTotal(MAX_AMOUNT_MINOR);
    }).not.toThrow();
  });

  it('rejects a negative total rather than inventing a refund', () => {
    expectDomainError(() => {
      assertValidTotal(-1);
    }, 'NEGATIVE_TOTAL');
  });

  it('rejects a fractional total, because money is never a float', () => {
    // Article I. The `MinorUnits` brand is erased at runtime and Cloud Functions run
    // this code over documents written by clients we do not control (Article IV), so a
    // float genuinely can arrive here.
    expectDomainError(() => {
      assertValidTotal(1234.5);
    }, 'INVALID_TOTAL');
  });

  it('rejects a total past the safe bound where integer arithmetic stops being exact', () => {
    // Above MAX_AMOUNT_MINOR, `total * weight` can leave the 2^53 exact-integer range
    // and the "sums to total" guarantee dies silently instead of throwing.
    expectDomainError(() => {
      assertValidTotal(MAX_AMOUNT_MINOR + 1);
    }, 'INVALID_TOTAL');
  });
});

/* -------------------------------------------------------------------------- */
/* allocate — properties                                                      */
/* -------------------------------------------------------------------------- */

describe('allocate (properties)', () => {
  it('distributes every minor unit of the total and invents none', () => {
    // The single most important assertion in the project. If this ever fails, some
    // group somewhere can never settle up and nobody can be told why.
    fc.assert(
      fc.property(arbTotal, arbWeights(), arbSeed, (total, weights, seed) => {
        expect(sumOf(allocate(minor(total), weights, seed))).toBe(total);
      }),
    );
  });

  it('returns one non-negative integer share per weight, never exceeding the total', () => {
    fc.assert(
      fc.property(arbTotal, arbWeights(), arbSeed, (total, weights, seed) => {
        const shares = allocate(minor(total), weights, seed);
        expect(shares).toHaveLength(weights.length);
        for (const share of shares) {
          expect(Number.isInteger(share)).toBe(true);
          expect(share).toBeGreaterThanOrEqual(0);
          expect(share).toBeLessThanOrEqual(total);
        }
      }),
    );
  });

  it('keeps every share within one minor unit of its exact proportional value', () => {
    // Stated without division so the assertion itself cannot introduce a float:
    // |share * W − total * weight| < W  is exactly  |share − total*weight/W| < 1.
    fc.assert(
      fc.property(arbTotal, arbWeights(), arbSeed, (total, weights, seed) => {
        const shares = allocate(minor(total), weights, seed);
        const totalWeight = sumOf(weights);
        shares.forEach((share, index) => {
          const weight = weights[index]!;
          expect(Math.abs(share * totalWeight - total * weight)).toBeLessThan(totalWeight);
        });
      }),
    );
  });

  it('produces identical output for identical input, so a recompute never moves money', () => {
    // Balances are a cache rebuilt from the ledger (Article V). A non-deterministic
    // allocator would make every recompute a tiny, invisible transfer between users.
    fc.assert(
      fc.property(arbTotal, arbWeights(), arbSeed, (total, weights, seed) => {
        expect(allocate(minor(total), weights, seed)).toEqual(
          allocate(minor(total), weights, seed),
        );
      }),
    );
  });

  it('never allocates anything to a participant whose weight is zero', () => {
    // AC-D2.6: a member may be listed on an expense with no share of it. Handing them
    // a leftover cent would put a debt on somebody who agreed to owe nothing.
    fc.assert(
      fc.property(arbTotal, arbWeights(2), arbSeed, (total, weights, seed) => {
        const shares = allocate(minor(total), weights, seed);
        shares.forEach((share, index) => {
          if (weights[index] === 0) {
            expect(share).toBe(0);
          }
        });
      }),
    );
  });

  it('never gives a smaller share to the participant with the larger weight', () => {
    // "Why did I pay more than Bob when I only took one share and he took two?" — the
    // largest-remainder step is where that could plausibly go wrong.
    fc.assert(
      fc.property(arbTotal, arbWeights(2, 6), arbSeed, (total, weights, seed) => {
        const shares = allocate(minor(total), weights, seed);
        weights.forEach((weightA, a) => {
          weights.forEach((weightB, b) => {
            if (weightA > weightB) {
              expect(shares[a]!).toBeGreaterThanOrEqual(shares[b]!);
            }
          });
        });
      }),
    );
  });

  it('hands out the leftover units to the largest fractional parts', () => {
    // The defining property of the largest-remainder method: nobody is rounded up
    // while somebody who was closer to the next unit is rounded down.
    fc.assert(
      fc.property(arbTotal, arbWeights(2, 6), arbSeed, (total, weights, seed) => {
        const shares = allocate(minor(total), weights, seed);
        const totalWeight = sumOf(weights);
        const roundedUp = shares.map((share, index) => {
          const product = total * weights[index]!;
          return share * totalWeight > product;
        });
        const remainderOf = (index: number): number => {
          const product = total * weights[index]!;
          return product - Math.floor(product / totalWeight) * totalWeight;
        };
        shares.forEach((_share, up) => {
          if (!roundedUp[up]) {
            return;
          }
          shares.forEach((_other, down) => {
            if (roundedUp[down]) {
              return;
            }
            expect(remainderOf(up)).toBeGreaterThanOrEqual(remainderOf(down));
          });
        });
      }),
    );
  });
});

/* -------------------------------------------------------------------------- */
/* allocate — worked examples                                                 */
/* -------------------------------------------------------------------------- */

describe('allocate (worked examples)', () => {
  it('splits 10 minor units three ways as 4/3/3, never 3/3/3', () => {
    // The classic largest-remainder case. A `Math.round` implementation returns
    // 3/3/3 and loses a unit, or 4/4/4 and invents two.
    const shares = allocate(minor(10), [1, 1, 1], 'expense-1');
    expect(sumOf(shares)).toBe(10);
    expect(ascending(shares)).toEqual([3, 3, 4]);
  });

  it('splits $100.00 three ways as 3334/3333/3333 (doc 04 §2.1)', () => {
    const shares = allocate(minor(10_000), [1, 1, 1], 'expense-3');
    expect(sumOf(shares)).toBe(10_000);
    expect(ascending(shares)).toEqual([3333, 3333, 3334]);
  });

  it('splits $100.00 in a 2:1:1 ratio as 5000/2500/2500 (doc 04 §2.4)', () => {
    expect(allocate(minor(10_000), [2, 1, 1], 'expense-1')).toEqual([5000, 2500, 2500]);
  });

  it('splits $10.00 at 33.33/33.33/33.34% as 333/333/334 (doc 04 §2.3)', () => {
    // Every floor is 333 and the leftover unit belongs to the largest remainder —
    // the 33.34% participant — not to whoever the seed happens to point at.
    expect(allocate(minor(1000), [3333, 3333, 3334], 'expense-1')).toEqual([333, 333, 334]);
  });

  it('gives a zero total to everybody as zero', () => {
    expect(allocate(minor(0), [1, 2, 3], 'expense-1')).toEqual([0, 0, 0]);
  });

  it('gives the whole total to the only participant', () => {
    expect(allocate(minor(4321), [7], 'expense-1')).toEqual([4321]);
  });

  it('rotates which participant absorbs the leftover unit as the expense id changes', () => {
    // Without the seeded rotation, whoever's uid sorts first pays the extra cent on
    // every equal split, forever. `hashToInt(seed) % 3` is 0, 1 and 2 for these three.
    const recipients = ['expense-3', 'expense-1', 'expense-2'].map((seed) =>
      allocate(minor(10), [1, 1, 1], seed).findIndex((share) => share === 4),
    );
    expect(recipients).toEqual([0, 1, 2]);
  });

  it('never rounds a zero-weight participant up even when leftovers exist', () => {
    // total 10, weights 0:1:1 → floors 0/5/5, no leftover; total 11 → floors 0/5/5
    // with one unit left, which must land on one of the two real participants.
    const shares = allocate(minor(11), [0, 1, 1], 'expense-1');
    expect(shares[0]).toBe(0);
    expect(sumOf(shares)).toBe(11);
  });

  it('stays exact at the safe bound, where the intermediate reaches 1e13', () => {
    // `total * weight` is MAX_AMOUNT_MINOR * MAX_WEIGHT here. One order of magnitude
    // more and IEEE-754 stops representing it exactly — and the sum silently drifts.
    const shares = allocate(minor(MAX_AMOUNT_MINOR), [MAX_WEIGHT, MAX_WEIGHT, 1], 'expense-1');
    expect(sumOf(shares)).toBe(MAX_AMOUNT_MINOR);
    for (const share of shares) {
      expect(Number.isSafeInteger(share)).toBe(true);
    }
  });

  describe('currencies whose minor unit is not a hundredth', () => {
    it('splits ¥1,000 three ways as whole yen, because JPY has no sub-unit', () => {
      // 🔴 JPY is exponent 0: the leftover "minor unit" is a whole yen, visible on the
      // receipt. Code that assumes exponent 2 everywhere would show ¥333.33 — a value
      // that cannot be paid and cannot be entered back into the app.
      expect(getExponent('JPY')).toBe(0);
      const shares = allocate(minor(1000), [1, 1, 1], 'expense-3');
      expect(sumOf(shares)).toBe(1000);
      expect(ascending(shares)).toEqual([333, 333, 334]);
    });

    it('splits 10.000 KWD three ways down to the fils, because KWD has three decimals', () => {
      // 🔴 KWD/BHD are exponent 3. 10.000 KWD is 10 000 fils, so the same integer that
      // means $100.00 in USD means 10.000 KWD here — and the leftover unit is a
      // thousandth, not a hundredth. Only the hardcoded exponent table knows which.
      expect(getExponent('KWD')).toBe(3);
      expect(getExponent('BHD')).toBe(3);
      const shares = allocate(minor(10_000), [1, 1, 1], 'expense-3');
      expect(sumOf(shares)).toBe(10_000);
      expect(ascending(shares)).toEqual([3333, 3333, 3334]);
    });
  });
});

/* -------------------------------------------------------------------------- */
/* allocate — rejected input                                                  */
/* -------------------------------------------------------------------------- */

describe('allocate (rejected input)', () => {
  it('throws rather than allocating a negative total', () => {
    expectDomainError(() => allocate(unsafeMinor(-1), [1, 1], 'expense-1'), 'NEGATIVE_TOTAL');
  });

  it('throws rather than allocating a fractional total', () => {
    expectDomainError(() => allocate(unsafeMinor(10.5), [1, 1], 'expense-1'), 'INVALID_TOTAL');
  });

  it('throws when there are no weights to allocate to', () => {
    expectDomainError(() => allocate(minor(100), [], 'expense-1'), 'NO_PARTICIPANTS');
  });

  it('throws when a weight is fractional', () => {
    expectDomainError(() => allocate(minor(100), [1, 1.5], 'expense-1'), 'INVALID_WEIGHT');
  });

  it('throws when a weight is negative', () => {
    expectDomainError(() => allocate(minor(100), [1, -1], 'expense-1'), 'INVALID_WEIGHT');
  });

  it('throws when a weight exceeds the ceiling that keeps the arithmetic exact', () => {
    // Share counts have no natural ceiling, so a user typing ten million shares would
    // push `total * weight` past 2^53 without this guard.
    expectDomainError(() => allocate(minor(100), [MAX_WEIGHT + 1], 'expense-1'), 'INVALID_WEIGHT');
  });

  it('accepts a weight sitting exactly on the ceiling', () => {
    expect(sumOf(allocate(minor(100), [MAX_WEIGHT], 'expense-1'))).toBe(100);
  });

  it('throws when every weight is zero and there is nobody to allocate to', () => {
    expectDomainError(() => allocate(minor(100), [0, 0, 0], 'expense-1'), 'ZERO_TOTAL_WEIGHT');
  });
});

/* -------------------------------------------------------------------------- */
/* allocateToUids                                                             */
/* -------------------------------------------------------------------------- */

describe('allocateToUids', () => {
  it('returns participants in ascending uid order whatever order they arrived in', () => {
    // A settle-up list that reshuffles between renders reads as broken even when
    // every number on it is right.
    const participants = [
      { uid: 'u0003', weight: 1 },
      { uid: 'u0001', weight: 1 },
      { uid: 'u0002', weight: 1 },
    ];
    expect(allocateToUids(minor(10), participants, 'expense-1').map((part) => part.uid)).toEqual([
      'u0001',
      'u0002',
      'u0003',
    ]);
  });

  it('allocates the same amount to a participant regardless of input ordering', () => {
    fc.assert(
      fc.property(arbTotal, arbUids(1, 6), arbSeed, (total, uids, seed) => {
        const participants = uids.map((uid, index) => ({ uid, weight: (index % 4) + 1 }));
        const reversed = [...participants].reverse();
        expect(allocateToUids(minor(total), reversed, seed)).toEqual(
          allocateToUids(minor(total), participants, seed),
        );
      }),
    );
  });

  it('sums to the total for any set of distinct participants', () => {
    fc.assert(
      fc.property(arbTotal, arbUids(1, 8), arbSeed, (total, uids, seed) => {
        const participants = uids.map((uid, index) => ({ uid, weight: (index % 5) + 1 }));
        expect(sumOf(amountsOf(allocateToUids(minor(total), participants, seed)))).toBe(total);
      }),
    );
  });

  it('carries extra participant fields through to the result', () => {
    // This is what lets the split methods keep `rawValue` attached instead of
    // re-joining two arrays by index afterwards.
    const result = allocateToUids(
      minor(100),
      [
        { uid: 'u0002', weight: 1, rawValue: 'two' },
        { uid: 'u0001', weight: 1, rawValue: 'one' },
      ],
      'expense-1',
    );
    expect(result).toEqual([
      { uid: 'u0001', weight: 1, rawValue: 'one', amountMinor: 50 },
      { uid: 'u0002', weight: 1, rawValue: 'two', amountMinor: 50 },
    ]);
  });

  it('breaks ties by uid order so the leftover unit lands somewhere reproducible', () => {
    const uids = ['u0001', 'u0002', 'u0003'];
    const participants = uids.map((uid) => ({ uid, weight: 1 }));
    const first = allocateToUids(minor(10), participants, 'expense-3');
    expect(first.find((part) => part.amountMinor === 4)?.uid).toBe('u0001');
  });

  it('throws when a uid is listed twice, before any money is moved', () => {
    expectDomainError(
      () =>
        allocateToUids(
          minor(100),
          [
            { uid: 'u0001', weight: 1 },
            { uid: 'u0001', weight: 1 },
          ],
          'expense-1',
        ),
      'DUPLICATE_UID',
    );
  });

  it('throws when there are no participants at all', () => {
    expectDomainError(() => allocateToUids(minor(100), [], 'expense-1'), 'NO_PARTICIPANTS');
  });
});
