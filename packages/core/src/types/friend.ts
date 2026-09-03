/**
 * `users/{uid}/friends/{friendUid}`.
 *
 * Written by Cloud Functions only, and always created reciprocally on both users.
 * See docs/03-data-model.md.
 */

import { z } from 'zod';

import {
  balanceByCurrencySchema,
  displayNameSchema,
  documentIdSchema,
  photoUrlSchema,
  timestampSchema,
  uidSchema,
} from './primitives.js';

export const friendSchema = z.object({
  /** Equals the document ID. */
  friendUid: uidSchema,
  /**
   * Denormalized snapshot, taken when the friendship was established.
   *
   * ⚠️ NOT refreshed, whatever D4 implies: `onUserProfileWritten` fans out to `usernames/` and
   * to `groups/{gid}/members/{uid}`, and never touches friend documents — so a friend who
   * renames themselves keeps their old name here. Prefer a member document wherever one is
   * already subscribed (see the web app's `groupLabel`).
   */
  displayName: displayNameSchema,
  photoURL: photoUrlSchema,
  /** The hidden two-person group that carries 1:1 expenses (D2). */
  implicitGroupId: documentIdSchema,
  /**
   * Net balance across **all** shared groups, keyed by currency.
   * Positive means they owe you.
   *
   * Function-write-only (Article III). Never sum across currencies (D6).
   */
  balanceMinor: balanceByCurrencySchema,
  updatedAt: timestampSchema,
});

export type Friend = z.infer<typeof friendSchema>;
