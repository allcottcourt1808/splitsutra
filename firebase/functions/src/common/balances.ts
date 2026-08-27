import { db } from './admin.js';
import { RECOMPUTE_THRESHOLD } from './config.js';
import { assertZeroSum, computeBalances } from './contracts.js';
import type { Expense, Settlement } from './contracts.js';
import { logWarn } from './logging.js';

/**
 * ============================================================================
 * THE BALANCE PIPELINE — the critical path (docs/06 §"The balance pipeline")
 * ============================================================================
 * Article III: the server owns the truth about balances. Article V: the ledger is
 * the truth and balances are a cache, rebuildable from it at any time.
 *
 * ADR-07 — FULL RECOMPUTE, NOT INCREMENTAL DELTAS. Three constraints drive it:
 *
 *   1. Idempotent.  Firestore triggers deliver AT LEAST ONCE. The same event may
 *      fire twice; recomputation must converge to the same answer.
 *   2. Transactional. Concurrent expense writes in one group must not interleave
 *      into a lost update.
 *   3. Self-healing. If a trigger is ever dropped, the next recompute repairs it
 *      fully.
 *
 * `balance += delta` is O(1) and drifts PERMANENTLY the first time an event is
 * missed or double-applied. Full recompute is O(expenses-in-group) and is
 * idempotent and self-correcting by construction. Correctness first; optimise on
 * measurement (Article XII).
 *
 * 🔴 Do not "optimise" this into deltas without the measurements Q2 asks for.
 * ============================================================================
 */

/**
 * Rebuilds every member balance in a group from its ledger, inside one transaction.
 *
 * Transaction limits respected (docs/06 §"Transaction limits"):
 *   - writes are one per member, capped at 50 by the group size limit, well under
 *     the 500-document transaction write cap;
 *   - all reads happen before any write;
 *   - the body has NO side effects outside the transaction, because transactions
 *     retry on contention and a retried side effect happens twice.
 */
export async function recomputeBalances(gid: string): Promise<void> {
  await db.runTransaction(async (tx) => {
    const expensesSnap = await tx.get(
      db.collection(`groups/${gid}/expenses`).where('deletedAt', '==', null),
    );
    const settlementsSnap = await tx.get(
      db.collection(`groups/${gid}/settlements`).where('deletedAt', '==', null),
    );
    const membersSnap = await tx.get(db.collection(`groups/${gid}/members`));

    // Q2 / docs/18 R5 — the one operation whose cost scales with group size.
    // Above the threshold ADR-07 calls for incremental deltas plus the nightly
    // audit as a backstop. Until that is built and MEASURED (Article XII), keep
    // recomputing — being slow and correct beats being fast and wrong — but say so
    // loudly enough that Phase 10 has real numbers to set the threshold from.
    if (expensesSnap.size > RECOMPUTE_THRESHOLD) {
      logWarn(
        { fn: 'recomputeBalances', gid, expenseCount: expensesSnap.size, RECOMPUTE_THRESHOLD },
        'group exceeds RECOMPUTE_THRESHOLD — full recompute is getting expensive ' +
          '(TODO(phase-10): incremental deltas + nightly audit, per Q2)',
      );
    }

    // Quarantined documents are excluded from the money. applyIntegrityResult in
    // common/integrity.ts sets that flag when a document's real split sums disagree
    // with its checksums — the layer-2 half of Q1 Option A. Excluding rather than
    // deleting keeps the audit trail (Article V) while stopping a forged expense
    // from moving anyone's balance.
    const expenses = expensesSnap.docs
      .map((d) => d.data())
      .filter((d) => d['integrityStatus'] !== 'quarantined') as unknown as Expense[];
    const settlements = settlementsSnap.docs
      .map((d) => d.data())
      .filter((d) => d['integrityStatus'] !== 'quarantined') as unknown as Settlement[];

    // ← the SAME pure function the client uses for optimistic UI (Article VI).
    // There is never a second implementation of the money math.
    const balances = computeBalances({
      expenses,
      settlements,
      memberIds: membersSnap.docs.map((d) => d.id),
    });

    // Fail loudly rather than write bad data. AC-E1.3: across all member docs in a
    // group, sum(balanceMinor) === 0, exactly. If this throws, the trigger fails,
    // Cloud Logging gets an ERROR, and the stored balances stay at their last good
    // value — which is far better than persisting a broken set.
    assertZeroSum(balances);

    for (const m of membersSnap.docs) {
      tx.update(m.ref, { balanceMinor: balances[m.id] ?? 0 });
    }
  });
}

export interface BalanceDrift {
  uid: string;
  storedMinor: number;
  computedMinor: number;
  deltaMinor: number;
}

/**
 * Read-only recompute used by `auditBalances`. Reports drift instead of repairing
 * it, so the caller can log the discrepancy BEFORE overwriting the evidence.
 */
export async function findBalanceDrift(gid: string): Promise<BalanceDrift[]> {
  const [expensesSnap, settlementsSnap, membersSnap] = await Promise.all([
    db.collection(`groups/${gid}/expenses`).where('deletedAt', '==', null).get(),
    db.collection(`groups/${gid}/settlements`).where('deletedAt', '==', null).get(),
    db.collection(`groups/${gid}/members`).get(),
  ]);

  const expenses = expensesSnap.docs
    .map((d) => d.data())
    .filter((d) => d['integrityStatus'] !== 'quarantined') as unknown as Expense[];
  const settlements = settlementsSnap.docs
    .map((d) => d.data())
    .filter((d) => d['integrityStatus'] !== 'quarantined') as unknown as Settlement[];

  const computed = computeBalances({
    expenses,
    settlements,
    memberIds: membersSnap.docs.map((d) => d.id),
  });

  // Asserted independently of the write path — this is the point of the audit.
  assertZeroSum(computed);

  const drift: BalanceDrift[] = [];
  for (const m of membersSnap.docs) {
    const storedMinor = Number((m.data() as { balanceMinor?: unknown }).balanceMinor ?? 0);
    const computedMinor = computed[m.id] ?? 0;
    if (storedMinor !== computedMinor) {
      drift.push({
        uid: m.id,
        storedMinor,
        computedMinor,
        deltaMinor: computedMinor - storedMinor,
      });
    }
  }
  return drift;
}
