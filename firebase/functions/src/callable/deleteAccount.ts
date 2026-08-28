import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FieldValue, Timestamp, adminAuth, db } from '../common/admin.js';
import { CALLABLE_OPTS, parseInput, requireAuth } from '../common/callable.js';
import { BATCH_SIZE } from '../common/config.js';
import { DeleteAccountSchema } from '../common/contracts.js';
import { logError, logInfo, logWarn } from '../common/logging.js';
import { markMemberLeftInTransaction, readGroup, readGroupInTransaction } from '../lib/groups.js';
import { claimedIdentity, indexKeys } from '../lib/identity.js';

/**
 * ============================================================================
 * deleteAccount — GDPR erasure against a ledger that must stay auditable
 * ============================================================================
 * docs/06 §"deleteAccount" (AC-A3.2, AC-A3.3), checklists/phase-03 §77. The doc's
 * sequence, preserved, with the friend records added (see "WHAT IS DELETED" below):
 *
 *   1. Check every group membership for a non-zero balance → refuse with the list
 *   2. Remove from all groups' memberIds
 *   3. Anonymise users/{uid}
 *   4. Delete usernames/{hash} index entries
 *   5. Leave expenses intact — the ledger must stay auditable and zero-sum
 *   6. Delete the Firebase Auth user last
 *
 * ---------------------------------------------------------------------------
 * 🔴 WHAT IS DELETED vs WHAT IS ANONYMISED — the whole design of this function
 * ---------------------------------------------------------------------------
 * Erasure and Article V pull in opposite directions, and the line between them is
 * "is this a record of money that moved between real people, or is it a copy of the
 * departing user's personal data?" Ledger records are anonymised in place. Personal
 * data that is not a ledger record is actually deleted.
 *
 * DELETED outright:
 *   - `usernames/{sha256(email)}`, `usernames/{sha256(phone)}` — the lookup index.
 *     This is what makes the account findable by contact detail. It is pure index,
 *     rebuildable from a profile that will no longer exist.
 *   - `users/{uid}/friends/**` — the departing user's own social graph. It names
 *     OTHER people and is a derived convenience index (each entry is just a
 *     denormalized name plus the id of a group both parties are already members of),
 *     not a record of a transaction. Keeping a deleted user's friend list serves
 *     nobody and is exactly the kind of data GDPR Art. 17 is about.
 *
 * ANONYMISED, never deleted:
 *   - `users/{uid}` — kept as a tombstone (`deletedAt`) with `displayName` replaced
 *     and email / phone / photo cleared. The document id is the uid, which every
 *     expense in every shared group references; removing it would leave those
 *     expenses pointing at nothing.
 *   - `groups/{gid}/members/{uid}` — kept, with the denormalized name/photo snapshot
 *     scrubbed and `leftAt` set. Deleting it would break `isMember()` in
 *     `firestore.rules` for historical reads and orphan every split that names this
 *     uid.
 *   - `users/{other}/friends/{uid}` — the RECIPROCAL friend records, kept with the
 *     name/photo scrubbed. They carry `implicitGroupId` and `balanceMinor`, which is
 *     the other user's own data about their own history.
 *
 * UNTOUCHED:
 *   - every expense, settlement, comment and activity entry. Article V: the ledger
 *     is the truth and must stay rebuildable and zero-sum (AC-E1.3). They reference
 *     the uid, and the uid now resolves to "Deleted user" everywhere it is rendered.
 *     Erasing them would silently change what other people owe each other.
 *
 * ---------------------------------------------------------------------------
 * ⚠️ THIS OPERATION IS NOT ATOMIC, AND CANNOT BE
 * ---------------------------------------------------------------------------
 * It spans two systems — Firestore and Firebase Auth — and, within Firestore, more
 * documents than one transaction may touch. There is no commit that covers both.
 * So it is built to be RE-RUNNABLE instead: every step below is idempotent and skips
 * work already done, and the steps are ordered so that a failure part-way leaves a
 * state the next call finishes rather than one it cannot interpret.
 *
 * The specific partial failure to expect: Firestore cleanup succeeds and
 * `adminAuth.deleteUser` does not. The user then holds a working login against an
 * anonymised, tombstoned profile. That is why the Auth deletion is LAST — the
 * reverse order would delete the credential and strand identifiable data in
 * Firestore with no authenticated caller left who could ask for it again. On that
 * failure this function throws, and calling it again completes the deletion.
 *
 * Note also that deleting the Auth user does not revoke the ID token already in the
 * caller's hands; it stays valid until it expires (up to an hour). Every write path
 * it could still reach is closed by `leftAt` being set on every membership
 * (`isActiveMember()` in `firestore.rules` gates writes on exactly that).
 * ============================================================================
 */

/**
 * The one name that replaces the user's own everywhere it was denormalized.
 *
 * ⚠️ It must be the value the anonymised PROFILE also carries: writing
 *    `users/{uid}` fires `onUserProfileWritten`, whose fan-out copies the profile's
 *    `displayName` into every member document. If this string and the profile's
 *    disagreed, the fan-out would keep overwriting the scrub with the other value.
 *    They are the same constant here precisely so the two passes converge.
 */
const ANONYMISED_DISPLAY_NAME = 'Deleted user';

interface OutstandingBalance {
  groupId: string | null;
  groupName: string | null;
  currency: string | null;
  balanceMinor: number | null;
}

export const deleteAccount = onCall(CALLABLE_OPTS, async (req) => {
  const uid = requireAuth(req);
  // The parsed value holds nothing but `confirm: true`, and asserting that IS the
  // use: core types it as `z.literal(true)` so a bare `{}` or `{ confirm: false }`
  // fails validation rather than silently deleting, or silently not deleting.
  parseInput(DeleteAccountSchema, req.data);
  const ctx = { fn: 'deleteAccount', uid };

  // ---- 1. every membership this account has ever had -------------------------
  // One collection-group query rather than "list my groups, then read each member
  // doc": it returns the documents that actually EXIST, including memberships in
  // groups the user already left (whose uid is no longer in `memberIds`, so a
  // group-first walk would miss them entirely). `members.uid` needs no entry in
  // firestore.indexes.json — Firestore creates single-field collection-group indexes
  // automatically. Same approach and same reasoning as `fanOutDisplayFields`.
  const memberDocs = await db.collectionGroup('members').where('uid', '==', uid).get();

  // ---- 2. refuse while anything is owed (AC-A3.2) ----------------------------
  // 🔴 Checked across EVERY membership, including groups already left. A departed
  //    member holding a non-zero balance is an invariant violation on its own
  //    (`leaveGroup` refuses at a non-zero balance), and letting an account deletion
  //    be the thing that buries it is how a real debt stops existing on paper.
  const outstanding: OutstandingBalance[] = [];
  for (const doc of memberDocs.docs) {
    const balanceMinor = doc.data()['balanceMinor'];
    if (typeof balanceMinor === 'number' && balanceMinor === 0) continue;
    const groupId = doc.ref.parent.parent?.id ?? null;
    // The group read happens only on the refusal path, so the happy path pays
    // nothing for it. The UI needs the name and currency to say "settle ₹250 in
    // Goa Trip" rather than "operation failed" (docs/06 §"Shared conventions").
    const group = groupId === null ? null : await readGroup(groupId);
    outstanding.push({
      groupId,
      groupName: group?.name ?? null,
      currency: group?.currency ?? null,
      balanceMinor: typeof balanceMinor === 'number' ? balanceMinor : null,
    });
  }
  if (outstanding.length > 0) {
    logInfo(
      { ...ctx, groups: outstanding.length },
      'account deletion refused — balances outstanding',
    );
    throw new HttpsError(
      'failed-precondition',
      'Settle every outstanding balance before deleting your account.',
      { outstanding },
    );
  }

  // ---- 3. leave every group ---------------------------------------------------
  // ONE TRANSACTION PER GROUP, not one for all of them. Each has to hold
  // `members/{uid}.leftAt` and `groups/{gid}.memberIds` consistent — a partial write
  // across those two leaves a group whose member list and member documents disagree,
  // which nothing repairs. Across groups there is nothing to keep consistent, and a
  // single transaction spanning every group the user belongs to would blow past
  // Firestore's transaction limits for anyone in more than a handful.
  //
  // Consequence, accepted deliberately: a failure here leaves some groups cleaned and
  // some not. Re-running finishes the job — every membership already marked `leftAt`
  // is skipped.
  let groupsLeft = 0;
  for (const doc of memberDocs.docs) {
    const gid = doc.ref.parent.parent?.id;
    if (gid === undefined) {
      logError({ ...ctx, path: doc.ref.path }, 'member document with no parent group — skipped');
      continue;
    }
    if (doc.data()['leftAt'] != null) continue; // already out of this group

    if (doc.data()['role'] === 'admin') {
      // TODO(phase-10): admin succession, exactly as `leaveGroup` records it. Nothing
      // in docs/03, docs/06 or phase-05 says what happens when the last admin leaves,
      // and deciding it here would be a product decision made in a function body.
      logWarn({ ...ctx, gid }, 'a deleting account was an admin — check admin succession');
    }

    const left = await db.runTransaction(async (tx) => {
      const freshGroup = await readGroupInTransaction(tx, gid);
      const freshMember = await tx.get(doc.ref);
      const data = freshMember.data();

      if (!freshMember.exists || data?.['leftAt'] != null) return false; // idempotent

      // Re-checked under the transaction. The pre-flight pass above read a balance a
      // concurrent expense may have moved since; the whole precondition is worthless
      // if it can be raced.
      const balanceMinor = data?.['balanceMinor'];
      if (typeof balanceMinor !== 'number' || balanceMinor !== 0) {
        throw new HttpsError(
          'failed-precondition',
          'Settle every outstanding balance before deleting your account.',
          { outstanding: [{ groupId: gid, balanceMinor: null, groupName: null, currency: null }] },
        );
      }

      if (freshGroup === null) {
        // The member document outlived its group. `markMemberLeftInTransaction` would
        // `update()` a group document that does not exist and abort the transaction,
        // so mark the membership closed on its own and move on.
        tx.update(doc.ref, { leftAt: Timestamp.now() });
        return true;
      }

      markMemberLeftInTransaction(tx, freshGroup, uid);
      return true;
    });

    if (left) groupsLeft += 1;
  }

  // ---- 4. scrub the denormalized name/photo from every member document --------
  // The snapshot on a member document is personal data in its own right (D4 copies it
  // there so the group renders without joins), so erasure has to reach it.
  //
  // ⚠️ `onUserProfileWritten`'s fan-out writes the SAME two values once step 5
  //    anonymises the profile, so this pass is redundant on the happy path. It is
  //    here anyway: that fan-out is a trigger, triggers are eventually consistent and
  //    can be dropped, and "your name was removed from other people's groups" is not
  //    a promise to make conditional on a trigger firing. Both writes are idempotent
  //    and produce identical values (see ANONYMISED_DISPLAY_NAME).
  await scrubInBatches(
    memberDocs.docs.map((d) => d.ref),
    { displayName: ANONYMISED_DISPLAY_NAME, photoURL: null },
  );

  // ---- 5. friend records -----------------------------------------------------
  // Reciprocal records (other people's copies) are scrubbed, not deleted: they carry
  // `implicitGroupId` and `balanceMinor`, which is the other user's data about their
  // own history. See "WHAT IS DELETED vs WHAT IS ANONYMISED" in the header.
  const reciprocal = await db.collectionGroup('friends').where('friendUid', '==', uid).get();
  await scrubInBatches(
    reciprocal.docs.map((d) => d.ref),
    { displayName: ANONYMISED_DISPLAY_NAME, photoURL: null },
  );

  // The departing user's OWN friend list is deleted outright — it names other people
  // and is not a ledger record.
  const ownFriends = await db.collection(`users/${uid}/friends`).get();
  for (let i = 0; i < ownFriends.docs.length; i += BATCH_SIZE) {
    const batch = db.batch();
    for (const d of ownFriends.docs.slice(i, i + BATCH_SIZE)) batch.delete(d.ref);
    await batch.commit();
  }

  // ---- 6. anonymise the profile, and capture its index keys FIRST -------------
  // The `usernames/{hash}` document ids are derived from the email and phone stored
  // on the profile, so they have to be read before those fields are cleared —
  // afterwards there is nothing left to hash and the index entries become
  // unreachable orphans that still resolve friend lookups to this uid.
  const profileRef = db.doc(`users/${uid}`);
  const profileSnap = await profileRef.get();
  const staleKeys = indexKeys(claimedIdentity(profileSnap.data()));

  if (profileSnap.exists) {
    // A single-document write is atomic on its own — no transaction needed, and a
    // transaction would not make it safer. Note this write fires
    // `onUserProfileWritten`, which independently drops the same index entries and
    // fans the anonymised name out; both converge on the state this function is
    // already writing directly.
    await profileRef.update({
      displayName: ANONYMISED_DISPLAY_NAME,
      email: null,
      phoneNumber: null,
      photoURL: null,
      deletedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  } else {
    // No profile document means nothing to anonymise. Not an error — docs/06 makes
    // the profile client-upserted and self-healing, so an account can exist in Auth
    // before it exists in Firestore.
    logWarn(ctx, 'no profile document to anonymise — continuing with account deletion');
  }

  // ---- 7. drop the lookup index entries --------------------------------------
  // One transaction per key, and each checks ownership before deleting. Not paranoia:
  // an email can be released and re-registered by someone else, and deleting by key
  // alone would unindex whoever holds that identifier now — silently breaking friend
  // lookups for an unrelated account. Same check as `onUserProfileWritten`.
  for (const key of staleKeys) {
    const ref = db.doc(`usernames/${key}`);
    const removed = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists || snap.data()?.['uid'] !== uid) return false;
      tx.delete(ref);
      return true;
    });
    if (removed) logInfo({ ...ctx, key }, 'removed usernames index entry');
  }

  // ---- 8. the Firebase Auth user, LAST ---------------------------------------
  // See the header: this is the step that can fail after everything else succeeded,
  // and the ordering is chosen so that failure is recoverable by calling again.
  try {
    await adminAuth.deleteUser(uid);
  } catch (err) {
    if (isUserNotFound(err)) {
      // Already gone — a retry of a call that got this far last time. Idempotent
      // success, not an error.
      logInfo(ctx, 'Auth user was already deleted — completing idempotently');
    } else {
      logError(
        { ...ctx, groupsLeft },
        'FIRESTORE CLEANUP DONE BUT AUTH DELETION FAILED — account is anonymised and still signable-in',
        err,
      );
      throw new HttpsError(
        'internal',
        'Your data was removed but the sign-in could not be deleted. Please try again.',
      );
    }
  }

  logInfo({ ...ctx, groupsLeft, friendsRemoved: ownFriends.size }, 'account deleted');
  return { deleted: true, groupsLeft, friendsRemoved: ownFriends.size };
});

/**
 * Applies the same field patch to many documents, in batches.
 *
 * Firestore caps a batch at 500 writes and docs/10 uses 400 for headroom
 * (`BATCH_SIZE`). Batches commit sequentially so a large fan-out does not spike write
 * contention — the same shape `fanOutDisplayFields` uses.
 */
async function scrubInBatches(
  refs: readonly FirebaseFirestore.DocumentReference[],
  patch: Record<string, unknown>,
): Promise<void> {
  for (let i = 0; i < refs.length; i += BATCH_SIZE) {
    const batch = db.batch();
    for (const ref of refs.slice(i, i + BATCH_SIZE)) batch.update(ref, patch);
    await batch.commit();
  }
}

/**
 * `auth/user-not-found` from the Admin SDK, narrowed without trusting the shape.
 *
 * `useUnknownInCatchVariables` is on, so the error arrives as `unknown` and every
 * property access has to be earned — a thrown string or a plain object must not
 * become a false "already deleted".
 */
function isUserNotFound(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: unknown }).code === 'auth/user-not-found'
  );
}
