/**
 * `react-dom` is forbidden in core (Article II) and the `unit` project runs on `node`, so the
 * hooks are driven by mocking `react` with a minimal ordered-slot runtime — the same harness
 * `useFriend.test.ts` uses.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Expense } from '../../types/index.js';
import type { UseExpensesResult } from '../useExpenses.js';

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

  /**
   * `useCallback(fn, deps)` is `useMemo(() => fn, deps)` — React's own relationship between the
   * two. Defined in terms of `useMemo` rather than given its own slot array so the ordered-slot
   * bookkeeping stays in one place.
   */
  function useCallback<T>(fn: T, deps?: readonly unknown[]): T {
    // The `useMemo` below is the local harness above, not React's. The rule matches on the
    // name and has nothing real to check.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return useMemo(() => fn, deps);
  }

  return {
    useState,
    useEffect,
    useMemo,
    useCallback,
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
  useCallback: react.useCallback,
}));

const auth = vi.hoisted(() => ({ uid: null as string | null }));

vi.mock('../useAuth.js', () => ({
  useAuth: () => ({ user: auth.uid === null ? null : { uid: auth.uid } }),
}));

const repo = vi.hoisted(() => ({
  EXPENSE_PAGE_SIZE: 25,
  watchGroupExpenses: vi.fn(),
  watchMyExpenses: vi.fn(),
}));

vi.mock('../../repositories/expenseRepo.js', () => repo);

const { useGroupExpenses, useMyExpenses } = await import('../useExpenses.js');

/* ────────────────────────────────────────────────────────────────────────────────────────── *
 * Test doubles
 * ────────────────────────────────────────────────────────────────────────────────────────── */

interface Channel {
  key: string;
  pageSize: number;
  emit: (value: readonly Expense[]) => void;
  fail: (error: Error) => void;
  unsubscribe: ReturnType<typeof vi.fn>;
}

const dinner = { id: 'e1', description: 'Dinner at Olive' } as unknown as Expense;
const cab = { id: 'e2', description: 'Cab home' } as unknown as Expense;

let channels: Channel[] = [];
let groupId: string | null = 'g1';

const latest = (): Channel => channels[channels.length - 1]!;
const view = (): UseExpensesResult => react.output() as UseExpensesResult;

function record(
  key: string,
  onNext: (value: readonly Expense[]) => void,
  onError: (error: Error) => void,
  pageSize: number,
) {
  const unsubscribe = vi.fn();
  channels.push({ key, pageSize, emit: onNext, fail: onError, unsubscribe });
  return unsubscribe;
}

beforeEach(() => {
  vi.clearAllMocks();
  channels = [];
  groupId = 'g1';
  auth.uid = 'me';
  repo.watchGroupExpenses.mockImplementation(record);
  repo.watchMyExpenses.mockImplementation(record);
});

/* ────────────────────────────────────────────────────────────────────────────────────────── *
 * useGroupExpenses
 * ────────────────────────────────────────────────────────────────────────────────────────── */

const mountGroup = (): void => {
  react.mount(() => useGroupExpenses(groupId));
};

describe('useGroupExpenses', () => {
  it('starts loading and subscribes to the group', () => {
    mountGroup();

    expect(repo.watchGroupExpenses).toHaveBeenCalledTimes(1);
    expect(latest().key).toBe('g1');
    expect(view()).toEqual({
      expenses: [],
      loading: true,
      error: null,
      retry: expect.any(Function),
    });
  });

  it('passes the default page size through to the repository', () => {
    mountGroup();

    expect(latest().pageSize).toBe(25);
  });

  it('reads an empty group as a real answer rather than as loading', () => {
    mountGroup();
    latest().emit([]);

    expect(view()).toEqual({
      expenses: [],
      loading: false,
      error: null,
      retry: expect.any(Function),
    });
  });

  it('emits the expenses in the order the repository gave them', () => {
    mountGroup();
    latest().emit([dinner, cab]);

    expect(view().expenses).toEqual([dinner, cab]);
  });

  it('surfaces a subscription failure and stops loading', () => {
    const boom = new Error('permission-denied');

    mountGroup();
    latest().fail(boom);

    expect(view()).toEqual({
      expenses: [],
      loading: false,
      error: boom,
      retry: expect.any(Function),
    });
  });

  it('does not subscribe when no group is chosen', () => {
    groupId = null;
    mountGroup();

    expect(repo.watchGroupExpenses).not.toHaveBeenCalled();
    expect(view()).toEqual({
      expenses: [],
      loading: false,
      error: null,
      retry: expect.any(Function),
    });
  });

  it('resubscribes when the group changes', () => {
    mountGroup();
    latest().emit([dinner]);
    const first = latest();

    groupId = 'g2';
    react.rerender();

    expect(first.unsubscribe).toHaveBeenCalledTimes(1);
    expect(repo.watchGroupExpenses).toHaveBeenCalledTimes(2);
    expect(latest().key).toBe('g2');
    expect(view()).toEqual({
      expenses: [dinner],
      loading: true,
      error: null,
      retry: expect.any(Function),
    });
  });

  it('unsubscribes on unmount', () => {
    mountGroup();
    const channel = latest();
    react.unmount();

    expect(channel.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('keeps the result referentially stable across an inert rerender', () => {
    mountGroup();
    latest().emit([dinner]);
    const before = view();
    react.rerender();

    expect(view()).toBe(before);
  });
});

/* ────────────────────────────────────────────────────────────────────────────────────────── *
 * useMyExpenses
 * ────────────────────────────────────────────────────────────────────────────────────────── */

const mountMine = (): void => {
  react.mount(() => useMyExpenses());
};

describe('useMyExpenses', () => {
  it('subscribes with the signed-in uid — the collection-group rule needs it (T9)', () => {
    mountMine();

    expect(repo.watchMyExpenses).toHaveBeenCalledTimes(1);
    expect(latest().key).toBe('me');
  });

  it('does not subscribe when signed out', () => {
    auth.uid = null;
    mountMine();

    expect(repo.watchMyExpenses).not.toHaveBeenCalled();
    expect(view()).toEqual({
      expenses: [],
      loading: false,
      error: null,
      retry: expect.any(Function),
    });
  });

  it('resolves to the emitted expenses', () => {
    mountMine();
    latest().emit([cab]);

    expect(view()).toEqual({
      expenses: [cab],
      loading: false,
      error: null,
      retry: expect.any(Function),
    });
  });

  it('surfaces a subscription failure', () => {
    const boom = new Error('failed-precondition: index missing');

    mountMine();
    latest().fail(boom);

    expect(view()).toEqual({
      expenses: [],
      loading: false,
      error: boom,
      retry: expect.any(Function),
    });
  });

  it('unsubscribes on unmount', () => {
    mountMine();
    const channel = latest();
    react.unmount();

    expect(channel.unsubscribe).toHaveBeenCalledTimes(1);
  });
});
