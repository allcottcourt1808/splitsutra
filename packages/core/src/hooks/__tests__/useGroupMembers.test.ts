import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { GroupMember, MinorUnits } from '../../types/index.js';
import type { UseGroupBalancesResult, UseGroupMembersResult } from '../useGroupMembers.js';

/**
 * A minimal ordered-slot `react`, identical in shape to the one in `useFriend.test.ts`.
 *
 * `react-dom` is forbidden in core (Article II) and the `unit` project runs on `node`, so a hook
 * is driven by mocking `react` rather than by rendering it.
 */
const react = vi.hoisted(() => {
  type Deps = readonly unknown[] | undefined;

  interface EffectSlot {
    deps: Deps;
    ran: boolean;
    cleanup?: (() => void) | undefined;
  }

  interface MemoSlot {
    deps: Deps;
    value: unknown;
  }

  let states: unknown[] = [];
  let effectSlots: EffectSlot[] = [];
  let memoSlots: MemoSlot[] = [];
  let stateIndex = 0;
  let effectIndex = 0;
  let memoIndex = 0;
  let queued: Array<() => void> = [];
  let body: (() => unknown) | null = null;
  let output: unknown = null;
  let flushing = false;
  let dirty = false;

  const sameDeps = (a: Deps, b: Deps): boolean =>
    a !== undefined &&
    b !== undefined &&
    a.length === b.length &&
    a.every((value, i) => Object.is(value, b[i]));

  const flush = (): void => {
    if (flushing) {
      dirty = true;
      return;
    }
    flushing = true;
    try {
      dirty = true;
      while (dirty) {
        dirty = false;
        stateIndex = 0;
        effectIndex = 0;
        memoIndex = 0;
        if (body !== null) output = body();
        const running = queued;
        queued = [];
        for (const effect of running) effect();
      }
    } finally {
      flushing = false;
    }
  };

  function useState<T>(initial: T | (() => T)): [T, (value: T | ((prev: T) => T)) => void] {
    const i = stateIndex++;
    if (i === states.length) {
      states.push(typeof initial === 'function' ? (initial as () => T)() : initial);
    }
    const setter = (value: T | ((prev: T) => T)): void => {
      const prev = states[i] as T;
      const next = typeof value === 'function' ? (value as (p: T) => T)(prev) : value;
      if (Object.is(next, prev)) return;
      states[i] = next;
      flush();
    };
    return [states[i] as T, setter];
  }

  function useEffect(effect: () => (() => void) | void, deps?: readonly unknown[]): void {
    const i = effectIndex++;
    const slot: EffectSlot = effectSlots[i] ?? { deps: undefined, ran: false };
    effectSlots[i] = slot;
    if (slot.ran && sameDeps(slot.deps, deps)) return;
    queued.push(() => {
      slot.cleanup?.();
      const cleanup = effect();
      slot.cleanup = typeof cleanup === 'function' ? cleanup : undefined;
      slot.deps = deps;
      slot.ran = true;
    });
  }

  function useMemo<T>(factory: () => T, deps?: readonly unknown[]): T {
    const i = memoIndex++;
    const slot = memoSlots[i];
    if (slot !== undefined && sameDeps(slot.deps, deps)) return slot.value as T;
    const value = factory();
    memoSlots[i] = { deps, value };
    return value;
  }

  return {
    useState,
    useEffect,
    useMemo,
    mount(render: () => unknown): void {
      states = [];
      effectSlots = [];
      memoSlots = [];
      queued = [];
      body = render;
      flush();
    },
    rerender: flush,
    unmount(): void {
      for (const slot of effectSlots) slot.cleanup?.();
      effectSlots = [];
      body = null;
    },
    output: (): unknown => output,
  };
});

vi.mock('react', () => ({
  useState: react.useState,
  useEffect: react.useEffect,
  useMemo: react.useMemo,
}));

const auth = vi.hoisted(() => ({ uid: null as string | null }));

vi.mock('../useAuth.js', () => ({
  useAuth: () => ({ user: auth.uid === null ? null : { uid: auth.uid } }),
}));

const repo = vi.hoisted(() => ({ watchMembers: vi.fn() }));

vi.mock('../../repositories/groupRepo.js', () => repo);

const { useGroupBalances, useGroupMembers } = await import('../useGroupMembers.js');

interface Channel {
  groupId: string;
  emit: (value: readonly GroupMember[]) => void;
  fail: (error: Error) => void;
  unsubscribe: ReturnType<typeof vi.fn>;
}

interface MemberOverrides {
  readonly role?: 'admin' | 'member';
  readonly balanceMinor?: number;
  readonly left?: boolean;
}

function member(uid: string, overrides: MemberOverrides = {}): GroupMember {
  return {
    uid,
    role: overrides.role ?? 'member',
    displayName: uid,
    photoURL: null,
    balanceMinor: (overrides.balanceMinor ?? 0) as MinorUnits,
    leftAt: overrides.left === true ? { seconds: 0, nanoseconds: 0 } : null,
  } as unknown as GroupMember;
}

let channels: Channel[] = [];
let groupId = 'g1';

const latest = (): Channel => channels[channels.length - 1]!;

beforeEach(() => {
  vi.clearAllMocks();
  channels = [];
  groupId = 'g1';
  auth.uid = 'me';
  repo.watchMembers.mockImplementation(
    (
      gid: string,
      onNext: (value: readonly GroupMember[]) => void,
      onError: (error: Error) => void,
    ) => {
      const unsubscribe = vi.fn();
      channels.push({ groupId: gid, emit: onNext, fail: onError, unsubscribe });
      return unsubscribe;
    },
  );
});

/* ────────────────────────────────────────────────────────────────────────────────────────── *
 * useGroupMembers
 * ────────────────────────────────────────────────────────────────────────────────────────── */

describe('useGroupMembers', () => {
  const view = (): UseGroupMembersResult => react.output() as UseGroupMembersResult;
  const mount = (): void => {
    react.mount(() => useGroupMembers(groupId));
  };

  it('starts loading and subscribes to the group', () => {
    mount();

    expect(repo.watchMembers).toHaveBeenCalledTimes(1);
    expect(latest().groupId).toBe('g1');
    expect(view().loading).toBe(true);
    expect(view().members).toEqual([]);
  });

  it('splits active members out from those who have left', () => {
    mount();
    latest().emit([member('me'), member('alice'), member('bob', { left: true })]);

    const result = view();
    expect(result.loading).toBe(false);
    expect(result.members).toHaveLength(3);
    expect(result.activeMembers.map((m) => m.uid)).toEqual(['me', 'alice']);
  });

  it('identifies the caller and their role', () => {
    mount();
    latest().emit([member('me', { role: 'admin' }), member('alice')]);

    expect(view().me?.uid).toBe('me');
    expect(view().isAdmin).toBe(true);
  });

  it('does not treat a departed admin as an admin', () => {
    // Rights come with membership: someone who has left cannot still remove people.
    mount();
    latest().emit([member('me', { role: 'admin', left: true }), member('alice')]);

    expect(view().isAdmin).toBe(false);
  });

  it('reports a non-member caller as having no member document', () => {
    mount();
    latest().emit([member('alice'), member('bob')]);

    expect(view().me).toBeNull();
    expect(view().isAdmin).toBe(false);
  });

  it('surfaces a subscription failure and stops loading', () => {
    const boom = new Error('permission-denied');

    mount();
    latest().fail(boom);

    expect(view().error).toBe(boom);
    expect(view().loading).toBe(false);
  });

  it('does not subscribe when signed out', () => {
    auth.uid = null;
    mount();

    expect(repo.watchMembers).not.toHaveBeenCalled();
    expect(view().loading).toBe(false);
  });

  it('does not subscribe without a group id', () => {
    groupId = '';
    mount();

    expect(repo.watchMembers).not.toHaveBeenCalled();
    expect(view().loading).toBe(false);
  });

  it('unsubscribes on unmount', () => {
    mount();
    const channel = latest();
    react.unmount();

    expect(channel.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('keeps the result referentially stable across an inert rerender', () => {
    mount();
    latest().emit([member('me')]);
    const before = view();
    react.rerender();

    expect(view()).toBe(before);
  });
});

/* ────────────────────────────────────────────────────────────────────────────────────────── *
 * useGroupBalances
 * ────────────────────────────────────────────────────────────────────────────────────────── */

describe('useGroupBalances', () => {
  const view = (): UseGroupBalancesResult => react.output() as UseGroupBalancesResult;
  const mount = (): void => {
    react.mount(() => useGroupBalances(groupId));
  };

  it('reads balances straight off the member documents', () => {
    // 🔴 Article III — the server owns balances. This hook never recomputes one.
    mount();
    latest().emit([member('me', { balanceMinor: 2500 }), member('alice', { balanceMinor: -2500 })]);

    expect(view().balances).toEqual([
      { uid: 'me', balanceMinor: 2500 },
      { uid: 'alice', balanceMinor: -2500 },
    ]);
    expect(view().myBalanceMinor).toBe(2500);
    expect(view().settled).toBe(false);
  });

  it('sums to exactly zero, which is the invariant the whole system rests on', () => {
    mount();
    latest().emit([
      member('me', { balanceMinor: 3334 }),
      member('alice', { balanceMinor: -1667 }),
      member('bob', { balanceMinor: -1667 }),
    ]);

    const total = view().balances.reduce((sum, balance) => sum + balance.balanceMinor, 0);
    expect(total).toBe(0);
  });

  it('reports an all-zero group as settled', () => {
    mount();
    latest().emit([member('me'), member('alice')]);

    expect(view().settled).toBe(true);
    expect(view().myBalanceMinor).toBe(0);
  });

  it('drops a departed member who is square but keeps one who is not', () => {
    // Dropping a departed member with an outstanding balance would break the zero-sum
    // invariant that simplification depends on.
    mount();
    latest().emit([
      member('me', { balanceMinor: 1000 }),
      member('alice', { balanceMinor: -1000, left: true }),
      member('bob', { left: true }),
    ]);

    expect(view().balances.map((balance) => balance.uid)).toEqual(['me', 'alice']);
  });

  it('reports no balance for a caller who is not a member', () => {
    mount();
    latest().emit([member('alice', { balanceMinor: 500 }), member('bob', { balanceMinor: -500 })]);

    expect(view().myBalanceMinor).toBe(0);
    expect(view().me).toBeNull();
  });
});
