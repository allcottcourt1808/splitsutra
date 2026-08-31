/**
 * Live expense lists — one group's, and the signed-in user's across every group.
 *
 * Both are subscriptions rather than fetches: a second person adding an expense has to appear
 * without a refresh, which is the whole reason server state arrives over `onSnapshot`.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  EXPENSE_PAGE_SIZE,
  watchGroupExpenses,
  watchMyExpenses,
} from '../repositories/expenseRepo.js';
import type { Expense } from '../types/index.js';
import { useAuth } from './useAuth.js';

/** What the expense-list hooks return. */
export interface UseExpensesResult {
  /** Non-deleted expenses, newest first. */
  readonly expenses: readonly Expense[];
  /** `true` until the first snapshot arrives. An empty list is a real answer, not loading. */
  readonly loading: boolean;
  /** The subscription failure, if there was one. */
  readonly error: Error | null;
  /**
   * Re-subscribe.
   *
   * A Firestore listener does not recover on its own: `permission-denied` **terminates** it
   * rather than retrying, and nothing in the effect's dependencies changes when the underlying
   * permission does. A list that was denied once — because the member document had not been
   * written yet when the screen mounted — stays empty for the life of that mount without this.
   */
  readonly retry: () => void;
}

/** An empty array that keeps its identity, so an unsubscribed render is referentially stable. */
const NONE: readonly Expense[] = [];

/**
 * One group's expenses, newest first.
 *
 * `null` (no group chosen yet) resolves immediately to an empty list rather than hanging on a
 * spinner — "nothing to subscribe to" is an answer.
 */
export function useGroupExpenses(
  groupId: string | null,
  pageSize: number = EXPENSE_PAGE_SIZE,
): UseExpensesResult {
  const [expenses, setExpenses] = useState<readonly Expense[]>(NONE);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [attempt, setAttempt] = useState(0);

  const retry = useCallback(() => {
    setAttempt((n) => n + 1);
  }, []);

  useEffect(() => {
    if (groupId === null || groupId === '') {
      setExpenses(NONE);
      setReady(true);
      setError(null);
      return;
    }

    setReady(false);
    setError(null);

    return watchGroupExpenses(
      groupId,
      (next) => {
        setExpenses(next);
        setReady(true);
      },
      setError,
      pageSize,
    );
    // `attempt` is read for its identity alone: bumping it is what tears the old listener down
    // and starts a new one. Referenced here so the dependency is not "unnecessary".
  }, [groupId, pageSize, attempt]);

  return useMemo(
    () => ({ expenses, loading: !ready && error === null, error, retry }),
    [expenses, ready, error, retry],
  );
}

/**
 * Every expense the signed-in user participates in, across groups.
 *
 * The `participantIds` filter the collection-group rule requires lives in the repository, so
 * there is no way to call this without it (threat T9).
 */
export function useMyExpenses(pageSize: number = EXPENSE_PAGE_SIZE): UseExpensesResult {
  const { user } = useAuth();
  const uid = user?.uid ?? null;

  const [expenses, setExpenses] = useState<readonly Expense[]>(NONE);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [attempt, setAttempt] = useState(0);

  const retry = useCallback(() => {
    setAttempt((n) => n + 1);
  }, []);

  useEffect(() => {
    if (uid === null) {
      setExpenses(NONE);
      setReady(true);
      setError(null);
      return;
    }

    setReady(false);
    setError(null);

    return watchMyExpenses(
      uid,
      (next) => {
        setExpenses(next);
        setReady(true);
      },
      setError,
      pageSize,
    );
    // `attempt` is read for its identity alone: bumping it is what tears the old listener down
    // and starts a new one. Referenced here so the dependency is not "unnecessary".
  }, [uid, pageSize, attempt]);

  return useMemo(
    () => ({ expenses, loading: !ready && error === null, error, retry }),
    [expenses, ready, error, retry],
  );
}
