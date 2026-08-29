/**
 * The two route guards — checklists/phase-03-auth.md §4 (AC-A1.5, AC-A1.6, AC-B3.3).
 *
 * Both are **layout routes**: they render `<Outlet />`, so `routes.tsx` nests the guarded
 * routes underneath them rather than wrapping each element by hand. A screen that forgets its
 * guard is then not a thing that can be written — there is one place a route is either inside
 * `<RequireAuth>` or outside it, and it is visible in the shape of the table.
 *
 * ## 🔴 The three-state rule
 *
 * `useAuth()` reports **three** states, and treating it as two is the single most common bug
 * in this area:
 *
 * | `loading` | `user`  | means                          | guard does |
 * | --------- | ------- | ------------------------------ | ---------- |
 * | `true`    | `null`  | nobody knows yet               | **wait**   |
 * | `false`   | `null`  | signed out                     | redirect   |
 * | `false`   | set     | signed in                      | render     |
 *
 * The first row is the one that gets collapsed into the second. Firebase rehydrates the session
 * from persistence asynchronously, so for the first tick after a hard refresh a signed-in user
 * looks exactly like a signed-out one. A guard that redirects on `user === null` therefore
 * bounces every reload through `/login` and back — the "flash of the login screen" phase-03 §4
 * names, and it is worse than cosmetic: the bounce is two `navigate(replace)` calls, so the
 * destination the user actually asked for is gone from history by the time the session lands.
 *
 * ## Preserving the destination (AC-B3.3)
 *
 * `<RequireAuth>` stashes where the user was trying to go in `location.state`, and
 * `<RedirectIfAuthed>` sends them there once they are signed in. `location.state` rather than a
 * `?next=` query parameter: the value never appears in the address bar, so it cannot be edited,
 * shared, or logged by anything that records URLs — which matters because an invite path
 * carries a token (`/invite/:token`).
 *
 * It is still {@link safeDestination}-checked before use. State survives a same-tab
 * `history.pushState`, and treating any string in it as a destination is how an open redirect
 * gets written.
 */

import { Navigate, Outlet, useLocation, type Location } from 'react-router';

import { useAuth } from '@splitsutra/core/hooks';

import { Screen, Stack } from '../components/Layout';
import { Text } from '../components/Text';
import { HOME_PATH, paths } from '../navigation/paths';

/* -------------------------------------------------------------------------- */
/* Destination handling                                                       */
/* -------------------------------------------------------------------------- */

/** What `<RequireAuth>` puts in `location.state` on its way to `/login`. */
export interface SignInRedirectState {
  /** The path the user asked for, including search and hash. */
  readonly from: string;
}

/**
 * The path `location` represents, as one string, ready to be navigated back to.
 *
 * Rebuilt from the parts rather than taken from `window.location`, because a memory router has
 * no `window.location` and the tests drive one.
 */
export function currentPath(location: Location): string {
  return `${location.pathname}${location.search}${location.hash}`;
}

/**
 * `candidate` if it is a path inside this app, otherwise `null`.
 *
 * 🔴 An open-redirect check, not a tidiness check. `//evil.example` and `/\evil.example` are
 * both **protocol-relative URLs** that browsers resolve to a different origin, and both start
 * with `/`, so a naive `startsWith('/')` lets an attacker turn our own sign-in flow into a
 * redirector that lands the user on their page wearing our referrer.
 */
export function safeDestination(candidate: unknown): string | null {
  if (typeof candidate !== 'string') return null;
  if (!candidate.startsWith('/')) return null;
  if (candidate.startsWith('//') || candidate.startsWith('/\\')) return null;
  return candidate;
}

/** The stashed destination on `location`, or `null` when there is none worth trusting. */
function stashedDestination(location: Location): string | null {
  const state = location.state as Partial<SignInRedirectState> | null;
  return safeDestination(state?.from);
}

/* -------------------------------------------------------------------------- */
/* The waiting state                                                          */
/* -------------------------------------------------------------------------- */

/**
 * What renders while the session is still resolving.
 *
 * Deliberately almost empty. This is on screen for the length of one persistence read — a few
 * hundred milliseconds at most — and a spinner that appears and vanishes inside that window
 * reads as a flicker, which is exactly the impression the guard exists to avoid. What it must
 * do is announce itself: a polite `role="status"` region tells a screen reader the app is
 * working rather than leaving it on a silent, empty document.
 */
export function AuthResolving() {
  return (
    <Screen label="Signing in">
      <Stack flex="1" justify="center" align="center" role="status" aria-live="polite">
        <Text tone="secondary">Checking your session…</Text>
      </Stack>
    </Screen>
  );
}

/* -------------------------------------------------------------------------- */
/* RequireAuth                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Gate for every route except `/login` (AC-A1.5).
 *
 * `replace` on the redirect: the URL the signed-out user hit is being handed to `/login` as
 * state, so leaving it in history as well would mean the browser back button walks them into
 * the same bounce again.
 */
export function RequireAuth() {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return <AuthResolving />;

  if (user === null) {
    const state: SignInRedirectState = { from: currentPath(location) };
    return <Navigate to={paths.SignIn()} replace state={state} />;
  }

  return <Outlet />;
}

/* -------------------------------------------------------------------------- */
/* RedirectIfAuthed                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Gate for `/login` (AC-A1.6). A signed-in user never sees the sign-in screen.
 *
 * This is also **the only place a successful sign-in navigates from**. `SignInScreen` does not
 * call `navigate()` after a credential resolves; it just stops being rendered, because the
 * session changed and this guard re-ran. One path, so a sign-in through the Google popup, the
 * email form, an SMS code, and a session restored in another tab all land identically.
 */
export function RedirectIfAuthed() {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return <AuthResolving />;

  if (user !== null) {
    return <Navigate to={stashedDestination(location) ?? HOME_PATH} replace />;
  }

  return <Outlet />;
}
