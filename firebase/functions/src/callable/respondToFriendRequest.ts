import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FieldValue, db } from '../common/admin.js';
import { CALLABLE_OPTS, parseInput, requireAuth } from '../common/callable.js';
import { RespondToFriendRequestSchema } from '../common/contracts.js';
import { logInfo } from '../common/logging.js';
import { establishFriendship } from '../lib/friendship.js';
import { profileSnapshot } from '../lib/groups.js';

/**
 * ============================================================================
 * respondToFriendRequest — the recipient accepts or declines
 * ============================================================================
 * The half of the old `addFriend` that actually writes a friendship, now behind the
 * recipient's consent. On accept it creates the implicit group, both member
 * documents and both `users/{x}/friends/{y}` documents in ONE transaction
 * (`lib/friendship.ts`).
 *
 * 🔴 ONLY THE RECIPIENT. `toUid` is read from the stored document, never from the
 *    payload — the caller names a request id and nothing else, so there is no field
 *    they could set to make themselves the recipient of somebody else's request.
 *    A sender who wants out uses `cancelFriendRequest`, which is the mirror check.
 *
 * 🔴 PROFILES ARE RE-READ, NOT TAKEN FROM THE REQUEST. The request carries
 *    `fromName`/`toName` snapshotted at send time so the inbox can render without a
 *    profile read the recipient is not permitted to make. Those are display copies
 *    and may be weeks stale by the time somebody answers. The group and member
 *    documents this creates are long-lived, so they get a fresh read.
 *
 * 🔴 THE DECIDING CURRENCY IS THE SENDER'S. `establishFriendship` makes the sender
 *    the group's creator and admin — the friendship is theirs to have proposed — so
 *    the group's immutable currency (T10, AC-C1.1) comes from the sender's
 *    `defaultCurrency`. Accepting must not silently redenominate a group around the
 *    accepter's preference.
 * ============================================================================
 */

/** Returned for a request that is missing, already answered, or not the caller's to answer. */
const NOT_ANSWERABLE = 'That friend request is no longer waiting for an answer.';

export const respondToFriendRequest = onCall(CALLABLE_OPTS, async (req) => {
  const uid = requireAuth(req);
  const { requestId, accept } = parseInput(RespondToFriendRequestSchema, req.data);

  const requestRef = db.doc(`friendRequests/${requestId}`);
  const snap = await requestRef.get();
  const request = snap.data();

  // Missing, already answered, or addressed to somebody else — all one message. A caller who
  // guessed an id should not learn from the error whether it named a real request, and a
  // recipient whose request was withdrawn a second ago does not need a different word for it.
  if (!snap.exists || request === undefined || request['toUid'] !== uid) {
    throw new HttpsError('not-found', NOT_ANSWERABLE);
  }
  if (request['status'] !== 'pending') {
    throw new HttpsError('failed-precondition', NOT_ANSWERABLE);
  }

  const fromUid = request['fromUid'];
  if (typeof fromUid !== 'string' || fromUid.length === 0) {
    // The document exists, is pending, and is addressed to the caller, but names no sender.
    // Nothing here can repair that, and proceeding would write a group with one member.
    throw new HttpsError('internal', 'That friend request is malformed.');
  }

  const ctx = { fn: 'respondToFriendRequest', uid, fromUid, requestId };

  /* --- decline: one field, no side effects ------------------------------------------------ */
  if (!accept) {
    await requestRef.update({
      status: 'declined',
      updatedAt: FieldValue.serverTimestamp(),
      respondedAt: FieldValue.serverTimestamp(),
    });
    logInfo(ctx, 'friend request declined');
    return { requestId, status: 'declined' as const, implicitGroupId: null };
  }

  /* --- accept ----------------------------------------------------------------------------- */
  // See the header: display copies on the request are not good enough for the documents this
  // is about to create.
  const [senderProfile, recipientProfile, senderDoc] = await Promise.all([
    profileSnapshot(fromUid),
    profileSnapshot(uid),
    db.doc(`users/${fromUid}`).get(),
  ]);

  // The sender may have deleted their account between sending and this moment. Accepting would
  // create a group with a member who can never sign in, holding a balance nobody can settle.
  if (!senderDoc.exists || senderDoc.data()?.['deletedAt'] != null) {
    throw new HttpsError('failed-precondition', 'That account is no longer active.');
  }

  // Allocated OUTSIDE the transaction. `runTransaction` retries on contention and a `.doc()`
  // inside would mint a different id each attempt — one friendship, two implicit groups.
  const newGroupRef = db.collection('groups').doc();

  const outcome = await db.runTransaction(async (tx) => {
    // Re-read inside the transaction: between the guard above and here, the sender could have
    // cancelled, or a second device could have accepted. Accepting twice would be caught by
    // `establishFriendship`'s idempotence, but the status guard is what keeps a cancelled
    // request from being resurrected as accepted.
    const fresh = await tx.get(requestRef);
    if (fresh.data()?.['status'] !== 'pending') {
      throw new HttpsError('failed-precondition', NOT_ANSWERABLE);
    }

    const friendship = await establishFriendship(tx, {
      creator: { uid: fromUid, profile: senderProfile },
      other: { uid, profile: recipientProfile },
      groupRef: newGroupRef,
      currencyHint: senderDoc.data()?.['defaultCurrency'],
    });

    tx.update(requestRef, {
      status: 'accepted',
      implicitGroupId: friendship.implicitGroupId,
      updatedAt: FieldValue.serverTimestamp(),
      respondedAt: FieldValue.serverTimestamp(),
    });

    return friendship;
  });

  logInfo(
    { ...ctx, gid: outcome.implicitGroupId },
    outcome.alreadyFriends
      ? 'friend request accepted — the pair were already friends'
      : 'friend request accepted — friendship created with implicit group',
  );

  return {
    requestId,
    status: 'accepted' as const,
    implicitGroupId: outcome.implicitGroupId,
  };
});
