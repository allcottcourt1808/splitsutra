/**
 * The two subscriptions the composer needs, and the one string helper beside them.
 *
 * These are hooks, so they are exercised through a probe component rather than called
 * directly — the same shape the core hook tests use. What matters here is the three states
 * every screen on this tab renders separately: loading, error, and a real answer that happens
 * to be empty. Collapsing any two of them is the bug this file exists to catch.
 */

import { act, useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Group, GroupMember } from '@splitsutra/core';

import { render } from '../../../__tests__/helpers/render';
import {
  nameOf,
  useComposerGroups,
  useComposerMembers,
  type UseComposerGroupsResult,
  type UseGroupMembersResult,
} from '../composer';

/* ────────────────────────────────────────────────────────────────────────────────────────── *
 * The repository seam
 * ────────────────────────────────────────────────────────────────────────────────────────── */

interface Subscription<T> {
  readonly key: string;
  readonly next: (value: T) => void;
  readonly fail: (error: Error) => void;
  readonly unsubscribe: ReturnType<typeof vi.fn>;
}

const seam = vi.hoisted(() => ({
  uid: 'u1' as string | null,
  groupSubs: [] as unknown[],
  memberSubs: [] as unknown[],
}));

vi.mock('@splitsutra/core/hooks', () => ({
  useAuth: () => ({ user: seam.uid === null ? null : { uid: seam.uid } }),
}));

vi.mock('@splitsutra/core/repositories', () => ({
  watchExpenseGroups: (uid: string, next: unknown, fail: unknown) => {
    const unsubscribe = vi.fn();
    seam.groupSubs.push({ key: uid, next, fail, unsubscribe });
    return unsubscribe;
  },
  watchExpenseMembers: (groupId: string, next: unknown, fail: unknown) => {
    const unsubscribe = vi.fn();
    seam.memberSubs.push({ key: groupId, next, fail, unsubscribe });
    return unsubscribe;
  },
}));

function groupSubs(): Subscription<readonly Group[]>[] {
  return seam.groupSubs as Subscription<readonly Group[]>[];
}

function memberSubs(): Subscription<readonly GroupMember[]>[] {
  return seam.memberSubs as Subscription<readonly GroupMember[]>[];
}

function latest<T>(subs: Subscription<T>[]): Subscription<T> {
  const sub = subs.at(-1);
  if (sub === undefined) throw new Error('nothing subscribed');
  return sub;
}

/* ────────────────────────────────────────────────────────────────────────────────────────── *
 * Probes
 * ────────────────────────────────────────────────────────────────────────────────────────── */

function group(id: string, name: string): Group {
  return { id, name, currency: 'USD' } as unknown as Group;
}

function member(uid: string, displayName: string): GroupMember {
  return { uid, displayName, photoURL: null, role: 'member' } as unknown as GroupMember;
}

function mountGroups(): () => UseComposerGroupsResult {
  let result: UseComposerGroupsResult | null = null;

  function Probe() {
    result = useComposerGroups();
    return null;
  }

  render(<Probe />);
  return () => {
    if (result === null) throw new Error('probe never rendered');
    return result;
  };
}

function mountMembers(initialGroupId: string | null): {
  readonly read: () => UseGroupMembersResult;
  readonly setGroupId: (groupId: string | null) => void;
} {
  let result: UseGroupMembersResult | null = null;
  let setGroupId: ((groupId: string | null) => void) | null = null;

  function Probe({ groupId }: { groupId: string | null }) {
    result = useComposerMembers(groupId);
    return null;
  }

  function Harness() {
    const [groupId, set] = useState(initialGroupId);
    setGroupId = set;
    return <Probe groupId={groupId} />;
  }

  render(<Harness />);
  return {
    read: () => {
      if (result === null) throw new Error('probe never rendered');
      return result;
    },
    setGroupId: (groupId) => {
      act(() => {
        setGroupId?.(groupId);
      });
    },
  };
}

beforeEach(() => {
  seam.uid = 'u1';
  seam.groupSubs = [];
  seam.memberSubs = [];
});

/* ────────────────────────────────────────────────────────────────────────────────────────── *
 * Tests
 * ────────────────────────────────────────────────────────────────────────────────────────── */

describe('useComposerGroups', () => {
  it('is loading until the first snapshot, then is not', () => {
    const read = mountGroups();

    expect(read().loading).toBe(true);
    expect(read().groups).toEqual([]);

    act(() => {
      latest(groupSubs()).next([group('g1', 'Goa Trip')]);
    });

    expect(read().loading).toBe(false);
    expect(read().groups.map((candidate) => candidate.id)).toEqual(['g1']);
  });

  it('reports a failure instead of sitting on a spinner forever', () => {
    const read = mountGroups();

    act(() => {
      latest(groupSubs()).fail(new Error('permission denied'));
    });

    expect(read().error?.message).toBe('permission denied');
    expect(read().loading).toBe(false);
  });

  it('reads an empty answer as an empty answer, not as loading', () => {
    const read = mountGroups();

    act(() => {
      latest(groupSubs()).next([]);
    });

    expect(read().groups).toEqual([]);
    expect(read().loading).toBe(false);
    expect(read().error).toBeNull();
  });

  it('subscribes to nothing when nobody is signed in', () => {
    seam.uid = null;
    const read = mountGroups();

    expect(groupSubs()).toHaveLength(0);
    expect(read().loading).toBe(false);
  });
});

describe('useComposerMembers', () => {
  it('treats no group as an answered empty list rather than a spinner', () => {
    const { read } = mountMembers(null);

    expect(memberSubs()).toHaveLength(0);
    expect(read().members).toEqual([]);
    expect(read().loading).toBe(false);
  });

  it('emits the group members once they arrive', () => {
    const { read } = mountMembers('g1');

    expect(read().loading).toBe(true);

    act(() => {
      latest(memberSubs()).next([member('u1', 'You'), member('u2', 'Priya Sharma')]);
    });

    expect(read().members.map((entry) => entry.uid)).toEqual(['u1', 'u2']);
    expect(read().loading).toBe(false);
  });

  it('reports a failed subscription', () => {
    const { read } = mountMembers('g1');

    act(() => {
      latest(memberSubs()).fail(new Error('permission denied'));
    });

    expect(read().error?.message).toBe('permission denied');
    expect(read().loading).toBe(false);
  });

  it('drops the old subscription and starts a fresh one when the group changes', () => {
    const { read, setGroupId } = mountMembers('g1');
    const first = latest(memberSubs());

    act(() => {
      first.next([member('u2', 'Priya Sharma')]);
    });
    setGroupId('g2');

    expect(first.unsubscribe).toHaveBeenCalledTimes(1);
    expect(memberSubs()).toHaveLength(2);
    expect(latest(memberSubs()).key).toBe('g2');
    expect(read().loading).toBe(true);
  });
});

describe('nameOf', () => {
  const members = [member('u1', 'Neethu'), member('u2', 'Priya Sharma')];

  it('calls the signed-in user "You"', () => {
    expect(nameOf(members, 'u1', 'u1')).toBe('You');
  });

  it('uses the denormalized display name for everyone else', () => {
    expect(nameOf(members, 'u2', 'u1')).toBe('Priya Sharma');
  });

  it('still names a uid that is no longer a member, so a split never renders blank', () => {
    expect(nameOf(members, 'u9', 'u1')).toBe('Someone who left');
  });
});
