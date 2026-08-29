/**
 * `useFriends()` — the signed-in user's established friendships, ordered by name.
 *
 * A friend document appears here only once a `friendRequests` document was accepted; there is
 * no client write that could put one here. See `useFriendRequests()` for the pending half.
 */

import { useEffect, useMemo, useState } from 'react';

import { watchFriends } from '../repositories/friendRepo.js';
import type { Friend } from '../types/index.js';
import { useAuth } from './useAuth.js';

/** What {@link useFriends} returns. */
export interface UseFriendsResult {
  /** Established friends, ordered case-insensitively by display name. */
  readonly friends: readonly Friend[];
  /** `true` until the first snapshot arrives. An empty list is a real answer, not loading. */
  readonly loading: boolean;
  /** The subscription failure, if there was one. */
  readonly error: Error | null;
}

/** An empty array that keeps its identity, so a signed-out render is referentially stable. */
const NONE: readonly Friend[] = [];

export function useFriends(): UseFriendsResult {
  const { user } = useAuth();
  const uid = user?.uid ?? null;

  const [friends, setFriends] = useState<readonly Friend[]>(NONE);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (uid === null) {
      setFriends(NONE);
      setReady(true);
      setError(null);
      return;
    }

    setReady(false);
    setError(null);

    return watchFriends(
      uid,
      (next) => {
        setFriends(next);
        setReady(true);
      },
      setError,
    );
  }, [uid]);

  return useMemo(
    () => ({ friends, loading: !ready && error === null, error }),
    [friends, ready, error],
  );
}
