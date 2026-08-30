/**
 * The comment-thread subscription hook, written once (Article VI).
 *
 * `useComments()` and `useExpenseComments()` are the same hook: subscribe to one expense's thread,
 * hold `{ comments, loading, error }`, resolve an empty thread as an answer rather than as a
 * spinner. They exist under two names because the expense detail screen imports one and the
 * comment thread component imports the other; what they must not be is two copies of the body.
 *
 * 🔴 **Internal — deliberately not exported from `hooks/index.ts`.** It takes the subscription as
 * a parameter, which is exactly the sort of seam a screen should never be handed: the two public
 * hooks pass the repository function they belong to, and nothing else may.
 *
 * The parameter is also what keeps each hook pointed at its own repository module: `useComments`
 * reaches Firestore through `commentRepo`, `useExpenseComments` through `expenseRepo`'s alias of
 * the same function. One implementation underneath, two import paths above it.
 */

import { useEffect, useMemo, useState } from 'react';

import type { OnError, OnNext, Unsubscribe } from '../repositories/subscribe.js';
import type { Comment } from '../types/index.js';

/** The shape both `commentRepo.watchComments` and its `expenseRepo` alias have. */
export type WatchCommentThread = (
  groupId: string,
  expenseId: string,
  onNext: OnNext<readonly Comment[]>,
  onError: OnError,
) => Unsubscribe;

/** What a thread subscription holds. Both public hooks return exactly this. */
export interface CommentThreadState {
  /** Chronological — a thread reads as a conversation (AC-D4.5). */
  readonly comments: readonly Comment[];
  /** `true` until the first snapshot arrives. An empty thread is a real answer, not loading. */
  readonly loading: boolean;
  readonly error: Error | null;
}

/** An empty thread that keeps its identity, so an unsubscribed render is referentially stable. */
const NONE: readonly Comment[] = [];

/**
 * Subscribe to one expense's thread through `watch`.
 *
 * A missing id resolves immediately to an empty thread instead of subscribing: "there is no
 * expense to discuss yet" is an answer, and a hook that spun for ever on it would be a screen
 * stuck on a spinner.
 */
export function useCommentThread(
  watch: WatchCommentThread,
  groupId: string,
  expenseId: string,
): CommentThreadState {
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

    return watch(
      groupId,
      expenseId,
      (next) => {
        setComments(next);
        setReady(true);
      },
      setError,
    );
  }, [watch, groupId, expenseId]);

  return useMemo(
    () => ({ comments, loading: !ready && error === null, error }),
    [comments, ready, error],
  );
}
