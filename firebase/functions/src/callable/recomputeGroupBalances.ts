import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { findBalanceDrift, recomputeBalances } from '../common/balances.js';
import { CALLABLE_OPTS, parseInput, requireActiveMember, requireAuth } from '../common/callable.js';
import { RecomputeGroupBalancesSchema } from '../common/contracts.js';
import { logError, logInfo, logWarn } from '../common/logging.js';
import { requireGroup } from '../lib/groups.js';

/**
 * ============================================================================
 * recomputeGroupBalances — the "Balances look wrong?" button
 * ============================================================================
 * docs/06 §"recomputeGroupBalances": "Manual repair valve, callable by any group
 * member. Runs the same `recomputeBalances`." docs/07 §"Group settings" puts it
 * behind a "Balances look wrong?" affordance; docs/02 lists it as the mitigation
 * for balance recompute lagging under load.
 *
 * 🔴 IT REUSES `common/balances.ts`. IT DOES NOT REIMPLEMENT ANYTHING.
 *
 *    Article VI: the balance computation exists once, in `core/src/domain/`, and
 *    reaches this package through `recomputeBalances()` — the same function the
 *    expense and settlement triggers call. A "quick" repair variant written here
 *    would be a second implementation of the money math, and the moment it drifted
 *    from the real one this button would confidently write the WRONG balances over
 *    the right ones. That is a worse failure than the drift it was built to fix.
 *
 * 🔴 IT DERIVES FROM THE LEDGER, NEVER FROM THE CACHE. Article V: expenses and
 *    settlements are the truth; `balanceMinor` is a cache. `recomputeBalances`
 *    reads the ledger and overwrites every member document from it — the stored
 *    balances are an OUTPUT of this call and are never an input to it. Anything
 *    that folded the existing values in (a delta, a reconciliation, a "only fix
 *    what looks wrong") would carry the corruption forward, which is precisely the
 *    state this exists to escape.
 *
 * IDEMPOTENT BY CONSTRUCTION (ADR-07). A full recompute converges to the same
 * answer however many times it runs, which is why it is safe to hand to a user as a
 * button. Running it on healthy balances is a no-op that costs reads.
 * ============================================================================
 */
export const recomputeGroupBalances = onCall(CALLABLE_OPTS, async (req) => {
  const uid = requireAuth(req);
  const { groupId } = parseInput(RecomputeGroupBalancesSchema, req.data);
  const ctx = { fn: 'recomputeGroupBalances', gid: groupId, uid };

  // Any ACTIVE member, per docs/06 — not admin-only. Recomputing cannot make a
  // balance wrong (it can only replace a cache with the ledger's own answer), and
  // the person who noticed the wrong number is rarely the admin. `requireActiveMember`
  // rather than `requireGroup`'s membership: someone who has LEFT should not be able
  // to spend the group's read budget on demand.
  await requireActiveMember(groupId, uid);

  // `not-found` for a soft-deleted group. Repairing the balances of a group that has
  // been deleted is an operator task, not a user flow, and the client has no screen
  // for it — see the note in deleteGroup about the trigger-lag race, which is the one
  // case where an operator would want to run this out of band.
  const group = await requireGroup(groupId);

  // TODO(phase-10): rate-limit per (uid, groupId). docs/17 §"Rate limiting" names
  // this class of endpoint — a user hammering it costs O(expenses) reads per press.
  // `maxInstances` (Article XI) bounds the spend rate but not the per-user abuse, and
  // the guard belongs with the other Phase 10 knobs rather than as an unmeasured
  // guess here.

  // ⚠️ Deliberately TWO passes over the ledger, at roughly double the read cost.
  //
  //    `findBalanceDrift` is the read-only recompute: it reports the discrepancy
  //    instead of repairing it, so the difference can be logged BEFORE the repair
  //    overwrites the evidence. A silent self-heal is how a real money bug stays
  //    invisible — the whole point of surfacing this to users is that each press is
  //    a signal that something upstream dropped a trigger. docs/10 alerts on ERROR.
  let drift;
  try {
    drift = await findBalanceDrift(groupId);
  } catch (err) {
    // `findBalanceDrift` calls `assertZeroSum` on what it computed. If THAT throws,
    // the ledger itself does not sum to zero (AC-E1.3) and no recompute can fix it —
    // writing the result would persist a broken set. Refuse and escalate.
    logError(ctx, 'ledger audit failed — balances NOT rebuilt', err);
    throw new HttpsError(
      'internal',
      'Balances could not be rebuilt. This has been logged for investigation.',
    );
  }

  if (drift.length > 0) {
    logError(
      { ...ctx, driftCount: drift.length, drift },
      'BALANCE DRIFT — stored balances disagreed with the ledger; repairing',
    );
  }

  // No transaction HERE: `recomputeBalances` runs its own, reading the whole ledger
  // and writing every member document inside it (all reads before any write, one
  // write per member, capped at 50 by the group size limit). Wrapping it in a second
  // transaction would nest one inside another, which Firestore does not support.
  try {
    await recomputeBalances(groupId);
  } catch (err) {
    logError(ctx, 'recompute failed — stored balances left at their last good value', err);
    throw new HttpsError(
      'internal',
      'Balances could not be rebuilt. This has been logged for investigation.',
    );
  }

  if (drift.length === 0) {
    logInfo(ctx, 'recompute requested — balances already matched the ledger');
  } else {
    logWarn({ ...ctx, driftCount: drift.length }, 'recompute repaired drifted balances');
  }

  // Counts, not amounts. The caller can read every member's `balanceMinor` directly
  // (rules allow `members` reads to members) and has a live listener on them, so
  // echoing the numbers back would duplicate a source of truth the UI already has —
  // and a stale copy of a balance in a response payload is exactly the kind of second
  // answer Article III exists to prevent.
  return {
    groupId,
    currency: group.currency,
    repaired: drift.length > 0,
    driftCount: drift.length,
  };
});
