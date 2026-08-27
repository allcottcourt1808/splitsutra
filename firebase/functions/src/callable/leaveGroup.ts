import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { db } from '../common/admin.js';
import {
  CALLABLE_OPTS,
  parseInput,
  requireActiveMember,
  requireAuth,
  requireZeroBalance,
} from '../common/callable.js';
import { LeaveGroupSchema } from '../common/contracts.js';
import { logInfo, logWarn } from '../common/logging.js';
import { summaries, writeActivityInTransaction } from '../lib/activity.js';
import {
  markMemberLeftInTransaction,
  readGroupInTransaction,
  requireGroup,
} from '../lib/groups.js';

/**
 * leaveGroup — self-removal, blocked at a non-zero balance (AC-C1.6).
 *
 * 🔴 THE PRECONDITION CANNOT LIVE IN SECURITY RULES. docs/06: it requires reading
 *    another document than the one being written, and — more to the point — the
 *    member subcollection is `allow write: if false` for every client, so there is
 *    no client write for a rule to gate. This function IS the check.
 *
 * The outstanding amount is returned in the error detail so the UI can say
 * "settle $12.50 first" instead of "operation failed" (docs/06, `requireZeroBalance`).
 *
 * Leaving sets `leftAt` and drops the uid from `memberIds`; it does NOT delete the
 * member document. Historical expenses still reference that person and the group
 * must still render (Article V — nothing leaves the ledger).
 */
export const leaveGroup = onCall(CALLABLE_OPTS, async (req) => {
  const uid = requireAuth(req);
  const { groupId } = parseInput(LeaveGroupSchema, req.data);

  const group = await requireGroup(groupId);
  const member = await requireActiveMember(groupId, uid);
  requireZeroBalance(member, group.currency);

  // Computed OUTSIDE the transaction. `runTransaction` retries its callback on
  // contention, and an id derived from `Date.now()` inside would differ on the
  // retry — turning one departure into two feed entries.
  const activityId = `member.left__${uid}__${Date.now()}`;

  await db.runTransaction(async (tx) => {
    const freshGroup = await readGroupInTransaction(tx, groupId);
    const freshMember = await tx.get(db.doc(`groups/${groupId}/members/${uid}`));
    const freshData = freshMember.data();

    if (freshGroup === null || freshGroup.deletedAt !== null) {
      throw new HttpsError('not-found', 'That group no longer exists.');
    }
    if (!freshMember.exists || freshData?.['leftAt'] != null) {
      // Already left — a double tap, not an error.
      return;
    }

    // Re-checked inside the transaction. The pre-flight check above read a balance
    // that a concurrent expense write may have moved a millisecond later; leaving
    // with a debt is how a group stops summing to zero (AC-E1.3).
    const balanceMinor = freshData?.['balanceMinor'];
    if (typeof balanceMinor !== 'number' || balanceMinor !== 0) {
      throw new HttpsError('failed-precondition', 'Settle up before leaving this group.', {
        balanceMinor: typeof balanceMinor === 'number' ? balanceMinor : null,
        currency: freshGroup.currency,
        uid,
      });
    }

    markMemberLeftInTransaction(tx, freshGroup, uid);

    writeActivityInTransaction(tx, groupId, activityId, {
      type: 'member.left',
      actorUid: uid,
      actorName: member.displayName,
      targetId: uid,
      summary: summaries.memberLeft(member.displayName),
      amountMinor: null,
      currency: null,
    });
  });

  if (member.role === 'admin') {
    // TODO(phase-10): admin succession. Nothing in docs/03, docs/06, or phase-05
    // says what happens when the last admin leaves, and inventing a rule here —
    // auto-promoting someone, or refusing the departure — would be a product
    // decision made in a function body. Logged loudly so it is visible if it
    // actually happens, and left for a recorded decision in docs/12.
    logWarn(
      { fn: 'leaveGroup', gid: groupId, uid },
      'an admin left the group — check admin succession',
    );
  }

  logInfo({ fn: 'leaveGroup', gid: groupId, uid }, 'member left group');
  return { groupId, left: true };
});
