/**
 * The group ledger — expenses and recorded payments merged into one chronological list, grouped
 * by month (docs/07 §GroupDetail).
 *
 * ## Why this is a module and not JSX
 *
 * Merging two independently-ordered lists, resolving ties, grouping by calendar month and
 * working out what an expense did to *your* balance are four decisions with edge cases, and all
 * four are invisible in a rendered tree. Pure functions over plain data can be tested for the
 * cases that actually bite — an expense you did not participate in, a payer who is also the only
 * participant, two entries on the same day — without mounting anything.
 *
 * It lives beside the screen rather than in `packages/core/src/utils` because it is presentation
 * shape, not domain truth: nothing here computes a balance, and nothing here is allowed to. The
 * numbers it reports are read straight off the stored `paidBy` and `splits` arrays, which the
 * server has already verified (Article III — `onExpenseWritten` recomputes and quarantines
 * anything whose arrays do not add up).
 */

import { monthKey, formatMonthLabel } from '@splitsutra/core';
import type { Expense, Settlement } from '@splitsutra/core';

/** One row in the ledger. Discriminated, because the two kinds render nothing alike. */
export type LedgerEntry =
  | {
      readonly kind: 'expense';
      readonly id: string;
      readonly whenMillis: number;
      readonly expense: Expense;
    }
  | {
      readonly kind: 'settlement';
      readonly id: string;
      readonly whenMillis: number;
      readonly settlement: Settlement;
    };

/** A month's worth of rows, newest first, under one heading. */
export interface LedgerMonth {
  /** `"2026-08"` — the grouping identity, and a stable React key. */
  readonly key: string;
  /** `"August"`, or `"August 2025"` outside the current year. */
  readonly label: string;
  readonly entries: readonly LedgerEntry[];
}

/**
 * What an expense did to the reader's position in the group: what they paid, minus their share.
 *
 * Positive means they are owed (they covered more than their share), negative means they owe,
 * and zero covers both "settled exactly" and "not involved at all" — which the caller separates
 * with {@link isInvolved}, because those two deserve different words.
 *
 * 🔴 This is a *display* figure for one expense, not a balance. The group balance is the
 *    server's (Article III) and is read from the member documents; summing these rows would be a
 *    second implementation of the money math and would disagree the moment a settlement lands.
 */
export function myNetMinor(expense: Expense, uid: string): number {
  const paid = expense.paidBy
    .filter((payer) => payer.uid === uid)
    .reduce((total, payer) => total + payer.amountMinor, 0);
  const owed = expense.splits
    .filter((split) => split.uid === uid)
    .reduce((total, split) => total + split.amountMinor, 0);

  return paid - owed;
}

/** Did this person pay into, or take a share of, this expense? */
export function isInvolved(expense: Expense, uid: string): boolean {
  return (
    expense.paidBy.some((payer) => payer.uid === uid) ||
    expense.splits.some((split) => split.uid === uid)
  );
}

/**
 * Merge expenses and settlements into month sections, newest first.
 *
 * Both inputs arrive already sorted newest-first by their own subscription, but they arrive from
 * two separate queries, so the merged order has to be re-established here rather than assumed.
 *
 * **Ties break by id, not by arrival.** Two entries dated the same day — which is the normal
 * case, since `date` is a day the user picked rather than a write time — would otherwise sort
 * differently on each snapshot and make rows jump around while somebody is reading them.
 */
export function buildLedger(
  expenses: readonly Expense[],
  settlements: readonly Settlement[],
  now: number = Date.now(),
): readonly LedgerMonth[] {
  const entries: LedgerEntry[] = [
    ...expenses.map((expense): LedgerEntry => ({
      kind: 'expense',
      id: expense.id,
      whenMillis: expense.date.toMillis(),
      expense,
    })),
    ...settlements.map((settlement): LedgerEntry => ({
      kind: 'settlement',
      id: settlement.id,
      whenMillis: settlement.date.toMillis(),
      settlement,
    })),
  ];

  entries.sort((a, b) => b.whenMillis - a.whenMillis || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const months: LedgerMonth[] = [];
  for (const entry of entries) {
    const key = monthKey(entry.whenMillis);
    const current = months[months.length - 1];

    // The list is already in date order, so a month can only ever be the last one opened — no
    // map, and no second pass to put the sections back in order.
    if (current !== undefined && current.key === key) {
      (current.entries as LedgerEntry[]).push(entry);
      continue;
    }

    months.push({ key, label: formatMonthLabel(entry.whenMillis, now), entries: [entry] });
  }

  return months;
}
