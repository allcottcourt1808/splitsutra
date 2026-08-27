import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FieldValue, db } from '../common/admin.js';
import { CALLABLE_OPTS, parseInput, requireActiveMember, requireAuth } from '../common/callable.js';
import { MAX_GROUP_MEMBERS } from '../common/config.js';
import { CreateInviteSchema } from '../common/contracts.js';
import { logInfo } from '../common/logging.js';
import { requireGroup } from '../lib/groups.js';
import { inviteExpiry, mintInviteToken } from '../lib/invites.js';

/**
 * createInvite — mints an invite token for a group (AC-B3.1).
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
 */
export const createInvite = onCall(CALLABLE_OPTS, async (req) => {
  const uid = requireAuth(req);
  const { groupId } = parseInput(CreateInviteSchema, req.data);

  const member = await requireActiveMember(groupId, uid);
  const group = await requireGroup(groupId);

  // No point minting a token for a group that cannot accept anyone (Q2: 50).
  if (group.memberIds.length >= MAX_GROUP_MEMBERS) {
    throw new HttpsError(
      'resource-exhausted',
      `A group can have at most ${MAX_GROUP_MEMBERS} members.`,
    );
  }

  const ref = db.collection('invites').doc();
  const token = mintInviteToken();

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
    acceptedBy: null,
    expiresAt: inviteExpiry(),
    createdAt: FieldValue.serverTimestamp(),
  });

  logInfo({ fn: 'createInvite', gid: groupId, uid, inviteId: ref.id }, 'invite minted');

  // The token is returned to the caller and nowhere else. It is never readable from
  // Firestore, so this response is the only copy the client will ever see.
  return { inviteId: ref.id, token, groupName: group.name };
});
