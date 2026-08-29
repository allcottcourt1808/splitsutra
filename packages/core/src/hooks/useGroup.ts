/**
 * `useGroup(gid)` — one group document.
 *
 * `null` once resolved means "not readable", which for this collection is the same answer as
 * "does not exist": Rules gate `get` on `isMember(gid)`, so a group the caller has left, been
 * removed from, or never joined arrives as a missing document rather than as an error. The
 * screen shows one not-found state for all of those, which is also the only thing it could
 * honestly say.
 */

import { useEffect, useMemo, useState } from 'react';

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
}

export function useGroup(groupId: string): UseGroupResult {
  const { user } = useAuth();
  const uid = user?.uid ?? null;

  const [group, setGroup] = useState<Group | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<Error | null>(null);

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
  }, [uid, groupId]);

  return useMemo(
    () => ({ group, loading: !ready && error === null, error }),
    [group, ready, error],
  );
}
