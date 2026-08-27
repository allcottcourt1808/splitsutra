/**
 * The route table, derived from `ROUTE_PATTERNS` rather than written out by hand.
 *
 * Deriving it is the point. docs/07 declares the route table once, `paths.ts` mirrors it as
 * `ROUTE_PATTERNS`, and mapping over that object's keys means a screen added there without a
 * route here is impossible — the two cannot drift, because there is only one list.
 *
 * ## Which routes sit inside the shell
 *
 * `<AppShell>` supplies the phone column and the tab bar, so anything rendered inside it is
 * a tabbed, signed-in screen. Two routes deliberately sit OUTSIDE it:
 *
 *   * `SignIn` — there is nothing to navigate to yet, and a tab bar on a sign-in screen
 *     invites taps that would only bounce back.
 *   * `JoinGroup` — an invite link is opened by someone who may not have an account. It has
 *     to render before the tabbed app exists for them.
 *
 * Everything else is inside, which is also why the list is an exclusion set rather than an
 * inclusion one: a new screen defaults to being part of the app, and opting out is the
 * decision that has to be made explicitly.
 */

import { createBrowserRouter, Navigate, type RouteObject } from 'react-router';

import { AppShell } from './navigation/AppShell';
import { ROUTE_PATTERNS, paths, type ScreenName } from './navigation/paths';
import { PendingScreen } from './screens/PendingScreen';

/** Rendered without the tab bar. See the note above before adding to this. */
const OUTSIDE_SHELL: ReadonlySet<ScreenName> = new Set<ScreenName>(['SignIn', 'JoinGroup']);

const screenNames = Object.keys(ROUTE_PATTERNS) as ScreenName[];

const routeFor = (name: ScreenName): RouteObject => ({
  path: ROUTE_PATTERNS[name],
  element: <PendingScreen screen={name} />,
});

export const router = createBrowserRouter([
  // `/` is not a screen — it is a redirect into the default tab, so a bare visit to the
  // origin lands somewhere real instead of on the catch-all.
  { path: '/', element: <Navigate to={paths.GroupList()} replace /> },

  ...screenNames.filter((name) => OUTSIDE_SHELL.has(name)).map(routeFor),

  {
    element: <AppShell />,
    children: screenNames.filter((name) => !OUTSIDE_SHELL.has(name)).map(routeFor),
  },

  // Unknown URL. Redirects rather than rendering a 404 screen: hosting rewrites every path
  // to index.html, so a typo and a stale link both arrive here, and neither is worth a
  // dead end this early.
  { path: '*', element: <Navigate to={paths.GroupList()} replace /> },
]);
