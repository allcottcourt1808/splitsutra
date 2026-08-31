/**
 * Input schemas for the callable Cloud Functions.
 *
 * **One Zod definition, shared by client and server** (docs/02-architecture.md). The web app
 * validates with these before spending a network round-trip; the Function validates with the
 * *same* object before trusting anything. Two definitions would drift, and the half that
 * drifts is always the server's.
 *
 * These describe the **request payload only** — never the response, and never the authorization
 * decision. Article IV: Security Rules and the Functions' auth preamble are the boundary. A
 * payload passing its schema means it is well-formed, not that the caller may do it.
 *
 * Naming: camelCase, matching every other schema in `types/`. `firebase/functions` expects
 * PascalCase and re-exports these under aliases from its own seam file
 * (`firebase/functions/src/common/contracts.ts`), which exists for exactly this purpose.
 *
 * See docs/06-cloud-functions.md for the function inventory these correspond to.
 */

import { z } from 'zod';

import { documentIdSchema, uidSchema } from './primitives.js';

/**
 * `redeemInvite` — the only path by which a member is added to a group.
 *
 * The token is 128 bits of lowercase hex, matching `inviteSchema.token`. Validating the shape
 * here means a malformed token is rejected before it costs a Firestore read.
 */
export const redeemInviteSchema = z.object({
  token: z.string().regex(/^[0-9a-f]{32}$/, 'Invite token must be 128 bits of lowercase hex'),
});
export type RedeemInviteInput = z.infer<typeof redeemInviteSchema>;

/**
 * `createInvite` — the group's invite link.
 *
 * Despite the name it does not mint one every time. A group has **one active link at a time**
 * and this returns it, creating one only when there is none. That is what makes a reusable
 * link usable at all: the token is returned by this call and by nothing else — `invites/{id}`
 * is unreadable to every client — so without an idempotent read-or-create, losing the string
 * would mean the old link stays live and unreachable while a second one is minted beside it.
 *
 * The name is kept because a Cloud Function export name IS its deployed name (Article XI):
 * renaming it to `getInviteLink` is a delete plus a create, and every client in flight during
 * the swap gets `functions/not-found`.
 */
export const createInviteSchema = z.object({
  groupId: documentIdSchema,
  /**
   * Revoke the current link and mint a fresh token.
   *
   * The counterweight to a link that keeps working. Anyone still holding the old string gets
   * `failed-precondition` from that moment; nobody who already joined is affected, because a
   * membership is not held open by the invite that created it.
   */
  reset: z.boolean().optional(),
});
export type CreateInviteInput = z.infer<typeof createInviteSchema>;

/**
 * The identifier half of a friend lookup — exactly one of email or phone.
 *
 * Expressed as a refinement rather than a union so the error message says which rule was
 * broken. Shared by {@link sendFriendRequestSchema} and by any future lookup that resolves a
 * contact, because the normalisation contract below applies to all of them equally.
 *
 * 🔴 **This schema is not what normalises the value for the lookup.** It trims and lowercases
 * for UX, but the `usernames/{key}` document ID was derived by `onUserProfileWritten` using
 * `firebase/functions/src/lib/identity.ts`. The Function re-normalises with those functions
 * before hashing; a normalisation that disagrees by one character produces a different sha256
 * and every lookup misses silently, with no error anywhere.
 */
export const friendLookupSchema = z
  .object({
    email: z.string().trim().toLowerCase().email().optional(),
    phoneNumber: z
      .string()
      .trim()
      .regex(/^\+[1-9]\d{7,14}$/, 'Phone number must be E.164, e.g. +14155550123')
      .optional(),
  })
  .refine(
    (v) => (v.email === undefined) !== (v.phoneNumber === undefined),
    'Provide exactly one of email or phoneNumber',
  );
export type FriendLookupInput = z.infer<typeof friendLookupSchema>;

/**
 * `sendFriendRequest` — resolve a contact by email or phone and ask them to be friends.
 *
 * Replaces the old `addFriend`, which created the friendship outright. The lookup is unchanged:
 * it goes through the hashed `usernames/` index, so the raw identifier is never queried against
 * `users` and this cannot be used to enumerate the user table (T5).
 *
 * What changed is what happens after a successful resolve — a `pending` request rather than a
 * group and two friend documents. See `types/friendRequest.ts` for why.
 */
export const sendFriendRequestSchema = friendLookupSchema;
export type SendFriendRequestInput = z.infer<typeof sendFriendRequestSchema>;

/**
 * A `friendRequests/{id}` document ID: `${fromUid}__${toUid}`.
 *
 * Validated by shape rather than by parsing out the two halves. A UID is opaque to us — Firebase
 * documents it as up to 128 characters with no guaranteed alphabet — so splitting on the
 * separator and asserting two valid UIDs would be inventing a constraint. The Function checks
 * the thing that actually matters: that the caller is the party allowed to act on the document
 * it names.
 */
export const friendRequestIdSchema = z
  .string()
  .min(3)
  .max(300)
  .includes('__', { message: 'Not a friend-request ID' });

/**
 * `respondToFriendRequest` — the recipient accepts or declines.
 *
 * `accept` is a required boolean rather than two separate callables: the authorization check,
 * the state-machine guard and the "is this still pending?" read are identical for both answers,
 * and splitting them would duplicate all three. It is not optional — a missing field defaulting
 * to either answer is a mis-tap that cannot be undone.
 */
export const respondToFriendRequestSchema = z.object({
  requestId: friendRequestIdSchema,
  accept: z.boolean(),
});
export type RespondToFriendRequestInput = z.infer<typeof respondToFriendRequestSchema>;

/**
 * `cancelFriendRequest` — the **sender** withdraws a request they have not had an answer to.
 *
 * Separate from `respondToFriendRequest` because the authorization is the mirror image
 * (`fromUid` rather than `toUid`), and because the resulting state differs: `cancelled` can be
 * re-sent, `declined` cannot.
 */
export const cancelFriendRequestSchema = z.object({
  requestId: friendRequestIdSchema,
});
export type CancelFriendRequestInput = z.infer<typeof cancelFriendRequestSchema>;

/** `removeMember` — admin-only; the Function enforces that, not this schema. */
export const removeMemberSchema = z.object({
  groupId: documentIdSchema,
  uid: uidSchema,
});
export type RemoveMemberInput = z.infer<typeof removeMemberSchema>;

/** `leaveGroup` — self-removal. Refused server-side if the caller's balance is non-zero. */
export const leaveGroupSchema = z.object({
  groupId: documentIdSchema,
});
export type LeaveGroupInput = z.infer<typeof leaveGroupSchema>;

/** `deleteGroup` — creator-only, and only when every balance has settled. */
export const deleteGroupSchema = z.object({
  groupId: documentIdSchema,
});
export type DeleteGroupInput = z.infer<typeof deleteGroupSchema>;

/**
 * `recomputeGroupBalances` — the user-facing repair hatch behind "Balances look wrong?".
 *
 * Article V: the ledger is truth and balances are a cache, so a full recompute is always safe
 * to run. Idempotent by construction (docs/06-cloud-functions.md).
 */
export const recomputeGroupBalancesSchema = z.object({
  groupId: documentIdSchema,
});
export type RecomputeGroupBalancesInput = z.infer<typeof recomputeGroupBalancesSchema>;

/**
 * `repairGroupMembership` — materialises the caller's own `members/{uid}` document.
 *
 * The counterpart to `recomputeGroupBalances`: that one repairs a balance, this one repairs the
 * membership record the balance hangs off. It exists because `onGroupCreated` is the ONLY writer
 * of a creator's member document, and a trigger that never ran leaves a group its own creator
 * cannot open — `firestore.rules` gates every `/groups/{gid}/**` read on that document existing.
 *
 * 🔴 It grants no access. The Function refuses unless `group.memberIds` already contains the
 *    caller, and `memberIds` is pinned to `[creator]` at create and immutable to clients
 *    thereafter — so this can only write down a membership the group document already asserts.
 *    It is exactly the trust `allow list` on `/groups/{groupId}` already places in that field.
 */
export const repairGroupMembershipSchema = z.object({
  groupId: documentIdSchema,
});
export type RepairGroupMembershipInput = z.infer<typeof repairGroupMembershipSchema>;

/**
 * `deleteAccount` — irreversible.
 *
 * `confirm` is a literal `true` rather than a boolean on purpose: it makes an accidental
 * `{}` or `{ confirm: false }` a schema failure instead of a silent no-op, and it means the
 * caller cannot delete an account without having said so explicitly.
 */
export const deleteAccountSchema = z.object({
  confirm: z.literal(true),
});
export type DeleteAccountInput = z.infer<typeof deleteAccountSchema>;
