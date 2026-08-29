/**
 * `useGroupMembers(gid)` — the member documents, and `useGroupBalances(gid)` over them.
 *
 * 🔴 `useGroupBalances` **reads** balances; it never computes them (Article III, phase-07 §2).
 * `balanceMinor` on a member document is written exclusively by Cloud Functions from the ledger,
 * and every client write to it is denied. A hook that recomputed here would be a second
 * implementation of the balance engine (Article VI) whose only possible contribution is to
 * disagree with the server about what somebody owes.
 *
 * `simplifyDebts()` in `core/src/domain` may then run over these values for the suggested-payment
 * view. That is a pure, display-only transform of numbers the server produced — it never writes,
 * and it never changes what anyone owes (AC-E3.3).
 */

import { useEffect, useMemo, useState } from 'react';

import type { Balance } from '../domain/index.js';
import { watchMembers } from '../repositories/groupRepo.js';
import type { GroupMember } from '../types/index.js';
import { useAuth } from './useAuth.js';

/** What {@link useGroupMembers} returns. */
export interface UseGroupMembersResult {
  /** Current members first, then people who have left; each block ordered by display name. */
  readonly members: readonly GroupMember[];
  /** Members who have not left — the people an expense or a settlement may name. */
  readonly activeMembers: readonly GroupMember[];
  /** The signed-in user's own member document, or `null` if they are not in this group. */
  readonly me: GroupMember | null;
  /** `true` when the signed-in user is an admin of this group. */
  readonly isAdmin: boolean;
  /** `true` until the first snapshot arrives. An empty list is a real answer, not loading. */
  readonly loading: boolean;
  /** The subscription failure, if there was one. */
  readonly error: Error | null;
}

/** An empty array that keeps its identity, so a signed-out render is referentially stable. */
const NO_MEMBERS: readonly GroupMember[] = [];

export function useGroupMembers(groupId: string): UseGroupMembersResult {
  const { user } = useAuth();
  const uid = user?.uid ?? null;

  const [members, setMembers] = useState<readonly GroupMember[]>(NO_MEMBERS);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (uid === null || groupId === '') {
      setMembers(NO_MEMBERS);
      setReady(true);
      setError(null);
      return;
    }

    setReady(false);
    setError(null);

    return watchMembers(
      groupId,
      (next) => {
        setMembers(next);
        setReady(true);
      },
      setError,
    );
  }, [uid, groupId]);

  return useMemo(() => {
    const activeMembers = members.filter((member) => member.leftAt === null);
    const me = members.find((member) => member.uid === uid) ?? null;
    return {
      members,
      activeMembers,
      me,
      isAdmin: me !== null && me.leftAt === null && me.role === 'admin',
      loading: !ready && error === null,
      error,
    };
  }, [members, uid, ready, error]);
}

/* ────────────────────────────────────────────────────────────────────────────────────────── *
 * Balances
 * ────────────────────────────────────────────────────────────────────────────────────────── */

/** What {@link useGroupBalances} returns. */
export interface UseGroupBalancesResult extends UseGroupMembersResult {
  /**
   * Every member with a stake in the group, as `simplifyDebts()` consumes them.
   *
   * Positive means this person is owed money. Across the whole list this sums to exactly zero
   * (AC-E1.3) — a departed member is included when their balance is not zero, so a group that is
   * mid-repair still presents a zero-sum ledger rather than one that silently drops a debt.
   */
  readonly balances: readonly Balance[];
  /** The signed-in user's net balance, or `0` when they are not a member. */
  readonly myBalanceMinor: number;
  /** `true` when every balance in the group is zero — the "all settled up" state. */
  readonly settled: boolean;
}

/** Balances as stored on the member documents. Never recomputed here (Article III). */
export function useGroupBalances(groupId: string): UseGroupBalancesResult {
  const result = useGroupMembers(groupId);
  const { members, me } = result;

  return useMemo(() => {
    const balances: Balance[] = members
      .filter((member) => member.leftAt === null || member.balanceMinor !== 0)
      .map((member) => ({ uid: member.uid, balanceMinor: member.balanceMinor }));

    return {
      ...result,
      balances,
      myBalanceMinor: me?.balanceMinor ?? 0,
      settled: balances.every((balance) => balance.balanceMinor === 0),
    };
  }, [result, members, me]);
}
