/**
 * `useAuth()` — the one way a component asks who is signed in.
 *
 * checklists/phase-03-auth.md §1 fixes the shape: `{ user, profile, loading, error, signOut }`,
 * and it is deliberately built **before** any sign-in UI so the screens are plugged into the
 * contract rather than the other way round.
 *
 * All of the behaviour lives in `./authStore.ts`, which is plain TypeScript and is where the
 * tests are. What is left here is the React binding, and it is `useSyncExternalStore` rather
 * than `useState` + `useEffect` for a reason that shows up on the very first render: an
 * effect-based hook starts at its initial value and corrects itself one commit later, so a
 * component that mounts *after* the session has already resolved still renders one frame of
 * `loading: true`. Under a route guard that frame is the flash of the login screen. Reading
 * the store synchronously during render means a late mounter sees the resolved answer
 * immediately.
 *
 * ```tsx
 * const { user, loading } = useAuth();
 * if (loading) return <SplashScreen />;
 * if (user === null) return <Navigate to={paths.SignIn()} replace />;
 * ```
 */

import { useMemo, useSyncExternalStore } from 'react';

import { signOut } from '../repositories/index.js';
import {
  getAuthState,
  getInitialAuthState,
  subscribeAuthState,
  type AuthState,
} from './authStore.js';

/** What {@link useAuth} returns. */
export interface UseAuthResult extends AuthState {
  /**
   * End the session (AC-A3.1).
   *
   * Resolves once Auth has cleared it; the state above updates from the session listener a
   * tick later, not from this call, so there is exactly one path by which a component learns
   * it is signed out.
   */
  readonly signOut: () => Promise<void>;
}

/**
 * Subscribe to the session.
 *
 * Every consumer shares one `onAuthStateChanged` subscription and one profile subscription —
 * they live in the store, not in the hook — so calling this in ten components costs the same
 * as calling it in one.
 */
export function useAuth(): UseAuthResult {
  const state = useSyncExternalStore(subscribeAuthState, getAuthState, getInitialAuthState);

  // `signOut` is a module-level function, so this object changes identity exactly when the
  // session does. Without the memo it would be new on every render, which is a trap for any
  // caller that puts the result in a dependency array.
  return useMemo(() => ({ ...state, signOut }), [state]);
}
