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

/** `createInvite` — mints a new invite token for a group the caller belongs to. */
export const createInviteSchema = z.object({
  groupId: documentIdSchema,
});
export type CreateInviteInput = z.infer<typeof createInviteSchema>;

/**
 * `addFriend` — look a person up by email or phone.
 *
 * Exactly one identifier, never both and never neither. Expressed as a refinement rather than
 * a union so the error message says which rule was broken.
 *
 * The lookup itself goes through the hashed `usernameIndex` collection — the raw identifier is
 * never queried against `users`, so this cannot be used to enumerate the user table.
 */
export const addFriendSchema = z
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
export type AddFriendInput = z.infer<typeof addFriendSchema>;

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
