import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryRouter, RouterProvider, type RouteObject } from 'react-router';

import type { Friend } from '@splitsutra/core';

import { render } from '../../__tests__/helpers/render';
import { paths } from '../../navigation/paths';
import { FriendDetailScreen } from '../FriendDetailScreen';

const state = vi.hoisted(() => ({
  friend: null as Friend | null,
  loading: false,
  error: null as Error | null,
}));

vi.mock('@splitsutra/core/hooks', () => ({
  useFriend: () => ({ friend: state.friend, loading: state.loading, error: state.error }),
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
  };
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
});

describe('<FriendDetailScreen>', () => {
  it('says it is loading before the first answer arrives', () => {
    state.loading = true;

    expect(visit().textContent).toContain('Loading');
  });

  it('reports a failed subscription', () => {
    state.error = new Error('permission denied');

    expect(visit().textContent).toContain('permission denied');
  });

  it('renders the balance and its direction for a single currency', () => {
    state.friend = friendWith({ USD: 2500 });

    const container = visit();
    const text = container.textContent ?? '';

    expect(text).toContain('Priya Sharma');
    expect(text).toContain('USD');
    expect(text).toContain('owes you');
    expect(text).toContain('25.00');
    expect(rows(container)).toHaveLength(1);
  });

  it('renders one row per currency and never a summed total (D6)', () => {
    // 🔴 Article I / D6. A total would read 1500 netted, or 3500 added blind — both meaningless.
    state.friend = friendWith({ USD: 2500, EUR: -1000 });

    const container = visit();
    const text = container.textContent ?? '';

    expect(rows(container)).toHaveLength(2);
    expect(text).toContain('USD');
    expect(text).toContain('EUR');
    expect(text).toContain('owes you');
    expect(text).toContain('you owe');
    expect(text).toContain('25.00');
    expect(text).toContain('10.00');
    expect(text).not.toContain('15.00');
    expect(text).not.toContain('35.00');
  });

  it('reads an empty balance map as settled up rather than zero', () => {
    state.friend = friendWith({});

    const container = visit();
    const text = container.textContent ?? '';

    expect(rows(container)).toHaveLength(0);
    expect(text).toContain('Settled up');
    expect(text).not.toContain('0.00');
  });

  it('offers a way back when the uid is not a friend', () => {
    state.friend = null;

    const container = visit();

    expect(container.textContent).toContain('Not a friend');
    expect(container.querySelector(`a[href="${paths.FriendList()}"]`)).not.toBeNull();
  });
});
