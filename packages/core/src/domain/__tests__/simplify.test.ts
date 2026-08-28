/**
 * Debt simplification (doc 04 §4).
 *
 * The greedy pairing is a deliberate heuristic, not an optimal solver, so the tests
 * here protect the four things that are *not* negotiable: the payments settle
 * everyone exactly, there are never more than `n − 1` of them, the same balances
 * always produce the same list, and the caller's balances are never mutated.
 *
 * That last one is not hypothetical. Doc 04's published snippet sorts `filter(...)`
 * results — new arrays holding *the caller's objects* — and then decrements them in
 * place, quietly zeroing the balances it was handed.
 */

import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { computeBalances, toBalanceList, type Balance } from '../balances.js';
import { applyTransfers, simplifyDebts, type Transfer } from '../simplify.js';
import {
  arbAnyBalances,
  arbLedger,
  arbZeroSumBalances,
  expectDomainError,
  sumOf,
} from './arbitraries.js';

/**
 * What `uid` receives minus what they pay, across a whole transfer list.
 *
 * For a fully settled group this equals their balance: a creditor with `+30` nets
 * `+30` in, a debtor with `−30` nets `30` out.
 */
function netReceivedBy(uid: string, transfers: readonly Transfer[]): number {
  let net = 0;
  for (const transfer of transfers) {
    if (transfer.toUid === uid) {
      net += transfer.amountMinor;
    }
    if (transfer.fromUid === uid) {
      net -= transfer.amountMinor;
    }
  }
  return net;
}

/** The doc 04 §4 illustration: two creditors, two debtors, two payments. */
const DOC_EXAMPLE: Balance[] = [
  { uid: 'alice', balanceMinor: 30 },
  { uid: 'bob', balanceMinor: 10 },
  { uid: 'carol', balanceMinor: -10 },
  { uid: 'dave', balanceMinor: -30 },
];

describe('simplifyDebts (properties)', () => {
  it('leaves every participant at exactly zero once the payments are made (AC-E3.2)', () => {
    // 🔴 The whole promise of the feature. A residual of one minor unit means the
    // group follows every instruction the app gave and is still not settled.
    fc.assert(
      fc.property(arbZeroSumBalances, (balances) => {
        const settled = applyTransfers(balances, simplifyDebts(balances));
        for (const balance of settled) {
          expect(balance.balanceMinor).toBe(0);
        }
      }),
    );
  });

  it('moves each participant exactly their own net balance, no more and no less', () => {
    // Simplification substitutes *who* you pay, never *how much*. If it ever changed
    // an amount, someone would be settling a debt that was never theirs.
    fc.assert(
      fc.property(arbZeroSumBalances, (balances) => {
        const transfers = simplifyDebts(balances);
        for (const balance of balances) {
          expect(netReceivedBy(balance.uid, transfers)).toBe(balance.balanceMinor);
        }
      }),
    );
  });

  it('never suggests more than one payment fewer than there are participants', () => {
    // Simplification exists to reduce the number of payments; a list longer than
    // `n − 1` would be worse than the raw "who owes whom" it replaces.
    fc.assert(
      fc.property(arbAnyBalances, (balances) => {
        expect(simplifyDebts(balances).length).toBeLessThanOrEqual(
          Math.max(0, balances.length - 1),
        );
      }),
    );
  });

  it('only ever asks a debtor to pay a creditor, in whole minor units', () => {
    // A self-payment or a zero-amount suggestion is a rendered row that does nothing,
    // and a creditor being asked to pay is the sign convention silently inverted.
    fc.assert(
      fc.property(arbAnyBalances, (balances) => {
        const byUid = new Map(balances.map((balance) => [balance.uid, balance.balanceMinor]));
        for (const transfer of simplifyDebts(balances)) {
          expect(transfer.fromUid).not.toBe(transfer.toUid);
          expect(Number.isInteger(transfer.amountMinor)).toBe(true);
          expect(transfer.amountMinor).toBeGreaterThan(0);
          expect(byUid.get(transfer.fromUid)!).toBeLessThan(0);
          expect(byUid.get(transfer.toUid)!).toBeGreaterThan(0);
        }
      }),
    );
  });

  it('never asks anyone to pay more than they owe or to receive more than they are owed', () => {
    fc.assert(
      fc.property(arbAnyBalances, (balances) => {
        const transfers = simplifyDebts(balances);
        for (const balance of balances) {
          const moved = netReceivedBy(balance.uid, transfers);
          expect(Math.abs(moved)).toBeLessThanOrEqual(Math.abs(balance.balanceMinor));
          // Same direction as the debt: a debtor only ever pays, a creditor only receives.
          expect(moved * balance.balanceMinor).toBeGreaterThanOrEqual(0);
        }
      }),
    );
  });

  it('returns the same payment list every time, so the settle-up screen never reshuffles', () => {
    fc.assert(
      fc.property(arbZeroSumBalances, (balances) => {
        expect(simplifyDebts(balances)).toEqual(simplifyDebts(balances));
      }),
    );
  });

  it('leaves the balances it was handed completely untouched (Article VII)', () => {
    // 🔴 The aliasing bug in doc 04's snippet: it decrements the caller's own objects,
    // so a screen that renders balances and then simplifies them shows every member
    // at zero. Purity is the fix, and this is the test that pins it.
    fc.assert(
      fc.property(arbZeroSumBalances, (balances) => {
        const before = balances.map((balance) => ({ ...balance }));
        simplifyDebts(balances);
        expect(balances).toEqual(before);
      }),
    );
  });

  it('settles any real group ledger end to end', () => {
    // The full pipeline the settle-up screen runs: ledger → balances → payments →
    // everyone at zero. This is the property that catches a bug anywhere in between.
    fc.assert(
      fc.property(arbLedger, (ledger) => {
        const balances = toBalanceList(computeBalances(ledger));
        for (const balance of applyTransfers(balances, simplifyDebts(balances))) {
          expect(balance.balanceMinor).toBe(0);
        }
      }),
    );
  });
});

describe('simplifyDebts (worked examples)', () => {
  it('settles two creditors and two debtors in two payments (doc 04 §4)', () => {
    expect(simplifyDebts(DOC_EXAMPLE)).toEqual([
      { fromUid: 'dave', toUid: 'alice', amountMinor: 30 },
      { fromUid: 'carol', toUid: 'bob', amountMinor: 10 },
    ]);
  });

  it('pairs the largest debtor with the largest creditor first', () => {
    expect(
      simplifyDebts([
        { uid: 'alice', balanceMinor: 100 },
        { uid: 'bob', balanceMinor: 400 },
        { uid: 'carol', balanceMinor: -500 },
      ]),
    ).toEqual([
      { fromUid: 'carol', toUid: 'bob', amountMinor: 400 },
      { fromUid: 'carol', toUid: 'alice', amountMinor: 100 },
    ]);
  });

  it('breaks a tie between creditors on ascending uid', () => {
    expect(
      simplifyDebts([
        { uid: 'bob', balanceMinor: 10 },
        { uid: 'alice', balanceMinor: 10 },
        { uid: 'carol', balanceMinor: -20 },
      ]),
    ).toEqual([
      { fromUid: 'carol', toUid: 'alice', amountMinor: 10 },
      { fromUid: 'carol', toUid: 'bob', amountMinor: 10 },
    ]);
  });

  it('breaks a tie between debtors on ascending uid', () => {
    expect(
      simplifyDebts([
        { uid: 'carol', balanceMinor: -10 },
        { uid: 'bob', balanceMinor: -10 },
        { uid: 'alice', balanceMinor: 20 },
      ]),
    ).toEqual([
      { fromUid: 'bob', toUid: 'alice', amountMinor: 10 },
      { fromUid: 'carol', toUid: 'alice', amountMinor: 10 },
    ]);
  });

  it('suggests nothing when everybody is already settled up', () => {
    expect(
      simplifyDebts([
        { uid: 'alice', balanceMinor: 0 },
        { uid: 'bob', balanceMinor: 0 },
      ]),
    ).toEqual([]);
  });

  it('suggests nothing for a group with no members', () => {
    expect(simplifyDebts([])).toEqual([]);
  });

  it('degrades to a shorter list rather than throwing on a snapshot that is mid-write', () => {
    // This runs in a render path. A transiently inconsistent set of balances — one
    // listener has landed and another has not — must not blank the settle-up screen.
    expect(simplifyDebts([{ uid: 'alice', balanceMinor: 500 }])).toEqual([]);
    expect(simplifyDebts([{ uid: 'bob', balanceMinor: -500 }])).toEqual([]);
    expect(
      simplifyDebts([
        { uid: 'alice', balanceMinor: 500 },
        { uid: 'bob', balanceMinor: -200 },
      ]),
    ).toEqual([{ fromUid: 'bob', toUid: 'alice', amountMinor: 200 }]);
  });

  it('throws on a fractional balance instead of settling to a wrong number', () => {
    // 🔴 Article I. A float here means minor units were divided somewhere upstream,
    // and every guarantee in this file rests on the arithmetic being integer.
    expectDomainError(
      () =>
        simplifyDebts([
          { uid: 'alice', balanceMinor: 0.5 },
          { uid: 'bob', balanceMinor: -0.5 },
        ]),
      'NON_INTEGER_BALANCE',
    );
  });

  it('throws on a balance that is not a number at all', () => {
    expectDomainError(
      () => simplifyDebts([{ uid: 'alice', balanceMinor: Number.NaN }]),
      'NON_INTEGER_BALANCE',
    );
  });

  it('names the participant whose balance is not an integer', () => {
    expect(() => simplifyDebts([{ uid: 'alice', balanceMinor: 1.5 }])).toThrow(/alice/);
  });
});

describe('applyTransfers', () => {
  it('returns the resulting balances in ascending uid order', () => {
    expect(
      applyTransfers(
        [
          { uid: 'carol', balanceMinor: -30 },
          { uid: 'alice', balanceMinor: 30 },
        ],
        [{ fromUid: 'carol', toUid: 'alice', amountMinor: 30 }],
      ),
    ).toEqual([
      { uid: 'alice', balanceMinor: 0 },
      { uid: 'carol', balanceMinor: 0 },
    ]);
  });

  it('changes nothing when there are no transfers to apply', () => {
    const balances: Balance[] = [
      { uid: 'alice', balanceMinor: 30 },
      { uid: 'carol', balanceMinor: -30 },
    ];
    expect(applyTransfers(balances, [])).toEqual(balances);
  });

  it('applies a partial payment without pretending the debt is cleared', () => {
    // The settle-up screen previews "after these payments" — including the case where
    // someone pays part of what they owe.
    expect(
      applyTransfers(
        [
          { uid: 'alice', balanceMinor: 30 },
          { uid: 'carol', balanceMinor: -30 },
        ],
        [{ fromUid: 'carol', toUid: 'alice', amountMinor: 10 }],
      ),
    ).toEqual([
      { uid: 'alice', balanceMinor: 20 },
      { uid: 'carol', balanceMinor: -20 },
    ]);
  });

  it('includes a payee who was not in the balance list at all', () => {
    // A transfer naming somebody outside the supplied balances must still show up,
    // or the previewed total stops summing to zero and the money appears to vanish.
    expect(
      applyTransfers(
        [{ uid: 'alice', balanceMinor: -100 }],
        [{ fromUid: 'alice', toUid: 'zoe', amountMinor: 100 }],
      ),
    ).toEqual([
      { uid: 'alice', balanceMinor: 0 },
      { uid: 'zoe', balanceMinor: -100 },
    ]);
  });

  it('preserves the total of the balances it was given', () => {
    fc.assert(
      fc.property(arbAnyBalances, (balances) => {
        const applied = applyTransfers(balances, simplifyDebts(balances));
        expect(sumOf(applied.map((balance) => balance.balanceMinor))).toBe(
          sumOf(balances.map((balance) => balance.balanceMinor)),
        );
      }),
    );
  });

  it('leaves the balances it was handed untouched', () => {
    const balances: Balance[] = [
      { uid: 'alice', balanceMinor: 30 },
      { uid: 'carol', balanceMinor: -30 },
    ];
    const before = balances.map((balance) => ({ ...balance }));
    applyTransfers(balances, [{ fromUid: 'carol', toUid: 'alice', amountMinor: 30 }]);
    expect(balances).toEqual(before);
  });
});
