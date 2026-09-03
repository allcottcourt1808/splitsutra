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
  copy: vi.fn(),
  addFriendToGroup: vi.fn(),
  friends: [] as unknown[],
}));

vi.mock('@splitsutra/core/hooks', () => ({
  useFriends: () => ({ friends: state.friends, loading: false, error: null }),
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
  addFriendToGroup: (...args: unknown[]) => state.addFriendToGroup(...args) as Promise<unknown>,
  createInvite: (...args: unknown[]) => state.createInvite(...args) as Promise<unknown>,
  leaveGroup: (...args: unknown[]) => state.leaveGroup(...args) as Promise<unknown>,
  removeMember: (...args: unknown[]) => state.removeMember(...args) as Promise<unknown>,
}));

vi.mock('@splitsutra/core/platform', () => ({
  getPlatformAdapter: () => ({ share: state.share, copy: state.copy }),
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
  state.createInvite = vi.fn().mockResolvedValue({
    inviteId: 'i1',
    token: 'deadbeef',
    groupName: 'Goa Trip',
    expiresAtMillis: Date.now() + 14 * 24 * 60 * 60 * 1000,
    redeemedCount: 0,
    created: true,
  });
  state.leaveGroup = vi.fn().mockResolvedValue({ groupId: 'g1', left: true });
  state.removeMember = vi.fn().mockResolvedValue({ groupId: 'g1', uid: 'u2', removed: true });
  state.share = vi.fn().mockResolvedValue(undefined);
  state.copy = vi.fn().mockResolvedValue(undefined);
  state.addFriendToGroup = vi.fn().mockResolvedValue({
    groupId: 'g1',
    uid: 'u9',
    displayName: 'Priya',
    alreadyMember: false,
    memberCount: 3,
  });
  state.friends = [];
});

/** A confirmed friend, as `useFriends` reports them. */
function friend(uid: string, displayName: string) {
  return {
    friendUid: uid,
    displayName,
    photoURL: null,
    implicitGroupId: `imp_${uid}`,
    balanceMinor: {},
  };
}

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

  /* ──────────────────────────────────────────────────────────────────────────────────── *
   * The invite link
   *
   * It used to be a single ticket: the first person through consumed it and everyone else
   * was told the link "has already been used" — for the most obvious way anyone would use
   * one, pasting it into a group chat. These tests hold the reusable shape in place, and in
   * particular that asking twice gives the SAME link rather than minting a second live door
   * into the group.
   * ──────────────────────────────────────────────────────────────────────────────────── */

  it('asks for the link and shares it', async () => {
    twoMembers();

    const container = visit();
    await press(container, 'Get the invite link');

    expect(state.createInvite).toHaveBeenCalledWith({ groupId: 'g1' });
    expect(state.share).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain(paths.JoinGroup({ token: 'deadbeef' }));
  });

  it('says the link is for everyone, not for one person', () => {
    twoMembers();

    const text = visit().textContent ?? '';

    expect(text).toContain('share it with as many people as you like');
  });

  it('asks again for the same link rather than minting a second one', async () => {
    twoMembers();

    const container = visit();
    await press(container, 'Get the invite link');

    // 🔴 No `reset` on a plain re-share. The server returns the group's existing link, so two
    //    presses must not leave two live doors into the group — one of which nobody can see.
    await press(container, 'Share again');

    expect(state.createInvite).toHaveBeenCalledTimes(2);
    expect(state.createInvite).toHaveBeenNthCalledWith(1, { groupId: 'g1' });
    expect(state.createInvite).toHaveBeenNthCalledWith(2, { groupId: 'g1' });
  });

  it('resets the link on request, and says the old one is dead', async () => {
    twoMembers();

    const container = visit();
    await press(container, 'Get the invite link');
    await press(container, 'Reset link');

    expect(state.createInvite).toHaveBeenLastCalledWith({ groupId: 'g1', reset: true });
    expect(container.textContent).toContain('The old one no longer works');
  });

  it('offers no reset until there is a link to reset', () => {
    twoMembers();

    expect(visit().textContent).not.toContain('Reset link');
  });

  it('reports how many people have already joined through the link', async () => {
    twoMembers();
    state.createInvite = vi.fn().mockResolvedValue({
      inviteId: 'i1',
      token: 'deadbeef',
      groupName: 'Goa Trip',
      expiresAtMillis: Date.now() + 1000,
      redeemedCount: 3,
      created: false,
    });

    const container = visit();
    await press(container, 'Get the invite link');

    expect(container.textContent).toContain('3 people have joined through this link');
  });

  it('keeps the link on screen when the platform cannot share it', async () => {
    twoMembers();
    state.share = vi.fn().mockRejectedValue(new Error('share unavailable'));

    const container = visit();
    await press(container, 'Get the invite link');

    expect(container.textContent).toContain(paths.JoinGroup({ token: 'deadbeef' }));
    expect(container.textContent).toContain('Copy the link below');
  });

  it('reports a refused invite', async () => {
    twoMembers();
    state.createInvite = vi.fn().mockRejectedValue(new Error('not a member of this group'));

    const container = visit();
    await press(container, 'Get the invite link');

    expect(container.textContent).toContain('not a member of this group');
  });
});

describe('<GroupMembersScreen> — adding a friend directly', () => {
  it('adds a friend through the callable, not through a member document write', async () => {
    // Article III: `groups/{gid}/members` is `allow write: if false`, so there is no Firestore
    // write for this test to observe — the callable IS the feature.
    state.me = member('u1', 'You', { role: 'admin' });
    state.members = [state.me];
    state.activeMembers = [state.me];
    state.friends = [friend('u9', 'Priya')];

    const container = visit();
    await press(container, 'Add Priya to this group');

    expect(state.addFriendToGroup).toHaveBeenCalledWith({ groupId: 'g1', uid: 'u9' });
    expect(container.textContent).toContain('Priya was added to the group');
  });

  it('leaves out friends who are already in the group', () => {
    state.me = member('u1', 'You', { role: 'admin' });
    const priya = member('u9', 'Priya');
    state.members = [state.me, priya];
    state.activeMembers = [state.me, priya];
    state.friends = [friend('u9', 'Priya'), friend('u8', 'Ravi')];

    const container = visit();

    expect(container.textContent).toContain('Ravi');
    expect(container.querySelector('button[aria-label="Add Priya to this group"]')).toBeNull();
  });

  it('hides the whole section when every friend is already in', () => {
    state.me = member('u1', 'You', { role: 'admin' });
    const priya = member('u9', 'Priya');
    state.members = [state.me, priya];
    state.activeMembers = [state.me, priya];
    state.friends = [friend('u9', 'Priya')];

    expect(visit().textContent).not.toContain('Add a friend');
  });

  it('reports the callable refusing — it names what to do instead', async () => {
    // The Function refuses anyone who is not already a confirmed friend, and that message is
    // actionable ("send a friend request, or share a link"). Showing it verbatim beats a
    // generic failure.
    state.me = member('u1', 'You', { role: 'admin' });
    state.members = [state.me];
    state.activeMembers = [state.me];
    state.friends = [friend('u9', 'Priya')];
    state.addFriendToGroup = vi
      .fn()
      .mockRejectedValue(new Error('You can only add people who are already your friends.'));

    const container = visit();
    await press(container, 'Add Priya to this group');

    expect(container.textContent).toContain('already your friends');
  });

  it('treats an already-a-member answer as success, not as an error', async () => {
    state.me = member('u1', 'You', { role: 'admin' });
    state.members = [state.me];
    state.activeMembers = [state.me];
    state.friends = [friend('u9', 'Priya')];
    state.addFriendToGroup = vi.fn().mockResolvedValue({
      groupId: 'g1',
      uid: 'u9',
      displayName: 'Priya',
      alreadyMember: true,
      memberCount: 2,
    });

    const container = visit();
    await press(container, 'Add Priya to this group');

    expect(container.textContent).toContain('already in this group');
  });
});

describe('<GroupMembersScreen> — copy and share the link', () => {
  it('copies the link without opening a share sheet', async () => {
    // 🔴 Two intents, not one with a fallback. Somebody who wants the string in their paste
    // buffer must not have to open a modal share sheet and cancel out of it.
    state.me = member('u1', 'You', { role: 'admin' });
    state.members = [state.me];
    state.activeMembers = [state.me];

    const container = visit();
    await press(container, 'Get the invite link');
    state.share.mockClear();
    await press(container, 'Copy the invite link to the clipboard');

    expect(state.copy).toHaveBeenCalledWith(expect.stringContaining('/invite/deadbeef'));
    expect(state.share).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Link copied');
  });

  it('says what to do by hand when the clipboard is unavailable', async () => {
    // Genuinely reachable: `navigator.clipboard` is undefined on an insecure origin.
    state.me = member('u1', 'You', { role: 'admin' });
    state.members = [state.me];
    state.activeMembers = [state.me];
    state.copy = vi.fn().mockRejectedValue(new Error('The clipboard is not available.'));

    const container = visit();
    await press(container, 'Get the invite link');
    await press(container, 'Copy the invite link to the clipboard');

    expect(container.textContent).toContain('clipboard is not available');
  });

  it('shares the link on request, separately from copying', async () => {
    state.me = member('u1', 'You', { role: 'admin' });
    state.members = [state.me];
    state.activeMembers = [state.me];

    const container = visit();
    await press(container, 'Get the invite link');
    state.share.mockClear();
    await press(container, 'Share the invite link');

    expect(state.share).toHaveBeenCalledWith(
      expect.objectContaining({ url: expect.stringContaining('/invite/deadbeef') }),
    );
    expect(state.copy).not.toHaveBeenCalled();
  });
});
