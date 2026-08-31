/**
 * `useGroup(gid)` — one group document.
 *
 * `null` once resolved means "not readable", which for this collection is the same answer as
 * "does not exist": Rules gate `get` on `isMember(gid)`, so a group the caller has left, been
 * removed from, or never joined arrives as a missing document rather than as an error. The
 * screen shows one not-found state for all of those, which is also the only thing it could
 * honestly say.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import { watchGroup } from '../repositories/groupRepo.js';
import type { Group } from '../types/index.js';
import { useAuth } from './useAuth.js';

/** What {@link useGroup} returns. */
export interface UseGroupResult {
  /** The group, or `null` when it does not exist or the caller cannot read it. */
  readonly group: Group | null;
  /** `true` until the first snapshot arrives. A resolved `null` is a real answer, not loading. */
  readonly loading: boolean;
  /** The subscription failure, if there was one. */
  readonly error: Error | null;
  /**
   * Re-subscribe.
   *
   * Needed because a Firestore listener does not recover on its own: `permission-denied`
   * **terminates** the subscription rather than retrying it, and neither of this effect's
   * dependencies changes when the underlying permission does. So a caller that has just fixed
   * the reason for the denial — `repairGroupMembership` writing the member document the rules
   * were looking for — has no way to see the fix without asking for a fresh listener.
   */
  readonly retry: () => void;
}

export function useGroup(groupId: string): UseGroupResult {
  const { user } = useAuth();
  const uid = user?.uid ?? null;

  const [group, setGroup] = useState<Group | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [attempt, setAttempt] = useState(0);

  const retry = useCallback(() => {
    setAttempt((n) => n + 1);
  }, []);

  useEffect(() => {
    if (uid === null || groupId === '') {
      setGroup(null);
      setReady(true);
      setError(null);
      return;
    }

    setReady(false);
    setError(null);

    return watchGroup(
      groupId,
      (next) => {
        setGroup(next);
        setReady(true);
      },
      setError,
    );
    // `attempt` is read for its identity alone: bumping it is what tears the old listener
    // down and starts a new one. Referenced here so the dependency is not "unnecessary".
  }, [uid, groupId, attempt]);

  return useMemo(
    () => ({ group, loading: !ready && error === null, error, retry }),
    [group, ready, error, retry],
  );
}
