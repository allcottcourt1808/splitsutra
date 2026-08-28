import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FieldValue, db } from '../common/admin.js';
import { CALLABLE_OPTS, parseInput, requireAuth } from '../common/callable.js';
import { AddFriendSchema, CURRENCIES } from '../common/contracts.js';
import { logInfo, logWarn } from '../common/logging.js';
import { newMemberDoc, profileSnapshot, type ProfileSnapshot } from '../lib/groups.js';
import { normalizeEmail, normalizePhone, usernameKey } from '../lib/identity.js';

/**
 * ============================================================================
 * addFriend — resolve a contact, then create the friendship both ways at once
 * ============================================================================
 * docs/06 §"addFriend", checklists/phase-05 §6. The doc's sequence, preserved:
 *
 *   1. Reject self-friending                            (AC-B1.6)
 *   2. Resolve via usernames/{sha256(key)} → not-found if unregistered
 *   3. Already friends? → return the existing implicitGroupId (AC-B1.5)
 *   4. One transaction: implicit group + both member docs + BOTH friend docs
 *
 * 🔴 WHAT THIS FUNCTION IS ALLOWED TO REVEAL, AND WHY THAT IS NOT A LEAK.
 *
 *    It answers "does an account exist for this exact email/phone?" — which reads
 *    like an account-enumeration oracle and is not one, for two reasons:
 *
 *      a. The client can already ask. `firestore.rules` grants
 *         `usernames/{key}: allow get: if isSignedIn()`. This function resolves
 *         through the SAME index and returns the SAME public projection
 *         (uid, displayName, photoURL) the client could have read itself. Refusing
 *         to answer here would not close anything; it would only make `addFriend`
 *         disagree with `findUserByContact` about who exists.
 *      b. Enumeration is what is actually blocked, and it is blocked by the shape
 *         of the index, not by this function: the document id is
 *         `sha256(normalized identifier)` and `list` is denied outright (T5). You
 *         can confirm a contact you already know. You cannot dump the user table,
 *         and you cannot walk from a uid back to an email.
 *
 *    So the rule this function must hold to is narrower and absolute: **never widen
 *    the projection**. It resolves ONLY through `usernames/{key}`, never by querying
 *    `users` on an email or phone field, and it returns nothing about the target
 *    beyond what the index already publishes. No group list, no balance, no contact
 *    details, no "this person exists but has blocked you" distinction — every
 *    unresolvable lookup returns the one identical `not-found`.
 *
 * 🔴 BOTH SIDES IN ONE TRANSACTION. checklists/phase-05 §6: "a one-directional
 *    friendship is painful to detect later". The group, both member documents and
 *    both `users/{x}/friends/{y}` documents commit together or not at all —
 *    a friendship that exists on one side only is a corrupt state no screen checks
 *    for, and nothing would ever repair it.
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

/**
 * Fallback when the caller's profile carries no usable `defaultCurrency`.
 *
 * ⚠️ Mirrors `DEFAULT_CURRENCY` in `@splitsutra/core` (`types/currency.ts`), which
 *    `common/contracts.ts` — the seam file listing every borrowed core symbol — does
 *    not re-export. Re-declared here rather than reached for through a second,
 *    undocumented import path. This is not money math (Article VI is not in play);
 *    it is a default. Delete this constant and import it the next time the seam file
 *    is revised.
 */
const FALLBACK_CURRENCY = 'USD';

export const addFriend = onCall(CALLABLE_OPTS, async (req) => {
  const uid = requireAuth(req);
  const { email, phoneNumber } = parseInput(AddFriendSchema, req.data);

  // --- 1. normalise, exactly the way the index was built ---------------------
  // 🔴 Normalised by lib/identity.ts and NOT by the Zod schema, even though the
  //    schema also trims and lowercases. `onUserProfileWritten` derived the STORED
  //    document id with these functions; a second normalisation that disagrees by
  //    one character produces a different sha256 and every lookup misses silently,
  //    with no error anywhere. See the CROSS-RUNTIME CONTRACT note in lib/identity.ts.
  const normalized = email === undefined ? normalizePhone(phoneNumber) : normalizeEmail(email);
  if (normalized === null) {
    // The schema already accepted the shape, so reaching here means the two
    // validators disagree — a bug, not hostile input. Reported as invalid-argument
    // rather than not-found: the caller's input never got as far as a lookup.
    throw new HttpsError('invalid-argument', 'That does not look like a usable email or phone.');
  }

  // --- 2. resolve through the hashed index, and only through it --------------
  const key = usernameKey(normalized);
  const indexSnap = await db.doc(`usernames/${key}`).get();
  const targetUid = indexSnap.data()?.['uid'];
  if (typeof targetUid !== 'string' || targetUid.length === 0) {
    throw new HttpsError('not-found', NO_SUCH_ACCOUNT);
  }

  const ctx = { fn: 'addFriend', uid, targetUid };

  // --- 3. self-friending (AC-B1.6) -------------------------------------------
  // Checked after resolution rather than before: comparing the identifier against
  // the caller's own profile would need an extra read to say the same thing, and
  // "that is your own account" is not information the caller lacks.
  if (targetUid === uid) {
    throw new HttpsError('invalid-argument', 'You cannot add yourself as a friend.');
  }

  // ⚠️ Four reads, two of which hit the same two documents twice. Deliberate:
  //    `profileSnapshot()` owns the display-name fallback and takes a uid, so
  //    re-deriving it here from a raw snapshot would put that fallback in two
  //    places. Duplicating it to save two reads on a call that happens once per
  //    friendship is the wrong trade (Article XII — measure before optimising).
  const [callerProfile, targetProfile, callerDoc, targetDoc] = await Promise.all([
    profileSnapshot(uid),
    profileSnapshot(targetUid),
    db.doc(`users/${uid}`).get(),
    db.doc(`users/${targetUid}`).get(),
  ]);

  // A tombstoned account (deleteAccount sets `deletedAt`) must not become anyone's
  // friend: the implicit group would be created with a member who can never sign in,
  // and it would hold a live balance nobody can settle. `deleteAccount` also clears
  // the index entries, so reaching this branch means one of those deletions did not
  // land — worth a log line, and the SAME error as "no account" (see NO_SUCH_ACCOUNT).
  if (!targetDoc.exists || targetDoc.data()?.['deletedAt'] != null) {
    logWarn(ctx, 'usernames index resolved to a missing or tombstoned profile');
    throw new HttpsError('not-found', NO_SUCH_ACCOUNT);
  }

  // Allocated OUTSIDE the transaction. `runTransaction` retries its callback on
  // contention and `.doc()` inside would mint a DIFFERENT id on the retry — turning
  // one friendship into two implicit groups (same reasoning as leaveGroup's
  // activityId). If the transaction takes the "already friends" path this ref is
  // simply never written; an unwritten reference costs nothing.
  const newGroupRef = db.collection('groups').doc();
  const groupCurrency = resolveCurrency(callerDoc.data()?.['defaultCurrency']);

  const myFriendRef = db.doc(`users/${uid}/friends/${targetUid}`);
  const theirFriendRef = db.doc(`users/${targetUid}/friends/${uid}`);

  const outcome = await db.runTransaction(async (tx) => {
    // ---- reads (all of them, before any write) ------------------------------
    const [mine, theirs] = await Promise.all([tx.get(myFriendRef), tx.get(theirFriendRef)]);

    const myGid = mine.data()?.['implicitGroupId'];
    const theirGid = theirs.data()?.['implicitGroupId'];
    const existingGid =
      typeof myGid === 'string' && myGid.length > 0
        ? myGid
        : typeof theirGid === 'string' && theirGid.length > 0
          ? theirGid
          : null;

    // --- 3. already friends -> idempotent success (AC-B1.5) ------------------
    if (existingGid !== null) {
      // A friendship that exists on ONE side only is the corruption the single
      // transaction below is designed to prevent, so finding one means an older
      // write was interrupted. Repair the missing half against the group that
      // already exists rather than minting a second implicit group for the same
      // pair — two groups would split the same pair's history across both.
      if (!mine.exists) {
        tx.set(myFriendRef, friendDoc(targetUid, targetProfile, existingGid));
      }
      if (!theirs.exists) {
        tx.set(theirFriendRef, friendDoc(uid, callerProfile, existingGid));
      }
      return {
        implicitGroupId: existingGid,
        alreadyFriends: true,
        repaired: !mine.exists || !theirs.exists,
      };
    }

    // --- 4. writes -----------------------------------------------------------
    // D2 / docs/03: a 1:1 friendship is not a second code path — it is a normal
    // group flagged `isImplicit` and hidden from the group list, so every expense,
    // balance and settlement code path works on it unchanged.
    tx.set(newGroupRef, {
      id: newGroupRef.id,
      name: implicitGroupName(callerProfile.displayName, targetProfile.displayName),
      type: 'friend',
      isImplicit: true,
      photoURL: null,
      // 🔴 IMMUTABLE after this line (T10, AC-C1.1) — changing a group's currency
      //    later reinterprets every amount already stored in it. The caller's
      //    default decides it, which means whoever adds the other first fixes the
      //    currency for the pair. docs/03 §"Forward design: multi-currency" is
      //    where that stops being a wrinkle; until then it is one, deliberately.
      currency: groupCurrency,
      memberIds: [uid, targetUid],
      memberCount: 2,
      simplifyDebts: false,
      createdBy: uid,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      lastActivityAt: FieldValue.serverTimestamp(),
      deletedAt: null,
      // v1 writes null for both; readers fall back to `currency` (docs/03).
      baseCurrency: null,
      allowMixedCurrency: null,
    });

    // Both member documents are written HERE rather than left to `onGroupCreated`.
    // That trigger seeds only the creator and reads-before-writing precisely because
    // this function gets there first (see its IDEMPOTENCE note); it would never seed
    // the friend at all.
    //
    // Roles are asymmetric — creator `admin`, friend `member` — matching every other
    // group and `onGroupCreated`'s convention. Symmetric admin would read as fairer
    // and is worse: `removeMember` is admin-gated, so two admins in a two-person
    // group means either friend can evict the other from their shared history.
    tx.set(
      db.doc(`groups/${newGroupRef.id}/members/${uid}`),
      newMemberDoc(uid, 'admin', callerProfile),
    );
    tx.set(
      db.doc(`groups/${newGroupRef.id}/members/${targetUid}`),
      newMemberDoc(targetUid, 'member', targetProfile),
    );

    // 🔴 Both directions, same transaction. See the header.
    tx.set(myFriendRef, friendDoc(targetUid, targetProfile, newGroupRef.id));
    tx.set(theirFriendRef, friendDoc(uid, callerProfile, newGroupRef.id));

    return { implicitGroupId: newGroupRef.id, alreadyFriends: false, repaired: false };
  });

  if (outcome.repaired) {
    logWarn(
      { ...ctx, gid: outcome.implicitGroupId },
      'repaired a one-directional friendship — the missing side was rewritten',
    );
  } else if (outcome.alreadyFriends) {
    logInfo({ ...ctx, gid: outcome.implicitGroupId }, 'addFriend was a no-op — already friends');
  } else {
    logInfo({ ...ctx, gid: outcome.implicitGroupId }, 'friendship created with implicit group');
  }

  // Exactly the `usernames/{key}` public projection and the group id — nothing the
  // caller could not already read for themselves. See the header.
  return {
    friendUid: targetUid,
    displayName: targetProfile.displayName,
    photoURL: targetProfile.photoURL,
    implicitGroupId: outcome.implicitGroupId,
    alreadyFriends: outcome.alreadyFriends,
  };
});

/**
 * A `users/{uid}/friends/{friendUid}` document (docs/03).
 *
 * 🔴 `balanceMinor` starts as an EMPTY map, not `{ USD: 0 }`. Core's
 *    `balanceByCurrencySchema` is a sparse record — a currency appears only once
 *    the pair actually has a balance in it, and D6 forbids ever summing across the
 *    entries. Seeding a zero would assert a currency relationship that does not
 *    exist yet.
 */
function friendDoc(
  friendUid: string,
  profile: ProfileSnapshot,
  implicitGroupId: string,
): Record<string, unknown> {
  return {
    friendUid,
    displayName: profile.displayName,
    photoURL: profile.photoURL,
    implicitGroupId,
    balanceMinor: {},
    updatedAt: FieldValue.serverTimestamp(),
  };
}

/**
 * The caller's `defaultCurrency`, validated against the real ISO 4217 table.
 *
 * `CURRENCIES` comes from `@splitsutra/core` through `common/contracts.ts` — the same
 * table `onExpenseWritten` validates against (Q4: a rule can only match `^[A-Z]{3}$`,
 * and `ZZZ` passes that). A group created with a code that is not a currency has an
 * unrenderable exponent and every amount in it is undisplayable.
 */
function resolveCurrency(raw: unknown): string {
  return typeof raw === 'string' && Object.hasOwn(CURRENCIES, raw) ? raw : FALLBACK_CURRENCY;
}

/**
 * `"Neethu & Sandeep"`, clamped to the 1..60 core's `groupSchema` allows.
 *
 * Cosmetic only: the group is `isImplicit` and hidden from the group list (D2), so
 * this name is seen in exports and support tooling rather than in the app. It is a
 * snapshot and is not refreshed on a rename — `onUserProfileWritten` fans out to
 * member documents, not to group names.
 */
function implicitGroupName(mine: string, theirs: string): string {
  const joined = `${mine} & ${theirs}`.trim();
  return joined.length <= 60 ? joined : joined.slice(0, 60).trim();
}
