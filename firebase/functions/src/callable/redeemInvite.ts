import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { Timestamp, db } from '../common/admin.js';
import { CALLABLE_OPTS, parseInput, requireAuth } from '../common/callable.js';
import { MAX_GROUP_MEMBERS } from '../common/config.js';
import { RedeemInviteSchema } from '../common/contracts.js';
import { logInfo } from '../common/logging.js';
import { summaries, writeActivityInTransaction } from '../lib/activity.js';
import { newMemberDoc, profileSnapshot, readGroupInTransaction } from '../lib/groups.js';

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
 * The doc's sequence, preserved exactly:
 *   1. look up by token        → not-found
 *   2. status === 'pending'    → failed-precondition
 *   3. expiresAt > now         → deadline-exceeded
 *   4. already a member        → SUCCESS, not an error (idempotent)
 *   5. memberCount < 50        → resource-exhausted
 *   6. one transaction: member doc + memberIds + invite status + activity
 *
 * Step 4 matters: double-tapping the join button must not error.
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
    throw new HttpsError(
      'failed-precondition',
      'This invite link has already been used or revoked.',
    );
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

    // Re-checked inside the transaction: two devices redeeming the same token at
    // the same time both passed the check above. Only one may consume the invite.
    const freshStatus = freshInvite.data()?.['status'];
    const alreadyAcceptedByMe =
      freshStatus === 'accepted' && freshInvite.data()?.['acceptedBy'] === uid;
    if (freshStatus !== 'pending' && !alreadyAcceptedByMe) {
      throw new HttpsError('failed-precondition', 'This invite link has already been used.');
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
    if (existingMember.exists) {
      // Rejoining after leaving. Only `leftAt` is cleared: the member document
      // survived the departure and still carries the balance history that
      // historical expenses depend on. Re-`set()`ing it would zero a live balance.
      tx.update(memberRef, {
        leftAt: null,
        displayName: profile.displayName,
        photoURL: profile.photoURL,
      });
    } else {
      tx.set(memberRef, newMemberDoc(uid, 'member', profile));
    }

    // memberCount is recomputed from the array rather than incremented — an
    // increment drifts permanently the first time it runs twice, and `arrayUnion`
    // is silently a no-op for an existing uid, which is exactly when the two would
    // disagree.
    const nextMemberIds = group.memberIds.includes(uid)
      ? group.memberIds
      : [...group.memberIds, uid];
    tx.update(db.doc(`groups/${groupId}`), {
      memberIds: nextMemberIds,
      memberCount: nextMemberIds.length,
    });

    tx.update(inviteSnap.ref, { status: 'accepted', acceptedBy: uid });

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
