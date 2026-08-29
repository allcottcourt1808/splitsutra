import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FieldValue, db } from '../common/admin.js';
import { CALLABLE_OPTS, parseInput, requireAuth } from '../common/callable.js';
import { SendFriendRequestSchema } from '../common/contracts.js';
import { logInfo, logWarn } from '../common/logging.js';
import { establishFriendship } from '../lib/friendship.js';
import { profileSnapshot, type ProfileSnapshot } from '../lib/groups.js';
import { normalizeEmail, normalizePhone, usernameKey } from '../lib/identity.js';

/**
 * ============================================================================
 * sendFriendRequest — resolve a contact, then ASK them
 * ============================================================================
 * Replaces `addFriend`, which resolved a contact and created the friendship on the
 * spot. The lookup below is that function's lookup, unchanged. What changed is what
 * happens after it succeeds: a `pending` document in `friendRequests/`, and nothing
 * else, until the recipient answers.
 *
 * Why: a friendship IS a group (D2). Under the old flow, anyone who knew your email
 * address could put themselves in your friends list and in a shared group with you,
 * with no way for you to refuse and no record that you had not agreed. AC-B1.4 and
 * AC-B1.5 described that behaviour and have been revised alongside this function.
 *
 * 🔴 WHAT THIS FUNCTION IS ALLOWED TO REVEAL, AND WHY THAT IS NOT A LEAK.
 *
 *    It answers "does an account exist for this exact email/phone?" — which reads
 *    like an account-enumeration oracle and is not one, for two reasons:
 *
 *      a. The client can already ask. `firestore.rules` grants
 *         `usernames/{key}: allow get: if isSignedIn()`. This function resolves
 *         through the SAME index and returns the SAME public projection
 *         (uid, displayName, photoURL) the client could have read itself.
 *      b. Enumeration is what is actually blocked, and it is blocked by the shape
 *         of the index, not by this function: the document id is
 *         `sha256(normalized identifier)` and `list` is denied outright (T5). You
 *         can confirm a contact you already know. You cannot dump the user table,
 *         and you cannot walk from a uid back to an email.
 *
 *    So the rule this function must hold to is narrower and absolute: **never widen
 *    the projection**. It resolves ONLY through `usernames/{key}`, never by querying
 *    `users` on an email or phone field, and it returns nothing about the target
 *    beyond what the index already publishes. Every unresolvable lookup returns the
 *    one identical `not-found`.
 *
 * 🔴 A DECLINE IS FINAL, AND THAT IS THE ANTI-HARASSMENT PROPERTY.
 *
 *    Asking someone to be your friend is a message you can put in front of them
 *    knowing only their email address — a surface the unilateral flow did not have,
 *    because there was nothing to refuse. Re-sending after a decline is therefore
 *    refused outright rather than rate-limited: a limit only sets the pace of a
 *    thing the recipient already said no to.
 *
 *    The escape hatch is deliberate and costs nothing: the recipient can always add
 *    the sender themselves, which auto-accepts. So a decline the recipient regrets
 *    is one tap to undo, while a decline they meant is permanent. A `cancelled`
 *    request — the sender withdrew — is not a refusal and can be re-sent.
 * ============================================================================
 */

/**
 * The one message every unresolvable lookup returns.
 *
 * Deliberately identical for "no account", "account tombstoned", and "index entry
 * points at a profile that is gone". Three distinguishable errors would turn the
 * privacy argument above into a lie by telling the caller which of those it hit.
 */
const NO_SUCH_ACCOUNT = 'No SplitSutra account is registered with that email or phone number.';

/** What a decline gets. Says nothing about *why* — see the header. */
const ALREADY_DECLINED = 'That request was already answered.';

/** `${fromUid}__${toUid}`. Mirrors `friendRequestId` in `@splitsutra/core`. */
function requestId(fromUid: string, toUid: string): string {
  return `${fromUid}__${toUid}`;
}

/** A fresh `friendRequests/{id}` document, `pending`. */
function pendingRequest(
  fromUid: string,
  from: ProfileSnapshot,
  toUid: string,
  to: ProfileSnapshot,
): Record<string, unknown> {
  return {
    id: requestId(fromUid, toUid),
    fromUid,
    fromName: from.displayName,
    fromPhotoURL: from.photoURL,
    toUid,
    toName: to.displayName,
    toPhotoURL: to.photoURL,
    status: 'pending',
    implicitGroupId: null,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    // Null exactly while pending — `friendRequestSchema` refines on that pairing, so a
    // non-null value here would fail every client read of this document.
    respondedAt: null,
  };
}

export const sendFriendRequest = onCall(CALLABLE_OPTS, async (req) => {
  const uid = requireAuth(req);
  const { email, phoneNumber } = parseInput(SendFriendRequestSchema, req.data);

  /* --- 1. normalise, exactly the way the index was built ---------------------------------- */
  // 🔴 Normalised by lib/identity.ts and NOT by the Zod schema, even though the schema also
  //    trims and lowercases. `onUserProfileWritten` derived the STORED document id with these
  //    functions; a second normalisation that disagrees by one character produces a different
  //    sha256 and every lookup misses silently, with no error anywhere. See the CROSS-RUNTIME
  //    CONTRACT note in lib/identity.ts.
  const normalized = email === undefined ? normalizePhone(phoneNumber) : normalizeEmail(email);
  if (normalized === null) {
    // The schema already accepted the shape, so reaching here means the two validators
    // disagree — a bug, not hostile input. Reported as invalid-argument rather than not-found:
    // the caller's input never got as far as a lookup.
    throw new HttpsError('invalid-argument', 'That does not look like a usable email or phone.');
  }

  /* --- 2. resolve through the hashed index, and only through it --------------------------- */
  const key = usernameKey(normalized);
  const indexSnap = await db.doc(`usernames/${key}`).get();
  const targetUid = indexSnap.data()?.['uid'];
  if (typeof targetUid !== 'string' || targetUid.length === 0) {
    throw new HttpsError('not-found', NO_SUCH_ACCOUNT);
  }

  const ctx = { fn: 'sendFriendRequest', uid, targetUid };

  /* --- 3. self-friending (AC-B1.6) -------------------------------------------------------- */
  // Checked after resolution rather than before: comparing the identifier against the caller's
  // own profile would need an extra read to say the same thing, and "that is your own account"
  // is not information the caller lacks.
  if (targetUid === uid) {
    throw new HttpsError('invalid-argument', 'You cannot send yourself a friend request.');
  }

  // The caller's own profile document is deliberately NOT read. The only path here that
  // creates a group is the auto-accept below, and there the ORIGINAL sender is the creator —
  // so the group's immutable currency comes from their default, not the caller's.
  const [callerProfile, targetProfile, targetDoc] = await Promise.all([
    profileSnapshot(uid),
    profileSnapshot(targetUid),
    db.doc(`users/${targetUid}`).get(),
  ]);

  // A tombstoned account (deleteAccount sets `deletedAt`) must not receive a request: accepting
  // it would create an implicit group with a member who can never sign in, holding a live
  // balance nobody can settle. `deleteAccount` also clears the index entries, so reaching this
  // branch means one of those deletions did not land — worth a log line, and the SAME error as
  // "no account" (see NO_SUCH_ACCOUNT).
  if (!targetDoc.exists || targetDoc.data()?.['deletedAt'] != null) {
    logWarn(ctx, 'usernames index resolved to a missing or tombstoned profile');
    throw new HttpsError('not-found', NO_SUCH_ACCOUNT);
  }

  const outgoingRef = db.doc(`friendRequests/${requestId(uid, targetUid)}`);
  const incomingRef = db.doc(`friendRequests/${requestId(targetUid, uid)}`);

  // Allocated OUTSIDE the transaction — `runTransaction` retries its callback on contention
  // and `.doc()` inside would mint a DIFFERENT id on the retry, turning one friendship into
  // two implicit groups. Only written if the transaction takes the auto-accept path; an
  // unwritten reference costs nothing.
  const newGroupRef = db.collection('groups').doc();

  const outcome = await db.runTransaction(async (tx) => {
    /* ---- reads, all of them, before any write ------------------------------------------- */
    const [mineSnap, theirsSnap] = await Promise.all([tx.get(outgoingRef), tx.get(incomingRef)]);

    const mine = mineSnap.data();
    const theirs = theirsSnap.data();

    /* ---- 4a. they already asked ME -> accept it rather than open a second request -------- */
    // Without this, two people who both tap "add" end up with two pending requests and
    // neither becomes a friend until somebody works out which one to answer. Tapping "add"
    // on someone who has asked you IS an acceptance, so treat it as one.
    if (theirs?.['status'] === 'pending') {
      const friendship = await establishFriendship(tx, {
        // The original sender is the creator, and therefore the group's admin — the same
        // outcome as if the recipient had simply tapped Accept.
        creator: { uid: targetUid, profile: targetProfile },
        other: { uid, profile: callerProfile },
        groupRef: newGroupRef,
        currencyHint: targetDoc.data()?.['defaultCurrency'],
      });
      tx.update(incomingRef, {
        status: 'accepted',
        implicitGroupId: friendship.implicitGroupId,
        updatedAt: FieldValue.serverTimestamp(),
        respondedAt: FieldValue.serverTimestamp(),
      });
      return {
        kind: 'auto-accepted' as const,
        id: incomingRef.id,
        implicitGroupId: friendship.implicitGroupId,
      };
    }

    /* ---- 4b. I have already asked them --------------------------------------------------- */
    const myStatus = mine?.['status'];

    if (myStatus === 'pending') {
      // Idempotent. Re-sending an outstanding request is a double-tap, not a new event, and
      // must not refresh `createdAt` — that would let a sender bump themselves to the top of
      // the recipient's inbox repeatedly.
      return { kind: 'already-pending' as const, id: outgoingRef.id, implicitGroupId: null };
    }

    if (myStatus === 'accepted') {
      const gid = mine?.['implicitGroupId'];
      return {
        kind: 'already-friends' as const,
        id: outgoingRef.id,
        implicitGroupId: typeof gid === 'string' ? gid : null,
      };
    }

    if (myStatus === 'declined') {
      // 🔴 Terminal. See the ANTI-HARASSMENT note in the header.
      throw new HttpsError('failed-precondition', ALREADY_DECLINED);
    }

    /* ---- 4c. no request either way — but check they are not already friends -------------- */
    // A friendship can predate this collection, and `establishFriendship` can be reached from
    // the auto-accept path above under a request document that has since been answered. Asking
    // the friend document rather than the request document is asking the thing that is true.
    const existing = await tx.get(db.doc(`users/${uid}/friends/${targetUid}`));
    if (existing.exists) {
      const gid = existing.data()?.['implicitGroupId'];
      return {
        kind: 'already-friends' as const,
        id: outgoingRef.id,
        implicitGroupId: typeof gid === 'string' ? gid : null,
      };
    }

    /* ---- 5. write the request ------------------------------------------------------------ */
    // `set` rather than `create`: a `cancelled` document may be sitting at this path, and a
    // withdrawal is not a refusal — overwriting it with a fresh `pending` is exactly right.
    tx.set(outgoingRef, pendingRequest(uid, callerProfile, targetUid, targetProfile));
    return { kind: 'sent' as const, id: outgoingRef.id, implicitGroupId: null };
  });

  logInfo({ ...ctx, requestId: outcome.id }, `sendFriendRequest -> ${outcome.kind}`);

  // Exactly the `usernames/{key}` public projection, plus the request state. Nothing the
  // caller could not already read for themselves. See the header.
  return {
    requestId: outcome.id,
    toUid: targetUid,
    displayName: targetProfile.displayName,
    photoURL: targetProfile.photoURL,
    outcome: outcome.kind,
    implicitGroupId: outcome.implicitGroupId,
  };
});
