/**
 * `useGroups()` — the signed-in user's groups, most recently active first.
 *
 * Implicit 1:1 friend groups (D2 / ADR-06) and soft-deleted groups are filtered out in the
 * repository, so this is exactly what the Groups tab should show and nothing else.
 *
 * `useMyGroupBalances()` is the second half of that screen. It is a separate hook rather than
 * fields on the first because the balance lives on `groups/{gid}/members/{uid}` — the group
 * document deliberately does not carry it (Article III: a balance is Function-written and lives
 * in the one place Rules make read-only) — so it is a different set of subscriptions with a
 * different lifetime.
 */

import { useEffect, useMemo, useState } from 'react';

import { watchMember, watchMyGroups } from '../repositories/groupRepo.js';
import type { Group, MinorUnits } from '../types/index.js';
import { useAuth } from './useAuth.js';

/** What {@link useGroups} returns. */
export interface UseGroupsResult {
  /** Visible groups, `lastActivityAt` descending. */
  readonly groups: readonly Group[];
  /** `true` until the first snapshot arrives. An empty list is a real answer, not loading. */
  readonly loading: boolean;
  /** The subscription failure, if there was one. */
  readonly error: Error | null;
}

/** An empty array that keeps its identity, so a signed-out render is referentially stable. */
const NO_GROUPS: readonly Group[] = [];

export function useGroups(): UseGroupsResult {
  const { user } = useAuth();
  const uid = user?.uid ?? null;

  const [groups, setGroups] = useState<readonly Group[]>(NO_GROUPS);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (uid === null) {
      setGroups(NO_GROUPS);
      setReady(true);
      setError(null);
      return;
    }

    setReady(false);
    setError(null);

    return watchMyGroups(
      uid,
      (next) => {
        setGroups(next);
        setReady(true);
      },
      setError,
    );
  }, [uid]);

  return useMemo(
    () => ({ groups, loading: !ready && error === null, error }),
    [groups, ready, error],
  );
}

/* ────────────────────────────────────────────────────────────────────────────────────────── *
 * Per-group balances
 * ────────────────────────────────────────────────────────────────────────────────────────── */

/** What {@link useMyGroupBalances} returns. */
export interface UseMyGroupBalancesResult {
  /**
   * Group id → the caller's net balance in that group's currency, positive when they are owed.
   *
   * A group is **absent** until its member document has been read, and absent again if the
   * caller is not a member of it. Absent is not zero — a settled group is a real `0` and the
   * distinction is what lets a caller show "Settled up" rather than a stale amount.
   */
  readonly balanceByGroup: ReadonlyMap<string, MinorUnits>;
  /** `true` until every group has reported once. */
  readonly loading: boolean;
  /** The first subscription failure. */
  readonly error: Error | null;
}

const NO_BALANCES: ReadonlyMap<string, MinorUnits> = new Map();

/**
 * Joined into one primitive so the effect re-runs on a changed list, not on a new array.
 *
 * NUL rather than a comma or a space: a Firestore document ID may legally contain either.
 */
const SEPARATOR = '\u0000';

/**
 * The caller's balance in each of `groupIds` — one member-document listener per group.
 *
 * That is N listeners for N groups, which is the same shape as the activity feed's N queries and
 * is deliberate for the same reason (docs/03): the naive version is fine at the sizes this
 * product has, and Article XII wants a measurement before a per-user mirror collection exists to
 * be kept in step. `watchMyGroups` caps the list at 50, which bounds N.
 */
export function useMyGroupBalances(groupIds: readonly string[]): UseMyGroupBalancesResult {
  const { user } = useAuth();
  const uid = user?.uid ?? null;
  const key = groupIds.join(SEPARATOR);

  const [balanceByGroup, setBalanceByGroup] =
    useState<ReadonlyMap<string, MinorUnits>>(NO_BALANCES);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const ids = key === '' ? [] : key.split(SEPARATOR);

    if (uid === null || ids.length === 0) {
      setBalanceByGroup(NO_BALANCES);
      setReady(true);
      setError(null);
      return;
    }

    setReady(false);
    setError(null);

    // Accumulated outside state: N listeners deliver independently, and a functional update per
    // listener would still have to merge into the same map.
    const accumulated = new Map<string, MinorUnits>();
    const reported = new Set<string>();

    const stops = ids.map((groupId) =>
      watchMember(
        groupId,
        uid,
        (member) => {
          if (member === null) {
            accumulated.delete(groupId);
          } else {
            accumulated.set(groupId, member.balanceMinor);
          }
          reported.add(groupId);
          setBalanceByGroup(new Map(accumulated));
          if (reported.size === ids.length) setReady(true);
        },
        (cause) => {
          // First failure wins: every listener here fails for the same reason — a rules
          // deployment that has not caught up — and the second message adds nothing.
          setError((existing) => existing ?? cause);
        },
      ),
    );

    return () => {
      for (const stop of stops) stop();
    };
  }, [uid, key]);

  return useMemo(
    () => ({ balanceByGroup, loading: !ready && error === null, error }),
    [balanceByGroup, ready, error],
  );
}
