/**
 * `react-dom` is forbidden in core (Article II) and the `unit` project runs on `node`, so the
 * hook is driven by mocking `react` with a minimal ordered-slot runtime instead of rendering.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Friend } from '../../types/index.js';
import type { UseFriendResult } from '../useFriend.js';

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
  let renderCount = 0;

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
        renderCount += 1;
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
      renderCount = 0;
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
    renders: (): number => renderCount,
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

const repo = vi.hoisted(() => ({ watchFriend: vi.fn() }));

vi.mock('../../repositories/friendRepo.js', () => repo);

const { useFriend } = await import('../useFriend.js');

/* ────────────────────────────────────────────────────────────────────────────────────────── *
 * Test doubles
 * ────────────────────────────────────────────────────────────────────────────────────────── */

/** One `watchFriend` subscription, plus the callbacks the hook handed it. */
interface Channel {
  uid: string;
  friendUid: string;
  emit: (value: Friend | null) => void;
  fail: (error: Error) => void;
  unsubscribe: ReturnType<typeof vi.fn>;
}

const alice = {
  friendUid: 'alice',
  displayName: 'Alice',
  photoURL: null,
  implicitGroupId: 'g-alice',
  balanceMinor: { INR: 2500 },
  updatedAt: { seconds: 0, nanoseconds: 0 },
} as unknown as Friend;

let channels: Channel[] = [];
let friendUid = 'alice';

const latest = (): Channel => channels[channels.length - 1]!;
const view = (): UseFriendResult => react.output() as UseFriendResult;
const mount = (): void => {
  react.mount(() => useFriend(friendUid));
};

beforeEach(() => {
  vi.clearAllMocks();
  channels = [];
  friendUid = 'alice';
  auth.uid = 'me';
  repo.watchFriend.mockImplementation(
    (
      uid: string,
      target: string,
      onNext: (value: Friend | null) => void,
      onError: (error: Error) => void,
    ) => {
      const unsubscribe = vi.fn();
      channels.push({ uid, friendUid: target, emit: onNext, fail: onError, unsubscribe });
      return unsubscribe;
    },
  );
});

/* ────────────────────────────────────────────────────────────────────────────────────────── *
 * Tests
 * ────────────────────────────────────────────────────────────────────────────────────────── */

describe('useFriend', () => {
  it('starts loading and subscribes with both uids', () => {
    mount();

    expect(repo.watchFriend).toHaveBeenCalledTimes(1);
    expect(latest().uid).toBe('me');
    expect(latest().friendUid).toBe('alice');
    expect(view()).toEqual({ friend: null, loading: true, error: null });
  });

  it('resolves to the emitted friend', () => {
    mount();
    latest().emit(alice);

    expect(view()).toEqual({ friend: alice, loading: false, error: null });
  });

  it('treats a null snapshot as a resolved answer, not loading', () => {
    mount();
    latest().emit(null);

    expect(view()).toEqual({ friend: null, loading: false, error: null });
  });

  it('surfaces a subscription failure and stops loading', () => {
    const boom = new Error('permission-denied');

    mount();
    latest().fail(boom);

    expect(view()).toEqual({ friend: null, loading: false, error: boom });
  });

  it('does not subscribe when signed out', () => {
    auth.uid = null;
    mount();

    expect(repo.watchFriend).not.toHaveBeenCalled();
    expect(view()).toEqual({ friend: null, loading: false, error: null });
  });

  it('does not subscribe when the friend uid is empty', () => {
    friendUid = '';
    mount();

    expect(repo.watchFriend).not.toHaveBeenCalled();
    expect(view()).toEqual({ friend: null, loading: false, error: null });
  });

  it('unsubscribes on unmount', () => {
    mount();
    const channel = latest();
    react.unmount();

    expect(channel.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('resubscribes when the friend uid changes', () => {
    mount();
    latest().emit(alice);
    const first = latest();

    friendUid = 'bob';
    react.rerender();

    expect(first.unsubscribe).toHaveBeenCalledTimes(1);
    expect(repo.watchFriend).toHaveBeenCalledTimes(2);
    expect(latest().friendUid).toBe('bob');
    expect(view()).toEqual({ friend: alice, loading: true, error: null });

    latest().emit(null);
    expect(view()).toEqual({ friend: null, loading: false, error: null });
  });

  it('keeps the result referentially stable across an inert rerender', () => {
    mount();
    latest().emit(alice);
    const before = view();
    react.rerender();

    expect(view()).toBe(before);
  });
});
