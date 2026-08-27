/**
 * `invites/{inviteId}`.
 *
 * Security Rules allow **no client reads at all**. Both the join screen and the redemption go
 * through the `redeemInvite` callable Function, which is the only thing that can add a member.
 * See docs/03-data-model.md.
 */

import { z } from 'zod';

import { displayNameSchema, documentIdSchema, timestampSchema, uidSchema } from './primitives.js';

export const INVITE_STATUSES = ['pending', 'accepted', 'revoked', 'expired'] as const;
export const inviteStatusSchema = z.enum(INVITE_STATUSES);
export type InviteStatus = z.infer<typeof inviteStatusSchema>;

/** How long an invite stays redeemable. Used to derive `expiresAt = createdAt + 14 days`. */
export const INVITE_TTL_DAYS = 14;

/** The unrefined object shape. Exported so partial-update payloads can reuse `.shape`. */
export const inviteBaseSchema = z.object({
  /** Equals the document ID. */
  id: documentIdSchema,
  /** 128 bits of randomness, lowercase hex — 32 characters. */
  token: z.string().regex(/^[0-9a-f]{32}$/, 'Invite token must be 128 bits of lowercase hex'),
  groupId: documentIdSchema,
  /** Denormalized so the join screen can name the group *before* the user joins it. */
  groupName: z.string().trim().min(1).max(60),
  createdBy: uidSchema,
  createdByName: displayNameSchema,
  status: inviteStatusSchema,
  acceptedBy: uidSchema.nullable(),
  /** `createdAt + 14 days`. */
  expiresAt: timestampSchema,
  createdAt: timestampSchema,
});

export const inviteSchema = inviteBaseSchema.refine(
  (i) => i.status !== 'accepted' || i.acceptedBy !== null,
  { message: 'An accepted invite must record who accepted it', path: ['acceptedBy'] },
);

export type Invite = z.infer<typeof inviteSchema>;
