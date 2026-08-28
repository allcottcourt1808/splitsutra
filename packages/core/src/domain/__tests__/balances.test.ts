/**
 * Balance computation (doc 04 §3).
 *
 * The zero-sum property below is the single most valuable test in the project: it
 * catches essentially every class of money bug at once, because a group whose
 * balances do not sum to zero is a group that can never settle up.
 *
 * The ledgers it runs on come from `arbLedger`, which builds internally consistent
 * expenses out of integer cut points and never calls the allocator — so a failure
 * here means the *balance engine* is wrong, not the generator.
 */

import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  assertZeroSum,
  computeBalances,
  toBalanceList,
  type Ledger,
  type LedgerExpense,
} from '../balances.js';
import { arbLedger, expectDomainError, sumOf } from './arbitraries.js';

/** The doc 04 §3 worked example: Alice pays dinner, Bob pays the cab, Carol settles up. */
const DINNER: LedgerExpense = {
  paidBy: [{ uid: 'alice', amountMinor: 3000 }],
  splits: [
    { uid: 'alice', amountMinor: 1000 },
    { uid: 'bob', amountMinor: 1000 },
    { uid: 'carol', amountMinor: 1000 },
  ],
  deletedAt: null,
};

const CAB: LedgerExpense = {
  paidBy: [{ uid: 'bob', amountMinor: 1500 }],
  splits: [
    { uid: 'alice', amountMinor: 500 },
    { uid: 'bob', amountMinor: 500 },
    { uid: 'carol', amountMinor: 500 },
  ],
  deletedAt: null,
};

describe('computeBalances (properties)', () => {
  it('always produces balances that sum to exactly zero (AC-E1.3)', () => {
    // 🔴 If this drifts by a single minor unit, a group is permanently unsettleable:
    // every member pays what they are told to and the app still shows a debt.
    fc.assert(
      fc.property(arbLedger, (ledger) => {
        expect(sumOf(Object.values(computeBalances(ledger)))).toBe(0);
      }),
    );
  });

  it('passes its own zero-sum assertion for every ledger it can produce', () => {
    fc.assert(
      fc.property(arbLedger, (ledger) => {
        expect(() => {
          assertZeroSum(computeBalances(ledger));
        }).not.toThrow();
      }),
    );
  });

  it('produces only integer balances, because money is never a float', () => {
    // Article I. `simplifyDebts` refuses to run on a float, so a fractional balance
    // here would take the settle-up screen down rather than just look odd.
    fc.assert(
      fc.property(arbLedger, (ledger) => {
        for (const balance of Object.values(computeBalances(ledger))) {
          expect(Number.isInteger(balance)).toBe(true);
        }
      }),
    );
  });

  it('gives every current member an entry even when they have no activity', () => {
    // The group screen reads `balances[uid] ?? 0`; a missing key and a zero balance
    // must not be distinguishable, or a brand-new member renders as blank.
    fc.assert(
      fc.property(arbLedger, (ledger) => {
        const balances = computeBalances(ledger);
        for (const uid of ledger.memberIds) {
          expect(balances[uid]).toBeDefined();
        }
      }),
    );
  });

  it('is unchanged by recomputing it from the same ledger', () => {
    // Article V: balances are a cache rebuilt from the ledger. A recompute that
    // returned something different would move money on every write.
    fc.assert(
      fc.property(arbLedger, (ledger) => {
        expect(computeBalances(ledger)).toEqual(computeBalances(ledger));
      }),
    );
  });

  it('ignores the order expenses and settlements arrive in', () => {
    // Firestore hands documents back in whatever order the query produced. Balances
    // must not depend on it.
    fc.assert(
      fc.property(arbLedger, (ledger) => {
        const reversed: Ledger = {
          memberIds: ledger.memberIds,
          expenses: [...ledger.expenses].reverse(),
          settlements: [...ledger.settlements].reverse(),
        };
        expect(computeBalances(reversed)).toEqual(computeBalances(ledger));
      }),
    );
  });
});

describe('computeBalances (worked examples)', () => {
  it('tracks the doc 04 §3 worked example through dinner, cab and settlement', () => {
    expect(computeBalances({ expenses: [DINNER], settlements: [] })).toEqual({
      alice: 2000,
      bob: -1000,
      carol: -1000,
    });

    expect(computeBalances({ expenses: [DINNER, CAB], settlements: [] })).toEqual({
      alice: 1500,
      bob: 0,
      carol: -1500,
    });

    expect(
      computeBalances({
        expenses: [DINNER, CAB],
        settlements: [{ fromUid: 'carol', toUid: 'alice', amountMinor: 1500, deletedAt: null }],
      }),
    ).toEqual({ alice: 0, bob: 0, carol: 0 });
  });

  it('reads a positive balance as being owed money and a negative one as owing it', () => {
    // 🔴 A flipped sign here is invisible: every number still renders and every total
    // still balances, and the app simply tells everyone the opposite of the truth.
    const balances = computeBalances({ expenses: [DINNER], settlements: [] });
    expect(balances['alice']).toBeGreaterThan(0);
    expect(balances['bob']).toBeLessThan(0);
  });

  it('moves a settling payer toward zero rather than further from it', () => {
    expect(
      computeBalances({
        expenses: [],
        settlements: [{ fromUid: 'bob', toUid: 'alice', amountMinor: 500 }],
        memberIds: ['alice', 'bob'],
      }),
    ).toEqual({ alice: -500, bob: 500 });
  });

  it('splits an expense paid by several people across all of them (AC-D1.4)', () => {
    expect(
      computeBalances({
        expenses: [
          {
            paidBy: [
              { uid: 'alice', amountMinor: 600 },
              { uid: 'bob', amountMinor: 400 },
            ],
            splits: [
              { uid: 'alice', amountMinor: 500 },
              { uid: 'bob', amountMinor: 500 },
            ],
          },
        ],
        settlements: [],
      }),
    ).toEqual({ alice: 100, bob: -100 });
  });

  it('seeds members at zero when the ledger is empty', () => {
    expect(computeBalances({ expenses: [], settlements: [], memberIds: ['alice', 'bob'] })).toEqual(
      { alice: 0, bob: 0 },
    );
  });

  it('returns nothing at all for an empty ledger with no member list', () => {
    expect(computeBalances({ expenses: [], settlements: [] })).toEqual({});
  });

  it('keeps a departed member who still moved money in the group', () => {
    // Dropping a uid that is not in memberIds would make their money vanish and break
    // the zero-sum invariant — turning a membership bug into an arithmetic one.
    const balances = computeBalances({
      expenses: [DINNER],
      settlements: [],
      memberIds: ['alice', 'bob'],
    });
    expect(balances['carol']).toBe(-1000);
    expect(sumOf(Object.values(balances))).toBe(0);
  });

  describe('soft deletes (Article V — nothing is ever hard-deleted)', () => {
    it('ignores an expense carrying a deletion timestamp', () => {
      const deleted: LedgerExpense = { ...DINNER, deletedAt: { seconds: 1, nanoseconds: 0 } };
      expect(computeBalances({ expenses: [DINNER, deleted], settlements: [] })).toEqual(
        computeBalances({ expenses: [DINNER], settlements: [] }),
      );
    });

    it('ignores a settlement carrying a deletion timestamp', () => {
      // 🔴 A deleted settlement that still counted would reverse somebody's balance
      // and show them as square when they still owe the money.
      expect(
        computeBalances({
          expenses: [DINNER],
          settlements: [
            { fromUid: 'bob', toUid: 'alice', amountMinor: 1000, deletedAt: { seconds: 1 } },
          ],
        }),
      ).toEqual({ alice: 2000, bob: -1000, carol: -1000 });
    });

    it('counts a document whose deletedAt is null', () => {
      expect(computeBalances({ expenses: [DINNER], settlements: [] })['alice']).toBe(2000);
    });

    it('counts a document with no deletedAt field at all', () => {
      // An optimistic in-memory draft has no timestamps yet, and must still be counted.
      const draft: LedgerExpense = { paidBy: DINNER.paidBy, splits: DINNER.splits };
      expect(computeBalances({ expenses: [draft], settlements: [] })['alice']).toBe(2000);
    });
  });

  it('keeps a uid that collides with an Object.prototype key as its own entry', () => {
    // 🔴 uids arrive from clients we do not control (Article IV). If '__proto__' ever
    // landed on the prototype instead of on the object, the balance would read back as
    // an object rather than a number and the group's total would be nonsense.
    const balances = computeBalances({
      expenses: [],
      settlements: [{ fromUid: '__proto__', toUid: 'constructor', amountMinor: 700 }],
    });
    expect(Object.keys(balances).sort()).toEqual(['__proto__', 'constructor']);
    expect(sumOf(Object.values(balances))).toBe(0);
  });
});

describe('toBalanceList', () => {
  it('returns every balance exactly once, in ascending uid order', () => {
    // Insertion order follows whatever Firestore returned; a settle-up screen that
    // reorders itself between renders looks broken even when the numbers are right.
    expect(toBalanceList({ u0003: -5, u0001: 8, u0002: -3 })).toEqual([
      { uid: 'u0001', balanceMinor: 8 },
      { uid: 'u0002', balanceMinor: -3 },
      { uid: 'u0003', balanceMinor: -5 },
    ]);
  });

  it('returns an empty list for an empty balance map', () => {
    expect(toBalanceList({})).toEqual([]);
  });

  it('preserves the sum of the map it was given', () => {
    fc.assert(
      fc.property(arbLedger, (ledger) => {
        const balances = computeBalances(ledger);
        const list = toBalanceList(balances);
        expect(list).toHaveLength(Object.keys(balances).length);
        expect(sumOf(list.map((balance) => balance.balanceMinor))).toBe(0);
      }),
    );
  });
});

describe('assertZeroSum', () => {
  it('accepts balances that cancel out exactly', () => {
    expect(() => {
      assertZeroSum({ alice: 1500, bob: 0, carol: -1500 });
    }).not.toThrow();
  });

  it('accepts an empty group', () => {
    expect(() => {
      assertZeroSum({});
    }).not.toThrow();
  });

  it('throws when the balances do not cancel out, however small the drift', () => {
    // 🔴 One stray minor unit is enough. This assertion runs on the write path in the
    // Cloud Function: failing loudly beats persisting a group that can never settle.
    expectDomainError(() => {
      assertZeroSum({ alice: 1, bob: -2 });
    }, 'ZERO_SUM_VIOLATION');
  });

  it('reports the residual so the inconsistency can be traced', () => {
    expect(() => {
      assertZeroSum({ alice: 1, bob: -2 });
    }).toThrow(/-1/);
  });
});
