/**
 * `groups/{groupId}/activity/{activityId}`.
 *
 * Append-only, written by Cloud Functions only. See docs/03-data-model.md.
 */

import { z } from 'zod';

import {
  currencyCodeSchema,
  displayNameSchema,
  documentIdSchema,
  minorUnitsSchema,
  timestampSchema,
  uidSchema,
} from './primitives.js';

export const ACTIVITY_TYPES = [
  'expense.created',
  'expense.updated',
  'expense.deleted',
  'settlement.created',
  'settlement.deleted',
  'member.joined',
  'member.left',
  'member.removed',
  'group.created',
  'group.updated',
] as const;
export const activityTypeSchema = z.enum(ACTIVITY_TYPES);
export type ActivityType = z.infer<typeof activityTypeSchema>;

/** The unrefined object shape. Exported so partial-update payloads can reuse `.shape`. */
export const activityBaseSchema = z.object({
  /** Equals the document ID. */
  id: documentIdSchema,
  type: activityTypeSchema,
  actorUid: uidSchema,
  /** Denormalized snapshot of the actor's name at the time of the event. */
  actorName: displayNameSchema,
  /** The expense, settlement, member, or group the event is about. */
  targetId: documentIdSchema.nullable(),
  /**
   * Pre-rendered server-side, e.g. `Neethu added "Dinner"`.
   *
   * Rendering on write is what lets the feed display with no joins. No maximum length is asserted:
   * this field is written only by Cloud Functions, and a hard cap here would turn a cosmetic
   * server bug into an unreadable feed.
   */
  summary: z.string().min(1),
  amountMinor: minorUnitsSchema.nullable(),
  currency: currencyCodeSchema.nullable(),
  createdAt: timestampSchema,
});

/** An amount without its currency cannot be rendered — the two always travel together (D6). */
export const activitySchema = activityBaseSchema.refine(
  (a) => a.amountMinor === null || a.currency !== null,
  { message: 'An activity amount must carry its currency', path: ['currency'] },
);

export type Activity = z.infer<typeof activitySchema>;
