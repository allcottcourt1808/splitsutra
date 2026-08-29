/**
 * The route guards, and the one thing they are for.
 *
 * `routes.test.tsx` checks that the guards are *in* the table. This file checks what they
 * decide, against the three-state session contract `useAuth` actually reports — because every
 * bug in this area comes from collapsing three states into two, and every one of them looks
 * fine in a browser you happen to be already signed in on.
 *
 * The destination round-trip (AC-B3.3) is asserted end to end rather than by inspecting
 * `location.state`: what matters is that a signed-out visit to `/invite/tok` and a subsequent
 * sign-in lands back on `/invite/tok`, not the mechanism it used to remember.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createMemoryRouter,
  Navigate,
  RouterProvider,
  type InitialEntry,
  type RouteObject,
} from 'react-router';

import { render } from '../../__tests__/helpers/render';
import { HOME_PATH, paths } from '../../navigation/paths';
import { RedirectIfAuthed, RequireAuth, safeDestination } from '../AuthGuards';

const session = vi.hoisted(() => ({
  user: null as { uid: string } | null,
  loading: false,
}));

vi.mock('@splitsutra/core/hooks', () => ({
  useAuth: () => ({
    user: session.user,
    profile: null,
    loading: session.loading,
    error: null,
    signOut: async () => {},
  }),
}));

/** A miniature table with the same shape as the real one, so the guards are exercised as
 *  layout routes rather than as components called directly. */
const routes: RouteObject[] = [
  { element: <RedirectIfAuthed />, children: [{ path: '/login', element: <span>sign in</span> }] },
  {
    element: <RequireAuth />,
    children: [
      { path: '/groups', element: <span>groups</span> },
      { path: '/invite/:token', element: <span>invite</span> },
    ],
  },
  { path: '*', element: <Navigate to="/groups" replace /> },
];

function visit(url: InitialEntry) {
  const memory = createMemoryRouter(routes, { initialEntries: [url] });
  const { container } = render(<RouterProvider router={memory} />);
  return {
    container,
    router: memory,
    path: () => `${memory.state.location.pathname}${memory.state.location.search}`,
  };
}

beforeEach(() => {
  session.user = null;
  session.loading = false;
});

describe('<RequireAuth>', () => {
  it('renders the route for a signed-in user', () => {
    session.user = { uid: 'u1' };

    const { path, container } = visit('/groups');

    expect(path()).toBe('/groups');
    expect(container.textContent).toContain('groups');
  });

  it('redirects a signed-out user to sign-in (AC-A1.5)', () => {
    const { path } = visit('/groups');

    expect(path()).toBe(paths.SignIn());
  });

  it('waits while the session is resolving instead of flashing sign-in', () => {
    // The three-state rule. `loading: true` with `user: null` is "nobody knows yet", and it
    // is what every hard refresh looks like for its first tick.
    session.loading = true;

    const { path, container } = visit('/groups');

    expect(path()).toBe('/groups');
    expect(container.textContent).toContain('Checking your session');
    expect(container.textContent).not.toContain('sign in');
  });

  it('replaces rather than pushes, so back does not re-enter the bounce', () => {
    const { router } = visit('/groups');

    // One entry, not two: the URL that triggered the redirect was consumed, not stacked.
    expect(router.state.location.pathname).toBe(paths.SignIn());
    expect(router.state.historyAction).toBe('REPLACE');
  });
});

describe('<RedirectIfAuthed>', () => {
  it('renders sign-in for a signed-out user', () => {
    const { path, container } = visit('/login');

    expect(path()).toBe('/login');
    expect(container.textContent).toContain('sign in');
  });

  it('sends a signed-in user home (AC-A1.6)', () => {
    session.user = { uid: 'u1' };

    expect(visit('/login').path()).toBe(HOME_PATH);
  });

  it('waits while the session is resolving', () => {
    session.loading = true;

    const { path, container } = visit('/login');

    expect(path()).toBe('/login');
    expect(container.textContent).toContain('Checking your session');
  });
});

describe('the preserved destination (AC-B3.3)', () => {
  /**
   * The round trip, in two halves: the bounce stashes, and the sign-in honours the stash.
   *
   * Split rather than driven as one continuous session because signing in *is* a fresh render
   * of `/login` under a different session — the guard has no other input — so handing the
   * second half the location the first half produced tests exactly the handover, with none of
   * the act()-flushing ceremony that re-navigating a live router would need.
   */
  function bounceThenSignIn(url: string) {
    const bounced = visit(url);
    expect(bounced.path(), 'should have been sent to sign-in').toBe(paths.SignIn());

    session.user = { uid: 'u1' };
    return visit({
      pathname: bounced.router.state.location.pathname,
      state: bounced.router.state.location.state,
    });
  }

  it('stashes the destination in history state, not in the URL', () => {
    // Out of the address bar on purpose: an invite path carries a token, and a `?next=`
    // parameter is editable, shareable, and logged by anything that records URLs.
    const url = paths.JoinGroup({ token: 'inv_abc' });
    const { router, path } = visit(url);

    expect(path()).toBe(paths.SignIn());
    expect(path()).not.toContain('inv_abc');
    expect(router.state.location.state).toEqual({ from: url });
  });

  it('returns to the invite link the visitor originally opened', () => {
    const url = paths.JoinGroup({ token: 'inv_abc' });

    expect(bounceThenSignIn(url).path()).toBe(url);
  });

  it('keeps the query string, which is where a prefill would live', () => {
    expect(bounceThenSignIn('/groups?tab=owed').path()).toBe('/groups?tab=owed');
  });

  it('falls back home when there is no stash — a direct visit to /login', () => {
    session.user = { uid: 'u1' };

    expect(visit('/login').path()).toBe(HOME_PATH);
  });

  it('ignores a stash pointing off-origin rather than following it', () => {
    session.user = { uid: 'u1' };

    expect(visit({ pathname: '/login', state: { from: '//evil.example' } }).path()).toBe(HOME_PATH);
  });
});

describe('safeDestination', () => {
  it('accepts an in-app path', () => {
    expect(safeDestination('/groups/g1/settle')).toBe('/groups/g1/settle');
    expect(safeDestination('/invite/tok?ref=sms#top')).toBe('/invite/tok?ref=sms#top');
  });

  it.each([
    // 🔴 Both of these start with `/` and both resolve to another ORIGIN. A `startsWith('/')`
    // check passes them, and the sign-in flow becomes an open redirector that hands our
    // referrer to somebody else's page.
    ['//evil.example/steal', 'protocol-relative'],
    ['/\\evil.example/steal', 'backslash protocol-relative'],
    ['https://evil.example', 'absolute'],
    ['javascript:alert(1)', 'scheme'],
    ['groups', 'relative'],
  ])('rejects %s (%s)', (candidate) => {
    expect(safeDestination(candidate)).toBeNull();
  });

  it('rejects anything that is not a string, including a missing state', () => {
    expect(safeDestination(undefined)).toBeNull();
    expect(safeDestination(null)).toBeNull();
    expect(safeDestination({ from: '/groups' })).toBeNull();
  });
});
