/**
 * `useComments()` — one expense's discussion thread, oldest first.
 *
 * Read-only. Posting and deleting go straight to `addComment` / `deleteComment`, because a
 * thread's write path has no state worth holding in a hook: the subscription delivers the new
 * comment, so a screen that also appended it locally would fight the snapshot.
 *
 * The body lives in `commentThread.ts`, which `useExpenseComments()` shares — the two hooks were
 * the same subscription written twice (Article VI).
 */

import { watchComments } from '../repositories/commentRepo.js';
import { useCommentThread, type CommentThreadState } from './commentThread.js';

/** What {@link useComments} returns. */
export type UseCommentsResult = CommentThreadState;

export function useComments(groupId: string, expenseId: string): UseCommentsResult {
  return useCommentThread(watchComments, groupId, expenseId);
}
