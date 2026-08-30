/**
 * `react-dom` is forbidden in core (Article II) and the `unit` project runs on `node`, so the
 * hooks are driven by mocking `react` with a minimal ordered-slot runtime — the same harness
 * `useFriend.test.ts` uses.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Comment, Expense } from '../../types/index.js';
import type { UseExpenseCommentsResult, UseExpenseResult } from '../useExpense.js';

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

const repo = vi.hoisted(() => ({
  watchExpense: vi.fn(),
  watchExpenseComments: vi.fn(),
}));

vi.mock('../../repositories/expenseRepo.js', () => repo);

const { useExpense, useExpenseComments } = await import('../useExpense.js');

/* ────────────────────────────────────────────────────────────────────────────────────────── *
 * Test doubles
 * ────────────────────────────────────────────────────────────────────────────────────────── */

interface Channel<T> {
  groupId: string;
  expenseId: string;
  emit: (value: T) => void;
  fail: (error: Error) => void;
  unsubscribe: ReturnType<typeof vi.fn>;
}

const dinner = {
  id: 'e1',
  groupId: 'g1',
  description: 'Dinner at Olive',
  amountMinor: 300000,
  currency: 'INR',
  splits: [],
  paidBy: [],
  participantIds: ['me'],
} as unknown as Expense;

const remark = { id: 'c1', uid: 'me', text: 'Wasn’t this ₹2,000?' } as unknown as Comment;

let expenseChannels: Channel<Expense | null>[] = [];
let commentChannels: Channel<readonly Comment[]>[] = [];
let groupId = 'g1';
let expenseId = 'e1';

const lastExpense = (): Channel<Expense | null> => expenseChannels[expenseChannels.length - 1]!;
const lastComments = (): Channel<readonly Comment[]> =>
  commentChannels[commentChannels.length - 1]!;

function record<T>(into: Channel<T>[]) {
  return (
    gid: string,
    eid: string,
    onNext: (value: T) => void,
    onError: (error: Error) => void,
  ) => {
    const unsubscribe = vi.fn();
    into.push({ groupId: gid, expenseId: eid, emit: onNext, fail: onError, unsubscribe });
    return unsubscribe;
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  expenseChannels = [];
  commentChannels = [];
  groupId = 'g1';
  expenseId = 'e1';
  repo.watchExpense.mockImplementation(record(expenseChannels));
  repo.watchExpenseComments.mockImplementation(record(commentChannels));
});

/* ────────────────────────────────────────────────────────────────────────────────────────── *
 * useExpense
 * ────────────────────────────────────────────────────────────────────────────────────────── */

const expenseView = (): UseExpenseResult => react.output() as UseExpenseResult;
const mountExpense = (): void => {
  react.mount(() => useExpense(groupId, expenseId));
};

describe('useExpense', () => {
  it('starts loading and subscribes with both ids', () => {
    mountExpense();

    expect(repo.watchExpense).toHaveBeenCalledTimes(1);
    expect(lastExpense().groupId).toBe('g1');
    expect(lastExpense().expenseId).toBe('e1');
    expect(expenseView()).toEqual({ expense: null, loading: true, error: null });
  });

  it('resolves to the emitted expense', () => {
    mountExpense();
    lastExpense().emit(dinner);

    expect(expenseView()).toEqual({ expense: dinner, loading: false, error: null });
  });

  it('treats a missing document as a resolved answer, not loading', () => {
    mountExpense();
    lastExpense().emit(null);

    expect(expenseView()).toEqual({ expense: null, loading: false, error: null });
  });

  it('surfaces a subscription failure and stops loading', () => {
    const boom = new Error('permission-denied');

    mountExpense();
    lastExpense().fail(boom);

    expect(expenseView()).toEqual({ expense: null, loading: false, error: boom });
  });

  it('does not subscribe without both ids', () => {
    expenseId = '';
    mountExpense();

    expect(repo.watchExpense).not.toHaveBeenCalled();
    expect(expenseView()).toEqual({ expense: null, loading: false, error: null });
  });

  it('unsubscribes on unmount', () => {
    mountExpense();
    const channel = lastExpense();
    react.unmount();

    expect(channel.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('resubscribes when the expense id changes', () => {
    mountExpense();
    lastExpense().emit(dinner);
    const first = lastExpense();

    expenseId = 'e2';
    react.rerender();

    expect(first.unsubscribe).toHaveBeenCalledTimes(1);
    expect(repo.watchExpense).toHaveBeenCalledTimes(2);
    expect(lastExpense().expenseId).toBe('e2');
    expect(expenseView()).toEqual({ expense: dinner, loading: true, error: null });
  });

  it('keeps the result referentially stable across an inert rerender', () => {
    mountExpense();
    lastExpense().emit(dinner);
    const before = expenseView();
    react.rerender();

    expect(expenseView()).toBe(before);
  });
});

/* ────────────────────────────────────────────────────────────────────────────────────────── *
 * useExpenseComments
 * ────────────────────────────────────────────────────────────────────────────────────────── */

const commentsView = (): UseExpenseCommentsResult => react.output() as UseExpenseCommentsResult;
const mountComments = (): void => {
  react.mount(() => useExpenseComments(groupId, expenseId));
};

describe('useExpenseComments', () => {
  it('starts loading and subscribes to the thread', () => {
    mountComments();

    expect(repo.watchExpenseComments).toHaveBeenCalledTimes(1);
    expect(commentsView()).toEqual({ comments: [], loading: true, error: null });
  });

  it('reads an empty thread as a real answer rather than as loading', () => {
    mountComments();
    lastComments().emit([]);

    expect(commentsView()).toEqual({ comments: [], loading: false, error: null });
  });

  it('emits the thread in the order the repository gave it', () => {
    mountComments();
    lastComments().emit([remark]);

    expect(commentsView().comments).toEqual([remark]);
  });

  it('surfaces a failure and stops loading', () => {
    const boom = new Error('offline');

    mountComments();
    lastComments().fail(boom);

    expect(commentsView()).toEqual({ comments: [], loading: false, error: boom });
  });

  it('unsubscribes on unmount', () => {
    mountComments();
    const channel = lastComments();
    react.unmount();

    expect(channel.unsubscribe).toHaveBeenCalledTimes(1);
  });
});
