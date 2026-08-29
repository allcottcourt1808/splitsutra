import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Group, GroupMember, MinorUnits } from '../../types/index.js';
import type { UseGroupsResult, UseMyGroupBalancesResult } from '../useGroups.js';

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

const repo = vi.hoisted(() => ({ watchMyGroups: vi.fn(), watchMember: vi.fn() }));

vi.mock('../../repositories/groupRepo.js', () => repo);

const { useGroups, useMyGroupBalances } = await import('../useGroups.js');

interface GroupsChannel {
  uid: string;
  emit: (value: readonly Group[]) => void;
  fail: (error: Error) => void;
  unsubscribe: ReturnType<typeof vi.fn>;
}

interface MemberChannel {
  groupId: string;
  uid: string;
  emit: (value: GroupMember | null) => void;
  fail: (error: Error) => void;
  unsubscribe: ReturnType<typeof vi.fn>;
}

function group(id: string, name: string): Group {
  return {
    id,
    name,
    type: 'trip',
    isImplicit: false,
    photoURL: null,
    currency: 'INR',
    memberIds: ['me'],
    memberCount: 1,
    simplifyDebts: false,
    createdBy: 'me',
  } as unknown as Group;
}

function member(uid: string, balanceMinor: number): GroupMember {
  return {
    uid,
    role: 'member',
    displayName: uid,
    photoURL: null,
    balanceMinor: balanceMinor as MinorUnits,
    leftAt: null,
  } as unknown as GroupMember;
}

const goa = group('g1', 'Goa Trip');
const flat = group('g2', 'Flat 4B');

let groupsChannels: GroupsChannel[] = [];
let memberChannels: MemberChannel[] = [];
let groupIds: readonly string[] = [];

const groupsChannel = (): GroupsChannel => groupsChannels[groupsChannels.length - 1]!;
const memberChannel = (groupId: string): MemberChannel =>
  memberChannels.find((channel) => channel.groupId === groupId)!;

beforeEach(() => {
  vi.clearAllMocks();
  groupsChannels = [];
  memberChannels = [];
  groupIds = [];
  auth.uid = 'me';

  repo.watchMyGroups.mockImplementation(
    (uid: string, onNext: (value: readonly Group[]) => void, onError: (error: Error) => void) => {
      const unsubscribe = vi.fn();
      groupsChannels.push({ uid, emit: onNext, fail: onError, unsubscribe });
      return unsubscribe;
    },
  );

  repo.watchMember.mockImplementation(
    (
      groupId: string,
      uid: string,
      onNext: (value: GroupMember | null) => void,
      onError: (error: Error) => void,
    ) => {
      const unsubscribe = vi.fn();
      memberChannels.push({ groupId, uid, emit: onNext, fail: onError, unsubscribe });
      return unsubscribe;
    },
  );
});

/* ────────────────────────────────────────────────────────────────────────────────────────── *
 * useGroups
 * ────────────────────────────────────────────────────────────────────────────────────────── */

describe('useGroups', () => {
  const view = (): UseGroupsResult => react.output() as UseGroupsResult;
  const mount = (): void => {
    react.mount(() => useGroups());
  };

  it('starts loading and subscribes with the signed-in uid', () => {
    mount();

    expect(repo.watchMyGroups).toHaveBeenCalledTimes(1);
    expect(groupsChannel().uid).toBe('me');
    expect(view()).toEqual({ groups: [], loading: true, error: null });
  });

  it('resolves to the emitted groups', () => {
    mount();
    groupsChannel().emit([goa, flat]);

    expect(view()).toEqual({ groups: [goa, flat], loading: false, error: null });
  });

  it('treats an empty list as a resolved answer, not loading', () => {
    mount();
    groupsChannel().emit([]);

    expect(view()).toEqual({ groups: [], loading: false, error: null });
  });

  it('surfaces a subscription failure and stops loading', () => {
    const boom = new Error('missing index');

    mount();
    groupsChannel().fail(boom);

    expect(view()).toEqual({ groups: [], loading: false, error: boom });
  });

  it('does not subscribe when signed out', () => {
    auth.uid = null;
    mount();

    expect(repo.watchMyGroups).not.toHaveBeenCalled();
    expect(view()).toEqual({ groups: [], loading: false, error: null });
  });

  it('unsubscribes on unmount', () => {
    mount();
    const channel = groupsChannel();
    react.unmount();

    expect(channel.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('keeps the result referentially stable across an inert rerender', () => {
    mount();
    groupsChannel().emit([goa]);
    const before = view();
    react.rerender();

    expect(view()).toBe(before);
  });
});

/* ────────────────────────────────────────────────────────────────────────────────────────── *
 * useMyGroupBalances
 * ────────────────────────────────────────────────────────────────────────────────────────── */

describe('useMyGroupBalances', () => {
  const view = (): UseMyGroupBalancesResult => react.output() as UseMyGroupBalancesResult;
  const mount = (): void => {
    react.mount(() => useMyGroupBalances(groupIds));
  };

  it('opens one member subscription per group', () => {
    groupIds = ['g1', 'g2'];
    mount();

    expect(repo.watchMember).toHaveBeenCalledTimes(2);
    expect(memberChannels.map((channel) => channel.groupId)).toEqual(['g1', 'g2']);
    expect(memberChannel('g1').uid).toBe('me');
    expect(view().loading).toBe(true);
  });

  it('stays loading until every group has reported', () => {
    groupIds = ['g1', 'g2'];
    mount();

    memberChannel('g1').emit(member('me', 2500));
    expect(view().loading).toBe(true);
    expect(view().balanceByGroup.get('g1')).toBe(2500);

    memberChannel('g2').emit(member('me', -1000));
    expect(view().loading).toBe(false);
    expect(view().balanceByGroup.get('g2')).toBe(-1000);
  });

  it('leaves a group absent rather than zero when there is no member document', () => {
    // Absent is not zero: a settled group is a real 0, and a caller must be able to tell the
    // difference between "settled" and "we do not know yet".
    groupIds = ['g1'];
    mount();
    memberChannel('g1').emit(null);

    expect(view().loading).toBe(false);
    expect(view().balanceByGroup.has('g1')).toBe(false);
  });

  it('keeps a settled balance as an explicit zero', () => {
    groupIds = ['g1'];
    mount();
    memberChannel('g1').emit(member('me', 0));

    expect(view().balanceByGroup.get('g1')).toBe(0);
  });

  it('reports the first failure and stops loading', () => {
    const first = new Error('permission-denied');
    const second = new Error('something else');

    groupIds = ['g1', 'g2'];
    mount();
    memberChannel('g1').fail(first);
    memberChannel('g2').fail(second);

    expect(view().error).toBe(first);
    expect(view().loading).toBe(false);
  });

  it('does nothing for an empty group list', () => {
    groupIds = [];
    mount();

    expect(repo.watchMember).not.toHaveBeenCalled();
    expect(view()).toEqual({ balanceByGroup: new Map(), loading: false, error: null });
  });

  it('does not subscribe when signed out', () => {
    auth.uid = null;
    groupIds = ['g1'];
    mount();

    expect(repo.watchMember).not.toHaveBeenCalled();
    expect(view().loading).toBe(false);
  });

  it('resubscribes only when the group list actually changes', () => {
    groupIds = ['g1'];
    mount();
    memberChannel('g1').emit(member('me', 500));

    // Same ids, new array identity — the effect keys on the joined value, not the reference.
    groupIds = ['g1'];
    react.rerender();
    expect(repo.watchMember).toHaveBeenCalledTimes(1);

    groupIds = ['g1', 'g2'];
    react.rerender();
    expect(repo.watchMember).toHaveBeenCalledTimes(3);
  });

  it('tears every subscription down on unmount', () => {
    groupIds = ['g1', 'g2'];
    mount();
    const stops = memberChannels.map((channel) => channel.unsubscribe);
    react.unmount();

    for (const stop of stops) expect(stop).toHaveBeenCalledTimes(1);
  });
});
