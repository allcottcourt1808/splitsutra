/**
 * The group ledger's model layer — merging, ordering, month grouping, and what an expense did
 * to *you*.
 *
 * These are the cases that are invisible once rendered: an expense you are not part of, a payer
 * who is also the only participant, two entries on the same day, a month boundary. The screen
 * test covers what reaches the DOM; this covers what the numbers mean.
 */

import { describe, expect, it } from 'vitest';

import type { CurrencyCode, Expense, MinorUnits, Settlement } from '@splitsutra/core';

import { buildLedger, isInvolved, myNetMinor } from '../ledger';

/** A Firestore `Timestamp` stand-in with the one method the ledger calls. */
function ts(millis: number): Expense['date'] {
  return { toMillis: () => millis, toDate: () => new Date(millis) } as unknown as Expense['date'];
}

/** Branded money, for fixtures. `MinorUnits` is nominal, so a literal will not do. */
function minor(amount: number): MinorUnits {
  return amount as unknown as MinorUnits;
}

/** One entry in an expense's `paidBy`. */
function payer(uid: string, amountMinor: number): Expense['paidBy'][number] {
  return { uid, amountMinor: minor(amountMinor) };
}

/** One entry in an expense's `splits`. */
function share(uid: string, amountMinor: number): Expense['splits'][number] {
  return { uid, amountMinor: minor(amountMinor), rawValue: null };
}
const MARCH = new Date(2025, 2, 10, 12).getTime();
const MARCH_LATER = new Date(2025, 2, 20, 12).getTime();
const APRIL = new Date(2025, 3, 5, 12).getTime();

function expense(overrides: Partial<Expense> = {}): Expense {
  return {
    id: 'e1',
    groupId: 'g1',
    description: 'Dinner',
    amountMinor: minor(3000),
    currency: 'USD' as CurrencyCode,
    category: 'food',
    date: ts(MARCH),
    paidBy: [payer('u1', 3000)],
    splitMethod: 'equal',
    splits: [share('u1', 1500), share('u2', 1500)],
    participantIds: ['u1', 'u2'],
    createdBy: 'u1',
    createdAt: ts(MARCH),
    updatedBy: null,
    updatedAt: ts(MARCH),
    deletedAt: null,
    commentCount: 0,
    lastCommentAt: null,
    ...overrides,
  } as unknown as Expense;
}

function settlement(overrides: Partial<Settlement> = {}): Settlement {
  return {
    id: 's1',
    groupId: 'g1',
    fromUid: 'u2',
    toUid: 'u1',
    amountMinor: minor(1500),
    currency: 'USD' as CurrencyCode,
    date: ts(MARCH),
    note: null,
    createdBy: 'u2',
    createdAt: ts(MARCH),
    deletedAt: null,
    ...overrides,
  } as unknown as Settlement;
}

/* ────────────────────────────────────────────────────────────────────────────────────────── *
 * myNetMinor
 * ────────────────────────────────────────────────────────────────────────────────────────── */

describe('myNetMinor', () => {
  it('is what you paid minus what you owe', () => {
    // Paid 30.00, owes 15.00 of it.
    expect(myNetMinor(expense(), 'u1')).toBe(1500);
    // Paid nothing, owes 15.00.
    expect(myNetMinor(expense(), 'u2')).toBe(-1500);
  });

  it('is zero for someone who is not in the expense at all', () => {
    expect(myNetMinor(expense(), 'stranger')).toBe(0);
  });

  it('is zero for a payer whose share happens to equal what they paid', () => {
    const solo = expense({
      paidBy: [payer('u1', 3000)],
      splits: [share('u1', 3000)],
      participantIds: ['u1'],
    });

    // 🔴 Same number as the stranger above, which is exactly why the screen asks `isInvolved`
    //    separately rather than reading "settled" off a zero.
    expect(myNetMinor(solo, 'u1')).toBe(0);
  });

  it('adds up every entry for the same person on both sides', () => {
    const split = expense({
      amountMinor: minor(4000),
      paidBy: [payer('u1', 1000), payer('u1', 3000)],
      splits: [share('u1', 1000), share('u1', 500), share('u2', 2500)],
      participantIds: ['u1', 'u2'],
    });

    expect(myNetMinor(split, 'u1')).toBe(4000 - 1500);
  });
});

describe('isInvolved', () => {
  it('counts a payer, a participant, and someone who is both', () => {
    expect(isInvolved(expense(), 'u1')).toBe(true);
    expect(isInvolved(expense(), 'u2')).toBe(true);
  });

  it('is false only for someone in neither array', () => {
    expect(isInvolved(expense(), 'stranger')).toBe(false);
  });

  it('is true for a payer who took no share', () => {
    const treat = expense({
      paidBy: [payer('u1', 3000)],
      splits: [share('u2', 3000)],
      participantIds: ['u2'],
    });

    expect(isInvolved(treat, 'u1')).toBe(true);
    expect(myNetMinor(treat, 'u1')).toBe(3000);
  });
});

/* ────────────────────────────────────────────────────────────────────────────────────────── *
 * buildLedger
 * ────────────────────────────────────────────────────────────────────────────────────────── */

describe('buildLedger', () => {
  const now = new Date(2026, 7, 30).getTime();

  it('returns nothing for an empty group', () => {
    expect(buildLedger([], [], now)).toEqual([]);
  });

  it('groups by calendar month, newest month first', () => {
    const months = buildLedger(
      [expense({ id: 'april', date: ts(APRIL) }), expense({ id: 'march', date: ts(MARCH) })],
      [],
      now,
    );

    expect(months.map((m) => m.key)).toEqual(['2025-04', '2025-03']);
    expect(months.map((m) => m.label)).toEqual(['April 2025', 'March 2025']);
  });

  it('merges settlements into the same chronological list, not a separate section', () => {
    const months = buildLedger(
      [expense({ id: 'e-march', date: ts(MARCH) })],
      [settlement({ id: 's-later', date: ts(MARCH_LATER) })],
      now,
    );

    expect(months).toHaveLength(1);
    expect(months[0]?.entries.map((e) => e.kind)).toEqual(['settlement', 'expense']);
  });

  it('orders newest first within a month', () => {
    const months = buildLedger(
      [expense({ id: 'early', date: ts(MARCH) }), expense({ id: 'late', date: ts(MARCH_LATER) })],
      [],
      now,
    );

    expect(months[0]?.entries.map((e) => e.id)).toEqual(['late', 'early']);
  });

  it('breaks same-day ties by id, so rows do not reshuffle between snapshots', () => {
    const forward = buildLedger([expense({ id: 'bbb' }), expense({ id: 'aaa' })], [], now);
    const reversed = buildLedger([expense({ id: 'aaa' }), expense({ id: 'bbb' })], [], now);

    expect(forward[0]?.entries.map((e) => e.id)).toEqual(['aaa', 'bbb']);
    expect(reversed[0]?.entries.map((e) => e.id)).toEqual(['aaa', 'bbb']);
  });

  it('keeps the same month in different years apart', () => {
    const months = buildLedger(
      [
        expense({ id: 'this-year', date: ts(new Date(2026, 2, 10, 12).getTime()) }),
        expense({ id: 'last-year', date: ts(MARCH) }),
      ],
      [],
      now,
    );

    expect(months.map((m) => m.key)).toEqual(['2026-03', '2025-03']);
    // Only the one outside the current year carries it.
    expect(months.map((m) => m.label)).toEqual(['March', 'March 2025']);
  });

  it('carries the original document through so rows need no second lookup', () => {
    const one = expense({ id: 'e-1', description: 'Kayaks' });
    const paid = settlement({ id: 's-1' });

    const [month] = buildLedger([one], [paid], now);
    const entries = month?.entries ?? [];

    const expenseEntry = entries.find((e) => e.kind === 'expense');
    const settlementEntry = entries.find((e) => e.kind === 'settlement');

    expect(expenseEntry?.kind === 'expense' && expenseEntry.expense.description).toBe('Kayaks');
    expect(settlementEntry?.kind === 'settlement' && settlementEntry.settlement.id).toBe('s-1');
  });
});
