/**
 * `groups/{groupId}/expenses/{expenseId}/comments/{commentId}`.
 *
 * **Load-bearing under ADR-11.** Only the expense creator or a group admin may edit an expense,
 * so this thread is how everyone else raises "wasn't this $40?". See docs/03-data-model.md D7.
 *
 * Flat and chronological — one thread per expense, no nested replies (AC-D4.5).
 */

import { z } from 'zod';

import {
  displayNameSchema,
  documentIdSchema,
  photoUrlSchema,
  timestampSchema,
  uidSchema,
} from './primitives.js';

export const commentSchema = z.object({
  /** Equals the document ID. */
  id: documentIdSchema,
  uid: uidSchema,
  /** Denormalized snapshot of the author's name at post time. */
  displayName: displayNameSchema,
  photoURL: photoUrlSchema,
  text: z.string().trim().min(1).max(500),
  createdAt: timestampSchema,
  /**
   * Soft delete only. A user may delete their own comment (AC-D4.3).
   *
   * 🔴 **Nobody may edit a comment** (AC-D4.4, threat T12) — there is no `updatedAt` here on
   * purpose. An edited comment in a dispute thread destroys the record of what was said.
   */
  deletedAt: timestampSchema.nullable(),
});

export type Comment = z.infer<typeof commentSchema>;
