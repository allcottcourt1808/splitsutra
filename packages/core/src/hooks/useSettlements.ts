/**
 * `useGroupSettlements(gid)` — one group's recorded payments, newest first.
 *
 * The sibling of `useGroupExpenses`, and separate from it for the reason Firestore forces:
 * expenses and settlements are different collections, so they are different subscriptions. They
 * are merged into one chronological ledger at the point of display, not here — a hook that
 * returned a pre-merged list would have to invent an ordering for callers that only wanted one
 * of the two.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import { watchSettlements } from '../repositories/settlementRepo.js';
import type { Settlement } from '../types/index.js';

/** What {@link useGroupSettlements} returns. */
export interface UseSettlementsResult {
  /** Non-deleted settlements, newest first. */
  readonly settlements: readonly Settlement[];
  /** `true` until the first snapshot arrives. An empty list is a real answer, not loading. */
  readonly loading: boolean;
  /** The subscription failure, if there was one. */
  readonly error: Error | null;
  /**
   * Re-subscribe.
   *
   * A Firestore listener does not recover on its own — `permission-denied` **terminates** it
   * rather than retrying — and nothing in this effect's dependencies changes when the underlying
   * permission does. See {@link useGroup} for the case that made this necessary.
   */
  readonly retry: () => void;
}

/** An empty array that keeps its identity, so an unsubscribed render is referentially stable. */
const NONE: readonly Settlement[] = [];

export function useGroupSettlements(groupId: string | null): UseSettlementsResult {
  const [settlements, setSettlements] = useState<readonly Settlement[]>(NONE);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [attempt, setAttempt] = useState(0);

  const retry = useCallback(() => {
    setAttempt((n) => n + 1);
  }, []);

  useEffect(() => {
    if (groupId === null || groupId === '') {
      setSettlements(NONE);
      setReady(true);
      setError(null);
      return;
    }

    setReady(false);
    setError(null);

    return watchSettlements(
      groupId,
      (next) => {
        setSettlements(next);
        setReady(true);
      },
      setError,
    );
    // `attempt` is read for its identity alone: bumping it is what tears the old listener down
    // and starts a new one. Referenced here so the dependency is not "unnecessary".
  }, [groupId, attempt]);

  return useMemo(
    () => ({ settlements, loading: !ready && error === null, error, retry }),
    [settlements, ready, error, retry],
  );
}
