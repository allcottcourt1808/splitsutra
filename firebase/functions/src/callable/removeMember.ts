import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { db } from '../common/admin.js';
import {
  CALLABLE_OPTS,
  parseInput,
  requireActiveMember,
  requireAuth,
  requireGroupAdmin,
  requireZeroBalance,
} from '../common/callable.js';
import { RemoveMemberSchema } from '../common/contracts.js';
import { logInfo } from '../common/logging.js';
import { summaries, writeActivityInTransaction } from '../lib/activity.js';
import {
  markMemberLeftInTransaction,
  readGroupInTransaction,
  requireGroup,
} from '../lib/groups.js';

/**
 * removeMember — an admin removes someone else (AC-C1.7).
 *
 * Two preconditions, neither expressible in Security Rules: the caller is a group
 * admin, and the TARGET's balance is zero. The second needs a read of a document
 * other than the one being written, which rules cannot do for a write they have
 * already denied outright (`members` is `allow write: if false`).
 *
 * Same shape as `leaveGroup`: `leftAt` is set and the uid drops out of `memberIds`;
 * the member document survives so historical expenses still render (Article V).
 */
export const removeMember = onCall(CALLABLE_OPTS, async (req) => {
  const callerUid = requireAuth(req);
  const { groupId, uid: targetUid } = parseInput(RemoveMemberSchema, req.data);

  if (targetUid === callerUid) {
    // Not a security boundary — `leaveGroup` enforces the same zero-balance rule.
    // It is a clarity boundary: the two produce different activity entries
    // (`member.removed` vs `member.left`) and the feed should not lie about which
    // happened.
    throw new HttpsError('invalid-argument', 'Use leaveGroup to remove yourself.');
  }

  const group = await requireGroup(groupId);
  const admin = await requireGroupAdmin(groupId, callerUid);
  const target = await requireActiveMember(groupId, targetUid);
  requireZeroBalance(target, group.currency);

  // Outside the transaction so a retry reuses the same id (see leaveGroup).
  const activityId = `member.removed__${targetUid}__${Date.now()}`;

  await db.runTransaction(async (tx) => {
    const freshGroup = await readGroupInTransaction(tx, groupId);
    const freshTarget = await tx.get(db.doc(`groups/${groupId}/members/${targetUid}`));
    const freshData = freshTarget.data();

    if (freshGroup === null || freshGroup.deletedAt !== null) {
      throw new HttpsError('not-found', 'That group no longer exists.');
    }
    if (!freshTarget.exists || freshData?.['leftAt'] != null) {
      return; // already gone — idempotent
    }

    // Re-checked under the transaction: a concurrent expense may have given the
    // target a balance since the pre-flight read.
    const balanceMinor = freshData?.['balanceMinor'];
    if (typeof balanceMinor !== 'number' || balanceMinor !== 0) {
      throw new HttpsError('failed-precondition', 'That member has an outstanding balance.', {
        balanceMinor: typeof balanceMinor === 'number' ? balanceMinor : null,
        currency: freshGroup.currency,
        uid: targetUid,
      });
    }

    markMemberLeftInTransaction(tx, freshGroup, targetUid);

    writeActivityInTransaction(tx, groupId, activityId, {
      type: 'member.removed',
      actorUid: callerUid,
      actorName: admin.displayName,
      targetId: targetUid,
      summary: summaries.memberRemoved(admin.displayName, target.displayName),
      amountMinor: null,
      currency: null,
    });
  });

  logInfo(
    { fn: 'removeMember', gid: groupId, uid: callerUid, targetUid },
    'admin removed member from group',
  );
  return { groupId, uid: targetUid, removed: true };
});
