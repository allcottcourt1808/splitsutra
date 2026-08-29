import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Group } from '../../types/index.js';
import type { UseGroupResult } from '../useGroup.js';

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

const repo = vi.hoisted(() => ({ watchGroup: vi.fn() }));

vi.mock('../../repositories/groupRepo.js', () => repo);

const { useGroup } = await import('../useGroup.js');

/** One `watchGroup` subscription, plus the callbacks the hook handed it. */
interface Channel {
  groupId: string;
  emit: (value: Group | null) => void;
  fail: (error: Error) => void;
  unsubscribe: ReturnType<typeof vi.fn>;
}

const goa = {
  id: 'g1',
  name: 'Goa Trip',
  type: 'trip',
  isImplicit: false,
  photoURL: null,
  currency: 'INR',
  memberIds: ['me', 'alice'],
  memberCount: 2,
  simplifyDebts: false,
  createdBy: 'me',
} as unknown as Group;

let channels: Channel[] = [];
let groupId = 'g1';

const latest = (): Channel => channels[channels.length - 1]!;
const view = (): UseGroupResult => react.output() as UseGroupResult;
const mount = (): void => {
  react.mount(() => useGroup(groupId));
};

beforeEach(() => {
  vi.clearAllMocks();
  channels = [];
  groupId = 'g1';
  auth.uid = 'me';
  repo.watchGroup.mockImplementation(
    (gid: string, onNext: (value: Group | null) => void, onError: (error: Error) => void) => {
      const unsubscribe = vi.fn();
      channels.push({ groupId: gid, emit: onNext, fail: onError, unsubscribe });
      return unsubscribe;
    },
  );
});

describe('useGroup', () => {
  it('starts loading and subscribes to the group', () => {
    mount();

    expect(repo.watchGroup).toHaveBeenCalledTimes(1);
    expect(latest().groupId).toBe('g1');
    expect(view()).toEqual({ group: null, loading: true, error: null });
  });

  it('resolves to the emitted group', () => {
    mount();
    latest().emit(goa);

    expect(view()).toEqual({ group: goa, loading: false, error: null });
  });

  it('treats a missing document as a resolved answer, not loading', () => {
    // Rules gate `get` on membership, so "not readable" arrives as "does not exist".
    mount();
    latest().emit(null);

    expect(view()).toEqual({ group: null, loading: false, error: null });
  });

  it('surfaces a subscription failure and stops loading', () => {
    const boom = new Error('permission-denied');

    mount();
    latest().fail(boom);

    expect(view()).toEqual({ group: null, loading: false, error: boom });
  });

  it('does not subscribe when signed out', () => {
    auth.uid = null;
    mount();

    expect(repo.watchGroup).not.toHaveBeenCalled();
    expect(view()).toEqual({ group: null, loading: false, error: null });
  });

  it('does not subscribe without a group id', () => {
    groupId = '';
    mount();

    expect(repo.watchGroup).not.toHaveBeenCalled();
    expect(view()).toEqual({ group: null, loading: false, error: null });
  });

  it('unsubscribes on unmount', () => {
    mount();
    const channel = latest();
    react.unmount();

    expect(channel.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('resubscribes when the group id changes', () => {
    mount();
    latest().emit(goa);
    const first = latest();

    groupId = 'g2';
    react.rerender();

    expect(first.unsubscribe).toHaveBeenCalledTimes(1);
    expect(repo.watchGroup).toHaveBeenCalledTimes(2);
    expect(latest().groupId).toBe('g2');
    expect(view()).toEqual({ group: goa, loading: true, error: null });
  });

  it('keeps the result referentially stable across an inert rerender', () => {
    mount();
    latest().emit(goa);
    const before = view();
    react.rerender();

    expect(view()).toBe(before);
  });
});
