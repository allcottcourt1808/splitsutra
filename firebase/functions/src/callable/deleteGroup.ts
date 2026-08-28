import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FieldValue, db } from '../common/admin.js';
import { CALLABLE_OPTS, parseInput, requireAuth, requireGroupAdmin } from '../common/callable.js';
import { DeleteGroupSchema } from '../common/contracts.js';
import { logInfo } from '../common/logging.js';
import { readAllMembers, readGroup, readGroupInTransaction } from '../lib/groups.js';

/**
 * ============================================================================
 * deleteGroup — SOFT delete, admin-only, refused while anyone owes anything
 * ============================================================================
 * docs/06 §"leaveGroup / removeMember / deleteGroup": "caller is admin **and**
 * every member's balance is 0". checklists/phase-05 §3 (AC-C1.5).
 *
 * 🔴 SOFT, NOT HARD — and this is not a preference.
 *
 *    Article V: "Nothing is hard-deleted; soft-delete preserves the audit trail."
 *    ADR-09 (docs/12): "`deletedAt` timestamps; nothing leaves the ledger... 'who
 *    deleted that expense?' is a real question." A hard delete would have to recurse
 *    through `expenses`, `settlements`, `activity`, `comments` and `members` — every
 *    record of money that actually moved between real people — and there is no
 *    version of that which is recoverable. So this function writes ONE field,
 *    `deletedAt`, on the group document. Everything under it survives byte for byte.
 *
 *    What it deliberately does NOT do:
 *      - it does not clear `memberIds`. `firestore.rules` lists a user's groups with
 *        `request.auth.uid in resource.data.memberIds`; emptying it would revoke
 *        every member's read access to their own settled history at the moment of
 *        deletion. Hiding the group is the CLIENT's job — filter `deletedAt == null`.
 *      - it does not set `leftAt` on anyone. Nobody left; the group ended.
 *      - it does not delete a single ledger document.
 *
 * 🔴 THE BALANCE PRECONDITION IS THE WHOLE POINT. Deleting a group in which someone
 *    still owes money destroys the only record that the debt exists — not the money,
 *    the *evidence*. Rules cannot express it (it needs every OTHER member's document,
 *    and `members` is `allow write: if false` so there is no client write to gate),
 *    so this function is the check.
 *
 *    Every member document is inspected, INCLUDING people who have already left.
 *    A departed member holding a non-zero balance is already an invariant violation
 *    (`leaveGroup` and `removeMember` both refuse at a non-zero balance), and burying
 *    it under a deleted group is exactly the wrong response to finding one.
 * ============================================================================
 */
export const deleteGroup = onCall(CALLABLE_OPTS, async (req) => {
  const uid = requireAuth(req);
  const { groupId } = parseInput(DeleteGroupSchema, req.data);
  const ctx = { fn: 'deleteGroup', gid: groupId, uid };

  // 🔴 Authorization FIRST — before the group is read, and before any error can
  //    distinguish "no such group" from "not yours". `leaveGroup` and `removeMember`
  //    call `requireGroup` first; the order is inverted here on purpose, because this
  //    is the destructive one and `requireGroupAdmin` reads only
  //    `groups/{gid}/members/{uid}`, which is `permission-denied` for a stranger
  //    whether or not the group exists. Group ids are unguessable 20-character auto
  //    ids, so this closes very little — but it closes it for free.
  const admin = await requireGroupAdmin(groupId, uid);

  // `readGroup`, not `requireGroup`: `requireGroup` maps an already-soft-deleted group
  // to `not-found`, and a second delete must be an idempotent success rather than an
  // error (the same reasoning as redeemInvite's step 4 — a double tap is not a fault).
  const group = await readGroup(groupId);
  if (group === null) {
    throw new HttpsError('not-found', 'Group not found.');
  }
  if (group.deletedAt !== null) {
    logInfo(ctx, 'deleteGroup was a no-op — group is already deleted');
    return { groupId, deleted: true, alreadyDeleted: true };
  }

  // An implicit group is the hidden container behind a 1:1 friendship (D2), and both
  // `users/{a}/friends/{b}` documents point at it by id. Deleting it would leave two
  // friend records referencing a tombstoned group, and every 1:1 expense path would
  // resolve to it and find it deleted. There is also no UI that reaches here: implicit
  // groups are hidden from the group list. Unfriending is a different operation with a
  // different cleanup, and it does not exist yet — so this refuses rather than
  // inventing half of it in a function body.
  if (group.isImplicit) {
    throw new HttpsError(
      'failed-precondition',
      'This is the hidden group behind a friendship and cannot be deleted on its own.',
    );
  }

  // Pre-flight, outside the transaction, so the caller gets the full list of who still
  // owes what in one round trip instead of one name at a time.
  const members = await readAllMembers(groupId);
  const outstanding = members.filter((m) => m.balanceMinor !== 0);
  if (outstanding.length > 0) {
    throw new HttpsError(
      'failed-precondition',
      'Settle every balance before deleting this group.',
      {
        currency: group.currency,
        outstanding: outstanding.map((m) => ({
          uid: m.uid,
          displayName: m.displayName,
          balanceMinor: m.balanceMinor,
          hasLeft: m.hasLeft,
        })),
      },
    );
  }

  // ⚠️ A TRANSACTION IS REQUIRED, and it buys less than it looks like.
  //
  //    What it buys: re-reading every member document inside the transaction takes a
  //    lock on each, so a concurrent balance write from `recomputeBalances` forces a
  //    retry rather than slipping between the pre-flight read above and the commit.
  //    Without it, an expense added mid-call is deleted along with the group.
  //
  //    What it does NOT buy: the balance pipeline is a Firestore TRIGGER, so an
  //    expense written a millisecond before this commit has not moved any balance
  //    yet — there is nothing for the lock to conflict with, and the group is deleted
  //    with a live debt inside it. That race is not closable from here, and it is the
  //    third reason this is a soft delete: the ledger survives, so
  //    `recomputeGroupBalances` still reports the true numbers afterwards and an
  //    operator can clear `deletedAt` by hand. A hard delete would have made the same
  //    race unrecoverable.
  await db.runTransaction(async (tx) => {
    const freshGroup = await readGroupInTransaction(tx, groupId);
    const membersSnap = await tx.get(db.collection(`groups/${groupId}/members`));

    if (freshGroup === null) {
      throw new HttpsError('not-found', 'Group not found.');
    }
    if (freshGroup.deletedAt !== null) {
      return; // deleted by a concurrent call — idempotent
    }

    for (const doc of membersSnap.docs) {
      const balanceMinor = doc.data()['balanceMinor'];
      if (typeof balanceMinor !== 'number' || balanceMinor !== 0) {
        throw new HttpsError(
          'failed-precondition',
          'Settle every balance before deleting this group.',
          {
            currency: freshGroup.currency,
            outstanding: [
              {
                uid: doc.id,
                balanceMinor: typeof balanceMinor === 'number' ? balanceMinor : null,
              },
            ],
          },
        );
      }
    }

    // The entire delete. One field.
    tx.update(db.doc(`groups/${groupId}`), {
      deletedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  });

  // ⚠️ NO ACTIVITY FEED ENTRY, and that is a gap rather than a decision.
  //
  //    `lib/activity.ts` already renders one (`summaries.groupDeleted`), but core's
  //    `ACTIVITY_TYPES` has no `group.deleted` member — the enum stops at
  //    `group.created` / `group.updated`. Writing this as `group.updated` would make
  //    an append-only, Function-only feed (T8) assert the wrong event about a
  //    destructive action, which is worse than a missing row: the feed's whole value
  //    is that it cannot lie about what happened.
  //
  //    So the audit trail for a group deletion is `deletedAt` on the document plus
  //    this structured log line, and nothing in the feed. TODO: add `group.deleted` to
  //    ACTIVITY_TYPES in packages/core and write the entry inside the transaction
  //    above (see redeemInvite for why it must be the same transaction).
  logInfo(
    {
      ...ctx,
      groupName: group.name,
      actorName: admin.displayName,
      // Member DOCUMENTS, which outnumber live members by everyone who ever left
      // (Article V keeps their documents). `activeMembers` is the live count.
      memberDocs: members.length,
      activeMembers: group.memberIds.length,
    },
    'group soft-deleted by admin — every balance was zero',
  );

  return { groupId, deleted: true, alreadyDeleted: false };
});
