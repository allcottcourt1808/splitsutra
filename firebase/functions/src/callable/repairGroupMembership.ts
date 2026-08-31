import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { recomputeBalances } from '../common/balances.js';
import { CALLABLE_OPTS, parseInput, requireAuth } from '../common/callable.js';
import { RepairGroupMembershipSchema } from '../common/contracts.js';
import { db } from '../common/admin.js';
import { logError, logInfo } from '../common/logging.js';
import { newMemberDoc, profileSnapshot, requireGroup } from '../lib/groups.js';

/**
 * ============================================================================
 * repairGroupMembership — unbricks a group whose member document never landed
 * ============================================================================
 * `onGroupCreated` is the ONLY writer of a creator's `groups/{gid}/members/{uid}`
 * document, because `firestore.rules` makes that subcollection `allow write: if false`
 * for every client without exception (T2 + T4). That is the right rule. Its cost is a
 * single point of failure: if the trigger never runs — it was not deployed yet, the
 * deploy was mid-rollout, Eventarc dropped the event, the function failed permanently —
 * the group exists, appears in its creator's list (`allow list` reads `memberIds`, which
 * needs no member document), and then cannot be opened by anyone at all, because every
 * `/groups/{gid}/**` read is gated on `isMember()`, which is that missing document.
 *
 * There was no way out of that state. `recomputeGroupBalances` is the repair valve for a
 * wrong balance, but it calls `requireActiveMember` first — so the one endpoint that could
 * have helped is itself locked behind the document that is missing. Hit for real on
 * splitsutra-dev-eac96: every group created before the Functions deploy is unopenable.
 *
 * ## Why this grants nothing
 *
 * 🔴 The authorization is `uid ∈ group.memberIds`, and that is NOT a weaker check than
 *    reading the member document — it is the same claim, from the other copy.
 *    `firestore.rules` pins `memberIds == [creator]` at create, lists it in the immutable
 *    field set on update, and already trusts it alone for `allow list` on `/groups/{gid}`.
 *    Only Functions can widen it. So this call can only write down a membership the group
 *    document already asserts; it can never invent one.
 *
 * 🔴 Self-repair only. There is no `uid` parameter — the caller repairs themselves or
 *    nothing. Accepting a target uid would turn an idempotent fix into a way to mint
 *    member documents for other people, and the fact that it would still be constrained
 *    by `memberIds` is not a reason to hand out the capability.
 *
 * ## `role`
 *
 * `admin` when the caller created the group, `member` otherwise — the same rule
 * `onGroupCreated` applies. Anyone else in `memberIds` got there through `redeemInvite`,
 * which writes their member document in the same transaction as the `memberIds` update, so
 * in practice only the creator ever needs this.
 *
 * ## Balances come from the ledger, not from zero
 *
 * `newMemberDoc` seeds `balanceMinor: 0`, which is provably right for the bricked case (no
 * expense can exist without an active member document to authorize its creation). It is not
 * safe to ASSUME, so the repair finishes with a full `recomputeBalances` — Article V, the
 * ledger is the truth. `recomputeBalances` derives its member set from the member documents
 * themselves, so it has to run after the seed, not before, or it would recompute a group
 * with this person still missing from it.
 *
 * ## What it deliberately does NOT do
 *
 * It writes no `group.created` activity entry. The one `onGroupCreated` would have written
 * is genuinely lost, and backfilling it now would stamp today's timestamp on something that
 * happened days ago — a false record in the log T8 exists to keep honest. An incomplete feed
 * is better than a fabricated one.
 *
 * IDEMPOTENT. An existing member document is left completely alone and reported as
 * `repaired: false`. Never re-`set()` one: that resets a live `balanceMinor` to zero, which
 * is the T2 attack committed by our own code (see `newMemberDoc`).
 * ============================================================================
 */
export const repairGroupMembership = onCall(CALLABLE_OPTS, async (req) => {
  const uid = requireAuth(req);
  const { groupId } = parseInput(RepairGroupMembershipSchema, req.data);
  const ctx = { fn: 'repairGroupMembership', gid: groupId, uid };

  // `not-found` for missing or soft-deleted, before any membership check — the same order
  // and the same message every other callable uses, so a probe cannot tell a group that
  // does not exist from one the caller is simply not in.
  const group = await requireGroup(groupId);

  if (!group.memberIds.includes(uid)) {
    throw new HttpsError('permission-denied', 'You are not a member of this group.');
  }

  const memberRef = db.doc(`groups/${groupId}/members/${uid}`);
  const role = group.createdBy === uid ? 'admin' : 'member';
  const profile = await profileSnapshot(uid);

  const seeded = await db.runTransaction(async (tx) => {
    const existing = await tx.get(memberRef);
    if (existing.exists) return false;
    tx.set(memberRef, newMemberDoc(uid, role, profile));
    return true;
  });

  if (!seeded) {
    logInfo(ctx, 'membership repair requested — member document already existed');
    return { groupId, repaired: false, role, balancesRebuilt: false };
  }

  // ERROR, not INFO: every repair means a trigger did not do its job, and docs/10 alerts on
  // ERROR. This should be rare enough to investigate each time rather than a routine event.
  logError({ ...ctx, role }, 'MEMBERSHIP REPAIRED — onGroupCreated never seeded this member');

  // The membership repair is already committed and is the contract of this call. If the
  // rebuild fails on top of it the caller is still unbricked, so report the partial result
  // honestly rather than throwing away the fix — they can retry through "Balances look
  // wrong?", which is reachable now that the member document exists.
  let balancesRebuilt = true;
  try {
    await recomputeBalances(groupId);
  } catch (err) {
    balancesRebuilt = false;
    // ERROR, not WARN: a member document now exists carrying a balance nothing derived.
    // docs/10 alerts on ERROR and `logError` is the only level that serializes the stack —
    // the note in logging.ts about not downgrading balance failures to quieten a dashboard
    // applies exactly here.
    logError(
      ctx,
      'membership repaired but the balance rebuild failed — balances left at the seeded 0',
      err,
    );
  }

  return { groupId, repaired: true, role, balancesRebuilt };
});
