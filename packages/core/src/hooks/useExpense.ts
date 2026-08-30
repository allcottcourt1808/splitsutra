/**
 * One expense, and its comment thread.
 *
 * The thread is here rather than in its own file because ADR-11 makes the two inseparable:
 * everyone who cannot edit an expense is expected to discuss it instead, so the detail screen
 * always needs both.
 */

import { useEffect, useMemo, useState } from 'react';

import { watchExpense, watchExpenseComments } from '../repositories/expenseRepo.js';
import type { Expense } from '../types/index.js';
import { useCommentThread, type CommentThreadState } from './commentThread.js';

/** What {@link useExpense} returns. */
export interface UseExpenseResult {
  /** The expense, or `null` once resolved as missing. Soft-deleted expenses still resolve. */
  readonly expense: Expense | null;
  /** `true` until the first snapshot arrives. A resolved `null` is a real answer, not loading. */
  readonly loading: boolean;
  /** The subscription failure, if there was one. */
  readonly error: Error | null;
}

export function useExpense(groupId: string, expenseId: string): UseExpenseResult {
  const [expense, setExpense] = useState<Expense | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (groupId === '' || expenseId === '') {
      setExpense(null);
      setReady(true);
      setError(null);
      return;
    }

    setReady(false);
    setError(null);

    return watchExpense(
      groupId,
      expenseId,
      (next) => {
        setExpense(next);
        setReady(true);
      },
      setError,
    );
  }, [groupId, expenseId]);

  return useMemo(
    () => ({ expense, loading: !ready && error === null, error }),
    [expense, ready, error],
  );
}

/**
 * What {@link useExpenseComments} returns — the thread, oldest first. Flat: there are no nested
 * replies (AC-D4.5).
 */
export type UseExpenseCommentsResult = CommentThreadState;

/**
 * The thread for one expense.
 *
 * The same hook as `useComments()`, over the same subscription: `watchExpenseComments` is
 * `commentRepo.watchComments` under the name the expense screens import, and the body is the one
 * in `commentThread.ts` (Article VI).
 */
export function useExpenseComments(groupId: string, expenseId: string): UseExpenseCommentsResult {
  return useCommentThread(watchExpenseComments, groupId, expenseId);
}
