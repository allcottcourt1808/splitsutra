import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FieldValue, db } from '../common/admin.js';
import { CALLABLE_OPTS, parseInput, requireAuth } from '../common/callable.js';
import { CancelFriendRequestSchema } from '../common/contracts.js';
import { logInfo } from '../common/logging.js';

/**
 * ============================================================================
 * cancelFriendRequest — the SENDER withdraws
 * ============================================================================
 * The mirror image of `respondToFriendRequest`: same document, same state machine,
 * the opposite party. Kept as its own function rather than a flag on that one,
 * because the authorization check is inverted (`fromUid` rather than `toUid`) and a
 * single function taking "who am I in this?" from the caller is a function whose
 * central check is a payload field.
 *
 * 🔴 THE RESULTING STATE IS `cancelled`, NOT `declined`, AND THE DIFFERENCE IS
 *    LOAD-BEARING. `sendFriendRequest` refuses to re-send over a `declined`
 *    document — that is the anti-harassment property in its header — and overwrites
 *    a `cancelled` one happily. Withdrawing your own request must not cost you the
 *    ability to ask again; being refused must.
 *
 * No side effects beyond the one document. Nothing was created when the request was
 * sent, so there is nothing to unwind.
 * ============================================================================
 */

/** Missing, already answered, or not the caller's to withdraw — all one message. */
const NOT_WITHDRAWABLE = 'That friend request is no longer outstanding.';

export const cancelFriendRequest = onCall(CALLABLE_OPTS, async (req) => {
  const uid = requireAuth(req);
  const { requestId } = parseInput(CancelFriendRequestSchema, req.data);

  const requestRef = db.doc(`friendRequests/${requestId}`);

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(requestRef);
    const request = snap.data();

    // `fromUid` comes from the stored document, never from the payload — the caller names an id
    // and nothing else, so there is no field they could set to withdraw somebody else's request.
    if (!snap.exists || request === undefined || request['fromUid'] !== uid) {
      throw new HttpsError('not-found', NOT_WITHDRAWABLE);
    }
    // Inside the transaction because the recipient may be answering it right now. Losing that
    // race must leave their answer standing, not overwrite an acceptance with a withdrawal.
    if (request['status'] !== 'pending') {
      throw new HttpsError('failed-precondition', NOT_WITHDRAWABLE);
    }

    tx.update(requestRef, {
      status: 'cancelled',
      updatedAt: FieldValue.serverTimestamp(),
      respondedAt: FieldValue.serverTimestamp(),
    });
  });

  logInfo({ fn: 'cancelFriendRequest', uid, requestId }, 'friend request withdrawn by sender');

  return { requestId, status: 'cancelled' as const };
});
