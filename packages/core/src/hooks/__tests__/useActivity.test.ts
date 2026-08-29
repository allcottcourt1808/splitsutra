/**
 * `react-dom` is forbidden in core (Article II) and the `unit` project runs on `node`, so the
 * hook is driven by mocking `react` with a minimal ordered-slot runtime instead of rendering —
 * the same harness `useFriend.test.ts` uses.
 *
 * The subject here is the N-subscription merge: one subscription per group, a re-merge whenever
 * any one of them emits, and a teardown that reaches all of them.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Activity, Group } from '../../types/index.js';
import type { ActivityFeedEntry, UseActivityResult } from '../useActivity.js';

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

const repo = vi.hoisted(() => ({
  ACTIVITY_PAGE_SIZE: 25,
  watchActivityGroups: vi.fn(),
  watchGroupActivity: vi.fn(),
}));

vi.mock('../../repositories/activityRepo.js', () => repo);

const { useActivity } = await import('../useActivity.js');

/* ────────────────────────────────────────────────────────────────────────────────────────── *
 * Test doubles
 * ────────────────────────────────────────────────────────────────────────────────────────── */

interface GroupChannel {
  uid: string;
  emit: (groups: readonly Group[]) => void;
  fail: (error: Error) => void;
  unsubscribe: ReturnType<typeof vi.fn>;
}

interface FeedChannel {
  groupId: string;
  pageSize: number;
  emit: (rows: readonly Activity[]) => void;
  fail: (error: Error) => void;
  unsubscribe: ReturnType<typeof vi.fn>;
}

let groupChannels: GroupChannel[] = [];
let feedChannels: FeedChannel[] = [];

const groupsChannel = (): GroupChannel => groupChannels[groupChannels.length - 1]!;
const feedFor = (groupId: string): FeedChannel =>
  [...feedChannels].reverse().find((channel) => channel.groupId === groupId)!;

const view = (): UseActivityResult => react.output() as UseActivityResult;
const mount = (): void => {
  react.mount(() => useActivity());
};

function group(id: string, name: string, isImplicit = false): Group {
  return { id, name, isImplicit, memberIds: ['me'], deletedAt: null } as unknown as Group;
}

function entry(id: string, seconds: number, nanoseconds = 0): Activity {
  return {
    id,
    type: 'expense.created',
    actorUid: 'u1',
    actorName: 'Ana',
    targetId: 'e1',
    summary: `Ana added "${id}"`,
    amountMinor: null,
    currency: null,
    createdAt: { seconds, nanoseconds, toDate: () => new Date(seconds * 1000) },
  } as unknown as Activity;
}

const ids = (result: UseActivityResult): string[] =>
  result.entries.map((item: ActivityFeedEntry) => item.activity.id);

beforeEach(() => {
  vi.clearAllMocks();
  groupChannels = [];
  feedChannels = [];
  auth.uid = 'me';

  repo.watchActivityGroups.mockImplementation(
    (uid: string, onNext: (groups: readonly Group[]) => void, onError: (e: Error) => void) => {
      const unsubscribe = vi.fn();
      groupChannels.push({ uid, emit: onNext, fail: onError, unsubscribe });
      return unsubscribe;
    },
  );

  repo.watchGroupActivity.mockImplementation(
    (
      groupId: string,
      pageSize: number,
      onNext: (rows: readonly Activity[]) => void,
      onError: (e: Error) => void,
    ) => {
      const unsubscribe = vi.fn();
      feedChannels.push({ groupId, pageSize, emit: onNext, fail: onError, unsubscribe });
      return unsubscribe;
    },
  );
});

/* ────────────────────────────────────────────────────────────────────────────────────────── *
 * Tests
 * ────────────────────────────────────────────────────────────────────────────────────────── */

describe('useActivity', () => {
  it('subscribes to the groups query first and nothing else', () => {
    mount();

    expect(repo.watchActivityGroups).toHaveBeenCalledTimes(1);
    expect(groupsChannel().uid).toBe('me');
    expect(repo.watchGroupActivity).not.toHaveBeenCalled();
    expect(view().loading).toBe(true);
    expect(view().entries).toEqual([]);
  });

  it('opens exactly one activity subscription per group', () => {
    mount();
    groupsChannel().emit([group('g1', 'Goa'), group('g2', 'Flat')]);

    expect(repo.watchGroupActivity).toHaveBeenCalledTimes(2);
    expect(feedChannels.map((channel) => channel.groupId)).toEqual(['g1', 'g2']);
    expect(feedChannels.every((channel) => channel.pageSize === 25)).toBe(true);
  });

  it('stays loading until every group has answered', () => {
    mount();
    groupsChannel().emit([group('g1', 'Goa'), group('g2', 'Flat')]);
    expect(view().loading).toBe(true);

    feedFor('g1').emit([entry('a', 200)]);
    expect(view().loading).toBe(true);

    feedFor('g2').emit([]);
    expect(view().loading).toBe(false);
    expect(ids(view())).toEqual(['a']);
  });

  it('merges the groups newest-first and tags each row with its group', () => {
    mount();
    groupsChannel().emit([group('g1', 'Goa'), group('g2', 'Flat')]);
    feedFor('g1').emit([entry('g1-late', 300), entry('g1-early', 100)]);
    feedFor('g2').emit([entry('g2-mid', 200)]);

    expect(ids(view())).toEqual(['g1-late', 'g2-mid', 'g1-early']);
    expect(view().entries[0]).toMatchObject({ groupId: 'g1', groupName: 'Goa', isImplicit: false });
    expect(view().entries[1]).toMatchObject({ groupId: 'g2', groupName: 'Flat' });
  });

  it('breaks a same-second tie on nanoseconds', () => {
    mount();
    groupsChannel().emit([group('g1', 'Goa'), group('g2', 'Flat')]);
    feedFor('g1').emit([entry('coarse', 500, 1)]);
    feedFor('g2').emit([entry('fine', 500, 900)]);

    expect(ids(view())).toEqual(['fine', 'coarse']);
  });

  it('re-merges when a single group emits again, without resubscribing', () => {
    mount();
    groupsChannel().emit([group('g1', 'Goa'), group('g2', 'Flat')]);
    feedFor('g1').emit([entry('g1-old', 100)]);
    feedFor('g2').emit([entry('g2-old', 150)]);
    expect(ids(view())).toEqual(['g2-old', 'g1-old']);

    feedFor('g1').emit([entry('g1-new', 400), entry('g1-old', 100)]);

    expect(ids(view())).toEqual(['g1-new', 'g2-old', 'g1-old']);
    expect(repo.watchGroupActivity).toHaveBeenCalledTimes(2);
  });

  it('adds a subscription for a newly joined group and keeps the existing ones', () => {
    mount();
    groupsChannel().emit([group('g1', 'Goa')]);
    feedFor('g1').emit([entry('a', 100)]);
    const first = feedFor('g1');

    groupsChannel().emit([group('g1', 'Goa'), group('g3', 'Ski')]);

    expect(first.unsubscribe).not.toHaveBeenCalled();
    expect(repo.watchGroupActivity).toHaveBeenCalledTimes(2);
    expect(view().loading).toBe(true);

    feedFor('g3').emit([entry('b', 300)]);
    expect(ids(view())).toEqual(['b', 'a']);
  });

  it('drops a group the user has left, its subscription and its rows', () => {
    mount();
    groupsChannel().emit([group('g1', 'Goa'), group('g2', 'Flat')]);
    feedFor('g1').emit([entry('stays', 100)]);
    feedFor('g2').emit([entry('goes', 200)]);
    const left = feedFor('g2');

    groupsChannel().emit([group('g1', 'Goa')]);

    expect(left.unsubscribe).toHaveBeenCalledTimes(1);
    expect(ids(view())).toEqual(['stays']);
    expect(view().loading).toBe(false);
  });

  it('unsubscribes from the groups query and every group feed on unmount', () => {
    mount();
    groupsChannel().emit([group('g1', 'Goa'), group('g2', 'Flat')]);
    feedFor('g1').emit([]);
    feedFor('g2').emit([]);

    const groupsStop = groupsChannel().unsubscribe;
    const stops = feedChannels.map((channel) => channel.unsubscribe);

    react.unmount();

    expect(groupsStop).toHaveBeenCalledTimes(1);
    for (const stop of stops) expect(stop).toHaveBeenCalledTimes(1);
  });

  it('surfaces a failure from any one group feed and stops loading', () => {
    const boom = new Error('permission-denied');

    mount();
    groupsChannel().emit([group('g1', 'Goa'), group('g2', 'Flat')]);
    feedFor('g1').fail(boom);

    expect(view().error).toBe(boom);
    expect(view().loading).toBe(false);
  });

  it('surfaces a failure from the groups query itself', () => {
    const boom = new Error('groups denied');

    mount();
    groupsChannel().fail(boom);

    expect(view().error).toBe(boom);
    expect(view().loading).toBe(false);
  });

  it('does not subscribe when signed out', () => {
    auth.uid = null;
    mount();

    expect(repo.watchActivityGroups).not.toHaveBeenCalled();
    expect(view()).toMatchObject({ entries: [], loading: false, error: null, hasMore: false });
  });

  it('reports hasMore when a group filled its page, and widens the window on loadMore', () => {
    const page = Array.from({ length: 25 }, (_, i) => entry(`a${String(i)}`, 1000 - i));

    mount();
    groupsChannel().emit([group('g1', 'Goa')]);
    feedFor('g1').emit(page);

    expect(view().hasMore).toBe(true);
    expect(view().entries).toHaveLength(25);

    const firstFeed = feedFor('g1');
    view().loadMore();

    // The window change tears the whole fan-out down and rebuilds it at the wider size.
    expect(firstFeed.unsubscribe).toHaveBeenCalledTimes(1);
    expect(repo.watchActivityGroups).toHaveBeenCalledTimes(2);

    groupsChannel().emit([group('g1', 'Goa')]);
    expect(feedFor('g1').pageSize).toBe(50);
  });

  it('reports no more once every group is inside the window', () => {
    mount();
    groupsChannel().emit([group('g1', 'Goa')]);
    feedFor('g1').emit([entry('only', 100)]);

    expect(view().hasMore).toBe(false);
  });

  it('keeps the result referentially stable across an inert rerender', () => {
    mount();
    groupsChannel().emit([group('g1', 'Goa')]);
    feedFor('g1').emit([entry('a', 100)]);
    const before = view();
    react.rerender();

    expect(view()).toBe(before);
  });
});
