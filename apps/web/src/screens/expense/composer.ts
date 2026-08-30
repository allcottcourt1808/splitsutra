/**
 * The two subscriptions the expense composer needs beyond the expense itself: which groups the
 * user can write into, and who is in the chosen one.
 *
 * ⚠️ These belong in `packages/core/src/hooks` next to `useExpenses` — a hook in core is the
 * portable half (docs/11), and `useGroup` / `useGroupMembers` are being written there under a
 * different work item. They live here so the Add Expense screen is not blocked on that file,
 * and the repository functions they wrap are already in core, so moving them up is an import
 * swap rather than a rewrite. Nothing outside `screens/expense/` imports them.
 */

import { useEffect, useMemo, useState } from 'react';

import { watchExpenseGroups, watchExpenseMembers } from '@splitsutra/core/repositories';
import { useAuth } from '@splitsutra/core/hooks';
import type { Group, GroupMember } from '@splitsutra/core';

export interface UseComposerGroupsResult {
  readonly groups: readonly Group[];
  readonly loading: boolean;
  readonly error: Error | null;
}

const NO_GROUPS: readonly Group[] = [];
const NO_MEMBERS: readonly GroupMember[] = [];

/** Groups the signed-in user may add an expense to, most recently active first. */
export function useComposerGroups(): UseComposerGroupsResult {
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

    return watchExpenseGroups(
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

export interface UseGroupMembersResult {
  readonly members: readonly GroupMember[];
  readonly loading: boolean;
  readonly error: Error | null;
}

/** A group's current members, name-ordered. `null` resolves to an empty list, not a spinner. */
export function useComposerMembers(groupId: string | null): UseGroupMembersResult {
  const [members, setMembers] = useState<readonly GroupMember[]>(NO_MEMBERS);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (groupId === null || groupId === '') {
      setMembers(NO_MEMBERS);
      setReady(true);
      setError(null);
      return;
    }

    setReady(false);
    setError(null);

    return watchExpenseMembers(
      groupId,
      (next) => {
        setMembers(next);
        setReady(true);
      },
      setError,
    );
  }, [groupId]);

  return useMemo(
    () => ({ members, loading: !ready && error === null, error }),
    [members, ready, error],
  );
}

/**
 * `uid → display name`, for screens that hold uids and need to render people.
 *
 * An expense stores participant uids only; the names come from the member documents, which are
 * a denormalized snapshot maintained by Cloud Functions.
 */
export function nameOf(
  members: readonly GroupMember[],
  uid: string,
  selfUid: string | null,
): string {
  if (uid === selfUid) return 'You';
  return members.find((member) => member.uid === uid)?.displayName ?? 'Someone who left';
}
