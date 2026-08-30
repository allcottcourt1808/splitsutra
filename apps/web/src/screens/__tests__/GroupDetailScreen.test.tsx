/**
 * `/groups/:gid` — the group home.
 *
 * A missing group is a real answer here, not an error: Rules gate `get` on membership, so a
 * group the user left arrives as `null`.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryRouter, RouterProvider, type RouteObject } from 'react-router';

import type { CurrencyCode, Group, GroupMember, GroupType } from '@splitsutra/core';

import { render } from '../../__tests__/helpers/render';
import { paths } from '../../navigation/paths';
import { GroupDetailScreen } from '../GroupDetailScreen';

const state = vi.hoisted(() => ({
  group: null as unknown,
  loading: false,
  error: null as Error | null,
  activeMembers: [] as unknown[],
  myBalanceMinor: 0,
  membersLoading: false,
}));

vi.mock('@splitsutra/core/hooks', () => ({
  useGroup: () => ({ group: state.group, loading: state.loading, error: state.error }),
  useGroupBalances: () => ({
    activeMembers: state.activeMembers,
    myBalanceMinor: state.myBalanceMinor,
    loading: state.membersLoading,
  }),
}));

const TS = { seconds: 0, nanoseconds: 0 } as unknown as Group['createdAt'];

function group(overrides: Partial<Group> = {}): Group {
  return {
    id: 'g1',
    name: 'Goa Trip',
    type: 'trip' as GroupType,
    isImplicit: false,
    photoURL: null,
    currency: 'USD' as CurrencyCode,
    memberIds: ['u1', 'u2'],
    memberCount: 2,
    simplifyDebts: false,
    createdBy: 'u1',
    createdAt: TS,
    updatedAt: TS,
    lastActivityAt: TS,
    deletedAt: null,
    baseCurrency: null,
    allowMixedCurrency: null,
    ...overrides,
  };
}

function member(uid: string, displayName: string): GroupMember {
  return {
    uid,
    role: 'member',
    displayName,
    photoURL: null,
    balanceMinor: 0,
    joinedAt: TS,
    leftAt: null,
  } as unknown as GroupMember;
}

const routes: RouteObject[] = [{ path: '/groups/:gid', element: <GroupDetailScreen /> }];

function visit(): HTMLElement {
  const memory = createMemoryRouter(routes, {
    initialEntries: [paths.GroupDetail({ gid: 'g1' })],
  });
  return render(<RouterProvider router={memory} />).container;
}

beforeEach(() => {
  state.group = null;
  state.loading = false;
  state.error = null;
  state.activeMembers = [];
  state.myBalanceMinor = 0;
  state.membersLoading = false;
});

describe('<GroupDetailScreen>', () => {
  it('says it is loading before the first answer arrives', () => {
    state.loading = true;

    expect(visit().textContent).toContain('Loading');
  });

  it('reports a failed subscription instead of a missing group', () => {
    state.error = new Error('permission denied');

    const container = visit();

    expect(container.textContent).toContain('permission denied');
    expect(container.textContent).not.toContain('Group not found');
  });

  it('offers a way back when the group resolves to nothing', () => {
    const container = visit();

    expect(container.textContent).toContain('Group not found');
    expect(container.querySelector(`a[href="${paths.GroupList()}"]`)).not.toBeNull();
  });

  it('names the group, its type and its currency', () => {
    state.group = group({ type: 'home' as GroupType, currency: 'EUR' as CurrencyCode });

    const text = visit().textContent ?? '';

    expect(text).toContain('Goa Trip');
    expect(text).toContain('Home');
    expect(text).toContain('EUR');
    expect(text).toContain('2 members');
  });

  it('shows the member stack once the members arrive, and nothing before', () => {
    state.group = group();

    expect(visit().querySelector('[aria-label^="Members:"]')).toBeNull();

    state.activeMembers = [member('u1', 'Priya Sharma'), member('u2', 'Ravi Kumar')];

    expect(
      visit().querySelector('[aria-label="Members: Priya Sharma, Ravi Kumar"]'),
    ).not.toBeNull();
  });

  it('keeps the balance strip loading separately from the group document', () => {
    state.group = group();
    state.membersLoading = true;

    const container = visit();

    expect(container.textContent).toContain('Loading balances…');
    expect(container.textContent).toContain('Goa Trip');
  });

  it('reads a zero balance as settled rather than as a zero amount', () => {
    state.group = group();

    const container = visit();

    expect(container.textContent).toContain('You are settled up in this group');
    expect(container.textContent).not.toContain('0.00');
  });

  it('shows the balance with its direction in the group currency', () => {
    state.group = group();
    state.myBalanceMinor = 2500;

    expect(visit().textContent).toContain('You are owed');
    expect(visit().textContent).toContain('25.00');

    state.myBalanceMinor = -1000;

    const owing = visit().textContent ?? '';

    expect(owing).toContain('You owe');
    expect(owing).toContain('10.00');
  });

  it('reaches every screen the group hangs off', () => {
    state.group = group();

    const container = visit();
    const href = (path: string): Element | null => container.querySelector(`a[href="${path}"]`);

    expect(href(paths.GroupSettings({ gid: 'g1' }))).not.toBeNull();
    expect(href(paths.GroupMembers({ gid: 'g1' }))).not.toBeNull();
    expect(href(paths.GroupBalances({ gid: 'g1' }))).not.toBeNull();
    expect(href(paths.SettleUp({ gid: 'g1' }))).not.toBeNull();
    expect(href(paths.AddExpense())).not.toBeNull();
  });

  it('explains the empty expense section rather than showing a spinner that never resolves', () => {
    state.group = group();

    const text = visit().textContent ?? '';

    expect(text).toContain('Expenses');
    expect(text).toContain('appear here');
  });
});
