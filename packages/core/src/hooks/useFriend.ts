import { useEffect, useMemo, useState } from 'react';

import { watchFriend } from '../repositories/friendRepo.js';
import type { Friend } from '../types/index.js';
import { useAuth } from './useAuth.js';

/** What {@link useFriend} returns. */
export interface UseFriendResult {
  /** The friendship, or `null` when they are not (or are no longer) a friend. */
  readonly friend: Friend | null;
  /** `true` until the first snapshot arrives. A resolved `null` is a real answer, not loading. */
  readonly loading: boolean;
  /** The subscription failure, if there was one. */
  readonly error: Error | null;
}

export function useFriend(friendUid: string): UseFriendResult {
  const { user } = useAuth();
  const uid = user?.uid ?? null;

  const [friend, setFriend] = useState<Friend | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (uid === null || friendUid === '') {
      setFriend(null);
      setReady(true);
      setError(null);
      return;
    }

    setReady(false);
    setError(null);

    return watchFriend(
      uid,
      friendUid,
      (next) => {
        setFriend(next);
        setReady(true);
      },
      setError,
    );
  }, [uid, friendUid]);

  return useMemo(
    () => ({ friend, loading: !ready && error === null, error }),
    [friend, ready, error],
  );
}
