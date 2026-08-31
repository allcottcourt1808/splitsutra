/**
 * `/groups/:gid` — the group home.
 *
 * A missing group is a real answer here, not an error: Rules gate `get` on membership, so a
 * group the user left arrives as `null`.
 */

import { act } from 'react';
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

/** The two `retry` callbacks, so a test can assert the screen re-subscribed after a repair. */
const retries = vi.hoisted(() => ({ group: vi.fn(), members: vi.fn() }));

const repo = vi.hoisted(() => ({ repairGroupMembership: vi.fn() }));

vi.mock('@splitsutra/core/hooks', () => ({
  useGroup: () => ({
    group: state.group,
    loading: state.loading,
    error: state.error,
    retry: retries.group,
  }),
  useGroupBalances: () => ({
    activeMembers: state.activeMembers,
    myBalanceMinor: state.myBalanceMinor,
    loading: state.membersLoading,
    retry: retries.members,
  }),
}));

vi.mock('@splitsutra/core/repositories', () => ({
  repairGroupMembership: repo.repairGroupMembership,
}));

/**
 * The denial a missing member document produces.
 *
 * The `code` is the whole trigger — a bare `Error` saying "permission denied" must NOT start a
 * repair, which is why the fixture carries a real Firestore error shape rather than a message.
 */
function denied(): Error {
  return Object.assign(new Error('Missing or insufficient permissions.'), {
    code: 'permission-denied',
    name: 'FirebaseError',
  });
}

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

/** Clicking has to run inside `act` or React never flushes the state update it causes. */
async function press(container: HTMLElement, name: string): Promise<void> {
  const target = [...container.querySelectorAll('button')].find(
    (el) => (el.textContent ?? '').trim() === name,
  );
  if (target === undefined) throw new Error(`No button named "${name}"`);
  await act(async () => {
    target.click();
    await Promise.resolve();
  });
}

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
  retries.group.mockClear();
  retries.members.mockClear();
  repo.repairGroupMembership.mockReset();
  repo.repairGroupMembership.mockResolvedValue({
    groupId: 'g1',
    repaired: true,
    role: 'admin',
    balancesRebuilt: true,
  });
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

  /* ────────────────────────────────────────────────────────────────────────────────────── *
   * Repairing a group whose member document was never written
   * ────────────────────────────────────────────────────────────────────────────────────── */

  describe('when the member document is missing', () => {
    it('repairs the membership and re-subscribes both listeners', async () => {
      state.error = denied();

      const container = visit();

      expect(container.textContent).toContain('Finishing setting up this group');
      expect(repo.repairGroupMembership).toHaveBeenCalledWith({ groupId: 'g1' });

      await vi.waitFor(() => {
        expect(retries.group).toHaveBeenCalledTimes(1);
        expect(retries.members).toHaveBeenCalledTimes(1);
      });
    });

    it('attempts the repair once, not once per render', async () => {
      state.error = denied();

      const container = visit();
      await vi.waitFor(() => expect(retries.group).toHaveBeenCalled());
      // A second render of the same still-denied group must not call again — the failing case
      // is the one that would spin.
      container.dispatchEvent(new Event('resize'));

      expect(repo.repairGroupMembership).toHaveBeenCalledTimes(1);
    });

    it('does not repair an error that is not a permission denial', () => {
      state.error = new Error('permission denied');

      const container = visit();

      expect(repo.repairGroupMembership).not.toHaveBeenCalled();
      expect(container.textContent).toContain('permission denied');
    });

    it('shows the original failure, not the repair’s, when the repair is refused', async () => {
      state.error = denied();
      repo.repairGroupMembership.mockRejectedValue(
        Object.assign(new Error('You are not a member of this group.'), {
          code: 'functions/permission-denied',
        }),
      );

      const container = visit();

      await vi.waitFor(() => {
        expect(container.textContent).toContain('Missing or insufficient permissions.');
      });
      expect(container.textContent).not.toContain('You are not a member of this group.');
      expect(retries.group).not.toHaveBeenCalled();
    });

    it('offers a manual retry once the automatic one is spent', async () => {
      state.error = denied();
      repo.repairGroupMembership.mockRejectedValue(new Error('offline'));

      const container = visit();
      await vi.waitFor(() => expect(container.textContent).toContain('Try again'));
      expect(retries.group).not.toHaveBeenCalled();

      await press(container, 'Try again');

      expect(retries.group).toHaveBeenCalledTimes(1);
      expect(retries.members).toHaveBeenCalledTimes(1);
    });
  });
});
