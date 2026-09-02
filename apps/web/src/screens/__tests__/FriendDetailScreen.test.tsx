/**
 * 🔴 These tests used to pass while the screen was broken, and that is the interesting part.
 *
 * They drove the balance by handing the component a `friend.balanceMinor` map — the field the
 * screen read. Nothing ever writes that field in production (`establishFriendship` seeds it and
 * `recomputeBalances` writes only `groups/{gid}/members/{uid}.balanceMinor`), so the tests were
 * asserting a pipeline that exists only inside the test. Every real friendship showed
 * "Settled up" no matter what anyone spent, and the suite was green throughout.
 *
 * The lesson kept here rather than in a commit message: a fixture that supplies the value under
 * test proves the renderer, not the feature. The tests below drive the balance from the implicit
 * group's member document, which is what the server actually maintains, and one of them exists
 * purely to prove the dead field is no longer consulted.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryRouter, RouterProvider, type RouteObject } from 'react-router';

import type { Friend, Group, GroupMember } from '@splitsutra/core';

import { render } from '../../__tests__/helpers/render';
import { paths } from '../../navigation/paths';
import { FriendDetailScreen } from '../FriendDetailScreen';

const state = vi.hoisted(() => ({
  friend: null as Friend | null,
  loading: false,
  error: null as Error | null,
  group: null as Group | null,
  me: null as GroupMember | null,
  groupIdSeen: null as string | null,
  /** Every group the signed-in user is in, as `useGroups` would report them. */
  myGroups: [] as Group[],
  /** groupId -> member balances, for the shared-group rows. */
  balancesByGroup: {} as Record<string, { uid: string; balanceMinor: number }[]>,
}));

vi.mock('@splitsutra/core/hooks', () => ({
  useAuth: () => ({ user: { uid: 'u1' }, loading: false }),
  useFriend: () => ({ friend: state.friend, loading: state.loading, error: state.error }),
  useGroup: (groupId: string) => {
    state.groupIdSeen = groupId;
    return { group: state.group, loading: false, error: null, retry: () => undefined };
  },
  useGroupMembers: () => ({
    members: state.me === null ? [] : [state.me],
    activeMembers: state.me === null ? [] : [state.me],
    me: state.me,
    isAdmin: false,
    loading: false,
    error: null,
    retry: () => undefined,
  }),
  useGroups: () => ({ groups: state.myGroups, loading: false, error: null }),
  // Consumed by <SharedGroupRow>, one call per shared group.
  useGroupBalances: (groupId: string) => ({
    balances: state.balancesByGroup[groupId] ?? [],
    loading: false,
    error: null,
    retry: () => undefined,
  }),
  // Consumed by <ExpenseLedger>, which this screen now renders.
  useGroupExpenses: () => ({ expenses: [], loading: false, error: null, retry: () => undefined }),
  useGroupSettlements: () => ({
    settlements: [],
    loading: false,
    error: null,
    retry: () => undefined,
  }),
}));

const UPDATED_AT = { seconds: 0, nanoseconds: 0 } as unknown as Friend['updatedAt'];

function friendWith(balanceMinor: Record<string, number>): Friend {
  return {
    friendUid: 'u2',
    displayName: 'Priya Sharma',
    photoURL: null,
    implicitGroupId: 'g-implicit',
    balanceMinor,
    updatedAt: UPDATED_AT,
  } as unknown as Friend;
}

/** The implicit 1:1 group behind the friendship. One currency, always. */
function implicitGroup(currency = 'USD'): Group {
  return {
    id: 'g-implicit',
    name: 'Priya Sharma',
    type: 'friend',
    isImplicit: true,
    currency,
    memberIds: ['u1', 'u2'],
    memberCount: 2,
    deletedAt: null,
  } as unknown as Group;
}

/** The reader's own member document — the balance the server actually maintains. */
function myMember(balanceMinor: number): GroupMember {
  return {
    uid: 'u1',
    role: 'member',
    displayName: 'You',
    balanceMinor,
    leftAt: null,
  } as unknown as GroupMember;
}

const routes: RouteObject[] = [{ path: '/friends/:uid', element: <FriendDetailScreen /> }];

function visit(): HTMLElement {
  const memory = createMemoryRouter(routes, {
    initialEntries: [paths.FriendDetail({ uid: 'u2' })],
  });
  return render(<RouterProvider router={memory} />).container;
}

function rows(container: HTMLElement): NodeListOf<Element> {
  return container.querySelectorAll('ul[aria-label="Balance by currency"] > li');
}

beforeEach(() => {
  state.friend = null;
  state.loading = false;
  state.error = null;
  state.group = null;
  state.me = null;
  state.groupIdSeen = null;
  state.myGroups = [];
  state.balancesByGroup = {};
});

/** A real (non-implicit) group both people are in. */
function sharedGroup(id: string, name: string, currency = 'USD'): Group {
  return {
    id,
    name,
    type: 'trip',
    isImplicit: false,
    currency,
    memberIds: ['u1', 'u2', 'u3'],
    memberCount: 3,
    deletedAt: null,
  } as unknown as Group;
}

describe('<FriendDetailScreen>', () => {
  it('says it is loading before the first answer arrives', () => {
    state.loading = true;

    expect(visit().textContent).toContain('Loading');
  });

  it('reports a failed subscription', () => {
    state.error = new Error('permission denied');

    expect(visit().textContent).toContain('permission denied');
  });

  it('offers a way back when the uid is not a friend', () => {
    state.friend = null;

    const container = visit();

    expect(container.textContent).toContain('Not a friend');
    expect(container.querySelector(`a[href="${paths.FriendList()}"]`)).not.toBeNull();
  });

  it('reads the friendship through its implicit group', () => {
    // D2 — a friendship IS a group, and its id is where every expense and the balance live.
    state.friend = friendWith({});
    state.group = implicitGroup();

    visit();

    expect(state.groupIdSeen).toBe('g-implicit');
  });

  it('shows the balance the server maintains, in the group currency', () => {
    // The reported bug, stated as an assertion: an expense with a friend produces a balance,
    // and it has to be visible somewhere.
    state.friend = friendWith({});
    state.group = implicitGroup('USD');
    state.me = myMember(2500);

    const container = visit();
    const text = container.textContent ?? '';

    expect(rows(container)).toHaveLength(1);
    expect(text).toContain('USD');
    expect(text).toContain('owes you');
    expect(text).toContain('25.00');
  });

  it('shows the other direction when the reader is the debtor', () => {
    state.friend = friendWith({});
    state.group = implicitGroup('USD');
    state.me = myMember(-1000);

    const text = visit().textContent ?? '';

    expect(text).toContain('you owe');
    expect(text).toContain('10.00');
  });

  it('🔴 ignores friend.balanceMinor entirely', () => {
    // The regression that pins the bug closed. `friend.balanceMinor` is stale by construction —
    // nothing has written it since establishFriendship — so a screen that still consulted it
    // would render 99.00 here. The member document is the only cache the server maintains, and
    // it says settled.
    state.friend = friendWith({ USD: 9900 });
    state.group = implicitGroup('USD');
    state.me = myMember(0);

    const container = visit();
    const text = container.textContent ?? '';

    expect(text).not.toContain('99.00');
    expect(rows(container)).toHaveLength(0);
    expect(text).toContain('Settled up');
  });

  it('treats a zero balance as settled up rather than rendering a zero row', () => {
    // Article I — a settled balance is an ABSENT entry, not `0`.
    state.friend = friendWith({});
    state.group = implicitGroup();
    state.me = myMember(0);

    const container = visit();
    const text = container.textContent ?? '';

    expect(rows(container)).toHaveLength(0);
    expect(text).toContain('Settled up');
    expect(text).not.toContain('0.00');
  });

  it('lists a shared group and says which way the debt runs', () => {
    state.friend = friendWith({});
    state.group = implicitGroup();
    state.myGroups = [sharedGroup('g-goa', 'Goa Trip')];
    // Three-way: Bob (u2) owes, and the simplified plan settles him against the reader.
    state.balancesByGroup['g-goa'] = [
      { uid: 'u1', balanceMinor: 3000 },
      { uid: 'u2', balanceMinor: -3000 },
      { uid: 'u3', balanceMinor: 0 },
    ];

    const text = visit().textContent ?? '';

    expect(text).toContain('Goa Trip');
    expect(text).toContain('owes you');
    expect(text).toContain('30.00');
  });

  it('offers a way to settle up when there is a balance', () => {
    // 🔴 Before this, settling up with a friend was IMPOSSIBLE from the UI. `SettleUp` lives
    // at /groups/:gid/settle and was linked only from the two group screens, and a
    // friendship's implicit group is filtered out of the Groups tab — so you could run up a
    // balance with a friend and have no route to clear it.
    state.friend = friendWith({});
    state.group = implicitGroup('USD');
    state.me = myMember(2500);

    const container = visit();

    expect(
      container.querySelector(`a[href="${paths.SettleUp({ gid: 'g-implicit' })}"]`),
    ).not.toBeNull();
  });

  it('does not offer to settle up when the pair is square', () => {
    // A settle-up button on a settled pair invites recording a payment that did not happen.
    state.friend = friendWith({});
    state.group = implicitGroup('USD');
    state.me = myMember(0);

    const container = visit();

    expect(
      container.querySelector(`a[href="${paths.SettleUp({ gid: 'g-implicit' })}"]`),
    ).toBeNull();
  });

  it('links each shared group to that group', () => {
    state.friend = friendWith({});
    state.group = implicitGroup();
    state.myGroups = [sharedGroup('g-goa', 'Goa Trip')];
    state.balancesByGroup['g-goa'] = [
      { uid: 'u1', balanceMinor: 3000 },
      { uid: 'u2', balanceMinor: -3000 },
      { uid: 'u3', balanceMinor: 0 },
    ];

    const container = visit();

    // A real anchor, not an onPress: cmd-click and "copy link" have to work, and the
    // destination is a deep link somebody may paste.
    const link = container.querySelector(`a[href="${paths.GroupDetail({ gid: 'g-goa' })}"]`);
    expect(link).not.toBeNull();
    expect(link?.textContent).toContain('Goa Trip');
  });

  it('says "you owe" when the debt runs the other way', () => {
    state.friend = friendWith({});
    state.group = implicitGroup();
    state.myGroups = [sharedGroup('g-goa', 'Goa Trip')];
    state.balancesByGroup['g-goa'] = [
      { uid: 'u1', balanceMinor: -1500 },
      { uid: 'u2', balanceMinor: 1500 },
      { uid: 'u3', balanceMinor: 0 },
    ];

    const text = visit().textContent ?? '';

    expect(text).toContain('you owe');
    expect(text).toContain('15.00');
  });

  it('🔴 never shows the friendship itself as a shared group', () => {
    // The implicit group is already the "Balance" section above. Listing it here too would
    // show the same money twice under two different headings — and `useGroups` filtering
    // implicit groups is the only thing stopping that, so it is worth pinning.
    state.friend = friendWith({});
    state.group = implicitGroup();
    state.myGroups = [
      { ...implicitGroup(), memberIds: ['u1', 'u2'] } as Group,
      sharedGroup('g-goa', 'Goa Trip'),
    ];
    state.balancesByGroup['g-implicit'] = [
      { uid: 'u1', balanceMinor: 9900 },
      { uid: 'u2', balanceMinor: -9900 },
    ];
    state.balancesByGroup['g-goa'] = [
      { uid: 'u1', balanceMinor: 0 },
      { uid: 'u2', balanceMinor: 0 },
      { uid: 'u3', balanceMinor: 0 },
    ];

    const text = visit().textContent ?? '';

    expect(text).toContain('Goa Trip');
    expect(text).not.toContain('99.00');
  });

  it('leaves out a group the friend is not in', () => {
    state.friend = friendWith({});
    state.group = implicitGroup();
    state.myGroups = [{ ...sharedGroup('g-solo', 'Work lunch'), memberIds: ['u1', 'u3'] } as Group];

    const text = visit().textContent ?? '';

    expect(text).not.toContain('Work lunch');
    expect(text).toContain('not in any groups together');
  });

  it('does not claim the expense list is empty before the group has loaded', () => {
    // `group === null` here means "still arriving", and the old screen's hardcoded
    // "will appear here once you add one" said the opposite — confidently, and forever.
    state.friend = friendWith({});
    state.group = null;

    const text = visit().textContent ?? '';

    expect(text).toContain('Shared expenses');
    expect(text).not.toContain('will appear here once you add one');
  });
});
