/**
 * `invites/{inviteId}`.
 *
 * Security Rules allow **no client reads at all**. Both the join screen and the redemption go
 * through the `redeemInvite` callable Function, which is the only thing that can add a member.
 * See docs/03-data-model.md.
 *
 * ## An invite is reusable, not a single ticket
 *
 * It was a single ticket once: `redeemInvite` set `status: 'accepted'` on the first redemption
 * and every later click got `failed-precondition`. That made the obvious use — paste one link
 * into a group chat with four people in it — fail for three of them, with an error saying the
 * link had "already been used", which reads like the sender did something wrong.
 *
 * A link is now a standing door into one group until it expires or is reset. What bounds it is
 * not the number of clicks but the group itself: `redeemInvite` refuses once the group holds
 * {@link MAX_GROUP_MEMBERS}, so a leaked link can never add a 51st person, and `expiresAt` closes
 * it after {@link INVITE_TTL_DAYS} days regardless.
 *
 * That is a real widening of what a leaked token buys, and it is why `createInvite` gained a
 * reset: the counterweight to a link that keeps working is being able to stop it.
 */

import { z } from 'zod';

import {
  MAX_GROUP_MEMBERS,
  displayNameSchema,
  documentIdSchema,
  timestampSchema,
  uidSchema,
} from './primitives.js';

/**
 * The lifecycle.
 *
 * `pending` is the **active** state and stays that way across redemptions — a link that three
 * people have walked through is still pending the next one. It reads a little oddly for a link
 * that has plainly been used, and `active` would be the better word, but renaming a stored enum
 * member is a live-data migration: `parseDocument` throws on a value it does not know, so every
 * invite written before the rename would fail to decode.
 *
 * 🔴 `accepted` is **legacy only**. Nothing writes it any more. It is kept in the enum so that
 *    invites consumed under the old single-use rule still decode, and those stay dead — a link
 *    that was already spent does not come back to life because the rules around it changed.
 */
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
  /**
   * Everyone who has walked through this link, in redemption order.
   *
   * Capped at {@link MAX_GROUP_MEMBERS} because that is the ceiling the group imposes anyway —
   * an unbounded array on a document that any group member can cause writes to is a document
   * that grows without a stated limit (Article XI).
   *
   * Defaulted, so invites written before this field existed still decode.
   */
  redeemedBy: z.array(uidSchema).max(MAX_GROUP_MEMBERS).default([]),
  /**
   * @deprecated The single redeemer of a pre-multi-use invite. Never written now; retained so
   * documents from before the change still decode. Read {@link inviteBaseSchema.shape.redeemedBy}
   * instead.
   */
  acceptedBy: uidSchema.nullable(),
  /** `createdAt + 14 days`. */
  expiresAt: timestampSchema,
  createdAt: timestampSchema,
});

export const inviteSchema = inviteBaseSchema.refine(
  (i) => i.status !== 'accepted' || i.acceptedBy !== null,
  { message: 'A legacy accepted invite must record who accepted it', path: ['acceptedBy'] },
);

export type Invite = z.infer<typeof inviteSchema>;

/**
 * Is this invite still a way into the group?
 *
 * The clock is an argument rather than a `Date.now()` inside, so the boundary is testable and so
 * a caller that has to make several decisions against one instant can.
 *
 * 🔴 This is a **display and control-flow** helper, not the authorization decision.
 *    `redeemInvite` re-checks both conditions inside its own transaction against the freshly
 *    read document, because between a client asking "is this usable?" and the server acting on
 *    it, the link may have been reset. The credential check happens once, on the server, on the
 *    value it is about to act on.
 */
export function isInviteRedeemable(
  invite: Pick<Invite, 'status' | 'expiresAt'>,
  now: number = Date.now(),
): boolean {
  return invite.status === 'pending' && invite.expiresAt.toMillis() > now;
}
