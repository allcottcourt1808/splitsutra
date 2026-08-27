import { compareUid } from './allocate.js';
import { computeBalances, type Balance, type BalanceMap } from './balances.js';
import { DomainError } from './errors.js';

/**
 * ============================================================================
 * Debt simplification (doc 04 §4).
 * ============================================================================
 *
 * Given net balances that sum to zero, produce a payment list that zeroes
 * everyone out in as few payments as is practical.
 *
 * ## This is a heuristic, not the optimum — deliberately
 *
 * Finding the true minimum number of transactions is **NP-hard** (it reduces to
 * partitioning the balances into zero-sum subsets). The greedy
 * max-creditor / max-debtor pairing below is what Splitwise itself does, and it
 * is bounded by `n − 1` payments, which for groups of ≤ 15 is indistinguishable
 * from optimal in practice.
 *
 * > Balances `A:+30, B:+10, C:−10, D:−30`. The optimum is 2 payments
 * > (D→A 30, C→B 10). Greedy also finds 2 here, but on adversarial inputs it can
 * > produce more.
 *
 * **Do not "fix" this into an exact solver.** The extra complexity buys nothing
 * at this scale, and an exponential algorithm on a settle-up screen is a hang,
 * not a feature. If you are reading this because the output looked one payment
 * longer than you expected: that is the documented, accepted behaviour.
 *
 * ## Product semantics (AC-E3.3, AC-E3.5)
 *
 * Simplification **never mutates the ledger**. It is a pure view over current
 * balances; expenses are untouched. It is display-only unless
 * `group.simplifyDebts` is on, and the UI must explain the substitution
 * (AC-E3.4) — "why am I paying Carol when I borrowed from Bob?" is the number
 * one confusion this feature creates.
 */

/** A suggested payment. Identical in effect to a recorded settlement (doc 03). */
export interface Transfer {
  readonly fromUid: string;
  readonly toUid: string;
  readonly amountMinor: number;
}

/** Mutable working copy of a balance, private to the greedy loop. */
interface Party {
  readonly uid: string;
  balanceMinor: number;
}

/**
 * Greedy max-creditor / max-debtor settlement.
 *
 * Repeatedly pairs the largest creditor with the largest debtor and moves the
 * smaller of the two magnitudes between them.
 *
 * Properties:
 * - **Terminates**, and produces **at most `n − 1` payments**: every iteration
 *   zeroes at least one party and permanently removes them. After `n − 1`
 *   removals one party remains, whose balance must be 0 because the total is 0.
 * - **Correct:** applying every payment leaves all balances at 0 (AC-E3.2).
 * - **Deterministic:** ties break on ascending uid, so the same input always
 *   yields the same output — important, because the settle-up screen must not
 *   reshuffle between renders.
 * - **Integer-only; no rounding ever occurs.** Every amount is a `Math.min` of
 *   two integers, so no minor unit is created or destroyed.
 * - **Pure:** the caller's balance objects are copied before the loop touches
 *   them. Doc 04's published snippet sorts `filter(...)` results — which are new
 *   arrays holding *the caller's objects* — and then decrements them in place,
 *   so it quietly zeroes the balances it was handed. That aliasing is fixed here;
 *   Article VII means this function cannot have a side effect on its input.
 *
 * Balances that are already zero are ignored, so an all-settled group returns
 * `[]`. Input that does not sum to zero is handled on a best-effort basis rather
 * than rejected: this runs in a render path, and a transiently inconsistent
 * snapshot should degrade to a shorter suggestion list, not a blank screen. Use
 * {@link assertZeroSum} on the write path where being loud is correct.
 *
 * @throws {DomainError} `NON_INTEGER_BALANCE` — a float balance means Article I
 *   was violated upstream, and every guarantee above rests on integer arithmetic.
 */
export function simplifyDebts(balances: readonly Balance[]): Transfer[] {
  for (const balance of balances) {
    if (!Number.isInteger(balance.balanceMinor)) {
      throw new DomainError(
        'NON_INTEGER_BALANCE',
        `Balances are integers in minor units, got ${balance.balanceMinor} ` +
          `for "${balance.uid}".`,
      );
    }
  }

  const copy = (balance: Balance): Party => ({
    uid: balance.uid,
    balanceMinor: balance.balanceMinor,
  });

  // Largest creditor first; largest debtor (most negative) first.
  const creditors: Party[] = balances
    .filter((balance) => balance.balanceMinor > 0)
    .map(copy)
    .sort((a, b) => b.balanceMinor - a.balanceMinor || compareUid(a.uid, b.uid));
  const debtors: Party[] = balances
    .filter((balance) => balance.balanceMinor < 0)
    .map(copy)
    .sort((a, b) => a.balanceMinor - b.balanceMinor || compareUid(a.uid, b.uid));

  const transfers: Transfer[] = [];

  // `shift()` rather than a moving index: it types as `Party | undefined`, which
  // the loop condition already has to handle, so there is no unreachable
  // undefined-check to satisfy `noUncheckedIndexedAccess`.
  let creditor = creditors.shift();
  let debtor = debtors.shift();

  while (creditor !== undefined && debtor !== undefined) {
    const amountMinor = Math.min(creditor.balanceMinor, -debtor.balanceMinor);

    transfers.push({ fromUid: debtor.uid, toUid: creditor.uid, amountMinor });

    creditor.balanceMinor -= amountMinor;
    debtor.balanceMinor += amountMinor;

    // At least one of these fires every iteration — `amountMinor` is the smaller
    // of the two magnitudes — which is what bounds the loop at `n − 1`.
    if (creditor.balanceMinor === 0) {
      creditor = creditors.shift();
    }
    if (debtor.balanceMinor === 0) {
      debtor = debtors.shift();
    }
  }

  return transfers;
}

/**
 * Applies transfers to a set of balances and returns the result, uid-ascending.
 *
 * A suggested transfer that someone actually makes gets recorded as a settlement,
 * so this delegates to {@link computeBalances} with the transfers *as*
 * settlements rather than re-implementing `from += amount; to −= amount`. One
 * implementation of the money math (Article VI) — and it means the sign
 * convention here cannot drift from the sign convention on the ledger.
 *
 * Used by the settle-up screen to preview "after these payments, everyone is at
 * zero", and by the property tests to prove exactly that (AC-E3.2).
 */
export function applyTransfers(
  balances: readonly Balance[],
  transfers: readonly Transfer[],
): Balance[] {
  const deltas: BalanceMap = computeBalances({
    expenses: [],
    settlements: transfers,
    memberIds: balances.map((balance) => balance.uid),
  });

  const net = new Map<string, number>();
  for (const balance of balances) {
    net.set(balance.uid, balance.balanceMinor);
  }
  for (const [uid, delta] of Object.entries(deltas)) {
    // `?? 0` covers a transfer naming somebody who is not in `balances` at all.
    net.set(uid, (net.get(uid) ?? 0) + delta);
  }

  return [...net]
    .map(([uid, balanceMinor]) => ({ uid, balanceMinor }))
    .sort((a, b) => compareUid(a.uid, b.uid));
}
