import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { db } from '../common/admin.js';
import { CALLABLE_OPTS, parseInput, requireActiveMember, requireAuth } from '../common/callable.js';
import { MAX_GROUP_MEMBERS } from '../common/config.js';
import { AddFriendToGroupSchema } from '../common/contracts.js';
import { logInfo } from '../common/logging.js';
import { summaries, writeActivityInTransaction } from '../lib/activity.js';
import {
  addMemberInTransaction,
  profileSnapshot,
  readGroupInTransaction,
  requireGroup,
} from '../lib/groups.js';

/**
 * addFriendToGroup — put an existing friend straight into a group. No link, no acceptance.
 *
 * ## 🔴 Why auto-approval is safe here, and only here
 *
 * `friendRequests` exists for a specific reason, recorded in `firestore.rules`: before it,
 * "anyone who knew your email could put themselves in a shared group with you and you had no way
 * to refuse". That guarantee is about **strangers**, and this function does not weaken it,
 * because it refuses unless the target is already the caller's **confirmed friend** — somebody
 * who has already accepted a request and thereby agreed to share expenses with them.
 *
 * The friendship check is the whole security argument. Without it this is the exact attack the
 * consent step was built to stop, so it is a hard precondition and not a convenience:
 * `users/{caller}/friends/{target}` must exist. That document is written only by
 * `establishFriendship`, inside the transaction that records the acceptance, so it cannot be
 * forged from a client — `users/{uid}/friends/{fid}` is `allow write: if false`.
 *
 * ⚠️ What the friend gives up by being a friend: any friend can put them in a group with people
 * they do not know, which exposes their display name and photo to that group. That is the
 * residual risk of the product decision, it is what comparable apps do, and `leaveGroup` is the
 * out. It is written down here so nobody has to rediscover the trade by reading the diff.
 *
 * ## Membership is not re-implemented
 *
 * The member document, `memberIds` and `memberCount` all go through
 * `addMemberInTransaction` — the same code `redeemInvite` uses. A second copy is how one of
 * them forgets the "already exists" check and re-`set()`s a member document that still holds a
 * live balance.
 *
 * ## Idempotent
 *
 * Adding somebody who is already an active member is a success with `alreadyMember: true` and no
 * writes. A double tap on a list row is not an error, and a retry after a dropped response must
 * not produce a second activity entry.
 */
export const addFriendToGroup = onCall(CALLABLE_OPTS, async (req) => {
  const callerUid = requireAuth(req);
  const { groupId, uid: targetUid } = parseInput(AddFriendToGroupSchema, req.data);

  if (targetUid === callerUid) {
    throw new HttpsError('invalid-argument', 'You are already in this group.');
  }

  const group = await requireGroup(groupId);
  const caller = await requireActiveMember(groupId, callerUid);

  // 🔴 The consent check. See the header — this is the entire reason auto-approval is not the
  // attack `friendRequests` was built to prevent.
  const friendship = await db.doc(`users/${callerUid}/friends/${targetUid}`).get();
  if (!friendship.exists) {
    throw new HttpsError(
      'permission-denied',
      'You can only add people who are already your friends. Send them a friend request first, ' +
        'or share an invite link instead.',
    );
  }

  if (!group.memberIds.includes(targetUid) && group.memberIds.length >= MAX_GROUP_MEMBERS) {
    throw new HttpsError(
      'resource-exhausted',
      `This group is full (${MAX_GROUP_MEMBERS} members).`,
    );
  }

  const profile = await profileSnapshot(targetUid);

  // Outside the transaction so a retry reuses the same id and cannot write the entry twice —
  // same reasoning as `leaveGroup` and `removeMember`.
  const activityId = `member.joined__${targetUid}__${Date.now()}`;

  const outcome = await db.runTransaction(async (tx) => {
    const freshGroup = await readGroupInTransaction(tx, groupId);
    if (freshGroup === null || freshGroup.deletedAt !== null) {
      throw new HttpsError('not-found', 'That group no longer exists.');
    }

    const existingMember = await tx.get(db.doc(`groups/${groupId}/members/${targetUid}`));
    const alreadyActive = existingMember.exists && existingMember.data()?.['leftAt'] == null;
    if (alreadyActive) {
      return { alreadyMember: true, memberCount: freshGroup.memberIds.length };
    }

    const nextMemberIds = addMemberInTransaction(
      tx,
      groupId,
      targetUid,
      profile,
      freshGroup.memberIds,
      existingMember,
    );

    // In the SAME transaction as the join. A feed entry that commits while the join rolls back
    // asserts something that never happened (T8 cuts both ways).
    //
    // The actor is the person who did it, not the person added — `summaries.memberAdded` reads
    // "Alice added Bob", because Bob did nothing and a feed saying he joined asks him to
    // remember an action he never took.
    writeActivityInTransaction(tx, groupId, activityId, {
      type: 'member.joined',
      actorUid: callerUid,
      actorName: caller.displayName,
      targetId: targetUid,
      summary: summaries.memberAdded(caller.displayName, profile.displayName),
      amountMinor: null,
      currency: null,
    });

    return { alreadyMember: false, memberCount: nextMemberIds.length };
  });

  logInfo(
    { fn: 'addFriendToGroup', gid: groupId, uid: callerUid, targetUid, ...outcome },
    outcome.alreadyMember ? 'friend was already a member' : 'friend added to group',
  );

  return {
    groupId,
    uid: targetUid,
    displayName: profile.displayName,
    alreadyMember: outcome.alreadyMember,
    memberCount: outcome.memberCount,
  };
});
