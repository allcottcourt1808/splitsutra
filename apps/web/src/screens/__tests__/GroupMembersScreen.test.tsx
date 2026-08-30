/**
 * `/groups/:gid/members`.
 *
 * 🔴 Article III. `groups/{gid}/members` is `allow write: if false`, so every mutation on this
 * screen must land on a callable. The assertions below are on the callable being invoked with
 * the right payload — there is no Firestore write for a test to observe, and if one ever
 * appeared the screen would be importing `firebase/firestore` in violation of Article VIII.
 */

import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryRouter, RouterProvider, type RouteObject } from 'react-router';

import type { CurrencyCode, Group, GroupMember } from '@splitsutra/core';

import { render } from '../../__tests__/helpers/render';
import { paths } from '../../navigation/paths';
import { GroupMembersScreen } from '../GroupMembersScreen';

const state = vi.hoisted(() => ({
  group: null as unknown,
  members: [] as unknown[],
  activeMembers: [] as unknown[],
  me: null as unknown,
  isAdmin: false,
  loading: false,
  error: null as Error | null,
  createInvite: vi.fn(),
  leaveGroup: vi.fn(),
  removeMember: vi.fn(),
  share: vi.fn(),
}));

vi.mock('@splitsutra/core/hooks', () => ({
  useGroup: () => ({ group: state.group, loading: false, error: null }),
  useGroupMembers: () => ({
    members: state.members,
    activeMembers: state.activeMembers,
    me: state.me,
    isAdmin: state.isAdmin,
    loading: state.loading,
    error: state.error,
  }),
}));

vi.mock('@splitsutra/core/repositories', () => ({
  createInvite: (...args: unknown[]) => state.createInvite(...args) as Promise<unknown>,
  leaveGroup: (...args: unknown[]) => state.leaveGroup(...args) as Promise<unknown>,
  removeMember: (...args: unknown[]) => state.removeMember(...args) as Promise<unknown>,
}));

vi.mock('@splitsutra/core/platform', () => ({
  getPlatformAdapter: () => ({ share: state.share }),
}));

const TS = { seconds: 0, nanoseconds: 0 } as unknown as Group['createdAt'];

function group(): Group {
  return {
    id: 'g1',
    name: 'Goa Trip',
    type: 'trip',
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
  };
}

interface MemberOverrides {
  readonly role?: GroupMember['role'];
  readonly balanceMinor?: number;
  readonly left?: boolean;
}

function member(uid: string, displayName: string, overrides: MemberOverrides = {}): GroupMember {
  return {
    uid,
    role: overrides.role ?? 'member',
    displayName,
    photoURL: null,
    balanceMinor: overrides.balanceMinor ?? 0,
    joinedAt: TS,
    leftAt: overrides.left === true ? TS : null,
  } as unknown as GroupMember;
}

const routes: RouteObject[] = [{ path: '/groups/:gid/members', element: <GroupMembersScreen /> }];

function visit(): HTMLElement {
  const memory = createMemoryRouter(routes, {
    initialEntries: [paths.GroupMembers({ gid: 'g1' })],
  });
  return render(<RouterProvider router={memory} />).container;
}

function button(container: HTMLElement, name: string): HTMLButtonElement {
  const found = [...container.querySelectorAll('button')].find(
    (el) => (el.textContent ?? '').trim() === name || el.getAttribute('aria-label') === name,
  );
  if (found === undefined) throw new Error(`No button named "${name}"`);
  return found;
}

async function press(container: HTMLElement, name: string): Promise<void> {
  const target = button(container, name);
  await act(async () => {
    target.click();
    await Promise.resolve();
  });
}

function rows(container: HTMLElement): Element[] {
  return [...container.querySelectorAll('ul[aria-label="Members"] > li')];
}

/** Priya is the signed-in admin; Ravi is another member. */
function twoMembers(): void {
  const me = member('u1', 'Priya Sharma', { role: 'admin' });
  const other = member('u2', 'Ravi Kumar');
  state.members = [me, other];
  state.activeMembers = [me, other];
  state.me = me;
  state.isAdmin = true;
}

beforeEach(() => {
  state.group = group();
  state.members = [];
  state.activeMembers = [];
  state.me = null;
  state.isAdmin = false;
  state.loading = false;
  state.error = null;
  state.createInvite = vi
    .fn()
    .mockResolvedValue({ inviteId: 'i1', token: 'deadbeef', groupName: 'Goa Trip' });
  state.leaveGroup = vi.fn().mockResolvedValue({ groupId: 'g1', left: true });
  state.removeMember = vi.fn().mockResolvedValue({ groupId: 'g1', uid: 'u2', removed: true });
  state.share = vi.fn().mockResolvedValue(undefined);
});

describe('<GroupMembersScreen>', () => {
  it('says it is loading before the first answer arrives', () => {
    state.loading = true;

    expect(visit().textContent).toContain('Loading');
  });

  it('reports a failed subscription instead of an empty roster', () => {
    state.error = new Error('permission denied');

    const container = visit();

    expect(container.textContent).toContain('permission denied');
    expect(container.textContent).not.toContain('Nobody here yet');
  });

  it('explains an empty roster as fan-out lag rather than as a dead end', () => {
    const container = visit();

    expect(container.textContent).toContain('Nobody here yet');
    expect(rows(container)).toHaveLength(0);
  });

  it('marks the signed-in member, the admin, and anyone who has left', () => {
    const me = member('u1', 'Priya Sharma', { role: 'admin' });
    const departed = member('u3', 'Anita Rao', { left: true });
    state.members = [me, member('u2', 'Ravi Kumar'), departed];
    state.activeMembers = [me, member('u2', 'Ravi Kumar')];
    state.me = me;
    state.isAdmin = true;

    const rendered = rows(visit());

    expect(rendered[0]?.textContent).toContain('Priya Sharma (you)');
    expect(rendered[0]?.textContent).toContain('Admin');
    expect(rendered[2]?.textContent).toContain('Left this group');
  });

  it('shows each stored balance with its direction, and settled as words', () => {
    const me = member('u1', 'Priya Sharma', { role: 'admin', balanceMinor: 2500 });
    const other = member('u2', 'Ravi Kumar', { balanceMinor: -2500 });
    const third = member('u3', 'Anita Rao');
    state.members = [me, other, third];
    state.activeMembers = [me, other, third];
    state.me = me;

    const rendered = rows(visit());

    expect(rendered[0]?.textContent).toContain('is owed');
    expect(rendered[0]?.textContent).toContain('25.00');
    expect(rendered[1]?.textContent).toContain('owes');
    expect(rendered[2]?.textContent).toContain('Settled up');
    expect(rendered[2]?.textContent).not.toContain('0.00');
  });

  it('offers Remove only to an admin, and never for themselves or for someone gone', () => {
    const me = member('u1', 'Priya Sharma', { role: 'admin' });
    const departed = member('u3', 'Anita Rao', { left: true });
    state.members = [me, member('u2', 'Ravi Kumar'), departed];
    state.activeMembers = [me, member('u2', 'Ravi Kumar')];
    state.me = me;
    state.isAdmin = true;

    const asAdmin = visit();

    expect(asAdmin.querySelectorAll('[aria-label^="Remove "]')).toHaveLength(1);
    expect(asAdmin.querySelector('[aria-label="Remove Ravi Kumar from the group"]')).not.toBeNull();

    state.isAdmin = false;

    expect(visit().querySelectorAll('[aria-label^="Remove "]')).toHaveLength(0);
  });

  it('removes a member through the callable, not through a member document write', async () => {
    twoMembers();

    const container = visit();
    await press(container, 'Remove Ravi Kumar from the group');

    expect(state.removeMember).toHaveBeenCalledTimes(1);
    expect(state.removeMember).toHaveBeenCalledWith({ groupId: 'g1', uid: 'u2' });
    expect(container.textContent).toContain('Ravi Kumar was removed.');
  });

  it("shows the callable's own refusal verbatim — it names the outstanding amount", async () => {
    twoMembers();
    state.removeMember = vi.fn().mockRejectedValue(new Error('Ravi Kumar still owes $12.50.'));

    const container = visit();
    await press(container, 'Remove Ravi Kumar from the group');

    expect(container.textContent).toContain('Ravi Kumar still owes $12.50.');
  });

  it('leaves through the callable', async () => {
    twoMembers();

    const container = visit();
    await press(container, 'Leave group');

    expect(state.leaveGroup).toHaveBeenCalledTimes(1);
    expect(state.leaveGroup).toHaveBeenCalledWith({ groupId: 'g1' });
    expect(container.textContent).toContain('You have left this group.');
  });

  it('reports a refused leave rather than pretending it worked', async () => {
    twoMembers();
    state.leaveGroup = vi.fn().mockRejectedValue(new Error('Settle $25.00 before leaving.'));

    const container = visit();
    await press(container, 'Leave group');

    expect(container.textContent).toContain('Settle $25.00 before leaving.');
    expect(container.textContent).not.toContain('You have left this group.');
  });

  it('offers no way to leave a group already left', () => {
    const me = member('u1', 'Priya Sharma', { left: true });
    state.members = [me];
    state.activeMembers = [];
    state.me = me;

    expect(visit().textContent).not.toContain('Leave this group');
  });

  it('mints an invite through the callable and shows the token once', async () => {
    twoMembers();

    const container = visit();
    await press(container, 'Create an invite link');

    expect(state.createInvite).toHaveBeenCalledWith({ groupId: 'g1' });
    expect(state.share).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain(paths.JoinGroup({ token: 'deadbeef' }));
  });

  it('keeps the link on screen when the platform cannot share it', async () => {
    twoMembers();
    state.share = vi.fn().mockRejectedValue(new Error('share unavailable'));

    const container = visit();
    await press(container, 'Create an invite link');

    expect(container.textContent).toContain(paths.JoinGroup({ token: 'deadbeef' }));
    expect(container.textContent).toContain('Copy the link below');
  });

  it('reports a refused invite', async () => {
    twoMembers();
    state.createInvite = vi.fn().mockRejectedValue(new Error('not a member of this group'));

    const container = visit();
    await press(container, 'Create an invite link');

    expect(container.textContent).toContain('not a member of this group');
  });
});
