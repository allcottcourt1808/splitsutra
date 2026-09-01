/**
 * `groups/{groupId}/expenses/{expenseId}/comments` — the discussion thread.
 *
 * **Load-bearing under ADR-11.** Only the expense creator or a group admin may edit an expense
 * (threat T11), so this thread is how everybody else raises "wasn't this $40?". It is a primary
 * feature, not a comment box.
 *
 * Three operations, and deliberately no fourth:
 * - `watchComments` — flat and chronological, no nested replies (AC-D4.5), and capped at the
 *   most recent {@link COMMENTS_PAGE_SIZE}.
 * - `addComment` — any active member, `uid == auth.uid`, text 1–500.
 * - `deleteComment` — your own only (AC-D4.3).
 *
 * 🔴 **There is no `updateComment`.** `firestore.rules` denies `update` outright (AC-D4.4,
 * threat T12): an editable comment in a dispute thread destroys the record of what was actually
 * said. That is a product decision — do not add one here and discover the denial at runtime.
 *
 * 🔴 **This file is the only comment implementation** (Article VI). `expenseRepo`'s
 * `watchExpenseComments` / `addExpenseComment` / `deleteExpenseComment` are the same three
 * functions under the names the expense screens already import; they hold no Firestore call of
 * their own.
 */

import {
  deleteDoc,
  doc,
  limitToLast,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';

import { DomainError } from '../domain/index.js';
import { commentSchema, displayNameSchema, photoUrlSchema, type Comment } from '../types/index.js';
import { commentDoc, commentsCollection } from './refs.js';
import { watchQuery, type OnError, type OnNext, type Unsubscribe } from './subscribe.js';

/**
 * The ceiling on one thread snapshot.
 *
 * A thread has no cap of its own — nothing in Rules, the schema or the Functions limits how many
 * comments an expense can carry — so without this the whole thread was re-delivered on every new
 * comment, and the longest threads are exactly the disputed ones this feature exists for.
 * checklists/phase-10-hardening.md §5b.
 */
export const COMMENTS_PAGE_SIZE = 50;

/**
 * Subscribe to the last {@link COMMENTS_PAGE_SIZE} comments on one expense, oldest first.
 *
 * Chronological rather than newest-first: a thread is read as a conversation, and the reply
 * that resolves a dispute is the last one, not the first.
 *
 * ## `limitToLast`, not `limit` — the end you page from is the load-bearing choice
 *
 * `orderBy('createdAt','asc')` + `limit(n)` would keep the FIRST n comments, so on a long thread
 * the screen would freeze on the opening of an argument and never show how it ended. The rows a
 * reader needs are the most recent ones, so the page is taken from the newest end and delivered
 * in the same ascending order the callers already expect — `limitToLast` reverses internally and
 * hands back an ascending page, which is why there is no client-side `.reverse()` here to get
 * backwards.
 *
 * It also keeps optimistic posts working. An unacknowledged `serverTimestamp()` sorts AFTER every
 * resolved timestamp in the SDK's local query engine, so a comment you have just posted is the
 * last row of an ascending order and therefore always inside a `limitToLast` page. Under
 * `limit()` from the other end it would have been outside one, and `addComment` promises the
 * subscription delivers it.
 *
 * 🔴 **What this hides:** on a thread longer than {@link COMMENTS_PAGE_SIZE}, the earlier
 * comments are not delivered at all, and nothing on screen says so — a full page means there may
 * be older ones. Paging them in wants an `endBefore(firstComment)` query behind a "load earlier"
 * control, which is a screen affordance that does not exist yet; until it does, do not treat this
 * list as the whole record of what was said.
 */
export function watchComments(
  groupId: string,
  expenseId: string,
  onNext: OnNext<readonly Comment[]>,
  onError: OnError,
): Unsubscribe {
  return watchQuery(
    query(
      commentsCollection(groupId, expenseId),
      orderBy('createdAt', 'asc'),
      limitToLast(COMMENTS_PAGE_SIZE),
    ),
    onNext,
    onError,
  );
}

/** The author's name and photo, denormalized at post time so the thread needs no joins (D4). */
export interface CommentAuthor {
  /** Must be the signed-in user — Rules require `uid == auth.uid` (threat T7). */
  readonly uid: string;
  readonly displayName: string;
  readonly photoURL: string | null;
}

/** The author snapshot plus the text. */
export interface NewComment extends CommentAuthor {
  /** 1–500 characters after trimming. */
  readonly text: string;
}

/**
 * Post a comment and return its id. Resolves once the write is accepted locally; the
 * subscription delivers it.
 *
 * The id is minted before the write so the caller gets one back — `id` mirrors the document id
 * and the converter reconciles the two on read, exactly as `createExpense` and `createSettlement`
 * do. `createdAt` must be `serverTimestamp()`: Rules require `createdAt == request.time`, so a
 * client-supplied value is a permission-denied, not a slightly wrong timestamp (threat T7).
 *
 * Two kinds of check, both kept deliberately (Article IV — Rules re-check all of it):
 * - the length guard throws a {@link DomainError} whose message is written to be shown to a user,
 *   because the composer renders `error.message` inline;
 * - `displayName` and `photoURL` are parsed against the schema the converter enforces on **read**.
 *   Skipping those lets a write land a document that no reader can parse, and `watchQuery` fails
 *   the whole thread on one bad row — the comment would take the discussion down with it.
 */
export async function addComment(
  groupId: string,
  expenseId: string,
  comment: NewComment,
): Promise<string> {
  const text = comment.text.trim();
  if (text.length < 1 || text.length > 500) {
    throw new DomainError('INVALID_AMOUNT', 'A comment must be 1 to 500 characters.');
  }

  const reference = doc(commentsCollection(groupId, expenseId));

  await setDoc(reference, {
    id: reference.id,
    uid: comment.uid,
    displayName: displayNameSchema.parse(comment.displayName),
    photoURL: photoUrlSchema.parse(comment.photoURL),
    text: commentSchema.shape.text.parse(text),
    createdAt: serverTimestamp(),
    deletedAt: null,
  });

  return reference.id;
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
