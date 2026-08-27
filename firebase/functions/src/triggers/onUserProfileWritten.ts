import { onDocumentWritten } from 'firebase-functions/v2/firestore';

import { db } from '../common/admin.js';
import { BATCH_SIZE, MAX_INSTANCES, REGION } from '../common/config.js';
import { logError, logInfo, logWarn, withLogging, type LogContext } from '../common/logging.js';
import { claimedIdentity, indexKeys, verifyIdentityAgainstAuth } from '../lib/identity.js';

/**
 * ============================================================================
 * onUserProfileWritten — the usernames/ index and the display fan-out
 * ============================================================================
 * docs/06 §"onUserProfileWritten — the fan-out", checklists/phase-03 §6.
 *
 * 🔴 LAYER 2 OF THE IDENTITY CHECK — the authoritative half.
 *
 *    `firestore.rules` (`users/{uid}.ownsClaimedIdentity`) compares the profile's
 *    `email` / `phoneNumber` against the caller's ID-token claims. That stops the
 *    naive attack. It is still a check on a document the client controls, against a
 *    token the client presented, and it cannot consult the Auth record.
 *
 *    This function re-reads the actual Firebase Auth user and indexes ONLY the
 *    identifiers that user genuinely holds (`verifyIdentityAgainstAuth`). Without
 *    it, getting someone else's email into `usernames/` would point every friend
 *    lookup for that person at the attacker's uid — an identity takeover of the
 *    entire friend-add flow, invisible to both parties. Storing an email you do not
 *    own is harmless; having it INDEXED is not.
 *
 * 🔴 TRIGGER-LOOP SAFETY (Article XI, docs/18 §7). This function must NEVER write
 *    to `users/{uid}`. It writes to `usernames/{key}` and to
 *    `groups/{gid}/members/{uid}` — both different paths, neither of which has a
 *    trigger. If you ever need to stamp something back onto the profile, diff-guard
 *    it or it re-fires forever.
 *
 * COST (docs/06 §"Cost warning"): a rename fans out one write per group. The diff
 * guard below is what keeps a no-op profile write from costing 500 writes.
 * ============================================================================
 */
export const onUserProfileWritten = onDocumentWritten(
  {
    document: 'users/{uid}',
    region: REGION,
    maxInstances: MAX_INSTANCES, // Article XI
  },
  async (event) => {
    const uid = event.params.uid;
    const ctx = { fn: 'onUserProfileWritten', uid };

    await withLogging(ctx, async () => {
      const beforeData = event.data?.before.exists === true ? event.data.before.data() : undefined;
      const afterData = event.data?.after.exists === true ? event.data.after.data() : undefined;

      // ---- 1. the usernames/ lookup index --------------------------------------
      const previous = claimedIdentity(beforeData);

      if (afterData === undefined) {
        // Profile hard-deleted. `firestore.rules` denies client deletes, so this is
        // an Admin SDK or console action — but a dangling index entry would resolve
        // friend lookups to a profile that no longer exists, so clean it up.
        await removeIndexEntries(uid, indexKeys(previous), ctx);
        return;
      }

      const claimed = claimedIdentity(afterData);
      const { verified, rejected } = await verifyIdentityAgainstAuth(uid, claimed);

      if (rejected.length > 0) {
        // Past layer 1 but not past layer 2 — a client bug or an actual attempt at
        // the takeover described above. ERROR level: docs/10 alerts on this.
        logError(
          { ...ctx, rejected },
          'IDENTITY CLAIM REJECTED — profile claims an identifier its Auth user does not hold; not indexed',
        );
      }

      const desiredKeys = indexKeys(verified);
      const staleKeys = indexKeys(previous).filter((key) => !desiredKeys.includes(key));
      await removeIndexEntries(uid, staleKeys, ctx);
      await upsertIndexEntries(uid, desiredKeys, publicProjection(afterData), ctx);

      // ---- 2. the display fan-out (AC-A2.3) ------------------------------------
      // 🔴 Diff FIRST. docs/06: "Only fan out when displayName or photoURL actually
      //    changed." Every profile write bumps `updatedAt`, so without this guard a
      //    user in 500 groups pays 500 writes for setting their default currency.
      const nextName = publicProjection(afterData);
      const prevName = publicProjection(beforeData);
      if (
        nextName.displayName === prevName.displayName &&
        nextName.photoURL === prevName.photoURL
      ) {
        return;
      }

      // TODO(phase-10): rate-limit renames to once per hour per user (docs/06
      // §"Cost warning"). Names are cosmetic and never used for authorization, so
      // this is a cost control, not a correctness one — it belongs with the other
      // Phase 10 hardening knobs rather than as an unmeasured guess here.
      await fanOutDisplayFields(uid, nextName, ctx);
    });
  },
);

interface PublicProjection {
  displayName: string;
  photoURL: string | null;
}

function publicProjection(raw: Record<string, unknown> | undefined): PublicProjection {
  const displayName = raw?.['displayName'];
  const photoURL = raw?.['photoURL'];
  return {
    displayName: typeof displayName === 'string' ? displayName : '',
    photoURL: typeof photoURL === 'string' ? photoURL : null,
  };
}

/**
 * Deletes index entries — but only ones this uid actually owns.
 *
 * The ownership check is not paranoia: two users can hold the same identifier at
 * different times (an email is released and re-registered). Deleting by key alone
 * would let a departing user unindex whoever holds the identifier now.
 */
async function removeIndexEntries(uid: string, keys: string[], ctx: LogContext): Promise<void> {
  for (const key of keys) {
    const ref = db.doc(`usernames/${key}`);
    // Sequential on purpose: at most two keys (email, phone), and each is its own
    // transaction so one bad entry cannot roll back the other.
    const deleted = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return false;
      if (snap.data()?.['uid'] !== uid) return false; // belongs to someone else now
      tx.delete(ref);
      return true;
    });
    if (deleted) logInfo({ ...ctx, key }, 'removed stale usernames index entry');
  }
}

async function upsertIndexEntries(
  uid: string,
  keys: string[],
  projection: PublicProjection,
  ctx: LogContext,
): Promise<void> {
  for (const key of keys) {
    const ref = db.doc(`usernames/${key}`);
    // Sequential on purpose: at most two keys (email, phone), and each is its own
    // transaction so one bad entry cannot roll back the other.
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const existing = snap.data();

      if (existing !== undefined && existing['uid'] !== uid) {
        // We have just verified against the Auth record that THIS uid holds the
        // identifier, and Firebase Auth enforces uniqueness of an email/phone across
        // users — so the stored entry is stale, not a competing claim. Take it over,
        // loudly, because the alternative is a lookup that resolves to the wrong
        // person forever.
        logWarn(
          { ...ctx, key, previousUid: existing['uid'] },
          'usernames index entry reassigned to the Auth-verified owner',
        );
      } else if (
        existing !== undefined &&
        existing['displayName'] === projection.displayName &&
        existing['photoURL'] === projection.photoURL
      ) {
        return; // no change -> no write
      }

      tx.set(ref, {
        uid,
        displayName: projection.displayName,
        photoURL: projection.photoURL,
      });
    });
  }
}

/**
 * Propagates the denormalized name/photo snapshot into every member document.
 *
 * [DEVIATION from docs/06] docs/06 says "query groups where memberIds
 * array-contains uid, batch-update each groups/{gid}/members/{uid}". This uses one
 * collection-group query on `members` where `uid == uid` instead. Same result, and
 * it returns the documents that actually EXIST — constructing member refs from a
 * group list and calling `update()` on them aborts the whole batch the first time
 * one is missing, and `set({merge:true})` would instead CREATE a partial member doc
 * with no `balanceMinor` and no `leftAt`, which `requireActiveMember` then reads as
 * "this person has left". Both failure modes are worse than the deviation.
 *
 * `members.uid` needs no index entry in `firestore.indexes.json`: Firestore creates
 * single-field indexes with collection-group scope automatically.
 */
async function fanOutDisplayFields(
  uid: string,
  projection: PublicProjection,
  ctx: LogContext,
): Promise<void> {
  const snap = await db.collectionGroup('members').where('uid', '==', uid).get();
  if (snap.empty) return;

  // Firestore caps a batch at 500 writes; docs/10 uses 400 for headroom.
  for (let i = 0; i < snap.docs.length; i += BATCH_SIZE) {
    const chunk = snap.docs.slice(i, i + BATCH_SIZE);
    const batch = db.batch();
    for (const doc of chunk) {
      batch.update(doc.ref, {
        displayName: projection.displayName,
        photoURL: projection.photoURL,
      });
    }
    // Sequential on purpose: batches commit one at a time so a large fan-out does
    // not spike write contention on the same documents.
    await batch.commit();
  }

  logInfo({ ...ctx, groups: snap.size }, 'fanned out display name/photo to member documents');
}
