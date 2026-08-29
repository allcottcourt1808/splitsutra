/**
 * `useFriendRequests()` — the signed-in user's inbox and outbox of friend requests.
 *
 * ## This hook is the in-app notification
 *
 * docs/03 defers a `notifications` collection ("deferred with push"), and nothing here needs
 * one. `incoming` is a live `onSnapshot` over the pending requests addressed to the user, so a
 * request sent while the app is open appears without a refresh, and {@link useFriendRequests}
 * `.incomingCount` is what the Friends tab badges.
 *
 * A notification document would have been a second copy of this fact, written by a Function,
 * that could drift out of step with the request it describes and would have to be marked read
 * on every device separately. The request is authoritative and it removes itself from the query
 * the moment it is answered — on any device.
 *
 * ## Two subscriptions, not one
 *
 * Firestore has no `OR` across different fields (`toUid == me || fromUid == me` is not a query
 * this can express as one index), so the inbox and the outbox are separate listeners. They are
 * exposed from one hook anyway because every screen that wants one wants the other: the Add
 * Friend screen needs the outbox to avoid offering to send a duplicate, and the Friends screen
 * needs the inbox to show what is waiting.
 */

import { useEffect, useMemo, useState } from 'react';

import {
  watchIncomingFriendRequests,
  watchOutgoingFriendRequests,
} from '../repositories/friendRequestRepo.js';
import type { FriendRequest } from '../types/index.js';
import { useAuth } from './useAuth.js';

/** What {@link useFriendRequests} returns. */
export interface UseFriendRequestsResult {
  /** Pending requests addressed to the signed-in user, newest first. */
  readonly incoming: readonly FriendRequest[];
  /** Pending requests the signed-in user has sent, newest first. */
  readonly outgoing: readonly FriendRequest[];
  /** `incoming.length` — what a tab badge shows. */
  readonly incomingCount: number;
  /** `true` until both subscriptions have delivered their first snapshot. */
  readonly loading: boolean;
  /** The first subscription failure, usually a permission denial or a missing index. */
  readonly error: Error | null;
}

/** An empty array that keeps its identity, so a signed-out render is referentially stable. */
const NONE: readonly FriendRequest[] = [];

export function useFriendRequests(): UseFriendRequestsResult {
  const { user } = useAuth();
  const uid = user?.uid ?? null;

  const [incoming, setIncoming] = useState<readonly FriendRequest[]>(NONE);
  const [outgoing, setOutgoing] = useState<readonly FriendRequest[]>(NONE);
  const [incomingReady, setIncomingReady] = useState(false);
  const [outgoingReady, setOutgoingReady] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (uid === null) {
      // Signed out: drop whatever the previous session was showing rather than leaving one
      // user's pending requests on screen while the next one signs in.
      setIncoming(NONE);
      setOutgoing(NONE);
      setIncomingReady(true);
      setOutgoingReady(true);
      setError(null);
      return;
    }

    setIncomingReady(false);
    setOutgoingReady(false);
    setError(null);

    // Both listeners report into the same error slot, and the first failure wins. A second
    // message would overwrite the first with no more information — and the overwhelmingly
    // likely cause of either failing is the one thing that breaks both: a missing index or a
    // rules deployment that has not caught up.
    const fail = (cause: Error): void => {
      setError((existing) => existing ?? cause);
    };

    const stopIncoming = watchIncomingFriendRequests(
      uid,
      (requests) => {
        setIncoming(requests);
        setIncomingReady(true);
      },
      fail,
    );
    const stopOutgoing = watchOutgoingFriendRequests(
      uid,
      (requests) => {
        setOutgoing(requests);
        setOutgoingReady(true);
      },
      fail,
    );

    return () => {
      stopIncoming();
      stopOutgoing();
    };
  }, [uid]);

  return useMemo(
    () => ({
      incoming,
      outgoing,
      incomingCount: incoming.length,
      // Not loading once an error has been reported: after a permission denial or a missing
      // index the snapshot is not coming, and a spinner that never stops is worse than a message.
      loading: (!incomingReady || !outgoingReady) && error === null,
      error,
    }),
    [incoming, outgoing, incomingReady, outgoingReady, error],
  );
}
