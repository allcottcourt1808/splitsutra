import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryRouter, RouterProvider, type RouteObject } from 'react-router';

import type { Friend, FriendRequest } from '@splitsutra/core';

import { render } from '../../__tests__/helpers/render';
import { FriendsScreen } from '../FriendsScreen';

const state = vi.hoisted(() => ({
  friends: [] as Friend[],
  friendsLoading: false,
  incoming: [] as FriendRequest[],
  outgoing: [] as FriendRequest[],
  withdrawn: [] as FriendRequest[],
}));

vi.mock('@splitsutra/core/hooks', () => ({
  useFriends: () => ({ friends: state.friends, loading: state.friendsLoading, error: null }),
  useFriendRequests: () => ({
    incoming: state.incoming,
    outgoing: state.outgoing,
    incomingCount: state.incoming.length,
    loading: false,
    error: null,
  }),
  useWithdrawnFriendRequests: () => ({
    withdrawn: state.withdrawn,
    loading: false,
    error: null,
  }),
}));

vi.mock('@splitsutra/core/repositories', () => ({
  respondToFriendRequest: vi.fn().mockResolvedValue({}),
}));

/** A Firestore `Timestamp` stand-in with the one method the screen calls. */
function ts(millis: number): FriendRequest['createdAt'] {
  return {
    toMillis: () => millis,
    toDate: () => new Date(millis),
  } as unknown as FriendRequest['createdAt'];
}

const NOW = Date.now();
const HOUR = 60 * 60 * 1000;

function friend(displayName: string, uid: string): Friend {
  return {
    friendUid: uid,
    displayName,
    photoURL: null,
    implicitGroupId: `g-${uid}`,
    balanceMinor: {},
    updatedAt: ts(NOW),
  } as unknown as Friend;
}

function request(overrides: Partial<FriendRequest> = {}): FriendRequest {
  return {
    id: 'u1__u2',
    fromUid: 'u1',
    fromName: 'Neethu Sandeep',
    fromPhotoURL: null,
    toUid: 'u2',
    toName: 'Priya Sharma',
    toPhotoURL: null,
    status: 'pending',
    implicitGroupId: null,
    createdAt: ts(NOW - 2 * HOUR),
    updatedAt: ts(NOW - HOUR),
    respondedAt: null,
    ...overrides,
  } as unknown as FriendRequest;
}

const routes: RouteObject[] = [{ path: '/friends', element: <FriendsScreen /> }];

function visit(): HTMLElement {
  const memory = createMemoryRouter(routes, { initialEntries: ['/friends'] });
  return render(<RouterProvider router={memory} />).container;
}

function list(container: HTMLElement, label: string): HTMLElement | null {
  return container.querySelector(`ul[aria-label="${label}"]`);
}

beforeEach(() => {
  state.friends = [];
  state.friendsLoading = false;
  state.incoming = [];
  state.outgoing = [];
  state.withdrawn = [];
});

describe('<FriendsScreen>', () => {
  it('lists an established friendship under Active', () => {
    state.friends = [friend('Priya Sharma', 'u2')];

    const container = visit();

    expect(container.textContent).toContain('Active');
    expect(list(container, 'Active friends')?.textContent).toContain('Priya Sharma');
  });

  it('lists a sent request under Requested, and says when it was sent', () => {
    state.outgoing = [request()];

    const container = visit();
    const sent = list(container, 'Requests you sent');

    expect(container.textContent).toContain('Requested');
    expect(sent?.textContent).toContain('Priya Sharma');
    expect(sent?.textContent).toContain('Asked');
  });

  it('lists a withdrawn request under Withdrawn', () => {
    state.withdrawn = [
      request({ id: 'u1__u3', toUid: 'u3', toName: 'Arjun Rao', status: 'cancelled' }),
    ];

    const container = visit();
    const gone = list(container, 'Requests you withdrew');

    expect(container.textContent).toContain('Withdrawn');
    expect(gone?.textContent).toContain('Arjun Rao');
  });

  it('counts each section', () => {
    state.friends = [friend('Priya Sharma', 'u2'), friend('Arjun Rao', 'u3')];
    state.outgoing = [request()];
    state.withdrawn = [request({ id: 'u1__u4', toUid: 'u4', status: 'cancelled' })];

    const text = visit().textContent ?? '';

    expect(text).toContain('Active · 2');
    expect(text).toContain('Requested · 1');
    expect(text).toContain('Withdrawn · 1');
  });

  it('does not make a request row tappable — there is no friendship behind it', () => {
    // `FriendDetail` reads users/{uid}/friends/{friendUid}. A pending or withdrawn request has
    // no such document, so a link would lead somewhere that cannot load.
    state.outgoing = [request()];
    state.withdrawn = [request({ id: 'u1__u4', toUid: 'u4', status: 'cancelled' })];

    const container = visit();

    expect(list(container, 'Requests you sent')?.querySelector('a')).toBeNull();
    expect(list(container, 'Requests you withdrew')?.querySelector('a')).toBeNull();
  });

  it('sends you back to Add Friend to ask again, rather than offering to re-send', () => {
    // 🔴 sendFriendRequest resolves people by email or phone through usernames/{sha256(key)},
    // never by uid, and the request document does not keep the key that found them. An "Ask
    // again" button here would need one of those two things to change, and both are worse.
    state.withdrawn = [request({ status: 'cancelled' })];

    const text = visit().textContent ?? '';

    expect(text).toContain('add them by email or phone');
    expect(text).not.toContain('Ask again');
  });

  it('shows the empty state when there is nothing at all', () => {
    expect(visit().textContent).toContain('No friends yet');
  });

  it('does not say "no friends yet" while a request the user sent is on screen', () => {
    state.outgoing = [request()];

    const text = visit().textContent ?? '';

    expect(text).not.toContain('No friends yet');
    expect(text).toContain('Priya Sharma');
  });

  it('does not say "no friends yet" while a withdrawn request is on screen', () => {
    state.withdrawn = [request({ status: 'cancelled' })];

    expect(visit().textContent).not.toContain('No friends yet');
  });

  it('still shows an incoming request with its Accept and Decline buttons', () => {
    // The inbox is the in-app notification and is unchanged by the section split.
    state.incoming = [
      request({ id: 'u9__u1', fromUid: 'u9', fromName: 'Meera Iyer', toUid: 'u1' }),
    ];

    const text = visit().textContent ?? '';

    expect(text).toContain('Meera Iyer');
    expect(text).toContain('wants to be friends');
    expect(text).toContain('Accept');
    expect(text).toContain('Decline');
    expect(text).not.toContain('No friends yet');
  });
});
