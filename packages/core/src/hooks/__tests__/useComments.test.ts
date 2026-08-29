/**
 * `react-dom` is forbidden in core (Article II) and the `unit` project runs on `node`, so the
 * hook is driven by mocking `react` with a minimal ordered-slot runtime instead of rendering.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Comment } from '../../types/index.js';
import type { UseCommentsResult } from '../useComments.js';

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

const repo = vi.hoisted(() => ({ watchComments: vi.fn() }));

vi.mock('../../repositories/commentRepo.js', () => repo);

const { useComments } = await import('../useComments.js');

/* ────────────────────────────────────────────────────────────────────────────────────────── *
 * Test doubles
 * ────────────────────────────────────────────────────────────────────────────────────────── */

interface Channel {
  groupId: string;
  expenseId: string;
  emit: (comments: readonly Comment[]) => void;
  fail: (error: Error) => void;
  unsubscribe: ReturnType<typeof vi.fn>;
}

function comment(id: string, text: string): Comment {
  return {
    id,
    uid: 'u1',
    displayName: 'Ana',
    photoURL: null,
    text,
    createdAt: { seconds: 1, nanoseconds: 0, toDate: () => new Date(1000) },
    deletedAt: null,
  } as unknown as Comment;
}

let channels: Channel[] = [];
let groupId = 'g1';
let expenseId = 'e1';

const latest = (): Channel => channels[channels.length - 1]!;
const view = (): UseCommentsResult => react.output() as UseCommentsResult;
const mount = (): void => {
  react.mount(() => useComments(groupId, expenseId));
};

beforeEach(() => {
  vi.clearAllMocks();
  channels = [];
  groupId = 'g1';
  expenseId = 'e1';
  repo.watchComments.mockImplementation(
    (
      gid: string,
      eid: string,
      onNext: (comments: readonly Comment[]) => void,
      onError: (error: Error) => void,
    ) => {
      const unsubscribe = vi.fn();
      channels.push({ groupId: gid, expenseId: eid, emit: onNext, fail: onError, unsubscribe });
      return unsubscribe;
    },
  );
});

/* ────────────────────────────────────────────────────────────────────────────────────────── *
 * Tests
 * ────────────────────────────────────────────────────────────────────────────────────────── */

describe('useComments', () => {
  it('starts loading and subscribes with both ids', () => {
    mount();

    expect(repo.watchComments).toHaveBeenCalledTimes(1);
    expect(latest().groupId).toBe('g1');
    expect(latest().expenseId).toBe('e1');
    expect(view()).toEqual({ comments: [], loading: true, error: null });
  });

  it('delivers the thread in the order the repository emitted it', () => {
    const thread = [comment('c1', 'first'), comment('c2', 'second')];

    mount();
    latest().emit(thread);

    expect(view().comments).toEqual(thread);
    expect(view().loading).toBe(false);
  });

  it('treats an empty thread as a resolved answer, not loading', () => {
    mount();
    latest().emit([]);

    expect(view()).toEqual({ comments: [], loading: false, error: null });
  });

  it('surfaces a subscription failure and stops loading', () => {
    const boom = new Error('permission-denied');

    mount();
    latest().fail(boom);

    expect(view()).toEqual({ comments: [], loading: false, error: boom });
  });

  it('does not subscribe without both ids', () => {
    expenseId = '';
    mount();

    expect(repo.watchComments).not.toHaveBeenCalled();
    expect(view()).toEqual({ comments: [], loading: false, error: null });
  });

  it('unsubscribes on unmount', () => {
    mount();
    const channel = latest();
    react.unmount();

    expect(channel.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('resubscribes when the expense changes', () => {
    mount();
    latest().emit([comment('c1', 'first')]);
    const first = latest();

    expenseId = 'e2';
    react.rerender();

    expect(first.unsubscribe).toHaveBeenCalledTimes(1);
    expect(repo.watchComments).toHaveBeenCalledTimes(2);
    expect(latest().expenseId).toBe('e2');
    expect(view().loading).toBe(true);
  });

  it('keeps the result referentially stable across an inert rerender', () => {
    mount();
    latest().emit([]);
    const before = view();
    react.rerender();

    expect(view()).toBe(before);
  });
});
