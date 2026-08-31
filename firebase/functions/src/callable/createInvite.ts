import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FieldValue, Timestamp, db } from '../common/admin.js';
import { CALLABLE_OPTS, parseInput, requireActiveMember, requireAuth } from '../common/callable.js';
import { MAX_GROUP_MEMBERS } from '../common/config.js';
import { CreateInviteSchema } from '../common/contracts.js';
import { logInfo } from '../common/logging.js';
import { requireGroup } from '../lib/groups.js';
import { inviteExpiry, mintInviteToken } from '../lib/invites.js';

/**
 * createInvite — the group's invite link (AC-B3.1).
 *
 * Server-side because `invites/{id}` is `allow read, write: if false` for every
 * client (T4). A readable invite collection would leak group names and let tokens
 * be harvested; a writable one would let anyone mint themselves a way into any
 * group. So the collection is entirely mediated by this function and `redeemInvite`.
 *
 * Any ACTIVE member may invite — matching `firestore.rules`, where creating
 * expenses and settlements is likewise gated on membership rather than on admin.
 * Restricting invites to admins is a product decision, not a security one; it would
 * belong in docs/12 before it belonged here.
 *
 * ## 🔴 It does not mint one every time, and that is the point
 *
 * A group has ONE active link at a time. This returns it, creating one only when
 * there is none.
 *
 * That follows from the invite being reusable. The token is returned by this call
 * and by nothing else — it is never readable from Firestore — so a caller that has
 * lost the string has no way to ask for it again. Minting a second link would leave
 * the first one live and unreachable beside it: two standing doors into the group,
 * one of which nobody can see, revoke or account for. Read-or-create keeps the
 * number of live doors equal to the number the group can see, which is one.
 *
 * `reset: true` is the counterweight to a link that keeps working: it revokes the
 * current one and issues a fresh token. Nobody who already joined is affected — a
 * membership is not held open by the invite that created it.
 *
 * The NAME is now a slight lie and is kept anyway: a Cloud Function export name is
 * its deployed name (Article XI), so renaming this to `getInviteLink` is a delete
 * plus a create, and every client in flight during the swap gets
 * `functions/not-found`.
 */
export const createInvite = onCall(CALLABLE_OPTS, async (req) => {
  const uid = requireAuth(req);
  const { groupId, reset } = parseInput(CreateInviteSchema, req.data);

  const member = await requireActiveMember(groupId, uid);
  const group = await requireGroup(groupId);

  // No point minting a token for a group that cannot accept anyone (Q2: 50).
  if (group.memberIds.length >= MAX_GROUP_MEMBERS) {
    throw new HttpsError(
      'resource-exhausted',
      `A group can have at most ${MAX_GROUP_MEMBERS} members.`,
    );
  }

  const now = Date.now();

  // Ordered by createdAt so "the current link" is a defined thing if a group ever ends up with
  // two — which read-or-create prevents from here on, but which pre-existing data may already
  // contain, since every call used to mint a new one.
  const existing = await db
    .collection('invites')
    .where('groupId', '==', groupId)
    .where('status', '==', 'pending')
    .orderBy('createdAt', 'desc')
    .limit(10)
    .get();

  const live = existing.docs.filter((doc) => {
    const expiresAt = doc.data()['expiresAt'];
    return expiresAt instanceof Timestamp && expiresAt.toMillis() > now;
  });

  if (reset === true) {
    // Every live link, not just the newest: the whole point of a reset is that no string
    // anybody is holding still opens this group.
    await Promise.all(live.map((doc) => doc.ref.update({ status: 'revoked' })));
    if (live.length > 0) {
      logInfo(
        { fn: 'createInvite', gid: groupId, uid, revoked: live.length },
        'invite links revoked by reset',
      );
    }
  } else {
    const current = live[0];
    if (current !== undefined) {
      const data = current.data();
      const redeemedBy = data['redeemedBy'];
      const expiresAt = data['expiresAt'] as Timestamp;

      logInfo(
        { fn: 'createInvite', gid: groupId, uid, inviteId: current.id },
        'existing invite link returned',
      );

      return {
        inviteId: current.id,
        token: data['token'] as string,
        groupName: group.name,
        expiresAtMillis: expiresAt.toMillis(),
        redeemedCount: Array.isArray(redeemedBy) ? redeemedBy.length : 0,
        created: false,
      };
    }
  }

  const ref = db.collection('invites').doc();
  const token = mintInviteToken();
  const expiresAt = inviteExpiry(now);

  await ref.set({
    id: ref.id,
    token,
    groupId,
    // Denormalized so the join screen can name the group BEFORE the user joins it —
    // it has no read access to `groups/{gid}` until membership exists (T1).
    groupName: group.name,
    createdBy: uid,
    createdByName: member.displayName,
    status: 'pending',
    redeemedBy: [],
    // Legacy field, written as null so documents stay one shape. `redeemedBy` is the record now.
    acceptedBy: null,
    expiresAt,
    createdAt: FieldValue.serverTimestamp(),
  });

  logInfo({ fn: 'createInvite', gid: groupId, uid, inviteId: ref.id }, 'invite minted');

  // The token is returned to the caller and nowhere else. It is never readable from
  // Firestore, so this response is the only copy the client will ever see.
  return {
    inviteId: ref.id,
    token,
    groupName: group.name,
    expiresAtMillis: expiresAt.toMillis(),
    redeemedCount: 0,
    created: true,
  };
});
