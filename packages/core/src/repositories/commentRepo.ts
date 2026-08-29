/**
 * `groups/{groupId}/expenses/{expenseId}/comments` — the discussion thread.
 *
 * **Load-bearing under ADR-11.** Only the expense creator or a group admin may edit an expense
 * (threat T11), so this thread is how everybody else raises "wasn't this $40?". It is a primary
 * feature, not a comment box.
 *
 * Three operations, and deliberately no fourth:
 * - `watchComments` — flat and chronological, no nested replies (AC-D4.5).
 * - `addComment` — any active member, `uid == auth.uid`, text 1–500.
 * - `deleteComment` — your own only (AC-D4.3).
 *
 * 🔴 **There is no `updateComment`.** `firestore.rules` denies `update` outright (AC-D4.4,
 * threat T12): an editable comment in a dispute thread destroys the record of what was actually
 * said. That is a product decision — do not add one here and discover the denial at runtime.
 */

import { addDoc, deleteDoc, orderBy, query, serverTimestamp } from 'firebase/firestore';

import { commentSchema, displayNameSchema, photoUrlSchema, type Comment } from '../types/index.js';
import { commentDoc, commentsCollection } from './refs.js';
import { watchQuery, type OnError, type OnNext, type Unsubscribe } from './subscribe.js';

/**
 * Subscribe to one expense's thread, oldest first.
 *
 * Chronological rather than newest-first: a thread is read as a conversation, and the reply
 * that resolves a dispute is the last one, not the first.
 */
export function watchComments(
  groupId: string,
  expenseId: string,
  onNext: OnNext<readonly Comment[]>,
  onError: OnError,
): Unsubscribe {
  return watchQuery(
    query(commentsCollection(groupId, expenseId), orderBy('createdAt', 'asc')),
    onNext,
    onError,
  );
}

/** The author snapshot plus the text. Names are denormalized at post time (D4). */
export interface NewComment {
  /** Must be the signed-in user — Rules require `uid == auth.uid` (threat T7). */
  readonly uid: string;
  readonly displayName: string;
  readonly photoURL: string | null;
  /** 1–500 characters after trimming. */
  readonly text: string;
}

/**
 * Post a comment. Resolves once the write is accepted locally; the subscription delivers it.
 *
 * The payload is written through the un-converted collection reference because the document id
 * does not exist yet: `id` mirrors it, and the converter fills it in on read. `createdAt` must be
 * `serverTimestamp()` — Rules require `createdAt == request.time`, so a client-supplied value is
 * a permission-denied, not a slightly wrong timestamp (threat T7).
 *
 * The field parses are UX only; Rules re-check every one of them (Article IV).
 */
export async function addComment(
  groupId: string,
  expenseId: string,
  comment: NewComment,
): Promise<void> {
  await addDoc(commentsCollection(groupId, expenseId).withConverter(null), {
    uid: comment.uid,
    displayName: displayNameSchema.parse(comment.displayName),
    photoURL: photoUrlSchema.parse(comment.photoURL),
    text: commentSchema.shape.text.parse(comment.text),
    createdAt: serverTimestamp(),
    deletedAt: null,
  });
}

/**
 * Delete your own comment (AC-D4.3). Rules refuse anyone else's.
 *
 * A hard delete, because the tombstone phase-08 §3 asks for would need a soft delete — an update
 * setting `deletedAt` — and `update` is denied for T12. The two cannot both hold; `firestore.rules`
 * records the contradiction and the narrow resolution at the `comments` block. Until that decision
 * lands, a deleted comment leaves the thread rather than leaving a marker.
 */
export async function deleteComment(
  groupId: string,
  expenseId: string,
  commentId: string,
): Promise<void> {
  await deleteDoc(commentDoc(groupId, expenseId, commentId));
}
