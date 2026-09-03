import { FieldValue, db } from './admin.js';
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
    const groupSnap = await tx.get(db.doc(`groups/${gid}`));

    // 🔴 The friend projection, read here so that EVERY read still happens before ANY write.
    //
    // A friendship IS a group (D2), and its balance lives on that group's member documents
    // like anyone else's. But the Friends LIST cannot reach them: `firestore.rules` denies
    // collection-group reads on `members` (T9), so a client has no way to ask "my balance in
    // each of my friendships" in one query — and `settlements` is denied too, so it cannot
    // derive them from the ledger either. Without a projection the list can only show names.
    //
    // So `users/{uid}/friends/{fid}.balanceMinor` is written here, from the number this
    // function just computed. It is a PROJECTION, not a second computation: there is still
    // exactly one implementation of the money math (Article VI) and one authoritative cache
    // (the member document, Article III). This copies that answer where a query can see it.
    //
    // ⚠️ It can still go stale if this write is ever lost, which is why `auditBalances` now
    // checks it. Do not add a second *computation* here — recompute and project, always.
    const memberIds = membersSnap.docs.map((d) => d.id);
    const groupCurrency = groupSnap.data()?.['currency'];
    // 🔴 Keyed on the FRIEND DOCUMENTS, deliberately not on `isImplicit`.
    //
    // A friendship's group is promoted to an ordinary visible group the moment it gets its
    // first expense (ADR-13), which clears `isImplicit`. Gating on that flag meant the
    // projection stopped at exactly the point the pair started owing each other money — the
    // Friends list would have gone back to saying "Settled up", which is the bug the
    // projection was written to fix in the first place.
    //
    // The durable fact is "these two people's friendship points at this group", and that is
    // what `friends/{fid}.implicitGroupId` records, before and after promotion.
    const isPair = typeof groupCurrency === 'string' && memberIds.length === 2;

    const friendTargets = isPair
      ? memberIds.map((uid, index) => ({
          uid,
          ref: db.doc(`users/${uid}/friends/${String(memberIds[1 - index])}`),
        }))
      : [];
    // Only documents that already exist AND name this group are updated. `set({merge:true})`
    // would conjure a half-built friend document out of a balance write, and a two-person
    // group that is not a friendship must not touch either party's friend records at all.
    const friendSnaps = await Promise.all(friendTargets.map((target) => tx.get(target.ref)));

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

    friendTargets.forEach((target, index) => {
      const snap = friendSnaps[index];
      if (snap?.exists !== true) return;
      // The friendship must actually name THIS group. Two people can share an ordinary group
      // as well as a friendship; projecting the ordinary group's balance onto their friend
      // documents would overwrite the 1:1 figure with an unrelated one.
      if (snap.data()?.['implicitGroupId'] !== gid) return;
      tx.update(target.ref, {
        // 🔴 Sparse, exactly as `establishFriendship` seeds it: a settled pair is an EMPTY
        //    map, never `{ USD: 0 }`. Core's `balanceByCurrencySchema` is a sparse record and
        //    D6 forbids summing across it, so "no entries" has to keep meaning "settled".
        balanceMinor:
          (balances[target.uid] ?? 0) === 0
            ? {}
            : { [String(groupCurrency)]: balances[target.uid] ?? 0 },
        updatedAt: FieldValue.serverTimestamp(),
      });
    });
  });
}

export interface BalanceDrift {
  uid: string;
  storedMinor: number;
  computedMinor: number;
  deltaMinor: number;
}

/**
 * Does a friendship's `users/{uid}/friends/{fid}.balanceMinor` still agree with the member
 * documents it was projected from?
 *
 * 🔴 Why this needs checking even though the projection is written in the SAME transaction as
 * the member balances — which makes them atomic, so one cannot be lost without the other:
 *
 *   1. **Historical data.** Every friendship whose balance was last computed before the
 *      projection existed has a stale (usually empty) map, and a full recompute is the only
 *      thing that fixes it. Without this check the nightly audit skips exactly those groups,
 *      because their MEMBER balances are perfectly correct — the audit would report a clean
 *      system while the Friends list showed "Settled up" to someone who is owed money.
 *   2. **The existence skip.** `recomputeBalances` only updates friend documents that already
 *      exist, so a pair caught mid-repair projects onto one side and not the other.
 *
 * Read-only, and cheap: two document reads per friendship. Returns `false` for anything that
 * is not a 1:1 implicit group, so callers can run it over every group without filtering first.
 */
export async function hasFriendProjectionDrift(gid: string): Promise<boolean> {
  const groupSnap = await db.doc(`groups/${gid}`).get();
  const currency = groupSnap.data()?.['currency'];
  // Not gated on `isImplicit` — see the note in `recomputeBalances`. A friendship stops being
  // implicit the moment it is promoted (ADR-13) and its projection must keep working.
  if (typeof currency !== 'string') return false;

  const membersSnap = await db.collection(`groups/${gid}/members`).get();
  if (membersSnap.size !== 2) return false;

  const uids = membersSnap.docs.map((d) => d.id);
  const stored = new Map(
    membersSnap.docs.map((d) => [d.id, (d.data()['balanceMinor'] as number | undefined) ?? 0]),
  );

  for (const [index, uid] of uids.entries()) {
    const other = uids[1 - index];
    if (other === undefined) return false;

    const friendSnap = await db.doc(`users/${uid}/friends/${other}`).get();
    // A friendship with no friend document is a different problem — `repairGroupMembership`
    // territory — and not something a balance recompute can mend, so it is not drift here.
    if (!friendSnap.exists) continue;
    // Two people can share an ordinary group as well as a friendship. Only the group their
    // friendship actually names is projected, so only that one can be stale.
    if (friendSnap.data()?.['implicitGroupId'] !== gid) return false;

    const amount = stored.get(uid) ?? 0;
    const expected = amount === 0 ? {} : { [currency]: amount };
    const actual = (friendSnap.data()?.['balanceMinor'] as Record<string, number>) ?? {};

    // Compared as sparse maps: `{}` and `{ USD: 0 }` are NOT the same document, and treating
    // them as equal here would let a `{ USD: 0 }` written by an older version survive forever.
    const keys = new Set([...Object.keys(expected), ...Object.keys(actual)]);
    for (const key of keys) {
      if (expected[key] !== actual[key]) return true;
    }
  }

  return false;
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
