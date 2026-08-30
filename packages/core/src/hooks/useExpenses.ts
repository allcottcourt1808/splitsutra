/**
 * Live expense lists — one group's, and the signed-in user's across every group.
 *
 * Both are subscriptions rather than fetches: a second person adding an expense has to appear
 * without a refresh, which is the whole reason server state arrives over `onSnapshot`.
 */

import { useEffect, useMemo, useState } from 'react';

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
  }, [groupId, pageSize]);

  return useMemo(
    () => ({ expenses, loading: !ready && error === null, error }),
    [expenses, ready, error],
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
  }, [uid, pageSize]);

  return useMemo(
    () => ({ expenses, loading: !ready && error === null, error }),
    [expenses, ready, error],
  );
}
