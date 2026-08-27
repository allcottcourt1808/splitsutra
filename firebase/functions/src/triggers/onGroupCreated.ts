import { onDocumentCreated } from 'firebase-functions/v2/firestore';

import { db } from '../common/admin.js';
import { MAX_INSTANCES, REGION } from '../common/config.js';
import { logError, logInfo, withLogging } from '../common/logging.js';
import { activityIdFromEvent, summaries, writeActivity } from '../lib/activity.js';
import { newMemberDoc, profileSnapshot } from '../lib/groups.js';

/**
 * ============================================================================
 * onGroupCreated — seeds the creator's member document
 * ============================================================================
 * checklists/phase-05 §3: "seed the creator's `members/{uid}` doc as `admin` with
 * `balanceMinor: 0`, write the `group.created` activity entry".
 *
 * Why a Function and not the client: `groups/{gid}/members/{uid}` is
 * `allow write: if false` for every client, unconditionally (T2 + T4). That rule is
 * what makes it impossible for anyone to write their own `balanceMinor`, and it has
 * no exception for "but it's my own first member doc" — so the creator's membership
 * has to be minted server-side. `firestore.rules` pins `memberIds == [creator]` and
 * `memberCount == 1` at create time, so this function only adds the member document
 * itself; it never widens membership.
 *
 * 🔴 IDEMPOTENCE. Triggers deliver at least once, and `addFriend` creates its
 *    implicit 1:1 group together with BOTH member documents in one transaction —
 *    so this function frequently runs against a group whose member doc already
 *    exists. It therefore reads before writing and leaves an existing document
 *    alone. A blind `set()` here would reset a live `balanceMinor` to zero, which
 *    is the T2 attack committed by our own code.
 * ============================================================================
 */
export const onGroupCreated = onDocumentCreated(
  {
    document: 'groups/{gid}',
    region: REGION,
    maxInstances: MAX_INSTANCES, // Article XI
  },
  async (event) => {
    const gid = event.params.gid;
    const ctx = { fn: 'onGroupCreated', gid };

    await withLogging(ctx, async () => {
      const data = event.data?.data();
      if (data === undefined) return;

      const createdBy = data['createdBy'];
      const name = data['name'];
      if (typeof createdBy !== 'string' || createdBy.length === 0) {
        logError(ctx, 'group created with no createdBy — cannot seed a member document');
        return;
      }

      const profile = await profileSnapshot(createdBy);
      const memberRef = db.doc(`groups/${gid}/members/${createdBy}`);

      const seeded = await db.runTransaction(async (tx) => {
        const existing = await tx.get(memberRef);
        if (existing.exists) return false; // retry, or addFriend got here first
        tx.set(memberRef, newMemberDoc(createdBy, 'admin', profile));
        return true;
      });

      if (seeded) {
        logInfo({ ...ctx, uid: createdBy }, 'seeded creator member document as admin');
      }

      await writeActivity(gid, activityIdFromEvent(event.id), {
        type: 'group.created',
        actorUid: createdBy,
        actorName: profile.displayName,
        targetId: gid,
        summary: summaries.groupCreated(
          profile.displayName,
          typeof name === 'string' && name.length > 0 ? name.slice(0, 60) : 'a group',
        ),
        amountMinor: null,
        currency: null,
      });
    });
  },
);
