import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FieldValue, Timestamp, db } from '../common/admin.js';
import { CALLABLE_OPTS, parseInput, requireAuth } from '../common/callable.js';
import {
  UndoDeclineFriendRequestSchema,
  declineUndoState,
  type FriendRequestStatus,
} from '../common/contracts.js';
import { logInfo } from '../common/logging.js';

/**
 * ============================================================================
 * undoDeclineFriendRequest — the DECLINER takes back an accidental tap
 * ============================================================================
 * Decline sits directly beside Accept on the Friends screen and a thumb is not a
 * decision. This restores the request to exactly the state it was in before the
 * tap: `pending`, unanswered, back in the recipient's inbox.
 *
 * 🔴 THE CALLER MUST BE `toUid`, AND THAT IS THE WHOLE SECURITY ARGUMENT.
 *
 *    `declined` is terminal on purpose. `sendFriendRequest` refuses to write over
 *    a declined document — that is the anti-harassment property in its header —
 *    so if a SENDER could reach this function, they could clear their own refusal
 *    and ask again, and again. The check below reads `toUid` off the stored
 *    document and compares it to the caller. There is no field in the payload
 *    naming who the caller claims to be, because a function whose central check
 *    is a payload field has no central check.
 *
 *    This is not "another chance to ask". It is the recipient correcting their own
 *    mis-tap, and the two are opposites: one is the sender overriding an answer,
 *    the other is the answerer withdrawing one they did not mean to give.
 *
 * ## Why it is time-boxed
 *
 * An accident is discovered immediately. A minute later it is a mistake; a week
 * later it is a change of mind, and a change of mind should mean asking the person
 * again rather than silently reviving a request they were never told had died.
 *
 * The window is measured against `respondedAt`, which was written with
 * `FieldValue.serverTimestamp()`, and compared to this function's own clock. Both
 * are server time, so a client cannot widen the window by lying about its own.
 *
 * ## What the sender sees
 *
 * Nothing, at either end. They were never told the request was declined (docs/03),
 * so they are not told it was un-declined either — from their side the request
 * simply stayed pending the whole time, which is also the truth they would have
 * had if the tap had never happened.
 *
 * ## No Accept counterpart
 *
 * Deliberate, not an oversight. Accepting creates a group, two member documents
 * and two `friends` documents carrying `balanceMinor`; undoing that is a teardown
 * with real money state hanging off it, not a status flip. If it is ever wanted it
 * is its own design, and `leaveGroup` already covers the reachable half.
 * ============================================================================
 */

/** Missing, not the caller's to undo, or never declined — all one message. */
const NOT_UNDOABLE = 'That friend request is not waiting to be undone.';

/** Declined, owned by the caller, but too long ago. Safe to say plainly: it is their document. */
const WINDOW_PASSED = 'Too much time has passed to undo that. Ask them to send it again.';

export const undoDeclineFriendRequest = onCall(CALLABLE_OPTS, async (req) => {
  const uid = requireAuth(req);
  const { requestId } = parseInput(UndoDeclineFriendRequestSchema, req.data);

  const requestRef = db.doc(`friendRequests/${requestId}`);

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(requestRef);
    const request = snap.data();

    // 🔴 `toUid`, off the stored document. The sender must not be able to reach this — see the
    // header. Missing and not-yours are one message, so a caller cannot probe for which ids
    // exist by reading the difference between the two.
    if (!snap.exists || request === undefined || request['toUid'] !== uid) {
      throw new HttpsError('not-found', NOT_UNDOABLE);
    }

    // Evaluated inside the transaction: the status may have moved since the caller's screen
    // last saw it — a second device may have already undone this, leaving it `pending`, in
    // which case there is nothing to undo and saying so beats writing `pending` over `pending`.
    //
    // The timing rule itself lives in core and is unit-tested at its boundary; what stays here
    // is unwrapping the Admin SDK Timestamp and choosing the message.
    const respondedAt = request['respondedAt'];
    const state = declineUndoState(
      request['status'] as FriendRequestStatus,
      respondedAt instanceof Timestamp ? respondedAt.toMillis() : null,
    );
    if (state === 'not-declined') {
      throw new HttpsError('failed-precondition', NOT_UNDOABLE);
    }
    if (state === 'window-passed') {
      throw new HttpsError('failed-precondition', WINDOW_PASSED);
    }

    // Back to exactly the pre-tap state. `respondedAt` must return to null with the status, or
    // the document violates the refine above and stops decoding on the next read.
    tx.update(requestRef, {
      status: 'pending',
      respondedAt: null,
      updatedAt: FieldValue.serverTimestamp(),
    });
  });

  logInfo({ fn: 'undoDeclineFriendRequest', uid, requestId }, 'decline undone by recipient');

  return { requestId, status: 'pending' as const };
});
