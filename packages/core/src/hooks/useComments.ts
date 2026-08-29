/**
 * `useComments()` — one expense's discussion thread, oldest first.
 *
 * Read-only. Posting and deleting go straight to `addComment` / `deleteComment`, because a
 * thread's write path has no state worth holding in a hook: the subscription delivers the new
 * comment, so a screen that also appended it locally would fight the snapshot.
 */

import { useEffect, useMemo, useState } from 'react';

import { watchComments } from '../repositories/commentRepo.js';
import type { Comment } from '../types/index.js';

/** What {@link useComments} returns. */
export interface UseCommentsResult {
  /** Chronological — a thread reads as a conversation (AC-D4.5). */
  readonly comments: readonly Comment[];
  /** `true` until the first snapshot arrives. An empty thread is a real answer, not loading. */
  readonly loading: boolean;
  readonly error: Error | null;
}

/** An empty array that keeps its identity, so an unresolved render is referentially stable. */
const NONE: readonly Comment[] = [];

export function useComments(groupId: string, expenseId: string): UseCommentsResult {
  const [comments, setComments] = useState<readonly Comment[]>(NONE);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (groupId === '' || expenseId === '') {
      setComments(NONE);
      setReady(true);
      setError(null);
      return;
    }

    setReady(false);
    setError(null);

    return watchComments(
      groupId,
      expenseId,
      (next) => {
        setComments(next);
        setReady(true);
      },
      setError,
    );
  }, [groupId, expenseId]);

  return useMemo(
    () => ({ comments, loading: !ready && error === null, error }),
    [comments, ready, error],
  );
}
