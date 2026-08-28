/**
 * Route table integrity.
 *
 * `routes.tsx` derives the table by mapping over `ROUTE_PATTERNS` instead of writing it out,
 * so the invariant worth protecting is not "route X exists" but the derivation itself: every
 * declared screen reachable, every `paths.*()` URL matching the pattern it was built from,
 * and the shell wrapping everything except the two screens that opt out.
 *
 * None of this is visible to the type checker. `ROUTE_PATTERNS` is `as const`, so a pattern
 * with a typo, a builder that concatenates a segment the router does not match, or a screen
 * quietly added to `OUTSIDE_SHELL` all compile perfectly and are only found by navigating.
 */

import { describe, expect, it } from 'vitest';
import { createMemoryRouter, matchRoutes, RouterProvider, type RouteObject } from 'react-router';
import { ROUTE_PATTERNS, paths, type ScreenName } from '../navigation/paths';
import { router } from '../routes';
import { render } from './helpers/render';
import { SAMPLE_URLS } from './helpers/sampleUrls';

const routes = router.routes as RouteObject[];

function matchesFor(url: string) {
  const matched = matchRoutes(routes, url);
  expect(matched, `nothing matched ${url}`).not.toBeNull();
  return matched!;
}

function leafPattern(url: string): string | undefined {
  const matched = matchesFor(url);
  return matched[matched.length - 1]?.route.path;
}

/** The shell is the one route with children and no path of its own. */
function rendersInsideShell(url: string): boolean {
  return matchesFor(url).some((match) => match.route.path === undefined);
}

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
    expect(
      visit(SAMPLE_URLS.SignIn).container.querySelectorAll('nav[aria-label="Main"]'),
    ).toHaveLength(0);
  });
});
