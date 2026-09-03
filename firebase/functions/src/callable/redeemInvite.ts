import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { Timestamp, db } from '../common/admin.js';
import { CALLABLE_OPTS, parseInput, requireAuth } from '../common/callable.js';
import { MAX_GROUP_MEMBERS } from '../common/config.js';
import { RedeemInviteSchema } from '../common/contracts.js';
import { logInfo } from '../common/logging.js';
import { summaries, writeActivityInTransaction } from '../lib/activity.js';
import { addMemberInTransaction, profileSnapshot, readGroupInTransaction } from '../lib/groups.js';

/**
 * ============================================================================
 * redeemInvite — the only way anybody joins a group
 * ============================================================================
 * docs/06 §"redeemInvite". Why it must be server-side, in the doc's own words: a
 * client cannot add itself to `groups/{gid}/members` because rules deny it (T4),
 * and it cannot even read the group to check the invite. Only the Admin SDK can
 * bridge that gap.
 *
 * 🔴 Which means every authorization decision on this path is made HERE, in code.
 *    `firestore.rules` is not consulted for anything this function does. The token
 *    is the entire credential (`invites/{id}` is unreadable to clients), so the
 *    order of the checks below is the access-control policy.
 *
 * The doc's sequence:
 *   1. look up by token        → not-found
 *   2. status === 'pending'    → failed-precondition
 *   3. expiresAt > now         → deadline-exceeded
 *   4. already a member        → SUCCESS, not an error (idempotent)
 *   5. memberCount < 50        → resource-exhausted
 *   6. one transaction: member doc + memberIds + invite redemption record + activity
 *
 * Step 4 matters: double-tapping the join button must not error.
 *
 * ## 🔴 An invite is no longer consumed by being used
 *
 * This used to set `status: accepted` in step 6, which meant the second person to click a
 * shared link was told it "has already been used" — for the most obvious way anyone would
 * ever use one, pasting it into a group chat. The link now stays `pending` and the redeemer
 * is appended to `redeemedBy`.
 *
 * What that changes about the threat model, stated plainly: a leaked token is now good for
 * everyone who sees it, not for one person, until it expires or is reset. Two things bound it
 * and neither is the click count — the group's own ceiling (step 5 refuses the 51st member,
 * whichever link they hold) and `expiresAt`. The third is that the link can be revoked, which
 * is why `createInvite` grew a reset in the same change.
 *
 * Concurrency got SIMPLER, not harder. The old in-transaction re-read existed to make sure
 * only one of two simultaneous redemptions consumed the token; there is nothing to consume
 * now, so both may proceed. The re-read stays for a different reason: the link may have been
 * revoked or reset between the check above and the write below, and the credential has to be
 * judged on the value being acted upon.
 * ============================================================================
 */
export const redeemInvite = onCall(CALLABLE_OPTS, async (req) => {
  const uid = requireAuth(req);
  const { token } = parseInput(RedeemInviteSchema, req.data);

  // --- 1. look up by token ---------------------------------------------------
  const matches = await db.collection('invites').where('token', '==', token).limit(1).get();
  const inviteSnap = matches.docs[0];
  if (inviteSnap === undefined) {
    throw new HttpsError('not-found', 'This invite link is not valid.');
  }
  const invite = inviteSnap.data();
  const groupId = invite['groupId'];
  if (typeof groupId !== 'string' || groupId.length === 0) {
    throw new HttpsError('not-found', 'This invite link is not valid.');
  }
  const ctx = { fn: 'redeemInvite', gid: groupId, uid, inviteId: inviteSnap.id };

  // --- 2. status -------------------------------------------------------------
  if (invite['status'] !== 'pending') {
    // Covers a reset link, a revoked one, and an invite already spent under the old
    // single-use rule. One message for all three: which of them it is tells the holder
    // something about a group they are not in.
    throw new HttpsError('failed-precondition', 'This invite link is no longer active.');
  }

  // --- 3. expiry -------------------------------------------------------------
  const expiresAt = invite['expiresAt'];
  if (!(expiresAt instanceof Timestamp) || expiresAt.toMillis() <= Date.now()) {
    // Flip the stored status so the next reader gets the same answer without this
    // arithmetic, guarded so a concurrent acceptance is not overwritten.
    await inviteSnap.ref.update({ status: 'expired' }).catch(() => undefined);
    throw new HttpsError('deadline-exceeded', 'This invite link has expired.');
  }

  const profile = await profileSnapshot(uid);
  const memberRef = db.doc(`groups/${groupId}/members/${uid}`);

  const outcome = await db.runTransaction(async (tx) => {
    // ---- reads (all of them, before any write) ------------------------------
    const [freshInvite, group, existingMember] = await Promise.all([
      tx.get(inviteSnap.ref),
      readGroupInTransaction(tx, groupId),
      tx.get(memberRef),
    ]);

    if (group === null || group.deletedAt !== null) {
      throw new HttpsError('not-found', 'That group no longer exists.');
    }

    // Re-checked inside the transaction against the freshly read document, because the link
    // may have been revoked or reset since the check above. Not a race over consuming a
    // ticket — several people may redeem the same link at once and all of them should get in.
    const fresh = freshInvite.data();
    if (fresh?.['status'] !== 'pending') {
      throw new HttpsError('failed-precondition', 'This invite link is no longer active.');
    }

    // --- 4. already a member -> idempotent success --------------------------
    const memberData = existingMember.data();
    const isActiveMember = existingMember.exists && memberData?.['leftAt'] == null;
    if (isActiveMember) {
      return { alreadyMember: true, groupName: group.name };
    }

    // --- 5. capacity (Q2: 50 members) ---------------------------------------
    if (!group.memberIds.includes(uid) && group.memberIds.length >= MAX_GROUP_MEMBERS) {
      throw new HttpsError(
        'resource-exhausted',
        `This group is full (${MAX_GROUP_MEMBERS} members).`,
      );
    }

    // --- 6. writes -----------------------------------------------------------
    // Shared with `addFriendToGroup`: the member document, `memberIds` and `memberCount` are
    // written the same way by every path that adds somebody, so there is one place that knows
    // not to re-`set()` a member document holding a live balance.
    addMemberInTransaction(tx, groupId, uid, profile, group.memberIds, existingMember);

    // Appended, not overwritten, and the status is left alone — the link stays open for the
    // next person. Deduplicated by hand rather than with arrayUnion so the length below is
    // the length that will be stored, and so a rejoin does not list the same uid twice.
    //
    // The cap is the same ceiling step 5 enforces, restated on the array because that array
    // is what actually grows (Article XI: a document a group can cause writes to needs a
    // stated bound). Reaching it is unreachable in practice — you cannot redeem without
    // becoming a member, and step 5 stops the 51st — so it is a guard, not a code path.
    const previous = Array.isArray(fresh['redeemedBy'])
      ? (fresh['redeemedBy'] as string[]).filter((id): id is string => typeof id === 'string')
      : [];
    const redeemedBy = previous.includes(uid) ? previous : [...previous, uid];
    if (redeemedBy.length <= MAX_GROUP_MEMBERS) {
      tx.update(inviteSnap.ref, { redeemedBy });
    }

    // In the SAME transaction as the join. A feed entry that commits while the join
    // rolls back asserts something that never happened (T8 cuts both ways).
    writeActivityInTransaction(tx, groupId, `member.joined__${uid}__${inviteSnap.id}`, {
      type: 'member.joined',
      actorUid: uid,
      actorName: profile.displayName,
      targetId: uid,
      summary: summaries.memberJoined(profile.displayName),
      amountMinor: null,
      currency: null,
    });

    return { alreadyMember: false, groupName: group.name };
  });

  if (outcome.alreadyMember) {
    logInfo(ctx, 'redeemInvite was a no-op — caller is already a member');
  } else {
    logInfo(ctx, 'member joined group via invite');
  }

  return { groupId, groupName: outcome.groupName, alreadyMember: outcome.alreadyMember };
});
