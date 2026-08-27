import { compareUid } from './allocate.js';
import { DomainError } from './errors.js';

/**
 * ============================================================================
 * Balance computation (doc 04 §3).
 * ============================================================================
 *
 * ## Sign convention — read this before changing anything below
 *
 * ```
 * balanceMinor > 0  →  this person is OWED money   (net creditor)
 * balanceMinor < 0  →  this person OWES money      (net debtor)
 * balanceMinor === 0 → settled up
 * ```
 *
 * Written out because a flipped sign here is the kind of bug that looks entirely
 * plausible in the UI — every number still renders, every total still balances,
 * and the app simply tells everybody the opposite of the truth. The same
 * convention is baked into `groups/{gid}/members/{uid}.balanceMinor` (doc 03),
 * into `simplifyDebts`, and into the settle-up copy. It is not negotiable and it
 * is not a matter of taste.
 *
 * ## Article V — the ledger is the truth, balances are a cache
 *
 * This function is a pure fold over expenses and settlements. It is called by the
 * Cloud Function inside a transaction to produce the authoritative value, and by
 * the client for optimistic display; both call *this* function (Article VI). It
 * never reads a stored balance, which is what makes a full recompute
 * self-healing: any drift is erased on the next write.
 */

/** One payer's contribution to an expense. */
export interface PaidByEntry {
  readonly uid: string;
  readonly amountMinor: number;
}

/** One participant's resolved share of an expense. */
export interface SplitEntry {
  readonly uid: string;
  readonly amountMinor: number;
}

/**
 * The parts of an expense that affect balances.
 *
 * Deliberately structural and minimal: the full `Expense` document (doc 03)
 * satisfies it, but so does an optimistic in-memory draft that has no id or
 * timestamps yet. The domain layer must not depend on Firestore types
 * (Articles II and VII), so `deletedAt` is `unknown` — any non-null value means
 * "soft-deleted", whatever the transport represents a timestamp as.
 */
export interface LedgerExpense {
  readonly paidBy: readonly PaidByEntry[];
  readonly splits: readonly SplitEntry[];
  readonly deletedAt?: unknown;
}

/** The parts of a settlement that affect balances. */
export interface LedgerSettlement {
  readonly fromUid: string;
  readonly toUid: string;
  readonly amountMinor: number;
  readonly deletedAt?: unknown;
}

/** Everything needed to derive a group's balances. */
export interface Ledger {
  readonly expenses: readonly LedgerExpense[];
  readonly settlements: readonly LedgerSettlement[];
  /**
   * Current members. Optional — supplying it guarantees every member appears in
   * the result (as `0` if they have no activity), which is what the group
   * balances screen and the Cloud Function's member write-back both want.
   */
  readonly memberIds?: readonly string[];
}

/** uid → net balance in minor units, in the group currency. */
export type BalanceMap = Record<string, number>;

/** A uid and their net balance, the shape `simplifyDebts` consumes. */
export interface Balance {
  readonly uid: string;
  readonly balanceMinor: number;
}

/**
 * True when a ledger document has been soft-deleted.
 *
 * Callers normally filter with `where('deletedAt', '==', null)` before getting
 * here (doc 06), but Article V says nothing is ever hard-deleted, so a deleted
 * document that slips through must contribute nothing rather than silently
 * reversing somebody's balance.
 */
function isDeleted(document: { readonly deletedAt?: unknown }): boolean {
  return document.deletedAt !== null && document.deletedAt !== undefined;
}

/**
 * Computes every participant's net balance from the ledger.
 *
 * ```
 * for each non-deleted expense:
 *     for each payer p:   balance[p.uid] += p.amountMinor
 *     for each split s:   balance[s.uid] -= s.amountMinor
 *
 * for each non-deleted settlement:
 *     balance[fromUid] += amountMinor    // paying down what you owe moves you toward 0
 *     balance[toUid]   -= amountMinor
 * ```
 *
 * **The result always sums to exactly zero** (AC-E1.3), by construction: each
 * expense contributes `sum(paidBy) − sum(splits) = total − total = 0` and each
 * settlement contributes `+amount − amount = 0`. A sum of zeros is zero. That
 * holds *provided* the doc 03 validation invariants hold — which is exactly why
 * they are enforced in Security Rules and in the Function, not only in the client.
 *
 * A uid that appears in the ledger but not in `memberIds` is still included.
 * Dropping it would make the money it moved vanish and would break the zero-sum
 * invariant, turning a membership bug into an arithmetic one; better that a
 * departed member shows up with a non-zero balance where somebody can see it.
 *
 * @returns A plain object so callers can do `balances[uid] ?? 0`, matching the
 *   Cloud Function's member write-back in doc 06.
 */
export function computeBalances(ledger: Ledger): BalanceMap {
  const balances = new Map<string, number>();

  const add = (uid: string, delta: number): void => {
    balances.set(uid, (balances.get(uid) ?? 0) + delta);
  };

  // Seed every current member at zero so "no activity" reads as "settled up"
  // rather than as a missing key.
  for (const uid of ledger.memberIds ?? []) {
    add(uid, 0);
  }

  for (const expense of ledger.expenses) {
    if (isDeleted(expense)) {
      continue;
    }
    for (const payer of expense.paidBy) {
      add(payer.uid, payer.amountMinor);
    }
    for (const split of expense.splits) {
      add(split.uid, -split.amountMinor);
    }
  }

  for (const settlement of ledger.settlements) {
    if (isDeleted(settlement)) {
      continue;
    }
    add(settlement.fromUid, settlement.amountMinor);
    add(settlement.toUid, -settlement.amountMinor);
  }

  return Object.fromEntries(balances);
}

/**
 * Converts a {@link BalanceMap} into a uid-ascending list.
 *
 * Sorted because `Object.keys` insertion order depends on the order documents
 * came back from Firestore, and a settle-up screen that reorders itself between
 * renders looks broken even when the numbers are right.
 */
export function toBalanceList(balances: BalanceMap): Balance[] {
  return Object.entries(balances)
    .map(([uid, balanceMinor]) => ({ uid, balanceMinor }))
    .sort((a, b) => compareUid(a.uid, b.uid));
}

/**
 * Throws unless the balances sum to exactly zero (AC-E1.3).
 *
 * The Cloud Function calls this before writing member documents: failing loudly
 * beats persisting a group that can never settle up. It is the one assertion in
 * the system that catches essentially every class of money bug at once, so it is
 * cheap at any frequency.
 *
 * @throws {DomainError} `ZERO_SUM_VIOLATION`
 */
export function assertZeroSum(balances: BalanceMap): void {
  const sum = Object.values(balances).reduce((total, balance) => total + balance, 0);
  if (sum !== 0) {
    throw new DomainError(
      'ZERO_SUM_VIOLATION',
      `Group balances must sum to exactly 0, got ${sum}. ` +
        'The ledger is inconsistent — recompute rather than patch (Article V).',
    );
  }
}
