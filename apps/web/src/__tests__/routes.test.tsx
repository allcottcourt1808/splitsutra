/**
 * Route table integrity.
 *
 * `routes.tsx` derives the table by mapping over `ROUTE_PATTERNS` instead of writing it out,
 * so the invariant worth protecting is not "route X exists" but the derivation itself: every
 * declared screen reachable, every `paths.*()` URL matching the pattern it was built from,
 * the shell wrapping everything except the two screens that opt out, and — since phase-03 §4 —
 * `<RequireAuth>` wrapping everything except `/login`.
 *
 * None of this is visible to the type checker. `ROUTE_PATTERNS` is `as const`, so a pattern
 * with a typo, a builder that concatenates a segment the router does not match, a screen
 * quietly added to `OUTSIDE_SHELL`, or a screen that slipped out from under the auth guard all
 * compile perfectly and are only found by navigating.
 *
 * ## Why the hooks are mocked
 *
 * Rendering a route now runs `useAuth()`, and `useFriendRequests()` opens a Firestore listener
 * the moment it has a uid. Neither has a Firebase app to talk to in this project — there is no
 * `initFirebase()` in a component test — so the session is supplied directly. That also makes
 * the thing under test explicit: these assertions are about **where each URL lands for a given
 * session**, and the session is now an input.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryRouter, matchRoutes, RouterProvider, type RouteObject } from 'react-router';
import { ROUTE_PATTERNS, paths, type ScreenName } from '../navigation/paths';
import { ROUTE_IDS, router } from '../routes';
import { render } from './helpers/render';
import { SAMPLE_URLS } from './helpers/sampleUrls';

/** Mutable across tests; `vi.hoisted` so the mock factory below may close over it. */
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
  useProfile: () => ({ profile: null, loading: false, error: null }),
  useFriends: () => ({ friends: [], loading: false, error: null }),
  useFriendRequests: () => ({
    incoming: [],
    outgoing: [],
    incomingCount: 0,
    loading: false,
    error: null,
  }),
}));

const routes = router.routes as RouteObject[];

beforeEach(() => {
  session.user = { uid: 'u1' };
  session.loading = false;
});

function matchesFor(url: string) {
  const matched = matchRoutes(routes, url);
  expect(matched, `nothing matched ${url}`).not.toBeNull();
  return matched!;
}

function leafPattern(url: string): string | undefined {
  const matched = matchesFor(url);
  return matched[matched.length - 1]?.route.path;
}

/** Is `url` wrapped by the layout route with this id? */
function wrappedBy(url: string, id: string): boolean {
  return matchesFor(url).some((match) => match.route.id === id);
}

const rendersInsideShell = (url: string): boolean => wrappedBy(url, ROUTE_IDS.shell);

/** Drive the real route table without touching `window.history`. */
function visit(url: string) {
  const memory = createMemoryRouter(routes, { initialEntries: [url] });
  const { container } = render(<RouterProvider router={memory} />);
  return { container, pathname: () => memory.state.location.pathname };
}

describe('the route table', () => {
  it('resolves every declared screen to its own route', () => {
    for (const [screen, url] of Object.entries(SAMPLE_URLS)) {
      expect(leafPattern(url), `${screen} -> ${url}`).toBe(ROUTE_PATTERNS[screen as ScreenName]);
    }
  });

  it('renders sign-in and the invite screen outside the tab shell', () => {
    // Both can be reached by someone with no account; a tab bar there only invites taps
    // that bounce back.
    expect(rendersInsideShell(SAMPLE_URLS.SignIn)).toBe(false);
    expect(rendersInsideShell(SAMPLE_URLS.JoinGroup)).toBe(false);
  });

  it('renders every other screen inside the tab shell', () => {
    const outside = new Set<ScreenName>(['SignIn', 'JoinGroup']);
    for (const [screen, url] of Object.entries(SAMPLE_URLS)) {
      if (outside.has(screen as ScreenName)) continue;
      expect(rendersInsideShell(url), `${screen} -> ${url}`).toBe(true);
    }
  });

  it('prefers a static route over the dynamic one that also matches it', () => {
    // `/groups/new` is matched by `/groups/:gid` too; CreateGroup has to win.
    expect(leafPattern(SAMPLE_URLS.CreateGroup)).toBe(ROUTE_PATTERNS.CreateGroup);
    expect(leafPattern(SAMPLE_URLS.AddFriend)).toBe(ROUTE_PATTERNS.AddFriend);
  });
});

describe('the auth guards in the table', () => {
  it('puts every screen except sign-in behind <RequireAuth> (AC-A1.5)', () => {
    for (const [screen, url] of Object.entries(SAMPLE_URLS)) {
      if (screen === 'SignIn') continue;
      expect(wrappedBy(url, ROUTE_IDS.requireAuth), `${screen} -> ${url}`).toBe(true);
    }
  });

  it('guards the invite deep link too, shell or no shell (AC-B3.3)', () => {
    // The one route it is tempting to exempt, because it is opened by people without
    // accounts. AC-A1.5 has no carve-out and AC-B3.3 says what should happen instead:
    // sign in, then complete the join.
    expect(wrappedBy(SAMPLE_URLS.JoinGroup, ROUTE_IDS.requireAuth)).toBe(true);
    expect(rendersInsideShell(SAMPLE_URLS.JoinGroup)).toBe(false);
  });

  it('puts sign-in behind <RedirectIfAuthed> and nothing else there (AC-A1.6)', () => {
    expect(wrappedBy(SAMPLE_URLS.SignIn, ROUTE_IDS.redirectIfAuthed)).toBe(true);
    expect(wrappedBy(SAMPLE_URLS.SignIn, ROUTE_IDS.requireAuth)).toBe(false);

    for (const [screen, url] of Object.entries(SAMPLE_URLS)) {
      if (screen === 'SignIn') continue;
      expect(wrappedBy(url, ROUTE_IDS.redirectIfAuthed), `${screen} -> ${url}`).toBe(false);
    }
  });
});

describe('path builders and the router', () => {
  it('round-trips params through the URL the builder produced', () => {
    const url = paths.ExpenseDetail({ gid: 'g1', eid: 'e1' });
    const matched = matchesFor(url);

    expect(matched[matched.length - 1]?.params).toEqual({ gid: 'g1', eid: 'e1' });
  });

  it('round-trips a param whose value contains URL punctuation', () => {
    // The builder percent-encodes; the router decodes. If either side changed alone, an
    // invite token with a slash in it would silently arrive truncated.
    const token = 'a/b c?d';
    const matched = matchesFor(paths.JoinGroup({ token }));

    expect(matched[matched.length - 1]?.params.token).toBe(token);
  });
});

describe('navigating the app', () => {
  it('redirects a bare origin visit into the default tab', () => {
    const { pathname } = visit('/');

    expect(pathname()).toBe(paths.GroupList());
  });

  it('redirects an unknown URL into the default tab rather than dead-ending', () => {
    const { pathname } = visit('/no/such/screen');

    expect(pathname()).toBe(paths.GroupList());
  });

  it('gives a tabbed screen the tab bar and a sign-in screen none', () => {
    expect(
      visit(SAMPLE_URLS.GroupList).container.querySelectorAll('nav[aria-label="Main"]'),
    ).toHaveLength(1);

    session.user = null;
    expect(
      visit(SAMPLE_URLS.SignIn).container.querySelectorAll('nav[aria-label="Main"]'),
    ).toHaveLength(0);
  });

  it('sends a signed-out visitor to sign-in from anywhere (AC-A1.5)', () => {
    session.user = null;

    expect(visit(SAMPLE_URLS.GroupList).pathname()).toBe(paths.SignIn());
    expect(visit(SAMPLE_URLS.JoinGroup).pathname()).toBe(paths.SignIn());
    expect(visit('/').pathname()).toBe(paths.SignIn());
  });

  it('sends a signed-in visitor off /login and into the app (AC-A1.6)', () => {
    expect(visit(SAMPLE_URLS.SignIn).pathname()).toBe(paths.GroupList());
  });

  it('holds still while the session is resolving rather than flashing sign-in', () => {
    // 🔴 The bug this whole guard exists to prevent. On a hard refresh Firebase rehydrates
    // the session asynchronously, so for one tick a signed-in user is indistinguishable
    // from a signed-out one — and a guard that redirects then has already destroyed the
    // destination by the time the answer arrives.
    session.user = null;
    session.loading = true;

    const { pathname, container } = visit(SAMPLE_URLS.GroupList);

    expect(pathname()).toBe(paths.GroupList());
    expect(container.textContent).toContain('Checking your session');
  });
});
